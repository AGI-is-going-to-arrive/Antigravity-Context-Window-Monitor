/**
 * Independent browser WebView client runtime for Antigravity Context Monitor.
 *
 * Compiled and typechecked under `tsconfig.client.json` (`lib: ["ES2022", "DOM", "DOM.Iterable"]`)
 * and bundled via `esbuild` into a self-contained browser IIFE with deterministic content-hash `buildId`.
 *
 * Security & Lifecycle Guarantees:
 * - Zero `Function.prototype.toString()` stitching (`collectPricingInputOverrides` is imported directly).
 * - Preserves strict Wave 1B `window.message` origin/source/bridge validation.
 * - Preserves fail-closed `body[data-privacy-masked]` sync, opaque `data-account-handle`,
 *   host re-render on unmask, and immediate DOM + cache purge on re-mask.
 * - Clean lifecycle with idempotent mount, clean `unmount()`, and automatic hot-reinjection
 *   when `buildId` changes across same-version rebuilds.
 */

import { collectPricingInputOverrides, type PricingInputLike } from '../pricing-overrides';
import type {
    AcmWindowGlobal,
    CdpLauncherStatusLike,
    CdpStatusLike,
    UpdateStatusLike,
    VsCodeApiLike,
    WebviewClientBootstrapConfigV118,
    WebviewClientRuntimeHandle,
    WebviewSavedState,
} from './webview-types';

declare const acquireVsCodeApi: (() => VsCodeApiLike) | undefined;

type CleanupFn = () => void;

interface CopyButtonEl extends HTMLElement {
    _copyResetTimer?: ReturnType<typeof setTimeout> | null;
}

interface RichTipData {
    title: string;
    body: string;
    meta: string;
    htmlId: string;
    key: string;
}

interface IncrementalUpdatePayload {
    tabs?: Record<string, unknown>;
    time?: string;
    mastheadControls?: string;
    nativeHud?: string;
    privacyMasked?: boolean;
    cdpStatus?: CdpStatusLike;
    updateStatus?: UpdateStatusLike;
    globalRules?: Record<string, unknown>;
    snapshot?: {
        tabs?: Record<string, unknown>;
        time?: string;
        privacyMasked?: boolean;
        lockToMainAgent?: boolean;
        cdpStatus?: CdpStatusLike;
        updateStatus?: UpdateStatusLike;
        data?: {
            cdpStatus?: CdpStatusLike;
            updateStatus?: UpdateStatusLike;
            globalRules?: Record<string, unknown>;
            appSettings?: Record<string, unknown>;
        };
        meta?: {
            overlayTargetTab?: {
                seq?: unknown;
                tab?: unknown;
            };
        };
    };
}

export function mountWebviewClient(config: WebviewClientBootstrapConfigV118): WebviewClientRuntimeHandle {
    const win = window as unknown as AcmWindowGlobal;
    const buildId = typeof config.buildId === 'string' ? config.buildId : '';

    const existing = win.__ACM_WEBVIEW_CLIENT__;
    if (existing && existing.buildId === buildId && buildId) {
        return {
            installed: true,
            reused: true,
            buildId,
            unmount: existing.unmount,
            getStatus: existing.getStatus,
        };
    }
    if (existing && typeof existing.unmount === 'function') {
        try { existing.unmount(); } catch { /* ignore */ }
    }

    const byId = (id: string): HTMLElement | null => document.getElementById(id);
    const strings = config.strings;
    const a11yStrings = (config.a11y || {}) as Partial<NonNullable<WebviewClientBootstrapConfigV118['a11y']>>;
    const subscriptionPlanPlaceholders = config.subscriptionPlanPlaceholders || {};
    const defaultSubscriptionFeePlaceholder = config.defaultSubscriptionFeePlaceholder || '';

    let lastPoliteAnnouncement = '';
    function announcePolite(message?: string): void {
        const text = (message || '').trim();
        if (!text) { return; }
        const region = byId('acmLiveRegion');
        if (!region) { return; }
        region.textContent = text === lastPoliteAnnouncement ? (text + '\u200B') : text;
        lastPoliteAnnouncement = text;
    }

    const cleanups: CleanupFn[] = [];
    const activeTimers = new Set<ReturnType<typeof setTimeout>>();
    let isMounted = true;

    function addTrackedListener(
        target: EventTarget | null | undefined,
        type: string,
        listener: EventListener,
        options?: boolean | AddEventListenerOptions,
    ): void {
        if (!target || typeof target.addEventListener !== 'function') { return; }
        target.addEventListener(type, listener, options);
        cleanups.push(() => {
            if (typeof target.removeEventListener === 'function') {
                target.removeEventListener(type, listener, options);
            }
        });
    }

    function scheduleTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
        const timer = setTimeout(() => {
            activeTimers.delete(timer);
            if (!isMounted) { return; }
            fn();
        }, ms);
        activeTimers.add(timer);
        return timer;
    }

    function cancelTrackedTimeout(timer: ReturnType<typeof setTimeout> | null | undefined): void {
        if (timer !== null && timer !== undefined) {
            activeTimers.delete(timer);
            if (typeof clearTimeout === 'function') {
                clearTimeout(timer);
            }
        }
    }

    function raf(fn: () => void): void {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                if (!isMounted) { return; }
                fn();
            });
        } else {
            fn();
        }
    }

    const bridge = (window as unknown as AcmWindowGlobal).__ACM_BRIDGE__ || null;
    const hasIdeHostNonceConsumer = typeof win.__ACM_CONSUME_HOST_NONCE__ === 'function';
    let ideHostNonce = '';
    if (hasIdeHostNonceConsumer) {
        try {
            const consumed = win.__ACM_CONSUME_HOST_NONCE__!();
            if (typeof consumed === 'string' && consumed.length > 0) {
                ideHostNonce = consumed;
            }
        } catch { /* ignore */ }
    }
    const vscode: VsCodeApiLike = (bridge && typeof bridge.asVsCodeApi === 'function')
        ? bridge.asVsCodeApi()
        : (typeof acquireVsCodeApi === 'function'
            ? acquireVsCodeApi()
            : (typeof win.acquireVsCodeApi === 'function'
                ? win.acquireVsCodeApi()
                : { getState: () => ({}), setState: () => {}, postMessage: () => {} }));

    function sendBridgeOrPost(
        payload: Record<string, unknown>,
        onBridgeResult: (data: Record<string, unknown> | null) => void,
        onBridgeError?: (err?: unknown) => void,
        onPostFallback?: () => void,
    ): void {
        if (bridge && bridge.surface !== 'vscode' && typeof bridge.sendAction === 'function') {
            Promise.resolve(bridge.sendAction(payload)).then((res) => {
                const raw = res && typeof res === 'object' ? (res as Record<string, unknown>) : null;
                const inner = raw && raw.result && typeof raw.result === 'object' ? (raw.result as Record<string, unknown>) : null;
                const merged = inner
                    ? (inner.ok === undefined && typeof raw?.ok === 'boolean' ? Object.assign({ ok: raw.ok }, inner) : inner)
                    : raw;
                onBridgeResult(merged);
            }).catch((err) => {
                if (onBridgeError) { onBridgeError(err); }
            });
        } else {
            vscode.postMessage(payload);
            if (onPostFallback) { onPostFallback(); }
        }
    }

    function getOwnPageOrigin(): string {
        try {
            if (window.location && typeof window.location.origin === 'string' && window.location.origin && window.location.origin !== 'null') {
                return window.location.origin;
            }
            if (window.location && typeof window.location.href === 'string' && window.location.href && typeof URL === 'function') {
                const parsed = new URL(window.location.href);
                if (parsed && parsed.origin && parsed.origin !== 'null') { return parsed.origin; }
            }
        } catch { /* ignore */ }
        return '';
    }

    /**
     * Strict sender/channel validator for incoming window message events.
     * - Under App Sidecar host-bridge: delegates to `bridge.isTrustedHostEvent`.
     * - Under real VS Code / Antigravity IDE webview: authenticates per-document
     *   host nonce (`__acmHostNonce`) consumed once at mount (works reliably even
     *   when VS Code shadows `window.parent === window`).
     * - Under standalone unit-test harnesses without a nonce consumer: enforces
     *   origin/source validation.
     */
    function isTrustedHostMessageEvent(event: MessageEvent): boolean {
        if (!event || !event.data || typeof event.data !== 'object') { return false; }
        const rawOrigin = typeof event.origin === 'string' ? event.origin : '';
        if (rawOrigin === 'null') { return false; }
        const ownOrigin = getOwnPageOrigin();
        if (rawOrigin) {
            if (!ownOrigin || rawOrigin !== ownOrigin) { return false; }
        }
        if (bridge && bridge.surface !== 'vscode' && typeof bridge.isTrustedHostEvent === 'function') {
            return bridge.isTrustedHostEvent(event) === true;
        }
        if (hasIdeHostNonceConsumer) {
            if (!ideHostNonce) { return false; }
            const msgNonce = (event.data as Record<string, unknown>).__acmHostNonce;
            return typeof msgNonce === 'string' && msgNonce === ideHostNonce;
        }
        if (event.source !== undefined && event.source !== null && event.source !== window) {
            const isVsCodeParent = typeof window.parent !== 'undefined'
                && event.source === window.parent
                && !!ownOrigin
                && ownOrigin.indexOf('vscode-webview://') === 0
                && rawOrigin === ownOrigin;
            if (!isVsCodeParent) { return false; }
        }
        return true;
    }

    function extractTrustedHostMessage(event: MessageEvent): Record<string, unknown> | null {
        if (!isTrustedHostMessageEvent(event)) { return null; }
        const raw = event.data as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(raw, '__acmHostNonce')) {
            return raw;
        }
        const copy: Record<string, unknown> = {};
        for (const k in raw) {
            if (Object.prototype.hasOwnProperty.call(raw, k) && k !== '__acmHostNonce') {
                copy[k] = raw[k];
            }
        }
        return copy;
    }

    function isTrustedSnapshotCustomEvent(event: Event): boolean {
        const customEv = event as CustomEvent;
        if (!customEv || !customEv.detail || typeof customEv.detail !== 'object') { return false; }
        if (bridge && bridge.surface !== 'vscode' && typeof bridge.isTrustedHostEvent === 'function') {
            return bridge.isTrustedHostEvent(event) === true;
        }
        if (hasIdeHostNonceConsumer) {
            if (!ideHostNonce) { return false; }
            const d = customEv.detail as Record<string, unknown>;
            return typeof d.__acmHostNonce === 'string' && d.__acmHostNonce === ideHostNonce;
        }
        return true;
    }

    let savedState: WebviewSavedState = vscode.getState() || {};

    function triggerClientDownload(filename?: string, content?: string, mimeType?: string): boolean {
        try {
            const blob = new Blob([String(content || '')], { type: mimeType || 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || 'antigravity-calendar-export.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            scheduleTimeout(() => { URL.revokeObjectURL(url); }, 1000);
            return true;
        } catch {
            return false;
        }
    }

    function getNativeHudExpanded(): boolean {
        const s = vscode.getState() || {};
        return !!s.nativeHudExpanded;
    }

    function applyNativeHudExpanded(expanded: boolean): void {
        const bar = byId('nativeHudBar');
        const toggle = byId('nativeHudToggle');
        const drawer = byId('nativeHudDrawer');
        const isExp = !!expanded;
        if (bar) { bar.setAttribute('data-hud-expanded', String(isExp)); }
        if (toggle) { toggle.setAttribute('aria-expanded', String(isExp)); }
        if (drawer) { drawer.hidden = !isExp; }
    }

    function syncOrchestratorPricingModeVisual(mode: string): void {
        const resolvedMode = mode === 'strict' ? 'strict' : 'mapped';
        const modeBtns = document.querySelectorAll('[data-action="setOrchestratorPricingMode"]');
        for (let mi = 0; mi < modeBtns.length; mi++) {
            const isMatch = modeBtns[mi].getAttribute('data-mode') === resolvedMode;
            modeBtns[mi].classList.toggle('is-active', isMatch);
            modeBtns[mi].setAttribute('aria-checked', String(isMatch));
        }
    }

    function syncSubscriptionFeePlaceholder(planId: string): void {
        const sfEl = byId('subscriptionFeeInput') as HTMLInputElement | null;
        if (!sfEl) { return; }
        sfEl.placeholder = subscriptionPlanPlaceholders[planId] || defaultSubscriptionFeePlaceholder;
    }

    function pickLocalizedText(enText?: string, zhText?: string): string {
        const lang = (document.body && document.body.getAttribute('data-lang')) || 'both';
        const enStr = typeof enText === 'string' ? enText.trim() : '';
        const zhStr = typeof zhText === 'string' ? zhText.trim() : '';
        if (lang === 'en') { return enStr || zhStr; }
        if (lang === 'zh') { return zhStr || enStr; }
        if (enStr && zhStr && enStr !== zhStr) { return enStr + ' / ' + zhStr; }
        return enStr || zhStr;
    }

    function setBtnLabel(el: Element | null, lbl: string): void {
        if (!el) { return; }
        const target = el.querySelector('span') || el;
        const sepIdx = typeof Node !== 'undefined' && target instanceof Node && document.body?.getAttribute('data-lang') === 'both'
            ? lbl.lastIndexOf(' / ')
            : -1;
        if (sepIdx > 0 && /[\u4e00-\u9fff]/.test(lbl.slice(sepIdx + 3))) {
            target.textContent = '';
            const mk = (cls: string, txt: string, langAttr?: string) => {
                const s = document.createElement('span');
                s.className = cls;
                if (langAttr) { s.setAttribute('lang', langAttr); }
                s.textContent = txt;
                target.appendChild(s);
            };
            mk('bi-en', lbl.slice(0, sepIdx));
            mk('bi-sep', ' / ');
            mk('bi-zh', lbl.slice(sepIdx + 3), 'zh-CN');
        } else {
            target.textContent = lbl;
        }
    }

    function getCdpRevealLabel(platform: string): string {
        if (platform === 'win32') { return strings.cdpLauncherRevealWinText; }
        if (platform === 'linux') { return strings.cdpLauncherRevealLinuxText; }
        return strings.cdpLauncherRevealDarwinText;
    }

    function getCdpMissingDiagnosticText(diag: string, launcherInstalled: boolean, platform: string): string {
        if (launcherInstalled) {
            const installedBase = platform === 'win32'
                ? strings.cdpDiagInstalledWinText
                : (platform === 'linux' ? strings.cdpDiagInstalledLinuxText : strings.cdpDiagInstalledDarwinText);
            return diag === 'missing_port_file'
                ? (strings.cdpDiagMissingPortPrefixText + installedBase)
                : installedBase;
        }
        return diag === 'host_missing_flag' ? strings.cdpDiagHostMissingText : strings.cdpDiagMissingText;
    }

    const LAUNCHER_BTN_IDS = ['cdpSetupLauncherBtn', 'cdpRevealLauncherBtn', 'cdpRemoveLauncherBtn', 'onboardingSetupCdpBtn'];
    function applyCdpLauncherReply(payload: Record<string, unknown> | null, cmd?: string | null, extraFbId?: string): void {
        for (const id of LAUNCHER_BTN_IDS) { const b = byId(id) as HTMLButtonElement | null; if (b) { b.disabled = false; } }
        const cdpStatusObj = payload?.cdpStatus as CdpStatusLike | undefined;
        const st = (payload?.launcherStatus || payload?.status || cdpStatusObj?.launcherStatus || null) as CdpLauncherStatusLike | null;
        if (st) { syncCdpLauncherUi(st); syncAppOnboardingBannerUi({ launcherInstalled: Boolean(st.installed) }); }
        if (cdpStatusObj && typeof cdpStatusObj === 'object') { syncCdpStatusUi(cdpStatusObj); }
        const isRev = (cmd || payload?.action) === 'revealCdpLauncher';
        const loc = pickLocalizedText(payload?.messageEn as string | undefined, payload?.messageZh as string | undefined);
        const pathSfx = st && typeof st.launcherPath === 'string' && st.launcherPath && (!loc || loc.indexOf(st.launcherPath) < 0) ? (' (' + st.launcherPath + ')') : '';
        const failed = !payload || payload.ok === false;
        const fb = failed
            ? (String(payload?.error || '') || loc || (isRev ? strings.revealFailedText : strings.cdpLauncherActionFailedText))
            : ((loc || (isRev ? strings.revealedText : strings.savedText)) + pathSfx);
        flashFeedback('cdpLauncherFeedback', fb, failed ? 3500 : 4500);
        if (extraFbId) { flashFeedback(extraFbId, fb, failed ? 4500 : 6000); }
    }

    function syncCdpLauncherUi(launcherStatus: CdpLauncherStatusLike): void {
        if (!launcherStatus || typeof launcherStatus !== 'object') { return; }
        const installed = !!launcherStatus.installed;
        const statusEl = byId('cdpLauncherStatus');
        const platform = (typeof launcherStatus.platform === 'string' && launcherStatus.platform)
            ? launcherStatus.platform
            : ((statusEl && statusEl.getAttribute('data-launcher-platform')) || 'darwin');
        if (statusEl) {
            statusEl.setAttribute('data-launcher-installed', String(installed));
            statusEl.setAttribute('data-launcher-platform', platform);
            const pathStr = typeof launcherStatus.launcherPath === 'string' ? launcherStatus.launcherPath : '';
            if (pathStr) { statusEl.setAttribute('data-launcher-path', pathStr); }
            else { statusEl.removeAttribute('data-launcher-path'); }
            statusEl.textContent = '';
            const badge = document.createElement('span');
            badge.className = 'stg-cdp-launcher-badge' + (installed ? ' is-installed' : '');
            badge.textContent = installed ? strings.cdpLauncherInstalledText : strings.cdpLauncherNotInstalledText;
            statusEl.appendChild(badge);
            if (pathStr) {
                const codeEl = document.createElement('code');
                codeEl.className = 'stg-cdp-launcher-path';
                codeEl.textContent = pathStr;
                statusEl.appendChild(codeEl);
            }
        }
        const noteEl = byId('cdpLauncherNote');
        if (noteEl && (launcherStatus.noteEn || launcherStatus.noteZh)) {
            noteEl.textContent = pickLocalizedText(launcherStatus.noteEn, launcherStatus.noteZh);
        }
        const setupBtn = byId('cdpSetupLauncherBtn');
        if (setupBtn) {
            if (setupBtn.classList) { setupBtn.classList.toggle('stg-btn-primary', !installed); }
            setBtnLabel(setupBtn, installed ? strings.cdpLauncherRecreateBtnText : strings.cdpLauncherCreateBtnText);
        }
        const revealBtn = byId('cdpRevealLauncherBtn');
        if (revealBtn) {
            revealBtn.hidden = !installed;
            revealBtn.setAttribute('data-launcher-platform', platform);
            if (revealBtn.classList) { revealBtn.classList.toggle('stg-btn-primary', installed); }
            setBtnLabel(revealBtn, getCdpRevealLabel(platform));
        }
        const removeBtn = byId('cdpRemoveLauncherBtn');
        if (removeBtn) {
            removeBtn.hidden = !installed;
        }
        const hintEl = byId('cdpDiagnosticHint');
        if (hintEl && !hintEl.hidden) {
            const currentDiag = hintEl.getAttribute('data-cdp-diagnostic') || '';
            if (currentDiag === 'host_missing_flag' || currentDiag === 'missing_port_file') {
                hintEl.textContent = getCdpMissingDiagnosticText(currentDiag, installed, platform);
            }
        }
    }

    function syncCdpStatusUi(cdpStatus: CdpStatusLike | null | undefined, fallbackComposerOn?: boolean, fallbackTopBarOn?: boolean): void {
        if (cdpStatus && cdpStatus.launcherStatus && typeof cdpStatus.launcherStatus === 'object') {
            syncCdpLauncherUi(cdpStatus.launcherStatus);
        }

        const compCb = byId('toggleAppComposerRing') as HTMLInputElement | null;
        const topCb = byId('toggleAppTopBar') as HTMLInputElement | null;
        const compOn = typeof fallbackComposerOn === 'boolean' ? fallbackComposerOn : Boolean(compCb && compCb.checked);
        const topOn = typeof fallbackTopBarOn === 'boolean' ? fallbackTopBarOn : Boolean(topCb && topCb.checked);
        const anyEnabled = compOn || topOn;

        const state = (cdpStatus && typeof cdpStatus.state === 'string') ? cdpStatus.state : (anyEnabled ? 'cdp_unavailable' : 'disabled');
        const diagMap: Record<string, string> = { connected: 'connected', probing: 'probing', error: 'ws_error', cdp_unavailable: 'missing_port_file' };
        const diag = (cdpStatus && typeof cdpStatus.diagnosticCode === 'string') ? cdpStatus.diagnosticCode : (diagMap[state] || 'disabled');

        const pill = byId('cdpStatusPill');
        if (pill) {
            const clsMap: Record<string, string> = { connected: ' is-connected', probing: '', error: ' is-error', cdp_unavailable: ' is-inactive' };
            const txtMap: Record<string, string> = { connected: strings.cdpConnectedText, probing: strings.cdpProbingText, error: strings.cdpErrorText, cdp_unavailable: strings.cdpInactiveText };
            const bodyMap: Record<string, string> = {
                connected: cdpStatus?.targetTitle ? String(cdpStatus.targetTitle) : strings.cdpPillTipConnectedFallback,
                probing: strings.cdpPillTipProbingBody,
                error: cdpStatus?.errorMessage ? String(cdpStatus.errorMessage) : strings.cdpPillTipErrorFallback,
                cdp_unavailable: strings.cdpPillTipInactiveBody,
            };
            pill.className = 'stg-status-pill' + (clsMap[state] ?? ' is-disabled');
            pill.setAttribute('data-cdp-state', state);
            pill.setAttribute('data-cdp-diagnostic', diag);
            pill.textContent = txtMap[state] || strings.cdpDisabledText;
            pill.removeAttribute('title');
            pill.setAttribute('data-popover-key', 'settings:cdp-status');
            pill.setAttribute('data-tip-title', strings.cdpPillTipTitle);
            pill.setAttribute('data-tip-body', bodyMap[state] || strings.cdpPillTipDisabledBody);
            pill.setAttribute('data-tip-meta', strings.cdpPillTipMeta);
        }

        const hint = byId('cdpDiagnosticHint');
        if (hint) {
            hint.setAttribute('data-cdp-diagnostic', diag);
            if (state === 'disabled' || diag === 'disabled') {
                hint.hidden = true;
                hint.textContent = '';
                hint.className = 'stg-diagnostic-hint';
            } else if (state === 'probing' || diag === 'probing') {
                hint.className = 'stg-diagnostic-hint';
                hint.textContent = strings.cdpDiagProbingText;
                hint.hidden = false;
            } else {
                const lEl = byId('cdpLauncherStatus');
                const lInst = typeof cdpStatus?.launcherStatus?.installed === 'boolean'
                    ? cdpStatus.launcherStatus.installed
                    : Boolean(lEl && lEl.getAttribute('data-launcher-installed') === 'true');
                const lPlat = cdpStatus?.launcherStatus?.platform || cdpStatus?.platformGuide?.platform || lEl?.getAttribute('data-launcher-platform') || 'darwin';
                const portPart = typeof cdpStatus?.discoveredPort === 'number' ? (' (:' + cdpStatus.discoveredPort + ')') : '';
                const titlePart = cdpStatus?.targetTitle ? (' — ' + String(cdpStatus.targetTitle)) : '';
                const errPart = cdpStatus?.errorMessage ? (': ' + String(cdpStatus.errorMessage)) : '';
                const tone = state === 'connected' ? 'is-good' : ((state === 'error' || diag === 'ws_error' || diag === 'eval_error') ? 'is-error' : 'is-warn');
                const tplMap: Record<string, string> = {
                    connected: strings.cdpDiagConnectedTpl,
                    port_unreachable: strings.cdpDiagUnreachableTpl,
                    no_hub_target: strings.cdpDiagNoHubTpl,
                    ws_error: strings.cdpDiagWsErrorTpl,
                    eval_error: strings.cdpDiagEvalErrorTpl,
                };
                const msgText = tplMap[diag]
                    ? tplMap[diag].replace(/\{port\}/g, () => portPart).replace(/\{title\}/g, () => titlePart).replace(/\{err\}/g, () => errPart)
                    : getCdpMissingDiagnosticText(diag === 'host_missing_flag' ? diag : 'missing_port_file', lInst, lPlat);
                hint.className = 'stg-diagnostic-hint ' + tone;
                hint.textContent = msgText;
                hint.hidden = false;
            }
        }
        syncAppOnboardingBannerUi({ cdpState: state, topBarOn: topOn, composerOn: compOn });
        reanchorRichTipPopover();
    }

    function syncUpdateStatusUi(updateStatus: UpdateStatusLike | null | undefined): void {
        if (!updateStatus || typeof updateStatus !== 'object') { return; }
        const rawLatest = typeof updateStatus.latestVersion === 'string' ? updateStatus.latestVersion.trim() : '';
        const latestTag = rawLatest ? (rawLatest.charAt(0) === 'v' ? rawLatest : ('v' + rawLatest)) : '';
        const rawCur = typeof updateStatus.currentVersion === 'string' ? updateStatus.currentVersion.trim() : '';
        const curTag = rawCur ? (rawCur.charAt(0) === 'v' ? rawCur : ('v' + rawCur)) : '';
        const hasUpd = Boolean(
            updateStatus.updateAvailable
            || updateStatus.hasUpdate
            || updateStatus.status === 'update_available',
        );
        const isErr = Boolean(updateStatus.status === 'error' || updateStatus.error);
        const isUpToDate = Boolean(updateStatus.status === 'up_to_date' || updateStatus.status === 'not_modified' || (updateStatus.checkedAt && !hasUpd));

        const statusCode = (hasUpd && latestTag) ? 'update_available'
            : (isErr ? 'error' : (isUpToDate ? 'up_to_date' : 'idle'));
        const pillClass = statusCode === 'update_available' ? 'stg-status-pill is-update'
            : (statusCode === 'error' ? 'stg-status-pill is-error'
                : (statusCode === 'up_to_date' ? 'stg-status-pill is-uptodate' : 'stg-status-pill'));
        const tipTitle = statusCode === 'update_available' ? strings.updateTipTitleAvailable
            : (statusCode === 'error' ? strings.updateTipTitleError
                : (statusCode === 'up_to_date' ? strings.updateTipTitleOk : strings.updateTipTitleIdle));
        const tipBody = statusCode === 'update_available' ? strings.updateTipBodyAvailableTpl.replace(/\{ver\}/g, () => latestTag)
            : (statusCode === 'error' ? (updateStatus.error ? String(updateStatus.error) : strings.updateTipBodyErrorFallback)
                : (statusCode === 'up_to_date' ? strings.updateTipBodyOk : strings.updateTipBodyIdle));
        const tipMeta = statusCode === 'update_available' ? strings.updateTipMetaAvailable
            : (statusCode === 'error' ? strings.updateTipMetaError : '');

        function applyPillRichTip(el: Element, key: string): void {
            el.removeAttribute('title');
            el.setAttribute('data-popover-key', key);
            el.setAttribute('data-tip-title', tipTitle);
            el.setAttribute('data-tip-body', tipBody);
            if (tipMeta) { el.setAttribute('data-tip-meta', tipMeta); }
            else { el.removeAttribute('data-tip-meta'); }
        }

        const settingsPill = byId('updateStatusPill');
        if (settingsPill) {
            settingsPill.className = pillClass;
            settingsPill.setAttribute('data-update-status', statusCode);
            if (statusCode === 'update_available') {
                settingsPill.textContent = strings.updateAvailablePillTpl.replace(/\{ver\}/g, () => latestTag);
            } else if (statusCode === 'error') {
                settingsPill.textContent = strings.checkFailedText;
            } else if (statusCode === 'up_to_date') {
                settingsPill.textContent = curTag ? strings.upToDatePillTpl.replace(/\{ver\}/g, () => curTag) : strings.upToDateText;
            } else if (curTag) {
                settingsPill.textContent = strings.currentVerPillTpl.replace(/\{ver\}/g, () => curTag);
            }
            applyPillRichTip(settingsPill, 'settings:update-status');
        }

        const upgradeButton = byId('settingsUpgradeNowBtn');
        if (upgradeButton) { upgradeButton.hidden = statusCode !== 'update_available'; }
        const checkedAtLabel = byId('settingsUpdateCheckedAt');
        const checkedTime = updateStatus.checkedAt ? new Date(updateStatus.checkedAt) : null;
        if (checkedAtLabel && checkedTime && Number.isFinite(checkedTime.getTime()) && checkedTime.getTime() > 0) {
            checkedAtLabel.setAttribute('datetime', checkedTime.toISOString());
            checkedAtLabel.textContent = checkedTime.toLocaleString(currentViewLang === 'zh' ? 'zh-CN' : 'en-US');
        }

        const aboutPills = document.querySelectorAll('[data-about-update-status]');
        for (let api = 0; api < aboutPills.length; api++) {
            const ap = aboutPills[api];
            ap.className = pillClass;
            ap.setAttribute('data-about-update-status', statusCode);
            if (statusCode === 'update_available') {
                ap.textContent = strings.updateAvailablePillTpl.replace(/\{ver\}/g, () => latestTag);
            } else if (statusCode === 'error') {
                ap.textContent = strings.checkFailedText;
            } else if (statusCode === 'up_to_date') {
                ap.textContent = strings.aboutUpToDatePlainText;
            } else {
                ap.textContent = strings.aboutReadyText;
            }
            applyPillRichTip(ap, 'about:update-status');
        }

        reanchorRichTipPopover();
    }

    function copyTextSafe(text: unknown): Promise<boolean> {
        const value = String(text == null ? '' : text);
        if (bridge && typeof bridge.copyText === 'function') {
            return Promise.resolve(bridge.copyText(value));
        }
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(value).then(() => true).catch(() => false);
        }
        try {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return Promise.resolve(!!ok);
        } catch {
            return Promise.resolve(false);
        }
    }

    function flashCopyButton(btn: CopyButtonEl | null): void {
        if (btn) {
            if (!btn.dataset.origHtml) { btn.dataset.origHtml = btn.innerHTML; }
            btn.classList.add('copied');
            btn.textContent = strings.copiedText;
            cancelTrackedTimeout(btn._copyResetTimer);
            btn._copyResetTimer = scheduleTimeout(() => {
                if (btn.dataset.origHtml) { btn.innerHTML = btn.dataset.origHtml; }
                btn.classList.remove('copied');
            }, 2000);
        }
        flashFeedback('ctxCopyFeedback', strings.copiedText, 2000);
    }

    function getContextVizMode(): 'bar' | 'dots' {
        const s = vscode.getState() || {};
        return s.ctxVizMode === 'dots' ? 'dots' : 'bar';
    }

    function applyContextVizMode(mode: string): void {
        const resolved = mode === 'dots' ? 'dots' : 'bar';
        const cards = document.querySelectorAll('.ctx-breakdown-card');
        for (let ci = 0; ci < cards.length; ci++) {
            cards[ci].setAttribute('data-viz-mode', resolved);
            const btns = cards[ci].querySelectorAll('[data-ctx-viz]');
            for (let bi = 0; bi < btns.length; bi++) {
                const isMatch = btns[bi].getAttribute('data-ctx-viz') === resolved;
                btns[bi].classList.toggle('is-active', isMatch);
                btns[bi].setAttribute('aria-pressed', String(isMatch));
            }
        }
    }

    function syncLockMainVisual(locked: boolean): void {
        const lockBtn = byId('lockMainBtn');
        if (lockBtn) {
            lockBtn.classList.toggle('is-locked', !!locked);
            lockBtn.setAttribute('aria-pressed', String(!!locked));
        }
        const lockCb = byId('toggleLockMainAgent') as HTMLInputElement | null;
        if (lockCb) { lockCb.checked = !!locked; }
    }

    function setFeedback(id: string, text: string): void {
        const el = byId(id);
        if (!el) { return; }
        el.textContent = text || '';
        el.style.opacity = text ? '1' : '0';
    }

    function flashFeedback(id: string, text: string, delay: number): void {
        setFeedback(id, text);
        if (!delay || delay <= 0) { return; }
        scheduleTimeout(() => { setFeedback(id, ''); }, delay);
    }

    function flashProfileBillingFeedback(text: string, isError: boolean): void {
        const el = byId('profileBillingDayFeedback');
        if (el) {
            el.style.color = isError ? 'var(--ed-danger)' : 'var(--ed-good)';
        }
        flashFeedback('profileBillingDayFeedback', text, 2000);
    }

    // ─── 6-Tab Navigation Shell + Topbar About Utility View (ⓘ) + Deep Links ───
    // Tuple: [canonicalTab, slotName?, anchorId?, legacyPane?, unhideSlot?]
    const TAB_ROUTES: Record<string, readonly [string, string?, string?, string?, boolean?]> = {
        overview: ['overview'],
        gm: ['gm', 'gm', '', 'gmdata'],
        gmdata: ['gm', 'gm', '', 'gmdata'],
        'gm-data': ['gm', 'gm', '', 'gmdata'],
        activity: ['gm', 'activity', 'slot-activity', 'gmdata', true],
        sessions: ['sessions', 'sessions', '', 'chats'],
        chats: ['sessions', 'sessions', '', 'chats'],
        'chat-history': ['sessions', 'sessions', '', 'chats'],
        calendar: ['calendar', 'calendar'],
        usage: ['calendar', 'calendar'],
        cost: ['calendar', 'pricing', 'slot-pricing', 'pricing'],
        pricing: ['calendar', 'pricing', 'slot-pricing', 'pricing'],
        models: ['models', 'models'],
        profile: ['models', 'profile', 'slot-profile', 'profile'],
        account: ['models', 'profile', 'slot-profile', 'profile'],
        accounts: ['models', 'profile', 'slot-profile', 'profile'],
        settings: ['settings'],
        updates: ['settings', '', 'updatesSettingsCard'],
        aboutupdatessection: ['settings', '', 'updatesSettingsCard'],
        updatessettingscard: ['settings', '', 'updatesSettingsCard'],
        'settings-cdp-card': ['settings', '', 'settings-cdp-card'],
        appoverlayscard: ['settings', '', 'settings-cdp-card'],
        'global-rules': ['settings', '', 'globalRulesCard'],
        globalrulescard: ['settings', '', 'globalRulesCard'],
        about: ['about'],
    };

    const tabBtns = document.querySelectorAll<HTMLElement>('.tab-btn');
    const utilityBtns = document.querySelectorAll<HTMLElement>('[data-utility-view]');
    const tabPanes = document.querySelectorAll<HTMLElement>('.tab-pane');
    const defaultTab = document.querySelector<HTMLElement>('.tab-btn.active');
    let activeTab = (document.body && document.body.getAttribute('data-active-tab'))
        || ((defaultTab && defaultTab.dataset && defaultTab.dataset.tab) ? defaultTab.dataset.tab : 'overview');
    let activeAnchor = (document.body && document.body.getAttribute('data-initial-anchor')) || '';
    const lastTabHtmls: Record<string, string> = {};
    const eocVisibleTabs: Record<string, boolean> = {};
    let currentViewLang = (document.body && (document.body.getAttribute('data-view-lang') || document.body.getAttribute('data-lang'))) || 'both';

    function resolveTargetRoute(rawTab: string | null | undefined, explicitAnchor?: string): { tab: string; anchor: string } | null {
        if (typeof rawTab !== 'string') { return null; }
        const norm = rawTab.trim().toLowerCase().replace(/^#(?:tab-)?/, '');
        if (!norm) { return null; }
        const entry = TAB_ROUTES[norm];
        if (!entry) {
            return byId('tab-' + norm) ? { tab: norm, anchor: explicitAnchor || '' } : null;
        }
        const [tab, , defaultAnchor, legacy] = entry;
        if (legacy && byId('tab-' + legacy) && (!defaultAnchor || !byId(defaultAnchor))) {
            return { tab: legacy, anchor: '' };
        }
        return { tab, anchor: explicitAnchor || defaultAnchor || '' };
    }

    function readUrlDeepLink(): { tab: string; anchor: string } | null {
        try {
            if (window.location && typeof window.location.search === 'string' && window.location.search) {
                const m = /[?&]tab=([^&#]+)/i.exec(window.location.search);
                if (m && m[1]) {
                    const route = resolveTargetRoute(decodeURIComponent(m[1]));
                    if (route) { return route; }
                }
            }
            if (window.location && typeof window.location.hash === 'string' && window.location.hash) {
                const route = resolveTargetRoute(window.location.hash);
                if (route) { return route; }
            }
        } catch { /* ignore */ }
        return null;
    }

    function syncNativeHudVisibility(): void {
        const hudHost = byId('nativeHudHost');
        if (!hudHost) { return; }
        const hasContent = Boolean(hudHost.innerHTML && hudHost.innerHTML.trim());
        const enabledAttr = hudHost.getAttribute('data-hud-enabled');
        const hudEnabled = enabledAttr === null ? hasContent : enabledAttr !== 'false';
        const autoHideOverview = !document.body || document.body.getAttribute('data-hud-auto-hide-overview') !== 'false';
        const hiddenByOverview = autoHideOverview && activeTab === 'overview';
        hudHost.setAttribute('data-hud-overview-hidden', String(hiddenByOverview));
        hudHost.hidden = !hasContent || !hudEnabled || hiddenByOverview;
    }

    function getTabNameFromPaneId(paneId: string): string {
        return paneId && paneId.indexOf('tab-') === 0 ? paneId.substring(4) : '';
    }
    function getTabNameFromNode(node: Element | null): string {
        const pane = node && typeof node.closest === 'function' ? node.closest('.tab-pane') : null;
        return pane ? getTabNameFromPaneId(pane.id || '') : '';
    }
    function captureVisibleEocTabs(): Record<string, boolean> {
        const visibleTabs: Record<string, boolean> = {};
        for (let pi = 0; pi < tabPanes.length; pi++) {
            const paneName = getTabNameFromPaneId(tabPanes[pi].id || '');
            if (!paneName) { continue; }
            const sentinel = tabPanes[pi].querySelector('.eoc-sentinel');
            if (sentinel && sentinel.classList.contains('eoc-visible')) {
                visibleTabs[paneName] = true;
                eocVisibleTabs[paneName] = true;
            }
        }
        return visibleTabs;
    }
    function restoreVisibleEoc(tabName: string): void {
        const pane = byId('tab-' + tabName);
        if (!pane) { return; }
        const sentinel = pane.querySelector('.eoc-sentinel');
        if (!sentinel) { return; }
        sentinel.classList.add('eoc-no-transition');
        sentinel.classList.add('eoc-visible');
        raf(() => {
            raf(() => {
                sentinel.classList.remove('eoc-no-transition');
            });
        });
    }
    for (let tp = 0; tp < tabPanes.length; tp++) {
        const initialTabName = getTabNameFromPaneId(tabPanes[tp].id || '');
        if (initialTabName) {
            lastTabHtmls[initialTabName] = tabPanes[tp].innerHTML;
        }
    }

    // ─── Tab Slider & Zero-Scroll Helpers ───
    function setTabHintState(enabled: boolean): void {
        if (document.body) {
            document.body.setAttribute('data-tab-hint-enabled', enabled ? 'true' : 'false');
        }
        const badge = byId('tabHintState');
        if (badge) {
            badge.textContent = enabled ? strings.tabHintEnabledText : strings.tabHintDisabledText;
            badge.classList.toggle('is-ready', !!enabled);
            badge.classList.toggle('is-missing', !enabled);
        }
    }
    function updateTabSlider(): void {
        const slider = document.querySelector<HTMLElement>('.tab-slider');
        if (!slider) { return; }
        const active = document.querySelector<HTMLElement>('.tab-btn.active');
        if (!active) {
            slider.style.opacity = '0';
            slider.style.width = '0px';
            return;
        }
        slider.style.opacity = '1';
        slider.style.left = active.offsetLeft + 'px';
        slider.style.width = active.offsetWidth + 'px';
    }

    let tabScrolls: Record<string, number> = savedState.tabScrolls || {};
    let initialScrollRestoreTimer: ReturnType<typeof setTimeout> | null = null;
    let initialScrollRestoreCancelled = false;

    function cancelInitialScrollRestore(): void {
        initialScrollRestoreCancelled = true;
        cancelTrackedTimeout(initialScrollRestoreTimer);
        initialScrollRestoreTimer = null;
    }

    function scrollToAnchor(anchorId: string): void {
        if (!anchorId) { return; }
        cancelInitialScrollRestore();
        let el = byId(anchorId);
        if (anchorId === 'slot-activity' && (!el || el.hidden)) {
            el = byId('gm-recent-activity') || byId('slot-gm');
        }
        if (el && !el.hidden && typeof el.scrollIntoView === 'function') {
            const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const disclosure = el.closest('details.stg-group') as HTMLDetailsElement | null;
            if (disclosure) { disclosure.open = true; }
            const billingDay = anchorId === 'profileBillingDayInput';
            el.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: billingDay ? 'center' : 'start' });
            if (billingDay) { el.focus({ preventScroll: true }); }
            if (anchorId === 'settings-cdp-card' || anchorId === 'globalRulesCard' || anchorId === 'updatesSettingsCard' || anchorId === 'quotaNotifyInput') {
                el.classList.add('is-target-highlight');
                const heading = el.querySelector<HTMLElement>(disclosure === el ? 'summary' : 'h2, h3') || el;
                if (heading && typeof heading.focus === 'function') {
                    if (heading.tabIndex < 0 && !heading.hasAttribute('tabindex')) { heading.setAttribute('tabindex', '-1'); }
                    heading.focus({ preventScroll: true });
                }
                scheduleTimeout(() => { el?.classList.remove('is-target-highlight'); }, 1800);
            }
        }
    }

    let memberNavigation: { id: string; sourceTab: string; detailId: string; slow: boolean } | null = null;
    let inspectionOrigin: { tab: string; detailId: string } | null = null;
    let awaitingMemberExit = false;
    let memberNavigationTimer: ReturnType<typeof setTimeout> | null = null;
    function memberFeedback(message?: string): void {
        const detail = memberNavigation && byId(memberNavigation.detailId);
        const region = detail?.querySelector('.swarm-inspect-feedback');
        if (region && region.textContent !== (message || '')) { region.textContent = message || ''; }
        const cancel = detail?.querySelector<HTMLButtonElement>('[data-action="cancelMemberNavigation"]');
        if (cancel) { cancel.hidden = !memberNavigation || !message || message === a11yStrings.memberOpenFailed; }
    }
    function cancelMemberNavigation(): void {
        memberFeedback('');
        memberNavigation = null;
        cancelTrackedTimeout(memberNavigationTimer);
        memberNavigationTimer = null;
    }
    function finishMemberNavigation(): void {
        const banner = byId('swarm-inspection-banner');
        if (awaitingMemberExit && !banner) {
            awaitingMemberExit = false;
            const origin = inspectionOrigin;
            inspectionOrigin = null;
            if (origin && activeTab === 'overview') {
                const summary = byId(origin.detailId + '-toggle');
                switchTab(origin.tab, true, false, summary?.id);
                summary?.focus?.({ preventScroll: true });
            }
            announcePolite(a11yStrings.returnedToMain);
        }
        if (!memberNavigation || activeTab !== memberNavigation.sourceTab) { return; }
        if (banner?.getAttribute('data-inspected-member') !== memberNavigation.id) {
            memberFeedback(memberNavigation.slow ? a11yStrings.memberStillOpening : a11yStrings.memberOpening);
            return;
        }
        if (!inspectionOrigin || activeTab !== 'overview') {
            inspectionOrigin = { tab: memberNavigation.sourceTab, detailId: memberNavigation.detailId };
        }
        cancelMemberNavigation();
        switchTab('overview', true, false, 'swarm-inspection-banner');
        banner.focus?.({ preventScroll: true });
    }

    function switchTab(
        rawTabName: string | undefined,
        focusTab?: boolean,
        restoring?: boolean,
        explicitAnchor?: string,
    ): void {
        const route = resolveTargetRoute(rawTabName, explicitAnchor);
        if (!route) { return; }
        if (!restoring) { cancelInitialScrollRestore(); }
        const tabName = route.tab;
        const targetAnchor = route.anchor || '';
        const selectedMain = Array.from(tabBtns).find(button => button.dataset && button.dataset.tab === tabName) || null;
        const selectedUtil = Array.from(utilityBtns).find(button => button.getAttribute('data-utility-view') === tabName) || null;
        const targetPane = byId('tab-' + tabName);
        if (!selectedMain && !selectedUtil && !targetPane) { return; }

        const selectedControl = selectedMain || selectedUtil;
        if (!restoring && activeTab === tabName && activeAnchor === targetAnchor) {
            if (focusTab && selectedControl && typeof selectedControl.focus === 'function') {
                selectedControl.focus({ preventScroll: true });
            }
            if (targetAnchor) { scrollToAnchor(targetAnchor); }
            return;
        }

        const s = vscode.getState() || {};
        const ts = s.tabScrolls || {};
        if (!restoring) { ts[activeTab] = window.scrollY; }
        s.tabScrolls = ts;

        const prevTab = activeTab;
        if (prevTab !== tabName && memberNavigation) { cancelMemberNavigation(); }
        activeTab = tabName;
        activeAnchor = targetAnchor;
        if (document.body) {
            document.body.setAttribute('data-active-tab', tabName);
        }
        if (prevTab !== tabName) {
            hideRichTip(true);
        }

        for (let i = 0; i < tabBtns.length; i++) {
            const isSel = tabBtns[i] === selectedMain;
            tabBtns[i].classList.toggle('active', isSel);
            tabBtns[i].setAttribute('aria-selected', String(isSel));
            tabBtns[i].setAttribute('tabindex', isSel || (!selectedMain && i === 0) ? '0' : '-1');
            if (isSel) { tabBtns[i].setAttribute('aria-current', 'page'); }
            else { tabBtns[i].removeAttribute('aria-current'); }
        }
        for (let u = 0; u < utilityBtns.length; u++) {
            const isUtilSel = utilityBtns[u] === selectedUtil;
            utilityBtns[u].classList.toggle('active', isUtilSel);
            utilityBtns[u].setAttribute('aria-pressed', String(isUtilSel));
        }
        for (let j = 0; j < tabPanes.length; j++) {
            tabPanes[j].classList.toggle('active', tabPanes[j].id === 'tab-' + tabName);
        }

        s.activeTab = tabName;
        s.activeAnchor = targetAnchor;
        vscode.setState(s);

        syncNativeHudVisibility();

        if (selectedMain && typeof selectedMain.scrollIntoView === 'function') {
            try { selectedMain.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' }); } catch { /* ignore */ }
        }
        if (focusTab && selectedControl && typeof selectedControl.focus === 'function') {
            selectedControl.focus({ preventScroll: true });
        }

        updateTabSlider();

        if (!restoring && prevTab !== tabName) {
            const label = (selectedControl && (selectedControl.getAttribute('aria-label') || selectedControl.textContent || '').trim()) || tabName;
            announcePolite((a11yStrings.tabChanged || 'Switched view') + ': ' + label);
        }

        tabScrolls = ts;
        const targetY = ts[tabName] || 0;
        raf(() => {
            if (activeTab !== tabName) { return; }
            if (targetAnchor) {
                scrollToAnchor(targetAnchor);
            } else if (typeof window.scrollTo === 'function') {
                window.scrollTo(0, targetY);
            }
            updateTabSlider();
        });
    }

    // ─── Unified Body-Level Adaptive Popover Engine (#acmRichTipPopover) ───
    const RICH_TIP_SEL = '[data-tip-body], [data-tip-html-id], [data-tooltip]';
    const RICH_TIP_GRACE_MS = 180;
    let richTipActiveEl: HTMLElement | null = null;
    let richTipActiveKey = '';
    let richTipPinned = false;
    let restoringTipFocus = false;
    let richTipHideTimer: ReturnType<typeof setTimeout> | null = null;
    let richTipPointerInsidePop = false;
    let richTipPopBound = false;
    let zoomLevel = 100;

    function cancelRichTipHide(): void {
        if (richTipHideTimer !== null) {
            cancelTrackedTimeout(richTipHideTimer);
            richTipHideTimer = null;
        }
    }

    function hideRichTip(immediate?: boolean): void {
        cancelRichTipHide();
        if (!immediate && richTipPinned) { return; }
        const pop = byId('acmRichTipPopover');
        if (pop) {
            pop.hidden = true;
            pop.setAttribute('role', 'tooltip');
            pop.removeAttribute('aria-modal');
            pop.removeAttribute('aria-labelledby');
            pop.removeAttribute('tabindex');
            pop.setAttribute('data-pinned', 'false');
            pop.setAttribute('aria-hidden', 'true');
        }
        richTipActiveEl = null;
        richTipActiveKey = '';
        richTipPinned = false;
        richTipPointerInsidePop = false;
    }

    function focusAfterTipDismiss(el: HTMLElement): void {
        restoringTipFocus = true;
        try { el.focus({ preventScroll: true }); }
        finally { restoringTipFocus = false; }
    }

    function returnFocusAfterRichTipDismiss(prevEl: HTMLElement | null, prevKey: string): void {
        if (
            prevEl
            && (!document.body || !document.body.contains || document.body.contains(prevEl))
            && isRichTipElementVisibleInActiveContext(prevEl)
            && typeof prevEl.focus === 'function'
        ) {
            focusAfterTipDismiss(prevEl);
            return;
        }
        if (prevKey) {
            const replaced = findElementByPopoverKey(prevKey);
            if (replaced && typeof replaced.focus === 'function') {
                focusAfterTipDismiss(replaced);
                return;
            }
        }
        const activePane = byId('tab-' + activeTab) || document.querySelector<HTMLElement>('.tab-pane.active');
        if (activePane && typeof activePane.querySelector === 'function') {
            const heading = activePane.querySelector<HTMLElement>('[data-overview-focus="heading"], h2, h3');
            if (heading) {
                if (heading.tabIndex < 0 && !heading.hasAttribute('tabindex')) { heading.setAttribute('tabindex', '-1'); }
                if (typeof heading.focus === 'function') { focusAfterTipDismiss(heading); }
            }
        }
    }

    function scheduleRichTipHide(): void {
        cancelRichTipHide();
        if (richTipPinned) { return; }
        richTipHideTimer = scheduleTimeout(() => {
            richTipHideTimer = null;
            if (!richTipPinned && !richTipPointerInsidePop) {
                hideRichTip(true);
            }
        }, RICH_TIP_GRACE_MS);
    }

    function ensureRichTipEl(): HTMLElement | null {
        let pop = byId('acmRichTipPopover');
        if (!pop && document.body && typeof document.createElement === 'function') {
            pop = document.createElement('div');
            pop.id = 'acmRichTipPopover';
            pop.className = 'acm-rich-tip';
            pop.setAttribute('role', 'tooltip');
            pop.setAttribute('data-pinned', 'false');
            pop.setAttribute('data-placement', 'top');
            pop.setAttribute('aria-hidden', 'true');
            pop.hidden = true;
            const head = document.createElement('div');
            head.id = 'acmRichTipHead';
            head.className = 'acm-rich-tip-head';
            head.hidden = true;
            const titleEl = document.createElement('div');
            titleEl.id = 'acmRichTipTitle';
            titleEl.className = 'acm-rich-tip-title';
            const closeBtn = document.createElement('button');
            closeBtn.id = 'acmRichTipClose';
            closeBtn.type = 'button';
            closeBtn.className = 'acm-rich-tip-close';
            closeBtn.setAttribute('aria-label', strings.closeTipAriaText);
            closeBtn.textContent = '\u00d7';
            closeBtn.hidden = true;
            head.appendChild(titleEl);
            head.appendChild(closeBtn);
            const bodyEl = document.createElement('div');
            bodyEl.id = 'acmRichTipBody';
            bodyEl.className = 'acm-rich-tip-body';
            const metaEl = document.createElement('div');
            metaEl.id = 'acmRichTipMeta';
            metaEl.className = 'acm-rich-tip-meta';
            metaEl.hidden = true;
            pop.appendChild(head);
            pop.appendChild(bodyEl);
            pop.appendChild(metaEl);
            if (typeof document.body.appendChild === 'function') {
                document.body.appendChild(pop);
            }
        }
        if (pop && !richTipPopBound && typeof pop.addEventListener === 'function') {
            richTipPopBound = true;
            addTrackedListener(pop, 'mouseenter', () => {
                richTipPointerInsidePop = true;
                cancelRichTipHide();
            });
            addTrackedListener(pop, 'mouseleave', (ev: Event) => {
                const me = ev as MouseEvent;
                richTipPointerInsidePop = false;
                const rel = me && me.relatedTarget instanceof Element ? me.relatedTarget : null;
                if (!richTipPinned && (!rel || !richTipActiveEl || (rel !== richTipActiveEl && !(richTipActiveEl.contains && richTipActiveEl.contains(rel))))) {
                    scheduleRichTipHide();
                }
            });
        }
        return pop;
    }

    function suppressNativeTitle(el: Element | null): void {
        if (!el || typeof el.getAttribute !== 'function' || typeof el.removeAttribute !== 'function') { return; }
        const nativeTitle = el.getAttribute('title');
        if (nativeTitle) {
            el.setAttribute('data-suppressed-title', nativeTitle);
            el.removeAttribute('title');
        }
    }

    function extractRichTipData(el: Element | null): RichTipData | null {
        if (!el || typeof el.getAttribute !== 'function') { return null; }
        const title = el.getAttribute('data-tip-title') || el.getAttribute('data-tooltip-name') || '';
        const body = el.getAttribute('data-tip-body') || el.getAttribute('data-tooltip-desc') || el.getAttribute('data-tooltip') || '';
        const meta = el.getAttribute('data-tip-meta') || '';
        const htmlId = el.getAttribute('data-tip-html-id') || '';
        const key = el.getAttribute('data-popover-key') || '';
        if (!title && !body && !htmlId && !meta) { return null; }
        return { title, body, meta, htmlId, key };
    }

    function isClickPinnableRichTip(el: Element | null): boolean {
        if (!el || typeof el.getAttribute !== 'function') { return false; }
        if (el.getAttribute('data-tip-pin') === 'true') { return true; }
        if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-tip-html-id')) { return true; }
        if (el.classList && (el.classList.contains('jargon-tip') || el.classList.contains('rich-tip-disabled-wrap') || el.classList.contains('act-tl-help-btn'))) {
            return true;
        }
        if (el.classList && (el.classList.contains('ctx-seg-slice') || el.classList.contains('ctx-dot') || el.classList.contains('ctx-legend-item'))) {
            return false;
        }
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'SUMMARY') {
            return false;
        }
        const actionAttrs = [
            'data-action', 'data-overview-target', 'data-switch-tab', 'data-navigate-tab',
            'data-ctx-viz', 'data-cal-date', 'data-cal-nav', 'data-history-action',
            'data-summary-mode', 'data-copy-command', 'data-tab', 'data-lang', 'data-zoom',
            'data-history-filter', 'data-history-shortcut', 'data-mode',
        ];
        for (let ai = 0; ai < actionAttrs.length; ai++) {
            if (el.getAttribute(actionAttrs[ai])) { return false; }
        }
        const nonPinIds: Record<string, 1> = {
            pauseBtn: 1, refreshBtn: 1, topbarAboutBtn: 1,
            acctPopoverTrigger: 1, privacyToggle: 1,
            copyRawJson: 1, copyAllErrors: 1, pricingSaveBtn: 1, pricingResetBtn: 1,
            clearToolCatalogBtn: 1, profileBillingDaySaveBtn: 1, copyStatePath: 1,
            openStateFile: 1, revealStateFile: 1, restoreTabScrollHint: 1,
            modelStatsErrToggle: 1, calendarRetentionSaveBtn: 1, dismissTabScrollHint: 1,
            previewHandoffV2Btn: 1,
        };
        if (el.id && nonPinIds[el.id]) { return false; }
        if (el.classList && (
            el.classList.contains('acct-delete-btn') || el.classList.contains('cdp-copy-btn')
            || el.classList.contains('num-spinner-btn') || el.classList.contains('cal-cell')
            || el.classList.contains('cal-hm-cell')
        )) {
            return false;
        }
        return true;
    }

    function renderRichTipContent(pop: HTMLElement, data: RichTipData, pinned: boolean): void {
        const headEl = byId('acmRichTipHead') || (pop.querySelector ? pop.querySelector<HTMLElement>('.acm-rich-tip-head') : null);
        const titleEl = byId('acmRichTipTitle') || (pop.querySelector ? pop.querySelector<HTMLElement>('.acm-rich-tip-title') : null);
        const closeBtn = byId('acmRichTipClose') || (pop.querySelector ? pop.querySelector<HTMLElement>('.acm-rich-tip-close') : null);
        const bodyEl = byId('acmRichTipBody') || (pop.querySelector ? pop.querySelector<HTMLElement>('.acm-rich-tip-body') : null);
        const metaEl = byId('acmRichTipMeta') || (pop.querySelector ? pop.querySelector<HTMLElement>('.acm-rich-tip-meta') : null);

        const prevScrollTop = pop.scrollTop || 0;
        pop.setAttribute('data-pinned', pinned ? 'true' : 'false');
        if (pinned) {
            pop.setAttribute('role', 'dialog');
            pop.setAttribute('aria-modal', 'false');
            pop.setAttribute('tabindex', '-1');
            if (data.title) { pop.setAttribute('aria-labelledby', 'acmRichTipTitle'); }
            else { pop.removeAttribute('aria-labelledby'); }
        } else {
            pop.setAttribute('role', 'tooltip');
            pop.removeAttribute('aria-modal');
            pop.removeAttribute('aria-labelledby');
            pop.removeAttribute('tabindex');
        }
        if (headEl) { headEl.hidden = !(data.title || pinned); }
        if (titleEl) { titleEl.textContent = data.title || ''; }
        if (closeBtn) { closeBtn.hidden = !pinned; }

        if (bodyEl) {
            let renderedTpl = false;
            if (data.htmlId) {
                const tpl = byId(data.htmlId) as HTMLTemplateElement | null;
                if (tpl) {
                    bodyEl.textContent = '';
                    if (data.body && typeof document.createElement === 'function') {
                        const lead = document.createElement('p');
                        lead.className = 'acm-rich-tip-lead';
                        lead.textContent = data.body;
                        bodyEl.appendChild(lead);
                    }
                    if (tpl.content && typeof tpl.content.cloneNode === 'function' && typeof bodyEl.appendChild === 'function') {
                        bodyEl.appendChild(tpl.content.cloneNode(true));
                    } else if (typeof tpl.innerHTML === 'string') {
                        if (data.body) {
                            bodyEl.innerHTML = bodyEl.innerHTML + tpl.innerHTML;
                        } else {
                            bodyEl.innerHTML = tpl.innerHTML;
                        }
                    }
                    renderedTpl = true;
                }
            }
            if (!renderedTpl) {
                bodyEl.textContent = data.body || '';
            }
        }
        if (metaEl) {
            if (data.meta) {
                metaEl.textContent = data.meta;
                metaEl.hidden = false;
            } else {
                metaEl.textContent = '';
                metaEl.hidden = true;
            }
        }
        if (prevScrollTop > 0) {
            pop.scrollTop = prevScrollTop;
        }
    }

    function getEffectiveZoomFactor(): number {
        const bodyStyle = document.body && document.body.style ? (document.body.style as unknown as Record<string, string>) : null;
        const bodyZoomVal = bodyStyle && bodyStyle.zoom ? parseFloat(bodyStyle.zoom) : NaN;
        if (isFinite(bodyZoomVal) && bodyZoomVal > 0.2 && bodyZoomVal < 4) {
            return bodyZoomVal;
        }
        const z = (typeof zoomLevel === 'number' && isFinite(zoomLevel) && zoomLevel > 20)
            ? (zoomLevel / 100)
            : 1;
        return z > 0 ? z : 1;
    }

    function positionRichTip(): void {
        const pop = byId('acmRichTipPopover');
        if (!pop || pop.hidden || !richTipActiveEl || typeof richTipActiveEl.getBoundingClientRect !== 'function') {
            return;
        }
        const z = getEffectiveZoomFactor();
        const rawVpW = (typeof window !== 'undefined' && window.innerWidth)
            || (document.documentElement && document.documentElement.clientWidth)
            || 320;
        const rawVpH = (typeof window !== 'undefined' && window.innerHeight)
            || (document.documentElement && document.documentElement.clientHeight)
            || 600;
        const vpW = rawVpW / z;
        const vpH = rawVpH / z;
        const margin = 8;
        const gap = 8;

        const maxW = Math.max(140, Math.min(300, Math.floor(vpW - margin * 2)));
        const maxH = Math.max(110, Math.min(340, Math.floor(vpH - margin * 3)));
        pop.style.maxWidth = maxW + 'px';
        pop.style.maxHeight = maxH + 'px';

        const tr = richTipActiveEl.getBoundingClientRect();
        const tLeft = tr.left / z;
        const tRight = tr.right / z;
        const tTop = tr.top / z;
        const tBottom = tr.bottom / z;
        const tCenterX = (tLeft + tRight) / 2;

        const popRect = typeof pop.getBoundingClientRect === 'function' ? pop.getBoundingClientRect() : null;
        let popW = pop.offsetWidth || (popRect && popRect.width ? (popRect.width / z) : maxW);
        let popH = pop.offsetHeight || (popRect && popRect.height ? (popRect.height / z) : 72);
        if (popW > maxW) { popW = maxW; }
        if (popH > maxH) { popH = maxH; }

        const spaceAbove = tTop - margin;
        const spaceBelow = vpH - tBottom - margin;
        let placement = 'top';
        let topPos: number;
        if (spaceAbove >= popH + gap) {
            placement = 'top';
            topPos = tTop - popH - gap;
        } else if (spaceBelow >= popH + gap || spaceBelow >= spaceAbove) {
            placement = 'bottom';
            topPos = tBottom + gap;
        } else {
            placement = 'top';
            topPos = tTop - popH - gap;
        }
        const maxTop = Math.max(margin, vpH - popH - margin);
        if (topPos < margin) { topPos = margin; }
        if (topPos > maxTop) { topPos = maxTop; }

        let leftPos = tCenterX - (popW / 2);
        const maxLeft = Math.max(margin, vpW - popW - margin);
        if (leftPos < margin) { leftPos = margin; }
        if (leftPos > maxLeft) { leftPos = maxLeft; }

        pop.setAttribute('data-placement', placement);
        pop.style.left = Math.round(leftPos) + 'px';
        pop.style.top = Math.round(topPos) + 'px';
    }

    function showRichTip(el: HTMLElement, pinned: boolean, focusDialog?: boolean): void {
        const data = extractRichTipData(el);
        if (!data) { return; }
        const pop = ensureRichTipEl();
        if (!pop) { return; }
        cancelRichTipHide();
        suppressNativeTitle(el);
        richTipActiveEl = el;
        richTipActiveKey = data.key || '';
        richTipPinned = !!pinned;
        renderRichTipContent(pop, data, richTipPinned);
        pop.hidden = false;
        pop.setAttribute('aria-hidden', 'false');
        positionRichTip();
        if (richTipPinned && focusDialog) {
            const closeBtn = byId('acmRichTipClose') as HTMLElement | null;
            if (closeBtn && !closeBtn.hidden && typeof closeBtn.focus === 'function') {
                closeBtn.focus({ preventScroll: true });
            } else if (typeof pop.focus === 'function') {
                pop.focus({ preventScroll: true });
            }
        }
    }

    function isRichTipElementVisibleInActiveContext(el: Element | null): boolean {
        if (!el) { return false; }
        let cur: Element | null = el;
        while (cur && cur !== document.body) {
            if ((cur as HTMLElement).hidden === true) { return false; }
            if (cur.classList && cur.classList.contains('tab-pane') && !cur.classList.contains('active')) {
                return false;
            }
            cur = cur.parentElement;
        }
        return true;
    }

    function findElementByPopoverKey(key: string): HTMLElement | null {
        if (!key) { return null; }
        const all = document.querySelectorAll<HTMLElement>('[data-popover-key]');
        for (let ki = 0; ki < all.length; ki++) {
            if (all[ki].getAttribute('data-popover-key') === key) {
                if (isRichTipElementVisibleInActiveContext(all[ki])) {
                    return all[ki];
                }
            }
        }
        return null;
    }

    function reanchorRichTipPopover(): void {
        const pop = byId('acmRichTipPopover');
        if (!pop || pop.hidden) { return; }
        if (richTipActiveKey) {
            const nextEl = findElementByPopoverKey(richTipActiveKey);
            if (!nextEl) {
                hideRichTip(true);
                return;
            }
            suppressNativeTitle(nextEl);
            const nextData = extractRichTipData(nextEl);
            if (!nextData) {
                hideRichTip(true);
                return;
            }
            richTipActiveEl = nextEl;
            renderRichTipContent(pop, nextData, richTipPinned);
            positionRichTip();
            return;
        }
        if (richTipActiveEl && (!document.body || !document.body.contains || document.body.contains(richTipActiveEl)) && isRichTipElementVisibleInActiveContext(richTipActiveEl)) {
            const curData = extractRichTipData(richTipActiveEl);
            if (curData) {
                renderRichTipContent(pop, curData, richTipPinned);
                positionRichTip();
                return;
            }
        }
        hideRichTip(true);
    }

    // ─── Per-View Compact Language Engine (<= 480px CSS px, view-local ONLY, zero host mutation) ───
    function syncPerViewCompactLanguage(): void {
        if (!document.body) { return; }
        const bodyLang = document.body.getAttribute('data-lang') || 'both';
        const primaryLang = document.body.getAttribute('data-primary-lang') === 'zh' ? 'zh' : 'en';
        let nextViewLang = bodyLang;
        let isCompact = false;
        if (bodyLang === 'both') {
            const z = getEffectiveZoomFactor();
            const rawW = (typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth > 0)
                ? window.innerWidth
                : ((document.documentElement && document.documentElement.clientWidth) || 0);
            const cssW = rawW > 0 ? (rawW / z) : 0;
            if (cssW > 0 && cssW <= 480) {
                nextViewLang = primaryLang;
                isCompact = true;
            }
        }
        currentViewLang = nextViewLang;
        const documentLang = nextViewLang === 'zh' ? 'zh-CN' : 'en';
        if (document.documentElement && document.documentElement.lang !== documentLang) {
            document.documentElement.lang = documentLang;
        }
        if (document.body.getAttribute('data-view-lang') !== nextViewLang) {
            document.body.setAttribute('data-view-lang', nextViewLang);
        }
        const compactFlag = isCompact ? 'true' : 'false';
        if (document.body.getAttribute('data-compact-lang') !== compactFlag) {
            document.body.setAttribute('data-compact-lang', compactFlag);
        }
    }

    // Explicit deep link (URL or unconsumed data-initial-tab) beats saved tab state once;
    // on VS Code hide/reveal re-evaluation of the same HTML, honor savedState.activeTab instead.
    const urlDeepLink = readUrlDeepLink();
    const initialTabAttrVal = document.body ? document.body.getAttribute('data-initial-tab') : null;
    const initialAnchorAttrVal = document.body ? (document.body.getAttribute('data-initial-anchor') || '') : '';
    const initialToken = initialTabAttrVal ? (initialTabAttrVal + '|' + initialAnchorAttrVal) : '';
    const initialAlreadyConsumed = Boolean(initialToken && savedState.initialTabConsumed === initialToken);
    const initialAttrRoute = (initialTabAttrVal && !initialAlreadyConsumed)
        ? resolveTargetRoute(initialTabAttrVal, initialAnchorAttrVal)
        : null;
    const explicitDeepLink = urlDeepLink || initialAttrRoute;
    if (explicitDeepLink) {
        switchTab(explicitDeepLink.tab, false, true, explicitDeepLink.anchor);
        if (initialToken) {
            const stInit = vscode.getState() || {};
            stInit.initialTabConsumed = initialToken;
            vscode.setState(stInit);
            savedState = stInit;
        }
    } else if (savedState.activeTab) {
        switchTab(savedState.activeTab, false, true, typeof savedState.activeAnchor === 'string' ? savedState.activeAnchor : '');
    } else {
        syncNativeHudVisibility();
    }
    syncPerViewCompactLanguage();
    raf(() => { updateTabSlider(); });
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            if (!isMounted) { return; }
            updateTabSlider();
        });
    }
    const tabBarEl = document.querySelector<HTMLElement>('.tab-bar');
    if (typeof ResizeObserver !== 'undefined') {
        const viewRo = new ResizeObserver(() => {
            if (!isMounted) { return; }
            syncPerViewCompactLanguage();
            updateTabSlider();
        });
        if (tabBarEl) { viewRo.observe(tabBarEl); }
        if (document.documentElement) { viewRo.observe(document.documentElement); }
        cleanups.push(() => { viewRo.disconnect(); });
    }
    addTrackedListener(window, 'resize', () => {
        syncPerViewCompactLanguage();
        updateTabSlider();
    });
    addTrackedListener(window, 'hashchange', () => {
        const nextHashRoute = readUrlDeepLink();
        if (nextHashRoute) {
            switchTab(nextHashRoute.tab, false, false, nextHashRoute.anchor);
        }
    });

    for (let ui = 0; ui < utilityBtns.length; ui++) {
        const uBtn = utilityBtns[ui];
        addTrackedListener(uBtn, 'click', () => {
            const view = uBtn.getAttribute('data-utility-view');
            if (view) { switchTab(view, true, false); }
        });
    }

    // ─── Calendar: Restore expanded date after refresh ───
    const calSelectedDate = savedState.calendarSelectedDate || '';
    if (calSelectedDate) {
        const restorePanel = document.querySelector<HTMLElement>('[data-cal-detail="' + calSelectedDate + '"]');
        const restoreCell = document.querySelector<HTMLElement>('.cal-cell.has-data[data-cal-date="' + calSelectedDate + '"]');
        if (restorePanel) {
            restorePanel.style.display = 'block';
            restorePanel.style.animation = 'none';
            restorePanel.classList.add('cal-detail-open');
        }
        if (restoreCell) {
            restoreCell.classList.add('selected');
        }
    }
    for (let ti = 0; ti < tabBtns.length; ti++) {
        const btn = tabBtns[ti];
        addTrackedListener(btn, 'click', () => {
            switchTab(btn.dataset ? btn.dataset.tab : undefined);
        });
    }
    if (tabBarEl) {
        addTrackedListener(tabBarEl, 'keydown', (ev: Event) => {
            const event = ev as KeyboardEvent;
            const rawTarget = event.target as Element | null;
            const targetBtn = rawTarget && typeof rawTarget.closest === 'function' ? rawTarget.closest<HTMLElement>('.tab-btn') : (rawTarget as HTMLElement | null);
            let index = targetBtn ? Array.from(tabBtns).indexOf(targetBtn) : -1;
            if (index < 0) { return; }
            if (event.key === 'ArrowLeft') { index = (index - 1 + tabBtns.length) % tabBtns.length; }
            else if (event.key === 'ArrowRight') { index = (index + 1) % tabBtns.length; }
            else if (event.key === 'Home') { index = 0; }
            else if (event.key === 'End') { index = tabBtns.length - 1; }
            else { return; }
            event.preventDefault();
            tabBtns[index].focus();
        });
    }

    // ─── Account Popover Toggle ───
    let acctPopoverOpen = false;
    function toggleAccountPopover(forceClose?: boolean): void {
        const trigger = byId('acctPopoverTrigger');
        const dropdown = byId('acctPopoverPanel');
        if (!trigger || !dropdown) { return; }
        if (forceClose === true) {
            acctPopoverOpen = false;
        } else {
            acctPopoverOpen = !acctPopoverOpen;
        }
        trigger.classList.toggle('is-open', acctPopoverOpen);
        trigger.setAttribute('aria-expanded', String(acctPopoverOpen));
        if (acctPopoverOpen) {
            dropdown.hidden = false;
            raf(() => {
                dropdown.classList.add('is-visible');
            });
        } else {
            dropdown.classList.remove('is-visible');
            scheduleTimeout(() => {
                if (!acctPopoverOpen) { dropdown.hidden = true; }
            }, 200);
        }
    }
    const acctTriggerBtn = byId('acctPopoverTrigger');
    if (acctTriggerBtn) {
        addTrackedListener(acctTriggerBtn, 'click', (e: Event) => {
            e.stopPropagation();
            toggleAccountPopover();
        });
    }
    addTrackedListener(document, 'click', (e: Event) => {
        if (!acctPopoverOpen) { return; }
        const anchor = document.querySelector('.acct-popover-anchor');
        const ddPanel = byId('acctPopoverPanel');
        const target = e.target as Node | null;
        if (anchor && target && anchor.contains(target)) { return; }
        if (ddPanel && target && ddPanel.contains(target)) { return; }
        toggleAccountPopover(true);
    });
    addTrackedListener(document, 'keydown', (ev: Event) => {
        const e = ev as KeyboardEvent;
        if (e.key === 'Escape' && acctPopoverOpen) {
            toggleAccountPopover(true);
            if (acctTriggerBtn) { acctTriggerBtn.focus(); }
            e.stopPropagation();
        }
    });

    function restoreDetailsState(rootState: WebviewSavedState): void {
        const ds = (rootState && rootState.detailsOpen) || {};
        const dd = document.querySelectorAll<HTMLDetailsElement>('details[id]');
        for (let di = 0; di < dd.length; di++) {
            const det = dd[di];
            if (det.getAttribute('data-details-bound') === 'true') { continue; }
            const stateKey = (det.dataset && det.dataset.stateKey) || det.id;
            if (Object.prototype.hasOwnProperty.call(ds, stateKey)) {
                det.open = !!ds[stateKey];
            }
            det.addEventListener('toggle', function(this: HTMLDetailsElement) {
                if (this.isConnected === false) { return; }
                const s = vscode.getState() || {};
                const dso = s.detailsOpen || {};
                dso[(this.dataset && this.dataset.stateKey) || this.id] = this.open;
                s.detailsOpen = dso;
                vscode.setState(s);
            });
            det.setAttribute('data-details-bound', 'true');
        }
    }

    function bindHistoryCatalog(): void {
        const searchInput = byId('historySearchInput') as HTMLInputElement | null;
        const filterBtns = document.querySelectorAll<HTMLElement>('.ses-filter-btn');
        if (!searchInput && filterBtns.length === 0) { return; }

        const state = vscode.getState() || {};
        let activeFilter = state.historyFilter || 'all';
        if (searchInput) {
            searchInput.value = state.historySearch || '';
        }

        function applyHistoryFilters(): void {
            for (let fi = 0; fi < filterBtns.length; fi++) {
                const selected = filterBtns[fi].dataset.historyFilter === activeFilter;
                filterBtns[fi].classList.toggle('is-active', selected);
                filterBtns[fi].setAttribute('aria-pressed', String(selected));
            }
            const query = searchInput ? (searchInput.value || '').toLowerCase().trim() : '';
            const rows = document.querySelectorAll<HTMLElement>('[data-history-row="true"]');
            for (let ri = 0; ri < rows.length; ri++) {
                const row = rows[ri];
                const searchText = (row.getAttribute('data-search') || '').toLowerCase();
                const matchesSearch = !query || searchText.indexOf(query) !== -1;
                let matchesFilter = true;
                if (activeFilter === 'current') {
                    matchesFilter = row.getAttribute('data-current-workspace') === 'true';
                } else if (activeFilter === 'currentrepo') {
                    matchesFilter = row.getAttribute('data-current-repo') === 'true';
                } else if (activeFilter === 'running') {
                    matchesFilter = row.getAttribute('data-running') === 'true';
                } else if (activeFilter === 'recordable') {
                    matchesFilter = row.getAttribute('data-recordable') === 'true';
                }
                row.hidden = !(matchesSearch && matchesFilter);
            }

            const groups = document.querySelectorAll<HTMLElement>('.ses-group');
            for (let gi = 0; gi < groups.length; gi++) {
                const visibleRows = groups[gi].querySelectorAll('[data-history-row="true"]:not([hidden])');
                groups[gi].hidden = visibleRows.length === 0;
            }
        }

        if (searchInput && searchInput.getAttribute('data-history-bound') !== 'true') {
            searchInput.addEventListener('input', function(this: HTMLInputElement) {
                const s = vscode.getState() || {};
                s.historySearch = this.value || '';
                vscode.setState(s);
                applyHistoryFilters();
            });
            searchInput.setAttribute('data-history-bound', 'true');
        }

        for (let fi = 0; fi < filterBtns.length; fi++) {
            if (filterBtns[fi].getAttribute('data-history-bound') !== 'true') {
                filterBtns[fi].addEventListener('click', function(this: HTMLElement) {
                    activeFilter = this.dataset.historyFilter || 'all';
                    const s = vscode.getState() || {};
                    s.historyFilter = activeFilter;
                    vscode.setState(s);
                    applyHistoryFilters();
                });
                filterBtns[fi].setAttribute('data-history-bound', 'true');
            }
        }

        const shortcutBtns = document.querySelectorAll<HTMLElement>('[data-history-shortcut]');
        for (let si = 0; si < shortcutBtns.length; si++) {
            if (shortcutBtns[si].getAttribute('data-history-bound') !== 'true') {
                shortcutBtns[si].addEventListener('click', function(this: HTMLElement) {
                    activeFilter = this.dataset.historyShortcut || 'all';
                    const s = vscode.getState() || {};
                    s.historyFilter = activeFilter;
                    vscode.setState(s);
                    applyHistoryFilters();
                });
                shortcutBtns[si].setAttribute('data-history-bound', 'true');
            }
        }

        applyHistoryFilters();
    }
    bindHistoryCatalog();

    // Restore model stats error toggle state (default: hidden)
    if (savedState.modelStatsShowErrors) {
        const errToggle = byId('modelStatsErrToggle');
        if (errToggle) { errToggle.classList.remove('is-off'); }
        const cardsGrid = document.querySelector('.act-cards-grid');
        if (cardsGrid) { cardsGrid.classList.add('model-stats-show-errors'); }
    }

    // ─── Model Calls Anomaly Filter Bar (persists across incremental morphs) ───
    function applyGmAnomalyFilter(kind?: string): void {
        const st = vscode.getState() || {};
        const bar = document.querySelector<HTMLElement>('.gm-anomaly-bar, [data-gm-anomaly-bar]');
        const active = (kind !== undefined
            ? kind
            : (typeof st.gmAnomalyFilter === 'string' && st.gmAnomalyFilter
                ? st.gmAnomalyFilter
                : (bar && bar.getAttribute('data-active-anomaly-filter')) || 'all')) || 'all';
        const cards = document.querySelectorAll<HTMLElement>('.recent-calls-card');
        const scopes: Array<HTMLElement | Document> = cards.length > 0 ? Array.from(cards) : [document];
        for (let si = 0; si < scopes.length; si++) {
            const scope = scopes[si];
            const bars = scope.querySelectorAll<HTMLElement>('.gm-anomaly-bar, [data-gm-anomaly-bar]');
            for (let bi = 0; bi < bars.length; bi++) { bars[bi].setAttribute('data-active-anomaly-filter', active); }
            const pills = scope.querySelectorAll<HTMLElement>('[data-action="gmFilterAnomaly"]');
            for (let pi = 0; pi < pills.length; pi++) {
                const isAct = (pills[pi].getAttribute('data-anomaly-kind') || 'all') === active;
                pills[pi].classList.toggle('is-active', isAct);
                pills[pi].setAttribute('aria-pressed', isAct ? 'true' : 'false');
            }
            const rows = scope.querySelectorAll<HTMLElement>('tr[data-gm-anomalies]');
            for (let ri = 0; ri < rows.length; ri++) {
                const row = rows[ri];
                let vis = true;
                if (active === 'any') { vis = row.getAttribute('data-has-anomaly') === 'true'; }
                else if (active !== 'all') {
                    const raw = row.getAttribute('data-gm-anomalies') || '';
                    vis = raw ? raw.split(/[\s,]+/).indexOf(active) !== -1 : false;
                }
                row.hidden = !vis;
                if (vis) { row.removeAttribute('hidden'); } else { row.setAttribute('hidden', ''); }
            }
        }
    }
    applyGmAnomalyFilter();

    // ─── Scroll Shadow on TopBar ───
    const topbar = document.querySelector<HTMLElement>('.panel-topbar');
    if (topbar) {
        const syncTopbarHeight = () => {
            const h = topbar.offsetHeight;
            if (h > 0 && document.documentElement && document.documentElement.style && typeof document.documentElement.style.setProperty === 'function') {
                document.documentElement.style.setProperty('--acm-topbar-h', `${h}px`);
            }
        };
        addTrackedListener(window, 'scroll', () => {
            topbar.classList.toggle('scrolled', window.scrollY > 8);
        }, { passive: true });
        addTrackedListener(window, 'resize', syncTopbarHeight, { passive: true });
        topbar.classList.toggle('scrolled', window.scrollY > 8);
        syncTopbarHeight();
    }

    // ─── Settings: Polling Interval ───
    const pollingInput = byId('pollingInput') as HTMLInputElement | null;
    const pollingSaveBtn = byId('pollingSaveBtn');
    function savePollingInterval(): void {
        if (!pollingInput) { return; }
        const val = parseInt(pollingInput.value, 10);
        if (val >= 1 && val <= 60) {
            vscode.postMessage({ command: 'setPollingInterval', value: val });
            flashFeedback('pollingFeedback', strings.savedText, 2000);
        }
    }
    if (pollingSaveBtn && pollingInput) {
        addTrackedListener(pollingSaveBtn, 'click', savePollingInterval);
    }
    if (pollingInput) {
        addTrackedListener(pollingInput, 'change', savePollingInterval);
        addTrackedListener(pollingInput, 'keydown', (ev: Event) => {
            const e = ev as KeyboardEvent;
            if (e.key === 'Enter') { e.preventDefault(); savePollingInterval(); }
        });
    }

    // ─── Zoom Control ───
    const bodyZoom = document.body && document.body.dataset && document.body.dataset.zoom
        ? parseInt(document.body.dataset.zoom, 10)
        : 0;
    zoomLevel = bodyZoom || savedState.zoomLevel || 100;
    function applyZoom(level: number): void {
        zoomLevel = level;
        if (document.body && document.body.style) {
            (document.body.style as unknown as Record<string, string>).zoom = (level / 100).toString();
        }
        const valEl = byId('zoomValue');
        if (valEl) { valEl.textContent = level + '%'; }
        const rangeEl = byId('zoomRange') as HTMLInputElement | null;
        if (rangeEl) { rangeEl.value = String(level); }
        const presets = document.querySelectorAll<HTMLElement>('.zoom-preset');
        for (let zi = 0; zi < presets.length; zi++) {
            presets[zi].classList.toggle('is-active', parseInt(presets[zi].dataset.zoom || '', 10) === level);
        }
        const s = vscode.getState() || {};
        s.zoomLevel = level;
        vscode.setState(s);
        vscode.postMessage({ command: 'setZoomLevel', value: level });
        syncPerViewCompactLanguage();
        raf(() => {
            updateTabSlider();
            if (richTipActiveEl) {
                positionRichTip();
            }
        });
    }
    if (zoomLevel !== 100) { applyZoom(zoomLevel); }
    const zoomPresets = document.querySelectorAll<HTMLElement>('.zoom-preset');
    for (let zpi = 0; zpi < zoomPresets.length; zpi++) {
        const zp = zoomPresets[zpi];
        addTrackedListener(zp, 'click', () => {
            applyZoom(parseInt(zp.dataset.zoom || '100', 10));
        });
        if (parseInt(zp.dataset.zoom || '', 10) === zoomLevel) {
            zp.classList.add('is-active');
        }
    }
    const zoomRange = byId('zoomRange') as HTMLInputElement | null;
    if (zoomRange) {
        zoomRange.value = String(zoomLevel);
        addTrackedListener(zoomRange, 'input', () => {
            applyZoom(parseInt(zoomRange.value, 10));
        });
    }
    const zoomValEl = byId('zoomValue');
    if (zoomValEl) { zoomValEl.textContent = zoomLevel + '%'; }

    // ─── Settings: Status Bar Toggles ───
    const tooltipDensitySelect = byId('statusTooltipDensity') as HTMLSelectElement | null;
    if (tooltipDensitySelect) {
        addTrackedListener(tooltipDensitySelect, 'change', () => {
            vscode.postMessage({ command: 'setConfig', key: 'statusBar.tooltipDensity', value: tooltipDensitySelect.value });
        });
    }

    const toggleIds = ['toggleContext', 'toggleQuota', 'toggleCountdown', 'toggleAiCredits', 'toggleSpeed', 'toggleCacheHit', 'toggleSessionCost', 'toggleModelInternalId'];
    const toggleKeys = ['statusBar.showContext', 'statusBar.showQuota', 'statusBar.showResetCountdown', 'statusBar.showAiCredits', 'statusBar.showSpeed', 'statusBar.showCacheHit', 'statusBar.showSessionCost', 'showModelInternalId'];
    for (let tgi = 0; tgi < toggleIds.length; tgi++) {
        const idx = tgi;
        const cb = byId(toggleIds[idx]) as HTMLInputElement | null;
        if (cb) {
            addTrackedListener(cb, 'change', () => {
                vscode.postMessage({ command: 'setConfig', key: toggleKeys[idx], value: cb.checked });
            });
        }
    }
    const lockMainSettingsCb = byId('toggleLockMainAgent') as HTMLInputElement | null;
    if (lockMainSettingsCb) {
        addTrackedListener(lockMainSettingsCb, 'change', () => {
            const nextLocked = !!lockMainSettingsCb.checked;
            syncLockMainVisual(nextLocked);
            vscode.postMessage({ command: 'toggleLockMain', locked: nextLocked });
        });
    }

    // ─── Settings: Scrollbar & End-of-Content Toggles ───
    function applyScrollbarHide(hide: boolean): void {
        if (document.body) {
            document.body.setAttribute('data-hide-scrollbar', hide ? 'true' : 'false');
        }
        if (document.documentElement) {
            document.documentElement.setAttribute('data-hide-scrollbar', hide ? 'true' : 'false');
        }
        const dynId = 'ag-scrollbar-override';
        const existingStyle = byId(dynId);
        if (hide) {
            if (!existingStyle && document.head) {
                const s = document.createElement('style');
                s.id = dynId;
                s.textContent = 'html, body, * { scrollbar-width: none !important; } ' +
                    '::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }';
                document.head.appendChild(s);
            }
        } else {
            if (existingStyle) { existingStyle.remove(); }
        }
    }
    if (document.body && document.body.getAttribute('data-hide-scrollbar') === 'true') {
        applyScrollbarHide(true);
    }
    const scrollbarCb = byId('toggleScrollbar') as HTMLInputElement | null;
    if (scrollbarCb) {
        addTrackedListener(scrollbarCb, 'change', () => {
            applyScrollbarHide(!scrollbarCb.checked);
            vscode.postMessage({ command: 'setPanelPref', key: 'panelShowScrollbar', value: scrollbarCb.checked });
        });
    }
    const eocCb = byId('toggleEndOfContent') as HTMLInputElement | null;
    if (eocCb) {
        addTrackedListener(eocCb, 'change', () => {
            if (document.body) {
                document.body.setAttribute('data-hide-eoc', eocCb.checked ? 'false' : 'true');
            }
            vscode.postMessage({ command: 'setPanelPref', key: 'panelShowEndOfContent', value: eocCb.checked });
        });
    }

    // ─── Language Switcher ───
    const switcher = document.querySelector('.lang-switcher');
    if (switcher) {
        addTrackedListener(switcher, 'click', (e: Event) => {
            const rawTarget = e.target as Node | null;
            const target = rawTarget instanceof Element
                ? rawTarget
                : (rawTarget && rawTarget.parentElement ? rawTarget.parentElement : null);
            const btn = target && typeof target.closest === 'function' ? target.closest<HTMLElement>('.lang-btn') : null;
            if (btn && btn.dataset && btn.dataset.lang) {
                vscode.postMessage({ command: 'switchLanguage', lang: btn.dataset.lang });
            }
        });
    }

    // ─── Pause & Refresh Buttons ───
    const pauseBtn = byId('pauseBtn');
    if (pauseBtn) {
        addTrackedListener(pauseBtn, 'click', () => {
            vscode.postMessage({ command: 'togglePause' });
        });
    }

    const refreshBtn = byId('refreshBtn');
    let _refreshSpinTimer: ReturnType<typeof setTimeout> | null = null;
    if (refreshBtn) {
        addTrackedListener(refreshBtn, 'click', () => {
            refreshBtn.classList.remove('spinning');
            void refreshBtn.offsetWidth;
            refreshBtn.classList.add('spinning');
            cancelTrackedTimeout(_refreshSpinTimer);
            _refreshSpinTimer = scheduleTimeout(() => { refreshBtn.classList.remove('spinning'); }, 650);
            vscode.postMessage({ command: 'refresh' });
        });
    }

    // ─── Fail-Closed Privacy Mask State & Cache Purge (Wave 1B SEC-04) ───
    let lastMastheadHtml = (() => {
        const mh = byId('mastheadContextBar');
        return mh ? mh.innerHTML : '';
    })();
    let lastNativeHudHtml = (() => {
        const nh = byId('nativeHudHost');
        return nh ? nh.innerHTML : '';
    })();
    let lastAccountPopoverHtml = (() => {
        const pb = byId('acctPopoverBody');
        return pb ? pb.innerHTML : '';
    })();
    const emptyAccountPopoverHtml = strings.emptyAccountPopoverHtml;
    let lastHandledSnapshotRef: unknown = null;

    const privacyDefault = document.body ? document.body.getAttribute('data-privacy-default') !== 'false' : true;
    function setPrivacyMaskLocalState(masked: boolean): void {
        const boolMasked = !!masked;
        if (document.body) {
            document.body.setAttribute('data-privacy-masked', String(boolMasked));
        }
        const pState = vscode.getState() || {};
        pState.privacyMasked = boolMasked;
        vscode.setState(pState);
        savedState = pState;
    }
    // Authoritative host fail-closed sync at startup
    (() => {
        const bodyAttr = document.body ? document.body.getAttribute('data-privacy-masked') : null;
        if (bodyAttr === 'true' || bodyAttr === 'false') {
            setPrivacyMaskLocalState(bodyAttr === 'true');
        }
    })();

    function isAccountMasked(): boolean {
        const bodyAttr = document.body ? document.body.getAttribute('data-privacy-masked') : null;
        if (bodyAttr === 'true' || bodyAttr === 'false') { return bodyAttr === 'true'; }
        const state = vscode.getState() || {};
        if (state.privacyMasked !== undefined) { return !!state.privacyMasked; }
        return privacyDefault;
    }

    let appOnboardingDismissedLocal = false;
    const attrBool = (el: Element | null, k: string, v: boolean): void => { el?.setAttribute(k, String(v)); };

    function syncAppOnboardingBannerUi(o?: { dismissed?: boolean; cdpState?: string; topBarOn?: boolean; composerOn?: boolean; launcherInstalled?: boolean }): void {
        if (typeof o?.dismissed === 'boolean') { appOnboardingDismissedLocal = o.dismissed; }
        const st = typeof o?.cdpState === 'string' ? o.cdpState : (byId('cdpStatusPill')?.getAttribute('data-cdp-state') || '');
        const on = (o?.topBarOn ?? !!(byId('toggleAppTopBar') as HTMLInputElement | null)?.checked)
            || (o?.composerOn ?? !!(byId('toggleAppComposerRing') as HTMLInputElement | null)?.checked);
        const b = byId('appOnboardingBanner');
        if (b) {
            if (appOnboardingDismissedLocal || (st === 'connected' && on)) { b.hidden = true; }
            else if (o?.dismissed === false) { b.hidden = false; }
            const sb = byId('onboardingSetupCdpBtn');
            if (sb && bridge && bridge.surface === 'standalone') { sb.hidden = true; }
            if (typeof o?.launcherInstalled === 'boolean') {
                attrBool(b, 'data-launcher-installed', o.launcherInstalled);
                setBtnLabel(sb, o.launcherInstalled ? strings.cdpLauncherRecreateBtnText : strings.cdpLauncherCreateBtnText);
            }
        }
        const rb = byId('settingsResetOnboardingBtn');
        if (rb) { rb.hidden = !(appOnboardingDismissedLocal && st !== 'connected'); }
    }
    if (bridge && bridge.surface === 'standalone') {
        const initOnbSetup = byId('onboardingSetupCdpBtn');
        if (initOnbSetup) { initOnbSetup.hidden = true; }
    }

    const isStandaloneBlockedError = (p: Record<string, unknown> | null | undefined, err?: unknown): boolean =>
        p?.status === 403
        || /^(?:STANDALONE_)?FORBIDDEN$|^HTTP_403$/.test(String(p?.errorCode || ''))
        || /403|standalone|forbidden/i.test(String(p?.error || (err instanceof Error ? err.message : err) || ''));

    const extraStrings = strings as unknown as Record<string, string | undefined>;
    const grInvalidPathLbl = extraStrings.grInvalidPathText || 'Invalid Path';
    const grTooLargePillLbl = extraStrings.grTooLargePillText || 'Too Large';
    const grSymlinkErrLbl = extraStrings.grSymlinkErrorText || strings.grFailedText;

    const initGrCard = byId('globalRulesCard');
    let globalRulesLoaded = initGrCard?.getAttribute('data-gr-loaded') === 'true';
    let globalRulesExists = initGrCard?.getAttribute('data-gr-exists') === 'true';
    let globalRulesTooLarge = initGrCard?.getAttribute('data-gr-too-large') === 'true';
    let globalRulesErr = byId('globalRulesState')?.getAttribute('data-gr-error') || '';

    function applyGlobalRulesUiState(o: { path?: string; exists?: boolean; sizeBytes?: number; tooLarge?: boolean; error?: string; loaded?: boolean; content?: string; setEditorValue?: boolean }): void {
        const prevExists = globalRulesExists;
        if (typeof o.exists === 'boolean') { globalRulesExists = o.exists; }
        if (typeof o.tooLarge === 'boolean') { globalRulesTooLarge = o.tooLarge; }
        if (typeof o.loaded === 'boolean') {
            globalRulesLoaded = o.loaded;
        } else if (!prevExists && globalRulesExists) {
            // File appeared externally or via Open File before content was loaded: lock Save so it can never wipe GEMINI.md.
            globalRulesLoaded = false;
        }
        if (o.error !== undefined) { globalRulesErr = o.error || ''; }
        const isSymlinkErr = globalRulesErr === 'SYMLINK_ESCAPE';
        const hasErr = Boolean(globalRulesErr);
        const blocked = globalRulesTooLarge || isSymlinkErr;
        const card = byId('globalRulesCard');
        if (card) {
            attrBool(card, 'data-gr-loaded', globalRulesLoaded);
            attrBool(card, 'data-gr-exists', globalRulesExists);
            attrBool(card, 'data-gr-too-large', globalRulesTooLarge);
        }
        const pe = byId('globalRulesPathText');
        if (pe) {
            pe.textContent = isAccountMasked()
                ? (pe.getAttribute('data-masked-path') || '~/.gemini/GEMINI.md')
                : (o.path?.trim() || pe.textContent || '~/.gemini/GEMINI.md');
        }
        const se = byId('globalRulesState');
        if (se) {
            const ready = globalRulesExists && !blocked && !hasErr;
            attrBool(se, 'data-gr-exists', globalRulesExists);
            attrBool(se, 'data-gr-too-large', globalRulesTooLarge);
            if (hasErr) { se.setAttribute('data-gr-error', globalRulesErr); } else { se.removeAttribute('data-gr-error'); }
            se.classList.toggle('is-ready', ready);
            se.classList.toggle('is-missing', !ready);
            const stateLbl = hasErr ? grInvalidPathLbl
                : globalRulesTooLarge ? grTooLargePillLbl
                    : (globalRulesExists ? strings.aboutReadyText : strings.grMissingText);
            setBtnLabel(se, stateLbl);
        }
        const sz = byId('globalRulesSizeVal');
        if (sz && typeof o.sizeBytes === 'number' && isFinite(o.sizeBytes)) {
            const n = Math.max(0, o.sizeBytes);
            sz.textContent = n < 1024 ? (Math.round(n) + ' B') : ((n / 1024).toFixed(1).replace(/\.0$/, '') + ' KB');
        }
        const ed = byId('globalRulesEditor') as HTMLTextAreaElement | null;
        if (ed) {
            if (o.setEditorValue) { ed.value = o.content || ''; }
            ed.disabled = blocked;
            ed.readOnly = !globalRulesLoaded && globalRulesExists && !blocked;
            ed.placeholder = isSymlinkErr ? grSymlinkErrLbl
                : globalRulesTooLarge ? strings.grTooLargeText
                    : ((!globalRulesLoaded && globalRulesExists) ? strings.grUnloadedPlaceholderText : strings.grEditablePlaceholderText);
        }
        const rb = byId('globalRulesReloadBtn') as HTMLButtonElement | null;
        if (rb) {
            const needsLoad = globalRulesExists && !globalRulesLoaded && !blocked;
            rb.classList.toggle('stg-btn-primary', needsLoad);
            setBtnLabel(rb, needsLoad ? strings.grLoadEditBtnText : strings.grReloadBtnText);
        }
        const sb = byId('globalRulesSaveBtn') as HTMLButtonElement | null;
        if (sb) {
            const canSave = !blocked && !hasErr && (!globalRulesExists || globalRulesLoaded);
            sb.disabled = !canSave;
            attrBool(sb, 'aria-disabled', !canSave);
            sb.classList.toggle('stg-btn-primary', canSave);
            if (!canSave) { sb.setAttribute('data-gr-save-locked', 'true'); } else { sb.removeAttribute('data-gr-save-locked'); }
        }
    }

    function setGlobalRulesBusy(busy: boolean): void {
        for (const id of ['globalRulesReloadBtn', 'globalRulesOpenBtn', 'globalRulesRevealBtn']) {
            const b = byId(id) as HTMLButtonElement | null;
            if (b) { b.disabled = busy; }
        }
        const sb = byId('globalRulesSaveBtn') as HTMLButtonElement | null;
        if (sb) { if (busy) { sb.disabled = true; } else { applyGlobalRulesUiState({}); } }
    }

    function handleGlobalRulesReply(kind: 'read' | 'save' | 'action', p: Record<string, unknown> | null, fallbackAct?: string): void {
        setGlobalRulesBusy(false);
        if (!p || isStandaloneBlockedError(p)) {
            flashFeedback('globalRulesFeedback', p ? strings.grStandaloneBlockedText : strings.grFailedText, 4500);
            return;
        }
        const path = typeof p.path === 'string' ? p.path : undefined;
        const sizeBytes = typeof p.sizeBytes === 'number' ? p.sizeBytes : undefined;
        const isSymlink = p.errorCode === 'SYMLINK_ESCAPE' || p.error === 'SYMLINK_ESCAPE';
        if (kind === 'read') {
            const ok = !p.tooLarge && !isSymlink && p.ok !== false && !p.error;
            applyGlobalRulesUiState({
                path, sizeBytes,
                exists: typeof p.exists === 'boolean' ? p.exists : globalRulesExists,
                tooLarge: !!p.tooLarge,
                error: ok ? '' : (isSymlink ? 'SYMLINK_ESCAPE' : String(p.errorCode || p.error || (p.tooLarge ? '' : 'READ_FAILED'))),
                loaded: ok,
                setEditorValue: ok || !!p.tooLarge || isSymlink,
                content: ok && typeof p.content === 'string' ? p.content : '',
            });
            const readMsg = isSymlink ? grSymlinkErrLbl : (p.tooLarge ? strings.grTooLargeText : (ok ? strings.grLoadedText : String(p.error || strings.grFailedText)));
            flashFeedback('globalRulesFeedback', readMsg, ok ? 2500 : 4500);
        } else if (kind === 'save') {
            const isAlreadyExists = p.errorCode === 'ALREADY_EXISTS';
            const saveFailed = p.ok === false || isSymlink || Boolean(p.tooLarge);
            const msg = saveFailed ? (isSymlink ? grSymlinkErrLbl : (p.tooLarge ? strings.grTooLargeText : String(p.error || strings.grFailedText))) : strings.savedText;
            if (!saveFailed) {
                applyGlobalRulesUiState({ path, exists: typeof p.exists === 'boolean' ? p.exists : true, sizeBytes, tooLarge: false, error: '', loaded: true });
            } else if (isAlreadyExists) {
                applyGlobalRulesUiState({ path, exists: true, sizeBytes, tooLarge: false, error: '', loaded: false });
            } else if (isSymlink || p.tooLarge) {
                applyGlobalRulesUiState({ path, sizeBytes, tooLarge: !!p.tooLarge, error: isSymlink ? 'SYMLINK_ESCAPE' : '', loaded: false });
            }
            flashFeedback('globalRulesFeedback', msg, saveFailed ? 4500 : 2800);
            announcePolite(saveFailed ? msg : (a11yStrings.settingsSaved || msg));
        } else {
            const rev = (typeof p.action === 'string' ? p.action : fallbackAct) === 'reveal';
            const actionOk = p.ok === true || (p.ok !== false && !p.error && !p.errorCode && p.opened !== false && p.revealed !== false);
            if (typeof p.exists === 'boolean' || typeof p.sizeBytes === 'number' || typeof p.tooLarge === 'boolean' || path || isSymlink) {
                applyGlobalRulesUiState({
                    path, sizeBytes,
                    exists: typeof p.exists === 'boolean' ? p.exists : undefined,
                    tooLarge: typeof p.tooLarge === 'boolean' ? p.tooLarge : undefined,
                    error: isSymlink ? 'SYMLINK_ESCAPE' : (actionOk ? '' : (typeof p.errorCode === 'string' ? p.errorCode : undefined)),
                    setEditorValue: false,
                });
            }
            const errText = isSymlink ? grSymlinkErrLbl : String(p.error || (rev ? strings.revealFailedText : strings.openFailedText));
            flashFeedback('globalRulesFeedback', actionOk ? (rev ? strings.revealedText : strings.openedText) : errText, 3500);
        }
    }

    let handoffPreviewSeq = 0;
    let handoffPreviewPendingSeq = 0;
    let handoffPreviewPendingSubject = '';

    function applyHandoffV2Result(p: Record<string, unknown> | null, trig?: Element | null, focusTa?: boolean, expectedSeq?: number, requestedSubject?: string): void {
        if (expectedSeq !== undefined && expectedSeq !== handoffPreviewSeq) { return; }
        if (expectedSeq !== undefined && expectedSeq === handoffPreviewPendingSeq) { handoffPreviewPendingSeq = 0; }
        const box = byId('handoffV2PreviewBox');
        const ta = byId('handoffV2PreviewText') as HTMLTextAreaElement | null;
        if (!box || !ta) { return; }
        const curSubject = box.getAttribute('data-subject-cascade-id') || '';
        const respSubject = typeof p?.subjectCascadeId === 'string' ? p.subjectCascadeId : '';
        if (curSubject && ((requestedSubject && curSubject !== requestedSubject) || (respSubject && curSubject !== respSubject))) {
            return;
        }
        const cb = box.querySelector<HTMLButtonElement>('[data-action="copyHandoffPreviewText"]');
        const stale = !!(p && (p.revisionMismatch === true || p.status === 409));
        if (respSubject) { box.setAttribute('data-subject-cascade-id', respSubject); }
        if (typeof p?.dataRevision === 'number') {
            const rev = String(p.dataRevision);
            box.setAttribute('data-data-revision', rev);
            (trig || byId('previewHandoffV2Btn'))?.setAttribute('data-data-revision', rev);
        }
        const md = (typeof p?.markdown === 'string' && p.markdown) || (typeof p?.text === 'string' && p.text) || '';
        const failed = stale || !p || p.ok === false || !md;
        ta.value = stale ? strings.handoffStaleRevisionText : (failed ? String(p?.error || a11yStrings.handoffFailed || 'Failed') : md);
        if (cb) {
            cb.disabled = failed;
            if (stale) { cb.setAttribute('data-handoff-stale', 'true'); } else { cb.removeAttribute('data-handoff-stale'); }
        }
        box.hidden = false;
        if (focusTa) { ta.focus?.({ preventScroll: true }); }
    }

    let privacyOpSeq = 0;
    let privacyRemaskState: '' | 'pending' | 'error' = '';

    function renderPrivacyRemaskPlaceholder(isError: boolean): void {
        privacyRemaskState = isError ? 'error' : 'pending';
        const hosts = new Set<HTMLElement>();
        const ov = byId('tab-overview');
        if (ov) { hosts.add(ov); }
        const ab = byId('tab-about');
        if (ab) { hosts.add(ab); }
        for (const s of Array.from(document.querySelectorAll<HTMLElement>('[data-tab-slot]'))) {
            hosts.add(s);
        }
        hosts.forEach((host) => {
            host.textContent = '';
            const box = document.createElement('div');
            box.className = 'privacy-remask-placeholder';
            box.setAttribute('data-privacy-remask-state', isError ? 'error' : 'pending');
            box.setAttribute('role', isError ? 'alert' : 'status');
            const sp = document.createElement('span');
            sp.textContent = isError ? strings.privacyRemaskFailedText : strings.privacyRemaskingText;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'action-btn' + (isError ? ' stg-btn-primary' : '');
            btn.setAttribute('data-action', 'retryPrivacyRemask');
            btn.textContent = strings.privacyRetryBtnText;
            box.appendChild(sp);
            box.appendChild(btn);
            host.appendChild(box);
        });
    }

    function sendPrivacyMaskUpdate(masked: boolean): void {
        const seq = ++privacyOpSeq;
        if (!masked) { privacyRemaskState = ''; }
        sendBridgeOrPost(
            { command: 'setPrivacyMask', masked, privacyMasked: masked },
            (p) => { if (masked && seq === privacyOpSeq && isAccountMasked() && p && p.ok === false) { renderPrivacyRemaskPlaceholder(true); } },
            () => { if (masked && seq === privacyOpSeq && isAccountMasked()) { renderPrivacyRemaskPlaceholder(true); } },
        );
    }

    function purgeRevealedPrivacyData(): void {
        lastHandledSnapshotRef = null;
        for (const key in lastTabHtmls) {
            if (Object.prototype.hasOwnProperty.call(lastTabHtmls, key)) { delete lastTabHtmls[key]; }
        }
        lastMastheadHtml = '';
        lastNativeHudHtml = '';
        lastAccountPopoverHtml = '';
        if (bridge && typeof bridge.clearClientCaches === 'function') { try { bridge.clearClientCaches(); } catch { /* ignore */ } }
        try { hideRichTip(true); } catch { /* ignore */ }
        for (const mn of Array.from(document.querySelectorAll('[data-masked]'))) {
            mn.textContent = mn.getAttribute('data-masked') || '\u2022\u2022\u2022';
            mn.removeAttribute('data-real');
        }
        for (const sn of Array.from(document.querySelectorAll('[data-privacy-sensitive], .acct-email, .profile-email, .acct-name, .profile-name, .acct-popover-email, .acct-popover-name, .chat-workspace-path'))) {
            sn.textContent = sn.getAttribute('data-masked') || '\u2022\u2022\u2022';
            sn.removeAttribute('data-real');
            sn.removeAttribute('data-email');
        }
        for (const en of Array.from(document.querySelectorAll('[data-email]'))) { en.removeAttribute('data-email'); }
        const rawJsonEl = byId('rawJsonContent');
        if (rawJsonEl) { rawJsonEl.textContent = ''; }
        applyGlobalRulesUiState({
            path: '~/.gemini/GEMINI.md',
            loaded: !globalRulesExists && !globalRulesTooLarge && !globalRulesErr,
            setEditorValue: true,
            content: '',
        });
        const slots = document.querySelectorAll(
            '[data-tab-slot], #tab-overview, #tab-about, #mastheadContextBar, #nativeHudHost, '
            + '#acmRichTipBody, #acmRichTipMeta, #acmRichTipTitle, #acmLiveRegion, '
            + '.storage-path-text:not(#globalRulesPathText), #cdpLauncherNote, #cdpDiagnosticHint, #tab-settings [role="status"].threshold-feedback',
        );
        for (const el of Array.from(slots)) { el.innerHTML = ''; }
        const launcher = byId('cdpLauncherStatus');
        if (launcher) { launcher.removeAttribute('data-launcher-path'); launcher.innerHTML = ''; }
        byId('cdpStatusPill')?.removeAttribute('data-tip-body');
        const popBody = byId('acctPopoverBody');
        if (popBody && typeof emptyAccountPopoverHtml === 'string') { popBody.innerHTML = emptyAccountPopoverHtml; }
        renderPrivacyRemaskPlaceholder(false);
    }

    function applyPrivacyMask(): void {
        const masked = isAccountMasked();
        if (document.body) {
            document.body.setAttribute('data-privacy-masked', String(masked));
        }
        if (masked) {
            const nodes = document.querySelectorAll('[data-masked]');
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                node.textContent = node.getAttribute('data-masked') || '\u2022\u2022\u2022';
                if (typeof node.removeAttribute === 'function') { node.removeAttribute('data-real'); }
            }
        }
        const button = byId('privacyToggle');
        if (button) {
            button.classList.toggle('active', masked);
            button.setAttribute('aria-pressed', String(masked));
        }
    }
    applyPrivacyMask();
    applyContextVizMode(getContextVizMode());
    applyNativeHudExpanded(getNativeHudExpanded());

    // ─── Listen for setPaused & control messages from verified host/bridge ───
    addTrackedListener(window, 'message', (ev: Event) => {
        const event = ev as MessageEvent;
        const msg = extractTrustedHostMessage(event);
        if (!msg) { return; }
        if (msg.command === 'privacyMaskState' || msg.command === 'privacyMaskUpdated') {
            const hostMasked = typeof msg.masked === 'boolean'
                ? msg.masked
                : (typeof msg.privacyMasked === 'boolean' ? msg.privacyMasked : isAccountMasked());
            const prevMasked = isAccountMasked();
            setPrivacyMaskLocalState(hostMasked);
            if (hostMasked && !prevMasked) {
                purgeRevealedPrivacyData();
            }
            applyPrivacyMask();
            return;
        }
        if (msg.command === 'setPaused' && pauseBtn) {
            const paused = !!msg.paused;
            pauseBtn.classList.toggle('paused', paused);
            const pauseLabel = pauseBtn.getAttribute(paused ? 'data-label-resume' : 'data-label-pause') || '';
            const pauseTipBody = pauseBtn.getAttribute(paused ? 'data-tip-body-resume' : 'data-tip-body-pause') || pauseLabel;
            pauseBtn.setAttribute('data-tip-title', pauseLabel);
            pauseBtn.setAttribute('data-tip-body', pauseTipBody);
            pauseBtn.removeAttribute('data-tooltip');
            pauseBtn.setAttribute('aria-label', pauseLabel);
            pauseBtn.setAttribute('aria-pressed', String(paused));
            reanchorRichTipPopover();
            const pauseIcon = pauseBtn.querySelector('svg');
            if (pauseIcon) {
                pauseIcon.innerHTML = paused
                    ? '<path fill="currentColor" d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>'
                    : '<path fill="currentColor" d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>';
            }
            const updateTime = document.querySelector('.update-time');
            if (updateTime) {
                let pauseIndicator = updateTime.querySelector('.paused-indicator');
                if (paused && !pauseIndicator) {
                    pauseIndicator = document.createElement('span');
                    pauseIndicator.className = 'paused-indicator';
                    pauseIndicator.textContent = pauseBtn.getAttribute('data-label-paused') || '';
                    updateTime.insertBefore(pauseIndicator, updateTime.firstChild);
                } else if (!paused && pauseIndicator) {
                    pauseIndicator.remove();
                }
            }
            announcePolite(paused ? a11yStrings.panelFrozen : a11yStrings.panelResumed);
        }
        if (msg.command === 'panelPrefUpdated' && msg.key === 'panelShowTabScrollHint') {
            setTabHintState(!!msg.value);
        }
        if (msg.command === 'panelPrefUpdated' && msg.key === 'panelShowScrollbar') {
            applyScrollbarHide(!msg.value);
        }
        if (msg.command === 'panelPrefUpdated' && msg.key === 'panelShowEndOfContent' && document.body) {
            document.body.setAttribute('data-hide-eoc', msg.value ? 'false' : 'true');
        }
        if (msg.command === 'configSaved' || msg.command === 'configSaveFailed') {
            const failed = msg.command === 'configSaveFailed' || msg.ok === false;
            const fbGroups = 'polling:pollingInterval|quotaNotify:quotaNotificationThreshold|statePath:statePath|panelHint:panelShowTabScrollHint|appOverlays:appComposerRingEnabled,appTopBarEnabled,showNativeHudBar,appShowNativeHudBar,ideShowNativeHudBar,nativeHudAutoHideOnOverview,cdpOverlayFontSize,cdpOverlayHighContrast|languagePreference:languagePreference|telemetryMetrics:contextPctBasis,speedMetricMode,quotaWindowMode,quotaDirectionMode|updates:autoCheckUpdates|orchPricingMode:orchestratorPricingMode|customFxRate:displayCurrency,customFxRate|subscription:subscriptionPlan,subscriptionMonthlyFee,subscriptionCurrency|calendarRetention:calendarRetentionDays|activityMaxRecentSteps:activityMaxRecentSteps|activityMaxArchives:activityMaxArchives';
            let fbId: string | undefined;
            if (typeof msg.key === 'string') {
                for (const g of fbGroups.split('|')) {
                    const [pfx, keys] = g.split(':');
                    if (keys.split(',').indexOf(msg.key) >= 0) { fbId = pfx + 'Feedback'; break; }
                }
            }
            if (msg.key === 'accountBillingDay') {
                flashProfileBillingFeedback(failed ? strings.invalidBillingDayText : '\u2713', failed);
            }
            if (fbId) {
                flashFeedback(fbId, failed ? (String(msg.error || '') || a11yStrings.settingsSaveFailed || 'Error') : '\u2713', 2400);
            }
            announcePolite(failed ? (a11yStrings.settingsSaveFailed || 'Failed to save settings') : (a11yStrings.settingsSaved || 'Settings saved'));
        }
        if (msg.command === 'handoffV2PreviewResult') {
            if (handoffPreviewPendingSeq > 0 && handoffPreviewPendingSeq === handoffPreviewSeq) {
                const seq = handoffPreviewPendingSeq;
                const subj = handoffPreviewPendingSubject;
                handoffPreviewPendingSeq = 0;
                applyHandoffV2Result(msg, null, true, seq, subj);
            }
        }
        if (msg.command === 'appOnboardingDismissed') {
            syncAppOnboardingBannerUi({ dismissed: typeof msg.appOnboardingDismissed === 'boolean' ? msg.appOnboardingDismissed : Boolean(msg.dismissed) });
        }
        if (msg.command === 'globalRulesFileContent') { handleGlobalRulesReply('read', msg); }
        if (msg.command === 'globalRulesSaveResult') { handleGlobalRulesReply('save', msg); }
        if (msg.command === 'globalRulesActionResult') { handleGlobalRulesReply('action', msg); }
        if (msg.command === 'settingsBackupExportResult' || msg.command === 'redactedDiagnosticsResult') {
            if (typeof msg.content === 'string') {
                triggerClientDownload(
                    typeof msg.filename === 'string' ? msg.filename : (msg.command === 'redactedDiagnosticsResult' ? 'antigravity-diagnostics-redacted.json' : 'antigravity-settings-backup.json'),
                    msg.content,
                    typeof msg.mimeType === 'string' ? msg.mimeType : 'application/json;charset=utf-8',
                );
            }
            const fbMsg = msg.ok === false ? (String(msg.error || '') || a11yStrings.settingsSaveFailed || 'Error') : strings.exportedText;
            flashFeedback('settingsBackupFeedback', fbMsg, 3000);
            announcePolite(fbMsg);
        }
        if (msg.command === 'settingsBackupImportResult') {
            const ok = msg.ok !== false;
            const text = ok ? (a11yStrings.backupImported || strings.savedText) : (String(msg.error || '') || a11yStrings.backupImportFailed || 'Error');
            flashFeedback('settingsBackupFeedback', text, 3500);
            announcePolite(text);
        }
        if (msg.command === 'updateCheckResult') {
            const updMsg = msg.error
                ? (String(msg.error) || strings.checkFailedText)
                : (msg.hasUpdate || msg.updateAvailable ? strings.updateAvailableText : strings.upToDateText);
            syncUpdateStatusUi((msg.updateStatus || msg) as UpdateStatusLike);
            flashFeedback('updatesFeedback', updMsg, 3500);
        }
        if (msg.command === 'cdpStatusResult') {
            const cdpRecheckEl = byId('cdpRecheckBtn') as HTMLButtonElement | null;
            if (cdpRecheckEl) { cdpRecheckEl.disabled = false; }
            const nextCdpRes = (msg.cdpStatus || msg) as CdpStatusLike;
            syncCdpStatusUi(nextCdpRes);
            const cdpResText = nextCdpRes.state === 'connected' ? strings.cdpConnectedText
                : (nextCdpRes.state === 'error' ? strings.cdpErrorText
                    : (nextCdpRes.state === 'disabled' ? strings.cdpDisabledText : strings.cdpInactiveText));
            flashFeedback('appOverlaysFeedback', cdpResText, 3200);
        }
        if (msg.command === 'cdpLauncherResult') {
            applyCdpLauncherReply(msg, typeof msg.action === 'string' ? msg.action : null, 'onboardingFeedback');
        }
        if (msg.command === 'pluginUpdateResult') {
            const applyMsg = msg.ok
                ? (String(msg.message || '') || strings.upgradeDoneText)
                : (String(msg.error || msg.message || '') || strings.checkFailedText);
            flashFeedback('updatesFeedback', applyMsg, 4500);
        }
        if (msg.command === 'syncSettingsControls') {
            for (const p of 'toggleContext:showContext,toggleQuota:showQuota,toggleCountdown:showResetCountdown,toggleAiCredits:showAiCredits,toggleSpeed:showSpeed,toggleCacheHit:showCacheHit,toggleSessionCost:showSessionCost,toggleModelInternalId:showModelInternalId,toggleAppComposerRing:appComposerRingEnabled,toggleAppTopBar:appTopBarEnabled,toggleNativeHudBar:showNativeHudBar,toggleAppNativeHudBar:appShowNativeHudBar,toggleIdeNativeHudBar:ideShowNativeHudBar,toggleNativeHudAutoHide:nativeHudAutoHideOnOverview,toggleCdpHighContrast:cdpOverlayHighContrast,toggleCdpOverlayHighContrast:cdpOverlayHighContrast,toggleAutoCheckUpdates:autoCheckUpdates'.split(',')) {
                const [id, k] = p.split(':');
                if (typeof msg[k] === 'boolean') { const cbEl = byId(id) as HTMLInputElement | null; if (cbEl) { cbEl.checked = msg[k] as boolean; } }
            }
            if (typeof msg.nativeHudAutoHideOnOverview === 'boolean' && document.body) {
                document.body.setAttribute('data-hud-auto-hide-overview', String(msg.nativeHudAutoHideOnOverview));
                syncNativeHudVisibility();
            }
            const curSurface = document.body ? document.body.getAttribute('data-acm-surface') : '';
            const splitHudBool = curSurface === 'app-sidecar' ? msg.appShowNativeHudBar : msg.ideShowNativeHudBar;
            if (typeof splitHudBool === 'boolean') {
                const hh = byId('nativeHudHost');
                if (hh) { hh.setAttribute('data-hud-enabled', String(splitHudBool)); }
                syncNativeHudVisibility();
            }
            for (const p of 'languagePreferenceSelect:languagePreference,contextPctBasisSelect:contextPctBasis,speedMetricModeSelect:speedMetricMode,quotaWindowModeSelect:quotaWindowMode,quotaDirectionModeSelect:quotaDirectionMode,cdpOverlayFontSizeSelect:cdpOverlayFontSize,statusTooltipDensity:tooltipDensity,displayCurrencySelect:displayCurrency,subscriptionCurrencySelect:subscriptionCurrency,subscriptionPlanSelect:subscriptionPlan'.split(',')) {
                const [id, k] = p.split(':');
                if (typeof msg[k] === 'string') { const sEl = byId(id) as HTMLSelectElement | null; if (sEl) { sEl.value = msg[k] as string; } }
            }
            if (typeof msg.lockToMainAgent === 'boolean') { syncLockMainVisual(msg.lockToMainAgent); }
            if (typeof msg.orchestratorPricingMode === 'string') { syncOrchestratorPricingModeVisual(msg.orchestratorPricingMode); }
            if (typeof msg.subscriptionPlan === 'string') { syncSubscriptionFeePlaceholder(msg.subscriptionPlan); }
            if (typeof msg.pollingInterval === 'number') { const el = byId('pollingInput') as HTMLInputElement | null; if (el) { el.value = String(msg.pollingInterval); } }
            if (typeof msg.quotaNotificationThreshold === 'number') { const el = byId('quotaNotifyInput') as HTMLInputElement | null; if (el) { el.value = String(msg.quotaNotificationThreshold); } }
            if (Object.prototype.hasOwnProperty.call(msg, 'customFxRate')) { const el = byId('customFxRateInput') as HTMLInputElement | null; if (el) { el.value = (typeof msg.customFxRate === 'number' && isFinite(msg.customFxRate)) ? String(msg.customFxRate) : ''; } }
            if (Object.prototype.hasOwnProperty.call(msg, 'subscriptionMonthlyFee')) { const el = byId('subscriptionFeeInput') as HTMLInputElement | null; if (el) { el.value = (typeof msg.subscriptionMonthlyFee === 'number' && isFinite(msg.subscriptionMonthlyFee)) ? String(msg.subscriptionMonthlyFee) : ''; } }
            for (const p of 'calendarRetentionInput:calendarRetentionDays,activityMaxRecentStepsInput:activityMaxRecentSteps,activityMaxArchivesInput:activityMaxArchives'.split(',')) {
                const [id, k] = p.split(':');
                if (typeof msg[k] === 'number') { const nEl = byId(id) as HTMLInputElement | null; if (nEl) { nEl.value = String(msg[k]); } }
            }
            if (msg.cdpStatus && typeof msg.cdpStatus === 'object') {
                syncCdpStatusUi(
                    msg.cdpStatus as CdpStatusLike,
                    typeof msg.appComposerRingEnabled === 'boolean' ? msg.appComposerRingEnabled : undefined,
                    typeof msg.appTopBarEnabled === 'boolean' ? msg.appTopBarEnabled : undefined,
                );
            } else if (typeof msg.appComposerRingEnabled === 'boolean' || typeof msg.appTopBarEnabled === 'boolean') {
                const compNode = byId('toggleAppComposerRing') as HTMLInputElement | null;
                const topNode = byId('toggleAppTopBar') as HTMLInputElement | null;
                const cOn = typeof msg.appComposerRingEnabled === 'boolean'
                    ? msg.appComposerRingEnabled
                    : Boolean(compNode && compNode.checked);
                const tOn = typeof msg.appTopBarEnabled === 'boolean'
                    ? msg.appTopBarEnabled
                    : Boolean(topNode && topNode.checked);
                if (!cOn && !tOn) {
                    syncCdpStatusUi({ state: 'disabled', diagnosticCode: 'disabled' }, false, false);
                } else {
                    const cdpPillNow = byId('cdpStatusPill');
                    if (cdpPillNow && cdpPillNow.getAttribute('data-cdp-state') === 'disabled') {
                        syncCdpStatusUi({ state: 'probing', diagnosticCode: 'probing' }, cOn, tOn);
                    }
                }
            }
            if (msg.updateStatus && typeof msg.updateStatus === 'object') {
                syncUpdateStatusUi(msg.updateStatus as UpdateStatusLike);
            }
            if (typeof msg.appOnboardingDismissed === 'boolean') {
                syncAppOnboardingBannerUi({
                    dismissed: msg.appOnboardingDismissed,
                    topBarOn: typeof msg.appTopBarEnabled === 'boolean' ? msg.appTopBarEnabled : undefined,
                    composerOn: typeof msg.appComposerRingEnabled === 'boolean' ? msg.appComposerRingEnabled : undefined,
                });
            }
        }
        if (msg.command === 'copyActionResult') {
            if (msg.ok) {
                const actionBtn = typeof msg.action === 'string'
                    ? document.querySelector<CopyButtonEl>('[data-action="' + msg.action + '"]')
                    : null;
                flashCopyButton(actionBtn);
            }
        }
        if (msg.command === 'stateFileActionResult') {
            let text = '';
            if (msg.ok) {
                text = msg.action === 'reveal' ? strings.revealedText : strings.openedText;
            } else {
                text = String(msg.message || '') || (msg.action === 'reveal' ? strings.revealFailedText : strings.openFailedText);
            }
            flashFeedback('statePathFeedback', text, 3200);
        }
    });

    // ─── Error message overflow detection ───
    function initErrorOverflow(): void {
        const items = document.querySelectorAll('.gm-err-expand:not([data-overflow-checked])');
        for (let eoi = 0; eoi < items.length; eoi++) {
            const det = items[eoi];
            const sum = det.querySelector('.gm-err-msg-summary');
            if (!sum) { continue; }
            det.setAttribute('data-overflow-checked', 'true');
            if (sum.scrollWidth <= sum.clientWidth) {
                det.classList.add('no-overflow');
            }
        }
    }

    restoreDetailsState(savedState);
    raf(() => { initErrorOverflow(); });

    // ─── Quota Notification Threshold ───
    const quotaNotifyBtn = byId('quotaNotifySaveBtn');
    const quotaNotifyInput = byId('quotaNotifyInput') as HTMLInputElement | null;
    function saveQuotaThreshold(): void {
        if (!quotaNotifyInput) { return; }
        const val = parseInt(quotaNotifyInput.value, 10);
        if (val >= 0 && val <= 99) {
            vscode.postMessage({ command: 'setConfig', key: 'quotaNotificationThreshold', value: val });
            flashFeedback('quotaNotifyFeedback', strings.savedText, 2000);
        }
    }
    if (quotaNotifyBtn && quotaNotifyInput) {
        addTrackedListener(quotaNotifyBtn, 'click', saveQuotaThreshold);
    }
    if (quotaNotifyInput) {
        addTrackedListener(quotaNotifyInput, 'change', saveQuotaThreshold);
        addTrackedListener(quotaNotifyInput, 'keydown', (ev: Event) => {
            const e = ev as KeyboardEvent;
            if (e.key === 'Enter') { e.preventDefault(); saveQuotaThreshold(); }
        });
    }

    function commitAppSettingControl(el: HTMLElement | null): void {
        if (!el || typeof el.getAttribute !== 'function') { return; }
        const key = el.getAttribute('data-app-setting');
        if (!key) { return; }
        const fbId = el.getAttribute('data-feedback-id') || '';
        const inputEl = el as HTMLInputElement;
        let value: unknown;
        if (inputEl.type === 'checkbox') {
            value = !!inputEl.checked;
            const curSurf = document.body ? document.body.getAttribute('data-acm-surface') : '';
            if (
                key === 'showNativeHudBar'
                || (key === 'appShowNativeHudBar' && curSurf === 'app-sidecar')
                || (key === 'ideShowNativeHudBar' && curSurf !== 'app-sidecar')
            ) {
                const hudHost = byId('nativeHudHost');
                if (hudHost) {
                    hudHost.setAttribute('data-hud-enabled', String(value));
                }
                syncNativeHudVisibility();
            } else if (key === 'nativeHudAutoHideOnOverview') {
                if (document.body) {
                    document.body.setAttribute('data-hud-auto-hide-overview', String(value));
                }
                syncNativeHudVisibility();
            }
        } else if (el.tagName === 'SELECT') {
            const selectEl = el as HTMLSelectElement;
            value = selectEl.value;
            if (key === 'subscriptionPlan') {
                syncSubscriptionFeePlaceholder(String(value));
            }
        } else {
            const settingType = el.getAttribute('data-setting-type') || 'string';
            const raw = String(inputEl.value || '').trim();
            if (settingType === 'int') {
                const parsedInt = parseInt(raw, 10);
                const minAttr = inputEl.min !== '' ? parseInt(inputEl.min, 10) : -Infinity;
                const maxAttr = inputEl.max !== '' ? parseInt(inputEl.max, 10) : Infinity;
                if (!isFinite(parsedInt) || parsedInt < minAttr || parsedInt > maxAttr) {
                    if (fbId) { flashFeedback(fbId, strings.invalidBillingDayText, 2000); }
                    return;
                }
                value = parsedInt;
            } else if (settingType === 'nullable-float') {
                if (!raw) {
                    value = null;
                } else {
                    const parsedFloat = parseFloat(raw);
                    const minF = inputEl.min !== '' ? parseFloat(inputEl.min) : -Infinity;
                    const maxF = inputEl.max !== '' ? parseFloat(inputEl.max) : Infinity;
                    if (!isFinite(parsedFloat) || parsedFloat < minF || parsedFloat > maxF) {
                        if (fbId) { flashFeedback(fbId, strings.invalidBillingDayText, 2000); }
                        return;
                    }
                    value = parsedFloat;
                }
            } else {
                value = raw;
            }
        }
        vscode.postMessage({ command: 'setAppSetting', key, value });
        if (fbId) { flashFeedback(fbId, strings.savedText, 2000); }
    }

    function submitSettingsBackupImport(json: string): void {
        sendBridgeOrPost({ command: 'importSettingsBackup', json }, (payload) => {
            const ok = !payload || payload.ok !== false;
            const text = ok
                ? (a11yStrings.backupImported || strings.savedText)
                : (String(payload.error || '') || a11yStrings.backupImportFailed || 'Error');
            flashFeedback('settingsBackupFeedback', text, 3500);
            announcePolite(text);
        }, () => {
            const err = a11yStrings.backupImportFailed || 'Error';
            flashFeedback('settingsBackupFeedback', err, 3500);
            announcePolite(err);
        });
    }

    // ─── Delegated Change & Enter Auto-Save ───
    addTrackedListener(document.body, 'change', (e: Event) => {
        const target = e.target as HTMLSelectElement | HTMLInputElement | null;
        if (target && target.id === 'conversationSwitcher') {
            cancelMemberNavigation();
            inspectionOrigin = null;
            awaitingMemberExit = false;
            const selectedId = target.value || null;
            vscode.postMessage({ command: 'selectConversation', conversationId: selectedId });
            return;
        }
        if (target && target.type === 'file' && (target.id === 'settingsBackupFileInput' || target.getAttribute('data-action') === 'importSettingsBackupFile')) {
            const file = target.files && target.files[0];
            if (!file) { target.value = ''; return; }
            const failImport = () => {
                target.value = '';
                const msg = a11yStrings.backupImportFailed || 'Error';
                flashFeedback('settingsBackupFeedback', msg, 3500);
                announcePolite(msg);
            };
            if (file.size > 65536) { failImport(); return; }
            if (typeof file.text === 'function') {
                file.text().then((json) => { target.value = ''; submitSettingsBackupImport(json); }).catch(failImport);
            } else {
                target.value = '';
            }
            return;
        }
        if (target && typeof target.getAttribute === 'function' && target.getAttribute('data-app-setting')) {
            commitAppSettingControl(target);
        }
    });
    addTrackedListener(document.body, 'keydown', (ev: Event) => {
        const e = ev as KeyboardEvent;
        if (e.key !== 'Enter') { return; }
        const target = e.target as HTMLElement | null;
        if (target && target.tagName === 'INPUT' && typeof target.getAttribute === 'function' && target.getAttribute('data-app-setting')) {
            e.preventDefault();
            commitAppSettingControl(target);
        }
    });

    // ─── Synced Hover / Focus / Click-Lock for Context Composition Breakdown ───
    let lockedCtxCat = savedState.lockedCtxCat || '';

    function renderLockedCtxDrawer(): void {
        const cards = document.querySelectorAll('.ctx-breakdown-card');
        for (let ci = 0; ci < cards.length; ci++) {
            const card = cards[ci];
            const drawer = (card.querySelector('#ctxSelectedDrawer') || card.querySelector('.ctx-selected-drawer')) as HTMLElement | null;
            const legendBtns = card.querySelectorAll('.ctx-legend-item[data-ctx-cat]');
            if (!lockedCtxCat) {
                if (drawer) {
                    drawer.hidden = true;
                    drawer.textContent = '';
                    drawer.setAttribute('data-ctx-drawer-active', '');
                }
                card.removeAttribute('data-locked-cat');
                card.removeAttribute('data-highlight-cat');
                for (let li = 0; li < legendBtns.length; li++) {
                    legendBtns[li].classList.remove('is-locked');
                    legendBtns[li].setAttribute('aria-pressed', 'false');
                }
                continue;
            }
            let tpl: HTMLTemplateElement | null = null;
            const tpls = card.querySelectorAll<HTMLTemplateElement>('template[data-ctx-drawer-cat]');
            for (let ti = 0; ti < tpls.length; ti++) {
                if (tpls[ti].getAttribute('data-ctx-drawer-cat') === lockedCtxCat) {
                    tpl = tpls[ti];
                    break;
                }
            }
            if (!tpl || !drawer) {
                lockedCtxCat = '';
                const sClr = vscode.getState() || {};
                sClr.lockedCtxCat = '';
                vscode.setState(sClr);
                if (drawer) {
                    drawer.hidden = true;
                    drawer.textContent = '';
                    drawer.setAttribute('data-ctx-drawer-active', '');
                }
                card.removeAttribute('data-locked-cat');
                card.removeAttribute('data-highlight-cat');
                for (let lj = 0; lj < legendBtns.length; lj++) {
                    legendBtns[lj].classList.remove('is-locked');
                    legendBtns[lj].setAttribute('aria-pressed', 'false');
                }
                continue;
            }
            drawer.textContent = '';
            if (tpl.content && typeof tpl.content.cloneNode === 'function' && typeof drawer.appendChild === 'function') {
                drawer.appendChild(tpl.content.cloneNode(true));
            } else if (typeof tpl.innerHTML === 'string') {
                drawer.innerHTML = tpl.innerHTML;
            }
            drawer.hidden = false;
            drawer.setAttribute('data-ctx-drawer-active', lockedCtxCat);
            card.setAttribute('data-locked-cat', lockedCtxCat);
            card.setAttribute('data-highlight-cat', lockedCtxCat);
            for (let lk = 0; lk < legendBtns.length; lk++) {
                const isMatch = legendBtns[lk].getAttribute('data-ctx-cat') === lockedCtxCat;
                legendBtns[lk].classList.toggle('is-locked', isMatch);
                legendBtns[lk].setAttribute('aria-pressed', String(isMatch));
            }
        }
    }

    function setLockedCtxCategory(cat: string): void {
        lockedCtxCat = cat || '';
        const st = vscode.getState() || {};
        st.lockedCtxCat = lockedCtxCat;
        vscode.setState(st);
        renderLockedCtxDrawer();
    }

    function setCtxHighlight(target: Element | null, active: boolean): void {
        if (!target || typeof target.closest !== 'function') { return; }
        const catEl = target.closest('[data-ctx-cat]');
        if (!catEl) { return; }
        const card = catEl.closest('.ctx-breakdown-card');
        if (!card) { return; }
        const cat = catEl.getAttribute('data-ctx-cat');
        if (active && cat) {
            card.setAttribute('data-highlight-cat', cat);
        } else if (lockedCtxCat) {
            card.setAttribute('data-highlight-cat', lockedCtxCat);
        } else {
            card.removeAttribute('data-highlight-cat');
        }
    }

    renderLockedCtxDrawer();
    ensureRichTipEl();

    addTrackedListener(document.body, 'mouseover', (e: Event) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) { return; }
        setCtxHighlight(target, true);
        const pop = byId('acmRichTipPopover');
        if (pop && (target === pop || (pop.contains && pop.contains(target)))) {
            richTipPointerInsidePop = true;
            cancelRichTipHide();
            return;
        }
        if (richTipPinned) { return; }
        const tipTrigger = typeof target.closest === 'function' ? target.closest<HTMLElement>(RICH_TIP_SEL) : null;
        if (tipTrigger) {
            if (tipTrigger !== richTipActiveEl || !pop || pop.hidden) {
                showRichTip(tipTrigger, false);
            } else {
                cancelRichTipHide();
            }
        }
    });
    addTrackedListener(document.body, 'mouseout', (ev: Event) => {
        const e = ev as MouseEvent;
        const target = e.target instanceof Element ? e.target : null;
        const rel = e.relatedTarget instanceof Element ? e.relatedTarget : null;
        if (target && typeof target.closest === 'function' && target.closest('[data-ctx-cat]')) {
            if (!rel || typeof rel.closest !== 'function' || !rel.closest('[data-ctx-cat]')) {
                setCtxHighlight(target, false);
            }
        }
        if (!richTipPinned && target && typeof target.closest === 'function') {
            const leavingTrigger = target.closest(RICH_TIP_SEL);
            if (leavingTrigger && leavingTrigger === richTipActiveEl) {
                const pop = byId('acmRichTipPopover');
                const enteringSame = rel && (rel === leavingTrigger || (leavingTrigger.contains && leavingTrigger.contains(rel)));
                const enteringPop = rel && pop && (rel === pop || (pop.contains && pop.contains(rel)));
                if (!enteringSame && !enteringPop) {
                    scheduleRichTipHide();
                }
            }
        }
    });
    addTrackedListener(document.body, 'focusin', (e: Event) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) { return; }
        setCtxHighlight(target, true);
        if (richTipPinned || restoringTipFocus) { return; }
        const tipTrigger = typeof target.closest === 'function' ? target.closest<HTMLElement>(RICH_TIP_SEL) : null;
        if (tipTrigger) {
            showRichTip(tipTrigger, false);
        }
    });
    addTrackedListener(document.body, 'focusout', (ev: Event) => {
        const e = ev as FocusEvent;
        const target = e.target instanceof Element ? e.target : null;
        const rel = e.relatedTarget instanceof Element ? e.relatedTarget : null;
        setCtxHighlight(target, false);
        const pop = byId('acmRichTipPopover');
        if (richTipPinned && pop && !pop.hidden && target && (target === pop || (pop.contains && pop.contains(target)))) {
            // Ordinary Tab exit from non-modal pinned dialog closes it cleanly without trapping focus
            const focusStayedInPop = rel && (rel === pop || (pop.contains && pop.contains(rel)));
            const focusBackOnTrigger = rel && richTipActiveEl && (rel === richTipActiveEl || (richTipActiveEl.contains && richTipActiveEl.contains(rel)));
            if (rel && !focusStayedInPop && !focusBackOnTrigger) {
                hideRichTip(true);
            }
            return;
        }
        if (!richTipPinned && richTipActiveEl) {
            const focusIntoPop = rel && pop && (rel === pop || (pop.contains && pop.contains(rel)));
            const focusIntoTrigger = rel && (rel === richTipActiveEl || (richTipActiveEl.contains && richTipActiveEl.contains(rel)));
            if (!focusIntoPop && !focusIntoTrigger) {
                scheduleRichTipHide();
            }
        }
    });
    addTrackedListener(document, 'keydown', (ev: Event) => {
        const e = ev as KeyboardEvent;
        if (e.key === 'Escape') {
            const pop = byId('acmRichTipPopover');
            if (pop && !pop.hidden) {
                const prevEl = richTipActiveEl;
                const prevKey = richTipActiveKey;
                const wasPinned = richTipPinned;
                const hadFocusInside = Boolean(
                    document.activeElement
                    && (document.activeElement === pop || (pop.contains && pop.contains(document.activeElement))),
                );
                hideRichTip(true);
                if (wasPinned || hadFocusInside) {
                    returnFocusAfterRichTipDismiss(prevEl, prevKey);
                }
                e.stopPropagation();
                return;
            }
            if (lockedCtxCat) {
                setLockedCtxCategory('');
                e.stopPropagation();
                return;
            }
        }
        if (e.key === 'Enter' || e.key === ' ') {
            const active = document.activeElement instanceof Element ? document.activeElement as HTMLElement : null;
            if (!active) { return; }
            if (active.classList && (active.classList.contains('ctx-seg-slice') || active.classList.contains('ctx-dot'))) {
                const ctxCat = active.getAttribute('data-ctx-cat') || '';
                if (ctxCat) {
                    e.preventDefault();
                    hideRichTip(true);
                    setLockedCtxCategory(lockedCtxCat === ctxCat ? '' : ctxCat);
                    return;
                }
            }
            const tipTrig = typeof active.closest === 'function' ? active.closest<HTMLElement>(RICH_TIP_SEL) : null;
            if (tipTrig && tipTrig === active && isClickPinnableRichTip(tipTrig)) {
                e.preventDefault();
                if (richTipPinned && richTipActiveEl === tipTrig) {
                    hideRichTip(true);
                } else {
                    showRichTip(tipTrig, true, true);
                }
            }
        }
    });
    addTrackedListener(window, 'resize', () => {
        if (richTipActiveEl) { positionRichTip(); }
    });
    addTrackedListener(window, 'scroll', () => {
        if (richTipActiveEl) { positionRichTip(); }
    }, { passive: true });

    // ─── Restore scroll position (per-tab, debounced; cancelled on route/anchor change) ───
    const currentScrollY = tabScrolls[activeTab] || 0;
    if (currentScrollY > 0 && !activeAnchor) {
        raf(() => {
            if (initialScrollRestoreCancelled || activeAnchor) { return; }
            raf(() => {
                if (initialScrollRestoreCancelled || activeAnchor) { return; }
                if (typeof window.scrollTo === 'function') { window.scrollTo(0, currentScrollY); }
            });
        });
        initialScrollRestoreTimer = scheduleTimeout(() => {
            initialScrollRestoreTimer = null;
            if (initialScrollRestoreCancelled || activeAnchor) { return; }
            if (typeof window.scrollTo === 'function') { window.scrollTo(0, currentScrollY); }
        }, 80);
    }
    let _scrollTimer: ReturnType<typeof setTimeout> | null = null;
    addTrackedListener(window, 'scroll', () => {
        cancelTrackedTimeout(_scrollTimer);
        _scrollTimer = scheduleTimeout(() => {
            const y = window.scrollY;
            if (y === 0 && (tabScrolls[activeTab] || 0) > 50) { return; }
            const s = vscode.getState() || {};
            const ts = s.tabScrolls || {};
            ts[activeTab] = y;
            s.tabScrolls = ts;
            vscode.setState(s);
        }, 150);
    });

    // ─── Delegated Body Click Router ───
    addTrackedListener(document.body, 'click', (e: Event) => {
        const rawTarget = e.target as Node | null;
        const target = rawTarget instanceof Element
            ? rawTarget
            : (rawTarget && rawTarget.parentElement ? rawTarget.parentElement : null);
        if (!target || typeof target.closest !== 'function') { return; }

        // ── Rich Tip Popover close / inside / outside / click-to-pin ──
        if (target.closest('#acmRichTipClose')) {
            const prevEl = richTipActiveEl;
            const prevKey = richTipActiveKey;
            hideRichTip(true);
            returnFocusAfterRichTipDismiss(prevEl, prevKey);
            return;
        }
        const activePopEl = byId('acmRichTipPopover');
        if (activePopEl && (target === activePopEl || (activePopEl.contains && activePopEl.contains(target)))) {
            return;
        }
        const clickedTipTrigger = target.closest<HTMLElement>(RICH_TIP_SEL);
        if (richTipPinned && (!clickedTipTrigger || clickedTipTrigger !== richTipActiveEl)) {
            hideRichTip(true);
        }
        if (clickedTipTrigger && isClickPinnableRichTip(clickedTipTrigger)) {
            const nestedInteractive = target.closest<HTMLButtonElement>('button, a[href], input, select, textarea, summary, [data-action], [data-overview-target], [data-switch-tab], [data-navigate-tab]');
            const isNestedAction = nestedInteractive
                && nestedInteractive !== clickedTipTrigger
                && (!nestedInteractive.disabled)
                && (!clickedTipTrigger.contains || clickedTipTrigger.contains(nestedInteractive));
            if (!isNestedAction) {
                if (richTipPinned && richTipActiveEl === clickedTipTrigger) {
                    hideRichTip(true);
                } else {
                    showRichTip(clickedTipTrigger, true);
                }
                return;
            }
        }

        // ── Context Composition Inline Detail Drawer Close & Category Click-Lock ──
        if (target.closest('[data-action="closeCtxDrawer"]')) {
            setLockedCtxCategory('');
            return;
        }
        const ctxClickEl = target.closest('.ctx-seg-slice[data-ctx-cat], .ctx-dot[data-ctx-cat], .ctx-legend-item[data-ctx-cat]');
        if (ctxClickEl) {
            const clickedCat = ctxClickEl.getAttribute('data-ctx-cat') || '';
            hideRichTip(true);
            setLockedCtxCategory(lockedCtxCat === clickedCat ? '' : clickedCat);
            return;
        }

        // ── Num-spinner buttons ──
        const spinnerBtn = target.closest('.num-spinner-btn');
        if (spinnerBtn) {
            const spinner = spinnerBtn.closest('.num-spinner');
            if (spinner) {
                const spinInput = spinner.querySelector<HTMLInputElement>('input[type="number"]');
                if (spinInput) {
                    const step = parseFloat(spinInput.step) || 1;
                    const min = spinInput.min !== '' ? parseFloat(spinInput.min) : -Infinity;
                    const max = spinInput.max !== '' ? parseFloat(spinInput.max) : Infinity;
                    let val = parseFloat(spinInput.value);
                    if (isNaN(val)) { val = isFinite(min) ? min : 0; }
                    if (spinnerBtn.classList.contains('increment')) {
                        val = Math.min(val + step, max);
                    } else {
                        val = Math.max(val - step, min);
                    }
                    spinInput.value = String(val);
                    spinInput.dispatchEvent(new Event('input', { bubbles: true }));
                    spinInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            return;
        }

        // ── Error message full-text click → collapse ──
        const errFull = target.closest('.gm-err-msg-full');
        if (errFull) {
            const det = errFull.closest('details.gm-err-expand');
            if (det) { det.removeAttribute('open'); }
            return;
        }

        const overviewAction = target.closest<HTMLElement>('[data-overview-target]');
        if (overviewAction) {
            switchTab(overviewAction.dataset.overviewTarget, true, false, overviewAction.dataset.overviewAnchor);
            return;
        }

        const switchLink = target.closest<HTMLElement>('[data-switch-tab]');
        if (switchLink) {
            switchTab(switchLink.dataset.switchTab);
            return;
        }

        const scrollLink = target.closest<HTMLElement>('[data-scroll-to]');
        if (scrollLink) {
            e.preventDefault();
            const scrollTarget = scrollLink.dataset.scrollTo ? byId(scrollLink.dataset.scrollTo) : null;
            if (scrollTarget) {
                scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
                scrollTarget.focus();
            }
            return;
        }

        const navCard = target.closest<HTMLElement>('[data-navigate-tab]');
        if (navCard) {
            switchTab(navCard.dataset.navigateTab);
            return;
        }

        // ── Lock to Main Agent toggle ──
        const lockBtn = target.closest('[data-action="toggleLockMain"]');
        if (lockBtn) {
            const nextLocked = lockBtn.getAttribute('aria-pressed') !== 'true';
            syncLockMainVisual(nextLocked);
            vscode.postMessage({ command: 'toggleLockMain', locked: nextLocked });
            announcePolite(nextLocked ? a11yStrings.lockAnchored : a11yStrings.lockReleased);
            return;
        }

        // ── D9 Swarm Inspect / Back to Main / Retarget Lock ──
        if (target.closest('[data-action="cancelMemberNavigation"]')) {
            cancelMemberNavigation();
            vscode.postMessage({ command: 'clearInspect' });
            return;
        }
        if (memberNavigation && target.closest('summary')?.closest('.swarm-member-details, .ses-swarm-group, .swarm-ended')) {
            cancelMemberNavigation();
        }
        if (target.closest('[data-action="showCurrentMemberOverview"]')) {
            cancelMemberNavigation();
            switchTab('overview', true, false, 'overview-context-heading');
            return;
        }
        const inspectBtn = target.closest('[data-action="inspectMember"]');
        if (inspectBtn) {
            const cid = (inspectBtn.getAttribute('data-cascade-id') || '').trim();
            if (cid) {
                awaitingMemberExit = false;
                cancelMemberNavigation();
                const request = { id: cid, sourceTab: activeTab, detailId: inspectBtn.closest('details')?.id || '', slow: false };
                memberNavigation = request;
                memberFeedback(a11yStrings.memberOpening);
                const fail = () => {
                    if (memberNavigation !== request) { return; }
                    memberFeedback(a11yStrings.memberOpenFailed);
                    memberNavigation = null;
                    cancelTrackedTimeout(memberNavigationTimer);
                };
                // Archived trajectories can take longer than a poll cycle. A slow response is
                // still eligible until the user cancels, changes tabs, or picks a new target.
                memberNavigationTimer = scheduleTimeout(() => {
                    if (memberNavigation !== request) { return; }
                    request.slow = true;
                    memberFeedback(a11yStrings.memberStillOpening);
                }, 15000);
                sendBridgeOrPost({ command: 'inspectMember', cascadeId: cid }, result => {
                    if (memberNavigation !== request) { return; }
                    if (result?.ok === false) { fail(); }
                    else { finishMemberNavigation(); }
                }, fail);
            }
            return;
        }
        if (target.closest('[data-action="clearInspect"]')) {
            cancelMemberNavigation();
            awaitingMemberExit = true;
            sendBridgeOrPost({ command: 'clearInspect' }, result => {
                if (result?.ok === false) { awaitingMemberExit = false; }
            }, () => { awaitingMemberExit = false; });
            return;
        }
        const retargetBtn = target.closest('[data-action="retargetLockedRoot"]');
        if (retargetBtn) {
            cancelMemberNavigation();
            const cid = (retargetBtn.getAttribute('data-cascade-id') || '').trim();
            if (cid) {
                vscode.postMessage({ command: 'retargetLockedRoot', cascadeId: cid });
                announcePolite(a11yStrings.lockAnchored);
            }
            return;
        }

        // ── Overview Inline Mode Switches (Basis / Speed / Quota Window & Direction) ──
        const ovSetBtn = target.closest('[data-action="setOverviewSetting"]');
        if (ovSetBtn) {
            const sKey = ovSetBtn.getAttribute('data-setting-key') || '';
            const sVal = ovSetBtn.getAttribute('data-setting-value') || '';
            if (sKey && sVal) {
                const grp = ovSetBtn.closest('[data-setting-switch]');
                if (grp) {
                    const sibs = grp.querySelectorAll('[data-action="setOverviewSetting"]');
                    for (let si = 0; si < sibs.length; si++) {
                        const isMatch = sibs[si] === ovSetBtn;
                        sibs[si].classList.toggle('is-active', isMatch);
                        sibs[si].setAttribute('aria-pressed', String(isMatch));
                    }
                }
                vscode.postMessage({ command: 'setAppSetting', key: sKey, value: sVal });
            }
            return;
        }

        // ── Handoff v2 Preview-Before-Copy & Compaction Recovery Brief ──
        const previewHandoffBtn = target.closest('[data-action="previewHandoffV2"]');
        if (previewHandoffBtn) {
            const cid = (previewHandoffBtn.getAttribute('data-cascade-id') || '').trim() || undefined;
            const rawRev = previewHandoffBtn.getAttribute('data-data-revision');
            const dataRevision = rawRev !== null && rawRev !== '' && isFinite(Number(rawRev)) ? Number(rawRev) : undefined;
            const box = byId('handoffV2PreviewBox');
            const ta = byId('handoffV2PreviewText') as HTMLTextAreaElement | null;
            const reqSeq = ++handoffPreviewSeq;
            const reqSubject = cid || box?.getAttribute('data-subject-cascade-id') || '';
            handoffPreviewPendingSeq = reqSeq;
            handoffPreviewPendingSubject = reqSubject;
            if (box && ta) {
                const cb = box.querySelector<HTMLButtonElement>('[data-action="copyHandoffPreviewText"]');
                if (cb) { cb.disabled = true; }
                if (!ta.value.trim()) { ta.value = a11yStrings.handoffLoading || 'Loading...'; }
                box.hidden = false;
            }
            sendBridgeOrPost(
                { command: 'previewHandoffV2', cascadeId: cid, dataRevision },
                (payload) => { applyHandoffV2Result(payload, previewHandoffBtn, false, reqSeq, reqSubject); },
                () => { applyHandoffV2Result(null, previewHandoffBtn, false, reqSeq, reqSubject); },
            );
            return;
        }
        const copyHandoffPreviewBtn = target.closest<CopyButtonEl>('[data-action="copyHandoffPreviewText"]');
        if (copyHandoffPreviewBtn) {
            if ((copyHandoffPreviewBtn as HTMLButtonElement).disabled || copyHandoffPreviewBtn.getAttribute('data-handoff-stale') === 'true') {
                return;
            }
            const box = byId('handoffV2PreviewBox');
            const trig = byId('previewHandoffV2Btn');
            const ta = byId('handoffV2PreviewText') as HTMLTextAreaElement | null;
            const boxRev = box?.getAttribute('data-data-revision') || '';
            const trigRev = trig?.getAttribute('data-data-revision') || '';
            const boxSubj = box?.getAttribute('data-subject-cascade-id') || '';
            const trigSubj = (trig?.getAttribute('data-cascade-id') || '').trim();
            if ((boxRev && trigRev && boxRev !== trigRev) || (boxSubj && trigSubj && boxSubj !== trigSubj)) {
                (copyHandoffPreviewBtn as HTMLButtonElement).disabled = true;
                copyHandoffPreviewBtn.setAttribute('data-handoff-stale', 'true');
                if (ta) { ta.value = strings.handoffStaleRevisionText; }
                return;
            }
            if (ta && ta.value) { copyTextSafe(ta.value).then(() => { flashCopyButton(copyHandoffPreviewBtn); }); }
            return;
        }
        if (target.closest('[data-action="closeHandoffPreview"]')) {
            handoffPreviewSeq++;
            handoffPreviewPendingSeq = 0;
            const box = byId('handoffV2PreviewBox');
            if (box) { box.hidden = true; }
            const trig = byId('previewHandoffV2Btn');
            if (trig && typeof trig.focus === 'function') { trig.focus({ preventScroll: true }); }
            return;
        }
        const copyRecoveryBtn = target.closest<CopyButtonEl>('[data-action="copyRecoveryBrief"]');
        if (copyRecoveryBtn) {
            const bodyEl = document.querySelector('#compactionRecoveryBrief .recovery-brief-body');
            if (bodyEl && bodyEl.textContent) { copyTextSafe(bodyEl.textContent).then(() => { flashCopyButton(copyRecoveryBtn); }); }
            return;
        }
        const dismissRecoveryBtn = target.closest('[data-action="dismissRecoveryBrief"]');
        if (dismissRecoveryBtn) {
            const eventKey = dismissRecoveryBtn.getAttribute('data-event-key') || '';
            const card = byId('compactionRecoveryBrief');
            if (card) { card.hidden = true; }
            if (eventKey) { vscode.postMessage({ command: 'dismissRecoveryBrief', eventKey }); }
            return;
        }

        // ── Settings JSON Backup / Import & Redacted Diagnostics Export ──
        const exportBackupBtn = target.closest('[data-action="exportSettingsBackup"], [data-action="exportRedactedDiagnostics"]');
        if (exportBackupBtn) {
            const cmd = exportBackupBtn.getAttribute('data-action') || 'exportSettingsBackup';
            const fallbackFile = cmd === 'exportRedactedDiagnostics' ? 'antigravity-diagnostics-redacted.json' : 'antigravity-settings-backup.json';
            sendBridgeOrPost({ command: cmd }, (payload) => {
                if (payload && typeof payload.content === 'string') {
                    triggerClientDownload((payload.filename as string | undefined) || fallbackFile, payload.content, (payload.mimeType as string | undefined) || 'application/json;charset=utf-8');
                    flashFeedback('settingsBackupFeedback', strings.exportedText, 3000);
                    announcePolite(strings.exportedText);
                }
            }, () => {
                const err = a11yStrings.settingsSaveFailed || 'Error';
                flashFeedback('settingsBackupFeedback', err, 3000);
                announcePolite(err);
            });
            return;
        }
        const importBackupBtn = target.closest('[data-action="importSettingsBackup"]');
        if (importBackupBtn) {
            const targetId = importBackupBtn.getAttribute('data-import-target') || 'settingsBackupImportInput';
            const inputEl = byId(targetId) as HTMLTextAreaElement | HTMLInputElement | null;
            const fileEl = byId('settingsBackupFileInput') as HTMLInputElement | null;
            const rawJson = inputEl ? String(inputEl.value || '').trim() : '';
            if (rawJson) { submitSettingsBackupImport(rawJson); }
            else if (fileEl && typeof fileEl.click === 'function') { fileEl.click(); }
            else { flashFeedback('settingsBackupFeedback', a11yStrings.backupImportFailed || 'Error', 3000); }
            return;
        }

        // ── Context Composition Visualization Mode Toggle ──
        const ctxVizBtn = target.closest('[data-ctx-viz]');
        if (ctxVizBtn) {
            const nextViz: 'bar' | 'dots' = ctxVizBtn.getAttribute('data-ctx-viz') === 'dots' ? 'dots' : 'bar';
            const vs = vscode.getState() || {};
            vs.ctxVizMode = nextViz;
            vscode.setState(vs);
            applyContextVizMode(nextViz);
            return;
        }

        // ── Quick Copy Actions (/context Report & Handoff Prompt) ──
        const copyActionBtn = target.closest<CopyButtonEl>('[data-action="copyContextReport"], [data-action="copyHandoffPrompt"]');
        if (copyActionBtn) {
            const actionName = copyActionBtn.getAttribute('data-action');
            if (bridge && bridge.surface !== 'vscode' && typeof bridge.sendAction === 'function') {
                bridge.sendAction({ command: actionName }).then((res) => {
                    const resResult = res && res.result as Record<string, unknown> | undefined;
                    if (res && res._copiedByBridge) {
                        flashCopyButton(copyActionBtn);
                    } else if (res && typeof res.text === 'string') {
                        copyTextSafe(res.text).then(() => { flashCopyButton(copyActionBtn); });
                    } else if (resResult && typeof resResult.text === 'string') {
                        copyTextSafe(resResult.text).then(() => { flashCopyButton(copyActionBtn); });
                    } else if (res && res.ok) {
                        flashCopyButton(copyActionBtn);
                    }
                });
            } else {
                vscode.postMessage({ command: actionName });
            }
            return;
        }

        // ── Copy Raw JSON ──
        const cpyBtn = target.closest<HTMLElement>('#copyRawJson');
        if (cpyBtn) {
            const rawEl = byId('rawJsonContent');
            if (!rawEl) { return; }
            copyTextSafe(rawEl.textContent || '').then(() => {
                cpyBtn.classList.add('copied');
                const origHtml = cpyBtn.innerHTML;
                cpyBtn.textContent = strings.copiedText;
                scheduleTimeout(() => { cpyBtn.innerHTML = origHtml; cpyBtn.classList.remove('copied'); }, 2000);
            });
            return;
        }

        // ── Copy All Errors ──
        const ueBtn = target.closest<HTMLElement>('#copyAllErrors');
        if (ueBtn) {
            e.preventDefault();
            e.stopPropagation();
            const ueData = byId('ueClipboardData');
            if (!ueData) { return; }
            copyTextSafe(ueData.textContent || '').then(() => {
                ueBtn.classList.add('copied');
                const origUeHtml = ueBtn.innerHTML;
                ueBtn.textContent = strings.copiedText;
                scheduleTimeout(() => { ueBtn.innerHTML = origUeHtml; ueBtn.classList.remove('copied'); }, 2000);
            });
            return;
        }

        // ── Pricing Save ──
        if (target.closest('#pricingSaveBtn')) {
            const inputs = document.querySelectorAll('.pricing-input') as unknown as ArrayLike<PricingInputLike>;
            let data: Record<string, unknown>;
            try {
                data = collectPricingInputOverrides(inputs);
            } catch {
                const feedback = byId('pricingFeedback');
                if (feedback) {
                    feedback.textContent = strings.invalidPricingText;
                    feedback.setAttribute('role', 'alert');
                }
                return;
            }
            vscode.postMessage({ command: 'savePricing', value: data });
            return;
        }

        // ── Pricing Reset ──
        if (target.closest('#pricingResetBtn')) {
            vscode.postMessage({ command: 'resetPricing' });
            return;
        }

        // ── Clear Tool Catalog ──
        if (target.closest('#clearToolCatalogBtn')) {
            vscode.postMessage({ command: 'clearToolCatalog' });
            return;
        }

        // ── Profile: Billing Day Save (opaque accountHandle preferred; legacy data-email fallback) ──
        if (target.closest('#profileBillingDaySaveBtn')) {
            const bdInput = byId('profileBillingDayInput') as HTMLInputElement | null;
            if (bdInput) {
                const bdRaw = (bdInput.value || '').trim();
                const bdVal = bdRaw ? Number(bdRaw) : NaN;
                const bdHandle = (bdInput.getAttribute('data-account-handle') || bdInput.getAttribute('data-account-id') || '').trim();
                const bdEmail = (bdInput.getAttribute('data-email') || '').trim();
                if (Number.isInteger(bdVal) && bdVal >= 0 && bdVal <= 31 && (bdHandle || bdEmail)) {
                    const bdMsg: Record<string, unknown> = { command: 'setAccountBillingDay', day: bdVal };
                    if (bdHandle) {
                        bdMsg.accountHandle = bdHandle;
                    } else if (bdEmail) {
                        bdMsg.email = bdEmail;
                    }
                    vscode.postMessage(bdMsg);
                } else {
                    flashProfileBillingFeedback(strings.invalidBillingDayText, true);
                }
            } else {
                flashProfileBillingFeedback(strings.invalidBillingDayText, true);
            }
            return;
        }

        // ── Privacy Mask Toggle (unmask requests host re-render; re-mask immediately purges DOM & caches with safe retry) ──
        if (target.closest('#privacyToggle')) {
            const nextMasked = !isAccountMasked();
            setPrivacyMaskLocalState(nextMasked);
            if (nextMasked) { purgeRevealedPrivacyData(); }
            applyPrivacyMask();
            sendPrivacyMaskUpdate(nextMasked);
            announcePolite(nextMasked ? a11yStrings.privacyMasked : a11yStrings.privacyRevealed);
            return;
        }
        if (target.closest('[data-action="retryPrivacyRemask"]')) {
            renderPrivacyRemaskPlaceholder(false);
            sendPrivacyMaskUpdate(true);
            return;
        }

        // ── App Onboarding Banner Actions ──
        if (target.closest('[data-action="openOverlaysCdpSettings"]')) {
            switchTab('settings', false, false, 'settings-cdp-card');
            return;
        }
        const onbToggle = target.closest('[data-action="dismissAppOnboarding"], [data-action="resetAppOnboarding"]');
        if (onbToggle) {
            const dis = onbToggle.getAttribute('data-action') === 'dismissAppOnboarding';
            const prevDis = appOnboardingDismissedLocal;
            const fbId = dis ? 'onboardingFeedback' : 'appOverlaysFeedback';
            const onFail = (errMsg?: string) => {
                syncAppOnboardingBannerUi({ dismissed: prevDis });
                const txt = errMsg || a11yStrings.settingsSaveFailed || strings.grFailedText;
                flashFeedback(fbId, txt, 3500);
                announcePolite(txt);
            };
            sendBridgeOrPost(
                { command: 'dismissAppOnboarding', dismissed: dis },
                (res) => {
                    if (!res || res.ok === false) {
                        onFail(typeof res?.error === 'string' ? res.error : undefined);
                        return;
                    }
                    syncAppOnboardingBannerUi({ dismissed: dis });
                    if (!dis) { flashFeedback('appOverlaysFeedback', strings.savedText, 2500); }
                    announcePolite(a11yStrings.settingsSaved || strings.savedText);
                },
                () => { onFail(); },
                () => { syncAppOnboardingBannerUi({ dismissed: dis }); },
            );
            return;
        }

        // ── Hardened Antigravity Global Rules (~/.gemini/GEMINI.md) Actions ──
        const grBtn = target.closest('[data-action="readGlobalRulesFile"], [data-action="saveGlobalRulesFile"], [data-action="openGlobalRulesFile"], [data-action="revealGlobalRulesFile"]');
        if (grBtn) {
            const cmd = grBtn.getAttribute('data-action') || '';
            const payload: Record<string, unknown> = { command: cmd };
            if (cmd === 'saveGlobalRulesFile') {
                const sb = byId('globalRulesSaveBtn') as HTMLButtonElement | null;
                if ((sb && sb.disabled) || (globalRulesExists && !globalRulesLoaded) || globalRulesTooLarge || Boolean(globalRulesErr)) { return; }
                const content = (byId('globalRulesEditor') as HTMLTextAreaElement | null)?.value || '';
                const maxB = Number(byId('globalRulesCard')?.getAttribute('data-gr-max-bytes')) || (200 * 1024);
                const byteLen = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(content).length : content.length * 3;
                if (byteLen > maxB) { flashFeedback('globalRulesFeedback', strings.grTooLargeText, 4500); return; }
                payload.content = content;
                if (!globalRulesExists) { payload.createOnly = true; }
            }
            const kind = cmd === 'readGlobalRulesFile' ? 'read' : (cmd === 'saveGlobalRulesFile' ? 'save' : 'action');
            const fallbackAct = cmd === 'revealGlobalRulesFile' ? 'reveal' : 'open';
            setGlobalRulesBusy(true);
            setFeedback('globalRulesFeedback', cmd === 'revealGlobalRulesFile' ? strings.revealingText : strings.openingText);
            sendBridgeOrPost(
                payload,
                (res) => { handleGlobalRulesReply(kind, res, fallbackAct); },
                (err) => {
                    setGlobalRulesBusy(false);
                    flashFeedback('globalRulesFeedback', isStandaloneBlockedError(null, err) ? strings.grStandaloneBlockedText : strings.grFailedText, 4500);
                },
                () => { scheduleTimeout(() => { setGlobalRulesBusy(false); }, 3500); },
            );
            return;
        }

        // ── Settings: State File Actions ──
        if (target.closest('#copyStatePath')) {
            vscode.postMessage({ command: 'copyStatePath' });
            return;
        }
        if (target.closest('#openStateFile')) {
            setFeedback('statePathFeedback', strings.openingText);
            vscode.postMessage({ command: 'openStateFile' });
            return;
        }
        if (target.closest('#revealStateFile')) {
            setFeedback('statePathFeedback', strings.revealingText);
            vscode.postMessage({ command: 'revealStateFile' });
            return;
        }
        if (target.closest('#restoreTabScrollHint')) {
            setTabHintState(true);
            const hint = byId('tabScrollHint');
            if (hint) {
                hint.setAttribute('data-force-show', 'true');
                hint.hidden = false;
            }
            vscode.postMessage({ command: 'setPanelPref', key: 'panelShowTabScrollHint', value: true });
            return;
        }

        // ── Native HUD Expand/Collapse Toggle ──
        const hudToggleBtn = target.closest('[data-action="toggleNativeHud"]');
        if (hudToggleBtn) {
            const nextHudExp = hudToggleBtn.getAttribute('aria-expanded') !== 'true';
            const hudSt = vscode.getState() || {};
            hudSt.nativeHudExpanded = nextHudExp;
            vscode.setState(hudSt);
            applyNativeHudExpanded(nextHudExp);
            vscode.postMessage({ command: 'toggleNativeHud', expanded: nextHudExp });
            return;
        }

        // ── Orchestrator Pricing Mode Toggle ──
        const orchModeBtn = target.closest('[data-action="setOrchestratorPricingMode"]');
        if (orchModeBtn) {
            const nextPricingMode = orchModeBtn.getAttribute('data-mode') === 'strict' ? 'strict' : 'mapped';
            syncOrchestratorPricingModeVisual(nextPricingMode);
            flashFeedback('orchPricingModeFeedback', strings.savedText, 2000);
            vscode.postMessage({ command: 'setOrchestratorPricingMode', mode: nextPricingMode });
            return;
        }

        // ── CDP Recheck Action ──
        const recheckCdpBtn = target.closest<HTMLButtonElement>('[data-action="recheckCdp"]');
        if (recheckCdpBtn) {
            recheckCdpBtn.disabled = true;
            setFeedback('appOverlaysFeedback', strings.cdpCheckingText);
            sendBridgeOrPost({ command: 'recheckCdp' }, (payload) => {
                recheckCdpBtn.disabled = false;
                const nextCdp = (payload && payload.cdpStatus)
                    ? payload.cdpStatus as CdpStatusLike
                    : (payload && typeof payload.state === 'string' ? payload as CdpStatusLike : null);
                if (nextCdp) {
                    syncCdpStatusUi(nextCdp);
                    const resLabel = nextCdp.state === 'connected' ? strings.cdpConnectedText
                        : (nextCdp.state === 'error' ? strings.cdpErrorText
                            : (nextCdp.state === 'disabled' ? strings.cdpDisabledText : strings.cdpInactiveText));
                    flashFeedback('appOverlaysFeedback', resLabel, 3200);
                } else {
                    flashFeedback('appOverlaysFeedback', strings.savedText, 2200);
                }
            }, () => {
                recheckCdpBtn.disabled = false;
                flashFeedback('appOverlaysFeedback', strings.checkFailedText, 3000);
            }, () => {
                scheduleTimeout(() => { recheckCdpBtn.disabled = false; }, 1200);
            });
            return;
        }

        // ── Persistent CDP Launcher Actions (Settings card & Overview Onboarding banner) ──
        const launcherActionBtn = target.closest('[data-action="setupCdpLauncher"], [data-action="revealCdpLauncher"], [data-action="removeCdpLauncher"]');
        if (launcherActionBtn) {
            const launcherCmd = launcherActionBtn.getAttribute('data-action');
            const extraFbId = launcherActionBtn.getAttribute('data-feedback-id') || '';
            const setDis = (dis: boolean) => { for (const id of LAUNCHER_BTN_IDS) { const b = byId(id) as HTMLButtonElement | null; if (b) { b.disabled = dis; } } };
            const busyMsg = launcherCmd === 'removeCdpLauncher' ? strings.cdpLauncherRemovingText : (launcherCmd === 'revealCdpLauncher' ? strings.revealingText : strings.cdpLauncherCreatingText);
            setDis(true);
            setFeedback('cdpLauncherFeedback', busyMsg);
            if (extraFbId) { setFeedback(extraFbId, busyMsg); }
            sendBridgeOrPost(
                { command: launcherCmd },
                (p) => { applyCdpLauncherReply(p, launcherCmd, extraFbId); },
                () => { applyCdpLauncherReply(null, launcherCmd, extraFbId); },
                () => { scheduleTimeout(() => { setDis(false); }, 1800); },
            );
            return;
        }

        // ── CDP Guide Command Copy Button ──
        const cdpCopyBtn = target.closest<CopyButtonEl>('.cdp-copy-btn[data-copy-command]');
        if (cdpCopyBtn) {
            const cmdText = cdpCopyBtn.getAttribute('data-copy-command') || '';
            if (cmdText) {
                copyTextSafe(cmdText).then((ok) => {
                    if (ok) {
                        flashCopyButton(cdpCopyBtn);
                    } else {
                        vscode.postMessage({ command: 'copyText', text: cmdText, source: 'cdpGuideCommand' });
                        flashCopyButton(cdpCopyBtn);
                    }
                });
            }
            return;
        }

        // ── Updates & Release Check Actions ──
        if (target.closest('[data-action="checkForUpdates"]')) {
            setFeedback('updatesFeedback', strings.checkingUpdatesText);
            vscode.postMessage({ command: 'checkForUpdates', force: true });
            return;
        }
        if (target.closest('[data-action="applyPluginUpdate"]')) {
            setFeedback('updatesFeedback', strings.upgradingText);
            vscode.postMessage({ command: 'applyPluginUpdate' });
            return;
        }

        // ── External URL Open Action ──
        const extUrlEl = target.closest('[data-action="openExternalUrl"]');
        if (extUrlEl) {
            const targetUrl = extUrlEl.getAttribute('data-url') || extUrlEl.getAttribute('href') || '';
            if (targetUrl) {
                e.preventDefault();
                vscode.postMessage({ command: 'openExternalUrl', url: targetUrl });
            }
            return;
        }

        // ── Settings: Calendar Retention Save Button ──
        if (target.closest('#calendarRetentionSaveBtn')) {
            const calRetInput = byId('calendarRetentionInput');
            if (calRetInput) { commitAppSettingControl(calRetInput); }
            return;
        }

        // ── Calendar Controls ──
        for (const [cmd, attr, key, def] of [
            ['calendarFilterSource', 'data-cal-source', 'source', 'all'],
            ['calendarSetMetric', 'data-cal-metric', 'metric', 'tokens'],
            ['calendarSetPeriod', 'data-cal-period', 'period', 'daily'],
            ['calendarSetView', 'data-cal-view', 'view', 'heatmap'],
        ] as const) {
            const btn = target.closest('[data-action="' + cmd + '"]');
            if (btn) { vscode.postMessage({ command: cmd, [key]: btn.getAttribute(attr) || def }); return; }
        }
        const calExportBtn = target.closest('[data-action="calendarExportMarkdown"], [data-action="calendarExportCsv"], [data-action="calendarExportJson"]');
        if (calExportBtn) {
            const exportCmd = calExportBtn.getAttribute('data-action');
            const exportPayload: Record<string, unknown> = { command: exportCmd };
            const startDate = calExportBtn.getAttribute('data-start-date');
            const endDate = calExportBtn.getAttribute('data-end-date');
            const selectedDatesRaw = calExportBtn.getAttribute('data-selected-dates');
            const surfaceFilter = calExportBtn.getAttribute('data-surface-filter');
            if (startDate) { exportPayload.startDate = startDate; }
            if (endDate) { exportPayload.endDate = endDate; }
            if (selectedDatesRaw !== null) {
                exportPayload.selectedDates = selectedDatesRaw ? selectedDatesRaw.split(',').filter(Boolean) : [];
            }
            if (surfaceFilter) { exportPayload.surfaceFilter = surfaceFilter; }
            if (bridge && bridge.surface !== 'vscode' && typeof bridge.sendAction === 'function') {
                bridge.sendAction(exportPayload).then((res) => {
                    const payload = (res && res.result ? res.result : res) as Record<string, unknown> | null;
                    if (payload && typeof payload.content === 'string') {
                        triggerClientDownload(
                            payload.filename as string | undefined,
                            payload.content,
                            payload.mimeType as string | undefined,
                        );
                    }
                });
            } else {
                vscode.postMessage(exportPayload);
            }
            return;
        }

        // ── Calendar Two-Step Safe Clear History ──
        const calClearArmBtn = target.closest('[data-action="calendarClearArm"]');
        if (calClearArmBtn) {
            const confirmBar = byId('calClearConfirmBar');
            if (confirmBar) {
                const nextOpen = confirmBar.hidden;
                confirmBar.hidden = !nextOpen;
                calClearArmBtn.setAttribute('aria-expanded', String(nextOpen));
            }
            return;
        }
        if (target.closest('[data-action="calendarClearConfirm"]')) {
            const confirmBar2 = byId('calClearConfirmBar');
            const armBtn2 = byId('clearCalendarBtn');
            if (confirmBar2) { confirmBar2.hidden = true; }
            if (armBtn2) { armBtn2.setAttribute('aria-expanded', 'false'); }
            vscode.postMessage({ command: 'clearCalendarHistory' });
            return;
        }
        if (target.closest('[data-action="calendarClearCancel"]')) {
            const confirmBar3 = byId('calClearConfirmBar');
            const armBtn3 = byId('clearCalendarBtn');
            if (confirmBar3) { confirmBar3.hidden = true; }
            if (armBtn3) {
                armBtn3.setAttribute('aria-expanded', 'false');
                armBtn3.focus();
            }
            return;
        }

        // ── Calendar Jump Date ──
        const calJumpBtn = target.closest('[data-action="calendarJumpDate"]');
        if (calJumpBtn) {
            const jumpDate = calJumpBtn.getAttribute('data-cal-date') || '';
            if (jumpDate) {
                const js = vscode.getState() || {};
                js.calendarSelectedDate = jumpDate;
                vscode.setState(js);
                const parts = jumpDate.split('-');
                const jYr = parts.length >= 2 ? parseInt(parts[0], 10) : 0;
                const jMo = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
                const jumpPanel = document.querySelector<HTMLElement>('[data-cal-detail="' + jumpDate + '"]');
                if (jumpPanel) {
                    const allJumpPanels = document.querySelectorAll<HTMLElement>('[data-cal-detail]');
                    for (let jpi = 0; jpi < allJumpPanels.length; jpi++) {
                        const isTarget = allJumpPanels[jpi] === jumpPanel;
                        allJumpPanels[jpi].classList.toggle('cal-detail-open', isTarget);
                        allJumpPanels[jpi].style.display = isTarget ? 'block' : 'none';
                    }
                    jumpPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                vscode.postMessage({ command: 'calendarJumpDate', date: jumpDate, year: jYr || undefined, month: jMo || undefined });
            }
            return;
        }

        // ── Date Cell / Heatmap Cell Click ──
        const cell = target.closest('[data-action="calendarSelectDate"], .cal-cell.has-data');
        if (cell) {
            const date = cell.getAttribute('data-cal-date');
            if (!date) { return; }
            let newSelected = '';
            let matchedLocalPanel = false;
            const allPanels = document.querySelectorAll<HTMLElement>('[data-cal-detail]');
            for (let pi = 0; pi < allPanels.length; pi++) {
                const p = allPanels[pi];
                if (p.getAttribute('data-cal-detail') === date) {
                    matchedLocalPanel = true;
                    const isHidden = !p.classList.contains('cal-detail-open');
                    p.classList.toggle('cal-detail-open', isHidden);
                    p.style.display = isHidden ? 'block' : 'none';
                    cell.classList.toggle('selected', isHidden);
                    if (isHidden) { newSelected = date; }
                } else {
                    p.classList.remove('cal-detail-open');
                    p.style.display = 'none';
                }
            }
            if (!matchedLocalPanel) {
                newSelected = date;
            }
            const allCells = document.querySelectorAll('.cal-cell.has-data, .cal-hm-cell.has-data');
            for (let oi = 0; oi < allCells.length; oi++) {
                if (allCells[oi] !== cell) {
                    allCells[oi].classList.remove('selected');
                }
            }
            const cs = vscode.getState() || {};
            cs.calendarSelectedDate = newSelected;
            vscode.setState(cs);
            vscode.postMessage({ command: 'calendarSelectDate', date: newSelected || null });
            return;
        }

        // ── Remove Cached Account (opaque accountHandle preferred; legacy data-email fallback) ──
        const acctDelBtn = target.closest('.acct-delete-btn');
        if (acctDelBtn) {
            const acctHandle = (acctDelBtn.getAttribute('data-account-handle') || acctDelBtn.getAttribute('data-account-id') || '').trim();
            const email = (acctDelBtn.getAttribute('data-email') || '').trim();
            if (acctHandle || email) {
                const remMsg: Record<string, unknown> = { command: 'removeAccount' };
                if (acctHandle) {
                    remMsg.accountHandle = acctHandle;
                } else if (email) {
                    remMsg.email = email;
                }
                vscode.postMessage(remMsg);
            }
            return;
        }

        // ── Model Stats Error Toggle ──
        const errBtn = target.closest('#modelStatsErrToggle');
        if (errBtn) {
            const st = vscode.getState() || {};
            const wasOn = !!st.modelStatsShowErrors;
            st.modelStatsShowErrors = !wasOn;
            vscode.setState(st);
            errBtn.classList.toggle('is-off', wasOn);
            const cardsGrid = document.querySelector('.act-cards-grid');
            if (cardsGrid) {
                cardsGrid.classList.toggle('model-stats-show-errors', !wasOn);
            }
            return;
        }

        // ── Model Calls Anomaly Filter Bar ──
        const gmAnomBtn = target.closest('[data-action="gmFilterAnomaly"]');
        if (gmAnomBtn) {
            const kind = gmAnomBtn.getAttribute('data-anomaly-kind') || 'all';
            const st = vscode.getState() || {};
            st.gmAnomalyFilter = kind;
            vscode.setState(st);
            applyGmAnomalyFilter(kind);
            return;
        }

        // ── Chat History actions ──
        const historyBtn = target.closest<HTMLButtonElement>('[data-history-action]');
        if (historyBtn) {
            if (historyBtn.disabled) { return; }
            vscode.postMessage({
                command: 'historyAction',
                action: historyBtn.getAttribute('data-history-action'),
                cascadeId: historyBtn.getAttribute('data-cascade-id') || '',
                uri: historyBtn.getAttribute('data-history-uri') || '',
            });
            return;
        }

        // ── Calendar Summary Toggle (Monthly / All-Time) ──
        const summaryBtn = target.closest('.cal-summary-btn');
        if (summaryBtn) {
            const mode = summaryBtn.getAttribute('data-summary-mode');
            const monthlyPane = byId('calSummaryMonthly');
            const alltimePane = byId('calSummaryAllTime');
            const toggleWrap = summaryBtn.closest('.cal-summary-toggle');
            if (toggleWrap) {
                const btns = toggleWrap.querySelectorAll('.cal-summary-btn');
                for (let sb = 0; sb < btns.length; sb++) { btns[sb].classList.remove('active'); }
                summaryBtn.classList.add('active');
            }
            if (monthlyPane && alltimePane) {
                if (mode === 'alltime') {
                    monthlyPane.style.display = 'none';
                    alltimePane.style.display = 'block';
                } else {
                    monthlyPane.style.display = 'block';
                    alltimePane.style.display = 'none';
                }
            }
            return;
        }

        // ── Month Navigation & Chart Jump Triggers ──
        const navBtn = target.closest('[data-cal-nav], .cal-nav-btn');
        if (navBtn) {
            const yr = navBtn.getAttribute('data-cal-year');
            const mo = navBtn.getAttribute('data-cal-month');
            if (yr && mo) {
                vscode.postMessage({ command: 'switchCalendarMonth', year: parseInt(yr, 10), month: parseInt(mo, 10) });
            }
            return;
        }
    });

    // ─── Unified Incremental DOM Patcher (VS Code messages + acm:snapshot) ───
    let lastHandledOverlayTabSeq = Number(savedState.lastHandledOverlayTabSeq) || 0;

    function maybeHandleOverlayTargetTab(snapshot: IncrementalUpdatePayload['snapshot'], preserveView = false): void {
        const req = snapshot && snapshot.meta && snapshot.meta.overlayTargetTab;
        if (!req || typeof req !== 'object') { return; }
        const seq = Number(req.seq);
        const rawTab = typeof req.tab === 'string' ? req.tab.trim() : '';
        if (!isFinite(seq) || seq <= 0 || !rawTab) { return; }
        if (seq <= lastHandledOverlayTabSeq) { return; }
        lastHandledOverlayTabSeq = seq;
        if (!preserveView) { switchTab(rawTab, false, false); }
        const st = vscode.getState() || {};
        st.lastHandledOverlayTabSeq = seq;
        vscode.setState(st);
    }

    function resolveIncrementalPatchTarget(key: string): { el: HTMLElement | null; slotKey: string; paneName: string; unhideWhenNonEmpty?: boolean } {
        const norm = key.toLowerCase();
        const route = TAB_ROUTES[norm];
        if (!route) {
            return { el: byId('tab-' + norm), slotKey: norm, paneName: norm };
        }
        const [tab, slotName, , legacy, unhideWhenNonEmpty] = route;
        const slotKey = slotName || tab;
        const slotEl = slotName ? byId('slot-' + slotName) : null;
        if (slotEl) { return { el: slotEl, slotKey, paneName: tab, unhideWhenNonEmpty }; }
        const tabEl = byId('tab-' + tab);
        if (tabEl && (!legacy || !byId('tab-' + legacy))) {
            return { el: tabEl, slotKey, paneName: tab };
        }
        const legacyEl = legacy ? byId('tab-' + legacy) : null;
        return { el: legacyEl || tabEl, slotKey, paneName: legacyEl ? legacy! : tab };
    }

    function applyIncrementalUpdate(msg: IncrementalUpdatePayload): void {
        if (!msg || !msg.tabs) { return; }
        const hasHostMask = typeof msg.privacyMasked === 'boolean' || (msg.snapshot && typeof msg.snapshot.privacyMasked === 'boolean');
        if (hasHostMask) {
            const nextHostMask = typeof msg.privacyMasked === 'boolean' ? msg.privacyMasked : Boolean(msg.snapshot && msg.snapshot.privacyMasked);
            // Fail-closed: never allow a stale unmasked snapshot to repaint while re-mask is pending/failed!
            if (privacyRemaskState && !nextHostMask) { return; }
            const prevMaskState = isAccountMasked();
            setPrivacyMaskLocalState(nextHostMask);
            if (nextHostMask && !prevMaskState) {
                purgeRevealedPrivacyData();
            }
        }
        const tabs = msg.tabs;
        const visibleEocTabs = captureVisibleEocTabs();
        const changedTabKeys: string[] = [];

        const scrollableSelectors = ['.raw-json', '.act-timeline', '.details-body', '.cp-viewer', '.cp-card-body'];
        const savedScrolls: Record<string, number> = {};
        for (let ss = 0; ss < scrollableSelectors.length; ss++) {
            const sel = scrollableSelectors[ss];
            const els = document.querySelectorAll(sel);
            for (let se = 0; se < els.length; se++) {
                if (els[se].scrollTop > 0) {
                    savedScrolls[sel + ':' + se] = els[se].scrollTop;
                }
            }
        }

        const patchedSlots = new Set<string>();
        const hasCanonicalGm = typeof tabs.gm === 'string';
        const hasCanonicalSessions = typeof tabs.sessions === 'string';
        for (const key in tabs) {
            if (!Object.prototype.hasOwnProperty.call(tabs, key)) { continue; }
            if (hasCanonicalGm && (key === 'gmdata' || key === 'gm-data')) { continue; }
            if (hasCanonicalSessions && (key === 'chats' || key === 'chat-history')) { continue; }
            const tabHtml = tabs[key];
            if (typeof tabHtml !== 'string') { continue; }
            const resolved = resolveIncrementalPatchTarget(key);
            const pane = resolved.el;
            if (!pane || patchedSlots.has(resolved.slotKey)) { continue; }
            if (lastTabHtmls[resolved.slotKey] === tabHtml) { continue; }
            patchedSlots.add(resolved.slotKey);

            const isPricingSlot = resolved.slotKey === 'pricing';
            const isProfileSlot = resolved.slotKey === 'profile';
            const isOverviewSlot = resolved.slotKey === 'overview';
            const pricingDrafts = new Map<string, { value: string; focused: boolean }>();
            if (isPricingSlot) {
                pane.querySelectorAll<HTMLInputElement>('.pricing-input').forEach((input) => {
                    if (input.value !== (input.getAttribute('data-original-value') || '')) {
                        const identity = JSON.stringify([input.getAttribute('data-model'), input.getAttribute('data-field')]);
                        pricingDrafts.set(identity, { value: input.value, focused: input === document.activeElement });
                    }
                });
            }
            const activeEl = document.activeElement as HTMLElement | null;
            const focusedId = activeEl && pane.contains(activeEl) && activeEl.id && /^[A-Za-z0-9_-]+$/.test(activeEl.id)
                ? activeEl.id
                : '';
            const overviewFocus = isOverviewSlot && activeEl && pane.contains(activeEl)
                ? (activeEl.dataset ? activeEl.dataset.overviewFocus : undefined)
                : undefined;
            const diagnostics = isOverviewSlot ? pane.querySelector<HTMLDetailsElement>('#overview-session-diagnostics') : null;
            if (diagnostics && diagnostics.dataset && diagnostics.dataset.stateKey) {
                const overviewState = vscode.getState() || {};
                const openDetails = overviewState.detailsOpen || {};
                openDetails[diagnostics.dataset.stateKey] = diagnostics.open;
                overviewState.detailsOpen = openDetails;
                vscode.setState(overviewState);
            }
            let savedHandoffPreview: { s: string; r: string; v: string; d: boolean; f: boolean } | null = null;
            if (isOverviewSlot) {
                const ob = pane.querySelector<HTMLElement>('#handoffV2PreviewBox');
                const ot = pane.querySelector<HTMLTextAreaElement>('#handoffV2PreviewText');
                if (ob && ot && !ob.hidden) {
                    savedHandoffPreview = {
                        s: ob.getAttribute('data-subject-cascade-id') || '',
                        r: ob.getAttribute('data-data-revision') || pane.querySelector('#previewHandoffV2Btn')?.getAttribute('data-data-revision') || '',
                        v: ot.value,
                        d: Boolean(ob.querySelector<HTMLButtonElement>('[data-action="copyHandoffPreviewText"]')?.disabled),
                        f: Boolean(activeEl && (activeEl === ot || ob.contains(activeEl))),
                    };
                }
            }
            const billingInput = isProfileSlot ? pane.querySelector<HTMLInputElement>('#profileBillingDayInput') : null;
            const billingDraft = billingInput && billingInput.value !== billingInput.defaultValue ? billingInput.value : null;
            const billingFocused = billingInput && billingInput === document.activeElement;
            const billingAccount = billingInput
                ? (billingInput.getAttribute('data-account-handle') || billingInput.getAttribute('data-account-id') || billingInput.getAttribute('data-email') || '')
                : '';
            const privacyFocused = isProfileSlot && document.activeElement && document.activeElement.id === 'privacyToggle';
            // Native toggle events are queued. Snapshot the actual disclosure before replacing
            // its node, even when polling wins the race with that event.
            const swarmDetails = pane.querySelectorAll<HTMLDetailsElement>('.swarm-member-details[id], .ses-swarm-group[id], .swarm-ended[id]');
            if (swarmDetails.length) {
                const detailsState = vscode.getState() || {};
                const open = detailsState.detailsOpen || {};
                for (const detail of Array.from(swarmDetails)) { open[detail.id] = detail.open; }
                detailsState.detailsOpen = open;
                vscode.setState(detailsState);
            }
            pane.innerHTML = tabHtml;
            if (resolved.unhideWhenNonEmpty) {
                pane.hidden = !tabHtml.trim();
            }
            if (savedHandoffPreview) {
                const nb = pane.querySelector<HTMLElement>('#handoffV2PreviewBox');
                const nt = pane.querySelector<HTMLTextAreaElement>('#handoffV2PreviewText');
                const ns = nb?.getAttribute('data-subject-cascade-id') || '';
                const nr = nb?.getAttribute('data-data-revision') || pane.querySelector('#previewHandoffV2Btn')?.getAttribute('data-data-revision') || '';
                const sameSubject = !savedHandoffPreview.s || !ns || ns === savedHandoffPreview.s;
                const revChanged = Boolean(savedHandoffPreview.r && nr && nr !== savedHandoffPreview.r);
                if (nb && nt && sameSubject) {
                    const cb = nb.querySelector<HTMLButtonElement>('[data-action="copyHandoffPreviewText"]');
                    if (revChanged) {
                        handoffPreviewSeq++;
                        handoffPreviewPendingSeq = 0;
                        nt.value = strings.handoffStaleRevisionText;
                        nb.hidden = false;
                        if (cb) {
                            cb.disabled = true;
                            cb.setAttribute('data-handoff-stale', 'true');
                        }
                    } else {
                        nt.value = savedHandoffPreview.v;
                        if (savedHandoffPreview.r) { nb.setAttribute('data-data-revision', savedHandoffPreview.r); }
                        nb.hidden = false;
                        if (cb) { cb.disabled = savedHandoffPreview.d; }
                        if (savedHandoffPreview.f) { nt.focus?.({ preventScroll: true }); }
                    }
                } else if (savedHandoffPreview.s && ns && ns !== savedHandoffPreview.s) {
                    handoffPreviewSeq++;
                    handoffPreviewPendingSeq = 0;
                }
            }
            if (billingInput) {
                const nextBilling = pane.querySelector<HTMLInputElement>('#profileBillingDayInput');
                const nextBillingAccount = nextBilling
                    ? (nextBilling.getAttribute('data-account-handle') || nextBilling.getAttribute('data-account-id') || nextBilling.getAttribute('data-email') || '')
                    : '';
                if (nextBilling && nextBillingAccount === billingAccount) {
                    if (billingDraft !== null) { nextBilling.value = billingDraft; }
                    if (billingFocused) { nextBilling.focus({ preventScroll: true }); }
                }
            }
            if (privacyFocused) {
                const privBtn = pane.querySelector<HTMLElement>('#privacyToggle');
                if (privBtn) { privBtn.focus({ preventScroll: true }); }
            }
            if (overviewFocus) {
                const focusTarget = Array.from(pane.querySelectorAll<HTMLElement>('[data-overview-focus]')).find((el) => {
                    return el.dataset && el.dataset.overviewFocus === overviewFocus;
                });
                if (focusTarget) { focusTarget.focus({ preventScroll: true }); }
                else {
                    const overviewHeading = pane.querySelector<HTMLElement>('#overview-heading');
                    if (overviewHeading) { overviewHeading.focus({ preventScroll: true }); }
                }
            }
            if (pricingDrafts.size) {
                pane.querySelectorAll<HTMLInputElement>('.pricing-input').forEach((input) => {
                    const identity = JSON.stringify([input.getAttribute('data-model'), input.getAttribute('data-field')]);
                    const draft = pricingDrafts.get(identity);
                    if (draft) {
                        input.value = draft.value;
                        if (draft.focused) { input.focus({ preventScroll: true }); }
                    }
                });
            }
            if (focusedId && (!document.activeElement || !pane.contains(document.activeElement))) {
                const restoredEl = pane.querySelector<HTMLElement>('#' + focusedId);
                if (restoredEl && !restoredEl.hidden && typeof restoredEl.focus === 'function') {
                    restoredEl.focus({ preventScroll: true });
                }
            }
            lastTabHtmls[resolved.slotKey] = tabHtml;
            changedTabKeys.push(resolved.paneName);
        }
        if (changedTabKeys.length > 0 && privacyRemaskState) {
            privacyRemaskState = '';
            privacyOpSeq++;
        }

        // Patch masthead context controls without disrupting an open <select> dropdown.
        const nextMasthead = typeof tabs.mastheadControls === 'string'
            ? tabs.mastheadControls
            : (typeof msg.mastheadControls === 'string' ? msg.mastheadControls : null);
        if (nextMasthead !== null && nextMasthead !== lastMastheadHtml) {
            const mhEl = byId('mastheadContextBar');
            const swEl = byId('conversationSwitcher');
            if (mhEl) {
                if (!swEl || document.activeElement !== swEl) {
                    mhEl.innerHTML = nextMasthead;
                    lastMastheadHtml = nextMasthead;
                } else {
                    const tmpMh = document.createElement('div');
                    tmpMh.innerHTML = nextMasthead;
                    const nextBadges = tmpMh.querySelector('.masthead-context-badges');
                    const curBadges = mhEl.querySelector('.masthead-context-badges');
                    if (nextBadges && curBadges && curBadges.innerHTML !== nextBadges.innerHTML) {
                        curBadges.innerHTML = nextBadges.innerHTML;
                    }
                    const nextLock = tmpMh.querySelector('#lockMainBtn');
                    const curLock = mhEl.querySelector('#lockMainBtn');
                    if (nextLock && curLock) {
                        curLock.className = nextLock.className;
                        curLock.setAttribute('aria-pressed', nextLock.getAttribute('aria-pressed') || 'false');
                        if (curLock.innerHTML !== nextLock.innerHTML) {
                            curLock.innerHTML = nextLock.innerHTML;
                        }
                    }
                }
            }
        }

        // Patch Native Ambient HUD without losing expanded state
        const nextNativeHud = typeof tabs.nativeHud === 'string'
            ? tabs.nativeHud
            : (typeof msg.nativeHud === 'string' ? msg.nativeHud : null);
        if (nextNativeHud !== null && nextNativeHud !== lastNativeHudHtml) {
            const hudHostEl = byId('nativeHudHost');
            if (hudHostEl) {
                hudHostEl.innerHTML = nextNativeHud;
                hudHostEl.setAttribute('data-hud-enabled', nextNativeHud.trim() ? 'true' : 'false');
                lastNativeHudHtml = nextNativeHud;
                applyNativeHudExpanded(getNativeHudExpanded());
                syncNativeHudVisibility();
            }
        }

        for (let cti = 0; cti < changedTabKeys.length; cti++) {
            if (visibleEocTabs[changedTabKeys[cti]]) {
                restoreVisibleEoc(changedTabKeys[cti]);
            }
        }

        // CRITICAL: restore details, context viz mode & locked category drawer immediately after innerHTML swap
        restoreDetailsState(vscode.getState() || {});
        applyContextVizMode(getContextVizMode());
        renderLockedCtxDrawer();

        for (let rs = 0; rs < scrollableSelectors.length; rs++) {
            const rsel = scrollableSelectors[rs];
            const rels = document.querySelectorAll(rsel);
            for (let re = 0; re < rels.length; re++) {
                const rkey = rsel + ':' + re;
                if (savedScrolls[rkey]) {
                    rels[re].scrollTop = savedScrolls[rkey];
                }
            }
        }

        if (msg.time) {
            const timeEl = document.querySelector('.update-time');
            if (timeEl) {
                const pausedEl = timeEl.querySelector('.paused-indicator');
                timeEl.textContent = '';
                if (pausedEl) { timeEl.appendChild(pausedEl); }
                timeEl.appendChild(document.createTextNode(' ' + msg.time));
            }
        }

        const calSel = (vscode.getState() || {}).calendarSelectedDate || '';
        if (calSel) {
            const calPanel = document.querySelector<HTMLElement>('[data-cal-detail="' + calSel + '"]');
            const calCell = document.querySelector<HTMLElement>('.cal-cell.has-data[data-cal-date="' + calSel + '"]');
            if (calPanel) {
                calPanel.style.display = 'block';
                calPanel.style.animation = 'none';
                calPanel.classList.add('cal-detail-open');
            }
            if (calCell) { calCell.classList.add('selected'); }
        }

        applyPrivacyMask();

        if (typeof tabs.accountPopover === 'string') {
            const popBody = byId('acctPopoverBody');
            const nextPopHtml = tabs.accountPopover || emptyAccountPopoverHtml;
            if (popBody && nextPopHtml !== lastAccountPopoverHtml) {
                popBody.innerHTML = nextPopHtml;
                lastAccountPopoverHtml = nextPopHtml;
            }
        }
        const dotEl = document.querySelector('.acct-popover-dot');
        if (tabs.accountPopoverHasReady) {
            if (!dotEl) {
                const trigEl = byId('acctPopoverTrigger');
                if (trigEl) {
                    const d = document.createElement('span');
                    d.className = 'acct-popover-dot';
                    trigEl.appendChild(d);
                }
            }
        } else {
            if (dotEl) { dotEl.remove(); }
        }

        if (msg.snapshot && typeof msg.snapshot.lockToMainAgent === 'boolean') {
            syncLockMainVisual(msg.snapshot.lockToMainAgent);
        }
        const liveCdpStatus = (msg.snapshot && msg.snapshot.data && msg.snapshot.data.cdpStatus)
            || (msg.snapshot && msg.snapshot.cdpStatus)
            || msg.cdpStatus
            || null;
        if (liveCdpStatus && typeof liveCdpStatus === 'object') {
            syncCdpStatusUi(liveCdpStatus);
        }
        const liveUpdateStatus = (msg.snapshot && msg.snapshot.data && msg.snapshot.data.updateStatus)
            || (msg.snapshot && msg.snapshot.updateStatus)
            || msg.updateStatus
            || null;
        if (liveUpdateStatus && typeof liveUpdateStatus === 'object') {
            syncUpdateStatusUi(liveUpdateStatus);
        }
        const lgr = (msg.snapshot?.data?.globalRules || msg.globalRules) as Record<string, unknown> | undefined;
        if (lgr && typeof lgr === 'object') {
            applyGlobalRulesUiState({
                path: typeof lgr.path === 'string' ? lgr.path : undefined,
                exists: typeof lgr.exists === 'boolean' ? lgr.exists : undefined,
                sizeBytes: typeof lgr.sizeBytes === 'number' ? lgr.sizeBytes : undefined,
                tooLarge: typeof lgr.tooLarge === 'boolean' ? lgr.tooLarge : undefined,
                error: typeof lgr.error === 'string' ? lgr.error : '',
                setEditorValue: false,
            });
        }
        const las = msg.snapshot?.data?.appSettings as Record<string, unknown> | undefined;
        syncAppOnboardingBannerUi(las && typeof las === 'object' ? {
            dismissed: typeof las.appOnboardingDismissed === 'boolean' ? las.appOnboardingDismissed : undefined,
            topBarOn: typeof las.appTopBarEnabled === 'boolean' ? las.appTopBarEnabled : undefined,
            composerOn: typeof las.appComposerRingEnabled === 'boolean' ? las.appComposerRingEnabled : undefined,
            cdpState: typeof liveCdpStatus?.state === 'string' ? liveCdpStatus.state : undefined,
        } : undefined);
        // Apply the explicit member request before any passive overlay destination.
        const hadMemberRequest = Boolean(memberNavigation || awaitingMemberExit);
        finishMemberNavigation();
        if (msg.snapshot) {
            maybeHandleOverlayTargetTab(msg.snapshot, hadMemberRequest);
        }

        reanchorRichTipPopover();
        updateTabSlider();
        if (refreshBtn) { refreshBtn.classList.remove('spinning'); }
        bindHistoryCatalog();
        bindEocObserver();
        raf(() => { initErrorOverflow(); });

        const errToggle2 = byId('modelStatsErrToggle');
        const cardsGrid2 = document.querySelector('.act-cards-grid');
        if ((vscode.getState() || {}).modelStatsShowErrors) {
            if (errToggle2) { errToggle2.classList.remove('is-off'); }
            if (cardsGrid2) { cardsGrid2.classList.add('model-stats-show-errors'); }
        } else {
            if (errToggle2) { errToggle2.classList.add('is-off'); }
            if (cardsGrid2) { cardsGrid2.classList.remove('model-stats-show-errors'); }
        }
        applyGmAnomalyFilter();
    }

    // ─── Listen for verified extension & host-bridge tab/pricing messages ───
    addTrackedListener(window, 'message', (ev: Event) => {
        const event = ev as MessageEvent;
        const msg = extractTrustedHostMessage(event);
        if (!msg) { return; }
        if (msg.command === 'switchToTab' && typeof msg.tab === 'string' && msg.tab) {
            switchTab(msg.tab);
            if (typeof msg.requestId === 'number') {
                vscode.postMessage({ command: 'tabShown', requestId: msg.requestId });
            }
        } else if (msg && (msg.command === 'pricingSaved' || msg.command === 'pricingReset')) {
            const fb = byId('pricingFeedback');
            if (fb) {
                fb.textContent = msg.command === 'pricingSaved' ? strings.savedText : strings.resetText;
                fb.style.opacity = '1';
                scheduleTimeout(() => { fb.style.opacity = '0'; }, 2000);
            }
        } else if (msg && msg.command === 'updateTabs') {
            if (msg.snapshot && msg.snapshot === lastHandledSnapshotRef) { return; }
            if (msg.snapshot) { lastHandledSnapshotRef = msg.snapshot; }
            applyIncrementalUpdate(msg as IncrementalUpdatePayload);
        }
    });

    // ─── Listen for Antigravity App Sidecar custom snapshot events ───
    addTrackedListener(window, 'acm:snapshot', (event: Event) => {
        if (!isTrustedSnapshotCustomEvent(event)) { return; }
        const customEv = event as CustomEvent;
        const detail = customEv && customEv.detail as Record<string, unknown> | undefined;
        if (!detail || typeof detail !== 'object') { return; }
        const snap = (detail.snapshot || detail) as IncrementalUpdatePayload['snapshot'];
        if (snap && snap === lastHandledSnapshotRef) { return; }
        if (snap && snap.tabs) {
            lastHandledSnapshotRef = snap;
            applyIncrementalUpdate({
                tabs: snap.tabs,
                time: snap.time || (typeof detail.time === 'string' ? detail.time : ''),
                snapshot: snap,
            });
        } else if (snap) {
            lastHandledSnapshotRef = snap;
            maybeHandleOverlayTargetTab(snap);
        }
    });

    // ─── End-of-Content IntersectionObserver ───
    let _eocObserver: IntersectionObserver | null = null;
    function bindEocObserver(): void {
        if (typeof IntersectionObserver === 'undefined') { return; }
        if (_eocObserver) { _eocObserver.disconnect(); }
        _eocObserver = new IntersectionObserver((entries) => {
            for (let ei = 0; ei < entries.length; ei++) {
                const isVisible = entries[ei].isIntersecting;
                entries[ei].target.classList.toggle('eoc-visible', isVisible);
                if (!isVisible) {
                    entries[ei].target.classList.remove('eoc-no-transition');
                }
                const tabName = getTabNameFromNode(entries[ei].target);
                if (tabName) {
                    eocVisibleTabs[tabName] = isVisible;
                }
            }
        }, { rootMargin: '0px', threshold: 0.1 });
        const eocEls = document.querySelectorAll('.eoc-sentinel');
        for (let eoi = 0; eoi < eocEls.length; eoi++) {
            _eocObserver.observe(eocEls[eoi]);
        }
    }
    bindEocObserver();

    function unmount(): void {
        if (!isMounted) { return; }
        isMounted = false;
        hideRichTip(true);
        if (_eocObserver) {
            try { _eocObserver.disconnect(); } catch { /* ignore */ }
            _eocObserver = null;
        }
        activeTimers.forEach((timer) => {
            try {
                if (typeof clearTimeout === 'function') { clearTimeout(timer); }
            } catch { /* ignore */ }
        });
        activeTimers.clear();
        for (let i = cleanups.length - 1; i >= 0; i--) {
            try { cleanups[i](); } catch { /* ignore */ }
        }
        cleanups.length = 0;
        if (win.__ACM_WEBVIEW_CLIENT__ && win.__ACM_WEBVIEW_CLIENT__.buildId === buildId) {
            try { delete win.__ACM_WEBVIEW_CLIENT__; } catch { win.__ACM_WEBVIEW_CLIENT__ = undefined; }
        }
    }

    const handle: WebviewClientRuntimeHandle = {
        installed: true,
        reused: false,
        buildId,
        unmount,
        getStatus: () => ({
            buildId,
            activeTab,
            activeAnchor,
            viewLang: currentViewLang,
            privacyMasked: isAccountMasked(),
            mounted: isMounted,
        }),
    };
    win.__ACM_WEBVIEW_CLIENT__ = handle;

    vscode.postMessage({ command: 'panelReady' });
    return handle;
}

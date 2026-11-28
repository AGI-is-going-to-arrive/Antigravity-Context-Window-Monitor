/**
 * Browser-side host bridge script generator (`window.__ACM_BRIDGE__`).
 *
 * Allows the shared Studio Telemetry Ledger webview JavaScript to run cleanly
 * across three surfaces with zero edits to the core UI logic:
 *   1. VS Code / Antigravity IDE (`acquireVsCodeApi`)
 *   2. Antigravity App Sidecar (`window.sidecar` injected by `/preload.js`)
 *   3. Standalone HTTP (for headless Chromium smoke tests & local debugging)
 *
 * Security & Ordering Guarantees (Phase 1 Wave 1B):
 * - Validates `event.source === window` and same-origin `event.origin` on `window.message`.
 * - Tracks bridge-dispatched events in a closure-private `WeakSet` (`isTrustedHostEvent`).
 * - SDK `onConversationChange` callbacks outrank stale non-empty getters and initial URLs.
 * - Focus changes are sent ONLY via dedicated `POST /api/action` (`syncHostFocus`) with
 *   monotonic `focusRevision`, `{ backendEpoch, windowId, sourceInstanceId }`, idempotent retry,
 *   and pending-state clearing ONLY on matching `ackFocusRevision`.
 * - Workspace roots are sent ONLY via dedicated `POST /api/action` (`registerWorkspaces`),
 *   including explicit `workspaceUris: []` to revoke old roots.
 * - `GET /api/snapshot` and generic `POST /api/action` NEVER carry `conversationId` or `workspaceUris`.
 * - Handles bodyless HTTP `304 Not Modified` cleanly without JSON decode errors.
 * - Enforces monotonic generation checks on BOTH GET and POST repaint handlers so stale
 *   out-of-order responses NEVER overwrite newer UI state.
 *
 * Pure Node/TypeScript — zero `vscode` imports.
 */

export interface HostBridgeOptions {
    /** Default snapshot polling interval in milliseconds (clamped to 1000..60000). */
    pollIntervalMs?: number;
    /** Whether automatic visibility-gated polling should start on load in HTTP/Sidecar mode. */
    autoPoll?: boolean;
    /** State storage namespace key for non-VS Code environments. */
    storageKey?: string;
    /** Optional initial view mode hint ('aux' | 'sidebar' | 'standalone'). */
    viewMode?: 'aux' | 'sidebar' | 'standalone';
}

const DEFAULT_POLL_INTERVAL_MS = 4000;
const MIN_POLL_INTERVAL_MS = 1000;
const MAX_POLL_INTERVAL_MS = 60000;
const DEFAULT_STORAGE_KEY = 'acm_webview_state_v1';

function clampPollInterval(ms: number | undefined): number {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) {
        return DEFAULT_POLL_INTERVAL_MS;
    }
    return Math.min(Math.max(Math.round(ms), MIN_POLL_INTERVAL_MS), MAX_POLL_INTERVAL_MS);
}

/**
 * Generates a self-contained browser JavaScript IIFE (without `<script>` tags)
 * that installs `window.__ACM_BRIDGE__` and, when running outside VS Code,
 * polyfills `window.acquireVsCodeApi` onto the HTTP/Sidecar bridge.
 */
export function getHostBridgeScript(options: HostBridgeOptions = {}): string {
    const pollIntervalMs = clampPollInterval(options.pollIntervalMs);
    const autoPoll = options.autoPoll !== false;
    const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
    const configuredViewMode = options.viewMode === 'aux' || options.viewMode === 'sidebar' || options.viewMode === 'standalone'
        ? options.viewMode
        : '';

    return `(function() {
  if (window.__ACM_BRIDGE__) { return; }

  var DEFAULT_POLL_MS = ${pollIntervalMs};
  var AUTO_POLL = ${autoPoll ? 'true' : 'false'};
  var STORAGE_KEY = ${JSON.stringify(storageKey)};
  var CONFIGURED_VIEW_MODE = ${JSON.stringify(configuredViewMode)};

  var hasNativeVsCode = typeof window.acquireVsCodeApi === 'function';
  var nativeVsCodeApi = hasNativeVsCode ? window.acquireVsCodeApi() : null;
  var sidecarApi = (typeof window.sidecar === 'object' && window.sidecar !== null) ? window.sidecar : null;
  var surface = hasNativeVsCode ? 'vscode' : (sidecarApi ? 'sidecar' : 'standalone');

  function getOwnOrigin() {
    try {
      if (window.location && typeof window.location.origin === 'string' && window.location.origin && window.location.origin !== 'null') {
        return window.location.origin;
      }
      if (window.location && typeof window.location.href === 'string' && window.location.href && typeof URL === 'function') {
        var parsed = new URL(window.location.href);
        if (parsed && parsed.origin && parsed.origin !== 'null') { return parsed.origin; }
      }
    } catch (_) { /* ignore */ }
    return '';
  }

  function randomIdHex(bytes) {
    try {
      if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
        var arr = new Uint8Array(bytes);
        crypto.getRandomValues(arr);
        var hex = '';
        for (var i = 0; i < arr.length; i++) {
          hex += (arr[i] < 16 ? '0' : '') + arr[i].toString(16);
        }
        return hex;
      }
    } catch (_) { /* fallback below */ }
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function detectViewMode() {
    var attr = document.body && document.body.getAttribute('data-acm-view');
    if (attr === 'aux' || attr === 'sidebar' || attr === 'standalone') { return attr; }
    if (CONFIGURED_VIEW_MODE) { return CONFIGURED_VIEW_MODE; }
    var p = (window.location && window.location.pathname) || '/';
    if (p.indexOf('/full') === 0) { return 'sidebar'; }
    return surface === 'sidecar' ? 'aux' : 'standalone';
  }

  // ─── Closure-Private Trusted Bridge Event Channel ───
  var trustedBridgeEvents = typeof WeakSet === 'function' ? new WeakSet() : null;
  var activeBridgeDispatchEvent = null;

  function markTrustedBridgeEvent(ev) {
    if (ev && typeof ev === 'object') {
      if (trustedBridgeEvents) {
        try { trustedBridgeEvents.add(ev); } catch (_) { /* ignore */ }
      }
      activeBridgeDispatchEvent = ev;
    }
  }

  function isTrustedHostEvent(ev) {
    if (!ev || typeof ev !== 'object') { return false; }
    if (activeBridgeDispatchEvent && ev === activeBridgeDispatchEvent) { return true; }
    if (trustedBridgeEvents) {
      try { return trustedBridgeEvents.has(ev); } catch (_) { return false; }
    }
    return false;
  }

  function isAllowedHostOrigin(origin) {
    if (!origin || typeof origin !== 'string') { return false; }
    if (origin === 'null') { return false; }
    var ownOrigin = getOwnOrigin();
    if (ownOrigin && origin === ownOrigin) { return true; }
    if (/^(?:plugin|sidecar|app|vscode-file|vscode-webview|antigravity|file):/i.test(origin)) { return true; }
    if (/^https?:\\/\\/(?:127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d+)?$/i.test(origin)) { return true; }
    return false;
  }

  function isTrustedIncomingWindowMessage(event) {
    if (!event || !event.data || typeof event.data !== 'object') { return false; }
    // Strict channel identity: only accept messages whose source is this window itself.
    if (event.source !== window) { return false; }
    var rawOrigin = typeof event.origin === 'string' ? event.origin : '';
    if (rawOrigin === 'null') { return false; }
    if (rawOrigin) {
      var ownOrigin = getOwnOrigin();
      if (!ownOrigin || rawOrigin !== ownOrigin) { return false; }
    }
    return true;
  }

  function isTrustedThemeMessage(event) {
    if (!event || !event.data || typeof event.data !== 'object') { return false; }
    var rawOrigin = typeof event.origin === 'string' ? event.origin : '';
    if (rawOrigin === 'null') { return false; }
    if (event.source === window) {
      if (!rawOrigin) { return true; }
      var ownOrigin = getOwnOrigin();
      if (ownOrigin && rawOrigin === ownOrigin) { return true; }
      return surface === 'sidecar' && isAllowedHostOrigin(rawOrigin);
    }
    if (surface === 'sidecar' && window.parent && window.parent !== window && event.source === window.parent) {
      if (!rawOrigin) { return true; }
      return isAllowedHostOrigin(rawOrigin);
    }
    return false;
  }

  // ─── State Persistence (VS Code state or resilient in-memory/storage) ───
  var memoryState = {};
  function readStoredState() {
    if (nativeVsCodeApi) {
      return nativeVsCodeApi.getState() || {};
    }
    try {
      var raw = window.sessionStorage && window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          memoryState = parsed;
          return Object.assign({}, parsed);
        }
      }
    } catch (_) { /* Opaque origin or disabled storage */ }
    return Object.assign({}, memoryState);
  }

  function writeStoredState(nextState) {
    if (nativeVsCodeApi) {
      nativeVsCodeApi.setState(nextState);
      return;
    }
    memoryState = (nextState && typeof nextState === 'object') ? Object.assign({}, nextState) : {};
    try {
      if (window.sessionStorage) {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memoryState));
      }
    } catch (_) { /* Ignore storage quota/security errors */ }
  }

  // Stable per-window identity & per-page instance identity for focusRevision / workspace isolation
  var sourceInstanceId = 'inst-' + randomIdHex(8);
  var windowId = (function() {
    if (sidecarApi && typeof sidecarApi.windowId === 'string' && sidecarApi.windowId.trim()) {
      return sidecarApi.windowId.trim();
    }
    var st = readStoredState();
    if (st && typeof st.__acmWindowId === 'string' && st.__acmWindowId.trim()) {
      return st.__acmWindowId.trim();
    }
    var generated = 'win-' + randomIdHex(8);
    if (!nativeVsCodeApi) {
      st.__acmWindowId = generated;
      writeStoredState(st);
    }
    return generated;
  })();

  // ─── Theme Detection & Host Sync ───
  var lastHostThemeHint = null;
  var lastHostHintKindOnly = false;
  var appliedThemeVarKeys = [];
  var lastObservedHostBgRaw = '';
  var HOST_BG_KEYS = ['--background', '--editor-background', '--color-background', '--bg-primary', '--vscode-editor-background'];
  var NAMED_COLOR_RGB = {
    white: [255, 255, 255],
    black: [0, 0, 0],
    snow: [255, 250, 250],
    ivory: [255, 255, 240],
    whitesmoke: [245, 245, 245],
    ghostwhite: [248, 248, 255],
    aliceblue: [240, 248, 255],
    gainsboro: [220, 220, 220],
    lightgray: [211, 211, 211],
    lightgrey: [211, 211, 211],
    silver: [192, 192, 192],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
    dimgray: [105, 105, 105],
    dimgrey: [105, 105, 105],
    darkgray: [169, 169, 169],
    darkgrey: [169, 169, 169]
  };

  function parseAlphaToken(rawAlpha) {
    if (rawAlpha === undefined || rawAlpha === null || rawAlpha === '') { return 1; }
    var a = String(rawAlpha).trim();
    if (!a) { return 1; }
    if (a.charAt(a.length - 1) === '%') {
      var pct = parseFloat(a.slice(0, -1));
      return isFinite(pct) ? Math.max(0, Math.min(1, pct / 100)) : 1;
    }
    var num = parseFloat(a);
    return isFinite(num) ? Math.max(0, Math.min(1, num)) : 1;
  }

  function hslToRgb(hDeg, sPct, lPct) {
    var h = ((hDeg % 360) + 360) % 360;
    var s = Math.max(0, Math.min(1, sPct / 100));
    var l = Math.max(0, Math.min(1, lPct / 100));
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r = 0; var g = 0; var b = 0;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function linearToSrgbByte(v) {
    var cl = Math.max(0, Math.min(1, v));
    var srgb = cl <= 0.0031308 ? 12.92 * cl : 1.055 * Math.pow(cl, 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, srgb)) * 255);
  }

  function oklchToRgb(lVal, cVal, hDeg) {
    var hr = (hDeg * Math.PI) / 180;
    var a = cVal * Math.cos(hr);
    var b = cVal * Math.sin(hr);
    var l_ = lVal + 0.3963377774 * a + 0.2158037573 * b;
    var m_ = lVal - 0.1055613458 * a - 0.0638541728 * b;
    var s_ = lVal - 0.0894841775 * a - 1.2914855480 * b;
    var l3 = l_ * l_ * l_;
    var m3 = m_ * m_ * m_;
    var s3 = s_ * s_ * s_;
    var rLin = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
    var gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
    var bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;
    return [linearToSrgbByte(rLin), linearToSrgbByte(gLin), linearToSrgbByte(bLin)];
  }

  function parseHueDegrees(rawHue) {
    var s = String(rawHue || '').trim().toLowerCase();
    var m = s.match(/^([+-]?\\d*(?:\\.\\d+)?)(deg|rad|grad|turn)?$/);
    if (!m) { return NaN; }
    var v = parseFloat(m[1]);
    if (!isFinite(v)) { return NaN; }
    var u = m[2] || 'deg';
    if (u === 'rad') { return (v * 180) / Math.PI; }
    if (u === 'grad') { return v * 0.9; }
    if (u === 'turn') { return v * 360; }
    return v;
  }

  function probeColorViaComputedStyle(raw) {
    try {
      if (typeof document === 'undefined' || !document.createElement || typeof window.getComputedStyle !== 'function') {
        return null;
      }
      var parentNode = document.body || document.documentElement;
      if (!parentNode || typeof parentNode.appendChild !== 'function') { return null; }
      var probe = document.createElement('span');
      if (!probe || !probe.style) { return null; }
      probe.style.display = 'none';
      probe.style.color = '';
      probe.style.color = raw;
      if (!probe.style.color) { return null; }
      parentNode.appendChild(probe);
      var computed = '';
      try {
        computed = window.getComputedStyle(probe).color || '';
      } finally {
        try {
          if (probe.parentNode && typeof probe.parentNode.removeChild === 'function') {
            probe.parentNode.removeChild(probe);
          }
        } catch (_) { /* ignore */ }
      }
      if (!computed) { return null; }
      return parseColorRgb(computed, false);
    } catch (_) {
      return null;
    }
  }

  function parseColorRgb(raw, allowDomProbe) {
    if (!raw || typeof raw !== 'string') { return null; }
    var s = raw.trim().toLowerCase();
    if (!s || s === 'transparent' || s === 'none' || s === 'inherit' || s === 'initial' || s === 'unset') {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(NAMED_COLOR_RGB, s)) {
      return NAMED_COLOR_RGB[s].slice();
    }
    var hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
    if (hex) {
      var h = hex[1];
      if (h.length === 3 || h.length === 4) {
        if (h.length === 4 && parseInt(h[3] + h[3], 16) <= 2) { return null; }
        return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
      }
      if (h.length === 8 && parseInt(h.slice(6, 8), 16) <= 2) { return null; }
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    var rgb = s.match(/^rgba?\\(\\s*(\\d+(?:\\.\\d+)?%?)\\s*[,\\s]\\s*(\\d+(?:\\.\\d+)?%?)\\s*[,\\s]\\s*(\\d+(?:\\.\\d+)?%?)(?:\\s*[,\\/]\\s*([^\\s)]+))?\\s*\\)$/);
    if (rgb) {
      if (parseAlphaToken(rgb[4]) <= 0.01) { return null; }
      var parseChan = function(tok) {
        return tok.charAt(tok.length - 1) === '%' ? (parseFloat(tok) / 100) * 255 : parseFloat(tok);
      };
      return [parseChan(rgb[1]), parseChan(rgb[2]), parseChan(rgb[3])];
    }
    var hsl = s.match(/^hsla?\\(\\s*([+-]?\\d*(?:\\.\\d+)?(?:deg|rad|grad|turn)?)\\s*[,\\s]\\s*(\\d+(?:\\.\\d+)?)%\\s*[,\\s]\\s*(\\d+(?:\\.\\d+)?)%(?:\\s*[,\\/]\\s*([^\\s)]+))?\\s*\\)$/);
    if (hsl) {
      if (parseAlphaToken(hsl[4]) <= 0.01) { return null; }
      var hDeg = parseHueDegrees(hsl[1]);
      if (isFinite(hDeg)) { return hslToRgb(hDeg, parseFloat(hsl[2]), parseFloat(hsl[3])); }
    }
    // Bare shadcn / Tailwind HSL triplet: e.g. "0 0% 100%" or "222.2 84% 4.9% / 1"
    var bareHsl = s.match(/^([+-]?\\d*(?:\\.\\d+)?(?:deg|rad|grad|turn)?)\\s+(\\d+(?:\\.\\d+)?)%\\s+(\\d+(?:\\.\\d+)?)%(?:\\s*\\/\\s*([^\\s]+))?$/);
    if (bareHsl) {
      if (parseAlphaToken(bareHsl[4]) <= 0.01) { return null; }
      var bhDeg = parseHueDegrees(bareHsl[1]);
      if (isFinite(bhDeg)) { return hslToRgb(bhDeg, parseFloat(bareHsl[2]), parseFloat(bareHsl[3])); }
    }
    var oklch = s.match(/^oklch\\(\\s*(\\d*(?:\\.\\d+)?%?)\\s+(\\d*(?:\\.\\d+)?%?)\\s+([+-]?\\d*(?:\\.\\d+)?(?:deg|rad|grad|turn)?|none)(?:\\s*\\/\\s*([^\\s)]+))?\\s*\\)$/);
    if (oklch) {
      if (parseAlphaToken(oklch[4]) <= 0.01) { return null; }
      var lTok = oklch[1];
      var cTok = oklch[2];
      var lNum = lTok.charAt(lTok.length - 1) === '%' ? parseFloat(lTok) / 100 : parseFloat(lTok);
      var cNum = cTok.charAt(cTok.length - 1) === '%' ? (parseFloat(cTok) / 100) * 0.4 : parseFloat(cTok);
      var ohDeg = oklch[3] === 'none' ? 0 : parseHueDegrees(oklch[3]);
      if (isFinite(lNum) && isFinite(cNum) && isFinite(ohDeg)) {
        return oklchToRgb(lNum, cNum, ohDeg);
      }
    }
    var colorFn = s.match(/^color\\(\\s*(srgb|srgb-linear|display-p3)\\s+([+-]?\\d*(?:\\.\\d+)?%?)\\s+([+-]?\\d*(?:\\.\\d+)?%?)\\s+([+-]?\\d*(?:\\.\\d+)?%?)(?:\\s*\\/\\s*([^\\s)]+))?\\s*\\)$/);
    if (colorFn) {
      if (parseAlphaToken(colorFn[5]) <= 0.01) { return null; }
      var parseUnit = function(tok) {
        return tok.charAt(tok.length - 1) === '%' ? parseFloat(tok) / 100 : parseFloat(tok);
      };
      var cr = parseUnit(colorFn[2]);
      var cg = parseUnit(colorFn[3]);
      var cb = parseUnit(colorFn[4]);
      if (isFinite(cr) && isFinite(cg) && isFinite(cb)) {
        if (colorFn[1] === 'srgb-linear') {
          return [linearToSrgbByte(cr), linearToSrgbByte(cg), linearToSrgbByte(cb)];
        }
        return [
          Math.round(Math.max(0, Math.min(1, cr)) * 255),
          Math.round(Math.max(0, Math.min(1, cg)) * 255),
          Math.round(Math.max(0, Math.min(1, cb)) * 255)
        ];
      }
    }
    if (allowDomProbe !== false) {
      return probeColorViaComputedStyle(raw);
    }
    return null;
  }

  function normalizeThemeHint(raw) {
    if (typeof raw !== 'string') { return null; }
    var v = raw.trim().toLowerCase();
    if (!v) { return null; }
    if (v === 'hc-light' || v === 'high-contrast-light' || v === 'vscode-high-contrast-light') { return 'hc-light'; }
    if (v === 'hc' || v === 'hc-dark' || v === 'high-contrast' || v === 'vscode-high-contrast') { return 'hc'; }
    if (v === 'light' || v === 'vscode-light') { return 'light'; }
    if (v === 'dark' || v === 'vscode-dark') { return 'dark'; }
    return null;
  }

  function readRootThemeHint() {
    var root = document.documentElement;
    if (!root) { return null; }
    if (typeof root.getAttribute === 'function') {
      var attrHint = normalizeThemeHint(root.getAttribute('data-theme'))
        || normalizeThemeHint(root.getAttribute('data-color-scheme'))
        || normalizeThemeHint(root.getAttribute('data-acm-host-theme'));
      if (attrHint) { return attrHint; }
    }
    var cls = typeof root.className === 'string' ? root.className : '';
    if (cls) {
      var tokens = cls.split(/\\s+/);
      for (var i = 0; i < tokens.length; i++) {
        var fromTok = normalizeThemeHint(tokens[i]);
        if (fromTok) { return fromTok; }
      }
    }
    return null;
  }

  function relativeLuminance(rgb) {
    if (!rgb) { return null; }
    var c = rgb.map(function(v) {
      var n = Math.max(0, Math.min(255, v)) / 255;
      return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function readHostBgEntry() {
    var rootEl = document.documentElement;
    var rootInline = (rootEl && rootEl.style && typeof rootEl.style.getPropertyValue === 'function') ? rootEl.style : null;
    var rootStyle = window.getComputedStyle ? window.getComputedStyle(rootEl) : null;
    for (var i = 0; i < HOST_BG_KEYS.length; i++) {
      var key = HOST_BG_KEYS[i];
      var inlineVal = rootInline ? rootInline.getPropertyValue(key) : '';
      var compVal = (key !== '--vscode-editor-background' && rootStyle && typeof rootStyle.getPropertyValue === 'function')
        ? rootStyle.getPropertyValue(key)
        : '';
      var raw = String(inlineVal || compVal || '').trim();
      if (!raw) { continue; }
      var lum = relativeLuminance(parseColorRgb(raw, true));
      if (lum !== null) { return { raw: key + ':' + raw, lum: lum }; }
    }
    return { raw: '', lum: null };
  }

  function resolveThemeFromHost() {
    if (surface === 'vscode') { return null; }
    var forcedHighContrast = typeof window.matchMedia === 'function' && (
      window.matchMedia('(forced-colors: active)').matches ||
      window.matchMedia('(prefers-contrast: more)').matches
    );
    var lum = lastHostHintKindOnly ? null : readHostBgEntry().lum;
    var explicitHint = lastHostThemeHint || readRootThemeHint();
    if (explicitHint === 'hc-light' || explicitHint === 'hc') {
      return explicitHint;
    }
    if (forcedHighContrast) {
      if (lum !== null) { return lum > 0.5 ? 'hc-light' : 'hc'; }
      if (explicitHint === 'light') { return 'hc-light'; }
      if (explicitHint === 'dark') { return 'hc'; }
      if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches) { return 'hc-light'; }
      return 'hc';
    }
    if (lum !== null) {
      return lum > 0.45 ? 'light' : 'dark';
    }
    if (explicitHint) {
      return explicitHint;
    }
    if (typeof window.matchMedia === 'function') {
      if (window.matchMedia('(prefers-color-scheme: light)').matches) { return 'light'; }
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) { return 'dark'; }
    }
    if (document.body && document.body.style) {
      var bodyBg = document.body.style.backgroundColor || document.body.style.background || '';
      var bodyLum = relativeLuminance(parseColorRgb(bodyBg, true));
      if (bodyLum !== null) {
        return bodyLum > 0.45 ? 'light' : 'dark';
      }
    }
    return 'dark';
  }

  function syncBodyTheme() {
    if (surface === 'vscode') { return; }
    var kind = resolveThemeFromHost();
    if (!kind) { return; }
    if (document.documentElement && typeof document.documentElement.setAttribute === 'function') {
      if (document.documentElement.getAttribute('data-acm-theme') !== kind) {
        document.documentElement.setAttribute('data-acm-theme', kind);
      }
    }
    if (!document.body) { return; }
    if (document.body.getAttribute('data-acm-theme') !== kind) {
      document.body.setAttribute('data-acm-theme', kind);
    }
    if (document.body.classList && typeof document.body.classList.toggle === 'function') {
      document.body.classList.toggle('vscode-light', kind === 'light');
      document.body.classList.toggle('vscode-dark', kind === 'dark');
      document.body.classList.toggle('vscode-high-contrast', kind === 'hc');
      document.body.classList.toggle('vscode-high-contrast-light', kind === 'hc-light');
    }
  }

  window.addEventListener('message', function(event) {
    if (!isTrustedThemeMessage(event)) { return; }
    if (event.data.type === 'theme-change') {
      var payloadObj = (event.data.payload && typeof event.data.payload === 'object') ? event.data.payload : null;
      var vars = (payloadObj && payloadObj.cssVariables && typeof payloadObj.cssVariables === 'object')
        ? payloadObj.cssVariables
        : ((event.data.cssVariables && typeof event.data.cssVariables === 'object') ? event.data.cssVariables : null);
      var hasBgVar = false;
      if (vars) {
        for (var k in vars) {
          if (Object.prototype.hasOwnProperty.call(vars, k) && /^--[a-zA-Z0-9_-]+$/.test(k)) {
            var val = vars[k];
            if (typeof val === 'string' && val.length <= 256 && val.indexOf(';') < 0 && !/url\\s*\\(/i.test(val) && !/expression\\s*\\(/i.test(val)) {
              document.documentElement.style.setProperty(k, val);
              if (appliedThemeVarKeys.indexOf(k) < 0) { appliedThemeVarKeys.push(k); }
              if (HOST_BG_KEYS.indexOf(k) >= 0) { hasBgVar = true; }
            }
          }
        }
      }
      var hintCandidate = (payloadObj && (payloadObj.theme || payloadObj.colorScheme))
        || event.data.theme
        || event.data.colorScheme;
      var normalizedHint = normalizeThemeHint(hintCandidate);
      if (normalizedHint) {
        lastHostThemeHint = normalizedHint;
        if (!hasBgVar) {
          if (document.documentElement && document.documentElement.style && typeof document.documentElement.style.removeProperty === 'function') {
            for (var ri = 0; ri < appliedThemeVarKeys.length; ri++) {
              document.documentElement.style.removeProperty(appliedThemeVarKeys[ri]);
            }
          }
          appliedThemeVarKeys = [];
          lastHostHintKindOnly = true;
        } else {
          lastHostHintKindOnly = false;
        }
      } else if (hasBgVar) {
        lastHostThemeHint = null;
        lastHostHintKindOnly = false;
      }
      lastObservedHostBgRaw = readHostBgEntry().raw;
      syncBodyTheme();
    }
  });

  if (typeof window.matchMedia === 'function') {
    var bindMqChange = function(query) {
      var mq = window.matchMedia(query);
      if (!mq) { return; }
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', syncBodyTheme);
      } else if (typeof mq.addListener === 'function') {
        mq.addListener(syncBodyTheme);
      }
    };
    bindMqChange('(prefers-color-scheme: light)');
    bindMqChange('(prefers-contrast: more)');
    bindMqChange('(forced-colors: active)');
  }
  lastObservedHostBgRaw = readHostBgEntry().raw;
  syncBodyTheme();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncBodyTheme);
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('load', syncBodyTheme);
  }
  if (surface !== 'vscode' && typeof MutationObserver === 'function' && document.documentElement) {
    try {
      var themeObserver = new MutationObserver(function() {
        var curBgRaw = readHostBgEntry().raw;
        if (curBgRaw !== lastObservedHostBgRaw) {
          lastObservedHostBgRaw = curBgRaw;
          lastHostHintKindOnly = false;
          lastHostThemeHint = null;
        }
        syncBodyTheme();
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style', 'class', 'data-theme', 'data-color-scheme', 'data-acm-host-theme'],
        childList: true
      });
    } catch (_) { /* ignore */ }
  }

  // ─── Clipboard Helper (Clipboard API + execCommand fallback) ───
  function copyText(text) {
    var value = String(text == null ? '' : text);
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(value).then(function() { return true; }).catch(function() {
        return execCommandCopy(value);
      });
    }
    return Promise.resolve(execCommandCopy(value));
  }

  function execCommandCopy(value) {
    try {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (_) {
      return false;
    }
  }

  // ─── Browser File Download Helper (Calendar CSV/JSON Export) ───
  function triggerFileDownload(filename, content, mimeType) {
    try {
      if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        return false;
      }
      var safeName = (typeof filename === 'string' && filename.trim()) ? filename.trim() : 'antigravity-export.txt';
      var blob = new Blob([String(content == null ? '' : content)], {
        type: (typeof mimeType === 'string' && mimeType.trim()) ? mimeType.trim() : 'text/plain;charset=utf-8'
      });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = safeName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function() {
        try { URL.revokeObjectURL(url); } catch (_) { /* ignore */ }
      }, 1000);
      return true;
    } catch (_) {
      return false;
    }
  }

  // ─── Sidecar / Standalone Transport, SDK Precedence & Visibility-Gated ETag Polling ───
  var urlParams = new URLSearchParams((window.location && window.location.search) || '');
  var initialUrlConversationId = urlParams.get('conversationId') || '';
  var hasCallbackConversationEvent = false;
  var lastCallbackConversationId = '';
  var lastGetterConversationId = (sidecarApi && typeof sidecarApi.conversationId === 'string')
    ? sidecarApi.conversationId.trim()
    : '';
  var hasAuthoritativeHostObservation = !!(sidecarApi && typeof sidecarApi.conversationId === 'string');
  var currentWorkspaceUris = [];

  /**
   * SDK precedence contract:
   * 1. Newer SDK callback / trusted same-window host event ALWAYS outranks a stale non-empty getter.
   * 2. If the getter itself transitions to a genuinely new value AFTER a callback, adopt that new value.
   * 3. Once any authoritative host observation exists, stale initialUrlConversationId NEVER reappears.
   */
  function getActiveConversationId() {
    if (sidecarApi && typeof sidecarApi.conversationId === 'string') {
      var getterId = sidecarApi.conversationId.trim();
      hasAuthoritativeHostObservation = true;
      if (hasCallbackConversationEvent) {
        if (getterId !== lastGetterConversationId) {
          lastGetterConversationId = getterId;
          lastCallbackConversationId = getterId;
          return getterId;
        }
        return lastCallbackConversationId;
      }
      lastGetterConversationId = getterId;
      return getterId;
    }
    if (hasCallbackConversationEvent) {
      return lastCallbackConversationId;
    }
    if (hasAuthoritativeHostObservation) {
      return '';
    }
    return initialUrlConversationId;
  }

  function recordCallbackConversationId(nextId) {
    hasCallbackConversationEvent = true;
    hasAuthoritativeHostObservation = true;
    lastCallbackConversationId = nextId;
    if (sidecarApi && typeof sidecarApi.conversationId === 'string') {
      // Snapshot the current (possibly stale) getter value so it cannot override this newer callback.
      lastGetterConversationId = sidecarApi.conversationId.trim();
    }
  }

  var lastObservedConversationId = getActiveConversationId();
  var pendingConversationCleared = false;
  var focusRevision = 0;
  var ackedFocusRevision = 0;
  var knownBackendEpoch = null;
  var pendingFocusEvent = null;
  var focusSyncInFlight = false;
  var focusRetryTimer = null;
  var focusRetryAttempts = 0;

  var pendingWorkspaceSync = null;
  var workspaceSyncInFlight = false;
  var workspaceRetryTimer = null;
  var workspaceRetryAttempts = 0;

  var lastEtag = '';
  var lastReceivedSnapshot = null;
  var lastReceivedHash = '';
  var responseGeneration = 0;
  var lastAppliedGeneration = 0;
  var REMASK_STORAGE_KEY = 'antigravityContextMonitor.pendingRemask.' + windowId;
  function readPendingRemask() {
    if (nativeVsCodeApi) { return false; }
    try { return !!(window.sessionStorage && window.sessionStorage.getItem(REMASK_STORAGE_KEY) === '1'); } catch (_) { return false; }
  }
  function writePendingRemask(active) {
    if (nativeVsCodeApi) { return; }
    try {
      if (!window.sessionStorage) { return; }
      if (active) { window.sessionStorage.setItem(REMASK_STORAGE_KEY, '1'); }
      else { window.sessionStorage.removeItem(REMASK_STORAGE_KEY); }
    } catch (_) { /* ignore */ }
  }
  var persistedPendingRemask = readPendingRemask();
  var privacyGeneration = 0;
  var privacyChangePending = persistedPendingRemask;
  var requestedPrivacyMask = persistedPendingRemask ? true : null;
  var privacyRetryTimer = null;
  var privacyRetryAttempts = 0;
  var POLL_FETCH_TIMEOUT_MS = 15000;
  var configuredPollIntervalMs = DEFAULT_POLL_MS;
  var pollIntervalMs = DEFAULT_POLL_MS;
  var hasPendingUserActivity = false;
  var pendingImmediateWakePoll = false;
  var pendingForceFullPoll = false;
  var pollPaused = false;
  var pollTimer = null;
  var pollInFlight = false;
  var consecutivePollErrors = 0;
  var snapshotListeners = [];
  var workspaceListeners = [];
  var pinnedConversationId = '';
  var lockToMainAgent = false;
  var lastBridgeNativeHudHtml = null;

  function bridgeFetch(url, opts) {
    if (sidecarApi && typeof sidecarApi.fetch === 'function') {
      return sidecarApi.fetch(url, opts || {});
    }
    var method = (opts && opts.method) ? String(opts.method).toUpperCase() : 'GET';
    var headers = Object.assign({}, (opts && opts.headers) || {});
    if (method !== 'GET' && method !== 'HEAD' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    try {
      var session = window.sessionStorage && window.sessionStorage.getItem('acm_standalone_session');
      if (session) { headers['X-Monitor-Session'] = session; }
    } catch (_) { /* disabled session storage */ }
    return window.fetch(url, Object.assign({}, opts || {}, {
      mode: 'same-origin', redirect: 'error', credentials: 'omit', headers: headers
    }));
  }

  function dispatchWebviewMessage(msg) {
    if (!msg || typeof msg !== 'object') { return; }
    var normalized = msg;
    if (typeof msg.type === 'string' && !msg.command) {
      normalized = Object.assign({ command: msg.type }, msg);
    } else if (typeof msg.command === 'string' && !msg.type) {
      normalized = Object.assign({ type: msg.command }, msg);
    }
    var ownOrigin = getOwnOrigin();
    if (typeof MessageEvent === 'function') {
      var ev = null;
      try {
        ev = new MessageEvent('message', {
          data: normalized,
          origin: ownOrigin || '',
          source: window
        });
      } catch (_) {
        try {
          ev = new MessageEvent('message', { data: normalized, origin: ownOrigin || '' });
        } catch (__) {
          ev = new MessageEvent('message', { data: normalized });
        }
      }
      markTrustedBridgeEvent(ev);
      try {
        window.dispatchEvent(ev);
      } finally {
        if (activeBridgeDispatchEvent === ev) { activeBridgeDispatchEvent = null; }
      }
      return;
    }
    // Never use wildcard '*' targetOrigin
    if (typeof window.postMessage === 'function' && ownOrigin) {
      window.postMessage(normalized, ownOrigin);
      return;
    }
    if (typeof window.dispatchEvent === 'function') {
      var fallbackEv = { type: 'message', data: normalized, source: window, origin: ownOrigin };
      markTrustedBridgeEvent(fallbackEv);
      try {
        window.dispatchEvent(fallbackEv);
      } finally {
        if (activeBridgeDispatchEvent === fallbackEv) { activeBridgeDispatchEvent = null; }
      }
    }
  }

  function patchNativeHudHostFallback(nextNativeHud, prevInnerHtml) {
    if (typeof nextNativeHud !== 'string') { return; }
    if (nextNativeHud === lastBridgeNativeHudHtml) { return; }
    var hudHostEl = document.getElementById('nativeHudHost');
    if (!hudHostEl) {
      lastBridgeNativeHudHtml = nextNativeHud;
      return;
    }
    if (hudHostEl.innerHTML !== prevInnerHtml) {
      lastBridgeNativeHudHtml = nextNativeHud;
      return;
    }
    hudHostEl.innerHTML = nextNativeHud;
    hudHostEl.hidden = !nextNativeHud.trim();
    lastBridgeNativeHudHtml = nextNativeHud;
    var stored = readStoredState();
    var isExp = !!stored.nativeHudExpanded;
    var bar = document.getElementById('nativeHudBar');
    var toggle = document.getElementById('nativeHudToggle');
    var drawer = document.getElementById('nativeHudDrawer');
    if (bar) { bar.setAttribute('data-hud-expanded', String(isExp)); }
    if (toggle) { toggle.setAttribute('aria-expanded', String(isExp)); }
    if (drawer) { drawer.hidden = !isExp; }
  }

  function clearClientCaches() {
    lastEtag = '';
    lastReceivedSnapshot = null;
    lastReceivedHash = '';
    lastBridgeNativeHudHtml = null;
  }

  function markUserInteraction() {
    if (surface === 'vscode') { return; }
    hasPendingUserActivity = true;
    if (pollIntervalMs > configuredPollIntervalMs && AUTO_POLL && !pollPaused && !document.hidden) {
      pollIntervalMs = configuredPollIntervalMs;
      if (pollInFlight) {
        pendingImmediateWakePoll = true;
      } else {
        if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
        void pollSnapshot(false);
      }
    }
  }

  function syncLocalStateFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') { return; }
    if (snapshot.meta && typeof snapshot.meta.backendEpoch === 'number' && Number.isFinite(snapshot.meta.backendEpoch)) {
      knownBackendEpoch = snapshot.meta.backendEpoch;
    }
    if (typeof snapshot.paused === 'boolean') {
      pollPaused = snapshot.paused;
      if (pollPaused && pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    }
    if (typeof snapshot.pinnedConversationId === 'string') {
      pinnedConversationId = snapshot.pinnedConversationId;
    } else if (snapshot.pinnedConversationId === null) {
      pinnedConversationId = '';
    }
    if (typeof snapshot.lockToMainAgent === 'boolean') {
      lockToMainAgent = snapshot.lockToMainAgent;
    }
    var snapSettings = snapshot.data && snapshot.data.settings;
    if (snapSettings && typeof snapSettings.pollingInterval === 'number' && Number.isFinite(snapSettings.pollingInterval)) {
      configuredPollIntervalMs = Math.max(1000, Math.min(60000, Math.round(snapSettings.pollingInterval * 1000)));
    }
    var effectiveMs = snapshot.meta && typeof snapshot.meta.effectivePollIntervalMs === 'number' && Number.isFinite(snapshot.meta.effectivePollIntervalMs)
      ? Math.max(1000, Math.min(60000, Math.round(snapshot.meta.effectivePollIntervalMs)))
      : configuredPollIntervalMs;
    var visibleIdleCapMs = Math.max(configuredPollIntervalMs, 15000);
    var targetMs = Math.min(effectiveMs, visibleIdleCapMs);
    if (hasPendingUserActivity && targetMs > configuredPollIntervalMs) {
      targetMs = configuredPollIntervalMs;
    }
    if (targetMs !== pollIntervalMs) {
      pollIntervalMs = targetMs;
    }
  }

  function notifySnapshot(snapshot, hash) {
    lastReceivedSnapshot = snapshot || null;
    lastReceivedHash = hash || '';
    syncLocalStateFromSnapshot(snapshot);
    var nextNativeHud = (snapshot && snapshot.tabs && typeof snapshot.tabs.nativeHud === 'string')
      ? snapshot.tabs.nativeHud
      : (snapshot && typeof snapshot.nativeHud === 'string' ? snapshot.nativeHud : null);
    var hudHostBefore = document.getElementById('nativeHudHost');
    var prevHudInner = hudHostBefore ? hudHostBefore.innerHTML : null;
    for (var i = 0; i < snapshotListeners.length; i++) {
      try { snapshotListeners[i](snapshot, hash); } catch (_) { /* isolate listener */ }
    }
    try {
      if (typeof window.CustomEvent === 'function') {
        var snapEv = new CustomEvent('acm:snapshot', {
          detail: { snapshot: snapshot, hash: hash || '' }
        });
        markTrustedBridgeEvent(snapEv);
        try {
          window.dispatchEvent(snapEv);
        } finally {
          if (activeBridgeDispatchEvent === snapEv) { activeBridgeDispatchEvent = null; }
        }
      }
    } catch (_) { /* ignore CustomEvent unavailability */ }
    if (snapshot && snapshot.tabs) {
      dispatchWebviewMessage({
        command: 'updateTabs',
        tabs: snapshot.tabs,
        nativeHud: nextNativeHud,
        time: snapshot.time || '',
        snapshot: snapshot,
        privacyMasked: typeof snapshot.privacyMasked === 'boolean' ? snapshot.privacyMasked : undefined,
        activeConversationId: snapshot.activeConversationId !== undefined ? snapshot.activeConversationId : null,
        pinnedConversationId: snapshot.pinnedConversationId !== undefined ? snapshot.pinnedConversationId : (pinnedConversationId || null),
        lockToMainAgent: typeof snapshot.lockToMainAgent === 'boolean' ? snapshot.lockToMainAgent : lockToMainAgent,
        conversations: Array.isArray(snapshot.conversationOptions)
          ? snapshot.conversationOptions
          : (Array.isArray(snapshot.conversations) ? snapshot.conversations : []),
        isStale: !!snapshot.isStale,
        staleState: snapshot.staleState || null
      });
    }
    if (nextNativeHud !== null) {
      patchNativeHudHostFallback(nextNativeHud, prevHudInner);
    }
  }

  // ─── Dedicated Focus Sync POST (syncHostFocus) with Monotonic focusRevision & Ack Retry ───
  function scheduleFocusRetry() {
    if (focusRetryTimer) {
      clearTimeout(focusRetryTimer);
      focusRetryTimer = null;
    }
    if (surface === 'vscode' || !pendingFocusEvent || document.hidden) { return; }
    var delay = Math.min(10000, 500 * Math.pow(2, Math.min(focusRetryAttempts, 5)));
    focusRetryAttempts += 1;
    focusRetryTimer = setTimeout(function() {
      focusRetryTimer = null;
      void flushPendingFocusSync();
    }, delay);
  }

  function flushPendingFocusSync() {
    if (surface === 'vscode' || !pendingFocusEvent || focusSyncInFlight) {
      return Promise.resolve(null);
    }
    if (focusRetryTimer) {
      clearTimeout(focusRetryTimer);
      focusRetryTimer = null;
    }
    var eventToSend = pendingFocusEvent;
    focusSyncInFlight = true;
    var reqGen = ++responseGeneration;
    var body = {
      command: 'syncHostFocus',
      conversationId: eventToSend.conversationId,
      focusRevision: eventToSend.focusRevision,
      windowId: windowId,
      sourceInstanceId: sourceInstanceId,
      viewMode: eventToSend.viewMode,
      fromSdkCallback: eventToSend.fromSdkCallback === true,
      isFocusedPane: !document.hidden
    };
    if (knownBackendEpoch !== null) {
      body.backendEpoch = knownBackendEpoch;
    }
    if (eventToSend.conversationCleared) {
      body.conversationCleared = true;
    }
    return bridgeFetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function(res) {
        if (!res || !res.ok) { throw new Error('HTTP ' + (res ? res.status : 0)); }
        return res.json();
      })
      .then(function(data) {
        if (!data || !data.ok) {
          scheduleFocusRetry();
          return data;
        }
        var resObj = (data.result && typeof data.result === 'object') ? data.result : null;
        var responseEpoch = resObj && Number.isSafeInteger(resObj.backendEpoch) ? resObj.backendEpoch : null;
        var epochCurrent = responseEpoch !== null && (knownBackendEpoch === null || responseEpoch >= knownBackendEpoch
          || (resObj.reason === 'stale_epoch' && knownBackendEpoch === body.backendEpoch && reqGen >= lastAppliedGeneration));
        if (epochCurrent) { knownBackendEpoch = responseEpoch; }
        var ackRev = resObj && typeof resObj.ackFocusRevision === 'number' && Number.isFinite(resObj.ackFocusRevision)
          ? resObj.ackFocusRevision
          : null;
        // Clear pending state ONLY when the server explicitly acknowledges matching focusRevision!
        if (resObj && resObj.accepted === true && epochCurrent
            && (body.backendEpoch === undefined || responseEpoch === body.backendEpoch)
            && ackRev === eventToSend.focusRevision) {
          if (ackRev > ackedFocusRevision) { ackedFocusRevision = ackRev; }
          if (pendingFocusEvent === eventToSend) {
            pendingFocusEvent = null;
            pendingConversationCleared = false;
            focusRetryAttempts = 0;
          }
        } else {
          scheduleFocusRetry();
        }
        if (data.snapshot && resObj && resObj.accepted === true && !pendingFocusEvent && epochCurrent
            && !privacyChangePending && reqGen >= lastAppliedGeneration && reqGen >= privacyGeneration) {
          lastAppliedGeneration = reqGen;
          if (data.hash) { lastEtag = String(data.hash); }
          notifySnapshot(data.snapshot, data.hash || '');
        }
        return data;
      })
      .catch(function() {
        scheduleFocusRetry();
        return null;
      })
      .finally(function() {
        focusSyncInFlight = false;
        if (pendingFocusEvent && pendingFocusEvent.focusRevision > eventToSend.focusRevision) {
          void flushPendingFocusSync();
        }
      });
  }

  function syncHostConversationChange(triggerImmediateSync, fromSdkCallback) {
    var nextConvId = getActiveConversationId();
    if (nextConvId === lastObservedConversationId) { return false; }
    var view = detectViewMode();
    if (lastObservedConversationId && !nextConvId && view === 'aux') {
      pendingConversationCleared = true;
    } else if (nextConvId) {
      pendingConversationCleared = false;
    }
    lastObservedConversationId = nextConvId;
    focusRevision += 1;
    pendingFocusEvent = {
      conversationId: nextConvId ? nextConvId : null,
      focusRevision: focusRevision,
      conversationCleared: !!(pendingConversationCleared && view === 'aux'),
      fromSdkCallback: fromSdkCallback === true,
      viewMode: view
    };
    focusRetryAttempts = 0;
    lastEtag = '';
    if (triggerImmediateSync && surface !== 'vscode') {
      void flushPendingFocusSync();
    }
    return true;
  }

  // ─── Dedicated Workspace Registration POST (registerWorkspaces, explicit [] revokes) ───
  function normalizeWorkspaceUriList(uris) {
    if (!Array.isArray(uris)) { return []; }
    var out = [];
    for (var i = 0; i < uris.length; i++) {
      if (typeof uris[i] === 'string') {
        var trimmed = uris[i].trim();
        if (trimmed) { out.push(trimmed); }
      }
    }
    return out;
  }

  function scheduleWorkspaceRetry() {
    if (workspaceRetryTimer) {
      clearTimeout(workspaceRetryTimer);
      workspaceRetryTimer = null;
    }
    if (surface === 'vscode' || pendingWorkspaceSync === null || document.hidden) { return; }
    var delay = Math.min(10000, 500 * Math.pow(2, Math.min(workspaceRetryAttempts, 5)));
    workspaceRetryAttempts += 1;
    workspaceRetryTimer = setTimeout(function() {
      workspaceRetryTimer = null;
      void flushPendingWorkspaceRegistration();
    }, delay);
  }

  function flushPendingWorkspaceRegistration() {
    if (surface === 'vscode' || pendingWorkspaceSync === null || workspaceSyncInFlight) {
      return Promise.resolve(null);
    }
    if (workspaceRetryTimer) {
      clearTimeout(workspaceRetryTimer);
      workspaceRetryTimer = null;
    }
    var toSend = pendingWorkspaceSync;
    workspaceSyncInFlight = true;
    return bridgeFetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: 'registerWorkspaces',
        workspaceUris: toSend.workspaceUris,
        windowId: windowId
      })
    })
      .then(function(res) {
        if (!res || !res.ok) { throw new Error('HTTP ' + (res ? res.status : 0)); }
        return res.json();
      })
      .then(function(data) {
        if (data && data.ok) {
          if (pendingWorkspaceSync && pendingWorkspaceSync.seq === toSend.seq) {
            pendingWorkspaceSync = null;
            workspaceRetryAttempts = 0;
          }
        } else {
          scheduleWorkspaceRetry();
        }
        return data;
      })
      .catch(function() {
        scheduleWorkspaceRetry();
        return null;
      })
      .finally(function() {
        workspaceSyncInFlight = false;
        if (pendingWorkspaceSync && pendingWorkspaceSync.seq > toSend.seq) {
          void flushPendingWorkspaceRegistration();
        }
      });
  }

  var workspaceSyncSeq = 0;
  function registerWorkspaces(uris) {
    var normalized = normalizeWorkspaceUriList(uris);
    currentWorkspaceUris = normalized.slice();
    lastEtag = '';
    if (surface === 'vscode') {
      return Promise.resolve({ ok: true });
    }
    workspaceSyncSeq += 1;
    pendingWorkspaceSync = { seq: workspaceSyncSeq, workspaceUris: normalized.slice() };
    workspaceRetryAttempts = 0;
    return flushPendingWorkspaceRegistration();
  }

  // Strictly read-only snapshot URL: NEVER carries conversationId, conversationCleared, or workspaceUris!
  function buildSnapshotUrl(forceFull, isActive) {
    if (syncHostConversationChange(true) === false && pendingFocusEvent) {
      void flushPendingFocusSync();
    }
    var qs = new URLSearchParams();
    var view = detectViewMode();
    if (!forceFull && lastEtag) { qs.set('etag', lastEtag); }
    if (isActive) { qs.set('active', '1'); }
    var urlLang = urlParams.get('lang');
    if (urlLang === 'en' || urlLang === 'zh' || urlLang === 'both') {
      qs.set('lang', urlLang);
    }
    qs.set('viewMode', view);
    qs.set('view', view);
    if (windowId) { qs.set('windowId', windowId); }
    return '/api/snapshot?' + qs.toString();
  }

  function scheduleNextPoll() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (surface === 'vscode' || !AUTO_POLL || pollPaused || document.hidden) {
      return;
    }
    var backoff = consecutivePollErrors > 0
      ? Math.min(30000, pollIntervalMs * Math.pow(2, Math.min(consecutivePollErrors, 3)))
      : pollIntervalMs;
    pollTimer = setTimeout(function() {
      pollTimer = null;
      pollSnapshot(false);
    }, backoff);
  }

  function extractHeaderEtag(res) {
    if (!res || !res.headers) { return ''; }
    var raw = typeof res.headers.get === 'function' ? res.headers.get('etag') : (res.headers.etag || res.headers.ETag || '');
    if (typeof raw !== 'string') { return ''; }
    var trimmed = raw.trim();
    if (trimmed.indexOf('W/') === 0) { trimmed = trimmed.slice(2).trim(); }
    if (trimmed.length >= 2 && trimmed[0] === '"' && trimmed[trimmed.length - 1] === '"') {
      trimmed = trimmed.slice(1, -1);
    }
    return trimmed;
  }

  function pollSnapshot(forceFull) {
    if (surface === 'vscode' || (!forceFull && (document.hidden || pollPaused))) {
      return Promise.resolve(null);
    }
    if (pollInFlight) {
      if (forceFull) {
        pendingForceFullPoll = true;
      }
      return Promise.resolve(null);
    }
    pollInFlight = true;
    var reqGen = ++responseGeneration;
    var sendActive = hasPendingUserActivity;
    hasPendingUserActivity = false;
    var fetchHeaders = {};
    if (!forceFull && lastEtag) {
      fetchHeaders['If-None-Match'] = '"' + lastEtag + '"';
    }
    var pollTimedOut = false;
    var pollTimeoutId = null;
    var fetchPromise;
    try {
      fetchPromise = Promise.resolve(bridgeFetch(buildSnapshotUrl(!!forceFull, sendActive), { method: 'GET', headers: fetchHeaders }));
    } catch (syncErr) {
      fetchPromise = Promise.reject(syncErr);
    }
    var racePromise = new Promise(function(resolve, reject) {
      pollTimeoutId = setTimeout(function() {
        pollTimedOut = true;
        reject(new Error('Snapshot poll timeout'));
      }, POLL_FETCH_TIMEOUT_MS);
      fetchPromise.then(function(res) {
        if (pollTimeoutId) { clearTimeout(pollTimeoutId); pollTimeoutId = null; }
        if (pollTimedOut) { return; }
        resolve(res);
      }, function(err) {
        if (pollTimeoutId) { clearTimeout(pollTimeoutId); pollTimeoutId = null; }
        if (pollTimedOut) { return; }
        reject(err);
      });
    });
    return racePromise
      .then(function(res) {
        // Handle bodyless HTTP 304 Not Modified cleanly without calling res.json()!
        if (res && res.status === 304) {
          var headerEtag = extractHeaderEtag(res);
          return { unchanged: true, hash: headerEtag || lastEtag, _http304: true };
        }
        if (!res || !res.ok) { throw new Error('HTTP ' + (res ? res.status : 0)); }
        return res.json();
      })
      .then(function(data) {
        consecutivePollErrors = 0;
        // Monotonic generation check: drop out-of-order stale GET responses!
        if (reqGen < privacyGeneration) { return null; }
        if (privacyChangePending) {
          if (!data || !data.snapshot || data.snapshot.privacyMasked !== requestedPrivacyMask) { return null; }
          privacyChangePending = false;
          if (data.snapshot.privacyMasked === true) { writePendingRemask(false); }
        }
        if (reqGen < lastAppliedGeneration) {
          return data;
        }
        if (data && data.hash) { lastEtag = String(data.hash); }
        if (data && data.unchanged === false && data.snapshot) {
          lastAppliedGeneration = reqGen;
          notifySnapshot(data.snapshot, data.hash || '');
        }
        return data;
      })
      .catch(function() {
        if (sendActive) { hasPendingUserActivity = true; }
        consecutivePollErrors += 1;
        return null;
      })
      .finally(function() {
        if (pollTimeoutId) { clearTimeout(pollTimeoutId); pollTimeoutId = null; }
        pollInFlight = false;
        if (pendingForceFullPoll && !pollPaused) {
          pendingForceFullPoll = false;
          pendingImmediateWakePoll = false;
          void pollSnapshot(true);
          return;
        }
        if (pendingImmediateWakePoll && AUTO_POLL && !pollPaused && !document.hidden) {
          pendingImmediateWakePoll = false;
          void pollSnapshot(false);
          return;
        }
        pendingForceFullPoll = false;
        pendingImmediateWakePoll = false;
        scheduleNextPoll();
      });
  }

  function normalizeConversationPin(rawId) {
    if (rawId === null || rawId === undefined) { return ''; }
    var s = String(rawId).trim();
    if (!s || s === 'auto' || s === '__auto__') { return ''; }
    return s;
  }

  function handlePrivacyActionFailure(actionGen) {
    if (actionGen !== privacyGeneration) { return; }
    if (requestedPrivacyMask === true) {
      // Fail-closed: keep privacyChangePending = true so unmasked GET snapshots NEVER repaint PII!
      privacyChangePending = true;
      if (privacyRetryAttempts < 3 && !document.hidden) {
        var retryDelay = 500 * Math.pow(2, privacyRetryAttempts++);
        privacyRetryTimer = setTimeout(function() {
          privacyRetryTimer = null;
          void sendAction({ command: 'setPrivacyMask', masked: true }, { _isPrivacyRetry: true });
        }, retryDelay);
      }
    } else {
      privacyChangePending = false;
      void pollSnapshot(true);
    }
  }

  function sendAction(msg, actionOpts) {
    if (!msg || typeof msg !== 'object') {
      return Promise.resolve({ ok: false, error: 'Invalid action' });
    }
    var autoDownload = !!(actionOpts && actionOpts.autoDownload);
    if (nativeVsCodeApi) {
      nativeVsCodeApi.postMessage(msg);
      return Promise.resolve({ ok: true });
    }
    if (msg.command === 'panelReady') {
      if (privacyChangePending && requestedPrivacyMask === true) {
        return sendAction({ command: 'setPrivacyMask', masked: true }, { _isPrivacyRetry: true });
      }
      if (lastReceivedSnapshot && !privacyChangePending) {
        notifySnapshot(lastReceivedSnapshot, lastReceivedHash);
      }
      return pollSnapshot(true);
    }
    if (msg.command === 'toggleConversation') {
      var cid = msg.cascadeId || msg.conversationId || '';
      if (cid && sidecarApi && sidecarApi.ui && typeof sidecarApi.ui.toggleConversation === 'function') {
        sidecarApi.ui.toggleConversation(cid, msg.options);
        return Promise.resolve({ ok: true });
      }
      if (cid) {
        return sendAction({ command: 'selectConversation', conversationId: cid });
      }
    }
    if (msg.command === 'copyText' && typeof msg.text === 'string') {
      return copyText(msg.text).then(function(ok) {
        dispatchWebviewMessage({ command: 'copyTextResult', ok: ok, source: msg.source || '' });
        return { ok: ok };
      });
    }
    if (msg.command === 'selectConversation' || msg.command === 'pinConversation') {
      var nextPin = normalizeConversationPin(
        msg.conversationId !== undefined ? msg.conversationId : msg.cascadeId
      );
      pinnedConversationId = nextPin;
      lastEtag = '';
    }
    if (msg.command === 'toggleLockMain') {
      lockToMainAgent = typeof msg.locked === 'boolean'
        ? msg.locked
        : (typeof msg.value === 'boolean' ? msg.value : !lockToMainAgent);
      lastEtag = '';
    }
    if (msg.command === 'setLockToMainAgent') {
      lockToMainAgent = !!(msg.value !== undefined ? msg.value : msg.locked);
      lastEtag = '';
    }
    var privacyAction = msg.command === 'setPrivacyMask' || msg.command === 'togglePrivacyMask';
    if (privacyAction) {
      if (privacyRetryTimer) { clearTimeout(privacyRetryTimer); privacyRetryTimer = null; }
      if (!(actionOpts && actionOpts._isPrivacyRetry)) { privacyRetryAttempts = 0; }
      privacyChangePending = true;
      requestedPrivacyMask = typeof msg.masked === 'boolean' ? msg.masked : msg.privacyMasked;
      if (requestedPrivacyMask === true) { writePendingRemask(true); }
      clearClientCaches();
    }
    if (msg.command === 'setPollingInterval' && typeof msg.value === 'number' && Number.isFinite(msg.value)) {
      configuredPollIntervalMs = Math.max(1000, Math.min(60000, Math.round(msg.value * 1000)));
      pollIntervalMs = configuredPollIntervalMs;
      scheduleNextPoll();
    }
    if ((msg.command === 'updateSetting' || msg.command === 'setAppSetting') && msg.key === 'pollingInterval' && typeof msg.value === 'number' && Number.isFinite(msg.value)) {
      configuredPollIntervalMs = Math.max(1000, Math.min(60000, Math.round(msg.value * 1000)));
      pollIntervalMs = configuredPollIntervalMs;
      scheduleNextPoll();
    }
    if ((msg.command === 'updateSettings' || msg.command === 'updateAppSettings')) {
      var settingsBag = (msg.settings && typeof msg.settings === 'object') ? msg.settings : ((msg.patch && typeof msg.patch === 'object') ? msg.patch : msg);
      if (settingsBag && typeof settingsBag.pollingInterval === 'number' && Number.isFinite(settingsBag.pollingInterval)) {
        configuredPollIntervalMs = Math.max(1000, Math.min(60000, Math.round(settingsBag.pollingInterval * 1000)));
        pollIntervalMs = configuredPollIntervalMs;
        scheduleNextPoll();
      }
    }

    // NEVER piggyback conversationId or workspaceUris onto generic actions!
    var payload = Object.assign({
      viewMode: detectViewMode(),
      windowId: windowId
    }, msg);

    var actionGen = ++responseGeneration;
    if (privacyAction) { privacyGeneration = actionGen; }
    return bridgeFetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (actionGen < privacyGeneration || (privacyChangePending && !privacyAction)) { return { ok: false }; }
        if (!data || typeof data !== 'object') { return { ok: false }; }
        if (privacyAction && data.ok) {
          var confirmedMasked = !!(data.snapshot && data.snapshot.privacyMasked === true);
          if (requestedPrivacyMask !== true || confirmedMasked) {
            privacyChangePending = false;
            privacyRetryAttempts = 0;
            if (privacyRetryTimer) { clearTimeout(privacyRetryTimer); privacyRetryTimer = null; }
            writePendingRemask(false);
            privacyGeneration = ++responseGeneration;
            actionGen = privacyGeneration;
            lastAppliedGeneration = actionGen;
          } else {
            handlePrivacyActionFailure(actionGen);
          }
        } else if (privacyAction && !data.ok) {
          handlePrivacyActionFailure(actionGen);
        }
        if (msg.command === 'openFileInAuxPane' && data.ok && typeof msg.uri === 'string'
            && sidecarApi && sidecarApi.ui && typeof sidecarApi.ui.toggleAuxPane === 'function') {
          sidecarApi.ui.toggleAuxPane({ tabType: 'fileView', uri: msg.uri });
        }
        var textToCopy = null;
        if (data.ok) {
          if (typeof data.text === 'string' && (msg.command === 'copyContextReport' || msg.command === 'copyHandoffPrompt' || msg.command === 'copyStatePath' || typeof data.copiedHint === 'string')) {
            textToCopy = data.text;
          } else if (data.result && typeof data.result.text === 'string' && (msg.command === 'copyContextReport' || msg.command === 'copyHandoffPrompt' || msg.command === 'copyStatePath')) {
            textToCopy = data.result.text;
          }
        }
        var copyPromise = textToCopy !== null
          ? copyText(textToCopy).then(function(copyOk) {
              try { data._copiedByBridge = true; } catch (_) { /* ignore */ }
              dispatchWebviewMessage({
                command: 'copyTextResult',
                ok: copyOk,
                source: msg.command,
                copiedHint: data.copiedHint || (data.result && data.result.copiedHint) || '',
                text: textToCopy
              });
              return copyOk;
            })
          : Promise.resolve(true);

        return copyPromise.then(function() {
          if (actionGen < privacyGeneration || (privacyChangePending && !privacyAction)) { return { ok: false }; }
          var dispatchedTypes = {};
          if (Array.isArray(data.messages)) {
            for (var i = 0; i < data.messages.length; i++) {
              var m = data.messages[i];
              if (!m || typeof m !== 'object') { continue; }
              var mKind = m.command || m.type || '';
              if (mKind) { dispatchedTypes[mKind] = true; }
              if (mKind === 'setPaused') {
                pollPaused = !!m.paused;
                if (pollPaused) {
                  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
                } else {
                  scheduleNextPoll();
                }
              }
              if (mKind === 'copyToClipboard' && typeof m.text === 'string') {
                void copyText(m.text);
              }
              if (mKind === 'downloadFile' && typeof m.content === 'string') {
                triggerFileDownload(m.filename, m.content, m.mimeType);
              }
              dispatchWebviewMessage(m);
            }
          }
          // Forward structured action responses even when returned only in data.result or top-level.
          var structuredCandidate = (data.result && typeof data.result === 'object' && !Array.isArray(data.result) && (data.result.type || data.result.command))
            ? data.result
            : ((data.type || data.command) ? data : null);
          if (structuredCandidate) {
            var sKind = structuredCandidate.command || structuredCandidate.type;
            if ((sKind === 'updateCheckResult' || sKind === 'pluginUpdateResult' || sKind === 'cdpStatusResult' || sKind === 'cdpLauncherResult' || sKind === 'configSaved' || sKind === 'syncSettingsControls' || sKind === 'privacyMaskState' || sKind === 'appOnboardingDismissed' || sKind === 'globalRulesFileContent' || sKind === 'globalRulesSaveResult' || sKind === 'globalRulesActionResult') && !dispatchedTypes[sKind]) {
              dispatchWebviewMessage(structuredCandidate);
              dispatchedTypes[sKind] = true;
            }
          }
          if (autoDownload && data.ok && (msg.command === 'calendarExportCsv' || msg.command === 'calendarExportJson')) {
            var dlPayload = (data.result && typeof data.result.content === 'string') ? data.result : data;
            if (dlPayload && typeof dlPayload.content === 'string') {
              triggerFileDownload(dlPayload.filename, dlPayload.content, dlPayload.mimeType);
            }
          }
          // Monotonic generation check: suppress stale out-of-order POST repaints & unmasked PII during re-mask!
          if (data.snapshot && actionGen >= lastAppliedGeneration
              && (!privacyChangePending || data.snapshot.privacyMasked === requestedPrivacyMask)) {
            lastAppliedGeneration = actionGen;
            if (data.hash) { lastEtag = String(data.hash); }
            notifySnapshot(data.snapshot, data.hash || '');
          }
          if (data.reload) {
            if (msg.command === 'switchLanguage' && urlParams.has('lang')) {
              try {
                var nextUrl = new URL(window.location.href);
                nextUrl.searchParams.delete('lang');
                window.location.replace(nextUrl.toString());
                return data;
              } catch (_) { /* fall through to reload */ }
            }
            window.location.reload();
          }
          return data;
        });
      })
      .catch(function(err) {
        if (privacyAction) { handlePrivacyActionFailure(actionGen); }
        return { ok: false, error: err && err.message ? err.message : 'Network error' };
      });
  }

  // Subscribe to host conversation & workspace changes when inside Antigravity App Sidecar
  if (sidecarApi) {
    if (lastObservedConversationId) {
      focusRevision += 1;
      pendingFocusEvent = {
        conversationId: lastObservedConversationId,
        focusRevision: focusRevision,
        conversationCleared: false,
        viewMode: detectViewMode()
      };
      void flushPendingFocusSync();
    }
    if (typeof sidecarApi.getWorkspaceUris === 'function') {
      Promise.resolve(sidecarApi.getWorkspaceUris()).then(function(uris) {
        if (Array.isArray(uris)) {
          void registerWorkspaces(uris);
          if (AUTO_POLL && !document.hidden) { pollSnapshot(false); }
        }
      }).catch(function() { /* ignore */ });
    }
    if (typeof sidecarApi.onConversationChange === 'function') {
      sidecarApi.onConversationChange(function(next) {
        var nextId = '';
        if (typeof next === 'string') {
          nextId = next.trim();
        } else if (next && typeof next === 'object' && typeof next.conversationId === 'string') {
          nextId = next.conversationId.trim();
        }
        recordCallbackConversationId(nextId);
        syncHostConversationChange(true, true);
      });
    }
    if (typeof sidecarApi.onWorkspaceChange === 'function') {
      sidecarApi.onWorkspaceChange(function(uris) {
        var normalized = normalizeWorkspaceUriList(uris);
        // Explicitly register even when normalized is [] to revoke old roots!
        void registerWorkspaces(normalized);
        for (var i = 0; i < workspaceListeners.length; i++) {
          try { workspaceListeners[i](normalized.slice()); } catch (_) { /* isolate */ }
        }
        if (!document.hidden && !pollPaused) { pollSnapshot(false); }
      });
    }
  }

  if (surface !== 'vscode') {
    window.addEventListener('message', function(event) {
      // Strict sender/origin validation: block untrusted cross-origin or cross-window focus spoofing!
      if (!isTrustedIncomingWindowMessage(event)) { return; }
      var d = event.data;
      if (d.type === 'conversation-change' || d.type === 'active-conversation-change') {
        var cid = typeof d.conversationId === 'string'
          ? d.conversationId.trim()
          : (d.payload && typeof d.payload.conversationId === 'string' ? d.payload.conversationId.trim() : '');
        recordCallbackConversationId(cid);
        syncHostConversationChange(true);
      }
    });
    window.addEventListener('pointerdown', markUserInteraction, { passive: true });
    window.addEventListener('keydown', markUserInteraction, { passive: true });
    window.addEventListener('wheel', markUserInteraction, { passive: true });
    window.addEventListener('focus', function() {
      markUserInteraction();
      if (!syncHostConversationChange(true) && pendingFocusEvent) {
        void flushPendingFocusSync();
      }
      if (pendingWorkspaceSync !== null) {
        void flushPendingWorkspaceRegistration();
      }
    }, { passive: true });
  }

  // Visibility-gated polling: pause immediately when tab/pane is hidden, resume on reveal
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      if (focusRetryTimer) { clearTimeout(focusRetryTimer); focusRetryTimer = null; }
      if (workspaceRetryTimer) { clearTimeout(workspaceRetryTimer); workspaceRetryTimer = null; }
    } else if (surface !== 'vscode' && AUTO_POLL && !pollPaused) {
      markUserInteraction();
      if (privacyChangePending && requestedPrivacyMask === true && !privacyRetryTimer) {
        void sendAction({ command: 'setPrivacyMask', masked: true }, { _isPrivacyRetry: true });
      }
      if (pendingFocusEvent) { void flushPendingFocusSync(); }
      if (pendingWorkspaceSync !== null) { void flushPendingWorkspaceRegistration(); }
      if (!syncHostConversationChange(true)) {
        pollSnapshot(false);
      }
    }
  });

  var vsCodeCompatApi = {
    getState: readStoredState,
    setState: writeStoredState,
    postMessage: function(msg) {
      void sendAction(msg, { autoDownload: true });
    }
  };

  var bridge = {
    surface: surface,
    windowId: windowId,
    sourceInstanceId: sourceInstanceId,
    getViewMode: detectViewMode,
    getState: readStoredState,
    setState: writeStoredState,
    postMessage: function(msg) { return sendAction(msg, { autoDownload: true }); },
    sendAction: sendAction,
    isTrustedHostEvent: isTrustedHostEvent,
    clearClientCaches: clearClientCaches,
    registerWorkspaces: registerWorkspaces,
    flushPendingFocusSync: flushPendingFocusSync,
    getFocusSyncState: function() {
      return {
        focusRevision: focusRevision,
        ackedFocusRevision: ackedFocusRevision,
        backendEpoch: knownBackendEpoch,
        windowId: windowId,
        sourceInstanceId: sourceInstanceId,
        pendingFocusEvent: pendingFocusEvent ? Object.assign({}, pendingFocusEvent) : null
      };
    },
    copyText: copyText,
    downloadFile: triggerFileDownload,
    copyContextReport: function() { return sendAction({ command: 'copyContextReport' }); },
    copyHandoffPrompt: function() { return sendAction({ command: 'copyHandoffPrompt' }); },
    selectConversation: function(conversationId) {
      return sendAction({ command: 'selectConversation', conversationId: conversationId === undefined ? null : conversationId });
    },
    toggleLockMain: function(locked) {
      var msg = { command: 'toggleLockMain' };
      if (typeof locked === 'boolean') { msg.locked = locked; }
      return sendAction(msg);
    },
    revealPath: function(targetPath) {
      return sendAction({ command: 'revealPath', path: targetPath });
    },
    getConversationId: function() { return getActiveConversationId(); },
    getWorkspaceUris: function() {
      if (sidecarApi && typeof sidecarApi.getWorkspaceUris === 'function') {
        return Promise.resolve(sidecarApi.getWorkspaceUris()).then(function(uris) {
          currentWorkspaceUris = normalizeWorkspaceUriList(uris);
          return currentWorkspaceUris.slice();
        });
      }
      return Promise.resolve(currentWorkspaceUris.slice());
    },
    onWorkspaceChange: function(listener) {
      if (typeof listener !== 'function') { return function() {}; }
      workspaceListeners.push(listener);
      return function() {
        var idx = workspaceListeners.indexOf(listener);
        if (idx >= 0) { workspaceListeners.splice(idx, 1); }
      };
    },
    onSnapshot: function(listener) {
      if (typeof listener !== 'function') { return function() {}; }
      snapshotListeners.push(listener);
      return function() {
        var idx = snapshotListeners.indexOf(listener);
        if (idx >= 0) { snapshotListeners.splice(idx, 1); }
      };
    },
    toggleConversation: function(conversationId, opts) {
      if (sidecarApi && sidecarApi.ui && typeof sidecarApi.ui.toggleConversation === 'function') {
        sidecarApi.ui.toggleConversation(conversationId, opts);
        return true;
      }
      if (conversationId) {
        void sendAction({ command: 'selectConversation', conversationId: conversationId });
        return true;
      }
      return false;
    },
    toggleAuxPane: function(req) {
      if (req && (req.tabType === 'fileView' || req.uri)) {
        if (req.tabType !== 'fileView' || typeof req.uri !== 'string') { return false; }
        void sendAction({ command: 'openFileInAuxPane', uri: req.uri });
        return true;
      }
      if (sidecarApi && sidecarApi.ui && typeof sidecarApi.ui.toggleAuxPane === 'function') {
        sidecarApi.ui.toggleAuxPane(req);
        return true;
      }
      return false;
    },
    pollNow: function(forceFull) { return pollSnapshot(forceFull !== false); },
    setPollIntervalMs: function(ms) {
      if (typeof ms === 'number' && Number.isFinite(ms)) {
        configuredPollIntervalMs = Math.max(1000, Math.min(60000, Math.round(ms)));
        pollIntervalMs = configuredPollIntervalMs;
        scheduleNextPoll();
      }
    },
    syncTheme: syncBodyTheme,
    asVsCodeApi: function() { return nativeVsCodeApi || vsCodeCompatApi; }
  };

  window.__ACM_BRIDGE__ = bridge;
  if (!hasNativeVsCode) {
    window.acquireVsCodeApi = function() { return vsCodeCompatApi; };
  }

  if (surface !== 'vscode' && AUTO_POLL && !document.hidden) {
    scheduleNextPoll();
  }
})();`;
}

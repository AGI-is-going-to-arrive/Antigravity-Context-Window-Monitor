/**
 * Browser-side host bridge script generator (`window.__ACM_BRIDGE__`).
 *
 * Allows the shared Studio Telemetry Ledger webview JavaScript to run cleanly
 * across three surfaces with zero edits to the core UI logic:
 *   1. VS Code / Antigravity IDE (`acquireVsCodeApi`)
 *   2. Antigravity App Sidecar (`window.sidecar` injected by `/preload.js`)
 *   3. Standalone HTTP (for headless Chromium smoke tests & local debugging)
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

    return `(function() {
  if (window.__ACM_BRIDGE__) { return; }

  var DEFAULT_POLL_MS = ${pollIntervalMs};
  var AUTO_POLL = ${autoPoll ? 'true' : 'false'};
  var STORAGE_KEY = ${JSON.stringify(storageKey)};

  var hasNativeVsCode = typeof window.acquireVsCodeApi === 'function';
  var nativeVsCodeApi = hasNativeVsCode ? window.acquireVsCodeApi() : null;
  var sidecarApi = (typeof window.sidecar === 'object' && window.sidecar !== null) ? window.sidecar : null;
  var surface = hasNativeVsCode ? 'vscode' : (sidecarApi ? 'sidecar' : 'standalone');

  function detectViewMode() {
    var attr = document.body && document.body.getAttribute('data-acm-view');
    if (attr === 'aux' || attr === 'sidebar' || attr === 'standalone') { return attr; }
    var p = (window.location && window.location.pathname) || '/';
    if (p.indexOf('/full') === 0) { return 'sidebar'; }
    return surface === 'sidecar' ? 'aux' : 'standalone';
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

  // ─── Theme Detection & Host Sync ───
  function parseColorRgb(raw) {
    if (!raw || typeof raw !== 'string') { return null; }
    var s = raw.trim().toLowerCase();
    var hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
    if (hex) {
      var h = hex[1];
      if (h.length === 3) {
        return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
      }
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    var rgb = s.match(/^rgba?\\(\\s*(\\d+(?:\\.\\d+)?)\\s*[,\\s]\\s*(\\d+(?:\\.\\d+)?)\\s*[,\\s]\\s*(\\d+(?:\\.\\d+)?)/);
    if (rgb) {
      return [parseFloat(rgb[1]), parseFloat(rgb[2]), parseFloat(rgb[3])];
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

  function resolveThemeFromHost() {
    if (surface === 'vscode') { return null; }
    var forcedHighContrast = typeof window.matchMedia === 'function' && (
      window.matchMedia('(forced-colors: active)').matches ||
      window.matchMedia('(prefers-contrast: more)').matches
    );
    var rootStyle = window.getComputedStyle ? window.getComputedStyle(document.documentElement) : null;
    var bgRaw = (document.documentElement.style.getPropertyValue('--background') || (rootStyle ? rootStyle.getPropertyValue('--background') : '') || '').trim();
    var lum = relativeLuminance(parseColorRgb(bgRaw));
    if (forcedHighContrast) {
      return (lum !== null && lum > 0.5) ? 'hc-light' : 'hc';
    }
    if (lum !== null) {
      return lum > 0.45 ? 'light' : 'dark';
    }
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark';
  }

  function syncBodyTheme() {
    if (surface === 'vscode' || !document.body) { return; }
    var kind = resolveThemeFromHost();
    if (!kind) { return; }
    document.body.setAttribute('data-acm-theme', kind);
    document.body.classList.toggle('vscode-light', kind === 'light');
    document.body.classList.toggle('vscode-dark', kind === 'dark');
    document.body.classList.toggle('vscode-high-contrast', kind === 'hc');
    document.body.classList.toggle('vscode-high-contrast-light', kind === 'hc-light');
  }

  window.addEventListener('message', function(event) {
    if (event && event.data && event.data.type === 'theme-change') {
      var vars = event.data.payload && event.data.payload.cssVariables;
      if (vars && typeof vars === 'object') {
        for (var k in vars) {
          if (Object.prototype.hasOwnProperty.call(vars, k)) {
            document.documentElement.style.setProperty(k, vars[k]);
          }
        }
      }
      syncBodyTheme();
    }
  });

  if (typeof window.matchMedia === 'function') {
    var lightMq = window.matchMedia('(prefers-color-scheme: light)');
    var contrastMq = window.matchMedia('(prefers-contrast: more)');
    if (lightMq && typeof lightMq.addEventListener === 'function') {
      lightMq.addEventListener('change', syncBodyTheme);
    }
    if (contrastMq && typeof contrastMq.addEventListener === 'function') {
      contrastMq.addEventListener('change', syncBodyTheme);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncBodyTheme);
  } else {
    syncBodyTheme();
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

  // ─── Sidecar / Standalone Transport & Visibility-Gated ETag Polling ───
  var urlParams = new URLSearchParams((window.location && window.location.search) || '');
  var initialUrlConversationId = urlParams.get('conversationId') || '';
  var currentWorkspaceUris = [];

  function getActiveConversationId() {
    if (sidecarApi && typeof sidecarApi.conversationId === 'string' && sidecarApi.conversationId) {
      return sidecarApi.conversationId;
    }
    return initialUrlConversationId;
  }
  var lastEtag = '';
  var pollIntervalMs = DEFAULT_POLL_MS;
  var pollPaused = false;
  var pollTimer = null;
  var pollInFlight = false;
  var consecutivePollErrors = 0;
  var snapshotListeners = [];
  var workspaceListeners = [];
  var pinnedConversationId = '';
  var lockToMainAgent = false;

  function bridgeFetch(url, opts) {
    if (sidecarApi && typeof sidecarApi.fetch === 'function') {
      return sidecarApi.fetch(url, opts || {});
    }
    var headers = Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {});
    return window.fetch(url, Object.assign({}, opts || {}, { headers: headers }));
  }

  function dispatchWebviewMessage(msg) {
    if (!msg || typeof msg !== 'object') { return; }
    try {
      window.dispatchEvent(new MessageEvent('message', { data: msg }));
    } catch (_) {
      window.postMessage(msg, '*');
    }
  }

  function syncLocalStateFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') { return; }
    if (typeof snapshot.paused === 'boolean') {
      pollPaused = snapshot.paused;
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
      var nextMs = Math.max(1000, Math.min(60000, Math.round(snapSettings.pollingInterval * 1000)));
      if (nextMs !== pollIntervalMs) {
        pollIntervalMs = nextMs;
      }
    }
  }

  function notifySnapshot(snapshot, hash) {
    syncLocalStateFromSnapshot(snapshot);
    for (var i = 0; i < snapshotListeners.length; i++) {
      try { snapshotListeners[i](snapshot, hash); } catch (_) { /* isolate listener */ }
    }
    try {
      if (typeof window.CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('acm:snapshot', {
          detail: { snapshot: snapshot, hash: hash || '' }
        }));
      }
    } catch (_) { /* ignore CustomEvent unavailability */ }
    if (snapshot && snapshot.tabs) {
      dispatchWebviewMessage({
        command: 'updateTabs',
        tabs: snapshot.tabs,
        time: snapshot.time || '',
        snapshot: snapshot,
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
  }

  function buildSnapshotUrl(forceFull) {
    var qs = new URLSearchParams();
    var view = detectViewMode();
    var activeConvId = getActiveConversationId();
    if (activeConvId) { qs.set('conversationId', activeConvId); }
    if (currentWorkspaceUris.length > 0) { qs.set('workspaceUris', JSON.stringify(currentWorkspaceUris)); }
    if (!forceFull && lastEtag) { qs.set('etag', lastEtag); }
    var urlLang = urlParams.get('lang');
    if (urlLang === 'en' || urlLang === 'zh' || urlLang === 'both') {
      qs.set('lang', urlLang);
    }
    qs.set('viewMode', view);
    qs.set('view', view);
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

  function pollSnapshot(forceFull) {
    if (surface === 'vscode' || pollInFlight || (document.hidden && !forceFull)) {
      return Promise.resolve(null);
    }
    pollInFlight = true;
    return bridgeFetch(buildSnapshotUrl(!!forceFull), { method: 'GET' })
      .then(function(res) {
        if (!res.ok) { throw new Error('HTTP ' + res.status); }
        return res.json();
      })
      .then(function(data) {
        consecutivePollErrors = 0;
        if (data && data.hash) { lastEtag = String(data.hash); }
        if (data && data.unchanged === false && data.snapshot) {
          notifySnapshot(data.snapshot, data.hash || '');
        }
        return data;
      })
      .catch(function() {
        consecutivePollErrors += 1;
        return null;
      })
      .finally(function() {
        pollInFlight = false;
        scheduleNextPoll();
      });
  }

  function normalizeConversationPin(rawId) {
    if (rawId === null || rawId === undefined) { return ''; }
    var s = String(rawId).trim();
    if (!s || s === 'auto' || s === '__auto__') { return ''; }
    return s;
  }

  function sendAction(msg) {
    if (!msg || typeof msg !== 'object') {
      return Promise.resolve({ ok: false, error: 'Invalid action' });
    }
    if (nativeVsCodeApi) {
      nativeVsCodeApi.postMessage(msg);
      return Promise.resolve({ ok: true });
    }
    if (msg.command === 'panelReady') {
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
    if (msg.command === 'openFileInAuxPane' && msg.uri && sidecarApi && sidecarApi.ui && typeof sidecarApi.ui.toggleAuxPane === 'function') {
      sidecarApi.ui.toggleAuxPane({ tabType: 'fileView', uri: msg.uri });
      return Promise.resolve({ ok: true });
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
    if (msg.command === 'setPollingInterval' && typeof msg.value === 'number' && Number.isFinite(msg.value)) {
      pollIntervalMs = Math.max(1000, Math.min(60000, Math.round(msg.value * 1000)));
      scheduleNextPoll();
    }
    if (msg.command === 'updateSetting' && msg.key === 'pollingInterval' && typeof msg.value === 'number' && Number.isFinite(msg.value)) {
      pollIntervalMs = Math.max(1000, Math.min(60000, Math.round(msg.value * 1000)));
      scheduleNextPoll();
    }
    if (msg.command === 'updateSettings' && msg.settings && typeof msg.settings.pollingInterval === 'number' && Number.isFinite(msg.settings.pollingInterval)) {
      pollIntervalMs = Math.max(1000, Math.min(60000, Math.round(msg.settings.pollingInterval * 1000)));
      scheduleNextPoll();
    }

    var payload = Object.assign({
      conversationId: getActiveConversationId(),
      workspaceUris: currentWorkspaceUris,
      viewMode: detectViewMode()
    }, msg);

    return bridgeFetch('/api/action', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
      .then(function(res) { return res.json(); })
      .then(function(data) {
        if (!data || typeof data !== 'object') { return { ok: false }; }
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
          if (Array.isArray(data.messages)) {
            for (var i = 0; i < data.messages.length; i++) {
              var m = data.messages[i];
              if (m && m.command === 'setPaused') {
                pollPaused = !!m.paused;
                if (!pollPaused) { scheduleNextPoll(); }
              }
              if (m && m.command === 'copyToClipboard' && typeof m.text === 'string') {
                void copyText(m.text);
              }
              dispatchWebviewMessage(m);
            }
          }
          if (data.snapshot) {
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
        return { ok: false, error: err && err.message ? err.message : 'Network error' };
      });
  }

  // Subscribe to host workspace changes when inside Antigravity App Sidecar
  if (sidecarApi) {
    if (typeof sidecarApi.getWorkspaceUris === 'function') {
      Promise.resolve(sidecarApi.getWorkspaceUris()).then(function(uris) {
        if (Array.isArray(uris)) {
          currentWorkspaceUris = uris.slice();
          if (AUTO_POLL && !document.hidden) { pollSnapshot(false); }
        }
      }).catch(function() { /* ignore */ });
    }
    if (typeof sidecarApi.onWorkspaceChange === 'function') {
      sidecarApi.onWorkspaceChange(function(uris) {
        currentWorkspaceUris = Array.isArray(uris) ? uris.slice() : [];
        lastEtag = '';
        for (var i = 0; i < workspaceListeners.length; i++) {
          try { workspaceListeners[i](currentWorkspaceUris.slice()); } catch (_) { /* isolate */ }
        }
        if (!document.hidden && !pollPaused) { pollSnapshot(false); }
      });
    }
  }

  // Visibility-gated polling: pause immediately when tab/pane is hidden, resume on reveal
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    } else if (surface !== 'vscode' && AUTO_POLL && !pollPaused) {
      pollSnapshot(false);
    }
  });

  var vsCodeCompatApi = {
    getState: readStoredState,
    setState: writeStoredState,
    postMessage: function(msg) {
      void sendAction(msg);
    }
  };

  var bridge = {
    surface: surface,
    getViewMode: detectViewMode,
    getState: readStoredState,
    setState: writeStoredState,
    postMessage: function(msg) { return sendAction(msg); },
    sendAction: sendAction,
    copyText: copyText,
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
          currentWorkspaceUris = Array.isArray(uris) ? uris.slice() : [];
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
      if (sidecarApi && sidecarApi.ui && typeof sidecarApi.ui.toggleAuxPane === 'function') {
        sidecarApi.ui.toggleAuxPane(req);
        return true;
      }
      return false;
    },
    pollNow: function(forceFull) { return pollSnapshot(forceFull !== false); },
    setPollIntervalMs: function(ms) {
      if (typeof ms === 'number' && Number.isFinite(ms)) {
        pollIntervalMs = Math.max(1000, Math.min(60000, Math.round(ms)));
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

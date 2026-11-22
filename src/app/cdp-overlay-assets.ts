/**
 * Studio-Telemetry Shadow DOM overlay assets for Antigravity App opt-in CDP injection.
 *
 * Security & Trusted Types Contract (NON-NEGOTIABLE):
 * - ZERO `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function`.
 * - Every DOM and SVG node is constructed strictly via `document.createElement`,
 *   `document.createElementNS`, `textContent`, and `setAttribute`.
 * - All styles are isolated inside Shadow DOM roots so host styles never bleed in or out.
 * - Quick actions communicate ONLY with the authenticated `127.0.0.1` loopback bridge
 *   using the 256-bit `X-Monitor-Token` header.
 */

import type { CdpOverlayPayload, CdpOverlayToggles } from './sidecar-types';

export const CDP_OVERLAY_SCRIPT_VERSION = '1.17.6-r1';
export const CDP_COMPOSER_HOST_ID = 'acm-cdp-composer-host';
export const CDP_TOPBAR_HOST_ID = 'acm-cdp-topbar-host';
export const CDP_RUNTIME_GLOBAL_KEY = '__ACM_CDP_OVERLAY_V1__';

export interface CdpOverlayBootstrapConfig {
    scriptVersion?: string;
    composerHostId?: string;
    topBarHostId?: string;
}

/**
 * Serialize a JS value safely for embedding inside a script expression.
 * Escapes `<`, `>`, `&`, U+2028, and U+2029 so no string can break script boundaries.
 */
export function safeJsonForScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/**
 * Shared Studio-Telemetry CSS tokens (Light + Dark + Reduced Motion) matching DESIGN.md.
 */
export function getSharedOverlayThemeCss(): string {
    return `
:host {
  --acm-sans-cjk: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif;
  --acm-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", var(--acm-sans-cjk);
  --acm-mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace;

  /* Dark Obsidian Slate (Default) */
  --acm-bg: rgba(13, 16, 20, 0.88);
  --acm-surface: rgba(20, 24, 31, 0.92);
  --acm-surface-solid: #14181F;
  --acm-well: #1B212B;
  --acm-hover: #222A36;
  --acm-track: #232B38;
  --acm-border: #232A35;
  --acm-border-strong: #323C4C;
  --acm-control-border: #5A687D;

  --acm-ink: #F2F4F8;
  --acm-ink-secondary: #B6C0CE;
  --acm-ink-muted: #8C98A9;

  --acm-accent: #5B9CF6;
  --acm-accent-hover: #7AB2FA;
  --acm-accent-ink: #090D12;
  --acm-accent-tint: rgba(91, 156, 246, 0.14);
  --acm-accent-border: rgba(91, 156, 246, 0.36);

  --acm-good: #34D399;
  --acm-good-fill: #10B981;
  --acm-good-tint: rgba(52, 211, 153, 0.14);
  --acm-good-border: rgba(52, 211, 153, 0.34);

  --acm-warn: #F5B841;
  --acm-warn-fill: #F59E0B;
  --acm-warn-tint: rgba(245, 184, 65, 0.14);
  --acm-warn-border: rgba(245, 184, 65, 0.34);

  --acm-danger: #F87171;
  --acm-danger-fill: #EF4444;
  --acm-danger-tint: rgba(248, 113, 113, 0.14);
  --acm-danger-border: rgba(248, 113, 113, 0.36);

  --acm-shadow: 0 14px 36px rgba(0, 0, 0, 0.52), 0 2px 10px rgba(0, 0, 0, 0.34);
  --acm-ease: cubic-bezier(0.2, 0, 0, 1);

  font-family: var(--acm-sans);
  font-size: 12px;
  line-height: 1.45;
  color: var(--acm-ink);
  color-scheme: dark;
  -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
}

:host([data-theme="light"]) {
  --acm-bg: rgba(250, 251, 252, 0.90);
  --acm-surface: rgba(255, 255, 255, 0.94);
  --acm-surface-solid: #FFFFFF;
  --acm-well: #F2F4F8;
  --acm-hover: #E9EEF5;
  --acm-track: #E2E7EF;
  --acm-border: #E4E8EF;
  --acm-border-strong: #C8D0DC;
  --acm-control-border: #8792A4;

  --acm-ink: #111318;
  --acm-ink-secondary: #454D5B;
  --acm-ink-muted: #5A6475;

  --acm-accent: #1D4ED8;
  --acm-accent-hover: #1E40AF;
  --acm-accent-ink: #FFFFFF;
  --acm-accent-tint: rgba(29, 78, 216, 0.10);
  --acm-accent-border: rgba(29, 78, 216, 0.28);

  --acm-good: #0E7448;
  --acm-good-fill: #128052;
  --acm-good-tint: rgba(14, 116, 72, 0.10);
  --acm-good-border: rgba(14, 116, 72, 0.28);

  --acm-warn: #945605;
  --acm-warn-fill: #B46909;
  --acm-warn-tint: rgba(217, 119, 6, 0.12);
  --acm-warn-border: rgba(180, 105, 9, 0.30);

  --acm-danger: #C02430;
  --acm-danger-fill: #D02B37;
  --acm-danger-tint: rgba(220, 38, 38, 0.10);
  --acm-danger-border: rgba(192, 36, 48, 0.30);

  --acm-shadow: 0 12px 30px rgba(17, 19, 24, 0.14), 0 2px 8px rgba(17, 19, 24, 0.08);
  color-scheme: light;
}

*, *::before, *::after {
  box-sizing: border-box;
}

.acm-num {
  font-variant-numeric: tabular-nums lining-nums;
}

.acm-mono {
  font-family: var(--acm-mono);
  font-variant-numeric: tabular-nums lining-nums;
}

.acm-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border-radius: 6px;
  border: 1px solid var(--acm-control-border);
  background: var(--acm-well);
  color: var(--acm-ink);
  font-family: var(--acm-sans);
  font-size: 11px;
  font-weight: 550;
  cursor: pointer;
  transition: background 150ms var(--acm-ease), border-color 150ms var(--acm-ease), color 150ms var(--acm-ease);
  white-space: nowrap;
}

.acm-btn:hover {
  background: var(--acm-hover);
  border-color: var(--acm-ink-muted);
}

.acm-btn:focus-visible {
  outline: 2px solid var(--acm-accent);
  outline-offset: 2px;
}

.acm-btn.is-primary {
  background: var(--acm-accent);
  border-color: transparent;
  color: var(--acm-accent-ink);
}

.acm-btn.is-primary:hover {
  background: var(--acm-accent-hover);
}

.acm-pill-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 9999px;
  font-size: 10.5px;
  font-weight: 600;
  border: 1px solid var(--acm-border-strong);
  background: var(--acm-well);
  color: var(--acm-ink-secondary);
  white-space: nowrap;
}

.acm-pill-badge.is-good {
  background: var(--acm-good-tint);
  color: var(--acm-good);
  border-color: var(--acm-good-border);
}

.acm-pill-badge.is-warn {
  background: var(--acm-warn-tint);
  color: var(--acm-warn);
  border-color: var(--acm-warn-border);
}

.acm-pill-badge.is-danger {
  background: var(--acm-danger-tint);
  color: var(--acm-danger);
  border-color: var(--acm-danger-border);
}

.acm-pill-badge.is-accent {
  background: var(--acm-accent-tint);
  color: var(--acm-accent);
  border-color: var(--acm-accent-border);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
  }
}
`.trim();
}

/**
 * Shadow DOM stylesheet for the Composer Context Ring and frosted-glass hover/pinned popover.
 */
export function getComposerOverlayCss(): string {
    return `${getSharedOverlayThemeCss()}

:host {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  margin-right: 6px;
  position: relative;
  -webkit-app-region: no-drag;
}

.acm-ring-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: 9999px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--acm-ink);
  cursor: pointer;
  transition: background 150ms var(--acm-ease), border-color 150ms var(--acm-ease), transform 120ms var(--acm-ease);
}

.acm-ring-trigger:hover {
  background: var(--acm-hover);
  border-color: var(--acm-border-strong);
}

.acm-ring-trigger.is-pinned {
  background: var(--acm-accent-tint);
  border-color: var(--acm-accent-border);
}

.acm-ring-trigger:focus-visible {
  outline: 2px solid var(--acm-accent);
  outline-offset: 2px;
}

.acm-ring-svg {
  width: 20px;
  height: 20px;
  display: block;
}

.acm-ring-track {
  fill: none;
  stroke: var(--acm-track);
  stroke-width: 2.5;
}

.acm-ring-arc {
  fill: none;
  stroke: var(--acm-accent);
  stroke-width: 2.5;
  stroke-linecap: round;
  transition: stroke-dashoffset 220ms var(--acm-ease), stroke 180ms var(--acm-ease);
}

.acm-ring-arc.is-warn { stroke: var(--acm-warn-fill); }
.acm-ring-arc.is-danger { stroke: var(--acm-danger-fill); }

.acm-ring-pct {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 7.5px;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: var(--acm-ink-secondary);
  pointer-events: none;
}

.acm-popover {
  position: fixed;
  z-index: 2147483600;
  width: min(344px, calc(100vw - 20px));
  padding: 14px 15px 12px;
  border-radius: 12px;
  border: 1px solid var(--acm-border-strong);
  background: var(--acm-surface);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  backdrop-filter: blur(18px) saturate(150%);
  box-shadow: var(--acm-shadow);
  color: var(--acm-ink);
  display: none;
}

.acm-popover.is-open {
  display: block;
}

.acm-pop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.acm-pop-title {
  font-size: 12.5px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--acm-ink);
}

.acm-pop-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.acm-model-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.acm-model-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--acm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acm-pct-hero {
  font-size: 13px;
  font-weight: 700;
  color: var(--acm-ink);
  flex-shrink: 0;
}

.acm-pct-hero.is-warn { color: var(--acm-warn); }
.acm-pct-hero.is-danger { color: var(--acm-danger); }

.acm-meter-wrap {
  position: relative;
  height: 7px;
  border-radius: 9999px;
  background: var(--acm-track);
  overflow: visible;
  margin-bottom: 5px;
}

.acm-meter-fill {
  height: 100%;
  border-radius: 9999px;
  background: var(--acm-accent);
  transition: width 220ms var(--acm-ease), background 180ms var(--acm-ease);
}

.acm-meter-fill.is-warn { background: var(--acm-warn-fill); }
.acm-meter-fill.is-danger { background: var(--acm-danger-fill); }

.acm-watermark-tick {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  border-radius: 1px;
  transform: translateX(-1px);
  pointer-events: none;
}

.acm-watermark-tick.is-compaction {
  background: var(--acm-warn);
}

.acm-watermark-tick.is-tier200k {
  background: var(--acm-ink-muted);
}

.acm-meter-caption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 10.5px;
  color: var(--acm-ink-muted);
  margin-bottom: 10px;
}

.acm-section {
  padding-top: 8px;
  margin-top: 8px;
  border-top: 1px solid var(--acm-border);
}

.acm-section-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--acm-ink-muted);
  margin-bottom: 5px;
  letter-spacing: 0.01em;
}

.acm-kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px 10px;
}

.acm-kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
}

.acm-kv.is-full {
  grid-column: 1 / -1;
}

.acm-k {
  font-size: 11px;
  color: var(--acm-ink-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.acm-v {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--acm-ink);
  white-space: nowrap;
}

.acm-v-sub {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--acm-ink-muted);
  margin-left: 4px;
}

.acm-footer-pill {
  margin-top: 10px;
  padding: 6px 9px;
  border-radius: 8px;
  background: var(--acm-well);
  border: 1px solid var(--acm-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.acm-summary-text {
  font-size: 11px;
  font-weight: 550;
  color: var(--acm-ink-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acm-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 9px;
}

.acm-actions .acm-btn {
  flex: 1;
}
`.trim();
}

/**
 * Shadow DOM stylesheet for the Top-Right Header Status Cluster, WCO spacer,
 * narrow-window overflow menu, and Model Quota Board Popover.
 */
export function getTopBarOverlayCss(): string {
    return `${getSharedOverlayThemeCss()}

:host {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  -webkit-app-region: no-drag;
  position: relative;
}

:host([data-anchor="fixed"]) {
  position: fixed;
  top: 6px;
  right: 10px;
  z-index: 2147483000;
}

.acm-bar-cluster {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 4px;
  border-radius: 8px;
  border: 1px solid var(--acm-border);
  background: var(--acm-surface);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-app-region: no-drag;
}

.acm-bar-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 7px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--acm-ink);
  font-family: var(--acm-sans);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 140ms var(--acm-ease), border-color 140ms var(--acm-ease);
}

.acm-bar-pill:hover {
  background: var(--acm-hover);
  border-color: var(--acm-border-strong);
}

.acm-bar-pill.is-active {
  background: var(--acm-accent-tint);
  border-color: var(--acm-accent-border);
}

.acm-bar-pill:focus-visible {
  outline: 2px solid var(--acm-accent);
  outline-offset: 1px;
}

.acm-bar-pill.is-hidden {
  display: none;
}

.acm-bar-tag {
  font-size: 10px;
  font-weight: 500;
  color: var(--acm-ink-muted);
}

.acm-bar-pill.is-warn {
  color: var(--acm-warn);
}

.acm-bar-pill.is-danger {
  color: var(--acm-danger);
}

.acm-mini-ring {
  width: 14px;
  height: 14px;
  display: block;
  flex-shrink: 0;
}

.acm-mini-track {
  fill: none;
  stroke: var(--acm-track);
  stroke-width: 2.4;
}

.acm-mini-arc {
  fill: none;
  stroke: var(--acm-good-fill);
  stroke-width: 2.4;
  stroke-linecap: round;
  transition: stroke-dashoffset 220ms var(--acm-ease), stroke 180ms var(--acm-ease);
}

.acm-mini-arc.is-accent { stroke: var(--acm-accent); }
.acm-mini-arc.is-warn { stroke: var(--acm-warn-fill); }
.acm-mini-arc.is-danger { stroke: var(--acm-danger-fill); }

.acm-wco-spacer {
  display: none;
  flex-shrink: 0;
  height: 1px;
  pointer-events: none;
}

.acm-overflow-menu {
  position: fixed;
  z-index: 2147483605;
  min-width: 196px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--acm-border-strong);
  background: var(--acm-surface);
  -webkit-backdrop-filter: blur(16px) saturate(150%);
  backdrop-filter: blur(16px) saturate(150%);
  box-shadow: var(--acm-shadow);
  display: none;
}

.acm-overflow-menu.is-open {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.acm-overflow-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--acm-ink-secondary);
}

.acm-quota-popover {
  position: fixed;
  z-index: 2147483610;
  width: min(444px, calc(100vw - 20px));
  max-height: min(620px, calc(100vh - 56px));
  overflow-y: auto;
  padding: 14px 16px 13px;
  border-radius: 12px;
  border: 1px solid var(--acm-border-strong);
  background: var(--acm-surface);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  backdrop-filter: blur(18px) saturate(150%);
  box-shadow: var(--acm-shadow);
  color: var(--acm-ink);
  display: none;
}

.acm-quota-popover.is-open {
  display: block;
}

.acm-qp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--acm-border);
}

.acm-qp-title {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.acm-qp-meta {
  font-size: 10.5px;
  color: var(--acm-ink-muted);
  margin-top: 2px;
}

.acm-qp-head-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.acm-qp-section {
  margin-top: 11px;
}

.acm-qp-section-title {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--acm-ink-muted);
  margin-bottom: 7px;
}

.acm-qp-session-card {
  padding: 10px 11px;
  border-radius: 9px;
  background: var(--acm-well);
  border: 1px solid var(--acm-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.acm-qp-session-model {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
}

.acm-qp-bar-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.acm-qp-bar-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}

.acm-qp-track {
  height: 5px;
  border-radius: 9999px;
  background: var(--acm-track);
  overflow: hidden;
}

.acm-qp-fill {
  height: 100%;
  border-radius: 9999px;
  background: var(--acm-good-fill);
  transition: width 220ms var(--acm-ease);
}

.acm-qp-fill.is-warn { background: var(--acm-warn-fill); }
.acm-qp-fill.is-danger { background: var(--acm-danger-fill); }
.acm-qp-fill.is-unknown { background: var(--acm-border-strong); }

.acm-pool-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.acm-pool-card {
  padding: 9px 11px;
  border-radius: 9px;
  background: var(--acm-well);
  border: 1px solid var(--acm-border);
}

.acm-pool-card.is-current {
  border-color: var(--acm-accent-border);
}

.acm-pool-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 5px;
}

.acm-pool-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--acm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acm-pool-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.acm-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.acm-model-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--acm-border);
  background: var(--acm-surface-solid);
  color: var(--acm-ink-secondary);
  font-size: 10px;
  font-weight: 500;
}

.acm-qp-footer {
  margin-top: 11px;
  padding-top: 9px;
  border-top: 1px solid var(--acm-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--acm-ink-muted);
}
`.trim();
}

/**
 * Build the idempotent Shadow DOM runtime bootstrap script evaluated in the Antigravity Hub page.
 * Installs `window.__ACM_CDP_OVERLAY_V1__` with `.applyState(payload, toggles)`,
 * `.unmount(slot)`, and `.getStatus()`.
 *
 * Strictly Trusted-Types safe: uses ZERO `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
 * `document.write`, `eval`, or `new Function`.
 */
export function buildOverlayBootstrapScript(config: CdpOverlayBootstrapConfig = {}): string {
    const scriptVersion = config.scriptVersion || CDP_OVERLAY_SCRIPT_VERSION;
    const composerHostId = config.composerHostId || CDP_COMPOSER_HOST_ID;
    const topBarHostId = config.topBarHostId || CDP_TOPBAR_HOST_ID;
    const composerCss = getComposerOverlayCss();
    const topBarCss = getTopBarOverlayCss();

    return `(function() {
  var GLOBAL_KEY = ${safeJsonForScript(CDP_RUNTIME_GLOBAL_KEY)};
  var SCRIPT_VERSION = ${safeJsonForScript(scriptVersion)};
  var COMPOSER_HOST_ID = ${safeJsonForScript(composerHostId)};
  var TOPBAR_HOST_ID = ${safeJsonForScript(topBarHostId)};
  var COMPOSER_CSS = ${safeJsonForScript(composerCss)};
  var TOPBAR_CSS = ${safeJsonForScript(topBarCss)};
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var RING_RADIUS = 9;
  var RING_CIRC = 2 * Math.PI * RING_RADIUS;
  var MINI_RADIUS = 5.4;
  var MINI_CIRC = 2 * Math.PI * MINI_RADIUS;

  var existing = window[GLOBAL_KEY];
  if (existing && existing.version === SCRIPT_VERSION) {
    return { installed: true, reused: true, version: SCRIPT_VERSION };
  }
  if (existing && typeof existing.unmount === 'function') {
    try { existing.unmount('all'); } catch (_e) {}
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      var keys = Object.keys(attrs);
      for (var i = 0; i < keys.length; i++) {
        node.setAttribute(keys[i], String(attrs[keys[i]]));
      }
    }
    return node;
  }

  function bi(lang, en, zh) {
    if (lang === 'zh') { return zh; }
    if (lang === 'en') { return en; }
    return en === zh ? en : (en + ' / ' + zh);
  }

  function clampNum(v, min, max) {
    var n = Number(v);
    if (!Number.isFinite(n)) { return min; }
    return Math.min(Math.max(n, min), max);
  }

  function formatCompact(n) {
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) { return '0'; }
    if (n >= 1e9) { return (n / 1e9).toFixed(1).replace(/\\.0$/, '') + 'B'; }
    if (n >= 1e6) { return (n / 1e6).toFixed(1).replace(/\\.0$/, '') + 'M'; }
    if (n >= 1e3) { return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\\.0$/, '') + 'k'; }
    return String(Math.round(n));
  }

  function formatTtft(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) { return '—'; }
    if (ms >= 1000) { return (ms / 1000).toFixed(2) + 's'; }
    return Math.round(ms) + 'ms';
  }

  function formatTps(tps) {
    if (typeof tps !== 'number' || !Number.isFinite(tps) || tps <= 0) { return '—'; }
    return tps.toFixed(1) + ' tok/s';
  }

  function formatPct(pct) {
    if (typeof pct !== 'number' || !Number.isFinite(pct)) { return '—'; }
    return Math.round(pct) + '%';
  }

  function formatUsd(usd, preformatted) {
    if (typeof preformatted === 'string' && preformatted.trim()) { return preformatted.trim(); }
    if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) { return '—'; }
    if (usd >= 10) { return '$' + usd.toFixed(2); }
    if (usd >= 0.01) { return '$' + usd.toFixed(2); }
    return '$' + usd.toFixed(4);
  }

  function detectHostTheme(explicitTheme) {
    if (explicitTheme === 'light' || explicitTheme === 'dark') { return explicitTheme; }
    try {
      var html = document.documentElement;
      var body = document.body;
      var cls = ((html && html.className) || '') + ' ' + ((body && body.className) || '');
      var dataTheme = (html && html.getAttribute('data-theme')) || (body && body.getAttribute('data-theme')) || '';
      var combined = (cls + ' ' + dataTheme).toLowerCase();
      if (/\\b(?:vscode-light|light)\\b/.test(combined) && !/\\b(?:vscode-dark|dark)\\b/.test(combined)) {
        return 'light';
      }
      if (/\\b(?:vscode-dark|dark)\\b/.test(combined)) {
        return 'dark';
      }
      var target = body || html;
      if (target && window.getComputedStyle) {
        var bg = window.getComputedStyle(target).backgroundColor || '';
        var m = bg.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
        if (m) {
          var alpha = m[4] !== undefined ? parseFloat(m[4]) : 1;
          if (alpha > 0.1) {
            var r = parseInt(m[1], 10);
            var g = parseInt(m[2], 10);
            var b = parseInt(m[3], 10);
            var lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
            return lum > 0.55 ? 'light' : 'dark';
          }
        }
      }
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
      }
    } catch (_e) {}
    return 'dark';
  }

  function isWindowsClient() {
    try {
      var ua = (navigator.userAgent || '') + ' ' + (navigator.platform || '');
      return /win/i.test(ua);
    } catch (_e) {
      return false;
    }
  }

  function computeWcoInsetPx(isFixedAnchor) {
    try {
      if (navigator.windowControlsOverlay && navigator.windowControlsOverlay.visible) {
        var rect = navigator.windowControlsOverlay.getTitlebarAreaRect();
        if (rect && typeof rect.right === 'number') {
          var rightGap = Math.max(0, Math.round(window.innerWidth - rect.right));
          if (rightGap > 0) { return rightGap + 8; }
        }
      }
    } catch (_e) {}
    if (isFixedAnchor && isWindowsClient()) {
      return 138;
    }
    return 0;
  }

  function sendBridgeAction(payload, command, source, feedbackEl) {
    if (!payload || typeof payload.bridgeUrl !== 'string' || typeof payload.bridgeToken !== 'string') {
      return;
    }
    if (!/^http:\\/\\/127\\.0\\.0\\.1:\\d+$/.test(payload.bridgeUrl) || !payload.bridgeToken) {
      return;
    }
    try {
      fetch(payload.bridgeUrl + '/api/overlay/action', {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          'X-Monitor-Token': payload.bridgeToken
        },
        body: JSON.stringify({ command: command, source: source })
      }).then(function(res) {
        if (feedbackEl) {
          feedbackEl.textContent = res.ok
            ? bi(payload.language || 'both', 'Sent', '已发送')
            : bi(payload.language || 'both', 'Unavailable', '不可用');
        }
      }).catch(function() {
        if (feedbackEl) {
          feedbackEl.textContent = bi(payload.language || 'both', 'Offline', '未连接');
        }
      });
    } catch (_e) {}
  }

  function clearChildren(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function findComposerAnchor() {
    var footers = document.querySelectorAll('.agy-composer-footer, [data-testid="composer-footer"], [class*="composer-footer"]');
    var permRe = /^(?:turbo|auto|ask|plan|fast|agent|chat|edit|自动|询问|计划|极速)$/i;
    for (var i = 0; i < footers.length; i++) {
      var footer = footers[i];
      var buttons = footer.querySelectorAll('button, [role="button"]');
      for (var j = 0; j < buttons.length; j++) {
        var btn = buttons[j];
        var label = (btn.textContent || '').trim();
        var tid = (btn.getAttribute('data-testid') || '').toLowerCase();
        if (permRe.test(label) || tid.indexOf('permission') >= 0 || tid.indexOf('mode') >= 0) {
          if (btn.parentElement) {
            return { parent: btn.parentElement, before: btn, mode: 'inline' };
          }
        }
      }
      var firstGroup = footer.firstElementChild;
      if (firstGroup) {
        return { parent: firstGroup, before: firstGroup.firstChild, mode: 'inline' };
      }
      return { parent: footer, before: footer.firstChild, mode: 'inline' };
    }
    return null;
  }

  function findTopBarAnchor() {
    var auxBtn = document.querySelector('[data-testid="toggle-aux-sidebar"]');
    if (auxBtn && auxBtn.parentElement) {
      return { parent: auxBtn.parentElement, before: auxBtn, mode: 'inline' };
    }
    var toolbar = document.querySelector('[data-testid="pane-titlebar-toolbar"], [class*="@container/titlebar"]');
    if (toolbar) {
      return { parent: toolbar, before: toolbar.firstChild, mode: 'inline' };
    }
    var floatingRight = document.querySelector('div.absolute.right-0.top-0');
    if (floatingRight) {
      return { parent: floatingRight, before: floatingRight.firstChild, mode: 'inline' };
    }
    if (document.body) {
      return { parent: document.body, before: null, mode: 'fixed' };
    }
    return null;
  }

  var state = {
    composerEnabled: false,
    topBarEnabled: false,
    payload: null,
    composerHost: null,
    composerShadow: null,
    composerRefs: null,
    composerPinned: false,
    composerOpen: false,
    composerHideTimer: null,
    topBarHost: null,
    topBarShadow: null,
    topBarRefs: null,
    topBarAnchorMode: 'inline',
    quotaOpen: false,
    overflowOpen: false,
    countdownSec: null,
    countdownTimer: null,
    domObserver: null,
    themeObserver: null,
    reanchorTimer: null
  };

  function syncThemes() {
    var theme = detectHostTheme(state.payload && state.payload.theme);
    if (state.composerHost) { state.composerHost.setAttribute('data-theme', theme); }
    if (state.topBarHost) { state.topBarHost.setAttribute('data-theme', theme); }
  }

  function positionPopoverNear(triggerEl, popEl, preferAbove) {
    if (!triggerEl || !popEl) { return; }
    var rect = triggerEl.getBoundingClientRect();
    var vw = window.innerWidth || 1280;
    var vh = window.innerHeight || 800;
    popEl.style.visibility = 'hidden';
    popEl.classList.add('is-open');
    var pw = popEl.offsetWidth || 340;
    var ph = popEl.offsetHeight || 260;

    var left = Math.round(rect.right - pw);
    if (left < 10) { left = Math.round(rect.left); }
    if (left + pw > vw - 10) { left = Math.max(10, vw - pw - 10); }

    var top;
    if (preferAbove) {
      top = Math.round(rect.top - ph - 8);
      if (top < 10) { top = Math.min(vh - ph - 10, Math.round(rect.bottom + 8)); }
    } else {
      top = Math.round(rect.bottom + 8);
      if (top + ph > vh - 10) { top = Math.max(10, Math.round(rect.top - ph - 8)); }
    }
    popEl.style.left = Math.max(10, left) + 'px';
    popEl.style.top = Math.max(10, top) + 'px';
    popEl.style.visibility = '';
  }

  function createComposerSlot() {
    var existingNode = document.getElementById(COMPOSER_HOST_ID);
    if (existingNode && existingNode.parentNode) {
      existingNode.parentNode.removeChild(existingNode);
    }

    var host = el('div');
    host.id = COMPOSER_HOST_ID;
    host.setAttribute('data-acm-overlay', 'composer');
    host.setAttribute('data-theme', detectHostTheme(state.payload && state.payload.theme));

    var shadow = host.attachShadow({ mode: 'open' });
    var styleEl = el('style');
    styleEl.textContent = COMPOSER_CSS;
    shadow.appendChild(styleEl);

    var trigger = el('button', 'acm-ring-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'Context window usage');

    var svg = svgEl('svg', { class: 'acm-ring-svg', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    var track = svgEl('circle', { class: 'acm-ring-track', cx: '12', cy: '12', r: String(RING_RADIUS) });
    var arc = svgEl('circle', {
      class: 'acm-ring-arc',
      cx: '12',
      cy: '12',
      r: String(RING_RADIUS),
      'stroke-dasharray': RING_CIRC.toFixed(2),
      'stroke-dashoffset': RING_CIRC.toFixed(2),
      transform: 'rotate(-90 12 12)'
    });
    svg.appendChild(track);
    svg.appendChild(arc);
    var pctCenter = el('span', 'acm-ring-pct acm-num', '0');
    trigger.appendChild(svg);
    trigger.appendChild(pctCenter);

    var popover = el('div', 'acm-popover');
    popover.setAttribute('role', 'dialog');

    var head = el('div', 'acm-pop-header');
    var titleEl = el('div', 'acm-pop-title', 'Usage / 用量');
    var headRight = el('div', 'acm-pop-header-right');
    var pinBadge = el('span', 'acm-pill-badge is-accent', 'Pinned');
    pinBadge.style.display = 'none';
    headRight.appendChild(pinBadge);
    head.appendChild(titleEl);
    head.appendChild(headRight);

    var modelRow = el('div', 'acm-model-row');
    var modelNameEl = el('div', 'acm-model-name', '—');
    var pctHeroEl = el('div', 'acm-pct-hero acm-num', '0%');
    modelRow.appendChild(modelNameEl);
    modelRow.appendChild(pctHeroEl);

    var meterWrap = el('div', 'acm-meter-wrap');
    var meterFill = el('div', 'acm-meter-fill');
    meterFill.style.width = '0%';
    var tickCompaction = el('div', 'acm-watermark-tick is-compaction');
    tickCompaction.style.display = 'none';
    var tick200k = el('div', 'acm-watermark-tick is-tier200k');
    tick200k.style.display = 'none';
    meterWrap.appendChild(meterFill);
    meterWrap.appendChild(tickCompaction);
    meterWrap.appendChild(tick200k);

    var meterCaption = el('div', 'acm-meter-caption acm-num');
    var capTokens = el('span', '', '0 / 0');
    var capWatermarks = el('span', '', '');
    meterCaption.appendChild(capTokens);
    meterCaption.appendChild(capWatermarks);

    // Performance section
    var perfSec = el('div', 'acm-section');
    var perfLabel = el('div', 'acm-section-label', 'Performance / 性能');
    var perfGrid = el('div', 'acm-kv-grid');
    function makeKv(labelText, fullWidth) {
      var row = el('div', fullWidth ? 'acm-kv is-full' : 'acm-kv');
      var k = el('span', 'acm-k', labelText);
      var v = el('span', 'acm-v acm-num', '—');
      row.appendChild(k);
      row.appendChild(v);
      return { row: row, k: k, v: v };
    }
    var kvSpeed = makeKv('Output Speed', true);
    var kvAvgSpeed = makeKv('Avg Speed', false);
    var kvTtft = makeKv('First Token', false);
    perfGrid.appendChild(kvSpeed.row);
    perfGrid.appendChild(kvAvgSpeed.row);
    perfGrid.appendChild(kvTtft.row);
    perfSec.appendChild(perfLabel);
    perfSec.appendChild(perfGrid);

    // Cache section
    var cacheSec = el('div', 'acm-section');
    var cacheLabel = el('div', 'acm-section-label', 'Cache / 缓存');
    var cacheGrid = el('div', 'acm-kv-grid');
    var kvRecentCh = makeKv('Recent CH', false);
    var kvAvgCh = makeKv('Avg CH', false);
    var kvTurnState = makeKv('Turn Cache', true);
    var turnBadge = el('span', 'acm-pill-badge', '—');
    clearChildren(kvTurnState.v);
    kvTurnState.v.appendChild(turnBadge);
    cacheGrid.appendChild(kvRecentCh.row);
    cacheGrid.appendChild(kvAvgCh.row);
    cacheGrid.appendChild(kvTurnState.row);
    cacheSec.appendChild(cacheLabel);
    cacheSec.appendChild(cacheGrid);

    // Tokens & Cost section
    var tcSec = el('div', 'acm-section');
    var tcLabel = el('div', 'acm-section-label', 'Tokens & Cost');
    var tcGrid = el('div', 'acm-kv-grid');
    var kvCost = makeKv('Est. Cost', true);
    var kvInOut = makeKv('Input / Output', false);
    var kvCacheRead = makeKv('Cache Read', false);
    var kvTotal = makeKv('Total Tokens', true);
    tcGrid.appendChild(kvCost.row);
    tcGrid.appendChild(kvInOut.row);
    tcGrid.appendChild(kvCacheRead.row);
    tcGrid.appendChild(kvTotal.row);
    tcSec.appendChild(tcLabel);
    tcSec.appendChild(tcGrid);

    // Bottom pill summary
    var footerPill = el('div', 'acm-footer-pill');
    var summaryText = el('span', 'acm-summary-text acm-num', '—');
    var actionFeedback = el('span', 'acm-v-sub', '');
    footerPill.appendChild(summaryText);
    footerPill.appendChild(actionFeedback);

    // Quick actions
    var actionsRow = el('div', 'acm-actions');
    var openBtn = el('button', 'acm-btn is-primary', 'Open Panel');
    openBtn.type = 'button';
    var refreshBtn = el('button', 'acm-btn', 'Refresh');
    refreshBtn.type = 'button';
    actionsRow.appendChild(openBtn);
    actionsRow.appendChild(refreshBtn);

    popover.appendChild(head);
    popover.appendChild(modelRow);
    popover.appendChild(meterWrap);
    popover.appendChild(meterCaption);
    popover.appendChild(perfSec);
    popover.appendChild(cacheSec);
    popover.appendChild(tcSec);
    popover.appendChild(footerPill);
    popover.appendChild(actionsRow);

    shadow.appendChild(trigger);
    shadow.appendChild(popover);

    function openPop() {
      if (state.composerHideTimer) {
        clearTimeout(state.composerHideTimer);
        state.composerHideTimer = null;
      }
      state.composerOpen = true;
      trigger.setAttribute('aria-expanded', 'true');
      positionPopoverNear(trigger, popover, true);
    }

    function scheduleClosePop() {
      if (state.composerPinned) { return; }
      if (state.composerHideTimer) { clearTimeout(state.composerHideTimer); }
      state.composerHideTimer = setTimeout(function() {
        state.composerHideTimer = null;
        if (!state.composerPinned) {
          state.composerOpen = false;
          popover.classList.remove('is-open');
          trigger.setAttribute('aria-expanded', 'false');
        }
      }, 150);
    }

    trigger.addEventListener('mouseenter', openPop);
    trigger.addEventListener('mouseleave', scheduleClosePop);
    popover.addEventListener('mouseenter', function() {
      if (state.composerHideTimer) {
        clearTimeout(state.composerHideTimer);
        state.composerHideTimer = null;
      }
    });
    popover.addEventListener('mouseleave', scheduleClosePop);

    trigger.addEventListener('click', function(ev) {
      ev.stopPropagation();
      state.composerPinned = !state.composerPinned;
      trigger.classList.toggle('is-pinned', state.composerPinned);
      pinBadge.style.display = state.composerPinned ? '' : 'none';
      if (state.composerPinned) {
        openPop();
      } else {
        state.composerOpen = false;
        popover.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    openBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      sendBridgeAction(state.payload, 'openPanel', 'composer', actionFeedback);
    });
    refreshBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      sendBridgeAction(state.payload, 'refresh', 'composer', actionFeedback);
    });

    state.composerHost = host;
    state.composerShadow = shadow;
    state.composerRefs = {
      trigger: trigger,
      arc: arc,
      pctCenter: pctCenter,
      popover: popover,
      titleEl: titleEl,
      pinBadge: pinBadge,
      modelNameEl: modelNameEl,
      pctHeroEl: pctHeroEl,
      meterFill: meterFill,
      tickCompaction: tickCompaction,
      tick200k: tick200k,
      capTokens: capTokens,
      capWatermarks: capWatermarks,
      perfLabel: perfLabel,
      kvSpeed: kvSpeed,
      kvAvgSpeed: kvAvgSpeed,
      kvTtft: kvTtft,
      cacheLabel: cacheLabel,
      kvRecentCh: kvRecentCh,
      kvAvgCh: kvAvgCh,
      kvTurnState: kvTurnState,
      turnBadge: turnBadge,
      tcLabel: tcLabel,
      kvCost: kvCost,
      kvInOut: kvInOut,
      kvCacheRead: kvCacheRead,
      kvTotal: kvTotal,
      summaryText: summaryText,
      actionFeedback: actionFeedback,
      actionsRow: actionsRow,
      openBtn: openBtn,
      refreshBtn: refreshBtn
    };
  }

  function anchorComposerHost() {
    if (!state.composerEnabled) { return; }
    if (!state.composerHost) { createComposerSlot(); }
    if (state.composerHost && state.composerHost.isConnected) { return; }
    var anchor = findComposerAnchor();
    if (!anchor || !anchor.parent) { return; }
    if (anchor.before && anchor.before.parentNode === anchor.parent) {
      anchor.parent.insertBefore(state.composerHost, anchor.before);
    } else {
      anchor.parent.appendChild(state.composerHost);
    }
  }

  function renderComposer() {
    if (!state.composerEnabled || !state.composerRefs || !state.payload) { return; }
    var p = state.payload;
    var r = state.composerRefs;
    var lang = p.language || 'both';
    var pct = clampNum(p.contextPct, 0, 100);
    var rawPct = Number.isFinite(Number(p.contextPct)) ? Math.max(0, Number(p.contextPct)) : 0;

    var offset = RING_CIRC * (1 - pct / 100);
    r.arc.setAttribute('stroke-dashoffset', offset.toFixed(2));
    var severity = rawPct >= 80 ? 'danger' : (rawPct >= 65 ? 'warn' : 'normal');
    r.arc.classList.toggle('is-warn', severity === 'warn');
    r.arc.classList.toggle('is-danger', severity === 'danger');
    r.pctCenter.textContent = String(Math.round(rawPct));
    r.trigger.setAttribute('aria-label', bi(lang, 'Context usage', '上下文用量') + ' ' + Math.round(rawPct) + '%');

    r.titleEl.textContent = bi(lang, 'Usage', '用量');
    r.pinBadge.textContent = bi(lang, 'Pinned', '已固定');
    r.modelNameEl.textContent = p.modelName || bi(lang, 'No active model', '暂无活跃模型');
    r.pctHeroEl.textContent = rawPct.toFixed(1).replace(/\\.0$/, '') + '%';
    r.pctHeroEl.classList.toggle('is-warn', severity === 'warn');
    r.pctHeroEl.classList.toggle('is-danger', severity === 'danger');

    r.meterFill.style.width = pct.toFixed(1) + '%';
    r.meterFill.classList.toggle('is-warn', severity === 'warn');
    r.meterFill.classList.toggle('is-danger', severity === 'danger');

    var marks = [];
    if (typeof p.compactionThresholdPct === 'number' && Number.isFinite(p.compactionThresholdPct) && p.compactionThresholdPct > 2 && p.compactionThresholdPct < 99) {
      r.tickCompaction.style.display = '';
      r.tickCompaction.style.left = clampNum(p.compactionThresholdPct, 2, 98).toFixed(1) + '%';
      r.tickCompaction.setAttribute('title', bi(lang, 'Compaction limit', '压缩阈值') + ' ' + Math.round(p.compactionThresholdPct) + '%');
      marks.push(bi(lang, 'Compact', '压缩') + ' ' + Math.round(p.compactionThresholdPct) + '%');
    } else {
      r.tickCompaction.style.display = 'none';
    }
    if (typeof p.tier200kMarkerPct === 'number' && Number.isFinite(p.tier200kMarkerPct) && p.tier200kMarkerPct > 2 && p.tier200kMarkerPct < 99) {
      r.tick200k.style.display = '';
      r.tick200k.style.left = clampNum(p.tier200kMarkerPct, 2, 98).toFixed(1) + '%';
      r.tick200k.setAttribute('title', bi(lang, '200k pricing tier', '200k 计费阶梯'));
      marks.push('200k');
    } else {
      r.tick200k.style.display = 'none';
    }
    var nativeSuffix = p.contextNativeLimit && p.contextNativeLimit > p.contextEffectiveLimit
      ? (' (' + formatCompact(p.contextNativeLimit) + ' max)')
      : '';
    r.capTokens.textContent = formatCompact(p.contextUsedTokens) + ' / ' + formatCompact(p.contextEffectiveLimit) + nativeSuffix;
    r.capWatermarks.textContent = marks.join(' · ');

    // Performance
    r.perfLabel.textContent = bi(lang, 'Performance', '性能');
    r.kvSpeed.k.textContent = bi(lang, 'Output Speed', '输出速度');
    r.kvAvgSpeed.k.textContent = bi(lang, 'Avg Output Speed', '平均速度');
    r.kvTtft.k.textContent = bi(lang, 'First Token (TTFT)', '首字延迟');

    clearChildren(r.kvSpeed.v);
    if (p.isWaitingTtft) {
      r.kvSpeed.v.appendChild(el('span', 'acm-pill-badge is-warn', bi(lang, 'Waiting', '等待首字')));
    } else if (p.isShortSample) {
      r.kvSpeed.v.appendChild(el('span', 'acm-pill-badge is-warn', bi(lang, 'Short sample', '短样本')));
      if (typeof p.outputSpeedTps === 'number' && Number.isFinite(p.outputSpeedTps) && p.outputSpeedTps > 0) {
        r.kvSpeed.v.appendChild(el('span', 'acm-v-sub', '(' + p.outputSpeedTps.toFixed(1) + ')'));
      }
    } else {
      r.kvSpeed.v.textContent = formatTps(p.outputSpeedTps);
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

    var tcState = p.turnCacheState || 'unknown';
    r.turnBadge.className = 'acm-pill-badge' + (
      tcState === 'warm' ? ' is-good' : (tcState === 'partial' ? ' is-warn' : (tcState === 'cold' ? ' is-danger' : ''))
    );
    r.turnBadge.textContent = tcState === 'warm'
      ? bi(lang, 'Warm', '热缓存')
      : (tcState === 'partial'
        ? bi(lang, 'Partial', '部分命中')
        : (tcState === 'cold' ? bi(lang, 'Cold', '冷启动') : '—'));

    // Tokens & Cost
    r.tcLabel.textContent = bi(lang, 'Tokens & Cost', '用量与费用');
    r.kvCost.k.textContent = bi(lang, 'Est. Cost', '估算费用');
    r.kvInOut.k.textContent = bi(lang, 'Input / Output', '输入 / 输出');
    r.kvCacheRead.k.textContent = bi(lang, 'Cache Read', '缓存读取');
    r.kvTotal.k.textContent = bi(lang, 'Total Tokens', '总 Tokens');

    clearChildren(r.kvCost.v);
    var costStr = formatUsd(p.estCostUsd, p.estCostFormatted);
    r.kvCost.v.appendChild(document.createTextNode(costStr));
    if (p.localCostFormatted) {
      r.kvCost.v.appendChild(el('span', 'acm-v-sub', '≈ ' + p.localCostFormatted));
    }
    r.kvInOut.v.textContent = formatCompact(p.inputTokens) + ' / ' + formatCompact(p.outputTokens);
    r.kvCacheRead.v.textContent = formatCompact(p.cacheReadTokens);
    r.kvTotal.v.textContent = formatCompact(p.totalTokens);

    // Bottom pill summary
    var summaryParts = [];
    if (typeof p.recentCacheHitPct === 'number' && Number.isFinite(p.recentCacheHitPct)) {
      summaryParts.push('CH ' + Math.round(p.recentCacheHitPct) + '%');
    }
    if (p.isShortSample) {
      summaryParts.push(bi(lang, 'Short sample', '短样本'));
    } else if (typeof p.outputSpeedTps === 'number' && Number.isFinite(p.outputSpeedTps) && p.outputSpeedTps > 0) {
      summaryParts.push(p.outputSpeedTps.toFixed(1) + ' tok/s');
    }
    if (costStr !== '—') {
      summaryParts.push(costStr);
    }
    r.summaryText.textContent = summaryParts.length > 0 ? summaryParts.join(' · ') : bi(lang, 'Telemetry active', '监控已就绪');

    r.openBtn.textContent = bi(lang, 'Open Panel', '打开面板');
    r.refreshBtn.textContent = bi(lang, 'Refresh', '刷新');
    var hasBridge = typeof p.bridgeUrl === 'string' && /^http:\\/\\/127\\.0\\.0\\.1:\\d+$/.test(p.bridgeUrl) && Boolean(p.bridgeToken);
    r.actionsRow.style.display = hasBridge ? 'flex' : 'none';
  }

  function makeMiniRing(isAccent) {
    var svg = svgEl('svg', { class: 'acm-mini-ring', viewBox: '0 0 14 14', 'aria-hidden': 'true' });
    var track = svgEl('circle', { class: 'acm-mini-track', cx: '7', cy: '7', r: String(MINI_RADIUS) });
    var arc = svgEl('circle', {
      class: isAccent ? 'acm-mini-arc is-accent' : 'acm-mini-arc',
      cx: '7',
      cy: '7',
      r: String(MINI_RADIUS),
      'stroke-dasharray': MINI_CIRC.toFixed(2),
      'stroke-dashoffset': MINI_CIRC.toFixed(2),
      transform: 'rotate(-90 7 7)'
    });
    svg.appendChild(track);
    svg.appendChild(arc);
    return { svg: svg, arc: arc };
  }

  function createTopBarSlot() {
    var existingNode = document.getElementById(TOPBAR_HOST_ID);
    if (existingNode && existingNode.parentNode) {
      existingNode.parentNode.removeChild(existingNode);
    }

    var host = el('div');
    host.id = TOPBAR_HOST_ID;
    host.setAttribute('data-acm-overlay', 'topbar');
    host.setAttribute('data-theme', detectHostTheme(state.payload && state.payload.theme));

    var shadow = host.attachShadow({ mode: 'open' });
    var styleEl = el('style');
    styleEl.textContent = TOPBAR_CSS;
    shadow.appendChild(styleEl);

    var cluster = el('div', 'acm-bar-cluster');

    // 1. Tightest quota pill
    var quotaPill = el('button', 'acm-bar-pill acm-num');
    quotaPill.type = 'button';
    quotaPill.setAttribute('aria-haspopup', 'dialog');
    quotaPill.setAttribute('aria-expanded', 'false');
    var qRing = makeMiniRing(false);
    var qPctText = el('span', '', '—');
    var qWinTag = el('span', 'acm-bar-tag', '5h');
    quotaPill.appendChild(qRing.svg);
    quotaPill.appendChild(qPctText);
    quotaPill.appendChild(qWinTag);

    // 2. Context ring pill
    var ctxPill = el('button', 'acm-bar-pill acm-num');
    ctxPill.type = 'button';
    var cRing = makeMiniRing(true);
    var cPctText = el('span', '', '0%');
    ctxPill.appendChild(cRing.svg);
    ctxPill.appendChild(cPctText);

    // 3. Speed / short-sample pill
    var speedPill = el('button', 'acm-bar-pill acm-num', '—');
    speedPill.type = 'button';

    // 4. Cumulative recorded tokens pill
    var totalPill = el('button', 'acm-bar-pill acm-num', '0');
    totalPill.type = 'button';

    // 5. Overflow button (···) for narrow windows
    var overflowBtn = el('button', 'acm-bar-pill is-hidden', '···');
    overflowBtn.type = 'button';
    overflowBtn.setAttribute('aria-label', 'More telemetry');
    overflowBtn.setAttribute('aria-expanded', 'false');

    cluster.appendChild(quotaPill);
    cluster.appendChild(ctxPill);
    cluster.appendChild(speedPill);
    cluster.appendChild(totalPill);
    cluster.appendChild(overflowBtn);

    var wcoSpacer = el('div', 'acm-wco-spacer');
    wcoSpacer.setAttribute('aria-hidden', 'true');

    // Overflow mini menu
    var overflowMenu = el('div', 'acm-overflow-menu');
    overflowMenu.setAttribute('role', 'menu');

    // Model Quota Board Popover
    var quotaPopover = el('div', 'acm-quota-popover');
    quotaPopover.setAttribute('role', 'dialog');

    var qpHead = el('div', 'acm-qp-head');
    var qpTitleWrap = el('div');
    var qpTitle = el('div', 'acm-qp-title', 'Model Quota Board / 模型配额面板');
    var qpMeta = el('div', 'acm-qp-meta acm-num', '—');
    qpTitleWrap.appendChild(qpTitle);
    qpTitleWrap.appendChild(qpMeta);

    var qpHeadActions = el('div', 'acm-qp-head-actions');
    var qpRefreshBtn = el('button', 'acm-btn', 'Refresh');
    qpRefreshBtn.type = 'button';
    var qpOpenBtn = el('button', 'acm-btn is-primary', 'Open Panel');
    qpOpenBtn.type = 'button';
    var qpCloseBtn = el('button', 'acm-btn', '×');
    qpCloseBtn.type = 'button';
    qpCloseBtn.setAttribute('aria-label', 'Close');
    qpHeadActions.appendChild(qpRefreshBtn);
    qpHeadActions.appendChild(qpOpenBtn);
    qpHeadActions.appendChild(qpCloseBtn);
    qpHead.appendChild(qpTitleWrap);
    qpHead.appendChild(qpHeadActions);

    var qpSessionSec = el('div', 'acm-qp-section');
    var qpSessionTitle = el('div', 'acm-qp-section-title', 'Current Session Model');
    var qpSessionCard = el('div', 'acm-qp-session-card');
    qpSessionSec.appendChild(qpSessionTitle);
    qpSessionSec.appendChild(qpSessionCard);

    var qpPoolsSec = el('div', 'acm-qp-section');
    var qpPoolsTitle = el('div', 'acm-qp-section-title', 'Shared Quota Pools');
    var qpPoolList = el('div', 'acm-pool-list');
    qpPoolsSec.appendChild(qpPoolsTitle);
    qpPoolsSec.appendChild(qpPoolList);

    var qpFooter = el('div', 'acm-qp-footer acm-num');
    var qpFooterTotal = el('span', '', '');
    var qpFooterFeedback = el('span', '', '');
    qpFooter.appendChild(qpFooterTotal);
    qpFooter.appendChild(qpFooterFeedback);

    quotaPopover.appendChild(qpHead);
    quotaPopover.appendChild(qpSessionSec);
    quotaPopover.appendChild(qpPoolsSec);
    quotaPopover.appendChild(qpFooter);

    shadow.appendChild(cluster);
    shadow.appendChild(wcoSpacer);
    shadow.appendChild(overflowMenu);
    shadow.appendChild(quotaPopover);

    function toggleQuotaBoard(ev) {
      ev.stopPropagation();
      state.overflowOpen = false;
      overflowMenu.classList.remove('is-open');
      overflowBtn.setAttribute('aria-expanded', 'false');
      state.quotaOpen = !state.quotaOpen;
      quotaPill.classList.toggle('is-active', state.quotaOpen);
      quotaPill.setAttribute('aria-expanded', state.quotaOpen ? 'true' : 'false');
      if (state.quotaOpen) {
        positionPopoverNear(quotaPill, quotaPopover, false);
      } else {
        quotaPopover.classList.remove('is-open');
      }
    }

    quotaPill.addEventListener('click', toggleQuotaBoard);
    ctxPill.addEventListener('click', toggleQuotaBoard);
    speedPill.addEventListener('click', toggleQuotaBoard);
    totalPill.addEventListener('click', toggleQuotaBoard);

    overflowBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      state.quotaOpen = false;
      quotaPopover.classList.remove('is-open');
      quotaPill.classList.remove('is-active');
      quotaPill.setAttribute('aria-expanded', 'false');
      state.overflowOpen = !state.overflowOpen;
      overflowBtn.setAttribute('aria-expanded', state.overflowOpen ? 'true' : 'false');
      if (state.overflowOpen) {
        positionPopoverNear(overflowBtn, overflowMenu, false);
      } else {
        overflowMenu.classList.remove('is-open');
      }
    });

    qpCloseBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      state.quotaOpen = false;
      quotaPopover.classList.remove('is-open');
      quotaPill.classList.remove('is-active');
      quotaPill.setAttribute('aria-expanded', 'false');
    });

    qpRefreshBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      sendBridgeAction(state.payload, 'refresh', 'topbar', qpFooterFeedback);
    });
    qpOpenBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      sendBridgeAction(state.payload, 'openPanel', 'topbar', qpFooterFeedback);
    });

    state.topBarHost = host;
    state.topBarShadow = shadow;
    state.topBarRefs = {
      cluster: cluster,
      quotaPill: quotaPill,
      qRing: qRing,
      qPctText: qPctText,
      qWinTag: qWinTag,
      ctxPill: ctxPill,
      cRing: cRing,
      cPctText: cPctText,
      speedPill: speedPill,
      totalPill: totalPill,
      overflowBtn: overflowBtn,
      overflowMenu: overflowMenu,
      wcoSpacer: wcoSpacer,
      quotaPopover: quotaPopover,
      qpTitle: qpTitle,
      qpMeta: qpMeta,
      qpRefreshBtn: qpRefreshBtn,
      qpOpenBtn: qpOpenBtn,
      qpSessionTitle: qpSessionTitle,
      qpSessionCard: qpSessionCard,
      qpPoolsTitle: qpPoolsTitle,
      qpPoolList: qpPoolList,
      qpFooterTotal: qpFooterTotal,
      qpFooterFeedback: qpFooterFeedback
    };
  }

  function applyTopBarResponsiveLayout() {
    if (!state.topBarRefs) { return; }
    var r = state.topBarRefs;
    var vw = window.innerWidth || 1280;
    var hideTotal = vw < 1120;
    var hideSpeed = vw < 860;
    r.totalPill.classList.toggle('is-hidden', hideTotal);
    r.speedPill.classList.toggle('is-hidden', hideSpeed);
    var showOverflow = hideTotal || hideSpeed;
    r.overflowBtn.classList.toggle('is-hidden', !showOverflow);
    if (!showOverflow) {
      state.overflowOpen = false;
      r.overflowMenu.classList.remove('is-open');
    }
    var wcoPx = computeWcoInsetPx(state.topBarAnchorMode === 'fixed');
    if (wcoPx > 0) {
      r.wcoSpacer.style.display = 'block';
      r.wcoSpacer.style.width = wcoPx + 'px';
    } else {
      r.wcoSpacer.style.display = 'none';
      r.wcoSpacer.style.width = '0px';
    }
  }

  function anchorTopBarHost() {
    if (!state.topBarEnabled) { return; }
    if (!state.topBarHost) { createTopBarSlot(); }
    if (state.topBarHost && state.topBarHost.isConnected) {
      applyTopBarResponsiveLayout();
      return;
    }
    var anchor = findTopBarAnchor();
    if (!anchor || !anchor.parent) { return; }
    state.topBarAnchorMode = anchor.mode;
    state.topBarHost.setAttribute('data-anchor', anchor.mode);
    if (anchor.before && anchor.before.parentNode === anchor.parent) {
      anchor.parent.insertBefore(state.topBarHost, anchor.before);
    } else {
      anchor.parent.appendChild(state.topBarHost);
    }
    applyTopBarResponsiveLayout();
  }

  function buildQuotaBarNode(label, pct, resetText) {
    var row = el('div', 'acm-qp-bar-row');
    var meta = el('div', 'acm-qp-bar-meta');
    var left = el('span', 'acm-k', label);
    var rightText = (typeof pct === 'number' && Number.isFinite(pct) ? Math.round(pct) + '%' : '—')
      + (resetText ? (' · ' + resetText) : '');
    var right = el('span', 'acm-v acm-num', rightText);
    meta.appendChild(left);
    meta.appendChild(right);

    var track = el('div', 'acm-qp-track');
    var fill = el('div', 'acm-qp-fill');
    if (typeof pct === 'number' && Number.isFinite(pct)) {
      var clamped = clampNum(pct, 0, 100);
      fill.style.width = clamped.toFixed(1) + '%';
      if (clamped < 20) { fill.classList.add('is-danger'); }
      else if (clamped < 50) { fill.classList.add('is-warn'); }
    } else {
      fill.style.width = '0%';
      fill.classList.add('is-unknown');
    }
    track.appendChild(fill);
    row.appendChild(meta);
    row.appendChild(track);
    return row;
  }

  function updateQuotaMetaClock() {
    if (!state.topBarRefs || !state.payload) { return; }
    var lang = state.payload.language || 'both';
    var parts = [];
    if (state.payload.updatedAt) {
      parts.push(bi(lang, 'Updated', '更新于') + ' ' + state.payload.updatedAt);
    }
    if (typeof state.countdownSec === 'number' && state.countdownSec >= 0) {
      parts.push(bi(lang, 'Next refresh in', '下次刷新') + ' ' + state.countdownSec + 's');
    }
    state.topBarRefs.qpMeta.textContent = parts.join(' · ') || '—';
  }

  function renderTopBar() {
    if (!state.topBarEnabled || !state.topBarRefs || !state.payload) { return; }
    var p = state.payload;
    var r = state.topBarRefs;
    var lang = p.language || 'both';

    // Tightest quota ring
    var qPct = typeof p.tightestQuotaPct === 'number' && Number.isFinite(p.tightestQuotaPct)
      ? clampNum(p.tightestQuotaPct, 0, 100)
      : null;
    if (qPct !== null) {
      r.qRing.arc.setAttribute('stroke-dashoffset', (MINI_CIRC * (1 - qPct / 100)).toFixed(2));
      r.qRing.arc.classList.toggle('is-warn', qPct >= 20 && qPct < 50);
      r.qRing.arc.classList.toggle('is-danger', qPct < 20);
      r.qPctText.textContent = Math.round(qPct) + '%';
    } else {
      r.qRing.arc.setAttribute('stroke-dashoffset', MINI_CIRC.toFixed(2));
      r.qRing.arc.classList.remove('is-warn', 'is-danger');
      r.qPctText.textContent = '—';
    }
    r.qWinTag.textContent = p.tightestQuotaWindowTag || '5h';

    // Context ring
    var cPct = clampNum(p.contextPct, 0, 100);
    r.cRing.arc.setAttribute('stroke-dashoffset', (MINI_CIRC * (1 - cPct / 100)).toFixed(2));
    var cSev = cPct >= 80 ? 'danger' : (cPct >= 65 ? 'warn' : 'normal');
    r.cRing.arc.classList.toggle('is-accent', cSev === 'normal');
    r.cRing.arc.classList.toggle('is-warn', cSev === 'warn');
    r.cRing.arc.classList.toggle('is-danger', cSev === 'danger');
    r.cPctText.textContent = Math.round(cPct) + '%';

    // Speed / short sample pill
    var speedLabel;
    if (p.isWaitingTtft) {
      speedLabel = bi(lang, 'Waiting', '等待首字');
      r.speedPill.classList.add('is-warn');
    } else if (p.isShortSample) {
      speedLabel = bi(lang, 'Short sample', '短样本');
      r.speedPill.classList.add('is-warn');
    } else if (typeof p.outputSpeedTps === 'number' && Number.isFinite(p.outputSpeedTps) && p.outputSpeedTps > 0) {
      speedLabel = p.outputSpeedTps.toFixed(1) + ' tok/s';
      r.speedPill.classList.remove('is-warn');
    } else {
      speedLabel = '— tok/s';
      r.speedPill.classList.remove('is-warn');
    }
    r.speedPill.textContent = speedLabel;

    // Cumulative recorded tokens pill
    var cumStr = formatCompact(p.cumulativeRecordedTokens);
    r.totalPill.textContent = cumStr;

    // Overflow dropdown content
    clearChildren(r.overflowMenu);
    var ovSpeed = el('div', 'acm-overflow-row');
    ovSpeed.appendChild(el('span', '', bi(lang, 'Speed', '生成速度')));
    ovSpeed.appendChild(el('strong', 'acm-num', speedLabel));
    var ovCum = el('div', 'acm-overflow-row');
    ovCum.appendChild(el('span', '', bi(lang, 'Recorded Total', '本机已记录')));
    ovCum.appendChild(el('strong', 'acm-num', cumStr));
    var ovBoardBtn = el('button', 'acm-btn', bi(lang, 'Open Quota Board', '打开配额面板'));
    ovBoardBtn.type = 'button';
    ovBoardBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      state.overflowOpen = false;
      r.overflowMenu.classList.remove('is-open');
      state.quotaOpen = true;
      r.quotaPill.classList.add('is-active');
      positionPopoverNear(r.quotaPill, r.quotaPopover, false);
    });
    r.overflowMenu.appendChild(ovSpeed);
    r.overflowMenu.appendChild(ovCum);
    r.overflowMenu.appendChild(ovBoardBtn);

    // Model Quota Board Popover
    r.qpTitle.textContent = bi(lang, 'Model Quota Board', '模型配额面板');
    r.qpRefreshBtn.textContent = bi(lang, 'Refresh', '刷新');
    r.qpOpenBtn.textContent = bi(lang, 'Open Panel', '打开面板');
    var hasBridge = typeof p.bridgeUrl === 'string' && /^http:\\/\\/127\\.0\\.0\\.1:\\d+$/.test(p.bridgeUrl) && Boolean(p.bridgeToken);
    r.qpRefreshBtn.style.display = hasBridge ? '' : 'none';
    r.qpOpenBtn.style.display = hasBridge ? '' : 'none';

    state.countdownSec = typeof p.nextRefreshSec === 'number' && Number.isFinite(p.nextRefreshSec)
      ? Math.max(0, Math.round(p.nextRefreshSec))
      : null;
    updateQuotaMetaClock();

    // Current session model card
    r.qpSessionTitle.textContent = bi(lang, 'Current Session Model', '当前会话模型');
    clearChildren(r.qpSessionCard);
    var sessTop = el('div', 'acm-qp-session-model');
    sessTop.appendChild(el('span', '', p.modelName || bi(lang, 'No active model', '暂无活跃模型')));
    sessTop.appendChild(el('span', 'acm-pill-badge is-accent acm-num', Math.round(cPct) + '% ' + bi(lang, 'Ctx', '上下文')));
    r.qpSessionCard.appendChild(sessTop);

    var sess5hPct = p.sessionQuota5hPct !== undefined ? p.sessionQuota5hPct : p.tightestQuotaPct;
    r.qpSessionCard.appendChild(buildQuotaBarNode(
      bi(lang, '5h Window', '5 小时窗口'),
      sess5hPct,
      p.sessionQuota5hReset || ''
    ));
    if (p.sessionQuotaWeeklyPct !== undefined && p.sessionQuotaWeeklyPct !== null) {
      r.qpSessionCard.appendChild(buildQuotaBarNode(
        bi(lang, 'Weekly Limit', '每周限额'),
        p.sessionQuotaWeeklyPct,
        p.sessionQuotaWeeklyReset || ''
      ));
    }

    // Shared quota pools
    r.qpPoolsTitle.textContent = bi(lang, 'Shared Quota Pools', '共享配额池');
    clearChildren(r.qpPoolList);
    var pools = Array.isArray(p.quotaPools) ? p.quotaPools : [];
    if (pools.length === 0) {
      r.qpPoolList.appendChild(el('div', 'acm-k', bi(lang, 'Waiting for quota pool telemetry...', '正在等待配额池数据...')));
    } else {
      for (var i = 0; i < pools.length; i++) {
        var pool = pools[i];
        var card = el('div', pool.isCurrentSessionModel ? 'acm-pool-card is-current' : 'acm-pool-card');
        var top = el('div', 'acm-pool-top');
        top.appendChild(el('div', 'acm-pool-name', pool.label || pool.poolKey || 'Pool'));

        var right = el('div', 'acm-pool-right');
        var rem = typeof pool.remainingPct === 'number' && Number.isFinite(pool.remainingPct)
          ? clampNum(pool.remainingPct, 0, 100)
          : null;
        var health = pool.health || (rem === null ? 'unknown' : (rem >= 50 ? 'good' : (rem >= 20 ? 'warn' : 'danger')));
        var healthLabel = health === 'good'
          ? bi(lang, 'Healthy', '充裕')
          : (health === 'warn'
            ? bi(lang, 'Caution', '偏低')
            : (health === 'danger' ? bi(lang, 'Critical', '紧张') : bi(lang, 'Unknown', '未知')));
        var badge = el('span', 'acm-pill-badge' + (health !== 'unknown' ? (' is-' + health) : ''), healthLabel);
        right.appendChild(badge);
        top.appendChild(right);
        card.appendChild(top);

        var resetLabel = (pool.windowTag ? (pool.windowTag + ' · ') : '') + (pool.resetCountdown || '');
        card.appendChild(buildQuotaBarNode(
          rem !== null ? (Math.round(rem) + '% ' + bi(lang, 'remaining', '剩余')) : bi(lang, 'Quota', '配额'),
          rem,
          resetLabel
        ));

        if (Array.isArray(pool.modelChips) && pool.modelChips.length > 0) {
          var chipRow = el('div', 'acm-chip-row');
          for (var c = 0; c < pool.modelChips.length; c++) {
            chipRow.appendChild(el('span', 'acm-model-chip', pool.modelChips[c]));
          }
          card.appendChild(chipRow);
        }
        r.qpPoolList.appendChild(card);
      }
    }

    r.qpFooterTotal.textContent = bi(lang, 'Recorded Total', '本机已记录总量') + ': ' + cumStr;
    applyTopBarResponsiveLayout();
  }

  function onGlobalClick(ev) {
    var path = ev.composedPath ? ev.composedPath() : [];
    if (state.composerOpen && state.composerPinned && state.composerHost && path.indexOf(state.composerHost) < 0) {
      state.composerPinned = false;
      state.composerOpen = false;
      if (state.composerRefs) {
        state.composerRefs.popover.classList.remove('is-open');
        state.composerRefs.trigger.classList.remove('is-pinned');
        state.composerRefs.trigger.setAttribute('aria-expanded', 'false');
        state.composerRefs.pinBadge.style.display = 'none';
      }
    }
    if ((state.quotaOpen || state.overflowOpen) && state.topBarHost && path.indexOf(state.topBarHost) < 0) {
      state.quotaOpen = false;
      state.overflowOpen = false;
      if (state.topBarRefs) {
        state.topBarRefs.quotaPopover.classList.remove('is-open');
        state.topBarRefs.overflowMenu.classList.remove('is-open');
        state.topBarRefs.quotaPill.classList.remove('is-active');
        state.topBarRefs.quotaPill.setAttribute('aria-expanded', 'false');
        state.topBarRefs.overflowBtn.setAttribute('aria-expanded', 'false');
      }
    }
  }

  function onGlobalKeyDown(ev) {
    if (ev.key !== 'Escape') { return; }
    if (state.composerOpen && state.composerRefs) {
      state.composerPinned = false;
      state.composerOpen = false;
      state.composerRefs.popover.classList.remove('is-open');
      state.composerRefs.trigger.classList.remove('is-pinned');
      state.composerRefs.trigger.setAttribute('aria-expanded', 'false');
      state.composerRefs.pinBadge.style.display = 'none';
    }
    if ((state.quotaOpen || state.overflowOpen) && state.topBarRefs) {
      state.quotaOpen = false;
      state.overflowOpen = false;
      state.topBarRefs.quotaPopover.classList.remove('is-open');
      state.topBarRefs.overflowMenu.classList.remove('is-open');
      state.topBarRefs.quotaPill.classList.remove('is-active');
      state.topBarRefs.quotaPill.setAttribute('aria-expanded', 'false');
      state.topBarRefs.overflowBtn.setAttribute('aria-expanded', 'false');
    }
  }

  function onWindowResize() {
    applyTopBarResponsiveLayout();
    if (state.composerOpen && state.composerRefs) {
      positionPopoverNear(state.composerRefs.trigger, state.composerRefs.popover, true);
    }
    if (state.quotaOpen && state.topBarRefs) {
      positionPopoverNear(state.topBarRefs.quotaPill, state.topBarRefs.quotaPopover, false);
    }
  }

  function ensureObserversRunning() {
    if (!state.domObserver && typeof MutationObserver !== 'undefined' && document.body) {
      state.domObserver = new MutationObserver(function() {
        if (state.reanchorTimer) { return; }
        state.reanchorTimer = setTimeout(function() {
          state.reanchorTimer = null;
          if (state.composerEnabled) { anchorComposerHost(); }
          if (state.topBarEnabled) { anchorTopBarHost(); }
        }, 250);
      });
      state.domObserver.observe(document.body, { childList: true, subtree: true });
    }
    if (!state.themeObserver && typeof MutationObserver !== 'undefined' && document.documentElement) {
      state.themeObserver = new MutationObserver(function() { syncThemes(); });
      state.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
      if (document.body) {
        state.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
      }
    }
    if (!state.countdownTimer) {
      state.countdownTimer = setInterval(function() {
        if (state.quotaOpen && typeof state.countdownSec === 'number' && state.countdownSec > 0) {
          state.countdownSec -= 1;
          updateQuotaMetaClock();
        }
      }, 1000);
    }
  }

  function stopObserversIfIdle() {
    if (state.composerEnabled || state.topBarEnabled) { return; }
    if (state.domObserver) { state.domObserver.disconnect(); state.domObserver = null; }
    if (state.themeObserver) { state.themeObserver.disconnect(); state.themeObserver = null; }
    if (state.reanchorTimer) { clearTimeout(state.reanchorTimer); state.reanchorTimer = null; }
    if (state.countdownTimer) { clearInterval(state.countdownTimer); state.countdownTimer = null; }
    if (state.composerHideTimer) { clearTimeout(state.composerHideTimer); state.composerHideTimer = null; }
  }

  function unmountSlot(slot) {
    if (slot === 'composer' || slot === 'all') {
      state.composerEnabled = false;
      state.composerPinned = false;
      state.composerOpen = false;
      if (state.composerHost && state.composerHost.parentNode) {
        state.composerHost.parentNode.removeChild(state.composerHost);
      }
      var strayComposer = document.getElementById(COMPOSER_HOST_ID);
      if (strayComposer && strayComposer.parentNode) {
        strayComposer.parentNode.removeChild(strayComposer);
      }
      state.composerHost = null;
      state.composerShadow = null;
      state.composerRefs = null;
    }
    if (slot === 'topbar' || slot === 'all') {
      state.topBarEnabled = false;
      state.quotaOpen = false;
      state.overflowOpen = false;
      if (state.topBarHost && state.topBarHost.parentNode) {
        state.topBarHost.parentNode.removeChild(state.topBarHost);
      }
      var strayTopBar = document.getElementById(TOPBAR_HOST_ID);
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
      window.removeEventListener('resize', onWindowResize);
      try { delete window[GLOBAL_KEY]; } catch (_e) { window[GLOBAL_KEY] = undefined; }
    }
    return { unmounted: slot };
  }

  document.addEventListener('click', onGlobalClick, true);
  document.addEventListener('keydown', onGlobalKeyDown, true);
  window.addEventListener('resize', onWindowResize);

  window[GLOBAL_KEY] = {
    version: SCRIPT_VERSION,
    applyState: function(payload, toggles) {
      state.payload = payload || state.payload;
      var nextComposer = Boolean(toggles && toggles.appComposerRingEnabled);
      var nextTopBar = Boolean(toggles && toggles.appTopBarEnabled);

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
      syncThemes();
      return {
        ok: true,
        version: SCRIPT_VERSION,
        composerMounted: Boolean(state.composerHost && state.composerHost.isConnected),
        topBarMounted: Boolean(state.topBarHost && state.topBarHost.isConnected)
      };
    },
    unmount: unmountSlot,
    getStatus: function() {
      return {
        version: SCRIPT_VERSION,
        composerEnabled: state.composerEnabled,
        topBarEnabled: state.topBarEnabled,
        composerMounted: Boolean(state.composerHost && state.composerHost.isConnected),
        topBarMounted: Boolean(state.topBarHost && state.topBarHost.isConnected)
      };
    }
  };

  return { installed: true, reused: false, version: SCRIPT_VERSION };
})();`;
}

/**
 * Build the lightweight incremental state-update expression evaluated via CDP `Runtime.evaluate`.
 */
export function buildOverlayUpdateScript(
    payload: CdpOverlayPayload,
    toggles: CdpOverlayToggles,
): string {
    return `(function() {
  var rt = window[${safeJsonForScript(CDP_RUNTIME_GLOBAL_KEY)}];
  if (!rt || typeof rt.applyState !== 'function') { return { ok: false, missingRuntime: true }; }
  return rt.applyState(${safeJsonForScript(payload)}, ${safeJsonForScript({
      appComposerRingEnabled: Boolean(toggles.appComposerRingEnabled),
      appTopBarEnabled: Boolean(toggles.appTopBarEnabled),
  })});
})();`;
}

/**
 * Build the guaranteed-cleanup unmount expression evaluated when toggles turn off or on dispose.
 * Removes Shadow DOM roots even if the runtime global is absent.
 */
export function buildOverlayUnmountScript(
    slot: 'composer' | 'topbar' | 'all' = 'all',
): string {
    return `(function() {
  var slot = ${safeJsonForScript(slot)};
  var rt = window[${safeJsonForScript(CDP_RUNTIME_GLOBAL_KEY)}];
  if (rt && typeof rt.unmount === 'function') {
    try { rt.unmount(slot); } catch (_e) {}
  }
  var ids = slot === 'composer'
    ? [${safeJsonForScript(CDP_COMPOSER_HOST_ID)}]
    : (slot === 'topbar'
      ? [${safeJsonForScript(CDP_TOPBAR_HOST_ID)}]
      : [${safeJsonForScript(CDP_COMPOSER_HOST_ID)}, ${safeJsonForScript(CDP_TOPBAR_HOST_ID)}]);
  for (var i = 0; i < ids.length; i++) {
    var node = document.getElementById(ids[i]);
    if (node && node.parentNode) { node.parentNode.removeChild(node); }
  }
  return { ok: true, unmounted: slot };
})();`;
}

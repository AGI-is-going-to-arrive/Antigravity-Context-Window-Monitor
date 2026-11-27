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

export const CDP_OVERLAY_SCRIPT_VERSION = '1.18.0';
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
  flex-shrink: 0;
  vertical-align: middle;
  margin: 0;
  position: relative;
  -webkit-app-region: no-drag;
}

.acm-ring-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  margin-right: 2px;
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
  inset: auto;
  margin: 0;
  z-index: 2147483600;
  width: min(344px, calc(100vw - 20px));
  max-height: calc(100vh - 24px);
  overflow-y: auto;
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
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
}

.acm-kv {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.acm-k {
  font-size: 11.5px;
  color: var(--acm-ink-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.acm-v {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--acm-ink);
  white-space: nowrap;
  flex-shrink: 0;
  text-align: right;
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
  flex-shrink: 0;
  gap: 5px;
  -webkit-app-region: no-drag;
  position: relative;
}

:host([data-anchor-tier="pane-toolbar"]) {
  margin-right: 4px;
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
  max-width: 100%;
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
  inset: auto;
  margin: 0;
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
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  font-family: var(--acm-sans);
  font-size: 11px;
  color: var(--acm-ink-secondary);
  text-align: left;
  cursor: pointer;
  transition: background 140ms var(--acm-ease), border-color 140ms var(--acm-ease), color 140ms var(--acm-ease);
}

.acm-overflow-row:hover {
  background: var(--acm-hover);
  border-color: var(--acm-border-strong);
  color: var(--acm-ink);
}

.acm-overflow-row:focus-visible {
  outline: 2px solid var(--acm-accent);
  outline-offset: 1px;
}

.acm-overflow-row strong {
  color: var(--acm-ink);
  font-weight: 600;
  white-space: nowrap;
}

.acm-quota-popover {
  position: fixed;
  inset: auto;
  margin: 0;
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

.acm-qp-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 3px;
  margin-top: 10px;
  padding: 3px;
  border-radius: 8px;
  background: var(--acm-well);
  border: 1px solid var(--acm-border);
}

.acm-qp-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 5px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--acm-ink-secondary);
  font-family: var(--acm-sans);
  font-size: 11px;
  font-weight: 550;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 140ms var(--acm-ease), border-color 140ms var(--acm-ease), color 140ms var(--acm-ease);
}

.acm-qp-tab:hover {
  background: var(--acm-hover);
  color: var(--acm-ink);
}

.acm-qp-tab.is-active {
  background: var(--acm-surface-solid);
  border-color: var(--acm-border-strong);
  color: var(--acm-ink);
  font-weight: 650;
}

.acm-qp-tab:focus-visible {
  outline: 2px solid var(--acm-accent);
  outline-offset: 1px;
}

.acm-qp-body {
  display: flex;
  flex-direction: column;
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

.acm-k {
  font-size: 11.5px;
  color: var(--acm-ink-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.acm-v {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--acm-ink);
  white-space: nowrap;
  flex-shrink: 0;
  text-align: right;
}

.acm-v-sub {
  font-size: 10.5px;
  font-weight: 500;
  color: var(--acm-ink-muted);
  margin-left: 4px;
}

.acm-qp-hero-card {
  padding: 11px 12px;
  border-radius: 9px;
  background: var(--acm-well);
  border: 1px solid var(--acm-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.acm-qp-hero-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.acm-qp-hero-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--acm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.acm-qp-hero-metric-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.acm-qp-hero-value {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--acm-ink);
}

.acm-qp-hero-value.is-accent { color: var(--acm-accent); }
.acm-qp-hero-value.is-good { color: var(--acm-good); }
.acm-qp-hero-value.is-warn { color: var(--acm-warn); }
.acm-qp-hero-value.is-danger { color: var(--acm-danger); }

.acm-qp-hero-unit {
  font-size: 11px;
  font-weight: 550;
  color: var(--acm-ink-muted);
  margin-left: 5px;
}

.acm-qp-hero-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 10.5px;
  color: var(--acm-ink-muted);
}

.acm-qp-meter-wrap {
  position: relative;
  height: 7px;
  border-radius: 9999px;
  background: var(--acm-track);
  overflow: visible;
}

.acm-qp-meter-fill {
  height: 100%;
  border-radius: 9999px;
  background: var(--acm-accent);
  transition: width 220ms var(--acm-ease), background 180ms var(--acm-ease);
}

.acm-qp-meter-fill.is-warn { background: var(--acm-warn-fill); }
.acm-qp-meter-fill.is-danger { background: var(--acm-danger-fill); }

.acm-qp-watermark-tick {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  border-radius: 1px;
  transform: translateX(-1px);
  pointer-events: none;
}

.acm-qp-watermark-tick.is-compaction {
  background: var(--acm-warn);
}

.acm-qp-watermark-tick.is-tier200k {
  background: var(--acm-ink-muted);
}

.acm-qp-stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.acm-qp-stat-card {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--acm-well);
  border: 1px solid var(--acm-border);
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.acm-qp-stat-label {
  font-size: 10.5px;
  color: var(--acm-ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.acm-qp-stat-val {
  font-size: 13px;
  font-weight: 650;
  color: var(--acm-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.acm-qp-stat-sub {
  font-size: 10.5px;
  color: var(--acm-ink-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.acm-qp-kv-card {
  padding: 4px 11px;
  border-radius: 9px;
  background: var(--acm-well);
  border: 1px solid var(--acm-border);
  display: flex;
  flex-direction: column;
}

.acm-qp-kv-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid var(--acm-border);
  min-width: 0;
}

.acm-qp-kv-row:last-child {
  border-bottom: none;
}

.acm-qp-roi-row {
  margin-top: 7px;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--acm-accent-tint);
  border: 1px solid var(--acm-accent-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--acm-ink);
}

.acm-qp-roi-label {
  font-weight: 600;
  color: var(--acm-accent);
  white-space: nowrap;
  flex-shrink: 0;
}

.acm-qp-roi-val {
  font-weight: 600;
  color: var(--acm-ink);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

  function pad2(n) {
    return n < 10 ? ('0' + n) : String(n);
  }

  function formatLocalClockTime(raw) {
    if (raw === null || raw === undefined) { return ''; }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      var fromNum = new Date(raw);
      if (!isNaN(fromNum.getTime())) {
        return pad2(fromNum.getHours()) + ':' + pad2(fromNum.getMinutes()) + ':' + pad2(fromNum.getSeconds());
      }
      return '';
    }
    var str = String(raw).trim();
    if (!str) { return ''; }
    var hmsMatch = str.match(/^(\\d{1,2}):(\\d{2}):(\\d{2})$/);
    if (hmsMatch) {
      return pad2(parseInt(hmsMatch[1], 10)) + ':' + hmsMatch[2] + ':' + hmsMatch[3];
    }
    var parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return pad2(parsed.getHours()) + ':' + pad2(parsed.getMinutes()) + ':' + pad2(parsed.getSeconds());
    }
    return str;
  }

  function buildTurnCacheBadge(lang, turnCacheState) {
    var tcState = turnCacheState || 'unknown';
    var cls = 'acm-pill-badge' + (
      tcState === 'warm' ? ' is-good' : (tcState === 'partial' ? ' is-warn' : (tcState === 'cold' ? ' is-danger' : ''))
    );
    var label = tcState === 'warm'
      ? bi(lang, 'Warm', '热缓存')
      : (tcState === 'partial'
        ? bi(lang, 'Partial', '部分命中')
        : (tcState === 'cold' ? bi(lang, 'Cold', '冷启动') : '—'));
    return el('span', cls, label);
  }

  function getTargetTabForTopBarView(view) {
    if (view === 'quota') { return 'models'; }
    if (view === 'context') { return 'overview'; }
    if (view === 'speed') { return 'gm'; }
    if (view === 'total') { return 'cost'; }
    return 'models';
  }

  function detectHostTheme(explicitTheme) {
    if (explicitTheme === 'light' || explicitTheme === 'dark') { return explicitTheme; }
    try {
      var html = document.documentElement;
      var body = document.body;
      var cls = ((html && html.className) || '') + ' ' + ((body && body.className) || '');
      var dataTheme = (html && html.getAttribute('data-theme'))
        || (body && body.getAttribute('data-theme'))
        || (html && html.getAttribute('data-agy-theme'))
        || (body && body.getAttribute('data-agy-theme'))
        || '';
      var combined = (cls + ' ' + dataTheme).toLowerCase();
      var hasLight = /\\b(?:vscode-light|theme-light|light-theme|light)\\b/.test(combined);
      var hasDark = /\\b(?:vscode-dark|theme-dark|dark-theme|dark)\\b/.test(combined);
      if (hasLight && !hasDark) {
        return 'light';
      }
      if (hasDark && !hasLight) {
        return 'dark';
      }
      var colorScheme = String(
        ((html && html.style && html.style.colorScheme) || (body && body.style && body.style.colorScheme) || '')
      ).toLowerCase();
      if (/\\blight\\b/.test(colorScheme) && !/\\bdark\\b/.test(colorScheme)) {
        return 'light';
      }
      if (/\\bdark\\b/.test(colorScheme) && !/\\blight\\b/.test(colorScheme)) {
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

  function isElementVisible(node) {
    if (!node || !node.isConnected) { return false; }
    try {
      var cur = node;
      var depth = 0;
      while (cur && cur !== document.documentElement && depth < 64) {
        if (cur.hidden === true) { return false; }
        if (cur.style && (cur.style.display === 'none' || cur.style.visibility === 'hidden')) {
          return false;
        }
        var cs = null;
        if (typeof window.getComputedStyle === 'function') {
          cs = window.getComputedStyle(cur);
          if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0')) {
            return false;
          }
        }
        if (typeof cur.getBoundingClientRect === 'function') {
          var rect = cur.getBoundingClientRect();
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
    } catch (_e) {}
    return true;
  }

  function isWindowsClient() {
    try {
      var ua = (navigator.userAgent || '') + ' ' + (navigator.platform || '');
      return /win/i.test(ua);
    } catch (_e) {
      return false;
    }
  }

  function isMacClient() {
    try {
      var ua = (navigator.userAgent || '') + ' ' + (navigator.platform || '');
      return /mac|darwin/i.test(ua);
    } catch (_e) {
      return false;
    }
  }

  function getSafeRect(node) {
    if (!node || typeof node.getBoundingClientRect !== 'function') { return null; }
    try {
      var r = node.getBoundingClientRect();
      if (r && typeof r.width === 'number' && typeof r.height === 'number') {
        return r;
      }
    } catch (_e) {}
    return null;
  }

  function getElementChildren(node) {
    var out = [];
    if (!node) { return out; }
    var list = node.childNodes || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].nodeType === 1) { out.push(list[i]); }
    }
    return out;
  }

  function containsNode(container, target) {
    if (!container || !target) { return false; }
    if (typeof container.contains === 'function') {
      try { return Boolean(container.contains(target)); } catch (_e) {}
    }
    var cur = target;
    while (cur) {
      if (cur === container) { return true; }
      cur = cur.parentNode;
    }
    return false;
  }

  function findAncestor(node, predicate) {
    var cur = node;
    while (cur) {
      if (predicate(cur)) { return cur; }
      cur = cur.parentElement || cur.parentNode;
    }
    return null;
  }

  function openTopLayerPopover(popEl) {
    if (!popEl || typeof popEl.showPopover !== 'function') { return false; }
    try {
      var isOpen = false;
      if (typeof popEl.matches === 'function') {
        try { isOpen = popEl.matches(':popover-open'); } catch (_m) {}
      }
      if (!isOpen) {
        popEl.showPopover();
      }
      return true;
    } catch (_e) {
      return false;
    }
  }

  function closeTopLayerPopover(popEl) {
    if (!popEl || typeof popEl.hidePopover !== 'function') { return; }
    try {
      var isOpen = true;
      if (typeof popEl.matches === 'function') {
        try { isOpen = popEl.matches(':popover-open'); } catch (_m) {}
      }
      if (isOpen) {
        popEl.hidePopover();
      }
    } catch (_e) {}
  }

  function findVisibleTopRightWcoReserve() {
    var vw = window.innerWidth || 1280;
    var reserveSel = '[data-testid="window-controls-reserve"], [data-testid="legacy-window-controls-reserve"]';
    try {
      var reserveEls = document.querySelectorAll(reserveSel);
      for (var i = 0; i < reserveEls.length; i++) {
        var elNode = reserveEls[i];
        if (!elNode || !isElementVisible(elNode)) { continue; }
        var resRect = getSafeRect(elNode);
        if (resRect && resRect.top < 48 && resRect.width > 0 && resRect.width < vw * 0.5 && resRect.right >= vw - 60) {
          return { el: elNode, rect: resRect };
        }
      }
    } catch (_e) {}
    return null;
  }

  function computeWcoInsetPx(isFixedAnchor) {
    if (!isFixedAnchor) {
      return 0;
    }
    var vw = window.innerWidth || 1280;
    var visibleReserve = findVisibleTopRightWcoReserve();
    if (visibleReserve) {
      return Math.round(visibleReserve.rect.width) + 8;
    }
    try {
      if (navigator.windowControlsOverlay && navigator.windowControlsOverlay.visible) {
        var rect = navigator.windowControlsOverlay.getTitlebarAreaRect();
        if (rect && typeof rect.right === 'number' && Number.isFinite(rect.right) && rect.right > 0) {
          var rightGap = Math.max(0, Math.round(vw - rect.right));
          if (rightGap === 0) {
            return 0;
          }
          if (rightGap > 0 && rightGap < vw * 0.5) {
            return rightGap + 8;
          }
        }
      }
    } catch (_e) {}
    if (isWindowsClient()) {
      return 138;
    }
    return 0;
  }

  function hasLoopbackBridge(payload) {
    return Boolean(
      payload
      && typeof payload.bridgeUrl === 'string'
      && /^http:\\/\\/127\\.0\\.0\\.1:\\d+$/.test(payload.bridgeUrl)
      && typeof payload.bridgeToken === 'string'
      && payload.bridgeToken
    );
  }

  function sendBridgeAction(payload, command, source, feedbackEl, extra) {
    if (!hasLoopbackBridge(payload)) {
      return;
    }
    try {
      var bodyObj = { command: command, source: source };
      if (extra && typeof extra === 'object') {
        var extraKeys = Object.keys(extra);
        for (var i = 0; i < extraKeys.length; i++) {
          var k = extraKeys[i];
          if (extra[k] !== undefined && extra[k] !== null) {
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
          'X-Monitor-Token': payload.bridgeToken
        },
        body: JSON.stringify(bodyObj)
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

  function triggerOpenPanelAction(payload, source, feedbackEl, targetTab) {
    var toggledHostSidebar = false;
    try {
      var auxBtn = document.querySelector('[data-testid="toggle-aux-sidebar"]');
      if (auxBtn && auxBtn.getAttribute('aria-expanded') === 'false' && typeof auxBtn.click === 'function') {
        auxBtn.click();
        toggledHostSidebar = true;
      }
    } catch (_e) {}
    if (hasLoopbackBridge(payload)) {
      sendBridgeAction(payload, 'openPanel', source, feedbackEl, targetTab ? { targetTab: targetTab } : undefined);
    } else if (toggledHostSidebar && feedbackEl) {
      feedbackEl.textContent = bi((payload && payload.language) || 'both', 'Opened', '已打开');
    }
  }

  function clearChildren(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function normalizePermButtonLabel(text) {
    return String(text || '')
      .replace(/keyboard_arrow_(?:down|up)|expand_(?:more|less)|arrow_drop_down/gi, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  function findLastElementChild(parent) {
    if (!parent) { return null; }
    if (parent.lastElementChild) { return parent.lastElementChild; }
    var nodes = parent.childNodes || [];
    for (var k = nodes.length - 1; k >= 0; k--) {
      if (nodes[k] && nodes[k].nodeType === 1) { return nodes[k]; }
    }
    return null;
  }

  function isInsideUnfocusedPane(node) {
    return Boolean(findAncestor(node, function(cur) {
      if (!cur || typeof cur.getAttribute !== 'function') { return false; }
      var val = cur.getAttribute('data-pane-unfocused');
      return val !== null && val !== 'false';
    }));
  }

  function isMetadataBar(node) {
    if (!node || typeof node.getAttribute !== 'function') { return false; }
    var tid = node.getAttribute('data-testid') || '';
    var hasPerm = Boolean(node.querySelector && node.querySelector('[data-testid="permissions-selector-trigger"]'));
    if (hasPerm) { return false; }
    if (tid === 'input-box-bottom-toolbar') { return true; }
    if (node.querySelector && node.querySelector('.surface-composer-card, .agy-composer-footer, [data-agent-composer-root], [contenteditable="true"]')) {
      return false;
    }
    if (node.querySelector && node.querySelector('[data-testid="location-selector-trigger"], [data-testid="project-selector-trigger"]')) {
      return true;
    }
    return false;
  }

  function isInsideMetadataBar(node) {
    return Boolean(findAncestor(node, function(cur) {
      if (!cur || cur === document.body || cur === document.documentElement) { return false; }
      return isMetadataBar(cur);
    }));
  }

  function orderByFocusAndVisibility(nodes, requireVisible) {
    var focusedVisible = [];
    var unfocusedVisible = [];
    var hidden = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
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

  function resolveComposerActionAnchor(footer, actionBtn) {
    if (!actionBtn) { return null; }
    var firstGroup = footer ? footer.firstElementChild : null;
    var rightGroup = footer ? findLastElementChild(footer) : null;
    if (rightGroup && rightGroup !== firstGroup && containsNode(rightGroup, actionBtn)) {
      var cur = actionBtn;
      while (cur && cur.parentElement && cur.parentElement !== rightGroup) {
        cur = cur.parentElement;
      }
      if (cur && cur.parentElement === rightGroup) {
        return { parent: rightGroup, before: cur, mode: 'inline' };
      }
    }
    var target = actionBtn;
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

  function findComposerAnchorInPass(requireVisible) {
    var permRe = /^(?:request\\s*review|default|auto|turbo|ask|plan|planning|fast|agent|chat|edit|请求审核|审核|默认|自动|极速|询问|计划)$/i;
    var permAriaRe = /permissions?\\s*preset|approval\\s*(?:mode|policy)|权限预设|审批模式/i;
    var actionBtnSel = '[data-testid="voice-start-button"], [data-testid="send-button"], [data-testid="send-button-loading"], [data-testid="send-button-pending"], [data-testid="input-cancel-button"], [data-tooltip-id="input-send-button-record-tooltip"], .agy-send-button';

    // Tier 1: Direct permissions selector trigger anywhere (immune to i18n, preset rename, <400px icon-only mode)
    var directTriggers = orderByFocusAndVisibility(
      document.querySelectorAll('[data-testid="permissions-selector-trigger"]'),
      requireVisible
    );
    for (var ti = 0; ti < directTriggers.length; ti++) {
      var trig = directTriggers[ti];
      if (trig && trig.parentElement && !isMetadataBar(trig.parentElement)) {
        return { parent: trig.parentElement, before: trig, mode: 'inline' };
      }
    }

    // Tier 2: True composer action footers ONLY (explicitly excluding legacy metadata bar input-box-bottom-toolbar)
    var rawFooters = document.querySelectorAll('.agy-composer-footer, [data-agent-composer-root], [data-testid="composer-footer"], [class*="composer-footer"]');
    var candidateFooters = [];
    var orderedFooters = orderByFocusAndVisibility(rawFooters, requireVisible);
    for (var fi = 0; fi < orderedFooters.length; fi++) {
      if (!isMetadataBar(orderedFooters[fi]) && !isInsideMetadataBar(orderedFooters[fi])) {
        candidateFooters.push(orderedFooters[fi]);
      }
    }

    // Tier 2a: Approval/permission button across all candidate footers globally before falling back
    for (var i = 0; i < candidateFooters.length; i++) {
      var footer = candidateFooters[i];
      var buttons = footer.querySelectorAll ? footer.querySelectorAll('button, [role="button"]') : [];
      for (var j = 0; j < buttons.length; j++) {
        var btn = buttons[j];
        if (requireVisible && !isElementVisible(btn)) { continue; }
        var tid = (btn.getAttribute('data-testid') || '').toLowerCase();
        if (tid === 'location-selector-trigger' || tid === 'project-selector-trigger' || tid === 'model-selector-trigger') {
          continue;
        }
        var aria = btn.getAttribute('aria-label') || '';
        var label = normalizePermButtonLabel(btn.textContent);
        var isModeTid = tid.indexOf('permission') >= 0 || tid.indexOf('approval') >= 0 || (tid.indexOf('mode') >= 0 && tid.indexOf('model') < 0);
        if ((permAriaRe.test(aria) || isModeTid || permRe.test(label)) && btn.parentElement && !isInsideMetadataBar(btn)) {
          return { parent: btn.parentElement, before: btn, mode: 'inline' };
        }
      }
    }

    // Tier 2b: Action button (mic / voice / send / cancel / loading / pending) inside a true footer -> walk up to direct child of rightGroup
    for (var ai = 0; ai < candidateFooters.length; ai++) {
      var aFooter = candidateFooters[ai];
      var actionBtns = aFooter.querySelectorAll ? orderByFocusAndVisibility(aFooter.querySelectorAll(actionBtnSel), requireVisible) : [];
      for (var aj = 0; aj < actionBtns.length; aj++) {
        var resolved = resolveComposerActionAnchor(aFooter, actionBtns[aj]);
        if (resolved) { return resolved; }
      }
    }

    // Tier 2c: Distinct right-hand group inside a true footer
    for (var ri = 0; ri < candidateFooters.length; ri++) {
      var rFooter = candidateFooters[ri];
      var rightGroup = findLastElementChild(rFooter);
      var firstGroup = rFooter.firstElementChild;
      if (rightGroup && rightGroup !== firstGroup) {
        return { parent: rightGroup, before: rightGroup.firstChild, mode: 'inline' };
      }
    }

    // Tier 2d: Single-group non-metadata footer fallback
    for (var si = 0; si < candidateFooters.length; si++) {
      var sFooter = candidateFooters[si];
      var sFirst = sFooter.firstElementChild;
      if (sFirst) {
        return { parent: sFirst, before: sFirst.firstChild, mode: 'inline' };
      }
      return { parent: sFooter, before: sFooter.firstChild, mode: 'inline' };
    }

    // Tier 3: Last-resort global action button inside composer card/box, strictly outside metadata bar
    var cards = orderByFocusAndVisibility(
      document.querySelectorAll('.surface-composer-card, [data-testid="agent-input-box"]'),
      requireVisible
    );
    for (var ci = 0; ci < cards.length; ci++) {
      var card = cards[ci];
      var cardBtns = card.querySelectorAll ? orderByFocusAndVisibility(card.querySelectorAll(actionBtnSel), requireVisible) : [];
      for (var cj = 0; cj < cardBtns.length; cj++) {
        if (isInsideMetadataBar(cardBtns[cj])) { continue; }
        var cardFooter = findAncestor(cardBtns[cj], function(cur) {
          if (!cur || cur === card || cur === document.body) { return false; }
          var cFirst = cur.firstElementChild;
          var cLast = findLastElementChild(cur);
          return Boolean(cFirst && cLast && cFirst !== cLast && containsNode(cLast, cardBtns[cj]));
        });
        var cardAnchor = resolveComposerActionAnchor(cardFooter, cardBtns[cj]);
        if (cardAnchor) { return cardAnchor; }
      }
    }

    return null;
  }

  function findComposerAnchor() {
    return findComposerAnchorInPass(true) || findComposerAnchorInPass(false);
  }

  function parsePxValue(raw) {
    if (typeof raw !== 'string') { return 0; }
    var m = raw.trim().match(/^(-?[\\d.]+)px$/i);
    if (!m) { return 0; }
    var n = parseFloat(m[1]);
    return Number.isFinite(n) ? n : 0;
  }

  function getOpenSidebarRightPx() {
    var vw = window.innerWidth || 1280;
    try {
      var sheet = document.querySelector('.agy-sheet');
      if (sheet && sheet.getAttribute('data-sidebar-closed') === 'true') {
        return 0;
      }
      var toggleBtn = document.querySelector('[data-testid="sidebar-toggle"]');
      var toggleExpanded = toggleBtn ? toggleBtn.getAttribute('aria-expanded') : null;
      if (toggleExpanded === 'false') {
        return 0;
      }
      var split = document.querySelector('[data-testid="sidebar-split"]');
      var sidebarEl = split ? split.firstElementChild : null;
      if (sidebarEl) {
        var visible = isElementVisible(sidebarEl);
        var rect = getSafeRect(sidebarEl);
        var measuredRight = (visible && rect && rect.width > 20) ? rect.right : 0;
        var targetWidth = (toggleExpanded === 'true' && sidebarEl.style && sidebarEl.style.visibility !== 'hidden')
          ? parsePxValue(sidebarEl.style.width)
          : 0;
        var best = Math.max(measuredRight, targetWidth > 20 ? targetWidth : 0);
        if (best > 20) {
          return Math.min(Math.round(best), Math.round(vw * 0.6));
        }
      }
    } catch (_e) {}
    return 0;
  }

  function getLeftChromeRightPx() {
    var vw = window.innerWidth || 1280;
    var maxRight = 0;
    try {
      var controls = document.querySelectorAll('[data-testid="sidebar-toggle"], [data-testid="sidebar-search-button"]');
      for (var i = 0; i < controls.length; i++) {
        var ctrl = controls[i];
        if (!isElementVisible(ctrl)) { continue; }
        var rect = getSafeRect(ctrl);
        if (rect && rect.top < 48 && rect.right > 0 && rect.right < vw * 0.65) {
          if (rect.right > maxRight) { maxRight = Math.round(rect.right); }
        }
        var cur = ctrl.parentElement;
        for (var depth = 0; cur && depth < 3; depth++) {
          var cls = String(cur.className || '');
          var isLeftOverlay = cls.indexOf('left-0') >= 0 && (cls.indexOf('absolute') >= 0 || cls.indexOf('z-50') >= 0);
          if (isLeftOverlay) {
            var ovRect = getSafeRect(cur);
            if (ovRect && ovRect.top < 48 && ovRect.left <= 4 && ovRect.right > 0 && ovRect.right < vw * 0.65) {
              if (ovRect.right > maxRight) { maxRight = Math.round(ovRect.right); }
            }
            break;
          }
          cur = cur.parentElement;
        }
      }
      if (navigator.windowControlsOverlay && navigator.windowControlsOverlay.visible) {
        var wcoRect = navigator.windowControlsOverlay.getTitlebarAreaRect();
        if (wcoRect && typeof wcoRect.left === 'number' && wcoRect.left > maxRight && wcoRect.left < vw * 0.5) {
          maxRight = Math.round(wcoRect.left);
        }
      }
    } catch (_e) {}
    if (maxRight === 0 && state.topBarAnchorMode === 'fixed' && isMacClient()) {
      return 88;
    }
    return maxRight;
  }

  function getRightPaddingAndBorderPx(node) {
    if (!node) { return 0; }
    var pad = 0;
    var border = 0;
    var hasCsPad = false;
    var hasCsBorder = false;
    try {
      if (typeof window.getComputedStyle === 'function') {
        var cs = window.getComputedStyle(node);
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
    } catch (_e) {}
    if (!hasCsPad && node.style && typeof node.style.paddingRight === 'string') {
      pad = parsePxValue(node.style.paddingRight);
    }
    if (!hasCsBorder && node.style && typeof node.style.borderRightWidth === 'string') {
      border = parsePxValue(node.style.borderRightWidth);
    }
    return Math.max(0, pad) + Math.max(0, border);
  }

  function getFollowingSiblingsMinLeftPx(host) {
    if (!host || !host.parentElement) { return Infinity; }
    var minLeft = Infinity;
    var sib = host.nextSibling;
    while (sib) {
      if (sib.nodeType === 1 && sib !== host && sib.id !== TOPBAR_HOST_ID && isElementVisible(sib)) {
        var sr = getSafeRect(sib);
        if (sr && sr.top < 96 && sr.width > 0 && sr.left > 0 && sr.left < minLeft) {
          minLeft = Math.round(sr.left);
        }
      }
      sib = sib.nextSibling;
    }
    return minLeft;
  }

  function getRightChromeLeftPx() {
    var vw = window.innerWidth || 1280;
    var isFixed = state.topBarAnchorMode === 'fixed';
    if (!isFixed) {
      var sibMinLeft = getFollowingSiblingsMinLeftPx(state.topBarHost);
      if (sibMinLeft < Infinity) {
        return Math.max(0, sibMinLeft);
      }
    }
    var minLeft = isFixed ? (vw - 10 - computeWcoInsetPx(true)) : (vw - 10);
    var maxTop = isFixed ? 48 : 96;
    try {
      var rightCtrls = document.querySelectorAll(
        '[data-testid="toggle-maximize-pane"], [data-testid="toggle-aux-sidebar"], [data-testid="window-controls-reserve"], [data-testid="legacy-window-controls-reserve"]'
      );
      for (var i = 0; i < rightCtrls.length; i++) {
        var c = rightCtrls[i];
        if (!c || c === state.topBarHost || c.id === TOPBAR_HOST_ID || !isElementVisible(c)) { continue; }
        var r = getSafeRect(c);
        if (r && r.top < maxTop && r.width > 0 && r.left > 0 && r.left < minLeft) {
          minLeft = Math.round(r.left);
        }
      }
    } catch (_e) {}
    return Math.max(0, minLeft);
  }

  function measureNativeToolbarButtonsWidth(toolbar, excludeHost) {
    if (!toolbar) { return 0; }
    var children = getElementChildren(toolbar);
    var minL = Infinity;
    var maxR = 0;
    var sumW = 0;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (!child || child === excludeHost || child.id === TOPBAR_HOST_ID) { continue; }
      if (!isElementVisible(child)) { continue; }
      var r = getSafeRect(child);
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

  function isRevealOnHoverElement(node) {
    if (!node || typeof node.getAttribute !== 'function') { return false; }
    var val = node.getAttribute('data-reveal-on-hover');
    return val !== null && val !== 'false';
  }

  function hasVisibleNativeChildren(container, excludeHost) {
    var children = getElementChildren(container);
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (!child || child === excludeHost || child.id === TOPBAR_HOST_ID) { continue; }
      if (isElementVisible(child)) {
        return true;
      }
    }
    return false;
  }

  function doesEmptyToolbarOverlapRightWco(tb, tbRect) {
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
      var wco = navigator.windowControlsOverlay;
      if (!wco || !wco.visible || typeof wco.getTitlebarAreaRect !== 'function') {
        return false;
      }
      var wcoRect = wco.getTitlebarAreaRect();
      if (!wcoRect || typeof wcoRect.right !== 'number' || !Number.isFinite(wcoRect.right) || wcoRect.right <= 0) {
        return false;
      }
      var vw = window.innerWidth || 1280;
      var rightGap = Math.max(0, Math.round(vw - wcoRect.right));
      if (rightGap <= 0 || rightGap >= vw * 0.5) {
        return false;
      }
      var wcoTop = (typeof wcoRect.top === 'number' && Number.isFinite(wcoRect.top)) ? wcoRect.top : 0;
      var wcoBottom = (typeof wcoRect.bottom === 'number' && Number.isFinite(wcoRect.bottom))
        ? wcoRect.bottom
        : (wcoTop + ((typeof wcoRect.height === 'number' && Number.isFinite(wcoRect.height) && wcoRect.height > 0) ? wcoRect.height : 32));
      if (!(tbRect.top < wcoBottom && tbRect.bottom > wcoTop)) {
        return false;
      }
      var tbContentRight = tbRect.right - getRightPaddingAndBorderPx(tb);
      return tbContentRight > wcoRect.right;
    } catch (_e) {
      return false;
    }
  }

  function findTopBarAnchor() {
    var vw = window.innerWidth || 1280;

    // Tier 1: Primary Antigravity right chrome overlay (outside agy-sheet, z:50, auto-updates --right-cluster-width)
    var auxBtns = document.querySelectorAll('[data-testid="toggle-aux-sidebar"]');
    var auxBtn = null;
    for (var ai = 0; ai < auxBtns.length; ai++) {
      if (isElementVisible(auxBtns[ai]) && auxBtns[ai].parentElement) {
        auxBtn = auxBtns[ai];
        break;
      }
    }
    if (auxBtn && auxBtn.parentElement) {
      var parent = auxBtn.parentElement;
      var maxBtn = parent.querySelector ? parent.querySelector('[data-testid="toggle-maximize-pane"]') : null;
      if (maxBtn && maxBtn.parentElement === parent && isElementVisible(maxBtn)) {
        return { parent: parent, before: maxBtn, mode: 'inline', tier: 'right-overlay' };
      }
      return { parent: parent, before: auxBtn, mode: 'inline', tier: 'right-overlay' };
    }

    // Tier 2: Windows/Linux non-conversation screens with top-right window-controls-reserve inside right overlay
    var wcoEls = document.querySelectorAll('[data-testid="window-controls-reserve"]');
    for (var wi = 0; wi < wcoEls.length; wi++) {
      var wco = wcoEls[wi];
      if (!wco || !wco.parentElement || wco.parentElement === document.body || wco.parentElement === document.documentElement) {
        continue;
      }
      if (!isElementVisible(wco)) { continue; }
      var wcoRect = getSafeRect(wco);
      if (!wcoRect || (wcoRect.top < 48 && wcoRect.right >= vw - 60)) {
        return { parent: wco.parentElement, before: wco, mode: 'inline', tier: 'right-overlay' };
      }
    }

    // Tier 3: Standalone right-aligned pane toolbar (NEVER comma-joined with parent @container/titlebar!)
    var paneToolbars = document.querySelectorAll('[data-testid="pane-titlebar-toolbar"]');
    var leftChromeRight = getLeftChromeRightPx();
    for (var pi = 0; pi < paneToolbars.length; pi++) {
      var tb = paneToolbars[pi];
      if (!tb || !isElementVisible(tb)) { continue; }
      if (isRevealOnHoverElement(tb)) { continue; }
      if (isInsideUnfocusedPane(tb)) { continue; }
      var tbRect = getSafeRect(tb);
      if (leftChromeRight > 0 && tbRect && tbRect.right > 0 && tbRect.right < leftChromeRight + 100) {
        continue;
      }
      if (doesEmptyToolbarOverlapRightWco(tb, tbRect)) {
        continue;
      }
      return { parent: tb, before: tb.firstChild, mode: 'inline', tier: 'pane-toolbar' };
    }

    // Tier 4: Fixed top-right fallback (e.g. macOS Home / New Conversation / Plugins Settings)
    if (document.body) {
      return { parent: document.body, before: null, mode: 'fixed', tier: 'fixed' };
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
    topBarAnchorTier: 'right-overlay',
    topBarActiveView: null,
    overflowOpen: false,
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
    boundWcoTarget: null
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
    var margin = 10;

    popEl.style.visibility = 'hidden';
    popEl.style.left = '0px';
    popEl.style.top = '0px';
    popEl.classList.add('is-open');
    openTopLayerPopover(popEl);

    var measuredRect = getSafeRect(popEl);
    var pw = popEl.offsetWidth || (measuredRect && measuredRect.width ? Math.round(measuredRect.width) : 0) || 340;
    var ph = popEl.offsetHeight || (measuredRect && measuredRect.height ? Math.round(measuredRect.height) : 0) || 260;

    var sidebarRight = getOpenSidebarRightPx();
    var safeLeft = (sidebarRight > 0 && (vw - sidebarRight - margin - 8) >= pw)
      ? Math.round(sidebarRight + 8)
      : margin;
    var maxLeft = Math.max(safeLeft, vw - pw - margin);

    var left = Math.round(rect.right - pw);
    if (left < safeLeft) { left = Math.round(rect.left); }
    if (left + pw > vw - margin) { left = vw - pw - margin; }
    if (left < safeLeft) { left = safeLeft; }
    left = Math.max(margin, Math.min(left, Math.max(margin, Math.min(maxLeft, vw - pw - margin))));

    var top;
    if (preferAbove) {
      top = Math.round(rect.top - ph - 8);
      if (top < margin) {
        var belowTop = Math.round(rect.bottom + 8);
        top = (belowTop + ph <= vh - margin)
          ? belowTop
          : Math.max(margin, Math.min(belowTop, vh - ph - margin));
      }
    } else {
      top = Math.round(rect.bottom + 8);
      if (top + ph > vh - margin) {
        var aboveTop = Math.round(rect.top - ph - 8);
        top = (aboveTop >= margin)
          ? aboveTop
          : Math.max(margin, vh - ph - margin);
      }
    }
    popEl.style.left = Math.max(margin, left) + 'px';
    popEl.style.top = Math.max(margin, top) + 'px';
    popEl.style.visibility = '';
  }

  function closeComposerPopover(clearPin) {
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

  function createComposerSlot() {
    var existingNode = document.getElementById(COMPOSER_HOST_ID);
    if (existingNode && existingNode.parentNode) {
      existingNode.parentNode.removeChild(existingNode);
    }

    var host = el('div');
    host.id = COMPOSER_HOST_ID;
    host.setAttribute('data-acm-overlay', 'composer');
    host.setAttribute('data-no-drag', '');
    host.setAttribute('data-theme', detectHostTheme(state.payload && state.payload.theme));
    host.style.flexShrink = '0';

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
    popover.setAttribute('popover', 'manual');

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
    function makeKv(labelText) {
      var row = el('div', 'acm-kv');
      var k = el('span', 'acm-k', labelText);
      var v = el('span', 'acm-v acm-num', '—');
      row.appendChild(k);
      row.appendChild(v);
      return { row: row, k: k, v: v };
    }
    var kvSpeed = makeKv('Output Speed');
    var kvAvgSpeed = makeKv('Avg Speed');
    var kvTtft = makeKv('First Token');
    perfGrid.appendChild(kvSpeed.row);
    perfGrid.appendChild(kvAvgSpeed.row);
    perfGrid.appendChild(kvTtft.row);
    perfSec.appendChild(perfLabel);
    perfSec.appendChild(perfGrid);

    // Cache section
    var cacheSec = el('div', 'acm-section');
    var cacheLabel = el('div', 'acm-section-label', 'Cache / 缓存');
    var cacheGrid = el('div', 'acm-kv-grid');
    var kvRecentCh = makeKv('Recent CH');
    var kvAvgCh = makeKv('Avg CH');
    var kvTurnState = makeKv('Turn Cache');
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
    var kvCost = makeKv('Est. Cost');
    var kvInOut = makeKv('Input / Output');
    var kvCacheRead = makeKv('Cache Read');
    var kvTotal = makeKv('Total Tokens');
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
          closeComposerPopover(false);
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
        closeComposerPopover(false);
      }
    });

    openBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      triggerOpenPanelAction(state.payload, 'composer', actionFeedback);
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
    var anchor = findComposerAnchor();
    if (!anchor || !anchor.parent) {
      if (state.composerHost && state.composerHost.parentNode && isInsideMetadataBar(state.composerHost)) {
        closeComposerPopover(true);
        state.composerHost.parentNode.removeChild(state.composerHost);
      }
      return;
    }
    var anchorBefore = anchor.before === state.composerHost ? state.composerHost.nextSibling : anchor.before;
    var alreadyPlaced = state.composerHost.parentNode === anchor.parent
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
    var hasBridge = hasLoopbackBridge(p);
    var canOpenDirectly = Boolean(document.querySelector('[data-testid="toggle-aux-sidebar"]'));
    r.openBtn.style.display = (hasBridge || canOpenDirectly) ? '' : 'none';
    r.refreshBtn.style.display = hasBridge ? '' : 'none';
    r.actionsRow.style.display = (hasBridge || canOpenDirectly) ? 'flex' : 'none';
    if (state.composerOpen) {
      positionPopoverNear(r.trigger, r.popover, true);
    }
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

  var TOPBAR_VIEWS = ['quota', 'context', 'speed', 'total'];

  function normalizeTopBarView(view) {
    if (view === 'quota' || view === 'context' || view === 'speed' || view === 'total') {
      return view;
    }
    return 'quota';
  }

  function getTopBarPillForView(view) {
    if (!state.topBarRefs) { return null; }
    var r = state.topBarRefs;
    if (view === 'context') { return r.ctxPill; }
    if (view === 'speed') { return r.speedPill; }
    if (view === 'total') { return r.totalPill; }
    return r.quotaPill;
  }

  function resolveTopBarAnchor(view, explicitAnchor) {
    if (!state.topBarRefs) { return explicitAnchor || null; }
    var r = state.topBarRefs;
    if (r.cluster && state.topBarHost && state.topBarHost.isConnected) {
      var cRect = getSafeRect(r.cluster);
      if (cRect && cRect.width > 0 && cRect.height > 0) {
        return r.cluster;
      }
    }
    if (explicitAnchor && !explicitAnchor.classList.contains('is-hidden')) {
      return explicitAnchor;
    }
    var pill = getTopBarPillForView(view);
    if (pill && !pill.classList.contains('is-hidden')) {
      return pill;
    }
    if (r.overflowBtn && !r.overflowBtn.classList.contains('is-hidden')) {
      return r.overflowBtn;
    }
    return r.cluster || r.quotaPill;
  }

  function syncTopBarPillStates() {
    if (!state.topBarRefs) { return; }
    var r = state.topBarRefs;
    var active = state.topBarActiveView;
    var tabActive = active || 'quota';
    for (var i = 0; i < TOPBAR_VIEWS.length; i++) {
      var v = TOPBAR_VIEWS[i];
      var pill = getTopBarPillForView(v);
      var isPillActive = active === v;
      if (pill) {
        pill.classList.toggle('is-active', isPillActive);
        pill.setAttribute('aria-expanded', isPillActive ? 'true' : 'false');
      }
      var tabBtn = r.qpTabs && r.qpTabs[v];
      if (tabBtn) {
        var isTabActive = tabActive === v;
        tabBtn.classList.toggle('is-active', isTabActive);
        tabBtn.setAttribute('aria-selected', isTabActive ? 'true' : 'false');
      }
    }
  }

  function closeOverflowMenu() {
    state.overflowOpen = false;
    if (state.topBarRefs) {
      state.topBarRefs.overflowMenu.classList.remove('is-open');
      closeTopLayerPopover(state.topBarRefs.overflowMenu);
      state.topBarRefs.overflowBtn.setAttribute('aria-expanded', 'false');
    }
  }

  function closeTopBarPopover() {
    state.topBarActiveView = null;
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

  function openTopBarView(view, anchorPill) {
    if (!state.topBarRefs) { return; }
    var nextView = normalizeTopBarView(view);
    closeOverflowMenu();
    state.topBarActiveView = nextView;
    state.topBarRefs.quotaPopover.setAttribute('data-active-view', nextView);
    state.topBarRefs.qpFooterFeedback.textContent = '';
    syncTopBarPillStates();
    renderTopBarPopover();
    var targetAnchor = resolveTopBarAnchor(nextView, anchorPill);
    positionPopoverNear(targetAnchor, state.topBarRefs.quotaPopover, false);
  }

  function toggleTopBarView(view, anchorPill) {
    var nextView = normalizeTopBarView(view);
    if (state.topBarActiveView === nextView) {
      closeTopBarPopover();
      return;
    }
    openTopBarView(nextView, anchorPill);
  }

  function createTopBarSlot() {
    var existingNode = document.getElementById(TOPBAR_HOST_ID);
    if (existingNode && existingNode.parentNode) {
      existingNode.parentNode.removeChild(existingNode);
    }

    var host = el('div');
    host.id = TOPBAR_HOST_ID;
    host.setAttribute('data-acm-overlay', 'topbar');
    host.setAttribute('data-no-drag', '');
    host.setAttribute('data-theme', detectHostTheme(state.payload && state.payload.theme));
    host.style.flexShrink = '0';

    var shadow = host.attachShadow({ mode: 'open' });
    var styleEl = el('style');
    styleEl.textContent = TOPBAR_CSS;
    shadow.appendChild(styleEl);

    var cluster = el('div', 'acm-bar-cluster');

    // 1. Tightest quota pill
    var quotaPill = el('button', 'acm-bar-pill acm-num');
    quotaPill.type = 'button';
    quotaPill.setAttribute('data-view', 'quota');
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
    ctxPill.setAttribute('data-view', 'context');
    ctxPill.setAttribute('aria-haspopup', 'dialog');
    ctxPill.setAttribute('aria-expanded', 'false');
    var cRing = makeMiniRing(true);
    var cPctText = el('span', '', '0%');
    ctxPill.appendChild(cRing.svg);
    ctxPill.appendChild(cPctText);

    // 3. Speed / short-sample pill
    var speedPill = el('button', 'acm-bar-pill acm-num', '—');
    speedPill.type = 'button';
    speedPill.setAttribute('data-view', 'speed');
    speedPill.setAttribute('aria-haspopup', 'dialog');
    speedPill.setAttribute('aria-expanded', 'false');

    // 4. Cumulative recorded tokens pill
    var totalPill = el('button', 'acm-bar-pill acm-num', '0');
    totalPill.type = 'button';
    totalPill.setAttribute('data-view', 'total');
    totalPill.setAttribute('aria-haspopup', 'dialog');
    totalPill.setAttribute('aria-expanded', 'false');

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
    overflowMenu.setAttribute('popover', 'manual');

    // 4-View Telemetry Popover
    var quotaPopover = el('div', 'acm-quota-popover');
    quotaPopover.setAttribute('role', 'dialog');
    quotaPopover.setAttribute('popover', 'manual');

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

    // Compact 4-segment view switcher inside popover
    var qpTabsBar = el('div', 'acm-qp-tabs');
    qpTabsBar.setAttribute('role', 'tablist');
    var qpTabs = {};
    for (var ti = 0; ti < TOPBAR_VIEWS.length; ti++) {
      (function(viewKey) {
        var tabBtn = el('button', 'acm-qp-tab', viewKey);
        tabBtn.type = 'button';
        tabBtn.setAttribute('role', 'tab');
        tabBtn.setAttribute('data-tab-view', viewKey);
        tabBtn.setAttribute('aria-selected', viewKey === 'quota' ? 'true' : 'false');
        tabBtn.addEventListener('click', function(ev) {
          ev.stopPropagation();
          openTopBarView(viewKey, getTopBarPillForView(viewKey));
        });
        qpTabs[viewKey] = tabBtn;
        qpTabsBar.appendChild(tabBtn);
      })(TOPBAR_VIEWS[ti]);
    }

    var qpBody = el('div', 'acm-qp-body');

    var qpFooter = el('div', 'acm-qp-footer acm-num');
    var qpFooterTotal = el('span', '', '');
    var qpFooterFeedback = el('span', '', '');
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

    quotaPill.addEventListener('click', function(ev) {
      ev.stopPropagation();
      toggleTopBarView('quota', quotaPill);
    });
    ctxPill.addEventListener('click', function(ev) {
      ev.stopPropagation();
      toggleTopBarView('context', ctxPill);
    });
    speedPill.addEventListener('click', function(ev) {
      ev.stopPropagation();
      toggleTopBarView('speed', speedPill);
    });
    totalPill.addEventListener('click', function(ev) {
      ev.stopPropagation();
      toggleTopBarView('total', totalPill);
    });

    overflowBtn.addEventListener('click', function(ev) {
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

    qpCloseBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      closeTopBarPopover();
    });

    qpRefreshBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      sendBridgeAction(state.payload, 'refresh', 'topbar', qpFooterFeedback);
    });
    qpOpenBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      var targetTab = getTargetTabForTopBarView(state.topBarActiveView || 'quota');
      triggerOpenPanelAction(state.payload, 'topbar', qpFooterFeedback, targetTab);
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
      qpTabsBar: qpTabsBar,
      qpTabs: qpTabs,
      qpBody: qpBody,
      qpFooterTotal: qpFooterTotal,
      qpFooterFeedback: qpFooterFeedback
    };
  }

  function hasLiveAntigravityShellGeometry() {
    return Boolean(
      document.querySelector('.agy-sheet, [data-testid="sidebar-split"], [data-side-panel-strip], [data-testid="sidebar-toggle"]')
    );
  }

  function applyTopBarResponsiveLayout() {
    if (!state.topBarRefs) { return; }
    var r = state.topBarRefs;
    var vw = window.innerWidth || 1280;
    var auxBtn = document.querySelector('[data-testid="toggle-aux-sidebar"]');
    var auxOpen = Boolean(auxBtn && auxBtn.getAttribute('aria-expanded') === 'true');
    var wcoPx = computeWcoInsetPx(state.topBarAnchorMode === 'fixed');
    var hideTotal = false;
    var hideSpeed = false;
    var hideCtx = false;

    if (hasLiveAntigravityShellGeometry()) {
      var sidebarRight = getOpenSidebarRightPx();
      var leftChromeRight = getLeftChromeRightPx();
      var leftObstruction = Math.max(sidebarRight, leftChromeRight);
      var rightChromeLeft = getRightChromeLeftPx();
      var strip = document.querySelector('[data-side-panel-strip]');
      var stripVisible = Boolean(strip && isElementVisible(strip));
      var freeSpace = vw;

      if ((state.topBarAnchorTier === 'right-overlay' || state.topBarAnchorTier === 'fixed') && auxOpen && stripVisible) {
        var spacer = strip.querySelector ? strip.querySelector('[data-testid="side-panel-drag-spacer"]') : null;
        var spacerRect = spacer && isElementVisible(spacer) ? getSafeRect(spacer) : null;
        var auxTabsRight = 0;
        if (spacerRect && spacerRect.left > 0) {
          auxTabsRight = Math.round(spacerRect.left);
        } else {
          var stripRect = getSafeRect(strip);
          auxTabsRight = stripRect ? Math.round(stripRect.left) : 0;
          var stripChildren = getElementChildren(strip);
          for (var si = 0; si < stripChildren.length; si++) {
            var sc = stripChildren[si];
            if (!sc || sc.id === TOPBAR_HOST_ID || sc.getAttribute('data-testid') === 'side-panel-drag-spacer') {
              continue;
            }
            if (!isElementVisible(sc)) { continue; }
            var scRect = getSafeRect(sc);
            if (scRect && scRect.right > auxTabsRight) {
              auxTabsRight = Math.round(scRect.right);
            }
          }
        }
        freeSpace = Math.max(0, rightChromeLeft - auxTabsRight - 16);
      } else if (state.topBarAnchorTier === 'pane-toolbar') {
        var tbHostParent = state.topBarHost && state.topBarHost.parentElement;
        var tbOuter = tbHostParent && tbHostParent.parentElement;
        var tbOuterRect = getSafeRect(tbOuter);
        var tbHostRect = getSafeRect(tbHostParent);
        var tbRectLive = tbOuterRect || tbHostRect;
        var leftEdge = Math.max(leftObstruction, (tbRectLive && tbRectLive.left > 0) ? Math.round(tbRectLive.left) : 0);
        var tbRightBound = (tbRectLive && tbRectLive.right > 0) ? Math.round(tbRectLive.right) : rightChromeLeft;
        if (tbHostRect && tbHostRect.right > 0) {
          var tbContentRight = Math.round(tbHostRect.right - getRightPaddingAndBorderPx(tbHostParent));
          if (tbContentRight > 0 && tbContentRight < tbRightBound) {
            tbRightBound = tbContentRight;
          }
        }
        var tbSibMinLeft = getFollowingSiblingsMinLeftPx(state.topBarHost);
        var hasCrumbTb = Boolean(document.querySelector('[aria-label="Breadcrumb"]'));
        if (tbSibMinLeft < Infinity && tbSibMinLeft <= tbRightBound) {
          freeSpace = Math.max(0, tbSibMinLeft - leftEdge - (hasCrumbTb ? 140 : 24) - 24);
        } else {
          var tbNativeW = measureNativeToolbarButtonsWidth(tbHostParent, state.topBarHost);
          var effectiveRight = Math.min(tbRightBound, rightChromeLeft);
          freeSpace = Math.max(0, effectiveRight - leftEdge - tbNativeW - (hasCrumbTb ? 140 : 24) - 24);
        }
      } else {
        var paneTb = document.querySelector('[data-testid="pane-titlebar-toolbar"]');
        var paneTbVisible = paneTb && isElementVisible(paneTb) && !isRevealOnHoverElement(paneTb);
        var nativeBtnW = paneTbVisible ? measureNativeToolbarButtonsWidth(paneTb, state.topBarHost) : 0;
        var hasCrumb = Boolean(document.querySelector('[aria-label="Breadcrumb"]'));
        var crumbReserve = hasCrumb ? 140 : (paneTbVisible ? 48 : 16);
        freeSpace = Math.max(0, rightChromeLeft - leftObstruction - nativeBtnW - crumbReserve - 24);
      }

      hideTotal = freeSpace < 340;
      hideSpeed = freeSpace < 275;
      hideCtx = freeSpace < 195;

      if (state.topBarHost) {
        if (state.topBarAnchorMode === 'fixed') {
          var spacerTotal = wcoPx > 0 ? (wcoPx + 5) : 0;
          var totalHostBudget = vw - 10 - leftObstruction - 8;
          state.topBarHost.style.maxWidth = Math.max(80 + spacerTotal, totalHostBudget) + 'px';
          r.cluster.style.maxWidth = Math.max(80, totalHostBudget - spacerTotal) + 'px';
        } else {
          state.topBarHost.style.maxWidth = '';
          r.cluster.style.maxWidth = '';
        }
      }
    } else {
      var effectiveWidth = vw;
      try {
        var titlebar = document.querySelector('[data-testid="pane-titlebar-toolbar"]');
        if (titlebar && typeof titlebar.getBoundingClientRect === 'function') {
          var tbRect = titlebar.getBoundingClientRect();
          if (tbRect && typeof tbRect.width === 'number' && tbRect.width > 120) {
            effectiveWidth = Math.min(effectiveWidth, tbRect.width);
          }
        }
      } catch (_e) {}
      var totalThreshold = auxOpen ? 1360 : 1120;
      var speedThreshold = auxOpen ? 1040 : 860;
      var ctxThreshold = auxOpen ? 760 : 620;
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
    var showOverflow = hideTotal || hideSpeed || hideCtx;
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

  function anchorTopBarHost() {
    if (!state.topBarEnabled) { return; }
    if (!state.topBarHost) { createTopBarSlot(); }
    var anchor = findTopBarAnchor();
    if (!anchor || !anchor.parent) { return; }

    var anchorBefore = anchor.before === state.topBarHost ? state.topBarHost.nextSibling : anchor.before;
    var alreadyPlaced = state.topBarHost.parentNode === anchor.parent
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

  function buildQpKvRow(label, valueNodeOrText, subText) {
    var row = el('div', 'acm-qp-kv-row');
    row.appendChild(el('span', 'acm-k', label));
    var valWrap = el('span', 'acm-v acm-num');
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

  function buildQpStatCard(label, valueText, subText) {
    var card = el('div', 'acm-qp-stat-card');
    card.appendChild(el('div', 'acm-qp-stat-label', label));
    card.appendChild(el('div', 'acm-qp-stat-val acm-num', valueText));
    if (subText) {
      card.appendChild(el('div', 'acm-qp-stat-sub acm-num', subText));
    }
    return card;
  }

  function updateQuotaMetaClock() {
    if (!state.topBarRefs || !state.payload) { return; }
    var lang = state.payload.language || 'both';
    var parts = [];
    var clockStr = formatLocalClockTime(state.payload.updatedAt);
    if (clockStr) {
      parts.push(bi(lang, 'Updated', '更新于') + ' ' + clockStr);
    }
    if (typeof state.countdownSec === 'number' && state.countdownSec >= 0) {
      parts.push(bi(lang, 'Next refresh in', '下次刷新') + ' ' + state.countdownSec + 's');
    }
    state.topBarRefs.qpMeta.textContent = parts.join(' · ') || '—';
  }

  function renderTopBarQuotaView(p, lang, body, cPct) {
    var sessionSec = el('div', 'acm-qp-section');
    sessionSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Current Session Model', '当前会话模型')));
    var sessionCard = el('div', 'acm-qp-session-card');

    var sessTop = el('div', 'acm-qp-session-model');
    sessTop.appendChild(el('span', '', p.modelName || bi(lang, 'No active model', '暂无活跃模型')));
    sessTop.appendChild(el('span', 'acm-pill-badge is-accent acm-num', Math.round(cPct) + '% ' + bi(lang, 'Ctx', '上下文')));
    sessionCard.appendChild(sessTop);

    var sess5hPct = p.sessionQuota5hPct !== undefined ? p.sessionQuota5hPct : p.tightestQuotaPct;
    sessionCard.appendChild(buildQuotaBarNode(
      bi(lang, '5h Window', '5 小时窗口'),
      sess5hPct,
      p.sessionQuota5hReset || ''
    ));
    if (p.sessionQuotaWeeklyPct !== undefined && p.sessionQuotaWeeklyPct !== null) {
      sessionCard.appendChild(buildQuotaBarNode(
        bi(lang, 'Weekly Limit', '每周限额'),
        p.sessionQuotaWeeklyPct,
        p.sessionQuotaWeeklyReset || ''
      ));
    }
    sessionSec.appendChild(sessionCard);
    body.appendChild(sessionSec);

    var poolsSec = el('div', 'acm-qp-section');
    poolsSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Shared Quota Pools', '共享配额池')));
    var poolList = el('div', 'acm-pool-list');
    var pools = Array.isArray(p.quotaPools) ? p.quotaPools : [];
    if (pools.length === 0) {
      poolList.appendChild(el('div', 'acm-k', bi(lang, 'Waiting for quota pool telemetry...', '正在等待配额池数据...')));
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
        right.appendChild(el('span', 'acm-pill-badge' + (health !== 'unknown' ? (' is-' + health) : ''), healthLabel));
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
        poolList.appendChild(card);
      }
    }
    poolsSec.appendChild(poolList);
    body.appendChild(poolsSec);
  }

  function renderTopBarContextView(p, lang, body) {
    var clampedPct = clampNum(p.contextPct, 0, 100);
    var rawPct = Number.isFinite(Number(p.contextPct)) ? Math.max(0, Number(p.contextPct)) : 0;
    var severity = rawPct >= 80 ? 'danger' : (rawPct >= 65 ? 'warn' : 'normal');

    var heroSec = el('div', 'acm-qp-section');
    heroSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Active Context Window', '当前上下文窗口')));
    var heroCard = el('div', 'acm-qp-hero-card');

    var heroTop = el('div', 'acm-qp-hero-top');
    heroTop.appendChild(el('div', 'acm-qp-hero-label', p.modelName || bi(lang, 'No active model', '暂无活跃模型')));
    var sevBadgeLabel = severity === 'danger'
      ? bi(lang, 'High pressure', '高压预警')
      : (severity === 'warn' ? bi(lang, 'Elevated', '偏高') : bi(lang, 'Healthy', '充裕'));
    var sevBadgeCls = 'acm-pill-badge' + (severity === 'danger' ? ' is-danger' : (severity === 'warn' ? ' is-warn' : ' is-good'));
    heroTop.appendChild(el('span', sevBadgeCls, sevBadgeLabel));
    heroCard.appendChild(heroTop);

    var metricRow = el('div', 'acm-qp-hero-metric-row');
    var pctCls = 'acm-qp-hero-value acm-num' + (severity === 'danger' ? ' is-danger' : (severity === 'warn' ? ' is-warn' : ' is-accent'));
    metricRow.appendChild(el('div', pctCls, rawPct.toFixed(1).replace(/\\.0$/, '') + '%'));
    var nativeSuffix = p.contextNativeLimit && p.contextNativeLimit > p.contextEffectiveLimit
      ? (' (' + formatCompact(p.contextNativeLimit) + ' max)')
      : '';
    var tokCapText = formatCompact(p.contextUsedTokens) + ' / ' + formatCompact(p.contextEffectiveLimit) + nativeSuffix;
    metricRow.appendChild(el('div', 'acm-v acm-num', tokCapText));
    heroCard.appendChild(metricRow);

    var meterWrap = el('div', 'acm-qp-meter-wrap');
    var meterFill = el('div', 'acm-qp-meter-fill' + (severity === 'danger' ? ' is-danger' : (severity === 'warn' ? ' is-warn' : '')));
    meterFill.style.width = clampedPct.toFixed(1) + '%';
    meterWrap.appendChild(meterFill);

    var marks = [];
    if (typeof p.compactionThresholdPct === 'number' && Number.isFinite(p.compactionThresholdPct) && p.compactionThresholdPct > 2 && p.compactionThresholdPct < 99) {
      var tickComp = el('div', 'acm-qp-watermark-tick is-compaction');
      tickComp.style.left = clampNum(p.compactionThresholdPct, 2, 98).toFixed(1) + '%';
      tickComp.setAttribute('title', bi(lang, 'Compaction limit', '压缩阈值') + ' ' + Math.round(p.compactionThresholdPct) + '%');
      meterWrap.appendChild(tickComp);
      marks.push(bi(lang, 'Compact', '压缩') + ' ' + Math.round(p.compactionThresholdPct) + '%');
    }
    if (typeof p.tier200kMarkerPct === 'number' && Number.isFinite(p.tier200kMarkerPct) && p.tier200kMarkerPct > 2 && p.tier200kMarkerPct < 99) {
      var tick200k = el('div', 'acm-qp-watermark-tick is-tier200k');
      tick200k.style.left = clampNum(p.tier200kMarkerPct, 2, 98).toFixed(1) + '%';
      tick200k.setAttribute('title', bi(lang, '200k pricing tier', '200k 计费阶梯'));
      meterWrap.appendChild(tick200k);
      marks.push('200k');
    }
    heroCard.appendChild(meterWrap);

    var subRow = el('div', 'acm-qp-hero-sub acm-num');
    var remTokens = Math.max(0, (Number(p.contextEffectiveLimit) || 0) - (Number(p.contextUsedTokens) || 0));
    subRow.appendChild(el('span', '', bi(lang, 'Remaining', '剩余可用') + ': ' + formatCompact(remTokens)));
    subRow.appendChild(el('span', '', marks.join(' · ')));
    heroCard.appendChild(subRow);
    heroSec.appendChild(heroCard);
    body.appendChild(heroSec);

    var tokSec = el('div', 'acm-qp-section');
    tokSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Session Token Breakdown', '本会话 Token 明细')));
    var tokCard = el('div', 'acm-qp-kv-card');
    tokCard.appendChild(buildQpKvRow(bi(lang, 'Input / Output', '输入 / 输出'), formatCompact(p.inputTokens) + ' / ' + formatCompact(p.outputTokens)));
    tokCard.appendChild(buildQpKvRow(bi(lang, 'Cache Read', '缓存读取'), formatCompact(p.cacheReadTokens)));
    tokCard.appendChild(buildQpKvRow(bi(lang, 'Session Total Tokens', '本会话总 Tokens'), formatCompact(p.totalTokens)));
    tokSec.appendChild(tokCard);
    body.appendChild(tokSec);

    var cacheSec = el('div', 'acm-qp-section');
    cacheSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Cache Efficiency', '缓存命中效率')));
    var cacheCard = el('div', 'acm-qp-kv-card');
    cacheCard.appendChild(buildQpKvRow(bi(lang, 'Recent Cache Hit', '近期缓存命中'), formatPct(p.recentCacheHitPct)));
    cacheCard.appendChild(buildQpKvRow(bi(lang, 'Avg Cache Hit', '平均缓存命中'), formatPct(p.avgCacheHitPct)));
    cacheCard.appendChild(buildQpKvRow(bi(lang, 'Turn Cache State', '轮次缓存状态'), buildTurnCacheBadge(lang, p.turnCacheState)));
    cacheSec.appendChild(cacheCard);
    body.appendChild(cacheSec);
  }

  function renderTopBarSpeedView(p, lang, body) {
    var heroSec = el('div', 'acm-qp-section');
    heroSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Live Output Speed', '实时生成速度')));
    var heroCard = el('div', 'acm-qp-hero-card');

    var heroTop = el('div', 'acm-qp-hero-top');
    heroTop.appendChild(el('div', 'acm-qp-hero-label', p.modelName || bi(lang, 'Output Throughput', '输出吞吐')));
    var statusBadge;
    if (p.isWaitingTtft) {
      statusBadge = el('span', 'acm-pill-badge is-warn', bi(lang, 'Waiting for first token', '等待首字'));
    } else if (p.isShortSample) {
      statusBadge = el('span', 'acm-pill-badge is-warn', bi(lang, 'Short sample', '短样本'));
    } else if (typeof p.outputSpeedTps === 'number' && Number.isFinite(p.outputSpeedTps) && p.outputSpeedTps > 0) {
      statusBadge = el('span', 'acm-pill-badge is-good', bi(lang, 'Live', '实时'));
    } else {
      statusBadge = el('span', 'acm-pill-badge', bi(lang, 'Idle', '空闲'));
    }
    heroTop.appendChild(statusBadge);
    heroCard.appendChild(heroTop);

    var metricRow = el('div', 'acm-qp-hero-metric-row');
    if (p.isWaitingTtft) {
      metricRow.appendChild(el('div', 'acm-qp-hero-value is-warn', bi(lang, 'Waiting...', '等待首字...')));
    } else if (p.isShortSample) {
      var shortVal = el('div', 'acm-qp-hero-value is-warn acm-num', bi(lang, 'Short sample', '短样本'));
      if (typeof p.outputSpeedTps === 'number' && Number.isFinite(p.outputSpeedTps) && p.outputSpeedTps > 0) {
        shortVal.appendChild(el('span', 'acm-qp-hero-unit', '(' + formatTps(p.outputSpeedTps) + ')'));
      }
      metricRow.appendChild(shortVal);
    } else {
      metricRow.appendChild(el('div', 'acm-qp-hero-value is-accent acm-num', formatTps(p.outputSpeedTps)));
    }
    heroCard.appendChild(metricRow);

    var subRow = el('div', 'acm-qp-hero-sub acm-num');
    subRow.appendChild(el('span', '', bi(lang, 'First Token Latency (TTFT)', '首字延迟 (TTFT)') + ': ' + formatTtft(p.ttftMs)));
    subRow.appendChild(el('span', '', bi(lang, 'Avg', '平均') + ': ' + formatTps(p.avgOutputSpeedTps)));
    heroCard.appendChild(subRow);
    heroSec.appendChild(heroCard);
    body.appendChild(heroSec);

    var metricsSec = el('div', 'acm-qp-section');
    metricsSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Throughput & Latency', '吞吐与延迟指标')));
    var statGrid = el('div', 'acm-qp-stat-grid');
    statGrid.appendChild(buildQpStatCard(bi(lang, 'Avg Output Speed', '平均输出速度'), formatTps(p.avgOutputSpeedTps)));
    statGrid.appendChild(buildQpStatCard(bi(lang, 'First Token (TTFT)', '首字延迟'), formatTtft(p.ttftMs)));
    if (typeof p.peakOutputSpeedTps === 'number' && Number.isFinite(p.peakOutputSpeedTps) && p.peakOutputSpeedTps > 0) {
      statGrid.appendChild(buildQpStatCard(bi(lang, 'Peak Output Speed', '峰值输出速度'), formatTps(p.peakOutputSpeedTps)));
    }
    if (typeof p.recentCallCount === 'number' && Number.isFinite(p.recentCallCount) && p.recentCallCount >= 0) {
      statGrid.appendChild(buildQpStatCard(bi(lang, 'Recent LLM Calls', '近期模型调用'), String(Math.round(p.recentCallCount))));
    }
    metricsSec.appendChild(statGrid);
    body.appendChild(metricsSec);

    var cacheSec = el('div', 'acm-qp-section');
    cacheSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Cache Efficiency (Prefill)', '缓存效率（影响首字延迟）')));
    var cacheCard = el('div', 'acm-qp-kv-card');
    cacheCard.appendChild(buildQpKvRow(bi(lang, 'Recent Cache Hit', '近期缓存命中'), formatPct(p.recentCacheHitPct)));
    cacheCard.appendChild(buildQpKvRow(bi(lang, 'Avg Cache Hit', '平均缓存命中'), formatPct(p.avgCacheHitPct)));
    cacheCard.appendChild(buildQpKvRow(bi(lang, 'Turn Cache State', '轮次缓存状态'), buildTurnCacheBadge(lang, p.turnCacheState)));
    cacheSec.appendChild(cacheCard);
    body.appendChild(cacheSec);
  }

  function renderTopBarTotalView(p, lang, body) {
    var cumStr = formatCompact(p.cumulativeRecordedTokens);
    var costStr = formatUsd(p.estCostUsd, p.estCostFormatted);

    var heroSec = el('div', 'acm-qp-section');
    heroSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Recorded Local Total', '本机已记录总用量')));
    var heroCard = el('div', 'acm-qp-hero-card');

    var heroTop = el('div', 'acm-qp-hero-top');
    heroTop.appendChild(el('div', 'acm-qp-hero-label', bi(lang, 'Cumulative Recorded Tokens', '本机累计 Tokens')));
    if (typeof p.cumulativeCostFormatted === 'string' && p.cumulativeCostFormatted.trim()) {
      heroTop.appendChild(el('span', 'acm-pill-badge is-accent acm-num', p.cumulativeCostFormatted.trim()));
    }
    heroCard.appendChild(heroTop);

    var metricRow = el('div', 'acm-qp-hero-metric-row');
    var heroVal = el('div', 'acm-qp-hero-value is-accent acm-num', cumStr);
    heroVal.appendChild(el('span', 'acm-qp-hero-unit', 'tokens'));
    metricRow.appendChild(heroVal);
    heroCard.appendChild(metricRow);

    var daysVal = typeof p.recordedDaysCount === 'number' && Number.isFinite(p.recordedDaysCount) && p.recordedDaysCount > 0
      ? Math.round(p.recordedDaysCount)
      : null;
    var sessVal = typeof p.sessionCount === 'number' && Number.isFinite(p.sessionCount) && p.sessionCount > 0
      ? Math.round(p.sessionCount)
      : null;
    var scopeEnParts = [];
    var scopeZhParts = [];
    var scopeCompactParts = [];
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
    var hasScope = scopeEnParts.length > 0;
    var scopeFullText = hasScope ? bi(lang, scopeEnParts.join(' · '), scopeZhParts.join(' · ')) : '';
    var scopeCompactText = hasScope
      ? (lang === 'en' ? scopeEnParts.join(' · ') : (lang === 'zh' ? scopeZhParts.join(' · ') : (daysVal !== null && sessVal !== null ? (daysVal + 'd · ' + sessVal + ' sess') : scopeCompactParts.join(' · '))))
      : '';
    var subRow = el('div', 'acm-qp-hero-sub acm-num');
    subRow.appendChild(el('span', '', hasScope
      ? (bi(lang, 'Recorded Scope', '记录范围') + ': ' + scopeFullText)
      : (bi(lang, 'Session Total', '本会话总计') + ': ' + formatCompact(p.totalTokens))));
    if (typeof p.todayCostFormatted === 'string' && p.todayCostFormatted.trim()) {
      subRow.appendChild(el('span', '', bi(lang, 'Today', '今日') + ': ' + p.todayCostFormatted.trim()));
    }
    heroCard.appendChild(subRow);
    heroSec.appendChild(heroCard);
    body.appendChild(heroSec);

    var hasToday = (typeof p.todayTokens === 'number' && Number.isFinite(p.todayTokens))
      || (typeof p.todayCostFormatted === 'string' && p.todayCostFormatted.trim().length > 0);
    var hasHistory = hasScope
      || (typeof p.cumulativeCostFormatted === 'string' && p.cumulativeCostFormatted.trim().length > 0);
    var hasRoi = typeof p.subscriptionRoiSummary === 'string' && p.subscriptionRoiSummary.trim().length > 0;

    if (hasToday || hasHistory || hasRoi) {
      var histSec = el('div', 'acm-qp-section');
      histSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Today & Recorded History', '今日与历史统计')));
      if (hasToday || hasHistory) {
        var grid = el('div', 'acm-qp-stat-grid');
        if (hasToday) {
          var todayVal = typeof p.todayTokens === 'number' && Number.isFinite(p.todayTokens)
            ? formatCompact(p.todayTokens)
            : (p.todayCostFormatted || '—');
          var todaySub = (typeof p.todayTokens === 'number' && Number.isFinite(p.todayTokens) && p.todayCostFormatted)
            ? (bi(lang, 'Est.', '约') + ' ' + p.todayCostFormatted)
            : '';
          grid.appendChild(buildQpStatCard(bi(lang, 'Today Tokens & Cost', '今日用量与估算'), todayVal, todaySub));
        }
        if (hasHistory) {
          var histVal = hasScope ? scopeCompactText : (p.cumulativeCostFormatted || '—');
          var histSub = (hasScope && p.cumulativeCostFormatted)
            ? (bi(lang, 'Cumulative', '累计') + ' ' + p.cumulativeCostFormatted)
            : '';
          grid.appendChild(buildQpStatCard(bi(lang, 'Recorded History', '历史记录范围'), histVal, histSub));
        }
        histSec.appendChild(grid);
      }
      if (hasRoi) {
        var roiRow = el('div', 'acm-qp-roi-row');
        roiRow.appendChild(el('span', 'acm-qp-roi-label', bi(lang, 'Subscription ROI', '订阅回报')));
        roiRow.appendChild(el('span', 'acm-qp-roi-val acm-num', p.subscriptionRoiSummary.trim()));
        histSec.appendChild(roiRow);
      }
      body.appendChild(histSec);
    }

    var sessSec = el('div', 'acm-qp-section');
    sessSec.appendChild(el('div', 'acm-qp-section-title', bi(lang, 'Current Session Breakdown', '当前会话明细')));
    var sessCard = el('div', 'acm-qp-kv-card');
    sessCard.appendChild(buildQpKvRow(
      bi(lang, 'Est. Cost', '估算费用'),
      costStr,
      p.localCostFormatted ? ('≈ ' + p.localCostFormatted) : ''
    ));
    sessCard.appendChild(buildQpKvRow(bi(lang, 'Input / Output', '输入 / 输出'), formatCompact(p.inputTokens) + ' / ' + formatCompact(p.outputTokens)));
    sessCard.appendChild(buildQpKvRow(bi(lang, 'Cache Read', '缓存读取'), formatCompact(p.cacheReadTokens)));
    sessCard.appendChild(buildQpKvRow(bi(lang, 'Session Total', '会话总 Tokens'), formatCompact(p.totalTokens)));
    sessSec.appendChild(sessCard);
    body.appendChild(sessSec);
  }

  function renderTopBarPopover() {
    if (!state.topBarRefs || !state.payload) { return; }
    var p = state.payload;
    var r = state.topBarRefs;
    var lang = p.language || 'both';
    var view = normalizeTopBarView(state.topBarActiveView || 'quota');
    var cPct = clampNum(p.contextPct, 0, 100);
    var cumStr = formatCompact(p.cumulativeRecordedTokens);
    var costStr = formatUsd(p.estCostUsd, p.estCostFormatted);

    // Localized view title
    if (view === 'context') {
      r.qpTitle.textContent = bi(lang, 'Context Usage', '上下文用量');
    } else if (view === 'speed') {
      r.qpTitle.textContent = bi(lang, 'Speed & Throughput', '生成速度与吞吐');
    } else if (view === 'total') {
      r.qpTitle.textContent = bi(lang, 'Total Usage & Cost', '本机累计用量与成本');
    } else {
      r.qpTitle.textContent = bi(lang, 'Model Quota Board', '模型配额面板');
    }

    // Localized compact segmented switcher labels
    r.qpTabs.quota.textContent = lang === 'both' ? 'Quota 配额' : bi(lang, 'Quota', '配额');
    r.qpTabs.context.textContent = lang === 'both' ? 'Ctx 上下文' : bi(lang, 'Context', '上下文');
    r.qpTabs.speed.textContent = lang === 'both' ? 'Speed 速度' : bi(lang, 'Speed', '速度');
    r.qpTabs.total.textContent = lang === 'both' ? 'Total 累计' : bi(lang, 'Total', '累计');
    syncTopBarPillStates();

    r.qpRefreshBtn.textContent = bi(lang, 'Refresh', '刷新');
    r.qpOpenBtn.textContent = bi(lang, 'Open Panel', '打开面板');
    var hasBridge = hasLoopbackBridge(p);
    var canOpenDirectly = Boolean(document.querySelector('[data-testid="toggle-aux-sidebar"]'));
    r.qpRefreshBtn.style.display = hasBridge ? '' : 'none';
    r.qpOpenBtn.style.display = (hasBridge || canOpenDirectly) ? '' : 'none';

    updateQuotaMetaClock();

    clearChildren(r.qpBody);
    if (view === 'context') {
      renderTopBarContextView(p, lang, r.qpBody);
      r.qpFooterTotal.textContent = bi(lang, 'Session Cost', '本会话费用') + ': ' + costStr + (p.localCostFormatted ? (' (≈ ' + p.localCostFormatted + ')') : '');
    } else if (view === 'speed') {
      renderTopBarSpeedView(p, lang, r.qpBody);
      r.qpFooterTotal.textContent = bi(lang, 'Session Output', '本会话输出') + ': ' + formatCompact(p.outputTokens) + ' tok';
    } else if (view === 'total') {
      renderTopBarTotalView(p, lang, r.qpBody);
      r.qpFooterTotal.textContent = bi(lang, 'Active Model', '当前模型') + ': ' + (p.modelName || '—');
    } else {
      renderTopBarQuotaView(p, lang, r.qpBody, cPct);
      r.qpFooterTotal.textContent = bi(lang, 'Recorded Total', '本机已记录总量') + ': ' + cumStr;
    }
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
    r.quotaPill.setAttribute('aria-label', bi(lang, 'Model Quota Board', '模型配额面板'));

    // Context ring
    var cPct = clampNum(p.contextPct, 0, 100);
    r.cRing.arc.setAttribute('stroke-dashoffset', (MINI_CIRC * (1 - cPct / 100)).toFixed(2));
    var cSev = cPct >= 80 ? 'danger' : (cPct >= 65 ? 'warn' : 'normal');
    r.cRing.arc.classList.toggle('is-accent', cSev === 'normal');
    r.cRing.arc.classList.toggle('is-warn', cSev === 'warn');
    r.cRing.arc.classList.toggle('is-danger', cSev === 'danger');
    var ctxLabel = Math.round(cPct) + '%';
    r.cPctText.textContent = ctxLabel;
    r.ctxPill.setAttribute('aria-label', bi(lang, 'Context Usage', '上下文用量'));

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
    r.speedPill.setAttribute('aria-label', bi(lang, 'Speed & Throughput', '生成速度与吞吐'));

    // Cumulative recorded tokens pill
    var cumStr = formatCompact(p.cumulativeRecordedTokens);
    r.totalPill.textContent = cumStr;
    r.totalPill.setAttribute('aria-label', bi(lang, 'Total Usage & Cost', '本机累计用量与成本'));

    // Overflow dropdown content (each item opens its dedicated popover view!)
    clearChildren(r.overflowMenu);
    function makeOverflowItem(viewKey, labelText, valueText) {
      var item = el('button', 'acm-overflow-row');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('data-overflow-view', viewKey);
      item.appendChild(el('span', '', labelText));
      item.appendChild(el('strong', 'acm-num', valueText));
      item.addEventListener('click', function(ev) {
        ev.stopPropagation();
        openTopBarView(viewKey, r.overflowBtn);
      });
      return item;
    }
    r.overflowMenu.appendChild(makeOverflowItem('context', bi(lang, 'Context', '上下文用量'), ctxLabel));
    r.overflowMenu.appendChild(makeOverflowItem('speed', bi(lang, 'Speed', '生成速度'), speedLabel));
    r.overflowMenu.appendChild(makeOverflowItem('total', bi(lang, 'Recorded Total', '本机已记录'), cumStr));
    var ovBoardBtn = el('button', 'acm-btn', bi(lang, 'Model Quota Board', '模型配额面板'));
    ovBoardBtn.type = 'button';
    ovBoardBtn.setAttribute('role', 'menuitem');
    ovBoardBtn.setAttribute('data-overflow-view', 'quota');
    ovBoardBtn.addEventListener('click', function(ev) {
      ev.stopPropagation();
      openTopBarView('quota', r.overflowBtn);
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

  function repositionOpenPopovers() {
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

  function cancelScheduledLayoutSync() {
    if (state.layoutSyncHandle === null) { return; }
    if (state.layoutSyncIsRaf && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(state.layoutSyncHandle);
    } else {
      clearTimeout(state.layoutSyncHandle);
    }
    state.layoutSyncHandle = null;
    state.layoutSyncIsRaf = false;
  }

  function runLayoutSyncNow() {
    if (state.composerEnabled) { anchorComposerHost(); }
    if (state.topBarEnabled) {
      anchorTopBarHost();
      applyTopBarResponsiveLayout();
    }
    repositionOpenPopovers();
    refreshResizeObserverTargets();
  }

  function scheduleLayoutSync() {
    if (state.layoutSyncHandle !== null) { return; }
    if (typeof requestAnimationFrame === 'function') {
      state.layoutSyncIsRaf = true;
      state.layoutSyncHandle = requestAnimationFrame(function() {
        state.layoutSyncHandle = null;
        state.layoutSyncIsRaf = false;
        runLayoutSyncNow();
      });
    } else {
      state.layoutSyncIsRaf = false;
      state.layoutSyncHandle = setTimeout(function() {
        state.layoutSyncHandle = null;
        runLayoutSyncNow();
      }, 16);
    }
  }

  function collectLayoutWatchNodes() {
    var nodes = [];
    var pushUnique = function(n) {
      if (n && n.isConnected && nodes.indexOf(n) < 0) { nodes.push(n); }
    };
    pushUnique(document.querySelector('.agy-sheet'));
    var split = document.querySelector('[data-testid="sidebar-split"]');
    if (split && split.firstElementChild) {
      pushUnique(split.firstElementChild);
    }
    pushUnique(document.querySelector('[data-testid="aux-pane-split"]'));
    pushUnique(document.querySelector('[data-side-panel-strip]'));
    return nodes;
  }

  function refreshResizeObserverTargets() {
    if (!state.layoutObserver) { return; }
    var nextNodes = collectLayoutWatchNodes();
    var same = nextNodes.length === state.observedLayoutNodes.length;
    if (same) {
      for (var i = 0; i < nextNodes.length; i++) {
        if (nextNodes[i] !== state.observedLayoutNodes[i]) { same = false; break; }
      }
    }
    if (same) { return; }
    if (state.observedLayoutNodes.length > 0) {
      try { state.layoutObserver.disconnect(); } catch (_e) {}
    }
    state.observedLayoutNodes = [];
    for (var j = 0; j < nextNodes.length; j++) {
      try {
        state.layoutObserver.observe(nextNodes[j]);
        state.observedLayoutNodes.push(nextNodes[j]);
      } catch (_e) {}
    }
  }

  function onGlobalClick(ev) {
    var path = ev.composedPath ? ev.composedPath() : [];
    if (state.composerOpen && state.composerPinned && state.composerHost && path.indexOf(state.composerHost) < 0) {
      closeComposerPopover(true);
    }
    if ((state.topBarActiveView || state.overflowOpen) && state.topBarHost && path.indexOf(state.topBarHost) < 0) {
      closeTopBarPopover();
      closeOverflowMenu();
    }
  }

  function onGlobalKeyDown(ev) {
    if (ev.key !== 'Escape') { return; }
    if (state.composerOpen && state.composerRefs) {
      closeComposerPopover(true);
    }
    if (state.topBarActiveView || state.overflowOpen) {
      closeTopBarPopover();
      closeOverflowMenu();
    }
  }

  function onWindowResize() {
    if (state.topBarEnabled) {
      anchorTopBarHost();
      applyTopBarResponsiveLayout();
    }
    repositionOpenPopovers();
  }

  function onWcoGeometryChange() {
    if (!state.topBarEnabled && !state.composerEnabled) { return; }
    if (state.topBarEnabled) {
      anchorTopBarHost();
      applyTopBarResponsiveLayout();
    }
    repositionOpenPopovers();
  }

  function ensureWcoListenerBound() {
    if (state.boundWcoTarget) { return; }
    try {
      if (navigator && navigator.windowControlsOverlay && typeof navigator.windowControlsOverlay.addEventListener === 'function') {
        navigator.windowControlsOverlay.addEventListener('geometrychange', onWcoGeometryChange);
        state.boundWcoTarget = navigator.windowControlsOverlay;
      }
    } catch (_e) {}
  }

  function onTransitionEnd(ev) {
    if (!state.topBarEnabled && !state.composerEnabled) { return; }
    var prop = ev && ev.propertyName ? String(ev.propertyName) : '';
    if (prop && prop !== 'width' && prop !== 'flex-basis' && prop !== 'transform' && prop !== 'padding-left' && prop !== 'padding-right') {
      return;
    }
    scheduleLayoutSync();
  }

  function ensureObserversRunning() {
    ensureWcoListenerBound();
    if (!state.domObserver && typeof MutationObserver !== 'undefined' && document.body) {
      state.domObserver = new MutationObserver(function(records) {
        var hasLayoutAttrChange = false;
        var hasRelevantChildChange = false;
        if (Array.isArray(records)) {
          for (var i = 0; i < records.length; i++) {
            var rec = records[i];
            if (!rec || rec.target === state.topBarHost || rec.target === state.composerHost) { continue; }
            if (rec.type === 'attributes') {
              hasLayoutAttrChange = true;
            } else {
              hasRelevantChildChange = true;
            }
          }
        } else {
          hasRelevantChildChange = true;
        }
        if (hasLayoutAttrChange) {
          scheduleLayoutSync();
          if (state.sidebarTransitionTimer) { clearTimeout(state.sidebarTransitionTimer); }
          state.sidebarTransitionTimer = setTimeout(function() {
            state.sidebarTransitionTimer = null;
            runLayoutSyncNow();
          }, 540);
        }
        if (hasRelevantChildChange && !state.reanchorTimer) {
          state.reanchorTimer = setTimeout(function() {
            state.reanchorTimer = null;
            runLayoutSyncNow();
          }, 150);
        }
      });
      state.domObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-sidebar-closed', 'data-side-panel-docked', 'data-side-panel-maximized', 'data-pane-unfocused', 'aria-expanded', 'hidden']
      });
    }
    if (!state.layoutObserver && typeof ResizeObserver === 'function') {
      state.layoutObserver = new ResizeObserver(function() {
        scheduleLayoutSync();
      });
      refreshResizeObserverTargets();
    }
    if (!state.themeObserver && typeof MutationObserver !== 'undefined' && document.documentElement) {
      state.themeObserver = new MutationObserver(function() { syncThemes(); });
      state.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-agy-theme'] });
      if (document.body) {
        state.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-agy-theme'] });
      }
    }
    if (!state.countdownTimer) {
      state.countdownTimer = setInterval(function() {
        if (state.topBarActiveView && typeof state.countdownSec === 'number' && state.countdownSec > 0) {
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
    if (state.layoutObserver) { state.layoutObserver.disconnect(); state.layoutObserver = null; state.observedLayoutNodes = []; }
    if (state.reanchorTimer) { clearTimeout(state.reanchorTimer); state.reanchorTimer = null; }
    if (state.sidebarTransitionTimer) { clearTimeout(state.sidebarTransitionTimer); state.sidebarTransitionTimer = null; }
    cancelScheduledLayoutSync();
    if (state.countdownTimer) { clearInterval(state.countdownTimer); state.countdownTimer = null; }
    if (state.composerHideTimer) { clearTimeout(state.composerHideTimer); state.composerHideTimer = null; }
  }

  function unmountSlot(slot) {
    if (slot === 'composer' || slot === 'all') {
      closeComposerPopover(true);
      state.composerEnabled = false;
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
      closeTopBarPopover();
      closeOverflowMenu();
      state.topBarEnabled = false;
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
      document.removeEventListener('transitionend', onTransitionEnd, true);
      window.removeEventListener('resize', onWindowResize);
      try {
        var wcoTarget = state.boundWcoTarget || (navigator && navigator.windowControlsOverlay);
        if (wcoTarget && typeof wcoTarget.removeEventListener === 'function') {
          wcoTarget.removeEventListener('geometrychange', onWcoGeometryChange);
        }
      } catch (_e) {}
      state.boundWcoTarget = null;
      try { delete window[GLOBAL_KEY]; } catch (_e) { window[GLOBAL_KEY] = undefined; }
    }
    return { unmounted: slot };
  }

  document.addEventListener('click', onGlobalClick, true);
  document.addEventListener('keydown', onGlobalKeyDown, true);
  document.addEventListener('transitionend', onTransitionEnd, true);
  window.addEventListener('resize', onWindowResize);
  ensureWcoListenerBound();

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
      if (nextComposer || nextTopBar) {
        refreshResizeObserverTargets();
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
        topBarMounted: Boolean(state.topBarHost && state.topBarHost.isConnected),
        topBarAnchorMode: state.topBarAnchorMode,
        topBarAnchorTier: state.topBarAnchorTier,
        topBarActiveView: state.topBarActiveView
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

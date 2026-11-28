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

import { createHash } from 'node:crypto';
import { getRuntimeVersion } from '../core/version';
import type { CdpOverlayPayload, CdpOverlayToggles } from './sidecar-types';
import {
    CDP_OVERLAY_CLIENT_BUILD_ID,
    CDP_OVERLAY_CLIENT_BUNDLE,
} from '../client/generated/client-bundles.generated';

export const CDP_OVERLAY_SCRIPT_VERSION = getRuntimeVersion();
export const CDP_COMPOSER_HOST_ID = 'acm-cdp-composer-host';
export const CDP_TOPBAR_HOST_ID = 'acm-cdp-topbar-host';
export const CDP_RUNTIME_GLOBAL_KEY = '__ACM_CDP_OVERLAY_V1__';

export interface CdpOverlayBootstrapConfig {
    scriptVersion?: string;
    buildId?: string;
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

  /* Typography scale tokens (normal default; overridden by compact / large presets) */
  --acm-fs-xs: 10px;
  --acm-fs-sm: 10.5px;
  --acm-fs-pill: 11px;
  --acm-fs-base: 11.5px;
  --acm-fs-md: 12px;
  --acm-fs-title: 12.5px;
  --acm-fs-lg: 13px;
  --acm-fs-hero: 22px;
  --acm-pill-h: 22px;
  --acm-btn-h: 26px;
  --acm-ring-size: 26px;
  --acm-ring-pct-fs: 7.5px;

  font-family: var(--acm-sans);
  font-size: var(--acm-fs-md);
  line-height: 1.45;
  color: var(--acm-ink);
  color-scheme: dark;
  -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
}

:host([data-font-size="compact"]) {
  --acm-fs-xs: 9px;
  --acm-fs-sm: 9.5px;
  --acm-fs-pill: 10px;
  --acm-fs-base: 10.5px;
  --acm-fs-md: 11px;
  --acm-fs-title: 11.5px;
  --acm-fs-lg: 12px;
  --acm-fs-hero: 19px;
  --acm-pill-h: 20px;
  --acm-btn-h: 24px;
  --acm-ring-size: 24px;
  --acm-ring-pct-fs: 7px;
  font-size: var(--acm-fs-md);
}

:host([data-font-size="large"]) {
  --acm-fs-xs: 11.5px;
  --acm-fs-sm: 12px;
  --acm-fs-pill: 12.5px;
  --acm-fs-base: 13px;
  --acm-fs-md: 13.5px;
  --acm-fs-title: 14px;
  --acm-fs-lg: 15px;
  --acm-fs-hero: 25px;
  --acm-pill-h: 26px;
  --acm-btn-h: 30px;
  --acm-ring-size: 28px;
  --acm-ring-pct-fs: 8.5px;
  font-size: var(--acm-fs-md);
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

/* Explicit High-Contrast Dark Mode */
:host([data-contrast="high"]) {
  --acm-bg: #000000;
  --acm-surface: #000000;
  --acm-surface-solid: #000000;
  --acm-well: #0A0D12;
  --acm-hover: #171E29;
  --acm-track: #263040;
  --acm-border: #D0D8E4;
  --acm-border-strong: #FFFFFF;
  --acm-control-border: #FFFFFF;

  --acm-ink: #FFFFFF;
  --acm-ink-secondary: #F0F4FA;
  --acm-ink-muted: #D4DCE8;

  --acm-accent: #7CC4FF;
  --acm-accent-hover: #A6D8FF;
  --acm-accent-ink: #000000;
  --acm-accent-tint: #0A2540;
  --acm-accent-border: #7CC4FF;

  --acm-good: #63F5B5;
  --acm-good-fill: #34D399;
  --acm-good-tint: #072B1C;
  --acm-good-border: #63F5B5;

  --acm-warn: #FFD166;
  --acm-warn-fill: #FBBF24;
  --acm-warn-tint: #332200;
  --acm-warn-border: #FFD166;

  --acm-danger: #FF8585;
  --acm-danger-fill: #F87171;
  --acm-danger-tint: #3A0A0A;
  --acm-danger-border: #FF8585;

  --acm-shadow: 0 0 0 1px #FFFFFF, 0 10px 28px rgba(0, 0, 0, 0.85);
}

/* Explicit High-Contrast Light Mode */
:host([data-theme="light"][data-contrast="high"]) {
  --acm-bg: #FFFFFF;
  --acm-surface: #FFFFFF;
  --acm-surface-solid: #FFFFFF;
  --acm-well: #F5F7FA;
  --acm-hover: #E6ECF5;
  --acm-track: #CBD5E1;
  --acm-border: #111318;
  --acm-border-strong: #000000;
  --acm-control-border: #000000;

  --acm-ink: #000000;
  --acm-ink-secondary: #111318;
  --acm-ink-muted: #222630;

  --acm-accent: #0033CC;
  --acm-accent-hover: #002080;
  --acm-accent-ink: #FFFFFF;
  --acm-accent-tint: #E6EEFF;
  --acm-accent-border: #0033CC;

  --acm-good: #005A32;
  --acm-good-fill: #006D3C;
  --acm-good-tint: #E6F6EE;
  --acm-good-border: #005A32;

  --acm-warn: #7A3E00;
  --acm-warn-fill: #944C00;
  --acm-warn-tint: #FFF3D6;
  --acm-warn-border: #7A3E00;

  --acm-danger: #A6001A;
  --acm-danger-fill: #B8001F;
  --acm-danger-tint: #FFE6EA;
  --acm-danger-border: #A6001A;

  --acm-shadow: 0 0 0 1px #000000, 0 8px 22px rgba(0, 0, 0, 0.24);
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
  height: var(--acm-btn-h);
  padding: 0 9px;
  border-radius: 6px;
  border: 1px solid var(--acm-control-border);
  background: var(--acm-well);
  color: var(--acm-ink);
  font-family: var(--acm-sans);
  font-size: var(--acm-fs-pill);
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
  font-size: var(--acm-fs-sm);
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

.acm-pill-badge.acm-has-tip {
  position: relative;
  cursor: help;
  pointer-events: auto;
}

.acm-pill-badge.acm-has-tip:focus-visible {
  outline: 1.5px solid var(--acm-accent);
  outline-offset: 2px;
}

.acm-pill-badge.acm-has-tip::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  left: auto;
  width: max-content;
  max-width: 268px;
  padding: 5px 8px;
  border-radius: 7px;
  border: 1px solid var(--acm-border-strong);
  background: var(--acm-surface-solid);
  color: var(--acm-ink);
  font-family: var(--acm-sans);
  font-size: 10.5px;
  font-weight: 500;
  line-height: 1.38;
  white-space: normal;
  text-align: left;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.30);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  z-index: 25;
  transition: opacity 120ms var(--acm-ease);
}

.acm-pill-badge.acm-has-tip:hover::after,
.acm-pill-badge.acm-has-tip:focus-visible::after {
  opacity: 1;
  visibility: visible;
}

.acm-compact-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}

.acm-swarm-sec {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.acm-swarm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.acm-swarm-root {
  font-size: var(--acm-fs-sm);
  color: var(--acm-ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.acm-swarm-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.acm-swarm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 7px;
  border-radius: 6px;
  background: var(--acm-well);
  border: 1px solid var(--acm-border);
  font-size: var(--acm-fs-sm);
  min-width: 0;
}

.acm-swarm-row.is-inspected {
  border-color: var(--acm-accent-border);
  background: var(--acm-accent-tint);
}

.acm-swarm-name {
  font-weight: 600;
  color: var(--acm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow-wrap: anywhere;
  min-width: 0;
  flex: 1;
}

.acm-swarm-meta {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.acm-swarm-phase {
  font-size: var(--acm-fs-xs);
  color: var(--acm-ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.acm-swarm-more {
  font-size: var(--acm-fs-xs);
  color: var(--acm-ink-muted);
  text-align: right;
}

.acm-quota-mode-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

@media (prefers-contrast: more) {
  :host {
    --acm-border: #B8C4D4;
    --acm-border-strong: #FFFFFF;
    --acm-control-border: #FFFFFF;
    --acm-ink: #FFFFFF;
    --acm-ink-secondary: #EDF2F9;
    --acm-ink-muted: #CED7E5;
  }
  :host([data-theme="light"]) {
    --acm-border: #1E2430;
    --acm-border-strong: #000000;
    --acm-control-border: #000000;
    --acm-ink: #000000;
    --acm-ink-secondary: #111318;
    --acm-ink-muted: #222630;
  }
}

@media (forced-colors: active) {
  :host {
    forced-color-adjust: auto;
    --acm-bg: Canvas;
    --acm-surface: Canvas;
    --acm-surface-solid: Canvas;
    --acm-well: Canvas;
    --acm-hover: Highlight;
    --acm-track: Canvas;
    --acm-border: ButtonBorder;
    --acm-border-strong: CanvasText;
    --acm-control-border: ButtonText;
    --acm-ink: CanvasText;
    --acm-ink-secondary: CanvasText;
    --acm-ink-muted: GrayText;
    --acm-accent: Highlight;
    --acm-accent-hover: Highlight;
    --acm-accent-ink: HighlightText;
    --acm-accent-border: Highlight;
    --acm-good-fill: Highlight;
    --acm-warn-fill: Highlight;
    --acm-danger-fill: Highlight;
  }
  .acm-popover,
  .acm-quota-popover,
  .acm-overflow-menu,
  .acm-bar-cluster,
  .acm-btn,
  .acm-pill-badge,
  .acm-meter-wrap,
  .acm-qp-meter-wrap,
  .acm-qp-track,
  .acm-swarm-row {
    border: 1px solid CanvasText !important;
    background: Canvas !important;
    color: CanvasText !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  .acm-meter-fill,
  .acm-qp-meter-fill,
  .acm-qp-fill {
    background: Highlight !important;
    forced-color-adjust: none;
  }
  .acm-ring-arc,
  .acm-mini-arc {
    stroke: Highlight !important;
  }
  .acm-ring-track,
  .acm-mini-track {
    stroke: CanvasText !important;
  }
  :focus-visible {
    outline: 2px solid Highlight !important;
    outline-offset: 2px !important;
  }
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
  width: var(--acm-ring-size);
  height: var(--acm-ring-size);
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
  font-size: var(--acm-ring-pct-fs);
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
  font-size: var(--acm-fs-title);
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
  top: -3px;
  bottom: -3px;
  width: 10px;
  transform: translateX(-5px);
  background: transparent;
  pointer-events: auto;
  cursor: help;
  z-index: 2;
}

.acm-watermark-tick::before {
  content: "";
  position: absolute;
  top: 1px;
  bottom: 1px;
  left: 50%;
  width: 2px;
  border-radius: 1px;
  transform: translateX(-1px);
  pointer-events: none;
}

.acm-watermark-tick.is-compaction::before {
  background: var(--acm-warn);
}

.acm-watermark-tick.is-tier200k::before {
  background: var(--acm-ink-muted);
}

.acm-watermark-tick:focus-visible {
  outline: 1.5px solid var(--acm-accent);
  outline-offset: 1px;
  border-radius: 3px;
}

.acm-watermark-tick::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: 280px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--acm-border-strong);
  background: var(--acm-surface-solid);
  color: var(--acm-ink);
  font-family: var(--acm-sans);
  font-size: 10.5px;
  font-weight: 550;
  line-height: 1.3;
  white-space: normal;
  text-align: left;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  z-index: 20;
  transition: opacity 120ms var(--acm-ease);
}

.acm-watermark-tick.is-align-left::after {
  left: 0;
  right: auto;
  transform: none;
}

.acm-watermark-tick.is-align-right::after {
  left: auto;
  right: 0;
  transform: none;
}

.acm-watermark-tick:hover::after,
.acm-watermark-tick:focus-visible::after {
  opacity: 1;
  visibility: visible;
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
  font-size: var(--acm-fs-base);
  color: var(--acm-ink-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.acm-v {
  font-size: var(--acm-fs-base);
  font-weight: 600;
  color: var(--acm-ink);
  white-space: nowrap;
  flex-shrink: 0;
  text-align: right;
}

.acm-v-sub {
  font-size: var(--acm-fs-sm);
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
  height: var(--acm-pill-h);
  padding: 0 7px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--acm-ink);
  font-family: var(--acm-sans);
  font-size: var(--acm-fs-pill);
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
  font-size: var(--acm-fs-lg);
  font-weight: 650;
  letter-spacing: -0.01em;
}

.acm-qp-meta {
  font-size: var(--acm-fs-sm);
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
  font-size: var(--acm-fs-base);
  color: var(--acm-ink-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.acm-v {
  font-size: var(--acm-fs-base);
  font-weight: 600;
  color: var(--acm-ink);
  white-space: nowrap;
  flex-shrink: 0;
  text-align: right;
}

.acm-v-sub {
  font-size: var(--acm-fs-sm);
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
  font-size: var(--acm-fs-hero);
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
  top: -3px;
  bottom: -3px;
  width: 10px;
  transform: translateX(-5px);
  background: transparent;
  pointer-events: auto;
  cursor: help;
  z-index: 2;
}

.acm-qp-watermark-tick::before {
  content: "";
  position: absolute;
  top: 1px;
  bottom: 1px;
  left: 50%;
  width: 2px;
  border-radius: 1px;
  transform: translateX(-1px);
  pointer-events: none;
}

.acm-qp-watermark-tick.is-compaction::before {
  background: var(--acm-warn);
}

.acm-qp-watermark-tick.is-tier200k::before {
  background: var(--acm-ink-muted);
}

.acm-qp-watermark-tick:focus-visible {
  outline: 1.5px solid var(--acm-accent);
  outline-offset: 1px;
  border-radius: 3px;
}

.acm-qp-watermark-tick::after {
  content: attr(data-tooltip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: 280px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--acm-border-strong);
  background: var(--acm-surface-solid);
  color: var(--acm-ink);
  font-family: var(--acm-sans);
  font-size: 10.5px;
  font-weight: 550;
  line-height: 1.3;
  white-space: normal;
  text-align: left;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  z-index: 20;
  transition: opacity 120ms var(--acm-ease);
}

.acm-qp-watermark-tick.is-align-left::after {
  left: 0;
  right: auto;
  transform: none;
}

.acm-qp-watermark-tick.is-align-right::after {
  left: auto;
  right: 0;
  transform: none;
}

.acm-qp-watermark-tick:hover::after,
.acm-qp-watermark-tick:focus-visible::after {
  opacity: 1;
  visibility: visible;
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
 * Deterministic content-hash build identifier combining the independently bundled
 * CDP overlay JS runtime and both Shadow DOM stylesheets so same-version rebuilds
 * cleanly hot-reinject instead of skipping on semver equality.
 */
function computeCdpOverlayBuildId(): string {
    return createHash('sha256')
        .update(CDP_OVERLAY_CLIENT_BUILD_ID + '\n' + getComposerOverlayCss() + '\n' + getTopBarOverlayCss(), 'utf8')
        .digest('hex')
        .slice(0, 16);
}

export const CDP_OVERLAY_BUILD_ID: string = /*#__PURE__*/ computeCdpOverlayBuildId();

/**
 * Build the idempotent Shadow DOM runtime bootstrap script evaluated in the Antigravity Hub page.
 * Consumes the independently typechecked & esbuild-bundled browser client
 * (`src/client/browser/cdp-overlay-main.ts`) and installs `window.__ACM_CDP_OVERLAY_V1__`
 * with `.applyState(payload, toggles)`, `.unmount(slot)`, `.getStatus()`, and `.buildId`.
 *
 * Strictly Trusted-Types safe: uses ZERO `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
 * `document.write`, `eval`, or `new Function`.
 */
export function buildOverlayBootstrapScript(config: CdpOverlayBootstrapConfig = {}): string {
    const scriptVersion = config.scriptVersion || CDP_OVERLAY_SCRIPT_VERSION;
    const buildId = config.buildId || CDP_OVERLAY_BUILD_ID;
    const composerHostId = config.composerHostId || CDP_COMPOSER_HOST_ID;
    const topBarHostId = config.topBarHostId || CDP_TOPBAR_HOST_ID;
    const composerCss = getComposerOverlayCss();
    const topBarCss = getTopBarOverlayCss();

    const runtimeConfig = {
        globalKey: CDP_RUNTIME_GLOBAL_KEY,
        scriptVersion,
        buildId,
        composerHostId,
        topBarHostId,
        composerCss,
        topBarCss,
    };

    return `(function(){${CDP_OVERLAY_CLIENT_BUNDLE};return __ACM_CDP_OVERLAY_FACTORY__.mountCdpOverlayRuntime(${safeJsonForScript(runtimeConfig)});})();`;
}

export interface OverlayUpdateScriptOptions {
    expectedBuildId?: string;
}

/**
 * Build the lightweight incremental state-update expression evaluated via CDP `Runtime.evaluate`.
 */
export function buildOverlayUpdateScript(
    payload: CdpOverlayPayload,
    toggles: CdpOverlayToggles,
    options: OverlayUpdateScriptOptions = {},
): string {
    const buildCheck = options.expectedBuildId
        ? `if (rt.buildId !== ${safeJsonForScript(options.expectedBuildId)}) { return { ok: false, missingRuntime: true, buildIdMismatch: true }; }`
        : '';
    return `(function() {
  var rt = window[${safeJsonForScript(CDP_RUNTIME_GLOBAL_KEY)}];
  if (!rt || typeof rt.applyState !== 'function') { return { ok: false, missingRuntime: true }; }
  ${buildCheck}
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

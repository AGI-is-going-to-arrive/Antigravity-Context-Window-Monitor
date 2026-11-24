---
name: Antigravity Context Window Monitor
description: Modern Editorial Telemetry — a studio-neutral, high-clarity Operate-mode IDE instrument with CJK/Latin typographic discipline and unmistakable semantic telemetry.
colors:
  studio-cobalt-light: "#1D4ED8"
  studio-cobalt-light-hover: "#1E40AF"
  studio-cobalt-dark: "#5B9CF6"
  studio-cobalt-dark-hover: "#7AB2FA"
  studio-cobalt-dark-track: "#3B82F6"
  obsidian-canvas: "#0D1014"
  obsidian-surface: "#14181F"
  obsidian-elevated: "#1B212B"
  obsidian-hover: "#222A36"
  obsidian-track: "#232B38"
  obsidian-border: "#232A35"
  obsidian-border-strong: "#323C4C"
  obsidian-control-border: "#5A687D"
  chalk-ink: "#F2F4F8"
  chalk-secondary: "#B6C0CE"
  chalk-muted: "#8C98A9"
  chalk-on-accent: "#090D12"
  alabaster-canvas: "#FAFBFC"
  studio-paper: "#FFFFFF"
  alabaster-well: "#F2F4F8"
  alabaster-hover: "#E9EEF5"
  alabaster-track: "#E2E7EF"
  alabaster-border: "#E4E8EF"
  alabaster-border-strong: "#C8D0DC"
  alabaster-control-border: "#8792A4"
  carbon-ink: "#111318"
  carbon-secondary: "#454D5B"
  carbon-muted: "#5A6475"
  emerald-dark: "#34D399"
  emerald-dark-fill: "#10B981"
  emerald-light: "#0E7448"
  emerald-light-fill: "#128052"
  amber-dark: "#F5B841"
  amber-dark-fill: "#F59E0B"
  amber-light: "#945605"
  amber-light-fill: "#B46909"
  crimson-dark: "#F87171"
  crimson-dark-fill: "#EF4444"
  crimson-light: "#C02430"
  crimson-light-fill: "#D02B37"
  chart-input-dark: "#6E8BB8"
  chart-output-dark: "#5B9CF6"
  chart-cache-dark: "#34C3A4"
  chart-thinking-dark: "#A78BFA"
  chart-input-light: "#4E6588"
  chart-output-light: "#2563EB"
  chart-cache-light: "#0D7A64"
  chart-thinking-light: "#7C3AED"
typography:
  display:
    fontFamily: '"New York", "Iowan Old Style", "Charter", "Palatino Linotype", Georgia, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif'
    fontSize: "1.5rem"
    fontWeight: 550
    lineHeight: 1.24
    letterSpacing: "-0.02em"
  metric-hero:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans CJK SC", system-ui, sans-serif'
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: "-0.025em"
    fontFeature: '"tnum" 1, "lnum" 1'
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans CJK SC", system-ui, sans-serif'
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.012em"
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans CJK SC", system-ui, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.38
    letterSpacing: "-0.008em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans CJK SC", system-ui, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.54
    letterSpacing: "0em"
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans CJK SC", system-ui, sans-serif'
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
  mono:
    fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace'
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "12px"
  pill: "9999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
components:
  button-primary-light:
    backgroundColor: "{colors.studio-cobalt-light}"
    textColor: "{colors.studio-paper}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
    height: "32px"
  button-primary-dark:
    backgroundColor: "{colors.studio-cobalt-dark}"
    textColor: "{colors.chalk-on-accent}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
    height: "32px"
  button-secondary-light:
    backgroundColor: "{colors.studio-paper}"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
    height: "32px"
  button-secondary-dark:
    backgroundColor: "{colors.obsidian-surface}"
    textColor: "{colors.chalk-ink}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
    height: "32px"
  card-light:
    backgroundColor: "{colors.studio-paper}"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.md}"
    padding: "16px 18px"
  card-dark:
    backgroundColor: "{colors.obsidian-surface}"
    textColor: "{colors.chalk-ink}"
    rounded: "{rounded.md}"
    padding: "16px 18px"
  input-light:
    backgroundColor: "{colors.studio-paper}"
    textColor: "{colors.carbon-ink}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
    height: "32px"
  input-dark:
    backgroundColor: "{colors.obsidian-elevated}"
    textColor: "{colors.chalk-ink}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
    height: "32px"
  segmented-track-light:
    backgroundColor: "{colors.alabaster-well}"
    textColor: "{colors.carbon-muted}"
    rounded: "{rounded.sm}"
    padding: "2px"
  segmented-track-dark:
    backgroundColor: "{colors.obsidian-elevated}"
    textColor: "{colors.chalk-muted}"
    rounded: "{rounded.sm}"
    padding: "2px"
---

# Design System: Antigravity Context Window Monitor

## Overview

**Creative North Star: "The Studio Telemetry Ledger"**

Antigravity Context Window Monitor is an **Operate-mode** IDE telemetry instrument. Its visual system completely replaces the discarded sepia/parchment theme with **Modern Editorial Telemetry**: crisp studio-neutral alabaster in Light mode, deep calibrated obsidian slate in Dark mode, disciplined editorial typographic rhythm, tabular numeric precision, and unmistakable semantic health signaling. It draws its poise from Swiss editorial financial tables and modern developer observability tools — never from dusty newsprint and never from neon gamer dashboards.

Under Operate mode, the interface must disappear into the engineer's coding flow. Every control — tabs, segmented switchers, toggles, inputs, disclosures, and tables — remains immediately recognizable and standard. The visual world enters strictly through four calibrated dimensions: **studio-neutral palette & tonal layering**, **CJK-safe editorial typography with bilingual subordination**, **hairline ledger density**, and one signature move: **the Sticky Hairline Masthead with its 2px Sliding Accent Index paired with Precision Capsule Telemetry Meters**.

**Confirmed Visual Anti-References (Eliminated Completely):**
- Whole-page warm-beige / sepia / parchment yellow tints (`#F6F2E9`, `#EDE8DC`) in Light mode and muddy espresso brown washes (`#1E1B16`, `#2A251E`) in Dark mode.
- Giant heavy bold `Georgia` headings that trigger jagged **Songti SC / SimSun** CJK fallback and overpower telemetry numbers.
- Muddy brown/sienna progress bars, toggles, and active controls (`#8C4A1F`, `#D6986A`).
- Cluttered, equal-weight `English / 中文` bilingual strings with shouting bold slashes, redundant repeated brand names, or literal machine-translated Chinese labels for `tokens`.
- Flat borderless wireframes with zero surface hierarchy, legacy 3px rainbow colored left-border strips, and sluggish or unrefined form controls.

**Key Characteristics:**
- Studio-neutral 4-tier surface hierarchy (`Canvas → Surface → Well → Floating Overlay`) harmonizing cleanly with VS Code / Antigravity Light, Dark, and High-Contrast chrome.
- One authoritative editorial accent (**Studio Cobalt**) paired with crisp semantic health colors (**Emerald**, **Amber**, **Crimson**) — every foreground/background pair verified above WCAG 2.1 AA (`≥ 5.0:1`), primary ink above AAA (`≥ 14.6:1`).
- Zero-Songti CJK/Latin font engineering with structured bilingual subordination that preserves exact DOM `textContent` and accessibility names.
- Tactile, brisk micro-interactions (`150–240ms`), universal keyboard focus rings, strict `prefers-reduced-motion` support, and zero horizontal overflow from `320px` to `1440px`.

---

## Colors

The palette is **Restrained** with crisp studio neutrality, a single cool authoritative ink accent (**Studio Cobalt**), and high-legibility semantic status colors reserved strictly for telemetry health, alerts, and multi-series charts.

### Primary (Interactive Accent)
- **Studio Cobalt (Light)** (`#1D4ED8`, hover `#1E40AF`, on-accent `#FFFFFF`): Active tab underline, primary CTA fill (`Save`), focus rings, interactive links, active switch tracks, and normal progress/tool fills. Contrast `6.47:1` on Alabaster Canvas, `6.70:1` on Studio Paper; white text on accent `6.70:1`.
- **Studio Cobalt (Dark)** (`#5B9CF6`, hover `#7AB2FA`, active switch/bar track `#3B82F6`, on-accent `#090D12`): Dark-mode interactive accent. Contrast `6.84:1` on Obsidian Canvas, `6.38:1` on Obsidian Surface; `#090D12` on `#5B9CF6` is `6.99:1`; `#FFFFFF` toggle thumb on `#3B82F6` is `3.68:1` (`#3B82F6` on `#14181F` is `4.84:1`).

### Semantic Status & Data Series
- **Healthy Emerald** (Light text `#0E7448` / fill `#128052`; Dark text `#34D399` / fill `#10B981`): Healthy quota pools (`≥ 50%`), active live session indicator, enabled feature/capability states, storage ready, saved confirmation. Text contrast `≥ 5.04:1` even on tinted badges; bar fill `≥ 3.99:1` on tracks.
- **Caution Amber** (Light text `#945605` / fill `#B46909`; Dark text `#F5B841` / fill `#F59E0B`): Medium-low quota (`20%–49%`), elevated context pressure (`65%–79%`), partial totals, running status badges, expiry-today alerts. Text contrast `≥ 5.15:1` on tinted badges; bar fill `≥ 3.41:1` on tracks.
- **Critical Crimson** (Light text `#C02430` / fill `#D02B37`; Dark text `#F87171` / fill `#EF4444`): Critical quota (`≤ 20%`), high/overflow context pressure (`≥ 80%`), backend disconnect/errors, destructive actions (`Clear All Calendar History`), missing storage. Text contrast `≥ 5.08:1` on tinted badges; bar fill `≥ 3.79:1` on tracks.
- **4-Series Harmonious Cost Chart Palette** (used exclusively in Cost Distribution stacked bars, legends, and breakdown badges — never muddy brown or olive):
  - **Input (Steel Slate):** Light `#4E6588` (`5.39:1`) / Dark `#6E8BB8` (`5.12:1`)
  - **Output (Studio Cobalt):** Light `#2563EB` (`5.17:1`) / Dark `#5B9CF6` (`6.38:1`)
  - **Cache (Precision Teal):** Light `#0D7A64` (`5.09:1`) / Dark `#34C3A4` (`8.04:1`)
  - **Thinking (Editorial Violet):** Light `#7C3AED` (`5.70:1`) / Dark `#A78BFA` (`6.54:1`)

### Neutral Surfaces & Ink

#### Dark Mode (Default / `body.vscode-dark` / `[data-vscode-theme-kind="vscode-dark"]`)
| Role | Token | Value | Contrast / Usage |
| --- | --- | --- | --- |
| L0 Canvas | `--ed-bg` | `#0D1014` | Root page & masthead backdrop; deep neutral obsidian slate (zero brown cast) |
| L1 Surface | `--ed-surface` | `#14181F` | Primary cards, KPI bands, quota cards, spec cards, settings cards |
| L2 Elevated / Well | `--ed-surface-well` | `#1B212B` | Inset inputs, segmented control tracks, storage path box, code wells, active calendar cells |
| Hover Fill | `--ed-surface-hover` | `#222A36` | Subtle table/ledger row illumination and secondary button hover |
| Meter Track | `--ed-track` | `#232B38` | Unfilled progress/quota bar tracks |
| Hairline Border | `--ed-border` | `#232A35` | Card borders, section dividers, ledger row hairlines |
| Strong Rule | `--ed-border-strong` | `#323C4C` | Masthead bottom rule, popover borders, emphasized separators |
| Control Border | `--ed-control-border` | `#5A687D` | Inputs, selects, secondary buttons, inactive toggle outlines (`3.14:1` on L1) |
| Primary Ink | `--ed-ink` | `#F2F4F8` | Headings, hero metrics, primary labels (`17.32:1` on L0, `16.16:1` on L1) |
| Secondary Ink | `--ed-ink-secondary` | `#B6C0CE` | Descriptions, bilingual companion text, secondary metadata (`9.68:1` on L1) |
| Muted Ink | `--ed-ink-muted` | `#8C98A9` | Axis labels, timestamps, placeholders, inactive tabs (`6.08:1` on L1, `5.53:1` on L2) |

#### Light Mode (`body.vscode-light` / `[data-vscode-theme-kind="vscode-light"]`)
| Role | Token | Value | Contrast / Usage |
| --- | --- | --- | --- |
| L0 Canvas | `--ed-bg` | `#FAFBFC` | Pure cool-neutral studio alabaster canvas (zero sepia/yellow tint) |
| L1 Surface | `--ed-surface` | `#FFFFFF` | Crisp studio-paper cards, elevated KPI strips, active segmented pills |
| L2 Elevated / Well | `--ed-surface-well` | `#F2F4F8` | Segmented tracks, inset wells, code/path boxes, active calendar cells |
| Hover Fill | `--ed-surface-hover` | `#E9EEF5` | Subtle ledger row hover and secondary button hover |
| Meter Track | `--ed-track` | `#E2E7EF` | Unfilled progress/quota bar tracks |
| Hairline Border | `--ed-border` | `#E4E8EF` | Card borders, section rules, ledger row hairlines |
| Strong Rule | `--ed-border-strong` | `#C8D0DC` | Masthead bottom rule, popover borders, emphasized rules |
| Control Border | `--ed-control-border` | `#8792A4` | Inputs, selects, secondary buttons, inactive toggle outlines (`3.14:1` on L1) |
| Primary Ink | `--ed-ink` | `#111318` | Deep carbon ink for headings, hero figures, active text (`17.93:1` on L0, `18.58:1` on L1) |
| Secondary Ink | `--ed-ink-secondary` | `#454D5B` | Descriptions, bilingual companion text, secondary metadata (`8.52:1` on L1) |
| Muted Ink | `--ed-ink-muted` | `#5A6475` | Timestamps, placeholders, quiet captions (`5.81:1` on L1, `5.43:1` on L2) |

#### High-Contrast Themes (`vscode-high-contrast` & `vscode-high-contrast-light`)
Defer directly to native VS Code/OS contrast tokens so accessibility overrides are never defeated:
- `--ed-bg: var(--vscode-editor-background, Canvas)`
- `--ed-surface: var(--vscode-editor-background, Canvas)`
- `--ed-surface-well: var(--vscode-editor-background, Canvas)`
- `--ed-ink: var(--vscode-foreground, CanvasText)`
- `--ed-ink-secondary: var(--vscode-foreground, CanvasText)`
- `--ed-ink-muted: var(--vscode-foreground, CanvasText)`
- `--ed-border`, `--ed-border-strong`, `--ed-control-border`: `var(--vscode-contrastBorder, CanvasText)`
- `--ed-accent: var(--vscode-textLink-foreground, LinkText)`
- `--ed-accent-ink: var(--vscode-editor-background, Canvas)`
- Meters receive explicit `1px solid var(--ed-border)` outlines so fills remain legible without relying on subtle track tint.

### Concrete CSS Custom Property Contract (`src/webview-editorial-styles.ts`)

Implementation workers MUST define this complete token set on `body` (Dark default), override cleanly on `body:is(.vscode-light, [data-vscode-theme-kind="vscode-light"])`, and bridge legacy `--color-*` tokens so older tab stylesheets never leak stale dark/light colors:

```css
body {
  /* Elevation & Surfaces (Dark: Obsidian Slate) */
  --ed-bg: #0D1014;
  --ed-surface: #14181F;
  --ed-surface-well: #1B212B;
  --ed-surface-hover: #222A36;
  --ed-surface-overlay: #181E27;
  --ed-track: #232B38;

  /* Hairlines & Borders */
  --ed-border: #232A35;
  --ed-border-strong: #323C4C;
  --ed-control-border: #5A687D;

  /* Ink Hierarchy */
  --ed-ink: #F2F4F8;
  --ed-ink-secondary: #B6C0CE;
  --ed-ink-muted: #8C98A9;

  /* Primary Accent (Studio Cobalt) */
  --ed-accent: #5B9CF6;
  --ed-accent-hover: #7AB2FA;
  --ed-accent-track: #3B82F6;
  --ed-accent-ink: #090D12;
  --ed-accent-tint: rgba(91, 156, 246, 0.14);
  --ed-accent-border: rgba(91, 156, 246, 0.36);

  /* Semantic Status */
  --ed-good: #34D399;
  --ed-good-fill: #10B981;
  --ed-good-tint: rgba(52, 211, 153, 0.14);
  --ed-good-border: rgba(52, 211, 153, 0.34);

  --ed-warn: #F5B841;
  --ed-warn-fill: #F59E0B;
  --ed-warn-tint: rgba(245, 184, 65, 0.14);
  --ed-warn-border: rgba(245, 184, 65, 0.34);

  --ed-danger: #F87171;
  --ed-danger-fill: #EF4444;
  --ed-danger-tint: rgba(248, 113, 113, 0.14);
  --ed-danger-border: rgba(248, 113, 113, 0.36);

  /* 4-Series Chart Palette */
  --ed-chart-input: #6E8BB8;
  --ed-chart-output: #5B9CF6;
  --ed-chart-cache: #34C3A4;
  --ed-chart-thinking: #A78BFA;

  /* Shadows (L3 Floating Overlays Only) */
  --ed-shadow-popover: 0 12px 32px rgba(0, 0, 0, 0.48), 0 2px 8px rgba(0, 0, 0, 0.32);
  --ed-shadow-tooltip: 0 4px 14px rgba(0, 0, 0, 0.42);
  --ed-shadow-segment: 0 1px 2px rgba(0, 0, 0, 0.35);

  /* Typography */
  --ed-sans-cjk: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif;
  --ed-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", var(--ed-sans-cjk);
  --ed-display-latin: "New York", "Iowan Old Style", "Charter", "Palatino Linotype", Georgia, var(--ed-sans);
  --ed-mono: var(--vscode-editor-font-family, ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace);

  /* Geometry & Layout */
  --ed-radius-xs: 4px;
  --ed-radius-sm: 6px;
  --ed-radius-md: 10px;
  --ed-radius-lg: 12px;
  --ed-radius-pill: 9999px;
  --ed-column: 1120px;
  --ed-gutter: clamp(14px, 2.5vw, 28px);
  --ed-ease: cubic-bezier(0.2, 0, 0, 1);
  --ed-ease-spring: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ed-dur-fast: 150ms;
  --ed-dur-med: 220ms;

  /* Compatibility Aliases (--ed-* legacy tokens checked by existing tests/helpers) */
  --ed-paper: var(--ed-bg);
  --ed-rule: var(--ed-border);
  --ed-rule-strong: var(--ed-border-strong);
  --ed-muted: var(--ed-ink-muted);
  --ed-wash: var(--ed-surface-well);
  --ed-highlight: var(--ed-accent-tint);
  --ed-serif: var(--ed-display-latin);

  /* Legacy Variable Bridge (eliminates stale rgba() / brown leaks in older tab CSS) */
  --color-bg: var(--ed-bg);
  --color-text: var(--ed-ink);
  --color-text-dim: var(--ed-ink-muted);
  --color-muted: var(--ed-ink-muted);
  --color-accent: var(--ed-accent);
  --color-info: var(--ed-accent);
  --color-info-light: var(--ed-accent);
  --color-ok: var(--ed-good);
  --color-ok-light: var(--ed-good);
  --color-warn: var(--ed-warn);
  --color-amber: var(--ed-warn);
  --color-danger: var(--ed-danger);
  --color-danger-light: var(--ed-danger);
  --color-surface: var(--ed-surface);
  --color-surface-dim: var(--ed-surface-well);
  --color-surface-subtle: var(--ed-surface-well);
  --color-surface-raised: var(--ed-surface);
  --color-surface-hover: var(--ed-surface-hover);
  --color-surface-active: var(--ed-accent-tint);
  --color-border: var(--ed-border);
  --color-border-subtle: var(--ed-border);
  --color-border-dim: var(--ed-border);
  --color-border-strong: var(--ed-border-strong);
  --color-border-hover: var(--ed-control-border);
  --color-divider: var(--ed-border);
  --border-color: var(--ed-border);
  --card-bg: var(--ed-surface);

  color-scheme: dark;
}

body:is(.vscode-light, [data-vscode-theme-kind="vscode-light"]) {
  --ed-bg: #FAFBFC;
  --ed-surface: #FFFFFF;
  --ed-surface-well: #F2F4F8;
  --ed-surface-hover: #E9EEF5;
  --ed-surface-overlay: #FFFFFF;
  --ed-track: #E2E7EF;

  --ed-border: #E4E8EF;
  --ed-border-strong: #C8D0DC;
  --ed-control-border: #8792A4;

  --ed-ink: #111318;
  --ed-ink-secondary: #454D5B;
  --ed-ink-muted: #5A6475;

  --ed-accent: #1D4ED8;
  --ed-accent-hover: #1E40AF;
  --ed-accent-track: #1D4ED8;
  --ed-accent-ink: #FFFFFF;
  --ed-accent-tint: rgba(29, 78, 216, 0.10);
  --ed-accent-border: rgba(29, 78, 216, 0.28);

  --ed-good: #0E7448;
  --ed-good-fill: #128052;
  --ed-good-tint: rgba(14, 116, 72, 0.10);
  --ed-good-border: rgba(14, 116, 72, 0.28);

  --ed-warn: #945605;
  --ed-warn-fill: #B46909;
  --ed-warn-tint: rgba(217, 119, 6, 0.12);
  --ed-warn-border: rgba(180, 105, 9, 0.30);

  --ed-danger: #C02430;
  --ed-danger-fill: #D02B37;
  --ed-danger-tint: rgba(220, 38, 38, 0.10);
  --ed-danger-border: rgba(192, 36, 48, 0.30);

  --ed-chart-input: #4E6588;
  --ed-chart-output: #2563EB;
  --ed-chart-cache: #0D7A64;
  --ed-chart-thinking: #7C3AED;

  --ed-shadow-popover: 0 12px 30px rgba(17, 19, 24, 0.12), 0 2px 8px rgba(17, 19, 24, 0.06);
  --ed-shadow-tooltip: 0 4px 12px rgba(17, 19, 24, 0.14);
  --ed-shadow-segment: 0 1px 2px rgba(17, 19, 24, 0.08);

  color-scheme: light;
}
```

### Named Rules
**The Studio Neutrality Rule.** Every neutral canvas, card, well, hairline, and border must stay strictly on the cool-neutral obsidian/alabaster axis. Zero sepia, parchment, cream, khaki, or warm-brown tint is permitted anywhere.

**The One Accent Voice Rule.** Studio Cobalt owns ≤ 10% of any viewport: active navigation, primary buttons, focus rings, interactive links, and non-threshold data bars. Never tint inactive tabs, neutral chrome, or healthy quota bars with brown or arbitrary multi-hue rainbows.

**The Semantic Threshold Rule.** Progress and quota meters always communicate health immediately:
- **Quota remaining meters:** `≥ 50%` → `--ed-good-fill` (Emerald), `20%–49%` → `--ed-warn-fill` (Amber), `≤ 20%` → `--ed-danger-fill` (Crimson). Unknown quota renders an empty track with no invented bar.
- **Context pressure meters:** `< 65%` → `--ed-accent` (Studio Cobalt), `65%–79%` → `--ed-warn-fill` (Amber), `≥ 80%` → `--ed-danger-fill` (Crimson).

---

## Typography

**Display Font (Latin Page Titles Only):** `"New York", "Iowan Old Style", "Charter", "Palatino Linotype", Georgia` — terminating strictly into `var(--ed-sans)` (never generic `serif`).
**UI & CJK Sans Font:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans CJK SC", system-ui, sans-serif`.
**Mono / Code Font:** `var(--vscode-editor-font-family, ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace)`.

**Character:** Editorial poise without nostalgia. Refined optical serifs lend quiet architectural authority exclusively to English display page titles at medium weight (`550`), while every CJK glyph, UI label, tab, card heading, button, and telemetry metric renders in crisp, high-legibility geometric/system sans with strict tabular numerals (`tabular-nums lining-nums`). All font stacks resolve 100% locally offline inside VS Code webviews.

### Hierarchy (Fixed Operate Scale — Base `13px` / `var(--vscode-font-size, 13px)`)
- **Metric Hero** (`650`, `1.75rem` / `28px`, line-height `1.15`, tracking `-0.025em`, `--ed-sans` + `tabular-nums`): Primary numeric readings (`214,500`, `$1.56`, `52%`) — visually louder than page titles so telemetry always wins the first glance.
- **Page Title / Display** (`550` EN / `600` ZH, `1.5rem` / `24px`, line-height `1.24`, tracking `-0.02em`): Top-of-pane page titles only (`.overview-header h2`, `.ed-pane-title`, `.about-hero-title`, `.profile-identity h2`). Compact (`1.3rem`) at `≤ 640px`.
- **Section Headline** (`600`, `0.9375rem` / `15px`, line-height `1.35`, tracking `-0.012em`, `--ed-sans`): Card and ledger section titles (`.card h2`, `.act-section-title`, `.stg-header h2`, `.about-section-title`, `.overview-section-heading`).
- **Card / Row Title** (`600`, `0.875rem` / `14px`, line-height `1.38`, tracking `-0.008em`, `--ed-sans`): Model names, session titles, workspace group headings, profile subsections.
- **Body** (`400`, `0.8125rem` / `13px`, line-height `1.54`, `--ed-sans`): Descriptions, ledger rows, settings explanations. Prose measure capped at `65–72ch`.
- **Label / Metadata** (`500`, `0.75rem` / `12px`, line-height `1.4`, `--ed-sans`): Metric labels, timestamps, reset schedules, table captions. Never use ALL-CAPS micro-text below `11px`.
- **Micro Badge / Code** (`500–600`, `0.6875rem–0.75rem` / `11–12px`, `--ed-sans` for status pills / `--ed-mono` strictly for IDs, paths, and token examples).

### Bilingual Subordination & Language-Scoped Typography

Set `data-lang="${currentLang}"` (`"zh"`, `"en"`, or `"both"`) on `<body>` in `src/webview-panel.ts` (alongside `html[lang]`) so CSS cleanly distinguishes pure Chinese from Bilingual mode.

1. **Structured Bilingual HTML Helper (`tBiHtml(en, zh)` in `src/i18n.ts`):**
   - Keep `tBi(en, zh)` unchanged for plain-text contexts (`aria-label`, `title`, `placeholder`, `<option>`, VS Code status bar & Markdown tooltips, `panel.title`).
   - Add `tBiHtml(en, zh)` for visible HTML headings, tabs, buttons, labels, and copy:
     - In `zh` mode: returns `esc(zh)`.
     - In `en` mode: returns `esc(en)`.
     - In `both` mode: if `en === zh`, returns `esc(en)` (zero duplication); otherwise returns:
       ```html
       <span class="bi-en">Context &amp; quota</span><span class="bi-sep"> / </span><span class="bi-zh">上下文与配额</span>
       ```
   - **Critical Accessibility & Test Preservation:** Because the DOM text nodes remain `"Context & quota"` + `" / "` + `"上下文与配额"`, computed `element.textContent` and screen-reader / `agent-desktop` accessibility names remain identical to `"Context & quota / 上下文与配额"`.
   - **Visual Subordination CSS:**
     ```css
     .bi-sep {
       font-family: var(--ed-sans);
       font-weight: 400;
       font-size: 0.78em;
       color: var(--ed-ink-muted);
       opacity: 0.55;
       margin-inline: 0.05em;
     }
     .bi-zh {
       font-family: var(--ed-sans-cjk);
       font-weight: 450;
       font-size: 0.86em;
       color: var(--ed-ink-secondary);
       letter-spacing: 0;
     }
     /* Display titles: Latin leads in editorial serif; Chinese companion sits poised & crisp in PingFang/YaHei */
     body[data-lang="en"] :is(.overview-header h2, .ed-pane-title, .about-hero-title, .profile-identity h2),
     body[data-lang="both"] :is(.overview-header h2, .ed-pane-title, .about-hero-title, .profile-identity h2) .bi-en {
       font-family: var(--ed-display-latin);
       font-weight: 550;
       letter-spacing: -0.02em;
     }
     body[data-lang="both"] :is(.overview-header h2, .ed-pane-title, .about-hero-title, .profile-identity h2) .bi-zh {
       font-size: 0.70em;
       font-weight: 500;
       color: var(--ed-ink-secondary);
     }
     /* Compact tabs & buttons: keep secondary language subtle so 9 tabs stay scannable */
     .tab-btn .bi-zh,
     .ses-filter-btn .bi-zh,
     .cal-summary-btn .bi-zh {
       font-size: 0.88em;
       font-weight: 450;
       color: var(--ed-ink-muted);
     }
     .tab-btn.active .bi-zh { color: var(--ed-ink-secondary); }
     .prc-btn-primary .bi-sep,
     .prc-btn-primary .bi-zh { color: inherit; opacity: 0.82; }
     ```
2. **Mandatory Idiomatic Copy Cleanups:**
   - Replace literal machine-translated Chinese token labels with idiomatic `"tokens"` (or `"Token"` in prose) across all views and tooltips.
   - Topbar title: render `Antigravity` once in visual hierarchy or subordinate cleanly; avoid jarring equal-weight bold repetition. *(Note: coordinate with `tests/installed-ide-ui.cjs` `languages.both.heading` if shortening the accessible heading string; using `tBiHtml('Antigravity Monitor', 'Antigravity 监控面板')` already subordinates the right half visually while keeping the existing test contract 100% green.)*
   - End-of-content sentinel (`.eoc-sentinel-text`): render clean `tBiHtml('End of content', '已到底')` with horizontal hairline rules drawn purely via `::before` / `::after` — remove literal `—` dashes inside the string so bilingual mode never prints `— End of content — / — 已到底 —`.

### Named Rules
**The Zero-Songti Rule.** Never place generic `serif` at the end of any `font-family` stack. Every Latin display serif stack must terminate directly into `var(--ed-sans)` (PingFang SC / Hiragino Sans GB / Microsoft YaHei UI / Noto Sans CJK SC) so CJK glyphs never fall back to Songti SC or SimSun.

**The Subordinate Bilingual Rule.** In Bilingual mode, the primary language carries full scale and primary ink; the separator (`/`) recedes to 55% muted hairline weight, and the secondary Chinese companion steps down in scale (`0.70–0.88em`) and weight (`450–500`) in `--ed-ink-secondary`/`--ed-ink-muted`.

**The Quiet Title, Loud Telemetry Rule.** Never use kickers/eyebrows above headings, never add decorative section numbers (`01 / 02`), and never set UI labels, buttons, tabs, badges, or numeric data in a display serif. Let the live metrics dominate visual hierarchy.

---

## Layout

- **Reading column & fluid gutters:** Centered single-column container `max-width: min(100%, calc(var(--ed-column) + 2 * var(--ed-gutter)))` (`--ed-column: 1120px`, `--ed-gutter: clamp(14px, 2.5vw, 28px)`).
- **4px Spatial Rhythm:** Tight component internals (`4px`, `8px`, `12px`), card padding (`16px 18px`), grid gaps (`14px–16px`), and clear vertical section cadence (`24px` margin above new sections, `10px–12px` below headings so every heading binds visually to its content).
- **Sticky Two-Row Masthead (`.panel-topbar`):**
  - Flush solid surface (`background: var(--ed-bg)` with `border-bottom: 1px solid var(--ed-border)`, shifting to `--ed-border-strong` on `.scrolled`). Never use unsupported `backdrop-filter` glass blur inside VS Code webviews.
  - **Row 1 (`.topbar-title`, padding `10px 0 8px`):** Left group has compact `15px` bold masthead title + crisp `Account Panel` pill trigger (with active emerald dot when ready). Right group has recessed `中文 | EN | 双语` segmented switcher, icon-only Pause/Resume & Refresh square buttons (`28×28px`), and tabular live clock (`12:06:37`).
  - **Row 2 (`.tab-bar-wrapper`):** Full 9-tab horizontal index with crisp 2px bottom sliding Studio Cobalt underline (`.tab-slider`) and minimal edge scroll arrows that hide cleanly when all tabs fit.
- **Responsive Breakpoints (Zero Horizontal Overflow `320px–1440px`):**
  - **`≥ 960px` (Wide Editor Tab / 1440px):** Overview 2-column (`1.18fr / 1fr`); Settings 2-column grid (Storage card spans full `1 / -1`); Profile 2-column (`1.35fr / 1fr`); Models Quota 2-column & Specs 3-column; About navigation 2-column; GM Data model stats 3–4 columns.
  - **`641px–959px` (Standard Split Pane):** Models Specs 2-column; Profile 2-column above `720px`, stacked below `720px`; Settings single-column below `900px`; Overview stays 2-column down to `680px`.
  - **`320px–640px` (Narrow Sidebar / Split Pane):** All multi-column grids collapse cleanly to 1 column (`minmax(0, 1fr)`); `.topbar-title-left` wraps cleanly above `.header-actions` with zero element overlap; `.ses-toolbar` stacks search over wrapped filter pills; `.cal-grid` maintains strict `repeat(7, minmax(0, 1fr))` with edge-clamped tooltips; `min-width: 0` and `overflow-wrap: anywhere` enforced on every flex/grid child.
- **Browser Surface Polish (Craft Floor):**
  - `::selection { background: var(--ed-accent); color: var(--ed-accent-ink); }`
  - `:is(input, textarea) { caret-color: var(--ed-accent); }`
  - `:is(input, textarea)::placeholder { color: var(--ed-ink-muted); opacity: 1; }`
  - `a { color: var(--ed-accent); text-underline-offset: 0.2em; text-decoration-thickness: 1px; }`
  - Thin 6px themed scrollbar (`--ed-border-strong` thumb, `--ed-ink-muted` on hover; respects `data-hide-scrollbar="true"`).

---

## Elevation & Depth

This system uses **Crisp Tonal Layering + Single Hairline Borders** at rest, reserving soft ambient shadows strictly for floating overlays (`L3`).

- **L0 Canvas (`--ed-bg`):** Base page and sticky masthead ground.
- **L1 Card / Band (`--ed-surface` + `1px solid var(--ed-border)`):** Primary content groupings (Overview context & quota panels, KPI strips, Model quota & spec cards, Profile AI Credits panel, Settings cards, Calendar surface). No box-shadow at rest.
- **L2 Inset Well (`--ed-surface-well` + `1px solid var(--ed-border)`):** Recessed containers inside L1 cards (segmented control tracks, numeric steppers, storage path box, code snippets, active calendar days, table headers). Never nest an L1 card inside an L1 card.
- **L3 Floating Overlay (`--ed-surface-overlay` + `1px solid var(--ed-border-strong)` + ambient shadow):** Only `.acct-popover-dropdown` and `[data-tooltip]::after`.

### Shadow Vocabulary (L3 Floating Overlays & Active Segmented Pill Only)
- **Popover Elevation** (`box-shadow: var(--ed-shadow-popover)`): `.acct-popover-dropdown` when expanded over page content.
- **Tooltip Elevation** (`box-shadow: var(--ed-shadow-tooltip)`): `[data-tooltip]::after` floating callouts.
- **Segmented Pill Lift** (`box-shadow: var(--ed-shadow-segment)`): Subtle 1px lift on the selected button inside a recessed segmented control track.

### Named Rules
**The Single-Boundary Elevation Rule.** Resting cards declare elevation via tonal surface step (`--ed-surface` over `--ed-bg`) plus a crisp `1px solid var(--ed-border)` hairline — never by stacking a border and a drop shadow together ("no ghost cards").

**The No-Rainbow-Stripe Rule.** Eliminate all legacy `border-left: 3px solid ...` decorative strips on `.stg-card::before`, `.about-info-*`, `.dna-row-card`, `.empty-msg`, `.call-card`, `.compress-card`, `.timeline-card`, and `.ses-row.is-current`. Communicate status via clean semantic pill badges, icons, or subtle `--ed-*-tint` background washes.

---

## Shapes

- **Micro / Inline Code & Status Tags (`4px` / `--ed-radius-xs`):** Inline `<code>`, model short IDs, storage tags (`Brain`, `PB`), micro count tags.
- **Interactive Controls (`6px` / `--ed-radius-sm`):** Buttons, inputs, numeric steppers, `<select>`, segmented control tracks (inner active item `4px`), calendar day cells, collapsible summaries.
- **Cards & Sections (`10px` / `--ed-radius-md`):** All L1 cards (`.overview-context`, `.overview-quota`, `.model-card`, `.spec-card`, `.stg-card`, `.profile-identity`, `.profile-ai`, `.cal-detail`, `.ses-group`, `.act-model-card`).
- **Floating Overlays (`12px` / `--ed-radius-lg`):** `.acct-popover-dropdown`.
- **Capsules (`9999px` / `--ed-radius-pill`):** Progress/quota meter tracks & fills (`6px` height), toggle switch tracks (`34×18px`) & thumbs (`14×14px`), status dots (`7–8px`), compact filter/status pills.
- **Iconography Discipline:** Single-weight clean SVG icons (`14px` in controls/headers, `16px` in section/about titles, `stroke-width: 1.65` for stroked SVGs), inheriting `currentColor` (`--ed-ink-muted` at rest, `--ed-accent` or `--ed-ink` in section headers/active states). Zero emoji or raw Unicode arrows standing in for icons.

---

## Components

Every interactive component specifies **default, hover, focus-visible, active, disabled, and semantic states**. Motion stays brisk (`150ms–220ms`, `--ed-ease: cubic-bezier(0.2, 0, 0, 1)`), conveys state only, never delays content visibility on load, and collapses to `none` under `@media (prefers-reduced-motion: reduce)`.

### Navigation & Masthead (`.panel-topbar`, `.tab-bar`, `.tab-slider`)
- **Tabs (`.tab-btn`):** Clean typographic labels (`.tab-btn .icon { display: none; }` keeps all 9 bilingual tabs tight and prevents premature scrollbars), `padding: 9px 11px 10px`, `font-size: 12.5px`, `font-weight: 500`, `color: var(--ed-ink-muted)`, `border-radius: 6px 6px 0 0`.
- **Hover:** `color: var(--ed-ink)`, `background: var(--ed-surface-hover)` (`150ms`).
- **Active (`.tab-btn.active`):** `color: var(--ed-ink)`, `font-weight: 600`; `.tab-slider` sits flush on the bottom border (`height: 2px`, `border-radius: 2px 2px 0 0`, `background: var(--ed-accent)`, `transition: left 200ms var(--ed-ease), width 200ms var(--ed-ease)`).
- **Focus:** `outline: 2px solid var(--ed-accent); outline-offset: -3px;`.
- **Tab Pane Reveal:** Keep instant content availability with a crisp subtle `140ms` opacity fade (`@keyframes edTabIn` `opacity: 0.7 → 1`, disabled under `prefers-reduced-motion`).

### Segmented Controls (`.lang-switcher`, `.cal-summary-toggle`)
- **Track:** `background: var(--ed-surface-well)`, `border: 1px solid var(--ed-border)`, `border-radius: var(--ed-radius-sm)`, `padding: 2px`, `gap: 2px`.
- **Item:** `border: none`, `border-radius: 4px`, `padding: 3px 9px`, `font-size: 11.5px`, `font-weight: 500`, `color: var(--ed-ink-muted)`, `background: transparent`.
- **Hover (inactive):** `color: var(--ed-ink)`, `background: var(--ed-surface-hover)`.
- **Active (`.active`):** `background: var(--ed-surface)`, `color: var(--ed-ink)`, `font-weight: 600`, `box-shadow: var(--ed-shadow-segment)`, `border: 1px solid var(--ed-border)` (subtle crisp lifted pill inside the recessed track).

### Buttons
- **Unified Height & Radius:** `height: 32px` (compact toolbar buttons `28px`), `border-radius: var(--ed-radius-sm)` (`6px`), `font-size: 12.5px`, `font-weight: 550`, `transition: background 150ms, border-color 150ms, color 150ms, transform 100ms`. Active press: `transform: scale(0.98)`.
- **Primary (`.prc-btn-primary`, primary `Save` where appropriate):** `background: var(--ed-accent)`, `color: var(--ed-accent-ink)`, `border: 1px solid transparent`. Hover: `background: var(--ed-accent-hover)`.
- **Secondary (`.action-btn`, `.prc-btn`, `.acct-popover-trigger`, `.cal-nav-btn`, `.about-github-link`):** `background: var(--ed-surface)`, `color: var(--ed-ink)`, `border: 1px solid var(--ed-control-border)`. Hover: `background: var(--ed-surface-hover)`, `border-color: var(--ed-ink-muted)`. Open/Paused active state (`.is-open`, `.paused`): `background: var(--ed-accent-tint)`, `border-color: var(--ed-accent-border)`, `color: var(--ed-accent)`.
- **Inline Link Action (`.overview-action`, `.profile-activity`, `.prc-monthly-calendar-link`):** `background: transparent`, `color: var(--ed-accent)`, `border: 1px solid transparent`, `padding: 5px 8px`, `border-radius: 6px`, `font-weight: 550`. Hover: `background: var(--ed-accent-tint)`, trailing arrow slides `translateX(2px)` (`150ms var(--ed-ease)`).
- **Destructive (`.cal-clear-btn`, `.danger-action`):** `background: transparent`, `color: var(--ed-danger)`, `border: 1px solid var(--ed-danger-border)`. Hover: `background: var(--ed-danger-tint)`, `border-color: var(--ed-danger)`.
- **Disabled:** `opacity: 0.45`, `cursor: not-allowed`, zero hover shift.

### Precision Telemetry Meters (`.overview-meter`, `.quota-bar-wrap`, `.prc-monthly-bar-wrap`, `.cost-bar-track`, `.tool-rank-bar-wrap`, `.telemetry-bar-track`, `.telemetry-cache-bar-track`)
- **Track:** `height: 6px` (`8px` for Cost Distribution 4-segment stacked chart, Prompt Cache 3-segment stacked bar `.telemetry-cache-bar-track`, and Tool Ranking bars), `border-radius: var(--ed-radius-pill)`, `background: var(--ed-track)`, `overflow: hidden`. In High-Contrast modes, `.telemetry-bar-track` and `.telemetry-cache-bar-track` receive a `1px solid var(--ed-border)` outline, and adjacent `.telemetry-cache-seg` segments separate via `border-inline-start: 1px solid var(--ed-bg)`.
- **Fill:** `height: 100%`, `border-radius: var(--ed-radius-pill)`, `transition: width 260ms var(--ed-ease)`, flat solid semantic fill (zero gradients, zero muddy brown).
- **Overview Context Meter States:** Add semantic thresholds cleanly via class or inline state — default (`< 65%`) `var(--ed-accent)`, warning (`65%–79%`, optional `.is-warn`) `var(--ed-warn-fill)`, critical/attention (`≥ 80%`, `.is-attention`) `var(--ed-danger-fill)`.
- **Quota Meter States (`webview-profile-tab.ts` & `webview-overview-tab.ts`):** `≥ 50%` → `var(--ed-good-fill)`, `20%–49%` → `var(--ed-warn-fill)`, `≤ 20%` → `var(--ed-danger-fill)`. *(Note: update `webview-profile-tab.ts` threshold from `< 80` warn to `< 50` warn and `webview-overview-tab.ts` quota meter to carry `.is-healthy` / `.is-warn` / `.is-attention` so a 52% pool reads healthy emerald rather than warning or accent!)*

### Modern Toggle Switches (`.toggle-row`, `.toggle-track`, `.toggle-thumb`)
- **Row:** `display: flex; align-items: center; gap: 12px; padding: 10px 4px; border-bottom: 1px solid var(--ed-border);` (last row border-bottom none). Hover illuminates row gently (`background: var(--ed-surface-hover); border-radius: 6px;`).
- **Track:** `width: 34px; height: 18px; border-radius: 9999px; background: var(--ed-track); border: 1px solid var(--ed-control-border); transition: background 180ms var(--ed-ease), border-color 180ms var(--ed-ease);`.
- **Thumb:** `width: 12px; height: 12px; top: 2px; left: 2px; border-radius: 50%; background: var(--ed-ink-muted); transition: transform 200ms var(--ed-ease-spring), background 180ms var(--ed-ease);`.
- **Checked:** Track `background: var(--ed-accent-track); border-color: transparent;`; Thumb `transform: translateX(16px); background: #FFFFFF;`.
- **Focus:** `outline: 2px solid var(--ed-accent); outline-offset: 2px;`.

### Inputs, Steppers & Selects
- **Text / Number Inputs & Search (`.ses-search-wrap`, `.threshold-input`, `.prc-edit-input`):** `height: 32px`, `background: var(--ed-surface-well)` (Dark) / `var(--ed-surface)` (Light), `border: 1px solid var(--ed-control-border)`, `border-radius: var(--ed-radius-sm)`, `color: var(--ed-ink)`, `font-variant-numeric: tabular-nums`. Focus: `border-color: var(--ed-accent); outline: 2px solid var(--ed-accent); outline-offset: 1px;` (or crisp inner box-shadow + outline).
- **Numeric Stepper (`.num-spinner`):** Unified `32px` height pill-edged group (`border: 1px solid var(--ed-control-border); border-radius: 6px; overflow: hidden; background: var(--ed-surface);`). `−` and `+` buttons `width: 30px; height: 30px; background: var(--ed-surface-well); color: var(--ed-ink);` with hairline side borders and crisp hover (`var(--ed-surface-hover)`). Remove legacy `transform: scale(0.9)` shrink hack in `.billing-day-input-group .num-spinner`.
- **Native Select (`.stg-select-row select`):** `height: 32px; padding: 0 28px 0 10px; border: 1px solid var(--ed-control-border); border-radius: 6px; background-color: var(--ed-surface); color: var(--ed-ink);` with crisp inline data-URI chevron SVG and clean hover/focus states.

### Collapsible Disclosures (`<details>`)
- **Examples:** `.overview-details`, `.profile-technical`, `.model-quota-details`, `.ses-group`, `.act-tl-turn`, `.cal-cycles-details`.
- **Summary Header:** `list-style: none` (hide default `::-webkit-details-marker`), flexbox row with crisp CSS/SVG right-pointing chevron (`transition: transform 160ms var(--ed-ease)` → `rotate(90deg)` when `[open]`), `padding: 9px 10px`, `font-weight: 550`, `color: var(--ed-ink)`, hover `background: var(--ed-surface-hover); border-radius: 6px;`.
- **Body:** Crisp top hairline (`1px solid var(--ed-border)`), `padding: 12px 10px 4px`, smooth subtle fade-in (`160ms`) when opened.

### Status Badges & Filter Pills
- **Semantic Badges (`.ses-badge`, `.storage-path-state`, `.feature-tag`, `.model-tag-badge`, `.cal-chip`, `.acct-plan`):**
  - Compact `padding: 2px 8px; border-radius: var(--ed-radius-pill)` (or `4px` for technical tags), `font-size: 11px; font-weight: 600; line-height: 1.45; border: 1px solid`.
  - Healthy/Enabled/Current: `background: var(--ed-good-tint); color: var(--ed-good); border-color: var(--ed-good-border);`
  - Running/Caution/Partial: `background: var(--ed-warn-tint); color: var(--ed-warn); border-color: var(--ed-warn-border);`
  - Error/Critical/Missing: `background: var(--ed-danger-tint); color: var(--ed-danger); border-color: var(--ed-danger-border);`
  - Workspace/Info/Selected: `background: var(--ed-accent-tint); color: var(--ed-accent); border-color: var(--ed-accent-border);`
  - Neutral/Idle/Disabled: `background: var(--ed-surface-well); color: var(--ed-ink-muted); border-color: var(--ed-border);`

### Selector Hygiene & Precedence Strategy
Because `src/webview-panel.ts` injects base `getStyles()`, per-tab styles, and finally `getEditorialStyles()`, Wave 2 authors MUST:
1. Ensure `getEditorialStyles()` (or cleaned-up base styles) explicitly neutralizes legacy `body.vscode-light` and `[data-vscode-theme-kind="vscode-light"]` rules in `webview-styles.ts`, `webview-about-tab.ts`, `webview-calendar-tab.ts`, `activity-panel.ts`, and `pricing-panel.ts` by qualifying theme overrides with `body:is(.vscode-light, [data-vscode-theme-kind="vscode-light"])` (higher specificity than bare `.vscode-light` or `[data-vscode-theme-kind="vscode-light"]`).
2. Strip hardcoded dark/light `rgba(255,255,255,...)`, `rgba(0,0,0,...)`, `#ea580c`, `#fb923c`, and `backdrop-filter: blur(...)` overrides wherever `--ed-*` tokens apply.
3. Preserve all existing interactive IDs, `data-*` attributes, and ARIA attributes relied upon by `webview-script.ts` and `tests/installed-ide-ui.cjs`.
4. **Harness & Copy Alignment Notes (from QA/Audit):**
   - `tests/installed-ide-ui.cjs` L516 checks `max(R,G,B) - min(R,G,B) <= 5` on `body` background. Light canvas `#FAFBFC` has spread `2` (`R=250, G=251, B=252`); Dark obsidian slate `#0D1014` has cool-neutral spread `7` (`R=13, G=16, B=20`, `R < B`). Update the harness guard to verify cool-neutral / zero-warm-cast surfaces (`max - min <= 12` and `R <= B + 2`) across both canvas and L1 elevated cards in Light and Dark modes, and ensure `browserFixture()` sets both `class="${theme}"` and `data-vscode-theme-kind="${theme}"`.
   - Fix bilingual/a11y regressions flagged in audit during Wave 2: standardize on `tokens` / `Token` everywhere (eliminating literal machine-translated Chinese token labels), add `aria-label` to `webview-settings-tab.ts` spinner buttons (`L102,105,125,128`), fix broken `both` strings in `activity-panel.ts` (`Turn`, `d until expiry`, `Avg Stream` duration label `平均流耗时`), remove embedded `/` separators inside `tBi()` calls in `webview-chat-history-tab.ts`, `webview-models-tab.ts`, and `pricing-panel.ts`, localize `RUNNING`/`FINISHED`/`IDLE` badges in Sessions, fix Calendar empty-month and weekday localization in `both`, and update stale About copy (`80K–256K` → `512K`, Profile description).

---

### Tab-by-Tab Structural Polish Contract (All 9 Tabs)

#### 1. Overview (`src/webview-overview-tab.ts`)
- **Header:** Page title `Context & quota` (`tBiHtml`) + compact right-aligned or inline muted plan pill (`Pro · Google AI Pro`).
- **2-Column Telemetry Grid (`.overview-grid`):** `display: grid; grid-template-columns: minmax(0, 1.18fr) minmax(0, 1fr); gap: 16px;` (stacks to 1 column at `≤ 680px`). Both `.overview-context` and `.overview-quota` sit on crisp L1 cards (`background: var(--ed-surface); border: 1px solid var(--ed-border); border-radius: 10px; padding: 18px 20px;`).
- **Left Column (Active Conversation):** Status dot (`8px` Emerald when `active`, Muted when `idle`/`empty`, Crimson when `disconnected`) + status heading (`Active conversation`); session title in crisp `14px` semibold; muted metadata line (`Orchestrator` or model + `Measured`); optional **Active Orchestrator Route Pill (`.orch-route-pill`)** showing `Planner → Executor` with `[data-cross-pool="true"]` accent pill when the conversation spans `Gemini` and `Claude / GPT`; **Hero Reading** (`214,500` at `28px` bold tabular sans + `/ 512,000 tokens` muted) with right-aligned `41.9%` percentage; `6px` precision meter; quiet `Remaining · 297,500 tokens` caption; compact L2 `.overview-telemetry-strip` (when live GM telemetry exists); hairline collapsible `#overview-session-diagnostics` drawer; trailing `View model activity →` inline action.
- **L2 Inset Telemetry Strip (`.overview-telemetry-strip[data-telemetry-scope="active"|"session"]`):** Recessed L2 well inside `.overview-context` (`background: var(--ed-surface-well); border: 1px solid var(--ed-border); border-radius: var(--ed-radius-sm);` — never a nested L1 card) cleanly omitted when `totalCalls === 0`, disconnected, or no valid readings exist. Displays 4–5 tabular cells (`4-col` or `.has-cost` `5-col` desktop → `2×2` / wrapped at `≤ 640px` and narrow splits, `min-width: 0`):
  - **Speed:** latest or weighted `tok/s` (sub: `resp ...` when thinking, else `avg ...` when latest differs).
  - **TTFT:** adaptive latency (`ms` `< 1s`, `s` `≥ 1s`; sub: `cached ...` else `p50 ...`).
  - **Cache Hit:** token-weighted `%` in `--ed-chart-cache` (`.is-cache`; sub: cached volume + `X/Y` call ratio).
  - **Cache Saved:** USD amount (`<$0.0001` floor, never fake `$0.00`) strictly when priced & `> 0`, else compact `tokens`, else muted `—`; warmth sub-caption (`.overview-telemetry-sub` with `.is-warm` / `.is-warming` / `.is-cold` semantic tones).
  - **Session / Today Cost (`[data-telemetry-cell="cost"]`, optional):** active session USD cost with `Today ...` sub-caption (omitted cleanly when no cost or overflow).
- **Right Column (Quota Remaining):** `Quota remaining` heading; hairline-divided `.overview-quota-row` entries with pool label (`Gemini`, `Claude / GPT`), optional `Planner`/`Executor` role tags when cross-pool, compact model count (`2 models`), and either **Dual-Window Quota Row (`.quota-dual-row` → `5-Hour` + `Weekly` `[data-quota-window]` items)** with floored `99.x%` / `<1%` precision and individual semantic health meters, or graceful 5h-only single meter fallback; quiet model-family summary line; trailing `View models →` action.
- **Footer Band (`.overview-footer`):** Crisp L1 strip or top-ruled footer bar showing `AI credits` + bold value (or explicit muted `Not reported` — never `0`) + expiry note on left, `Status bar settings →` on right.

#### 2. GM Data (`src/activity-panel.ts`)
- **Top KPI Strip (`.act-summary-bar`):** Crisp L1 card (`border: 1px solid var(--ed-border); border-radius: 10px; padding: 12px 16px;`) presenting account-filtered tabular KPI cells (`Calls`, `Input`, `Output`, `Cache`, `Credits`, `Errors`, plus **Speed** `.act-stat-speed`, **Avg TTFT** `.act-stat-ttft`, and token-weighted **Cache Hit** `.act-stat-cache-hit` with muted `.act-stat-sub` call ratio `X/Y`) separated by subtle vertical hairlines and rendering `—` when untimed.
- **Speed & First-Token Cache Ledger (`#telemetryLedgerSection` / `.telemetry-ledger-section`):** Rendered directly below the KPI strip whenever `totalCalls > 0`; 2-column `.telemetry-ledger-grid` (`1fr 1fr`, collapses to 1 column at `≤ 680px`, zero overflow to `320px`) containing two Studio-neutral L1 `.telemetry-ledger-card` surfaces (`--ed-surface`, `1px solid var(--ed-border)`, `--ed-radius-md`, `tabular-nums lining-nums`, zero emoji, zero 3px left stripes):
  - **Left (`.telemetry-card-speed` — Generation Speed & TTFT):** `26px` hero weighted `tok/s` + scope pill (`.telemetry-pill`), L2 `.telemetry-subgrid` (`Latest`, `Median p50`, `Range min–max`, plus `Visible resp` when thinking is present), **Cached vs Uncached TTFT Comparison** (`.telemetry-ttft-block` with proportional `.telemetry-bar-track` capsule bars: `--ed-chart-cache` Cached vs `--ed-chart-input` Uncached, `(n=...)` sample counts, opaque-backed `.telemetry-delta-pill.is-faster`/`.is-neutral`, and honest single-state captions when one bucket has zero samples), and `p50` / `p95` / `Avg Stream` (`平均流耗时`) footer.
  - **Right (`.telemetry-card-cache` — Prompt Cache Efficiency & Savings):** Hero token-weighted `Cache Hit %` (`--ed-chart-cache`) + opaque-backed `.telemetry-warmth-badge` (`.is-warm`/`.is-warming`/`.is-cold`/`.is-unknown`), `8px` 3-segment Precision Capsule Prompt Cache bar (`.telemetry-cache-bar-track`: `--ed-chart-cache` Cache Read | `--ed-chart-input` Fresh Input | `--ed-warn-fill` Cache Write when `> 0`, with matching inline dot legend), and 3-row hairline ledger (`Cache Read` / `Fresh Input` / `Cache Write`, `Call Hit Ratio` + `Reuse %`, and `Est. Cache Savings` showing saved `tokens` + USD savings strictly when priced & `> 0`).
- **Collapsible Recent Calls Ledger (`#recentCallsLedger` / `.recent-calls-card`):** Rendered directly below `#telemetryLedgerSection` when account-filtered calls exist. L1 `<details open>` card housing `.recent-calls-table-wrap` (`tabindex="0" role="region"`, `width: 100%; max-width: 100%; overflow-x: auto;` for keyboard-accessible 320px-safe horizontal scrolling) and `.recent-calls-table` (`min-width: 640px`, `tabular-nums`): `Time`, `Actual Model` (monospace truncated with full tooltip), `Input`, `Output` (`Think %` sub-label), `Cache Hit`, `Cost` (USD or honest `.rc-unpriced` badge), `TTFT`, `Total`, noise-gated `Speed`, and dot-badged `Status` (`OK` Emerald / `Retry ×N` Amber / `Error` Crimson).
- **Model Stats Grid (`.act-cards-grid`):** Crisp L1 `.act-model-card` cards (`border: 1px solid var(--ed-border); border-radius: 10px; overflow: hidden;`) with recessed L2 header (`background: var(--ed-surface-well); padding: 10px 14px; border-bottom: 1px solid var(--ed-border);`) and unified `Calls`-first hairline-aligned rows (`.act-card-row`, subtle hover `var(--ed-surface-hover)`). Includes **Speed** (weighted `tok/s` + stacked `.act-card-sub` `resp ...` when thinking), valid-sample **Avg TTFT** (+ stacked `cached ...` when split exists), token-weighted **Cache Hit** (`% · X/Y`), and **Cache Write** (when `> 0`), with zero duplicate cache badges.
- **Today's Ledger & Settled Ledger:** Consistent L1 cards with semantic account pills and tabular columns.
- **Tool Call Ranking (`.tool-rank-list`):** Crisp L1 card with `8px` Studio Cobalt rounded capsule bars (`background: var(--ed-accent)` on `var(--ed-track)` — zero muddy brown!), monospace tool names, right-aligned bold tabular counts.
- **Context Growth & Conversations (`.act-two-col`):** Crisp L1 cards; SVG trend line uses `stroke: var(--ed-accent)` (`2px`) with soft translucent Cobalt area fill (`var(--ed-accent-tint)`), clean horizontal hairline gridlines, legible axis labels, and wrapping `.act-conv-meta` chips at `≤ 640px`.
- **Timeline / Context Intelligence / Error Details:** Unified collapsible disclosure grammar; eliminate 3px rainbow left stripes on `.cp-card` and `.dna-row-card` in favor of clean tinted semantic category badges. Timeline per-step rows render opaque `--ed-surface` telemetry pills (`.act-tl-gm-speed`, `.act-tl-gm-stream`, `.act-tl-gm-cache-hit`) and per-turn headers render `.seg-chip-speed`, `.seg-chip-ttft`, and `.seg-chip-cache-hit` (all enforcing `.bi-sep`/`.bi-zh { color: inherit }`).

#### 3. Sessions (`src/webview-chat-history-tab.ts`)
- **Header & Metric Shortcuts (`.ses-shortcuts`):** 3 equal-width tactile L1 filter tiles (`Current Workspace`, `<Repo>`, `Backup Ready`) with `14px` icon, label, and right-aligned pill counter (`background: var(--ed-surface-well)`). Hover highlights border to `--ed-accent-border`.
- **Search & Filter Toolbar (`.ses-toolbar`):** Clean `32px` search field (`.ses-search-wrap` using magnifying-glass icon rather than chat bubble if updated, crisp `--ed-control-border`, focus ring) paired with cohesive filter pills (`All`, `Workspace`, `Repo`, `Running`, `Recordable`; active pill in `--ed-accent-tint` + `--ed-accent` text + `--ed-accent-border`).
- **Workspace Groups (`.ses-group`):** L1 collapsible cards (`border: 1px solid var(--ed-border); border-radius: 10px; background: var(--ed-surface);`) with clean header showing workspace name, muted truncated path, and compact right-aligned chips (`Current`, count, `1 run`).
- **Session Rows (`.ses-row`):** Hairline-divided rows inside `.ses-group-body` (`padding: 12px 14px; border-top: 1px solid var(--ed-border);`). Current session row uses subtle `--ed-good-tint` background + crisp Emerald `Current` pill (NO 3px left border!). Compact icon action buttons (`28×28px`, `.ses-act-btn`) cleanly aligned with crisp CSS tooltips and disabled state styling.

#### 4. Cost (`src/pricing-panel.ts`)
- **Upcoming Scheduled Rate-Change Banner (`.rate-change-banner`):** Caution Amber tinted callout (`background: var(--ed-warn-tint); border: 1px solid var(--ed-warn-border); color: var(--ed-warn); display: flex; flex-direction: column; gap: 6px;`) with `.rate-change-banner-head` (clock icon + bold title) stacked cleanly over `.rate-change-banner-list` (e.g., Carbon/Argon `2026-12-01` and Flash 3.6/3.7/3.8 `2027-01-01`).
- **Monthly Cost Hero (`.prc-monthly-grand`):** Crisp L1 banner card (`border: 1px solid var(--ed-border); border-radius: 10px; padding: 16px 20px;`) with `28px` bold tabular USD total (`$1.56`) in `--ed-ink`, crisp Amber `Partial total` pill when incomplete, archived-cycle meta on right, and crisp secondary `View History` button in section header.
- **Monthly Model Bars (`.prc-monthly-card`):** Clean ledger rows inside L1 card with `6px` Studio Cobalt capsule bar, bold right-aligned amount, and clean muted `Cost unavailable` badge for unpriced models.
- **Cost Distribution & Breakdown:** Stacked `10px` rounded bar using the harmonious 4-series chart palette (`--ed-chart-input`, `--ed-chart-output`, `--ed-chart-cache`, `--ed-chart-thinking`), clean matching circle legend dots, compact summary chips (including Emerald `.cost-chip-saved` positive cache savings and thinking cost share `%`), and aligned per-model breakdown rows (`.cost-detail-saved` + `.cost-share-sub`).
- **Custom Pricing Editor (`.prc-edit-section`):** Crisp aligned tabular editor inside L1 card; actively called models subtly tinted (`--ed-accent-tint` badge); unified `32px` tabular numeric inputs; primary Studio Cobalt `Save` + secondary `Reset` buttons + inline emerald/crimson validation status.

#### 5. Models (`src/webview-models-tab.ts`)
- **Live Orchestrator Settings Card (`.orch-settings-card`):** L1 card at the top of Models showing active `Orchestrator Model` and `Executor Model` in recessed L2 `.orch-role-row` tiles, `Default` vs `Custom` (`.orch-role-status.is-custom`) pills, pool chips (`.orch-pool-chip`), wrappable monospace short IDs (`.orch-role-value .spec-short-id { max-width: 100%; overflow-wrap: anywhere; }`), and supported planner/executor family rows (`.orch-families-grid`).
- **Default Model Band:** Single-row crisp L1 banner displaying `Default Model`, bold model name pill, and optional concise tier note.
- **Model Quota Grid (`.model-grid`):** 2-column responsive L1 `.model-card` grid (`grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 14px;`): pool title + optional tag badge on left (with amber `.tag-notice` / `.model-tag-badge.tag-notice` preserved in both Models and Profile via `:not(.tag-notice)`), bold tabular `%` on right, clean merged member list (`.model-quota-members` with muted effort pills `Low · Medium · High · Extra High`), either `.quota-dual-row` (`5-Hour` + `Weekly` dual-window bars) or `6px` single health meter, crisp reset countdown + clock line, and quiet collapsible `Readings by effort` drawer when efforts diverge.
- **Model Info Specifications (`.spec-grid`):** 2–3 column L1 `.spec-card` grid (`minmax(min(100%, 260px), 1fr); gap: 14px;`): crisp model name (`14px` semibold) + muted provider subtitle; hairline-structured `<dl>` metrics with `Compression limit` emphasized as lead figure (`font-weight: 650`), followed by `Checkpoint threshold`, `Model context`, `Max output`, `Thinking`, concise **API Reference Price Row (`.spec-price-row`)** showing USD `In / Out / Cache` per 1M rates or honest `Unpriced` badge (`[data-price-state="unpriced"]`), optional quiet L2 `.spec-orchestration` note, and monospace footer (`modelId` + compact `shortId` pill). Image-generation models rendered in a clearly separated section below.

#### 6. Calendar (`src/webview-calendar-tab.ts`)
- **Usage Summary Card:** Header with `Monthly | All-Time` recessed segmented toggle on right + 5-column KPI band (`Days`, `GM Calls`, `Tokens`, `Cost`, `Credits`) in bold tabular numerals with crisp vertical dividers and `overflow-wrap: anywhere` on `.cal-overview-val` / `.cal-day-total-val` so wide totals never clip at 320px.
- **Interactive Month Grid:** Centered `< Nov 2026 >` stepper with crisp `28×28px` nav buttons; clean weekday header row; 7-column `.cal-grid` (`gap: 4px`):
  - Inactive day: quiet muted date number.
  - Active day (`.has-data`): L2 surface tint (`--ed-surface-well`), primary ink date number, crisp `5px` Studio Cobalt activity dot (`6px` Emerald dot on `.high-activity`).
  - Today (`.today`): crisp `1.5px solid var(--ed-accent)` border + bold numeral.
  - Selected (`.selected`): `--ed-accent-tint` background + `1.5px solid var(--ed-accent)` border.
  - Edge-clamped hover tooltips (`:nth-child(7n+1)` left-aligned, `:nth-child(7n)` right-aligned).
- **Day Detail Drawer (`.cal-detail`):** L1 card with crisp date title, aligned daily total KPIs, harmonized semantic breakdown chips (`.cal-chip-*` mapped to `--ed-*-tint` / `--ed-*-border` / `--ed-*-ink`, including USD `.cal-chip-cost` omitted on non-finite/overflow values, `.cal-chip-speed` for time-weighted archived `avgGenTokPerSec`, adaptive `avgTTFT`, and token-weighted `tokenCacheHitRate` with legacy `cacheHitRate` fallback), and collapsible archived cycles.
- **Clear History Action:** Quiet centered destructive outline button (`--ed-danger`) with generous top breathing room, without an oversized empty card box.

#### 7. Profile (`src/webview-profile-tab.ts`) — Complete New CSS Contract
The refactored `webview-profile-tab.ts` styles all sections under the Studio Telemetry Ledger system (with zero legacy Prompt/Flow quota UI):

- **`.profile-page`:** `display: flex; flex-direction: column; gap: 20px; padding-top: 6px;`
- **`.profile-identity`:** L1 card (`display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px 16px; padding: 18px 20px; background: var(--ed-surface); border: 1px solid var(--ed-border); border-radius: var(--ed-radius-md);`).
  - `h2`: Page title (`20px–24px`, editorial display in EN/Both, clean sans in ZH), `margin-bottom: 6px`.
  - `.account-info`: `display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin-bottom: 8px;` — `.account-name` `font-weight: 600; font-size: 14px; color: var(--ed-ink);`, `.account-email` `font-family: var(--ed-mono); font-size: 12px; color: var(--ed-ink-muted);`.
  - `.profile-plan-name`: Inline compact pill (`display: inline-flex; padding: 2px 9px; border-radius: 9999px; background: var(--ed-accent-tint); color: var(--ed-accent); border: 1px solid var(--ed-accent-border); font-size: 11.5px; font-weight: 600;`).
  - `.privacy-btn`: Tactile secondary toggle button (`display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px; border-radius: 6px; border: 1px solid var(--ed-control-border); background: var(--ed-surface-well); color: var(--ed-ink-secondary); font-size: 12px; font-weight: 550; cursor: pointer;`). When masked (`[aria-pressed="true"]` / `.active`): `background: var(--ed-good-tint); border-color: var(--ed-good-border); color: var(--ed-good);`.
- **`.profile-body-grid`:** `display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 16px; align-items: start;` (stacks to 1 column at `≤ 720px`).
- **`.profile-quota` & `.profile-ai`:** Both L1 cards (`background: var(--ed-surface); border: 1px solid var(--ed-border); border-radius: var(--ed-radius-md); padding: 18px 20px; min-width: 0;`). Inside `.profile-quota`, flatten nested `.card.model-quota-section`, hide duplicate `<h2>`, support `.quota-dual-row` (`5-Hour` + `Weekly`), and scope `.model-tag-badge:not(.tag-notice)` so amber `.tag-notice` sunset tags retain `--ed-warn-tint`.
- **`.profile-section-header`:** `display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--ed-border);` with `h2` (`15px`, `font-weight: 600`, `margin: 0`).
- **`.profile-activity`:** Crisp inline action link (`display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 550; color: var(--ed-accent); text-decoration: none; padding: 4px 8px; border-radius: 6px;`), hover `background: var(--ed-accent-tint)`.
- **`.profile-credit-balances` & `.profile-credit-balance`:** `<dl>` ledger with `padding: 12px 14px; background: var(--ed-surface-well); border: 1px solid var(--ed-border); border-radius: 8px; margin-bottom: 16px;`; `<dt>` muted label (`12px`), `<dd class="gai-value">` bold tabular reading (`22px` when numeric, `14px` muted medium when `Not reported`).
- **`.billing-day-label`, `.billing-day-input-group`, `.profile-expiry`:** Clean form block inside `.profile-ai`: `12.5px` semibold label, `32px` `.num-spinner` + crisp `Save` button, muted `12px` `.profile-expiry` helper line, and emerald/crimson `.threshold-feedback` status message.
- **`.profile-technical` (`<details id="profile-plan-details">`):** Clean collapsible L1 disclosure card (`background: var(--ed-surface); border: 1px solid var(--ed-border); border-radius: var(--ed-radius-md);`) with crisp chevron summary (`Plan limits and capabilities`), expanding `.profile-technical-body` (`padding: 16px 20px; border-top: 1px solid var(--ed-border); display: flex; flex-direction: column; gap: 18px;`) holding flat hairline-divided `.profile-metric-grid` (6 plan limit stats) and `.profile-two-col` (Feature Flags + Team Config crisp pill grids — no nested cards!).

#### 8. Settings (`src/webview-settings-tab.ts`)
- **Responsive 2-Column Grid (`≥ 900px`):** `.stg-card` items arranged cleanly in `grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start;`, with `.stg-card[data-accent="storage"]` and `.eoc-sentinel` spanning `grid-column: 1 / -1`. Single column at `< 900px`.
- **Unified L1 Card Grammar:** Every `.stg-card` uses `background: var(--ed-surface); border: 1px solid var(--ed-border); border-radius: 10px; padding: 18px 20px; margin: 0;` — **completely removing** legacy 3px rainbow `::before` left bars! `.stg-header-icon` renders cleanly as a `28×28px` L2 well (`background: var(--ed-surface-well); border-radius: 6px; color: var(--ed-accent);`).
- **Storage Diagnostics Card:** Monospace `.storage-path-box` well with crisp Emerald `Ready` / Crimson `Missing` pill, secondary `Copy Path` / `Open File` / `Reveal` action buttons, and clean 2-col stat counters.
- **Toggles, Steppers, Select & Zoom:** Consistent `32px` control height, crisp `34×18px` Studio Cobalt switches with inline monospace example pills (`45k/1M`, `85%`, `4h32m`, `14,701`, plus opt-in default-off `#toggleSpeed` `64 tok/s`, `#toggleCacheHit` `Cache 84%`, and `#toggleSessionCost` `$0.27` USD), styled Hover density `<select>`, crisp `80%–130%` zoom preset pills (active pill in Studio Cobalt tint) + smooth accent range slider.

#### 9. About (`src/webview-about-tab.ts`)
- **Colophon Reading Column:** Clean left-aligned editorial layout (`max-width: 820px`) with generous breathing room.
- **Hero Header:** Page title `Antigravity Context Window Monitor`, dynamic manifest version pill (`v1.17.7`), readable subtitle (`65ch` measure), crisp platform chips (**Antigravity IDE** and **Antigravity App (Desktop 2.0+ Sidecar)** both active in `--ed-accent-tint` + `--ed-accent` border/text; `SDK`, `CLI` quiet muted border — zero orange!), and concise dual-host scope note.
- **Version & Updates Strip (`#aboutUpdatesSection`, `.about-updates-card`):** L1 card directly below hero displaying current version, last-checked timestamp, status pill (`.is-uptodate` / `.is-update` / `.is-error`), **Check for Updates**, surface-specific primary action (**Upgrade Now** on App when newer release is found; **Open VSX** link on IDE), and compact **AGENTS.md** one-sentence AI agent install/upgrade tip.
- **Feature Navigation (`.about-cards`):** 2-column responsive grid (`repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 10px;`) of clickable L1 navigation cards with `16px` crisp monochrome/accent SVG icon, bold tab title, 2-line muted description, and right-aligned hover chevron that glides smoothly (`translateX(2px)`).
- **Info Panels (`Open Source`, `Acknowledgments`, `Tips`, `Compatibility`, `Disclaimer`, `Language`):** Clean L1 cards (`border: 1px solid var(--ed-border); border-radius: 10px; padding: 14px 16px;`) — **no 3px colored left strips** and **no pulsing heart or twinkling star animations**. `Disclaimer` uses crisp Crimson header icon + bold warning lead; `Compatibility` highlights `v1.17.7` dual-host verification clearly (alongside the full Gemini 4 `512K` context-window note); `Open Source` features a crisp secondary `GitHub Repository ↗` button; `Acknowledgments` credits open-source community design inspirations (including `Lumidarin/agy-capsule` and `evenluo/agy-pulse`).

#### 10. Status Bar Hover Tooltip (`src/statusbar.ts`, `src/tooltip-budget.ts`)
- **Priority-Tiered Studio Ledger in Native Markdown:** Built from ordered `HoverSection[]` blocks (`P0`–`P5`) separated by crisp `---` rules and bounded by zoom-aware visual line budgets (`compact` ≤ 14 lines, `auto`/`normal` ≤ 22 lines, `full` ≤ 32 lines, tightening under positive `window.zoomLevel`).
- **Protected `P0` Contract:** `Hero` (account plan, active title/steps, cross-pool `Orchestrator` route, Unicode capsule context gauge `▰▱`) and `Quota remaining` (`5h | Weekly` table with `Planner`/`Executor` role tags and graceful 5h-only fallback) are `P0` with `compactLines` fallbacks so `Quota remaining` never drops in `compact` or zoomed modes; the 1-click footer (`Overview · Activity · Cost · Models · Settings · Refresh`) stays pinned at bottom via `pinBottom: true` with strict `MarkdownString.isTrusted` command allowlisting.
- **Information-Dense GFM Micro-Tables (`P1`/`P3`/`P4`):** `P1` presents the 4-column `Metric | Session | Today / Ratio | Detail` ledger (Cost + positive Cache Savings, Prompt Cache + `Eff. In`, Speed/TTFT + Cached vs Uncached comparison, optional `Orchestrator Split`); `P3` renders the Latest Call micro-table (including 0-token failed/retried calls); `P4` emits event-driven alerts (upcoming rate changes, sunset `Notice`, `Retry Waste`, AI credits) only when active. All dynamic strings are escaped and CRLF-normalized so tables and emphasis never break.

---

## Dual-Surface Architecture & v1.17.5–v1.17.7 Telemetry Extensions

### Shared Pure Webview Document (`src/webview-document.ts`) & App Sidecar (`src/app/`)
- **Single source of HTML truth:** `buildMonitorDocumentHtml()` and `buildMonitorTabsPayload()` compile and render all 9 Studio Telemetry Ledger views plus `#nativeHudHost` (`tabs.nativeHud`) with **zero `vscode` runtime imports**, serving both `src/webview-panel.ts` (Antigravity IDE VS Code Webview) and `src/app/sidecar-runtime.ts` (Antigravity App Desktop 2.0+ native Sidecar plugin) without divergent markup or fallback stubs. Every rendered document includes `<title>${esc(tBi('Antigravity Monitor', 'Antigravity 监控面板'))}</title>` in `<head>` for WCAG 2.1 Level A `document-title` compliance.
- **App Sidecar Runtime & HTTP Bridge (`src/app/sidecar-runtime.ts`, `src/app/sidecar-server.ts`, `src/app/host-bridge.ts`):** Serves `AUX_PANE` (`/`), full-width `SIDEBAR` (`/full`), `/api/health`, ETag-diffed `/api/snapshot`, `/api/action`, loopback-authenticated `POST /api/overlay/action`, and static `/assets/images/*.png` on loopback HTTP (via Antigravity's `sidecar_sdk` `SidecarApp` or standalone `127.0.0.1` mode). `host-bridge.ts` installs `window.__ACM_BRIDGE__`, polyfills `acquireVsCodeApi` onto `/api/action` (including browser-triggered CSV/JSON file downloads), dynamically tracks `window.sidecar.conversationId`, deduplicates incremental DOM patching per poll, and runs visibility-gated ETag polling (pausing cleanly when `document.hidden === true`).
- **Host Theme Adapter (`src/app/theme-adapter.ts`):** Bridges Antigravity App host CSS variables (`--background`, `--card`, `--foreground`, `--muted-foreground`, `--border`, `--primary`, `--destructive`, `--warning`) pushed via `/preload.js` `theme-change` events onto `--vscode-*` and `--ed-*` tokens under `body[data-acm-surface="app-sidecar"]` and `body[data-acm-theme="dark"|"light"|"hc"|"hc-light"]`. Explicitly overrides Antigravity `/preload.js` inline `body.style` `#fafafa`/`#333` fallbacks so Dark and High-Contrast WCAG contrast is never broken. High-contrast light (`hc-light`) enforces WCAG-verified contrast overrides (`#005A32`, `#7A4F01`, `#B5200D` on `#FFFFFF`). Narrow `AUX_PANE` (`300px–500px`) wraps `.stg-header` / `.stg-status-pill` cleanly without horizontal overflow.
- **IDE-Only Settings Affordance (`.stg-card.is-ide-only`):** Inside Antigravity App, IDE status-bar toggles are tucked inside a collapsed `<details>` disclosure with an accessible `.stg-ide-only-badge` (`var(--ed-ink-secondary)` + `var(--ed-border-strong)`) and dim only `.toggle-track` (`opacity: 0.55`) — never reducing card-level opacity so label text remains above WCAG AA contrast in all 4 themes.

### Masthead Context Bar (`.masthead-context-bar`)
- Compact secondary bar integrated cleanly into `.panel-topbar` (`padding: 3px … 5px`, control height `26px`, aligned cleanly with `SIDEBAR` at `≥ 900px` and stacking cleanly at `≤ 640px`):
  - **Conversation Switcher (`#conversationSwitcher`):** `<select>` listing `Follow Active` plus workspace-prioritized trajectories with `[Running · Subagent · Main · Workspace]` metadata; preserves `#lockMainBtn` and `#staleBadge` live updates even while `<select>` holds focus.
  - **Lock to Main Agent (`#lockMainBtn`):** Tactile toggle (`aria-pressed`, active `.is-locked` Studio Cobalt tint) ignoring background subagent bursts to keep the main conversation pinned.
  - **Surface & Stale Badges (`.surface-badge`, `#staleBadge`):** Compact pill badges declaring `Antigravity App` vs `Antigravity IDE` and surfacing `Cached / Stale` with last-updated clock time when local RPC fallback is active.

### Context Composition Breakdown, 20×5 Dot Matrix & Editorial Category Tokens
- **Editorial Context Category Tokens (`src/webview-editorial-styles.ts`):** Calibrated separately for Dark (`Obsidian Slate`) and Light (`Alabaster Studio`) themes, bridged cleanly in High-Contrast modes (`--ctx-cat-system` `#6E8BB8`/`#47628A`, `--ctx-cat-rules-skills` `#8B7CF6`/`#6D28D9`, `--ctx-cat-plugins-mcp` `#2DD4BF`/`#0F766E`, `--ctx-cat-subagents` `#F472B6`/`#BE185D`, `--ctx-cat-user` `#5B9CF6`/`#1D4ED8`, `--ctx-cat-assistant` `#A78BFA`/`#7C3AED`, `--ctx-cat-tools` `#F5B841`/`#B45309`, `--ctx-cat-media` `#34D399`/`#047857`, `--ctx-cat-other` `#8C98A9`/`#5A6475`, `--ctx-cat-free` `var(--ed-track)`).
- **Component Grammar (`.ctx-breakdown-card`):** Header with `.ctx-measure-badge` (`is-measured`, `is-compacted`, `is-rewind`, `is-awaiting`) and Bar ↔ 20×5 Dot Matrix toggle; **Dual-Cap Row** contrasting Effective Budget vs Native Ceiling; semantic interactive `<ul class="ctx-legend"><li class="ctx-legend-row"><button class="ctx-legend-item">` cross-highlighting `[data-ctx-cat]`; collapsible **Top 5 Largest Items** (`#overview-largest-items`); and one-click **Copy `/context` Report** / **Copy Handoff Prompt**.

### Turn Diagnostics, Quota Runway & Resilient State Banners
- **Turn Diagnostics (`src/turn-diagnostics.ts`, `src/activity-panel.ts`):** Last-Turn vs Session Cache Hit comparison, semantic start pills (`.turn-start-pill.is-cold` / `.is-partial` / `.is-warm`), and signed net context delta cells (`.rc-delta-pos`, `.rc-delta-neg`, `.rc-delta-compaction`) in GM Data's Recent Calls Ledger.
- **Quota Burn-Rate Runway (`src/quota-runway.ts`):** Compact `.quota-runway-pill` rows beneath pool meters (`is-safe` Emerald, `is-risk` Amber, `is-exhausted` Crimson, `is-muted` Neutral) showing `%/h` burn rates and estimated exhaustion time.
- **Stale-Safe & Custom-Model Banners:** `.stale-data-banner` (Amber tint + static status dot + last-updated timestamp) preserves prior telemetry during transient RPC drops; `.custom-model-banner` + collapsible `.custom-model-pools-collapse` cleanly isolates `custom-*` / BYOK / local models.

### Native Ambient HUD & Opt-In CDP Ambient Overlays (v1.17.6–v1.17.7)
- **Zero-CDP Native Ambient HUD (`#nativeHudHost`, `src/webview-document.ts`):** Compact collapsible bar at the top of the monitor panel (default enabled on `app-sidecar`, toggleable on both surfaces via `showNativeHudBar`), preserving client expanded state across live incremental snapshot patches and surfacing context %, dual watermarks, tightest quota pool, `Short sample`-guarded speed, and session cost with zero extra launch flags.
- **Strictly Opt-In CDP Ambient Overlays (`src/app/cdp-injector.ts`, `src/app/cdp-overlay-assets.ts`):** Both toggles (`appComposerRingEnabled`, `appTopBarEnabled`) default to `false` with zero CDP probing while off, immediate per-slot unmount on toggle-off, live Settings diagnostics (`#cdpStatusPill`, bilingual `#cdpDiagnosticHint`, `#cdpRecheckBtn`), and quiet `cdp_unavailable` degradation with a Quit-first cross-platform launch guide. Styled inside closed/isolated **Shadow DOM** hosts using pure DOM construction (zero `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval`, 100% compliant with `require-trusted-types-for 'script'; trusted-types 'none'`) following Studio Telemetry Ledger Dark/Light color grammar:
  - **Composer Context Ring (`Turbo`-left):** Compact SVG ring anchoring to the visible `.agy-composer-footer` / `[data-testid="input-box-bottom-toolbar"]` / `[data-testid="permissions-selector-trigger"]` (automatically re-anchoring across tab switches); hovering or clicking pins a `344px`-wide frosted-glass Usage Card (`max-height: calc(100vh - 24px); overflow-y: auto`) with clean single-column `label (left) ... value (right)` `.acm-kv-grid` rows (`flex-shrink: 0` values, zero label truncation), dual context watermarks, `Short sample` speed guard, Cache Hit, USD + local currency (deduplicated when USD), and bottom quick-action pill (`CDP_OVERLAY_SCRIPT_VERSION = '1.17.7-r1'`).
  - **Top-Right Status Bar + Model Quota Board:** Anchored cleanly before `[data-testid="toggle-maximize-pane"]` without duplicating `[data-testid="window-controls-reserve"]` WCO spacers in inline mode; carries tightest quota ring, context ring, speed / `Short sample` badge, cumulative recorded tokens (including CLI), adaptive narrow-titlebar `···` overflow collapse, and click-to-open Model Quota Board popover communicating over the authenticated 256-bit `X-Monitor-Token` loopback bridge (with direct `[data-testid="toggle-aux-sidebar"]` expansion for `Open Panel`).

### 52-Week Activity Heatmap Calendar & Multi-Source Controls (v1.17.6)
- **Calendar Telemetry Dashboard (`src/webview-calendar-tab.ts`):** Built exclusively on `--ed-*` Studio Telemetry Ledger tokens across Dark, Light, High-Contrast, `320px` narrow viewports, and `prefers-reduced-motion`:
  - **4-Card KPI Header:** `Total`, `Today [Live]` (non-destructively merged from `DailyLedger`), `This Month`, `This Year` — all displaying true additive tokens (`input + cacheRead + cacheCreation + output`) and multi-currency cost estimates.
  - **Source, Metric, Period & View Controls:** Source pills (`All / App / IDE / CLI`), Metric toggle (`Tokens / API Cost`), 5 Period tabs (`Daily / Weekly / Monthly / This Year / All-Time`), View switch (`52-Week Heatmap` ↔ `Month Grid`), and one-click `CSV` / `JSON` export buttons.
  - **5-Level Heatmap & Visualizations:** DST-safe UTC 52-week heatmap grid, Weekly/Monthly/Year bar charts, All-Time proportional cumulative strip + peak callouts, Range Summary Footer (Calendar Daily Avg, Active Day Avg, Streak, dual currency & optional Plan ROI with non-billing disclaimer), Day Detail Drawer (token breakdown, model proportions, source badges, archived speed/TTFT/cache, collapsible cycles), and safe **2-step Clear History** confirmation bar (`#clearCalendarBtn` → `#calClearConfirmBar`).

### Orchestrator Pricing Modes, Role Attribution & Dual Context Watermarks (v1.17.6)
- **Orchestrator Pricing Mode Switcher (`src/pricing-panel.ts`, `src/webview-settings-tab.ts`):** Segmented control toggling **Mapped Base Pricing (Default)** vs **Strict Mode** (`#orchPricingModeMapped` / `#orchPricingModeStrict`), with mapped placeholders keeping untouched Save free of fake custom overrides and Models' Orchestrator Settings card displaying effective per-1M rates (`编排模型` / `执行模型`).
- **Role Attribution & Telemetry Guards (`src/orchestrator-attribution.ts`, `src/webview-overview-tab.ts`, `src/activity-panel.ts`):** Auto-hiding **Orchestrator Split** cards (`#overviewOrchestratorSplitCard` in Overview, `#orchestratorSplitCard` in GM Data), `Orchestrator / Executor / Subagent` role badges, `Switch Cold` (`cacheRead === 0`) pills, `Short sample` speed guards, dual context watermarks (`.overview-watermark-tick` `aria-hidden="true"` for **Compaction** cap and **200k** tier), App-side **Low-Quota Warning Banner**, and interactive jargon tooltips.

### Concurrent Persistence (`DurableState`) & Verified WCAG 2.1 AA Matrix
- **Hardened Atomic Lockfile `DurableState` (`src/durable-state.ts`):** Wraps read-merge-write-rename cycles on shared `state-v1.json` in a cross-platform exclusive `O_CREAT | O_EXCL` lockfile (`state-v1.json.lock`, `0o600` POSIX mode, dead-PID stale reclamation via atomic rename-then-unlink, owner-token verified release, strict refusal to bypass live writers on timeout, Windows NTFS `EPERM`/`EACCES`/`EBUSY` retry), 3-way deep merge (`DEEP_MERGE_OBJECT_KEYS` including `appSettings`), and bidirectional App ↔ IDE hot sync (`syncFromDurableStateIfChanged()` + `async deactivate()` awaiting flush).
- **Verified Accessibility & E2E Matrix (v1.17.6):**
  - **App Sidecar Chromium Layout & Full-Document axe-core WCAG 2.1 AA:** **432/432 layout cells PASS** (0 horizontal overflows across `320px`/`420px`/`1024px`/`1440px` × `dark`/`light`/`hc`/`hc-light` × `en`/`zh`/`both` × all 9 tabs) and **332/332 axe-core WCAG 2.1 AA audits PASS with 0 violations** (including 44 `/preload.js` inline-style override audits across all 4 themes and 24 post-fix `#tab-settings` audits).
  - **Real Chromium CDP Shadow DOM under Strict Trusted Types CSP:** **16/16 PASS** with `require-trusted-types-for 'script'; trusted-types 'none'`, 0 CSP/Trusted-Types/console/page errors, and authenticated 256-bit bridge verification.
  - **Installed IDE Chromium UI Matrix (`tests/installed-ide-ui.cjs`):** **742/742 PASS** with 0 failures, 0 axe-core WCAG 2.1 AA violations, and 0 WCAG 1.4.11 non-text contrast failures.

---

## Do's and Don'ts

### Do:
- **Do** use the exact Studio Neutral palette (`#0D1014`/`#14181F`/`#1B212B` Dark; `#FAFBFC`/`#FFFFFF`/`#F2F4F8` Light) and verify `≥ 4.5:1` text contrast (`≥ 3.0:1` non-text) across both themes and High-Contrast modes.
- **Do** terminate every Latin display serif stack directly into `var(--ed-sans)` (`PingFang SC`, `Hiragino Sans GB`, `Microsoft YaHei UI`, `Noto Sans CJK SC`) so CJK glyphs always render in razor-sharp sans.
- **Do** use `tBiHtml()` with `.bi-en` / `.bi-sep` / `.bi-zh` subordination on visible HTML headings, tabs, labels, and actions while keeping `tBi()` for plain-text attributes and tooltips.
- **Do** apply `font-variant-numeric: tabular-nums lining-nums` to every token count, percentage, USD cost, latency, date, and countdown so live 5-second refreshes never jitter.
- **Do** color quota and context meters strictly by semantic health threshold (Emerald / Amber / Crimson / Studio Cobalt) and leave unknown readings visually empty with explicit text labels (`Not reported` / `Unknown`).
- **Do** keep every interactive control accessible via keyboard with `outline: 2px solid var(--ed-accent); outline-offset: 2px;` on `:focus-visible`, and disable transitions under `@media (prefers-reduced-motion: reduce)`.
- **Do** enforce `min-width: 0` on all flex/grid items and verify zero horizontal overflow across all 9 tabs from `320px` to `1440px` in `zh`, `en`, and `both`.

### Don't:
- **Don't** apply sepia, parchment, cream, warm-beige, or muddy-brown hues to any background, card, divider, progress bar, or toggle track.
- **Don't** place generic `serif` at the end of a display font stack, and never use bold `700+` Georgia or Songti SC / SimSun on headings.
- **Don't** render giant equal-weight `English / 中文` slashes, use literal machine-translated Chinese labels for `tokens`, or wrap end-of-content text in literal `—` dashes.
- **Don't** stack both a drop shadow and a border on resting cards ("ghost cards"), nest L1 cards inside L1 cards, or reintroduce 3px rainbow `border-left` strips.
- **Don't** use `backdrop-filter: blur(...)` in VS Code webviews (unsupported/inconsistent) or load external web fonts/CDN scripts (violates offline CSP).
- **Don't** display legacy `Prompt` or `Flow` quota bars, or fabricate `0` for unreported AI credits or unpriced models.
- **Don't** add decorative animations (pulsing hearts, twinkling stars, staggered page-load choreography) to an Operate-mode telemetry tool.

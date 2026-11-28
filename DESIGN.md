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

### Tab-by-Tab Structural Polish Contract (v1.18.0 5 Primary Tabs + Topbar `⚙️`/`ⓘ`)

The six primary tabs are Overview, Model Calls, Sessions, Usage & Cost, Models & Quotas, and Settings. About opens from the top bar. All **18 historical tab IDs and deep-link aliases** (`overview`, `gm`, `gmdata`, `gm-data`, `activity`, `sessions`, `chats`, `chat-history`, `usage`, `cost`, `pricing`, `calendar`, `models`, `profile`, `account`, `accounts`, `settings`, `about`) resolve cleanly to their canonical tab and anchor slot (`#slot-gm`, `#slot-activity`, `#slot-sessions`, `#slot-calendar`, `#slot-pricing`, `#slot-models`, `#slot-profile`).

#### 1. Overview (`overview` — `src/webview-overview-tab.ts`)
- **Header & Pinned Worker Inspection Banner:** Page title `Context & quota` (`tBiHtml`) + compact plan pill; when inspecting a Swarm/subagent worker (`inspectedMemberId`), a high-visibility pinned inspection banner identifies the inspected worker while keeping `lockedRootId` intact and offering a 1-click **Back to Main** action.
- **Summary grid** (`.overview-grid`) places context and quota in equal-width columns and stacks them on narrow panels. Telemetry and member tracking use the width below both cards.
- **Active conversation** shows the session, model, context usage and selected limit. Expand the context breakdown to inspect categories. Below the summary, member details open in place. A member with accessible telemetry can be opened in Overview and the return control restores the previous inspection context.
- **Right Column (Quota Remaining):** `Quota remaining` heading with active horizon (`5h`/`7d`/`tightest`) and direction (`remaining`/`used`) indicators; hairline-divided `.overview-quota-row` entries with dual-window meters, rolling runway / weekly active-hours badges, and trailing `View models →` action.
- **AI credits:** The overview shows the reported balance and reminder. When account information is available, “Set credits expiry day” opens Models & Quotas and focuses the current account’s monthly reminder input.

#### 2. Model Calls (`gm` — `src/activity-panel.ts`, slots `#slot-gm` + `#slot-activity`)
- **Top KPI Strip (`.act-summary-bar`) & Anomaly Filter Bar:** Tabular KPI cells (`Calls`, `Input`, `Output`, `Cache`, `Credits`, `Errors`, Decode/E2E **Speed**, **Avg TTFT**, token-weighted **Cache Hit**) paired with one-click anomaly filter chips (`Slow TTFT`, `Cache Miss`, `High Cost`, `High Context`, `Errors/Retries`).
- **Speed & First-Token Cache Ledger (`#telemetryLedgerSection`):** 2-column L1 cards collapsing cleanly at `≤ 680px`:
  - **Left (`.telemetry-card-speed`):** Decode vs Model-Call E2E (`output / (TTFT + streaming)`) toggle, ratio-of-sums weighted speed with sample coverage (`X/Y calls`), Cached vs Uncached TTFT comparison bars, and `waiting` / `short sample` / `missing` / `0` edge-state fidelity.
  - **Right (`.telemetry-card-cache`):** Provider-measured `Cache Hit %` + warmth badge (`Warm`/`Partial`/`Cold`), separate **Local 5-Minute Idle TTL Heuristic** (`180s` warn / `300s` expire, suspend/clock-reversal guards) + possible miss-cause explanations, 3-segment capsule bar, and 10-currency estimated cache savings.
- **Recent Calls Ledger (`#recentCallsLedger`), Model Stats Grid, Tool Call Ranking, Context Growth & Activity Timeline:** Keyboard-focusable scroll wrap (`tabindex="0"`), role badges (`Orchestrator`/`Executor`/`Subagent`), `+Δ` context deltas, unified `Calls`-first model cards, Studio Cobalt tool bars, and collapsible timeline disclosures.

#### 3. Sessions (`sessions` — `src/webview-chat-history-tab.ts`, slot `#slot-sessions`)
- **Header Shortcuts, Search/Filter Toolbar & Swarm Hierarchy:** 3 equal-width filter tiles, `32px` search + filter pills (`All`, `Workspace`, `Repo`, `Running`, `Recordable`), workspace-grouped L1 cards displaying Coordinator → Worker/Subagent relationships, and positive registered-workspace OS Reveal buttons (disabled actions wrapped in `.rich-tip-disabled-wrap`).

#### 4. Usage & Cost (`calendar` — `src/webview-calendar-tab.ts` + `src/pricing-panel.ts`, slots `#slot-calendar` + `#slot-pricing`)
- **Multi-Source Activity Heatmap & Workspace Leaderboard (`#slot-calendar`):** 400-day (`30–3650`) multi-source (`All / App / IDE / CLI`) 52-week Heatmap ↔ Month Grid, 5 period views, **Workspace Leaderboard** built from ingestion-time attribution (legacy/ambiguous calls honestly under `Unattributed`), Swarm direct vs deduplicated inclusive group cost summary, collapsible **Advanced Subscription Plan ROI** (clearly labeled as API-equivalent reference ratio, not actual billing), unified **Markdown / CSV / JSON** exports (empty selection exports empty, CSV formula neutralization), Day Detail Drawer, and 2-step Clear History confirmation bar.
- **API Reference Pricing & Custom Rates (`#slot-pricing`):** Orchestrator pricing mode switcher (`Mapped Base` vs `Strict`), upcoming scheduled rate-change banner (`2026-12-01` Carbon/Argon, `2027-01-01` Flash), 10-currency totals (`USD/CNY/EUR/JPY/GBP/KRW/HKD/TWD/CAD/AUD`, unambiguous symbols, sum-before-round), 4-series harmonious cost chart, and aligned custom per-1M pricing editor.

#### 5. Models & Quotas (`models` — `src/webview-models-tab.ts` + `src/webview-profile-tab.ts`, slots `#slot-models` + `#slot-profile`)
- **Models & Dual-Window Quotas (`#slot-models`):** Live **Orchestrator Settings** card, default model band, responsive 2-column `.model-grid` with `5h`/`7d`/`tightest` + `remaining`/`used` display, rolling 45m runway & persistent **Weekly Active-Hours Forecast** (`Insufficient history` when below minimum coverage), amber `.tag-notice` sunset tags, zero-day unknown-model adaptive spec cards, and separate image-model catalog.
- **Account & Credits (`#slot-profile`):** Default-on full-chain privacy-masked identity card (opaque handles when masked; re-render on reveal; evict revealed DOM on re-mask), shared quota summary, AI credits balance + per-account monthly expiry day, and collapsible plan limits / feature flags / team config.

#### 6. Settings (`settings` — `src/webview-settings-tab.ts`)
- **5-Group Responsive 2-Column Layout (`≥ 900px`):**
  1. **Display & Language (`display-language`):** `languagePreference` (`auto`/`en`/`zh`/`both`, per-view `<=480px` narrow compact note), split `appShowNativeHudBar` (`true`) / `ideShowNativeHudBar` (`false`) + `nativeHudAutoHideOnOverview`, zoom, scrollbar, and end-of-content toggles.
  2. **Telemetry & Metrics (`telemetry-metrics`):** Context percentage basis (`compaction`/`native`), speed mode (`decode`/`e2e`), quota window (`5h`/`7d`/`tightest`) & direction (`remaining`/`used`), polling interval, low-quota threshold, internal model IDs, activity caps, and collapsed IDE-only status bar toggles on App.
  3. **Currency & Pricing (`currency-pricing`):** Orchestrator pricing mode, **10 currencies** (incl. `CAD`), currency-bound `customFxRate`, Subscription Plan ROI preset & fee, and Calendar retention days.
  4. **Overlays & CDP (`overlays-cdp`):** Strictly opt-in Composer Ring & Top-Right Status Bar toggles, font-size (`compact`/`normal`/`large`) & high-contrast presets, `#cdpStatusPill`, bilingual diagnostics, 1-click Persistent CDP Launcher setup/reveal/remove (macOS `Cancel` default), **Recheck CDP**, and copyable race-free launch commands.
  5. **Data, Backup & Diagnostics (`data-backup-diagnostics`):** Shared `state-v1.json` diagnostics, allowlisted Settings JSON Backup/Import (excluding credentials, release metadata, paths, grants, and session IDs), and redacted diagnostic bundle export.

#### 7. Topbar Utility — About (`about` — `src/webview-about-tab.ts`)
- Links to the Version & updates card at the top of Settings. About includes supported platform badges (**Antigravity IDE**, **Antigravity App Sidecar**, **CLI logs + opt-in `agy-statusline.mjs`**, `SDK` unsupported), six tab navigation links, objective **Architecture & Technical Boundaries** box (zero absolutist legal claims), MIT repository link, and community acknowledgments.

#### 8. Status Bar Hover Tooltip (`src/statusbar.ts`, `src/tooltip-budget.ts`)
- Priority-tiered (`P0`–`P5`) Studio Ledger in native Markdown with zoom-aware line budgets, 10-currency (incl. `CAD`) status bar & hover readouts, protected `Hero` + `Quota remaining` `P0` sections, and pinned 1-click command footer.

---

## Dual-Surface Architecture & v1.18.0 Telemetry Extensions

### Shared Pure Core (`src/core/*`), Independent Browser Bundles & App Sidecar (`src/app/`)
- **Single HTML & observation truth:** `src/webview-document.ts` renders the 5-tab + topbar `⚙️`/`ⓘ` Studio Telemetry Ledger with zero `vscode` imports, fed by `PublishedMonitorObservation` (`src/core/context-display.ts`) and 10-currency formatting (`src/core/currency.ts`). Client scripts are built independently via `src/client/*` + `tsconfig.client.json` + `esbuild` with 16-hex `buildId` content hashes, strict `preload → bridge → client` ordering, and zero `Function.prototype.toString()` stitching.
- **Authenticated App Sidecar (`SEC-01/02/04`):** Serves `AUX_PANE` (`/`), `SIDEBAR` (`/full`), `/api/health`, bodyless `304` `/api/snapshot` (SDK `200 { unchanged: true }`), `/api/action`, one-time private `/api/auth/pair` (inert unpaired Standalone shell), and per-target Origin-bound `POST /api/overlay/action`. Full-chain privacy redaction strips sensitive identity/path fields prior to serialization; OS Reveal authorizes only registered host workspace roots.
- **Host Theme Adapter (`src/app/theme-adapter.ts`):** Bridges Antigravity App CSS variables onto `--vscode-*` / `--ed-*` tokens across `dark`, `light`, `hc`, and `hc-light` while overriding `/preload.js` inline fallbacks.

### Masthead Context Bar & 3-Field Per-Window Lock (`.masthead-context-bar`)
- Houses Conversation Switcher (`#conversationSwitcher`), **Lock to Main Agent** (`#lockMainBtn` anchored synchronously to `lockedRootId` independent of `inspectedMemberId`), surface badge, and `Cached / Stale` pill.

### Unified Adaptive Rich Popover Engine (`#acmRichTipPopover`)
- Single body-level `position: fixed; z-index: 950` popover scaling with CSS `zoom` (`80%–150%`), auto-flipping vertically, clamping to `320px` `AUX_PANE`, keeping hover tooltips non-interactive while supporting pinned non-modal popovers (`role="dialog" aria-modal="false"`, keyboard entry/Tab exit/`Esc` dismissal returning focus to surviving triggers), and re-anchoring cleanly across 5-second incremental updates.

### Native Ambient HUD & Opt-In CDP Ambient Overlays (D3, D4)
- **Split Native Ambient HUD (`#nativeHudHost`):** Independently toggled for App (`appShowNativeHudBar: true`) and IDE (`ideShowNativeHudBar: false`), auto-hiding cleanly on the Overview tab (`nativeHudAutoHideOnOverview: true`) with an option to always show.
- **Strictly Opt-In CDP Overlays (`src/app/cdp-injector.ts`, `src/client/browser/cdp-overlay-main.ts`):** Both toggles default `OFF` (zero probes when off). Trusted-Types-safe Shadow DOM (`popover="manual"` Top Layer), unified `PublishedMonitorObservation` parity, split-pane `?focused=`/`%2B` parsing + `mousedown` `e.preventDefault()` focus preservation, narrow `MutationObserver` skipping streaming body reflows, `250ms` hover-intent / `350ms` sibling switch, `compact`/`normal`/`large` font sizes + high-contrast mode, 18-tab `openPanel` allowlist, per-target Origin-bound credentials, `2.5s` `no_hub_target` Dock self-heal, and 3-platform zero-patch persistent launchers (macOS `Cancel` default).

### Concurrent Persistence (`DurableState`) & Packaging Hygiene (D6, D8)
- Exclusive `O_CREAT | O_EXCL` lockfile + 3-way merge + committed flush receipts + idempotent late-day archival merges keep App and IDE hot-synced on `state-v1.json`.
- `DESIGN.md` and `PRODUCT.md` stay excluded from IDE VSIX packages via `.vscodeignore`; crisp `256×256` `assets/icon.png` replaces retired `src/images/monitor-*.png` screenshots.

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

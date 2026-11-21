/**
 * "The Studio Telemetry Ledger" — Modern Editorial Telemetry master stylesheet.
 * Loaded after base and per-tab styles so studio-neutral surfaces, Zero-Songti
 * CJK/Latin typography, bilingual subordination, semantic meters, and crisp
 * controls apply uniformly across all 9 tabs and Light / Dark / High-Contrast themes.
 */
export function getEditorialStyles(): string {
    return `
        /* ═══ 1. Studio Telemetry Ledger Tokens ═══ */
        body {
            /* Elevation & Surfaces (Dark: Obsidian Slate) */
            --ed-bg: #0D1014;
            --ed-surface: #14181F;
            --ed-surface-well: #1B212B;
            --ed-surface-hover: #222A36;
            --ed-surface-overlay: #181E27;
            --ed-input-bg: #1B212B;
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

            /* Shadows (L3 Floating Overlays & Active Segmented Pill Only) */
            --ed-shadow-popover: 0 12px 32px rgba(0, 0, 0, 0.48), 0 2px 8px rgba(0, 0, 0, 0.32);
            --ed-shadow-tooltip: 0 4px 14px rgba(0, 0, 0, 0.42);
            --ed-shadow-segment: 0 1px 2px rgba(0, 0, 0, 0.35);

            /* Typography (Zero-Songti CJK/Latin Discipline — NEVER generic serif) */
            --ed-sans-cjk: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif;
            --ed-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", var(--ed-sans-cjk);
            --ed-display-latin: "New York", "Iowan Old Style", "Charter", "Palatino Linotype", Georgia, var(--ed-sans);
            --ed-mono: var(--vscode-editor-font-family, ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace);

            /* Geometry & Motion */
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

            /* Compatibility Aliases (--ed-* tokens referenced by tests & helpers) */
            --ed-paper: var(--ed-bg);
            --ed-rule: var(--ed-border);
            --ed-rule-strong: var(--ed-border-strong);
            --ed-muted: var(--ed-ink-muted);
            --ed-wash: var(--ed-surface-well);
            --ed-highlight: var(--ed-accent-tint);
            --ed-serif: var(--ed-display-latin);
            --ed-control-radius: var(--ed-radius-sm);

            /* Legacy Variable Bridge (eliminates ALL dark/light/warm leaks in tab CSS) */
            --color-bg: var(--ed-bg);
            --color-text: var(--ed-ink);
            --color-text-dim: var(--ed-ink-muted);
            --color-muted: var(--ed-ink-muted);
            --color-accent: var(--ed-accent);
            --color-info: var(--ed-accent);
            --color-info-light: var(--ed-accent);
            --color-info-bg: var(--ed-accent-tint);
            --color-info-bg-dim: var(--ed-accent-tint);
            --color-info-border: var(--ed-accent-border);
            --color-info-border-dim: var(--ed-accent-border);
            --color-info-strong: var(--ed-accent);
            --color-ok: var(--ed-good);
            --color-ok-light: var(--ed-good);
            --color-ok-dim: var(--ed-good-fill);
            --color-ok-bg: var(--ed-good-tint);
            --color-ok-bg-dim: var(--ed-good-tint);
            --color-ok-border: var(--ed-good-border);
            --color-ok-border-dim: var(--ed-good-border);
            --color-warn: var(--ed-warn);
            --color-warn-border: var(--ed-warn-border);
            --color-amber: var(--ed-warn);
            --color-amber-light: var(--ed-warn);
            --color-amber-dim: var(--ed-warn-fill);
            --color-amber-bg: var(--ed-warn-tint);
            --color-amber-bg-dim: var(--ed-warn-tint);
            --color-amber-border: var(--ed-warn-border);
            --color-amber-border-dim: var(--ed-warn-border);
            --color-danger: var(--ed-danger);
            --color-danger-light: var(--ed-danger);
            --color-danger-bg: var(--ed-danger-tint);
            --color-danger-bg-dim: var(--ed-danger-tint);
            --color-danger-bg-hover: var(--ed-danger-tint);
            --color-danger-border: var(--ed-danger-border);
            --color-danger-border-dim: var(--ed-danger-border);
            --color-danger-border-strong: var(--ed-danger-border);
            --color-teal: var(--ed-chart-cache);
            --color-teal-light: var(--ed-chart-cache);
            --color-teal-bg: var(--ed-accent-tint);
            --color-teal-border: var(--ed-accent-border);
            --color-purple: var(--ed-chart-thinking);
            --color-purple-strong: var(--ed-chart-thinking);
            --color-purple-bg: var(--ed-accent-tint);
            --color-purple-border: var(--ed-accent-border);
            --color-orange: var(--ed-warn);
            --color-orange-strong: var(--ed-warn);
            --color-orange-light: var(--ed-warn);
            --color-orange-bg: var(--ed-warn-tint);
            --color-orange-border: var(--ed-warn-border);
            --color-cyan: var(--ed-chart-cache);
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
            --color-divider-subtle: var(--ed-border);
            --color-muted-bg: var(--ed-surface-well);
            --color-muted-border: var(--ed-border);
            --color-muted-border-strong: var(--ed-border-strong);
            --color-neutral-border: var(--ed-border);
            --color-neutral-border-strong: var(--ed-border-strong);
            --border-color: var(--ed-border);
            --card-bg: var(--ed-surface);
            --font-mono: var(--ed-mono);

            color-scheme: dark;
            background: var(--ed-bg);
            color: var(--ed-ink);
            padding: 0;
            min-height: 100vh;
            font-family: var(--ed-sans);
            font-size: var(--vscode-font-size, 13px);
            line-height: 1.54;
            font-variant-numeric: tabular-nums lining-nums;
            accent-color: var(--ed-accent);
        }

        /* Light Mode: Alabaster Studio */
        body:is(.vscode-light, [data-vscode-theme-kind="vscode-light"]) {
            --ed-bg: #FAFBFC;
            --ed-surface: #FFFFFF;
            --ed-surface-well: #F2F4F8;
            --ed-surface-hover: #E9EEF5;
            --ed-surface-overlay: #FFFFFF;
            --ed-input-bg: #FFFFFF;
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

        /* High-Contrast Themes (Dark & Light): native VS Code / OS contrast pass-through */
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"]) {
            --ed-bg: var(--vscode-editor-background, Canvas);
            --ed-surface: var(--vscode-editor-background, Canvas);
            --ed-surface-well: var(--vscode-editor-background, Canvas);
            --ed-surface-hover: var(--vscode-list-hoverBackground, Canvas);
            --ed-surface-overlay: var(--vscode-editor-background, Canvas);
            --ed-input-bg: var(--vscode-editor-background, Canvas);
            --ed-track: var(--vscode-editor-background, Canvas);

            --ed-border: var(--vscode-contrastBorder, CanvasText);
            --ed-border-strong: var(--vscode-contrastBorder, CanvasText);
            --ed-control-border: var(--vscode-contrastBorder, CanvasText);

            --ed-ink: var(--vscode-foreground, CanvasText);
            --ed-ink-secondary: var(--vscode-foreground, CanvasText);
            --ed-ink-muted: var(--vscode-foreground, CanvasText);

            --ed-accent: var(--vscode-textLink-foreground, LinkText);
            --ed-accent-hover: var(--vscode-textLink-foreground, LinkText);
            --ed-accent-track: var(--vscode-textLink-foreground, LinkText);
            --ed-accent-ink: var(--vscode-editor-background, Canvas);
            --ed-accent-tint: var(--vscode-list-hoverBackground, Canvas);
            --ed-accent-border: var(--vscode-contrastBorder, CanvasText);

            --ed-good: var(--vscode-foreground, CanvasText);
            --ed-good-fill: var(--vscode-textLink-foreground, LinkText);
            --ed-good-tint: var(--vscode-editor-background, Canvas);
            --ed-good-border: var(--vscode-contrastBorder, CanvasText);

            --ed-warn: var(--vscode-editorWarning-foreground, CanvasText);
            --ed-warn-fill: var(--vscode-editorWarning-foreground, CanvasText);
            --ed-warn-tint: var(--vscode-editor-background, Canvas);
            --ed-warn-border: var(--vscode-contrastBorder, CanvasText);

            --ed-danger: var(--vscode-errorForeground, CanvasText);
            --ed-danger-fill: var(--vscode-errorForeground, CanvasText);
            --ed-danger-tint: var(--vscode-editor-background, Canvas);
            --ed-danger-border: var(--vscode-contrastBorder, CanvasText);

            --ed-chart-input: var(--ed-ink);
            --ed-chart-output: var(--ed-accent);
            --ed-chart-cache: var(--ed-ink);
            --ed-chart-thinking: var(--ed-accent);

            --ed-shadow-popover: none;
            --ed-shadow-tooltip: none;
            --ed-shadow-segment: none;
        }
        body:is(.vscode-high-contrast-light, [data-vscode-theme-kind="vscode-high-contrast-light"]) {
            color-scheme: light;
        }
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"])
            :is(.overview-meter, .quota-bar-wrap, .prc-monthly-bar-wrap, .cost-bar-track, .tool-rank-bar-wrap, .acct-quota-bar, .gm-cache-bar-bg, .telemetry-bar-track, .telemetry-cache-bar-track) {
            outline: 1px solid var(--ed-border);
        }
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"])
            .telemetry-cache-seg + .telemetry-cache-seg {
            border-inline-start: 1px solid var(--ed-bg);
        }
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"])
            .toggle-cb:checked + .toggle-track {
            border-color: var(--ed-border);
        }
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"])
            .toggle-cb:checked + .toggle-track .toggle-thumb {
            background: var(--ed-accent-ink);
        }

        /* ═══ 2. Browser Surface Craft Floor ═══ */
        body ::selection {
            background: var(--ed-accent);
            color: var(--ed-accent-ink);
        }
        body :is(input, textarea) { caret-color: var(--ed-accent); }
        body :is(input, textarea)::placeholder { color: var(--ed-ink-muted); opacity: 1; }
        body a {
            color: var(--ed-accent);
            text-underline-offset: 0.2em;
            text-decoration-thickness: 1px;
        }
        body ::-webkit-scrollbar-thumb { background: var(--ed-border-strong); border-radius: 9999px; }
        body ::-webkit-scrollbar-thumb:hover { background: var(--ed-ink-muted); }

        /* ═══ 3. Bilingual Subordination & Display Typography ═══ */
        body .bi-sep {
            font-family: var(--ed-sans);
            font-weight: 400;
            font-size: 0.78em;
            color: var(--ed-ink-muted);
            white-space: pre;
            margin-inline: 0.04em;
        }
        body .bi-zh {
            font-family: var(--ed-sans-cjk);
            font-weight: 450;
            font-size: 0.86em;
            color: var(--ed-ink-secondary);
            letter-spacing: 0;
        }

        /* Top-of-pane Page Titles */
        body .tab-pane :is(.overview-header h2, .ed-pane-title, .about-hero-title, .profile-identity h2) {
            color: var(--ed-ink);
            font-family: var(--ed-sans);
            font-size: 1.5rem;
            font-weight: 600;
            line-height: 1.24;
            letter-spacing: -0.02em;
            text-transform: none;
        }
        body[data-lang="en"] .tab-pane :is(.overview-header h2, .ed-pane-title, .about-hero-title, .profile-identity h2),
        body[data-lang="both"] .tab-pane :is(.overview-header h2, .ed-pane-title, .about-hero-title, .profile-identity h2) .bi-en {
            font-family: var(--ed-display-latin);
            font-weight: 550;
            letter-spacing: -0.02em;
        }
        body[data-lang="both"] .tab-pane :is(.overview-header h2, .ed-pane-title, .about-hero-title, .profile-identity h2) .bi-zh {
            font-size: 0.70em;
            font-weight: 500;
            color: var(--ed-ink-secondary);
        }

        /* Compact tabs & segmented controls */
        body :is(.tab-btn, .ses-filter-btn, .cal-summary-btn, .lang-btn) .bi-zh {
            font-size: 0.88em;
            font-weight: 450;
            color: var(--ed-ink-muted);
        }
        body :is(.tab-btn.active, .lang-btn.active, .cal-summary-btn.active) .bi-zh {
            color: var(--ed-ink-secondary);
        }

        /* Colored/tinted surfaces: secondary text inherits surface hue (never gray, always >= 5:1) */
        body :is(
            .prc-btn-primary,
            .privacy-btn.active,
            .privacy-btn[aria-pressed="true"],
            .ses-filter-btn.is-active,
            .ses-badge,
            .ses-group-chip,
            .storage-path-state,
            .feature-tag.enabled,
            .overview-action,
            .profile-activity,
            .prc-monthly-calendar-link,
            .cal-clear-btn,
            .danger-action,
            .acct-popover-trigger.is-open,
            .panel-topbar .action-btn.paused,
            .paused-indicator,
            .model-tag-badge,
            .profile-plan-name,
            .badge,
            .cal-chip,
            .acct-expiry-chip.is-today,
            .acct-plan-pro,
            .acct-plan-ultra,
            .acct-plan-team,
            .act-stat-warn,
            .overview-telemetry-sub.is-warm,
            .overview-telemetry-sub.is-warming,
            .overview-telemetry-sub.is-cold,
            .telemetry-warmth-badge,
            .telemetry-delta-pill,
            .telemetry-pill,
            .act-card-sub,
            .act-tl-gm-speed,
            .act-tl-gm-stream,
            .act-tl-gm-cache-hit,
            .seg-chip-speed,
            .seg-chip-ttft,
            .seg-chip-cache-hit,
            .prc-monthly-grand-label.is-partial,
            .prc-info-bar.prc-info-warn,
            .cost-chip-total.is-partial,
            .rate-change-banner,
            .orch-route-pill,
            .orch-route-badge,
            .orch-mode-pill.is-custom,
            .orch-role-status.is-custom,
            .tag-notice,
            .currency-btn.active
        ) :is(.bi-sep, .bi-zh) {
            color: inherit;
        }

        /* ═══ 4. Sticky Hairline Masthead & Sliding Index ═══ */
        body .panel-topbar,
        body .panel-topbar.scrolled {
            margin: 0 0 18px;
            padding: 0 var(--ed-gutter);
            width: auto;
            background: var(--ed-bg);
            border-bottom: 1px solid var(--ed-border);
            box-shadow: none;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }
        body .panel-topbar.scrolled { border-bottom-color: var(--ed-border-strong); }
        body .topbar-title,
        body .tab-bar-wrapper,
        body .tab-scroll-hint {
            max-width: var(--ed-column);
            margin-inline: auto;
        }
        body .topbar-title {
            padding: 10px 0 8px;
            column-gap: 14px;
            align-items: center;
        }
        body .topbar-title h1 {
            font-family: var(--ed-sans);
            font-size: 15px;
            font-weight: 600;
            letter-spacing: -0.012em;
            line-height: 1.35;
            color: var(--ed-ink);
        }
        body .topbar-title h1 .icon {
            color: var(--ed-accent);
            width: 14px;
            height: 14px;
        }
        body .panel-topbar .action-btn {
            width: 28px;
            height: 28px;
            padding: 0;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface);
            border: 1px solid var(--ed-control-border);
            color: var(--ed-ink);
            box-shadow: none;
        }
        body .panel-topbar .action-btn.paused {
            color: var(--ed-accent);
            background: var(--ed-accent-tint);
            border-color: var(--ed-accent-border);
        }
        body .acct-popover-trigger {
            background: var(--ed-surface);
            border: 1px solid var(--ed-control-border);
            color: var(--ed-ink);
            box-shadow: none;
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }
        body .acct-popover-trigger.is-open {
            background: var(--ed-accent-tint);
            border-color: var(--ed-accent-border);
            color: var(--ed-accent);
        }
        body .tab-bar {
            box-shadow: none;
            background: transparent;
            border-radius: 0;
        }
        body .tab-slider {
            top: auto;
            bottom: 0;
            height: 2px;
            border-radius: 2px 2px 0 0;
            background: var(--ed-accent);
            transition: left 200ms var(--ed-ease), width 200ms var(--ed-ease);
        }

        /* Account popover L3 surface */
        body .acct-popover-dropdown {
            background: var(--ed-surface-overlay);
            border: 1px solid var(--ed-border-strong);
            border-radius: var(--ed-radius-lg);
            box-shadow: var(--ed-shadow-popover);
            backdrop-filter: none;
            -webkit-backdrop-filter: none;
        }
        body .acct-popover-body .acct-card {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: 8px;
        }
        body .acct-popover-body :is(.acct-credit-chip, .acct-plan):not(.is-today):not(.acct-plan-pro):not(.acct-plan-ultra):not(.acct-plan-team) {
            border-color: var(--ed-border);
            color: var(--ed-ink-secondary);
            background: var(--ed-surface-well);
            letter-spacing: normal;
        }
        body .acct-popover-body .acct-expiry-chip.is-today {
            background: var(--ed-danger-tint);
            color: var(--ed-danger);
            border-color: var(--ed-danger-border);
            letter-spacing: normal;
        }
        body .acct-popover-body :is(.acct-plan-pro, .acct-plan-ultra) {
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border-color: var(--ed-accent-border);
            letter-spacing: normal;
        }
        body .acct-popover-body .acct-plan-team {
            background: var(--ed-good-tint);
            color: var(--ed-good);
            border-color: var(--ed-good-border);
            letter-spacing: normal;
        }
        body .acct-popover-body .acct-credit-chip:not(.is-today) b { color: var(--ed-ink); }
        body .acct-popover-body .acct-indicator-active {
            background: var(--ed-good);
            box-shadow: none;
            animation: none;
        }

        /* ═══ 5. Reading Column & Shared Section Headings ═══ */
        body .tab-pane {
            width: min(100%, calc(var(--ed-column) + 2 * var(--ed-gutter)));
            margin-inline: auto;
            padding-inline: var(--ed-gutter);
            padding-block-end: 40px;
            min-width: 0;
        }
        body .tab-pane :is(h2, h3) { overflow-wrap: anywhere; }
        body .tab-pane :is(.card h2, .act-section-title, .stg-header h2, .about-section-title, .overview-section-heading, .profile-section-header h2) {
            color: var(--ed-ink);
            font-family: var(--ed-sans);
            font-size: 0.9375rem;
            font-weight: 600;
            letter-spacing: -0.012em;
            line-height: 1.35;
            text-transform: none;
        }
        body .tab-pane .act-section-title { flex-wrap: wrap; }
        body .tab-pane :is(.act-section-title > .icon, .act-section-title > .act-icon, .card h2 .icon, .card h2 .act-icon) {
            color: var(--ed-accent);
            opacity: 1;
            width: 15px;
            height: 15px;
            flex-shrink: 0;
        }
        body .tab-pane :is(.act-section-title > .act-icon[stroke], .card h2 .act-icon[stroke]) {
            stroke: var(--ed-accent);
        }
        body .tab-pane .ed-pane-header { margin-block: 4px 16px; }
        body .tab-pane .ed-pane-header p {
            margin-top: 6px;
            color: var(--ed-ink-secondary);
            max-width: 68ch;
        }

        /* Inputs follow Light/Dark well contrast */
        body .tab-pane :is(.ses-search-wrap, .threshold-input, .prc-edit-input, .stg-select-row select) {
            background-color: var(--ed-input-bg);
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm);
            color: var(--ed-ink);
            box-shadow: none;
        }
        body:is(.vscode-light, [data-vscode-theme-kind="vscode-light"]) .tab-pane .stg-select-row select {
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='%235A6475' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E");
        }
        body .tab-pane .num-spinner {
            background: var(--ed-input-bg);
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm);
        }
        body .tab-pane .num-spinner .threshold-input {
            background: transparent;
            border: none;
        }

        /* ═══ 6. Tab 1: Overview ═══ */
        body .monitor-overview {
            --overview-rule: var(--ed-border);
            --overview-muted: var(--ed-ink-muted);
            --overview-accent: var(--ed-accent);
            --overview-focus: var(--ed-accent);
            --overview-track: var(--ed-track);
            --overview-fill: var(--ed-accent);
            --overview-good: var(--ed-good-fill);
            --overview-warn: var(--ed-warn-fill);
            --overview-attention: var(--ed-danger-fill);
            color: var(--ed-ink);
            width: auto;
            padding: 4px 0 0;
        }
        body .overview-header {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 6px 14px;
            padding-bottom: 16px;
        }
        body .overview-header .overview-meta,
        body .overview-plan-pill {
            margin: 0;
            padding: 2px 10px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            color: var(--ed-ink-secondary);
            font-size: 12px;
            font-weight: 500;
        }
        body .overview-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.18fr) minmax(0, 1fr);
            gap: 16px;
            align-items: start;
            border: 0;
        }
        body .overview-context,
        body .overview-quota,
        body .overview-connection {
            min-width: 0;
            padding: 18px 20px;
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md);
        }
        body .monitor-overview .overview-section-heading {
            display: flex;
            align-items: baseline;
            flex-wrap: wrap;
            column-gap: 0;
            row-gap: 2px;
        }
        body .overview-state-dot {
            flex: 0 0 8px;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            align-self: center;
            margin-inline-end: 8px;
            background: var(--ed-ink-muted);
            color: var(--ed-ink-muted);
        }
        body [data-monitor-state="active"] .overview-state-dot {
            background: var(--ed-good);
            color: var(--ed-good);
        }
        body [data-monitor-state="disconnected"] .overview-state-dot {
            background: var(--ed-danger);
            color: var(--ed-danger);
        }
        body .overview-session-title {
            margin-top: 10px;
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--ed-ink);
        }
        body .overview-reading { margin-top: 14px; }
        body .overview-reading strong {
            font-family: var(--ed-sans);
            font-size: 1.75rem;
            font-weight: 650;
            line-height: 1.15;
            letter-spacing: -0.025em;
            color: var(--ed-ink);
            font-variant-numeric: tabular-nums lining-nums;
        }
        body .overview-percent {
            font-size: 1rem;
            font-weight: 650;
            color: var(--ed-ink);
        }
        body .overview-meter {
            height: 6px;
            margin: 10px 0 8px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-track);
            overflow: hidden;
        }
        body .overview-meter.is-unknown {
            background: var(--ed-track);
            opacity: 0.72;
        }
        body .overview-meter span {
            display: block;
            height: 100%;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-accent);
            transition: width 260ms var(--ed-ease);
        }
        body .overview-meter.is-healthy span { background: var(--ed-good-fill); }
        body .overview-meter.is-warn span { background: var(--ed-warn-fill); }
        body .overview-meter.is-attention span { background: var(--ed-danger-fill); }
        body .overview-notices {
            margin: 10px 0;
            padding: 8px 12px 8px 26px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-warn-tint);
            border: 1px solid var(--ed-warn-border);
            color: var(--ed-warn);
            font-size: 12px;
        }
        body .overview-details {
            margin: 14px 0 10px;
            border-block: 1px solid var(--ed-border);
        }
        body .overview-details summary {
            list-style: none;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            column-gap: 0;
            row-gap: 2px;
            padding: 9px 6px;
            margin-inline: -6px;
            border-radius: var(--ed-radius-sm);
            font-size: 12.5px;
            font-weight: 550;
            color: var(--ed-ink);
            cursor: pointer;
            transition: background var(--ed-dur-fast) var(--ed-ease);
        }
        body .overview-details summary::-webkit-details-marker { display: none; }
        body .overview-details summary::before {
            content: '';
            display: inline-block;
            flex-shrink: 0;
            width: 5px;
            height: 5px;
            border-right: 1.5px solid var(--ed-ink-muted);
            border-bottom: 1.5px solid var(--ed-ink-muted);
            transform: rotate(-45deg);
            margin-inline-end: 8px;
            transition: transform 160ms var(--ed-ease), border-color 160ms var(--ed-ease);
        }
        body .overview-details[open] > summary::before {
            transform: rotate(45deg);
            border-color: var(--ed-accent);
        }
        body .overview-details h3 {
            margin: 10px 0 6px;
            font-size: 12px;
            font-weight: 600;
            color: var(--ed-ink-secondary);
        }
        body .overview-quotas { margin: 8px 0 10px; }
        body .overview-quota-row { padding-block: 10px 12px; }
        body .overview-quota-row + .overview-quota-row { border-top: 1px solid var(--ed-border); }
        body .overview-quota-heading strong {
            font-size: 1rem;
            font-weight: 650;
            color: var(--ed-ink);
        }
        body .overview-quota-heading strong.overview-quota-unknown {
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--ed-ink-muted);
        }
        body .overview-action {
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            column-gap: 0;
            row-gap: 2px;
            padding: 5px 8px;
            margin-inline-start: -8px;
            border: 1px solid transparent;
            border-radius: var(--ed-radius-sm);
            background: transparent;
            color: var(--ed-accent);
            font-size: 12.5px;
            font-weight: 550;
            text-decoration: none;
            transition: background var(--ed-dur-fast) var(--ed-ease);
        }
        body .overview-action svg {
            margin-inline-start: 6px;
            transition: transform var(--ed-dur-fast) var(--ed-ease);
        }
        body .overview-footer {
            margin-top: 16px;
            padding: 12px 18px;
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md);
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px 16px;
        }
        body .overview-footer .overview-action { margin-inline-start: 0; }
        body .overview-footer p strong {
            font-weight: 650;
            color: var(--ed-ink);
            font-variant-numeric: tabular-nums lining-nums;
        }

        /* ═══ 7. Tab 2: GM Data ═══ */
        body .tab-pane .act-summary-bar {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md);
            padding: 12px 16px;
            gap: 8px 20px;
            box-shadow: none;
        }
        body .tab-pane .act-stat:not(.act-stat-warn) {
            padding: 2px 0;
            border: 0;
            border-radius: 0;
            background: transparent;
            color: var(--ed-ink);
        }
        body .tab-pane .act-stat-warn {
            padding: 2px 8px;
            border: 1px solid var(--ed-danger-border);
            border-radius: var(--ed-radius-sm);
            background: var(--ed-danger-tint);
            color: var(--ed-danger);
        }
        body .tab-pane .act-stat-warn :is(.act-stat-icon, .act-stat-val, .act-stat-label) { color: var(--ed-danger); }
        body .tab-pane :is(.act-stat-icon, .act-stat-val):not(.act-stat-warn *) { color: var(--ed-ink); }
        body .tab-pane .act-stat .act-stat-val { font-weight: 650; font-variant-numeric: tabular-nums lining-nums; }
        body .tab-pane .act-stat:not(.act-stat-warn) .act-stat-label { color: var(--ed-ink-muted); letter-spacing: normal; }

        body .tab-pane :is(
            .telemetry-ledger-card,
            .act-model-card,
            .tool-rank-list,
            .act-trend-container,
            .act-conv-list,
            .gm-err-card,
            .ci-section,
            .tool-cat-section,
            .pending-archive-panel
        ) {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md);
            box-shadow: none;
        }
        body .tab-pane .ledger-acct-card {
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            box-shadow: none;
        }
        body .tab-pane :is(.cp-card, .dna-row-card) {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-left: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            box-shadow: none;
        }
        body .tab-pane .act-cards-grid {
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
            gap: 14px;
        }
        body .tab-pane .act-model-card { overflow: hidden; }
        body .tab-pane .act-model-card .act-card-header {
            background: var(--ed-surface-well);
            border: 0;
            border-bottom: 1px solid var(--ed-border);
            border-radius: 0;
            padding: 10px 14px;
            color: var(--ed-ink);
        }
        body .tab-pane .act-card-body { padding: 8px 14px 12px; }
        body .tab-pane .act-card-row {
            border-radius: var(--ed-radius-xs);
            border-bottom: 1px solid var(--ed-border);
        }
        body .tab-pane .act-card-row:last-child { border-bottom: none; }
        body .tab-pane .act-card-row:nth-child(even) { background: transparent; }
        body .tab-pane .act-card-row .val { background: transparent; border-color: transparent; }
        body .tab-pane .act-card-row .val:not(.val-cost):not(.val-hit):not(.val-credits):not(.val-danger) { color: var(--ed-ink); }
        body .tab-pane .act-credit-calls { color: var(--ed-ink-muted); opacity: 1; }
        body .tab-pane .tool-rank-list { padding: 12px 16px; }
        body .tab-pane .tool-rank-name {
            width: min(190px, 40%);
            min-width: 0;
            background: transparent;
            border: 0;
            color: var(--ed-ink);
            font-family: var(--ed-mono);
        }
        body .tab-pane .tool-rank-idx { color: var(--ed-ink-muted); opacity: 1; }
        body .tab-pane .tool-rank-bar-wrap,
        body .tab-pane .gm-cache-bar-bg {
            height: 8px;
            background: var(--ed-track);
            border-radius: var(--ed-radius-pill);
            overflow: hidden;
        }
        body .tab-pane .tool-rank-row .tool-rank-bar,
        body .tab-pane .gm-cache-bar {
            background: var(--ed-accent);
            border-radius: var(--ed-radius-pill);
            background-image: none;
        }
        body .tab-pane .act-tl-turn {
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md);
            background: var(--ed-surface);
        }
        body .tab-pane :is(.act-tl-turn-header, .ci-section-header) {
            background: var(--ed-surface-well);
        }
        body .tab-pane .act-trend-svg > polyline { stroke: var(--ed-accent); }
        body .tab-pane .act-trend-svg > polygon { fill: var(--ed-accent-tint); }
        body .tab-pane .act-dist-note { border-left: 1px solid var(--ed-warn-border); }

        /* ═══ 8. Tab 4: Cost ═══ */
        body .tab-pane .prc-monthly-grand {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md);
            padding: 16px 20px;
            color: var(--ed-ink);
            box-shadow: none;
        }
        body .tab-pane .prc-monthly-grand-val:not(.is-unavailable) {
            font-size: 1.75rem;
            font-weight: 650;
            letter-spacing: -0.025em;
            color: var(--ed-ink);
            font-variant-numeric: tabular-nums lining-nums;
        }
        body .tab-pane .prc-monthly-grand-val.is-unavailable {
            font-size: 0.9375rem;
            font-weight: 500;
            letter-spacing: 0;
            color: var(--ed-ink-muted);
        }
        body .tab-pane .prc-monthly-grand-label.is-partial {
            background: var(--ed-warn-tint);
            color: var(--ed-warn);
            border: 1px solid var(--ed-warn-border);
        }
        body .tab-pane .prc-cost-unavailable {
            background: var(--ed-surface-well);
            color: var(--ed-ink-muted);
            border: 1px solid var(--ed-border);
        }
        body .tab-pane :is(.cost-panel, .prc-edit-section, .prc-monthly-models) {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md);
            box-shadow: none;
        }
        body .tab-pane .cost-panel .cost-bar-section {
            background: transparent;
            border: 0;
            border-bottom: 1px solid var(--ed-border);
            border-radius: 0;
            box-shadow: none;
        }
        body .tab-pane .cost-panel .cost-detail-section {
            background: transparent;
            border: 0;
            border-radius: 0;
            box-shadow: none;
        }
        body .tab-pane .prc-info-bar:not(.prc-info-warn) {
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            color: var(--ed-ink-secondary);
        }
        body .tab-pane .prc-info-bar.prc-info-warn {
            background: var(--ed-warn-tint);
            border: 1px solid var(--ed-warn-border);
            border-radius: var(--ed-radius-sm);
            color: var(--ed-warn);
        }
        body .tab-pane .prc-monthly-calendar-link {
            color: var(--ed-accent);
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface);
        }
        body .tab-pane .prc-monthly-bar-wrap {
            height: 6px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-track);
            overflow: hidden;
        }
        body .tab-pane .prc-monthly-bar-fill {
            border-radius: var(--ed-radius-pill);
            background: var(--ed-accent);
            background-image: none;
        }
        body .tab-pane .cost-bar-track {
            height: 10px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-track);
            overflow: hidden;
        }
        body .tab-pane .cost-seg-input { background: var(--ed-chart-input); }
        body .tab-pane .cost-seg-output { background: var(--ed-chart-output); }
        body .tab-pane .cost-seg-cache { background: var(--ed-chart-cache); }
        body .tab-pane .cost-seg-think { background: var(--ed-chart-thinking); }
        body .tab-pane .cost-chip {
            color: var(--ed-ink);
            background: var(--ed-surface-well);
            border-color: var(--ed-border);
            border-radius: var(--ed-radius-sm);
            white-space: normal;
            overflow-wrap: anywhere;
        }
        body .tab-pane :is(.cost-bar-val, .cost-detail-total) {
            color: var(--ed-ink);
            background: transparent;
            border: 0;
            font-variant-numeric: tabular-nums lining-nums;
        }
        body .tab-pane .cost-chip-total:not(.is-partial) {
            color: var(--ed-accent);
            background: var(--ed-accent-tint);
            border-color: var(--ed-accent-border);
        }
        body .tab-pane .cost-chip-total.is-partial {
            color: var(--ed-warn);
            background: var(--ed-warn-tint);
            border-color: var(--ed-warn-border);
        }
        body .tab-pane :is(.cost-detail-row, .prc-edit-row) {
            background: transparent;
            border-color: var(--ed-border);
            border-radius: 0;
            box-shadow: none;
        }
        body .tab-pane .prc-edit-input {
            height: 32px;
            font-variant-numeric: tabular-nums lining-nums;
        }
        body .tab-pane .prc-btn {
            height: 32px;
            padding: 0 12px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-control-border);
            background: var(--ed-surface);
            color: var(--ed-ink);
            font-size: 12.5px;
            font-weight: 550;
            box-shadow: none;
        }
        body .tab-pane .prc-btn-primary {
            border-color: transparent;
            background: var(--ed-accent);
            color: var(--ed-accent-ink);
        }

        /* ═══ 9. Tab 5: Models & Tab 7: Profile Flattening ═══ */
        body .tab-pane .default-model-card {
            margin-bottom: 16px;
        }
        body .tab-pane :is(.model-quota-section, .model-info-section) {
            background: transparent;
            border: 0;
            border-top: 1px solid var(--ed-border);
            border-radius: 0;
            padding: 20px 0 0;
            margin: 20px 0 0;
            box-shadow: none;
        }
        body .tab-pane .model-info-image-section {
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px solid var(--ed-border);
        }
        body .tab-pane > :is(.model-quota-section, .model-info-section):first-child {
            border-top: 0;
            padding-top: 0;
            margin-top: 0;
        }
        /* Flatten nested card / duplicate heading inside Profile quota & technical disclosure */
        body .tab-pane .profile-quota .model-quota-section {
            border: 0;
            padding: 0;
            margin: 0;
            background: transparent;
        }
        body .tab-pane .profile-quota .model-quota-section > h2 { display: none; }
        body .tab-pane .profile-quota .model-grid {
            grid-template-columns: minmax(0, 1fr);
            gap: 10px;
        }
        body .tab-pane .profile-quota .model-card {
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: 8px;
            padding: 12px 14px;
        }
        body .tab-pane .profile-quota .model-card .model-tag-badge:not(.tag-notice) {
            background: var(--ed-surface);
        }
        body .tab-pane .profile-technical-body .card {
            background: transparent;
            border: 0;
            border-radius: 0;
            padding: 0;
            margin: 0;
        }
        body .tab-pane .profile-technical-body .profile-two-col {
            padding-top: 16px;
            border-top: 1px solid var(--ed-border);
        }

        /* ═══ 10. Tab 6: Calendar (edge-clamped tooltips & zero-overflow safety) ═══ */
        body .tab-pane .cal-grid {
            grid-template-columns: repeat(7, minmax(0, 1fr));
        }
        body .tab-pane .cal-cell:nth-child(7n+1)[data-tooltip]::after {
            left: 0;
            transform: none;
        }
        body .tab-pane .cal-cell:nth-child(7n)[data-tooltip]::after {
            left: auto;
            right: 0;
            transform: none;
        }
        body .tab-pane .cal-overview-val,
        body .tab-pane .cal-day-total-val {
            overflow-wrap: anywhere;
        }

        /* ═══ 11. Tab 8: Settings ═══ */
        body .tab-pane .stg-card {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md);
            padding: 18px 20px;
            box-shadow: none;
        }
        body .tab-pane .stg-card::before { content: none; }
        body .tab-pane .stg-card:hover { transform: none; box-shadow: none; }

        /* ═══ 12. Tab 9: About Colophon (harmonizes with getAboutTabStyles) ═══ */
        body .tab-pane .about-section-title {
            align-items: baseline;
            flex-wrap: wrap;
            column-gap: 0;
            row-gap: 2px;
        }
        body .tab-pane .about-section-title svg {
            align-self: center;
            margin-inline-end: 8px;
        }
        body .tab-pane .about-section-disclaimer .about-section-title svg {
            color: var(--ed-danger);
        }
        body .tab-pane .about-info-box {
            border-left-width: 1px;
            box-shadow: none;
        }
        body[data-lang="both"] .tab-pane .about-card-desc {
            display: block;
            -webkit-line-clamp: unset;
            overflow: visible;
        }
        body .tab-pane :is(.star-inline, .heart-inline),
        body .panel-topbar .acct-popover-dot { animation: none; }

        /* ═══ 13. Universal Focus, Hover & Disabled States ═══ */
        body :is(.panel-topbar, .tab-pane) :is(button, a, input, select, textarea, summary):focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
            box-shadow: none;
        }
        body .panel-topbar :is(.tab-btn, .lang-btn):focus-visible { outline-offset: -3px; }
        body .tab-pane .num-spinner .threshold-input:focus-visible { outline: none; }
        body .tab-pane .num-spinner:focus-within {
            border-color: var(--ed-accent);
            outline: 2px solid var(--ed-accent);
            outline-offset: 1px;
        }
        body .tab-pane .ses-search-input:focus-visible { outline: none; }

        body :is(.panel-topbar, .tab-pane) [data-tooltip]::after {
            background: var(--ed-surface-overlay);
            color: var(--ed-ink);
            border: 1px solid var(--ed-border-strong);
            border-radius: var(--ed-radius-sm);
            box-shadow: var(--ed-shadow-tooltip);
        }
        body :is(.panel-topbar, .tab-pane) [data-tooltip]:not(:hover, :focus-visible)::after {
            display: none;
        }

        body .tab-pane :is(.prc-btn, .action-btn, .ses-filter-btn, .cal-summary-btn, .cal-nav-btn, .preset-btn):disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }

        @media (hover: hover) {
            body .lang-btn:not(.active):hover {
                color: var(--ed-ink);
                background: var(--ed-surface-hover);
            }
            body .tab-btn:not(.active):hover {
                color: var(--ed-ink);
                background: var(--ed-surface-hover);
            }
            body .tab-arrow:hover {
                color: var(--ed-ink);
                background: var(--ed-surface-hover);
            }
            body .tab-scroll-hint-close:hover {
                color: var(--ed-ink);
                background: var(--ed-surface-hover);
            }
            body :is(.panel-topbar .action-btn, .acct-popover-trigger, .tab-pane .action-btn, .tab-pane .prc-btn:not(.prc-btn-primary), .tab-pane .cal-nav-btn, .tab-pane .preset-btn:not(.is-active):not(.active), .tab-pane .copy-btn, .tab-pane .about-github-link):not(:disabled):hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-ink-muted);
                color: var(--ed-ink);
            }
            body .tab-pane .prc-btn-primary:not(:disabled):hover {
                background: var(--ed-accent-hover);
                color: var(--ed-accent-ink);
            }
            body .tab-pane :is(.overview-action, .profile-activity):hover {
                background: var(--ed-accent-tint);
                text-decoration: none;
            }
            body .tab-pane .overview-action:hover svg { transform: translateX(2px); }
            body .tab-pane :is(.cal-clear-btn, .danger-action):not(:disabled):hover {
                background: var(--ed-danger-tint);
                border-color: var(--ed-danger);
                color: var(--ed-danger);
            }
            body .tab-pane .privacy-btn:not(.active):hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-ink-muted);
                color: var(--ed-ink);
            }
            body .tab-pane .num-spinner-btn:hover {
                background: var(--ed-surface-hover);
                color: var(--ed-ink);
            }
            body .tab-pane .toggle-row:hover,
            body .tab-pane .collapsible > summary:hover,
            body .tab-pane .overview-details > summary:hover,
            body .tab-pane .profile-technical > summary:hover,
            body .tab-pane .model-quota-details > summary:hover {
                background: var(--ed-surface-hover);
            }
            body .tab-pane .ses-shortcut:not(.is-disabled):hover {
                border-color: var(--ed-accent-border);
                background: var(--ed-surface-hover);
            }
            body .tab-pane .ses-filter-btn:not(.is-active):hover {
                background: var(--ed-surface-hover);
                color: var(--ed-ink);
            }
            body .tab-pane .ses-row:not(.is-current):hover {
                background: var(--ed-surface-hover);
            }
            body .tab-pane .ses-act-btn:not(:disabled):hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-ink-muted);
                color: var(--ed-ink);
            }
            body .tab-pane .cal-summary-btn:not(.active):hover {
                color: var(--ed-ink);
                background: var(--ed-surface-hover);
            }
            body .tab-pane .cal-cell.has-data:hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-border-strong);
            }
            body .tab-pane .act-card-row:hover,
            body .tab-pane .cost-detail-row:hover,
            body .tab-pane .prc-edit-row:hover {
                background: var(--ed-surface-hover);
            }
            body .tab-pane .about-card:hover {
                border-color: var(--ed-accent-border);
                background: var(--ed-surface-hover);
                transform: none;
            }
            body .tab-pane .about-card:hover .about-card-arrow {
                color: var(--ed-accent);
                transform: translateX(2px);
            }
            body .tab-pane .prc-monthly-calendar-link:hover {
                background: var(--ed-accent-tint);
                border-color: var(--ed-accent-border);
            }
        }

        /* ═══ 14. Responsive Layout Breakpoints (320px–1440px Zero Overflow) ═══ */
        @media (min-width: 900px) {
            body #tab-settings.active {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 16px;
                align-items: stretch;
            }
            body #tab-settings > .stg-card { margin-bottom: 0; }
            body #tab-settings > :is(.stg-card[data-accent="storage"], .ed-pane-header, .eoc-sentinel) {
                grid-column: 1 / -1;
            }
        }

        @media (max-width: 720px) {
            body .profile-body-grid {
                grid-template-columns: minmax(0, 1fr);
            }
        }

        @media (max-width: 680px) {
            body .overview-grid,
            body .tab-pane .telemetry-ledger-grid {
                grid-template-columns: minmax(0, 1fr);
            }
        }

        @media (max-width: 640px) {
            body .panel-topbar { margin-bottom: 14px; }
            body .topbar-title {
                padding: 8px 0 6px;
                row-gap: 6px;
            }
            body .topbar-title-left { flex-basis: 100%; }
            body .tab-btn { padding: 8px 9px 9px; }
            body .tab-pane :is(.overview-header h2, .ed-pane-title, .about-hero-title, .profile-identity h2) {
                font-size: 1.3rem;
            }
            body .overview-reading strong,
            body .tab-pane .prc-monthly-grand-val:not(.is-unavailable) {
                font-size: 1.5rem;
            }
            body .tab-pane .act-summary-bar {
                padding: 10px 12px;
                gap: 6px 12px;
            }
            body .tab-pane .act-stat {
                max-width: 100%;
                flex-wrap: wrap;
                white-space: normal;
            }
            body .tab-pane .act-conv-meta {
                flex-wrap: wrap;
                flex-shrink: 1;
                min-width: 0;
                max-width: 100%;
            }
            body .tab-pane .act-conv-meta-chip {
                max-width: 100%;
                white-space: normal;
                overflow-wrap: anywhere;
            }
            body .overview-context,
            body .overview-quota,
            body .overview-connection,
            body .tab-pane .telemetry-ledger-card,
            body .profile-identity,
            body .profile-quota,
            body .profile-ai,
            body .stg-card,
            body .spec-card,
            body .model-card {
                padding: 14px 14px;
            }
        }

        /* ═══ 15. v1.17.3 Orchestrator, Dual-Window Quota, Currency & Recent Calls ═══ */

        /* Orchestrator active route pill (Overview) */
        body .tab-pane .orch-route-pill {
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 4px 8px;
            max-width: 100%;
            margin-top: 8px;
            padding: 4px 10px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-accent-tint);
            border: 1px solid var(--ed-accent-border);
            color: var(--ed-accent);
            font-size: 12px;
            line-height: 1.4;
            overflow-wrap: anywhere;
        }
        body .tab-pane .orch-route-label {
            font-weight: 600;
        }
        body .tab-pane .orch-route-pair {
            color: var(--ed-ink);
            font-weight: 500;
        }
        body .tab-pane .orch-route-arrow {
            color: var(--ed-accent);
            font-weight: 650;
            margin-inline: 2px;
        }
        body .tab-pane .orch-route-badge {
            display: inline-flex;
            align-items: center;
            padding: 1px 6px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface);
            border: 1px solid var(--ed-accent-border);
            color: var(--ed-accent);
            font-size: 11px;
            font-weight: 600;
            line-height: 1.35;
        }

        /* Orchestrator Settings card (Models tab) */
        body .tab-pane .orch-settings-card {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md);
            padding: 16px 18px;
            margin-bottom: 16px;
            box-shadow: none;
        }
        body .tab-pane .orch-settings-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 6px 12px;
            margin-bottom: 12px;
        }
        body .tab-pane .orch-settings-header h2 {
            margin: 0;
        }
        body .tab-pane .orch-mode-pill {
            display: inline-flex;
            align-items: center;
            padding: 2px 9px;
            border-radius: var(--ed-radius-pill);
            font-size: 11.5px;
            font-weight: 600;
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
        }
        body .tab-pane .orch-mode-pill.is-custom {
            background: var(--ed-accent-tint);
            border-color: var(--ed-accent-border);
            color: var(--ed-accent);
        }
        body .tab-pane .orch-role-list {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }
        body .tab-pane .orch-role-row {
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 0;
            padding: 10px 12px;
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
        }
        body .tab-pane .orch-role-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 4px 8px;
        }
        body .tab-pane .orch-role-title {
            font-size: 11.5px;
            font-weight: 600;
            color: var(--ed-ink-muted);
        }
        body .tab-pane .orch-role-status {
            font-size: 11px;
            font-weight: 550;
            padding: 1px 6px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            color: var(--ed-ink-secondary);
        }
        body .tab-pane .orch-role-status.is-custom {
            background: var(--ed-accent-tint);
            border-color: var(--ed-accent-border);
            color: var(--ed-accent);
        }
        body .tab-pane .orch-role-value {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
            min-width: 0;
        }
        body .tab-pane .orch-role-value strong {
            font-size: 0.9rem;
            font-weight: 600;
            color: var(--ed-ink);
            overflow-wrap: anywhere;
        }
        body .tab-pane .orch-role-value .spec-short-id {
            max-width: 100%;
            overflow-wrap: anywhere;
        }
        body .tab-pane .orch-pool-chip {
            display: inline-flex;
            align-items: center;
            padding: 1px 7px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface);
            border: 1px solid var(--ed-border-strong);
            color: var(--ed-ink-secondary);
            font-size: 11px;
            font-weight: 550;
        }
        body .tab-pane .orch-families-grid {
            margin: 12px 0 0;
            padding-top: 10px;
            border-top: 1px solid var(--ed-border);
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        body .tab-pane .orch-family-row {
            display: flex;
            flex-wrap: wrap;
            gap: 4px 10px;
            font-size: 12px;
        }
        body .tab-pane .orch-family-row dt {
            color: var(--ed-ink-muted);
            font-weight: 550;
            flex-shrink: 0;
        }
        body .tab-pane .orch-family-row dd {
            margin: 0;
            color: var(--ed-ink-secondary);
            min-width: 0;
            overflow-wrap: anywhere;
        }
        body .tab-pane .orch-settings-note {
            margin: 10px 0 0;
            font-size: 12px;
            color: var(--ed-ink-muted);
            line-height: 1.5;
        }

        /* Dual-window 5h + Weekly quota row (Overview, Models, Profile) */
        body .tab-pane .quota-dual-row {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px 14px;
            margin: 8px 0 6px;
        }
        body .tab-pane .quota-dual-item {
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        body .tab-pane .quota-dual-head {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 6px;
            font-size: 12px;
        }
        body .tab-pane .quota-dual-label {
            color: var(--ed-ink-secondary);
            font-weight: 550;
        }
        body .tab-pane .quota-dual-pct {
            color: var(--ed-ink);
            font-weight: 650;
            font-variant-numeric: tabular-nums lining-nums;
            white-space: nowrap;
        }
        body .tab-pane .quota-dual-item .overview-meter,
        body .tab-pane .quota-dual-item .quota-bar-wrap {
            margin: 3px 0 2px;
        }
        body .tab-pane .quota-dual-reset {
            font-size: 11.5px;
        }

        /* Spec card API reference price row (Models tab) */
        body .tab-pane .spec-price-row {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 4px 10px;
            margin-top: 10px;
            padding: 7px 10px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            font-size: 12px;
            line-height: 1.4;
        }
        body .tab-pane .spec-price-label {
            color: var(--ed-ink-muted);
            font-weight: 550;
            flex-shrink: 0;
        }
        body .tab-pane .spec-price-values {
            color: var(--ed-ink);
            font-weight: 550;
            font-variant-numeric: tabular-nums lining-nums;
            overflow-wrap: anywhere;
        }
        body .tab-pane .spec-price-badge.is-unpriced {
            display: inline-flex;
            align-items: center;
            padding: 1px 7px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface);
            border: 1px solid var(--ed-border-strong);
            color: var(--ed-ink-muted);
            font-size: 11px;
            font-weight: 600;
        }

        /* Amber Notice badge (GPT-OSS sunset notice) */
        body .tab-pane .tag-notice,
        body .tab-pane .model-tag-badge.tag-notice {
            background: var(--ed-warn-tint);
            border: 1px solid var(--ed-warn-border);
            color: var(--ed-warn);
            font-weight: 600;
        }

        /* Currency toggle & FX rate input (Cost + Settings tabs) */
        body .tab-pane .currency-toggle-group {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            padding: 2px;
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            max-width: 100%;
            flex-wrap: wrap;
        }
        body .tab-pane .currency-btn {
            appearance: none;
            background: transparent;
            color: var(--ed-ink-muted);
            border: 1px solid transparent;
            border-radius: var(--ed-radius-xs);
            padding: 4px 10px;
            font: inherit;
            font-size: 12px;
            font-weight: 550;
            cursor: pointer;
            line-height: 1.35;
            transition: background var(--ed-dur-fast) var(--ed-ease),
                color var(--ed-dur-fast) var(--ed-ease),
                border-color var(--ed-dur-fast) var(--ed-ease);
        }
        body .tab-pane .currency-btn.active {
            background: var(--ed-surface);
            color: var(--ed-ink);
            font-weight: 650;
            border-color: var(--ed-control-border);
            box-shadow: var(--ed-shadow-segment);
        }
        body .tab-pane .fx-rate-input {
            width: 76px;
            min-width: 60px;
            height: 28px;
            padding: 0 8px;
            background: var(--ed-input-bg);
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm);
            color: var(--ed-ink);
            font: inherit;
            font-size: 12.5px;
            font-variant-numeric: tabular-nums lining-nums;
            text-align: end;
        }

        /* Upcoming rate-change banner (Cost tab) */
        body .tab-pane .rate-change-banner {
            display: flex;
            flex-direction: column;
            align-items: stretch;
            gap: 6px;
            padding: 10px 14px;
            margin-bottom: 14px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-warn-tint);
            border: 1px solid var(--ed-warn-border);
            color: var(--ed-warn);
            font-size: 12.5px;
            line-height: 1.5;
            overflow-wrap: anywhere;
        }
        body .tab-pane .rate-change-banner-head {
            display: flex;
            align-items: center;
            gap: 7px;
            font-weight: 650;
            min-width: 0;
        }
        body .tab-pane .rate-change-banner-head svg {
            flex-shrink: 0;
        }
        body .tab-pane .rate-change-banner-list {
            margin: 0;
            padding-inline-start: 18px;
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        body .tab-pane .rate-change-banner strong {
            color: inherit;
            font-weight: 650;
        }

        /* Recent Calls Ledger table (GM Data tab) */
        body .tab-pane .recent-calls-card {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md);
            padding: 14px 16px;
            margin-top: 14px;
            box-shadow: none;
            min-width: 0;
        }
        body .tab-pane .recent-calls-table-wrap {
            width: 100%;
            max-width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
            margin-top: 10px;
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface);
        }
        body .tab-pane .recent-calls-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
            line-height: 1.4;
            font-variant-numeric: tabular-nums lining-nums;
            color: var(--ed-ink);
            min-width: 640px;
        }
        body .tab-pane .recent-calls-table thead th {
            text-align: start;
            padding: 8px 10px;
            font-weight: 600;
            font-size: 11.5px;
            color: var(--ed-ink-muted);
            background: var(--ed-surface-well);
            border-bottom: 1px solid var(--ed-border);
            white-space: nowrap;
        }
        body .tab-pane .recent-calls-table tbody td {
            padding: 7px 10px;
            border-bottom: 1px solid var(--ed-border);
            vertical-align: middle;
            white-space: nowrap;
        }
        body .tab-pane .recent-calls-table tbody tr:last-child td {
            border-bottom: 0;
        }
        body .tab-pane .recent-calls-table :is(th, td).is-num {
            text-align: end;
        }

        @media (hover: hover) {
            body .tab-pane .currency-btn:not(.active):hover {
                background: var(--ed-surface-hover);
                color: var(--ed-ink);
            }
            body .tab-pane .recent-calls-table tbody tr:hover {
                background: var(--ed-surface-hover);
            }
        }

        @media (max-width: 640px) {
            body .tab-pane .orch-role-list {
                grid-template-columns: minmax(0, 1fr);
            }
            body .tab-pane .orch-settings-card,
            body .tab-pane .recent-calls-card {
                padding: 12px 14px;
            }
        }

        @media (max-width: 480px) {
            body .tab-pane .quota-dual-row {
                grid-template-columns: minmax(0, 1fr);
                gap: 8px;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            *,
            *::before,
            *::after {
                animation-duration: 0.001ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.001ms !important;
                scroll-behavior: auto !important;
            }
        }
    `;
}

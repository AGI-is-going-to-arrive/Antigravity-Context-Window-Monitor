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
            --font-mono: var(--ed-mono);

            /* Context Composition 9-Category Distinct Palette (Dark Mode) */
            --ctx-cat-system: #7C93B0;
            --ctx-cat-rules-skills: #F97352;
            --ctx-cat-plugins-mcp: #22D3EE;
            --ctx-cat-subagents: #F472B6;
            --ctx-cat-user: #3B82F6;
            --ctx-cat-assistant: #A855F7;
            --ctx-cat-tools: #F5B841;
            --ctx-cat-media: #22C55E;
            --ctx-cat-other: #A8A29E;
            --ctx-cat-free: var(--ed-track);

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
        body:is(.vscode-light, [data-vscode-theme-kind="vscode-light"], [data-acm-theme="light"]) {
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

            --ed-good: #0B6B41;
            --ed-good-fill: #128052;
            --ed-good-tint: rgba(14, 116, 72, 0.10);
            --ed-good-border: rgba(14, 116, 72, 0.28);

            --ed-warn: #7C4402;
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

            /* Context Composition 9-Category Distinct Palette (Light Mode, WCAG AA) */
            --ctx-cat-system: #475569;
            --ctx-cat-rules-skills: #C2410C;
            --ctx-cat-plugins-mcp: #0E7490;
            --ctx-cat-subagents: #BE185D;
            --ctx-cat-user: #1D4ED8;
            --ctx-cat-assistant: #7E22CE;
            --ctx-cat-tools: #A16207;
            --ctx-cat-media: #15803D;
            --ctx-cat-other: #78716C;
            --ctx-cat-free: var(--ed-track);

            --ed-shadow-popover: 0 12px 30px rgba(17, 19, 24, 0.12), 0 2px 8px rgba(17, 19, 24, 0.06);
            --ed-shadow-tooltip: 0 4px 12px rgba(17, 19, 24, 0.14);
            --ed-shadow-segment: 0 1px 2px rgba(17, 19, 24, 0.08);

            color-scheme: light;
        }

        /* High-Contrast Themes (Dark & Light): native VS Code / App Sidecar / OS contrast pass-through */
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"],
            [data-acm-theme="hc"], [data-acm-theme="hc-light"]) {
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

            /* Context Composition 9-Category Palette (High-Contrast Dark) */
            --ctx-cat-system: #9FB8D8;
            --ctx-cat-rules-skills: #FF8C69;
            --ctx-cat-plugins-mcp: #38E8FF;
            --ctx-cat-subagents: #FF85C8;
            --ctx-cat-user: #60A5FA;
            --ctx-cat-assistant: #C084FC;
            --ctx-cat-tools: #FFD15C;
            --ctx-cat-media: #4ADE80;
            --ctx-cat-other: #D6D3D1;
            --ctx-cat-free: Canvas;
            --ctx-cat-free-border: #9CA3AF;
        }
        body:is(.vscode-high-contrast-light, [data-vscode-theme-kind="vscode-high-contrast-light"], [data-acm-theme="hc-light"]) {
            color-scheme: light;

            /* Context Composition 9-Category Palette (High-Contrast Light — fixed dark-ink contrast on Canvas) */
            --ctx-cat-system: #334155;
            --ctx-cat-rules-skills: #9A3412;
            --ctx-cat-plugins-mcp: #155E75;
            --ctx-cat-subagents: #9D174D;
            --ctx-cat-user: #1E40AF;
            --ctx-cat-assistant: #6B21A8;
            --ctx-cat-tools: #854D0E;
            --ctx-cat-media: #166534;
            --ctx-cat-other: #57534E;
            --ctx-cat-free: Canvas;
            --ctx-cat-free-border: #57534E;
        }
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"],
            [data-acm-theme="hc"], [data-acm-theme="hc-light"])
            :is(.ctx-dot.is-free, .ctx-seg-slice.is-free) {
            background: var(--ctx-cat-free, Canvas);
            outline: 1px solid var(--ctx-cat-free-border, var(--ed-border));
            opacity: 1;
        }
        @media (forced-colors: active) {
            body .ctx-seg-slice:not(.is-free),
            body .ctx-dot:not(.is-free),
            body .ctx-legend-swatch {
                forced-color-adjust: none;
            }
            body .ctx-dot.is-free,
            body .ctx-seg-slice.is-free {
                background: Canvas;
                outline: 1px solid CanvasText;
            }
            body #acmRichTipPopover,
            body .overview-d9-banner,
            body .overview-swarm-strip,
            body .handoff-preview-box,
            body .recovery-brief-card,
            body .topbar-util-btn[aria-pressed="true"],
            body .tab-btn[aria-selected="true"] {
                border: 1px solid CanvasText;
                background: Canvas;
                color: CanvasText;
            }
        }
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"],
            [data-acm-theme="hc"], [data-acm-theme="hc-light"])
            :is(.overview-meter, .quota-bar-wrap, .prc-monthly-bar-wrap, .cost-bar-track, .tool-rank-bar-wrap, .acct-quota-bar, .telemetry-bar-track, .telemetry-cache-bar-track, .ctx-seg-bar, .ctx-dot) {
            outline: 1px solid var(--ed-border);
        }
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"],
            [data-acm-theme="hc"], [data-acm-theme="hc-light"])
            .telemetry-cache-seg + .telemetry-cache-seg {
            border-inline-start: 1px solid var(--ed-bg);
        }
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"],
            [data-acm-theme="hc"], [data-acm-theme="hc-light"])
            .toggle-cb:checked + .toggle-track {
            border-color: var(--ed-border);
        }
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"],
            [data-acm-theme="hc"], [data-acm-theme="hc-light"])
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
        /* Per-view narrow-pane compact language (<=480px CSS px, view-local only) */
        body[data-lang="both"][data-view-lang="zh"] :is(.bi-en, .bi-sep) { display: none; }
        body[data-lang="both"][data-view-lang="zh"] .bi-zh { font-size: 1em; color: inherit; font-weight: inherit; }
        body[data-lang="both"][data-view-lang="en"] :is(.bi-zh, .bi-sep) { display: none; }

        /* Native HUD auto-hide on Overview tab unless Always Show is enabled */
        body[data-active-tab="overview"][data-hud-auto-hide-overview="true"] .native-hud-host { display: none; }

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
            .stg-status-pill.is-connected,
            .stg-status-pill.is-uptodate,
            .stg-status-pill.is-inactive,
            .stg-status-pill.is-update,
            .stg-status-pill.is-error,
            .low-quota-title,
            .low-quota-pool-chip,
            .overview-watermark-pill.is-tier-exceeded,
            .native-hud-chip.is-warn,
            .native-hud-chip.is-danger,
            .tag-notice
        ) :is(.bi-sep, .bi-zh) {
            color: inherit;
        }

        /* ═══ 4. Account Popover L3 Surface (base masthead geometry in getStyles) ═══ */
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

        /* Inputs follow Light/Dark well contrast (base form controls already styled in getStyles) */
        body .tab-pane .prc-edit-input {
            background-color: var(--ed-input-bg);
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm);
            color: var(--ed-ink);
            box-shadow: none;
            height: 32px;
        }
        body:is(.vscode-light, [data-vscode-theme-kind="vscode-light"], [data-acm-theme="light"]) :is(.tab-pane .stg-select-row select, .conv-switcher-select) {
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='%235A6475' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E");
        }

        /* ═══ 6. Tab 1: Overview (Editorial Overrides Only — base geometry in getOverviewStyles) ═══ */
        body .monitor-overview { width: auto; padding: 4px 0 0; }
        body .overview-header { align-items: baseline; gap: 6px 14px; padding-bottom: 16px; }
        body .overview-header .overview-meta, body .overview-plan-pill { margin: 0; font-size: 12px; }
        body .overview-grid { border: 0; }
        body .monitor-overview .overview-section-heading { align-items: baseline; flex-wrap: wrap; column-gap: 0; row-gap: 2px; }
        body .overview-state-dot { width: 8px; margin-inline-end: 8px; background: var(--ed-ink-muted); color: var(--ed-ink-muted); }
        body [data-monitor-state="active"] .overview-state-dot { background: var(--ed-good); color: var(--ed-good); }
        body [data-monitor-state="disconnected"] .overview-state-dot { background: var(--ed-danger); color: var(--ed-danger); }
        body .overview-reading { margin-top: 14px; }
        body .overview-reading strong { font-family: var(--ed-sans); font-size: 1.75rem; color: var(--ed-ink); }
        body .overview-percent { font-size: 1rem; font-weight: 650; }
        body .overview-meter { margin: 10px 0 8px; }
        body .overview-meter.is-unknown { opacity: 0.72; }
        body .overview-notices { margin: 10px 0; padding: 8px 12px 8px 26px; border-radius: var(--ed-radius-sm); background: var(--ed-warn-tint); border: 1px solid var(--ed-warn-border); color: var(--ed-warn); font-size: 12px; }
        body .overview-details { margin: 14px 0 10px; }
        body .overview-details summary { list-style: none; display: flex; align-items: center; flex-wrap: wrap; column-gap: 0; row-gap: 2px; padding: 9px 6px; margin-inline: -6px; border-radius: var(--ed-radius-sm); font-size: 12.5px; color: var(--ed-ink); transition: background var(--ed-dur-fast) var(--ed-ease); }
        body .overview-details summary::-webkit-details-marker { display: none; }
        body .overview-details summary::before { content: ''; display: inline-block; flex-shrink: 0; width: 5px; height: 5px; border-right: 1.5px solid var(--ed-ink-muted); border-bottom: 1.5px solid var(--ed-ink-muted); transform: rotate(-45deg); margin-inline-end: 8px; transition: transform 160ms var(--ed-ease), border-color 160ms var(--ed-ease); }
        body .overview-details[open] > summary::before { transform: rotate(45deg); border-color: var(--ed-accent); }
        body .overview-details h3 { margin: 10px 0 6px; font-size: 12px; color: var(--ed-ink-secondary); }
        body .overview-quotas { margin: 8px 0 10px; }
        body .overview-quota-row { padding-block: 10px 12px; }
        body .overview-quota-heading strong.overview-quota-unknown { font-size: 0.875rem; font-weight: 500; color: var(--ed-ink-muted); }
        body .overview-action { flex-wrap: wrap; column-gap: 0; row-gap: 2px; font-size: 12.5px; text-decoration: none; }
        body .overview-action svg { margin-inline-start: 6px; }
        body .overview-footer { padding: 12px 18px; }
        body .overview-footer .overview-action { margin-inline-start: 0; }
        body .overview-footer p strong { font-weight: 650; color: var(--ed-ink); }

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
        body .tab-pane .act-stat .act-stat-val { font-weight: 650; }
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
        body .tab-pane .cp-card {
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
        body .tab-pane .act-card-row .val:not(.val-cost):not(.val-hit):not(.val-credits) { color: var(--ed-ink); }
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
        body .tab-pane .tool-rank-bar-wrap { height: 8px; background: var(--ed-track); border-radius: var(--ed-radius-pill); overflow: hidden; }
        body .tab-pane .tool-rank-row .tool-rank-bar { background: var(--ed-accent); border-radius: var(--ed-radius-pill); background-image: none; }
        body .tab-pane .act-tl-turn { border: 1px solid var(--ed-border); border-radius: var(--ed-radius-md); background: var(--ed-surface); }
        body .tab-pane :is(.act-tl-turn-header, .ci-section-header) { background: var(--ed-surface-well); }
        body .tab-pane .act-trend-svg > polyline { stroke: var(--ed-accent); }
        body .tab-pane .act-trend-svg > polygon { fill: var(--ed-accent-tint); }

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

        /* ═══ 10. Tab 6: Calendar (zero-overflow safety; tooltips handled by #acmRichTipPopover) ═══ */
        body .tab-pane .cal-grid {
            grid-template-columns: repeat(7, minmax(0, 1fr));
        }
        body .tab-pane .cal-overview-val,
        body .tab-pane .cal-day-total-val {
            overflow-wrap: anywhere;
        }

        /* ═══ 11. Tab 9: About Colophon (harmonizes with getAboutTabStyles) ═══ */
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

        /* ═══ 13. Universal Focus, Hover & Disabled States ═══ */
        body :is(.panel-topbar, .tab-pane) :is(button, a, input, select, textarea, summary):focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
            box-shadow: none;
        }
        body .panel-topbar :is(.tab-btn, .lang-btn):focus-visible { outline-offset: -3px; }
        body .tab-pane .num-spinner .threshold-input:focus-visible { outline: none; }
        body .tab-pane :is(.num-spinner, .ses-search-wrap):focus-within {
            border-color: var(--ed-accent);
            outline: 2px solid var(--ed-accent);
            outline-offset: 1px;
        }
        body .tab-pane .ses-search-input:focus-visible { outline: none; }

        body :is(.panel-topbar, .tab-pane) [data-tooltip]::after {
            content: none !important;
            display: none !important;
        }

        /* ═══ Unified Body-Level Adaptive Popover Engine (#acmRichTipPopover) ═══ */
        body .acm-rich-tip {
            position: fixed;
            top: 0;
            left: 0;
            z-index: 950;
            box-sizing: border-box;
            width: max-content;
            min-width: 140px;
            max-width: min(300px, calc(100vw - 16px));
            max-height: min(340px, calc(100vh - 24px));
            overflow-y: auto;
            overscroll-behavior: contain;
            padding: 9px 11px;
            border-radius: var(--ed-radius-md);
            border: 1px solid var(--ed-border-strong);
            background: var(--ed-surface-overlay);
            color: var(--ed-ink);
            box-shadow: var(--ed-shadow-popover);
            font-family: var(--ed-sans);
            font-size: 12px;
            line-height: 1.48;
            word-break: break-word;
            overflow-wrap: anywhere;
            user-select: text;
        }
        body .acm-rich-tip[hidden] {
            display: none;
        }
        body .acm-rich-tip[data-pinned="true"] {
            border-color: var(--ed-accent-border);
        }
        body .acm-rich-tip-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 5px;
        }
        body .acm-rich-tip-head[hidden] {
            display: none;
        }
        body .acm-rich-tip-title {
            font-size: 12px;
            font-weight: 650;
            color: var(--ed-ink);
            line-height: 1.35;
            min-width: 0;
        }
        body .acm-rich-tip-close {
            appearance: none;
            border: 1px solid transparent;
            background: transparent;
            color: var(--ed-ink-muted);
            width: 20px;
            height: 20px;
            margin: -2px -4px -2px 0;
            padding: 0;
            border-radius: var(--ed-radius-xs);
            font-size: 14px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex-shrink: 0;
        }
        body .acm-rich-tip-close[hidden] {
            display: none;
        }
        body .acm-rich-tip-close:hover {
            background: var(--ed-surface-hover);
            color: var(--ed-ink);
            border-color: var(--ed-border-strong);
        }
        body .acm-rich-tip-close:focus-visible {
            background: var(--ed-surface-hover);
            color: var(--ed-ink);
            border-color: var(--ed-accent);
            outline: 2px solid var(--ed-accent);
            outline-offset: 1px;
        }
        body .acm-rich-tip-body {
            color: var(--ed-ink-secondary);
            white-space: pre-line;
            font-size: 11.5px;
            line-height: 1.5;
        }
        body .acm-rich-tip-body .acm-rich-tip-lead {
            margin: 0 0 6px;
            white-space: pre-line;
        }
        body .acm-rich-tip-meta {
            margin-top: 6px;
            padding-top: 6px;
            border-top: 1px solid var(--ed-border);
            color: var(--ed-ink-muted);
            font-size: 11px;
            line-height: 1.42;
            white-space: pre-line;
        }
        body .acm-rich-tip-meta[hidden] {
            display: none;
        }
        body .rich-tip-disabled-wrap {
            display: inline-flex;
            align-items: center;
            position: relative;
            cursor: help;
            border-radius: var(--ed-radius-sm);
        }
        body .rich-tip-disabled-wrap:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }
        body .rich-tip-disabled-wrap > button:disabled,
        body .rich-tip-disabled-wrap > [disabled] {
            pointer-events: none;
        }
        body [data-tip-body],
        body [data-tip-html-id] {
            scroll-margin: 12px;
        }
        body :is(.overview-telemetry-cell, .ctx-measure-badge, .ctx-cap-pill, .ctx-compaction-chip, .overview-watermark-pill, .turn-start-pill, .overview-turn-delta, .orch-cold-switch-pill, .quota-runway-pill, .native-hud-chip, .overview-precision-pill, .stg-status-pill, .stale-badge)[data-tip-body] {
            cursor: help;
        }

        body .tab-pane :is(.prc-btn, .ses-filter-btn, .cal-summary-btn, .cal-nav-btn, .preset-btn):disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }

        @media (hover: hover) {
            body .lang-btn:not(.active):hover,
            body .tab-btn:not(.active):hover,
            body .tab-pane .cal-summary-btn:not(.active):hover {
                color: var(--ed-ink);
                background: var(--ed-surface-hover);
            }
            body :is(.panel-topbar .action-btn, .acct-popover-trigger, .tab-pane .action-btn, .tab-pane .prc-btn:not(.prc-btn-primary), .tab-pane .cal-nav-btn, .tab-pane .preset-btn:not(.is-active):not(.active), .tab-pane .copy-btn, .tab-pane .about-github-link, .tab-pane .privacy-btn:not(.active), .tab-pane .ses-act-btn:not(:disabled)):not(:disabled):hover {
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
            body .tab-pane .cal-clear-btn:not(:disabled):hover {
                background: var(--ed-danger-tint);
                border-color: var(--ed-danger);
                color: var(--ed-danger);
            }
            body .tab-pane :is(.num-spinner-btn, .ses-filter-btn:not(.is-active)):hover {
                background: var(--ed-surface-hover);
                color: var(--ed-ink);
            }
            body .tab-pane :is(.toggle-row, .collapsible > summary, .overview-details > summary, .profile-technical > summary, .model-quota-details > summary, .ses-row:not(.is-current), .act-card-row, .cost-detail-row, .prc-edit-row, .recent-calls-table tbody tr):hover {
                background: var(--ed-surface-hover);
            }
            body .tab-pane .ses-shortcut:not(.is-disabled):hover {
                border-color: var(--ed-accent-border);
                background: var(--ed-surface-hover);
            }
            body .tab-pane .cal-cell.has-data:hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-border-strong);
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
        body #tab-settings :is(.stg-card, #quotaNotifyInput) { scroll-margin-block-start: calc(var(--acm-topbar-h, 118px) + 12px); }
        body .stg-categories {
            display: grid;
            gap: 10px 16px;
            align-items: start;
        }
        body .stg-column { display: grid; gap: 10px; min-width: 0; }
        body .stg-column > .stg-group { margin: 0; padding: 0 16px; }
        body .stg-group[open] { padding-bottom: 16px; }
        body .stg-group > summary.stg-header {
            min-height: 48px;
            padding-block: 10px;
            margin: 0;
            cursor: pointer;
            list-style: none;
        }
        body .stg-group > summary::-webkit-details-marker { display: none; }
        body .stg-group > summary::before {
            content: '';
            margin-inline-end: 4px;
            width: 7px;
            height: 7px;
            flex-shrink: 0;
            border: solid currentColor;
            border-width: 0 1.5px 1.5px 0;
            transform: rotate(-45deg);
        }
        body .stg-group[open] > summary::before { transform: rotate(45deg); }
        body .stg-group-label { font-weight: 600; font-size: .9rem; }
        body .stg-group > summary:hover { color: var(--ed-accent); }
        body .stg-updates { margin-bottom: 14px; }
        body .stg-updates .stg-header { margin-bottom: 6px; }
        body .stg-update-summary {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: baseline;
            gap: 4px 12px;
            margin-bottom: 6px;
        }
        body .stg-update-summary p { margin: 0; }
        body .stg-update-summary .storage-actions { margin: 0; }
        body .stg-checked-at { display: inline-block; margin-inline-start: 8px; color: var(--ed-ink-muted); }
        body .stg-updates .action-btn[hidden] { display: none; }
        body .stg-updates .stg-guide-details { margin-top: 4px; }
        body .ctx-breakdown-card.overview-details { padding: 0; background: transparent; border-inline: 0; border-radius: 0; }
        body .ctx-breakdown-card[open] .ctx-breakdown-head { margin-top: 8px; }
        @media (min-width: 900px) {
            body .stg-categories { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
            body .tab-btn { padding: 7px 3px 8px; font-size: 11px; }
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

        /* ═══ 15. v1.17.3 Orchestrator, Dual-Window Quota & Recent Calls ═══ */

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

        /* ═══ v1.17.5 Editorial Components (Masthead Switcher, Context Breakdown, Turn Diagnostics, Runway, Isolation) ═══ */

        .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
        }

        /* Masthead Context Bar (Conversation Switcher + Lock to Main Agent + Surface/Stale Badges) */
        body .masthead-context-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 6px 10px;
            padding: 3px var(--ed-gutter) 5px;
            max-width: var(--ed-column);
            margin-inline: auto;
            width: 100%;
            box-sizing: border-box;
        }
        body .masthead-context-controls {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px 8px;
            min-width: 0;
            flex: 1 1 220px;
        }
        body .conv-switcher-wrap {
            display: inline-flex;
            align-items: center;
            min-width: 0;
            flex: 1 1 180px;
            max-width: 340px;
        }
        body .conv-switcher-select {
            width: 100%;
            min-width: 0;
            height: 26px;
            padding: 0 24px 0 9px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-control-border);
            background-color: var(--ed-input-bg);
            color: var(--ed-ink);
            font-family: inherit;
            font-size: 12px;
            font-weight: 500;
            line-height: 1.3;
            text-overflow: ellipsis;
            cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='%238C98A9' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 7px center;
        }
        body :is(.conv-switcher-select, .lock-main-btn, .native-hud-toggle):focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 1px;
        }
        body .lock-main-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            height: 26px;
            padding: 0 10px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-border-strong);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
            font-family: inherit;
            font-size: 11.5px;
            font-weight: 550;
            cursor: pointer;
            white-space: nowrap;
            transition: background var(--ed-dur-fast) var(--ed-ease),
                border-color var(--ed-dur-fast) var(--ed-ease),
                color var(--ed-dur-fast) var(--ed-ease);
        }
        body :is(.lock-main-btn, .native-hud-toggle):hover {
            background: var(--ed-surface-hover);
            color: var(--ed-ink);
        }
        body .masthead-context-badges {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
            flex-shrink: 0;
        }
        body .surface-badge {
            display: inline-flex;
            align-items: center;
            height: 22px;
            padding: 0 8px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            color: var(--ed-ink-muted);
            font-size: 11px;
            font-weight: 550;
            white-space: nowrap;
        }
        body .surface-badge[data-surface="app-sidecar"] {
            background: var(--ed-accent-tint);
            border-color: var(--ed-accent-border);
            color: var(--ed-accent);
        }
        body .stale-badge {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            height: 22px;
            padding: 0 8px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-warn-tint);
            border: 1px solid var(--ed-warn-border);
            color: var(--ed-warn);
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
        }
        body .stale-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: currentColor;
            flex-shrink: 0;
        }

        /* Context Composition Breakdown Card (Overview Tab) */
        body .ctx-breakdown-card {
            margin: 14px 0 12px;
            padding: 13px 14px;
            border-radius: var(--ed-radius-md);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            display: flex;
            flex-direction: column;
            gap: 10px;
            min-width: 0;
        }
        body :is(.ctx-breakdown-head, .low-quota-banner-head) {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 6px 10px;
        }
        body .ctx-breakdown-title-wrap {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px 8px;
            min-width: 0;
        }
        body .ctx-breakdown-title-wrap h4 {
            margin: 0;
            font-size: 0.8125rem;
            font-weight: 650;
            color: var(--ed-ink);
        }
        body .ctx-measure-badge {
            display: inline-flex;
            align-items: center;
            padding: 1px 7px;
            border-radius: var(--ed-radius-pill);
            font-size: 11px;
            font-weight: 600;
            border: 1px solid var(--ed-border);
            background: var(--ed-surface);
            color: var(--ed-ink-secondary);
        }
        body .ctx-measure-badge.is-awaiting {
            background: var(--ed-surface);
            border-color: var(--ed-border);
            color: var(--ed-ink-muted);
        }
        body .ctx-viz-toggle {
            display: inline-flex;
            align-items: center;
            padding: 2px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface);
            gap: 2px;
        }
        body .ctx-viz-btn {
            border: 0;
            background: transparent;
            color: var(--ed-ink-muted);
            font-family: inherit;
            font-size: 11px;
            font-weight: 550;
            padding: 3px 8px;
            border-radius: calc(var(--ed-radius-sm) - 2px);
            cursor: pointer;
            white-space: nowrap;
        }
        body .ctx-viz-btn.is-active {
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            font-weight: 650;
        }
        body .ctx-dual-cap-row {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        }
        body .ctx-cap-pill {
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            justify-content: space-between;
            gap: 2px 8px;
            padding: 6px 9px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface);
            font-size: 11.5px;
        }
        body .ctx-cap-label {
            color: var(--ed-ink-muted);
            font-size: 11px;
            width: 100%;
        }
        body .ctx-cap-value {
            color: var(--ed-ink);
            font-weight: 600;
            font-size: 12px;
        }
        body .ctx-cap-pct {
            color: var(--ed-accent);
            font-weight: 650;
            font-size: 11.5px;
        }
        body .ctx-cap-pill.is-native .ctx-cap-pct {
            color: var(--ed-ink-secondary);
        }
        body .ctx-compaction-chip {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 4px 6px;
            padding: 5px 9px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-good-tint);
            border: 1px solid var(--ed-good-border);
            color: var(--ed-good);
            font-size: 11.5px;
        }
        body .ctx-compaction-range {
            color: var(--ed-ink-secondary);
        }
        body .ctx-awaiting-msg {
            font-size: 12px;
            color: var(--ed-ink-muted);
            padding: 6px 2px;
        }

        /* Dual-mode visibility: Bar vs 20x5 100-Dot Matrix */
        body .ctx-breakdown-card[data-viz-mode="bar"] .ctx-viz-dots-wrap { display: none; }
        body .ctx-breakdown-card[data-viz-mode="dots"] .ctx-viz-bar-wrap { display: none; }

        body .ctx-seg-bar {
            display: flex;
            width: 100%;
            height: 12px;
            border-radius: var(--ed-radius-pill);
            overflow: hidden;
            background: var(--ed-track);
            gap: 1px;
        }
        body .ctx-seg-slice {
            display: block;
            height: 100%;
            min-width: 2px;
            cursor: pointer;
            transition: opacity 140ms var(--ed-ease);
        }
        body .ctx-seg-slice.is-free {
            background: transparent;
            flex: 1 1 auto;
        }
        body .ctx-dot-matrix {
            display: grid;
            grid-template-columns: repeat(20, minmax(0, 1fr));
            gap: 3px;
            padding: 6px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
        }
        body .ctx-dot {
            display: block;
            aspect-ratio: 1 / 1;
            width: 100%;
            min-width: 6px;
            border-radius: 2px;
            cursor: pointer;
            transition: opacity 140ms var(--ed-ease), transform 120ms var(--ed-ease);
        }
        body .ctx-dot.is-free {
            background: var(--ed-track);
            opacity: 0.65;
        }
        body .ctx-selected-drawer {
            padding: 10px 12px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-accent-border);
            background: var(--ed-surface);
            display: flex;
            flex-direction: column;
            gap: 7px;
            min-width: 0;
        }
        body .ctx-selected-drawer[hidden] {
            display: none;
        }
        body .ctx-drawer-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        body .ctx-drawer-title-wrap {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            min-width: 0;
        }
        body .ctx-drawer-title {
            font-size: 12.5px;
            font-weight: 650;
            color: var(--ed-ink);
        }
        body .ctx-drawer-close {
            appearance: none;
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-muted);
            width: 22px;
            height: 22px;
            border-radius: var(--ed-radius-xs);
            font-size: 14px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            flex-shrink: 0;
        }
        body .ctx-drawer-close:hover,
        body .ctx-drawer-close:focus-visible {
            background: var(--ed-surface-hover);
            color: var(--ed-ink);
            border-color: var(--ed-border-strong);
        }
        body .ctx-drawer-desc {
            margin: 0;
            font-size: 11.5px;
            color: var(--ed-ink-secondary);
            line-height: 1.48;
        }
        body .ctx-drawer-metrics {
            display: flex;
            flex-wrap: wrap;
            gap: 5px 6px;
        }
        body .ctx-drawer-stat {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 7px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            font-size: 11px;
            color: var(--ed-ink-secondary);
        }
        body .ctx-drawer-stat strong {
            color: var(--ed-ink);
            font-weight: 650;
        }
        body .ctx-drawer-subhead {
            font-size: 11px;
            font-weight: 600;
            color: var(--ed-ink-muted);
        }
        body .ctx-drawer-items {
            list-style: none;
            margin: 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        body .ctx-drawer-item {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 7px;
            border-radius: var(--ed-radius-xs);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            font-size: 11.5px;
            min-width: 0;
        }
        body :is(.ctx-drawer-item-title, .ctx-largest-title) {
            flex: 1 1 auto;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--ed-ink);
        }
        body :is(.ctx-drawer-item-val, .ctx-legend-val) {
            font-weight: 600;
            color: var(--ed-ink);
            white-space: nowrap;
        }
        body :is(.ctx-drawer-item-pct, .ctx-legend-pct) {
            color: var(--ed-ink-muted);
            font-size: 11px;
            white-space: nowrap;
        }
        body .ctx-drawer-tip {
            margin: 0;
            padding: 6px 8px;
            border-radius: var(--ed-radius-xs);
            background: var(--ed-accent-tint);
            border: 1px solid var(--ed-accent-border);
            font-size: 11.5px;
            color: var(--ed-ink-secondary);
            line-height: 1.45;
        }
        body .ctx-drawer-tip strong {
            color: var(--ed-accent);
            font-weight: 650;
        }
        body .ctx-legend {
            list-style: none;
            margin: 0;
            padding: 0;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
            gap: 4px 8px;
        }
        body .ctx-legend-row {
            margin: 0;
            padding: 0;
            min-width: 0;
            display: flex;
        }
        body .ctx-legend-item {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 6px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid transparent;
            background: transparent;
            color: var(--ed-ink);
            font-family: inherit;
            font-size: 11.5px;
            text-align: start;
            cursor: pointer;
            min-width: 0;
            transition: background 120ms var(--ed-ease), opacity 140ms var(--ed-ease), border-color 120ms var(--ed-ease);
        }
        body .ctx-legend-item:hover,
        body .ctx-legend-item:focus-visible {
            background: var(--ed-surface);
            border-color: var(--ed-border);
        }
        body .ctx-legend-item.is-locked {
            background: var(--ed-surface);
            border-color: var(--ed-accent-border);
        }
        body .ctx-legend-swatch {
            width: 8px;
            height: 8px;
            border-radius: 2px;
            flex-shrink: 0;
        }
        body .ctx-legend-name {
            flex: 1 1 auto;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--ed-ink-secondary);
        }

        /* Synced hover/focus/click-lock category highlighting */
        body .ctx-breakdown-card[data-highlight-cat] .ctx-seg-slice,
        body .ctx-breakdown-card[data-highlight-cat] .ctx-dot,
        body .ctx-breakdown-card[data-highlight-cat] .ctx-legend-item {
            opacity: 0.28;
        }
        body .ctx-breakdown-card[data-highlight-cat="system"] [data-ctx-cat="system"],
        body .ctx-breakdown-card[data-highlight-cat="rules_skills"] [data-ctx-cat="rules_skills"],
        body .ctx-breakdown-card[data-highlight-cat="plugins_mcp"] [data-ctx-cat="plugins_mcp"],
        body .ctx-breakdown-card[data-highlight-cat="subagents"] [data-ctx-cat="subagents"],
        body .ctx-breakdown-card[data-highlight-cat="user"] [data-ctx-cat="user"],
        body .ctx-breakdown-card[data-highlight-cat="assistant_thinking"] [data-ctx-cat="assistant_thinking"],
        body .ctx-breakdown-card[data-highlight-cat="tools"] [data-ctx-cat="tools"],
        body .ctx-breakdown-card[data-highlight-cat="media_files"] [data-ctx-cat="media_files"],
        body .ctx-breakdown-card[data-highlight-cat="other"] [data-ctx-cat="other"],
        body .ctx-breakdown-card[data-highlight-cat="free"] [data-ctx-cat="free"] {
            opacity: 1;
        }

        /* Largest Items collapsible list */
        body .ctx-largest-details {
            border-top: 1px solid var(--ed-border);
            padding-top: 6px;
        }
        body .ctx-largest-details summary {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            color: var(--ed-ink-secondary);
            padding-block: 3px;
        }
        body .ctx-largest-count {
            font-size: 11px;
            font-weight: 600;
            padding: 0 6px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            color: var(--ed-ink-muted);
        }
        body .ctx-largest-list {
            list-style: none;
            margin: 6px 0 0;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        body .ctx-largest-row {
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 11.5px;
            padding: 3px 6px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            min-width: 0;
        }
        body .ctx-largest-tokens {
            font-weight: 600;
            white-space: nowrap;
        }
        body .ctx-largest-pct {
            color: var(--ed-ink-muted);
            white-space: nowrap;
        }

        /* Quick Copy Actions */
        body .ctx-quick-actions {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px 8px;
            padding-top: 4px;
            border-top: 1px solid var(--ed-border);
        }
        body .ctx-action-btn {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            height: 28px;
            padding: 0 10px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-control-border);
            background: var(--ed-surface);
            color: var(--ed-ink);
            font-family: inherit;
            font-size: 11.5px;
            font-weight: 550;
            cursor: pointer;
            transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease);
        }

        /* Turn Start Pills & Net Context Growth Delta (GM Data Tab) */
        body .turn-start-pill {
            display: inline-flex;
            align-items: center;
            padding: 1px 6px;
            border-radius: var(--ed-radius-pill);
            font-size: 10.5px;
            font-weight: 600;
            line-height: 1.35;
            white-space: nowrap;
            border: 1px solid transparent;
        }
        body .turn-start-pill.is-cold {
            background: var(--ed-surface-well);
            border-color: var(--ed-border);
            color: var(--ed-ink-muted);
        }
        body .rc-delta {
            font-weight: 600;
        }
        body .rc-delta-pos {
            color: var(--ed-ink-secondary);
        }
        body .rc-delta-neg {
            color: var(--ed-good);
        }
        body .rc-delta-compaction {
            padding: 1px 5px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-good-tint);
            border: 1px solid var(--ed-good-border);
        }

        /* Quota Runway Pills, Stale Fallback Banner & Custom Model Isolation */
        body .quota-runway-row {
            margin-top: 6px;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
        }
        body .quota-runway-pill {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: var(--ed-radius-pill);
            font-size: 11px;
            font-weight: 600;
            border: 1px solid var(--ed-border);
        }
        body .quota-runway-pill.is-muted {
            background: var(--ed-surface-well);
            color: var(--ed-ink-muted);
        }
        body .models-runway-card {
            margin-bottom: 14px;
        }
        body .models-runway-head h3 {
            display: flex;
            align-items: center;
            gap: 6px;
            margin: 0 0 10px;
            font-size: 0.875rem;
            font-weight: 600;
        }
        body .models-runway-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
            gap: 8px;
        }
        body .models-runway-item {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 8px 10px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
        }
        body .models-runway-pool {
            font-size: 12px;
            font-weight: 600;
            color: var(--ed-ink);
        }
        body .weekly-pace-body {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px 8px;
            margin-top: 2px;
        }
        body .weekly-pace-badge {
            display: inline-flex;
            align-items: center;
            padding: 1px 7px;
            border-radius: 999px;
            font-size: 11px;
            font-weight: 600;
            line-height: 1.45;
            white-space: nowrap;
            border: 1px solid var(--ed-border);
            background: var(--ed-surface);
            color: var(--ed-ink-secondary);
        }
        body .weekly-pace-badge.is-safe {
            background: var(--ed-good-tint);
            border-color: var(--ed-good-border);
            color: var(--ed-good);
        }
        body .weekly-pace-badge.is-risk {
            background: var(--ed-warn-tint);
            border-color: var(--ed-warn-border);
            color: var(--ed-warn);
        }
        body .weekly-pace-badge.is-exhausted {
            background: var(--ed-danger-tint);
            border-color: var(--ed-danger-border);
            color: var(--ed-danger);
        }
        body .weekly-pace-badge.is-insufficient {
            background: var(--ed-surface);
            border-color: var(--ed-border);
            color: var(--ed-ink-muted);
        }
        body .weekly-pace-meta {
            font-size: 11.5px;
            color: var(--ed-ink-secondary);
        }
        body .stale-data-banner {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px 10px;
            margin-bottom: 12px;
            padding: 9px 12px;
            border-radius: var(--ed-radius-md);
            background: var(--ed-warn-tint);
            border: 1px solid var(--ed-warn-border);
            color: var(--ed-warn);
            font-size: 12px;
            line-height: 1.45;
        }
        body .stale-badge-pill {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-weight: 650;
            white-space: nowrap;
        }
        body .stale-banner-desc {
            color: var(--ed-ink-secondary);
        }
        body .custom-model-banner {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 10px 0;
            padding: 10px 12px;
            border-radius: var(--ed-radius-md);
            background: var(--ed-accent-tint);
            border: 1px solid var(--ed-accent-border);
            font-size: 12px;
            line-height: 1.48;
        }
        body .custom-model-pill {
            display: inline-flex;
            align-self: flex-start;
            font-weight: 650;
            color: var(--ed-accent);
        }
        body .custom-model-desc {
            color: var(--ed-ink-secondary);
        }
        body .custom-model-pools-collapse {
            margin: 8px 0 12px;
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            padding: 6px 10px;
            background: var(--ed-surface-well);
        }
        body .custom-model-pools-collapse summary {
            cursor: pointer;
            font-size: 12px;
            font-weight: 550;
            color: var(--ed-ink-muted);
            padding-block: 3px;
        }

        /* IDE-only Settings Card Styling on Antigravity App Sidecar */
        body .stg-card.is-ide-only .toggle-track {
            opacity: 0.55;
        }
        body .stg-card.is-ide-only .toggle-row,
        body .stg-card.is-ide-only select {
            cursor: not-allowed;
        }
        body .stg-ide-only-badge {
            margin-inline-start: auto;
            padding: 2px 7px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border-strong);
            color: var(--ed-ink-secondary);
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
        }

        /* ═══ v1.17.6 Native Ambient HUD, Overview Watermarks/Warnings, Settings & About Updates ═══ */

        /* Native Sidecar Collapsible Ambient HUD */
        body .native-hud-host {
            max-width: calc(var(--ed-column) + 2 * var(--ed-gutter));
            margin: -10px auto 14px;
            padding-inline: var(--ed-gutter);
            box-sizing: border-box;
        }
        body .native-hud-host[hidden] {
            display: none;
        }
        body .native-hud-bar {
            position: relative;
            border-radius: var(--ed-radius-md);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface);
            color: var(--ed-ink);
            min-width: 0;
            overflow: hidden;
        }
        body .native-hud-strip {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 6px 10px;
            padding: 6px 10px;
            min-width: 0;
        }
        body .native-hud-metrics {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px 10px;
            min-width: 0;
            flex: 1 1 220px;
        }
        body .native-hud-chip {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            min-width: 0;
            padding: 2px 7px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            font-size: 11.5px;
            line-height: 1.35;
            white-space: nowrap;
        }
        body .native-hud-chip-label {
            color: var(--ed-ink-muted);
            font-size: 10.5px;
            font-weight: 500;
        }
        body .native-hud-chip-val {
            color: var(--ed-ink);
            font-weight: 650;
        }
        body .native-hud-chip.is-good .native-hud-chip-val { color: var(--ed-good); }
        body .native-hud-chip.is-warn {
            border-color: var(--ed-warn-border);
            background: var(--ed-warn-tint);
        }
        body .native-hud-chip.is-warn .native-hud-chip-val { color: var(--ed-warn); }
        body .native-hud-chip.is-danger {
            border-color: var(--ed-danger-border);
            background: var(--ed-danger-tint);
        }
        body .native-hud-chip.is-danger .native-hud-chip-val { color: var(--ed-danger); }
        body .native-hud-chip.is-muted .native-hud-chip-val {
            color: var(--ed-ink-muted);
            font-weight: 550;
        }
        body .native-hud-ring-svg {
            width: 18px;
            height: 18px;
            flex-shrink: 0;
            transform: rotate(-90deg);
        }
        body .native-hud-ring-track {
            fill: none;
            stroke: var(--ed-track);
            stroke-width: 2.4;
        }
        body .native-hud-ring-fill {
            fill: none;
            stroke: var(--ed-accent);
            stroke-width: 2.4;
            stroke-linecap: round;
            transition: stroke-dashoffset var(--ed-dur-med) var(--ed-ease);
        }
        body .native-hud-chip.is-warn .native-hud-ring-fill { stroke: var(--ed-warn-fill); }
        body .native-hud-chip.is-danger .native-hud-ring-fill { stroke: var(--ed-danger-fill); }
        body .native-hud-chip.is-good .native-hud-ring-fill { stroke: var(--ed-good-fill); }
        body .native-hud-toggle {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            height: 24px;
            padding: 0 8px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-control-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
            font-family: inherit;
            font-size: 11px;
            font-weight: 550;
            cursor: pointer;
            white-space: nowrap;
            flex-shrink: 0;
            transition: background var(--ed-dur-fast) var(--ed-ease), color var(--ed-dur-fast) var(--ed-ease);
        }
        body .native-hud-toggle-chevron {
            transition: transform 160ms var(--ed-ease);
        }
        body .native-hud-bar[data-hud-expanded="true"] .native-hud-toggle-chevron {
            transform: rotate(180deg);
        }
        body .native-hud-drawer {
            border-top: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            padding: 10px 12px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-size: 11.5px;
            min-width: 0;
        }
        body .native-hud-drawer[hidden] {
            display: none;
        }
        body .native-hud-drawer-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 4px 10px;
            color: var(--ed-ink-secondary);
        }
        body .native-hud-drawer-model {
            font-weight: 600;
            color: var(--ed-ink);
            overflow-wrap: anywhere;
        }
        body .native-hud-drawer-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 155px), 1fr));
            gap: 6px 8px;
        }
        body .native-hud-card {
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 6px 8px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface);
            min-width: 0;
        }
        body .native-hud-card-label {
            font-size: 10.5px;
            color: var(--ed-ink-muted);
            font-weight: 500;
        }
        body .native-hud-card-val {
            font-size: 12px;
            font-weight: 600;
            color: var(--ed-ink);
            overflow-wrap: anywhere;
        }
        body .native-hud-card-sub {
            font-size: 10.5px;
            color: var(--ed-ink-secondary);
            overflow-wrap: anywhere;
        }

        /* Overview Dual-Watermark Bar Markers, Turn Cache Row, Low-Quota Banner & Jargon Tips */
        body .overview-meter-wrap {
            position: relative;
            margin: 10px 0 8px;
        }
        body .overview-meter-wrap .overview-meter {
            margin: 0;
        }
        body .overview-meter-markers {
            position: absolute;
            inset: -2px 0;
            pointer-events: none;
        }
        body .overview-watermark-tick {
            position: absolute;
            top: 0;
            bottom: 0;
            width: 2px;
            border-radius: 1px;
            pointer-events: auto;
            transform: translateX(-50%);
            cursor: help;
        }
        body .overview-watermark-tick.is-tier-200k {
            background: var(--ed-warn);
        }
        body .overview-watermark-tick.is-tier-200k.is-exceeded {
            background: var(--ed-danger);
        }
        body .overview-watermark-tick.is-compaction-cap {
            background: var(--ed-accent);
        }
        body .overview-watermark-meta {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px 8px;
            margin: 6px 0 8px;
            font-size: 11px;
            color: var(--ed-ink-muted);
        }
        body .overview-watermark-pill {
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            max-width: 100%;
            box-sizing: border-box;
            gap: 2px 4px;
            padding: 2px 8px;
            border-radius: 10px;
            line-height: 1.4;
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
            font-size: 11px;
            font-weight: 550;
        }
        body .overview-turn-cache-row {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px 8px;
            margin: 8px 0 10px;
            padding: 6px 9px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            font-size: 11.5px;
            color: var(--ed-ink-secondary);
        }
        body .overview-turn-delta {
            font-weight: 600;
            color: var(--ed-ink);
        }
        body .overview-turn-delta.is-compaction {
            color: var(--ed-good);
        }
        body .overview-telemetry-value.is-short-sample {
            font-size: 0.8125rem;
            font-weight: 600;
            color: var(--ed-ink-muted);
        }
        body .overview-context .orch-split-card {
            margin: 12px 0 10px;
        }
        body .low-quota-banner {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 12px;
            padding: 10px 12px;
            border-radius: var(--ed-radius-md);
            background: var(--ed-danger-tint);
            border: 1px solid var(--ed-danger-border);
            color: var(--ed-ink);
            font-size: 12px;
            line-height: 1.45;
        }
        body .low-quota-title {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-weight: 650;
            color: var(--ed-danger);
        }
        body .low-quota-pools {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
        }
        body .low-quota-pool-chip {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            padding: 2px 8px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface);
            border: 1px solid var(--ed-danger-border);
            color: var(--ed-danger);
            font-size: 11.5px;
            font-weight: 600;
        }
        body .low-quota-settings-btn {
            border: 1px solid var(--ed-danger-border);
            background: var(--ed-surface);
            color: var(--ed-ink);
            font-family: inherit;
            font-size: 11px;
            font-weight: 550;
            padding: 2px 8px;
            border-radius: var(--ed-radius-sm);
            cursor: pointer;
        }
        body .low-quota-settings-btn:hover {
            background: var(--ed-surface-hover);
        }

        /* Subtle Accessible Jargon Explainer Badge & Collapsible Core Glossary */
        body .jargon-tip {
            appearance: none;
            padding: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 15px;
            height: 15px;
            margin-inline-start: 4px;
            border-radius: 50%;
            border: 1px solid var(--ed-border-strong);
            background: var(--ed-surface);
            color: var(--ed-ink-muted);
            font-family: inherit;
            font-size: 10px;
            font-weight: 700;
            line-height: 1;
            cursor: help;
            vertical-align: middle;
            flex-shrink: 0;
        }
        body .jargon-tip:hover {
            border-color: var(--ed-accent);
            color: var(--ed-accent);
        }
        body .jargon-tip:focus-visible {
            border-color: var(--ed-accent);
            color: var(--ed-accent);
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }
        body .overview-precision-pill {
            display: inline-flex;
            align-items: center;
            padding: 0 5px;
            border-radius: var(--ed-radius-pill);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
            font-size: 11px;
            font-weight: 550;
            vertical-align: baseline;
        }
        body .overview-glossary {
            margin: 10px 0 0;
            border-bottom: 0;
        }
        body .overview-glossary-list {
            margin: 4px 0 8px;
            padding: 0;
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        body .overview-glossary-entry {
            display: flex;
            flex-direction: column;
            gap: 2px;
            padding: 6px 8px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
        }
        body .overview-glossary-entry dt {
            font-size: 11.5px;
            font-weight: 600;
            color: var(--ed-ink);
        }
        body .overview-glossary-entry dd {
            margin: 0;
            font-size: 11.5px;
            line-height: 1.48;
            color: var(--ed-ink-secondary);
        }

        /* Settings v1.17.6 Cards, Collapsible IDE Card, Status Pills, CDP Guide & Form Grid */
        body .stg-header {
            flex-wrap: wrap;
            gap: 6px 8px;
            min-width: 0;
        }
        body .stg-header h2 {
            min-width: 0;
        }
        body .stg-card-details {
            margin: 0;
            padding: 0;
        }
        body .stg-card-summary {
            list-style: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px 8px;
            min-width: 0;
            margin-bottom: 0;
            padding-block: 2px;
        }
        body .stg-card-summary::-webkit-details-marker {
            display: none;
        }
        body .stg-card-summary::after {
            content: '';
            display: inline-block;
            width: 6px;
            height: 6px;
            border-right: 1.5px solid var(--ed-ink-muted);
            border-bottom: 1.5px solid var(--ed-ink-muted);
            transform: rotate(-45deg);
            margin-inline-start: 6px;
            transition: transform var(--ed-dur-fast) var(--ed-ease);
            flex-shrink: 0;
        }
        body .stg-card-details[open] > .stg-card-summary::after {
            transform: rotate(45deg);
        }
        body .stg-card-details[open] > .stg-card-summary {
            margin-bottom: 10px;
        }
        body .stg-card-details-body {
            padding-top: 2px;
        }
        body .stg-status-pill {
            margin-inline-start: auto;
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 5px;
            padding: 2px 8px;
            border-radius: var(--ed-radius-pill);
            font-size: 11px;
            font-weight: 600;
            border: 1px solid var(--ed-border-strong);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
            max-width: 100%;
            box-sizing: border-box;
            white-space: normal;
            overflow-wrap: anywhere;
        }
        body :is(.stg-status-pill.is-connected, .stg-status-pill.is-uptodate, .stg-diagnostic-hint.is-good, .stg-cdp-launcher-badge.is-installed, .ctx-action-btn.copied, .ctx-measure-badge.is-measured, .turn-start-pill.is-warm, .quota-runway-pill.is-safe, .cache-ttl-badge.is-warm) {
            background: var(--ed-good-tint);
            border-color: var(--ed-good-border);
            color: var(--ed-good);
        }
        body :is(.stg-status-pill.is-inactive, .stg-diagnostic-hint.is-warn, .ctx-measure-badge.is-compacted, .ctx-measure-badge.is-rewind, .overview-watermark-pill.is-tier-exceeded, .turn-start-pill.is-partial, .quota-runway-pill.is-risk, .swarm-role-badge.is-worker, .swarm-phase-badge.is-warn, .cache-ttl-badge.is-cooling) {
            background: var(--ed-warn-tint);
            border-color: var(--ed-warn-border);
            color: var(--ed-warn);
        }
        body :is(.stg-status-pill.is-update, .lock-main-btn.is-locked, .swarm-role-badge.is-root) {
            background: var(--ed-accent-tint);
            border-color: var(--ed-accent-border);
            color: var(--ed-accent);
        }
        body :is(.stg-status-pill.is-error, .stg-diagnostic-hint.is-error, .quota-runway-pill.is-exhausted, .cache-ttl-badge.is-cold) {
            background: var(--ed-danger-tint);
            border-color: var(--ed-danger-border);
            color: var(--ed-danger);
        }
        body .stg-diagnostic-hint {
            margin-top: 8px;
            padding: 8px 10px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
            font-size: 11.5px;
            line-height: 1.5;
            overflow-wrap: anywhere;
        }
        body .stg-diagnostic-hint[hidden] {
            display: none;
        }
        body .stg-cdp-actions {
            margin-top: 8px;
        }
        body .stg-cdp-launcher-box {
            margin-top: 10px;
            padding: 10px 12px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 0;
        }
        body .stg-cdp-launcher-head {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 6px 10px;
            min-width: 0;
        }
        body .stg-cdp-launcher-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--ed-ink);
        }
        body .stg-cdp-launcher-status {
            display: inline-flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
            min-width: 0;
            max-width: 100%;
        }
        body .stg-cdp-launcher-badge {
            display: inline-flex;
            align-items: center;
            padding: 1px 7px;
            border-radius: var(--ed-radius-pill);
            font-size: 10.5px;
            font-weight: 600;
            border: 1px solid var(--ed-border-strong);
            background: var(--ed-surface);
            color: var(--ed-ink-secondary);
            white-space: nowrap;
        }
        body .stg-cdp-launcher-path {
            font-family: var(--ed-mono);
            font-size: 10.5px;
            color: var(--ed-ink-secondary);
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-xs);
            padding: 1px 6px;
            overflow-wrap: anywhere;
            word-break: break-word;
            min-width: 0;
        }
        body .stg-cdp-launcher-note {
            margin: 0;
            font-size: 11px;
            line-height: 1.48;
            color: var(--ed-ink-muted);
            overflow-wrap: anywhere;
        }
        body .stg-cdp-launcher-actions {
            margin-top: 2px;
        }
        body .stg-cdp-launcher-actions [hidden] {
            display: none;
        }
        body .stg-code-item-head {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 4px 8px;
            min-width: 0;
        }
        body .cdp-copy-btn {
            padding: 2px 7px;
            font-size: 11px;
            line-height: 1.3;
            min-height: 22px;
            gap: 4px;
            flex-shrink: 0;
        }
        body .stg-guide-step {
            font-weight: 600;
            color: var(--ed-ink);
        }
        body .stg-guide-note {
            font-size: 11px;
            color: var(--ed-ink-muted);
            line-height: 1.48;
        }
        body .stg-guide-details {
            margin-top: 10px;
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface-well);
            padding: 8px 10px;
        }
        body .stg-guide-details summary {
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            color: var(--ed-ink);
        }
        body .stg-guide-body {
            margin-top: 8px;
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-size: 12px;
            color: var(--ed-ink-secondary);
        }
        body .stg-code-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        body .stg-code-item {
            display: flex;
            flex-direction: column;
            gap: 3px;
            padding: 6px 8px;
            border-radius: var(--ed-radius-xs);
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            min-width: 0;
        }
        body .stg-code-item.is-current-platform {
            border-color: var(--ed-accent-border);
        }
        body .stg-code-item code {
            font-family: var(--ed-mono);
            font-size: 11px;
            color: var(--ed-ink);
            overflow-wrap: anywhere;
            word-break: break-word;
            white-space: pre-wrap;
        }
        body :is(.stg-btn-primary, .about-action-btn.is-primary) {
            background: var(--ed-accent);
            border-color: var(--ed-accent);
            color: var(--ed-accent-ink);
            font-weight: 600;
        }
        body .stg-btn-primary:hover,
        body .tab-pane .action-btn.stg-btn-primary:not(:disabled):hover {
            background: var(--ed-accent-hover);
            border-color: var(--ed-accent-hover);
            color: var(--ed-accent-ink);
        }
        body :is(.stg-btn-primary, .about-action-btn.is-primary) :is(.bi-sep, .bi-zh) {
            color: inherit;
        }
        body .stg-hint-note {
            margin-top: 8px;
            font-size: 11.5px;
            color: var(--ed-ink-muted);
            line-height: 1.48;
        }
        body .stg-seg-group {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 4px;
            padding: 3px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
        }
        body .stg-seg-btn {
            border: 1px solid transparent;
            background: transparent;
            color: var(--ed-ink-secondary);
            font-family: inherit;
            font-size: 12px;
            font-weight: 550;
            padding: 5px 10px;
            border-radius: calc(var(--ed-radius-sm) - 2px);
            cursor: pointer;
            transition: background var(--ed-dur-fast) var(--ed-ease), color var(--ed-dur-fast) var(--ed-ease);
        }
        body .stg-seg-btn.is-active {
            background: var(--ed-surface);
            border-color: var(--ed-accent-border);
            color: var(--ed-accent);
            font-weight: 650;
            box-shadow: var(--ed-shadow-segment);
        }
        body .stg-form-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
            gap: 12px;
            margin-top: 10px;
        }
        body .stg-field {
            display: flex;
            flex-direction: column;
            gap: 5px;
            min-width: 0;
        }
        body .stg-field label {
            font-size: 12px;
            font-weight: 550;
            color: var(--ed-ink);
        }
        body .stg-field select,
        body .stg-field input[type="number"],
        body .stg-select {
            height: 32px;
            padding: 0 10px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-control-border);
            background-color: var(--ed-input-bg);
            color: var(--ed-ink);
            font-family: inherit;
            font-size: 12.5px;
            min-width: 0;
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
        }
        body .stg-field select,
        body .stg-select {
            padding-inline: 10px 26px;
            text-overflow: ellipsis;
        }
        @media (min-width: 521px) and (max-width: 679px), (min-width: 900px) {
            body .stg-form-grid-subscription {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            body .stg-form-grid-subscription .stg-field-plan {
                grid-column: 1 / -1;
            }
        }
        @media (min-width: 680px) and (max-width: 899px) {
            body .stg-form-grid-subscription {
                grid-template-columns: minmax(220px, 1.45fr) minmax(110px, 0.65fr) minmax(140px, 0.9fr);
            }
        }
        body .stg-divider {
            height: 1px;
            background: var(--ed-border);
            margin: 12px 0;
        }

        body .about-action-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 30px;
            padding: 0 12px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-control-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink);
            font-family: inherit;
            font-size: 12px;
            font-weight: 550;
            text-decoration: none;
            cursor: pointer;
            transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease);
        }
        body :is(.ctx-action-btn, .about-action-btn):hover {
            background: var(--ed-surface-hover);
            border-color: var(--ed-ink-muted);
        }
        /* High Contrast Safeguards for v1.17.6 Components & Rich Popover */
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"],
            [data-acm-theme="hc"], [data-acm-theme="hc-light"])
            :is(.native-hud-bar, .native-hud-chip, .low-quota-banner, .stg-status-pill, .stg-diagnostic-hint, .stg-cdp-launcher-box, .stg-cdp-launcher-badge, .stg-updates, .jargon-tip, .acm-rich-tip, .ctx-selected-drawer) {
            border-color: var(--ed-border);
        }

        /* 320px AUX_PANE Narrow Responsive Guards */
        @media (max-width: 520px) {
            body .masthead-context-bar {
                padding: 4px var(--ed-gutter, 12px) 6px;
                gap: 6px;
            }
            body .native-hud-host {
                padding-inline: var(--ed-gutter, 12px);
            }
            body .native-hud-strip {
                padding: 6px 8px;
                gap: 5px 6px;
            }
            body .native-hud-toggle {
                width: 100%;
                justify-content: center;
            }
            body .conv-switcher-wrap {
                max-width: 100%;
                flex-basis: 100%;
            }
            body .ctx-dual-cap-row {
                grid-template-columns: minmax(0, 1fr);
            }
            body .ctx-dot-matrix {
                gap: 2px;
                padding: 4px;
            }
            body .ctx-dot {
                min-width: 4px;
            }
            body .ctx-action-btn {
                width: 100%;
                justify-content: center;
            }
            body .stg-form-grid {
                grid-template-columns: minmax(0, 1fr);
            }
            body .stg-status-pill {
                margin-inline-start: 0;
            }
        }

        /* Ergonomic 10x10 Dot Matrix (~18x18px per dot) in 320px AUX_PANE */
        @media (max-width: 420px) {
            body .ctx-dot-matrix {
                grid-template-columns: repeat(10, minmax(0, 1fr));
                gap: 4px;
                padding: 6px;
            }
            body .ctx-dot {
                min-width: 14px;
                border-radius: 3px;
            }
        }

        /* v1.18 D9 Banners, Swarm Live Strip, Sessions Tree, Handoff v2, Recovery Brief & Mode Switches */
        body .overview-d9-banner { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 10px; padding: 8px 12px; margin-bottom: 10px; border-radius: var(--ed-radius-md); border: 1px solid var(--ed-border-strong); background: var(--ed-surface-well); font-size: 12px; }
        body .overview-d9-banner.is-inspect.is-sticky { position: sticky; top: var(--acm-topbar-h, 118px); z-index: 180; border-color: var(--ed-accent-border); background: var(--ed-surface-overlay); background: color-mix(in srgb, var(--ed-accent) 12%, var(--ed-surface)); box-shadow: var(--ed-shadow-segment); }
        body .overview-d9-banner.is-lock-pending { border-color: var(--ed-warn-border); background: var(--ed-warn-tint); }
        body .overview-d9-banner.is-retarget { border-color: var(--ed-accent-border); }
        body .overview-d9-banner-text { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; flex: 1 1 180px; }
        body .overview-d9-root-tag, body .swarm-role-badge, body .swarm-phase-badge, body .cache-ttl-badge, body .ov-quota-mode-tag { display: inline-flex; align-items: center; gap: 3px; padding: 1px 6px; border-radius: var(--ed-radius-pill); border: 1px solid var(--ed-border); background: var(--ed-surface-well); font-size: 10.5px; font-weight: 600; white-space: nowrap; }
        body .swarm-phase-badge.is-killed { color: var(--ed-ink-secondary); border-style: dashed; }
        body .overview-swarm-strip, body .ses-swarm-tree { margin-top: 12px; padding: 10px 12px; border: 1px solid var(--ed-border); border-radius: var(--ed-radius-md); background: var(--ed-surface-well); min-width: 0; }
        body .overview-swarm-head, body .ses-swarm-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
        body .overview-swarm-head h4, body .ses-swarm-head h3, body .recovery-brief-head h3 { margin: 0; font-size: 12.5px; font-weight: 650; display: inline-flex; align-items: center; gap: 6px; }
        body .swarm-count-pill { font-size: 10.5px; padding: 0 6px; border-radius: 999px; background: var(--ed-surface); border: 1px solid var(--ed-border); }
        body .swarm-partial-badge, body .swarm-partial-note { font-size: 11px; color: var(--ed-warn); margin: 0; }
        body .swarm-cost-summary { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 11.5px; color: var(--ed-ink-secondary); margin-bottom: 8px; }
        body .swarm-member-list, body .swarm-tree-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
        body .swarm-member-row, body .swarm-tree-node { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; align-items: center; padding: 7px 9px; border: 1px solid var(--ed-border); border-radius: var(--ed-radius-sm); background: var(--ed-surface); min-width: 0; }
        body #swarm-inspection-banner, body .swarm-member-details > summary { scroll-margin-block-start: calc(var(--acm-topbar-h, 118px) + 12px); }
        body .swarm-member-details { grid-column: 1 / -1; min-width: 0; }
        body .swarm-member-details > summary, body .swarm-ended > summary { cursor: pointer; padding: 4px 0; }
        body .swarm-member-details > summary .swarm-member-tags { vertical-align: middle; margin-inline: 4px; }
        body .swarm-summary-label, body .swarm-ended > summary { color: var(--ed-ink); font-size: 11px; }
        body .swarm-member-actions [hidden] { display: none; }
        body .swarm-member-details[open] > summary { margin-bottom: 5px; }
        body .swarm-member-note, body .swarm-inspect-feedback { margin: 5px 0; font-size: 11.5px; color: var(--ed-ink-secondary); }
        body .swarm-member-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
        body .swarm-ended { margin-top: 5px; }
        body .swarm-tree-node { margin-inline-start: calc(var(--swarm-depth, 0) * 12px); }
        body .swarm-member-row.is-inspected, body .swarm-tree-node.is-inspected { border-color: var(--ed-accent-border); background: var(--ed-accent-tint); }
        body .swarm-member-row.is-killed, body .swarm-tree-node.is-killed { border-style: dashed; background: var(--ed-surface-well); }
        body .swarm-member-main, body .swarm-member-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; min-width: 0; }
        body .swarm-member-meta { grid-column: 1 / -1; font-size: 11px; color: var(--ed-ink-muted); }
        body :is(.swarm-member-row, .swarm-tree-node).is-inspected .swarm-member-meta { color: var(--ed-ink-secondary); }
        body .swarm-member-name { font-weight: 600; font-size: 12px; min-width: 0; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
        body .swarm-member-tags { display: inline-flex; flex-wrap: wrap; gap: 4px; }
        body .swarm-member-pct { font-weight: 650; color: var(--ed-ink); }
        body .swarm-member-pct.is-good { color: var(--ed-good); }
        body .swarm-member-pct.is-warn { color: var(--ed-warn); }
        body .swarm-member-pct.is-danger { color: var(--ed-danger); }
        body .swarm-inspect-btn { height: 24px; padding: 0 8px; font-size: 11px; }
        body .ov-basis-row, body .overview-quota-top, body .ov-quota-controls { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; }
        body .ov-basis-row { margin-top: 8px; }
        body .ov-seg-switch { display: inline-flex; align-items: center; padding: 2px; border-radius: var(--ed-radius-sm); border: 1px solid var(--ed-border); background: var(--ed-surface-well); gap: 2px; max-width: 100%; flex-wrap: wrap; }
        body .ov-seg-btn { appearance: none; border: none; background: transparent; color: var(--ed-ink-muted); font: inherit; font-size: 10.5px; font-weight: 550; padding: 2px 6px; border-radius: var(--ed-radius-xs); cursor: pointer; }
        body .ov-seg-btn.is-active { background: var(--ed-surface); color: var(--ed-ink); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
        body .ctx-budget-warning-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 8px; margin: 10px 0 6px; padding: 7px 10px; border-radius: var(--ed-radius-sm); border: 1px solid var(--ed-warn-border); background: var(--ed-warn-tint); color: var(--ed-warn); font-size: 11.5px; font-weight: 550; }
        body .ctx-handoff-v2-trigger-row { margin: 8px 0 4px; }
        body .handoff-preview-box, body .recovery-brief-card { margin: 10px 0; padding: 10px 12px; border-radius: var(--ed-radius-md); border: 1px solid var(--ed-border-strong); background: var(--ed-surface-well); min-width: 0; }
        body .handoff-preview-box[hidden] { display: none; }
        body .handoff-preview-head, body .recovery-brief-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 8px; margin-bottom: 6px; }
        body .handoff-preview-actions, body .recovery-brief-actions { display: inline-flex; flex-wrap: wrap; min-width: 0; max-width: 100%; align-items: center; gap: 6px; }
        body :is(.handoff-preview-actions, .recovery-brief-actions) .action-btn { height: auto; min-height: 24px; max-width: 100%; white-space: normal; }
        body .tab-pane .cal-export-actions,
        body .tab-pane .quota-dual-head,
        body .tab-pane .telemetry-ledger-row { flex-wrap: wrap; }
        body .tab-pane .cal-export-actions,
        body .tab-pane .model-card-pct,
        body .tab-pane .telemetry-ledger-key { min-width: 0; max-width: 100%; flex-shrink: 1; }
        body .tab-pane .quota-dual-pct,
        body .tab-pane .cache-ttl-badge { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
        body #tab-settings .storage-actions .action-btn { max-width: 100%; min-height: 32px; height: auto; white-space: normal; }
        body .prc-info-bar-body { min-width: 0; overflow-wrap: anywhere; }
        body .handoff-preview-notice { font-size: 11px; color: var(--ed-ink-muted); margin: 0 0 6px; }
        body .handoff-preview-text, body .recovery-brief-body { width: 100%; box-sizing: border-box; font-family: var(--ed-mono); font-size: 11px; line-height: 1.45; padding: 8px; border-radius: var(--ed-radius-sm); border: 1px solid var(--ed-border); background: var(--ed-surface); color: var(--ed-ink); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 200px; overflow-y: auto; margin: 0; }
        @media (pointer: coarse) {
            body .tab-btn, body .topbar-util-btn, body .panel-topbar .action-btn, body .swarm-inspect-btn, body .ov-seg-btn { min-height: 38px; min-width: 38px; }
        }
        @media (max-width: 480px) {
            body .tab-bar, body[data-acm-surface="app-sidecar"] .tab-bar { grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 1px; }
            body .tab-bar .tab-btn, body[data-acm-surface="app-sidecar"] .tab-bar .tab-btn { padding: 7px 2px 8px; font-size: 10.5px; }
        }
        @media (max-width: 360px) {
            body .tab-bar .tab-btn, body[data-acm-surface="app-sidecar"] .tab-bar .tab-btn { font-size: 9.5px; line-height: 1.15; padding: 5px 1px 6px; white-space: normal; text-align: center; }
            body .tab-bar .tab-btn .tab-label, body[data-acm-surface="app-sidecar"] .tab-bar .tab-btn .tab-label { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
            body .swarm-member-row, body .swarm-tree-node { grid-template-columns: minmax(0, 1fr); }
        }
        body .app-onboarding-banner { display: flex; flex-direction: column; gap: 8px; margin: 0 0 14px; padding: 14px 16px; border-radius: var(--ed-radius-md); border: 1px solid var(--ed-accent-border); background: var(--ed-accent-tint); color: var(--ed-ink); }
        body .app-onboarding-banner[hidden] { display: none; }
        body .app-onboarding-head { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        body .app-onboarding-badge { display: inline-flex; align-items: center; align-self: flex-start; gap: 5px; padding: 2px 8px; border-radius: var(--ed-radius-pill); border: 1px solid var(--ed-accent-border); background: var(--ed-surface); color: var(--ed-accent); font-size: 11px; font-weight: 600; }
        body .app-onboarding-badge svg { width: 12px; height: 12px; flex-shrink: 0; }
        body .app-onboarding-title { margin: 0; font-size: 0.9375rem; font-weight: 600; color: var(--ed-ink); line-height: 1.35; }
        body .app-onboarding-body { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--ed-ink-secondary); }
        body .app-onboarding-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        body .app-onboarding-actions .action-btn { height: auto; min-height: 30px; padding: 5px 11px; white-space: normal; max-width: 100%; }
        body .app-onboarding-dismiss-btn { color: var(--ed-ink-secondary); background: transparent; }
        body .stg-card.is-target-highlight { border-color: var(--ed-accent); box-shadow: 0 0 0 2px var(--ed-accent-tint); }
        body .stg-globalrules-actions { margin: 8px 0 10px; }
        body .stg-globalrules-editor { display: block; width: 100%; min-height: 168px; max-height: 460px; resize: vertical; box-sizing: border-box; padding: 10px 12px; margin-bottom: 10px; border: 1px solid var(--ed-control-border); border-radius: var(--ed-radius-sm); background: var(--ed-input-bg); color: var(--ed-ink); font-family: var(--ed-mono); font-size: 12px; line-height: 1.55; tab-size: 2; }
        body .stg-globalrules-editor::placeholder { color: var(--ed-ink-muted); opacity: 1; }
        body .stg-globalrules-editor:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 1px; border-color: var(--ed-accent); }
        body .stg-globalrules-editor:is([readonly], :disabled) { background: var(--ed-surface-well); color: var(--ed-ink-secondary); }
        body .stg-globalrules-editor:disabled { color: var(--ed-ink-muted); cursor: not-allowed; }
        body .privacy-remask-placeholder { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 18px; margin: 12px 0; border-radius: var(--ed-radius-md); border: 1px solid var(--ed-border); background: var(--ed-surface); color: var(--ed-ink-secondary); font-size: 13px; }
        @media (forced-colors: active) {
            body :is(.app-onboarding-banner, .stg-card.is-target-highlight, .stg-globalrules-editor, .privacy-remask-placeholder) { border: 1px solid ButtonText; background: Canvas; color: CanvasText; forced-color-adjust: auto; }
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

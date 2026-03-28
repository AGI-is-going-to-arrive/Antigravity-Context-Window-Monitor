// ─── WebView Panel Styles ─────────────────────────────────────────────────────
// Extracted from webview-panel.ts for readability.
// This module exports the CSS template string used by the WebView monitor panel.

export function getStyles(): string {
    return `
        :root {
            --color-ok: #4ade80;
            --color-warn: #facc15;
            --color-danger: #f87171;
            --color-info: #60a5fa;
            --color-accent: var(--vscode-focusBorder, #007fd4);
            --color-surface: rgba(255,255,255,0.04);
            --color-border: rgba(255,255,255,0.08);
            --color-border-hover: rgba(255,255,255,0.20);
            --color-surface-hover: rgba(255,255,255,0.06);
            --color-text: var(--vscode-foreground, #ccc);
            --color-text-dim: var(--vscode-descriptionForeground, #888);
            --color-bg: var(--vscode-editor-background, #1e1e1e);

            --radius-sm: 4px;
            --radius-md: 8px;
            --radius-lg: 12px;

            --space-1: 4px;
            --space-2: 8px;
            --space-3: 12px;
            --space-4: 16px;
            --space-6: 24px;

            --z-dropdown: 100;
            --z-sticky: 200;
            --z-overlay: 300;
            --z-modal: 400;
            --z-toast: 500;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        ::selection {
            background: var(--vscode-editor-selectionBackground, rgba(0,127,212,0.35));
            color: var(--vscode-editor-selectionForeground, #fff);
        }

        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb {
            background: var(--color-border);
            border-radius: var(--radius-full, 9999px);
            transition: background 0.15s cubic-bezier(.4,0,.2,1);
        }
        @media (hover: hover) {
            ::-webkit-scrollbar-thumb:hover {
                background: var(--color-text-dim);
            }
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, 'Segoe UI', sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--color-text);
            background: var(--color-bg);
            padding: var(--space-4);
            line-height: 1.5;
            -webkit-tap-highlight-color: transparent;
        }

        /* ─── Kill native number spinners ── */
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        input[type="number"] {
            -moz-appearance: textfield;
        }

        /* ─── Sticky TopBar Container ── */
        .panel-topbar {
            position: sticky;
            top: 0;
            z-index: var(--z-sticky);
            background: rgba(30, 30, 30, 0.92);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border-bottom: 1px solid var(--color-border);
            padding: var(--space-2) var(--space-4);
            margin: calc(-1 * var(--space-4)) calc(-1 * var(--space-4)) var(--space-4);
            width: calc(100% + var(--space-4) * 2);
            transition: box-shadow 0.25s cubic-bezier(.4,0,.2,1), border-color 0.25s cubic-bezier(.4,0,.2,1);
        }

        .panel-topbar.scrolled {
            box-shadow: 0 2px 12px rgba(0,0,0,0.4);
            border-bottom-color: var(--color-border-hover);
        }

        @media (prefers-reduced-motion: reduce) {
            .panel-topbar { transition: none; }
        }

        /* ─── TopBar Title (Layer 1) ──── */
        .topbar-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-2);
        }

        /* ─── TopBar Chips (Layer 2) ──── */
        .topbar-chips {
            display: flex;
            gap: var(--space-1);
            margin-bottom: var(--space-2);
            flex-wrap: wrap;
        }

        .info-chip {
            appearance: none;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 2px var(--space-2);
            border-radius: var(--radius-full, 9999px);
            font-size: 0.72em;
            font-family: inherit;
            font-weight: 500;
            cursor: pointer;
            border: 1px solid transparent;
            background: transparent;
            transition: background 0.2s cubic-bezier(.4,0,.2,1), border-color 0.2s cubic-bezier(.4,0,.2,1), color 0.2s cubic-bezier(.4,0,.2,1);
        }

        .info-chip .icon {
            width: 11px;
            height: 11px;
        }

        .info-chip:focus-visible {
            outline: none;
            box-shadow: 0 0 0 2px var(--color-accent);
        }

        .info-chip:active { transform: scale(0.97); }

        /* GitHub chip */
        .chip-github {
            color: rgba(74, 222, 128, 0.6);
            background: rgba(74, 222, 128, 0.05);
            border-color: rgba(74, 222, 128, 0.1);
        }

        .chip-github.active {
            color: var(--color-ok);
            background: rgba(74, 222, 128, 0.12);
            border-color: rgba(74, 222, 128, 0.35);
        }

        @media (hover: hover) {
            .chip-github:not(.active):hover {
                color: rgba(74, 222, 128, 0.85);
                background: rgba(74, 222, 128, 0.08);
                border-color: rgba(74, 222, 128, 0.2);
            }
        }

        /* Warning / Info chips */
        .chip-warn {
            color: rgba(250, 204, 21, 0.5);
            background: rgba(250, 204, 21, 0.04);
            border-color: rgba(250, 204, 21, 0.08);
        }

        .chip-warn.active {
            color: var(--color-warn);
            background: rgba(250, 204, 21, 0.1);
            border-color: rgba(250, 204, 21, 0.3);
        }

        @media (hover: hover) {
            .chip-warn:not(.active):hover {
                color: rgba(250, 204, 21, 0.75);
                background: rgba(250, 204, 21, 0.06);
                border-color: rgba(250, 204, 21, 0.15);
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .info-chip { transition: none; }
        }

        /* ─── Chip Dropdown Panels ────── */
        .chip-dropdown {
            margin-top: var(--space-1);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            padding: var(--space-2) var(--space-3);
            font-size: 0.78em;
            color: var(--color-text-dim);
            line-height: 1.6;
            animation: chipDropIn 0.2s cubic-bezier(.4,0,.2,1);
        }

        .chip-dropdown[hidden] { display: none; }

        @keyframes chipDropIn {
            from { opacity: 0; transform: translateY(-4px); }
            to   { opacity: 1; transform: translateY(0); }
        }

        @media (prefers-reduced-motion: reduce) {
            .chip-dropdown { animation: none; }
        }

        .chip-dropdown-github {
            border-color: rgba(74, 222, 128, 0.15);
            background: rgba(74, 222, 128, 0.03);
        }

        .chip-dropdown-notice {
            border-color: rgba(250, 204, 21, 0.12);
            background: rgba(250, 204, 21, 0.03);
        }

        .chip-dropdown-disclaimer {
            border-color: rgba(250, 204, 21, 0.12);
            background: rgba(250, 204, 21, 0.03);
        }

        .chip-dropdown-content {
            display: flex;
            align-items: flex-start;
            gap: var(--space-2);
            flex-wrap: wrap;
        }

        .chip-dropdown-text {
            flex: 1;
            min-width: 0;
        }

        /* ─── Disclaimer body (reused in chip dropdown) ── */
        .disclaimer-body {
            padding: 0;
            line-height: 1.6;
            color: var(--color-text-dim);
            display: block;
        }

        .disclaimer-body strong {
            color: var(--color-warn);
            font-weight: 600;
        }

        /* ─── Star / Heart inline (inside chip dropdowns) ── */
        .star-inline {
            display: inline-flex;
            vertical-align: middle;
            color: var(--color-warn);
            animation: starTwinkle 2.4s ease-in-out infinite;
        }

        .star-inline .icon {
            width: 12px;
            height: 12px;
        }

        @keyframes starTwinkle {
            0%, 100% { opacity: 1; transform: scale(1) rotate(0deg); }
            50%      { opacity: 0.5; transform: scale(0.85) rotate(-12deg); }
        }

        @media (prefers-reduced-motion: reduce) {
            .star-inline { animation: none; }
        }

        .heart-inline {
            display: inline-flex;
            vertical-align: middle;
            color: var(--color-danger);
            animation: heartbeat 1.4s ease-in-out infinite;
        }

        .heart-inline .icon {
            width: 12px;
            height: 12px;
        }

        @keyframes heartbeat {
            0%, 100% { transform: scale(1); }
            14%      { transform: scale(1.25); }
            28%      { transform: scale(1); }
            42%      { transform: scale(1.18); }
            56%      { transform: scale(1); }
        }

        @media (prefers-reduced-motion: reduce) {
            .heart-inline { animation: none; }
        }

        /* ─── GitHub Link Button (reused in dropdown) ── */
        .info-banner-link {
            appearance: none;
            flex-shrink: 0;
            display: inline-flex;
            align-items: center;
            gap: var(--space-1);
            padding: 2px var(--space-2);
            border: 1px solid rgba(74, 222, 128, 0.2);
            border-radius: var(--radius-sm);
            background: rgba(74, 222, 128, 0.08);
            color: var(--color-ok);
            font-size: 0.9em;
            font-weight: 600;
            font-family: inherit;
            text-decoration: none;
            cursor: pointer;
            transition: background 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1), transform 0.1s;
        }

        .info-banner-link:active { transform: scale(0.98); }

        .info-banner-link:focus-visible {
            box-shadow: 0 0 0 2px var(--color-ok);
            outline: none;
        }

        .info-banner-link .icon {
            width: 11px;
            height: 11px;
        }

        @media (hover: hover) {
            .info-banner-link:hover {
                background: rgba(74, 222, 128, 0.15);
                border-color: rgba(74, 222, 128, 0.35);
            }
        }

        /* ─── TopBar Title h1 ────────── */
        .topbar-title h1 {
            font-size: 1.1em;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }

        .update-time {
            color: var(--color-text-dim);
            font-size: 0.85em;
        }

        /* ─── Language Switcher ──────── */
        .lang-switcher {
            display: flex;
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            overflow: hidden;
        }

        .lang-btn {
            appearance: none;
            background: transparent;
            color: var(--color-text-dim);
            border: none;
            padding: var(--space-1) var(--space-2);
            font-size: 0.75em;
            font-family: inherit;
            cursor: pointer;
            transition: background 0.15s cubic-bezier(.4,0,.2,1), color 0.15s cubic-bezier(.4,0,.2,1);
            border-right: 1px solid var(--color-border);
        }

        .lang-btn:last-child { border-right: none; }

        .lang-btn.active {
            background: var(--color-info);
            color: #fff;
        }

        .lang-btn:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
            outline: none;
        }

        .lang-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .lang-btn:not(.active):hover {
                background: rgba(255,255,255,0.08);
                color: var(--color-text);
            }
        }

        /* ─── Action Button ─────────── */
        .action-btn {
            appearance: none;
            background: transparent;
            color: var(--color-text-dim);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            padding: var(--space-1);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s cubic-bezier(.4,0,.2,1), color 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
        }
        .action-btn:disabled {
            cursor: not-allowed;
            opacity: 0.45;
            color: var(--color-text-dim);
            border-color: var(--color-border);
            background: rgba(255,255,255,0.01);
        }

        .action-btn:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
            outline: none;
        }

        .action-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .action-btn:hover {
                background: var(--color-surface-hover);
                color: var(--color-text);
                border-color: var(--color-border-hover);
            }
            .action-btn:disabled:hover {
                background: rgba(255,255,255,0.01);
                color: var(--color-text-dim);
                border-color: var(--color-border);
            }
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .action-btn.spinning svg {
            animation: spin 0.6s linear;
        }

        /* ─── Icons ─────────────────── */
        .icon {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
        }

        /* ─── Card ──────────────────── */
        .card {
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-lg);
            padding: var(--space-4);
            margin-bottom: var(--space-3);
            transition: border-color 0.2s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .card:hover {
                border-color: var(--color-border-hover);
            }
        }

        .card h2 {
            font-size: 0.9em;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--color-text-dim);
            margin-bottom: var(--space-3);
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }

        .card.empty {
            text-align: center;
            padding: var(--space-6);
            color: var(--color-text-dim);
        }

        .empty-desc {
            font-size: 0.85em;
            color: var(--color-text-dim);
            margin-top: var(--space-2);
            opacity: 0.7;
        }

        /* ─── Badges ─────────────────── */
        .badge {
            font-size: 0.7em;
            padding: 1px 6px;
            border-radius: var(--radius-sm);
            text-transform: uppercase;
            letter-spacing: 0.3px;
            font-weight: 700;
        }

        .warn-badge {
            background: rgba(250, 204, 21, 0.15);
            color: var(--color-warn);
        }

        .ok-badge {
            background: rgba(74, 222, 128, 0.15);
            color: var(--color-ok);
        }

        .danger-badge {
            background: rgba(248, 113, 113, 0.15);
            color: var(--color-danger);
            font-size: 0.65em;
        }

        .pool-badge {
            background: rgba(255,255,255,0.06);
            color: var(--color-text-dim);
            font-size: 0.65em;
            font-weight: 500;
            text-transform: none;
            margin-left: var(--space-1);
        }

        /* ─── Stat Grid ──────────────── */
        .stat-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
            gap: var(--space-2);
            margin-bottom: var(--space-3);
        }

        .stat-grid.three-col { grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); }
        .stat-grid.four-col { grid-template-columns: repeat(auto-fit, minmax(65px, 1fr)); }

        .stat {
            background: rgba(255,255,255,0.02);
            border-radius: var(--radius-md);
            padding: var(--space-2) var(--space-3);
        }

        .stat.mini { padding: var(--space-1) var(--space-2); }

        .stat-label {
            font-size: 0.75em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .stat-value {
            font-weight: 600;
            font-size: 0.95em;
            word-break: break-all;
        }

        .stat-value.title-val {
            font-size: 0.85em;
            font-weight: 400;
        }

        /* ─── Progress Bar ────────────── */
        .progress-section { margin-bottom: var(--space-3); }

        .progress-header {
            display: flex;
            justify-content: space-between;
            font-size: 0.85em;
            margin-bottom: var(--space-1);
        }

        .progress-pct { font-weight: 700; }

        .progress-bar-wrap {
            height: 8px;
            background: rgba(255,255,255,0.06);
            border-radius: var(--radius-sm);
            overflow: hidden;
        }

        .progress-bar {
            height: 100%;
            border-radius: var(--radius-sm);
            transition: width 0.4s cubic-bezier(.4,0,.2,1);
        }

        .progress-detail {
            font-size: 0.8em;
            margin-top: var(--space-1);
            color: var(--color-text-dim);
        }

        .dim { opacity: 0.6; }

        /* ─── Compression Alert ────────── */
        .compression-alert {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            background: rgba(248, 113, 113, 0.1);
            border: 1px solid rgba(248, 113, 113, 0.2);
            border-radius: var(--radius-md);
            padding: var(--space-2) var(--space-3);
            margin-bottom: var(--space-3);
            font-size: 0.85em;
            color: var(--color-danger);
        }

        /* ─── Checkpoint Section ────────── */
        .checkpoint-section {
            border-top: 1px solid var(--color-border);
            padding-top: var(--space-3);
            margin-top: var(--space-2);
        }

        .section-subtitle {
            font-size: 0.75em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin-bottom: var(--space-2);
        }

        .delta-hint {
            font-size: 0.8em;
            color: var(--color-text-dim);
            margin-top: var(--space-1);
            font-style: italic;
        }

        /* ─── GM Precision: Output Split ── */
        .gm-split-section,
        .gm-cache-section,
        .gm-stats-section {
            border-top: 1px solid var(--color-border);
            padding-top: var(--space-3);
            margin-top: var(--space-2);
            margin-bottom: var(--space-2);
        }

        .gm-split-section .section-subtitle,
        .gm-cache-section .section-subtitle,
        .gm-stats-section .section-subtitle {
            display: flex;
            align-items: center;
            gap: var(--space-1);
        }

        .output-split-bar {
            display: flex;
            height: 6px;
            border-radius: var(--radius-sm);
            overflow: hidden;
            margin-bottom: var(--space-2);
            background: rgba(255,255,255,0.06);
        }

        .split-thinking {
            background: linear-gradient(90deg, #fb923c, #f97316);
            transition: width 0.3s cubic-bezier(.4,0,.2,1);
        }

        .split-response {
            background: linear-gradient(90deg, #60a5fa, #3b82f6);
            transition: width 0.3s cubic-bezier(.4,0,.2,1);
        }

        .split-legend {
            display: flex;
            gap: var(--space-4);
            font-size: 0.78em;
            color: var(--color-text-dim);
        }

        .dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: var(--radius-full, 50%);
            vertical-align: middle;
            margin-right: var(--space-1);
        }

        .thinking-dot { background: #fb923c; }
        .response-dot { background: #60a5fa; }

        /* ─── GM Precision: Cache Ring ──── */
        .cache-row {
            display: flex;
            align-items: center;
            gap: var(--space-4);
        }

        .cache-ring-wrap {
            display: flex;
            flex-direction: column;
            align-items: center;
            flex-shrink: 0;
        }

        .cache-ring {
            width: 72px;
            height: 72px;
        }

        .cache-ring-label {
            font-size: 0.68em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin-top: 2px;
        }

        /* ─── GM Stats ─────────────────── */
        .retry-val {
            color: var(--color-warn);
        }

        .stop-alert {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            background: rgba(248, 113, 113, 0.08);
            border: 1px solid rgba(248, 113, 113, 0.15);
            border-radius: var(--radius-md);
            padding: var(--space-1) var(--space-2);
            margin-top: var(--space-2);
            margin-bottom: var(--space-2);
            font-size: 0.78em;
            color: var(--color-danger);
            flex-wrap: wrap;
        }

        .gm-mini-row {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            font-size: 0.78em;
            color: var(--color-text-dim);
            padding: var(--space-1) 0;
            margin-top: var(--space-1);
            border-top: 1px solid var(--color-border);
        }


        /* ─── Call Details (Card-based) ────── */
        .call-details-body {
            max-height: 400px;
            overflow-y: auto;
            display: grid;
            gap: var(--space-1);
        }

        .call-card {
            background: rgba(255,255,255,0.02);
            border: 1px solid var(--color-border);
            border-left: 3px solid var(--color-info);
            border-radius: var(--radius-md);
            padding: var(--space-2) var(--space-3);
            font-size: 0.82em;
            transition: background 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .call-card:hover {
                background: var(--color-surface-hover);
                border-color: var(--color-border-hover);
            }
        }

        .call-card-header {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            margin-bottom: var(--space-1);
            flex-wrap: wrap;
        }

        .call-idx {
            font-weight: 700;
            color: var(--color-info);
            font-size: 0.9em;
            min-width: 28px;
        }

        .call-model {
            color: var(--color-text);
            font-weight: 500;
        }

        /* ─── Call Stat Chips ─────────────── */
        .call-chips {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-1);
            padding-left: 28px;
        }

        .call-chip {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            padding: 1px var(--space-2);
            border-radius: var(--radius-sm);
            font-size: 0.82em;
            background: rgba(255,255,255,0.04);
            border: 1px solid var(--color-border);
            color: var(--color-text-dim);
        }

        .call-chip.thinking {
            border-color: rgba(251,146,60,0.3);
            color: #fb923c;
        }

        .call-chip.cache {
            border-color: rgba(96,165,250,0.3);
            color: var(--color-info);
        }



        @media (prefers-reduced-motion: reduce) {
            .split-thinking, .split-response, .cache-ring circle {
                transition: none;
            }
        }

        /* ─── Compression History Cards ── */
        .compress-card {
            background: rgba(255,255,255,0.02);
            border: 1px solid var(--color-border);
            border-left: 3px solid var(--color-warn);
            border-radius: var(--radius-md);
            padding: var(--space-2) var(--space-3);
            transition: background 0.15s cubic-bezier(.4,0,.2,1);
        }

        .compress-card + .compress-card {
            margin-top: var(--space-1);
        }

        @media (hover: hover) {
            .compress-card:hover {
                background: var(--color-surface-hover);
            }
        }

        .compress-card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.82em;
        }

        .compress-steps {
            font-weight: 500;
            color: var(--color-text);
        }

        .compress-drop {
            color: var(--color-danger);
            font-weight: 600;
            font-size: 0.9em;
        }

        .compress-bar-wrap {
            position: relative;
            height: 6px;
            border-radius: var(--radius-full);
            background: var(--color-surface);
            margin: var(--space-1) 0;
            overflow: hidden;
        }

        .compress-bar-before {
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            background: rgba(251,191,36,0.2);
            border-radius: var(--radius-full);
        }

        .compress-bar-after {
            position: absolute;
            top: 0;
            left: 0;
            height: 100%;
            background: var(--color-ok);
            border-radius: var(--radius-full);
            transition: width 0.3s cubic-bezier(.4,0,.2,1);
        }

        .compress-detail {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            font-size: 0.75em;
            color: var(--color-text-dim);
        }

        .compress-detail svg {
            opacity: 0.5;
        }

        /* ─── Timestamps Grid ─────────── */
        .ts-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--space-2);
        }

        .ts-card {
            background: rgba(255,255,255,0.02);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            padding: var(--space-2) var(--space-3);
            display: flex;
            flex-direction: column;
            gap: 2px;
            transition: background 0.15s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .ts-card:hover {
                background: var(--color-surface-hover);
            }
        }

        .ts-icon {
            margin-bottom: 1px;
        }

        .ts-label {
            font-size: 0.72em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .ts-value {
            font-size: 0.82em;
            font-weight: 500;
            color: var(--color-text);
        }

        .ts-cascade {
            margin-top: var(--space-2);
            padding: var(--space-1) var(--space-2);
            background: rgba(255,255,255,0.02);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-sm);
            font-size: 0.72em;
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }

        .ts-cascade-label {
            color: var(--color-text-dim);
            white-space: nowrap;
        }

        /* ─── Session Rows ─────────────── */
        .session-row {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: var(--space-1) var(--space-2);
            padding: var(--space-2) 0;
            border-bottom: 1px solid var(--color-border);
        }

        .session-row:last-child { border-bottom: none; }

        .session-title {
            font-weight: 500;
            font-size: 0.9em;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: flex;
            align-items: center;
            gap: var(--space-1);
        }

        .session-model {
            font-size: 0.8em;
            color: var(--color-text-dim);
            text-align: right;
        }

        .session-bar-wrap {
            grid-column: 1 / -1;
            height: 4px;
            background: rgba(255,255,255,0.06);
            border-radius: var(--radius-sm);
            overflow: hidden;
        }

        .session-bar {
            height: 100%;
            border-radius: var(--radius-sm);
            transition: width 0.3s cubic-bezier(.4,0,.2,1);
        }

        .session-pct {
            grid-column: 1 / -1;
            font-size: 0.75em;
            color: var(--color-text-dim);
        }

        /* ─── Quota Rows ───────────────── */
        .quota-row {
            margin-bottom: var(--space-2);
        }

        .quota-row:last-child { margin-bottom: 0; }

        .quota-label {
            font-size: 0.85em;
            font-weight: 500;
            margin-bottom: var(--space-1);
            display: flex;
            align-items: center;
            gap: var(--space-1);
        }

        .quota-bar-wrap {
            height: 6px;
            background: rgba(255,255,255,0.06);
            border-radius: var(--radius-sm);
            overflow: hidden;
            margin-bottom: 2px;
        }

        .quota-bar {
            height: 100%;
            border-radius: var(--radius-sm);
            transition: width 0.3s cubic-bezier(.4,0,.2,1);
        }

        .quota-meta {
            display: flex;
            justify-content: space-between;
            font-size: 0.75em;
            color: var(--color-text-dim);
        }

        .quota-pct { font-weight: 600; }
        .quota-reset { opacity: 0.7; }

        .info-badge {
            background: rgba(96, 165, 250, 0.15);
            color: var(--color-info);
        }

        .mime-count {
            font-size: 0.7em;
            color: var(--color-text-dim);
            opacity: 0.6;
        }

        /* ─── Account Card ─────────────── */
        .tier-badge {
            font-size: 0.65em;
            padding: 2px 8px;
            border-radius: var(--radius-sm);
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .tier-sub { font-weight: 500; }

        /* ─── Privacy Button ──────────── */
        .privacy-btn {
            appearance: none;
            background: none;
            border: 1px solid var(--color-border);
            border-radius: var(--radius-sm);
            color: var(--color-text-dim);
            cursor: pointer;
            padding: 2px 4px;
            margin-left: auto;
            line-height: 1;
            transition: color 0.2s cubic-bezier(.4,0,.2,1), border-color 0.2s cubic-bezier(.4,0,.2,1);
        }

        .privacy-btn:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
        }

        .privacy-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .privacy-btn:hover {
                color: var(--color-warn);
                border-color: var(--color-warn);
            }
        }

        .privacy-btn.active {
            color: var(--color-ok);
            border-color: var(--color-ok);
        }

        .privacy-hint {
            font-size: 0.75em;
            color: var(--color-text-dim);
            margin: var(--space-1) 0 var(--space-2);
            padding: var(--space-1) var(--space-2);
            background: var(--color-surface);
            border-radius: var(--radius-sm);
            border-left: 2px solid var(--color-ok);
            line-height: 1.5;
        }

        /* ─── Default Model ───────────── */
        .default-model {
            font-size: 0.85em;
            color: var(--color-text-dim);
            margin-top: var(--space-1);
        }

        .default-model strong {
            color: var(--color-text);
        }

        /* ─── Collapsible Sections (card style) ── */
        .collapsible {
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            margin-top: var(--space-2);
            background: rgba(255,255,255,0.02);
            overflow: hidden;
            transition: border-color 0.2s cubic-bezier(.4,0,.2,1), background 0.2s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .collapsible:hover {
                border-color: var(--color-info);
                background: var(--color-surface-hover);
            }
        }

        .collapsible summary {
            cursor: pointer;
            font-size: 0.8em;
            font-weight: 600;
            padding: var(--space-2) var(--space-3);
            color: var(--color-text-dim);
            list-style: none;
            display: flex;
            align-items: center;
            gap: var(--space-2);
            user-select: none;
        }

        .collapsible summary::-webkit-details-marker { display: none; }

        .collapsible summary::before {
            content: '\u25B8';
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            font-size: 1.1em;
            width: 20px;
            height: 20px;
            border-radius: var(--radius-sm);
            background: var(--color-surface-hover);
            transition: transform 0.2s cubic-bezier(.4,0,.2,1), background 0.2s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .collapsible summary:hover::before {
                background: var(--color-border-hover);
            }
        }

        .collapsible[open] summary::before {
            transform: rotate(90deg);
            background: rgba(var(--color-info-rgb, 100,149,237), 0.15);
        }

        .collapsible summary:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
            border-radius: var(--radius-sm);
        }

        .details-body {
            padding: var(--space-1) var(--space-3) var(--space-3);
            border-top: 1px solid var(--color-border);
        }

        /* ─── Detail Row ─────────────── */
        .detail-row {
            display: flex;
            justify-content: space-between;
            font-size: 0.8em;
            padding: 2px 0;
            color: var(--color-text-dim);
        }

        .detail-row span:last-child {
            font-weight: 600;
            color: var(--color-text);
        }

        .account-info {
            display: flex;
            align-items: baseline;
            gap: var(--space-2);
            margin-bottom: var(--space-3);
        }

        .account-name {
            font-weight: 600;
            font-size: 1em;
        }

        .account-email {
            font-size: 0.8em;
            color: var(--color-text-dim);
        }

        /* ─── Credits Section ──────────── */
        .credits-section {
            display: grid;
            gap: var(--space-2);
            margin-top: var(--space-3);
            margin-bottom: var(--space-3);
        }

        .profile-two-col {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: var(--space-3);
            margin-bottom: var(--space-3);
        }

        .profile-panel-card {
            height: 100%;
        }

        .profile-metric-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: var(--space-2);
            margin-top: var(--space-2);
        }

        .profile-metric-card {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: var(--space-2) var(--space-3);
            border-radius: var(--radius-md);
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--color-border);
        }

        .profile-metric-label {
            font-size: 0.74em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.35px;
        }

        .profile-metric-value {
            font-size: 0.98em;
            font-weight: 700;
            color: var(--color-text);
            line-height: 1.35;
        }

        .profile-chip-grid {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-2);
            margin-top: var(--space-2);
        }

        .credit-row { margin-bottom: var(--space-2); }

        .credit-header {
            display: flex;
            justify-content: space-between;
            font-size: 0.85em;
            margin-bottom: var(--space-1);
        }

        .credit-bar-wrap {
            width: 100%;
            height: 6px;
            background: rgba(255,255,255,0.08);
            border-radius: 3px;
            overflow: hidden;
        }

        .credit-bar {
            height: 100%;
            border-radius: 3px;
            transition: width 0.3s cubic-bezier(.4,0,.2,1);
        }

        /* ─── Feature Tags ───────────── */
        .feature-tags {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-1);
        }

        .feature-tag {
            display: inline-block;
            font-size: 0.75em;
            padding: 2px var(--space-2);
            border-radius: var(--radius-sm);
            background: rgba(255,255,255,0.04);
            color: var(--color-text-dim);
            border: 1px solid var(--color-border);
            transition: background-color 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
        }

        .feature-tag.enabled {
            background: rgba(74,222,128,0.12);
            color: var(--color-ok);
            border-color: rgba(74,222,128,0.25);
        }

        /* ─── Git Info ────────────────── */
        .git-info {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            padding: var(--space-2) var(--space-3);
            background: rgba(96, 165, 250, 0.06);
            border: 1px solid rgba(96, 165, 250, 0.12);
            border-radius: var(--radius-md);
            margin-bottom: var(--space-3);
            font-size: 0.82em;
        }

        .git-repo, .git-branch {
            display: inline-flex;
            align-items: center;
            gap: var(--space-1);
            color: var(--color-info);
        }

        .git-branch {
            color: var(--color-ok);
        }

        /* ─── Rec Badge ──────────────── */
        .rec-badge {
            background: rgba(250, 204, 21, 0.15);
            color: var(--color-warn);
        }

        .rec-badge .icon {
            width: 10px;
            height: 10px;
        }

        /* ─── Status Badge ────────────── */
        .status-badge {
            background: rgba(156, 163, 175, 0.12);
            color: var(--color-text-dim);
            font-size: 0.6em;
            padding: 1px 5px;
            border-radius: var(--radius-sm);
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        /* ─── Mono Values ─────────────── */
        .mono-val {
            font-family: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', monospace);
            font-size: 0.85em;
            word-break: break-all;
        }

        /* ─── Quota ID ────────────────── */
        .quota-id {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 0.7em;
            color: var(--color-text-dim);
            opacity: 0.5;
            margin-top: 1px;
        }

        /* ─── MIME Tag Grid ───────────── */
        .mime-tags-wrap {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-1);
        }

        .mime-tag {
            font-size: 0.65em;
            font-family: var(--vscode-editor-font-family, monospace);
            padding: 1px 5px;
            border-radius: var(--radius-sm);
            background: rgba(255,255,255,0.04);
            color: var(--color-text-dim);
            border: 1px solid var(--color-border);
        }

        /* ─── Inline Details (smaller, nested) ── */
        .inline-details {
            margin-top: var(--space-1);
            background: rgba(255,255,255,0.01);
        }

        .inline-details summary {
            font-size: 0.72em;
            padding: var(--space-1) var(--space-2);
        }

        .inline-details summary::before {
            width: 16px;
            height: 16px;
            font-size: 0.9em;
        }

        /* ─── Profile: Subscription Hint ── */
        .subscription-hint {
            font-size: 0.78em;
            color: var(--color-text-dim);
            opacity: 0.7;
            font-style: italic;
            margin-bottom: var(--space-3);
        }

        /* ─── Profile: Google AI Credits ── */
        .gai-credits {
            display: flex;
            gap: var(--space-3);
            margin-top: var(--space-2);
            padding: var(--space-2) var(--space-3);
            background: rgba(192,132,252,0.06);
            border: 1px solid rgba(192,132,252,0.12);
            border-radius: var(--radius-md);
        }

        .gai-credit-item {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            font-size: 0.8em;
        }

        .gai-label {
            color: var(--color-text-dim);
        }

        .gai-value {
            font-weight: 600;
            color: var(--color-text);
        }

        /* ─── Profile: Model Grid ───────── */
        .model-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: var(--space-2);
        }

        @media (max-width: 480px) {
            .model-grid { grid-template-columns: 1fr; }
        }

        .model-card {
            background: rgba(255,255,255,0.02);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            padding: var(--space-2) var(--space-3);
            transition: border-color 0.2s cubic-bezier(.4,0,.2,1), background 0.2s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .model-card:hover {
                border-color: var(--color-border-hover);
                background: var(--color-surface-hover);
            }
        }

        .model-card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: var(--space-1);
        }

        .model-card-name {
            font-size: 0.82em;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: var(--space-1);
        }

        .model-card-pct {
            font-size: 0.82em;
            font-weight: 700;
        }

        .model-tag-badge {
            font-size: 0.65em;
            padding: 1px 5px;
            border-radius: var(--radius-sm);
            background: rgba(96, 165, 250, 0.15);
            color: var(--color-info);
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin-left: var(--space-1);
        }

        .model-card-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: var(--space-1);
        }

        .model-card-reset {
            font-size: 0.7em;
            color: var(--color-text-dim);
            opacity: 0.7;
        }

        /* ─── Profile: MIME Chips ────────── */
        .mime-chips {
            display: flex;
            gap: var(--space-1);
            flex-wrap: wrap;
        }

        .mime-chip {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            font-size: 0.65em;
            padding: 1px 5px;
            border-radius: var(--radius-sm);
            background: rgba(255,255,255,0.05);
            color: var(--color-text-dim);
            border: 1px solid var(--color-border);
        }

        .mime-chip-none {
            opacity: 0.4;
            font-style: italic;
        }

        .mime-icon {
            flex-shrink: 0;
        }


        /* ─── Session Detail (overrides) ── */
        .session-detail:first-child {
            margin-top: 0;
        }

        .session-detail summary {
            padding: var(--space-2) var(--space-3);
            flex-direction: column;
            align-items: stretch;
            gap: var(--space-1);
        }

        /* Hide the summary-level arrow for session-detail; arrow lives inside session-summary-row instead */
        .session-detail summary::before {
            display: none;
        }

        .session-summary-row {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            flex-wrap: wrap;
        }

        .session-summary-row::before {
            content: '\u25B8';
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            font-size: 1.1em;
            width: 20px;
            height: 20px;
            border-radius: var(--radius-sm);
            background: var(--color-surface-hover);
            transition: transform 0.2s cubic-bezier(.4,0,.2,1), background 0.2s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .session-summary-row:hover::before {
                background: var(--color-border-hover);
            }
        }

        .session-detail[open] .session-summary-row::before {
            transform: rotate(90deg);
            background: rgba(var(--color-info-rgb, 100,149,237), 0.15);
        }

        .session-title-text {
            font-weight: 500;
            color: var(--color-text);
            flex-shrink: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 55%;
        }

        .session-pct-inline {
            margin-left: auto;
            font-weight: 700;
            font-size: 0.9em;
        }

        .session-bar-wrap.compact {
            height: 4px;
            width: 100%;
            border-radius: 2px;
        }

        .session-detail .details-body {
            padding: var(--space-2) var(--space-3) var(--space-3);
            border-top: 1px solid var(--color-border);
        }

        /* ─── Raw Data Panel ──────────── */
        .raw-desc {
            font-size: 0.78em;
            color: var(--color-text-dim);
            margin-bottom: var(--space-2);
            opacity: 0.7;
        }

        .raw-json {
            background: rgba(0,0,0,0.3);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            padding: var(--space-3);
            font-family: var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', monospace);
            font-size: 0.72em;
            line-height: 1.4;
            overflow-x: auto;
            max-height: 500px;
            overflow-y: auto;
            white-space: pre;
            word-break: break-all;
            color: var(--color-text-dim);
            tab-size: 2;
        }

        .raw-json code {
            font-family: inherit;
        }

        /* ─── Settings Card ───────────── */
        .stg-card {
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-lg);
            padding: var(--space-4);
            margin-bottom: var(--space-3);
            position: relative;
            overflow: hidden;
            transition: border-color 0.2s cubic-bezier(.4,0,.2,1), box-shadow 0.2s cubic-bezier(.4,0,.2,1);
        }

        .stg-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            bottom: 0;
            width: 3px;
            background: var(--stg-accent, var(--color-border));
            border-radius: var(--radius-lg) 0 0 var(--radius-lg);
        }

        @media (hover: hover) {
            .stg-card:hover {
                border-color: var(--color-border-hover);
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
            }
        }

        /* Accent colors per section type */
        .stg-card[data-accent="storage"]  { --stg-accent: var(--color-info); }
        .stg-card[data-accent="warn"]     { --stg-accent: var(--color-warn); }
        .stg-card[data-accent="quota"]    { --stg-accent: var(--color-ok); }
        .stg-card[data-accent="poll"]     { --stg-accent: #818cf8; }
        .stg-card[data-accent="display"]  { --stg-accent: #38bdf8; }
        .stg-card[data-accent="model"]    { --stg-accent: #f472b6; }
        .stg-card[data-accent="activity"] { --stg-accent: #fb923c; }
        .stg-card[data-accent="history"]  { --stg-accent: #2dd4bf; }
        .stg-card[data-accent="debug"]    { --stg-accent: var(--color-danger); }
        .stg-card[data-accent="zoom"]     { --stg-accent: #a78bfa; }

        .stg-header {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            margin-bottom: var(--space-3);
        }

        .stg-header-icon {
            width: 28px;
            height: 28px;
            border-radius: var(--radius-md);
            background: color-mix(in srgb, var(--stg-accent, var(--color-border)) 15%, transparent);
            color: var(--stg-accent, var(--color-text));
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .stg-header-icon svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
        }

        .stg-header h2 {
            font-size: 0.88em;
            font-weight: 700;
            letter-spacing: 0.3px;
            color: var(--color-text);
            margin: 0;
        }

        .setting-row label {
            font-size: 0.85em;
            font-weight: 600;
            color: var(--color-text);
            display: block;
            margin-bottom: var(--space-1);
        }

        .threshold-input-row {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            margin-bottom: var(--space-2);
        }

        .threshold-input {
            appearance: none;
            -moz-appearance: textfield;
            background: rgba(0,0,0,0.3);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            color: var(--color-text);
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 0.85em;
            padding: var(--space-1) var(--space-2);
            width: 140px;
            transition: border-color 0.15s cubic-bezier(.4,0,.2,1);
        }

        /* Hide native spinner */
        .threshold-input::-webkit-outer-spin-button,
        .threshold-input::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }

        .threshold-input:focus-visible {
            outline: none;
            border-color: var(--color-info);
            box-shadow: 0 0 0 2px rgba(96,165,250,0.2);
        }

        /* Custom number spinner wrapper */
        .num-spinner {
            display: inline-flex;
            align-items: center;
            gap: 0;
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            overflow: hidden;
            background: rgba(0,0,0,0.3);
            transition: border-color 0.15s cubic-bezier(.4,0,.2,1);
        }

        .num-spinner:focus-within {
            border-color: var(--color-info);
            box-shadow: 0 0 0 2px rgba(96,165,250,0.2);
        }

        .num-spinner .threshold-input {
            border: none;
            border-radius: 0;
            background: transparent;
            width: 100px;
            text-align: center;
        }

        .num-spinner .threshold-input:focus-visible {
            box-shadow: none;
        }

        .num-spinner-btn {
            appearance: none;
            border: none;
            background: var(--color-surface);
            color: var(--color-text-dim);
            font-size: 1em;
            font-weight: 700;
            width: 28px;
            height: 30px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            user-select: none;
            transition: background 0.15s cubic-bezier(.4,0,.2,1), color 0.15s cubic-bezier(.4,0,.2,1);
        }

        .num-spinner-btn:active {
            transform: scale(0.98);
        }

        @media (hover: hover) {
            .num-spinner-btn:hover {
                background: var(--color-border-hover);
                color: var(--color-text);
            }
        }

        .num-spinner-btn:focus-visible {
            outline: none;
            box-shadow: inset 0 0 0 2px var(--color-info);
        }

        .num-spinner-btn.decrement {
            border-right: 1px solid var(--color-border);
        }

        .num-spinner-btn.increment {
            border-left: 1px solid var(--color-border);
        }

        .threshold-presets {
            display: flex;
            gap: var(--space-1);
            flex-wrap: wrap;
        }

        .preset-btn {
            appearance: none;
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-sm);
            color: var(--color-text-dim);
            font-size: 0.75em;
            font-family: inherit;
            padding: 2px var(--space-2);
            cursor: pointer;
            transition: background 0.15s cubic-bezier(.4,0,.2,1), color 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
        }

        .preset-btn:focus-visible {
            outline: none;
            box-shadow: 0 0 0 2px var(--color-info);
        }

        .preset-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .preset-btn:hover {
                background: rgba(96,165,250,0.12);
                color: var(--color-info);
                border-color: var(--color-info);
            }
        }

        .threshold-feedback {
            font-size: 0.85em;
            color: var(--color-ok);
            font-weight: 700;
            opacity: 0;
            transition: opacity 0.3s cubic-bezier(.4,0,.2,1);
        }

        /* ─── Zoom Control ─────────────── */
        .zoom-control {
            display: flex;
            flex-direction: column;
            gap: var(--space-3);
        }

        .zoom-presets {
            display: flex;
            gap: var(--space-1);
            flex-wrap: wrap;
        }

        .zoom-preset.is-active {
            background: rgba(167, 139, 250, 0.2);
            color: #a78bfa;
            border-color: #a78bfa;
            font-weight: 700;
        }

        .zoom-slider-row {
            display: flex;
            align-items: center;
            gap: var(--space-3);
        }

        .zoom-range {
            -webkit-appearance: none;
            appearance: none;
            flex: 1;
            height: 4px;
            border-radius: 2px;
            background: var(--color-border);
            outline: none;
            transition: background 0.15s cubic-bezier(.4,0,.2,1);
        }

        .zoom-range::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: #a78bfa;
            border: 2px solid rgba(0,0,0,0.3);
            cursor: pointer;
            transition: transform 0.15s cubic-bezier(.4,0,.2,1), box-shadow 0.15s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .zoom-range::-webkit-slider-thumb:hover {
                transform: scale(1.2);
                box-shadow: 0 0 0 4px rgba(167, 139, 250, 0.2);
            }
        }

        .zoom-range:focus-visible::-webkit-slider-thumb {
            box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.4);
        }

        .zoom-value {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 0.88em;
            font-weight: 700;
            color: #a78bfa;
            min-width: 3.5em;
            text-align: right;
        }

        @media (prefers-reduced-motion: reduce) {
            .zoom-range::-webkit-slider-thumb {
                transition: none;
            }
        }

        /* ─── Tab Bar ─────────────────── */
        /* ─── Tab Color Tokens ───────── */
        .tab-btn[data-color="blue"]   { --tab-c: 96, 165, 250; }
        .tab-btn[data-color="green"]  { --tab-c: 74, 222, 128; }
        .tab-btn[data-color="orange"] { --tab-c: 251, 146, 60; }
        .tab-btn[data-color="purple"] { --tab-c: 167, 139, 250; }
        .tab-btn[data-color="cyan"]   { --tab-c: 34, 211, 238; }
        .tab-btn[data-color="yellow"] { --tab-c: 250, 204, 21; }
        .tab-btn[data-color="gray"]   { --tab-c: 148, 163, 184; }

        .tab-bar {
            display: flex;
            gap: 2px;
            margin-bottom: 0;
            margin-top: var(--space-1);
            background: var(--color-surface);
            border-radius: var(--radius-full, 9999px);
            padding: 3px;
            position: relative;
            overflow-x: auto;
            overflow-y: hidden;
        }

        /* Hide scrollbar on tab-bar */
        .tab-bar::-webkit-scrollbar { display: none; }

        .tab-slider {
            position: absolute;
            top: 3px;
            bottom: 3px;
            border-radius: var(--radius-full, 9999px);
            background: rgba(var(--slider-c, 96, 165, 250), 0.18);
            transition: left 0.35s cubic-bezier(.34,1.56,.64,1),
                        width 0.35s cubic-bezier(.34,1.56,.64,1),
                        background 0.3s cubic-bezier(.4,0,.2,1);
            pointer-events: none;
            z-index: 0;
        }

        .tab-btn {
            appearance: none;
            background: transparent;
            border: none;
            color: var(--color-text-dim);
            font-family: inherit;
            font-size: 0.78em;
            font-weight: 500;
            padding: var(--space-1) var(--space-3);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: var(--space-1);
            border-radius: var(--radius-full, 9999px);
            white-space: nowrap;
            position: relative;
            z-index: 1;
            transition: color 0.2s cubic-bezier(.4,0,.2,1);
        }

        .tab-btn:focus-visible {
            outline: none;
            box-shadow: 0 0 0 2px rgba(var(--tab-c, 96, 165, 250), 0.6);
        }

        .tab-btn:active { transform: scale(0.97); }

        .tab-btn.active {
            color: rgb(var(--tab-c, 96, 165, 250));
            font-weight: 700;
        }

        @media (hover: hover) {
            .tab-btn:not(.active):hover {
                color: var(--color-text);
                background: rgba(255,255,255,0.04);
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .tab-slider { transition: none; }
        }

        .tab-pane {
            display: none;
        }

        .tab-pane.active {
            display: block;
        }

        /* ─── Toggle Switch ────────────── */
        .toggle-group {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
        }

        .toggle-row {
            display: flex;
            align-items: center;
            gap: var(--space-3);
            cursor: pointer;
            font-size: 0.85em;
        }

        .toggle-cb {
            opacity: 0;
            position: absolute;
            width: 0;
            height: 0;
        }

        .toggle-track {
            position: relative;
            width: 36px;
            height: 20px;
            background: rgba(255,255,255,0.1);
            border-radius: var(--radius-full, 9999px);
            flex-shrink: 0;
            transition: background 0.2s cubic-bezier(.4,0,.2,1);
        }

        .toggle-thumb {
            position: absolute;
            top: 2px;
            left: 2px;
            width: 16px;
            height: 16px;
            background: var(--color-text-dim);
            border-radius: 50%;
            transition: transform 0.2s cubic-bezier(.4,0,.2,1), background 0.2s cubic-bezier(.4,0,.2,1);
        }

        .toggle-cb:checked + .toggle-track {
            background: var(--color-info);
        }

        .toggle-cb:checked + .toggle-track .toggle-thumb {
            transform: translateX(16px);
            background: #fff;
        }

        .toggle-cb:focus-visible + .toggle-track {
            box-shadow: 0 0 0 2px var(--color-info);
        }

        .toggle-row code {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 0.85em;
            color: var(--color-text-dim);
            opacity: 0.6;
        }

        /* ─── Radio Group ─────────────── */
        .radio-group {
            display: flex;
            flex-direction: column;
            gap: var(--space-1);
            margin-top: var(--space-1);
        }

        .radio-row {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            cursor: pointer;
            font-size: 0.82em;
            padding: var(--space-1) var(--space-2);
            border-radius: var(--radius-sm);
            transition: background 0.15s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .radio-row:hover { background: var(--color-surface); }
        }

        .radio-row input[type="radio"] {
            opacity: 0;
            position: absolute;
            width: 0;
            height: 0;
        }

        .radio-row input[type="radio"] + span::before {
            content: '';
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid var(--color-text-dim);
            border-radius: 50%;
            margin-right: var(--space-1);
            vertical-align: middle;
            transition: border-color 0.15s cubic-bezier(.4,0,.2,1), box-shadow 0.15s cubic-bezier(.4,0,.2,1);
        }

        .radio-row input[type="radio"]:checked + span::before {
            border-color: var(--color-info);
            box-shadow: inset 0 0 0 3px var(--color-info);
        }

        .radio-row input[type="radio"]:focus-visible + span::before {
            box-shadow: 0 0 0 2px var(--color-info);
        }

        /* ─── Settings Model Grid ──────── */
        .setting-model-grid {
            display: flex;
            flex-direction: column;
            gap: var(--space-2);
        }

        .setting-model-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-2);
        }

        .setting-model-label {
            font-size: 0.82em;
            font-weight: 500;
            color: var(--color-text);
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .setting-model-row .threshold-input {
            width: 120px;
        }

        .storage-path-box {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-2) var(--space-3);
            margin-bottom: var(--space-2);
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
        }

        .storage-path-text {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 0.8em;
            color: var(--color-text);
        }

        .storage-path-state {
            flex-shrink: 0;
            padding: 2px var(--space-2);
            border-radius: var(--radius-full);
            font-size: 0.72em;
            font-weight: 700;
            letter-spacing: 0.3px;
            text-transform: uppercase;
        }

        .storage-path-state.is-ready {
            background: rgba(74,222,128,0.12);
            color: var(--color-ok);
        }

        .storage-path-state.is-missing {
            background: rgba(248,113,113,0.12);
            color: var(--color-danger);
        }

        .storage-actions {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: var(--space-2);
            margin-bottom: var(--space-3);
        }

        .storage-stat-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
            gap: var(--space-2);
        }

        .storage-stat {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 2px;
            padding: var(--space-2);
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            text-align: center;
            transition: border-color 0.15s cubic-bezier(.4,0,.2,1), transform 0.15s cubic-bezier(.4,0,.2,1), box-shadow 0.15s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .storage-stat:hover {
                border-color: var(--color-info);
                transform: translateY(-1px);
                box-shadow: 0 2px 6px rgba(0,0,0,0.1);
            }
        }

        .storage-stat-val {
            font-size: 1.15em;
            font-weight: 700;
            color: var(--color-info);
        }

        .storage-stat-label {
            font-size: 0.68em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.4px;
            line-height: 1.2;
        }

        /* ─── Pause Button ────────────── */
        .action-btn.paused {
            color: var(--color-ok);
            border-color: var(--color-ok);
        }

        .paused-indicator {
            font-size: 0.7em;
            font-weight: 700;
            color: var(--color-warn);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            animation: pauseBlink 1.5s ease-in-out infinite;
        }

        @keyframes pauseBlink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
        }

        /* ─── Reduced Motion ─────────── */
        @media (prefers-reduced-motion: reduce) {
            .progress-bar,
            .session-bar,
            .quota-bar,
            .credit-bar,
            .lang-btn,
            .action-btn,
            .card,
            .tl-dot {
                transition: none;
            }
            .action-btn.spinning svg {
                animation: none;
            }
            .paused-indicator,
            .tl-pulse {
                animation: none;
            }
        }

        /* ─── Copy Button ────────────── */
        .copy-btn {
            appearance: none;
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-sm);
            color: var(--color-text-dim);
            font-size: 0.7em;
            font-family: inherit;
            padding: 2px var(--space-2);
            margin-left: auto;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: var(--space-1);
            transition: background 0.15s cubic-bezier(.4,0,.2,1), color 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
        }

        .copy-btn:focus-visible {
            outline: none;
            box-shadow: 0 0 0 2px var(--color-info);
        }

        .copy-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .copy-btn:hover {
                background: rgba(96,165,250,0.12);
                color: var(--color-info);
                border-color: var(--color-info);
            }
        }

        .copy-btn.copied {
            color: var(--color-ok);
            border-color: var(--color-ok);
        }

        /* ─── Danger Action Button ─────── */
        .danger-action {
            color: var(--color-danger);
            border-color: var(--color-danger-border, rgba(248,113,113,0.3));
            display: inline-flex;
            align-items: center;
            gap: var(--space-2);
            font-size: 0.82em;
            font-weight: 600;
            padding: var(--space-2) var(--space-3);
            border-radius: var(--radius-md);
        }

        @media (hover: hover) {
            .danger-action:hover {
                background: var(--color-danger-surface, rgba(248,113,113,0.12));
                color: var(--color-danger);
                border-color: var(--color-danger);
            }
        }

        /* ─── Card Header Row (title + action side by side) ─── */
        .card-header-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-3);
        }
        .card-header-row h2 { margin: 0; }
        .card-header-row .qt-clear-active {
            flex-shrink: 0;
            font-size: 0.75em;
            padding: var(--space-1) var(--space-3);
        }

        /* ─── Timeline Card ───────────── */
        .timeline-card {
            background: rgba(255,255,255,0.02);
            border: 1px solid var(--color-border);
            border-left: 3px solid var(--color-border);
            border-radius: var(--radius-md);
            padding: var(--space-3);
            margin-bottom: var(--space-2);
            transition: border-color 0.2s cubic-bezier(.4,0,.2,1), background 0.2s cubic-bezier(.4,0,.2,1);
        }
        .timeline-card.qt-card-active {
            border-left-color: var(--color-info, #60a5fa);
            background: rgba(96,165,250,0.04);
        }
        .timeline-card.qt-card-complete {
            border-left-color: var(--color-ok, #34d399);
        }
        .timeline-card.qt-card-reset {
            border-left-color: var(--color-warn, #fbbf24);
        }

        @media (hover: hover) {
            .timeline-card:hover {
                border-color: var(--color-border-hover);
                background: var(--color-surface);
            }
        }

        .timeline-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-2);
            margin-bottom: var(--space-2);
        }

        .timeline-model {
            font-weight: 600;
            font-size: 0.95em;
        }

        /* ─── Quota Progress Bar ──────── */
        .qt-progress-wrap {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            margin-bottom: var(--space-2);
        }
        .qt-progress-track {
            flex: 1;
            height: 6px;
            border-radius: 3px;
            background: rgba(255,255,255,0.06);
            overflow: hidden;
        }
        .qt-progress-fill {
            height: 100%;
            border-radius: 3px;
            transition: width 0.4s cubic-bezier(.4,0,.2,1);
        }
        .qt-progress-active {
            animation: qtProgressPulse 2s ease-in-out infinite;
        }
        @keyframes qtProgressPulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
        }
        .qt-progress-label {
            font-weight: 700;
            font-size: 0.92em;
            min-width: 40px;
            text-align: right;
        }

        /* ─── Meta Chips Row ──────────── */
        .qt-meta-row {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-1);
            margin-bottom: var(--space-2);
        }
        .qt-meta-chip {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            font-size: 0.82em;
            padding: 2px var(--space-2);
            border-radius: var(--radius-sm);
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(255,255,255,0.06);
            color: var(--color-text-dim);
        }
        .qt-meta-duration {
            font-weight: 600;
            color: var(--color-text);
        }

        /* ─── History Summary Grid ────── */
        .qt-summary-grid {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-2);
            margin-bottom: var(--space-3);
            padding: var(--space-2);
            border-radius: var(--radius-md);
            background: rgba(255,255,255,0.02);
            border: 1px solid rgba(255,255,255,0.06);
        }
        .qt-summary-item {
            display: flex;
            flex-direction: column;
            align-items: center;
            flex: 1;
            min-width: 70px;
            padding: var(--space-1) var(--space-2);
        }
        .qt-summary-val {
            font-weight: 700;
            font-size: 1em;
        }
        .qt-summary-dim {
            font-weight: 400;
            color: var(--color-text-dim);
            font-size: 0.85em;
        }
        .qt-summary-warn { color: var(--color-warn, #fbbf24); }
        .qt-summary-label {
            font-size: 0.78em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin-top: 2px;
        }

        /* ─── Timeline Track ──────────── */
        .tl-track {
            position: relative;
            padding-left: var(--space-4);
        }

        .tl-track::before {
            content: '';
            position: absolute;
            left: 7px;
            top: 0;
            bottom: 0;
            width: 2px;
            background: linear-gradient(180deg, var(--color-ok, #34d399) 0%, var(--color-warn, #fbbf24) 50%, var(--color-danger, #ef4444) 100%);
            border-radius: 1px;
            opacity: 0.4;
        }

        .tl-node {
            position: relative;
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-1) 0;
        }

        .tl-dot {
            position: absolute;
            left: calc(var(--space-4) * -1 + 3px);
            width: 10px;
            height: 10px;
            border-radius: 50%;
            border: 2px solid var(--color-bg);
            flex-shrink: 0;
            z-index: 1;
        }
        .tl-dot-hidden {
            width: 6px;
            height: 6px;
            left: calc(var(--space-4) * -1 + 5px);
            background: var(--color-text-dim);
            opacity: 0.4;
            border: none;
        }

        .tl-content {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            font-size: 0.88em;
        }

        .tl-pct {
            font-weight: 700;
            min-width: 36px;
        }
        .tl-hidden-label {
            color: var(--color-text-dim);
            font-weight: 400;
            font-style: italic;
            font-size: 0.9em;
        }

        .tl-time {
            color: var(--color-text-dim);
            font-size: 0.92em;
        }

        .tl-elapsed {
            color: var(--color-text-dim);
            font-size: 0.88em;
            opacity: 0.7;
        }

        /* ─── Timeline Pulse (active) ─── */
        @keyframes tlPulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(1.3); }
        }

        .tl-pulse {
            background: var(--color-info);
            animation: tlPulse 2s ease-in-out infinite;
        }

        @media (prefers-reduced-motion: reduce) {
            .tl-pulse, .qt-progress-active { animation: none; }
        }


        /* ─── Monitor Overview ─── */
        .monitor-overview-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: var(--space-3);
            margin-bottom: var(--space-3);
        }
        .monitor-summary-card {
            position: relative;
            overflow: hidden;
            min-height: 220px;
        }
        .monitor-summary-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, rgba(96,165,250,0.95), rgba(45,212,191,0.75));
        }
        .monitor-summary-card-quota::before {
            background: linear-gradient(90deg, rgba(74,222,128,0.95), rgba(96,165,250,0.75));
        }
        .monitor-summary-card-gm::before {
            background: linear-gradient(90deg, rgba(251,146,60,0.95), rgba(250,204,21,0.75));
        }
        .monitor-summary-card-cost::before {
            background: linear-gradient(90deg, rgba(167,139,250,0.95), rgba(96,165,250,0.75));
        }
        .monitor-summary-card-tracking::before {
            background: linear-gradient(90deg, rgba(250,204,21,0.95), rgba(248,113,113,0.75));
        }
        .monitor-tracking-card {
            min-height: 0;
        }
        .monitor-summary-head {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: var(--space-2);
            margin-bottom: var(--space-3);
        }
        .monitor-summary-kicker {
            font-size: 0.72em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.6px;
            margin-bottom: 2px;
        }
        .monitor-summary-head .card h2 {
            margin-bottom: 0;
        }
        .monitor-summary-head h2 {
            margin-bottom: 0;
        }
        .monitor-summary-note {
            font-size: 0.8em;
            color: var(--color-text-dim);
            text-align: right;
            line-height: 1.4;
        }
        .monitor-summary-empty {
            color: var(--color-text-dim);
            font-size: 0.86em;
            line-height: 1.6;
            opacity: 0.9;
        }
        .monitor-mini-tags {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-1);
            margin-top: var(--space-2);
        }
        .monitor-mini-tag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px var(--space-2);
            border-radius: var(--radius-full, 9999px);
            border: 1px solid var(--color-border);
            background: rgba(255,255,255,0.03);
            color: var(--color-text-dim);
            font-size: 0.75em;
            line-height: 1.5;
        }
        .monitor-mini-tag.is-warn {
            border-color: rgba(250,204,21,0.2);
            background: rgba(250,204,21,0.08);
            color: var(--color-warn);
        }
        .monitor-inline-section {
            margin-top: var(--space-3);
        }
        .monitor-inline-title {
            font-size: 0.76em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: var(--space-2);
        }
        .monitor-gm-model-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: var(--space-1);
        }
        .monitor-gm-model-item {
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            background: rgba(255,255,255,0.02);
            padding: 6px var(--space-2);
            min-width: 0;
        }
        .monitor-gm-model-name {
            font-size: 0.71em;
            color: var(--color-text-dim);
            line-height: 1.4;
            min-height: 2.1em;
            margin-bottom: 4px;
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
            overflow: hidden;
            word-break: break-word;
            overflow-wrap: anywhere;
        }
        .monitor-gm-model-metrics {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: var(--space-1);
        }
        .monitor-gm-model-main {
            font-size: 0.95em;
            font-weight: 700;
            color: var(--color-text);
            line-height: 1.2;
        }
        .monitor-gm-model-sub {
            font-size: 0.7em;
            color: var(--color-text-dim);
        }
        .monitor-quota-list {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
            gap: var(--space-2);
        }
        .monitor-quota-item {
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            padding: var(--space-2);
            background: rgba(255,255,255,0.02);
        }
        .monitor-quota-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-2);
            margin-bottom: var(--space-1);
        }
        .monitor-quota-name {
            font-size: 0.82em;
            font-weight: 600;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .monitor-quota-pct {
            flex-shrink: 0;
            font-size: 0.84em;
            font-weight: 700;
        }
        .monitor-quota-track {
            height: 6px;
            border-radius: var(--radius-full, 9999px);
            background: rgba(255,255,255,0.06);
            overflow: hidden;
        }
        .monitor-quota-fill {
            height: 100%;
            border-radius: inherit;
            transition: width 0.25s cubic-bezier(.4,0,.2,1), background 0.25s cubic-bezier(.4,0,.2,1);
        }
        .monitor-quota-meta {
            margin-top: 6px;
            font-size: 0.74em;
            color: var(--color-text-dim);
        }
        .monitor-cost-list {
            display: grid;
            gap: var(--space-2);
            margin-top: var(--space-3);
        }
        .monitor-cost-model {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-2);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            background: rgba(255,255,255,0.02);
            position: relative;
            overflow: hidden;
        }
        .monitor-cost-model-bar {
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 0;
            background: linear-gradient(90deg, rgba(167,139,250,0.16), rgba(96,165,250,0.06));
            border-right: 1px solid rgba(167,139,250,0.18);
            transition: width 0.25s cubic-bezier(.4,0,.2,1);
        }
        .monitor-cost-model-main {
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
            position: relative;
            z-index: 1;
        }
        .monitor-cost-model-name {
            font-size: 0.82em;
            font-weight: 600;
            color: var(--color-text);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .monitor-cost-model-calls {
            font-size: 0.73em;
            color: var(--color-text-dim);
        }
        .monitor-cost-model-side {
            flex-shrink: 0;
            text-align: right;
            position: relative;
            z-index: 1;
        }
        .monitor-cost-model-cost {
            font-size: 0.82em;
            font-weight: 700;
            color: var(--color-warn);
        }
        .monitor-tracking-list {
            display: grid;
            gap: var(--space-2);
            margin-top: var(--space-3);
        }
        .monitor-track-row {
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            background: rgba(255,255,255,0.02);
            padding: var(--space-2) var(--space-3);
        }
        .monitor-track-main {
            display: grid;
            gap: var(--space-2);
        }
        .monitor-track-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: var(--space-2);
        }
        .monitor-track-name {
            font-size: 0.84em;
            font-weight: 700;
            color: var(--color-text);
        }
        .monitor-track-pct {
            font-size: 0.84em;
            font-weight: 700;
            flex-shrink: 0;
        }
        .monitor-track-bar {
            height: 6px;
            border-radius: var(--radius-full, 9999px);
            background: rgba(255,255,255,0.06);
            overflow: hidden;
        }
        .monitor-track-fill {
            height: 100%;
            border-radius: inherit;
            transition: width 0.25s cubic-bezier(.4,0,.2,1), background 0.25s cubic-bezier(.4,0,.2,1);
        }
        .monitor-track-meta {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-1);
        }



        /* ─── Light Theme Overrides ────── */
        body.vscode-light {
            /* Semantic palette tokens for light mode */
            --lt-green: 22,163,74;
            --lt-green-text: #16a34a;
            --lt-green-deep: #15803d;
            --lt-amber: 202,138,4;
            --lt-amber-text: #a16207;
            --lt-amber-deep: #92400e;
            --lt-blue: 37,99,235;
            --lt-blue-text: #2563eb;
            --lt-blue-deep: #1d4ed8;
            --lt-red: 220,38,38;
            --lt-red-text: #dc2626;
            --lt-red-deep: #b91c1c;
            --lt-orange: 180,83,9;
            --lt-orange-text: #b45309;
            --lt-teal: 13,148,136;
            --lt-teal-text: #0f766e;

            /* Override core semantic tokens */
            --color-ok: var(--lt-green-text);
            --color-warn: var(--lt-amber-text);
            --color-danger: var(--lt-red-text);
            --color-info: var(--lt-blue-text);
            --color-surface: rgba(0,0,0,0.03);
            --color-border: rgba(0,0,0,0.1);
            --color-border-hover: rgba(0,0,0,0.22);
            --color-surface-hover: rgba(0,0,0,0.06);
        }

        /* ─── Light Theme: Activity GM Chips ──── */
        body.vscode-light .act-tl-gm-in  { background: rgba(var(--lt-blue),0.1); color: var(--lt-blue-deep); }
        body.vscode-light .act-tl-gm-out { background: rgba(var(--lt-green),0.1); color: var(--lt-green-deep); }
        body.vscode-light .act-tl-gm-ttft { background: rgba(var(--lt-amber),0.1); color: var(--lt-amber-text); }
        body.vscode-light .act-tl-gm-cache { background: rgba(var(--lt-teal),0.1); color: var(--lt-teal-text); }
        body.vscode-light .act-tl-gm-retry { background: rgba(var(--lt-red),0.1); color: var(--lt-red-deep); }

        /* ─── Light Theme: Activity Timeline Tags ──── */
        body.vscode-light .act-tl-tag-alias { background: rgba(var(--lt-amber),0.1); color: var(--lt-amber-deep); border-color: rgba(var(--lt-amber),0.2); }
        body.vscode-light .act-tl-tag-struct { background: rgba(var(--lt-blue),0.1); color: var(--lt-blue-deep); border-color: rgba(var(--lt-blue),0.2); }
        body.vscode-light .act-tl-tag-est { background: rgba(var(--lt-red),0.08); color: #991b1b; border-color: rgba(var(--lt-red),0.2); }
        body.vscode-light .act-tl-tag-basis { background: rgba(var(--lt-teal),0.1); color: var(--lt-teal-text); border-color: rgba(var(--lt-teal),0.2); }
        body.vscode-light .act-tl-tag-model { background: rgba(0,0,0,0.04); color: rgba(0,0,0,0.5); border-color: rgba(0,0,0,0.08); }
        body.vscode-light .act-tl-ai-preview { color: #c2410c; }

        /* ─── Light Theme: Activity Misc ──── */
        body.vscode-light .act-tl-segment { border-color: rgba(0,0,0,0.06); background: rgba(0,0,0,0.015); }
        body.vscode-light .act-tl-segment-caption { background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.06); }
        body.vscode-light .act-tl-segment-body .act-tl-item::before { background: rgba(0,0,0,0.16); }
        body.vscode-light .act-tl-item { border-bottom-color: rgba(0,0,0,0.04); }
        body.vscode-light .act-tool-tag { background: rgba(0,0,0,0.05); }
        body.vscode-light .act-tl-tool-name { background: rgba(0,0,0,0.05); }
        body.vscode-light .act-tl-expand { background: rgba(0,0,0,0.03); }
        body.vscode-light .act-dist-note { color: var(--lt-amber-deep); opacity: 1; border-left-color: var(--lt-orange-text); }
        body.vscode-light .github-banner { border-color: rgba(var(--lt-green),0.2); background: rgba(var(--lt-green),0.04); }
        body.vscode-light .github-banner .info-banner-icon { color: var(--lt-green-text); }
        body.vscode-light .info-banner-link { border-color: rgba(var(--lt-green),0.25); background: rgba(var(--lt-green),0.08); color: var(--lt-green-text); }
        body.vscode-light .multiwin-banner { border-color: rgba(var(--lt-orange),0.15); background: rgba(var(--lt-orange),0.03); }
        body.vscode-light .multiwin-banner .info-banner-icon { color: var(--lt-orange-text); }
        body.vscode-light .disclaimer-banner { border-color: rgba(var(--lt-orange),0.25); background: rgba(var(--lt-orange),0.04); }
        body.vscode-light .disclaimer-banner summary { color: var(--lt-amber-deep); }
        body.vscode-light .disclaimer-banner[open] { border-color: rgba(var(--lt-orange),0.35); background: rgba(var(--lt-orange),0.06); }
        body.vscode-light .disclaimer-body { color: rgba(0,0,0,0.7); border-top-color: rgba(var(--lt-orange),0.15); }
        body.vscode-light .disclaimer-body strong { color: var(--lt-amber-deep); }

        /* ─── Light Theme: Settings Panel ──── */
        body.vscode-light .toggle-track { background: rgba(0,0,0,0.12); }
        body.vscode-light .toggle-cb:checked + .toggle-track { background: var(--color-info); }
        body.vscode-light .num-spinner { background: rgba(0,0,0,0.03); }
        body.vscode-light .threshold-input { background: rgba(0,0,0,0.03); }
        body.vscode-light .threshold-input:focus-visible { box-shadow: 0 0 0 2px rgba(var(--lt-blue),0.2); }
        body.vscode-light .num-spinner:focus-within { box-shadow: 0 0 0 2px rgba(var(--lt-blue),0.2); }
        body.vscode-light .raw-json { background: rgba(0,0,0,0.03); }
        body.vscode-light .danger-action {
            --color-danger-border: rgba(var(--lt-red),0.25);
            --color-danger-surface: rgba(var(--lt-red),0.08);
        }
        body.vscode-light .storage-path-state.is-ready { background: rgba(var(--lt-green),0.1); }
        body.vscode-light .storage-path-state.is-missing { background: rgba(var(--lt-red),0.1); }
        body.vscode-light .stg-header-icon {
            background: color-mix(in srgb, var(--stg-accent, var(--color-border)) 12%, transparent);
        }
        body.vscode-light .storage-stat-val { color: var(--lt-blue-deep); }
        body.vscode-light .storage-stat:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }

        /* ─── Light Theme: Sticky TopBar ──── */
        body.vscode-light .panel-topbar {
            background: rgba(255, 255, 255, 0.92);
        }
        body.vscode-light .panel-topbar.scrolled {
            box-shadow: 0 2px 12px rgba(0,0,0,0.08);
        }

        /* ─── Light Theme: Info Chips ──── */
        body.vscode-light .chip-github {
            color: var(--lt-green-text);
            background: rgba(var(--lt-green),0.06);
            border-color: rgba(var(--lt-green),0.15);
        }
        body.vscode-light .chip-github.active {
            color: var(--lt-green-deep);
            background: rgba(var(--lt-green),0.12);
            border-color: rgba(var(--lt-green),0.35);
        }
        @media (hover: hover) {
            body.vscode-light .chip-github:not(.active):hover {
                color: var(--lt-green-deep);
                background: rgba(var(--lt-green),0.1);
                border-color: rgba(var(--lt-green),0.25);
            }
        }
        body.vscode-light .chip-warn {
            color: var(--lt-amber-text);
            background: rgba(var(--lt-amber),0.05);
            border-color: rgba(var(--lt-amber),0.12);
        }
        body.vscode-light .chip-warn.active {
            color: var(--lt-amber-deep);
            background: rgba(var(--lt-amber),0.12);
            border-color: rgba(var(--lt-amber),0.3);
        }
        @media (hover: hover) {
            body.vscode-light .chip-warn:not(.active):hover {
                color: var(--lt-amber-deep);
                background: rgba(var(--lt-amber),0.08);
                border-color: rgba(var(--lt-amber),0.2);
            }
        }

        /* ─── Light Theme: Chip Dropdowns ──── */
        body.vscode-light .chip-dropdown-github {
            border-color: rgba(var(--lt-green),0.2);
            background: rgba(var(--lt-green),0.04);
        }
        body.vscode-light .chip-dropdown-notice {
            border-color: rgba(var(--lt-orange),0.15);
            background: rgba(var(--lt-orange),0.03);
        }
        body.vscode-light .chip-dropdown-disclaimer {
            border-color: rgba(var(--lt-orange),0.2);
            background: rgba(var(--lt-orange),0.04);
        }
        body.vscode-light .chip-dropdown {
            color: rgba(0,0,0,0.7);
        }
        body.vscode-light .chip-dropdown .disclaimer-body strong {
            color: var(--lt-amber-deep);
        }

        /* ─── High Contrast Overrides ──── */
        body.vscode-high-contrast {
            --color-border: rgba(255,255,255,0.25);
        }
    `;
}

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

        /* ─── Header ────────────────── */
        .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-4);
            padding-bottom: var(--space-3);
            border-bottom: 1px solid var(--color-border);
        }

        /* ─── Disclaimer Banner ────────── */
        .disclaimer-banner {
            margin-bottom: var(--space-3);
            border: 1px solid rgba(250, 204, 21, 0.15);
            border-radius: var(--radius-md);
            background: rgba(250, 204, 21, 0.04);
            font-size: 0.78em;
            color: var(--color-text-dim);
            overflow: hidden;
        }

        .disclaimer-banner summary {
            cursor: pointer;
            padding: var(--space-1) var(--space-2);
            display: flex;
            align-items: center;
            gap: var(--space-2);
            list-style: none;
            user-select: none;
            color: rgba(250, 204, 21, 0.7);
            transition: color 0.15s cubic-bezier(.4,0,.2,1);
        }

        .disclaimer-banner summary::-webkit-details-marker { display: none; }

        .disclaimer-banner summary:focus-visible {
            box-shadow: 0 0 0 2px var(--color-warn);
            outline: none;
            border-radius: var(--radius-md);
        }

        @media (hover: hover) {
            .disclaimer-banner summary:hover {
                color: var(--color-warn);
            }
        }

        .disclaimer-banner svg {
            flex-shrink: 0;
        }

        .disclaimer-banner[open] {
            border-color: rgba(250, 204, 21, 0.25);
            background: rgba(250, 204, 21, 0.06);
        }

        .disclaimer-body {
            padding: var(--space-1) var(--space-3) var(--space-2);
            border-top: 1px solid rgba(250, 204, 21, 0.1);
            line-height: 1.6;
            color: var(--color-text-dim);
        }

        .disclaimer-body strong {
            color: var(--color-warn);
            font-weight: 600;
        }

        .panel-header h1 {
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

        /* ─── Default Model ───────────── */
        .default-model {
            font-size: 0.8em;
            color: var(--color-text-dim);
            margin-bottom: var(--space-3);
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
            margin-bottom: var(--space-3);
        }

        .credit-row {}

        .credit-header {
            display: flex;
            justify-content: space-between;
            font-size: 0.8em;
            margin-bottom: 2px;
        }

        .credit-bar-wrap {
            height: 6px;
            background: rgba(255,255,255,0.06);
            border-radius: var(--radius-sm);
            overflow: hidden;
        }

        .credit-bar {
            height: 100%;
            border-radius: var(--radius-sm);
            transition: width 0.3s cubic-bezier(.4,0,.2,1);
        }

        /* ─── Feature Tags ───────────── */
        .feature-tags {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-1);
        }

        .feature-tag {
            font-size: 0.7em;
            padding: 2px 6px;
            border-radius: var(--radius-sm);
            background: rgba(255,255,255,0.04);
            color: var(--color-text-dim);
            border: 1px solid var(--color-border);
            opacity: 0.5;
            text-decoration: line-through;
        }

        .feature-tag.enabled {
            opacity: 1;
            text-decoration: none;
            background: rgba(74, 222, 128, 0.08);
            border-color: rgba(74, 222, 128, 0.2);
            color: var(--color-ok);
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
        .stg-card[data-accent="privacy"]  { --stg-accent: #a78bfa; }
        .stg-card[data-accent="history"]  { --stg-accent: #2dd4bf; }
        .stg-card[data-accent="debug"]    { --stg-accent: var(--color-danger); }

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

        /* ─── Tab Bar ─────────────────── */
        .tab-bar {
            display: flex;
            gap: 0;
            margin-bottom: var(--space-4);
            border-bottom: 1px solid var(--color-border);
        }

        .tab-btn {
            appearance: none;
            background: transparent;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--color-text-dim);
            font-family: inherit;
            font-size: 0.85em;
            font-weight: 600;
            padding: var(--space-2) var(--space-4);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: var(--space-1);
            transition: color 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
        }

        .tab-btn:focus-visible {
            outline: none;
            box-shadow: 0 0 0 2px var(--color-info);
        }

        .tab-btn:active { transform: scale(0.98); }

        .tab-btn.active {
            color: var(--color-info);
            border-bottom-color: var(--color-info);
        }

        @media (hover: hover) {
            .tab-btn:not(.active):hover {
                color: var(--color-text);
            }
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


        /* ─── Mini Quota Bar (Monitor) ─── */
        .mini-quota-section { padding: var(--space-2) var(--space-3); }
        .mini-quota-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: var(--space-2);
            font-size: 0.85em;
            font-weight: 600;
        }
        .mini-quota-row {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-2);
        }
        .mini-quota-pill {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-1) var(--space-2);
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            font-size: 0.8em;
            position: relative;
            overflow: hidden;
        }
        .mini-quota-pill::after {
            content: '';
            position: absolute;
            left: 0;
            bottom: 0;
            height: 2px;
            width: var(--bar-pct, 0%);
            background: var(--bar-color, var(--color-ok));
            transition: width 0.3s cubic-bezier(.4,0,.2,1);
        }
        .mini-quota-label { color: var(--color-text); }
        .mini-quota-pct { font-weight: 600; font-size: 0.9em; }
        .link-btn {
            background: none;
            border: none;
            color: var(--color-accent);
            cursor: pointer;
            font-size: 0.8em;
            padding: var(--space-1);
            border-radius: var(--radius-sm);
            transition: opacity 0.2s cubic-bezier(.4,0,.2,1);
        }
        @media (hover: hover) {
            .link-btn:hover { opacity: 0.8; }
        }
        .link-btn:focus-visible {
            box-shadow: 0 0 0 2px var(--color-accent);
        }

        /* ─── Profile Tab ────────────── */
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
        .credits-section { margin-top: var(--space-3); }
        .default-model {
            font-size: 0.85em;
            color: var(--color-text-dim);
            margin-top: var(--space-1);
        }
        .feature-tags {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-1);
        }
        .feature-tag {
            display: inline-block;
            padding: 2px var(--space-2);
            font-size: 0.75em;
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
        .mime-count {
            font-size: 0.7em;
            color: var(--color-text-dim);
            opacity: 0.6;
        }

        /* ─── Light Theme Overrides ────── */
        body.vscode-light {
            --color-ok: #16a34a;
            --color-warn: #ca8a04;
            --color-danger: #dc2626;
            --color-info: #2563eb;
            --color-surface: rgba(0,0,0,0.03);
            --color-border: rgba(0,0,0,0.1);
            --color-border-hover: rgba(0,0,0,0.22);
            --color-surface-hover: rgba(0,0,0,0.06);
        }

        /* ─── Light Theme: Activity GM Chips ──── */
        body.vscode-light .act-tl-gm-in  { background: rgba(37,99,235,0.1); color: #1d4ed8; }
        body.vscode-light .act-tl-gm-out { background: rgba(22,163,74,0.1); color: #15803d; }
        body.vscode-light .act-tl-gm-ttft { background: rgba(202,138,4,0.1); color: #a16207; }
        body.vscode-light .act-tl-gm-cache { background: rgba(13,148,136,0.1); color: #0f766e; }
        body.vscode-light .act-tl-gm-retry { background: rgba(220,38,38,0.1); color: #b91c1c; }

        /* ─── Light Theme: Activity Timeline Tags ──── */
        body.vscode-light .act-tl-tag-alias { background: rgba(202,138,4,0.1); color: #92400e; border-color: rgba(202,138,4,0.2); }
        body.vscode-light .act-tl-tag-struct { background: rgba(37,99,235,0.1); color: #1e40af; border-color: rgba(37,99,235,0.2); }
        body.vscode-light .act-tl-tag-est { background: rgba(220,38,38,0.08); color: #991b1b; border-color: rgba(220,38,38,0.2); }
        body.vscode-light .act-tl-tag-basis { background: rgba(13,148,136,0.1); color: #0f766e; border-color: rgba(13,148,136,0.2); }
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
        body.vscode-light .act-dist-note { color: #92400e; opacity: 1; border-left-color: #b45309; }
        body.vscode-light .disclaimer-banner { border-color: rgba(180,83,9,0.25); background: rgba(180,83,9,0.04); }
        body.vscode-light .disclaimer-banner summary { color: #92400e; }
        body.vscode-light .disclaimer-banner[open] { border-color: rgba(180,83,9,0.35); background: rgba(180,83,9,0.06); }
        body.vscode-light .disclaimer-body { color: rgba(0,0,0,0.7); border-top-color: rgba(180,83,9,0.15); }
        body.vscode-light .disclaimer-body strong { color: #92400e; }

        /* ─── Light Theme: Settings Panel ──── */
        body.vscode-light .toggle-track { background: rgba(0,0,0,0.12); }
        body.vscode-light .toggle-cb:checked + .toggle-track { background: var(--color-info); }
        body.vscode-light .num-spinner { background: rgba(0,0,0,0.03); }
        body.vscode-light .threshold-input { background: rgba(0,0,0,0.03); }
        body.vscode-light .threshold-input:focus-visible { box-shadow: 0 0 0 2px rgba(37,99,235,0.2); }
        body.vscode-light .num-spinner:focus-within { box-shadow: 0 0 0 2px rgba(37,99,235,0.2); }
        body.vscode-light .raw-json { background: rgba(0,0,0,0.03); }
        body.vscode-light .danger-action {
            --color-danger-border: rgba(220,38,38,0.25);
            --color-danger-surface: rgba(220,38,38,0.08);
        }
        body.vscode-light .storage-path-state.is-ready { background: rgba(22,163,74,0.1); }
        body.vscode-light .storage-path-state.is-missing { background: rgba(220,38,38,0.1); }
        body.vscode-light .stg-header-icon {
            background: color-mix(in srgb, var(--stg-accent, var(--color-border)) 12%, transparent);
        }
        body.vscode-light .storage-stat-val { color: #1d4ed8; }
        body.vscode-light .storage-stat:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }

        /* ─── High Contrast Overrides ──── */
        body.vscode-high-contrast {
            --color-border: rgba(255,255,255,0.25);
        }
    `;
}

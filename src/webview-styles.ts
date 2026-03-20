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
            --color-surface: rgba(255,255,255,0.04);
            --color-border: rgba(255,255,255,0.08);
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
            background: var(--color-info);
            color: #fff;
        }

        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.15);
            border-radius: var(--radius-sm);
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

        /* ─── Header ────────────────── */
        .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-4);
            padding-bottom: var(--space-3);
            border-bottom: 1px solid var(--color-border);
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
                background: rgba(255,255,255,0.08);
                color: var(--color-text);
                border-color: rgba(255,255,255,0.15);
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
                border-color: rgba(255,255,255,0.15);
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

        /* ─── Stat Grid ──────────────── */
        .stat-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--space-2);
            margin-bottom: var(--space-3);
        }

        .stat-grid.three-col { grid-template-columns: 1fr 1fr 1fr; }
        .stat-grid.four-col { grid-template-columns: 1fr 1fr 1fr 1fr; }

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
                background: rgba(255,255,255,0.04);
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
            background: rgba(255,255,255,0.06);
            transition: transform 0.2s cubic-bezier(.4,0,.2,1), background 0.2s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .collapsible summary:hover::before {
                background: rgba(255,255,255,0.12);
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
            background: rgba(255,255,255,0.06);
            transition: transform 0.2s cubic-bezier(.4,0,.2,1), background 0.2s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .session-summary-row:hover::before {
                background: rgba(255,255,255,0.12);
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
            background: rgba(255,255,255,0.05);
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
                background: rgba(255,255,255,0.12);
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
            background: rgba(255,255,255,0.04);
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
            background: rgba(255,255,255,0.04);
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
            border-color: rgba(248,113,113,0.3);
            display: inline-flex;
            align-items: center;
            gap: var(--space-1);
            font-size: 0.82em;
            padding: var(--space-1) var(--space-3);
        }

        @media (hover: hover) {
            .danger-action:hover {
                background: rgba(248,113,113,0.12);
                color: var(--color-danger);
                border-color: var(--color-danger);
            }
        }

        /* ─── Timeline Card ───────────── */
        .timeline-card {
            background: rgba(255,255,255,0.02);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            padding: var(--space-3);
            margin-bottom: var(--space-2);
            transition: border-color 0.2s cubic-bezier(.4,0,.2,1);
        }

        .timeline-card.active-timeline {
            border-color: rgba(96,165,250,0.3);
            background: rgba(96,165,250,0.04);
        }

        @media (hover: hover) {
            .timeline-card:hover {
                border-color: rgba(255,255,255,0.15);
            }
        }

        .timeline-header {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            margin-bottom: var(--space-2);
        }

        .timeline-model {
            font-weight: 600;
            font-size: 0.9em;
        }

        .timeline-meta {
            display: flex;
            gap: var(--space-3);
            font-size: 0.75em;
            color: var(--color-text-dim);
            margin-bottom: var(--space-3);
            flex-wrap: wrap;
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
            background: var(--color-border);
            border-radius: 1px;
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

        .tl-content {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            font-size: 0.82em;
        }

        .tl-pct {
            font-weight: 700;
            min-width: 36px;
        }

        .tl-time {
            color: var(--color-text-dim);
            font-size: 0.9em;
        }

        .tl-elapsed {
            color: var(--color-text-dim);
            font-size: 0.85em;
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
    `;
}

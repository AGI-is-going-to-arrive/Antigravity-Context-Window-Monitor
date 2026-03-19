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

        /* ─── Collapsible Sections ────── */
        .collapsible {
            border-top: 1px solid var(--color-border);
            margin-top: var(--space-2);
        }

        .collapsible summary {
            cursor: pointer;
            font-size: 0.8em;
            font-weight: 600;
            padding: var(--space-2) 0;
            color: var(--color-text-dim);
            list-style: none;
            display: flex;
            align-items: center;
            gap: var(--space-1);
            user-select: none;
        }

        .collapsible summary::-webkit-details-marker { display: none; }

        .collapsible summary::before {
            content: '▸';
            display: inline-block;
            transition: transform 0.2s cubic-bezier(.4,0,.2,1);
        }

        .collapsible[open] summary::before {
            transform: rotate(90deg);
        }

        .collapsible summary:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
            border-radius: var(--radius-sm);
        }

        .details-body {
            padding-bottom: var(--space-2);
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

        /* ─── Inline Details (smaller) ── */
        .inline-details {
            border-top: none;
            margin-top: var(--space-1);
        }

        .inline-details summary {
            font-size: 0.72em;
            padding: var(--space-1) 0;
        }

        /* ─── Session Detail (expanded) ── */
        .session-detail {
            border-top: 1px solid var(--color-border);
            margin-top: 0;
        }

        .session-detail:first-child {
            border-top: none;
        }

        .session-detail summary {
            padding: var(--space-2) 0;
            flex-direction: column;
            align-items: stretch;
            gap: var(--space-1);
        }

        .session-summary-row {
            display: flex;
            align-items: center;
            gap: var(--space-1);
            flex-wrap: wrap;
        }

        .session-title-text {
            font-weight: 500;
            color: var(--color-text);
            flex-shrink: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 50%;
        }

        .session-pct-inline {
            margin-left: auto;
            font-weight: 700;
            font-size: 0.9em;
        }

        .session-bar-wrap.compact {
            height: 3px;
            width: 100%;
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
            .card {
                transition: none;
            }
            .action-btn.spinning svg {
                animation: none;
            }
            .paused-indicator {
                animation: none;
            }
        }
    `;
}

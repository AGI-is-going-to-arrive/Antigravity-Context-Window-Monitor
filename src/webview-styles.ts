// ─── WebView Panel Base Styles ────────────────────────────────────────────────
// Structural layout primitives and shared component geometry for the WebView
// monitor panel. Visual tokens and Studio Telemetry Ledger theming are applied
// authoritatively by `getEditorialStyles()` (loaded last).

export function getStyles(): string {
    return `
        :root {
            /* ─── Geometry & Scale Primitives ─── */
            --radius-sm: 4px;
            --radius-md: 6px;
            --radius-lg: 10px;
            --radius-full: 9999px;

            --space-1: 4px;
            --space-2: 8px;
            --space-3: 12px;
            --space-4: 16px;
            --space-6: 24px;

            --z-tooltip: 150;
            --z-dropdown: 180;
            --z-sticky: 200;
            --z-overlay: 300;
            --z-modal: 400;
            --z-toast: 500;

            --font-mono: var(--vscode-editor-font-family, ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace);
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-size: var(--vscode-font-size, 13px);
            line-height: 1.54;
            -webkit-tap-highlight-color: transparent;
        }

        /* ─── Thin Themed Scrollbar ─── */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb {
            background: var(--ed-border-strong, var(--color-border-strong));
            border-radius: var(--radius-full);
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        @media (hover: hover) {
            ::-webkit-scrollbar-thumb:hover {
                background: var(--ed-ink-muted, var(--color-text-dim));
            }
        }

        /* ─── Scrollbar Hide Mode ─── */
        html[data-hide-scrollbar="true"],
        html[data-hide-scrollbar="true"] body,
        html[data-hide-scrollbar="true"] * {
            scrollbar-width: none !important;
            -ms-overflow-style: none !important;
        }
        html[data-hide-scrollbar="true"]::-webkit-scrollbar,
        html[data-hide-scrollbar="true"] body::-webkit-scrollbar,
        html[data-hide-scrollbar="true"] *::-webkit-scrollbar {
            display: none !important;
            width: 0 !important;
            height: 0 !important;
            background: transparent !important;
        }

        /* ─── Kill Native Number Spinners ─── */
        input[type="number"]::-webkit-inner-spin-button,
        input[type="number"]::-webkit-outer-spin-button {
            -webkit-appearance: none;
            margin: 0;
        }
        input[type="number"] {
            -moz-appearance: textfield;
        }

        /* ─── Icons ─── */
        .icon {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
        }

        .star-inline,
        .heart-inline {
            display: inline-flex;
            vertical-align: middle;
        }
        .star-inline { color: var(--ed-warn); }
        .heart-inline { color: var(--ed-danger); }
        .star-inline .icon,
        .heart-inline .icon {
            width: 12px;
            height: 12px;
        }

        /* ─── Empty State Messages ─── */
        .empty-msg {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            margin: var(--space-3) 0;
            padding: 12px 14px;
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md, 10px);
            font-size: 0.92em;
            color: var(--ed-ink-muted);
            line-height: 1.54;
        }
        .empty-msg::before {
            content: '';
            flex-shrink: 0;
            width: 15px;
            height: 15px;
            color: var(--ed-accent);
            background: currentColor;
            -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' y1='16' x2='12' y2='12'/%3E%3Cline x1='12' y1='8' x2='12.01' y2='8'/%3E%3C/svg%3E") center / contain no-repeat;
            mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' y1='16' x2='12' y2='12'/%3E%3Cline x1='12' y1='8' x2='12.01' y2='8'/%3E%3C/svg%3E") center / contain no-repeat;
        }

        /* ─── End-of-Content Sentinel ─── */
        .eoc-sentinel {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 20px 0 8px;
            margin-top: 16px;
            opacity: 0;
            transition: opacity 260ms cubic-bezier(0.2, 0, 0, 1);
            pointer-events: none;
            user-select: none;
        }
        .eoc-sentinel.eoc-visible { opacity: 1; }
        .eoc-sentinel.eoc-no-transition { transition: none; }
        .eoc-sentinel::before,
        .eoc-sentinel::after {
            content: '';
            flex: 1;
            height: 1px;
            background: var(--ed-border);
        }
        .eoc-sentinel-text {
            font-size: 0.85em;
            color: var(--ed-ink-muted);
            white-space: nowrap;
        }
        body[data-hide-eoc="true"] .eoc-sentinel {
            display: none;
        }

        /* ─── Sticky Masthead & Tab Chrome ─── */
        .panel-topbar {
            position: sticky;
            top: 0;
            z-index: var(--z-sticky);
            background: var(--ed-bg);
            border-bottom: 1px solid var(--ed-border);
            transition: border-color 180ms cubic-bezier(0.2, 0, 0, 1);
        }
        .panel-topbar.scrolled {
            border-bottom-color: var(--ed-border-strong);
        }

        .topbar-title {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 8px 14px;
        }
        .topbar-title-left {
            display: flex;
            flex: 1 1 18rem;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px 12px;
            min-width: 0;
        }
        .topbar-title h1 {
            display: flex;
            align-items: center;
            gap: 7px;
            font-size: 1.15em;
            font-weight: 600;
            letter-spacing: -0.012em;
            line-height: 1.35;
            min-width: 0;
            overflow-wrap: anywhere;
        }
        .topbar-brand-text {
            min-width: 0;
        }

        .header-actions {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px;
            max-width: 100%;
        }

        .update-time {
            color: var(--ed-ink-muted);
            font-size: 0.88em;
            white-space: nowrap;
            font-variant-numeric: tabular-nums lining-nums;
            padding-inline-start: 4px;
        }

        .paused-indicator {
            display: inline-flex;
            align-items: center;
            padding: 1px 6px;
            border-radius: var(--ed-radius-xs, 4px);
            background: var(--ed-accent-tint);
            border: 1px solid var(--ed-accent-border);
            color: var(--ed-accent);
            font-size: 0.86em;
            font-weight: 600;
            margin-inline-end: 6px;
        }

        /* ─── Recessed Segmented Language Switcher ─── */
        .lang-switcher {
            display: inline-flex;
            align-items: center;
            flex-shrink: 0;
            gap: 2px;
            padding: 2px;
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm, 6px);
        }
        .lang-btn {
            appearance: none;
            background: transparent;
            color: var(--ed-ink-muted);
            border: 1px solid transparent;
            border-radius: var(--ed-radius-xs, 4px);
            padding: 3px 9px;
            font-size: 11.5px;
            font-weight: 500;
            font-family: inherit;
            line-height: 1.35;
            white-space: nowrap;
            cursor: pointer;
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1),
                        color 150ms cubic-bezier(0.2, 0, 0, 1),
                        border-color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .lang-btn.active {
            background: var(--ed-surface);
            color: var(--ed-ink);
            font-weight: 600;
            border-color: var(--ed-border);
            box-shadow: var(--ed-shadow-segment);
        }
        .lang-btn:active { transform: scale(0.98); }

        /* ─── Action & Toolbar Buttons ─── */
        .action-btn {
            appearance: none;
            height: 32px;
            padding: 0 12px;
            background: var(--ed-surface);
            color: var(--ed-ink);
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm, 6px);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            column-gap: 0;
            font-family: inherit;
            font-size: 12.5px;
            font-weight: 550;
            line-height: 1;
            white-space: nowrap;
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1),
                        color 150ms cubic-bezier(0.2, 0, 0, 1),
                        border-color 150ms cubic-bezier(0.2, 0, 0, 1),
                        transform 100ms cubic-bezier(0.2, 0, 0, 1);
        }
        .action-btn svg {
            width: 14px;
            height: 14px;
            fill: currentColor;
            flex-shrink: 0;
        }
        .action-btn > svg:first-child:not(:last-child) { margin-inline-end: 6px; }
        .action-btn > svg:last-child:not(:first-child) { margin-inline-start: 6px; }
        .action-btn:active:not(:disabled) { transform: scale(0.98); }
        .action-btn:disabled {
            cursor: not-allowed;
            opacity: 0.45;
        }

        .danger-action {
            background: transparent;
            color: var(--ed-danger);
            border: 1px solid var(--ed-danger-border);
            display: inline-flex;
            align-items: center;
            column-gap: 0;
            height: 32px;
            padding: 0 12px;
            border-radius: var(--ed-radius-sm, 6px);
            font-size: 12.5px;
            font-weight: 550;
        }
        .danger-action > svg:first-child:not(:last-child) { margin-inline-end: 6px; }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        .action-btn.spinning svg {
            animation: spin 550ms cubic-bezier(0.2, 0, 0, 1);
        }

        /* ─── Tab Bar ─── */
        .tab-bar-wrapper {
            display: flex;
            align-items: center;
            gap: 4px;
            position: relative;
        }
        .tab-arrow {
            appearance: none;
            background: transparent;
            border: 1px solid transparent;
            border-radius: var(--ed-radius-sm, 6px);
            color: var(--ed-ink-muted);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            flex-shrink: 0;
            padding: 0;
            transition: color 150ms cubic-bezier(0.2, 0, 0, 1),
                        background 150ms cubic-bezier(0.2, 0, 0, 1),
                        opacity 180ms cubic-bezier(0.2, 0, 0, 1);
            z-index: 2;
        }
        .tab-arrow.is-faded {
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
        }
        .tab-arrow:active { transform: scale(0.95); }

        .tab-bar {
            display: flex;
            align-items: center;
            gap: 2px;
            padding: 0;
            background: transparent;
            border-radius: 0;
            box-shadow: none;
            position: relative;
            overflow-x: auto;
            overflow-y: hidden;
            scrollbar-width: none;
            -ms-overflow-style: none;
            flex: 1;
            min-width: 0;
        }
        .tab-bar::-webkit-scrollbar { display: none; }

        .tab-slider {
            position: absolute;
            top: auto;
            bottom: 0;
            height: 2px;
            border-radius: 2px 2px 0 0;
            background: var(--ed-accent);
            transition: left 200ms cubic-bezier(0.2, 0, 0, 1),
                        width 200ms cubic-bezier(0.2, 0, 0, 1);
            pointer-events: none;
            z-index: 2;
        }

        .tab-btn {
            appearance: none;
            background: transparent;
            border: none;
            color: var(--ed-ink-muted);
            font-family: inherit;
            font-size: 12.5px;
            font-weight: 500;
            padding: 9px 11px 10px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            border-radius: 6px 6px 0 0;
            white-space: nowrap;
            position: relative;
            z-index: 1;
            transition: color 150ms cubic-bezier(0.2, 0, 0, 1),
                        background 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .tab-btn .icon { display: none; }
        .tab-btn.active {
            color: var(--ed-ink);
            font-weight: 600;
        }
        .tab-btn:active { transform: scale(0.98); }

        .tab-pane { display: none; }
        .tab-pane.active {
            display: block;
            animation: edTabIn 140ms cubic-bezier(0.2, 0, 0, 1);
        }
        @keyframes edTabIn {
            from { opacity: 0.78; }
            to { opacity: 1; }
        }

        .tab-scroll-hint {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 6px 10px;
            border-top: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
            font-size: 12px;
            line-height: 1.45;
        }
        .tab-scroll-hint[hidden] { display: none; }
        .tab-scroll-hint-text {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
        }
        .tab-scroll-hint .icon {
            width: 13px;
            height: 13px;
            color: var(--ed-accent);
        }
        .tab-scroll-hint-close {
            appearance: none;
            border: none;
            background: transparent;
            color: var(--ed-ink-muted);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 22px;
            height: 22px;
            border-radius: var(--ed-radius-xs, 4px);
            cursor: pointer;
            flex-shrink: 0;
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1),
                        color 150ms cubic-bezier(0.2, 0, 0, 1);
        }

        /* ─── Account Popover (L3 Floating Overlay) ─── */
        .acct-popover-anchor { position: relative; }
        .acct-popover-trigger {
            position: relative;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 28px;
            padding: 0 10px 0 8px;
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-pill, 9999px);
            background: var(--ed-surface);
            color: var(--ed-ink);
            font-family: inherit;
            font-size: 12px;
            font-weight: 550;
            cursor: pointer;
            white-space: nowrap;
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1),
                        border-color 150ms cubic-bezier(0.2, 0, 0, 1),
                        color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .acct-popover-trigger svg {
            flex-shrink: 0;
            color: var(--ed-ink-muted);
            transition: color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .acct-popover-trigger.is-open {
            background: var(--ed-accent-tint);
            border-color: var(--ed-accent-border);
            color: var(--ed-accent);
        }
        .acct-popover-trigger.is-open svg { color: var(--ed-accent); }
        .acct-popover-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--ed-good);
            flex-shrink: 0;
        }

        .acct-popover-dropdown {
            position: absolute;
            top: calc(100% + 6px);
            inset-inline: var(--ed-gutter);
            max-width: var(--ed-column);
            margin-inline: auto;
            z-index: 800;
            max-height: 70vh;
            overflow-y: auto;
            overscroll-behavior: contain;
            border: 1px solid var(--ed-border-strong);
            border-radius: var(--ed-radius-lg, 12px);
            background: var(--ed-surface-overlay);
            box-shadow: var(--ed-shadow-popover);
            transform-origin: top center;
            transform: translateY(-4px);
            opacity: 0;
            transition: transform 180ms cubic-bezier(0.2, 0, 0, 1),
                        opacity 150ms cubic-bezier(0.2, 0, 0, 1);
            pointer-events: none;
        }
        .acct-popover-dropdown.is-visible {
            transform: translateY(0);
            opacity: 1;
            pointer-events: auto;
        }
        .acct-popover-body { padding: 10px; }
        .acct-popover-body .acct-panel { margin-bottom: 0; }
        .acct-popover-body .acct-card { gap: 8px; padding: 10px 12px; }
        .acct-popover-body .acct-identity { flex: 1 1 140px; min-width: 140px; }
        .acct-popover-body .acct-pools { flex: 0 1 auto; min-width: 0; }
        .acct-popover-body .acct-pool-model { max-width: 180px; }

        /* ─── Cards & Sections (L1 Surface Grammar) ─── */
        .card {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md, 10px);
            padding: 16px 18px;
            margin-bottom: 16px;
        }
        .card h2 {
            font-size: 0.9375rem;
            font-weight: 600;
            letter-spacing: -0.012em;
            line-height: 1.35;
            color: var(--ed-ink);
            margin-bottom: 12px;
            display: flex;
            align-items: baseline;
            flex-wrap: wrap;
            column-gap: 0;
            row-gap: 4px;
        }
        .card h2 > :is(.icon, .act-icon, svg) {
            align-self: center;
            margin-inline-end: 8px;
        }
        .card.empty {
            text-align: center;
            padding: 28px 20px;
            color: var(--ed-ink-muted);
        }
        .card.empty h2 { justify-content: center; }
        .empty-desc {
            font-size: 0.94em;
            color: var(--ed-ink-muted);
            margin-top: 8px;
            line-height: 1.54;
        }
        .card-header-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px 12px;
            margin-bottom: 12px;
        }
        .card-header-row h2 { margin: 0; }

        /* ─── Generic Badges ─── */
        .badge {
            display: inline-flex;
            align-items: center;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: var(--ed-radius-pill);
            font-weight: 600;
            line-height: 1.4;
            border: 1px solid var(--ed-border);
        }
        .warn-badge {
            background: var(--ed-warn-tint);
            color: var(--ed-warn);
            border-color: var(--ed-warn-border);
        }
        .ok-badge {
            background: var(--ed-good-tint);
            color: var(--ed-good);
            border-color: var(--ed-good-border);
        }
        .danger-badge {
            background: var(--ed-danger-tint);
            color: var(--ed-danger);
            border-color: var(--ed-danger-border);
        }
        .info-badge {
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border-color: var(--ed-accent-border);
        }
        .pool-badge {
            background: var(--ed-surface-well);
            color: var(--ed-ink-muted);
            border-color: var(--ed-border);
            font-weight: 500;
            margin-inline-start: 4px;
        }

        /* ─── Shared Collapsible Disclosure (<details>) ─── */
        .collapsible {
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm, 6px);
            margin-top: 8px;
            background: var(--ed-surface-well);
            overflow: hidden;
            transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .collapsible summary {
            cursor: pointer;
            font-size: 12.5px;
            font-weight: 550;
            padding: 9px 10px;
            color: var(--ed-ink);
            list-style: none;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            column-gap: 0;
            row-gap: 2px;
            user-select: none;
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .collapsible summary::-webkit-details-marker { display: none; }
        .collapsible summary::before {
            content: '';
            display: inline-block;
            flex-shrink: 0;
            width: 6px;
            height: 6px;
            border-right: 1.6px solid var(--ed-ink-muted);
            border-bottom: 1.6px solid var(--ed-ink-muted);
            transform: rotate(-45deg);
            margin-inline-end: 9px;
            transition: transform 160ms cubic-bezier(0.2, 0, 0, 1),
                        border-color 160ms cubic-bezier(0.2, 0, 0, 1);
        }
        .collapsible[open] > summary::before {
            transform: rotate(45deg);
            border-color: var(--ed-accent);
        }
        .details-body {
            padding: 10px 12px 12px;
            border-top: 1px solid var(--ed-border);
        }
        .inline-details {
            margin-top: 6px;
            background: var(--ed-surface-well);
        }
        .inline-details summary {
            font-size: 12px;
            padding: 7px 10px;
        }

        .detail-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            font-size: 12.5px;
            padding: 3px 0;
            color: var(--ed-ink-muted);
        }
        .detail-row span:last-child {
            font-weight: 600;
            color: var(--ed-ink);
            font-variant-numeric: tabular-nums lining-nums;
        }

        .mime-tags-wrap {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }
        .mime-tag {
            font-size: 11px;
            font-family: var(--ed-mono);
            padding: 2px 6px;
            border-radius: var(--ed-radius-xs, 4px);
            background: var(--ed-surface);
            color: var(--ed-ink-secondary);
            border: 1px solid var(--ed-border);
        }

        /* ─── Default Model & Technical Specs (Models Tab) ─── */
        .default-model {
            font-size: 0.94em;
            color: var(--ed-ink-secondary);
            display: flex;
            align-items: baseline;
            flex-wrap: wrap;
            column-gap: 0;
            row-gap: 6px;
        }
        .default-model strong {
            font-weight: 600;
            padding: 2px 9px;
            margin-inline-start: 8px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-accent-tint);
            border: 1px solid var(--ed-accent-border);
            color: var(--ed-accent);
            font-size: 0.94em;
            overflow-wrap: anywhere;
        }

        .model-info-section h2 {
            display: flex;
            align-items: baseline;
            flex-wrap: wrap;
            column-gap: 0;
            row-gap: 4px;
        }
        .spec-description {
            margin: 0 0 14px;
            color: var(--ed-ink-secondary);
            font-size: 0.94em;
            line-height: 1.54;
            max-width: 72ch;
        }
        .spec-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
            gap: 14px;
        }
        .spec-card {
            display: flex;
            flex-direction: column;
            min-width: 0;
            padding: 16px 18px;
            color: var(--ed-ink);
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md, 10px);
            overflow-wrap: anywhere;
            transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .spec-header { margin-bottom: 12px; }
        .spec-name {
            margin: 0;
            font-size: 0.875rem;
            font-weight: 600;
            line-height: 1.38;
            letter-spacing: -0.008em;
            color: var(--ed-ink);
        }
        .spec-provider {
            margin-top: 3px;
            font-size: 12px;
            line-height: 1.4;
            color: var(--ed-ink-muted);
        }
        .spec-metrics {
            display: grid;
            gap: 7px;
            margin-top: auto;
            font-size: 12.5px;
            line-height: 1.45;
        }
        .spec-metric {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 4px 12px;
            min-width: 0;
        }
        .spec-metric dt {
            flex: 1 1 110px;
            color: var(--ed-ink-muted);
        }
        .spec-metric dd {
            margin: 0;
            min-width: 0;
            max-width: 100%;
            font-weight: 550;
            color: var(--ed-ink);
            font-variant-numeric: tabular-nums lining-nums;
        }
        .spec-limit {
            padding-bottom: 8px;
            border-bottom: 1px solid var(--ed-border);
        }
        .spec-limit dd {
            font-weight: 650;
            font-size: 1.04em;
        }
        .spec-thinking dd { font-size: 12px; }
        .spec-orchestration {
            margin-top: 12px;
            padding: 10px 12px;
            border-radius: var(--ed-radius-sm, 6px);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            font-size: 12px;
            line-height: 1.5;
            color: var(--ed-ink-secondary);
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .spec-orchestration strong { color: var(--ed-ink); }
        .spec-orchestration code {
            font-family: var(--ed-mono);
            font-size: 11.5px;
            color: var(--ed-ink);
        }
        .spec-identity {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 4px 8px;
            margin-top: 12px;
            padding-top: 10px;
            border-top: 1px solid var(--ed-border);
            line-height: 1.45;
        }
        .spec-identity code {
            min-width: 0;
            font-family: var(--ed-mono);
            font-size: 11.5px;
            color: var(--ed-ink-muted);
            overflow-wrap: anywhere;
        }
        .spec-short-id {
            flex-shrink: 0;
            padding: 1px 6px;
            border-radius: var(--ed-radius-xs, 4px);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            color: var(--ed-ink-secondary);
        }

        /* ─── Shared Model Quota Grid & Capsule Meters ─── */
        .model-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
            gap: 14px;
        }
        .model-card {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md, 10px);
            padding: 16px 18px;
            min-width: 0;
            transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .model-card-header {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            flex-wrap: wrap;
            gap: 6px 12px;
            margin-bottom: 8px;
            min-width: 0;
        }
        .model-card-name {
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--ed-ink);
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
            min-width: 0;
            flex: 1;
        }
        .model-card-name-text {
            min-width: 0;
            overflow-wrap: anywhere;
            word-break: break-word;
        }
        .model-card-pct {
            font-size: 0.9375rem;
            font-weight: 650;
            color: var(--ed-ink);
            flex-shrink: 0;
            font-variant-numeric: tabular-nums lining-nums;
            overflow-wrap: anywhere;
        }
        .model-card-pct.is-unknown {
            color: var(--ed-ink-muted);
            font-weight: 500;
            font-size: 0.875rem;
        }
        .model-tag-badge {
            font-size: 11px;
            padding: 1px 7px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border: 1px solid var(--ed-accent-border);
            font-weight: 600;
            line-height: 1.45;
            flex-shrink: 0;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .model-card-efforts {
            margin-bottom: 8px;
            color: var(--ed-ink-muted);
            font-size: 12px;
            overflow-wrap: anywhere;
        }
        .model-quota-members {
            list-style: none;
            padding: 0;
            margin: 0 0 10px;
        }
        .model-quota-members li {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: baseline;
            gap: 4px 10px;
            padding: 3px 0;
            font-size: 12.5px;
            color: var(--ed-ink-secondary);
            overflow-wrap: anywhere;
        }
        .model-quota-members .model-card-efforts {
            font-size: 11.5px;
            margin: 0;
            color: var(--ed-ink-muted);
        }
        .quota-bar-wrap {
            height: 6px;
            background: var(--ed-track);
            border-radius: var(--ed-radius-pill);
            overflow: hidden;
            margin: 8px 0 6px;
        }
        .quota-bar-wrap.is-unknown {
            background: var(--ed-track);
            opacity: 0.72;
        }
        .quota-bar {
            height: 100%;
            border-radius: var(--ed-radius-pill);
            transition: width 260ms cubic-bezier(0.2, 0, 0, 1);
            background: var(--ed-accent);
        }
        .quota-bar.is-healthy { background: var(--ed-good-fill); }
        .quota-bar.is-warn { background: var(--ed-warn-fill); }
        .quota-bar.is-attention { background: var(--ed-danger-fill); }

        .model-card-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 4px;
        }
        .model-card-reset {
            font-size: 12px;
            color: var(--ed-ink-muted);
            font-variant-numeric: tabular-nums lining-nums;
            overflow-wrap: anywhere;
        }
        .model-quota-notice {
            margin: 8px 0 4px;
            font-size: 12px;
            color: var(--ed-warn);
        }
        .model-quota-details {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid var(--ed-border);
            font-size: 12px;
        }
        .model-quota-details summary {
            cursor: pointer;
            color: var(--ed-ink-secondary);
            font-weight: 550;
            list-style: none;
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            column-gap: 0;
            padding: 3px 6px;
            margin-inline-start: -6px;
            border-radius: var(--ed-radius-sm, 6px);
        }
        .model-quota-details summary::-webkit-details-marker { display: none; }
        .model-quota-details summary::before {
            content: '';
            display: inline-block;
            width: 5px;
            height: 5px;
            border-right: 1.5px solid var(--ed-ink-muted);
            border-bottom: 1.5px solid var(--ed-ink-muted);
            transform: rotate(-45deg);
            margin-inline-end: 7px;
            transition: transform 160ms cubic-bezier(0.2, 0, 0, 1);
        }
        .model-quota-details[open] > summary::before {
            transform: rotate(45deg);
            border-color: var(--ed-accent);
        }
        .model-quota-details ul {
            list-style: none;
            margin: 8px 0 0;
            padding: 0;
        }
        .model-quota-details li {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 2px 12px;
            padding: 5px 0;
            border-top: 1px solid var(--ed-border);
            font-variant-numeric: tabular-nums lining-nums;
            overflow-wrap: anywhere;
        }
        .model-quota-details li > span:nth-child(2) {
            text-align: right;
            font-weight: 600;
            color: var(--ed-ink);
        }
        .model-quota-reading-reset {
            grid-column: 1 / -1;
            color: var(--ed-ink-muted);
            font-size: 11.5px;
        }

        /* ─── Profile Tab (Complete Modern Contract) ─── */
        .profile-page {
            display: flex;
            flex-direction: column;
            gap: 20px;
            padding-top: 6px;
        }
        .profile-identity {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 12px 16px;
            padding: 18px 20px;
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md, 10px);
        }
        .profile-identity > div { min-width: 0; }
        .profile-identity h2 {
            margin: 0 0 6px;
            color: var(--ed-ink);
        }
        .account-info {
            display: flex;
            align-items: baseline;
            flex-wrap: wrap;
            gap: 4px 10px;
            margin-bottom: 8px;
        }
        .account-name {
            font-weight: 600;
            font-size: 0.875rem;
            color: var(--ed-ink);
            overflow-wrap: anywhere;
        }
        .account-email {
            font-family: var(--ed-mono);
            font-size: 12px;
            color: var(--ed-ink-muted);
            overflow-wrap: anywhere;
        }
        .profile-plan-name {
            display: inline-flex;
            align-items: center;
            padding: 2px 9px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border: 1px solid var(--ed-accent-border);
            font-size: 11.5px;
            font-weight: 600;
            line-height: 1.45;
        }
        .privacy-btn {
            appearance: none;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 30px;
            padding: 0 11px;
            border-radius: var(--ed-radius-sm, 6px);
            border: 1px solid var(--ed-control-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
            font-family: inherit;
            font-size: 12px;
            font-weight: 550;
            cursor: pointer;
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1),
                        border-color 150ms cubic-bezier(0.2, 0, 0, 1),
                        color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .privacy-btn.active,
        .privacy-btn[aria-pressed="true"] {
            background: var(--ed-good-tint);
            border-color: var(--ed-good-border);
            color: var(--ed-good);
        }
        .privacy-btn:active { transform: scale(0.98); }

        .profile-body-grid {
            display: grid;
            grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
            gap: 16px;
            align-items: start;
        }
        .profile-quota,
        .profile-ai {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md, 10px);
            padding: 18px 20px;
            min-width: 0;
        }
        .profile-section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px 12px;
            margin-bottom: 14px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--ed-border);
        }
        .profile-section-header h2 {
            font-size: 0.9375rem;
            font-weight: 600;
            letter-spacing: -0.012em;
            color: var(--ed-ink);
            margin: 0;
        }
        .profile-activity {
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            column-gap: 0;
            row-gap: 2px;
            font-size: 12px;
            font-weight: 550;
            color: var(--ed-accent);
            text-decoration: none;
            padding: 4px 8px;
            border-radius: var(--ed-radius-sm, 6px);
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .profile-activity > svg { margin-inline-start: 5px; flex-shrink: 0; }
        .profile-credit-balances {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 12px 14px;
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: 8px;
            margin: 0 0 16px;
        }
        .profile-credit-balance {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .profile-credit-balance + .profile-credit-balance {
            padding-top: 10px;
            border-top: 1px solid var(--ed-border);
        }
        .profile-credit-balance dt {
            font-size: 12px;
            font-weight: 500;
            color: var(--ed-ink-muted);
        }
        .profile-credit-balance dd.gai-value {
            margin: 0;
            font-size: 1.375rem;
            font-weight: 650;
            letter-spacing: -0.02em;
            line-height: 1.2;
            color: var(--ed-ink);
            font-variant-numeric: tabular-nums lining-nums;
        }
        .profile-credit-balance dd.gai-value.is-unreported {
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--ed-ink-muted);
            letter-spacing: 0;
        }
        .billing-day-label {
            display: block;
            font-size: 12.5px;
            font-weight: 600;
            color: var(--ed-ink);
            margin-bottom: 8px;
        }
        .billing-day-input-group {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
        }
        .billing-day-input-group .threshold-input {
            width: 56px;
            text-align: center;
        }
        .profile-expiry {
            margin-top: 10px;
            font-size: 12px;
            line-height: 1.5;
            color: var(--ed-ink-muted);
        }

        .profile-technical {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md, 10px);
            overflow: hidden;
        }
        .profile-technical > summary {
            list-style: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            column-gap: 0;
            row-gap: 2px;
            padding: 13px 18px;
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--ed-ink);
            user-select: none;
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .profile-technical > summary::-webkit-details-marker { display: none; }
        .profile-technical > summary::before {
            content: '';
            display: inline-block;
            flex-shrink: 0;
            width: 6px;
            height: 6px;
            border-right: 1.6px solid var(--ed-ink-muted);
            border-bottom: 1.6px solid var(--ed-ink-muted);
            transform: rotate(-45deg);
            margin-inline-end: 10px;
            transition: transform 160ms cubic-bezier(0.2, 0, 0, 1),
                        border-color 160ms cubic-bezier(0.2, 0, 0, 1);
        }
        .profile-technical[open] > summary::before {
            transform: rotate(45deg);
            border-color: var(--ed-accent);
        }
        .profile-technical-body {
            padding: 16px 20px 18px;
            border-top: 1px solid var(--ed-border);
            display: flex;
            flex-direction: column;
            gap: 18px;
        }
        .profile-tech-section {
            min-width: 0;
        }
        .profile-sub-heading {
            display: flex;
            align-items: baseline;
            flex-wrap: wrap;
            column-gap: 0;
            row-gap: 2px;
            font-size: 0.875rem;
            font-weight: 600;
            letter-spacing: -0.008em;
            line-height: 1.38;
            color: var(--ed-ink);
            margin: 0 0 10px;
        }
        .profile-sub-heading > :is(.icon, svg) {
            color: var(--ed-accent);
            width: 14px;
            height: 14px;
            align-self: center;
            margin-inline-end: 7px;
            flex-shrink: 0;
        }
        .profile-two-col {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
            gap: 18px;
        }
        .profile-panel-card { min-width: 0; }
        .profile-metric-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr));
            gap: 10px;
        }
        .profile-metric-card {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 10px 12px;
            border-radius: 8px;
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            min-width: 0;
        }
        .profile-metric-label {
            font-size: 11.5px;
            font-weight: 500;
            color: var(--ed-ink-muted);
        }
        .profile-metric-value {
            font-size: 0.9375rem;
            font-weight: 650;
            color: var(--ed-ink);
            line-height: 1.35;
            font-variant-numeric: tabular-nums lining-nums;
            overflow-wrap: anywhere;
        }
        .profile-chip-grid,
        .feature-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .feature-tag {
            display: inline-flex;
            align-items: center;
            font-size: 11.5px;
            font-weight: 550;
            padding: 3px 9px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface-well);
            color: var(--ed-ink-muted);
            border: 1px solid var(--ed-border);
            line-height: 1.4;
        }
        .feature-tag.enabled {
            background: var(--ed-good-tint);
            color: var(--ed-good);
            border-color: var(--ed-good-border);
        }

        /* ─── Settings Tab Controls & Cards ─── */
        .stg-card {
            background: var(--ed-surface);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md, 10px);
            padding: 18px 20px;
            margin-bottom: 16px;
            min-width: 0;
        }
        .stg-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 12px;
        }
        .stg-header-icon {
            width: 28px;
            height: 28px;
            border-radius: var(--ed-radius-sm, 6px);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            color: var(--ed-accent);
            display: inline-flex;
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
            font-size: 0.9375rem;
            font-weight: 600;
            letter-spacing: -0.012em;
            color: var(--ed-ink);
            margin: 0;
        }
        .raw-desc {
            font-size: 0.94em;
            color: var(--ed-ink-secondary);
            margin-bottom: 12px;
            line-height: 1.54;
            max-width: 72ch;
        }
        .setting-row label {
            font-size: 12.5px;
            font-weight: 600;
            color: var(--ed-ink);
            display: block;
            margin-bottom: 6px;
        }
        .stg-select-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px 12px;
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--ed-border);
            font-size: 12.5px;
            font-weight: 550;
            color: var(--ed-ink);
        }
        .stg-select-row select {
            appearance: none;
            -webkit-appearance: none;
            height: 32px;
            padding: 0 30px 0 10px;
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm, 6px);
            background-color: var(--ed-surface-well);
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='%238C98A9' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 10px center;
            color: var(--ed-ink);
            max-width: 100%;
            font-family: inherit;
            font-size: 12.5px;
            font-weight: 500;
            cursor: pointer;
            transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1),
                        background-color 150ms cubic-bezier(0.2, 0, 0, 1);
        }

        .threshold-input-row {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 4px;
        }
        .threshold-input {
            appearance: none;
            -moz-appearance: textfield;
            height: 32px;
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm, 6px);
            color: var(--ed-ink);
            font-family: var(--ed-mono);
            font-size: 12.5px;
            font-variant-numeric: tabular-nums lining-nums;
            padding: 0 10px;
            width: 110px;
            transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .num-spinner {
            display: inline-flex;
            align-items: center;
            height: 32px;
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm, 6px);
            overflow: hidden;
            background: var(--ed-surface);
            transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .num-spinner:focus-within {
            border-color: var(--ed-accent);
        }
        .num-spinner .threshold-input {
            border: none;
            border-radius: 0;
            background: transparent;
            height: 30px;
            width: 68px;
            padding: 0 6px;
            text-align: center;
        }
        .num-spinner .threshold-input:focus-visible {
            outline: none;
        }
        .num-spinner-btn {
            appearance: none;
            border: none;
            background: var(--ed-surface-well);
            color: var(--ed-ink);
            font-size: 14px;
            font-weight: 600;
            width: 30px;
            height: 30px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            user-select: none;
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1),
                        color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .num-spinner-btn.decrement { border-right: 1px solid var(--ed-border); }
        .num-spinner-btn.increment { border-left: 1px solid var(--ed-border); }
        .num-spinner-btn:active { transform: scale(0.96); }

        .threshold-presets,
        .zoom-presets {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }
        .preset-btn {
            appearance: none;
            height: 28px;
            padding: 0 10px;
            background: var(--ed-surface);
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm, 6px);
            color: var(--ed-ink-secondary);
            font-size: 12px;
            font-weight: 550;
            font-family: inherit;
            font-variant-numeric: tabular-nums lining-nums;
            cursor: pointer;
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1),
                        color 150ms cubic-bezier(0.2, 0, 0, 1),
                        border-color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .preset-btn:active { transform: scale(0.98); }
        .zoom-preset.is-active,
        .preset-btn.active {
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border-color: var(--ed-accent-border);
            font-weight: 600;
        }

        .threshold-feedback {
            font-size: 12px;
            color: var(--ed-good);
            font-weight: 600;
            opacity: 0;
            transition: opacity 220ms cubic-bezier(0.2, 0, 0, 1);
        }

        /* ─── Zoom Control ─── */
        .zoom-control {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .zoom-slider-row {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .zoom-range {
            -webkit-appearance: none;
            appearance: none;
            flex: 1;
            min-width: 0;
            height: 4px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-track);
            outline: none;
        }
        .zoom-range::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 15px;
            height: 15px;
            border-radius: 50%;
            background: var(--ed-accent);
            border: 2px solid var(--ed-surface);
            cursor: pointer;
            transition: transform 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .zoom-value {
            font-family: var(--ed-mono);
            font-size: 12.5px;
            font-weight: 650;
            color: var(--ed-accent);
            min-width: 3.5em;
            text-align: right;
            font-variant-numeric: tabular-nums lining-nums;
        }

        /* ─── Toggle Switches (34×18 Studio Cobalt) ─── */
        .toggle-group {
            display: flex;
            flex-direction: column;
        }
        .toggle-row {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 6px;
            margin-inline: -6px;
            border-bottom: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm, 6px);
            cursor: pointer;
            font-size: 0.94em;
            color: var(--ed-ink);
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .toggle-row:last-child { border-bottom: none; }
        .toggle-cb {
            opacity: 0;
            position: absolute;
            width: 0;
            height: 0;
        }
        .toggle-track {
            position: relative;
            width: 34px;
            height: 18px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-track);
            border: 1px solid var(--ed-control-border);
            flex-shrink: 0;
            transition: background 180ms cubic-bezier(0.2, 0, 0, 1),
                        border-color 180ms cubic-bezier(0.2, 0, 0, 1);
        }
        .toggle-thumb {
            position: absolute;
            top: 2px;
            left: 2px;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: var(--ed-ink-muted);
            transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1),
                        background 180ms cubic-bezier(0.2, 0, 0, 1);
        }
        .toggle-cb:checked + .toggle-track {
            background: var(--ed-accent-track);
            border-color: transparent;
        }
        .toggle-cb:checked + .toggle-track .toggle-thumb {
            transform: translateX(16px);
            background: #FFFFFF;
        }
        .toggle-cb:focus-visible + .toggle-track {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }
        .toggle-row code {
            font-family: var(--ed-mono);
            font-size: 11.5px;
            padding: 1px 6px;
            margin-inline-start: 4px;
            border-radius: var(--ed-radius-xs, 4px);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            color: var(--ed-ink-secondary);
        }

        /* ─── Storage Diagnostics (Settings) ─── */
        .storage-path-box {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            margin-bottom: 12px;
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm, 6px);
            min-width: 0;
        }
        .storage-path-text {
            flex: 1;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-family: var(--ed-mono);
            font-size: 12px;
            color: var(--ed-ink);
        }
        .storage-path-state {
            flex-shrink: 0;
            padding: 2px 8px;
            border-radius: var(--ed-radius-pill);
            font-size: 11px;
            font-weight: 600;
            line-height: 1.45;
            border: 1px solid var(--ed-border);
        }
        .storage-path-state.is-ready {
            background: var(--ed-surface);
            color: var(--ed-good);
            border-color: var(--ed-good-border);
        }
        .storage-path-state.is-missing {
            background: var(--ed-surface);
            color: var(--ed-danger);
            border-color: var(--ed-danger-border);
        }
        .storage-actions {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            margin-bottom: 14px;
        }
        .storage-stat-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 130px), 1fr));
            gap: 10px;
        }
        .storage-stat {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 3px;
            padding: 10px 12px;
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: 8px;
            min-width: 0;
        }
        .storage-stat-val {
            font-size: 1.125rem;
            font-weight: 650;
            color: var(--ed-ink);
            font-variant-numeric: tabular-nums lining-nums;
        }
        .storage-stat-label {
            font-size: 11.5px;
            font-weight: 500;
            color: var(--ed-ink-muted);
        }

        /* ─── Raw JSON & Copy Button ─── */
        .raw-json {
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm, 6px);
            padding: 12px;
            font-family: var(--ed-mono);
            font-size: 11.5px;
            line-height: 1.48;
            overflow-x: auto;
            max-height: 460px;
            overflow-y: auto;
            white-space: pre;
            color: var(--ed-ink-secondary);
            tab-size: 2;
        }
        .raw-json code { font-family: inherit; }

        .copy-btn {
            appearance: none;
            height: 26px;
            padding: 0 9px;
            background: var(--ed-surface);
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm, 6px);
            color: var(--ed-ink-secondary);
            font-size: 11.5px;
            font-weight: 550;
            font-family: inherit;
            margin-left: auto;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1),
                        color 150ms cubic-bezier(0.2, 0, 0, 1),
                        border-color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .copy-btn.copied {
            color: var(--ed-good);
            border-color: var(--ed-good-border);
            background: var(--ed-good-tint);
        }

        /* ─── Sessions Tab (ses-* namespace) ─── */
        .ses-shortcuts {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
            margin-bottom: 14px;
        }
        .ses-shortcut {
            appearance: none;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md, 10px);
            background: var(--ed-surface);
            color: var(--ed-ink);
            font-family: inherit;
            font-size: 12.5px;
            font-weight: 550;
            cursor: pointer;
            min-width: 0;
            text-align: start;
            transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1),
                        background 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .ses-shortcut-icon {
            display: inline-flex;
            color: var(--ed-accent);
            flex-shrink: 0;
        }
        .ses-shortcut-icon svg { width: 14px; height: 14px; }
        .ses-shortcut-title {
            flex: 1;
            min-width: 0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ses-shortcut-count {
            min-width: 22px;
            padding: 1px 7px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            color: var(--ed-ink);
            font-size: 11.5px;
            font-weight: 650;
            text-align: center;
            line-height: 1.5;
            flex-shrink: 0;
            font-variant-numeric: tabular-nums lining-nums;
        }
        .ses-shortcut.is-disabled {
            cursor: not-allowed;
            opacity: 0.45;
        }
        .ses-shortcut:active:not(.is-disabled) { transform: scale(0.99); }

        .ses-toolbar {
            display: flex;
            gap: 10px;
            align-items: center;
            margin-bottom: 14px;
            flex-wrap: wrap;
        }
        .ses-search-wrap {
            flex: 1 1 220px;
            min-width: 0;
            height: 32px;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 0 10px;
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm, 6px);
            background: var(--ed-surface-well);
            color: var(--ed-ink-muted);
            transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .ses-search-wrap svg {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
            color: var(--ed-ink-muted);
        }
        .ses-search-wrap:focus-within {
            border-color: var(--ed-accent);
            outline: 2px solid var(--ed-accent);
            outline-offset: 1px;
        }
        .ses-search-input {
            appearance: none;
            flex: 1;
            border: none;
            background: transparent;
            color: var(--ed-ink);
            font-family: inherit;
            font-size: 12.5px;
            height: 100%;
            outline: none;
            min-width: 0;
        }
        .ses-filters {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
        }
        .ses-filter-btn {
            appearance: none;
            height: 30px;
            padding: 0 10px;
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-pill);
            background: var(--ed-surface);
            color: var(--ed-ink-muted);
            font-family: inherit;
            font-size: 12px;
            font-weight: 550;
            cursor: pointer;
            transition: color 150ms cubic-bezier(0.2, 0, 0, 1),
                        border-color 150ms cubic-bezier(0.2, 0, 0, 1),
                        background 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .ses-filter-btn.is-active {
            color: var(--ed-accent);
            border-color: var(--ed-accent-border);
            background: var(--ed-accent-tint);
            font-weight: 600;
        }
        .ses-filter-btn:active { transform: scale(0.98); }

        .ses-groups {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .ses-group {
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md, 10px);
            background: var(--ed-surface);
            overflow: hidden;
            margin-top: 0;
        }
        .ses-group > summary {
            display: flex;
            align-items: center;
            flex-wrap: nowrap;
            gap: 10px;
            padding: 12px 14px;
            background: var(--ed-surface);
        }
        .ses-group > summary::before {
            margin-inline-end: 0;
        }
        .ses-group-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px 12px;
            flex: 1;
            min-width: 0;
        }
        .ses-group-labels {
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
            min-width: 0;
        }
        .ses-group-title {
            color: var(--ed-ink);
            font-size: 0.875rem;
            font-weight: 600;
            line-height: 1.35;
        }
        .ses-group-path {
            color: var(--ed-ink-muted);
            font-family: var(--ed-mono);
            font-size: 11.5px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            max-width: 100%;
        }
        .ses-group-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            flex-shrink: 0;
        }
        .ses-group-chip {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: var(--ed-radius-pill);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-muted);
            font-size: 11px;
            font-weight: 600;
            white-space: nowrap;
        }
        .ses-group-chip.is-ws {
            color: var(--ed-accent);
            border-color: var(--ed-accent-border);
            background: var(--ed-accent-tint);
        }
        .ses-group-chip.is-run {
            color: var(--ed-warn);
            border-color: var(--ed-warn-border);
            background: var(--ed-warn-tint);
        }
        .ses-group-body {
            display: flex;
            flex-direction: column;
            padding: 0;
            border-top: none;
        }

        .ses-row {
            padding: 12px 14px;
            border-top: 1px solid var(--ed-border);
            background: transparent;
            transition: background 150ms cubic-bezier(0.2, 0, 0, 1);
            position: relative;
        }
        .ses-row.is-current {
            background: var(--ed-good-tint);
        }
        .ses-row-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8px 12px;
        }
        .ses-row-title {
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--ed-ink);
            line-height: 1.42;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            word-break: break-word;
            min-width: 0;
            flex: 1;
        }
        .ses-row-badges {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            flex-shrink: 0;
            max-width: 100%;
        }
        .ses-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: var(--ed-radius-pill);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-muted);
            font-size: 11px;
            font-weight: 600;
            text-transform: none;
            white-space: nowrap;
            max-width: 100%;
            line-height: 1.4;
        }
        .ses-badge.is-current {
            color: var(--ed-good);
            border-color: var(--ed-good-border);
            background: var(--ed-good-tint);
        }
        .ses-badge.is-workspace {
            color: var(--ed-accent);
            border-color: var(--ed-accent-border);
            background: var(--ed-accent-tint);
        }
        .ses-badge.is-running {
            color: var(--ed-warn);
            border-color: var(--ed-warn-border);
            background: var(--ed-warn-tint);
        }
        .ses-badge.is-finished,
        .ses-badge.is-idle {
            color: var(--ed-ink-muted);
        }

        /* Prevent stacked semi-transparent tints inside the active emerald-tinted session row */
        .ses-row.is-current :is(.ses-badge, .ses-chip, .ses-storage-tag) {
            background: var(--ed-surface);
        }
        .ses-row.is-current .ses-row-ctx {
            color: var(--ed-ink-secondary);
        }

        .ses-row-ctx {
            margin-top: 4px;
            font-size: 12px;
            color: var(--ed-ink-muted);
            line-height: 1.45;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .ses-ctx-sep { margin: 0 4px; }
        .ses-ctx-branch svg {
            width: 11px;
            height: 11px;
            vertical-align: -1px;
        }
        .ses-row-metrics {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 6px 10px;
            margin-top: 8px;
        }
        .ses-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
        }
        .ses-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: var(--ed-radius-pill);
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
            font-size: 11.5px;
            font-weight: 500;
            white-space: nowrap;
            font-variant-numeric: tabular-nums lining-nums;
        }
        .ses-chip svg { width: 11px; height: 11px; color: var(--ed-ink-muted); }
        .ses-chip-time { color: var(--ed-ink-muted); }

        .ses-storage {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            flex-shrink: 0;
            max-width: 100%;
        }
        .ses-storage-tag {
            padding: 1px 6px;
            border-radius: var(--ed-radius-xs, 4px);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            color: var(--ed-ink-muted);
            font-size: 11px;
            font-weight: 600;
            line-height: 1.5;
        }
        .ses-row-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid var(--ed-border);
        }
        .ses-act-btn {
            appearance: none;
            width: 28px;
            height: 28px;
            padding: 0;
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm, 6px);
            background: var(--ed-surface);
            color: var(--ed-ink-secondary);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            transition: border-color 150ms cubic-bezier(0.2, 0, 0, 1),
                        background 150ms cubic-bezier(0.2, 0, 0, 1),
                        color 150ms cubic-bezier(0.2, 0, 0, 1);
        }
        .ses-act-btn svg { width: 13px; height: 13px; }
        .ses-act-accent {
            color: var(--ed-accent);
            border-color: var(--ed-accent-border);
        }
        .ses-act-btn:active:not(:disabled) { transform: scale(0.96); }
        .ses-act-btn:disabled { cursor: not-allowed; opacity: 0.4; }

        /* ─── CSS Tooltip (L3 Floating Overlay) ─── */
        [data-tooltip] { position: relative; }
        [data-tooltip]::after {
            content: attr(data-tooltip);
            position: absolute;
            bottom: calc(100% + 6px);
            left: 50%;
            transform: translateX(-50%) translateY(2px);
            padding: 4px 9px;
            border-radius: var(--ed-radius-sm, 6px);
            background: var(--ed-surface-overlay);
            color: var(--ed-ink);
            border: 1px solid var(--ed-border-strong);
            font-size: 11.5px;
            font-weight: 500;
            line-height: 1.35;
            white-space: nowrap;
            pointer-events: none;
            opacity: 0;
            transition: opacity 130ms cubic-bezier(0.2, 0, 0, 1),
                        transform 130ms cubic-bezier(0.2, 0, 0, 1);
            z-index: var(--z-tooltip);
            box-shadow: var(--ed-shadow-tooltip);
        }
        [data-tooltip]:hover::after,
        [data-tooltip]:focus-visible::after {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
        [data-tooltip]:not(:hover, :focus-visible)::after,
        [data-tooltip]:disabled::after { display: none; }

        @media (max-width: 640px) {
            .ses-shortcuts { grid-template-columns: minmax(0, 1fr); }
            .ses-toolbar { flex-direction: column; align-items: stretch; }
            .ses-search-wrap { flex: 1 1 auto; }
            .ses-group-head { flex-direction: column; align-items: flex-start; gap: 6px; }
            .ses-row-head { flex-direction: column; }
            .ses-row-badges { justify-content: flex-start; }
        }
    `;
}

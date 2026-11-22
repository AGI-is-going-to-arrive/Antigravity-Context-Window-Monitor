/**
 * Antigravity App Sidecar theme adapter & responsive layout stylesheet.
 *
 * Maps Antigravity App host CSS variables (pushed via `theme-change` postMessage
 * by `/preload.js`) onto all `--vscode-*` custom properties consumed by
 * `webview-styles.ts` and `webview-editorial-styles.ts`, adds `data-acm-theme`
 * selectors (`light` | `dark` | `hc`), and refines layouts for narrow
 * `AUX_PANE` (300px–500px) and wide `SIDEBAR` (900px–1440px) entrypoints.
 *
 * Pure Node/TypeScript — zero `vscode` imports.
 */

/** Returns the complete CSS stylesheet (without `<style>` tags). */
export function getThemeAdapterStyles(): string {
    return `
        /* ═══ Antigravity App Host Token → VS Code CSS Variable Bridge ═══ */
        :root,
        body[data-acm-surface="app-sidecar"] {
            --vscode-editor-background: var(--background, #0D1014);
            --vscode-editorWidget-background: var(--card, var(--popover, var(--background, #14181F)));
            --vscode-foreground: var(--foreground, #F2F4F8);
            --vscode-descriptionForeground: var(--muted-foreground, #8C98A9);
            --vscode-widget-border: var(--border, #232A35);
            --vscode-contrastBorder: var(--border, transparent);
            --vscode-focusBorder: var(--ring, var(--primary, #5B9CF6));
            --vscode-textLink-foreground: var(--primary, #5B9CF6);
            --vscode-progressBar-background: var(--primary, #5B9CF6);
            --vscode-list-hoverBackground: var(--accent, rgba(255, 255, 255, 0.06));
            --vscode-toolbar-hoverBackground: var(--accent, rgba(255, 255, 255, 0.08));
            --vscode-errorForeground: var(--destructive, #F87171);
            --vscode-editorError-foreground: var(--destructive, #F87171);
            --vscode-editorWarning-foreground: var(--warning, #F5B841);
            --vscode-scrollbarSlider-background: var(--border, rgba(140, 152, 169, 0.32));
            --vscode-font-size: 13px;
            --vscode-editor-font-family: var(--font-mono, ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, monospace);
        }

        /* ═══ App Sidecar Theme Polarity (Light / Dark / High-Contrast) ═══ */
        body[data-acm-theme="dark"] {
            --ed-bg: var(--background, #0D1014);
            --ed-surface: var(--card, #14181F);
            --ed-surface-well: var(--secondary, #1B212B);
            --ed-surface-hover: var(--accent, #222A36);
            --ed-surface-overlay: var(--popover, #181E27);
            --ed-border: var(--border, #232A35);
            --ed-ink: var(--foreground, #F2F4F8);
            --ed-ink-muted: var(--muted-foreground, #8C98A9);
            --ed-accent: var(--primary, #5B9CF6);
            --ed-danger: var(--destructive, #F87171);
            color-scheme: dark;
        }

        body[data-acm-theme="light"] {
            --ed-bg: var(--background, #FAFBFC);
            --ed-surface: var(--card, #FFFFFF);
            --ed-surface-well: var(--secondary, #F2F4F8);
            --ed-surface-hover: var(--accent, #E9EEF5);
            --ed-surface-overlay: var(--popover, #FFFFFF);
            --ed-input-bg: var(--card, #FFFFFF);
            --ed-track: #E2E7EF;
            --ed-border: var(--border, #E4E8EF);
            --ed-border-strong: #C8D0DC;
            --ed-control-border: #8792A4;
            --ed-ink: var(--foreground, #111318);
            --ed-ink-secondary: #454D5B;
            --ed-ink-muted: var(--muted-foreground, #5A6475);
            --ed-accent: var(--primary, #1D4ED8);
            --ed-accent-hover: #1E40AF;
            --ed-accent-track: var(--primary, #1D4ED8);
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
            --ed-danger: var(--destructive, #C02430);
            --ed-danger-fill: #D02B37;
            --ed-danger-tint: rgba(220, 38, 38, 0.10);
            --ed-danger-border: rgba(192, 36, 48, 0.30);
            color-scheme: light;
        }

        body[data-acm-theme="hc"],
        body[data-acm-theme="hc-light"] {
            --ed-bg: var(--background, Canvas);
            --ed-surface: var(--background, Canvas);
            --ed-surface-well: var(--background, Canvas);
            --ed-surface-hover: var(--accent, Canvas);
            --ed-surface-overlay: var(--background, Canvas);
            --ed-border: var(--border, CanvasText);
            --ed-border-strong: var(--border, CanvasText);
            --ed-control-border: var(--border, CanvasText);
            --ed-ink: var(--foreground, CanvasText);
            --ed-ink-secondary: var(--foreground, CanvasText);
            --ed-ink-muted: var(--foreground, CanvasText);
            --ed-accent: var(--primary, LinkText);
            --ed-danger: var(--destructive, CanvasText);
            --ed-shadow-popover: none;
            --ed-shadow-tooltip: none;
            --ed-shadow-segment: none;
        }
        body[data-acm-theme="hc-light"] {
            color-scheme: light;
        }

        @media (prefers-color-scheme: light) {
            body[data-acm-surface="app-sidecar"]:not([data-acm-theme="dark"]):not([data-acm-theme="hc"]):not([data-acm-theme="hc-light"]):not(.vscode-dark) {
                --ed-bg: var(--background, #FAFBFC);
                --ed-surface: var(--card, #FFFFFF);
                --ed-ink: var(--foreground, #111318);
                --ed-border: var(--border, #E4E8EF);
                color-scheme: light;
            }
        }

        /* ═══ Responsive Refinements: Narrow AUX_PANE (300px–500px) ═══ */
        body[data-acm-view="aux"] {
            --ed-gutter: 12px;
            --ed-column: 100%;
            overflow-x: hidden;
        }

        body[data-acm-view="aux"] .panel-topbar {
            padding-inline: 0;
        }

        @media (max-width: 520px) {
            body[data-acm-surface="app-sidecar"] {
                --ed-gutter: 10px;
                overflow-x: hidden;
            }
            body[data-acm-surface="app-sidecar"] .topbar-title {
                flex-wrap: wrap;
                gap: 8px;
                padding: 10px var(--ed-gutter) 6px;
            }
            body[data-acm-surface="app-sidecar"] .topbar-title h1 {
                font-size: 0.95rem;
            }
            body[data-acm-surface="app-sidecar"] .header-actions {
                width: 100%;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 6px;
            }
            body[data-acm-surface="app-sidecar"] .tab-btn {
                padding: 6px 9px;
                font-size: 11.5px;
                gap: 4px;
            }
            body[data-acm-surface="app-sidecar"] .tab-pane {
                padding-inline: var(--ed-gutter);
            }
            body[data-acm-surface="app-sidecar"] :is(
                .overview-grid,
                .overview-kpi-grid,
                .act-cards-grid,
                .models-grid,
                .profile-grid,
                .acm-breakdown-grid,
                .acm-runway-grid
            ) {
                grid-template-columns: 1fr !important;
            }
            body[data-acm-surface="app-sidecar"] .update-time {
                font-size: 11px;
            }
            body[data-acm-surface="app-sidecar"] .acct-popover-dropdown {
                left: 8px;
                right: 8px;
                width: auto;
                max-width: calc(100vw - 16px);
            }
        }

        body[data-acm-view="aux"] .topbar-title {
            padding-inline: 12px;
        }

        body[data-acm-view="aux"] .tab-pane {
            max-width: 100%;
        }

        /* ═══ Responsive Refinements: Wide SIDEBAR Full-Pane (900px–1440px) ═══ */
        body[data-acm-view="sidebar"] {
            --ed-column: 1200px;
            --ed-gutter: clamp(20px, 3vw, 36px);
        }

        @media (min-width: 900px) {
            body[data-acm-view="sidebar"] #monitor-content,
            body[data-acm-view="sidebar"] .topbar-title,
            body[data-acm-view="sidebar"] .masthead-context-bar,
            body[data-acm-view="sidebar"] .tab-bar-wrapper {
                max-width: var(--ed-column);
                margin-inline: auto;
                width: 100%;
                box-sizing: border-box;
            }
            body[data-acm-view="sidebar"] :is(.overview-kpi-grid, .acm-runway-grid) {
                grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            }
            body[data-acm-view="sidebar"] :is(.act-cards-grid, .models-grid) {
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            }
        }
    `;
}

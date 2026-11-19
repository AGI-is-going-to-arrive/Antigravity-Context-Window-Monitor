// ─── Calendar Tab Content Builder ────────────────────────────────────────────
// Renders the Calendar tab: month navigation, 7×6 calendar grid with data
// indicators, and expandable daily detail panels.

import { tBi } from './i18n';
import { DailyStore, DailyRecord, MonthCellSummary } from './daily-store';
import { ICON } from './webview-icons';
import { esc, tBiHtml } from './webview-helpers';
import { normalizeModelDisplayName } from './models';
import { formatCachePercent, formatLatency, formatSpeed } from './telemetry-metrics';

// ─── SVG Icons ───────────────────────────────────────────────────────────────

const CALENDAR_ICON = '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/></svg>';

const CHEVRON_LEFT = '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"/></svg>';
const CHEVRON_RIGHT = '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/></svg>';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTH_NAMES_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_HEADERS_ZH = ['一', '二', '三', '四', '五', '六', '日'];
const DAY_HEADERS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatTokensK(n: number): string {
    if (n >= 1_000_000) { return (n / 1_000_000).toFixed(1) + 'M'; }
    if (n >= 1_000) { return (n / 1_000).toFixed(1) + 'k'; }
    return String(n);
}

function formatCost(usd: number): string {
    if (usd >= 1) { return '$' + usd.toFixed(2); }
    if (usd > 0) { return '$' + usd.toFixed(4); }
    return '—';
}

// ── Shared SVG icons for model/GM chip rows ──
const CAL_ICON = {
    calls: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1zm4.168 4.413a.5.5 0 0 1 .497.034l3.5 2.5a.5.5 0 0 1 0 .806l-3.5 2.5A.5.5 0 0 1 6.5 10.5v-5a.5.5 0 0 1 .168-.087"/></svg>',
    credit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path fill="currentColor" d="M4 5.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8m0 2.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5"/></svg>',
    speed: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M5.52.359A.5.5 0 0 1 6 0h4a.5.5 0 0 1 .474.658L8.694 6H12.5a.5.5 0 0 1 .395.807l-7 9a.5.5 0 0 1-.873-.454L6.823 9H3.5a.5.5 0 0 1-.48-.641z"/></svg>',
    clock: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 7.71z"/><path fill="currentColor" d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/></svg>',
    cache: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm15 2h-4v3h4zm0 4h-4v3h4zm0 4h-4v3h3a1 1 0 0 0 1-1zm-5 3v-3H6v3zm-5 0v-3H1v2a1 1 0 0 0 1 1zm-4-4h4V8H1zm0-4h4V4H1zm5-3v3h4V4zm4 4H6v3h4z"/></svg>',
    dollar: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4 10.781c.148 1.667 1.513 2.85 3.591 3.003V15h1.043v-1.216c2.27-.179 3.678-1.438 3.678-3.3 0-1.59-.947-2.51-2.956-3.028l-.722-.187V3.467c1.122.11 1.879.714 2.07 1.616h1.47c-.166-1.6-1.54-2.748-3.54-2.875V1H7.591v1.233c-1.939.23-3.27 1.472-3.27 3.156 0 1.454.966 2.483 2.661 2.917l.61.162v4.031c-1.149-.17-1.94-.8-2.131-1.718zm3.391-3.836c-1.043-.263-1.6-.825-1.6-1.616 0-.944.704-1.641 1.8-1.828v3.495zM8.634 8.1C9.858 8.418 10.44 9 10.44 9.89c0 1.12-.789 1.816-2.007 1.931V8.1z"/></svg>',
} as const;
const fmtTok = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
const fmtCostShort = (n: number) => n >= 1 ? '$' + n.toFixed(2) : n > 0 ? '$' + n.toFixed(4) : '';

/** Get days in month and what weekday the 1st falls on (0=Mon) */
function getMonthGrid(year: number, month: number): { daysInMonth: number; startDay: number } {
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const startDay = firstDay === 0 ? 6 : firstDay - 1; // Convert to 0=Mon
    return { daysInMonth, startDay };
}

function isToday(dateStr: string): boolean {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return dateStr === `${y}-${m}-${d}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Build the complete Calendar tab HTML. */
export function buildCalendarTabContent(store?: DailyStore, year?: number, month?: number): string {
    if (!store) {
        return `
            <section class="card empty">
                <h2>${CALENDAR_ICON} <span>${tBiHtml('Calendar', '日历')}</span></h2>
                <p class="empty-desc">${tBiHtml(
            'Calendar data is not initialized yet.',
            '日历数据尚未初始化。',
        )}</p>
            </section>`;
    }

    const now = new Date();
    const currentYear = year ?? now.getFullYear();
    const currentMonth = month ?? (now.getMonth() + 1);

    const parts: string[] = [];

    // ── Stats Summary (top position for quick overview) ──
    if (store.totalDays > 0) {
        const allTimeSummary = buildOverallSummaryGrid(store);
        const monthlySummary = buildMonthlySummaryGrid(store, currentYear, currentMonth);
        parts.push(`
            <section class="card cal-summary-card">
                <div class="cal-summary-header">
                    <h2>${ICON.chart} <span>${tBiHtml('Usage Summary', '用量汇总')}</span></h2>
                    <div class="cal-summary-toggle" id="calSummaryToggle" role="group" aria-label="${esc(tBi('Usage summary range', '用量汇总范围'))}">
                        <button type="button" class="cal-summary-btn active" data-summary-mode="monthly"><span>${tBiHtml('Monthly', '月度')}</span></button>
                        <button type="button" class="cal-summary-btn" data-summary-mode="alltime"><span>${tBiHtml('All-Time', '全部')}</span></button>
                    </div>
                </div>
                <div class="cal-summary-pane" id="calSummaryMonthly" style="display:block">
                    ${monthlySummary}
                </div>
                <div class="cal-summary-pane" id="calSummaryAllTime" style="display:none">
                    ${allTimeSummary}
                </div>
            </section>`);
    }

    // ── Month Navigation + Grid ──
    parts.push(buildMonthView(store, currentYear, currentMonth));

    // ── Clear Button ──
    if (store.totalDays > 0) {
        parts.push(`
            <div class="cal-clear-section">
                <button type="button" class="cal-clear-btn" id="clearCalendarBtn">
                    ${ICON.trash} <span>${tBiHtml('Clear All Calendar History', '清空所有日历历史')}</span>
                </button>
            </div>`);
    }

    return parts.join('');
}

/** Return calendar-specific CSS strictly using --ed-* Studio Telemetry Ledger tokens. */
export function getCalendarTabStyles(): string {
    return `
        /* ─── Calendar Tab (Studio Telemetry Ledger) ─────────────── */
        .cal-summary-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px 12px;
            margin-bottom: 14px;
        }

        .cal-summary-header h2 {
            margin: 0;
            min-width: 0;
        }

        .cal-summary-toggle {
            display: inline-flex;
            align-items: center;
            gap: 2px;
            padding: 2px;
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            flex-shrink: 0;
            max-width: 100%;
        }

        .cal-summary-btn {
            appearance: none;
            background: transparent;
            color: var(--ed-ink-muted);
            border: 1px solid transparent;
            border-radius: var(--ed-radius-xs);
            padding: 4px 10px;
            font: inherit;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            min-width: 0;
            transition: background var(--ed-dur-fast) var(--ed-ease),
                color var(--ed-dur-fast) var(--ed-ease),
                border-color var(--ed-dur-fast) var(--ed-ease),
                transform 100ms var(--ed-ease);
        }

        .cal-summary-btn.active {
            background: var(--ed-surface);
            color: var(--ed-ink);
            font-weight: 600;
            border-color: var(--ed-border);
            box-shadow: var(--ed-shadow-segment);
        }

        .cal-summary-btn:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        .cal-summary-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .cal-summary-btn:not(.active):hover {
                background: var(--ed-surface-hover);
                color: var(--ed-ink);
            }
        }

        .cal-summary-pane {
            min-width: 0;
        }

        .cal-summary-empty {
            color: var(--ed-ink-muted);
            font-size: 0.88em;
            text-align: center;
            padding: 12px 4px;
            margin: 0;
        }

        /* ── Overall / Monthly KPI Band ─── */
        .cal-overview-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 96px), 1fr));
            gap: 1px;
            background: var(--ed-border);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            overflow: hidden;
        }

        .cal-overview-item {
            text-align: center;
            padding: 10px 8px;
            background: var(--ed-surface);
            min-width: 0;
        }

        .cal-overview-val {
            font-weight: 650;
            font-size: 1.08em;
            line-height: 1.25;
            color: var(--ed-ink);
            font-variant-numeric: tabular-nums lining-nums;
        }

        .cal-overview-label {
            font-size: 11.5px;
            font-weight: 500;
            color: var(--ed-ink-muted);
            margin-top: 3px;
            line-height: 1.35;
            overflow-wrap: anywhere;
        }

        /* ── Month Navigation ─── */
        .cal-nav {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            margin-bottom: 12px;
        }

        .cal-nav-btn {
            appearance: none;
            width: 28px;
            height: 28px;
            padding: 0;
            background: var(--ed-surface);
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm);
            color: var(--ed-ink);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: background var(--ed-dur-fast) var(--ed-ease),
                border-color var(--ed-dur-fast) var(--ed-ease),
                color var(--ed-dur-fast) var(--ed-ease),
                transform 100ms var(--ed-ease);
        }

        .cal-nav-btn:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        .cal-nav-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .cal-nav-btn:hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-ink-muted);
                color: var(--ed-ink);
            }
        }

        .cal-month-label {
            font-weight: 600;
            font-size: 0.95em;
            min-width: 116px;
            text-align: center;
            color: var(--ed-ink);
            font-variant-numeric: tabular-nums lining-nums;
        }

        /* ── 7-Column Calendar Grid ─── */
        .cal-grid {
            display: grid;
            grid-template-columns: repeat(7, minmax(0, 1fr));
            gap: 4px;
            margin-bottom: 14px;
        }

        .cal-header-cell {
            text-align: center;
            font-size: 11.5px;
            font-weight: 500;
            color: var(--ed-ink-muted);
            padding: 4px 2px 6px;
            border-bottom: 1px solid var(--ed-border);
            min-width: 0;
            overflow-wrap: anywhere;
        }

        .cal-cell {
            position: relative;
            min-width: 0;
            min-height: 36px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 3px;
            padding: 4px 2px;
            border-radius: var(--ed-radius-sm);
            font: inherit;
            font-size: 12.5px;
            font-variant-numeric: tabular-nums lining-nums;
            color: var(--ed-ink-muted);
            background: transparent;
            border: 1.5px solid transparent;
            cursor: default;
            transition: background var(--ed-dur-fast) var(--ed-ease),
                border-color var(--ed-dur-fast) var(--ed-ease),
                color var(--ed-dur-fast) var(--ed-ease),
                transform 100ms var(--ed-ease);
        }

        .cal-day-num {
            line-height: 1.1;
        }

        .cal-cell.has-data {
            cursor: pointer;
            color: var(--ed-ink);
            font-weight: 550;
            background: var(--ed-surface-well);
            border-color: var(--ed-border);
        }

        .cal-cell.has-data:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        .cal-cell.has-data:active { transform: scale(0.98); }

        @media (hover: hover) {
            .cal-cell.has-data:hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-accent-border);
            }
        }

        .cal-cell.today {
            border-color: var(--ed-accent);
            font-weight: 700;
            color: var(--ed-ink);
        }

        .cal-cell.selected {
            background: var(--ed-accent-tint);
            border-color: var(--ed-accent);
            color: var(--ed-ink);
        }

        .cal-cell.empty-cell {
            border-color: transparent;
            background: transparent;
            pointer-events: none;
        }

        /* Edge-clamped hover tooltips */
        .cal-cell[data-tooltip]:not(:hover, :focus-visible)::after {
            display: none;
        }

        .cal-cell:nth-child(7n+1)[data-tooltip]::after {
            left: 0;
            right: auto;
            transform: none;
        }

        .cal-cell:nth-child(7n)[data-tooltip]::after {
            left: auto;
            right: 0;
            transform: none;
        }

        .cal-dot {
            display: block;
            width: 5px;
            height: 5px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-accent);
            flex-shrink: 0;
        }

        .cal-dot.high-activity {
            width: 6px;
            height: 6px;
            background: var(--ed-good-fill);
        }

        /* ── Day Detail Drawer ─── */
        .cal-detail {
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md);
            background: var(--ed-surface);
            padding: 16px 18px;
            margin-top: 12px;
            min-width: 0;
        }

        .cal-detail-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px;
            padding-bottom: 10px;
            margin-bottom: 12px;
            border-bottom: 1px solid var(--ed-border);
        }

        .cal-detail-date {
            font-weight: 600;
            font-size: 0.95em;
            color: var(--ed-ink);
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            font-variant-numeric: tabular-nums lining-nums;
        }

        .cal-detail-date .icon {
            width: 14px;
            height: 14px;
            color: var(--ed-accent);
            flex-shrink: 0;
        }

        .cal-today-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: var(--ed-radius-pill);
            font-size: 11px;
            font-weight: 600;
            line-height: 1.4;
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border: 1px solid var(--ed-accent-border);
        }

        /* ── Day Summary Bar ─── */
        .cal-day-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 96px), 1fr));
            gap: 1px;
            background: var(--ed-border);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            overflow: hidden;
            margin-bottom: 12px;
        }

        .cal-day-total {
            text-align: center;
            padding: 10px 8px;
            background: var(--ed-surface-well);
            min-width: 0;
        }

        .cal-day-total-val {
            font-weight: 650;
            font-size: 1.05em;
            line-height: 1.25;
            color: var(--ed-ink);
            font-variant-numeric: tabular-nums lining-nums;
        }

        .cal-day-total-label {
            font-size: 11.5px;
            font-weight: 500;
            color: var(--ed-ink-muted);
            margin-top: 2px;
            line-height: 1.35;
        }

        .cal-day-total-danger {
            color: var(--ed-danger);
        }

        /* ── Per-Model Breakdown & Semantic Chips ─── */
        .cal-model-rows {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--ed-border);
        }

        .cal-gm-section-label {
            font-size: 12px;
            font-weight: 600;
            color: var(--ed-ink-secondary);
            margin-bottom: 8px;
        }

        .cal-model-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px 12px;
            padding: 8px 4px;
            font-size: 12.5px;
            flex-wrap: wrap;
            min-width: 0;
        }

        .cal-model-row + .cal-model-row {
            border-top: 1px solid var(--ed-border);
        }

        .cal-model-name {
            font-weight: 600;
            color: var(--ed-ink);
            flex: 0 1 16em;
            min-width: 0;
            overflow-wrap: anywhere;
            word-break: break-word;
        }

        .cal-model-chips {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            min-width: 0;
        }

        .cal-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: var(--ed-radius-xs);
            font-size: 11.5px;
            font-weight: 550;
            line-height: 1.45;
            font-variant-numeric: tabular-nums lining-nums;
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
            max-width: 100%;
            white-space: nowrap;
        }

        .cal-chip svg {
            width: 11px;
            height: 11px;
            flex-shrink: 0;
        }

        .cal-chip-tools {
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border-color: var(--ed-accent-border);
        }

        .cal-chip-tokens {
            background: var(--ed-good-tint);
            color: var(--ed-good);
            border-color: var(--ed-good-border);
        }

        .cal-chip-cost,
        .cal-chip-est {
            background: var(--ed-warn-tint);
            color: var(--ed-warn);
            border-color: var(--ed-warn-border);
        }

        .cal-chip-errors {
            background: var(--ed-danger-tint);
            color: var(--ed-danger);
            border-color: var(--ed-danger-border);
        }

        .cal-chip-reasoning {
            background: var(--ed-surface-well);
            color: var(--ed-chart-thinking);
            border-color: var(--ed-border-strong);
        }

        .cal-chip-speed {
            background: var(--ed-surface-well);
            color: var(--ed-accent);
            border-color: var(--ed-accent-border);
        }

        .cal-chip-cache {
            background: var(--ed-surface-well);
            color: var(--ed-chart-cache);
            border-color: var(--ed-border-strong);
        }

        .cal-chip-ttft {
            background: var(--ed-surface-well);
            color: var(--ed-ink-muted);
            border-color: var(--ed-border);
        }

        .cal-model-chip {
            font-size: 11.5px;
            font-weight: 550;
            padding: 2px 8px;
            border-radius: var(--ed-radius-xs);
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border: 1px solid var(--ed-accent-border);
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .cal-account-tag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            font-weight: 600;
            padding: 2px 8px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border: 1px solid var(--ed-accent-border);
            margin-inline-start: 4px;
            vertical-align: middle;
        }

        /* ── Collapsible Archived Cycles ─── */
        .cal-cycles-details {
            margin-top: 10px;
        }

        .cal-cycles-summary {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            font-size: 12.5px;
            font-weight: 550;
            color: var(--ed-ink);
            padding: 8px 10px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            list-style: none;
            transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease);
        }

        .cal-cycles-summary::-webkit-details-marker { display: none; }

        .cal-cycles-summary::before {
            content: '';
            width: 6px;
            height: 6px;
            border-right: 1.5px solid var(--ed-ink-muted);
            border-bottom: 1.5px solid var(--ed-ink-muted);
            transform: rotate(-45deg);
            transition: transform 160ms var(--ed-ease);
            flex-shrink: 0;
        }

        .cal-cycles-details[open] > .cal-cycles-summary::before {
            transform: rotate(45deg);
        }

        @media (hover: hover) {
            .cal-cycles-summary:hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-border-strong);
            }
        }

        .cal-cycles-summary:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        /* ── Clear History Action (Quiet Destructive Outline) ─── */
        .cal-clear-section {
            margin-top: 20px;
            text-align: center;
        }

        .cal-clear-btn {
            appearance: none;
            height: 32px;
            padding: 0 14px;
            background: transparent;
            border: 1px solid var(--ed-danger-border);
            border-radius: var(--ed-radius-sm);
            color: var(--ed-danger);
            cursor: pointer;
            font: inherit;
            font-size: 12.5px;
            font-weight: 550;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            max-width: 100%;
            transition: background var(--ed-dur-fast) var(--ed-ease),
                border-color var(--ed-dur-fast) var(--ed-ease),
                transform 100ms var(--ed-ease);
        }

        .cal-clear-btn .icon {
            width: 13px;
            height: 13px;
            flex-shrink: 0;
        }

        .cal-clear-btn:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        .cal-clear-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .cal-clear-btn:hover {
                background: var(--ed-danger-tint);
                border-color: var(--ed-danger);
            }
        }

        /* ── Narrow Viewport Safeguards (320px zero-overflow) ─── */
        @media (max-width: 440px) {
            .cal-grid {
                gap: 3px;
            }
            .cal-header-cell {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 1px;
                line-height: 1.2;
                font-size: 11px;
                padding: 4px 1px 6px;
            }
            .cal-header-cell .bi-sep {
                display: none;
            }
            .cal-cell {
                min-height: 34px;
                font-size: 12px;
                padding: 3px 1px;
            }
            .cal-detail {
                padding: 12px;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .cal-summary-btn,
            .cal-nav-btn,
            .cal-cell,
            .cal-cycles-summary,
            .cal-cycles-summary::before,
            .cal-clear-btn {
                transition: none;
            }
        }
    `;
}

// ─── Builders ────────────────────────────────────────────────────────────────

function buildMonthView(store: DailyStore, year: number, month: number): string {
    const { daysInMonth, startDay } = getMonthGrid(year, month);
    const monthData = new Map<number, MonthCellSummary>();
    for (const cell of store.getMonthSummary(year, month)) {
        const day = parseInt(cell.date.split('-')[2], 10);
        monthData.set(day, cell);
    }

    const monthLabel = tBiHtml(
        `${MONTH_NAMES_EN[month - 1]} ${year}`,
        `${year}年${MONTH_NAMES_ZH[month - 1]}`,
    );

    // Header cells (EN: Mon–Sun, ZH: 一–日, Both: Mon / 一 with vertical stack at ≤440px)
    const headerCells = DAY_HEADERS_EN
        .map((enDay, idx) => `<div class="cal-header-cell">${tBiHtml(enDay, DAY_HEADERS_ZH[idx])}</div>`)
        .join('');

    // Day cells
    const cells: string[] = [];
    // Empty cells before month starts
    for (let i = 0; i < startDay; i++) {
        cells.push('<div class="cal-cell empty-cell" aria-hidden="true"></div>');
    }
    // Actual days
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cellData = monthData.get(day);
        const todayClass = isToday(dateStr) ? ' today' : '';
        const hasData = cellData !== undefined;

        if (hasData) {
            const highActivity = (cellData.gmCalls || 0) > 20 || cellData.totalCost > 0.5;
            cells.push(`
                <button type="button" class="cal-cell has-data${todayClass}" data-cal-date="${dateStr}" data-tooltip="${esc(tBi('has data', '有数据'))}">
                    <span class="cal-day-num">${day}</span>
                    <span class="cal-dot${highActivity ? ' high-activity' : ''}" aria-hidden="true"></span>
                </button>`);
        } else {
            cells.push(`<div class="cal-cell${todayClass}"><span class="cal-day-num">${day}</span></div>`);
        }
    }

    // ── Build day detail panels (hidden by default, shown via JS) ──
    const detailPanels: string[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const record = store.getRecord(dateStr);
        if (record) {
            detailPanels.push(buildDayDetail(record, dateStr));
        }
    }

    // Previous/Next month calculation
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    return `
        <section class="card">
            <h2>${CALENDAR_ICON} <span>${tBiHtml('Calendar', '日历')}</span></h2>
            <div class="cal-nav">
                <button type="button" class="cal-nav-btn" aria-label="${esc(tBi('Previous month', '上个月'))}" data-cal-nav="prev" data-cal-year="${prevYear}" data-cal-month="${prevMonth}">
                    ${CHEVRON_LEFT}
                </button>
                <span class="cal-month-label">${monthLabel}</span>
                <button type="button" class="cal-nav-btn" aria-label="${esc(tBi('Next month', '下个月'))}" data-cal-nav="next" data-cal-year="${nextYear}" data-cal-month="${nextMonth}">
                    ${CHEVRON_RIGHT}
                </button>
            </div>
            <div class="cal-grid">
                ${headerCells}
                ${cells.join('')}
            </div>
            ${detailPanels.join('')}
        </section>`;
}

interface MergedCalendarGMModel {
    calls: number;
    credits: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    ttftSum: number;
    ttftWeight: number;
    speedOutputSum: number;
    speedTimeSum: number;
    speedFallbackSum: number;
    speedFallbackWeight: number;
    tokenCacheSum: number;
    tokenCacheWeight: number;
    legacyCacheSum: number;
    legacyCacheWeight: number;
    cost: number;
}

function buildDayDetail(record: DailyRecord, dateStr: string): string {
    // ── Aggregate totals across all cycles ──
    let totalCost = 0, totalGMCalls = 0, totalGMCredits = 0;

    // ── Aggregate per-model GM stats across cycles ──
    const mergedGM: Record<string, MergedCalendarGMModel> = {};

    for (const c of record.cycles) {
        totalCost += c.estimatedCost || 0;
        totalGMCalls += c.gmTotalCalls || 0;
        totalGMCredits += c.gmTotalCredits || 0;

        if (c.gmModelStats) {
            for (const [rawName, gm] of Object.entries(c.gmModelStats)) {
                const name = normalizeModelDisplayName(rawName) || rawName;
                const g = mergedGM[name] || (mergedGM[name] = {
                    calls: 0, credits: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
                    ttftSum: 0, ttftWeight: 0,
                    speedOutputSum: 0, speedTimeSum: 0, speedFallbackSum: 0, speedFallbackWeight: 0,
                    tokenCacheSum: 0, tokenCacheWeight: 0, legacyCacheSum: 0, legacyCacheWeight: 0,
                    cost: 0,
                });
                g.calls += gm.calls;
                g.credits += gm.credits;
                g.inputTokens += gm.inputTokens;
                g.outputTokens += gm.outputTokens;
                g.thinkingTokens += gm.thinkingTokens;
                if (Number.isFinite(gm.avgTTFT) && gm.avgTTFT > 0) {
                    const weight = gm.calls > 0 ? gm.calls : 1;
                    g.ttftSum += gm.avgTTFT * weight;
                    g.ttftWeight += weight;
                }
                if (typeof gm.avgGenTokPerSec === 'number' && Number.isFinite(gm.avgGenTokPerSec) && gm.avgGenTokPerSec > 0) {
                    if (gm.outputTokens > 0) {
                        g.speedOutputSum += gm.outputTokens;
                        g.speedTimeSum += gm.outputTokens / gm.avgGenTokPerSec;
                    } else {
                        const weight = gm.calls > 0 ? gm.calls : 1;
                        g.speedFallbackSum += gm.avgGenTokPerSec * weight;
                        g.speedFallbackWeight += weight;
                    }
                }
                const hasTokenRate = typeof gm.tokenCacheHitRate === 'number'
                    && Number.isFinite(gm.tokenCacheHitRate)
                    && gm.tokenCacheHitRate >= 0;
                const hasCacheRead = typeof gm.cacheReadTokens === 'number'
                    && Number.isFinite(gm.cacheReadTokens)
                    && gm.cacheReadTokens >= 0;
                if (hasCacheRead) {
                    const promptTok = Math.max(0, gm.inputTokens || 0)
                        + gm.cacheReadTokens!
                        + Math.max(0, gm.cacheCreationTokens || 0);
                    if (promptTok > 0) {
                        const rate = hasTokenRate ? gm.tokenCacheHitRate! : (gm.cacheReadTokens! / promptTok);
                        g.tokenCacheSum += Math.min(1, Math.max(0, rate)) * promptTok;
                        g.tokenCacheWeight += promptTok;
                    } else if (hasTokenRate) {
                        const weight = gm.calls > 0 ? gm.calls : 1;
                        g.tokenCacheSum += Math.min(1, Math.max(0, gm.tokenCacheHitRate!)) * weight;
                        g.tokenCacheWeight += weight;
                    }
                } else if (hasTokenRate) {
                    const weight = gm.inputTokens > 0 ? gm.inputTokens : (gm.calls > 0 ? gm.calls : 1);
                    g.tokenCacheSum += Math.min(1, Math.max(0, gm.tokenCacheHitRate!)) * weight;
                    g.tokenCacheWeight += weight;
                } else if (gm.calls > 0 && Number.isFinite(gm.cacheHitRate) && gm.cacheHitRate >= 0) {
                    g.legacyCacheSum += Math.min(1, Math.max(0, gm.cacheHitRate)) * gm.calls;
                    g.legacyCacheWeight += gm.calls;
                }
                g.cost += gm.estimatedCost || 0;
            }
        }
    }

    // ── Derive GM-level aggregates for top bar ──
    let gmTotalTokens = 0;
    for (const ms of Object.values(mergedGM)) {
        gmTotalTokens += ms.inputTokens + ms.outputTokens;
    }
    const mergedGMHtml = buildMergedGMRows(mergedGM);
    const todayBadge = isToday(dateStr)
        ? `<span class="badge info-badge cal-today-badge"><span>${tBiHtml('Today', '今天')}</span></span>`
        : '';

    return `
        <div class="cal-detail" id="cal-detail-${dateStr}" style="display:none" data-cal-detail="${dateStr}">
            <div class="cal-detail-header">
                <span class="cal-detail-date">
                    ${CALENDAR_ICON} <span>${dateStr}</span> ${todayBadge}
                </span>
            </div>
            <div class="cal-day-summary">
                ${totalGMCalls > 0 ? `
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${totalGMCalls}</div>
                    <div class="cal-day-total-label">${tBiHtml('GM Calls', 'GM 调用')}</div>
                </div>` : ''}
                ${gmTotalTokens > 0 ? `
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${formatTokensK(gmTotalTokens)}</div>
                    <div class="cal-day-total-label">${tBiHtml('Tokens', 'Tokens')}</div>
                </div>` : ''}
                ${totalCost > 0 ? `
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${formatCost(totalCost)}</div>
                    <div class="cal-day-total-label">${tBiHtml('Cost', '费用')}</div>
                </div>` : ''}
                ${totalGMCredits > 0 ? `
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${totalGMCredits}</div>
                    <div class="cal-day-total-label">${tBiHtml('Credits', '积分')}</div>
                </div>` : ''}
            </div>
            ${mergedGMHtml}
        </div>`;
}


/** Merged per-model GM rows across all cycles (with weighted averages) */
function buildMergedGMRows(merged: Record<string, MergedCalendarGMModel>): string {
    const entries = Object.entries(merged);
    if (entries.length === 0) { return ''; }

    let html = '<div class="cal-model-rows">';
    html += `<div class="cal-gm-section-label">${tBiHtml('GM Summary', 'GM 汇总')}</div>`;
    for (const [name, ms] of entries) {
        const chips: string[] = [];
        if (ms.calls > 0) { chips.push(`<span class="cal-chip cal-chip-tools">${CAL_ICON.calls} <span>${ms.calls} ${tBiHtml('calls', '调用')}</span></span>`); }
        if (ms.credits > 0) { chips.push(`<span class="cal-chip cal-chip-tokens">${CAL_ICON.credit} <span>${ms.credits}</span></span>`); }
        const avgSpeed = ms.speedTimeSum > 0
            ? ms.speedOutputSum / ms.speedTimeSum
            : (ms.speedFallbackWeight > 0 ? ms.speedFallbackSum / ms.speedFallbackWeight : 0);
        if (avgSpeed > 0) {
            chips.push(`<span class="cal-chip cal-chip-speed" title="${esc(tBi('Avg generation speed', '平均生成速度'))}">${CAL_ICON.speed} <span>${esc(formatSpeed(avgSpeed))}</span></span>`);
        }
        const avgTTFT = ms.ttftWeight > 0 ? ms.ttftSum / ms.ttftWeight : 0;
        if (avgTTFT > 0) {
            chips.push(`<span class="cal-chip cal-chip-ttft" title="${esc(tBi('Avg TTFT', '平均首字延迟'))}">${CAL_ICON.clock} <span>${esc(formatLatency(avgTTFT))}</span></span>`);
        }
        const hasTokenCache = ms.tokenCacheWeight > 0;
        const avgCache = hasTokenCache
            ? ms.tokenCacheSum / ms.tokenCacheWeight
            : (ms.legacyCacheWeight > 0 ? ms.legacyCacheSum / ms.legacyCacheWeight : 0);
        if (avgCache > 0) {
            const cacheTitle = hasTokenCache
                ? tBi('Prompt cache hit rate (token-weighted)', '提示词缓存命中率（按 Token 加权）')
                : tBi('Cache hit rate (call ratio)', '缓存命中率（按调用占比）');
            chips.push(`<span class="cal-chip cal-chip-cache" title="${esc(cacheTitle)}">${CAL_ICON.cache} <span>${esc(formatCachePercent(avgCache))}</span></span>`);
        }
        if (ms.cost > 0) { chips.push(`<span class="cal-chip cal-chip-cost">${CAL_ICON.dollar} <span>${fmtCostShort(ms.cost)}</span></span>`); }
        const totalTok = ms.inputTokens + ms.outputTokens;
        if (totalTok > 0) { chips.push(`<span class="cal-chip cal-chip-tokens"><span>${fmtTok(totalTok)} ${tBiHtml('tokens', 'tokens')}</span></span>`); }
        html += `<div class="cal-model-row"><span class="cal-model-name" title="${esc(name)}">${esc(name)}</span><span class="cal-model-chips">${chips.join('')}</span></div>`;
    }
    html += '</div>';
    return html;
}


function buildOverallSummaryGrid(store: DailyStore): string {
    const dates = store.getDatesWithData();
    let totalCost = 0, totalGMCalls = 0, totalGMCredits = 0, totalGMTokens = 0;

    for (const date of dates) {
        const record = store.getRecord(date);
        if (!record) { continue; }
        for (const c of record.cycles) {
            totalCost += c.estimatedCost || 0;
            totalGMCalls += c.gmTotalCalls || 0;
            totalGMCredits += c.gmTotalCredits || 0;
            if (c.gmModelStats) {
                for (const gm of Object.values(c.gmModelStats)) {
                    totalGMTokens += gm.inputTokens + gm.outputTokens;
                }
            }
        }
    }

    return buildSummaryOverviewGrid(dates.length, totalGMTokens, totalCost, totalGMCredits, totalGMCalls);
}

function buildMonthlySummaryGrid(store: DailyStore, year: number, month: number): string {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const dates = store.getDatesWithData().filter(d => d.startsWith(prefix));

    if (dates.length === 0) {
        const enMonth = `${MONTH_NAMES_EN[month - 1]} ${year}`;
        const zhMonth = `${year}年${MONTH_NAMES_ZH[month - 1]}`;
        return `<p class="cal-summary-empty">${tBiHtml(
            `No data for ${enMonth} yet.`,
            `${zhMonth}暂无数据。`,
        )}</p>`;
    }

    let totalCost = 0, totalGMCalls = 0, totalGMCredits = 0, totalGMTokens = 0;

    for (const date of dates) {
        const record = store.getRecord(date);
        if (!record) { continue; }
        for (const c of record.cycles) {
            totalCost += c.estimatedCost || 0;
            totalGMCalls += c.gmTotalCalls || 0;
            totalGMCredits += c.gmTotalCredits || 0;
            if (c.gmModelStats) {
                for (const gm of Object.values(c.gmModelStats)) {
                    totalGMTokens += gm.inputTokens + gm.outputTokens;
                }
            }
        }
    }

    return buildSummaryOverviewGrid(dates.length, totalGMTokens, totalCost, totalGMCredits, totalGMCalls);
}

/** Shared grid builder for all-time and monthly summaries */
function buildSummaryOverviewGrid(
    dayCount: number,
    gmTokens: number, cost: number,
    gmCredits: number, gmCalls: number,
): string {
    return `
            <div class="cal-overview-grid">
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${dayCount}</div>
                    <div class="cal-overview-label">${tBiHtml('Days', '天数')}</div>
                </div>
                ${gmCalls > 0 ? `
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${gmCalls}</div>
                    <div class="cal-overview-label">${tBiHtml('GM Calls', 'GM 调用')}</div>
                </div>` : ''}
                ${gmTokens > 0 ? `
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${formatTokensK(gmTokens)}</div>
                    <div class="cal-overview-label">${tBiHtml('Tokens', 'Tokens')}</div>
                </div>` : ''}
                ${cost > 0 ? `
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${formatCost(cost)}</div>
                    <div class="cal-overview-label">${tBiHtml('Cost', '费用')}</div>
                </div>` : ''}
                ${gmCredits > 0 ? `
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${gmCredits}</div>
                    <div class="cal-overview-label">${tBiHtml('Credits', '积分')}</div>
                </div>` : ''}
            </div>`;
}

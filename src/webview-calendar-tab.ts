// ─── Calendar Tab Content Builder ────────────────────────────────────────────
// Renders the Calendar tab: month navigation, 7×6 calendar grid with data
// indicators, and expandable daily detail panels.

import { tBi, getLanguage } from './i18n';
import { DailyStore, DailyRecord, MonthCellSummary } from './daily-store';
import { ICON } from './webview-icons';
import { esc } from './webview-helpers';
import { normalizeModelDisplayName } from './models';

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
    brain: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M5.52.359A.5.5 0 0 1 6 0h4a.5.5 0 0 1 .474.658L8.694 6H12.5a.5.5 0 0 1 .395.807l-7 9a.5.5 0 0 1-.873-.454L6.823 9H3.5a.5.5 0 0 1-.48-.641z"/></svg>',
    tool: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M1 0 0 1l2.2 3.081a1 1 0 0 0 .815.419h.07a1 1 0 0 1 .708.293l2.675 2.675-2.617 2.654A3.003 3.003 0 0 0 0 13a3 3 0 1 0 5.878-.851l2.654-2.617.968.968-.305.914a1 1 0 0 0 .242 1.023l3.27 3.27a.997.997 0 0 0 1.414 0l1.586-1.586a.997.997 0 0 0 0-1.414l-3.27-3.27a1 1 0 0 0-1.023-.242L10.5 9.5l-.96-.96 2.68-2.643A3.005 3.005 0 0 0 16 3c0-.269-.035-.53-.102-.777l-2.14 2.141L12 4l-.364-1.757L13.777.102a3 3 0 0 0-3.675 3.68L7.462 6.46 4.793 3.793a1 1 0 0 1-.293-.707v-.071a1 1 0 0 0-.419-.814z"/></svg>',
    warn: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2"/></svg>',
    chart: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h1v15h15v1H0zm14.817 3.113a.5.5 0 0 1 .07.704l-4.5 5.5a.5.5 0 0 1-.74.037L7.06 6.767l-3.656 5.027a.5.5 0 0 1-.808-.588l4-5.5a.5.5 0 0 1 .758-.06l2.609 2.61 4.15-5.073a.5.5 0 0 1 .704-.07"/></svg>',
    token: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M1 3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1H1m0 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4zm6 2a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z"/></svg>',
    calls: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M2.5 1A1.5 1.5 0 0 0 1 2.5v11A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 13.5 1zm4.168 4.413a.5.5 0 0 1 .497.034l3.5 2.5a.5.5 0 0 1 0 .806l-3.5 2.5A.5.5 0 0 1 6.5 10.5v-5a.5.5 0 0 1 .168-.087"/></svg>',
    credit: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path fill="currentColor" d="M4 5.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5M4 8a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7A.5.5 0 0 1 4 8m0 2.5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5"/></svg>',
    clock: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 3.5a.5.5 0 0 0-1 0V8a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 7.71z"/><path fill="currentColor" d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/></svg>',
    cache: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm15 2h-4v3h4zm0 4h-4v3h4zm0 4h-4v3h3a1 1 0 0 0 1-1zm-5 3v-3H6v3zm-5 0v-3H1v2a1 1 0 0 0 1 1zm-4-4h4V8H1zm0-4h4V4H1zm5-3v3h4V4zm4 4H6v3h4z"/></svg>',
    dollar: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M4 10.781c.148 1.667 1.513 2.85 3.591 3.003V15h1.043v-1.216c2.27-.179 3.678-1.438 3.678-3.3 0-1.59-.947-2.51-2.956-3.028l-.722-.187V3.467c1.122.11 1.879.714 2.07 1.616h1.47c-.166-1.6-1.54-2.748-3.54-2.875V1H7.591v1.233c-1.939.23-3.27 1.472-3.27 3.156 0 1.454.966 2.483 2.661 2.917l.61.162v4.031c-1.149-.17-1.94-.8-2.131-1.718zm3.391-3.836c-1.043-.263-1.6-.825-1.6-1.616 0-.944.704-1.641 1.8-1.828v3.495zM8.634 8.1C9.858 8.418 10.44 9 10.44 9.89c0 1.12-.789 1.816-2.007 1.931V8.1z"/></svg>',
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
                <h2>${CALENDAR_ICON} ${tBi('Calendar', '日历')}</h2>
                <p class="empty-desc">${tBi(
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
            <section class="card">
                <div class="cal-summary-header">
                    <h2>${ICON.chart} ${tBi('Usage Summary', '用量汇总')}</h2>
                    <div class="cal-summary-toggle" id="calSummaryToggle">
                        <button class="cal-summary-btn active" data-summary-mode="monthly">${tBi('Monthly', '月度')}</button>
                        <button class="cal-summary-btn" data-summary-mode="alltime">${tBi('All-Time', '全部')}</button>
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
            <section class="card cal-clear-section">
                <button class="cal-clear-btn" id="clearCalendarBtn">
                    ${ICON.trash} ${tBi('Clear All Calendar History', '清空所有日历历史')}
                </button>
            </section>`);
    }

    return parts.join('');
}

/** Return calendar-specific CSS. */
export function getCalendarTabStyles(): string {
    return `
        /* ─── Calendar Tab ─────────────── */
        .cal-nav {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-3);
            margin-bottom: var(--space-3);
        }

        .cal-nav-btn {
            appearance: none;
            background: rgba(255,255,255,0.04);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            color: var(--color-text-dim);
            cursor: pointer;
            padding: var(--space-1) var(--space-2);
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s cubic-bezier(.4,0,.2,1), color 0.15s cubic-bezier(.4,0,.2,1);
        }

        .cal-nav-btn:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
            outline: none;
        }

        .cal-nav-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .cal-nav-btn:hover {
                background: var(--color-surface-hover);
                color: var(--color-text);
            }
        }

        .cal-month-label {
            font-weight: 600;
            font-size: 0.95em;
            min-width: 120px;
            text-align: center;
        }

        .cal-grid {
            display: grid;
            grid-template-columns: repeat(7, 1fr);
            gap: 2px;
            margin-bottom: var(--space-3);
        }

        .cal-header-cell {
            text-align: center;
            font-size: 0.8em;
            font-weight: 600;
            color: var(--color-text-dim);
            padding: var(--space-1) 0;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .cal-cell {
            position: relative;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: var(--space-1) 0;
            border-radius: var(--radius-sm);
            font-size: 0.82em;
            color: var(--color-text-dim);
            transition: background 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
            border: 1px solid transparent;
            cursor: default;
        }

        .cal-cell.has-data {
            cursor: pointer;
            color: var(--color-text);
            background: var(--color-surface);
        }

        .cal-cell.has-data:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
            outline: none;
        }

        .cal-cell.has-data:active { transform: scale(0.98); }

        @media (hover: hover) {
            .cal-cell.has-data:hover {
                background: rgba(96, 165, 250, 0.12);
                border-color: rgba(96, 165, 250, 0.3);
            }
        }

        .cal-cell.today {
            border-color: var(--color-info);
            font-weight: 700;
        }

        .cal-cell.selected {
            background: rgba(96, 165, 250, 0.15);
            border-color: var(--color-info);
        }

        .cal-cell.empty-cell {
            opacity: 0.2;
        }

        .cal-dot {
            width: 5px;
            height: 5px;
            border-radius: var(--radius-sm);
            background: var(--color-info);
            margin-top: 2px;
        }

        .cal-dot.high-activity {
            background: var(--color-ok);
            width: 6px;
            height: 6px;
        }

        /* ── Day Detail Panel ─── */
        .cal-detail {
            border: 1px solid rgba(96, 165, 250, 0.2);
            border-radius: var(--radius-lg);
            background: rgba(96, 165, 250, 0.04);
            padding: var(--space-4);
            margin-bottom: var(--space-3);
            animation: calFadeIn 0.2s cubic-bezier(.4,0,.2,1);
        }

        @keyframes calFadeIn {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .cal-detail-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-3);
        }

        .cal-detail-date {
            font-weight: 600;
            font-size: 0.95em;
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }

        .cal-detail-summary {
            display: flex;
            gap: var(--space-3);
            flex-wrap: wrap;
            font-size: 0.85em;
            color: var(--color-text-dim);
        }

        .cal-detail-summary .cal-sum-item {
            display: flex;
            align-items: center;
            gap: var(--space-1);
        }

        /* ── Cycle Card ─── */
        .cal-cycle {
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            padding: var(--space-3);
            margin-bottom: var(--space-2);
            background: var(--color-surface);
            transition: border-color 0.2s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .cal-cycle:hover {
                border-color: var(--color-border-hover);
            }
        }

        .cal-cycle:last-child { margin-bottom: 0; }

        .cal-cycle-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-2);
            font-size: 0.88em;
        }

        .cal-cycle-time {
            color: var(--color-text-dim);
        }

        .cal-cycle-models {
            display: flex;
            gap: var(--space-1);
            flex-wrap: wrap;
        }

        .cal-model-chip {
            font-size: 0.8em;
            padding: 1px 6px;
            border-radius: var(--radius-sm);
            background: rgba(96, 165, 250, 0.1);
            color: var(--color-info);
            border: 1px solid rgba(96, 165, 250, 0.2);
        }

        .cal-cycle-stats {
            display: flex;
            gap: var(--space-3);
            flex-wrap: wrap;
            font-size: 0.88em;
        }

        .cal-stat {
            display: flex;
            align-items: center;
            gap: var(--space-1);
        }

        .cal-stat-val {
            font-weight: 600;
        }

        .cal-stat-label {
            color: var(--color-text-dim);
            font-size: 0.85em;
        }

        /* ── Day Summary Bar ─── */
        .cal-day-summary {
            border-top: 1px solid var(--color-border);
            margin-top: var(--space-3);
            padding-top: var(--space-3);
            display: flex;
            justify-content: space-around;
            flex-wrap: wrap;
            gap: var(--space-2);
        }

        .cal-day-total {
            text-align: center;
        }

        .cal-day-total-val {
            font-weight: 700;
            font-size: 1.1em;
        }

        .cal-day-total-label {
            font-size: 0.8em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .cal-day-total-danger {
            color: var(--color-danger);
        }

        /* ── Clear Button ─── */
        .cal-clear-btn {
            appearance: none;
            background: rgba(248, 113, 113, 0.08);
            border: 1px solid rgba(248, 113, 113, 0.2);
            border-radius: var(--radius-md);
            color: var(--color-danger);
            padding: var(--space-2) var(--space-4);
            cursor: pointer;
            font-family: inherit;
            font-size: 0.82em;
            display: inline-flex;
            align-items: center;
            gap: var(--space-2);
            transition: background 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
        }

        .cal-clear-btn:focus-visible {
            box-shadow: 0 0 0 2px var(--color-danger);
            outline: none;
        }

        .cal-clear-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .cal-clear-btn:hover {
                background: rgba(248, 113, 113, 0.15);
                border-color: rgba(248, 113, 113, 0.4);
            }
        }

        /* ── Test / Restore Buttons ─── */
        .cal-test-btn,
        .cal-restore-btn {
            appearance: none;
            border-radius: var(--radius-md);
            padding: var(--space-2) var(--space-4);
            cursor: pointer;
            font-family: inherit;
            font-size: 0.82em;
            display: inline-flex;
            align-items: center;
            gap: var(--space-2);
            margin: 0 var(--space-2);
        }

        /* ── Overall Summary Card ─── */
        .cal-overview-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
            gap: var(--space-2);
        }

        .cal-overview-item {
            text-align: center;
            padding: var(--space-2);
            background: rgba(255,255,255,0.02);
            border-radius: var(--radius-md);
        }

        .cal-overview-val {
            font-weight: 700;
            font-size: 1.05em;
        }

        .cal-overview-label {
            font-size: 0.8em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        /* ── Per-Model Breakdown ─── */
        .cal-model-rows {
            margin-top: var(--space-2);
            border-top: 1px solid var(--color-border);
            padding-top: var(--space-2);
        }

        .cal-model-row {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-1) 0;
            font-size: 0.78em;
            flex-wrap: wrap;
        }

        .cal-model-row + .cal-model-row {
            border-top: 1px dashed rgba(255,255,255,0.04);
        }

        .cal-model-name {
            font-weight: 600;
            color: var(--color-text);
            min-width: 80px;
            flex-shrink: 0;
        }

        .cal-model-chips {
            display: flex;
            gap: var(--space-1);
            flex-wrap: wrap;
        }

        .cal-chip {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            padding: 1px var(--space-1);
            border-radius: var(--radius-sm);
            font-size: 0.9em;
            white-space: nowrap;
        }

        .cal-chip svg {
            width: 10px;
            height: 10px;
            flex-shrink: 0;
        }

        .cal-chip-reasoning {
            background: rgba(251, 146, 60, 0.1);
            color: #fb923c;
            border: 1px solid rgba(251, 146, 60, 0.2);
        }

        .cal-chip-tools {
            background: rgba(96, 165, 250, 0.1);
            color: var(--color-info);
            border: 1px solid rgba(96, 165, 250, 0.2);
        }

        .cal-chip-errors {
            background: rgba(248, 113, 113, 0.1);
            color: var(--color-danger);
            border: 1px solid rgba(248, 113, 113, 0.2);
        }

        .cal-chip-est {
            background: rgba(250, 204, 21, 0.1);
            color: var(--color-warn);
            border: 1px solid rgba(250, 204, 21, 0.2);
        }

        .cal-chip-tokens {
            background: rgba(52, 211, 153, 0.08);
            color: #34d399;
            border: 1px solid rgba(52, 211, 153, 0.2);
        }

        .cal-chip-cost {
            background: rgba(251, 191, 36, 0.08);
            color: #fbbf24;
            border: 1px solid rgba(251, 191, 36, 0.2);
        }

        .cal-chip-ttft {
            background: rgba(255,255,255,0.06);
            color: var(--color-text-dim);
            border: 1px solid rgba(255,255,255,0.1);
        }

        .cal-chip-cache {
            background: rgba(34, 211, 238, 0.08);
            color: #22d3ee;
            border: 1px solid rgba(34, 211, 238, 0.2);
        }

        .cal-gm-section-label {
            font-size: 0.78em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: var(--space-1);
            opacity: 0.7;
        }

        .cal-clear-section {
            text-align: center;
        }

        .cal-account-tag {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            font-size: 0.72em;
            padding: 1px 6px;
            border-radius: 10px;
            background: rgba(139,92,246,0.12);
            color: rgba(196,181,253,0.9);
            letter-spacing: 0.2px;
            margin-left: var(--space-1);
            vertical-align: middle;
        }
        body.vscode-light .cal-account-tag {
            background: rgba(109,40,217,0.08);
            color: #6d28d9;
        }

        .cal-cycle-stats-spaced {
            margin-top: var(--space-2);
        }

        .cal-cycles-details {
            margin-top: var(--space-2);
        }

        .cal-cycles-summary {
            cursor: pointer;
            font-size: 0.85em;
            font-weight: 600;
            color: var(--color-info);
            padding: var(--space-2);
            border-radius: var(--radius-sm);
            background: rgba(96,165,250,0.06);
            border: 1px solid rgba(96,165,250,0.15);
            list-style: none;
            transition: background 0.15s cubic-bezier(.4,0,.2,1);
        }

        .cal-cycles-summary::-webkit-details-marker { display: none; }

        .cal-cycles-summary::before {
            content: '▶ ';
            font-size: 0.78em;
        }

        .cal-cycles-details[open] > .cal-cycles-summary::before {
            content: '▼ ';
        }

        @media (hover: hover) {
            .cal-cycles-summary:hover {
                background: rgba(96,165,250,0.12);
            }
        }

        .cal-cycles-summary:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
            outline: none;
        }

        @media (prefers-reduced-motion: reduce) {
            .cal-detail { animation: none; }
        }

        /* ─── Light Theme: Calendar Chips ──── */
        body.vscode-light .cal-model-chip { background: rgba(37,99,235,0.08); color: #1d4ed8; border-color: rgba(37,99,235,0.2); }
        body.vscode-light .cal-chip-reasoning { background: rgba(234,88,12,0.08); color: #c2410c; border-color: rgba(234,88,12,0.2); }
        body.vscode-light .cal-chip-tools { background: rgba(37,99,235,0.08); color: #1e40af; border-color: rgba(37,99,235,0.2); }
        body.vscode-light .cal-chip-errors { background: rgba(220,38,38,0.08); color: #991b1b; border-color: rgba(220,38,38,0.2); }
        body.vscode-light .cal-chip-est { background: rgba(202,138,4,0.08); color: #92400e; border-color: rgba(202,138,4,0.2); }
        body.vscode-light .cal-chip-tokens { background: rgba(22,163,74,0.06); color: #15803d; border-color: rgba(22,163,74,0.2); }
        body.vscode-light .cal-chip-cost { background: rgba(202,138,4,0.06); color: #92400e; border-color: rgba(202,138,4,0.2); }
        body.vscode-light .cal-chip-ttft { background: rgba(0,0,0,0.04); color: rgba(0,0,0,0.55); border-color: rgba(0,0,0,0.1); }
        body.vscode-light .cal-chip-cache { background: rgba(13,148,136,0.06); color: #0f766e; border-color: rgba(13,148,136,0.2); }
        body.vscode-light .cal-cell.has-data { background: rgba(0,0,0,0.03); }
        body.vscode-light .cal-cycle { background: rgba(0,0,0,0.015); }
        body.vscode-light .cal-detail { background: rgba(37,99,235,0.03); border-color: rgba(37,99,235,0.15); }
        body.vscode-light .cal-nav-btn { background: rgba(0,0,0,0.04); }
        body.vscode-light .cal-overview-item { background: rgba(0,0,0,0.02); }
        body.vscode-light .cal-model-row + .cal-model-row { border-top-color: rgba(0,0,0,0.06); }

        /* ─── Calendar Summary Toggle ──── */
        .cal-summary-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-2);
            margin-bottom: var(--space-3);
        }
        .cal-summary-header h2 {
            margin-bottom: 0;
        }
        .cal-summary-toggle {
            display: flex;
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            overflow: hidden;
            flex-shrink: 0;
        }
        .cal-summary-btn {
            appearance: none;
            background: transparent;
            color: var(--color-text-dim);
            border: none;
            padding: var(--space-1) var(--space-3);
            font: inherit;
            font-size: 0.76em;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s cubic-bezier(.4,0,.2,1), color 0.2s cubic-bezier(.4,0,.2,1);
            border-right: 1px solid var(--color-border);
        }
        .cal-summary-btn:last-child { border-right: none; }
        .cal-summary-btn.active {
            background: var(--color-info);
            color: #fff;
        }
        .cal-summary-btn:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
            outline: none;
        }
        .cal-summary-btn:active { transform: scale(0.97); }
        @media (hover: hover) {
            .cal-summary-btn:not(.active):hover {
                background: rgba(0,0,0,0.06);
                color: var(--color-text);
            }
        }
        body.vscode-dark .cal-summary-btn:not(.active):hover {
            background: rgba(255,255,255,0.08);
        }
        .cal-summary-pane {
            animation: calSummaryFadeIn 0.25s ease-out;
        }
        @keyframes calSummaryFadeIn {
            from { opacity: 0; transform: translateY(-4px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .cal-summary-empty {
            color: var(--color-text-dim);
            font-size: 0.85em;
            text-align: center;
            padding: var(--space-3) 0;
            opacity: 0.7;
        }
        @media (prefers-reduced-motion: reduce) {
            .cal-summary-pane { animation: none; }
            .cal-summary-btn { transition: none; }
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

    const monthLabel = tBi(
        `${MONTH_NAMES_EN[month - 1]} ${year}`,
        `${year}年${MONTH_NAMES_ZH[month - 1]}`,
    );
    const lang = getLanguage();
    const dayHeaders = lang === 'en' ? DAY_HEADERS_EN : DAY_HEADERS_ZH;

    // Header cells
    const headerCells = dayHeaders
        .map(d => `<div class="cal-header-cell">${d}</div>`)
        .join('');

    // Day cells
    const cells: string[] = [];
    // Empty cells before month starts
    for (let i = 0; i < startDay; i++) {
        cells.push('<div class="cal-cell empty-cell"></div>');
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
                <button class="cal-cell has-data${todayClass}" data-cal-date="${dateStr}" data-tooltip="${tBi('has data', '有数据')}">
                    ${day}
                    <div class="cal-dot${highActivity ? ' high-activity' : ''}"></div>
                </button>`);
        } else {
            cells.push(`<div class="cal-cell${todayClass}">${day}</div>`);
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
            <h2>${CALENDAR_ICON} ${tBi('Calendar', '日历')}</h2>
            <div class="cal-nav">
                <button class="cal-nav-btn" data-cal-nav="prev" data-cal-year="${prevYear}" data-cal-month="${prevMonth}">
                    ${CHEVRON_LEFT}
                </button>
                <span class="cal-month-label">${monthLabel}</span>
                <button class="cal-nav-btn" data-cal-nav="next" data-cal-year="${nextYear}" data-cal-month="${nextMonth}">
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

function buildDayDetail(record: DailyRecord, dateStr: string): string {
    // ── Aggregate totals across all cycles ──
    let totalCost = 0, totalGMCalls = 0, totalGMCredits = 0;

    // ── Aggregate per-model GM stats across cycles ──
    const mergedGM: Record<string, { calls: number; credits: number; inputTokens: number; outputTokens: number; thinkingTokens: number; ttftSum: number; ttftWeight: number; cacheSum: number; cacheWeight: number; cost: number }> = {};

    for (const c of record.cycles) {
        totalCost += c.estimatedCost || 0;
        totalGMCalls += c.gmTotalCalls || 0;
        totalGMCredits += c.gmTotalCredits || 0;

        if (c.gmModelStats) {
            for (const [rawName, gm] of Object.entries(c.gmModelStats)) {
                const name = normalizeModelDisplayName(rawName) || rawName;
                const g = mergedGM[name] || (mergedGM[name] = { calls: 0, credits: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, ttftSum: 0, ttftWeight: 0, cacheSum: 0, cacheWeight: 0, cost: 0 });
                g.calls += gm.calls;
                g.credits += gm.credits;
                g.inputTokens += gm.inputTokens;
                g.outputTokens += gm.outputTokens;
                g.thinkingTokens += gm.thinkingTokens;
                if (gm.avgTTFT > 0 && gm.calls > 0) { g.ttftSum += gm.avgTTFT * gm.calls; g.ttftWeight += gm.calls; }
                if (gm.calls > 0) { g.cacheSum += gm.cacheHitRate * gm.calls; g.cacheWeight += gm.calls; }
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
        ? `<span class="badge info-badge">${tBi('TODAY', '今天')}</span>`
        : '';

    return `
        <div class="cal-detail" id="cal-detail-${dateStr}" style="display:none" data-cal-detail="${dateStr}">
            <div class="cal-detail-header">
                <span class="cal-detail-date">
                    ${CALENDAR_ICON} ${dateStr} ${todayBadge}
                </span>
            </div>
            <div class="cal-day-summary">
                ${totalGMCalls > 0 ? `
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${totalGMCalls}</div>
                    <div class="cal-day-total-label">${tBi('GM Calls', 'GM 调用')}</div>
                </div>` : ''}
                ${gmTotalTokens > 0 ? `
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${formatTokensK(gmTotalTokens)}</div>
                    <div class="cal-day-total-label">${tBi('Tokens', '令牌')}</div>
                </div>` : ''}
                ${totalCost > 0 ? `
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${formatCost(totalCost)}</div>
                    <div class="cal-day-total-label">${tBi('Cost', '费用')}</div>
                </div>` : ''}
                ${totalGMCredits > 0 ? `
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${totalGMCredits}</div>
                    <div class="cal-day-total-label">${tBi('Credits', '积分')}</div>
                </div>` : ''}
            </div>
            ${mergedGMHtml}
        </div>`;
}


/** Merged per-model GM rows across all cycles (with weighted averages) */
function buildMergedGMRows(merged: Record<string, { calls: number; credits: number; inputTokens: number; outputTokens: number; thinkingTokens: number; ttftSum: number; ttftWeight: number; cacheSum: number; cacheWeight: number; cost: number }>): string {
    const entries = Object.entries(merged);
    if (entries.length === 0) { return ''; }

    let html = '<div class="cal-model-rows">';
    html += `<div class="cal-gm-section-label">GM ${tBi('Summary', '汇总')}</div>`;
    for (const [name, ms] of entries) {
        const chips: string[] = [];
        if (ms.calls > 0) { chips.push(`<span class="cal-chip cal-chip-tools">${CAL_ICON.calls} ${ms.calls} ${tBi('calls', '调用')}</span>`); }
        if (ms.credits > 0) { chips.push(`<span class="cal-chip cal-chip-tokens">${CAL_ICON.credit} ${ms.credits}</span>`); }
        const avgTTFT = ms.ttftWeight > 0 ? ms.ttftSum / ms.ttftWeight : 0;
        if (avgTTFT > 0) { chips.push(`<span class="cal-chip cal-chip-ttft">${CAL_ICON.clock} ${avgTTFT.toFixed(1)}s</span>`); }
        const avgCache = ms.cacheWeight > 0 ? ms.cacheSum / ms.cacheWeight : 0;
        if (avgCache > 0) { chips.push(`<span class="cal-chip cal-chip-cache">${CAL_ICON.cache} ${(avgCache * 100).toFixed(0)}%</span>`); }
        if (ms.cost > 0) { chips.push(`<span class="cal-chip cal-chip-cost">${CAL_ICON.dollar} ${fmtCostShort(ms.cost)}</span>`); }
        const totalTok = ms.inputTokens + ms.outputTokens;
        if (totalTok > 0) { chips.push(`<span class="cal-chip cal-chip-tokens">${fmtTok(totalTok)} ${tBi('tok', '令牌')}</span>`); }
        html += `<div class="cal-model-row"><span class="cal-model-name">${esc(name)}</span><span class="cal-model-chips">${chips.join('')}</span></div>`;
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
        const lang = getLanguage();
        const monthLabel = lang === 'en'
            ? `${MONTH_NAMES_EN[month - 1]} ${year}`
            : `${year}年${MONTH_NAMES_ZH[month - 1]}`;
        return `<p class="cal-summary-empty">${tBi(
            `No data for ${monthLabel} yet.`,
            `${monthLabel}暂无数据。`,
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
                    <div class="cal-overview-label">${tBi('Days', '天数')}</div>
                </div>
                ${gmCalls > 0 ? `
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${gmCalls}</div>
                    <div class="cal-overview-label">${tBi('GM Calls', 'GM 调用')}</div>
                </div>` : ''}
                ${gmTokens > 0 ? `
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${formatTokensK(gmTokens)}</div>
                    <div class="cal-overview-label">${tBi('Tokens', '令牌')}</div>
                </div>` : ''}
                ${cost > 0 ? `
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${formatCost(cost)}</div>
                    <div class="cal-overview-label">${tBi('Cost', '费用')}</div>
                </div>` : ''}
                ${gmCredits > 0 ? `
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${gmCredits}</div>
                    <div class="cal-overview-label">${tBi('Credits', '积分')}</div>
                </div>` : ''}
            </div>`;
}

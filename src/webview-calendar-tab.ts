// ─── Calendar Tab Content Builder ────────────────────────────────────────────
// Renders the Calendar tab: month navigation, 7×6 calendar grid with data
// indicators, and expandable daily detail panels.

import { tBi, getLanguage } from './i18n';
import { DailyStore, DailyRecord, DailyCycleEntry, MonthCellSummary, ModelCycleStats } from './daily-store';
import { ICON } from './webview-icons';
import { esc, formatShortTime, formatDuration } from './webview-helpers';

// ─── SVG Icons ───────────────────────────────────────────────────────────────

const CALENDAR_ICON = '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/></svg>';

const CHEVRON_LEFT = '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"/></svg>';
const CHEVRON_RIGHT = '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/></svg>';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTH_NAMES_ZH = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const MONTH_NAMES_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_HEADERS_ZH = ['一','二','三','四','五','六','日'];
const DAY_HEADERS_EN = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

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

    // ── Month Navigation + Grid ──
    parts.push(buildMonthView(store, currentYear, currentMonth));

    // ── Stats Summary ──
    if (store.totalDays > 0) {
        parts.push(buildOverallSummary(store));
    }


    // ── Clear Button ──
    if (store.totalDays > 0) {
        parts.push(`
            <section class="card" style="text-align:center">
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
                background: rgba(255,255,255,0.08);
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
            font-size: 0.7em;
            font-weight: 600;
            color: var(--color-text-dim);
            padding: var(--space-1) 0;
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .cal-cell {
            position: relative;
            aspect-ratio: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            border-radius: var(--radius-md);
            font-size: 0.82em;
            color: var(--color-text-dim);
            transition: background 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
            border: 1px solid transparent;
            cursor: default;
        }

        .cal-cell.has-data {
            cursor: pointer;
            color: var(--color-text);
            background: rgba(255,255,255,0.03);
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
            font-size: 0.8em;
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
            background: rgba(255,255,255,0.02);
            transition: border-color 0.2s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .cal-cycle:hover {
                border-color: rgba(255,255,255,0.15);
            }
        }

        .cal-cycle:last-child { margin-bottom: 0; }

        .cal-cycle-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-2);
            font-size: 0.82em;
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
            font-size: 0.7em;
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
            font-size: 0.8em;
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
            font-size: 0.7em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.3px;
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
            font-size: 0.7em;
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
            background: rgba(139, 92, 246, 0.1);
            color: #a78bfa;
            border: 1px solid rgba(139, 92, 246, 0.2);
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

        @media (prefers-reduced-motion: reduce) {
            .cal-detail { animation: none; }
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
            const highActivity = cellData.totalReasoning > 20 || cellData.cycleCount > 2;
            cells.push(`
                <button class="cal-cell has-data${todayClass}" data-cal-date="${dateStr}" data-tooltip="${cellData.cycleCount} ${tBi('cycles', '周期')}">
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
    // Aggregate totals
    let totalReasoning = 0, totalToolCalls = 0, totalErrors = 0;
    let totalInput = 0, totalOutput = 0, totalCost = 0;
    let totalGMCalls = 0, totalGMCredits = 0;

    for (const c of record.cycles) {
        totalReasoning += c.totalReasoning;
        totalToolCalls += c.totalToolCalls;
        totalErrors += c.totalErrors;
        totalInput += c.totalInputTokens;
        totalOutput += c.totalOutputTokens;
        totalCost += c.estimatedCost || 0;
        totalGMCalls += c.gmTotalCalls || 0;
        totalGMCredits += c.gmTotalCredits || 0;
    }

    const cycleCards = record.cycles.map((c, idx) => buildCycleCard(c, idx + 1)).join('');

    const todayBadge = isToday(dateStr)
        ? `<span class="badge info-badge">${tBi('TODAY', '今天')}</span>`
        : '';

    return `
        <div class="cal-detail" id="cal-detail-${dateStr}" style="display:none" data-cal-detail="${dateStr}">
            <div class="cal-detail-header">
                <span class="cal-detail-date">
                    ${CALENDAR_ICON} ${dateStr} ${todayBadge}
                </span>
                <div class="cal-detail-summary">
                    <span class="cal-sum-item"><span class="cal-stat-val">${record.cycles.length}</span> ${tBi('cycles', '周期')}</span>
                </div>
            </div>
            ${cycleCards}
            <div class="cal-day-summary">
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${totalReasoning}</div>
                    <div class="cal-day-total-label">${tBi('Reasoning', '推理')}</div>
                </div>
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${totalToolCalls}</div>
                    <div class="cal-day-total-label">${tBi('Tools', '工具')}</div>
                </div>
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${formatTokensK(totalInput + totalOutput)}</div>
                    <div class="cal-day-total-label">${tBi('Tokens', '令牌')}</div>
                </div>
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
        </div>`;
}

function buildCycleCard(cycle: DailyCycleEntry, index: number): string {
    const startTime = formatShortTime(cycle.startTime);
    const endTime = formatShortTime(cycle.endTime);
    const duration = formatDuration(
        new Date(cycle.endTime).getTime() - new Date(cycle.startTime).getTime(),
    );

    const modelChips = cycle.modelNames
        .map(m => `<span class="cal-model-chip">${esc(m)}</span>`)
        .join('');

    const stats: string[] = [];
    if (cycle.totalReasoning > 0) {
        stats.push(`<span class="cal-stat"><span class="cal-stat-val">${cycle.totalReasoning}</span> <span class="cal-stat-label">${tBi('reasoning', '推理')}</span></span>`);
    }
    if (cycle.totalToolCalls > 0) {
        stats.push(`<span class="cal-stat"><span class="cal-stat-val">${cycle.totalToolCalls}</span> <span class="cal-stat-label">${tBi('tools', '工具')}</span></span>`);
    }
    if (cycle.totalInputTokens + cycle.totalOutputTokens > 0) {
        stats.push(`<span class="cal-stat"><span class="cal-stat-val">${formatTokensK(cycle.totalInputTokens + cycle.totalOutputTokens)}</span> <span class="cal-stat-label">${tBi('tokens', '令牌')}</span></span>`);
    }
    if (cycle.estimatedCost && cycle.estimatedCost > 0) {
        stats.push(`<span class="cal-stat"><span class="cal-stat-val">${formatCost(cycle.estimatedCost)}</span> <span class="cal-stat-label">${tBi('cost', '费用')}</span></span>`);
    }
    if (cycle.gmTotalCredits && cycle.gmTotalCredits > 0) {
        stats.push(`<span class="cal-stat"><span class="cal-stat-val">${cycle.gmTotalCredits}</span> <span class="cal-stat-label">${tBi('credits', '积分')}</span></span>`);
    }
    if (cycle.totalErrors > 0) {
        stats.push(`<span class="cal-stat" style="color:var(--color-danger)"><span class="cal-stat-val">${cycle.totalErrors}</span> <span class="cal-stat-label">${tBi('errors', '错误')}</span></span>`);
    }

    return `
        <div class="cal-cycle">
            <div class="cal-cycle-header">
                <span class="cal-cycle-time">
                    #${index} · ${startTime} — ${endTime} · ${duration}
                </span>
            </div>
            ${modelChips ? `<div class="cal-cycle-models">${modelChips}</div>` : ''}
            <div class="cal-cycle-stats" style="margin-top:var(--space-2)">
                ${stats.join('')}
            </div>
            ${buildPerModelRows(cycle.modelStats)}
        </div>`;
}

function buildPerModelRows(modelStats?: Record<string, ModelCycleStats>): string {
    if (!modelStats || Object.keys(modelStats).length === 0) { return ''; }

    const BRAIN = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M5.52.359A.5.5 0 0 1 6 0h4a.5.5 0 0 1 .474.658L8.694 6H12.5a.5.5 0 0 1 .395.807l-7 9a.5.5 0 0 1-.873-.454L6.823 9H3.5a.5.5 0 0 1-.48-.641z"/></svg>';
    const TOOL = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M1 0 0 1l2.2 3.081a1 1 0 0 0 .815.419h.07a1 1 0 0 1 .708.293l2.675 2.675-2.617 2.654A3.003 3.003 0 0 0 0 13a3 3 0 1 0 5.878-.851l2.654-2.617.968.968-.305.914a1 1 0 0 0 .242 1.023l3.27 3.27a.997.997 0 0 0 1.414 0l1.586-1.586a.997.997 0 0 0 0-1.414l-3.27-3.27a1 1 0 0 0-1.023-.242L10.5 9.5l-.96-.96 2.68-2.643A3.005 3.005 0 0 0 16 3c0-.269-.035-.53-.102-.777l-2.14 2.141L12 4l-.364-1.757L13.777.102a3 3 0 0 0-3.675 3.68L7.462 6.46 4.793 3.793a1 1 0 0 1-.293-.707v-.071a1 1 0 0 0-.419-.814z"/></svg>';
    const WARN = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2"/></svg>';
    const CHART = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h1v15h15v1H0zm14.817 3.113a.5.5 0 0 1 .07.704l-4.5 5.5a.5.5 0 0 1-.74.037L7.06 6.767l-3.656 5.027a.5.5 0 0 1-.808-.588l4-5.5a.5.5 0 0 1 .758-.06l2.609 2.61 4.15-5.073a.5.5 0 0 1 .704-.07"/></svg>';
    const TOKEN = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M1 3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1H1m0 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4zm6 2a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z"/></svg>';

    const fmtTok = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    let html = '<div class="cal-model-rows">';
    for (const [name, ms] of Object.entries(modelStats)) {
        const chips: string[] = [];
        if (ms.reasoning > 0) {
            chips.push(`<span class="cal-chip cal-chip-reasoning">${BRAIN} ${ms.reasoning}</span>`);
        }
        if (ms.toolCalls > 0) {
            chips.push(`<span class="cal-chip cal-chip-tools">${TOOL} ${ms.toolCalls}</span>`);
        }
        if (ms.errors > 0) {
            chips.push(`<span class="cal-chip cal-chip-errors">${WARN} ${ms.errors}</span>`);
        }
        if (ms.estSteps > 0) {
            chips.push(`<span class="cal-chip cal-chip-est">${CHART} +${ms.estSteps}</span>`);
        }
        const totalTok = ms.inputTokens + ms.outputTokens;
        if (totalTok > 0) {
            chips.push(`<span class="cal-chip cal-chip-tokens">${TOKEN} ${fmtTok(totalTok)}</span>`);
        }

        html += `
            <div class="cal-model-row">
                <span class="cal-model-name">${esc(name)}</span>
                <span class="cal-model-chips">${chips.join('')}</span>
            </div>`;
    }
    html += '</div>';
    return html;
}

function buildOverallSummary(store: DailyStore): string {
    const dates = store.getDatesWithData();
    let totalReasoning = 0, totalToolCalls = 0, totalCost = 0, totalCycles = 0;

    for (const date of dates) {
        const record = store.getRecord(date);
        if (!record) { continue; }
        for (const c of record.cycles) {
            totalCycles++;
            totalReasoning += c.totalReasoning;
            totalToolCalls += c.totalToolCalls;
            totalCost += c.estimatedCost || 0;
        }
    }

    return `
        <section class="card">
            <h2>${ICON.chart} ${tBi('All-Time Summary', '历史汇总')}</h2>
            <div class="cal-overview-grid">
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${dates.length}</div>
                    <div class="cal-overview-label">${tBi('Days', '天数')}</div>
                </div>
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${totalCycles}</div>
                    <div class="cal-overview-label">${tBi('Cycles', '周期')}</div>
                </div>
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${totalReasoning}</div>
                    <div class="cal-overview-label">${tBi('Reasoning', '推理')}</div>
                </div>
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${totalToolCalls}</div>
                    <div class="cal-overview-label">${tBi('Tools', '工具')}</div>
                </div>
                ${totalCost > 0 ? `
                <div class="cal-overview-item">
                    <div class="cal-overview-val">${formatCost(totalCost)}</div>
                    <div class="cal-overview-label">${tBi('Total Cost', '总费用')}</div>
                </div>` : ''}
            </div>
        </section>`;
}

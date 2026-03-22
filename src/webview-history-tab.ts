// ─── Quota Tracking Tab Content Builder ──────────────────────────────────────
// Builds HTML for the "Quota Tracking" tab: quota tracking toggle and active
// sessions. Archived history and usage history have been migrated to Calendar.

import { tBi } from './i18n';
import { QuotaTracker, QuotaSession } from './quota-tracker';
import { ICON } from './webview-icons';
import { esc, formatShortTime, formatDuration } from './webview-helpers';

// ─── Public API ──────────────────────────────────────────────────────────────

/** Build the complete Quota Tracking tab HTML. */
export function buildHistoryHtml(tracker?: QuotaTracker): string {
    if (!tracker) {
        return `
            <section class="card empty">
                <h2>${ICON.timeline} ${tBi('Quota Timeline', '额度时间线')}</h2>
                <p class="empty-desc">${tBi(
                    'Quota tracking is not initialized yet.',
                    '额度追踪尚未初始化。',
                )}</p>
            </section>`;
    }

    const isEnabled = tracker.isEnabled();
    const parts: string[] = [];

    // ── Enable/Disable Toggle ──
    parts.push(`
        <section class="card">
            <h2>${ICON.timeline} ${tBi('Quota Timeline', '额度时间线')}</h2>
            <div class="toggle-group">
                <label class="toggle-row" id="quotaTrackingToggle">
                    <input type="checkbox" class="toggle-cb" ${isEnabled ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBi('Enable quota consumption tracking', '启用额度消耗追踪')}</span>
                </label>
            </div>
            <p class="raw-desc">${tBi(
                'Tracks how long it takes to consume model quota from 100% to 0%. Default off.',
                '追踪模型额度从 100% 消耗到 0% 所用时间。默认关闭。',
            )}</p>
        </section>`);

    if (!isEnabled) {
        return parts.join('');
    }

    const activeSessions = tracker.getActiveSessions();
    const history = tracker.getHistory();
    const maxHistory = tracker.getMaxHistory();

    // ── Active Tracking ──
    if (activeSessions.length > 0) {
        const activeCards = activeSessions.map(s => buildSessionTimelineHtml(s, true)).join('');
        parts.push(`
            <section class="card">
                <h2>${ICON.bolt} ${tBi('Active Tracking', '活跃追踪')} (${activeSessions.length})</h2>
                <p class="raw-desc">${tBi(
                    'Currently tracking quota consumption. Tracking starts instantly when quota drops; if quota stays at 100%, it auto-detects usage via reset time drift (~10 min).',
                    '正在追踪额度消耗。额度下降时立即启动；若额度持续 100%，通过重置时间偏移自动检测（约 10 分钟）。',
                )}</p>
                ${activeCards}
            </section>`);
    } else {
        parts.push(`
            <section class="card empty">
                <h2>${ICON.bolt} ${tBi('Active Tracking', '活跃追踪')}</h2>
                <p class="empty-desc">${tBi(
                    'No active quota consumption detected. Tracking starts instantly when quota drops; if quota stays at 100%, it auto-detects usage via reset time drift (~10 min).',
                    '未检测到活跃额度消耗。额度下降时立即启动追踪；若额度持续 100%，通过重置时间偏移自动检测（约 10 分钟）。',
                )}</p>
            </section>`);
    }

    // ── Completed Sessions (history) ──
    if (history.length > 0) {
        const historyCards = history.map(s => buildSessionTimelineHtml(s, false)).join('');
        parts.push(`
            <section class="card">
                <h2>${ICON.clock} ${tBi('Completed Sessions', '已完成会话')} (${history.length}/${maxHistory})</h2>
                ${historyCards}
            </section>`);
    }

    return parts.join('');
}

// ─── Session Timeline ────────────────────────────────────────────────────────

function buildSessionTimelineHtml(session: QuotaSession, isActive: boolean): string {
    const now = Date.now();
    const startMs = new Date(session.startTime).getTime();
    const elapsed = isActive ? (now - startMs) : (session.totalDurationMs ?? 0);

    // Timeline nodes
    const nodes = session.snapshots.map((snap, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === session.snapshots.length - 1 && session.completed;
        const pct = snap.percent;
        const nodeColor = pct <= 20 ? 'var(--color-danger)' : pct < 80 ? 'var(--color-warn)' : 'var(--color-ok)';
        const timeStr = formatShortTime(snap.timestamp);
        const elapsedStr = snap.elapsedMs > 0 ? formatDuration(snap.elapsedMs) : '';

        return `
            <div class="tl-node${isFirst ? ' tl-first' : ''}${isLast ? ' tl-last' : ''}">
                <div class="tl-dot" style="background:${nodeColor}"></div>
                <div class="tl-content">
                    <span class="tl-pct" style="color:${nodeColor}">${pct}%</span>
                    <span class="tl-time">${timeStr}</span>
                    ${elapsedStr ? `<span class="tl-elapsed">${isFirst ? '' : `+${elapsedStr}`}</span>` : ''}
                </div>
            </div>`;
    }).join('');

    // Active pulse indicator
    const activePulse = isActive ? `
        <div class="tl-node tl-active-node">
            <div class="tl-dot tl-pulse"></div>
            <div class="tl-content">
                <span class="tl-pct" style="color:var(--color-info)">${tBi('Tracking...', '追踪中...')}</span>
                <span class="tl-elapsed">${formatDuration(elapsed)}</span>
            </div>
        </div>` : '';

    const statusBadge = session.completed
        ? `<span class="badge ok-badge">${tBi('COMPLETE', '已完成')}</span>`
        : isActive
            ? `<span class="badge info-badge">${tBi('ACTIVE', '追踪中')}</span>`
            : `<span class="badge warn-badge">${tBi('RESET', '已重置')}</span>`;

    return `
        <div class="timeline-card${isActive ? ' active-timeline' : ''}">
            <div class="timeline-header">
                <span class="timeline-model">${esc(session.modelLabel)}</span>
                ${statusBadge}
            </div>
            <div class="timeline-meta">
                <span>${tBi('Start', '开始')}: ${formatShortTime(session.startTime)}</span>
                ${session.endTime ? `<span>${tBi('End', '结束')}: ${formatShortTime(session.endTime)}</span>` : ''}
                <span>${tBi('Duration', '耗时')}: ${formatDuration(elapsed)}</span>
            </div>
            <div class="tl-track">
                ${nodes}
                ${activePulse}
            </div>
        </div>`;
}

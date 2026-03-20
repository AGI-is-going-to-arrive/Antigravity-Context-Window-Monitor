// ─── History Tab Content Builder ─────────────────────────────────────────────
// Builds HTML for the "History" tab: quota tracking toggle, active sessions,
// archived sessions timeline, and history settings.

import { tBi } from './i18n';
import { QuotaTracker, QuotaSession } from './quota-tracker';
import { ICON } from './webview-icons';
import { esc, formatShortTime, formatDuration } from './webview-helpers';

// ─── Public API ──────────────────────────────────────────────────────────────

/** Build the complete History tab HTML. */
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
                    'Currently tracking quota consumption. Updates every ~60s.',
                    '正在追踪额度消耗。约每 60 秒更新。',
                )}</p>
                ${activeCards}
            </section>`);
    } else {
        parts.push(`
            <section class="card empty">
                <h2>${ICON.bolt} ${tBi('Active Tracking', '活跃追踪')}</h2>
                <p class="empty-desc">${tBi(
                    'No active quota consumption detected. Tracking starts when quota drops below 100%.',
                    '未检测到活跃额度消耗。当额度低于 100% 时自动开始追踪。',
                )}</p>
            </section>`);
    }

    // ── Archived History ──
    if (history.length > 0) {
        const historyCards = history.map(s => {
            return `
                <details class="collapsible" id="d-hist-${esc(s.id)}">
                    <summary>
                        <span>${esc(s.modelLabel)}</span>
                        ${s.completed
                            ? `<span class="badge ok-badge">${tBi('DONE', '完成')}</span>`
                            : `<span class="badge warn-badge">${tBi('RESET', '重置')}</span>`}
                        <span class="session-pct-inline">${formatDuration(s.totalDurationMs ?? 0)}</span>
                        <span class="tl-time">${formatShortTime(s.startTime)}</span>
                    </summary>
                    <div class="details-body">
                        ${buildSessionTimelineHtml(s, false)}
                    </div>
                </details>`;
        }).join('');

        parts.push(`
            <section class="card">
                <h2>${ICON.timeline} ${tBi('History', '历史')} (${history.length})</h2>
                ${historyCards}
            </section>`);
    } else {
        parts.push(`
            <section class="card empty">
                <h2>${ICON.timeline} ${tBi('History', '历史')}</h2>
                <p class="empty-desc">${tBi(
                    'No archived quota sessions yet.',
                    '暂无归档的额度消耗记录。',
                )}</p>
            </section>`);
    }

    // History Settings 已迁入 Settings tab

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

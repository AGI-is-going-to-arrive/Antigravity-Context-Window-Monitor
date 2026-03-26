// ─── Quota Tracking Tab Content Builder ──────────────────────────────────────
// Builds HTML for the "Quota Tracking" tab: quota tracking toggle, active
// sessions with progress bars, and completed session history with summary stats.
// Archived history and usage history have been migrated to Calendar.

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
        const activeCards = activeSessions.map(s => buildSessionCard(s, true)).join('');
        parts.push(`
            <section class="card">
                <div class="card-header-row">
                    <h2>${ICON.bolt} ${tBi('Active Tracking', '活跃追踪')} (${activeSessions.length})</h2>
                    <button class="action-btn danger-action qt-clear-active" id="clearActiveTracking">
                        ${ICON.trash} ${tBi('Clear', '清理')}
                    </button>
                </div>
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
        const summaryBar = buildHistorySummary(history, maxHistory);
        const historyCards = history.map(s => buildSessionCard(s, false)).join('');
        parts.push(`
            <section class="card">
                <h2>${ICON.clock} ${tBi('Completed Sessions', '已完成会话')} (${history.length}/${maxHistory})</h2>
                ${summaryBar}
                ${historyCards}
            </section>`);
    }

    return parts.join('');
}

// ─── History Summary Stats ───────────────────────────────────────────────────

function buildHistorySummary(history: QuotaSession[], max: number): string {
    const durations = history
        .map(s => s.totalDurationMs ?? 0)
        .filter(d => d > 0);

    if (durations.length === 0) { return ''; }

    const avgMs = durations.reduce((a, b) => a + b, 0) / durations.length;
    const minMs = Math.min(...durations);
    const maxMs = Math.max(...durations);
    const completedCount = history.filter(s => s.completed).length;
    const resetCount = history.length - completedCount;

    return `
        <div class="qt-summary-grid">
            <div class="qt-summary-item">
                <span class="qt-summary-val">${formatDuration(avgMs)}</span>
                <span class="qt-summary-label">${tBi('Avg Duration', '平均耗时')}</span>
            </div>
            <div class="qt-summary-item">
                <span class="qt-summary-val">${formatDuration(minMs)}</span>
                <span class="qt-summary-label">${tBi('Fastest', '最快')}</span>
            </div>
            <div class="qt-summary-item">
                <span class="qt-summary-val">${formatDuration(maxMs)}</span>
                <span class="qt-summary-label">${tBi('Slowest', '最慢')}</span>
            </div>
            <div class="qt-summary-item">
                <span class="qt-summary-val">${completedCount}<span class="qt-summary-dim">/${history.length}</span></span>
                <span class="qt-summary-label">${tBi('Completed', '耗尽')}</span>
            </div>
            ${resetCount > 0 ? `<div class="qt-summary-item">
                <span class="qt-summary-val qt-summary-warn">${resetCount}</span>
                <span class="qt-summary-label">${tBi('Reset', '重置')}</span>
            </div>` : ''}
        </div>`;
}

// ─── Session Card ────────────────────────────────────────────────────────────

function buildSessionCard(session: QuotaSession, isActive: boolean): string {
    const now = Date.now();
    const startMs = new Date(session.startTime).getTime();
    const elapsed = isActive ? (now - startMs) : (session.totalDurationMs ?? 0);

    // Current percentage (last snapshot)
    const lastSnap = session.snapshots[session.snapshots.length - 1];
    const currentPct = lastSnap?.percent ?? 100;

    // ── Progress bar (horizontal, shows remaining quota) ──
    const barColor = currentPct <= 20 ? 'var(--color-danger)' : currentPct < 80 ? 'var(--color-warn)' : 'var(--color-ok)';
    const progressBar = `
        <div class="qt-progress-wrap">
            <div class="qt-progress-track">
                <div class="qt-progress-fill${isActive ? ' qt-progress-active' : ''}" style="width:${currentPct}%;background:${barColor}"></div>
            </div>
            <span class="qt-progress-label" style="color:${barColor}">${currentPct}%</span>
        </div>`;

    // ── Status badge ──
    const statusBadge = session.completed
        ? `<span class="badge ok-badge">${tBi('COMPLETE', '已完成')}</span>`
        : isActive
            ? `<span class="badge info-badge">${tBi('ACTIVE', '追踪中')}</span>`
            : `<span class="badge warn-badge">${tBi('RESET', '已重置')}</span>`;

    // ── Pool models ──
    const poolBadges = (session.poolModels && session.poolModels.length > 1)
        ? session.poolModels
            .filter(l => l !== session.modelLabel)
            .map(l => `<span class="badge pool-badge">+ ${esc(l)}</span>`)
            .join('')
        : '';

    // ── Meta chips ──
    const metaChips: string[] = [];
    metaChips.push(`<span class="qt-meta-chip">${ICON.clock} ${formatShortTime(session.startTime)}</span>`);
    if (session.endTime) {
        metaChips.push(`<span class="qt-meta-chip">${ICON.clock} ${formatShortTime(session.endTime)}</span>`);
    }
    metaChips.push(`<span class="qt-meta-chip qt-meta-duration">${ICON.timeline} ${formatDuration(elapsed)}</span>`);
    if (session.snapshots.length > 1) {
        metaChips.push(`<span class="qt-meta-chip">${session.snapshots.length} ${tBi('snapshots', '快照')}</span>`);
    }

    // ── Timeline nodes (collapsible if > 6) ──
    const snapshotCount = session.snapshots.length;
    const shouldCollapse = snapshotCount > 6;
    const visibleSnapshots = shouldCollapse
        ? [...session.snapshots.slice(0, 3), ...session.snapshots.slice(-2)]
        : session.snapshots;
    const hiddenCount = shouldCollapse ? snapshotCount - 5 : 0;

    const nodes = visibleSnapshots.map((snap, idx) => {
        // After the first 3, if collapsed, insert a "hidden" marker
        const showHiddenMarker = shouldCollapse && idx === 3;
        const pct = snap.percent;
        const nodeColor = pct <= 20 ? 'var(--color-danger)' : pct < 80 ? 'var(--color-warn)' : 'var(--color-ok)';
        const timeStr = formatShortTime(snap.timestamp);
        const elapsedStr = snap.elapsedMs > 0 ? formatDuration(snap.elapsedMs) : '';

        const hiddenMarkerHtml = showHiddenMarker ? `
            <div class="tl-node tl-hidden-node">
                <div class="tl-dot tl-dot-hidden"></div>
                <div class="tl-content">
                    <span class="tl-pct tl-hidden-label">+${hiddenCount} ${tBi('more', '更多')}</span>
                </div>
            </div>` : '';

        const isFirst = shouldCollapse ? idx === 0 : idx === 0;
        const isLast = (shouldCollapse ? idx === visibleSnapshots.length - 1 : idx === session.snapshots.length - 1) && session.completed;

        return `${hiddenMarkerHtml}
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

    // ── Card accent color based on status ──
    const accentClass = isActive ? 'qt-card-active' : session.completed ? 'qt-card-complete' : 'qt-card-reset';

    return `
        <div class="timeline-card ${accentClass}">
            <div class="timeline-header">
                <span class="timeline-model">${esc(session.modelLabel)}${poolBadges}</span>
                ${statusBadge}
            </div>
            ${progressBar}
            <div class="qt-meta-row">
                ${metaChips.join('')}
            </div>
            <div class="tl-track">
                ${nodes}
                ${activePulse}
            </div>
        </div>`;
}

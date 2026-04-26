// ─── Quota Tracking Tab Content Builder ──────────────────────────────────────
// Builds HTML for the "Quota Tracking" tab: active sessions with progress bars,
// and completed session history with summary stats.
// Archived history and usage history have been migrated to Calendar.

import { tBi } from './i18n';
import { QuotaTracker, QuotaSession } from './quota-tracker';
import { formatResetContext } from './reset-time';
import { ICON } from './webview-icons';
import { esc, formatShortTime, formatDuration } from './webview-helpers';

// ─── Public API ──────────────────────────────────────────────────────────────

/** Build the complete Quota Tracking tab HTML.
 *  @param currentAccountEmail — the currently logged-in account, used for sorting and highlighting. */
export function buildHistoryHtml(tracker?: QuotaTracker, currentAccountEmail?: string): string {
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

    const parts: string[] = [];

    // ── Disabled State ──
    if (!tracker.isEnabled()) {
        parts.push(`
            <section class="card empty">
                <h2>${ICON.timeline} ${tBi('Quota Timeline', '额度时间线')}</h2>
                <p class="empty-desc">${tBi(
            'Quota timeline tracking is currently disabled. Enable it in the Settings tab to start monitoring quota consumption.',
            '额度时间线追踪已关闭。请在「设置」标签页中启用以开始监控额度消耗。',
        )}</p>
                <button class="action-btn" id="goToSettingsFromQuota" style="margin-top:var(--space-2)">
                    ${ICON.shield} ${tBi('Go to Settings', '前往设置')}
                </button>
            </section>`);
        return parts.join('');
    }

    const activeSessions = tracker.getActiveSessions();
    const history = tracker.getHistory();
    const maxHistory = tracker.getMaxHistory();


    // ── Active Tracking ──
    if (activeSessions.length > 0) {
        // Sort: current account sessions first, then by start time (newest first)
        if (currentAccountEmail) {
            activeSessions.sort((a, b) => {
                const aCurrent = a.accountEmail === currentAccountEmail ? 0 : 1;
                const bCurrent = b.accountEmail === currentAccountEmail ? 0 : 1;
                if (aCurrent !== bCurrent) { return aCurrent - bCurrent; }
                return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
            });
        }
        const activeCards = activeSessions.map(s => buildSessionCard(s, true, s.accountEmail === currentAccountEmail)).join('');
        parts.push(`
            <section class="card">
                <div class="card-header-row">
                    <h2>${ICON.bolt} ${tBi('Active Tracking', '活跃追踪')} (${activeSessions.length})</h2>
                    <button class="action-btn danger-action qt-clear-active" id="clearActiveTracking">
                        ${ICON.trash} ${tBi('Clear', '清理')}
                    </button>
                </div>
                <p class="raw-desc">${tBi(
            'Currently tracking quota against the official resetTime. Quota drop starts immediately; 100% models enter tracking when GMTracker confirms actual usage.',
            '正在基于官方 resetTime 追踪额度。额度下降时立即启动；100% 模型在 GMTracker 确认实际调用后开始追踪。',
        )}</p>
                ${activeCards}
            </section>`);
    } else {
        parts.push(`
            <section class="card empty">
                <h2>${ICON.bolt} ${tBi('Active Tracking', '活跃追踪')}</h2>
                <p class="empty-desc">${tBi(
            'No active quota consumption detected. Tracking follows official resetTime and adapts to different quota windows.',
            '未检测到活跃额度消耗。追踪逻辑跟随官方 resetTime，自动适配不同额度窗口。',
        )}</p>
            </section>`);
    }

    // ── Completed Sessions (history) ──
    if (history.length > 0) {
        const summaryBar = buildHistorySummary(history, maxHistory);
        const historyCards = history.map(s => buildSessionCard(s, false)).join('');
        parts.push(`
            <section class="card">
                <div class="card-header-row">
                    <h2>${ICON.clock} ${tBi('Completed Sessions', '已完成会话')} (${history.length}/${maxHistory})</h2>
                    <button class="action-btn danger-action qt-clear-history" id="clearQuotaHistory">
                        ${ICON.trash} ${tBi('Clear', '清理')}
                    </button>
                </div>
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

function buildSessionCard(session: QuotaSession, isActive: boolean, isCurrentAccount = false): string {
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
    if (session.cycleResetTime) {
        metaChips.push(`<span class="qt-meta-chip">${ICON.clock} ${tBi('Reset', '重置')} ${formatResetContext(session.cycleResetTime, { includeSeconds: true })}</span>`);
    }
    if (session.snapshots.length > 1) {
        metaChips.push(`<span class="qt-meta-chip">${session.snapshots.length} ${tBi('snapshots', '快照')}</span>`);
    }
    if (session.accountEmail) {
        const shortName = session.accountEmail.split('@')[0];
        metaChips.push(`<span class="qt-meta-chip" style="background:rgba(130,170,255,0.15);color:rgba(130,170,255,0.9)"><svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-1px;margin-right:2px"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c0-.246-.178-.986-.96-1.728C11.265 10.514 10.065 10 8 10s-3.265.514-4.04 1.268c-.782.742-.96 1.482-.96 1.728z"/></svg> ${esc(shortName)}</span>`);
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

        const isFirst = idx === 0;
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
    const accentClass = isActive
        ? (isCurrentAccount ? 'qt-card-active qt-card-current' : 'qt-card-active')
        : session.completed ? 'qt-card-complete' : 'qt-card-reset';

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

// ─── Activity Tab Content Builder ────────────────────────────────────────────
// Provides HTML + CSS for the "Activity" tab within the main monitor panel.
// This module is a content-only builder — the panel itself is managed by webview-panel.ts.

import { tBi } from './i18n';
import { ActivitySummary, ActivityArchive, ModelActivityStats, CheckpointSnapshot, ConversationBreakdown } from './activity-tracker';
import { esc, formatShortTime as formatTime } from './webview-helpers';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the complete HTML content for the Activity tab pane.
 */
export function buildActivityTabContent(
    summary: ActivitySummary | null,
    _configs?: unknown,
    _quotaTracker?: unknown,
    _archives?: ActivityArchive[],
): string {
    if (!summary) {
        return `<p class="empty-msg">${tBi('Waiting for activity data...', '等待活动数据...')}</p>`;
    }
    return [
        buildSummaryBar(summary),
        buildContextTrend(summary),
        buildModelCards(summary),
        buildToolRanking(summary),
        buildConversationBreakdown(summary),
        buildTimeline(summary),
        buildDistribution(summary),
    ].join('');
}

/**
 * Return CSS styles specific to the Activity tab.
 * Merged into the main panel's <style> block by webview-panel.ts.
 */
export function getActivityTabStyles(): string {
    return `
    /* ─── Activity Tab: Summary Bar ─── */
    .act-summary-bar {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
        gap: var(--space-2);
        padding: var(--space-2);
        margin-bottom: var(--space-4);
    }
    .act-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: var(--space-2) var(--space-1);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        transition: border-color 0.2s cubic-bezier(.4,0,.2,1), box-shadow 0.2s cubic-bezier(.4,0,.2,1);
    }
    @media (hover: hover) {
        .act-stat:hover {
            border-color: rgba(96,165,250,0.5);
            box-shadow: 0 0 8px rgba(96,165,250,0.15);
        }
    }
    .act-stat-icon { color: var(--color-text-dim); }
    .act-stat-icon svg { display: block; }
    .act-stat-val { font-weight: 700; font-size: 1.15em; line-height: 1.2; }
    .act-est { font-weight: 400; font-size: 0.85em; opacity: 0.6; font-style: italic; }
    .act-stat-label { color: var(--color-text-dim); font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.5px; }

    /* ─── Activity Tab: Section Title ─── */
    .act-section-title {
        font-size: 0.95em;
        font-weight: 600;
        margin: var(--space-4) 0 var(--space-2) 0;
        color: var(--color-text-dim);
    }

    /* ─── Activity Tab: Model Cards ─── */
    .act-cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--space-3);
        margin-bottom: var(--space-4);
    }
    .act-model-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        overflow: hidden;
        transition: border-color 0.2s cubic-bezier(.4,0,.2,1);
    }
    @media (hover: hover) {
        .act-model-card:hover { border-color: var(--color-accent); }
    }
    .act-card-header {
        padding: var(--space-2) var(--space-3);
        font-weight: 600;
        font-size: 0.9em;
        background: rgba(255,255,255,0.03);
        border-bottom: 1px solid var(--color-border);
    }
    .act-card-body { padding: var(--space-2) var(--space-3); }
    .act-card-row {
        display: flex;
        justify-content: space-between;
        padding: 2px 0;
        font-size: 0.85em;
    }
    .act-card-row .val { font-weight: 600; }
    .act-card-divider { border-top: 1px solid var(--color-border); margin: var(--space-1) 0; }
    .act-card-footer {
        padding: var(--space-1) var(--space-3) var(--space-2);
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
    }
    .act-tool-tag {
        display: inline-block;
        padding: 1px var(--space-1);
        font-size: 0.75em;
        background: rgba(167,139,250,0.15);
        color: var(--color-accent);
        border-radius: var(--radius-sm);
    }

    /* ─── Activity Tab: Timeline ─── */
    .act-timeline {
        max-height: 360px;
        overflow-y: auto;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-2);
        margin-bottom: var(--space-4);
    }
    .act-tl-item {
        display: flex;
        align-items: flex-start;
        gap: var(--space-1);
        padding: 3px var(--space-1);
        font-size: 0.82em;
        border-bottom: 1px solid rgba(255,255,255,0.03);
        transition: background-color 0.15s cubic-bezier(.4,0,.2,1);
    }
    @media (hover: hover) {
        .act-tl-item:hover { background: rgba(255,255,255,0.04); }
    }
    .act-tl-item:last-child { border-bottom: none; }
    .act-tl-time { color: var(--color-text-dim); flex-shrink: 0; width: 65px; }
    .act-tl-icon { flex-shrink: 0; width: 20px; text-align: center; }
    .act-tl-model { color: var(--color-info); font-weight: 500; flex-shrink: 0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .act-tl-detail { color: var(--color-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .act-tl-user { color: var(--color-ok); font-style: italic; }
    .act-tl-ai-preview { color: var(--color-accent); opacity: 0.8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .act-tl-dur { color: var(--color-text-dim); flex-shrink: 0; margin-left: auto; }
    .act-tl-reasoning .act-tl-icon { color: var(--color-ok); }
    .act-tl-tool .act-tl-icon { color: var(--color-warn); }
    .act-tl-tool-name {
        color: var(--color-accent);
        font-weight: 500;
        flex-shrink: 0;
        background: rgba(167,139,250,0.12);
        padding: 0 var(--space-1);
        border-radius: var(--radius-sm);
        font-size: 0.9em;
        margin-right: var(--space-1);
    }
    .act-tl-step-idx {
        color: var(--color-text-dim);
        opacity: 0.5;
        font-size: 0.8em;
        flex-shrink: 0;
        min-width: 28px;
        text-align: right;
        margin-right: var(--space-1);
        font-variant-numeric: tabular-nums;
    }
    .act-badge { font-size: 0.75em; opacity: 0.7; }
    .act-checkpoint-model { border-color: rgba(255,255,255,0.06); opacity: 0.85; }

    /* ─── Activity Tab: Distribution Note ─── */
    .act-dist-note {
        font-size: 0.8em;
        color: var(--color-warn);
        opacity: 0.7;
        margin-top: var(--space-2);
        padding: var(--space-1) var(--space-2);
        border-left: 2px solid var(--color-warn);
        line-height: 1.4;
    }

    /* ─── Activity Tab: Archive History ─── */
    .act-archive-item {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-2) var(--space-3);
        margin-bottom: var(--space-2);
        transition: border-color 0.2s cubic-bezier(.4,0,.2,1);
    }
    @media (hover: hover) {
        .act-archive-item:hover { border-color: var(--color-accent); }
    }
    .act-archive-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .act-archive-time { color: var(--color-text-dim); font-size: 0.85em; }
    .act-archive-total { font-weight: 600; font-size: 0.9em; }
    .act-archive-models {
        margin-top: var(--space-2);
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }
    .act-archive-model-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: 0.82em;
        color: var(--color-text-dim);
    }
    .act-archive-model-name {
        color: var(--color-text);
        font-weight: 500;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 200px;
    }
    .act-archive-model-stats {
        display: flex;
        gap: var(--space-2);
        margin-left: auto;
        white-space: nowrap;
    }

    /* ─── Activity Tab: Distribution ─── */
    .act-dist-container {
        display: flex;
        align-items: center;
        gap: var(--space-6);
        padding: var(--space-3);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        margin-bottom: var(--space-4);
    }
    .act-donut-chart { flex-shrink: 0; }
    .act-dist-legend { flex: 1; }
    .act-legend-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 2px 0;
        font-size: 0.85em;
    }
    .act-legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
    }
    .act-legend-pct { color: var(--color-text-dim); margin-left: auto; }

    /* ─── Activity Tab: Context Trend Chart ─── */
    .act-trend-container {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-3);
        margin-bottom: var(--space-4);
    }
    .act-trend-svg { width: 100%; display: block; }
    .act-trend-labels {
        display: flex;
        justify-content: space-between;
        font-size: 0.75em;
        color: var(--color-text-dim);
        margin-top: var(--space-1);
    }
    .act-compress-note { color: #f87171; margin-left: var(--space-2); font-size: 0.85em; }

    /* ─── Activity Tab: Tool Ranking ─── */
    .act-rank-list { padding: 0; margin: 0 0 var(--space-4) 0; list-style: none; }
    .act-rank-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 3px 0;
        font-size: 0.85em;
    }
    .act-rank-name {
        flex-shrink: 0;
        min-width: 100px;
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--color-text);
    }
    .act-rank-bar-bg {
        flex: 1;
        height: 14px;
        background: rgba(255,255,255,0.06);
        border-radius: var(--radius-sm);
        overflow: hidden;
    }
    .act-rank-bar {
        display: block;
        height: 100%;
        border-radius: var(--radius-sm);
        transition: width 0.3s cubic-bezier(.4,0,.2,1);
    }
    .act-rank-count { flex-shrink: 0; min-width: 36px; text-align: right; font-weight: 600; font-size: 0.85em; }

    /* Tool ranking color classes */
    .act-rank-c0 .act-rank-bar { background: #60a5fa; } .act-rank-c0 .act-rank-count { color: #60a5fa; }
    .act-rank-c1 .act-rank-bar { background: #34d399; } .act-rank-c1 .act-rank-count { color: #34d399; }
    .act-rank-c2 .act-rank-bar { background: #fbbf24; } .act-rank-c2 .act-rank-count { color: #fbbf24; }
    .act-rank-c3 .act-rank-bar { background: #f87171; } .act-rank-c3 .act-rank-count { color: #f87171; }
    .act-rank-c4 .act-rank-bar { background: #a78bfa; } .act-rank-c4 .act-rank-count { color: #a78bfa; }
    .act-rank-c5 .act-rank-bar { background: #fb923c; } .act-rank-c5 .act-rank-count { color: #fb923c; }
    .act-rank-c6 .act-rank-bar { background: #2dd4bf; } .act-rank-c6 .act-rank-count { color: #2dd4bf; }
    .act-rank-c7 .act-rank-bar { background: #e879f9; } .act-rank-c7 .act-rank-count { color: #e879f9; }
    .act-rank-c8 .act-rank-bar { background: #38bdf8; } .act-rank-c8 .act-rank-count { color: #38bdf8; }
    .act-rank-c9 .act-rank-bar { background: #4ade80; } .act-rank-c9 .act-rank-count { color: #4ade80; }

    /* ─── Activity Tab: Conversation Breakdown ─── */
    .act-conv-list {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-2);
        margin-bottom: var(--space-4);
    }
    .act-conv-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 3px var(--space-1);
        font-size: 0.82em;
        border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .act-conv-item:last-child { border-bottom: none; }
    .act-conv-id {
        font-family: monospace;
        font-size: 0.85em;
        color: var(--color-text-dim);
        flex-shrink: 0;
    }
    .act-conv-stats { margin-left: auto; display: flex; gap: var(--space-3); white-space: nowrap; }
    .act-conv-stats span { font-weight: 500; }

    `;
}

// ─── Section Builders ────────────────────────────────────────────────────────

function buildSummaryBar(s: ActivitySummary): string {
    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    // Session duration
    let durText = '';
    try {
        const ms = Date.now() - new Date(s.sessionStartTime).getTime();
        if (ms > 0) {
            const mins = Math.floor(ms / 60000);
            const hrs = Math.floor(mins / 60);
            durText = hrs > 0 ? `${hrs}h${mins % 60}m` : `${mins}m`;
        }
    } catch { durText = '-'; }

    return `
    <div class="act-summary-bar">
        ${durText ? `<div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></span><span class="act-stat-val">${durText}</span><span class="act-stat-label">${tBi('Session', '会话')}</span></div>` : ''}
        <div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><span class="act-stat-val">${s.totalUserInputs}</span><span class="act-stat-label">${tBi('Msgs', '消息')}</span></div>
        <div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z"/><path d="M9 17h6M10 21h4"/></svg></span><span class="act-stat-val">${s.totalReasoning}</span><span class="act-stat-label">${tBi('Think', '推理')}</span></div>
        <div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span><span class="act-stat-val">${s.totalToolCalls}</span><span class="act-stat-label">${tBi('Tools', '工具')}</span></div>
        <div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></span><span class="act-stat-val">${s.totalErrors}</span><span class="act-stat-label">${tBi('Err', '错误')}</span></div>
        ${s.totalCheckpoints > 0 ? `<div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2z"/><path d="M9 21V9h6v12"/></svg></span><span class="act-stat-val">${s.totalCheckpoints}</span><span class="act-stat-label">${tBi('CP', '检查点')}</span></div>` : ''}
        ${s.estSteps > 0 ? `<div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg></span><span class="act-stat-val"><span class="act-est">+${s.estSteps}</span></span><span class="act-stat-label">${tBi('Est.', '推算')}</span></div>` : ''}
        <div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M5 10l7 7 7-7"/></svg></span><span class="act-stat-val">${fmt(s.totalInputTokens)}</span><span class="act-stat-label">${tBi('In', '输入')}</span></div>
        <div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V9M5 14l7-7 7 7"/></svg></span><span class="act-stat-val">${fmt(s.totalOutputTokens)}</span><span class="act-stat-label">${tBi('Out', '输出')}</span></div>
        ${s.totalToolReturnTokens > 0 ? `<div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 0 1 0 8h-1"/></svg></span><span class="act-stat-val">${fmt(s.totalToolReturnTokens)}</span><span class="act-stat-label">${tBi('Return', '返回')}</span></div>` : ''}
    </div>`;
}

function buildContextTrend(s: ActivitySummary): string {
    const history = s.checkpointHistory;
    if (!history || history.length < 2) { return ''; }

    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const W = 380, H = 100, PAD = 4;
    const maxTok = Math.max(...history.map(h => h.inputTokens));
    if (maxTok <= 0) { return ''; }

    const xStep = (W - PAD * 2) / (history.length - 1);
    const yScale = (v: number) => H - PAD - ((v / maxTok) * (H - PAD * 2));

    // Build polyline points
    const points = history.map((h, i) => `${PAD + i * xStep},${yScale(h.inputTokens)}`).join(' ');
    // Build area polygon (close to bottom)
    const areaPoints = `${PAD},${H - PAD} ${points} ${PAD + (history.length - 1) * xStep},${H - PAD}`;

    // Compression markers
    let markers = '';
    for (let i = 0; i < history.length; i++) {
        if (history[i].compressed) {
            const cx = PAD + i * xStep;
            const cy = yScale(history[i].inputTokens);
            markers += `<circle cx="${cx}" cy="${cy}" r="4" fill="#f87171" stroke="var(--color-bg)" stroke-width="1.5"/>`;
        }
    }

    const compressCount = history.filter(h => h.compressed).length;
    const compressNote = compressCount > 0
        ? `<span class="act-compress-note">● ${compressCount} ${tBi('compression', '压缩')}</span>` : '';

    return `
    <h2 class="act-section-title">${tBi('Context Growth', '上下文增长')}${compressNote}</h2>
    <div class="act-trend-container">
        <svg class="act-trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
            <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#60a5fa" stop-opacity="0.3"/><stop offset="100%" stop-color="#60a5fa" stop-opacity="0.02"/></linearGradient></defs>
            <polygon points="${areaPoints}" fill="url(#trendFill)" />
            <polyline points="${points}" fill="none" stroke="#60a5fa" stroke-width="1.5" stroke-linejoin="round"/>
            ${markers}
        </svg>
        <div class="act-trend-labels"><span>${fmt(history[0].inputTokens)}</span><span>${fmt(history[history.length - 1].inputTokens)}</span></div>
    </div>`;
}

function buildToolRanking(s: ActivitySummary): string {
    const entries = Object.entries(s.globalToolStats).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (entries.length === 0) { return ''; }

    const max = entries[0][1];
    let html = `<h2 class="act-section-title">${tBi('Tool Usage', '工具排行')}</h2><ul class="act-rank-list">`;
    for (let i = 0; i < entries.length; i++) {
        const [name, count] = entries[i];
        const pct = Math.round((count / max) * 100);
        const ci = i % 10;
        html += `<li class="act-rank-item act-rank-c${ci}">
            <span class="act-rank-name">${esc(name)}</span>
            <span class="act-rank-bar-bg"><span class="act-rank-bar" style="width:${pct}%"></span></span>
            <span class="act-rank-count">${count}</span>
        </li>`;
    }
    html += `</ul>`;
    return html;
}

function buildConversationBreakdown(s: ActivitySummary): string {
    const items = s.conversationBreakdown;
    if (!items || items.length === 0) { return ''; }

    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    let html = `<h2 class="act-section-title">${tBi('Conversations', '对话分布')}</h2><div class="act-conv-list">`;
    for (const cb of items) {
        html += `<div class="act-conv-item">
            <span class="act-conv-id">${esc(cb.id)}</span>
            <span class="act-conv-stats">
                <span>${cb.steps} ${tBi('steps', '步')}</span>
                <span>${fmt(cb.inputTokens)} in</span>
                <span>${fmt(cb.outputTokens)} out</span>
            </span>
        </div>`;
    }
    html += `</div>`;
    return html;
}

function buildModelCards(s: ActivitySummary): string {
    const entries = Object.entries(s.modelStats).sort((a, b) => b[1].totalSteps - a[1].totalSteps);
    if (entries.length === 0) { return ''; }

    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const fmtMs = (ms: number) => ms <= 0 ? '-' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

    let html = `<h2 class="act-section-title">${tBi('Model Stats', '模型统计')}</h2>`;

    // Accuracy note: shown when estimated steps exist
    const totalEst = entries.reduce((a, [, ms]) => a + ms.estSteps, 0);
    if (totalEst > 0) {
        html += `<div class="act-dist-note">${tBi(
            `Reasoning, tool calls, and error counts are precisely recorded. ${totalEst} steps beyond API window are estimated — see 📊 Est. above.`,
            `推理回复、工具调用、错误等数据为精准记录；其中 ${totalEst} 步超出 API 窗口范围，为估算值（详见上方 📊 推算）。`
        )}</div>`;
    }

    html += `<div class="act-cards-grid">`;
    for (const [name, ms] of entries) {
        const isCheckpointOnly = ms.reasoning === 0 && ms.toolCalls === 0 && ms.checkpoints > 0 && ms.estSteps === 0;
        const avgThink = ms.reasoning > 0 ? fmtMs(Math.round(ms.thinkingTimeMs / ms.reasoning)) : '-';
        const toolList = Object.entries(ms.toolBreakdown)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([t, n]) => `<span class="act-tool-tag">${t}×${n}</span>`)
            .join('');

        const actualSteps = ms.reasoning + ms.toolCalls + ms.errors + ms.checkpoints;
        const totalLabel = ms.estSteps > 0
            ? tBi(`${actualSteps}+${ms.estSteps} steps`, `${actualSteps}+${ms.estSteps} 步`)
            : tBi(`${actualSteps} steps`, `共 ${actualSteps} 步`);

        html += `
        <div class="act-model-card${isCheckpointOnly ? ' act-checkpoint-model' : ''}">
            <div class="act-card-header">${esc(name)}${isCheckpointOnly ? ' <span class="act-badge">💾</span>' : ''} <span class="act-badge act-badge-total">${totalLabel}</span></div>
            <div class="act-card-body">
                ${ms.reasoning > 0 ? `<div class="act-card-row"><span>🧠 ${tBi('Reasoning', '推理回复')}</span><span class="val">${ms.reasoning}</span></div>` : ''}
                ${ms.toolCalls > 0 ? `<div class="act-card-row"><span>⚡ ${tBi('Tools', '工具')}</span><span class="val">${ms.toolCalls}</span></div>` : ''}
                ${ms.checkpoints > 0 ? `<div class="act-card-row"><span>💾 ${tBi('Checkpoints', '检查点')}</span><span class="val">${ms.checkpoints}</span></div>` : ''}
                ${ms.errors > 0 ? `<div class="act-card-row"><span>❌ ${tBi('Errors', '错误')}</span><span class="val">${ms.errors}</span></div>` : ''}
                ${ms.estSteps > 0 ? `<div class="act-card-row"><span>📊 ${tBi('Est. Steps', '推算步数')}</span><span class="val act-est">+${ms.estSteps}</span></div>` : ''}
                ${ms.reasoning > 0 ? `
                <div class="act-card-row"><span>⏱ ${tBi('Avg Think', '平均思考')}</span><span class="val">${avgThink}</span></div>
                <div class="act-card-row"><span>∑ ${tBi('Think', '推理')}</span><span class="val">${fmtMs(ms.thinkingTimeMs)}</span></div>
                ` : ''}
                ${ms.toolCalls > 0 ? `<div class="act-card-row"><span>∑ ${tBi('Tool', '工具')}</span><span class="val">${fmtMs(ms.toolTimeMs)}</span></div>` : ''}
                ${ms.inputTokens > 0 || ms.outputTokens > 0 ? `
                <div class="act-card-divider"></div>
                <div class="act-card-row"><span>🪙 ${tBi('In', '输入')}</span><span class="val">${fmt(ms.inputTokens)}</span></div>
                <div class="act-card-row"><span>🪙 ${tBi('Out', '输出')}</span><span class="val">${fmt(ms.outputTokens)}</span></div>
                ` : ''}
            </div>
            ${toolList ? `<div class="act-card-footer">${toolList}</div>` : ''}
        </div>`;
    }
    html += `</div>`;

    // Sub-agent token display
    if (s.subAgentTokens && s.subAgentTokens.length > 0) {
        html += `<h2 class="act-section-title">${tBi('Sub-Agent Tokens', '子智能体消耗')}</h2>`;
        html += `<div class="act-cards-grid">`;
        for (const sa of s.subAgentTokens) {
            html += `
            <div class="act-model-card act-checkpoint-model">
                <div class="act-card-header"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><path d="M12 2a4 4 0 0 1 4 4v2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h2V6a4 4 0 0 1 4-4z"/><circle cx="12" cy="15" r="2"/></svg>${esc(sa.displayName)} <span class="act-badge">${tBi(`${sa.count} checkpoints`, `${sa.count} 检查点`)}</span></div>
                <div class="act-card-body">
                    <div class="act-card-row"><span>🪙 ${tBi('In', '输入')}</span><span class="val">${fmt(sa.inputTokens)}</span></div>
                    <div class="act-card-row"><span>🪙 ${tBi('Out', '输出')}</span><span class="val">${fmt(sa.outputTokens)}</span></div>
                </div>
            </div>`;
        }
        html += `</div>`;
    }

    return html;
}

function buildTimeline(s: ActivitySummary): string {
    const events = s.recentSteps.slice(-30).reverse();
    if (events.length === 0) { return ''; }

    let html = `<h2 class="act-section-title">${tBi('Recent Activity', '最近操作')}</h2><div class="act-timeline">`;
    for (const e of events) {
        const time = formatTime(e.timestamp);
        const dur = e.durationMs > 0 ? `<span class="act-tl-dur">${e.durationMs < 1000 ? e.durationMs + 'ms' : (e.durationMs / 1000).toFixed(1) + 's'}</span>` : '';
        let detail = '';
        if (e.userInput) { detail = `<span class="act-tl-user">"${esc(e.userInput)}"</span>`; }
        else if (e.toolName && e.detail) {
            detail = `<span class="act-tl-tool-name">${esc(e.toolName)}</span><span class="act-tl-detail">${esc(e.detail)}</span>`;
        }
        else if (e.toolName) {
            detail = `<span class="act-tl-tool-name">${esc(e.toolName)}</span>`;
        }
        else if (e.aiResponse) {
            detail = `<span class="act-tl-ai-preview">${esc(e.aiResponse)}</span>`;
        }
        else if (e.detail) { detail = `<span class="act-tl-detail">${esc(e.detail)}</span>`; }

        const stepIdx = e.stepIndex !== undefined ? `<span class="act-tl-step-idx">#${e.stepIndex}</span>` : '';

        html += `
        <div class="act-tl-item act-tl-${e.category}">
            <span class="act-tl-time">${time}</span>
            ${stepIdx}
            <span class="act-tl-icon">${e.icon}</span>
            ${e.model ? `<span class="act-tl-model">${esc(e.model)}</span>` : ''}
            ${detail}
            ${dur}
        </div>`;
    }
    html += `</div>`;
    return html;
}

function buildDistribution(s: ActivitySummary): string {
    // Use actual reasoning + toolCalls + errors + estSteps for total AI usage
    const getUsage = (ms: ModelActivityStats) =>
        ms.reasoning + ms.toolCalls + ms.errors + ms.estSteps;
    const entries = Object.entries(s.modelStats).filter(([, ms]) => getUsage(ms) > 0);
    if (entries.length === 0) { return ''; }

    const total = entries.reduce((a, [, ms]) => a + getUsage(ms), 0);
    const colors = ['#60a5fa', '#4ade80', '#facc15', '#f87171', '#a78bfa', '#fb923c'];

    let html = `<h2 class="act-section-title">${tBi('Model Distribution', '模型分布')}</h2><div class="act-dist-container">`;

    const size = 140;
    const r = 55;
    const cx = size / 2;
    const cy = size / 2;
    const circumference = 2 * Math.PI * r;
    let offset = 0;

    html += `<svg class="act-donut-chart" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`;
    for (let i = 0; i < entries.length; i++) {
        const [, ms] = entries[i];
        const pct = getUsage(ms) / total;
        const len = pct * circumference;
        html += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="16" stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
        offset += len;
    }
    html += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="var(--color-text)" font-size="18" font-weight="600">${total}</text>`;
    html += `</svg>`;

    html += `<div class="act-dist-legend">`;
    for (let i = 0; i < entries.length; i++) {
        const [name, ms] = entries[i];
        const usage = getUsage(ms);
        const pct = ((usage / total) * 100).toFixed(1);
        html += `<div class="act-legend-item"><span class="act-legend-dot" style="background:${colors[i % colors.length]}"></span>${esc(name)} <span class="act-legend-pct">${pct}% (${usage})</span></div>`;
    }
    html += `</div>`;

    html += `</div>`;
    return html;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
// esc() and formatTime() are now imported from webview-helpers.ts


// ─── Archive History ─────────────────────────────────────────────────────────

export function buildArchiveHistory(archives?: ActivityArchive[]): string {
    if (!archives || archives.length === 0) { return ''; }

    let html = `<div class="act-section">
        <h3 class="act-section-title">${tBi('📋 Usage History', '📋 使用历史')}</h3>`;

    for (const a of archives) {
        const start = formatDateShort(a.startTime);
        const end = formatDateShort(a.endTime);
        const s = a.summary;

        // Compute total steps and build per-model rows
        let totalSteps = 0;
        let estTotal = 0;
        const modelRows: string[] = [];
        const entries = Object.entries(s.modelStats)
            .sort((a, b) => b[1].totalSteps - a[1].totalSteps);

        for (const [name, ms] of entries) {
            totalSteps += ms.totalSteps;
            estTotal += ms.estSteps;
            const stats: string[] = [];
            if (ms.reasoning > 0) { stats.push(`🧠${ms.reasoning}`); }
            if (ms.toolCalls > 0) { stats.push(`⚡${ms.toolCalls}`); }
            if (ms.errors > 0) { stats.push(`❌${ms.errors}`); }
            if (ms.estSteps > 0) { stats.push(`📊+${ms.estSteps}`); }
            if (stats.length > 0) {
                modelRows.push(`<div class="act-archive-model-row">
                    <span class="act-archive-model-name">${esc(name)}</span>
                    <span class="act-archive-model-stats">${stats.join(' ')}</span>
                </div>`);
            }
        }

        const totalLabel = estTotal > 0
            ? `${totalSteps - estTotal}+${estTotal}`
            : `${totalSteps}`;

        html += `
        <div class="act-archive-item">
            <div class="act-archive-header">
                <span class="act-archive-time">${start} → ${end}</span>
                <span class="act-archive-total">${totalLabel} ${tBi('steps', '步')}</span>
            </div>
            ${modelRows.length > 0
                ? `<div class="act-archive-models">${modelRows.join('')}</div>`
                : ''}
        </div>`;
    }

    html += `</div>`;
    return html;
}

export function formatDateShort(iso: string): string {
    try {
        const d = new Date(iso);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mi = String(d.getMinutes()).padStart(2, '0');
        return `${mm}/${dd} ${hh}:${mi}`;
    } catch { return iso; }
}

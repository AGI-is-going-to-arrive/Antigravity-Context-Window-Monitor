// ─── GM Data Tab Content Builder ─────────────────────────────────────────────
// Provides HTML for the "GM Data" tab within the main monitor panel.
// Renders generatorMetadata-based statistics for comparison with Activity tab.
// Reuses existing act-* CSS classes from activity-panel.ts for visual consistency.

import { tBi } from './i18n';
import { GMSummary, GMModelStats, GMConversationData } from './gm-tracker';
import { esc } from './webview-helpers';

// ─── Public API ──────────────────────────────────────────────────────────────

export function buildGMTabContent(summary: GMSummary | null): string {
    if (!summary || summary.totalCalls === 0) {
        return `<p class="empty-msg">${tBi('Waiting for GM data...', '等待 GM 数据...')}</p>`;
    }

    return [
        buildGMSummaryBar(summary),
        buildGMModelCards(summary),

        `<div class="act-two-col">
            <div class="act-col">${buildPerformanceChart(summary)}</div>
            <div class="act-col">${buildCacheEfficiency(summary)}</div>
        </div>`,
        `<div class="act-two-col">
            <div class="act-col">${buildContextGrowth(summary)}</div>
            <div class="act-col">${buildConversations(summary)}</div>
        </div>`,

    ].join('');
}

export function getGMTabStyles(): string {
    // Reuse act-* CSS from activity-panel.ts.
    // Only add GM-specific styles here.
    return `
    .gm-perf-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: var(--space-2);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-3);
        margin-bottom: var(--space-4);
    }
    .gm-perf-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-sm);
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.04);
    }
    .gm-perf-label {
        font-size: 0.72em;
        color: var(--color-text-dim);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .gm-perf-val {
        font-weight: 700;
        font-size: 1.05em;
    }
    .gm-perf-sub {
        font-size: 0.75em;
        color: var(--color-text-dim);
    }
    .gm-cache-bar-bg {
        height: 20px;
        background: rgba(255,255,255,0.06);
        border-radius: var(--radius-sm);
        overflow: hidden;
        margin-bottom: var(--space-1);
    }
    .gm-cache-bar {
        height: 100%;
        border-radius: var(--radius-sm);
        background: linear-gradient(90deg, #3b82f6, #60a5fa);
        transition: width 0.3s cubic-bezier(.4,0,.2,1);
    }
    .gm-badge-real {
        display: inline-block;
        font-size: 0.65em;
        padding: 1px var(--space-1);
        border-radius: var(--radius-sm);
        background: rgba(52,211,153,0.15);
        color: #34d399;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        vertical-align: middle;
        margin-left: var(--space-1);
    }
    .gm-provider-tag {
        display: inline-block;
        font-size: 0.72em;
        padding: 1px var(--space-1);
        border-radius: var(--radius-sm);
        background: rgba(96,165,250,0.1);
        color: var(--color-info);
        margin-top: var(--space-1);
    }

    `;
}

// ─── Section Builders ────────────────────────────────────────────────────────

function buildGMSummaryBar(s: GMSummary): string {
    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const models = Object.keys(s.modelBreakdown).length;

    return `
    <div class="act-summary-bar">
        <div class="act-stat" data-tooltip="${tBi('Total LLM API calls', 'LLM API 调用总次数')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span><span class="act-stat-val">${s.totalCalls}</span><span class="act-stat-label">${tBi('Calls', '调用')}</span></div>
        <div class="act-stat" data-tooltip="${tBi('Steps precisely attributed to models', '精确归属到模型的步骤数')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span><span class="act-stat-val">${s.totalStepsCovered}</span><span class="act-stat-label">${tBi('Steps', '步骤')}</span></div>
        <div class="act-stat" data-tooltip="${tBi('Number of distinct models used', '使用的不同模型数')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg></span><span class="act-stat-val">${models}</span><span class="act-stat-label">${tBi('Models', '模型')}</span></div>
        <div class="act-stat" data-tooltip="${tBi('Total input tokens consumed', '总输入 token')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M5 10l7 7 7-7"/></svg></span><span class="act-stat-val">${fmt(s.totalInputTokens)}</span><span class="act-stat-label">${tBi('In', '输入')}</span></div>
        <div class="act-stat" data-tooltip="${tBi('Total output tokens generated', '总输出 token')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V9M5 14l7-7 7 7"/></svg></span><span class="act-stat-val">${fmt(s.totalOutputTokens)}</span><span class="act-stat-label">${tBi('Out', '输出')}</span></div>
        <div class="act-stat" data-tooltip="${tBi('Total cache read tokens', '总缓存读取 token')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><span class="act-stat-val">${fmt(s.totalCacheRead)}</span><span class="act-stat-label">${tBi('Cache', '缓存')}</span></div>
        ${s.totalCredits > 0 ? `<div class="act-stat" data-tooltip="${tBi('Total credits consumed', '总积分消耗')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg></span><span class="act-stat-val">${s.totalCredits}</span><span class="act-stat-label">${tBi('Credits', '积分')}</span></div>` : ''}
    </div>`;
}

function buildGMModelCards(s: GMSummary): string {
    const entries = Object.entries(s.modelBreakdown).sort((a, b) => b[1].stepsCovered - a[1].stepsCovered);
    if (entries.length === 0) { return ''; }

    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const fmtSec = (n: number) => n <= 0 ? '-' : n < 1 ? `${(n * 1000).toFixed(0)}ms` : `${n.toFixed(2)}s`;

    const ICONS = {
        call: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        steps: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
        ttft: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
        stream: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
        coin: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
        cache: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2z"/><path d="M9 21V9h6v12"/></svg>`,
    };

    let html = `<h2 class="act-section-title">${tBi('Model Stats', '模型统计')} <span class="gm-badge-real">${tBi('Precise', '精确')}</span></h2>`;
    html += `<div class="act-cards-grid">`;

    for (const [name, ms] of entries) {
        const providerShort = ms.apiProvider.replace('API_PROVIDER_', '').replace(/_/g, ' ');

        html += `
        <div class="act-model-card">
            <div class="act-card-header">${esc(name)} <span class="act-badge">${ms.callCount} ${tBi('calls', '调用')}</span></div>
            <div class="act-card-body">
                <div class="act-card-row"><span>${ICONS.steps} <span>${tBi('Steps', '步骤')}</span></span><span class="val">${ms.stepsCovered}</span></div>
                <div class="act-card-row"><span>${ICONS.ttft} <span>${tBi('Avg TTFT', '平均 TTFT')}</span></span><span class="val">${fmtSec(ms.avgTTFT)}</span></div>
                <div class="act-card-row"><span>${ICONS.stream} <span>${tBi('Avg Stream', '平均流速')}</span></span><span class="val">${fmtSec(ms.avgStreaming)}</span></div>
                <div class="act-card-divider"></div>
                <div class="act-card-row"><span>${ICONS.coin} <span>${tBi('In', '输入')}</span></span><span class="val">${fmt(ms.totalInputTokens)}</span></div>
                <div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Out', '输出')}</span></span><span class="val">${fmt(ms.totalOutputTokens)}</span></div>
                ${ms.totalThinkingTokens > 0 ? `<div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Think', '思考')}</span></span><span class="val">${fmt(ms.totalThinkingTokens)}</span></div>` : ''}
                <div class="act-card-row"><span>${ICONS.cache} <span>${tBi('Cache', '缓存')}</span></span><span class="val">${fmt(ms.totalCacheRead)}</span></div>
                ${ms.totalCredits > 0 ? `<div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Credits', '积分')}</span></span><span class="val">${ms.totalCredits}</span></div>` : ''}
            </div>
            <div class="act-card-footer">
                ${ms.responseModel ? `<span class="act-tool-tag">${esc(ms.responseModel)}</span>` : ''}
                ${providerShort ? `<span class="gm-provider-tag">${esc(providerShort)}</span>` : ''}
                <span class="act-tool-tag">${tBi('Cache', '缓存')} ${(ms.cacheHitRate * 100).toFixed(0)}%</span>
            </div>
        </div>`;
    }
    html += `</div>`;
    return html;
}

function buildPerformanceChart(s: GMSummary): string {
    const entries = Object.entries(s.modelBreakdown).filter(([, ms]) => ms.avgTTFT > 0);
    if (entries.length === 0) { return ''; }

    const fmtSec = (n: number) => n <= 0 ? '-' : `${n.toFixed(2)}s`;

    let html = `<h2 class="act-section-title">${tBi('Performance Baseline', '性能基线')}</h2><div class="gm-perf-grid">`;

    for (const [name, ms] of entries) {
        html += `
        <div class="gm-perf-item">
            <span class="gm-perf-label">${esc(name)}</span>
            <span class="gm-perf-val">${fmtSec(ms.avgTTFT)}</span>
            <span class="gm-perf-sub">TTFT avg (${fmtSec(ms.minTTFT)}–${fmtSec(ms.maxTTFT)})</span>
        </div>
        <div class="gm-perf-item">
            <span class="gm-perf-label">${esc(name)} ${tBi('Stream', '流速')}</span>
            <span class="gm-perf-val">${fmtSec(ms.avgStreaming)}</span>
            <span class="gm-perf-sub">${ms.callCount} ${tBi('samples', '样本')}</span>
        </div>`;
    }
    html += `</div>`;
    return html;
}

function buildCacheEfficiency(s: GMSummary): string {
    const entries = Object.entries(s.modelBreakdown).filter(([, ms]) => ms.totalInputTokens > 0);
    if (entries.length === 0) { return ''; }

    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    let html = `<h2 class="act-section-title">${tBi('Cache Efficiency', '缓存效率')}</h2>`;

    for (const [name, ms] of entries) {
        const ratio = ms.totalInputTokens > 0 ? ms.totalCacheRead / ms.totalInputTokens : 0;
        const pct = Math.min(ratio * 10, 100); // Scale: ratio 10x = 100% bar

        html += `
        <div style="margin-bottom:var(--space-3)">
            <div style="display:flex;justify-content:space-between;font-size:0.85em;margin-bottom:var(--space-1)">
                <span>${esc(name)}</span>
                <span style="color:var(--color-info);font-weight:600">${ratio.toFixed(1)}× ${tBi('cache ratio', '缓存倍率')}</span>
            </div>
            <div class="gm-cache-bar-bg"><div class="gm-cache-bar" style="width:${pct.toFixed(1)}%"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:0.75em;color:var(--color-text-dim)">
                <span>${tBi('Input', '输入')}: ${fmt(ms.totalInputTokens)}</span>
                <span>${tBi('Cache Read', '缓存读取')}: ${fmt(ms.totalCacheRead)}</span>
            </div>
        </div>`;
    }
    return html;
}

function buildContextGrowth(s: GMSummary): string {
    const data = s.contextGrowth;
    if (!data || data.length < 2) { return ''; }

    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const W = 380, H = 160, PAD = 6;
    const maxTok = Math.max(...data.map(d => d.tokens));
    if (maxTok <= 0) { return ''; }

    const xStep = (W - PAD * 2) / (data.length - 1);
    const yScale = (v: number) => H - PAD - ((v / maxTok) * (H - PAD * 2));

    const points = data.map((d, i) => `${PAD + i * xStep},${yScale(d.tokens)}`).join(' ');
    const areaPoints = `${PAD},${H - PAD} ${points} ${PAD + (data.length - 1) * xStep},${H - PAD}`;

    return `
    <h2 class="act-section-title">${tBi('Context Growth', '上下文增长')} <span class="gm-badge-real">${tBi('Per-Call', '每次调用')}</span></h2>
    <div class="act-trend-container">
        <svg class="act-trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
            <defs><linearGradient id="gmTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.5"/><stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.1"/></linearGradient></defs>
            <polygon points="${areaPoints}" fill="url(#gmTrendFill)" />
            <polyline points="${points}" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linejoin="round"/>
        </svg>
        <div class="act-trend-labels"><span>${fmt(data[0].tokens)}</span><span>${data.length} ${tBi('calls', '调用')}</span><span>${fmt(data[data.length - 1].tokens)}</span></div>
    </div>`;
}

function buildConversations(s: GMSummary): string {
    const convs = s.conversations.filter(c => c.calls.length > 0);
    if (convs.length === 0) { return ''; }

    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    let html = `<h2 class="act-section-title">${tBi('Conversations', '对话分布')}</h2><div class="act-conv-list">`;
    for (const c of convs) {
        const title = c.title.length > 30 ? c.title.substring(0, 27) + '...' : c.title;
        const covPct = (c.coverageRate * 100).toFixed(0);
        let totalIn = 0, totalOut = 0;
        for (const call of c.calls) { totalIn += call.inputTokens; totalOut += call.outputTokens; }

        html += `<div class="act-conv-item">
            <span class="act-conv-id" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" data-tooltip="${esc(c.title)}">${esc(title)}</span>
            <span class="act-conv-stats">
                <span>${c.calls.length} ${tBi('calls', '调用')}</span>
                <span>${covPct}% ${tBi('coverage', '覆盖')}</span>
                <span>${fmt(totalIn)} in</span>
            </span>
        </div>`;
    }
    html += `</div>`;
    return html;
}

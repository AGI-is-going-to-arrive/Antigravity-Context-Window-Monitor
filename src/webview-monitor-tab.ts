// ─── Monitor Tab Content Builder ─────────────────────────────────────────────
// Builds HTML sections for the "Monitor" tab: Mini Quota Overview,
// Current Session (with GM precision data), Other Sessions.
// Account / Plan / Features moved to Profile tab.

import { t, tBi } from './i18n';
import { ContextUsage } from './tracker';
import { ModelConfig, UserStatusInfo } from './models';
import { formatTokenCount, formatContextLimit, calculateCompressionStats } from './statusbar';
import { ICON } from './webview-icons';
import { esc, formatTime } from './webview-helpers';
import { GMSummary, GMConversationData, GMCallEntry, TokenBreakdownGroup } from './gm-tracker';

// ─── GM Data Aggregation ─────────────────────────────────────────────────────

interface GMSessionStats {
    calls: number;
    totalInput: number;
    totalOutput: number;
    thinkingTokens: number;
    responseTokens: number;
    cacheRead: number;
    cacheCreate: number;
    credits: number;
    retryCount: number;
    retryTokens: number;
    retryCredits: number;
    avgTTFT: number;
    avgStreaming: number;
    cacheHitRate: number;
    stopReasons: Record<string, number>;
    hasData: boolean;
}

function aggregateGMForSession(gmSummary: GMSummary | null, cascadeId: string): GMSessionStats {
    const empty: GMSessionStats = {
        calls: 0, totalInput: 0, totalOutput: 0,
        thinkingTokens: 0, responseTokens: 0,
        cacheRead: 0, cacheCreate: 0, credits: 0,
        retryCount: 0, retryTokens: 0, retryCredits: 0,
        avgTTFT: 0, avgStreaming: 0, cacheHitRate: 0,
        stopReasons: {}, hasData: false,
    };
    if (!gmSummary) { return empty; }
    const conv = gmSummary.conversations.find(c => c.cascadeId === cascadeId);
    if (!conv || conv.calls.length === 0) { return empty; }

    let totalInput = 0, totalOutput = 0, thinking = 0, response = 0;
    let cacheRead = 0, cacheCreate = 0, credits = 0;
    let retryCount = 0, retryTokens = 0, retryCredits = 0;
    let ttftSum = 0, ttftN = 0, streamSum = 0, streamN = 0;
    let cacheHits = 0;
    const stops: Record<string, number> = {};

    for (const c of conv.calls) {
        totalInput += c.inputTokens;
        totalOutput += c.outputTokens;
        thinking += c.thinkingTokens;
        response += c.responseTokens;
        cacheRead += c.cacheReadTokens;
        cacheCreate += c.cacheCreationTokens;
        credits += c.credits;
        retryTokens += c.retryTokensIn + c.retryTokensOut;
        retryCredits += c.retryCredits;
        if (c.retries > 0) { retryCount += c.retries; }
        if (c.ttftSeconds > 0) { ttftSum += c.ttftSeconds; ttftN++; }
        if (c.streamingSeconds > 0) { streamSum += c.streamingSeconds; streamN++; }
        if (c.cacheReadTokens > 0) { cacheHits++; }
        if (c.stopReason) {
            const sr = c.stopReason.replace('STOP_REASON_', '');
            stops[sr] = (stops[sr] || 0) + 1;
        }
    }

    return {
        calls: conv.calls.length,
        totalInput, totalOutput, thinkingTokens: thinking, responseTokens: response,
        cacheRead, cacheCreate, credits,
        retryCount, retryTokens, retryCredits,
        avgTTFT: ttftN > 0 ? ttftSum / ttftN : 0,
        avgStreaming: streamN > 0 ? streamSum / streamN : 0,
        cacheHitRate: conv.calls.length > 0 ? cacheHits / conv.calls.length : 0,
        stopReasons: stops, hasData: true,
    };
}

// ─── SVG icons (inline, currentColor) ────────────────────────────────────────

const IC = {
    brain: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M7.5 1a4 4 0 0 0-3.75 2.603A3.5 3.5 0 0 0 1 7a3.5 3.5 0 0 0 1.604 2.943A4 4 0 0 0 7.5 14V1zM8.5 14a4 4 0 0 0 4.896-4.057A3.5 3.5 0 0 0 15 7a3.5 3.5 0 0 0-2.75-3.397A4 4 0 0 0 8.5 1z"/></svg>',
    cache: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m3.5 7.5a.5.5 0 0 1 0 1H5.707l2.147 2.146a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L5.707 7.5z"/></svg>',
    coin: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path fill="currentColor" d="M8 13.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11m0-1A4.5 4.5 0 1 0 8 3a4.5 4.5 0 0 0 0 9"/></svg>',
    zap: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M5.52.359A.5.5 0 0 1 6 0h4a.5.5 0 0 1 .474.658L8.694 6H12.5a.5.5 0 0 1 .395.807l-7 9a.5.5 0 0 1-.873-.454L6.823 9H3.5a.5.5 0 0 1-.48-.641z"/></svg>',
    retry: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2H4.466a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9"/><path fill="currentColor" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"/></svg>',
    call: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 11.586l-2 2V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/><path fill="currentColor" d="M3 5.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5M3 8a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9A.5.5 0 0 1 3 8"/></svg>',
};

// ─── Public API ──────────────────────────────────────────────────────────────

/** Build all Monitor tab sections, returns joined HTML string. */
export function buildMonitorSections(
    usage: ContextUsage | null,
    allUsages: ContextUsage[],
    configs: ModelConfig[],
    userInfo: UserStatusInfo | null,
    gmSummary?: GMSummary | null,
): string {
    const sections: string[] = [];

    buildMiniQuotaBar(sections, configs);
    buildCurrentSessionSection(sections, usage, gmSummary ?? null);
    buildOtherSessionsSection(sections, usage, allUsages, gmSummary ?? null);

    if (sections.length === 0) {
        sections.push(`
            <section class="card empty">
                <h2>${t('panel.noData')}</h2>
            </section>`);
    }

    return sections.join('');
}

// ─── Section Builders ────────────────────────────────────────────────────────

/** Compact single-row quota overview — click jumps to Profile tab for details. */
function buildMiniQuotaBar(sections: string[], configs: ModelConfig[]): void {
    const quotaModels = configs.filter(c => c.quotaInfo);
    if (quotaModels.length === 0) { return; }

    const pills = quotaModels.map(c => {
        const qi = c.quotaInfo!;
        const pct = Math.round(qi.remainingFraction * 100);
        const color = pct <= 20 ? 'var(--color-danger)' : pct < 80 ? 'var(--color-warn)' : 'var(--color-ok)';
        const short = c.label.length > 20 ? c.label.substring(0, 18) + '…' : c.label;
        return `<span class="mini-quota-pill" style="--bar-pct:${pct}%;--bar-color:${color}">
                    <span class="mini-quota-label">${esc(short)}</span>
                    <span class="mini-quota-pct" style="color:${color}">${pct}%</span>
                </span>`;
    }).join('');

    sections.push(`
        <section class="card mini-quota-section">
            <div class="mini-quota-header">
                <span>${ICON.bolt} ${tBi('Quota', '额度')}</span>
                <button class="link-btn" data-switch-tab="profile">${tBi('Details', '详情')} →</button>
            </div>
            <div class="mini-quota-row">${pills}</div>
        </section>`);
}

function buildCurrentSessionSection(sections: string[], usage: ContextUsage | null, gm: GMSummary | null): void {
    if (!usage) {
        sections.push(`
            <section class="card empty">
                <h2>${ICON.clock} ${tBi('Waiting for Session', '等待会话')}</h2>
                <p class="empty-desc">${tBi(
                    'Start a conversation in Antigravity to see usage data.',
                    '在 Antigravity 中开始对话即可查看使用数据。',
                )}</p>
            </section>`);
        return;
    }

    const remaining = Math.max(0, usage.contextLimit - usage.contextUsed);
    const pct = Math.min(usage.usagePercent, 100);
    const barColor = pct >= 80 ? 'var(--color-danger)' : pct >= 50 ? 'var(--color-warn)' : 'var(--color-ok)';
    const sourceTag = usage.isEstimated
        ? `<span class="badge warn-badge">${t('panel.estimated')}</span>`
        : `<span class="badge ok-badge">${t('panel.preciseShort')}</span>`;

    // Compression alert
    const compressionStats = calculateCompressionStats(usage);
    let compressHtml = '';
    if (compressionStats) {
        compressHtml = `
                <div class="compression-alert">
                    ${ICON.compress}
                    <span>${t('panel.compression')}: -${formatTokenCount(compressionStats.dropTokens)} (${compressionStats.dropPercent.toFixed(1)}%)</span>
                </div>`;
    }

    // GM precision data
    const gs = aggregateGMForSession(gm, usage.cascadeId);

    // Output token split (GM precise or fallback)
    let outputSplitHtml = '';
    if (gs.hasData && (gs.thinkingTokens > 0 || gs.responseTokens > 0)) {
        const total = gs.thinkingTokens + gs.responseTokens;
        const thinkPct = total > 0 ? Math.round(gs.thinkingTokens / total * 100) : 0;
        const respPct = 100 - thinkPct;
        outputSplitHtml = `
                <div class="gm-split-section">
                    <div class="section-subtitle">${IC.brain} ${tBi('Output Breakdown', '输出分拆')} <span class="badge ok-badge">GM</span></div>
                    <div class="output-split-bar">
                        ${thinkPct > 0 ? `<div class="split-thinking" style="width:${thinkPct}%"></div>` : ''}
                        <div class="split-response" style="width:${respPct}%"></div>
                    </div>
                    <div class="split-legend">
                        <span><span class="dot thinking-dot"></span> ${tBi('Thinking', '思考')} ${formatTokenCount(gs.thinkingTokens)} (${thinkPct}%)</span>
                        <span><span class="dot response-dot"></span> ${tBi('Response', '正文')} ${formatTokenCount(gs.responseTokens)} (${respPct}%)</span>
                    </div>
                </div>`;
    }

    // Cache efficiency
    let cacheHtml = '';
    if (gs.hasData && gs.cacheRead > 0) {
        const hitPct = Math.round(gs.cacheHitRate * 100);
        const ringPct = Math.min(hitPct, 100);
        const ringDash = (ringPct / 100 * 251.2).toFixed(1);
        cacheHtml = `
                <div class="gm-cache-section">
                    <div class="section-subtitle">${IC.cache} ${tBi('Cache Efficiency', '缓存效率')} <span class="badge ok-badge">GM</span></div>
                    <div class="cache-row">
                        <div class="cache-ring-wrap">
                            <svg class="cache-ring" viewBox="0 0 90 90">
                                <circle cx="45" cy="45" r="40" fill="none" stroke="var(--color-surface)" stroke-width="6"/>
                                <circle cx="45" cy="45" r="40" fill="none" stroke="var(--color-ok)" stroke-width="6"
                                    stroke-dasharray="${ringDash} 251.2" stroke-dashoffset="0"
                                    transform="rotate(-90 45 45)" stroke-linecap="round"/>
                                <text x="45" y="49" text-anchor="middle" fill="var(--color-text)" font-size="16" font-weight="600">${hitPct}%</text>
                            </svg>
                            <div class="cache-ring-label">${tBi('Hit Rate', '命中率')}</div>
                        </div>
                        <div class="stat-grid three-col" style="flex:1">
                            <div class="stat mini">
                                <div class="stat-label">${tBi('Cache Read', '缓存读取')}</div>
                                <div class="stat-value">${formatTokenCount(gs.cacheRead)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${tBi('Cache Create', '缓存创建')}</div>
                                <div class="stat-value">${formatTokenCount(gs.cacheCreate)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${tBi('Hit Calls', '命中次数')}</div>
                                <div class="stat-value">${Math.round(gs.cacheHitRate * gs.calls)}/${gs.calls}</div>
                            </div>
                        </div>
                    </div>
                </div>`;
    }

    // Credits + Performance + Retry — compact row
    let gmStatsHtml = '';
    if (gs.hasData) {
        const statItems: string[] = [];
        // Credits
        if (gs.credits > 0) {
            statItems.push(`<div class="stat mini"><div class="stat-label">${IC.coin} ${tBi('Credits', '积分')}</div><div class="stat-value">${gs.credits.toLocaleString()}</div></div>`);
        }
        // TTFT
        if (gs.avgTTFT > 0) {
            statItems.push(`<div class="stat mini"><div class="stat-label">${IC.zap} TTFT</div><div class="stat-value">${gs.avgTTFT.toFixed(1)}s</div></div>`);
        }
        // Streaming
        if (gs.avgStreaming > 0) {
            statItems.push(`<div class="stat mini"><div class="stat-label">${IC.zap} ${tBi('Stream', '流式')}</div><div class="stat-value">${gs.avgStreaming.toFixed(1)}s</div></div>`);
        }
        // LLM Calls
        statItems.push(`<div class="stat mini"><div class="stat-label">${IC.call} ${tBi('LLM Calls', 'LLM 调用')}</div><div class="stat-value">${gs.calls}</div></div>`);
        // Retry
        if (gs.retryCount > 0) {
            statItems.push(`<div class="stat mini"><div class="stat-label">${IC.retry} ${tBi('Retries', '重试')}</div><div class="stat-value retry-val">${gs.retryCount} <span class="dim">(${formatTokenCount(gs.retryTokens)})</span></div></div>`);
        }

        if (statItems.length > 0) {
            gmStatsHtml = `
                <div class="gm-stats-section">
                    <div class="section-subtitle">${ICON.bolt} ${tBi('GM Precision', 'GM 精确数据')} <span class="badge ok-badge">${tBi('Precise', '精确')}</span></div>
                    <div class="stat-grid four-col">${statItems.join('')}</div>
                </div>`;
        }
    }

    // Stop reason tags (only abnormal)
    const NORMAL = new Set(['STOP_PATTERN', 'END_TURN', 'MAX_TOKENS', '']);
    let stopHtml = '';
    if (gs.hasData) {
        const abnormal = Object.entries(gs.stopReasons).filter(([r]) => !NORMAL.has(r));
        if (abnormal.length > 0) {
            const tags = abnormal.map(([r, n]) =>
                `<span class="badge danger-badge">${esc(r)} ×${n}</span>`
            ).join(' ');
            stopHtml = `<div class="stop-alert">${tBi('Abnormal Stops', '异常停止')}: ${tags}</div>`;
        }
    }

    // Token breakdown X-ray
    const breakdownHtml = buildTokenBreakdownSection(gs, gm, usage.cascadeId);

    // CHECKPOINT growth curve
    const growthHtml = buildGrowthCurveSection(gs, gm, usage.cascadeId);

    // Model distribution
    const modelDistHtml = buildModelDistSection(gs, gm, usage.cascadeId);

    // Compression history
    const compressionHistoryHtml = buildCompressionHistorySection(gs, gm, usage.cascadeId);

    // Per-call details
    const callDetailsHtml = buildCallDetailsSection(gs, gm, usage.cascadeId);

    // Delta hint
    let deltaHtml = '';
    if (usage.estimatedDeltaSinceCheckpoint > 0 && usage.lastModelUsage) {
        deltaHtml = `
                <div class="delta-hint">
                    ${t('tooltip.estDelta')}: +${usage.estimatedDeltaSinceCheckpoint.toLocaleString()} tokens (${t('tooltip.sinceCheckpoint')})
                </div>`;
    }

    sections.push(`
            <section class="card">
                <h2>
                    ${ICON.clock}
                    ${t('panel.currentSession')}
                    ${sourceTag}
                    <span class="badge status-badge">${esc(usage.status.replace('CASCADE_RUN_STATUS_', ''))}</span>
                </h2>
                <div class="stat-grid">
                    <div class="stat">
                        <div class="stat-label">${t('tooltip.model')}</div>
                        <div class="stat-value">${esc(usage.modelDisplayName)}</div>
                    </div>
                    <div class="stat">
                        <div class="stat-label">${t('tooltip.session')}</div>
                        <div class="stat-value title-val">${esc(usage.title || usage.cascadeId.substring(0, 8))}</div>
                    </div>
                </div>
                ${buildGitInfoHtml(usage)}
                <div class="progress-section">
                    <div class="progress-header">
                        <span>${tBi('Context Usage', '上下文使用')}</span>
                        <span class="progress-pct">${usage.usagePercent.toFixed(1)}%</span>
                    </div>
                    <div class="progress-bar-wrap">
                        <div class="progress-bar" style="width:${Math.min(pct, 100)}%;background:${barColor}"></div>
                    </div>
                    <div class="progress-detail">
                        ${formatTokenCount(usage.contextUsed)} / ${formatContextLimit(usage.contextLimit)}
                        <span class="dim">(${t('panel.remaining')}: ${formatTokenCount(remaining)})</span>
                    </div>
                </div>
                <div class="stat-grid four-col">
                    <div class="stat mini">
                        <div class="stat-label">${t('tooltip.steps')}</div>
                        <div class="stat-value">${usage.stepCount}</div>
                    </div>
                    <div class="stat mini">
                        <div class="stat-label">${t('tooltip.modelOutput')}</div>
                        <div class="stat-value">${formatTokenCount(usage.totalOutputTokens)}</div>
                    </div>
                    <div class="stat mini">
                        <div class="stat-label">${t('tooltip.toolResults')}</div>
                        <div class="stat-value">${formatTokenCount(usage.totalToolCallOutputTokens)}</div>
                    </div>
                    <div class="stat mini">
                        <div class="stat-label">${t('tooltip.imageGen')}</div>
                        <div class="stat-value">${usage.imageGenStepCount}</div>
                    </div>
                </div>
                ${compressHtml}
                ${outputSplitHtml}
                ${cacheHtml}
                ${gmStatsHtml}
                ${stopHtml}
                ${breakdownHtml}
                ${growthHtml}
                ${modelDistHtml}
                ${compressionHistoryHtml}
                ${callDetailsHtml}
                ${deltaHtml}
                <details class="collapsible" id="d-current-times">
                    <summary>${tBi('Timestamps', '时间戳')}</summary>
                    <div class="details-body">
                        <div class="detail-row"><span>${tBi('Created', '创建')}</span><span>${formatTime(usage.createdTime)}</span></div>
                        <div class="detail-row"><span>${tBi('Last Modified', '最后修改')}</span><span>${formatTime(usage.lastModifiedTime)}</span></div>
                        <div class="detail-row"><span>${tBi('Last User Input', '最后用户输入')}</span><span>${formatTime(usage.lastUserInputTime)}</span></div>
                        <div class="detail-row"><span>${tBi('Last Input Step', '最后输入步骤')}</span><span>#${usage.lastUserInputStepIndex}</span></div>
                        <div class="detail-row"><span>Cascade ID</span><span class="mono-val">${esc(usage.cascadeId)}</span></div>
                    </div>
                </details>
            </section>`);
}

function buildOtherSessionsSection(sections: string[], currentUsage: ContextUsage | null, allUsages: ContextUsage[], gm: GMSummary | null): void {
    const others = allUsages.filter(u => u.cascadeId !== currentUsage?.cascadeId);
    if (others.length === 0) { return; }

    const rows = others.slice(0, 10).map((u, idx) => {
        const pct = Math.min(u.usagePercent, 100);
        const barColor = pct >= 80 ? 'var(--color-danger)' : pct >= 50 ? 'var(--color-warn)' : 'var(--color-ok)';
        const compTag = u.compressionDetected ? '<span class="badge danger-badge">COMP</span>' : '';
        const statusTag = `<span class="badge status-badge">${esc(u.status.replace('CASCADE_RUN_STATUS_', ''))}</span>`;
        const remaining = Math.max(0, u.contextLimit - u.contextUsed);
        const sourceTag = u.isEstimated
            ? `<span class="badge warn-badge">${tBi('EST', '估')}</span>`
            : `<span class="badge ok-badge">${tBi('✓', '精')}</span>`;

        // GM mini stats for this session
        const gs = aggregateGMForSession(gm, u.cascadeId);
        let gmMiniHtml = '';
        if (gs.hasData) {
            const parts: string[] = [];
            if (gs.calls > 0) { parts.push(`${gs.calls} ${tBi('calls', '调用')}`); }
            if (gs.cacheHitRate > 0) { parts.push(`${tBi('Cache', '缓存')} ${Math.round(gs.cacheHitRate * 100)}%`); }
            if (gs.retryCount > 0) { parts.push(`${tBi('Retry', '重试')} ${gs.retryCount}`); }
            if (gs.credits > 0) { parts.push(`${gs.credits} ${tBi('cr', '积分')}`); }
            gmMiniHtml = parts.length > 0
                ? `<div class="gm-mini-row"><span class="badge ok-badge">GM</span> ${parts.join(' · ')}</div>`
                : '';
        }

        // Output split mini
        let splitMini = '';
        if (gs.hasData && (gs.thinkingTokens > 0 || gs.responseTokens > 0)) {
            const total = gs.thinkingTokens + gs.responseTokens;
            const thinkPct = total > 0 ? Math.round(gs.thinkingTokens / total * 100) : 0;
            splitMini = `
                        <div class="stat mini">
                            <div class="stat-label">${tBi('Thinking', '思考')}</div>
                            <div class="stat-value">${formatTokenCount(gs.thinkingTokens)} (${thinkPct}%)</div>
                        </div>`;
        }

        return `
                <details class="collapsible session-detail" id="d-session-${idx}">
                    <summary>
                        <div class="session-summary-row">
                            <span class="session-title-text">${esc(u.title || u.cascadeId.substring(0, 8))}</span>
                            ${compTag} ${statusTag} ${sourceTag}
                            <span class="session-pct-inline">${u.usagePercent.toFixed(1)}%</span>
                        </div>
                        <div class="session-bar-wrap compact">
                            <div class="session-bar" style="width:${pct}%;background:${barColor}"></div>
                        </div>
                    </summary>
                    <div class="details-body">
                        <div class="stat-grid four-col">
                            <div class="stat mini">
                                <div class="stat-label">${tBi('Used', '已用')}</div>
                                <div class="stat-value">${formatTokenCount(u.contextUsed)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${tBi('Limit', '限制')}</div>
                                <div class="stat-value">${formatContextLimit(u.contextLimit)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${tBi('Remaining', '剩余')}</div>
                                <div class="stat-value">${formatTokenCount(remaining)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${t('tooltip.steps')}</div>
                                <div class="stat-value">${u.stepCount}</div>
                            </div>
                        </div>
                        <div class="stat-grid four-col">
                            <div class="stat mini">
                                <div class="stat-label">${t('tooltip.model')}</div>
                                <div class="stat-value" style="font-size:0.85em">${esc(u.modelDisplayName)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${t('tooltip.modelOutput')}</div>
                                <div class="stat-value">${formatTokenCount(u.totalOutputTokens)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${t('tooltip.toolResults')}</div>
                                <div class="stat-value">${formatTokenCount(u.totalToolCallOutputTokens)}</div>
                            </div>
                            ${splitMini || `<div class="stat mini">
                                <div class="stat-label">${t('tooltip.imageGen')}</div>
                                <div class="stat-value">${u.imageGenStepCount}</div>
                            </div>`}
                        </div>
                        ${gmMiniHtml}
                        ${buildGitInfoHtml(u)}
                        <div class="detail-row"><span>${tBi('Created', '创建')}</span><span>${formatTime(u.createdTime)}</span></div>
                        <div class="detail-row"><span>${tBi('Last Modified', '最后修改')}</span><span>${formatTime(u.lastModifiedTime)}</span></div>
                        <div class="detail-row"><span>${tBi('Last User Input', '最后用户输入')}</span><span>${formatTime(u.lastUserInputTime)}</span></div>
                        <div class="detail-row"><span>Cascade ID</span><span class="mono-val">${esc(u.cascadeId)}</span></div>
                    </div>
                </details>`;
    }).join('');

    sections.push(`
            <section class="card">
                <h2>${ICON.chat} ${t('panel.otherSessions')} (${others.length})</h2>
                ${rows}
            </section>`);
}

// ─── Builder: Token Breakdown X-ray ──────────────────────────────────────────

function buildTokenBreakdownSection(gs: GMSessionStats, gm: GMSummary | null, cascadeId: string): string {
    if (!gm || !gs.hasData) { return ''; }
    const conv = gm.conversations.find(c => c.cascadeId === cascadeId);
    if (!conv) { return ''; }

    // Get the latest call's tokenBreakdown (most recent context composition)
    let groups: TokenBreakdownGroup[] = [];
    for (let i = conv.calls.length - 1; i >= 0; i--) {
        if (conv.calls[i].tokenBreakdownGroups.length > 0) {
            groups = conv.calls[i].tokenBreakdownGroups;
            break;
        }
    }
    if (groups.length === 0) { return ''; }

    const total = groups.reduce((s, g) => s + g.tokens, 0);
    if (total === 0) { return ''; }

    const colors = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#fb923c', '#c084fc', '#38bdf8'];
    const bars = groups.map((g, i) => {
        const pct = Math.max(1, Math.round(g.tokens / total * 100));
        const col = colors[i % colors.length];
        const detail = g.children.length > 0
            ? ` (${g.children.map(ch => `${esc(ch.name)}: ${formatTokenCount(ch.tokens)}`).join(', ')})`
            : '';
        return `<div class="breakdown-item">
                    <div class="breakdown-header">
                        <span><span class="dot" style="background:${col}"></span> ${esc(g.name)}</span>
                        <span>${formatTokenCount(g.tokens)} (${pct}%)</span>
                    </div>
                    <div class="breakdown-bar-wrap">
                        <div class="breakdown-bar" style="width:${pct}%;background:${col}"></div>
                    </div>
                    ${detail ? `<div class="breakdown-children">${detail}</div>` : ''}
                </div>`;
    }).join('');

    return `
                <div class="gm-breakdown-section">
                    <div class="section-subtitle">${IC.brain} ${tBi('Context X-ray', '上下文 X 光')} <span class="badge ok-badge">GM</span></div>
                    <div class="breakdown-list">${bars}</div>
                    <div class="breakdown-total">${tBi('Total', '合计')}: ${formatTokenCount(total)}</div>
                </div>`;
}

// ─── Builder: Growth Curve ───────────────────────────────────────────────────

function buildGrowthCurveSection(gs: GMSessionStats, gm: GMSummary | null, cascadeId: string): string {
    if (!gm || !gs.hasData) { return ''; }
    const conv = gm.conversations.find(c => c.cascadeId === cascadeId);
    if (!conv || conv.calls.length < 2) { return ''; }

    // Build growth data from per-call contextTokensUsed
    const points = conv.calls
        .filter(c => c.contextTokensUsed > 0)
        .map((c, i) => ({ step: c.stepIndices[0] ?? i, tokens: c.contextTokensUsed }));
    if (points.length < 2) { return ''; }

    const maxTokens = Math.max(...points.map(p => p.tokens));
    const barWidth = 100 / points.length;

    const bars = points.map(p => {
        const pct = maxTokens > 0 ? Math.max(2, Math.round(p.tokens / maxTokens * 100)) : 2;
        return `<div class="growth-bar" style="height:${pct}%;width:${barWidth}%" data-tooltip="${formatTokenCount(p.tokens)}"></div>`;
    }).join('');

    return `
                <details class="collapsible" id="d-growth-curve">
                    <summary>${IC.zap} ${tBi('Context Growth', '上下文增长')} <span class="badge ok-badge">GM</span></summary>
                    <div class="details-body">
                        <div class="growth-chart">
                            ${bars}
                        </div>
                        <div class="growth-axis">
                            <span>${tBi('Call', '调用')} #1</span>
                            <span>${formatTokenCount(maxTokens)}</span>
                            <span>#${points.length}</span>
                        </div>
                    </div>
                </details>`;
}

// ─── Builder: Model Distribution ─────────────────────────────────────────────

function buildModelDistSection(gs: GMSessionStats, gm: GMSummary | null, cascadeId: string): string {
    if (!gm || !gs.hasData) { return ''; }
    const conv = gm.conversations.find(c => c.cascadeId === cascadeId);
    if (!conv || conv.calls.length === 0) { return ''; }

    // Aggregate by model within this session
    const modelMap: Record<string, { calls: number; input: number; output: number; credits: number; model: string }> = {};
    for (const c of conv.calls) {
        const key = c.responseModel || c.modelDisplay || c.model;
        if (!modelMap[key]) { modelMap[key] = { calls: 0, input: 0, output: 0, credits: 0, model: c.modelDisplay || key }; }
        modelMap[key].calls++;
        modelMap[key].input += c.inputTokens;
        modelMap[key].output += c.outputTokens;
        modelMap[key].credits += c.credits;
    }

    const models = Object.values(modelMap).sort((a, b) => b.calls - a.calls);
    if (models.length <= 1) { return ''; } // Only 1 model — no distribution needed

    const maxCalls = Math.max(...models.map(m => m.calls));
    const rows = models.map(m => {
        const pct = maxCalls > 0 ? Math.round(m.calls / maxCalls * 100) : 0;
        return `<div class="model-dist-row">
                    <div class="model-dist-header">
                        <span class="model-dist-name">${esc(m.model)}</span>
                        <span>${m.calls} ${tBi('calls', '调用')}</span>
                    </div>
                    <div class="breakdown-bar-wrap">
                        <div class="breakdown-bar" style="width:${pct}%;background:var(--color-info)"></div>
                    </div>
                    <div class="model-dist-meta">
                        ${tBi('In', '输入')}: ${formatTokenCount(m.input)} · ${tBi('Out', '输出')}: ${formatTokenCount(m.output)}${m.credits > 0 ? ` · ${m.credits} ${tBi('cr', '积分')}` : ''}
                    </div>
                </div>`;
    }).join('');

    return `
                <details class="collapsible" id="d-model-dist">
                    <summary>${IC.brain} ${tBi('Model Distribution', '模型分布')} <span class="badge ok-badge">GM</span></summary>
                    <div class="details-body">${rows}</div>
                </details>`;
}

// ─── Builder: Compression History ────────────────────────────────────────────

function buildCompressionHistorySection(gs: GMSessionStats, gm: GMSummary | null, cascadeId: string): string {
    if (!gm || !gs.hasData) { return ''; }
    const conv = gm.conversations.find(c => c.cascadeId === cascadeId);
    if (!conv || conv.calls.length < 2) { return ''; }

    // Detect compression events: contextTokensUsed drops by > 10% between consecutive calls
    const drops: { fromStep: number; toStep: number; fromTokens: number; toTokens: number; drop: number }[] = [];
    const validCalls = conv.calls.filter(c => c.contextTokensUsed > 0);
    for (let i = 1; i < validCalls.length; i++) {
        const prev = validCalls[i - 1].contextTokensUsed;
        const curr = validCalls[i].contextTokensUsed;
        if (prev > 0 && curr < prev * 0.9) {
            drops.push({
                fromStep: validCalls[i - 1].stepIndices[0] ?? (i - 1),
                toStep: validCalls[i].stepIndices[0] ?? i,
                fromTokens: prev,
                toTokens: curr,
                drop: prev - curr,
            });
        }
    }
    if (drops.length === 0) { return ''; }

    const rows = drops.map(d => {
        const pct = d.fromTokens > 0 ? ((d.drop / d.fromTokens) * 100).toFixed(1) : '0';
        return `<div class="detail-row">
                    <span>${ICON.compress} #${d.fromStep} → #${d.toStep}</span>
                    <span class="retry-val">-${formatTokenCount(d.drop)} (${pct}%)</span>
                </div>`;
    }).join('');

    return `
                <details class="collapsible" id="d-compression-history">
                    <summary>${ICON.compress} ${tBi('Compression History', '压缩历史')} (${drops.length}) <span class="badge ok-badge">GM</span></summary>
                    <div class="details-body">${rows}</div>
                </details>`;
}

// ─── Builder: Per-Call Details ────────────────────────────────────────────────

function buildCallDetailsSection(gs: GMSessionStats, gm: GMSummary | null, cascadeId: string): string {
    if (!gm || !gs.hasData) { return ''; }
    const conv = gm.conversations.find(c => c.cascadeId === cascadeId);
    if (!conv || conv.calls.length === 0) { return ''; }

    const NORMAL_STOPS = new Set(['STOP_PATTERN', 'END_TURN', 'MAX_TOKENS', '']);
    const maxCalls = 20; // cap for UI performance
    const shown = conv.calls.slice(-maxCalls); // most recent
    const skipped = conv.calls.length - shown.length;

    const rows = shown.map((c, i) => {
        const idx = skipped + i + 1;
        const sr = c.stopReason.replace('STOP_REASON_', '');
        const abnormal = !NORMAL_STOPS.has(sr);
        const stopTag = abnormal ? `<span class="badge danger-badge">${esc(sr)}</span>` : `<span class="dim">${esc(sr)}</span>`;
        const retryTag = c.retries > 0 ? `<span class="badge warn-badge">${c.retries} ${tBi('retry', '重试')}</span>` : '';
        const cacheTag = c.cacheReadTokens > 0 ? `<span class="dim">${tBi('cache', '缓存')} ${formatTokenCount(c.cacheReadTokens)}</span>` : '';

        return `<div class="call-row">
                    <div class="call-header">
                        <span class="call-idx">#${idx}</span>
                        <span class="call-model">${esc(c.modelDisplay || c.responseModel)}</span>
                        ${retryTag} ${stopTag}
                    </div>
                    <div class="call-stats">
                        ${tBi('In', '输入')}: ${formatTokenCount(c.inputTokens)} · ${tBi('Out', '输出')}: ${formatTokenCount(c.outputTokens)}${c.thinkingTokens > 0 ? ` (${tBi('think', '思考')}: ${formatTokenCount(c.thinkingTokens)})` : ''}${c.credits > 0 ? ` · ${c.credits} ${tBi('cr', '积分')}` : ''}${c.ttftSeconds > 0 ? ` · TTFT ${c.ttftSeconds.toFixed(1)}s` : ''}${cacheTag ? ` · ${cacheTag}` : ''}
                    </div>
                </div>`;
    }).join('');

    const header = skipped > 0
        ? `${tBi('LLM Call Details', 'LLM 调用明细')} (${tBi(`latest ${shown.length} of ${conv.calls.length}`, `最近 ${shown.length} / 共 ${conv.calls.length}`)})`
        : `${tBi('LLM Call Details', 'LLM 调用明细')} (${conv.calls.length})`;

    return `
                <details class="collapsible" id="d-call-details">
                    <summary>${IC.call} ${header} <span class="badge ok-badge">GM</span></summary>
                    <div class="details-body call-details-body">${rows}</div>
                </details>`;
}

// ─── Helper: Git Info ────────────────────────────────────────────────────────

function buildGitInfoHtml(u: ContextUsage): string {
    if (!u.repositoryName && !u.branchName) { return ''; }
    const parts: string[] = [];
    if (u.repositoryName) {
        parts.push(`<span class="git-repo">${ICON.git} ${esc(u.repositoryName)}</span>`);
    }
    if (u.branchName) {
        parts.push(`<span class="git-branch">${ICON.branch} ${esc(u.branchName)}</span>`);
    }
    return `<div class="git-info">${parts.join('')}</div>`;
}

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
import { GMSummary, GMConversationData, GMCallEntry } from './gm-tracker';

// ─── GM Data Aggregation ─────────────────────────────────────────────────────

interface GMSessionStats {
    calls: number;
    lifetimeCalls: number;
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
    exactCalls: number;
    aliasOnlyCalls: number;
    latestCallModel: string;
    latestCallAccuracy: 'exact' | 'placeholder' | 'none';
    stopReasons: Record<string, number>;
    hasData: boolean;
}

function getConversationData(
    gmSummary: GMSummary | null,
    gmConversations: Record<string, GMConversationData> | undefined,
    cascadeId: string,
): GMConversationData | null {
    return gmSummary?.conversations.find(c => c.cascadeId === cascadeId)
        || gmConversations?.[cascadeId]
        || null;
}

function aggregateGMForSession(
    gmSummary: GMSummary | null,
    gmConversations: Record<string, GMConversationData> | undefined,
    cascadeId: string,
): GMSessionStats {
    const liveConv = gmSummary?.conversations.find(c => c.cascadeId === cascadeId) || null;
    const storedConv = gmConversations?.[cascadeId] || null;
    const empty: GMSessionStats = {
        calls: 0, lifetimeCalls: 0, totalInput: 0, totalOutput: 0,
        thinkingTokens: 0, responseTokens: 0,
        cacheRead: 0, cacheCreate: 0, credits: 0,
        retryCount: 0, retryTokens: 0, retryCredits: 0,
        avgTTFT: 0, avgStreaming: 0, cacheHitRate: 0,
        exactCalls: 0, aliasOnlyCalls: 0,
        latestCallModel: '', latestCallAccuracy: 'none',
        stopReasons: {}, hasData: false,
    };
    const lifetimeCalls = Math.max(
        liveConv?.lifetimeCalls ?? liveConv?.calls.length ?? 0,
        storedConv?.lifetimeCalls ?? storedConv?.calls.length ?? 0,
        liveConv?.calls.length ?? 0,
        storedConv?.calls.length ?? 0,
    );
    const conv = liveConv || storedConv;
    const currentCalls = liveConv ? liveConv.calls : (storedConv?.calls || []);
    if ((!conv || currentCalls.length === 0) && lifetimeCalls === 0) { return empty; }

    let totalInput = 0, totalOutput = 0, thinking = 0, response = 0;
    let cacheRead = 0, cacheCreate = 0, credits = 0;
    let retryCount = 0, retryTokens = 0, retryCredits = 0;
    let ttftSum = 0, ttftN = 0, streamSum = 0, streamN = 0;
    let cacheHits = 0;
    const stops: Record<string, number> = {};

    for (const c of currentCalls) {
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

    const latestCall = currentCalls[currentCalls.length - 1];
    const exactCalls = currentCalls.filter(c => c.modelAccuracy === 'exact').length;
    const aliasOnlyCalls = currentCalls.filter(c => c.modelAccuracy === 'placeholder').length;

    return {
        calls: currentCalls.length,
        lifetimeCalls,
        totalInput, totalOutput, thinkingTokens: thinking, responseTokens: response,
        cacheRead, cacheCreate, credits,
        retryCount, retryTokens, retryCredits,
        avgTTFT: ttftN > 0 ? ttftSum / ttftN : 0,
        avgStreaming: streamN > 0 ? streamSum / streamN : 0,
        cacheHitRate: currentCalls.length > 0 ? cacheHits / currentCalls.length : 0,
        exactCalls, aliasOnlyCalls,
        latestCallModel: latestCall ? (latestCall.responseModel || latestCall.modelDisplay || latestCall.model) : '',
        latestCallAccuracy: latestCall ? latestCall.modelAccuracy : 'none',
        stopReasons: stops, hasData: currentCalls.length > 0 || lifetimeCalls > 0,
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
    gmConversations?: Record<string, GMConversationData>,
): string {
    const sections: string[] = [];

    buildMiniQuotaBar(sections, configs);
    buildCurrentSessionSection(sections, usage, gmSummary ?? null, gmConversations);
    buildOtherSessionsSection(sections, usage, allUsages, gmSummary ?? null, gmConversations);

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

function buildCurrentSessionSection(
    sections: string[],
    usage: ContextUsage | null,
    gm: GMSummary | null,
    gmConversations?: Record<string, GMConversationData>,
): void {
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
    const gs = aggregateGMForSession(gm, gmConversations, usage.cascadeId);

    // Output token split (GM precise or fallback)
    let outputSplitHtml = '';
    if (gs.hasData && (gs.thinkingTokens > 0 || gs.responseTokens > 0)) {
        const total = gs.thinkingTokens + gs.responseTokens;
        const thinkPct = total > 0 ? Math.round(gs.thinkingTokens / total * 100) : 0;
        const respPct = 100 - thinkPct;
        outputSplitHtml = `
                <details class="collapsible" id="d-output-split">
                    <summary>${IC.brain} ${tBi('Output Breakdown', '输出分拆')} <span class="badge ok-badge">GM</span></summary>
                    <div class="details-body">
                    <div class="output-split-bar">
                        ${thinkPct > 0 ? `<div class="split-thinking" style="width:${thinkPct}%"></div>` : ''}
                        <div class="split-response" style="width:${respPct}%"></div>
                    </div>
                    <div class="split-legend">
                        <span><span class="dot thinking-dot"></span> ${tBi('Thinking', '思考')} ${formatTokenCount(gs.thinkingTokens)} (${thinkPct}%)</span>
                        <span><span class="dot response-dot"></span> ${tBi('Response', '正文')} ${formatTokenCount(gs.responseTokens)} (${respPct}%)</span>
                    </div>
                    </div>
                </details>`;
    }

    // Cache efficiency
    let cacheHtml = '';
    if (gs.hasData && gs.cacheRead > 0) {
        const hitPct = Math.round(gs.cacheHitRate * 100);
        const ringPct = Math.min(hitPct, 100);
        const ringDash = (ringPct / 100 * 251.2).toFixed(1);
        cacheHtml = `
                <details class="collapsible" id="d-cache-efficiency">
                    <summary>${IC.cache} ${tBi('Cache Efficiency', '缓存效率')} <span class="badge ok-badge">GM</span></summary>
                    <div class="details-body">
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
                    </div>
                </details>`;
    }

    // Compression history
    const compressionHistoryHtml = buildCompressionHistorySection(gs, gm, gmConversations, usage.cascadeId);

    // Per-call details
    const callDetailsHtml = buildCallDetailsSection(gs, gm, gmConversations, usage.cascadeId);

    const gmSessionStatsHtml = gs.hasData ? `
                <div class="stat-grid four-col">
                    <div class="stat mini">
                        <div class="stat-label">${tBi('Calls', '调用')}</div>
                        <div class="stat-value">${gs.calls}</div>
                    </div>
                    <div class="stat mini">
                        <div class="stat-label">${tBi('Lifetime', '累计调用')}</div>
                        <div class="stat-value">${gs.lifetimeCalls}</div>
                    </div>
                    <div class="stat mini">
                        <div class="stat-label">${tBi('Retry', '重试')}</div>
                        <div class="stat-value">${gs.retryCount}</div>
                    </div>
                    <div class="stat mini">
                        <div class="stat-label">${tBi('Cache Hit', '缓存命中')}</div>
                        <div class="stat-value">${Math.round(gs.cacheHitRate * 100)}%</div>
                    </div>
                </div>` : '';

    // Delta hint
    let deltaHtml = '';
    if (usage.estimatedDeltaSinceCheckpoint > 0 && usage.lastModelUsage) {
        deltaHtml = `
                <div class="delta-hint">
                    ${t('tooltip.estDelta')}: +${usage.estimatedDeltaSinceCheckpoint.toLocaleString()} ${tBi('tokens', '令牌')} (${t('tooltip.sinceCheckpoint')})
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
                ${gmSessionStatsHtml}
                ${compressHtml}
                ${outputSplitHtml}
                ${cacheHtml}
                ${compressionHistoryHtml}
                ${callDetailsHtml}
                ${deltaHtml}
                <details class="collapsible" id="d-current-times">
                    <summary><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${tBi('Timestamps', '时间戳')}</summary>
                    <div class="details-body">
                        <div class="ts-grid">
                            <div class="ts-card">
                                <div class="ts-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ok)" stroke-width="2"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg></div>
                                <div class="ts-label">${tBi('Created', '创建')}</div>
                                <div class="ts-value">${formatTime(usage.createdTime)}</div>
                            </div>
                            <div class="ts-card">
                                <div class="ts-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-info)" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></div>
                                <div class="ts-label">${tBi('Last Modified', '最后修改')}</div>
                                <div class="ts-value">${formatTime(usage.lastModifiedTime)}</div>
                            </div>
                            <div class="ts-card">
                                <div class="ts-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-warn)" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>
                                <div class="ts-label">${tBi('Last User Input', '最后用户输入')}</div>
                                <div class="ts-value">${formatTime(usage.lastUserInputTime)}</div>
                            </div>
                            <div class="ts-card">
                                <div class="ts-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg></div>
                                <div class="ts-label">${tBi('Last Input Step', '最后输入步骤')}</div>
                                <div class="ts-value">#${usage.lastUserInputStepIndex}</div>
                            </div>
                        </div>
                        <div class="ts-cascade">
                            <span class="ts-cascade-label">${tBi('Cascade ID', '对话 ID')}</span>
                            <span class="mono-val">${esc(usage.cascadeId)}</span>
                        </div>
                    </div>
                </details>
            </section>`);
}

function buildOtherSessionsSection(
    sections: string[],
    currentUsage: ContextUsage | null,
    allUsages: ContextUsage[],
    gm: GMSummary | null,
    gmConversations?: Record<string, GMConversationData>,
): void {
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
            : `<span class="badge ok-badge">GM</span>`;

        // GM mini stats for this session
        const gs = aggregateGMForSession(gm, gmConversations, u.cascadeId);
        let gmMiniHtml = '';
        if (gs.hasData) {
            const parts: string[] = [];
            if (gs.calls > 0) { parts.push(`${gs.calls} ${tBi('calls', '调用')}`); }
            if (gs.lifetimeCalls > 0) { parts.push(`${tBi('Lifetime', '累计')} ${gs.lifetimeCalls}`); }
            if (gs.cacheHitRate > 0) { parts.push(`${tBi('Cache', '缓存')} ${Math.round(gs.cacheHitRate * 100)}%`); }
            if (gs.retryCount > 0) { parts.push(`${tBi('Retry', '重试')} ${gs.retryCount}`); }
            if (gs.credits > 0) { parts.push(`${gs.credits} ${tBi('cr', '积分')}`); }
            if (gs.latestCallModel) {
                parts.push(`${tBi('Last', '最后')}: ${esc(gs.latestCallModel)}`);
            }
            if (gs.aliasOnlyCalls > 0) {
                parts.push(`${tBi('Alias', '别名')} ${gs.aliasOnlyCalls}`);
            }
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
                        <div class="ts-grid" style="margin-top:var(--space-2)">
                            <div class="ts-card">
                                <div class="ts-label">${tBi('Created', '创建')}</div>
                                <div class="ts-value">${formatTime(u.createdTime)}</div>
                            </div>
                            <div class="ts-card">
                                <div class="ts-label">${tBi('Last Modified', '最后修改')}</div>
                                <div class="ts-value">${formatTime(u.lastModifiedTime)}</div>
                            </div>
                            <div class="ts-card">
                                <div class="ts-label">${tBi('Last Input', '最后输入')}</div>
                                <div class="ts-value">${formatTime(u.lastUserInputTime)}</div>
                            </div>
                            <div class="ts-card">
                                <div class="ts-label">${tBi('Cascade ID', '对话 ID')}</div>
                                <div class="ts-value mono-val" style="font-size:0.72em">${esc(u.cascadeId.substring(0, 12))}…</div>
                            </div>
                        </div>
                    </div>
                </details>`;
    }).join('');

    sections.push(`
            <section class="card">
                <h2>${ICON.chat} ${t('panel.otherSessions')} (${others.length})</h2>
                ${rows}
            </section>`);
}

// ─── Builder: Compression History ────────────────────────────────────────────

function buildCompressionHistorySection(
    gs: GMSessionStats,
    gm: GMSummary | null,
    gmConversations: Record<string, GMConversationData> | undefined,
    cascadeId: string,
): string {
    if (!gs.hasData) { return ''; }
    const conv = getConversationData(gm, gmConversations, cascadeId);
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
        return `<div class="compress-card">
                    <div class="compress-card-header">
                        <span class="compress-steps">${ICON.compress} #${d.fromStep} → #${d.toStep}</span>
                        <span class="compress-drop">-${formatTokenCount(d.drop)} (${pct}%)</span>
                    </div>
                    <div class="compress-bar-wrap">
                        <div class="compress-bar-before" style="width:100%"></div>
                        <div class="compress-bar-after" style="width:${d.fromTokens > 0 ? Math.round(d.toTokens / d.fromTokens * 100) : 0}%"></div>
                    </div>
                    <div class="compress-detail">
                        <span>${formatTokenCount(d.fromTokens)}</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
                        <span>${formatTokenCount(d.toTokens)}</span>
                    </div>
                </div>`;
    }).join('');

    return `
                <details class="collapsible" id="d-compression-history">
                    <summary>${ICON.compress} ${tBi('Compression History', '压缩历史')} (${drops.length}) <span class="badge ok-badge">GM</span></summary>
                    <div class="details-body">${rows}</div>
                </details>`;
}

// ─── Builder: Per-Call Details ────────────────────────────────────────────────

function buildCallDetailsSection(
    gs: GMSessionStats,
    gm: GMSummary | null,
    gmConversations: Record<string, GMConversationData> | undefined,
    cascadeId: string,
): string {
    if (!gs.hasData) { return ''; }
    const conv = getConversationData(gm, gmConversations, cascadeId);
    if (!conv || conv.calls.length === 0) { return ''; }

    const NORMAL_STOPS = new Set(['STOP_PATTERN', 'END_TURN', 'MAX_TOKENS', '']);
    const maxCalls = 20; // cap for UI performance
    const shown = conv.calls.slice(-maxCalls); // most recent
    const skipped = conv.calls.length - shown.length;

    // Reverse so newest calls appear at top
    const reversed = [...shown].reverse();

    const rows = reversed.map((c) => {
        // Use original index from conv.calls
        const origIdx = conv.calls.indexOf(c) + 1;
        const sr = c.stopReason.replace('STOP_REASON_', '');
        const abnormal = !NORMAL_STOPS.has(sr);
        const stopTag = abnormal ? `<span class="badge danger-badge">${esc(sr)}</span>` : `<span class="dim">${esc(sr)}</span>`;
        const retryTag = c.retries > 0 ? `<span class="badge warn-badge">${c.retries} ${tBi('retry', '重试')}</span>` : '';
        const accuracyTag = c.modelAccuracy === 'exact'
            ? `<span class="badge ok-badge">${tBi('Exact', '实际')}</span>`
            : `<span class="badge warn-badge">${tBi('Alias', '别名')}</span>`;

        // Build stat chips
        const chips: string[] = [];
        chips.push(`<span class="call-chip">${tBi('In', '输入')} ${formatTokenCount(c.inputTokens)}</span>`);
        chips.push(`<span class="call-chip">${tBi('Out', '输出')} ${formatTokenCount(c.outputTokens)}</span>`);
        if (c.thinkingTokens > 0) { chips.push(`<span class="call-chip thinking">${tBi('Think', '思考')} ${formatTokenCount(c.thinkingTokens)}</span>`); }
        if (c.cacheReadTokens > 0) { chips.push(`<span class="call-chip cache">${tBi('Cache', '缓存')} ${formatTokenCount(c.cacheReadTokens)}</span>`); }
        if (c.credits > 0) { chips.push(`<span class="call-chip">${c.credits} ${tBi('cr', '积分')}</span>`); }
        if (c.ttftSeconds > 0) { chips.push(`<span class="call-chip">TTFT ${c.ttftSeconds.toFixed(1)}s</span>`); }
        if (c.streamingSeconds > 0) { chips.push(`<span class="call-chip">${c.streamingSeconds.toFixed(1)}s</span>`); }

        return `<div class="call-card">
                    <div class="call-card-header">
                        <span class="call-idx">#${origIdx}</span>
                        <span class="call-model">${esc(c.modelDisplay || c.responseModel || c.model)}</span>
                        ${accuracyTag} ${retryTag} ${stopTag}
                    </div>
                    <div class="call-chips">${chips.join('')}</div>
                </div>`;
    }).join('');

    const header = skipped > 0
        ? `${tBi('LLM Call Details', 'LLM 调用明细')} (${tBi(`latest ${shown.length} of ${conv.calls.length}`, `最近 ${shown.length} / 当前 ${conv.calls.length}`)} · ${tBi('Lifetime', '累计')} ${gs.lifetimeCalls})`
        : `${tBi('LLM Call Details', 'LLM 调用明细')} (${tBi('Current', '当前')} ${conv.calls.length} · ${tBi('Lifetime', '累计')} ${gs.lifetimeCalls})`;

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

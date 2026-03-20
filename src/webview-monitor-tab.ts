// ─── Monitor Tab Content Builder ─────────────────────────────────────────────
// Builds HTML sections for the "Monitor" tab: Mini Quota Overview,
// Current Session, Other Sessions, and Raw Data.
// Account / Plan / Features moved to Profile tab.

import { t, tBi } from './i18n';
import { ContextUsage } from './tracker';
import { ModelConfig, UserStatusInfo } from './models';
import { formatTokenCount, formatContextLimit, calculateCompressionStats } from './statusbar';
import { ICON } from './webview-icons';
import { esc, formatTime } from './webview-helpers';

// ─── Public API ──────────────────────────────────────────────────────────────

/** Build all Monitor tab sections, returns joined HTML string. */
export function buildMonitorSections(
    usage: ContextUsage | null,
    allUsages: ContextUsage[],
    configs: ModelConfig[],
    userInfo: UserStatusInfo | null,
): string {
    const sections: string[] = [];

    buildMiniQuotaBar(sections, configs);
    buildCurrentSessionSection(sections, usage);
    buildOtherSessionsSection(sections, usage, allUsages);
    buildRawDataSection(sections, userInfo);

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
        // Short label: take first word or trim to 20 chars
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

function buildCurrentSessionSection(sections: string[], usage: ContextUsage | null): void {
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

    const compressionStats = calculateCompressionStats(usage);
    let compressHtml = '';
    if (compressionStats) {
        compressHtml = `
                <div class="compression-alert">
                    ${ICON.compress}
                    <span>${t('panel.compression')}: -${formatTokenCount(compressionStats.dropTokens)} (${compressionStats.dropPercent.toFixed(1)}%)</span>
                </div>`;
    }

    let checkpointHtml = '';
    if (usage.lastModelUsage) {
        const mu = usage.lastModelUsage;
        checkpointHtml = `
                <div class="checkpoint-section">
                    <div class="section-subtitle">${t('tooltip.lastCheckpoint')}</div>
                    <div class="stat-grid three-col">
                        <div class="stat mini">
                            <div class="stat-label">${t('tooltip.input')}</div>
                            <div class="stat-value">${mu.inputTokens.toLocaleString()}</div>
                        </div>
                        <div class="stat mini">
                            <div class="stat-label">${t('tooltip.output')}</div>
                            <div class="stat-value">${mu.outputTokens.toLocaleString()}</div>
                        </div>
                        <div class="stat mini">
                            <div class="stat-label">${t('tooltip.cache')}</div>
                            <div class="stat-value">${mu.cacheReadTokens.toLocaleString()}</div>
                        </div>
                    </div>
                </div>`;
    }

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
                ${checkpointHtml}
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

function buildOtherSessionsSection(sections: string[], currentUsage: ContextUsage | null, allUsages: ContextUsage[]): void {
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
                            <div class="stat mini">
                                <div class="stat-label">${t('tooltip.imageGen')}</div>
                                <div class="stat-value">${u.imageGenStepCount}</div>
                            </div>
                        </div>
                        ${buildGitInfoHtml(u)}
                        ${u.lastModelUsage ? `
                        <div class="checkpoint-section">
                            <div class="section-subtitle">${t('tooltip.lastCheckpoint')}</div>
                            <div class="stat-grid three-col">
                                <div class="stat mini"><div class="stat-label">${t('tooltip.input')}</div><div class="stat-value">${u.lastModelUsage.inputTokens.toLocaleString()}</div></div>
                                <div class="stat mini"><div class="stat-label">${t('tooltip.output')}</div><div class="stat-value">${u.lastModelUsage.outputTokens.toLocaleString()}</div></div>
                                <div class="stat mini"><div class="stat-label">${t('tooltip.cache')}</div><div class="stat-value">${u.lastModelUsage.cacheReadTokens.toLocaleString()}</div></div>
                            </div>
                        </div>` : ''}
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

function buildRawDataSection(sections: string[], userInfo: UserStatusInfo | null): void {
    if (!userInfo?._rawResponse) { return; }

    const rawJson = JSON.stringify(userInfo._rawResponse, null, 2);
    const truncated = rawJson.length > 200_000;
    const displayJson = truncated ? rawJson.substring(0, 200_000) + '\n\n... (truncated)' : rawJson;

    sections.push(`
            <section class="card">
                <h2>
                    ${ICON.shield} ${tBi('Raw LS Data', 'LS 原始数据')}
                    <button class="copy-btn" id="copyRawJson" aria-label="Copy JSON">${ICON.copy} ${tBi('Copy', '复制')}</button>
                </h2>
                <p class="raw-desc">${tBi(
                    'Full GetUserStatus response from LS — if schema changes, new fields appear here first.',
                    'LS GetUserStatus 完整响应 — 如果 schema 变更，新字段会最先出现在这里。',
                )}</p>
                <details class="collapsible" id="d-raw-data">
                    <summary>${tBi('Show JSON', '展示 JSON')} (${(rawJson.length / 1024).toFixed(1)} KB)</summary>
                    <div class="details-body">
                        <pre class="raw-json" id="rawJsonContent"><code>${esc(displayJson)}</code></pre>
                    </div>
                </details>
            </section>`);
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

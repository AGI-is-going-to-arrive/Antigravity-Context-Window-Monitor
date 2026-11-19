import { getLanguage, t, tBi } from './i18n';
import { getDaysUntilBillingDay } from './billing-day';
import {
    formatCreditExpiry, getContextReading, monitorBackendMessage, monitorStatusLabel, quotaPercentage,
    quotaResetLabel, selectMonitorQuotaGroups, usableCount, type MonitorStatus,
} from './monitor-overview';
import { isShowModelShortId, localizeNeonPickerLabel, normalizeModelDisplayName, resolveModelId, type ModelConfig, type UserStatusInfo } from './models';
import { calculateCompressionStats } from './statusbar';
import type { ContextUsage } from './tracker';
import { esc } from './webview-helpers';

const arrow = '<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8h9m-4-4 4 4-4 4"/></svg>';

function number(value: unknown, digits = 0): string {
    return usableCount(value) ? value.toLocaleString(getLanguage() === 'zh' ? 'zh-CN' : 'en', {
        maximumFractionDigits: digits,
    }) : '—';
}

function metric(label: string, value: string): string {
    return `<div class="overview-metric"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
}

function meter(label: string, value: number, spoken: string, attention: boolean): string {
    const fill = Math.max(0, Math.min(100, value));
    return `<div class="overview-meter${attention ? ' is-attention' : ''}" role="meter"
        aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${fill}" aria-valuetext="${esc(spoken)}">
        <span aria-hidden="true" style="width:${fill}%"></span>
    </div>`;
}

function sessionDetails(usage: ContextUsage): string {
    const reading = getContextReading(usage);
    const tokenUnit = tBi('tokens', '令牌');
    const compression = calculateCompressionStats(usage);
    const last = usage.lastModelUsage;
    const isPlanner = usage.tokenUsageSource === 'planner';
    const modelLabel = localizeNeonPickerLabel(resolveModelId(usage.model) || usage.model, usage.modelDisplayName, getLanguage());
    const contextLabel = tBi('Context used', '上下文占用');
    const ratio = reading.percent === null ? '—' : `${number(reading.percent, 1)}%`;
    const precision = usage.isEstimated ? tBi('Estimated', '估算') : tBi('Measured', '实测');
    const warnings = [
        ...(usage.hasGaps ? [t('tooltip.dataIncomplete')] : []),
        ...(reading.percent !== null && reading.percent > 100
            ? [tBi('Above the context limit', '已超过上下文上限')] : []),
        ...(usage.imageGenerationIncomplete
            ? [tBi('Image workflow data is incomplete', '图片工作流数据不完整')] : []),
    ];
    const diagnostics = [
        metric(t('tooltip.modelOutput'), number(usage.totalOutputTokens)),
        metric(t('tooltip.toolResults'), number(usage.totalToolCallOutputTokens)),
        metric(t('tooltip.steps'), number(usage.stepCount)),
    ];
    if (usage.compressionDetected) {
        const label = t(compression?.source === 'checkpoint' ? 'tooltip.checkpointDrop' : 'tooltip.contextDrop');
        diagnostics.push(metric(label, compression ? `${number(compression.dropTokens)} ${tokenUnit} · ${number(compression.dropPercent, 1)}%` : '—'));
        if (usableCount(usage.previousContextUsed)) {
            diagnostics.push(metric(t('tooltip.before'), number(usage.previousContextUsed)));
            diagnostics.push(metric(t('tooltip.after'), number(reading.used)));
        }
    }
    if (usage.estimatedDeltaSinceCheckpoint > 0) {
        const source = t(isPlanner ? 'tooltip.sinceModelCall' : 'tooltip.sinceCheckpoint');
        diagnostics.push(metric(t('tooltip.estDelta'), `+${number(usage.estimatedDeltaSinceCheckpoint)} · ${source}`));
    }
    if (usage.imageGenStepCount > 0) {
        const models = usage.imageGenerationModels?.map(normalizeModelDisplayName).join(' · ');
        diagnostics.push(metric(t('tooltip.imageGen'), number(usage.imageGenStepCount)));
        if (models) { diagnostics.push(metric(tBi('Image model', '图片模型'), models)); }
    }
    const checkpointId = !isPlanner && isShowModelShortId() && usage.checkpointModel
        ? ` · ${usage.checkpointModel.replace(/^MODEL_PLACEHOLDER_/, '')}` : '';

    return `<div class="overview-session">
        ${usage.title ? `<p class="overview-session-title">${esc(usage.title)}</p>` : ''}
        <p class="overview-meta">${esc([modelLabel, precision].filter(Boolean).join(' · '))}</p>
        <div class="overview-reading">
            <div><strong>${number(reading.used)}</strong><span> / ${number(reading.limit)} ${esc(tokenUnit)}</span></div>
            <span class="overview-percent">${ratio}</span>
        </div>
        ${reading.percent === null
            ? `<p class="overview-meta">${esc(tBi('Context measurement unavailable', '暂无上下文计量'))}</p>`
            : meter(contextLabel, reading.percent, ratio, reading.percent >= 80)}
        ${reading.used !== null && reading.limit !== null
            ? `<p class="overview-meta">${esc(tBi('Remaining', '可用余量'))} · ${number(Math.max(0, reading.limit - reading.used))} ${esc(tokenUnit)}</p>` : ''}
        ${warnings.length ? `<ul class="overview-notices">${warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul>` : ''}
        <details id="overview-session-diagnostics" class="overview-details" data-state-key="overview-diagnostics:${esc(usage.cascadeId)}">
            <summary data-overview-focus="diagnostics">${esc(tBi('Session diagnostics', '会话诊断'))}</summary>
            <dl class="overview-metrics">${diagnostics.join('')}</dl>
            ${last ? `<h3>${esc(t(isPlanner ? 'tooltip.lastModelUsage' : 'tooltip.lastCheckpoint') + checkpointId)}</h3>
                <dl class="overview-metrics">
                    ${metric(t('tooltip.input'), number(last.inputTokens))}
                    ${metric(t('tooltip.output'), number(last.outputTokens))}
                    ${metric(t('tooltip.cache'), number(last.cacheReadTokens))}
                    ${metric(tBi('Cache creation', '缓存创建'), number(last.cacheCreationTokens ?? 0))}
                </dl>` : ''}
        </details>
    </div>`;
}

function action(tab: 'models' | 'gmdata' | 'settings', label: string): string {
    return `<button type="button" class="overview-action" data-overview-target="${tab}" data-overview-focus="${tab}">${esc(label)} ${arrow}</button>`;
}

export function buildOverviewTabContent(
    usage: ContextUsage | null,
    configs: readonly ModelConfig[],
    userInfo: UserStatusInfo | null,
    billingDay = 0,
    status: MonitorStatus = { state: usage ? 'active' : configs.length || userInfo ? 'empty' : 'connecting' },
    now = Date.now(),
): string {
    const connected = status.state !== 'connecting' && status.state !== 'disconnected';
    const active = status.state === 'active' ? usage : null;
    const groups = connected ? selectMonitorQuotaGroups(configs, active?.model) : [];
    const credits = (userInfo?.availableCredits || []).reduce((sum, entry) =>
        sum + (usableCount(entry.creditAmount) ? entry.creditAmount : 0), 0);
    const expiry = formatCreditExpiry(getDaysUntilBillingDay(billingDay, new Date(now)));
    const plan = userInfo ? [...new Set([userInfo.planName, userInfo.userTierName].filter(Boolean))].join(' · ') : '';
    const quotaTitle = tBi('Quota remaining', '剩余配额');
    const quotaRows = groups.map(group => {
        const band = quotaPercentage(group);
        const count = new Set(group.readings.map(reading => reading.model)).size;
        const modelCount = tBi(count === 1 ? '1 model' : `${count} models`, `${count} 个模型`);
        const reset = quotaResetLabel(group, now, true);
        const partial = (group.missingQuota && group.minimum !== null) || (group.missingReset && group.resetTime);
        return `<li class="overview-quota-row">
            <div class="overview-quota-heading">
                <div><h3>${esc(group.label)}</h3><span class="overview-meta">${esc(modelCount)}</span></div>
                <strong>${band}</strong>
            </div>
            ${group.minimum === null ? '' : meter(`${group.label} · ${quotaTitle}`, group.minimum * 100, band, group.minimum <= 0.2)}
            <p class="overview-meta">${esc(reset)}${partial ? ` · ${esc(tBi('Partial data', '数据不完整'))}` : ''}</p>
        </li>`;
    }).join('');
    const emptyContext = status.state === 'idle'
        ? tBi('No context measurement for this conversation yet.', '当前会话暂无上下文计量。')
        : tBi('Open an Antigravity conversation to see its context usage.', '打开 Antigravity 会话后即可查看上下文用量。');

    return `<section class="monitor-overview" data-monitor-overview data-monitor-state="${status.state}" aria-labelledby="overview-heading">
        <header class="overview-header">
            <h2 id="overview-heading" data-overview-focus="heading" tabindex="-1">${esc(tBi('Context & quota', '上下文与配额'))}</h2>
            ${connected && plan ? `<p class="overview-meta">${esc(plan)}</p>` : ''}
        </header>
        ${connected ? `<div class="overview-grid">
            <section class="overview-context" aria-labelledby="overview-context-heading">
                <h3 id="overview-context-heading" class="overview-section-heading"><span class="overview-state-dot" aria-hidden="true"></span>${esc(monitorStatusLabel(status.state))}</h3>
                ${active ? sessionDetails(active) : `<p class="overview-empty">${esc(emptyContext)}</p>`}
                ${action('gmdata', tBi('View model activity', '查看模型活动'))}
            </section>
            <section class="overview-quota" aria-labelledby="overview-quota-heading">
                <h3 id="overview-quota-heading" class="overview-section-heading">${esc(quotaTitle)}</h3>
                ${quotaRows ? `<ul class="overview-quotas">${quotaRows}</ul>`
                    : `<p class="overview-empty">${esc(tBi('Waiting for quota data.', '等待配额数据。'))}</p>`}
                ${action('models', tBi('View models', '查看模型'))}
            </section>
        </div>` : `<div class="overview-connection">
            <h3 class="overview-section-heading"><span class="overview-state-dot" aria-hidden="true"></span>${esc(monitorStatusLabel(status.state))}</h3>
            <p class="overview-empty">${esc(status.state === 'disconnected'
                ? monitorBackendMessage(status.backendIssue)
                : tBi('Waiting for the local backend.', '正在等待本地后端。'))}</p>
        </div>`}
        <footer class="overview-footer">
            ${connected && (credits > 0 || billingDay > 0) ? `<p>
                <span>${esc(tBi('AI credits', 'AI 积分'))}</span>
                ${credits > 0 ? `<strong>${number(credits)}</strong>` : ''}
                <span class="overview-meta">${esc(expiry)}</span>
            </p>` : ''}
            ${action('settings', tBi('Status bar settings', '状态栏设置'))}
        </footer>
    </section>`;
}

export function getOverviewStyles(): string {
    return `
        .monitor-overview {
            --overview-rule: var(--vscode-contrastBorder, var(--vscode-widget-border, var(--color-border-strong)));
            --overview-muted: var(--vscode-descriptionForeground, var(--vscode-foreground));
            --overview-accent: var(--vscode-textLink-foreground, var(--color-accent));
            --overview-focus: var(--vscode-focusBorder, var(--overview-accent));
            --overview-track: var(--vscode-scrollbarSlider-background, var(--color-border-strong));
            --overview-fill: var(--vscode-progressBar-background, var(--overview-accent));
            --overview-attention: var(--vscode-editorWarning-foreground, var(--overview-fill));
            width: min(100%, 960px);
            margin-inline: auto;
            padding: clamp(22px, 4vw, 52px) clamp(12px, 3vw, 28px) 32px;
            color: var(--vscode-foreground);
            line-height: 1.55;
            overflow-wrap: anywhere;
        }
        .monitor-overview *, .monitor-overview *::before { box-sizing: border-box; }
        .overview-header { padding-bottom: 22px; margin: 0; }
        .overview-header h2 {
            color: inherit;
            margin: 0;
            padding: 0;
            font-size: clamp(1.65rem, 3.2vw, 2.4rem);
            font-weight: 620;
            line-height: 1.16;
            letter-spacing: -.025em;
        }
        .overview-header .overview-meta { margin-top: 7px; }
        .overview-grid { display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr); border-block: 1px solid var(--overview-rule); }
        .overview-context, .overview-quota, .overview-connection { padding-block: 19px 21px; min-width: 0; }
        .overview-context { padding-inline-end: clamp(14px, 3vw, 30px); }
        .overview-quota { padding-inline-start: clamp(14px, 3vw, 30px); border-inline-start: 1px solid var(--overview-rule); }
        .overview-connection { border-block: 1px solid var(--overview-rule); }
        .monitor-overview h3 { margin: 0; padding: 0; color: inherit; font-size: .95rem; font-weight: 600; }
        .monitor-overview .overview-section-heading { display: flex; gap: 8px; align-items: baseline; font-size: 1.03rem; }
        .overview-state-dot { flex: 0 0 7px; height: 7px; border-radius: 50%; background: currentColor; color: var(--overview-muted); align-self: center; }
        [data-monitor-state="active"] .overview-state-dot { color: var(--overview-fill); }
        [data-monitor-state="disconnected"] .overview-state-dot { color: var(--overview-attention); }
        .monitor-overview p { margin: 0; }
        .monitor-overview .overview-meta { color: var(--overview-muted); font-size: .84rem; }
        .monitor-overview .overview-empty { color: var(--overview-muted); margin: 13px 0 17px; max-width: 45ch; }
        .monitor-overview .overview-session-title { margin-top: 10px; font-weight: 550; }
        .overview-reading { display: flex; justify-content: space-between; align-items: baseline; gap: 4px 12px; flex-wrap: wrap; margin-top: 18px; }
        .overview-reading strong { font-size: clamp(1.35rem, 2.9vw, 2.1rem); line-height: 1.2; font-weight: 620; letter-spacing: -.025em; }
        .overview-reading div > span { color: var(--overview-muted); }
        .overview-reading, .overview-percent, .overview-quota-heading strong, .overview-metrics dd { font-variant-numeric: tabular-nums; }
        .overview-percent { font-size: .98rem; font-weight: 600; }
        .overview-meter { position: relative; margin: 8px 0 7px; height: 7px; border-radius: 3px; background: var(--overview-track); overflow: hidden; }
        .overview-meter span { display: block; height: 100%; background: var(--overview-fill); }
        .overview-meter.is-attention span { background: var(--overview-attention); }
        .overview-notices { margin: 12px 0; padding-inline-start: 18px; font-size: .87rem; }
        .overview-quotas { padding: 0; margin: 4px 0 12px; list-style: none; }
        .overview-quota-row { padding-block: 11px 12px; }
        .overview-quota-row + .overview-quota-row { border-top: 1px solid var(--overview-rule); }
        .overview-quota-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 6px 12px; }
        .overview-quota-heading > div { min-width: 0; }
        .overview-quota-heading strong { flex: 0 0 auto; font-weight: 620; font-size: 1.06rem; }
        .overview-details { margin: 15px 0 9px; border-block: 1px solid var(--overview-rule); padding: 0; }
        .overview-details summary { padding-block: 7px; cursor: pointer; font-weight: 550; }
        .overview-metrics { margin: 3px 0 13px; }
        .overview-metric { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding-block: 3px; }
        .overview-metric dt { color: var(--overview-muted); }
        .overview-metric dd { max-width: 24ch; margin: 0; text-align: end; }
        .overview-action { border: 1px solid transparent; font: inherit; font-weight: 550; background: transparent; color: var(--overview-accent); padding: 5px 6px; margin-inline-start: -7px; cursor: pointer; border-radius: 4px; display: inline-flex; align-items: center; gap: 6px; text-align: start; }
        .overview-action svg { flex-shrink: 0; transition: translate 150ms ease-out; }
        .overview-action:hover { background: var(--vscode-toolbar-hoverBackground, var(--color-surface-hover)); text-decoration: underline; text-underline-offset: .18em; }
        .overview-action:hover svg { translate: 2px 0; }
        .monitor-overview :focus-visible { outline: 2px solid var(--overview-focus); outline-offset: 2px; }
        .overview-footer { display: flex; justify-content: space-between; align-items: baseline; gap: 6px 16px; flex-wrap: wrap; padding-top: 15px; }
        .overview-footer p { display: flex; gap: 3px 10px; flex-wrap: wrap; align-items: baseline; }
        @media (max-width: 640px) {
            .overview-grid { display: block; }
            .overview-context { padding-inline-end: 0; }
            .overview-quota { padding-inline-start: 0; border-inline-start: 0; border-top: 1px solid var(--overview-rule); }
        }
        .vscode-high-contrast .overview-action, .vscode-high-contrast-light .overview-action { border-color: var(--overview-rule); margin-inline-start: 0; }
        .vscode-high-contrast .overview-meter, .vscode-high-contrast-light .overview-meter { outline: 1px solid var(--overview-rule); }
        @media (prefers-reduced-motion: reduce) { .overview-action svg { transition: none; } }
    `;
}

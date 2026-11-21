import { aiCreditTotal } from './account-credits';
import { formatNumber, getLanguage, tBi } from './i18n';
import { getDaysUntilBillingDay } from './billing-day';
import {
    extractOverviewTelemetry, formatCompactTokens, formatOverviewCost, formatOverviewSavings,
    formatQuotaWindowPercent, getContextReading, getContextRemaining, quotaPercentage,
    resolveActiveOrchestratorRoute, selectMonitorQuotaGroups, usableCount,
    type MonitorStatus, type OverviewTelemetryInput, type OverviewTelemetrySnapshot,
} from './monitor-overview';
import type { ModelQuotaGroup } from './model-quota';
import {
    isShowModelShortId,
    localizePickerEffortLabel,
    normalizeModelDisplayName,
    resolveModelId,
    type ModelConfig,
    type QuotaWindowSummary,
    type UserStatusInfo,
} from './models';
import { formatResetAbsolute } from './reset-time';
import { calculateCompressionStats } from './statusbar';
import { formatCachePercent, formatLatency, formatSpeed, type CacheState } from './telemetry-metrics';
import type { ContextUsage } from './tracker';
import { esc, tBiHtml } from './webview-helpers';

const arrow = '<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h9m-4-4 4 4-4 4"/></svg>';

type MeterTone = 'default' | 'healthy' | 'warn' | 'attention';

function number(value: unknown, digits = 0): string {
    return usableCount(value) ? formatNumber(value, {
        maximumFractionDigits: digits,
    }) : '—';
}

function metric(labelHtml: string, valueHtml: string): string {
    return `<div class="overview-metric"><dt>${labelHtml}</dt><dd>${valueHtml}</dd></div>`;
}

function contextMeterTone(percent: number): MeterTone {
    if (percent >= 80) { return 'attention'; }
    if (percent >= 65) { return 'warn'; }
    return 'default';
}

function quotaMeterTone(percent: number): MeterTone {
    if (percent <= 20) { return 'attention'; }
    if (percent < 50) { return 'warn'; }
    return 'healthy';
}

function meter(label: string, value: number, spoken: string, tone: MeterTone): string {
    const fill = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    const toneClass = tone === 'default' ? '' : ` is-${tone}`;
    return `<div class="overview-meter${toneClass}" role="meter"
        aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${fill}" aria-valuetext="${esc(spoken)}">
        <span aria-hidden="true" style="width:${fill}%"></span>
    </div>`;
}

function statusHeadingHtml(state: MonitorStatus['state']): string {
    switch (state) {
        case 'connecting': return tBiHtml('Connecting to Antigravity', '正在连接 Antigravity');
        case 'disconnected': return tBiHtml('Backend disconnected', '后端连接已断开');
        case 'empty': return tBiHtml('No active conversation', '无活跃会话');
        case 'idle': return tBiHtml('Conversation idle', '会话空闲');
        case 'active': return tBiHtml('Active conversation', '会话进行中');
    }
}

function backendMessageHtml(issue: MonitorStatus['backendIssue']): string {
    if (issue === 'notFound') {
        return tBiHtml(
            'Antigravity backend not found. Waiting for the language server or agy hub.',
            '未找到 Antigravity 后端，正在等待语言服务器或 agy hub 启动。',
        );
    }
    if (issue === 'lost') {
        return tBiHtml(
            'Connection to the Antigravity backend was lost. Reconnecting...',
            '与 Antigravity 后端的连接已断开，正在重新连接...',
        );
    }
    return tBiHtml(
        'Unable to read the local backend. Refresh to try again.',
        '无法读取本地后端，请刷新后重试。',
    );
}

function modelFamilyCountHtml(count: number): string {
    return tBiHtml(count === 1 ? '1 model' : `${count} models`, `${count} 个模型`);
}

function formatResetDurationHtml(resetTime: string | null | undefined, now: number): string {
    if (!resetTime) { return tBiHtml('Reset time unavailable', '暂无重置时间'); }
    const at = Date.parse(resetTime);
    if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(now)) {
        return tBiHtml('Reset time unavailable', '暂无重置时间');
    }
    const minutes = Math.ceil((at - now) / 60_000);
    let remaining: string;
    if (minutes <= 0) {
        remaining = tBiHtml('Reset time passed', '已到重置时间');
    } else {
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        const remMinutes = minutes % 60;
        if (days > 0) {
            remaining = remHours > 0
                ? tBiHtml(`${days}d ${remHours}h`, `${days} 天 ${remHours} 小时`)
                : tBiHtml(`${days}d`, `${days} 天`);
        } else if (hours > 0) {
            remaining = remMinutes > 0
                ? tBiHtml(`${hours}h ${remMinutes}m`, `${hours} 小时 ${remMinutes} 分钟`)
                : tBiHtml(`${hours}h`, `${hours} 小时`);
        } else {
            remaining = tBiHtml(`${minutes}m`, `${minutes} 分钟`);
        }
    }
    return `${remaining} · ${esc(formatResetAbsolute(resetTime))}`;
}

function quotaResetHtml(group: Pick<ModelQuotaGroup, 'resetDiffers' | 'resetTime'>, now: number): string {
    if (group.resetDiffers) { return tBiHtml('Reset times vary', '重置时间不同'); }
    return formatResetDurationHtml(group.resetTime, now);
}

function dualQuotaWindowHtml(
    groupLabel: string,
    kind: '5h' | 'weekly',
    win: QuotaWindowSummary,
    now: number,
): string {
    const labelHtml = kind === '5h' ? tBiHtml('5-Hour', '5 小时') : tBiHtml('Weekly', '每周');
    const labelPlain = kind === '5h' ? tBi('5-Hour', '5 小时') : tBi('Weekly', '每周');
    const rawFrac = win.remainingFraction;
    const validFrac = typeof rawFrac === 'number' && Number.isFinite(rawFrac) && rawFrac >= 0 && rawFrac <= 1 ? rawFrac : null;
    const unknown = validFrac === null;
    const pctText = unknown ? tBi('Unknown', '未知') : formatQuotaWindowPercent(validFrac);
    const pctHtml = unknown ? `<span class="overview-quota-unknown">${tBiHtml('Unknown', '未知')}</span>` : `<strong>${esc(pctText)}</strong>`;
    const meterHtml = unknown
        ? '<div class="overview-meter is-unknown" aria-hidden="true"></div>'
        : meter(`${groupLabel} · ${labelPlain}`, validFrac * 100, pctText, quotaMeterTone(validFrac * 100));
    return `<div class="quota-dual-item" data-quota-window="${kind}">
        <div class="quota-dual-head">
            <span class="quota-dual-label">${labelHtml}</span>
            <span class="quota-dual-pct">${pctHtml}</span>
        </div>
        ${meterHtml}
        <p class="overview-meta quota-dual-reset">${formatResetDurationHtml(win.resetTime, now)}</p>
    </div>`;
}

function creditExpiryHtml(days: number | null): string {
    if (days === null || !Number.isFinite(days) || days < 0) {
        return tBiHtml('Expiry date not set', '未设置到期日');
    }
    if (days === 0) {
        return tBiHtml('Expires today', '今日到期');
    }
    return tBiHtml(days === 1 ? 'Expires in 1 day' : `Expires in ${days} days`, `${days} 天后到期`);
}

function cacheWarmthMeta(state: CacheState): { cls: string; html: string } | null {
    switch (state) {
        case 'warm':
            return { cls: 'is-warm', html: tBiHtml('Warm', '已命中') };
        case 'warming':
            return { cls: 'is-warming', html: tBiHtml('Warming', '预热中') };
        case 'cold':
            return { cls: 'is-cold', html: tBiHtml('Cold', '未命中') };
        default:
            return null;
    }
}

function buildCostTelemetryCell(
    sessionCostUsd: number | undefined,
    todayCostUsd: number | undefined,
): string {
    const sessionStr = formatOverviewCost(sessionCostUsd);
    const todayStr = formatOverviewCost(todayCostUsd);
    if (!sessionStr && !todayStr) { return ''; }
    if (sessionStr) {
        const subHtml = todayStr ? `<span class="overview-telemetry-sub">${tBiHtml('Today', '今日')} ${esc(todayStr)}</span>` : '';
        return `<div class="overview-telemetry-cell" data-telemetry-cell="cost">
            <span class="overview-telemetry-label">${tBiHtml('Session Cost', '会话费用')}</span>
            <strong class="overview-telemetry-value">${esc(sessionStr)}</strong>
            ${subHtml}
        </div>`;
    }
    return `<div class="overview-telemetry-cell" data-telemetry-cell="cost">
        <span class="overview-telemetry-label">${tBiHtml('Today Cost', '今日费用')}</span>
        <strong class="overview-telemetry-value">${esc(todayStr!)}</strong>
    </div>`;
}

function telemetryStrip(
    snapshot: OverviewTelemetrySnapshot,
    sessionCostUsd?: number,
    todayCostUsd?: number,
): string {
    const { primary, primaryScope, speedPrimary, ttftPrimary } = snapshot;

    // 1. Speed
    const speedValue = formatSpeed(speedPrimary);
    const speedClass = speedPrimary === null ? ' is-muted' : '';
    let speedSubHtml = '';
    if (primary.hasThinking && primary.weightedVisibleTokPerSec !== null) {
        speedSubHtml = esc(`resp ${formatSpeed(primary.weightedVisibleTokPerSec)}`);
    } else if (
        primary.latestGenTokPerSec !== null
        && primary.weightedGenTokPerSec !== null
        && formatSpeed(primary.latestGenTokPerSec) !== formatSpeed(primary.weightedGenTokPerSec)
    ) {
        speedSubHtml = esc(`avg ${formatSpeed(primary.weightedGenTokPerSec)}`);
    }
    const speedTipParts: string[] = [];
    if (primary.latestGenTokPerSec !== null) {
        speedTipParts.push(`${tBi('Latest', '最近')}: ${formatSpeed(primary.latestGenTokPerSec)}`);
    }
    if (primary.weightedGenTokPerSec !== null) {
        speedTipParts.push(`${tBi('Weighted Avg', '加权平均')}: ${formatSpeed(primary.weightedGenTokPerSec)}`);
    }
    if (primary.hasThinking && primary.weightedVisibleTokPerSec !== null) {
        speedTipParts.push(`${tBi('Visible Speed', '可见速度')}: ${formatSpeed(primary.weightedVisibleTokPerSec)}`);
    }
    const speedTitleAttr = speedTipParts.length ? ` title="${esc(speedTipParts.join(' · '))}"` : '';

    // 2. TTFT
    const ttftValue = formatLatency(ttftPrimary);
    const ttftClass = ttftPrimary === null ? ' is-muted' : '';
    let ttftSubHtml = '';
    if (primary.cachedAvgTtftSeconds !== null) {
        ttftSubHtml = esc(`cached ${formatLatency(primary.cachedAvgTtftSeconds)}`);
    } else if (primary.medianTtftSeconds !== null) {
        ttftSubHtml = esc(`p50 ${formatLatency(primary.medianTtftSeconds)}`);
    }
    const ttftTipParts: string[] = [];
    if (primary.avgTtftSeconds !== null) {
        ttftTipParts.push(`${tBi('Avg TTFT', '平均首字延迟')}: ${formatLatency(primary.avgTtftSeconds)}`);
    }
    if (primary.cachedAvgTtftSeconds !== null) {
        ttftTipParts.push(`${tBi('Cached TTFT', '缓存命中首字')}: ${formatLatency(primary.cachedAvgTtftSeconds)}`);
    }
    if (primary.uncachedAvgTtftSeconds !== null) {
        ttftTipParts.push(`${tBi('Uncached TTFT', '未命中首字')}: ${formatLatency(primary.uncachedAvgTtftSeconds)}`);
    }
    const ttftTitleAttr = ttftTipParts.length ? ` title="${esc(ttftTipParts.join(' · '))}"` : '';

    // 3. Cache Hit
    const cacheHitValue = formatCachePercent(primary.tokenCacheHitRate);
    const cacheHitClass = primary.tokenCacheHitRate !== null && primary.tokenCacheHitRate > 0
        ? ' is-cache'
        : ' is-muted';
    const cacheHitSubHtml = primary.totalCacheReadTokens > 0
        ? esc(`${formatCompactTokens(primary.totalCacheReadTokens)} · ${primary.cachedCallCount}/${primary.totalCalls}`)
        : (primary.totalCalls > 0 ? esc(`${primary.cachedCallCount}/${primary.totalCalls}`) : '');
    const cacheHitTitleAttr = primary.totalPromptTokens > 0
        ? ` title="${esc(`${formatCompactTokens(primary.totalCacheReadTokens)} / ${formatCompactTokens(primary.totalPromptTokens)} tokens · ${primary.cachedCallCount}/${primary.totalCalls}`)}"`
        : '';

    // 4. Cache Saved (USD)
    const savingsFormatted = formatOverviewSavings(primary.estCacheSavingsUsd);
    let savedValueHtml: string;
    let savedClass = '';
    let savedTitleAttr = '';
    if (savingsFormatted !== null) {
        savedValueHtml = esc(savingsFormatted);
        if (primary.estCacheSavedTokens > 0) {
            savedTitleAttr = ` title="${esc(`${savingsFormatted} · ${formatCompactTokens(primary.estCacheSavedTokens)} tokens`)}"`;
        }
    } else if (primary.estCacheSavedTokens > 0) {
        savedValueHtml = `${esc(formatCompactTokens(primary.estCacheSavedTokens))} tokens`;
        savedTitleAttr = ` title="${esc(`${formatCompactTokens(primary.estCacheSavedTokens)} tokens`)}"`;
    } else {
        savedValueHtml = '—';
        savedClass = ' is-muted';
    }
    const warmth = cacheWarmthMeta(primary.latestCacheState);
    const costCellHtml = buildCostTelemetryCell(sessionCostUsd, todayCostUsd);

    const ariaLabel = primaryScope === 'active'
        ? tBi('Active conversation speed and prompt cache', '当前会话速度与提示词缓存')
        : tBi('Session speed and prompt cache', '会话速度与提示词缓存');

    return `<div class="overview-telemetry-strip${costCellHtml ? ' has-cost' : ''}" data-telemetry-scope="${primaryScope}" role="group" aria-label="${esc(ariaLabel)}">
        <div class="overview-telemetry-cell"${speedTitleAttr}>
            <span class="overview-telemetry-label">${tBiHtml('Speed', '生成速度')}</span>
            <strong class="overview-telemetry-value${speedClass}">${esc(speedValue)}</strong>
            ${speedSubHtml ? `<span class="overview-telemetry-sub">${speedSubHtml}</span>` : ''}
        </div>
        <div class="overview-telemetry-cell"${ttftTitleAttr}>
            <span class="overview-telemetry-label">${tBiHtml('TTFT', '首字延迟')}</span>
            <strong class="overview-telemetry-value${ttftClass}">${esc(ttftValue)}</strong>
            ${ttftSubHtml ? `<span class="overview-telemetry-sub">${ttftSubHtml}</span>` : ''}
        </div>
        <div class="overview-telemetry-cell"${cacheHitTitleAttr}>
            <span class="overview-telemetry-label">${tBiHtml('Cache Hit', '缓存命中')}</span>
            <strong class="overview-telemetry-value${cacheHitClass}">${esc(cacheHitValue)}</strong>
            ${cacheHitSubHtml ? `<span class="overview-telemetry-sub">${cacheHitSubHtml}</span>` : ''}
        </div>
        <div class="overview-telemetry-cell"${savedTitleAttr}>
            <span class="overview-telemetry-label">${tBiHtml('Cache Saved', '缓存节省')}</span>
            <strong class="overview-telemetry-value${savedClass}">${savedValueHtml}</strong>
            ${warmth ? `<span class="overview-telemetry-sub ${warmth.cls}">${warmth.html}</span>` : ''}
        </div>
        ${costCellHtml}
    </div>`;
}

function sessionDetails(usage: ContextUsage, telemetryHtml = ''): string {
    const reading = getContextReading(usage);
    const remaining = getContextRemaining(reading.used, reading.limit);
    const tokenUnit = 'tokens';
    const compression = calculateCompressionStats(usage);
    const last = usage.lastModelUsage;
    const isPlanner = usage.tokenUsageSource === 'planner';
    const modelLabel = localizePickerEffortLabel(resolveModelId(usage.model) || usage.model, usage.modelDisplayName, getLanguage());
    const activeRoute = resolveActiveOrchestratorRoute(usage);
    const routePillHtml = activeRoute
        ? `<div class="orch-route-pill" data-cross-pool="${activeRoute.isCrossPool ? 'true' : 'false'}">
            <span class="orch-route-label">${tBiHtml('Orchestrator', '编排器')}</span>
            <span class="orch-route-pair">${esc(activeRoute.plannerLabel)} <span class="orch-route-arrow" aria-hidden="true">→</span> ${esc(activeRoute.executorLabel)}</span>
            ${activeRoute.isCrossPool ? `<span class="orch-route-badge">${tBiHtml('Cross-pool', '跨配额池')}</span>` : ''}
        </div>`
        : '';
    const contextLabel = tBi('Context used', '上下文占用');
    const ratio = reading.percent === null ? '—' : `${number(reading.percent, 1)}%`;
    const precisionHtml = usage.isEstimated ? tBiHtml('Estimated', '估算') : tBiHtml('Measured', '实测');
    const warnings = [
        ...(usage.hasGaps ? [tBiHtml('Data may be incomplete (some step batches failed to load)', '数据可能不完整（部分步骤批次加载失败）')] : []),
        ...(reading.percent !== null && reading.percent > 100
            ? [tBiHtml('Above the context limit', '已超过上下文上限')] : []),
        ...(usage.imageGenerationIncomplete
            ? [tBiHtml('Image workflow data is incomplete', '图片工作流数据不完整')] : []),
    ];
    const diagnostics = [
        metric(tBiHtml('Model Output', '模型输出'), esc(number(usage.totalOutputTokens))),
        metric(tBiHtml('Tool Results', '工具结果'), esc(number(usage.totalToolCallOutputTokens))),
        metric(tBiHtml('Steps', '步骤数'), esc(number(usage.stepCount))),
    ];
    if (usage.compressionDetected) {
        const label = compression?.source === 'checkpoint'
            ? tBiHtml('Checkpoint Input Drop', '检查点输入压缩量')
            : tBiHtml('Context Drop', '上下文压缩量');
        diagnostics.push(metric(label, esc(compression ? `${number(compression.dropTokens)} ${tokenUnit} · ${number(compression.dropPercent, 1)}%` : '—')));
        if (usableCount(usage.previousContextUsed)) {
            diagnostics.push(metric(tBiHtml('Before', '压缩前'), esc(number(usage.previousContextUsed))));
            diagnostics.push(metric(tBiHtml('After', '压缩后'), esc(number(reading.used))));
        }
    }
    if (usage.estimatedDeltaSinceCheckpoint > 0) {
        const source = isPlanner
            ? tBiHtml('since last model call', '自上次模型调用')
            : tBiHtml('since last checkpoint', '自上次检查点');
        diagnostics.push(metric(tBiHtml('Est. delta', '估算增量'), `+${esc(number(usage.estimatedDeltaSinceCheckpoint))} · ${source}`));
    }
    if (usage.imageGenStepCount > 0) {
        const models = usage.imageGenerationModels?.map(normalizeModelDisplayName).join(' · ');
        diagnostics.push(metric(tBiHtml('Image Gen', '图片生成'), esc(number(usage.imageGenStepCount))));
        if (models) { diagnostics.push(metric(tBiHtml('Image model', '图片模型'), esc(models))); }
    }
    const checkpointId = !isPlanner && isShowModelShortId() && usage.checkpointModel
        ? ` · ${usage.checkpointModel.replace(/^MODEL_PLACEHOLDER_/, '')}` : '';

    return `<div class="overview-session">
        ${usage.title ? `<p class="overview-session-title">${esc(usage.title)}</p>` : ''}
        <p class="overview-meta">${modelLabel ? `${esc(modelLabel)} · ` : ''}${precisionHtml}</p>
        ${routePillHtml}
        <div class="overview-reading">
            <div><strong>${number(reading.used)}</strong><span> / ${number(reading.limit)} ${tokenUnit}</span></div>
            <span class="overview-percent">${ratio}</span>
        </div>
        ${reading.percent === null
            ? `<p class="overview-meta">${tBiHtml('Context measurement unavailable', '暂无上下文计量')}</p>`
            : meter(contextLabel, reading.percent, ratio, contextMeterTone(reading.percent))}
        ${remaining !== null
            ? `<p class="overview-meta">${tBiHtml('Remaining', '可用余量')} · ${number(remaining.tokens)} ${tokenUnit}</p>` : ''}
        ${telemetryHtml}
        ${warnings.length ? `<ul class="overview-notices">${warnings.map(warning => `<li>${warning}</li>`).join('')}</ul>` : ''}
        <details id="overview-session-diagnostics" class="overview-details" data-state-key="overview-diagnostics:${esc(usage.cascadeId)}">
            <summary data-overview-focus="diagnostics"><span>${tBiHtml('Session diagnostics', '会话诊断')}</span></summary>
            <dl class="overview-metrics">${diagnostics.join('')}</dl>
            ${last ? `<h3>${isPlanner ? tBiHtml('Latest Model Usage', '最近模型用量') : tBiHtml('Last Checkpoint', '最近检查点')}${esc(checkpointId)}</h3>
                <dl class="overview-metrics">
                    ${metric(tBiHtml('Input', '输入'), esc(number(last.inputTokens)))}
                    ${metric(tBiHtml('Output', '输出'), esc(number(last.outputTokens)))}
                    ${metric(tBiHtml('Cache', '缓存'), esc(number(last.cacheReadTokens)))}
                    ${metric(tBiHtml('Cache creation', '缓存创建'), esc(number(last.cacheCreationTokens ?? 0)))}
                </dl>` : ''}
        </details>
    </div>`;
}

function action(tab: 'models' | 'gmdata' | 'settings', labelHtml: string): string {
    return `<button type="button" class="overview-action" data-overview-target="${tab}" data-overview-focus="${tab}"><span>${labelHtml}</span> ${arrow}</button>`;
}

export function buildOverviewTabContent(
    usage: ContextUsage | null,
    configs: readonly ModelConfig[],
    userInfo: UserStatusInfo | null,
    billingDay = 0,
    status: MonitorStatus = { state: usage ? 'active' : configs.length || userInfo ? 'empty' : 'connecting' },
    now = Date.now(),
    telemetry?: OverviewTelemetryInput,
): string {
    const connected = status.state !== 'connecting' && status.state !== 'disconnected';
    const active = status.state === 'active' ? usage : null;
    const telemetryData = connected
        ? extractOverviewTelemetry(
            telemetry?.gmSummary,
            telemetry?.activeCascadeId || active?.cascadeId,
            telemetry?.customPricing,
        )
        : null;
    let telemetryHtml = telemetryData
        ? telemetryStrip(telemetryData, telemetry?.sessionCostUsd, telemetry?.todayCostUsd)
        : '';
    if (!telemetryHtml && connected) {
        const standaloneCost = buildCostTelemetryCell(telemetry?.sessionCostUsd, telemetry?.todayCostUsd);
        if (standaloneCost) {
            telemetryHtml = `<div class="overview-telemetry-strip is-cost-only" data-telemetry-scope="cost" role="group" aria-label="${esc(tBi('Session and today cost', '会话与今日费用'))}">${standaloneCost}</div>`;
        }
    }
    const groups = connected ? selectMonitorQuotaGroups(configs, active?.model, telemetry?.quotaSummary) : [];
    const activeRoute = active ? resolveActiveOrchestratorRoute(active) : null;
    const credits = aiCreditTotal(userInfo?.availableCredits || []);
    const expiryHtml = creditExpiryHtml(getDaysUntilBillingDay(billingDay, new Date(now)));
    const plan = userInfo ? [...new Set([userInfo.planName, userInfo.userTierName].filter(Boolean))].join(' · ') : '';
    const quotaTitlePlain = tBi('Quota remaining', '剩余配额');
    const quotaTitleHtml = tBiHtml('Quota remaining', '剩余配额');
    const quotaRows = groups.map(group => {
        const band = quotaPercentage(group);
        const unknownQuota = group.minimum === null;
        const partial = (group.missingQuota && group.minimum !== null) || (group.missingReset && group.resetTime);
        const hasDualWindow = Boolean(group.fiveHourQuota || group.weeklyQuota);
        const poolRoleTag = activeRoute?.isCrossPool && group.pool
            ? (activeRoute.plannerPool === group.pool
                ? ` <span class="orch-route-badge">${tBiHtml('Planner', '规划')}</span>`
                : activeRoute.executorPool === group.pool
                    ? ` <span class="orch-route-badge">${tBiHtml('Executor', '执行')}</span>`
                    : '')
            : '';
        const dualHtml = hasDualWindow
            ? `<div class="quota-dual-row">
                ${group.fiveHourQuota ? dualQuotaWindowHtml(group.label, '5h', group.fiveHourQuota, now) : ''}
                ${group.weeklyQuota ? dualQuotaWindowHtml(group.label, 'weekly', group.weeklyQuota, now) : ''}
            </div>`
            : `${unknownQuota
                ? '<div class="overview-meter is-unknown" aria-hidden="true"></div>'
                : meter(`${group.label} · ${quotaTitlePlain}`, group.minimum! * 100, band, quotaMeterTone(group.minimum! * 100))}
            <p class="overview-meta">${quotaResetHtml(group, now)}${partial ? ` · ${tBiHtml('Partial data', '数据不完整')}` : ''}</p>`;
        return `<li class="overview-quota-row">
            <div class="overview-quota-heading">
                <div><h3>${esc(group.label)}${poolRoleTag}</h3><span class="overview-meta">${modelFamilyCountHtml(group.members.length)}</span></div>
                ${hasDualWindow
                    ? ''
                    : (unknownQuota
                        ? `<strong class="overview-quota-unknown">${tBiHtml('Unknown', '未知')}</strong>`
                        : `<strong>${esc(band)}</strong>`)}
            </div>
            ${dualHtml}
            ${group.pool ? `<p class="overview-model-families">${group.members.map(member => esc(member.label)).join(' · ')}</p>` : ''}
        </li>`;
    }).join('');
    const emptyContextHtml = status.state === 'idle'
        ? tBiHtml('No context measurement for this conversation yet.', '当前会话暂无上下文计量。')
        : tBiHtml('Open an Antigravity conversation to see its context usage.', '打开 Antigravity 会话后即可查看上下文用量。');

    return `<section class="monitor-overview" data-monitor-overview data-monitor-state="${status.state}" aria-labelledby="overview-heading">
        <header class="overview-header">
            <h2 id="overview-heading" data-overview-focus="heading" tabindex="-1">${tBiHtml('Context & quota', '上下文与配额')}</h2>
            ${connected && plan ? `<p class="overview-meta overview-plan-pill">${esc(plan)}</p>` : ''}
        </header>
        ${connected ? `<div class="overview-grid">
            <section class="overview-context" aria-labelledby="overview-context-heading">
                <h3 id="overview-context-heading" class="overview-section-heading"><span class="overview-state-dot" aria-hidden="true"></span><span>${statusHeadingHtml(status.state)}</span></h3>
                ${active ? sessionDetails(active, telemetryHtml) : `<p class="overview-empty">${emptyContextHtml}</p>${telemetryHtml}`}
                ${action('gmdata', tBiHtml('View model activity', '查看模型活动'))}
            </section>
            <section class="overview-quota" aria-labelledby="overview-quota-heading">
                <h3 id="overview-quota-heading" class="overview-section-heading"><span>${quotaTitleHtml}</span></h3>
                ${quotaRows ? `<ul class="overview-quotas">${quotaRows}</ul>`
                    : `<p class="overview-empty">${tBiHtml('Waiting for quota data.', '等待配额数据。')}</p>`}
                ${action('models', tBiHtml('View models', '查看模型'))}
            </section>
        </div>` : `<div class="overview-connection">
            <h3 class="overview-section-heading"><span class="overview-state-dot" aria-hidden="true"></span><span>${statusHeadingHtml(status.state)}</span></h3>
            <p class="overview-empty">${status.state === 'disconnected'
                ? backendMessageHtml(status.backendIssue)
                : tBiHtml('Waiting for the local backend.', '正在等待本地后端。')}</p>
        </div>`}
        <footer class="overview-footer">
            ${connected && (userInfo || billingDay > 0) ? `<p>
                <span>${tBiHtml('AI credits', 'AI 积分')}</span>
                ${credits === null ? `<span class="overview-meta">${tBiHtml('Not reported', '未上报')}</span>` : `<strong>${number(credits)}</strong>`}
                <span class="overview-meta">${expiryHtml}</span>
            </p>` : ''}
            ${action('settings', tBiHtml('Status bar settings', '状态栏设置'))}
        </footer>
    </section>`;
}

export function getOverviewStyles(): string {
    return `
        .monitor-overview {
            --overview-rule: var(--ed-border, var(--vscode-contrastBorder, var(--vscode-widget-border, #323C4C)));
            --overview-muted: var(--ed-ink-muted, var(--vscode-descriptionForeground, var(--vscode-foreground)));
            --overview-accent: var(--ed-accent, var(--vscode-textLink-foreground, #5B9CF6));
            --overview-focus: var(--ed-accent, var(--vscode-focusBorder, var(--overview-accent)));
            --overview-track: var(--ed-track, var(--vscode-scrollbarSlider-background, #232B38));
            --overview-fill: var(--ed-accent, var(--vscode-progressBar-background, var(--overview-accent)));
            --overview-good: var(--ed-good-fill, #10B981);
            --overview-warn: var(--ed-warn-fill, #F59E0B);
            --overview-attention: var(--ed-danger-fill, var(--vscode-editorError-foreground, #EF4444));
            width: min(100%, 1120px);
            margin-inline: auto;
            padding: clamp(16px, 3vw, 28px) clamp(12px, 3vw, 28px) 32px;
            color: var(--ed-ink, var(--vscode-foreground));
            line-height: 1.54;
            overflow-wrap: anywhere;
        }
        .monitor-overview *, .monitor-overview *::before { box-sizing: border-box; }
        .overview-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px 16px;
            padding-bottom: 18px;
            margin: 0;
        }
        .overview-header h2 {
            color: inherit;
            margin: 0;
            padding: 0;
            font-size: clamp(1.3rem, 2.4vw, 1.5rem);
            font-weight: 550;
            line-height: 1.24;
            letter-spacing: -.02em;
        }
        .overview-header .overview-meta { margin-top: 0; }
        .overview-plan-pill {
            display: inline-flex;
            align-items: center;
            padding: 2px 10px;
            border-radius: var(--ed-radius-pill, 9999px);
            background: var(--ed-surface-well, transparent);
            border: 1px solid var(--overview-rule);
            color: var(--ed-ink-secondary, var(--overview-muted));
            font-size: .75rem;
            font-weight: 500;
        }
        .overview-grid { display: grid; grid-template-columns: minmax(0, 1.18fr) minmax(0, 1fr); gap: 16px; align-items: start; }
        .overview-context, .overview-quota, .overview-connection {
            padding: 18px 20px;
            min-width: 0;
            background: var(--ed-surface, transparent);
            border: 1px solid var(--overview-rule);
            border-radius: var(--ed-radius-md, 10px);
        }
        .monitor-overview h3 { margin: 0; padding: 0; color: inherit; font-size: .875rem; font-weight: 600; }
        .monitor-overview .overview-section-heading { display: flex; gap: 8px; align-items: center; font-size: .9375rem; }
        .overview-state-dot { flex: 0 0 8px; height: 8px; border-radius: 50%; background: currentColor; color: var(--overview-muted); align-self: center; }
        [data-monitor-state="active"] .overview-state-dot { color: var(--ed-good, var(--overview-good)); }
        [data-monitor-state="disconnected"] .overview-state-dot { color: var(--ed-danger, var(--overview-attention)); }
        .monitor-overview p { margin: 0; }
        .monitor-overview .overview-meta { color: var(--overview-muted); font-size: .75rem; }
        .monitor-overview .overview-empty { color: var(--overview-muted); margin: 13px 0 17px; max-width: 45ch; }
        .monitor-overview .overview-session-title { margin-top: 10px; font-size: .875rem; font-weight: 600; }
        .overview-reading { display: flex; justify-content: space-between; align-items: baseline; gap: 4px 12px; flex-wrap: wrap; margin-top: 16px; }
        .overview-reading strong { font-size: clamp(1.45rem, 2.6vw, 1.75rem); line-height: 1.15; font-weight: 650; letter-spacing: -.025em; }
        .overview-reading div > span { color: var(--overview-muted); font-size: .8125rem; }
        .overview-reading, .overview-percent, .overview-quota-heading strong, .overview-metrics dd, .overview-telemetry-value, .overview-telemetry-sub { font-variant-numeric: tabular-nums lining-nums; }
        .overview-percent { font-size: .9375rem; font-weight: 600; }
        .overview-meter { position: relative; margin: 9px 0 8px; height: 6px; border-radius: var(--ed-radius-pill, 9999px); background: var(--overview-track); overflow: hidden; }
        .overview-meter span { display: block; height: 100%; border-radius: var(--ed-radius-pill, 9999px); background: var(--overview-fill); transition: width 260ms var(--ed-ease, cubic-bezier(0.2, 0, 0, 1)); }
        .overview-meter.is-healthy span { background: var(--overview-good); }
        .overview-meter.is-warn span { background: var(--overview-warn); }
        .overview-meter.is-attention span { background: var(--overview-attention); }
        .overview-meter.is-unknown { opacity: .75; }
        .overview-telemetry-strip {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px 12px;
            margin: 12px 0 10px;
            padding: 10px 12px;
            background: var(--ed-surface-well, var(--vscode-editorWidget-background, transparent));
            border: 1px solid var(--overview-rule);
            border-radius: var(--ed-radius-sm, 6px);
        }
        .overview-telemetry-strip.has-cost {
            grid-template-columns: repeat(5, minmax(0, 1fr));
        }
        .overview-telemetry-strip.is-cost-only {
            grid-template-columns: minmax(0, 1fr);
        }
        .overview-telemetry-cell {
            display: flex;
            flex-direction: column;
            gap: 2px;
            min-width: 0;
        }
        .overview-telemetry-label {
            display: block;
            min-width: 0;
            font-size: .72rem;
            font-weight: 500;
            line-height: 1.35;
            color: var(--ed-ink-muted, var(--overview-muted));
        }
        .overview-telemetry-value {
            display: block;
            min-width: 0;
            font-size: .9375rem;
            font-weight: 650;
            line-height: 1.25;
            letter-spacing: -.012em;
            color: var(--ed-ink, var(--vscode-foreground));
        }
        .overview-telemetry-value.is-cache {
            color: var(--ed-chart-cache, var(--ed-good, #34C3A4));
        }
        .overview-telemetry-value.is-muted {
            color: var(--ed-ink-muted, var(--overview-muted));
            font-weight: 550;
        }
        .overview-telemetry-sub {
            display: block;
            min-width: 0;
            font-size: .72rem;
            font-weight: 500;
            line-height: 1.35;
            color: var(--ed-ink-muted, var(--overview-muted));
        }
        .overview-telemetry-sub.is-warm {
            color: var(--ed-good, var(--overview-good));
            font-weight: 550;
        }
        .overview-telemetry-sub.is-warming {
            color: var(--ed-warn, var(--overview-warn));
            font-weight: 550;
        }
        .overview-telemetry-sub.is-cold {
            color: var(--ed-ink-muted, var(--overview-muted));
        }
        .monitor-overview .overview-telemetry-sub:is(.is-warm, .is-warming) :is(.bi-zh, .bi-sep) {
            color: inherit;
        }
        .overview-quota-unknown { color: var(--overview-muted); font-weight: 500; font-size: .8125rem; }
        .overview-notices { margin: 12px 0; padding-inline-start: 18px; font-size: .8125rem; color: var(--ed-warn, var(--overview-warn)); }
        .overview-quotas { padding: 0; margin: 6px 0 12px; list-style: none; }
        .overview-quota-row { padding-block: 11px 12px; }
        .overview-quota-row + .overview-quota-row { border-top: 1px solid var(--overview-rule); }
        .overview-quota-heading { display: flex; justify-content: space-between; align-items: baseline; gap: 6px 12px; }
        .overview-quota-heading > div { min-width: 0; }
        .overview-quota-heading strong { flex: 0 0 auto; font-weight: 650; font-size: 1rem; }
        .monitor-overview .overview-model-families { margin-top: 6px; color: var(--overview-muted); font-size: .75rem; }
        .overview-details { margin: 15px 0 9px; border-block: 1px solid var(--overview-rule); padding: 0; }
        .overview-details summary { padding-block: 8px; cursor: pointer; font-weight: 550; }
        .overview-metrics { margin: 4px 0 12px; }
        .overview-metric { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding-block: 3px; font-size: .8125rem; }
        .overview-metric dt { color: var(--overview-muted); }
        .overview-metric dd { max-width: 24ch; margin: 0; text-align: end; }
        .overview-action { border: 1px solid transparent; font: inherit; font-weight: 550; background: transparent; color: var(--overview-accent); padding: 5px 8px; margin-inline-start: -8px; cursor: pointer; border-radius: var(--ed-radius-sm, 6px); display: inline-flex; align-items: center; gap: 6px; text-align: start; transition: background 150ms var(--ed-ease, ease-out), color 150ms var(--ed-ease, ease-out); }
        .overview-action svg { flex-shrink: 0; transition: transform 150ms var(--ed-ease, ease-out); }
        .overview-action:hover { background: var(--ed-accent-tint, var(--vscode-toolbar-hoverBackground, transparent)); }
        .overview-action:hover svg { transform: translateX(2px); }
        .monitor-overview :focus-visible { outline: 2px solid var(--overview-focus); outline-offset: 2px; }
        .overview-footer { display: flex; justify-content: space-between; align-items: center; gap: 8px 16px; flex-wrap: wrap; margin-top: 16px; padding: 14px 18px; background: var(--ed-surface, transparent); border: 1px solid var(--overview-rule); border-radius: var(--ed-radius-md, 10px); }
        .overview-footer p { display: flex; gap: 4px 10px; flex-wrap: wrap; align-items: baseline; }
        @media (min-width: 681px) and (max-width: 980px), (max-width: 640px) {
            .overview-telemetry-strip,
            .overview-telemetry-strip.has-cost { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 680px) {
            .overview-grid { grid-template-columns: minmax(0, 1fr); }
        }
        @media (max-width: 420px) {
            .overview-telemetry-strip { padding: 10px; gap: 10px; }
        }
        .vscode-high-contrast .overview-action, .vscode-high-contrast-light .overview-action { border-color: var(--overview-rule); margin-inline-start: 0; }
        .vscode-high-contrast .overview-meter, .vscode-high-contrast-light .overview-meter { outline: 1px solid var(--overview-rule); }
        @media (prefers-reduced-motion: reduce) {
            .overview-action, .overview-action svg, .overview-meter span { transition: none; }
        }
    `;
}

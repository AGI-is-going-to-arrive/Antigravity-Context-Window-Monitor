import { aiCreditTotal } from './account-credits';
import { formatClockTime, formatNumber, getLanguage, tBi } from './i18n-core';
import { getDaysUntilBillingDay } from './billing-day';
import {
    formatCurrencyAmount,
    formatDualCurrencyAmount,
    resolveCurrencyConfig,
    type CurrencyInput,
} from './cli-usage-scanner';
import {
    CONTEXT_CATEGORY_META,
    buildDotMatrix,
    type ContextBreakdownSnapshot,
    type ContextCategoryKey,
    type ContextMeasurementState,
} from './context-breakdown';
import type { GMCallEntry, GMConversationData } from './gm/types';
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
import {
    analyzeUserTurnCacheStates,
    buildOrchestratorSplitCardHtml,
    computeContextWatermarks,
    computeOrchestratorSplit,
    evaluateSpeedSample,
    type ContextDualWatermark,
    type OrchestratorSplitSummary,
    type SpeedSampleEvaluation,
    type UserTurnCacheSummary,
} from './orchestrator-attribution';
import type { OrchestratorPricingMode } from './pricing-store';
import type { QuotaRunwayEstimate } from './quota-runway';
import { formatResetAbsolute } from './reset-time';
import { formatCachePercent, formatLatency, formatSpeed, type CacheState } from './telemetry-metrics';
import type { ContextUsage } from './tracker';
import { ICON } from './webview-icons';
import { esc, tBiHtml } from './webview-helpers';

// ─── Pure Compression Stats Helper (shared with statusbar.ts, zero vscode) ───

export interface CompressionStats {
    source: 'context' | 'checkpoint';
    dropTokens: number;
    dropPercent: number;
}

/**
 * Calculate compression amount for UI display.
 */
export function calculateCompressionStats(usage: ContextUsage): CompressionStats | null {
    if (!usage.compressionDetected) { return null; }

    if (usage.previousContextUsed !== undefined && usage.previousContextUsed > usage.contextUsed) {
        const dropTokens = usage.previousContextUsed - usage.contextUsed;
        const dropPercent = usage.previousContextUsed > 0
            ? (dropTokens / usage.previousContextUsed) * 100
            : 0;
        return { source: 'context', dropTokens, dropPercent };
    }

    if (usage.checkpointCompressionDrop > 0) {
        const currentInput = usage.lastModelUsage
            ? usage.lastModelUsage.inputTokens + usage.lastModelUsage.cacheReadTokens + (usage.lastModelUsage.cacheCreationTokens || 0)
            : undefined;
        const previousInput = currentInput !== undefined
            ? currentInput + usage.checkpointCompressionDrop
            : 0;
        const dropPercent = previousInput > 0
            ? (usage.checkpointCompressionDrop / previousInput) * 100
            : 0;
        return { source: 'checkpoint', dropTokens: usage.checkpointCompressionDrop, dropPercent };
    }

    return null;
}

// ─── Shared v1.17.5 / v1.17.6 Types & Banner/Runway Helpers ─────────────────

export interface MonitorStaleState {
    isStale: boolean;
    lastSuccessAtMs: number | null;
    lastError?: string | null;
}

export interface LowQuotaWarningItem {
    poolKey: string;
    label: string;
    remainingPct: number;
    windowLabel?: string;
    resetTime?: string | null;
}

export interface LowQuotaWarningState {
    threshold: number;
    pools: LowQuotaWarningItem[];
}

export interface OverviewExtras extends OverviewTelemetryInput {
    contextBreakdown?: ContextBreakdownSnapshot | null;
    quotaRunways?: Record<string, QuotaRunwayEstimate>;
    isCustomModelActive?: boolean;
    staleState?: MonitorStaleState | null;
    /** v1.17.6: Surface identifier ('ide' | 'app-sidecar'). */
    surface?: 'ide' | 'app-sidecar';
    /** v1.17.6: Orchestrator pricing mode ('mapped' | 'strict'). */
    orchestratorPricingMode?: OrchestratorPricingMode;
    /** v1.17.6: Display currency & optional custom FX rate. */
    displayCurrency?: CurrencyInput;
    /** v1.17.6: Low-quota threshold percentage (0 = disabled, 1..99 = active). */
    quotaNotificationThreshold?: number;
    /** v1.17.6: Explicit pre-computed low-quota warning banner state. */
    lowQuotaWarning?: LowQuotaWarningState | null;
    /** v1.17.6: Pre-computed user-turn cache start & +Δ net growth summary. */
    turnCacheInfo?: UserTurnCacheSummary | null;
    /** v1.17.6: Pre-computed dual context watermarks (compaction limit + 200k tier). */
    watermarks?: ContextDualWatermark | null;
    /** v1.17.6: Pre-computed sparse-sample speed evaluation. */
    speedSample?: SpeedSampleEvaluation | null;
    /** v1.17.6: Pre-computed Orchestrator vs Executor breakdown. */
    orchestratorSplit?: OrchestratorSplitSummary | null;
    /** v1.17.6: Optional per-conversation GM call records for live split/turn analysis. */
    gmConversations?: Record<string, GMConversationData>;
}

export function formatRunwayDurationHtml(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) {
        return tBiHtml('<1m', '<1 分钟');
    }
    const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
    const hours = Math.floor(totalMinutes / 60);
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    const remMinutes = totalMinutes % 60;
    if (days > 0) {
        return remHours > 0
            ? tBiHtml(`${days}d ${remHours}h`, `${days} 天 ${remHours} 小时`)
            : tBiHtml(`${days}d`, `${days} 天`);
    }
    if (hours > 0) {
        return remMinutes > 0
            ? tBiHtml(`${hours}h ${remMinutes}m`, `${hours} 小时 ${remMinutes} 分钟`)
            : tBiHtml(`${hours}h`, `${hours} 小时`);
    }
    return tBiHtml(`${totalMinutes}m`, `${totalMinutes} 分钟`);
}

export function formatRunwayBadgeHtml(estimate: QuotaRunwayEstimate | undefined): string {
    if (!estimate) { return ''; }
    const burnRatePart = typeof estimate.burnRatePctPerHour === 'number'
        && Number.isFinite(estimate.burnRatePctPerHour)
        && estimate.burnRatePctPerHour > 0
        ? ` · ${esc(estimate.burnRatePctPerHour.toFixed(1))}%/h`
        : '';

    switch (estimate.status) {
        case 'safe_until_reset':
            return `<div class="quota-runway-row" data-runway-status="safe_until_reset">
                <span class="quota-runway-pill is-safe">${tBiHtml('Safe before reset', '重置前充裕')}${burnRatePart}</span>
            </div>`;
        case 'at_risk': {
            const exhaustHtml = estimate.estExhaustMs !== null
                ? formatRunwayDurationHtml(estimate.estExhaustMs)
                : '—';
            return `<div class="quota-runway-row" data-runway-status="at_risk">
                <span class="quota-runway-pill is-risk">${tBiHtml('Est. exhaust in', '预计耗尽')} ${exhaustHtml}${burnRatePart}</span>
            </div>`;
        }
        case 'exhausted':
            return `<div class="quota-runway-row" data-runway-status="exhausted">
                <span class="quota-runway-pill is-exhausted">${tBiHtml('Quota exhausted', '配额已耗尽')}</span>
            </div>`;
        case 'custom_model_isolated':
            return '';
        case 'insufficient_data':
        default:
            if (estimate.recoveredRecently) {
                return `<div class="quota-runway-row" data-runway-status="recovered">
                    <span class="quota-runway-pill is-safe">${tBiHtml('Quota recently recovered', '配额刚恢复')}</span>
                </div>`;
            }
            if (burnRatePart) {
                return `<div class="quota-runway-row" data-runway-status="insufficient_data">
                    <span class="quota-runway-pill is-muted">${tBiHtml('Burn rate', '消耗速率')} ${esc(estimate.burnRatePctPerHour!.toFixed(1))}%/h</span>
                </div>`;
            }
            return '';
    }
}

export function buildStaleBannerHtml(staleState: MonitorStaleState | null | undefined): string {
    if (!staleState?.isStale) { return ''; }
    const lang = getLanguage();
    const lastTime = staleState.lastSuccessAtMs
        ? formatClockTime(new Date(staleState.lastSuccessAtMs), lang)
        : '';
    const updatedPart = lastTime
        ? ` <span class="stale-banner-time">· ${tBiHtml('Last updated', '上次更新')} ${esc(lastTime)}</span>`
        : '';
    const errTip = staleState.lastError ? ` title="${esc(staleState.lastError)}"` : '';
    return `<div class="stale-data-banner" role="status" data-stale-banner="true"${errTip}>
        <span class="stale-badge-pill"><span class="stale-dot" aria-hidden="true"></span><span>${tBiHtml('Cached / Stale', '缓存数据（待刷新）')}</span></span>
        <span class="stale-banner-desc">${tBiHtml('Showing last known telemetry while reconnecting to the local backend.', '正在重连本地后端，当前保留上次成功拉取的缓存数据。')}${updatedPart}</span>
    </div>`;
}

export function buildCustomModelBannerHtml(): string {
    return `<div class="custom-model-banner" role="status" data-custom-model-isolated="true">
        <span class="custom-model-pill">${tBiHtml('Custom Model Isolated', '自定义模型（配额独立）')}</span>
        <span class="custom-model-desc">${tBiHtml(
        'Active session uses a custom / BYOK model that does not consume Google Antigravity quota pools. Pool alerts are suppressed.',
        '当前会话使用自定义 / BYOK 模型，不消耗 Google Antigravity 配额池，已自动折叠并静音配额池预警。',
    )}</span>
    </div>`;
}

// ─── v1.17.6 Low-Quota Warning Banner & Jargon Tooltips ──────────────────────

/**
 * Evaluate whether any quota pool's remaining percentage is at or below `threshold`.
 * Automatically suppressed when `threshold <= 0` or `isCustomModelActive` is true.
 */
export function evaluateLowQuotaWarning(
    groups: readonly ModelQuotaGroup[],
    threshold: number | undefined,
    isCustomModelActive = false,
): LowQuotaWarningState | null {
    if (isCustomModelActive) { return null; }
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0) {
        return null;
    }
    const clampedThreshold = Math.min(99, Math.max(1, Math.round(threshold)));
    const triggered: LowQuotaWarningItem[] = [];

    for (const group of groups) {
        let minFrac: number | null = null;
        let windowLabel: string | undefined;
        let resetTime: string | null | undefined = group.resetTime;

        const consider = (frac: number | null | undefined, label: string | undefined, rt?: string | null) => {
            if (typeof frac !== 'number' || !Number.isFinite(frac) || frac < 0 || frac > 1) { return; }
            if (minFrac === null || frac < minFrac) {
                minFrac = frac;
                windowLabel = label;
                if (rt !== undefined) { resetTime = rt; }
            }
        };

        if (group.fiveHourQuota) {
            consider(group.fiveHourQuota.remainingFraction, tBi('5h', '5h'), group.fiveHourQuota.resetTime);
        }
        if (group.weeklyQuota) {
            consider(group.weeklyQuota.remainingFraction, tBi('Weekly', '周额度'), group.weeklyQuota.resetTime);
        }
        if (minFrac === null && group.minimum !== null) {
            consider(group.minimum, undefined, group.resetTime);
        }
        if (minFrac === null) { continue; }

        const pct = Math.round(minFrac * 100);
        if (minFrac * 100 <= clampedThreshold || pct <= clampedThreshold) {
            triggered.push({
                poolKey: group.pool || group.key,
                label: group.label,
                remainingPct: pct,
                windowLabel,
                resetTime,
            });
        }
    }

    if (triggered.length === 0) { return null; }
    triggered.sort((a, b) => a.remainingPct - b.remainingPct);
    return { threshold: clampedThreshold, pools: triggered };
}

export function buildLowQuotaWarningBannerHtml(
    warning: LowQuotaWarningState | null | undefined,
    now = Date.now(),
): string {
    if (!warning || !Array.isArray(warning.pools) || warning.pools.length === 0) {
        return '';
    }
    const poolChips = warning.pools.map((pool) => {
        const winPart = pool.windowLabel ? ` (${esc(pool.windowLabel)})` : '';
        const resetPart = pool.resetTime ? ` · ${formatResetDurationHtml(pool.resetTime, now)}` : '';
        return `<span class="low-quota-pool-chip" data-low-quota-pool="${esc(pool.poolKey)}">
            <span>${esc(pool.label)}${winPart}</span>
            <strong>${esc(String(pool.remainingPct))}%</strong>
            ${resetPart ? `<span class="low-quota-reset">${resetPart}</span>` : ''}
        </span>`;
    }).join('');

    return `<div class="low-quota-banner" id="lowQuotaBanner" role="alert" data-low-quota-banner="true" data-threshold="${warning.threshold}">
        <div class="low-quota-banner-head">
            <span class="low-quota-title">${ICON.bolt} <span>${tBiHtml('Low Quota Warning', '低配额警告')} (≤ ${warning.threshold}%)</span></span>
            <button type="button" class="low-quota-settings-btn" data-overview-target="settings">${tBiHtml('Threshold', '调整阈值')}</button>
        </div>
        <div class="low-quota-pools">${poolChips}</div>
    </div>`;
}

type JargonKey = 'gm-data' | 'ttft' | 'dual-cap' | 'compaction-vs-physical' | 'mapped-base-rate';

function jargonTipHtml(key: JargonKey): string {
    const copy: Record<JargonKey, [string, string]> = {
        'gm-data': [
            'GM Data: Generator Metadata emitted by Antigravity for every LLM request (measured tokens, latency, cache, and credits).',
            'GM 数据：Antigravity 为每次模型请求记录的底层生成元数据（实测 Token、延迟、缓存与积分）。',
        ],
        ttft: [
            'TTFT (Time To First Token): latency from sending a request until the model emits its first token.',
            'TTFT（首字延迟）：从发送请求到模型输出第一个 Token 的等待时间。',
        ],
        'dual-cap': [
            'Dual-Cap: compares Effective Budget (platform auto-compaction ceiling) against Native Ceiling (underlying model physical window).',
            '双上限：对照有效预算（平台自动压缩上限）与原生上限（底层模型物理窗口）。',
        ],
        'compaction-vs-physical': [
            'Compaction Limit vs Physical Window: Antigravity triggers auto-compaction at the Compaction Limit before the model Physical Window fills up.',
            '自动压缩上限 vs 物理窗口：Antigravity 会在到达自动压缩上限时自动压缩对话，早于模型物理窗口耗尽。',
        ],
        'mapped-base-rate': [
            'Mapped Base Rate: legacy fixed Orchestrator IDs (M537/M667/M681/M669) lack public rate cards; Mapped Base mode estimates cost via their underlying base model official rate.',
            '按底座估算：旧版固定编排 ID（M537/M667/M681/M669）无独立公开价目表，按底座估算模式会使用其底座模型官方单价进行估算。',
        ],
    };
    const [en, zh] = copy[key];
    const tip = tBi(en, zh);
    return `<span class="jargon-tip" tabindex="0" role="note" data-jargon="${key}" title="${esc(tip)}" aria-label="${esc(tip)}">?</span>`;
}

// ─── Overview Rendering Helpers ──────────────────────────────────────────────

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

function formatOverviewCostInCurrency(
    usd: number | undefined,
    displayCurrency?: CurrencyInput,
): { display: string; title?: string } | null {
    if (usd === undefined || !Number.isFinite(usd) || usd < 0) {
        return null;
    }
    const { preset } = resolveCurrencyConfig(displayCurrency);
    if (preset.code === 'USD') {
        const formatted = formatOverviewCost(usd);
        return formatted ? { display: formatted } : null;
    }
    const display = formatCurrencyAmount(usd, displayCurrency);
    if (!display || display === '—') { return null; }
    return {
        display,
        title: formatDualCurrencyAmount(usd, displayCurrency),
    };
}

function buildCostTelemetryCell(
    sessionCostUsd: number | undefined,
    todayCostUsd: number | undefined,
    displayCurrency?: CurrencyInput,
    orchestratorPricingMode?: OrchestratorPricingMode,
): string {
    const sessionCost = formatOverviewCostInCurrency(sessionCostUsd, displayCurrency);
    const todayCost = formatOverviewCostInCurrency(todayCostUsd, displayCurrency);
    if (!sessionCost && !todayCost) { return ''; }
    const mappedTip = orchestratorPricingMode !== 'strict' ? jargonTipHtml('mapped-base-rate') : '';
    if (sessionCost) {
        const subHtml = todayCost
            ? `<span class="overview-telemetry-sub">${tBiHtml('Today', '今日')} ${esc(todayCost.display)}</span>`
            : '';
        const titleParts = [sessionCost.title, todayCost?.title ? `${tBi('Today', '今日')}: ${todayCost.title}` : ''].filter(Boolean);
        const titleAttr = titleParts.length ? ` title="${esc(titleParts.join(' · '))}"` : '';
        return `<div class="overview-telemetry-cell" data-telemetry-cell="cost"${titleAttr}>
            <span class="overview-telemetry-label">${tBiHtml('Session Cost', '会话费用')}${mappedTip}</span>
            <strong class="overview-telemetry-value">${esc(sessionCost.display)}</strong>
            ${subHtml}
        </div>`;
    }
    const titleAttr = todayCost?.title ? ` title="${esc(todayCost.title)}"` : '';
    return `<div class="overview-telemetry-cell" data-telemetry-cell="cost"${titleAttr}>
        <span class="overview-telemetry-label">${tBiHtml('Today Cost', '今日费用')}${mappedTip}</span>
        <strong class="overview-telemetry-value">${esc(todayCost!.display)}</strong>
    </div>`;
}

function telemetryStrip(
    snapshot: OverviewTelemetrySnapshot,
    sessionCostUsd?: number,
    todayCostUsd?: number,
    options?: {
        speedSample?: SpeedSampleEvaluation | null;
        displayCurrency?: CurrencyInput;
        orchestratorPricingMode?: OrchestratorPricingMode;
    },
): string {
    const { primary, primaryScope, speedPrimary, ttftPrimary } = snapshot;

    // 1. Speed (with sparse-sample Short sample / Waiting TTFT guard)
    const speedSample = options?.speedSample
        ?? primary.latestSpeedSample
        ?? (primary.latestCall
            ? evaluateSpeedSample({
                outputTokens: primary.latestCall.outputTokens,
                streamingSeconds: primary.latestCall.streamingSeconds,
                ttftSeconds: primary.latestCall.ttftSeconds,
            })
            : null);

    let speedHtml: string;
    let speedClass = '';
    let speedStateAttr = '';
    if (speedSample?.isWaitingTtft) {
        const waitSuffix = typeof speedSample.waitingSeconds === 'number' && Number.isFinite(speedSample.waitingSeconds) && speedSample.waitingSeconds > 0
            ? ` (${speedSample.waitingSeconds.toFixed(1)}s)`
            : '';
        speedHtml = `${tBiHtml('Waiting TTFT', '等待首字')}${esc(waitSuffix)}`;
        speedClass = ' is-muted is-short-sample';
        speedStateAttr = ' data-speed-state="waiting-ttft"';
    } else if (speedSample?.isShortSample) {
        speedHtml = tBiHtml('Short sample', '短样本');
        speedClass = ' is-muted is-short-sample';
        speedStateAttr = ' data-speed-state="short-sample"';
    } else {
        speedHtml = esc(formatSpeed(speedPrimary));
        speedClass = speedPrimary === null ? ' is-muted' : '';
    }

    let speedSubHtml = '';
    if (speedSample?.isShortSample && primary.weightedGenTokPerSec !== null) {
        speedSubHtml = esc(`avg ${formatSpeed(primary.weightedGenTokPerSec)}`);
    } else if (primary.hasThinking && primary.weightedVisibleTokPerSec !== null) {
        speedSubHtml = esc(`resp ${formatSpeed(primary.weightedVisibleTokPerSec)}`);
    } else if (
        primary.latestGenTokPerSec !== null
        && primary.weightedGenTokPerSec !== null
        && formatSpeed(primary.latestGenTokPerSec) !== formatSpeed(primary.weightedGenTokPerSec)
    ) {
        speedSubHtml = esc(`avg ${formatSpeed(primary.weightedGenTokPerSec)}`);
    }
    const speedTipParts: string[] = [];
    if (speedSample?.isShortSample && speedSample.rawSpeed !== null) {
        speedTipParts.push(`${tBi('Raw (short sample)', '原始值（短样本）')}: ${formatSpeed(speedSample.rawSpeed)}`);
    }
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

    // 4. Cache Saved
    const savingsFormatted = formatOverviewSavings(primary.estCacheSavingsUsd);
    const { preset: currencyPreset } = resolveCurrencyConfig(options?.displayCurrency);
    let savedValueHtml: string;
    let savedClass = '';
    let savedTitleAttr = '';
    if (savingsFormatted !== null && primary.estCacheSavingsUsd !== null) {
        const displaySav = currencyPreset.code === 'USD'
            ? savingsFormatted
            : formatCurrencyAmount(primary.estCacheSavingsUsd, options?.displayCurrency);
        savedValueHtml = esc(displaySav);
        const savRef = currencyPreset.code === 'USD'
            ? savingsFormatted
            : formatDualCurrencyAmount(primary.estCacheSavingsUsd, options?.displayCurrency);
        if (primary.estCacheSavedTokens > 0) {
            savedTitleAttr = ` title="${esc(`${savRef} · ${formatCompactTokens(primary.estCacheSavedTokens)} tokens`)}"`;
        } else if (currencyPreset.code !== 'USD') {
            savedTitleAttr = ` title="${esc(savRef)}"`;
        }
    } else if (primary.estCacheSavedTokens > 0) {
        savedValueHtml = `${esc(formatCompactTokens(primary.estCacheSavedTokens))} tokens`;
        savedTitleAttr = ` title="${esc(`${formatCompactTokens(primary.estCacheSavedTokens)} tokens`)}"`;
    } else {
        savedValueHtml = '—';
        savedClass = ' is-muted';
    }
    const warmth = cacheWarmthMeta(primary.latestCacheState);
    const costCellHtml = buildCostTelemetryCell(
        sessionCostUsd,
        todayCostUsd,
        options?.displayCurrency,
        options?.orchestratorPricingMode,
    );

    const ariaLabel = primaryScope === 'active'
        ? tBi('Active conversation speed and prompt cache', '当前会话速度与提示词缓存')
        : tBi('Session speed and prompt cache', '会话速度与提示词缓存');

    return `<div class="overview-telemetry-strip${costCellHtml ? ' has-cost' : ''}" data-telemetry-scope="${primaryScope}" role="group" aria-label="${esc(ariaLabel)}">
        <div class="overview-telemetry-cell"${speedTitleAttr}${speedStateAttr}>
            <span class="overview-telemetry-label">${tBiHtml('Speed', '生成速度')}</span>
            <strong class="overview-telemetry-value${speedClass}">${speedHtml}</strong>
            ${speedSubHtml ? `<span class="overview-telemetry-sub">${speedSubHtml}</span>` : ''}
        </div>
        <div class="overview-telemetry-cell"${ttftTitleAttr}>
            <span class="overview-telemetry-label">${tBiHtml('TTFT', '首字延迟')}${jargonTipHtml('ttft')}</span>
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

// ─── Context Composition Breakdown Card (v1.17.5) ────────────────────────────

function measurementBadgeMeta(state: ContextMeasurementState): { cls: string; html: string } {
    switch (state) {
        case 'measured':
            return { cls: 'is-measured', html: tBiHtml('Measured', '实测') };
        case 'estimated_post_compaction':
            return { cls: 'is-compacted', html: tBiHtml('Estimated (Post-Compaction)', '估算（压缩后）') };
        case 'estimated_rewind':
            return { cls: 'is-rewind', html: tBiHtml('Estimated (Rewind)', '估算（回退重算）') };
        case 'awaiting_generation':
        default:
            return { cls: 'is-awaiting', html: tBiHtml('Awaiting Generation', '等待生成') };
    }
}

function categoryFallbackColor(key: ContextCategoryKey): string {
    return CONTEXT_CATEGORY_META[key]?.fallbackColor || '#8A96A8';
}

export function buildContextBreakdownCard(cb: ContextBreakdownSnapshot | null | undefined): string {
    if (!cb) { return ''; }

    const badge = measurementBadgeMeta(cb.measurementState);
    const capacity = cb.effectiveBudgetTokens > 0
        ? cb.effectiveBudgetTokens
        : (cb.nativeLimitTokens > 0 ? cb.nativeLimitTokens : cb.usedTokens);
    const latestCompaction = cb.compactionCheckpoints.length > 0
        ? cb.compactionCheckpoints[cb.compactionCheckpoints.length - 1]
        : null;

    // ── Dual-Cap Clarity strip ──
    const dualCapHtml = cb.hasDualCap ? `<div class="ctx-dual-cap-row" data-dual-cap="true">
        <div class="ctx-cap-pill is-effective">
            <span class="ctx-cap-label">${tBiHtml('Effective Budget', '有效预算')}${jargonTipHtml('dual-cap')}</span>
            <strong class="ctx-cap-value">${esc(formatCompactTokens(cb.usedTokens))} / ${esc(formatCompactTokens(cb.effectiveBudgetTokens))}</strong>
            <span class="ctx-cap-pct">${esc(cb.effectivePct.toFixed(1))}%</span>
        </div>
        <div class="ctx-cap-pill is-native">
            <span class="ctx-cap-label">${tBiHtml('Native Ceiling', '原生上限')}${jargonTipHtml('compaction-vs-physical')}</span>
            <strong class="ctx-cap-value">${esc(formatCompactTokens(cb.usedTokens))} / ${esc(formatCompactTokens(cb.nativeLimitTokens))}</strong>
            <span class="ctx-cap-pct">${esc(cb.nativePct.toFixed(1))}%</span>
        </div>
    </div>` : '';

    // ── Compaction saved summary chip ──
    const compactionChipHtml = latestCompaction && latestCompaction.savedTokens > 0
        ? `<div class="ctx-compaction-chip" data-compaction-saved="${latestCompaction.savedTokens}">
            <span class="ctx-compaction-label">${tBiHtml('Compaction checkpoint saved', '压缩检查点节省')}</span>
            <strong>−${esc(formatCompactTokens(latestCompaction.savedTokens))} tokens</strong>
            <span class="ctx-compaction-range">(${esc(formatCompactTokens(latestCompaction.beforeTokens))} → ${esc(formatCompactTokens(latestCompaction.afterTokens))})</span>
        </div>`
        : '';

    const isAwaiting = cb.measurementState === 'awaiting_generation' || cb.segments.length === 0;

    let vizHtml = '';
    if (isAwaiting) {
        vizHtml = `<p class="ctx-awaiting-msg">${tBiHtml(
            'Awaiting model generation metadata to measure context composition.',
            '等待模型生成元数据以统计上下文构成。',
        )}</p>`;
    } else {
        const denom = Math.max(capacity, cb.usedTokens, 1);
        const segBarSlices = cb.segments.map((seg) => {
            const rawW = (seg.tokens / denom) * 100;
            const widthPct = Math.max(0.8, Math.min(100, rawW));
            const fallback = categoryFallbackColor(seg.key);
            const tip = `${tBi(seg.labelEn, seg.labelZh)}: ${formatNumber(seg.tokens)} tokens (${seg.pct.toFixed(1)}%)`;
            return `<span class="ctx-seg-slice" data-ctx-cat="${seg.key}" style="width:${widthPct.toFixed(2)}%;background:var(${seg.colorToken}, ${fallback})" title="${esc(tip)}"></span>`;
        }).join('');
        const freeTokens = Math.max(0, capacity - cb.usedTokens);
        const freePct = capacity > 0 ? Math.max(0, (freeTokens / denom) * 100) : 0;
        const freeSlice = freePct > 0.5
            ? `<span class="ctx-seg-slice is-free" data-ctx-cat="free" style="width:${freePct.toFixed(2)}%" title="${esc(`${tBi('Free', '剩余可用')}: ${formatNumber(freeTokens)} tokens`)}"></span>`
            : '';

        const summarySpoken = `${tBi('Context composition', '上下文构成')}: ${formatCompactTokens(cb.usedTokens)} / ${formatCompactTokens(capacity)} (${cb.effectivePct.toFixed(1)}%), ${cb.segments.slice(0, 4).map(s => `${tBi(s.labelEn, s.labelZh)} ${s.pct.toFixed(1)}%`).join(', ')}`;

        // 20x5 = 100-dot matrix
        const dotCells = buildDotMatrix(cb.segments, cb.usedTokens, capacity, 100);
        const dotsHtml = dotCells.map((cell) => {
            if (cell.isFree) {
                return `<span class="ctx-dot is-free" data-ctx-cat="free" aria-hidden="true"></span>`;
            }
            const fallback = categoryFallbackColor(cell.category as ContextCategoryKey);
            const dotTip = `${tBi(cell.labelEn, cell.labelZh)}`;
            return `<span class="ctx-dot" data-ctx-cat="${cell.category}" style="background:var(${cell.colorToken}, ${fallback})" title="${esc(dotTip)}" aria-hidden="true"></span>`;
        }).join('');

        // Interactive legend (only populated segments — never fake 0s)
        const legendHtml = cb.segments.map((seg) => {
            const fallback = categoryFallbackColor(seg.key);
            return `<li class="ctx-legend-row"><button type="button" class="ctx-legend-item" data-ctx-cat="${seg.key}">
                <span class="ctx-legend-swatch" style="background:var(${seg.colorToken}, ${fallback})" aria-hidden="true"></span>
                <span class="ctx-legend-name">${tBiHtml(seg.labelEn, seg.labelZh)}</span>
                <span class="ctx-legend-val">${esc(formatCompactTokens(seg.tokens))}</span>
                <span class="ctx-legend-pct">${esc(seg.pct.toFixed(1))}%</span>
            </button></li>`;
        }).join('');

        vizHtml = `
            <div class="ctx-viz-bar-wrap">
                <div class="ctx-seg-bar" role="img" aria-label="${esc(summarySpoken)}">${segBarSlices}${freeSlice}</div>
            </div>
            <div class="ctx-viz-dots-wrap">
                <div class="ctx-dot-matrix" role="img" aria-label="${esc(summarySpoken)}">${dotsHtml}</div>
            </div>
            <ul class="ctx-legend" aria-label="${esc(tBi('Context category breakdown', '上下文分类明细'))}">${legendHtml}</ul>`;
    }

    // ── Largest Items (collapsible Top 5) ──
    const largestItemsHtml = cb.largestItems.length > 0 ? `
        <details id="overview-largest-items" class="ctx-largest-details" data-state-key="overview-largest-items">
            <summary>
                <span>${tBiHtml('Largest Items', '最大占用项')}</span>
                <span class="ctx-largest-count">${cb.largestItems.length}</span>
            </summary>
            <ol class="ctx-largest-list">
                ${cb.largestItems.slice(0, 5).map((item) => {
        const meta = CONTEXT_CATEGORY_META[item.category];
        const fallback = meta?.fallbackColor || '#8A96A8';
        const colorToken = meta?.colorToken || '--ctx-cat-other';
        return `<li class="ctx-largest-row" data-ctx-cat="${item.category}">
                        <span class="ctx-legend-swatch" style="background:var(${colorToken}, ${fallback})" aria-hidden="true"></span>
                        <span class="ctx-largest-title" title="${esc(item.title)}">${esc(item.title)}</span>
                        <span class="ctx-largest-tokens">${esc(formatCompactTokens(item.tokens))}</span>
                        <span class="ctx-largest-pct">${esc(item.pct.toFixed(1))}%</span>
                    </li>`;
    }).join('')}
            </ol>
        </details>` : '';

    // ── One-click Quick Actions ──
    const quickActionsHtml = `<div class="ctx-quick-actions">
        <button type="button" class="ctx-action-btn" id="copyContextReportBtn" data-action="copyContextReport">${ICON.copy} <span>${tBiHtml('Copy /context Report', '复制 /context 报告')}</span></button>
        <button type="button" class="ctx-action-btn" id="copyHandoffPromptBtn" data-action="copyHandoffPrompt">${ICON.file} <span>${tBiHtml('Copy Handoff Prompt', '复制交接提示词')}</span></button>
        <span id="ctxCopyFeedback" class="threshold-feedback" role="status"></span>
    </div>`;

    return `<section class="ctx-breakdown-card" data-ctx-breakdown="true" data-viz-mode="bar" aria-labelledby="ctx-breakdown-heading">
        <header class="ctx-breakdown-head">
            <div class="ctx-breakdown-title-wrap">
                <h4 id="ctx-breakdown-heading">${tBiHtml('Context Composition', '上下文构成')}</h4>
                <span class="ctx-measure-badge ${badge.cls}" data-measurement-state="${cb.measurementState}">${badge.html}</span>
            </div>
            ${isAwaiting ? '' : `<div class="ctx-viz-toggle" role="group" aria-label="${esc(tBi('Visualization mode', '视图模式'))}">
                <button type="button" class="ctx-viz-btn is-active" data-ctx-viz="bar" aria-pressed="true">${tBiHtml('Bar View', '条形视图')}</button>
                <button type="button" class="ctx-viz-btn" data-ctx-viz="dots" aria-pressed="false">${tBiHtml('Dot Matrix', '点阵视图')}</button>
            </div>`}
        </header>
        ${dualCapHtml}
        ${compactionChipHtml}
        ${vizHtml}
        ${largestItemsHtml}
        ${quickActionsHtml}
    </section>`;
}

function buildDualWatermarkMeterHtml(
    label: string,
    percent: number,
    spoken: string,
    tone: MeterTone,
    watermarks: ContextDualWatermark | null,
): string {
    const baseMeter = meter(label, percent, spoken, tone);
    if (!watermarks) { return baseMeter; }

    const markers: string[] = [];
    const pills: string[] = [];

    if (watermarks.showLongContextMarker && watermarks.longContextMarkerPctOfCompaction !== null) {
        const leftPct = Math.max(2, Math.min(98, watermarks.longContextMarkerPctOfCompaction));
        const exceeded = watermarks.exceedsLongContextTier;
        const tip = exceeded
            ? tBi(
                `200k long-context pricing tier exceeded (${formatCompactTokens(watermarks.contextUsed)} / 200k tokens). Higher per-token rates may apply.`,
                `已超过 200k 长上下文阶梯计费线（当前 ${formatCompactTokens(watermarks.contextUsed)} / 200k tokens），可能触发更高阶梯单价。`,
            )
            : tBi(
                `200k long-context pricing tier threshold (${formatCompactTokens(watermarks.tokensUntilLongContextTier ?? 0)} tokens remaining before 200k).`,
                `200k 长上下文阶梯计费线（距离 200k 还有 ${formatCompactTokens(watermarks.tokensUntilLongContextTier ?? 0)} tokens）。`,
            );
        markers.push(`<span class="overview-watermark-tick is-tier-200k${exceeded ? ' is-exceeded' : ''}" data-watermark="long-context-200k" style="left:${leftPct.toFixed(1)}%" title="${esc(tip)}" aria-hidden="true"></span>`);
        pills.push(`<span class="overview-watermark-pill${exceeded ? ' is-tier-exceeded' : ''}" data-watermark-pill="long-context-200k" title="${esc(tip)}">${
            exceeded
                ? tBiHtml('> 200k Tier', '已超 200k 阶梯')
                : `${tBiHtml('200k Tier', '200k 阶梯')} · ${esc(formatCompactTokens(watermarks.tokensUntilLongContextTier ?? 0))} ${tBiHtml('left', '剩余')}`
        }</span>`);
    }

    if (watermarks.hasDistinctPhysicalWindow) {
        const compTip = tBi(
            `Compaction ceiling at ${formatCompactTokens(watermarks.compactionLimit)} (${watermarks.compactionMarkerPct.toFixed(0)}% of ${formatCompactTokens(watermarks.physicalContextWindow)} physical window).`,
            `自动压缩上限为 ${formatCompactTokens(watermarks.compactionLimit)}（占 ${formatCompactTokens(watermarks.physicalContextWindow)} 物理窗口的 ${watermarks.compactionMarkerPct.toFixed(0)}%）。`,
        );
        markers.push(`<span class="overview-watermark-tick is-compaction-cap" data-watermark="compaction-limit" style="left:100%" title="${esc(compTip)}" aria-hidden="true"></span>`);
        pills.push(`<span class="overview-watermark-pill" data-watermark-pill="compaction-limit" title="${esc(compTip)}">${tBiHtml('Compaction', '压缩上限')} ${esc(formatCompactTokens(watermarks.compactionLimit))} / ${tBiHtml('Physical', '物理窗口')} ${esc(formatCompactTokens(watermarks.physicalContextWindow))}${jargonTipHtml('compaction-vs-physical')}</span>`);
    }

    if (markers.length === 0 && pills.length === 0) {
        return baseMeter;
    }

    return `<div class="overview-meter-wrap" data-dual-watermark="true">
        ${baseMeter}
        ${markers.length > 0 ? `<div class="overview-meter-markers">${markers.join('')}</div>` : ''}
    </div>
    ${pills.length > 0 ? `<div class="overview-watermark-meta">${pills.join('')}</div>` : ''}`;
}

function buildTurnCacheSummaryHtml(turnCacheInfo: UserTurnCacheSummary | null | undefined): string {
    const latest = turnCacheInfo?.latestTurn;
    if (!latest || latest.cacheStart === 'unknown') { return ''; }

    let pillCls = 'is-cold';
    let pillHtml = tBiHtml('Cold Start', '冷启动');
    if (latest.cacheStart === 'warm') {
        pillCls = 'is-warm';
        pillHtml = tBiHtml('Warm Start', '热缓存启动');
    } else if (latest.cacheStart === 'partial') {
        pillCls = 'is-partial';
        pillHtml = tBiHtml('Partial Start', '部分命中');
    }

    const hitPctHtml = latest.cacheHitPct !== null
        ? ` <span>(${esc(latest.cacheHitPct.toFixed(0))}%)</span>`
        : '';

    let deltaHtml = '';
    if (latest.netContextDeltaTokens !== null) {
        const sign = latest.netContextDeltaTokens >= 0 ? '+' : '−';
        const formatted = `${sign}${formatCompactTokens(Math.abs(latest.netContextDeltaTokens))}`;
        deltaHtml = `<span class="overview-turn-delta${latest.isCompactionDrop ? ' is-compaction' : ''}" data-turn-net-delta="${latest.netContextDeltaTokens}">${tBiHtml('Δ Context', '上下文净增长')} ${esc(formatted)}</span>`;
    }

    const switchHtml = latest.hadColdCacheSwitch
        ? `<span class="orch-cold-switch-pill">${tBiHtml('Switch Cold', '切换冷启动')}</span>`
        : '';

    return `<div class="overview-turn-cache-row" data-turn-cache-state="${latest.cacheStart}" data-turn-index="${latest.turnIndex}">
        <span class="turn-start-pill ${pillCls}" data-turn-start="${latest.cacheStart}">${pillHtml}${hitPctHtml}</span>
        ${deltaHtml}
        ${switchHtml}
    </div>`;
}

function resolveActiveConversationCalls(
    telemetry: OverviewExtras | undefined,
    activeCascadeId: string | undefined,
): GMCallEntry[] {
    if (!telemetry) { return []; }
    if (activeCascadeId && telemetry.gmConversations && telemetry.gmConversations[activeCascadeId]?.calls?.length) {
        return telemetry.gmConversations[activeCascadeId].calls;
    }
    const convs = telemetry.gmSummary?.conversations;
    if (!Array.isArray(convs) || convs.length === 0) { return []; }
    if (activeCascadeId) {
        const match = convs.find(c => c.cascadeId === activeCascadeId);
        if (match?.calls?.length) { return match.calls; }
    }
    if (convs.length === 1 && convs[0].calls?.length) {
        return convs[0].calls;
    }
    return [];
}

function sessionDetails(
    usage: ContextUsage,
    telemetryHtml = '',
    breakdownHtml = '',
    v1176?: {
        watermarks?: ContextDualWatermark | null;
        turnCacheHtml?: string;
        orchestratorSplitHtml?: string;
    },
): string {
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
            <span class="orch-route-label">${tBiHtml('Orchestrator', '编排模型')}</span>
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
            : buildDualWatermarkMeterHtml(contextLabel, reading.percent, ratio, contextMeterTone(reading.percent), v1176?.watermarks ?? null)}
        ${remaining !== null
            ? `<p class="overview-meta">${tBiHtml('Remaining', '可用余量')} · ${number(remaining.tokens)} ${tokenUnit}</p>` : ''}
        ${v1176?.turnCacheHtml || ''}
        ${breakdownHtml}
        ${telemetryHtml}
        ${v1176?.orchestratorSplitHtml || ''}
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
    telemetry?: OverviewExtras,
): string {
    const staleBannerHtml = buildStaleBannerHtml(telemetry?.staleState);
    const hasStaleFallbackData = Boolean(telemetry?.staleState?.isStale && (configs.length > 0 || usage || userInfo));
    const connected = (status.state !== 'connecting' && status.state !== 'disconnected') || hasStaleFallbackData;
    const active = (status.state === 'active' || hasStaleFallbackData) ? usage : null;
    const isCustomModelActive = Boolean(telemetry?.isCustomModelActive);
    const breakdownHtml = connected ? buildContextBreakdownCard(telemetry?.contextBreakdown) : '';
    const activeCascadeId = telemetry?.activeCascadeId || active?.cascadeId;

    const telemetryData = connected
        ? extractOverviewTelemetry(
            telemetry?.gmSummary,
            activeCascadeId,
            telemetry?.customPricing,
            telemetry?.orchestratorPricingMode,
        )
        : null;
    let telemetryHtml = telemetryData
        ? telemetryStrip(telemetryData, telemetry?.sessionCostUsd, telemetry?.todayCostUsd, {
            speedSample: telemetry?.speedSample,
            displayCurrency: telemetry?.displayCurrency,
            orchestratorPricingMode: telemetry?.orchestratorPricingMode,
        })
        : '';
    if (!telemetryHtml && connected) {
        const standaloneCost = buildCostTelemetryCell(
            telemetry?.sessionCostUsd,
            telemetry?.todayCostUsd,
            telemetry?.displayCurrency,
            telemetry?.orchestratorPricingMode,
        );
        if (standaloneCost) {
            telemetryHtml = `<div class="overview-telemetry-strip is-cost-only" data-telemetry-scope="cost" role="group" aria-label="${esc(tBi('Session and today cost', '会话与今日费用'))}">${standaloneCost}</div>`;
        }
    }

    const activeCalls = connected ? resolveActiveConversationCalls(telemetry, activeCascadeId) : [];
    const splitOptions = {
        orchestratorConfig: active?.orchestratorConfig,
        orchestratorHistory: active?.orchestratorHistory,
        orchestratorSettings: telemetry?.orchestratorSettings,
        orchestratorPricingMode: telemetry?.orchestratorPricingMode,
    };
    const resolvedSplit = connected
        ? (telemetry?.orchestratorSplit !== undefined
            ? telemetry.orchestratorSplit
            : (activeCalls.length > 0
                ? computeOrchestratorSplit(activeCalls, splitOptions, telemetry?.customPricing || {})
                : null))
        : null;
    const orchestratorSplitHtml = buildOrchestratorSplitCardHtml(resolvedSplit, { compact: true });

    const resolvedTurnCache = connected
        ? (telemetry?.turnCacheInfo !== undefined
            ? telemetry.turnCacheInfo
            : (activeCalls.length > 0 ? analyzeUserTurnCacheStates(activeCalls, splitOptions) : null))
        : null;
    const turnCacheHtml = buildTurnCacheSummaryHtml(resolvedTurnCache);

    const activeReading = active ? getContextReading(active) : null;
    const resolvedWatermarks = active
        ? (telemetry?.watermarks !== undefined
            ? telemetry.watermarks
            : (activeReading && activeReading.used !== null && activeReading.limit !== null
                ? computeContextWatermarks({
                    contextUsed: activeReading.used,
                    compactionLimit: activeReading.limit,
                    physicalContextWindow: telemetry?.contextBreakdown?.nativeLimitTokens,
                    model: active.model,
                })
                : null))
        : null;

    const groups = connected ? selectMonitorQuotaGroups(configs, active?.model, telemetry?.quotaSummary) : [];
    const resolvedLowQuota = connected
        ? (telemetry?.lowQuotaWarning !== undefined
            ? (isCustomModelActive ? null : telemetry.lowQuotaWarning)
            : evaluateLowQuotaWarning(groups, telemetry?.quotaNotificationThreshold, isCustomModelActive))
        : null;
    const lowQuotaBannerHtml = buildLowQuotaWarningBannerHtml(resolvedLowQuota, now);
    const activeRoute = active ? resolveActiveOrchestratorRoute(active) : null;
    const credits = aiCreditTotal(userInfo?.availableCredits || []);
    const expiryHtml = creditExpiryHtml(getDaysUntilBillingDay(billingDay, new Date(now)));
    const plan = userInfo ? [...new Set([userInfo.planName, userInfo.userTierName].filter(Boolean))].join(' · ') : '';
    const quotaTitlePlain = tBi('Quota remaining', '剩余配额');
    const quotaTitleHtml = tBiHtml('Quota remaining', '剩余配额');
    const runways = telemetry?.quotaRunways;

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
        const runwayEstimate = runways
            ? ((group.pool && runways[group.pool]) || runways[group.key])
            : undefined;
        const runwayHtml = isCustomModelActive ? '' : formatRunwayBadgeHtml(runwayEstimate);
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
            ${runwayHtml}
            ${group.pool ? `<p class="overview-model-families">${group.members.map(member => esc(member.label)).join(' · ')}</p>` : ''}
        </li>`;
    }).join('');

    const quotaBodyHtml = isCustomModelActive
        ? `${buildCustomModelBannerHtml()}${quotaRows ? `<details id="overview-custom-model-pools" class="custom-model-pools-collapse" data-state-key="overview-custom-model-pools">
            <summary><span>${tBiHtml('Google Quota Pools (Paused for Custom Model)', 'Google 配额池（自定义模型已隔离）')}</span></summary>
            <ul class="overview-quotas">${quotaRows}</ul>
        </details>` : ''}`
        : (quotaRows
            ? `<ul class="overview-quotas">${quotaRows}</ul>`
            : `<p class="overview-empty">${tBiHtml('Waiting for quota data.', '等待配额数据。')}</p>`);

    const emptyContextHtml = status.state === 'idle'
        ? tBiHtml('No context measurement for this conversation yet.', '当前会话暂无上下文计量。')
        : tBiHtml('Open an Antigravity conversation to see its context usage.', '打开 Antigravity 会话后即可查看上下文用量。');

    const jargonFooterHtml = connected ? `<div class="overview-jargon-row" role="group" aria-label="${esc(tBi('Terminology glossary', '术语说明'))}">
        <span class="overview-jargon-item">${tBiHtml('GM Data', 'GM 数据')}${jargonTipHtml('gm-data')}</span>
        <span class="overview-jargon-item">${tBiHtml('Dual-Cap', '双上限')}${jargonTipHtml('dual-cap')}</span>
        <span class="overview-jargon-item">${tBiHtml('Compaction vs Physical', '压缩上限 vs 物理窗口')}${jargonTipHtml('compaction-vs-physical')}</span>
        <span class="overview-jargon-item">${tBiHtml('Mapped Base Rate', '按底座估算')}${jargonTipHtml('mapped-base-rate')}</span>
    </div>` : '';

    return `<section class="monitor-overview" data-monitor-overview data-monitor-state="${status.state}" aria-labelledby="overview-heading">
        <header class="overview-header">
            <h2 id="overview-heading" data-overview-focus="heading" tabindex="-1">${tBiHtml('Context & quota', '上下文与配额')}</h2>
            ${connected && plan ? `<p class="overview-meta overview-plan-pill">${esc(plan)}</p>` : ''}
        </header>
        ${staleBannerHtml}
        ${lowQuotaBannerHtml}
        ${connected ? `<div class="overview-grid">
            <section class="overview-context" aria-labelledby="overview-context-heading">
                <h3 id="overview-context-heading" class="overview-section-heading"><span class="overview-state-dot" aria-hidden="true"></span><span>${statusHeadingHtml(status.state)}</span></h3>
                ${active ? sessionDetails(active, telemetryHtml, breakdownHtml, { watermarks: resolvedWatermarks, turnCacheHtml, orchestratorSplitHtml }) : `<p class="overview-empty">${emptyContextHtml}</p>${turnCacheHtml}${breakdownHtml}${telemetryHtml}${orchestratorSplitHtml}`}
                ${action('gmdata', tBiHtml('View model activity', '查看模型活动'))}
                ${jargonFooterHtml}
            </section>
            <section class="overview-quota" aria-labelledby="overview-quota-heading">
                <h3 id="overview-quota-heading" class="overview-section-heading"><span>${quotaTitleHtml}</span></h3>
                ${quotaBodyHtml}
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
        :is(.vscode-high-contrast, .vscode-high-contrast-light, [data-acm-theme="hc"], [data-acm-theme="hc-light"]) .overview-action { border-color: var(--overview-rule); margin-inline-start: 0; }
        :is(.vscode-high-contrast, .vscode-high-contrast-light, [data-acm-theme="hc"], [data-acm-theme="hc-light"]) .overview-meter { outline: 1px solid var(--overview-rule); }
        @media (prefers-reduced-motion: reduce) {
            .overview-action, .overview-action svg, .overview-meter span { transition: none; }
        }
    `;
}

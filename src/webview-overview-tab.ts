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
    CONTEXT_FREE_SPACE_META,
    buildDotMatrix,
    getMeasurementNote,
    type ContextBreakdownItem,
    type ContextBreakdownSnapshot,
    type ContextCategoryKey,
    type ContextCategorySegment,
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

interface RichTipSpec {
    key: string;
    title?: string;
    body: string;
    meta?: string;
    pin?: boolean;
    focusable?: boolean;
}

function richTipAttrs(spec: RichTipSpec): string {
    const parts = [
        `data-popover-key="${esc(spec.key)}"`,
        spec.title ? `data-tip-title="${esc(spec.title)}"` : '',
        `data-tip-body="${esc(spec.body)}"`,
        spec.meta ? `data-tip-meta="${esc(spec.meta)}"` : '',
        spec.pin ? 'data-tip-pin="true"' : '',
        spec.focusable ? 'tabindex="0"' : '',
    ].filter(Boolean);
    return parts.length ? ` ${parts.join(' ')}` : '';
}

export function formatRunwayBadgeHtml(estimate: QuotaRunwayEstimate | undefined, keyPrefix = 'runway'): string {
    if (!estimate) { return ''; }
    const poolSlug = estimate.poolKey || 'pool';
    const burnRatePart = typeof estimate.burnRatePctPerHour === 'number'
        && Number.isFinite(estimate.burnRatePctPerHour)
        && estimate.burnRatePctPerHour > 0
        ? ` · ${esc(estimate.burnRatePctPerHour.toFixed(1))}%/h`
        : '';
    const windowRule = tBi(
        'Estimated from your quota burn slope over a 45-minute rolling window.',
        '按最近 45 分钟滚动窗口内的配额消耗速率推算。',
    );
    const rateLine = typeof estimate.burnRatePctPerHour === 'number'
        && Number.isFinite(estimate.burnRatePctPerHour)
        && estimate.burnRatePctPerHour > 0
        ? `\n${tBi('Current burn rate', '当前消耗速率')}: ${estimate.burnRatePctPerHour.toFixed(1)}%/h`
        : '';

    switch (estimate.status) {
        case 'safe_until_reset': {
            const attrs = richTipAttrs({
                key: `${keyPrefix}:runway:${poolSlug}`,
                title: tBi('Quota Runway: Safe Before Reset', '配额续航：重置前充裕'),
                body: `${tBi(
                    'At your recent pace, remaining quota should last until the next scheduled reset.',
                    '按近期使用节奏估算，当前剩余配额足够撑到下次重置。',
                )}${rateLine}`,
                meta: windowRule,
                focusable: true,
            });
            return `<div class="quota-runway-row" data-runway-status="safe_until_reset">
                <span class="quota-runway-pill is-safe"${attrs}>${tBiHtml('Safe before reset', '重置前充裕')}${burnRatePart}</span>
            </div>`;
        }
        case 'at_risk': {
            const exhaustHtml = estimate.estExhaustMs !== null
                ? formatRunwayDurationHtml(estimate.estExhaustMs)
                : '—';
            const attrs = richTipAttrs({
                key: `${keyPrefix}:runway:${poolSlug}`,
                title: tBi('Quota Runway: At Risk', '配额续航：预计提前耗尽'),
                body: `${tBi(
                    'At your current pace, this quota pool may run out before the next reset window.',
                    '按当前消耗速度推算，该共享配额池可能会在下次重置前耗尽。',
                )}${rateLine}`,
                meta: windowRule,
                focusable: true,
            });
            return `<div class="quota-runway-row" data-runway-status="at_risk">
                <span class="quota-runway-pill is-risk"${attrs}>${tBiHtml('Est. exhaust in', '预计耗尽')} ${exhaustHtml}${burnRatePart}</span>
            </div>`;
        }
        case 'exhausted': {
            const attrs = richTipAttrs({
                key: `${keyPrefix}:runway:${poolSlug}`,
                title: tBi('Quota Exhausted', '配额已耗尽'),
                body: tBi(
                    'Remaining allowance for this pool has reached 0%. Wait for the reset window or switch to another model pool.',
                    '该共享配额池剩余额度已降至 0%，请等待重置或切换到其他配额池模型。',
                ),
                meta: windowRule,
                focusable: true,
            });
            return `<div class="quota-runway-row" data-runway-status="exhausted">
                <span class="quota-runway-pill is-exhausted"${attrs}>${tBiHtml('Quota exhausted', '配额已耗尽')}</span>
            </div>`;
        }
        case 'custom_model_isolated':
            return '';
        case 'insufficient_data':
        default:
            if (estimate.recoveredRecently) {
                const attrs = richTipAttrs({
                    key: `${keyPrefix}:runway:${poolSlug}`,
                    title: tBi('Quota Recently Recovered', '配额刚恢复'),
                    body: tBi(
                        'Quota jumped upward after a recent reset; runway estimation will resume once new usage samples arrive.',
                        '检测到配额刚刚重置回升，待采集新的使用样本后会恢复续航预测。',
                    ),
                    meta: windowRule,
                    focusable: true,
                });
                return `<div class="quota-runway-row" data-runway-status="recovered">
                    <span class="quota-runway-pill is-safe"${attrs}>${tBiHtml('Quota recently recovered', '配额刚恢复')}</span>
                </div>`;
            }
            if (burnRatePart) {
                const attrs = richTipAttrs({
                    key: `${keyPrefix}:runway:${poolSlug}`,
                    title: tBi('Quota Burn Rate', '配额消耗速率'),
                    body: `${tBi(
                        'Observed hourly quota consumption rate; reset time is unavailable or data is still accumulating.',
                        '观测到的每小时配额消耗速率；暂无完整重置时间或样本仍在累积中。',
                    )}${rateLine}`,
                    meta: windowRule,
                    focusable: true,
                });
                return `<div class="quota-runway-row" data-runway-status="insufficient_data">
                    <span class="quota-runway-pill is-muted"${attrs}>${tBiHtml('Burn rate', '消耗速率')} ${esc(estimate.burnRatePctPerHour!.toFixed(1))}%/h</span>
                </div>`;
            }
            return '';
    }
}

export function buildStaleBannerHtml(staleState: MonitorStaleState | null | undefined, keyPrefix = 'stale'): string {
    if (!staleState?.isStale) { return ''; }
    const lang = getLanguage();
    const lastTime = staleState.lastSuccessAtMs
        ? formatClockTime(new Date(staleState.lastSuccessAtMs), lang)
        : '';
    const updatedPart = lastTime
        ? ` <span class="stale-banner-time">· ${tBiHtml('Last updated', '上次更新')} ${esc(lastTime)}</span>`
        : '';
    const errLine = staleState.lastError
        ? `\n${tBi('Last error', '最近错误')}: ${staleState.lastError}`
        : '';
    const tipAttrs = richTipAttrs({
        key: `${keyPrefix}:stale-banner`,
        title: tBi('Cached / Stale Telemetry', '缓存数据（待刷新）'),
        body: `${tBi(
            'The monitor could not reach the local Antigravity service on the latest poll, so the last successful reading is shown instead of blanking the panel.',
            '最近一次轮询暂时无法连接本地 Antigravity 服务，面板保留上次成功拉取的快照避免白屏。',
        )}${errLine}`,
        meta: tBi('Auto-reconnect retries on every polling cycle.', '后台会在每个轮询周期自动尝试重连。'),
        focusable: true,
    });
    return `<div class="stale-data-banner" role="status" data-stale-banner="true"${tipAttrs}>
        <span class="stale-badge-pill"><span class="stale-dot" aria-hidden="true"></span><span>${tBiHtml('Cached / Stale', '缓存数据（待刷新）')}</span></span>
        <span class="stale-banner-desc">${tBiHtml('Showing last known telemetry while reconnecting to the local service.', '正在重连本地服务，当前保留上次成功拉取的缓存数据。')}${updatedPart}</span>
    </div>`;
}

export function buildCustomModelBannerHtml(keyPrefix = 'byok'): string {
    const tipAttrs = richTipAttrs({
        key: `${keyPrefix}:byok-banner`,
        title: tBi('Custom / BYOK Model Isolation', '自定义 / BYOK 模型配额隔离'),
        body: tBi(
            'BYOK (Bring Your Own Key) and custom endpoints are billed by your own provider, not Google Antigravity quota pools.',
            'BYOK（自带 API 密钥）或自定义接口由你自己的服务商计费，不占用 Google Antigravity 配额池。',
        ),
        meta: tBi(
            'Low-quota banners and pool runway alerts are automatically muted while a custom model is active.',
            '当活跃会话使用自定义模型时，低配额预警与配额池续航提醒会自动静音并折叠。',
        ),
        focusable: true,
    });
    return `<div class="custom-model-banner" role="status" data-custom-model-isolated="true"${tipAttrs}>
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

    const bannerTipAttrs = richTipAttrs({
        key: 'overview:low-quota-banner',
        title: tBi('Low Quota Warning', '低配额警告'),
        body: tBi(
            `One or more shared quota pools dropped to or below your alert threshold (${warning.threshold}%).`,
            `有共享配额池的剩余额度已降至你设定的提醒阈值（≤ ${warning.threshold}%）。`,
        ),
        meta: tBi(
            'Click "Threshold" to adjust the percentage or set 0 to disable alerts.',
            '点击「调整阈值」可修改百分比，设为 0 可关闭低配额横幅提醒。',
        ),
        focusable: true,
    });

    return `<div class="low-quota-banner" id="lowQuotaBanner" role="alert" data-low-quota-banner="true" data-threshold="${warning.threshold}"${bannerTipAttrs}>
        <div class="low-quota-banner-head">
            <span class="low-quota-title">${ICON.bolt} <span>${tBiHtml('Low Quota Warning', '低配额警告')} (≤ ${warning.threshold}%)</span></span>
            <button type="button" class="low-quota-settings-btn" data-overview-target="settings">${tBiHtml('Threshold', '调整阈值')}</button>
        </div>
        <div class="low-quota-pools">${poolChips}</div>
    </div>`;
}

type JargonKey = 'ttft' | 'dual-cap' | 'session-cost';

function jargonTipHtml(key: JargonKey): string {
    const copy: Record<JargonKey, { title: [string, string]; body: [string, string]; meta: [string, string] }> = {
        ttft: {
            title: ['TTFT (Time To First Token)', '首字延迟 (TTFT)'],
            body: [
                'How long you wait from sending a prompt until the model outputs its very first token.',
                '从发出请求到模型开始输出第一个字所等待的时间。',
            ],
            meta: [
                'Includes prompt prefill & queue wait; hitting warm prompt cache usually lowers TTFT.',
                '包含提示词预填充与排队时间；命中热缓存通常可显著缩短首字等待。',
            ],
        },
        'dual-cap': {
            title: ['Auto-Compaction Limit vs Native Ceiling', '自动压缩上限 vs 原生窗口上限'],
            body: [
                'Antigravity automatically compacts older turns once context reaches the Effective Budget, well before the model\'s physical Native Ceiling fills up.',
                '对话达到「自动压缩上限（有效预算）」时，Antigravity 会提前自动压缩历史上下文，早于底层模型的「原生窗口上限」耗尽。',
            ],
            meta: [
                'Progress percentages are measured against the Effective Budget (compaction ceiling).',
                '进度百分比默认按自动压缩上限（有效预算）计算。',
            ],
        },
        'session-cost': {
            title: ['API Reference Cost', 'API 参考费用'],
            body: [
                'Estimated equivalent API spend for your token usage at public model rates — shown for value reference, not your actual subscription bill.',
                '按公开 API 单价折算的参考费用，仅用于衡量用量价值，不代表你的实际订阅账单扣费。',
            ],
            meta: [
                'In "Est. via Base Model" mode, legacy Orchestrator calls are estimated using their underlying base model\'s public rate card.',
                '开启「按底座估算」时，无独立公开价目表的编排模型将按其底层底座模型的官方单价估算（可在设置中切换严格模式）。',
            ],
        },
    };
    const item = copy[key];
    const title = tBi(item.title[0], item.title[1]);
    const body = tBi(item.body[0], item.body[1]);
    const meta = tBi(item.meta[0], item.meta[1]);
    const attrs = richTipAttrs({
        key: `overview:jargon:${key}`,
        title,
        body,
        meta,
        pin: true,
    });
    return `<button type="button" class="jargon-tip" data-jargon="${key}"${attrs} aria-label="${esc(`${title}: ${body}`)}">?</button>`;
}

function buildOverviewGlossaryHtml(): string {
    const entries: Array<{ termEn: string; termZh: string; descEn: string; descZh: string }> = [
        {
            termEn: 'Auto-Compaction Limit vs Native Ceiling',
            termZh: '自动压缩上限 vs 原生窗口上限',
            descEn: 'Effective Budget is where Antigravity auto-compacts older messages; Native Ceiling is the underlying model\'s full physical context window.',
            descZh: '「自动压缩上限（有效预算）」是 Antigravity 自动总结旧对话的触发线；「原生窗口上限」是底层模型本身的物理最大上下文容量。',
        },
        {
            termEn: '200k Long-Context Tier',
            termZh: '200k 长上下文阶梯',
            descEn: '200k input tokens is the standard API long-context tier line where public API list prices double and latency/attention degradation increase. For Antigravity subscription users, crossing 200k does NOT charge extra money or hard-truncate your conversation — it is purely an API reference cost & speed/quality heads-up.',
            descZh: '200k 输入 Token 是公开 API 的标准长上下文分界线（超过后公开 API 单价通常翻倍，且响应变慢、长文注意力更易衰减）。对 Antigravity 订阅用户而言，超过 200k 不会额外扣费，也不会强制截断会话，仅作为 API 参考费用与速度/质量提醒。',
        },
        {
            termEn: 'Prompt Cache (Warm / Partial / Cold Start)',
            termZh: '提示词缓存（热缓存启动 / 部分命中 / 冷启动）',
            descEn: 'Reflects real server-side Prompt Cache reuse reported by local telemetry: Warm ≥70% reuses cached history for faster first token & lower API reference cost; Partial 10%–70% happens after edits or compaction; Cold <10% occurs on the first turn, >5m idle expiry, or a model switch when the prefix must be re-read.',
            descZh: '反映本地遥测上报的真实服务端提示词缓存复用：热缓存启动（≥70%）直接复用已缓存历史，首字更快且 API 参考费用更低；部分命中（10%–70%）见于提示词改动或压缩后的部分复用；冷启动（<10%）见于首轮对话、闲置超 5 分钟缓存过期或切换模型，需重新读取前缀。',
        },
        {
            termEn: 'TTFT & Speed (Short Sample)',
            termZh: '首字延迟 (TTFT) 与生成速度（短样本）',
            descEn: 'TTFT is wait time before the first token; Speed measures streaming throughput (calls <16 tokens or <0.3s are labeled Short sample to avoid noisy spikes).',
            descZh: '首字延迟是从发问到吐出首字的耗时；生成速度衡量流式吞吐（输出不足 16 tokens 或耗时不足 0.3s 时记为「短样本」以防抖动失真）。',
        },
        {
            termEn: 'Quota Runway',
            termZh: '配额续航预测',
            descEn: 'Projects whether a shared quota pool will last until its next reset using the consumption slope over a 45-minute rolling window.',
            descZh: '基于最近 45 分钟滚动窗口的配额消耗斜率，预估共享配额池能否撑到下次重置。',
        },
        {
            termEn: 'API Reference Cost & Base-Model Estimation',
            termZh: 'API 参考费用与按底座估算',
            descEn: 'Estimates equivalent API spend at public rates (not your subscription bill). In mapped mode, legacy Orchestrator calls use their underlying base model\'s official rate.',
            descZh: '按公开 API 单价估算的参考费用（并非实际订阅账单）。在「按底座估算」模式下，编排模型按其底层底座模型的官方单价折算。',
        },
        {
            termEn: 'GM Data (Model Telemetry)',
            termZh: 'GM 数据（模型调用遥测）',
            descEn: 'Generator Metadata emitted by Antigravity for every LLM request, providing measured tokens, latency, prompt cache, and call credits.',
            descZh: 'Antigravity 为每次模型请求记录的底层生成元数据（Generator Metadata），提供实测 Token、延迟、缓存与积分明细。',
        },
    ];
    const itemsHtml = entries.map(e => `
        <div class="overview-glossary-entry">
            <dt>${tBiHtml(e.termEn, e.termZh)}</dt>
            <dd>${tBiHtml(e.descEn, e.descZh)}</dd>
        </div>`).join('');
    return `<details id="overview-glossary" class="overview-details overview-glossary" data-state-key="overview-glossary">
        <summary><span>${tBiHtml('Core metrics quick reference', '核心指标速查')}</span></summary>
        <dl class="overview-glossary-list">${itemsHtml}</dl>
    </details>`;
}

// ─── Overview Rendering Helpers ──────────────────────────────────────────────

const arrow = '<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h9m-4-4 4 4-4 4"/></svg>';

type MeterTone = 'default' | 'healthy' | 'warn' | 'attention';

function number(value: unknown, digits = 0): string {
    return usableCount(value) ? formatNumber(value, {
        maximumFractionDigits: digits,
    }) : '—';
}

function metric(labelHtml: string, valueHtml: string, tip?: RichTipSpec): string {
    const attrs = tip ? richTipAttrs({ ...tip, focusable: true }) : '';
    return `<div class="overview-metric"${attrs}><dt>${labelHtml}</dt><dd>${valueHtml}</dd></div>`;
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
    poolKey: string,
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
    const winTipAttrs = richTipAttrs({
        key: `overview:quota-win:${poolKey}:${kind}`,
        title: `${groupLabel} · ${labelPlain}`,
        body: kind === '5h'
            ? tBi(
                `Short-term 5-hour rolling quota remaining: ${pctText}. Refreshes rapidly across the day.`,
                `短期 5 小时滚动配额剩余：${pctText}，日内滚动恢复。`,
            )
            : tBi(
                `Weekly cumulative quota remaining: ${pctText}. Tracks total sustained usage across the week.`,
                `每周累计配额剩余：${pctText}，用于约束一周内的持续总用量。`,
            ),
        meta: win.resetTime
            ? `${tBi('Next reset', '下次重置')}: ${formatResetAbsolute(win.resetTime)}`
            : tBi('Reset timestamp not reported by backend.', '本地服务暂未上报该窗口的重置时间。'),
        focusable: true,
    });
    return `<div class="quota-dual-item" data-quota-window="${kind}"${winTipAttrs}>
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
            return { cls: 'is-warm', html: tBiHtml('Warm', '热缓存（命中）') };
        case 'warming':
            return { cls: 'is-warming', html: tBiHtml('Warming', '缓存预热中') };
        case 'cold':
            return { cls: 'is-cold', html: tBiHtml('Cold', '冷启动（未命中）') };
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
    const costHelpTip = jargonTipHtml('session-cost');
    const modeRule = orchestratorPricingMode === 'strict'
        ? tBi(
            'Strict official pricing mode: only models with direct public rate cards are summed.',
            '严格官方定价模式：仅计入拥有独立公开单价的模型调用。',
        )
        : tBi(
            'Base-model estimation mode: Orchestrator calls without a separate public rate card use their underlying base model rate.',
            '按底座估算模式：无独立公开单价的编排模型按其底层底座模型的官方单价折算。',
        );
    if (sessionCost) {
        const subHtml = todayCost
            ? `<span class="overview-telemetry-sub">${tBiHtml('Today', '今日')} ${esc(todayCost.display)}</span>`
            : '';
        const detailParts = [
            sessionCost.title || `${tBi('Session', '当前会话')}: ${sessionCost.display}`,
            todayCost ? `${tBi('Today', '今日')}: ${todayCost.title || todayCost.display}` : '',
        ].filter(Boolean);
        const cellTipAttrs = richTipAttrs({
            key: 'overview:telemetry:cost',
            title: tBi('Session API Reference Cost', '会话 API 参考费用'),
            body: `${tBi(
                'Estimated API spend for this conversation at public model token rates (not your subscription bill).',
                '按公开模型单价估算的当前会话等价 API 费用（仅作参考，并非实际订阅账单）。',
            )}\n${detailParts.join(' · ')}`,
            meta: modeRule,
            focusable: true,
        });
        return `<div class="overview-telemetry-cell" data-telemetry-cell="cost"${cellTipAttrs}>
            <span class="overview-telemetry-label">${tBiHtml('Session Cost', '会话费用')}${costHelpTip}</span>
            <strong class="overview-telemetry-value">${esc(sessionCost.display)}</strong>
            ${subHtml}
        </div>`;
    }
    const todayDetail = todayCost!.title || todayCost!.display;
    const cellTipAttrs = richTipAttrs({
        key: 'overview:telemetry:cost',
        title: tBi('Today API Reference Cost', '今日 API 参考费用'),
        body: `${tBi(
            'Estimated cumulative API spend across today\'s recorded model calls (not your subscription bill).',
            '按公开模型单价估算的今日累计等价 API 费用（仅作参考，并非实际订阅账单）。',
        )}\n${tBi('Today', '今日')}: ${todayDetail}`,
        meta: modeRule,
        focusable: true,
    });
    return `<div class="overview-telemetry-cell" data-telemetry-cell="cost"${cellTipAttrs}>
        <span class="overview-telemetry-label">${tBiHtml('Today Cost', '今日费用')}${costHelpTip}</span>
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
        speedSubHtml = `${tBiHtml('Visible resp', '正文速度')} ${esc(formatSpeed(primary.weightedVisibleTokPerSec))}`;
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
        speedTipParts.push(`${tBi('Visible Response Speed', '可见正文速度')}: ${formatSpeed(primary.weightedVisibleTokPerSec)}`);
    }
    const speedLead = speedSample?.isWaitingTtft
        ? tBi('Waiting for the model to emit its first output token.', '请求已发出，正在等待模型输出第一个字。')
        : speedSample?.isShortSample
            ? tBi('Latest output was too short to measure throughput reliably; showing Short sample instead of a noisy spike.', '最近一次输出过短，速度波动较大，故标记为「短样本」以防失真。')
            : tBi('Tokens generated per second during streaming output (Visible speed excludes internal Thinking tokens).', '模型流式输出阶段每秒生成的 Token 速度（「正文速度」为剔除思考过程后的可见回复速度）。');
    const speedTipAttrs = richTipAttrs({
        key: 'overview:telemetry:speed',
        title: tBi('Generation Speed', '生成速度'),
        body: speedTipParts.length ? `${speedLead}\n${speedTipParts.join(' · ')}` : speedLead,
        meta: tBi(
            'Rule: outputTokens / streamingSeconds; flagged as Short sample when output < 16 tokens or streaming < 0.3s.',
            '计算口径：输出 Token ÷ 流式耗时；当输出不足 16 tokens 或耗时不足 0.3s 时显示「短样本」。',
        ),
        focusable: true,
    });

    // 2. TTFT
    const ttftValue = formatLatency(ttftPrimary);
    const ttftClass = ttftPrimary === null ? ' is-muted' : '';
    let ttftSubHtml = '';
    if (primary.cachedAvgTtftSeconds !== null) {
        const cachedLatency = formatLatency(primary.cachedAvgTtftSeconds);
        ttftSubHtml = tBiHtml(`cached ${cachedLatency}`, `缓存首字 ${cachedLatency}`);
    } else if (primary.medianTtftSeconds !== null) {
        ttftSubHtml = esc(`p50 ${formatLatency(primary.medianTtftSeconds)}`);
    }
    const ttftTipParts: string[] = [];
    if (primary.avgTtftSeconds !== null) {
        ttftTipParts.push(`${tBi('Avg TTFT', '平均首字延迟')}: ${formatLatency(primary.avgTtftSeconds)}`);
    }
    if (primary.medianTtftSeconds !== null) {
        ttftTipParts.push(`${tBi('Median (p50)', '中位数 (p50)')}: ${formatLatency(primary.medianTtftSeconds)}`);
    }
    if (primary.cachedAvgTtftSeconds !== null) {
        ttftTipParts.push(`${tBi('Cached TTFT', '热缓存首字')}: ${formatLatency(primary.cachedAvgTtftSeconds)}`);
    }
    if (primary.uncachedAvgTtftSeconds !== null) {
        ttftTipParts.push(`${tBi('Uncached TTFT', '冷启动首字')}: ${formatLatency(primary.uncachedAvgTtftSeconds)}`);
    }
    const ttftLead = tBi(
        'Wait time from sending your message until the first token appears (p50 is the typical median latency).',
        '从发出请求到看到第一个字所等待的时间（p50 表示中位数，更能反映常态体验）。',
    );
    const ttftTipAttrs = richTipAttrs({
        key: 'overview:telemetry:ttft',
        title: tBi('TTFT (Time To First Token)', '首字延迟 (TTFT)'),
        body: ttftTipParts.length ? `${ttftLead}\n${ttftTipParts.join(' · ')}` : ttftLead,
        meta: tBi(
            'Warm prompt cache skips re-encoding history and usually cuts TTFT sharply.',
            '命中热缓存可跳过历史重算，通常能明显降低首字等待时间。',
        ),
        focusable: true,
    });

    // 3. Cache Hit
    const cacheHitValue = formatCachePercent(primary.tokenCacheHitRate);
    const cacheHitClass = primary.tokenCacheHitRate !== null && primary.tokenCacheHitRate > 0
        ? ' is-cache'
        : ' is-muted';
    const cacheHitSubHtml = primary.totalCacheReadTokens > 0
        ? esc(`${formatCompactTokens(primary.totalCacheReadTokens)} · ${primary.cachedCallCount}/${primary.totalCalls}`)
        : (primary.totalCalls > 0 ? esc(`${primary.cachedCallCount}/${primary.totalCalls}`) : '');
    const cacheHitDetail = primary.totalPromptTokens > 0
        ? `${formatCompactTokens(primary.totalCacheReadTokens)} / ${formatCompactTokens(primary.totalPromptTokens)} tokens · ${primary.cachedCallCount}/${primary.totalCalls} ${tBi('calls hit', '次命中')}`
        : '';
    const cacheHitLead = tBi(
        'Percentage of prompt tokens served from server-side prompt cache instead of being reprocessed.',
        '直接命中服务端提示词缓存、免于重复计算的输入 Token 比例。',
    );
    const cacheHitTipAttrs = richTipAttrs({
        key: 'overview:telemetry:cache-hit',
        title: tBi('Prompt Cache Hit Rate', '缓存命中率'),
        body: cacheHitDetail ? `${cacheHitLead}\n${cacheHitDetail}` : cacheHitLead,
        meta: tBi(
            'Formula: cacheReadTokens / (inputTokens + cacheReadTokens + cacheCreationTokens).',
            '计算口径：缓存读取 ÷（新增输入 + 缓存读取 + 缓存创建）。',
        ),
        focusable: true,
    });

    // 4. Cache Saved
    const savingsFormatted = formatOverviewSavings(primary.estCacheSavingsUsd);
    const { preset: currencyPreset } = resolveCurrencyConfig(options?.displayCurrency);
    let savedValueHtml: string;
    let savedClass = '';
    let savedDetail = '';
    if (savingsFormatted !== null && primary.estCacheSavingsUsd !== null) {
        const displaySav = currencyPreset.code === 'USD'
            ? savingsFormatted
            : formatCurrencyAmount(primary.estCacheSavingsUsd, options?.displayCurrency);
        savedValueHtml = esc(displaySav);
        const savRef = currencyPreset.code === 'USD'
            ? savingsFormatted
            : formatDualCurrencyAmount(primary.estCacheSavingsUsd, options?.displayCurrency);
        savedDetail = primary.estCacheSavedTokens > 0
            ? `${savRef} · ${formatCompactTokens(primary.estCacheSavedTokens)} tokens`
            : savRef;
    } else if (primary.estCacheSavedTokens > 0) {
        savedValueHtml = `${esc(formatCompactTokens(primary.estCacheSavedTokens))} tokens`;
        savedDetail = `${formatCompactTokens(primary.estCacheSavedTokens)} tokens`;
    } else {
        savedValueHtml = '—';
        savedClass = ' is-muted';
    }
    const warmth = cacheWarmthMeta(primary.latestCacheState);
    const savedLead = tBi(
        'Estimated API cost (or prompt tokens) saved by reading cached prefixes at discounted rates.',
        '因命中热缓存、以折扣单价读取历史前缀而节省的参考费用（未定价模型按节省 Token 计）。',
    );
    const savedTipAttrs = richTipAttrs({
        key: 'overview:telemetry:cache-saved',
        title: tBi('Prompt Cache Savings', '缓存节省'),
        body: savedDetail ? `${savedLead}\n${savedDetail}` : savedLead,
        meta: tBi(
            'Formula: (inputRate − cacheReadRate) × cacheReadTokens. Status reflects latest call warmth.',
            '计算口径：（输入单价 − 缓存读取单价）× 缓存读取 Token；下方状态反映最近一次调用的缓存冷热。',
        ),
        focusable: true,
    });
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
        <div class="overview-telemetry-cell" data-telemetry-cell="speed"${speedTipAttrs}${speedStateAttr}>
            <span class="overview-telemetry-label">${tBiHtml('Speed', '生成速度')}</span>
            <strong class="overview-telemetry-value${speedClass}">${speedHtml}</strong>
            ${speedSubHtml ? `<span class="overview-telemetry-sub">${speedSubHtml}</span>` : ''}
        </div>
        <div class="overview-telemetry-cell" data-telemetry-cell="ttft"${ttftTipAttrs}>
            <span class="overview-telemetry-label">${tBiHtml('TTFT', '首字延迟')}${jargonTipHtml('ttft')}</span>
            <strong class="overview-telemetry-value${ttftClass}">${esc(ttftValue)}</strong>
            ${ttftSubHtml ? `<span class="overview-telemetry-sub">${ttftSubHtml}</span>` : ''}
        </div>
        <div class="overview-telemetry-cell" data-telemetry-cell="cache-hit"${cacheHitTipAttrs}>
            <span class="overview-telemetry-label">${tBiHtml('Cache Hit', '缓存命中')}</span>
            <strong class="overview-telemetry-value${cacheHitClass}">${esc(cacheHitValue)}</strong>
            ${cacheHitSubHtml ? `<span class="overview-telemetry-sub">${cacheHitSubHtml}</span>` : ''}
        </div>
        <div class="overview-telemetry-cell" data-telemetry-cell="cache-saved"${savedTipAttrs}>
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
    return CONTEXT_CATEGORY_META[key]?.fallbackColor || '#A8A29E';
}

function buildCategoryDrawerTemplateHtml(
    seg: ContextCategorySegment,
    fallbackItems: readonly ContextBreakdownItem[],
): string {
    const meta = CONTEXT_CATEGORY_META[seg.key];
    const fallback = categoryFallbackColor(seg.key);
    const items = (seg.topItems && seg.topItems.length > 0)
        ? seg.topItems.slice(0, 3)
        : fallbackItems.filter(it => it.category === seg.key).slice(0, 3);
    const topItemsHtml = items.length > 0
        ? `<div class="ctx-drawer-subhead">${tBiHtml('Top items in this category', '该分类最大占用项 (Top 3)')}</div>
            <ol class="ctx-drawer-items">${items.map(it => `<li class="ctx-drawer-item">
                <span class="ctx-drawer-item-title">${esc(it.title)}</span>
                <span class="ctx-drawer-item-val">${esc(formatCompactTokens(it.tokens))}</span>
                <span class="ctx-drawer-item-pct">${esc(it.pct.toFixed(1))}%</span>
            </li>`).join('')}</ol>`
        : '';
    return `<template data-ctx-drawer-cat="${seg.key}">
        <div class="ctx-drawer-head">
            <span class="ctx-drawer-title-wrap">
                <span class="ctx-legend-swatch" style="background:var(${seg.colorToken}, ${fallback})" aria-hidden="true"></span>
                <span class="ctx-drawer-title">${tBiHtml(seg.labelEn, seg.labelZh)}</span>
            </span>
            <button type="button" class="ctx-drawer-close" data-action="closeCtxDrawer" aria-label="${esc(tBi('Close category details', '关闭分类详情'))}">×</button>
        </div>
        <p class="ctx-drawer-desc">${tBiHtml(meta.descEn, meta.descZh)}</p>
        <div class="ctx-drawer-metrics">
            <span class="ctx-drawer-stat"><strong>${esc(formatNumber(seg.tokens))}</strong> tokens</span>
            <span class="ctx-drawer-stat">${tBiHtml('Budget', '占压缩上限')} <strong>${esc(seg.pct.toFixed(1))}%</strong></span>
            <span class="ctx-drawer-stat">${tBiHtml('Used share', '占当前已用')} <strong>${esc(seg.sharePct.toFixed(1))}%</strong></span>
            <span class="ctx-drawer-stat">${tBiHtml('Items', '条目数')} <strong>${esc(String(seg.itemCount))}</strong></span>
        </div>
        ${topItemsHtml}
        <p class="ctx-drawer-tip"><strong>${tBiHtml('How to trim:', '偏高时如何瘦身：')}</strong> ${tBiHtml(meta.tipEn, meta.tipZh)}</p>
    </template>`;
}

function buildFreeDrawerTemplateHtml(
    usedTokens: number,
    capacity: number,
    freeTokens: number,
    freePct: number,
    watermarks?: ContextDualWatermark | null,
): string {
    const show200k = watermarks ? watermarks.showLongContextMarker : capacity > 200_000;
    const exceeded200k = watermarks ? watermarks.exceedsLongContextTier : usedTokens > 200_000;
    const rem200k = Math.max(0, 200_000 - usedTokens);
    const tierStatHtml = show200k
        ? (exceeded200k
            ? `<span class="ctx-drawer-stat">${tBiHtml('200k tier', '200k 阶梯')} <strong>${tBiHtml('Exceeded', '已超出')} (+${esc(formatCompactTokens(usedTokens - 200_000))})</strong></span>`
            : `<span class="ctx-drawer-stat">${tBiHtml('Before 200k tier', '距 200k 阶梯')} <strong>${esc(formatCompactTokens(rem200k))}</strong></span>`)
        : '';
    return `<template data-ctx-drawer-cat="free">
        <div class="ctx-drawer-head">
            <span class="ctx-drawer-title-wrap">
                <span class="ctx-legend-swatch" style="background:var(--ctx-cat-free, var(--ed-track));border:1px solid var(--ed-border-strong)" aria-hidden="true"></span>
                <span class="ctx-drawer-title">${tBiHtml(CONTEXT_FREE_SPACE_META.labelEn, CONTEXT_FREE_SPACE_META.labelZh)}</span>
            </span>
            <button type="button" class="ctx-drawer-close" data-action="closeCtxDrawer" aria-label="${esc(tBi('Close category details', '关闭分类详情'))}">×</button>
        </div>
        <p class="ctx-drawer-desc">${tBiHtml(CONTEXT_FREE_SPACE_META.descEn, CONTEXT_FREE_SPACE_META.descZh)}</p>
        <div class="ctx-drawer-metrics">
            <span class="ctx-drawer-stat"><strong>${esc(formatNumber(freeTokens))}</strong> tokens</span>
            <span class="ctx-drawer-stat">${tBiHtml('Free share', '剩余占比')} <strong>${esc(freePct.toFixed(1))}%</strong></span>
            <span class="ctx-drawer-stat">${tBiHtml('To compaction ceiling', '距自动压缩上限')} <strong>${esc(formatCompactTokens(freeTokens))}</strong></span>
            ${tierStatHtml}
        </div>
        <p class="ctx-drawer-tip"><strong>${tBiHtml('Tip:', '建议：')}</strong> ${tBiHtml(CONTEXT_FREE_SPACE_META.tipEn, CONTEXT_FREE_SPACE_META.tipZh)}</p>
    </template>`;
}

export function buildContextBreakdownCard(
    cb: ContextBreakdownSnapshot | null | undefined,
    watermarks?: ContextDualWatermark | null,
): string {
    if (!cb) { return ''; }

    const badge = measurementBadgeMeta(cb.measurementState);
    const capacity = cb.effectiveBudgetTokens > 0
        ? cb.effectiveBudgetTokens
        : (cb.nativeLimitTokens > 0 ? cb.nativeLimitTokens : cb.usedTokens);
    const latestCompaction = cb.compactionCheckpoints.length > 0
        ? cb.compactionCheckpoints[cb.compactionCheckpoints.length - 1]
        : null;

    const measureNote = getMeasurementNote(cb.measurementState, getLanguage());
    const measureTriggerMeta = cb.measurementState === 'measured'
        ? tBi('Trigger: reported directly by completed model generation usage.', '触发口径：最近一轮已完成模型调用并上报真实用量。')
        : cb.measurementState === 'estimated_post_compaction'
            ? tBi('Trigger: a compaction checkpoint happened after the last measured model call.', '触发口径：上次实测之后检测到自动压缩检查点，等待下一次实测校准。')
            : cb.measurementState === 'estimated_rewind'
                ? tBi('Trigger: step count dropped below prior peak (classified as rewind, not compaction).', '触发口径：对话步骤数少于历史峰值，判定为回退而非压缩。')
                : tBi('Trigger: no completed model usage reported yet for this conversation.', '触发口径：当前会话尚未完成首次模型生成。');
    const measureBadgeTipAttrs = richTipAttrs({
        key: 'overview:ctx-measure-badge',
        title: tBi('Measurement State', '计量状态'),
        body: measureNote,
        meta: measureTriggerMeta,
        focusable: true,
    });

    // ── Dual-Cap Clarity strip ──
    const effCapTipAttrs = richTipAttrs({
        key: 'overview:ctx-cap:effective',
        title: tBi('Effective Budget (Compaction Limit)', '自动压缩上限（有效预算）'),
        body: tBi(
            `Used ${formatCompactTokens(cb.usedTokens)} of ${formatCompactTokens(cb.effectiveBudgetTokens)} tokens (${cb.effectivePct.toFixed(1)}%). Antigravity auto-compacts older turns around this threshold.`,
            `已使用 ${formatCompactTokens(cb.usedTokens)} / ${formatCompactTokens(cb.effectiveBudgetTokens)} tokens（${cb.effectivePct.toFixed(1)}%）。接近该线时 Antigravity 会自动压缩旧对话。`,
        ),
        meta: tBi('Controlled by platform truncation/checkpoint budget.', '由平台检查点与截断预算决定，通常小于底层模型物理窗口。'),
        focusable: true,
    });
    const natCapTipAttrs = richTipAttrs({
        key: 'overview:ctx-cap:native',
        title: tBi('Native Ceiling (Model Context)', '原生窗口上限'),
        body: tBi(
            `Used ${formatCompactTokens(cb.usedTokens)} of ${formatCompactTokens(cb.nativeLimitTokens)} tokens (${cb.nativePct.toFixed(1)}%). This is the underlying model\'s full physical context window.`,
            `已使用 ${formatCompactTokens(cb.usedTokens)} / ${formatCompactTokens(cb.nativeLimitTokens)} tokens（${cb.nativePct.toFixed(1)}%）。这是底层模型本身支持的物理最大上下文。`,
        ),
        meta: tBi('Shown for reference alongside the lower Effective Budget ceiling.', '与较早触发的「自动压缩上限」对照参考。'),
        focusable: true,
    });
    const dualCapHtml = cb.hasDualCap ? `<div class="ctx-dual-cap-row" data-dual-cap="true">
        <div class="ctx-cap-pill is-effective"${effCapTipAttrs}>
            <span class="ctx-cap-label">${tBiHtml('Effective Budget', '自动压缩上限（有效预算）')}${jargonTipHtml('dual-cap')}</span>
            <strong class="ctx-cap-value">${esc(formatCompactTokens(cb.usedTokens))} / ${esc(formatCompactTokens(cb.effectiveBudgetTokens))}</strong>
            <span class="ctx-cap-pct">${esc(cb.effectivePct.toFixed(1))}%</span>
        </div>
        <div class="ctx-cap-pill is-native"${natCapTipAttrs}>
            <span class="ctx-cap-label">${tBiHtml('Native Ceiling', '原生窗口上限')}</span>
            <strong class="ctx-cap-value">${esc(formatCompactTokens(cb.usedTokens))} / ${esc(formatCompactTokens(cb.nativeLimitTokens))}</strong>
            <span class="ctx-cap-pct">${esc(cb.nativePct.toFixed(1))}%</span>
        </div>
    </div>` : '';

    // ── Compaction saved summary chip ──
    const compactionChipHtml = latestCompaction && latestCompaction.savedTokens > 0
        ? `<div class="ctx-compaction-chip" data-compaction-saved="${latestCompaction.savedTokens}"${richTipAttrs({
            key: 'overview:ctx-compaction-saved',
            title: tBi('Compaction Checkpoint Saved', '压缩检查点节省'),
            body: tBi(
                `Auto-compaction summarized earlier history and reclaimed ${formatNumber(latestCompaction.savedTokens)} tokens (${formatCompactTokens(latestCompaction.beforeTokens)} → ${formatCompactTokens(latestCompaction.afterTokens)}).`,
                `自动压缩总结了早期对话，释放了 ${formatNumber(latestCompaction.savedTokens)} tokens（${formatCompactTokens(latestCompaction.beforeTokens)} → ${formatCompactTokens(latestCompaction.afterTokens)}）。`,
            ),
            meta: tBi(`Observed at step #${latestCompaction.stepIndex}.`, `记录于第 #${latestCompaction.stepIndex} 步检查点。`),
            focusable: true,
        })}>
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
        const segByKey = new Map<ContextCategoryKey, ContextCategorySegment>();
        for (const seg of cb.segments) {
            segByKey.set(seg.key, seg);
        }

        const freeTokens = Math.max(0, capacity - cb.usedTokens);
        const freePct = capacity > 0 ? Math.max(0, (freeTokens / denom) * 100) : 0;
        const show200k = watermarks ? watermarks.showLongContextMarker : capacity > 200_000;
        const exceeded200k = watermarks ? watermarks.exceedsLongContextTier : cb.usedTokens > 200_000;
        const free200kLine = show200k
            ? (exceeded200k
                ? ` · ${tBi(`+${formatCompactTokens(cb.usedTokens - 200_000)} over 200k tier`, `已超 200k 阶梯 +${formatCompactTokens(cb.usedTokens - 200_000)}`)}`
                : ` · ${tBi(`${formatCompactTokens(Math.max(0, 200_000 - cb.usedTokens))} before 200k tier`, `距 200k 阶梯余量 ${formatCompactTokens(Math.max(0, 200_000 - cb.usedTokens))}`)}`)
            : '';

        const makeCatTip = (seg: ContextCategorySegment, key: string): string => {
            const meta = CONTEXT_CATEGORY_META[seg.key];
            return richTipAttrs({
                key,
                title: tBi(seg.labelEn, seg.labelZh),
                body: `${tBi(meta.descEn, meta.descZh)}\n${formatNumber(seg.tokens)} tokens · ${seg.pct.toFixed(1)}% ${tBi('of budget', '占压缩上限')} · ${seg.sharePct.toFixed(1)}% ${tBi('of used', '占当前已用')}`,
                meta: tBi(
                    `${seg.itemCount} item(s) · Click to lock highlight & view top 3 items + trim tip`,
                    `共 ${seg.itemCount} 项 · 点击锁定高亮并展开 Top 3 明细与瘦身建议`,
                ),
            });
        };
        const makeFreeTip = (key: string): string => richTipAttrs({
            key,
            title: tBi(CONTEXT_FREE_SPACE_META.labelEn, CONTEXT_FREE_SPACE_META.labelZh),
            body: `${tBi(CONTEXT_FREE_SPACE_META.descEn, CONTEXT_FREE_SPACE_META.descZh)}\n${tBi('Remaining before compaction', '距自动压缩上限余量')}: ${formatNumber(freeTokens)} tokens (${freePct.toFixed(1)}%)${free200kLine}`,
            meta: tBi('Click to lock & inspect remaining headroom.', '点击锁定并展开剩余空间与阶梯余量详情。'),
        });

        const segBarSlices = cb.segments.map((seg) => {
            const rawW = (seg.tokens / denom) * 100;
            const widthPct = Math.max(0.8, Math.min(100, rawW));
            const fallback = categoryFallbackColor(seg.key);
            return `<span class="ctx-seg-slice" data-ctx-cat="${seg.key}" tabindex="0" role="button" aria-label="${esc(`${tBi(seg.labelEn, seg.labelZh)}: ${formatNumber(seg.tokens)} tokens (${seg.pct.toFixed(1)}%)`)}" style="width:${widthPct.toFixed(2)}%;background:var(${seg.colorToken}, ${fallback})"${makeCatTip(seg, `overview:ctx-bar:${seg.key}`)}></span>`;
        }).join('');
        const freeSlice = freePct > 0.5
            ? `<span class="ctx-seg-slice is-free" data-ctx-cat="free" tabindex="0" role="button" aria-label="${esc(`${tBi(CONTEXT_FREE_SPACE_META.labelEn, CONTEXT_FREE_SPACE_META.labelZh)}: ${formatNumber(freeTokens)} tokens`)}" style="width:${freePct.toFixed(2)}%"${makeFreeTip('overview:ctx-bar:free')}></span>`
            : '';

        const summarySpoken = `${tBi('Context composition', '上下文构成')}: ${formatCompactTokens(cb.usedTokens)} / ${formatCompactTokens(capacity)} (${cb.effectivePct.toFixed(1)}%), ${cb.segments.slice(0, 4).map(s => `${tBi(s.labelEn, s.labelZh)} ${s.pct.toFixed(1)}%`).join(', ')}`;

        // 20x5 = 100-dot matrix (adapts to 10x10 at <=420px via CSS)
        const dotCells = buildDotMatrix(cb.segments, cb.usedTokens, capacity, 100);
        const dotsHtml = dotCells.map((cell) => {
            if (cell.isFree) {
                return `<span class="ctx-dot is-free" data-ctx-cat="free"${makeFreeTip(`overview:ctx-dot:${cell.index}:free`)} aria-hidden="true"></span>`;
            }
            const catKey = cell.category as ContextCategoryKey;
            const seg = segByKey.get(catKey);
            const fallback = categoryFallbackColor(catKey);
            const dotTipAttrs = seg
                ? makeCatTip(seg, `overview:ctx-dot:${cell.index}:${catKey}`)
                : richTipAttrs({
                    key: `overview:ctx-dot:${cell.index}:${catKey}`,
                    title: tBi(cell.labelEn, cell.labelZh),
                    body: tBi(CONTEXT_CATEGORY_META[catKey].descEn, CONTEXT_CATEGORY_META[catKey].descZh),
                });
            return `<span class="ctx-dot" data-ctx-cat="${catKey}" style="background:var(${cell.colorToken}, ${fallback})"${dotTipAttrs} aria-hidden="true"></span>`;
        }).join('');

        // Interactive legend (only populated segments — never fake 0s)
        const legendHtml = cb.segments.map((seg) => {
            const fallback = categoryFallbackColor(seg.key);
            return `<li class="ctx-legend-row"><button type="button" class="ctx-legend-item" data-ctx-cat="${seg.key}" aria-pressed="false"${makeCatTip(seg, `overview:ctx-legend:${seg.key}`)}>
                <span class="ctx-legend-swatch" style="background:var(${seg.colorToken}, ${fallback})" aria-hidden="true"></span>
                <span class="ctx-legend-name">${tBiHtml(seg.labelEn, seg.labelZh)}</span>
                <span class="ctx-legend-val">${esc(formatCompactTokens(seg.tokens))}</span>
                <span class="ctx-legend-pct">${esc(seg.pct.toFixed(1))}%</span>
            </button></li>`;
        }).join('');

        const drawerTemplatesHtml = cb.segments
            .map(seg => buildCategoryDrawerTemplateHtml(seg, cb.largestItems))
            .join('') + buildFreeDrawerTemplateHtml(cb.usedTokens, capacity, freeTokens, freePct, watermarks);

        vizHtml = `
            <div class="ctx-viz-bar-wrap">
                <div class="ctx-seg-bar" role="img" aria-label="${esc(summarySpoken)}">${segBarSlices}${freeSlice}</div>
            </div>
            <div class="ctx-viz-dots-wrap">
                <div class="ctx-dot-matrix" role="img" aria-label="${esc(summarySpoken)}">${dotsHtml}</div>
            </div>
            <div class="ctx-selected-drawer" id="ctxSelectedDrawer" data-ctx-drawer-active="" hidden></div>
            <ul class="ctx-legend" aria-label="${esc(tBi('Context category breakdown', '上下文分类明细'))}">${legendHtml}</ul>
            ${drawerTemplatesHtml}`;
    }

    // ── Largest Items (collapsible Top 5) ──
    const largestItemsHtml = cb.largestItems.length > 0 ? `
        <details id="overview-largest-items" class="ctx-largest-details" data-state-key="overview-largest-items">
            <summary>
                <span>${tBiHtml('Largest Items', '最大占用项')}</span>
                <span class="ctx-largest-count">${cb.largestItems.length}</span>
            </summary>
            <ol class="ctx-largest-list">
                ${cb.largestItems.slice(0, 5).map((item, idx) => {
        const meta = CONTEXT_CATEGORY_META[item.category];
        const fallback = meta?.fallbackColor || '#A8A29E';
        const colorToken = meta?.colorToken || '--ctx-cat-other';
        const itemTipAttrs = richTipAttrs({
            key: `overview:ctx-largest:${idx}`,
            title: meta ? tBi(meta.labelEn, meta.labelZh) : item.category,
            body: `${item.title}\n${formatNumber(item.tokens)} tokens · ${item.pct.toFixed(1)}% ${tBi('of used', '占当前已用')}${item.budgetPct > 0 ? ` · ${item.budgetPct.toFixed(1)}% ${tBi('of budget', '占压缩上限')}` : ''}`,
            meta: item.stepIndex !== undefined
                ? tBi(`From step #${item.stepIndex}`, `来自第 #${item.stepIndex} 步`)
                : undefined,
            focusable: true,
        });
        return `<li class="ctx-largest-row" data-ctx-cat="${item.category}"${itemTipAttrs}>
                        <span class="ctx-legend-swatch" style="background:var(${colorToken}, ${fallback})" aria-hidden="true"></span>
                        <span class="ctx-largest-title">${esc(item.title)}</span>
                        <span class="ctx-largest-tokens">${esc(formatCompactTokens(item.tokens))}</span>
                        <span class="ctx-largest-pct">${esc(item.pct.toFixed(1))}%</span>
                    </li>`;
    }).join('')}
            </ol>
        </details>` : '';

    // ── One-click Quick Actions ──
    const copyCtxTipAttrs = richTipAttrs({
        key: 'overview:action:copy-context',
        title: tBi('Copy /context Report', '复制 /context 报告'),
        body: tBi(
            'Copies a concise plain-text breakdown of context usage, category percentages, largest items, and quota status.',
            '复制纯文本格式的上下文用量、分类占比、最大占用项与配额状态摘要，便于记录或排查。',
        ),
        meta: tBi('Output language follows your current panel language.', '导出语言自动跟随面板当前语言设置。'),
    });
    const copyHandoffTipAttrs = richTipAttrs({
        key: 'overview:action:copy-handoff',
        title: tBi('Copy Handoff Prompt', '复制交接提示词'),
        body: tBi(
            'Generates a ready-to-paste HANDOFF.md continuation prompt so you can start a fresh conversation without losing progress.',
            '生成可直接粘贴到新会话的 HANDOFF.md 交接提示词，在上下文快满时无损衔接任务。',
        ),
        meta: tBi('Includes workspace, branch, active focus, and resume checklist.', '包含工作区、分支、当前焦点与续接检查清单。'),
    });
    const quickActionsHtml = `<div class="ctx-quick-actions">
        <button type="button" class="ctx-action-btn" id="copyContextReportBtn" data-action="copyContextReport"${copyCtxTipAttrs}>${ICON.copy} <span>${tBiHtml('Copy /context Report', '复制 /context 报告')}</span></button>
        <button type="button" class="ctx-action-btn" id="copyHandoffPromptBtn" data-action="copyHandoffPrompt"${copyHandoffTipAttrs}>${ICON.file} <span>${tBiHtml('Copy Handoff Prompt', '复制交接提示词')}</span></button>
        <span id="ctxCopyFeedback" class="threshold-feedback" role="status"></span>
    </div>`;

    return `<section class="ctx-breakdown-card" data-ctx-breakdown="true" data-viz-mode="bar" aria-labelledby="ctx-breakdown-heading">
        <header class="ctx-breakdown-head">
            <div class="ctx-breakdown-title-wrap">
                <h4 id="ctx-breakdown-heading">${tBiHtml('Context Composition', '上下文构成')}</h4>
                <span class="ctx-measure-badge ${badge.cls}" data-measurement-state="${cb.measurementState}"${measureBadgeTipAttrs}>${badge.html}</span>
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
        const tierBody = exceeded
            ? tBi(
                `Context (${formatCompactTokens(watermarks.contextUsed)}) has crossed the 200k standard API long-context tier (standard API list prices double above 200k, with higher latency and attention degradation). For Antigravity subscription users, this does NOT charge extra money or hard-truncate your conversation — it is an API reference cost & speed/quality heads-up.`,
                `当前上下文（${formatCompactTokens(watermarks.contextUsed)}）已超过 200k 标准 API 长上下文阶梯线（标准公开 API 超过 200k 输入后单价通常翻倍，且延迟升高、注意力衰减更明显）。对 Antigravity 订阅用户而言不会额外扣费，也不会强制截断会话，仅作 API 参考费用与速度/质量提醒。`,
            )
            : tBi(
                `${formatCompactTokens(watermarks.tokensUntilLongContextTier ?? 0)} tokens left before the 200k standard API long-context tier (above 200k standard API list prices double and latency/attention degradation increase). For Antigravity subscription users, crossing 200k does NOT charge extra money or hard-truncate your conversation — it is an API reference cost & speed/quality heads-up.`,
                `距离 200k 标准 API 长上下文阶梯线还有 ${formatCompactTokens(watermarks.tokensUntilLongContextTier ?? 0)} tokens（标准公开 API 超过 200k 输入后单价通常翻倍，且延迟升高、注意力更易衰减）。对 Antigravity 订阅用户而言不会额外扣费，也不会强制截断会话，仅作 API 参考费用与速度/质量提醒。`,
            );
        const tierMeta = tBi(
            'Reference heads-up only (no extra subscription charge and no hard cutoff); shown on models supporting >200k context.',
            '仅作参考提醒（不额外向订阅用户收费，也不会强行截断会话）；仅在支持 >200k 上下文的模型上标注。',
        );
        const tickAttrs = richTipAttrs({
            key: 'overview:watermark:200k-tick',
            title: tBi('200k Long-Context Tier', '200k 长上下文阶梯'),
            body: tierBody,
            meta: tierMeta,
        });
        const pillAttrs = richTipAttrs({
            key: 'overview:watermark:200k-pill',
            title: tBi('200k Long-Context Tier', '200k 长上下文阶梯'),
            body: tierBody,
            meta: tierMeta,
            focusable: true,
        });
        markers.push(`<span class="overview-watermark-tick is-tier-200k${exceeded ? ' is-exceeded' : ''}" data-watermark="long-context-200k" style="left:${leftPct.toFixed(1)}%"${tickAttrs} aria-hidden="true"></span>`);
        pills.push(`<span class="overview-watermark-pill${exceeded ? ' is-tier-exceeded' : ''}" data-watermark-pill="long-context-200k"${pillAttrs}>${
            exceeded
                ? tBiHtml('> 200k Tier', '已超 200k 阶梯')
                : `${tBiHtml('200k Tier', '200k 阶梯')} · ${esc(formatCompactTokens(watermarks.tokensUntilLongContextTier ?? 0))} ${tBiHtml('left', '剩余')}`
        }</span>`);
    }

    if (watermarks.hasDistinctPhysicalWindow) {
        const compBody = tBi(
            `Auto-compaction ceiling is ${formatCompactTokens(watermarks.compactionLimit)} (${watermarks.compactionMarkerPct.toFixed(0)}% of the ${formatCompactTokens(watermarks.physicalContextWindow)} native model window).`,
            `自动压缩上限为 ${formatCompactTokens(watermarks.compactionLimit)}（占底层模型 ${formatCompactTokens(watermarks.physicalContextWindow)} 原生窗口上限的 ${watermarks.compactionMarkerPct.toFixed(0)}%）。`,
        );
        const compMeta = tBi(
            'Antigravity compacts conversation history at this ceiling before the physical window fills up.',
            '达到自动压缩上限时平台会提前总结旧消息，因此该线早于物理窗口触发。',
        );
        const compTickAttrs = richTipAttrs({
            key: 'overview:watermark:compaction-tick',
            title: tBi('Auto-Compaction Ceiling', '自动压缩上限'),
            body: compBody,
            meta: compMeta,
        });
        const compPillAttrs = richTipAttrs({
            key: 'overview:watermark:compaction-pill',
            title: tBi('Auto-Compaction Limit / Native Ceiling', '自动压缩上限 / 原生上限'),
            body: compBody,
            meta: compMeta,
            focusable: true,
        });
        markers.push(`<span class="overview-watermark-tick is-compaction-cap" data-watermark="compaction-limit" style="left:100%"${compTickAttrs} aria-hidden="true"></span>`);
        pills.push(`<span class="overview-watermark-pill" data-watermark-pill="compaction-limit"${compPillAttrs}>${tBiHtml('Compaction', '自动压缩上限')} ${esc(formatCompactTokens(watermarks.compactionLimit))} / ${tBiHtml('Native', '原生上限')} ${esc(formatCompactTokens(watermarks.physicalContextWindow))}</span>`);
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
    let pillBody = tBi(
        'Reflects real server-side Prompt Cache reuse from local telemetry: this turn reused <10% of cached history (common on the first turn, >5m idle expiry, or a model switch, so the prefix must be re-read).',
        '反映本地遥测上报的真实服务端提示词缓存复用：本轮命中率不足 10%（常见于首轮新会话、闲置超 5 分钟缓存过期或切换模型，需重新读取前缀）。',
    );
    if (latest.cacheStart === 'warm') {
        pillCls = 'is-warm';
        pillHtml = tBiHtml('Warm Start', '热缓存启动');
        pillBody = tBi(
            'Reflects real server-side Prompt Cache reuse from local telemetry: this turn reused ≥70% of cached history for faster first-token latency and lower API reference cost.',
            '反映本地遥测上报的真实服务端提示词缓存复用：本轮复用了 ≥70% 的已缓存历史，首字响应更快、API 参考费用更低。',
        );
    } else if (latest.cacheStart === 'partial') {
        pillCls = 'is-partial';
        pillHtml = tBiHtml('Partial Start', '部分命中');
        pillBody = tBi(
            'Reflects real server-side Prompt Cache reuse from local telemetry: this turn reused 10%–70% of cached history (partial reuse after edits, file updates, or compaction).',
            '反映本地遥测上报的真实服务端提示词缓存复用：本轮命中率介于 10%–70%（常见于编辑改动或上下文压缩后的部分复用）。',
        );
    }
    const pillTipAttrs = richTipAttrs({
        key: 'overview:turn-cache-start',
        title: tBi('Latest Turn Cache Start', '本轮缓存启动状态'),
        body: latest.cacheHitPct !== null
            ? `${pillBody}\n${tBi('Latest turn cache hit', '本轮缓存命中率')}: ${latest.cacheHitPct.toFixed(1)}%`
            : pillBody,
        meta: tBi(
            'Thresholds: Warm ≥70% (cached history reused) · Partial 10%–70% (after edits/compaction) · Cold <10% (first turn / >5m idle expiry / model switch).',
            '判定阈值：热缓存启动 ≥70%（复用历史）· 部分命中 10%–70%（改动/压缩后部分复用）· 冷启动 <10%（首轮 / 闲置超 5 分钟过期 / 切换模型需重读）。',
        ),
        focusable: true,
    });

    const hitPctHtml = latest.cacheHitPct !== null
        ? ` <span>(${esc(latest.cacheHitPct.toFixed(0))}%)</span>`
        : '';

    let deltaHtml = '';
    if (latest.netContextDeltaTokens !== null) {
        const sign = latest.netContextDeltaTokens >= 0 ? '+' : '−';
        const formatted = `${sign}${formatCompactTokens(Math.abs(latest.netContextDeltaTokens))}`;
        const deltaTipAttrs = richTipAttrs({
            key: 'overview:turn-net-delta',
            title: tBi('Turn Net Context Growth (Δ)', '本轮上下文净变化 (Δ)'),
            body: latest.isCompactionDrop
                ? tBi(
                    `Context shrank by ${formatCompactTokens(Math.abs(latest.netContextDeltaTokens))} tokens compared with the previous turn due to auto-compaction.`,
                    `相比上一轮净减少 ${formatCompactTokens(Math.abs(latest.netContextDeltaTokens))} tokens（已触发自动压缩释放空间）。`,
                )
                : tBi(
                    `Net change in total prompt context (${formatted} tokens) added during the latest user turn.`,
                    `最近一轮对话使总上下文净变化了 ${formatted} tokens。`,
                ),
            meta: tBi('Compares latest turn peak prompt size against the previous turn.', '对比本轮与上一轮的提示词总 Token 数差值。'),
            focusable: true,
        });
        deltaHtml = `<span class="overview-turn-delta${latest.isCompactionDrop ? ' is-compaction' : ''}" data-turn-net-delta="${latest.netContextDeltaTokens}"${deltaTipAttrs}>${tBiHtml('Δ Context', '上下文净增长')} ${esc(formatted)}</span>`;
    }

    const switchHtml = latest.hadColdCacheSwitch
        ? `<span class="orch-cold-switch-pill"${richTipAttrs({
            key: 'overview:turn-cold-switch',
            title: tBi('Switch Cold Start', '切换冷启动'),
            body: tBi(
                'Switching models (or Orchestrator/Executor roles) mid-turn invalidated the previous prompt cache prefix, triggering a cold re-prefill.',
                '本轮中途切换了模型或编排/执行角色，导致原提示词缓存前缀失效并触发冷启动重算。',
            ),
            meta: tBi('Detected when a call changes model and its cache hit drops below 10%.', '触发口径：同会话发生模型切换且该次调用缓存命中率低于 10%。'),
            focusable: true,
        })}>${tBiHtml('Switch Cold', '切换冷启动')}</span>`
        : '';

    return `<div class="overview-turn-cache-row" data-turn-cache-state="${latest.cacheStart}" data-turn-index="${latest.turnIndex}">
        <span class="turn-start-pill ${pillCls}" data-turn-start="${latest.cacheStart}"${pillTipAttrs}>${pillHtml}${hitPctHtml}</span>
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
        ? `<div class="orch-route-pill" data-cross-pool="${activeRoute.isCrossPool ? 'true' : 'false'}"${richTipAttrs({
            key: 'overview:orch-route',
            title: tBi('Orchestrator Route', '编排路由'),
            body: activeRoute.isCrossPool
                ? tBi(
                    `${activeRoute.plannerLabel} plans the task and delegates execution to ${activeRoute.executorLabel}. Cross-pool means the two roles draw from different shared quota pools.`,
                    `由 ${activeRoute.plannerLabel} 负责规划任务，并交由 ${activeRoute.executorLabel} 执行；「跨配额池」表示两个角色消耗不同共享配额池的额度。`,
                )
                : tBi(
                    `${activeRoute.plannerLabel} plans the task and delegates execution to ${activeRoute.executorLabel}.`,
                    `由 ${activeRoute.plannerLabel} 负责规划任务，并交由 ${activeRoute.executorLabel} 执行。`,
                ),
            meta: tBi('Configure Planner / Executor roles in Antigravity Orchestrator Settings.', '可在 Antigravity 编排设置中调整规划与执行模型。'),
            focusable: true,
        })}>
            <span class="orch-route-label">${tBiHtml('Orchestrator', '编排模型')}</span>
            <span class="orch-route-pair">${esc(activeRoute.plannerLabel)} <span class="orch-route-arrow" aria-hidden="true">→</span> ${esc(activeRoute.executorLabel)}</span>
            ${activeRoute.isCrossPool ? `<span class="orch-route-badge">${tBiHtml('Cross-pool', '跨配额池')}</span>` : ''}
        </div>`
        : '';
    const contextLabel = tBi('Context used', '上下文占用');
    const ratio = reading.percent === null ? '—' : `${number(reading.percent, 1)}%`;
    const precisionTipAttrs = richTipAttrs({
        key: 'overview:precision-badge',
        title: usage.isEstimated ? tBi('Estimated Context Reading', '估算上下文读数') : tBi('Measured Context Reading', '实测上下文读数'),
        body: usage.isEstimated
            ? tBi(
                'Inferred from observed trajectory steps or checkpoint delta because a newer model usage snapshot has not arrived yet.',
                '当前基于已观测步骤或检查点增量推算，待下一次模型调用完成后将校准为实测值。',
            )
            : tBi(
                'Directly measured from the latest model usage telemetry reported by Antigravity.',
                '直接来自 Antigravity 最近一次模型调用上报的真实 Token 计量。',
            ),
        focusable: true,
    });
    const precisionHtml = `<span class="overview-precision-pill"${precisionTipAttrs}>${usage.isEstimated ? tBiHtml('Estimated', '估算') : tBiHtml('Measured', '实测')}</span>`;
    const warnings = [
        ...(usage.hasGaps ? [tBiHtml('Data may be incomplete (some step batches failed to load)', '数据可能不完整（部分步骤批次加载失败）')] : []),
        ...(reading.percent !== null && reading.percent > 100
            ? [tBiHtml('Above the context limit', '已超过上下文上限')] : []),
        ...(usage.imageGenerationIncomplete
            ? [tBiHtml('Image workflow data is incomplete', '图片工作流数据不完整')] : []),
    ];
    const diagnostics = [
        metric(tBiHtml('Model Output', '模型输出'), esc(number(usage.totalOutputTokens)), {
            key: 'overview:diag:output',
            title: tBi('Cumulative Model Output', '累计模型输出'),
            body: tBi('Total tokens generated by the model across this conversation.', '本会话中模型累计生成的输出 Token 总量。'),
        }),
        metric(tBiHtml('Tool Results', '工具结果'), esc(number(usage.totalToolCallOutputTokens)), {
            key: 'overview:diag:tools',
            title: tBi('Cumulative Tool Results', '累计工具结果'),
            body: tBi('Total tokens returned by file reads, command executions, searches, and MCP tools.', '文件读取、命令执行、搜索及 MCP 工具累计返回的 Token 总量。'),
        }),
        metric(tBiHtml('Steps', '步骤数'), esc(number(usage.stepCount)), {
            key: 'overview:diag:steps',
            title: tBi('Trajectory Steps', '会话步骤数'),
            body: tBi('Number of recorded conversation steps (messages, model replies, tool calls, and checkpoints).', '本会话记录的总步骤数（包含提问、回复、工具调用与检查点）。'),
        }),
    ];
    if (usage.compressionDetected) {
        const label = compression?.source === 'checkpoint'
            ? tBiHtml('Checkpoint Input Drop', '检查点输入压缩量')
            : tBiHtml('Context Drop', '上下文压缩量');
        diagnostics.push(metric(label, esc(compression ? `${number(compression.dropTokens)} ${tokenUnit} · ${number(compression.dropPercent, 1)}%` : '—'), {
            key: 'overview:diag:drop',
            title: tBi('Compaction Drop', '上下文压缩释放量'),
            body: tBi('Tokens reclaimed when Antigravity automatically summarized earlier conversation history.', 'Antigravity 自动压缩早期对话历史后释放的 Token 数量与比例。'),
        }));
        if (usableCount(usage.previousContextUsed)) {
            diagnostics.push(metric(tBiHtml('Before', '压缩前'), esc(number(usage.previousContextUsed)), {
                key: 'overview:diag:before',
                title: tBi('Before Compaction', '压缩前上下文'),
                body: tBi('Measured context size right before auto-compaction ran.', '触发自动压缩前的上下文占用量。'),
            }));
            diagnostics.push(metric(tBiHtml('After', '压缩后'), esc(number(reading.used)), {
                key: 'overview:diag:after',
                title: tBi('After Compaction', '压缩后上下文'),
                body: tBi('Current context size remaining after auto-compaction.', '自动压缩完成后剩余的上下文占用量。'),
            }));
        }
    }
    if (usage.estimatedDeltaSinceCheckpoint > 0) {
        const source = isPlanner
            ? tBiHtml('since last model call', '自上次模型调用')
            : tBiHtml('since last checkpoint', '自上次检查点');
        diagnostics.push(metric(tBiHtml('Est. delta', '估算增量'), `+${esc(number(usage.estimatedDeltaSinceCheckpoint))} · ${source}`, {
            key: 'overview:diag:delta',
            title: tBi('Estimated Unmeasured Delta', '估算未实测增量'),
            body: tBi('Approximate tokens added by new steps after the last measured model usage snapshot.', '上次实测用量之后，新增对话步骤所贡献的估算增量。'),
        }));
    }
    if (usage.imageGenStepCount > 0) {
        const models = usage.imageGenerationModels?.map(normalizeModelDisplayName).join(' · ');
        diagnostics.push(metric(tBiHtml('Image Gen', '图片生成'), esc(number(usage.imageGenStepCount)), {
            key: 'overview:diag:img-count',
            title: tBi('Image Generation Steps', '图片生成次数'),
            body: tBi('Number of image generation tool steps observed in this conversation.', '本会话中记录的图片生成步骤次数。'),
        }));
        if (models) {
            diagnostics.push(metric(tBiHtml('Image model', '图片模型'), esc(models), {
                key: 'overview:diag:img-model',
                title: tBi('Image Generation Model', '图片生成模型'),
                body: tBi('Image model(s) invoked during image generation steps.', '本次会话图片生成步骤实际调用的模型名称。'),
            }));
        }
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
                    ${metric(tBiHtml('Input', '输入'), esc(number(last.inputTokens)), {
            key: 'overview:diag:last-input',
            title: tBi('Uncached Input Tokens', '新增未缓存输入'),
            body: tBi('Fresh input tokens not served from prompt cache in the latest call.', '最近一次调用中未命中缓存、需完整计算的新增输入 Token。'),
        })}
                    ${metric(tBiHtml('Output', '输出'), esc(number(last.outputTokens)), {
            key: 'overview:diag:last-output',
            title: tBi('Model Output Tokens', '模型输出'),
            body: tBi('Total output tokens (including Thinking tokens) emitted by the latest call.', '最近一次调用模型生成的总输出 Token（含思考过程）。'),
        })}
                    ${metric(tBiHtml('Cache', '缓存'), esc(number(last.cacheReadTokens)), {
            key: 'overview:diag:last-cache',
            title: tBi('Cache Read Tokens', '热缓存读取'),
            body: tBi('Prompt tokens served directly from server-side prompt cache (additive with Input).', '直接从服务端热缓存复用的提示词 Token（与新增输入为相加关系）。'),
        })}
                    ${metric(tBiHtml('Cache creation', '缓存创建'), esc(number(last.cacheCreationTokens ?? 0)), {
            key: 'overview:diag:last-cache-create',
            title: tBi('Cache Creation Tokens', '缓存写入'),
            body: tBi('Prompt tokens written into server-side cache for subsequent turns.', '本次新写入服务端缓存、供后续对话复用的提示词 Token。'),
        })}
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
    const staleBannerHtml = buildStaleBannerHtml(telemetry?.staleState, 'overview');
    const hasStaleFallbackData = Boolean(telemetry?.staleState?.isStale && (configs.length > 0 || usage || userInfo));
    const connected = (status.state !== 'connecting' && status.state !== 'disconnected') || hasStaleFallbackData;
    const active = (status.state === 'active' || hasStaleFallbackData) ? usage : null;
    const isCustomModelActive = Boolean(telemetry?.isCustomModelActive);
    const activeCascadeId = telemetry?.activeCascadeId || active?.cascadeId;

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

    const breakdownHtml = connected ? buildContextBreakdownCard(telemetry?.contextBreakdown, resolvedWatermarks) : '';

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
        const poolKey = group.pool || group.key;
        const band = quotaPercentage(group);
        const unknownQuota = group.minimum === null;
        const partial = (group.missingQuota && group.minimum !== null) || (group.missingReset && group.resetTime);
        const hasDualWindow = Boolean(group.fiveHourQuota || group.weeklyQuota);
        const poolRoleTag = activeRoute?.isCrossPool && group.pool
            ? (activeRoute.plannerPool === group.pool
                ? ` <span class="orch-route-badge"${richTipAttrs({
                    key: `overview:quota-role:${poolKey}`,
                    title: tBi('Planner Role Pool', '规划角色配额池'),
                    body: tBi('Your active Orchestrator Planner model draws quota from this shared pool.', '当前活跃会话的「规划（编排）」模型正在消耗该配额池的额度。'),
                    focusable: true,
                })}>${tBiHtml('Planner', '规划')}</span>`
                : activeRoute.executorPool === group.pool
                    ? ` <span class="orch-route-badge"${richTipAttrs({
                        key: `overview:quota-role:${poolKey}`,
                        title: tBi('Executor Role Pool', '执行角色配额池'),
                        body: tBi('Your active Orchestrator Executor model draws quota from this shared pool.', '当前活跃会话的「执行」模型正在消耗该配额池的额度。'),
                        focusable: true,
                    })}>${tBiHtml('Executor', '执行')}</span>`
                    : '')
            : '';
        const runwayEstimate = runways
            ? ((group.pool && runways[group.pool]) || runways[group.key])
            : undefined;
        const runwayHtml = isCustomModelActive ? '' : formatRunwayBadgeHtml(runwayEstimate, 'overview');
        const dualHtml = hasDualWindow
            ? `<div class="quota-dual-row">
                ${group.fiveHourQuota ? dualQuotaWindowHtml(group.label, poolKey, '5h', group.fiveHourQuota, now) : ''}
                ${group.weeklyQuota ? dualQuotaWindowHtml(group.label, poolKey, 'weekly', group.weeklyQuota, now) : ''}
            </div>`
            : `${unknownQuota
                ? '<div class="overview-meter is-unknown" aria-hidden="true"></div>'
                : meter(`${group.label} · ${quotaTitlePlain}`, group.minimum! * 100, band, quotaMeterTone(group.minimum! * 100))}
            <p class="overview-meta">${quotaResetHtml(group, now)}${partial ? ` · ${tBiHtml('Partial data', '数据不完整')}` : ''}</p>`;
        const poolHeadingTip = richTipAttrs({
            key: `overview:quota-pool:${poolKey}`,
            title: group.label,
            body: tBi(
                `Shared quota pool grouping ${group.members.length === 1 ? '1 model' : `${group.members.length} models`} under one allowance (${unknownQuota ? 'remaining unavailable' : `${band} remaining`}).`,
                `共享配额池，共包含 ${group.members.length} 个模型，共用同一额度（${unknownQuota ? '暂无剩余数据' : `当前剩余 ${band}`}）。`,
            ),
            meta: tBi(
                'Models in the same pool share the same rate-limit allowance and reset timer.',
                '同一配额池内的模型共享相同的可用额度与重置倒计时。',
            ),
            focusable: true,
        });
        return `<li class="overview-quota-row" data-pool-key="${esc(poolKey)}">
            <div class="overview-quota-heading">
                <div${poolHeadingTip}><h3>${esc(group.label)}${poolRoleTag}</h3><span class="overview-meta">${modelFamilyCountHtml(group.members.length)}</span></div>
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
        ? `${buildCustomModelBannerHtml('overview')}${quotaRows ? `<details id="overview-custom-model-pools" class="custom-model-pools-collapse" data-state-key="overview-custom-model-pools">
            <summary><span>${tBiHtml('Google Quota Pools (Paused for Custom Model)', 'Google 配额池（自定义模型已隔离）')}</span></summary>
            <ul class="overview-quotas">${quotaRows}</ul>
        </details>` : ''}`
        : (quotaRows
            ? `<ul class="overview-quotas">${quotaRows}</ul>`
            : `<p class="overview-empty">${tBiHtml('Waiting for quota data.', '等待配额数据。')}</p>`);

    const emptyContextHtml = status.state === 'idle'
        ? tBiHtml('No context measurement for this conversation yet.', '当前会话暂无上下文计量。')
        : tBiHtml('Open an Antigravity conversation to see its context usage.', '打开 Antigravity 会话后即可查看上下文用量。');

    const glossaryHtml = connected ? buildOverviewGlossaryHtml() : '';
    const planTipAttrs = richTipAttrs({
        key: 'overview:plan-pill',
        title: tBi('Active Subscription Plan', '当前订阅方案'),
        body: tBi(
            `Account plan reported by Antigravity: ${plan}. Determines your shared quota pool capacity and available models.`,
            `由 Antigravity 上报的当前账号订阅方案：${plan}，决定共享配额池容量与可用模型范围。`,
        ),
        focusable: true,
    });
    const aiCreditsTipAttrs = richTipAttrs({
        key: 'overview:ai-credits',
        title: tBi('Account AI Credits', '账号 AI 积分'),
        body: credits === null
            ? tBi('AI Credit balance was not reported by the backend for this account.', '本地服务暂未上报当前账号的 AI 积分余额。')
            : tBi(
                `Available Account AI Credits: ${number(credits)}. Used for overflow usage or premium features when supported by your plan.`,
                `当前可用账号 AI 积分：${number(credits)}，用于方案支持的超额用量或高级功能抵扣。`,
            ),
        meta: tBi(
            'Expiry countdown is calculated locally from the billing day configured in the Account/Profile tab.',
            '到期倒计时依据你在「账号」页设置的每月账单日在本地推算。',
        ),
        focusable: true,
    });

    return `<section class="monitor-overview" data-monitor-overview data-monitor-state="${status.state}" aria-labelledby="overview-heading">
        <header class="overview-header">
            <h2 id="overview-heading" data-overview-focus="heading" tabindex="-1">${tBiHtml('Context & quota', '上下文与配额')}</h2>
            ${connected && plan ? `<p class="overview-meta overview-plan-pill"${planTipAttrs}>${esc(plan)}</p>` : ''}
        </header>
        ${staleBannerHtml}
        ${lowQuotaBannerHtml}
        ${connected ? `<div class="overview-grid">
            <section class="overview-context" aria-labelledby="overview-context-heading">
                <h3 id="overview-context-heading" class="overview-section-heading"><span class="overview-state-dot" aria-hidden="true"></span><span>${statusHeadingHtml(status.state)}</span></h3>
                ${active ? sessionDetails(active, telemetryHtml, breakdownHtml, { watermarks: resolvedWatermarks, turnCacheHtml, orchestratorSplitHtml }) : `<p class="overview-empty">${emptyContextHtml}</p>${turnCacheHtml}${breakdownHtml}${telemetryHtml}${orchestratorSplitHtml}`}
                ${action('gmdata', tBiHtml('View model activity', '查看模型活动'))}
                ${glossaryHtml}
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
            ${connected && (userInfo || billingDay > 0) ? `<p${aiCreditsTipAttrs}>
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

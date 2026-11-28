import { aiCreditTotal } from './account-credits';
import { formatClockTime, formatNumber, getLanguage, t, tBi, tHtml } from './i18n-core';
import { getDaysUntilBillingDay } from './billing-day';
import {
    formatCurrencyAmount,
    formatDualCurrencyAmount,
    resolveCurrencyConfig,
    type CurrencyInput,
} from './core/currency';
import {
    projectForOverview,
    type ContextDisplayBasis,
    type ContextThresholdMarker,
    type PublishedMonitorObservation,
    type SurfaceObservationProjection,
} from './core/context-display';
import type { SwarmGroupCostSummary, SwarmTopologySnapshot } from './core/swarm-registry';
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
    getModelDisplayName,
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
import {
    projectQuotaDisplay,
    type QuotaDirectionMode,
    type QuotaRunwayEstimate,
    type QuotaWindowMode,
} from './quota-runway';
import { formatResetAbsolute } from './reset-time';
import {
    formatCachePercent,
    formatLatency,
    formatSpeed,
    type CacheState,
    type PromptCacheTtlEvaluation,
    type SpeedMetricMode,
} from './telemetry-metrics';
import type { ContextUsage } from './tracker';
import type { CdpStatus } from './app/sidecar-types';
import { ICON } from './webview-icons';
import { esc, richTipAttrs, tBiHtml, type RichTipSpec } from './webview-helpers';

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

export interface SwarmMemberLiveRow {
    cascadeId: string;
    memberName: string;
    role?: string;
    isCoordinator?: boolean;
    relationshipKind?: 'swarm_member' | 'direct_subagent' | 'nested_helper' | 'fork';
    phase?: string;
    killed?: boolean;
    /** Assigned model from swarm manifest (strictly distinct from measuredModel). */
    assignedModel?: string | null;
    /** Actual model measured from RPC telemetry. */
    measuredModel?: string | null;
    contextPct?: number | null;
    contextUsedTokens?: number | null;
    contextLimitTokens?: number | null;
    directCostUsd?: number | null;
    recordedCalls?: number;
    unpricedCalls?: number;
    lastObservedAt?: number | null;
    isInspected?: boolean;
    isLockedRoot?: boolean;
}

export interface SwarmOverviewDisplayData {
    rootId: string;
    title?: string;
    members: readonly SwarmMemberLiveRow[];
    totalMemberCount?: number;
    observedMemberCount?: number;
    partialCoverage?: boolean;
    /** Deduplicated inclusive group cost across unique logical calls (USD). */
    groupTotalCostUsd?: number | null;
    groupUnpricedCalls?: number;
    membersWithCalls?: number;
    lastSweepAtMs?: number | null;
}

export interface HandoffV2PreviewData {
    subjectCascadeId: string;
    dataRevision: number;
    markdown: string;
    generatedAtMs?: number;
}

export interface CompactionRecoveryBriefData {
    eventKey: string;
    cascadeId: string;
    model?: string;
    role?: string;
    branch?: string;
    beforeTokens?: number | null;
    afterTokens?: number | null;
    savedTokens?: number | null;
    summaryText: string;
    observedAtMs?: number;
    dismissed?: boolean;
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
    /** v1.18 D9: Single frozen observation backing cross-surface parity. */
    observation?: PublishedMonitorObservation | null;
    /** v1.18 D9: Active inspected worker/subagent cascade ID (when inspecting without changing lockedRootId). */
    inspectedMemberId?: string | null;
    /** v1.18 D9: Display label/title for the currently inspected member. */
    inspectedMemberLabel?: string | null;
    /** v1.18 D9: Currently locked main coordinator cascade ID (if any). */
    lockedRootId?: string | null;
    /** v1.18 D9: True when the locked root is transiently absent (pending, never silently cleared). */
    lockPendingUnavailable?: boolean;
    /** v1.18 D9: Optional non-intrusive offer to retarget lockedRootId to a newly focused main conversation. */
    retargetOfferId?: string | null;
    /** v1.18 D9: Optional display title for the retarget offer target. */
    retargetOfferTitle?: string | null;
    /** Conversations available from this host, distinct from manifest-only membership. */
    readableMemberIds?: ReadonlySet<string>;
    /** v1.18 D9: Optional pre-aggregated Swarm / Subagents live tracking payload. */
    swarmOverview?: SwarmOverviewDisplayData | null;
    /** v1.18 D9: Optional raw Swarm topology snapshot (auto-projected if swarmOverview omitted). */
    swarmTopology?: SwarmTopologySnapshot | null;
    swarmGroupCost?: SwarmGroupCostSummary | null;
    /** v1.18 §5.2.4: Optional pre-populated Handoff v2 preview bound to (subjectCascadeId, dataRevision). */
    handoffPreview?: HandoffV2PreviewData | null;
    /** v1.18 §5.2.4: Optional read-only Compaction Recovery Brief card (dismissible, never auto-injected). */
    recoveryBrief?: CompactionRecoveryBriefData | null;
    /** v1.18 §5.2.1: Optional active Prompt Cache 5m idle TTL heuristic evaluation. */
    cacheTtl?: PromptCacheTtlEvaluation | null;
    /** v1.18 D9: Active context percentage display basis ('compaction' | 'native'). */
    contextPctBasis?: ContextDisplayBasis;
    /** v1.18 §5.2.2: Active speed metric mode ('decode' | 'e2e'). */
    speedMetricMode?: SpeedMetricMode;
    /** v1.18 §5.2.3: Active quota display window ('5h' | '7d' | 'tightest'). */
    quotaWindowMode?: QuotaWindowMode;
    /** v1.18 §5.2.3: Active quota percentage direction ('remaining' | 'used'). */
    quotaDirectionMode?: QuotaDirectionMode;
    /** v1.18.1: Whether user dismissed the App Overlays & CDP quick-setup banner. */
    appOnboardingDismissed?: boolean;
    /** v1.18.1: Current App CDP status (used to auto-hide onboarding banner once overlays are active). */
    cdpStatus?: CdpStatus | null;
    /** v1.18.1: Whether App Top-Right Status Bar CDP overlay is enabled. */
    appTopBarEnabled?: boolean;
    /** v1.18.1: Whether App Composer Context Ring CDP overlay is enabled. */
    appComposerRingEnabled?: boolean;
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

export function formatRunwayBadgeHtml(estimate: QuotaRunwayEstimate | undefined, keyPrefix = 'runway'): string {
    if (!estimate || estimate.status === 'custom_model_isolated') { return ''; }
    const poolSlug = estimate.poolKey || 'pool';
    const hasRate = typeof estimate.burnRatePctPerHour === 'number' && Number.isFinite(estimate.burnRatePctPerHour) && estimate.burnRatePctPerHour > 0;
    const burnRatePart = hasRate ? ` · ${esc(estimate.burnRatePctPerHour!.toFixed(1))}%/h` : '';
    const windowRule = tBi('45-minute rolling burn slope.', '按最近 45 分钟滚动窗口消耗斜率推算。');
    const rateLine = hasRate ? `\n${tBi('Burn rate', '消耗速率')}: ${estimate.burnRatePctPerHour!.toFixed(1)}%/h` : '';
    const renderPill = (statusAttr: string, cls: string, titleEn: string, titleZh: string, bodyEn: string, bodyZh: string, textHtml: string) => {
        const attrs = richTipAttrs({ key: `${keyPrefix}:runway:${poolSlug}`, title: tBi(titleEn, titleZh), body: `${tBi(bodyEn, bodyZh)}${rateLine}`, meta: windowRule, focusable: true });
        return `<div class="quota-runway-row" data-runway-status="${statusAttr}"><span class="quota-runway-pill ${cls}"${attrs}>${textHtml}</span></div>`;
    };
    if (estimate.status === 'safe_until_reset') {
        return renderPill('safe_until_reset', 'is-safe', 'Quota Runway: Safe', '配额续航：充裕', 'Remaining quota should last until reset.', '按近期速率，配额可撑到下次重置。', `${tBiHtml('Safe before reset', '重置前充裕')}${burnRatePart}`);
    }
    if (estimate.status === 'at_risk') {
        const ex = estimate.estExhaustMs !== null ? formatRunwayDurationHtml(estimate.estExhaustMs) : '—';
        return renderPill('at_risk', 'is-risk', 'Quota Runway: At Risk', '配额续航：预警', 'May run out before next reset.', '按当前速率可能在重置前耗尽。', `${tBiHtml('Est. exhaust in', '预计耗尽')} ${ex}${burnRatePart}`);
    }
    if (estimate.status === 'exhausted') {
        return renderPill('exhausted', 'is-exhausted', 'Quota Exhausted', '配额已耗尽', 'Remaining allowance reached 0%.', '该配额池剩余配额已降至 0%。', tBiHtml('Quota exhausted', '配额已耗尽'));
    }
    if (estimate.recoveredRecently) {
        return renderPill('recovered', 'is-safe', 'Quota Recovered', '配额刚恢复', 'Quota recovered after recent reset.', '检测到配额刚重置回升。', tBiHtml('Quota recently recovered', '配额刚恢复'));
    }
    if (hasRate) {
        return renderPill('insufficient_data', 'is-muted', 'Quota Burn Rate', '配额消耗速率', 'Observed hourly burn rate.', '观测到的每小时配额消耗速率。', `${tBiHtml('Burn rate', '消耗速率')} ${esc(estimate.burnRatePctPerHour!.toFixed(1))}%/h`);
    }
    return '';
}

export function buildAppOnboardingBannerHtml(telemetry?: OverviewExtras): string {
    if (telemetry?.surface !== 'app-sidecar' || telemetry.appOnboardingDismissed) { return ''; }
    const cdpOn = telemetry.cdpStatus?.state === 'connected';
    if (cdpOn && (telemetry.appTopBarEnabled || telemetry.appComposerRingEnabled)) { return ''; }
    const inst = Boolean(telemetry.cdpStatus?.launcherStatus?.installed);
    return `<section class="app-onboarding-banner" id="appOnboardingBanner" data-app-onboarding-banner="true" data-cdp-connected="${cdpOn}" data-launcher-installed="${inst}" aria-labelledby="app-onboarding-heading"><div class="app-onboarding-head"><span class="app-onboarding-badge">${ICON.bolt} <span>${tBiHtml('Overlays & CDP Setup', '悬浮层与 CDP 引导')}</span></span><h3 id="app-onboarding-heading" class="app-onboarding-title">${tBiHtml('Sidecar works zero-config — want persistent overlays too?', '核心侧栏已开箱即用 —— 想开启桌面常驻悬浮层吗？')}</h3></div><p class="app-onboarding-body">${tBiHtml('Enable optional Top Bar & Composer Ring via the zero-patch, auto-update-proof CDP Launcher.', '通过零魔改、抗自动更新的持久化 CDP 启动器开启顶部状态栏与输入框圆环。')}</p><div class="app-onboarding-actions"><button type="button" class="action-btn stg-btn-primary" id="onboardingSetupCdpBtn" data-action="setupCdpLauncher" data-feedback-id="onboardingFeedback"><span>${inst ? tBiHtml('Recreate CDP Launcher', '重新创建启动器') : tBiHtml('1-Click Create CDP Launcher', '一键创建 CDP 启动器')}</span></button><button type="button" class="action-btn" id="onboardingGoCdpBtn" data-action="openOverlaysCdpSettings"><span>${tBiHtml('Open Overlays & CDP Settings', '打开悬浮层与 CDP 设置')}</span></button><button type="button" class="action-btn app-onboarding-dismiss-btn" id="onboardingDismissBtn" data-action="dismissAppOnboarding"><span>${tBiHtml("Don't show again", '不再提示')}</span></button><span id="onboardingFeedback" class="threshold-feedback" role="status"></span></div></section>`;
}

export function buildStaleBannerHtml(staleState: MonitorStaleState | null | undefined, keyPrefix = 'stale'): string {
    if (!staleState?.isStale) { return ''; }
    const lastTime = staleState.lastSuccessAtMs ? formatClockTime(new Date(staleState.lastSuccessAtMs), getLanguage()) : '';
    const updatedPart = lastTime ? ` <span class="stale-banner-time">· ${tBiHtml('Last updated', '上次更新')} ${esc(lastTime)}</span>` : '';
    const errLine = staleState.lastError ? `\n${tBi('Last error', '最近错误')}: ${staleState.lastError}` : '';
    const tipAttrs = richTipAttrs({
        key: `${keyPrefix}:stale-banner`,
        title: tBi('Cached / Stale Telemetry', '缓存数据（待刷新）'),
        body: `${tBi('Local service unreachable; showing last good snapshot.', '暂时无法连接本地服务，保留上次成功快照。')}${errLine}`,
        focusable: true,
    });
    return `<div class="stale-data-banner" role="status" data-stale-banner="true"${tipAttrs}><span class="stale-badge-pill"><span class="stale-dot" aria-hidden="true"></span><span>${tBiHtml('Cached / Stale', '缓存数据（待刷新）')}</span></span><span class="stale-banner-desc">${tBiHtml('Showing last known telemetry while reconnecting.', '正在重连本地服务，保留上次缓存数据。')}${updatedPart}</span></div>`;
}

export function buildCustomModelBannerHtml(keyPrefix = 'byok'): string {
    const tipAttrs = richTipAttrs({
        key: `${keyPrefix}:byok-banner`,
        title: tBi('Custom / BYOK Model Isolation', '自定义 / BYOK 模型配额隔离'),
        body: tBi('Custom/BYOK endpoints do not consume Google Antigravity quota pools.', '自定义 / BYOK 模型由自有服务商计费，不占用 Google Antigravity 配额池。'),
        focusable: true,
    });
    return `<div class="custom-model-banner" role="status" data-custom-model-isolated="true"${tipAttrs}><span class="custom-model-pill">${tBiHtml('Custom Model Isolated', '自定义模型（配额独立）')}</span><span class="custom-model-desc">${tBiHtml('Custom / BYOK model active; Google quota pool alerts suppressed.', '当前使用自定义 / BYOK 模型，不消耗 Google 配额池，已静音池预警。')}</span></div>`;
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
            consider(group.weeklyQuota.remainingFraction, t('quota.weekly'), group.weeklyQuota.resetTime);
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
            `有共享配额池的剩余配额已降至你设定的提醒阈值（≤ ${warning.threshold}%）。`,
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
            <button type="button" class="low-quota-settings-btn" data-overview-target="settings" data-overview-anchor="quotaNotifyInput">${tBiHtml('Threshold', '调整阈值')}</button>
        </div>
        <div class="low-quota-pools">${poolChips}</div>
    </div>`;
}

type JargonKey = 'ttft' | 'dual-cap' | 'session-cost';

const JARGON_CATALOG = `ttft\tTTFT (Time To First Token)\t首字延迟 (TTFT)\tWait time until the first output token.\t发出请求到吐出首字的等待耗时。
dual-cap\tAuto-Compaction Limit vs Native Ceiling\t自动压缩上限 vs 原生窗口上限\tAuto-compaction triggers before the physical model window fills.\t自动压缩上限早于底层模型原生窗口上限触发。
session-cost\tAPI Reference Cost\tAPI 参考费用\tEquivalent public API spend (reference only, not your bill).\t按公开单价折算的参考费用，并非实际订阅账单。`;

const JARGON_MAP: Record<string, readonly [string, string, string, string]> = Object.fromEntries(
    JARGON_CATALOG.split('\n').map(l => {
        const [k, te, tz, be, bz] = l.split('\t');
        return [k, [te, tz, be, bz] as const];
    }),
);

function jargonTipHtml(key: JargonKey): string {
    const [te, tz, be, bz] = JARGON_MAP[key];
    const title = tBi(te, tz);
    const body = tBi(be, bz);
    const attrs = richTipAttrs({ key: `overview:jargon:${key}`, title, body, pin: true });
    return `<button type="button" class="jargon-tip" data-jargon="${key}"${attrs} aria-label="${esc(`${title}: ${body}`)}">?</button>`;
}

const TIER_200K_NOTICE_EN = 'For Antigravity subscriptions, crossing 200k does NOT charge extra money or hard-truncate your conversation — it is an API reference cost & quality heads-up.';
const TIER_200K_NOTICE_ZH = '对 Antigravity 订阅用户而言，超过 200k 不会额外扣费，也不会强制截断会话，仅作 API 参考费用与质量提醒。';
const CACHE_REUSE_PREFIX_EN = 'Real server-side Prompt Cache reuse: ';
const CACHE_REUSE_PREFIX_ZH = '真实服务端提示词缓存复用：';

const OVERVIEW_GLOSSARY_CATALOG = `Auto-Compaction Limit vs Native Ceiling\t自动压缩上限 vs 原生窗口上限\tEffective Budget triggers auto-compaction; Native Ceiling is the model's physical window.\t自动压缩上限触发旧对话总结；原生窗口上限为模型物理容量。
200k Long-Context Tier\t200k 长上下文阶梯\tPublic API rates double above 200k input tokens. {t200e}\t公开 API 超过 200k 单价通常翻倍。{t200z}
Prompt Cache (Warm / Partial / Cold Start)\t提示词缓存（热缓存启动 / 部分命中 / 冷启动）\t{cpe}Warm ≥70%, Partial 10%–70%, Cold <10% (first turn / >5m idle / model switch).\t{cpz}热缓存启动 ≥70%，部分命中 10%–70%，冷启动 <10%（首轮 / 闲置超 5 分钟 / 切换模型）。
TTFT & Speed (Short Sample)\t首字延迟 (TTFT) 与生成速度（短样本）\tTTFT is wait until first token; calls <16 tokens or <0.3s show Short sample.\t首字延迟为吐字等待耗时；输出不足 16 tokens 或耗时不足 0.3s 记为短样本。
Quota Runway\t配额续航预测\tProjects pool depletion using a 45-minute rolling burn slope.\t基于 45 分钟滚动窗口消耗斜率预估配额池能否撑到重置。
API Reference Cost\tAPI 参考费用\tPublic API rate estimate for value reference (not your subscription bill).\t按公开 API 单价折算的参考费用，并非实际订阅账单。`;

function buildOverviewGlossaryHtml(): string {
    const itemsHtml = OVERVIEW_GLOSSARY_CATALOG.split('\n').map(line => {
        const [te, tz, de, dz] = line.split('\t');
        const en = de.replace('{t200e}', () => TIER_200K_NOTICE_EN).replace('{cpe}', () => CACHE_REUSE_PREFIX_EN);
        const zh = dz.replace('{t200z}', () => TIER_200K_NOTICE_ZH).replace('{cpz}', () => CACHE_REUSE_PREFIX_ZH);
        return `<div class="overview-glossary-entry"><dt>${tBiHtml(te, tz)}</dt><dd>${tBiHtml(en, zh)}</dd></div>`;
    }).join('');
    return `<details id="overview-glossary" class="overview-details overview-glossary" data-state-key="overview-glossary"><summary><span>${tBiHtml('Core metrics quick reference', '核心指标速查')}</span></summary><dl class="overview-glossary-list">${itemsHtml}</dl></details>`;
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

function observationHealthTone(proj: SurfaceObservationProjection): MeterTone {
    if (proj.isIncomplete) { return 'default'; }
    if (
        proj.healthStatus === 'overflow'
        || proj.healthStatus === 'high_pressure'
        || proj.compactionWarningLevel === 'critical'
        || proj.compactionWarningLevel === 'overflow'
    ) {
        return 'attention';
    }
    if (proj.healthStatus === 'elevated' || proj.compactionWarningLevel === 'elevated') {
        return 'warn';
    }
    return 'default';
}

function buildObservationMarkersHtml(
    label: string,
    proj: SurfaceObservationProjection,
    watermarks: ContextDualWatermark | null,
): string {
    const tone = observationHealthTone(proj);
    const baseMeter = meter(label, proj.geometryFillPct, proj.primaryPctText, tone);
    const markerItems: ContextThresholdMarker[] = proj.markers ? [...proj.markers] : [];
    const ticks: string[] = [];
    const pills: string[] = [];

    for (const mk of markerItems) {
        const leftPct = Math.max(2, Math.min(100, mk.positionPct));
        const is200k = mk.id === 'tier_200k';
        const isCompaction = mk.id === 'compaction_limit';
        const tickCls = is200k
            ? `is-tier-200k${mk.exceeded ? ' is-exceeded' : ''}`
            : (isCompaction ? 'is-compaction-cap' : '');
        const wmAttr = is200k ? 'long-context-200k' : (isCompaction ? 'compaction-limit' : mk.id);
        const body = is200k
            ? tBi(
                `200k long-context tier on ${proj.actualBasis} axis (${leftPct.toFixed(1)}%).`,
                `${proj.actualBasis === 'native' ? '原生窗口' : '自动压缩'}坐标系上的 200k 长上下文阶梯线（${leftPct.toFixed(1)}%）。`,
            )
            : tBi(
                `${mk.label} (${formatCompactTokens(mk.tokens)}) positioned at ${leftPct.toFixed(1)}% on the ${proj.actualBasis} axis.`,
                `${mk.label}（${formatCompactTokens(mk.tokens)}）位于${proj.actualBasis === 'native' ? '原生窗口' : '自动压缩'}坐标系的 ${leftPct.toFixed(1)}% 处。`,
            );
        const tickTip = richTipAttrs({
            key: `overview:obs-marker:${mk.id}`,
            title: mk.label,
            body,
        });
        const pillTip = richTipAttrs({
            key: `overview:obs-marker:${mk.id}`,
            title: mk.label,
            body,
            focusable: true,
        });
        ticks.push(`<span class="overview-watermark-tick ${tickCls}" data-watermark="${esc(wmAttr)}" data-marker-axis="${esc(mk.axis)}" data-marker-pos="${leftPct.toFixed(1)}" style="left:${leftPct.toFixed(1)}%"${tickTip} aria-hidden="true"></span>`);
        if (is200k) {
            const rem200k = proj.usedTokens !== null ? Math.max(0, mk.tokens - proj.usedTokens) : 0;
            pills.push(`<span class="overview-watermark-pill${mk.exceeded ? ' is-tier-exceeded' : ''}" data-watermark-pill="long-context-200k"${pillTip}>${
                mk.exceeded
                    ? tBiHtml('> 200k Tier', '已超 200k 阶梯')
                    : `${tBiHtml('200k Tier', '200k 阶梯')} · ${esc(formatCompactTokens(rem200k))} ${tBiHtml('left', '剩余')}`
            }</span>`);
        } else if (isCompaction && proj.denominatorTokens !== null) {
            pills.push(`<span class="overview-watermark-pill" data-watermark-pill="compaction-limit"${pillTip}>${tBiHtml('Compaction', '自动压缩上限')} ${esc(formatCompactTokens(mk.tokens))} / ${tBiHtml('Native', '原生上限')} ${esc(formatCompactTokens(proj.denominatorTokens))}</span>`);
        }
    }

    if (ticks.length === 0 && pills.length === 0) {
        if (proj.actualBasis === 'compaction' && watermarks) {
            return buildDualWatermarkMeterHtml(label, proj.geometryFillPct, proj.primaryPctText, tone, watermarks);
        }
        return baseMeter;
    }

    return `<div class="overview-meter-wrap" data-dual-watermark="true" data-marker-axis="${esc(proj.actualBasis)}">
        ${baseMeter}
        <div class="overview-meter-markers">${ticks.join('')}</div>
    </div>
    ${pills.length > 0 ? `<div class="overview-watermark-meta">${pills.join('')}</div>` : ''}`;
}

function buildD9SelectionBannersHtml(telemetry?: OverviewExtras): string {
    if (!telemetry) { return ''; }
    const banners: string[] = [];
    if (telemetry.inspectedMemberId) {
        const node = telemetry.swarmTopology?.nodesById.get(telemetry.inspectedMemberId);
        const member = telemetry.swarmOverview?.members.find(row => row.cascadeId === telemetry.inspectedMemberId);
        const label = member?.memberName || node?.memberName || telemetry.inspectedMemberLabel?.trim() || telemetry.inspectedMemberId.slice(0, 8);
        const root = (member?.isCoordinator ?? node?.isCoordinator) || (!member && !node && telemetry.observation?.subjectKind === 'main');
        const measured = telemetry.observation?.subjectCascadeId === telemetry.inspectedMemberId && telemetry.observation?.usedTokens != null;
        const unavailable = !measured && telemetry.lockPendingUnavailable;
        const rootNote = telemetry.lockedRootId && !root
            ? ` <span class="overview-d9-root-tag">${tBiHtml('Main session locked', '主会话已锁定')}</span>`
            : '';
        banners.push(`<div id="swarm-inspection-banner" tabindex="-1" class="overview-d9-banner is-inspect is-sticky" role="status" data-inspect-banner="true" data-inspected-member="${esc(telemetry.inspectedMemberId)}" data-subject-kind="${root ? 'main' : 'worker'}">
            <span class="overview-d9-banner-text"><span class="swarm-role-badge is-worker">${root ? tHtml('swarm.rootLabel') : tHtml('swarm.inspectedWorker')}</span> <strong class="swarm-member-name">${esc(label)}</strong>${rootNote}${unavailable ? ` · ${tHtml('swarm.readUnavailable')}` : ''}</span>
            <button type="button" class="action-btn" data-action="clearInspect">${tHtml('swarm.backToMain')}</button>
        </div>`);
    }
    if (telemetry.lockPendingUnavailable && telemetry.lockedRootId && !telemetry.readableMemberIds?.has(telemetry.lockedRootId)) {
        banners.push(`<div class="overview-d9-banner is-lock-pending" role="status" data-lock-pending="true" data-locked-root="${esc(telemetry.lockedRootId ?? '')}">
            <span class="overview-d9-banner-text"><span class="swarm-phase-badge is-warn">${tHtml('swarm.pendingUnavailable')}</span> <span>${tBiHtml('Locked root is temporarily unavailable (lock preserved).', '已锁定的主会话暂不可用（锁定锚点已保留）。')}</span></span>
        </div>`);
    }
    if (telemetry.retargetOfferId) {
        const offerLabel = telemetry.retargetOfferTitle?.trim() || telemetry.retargetOfferId.slice(0, 8);
        banners.push(`<div class="overview-d9-banner is-retarget" role="status" data-retarget-banner="true" data-retarget-offer="${esc(telemetry.retargetOfferId)}">
            <span class="overview-d9-banner-text">${tHtml('swarm.retargetPrompt')}: <strong class="swarm-member-name">${esc(offerLabel)}</strong></span>
            <button type="button" class="action-btn" data-action="retargetLockedRoot" data-cascade-id="${esc(telemetry.retargetOfferId)}">${tHtml('swarm.retarget')}</button>
        </div>`);
    }
    return banners.join('');
}

export function deriveSwarmOverviewFromTopology(
    topo: SwarmTopologySnapshot | null | undefined,
    activeCascadeId: string | undefined,
    inspectedMemberId: string | null | undefined,
    lockedRootId: string | null | undefined,
    groupCost?: SwarmGroupCostSummary | null,
): SwarmOverviewDisplayData | null {
    if (!topo || topo.groupsByRootId.size === 0) { return null; }
    let selectedGroup = null;
    const probeIds = [inspectedMemberId, activeCascadeId, lockedRootId].filter((v): v is string => Boolean(v));
    for (const id of probeIds) {
        const node = topo.nodesById.get(id);
        if (node && topo.groupsByRootId.has(node.rootId)) {
            selectedGroup = topo.groupsByRootId.get(node.rootId)!;
            break;
        }
        if (topo.groupsByRootId.has(id)) {
            selectedGroup = topo.groupsByRootId.get(id)!;
            break;
        }
    }
    if (!selectedGroup) { return null; }
    const cost = groupCost?.rootId === selectedGroup.rootId ? groupCost : null;
    const ids = Array.from(new Set([...selectedGroup.coordinatorIds, ...selectedGroup.memberIds]));
    const members: SwarmMemberLiveRow[] = [];
    for (const id of ids) {
        const n = topo.nodesById.get(id);
        if (!n) { continue; }
        const ledger = cost?.directCostByMember[n.cascadeId];
        members.push({
            cascadeId: n.cascadeId,
            memberName: n.memberName || n.cascadeId.slice(0, 8),
            role: n.assignedRole,
            isCoordinator: Boolean(n.isCoordinator || n.cascadeId === selectedGroup.rootId),
            relationshipKind: n.relationshipKind,
            phase: n.phase,
            killed: n.killed,
            assignedModel: n.assignedModel ?? null,
            measuredModel: n.measuredModel ?? null,
            contextPct: n.contextPct ?? null,
            directCostUsd: ledger && ledger.pricedCallCount > 0 ? ledger.directCostUsd : null,
            recordedCalls: ledger?.callCount,
            unpricedCalls: ledger?.unpricedCallCount,
            lastObservedAt: n.lastObservedAt ?? null,
            isInspected: inspectedMemberId === n.cascadeId,
            isLockedRoot: lockedRootId === n.cascadeId,
        });
    }
    if (members.length === 0) { return null; }
    return {
        rootId: selectedGroup.rootId,
        title: selectedGroup.title,
        members,
        totalMemberCount: members.length,
        observedMemberCount: members.filter(m => m.lastObservedAt != null).length,
        groupTotalCostUsd: cost && cost.pricedCallCount > 0 ? cost.inclusiveGroupCostUsd : null,
        membersWithCalls: cost ? Object.values(cost.directCostByMember).filter(member => member.callCount > 0).length : undefined,
        groupUnpricedCalls: cost?.unpricedCallCount,
        lastSweepAtMs: topo.lastSweepAtMs,
    };
}

export function renderSwarmMemberItemHtml(
    m: SwarmMemberLiveRow & { depth?: number; anomalyTags?: readonly string[] },
    options?: {
        displayCurrency?: CurrencyInput;
        inspectedMemberId?: string | null;
        lockedRootId?: string | null;
        treeMode?: boolean;
        activeCascadeId?: string;
        readableMemberIds?: ReadonlySet<string>;
        groupId?: string;
    },
): string {
    const lang = getLanguage();
    const isInsp = options?.inspectedMemberId === m.cascadeId || Boolean(m.isInspected);
    const isLocked = options?.lockedRootId === m.cascadeId || Boolean(m.isLockedRoot);
    const pctNum = typeof m.contextPct === 'number' && Number.isFinite(m.contextPct) ? m.contextPct : null;
    const pctStr = pctNum !== null ? `${Math.round(pctNum)}%` : '—';
    const pctTone = pctNum !== null ? (pctNum >= 80 ? ' is-danger' : pctNum >= 65 ? ' is-warn' : ' is-good') : '';
    const displayModel = (raw: string) => localizePickerEffortLabel(resolveModelId(raw) ?? raw, getModelDisplayName(raw), lang);
    const modelHtml = [
        m.assignedModel ? `<span class="swarm-model-assigned">${tHtml('swarm.assignedModel')}: ${esc(displayModel(m.assignedModel))}</span>` : '',
        m.measuredModel ? `<span class="swarm-model-measured">${tHtml('swarm.measuredModel')}: ${esc(displayModel(m.measuredModel))}</span>` : '',
    ].filter(Boolean).join(' ');
    const directCostHtml = typeof m.directCostUsd === 'number' && Number.isFinite(m.directCostUsd)
        ? `<span class="swarm-member-cost" data-member-direct-cost="true">${tHtml('swarm.directCost')}: ${esc(formatCurrencyAmount(m.directCostUsd, options?.displayCurrency))}</span>`
        : m.recordedCalls === 0 ? `<span class="swarm-member-cost">${tHtml('swarm.noCalls')}</span>`
        : m.unpricedCalls ? `<span class="swarm-member-cost">${tHtml('swarm.noPrice')}</span>` : '';
    const obsHtml = typeof m.lastObservedAt === 'number' && Number.isFinite(m.lastObservedAt)
        ? `<span class="swarm-member-obs" data-last-observed-at="${m.lastObservedAt}">${tHtml('swarm.lastObserved')}: ${esc(formatClockTime(new Date(m.lastObservedAt), lang))}</span>`
        : '';
    const roleLabel = m.relationshipKind === 'nested_helper' ? tBi('Nested', '嵌套助手')
        : m.relationshipKind === 'direct_subagent' ? tBi('Subagent', '子智能体')
            : m.relationshipKind === 'fork' ? tBi('Fork', '分支')
                : (!m.role || m.role.toLowerCase() === 'worker' ? tBi('Worker', '成员') : m.role);
    const roleHtml = m.isCoordinator
        ? `<span class="swarm-role-badge is-root">${tHtml('swarm.rootLabel')}</span>`
        : `<span class="swarm-role-badge">${esc(roleLabel)}</span>`;
    const anomalyHtml = (m.anomalyTags || []).map(tag => `<span class="swarm-phase-badge is-warn">${esc(tag)}</span>`).join('');
    const isCurrent = m.cascadeId === options?.activeCascadeId;
    const readable = options?.readableMemberIds?.has(m.cascadeId) === true;
    const memberKey = [options?.treeMode ? 'sessions' : 'overview', options?.groupId, m.cascadeId].filter(Boolean).join('-');
    const action = isInsp
        ? `<button type="button" class="action-btn swarm-inspect-btn" data-action="clearInspect">${tHtml('swarm.backToMain')}</button>`
        : isCurrent
            ? (options?.treeMode ? `<button type="button" class="action-btn swarm-inspect-btn" data-action="showCurrentMemberOverview">${tHtml('swarm.openOverview')}</button>` : '')
            : `<button type="button" class="action-btn swarm-inspect-btn" data-action="inspectMember" data-cascade-id="${esc(m.cascadeId)}" aria-label="${esc(`${t('swarm.openOverview')}: ${m.memberName}`)}">${tHtml('swarm.openOverview')}</button>`;
    const phaseLabels: Record<string, [string, string]> = {
        RUNNING: ['Running', '运行中'], WORKING: ['Working', '工作中'], WAITING: ['Waiting', '等待中'],
        IDLE: ['Idle', '空闲'], KILLED: ['Terminated', '已终止'], COMPLETED: ['Completed', '已完成'],
        FAILED: ['Failed', '失败'], CANCELLED: ['Cancelled', '已取消'], STOPPED: ['Stopped', '已停止'],
    };
    const phase = m.killed ? 'KILLED' : m.phase ?? '';
    const phaseLabel = Object.prototype.hasOwnProperty.call(phaseLabels, phase) ? tBiHtml(...phaseLabels[phase]) : esc(phase);
    const detailId = `swarm-detail-${esc(memberKey)}`;
    const itemCls = options?.treeMode ? 'swarm-tree-node' : 'swarm-member-row';
    const dataAttr = options?.treeMode
        ? `data-swarm-node="${esc(m.cascadeId)}" data-swarm-depth="${m.depth ?? 0}" style="--swarm-depth:${m.depth ?? 0}"`
        : `data-swarm-member="${esc(m.cascadeId)}"`;
    return `<li class="${itemCls}${isInsp ? ' is-inspected' : ''}${m.killed ? ' is-killed' : ''}" ${dataAttr}>
        <details class="swarm-member-details" id="${detailId}">
            <summary id="${detailId}-toggle"><span class="swarm-member-name">${esc(m.memberName)}</span>
                <span class="swarm-member-tags">${roleHtml}${isLocked ? `<span class="swarm-phase-badge is-root-lock">${tBiHtml('Locked', '已锁定')}</span>` : ''}${phaseLabel ? `<span class="swarm-phase-badge${m.killed ? ' is-killed' : ''}">${phaseLabel}</span>` : ''}${anomalyHtml}${isCurrent ? `<span class="swarm-role-badge">${tBiHtml('Current', '当前查看')}</span>` : ''}</span>
                <span class="swarm-summary-label">${tHtml('swarm.inspect')}</span></summary>
            <div class="swarm-member-meta">
                ${pctNum !== null ? `<span class="swarm-member-pct${pctTone}">${tBiHtml('Context', '上下文')} ${esc(pctStr)}</span>` : ''}
                ${modelHtml}${directCostHtml}${obsHtml}
            </div>
            ${!readable && !isCurrent ? `<p class="swarm-member-note">${tHtml('swarm.noTrajectory')}</p>` : ''}
            ${action ? `<div class="swarm-member-actions">${action}<button type="button" data-action="cancelMemberNavigation" class="action-btn swarm-inspect-btn" hidden>${tBiHtml('Cancel', '取消')}</button><span role="status" class="swarm-inspect-feedback"></span></div>` : ''}
        </details></li>`;

}

export function renderSwarmRecordedCost(swarm: SwarmOverviewDisplayData, currency?: CurrencyInput): string {
    const parts: string[] = [];
    if (typeof swarm.groupTotalCostUsd === 'number' && Number.isFinite(swarm.groupTotalCostUsd)) {
        parts.push(`<span>${tHtml('swarm.groupCost')}: <strong>${esc(formatCurrencyAmount(swarm.groupTotalCostUsd, currency))}</strong></span>`);
    }
    if (swarm.membersWithCalls !== undefined) {
        parts.push(`<span>${tHtml('swarm.costCoverage')} ${swarm.membersWithCalls}/${swarm.totalMemberCount ?? swarm.members.length}</span>`);
    }
    if (swarm.groupUnpricedCalls) {
        parts.push(`<span class="swarm-unpriced-tag">${tHtml('swarm.unpricedCalls')}: ${swarm.groupUnpricedCalls}</span>`);
    }
    return parts.join(' · ');
}

export function buildSwarmLiveStripHtml(
    swarm: SwarmOverviewDisplayData | null | undefined,
    options?: {
        displayCurrency?: CurrencyInput;
        inspectedMemberId?: string | null;
        lockedRootId?: string | null;
        readableMemberIds?: ReadonlySet<string>;
        activeCascadeId?: string;
    },
): string {
    if (!swarm || !Array.isArray(swarm.members) || swarm.members.length === 0) { return ''; }
    const totalMembers = swarm.totalMemberCount ?? swarm.members.length;
    const observedMembers = swarm.observedMemberCount ?? swarm.members.filter(m => m.lastObservedAt != null).length;
    const isPartial = Boolean(swarm.partialCoverage || observedMembers < totalMembers);
    const partialBadgeHtml = isPartial
        ? `<span class="swarm-partial-badge" data-swarm-partial-coverage="true">${tHtml('swarm.partialCoverage')}${observedMembers > 0 ? ` (${observedMembers}/${totalMembers})` : ''}</span>`
        : '';
    const costSummary = renderSwarmRecordedCost(swarm, options?.displayCurrency);
    const groupCostHtml = costSummary ? `<div class="swarm-cost-summary" data-swarm-group-cost="true">${costSummary}</div>` : '';
    const sortedMembers = [...swarm.members].sort((a, b) =>
        (Number(Boolean(b.isCoordinator)) - Number(Boolean(a.isCoordinator)))
        || (Number(Boolean(a.killed)) - Number(Boolean(b.killed)))
        || a.memberName.localeCompare(b.memberName),
    );
    const renderRows = (members: SwarmMemberLiveRow[]) => `<ul class="swarm-member-list">${members.map(m => renderSwarmMemberItemHtml(m, options)).join('')}</ul>`;
    const visible = sortedMembers.filter(m => !m.killed || m.isInspected || m.isCoordinator || m.cascadeId === options?.activeCascadeId);
    const archived = sortedMembers.filter(m => !visible.includes(m));
    const rowsHtml = renderRows(visible) + (archived.length ? `<details class="swarm-ended" id="overview-ended-${esc(swarm.rootId)}"><summary>${tBiHtml('Terminated members', '已终止成员')} (${archived.length})</summary>${renderRows(archived)}</details>` : '');
    return `<section class="overview-swarm-strip" id="overviewSwarmStrip" data-swarm-live-strip="true" aria-labelledby="overview-swarm-heading"><div class="overview-swarm-head"><h4 id="overview-swarm-heading">${tHtml('swarm.liveTracking')} <span class="swarm-count-pill">${totalMembers}</span></h4>${partialBadgeHtml}</div>${groupCostHtml}${rowsHtml}</section>`;
}

function ovSegSwitch(
    settingKey: string,
    activeValue: string,
    ariaLabel: string,
    items: ReadonlyArray<{ val: string; labelHtml: string; tip?: string }>,
    extraCls = '',
): string {
    const btns = items.map(it => {
        const active = activeValue === it.val;
        return `<button type="button" class="ov-seg-btn${active ? ' is-active' : ''}" data-action="setOverviewSetting" data-setting-key="${settingKey}" data-setting-value="${it.val}" aria-pressed="${active}"${it.tip || ''}>${it.labelHtml}</button>`;
    }).join('');
    return `<span class="ov-seg-switch${extraCls ? ` ${extraCls}` : ''}" role="group" data-setting-switch="${settingKey}" aria-label="${esc(ariaLabel)}">${btns}</span>`;
}

function buildCacheTtlBadgeHtml(cacheTtl: PromptCacheTtlEvaluation | null | undefined): string {
    if (!cacheTtl) { return ''; }
    let cls = 'is-unknown';
    let labelHtml = tHtml('cache.ttl5mHeuristic');
    if (cacheTtl.shouldResetHeuristic || cacheTtl.clockAnomaly !== 'none') {
        cls = 'is-unknown';
        labelHtml = tHtml('cache.cause.clockJump');
    } else if (cacheTtl.ttlEstimateState === 'warm') {
        cls = 'is-warm';
        labelHtml = tHtml('cache.ttlWarm');
    } else if (cacheTtl.ttlEstimateState === 'cooling') {
        cls = 'is-cooling';
        labelHtml = tHtml('cache.ttlExpiring');
    } else if (cacheTtl.ttlEstimateState === 'cold') {
        cls = 'is-cold';
        labelHtml = tHtml('cache.ttlColdPredicted');
    }
    const remSec = typeof cacheTtl.remainingTtlSeconds === 'number' && Number.isFinite(cacheTtl.remainingTtlSeconds)
        ? Math.max(0, Math.round(cacheTtl.remainingTtlSeconds))
        : null;
    const countdownText = remSec !== null && !cacheTtl.shouldResetHeuristic && cacheTtl.ttlEstimateState !== 'cold'
        ? ` · ${Math.floor(remSec / 60)}:${String(remSec % 60).padStart(2, '0')}`
        : '';
    const tipAttrs = richTipAttrs({
        key: 'overview:cache-ttl-5m',
        title: t('cache.ttl5mHeuristic'),
        body: cacheTtl.hasMeasuredCacheTelemetry && cacheTtl.measuredReusePct !== null
            ? `${t('cache.measuredReuse')}: ${cacheTtl.measuredReusePct.toFixed(1)}%`
            : t('cache.unreported'),
        meta: t('cache.ttl5mHeuristic'),
        focusable: true,
    });
    return `<span class="cache-ttl-badge ${cls}" data-cache-ttl-state="${esc(cacheTtl.ttlEstimateState)}" data-cache-ttl-source="local_ttl_heuristic"${remSec !== null ? ` data-ttl-remaining-sec="${remSec}"` : ''}${tipAttrs}>${labelHtml}${esc(countdownText)}</span>`;
}

function buildHandoffV2SectionHtml(
    preview: HandoffV2PreviewData | null | undefined,
    activeCascadeId: string | undefined,
    dataRevision: number,
    showBudgetWarning: boolean,
): string {
    const subjectId = preview?.subjectCascadeId || activeCascadeId || '';
    const rev = preview?.dataRevision ?? dataRevision;
    const isVisible = Boolean(preview && preview.markdown);
    const warningHtml = showBudgetWarning
        ? `<div class="ctx-budget-warning-bar" data-context-budget-warning="true" role="status">
            <span>${tHtml('context.compactionWarning')}</span>
            <button type="button" class="ctx-action-btn is-handoff-v2" id="previewHandoffV2Btn" data-action="previewHandoffV2" data-cascade-id="${esc(subjectId)}" data-data-revision="${rev}">${ICON.file} <span>${tHtml('handoff.previewTitle')}</span></button>
        </div>`
        : `<div class="ctx-handoff-v2-trigger-row">
            <button type="button" class="ctx-action-btn is-handoff-v2" id="previewHandoffV2Btn" data-action="previewHandoffV2" data-cascade-id="${esc(subjectId)}" data-data-revision="${rev}">${ICON.file} <span>${tHtml('handoff.previewTitle')}</span></button>
        </div>`;

    const boxHtml = `<section class="handoff-preview-box" id="handoffV2PreviewBox" data-handoff-preview="true" data-subject-cascade-id="${esc(subjectId)}" data-data-revision="${rev}"${isVisible ? '' : ' hidden'} aria-labelledby="handoff-v2-heading">
        <div class="handoff-preview-head">
            <strong id="handoff-v2-heading">${tHtml('handoff.previewTitle')}</strong>
            <div class="handoff-preview-actions">
                <button type="button" class="action-btn" data-action="copyHandoffPreviewText">${ICON.copy} <span>${tHtml('action.copyHandoffPrompt')}</span></button>
                <button type="button" class="action-btn" data-action="closeHandoffPreview" aria-label="${esc(tBi('Close preview', '关闭预览'))}">×</button>
            </div>
        </div>
        <p class="handoff-preview-notice">${tHtml('handoff.readOnlyNotice')}</p>
        <textarea id="handoffV2PreviewText" class="handoff-preview-text" readonly rows="6" aria-label="${esc(t('handoff.previewTitle'))}">${esc(preview?.markdown || '')}</textarea>
    </section>`;

    return `${warningHtml}${boxHtml}`;
}

function buildCompactionRecoveryBriefHtml(brief: CompactionRecoveryBriefData | null | undefined): string {
    if (!brief || brief.dismissed || !brief.summaryText) { return ''; }
    const deltaText = typeof brief.beforeTokens === 'number' && typeof brief.afterTokens === 'number'
        ? `${formatCompactTokens(brief.beforeTokens)} → ${formatCompactTokens(brief.afterTokens)}${brief.savedTokens ? ` (−${formatCompactTokens(brief.savedTokens)})` : ''}`
        : '';
    return `<section class="recovery-brief-card" id="compactionRecoveryBrief" data-recovery-brief="true" data-event-key="${esc(brief.eventKey)}" data-read-only="true" aria-labelledby="recovery-brief-heading">
        <div class="recovery-brief-head">
            <div>
                <h3 id="recovery-brief-heading">${tHtml('compaction.recoveryTitle')}</h3>
                <p class="overview-meta">${tHtml('compaction.recoverySubtitle')}${deltaText ? ` · ${esc(deltaText)}` : ''}</p>
            </div>
            <div class="recovery-brief-actions">
                <button type="button" class="action-btn" data-action="copyRecoveryBrief">${ICON.copy} <span>${tBiHtml('Copy', '复制')}</span></button>
                <button type="button" class="action-btn" data-action="dismissRecoveryBrief" data-event-key="${esc(brief.eventKey)}">${tHtml('compaction.dismissBrief')}</button>
            </div>
        </div>
        <pre class="recovery-brief-body">${esc(brief.summaryText)}</pre>
    </section>`;
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
    direction: QuotaDirectionMode,
): string {
    const labelHtml = kind === '5h' ? tBiHtml('5-Hour', '5 小时') : tBiHtml('Weekly', '每周');
    const labelPlain = kind === '5h' ? tBi('5-Hour', '5 小时') : tBi('Weekly', '每周');
    const rawFrac = win.remainingFraction;
    const validFrac = typeof rawFrac === 'number' && Number.isFinite(rawFrac) && rawFrac >= 0 && rawFrac <= 1 ? rawFrac : null;
    const unknown = validFrac === null;
    const displayFrac = validFrac === null ? null : direction === 'used' ? 1 - validFrac : validFrac;
    const pctText = displayFrac === null ? tBi('Unknown', '未知') : formatQuotaWindowPercent(displayFrac);
    const pctHtml = unknown ? `<span class="overview-quota-unknown">${tBiHtml('Unknown', '未知')}</span>` : `<strong>${esc(pctText)}</strong>`;
    const meterHtml = displayFrac === null || validFrac === null
        ? '<div class="overview-meter is-unknown" aria-hidden="true"></div>'
        : meter(`${groupLabel} · ${labelPlain}`, displayFrac * 100, pctText, quotaMeterTone(validFrac * 100));
    const winTipAttrs = richTipAttrs({
        key: `overview:quota-win:${poolKey}:${kind}`,
        title: `${groupLabel} · ${labelPlain}`,
        body: `${labelPlain} · ${direction === 'used' ? tBi('Used', '已用') : tBi('Remaining', '剩余')} ${pctText}`,
        meta: win.resetTime ? `${tBi('Reset', '重置')}: ${formatResetAbsolute(win.resetTime)}` : undefined,
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
            return { cls: 'is-cold', html: tHtml('telemetry.cacheState.cold') };
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
        ? tBi('Strict official rate mode.', '严格官方定价模式。')
        : tBi('Base-model estimation mode.', '按底座估算模式。');
    if (sessionCost) {
        const subHtml = todayCost ? `<span class="overview-telemetry-sub">${tBiHtml('Today', '今日')} ${esc(todayCost.display)}</span>` : '';
        const detailParts = [
            sessionCost.title || `${tBi('Session', '会话')}: ${sessionCost.display}`,
            todayCost ? `${tBi('Today', '今日')}: ${todayCost.title || todayCost.display}` : '',
        ].filter(Boolean);
        const cellTipAttrs = richTipAttrs({
            key: 'overview:telemetry:cost',
            title: tBi('Session API Reference Cost', '会话 API 参考费用'),
            body: detailParts.join(' · '),
            meta: modeRule,
            focusable: true,
        });
        return `<div class="overview-telemetry-cell" data-telemetry-cell="cost"${cellTipAttrs}><span class="overview-telemetry-label">${tBiHtml('Session Cost', '会话费用')}${costHelpTip}</span><strong class="overview-telemetry-value">${esc(sessionCost.display)}</strong>${subHtml}</div>`;
    }
    const cellTipAttrs = richTipAttrs({
        key: 'overview:telemetry:cost',
        title: tBi('Today API Reference Cost', '今日 API 参考费用'),
        body: todayCost!.title || todayCost!.display,
        meta: modeRule,
        focusable: true,
    });
    return `<div class="overview-telemetry-cell" data-telemetry-cell="cost"${cellTipAttrs}><span class="overview-telemetry-label">${tBiHtml('Today Cost', '今日费用')}${costHelpTip}</span><strong class="overview-telemetry-value">${esc(todayCost!.display)}</strong></div>`;
}

function telemetryStrip(
    snapshot: OverviewTelemetrySnapshot,
    sessionCostUsd?: number,
    todayCostUsd?: number,
    options?: {
        speedSample?: SpeedSampleEvaluation | null;
        observation?: SurfaceObservationProjection | null;
        displayCurrency?: CurrencyInput;
        orchestratorPricingMode?: OrchestratorPricingMode;
        speedMetricMode?: SpeedMetricMode;
        cacheTtl?: PromptCacheTtlEvaluation | null;
    },
): string {
    const { primary, primaryScope, ttftPrimary } = snapshot;
    const speedMode: SpeedMetricMode = options?.speedMetricMode === 'e2e' ? 'e2e' : 'decode';

    const speedPrimary = options?.observation ? options.observation.displaySpeedTps
        : speedMode === 'e2e' ? primary.latestEndToEndTokPerSec ?? primary.weightedEndToEndTokPerSec : snapshot.speedPrimary;
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
    if (!options?.observation && speedSample?.isWaitingTtft) {
        const waitSuffix = typeof speedSample.waitingSeconds === 'number' && Number.isFinite(speedSample.waitingSeconds) && speedSample.waitingSeconds > 0
            ? ` (${speedSample.waitingSeconds.toFixed(1)}s)`
            : '';
        speedHtml = `${tBiHtml('Waiting TTFT', '等待首字')}${esc(waitSuffix)}`;
        speedClass = ' is-muted is-short-sample';
        speedStateAttr = ' data-speed-state="waiting-ttft"';
    } else if (!options?.observation && speedSample?.isShortSample) {
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
    const speedTipAttrs = richTipAttrs({
        key: 'overview:telemetry:speed',
        title: speedMode === 'e2e' ? t('speed.e2eModelCall') : tBi('Generation Speed', '生成速度'),
        body: speedMode === 'e2e' ? t('speed.e2eScopeHint') : speedTipParts.join(' · ') || tBi('Streaming output throughput.', '流式输出吞吐速度。'),
        meta: speedMode === 'e2e' ? 'outputTokens / (TTFT + streamingSeconds)' : 'outputTokens / streamingSeconds',
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
    const ttftTipParts = [
        primary.avgTtftSeconds !== null ? `${tBi('Avg', '均值')}: ${formatLatency(primary.avgTtftSeconds)}` : '',
        primary.medianTtftSeconds !== null ? `p50: ${formatLatency(primary.medianTtftSeconds)}` : '',
        primary.cachedAvgTtftSeconds !== null ? `${tBi('Cached', '热缓存')}: ${formatLatency(primary.cachedAvgTtftSeconds)}` : '',
        primary.uncachedAvgTtftSeconds !== null ? `${tBi('Cache Miss', '缓存未命中')}: ${formatLatency(primary.uncachedAvgTtftSeconds)}` : '',
    ].filter(Boolean);
    const ttftTipAttrs = richTipAttrs({
        key: 'overview:telemetry:ttft',
        title: t('speed.ttft'),
        body: ttftTipParts.join(' · ') || tBi('Wait time before first token.', '等待首字输出耗时。'),
        focusable: true,
    });

    // 3. Cache Hit
    const cacheHitValue = formatCachePercent(primary.tokenCacheHitRate);
    const cacheHitClass = primary.tokenCacheHitRate !== null && primary.tokenCacheHitRate > 0 ? ' is-cache' : ' is-muted';
    const cacheHitSubHtml = primary.totalCacheReadTokens > 0
        ? esc(`${formatCompactTokens(primary.totalCacheReadTokens)} · ${primary.cachedCallCount}/${primary.totalCalls}`)
        : (primary.totalCalls > 0 ? esc(`${primary.cachedCallCount}/${primary.totalCalls}`) : '');
    const cacheHitDetail = primary.totalPromptTokens > 0
        ? `${formatCompactTokens(primary.totalCacheReadTokens)} / ${formatCompactTokens(primary.totalPromptTokens)} tokens · ${primary.cachedCallCount}/${primary.totalCalls}`
        : tBi('Prompt tokens served from server-side cache.', '服务端提示词缓存复用占比。');
    const cacheHitTipAttrs = richTipAttrs({
        key: 'overview:telemetry:cache-hit',
        title: tBi('Prompt Cache Hit Rate', '缓存命中率'),
        body: cacheHitDetail,
        focusable: true,
    });

    // 4. Cache Saved
    const savingsFormatted = formatOverviewSavings(primary.estCacheSavingsUsd);
    const { preset: currencyPreset } = resolveCurrencyConfig(options?.displayCurrency);
    let savedValueHtml: string;
    let savedClass = '';
    let savedDetail = '';
    if (savingsFormatted !== null && primary.estCacheSavingsUsd !== null) {
        const displaySav = currencyPreset.code === 'USD' ? savingsFormatted : formatCurrencyAmount(primary.estCacheSavingsUsd, options?.displayCurrency);
        savedValueHtml = esc(displaySav);
        const savRef = currencyPreset.code === 'USD' ? savingsFormatted : formatDualCurrencyAmount(primary.estCacheSavingsUsd, options?.displayCurrency);
        savedDetail = primary.estCacheSavedTokens > 0 ? `${savRef} · ${formatCompactTokens(primary.estCacheSavedTokens)} tokens` : savRef;
    } else if (primary.estCacheSavedTokens > 0) {
        savedValueHtml = `${esc(formatCompactTokens(primary.estCacheSavedTokens))} tokens`;
        savedDetail = savedValueHtml;
    } else {
        savedValueHtml = '—';
        savedClass = ' is-muted';
    }
    const warmth = cacheWarmthMeta(primary.latestCacheState);
    const savedTipAttrs = richTipAttrs({
        key: 'overview:telemetry:cache-saved',
        title: tBi('Prompt Cache Savings', '缓存节省'),
        body: savedDetail || tBi('Estimated cost or tokens saved via prompt cache.', '命中缓存节省的参考费用或 Token。'),
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

    const speedModeSwitchHtml = ovSegSwitch('speedMetricMode', speedMode, t('speed.decode'), [
        { val: 'decode', labelHtml: tBiHtml('Decode', '解码') },
        { val: 'e2e', labelHtml: 'E2E', tip: richTipAttrs({ key: 'overview:speed:e2e-hint', title: t('speed.e2eModelCall'), body: t('speed.e2eScopeHint') }) },
    ], 'is-inline');
    const cacheTtlHtml = buildCacheTtlBadgeHtml(options?.cacheTtl);

    return `<div class="overview-telemetry-strip${costCellHtml ? ' has-cost' : ''}" data-telemetry-scope="${primaryScope}" data-speed-mode="${speedMode}" role="group" aria-label="${esc(ariaLabel)}">
        <div class="overview-telemetry-cell" data-telemetry-cell="speed"${speedTipAttrs}${speedStateAttr}>
            <span class="overview-telemetry-label">${speedMode === 'e2e' ? tHtml('speed.e2eModelCall') : tBiHtml('Speed', '生成速度')} ${speedModeSwitchHtml}</span>
            <strong class="overview-telemetry-value${speedClass}">${speedHtml}</strong>
            ${speedSubHtml ? `<span class="overview-telemetry-sub">${speedSubHtml}</span>` : ''}
        </div>
        <div class="overview-telemetry-cell" data-telemetry-cell="ttft"${ttftTipAttrs}>
            <span class="overview-telemetry-label">${tHtml('speed.ttft')}${jargonTipHtml('ttft')}</span>
            <strong class="overview-telemetry-value${ttftClass}">${esc(ttftValue)}</strong>
            ${ttftSubHtml ? `<span class="overview-telemetry-sub">${ttftSubHtml}</span>` : ''}
        </div>
        <div class="overview-telemetry-cell" data-telemetry-cell="cache-hit"${cacheHitTipAttrs}>
            <span class="overview-telemetry-label">${tBiHtml('Cache Hit', '缓存命中')}</span>
            <strong class="overview-telemetry-value${cacheHitClass}">${esc(cacheHitValue)}</strong>
            ${cacheHitSubHtml ? `<span class="overview-telemetry-sub">${cacheHitSubHtml}</span>` : ''}
            ${cacheTtlHtml}
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

    const measureBadgeTipAttrs = richTipAttrs({
        key: 'overview:ctx-measure-badge',
        title: tBi('Measurement State', '计量状态'),
        body: getMeasurementNote(cb.measurementState, getLanguage()),
        focusable: true,
    });

    // ── Dual-Cap Clarity strip ──
    const effCapTipAttrs = richTipAttrs({
        key: 'overview:ctx-cap:effective',
        title: tBi('Effective Budget (Compaction Limit)', '自动压缩上限（有效预算）'),
        body: `${formatCompactTokens(cb.usedTokens)} / ${formatCompactTokens(cb.effectiveBudgetTokens)} (${cb.effectivePct.toFixed(1)}%)`,
        focusable: true,
    });
    const natCapTipAttrs = richTipAttrs({
        key: 'overview:ctx-cap:native',
        title: tBi('Native Ceiling', '原生窗口上限'),
        body: `${formatCompactTokens(cb.usedTokens)} / ${formatCompactTokens(cb.nativeLimitTokens)} (${cb.nativePct.toFixed(1)}%)`,
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
            body: `−${formatNumber(latestCompaction.savedTokens)} tokens (${formatCompactTokens(latestCompaction.beforeTokens)} → ${formatCompactTokens(latestCompaction.afterTokens)})`,
            meta: `#${latestCompaction.stepIndex}`,
            focusable: true,
        })}><span class="ctx-compaction-label">${tBiHtml('Compaction checkpoint saved', '压缩检查点节省')}</span><strong>−${esc(formatCompactTokens(latestCompaction.savedTokens))} tokens</strong><span class="ctx-compaction-range">(${esc(formatCompactTokens(latestCompaction.beforeTokens))} → ${esc(formatCompactTokens(latestCompaction.afterTokens))})</span></div>`
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
        body: tBi('Copy plain-text context breakdown and quota summary.', '复制纯文本上下文占比与配额摘要。'),
    });
    const copyHandoffTipAttrs = richTipAttrs({
        key: 'overview:action:copy-handoff',
        title: tBi('Copy Handoff Prompt', '复制交接提示词'),
        body: tBi('Generate a ready-to-paste HANDOFF.md continuation prompt.', '生成可直接粘贴到新会话的 HANDOFF.md 交接提示词。'),
    });
    const quickActionsHtml = `<div class="ctx-quick-actions">
        <button type="button" class="ctx-action-btn" id="copyContextReportBtn" data-action="copyContextReport"${copyCtxTipAttrs}>${ICON.copy} <span>${tBiHtml('Copy /context Report', '复制 /context 报告')}</span></button>
        <button type="button" class="ctx-action-btn" id="copyHandoffPromptBtn" data-action="copyHandoffPrompt"${copyHandoffTipAttrs}>${ICON.file} <span>${tBiHtml('Copy Handoff Prompt', '复制交接提示词')}</span></button>
        <span id="ctxCopyFeedback" class="threshold-feedback" role="status"></span>
    </div>`;

    return `<details id="overview-context-composition" class="ctx-breakdown-card overview-details" data-ctx-breakdown="true" data-viz-mode="bar" aria-labelledby="ctx-breakdown-heading">
        <summary><span id="ctx-breakdown-heading">${tBiHtml('Context Composition', '上下文构成')}</span></summary>
        <div class="ctx-breakdown-head">
            <span class="ctx-measure-badge ${badge.cls}" data-measurement-state="${cb.measurementState}"${measureBadgeTipAttrs}>${badge.html}</span>
            ${isAwaiting ? '' : `<div class="ctx-viz-toggle" role="group" aria-label="${esc(tBi('Visualization mode', '视图模式'))}">
                <button type="button" class="ctx-viz-btn is-active" data-ctx-viz="bar" aria-pressed="true">${tBiHtml('Bar View', '条形视图')}</button>
                <button type="button" class="ctx-viz-btn" data-ctx-viz="dots" aria-pressed="false">${tBiHtml('Dot Matrix', '点阵视图')}</button>
            </div>`}
        </div>
        ${dualCapHtml}
        ${compactionChipHtml}
        ${vizHtml}
        ${largestItemsHtml}
        ${quickActionsHtml}
    </details>`;
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
            ? tBi(`Context (${formatCompactTokens(watermarks.contextUsed)}) crossed 200k. ${TIER_200K_NOTICE_EN}`, `当前上下文（${formatCompactTokens(watermarks.contextUsed)}）已超过 200k。${TIER_200K_NOTICE_ZH}`)
            : tBi(`${formatCompactTokens(watermarks.tokensUntilLongContextTier ?? 0)} left before 200k. ${TIER_200K_NOTICE_EN}`, `距 200k 阶梯还剩 ${formatCompactTokens(watermarks.tokensUntilLongContextTier ?? 0)}。${TIER_200K_NOTICE_ZH}`);
        const tierTitle = tBi('200k Long-Context Tier', '200k 长上下文阶梯');
        const tickAttrs = richTipAttrs({ key: 'overview:watermark:200k-tick', title: tierTitle, body: tierBody });
        const pillAttrs = richTipAttrs({ key: 'overview:watermark:200k-pill', title: tierTitle, body: tierBody, focusable: true });
        markers.push(`<span class="overview-watermark-tick is-tier-200k${exceeded ? ' is-exceeded' : ''}" data-watermark="long-context-200k" style="left:${leftPct.toFixed(1)}%"${tickAttrs} aria-hidden="true"></span>`);
        pills.push(`<span class="overview-watermark-pill${exceeded ? ' is-tier-exceeded' : ''}" data-watermark-pill="long-context-200k"${pillAttrs}>${
            exceeded
                ? tBiHtml('> 200k Tier', '已超 200k 阶梯')
                : `${tBiHtml('200k Tier', '200k 阶梯')} · ${esc(formatCompactTokens(watermarks.tokensUntilLongContextTier ?? 0))} ${tBiHtml('left', '剩余')}`
        }</span>`);
    }

    if (watermarks.hasDistinctPhysicalWindow) {
        const compBody = tBi(
            `Compaction ${formatCompactTokens(watermarks.compactionLimit)} (${watermarks.compactionMarkerPct.toFixed(0)}% of ${formatCompactTokens(watermarks.physicalContextWindow)} native window).`,
            `自动压缩上限 ${formatCompactTokens(watermarks.compactionLimit)}（占 ${formatCompactTokens(watermarks.physicalContextWindow)} 原生窗口上限的 ${watermarks.compactionMarkerPct.toFixed(0)}%）。`,
        );
        const compTitle = tBi('Auto-Compaction Ceiling', '自动压缩上限');
        const compTickAttrs = richTipAttrs({ key: 'overview:watermark:compaction-tick', title: compTitle, body: compBody });
        const compPillAttrs = richTipAttrs({ key: 'overview:watermark:compaction-pill', title: compTitle, body: compBody, focusable: true });
        markers.push(`<span class="overview-watermark-tick is-compaction-cap" data-watermark="compaction-limit" style="left:100%"${compTickAttrs} aria-hidden="true"></span>`);
        pills.push(`<span class="overview-watermark-pill" data-watermark-pill="compaction-limit"${compPillAttrs}>${tBiHtml('Compaction', '自动压缩上限')} ${esc(formatCompactTokens(watermarks.compactionLimit))} / ${tBiHtml('Native', '原生上限')} ${esc(formatCompactTokens(watermarks.physicalContextWindow))}</span>`);
    }

    if (markers.length === 0 && pills.length === 0) {
        return baseMeter;
    }

    return `<div class="overview-meter-wrap" data-dual-watermark="true">${baseMeter}${markers.length > 0 ? `<div class="overview-meter-markers">${markers.join('')}</div>` : ''}</div>${pills.length > 0 ? `<div class="overview-watermark-meta">${pills.join('')}</div>` : ''}`;
}

function buildTurnCacheSummaryHtml(turnCacheInfo: UserTurnCacheSummary | null | undefined): string {
    const latest = turnCacheInfo?.latestTurn;
    if (!latest || latest.cacheStart === 'unknown') { return ''; }

    const startMeta = latest.cacheStart === 'warm'
        ? { cls: 'is-warm', html: tBiHtml('Warm Start', '热缓存启动'), en: 'reused ≥70% cached history.', zh: '复用了 ≥70% 已缓存历史。' }
        : latest.cacheStart === 'partial'
            ? { cls: 'is-partial', html: tBiHtml('Partial Start', '部分命中'), en: 'reused 10%–70% cached history.', zh: '命中 10%–70% 缓存历史。' }
            : { cls: 'is-cold', html: tBiHtml('Cold Start', '冷启动'), en: '<10% hit (first turn / >5m idle / model switch).', zh: '命中 <10%（首轮 / 闲置超 5 分钟 / 切换模型）。' };
    const pillBody = tBi(`${CACHE_REUSE_PREFIX_EN}${startMeta.en}`, `${CACHE_REUSE_PREFIX_ZH}${startMeta.zh}`);
    const pillTipAttrs = richTipAttrs({
        key: 'overview:turn-cache-start',
        title: tBi('Latest Turn Cache Start', '本轮缓存启动状态'),
        body: latest.cacheHitPct !== null ? `${pillBody}\n${tBi('Cache hit', '缓存命中')}: ${latest.cacheHitPct.toFixed(1)}%` : pillBody,
        meta: tBi('Warm ≥70% · Partial 10%–70% · Cold <10%', '热缓存 ≥70% · 部分命中 10%–70% · 冷启动 <10%'),
        focusable: true,
    });
    const hitPctHtml = latest.cacheHitPct !== null ? ` <span>(${esc(latest.cacheHitPct.toFixed(0))}%)</span>` : '';
    let deltaHtml = '';
    if (latest.netContextDeltaTokens !== null) {
        const sign = latest.netContextDeltaTokens >= 0 ? '+' : '−';
        const formatted = `${sign}${formatCompactTokens(Math.abs(latest.netContextDeltaTokens))}`;
        const deltaTipAttrs = richTipAttrs({
            key: 'overview:turn-net-delta',
            title: tBi('Turn Net Context Growth (Δ)', '本轮上下文净变化 (Δ)'),
            body: tBi(`Net context change: ${formatted} tokens.`, `本轮上下文净变化：${formatted} tokens。`),
            focusable: true,
        });
        deltaHtml = `<span class="overview-turn-delta${latest.isCompactionDrop ? ' is-compaction' : ''}" data-turn-net-delta="${latest.netContextDeltaTokens}"${deltaTipAttrs}>${tBiHtml('Δ Context', '上下文净增长')} ${esc(formatted)}</span>`;
    }
    const switchHtml = latest.hadColdCacheSwitch
        ? `<span class="orch-cold-switch-pill"${richTipAttrs({
            key: 'overview:turn-cold-switch',
            title: tBi('Switch Cold Start', '切换冷启动'),
            body: tBi('Mid-turn model switch invalidated prompt cache (<10% hit).', '本轮切换模型导致缓存失效（命中率 <10%）。'),
            focusable: true,
        })}>${tBiHtml('Switch Cold', '切换冷启动')}</span>`
        : '';
    return `<div class="overview-turn-cache-row" data-turn-cache-state="${latest.cacheStart}" data-turn-index="${latest.turnIndex}"><span class="turn-start-pill ${startMeta.cls}" data-turn-start="${latest.cacheStart}"${pillTipAttrs}>${startMeta.html}${hitPctHtml}</span>${deltaHtml}${switchHtml}</div>`;
}

function resolveActiveConversationCalls(
    telemetry: OverviewExtras | undefined,
    activeCascadeId: string | undefined,
): GMCallEntry[] {
    if (!telemetry || !activeCascadeId) { return []; }
    if (telemetry.gmConversations && telemetry.gmConversations[activeCascadeId]?.calls?.length) {
        return telemetry.gmConversations[activeCascadeId].calls;
    }
    const convs = telemetry.gmSummary?.conversations;
    if (!Array.isArray(convs) || convs.length === 0) { return []; }
    const match = convs.find(c => c.cascadeId === activeCascadeId);
    if (match?.calls?.length) { return match.calls; }
    // Never fall back to another conversation's calls when the active conversation has none.
    return [];
}

function sessionDetails(
    usage: ContextUsage,
    v1176?: {
        watermarks?: ContextDualWatermark | null;
        turnCacheHtml?: string;
        orchestratorSplitHtml?: string;
        observationProjection?: SurfaceObservationProjection | null;
        contextPctBasis?: ContextDisplayBasis;
        cacheTtlHtml?: string;
        handoffV2Html?: string;
        subjectBadgeHtml?: string;
    },
): string {
    const obsProj = v1176?.observationProjection ?? null;
    const legacyReading = getContextReading(usage);
    const reading = obsProj
        ? {
            used: obsProj.usedTokens,
            limit: obsProj.denominatorTokens,
            percent: obsProj.primaryPct,
        }
        : legacyReading;
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
                    `由 ${activeRoute.plannerLabel} 负责规划任务，并交由 ${activeRoute.executorLabel} 执行；「跨配额池」表示两个角色消耗不同共享配额池的配额。`,
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
    const ratio = obsProj
        ? obsProj.primaryPctText
        : (reading.percent === null ? '—' : `${number(reading.percent, 1)}%`);
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
    const compactionNoticeHtml = obsProj?.compactionWarningActive
        ? [tBiHtml(
            `Approaching/exceeding auto-compaction ceiling${obsProj.compactionPct !== null ? ` (${obsProj.compactionPct.toFixed(1).replace(/\.0$/, '')}% of compaction limit)` : ''}`,
            `接近或超过自动压缩上限${obsProj.compactionPct !== null ? `（已达自动压缩上限的 ${obsProj.compactionPct.toFixed(1).replace(/\.0$/, '')}%）` : ''}`,
        )]
        : [];
    const warnings = [
        ...(usage.hasGaps ? [tBiHtml('Data may be incomplete (some step batches failed to load)', '数据可能不完整（部分步骤批次加载失败）')] : []),
        ...(obsProj ? (obsProj.isOverflow ? [tBiHtml('Above the context limit', '已超过上下文上限')] : []) : (reading.percent !== null && reading.percent > 100
            ? [tBiHtml('Above the context limit', '已超过上下文上限')] : [])),
        ...compactionNoticeHtml,
        ...(usage.imageGenerationIncomplete
            ? [tBiHtml('Image workflow data is incomplete', '图片工作流数据不完整')] : []),
    ];
    const diagnostics = [
        metric(tBiHtml('Model Output', '模型输出'), esc(number(usage.totalOutputTokens)), {
            key: 'overview:diag:output',
            title: tBi('Model Output', '模型输出'),
            body: tBi('Cumulative generated tokens.', '本会话累计输出 Token。'),
        }),
        metric(tBiHtml('Tool Results', '工具结果'), esc(number(usage.totalToolCallOutputTokens)), {
            key: 'overview:diag:tools',
            title: tBi('Tool Results', '工具结果'),
            body: tBi('Cumulative tool return tokens.', '工具累计返回 Token。'),
        }),
        metric(tBiHtml('Steps', '步骤数'), esc(number(usage.stepCount)), {
            key: 'overview:diag:steps',
            title: tBi('Steps', '步骤数'),
            body: tBi('Recorded conversation steps.', '会话记录总步骤数。'),
        }),
    ];
    if (usage.compressionDetected) {
        const label = compression?.source === 'checkpoint'
            ? tBiHtml('Checkpoint Input Drop', '检查点输入压缩量')
            : tBiHtml('Context Drop', '上下文压缩量');
        diagnostics.push(metric(label, esc(compression ? `${number(compression.dropTokens)} ${tokenUnit} · ${number(compression.dropPercent, 1)}%` : '—'), {
            key: 'overview:diag:drop',
            title: tBi('Compaction Drop', '压缩释放量'),
            body: tBi('Tokens reclaimed by auto-compaction.', '自动压缩释放的 Token 量。'),
        }));
        if (usableCount(usage.previousContextUsed)) {
            diagnostics.push(metric(tBiHtml('Before', '压缩前'), esc(number(usage.previousContextUsed)), {
                key: 'overview:diag:before',
                title: tBi('Before Compaction', '压缩前'),
                body: tBi('Context size before compaction.', '压缩前上下文占用。'),
            }));
            diagnostics.push(metric(tBiHtml('After', '压缩后'), esc(number(reading.used)), {
                key: 'overview:diag:after',
                title: tBi('After Compaction', '压缩后'),
                body: tBi('Context size after compaction.', '压缩后上下文占用。'),
            }));
        }
    }
    if (usage.estimatedDeltaSinceCheckpoint > 0) {
        const source = isPlanner
            ? tBiHtml('since last model call', '自上次模型调用')
            : tBiHtml('since last checkpoint', '自上次检查点');
        diagnostics.push(metric(tBiHtml('Est. delta', '估算增量'), `+${esc(number(usage.estimatedDeltaSinceCheckpoint))} · ${source}`, {
            key: 'overview:diag:delta',
            title: tBi('Est. Delta', '估算增量'),
            body: tBi('Estimated tokens since last measured call.', '上次实测后的新增估算增量。'),
        }));
    }
    if (usage.imageGenStepCount > 0) {
        const models = usage.imageGenerationModels?.map(normalizeModelDisplayName).join(' · ');
        diagnostics.push(metric(tBiHtml('Image Gen', '图片生成'), esc(number(usage.imageGenStepCount)), {
            key: 'overview:diag:img-count',
            title: tBi('Image Gen', '图片生成'),
            body: tBi('Image generation steps.', '图片生成步骤数。'),
        }));
        if (models) {
            diagnostics.push(metric(tBiHtml('Image model', '图片模型'), esc(models), {
                key: 'overview:diag:img-model',
                title: tBi('Image Model', '图片模型'),
                body: tBi('Image generation model used.', '调用的图片生成模型。'),
            }));
        }
    }
    const checkpointId = !isPlanner && isShowModelShortId() && usage.checkpointModel
        ? ` · ${usage.checkpointModel.replace(/^MODEL_PLACEHOLDER_/, '')}` : '';

    const obsAttrs = obsProj
        ? ` data-observation-subject="${esc(obsProj.subjectCascadeId ?? '')}" data-observation-data-rev="${obsProj.dataRevision}" data-observation-pct="${esc(obsProj.primaryPctText)}" data-observation-denom="${obsProj.denominatorTokens ?? ''}" data-observation-basis="${esc(obsProj.actualBasis)}" data-observation-health="${esc(obsProj.healthStatus)}" data-observation-fill="${obsProj.geometryFillPct}" data-compaction-warning="${esc(obsProj.compactionWarningActive ? obsProj.compactionWarningLevel : 'none')}"`
        : '';

    const meterBlockHtml = obsProj
        ? (obsProj.isIncomplete
            ? `<p class="overview-meta" data-observation-incomplete="true">${tBiHtml('Context measurement unavailable', '暂无上下文计量')}</p>`
            : buildObservationMarkersHtml(contextLabel, obsProj, v1176?.watermarks ?? null))
        : (reading.percent === null
            ? `<p class="overview-meta">${tBiHtml('Context measurement unavailable', '暂无上下文计量')}</p>`
            : buildDualWatermarkMeterHtml(contextLabel, reading.percent, ratio, contextMeterTone(reading.percent), v1176?.watermarks ?? null));

    const activeBasis: ContextDisplayBasis = v1176?.contextPctBasis ?? obsProj?.requestedBasis ?? 'compaction';
    const basisSwitchHtml = `<div class="ov-basis-row">${ovSegSwitch('contextPctBasis', activeBasis, t('context.basisCompaction'), [
        { val: 'compaction', labelHtml: tHtml('context.basisCompaction') },
        { val: 'native', labelHtml: tHtml('context.basisNative') },
    ])}${v1176?.cacheTtlHtml || ''}</div>`;

    return `<div class="overview-session"${obsAttrs}>
        ${v1176?.subjectBadgeHtml || ''}
        ${usage.title ? `<p class="overview-session-title">${esc(usage.title)}</p>` : ''}
        <p class="overview-meta">${modelLabel ? `${esc(modelLabel)} · ` : ''}${precisionHtml}</p>
        ${routePillHtml}
        ${basisSwitchHtml}
        <div class="overview-reading">
            <div><strong>${number(reading.used)}</strong><span> / ${number(reading.limit)} ${tokenUnit}</span></div>
            <span class="overview-percent">${ratio}</span>
        </div>
        ${meterBlockHtml}
        ${remaining !== null
            ? `<p class="overview-meta">${tBiHtml('Remaining', '可用余量')} · ${number(remaining.tokens)} ${tokenUnit}</p>` : ''}
        ${v1176?.turnCacheHtml || ''}
        ${v1176?.handoffV2Html || ''}
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

function action(tab: 'models' | 'gm' | 'gmdata' | 'settings', labelHtml: string, anchor?: string): string {
    return `<button type="button" class="overview-action" data-overview-target="${tab}" data-overview-focus="${esc(anchor || tab)}"${anchor ? ` data-overview-anchor="${esc(anchor)}"` : ''}><span>${labelHtml}</span> ${arrow}</button>`;
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
    const appOnboardingBannerHtml = buildAppOnboardingBannerHtml(telemetry);
    const staleBannerHtml = buildStaleBannerHtml(telemetry?.staleState, 'overview');
    const d9SelectionBannersHtml = buildD9SelectionBannersHtml(telemetry);
    const obsProjection = telemetry?.observation ? projectForOverview(telemetry.observation) : null;
    const hasStaleFallbackData = Boolean(telemetry?.staleState?.isStale && (configs.length > 0 || usage || userInfo));
    const connected = (status.state !== 'connecting' && status.state !== 'disconnected') || hasStaleFallbackData;
    const matchesObservation = !obsProjection || usage?.cascadeId === obsProjection.subjectCascadeId;
    const active = matchesObservation && (status.state === 'active' || hasStaleFallbackData) ? usage : null;
    const isCustomModelActive = Boolean(telemetry?.isCustomModelActive);
    const activeCascadeId = obsProjection ? obsProjection.subjectCascadeId ?? undefined : (telemetry?.activeCascadeId ?? active?.cascadeId);

    const activeReading = obsProjection
        ? { used: obsProjection.usedTokens, limit: obsProjection.denominatorTokens, percent: obsProjection.primaryPct }
        : (active ? getContextReading(active) : null);
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

    const effectiveSessionCostUsd = obsProjection
        ? (obsProjection.isZeroStepFresh ? undefined : (obsProjection.sessionCostUsd ?? undefined))
        : telemetry?.sessionCostUsd;

    const speedMetricMode: SpeedMetricMode = (obsProjection?.speedMode ?? telemetry?.speedMetricMode) === 'e2e' ? 'e2e' : 'decode';
    const contextPctBasis: ContextDisplayBasis = telemetry?.contextPctBasis ?? obsProjection?.requestedBasis ?? 'compaction';
    const quotaWindowMode: QuotaWindowMode = telemetry?.quotaWindowMode === '7d' || telemetry?.quotaWindowMode === 'tightest' ? telemetry.quotaWindowMode : '5h';
    const quotaDirectionMode: QuotaDirectionMode = telemetry?.quotaDirectionMode === 'used' ? 'used' : 'remaining';

    const telemetryData = connected && !obsProjection?.isZeroStepFresh
        ? extractOverviewTelemetry(
            telemetry?.gmSummary,
            activeCascadeId,
            telemetry?.customPricing,
            telemetry?.orchestratorPricingMode,
        )
        : null;
    let telemetryHtml = telemetryData
        ? telemetryStrip(telemetryData, effectiveSessionCostUsd, telemetry?.todayCostUsd, {
            speedSample: telemetry?.speedSample,
            observation: obsProjection,
            displayCurrency: telemetry?.displayCurrency,
            orchestratorPricingMode: telemetry?.orchestratorPricingMode,
            speedMetricMode,
            cacheTtl: telemetry?.cacheTtl,
        })
        : '';
    if (!telemetryHtml && connected) {
        const standaloneCost = buildCostTelemetryCell(
            effectiveSessionCostUsd,
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
    const cacheTtlHtml = !telemetryData ? buildCacheTtlBadgeHtml(telemetry?.cacheTtl) : '';

    const resolvedSwarm = connected
        ? (telemetry?.swarmOverview ?? deriveSwarmOverviewFromTopology(
            telemetry?.swarmTopology,
            activeCascadeId,
            telemetry?.inspectedMemberId,
            telemetry?.lockedRootId,
            telemetry?.swarmGroupCost,
        ))
        : null;
    const swarmLiveStripHtml = buildSwarmLiveStripHtml(resolvedSwarm, {
        displayCurrency: telemetry?.displayCurrency,
        inspectedMemberId: telemetry?.inspectedMemberId,
        lockedRootId: telemetry?.lockedRootId,
        activeCascadeId,
        readableMemberIds: telemetry?.readableMemberIds,
    });

    const showBudgetWarning = Boolean(
        obsProjection?.compactionWarningActive
        || (activeReading?.percent !== null && activeReading?.percent !== undefined && activeReading.percent >= 65)
        || active?.compressionDetected,
    );
    const handoffV2Html = connected && (active || telemetry?.handoffPreview)
        ? buildHandoffV2SectionHtml(
            telemetry?.handoffPreview,
            activeCascadeId,
            obsProjection?.dataRevision ?? 0,
            showBudgetWarning,
        )
        : '';
    const recoveryBriefHtml = connected ? buildCompactionRecoveryBriefHtml(telemetry?.recoveryBrief) : '';
    const isInspectingWorker = Boolean(
        (telemetry?.inspectedMemberId && obsProjection?.subjectKind !== 'main' && !resolvedSwarm?.members.find(m => m.cascadeId === telemetry.inspectedMemberId)?.isCoordinator)
        || obsProjection?.subjectKind === 'worker'
        || obsProjection?.subjectKind === 'subagent',
    );
    const subjectBadgeHtml = isInspectingWorker
        ? `<span class="swarm-role-badge is-worker" data-subject-badge="worker">${tHtml('swarm.inspectedWorker')}</span>`
        : (telemetry?.lockedRootId || resolvedSwarm || obsProjection?.subjectKind === 'main'
            ? `<span class="swarm-role-badge is-root" data-subject-badge="root">${tHtml('swarm.rootLabel')}</span>`
            : '');

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
    const quotaTitlePlain = quotaDirectionMode === 'used' ? t('quota.directionUsed') : t('quota.directionRemaining');
    const quotaTitleHtml = quotaDirectionMode === 'used' ? tHtml('quota.directionUsed') : tHtml('quota.directionRemaining');
    const quotaControlsHtml = `<div class="ov-quota-controls" data-quota-window-mode="${quotaWindowMode}" data-quota-direction-mode="${quotaDirectionMode}">${ovSegSwitch('quotaWindowMode', quotaWindowMode, tBi('Quota window', '配额窗口'), [
        { val: '5h', labelHtml: tHtml('quota.window5h') },
        { val: '7d', labelHtml: tHtml('quota.window7d') },
        { val: 'tightest', labelHtml: tHtml('quota.windowTightest') },
    ])}${ovSegSwitch('quotaDirectionMode', quotaDirectionMode, t('quota.directionRemaining'), [
        { val: 'remaining', labelHtml: tHtml('quota.directionRemaining') },
        { val: 'used', labelHtml: tHtml('quota.directionUsed') },
    ])}</div>`;
    const runways = telemetry?.quotaRunways;

    const quotaRows = groups.map(group => {
        const poolKey = group.pool || group.key;
        const proj = projectQuotaDisplay({
            windowMode: quotaWindowMode,
            directionMode: quotaDirectionMode,
            window5h: group.fiveHourQuota
                ? {
                    remainingFraction: group.fiveHourQuota.remainingFraction,
                    resetTimeMs: group.fiveHourQuota.resetTime ? Date.parse(group.fiveHourQuota.resetTime) : null,
                }
                : (group.minimum !== null ? { remainingFraction: group.minimum, resetTimeMs: group.resetTime ? Date.parse(group.resetTime) : null } : null),
            window7d: group.weeklyQuota
                ? {
                    remainingFraction: group.weeklyQuota.remainingFraction,
                    resetTimeMs: group.weeklyQuota.resetTime ? Date.parse(group.weeklyQuota.resetTime) : null,
                }
                : null,
            nowMs: now,
        });
        const modeTagHtml = `<span class="ov-quota-mode-tag" data-quota-win-tag="${esc(proj.effectiveWindow ?? 'unknown')}" data-quota-dir-tag="${quotaDirectionMode}">${tBiHtml(proj.metricLabelEn, proj.metricLabelZh)}</span>`;
        const band = proj.displayPct !== null && (quotaDirectionMode === 'used' || quotaWindowMode !== '5h')
            ? `${proj.displayPct}%`
            : quotaPercentage(group);
        const unknownQuota = proj.isUnavailable;
        const partial = (group.missingQuota && group.minimum !== null) || (group.missingReset && group.resetTime);
        const hasDualWindow = Boolean(group.fiveHourQuota || group.weeklyQuota);
        const poolRoleTag = activeRoute?.isCrossPool && group.pool
            ? (activeRoute.plannerPool === group.pool
                ? ` <span class="orch-route-badge"${richTipAttrs({
                    key: `overview:quota-role:${poolKey}`,
                    title: tBi('Planner Role Pool', '规划角色配额池'),
                    body: tBi('Your active Orchestrator Planner model draws quota from this shared pool.', '当前活跃会话的「规划（编排）」模型正在消耗该配额池的配额。'),
                    focusable: true,
                })}>${tBiHtml('Planner', '规划')}</span>`
                : activeRoute.executorPool === group.pool
                    ? ` <span class="orch-route-badge"${richTipAttrs({
                        key: `overview:quota-role:${poolKey}`,
                        title: tBi('Executor Role Pool', '执行角色配额池'),
                        body: tBi('Your active Orchestrator Executor model draws quota from this shared pool.', '当前活跃会话的「执行」模型正在消耗该配额池的配额。'),
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
                ${group.fiveHourQuota ? dualQuotaWindowHtml(group.label, poolKey, '5h', group.fiveHourQuota, now, quotaDirectionMode) : ''}
                ${group.weeklyQuota ? dualQuotaWindowHtml(group.label, poolKey, 'weekly', group.weeklyQuota, now, quotaDirectionMode) : ''}
            </div>`
            : `${unknownQuota
                ? '<div class="overview-meter is-unknown" aria-hidden="true"></div>'
                : meter(`${group.label} · ${quotaTitlePlain}`, (proj.displayPct ?? (group.minimum! * 100)), band, quotaMeterTone((proj.remainingPct ?? (group.minimum! * 100))))}
            <p class="overview-meta">${quotaResetHtml(group, now)}${partial ? ` · ${tBiHtml('Partial data', '数据不完整')}` : ''}</p>`;
        const poolHeadingTip = richTipAttrs({
            key: `overview:quota-pool:${poolKey}`,
            title: group.label,
            body: tBi(
                `Shared quota pool grouping ${group.members.length === 1 ? '1 model' : `${group.members.length} models`} under one allowance (${unknownQuota ? 'remaining unavailable' : `${band} ${proj.directionLabelEn.toLowerCase()}`}).`,
                `共享配额池，共包含 ${group.members.length} 个模型，共用同一配额（${unknownQuota ? '暂无剩余数据' : `${proj.directionLabelZh} ${band}`}）。`,
            ),
            meta: tBi(
                'Models in the same pool share the same rate-limit allowance and reset timer.',
                '同一配额池内的模型共享相同的可用配额与重置倒计时。',
            ),
            focusable: true,
        });
        return `<li class="overview-quota-row" data-pool-key="${esc(poolKey)}">
            <div class="overview-quota-heading">
                <div${poolHeadingTip}><h3>${esc(group.label)}${poolRoleTag}</h3><span class="overview-meta">${modelFamilyCountHtml(group.members.length)}</span></div>
                <div class="overview-quota-reading">${modeTagHtml}
                ${hasDualWindow
                    ? (proj.displayPct !== null ? `<strong>${esc(`${proj.displayPct}%`)}</strong>` : '')
                    : (unknownQuota
                        ? `<strong class="overview-quota-unknown">${tBiHtml('Unknown', '未知')}</strong>`
                        : `<strong>${esc(band)}</strong>`)}
                </div>
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

    const emptyContextHtml = telemetry?.inspectedMemberId ? tHtml('swarm.readUnavailable') : status.state === 'idle'
        ? tBiHtml('No context measurement for this conversation yet.', '当前会话暂无上下文计量。')
        : tBiHtml('Open an Antigravity conversation to see its context usage.', '打开 Antigravity 会话后即可查看上下文用量。');

    const glossaryHtml = connected ? buildOverviewGlossaryHtml() : '';
    const planTipAttrs = richTipAttrs({
        key: 'overview:plan-pill',
        title: tBi('Subscription Plan', '订阅方案'),
        body: plan,
        focusable: true,
    });
    const aiCreditsTipAttrs = richTipAttrs({
        key: 'overview:ai-credits',
        title: tBi('Account AI Credits', '账号 AI 积分'),
        body: credits === null
            ? tBi('Not reported by local service.', '本地服务暂未上报。')
            : `${tBi('Available', '可用')}: ${number(credits)}`,
        focusable: true,
    });

    const emptyObservationHtml = !active && obsProjection
        ? `<div class="overview-session" data-observation-subject="${esc(obsProjection.subjectCascadeId ?? '')}" data-observation-data-rev="${obsProjection.dataRevision}" data-observation-pct="${esc(obsProjection.primaryPctText)}" data-observation-denom="${obsProjection.denominatorTokens ?? ''}" data-observation-basis="${esc(obsProjection.actualBasis)}" data-observation-health="${esc(obsProjection.healthStatus)}" data-observation-fill="${obsProjection.geometryFillPct}" data-compaction-warning="${esc(obsProjection.compactionWarningActive ? obsProjection.compactionWarningLevel : 'none')}">
            ${subjectBadgeHtml}
            <div class="overview-reading">
                <div><strong>${number(obsProjection.usedTokens)}</strong><span> / ${number(obsProjection.denominatorTokens)} tokens</span></div>
                <span class="overview-percent">${esc(obsProjection.primaryPctText)}</span>
            </div>
            ${obsProjection.isIncomplete
                ? `<p class="overview-meta" data-observation-incomplete="true">${tBiHtml('Context measurement unavailable', '暂无上下文计量')}</p>`
                : buildObservationMarkersHtml(tBi('Context used', '上下文占用'), obsProjection, resolvedWatermarks)}
        </div>`
        : '';

    return `<section class="monitor-overview" data-monitor-overview data-monitor-state="${status.state}" aria-labelledby="overview-heading">
        <header class="overview-header">
            <h2 id="overview-heading" data-overview-focus="heading" tabindex="-1">${tBiHtml('Context & quota', '上下文与配额')}</h2>
            ${connected && plan ? `<p class="overview-meta overview-plan-pill"${planTipAttrs}>${esc(plan)}</p>` : ''}
        </header>
        ${appOnboardingBannerHtml}
        ${staleBannerHtml}
        ${d9SelectionBannersHtml}
        ${lowQuotaBannerHtml}
        ${recoveryBriefHtml}
        ${connected ? `<div class="overview-grid">
            <section class="overview-context" aria-labelledby="overview-context-heading">
                <h3 id="overview-context-heading" class="overview-section-heading"><span class="overview-state-dot" aria-hidden="true"></span><span>${statusHeadingHtml(status.state)}</span></h3>
                ${active ? sessionDetails(active, { watermarks: resolvedWatermarks, turnCacheHtml, orchestratorSplitHtml, observationProjection: obsProjection, contextPctBasis, cacheTtlHtml, handoffV2Html, subjectBadgeHtml }) : `${emptyObservationHtml || `<p class="overview-empty">${emptyContextHtml}</p>`}${cacheTtlHtml}${turnCacheHtml}${handoffV2Html}${orchestratorSplitHtml}`}
                ${breakdownHtml}
            </section>
            <section class="overview-quota" aria-labelledby="overview-quota-heading">
                <div class="overview-quota-top">
                    <h3 id="overview-quota-heading" class="overview-section-heading"><span>${quotaTitleHtml}</span></h3>
                    ${quotaControlsHtml}
                </div>
                ${quotaBodyHtml}
                ${action('models', tBiHtml('View models', '查看模型'))}
            </section>
        </div>
        ${telemetryHtml}
        ${action('gm', tHtml('nav.modelCalls'))}
        ${swarmLiveStripHtml}
        ${glossaryHtml}` : `<div class="overview-connection">
            <h3 class="overview-section-heading"><span class="overview-state-dot" aria-hidden="true"></span><span>${statusHeadingHtml(status.state)}</span></h3>
            <p class="overview-empty">${status.state === 'disconnected'
                ? backendMessageHtml(status.backendIssue)
                : tBiHtml('Waiting for the local backend.', '正在等待本地后端。')}</p>
        </div>`}
        ${!connected || userInfo || billingDay > 0 ? `<footer class="overview-footer">
            ${connected && (userInfo || billingDay > 0) ? `<p${aiCreditsTipAttrs}>
                <span>${tBiHtml('AI credits', 'AI 积分')}</span>
                ${credits === null ? `<span class="overview-meta">${tBiHtml('Not reported', '未上报')}</span>` : `<strong>${number(credits)}</strong>`}
                <span class="overview-meta">${expiryHtml}</span>
            </p>` : ''}
            ${connected && userInfo
                ? action('models', tBiHtml('Set credits expiry day', '设置积分到期日'), 'profileBillingDayInput')
                : (!connected ? action('settings', tHtml('nav.settings')) : '')}
        </footer>` : ''}
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
        .overview-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
        .overview-grid:has(.overview-context details[open]) { align-items: start; }
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
        .overview-quota-reading { display: flex; flex-wrap: wrap; justify-content: end; align-items: baseline; gap: 4px 7px; }
        body .overview-quota-reading .ov-quota-mode-tag { white-space: normal; }
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

import type { GMSummary } from './gm/types';
import { t, tBi } from './i18n';
import { groupModelQuotas, type QuotaEffort, type QuotaReadingSummary, type ModelQuotaGroup } from './model-quota';
import { resolveModelId, type ModelConfig } from './models';
import type { ModelPricing } from './pricing-store';
import { formatResetAbsolute } from './reset-time';
import {
    computeTelemetrySummary,
    type SessionTelemetrySummary,
    type TelemetryAggregate,
} from './telemetry-metrics';
import type { ContextUsage } from './tracker';

export type MonitorState = 'connecting' | 'disconnected' | 'empty' | 'idle' | 'active';

export interface MonitorStatus {
    state: MonitorState;
    backendIssue?: 'notFound' | 'lost' | 'other';
}

export const MONITOR_COMMAND = 'antigravity-context-monitor.showDetails';
export type OverviewDestination = 'overview' | 'models' | 'settings';

export function monitorStatusLabel(state: MonitorState): string {
    switch (state) {
        case 'connecting': return tBi('Connecting to Antigravity', '正在连接 Antigravity');
        case 'disconnected': return tBi('Backend disconnected', '后端连接已断开');
        case 'empty': return t('statusBar.noConversationTooltip');
        case 'idle': return tBi('Conversation idle', '会话空闲');
        case 'active': return tBi('Active conversation', '会话进行中');
    }
}

export function monitorBackendMessage(issue: MonitorStatus['backendIssue']): string {
    if (issue === 'notFound') { return t('statusBar.backendNotFound'); }
    if (issue === 'lost') { return t('statusBar.backendConnectionLost'); }
    return tBi('Unable to read the local backend. Refresh to try again.', '无法读取本地后端，请刷新后重试。');
}

export function usableCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function getContextReading(usage: ContextUsage) {
    const used = usableCount(usage.contextUsed) ? usage.contextUsed : null;
    const limit = usableCount(usage.contextLimit) && usage.contextLimit > 0 ? usage.contextLimit : null;
    const ratio = used !== null && limit !== null ? used / limit * 100 : NaN;
    return { used, limit, percent: Number.isFinite(ratio) ? ratio : null };
}

export function getContextRemaining(used: number | null, limit: number | null): { tokens: number; percent: number } | null {
    if (used === null || limit === null || !Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
        return null;
    }
    const tokens = Math.max(0, limit - used);
    const percent = Math.max(0, Math.min(100, (tokens / limit) * 100));
    return { tokens, percent };
}

export function selectMonitorQuotaGroups(configs: readonly ModelConfig[], currentModel = ''): ModelQuotaGroup[] {
    const id = resolveModelId(currentModel) || currentModel;
    return groupModelQuotas(configs).sort((a, b) => {
        const active = (group: ModelQuotaGroup) => id !== '' && group.readings.some(reading => reading.model === id);
        return Number(active(b)) - Number(active(a))
            || (a.minimum ?? Infinity) - (b.minimum ?? Infinity)
            || a.label.localeCompare(b.label);
    });
}

export function modelFamilyCountLabel(count: number): string {
    return tBi(count === 1 ? '1 model' : `${count} models`, `${count} 个模型`);
}

const EFFORT_LABELS: Record<QuotaEffort, readonly [string, string]> = {
    low: ['Low', '低'],
    medium: ['Medium', '中'],
    high: ['High', '高'],
    xhigh: ['Extra', '超高'],
};

export function formatQuotaEffort(effort: QuotaEffort): string {
    const [en, zh] = EFFORT_LABELS[effort];
    return tBi(en, zh);
}

export function formatQuotaEfforts(efforts: readonly QuotaEffort[]): string {
    if (!efforts.length) { return ''; }
    return tBi(
        efforts.map(e => EFFORT_LABELS[e][0]).join(' · '),
        efforts.map(e => EFFORT_LABELS[e][1]).join(' · '),
    );
}

export function quotaPercentage(group: Pick<QuotaReadingSummary, 'minimum' | 'maximum'>): string {
    if (group.minimum === null || group.maximum === null) { return '—'; }
    const lo = Math.round(group.minimum * 100);
    const hi = Math.round(group.maximum * 100);
    if (lo !== hi) { return `${lo}–${hi}%`; }
    if (group.minimum !== group.maximum) {
        const lower = Number((group.minimum * 100).toFixed(1));
        const upper = Number((group.maximum * 100).toFixed(1));
        if (lower !== upper) { return `${lower}–${upper}%`; }
    }
    return `${lo}%`;
}

export function resetCountdown(at: number, now: number): string {
    if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(now)) {
        return tBi('Reset time unavailable', '暂无重置时间');
    }
    const minutes = Math.ceil((at - now) / 60_000);
    if (minutes <= 0) { return tBi('Reset time passed', '已到重置时间'); }
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    const remMinutes = minutes % 60;
    if (days > 0) {
        return remHours > 0
            ? tBi(`${days}d ${remHours}h`, `${days} 天 ${remHours} 小时`)
            : tBi(`${days}d`, `${days} 天`);
    }
    if (hours > 0) {
        return remMinutes > 0
            ? tBi(`${hours}h ${remMinutes}m`, `${hours} 小时 ${remMinutes} 分钟`)
            : tBi(`${hours}h`, `${hours} 小时`);
    }
    return tBi(`${minutes}m`, `${minutes} 分钟`);
}

export function quotaResetLabel(group: Pick<QuotaReadingSummary, 'resetDiffers' | 'resetTime'>, now: number, showAbsolute = false): string {
    if (group.resetDiffers) { return tBi('Reset times vary', '重置时间不同'); }
    if (!group.resetTime) { return tBi('Reset time unavailable', '暂无重置时间'); }
    const remaining = resetCountdown(Date.parse(group.resetTime), now);
    return showAbsolute ? `${remaining} · ${formatResetAbsolute(group.resetTime)}` : remaining;
}

export function formatCreditExpiry(days: number | null): string {
    if (days === null || !Number.isFinite(days) || days < 0) { return tBi('Expiry date not set', '未设置到期日'); }
    if (days === 0) { return tBi('Expires today', '今日到期'); }
    return tBi(days === 1 ? 'Expires in 1 day' : `Expires in ${days} days`, `${days} 天后到期`);
}

export interface OverviewTelemetryInput {
    gmSummary?: GMSummary | null;
    customPricing?: Record<string, ModelPricing>;
    activeCascadeId?: string;
}

export interface OverviewTelemetrySnapshot {
    summary: SessionTelemetrySummary;
    primary: TelemetryAggregate;
    primaryScope: 'active' | 'session';
    speedPrimary: number | null;
    ttftPrimary: number | null;
}

/**
 * Pure telemetry extractor for the Overview tab.
 * Delegates to computeTelemetrySummary() and returns null when there are no calls
 * or no valid speed/TTFT/cache readings (preventing fabricated 0 tok/s or 0%).
 */
export function extractOverviewTelemetry(
    gmSummary?: GMSummary | null,
    activeCascadeId?: string,
    customPricing?: Record<string, ModelPricing>,
): OverviewTelemetrySnapshot | null {
    if (!gmSummary) { return null; }
    const summary = computeTelemetrySummary(gmSummary, { activeCascadeId, customPricing });
    const { primary, primaryScope } = summary;
    const speedPrimary = primary.latestGenTokPerSec ?? primary.weightedGenTokPerSec;
    const ttftPrimary = primary.latestTtftSeconds ?? primary.avgTtftSeconds;
    const hasReading = speedPrimary !== null
        || ttftPrimary !== null
        || primary.tokenCacheHitRate !== null;
    if (primary.totalCalls <= 0 || !hasReading) {
        return null;
    }
    return {
        summary,
        primary,
        primaryScope,
        speedPrimary,
        ttftPrimary,
    };
}

/** Compact token count formatter for tight telemetry cells (e.g. 142k, 14.5k, 1.2M). */
export function formatCompactTokens(tokens: number): string {
    if (!Number.isFinite(tokens) || tokens <= 0) { return '0'; }
    if (tokens >= 1_000_000) {
        return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (tokens >= 1_000) {
        const digits = tokens >= 100_000 ? 0 : 1;
        return `${(tokens / 1_000).toFixed(digits).replace(/\.0$/, '')}k`;
    }
    return String(Math.round(tokens));
}

/** Format positive USD cache savings without ever emitting fake $0.00. */
export function formatSavingsUsd(usd: number | null | undefined): string | null {
    if (usd === null || usd === undefined || !Number.isFinite(usd) || usd <= 0) {
        return null;
    }
    if (usd >= 0.01) { return `$${usd.toFixed(2)}`; }
    if (usd >= 0.001) { return `$${usd.toFixed(3)}`; }
    if (usd >= 0.0001) { return `$${usd.toFixed(4)}`; }
    return '<$0.0001';
}

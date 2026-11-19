import { t, tBi } from './i18n';
import { groupModelQuotas, type ModelQuotaGroup } from './model-quota';
import { resolveModelId, type ModelConfig } from './models';
import { formatResetAbsolute } from './reset-time';
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

export function selectMonitorQuotaGroups(configs: readonly ModelConfig[], currentModel = ''): ModelQuotaGroup[] {
    const id = resolveModelId(currentModel) || currentModel;
    return groupModelQuotas(configs).sort((a, b) => {
        const active = (group: ModelQuotaGroup) => id !== '' && group.readings.some(reading => reading.model === id);
        return Number(active(b)) - Number(active(a))
            || (a.minimum ?? Infinity) - (b.minimum ?? Infinity)
            || a.label.localeCompare(b.label);
    });
}

export function quotaPercentage(group: ModelQuotaGroup): string {
    if (group.minimum === null || group.maximum === null) { return '—'; }
    const lo = Math.round(group.minimum * 100);
    const hi = Math.round(group.maximum * 100);
    return lo === hi ? `${lo}%` : `${lo}–${hi}%`;
}

export function resetCountdown(at: number, now: number): string {
    const minutes = Math.ceil((at - now) / 60_000);
    if (minutes <= 0) { return tBi('Reset time passed', '已到重置时间'); }
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) { return tBi(`${days}d ${hours % 24}h`, `${days} 天 ${hours % 24} 小时`); }
    if (hours > 0) { return tBi(`${hours}h ${minutes % 60}m`, `${hours} 小时 ${minutes % 60} 分钟`); }
    return tBi(`${minutes}m`, `${minutes} 分钟`);
}

export function quotaResetLabel(group: ModelQuotaGroup, now: number, showAbsolute = false): string {
    if (group.resetDiffers) { return tBi('Reset times vary', '重置时间不同'); }
    if (!group.resetTime) { return tBi('Reset time unavailable', '暂无重置时间'); }
    const remaining = resetCountdown(Date.parse(group.resetTime), now);
    return showAbsolute ? `${remaining} · ${formatResetAbsolute(group.resetTime)}` : remaining;
}

export function formatCreditExpiry(days: number | null): string {
    if (days === null) { return tBi('Expiry date not set', '未设置到期日'); }
    if (days === 0) { return tBi('Expires today', '今日到期'); }
    return tBi(days === 1 ? 'Expires in 1 day' : `Expires in ${days} days`, `${days} 天后到期`);
}

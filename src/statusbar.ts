import * as vscode from 'vscode';
import type { ContextUsage } from './tracker';
import { localizeNeonPickerLabel, resolveModelId, type ModelConfig } from './models';
import { t, tBi, getLanguage } from './i18n';
import { formatResetCountdownFromMs } from './reset-time';
import { getDaysUntilBillingDay } from './billing-day';
import {
    getMaxQuotaRows, parseTooltipDensity, resolveEffectiveMode, truncateByDisplayWidth,
    type EffectiveMode, type TooltipDensity,
} from './tooltip-budget';
import {
    formatCreditExpiry, getContextReading, monitorBackendMessage, monitorStatusLabel, MONITOR_COMMAND,
    quotaPercentage, quotaResetLabel, selectMonitorQuotaGroups, usableCount,
    type MonitorStatus, type OverviewDestination,
} from './monitor-overview';

// Re-export pure helpers for tests / external callers
export {
    resolveEffectiveMode,
    selectQuotaRows,
    getMaxQuotaRows,
    getLineBudget,
    applyLineBudget,
    ensureCtaLast,
    parseTooltipDensity,
    truncateByDisplayWidth,
    COMPACT_MAX_QUOTA_ROWS,
    NORMAL_MAX_QUOTA_ROWS,
    COMPACT_MAX_LINES,
    NORMAL_MAX_LINES,
} from './tooltip-budget';
export type { TooltipDensity, EffectiveMode, QuotaSelectable } from './tooltip-budget';

// ─── Token Formatting ─────────────────────────────────────────────────────────

/**
 * Format a token count for display (e.g. 45231 → "45.2k", 1500000 → "1.5M").
 */
export function formatTokenCount(count: number): string {
    return formatTokenValue(count);
}

/**
 * Format a context limit for display (e.g. 2000000 → "2M").
 */
export function formatContextLimit(limit: number): string {
    return formatTokenValue(limit);
}

/**
 * Unified token/limit formatter.
 * - ≥ 1M → "1.5M"
 * - ≥ 1K → "45.2k"
 * - < 1K → raw number
 */
function formatTokenValue(value: number): string {
    const safe = Math.max(0, value);
    if (safe >= 1_000_000) {
        return `${(safe / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    if (safe >= 1_000) {
        return `${(safe / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    }
    return safe.toString();
}

/**
 * Escape Markdown special characters in dynamic content to prevent
 * broken rendering in VS Code tooltip MarkdownStrings.
 */
export function escapeMarkdown(text: string): string {
    return text.replace(/[\x00-\x1F\x7F\u2028\u2029\u202A-\u202E\u2066-\u2069]+/g, ' ').replace(/[&|*_~`\[\]\\#<>!$()]/g, '\\$&');
}

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

// ─── Status Bar Colors ────────────────────────────────────────────────────────

type StatusBarSeverity = 'ok' | 'warning' | 'error' | 'critical';

function getSeverity(usagePercent: number): StatusBarSeverity {
    if (usagePercent >= 80) { return 'critical'; }
    if (usagePercent >= 50) { return 'warning'; }
    return 'ok';
}

function getSeverityColor(severity: StatusBarSeverity): vscode.ThemeColor | undefined {
    switch (severity) {
        case 'critical': return new vscode.ThemeColor('statusBarItem.errorBackground');
        case 'error': return new vscode.ThemeColor('statusBarItem.errorBackground');
        case 'warning': return new vscode.ThemeColor('statusBarItem.warningBackground');
        default: return undefined;
    }
}

function getSeverityIcon(severity: StatusBarSeverity): string {
    switch (severity) {
        case 'critical': return '$(zap)';
        case 'error': return '$(warning)';
        case 'warning': return '$(info)';
        default: return '$(pulse)';
    }
}

// ─── Tooltip density diagnostics (one-shot per signature, PATH-check style) ───

let lastDensityDiagKey = '';

/** Injected OutputChannel logger — console.log from the extension host never reaches
 *  the on-disk logs, so field diagnostics must route through the extension's channel. */
let densityDiagLogger: ((message: string) => void) | null = null;

/** Inject the extension's OutputChannel logger (called once from activate()). */
export function setTooltipDiagLogger(logger: (message: string) => void): void {
    densityDiagLogger = logger;
}

function logDensityDiagOnce(
    zoomLevel: number,
    density: TooltipDensity,
    effective: EffectiveMode,
    quotaRows: number,
    lang: string,
): void {
    const key = `${zoomLevel}|${density}|${effective}|${quotaRows}|${lang}`;
    if (key === lastDensityDiagKey) {
        return;
    }
    lastDensityDiagKey = key;
    // Style aligned with v1.16.13 "PATH check" one-shot diagnostics.
    const line = `Tooltip density: zoomLevel=${zoomLevel} density=${density} effective=${effective} quotaRows=${quotaRows} lang=${lang}`;
    if (densityDiagLogger) {
        densityDiagLogger(line);
    } else {
        console.log(`[Antigravity Context Monitor] ${line}`);
    }
}

/** Reset density diagnostic gate (exported for tests). */
export function resetTooltipDensityDiag(): void {
    lastDensityDiagKey = '';
}

// ─── Status Bar Manager ───────────────────────────────────────────────────────

type LastRender =
    | { kind: 'update'; usage: ContextUsage }
    | { kind: 'idle'; limitStr: string; modelId?: string }
    | { kind: 'noConversation'; limitStr: string; modelId?: string }
    | { kind: 'disconnected'; message: string }
    | { kind: 'initializing' };

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private cachedConfigs: ModelConfig[] = [];
    private cachedPlanName: string = '';
    private cachedTierName: string = '';
    /** Timer ID for reset countdown. */
    private resetCountdownTimer: NodeJS.Timeout | undefined;
    /** Status bar display preferences. */
    private displayPrefs = { showContext: true, showQuota: true, showResetCountdown: true, showAiCredits: true };
    /** Cached AI Credits total (sum of all credit types). */
    private cachedCreditsTotal: number = 0;
    /** Cached billing day (1-31, 0 = disabled). */
    private cachedBillingDay: number = 0;
    /** Last render state for config-driven tooltip refresh. */
    private lastRender: LastRender = { kind: 'initializing' };

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = MONITOR_COMMAND;
        this.statusBarItem.name = t('statusBar.name');
        this.showInitializing();
        this.statusBarItem.show();
    }

    /**
     * Cache model configs for quota display in tooltip.
     */
    setModelConfigs(configs: ModelConfig[]): void {
        this.cachedConfigs = configs;
        this.scheduleResetRefresh();
    }



    /**
     * Set status bar display preferences.
     */
    setDisplayPrefs(prefs: { showContext?: boolean; showQuota?: boolean; showResetCountdown?: boolean; showAiCredits?: boolean }): void {
        if (prefs.showContext !== undefined) { this.displayPrefs.showContext = prefs.showContext; }
        if (prefs.showQuota !== undefined) { this.displayPrefs.showQuota = prefs.showQuota; }
        if (prefs.showResetCountdown !== undefined) { this.displayPrefs.showResetCountdown = prefs.showResetCountdown; }
        if (prefs.showAiCredits !== undefined) { this.displayPrefs.showAiCredits = prefs.showAiCredits; }
    }

    /**
     * Update cached AI Credits total for status bar display.
     */
    setCredits(total: number): void {
        this.cachedCreditsTotal = usableCount(total) ? total : 0;
    }

    /**
     * Set the account billing day for refresh countdown.
     */
    setBillingDay(day: number): void {
        this.cachedBillingDay = (day >= 1 && day <= 31) ? day : 0;
    }

    /**
     * Calculate days remaining until next billing day.
     * Returns null if billing day is not configured (0).
     */
    getDaysUntilRefresh(): number | null {
        return getDaysUntilBillingDay(this.cachedBillingDay);
    }

    /**
     * Get the earliest quota reset time from cached configs.
     */
    getEarliestResetTime(): Date | null {
        let earliest: Date | null = null;
        const now = Date.now();
        for (const c of this.cachedConfigs) {
            if (c.quotaInfo?.resetTime) {
                const resetDate = new Date(c.quotaInfo.resetTime);
                if (resetDate.getTime() > now) {
                    if (!earliest || resetDate < earliest) {
                        earliest = resetDate;
                    }
                }
            }
        }
        return earliest;
    }

    /**
     * Schedule an auto-refresh when the earliest quota reset time arrives.
     */
    private scheduleResetRefresh(): void {
        if (this.resetCountdownTimer) {
            clearTimeout(this.resetCountdownTimer);
            this.resetCountdownTimer = undefined;
        }
        const earliest = this.getEarliestResetTime();
        if (!earliest) { return; }
        const delayMs = earliest.getTime() - Date.now() + 3000; // +3s buffer
        if (delayMs > 0 && delayMs < 24 * 3600_000) {
            this.resetCountdownTimer = setTimeout(() => {
                vscode.commands.executeCommand('antigravity-context-monitor.refresh');
            }, delayMs);
        }
    }

    /**
     * Cache plan name for tooltip display.
     */
    setPlanName(planName: string, tierName?: string): void {
        this.cachedPlanName = planName;
        this.cachedTierName = tierName || '';
    }

    /**
     * Re-render tooltip/text from the last known display state.
     * Called when window.zoomLevel or tooltipDensity changes.
     */
    refreshFromConfig(): void {
        this.statusBarItem.name = t('statusBar.name');
        switch (this.lastRender.kind) {
            case 'update':
                this.update(this.lastRender.usage);
                break;
            case 'idle':
                this.showIdle(this.lastRender.limitStr, this.lastRender.modelId);
                break;
            case 'noConversation':
                this.showNoConversation(this.lastRender.limitStr, this.lastRender.modelId);
                break;
            case 'disconnected':
                this.showDisconnected(this.lastRender.message);
                break;
            case 'initializing':
                this.showInitializing();
                break;
            default:
                break;
        }
    }

    get monitorStatus(): MonitorStatus {
        switch (this.lastRender.kind) {
            case 'initializing': return { state: 'connecting' };
            case 'disconnected': return {
                state: 'disconnected',
                backendIssue: this.lastRender.message === 'LS not found' ? 'notFound'
                    : this.lastRender.message === 'LS connection lost' ? 'lost' : 'other',
            };
            case 'noConversation': return { state: 'empty' };
            case 'idle': return { state: 'idle' };
            case 'update': return { state: 'active' };
        }
    }

    showInitializing(): void {
        this.lastRender = { kind: 'initializing' };
        this.statusBarItem.backgroundColor = undefined;
        this.renderStatus('$(sync~spin)', [t('statusBar.initializing')]);
    }

    showDisconnected(message: string): void {
        this.lastRender = { kind: 'disconnected', message };
        this.statusBarItem.backgroundColor = undefined;
        this.renderStatus('$(debug-disconnect)', [t('statusBar.disconnectedLabel')]);
    }

    showNoConversation(limitStr: string = '1M', modelId?: string): void {
        this.lastRender = { kind: 'noConversation', limitStr, modelId };
        this.statusBarItem.backgroundColor = undefined;
        this.renderStatus('$(comment-discussion)', [
            this.displayPrefs.showContext ? t('statusBar.noConversationTooltip') : '',
            ...this.indicators(modelId),
        ]);
    }

    showIdle(limitStr: string = '1M', modelId?: string): void {
        this.lastRender = { kind: 'idle', limitStr, modelId };
        this.statusBarItem.backgroundColor = undefined;
        this.renderStatus('$(clock)', [
            this.displayPrefs.showContext ? t('statusBar.idle') : '',
            ...this.indicators(modelId),
        ]);
    }

    update(usage: ContextUsage): void {
        this.lastRender = { kind: 'update', usage };
        const { used, limit, percent } = getContextReading(usage);
        const severity = getSeverity(percent ?? 0);
        this.statusBarItem.backgroundColor = this.displayPrefs.showContext ? getSeverityColor(severity) : undefined;
        const context = used !== null && limit !== null ? `${formatTokenCount(used)}/${formatContextLimit(limit)}` : '—';
        const flags = usage.hasGaps ? ' $(warning)' : percent !== null && percent > 100 ? ' $(fold)' : '';
        this.renderStatus(this.displayPrefs.showContext ? getSeverityIcon(severity) : '$(pulse)', [
            this.displayPrefs.showContext ? `${context}${flags}` : '',
            ...this.indicators(usage.model),
        ]);
    }

    private indicators(modelId?: string): string[] {
        const id = modelId ? resolveModelId(modelId) || modelId : undefined;
        const config = id ? this.cachedConfigs.find(c => (resolveModelId(c.model) || c.model) === id) : undefined;
        const fraction = config?.quotaInfo?.remainingFraction;
        const quota = this.displayPrefs.showQuota && usableCount(fraction) && fraction <= 1
            ? `$(layers) ${Math.round(fraction * 100)}%` : '';
        const reset = this.displayPrefs.showResetCountdown && id
            ? this.formatResetCountdown(config?.quotaInfo?.resetTime) : '';
        const credits = this.displayPrefs.showAiCredits && this.cachedCreditsTotal > 0
            ? `$(zap) ${this.cachedCreditsTotal.toLocaleString()}` : '';
        return [quota, reset, credits];
    }

    private renderStatus(icon: string, segments: string[]): void {
        const text = segments.filter(Boolean);
        this.statusBarItem.text = text.length ? `${icon} ${text.join('  ·  ')}` : icon;
        const state = monitorStatusLabel(this.monitorStatus.state);
        const spoken = text.filter(part => part !== state)
            .map(part => part
                .replace('$(layers)', tBi('Quota remaining', '剩余配额'))
                .replace('$(clock)', tBi('Reset in', '距离重置还有'))
                .replace('$(zap)', tBi('AI credits', 'AI 积分'))
                .replace(/\$\([^)]*\)\s*/g, '').trim());
        this.statusBarItem.accessibilityInformation = {
            label: [t('statusBar.name'), state, ...spoken].join(' · '),
            role: 'button',
        };
        this.statusBarItem.tooltip = this.buildHover();
    }

    private buildHover(): vscode.MarkdownString {
        const status = this.monitorStatus;
        const usage = this.lastRender.kind === 'update' ? this.lastRender.usage : null;
        const connected = status.state !== 'connecting' && status.state !== 'disconnected';
        const groups = connected
            ? selectMonitorQuotaGroups(this.cachedConfigs, usage?.model).filter(g => g.minimum !== null || g.resetTime || g.resetDiffers)
            : [];
        const density = parseTooltipDensity(vscode.workspace.getConfiguration('antigravityContextMonitor')
            .get<string>('statusBar.tooltipDensity', 'auto'));
        const rawZoom = vscode.workspace.getConfiguration('window').get<number>('zoomLevel', 0);
        const zoom = Number.isFinite(rawZoom) ? rawZoom : 0;
        const lang = getLanguage();
        const mode = resolveEffectiveMode(density, zoom, groups.length, lang);
        logDensityDiagOnce(zoom, density, mode, groups.length, lang);
        const sections = [
            `**${t('statusBar.name')}**  \n${monitorStatusLabel(status.state)}`,
        ];

        if (status.state === 'disconnected') {
            sections.push(monitorBackendMessage(status.backendIssue));
        } else if (usage) {
            const { used, limit, percent } = getContextReading(usage);
            const value = used !== null && limit !== null
                ? `**${formatTokenCount(used)} / ${formatContextLimit(limit)}** · ${percent?.toFixed(1) ?? '—'}%`
                : tBi('Context measurement unavailable', '暂无上下文计量');
            const name = localizeNeonPickerLabel(resolveModelId(usage.model) || usage.model, usage.modelDisplayName, lang);
            const title = escapeMarkdown(truncateByDisplayWidth(name, 44));
            const lines = [`$(pulse) ${t('tooltip.title')} · ${value}`, title].filter(Boolean);
            if (usage.hasGaps) {
                lines.push(`$(warning) ${tBi('Some steps are missing', '部分步骤缺失')}`);
            }
            if (percent !== null && percent > 100) {
                lines.push(`$(fold) ${tBi('Above the context limit', '已超过上下文上限')}`);
            }
            if (usage.imageGenerationIncomplete) {
                lines.push(`$(warning) ${tBi('Image workflow data is incomplete', '图片工作流数据不完整')}`);
            }
            if (density === 'full' && usage.title) {
                lines.push(escapeMarkdown(truncateByDisplayWidth(usage.title, 54)));
            }
            sections.push(lines.join('  \n'));
        }

        if (connected) {
            const maxRows = getMaxQuotaRows(density, mode);
            const now = Date.now();
            const lines = [`**${tBi('Quota remaining', '剩余配额')}**`];
            for (const group of groups.slice(0, maxRows)) {
                const label = escapeMarkdown(truncateByDisplayWidth(group.label, 30));
                const hasReset = group.resetTime || group.resetDiffers;
                const reset = hasReset ? ` · ${quotaResetLabel(group, now, density === 'full')}` : '';
                const count = new Set(group.readings.map(reading => reading.model)).size;
                const metadata = mode === 'compact' || count <= 1 ? '' : tBi(` · ${count} models`, ` · ${count} 个模型`);
                lines.push(`$(layers) ${label} · **${quotaPercentage(group)}**${reset}${metadata}`);
            }
            if (groups.length === 0) { lines.push(tBi('Waiting for quota data', '等待配额数据')); }
            const hidden = Math.max(0, groups.length - maxRows);
            if (hidden > 0) {
                lines.push(tBi(`+${hidden} more quota ${hidden === 1 ? 'pool' : 'pools'} in Models`, `模型页还有 ${hidden} 个配额池`));
            }
            sections.push(lines.join('  \n'));

            const plan = [this.cachedPlanName, this.cachedTierName]
                .filter((label, index, all) => label && all.indexOf(label) === index)
                .map(label => escapeMarkdown(truncateByDisplayWidth(label, 30))).join(' · ');
            const account = plan ? [`$(account) ${plan}`] : [];
            if (this.cachedCreditsTotal > 0) {
                const expiry = mode === 'compact' ? '' : ` · ${formatCreditExpiry(this.getDaysUntilRefresh())}`;
                account.push(`$(zap) ${tBi('AI credits', 'AI 积分')} · **${this.cachedCreditsTotal.toLocaleString()}**${expiry}`);
            }
            if (account.length) { sections.push(account.join('  \n')); }
        }

        const link = (destination: OverviewDestination, label: string) => {
            const query = encodeURIComponent(JSON.stringify([destination]));
            return `[${label}](command:${MONITOR_COMMAND}?${query})`;
        };
        sections.push([
            link('overview', tBi('Open overview', '打开总览')),
            link('models', tBi('Models', '模型')),
            link('settings', tBi('Settings', '设置')),
        ].join(' · '));
        const tooltip = new vscode.MarkdownString(sections.join('\n\n'));
        tooltip.supportThemeIcons = true;
        tooltip.isTrusted = { enabledCommands: [MONITOR_COMMAND] };
        return tooltip;
    }

    private formatResetCountdown(resetTime: string | undefined): string {
        const now = Date.now();
        const modelReset = resetTime ? Date.parse(resetTime) : NaN;
        const reset = Number.isFinite(modelReset) ? modelReset : this.getEarliestResetTime()?.getTime();
        if (reset === undefined || reset <= now) { return ''; }
        return `$(clock) ${formatResetCountdownFromMs(reset - now)}`;
    }

    dispose(): void {
        if (this.resetCountdownTimer) {
            clearTimeout(this.resetCountdownTimer);
        }
        this.statusBarItem.dispose();
    }
}

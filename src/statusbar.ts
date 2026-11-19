import * as vscode from 'vscode';
import type { ContextUsage } from './tracker';
import type { GMSummary } from './gm/types';
import type { ModelPricing } from './pricing-store';
import { getQuotaPoolKey, localizeNeonPickerLabel, resolveModelId, type ModelConfig } from './models';
import { t, tBi, getLanguage, formatNumber } from './i18n';
import { summarizeQuotaReadings, type ModelQuotaGroup } from './model-quota';
import { formatResetAbsolute, formatResetCountdownFromMs } from './reset-time';
import { getDaysUntilBillingDay } from './billing-day';
import {
    computeTelemetrySummary,
    formatCachePercent,
    formatLatency,
    formatSpeed,
    type SessionTelemetrySummary,
    type TelemetryAggregate,
} from './telemetry-metrics';
import {
    getMaxQuotaRows, measureDisplayWidth, parseTooltipDensity, resolveEffectiveMode, truncateByDisplayWidth,
    type EffectiveMode, type TooltipDensity,
} from './tooltip-budget';
import {
    formatCreditExpiry, getContextReading, getContextRemaining, modelFamilyCountLabel, monitorBackendMessage,
    monitorStatusLabel, MONITOR_COMMAND, quotaPercentage, quotaResetLabel, resetCountdown,
    selectMonitorQuotaGroups, usableCount, type MonitorState, type MonitorStatus, type OverviewDestination,
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

function normalizeHoverLine(text: string): string {
    return text.replace(/[\x00-\x1F\x7F\u2028\u2029\u202A-\u202E\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatHoverText(text: string, maxWidth: number): string {
    return escapeMarkdown(truncateByDisplayWidth(normalizeHoverLine(text), maxWidth));
}

function resolveConfiguredDensity(value: unknown): TooltipDensity {
    if (value === 'detailed') { return 'full'; }
    return parseTooltipDensity(value);
}

function monitorStateIcon(state: MonitorState): string {
    switch (state) {
        case 'connecting': return '$(sync~spin)';
        case 'disconnected': return '$(debug-disconnect)';
        case 'empty': return '$(comment-discussion)';
        case 'idle': return '$(clock)';
        case 'active': return '$(pulse)';
    }
}

function hasTelemetryReading(agg: TelemetryAggregate): boolean {
    return agg.totalCalls > 0 && (
        (agg.latestGenTokPerSec ?? agg.weightedGenTokPerSec) !== null
        || (agg.avgTtftSeconds ?? agg.latestTtftSeconds) !== null
        || agg.tokenCacheHitRate !== null
    );
}

function formatSavingsUsd(usd: number | null | undefined): string | null {
    if (usd === null || usd === undefined || !Number.isFinite(usd) || usd < 0.0001) {
        return null;
    }
    if (usd >= 0.01) {
        return `$${usd.toFixed(2)}`;
    }
    if (usd >= 0.001) {
        return `$${usd.toFixed(3)}`;
    }
    return `$${usd.toFixed(4)}`;
}

function formatSignedPercentDelta(deltaPct: number | null | undefined): string {
    if (deltaPct === null || deltaPct === undefined || !Number.isFinite(deltaPct)) {
        return '';
    }
    const rounded = Math.round(deltaPct);
    const normalized = Object.is(rounded, -0) ? 0 : rounded;
    return `${normalized > 0 ? '+' : ''}${normalized}%`;
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
    private displayPrefs = {
        showContext: true,
        showQuota: true,
        showResetCountdown: true,
        showAiCredits: true,
        showSpeed: false,
        showCacheHit: false,
    };
    /** Cached AI Credits total (sum of current credit types; null = unknown / unreported). */
    private cachedCreditsTotal: number | null = null;
    /** Cached billing day (1-31, 0 = disabled). */
    private cachedBillingDay: number = 0;
    /** Cached GM telemetry summary (speed, TTFT, prompt cache). */
    private cachedTelemetry: SessionTelemetrySummary | null = null;
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
     * Compute and cache session/active telemetry summary for status bar and hover display.
     * Pass `null` to clear cleanly (e.g., on account switch or cold start).
     */
    setTelemetry(
        gmSummary: GMSummary | null,
        activeCascadeId?: string,
        customPricing?: Record<string, ModelPricing>,
    ): void {
        if (!gmSummary) {
            this.cachedTelemetry = null;
            return;
        }
        const summary = computeTelemetrySummary(gmSummary, { activeCascadeId, customPricing });
        this.cachedTelemetry = hasTelemetryReading(summary.primary) ? summary : null;
    }

    /**
     * Set status bar display preferences.
     */
    setDisplayPrefs(prefs: {
        showContext?: boolean;
        showQuota?: boolean;
        showResetCountdown?: boolean;
        showAiCredits?: boolean;
        showSpeed?: boolean;
        showCacheHit?: boolean;
    }): void {
        if (prefs.showContext !== undefined) { this.displayPrefs.showContext = prefs.showContext; }
        if (prefs.showQuota !== undefined) { this.displayPrefs.showQuota = prefs.showQuota; }
        if (prefs.showResetCountdown !== undefined) { this.displayPrefs.showResetCountdown = prefs.showResetCountdown; }
        if (prefs.showAiCredits !== undefined) { this.displayPrefs.showAiCredits = prefs.showAiCredits; }
        if (prefs.showSpeed !== undefined) { this.displayPrefs.showSpeed = prefs.showSpeed; }
        if (prefs.showCacheHit !== undefined) { this.displayPrefs.showCacheHit = prefs.showCacheHit; }
    }

    /**
     * Update cached AI Credits total for status bar display.
     * Pass `null` when credits are unknown/unreported so `0` is only shown when explicitly reported.
     */
    setCredits(total: number | null): void {
        this.cachedCreditsTotal = total !== null && usableCount(total) ? total : null;
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
        let quota = '';
        let reset = '';
        if (config) {
            const fraction = config.quotaInfo?.remainingFraction;
            if (this.displayPrefs.showQuota && usableCount(fraction) && fraction <= 1) {
                quota = `$(layers) ${Math.round(fraction * 100)}%`;
            }
            if (this.displayPrefs.showResetCountdown) {
                reset = this.formatResetCountdown(config.quotaInfo?.resetTime);
            }
        } else if (id) {
            // Bare family IDs (e.g. "gemini-4-neon") may map to a canonical pool without
            // resolving to a single effort config. Only fall back within that exact pool.
            const canonicalPool = getQuotaPoolKey(id);
            const poolKey = canonicalPool !== id && (canonicalPool === 'gemini' || canonicalPool === 'premium')
                ? canonicalPool : undefined;
            const group = poolKey
                ? selectMonitorQuotaGroups(this.cachedConfigs, id).find(g => g.pool === poolKey)
                : undefined;
            if (group) {
                if (this.displayPrefs.showQuota && group.minimum !== null) {
                    quota = `$(layers) ${quotaPercentage(group)}`;
                }
                if (this.displayPrefs.showResetCountdown && !group.resetDiffers && group.resetTime) {
                    reset = this.formatResetCountdown(group.resetTime);
                }
            }
        }
        const credits = this.displayPrefs.showAiCredits && this.cachedCreditsTotal !== null
            ? `$(zap) ${formatNumber(this.cachedCreditsTotal)}` : '';
        const primary = this.cachedTelemetry?.primary;
        const speed = primary ? (primary.latestGenTokPerSec ?? primary.weightedGenTokPerSec) : null;
        const speedSegment = this.displayPrefs.showSpeed && speed !== null && speed > 0
            ? `$(pulse) ${formatSpeed(speed)}` : '';
        const cacheLabel = getLanguage() === 'zh' ? '缓存' : 'Cache';
        const cacheSegment = this.displayPrefs.showCacheHit
            && primary
            && primary.totalPromptTokens > 0
            && primary.tokenCacheHitRate !== null
            ? `${cacheLabel} ${formatCachePercent(primary.tokenCacheHitRate)}` : '';
        return [quota, reset, credits, speedSegment, cacheSegment];
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
                .replace('$(pulse)', tBi('Speed', '生成速度'))
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
        const density = resolveConfiguredDensity(vscode.workspace.getConfiguration('antigravityContextMonitor')
            .get<string>('statusBar.tooltipDensity', 'auto'));
        const rawZoom = vscode.workspace.getConfiguration('window').get<number>('zoomLevel', 0);
        const zoom = Number.isFinite(rawZoom) ? rawZoom : 0;
        const lang = getLanguage();
        const mode = resolveEffectiveMode(density, zoom, groups.length, lang);
        const full = density === 'full';
        logDensityDiagOnce(zoom, density, mode, groups.length, lang);

        const stateIcon = monitorStateIcon(status.state);
        const header = mode === 'compact'
            ? `**${t('statusBar.name')}** · ${stateIcon} ${monitorStatusLabel(status.state)}`
            : `**${t('statusBar.name')}**  \n${stateIcon} ${monitorStatusLabel(status.state)}`;
        const sections = [header];

        if (status.state === 'disconnected') {
            sections.push(monitorBackendMessage(status.backendIssue));
        } else if (usage) {
            sections.push(this.buildHoverSession(usage, mode, full));
        }

        if (connected) {
            const telemetrySection = this.buildHoverTelemetry(mode, full);
            if (telemetrySection) {
                sections.push(telemetrySection);
            }

            sections.push(this.buildHoverQuotas(groups, usage?.model, mode, full));

            const planWidth = mode === 'compact' ? 24 : 30;
            const plan = [this.cachedPlanName, this.cachedTierName]
                .map(label => normalizeHoverLine(label))
                .filter((label, index, all) => label && all.indexOf(label) === index)
                .map(label => escapeMarkdown(truncateByDisplayWidth(label, planWidth))).join(' · ');
            const account = plan ? [`$(account) ${plan}`] : [];
            if (this.cachedCreditsTotal !== null) {
                const expiry = mode === 'compact' ? '' : ` · ${formatCreditExpiry(this.getDaysUntilRefresh())}`;
                account.push(`$(zap) ${tBi('AI credits', 'AI 积分')} · **${formatNumber(this.cachedCreditsTotal)}**${expiry}`);
            } else if (this.cachedBillingDay > 0 && mode !== 'compact') {
                account.push(`$(zap) ${tBi('AI credits', 'AI 积分')} · ${tBi('Not reported', '未上报')} · ${formatCreditExpiry(this.getDaysUntilRefresh())}`);
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
        const tooltip = new vscode.MarkdownString(sections.join('\n\n---\n\n'));
        tooltip.supportThemeIcons = true;
        tooltip.isTrusted = { enabledCommands: [MONITOR_COMMAND] };
        return tooltip;
    }

    private buildHoverSession(usage: ContextUsage, mode: EffectiveMode, full: boolean): string {
        const { used, limit, percent } = getContextReading(usage);
        const remaining = getContextRemaining(used, limit);
        const id = resolveModelId(usage.model) || usage.model;
        const name = localizeNeonPickerLabel(id, usage.modelDisplayName, getLanguage());
        const rawTitle = normalizeHoverLine(usage.title || '') || t('panel.currentSessionLabel');
        const title = escapeMarkdown(truncateByDisplayWidth(rawTitle, mode === 'compact' ? 36 : 50));
        const model = formatHoverText(name, mode === 'compact' ? 36 : 48);
        const accuracy = usage.isEstimated ? tBi('Estimated', '估算') : tBi('Measured', '实测');
        const lines = [`**${title}**`, [model, accuracy].filter(Boolean).join(' · ')];
        if (used !== null && limit !== null && percent !== null) {
            const number = full ? (n: number) => formatNumber(n) : formatTokenCount;
            if (mode === 'compact') {
                const remText = remaining
                    ? ` · ${tBi(`${remaining.percent.toFixed(1)}% left`, `剩余 ${remaining.percent.toFixed(1)}%`)}`
                    : '';
                lines.push(`$(pulse) ${tBi('Context', '上下文')} · **${number(used)} / ${number(limit)}** · ${percent.toFixed(1)}%${remText}`);
            } else {
                lines.push(`$(pulse) ${tBi('Context', '上下文')} · **${number(used)} / ${number(limit)}** · ${percent.toFixed(1)}%`);
                if (remaining) {
                    lines.push(`${tBi('Remaining', '可用余量')} · ${number(remaining.tokens)} (${remaining.percent.toFixed(1)}%)`);
                }
            }
        } else {
            lines.push(tBi('Context measurement unavailable', '暂无上下文计量'));
        }
        if (usage.compressionDetected) {
            const compression = calculateCompressionStats(usage);
            const label = t(usage.checkpointCompressionDrop > 0 ? 'tooltip.compressed' : 'tooltip.contextDecreased');
            const detail = compression
                ? ` · −${formatTokenCount(compression.dropTokens)}${mode !== 'compact' ? ` (${compression.dropPercent.toFixed(0)}%)` : ''}`
                : '';
            lines.push(`$(fold) ${label}${detail}`);
        }
        if (usage.hasGaps) {
            lines.push(`$(warning) ${tBi('Some steps are missing', '部分步骤缺失')}`);
        }
        if (percent !== null && percent > 100) {
            lines.push(`$(fold) ${tBi('Above the context limit', '已超过上下文上限')}`);
        }
        if (usage.imageGenerationIncomplete) {
            lines.push(`$(warning) ${tBi('Image workflow data is incomplete', '图片工作流数据不完整')}`);
        }
        if (full) {
            const metrics: Array<readonly [string, number]> = [
                [t('tooltip.modelOutput'), usage.totalOutputTokens],
                [t('tooltip.toolResults'), usage.totalToolCallOutputTokens],
                [t('tooltip.steps'), usage.stepCount],
                ...(usableCount(usage.imageGenStepCount) && usage.imageGenStepCount > 0
                    ? [[t('tooltip.imageGen'), usage.imageGenStepCount] as const] : []),
            ];
            const summary = metrics
                .filter(([, value]) => usableCount(value))
                .map(([label, value]) => `${label} ${formatNumber(value)}`)
                .join(' · ');
            if (summary) { lines.push(summary); }
            if (usage.lastModelUsage) {
                const last = usage.lastModelUsage;
                const source = t(usage.tokenUsageSource === 'planner' ? 'tooltip.lastModelUsage' : 'tooltip.lastCheckpoint');
                const snapshot: Array<readonly [string, number | undefined]> = [
                    [t('tooltip.input'), last.inputTokens],
                    [t('tooltip.output'), last.outputTokens],
                    [t('tooltip.cache'), last.cacheReadTokens],
                    ...(usableCount(last.cacheCreationTokens) && last.cacheCreationTokens > 0
                        ? [[tBi('Cache creation', '缓存创建'), last.cacheCreationTokens] as const] : []),
                ];
                const values = snapshot.flatMap(([label, value]) => usableCount(value) ? [`${label} ${formatNumber(value)}`] : []);
                if (values.length) { lines.push(`${source}  \n${values.join(' · ')}`); }
            }
        }
        return lines.filter(Boolean).join('  \n');
    }

    private buildHoverTelemetry(mode: EffectiveMode, full: boolean): string {
        const telemetry = this.cachedTelemetry;
        if (!telemetry) { return ''; }
        const primary = telemetry.primary;
        if (!hasTelemetryReading(primary)) { return ''; }

        const speed = primary.latestGenTokPerSec ?? primary.weightedGenTokPerSec;
        const ttft = primary.avgTtftSeconds ?? primary.latestTtftSeconds;
        const cacheRate = primary.tokenCacheHitRate;

        if (mode === 'compact') {
            const parts: string[] = [];
            if (speed !== null) {
                parts.push(`**${formatSpeed(speed)}**`);
            }
            if (ttft !== null) {
                parts.push(`${tBi('TTFT', '首字')} ${formatLatency(ttft)}`);
            }
            if (cacheRate !== null) {
                parts.push(`${tBi('Cache', '缓存')} ${formatCachePercent(cacheRate)}`);
            }
            if (parts.length === 0) { return ''; }
            return `$(pulse) **${tBi('Speed & Prompt Cache', '速度与提示词缓存')}** · ${parts.join(' · ')}`;
        }

        const scopeTag = telemetry.primaryScope === 'session'
            ? ` · ${tBi('Session', '会话汇总')}`
            : '';
        const lines: string[] = [`**${tBi('Speed & Prompt Cache', '速度与提示词缓存')}**${scopeTag}`];

        if (primary.latestGenTokPerSec !== null || primary.weightedGenTokPerSec !== null) {
            const speedParts: string[] = [];
            if (primary.latestGenTokPerSec !== null && primary.weightedGenTokPerSec !== null && primary.speedSampleCount > 1) {
                speedParts.push(`**${formatSpeed(primary.latestGenTokPerSec)}** ${tBi('latest', '最近')}`);
                speedParts.push(`${formatSpeed(primary.weightedGenTokPerSec)} ${tBi('avg', '均值')}`);
            } else if (primary.latestGenTokPerSec !== null) {
                speedParts.push(`**${formatSpeed(primary.latestGenTokPerSec)}**`);
            } else if (primary.weightedGenTokPerSec !== null) {
                speedParts.push(`**${formatSpeed(primary.weightedGenTokPerSec)}** ${tBi('avg', '均值')}`);
            }
            if (full && primary.medianGenTokPerSec !== null && primary.speedSampleCount >= 2) {
                speedParts.push(`p50 ${formatSpeed(primary.medianGenTokPerSec)}`);
            }
            if (primary.hasThinking && primary.weightedVisibleTokPerSec !== null) {
                speedParts.push(`${tBi('resp', '可见')} ${formatSpeed(primary.weightedVisibleTokPerSec)}`);
            }
            lines.push(`$(pulse) ${t('telemetry.speed')} · ${speedParts.join(' · ')}`);
        }

        if (ttft !== null) {
            const ttftParts: string[] = [];
            if (primary.avgTtftSeconds !== null && primary.ttftSampleCount > 1) {
                ttftParts.push(`**${formatLatency(primary.avgTtftSeconds)}** ${tBi('avg', '均值')}`);
            } else {
                ttftParts.push(`**${formatLatency(ttft)}**`);
            }
            if (full && primary.medianTtftSeconds !== null && primary.ttftSampleCount >= 2) {
                ttftParts.push(`p50 ${formatLatency(primary.medianTtftSeconds)}`);
            }
            let ttftLine = `$(clock) ${t('telemetry.ttft')} · ${ttftParts.join(' · ')}`;
            if (
                primary.cachedTtftCount >= 1
                && primary.uncachedTtftCount >= 1
                && primary.cachedAvgTtftSeconds !== null
                && primary.uncachedAvgTtftSeconds !== null
            ) {
                const delta = formatSignedPercentDelta(primary.ttftCacheDeltaPct);
                const deltaSuffix = delta ? ` · ${delta}` : '';
                ttftLine += ` (${formatLatency(primary.cachedAvgTtftSeconds)} ${tBi('cached', '命中')} vs ${formatLatency(primary.uncachedAvgTtftSeconds)} ${tBi('uncached', '未命中')}${deltaSuffix})`;
            }
            lines.push(ttftLine);
        }

        if (cacheRate !== null) {
            const savings = formatSavingsUsd(primary.estCacheSavingsUsd);
            const cacheMeta: string[] = [
                `${formatTokenCount(primary.totalCacheReadTokens)} / ${formatTokenCount(primary.totalPromptTokens)} tokens`,
                `${primary.cachedCallCount}/${primary.totalCalls} ${tBi(primary.totalCalls === 1 ? 'call' : 'calls', '次调用')}`,
            ];
            if (full && primary.totalCacheCreationTokens > 0) {
                cacheMeta.push(`${tBi('write', '写入')} ${formatTokenCount(primary.totalCacheCreationTokens)}`);
            }
            if (savings) {
                cacheMeta.push(tBi(`est. -${savings}`, `约省 ${savings}`));
            }
            lines.push(`$(database) ${t('telemetry.promptCache')} · **${formatCachePercent(cacheRate)}** (${cacheMeta.join(' · ')})`);
        }

        return lines.length > 1 ? lines.join('  \n') : '';
    }

    private buildHoverQuotas(
        groups: readonly ModelQuotaGroup[], currentModel: string | undefined, mode: EffectiveMode, full: boolean,
    ): string {
        const maxPools = getMaxQuotaRows(full ? 'full' : 'auto', mode);
        const shown = groups.slice(0, maxPools);
        const now = Date.now();
        const blocks: string[] = [`**${tBi('Quota remaining', '剩余配额')}**`];
        const activeId = currentModel ? resolveModelId(currentModel) || currentModel : undefined;
        const poolBlocks: string[] = [];
        for (const group of shown) {
            const label = formatHoverText(group.label, mode === 'compact' ? 24 : 32);
            const percent = quotaPercentage(group);
            const reset = quotaResetLabel(group, now, true);
            const count = group.pool ? ` · ${modelFamilyCountLabel(group.members.length)}` : '';
            const partial = (group.missingQuota && group.minimum !== null) || (group.missingReset && group.resetTime !== null)
                ? ` · ${tBi('Partial data', '数据不完整')}` : '';
            const poolLines = [`$(layers) **${label}** · **${percent}** · ${reset}${count}${partial}`];
            if (group.pool && mode !== 'compact') {
                poolLines.push(...this.buildHoverQuotaFamilies(group, activeId, now, full));
            }
            poolBlocks.push(poolLines.join('  \n'));
        }
        if (groups.length === 0) {
            blocks.push(tBi('Waiting for quota data', '等待配额数据'));
        } else if (mode === 'compact') {
            blocks.push(...poolBlocks);
        } else {
            blocks.push(poolBlocks.join('\n\n'));
        }
        const footer: string[] = [];
        if (groups.length > shown.length) {
            const hidden = groups.length - shown.length;
            footer.push(tBi(`+${hidden} quota ${hidden === 1 ? 'pool' : 'pools'} in Models`, `模型页另有 ${hidden} 个配额池`));
        }
        const resets = new Set(groups.flatMap(group => group.readings.flatMap(reading =>
            reading.resetAt !== null && reading.resetAt > now ? [reading.resetAt] : [])));
        if (mode !== 'compact' && resets.size > 1) {
            const first = Math.min(...resets);
            const date = formatResetAbsolute(new Date(first).toISOString());
            footer.push(`$(clock) ${tBi('Next reset', '最近重置')} · ${resetCountdown(first, now)} · ${date}`);
        }
        if (footer.length) { blocks.push(footer.join('  \n')); }
        return mode === 'compact' ? blocks.join('  \n') : blocks.join('\n\n');
    }

    private buildHoverQuotaFamilies(group: ModelQuotaGroup, activeId: string | undefined, now: number, full: boolean): string[] {
        // A pool owns the allowance. Each base-model family appears once, regardless of effort.
        const isActive = (member: ModelQuotaGroup['members'][number]) => activeId !== undefined
            && member.readings.some(reading => reading.model === activeId);
        const members = [...group.members].sort((a, b) => Number(isActive(b)) - Number(isActive(a)));
        const visible = members.slice(0, full ? Infinity : 8);
        const lines: string[] = [];
        let line = '';
        let widthText = '';
        for (const member of visible) {
            const name = truncateByDisplayWidth(normalizeHoverLine(member.label), 36);
            const summary = summarizeQuotaReadings(member.readings);
            const band = quotaPercentage(summary);
            const extra = `${group.quotaDiffers || band === '—' ? ` ${band}` : ''}${group.resetDiffers
                ? ` (${quotaResetLabel(summary, now, full)})` : ''}`;
            const text = isActive(member) ? `**${escapeMarkdown(name)}**${escapeMarkdown(extra)}`
                : escapeMarkdown(name + extra);
            const combined = widthText ? `${widthText} · ${name}${extra}` : name + extra;
            if (line && measureDisplayWidth(combined) > 58) {
                lines.push(`› ${line}`);
                line = text;
                widthText = name + extra;
            } else {
                line = line ? `${line} · ${text}` : text;
                widthText = combined;
            }
        }
        if (line) { lines.push(`› ${line}`); }
        const hidden = members.length - visible.length;
        if (hidden) { lines.push(`› ${tBi(`+${hidden} more ${hidden === 1 ? 'model' : 'models'}`, `另有 ${hidden} 个模型`)}`); }
        return lines;
    }

    private formatResetCountdown(resetTime: string | undefined): string {
        if (!resetTime) { return ''; }
        const reset = Date.parse(resetTime);
        const now = Date.now();
        if (!Number.isFinite(reset) || reset <= now) { return ''; }
        return `$(clock) ${formatResetCountdownFromMs(reset - now)}`;
    }

    dispose(): void {
        if (this.resetCountdownTimer) {
            clearTimeout(this.resetCountdownTimer);
        }
        this.statusBarItem.dispose();
    }
}

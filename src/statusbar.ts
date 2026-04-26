import * as vscode from 'vscode';
import { ContextUsage } from './tracker';
import { ModelConfig } from './models';
import { t, tBi, getLanguage } from './i18n';
import { formatResetAbsolute, formatResetContext, formatResetCountdownFromMs } from './reset-time';

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
function escapeMarkdown(text: string): string {
    return text.replace(/([|*_~`\[\]\\#<>])/g, '\\$1');
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
        const currentInput = usage.lastModelUsage?.inputTokens;
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
    if (usagePercent >= 95) { return 'critical'; }
    if (usagePercent >= 80) { return 'error'; }
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

// ─── Status Bar Manager ───────────────────────────────────────────────────────

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private cachedConfigs: ModelConfig[] = [];
    private cachedPlanName: string = '';
    private cachedTierName: string = '';
    /** User-configurable compression warning threshold (tokens). */
    private warningThreshold: number = 150_000;
    /** Timer ID for reset countdown. */
    private resetCountdownTimer: NodeJS.Timeout | undefined;
    /** Status bar display preferences. */
    private displayPrefs = { showContext: true, showQuota: true, showResetCountdown: true };
    /** Last active model ID for tracking reset countdown. */
    private lastActiveModel: string = '';

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'antigravity-context-monitor.showDetails';
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
     * Set the compression warning threshold from user settings.
     */
    setWarningThreshold(threshold: number): void {
        this.warningThreshold = Math.max(10_000, threshold);
    }

    /**
     * Set status bar display preferences.
     */
    setDisplayPrefs(prefs: { showContext?: boolean; showQuota?: boolean; showResetCountdown?: boolean }): void {
        if (prefs.showContext !== undefined) { this.displayPrefs.showContext = prefs.showContext; }
        if (prefs.showQuota !== undefined) { this.displayPrefs.showQuota = prefs.showQuota; }
        if (prefs.showResetCountdown !== undefined) { this.displayPrefs.showResetCountdown = prefs.showResetCountdown; }
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

    showInitializing(): void {
        this.statusBarItem.text = '$(sync~spin) Context...';
        this.statusBarItem.tooltip = `Antigravity Context Monitor: ${t('statusBar.initializing')}`;
        this.statusBarItem.backgroundColor = undefined;
    }

    showDisconnected(message: string): void {
        this.statusBarItem.text = `$(debug-disconnect) ${t('statusBar.disconnectedLabel')}`;
        this.statusBarItem.tooltip = `Antigravity Context Monitor: ${message}`;
        this.statusBarItem.backgroundColor = undefined;
    }

    showNoConversation(limitStr: string = '1M'): void {
        this.statusBarItem.text = `$(comment-discussion) 0k/${limitStr}, 0.0%`;
        const md = new vscode.MarkdownString(
            `Antigravity Context Monitor: ${t('statusBar.noConversationTooltip')}  \n——————————  \n$(link-external) **${t('statusBar.clickToView')}**`,
            false
        );
        md.supportThemeIcons = true;
        this.statusBarItem.tooltip = md;
        this.statusBarItem.backgroundColor = undefined;
    }

    showIdle(limitStr: string = '1M'): void {
        this.statusBarItem.text = `$(clock) 0k/${limitStr}, 0.0%`;
        const lines: string[] = [
            `Antigravity Context Monitor: ${t('statusBar.idle')}`,
            t('statusBar.idleDescription'),
        ];
        lines.push(...this.buildQuotaLines());
        lines.push(`——————————`);
        lines.push(`$(link-external) **${t('statusBar.clickToView')}**`);
        const md = new vscode.MarkdownString(lines.join('  \n'), false);
        md.supportThemeIcons = true;
        this.statusBarItem.tooltip = md;
        this.statusBarItem.backgroundColor = undefined;
    }

    /**
     * Update the status bar with current context usage data.
     */
    update(usage: ContextUsage): void {
        const usedStr = formatTokenCount(usage.contextUsed);
        const limitStr = formatContextLimit(usage.contextLimit);

        const isCompressing = usage.usagePercent > 100;
        const displayPercent = isCompressing
            ? '~100'
            : usage.usagePercent.toFixed(1).replace(/\.0$/, '');
        const compressIcon = isCompressing ? ' 🗜' : '';

        // Warning severity is based on the compression threshold, not the model limit
        const warningPercent = this.warningThreshold > 0
            ? (usage.contextUsed / this.warningThreshold) * 100
            : usage.usagePercent;
        const severity = getSeverity(warningPercent);
        const icon = getSeverityIcon(severity);
        const gapsIndicator = usage.hasGaps ? ' ⚠️' : '';

        // Current model quota indicator (🟢85%)
        const quotaSuffix = this.displayPrefs.showQuota ? this.formatQuotaIndicator(usage.model) : '';

        // Add reset countdown to status bar text (tracks current model)
        const resetSuffix = this.displayPrefs.showResetCountdown ? this.formatResetCountdown(usage.model) : '';

        // Build status bar text based on display preferences
        const contextPart = this.displayPrefs.showContext
            ? `${usedStr}/${limitStr}, ${displayPercent}%${compressIcon}${gapsIndicator}`
            : '';

        // If nothing is shown, show at least the icon
        const parts = [contextPart, quotaSuffix.trim(), resetSuffix.trim()].filter(Boolean);
        this.statusBarItem.text = `${icon} ${parts.join(' ')}`;
        this.statusBarItem.backgroundColor = getSeverityColor(severity);

        // Build detailed tooltip
        const remaining = Math.max(0, usage.contextLimit - usage.contextUsed);
        const compressionStats = calculateCompressionStats(usage);
        const safeTitle = escapeMarkdown(usage.title || usage.cascadeId.substring(0, 8));
        const safeModelName = escapeMarkdown(usage.modelDisplayName);
        const tokenUnit = tBi('tokens', '令牌');

        const lines = [
            `📊 ${t('tooltip.title')}`,
            `——————————`,
            `🤖 ${t('tooltip.model')}: ${safeModelName}`,
            `📝 ${t('tooltip.session')}: ${safeTitle}`,
            `——————————`,
            `📥 ${t('tooltip.totalContextUsed')}:`,
            `     ${usage.contextUsed.toLocaleString()} ${tokenUnit}`,
            `📤 ${t('tooltip.modelOutput')}: ${usage.totalOutputTokens.toLocaleString()} ${tokenUnit}`,
            `🔧 ${t('tooltip.toolResults')}: ${usage.totalToolCallOutputTokens.toLocaleString()} ${tokenUnit}`,
            `📦 ${t('tooltip.limit')}: ${usage.contextLimit.toLocaleString()} ${tokenUnit}`,
            `📊 ${t('tooltip.usage')}: ${usage.usagePercent.toFixed(1)}%`,
        ];

        if (isCompressing) {
            lines.push(`🗜 ${t('tooltip.compressing')}`);
            lines.push(`💡 ${t('tooltip.compressingHint')}`);
        } else if (usage.compressionDetected) {
            lines.push(`🗜 ${t('tooltip.compressed')}`);
            if (usage.previousContextUsed !== undefined) {
                lines.push(`   ${t('tooltip.before')}: ${usage.previousContextUsed.toLocaleString()} ${tokenUnit}`);
                lines.push(`   ${t('tooltip.after')}: ${usage.contextUsed.toLocaleString()} ${tokenUnit}`);
            }
            if (compressionStats) {
                const sourceLabel = compressionStats.source === 'context'
                    ? t('tooltip.contextDrop')
                    : t('tooltip.checkpointDrop');
                lines.push(
                    `   ${sourceLabel}: ${compressionStats.dropTokens.toLocaleString()} ${tokenUnit} ` +
                    `(${compressionStats.dropPercent.toFixed(1)}%)`
                );
            }
        } else {
            lines.push(`📐 ${t('tooltip.remaining')}: ${remaining.toLocaleString()} ${tokenUnit}`);
        }

        if (usage.hasGaps) {
            lines.push(`⚠️ ${t('tooltip.dataIncomplete')}`);
        }

        lines.push(`🔢 ${t('tooltip.steps')}: ${usage.stepCount}`);

        if (usage.imageGenStepCount > 0) {
            lines.push(`📷 ${t('tooltip.imageGen')}: ${usage.imageGenStepCount} ${t('tooltip.imageGenSteps')}`);
        }

        if (usage.estimatedDeltaSinceCheckpoint > 0 && usage.lastModelUsage) {
            lines.push(`📏 ${t('tooltip.estDelta')}: +${usage.estimatedDeltaSinceCheckpoint.toLocaleString()} ${tokenUnit} (${t('tooltip.sinceCheckpoint')})`);
        }

        lines.push(`——————————`);

        if (usage.lastModelUsage) {
            lines.push(`📎 ${t('tooltip.lastCheckpoint')}:`);
            lines.push(`  ${t('tooltip.input')}: ${usage.lastModelUsage.inputTokens.toLocaleString()}`);
            lines.push(`  ${t('tooltip.output')}: ${usage.lastModelUsage.outputTokens.toLocaleString()}`);
            if (usage.lastModelUsage.cacheReadTokens > 0) {
                lines.push(`  ${t('tooltip.cache')}: ${usage.lastModelUsage.cacheReadTokens.toLocaleString()}`);
            }
        }

        lines.push(`——————————`);

        lines.push(...this.buildQuotaLines());

        lines.push(`——————————`);
        lines.push(`$(link-external) **${t('statusBar.clickToView')}**`);
        const md = new vscode.MarkdownString(lines.join('  \n'), false);
        md.supportThemeIcons = true;
        this.statusBarItem.tooltip = md;
    }

    /**
     * Build plan info + model quota lines for tooltip (shared by update & showIdle).
     */
    private buildQuotaLines(): string[] {
        const result: string[] = [];

        if (this.cachedPlanName) {
            result.push(`——————————`);
            const planStr = this.cachedTierName && this.cachedTierName !== this.cachedPlanName
                ? `**${escapeMarkdown(this.cachedPlanName)}** · **${escapeMarkdown(this.cachedTierName)}**`
                : `**${escapeMarkdown(this.cachedPlanName)}**`;
            result.push(`👤 ${tBi('Plan', '计划')}: ${planStr}`);
        }

        const quotaModels = this.cachedConfigs.filter(c => c.quotaInfo);
        if (quotaModels.length > 0) {
            result.push(`——————————`);
            result.push(`⚡ ${tBi('Model Quota', '模型配额')}`);
            result.push('');
            const now = Date.now();
            const header = `| ${tBi('Model', '模型')} | % | ${tBi('Reset', '重置')} |`;
            const sep = '|:--|--:|--:|';
            const rows: string[] = [];
            for (const c of quotaModels) {
                const qi = c.quotaInfo!;
                const pct = Math.round(qi.remainingFraction * 100);
                const bar = pct >= 80 ? '🟢' : pct > 20 ? '🟡' : '🔴';
                let resetStr = '—';
                if (qi.resetTime) {
                    const resetDate = new Date(qi.resetTime);
                    const diffMs = resetDate.getTime() - now;
                    if (diffMs > 0) {
                        resetStr = formatResetContext(qi.resetTime, { nowMs: now });
                    }
                }
                rows.push(`| ${bar} ${escapeMarkdown(c.label)} | ${pct}% | 🔄 ${resetStr} |`);
            }
            result.push(header);
            result.push(sep);
            result.push(...rows);
            result.push('');

            // Show earliest reset as a standalone line for quick reading
            const earliest = this.getEarliestResetTime();
            if (earliest) {
                const earliestIso = earliest.toISOString();
                result.push(
                    `🔔 ${tBi('Earliest reset at', '最近重置时间为')}: **${formatResetAbsolute(earliestIso, { includeSeconds: true })}** ` +
                    `(${formatResetCountdownFromMs(earliest.getTime() - Date.now())})`
                );
            }

            // Show current model's reset time if available
            if (this.lastActiveModel) {
                const currentConfig = this.cachedConfigs.find(c => c.model === this.lastActiveModel);
                if (currentConfig?.quotaInfo?.resetTime) {
                    const resetDate = new Date(currentConfig.quotaInfo.resetTime);
                    if (resetDate.getTime() > Date.now()) {
                        result.push(
                            `⏳ ${tBi('Current model resets at', '当前模型重置于')}: ` +
                            `**${formatResetAbsolute(currentConfig.quotaInfo.resetTime, { includeSeconds: true })}** ` +
                            `(${formatResetCountdownFromMs(resetDate.getTime() - Date.now())}, ${escapeMarkdown(currentConfig.label)})`
                        );
                    }
                }
            }
        }

        // Show compression warning threshold
        result.push(`——————————`);
        result.push(`🎯 ${tBi('Compression warning', '压缩警告')}: **${formatTokenCount(this.warningThreshold)}**`);

        return result;
    }

    /**
     * Show detailed info in a QuickPick panel.
     */
    async showDetailsPanel(
        currentUsage: ContextUsage | null,
        allTrajectoryUsages: ContextUsage[]
    ): Promise<void> {
        const items: vscode.QuickPickItem[] = [];

        if (!currentUsage && allTrajectoryUsages.length === 0) {
            items.push({
                label: `$(info) ${t('panel.noData')}`,
                description: '',
            });
        }

        if (currentUsage) {
            items.push({
                label: `$(star) ${t('panel.currentSession')}`,
                kind: vscode.QuickPickItemKind.Separator
            });

            const remaining = Math.max(0, currentUsage.contextLimit - currentUsage.contextUsed);
            const compressionStats = calculateCompressionStats(currentUsage);
            const sourceTag = currentUsage.isEstimated
                ? `[${t('panel.estimated')}]`
                : `[${t('panel.preciseShort')}]`;
            const compressTag = currentUsage.compressionDetected
                ? ` [${t('panel.compressed')}]`
                : (currentUsage.usagePercent > 100 ? ` [${t('panel.compressing')}]` : '');
            const imageTag = currentUsage.imageGenStepCount > 0 ? ` [📷×${currentUsage.imageGenStepCount}]` : '';
            const gapsTag = currentUsage.hasGaps ? ` [⚠️${t('panel.gaps')}]` : '';
            const tokenUnit = tBi('tokens', '令牌');
            const compressionSource = compressionStats
                ? (compressionStats.source === 'context' ? t('tooltip.contextDrop') : t('tooltip.checkpointDrop'))
                : '';
            const compDetail = compressionStats
                ? `${t('panel.compression')}: ${compressionStats.dropTokens.toLocaleString()} ${tokenUnit} ` +
                `(${compressionStats.dropPercent.toFixed(1)}%, ${compressionSource})`
                : null;

            items.push({
                label: `$(pulse) ${currentUsage.title || t('panel.currentSessionLabel')}`,
                description: `${currentUsage.modelDisplayName}`,
                detail: [
                    `${sourceTag}${compressTag}${imageTag}${gapsTag}`,
                    `${t('panel.used')}: ${currentUsage.contextUsed.toLocaleString()} ${tokenUnit} | ${t('panel.limitLabel')}: ${currentUsage.contextLimit.toLocaleString()} ${tokenUnit}`,
                    `${t('panel.modelOut')}: ${currentUsage.totalOutputTokens.toLocaleString()} | ${t('panel.toolOut')}: ${currentUsage.totalToolCallOutputTokens.toLocaleString()}`,
                    `${t('panel.remaining')}: ${remaining.toLocaleString()} ${tokenUnit} | ${t('panel.usageLabel')}: ${currentUsage.usagePercent.toFixed(1)}% | ${t('panel.stepsLabel')}: ${currentUsage.stepCount}`,
                    ...(compDetail ? [compDetail] : [])
                ].join('\n')
            });
        }

        const others = allTrajectoryUsages.filter(u => u.cascadeId !== currentUsage?.cascadeId);
        if (others.length > 0) {
            items.push({
                label: `$(list-tree) ${t('panel.otherSessions')}`,
                kind: vscode.QuickPickItemKind.Separator
            });

            for (const usage of others.slice(0, 10)) {
                const remaining = Math.max(0, usage.contextLimit - usage.contextUsed);
                const compressionStats = calculateCompressionStats(usage);
                const sourceTag = usage.isEstimated ? t('panel.estimated') : t('panel.preciseShort');
                const imageTag = usage.imageGenStepCount > 0 ? ` 📷×${usage.imageGenStepCount}` : '';
                const compTag = usage.compressionDetected ? ' 🗜' : '';
                const compDetail = compressionStats
                    ? `${t('panel.comp')}: -${formatTokenCount(compressionStats.dropTokens)} (${compressionStats.dropPercent.toFixed(1)}%)`
                    : null;
                items.push({
                    label: `$(comment) ${usage.title || usage.cascadeId.substring(0, 8)}`,
                    description: `${usage.modelDisplayName} | ${usage.usagePercent.toFixed(1)}%${imageTag}${compTag}`,
                    detail: [
                        `[${sourceTag}] ${t('panel.used')}: ${formatTokenCount(usage.contextUsed)} / ${formatContextLimit(usage.contextLimit)}`,
                        `${t('panel.modelOut')}: ${formatTokenCount(usage.totalOutputTokens)} | ${t('panel.toolOut')}: ${formatTokenCount(usage.totalToolCallOutputTokens)}`,
                        `${t('panel.remaining')}: ${formatTokenCount(remaining)} | ${usage.stepCount} ${t('panel.stepsLabel')}`,
                        ...(compDetail ? [compDetail] : [])
                    ].join('\n')
                });
            }
        }

        // ─── Language Switch Entry ────────────────────────────────────────
        const langLabels: Record<string, string> = {
            zh: '中文',
            en: 'English',
            both: tBi('Bilingual', '双语'),
        };
        items.push({
            label: `$(gear) ${tBi('Settings', '设置')}`,
            kind: vscode.QuickPickItemKind.Separator
        });
        items.push({
            label: `$(globe) ${t('command.switchLanguage')}`,
            description: `[${langLabels[getLanguage()] || ''}]`,
        });

        const picked = await vscode.window.showQuickPick(items, {
            title: `📊 ${t('panel.title')}`,
            placeHolder: t('panel.placeholder'),
            canPickMany: false
        });

        // If user picked the language switch item, open the language picker
        const switchLabel = `$(globe) ${t('command.switchLanguage')}`;
        if (picked && picked.label === switchLabel) {
            vscode.commands.executeCommand('antigravity-context-monitor.switchLanguage');
        }
    }

    /**
     * Format a compact quota indicator for the current model.
     * Returns e.g. " 🟢85%" or "" if no quota info available.
     */
    private formatQuotaIndicator(modelId: string): string {
        const config = this.cachedConfigs.find(c => c.model === modelId);
        if (!config?.quotaInfo) { return ''; }
        const pct = Math.round(config.quotaInfo.remainingFraction * 100);
        const dot = pct >= 80 ? '🟢' : pct > 20 ? '🟡' : '🔴';
        return ` ${dot}${pct}%`;
    }

    /**
     * Format a compact reset countdown string for StatusBar text.
     * Tracks the specified model's reset time (current active model).
     */
    private formatResetCountdown(modelId?: string): string {
        let resetDate: Date | null = null;

        // Try to find the specific model's reset time
        if (modelId) {
            this.lastActiveModel = modelId;
            const config = this.cachedConfigs.find(c => c.model === modelId);
            if (config?.quotaInfo?.resetTime) {
                resetDate = new Date(config.quotaInfo.resetTime);
            }
        }

        // Fallback to earliest if current model has no reset info
        if (!resetDate) {
            resetDate = this.getEarliestResetTime();
        }

        if (!resetDate) { return ''; }
        const diffMs = resetDate.getTime() - Date.now();
        if (diffMs <= 0) { return ''; }
        return ` ⏳${formatResetCountdownFromMs(diffMs)}`;
    }

    dispose(): void {
        if (this.resetCountdownTimer) {
            clearTimeout(this.resetCountdownTimer);
        }
        this.statusBarItem.dispose();
    }
}


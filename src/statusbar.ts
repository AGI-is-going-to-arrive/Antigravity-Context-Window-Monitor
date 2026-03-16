import * as vscode from 'vscode';
import { ContextUsage } from './tracker';
import { ModelConfig } from './models';
import { t, tBi, getLanguage } from './i18n';

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
    }

    /**
     * Cache plan name for tooltip display.
     */
    setPlanName(planName: string, tierName?: string): void {
        this.cachedPlanName = planName;
        if (tierName) { this.cachedTierName = tierName; }
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
            `Antigravity Context Monitor: ${t('statusBar.noConversationTooltip')}  \n${t('statusBar.clickToView')}`,
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
        lines.push(t('statusBar.clickToView'));
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

        const severity = getSeverity(usage.usagePercent);
        const icon = getSeverityIcon(severity);
        const gapsIndicator = usage.hasGaps ? ' ⚠️' : '';

        this.statusBarItem.text = `${icon} ${usedStr}/${limitStr}, ${displayPercent}%${compressIcon}${gapsIndicator}`;
        this.statusBarItem.backgroundColor = getSeverityColor(severity);

        // Build detailed tooltip
        const dataSourceLabel = usage.isEstimated
            ? `⚠️ ${t('tooltip.estimated')}`
            : `✅ ${t('tooltip.precise')}`;
        const remaining = Math.max(0, usage.contextLimit - usage.contextUsed);
        const compressionStats = calculateCompressionStats(usage);
        const safeTitle = escapeMarkdown(usage.title || usage.cascadeId.substring(0, 8));
        const safeModelName = escapeMarkdown(usage.modelDisplayName);

        const lines = [
            `📊 ${t('tooltip.title')}`,
            `——————————`,
            `🤖 ${t('tooltip.model')}: ${safeModelName}`,
            `📝 ${t('tooltip.session')}: ${safeTitle}`,
            `——————————`,
            `📥 ${t('tooltip.totalContextUsed')}:`,
            `     ${usage.contextUsed.toLocaleString()} tokens`,
            `📤 ${t('tooltip.modelOutput')}: ${usage.totalOutputTokens.toLocaleString()} tokens`,
            `🔧 ${t('tooltip.toolResults')}: ${usage.totalToolCallOutputTokens.toLocaleString()} tokens`,
            `📦 ${t('tooltip.limit')}: ${usage.contextLimit.toLocaleString()} tokens`,
            `📊 ${t('tooltip.usage')}: ${usage.usagePercent.toFixed(1)}%`,
        ];

        if (isCompressing) {
            lines.push(`🗜 ${t('tooltip.compressing')}`);
            lines.push(`💡 ${t('tooltip.compressingHint')}`);
        } else if (usage.compressionDetected) {
            lines.push(`🗜 ${t('tooltip.compressed')}`);
            if (usage.previousContextUsed !== undefined) {
                lines.push(`   ${t('tooltip.before')}: ${usage.previousContextUsed.toLocaleString()} tokens`);
                lines.push(`   ${t('tooltip.after')}: ${usage.contextUsed.toLocaleString()} tokens`);
            }
            if (compressionStats) {
                const sourceLabel = compressionStats.source === 'context'
                    ? t('tooltip.contextDrop')
                    : t('tooltip.checkpointDrop');
                lines.push(
                    `   ${sourceLabel}: ${compressionStats.dropTokens.toLocaleString()} tokens ` +
                    `(${compressionStats.dropPercent.toFixed(1)}%)`
                );
            }
        } else {
            lines.push(`📐 ${t('tooltip.remaining')}: ${remaining.toLocaleString()} tokens`);
        }

        if (usage.hasGaps) {
            lines.push(`⚠️ ${t('tooltip.dataIncomplete')}`);
        }

        lines.push(`🔢 ${t('tooltip.steps')}: ${usage.stepCount}`);

        if (usage.imageGenStepCount > 0) {
            lines.push(`📷 ${t('tooltip.imageGen')}: ${usage.imageGenStepCount} ${t('tooltip.imageGenSteps')}`);
        }

        if (usage.estimatedDeltaSinceCheckpoint > 0 && usage.lastModelUsage) {
            lines.push(`📏 ${t('tooltip.estDelta')}: +${usage.estimatedDeltaSinceCheckpoint.toLocaleString()} tokens (${t('tooltip.sinceCheckpoint')})`);
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
        lines.push(`${dataSourceLabel}`);

        lines.push(...this.buildQuotaLines());

        lines.push(`${t('statusBar.clickToView')}`);
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
                const bar = pct >= 60 ? '🟢' : pct >= 40 ? '🟡' : '🔴';
                let resetStr = '—';
                if (qi.resetTime) {
                    const diffMs = new Date(qi.resetTime).getTime() - now;
                    if (diffMs > 0) {
                        const h = Math.floor(diffMs / 3600000);
                        const m = Math.floor((diffMs % 3600000) / 60000);
                        resetStr = `${h}h${m}m`;
                    }
                }
                rows.push(`| ${bar} ${escapeMarkdown(c.label)} | ${pct}% | 🔄 ${resetStr} |`);
            }
            result.push(header);
            result.push(sep);
            result.push(...rows);
            result.push('');
        }

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
            const compDetail = compressionStats
                ? `${t('panel.compression')}: ${compressionStats.dropTokens.toLocaleString()} tokens ` +
                `(${compressionStats.dropPercent.toFixed(1)}%, ${compressionStats.source})`
                : null;

            items.push({
                label: `$(pulse) ${currentUsage.title || t('panel.currentSessionLabel')}`,
                description: `${currentUsage.modelDisplayName}`,
                detail: [
                    `${sourceTag}${compressTag}${imageTag}${gapsTag}`,
                    `${t('panel.used')}: ${currentUsage.contextUsed.toLocaleString()} tokens | ${t('panel.limitLabel')}: ${currentUsage.contextLimit.toLocaleString()} tokens`,
                    `${t('panel.modelOut')}: ${currentUsage.totalOutputTokens.toLocaleString()} | ${t('panel.toolOut')}: ${currentUsage.totalToolCallOutputTokens.toLocaleString()}`,
                    `${t('panel.remaining')}: ${remaining.toLocaleString()} tokens | ${t('panel.usageLabel')}: ${currentUsage.usagePercent.toFixed(1)}% | ${t('panel.stepsLabel')}: ${currentUsage.stepCount}`,
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

    dispose(): void {
        this.statusBarItem.dispose();
    }
}

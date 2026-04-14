"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusBarManager = void 0;
exports.formatTokenCount = formatTokenCount;
exports.formatContextLimit = formatContextLimit;
exports.calculateCompressionStats = calculateCompressionStats;
const vscode = __importStar(require("vscode"));
const i18n_1 = require("./i18n");
const reset_time_1 = require("./reset-time");
// ─── Token Formatting ─────────────────────────────────────────────────────────
/**
 * Format a token count for display (e.g. 45231 → "45.2k", 1500000 → "1.5M").
 */
function formatTokenCount(count) {
    return formatTokenValue(count);
}
/**
 * Format a context limit for display (e.g. 2000000 → "2M").
 */
function formatContextLimit(limit) {
    return formatTokenValue(limit);
}
/**
 * Unified token/limit formatter.
 * - ≥ 1M → "1.5M"
 * - ≥ 1K → "45.2k"
 * - < 1K → raw number
 */
function formatTokenValue(value) {
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
function escapeMarkdown(text) {
    return text.replace(/([|*_~`\[\]\\#<>])/g, '\\$1');
}
/**
 * Calculate compression amount for UI display.
 */
function calculateCompressionStats(usage) {
    if (!usage.compressionDetected) {
        return null;
    }
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
function getSeverity(usagePercent) {
    if (usagePercent >= 95) {
        return 'critical';
    }
    if (usagePercent >= 80) {
        return 'error';
    }
    if (usagePercent >= 50) {
        return 'warning';
    }
    return 'ok';
}
function getSeverityColor(severity) {
    switch (severity) {
        case 'critical': return new vscode.ThemeColor('statusBarItem.errorBackground');
        case 'error': return new vscode.ThemeColor('statusBarItem.errorBackground');
        case 'warning': return new vscode.ThemeColor('statusBarItem.warningBackground');
        default: return undefined;
    }
}
function getSeverityIcon(severity) {
    switch (severity) {
        case 'critical': return '$(zap)';
        case 'error': return '$(warning)';
        case 'warning': return '$(info)';
        default: return '$(pulse)';
    }
}
// ─── Status Bar Manager ───────────────────────────────────────────────────────
class StatusBarManager {
    statusBarItem;
    cachedConfigs = [];
    cachedPlanName = '';
    cachedTierName = '';
    /** User-configurable compression warning threshold (tokens). */
    warningThreshold = 150_000;
    /** Timer ID for reset countdown. */
    resetCountdownTimer;
    /** Status bar display preferences. */
    displayPrefs = { showContext: true, showQuota: true, showResetCountdown: true };
    /** Last active model ID for tracking reset countdown. */
    lastActiveModel = '';
    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'antigravity-context-monitor.showDetails';
        this.statusBarItem.name = (0, i18n_1.t)('statusBar.name');
        this.showInitializing();
        this.statusBarItem.show();
    }
    /**
     * Cache model configs for quota display in tooltip.
     */
    setModelConfigs(configs) {
        this.cachedConfigs = configs;
        this.scheduleResetRefresh();
    }
    /**
     * Set the compression warning threshold from user settings.
     */
    setWarningThreshold(threshold) {
        this.warningThreshold = Math.max(10_000, threshold);
    }
    /**
     * Set status bar display preferences.
     */
    setDisplayPrefs(prefs) {
        if (prefs.showContext !== undefined) {
            this.displayPrefs.showContext = prefs.showContext;
        }
        if (prefs.showQuota !== undefined) {
            this.displayPrefs.showQuota = prefs.showQuota;
        }
        if (prefs.showResetCountdown !== undefined) {
            this.displayPrefs.showResetCountdown = prefs.showResetCountdown;
        }
    }
    /**
     * Get the earliest quota reset time from cached configs.
     */
    getEarliestResetTime() {
        let earliest = null;
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
    scheduleResetRefresh() {
        if (this.resetCountdownTimer) {
            clearTimeout(this.resetCountdownTimer);
            this.resetCountdownTimer = undefined;
        }
        const earliest = this.getEarliestResetTime();
        if (!earliest) {
            return;
        }
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
    setPlanName(planName, tierName) {
        this.cachedPlanName = planName;
        this.cachedTierName = tierName || '';
    }
    showInitializing() {
        this.statusBarItem.text = '$(sync~spin) Context...';
        this.statusBarItem.tooltip = `Antigravity Context Monitor: ${(0, i18n_1.t)('statusBar.initializing')}`;
        this.statusBarItem.backgroundColor = undefined;
    }
    showDisconnected(message) {
        this.statusBarItem.text = `$(debug-disconnect) ${(0, i18n_1.t)('statusBar.disconnectedLabel')}`;
        this.statusBarItem.tooltip = `Antigravity Context Monitor: ${message}`;
        this.statusBarItem.backgroundColor = undefined;
    }
    showNoConversation(limitStr = '1M') {
        this.statusBarItem.text = `$(comment-discussion) 0k/${limitStr}, 0.0%`;
        const md = new vscode.MarkdownString(`Antigravity Context Monitor: ${(0, i18n_1.t)('statusBar.noConversationTooltip')}  \n——————————  \n$(link-external) **${(0, i18n_1.t)('statusBar.clickToView')}**`, false);
        md.supportThemeIcons = true;
        this.statusBarItem.tooltip = md;
        this.statusBarItem.backgroundColor = undefined;
    }
    showIdle(limitStr = '1M') {
        this.statusBarItem.text = `$(clock) 0k/${limitStr}, 0.0%`;
        const lines = [
            `Antigravity Context Monitor: ${(0, i18n_1.t)('statusBar.idle')}`,
            (0, i18n_1.t)('statusBar.idleDescription'),
        ];
        lines.push(...this.buildQuotaLines());
        lines.push(`——————————`);
        lines.push(`$(link-external) **${(0, i18n_1.t)('statusBar.clickToView')}**`);
        const md = new vscode.MarkdownString(lines.join('  \n'), false);
        md.supportThemeIcons = true;
        this.statusBarItem.tooltip = md;
        this.statusBarItem.backgroundColor = undefined;
    }
    /**
     * Update the status bar with current context usage data.
     */
    update(usage) {
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
        const dataSourceLabel = usage.isEstimated
            ? `⚠️ ${(0, i18n_1.t)('tooltip.estimated')}`
            : `✅ ${(0, i18n_1.t)('tooltip.precise')}`;
        const remaining = Math.max(0, usage.contextLimit - usage.contextUsed);
        const compressionStats = calculateCompressionStats(usage);
        const safeTitle = escapeMarkdown(usage.title || usage.cascadeId.substring(0, 8));
        const safeModelName = escapeMarkdown(usage.modelDisplayName);
        const tokenUnit = (0, i18n_1.tBi)('tokens', '令牌');
        const lines = [
            `📊 ${(0, i18n_1.t)('tooltip.title')}`,
            `——————————`,
            `🤖 ${(0, i18n_1.t)('tooltip.model')}: ${safeModelName}`,
            `📝 ${(0, i18n_1.t)('tooltip.session')}: ${safeTitle}`,
            `——————————`,
            `📥 ${(0, i18n_1.t)('tooltip.totalContextUsed')}:`,
            `     ${usage.contextUsed.toLocaleString()} ${tokenUnit}`,
            `📤 ${(0, i18n_1.t)('tooltip.modelOutput')}: ${usage.totalOutputTokens.toLocaleString()} ${tokenUnit}`,
            `🔧 ${(0, i18n_1.t)('tooltip.toolResults')}: ${usage.totalToolCallOutputTokens.toLocaleString()} ${tokenUnit}`,
            `📦 ${(0, i18n_1.t)('tooltip.limit')}: ${usage.contextLimit.toLocaleString()} ${tokenUnit}`,
            `📊 ${(0, i18n_1.t)('tooltip.usage')}: ${usage.usagePercent.toFixed(1)}%`,
        ];
        if (isCompressing) {
            lines.push(`🗜 ${(0, i18n_1.t)('tooltip.compressing')}`);
            lines.push(`💡 ${(0, i18n_1.t)('tooltip.compressingHint')}`);
        }
        else if (usage.compressionDetected) {
            lines.push(`🗜 ${(0, i18n_1.t)('tooltip.compressed')}`);
            if (usage.previousContextUsed !== undefined) {
                lines.push(`   ${(0, i18n_1.t)('tooltip.before')}: ${usage.previousContextUsed.toLocaleString()} ${tokenUnit}`);
                lines.push(`   ${(0, i18n_1.t)('tooltip.after')}: ${usage.contextUsed.toLocaleString()} ${tokenUnit}`);
            }
            if (compressionStats) {
                const sourceLabel = compressionStats.source === 'context'
                    ? (0, i18n_1.t)('tooltip.contextDrop')
                    : (0, i18n_1.t)('tooltip.checkpointDrop');
                lines.push(`   ${sourceLabel}: ${compressionStats.dropTokens.toLocaleString()} ${tokenUnit} ` +
                    `(${compressionStats.dropPercent.toFixed(1)}%)`);
            }
        }
        else {
            lines.push(`📐 ${(0, i18n_1.t)('tooltip.remaining')}: ${remaining.toLocaleString()} ${tokenUnit}`);
        }
        if (usage.hasGaps) {
            lines.push(`⚠️ ${(0, i18n_1.t)('tooltip.dataIncomplete')}`);
        }
        lines.push(`🔢 ${(0, i18n_1.t)('tooltip.steps')}: ${usage.stepCount}`);
        if (usage.imageGenStepCount > 0) {
            lines.push(`📷 ${(0, i18n_1.t)('tooltip.imageGen')}: ${usage.imageGenStepCount} ${(0, i18n_1.t)('tooltip.imageGenSteps')}`);
        }
        if (usage.estimatedDeltaSinceCheckpoint > 0 && usage.lastModelUsage) {
            lines.push(`📏 ${(0, i18n_1.t)('tooltip.estDelta')}: +${usage.estimatedDeltaSinceCheckpoint.toLocaleString()} ${tokenUnit} (${(0, i18n_1.t)('tooltip.sinceCheckpoint')})`);
        }
        lines.push(`——————————`);
        if (usage.lastModelUsage) {
            lines.push(`📎 ${(0, i18n_1.t)('tooltip.lastCheckpoint')}:`);
            lines.push(`  ${(0, i18n_1.t)('tooltip.input')}: ${usage.lastModelUsage.inputTokens.toLocaleString()}`);
            lines.push(`  ${(0, i18n_1.t)('tooltip.output')}: ${usage.lastModelUsage.outputTokens.toLocaleString()}`);
            if (usage.lastModelUsage.cacheReadTokens > 0) {
                lines.push(`  ${(0, i18n_1.t)('tooltip.cache')}: ${usage.lastModelUsage.cacheReadTokens.toLocaleString()}`);
            }
        }
        lines.push(`——————————`);
        lines.push(`${dataSourceLabel}`);
        lines.push(...this.buildQuotaLines());
        lines.push(`——————————`);
        lines.push(`$(link-external) **${(0, i18n_1.t)('statusBar.clickToView')}**`);
        const md = new vscode.MarkdownString(lines.join('  \n'), false);
        md.supportThemeIcons = true;
        this.statusBarItem.tooltip = md;
    }
    /**
     * Build plan info + model quota lines for tooltip (shared by update & showIdle).
     */
    buildQuotaLines() {
        const result = [];
        if (this.cachedPlanName) {
            result.push(`——————————`);
            const planStr = this.cachedTierName && this.cachedTierName !== this.cachedPlanName
                ? `**${escapeMarkdown(this.cachedPlanName)}** · **${escapeMarkdown(this.cachedTierName)}**`
                : `**${escapeMarkdown(this.cachedPlanName)}**`;
            result.push(`👤 ${(0, i18n_1.tBi)('Plan', '计划')}: ${planStr}`);
        }
        const quotaModels = this.cachedConfigs.filter(c => c.quotaInfo);
        if (quotaModels.length > 0) {
            result.push(`——————————`);
            result.push(`⚡ ${(0, i18n_1.tBi)('Model Quota', '模型配额')}`);
            result.push('');
            const now = Date.now();
            const header = `| ${(0, i18n_1.tBi)('Model', '模型')} | % | ${(0, i18n_1.tBi)('Reset', '重置')} |`;
            const sep = '|:--|--:|--:|';
            const rows = [];
            for (const c of quotaModels) {
                const qi = c.quotaInfo;
                const pct = Math.round(qi.remainingFraction * 100);
                const bar = pct >= 80 ? '🟢' : pct > 20 ? '🟡' : '🔴';
                let resetStr = '—';
                if (qi.resetTime) {
                    const resetDate = new Date(qi.resetTime);
                    const diffMs = resetDate.getTime() - now;
                    if (diffMs > 0) {
                        resetStr = (0, reset_time_1.formatResetContext)(qi.resetTime, { nowMs: now });
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
                result.push(`🔔 ${(0, i18n_1.tBi)('Earliest reset at', '最近重置时间为')}: **${(0, reset_time_1.formatResetAbsolute)(earliestIso, { includeSeconds: true })}** ` +
                    `(${(0, reset_time_1.formatResetCountdownFromMs)(earliest.getTime() - Date.now())})`);
            }
            // Show current model's reset time if available
            if (this.lastActiveModel) {
                const currentConfig = this.cachedConfigs.find(c => c.model === this.lastActiveModel);
                if (currentConfig?.quotaInfo?.resetTime) {
                    const resetDate = new Date(currentConfig.quotaInfo.resetTime);
                    if (resetDate.getTime() > Date.now()) {
                        result.push(`⏳ ${(0, i18n_1.tBi)('Current model resets at', '当前模型重置于')}: ` +
                            `**${(0, reset_time_1.formatResetAbsolute)(currentConfig.quotaInfo.resetTime, { includeSeconds: true })}** ` +
                            `(${(0, reset_time_1.formatResetCountdownFromMs)(resetDate.getTime() - Date.now())}, ${escapeMarkdown(currentConfig.label)})`);
                    }
                }
            }
        }
        // Show compression warning threshold
        result.push(`——————————`);
        result.push(`🎯 ${(0, i18n_1.tBi)('Compression warning', '压缩警告')}: **${formatTokenCount(this.warningThreshold)}**`);
        return result;
    }
    /**
     * Show detailed info in a QuickPick panel.
     */
    async showDetailsPanel(currentUsage, allTrajectoryUsages) {
        const items = [];
        if (!currentUsage && allTrajectoryUsages.length === 0) {
            items.push({
                label: `$(info) ${(0, i18n_1.t)('panel.noData')}`,
                description: '',
            });
        }
        if (currentUsage) {
            items.push({
                label: `$(star) ${(0, i18n_1.t)('panel.currentSession')}`,
                kind: vscode.QuickPickItemKind.Separator
            });
            const remaining = Math.max(0, currentUsage.contextLimit - currentUsage.contextUsed);
            const compressionStats = calculateCompressionStats(currentUsage);
            const sourceTag = currentUsage.isEstimated
                ? `[${(0, i18n_1.t)('panel.estimated')}]`
                : `[${(0, i18n_1.t)('panel.preciseShort')}]`;
            const compressTag = currentUsage.compressionDetected
                ? ` [${(0, i18n_1.t)('panel.compressed')}]`
                : (currentUsage.usagePercent > 100 ? ` [${(0, i18n_1.t)('panel.compressing')}]` : '');
            const imageTag = currentUsage.imageGenStepCount > 0 ? ` [📷×${currentUsage.imageGenStepCount}]` : '';
            const gapsTag = currentUsage.hasGaps ? ` [⚠️${(0, i18n_1.t)('panel.gaps')}]` : '';
            const tokenUnit = (0, i18n_1.tBi)('tokens', '令牌');
            const compressionSource = compressionStats
                ? (compressionStats.source === 'context' ? (0, i18n_1.t)('tooltip.contextDrop') : (0, i18n_1.t)('tooltip.checkpointDrop'))
                : '';
            const compDetail = compressionStats
                ? `${(0, i18n_1.t)('panel.compression')}: ${compressionStats.dropTokens.toLocaleString()} ${tokenUnit} ` +
                    `(${compressionStats.dropPercent.toFixed(1)}%, ${compressionSource})`
                : null;
            items.push({
                label: `$(pulse) ${currentUsage.title || (0, i18n_1.t)('panel.currentSessionLabel')}`,
                description: `${currentUsage.modelDisplayName}`,
                detail: [
                    `${sourceTag}${compressTag}${imageTag}${gapsTag}`,
                    `${(0, i18n_1.t)('panel.used')}: ${currentUsage.contextUsed.toLocaleString()} ${tokenUnit} | ${(0, i18n_1.t)('panel.limitLabel')}: ${currentUsage.contextLimit.toLocaleString()} ${tokenUnit}`,
                    `${(0, i18n_1.t)('panel.modelOut')}: ${currentUsage.totalOutputTokens.toLocaleString()} | ${(0, i18n_1.t)('panel.toolOut')}: ${currentUsage.totalToolCallOutputTokens.toLocaleString()}`,
                    `${(0, i18n_1.t)('panel.remaining')}: ${remaining.toLocaleString()} ${tokenUnit} | ${(0, i18n_1.t)('panel.usageLabel')}: ${currentUsage.usagePercent.toFixed(1)}% | ${(0, i18n_1.t)('panel.stepsLabel')}: ${currentUsage.stepCount}`,
                    ...(compDetail ? [compDetail] : [])
                ].join('\n')
            });
        }
        const others = allTrajectoryUsages.filter(u => u.cascadeId !== currentUsage?.cascadeId);
        if (others.length > 0) {
            items.push({
                label: `$(list-tree) ${(0, i18n_1.t)('panel.otherSessions')}`,
                kind: vscode.QuickPickItemKind.Separator
            });
            for (const usage of others.slice(0, 10)) {
                const remaining = Math.max(0, usage.contextLimit - usage.contextUsed);
                const compressionStats = calculateCompressionStats(usage);
                const sourceTag = usage.isEstimated ? (0, i18n_1.t)('panel.estimated') : (0, i18n_1.t)('panel.preciseShort');
                const imageTag = usage.imageGenStepCount > 0 ? ` 📷×${usage.imageGenStepCount}` : '';
                const compTag = usage.compressionDetected ? ' 🗜' : '';
                const compDetail = compressionStats
                    ? `${(0, i18n_1.t)('panel.comp')}: -${formatTokenCount(compressionStats.dropTokens)} (${compressionStats.dropPercent.toFixed(1)}%)`
                    : null;
                items.push({
                    label: `$(comment) ${usage.title || usage.cascadeId.substring(0, 8)}`,
                    description: `${usage.modelDisplayName} | ${usage.usagePercent.toFixed(1)}%${imageTag}${compTag}`,
                    detail: [
                        `[${sourceTag}] ${(0, i18n_1.t)('panel.used')}: ${formatTokenCount(usage.contextUsed)} / ${formatContextLimit(usage.contextLimit)}`,
                        `${(0, i18n_1.t)('panel.modelOut')}: ${formatTokenCount(usage.totalOutputTokens)} | ${(0, i18n_1.t)('panel.toolOut')}: ${formatTokenCount(usage.totalToolCallOutputTokens)}`,
                        `${(0, i18n_1.t)('panel.remaining')}: ${formatTokenCount(remaining)} | ${usage.stepCount} ${(0, i18n_1.t)('panel.stepsLabel')}`,
                        ...(compDetail ? [compDetail] : [])
                    ].join('\n')
                });
            }
        }
        // ─── Language Switch Entry ────────────────────────────────────────
        const langLabels = {
            zh: '中文',
            en: 'English',
            both: (0, i18n_1.tBi)('Bilingual', '双语'),
        };
        items.push({
            label: `$(gear) ${(0, i18n_1.tBi)('Settings', '设置')}`,
            kind: vscode.QuickPickItemKind.Separator
        });
        items.push({
            label: `$(globe) ${(0, i18n_1.t)('command.switchLanguage')}`,
            description: `[${langLabels[(0, i18n_1.getLanguage)()] || ''}]`,
        });
        const picked = await vscode.window.showQuickPick(items, {
            title: `📊 ${(0, i18n_1.t)('panel.title')}`,
            placeHolder: (0, i18n_1.t)('panel.placeholder'),
            canPickMany: false
        });
        // If user picked the language switch item, open the language picker
        const switchLabel = `$(globe) ${(0, i18n_1.t)('command.switchLanguage')}`;
        if (picked && picked.label === switchLabel) {
            vscode.commands.executeCommand('antigravity-context-monitor.switchLanguage');
        }
    }
    /**
     * Format a compact quota indicator for the current model.
     * Returns e.g. " 🟢85%" or "" if no quota info available.
     */
    formatQuotaIndicator(modelId) {
        const config = this.cachedConfigs.find(c => c.model === modelId);
        if (!config?.quotaInfo) {
            return '';
        }
        const pct = Math.round(config.quotaInfo.remainingFraction * 100);
        const dot = pct >= 80 ? '🟢' : pct > 20 ? '🟡' : '🔴';
        return ` ${dot}${pct}%`;
    }
    /**
     * Format a compact reset countdown string for StatusBar text.
     * Tracks the specified model's reset time (current active model).
     */
    formatResetCountdown(modelId) {
        let resetDate = null;
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
        if (!resetDate) {
            return '';
        }
        const diffMs = resetDate.getTime() - Date.now();
        if (diffMs <= 0) {
            return '';
        }
        return ` ⏳${(0, reset_time_1.formatResetCountdownFromMs)(diffMs)}`;
    }
    dispose() {
        if (this.resetCountdownTimer) {
            clearTimeout(this.resetCountdownTimer);
        }
        this.statusBarItem.dispose();
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=statusbar.js.map
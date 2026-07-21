import * as vscode from 'vscode';
import { ContextUsage } from './tracker';
import { ModelConfig } from './models';
import { isShowModelShortId } from './models';
import { t, tBi, getLanguage } from './i18n';
import { formatResetAbsolute, formatResetContext, formatResetCountdownFromMs } from './reset-time';
import { getDaysUntilBillingDay } from './billing-day';
import {
    applyLineBudget,
    ensureCtaLast,
    getLineBudget,
    getMaxQuotaRows,
    LABEL_MAX_DISPLAY_WIDTH,
    parseTooltipDensity,
    resolveEffectiveMode,
    selectQuotaRows,
    SESSION_MAX_DISPLAY_WIDTH,
    truncateByDisplayWidth,
    type EffectiveMode,
    type TooltipDensity,
} from './tooltip-budget';

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
    return text.replace(/([|*_~`\[\]\\#<>])/g, '\\$1');
}

/**
 * Shorten a raw shadow model ID to a human-readable label.
 * e.g. MODEL_PLACEHOLDER_M50 → "M50"
 *      MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE → "Gemini 2.5 Flash Lite"
 *      Already short IDs are returned as-is.
 */
function shortenShadowModelId(raw: string): string {
    if (!raw) { return ''; }
    // MODEL_PLACEHOLDER_Mxx → Mxx
    const placeholderMatch = raw.match(/^MODEL_PLACEHOLDER_(M\d+)$/);
    if (placeholderMatch) { return placeholderMatch[1]; }
    // MODEL_GOOGLE_GEMINI_x_y_z → Gemini x.y z (capitalize words)
    if (raw.startsWith('MODEL_GOOGLE_GEMINI_')) {
        const tail = raw.replace('MODEL_GOOGLE_GEMINI_', '');
        // Convert underscored segments: 2_5_FLASH_LITE → 2.5 Flash Lite
        const parts = tail.split('_');
        const result: string[] = [];
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            // Merge consecutive digits with dot: "2","5" → "2.5"
            if (i > 0 && /^\d+$/.test(p) && /^\d+$/.test(parts[i - 1])) {
                result[result.length - 1] += `.${p}`;
            } else {
                result.push(p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
            }
        }
        return `Gemini ${result.join(' ')}`;
    }
    // Fallback: strip MODEL_ prefix if present
    return raw.replace(/^MODEL_/, '');
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
    | { kind: 'other' };

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private cachedConfigs: ModelConfig[] = [];
    private cachedPlanName: string = '';
    private cachedTierName: string = '';
    /** Timer ID for reset countdown. */
    private resetCountdownTimer: NodeJS.Timeout | undefined;
    /** Status bar display preferences. */
    private displayPrefs = { showContext: true, showQuota: true, showResetCountdown: true, showAiCredits: true };
    /** Last active model ID for tracking reset countdown. */
    private lastActiveModel: string = '';
    /** Cached AI Credits total (sum of all credit types). */
    private cachedCreditsTotal: number = 0;
    /** Cached billing day (1-31, 0 = disabled). */
    private cachedBillingDay: number = 0;
    /** Last render state for config-driven tooltip refresh. */
    private lastRender: LastRender = { kind: 'other' };

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
        this.cachedCreditsTotal = Math.max(0, total);
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
            default:
                break;
        }
    }

    showInitializing(): void {
        this.lastRender = { kind: 'other' };
        // Bilingual status text (was hard-coded English)
        this.statusBarItem.text = `$(sync~spin) ${t('statusBar.initializing')}`;
        this.statusBarItem.tooltip = t('statusBar.initializingTooltip');
        this.statusBarItem.backgroundColor = undefined;
    }

    showDisconnected(message: string): void {
        this.lastRender = { kind: 'other' };
        this.statusBarItem.text = `$(debug-disconnect) ${t('statusBar.disconnectedLabel')}`;
        this.statusBarItem.tooltip = `Antigravity Context Monitor: ${message}`;
        this.statusBarItem.backgroundColor = undefined;
    }

    showNoConversation(limitStr: string = '1M', modelId?: string): void {
        this.lastRender = { kind: 'noConversation', limitStr, modelId };
        const contextPart = this.displayPrefs.showContext ? `0k/${limitStr}, 0.0%` : '';
        const quotaSuffix = this.displayPrefs.showQuota && modelId ? this.formatQuotaIndicator(modelId) : '';
        const resetSuffix = this.displayPrefs.showResetCountdown && modelId ? this.formatResetCountdown(modelId) : '';
        const creditsSuffix = this.displayPrefs.showAiCredits ? this.formatCreditsIndicator() : '';

        const segments = [
            contextPart,
            quotaSuffix.trim(),
            resetSuffix.trim(),
            creditsSuffix.trim(),
        ].filter(Boolean);

        this.statusBarItem.text = this.buildStatusText('$(comment-discussion)', segments);

        const currentId = modelId || this.lastActiveModel || '';
        const budget = this.resolveBudget(currentId);
        const lines = [
            `Antigravity Context Monitor: ${t('statusBar.noConversationTooltip')}`,
            ...this.buildQuotaLines(budget),
            ...this.buildCreditsLines(budget.isCompact),
            this.ctaLine(),
        ];
        this.applyTooltip(lines, budget);
        this.statusBarItem.backgroundColor = undefined;
    }

    showIdle(limitStr: string = '1M', modelId?: string): void {
        this.lastRender = { kind: 'idle', limitStr, modelId };
        const contextPart = this.displayPrefs.showContext ? `0k/${limitStr}, 0.0%` : '';
        const quotaSuffix = this.displayPrefs.showQuota && modelId ? this.formatQuotaIndicator(modelId) : '';
        const resetSuffix = this.displayPrefs.showResetCountdown && modelId ? this.formatResetCountdown(modelId) : '';
        const creditsSuffix = this.displayPrefs.showAiCredits ? this.formatCreditsIndicator() : '';

        const segments = [
            contextPart,
            quotaSuffix.trim(),
            resetSuffix.trim(),
            creditsSuffix.trim(),
        ].filter(Boolean);

        this.statusBarItem.text = this.buildStatusText('$(clock)', segments);

        const currentId = modelId || this.lastActiveModel || '';
        const budget = this.resolveBudget(currentId);
        const lines: string[] = [
            `Antigravity Context Monitor: ${t('statusBar.idle')}`,
            t('statusBar.idleDescription'),
            ...this.buildQuotaLines(budget),
            ...this.buildCreditsLines(budget.isCompact),
            this.ctaLine(),
        ];
        this.applyTooltip(lines, budget);
        this.statusBarItem.backgroundColor = undefined;
    }

    /**
     * Update the status bar with current context usage data.
     */
    update(usage: ContextUsage): void {
        this.lastRender = { kind: 'update', usage };
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

        // Current model quota indicator (🟢85%)
        const quotaSuffix = this.displayPrefs.showQuota ? this.formatQuotaIndicator(usage.model) : '';

        // Add reset countdown to status bar text (tracks current model)
        const resetSuffix = this.displayPrefs.showResetCountdown ? this.formatResetCountdown(usage.model) : '';

        // AI Credits indicator
        const creditsSuffix = (this.displayPrefs.showAiCredits && this.cachedCreditsTotal > 0)
            ? this.formatCreditsIndicator()
            : '';

        // Build status bar text based on display preferences
        const contextPart = this.displayPrefs.showContext
            ? `${usedStr}/${limitStr}${compressIcon}${gapsIndicator}`
            : '';

        // Collect all segments and join with || separators
        const segments = [
            contextPart,
            quotaSuffix.trim(),
            resetSuffix.trim(),
            creditsSuffix.trim(),
        ].filter(Boolean);

        this.statusBarItem.text = this.buildStatusText(icon, segments);
        this.statusBarItem.backgroundColor = getSeverityColor(severity);

        const budget = this.resolveBudget(usage.model || this.lastActiveModel || '');
        const lines = budget.isCompact
            ? this.buildCompactActiveLines(usage, usedStr, limitStr, displayPercent, isCompressing, budget)
            : this.buildNormalActiveLines(usage, isCompressing, budget);

        this.applyTooltip(lines, budget);
    }

    // ─── Budget / density helpers ─────────────────────────────────────────────

    private readDensity(): TooltipDensity {
        const raw = vscode.workspace
            .getConfiguration('antigravityContextMonitor')
            .get<string>('statusBar.tooltipDensity', 'auto');
        return parseTooltipDensity(raw);
    }

    private readZoomLevel(): number {
        const z = vscode.workspace.getConfiguration('window').get<number>('zoomLevel', 0);
        return typeof z === 'number' && Number.isFinite(z) ? z : 0;
    }

    private resolveBudget(currentId: string): {
        density: TooltipDensity;
        effective: EffectiveMode;
        maxQuotaRows: number;
        maxLines: number;
        isCompact: boolean;
        currentId: string;
        zoomLevel: number;
        quotaRowCount: number;
        lang: string;
    } {
        const density = this.readDensity();
        const zoomLevel = this.readZoomLevel();
        const lang = getLanguage();
        const quotaRowCount = this.cachedConfigs.filter(c => c.quotaInfo).length;
        const effective = resolveEffectiveMode(density, zoomLevel, quotaRowCount, lang);
        // full density keeps normal layout detail but no soft caps
        const isCompact = density !== 'full' && effective === 'compact';
        const maxQuotaRows = getMaxQuotaRows(density, effective);
        const maxLines = getLineBudget(density, effective);
        logDensityDiagOnce(zoomLevel, density, effective, quotaRowCount, lang);
        return {
            density,
            effective,
            maxQuotaRows,
            maxLines,
            isCompact,
            currentId,
            zoomLevel,
            quotaRowCount,
            lang,
        };
    }

    private ctaLine(): string {
        return `$(link-external) **${t('statusBar.clickToView')}**`;
    }

    private applyTooltip(
        lines: string[],
        budget: { maxLines: number },
    ): void {
        const withCta = ensureCtaLast(lines, this.ctaLine());
        const capped = applyLineBudget(withCta, budget.maxLines);
        const md = new vscode.MarkdownString(capped.join('  \n'), false);
        md.supportThemeIcons = true;
        this.statusBarItem.tooltip = md;
    }

    // ─── Active session layouts ───────────────────────────────────────────────

    private buildCompactActiveLines(
        usage: ContextUsage,
        usedStr: string,
        limitStr: string,
        displayPercent: string,
        isCompressing: boolean,
        budget: { maxQuotaRows: number; isCompact: boolean; currentId: string; density: TooltipDensity },
    ): string[] {
        const safeModelName = escapeMarkdown(usage.modelDisplayName);
        const rawTitle = usage.title || usage.cascadeId.substring(0, 8);
        const safeTitle = escapeMarkdown(
            truncateByDisplayWidth(rawTitle, SESSION_MAX_DISPLAY_WIDTH),
        );
        const compressFlag = isCompressing ? ' 🗜' : (usage.compressionDetected ? ' 🗜' : '');

        const lines: string[] = [
            `📊 ${t('tooltip.title')}`,
            `——————————`,
            `🤖 ${safeModelName} · 📝 ${safeTitle}`,
            `📥 ${usedStr}/${limitStr} · ${displayPercent}%${compressFlag}`,
        ];

        if (usage.hasGaps) {
            lines.push(`⚠️ ${t('tooltip.dataIncomplete')}`);
        } else if (isCompressing) {
            lines.push(`🗜 ${t('tooltip.compressing')}`);
        } else if (usage.compressionDetected) {
            lines.push(`🗜 ${t('tooltip.compressed')}`);
        }

        lines.push(`——————————`);
        lines.push(...this.buildQuotaLines({ ...budget, currentId: usage.model || budget.currentId }));
        lines.push(...this.buildCreditsLines(true));
        lines.push(this.ctaLine());
        return lines;
    }

    private buildNormalActiveLines(
        usage: ContextUsage,
        isCompressing: boolean,
        budget: { maxQuotaRows: number; isCompact: boolean; currentId: string; density: TooltipDensity },
    ): string[] {
        const remaining = Math.max(0, usage.contextLimit - usage.contextUsed);
        const compressionStats = calculateCompressionStats(usage);
        const rawTitle = usage.title || usage.cascadeId.substring(0, 8);
        const safeTitle = escapeMarkdown(
            truncateByDisplayWidth(rawTitle, SESSION_MAX_DISPLAY_WIDTH),
        );
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

        // Checkpoint block (P3 — kept in normal, folded in compact)
        if (usage.lastModelUsage) {
            const cpLabel = (usage.checkpointModel && isShowModelShortId())
                ? ` (${escapeMarkdown(shortenShadowModelId(usage.checkpointModel))})`
                : '';
            lines.push(`📎 ${t('tooltip.lastCheckpoint')}:${cpLabel}`);
            lines.push(`  ${t('tooltip.input')}: ${usage.lastModelUsage.inputTokens.toLocaleString()}`);
            lines.push(`  ${t('tooltip.output')}: ${usage.lastModelUsage.outputTokens.toLocaleString()}`);
            if (usage.lastModelUsage.cacheReadTokens > 0) {
                lines.push(`  ${t('tooltip.cache')}: ${usage.lastModelUsage.cacheReadTokens.toLocaleString()}`);
            }
        }

        lines.push(`——————————`);
        lines.push(...this.buildQuotaLines({ ...budget, currentId: usage.model || budget.currentId }));
        lines.push(...this.buildCreditsLines(false));
        lines.push(this.ctaLine());
        return lines;
    }

    /**
     * Build plan info + model quota lines for tooltip (shared by update / idle / noConversation).
     * Applies selectQuotaRows + "N more" when truncated. Full density does not truncate.
     */
    private buildQuotaLines(opts: {
        maxQuotaRows: number;
        isCompact: boolean;
        currentId: string;
        density: TooltipDensity;
    }): string[] {
        const result: string[] = [];

        if (this.cachedPlanName && !opts.isCompact) {
            result.push(`——————————`);
            const planStr = this.cachedTierName && this.cachedTierName !== this.cachedPlanName
                ? `**${escapeMarkdown(this.cachedPlanName)}** · **${escapeMarkdown(this.cachedTierName)}**`
                : `**${escapeMarkdown(this.cachedPlanName)}**`;
            result.push(`👤 ${tBi('Plan', '计划')}: ${planStr}`);
        } else if (this.cachedPlanName && opts.isCompact) {
            // compact: fold plan into a single short line only if present
            const planStr = escapeMarkdown(this.cachedPlanName);
            result.push(`👤 ${planStr}`);
        }

        const quotaModels = this.cachedConfigs.filter(c => c.quotaInfo);
        if (quotaModels.length === 0) {
            return result;
        }

        const { rows, hiddenCount, total } = selectQuotaRows(
            quotaModels,
            opts.currentId,
            opts.maxQuotaRows,
        );

        result.push(`——————————`);
        if (opts.isCompact && total > 0) {
            const shown = rows.length;
            const shownOf = tBi(
                `Showing ${shown}/${total}`,
                `显示 ${shown}/${total}`,
            );
            result.push(`⚡ ${tBi('Model Quota', '模型配额')}  (${shownOf})`);
        } else {
            result.push(`⚡ ${tBi('Model Quota', '模型配额')}`);
        }
        result.push('');

        const now = Date.now();
        const header = `| ${tBi('Model', '模型')} | % | ${tBi('Reset', '重置')} |`;
        const sep = '|:--|--:|--:|';
        const tableRows: string[] = [];
        for (const c of rows) {
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
            const label = escapeMarkdown(
                truncateByDisplayWidth(c.label, LABEL_MAX_DISPLAY_WIDTH),
            );
            tableRows.push(`| ${bar} ${label} | ${pct}% | 🔄 ${resetStr} |`);
        }
        result.push(header);
        result.push(sep);
        result.push(...tableRows);
        result.push('');

        // "N more" only when truncated (never in full density / zero hidden)
        if (hiddenCount > 0 && opts.density !== 'full') {
            result.push(
                tBi(
                    `… and ${hiddenCount} more models — click to view all`,
                    `… 还有 ${hiddenCount} 个模型，点击查看全部`,
                ),
            );
        }

        // Earliest reset — compact keeps one line; normal may keep both earliest + current
        const earliest = this.getEarliestResetTime();
        if (earliest) {
            const earliestIso = earliest.toISOString();
            result.push(
                `🔔 ${tBi('Earliest reset at', '最近重置时间为')}: **${formatResetAbsolute(earliestIso, { includeSeconds: true })}** ` +
                `(${formatResetCountdownFromMs(earliest.getTime() - Date.now())})`
            );
        }

        if (!opts.isCompact && this.lastActiveModel) {
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
     * Returns e.g. "🟢85%" or "" if no quota info available.
     */
    private formatQuotaIndicator(modelId: string): string {
        const config = this.cachedConfigs.find(c => c.model === modelId);
        if (!config?.quotaInfo) { return ''; }
        const pct = Math.round(config.quotaInfo.remainingFraction * 100);
        const dot = pct >= 80 ? '🟢' : pct > 20 ? '🟡' : '🔴';
        return `${dot}${pct}%`;
    }

    /**
     * Format AI Credits indicator for status bar.
     * Returns e.g. "⚡14,701" or "" if credits = 0.
     */
    private formatCreditsIndicator(): string {
        if (this.cachedCreditsTotal <= 0) { return ''; }
        return `⚡${this.cachedCreditsTotal.toLocaleString()}`;
    }

    private buildStatusText(icon: string, segments: string[]): string {
        const visibleSegments = segments.map(s => s.trim()).filter(Boolean);
        if (visibleSegments.length === 0) { return icon; }
        return `|| ${icon} ${visibleSegments.join(' || ')} ||`;
    }

    /**
     * Build credit info lines for tooltip.
     * @param compact when true, only a single credits line (no billing-only branch noise).
     */
    private buildCreditsLines(compact: boolean = false): string[] {
        const result: string[] = [];
        if (this.cachedCreditsTotal <= 0 && this.cachedBillingDay <= 0) { return result; }

        result.push(`——————————`);
        if (this.cachedCreditsTotal > 0) {
            const daysLeft = this.getDaysUntilRefresh();
            let refreshStr = '';
            if (daysLeft !== null) {
                if (daysLeft === 0) {
                    refreshStr = ` (${tBi('expires today', '今日到期')})`;
                } else {
                    refreshStr = ` (${daysLeft}${tBi('d until expiry', '天后到期')})`;
                }
            } else {
                refreshStr = ` (${tBi('expiry date not set', '到期日未设置')})`;
            }
            result.push(`⚡ ${tBi('AI Credits', 'AI 积分')}: **${this.cachedCreditsTotal.toLocaleString()}**${refreshStr}`);
        } else if (!compact && this.cachedBillingDay > 0) {
            const daysLeft = this.getDaysUntilRefresh();
            if (daysLeft !== null && daysLeft > 0) {
                result.push(`⚡ ${tBi('Credits expire in', '积分到期还有')} **${daysLeft}** ${tBi('days', '天')}`);
            }
        }
        return result;
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
        return `⏳${formatResetCountdownFromMs(diffMs)}`;
    }

    dispose(): void {
        if (this.resetCountdownTimer) {
            clearTimeout(this.resetCountdownTimer);
        }
        this.statusBarItem.dispose();
    }
}

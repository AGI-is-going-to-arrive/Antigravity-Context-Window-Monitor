import * as vscode from 'vscode';
import type { ContextUsage, ConversationOrchestratorConfig } from './tracker';
import type { GMCallEntry, GMSummary } from './gm/types';
import {
    costFromTokens,
    findPricingForDate,
    formatUsdCost,
    formatUsdPerMillion,
    formatUsdSavings,
    getUpcomingRateChangeForModel,
    selectPricingModel,
    type ModelPricing,
} from './pricing-store';
import {
    getModelDisplayName,
    getQuotaPoolKey,
    localizePickerEffortLabel,
    normalizeModelDisplayName,
    resolveModelId,
    type ModelConfig,
    type OrchestratorSettings,
    type UserQuotaSummary,
} from './models';
import { t, tBi, getLanguage, formatNumber } from './i18n';
import { groupModelQuotas, type ModelQuotaGroup } from './model-quota';
import { formatResetCountdownFromMs } from './reset-time';
import { getDaysUntilBillingDay } from './billing-day';
import {
    computeStepCacheHitRate,
    computeStepSpeed,
    computeTelemetrySummary,
    formatCachePercent,
    formatLatency,
    formatSpeed,
    type CacheState,
    type SessionTelemetrySummary,
    type TelemetryAggregate,
} from './telemetry-metrics';
import {
    applySectionBudget,
    getMaxQuotaRows,
    getSectionLineBudget,
    parseTooltipDensity,
    renderHoverSections,
    resolveEffectiveMode,
    truncateByDisplayWidth,
    type EffectiveMode,
    type HoverSection,
    type TooltipDensity,
} from './tooltip-budget';
import {
    formatCreditExpiry,
    getContextReading,
    getContextRemaining,
    monitorBackendMessage,
    monitorStatusLabel,
    MONITOR_COMMAND,
    quotaPercentage,
    quotaResetLabel,
    resetCountdown,
    selectMonitorQuotaGroups,
    usableCount,
    type MonitorState,
    type MonitorStatus,
    type OverviewDestination,
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
    getSectionLineBudget,
    applySectionBudget,
    renderHoverSections,
    COMPACT_MAX_QUOTA_ROWS,
    NORMAL_MAX_QUOTA_ROWS,
    COMPACT_MAX_LINES,
    NORMAL_MAX_LINES,
    SECTION_COMPACT_MAX_LINES,
    SECTION_NORMAL_MAX_LINES,
    SECTION_FULL_MAX_LINES,
} from './tooltip-budget';
export type { TooltipDensity, EffectiveMode, QuotaSelectable, HoverSection } from './tooltip-budget';

const REFRESH_COMMAND = 'antigravity-context-monitor.refresh';
type HoverDestination = OverviewDestination | 'gmdata' | 'pricing';

// ─── Snapshot Types ───────────────────────────────────────────────────────────

export interface LatestCallSnapshot {
    modelLabel: string;
    rawModel: string;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheHitRate: number | null;
    costUsd: number | null;
    isUnpriced: boolean;
    ttftSeconds: number | null;
    streamingSeconds: number | null;
    totalSeconds: number | null;
    speedTokPerSec: number | null;
    status: 'ok' | 'retried' | 'error';
    retries: number;
}

export interface OrchestratorSplitSummary {
    plannerLabel: string;
    plannerCalls: number;
    plannerCostUsd: number | null;
    executorLabel: string;
    executorCalls: number;
    executorCostUsd: number | null;
    hasUnpriced: boolean;
}

export interface RetryWasteSummary {
    retryCount: number;
    retryTokens: number;
    estWasteCostUsd: number | null;
    topErrorCode: string;
}

export interface HoverCostSnapshot {
    todayCostUsd?: number | null;
    todayHasUnpriced?: boolean;
    sessionCostUsd?: number | null;
    sessionHasUnpriced?: boolean;
}

interface ComputedHoverExtras {
    latestCall: LatestCallSnapshot | null;
    sessionCostUsd: number | null;
    sessionHasUnpriced: boolean;
    blendedInputUsdPerMillion: number | null;
    retryWaste: RetryWasteSummary | null;
    primaryCalls: GMCallEntry[];
}

// ─── Token & Gauge Formatting ─────────────────────────────────────────────────

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
 * Build a theme-neutral Unicode capsule progress meter (crisp in Dark, Light, and High Contrast).
 */
export function buildUnicodeGauge(percent: number, slots = 8): string {
    const clampedSlots = Math.max(2, Math.floor(slots));
    if (!Number.isFinite(percent)) {
        return '▱'.repeat(clampedSlots);
    }
    const clampedPct = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clampedPct / 100) * clampedSlots);
    return '▰'.repeat(filled) + '▱'.repeat(clampedSlots - filled);
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

function formatInlineCode(text: string, maxWidth: number): string {
    const safe = truncateByDisplayWidth(normalizeHoverLine(text), maxWidth).replace(/`/g, "'").replace(/\|/g, '/');
    return `\`${safe}\``;
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

function validQuotaFraction(value: number | null | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
        ? value
        : null;
}

function validResetTimestamp(iso: string | null | undefined): number | null {
    if (!iso || typeof iso !== 'string') { return null; }
    const parsed = Date.parse(iso.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatSignedPercentDelta(deltaPct: number | null | undefined): string {
    if (deltaPct === null || deltaPct === undefined || !Number.isFinite(deltaPct)) {
        return '';
    }
    const rounded = Math.round(deltaPct);
    const normalized = Object.is(rounded, -0) ? 0 : rounded;
    return `${normalized > 0 ? '+' : ''}${normalized}%`;
}

function formatCacheWarmthShort(state: CacheState): string {
    switch (state) {
        case 'warm': return t('telemetry.cacheState.warm');
        case 'warming': return t('telemetry.cacheState.warming');
        case 'cold': return t('telemetry.cacheState.cold');
        default: return '';
    }
}

function buildLatestCallSnapshot(
    call: GMCallEntry,
    customPricing: Record<string, ModelPricing>,
): LatestCallSnapshot {
    const modelLabel = call.responseModel
        || normalizeModelDisplayName(call.modelDisplay || call.model)
        || call.model
        || '—';
    const rawModel = call.model || call.responseModel || call.modelDisplay || '';
    const pricingModel = selectPricingModel(call.model || call.modelDisplay, call.responseModel, customPricing);
    const pricing = findPricingForDate(pricingModel, customPricing, call.createdAt || '');
    const costUsd = pricing ? costFromTokens(call, pricing) : null;

    const ttftSeconds = Number.isFinite(call.ttftSeconds) && call.ttftSeconds > 0 ? call.ttftSeconds : null;
    const streamingSeconds = Number.isFinite(call.streamingSeconds) && call.streamingSeconds > 0 ? call.streamingSeconds : null;
    const totalSum = (ttftSeconds ?? 0) + (streamingSeconds ?? 0);
    const totalSeconds = totalSum > 0 ? totalSum : null;
    const speedTokPerSec = computeStepSpeed(call.outputTokens, call.streamingSeconds);
    const cacheHitRate = computeStepCacheHitRate(call.inputTokens, call.cacheReadTokens, call.cacheCreationTokens);

    const status: LatestCallSnapshot['status'] = call.hasError
        ? 'error'
        : call.retries > 0
            ? 'retried'
            : 'ok';

    return {
        modelLabel,
        rawModel,
        inputTokens: Math.max(0, call.inputTokens || 0),
        outputTokens: Math.max(0, call.outputTokens || 0),
        thinkingTokens: Math.max(0, call.thinkingTokens || 0),
        cacheReadTokens: Math.max(0, call.cacheReadTokens || 0),
        cacheHitRate,
        costUsd,
        isUnpriced: !pricing,
        ttftSeconds,
        streamingSeconds,
        totalSeconds,
        speedTokPerSec,
        status,
        retries: Math.max(0, call.retries || 0),
    };
}

function computeHoverExtras(
    gmSummary: GMSummary,
    activeCascadeId: string | undefined,
    customPricing: Record<string, ModelPricing>,
): ComputedHoverExtras {
    const activeConv = activeCascadeId
        ? gmSummary.conversations.find(c => c.cascadeId === activeCascadeId)
        : undefined;
    const allCalls = gmSummary.conversations.flatMap(c => c.calls);
    const primaryCalls = activeConv && activeConv.calls.length > 0 ? activeConv.calls : allCalls;

    // Pick newest call by createdAt (fallback to array order)
    let latestCallEntry: GMCallEntry | null = null;
    let latestTs = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < primaryCalls.length; i++) {
        const c = primaryCalls[i];
        const ts = c.createdAt ? Date.parse(c.createdAt) : Number.NaN;
        if (Number.isFinite(ts)) {
            if (ts >= latestTs) {
                latestTs = ts;
                latestCallEntry = c;
            }
        } else if (latestCallEntry === null || latestTs === Number.NEGATIVE_INFINITY) {
            latestCallEntry = c;
        }
    }

    let sessionCostSum = 0;
    let pricedCallCount = 0;
    let sessionHasUnpriced = false;
    let weightedInputDollars = 0;
    let weightedInputTokens = 0;

    for (const c of primaryCalls) {
        const pricingModel = selectPricingModel(c.model || c.modelDisplay, c.responseModel, customPricing);
        const pricing = findPricingForDate(pricingModel, customPricing, c.createdAt || '');
        if (pricing) {
            pricedCallCount++;
            sessionCostSum += costFromTokens(c, pricing);
            const freshIn = Math.max(0, c.inputTokens || 0);
            const cacheIn = Math.max(0, c.cacheReadTokens || 0);
            const totalIn = freshIn + cacheIn;
            if (totalIn > 0) {
                weightedInputDollars += freshIn * pricing.input + cacheIn * pricing.cacheRead;
                weightedInputTokens += totalIn;
            }
        } else {
            sessionHasUnpriced = true;
        }
    }

    const sessionCostUsd = pricedCallCount > 0 ? sessionCostSum : null;
    const blendedInputUsdPerMillion = weightedInputTokens > 0
        ? weightedInputDollars / weightedInputTokens
        : null;

    // Retry waste across session
    let retryWaste: RetryWasteSummary | null = null;
    const totalRetryCount = Math.max(0, gmSummary.totalRetryCount || 0);
    if (totalRetryCount > 0) {
        let wasteCost = 0;
        let hasWasteCost = false;
        let retryTokSum = 0;
        for (const c of allCalls) {
            const rIn = Math.max(0, c.retryTokensIn || 0);
            const rOut = Math.max(0, c.retryTokensOut || 0);
            if (rIn + rOut <= 0) { continue; }
            retryTokSum += rIn + rOut;
            const pricingModel = selectPricingModel(c.model || c.modelDisplay, c.responseModel, customPricing);
            const pricing = findPricingForDate(pricingModel, customPricing, c.createdAt || '');
            if (pricing) {
                wasteCost += (rIn * pricing.input + rOut * pricing.output) / 1_000_000;
                hasWasteCost = true;
            }
        }
        const errEntries = Object.entries(gmSummary.retryErrorCodes || {})
            .sort((a, b) => b[1] - a[1]);
        retryWaste = {
            retryCount: totalRetryCount,
            retryTokens: Math.max(retryTokSum, gmSummary.totalRetryTokens || 0),
            estWasteCostUsd: hasWasteCost && wasteCost > 0 ? wasteCost : null,
            topErrorCode: errEntries[0]?.[0] || '',
        };
    }

    return {
        latestCall: latestCallEntry ? buildLatestCallSnapshot(latestCallEntry, customPricing) : null,
        sessionCostUsd,
        sessionHasUnpriced,
        blendedInputUsdPerMillion,
        retryWaste,
        primaryCalls,
    };
}

function computeOrchestratorSplit(
    calls: readonly GMCallEntry[],
    orchestratorConfig: ConversationOrchestratorConfig | undefined,
    customPricing: Record<string, ModelPricing>,
): OrchestratorSplitSummary | null {
    if (!orchestratorConfig?.planModel || !orchestratorConfig?.executionModel || calls.length === 0) {
        return null;
    }
    const planId = resolveModelId(orchestratorConfig.planModel) || orchestratorConfig.planModel;
    const execId = resolveModelId(orchestratorConfig.executionModel) || orchestratorConfig.executionModel;
    if (!planId || !execId || planId === execId) { return null; }

    let plannerCalls = 0;
    let plannerCost = 0;
    let plannerPriced = false;
    let executorCalls = 0;
    let executorCost = 0;
    let executorPriced = false;
    let hasUnpriced = false;

    for (const c of calls) {
        const cid = resolveModelId(c.model || c.modelDisplay || c.responseModel) || c.model;
        const pricingModel = selectPricingModel(c.model || c.modelDisplay, c.responseModel, customPricing);
        const pricing = findPricingForDate(pricingModel, customPricing, c.createdAt || '');
        const callCost = pricing ? costFromTokens(c, pricing) : null;
        if (cid === planId) {
            plannerCalls++;
            if (callCost !== null) { plannerCost += callCost; plannerPriced = true; } else { hasUnpriced = true; }
        } else if (cid === execId) {
            executorCalls++;
            if (callCost !== null) { executorCost += callCost; executorPriced = true; } else { hasUnpriced = true; }
        }
    }

    if (plannerCalls === 0 && executorCalls === 0) { return null; }
    const lang = getLanguage();
    return {
        plannerLabel: localizePickerEffortLabel(planId, getModelDisplayName(planId), lang),
        plannerCalls,
        plannerCostUsd: plannerPriced ? plannerCost : null,
        executorLabel: localizePickerEffortLabel(execId, getModelDisplayName(execId), lang),
        executorCalls,
        executorCostUsd: executorPriced ? executorCost : null,
        hasUnpriced,
    };
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
    private cachedOrchestratorSettings: OrchestratorSettings | null = null;
    private cachedQuotaSummary: UserQuotaSummary | null = null;
    private cachedPlanName: string = '';
    private cachedTierName: string = '';
    private resetCountdownTimer: NodeJS.Timeout | undefined;
    private displayPrefs = {
        showContext: true,
        showQuota: true,
        showResetCountdown: true,
        showAiCredits: true,
        showSpeed: false,
        showCacheHit: false,
        showSessionCost: false,
    };
    private cachedCreditsTotal: number | null = null;
    private cachedBillingDay: number = 0;
    private cachedTelemetry: SessionTelemetrySummary | null = null;
    private cachedCustomPricing: Record<string, ModelPricing> = {};
    private cachedExtras: ComputedHoverExtras | null = null;
    private cachedCostSnapshot: HoverCostSnapshot = {};
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

    setModelConfigs(configs: ModelConfig[]): void {
        this.cachedConfigs = configs;
        this.scheduleResetRefresh();
    }

    setOrchestratorSettings(settings: OrchestratorSettings | null): void {
        this.cachedOrchestratorSettings = settings;
    }

    getOrchestratorSettings(): OrchestratorSettings | null {
        return this.cachedOrchestratorSettings;
    }

    setQuotaSummary(summary: UserQuotaSummary | null): void {
        this.cachedQuotaSummary = summary;
    }

    getQuotaSummary(): UserQuotaSummary | null {
        return this.cachedQuotaSummary;
    }

    setCostSnapshot(snapshot: HoverCostSnapshot): void {
        this.cachedCostSnapshot = { ...snapshot };
    }

    /**
     * Compute and cache session/active telemetry summary + latest-call/cost extras.
     * Pass `null` to clear cleanly (e.g., on account switch or cold start).
     */
    setTelemetry(
        gmSummary: GMSummary | null,
        activeCascadeId?: string,
        customPricing?: Record<string, ModelPricing>,
    ): void {
        this.cachedCustomPricing = customPricing ? { ...customPricing } : {};
        if (!gmSummary) {
            this.cachedTelemetry = null;
            this.cachedExtras = null;
            return;
        }
        const summary = computeTelemetrySummary(gmSummary, { activeCascadeId, customPricing });
        const hasReading = hasTelemetryReading(summary.primary);
        this.cachedTelemetry = hasReading ? summary : null;
        const hasActivity = hasReading || gmSummary.totalCalls > 0 || (gmSummary.totalRetryCount || 0) > 0;
        this.cachedExtras = hasActivity
            ? computeHoverExtras(gmSummary, activeCascadeId, this.cachedCustomPricing)
            : null;
    }

    setDisplayPrefs(prefs: {
        showContext?: boolean;
        showQuota?: boolean;
        showResetCountdown?: boolean;
        showAiCredits?: boolean;
        showSpeed?: boolean;
        showCacheHit?: boolean;
        showSessionCost?: boolean;
    }): void {
        if (prefs.showContext !== undefined) { this.displayPrefs.showContext = prefs.showContext; }
        if (prefs.showQuota !== undefined) { this.displayPrefs.showQuota = prefs.showQuota; }
        if (prefs.showResetCountdown !== undefined) { this.displayPrefs.showResetCountdown = prefs.showResetCountdown; }
        if (prefs.showAiCredits !== undefined) { this.displayPrefs.showAiCredits = prefs.showAiCredits; }
        if (prefs.showSpeed !== undefined) { this.displayPrefs.showSpeed = prefs.showSpeed; }
        if (prefs.showCacheHit !== undefined) { this.displayPrefs.showCacheHit = prefs.showCacheHit; }
        if (prefs.showSessionCost !== undefined) { this.displayPrefs.showSessionCost = prefs.showSessionCost; }
    }

    setCredits(total: number | null): void {
        this.cachedCreditsTotal = total !== null && usableCount(total) ? total : null;
    }

    setBillingDay(day: number): void {
        this.cachedBillingDay = (day >= 1 && day <= 31) ? day : 0;
    }

    getDaysUntilRefresh(): number | null {
        return getDaysUntilBillingDay(this.cachedBillingDay);
    }

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

    private scheduleResetRefresh(): void {
        if (this.resetCountdownTimer) {
            clearTimeout(this.resetCountdownTimer);
            this.resetCountdownTimer = undefined;
        }
        const earliest = this.getEarliestResetTime();
        if (!earliest) { return; }
        const delayMs = earliest.getTime() - Date.now() + 3000;
        if (delayMs > 0 && delayMs < 24 * 3600_000) {
            this.resetCountdownTimer = setTimeout(() => {
                vscode.commands.executeCommand(REFRESH_COMMAND);
            }, delayMs);
        }
    }

    setPlanName(planName: string, tierName?: string): void {
        this.cachedPlanName = planName;
        this.cachedTierName = tierName || '';
    }

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

    private effectiveSessionCost(): number | null {
        const override = this.cachedCostSnapshot.sessionCostUsd;
        if (override !== undefined && override !== null && Number.isFinite(override) && override > 0) {
            return override;
        }
        const computed = this.cachedExtras?.sessionCostUsd ?? null;
        return computed !== null && Number.isFinite(computed) && computed > 0 ? computed : null;
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
        const sessionCost = this.effectiveSessionCost();
        const costSegment = this.displayPrefs.showSessionCost && sessionCost !== null
            ? `$(credit-card) ${formatUsdCost(sessionCost, { precision: 'standard' })}`
            : '';
        return [quota, reset, credits, speedSegment, cacheSegment, costSegment];
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
                .replace('$(credit-card)', t('telemetry.cost'))
                .replace(/\$\([^)]*\)\s*/g, '').trim());
        this.statusBarItem.accessibilityInformation = {
            label: [t('statusBar.name'), state, ...spoken].join(' · '),
            role: 'button',
        };
        this.statusBarItem.tooltip = this.buildHover();
    }

    private selectQuotaGroupsWithWindows(currentModel: string | undefined): ModelQuotaGroup[] {
        const id = currentModel ? resolveModelId(currentModel) || currentModel : '';
        return groupModelQuotas(this.cachedConfigs, this.cachedQuotaSummary)
            .filter(g => g.minimum !== null || g.resetTime || g.resetDiffers || g.weeklyQuota !== undefined)
            .sort((a, b) => {
                const active = (group: ModelQuotaGroup) => id !== '' && group.readings.some(reading => reading.model === id);
                return Number(active(b)) - Number(active(a))
                    || (a.minimum ?? Infinity) - (b.minimum ?? Infinity)
                    || a.label.localeCompare(b.label);
            });
    }

    private buildHover(): vscode.MarkdownString {
        const status = this.monitorStatus;
        const usage = this.lastRender.kind === 'update' ? this.lastRender.usage : null;
        const connected = status.state !== 'connecting' && status.state !== 'disconnected';
        const groups = connected ? this.selectQuotaGroupsWithWindows(usage?.model) : [];

        const density = resolveConfiguredDensity(vscode.workspace.getConfiguration('antigravityContextMonitor')
            .get<string>('statusBar.tooltipDensity', 'auto'));
        const rawZoom = vscode.workspace.getConfiguration('window').get<number>('zoomLevel', 0);
        const zoom = Number.isFinite(rawZoom) ? rawZoom : 0;
        const lang = getLanguage();
        const mode = resolveEffectiveMode(density, zoom, groups.length, lang);
        const full = density === 'full';
        logDensityDiagOnce(zoom, density, mode, groups.length, lang);

        const sections: HoverSection[] = [];

        // P0: Header + Active Model / Orchestrator Route (+ Context Window Gauge)
        const headerSection = this.buildHeaderSection(status, usage, connected, mode, full);
        if (status.state === 'disconnected') {
            sections.push(headerSection);
            sections.push({
                id: 'disconnected',
                priority: 0,
                lines: [monitorBackendMessage(status.backendIssue)],
            });
        } else if (usage) {
            const contextSection = this.buildContextSection(usage, mode, full);
            if (full) {
                sections.push(headerSection, contextSection);
            } else {
                sections.push({
                    id: 'hero',
                    priority: 0,
                    lines: [...headerSection.lines, ...contextSection.lines],
                    compactLines: [
                        headerSection.lines[0],
                        ...(contextSection.compactLines ?? contextSection.lines),
                    ],
                });
            }
        } else {
            sections.push(headerSection);
        }

        if (connected) {
            // P3: Latest Call (1-line summary in auto; full 4-col table in full)
            const latestSection = this.buildLatestCallSection(mode, full);
            if (latestSection) {
                sections.push(latestSection);
            }

            // P1: Session & Today Cost + Cache + Speed Ledger (+ Orchestrator Split)
            const kpiSection = this.buildSessionKpiSection(usage, mode, full);
            if (kpiSection) {
                sections.push(kpiSection);
            }

            // P0 (Protected): Dual-Window Quota Table (5h + Weekly, graceful 5h-only fallback)
            sections.push(this.buildQuotaSection(groups, usage, mode, full));

            // P4: Smart Event-Driven Alerts + AI Credits
            const alertsSection = this.buildAlertsSection(usage, mode, full);
            if (alertsSection) {
                sections.push(alertsSection);
            }
        }

        // P0: Pinned 1-Click Footer Action Bar
        sections.push(this.buildFooterSection(mode));

        const budget = getSectionLineBudget(density, mode, zoom);
        const budgeted = applySectionBudget(sections, budget);
        const tooltip = new vscode.MarkdownString(renderHoverSections(budgeted.sections));
        tooltip.supportThemeIcons = true;
        tooltip.isTrusted = { enabledCommands: [MONITOR_COMMAND, REFRESH_COMMAND] };
        return tooltip;
    }

    private buildHeaderSection(
        status: MonitorStatus,
        usage: ContextUsage | null,
        connected: boolean,
        mode: EffectiveMode,
        full: boolean,
    ): HoverSection {
        const stateIcon = monitorStateIcon(status.state);
        const stateLabel = monitorStatusLabel(status.state);
        const plan = connected
            ? [this.cachedPlanName, this.cachedTierName]
                .map(label => normalizeHoverLine(label))
                .filter((label, index, all) => label && all.indexOf(label) === index)
                .map(label => truncateByDisplayWidth(label, mode === 'compact' ? 22 : 28))
                .join(' · ')
            : '';
        const planBadge = plan ? ` · ${formatInlineCode(plan, 30)}` : '';

        if (!usage) {
            return {
                id: 'header',
                priority: 0,
                lines: [
                    `**${t('statusBar.name')}**${planBadge} · ${stateIcon} ${stateLabel}`,
                ],
            };
        }

        const lang = getLanguage();
        const rawTitle = normalizeHoverLine(usage.title || '') || t('panel.currentSessionLabel');
        const title = formatHoverText(rawTitle, mode === 'compact' ? 30 : 44);
        const stepsSuffix = usableCount(usage.stepCount) && usage.stepCount > 0
            ? ` · ${formatNumber(usage.stepCount)} ${tBi(usage.stepCount === 1 ? 'step' : 'steps', '步')}`
            : '';

        const lines: string[] = full
            ? [
                `**${t('statusBar.name')}**${planBadge}`,
                `**${title}** · ${stateIcon} ${stateLabel}${stepsSuffix}`,
            ]
            : [
                `**${title}** · ${stateIcon} ${stateLabel}${stepsSuffix}${planBadge}`,
            ];

        const orch = usage.orchestratorConfig;
        if (orch?.planModel && orch?.executionModel) {
            const planId = resolveModelId(orch.planModel) || orch.planModel;
            const execId = resolveModelId(orch.executionModel) || orch.executionModel;
            const planName = localizePickerEffortLabel(planId, getModelDisplayName(planId), lang);
            const execName = localizePickerEffortLabel(execId, getModelDisplayName(execId), lang);
            const isCrossPool = getQuotaPoolKey(planId) !== getQuotaPoolKey(execId);
            const crossBadge = isCrossPool ? ` *(${t('orchestrator.crossPool')})*` : '';
            lines.push(`$(git-branch) **${tBi('Orchestrator', '编排')}** · ${formatInlineCode(planName, 34)} → ${formatInlineCode(execName, 34)}${crossBadge}`);
        } else {
            const id = resolveModelId(usage.model) || usage.model;
            const name = localizePickerEffortLabel(id, usage.modelDisplayName, lang);
            const model = formatHoverText(name, mode === 'compact' ? 32 : 46);
            const accuracy = usage.isEstimated ? tBi('Estimated', '估算') : tBi('Measured', '实测');
            lines.push(`$(hubot) ${model} · ${accuracy}`);
        }

        return {
            id: 'header',
            priority: 0,
            lines,
        };
    }

    private buildContextSection(usage: ContextUsage, mode: EffectiveMode, full: boolean): HoverSection {
        const { used, limit, percent } = getContextReading(usage);
        const remaining = getContextRemaining(used, limit);
        const lines: string[] = [];
        const compactLines: string[] = [];

        if (used !== null && limit !== null && percent !== null) {
            const number = full ? (n: number) => formatNumber(n) : formatTokenCount;
            const gauge = buildUnicodeGauge(percent, 8);
            const lead = `$(dashboard) **${tBi('Context', '上下文')}** \`${gauge}\` **${percent.toFixed(1)}%** · **${number(used)}** / ${number(limit)} tokens`;
            compactLines.push(lead);
            if (mode === 'compact') {
                lines.push(lead);
            } else {
                const nearWarn = percent >= 80
                    ? ` · $(warning) ${tBi('Near compression', '接近自动压缩')}`
                    : '';
                if (!full) {
                    const remInline = remaining
                        ? ` · ${tBi('Remaining', '剩余')} **${number(remaining.tokens)}** (${remaining.percent.toFixed(1)}%)`
                        : '';
                    lines.push(`${lead}${remInline}${nearWarn}`);
                } else {
                    lines.push(lead);
                    if (remaining) {
                        const subParts: string[] = [
                            `${tBi('Remaining', '剩余')} **${number(remaining.tokens)}** (${remaining.percent.toFixed(1)}%)`,
                        ];
                        const detailParts: string[] = [];
                        if (usableCount(usage.totalOutputTokens) && usage.totalOutputTokens > 0) {
                            detailParts.push(`${t('tooltip.modelOutput')} ${formatTokenCount(usage.totalOutputTokens)}`);
                        }
                        if (usableCount(usage.totalToolCallOutputTokens) && usage.totalToolCallOutputTokens > 0) {
                            detailParts.push(`${t('tooltip.toolResults')} ${formatTokenCount(usage.totalToolCallOutputTokens)}`);
                        }
                        if (usableCount(usage.imageGenStepCount) && usage.imageGenStepCount > 0) {
                            detailParts.push(`${t('tooltip.imageGen')} ${usage.imageGenStepCount}`);
                        }
                        if (detailParts.length > 0) {
                            subParts.push(`*(${detailParts.join(' · ')})*`);
                        }
                        lines.push(`${subParts.join(' ')}${nearWarn}`);
                    }
                }
            }
        } else {
            const unavail = tBi('Context measurement unavailable', '暂无上下文计量');
            lines.push(unavail);
            compactLines.push(unavail);
        }

        const criticalAlerts: string[] = [];
        if (usage.compressionDetected) {
            const compression = calculateCompressionStats(usage);
            const label = t(usage.checkpointCompressionDrop > 0 ? 'tooltip.compressed' : 'tooltip.contextDecreased');
            const detail = compression
                ? ` · −${formatTokenCount(compression.dropTokens)}${mode !== 'compact' ? ` (${compression.dropPercent.toFixed(0)}%)` : ''}`
                : '';
            criticalAlerts.push(`$(fold) ${label}${detail}`);
        }
        if (usage.hasGaps) {
            criticalAlerts.push(`$(warning) ${tBi('Some steps are missing', '部分步骤缺失')}`);
        }
        if (percent !== null && percent > 100) {
            criticalAlerts.push(`$(fold) ${tBi('Above the context limit', '已超过上下文上限')}`);
        }
        if (usage.imageGenerationIncomplete) {
            criticalAlerts.push(`$(warning) ${tBi('Image workflow data is incomplete', '图片工作流数据不完整')}`);
        }

        lines.push(...criticalAlerts);
        compactLines.push(...criticalAlerts);

        return {
            id: 'context',
            priority: 0,
            lines: mode === 'compact' ? compactLines : lines,
            compactLines,
        };
    }

    private buildLatestCallSection(mode: EffectiveMode, full: boolean): HoverSection | null {
        const latest = this.cachedExtras?.latestCall;
        if (!latest || mode === 'compact') { return null; }

        const statusBadge = latest.status === 'error'
            ? `$(error) ${tBi('Error', '失败')}`
            : latest.status === 'retried'
                ? `$(warning) ${tBi(`Retry ×${latest.retries}`, `重试 ×${latest.retries}`)}`
                : `$(pass-filled) ${tBi('OK', '成功')}`;

        const header = `$(history) **${t('telemetry.latestCall')}** · ${formatInlineCode(latest.modelLabel, 28)} · ${statusBadge}`;
        const thinkSuffix = latest.thinkingTokens > 0
            ? ` *(${tBi('think', '思考')} ${formatTokenCount(latest.thinkingTokens)})*`
            : '';
        const inOutCell = `${formatNumber(latest.inputTokens)} / ${formatNumber(latest.outputTokens)}${thinkSuffix}`;
        const cacheCell = latest.cacheHitRate !== null
            ? `**${(latest.cacheHitRate * 100).toFixed(2)}%**`
            : '—';
        const costCell = latest.costUsd !== null
            ? `**${formatUsdCost(latest.costUsd, { precision: 'call' })}**`
            : t('telemetry.unpriced');
        const ttftStr = latest.ttftSeconds !== null ? formatLatency(latest.ttftSeconds) : '—';
        const totalStr = latest.totalSeconds !== null ? formatLatency(latest.totalSeconds) : '—';
        const speedStr = latest.speedTokPerSec !== null ? `**${formatSpeed(latest.speedTokPerSec)}**` : '—';
        const timingSpeedCell = `${ttftStr} / ${totalStr} · ${speedStr}`;

        const compactStatus = latest.status !== 'ok' ? ` · ${statusBadge}` : '';
        const compactLine = `$(history) **${t('telemetry.latestCall')}** · ${formatInlineCode(latest.modelLabel, 28)}${compactStatus} · ${cacheCell} · ${costCell} · ${timingSpeedCell}`;

        if (!full) {
            return {
                id: 'latest-call',
                priority: 3,
                lines: [compactLine],
            };
        }

        return {
            id: 'latest-call',
            priority: 3,
            lines: [
                header,
                `| ${tBi('In / Out', '输入 / 输出')} | ${tBi('Cache', '缓存命中')} | ${t('telemetry.cost')} | ${tBi('TTFT / Total · Speed', '首字 / 总耗时 · 速度')} |`,
                '| :--- | ---: | ---: | ---: |',
                `| ${inOutCell} | ${cacheCell} | ${costCell} | ${timingSpeedCell} |`,
            ],
            compactLines: [compactLine],
        };
    }

    private buildSessionKpiSection(
        usage: ContextUsage | null,
        mode: EffectiveMode,
        full: boolean,
    ): HoverSection | null {
        const telemetry = this.cachedTelemetry;
        const primary = telemetry?.primary;
        const hasTel = !!(primary && hasTelemetryReading(primary));
        const sessionCost = this.effectiveSessionCost();
        const sessionUnpriced = !!(this.cachedCostSnapshot.sessionHasUnpriced || this.cachedExtras?.sessionHasUnpriced);
        const todayCostRaw = this.cachedCostSnapshot.todayCostUsd;
        const todayCost = todayCostRaw !== undefined && todayCostRaw !== null && Number.isFinite(todayCostRaw) && todayCostRaw > 0
            ? todayCostRaw
            : null;
        const todayUnpriced = !!this.cachedCostSnapshot.todayHasUnpriced;

        if (!hasTel && sessionCost === null && todayCost === null) { return null; }

        const speed = primary ? (primary.latestGenTokPerSec ?? primary.weightedGenTokPerSec) : null;
        const ttft = primary ? (primary.avgTtftSeconds ?? primary.latestTtftSeconds) : null;
        const cacheRate = primary ? primary.tokenCacheHitRate : null;

        // Compact 1–2 line summary (used directly in compact mode AND as compactLines fallback)
        const compactParts: string[] = [];
        if (speed !== null) { compactParts.push(`**${formatSpeed(speed)}**`); }
        if (ttft !== null) { compactParts.push(`${tBi('TTFT', '首字')} ${formatLatency(ttft)}`); }
        if (cacheRate !== null) { compactParts.push(`${tBi('Cache', '缓存')} ${formatCachePercent(cacheRate)}`); }
        const compactCostParts: string[] = [];
        if (sessionCost !== null) {
            compactCostParts.push(`${t('telemetry.sessionCost')} **${formatUsdCost(sessionCost)}**`);
        } else if (sessionUnpriced && hasTel) {
            compactCostParts.push(`${t('telemetry.sessionCost')} ${t('telemetry.unpriced')}`);
        }
        if (todayCost !== null) {
            compactCostParts.push(`${t('telemetry.todayCost')} **${formatUsdCost(todayCost)}**`);
        }
        const compactLines: string[] = [];
        if (compactParts.length > 0 && compactCostParts.length > 0) {
            compactLines.push(`$(pulse) **${tBi('Speed & Prompt Cache', '速度与提示词缓存')}** · ${compactParts.join(' · ')} · ${compactCostParts.join(' · ')}`);
        } else if (compactParts.length > 0) {
            compactLines.push(`$(pulse) **${tBi('Speed & Prompt Cache', '速度与提示词缓存')}** · ${compactParts.join(' · ')}`);
        } else if (compactCostParts.length > 0) {
            compactLines.push(`$(credit-card) **${t('telemetry.cost')}** · ${compactCostParts.join(' · ')}`);
        }
        if (mode === 'compact') {
            return compactLines.length > 0 ? { id: 'session-kpi', priority: 1, lines: compactLines } : null;
        }

        const scopeMeta: string[] = [];
        if (primary && primary.totalCalls > 0) {
            scopeMeta.push(`${primary.totalCalls} ${tBi(primary.totalCalls === 1 ? 'call' : 'calls', '次调用')}`);
            const warmth = formatCacheWarmthShort(primary.latestCacheState);
            if (warmth) { scopeMeta.push(warmth); }
        }
        const metaSuffix = scopeMeta.length > 0 ? ` *(${scopeMeta.join(' · ')})*` : '';
        const title = `$(graph) **${tBi('Speed & Prompt Cache', '速度与提示词缓存')}**${metaSuffix}`;

        const rows: string[] = [];

        // Row 1: Cost (Session / Today / Savings or Unpriced)
        if (sessionCost !== null || todayCost !== null || sessionUnpriced) {
            const sessionCell = sessionCost !== null
                ? `**${formatUsdCost(sessionCost)}**${sessionUnpriced ? ` *(${tBi('partial', '部分')})*` : ''}`
                : (sessionUnpriced ? t('telemetry.unpriced') : '—');
            const todayCell = todayCost !== null
                ? `**${formatUsdCost(todayCost)}**${todayUnpriced ? ` *(${tBi('partial', '部分')})*` : ''}`
                : '—';
            let costNote = '—';
            if (primary?.estCacheSavingsUsd !== null && primary?.estCacheSavingsUsd !== undefined && primary.estCacheSavingsUsd >= 0.0001) {
                const savedSigned = formatUsdSavings(primary.estCacheSavingsUsd);
                if (savedSigned !== '—') {
                    const savedPositive = savedSigned.replace(/^-/, '');
                    costNote = tBi(`est. ${savedSigned}`, `缓存省 ${savedPositive}`);
                }
            } else if (sessionCost !== null && sessionUnpriced) {
                costNote = t('telemetry.unpriced');
            }
            rows.push(`| ${t('telemetry.cost')} | ${sessionCell} | ${todayCell} | ${costNote} |`);
        }

        // Row 2: Prompt Cache
        if (primary && cacheRate !== null) {
            const ratioCell = `${primary.cachedCallCount}/${primary.totalCalls} ${tBi(primary.totalCalls === 1 ? 'call' : 'calls', '次')}`;
            const detailParts: string[] = [
                `${formatTokenCount(primary.totalCacheReadTokens)}/${formatTokenCount(primary.totalPromptTokens)} tokens`,
            ];
            if (this.cachedExtras?.blendedInputUsdPerMillion !== null && this.cachedExtras?.blendedInputUsdPerMillion !== undefined) {
                detailParts.push(`${t('telemetry.blendedInput')} ${formatUsdPerMillion(this.cachedExtras.blendedInputUsdPerMillion)}`);
            }
            if (full && primary.totalCacheCreationTokens > 0) {
                detailParts.push(`${tBi('write', '写入')} ${formatTokenCount(primary.totalCacheCreationTokens)}`);
            }
            rows.push(`| ${t('telemetry.promptCache')} | **${formatCachePercent(cacheRate)}** | ${ratioCell} | ${detailParts.join(' · ')} |`);
        }

        // Row 3: Speed / TTFT
        if (primary && (speed !== null || ttft !== null)) {
            const speedParts: string[] = [];
            if (primary.latestGenTokPerSec !== null && primary.weightedGenTokPerSec !== null && primary.speedSampleCount > 1) {
                speedParts.push(`**${formatSpeed(primary.latestGenTokPerSec)}**`);
                speedParts.push(`${tBi('avg', '均')} ${formatSpeed(primary.weightedGenTokPerSec)}`);
            } else if (speed !== null) {
                speedParts.push(`**${formatSpeed(speed)}**`);
            }
            if (primary.hasThinking && primary.weightedVisibleTokPerSec !== null) {
                speedParts.push(`${tBi('resp', '可见')} ${formatSpeed(primary.weightedVisibleTokPerSec)}`);
            }
            const speedCell = speedParts.length > 0 ? speedParts.join(' · ') : '—';
            const ttftCell = ttft !== null ? `TTFT **${formatLatency(ttft)}**` : '—';

            const timingNotes: string[] = [];
            if (
                primary.cachedTtftCount >= 1
                && primary.uncachedTtftCount >= 1
                && primary.cachedAvgTtftSeconds !== null
                && primary.uncachedAvgTtftSeconds !== null
            ) {
                const delta = formatSignedPercentDelta(primary.ttftCacheDeltaPct);
                timingNotes.push(`${formatLatency(primary.cachedAvgTtftSeconds)} ${tBi('cached', '命中')} vs ${formatLatency(primary.uncachedAvgTtftSeconds)} ${tBi('uncached', '未命中')}${delta ? ` ${delta}` : ''}`);
            }
            if (full && primary.medianGenTokPerSec !== null && primary.speedSampleCount >= 2) {
                timingNotes.push(`p50 ${formatSpeed(primary.medianGenTokPerSec)}`);
            }
            if (full && primary.medianTtftSeconds !== null && primary.ttftSampleCount >= 2) {
                timingNotes.push(`p50 ${formatLatency(primary.medianTtftSeconds)}`);
            }
            rows.push(`| ${tBi('Speed / TTFT', '速度 / 首字')} | ${speedCell} | ${ttftCell} | ${timingNotes.length > 0 ? timingNotes.join(' · ') : '—'} |`);
        }

        if (rows.length === 0) { return null; }

        const lines: string[] = [
            title,
            `| ${tBi('Metric', '指标')} | ${t('telemetry.sessionCost')} | ${tBi('Today / Ratio', '今日 / 占比')} | ${tBi('Detail', '详情')} |`,
            '| :--- | ---: | ---: | :--- |',
            ...rows,
        ];

        // Optional 1-line Orchestrator Planner vs Executor Split
        if (this.cachedExtras && usage?.orchestratorConfig) {
            const split = computeOrchestratorSplit(
                this.cachedExtras.primaryCalls,
                usage.orchestratorConfig,
                this.cachedCustomPricing,
            );
            if (split) {
                const planCost = split.plannerCostUsd !== null
                    ? ` **${formatUsdCost(split.plannerCostUsd)}**`
                    : '';
                const execCost = split.executorCostUsd !== null
                    ? ` **${formatUsdCost(split.executorCostUsd)}**`
                    : '';
                lines.push(`$(git-branch) **${tBi('Split', '编排拆分')}** · ${t('orchestrator.planner')} ${formatHoverText(split.plannerLabel, 32)} ${split.plannerCalls}×${planCost} ｜ ${t('orchestrator.worker')} ${formatHoverText(split.executorLabel, 32)} ${split.executorCalls}×${execCost}`);
            }
        }

        return {
            id: 'session-kpi',
            priority: 1,
            lines,
            compactLines: compactLines.length > 0 ? compactLines : undefined,
        };
    }

    private buildQuotaSection(
        groups: readonly ModelQuotaGroup[],
        usage: ContextUsage | null,
        mode: EffectiveMode,
        full: boolean,
    ): HoverSection {
        const maxPools = getMaxQuotaRows(full ? 'full' : 'auto', mode);
        const shown = groups.slice(0, maxPools);
        const now = Date.now();
        const title = `$(shield) **${tBi('Quota remaining', '剩余配额')}**`;

        if (groups.length === 0) {
            return {
                id: 'quota',
                priority: 0,
                lines: [title, tBi('Waiting for quota data', '等待配额数据')],
                compactLines: [`${title} · ${tBi('Waiting for quota data', '等待配额数据')}`],
            };
        }

        const orch = usage?.orchestratorConfig;
        const plannerPool = orch?.planModel ? getQuotaPoolKey(resolveModelId(orch.planModel) || orch.planModel) : undefined;
        const executorPool = orch?.executionModel ? getQuotaPoolKey(resolveModelId(orch.executionModel) || orch.executionModel) : undefined;
        const activePool = usage?.model ? getQuotaPoolKey(resolveModelId(usage.model) || usage.model) : undefined;

        const roleSuffix = (group: ModelQuotaGroup): string => {
            if (!group.pool) { return ''; }
            if (plannerPool && executorPool && plannerPool !== executorPool) {
                if (group.pool === plannerPool) { return ` *(${t('orchestrator.planner')})*`; }
                if (group.pool === executorPool) { return ` *(${t('orchestrator.worker')})*`; }
                return '';
            }
            if (activePool && group.pool === activePool) {
                return ` *(${tBi('Active', '当前')})*`;
            }
            return '';
        };

        const hasWeekly = shown.some(g => g.weeklyQuota !== undefined);
        const compactListLines: string[] = [title];
        const singleLineItems: string[] = [];
        const tableRows: string[] = [];

        for (const group of shown) {
            const label = formatHoverText(group.label, mode === 'compact' ? 20 : 24);
            const role = roleSuffix(group);
            const isHighlighted = role.length > 0;
            const poolCell = `${isHighlighted ? `**${label}**` : label}${role}`;
            const fiveHourValid = validQuotaFraction(group.fiveHourQuota?.remainingFraction);
            const fallbackMin = validQuotaFraction(group.minimum);
            const fiveHourFraction = fiveHourValid ?? fallbackMin;
            const fiveHourPct = fiveHourValid !== null
                ? `${Math.round(fiveHourValid * 100)}%`
                : quotaPercentage(group);
            const gauge = fiveHourFraction !== null
                ? `\`${buildUnicodeGauge(fiveHourFraction * 100, 6)}\` `
                : '';

            const fiveHourResetTs = validResetTimestamp(group.fiveHourQuota?.resetTime);
            const reset5h = fiveHourResetTs !== null
                ? (fiveHourResetTs > now
                    ? resetCountdown(fiveHourResetTs, now)
                    : tBi('Ready', '就绪'))
                : quotaResetLabel(group, now, false);

            const weeklyValid = validQuotaFraction(group.weeklyQuota?.remainingFraction);
            const shortLabel = formatHoverText(group.label, 14);
            const shortWeekly = hasWeekly && weeklyValid !== null ? ` (${t('quota.weekly')} ${Math.round(weeklyValid * 100)}%)` : '';
            const shortReset = shown.length <= 2 && reset5h ? ` · ${reset5h}` : '';
            singleLineItems.push(`${isHighlighted ? `**${shortLabel}**` : shortLabel} **${fiveHourPct}**${shortWeekly}${shortReset}`);

            if (hasWeekly) {
                const weeklyPct = weeklyValid !== null
                    ? `**${Math.round(weeklyValid * 100)}%**`
                    : '—';
                const weeklyResetTs = validResetTimestamp(group.weeklyQuota?.resetTime);
                const weeklyReset = weeklyResetTs !== null && weeklyResetTs > now
                    ? resetCountdown(weeklyResetTs, now)
                    : '';
                const resetCell = weeklyReset
                    ? `${t('quota.fiveHour')}: ${reset5h} · ${t('quota.weekly')}: ${weeklyReset}`
                    : reset5h;
                tableRows.push(`| ${poolCell} | ${gauge}**${fiveHourPct}** | ${weeklyPct} | ${resetCell} |`);
                compactListLines.push(`$(layers) ${poolCell} · ${t('quota.fiveHour')} **${fiveHourPct}**${weeklyValid !== null ? ` · ${t('quota.weekly')} ${weeklyPct}` : ''} · ${reset5h}`);
            } else {
                tableRows.push(`| ${poolCell} | ${gauge}**${fiveHourPct}** | ${reset5h} |`);
                compactListLines.push(`$(layers) ${poolCell} · **${fiveHourPct}** · ${reset5h}`);
            }
        }

        const extraNote = groups.length > shown.length
            ? tBi(`+${groups.length - shown.length} more in Models`, `模型页另有 ${groups.length - shown.length} 个配额池`)
            : '';
        if (extraNote) {
            compactListLines.push(extraNote);
        }
        const singleLineCompact = [
            `${title} · ${singleLineItems.join(' ｜ ')}${extraNote ? ` · ${extraNote}` : ''}`,
        ];

        if (mode === 'compact') {
            return {
                id: 'quota',
                priority: 0,
                lines: compactListLines,
                compactLines: singleLineCompact,
            };
        }

        const firstColHeader = full ? tBi('Pool', '额度池') : title;
        const headerRow = hasWeekly
            ? `| ${firstColHeader} | ${t('quota.fiveHour')} | ${t('quota.weekly')} | ${tBi('Reset', '重置')} |`
            : `| ${firstColHeader} | ${tBi('Remaining', '剩余')} | ${tBi('Reset', '重置')} |`;
        const alignRow = hasWeekly ? '| :--- | :--- | ---: | :--- |' : '| :--- | :--- | :--- |';

        const lines = full
            ? [title, headerRow, alignRow, ...tableRows]
            : [headerRow, alignRow, ...tableRows];
        if (extraNote) { lines.push(extraNote); }

        return {
            id: 'quota',
            priority: 0,
            lines,
            compactLines: singleLineCompact,
        };
    }

    private buildAlertsSection(
        usage: ContextUsage | null,
        mode: EffectiveMode,
        full: boolean,
    ): HoverSection | null {
        const lines: string[] = [];
        const now = Date.now();

        // 1. Scheduled Rate-Cutover Countdown (within 14 days for active / orchestrator models)
        const candidateModels = new Set<string>();
        if (usage?.model) { candidateModels.add(usage.model); }
        if (usage?.orchestratorConfig?.planModel) { candidateModels.add(usage.orchestratorConfig.planModel); }
        if (usage?.orchestratorConfig?.executionModel) { candidateModels.add(usage.orchestratorConfig.executionModel); }
        const seenCutoverKeys = new Set<string>();
        for (const candidate of candidateModels) {
            const change = getUpcomingRateChangeForModel(candidate, this.cachedCustomPricing, now, 14);
            if (change && !seenCutoverKeys.has(change.modelKey)) {
                seenCutoverKeys.add(change.modelKey);
                lines.push(`$(clock) **${t('telemetry.rateChange')}** · ${escapeMarkdown(change.familyLabel)} ${tBi(
                    `intro rate ends ${change.effectiveDate} (${change.daysRemaining}d → ${change.multiplier}×)`,
                    `优惠价将于 ${change.effectiveDate} 结束（${change.daysRemaining} 天后 ${change.multiplier}×）`,
                )}`);
            }
        }

        // 2. Model Sunset / Notice Tag (e.g. GPT-OSS 120B)
        const seenNoticeIds = new Set<string>();
        for (const candidate of candidateModels) {
            const activeId = resolveModelId(candidate) || candidate;
            if (seenNoticeIds.has(activeId)) { continue; }
            const cfg = this.cachedConfigs.find(c => (resolveModelId(c.model) || c.model) === activeId);
            if (cfg && cfg.tagTitle && /^notice$/i.test(cfg.tagTitle.trim())) {
                seenNoticeIds.add(activeId);
                const desc = cfg.tagDescription
                    ? formatHoverText(cfg.tagDescription, 48)
                    : tBi('Scheduled for deprecation', '即将下线');
                lines.push(`$(info) **${t('quota.notice')}** · ${formatHoverText(cfg.label, 28)} — ${desc}`);
            }
        }

        // 3. Retry / Error Waste Alert (only when retries occurred)
        const retry = this.cachedExtras?.retryWaste;
        if (retry && retry.retryCount > 0) {
            const wasteCostStr = retry.estWasteCostUsd !== null
                ? ` (${formatUsdCost(retry.estWasteCostUsd)})`
                : '';
            const codeStr = retry.topErrorCode ? ` · ${formatInlineCode(retry.topErrorCode, 16)}` : '';
            lines.push(`$(warning) **${t('telemetry.retryWaste')}** · ${retry.retryCount}× · ${formatTokenCount(retry.retryTokens)} tokens${wasteCostStr}${codeStr}`);
        }

        // 4. AI Credits balance & billing cycle countdown
        if (this.cachedCreditsTotal !== null) {
            const expiry = mode === 'compact' ? '' : ` · ${formatCreditExpiry(this.getDaysUntilRefresh())}`;
            lines.push(`$(sparkle) **${tBi('AI credits', 'AI 积分')}** · **${formatNumber(this.cachedCreditsTotal)}**${expiry}`);
        } else if (this.cachedBillingDay > 0 && (mode !== 'compact' || full)) {
            lines.push(`$(sparkle) **${tBi('AI credits', 'AI 积分')}** · ${tBi('Not reported', '未上报')} · ${formatCreditExpiry(this.getDaysUntilRefresh())}`);
        }

        if (lines.length === 0) { return null; }
        return {
            id: 'alerts',
            priority: 4,
            lines,
            compactLines: [lines.slice(0, 2).join(' ｜ ')],
        };
    }

    private buildFooterSection(mode: EffectiveMode): HoverSection {
        const link = (destination: HoverDestination, icon: string, label: string) => {
            const query = encodeURIComponent(JSON.stringify([destination]));
            return `[${icon} ${label}](command:${MONITOR_COMMAND}?${query})`;
        };
        const refreshLink = `[$(refresh) ${tBi('Refresh', '刷新')}](command:${REFRESH_COMMAND})`;
        const links = mode === 'compact'
            ? [
                link('overview', '$(dashboard)', tBi('Overview', '总览')),
                link('pricing', '$(credit-card)', tBi('Cost', '费用')),
                link('models', '$(layers)', tBi('Models', '模型')),
                refreshLink,
            ]
            : [
                link('overview', '$(dashboard)', tBi('Overview', '总览')),
                link('gmdata', '$(pulse)', tBi('Activity', '活动')),
                link('pricing', '$(credit-card)', tBi('Cost', '费用')),
                link('models', '$(layers)', tBi('Models', '模型')),
                link('settings', '$(gear)', tBi('Settings', '设置')),
                refreshLink,
            ];
        return {
            id: 'footer',
            priority: 0,
            pinBottom: true,
            lines: [links.join(' · ')],
        };
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

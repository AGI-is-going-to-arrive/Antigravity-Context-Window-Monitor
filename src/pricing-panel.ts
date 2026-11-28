// ─── Pricing Tab Content Builder ─────────────────────────────────────────────
// Renders the "Pricing" tab: cost estimation and editable pricing table.

import { getLanguage, tBi } from './i18n';
import type { GMSummary } from './gm-tracker';
import {
    PricingStore,
    PRICING_LAST_UPDATED,
    calculateCosts,
    findPricingWithCustom,
    resolvePricingDetail,
    calculateLedgerModelCosts,
    selectPricingModel,
    samePricingModel,
    getUpcomingRateChanges,
    getOrchestratorPricingMode,
    formatUsdCost,
    formatUsdPerMillion,
    formatUsdSavings,
    type ModelPricing,
    type ModelCostRow,
    type OrchestratorPricingMode,
    type PricingProvenance,
} from './pricing-store';
import { esc, richTipAttrs, tBiHtml, toSafeTipKey } from './webview-helpers';
import { ICON } from './webview-icons';
import {
    formatCurrencyAmount,
    resolveAppCurrencyConfig,
    resolveCurrencyConfig,
    type CurrencyCode,
    type CurrencyInput,
} from './core/currency';
import type { MonthCostBreakdown } from './daily-store';
import {
    normalizeModelDisplayName,
    getModelBaseName,
    resolveModelId,
    getModelDisplayName,
    getModelThinkingEffortLabel,
    localizePickerEffortLabel,
    type OrchestratorSettings,
} from './models';
import type { LedgerSettledEntry, LedgerAccountBucket } from './daily-ledger';

export interface PricingTabOptions {
    /** Recorded ledger day for settled usage without individual call times. */
    ledgerDateKey?: string;
    orchestratorSettings?: OrchestratorSettings | null;
    orchestratorPricingMode?: OrchestratorPricingMode;
    /** Optional 10-currency display configuration (supports all 10 currencies incl. CAD & bound FX). Default: `'USD'`. */
    currency?: CurrencyInput;
    /** Optional custom FX rate override (used when `currency` is passed as a bare CurrencyCode string). */
    customFxRate?: number | null;
    /** Currency code to which `customFxRate` is bound (mismatched rates are rejected per D5). */
    customFxCurrency?: CurrencyCode | string | null;
}

function resolvePricingTabCurrency(options?: PricingTabOptions): CurrencyInput {
    const raw = options?.currency;
    if (raw && typeof raw === 'object') {
        const merged = {
            ...raw,
            ...(raw.customRatePerUsd === undefined && options?.customFxRate !== undefined
                ? { customRatePerUsd: options.customFxRate }
                : {}),
            ...(raw.customFxCurrency === undefined && options?.customFxCurrency !== undefined
                ? { customFxCurrency: options.customFxCurrency }
                : {}),
        };
        const resolved = resolveCurrencyConfig(merged);
        return {
            code: resolved.preset.code,
            customRatePerUsd: resolved.isCustomRate ? resolved.ratePerUsd : null,
            customFxCurrency: resolved.customFxCurrency,
        };
    }
    const resolved = resolveAppCurrencyConfig({
        displayCurrency: raw ?? 'USD',
        customFxRate: options?.customFxRate,
        ...(options?.customFxCurrency !== undefined ? { customFxCurrency: options.customFxCurrency } : {}),
    });
    return {
        code: resolved.preset.code,
        customRatePerUsd: resolved.isCustomRate ? resolved.ratePerUsd : null,
        customFxCurrency: resolved.customFxCurrency,
    };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function buildPricingTabContent(
    summary: GMSummary | null | undefined,
    store: PricingStore,
    monthBreakdown?: MonthCostBreakdown,
    ledgerSettled?: LedgerSettledEntry[],
    todayLedgerActive?: LedgerAccountBucket[],
    hasUnmeteredImageUsage = false,
    options?: PricingTabOptions,
): string {
    const mode: OrchestratorPricingMode = options?.orchestratorPricingMode
        ?? store.getOrchestratorPricingMode?.()
        ?? getOrchestratorPricingMode();
    const custom = store.getCustom();
    let pendingArchiveCost = 0;
    const hasActive = !!((todayLedgerActive && todayLedgerActive.some(b => b.totalCalls > 0)) || (summary && summary.totalCalls > 0));
    const hasSettled = !!(ledgerSettled && ledgerSettled.length > 0);
    const hasGM = hasActive || hasSettled;
    const parts: string[] = [];

    // Upcoming verified price cutover banner (within 45 days)
    const rateChangeBanner = buildUpcomingRateChangeBanner(Date.now());
    if (rateChangeBanner) {
        parts.push(rateChangeBanner);
    }

    // Active Orchestrator Pricing Banner & Mode Toggle (Mapped Base Pricing vs Strict Mode)
    parts.push(buildActiveOrchestratorPricingCard(options?.orchestratorSettings, custom, mode));

    if (hasUnmeteredImageUsage) {
        parts.push(`<section class="card image-cost-unavailable"><h2>${tBiHtml('Image generation costs', '图片生成费用')}</h2><p>${tBiHtml(
            'Image generation was detected, but the IDE did not report separate image token or credit usage. The amounts below are known subtotals and exclude image-generation fees; image generation is not free.',
            '已检测到图片生成，但 IDE 未上报图片独立的 Token 或积分用量。下方金额为已知小计，未计入图片生成费用，不代表生图免费。',
        )}</p><a data-action="openExternalUrl" data-url="https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-image" href="https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-image" target="_blank" rel="noopener noreferrer">${tBiHtml('Official image pricing reference', '官方图片价格参考')}</a></section>`);
    }

    const mergedRowsMap = new Map<string, ModelCostRow>();
    let activeGrandTotal = 0;

    // Both active and modern settled ledgers retain the per-model token totals.
    // Use call timestamps when present to preserve rates across a UTC cutover.
    function addLedgerModelRows(
        modelStats: LedgerAccountBucket['modelStats'],
        recordedCalls: LedgerAccountBucket['recordedCalls'],
        ledgerDateKey?: string,
    ): number {
        let subtotal = 0;
        for (const [modelKey, ms] of Object.entries(modelStats)) {
            if (ms.calls <= 0) { continue; }
            const displayName = normalizeModelDisplayName(modelKey);
            const baseName = getModelBaseName(modelKey) || displayName;
            // Retained call timestamps keep rate changes from re-pricing old
            // usage; custom prices still apply consistently to every call.
            const { pricing, provenance, mappedBaseLabel, inputCost, outputCost, cacheCost, thinkingCost, totalCost, costBreakdownUnavailable, usesHistoricalRates } =
                calculateLedgerModelCosts(modelKey, ms, { recordedCalls }, custom, ledgerDateKey, mode);
            subtotal += totalCost;

            const existing = mergedRowsMap.get(baseName);
            if (existing) {
                existing.inputCost += inputCost;
                existing.outputCost += outputCost;
                existing.cacheCost += cacheCost;
                existing.thinkingCost += thinkingCost;
                existing.totalCost += totalCost;
                existing.inputTokens += ms.inputTokens;
                existing.outputTokens += Math.max(0, ms.outputTokens - ms.thinkingTokens);
                existing.cacheTokens += ms.cacheReadTokens;
                existing.thinkingTokens += ms.thinkingTokens;
                existing.costBreakdownUnavailable ||= costBreakdownUnavailable;
                existing.usesHistoricalRates ||= usesHistoricalRates;
                if (!pricing) {
                    existing.pricing = null;
                    existing.provenance = 'unpriced';
                }
            } else {
                mergedRowsMap.set(baseName, {
                    name: displayName, responseModel: modelKey,
                    inputCost, outputCost, cacheCost, thinkingCost, totalCost,
                    inputTokens: ms.inputTokens,
                    outputTokens: Math.max(0, ms.outputTokens - ms.thinkingTokens),
                    cacheTokens: ms.cacheReadTokens,
                    thinkingTokens: ms.thinkingTokens,
                    pricing: pricing || null,
                    provenance: pricing ? (provenance ?? 'official') : 'unpriced',
                    ...(mappedBaseLabel ? { mappedBaseLabel } : {}),
                    costBreakdownUnavailable,
                    usesHistoricalRates,
                });
            }
        }
        return subtotal;
    }

    if (todayLedgerActive && todayLedgerActive.length > 0) {
        for (const bucket of todayLedgerActive) {
            activeGrandTotal += addLedgerModelRows(bucket.modelStats, bucket.recordedCalls);
        }
    } else {
        // 没有任何今日活跃账本（极罕见），降级使用活跃 Summary 的统计
        const costResult = summary
            ? (options?.orchestratorPricingMode !== undefined
                ? calculateCosts(summary, custom, mode)
                : store.calculateCosts(summary))
            : { rows: [] as ModelCostRow[], grandTotal: 0 };
        activeGrandTotal = costResult.grandTotal;
        for (const r of costResult.rows) {
            mergedRowsMap.set(r.name, { ...r });
        }
    }

    // 归并已结算账本中的模型明细数据
    if (ledgerSettled && ledgerSettled.length > 0) {
        for (const entry of ledgerSettled) {
            if (entry.totalCalls <= 0) { continue; }
            if (entry.modelStats && Object.keys(entry.modelStats).length) {
                pendingArchiveCost += addLedgerModelRows(entry.modelStats, entry.settledCalls ?? [], options?.ledgerDateKey);
                continue;
            }
            // Legacy archives retain only pool totals and per-model call counts.
            pendingArchiveCost += entry.totalEstimatedCost || 0;
            for (const [modelKey, calls] of Object.entries(entry.modelCalls)) {
                const ratio = calls / entry.totalCalls;
                const inputTokens = Math.round(entry.totalInputTokens * ratio);
                const outputTokens = Math.round(entry.totalOutputTokens * ratio);
                const cacheTokens = Math.round(entry.totalCacheRead * ratio);
                const totalCost = (entry.totalEstimatedCost || 0) * ratio;

                const displayName = normalizeModelDisplayName(modelKey);
                const baseName = getModelBaseName(modelKey) || displayName;
                const detail = resolvePricingDetail(modelKey, custom, { at: entry.settledAt, orchestratorPricingMode: mode });
                const pricing = detail.pricing;

                // Only a frozen pool total survives settlement; a rate at its
                // end time cannot reconstruct historical per-token cost parts.
                const inputCost = 0;
                const outputCost = 0;
                const cacheCost = 0;
                const thinkingCost = 0;

                const existing = mergedRowsMap.get(baseName);
                if (existing) {
                    existing.inputCost += inputCost;
                    existing.outputCost += outputCost;
                    existing.cacheCost += cacheCost;
                    existing.totalCost += totalCost;
                    existing.inputTokens += inputTokens;
                    existing.outputTokens += outputTokens;
                    existing.cacheTokens += cacheTokens;
                    existing.costBreakdownUnavailable = true;
                    if (!pricing) {
                        existing.pricing = null;
                        existing.provenance = 'unpriced';
                    }
                } else {
                    mergedRowsMap.set(baseName, {
                        name: displayName, responseModel: modelKey,
                        inputCost, outputCost, cacheCost, thinkingCost, totalCost,
                        inputTokens, outputTokens, cacheTokens,
                        thinkingTokens: 0, pricing: pricing || null,
                        provenance: pricing ? detail.provenance : 'unpriced',
                        ...(detail.mappedBaseLabel ? { mappedBaseLabel: detail.mappedBaseLabel } : {}),
                        costBreakdownUnavailable: true,
                    });
                }
            }
        }
    }

    const rows = [...mergedRowsMap.values()].sort((a, b) => b.totalCost - a.totalCost);

    const currency: CurrencyInput = resolvePricingTabCurrency(options);

    // Monthly total cost summary (always shown if breakdown data exists)
    if (monthBreakdown) {
        parts.push(buildMonthlyCostSummary(monthBreakdown, activeGrandTotal, rows, pendingArchiveCost, custom, hasUnmeteredImageUsage, mode, currency));
    }

    // Highlight the actual called model's editor even if the response uses a
    // shared family or names a different model.
    const calledModelKeys = new Set<string>();
    for (const r of rows) {
        if (r.totalCost > 0 || r.inputTokens > 0 || r.outputTokens > 0 || r.thinkingTokens > 0 || r.cacheTokens > 0) {
            const model = selectPricingModel(r.name, r.responseModel, custom);
            calledModelKeys.add(samePricingModel(model, r.responseModel) ? r.responseModel : model);
        }
    }

    if (hasGM && rows.length > 0) {
        const fullTotal = activeGrandTotal + pendingArchiveCost;
        const merged = store.getMerged();
        parts.push(
            buildCostPanel(rows, fullTotal, summary, ledgerSettled, todayLedgerActive, hasUnmeteredImageUsage, currency),
            buildEditablePricingTable(calledModelKeys, merged, custom, mode),
        );
    } else {
        // No GM data yet — still show the editable pricing table with defaults
        parts.push(
            `<p class="empty-msg">${tBiHtml(
                'Cost analysis will appear after GM data is available. You can configure custom prices below.',
                '费用分析将在 GM 数据可用后显示。您可以在下方配置自定义价格。',
            )}</p>`,
            buildDefaultPricingTable(store.getMerged(), custom, mode),
        );
    }

    return parts.join('');
}

export function getPricingTabStyles(): string {
    return `
    /* ── Cache Savings & Thinking Share Chips ── */
    .cost-chip-saved {
        background: var(--ed-good-tint);
        color: var(--ed-good);
        border-color: var(--ed-good-border);
    }
    .cost-detail-saved {
        font-size: 0.72rem;
        font-weight: 550;
        color: var(--ed-good);
        background: var(--ed-good-tint);
        border: 1px solid var(--ed-good-border);
        border-radius: var(--ed-radius-xs);
        padding: 1px 6px;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .cost-share-sub {
        color: var(--ed-ink-muted);
        font-size: 0.72rem;
    }

    /* ── Unmetered Image Cost Notice ── */
    .image-cost-unavailable {
        background: var(--ed-surface);
        border: 1px solid var(--ed-warn-border);
        border-radius: var(--ed-radius-md);
        padding: 14px 18px;
        margin-bottom: 18px;
    }
    .image-cost-unavailable h2 {
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--ed-warn);
        margin: 0 0 6px;
    }
    .image-cost-unavailable p {
        margin: 0 0 8px;
        font-size: 0.8125rem;
        line-height: 1.54;
        color: var(--ed-ink-secondary);
        max-width: 72ch;
    }
    .image-cost-unavailable a {
        font-size: 0.8125rem;
        font-weight: 550;
        color: var(--ed-accent);
        text-decoration: underline;
        text-underline-offset: 0.2em;
    }

    /* ── Monthly Cost Summary (L1 Hero + L1 Ledger Card) ── */
    .prc-monthly-section {
        margin-bottom: 24px;
    }
    .prc-monthly-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px 12px;
        margin-bottom: 12px;
    }
    .prc-monthly-header h2 {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        font-size: 0.9375rem;
        font-weight: 600;
        line-height: 1.35;
        letter-spacing: -0.012em;
        color: var(--ed-ink);
        min-width: 0;
    }
    .prc-monthly-header h2 svg {
        width: 15px;
        height: 15px;
        color: var(--ed-accent);
        flex-shrink: 0;
    }
    .prc-monthly-grand {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 8px 12px;
        padding: 16px 20px;
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        margin-bottom: 12px;
    }
    .prc-monthly-grand-val {
        font-family: var(--ed-sans);
        font-size: 1.75rem;
        font-weight: 650;
        line-height: 1.15;
        letter-spacing: -0.025em;
        color: var(--ed-ink);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .prc-monthly-grand-val.is-unavailable {
        font-size: 1.05rem;
        font-weight: 600;
        color: var(--ed-ink-muted);
        letter-spacing: 0;
    }
    .prc-monthly-grand-label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--ed-ink-muted);
    }
    .prc-monthly-grand-label.is-partial {
        display: inline-flex;
        align-items: center;
        padding: 2px 9px;
        border-radius: var(--ed-radius-pill);
        background: var(--ed-warn-tint);
        color: var(--ed-warn);
        border: 1px solid var(--ed-warn-border);
        font-size: 0.6875rem;
        font-weight: 600;
        line-height: 1.45;
    }
    .prc-monthly-grand-breakdown {
        font-size: 0.75rem;
        color: var(--ed-ink-muted);
        margin-left: auto;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .prc-monthly-models {
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        overflow: hidden;
    }
    .prc-monthly-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--ed-border);
        transition: background var(--ed-dur-fast) var(--ed-ease);
        min-width: 0;
    }
    .prc-monthly-card:last-child {
        border-bottom: none;
    }
    @media (hover: hover) {
        .prc-monthly-card:hover {
            background: var(--ed-surface-hover);
        }
    }
    .prc-monthly-model-name {
        font-weight: 600;
        font-size: 0.8125rem;
        color: var(--ed-ink);
        flex: 0 1 15em;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .prc-monthly-bar-wrap {
        flex: 1;
        min-width: 48px;
        height: 6px;
        background: var(--ed-track);
        border-radius: var(--ed-radius-pill);
        overflow: hidden;
    }
    .prc-monthly-bar-fill {
        height: 100%;
        border-radius: var(--ed-radius-pill);
        background: var(--ed-accent);
        transition: width 260ms var(--ed-ease);
    }
    .prc-monthly-model-cost {
        font-weight: 650;
        font-size: 0.8125rem;
        color: var(--ed-ink);
        min-width: 64px;
        text-align: right;
        flex-shrink: 0;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .prc-cost-unavailable {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        color: var(--ed-ink-muted);
        font-size: 0.6875rem;
        font-weight: 550;
        line-height: 1.4;
        white-space: nowrap;
    }
    .prc-cost-partial-tag {
        color: var(--ed-warn);
        font-weight: 550;
        font-size: 0.75rem;
    }
    .prc-monthly-note {
        margin: 10px 0 0;
        font-size: 0.75rem;
        line-height: 1.5;
        color: var(--ed-ink-muted);
        display: flex;
        align-items: flex-start;
        gap: 6px;
    }
    .prc-monthly-note svg {
        width: 13px;
        height: 13px;
        flex-shrink: 0;
        margin-top: 2px;
        color: var(--ed-ink-muted);
    }
    .prc-monthly-calendar-link {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 30px;
        padding: 0 11px;
        background: var(--ed-surface);
        border: 1px solid var(--ed-control-border);
        border-radius: var(--ed-radius-sm);
        color: var(--ed-ink);
        font-family: inherit;
        font-size: 0.75rem;
        font-weight: 550;
        cursor: pointer;
        transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease), color var(--ed-dur-fast) var(--ed-ease), transform 100ms var(--ed-ease);
    }
    .prc-monthly-calendar-link svg {
        width: 12px;
        height: 12px;
        color: var(--ed-accent);
        flex-shrink: 0;
    }
    .prc-monthly-calendar-link:focus-visible {
        outline: 2px solid var(--ed-accent);
        outline-offset: 2px;
    }
    .prc-monthly-calendar-link:active { transform: scale(0.98); }
    @media (hover: hover) {
        .prc-monthly-calendar-link:hover {
            background: var(--ed-surface-hover);
            border-color: var(--ed-ink-muted);
        }
    }
    .prc-monthly-empty {
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        color: var(--ed-ink-muted);
        font-size: 0.8125rem;
        text-align: center;
        padding: 18px 16px;
        margin: 0;
    }

    /* ── Unified Cost Panel (Distribution + Breakdown) ── */
    .cost-panel {
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        padding: 16px 18px;
        margin-bottom: 24px;
    }
    .cost-chips {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-bottom: 14px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--ed-border);
    }
    .cost-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 10px;
        border-radius: var(--ed-radius-pill);
        border: 1px solid var(--ed-border);
        background: var(--ed-surface-well);
        color: var(--ed-ink-secondary);
        font-size: 0.75rem;
        font-weight: 500;
        font-variant-numeric: tabular-nums lining-nums;
        white-space: normal;
        overflow-wrap: anywhere;
        max-width: 100%;
    }
    .cost-chip-total {
        background: var(--ed-accent-tint);
        border-color: var(--ed-accent-border);
        color: var(--ed-accent);
        font-weight: 650;
    }
    .cost-chip-total.is-partial {
        background: var(--ed-warn-tint);
        border-color: var(--ed-warn-border);
        color: var(--ed-warn);
    }

    /* Bar chart band inside L1 card */
    .cost-bar-section {
        padding: 2px 0 14px;
        margin-bottom: 14px;
        border-bottom: 1px solid var(--ed-border);
    }
    .cost-sub-header {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--ed-ink);
        margin-bottom: 10px;
    }
    .cost-sub-header svg {
        width: 14px;
        height: 14px;
        color: var(--ed-accent);
        flex-shrink: 0;
    }
    .cost-bar-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 5px 6px;
        border-radius: var(--ed-radius-xs);
        font-size: 0.8125rem;
        transition: background var(--ed-dur-fast) var(--ed-ease);
        min-width: 0;
    }
    @media (hover: hover) {
        .cost-bar-row:hover {
            background: var(--ed-surface-hover);
        }
    }
    .cost-bar-label {
        flex: 0 1 15em;
        min-width: 0;
        max-width: 18em;
        font-weight: 600;
        color: var(--ed-ink);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .cost-bar-track {
        flex: 1;
        min-width: 48px;
        height: 10px;
        border-radius: var(--ed-radius-pill);
        background: var(--ed-track);
        overflow: hidden;
        display: flex;
    }
    .cost-bar-seg {
        height: 100%;
        min-width: 2px;
        transition: width 260ms var(--ed-ease);
    }
    .cost-seg-input { background: var(--ed-chart-input); }
    .cost-seg-output { background: var(--ed-chart-output); }
    .cost-seg-cache { background: var(--ed-chart-cache); }
    .cost-seg-think { background: var(--ed-chart-thinking); }
    .cost-seg-historical { background: var(--ed-ink-muted); opacity: 0.55; }
    .cost-bar-val {
        min-width: 60px;
        text-align: right;
        font-weight: 650;
        font-size: 0.8125rem;
        color: var(--ed-ink);
        flex-shrink: 0;
        font-variant-numeric: tabular-nums lining-nums;
    }

    /* Legend */
    .cost-legend {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
        font-size: 0.75rem;
        color: var(--ed-ink-secondary);
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid var(--ed-border);
    }
    .cost-legend-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .cost-legend-dot {
        width: 8px;
        height: 8px;
        border-radius: var(--ed-radius-pill);
        flex-shrink: 0;
    }

    /* Per-model breakdown rows inside L1 card */
    .cost-detail-section {
        padding: 0;
    }
    .cost-detail-rows {
        display: flex;
        flex-direction: column;
    }
    .cost-detail-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 6px;
        border-bottom: 1px solid var(--ed-border);
        font-size: 0.8125rem;
        transition: background var(--ed-dur-fast) var(--ed-ease);
        min-width: 0;
    }
    .cost-detail-row:last-child {
        border-bottom: none;
    }
    @media (hover: hover) {
        .cost-detail-row:hover {
            background: var(--ed-surface-hover);
        }
    }
    .cost-detail-name {
        flex: 0 1 15em;
        min-width: 0;
        max-width: 18em;
        font-weight: 600;
        color: var(--ed-ink);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .cost-detail-items {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        flex: 1;
        min-width: 0;
    }
    .cost-detail-item {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--ed-ink-secondary);
        font-size: 0.75rem;
        font-variant-numeric: tabular-nums lining-nums;
        padding: 2px 8px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
    }
    .cost-detail-total {
        font-weight: 650;
        color: var(--ed-ink);
        min-width: 60px;
        text-align: right;
        flex-shrink: 0;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .cost-note {
        font-size: 0.75rem;
        color: var(--ed-ink-muted);
        margin: 10px 0 0;
        line-height: 1.5;
    }

    /* ── Structured Info Bar (L2 inset notice, zero left stripe) ── */
    .prc-info-bar {
        display: flex;
        gap: 10px;
        margin-top: 14px;
        padding: 10px 14px;
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-sm);
        font-size: 0.75rem;
        color: var(--ed-ink-secondary);
        line-height: 1.55;
    }
    .prc-info-bar svg {
        flex-shrink: 0;
        width: 14px;
        height: 14px;
        margin-top: 2px;
        color: var(--ed-ink-muted);
    }
    .prc-info-bar-body {
        flex: 1;
        min-width: 0;
    }
    .prc-info-bar-body ul {
        margin: 0;
        padding: 0;
        list-style: none;
    }
    .prc-info-bar-body li {
        position: relative;
        padding-left: 12px;
    }
    .prc-info-bar-body li::before {
        content: '·';
        position: absolute;
        left: 2px;
        color: var(--ed-ink-muted);
        font-weight: 700;
    }
    .prc-info-bar-body li + li {
        margin-top: 4px;
    }
    .prc-info-bar .prc-info-date {
        font-family: var(--ed-mono);
        font-weight: 600;
        color: var(--ed-ink);
    }
    .prc-info-bar.prc-info-warn {
        background: var(--ed-warn-tint);
        border-color: var(--ed-warn-border);
        color: var(--ed-ink-secondary);
    }
    .prc-info-bar.prc-info-warn svg {
        color: var(--ed-warn);
    }

    /* ── Custom Pricing Editor (L1 card + aligned 32px controls) ── */
    .prc-unit-note {
        font-size: 0.78rem;
        font-weight: 450;
        color: var(--ed-ink-muted);
    }
    .prc-edit-section {
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        padding: 16px 18px;
        margin-bottom: 24px;
    }
    .prc-edit-list {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-sm);
        overflow: hidden;
        margin-bottom: 14px;
    }
    .prc-edit-row {
        display: grid;
        grid-template-columns: minmax(10em, 17em) minmax(0, 1fr);
        align-items: stretch;
        background: var(--ed-surface);
        border-bottom: 1px solid var(--ed-border);
        transition: background var(--ed-dur-fast) var(--ed-ease);
    }
    .prc-edit-row:last-child {
        border-bottom: none;
    }
    @media (hover: hover) {
        .prc-edit-row:hover {
            background: var(--ed-surface-hover);
        }
    }
    .prc-edit-row-left {
        display: flex;
        align-items: center;
        padding: 10px 12px;
        border-right: 1px solid var(--ed-border);
        background: var(--ed-surface-well);
        min-width: 0;
    }
    .prc-edit-row.prc-edit-called .prc-edit-row-left {
        background: var(--ed-accent-tint);
    }
    .prc-edit-card-name {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        font-weight: 600;
        font-size: 0.8125rem;
        color: var(--ed-ink);
        min-width: 0;
        max-width: 100%;
    }
    .prc-edit-row.prc-edit-uncalled .prc-edit-card-name {
        color: var(--ed-ink-secondary);
        font-weight: 550;
    }
    .prc-edit-card-name-text {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .prc-edit-row-right {
        flex: 1;
        min-width: 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 14px;
        padding: 8px 12px;
        align-items: center;
    }
    .prc-edit-field {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }
    .prc-edit-field-label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--ed-ink-muted);
        overflow-wrap: break-word;
        word-break: break-word;
        flex: 0 1 6.5em;
        min-width: 3.5em;
    }
    .prc-edit-input {
        appearance: none;
        width: 100%;
        min-width: 56px;
        height: 32px;
        padding: 0 10px;
        font-size: 0.8125rem;
        font-family: inherit;
        font-variant-numeric: tabular-nums lining-nums;
        text-align: right;
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-control-border);
        border-radius: var(--ed-radius-sm);
        color: var(--ed-ink);
        transition: border-color var(--ed-dur-fast) var(--ed-ease), background var(--ed-dur-fast) var(--ed-ease);
    }
    body:is(.vscode-light, [data-vscode-theme-kind="vscode-light"], [data-acm-theme="light"]) .prc-edit-input {
        background: var(--ed-surface);
    }
    .prc-edit-input:focus-visible {
        border-color: var(--ed-accent);
        outline: 2px solid var(--ed-accent);
        outline-offset: 1px;
    }
    @media (hover: hover) {
        .prc-edit-input:hover:not(:disabled) {
            border-color: var(--ed-ink-muted);
        }
    }
    .prc-edit-input:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
    .prc-edit-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
    }
    .prc-btn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 32px;
        padding: 0 14px;
        font-size: 0.78125rem;
        font-family: inherit;
        font-weight: 550;
        border: 1px solid var(--ed-control-border);
        border-radius: var(--ed-radius-sm);
        background: var(--ed-surface);
        color: var(--ed-ink);
        cursor: pointer;
        transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease), color var(--ed-dur-fast) var(--ed-ease), transform 100ms var(--ed-ease);
    }
    @media (hover: hover) {
        .prc-btn:hover:not(:disabled) {
            background: var(--ed-surface-hover);
            border-color: var(--ed-ink-muted);
        }
    }
    .prc-btn:active:not(:disabled) { transform: scale(0.98); }
    .prc-btn:focus-visible {
        outline: 2px solid var(--ed-accent);
        outline-offset: 2px;
    }
    .prc-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
    .prc-btn-primary {
        background: var(--ed-accent);
        border-color: transparent;
        color: var(--ed-accent-ink);
    }
    @media (hover: hover) {
        .prc-btn-primary:hover:not(:disabled) {
            background: var(--ed-accent-hover);
            border-color: transparent;
            color: var(--ed-accent-ink);
        }
    }
    .prc-btn-primary .bi-sep,
    .prc-btn-primary .bi-zh {
        color: inherit;
        opacity: 0.82;
    }
    .prc-feedback {
        font-size: 0.78125rem;
        color: var(--ed-good);
        font-weight: 600;
        opacity: 0;
        transition: opacity 220ms var(--ed-ease);
    }
    .prc-custom-badge,
    .prc-called-badge,
    .prc-mapped-badge,
    .prc-unpriced-badge {
        display: inline-flex;
        align-items: center;
        font-size: 0.6875rem;
        font-weight: 600;
        line-height: 1.4;
        padding: 1px 7px;
        border-radius: var(--ed-radius-pill);
        border: 1px solid;
        flex-shrink: 0;
    }
    .prc-custom-badge {
        background: var(--ed-surface);
        color: var(--ed-warn);
        border-color: var(--ed-warn-border);
    }
    .prc-called-badge {
        background: var(--ed-surface);
        color: var(--ed-accent);
        border-color: var(--ed-accent-border);
    }
    .prc-mapped-badge {
        background: var(--ed-surface);
        color: var(--ed-accent);
        border-color: var(--ed-accent-border);
    }
    .prc-unpriced-badge {
        background: var(--ed-surface);
        color: var(--ed-ink-muted);
        border-color: var(--ed-border-strong);
    }
    body .tab-pane :is(.prc-called-badge, .prc-custom-badge, .prc-mapped-badge, .cost-chip-total) :is(.bi-sep, .bi-zh) {
        color: inherit;
    }

    /* ── Active Orchestrator Pricing Card & Mode Toggle ── */
    .prc-orch-card {
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        padding: 14px 16px;
        margin-bottom: 18px;
    }
    .prc-orch-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px 12px;
        margin-bottom: 10px;
    }
    .prc-orch-title {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        margin: 0;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--ed-ink);
    }
    .prc-orch-title svg {
        width: 15px;
        height: 15px;
        color: var(--ed-accent);
        flex-shrink: 0;
    }
    .prc-orch-toggle {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 3px;
        border-radius: var(--ed-radius-sm);
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
    }
    .prc-orch-toggle-btn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        border-radius: var(--ed-radius-xs);
        border: 1px solid transparent;
        background: transparent;
        color: var(--ed-ink-secondary);
        font-family: inherit;
        font-size: 0.72rem;
        font-weight: 550;
        cursor: pointer;
        transition: background var(--ed-dur-fast) var(--ed-ease), color var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease);
    }
    .prc-orch-toggle-btn.is-active {
        background: var(--ed-surface);
        border-color: var(--ed-accent-border);
        color: var(--ed-accent);
        font-weight: 650;
    }
    .prc-orch-toggle-btn:focus-visible {
        outline: 2px solid var(--ed-accent);
        outline-offset: 1px;
    }
    .prc-orch-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 10px;
    }
    .prc-orch-role {
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-sm);
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
    }
    .prc-orch-role-head {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 0.72rem;
        font-weight: 600;
        color: var(--ed-ink-muted);
    }
    .prc-orch-role-model {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--ed-ink);
        min-width: 0;
    }
    .prc-orch-effort {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        color: var(--ed-ink-secondary);
        font-size: 0.6875rem;
        font-weight: 550;
    }
    .prc-orch-rates {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 10px;
        font-size: 0.72rem;
        color: var(--ed-ink-secondary);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .prc-orch-note {
        margin: 0;
        font-size: 0.72rem;
        line-height: 1.5;
        color: var(--ed-ink-muted);
    }
    .prc-mapped-sub {
        font-size: 0.6875rem;
        font-weight: 500;
        color: var(--ed-ink-muted);
    }
    @media (max-width: 640px) {
        .prc-orch-grid {
            grid-template-columns: minmax(0, 1fr);
        }
    }

    /* ── Responsive Breakpoints (Zero Overflow down to 320px) ── */
    @media (max-width: 640px) {
        .prc-monthly-grand {
            padding: 14px 16px;
        }
        .prc-monthly-grand-breakdown {
            margin-left: 0;
            flex-basis: 100%;
        }
        .prc-monthly-card,
        .cost-bar-row {
            flex-wrap: wrap;
            gap: 6px 10px;
        }
        .prc-monthly-model-name,
        .cost-bar-label {
            flex: 1 1 100%;
            max-width: 100%;
            white-space: normal;
            overflow-wrap: anywhere;
        }
        .cost-detail-row {
            flex-wrap: wrap;
        }
        .cost-detail-name {
            flex: 1 1 100%;
            max-width: 100%;
            white-space: normal;
            overflow-wrap: anywhere;
        }
        .cost-detail-items {
            flex-basis: 120px;
        }
        .prc-edit-row {
            grid-template-columns: minmax(0, 1fr);
        }
        .prc-edit-row-left {
            border-right: none;
            border-bottom: 1px solid var(--ed-border);
        }
    }
    @media (max-width: 440px) {
        .prc-edit-row-right {
            grid-template-columns: minmax(0, 1fr);
        }
        .prc-edit-section,
        .cost-panel {
            padding: 12px 14px;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .prc-monthly-card,
        .prc-monthly-bar-fill,
        .prc-monthly-calendar-link,
        .cost-bar-row,
        .cost-bar-seg,
        .cost-detail-row,
        .prc-edit-row,
        .prc-edit-input,
        .prc-btn,
        .prc-orch-toggle-btn,
        .prc-feedback {
            transition: none;
        }
    }
    `;
}

// ─── Shared Cost Formatters ──────────────────────────────────────────────────

function fmtCost(n: number, currency: CurrencyInput = 'USD'): string {
    if (!Number.isFinite(n)) { return '—'; }
    const resolved = resolveCurrencyConfig(currency);
    if (resolved.preset.code === 'USD' && !resolved.isCustomRate) {
        const abs = Math.abs(n);
        const precision = abs > 0 && abs < 0.01 ? 'standard' : 'call';
        return formatUsdCost(n, { precision });
    }
    return formatCurrencyAmount(n, currency, { mode: 'standard' });
}

function fmtSavedMagnitude(usd: number, currency: CurrencyInput = 'USD'): string | null {
    if (!Number.isFinite(usd) || usd < 0.0001) { return null; }
    const resolved = resolveCurrencyConfig(currency);
    if (resolved.preset.code === 'USD' && !resolved.isCustomRate) {
        const signed = formatUsdSavings(usd);
        if (signed === '—') { return null; }
        return signed.replace(/^-/, '');
    }
    return formatCurrencyAmount(usd, currency, { mode: 'standard' });
}

function renderProvenanceBadge(
    provenance: PricingProvenance | undefined,
    mappedBaseLabel?: string,
    keySuffix = 'badge',
): string {
    const safeKey = toSafeTipKey(keySuffix);
    if (provenance === 'custom') {
        const tip = richTipAttrs(
            `prc-prov-custom-${safeKey}`,
            tBi('Custom Override', '自定义价格'),
            tBi(
                'Uses the custom per-1M token rates you saved below, overriding all built-in API reference rates.',
                '使用你在下方保存的自定义每百万 Token 单价，优先级高于所有内置 API 参考价。',
            ),
            tBi('Clear all fields in a row to restore built-in rates', '清空该行全部字段即可恢复内置参考价'),
        );
        return `<span class="prc-custom-badge" data-pricing-provenance="custom" ${tip} tabindex="0">${tBiHtml('Custom', '自定义')}</span>`;
    }
    if (provenance === 'mapped_base') {
        const baseTextEn = mappedBaseLabel
            ? `Estimated via ${mappedBaseLabel} public API reference rates (Mapped Base Pricing).`
            : 'Estimated via the mapped base model public API reference rates (Mapped Base Pricing).';
        const baseTextZh = mappedBaseLabel
            ? `按底座模型 ${mappedBaseLabel} 的公开 API 参考价估算（按底座估算模式）。`
            : '按对应底座模型的公开 API 参考价估算（按底座估算模式）。';
        const metaText = tBi(
            'Mapped Base Pricing estimates legacy orchestrator usage via its base model; Strict Mode leaves it unpriced unless custom-overridden.',
            '按底座估算会自动套用底座费率；切换严格模式后将保持待确认，仅在手动自定义后计费。',
        );
        const tip = richTipAttrs(
            `prc-prov-mapped-${safeKey}`,
            tBi('Est. via Base Model', '按底座估算'),
            tBi(baseTextEn, baseTextZh),
            metaText,
        );
        return `<span class="prc-mapped-badge" data-pricing-provenance="mapped_base" ${tip} tabindex="0">${tBiHtml('Est. via Base Model', '按底座估算')}</span>`;
    }
    if (provenance === 'unpriced') {
        const tip = richTipAttrs(
            `prc-prov-unpriced-${safeKey}`,
            tBi('Price Unavailable', '价格待确认'),
            tBi(
                'No verified public API rate (or call timestamp for a dated rate change) applies to this model, so its usage is excluded from totals.',
                '该模型暂无已核实的公开 API 单价（或缺少调价所需的调用日期），因此暂未计入总费用。',
            ),
            tBi('Missing prices are never treated as $0; enter custom rates below to include', '缺失单价不会按 $0 计算；可在下方自定义单价计入'),
        );
        return `<span class="prc-unpriced-badge" data-pricing-provenance="unpriced" ${tip} tabindex="0">${tBiHtml('Price unavailable', '价格待确认')}</span>`;
    }
    return '';
}

/**
 * Active Orchestrator Pricing Banner & Mode Toggle card.
 * Shows currently configured Orchestrator Model + Executor Model (with thinking effort &
 * effective input/output/cache/thinking rates) and a toggle between Mapped Base Pricing (Default)
 * and Strict Mode. Exported for standalone tests and Phase B integration.
 */
export function buildActiveOrchestratorPricingCard(
    orchestratorSettings: OrchestratorSettings | null | undefined,
    customPricing: Record<string, ModelPricing> = {},
    mode: OrchestratorPricingMode = getOrchestratorPricingMode(),
): string {
    const lang = getLanguage();
    const orchSvg = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8.5 7.5 11 15.5"/><path d="M15.5 7.5 13 15.5"/></svg>`;

    const renderRoleCard = (
        roleKey: 'orchestrator' | 'executor',
        titleEn: string,
        titleZh: string,
        modelId: string,
        rawLabel: string,
    ): string => {
        const label = localizePickerEffortLabel(modelId, rawLabel || getModelDisplayName(modelId) || modelId, lang);
        const effort = getModelThinkingEffortLabel(modelId, lang);
        const detail = resolvePricingDetail(modelId, customPricing, { orchestratorPricingMode: mode });
        const badge = renderProvenanceBadge(detail.provenance, detail.mappedBaseLabel, `orch-card-${roleKey}`);
        const effortHtml = effort
            ? `<span class="prc-orch-effort" ${richTipAttrs(
                `prc-orch-effort-${roleKey}`,
                tBi('Thinking Effort Tier', '思考深度档位'),
                tBi(
                    'Controls how much reasoning effort the model spends per turn. Published per-1M token rates are identical across effort tiers.',
                    '控制模型每轮投入的思考深度；同一模型家族各思考档位的每百万 Token 公开参考单价一致。',
                ),
                tBi(`Active tier: ${effort}`, `当前档位：${effort}`),
            )}>${esc(effort)}</span>`
            : '';
        const ratesHtml = detail.pricing
            ? `<div class="prc-orch-rates">
                <span>${tBiHtml('In', '输入')} ${esc(formatUsdPerMillion(detail.pricing.input))}</span>
                <span>${tBiHtml('Out', '输出')} ${esc(formatUsdPerMillion(detail.pricing.output))}</span>
                <span>${tBiHtml('Cache', '缓存')} ${esc(formatUsdPerMillion(detail.pricing.cacheRead))}</span>
                <span>${tBiHtml('Think', '思考')} ${esc(formatUsdPerMillion(detail.pricing.thinking))}</span>
            </div>`
            : `<div class="prc-orch-rates"><span>${tBiHtml('No verified price (set override below)', '暂无核实价格（可在下方自定义）')}</span></div>`;

        return `<div class="prc-orch-role" data-orch-pricing-role="${roleKey}">
            <div class="prc-orch-role-head">
                <span>${tBiHtml(titleEn, titleZh)}</span>
                ${badge}
            </div>
            <div class="prc-orch-role-model">
                <span>${esc(label || '—')}</span>
                ${effortHtml}
            </div>
            ${ratesHtml}
        </div>`;
    };

    const rolesGrid = orchestratorSettings && (orchestratorSettings.effectiveOrchestratorModel || orchestratorSettings.effectiveExecutorModel)
        ? `<div class="prc-orch-grid">
            ${orchestratorSettings.effectiveOrchestratorModel
                ? renderRoleCard('orchestrator', 'Orchestrator Model', '编排模型', orchestratorSettings.effectiveOrchestratorModel, orchestratorSettings.effectiveOrchestratorLabel)
                : ''}
            ${orchestratorSettings.effectiveExecutorModel
                ? renderRoleCard('executor', 'Executor Model', '执行模型', orchestratorSettings.effectiveExecutorModel, orchestratorSettings.effectiveExecutorLabel)
                : ''}
        </div>`
        : '';

    const noteHtml = mode === 'mapped'
        ? tBiHtml(
            'Mapped Base Pricing (Default): Legacy server-managed Orchestrator (Neon, Carbon, Argon) and Orchestrator Worker models estimate costs via their verified Gemini 4 base family rates (honoring UTC cutovers). Custom overrides below always win.',
            '按底座估算（默认）：旧版服务端托管编排模型（Neon、Carbon、Argon）与执行工作模型按对应 Gemini 4 底座模型费率估算（遵循 UTC 调价日期）。下方自定义价格始终优先。',
        )
        : tBiHtml(
            'Strict Mode: Legacy server-managed Orchestrator (Neon, Carbon, Argon) and Orchestrator Worker models remain unpriced unless you enter a custom override below. Custom Orchestrator Mode continues billing automatically via concrete base models.',
            '严格模式：旧版服务端托管编排模型（Neon、Carbon、Argon）与执行工作模型保持待确认状态，仅在下方填写自定义单价后计费；自定义编排模式仍按具体底座模型自动计费。',
        );

    const mappedBtnTip = richTipAttrs(
        'prc-orch-mode-mapped',
        tBi('Mapped Base Pricing (Default)', '按底座估算（默认）'),
        tBi(
            'Estimates legacy server-managed Orchestrator and Worker calls using their underlying Gemini 4 base family API rates.',
            '将旧版服务端托管编排模型与执行工作模型映射到对应 Gemini 4 底座模型参考价进行估算。',
        ),
        tBi('Honors scheduled UTC cutover dates; custom overrides always take precedence', '遵循官方 UTC 调价日期；自定义单价始终优先生效'),
    );
    const strictBtnTip = richTipAttrs(
        'prc-orch-mode-strict',
        tBi('Strict Mode', '严格模式'),
        tBi(
            'Leaves legacy server-managed Orchestrator and Worker calls unpriced unless you explicitly enter custom prices below.',
            '旧版服务端托管编排与工作模型保持未定价状态，仅在手动填入自定义单价后计费。',
        ),
        tBi('Custom Orchestrator concrete models still price automatically', '自定义编排模式下的具体底座模型仍自动计费'),
    );

    return `<section class="prc-orch-card" id="activeOrchestratorPricingCard" data-orchestrator-pricing-mode="${mode}">
        <div class="prc-orch-head">
            <h2 class="prc-orch-title">${orchSvg}<span>${tBiHtml('Orchestrator Pricing', '编排计费')}</span></h2>
            <div class="prc-orch-toggle" role="radiogroup" aria-label="${esc(tBi('Orchestrator pricing mode', '编排计费模式'))}">
                <button type="button" class="prc-orch-toggle-btn${mode === 'mapped' ? ' is-active' : ''}" id="orchPricingModeMapped" data-action="setOrchestratorPricingMode" data-mode="mapped" role="radio" aria-checked="${mode === 'mapped' ? 'true' : 'false'}" ${mappedBtnTip}>${tBiHtml('Mapped Base Pricing (Default)', '按底座估算（默认）')}</button>
                <button type="button" class="prc-orch-toggle-btn${mode === 'strict' ? ' is-active' : ''}" id="orchPricingModeStrict" data-action="setOrchestratorPricingMode" data-mode="strict" role="radio" aria-checked="${mode === 'strict' ? 'true' : 'false'}" ${strictBtnTip}>${tBiHtml('Strict Mode', '严格模式')}</button>
            </div>
        </div>
        ${rolesGrid}
        <p class="prc-orch-note">${noteHtml}</p>
    </section>`;
}

function buildUpcomingRateChangeBanner(nowMs: number): string {
    const changes = getUpcomingRateChanges(nowMs, 45);
    if (changes.length === 0) { return ''; }
    // Group by effective date so Carbon + Argon (2026-12-01) and Flash 3.6/3.7/3.8 (2027-01-01) read cleanly.
    const byDate = new Map<string, typeof changes>();
    for (const change of changes) {
        const list = byDate.get(change.effectiveDate) || [];
        list.push(change);
        byDate.set(change.effectiveDate, list);
    }
    const items: string[] = [];
    for (const [date, group] of byDate.entries()) {
        const names = group.map(g => g.familyLabel).join(', ');
        const days = group[0].daysRemaining;
        const mult = group[0].multiplier;
        const sample = group[0];
        items.push(`<li><strong>${esc(names)}</strong>: ${tBiHtml(
            `intro rate ($${sample.currentPricing.input}/$${sample.currentPricing.output}) ends before ${date} (${days}d left → ${mult}× standard $${sample.nextPricing.input}/$${sample.nextPricing.output})`,
            `优惠价（$${sample.currentPricing.input}/$${sample.currentPricing.output}）将于 ${date} 结束（剩余 ${days} 天 → ${mult}× 标准价 $${sample.nextPricing.input}/$${sample.nextPricing.output}）`,
        )}</li>`);
    }
    const clockSvg = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const bannerTip = richTipAttrs(
        'prc-rate-change-banner',
        tBi('Scheduled API Rate Changes', '官方定时调价说明'),
        tBi(
            'Prices are listed as Input / Output USD per 1M tokens. Calls before the effective date keep their historical intro rate.',
            '括号内价格格式为「输入 / 输出（每百万 Token 美元）」，调价日期前的历史调用会继续按旧优惠价计算。',
        ),
        tBi('Cutover rule: automatic transition at 00:00 UTC on the effective date', '生效规则：按官方公布日期的 UTC 00:00 自动切换'),
    );
    return `<div class="rate-change-banner" role="note">
        <div class="rate-change-banner-head" ${bannerTip} tabindex="0">${clockSvg}<span>${tBiHtml('Upcoming Scheduled Rate Changes', '官方定时调价提醒')}</span></div>
        <ul class="rate-change-banner-list">${items.join('')}</ul>
    </div>`;
}

function fmtTok(n: number): string {
    if (n >= 1_000_000) { return (n / 1_000_000).toFixed(1) + 'M'; }
    if (n >= 1_000) { return (n / 1_000).toFixed(1) + 'k'; }
    return String(n);
}

function fmtTokPrice(tokens: number, price: number): string {
    return tBi(
        `${fmtTok(tokens)} tokens × $${price} per 1M`,
        `${fmtTok(tokens)} tokens × $${price} 每百万`,
    );
}

// ─── Unified Cost Panel ──────────────────────────────────────────────────────

function buildCostPanel(
    rows: import('./pricing-store').ModelCostRow[],
    grandTotal: number,
    summary: GMSummary | null | undefined,
    ledgerSettled?: LedgerSettledEntry[],
    todayLedgerActive?: LedgerAccountBucket[],
    hasUnmeteredImageUsage = false,
    currency: CurrencyInput = 'USD',
): string {
    const priced = rows.filter(r => r.pricing);
    const unpriced = rows.filter(r => !r.pricing);
    if (priced.length === 0 && unpriced.length === 0 && grandTotal <= 0) { return ''; }

    const topModel = priced.length > 0 ? priced[0] : null;
    const totalCalls = (todayLedgerActive ? todayLedgerActive.reduce((s, e) => s + (e.totalCalls || 0), 0) : (summary?.totalCalls || 0))
        + (ledgerSettled ? ledgerSettled.reduce((s, e) => s + (e.totalCalls || 0), 0) : 0);
    const avgPerCall = totalCalls > 0 ? grandTotal / totalCalls : 0;
    const isPartial = unpriced.length > 0 || hasUnmeteredImageUsage;
    const allUnavailable = unpriced.length > 0 && priced.length === 0 && grandTotal <= 0;

    let totalCacheSavedUsd = 0;
    let totalThinkingCostUsd = 0;
    for (const r of priced) {
        if (!r.costBreakdownUnavailable && r.pricing) {
            totalThinkingCostUsd += r.thinkingCost;
            if (r.cacheTokens > 0 && r.pricing.input > r.pricing.cacheRead) {
                totalCacheSavedUsd += (r.cacheTokens * (r.pricing.input - r.pricing.cacheRead)) / 1_000_000;
            }
        }
    }

    const resolvedCurrency = resolveCurrencyConfig(currency);
    let html = `<h2 class="act-section-title"><span>${tBiHtml('Cost Analysis', '费用分析')}</span></h2>`;
    html += `<div class="cost-panel" data-currency="${esc(resolvedCurrency.preset.code)}" data-currency-symbol="${esc(resolvedCurrency.preset.symbol)}" data-fx-rate="${esc(String(resolvedCurrency.ratePerUsd))}" data-fx-custom="${resolvedCurrency.isCustomRate ? 'true' : 'false'}">`;

    // ── Summary chips (inline, compact, frozen #acmRichTipPopover) ──
    html += '<div class="cost-chips">';
    const totalLabel = allUnavailable
        ? `<span>${tBiHtml('Not available', '暂无法估算')}</span>`
        : `<span>${esc(fmtCost(grandTotal, currency))}${isPartial ? ` · ${tBiHtml('Partial total', '已知小计')}` : ''}</span>`;
    const totalTip = allUnavailable
        ? richTipAttrs(
            'prc-cost-chip-total',
            tBi('Cost Not Available', '暂无法估算'),
            tBi(
                'None of the active models have a verified public API price or valid usage date yet, so an API reference total cannot be computed.',
                '当前已调用模型均缺少已核实公开 API 单价或调价所需的调用日期，因此暂无法估算费用。',
            ),
            tBi('Trigger: 0 priced models and $0 known total · Set custom prices below', '触发条件：无已定价模型且已知费用为 0 · 可在下方填写自定义单价'),
        )
        : isPartial
            ? richTipAttrs(
                'prc-cost-chip-total',
                tBi('Partial Total (API Reference)', '已知小计（API 参考估算）'),
                tBi(
                    'Only includes models with verified public API rates; unpriced models or unmetered image-generation fees are excluded. This is an API reference estimate, not your subscription bill.',
                    '仅汇总了有核实 API 单价的模型费用，未计入未定价模型或未上报的图片生成费用；此数值为公开 API 参考估算，并非订阅实际账单。',
                ),
                tBi(
                    `Trigger: ${unpriced.length > 0 ? `${unpriced.length} unpriced model(s)` : ''}${unpriced.length > 0 && hasUnmeteredImageUsage ? ' + ' : ''}${hasUnmeteredImageUsage ? 'unmetered image usage' : ''}`,
                    `触发条件：${unpriced.length > 0 ? `${unpriced.length} 个未定价模型` : ''}${unpriced.length > 0 && hasUnmeteredImageUsage ? ' + ' : ''}${hasUnmeteredImageUsage ? '未计费生图用量' : ''}`,
                ),
            )
            : richTipAttrs(
                'prc-cost-chip-total',
                tBi('Estimated API Reference Cost', 'API 参考估算总费用'),
                tBi(
                    `Estimated ${resolvedCurrency.preset.code} equivalent if billed at public per-1M token API list rates — not your actual Antigravity subscription charge.`,
                    `按各模型公开每百万 Token API 标价折算的 ${resolvedCurrency.preset.code} 参考费用，并非你的 Antigravity 订阅实际扣费。`,
                ),
                tBi('Sum of active today ledger + settled quota cycles', '口径：今日活跃账本 + 已结算配额周期之和'),
            );
    html += `<span class="cost-chip cost-chip-total${isPartial ? ' is-partial' : ''}" ${totalTip} tabindex="0">${totalLabel}</span>`;
    if (topModel) {
        const topTip = richTipAttrs(
            'prc-cost-chip-top',
            tBi('Top Spender', '最高消费模型'),
            tBi(
                `${topModel.name} accounts for the largest share of API reference cost in this view (${fmtCost(topModel.totalCost, currency)}).`,
                `${topModel.name} 在当前统计窗口内占 API 参考估算费用最高（${fmtCost(topModel.totalCost, currency)}）。`,
            ),
            topModel.responseModel && topModel.responseModel !== topModel.name
                ? `${topModel.name} · ${topModel.responseModel}`
                : tBi(`Ranked by total reference ${resolvedCurrency.preset.code} cost`, '按模型估算总费用降序排列'),
        );
        html += `<span class="cost-chip" ${topTip} tabindex="0"><span>${esc(topModel.name)} ${esc(fmtCost(topModel.totalCost, currency))}</span></span>`;
    }
    if (!isPartial) {
        const avgTip = richTipAttrs(
            'prc-cost-chip-avg',
            tBi('Average Cost per Call', '平均单次调用费用'),
            tBi(
                'Average API reference cost across every recorded model call in this period.',
                '当前统计窗口内平均每次模型调用折合的 API 参考费用。',
            ),
            tBi(
                `Formula: ${fmtCost(grandTotal, currency)} ÷ ${totalCalls} ${totalCalls === 1 ? 'call' : 'calls'}`,
                `计算公式：${fmtCost(grandTotal, currency)} ÷ ${totalCalls} 次调用`,
            ),
        );
        html += `<span class="cost-chip" ${avgTip} tabindex="0"><span>${esc(fmtCost(avgPerCall, currency))} ${tBiHtml('per call', '每次')}</span></span>`;
    }
    const totalSavedLabel = fmtSavedMagnitude(totalCacheSavedUsd, currency);
    if (totalSavedLabel) {
        const savedTip = richTipAttrs(
            'prc-cost-chip-saved',
            tBi('Prompt Cache Savings', '提示词缓存节省'),
            tBi(
                'Estimated USD saved because cached prompt tokens are billed at the discounted Cache Read rate instead of the full Input rate.',
                '因命中提示词缓存并按低价缓存读取费率计费，相比全价输入所节省的参考费用。',
            ),
            tBi('Formula: cacheRead × (inputRate − cacheReadRate) ÷ 1M', '计算公式：缓存读取 Token × (输入单价 − 缓存读取单价) ÷ 1M'),
        );
        html += `<span class="cost-chip cost-chip-saved" ${savedTip} tabindex="0"><span>${tBiHtml('Cache saved', '缓存省')} ${esc(totalSavedLabel)}</span></span>`;
    }
    if (totalThinkingCostUsd > 0 && grandTotal > 0) {
        const thinkSharePct = Math.round((totalThinkingCostUsd / grandTotal) * 100);
        if (thinkSharePct > 0) {
            const thinkTip = richTipAttrs(
                'prc-cost-chip-thinking',
                tBi('Thinking Cost Share', '思考费用占比'),
                tBi(
                    'Portion of total API reference cost spent on internal reasoning/thinking tokens.',
                    '总参考费用中由模型内部思考（Thinking）Token 产生的费用占比。',
                ),
                tBi(
                    `Thinking (${fmtCost(totalThinkingCostUsd, currency)}) is priced separately and excluded from Output to prevent double-counting`,
                    `思考费用（${fmtCost(totalThinkingCostUsd, currency)}）单独计价且已从输出费用中剔除，不会重复计算`,
                ),
            );
            html += `<span class="cost-chip" ${thinkTip} tabindex="0"><span>${tBiHtml('Thinking', '思考占比')} ${thinkSharePct}%</span></span>`;
        }
    }
    const modelsTip = richTipAttrs(
        'prc-cost-chip-models',
        tBi('Priced Models', '已定价模型数'),
        tBi(
            'Number of called models that currently have a verified, mapped-base, or custom price applied.',
            '当前窗口内已匹配到官方参考价、底座映射价或自定义单价的模型数量。',
        ),
        unpriced.length > 0
            ? tBi(`${unpriced.length} additional model(s) unpriced`, `另有 ${unpriced.length} 个模型暂未定价`)
            : tBi('All called models are priced', '所有已调用模型均有单价'),
    );
    html += `<span class="cost-chip" ${modelsTip} tabindex="0"><span>${priced.length} ${tBiHtml(priced.length === 1 ? 'model' : 'models', '模型')}</span></span>`;
    if (totalCalls > 0) {
        const callsTip = richTipAttrs(
            'prc-cost-chip-calls',
            tBi('Total Model Calls', '模型调用总数'),
            tBi(
                'Total model invocations aggregated across today’s live ledger and settled quota-reset windows.',
                '今日实时账本与已结算配额周期累计统计的模型调用总次数。',
            ),
        );
        html += `<span class="cost-chip" ${callsTip} tabindex="0"><span>${totalCalls} ${tBiHtml(totalCalls === 1 ? 'call' : 'calls', '调用')}</span></span>`;
    }
    html += '</div>';

    // ── Bar chart (proportional per-model) ──
    const chartSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
    const detailSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    if (priced.length > 0) {
        html += `<div class="cost-bar-section">`;
        html += `<div class="cost-sub-header">${chartSvg}<span>${tBiHtml('Cost Distribution', '费用分布')}</span></div>`;
        const maxCost = priced[0].totalCost;
        for (let ri = 0; ri < priced.length; ri++) {
            const r = priced[ri];
            const rowSlug = `${toSafeTipKey(r.name)}-${ri}`;
            const pct = maxCost > 0 ? (r.totalCost / maxCost) * 100 : 0;
            const total = r.totalCost || 1;
            const inputPct = (r.inputCost / total) * pct;
            const outputPct = (r.outputCost / total) * pct;
            const cachePct = (r.cacheCost / total) * pct;
            const thinkPct = (r.thinkingCost / total) * pct;

            const barLabelTip = richTipAttrs(
                `prc-bar-label-${rowSlug}`,
                r.name,
                tBi(
                    `Estimated API reference total: ${fmtCost(r.totalCost, currency)} (${pct.toFixed(0)}% of top model).`,
                    `该模型 API 参考估算合计 ${fmtCost(r.totalCost, currency)}（占最高模型 ${pct.toFixed(0)}%）。`,
                ),
                r.responseModel && r.responseModel !== r.name ? r.responseModel : undefined,
            );
            const segHistTip = richTipAttrs(
                `prc-bar-seg-${rowSlug}-hist`,
                tBi('Historical Total', '历史汇总费用'),
                tBi(
                    'Preserved frozen cost from settled cycles where per-token cost components are no longer split.',
                    '来自已结算归档周期的冻结总费用，无法再拆分为各类 Token 明细。',
                ),
                tBi(`Recorded total: ${fmtCost(r.totalCost, currency)}`, `已记录合计：${fmtCost(r.totalCost, currency)}`),
            );
            const segInTip = richTipAttrs(
                `prc-bar-seg-${rowSlug}-in`,
                tBi('Input Cost', '输入费用'),
                tBi(
                    `Fresh (non-cached) prompt input tokens billed at the standard input rate: ${fmtCost(r.inputCost, currency)}.`,
                    `未命中缓存的新增提示词输入费用：${fmtCost(r.inputCost, currency)}。`,
                ),
                r.usesHistoricalRates
                    ? `${tBi('Priced at each call date', '按每次调用日期计价')} · ${fmtTok(r.inputTokens)} tokens`
                    : fmtTokPrice(r.inputTokens, r.pricing!.input),
            );
            const segOutTip = richTipAttrs(
                `prc-bar-seg-${rowSlug}-out`,
                tBi('Output Cost (Visible)', '输出费用（可见正文）'),
                tBi(
                    `Visible response tokens excluding thinking tokens: ${fmtCost(r.outputCost, currency)}.`,
                    `可见回复正文 Token 费用（已排除思考 Token，避免重复计费）：${fmtCost(r.outputCost, currency)}。`,
                ),
                r.usesHistoricalRates
                    ? `${tBi('Priced at each call date', '按每次调用日期计价')} · ${fmtTok(r.outputTokens)} tokens`
                    : fmtTokPrice(r.outputTokens, r.pricing!.output),
            );
            const segCacheTip = richTipAttrs(
                `prc-bar-seg-${rowSlug}-cache`,
                tBi('Cache Read Cost', '缓存读取费用'),
                tBi(
                    `Prompt tokens served from cache at discounted Cache Read pricing: ${fmtCost(r.cacheCost, currency)}.`,
                    `从提示词缓存中读取并按折扣费率计费的费用：${fmtCost(r.cacheCost, currency)}。`,
                ),
                r.usesHistoricalRates
                    ? `${tBi('Priced at each call date', '按每次调用日期计价')} · ${fmtTok(r.cacheTokens)} tokens`
                    : fmtTokPrice(r.cacheTokens, r.pricing!.cacheRead),
            );
            const segThinkTip = richTipAttrs(
                `prc-bar-seg-${rowSlug}-think`,
                tBi('Thinking Cost', '思考费用'),
                tBi(
                    `Internal reasoning tokens priced separately and excluded from Output above: ${fmtCost(r.thinkingCost, currency)}.`,
                    `内部思考 Token 费用，单独计价且不重复计入上方输出：${fmtCost(r.thinkingCost, currency)}。`,
                ),
                r.usesHistoricalRates
                    ? `${tBi('Priced at each call date', '按每次调用日期计价')} · ${fmtTok(r.thinkingTokens)} tokens`
                    : fmtTokPrice(r.thinkingTokens, r.pricing!.thinking),
            );

            html += `<div class="cost-bar-row">
                <span class="cost-bar-label" ${barLabelTip} tabindex="0">${esc(r.name)}</span>
                <div class="cost-bar-track">
                    ${r.costBreakdownUnavailable ? `<div class="cost-bar-seg cost-seg-historical" style="width:${pct.toFixed(1)}%" ${segHistTip} tabindex="0"></div>` : `
                    ${inputPct > 0 ? `<div class="cost-bar-seg cost-seg-input" style="width:${inputPct.toFixed(1)}%" ${segInTip} tabindex="0"></div>` : ''}
                    ${outputPct > 0 ? `<div class="cost-bar-seg cost-seg-output" style="width:${outputPct.toFixed(1)}%" ${segOutTip} tabindex="0"></div>` : ''}
                    ${cachePct > 0 ? `<div class="cost-bar-seg cost-seg-cache" style="width:${cachePct.toFixed(1)}%" ${segCacheTip} tabindex="0"></div>` : ''}
                    ${thinkPct > 0 ? `<div class="cost-bar-seg cost-seg-think" style="width:${thinkPct.toFixed(1)}%" ${segThinkTip} tabindex="0"></div>` : ''}`}
                </div>
                <span class="cost-bar-val">${esc(fmtCost(r.totalCost, currency))}</span>
            </div>`;
        }

        // Legend with structured explanations (Output vs Thinking exclusion, Cache Write / 5m TTL note)
        const legInTip = richTipAttrs(
            'prc-legend-input',
            tBi('Input', '输入'),
            tBi('Fresh prompt tokens not served from prompt cache.', '未命中缓存、需完整重新计算的新增输入 Token。'),
        );
        const legOutTip = richTipAttrs(
            'prc-legend-output',
            tBi('Output', '输出'),
            tBi(
                'Visible assistant reply tokens. Thinking tokens are already subtracted here so they are never double-counted.',
                '助手输出的可见正文 Token；已扣除思考 Token，不会与下方思考费用重复计价。',
            ),
            tBi('Formula: max(0, outputTokens − thinkingTokens)', '口径：总输出 Token − 思考 Token'),
        );
        const legCacheTip = richTipAttrs(
            'prc-legend-cache',
            tBi('Cache (Read)', '缓存（读取）'),
            tBi(
                'Prompt tokens read from cache at discounted rates. Cache Write (5-minute TTL) is excluded from estimates because telemetry cannot reliably separate creation tokens or 1-hour TTL.',
                '按折扣价从缓存读取的提示词 Token。因遥测无法可靠区分缓存创建与 1 小时有效期，内置 5 分钟 TTL 的缓存写入暂不计入费用估算。',
            ),
        );
        const legThinkTip = richTipAttrs(
            'prc-legend-thinking',
            tBi('Thinking', '思考'),
            tBi(
                'Internal reasoning tokens generated before the final answer, priced at the model’s thinking rate and shown separately from Output.',
                '模型在给出正文前产生的内部思考 Token，按思考单价计费，并在费用明细中独立于输出展示。',
            ),
        );
        html += `<div class="cost-legend">
            <span class="cost-legend-item" ${legInTip} tabindex="0"><span class="cost-legend-dot cost-seg-input"></span><span>${tBiHtml('Input', '输入')}</span></span>
            <span class="cost-legend-item" ${legOutTip} tabindex="0"><span class="cost-legend-dot cost-seg-output"></span><span>${tBiHtml('Output', '输出')}</span></span>
            <span class="cost-legend-item" ${legCacheTip} tabindex="0"><span class="cost-legend-dot cost-seg-cache"></span><span>${tBiHtml('Cache', '缓存')}</span></span>
            <span class="cost-legend-item" ${legThinkTip} tabindex="0"><span class="cost-legend-dot cost-seg-think"></span><span>${tBiHtml('Thinking', '思考')}</span></span>
        </div>`;
        html += `</div>`; // cost-bar-section
    }

    // ── Per-model cost breakdown ──
    if (priced.length > 0) {
        html += `<div class="cost-detail-section">`;
        html += `<div class="cost-sub-header">${detailSvg}<span>${tBiHtml('Cost Breakdown', '费用明细')}</span></div>`;
        html += '<div class="cost-detail-rows">';
        for (let ri = 0; ri < priced.length; ri++) {
            const r = priced[ri];
            const rowSlug = `${toSafeTipKey(r.name)}-${ri}`;
            const rateMeta = (tokens: number, rate: number): string => r.usesHistoricalRates
                ? `${tBi('Priced at each call date', '按每次调用日期计价')} · ${fmtTok(tokens)} tokens`
                : fmtTokPrice(tokens, rate);
            const rowSavedUsd = !r.costBreakdownUnavailable && r.pricing && r.cacheTokens > 0 && r.pricing.input > r.pricing.cacheRead
                ? (r.cacheTokens * (r.pricing.input - r.pricing.cacheRead)) / 1_000_000
                : 0;
            const rowSavedLabel = fmtSavedMagnitude(rowSavedUsd, currency);
            const rowThinkShare = !r.costBreakdownUnavailable && r.thinkingCost > 0 && r.totalCost > 0
                ? Math.round((r.thinkingCost / r.totalCost) * 100)
                : 0;
            const provBadge = r.provenance === 'mapped_base'
                ? ` ${renderProvenanceBadge('mapped_base', r.mappedBaseLabel, `detail-${rowSlug}`)}`
                : '';
            const nameTip = richTipAttrs(
                `prc-detail-name-${rowSlug}`,
                r.name,
                r.responseModel && r.responseModel !== r.name
                    ? tBi(`Matched backend response model: ${r.responseModel}`, `匹配到的后端响应模型：${r.responseModel}`)
                    : tBi('Per-category API reference cost breakdown for this model.', '此模型按 Token 类别拆分的 API 参考费用明细。'),
                tBi(`Total: ${fmtCost(r.totalCost, currency)}`, `合计：${fmtCost(r.totalCost, currency)}`),
            );
            const detInTip = richTipAttrs(
                `prc-detail-in-${rowSlug}`,
                tBi('Input Cost', '输入费用'),
                tBi('Fresh non-cached input tokens billed at standard input pricing.', '未命中缓存的新增输入 Token 费用。'),
                rateMeta(r.inputTokens, r.pricing!.input),
            );
            const detOutTip = richTipAttrs(
                `prc-detail-out-${rowSlug}`,
                tBi('Output Cost (excl. Thinking)', '输出费用（不含思考）'),
                tBi('Visible output tokens only; thinking tokens are excluded here and itemized separately.', '仅计入可见正文输出 Token；思考 Token 已剔除并单独列项。'),
                rateMeta(r.outputTokens, r.pricing!.output),
            );
            const detCacheTip = richTipAttrs(
                `prc-detail-cache-${rowSlug}`,
                tBi('Cache Read Cost', '缓存读取费用'),
                tBi('Cached prompt tokens billed at the discounted Cache Read rate (cache creation excluded).', '命中提示词缓存的读取费用（缓存创建暂不计入）。'),
                rateMeta(r.cacheTokens, r.pricing!.cacheRead),
            );
            const detThinkTip = richTipAttrs(
                `prc-detail-think-${rowSlug}`,
                tBi('Thinking Cost', '思考费用'),
                tBi('Reasoning/thinking tokens billed separately and excluded from Output above.', '内部思考 Token 费用，单独计费且不计入上方输出。'),
                rateMeta(r.thinkingTokens, r.pricing!.thinking),
            );
            const detSavedTip = richTipAttrs(
                `prc-detail-saved-${rowSlug}`,
                tBi('Saved by Prompt Cache', '缓存预计节省'),
                tBi('Discount earned by serving cached prompt tokens instead of paying full input rates.', '提示词缓存命中相比按全价输入计费节省的参考金额。'),
                tBi(
                    `${fmtTok(r.cacheTokens)} cached × ($${r.pricing!.input} − $${r.pricing!.cacheRead}) / 1M`,
                    `${fmtTok(r.cacheTokens)} 缓存 × ($${r.pricing!.input} − $${r.pricing!.cacheRead}) / 1M`,
                ),
            );
            html += `<div class="cost-detail-row">
                <span class="cost-detail-name" ${nameTip} tabindex="0">${esc(r.name)}${provBadge}</span>
                <div class="cost-detail-items">
                    ${r.costBreakdownUnavailable ? `<span class="cost-note">${tBiHtml('Historical total; token cost breakdown unavailable', '历史总费用；各类 Token 费用明细不可用')}</span>` : `
                    <span class="cost-detail-item" ${detInTip} tabindex="0">
                        <span class="cost-legend-dot cost-seg-input"></span>${esc(fmtCost(r.inputCost, currency))}
                    </span>
                    <span class="cost-detail-item" ${detOutTip} tabindex="0">
                        <span class="cost-legend-dot cost-seg-output"></span>${esc(fmtCost(r.outputCost, currency))}
                    </span>
                    <span class="cost-detail-item" ${detCacheTip} tabindex="0">
                        <span class="cost-legend-dot cost-seg-cache"></span>${esc(fmtCost(r.cacheCost, currency))}
                    </span>
                    ${r.thinkingTokens > 0 ? `<span class="cost-detail-item" ${detThinkTip} tabindex="0">
                        <span class="cost-legend-dot cost-seg-think"></span>${esc(fmtCost(r.thinkingCost, currency))}${rowThinkShare > 0 ? ` <span class="cost-share-sub">(${rowThinkShare}%)</span>` : ''}
                    </span>` : ''}
                    ${rowSavedLabel ? `<span class="cost-detail-saved" ${detSavedTip} tabindex="0">${tBiHtml('Saved', '省')} ${esc(rowSavedLabel)}</span>` : ''}`}
                </div>
                <span class="cost-detail-total">${esc(fmtCost(r.totalCost, currency))}</span>
            </div>`;
        }
        html += '</div>';
        html += '</div>'; // cost-detail-section
    }

    // Unpriced models note
    if (unpriced.length > 0) {
        html += `<p class="cost-note">${tBiHtml(
            unpriced.length === 1
                ? '1 model has calls that lack verified prices or usage dates'
                : `${unpriced.length} models lack verified prices or usage dates`,
            `${unpriced.length} 个模型缺少已核实价格或调用日期`,
        )}: ${unpriced.map(r => esc(r.name)).join(', ')}. ${tBiHtml(
            'The total is incomplete. Set custom prices below to include this usage.',
            '总费用尚不完整，请在下方设置自定义价格以计入这些用量。',
        )}</p>`;
    }

    html += `<div class="prc-info-bar prc-info-warn">${PRC_INFO_SVG}<span class="prc-info-bar-body">${tBiHtml(
        'Costs are API reference estimates based on the public per-1M pricing table below, not your actual Antigravity subscription bill.',
        '以上费用基于下方公开每百万 Token API 参考价估算，并非你的 Antigravity 订阅实际账单。',
    )}</span></div>`;

    html += '</div>';
    return html;
}

const PRC_INFO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

const FIELD_LABELS: Record<string, [string, string]> = {
    input: ['Input', '输入'],
    output: ['Output', '输出'],
    cacheRead: ['Cache Read', '缓存读取'],
    cacheWrite: ['Cache Write', '缓存写入'],
    thinking: ['Thinking', '思考'],
};

function pricingDisplayName(model: string): string {
    const claude = model.match(/^claude-(opus|sonnet)-(\d+)-(\d+)$/);
    if (claude) { return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}.${claude[3]}`; }
    return model.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const UNVERIFIED_PRICE_KEYS = [
    'gemini-pro-orchestrator-neon', 'gemini-pro-orchestrator', 'gemini-pro-orchestrator-argon',
    'gemini-flash-worker-agy',
];

function editablePriceKeys(merged: Record<string, ModelPricing>): string[] {
    const keys = Object.keys(merged);
    const configuredIds = new Set(keys.map(resolveModelId));
    // Respect existing custom keys, including saved localized labels, instead of
    // adding a second blank or conflicting editor for the same identity.
    return [...keys, ...UNVERIFIED_PRICE_KEYS.filter(key => !configuredIds.has(resolveModelId(key)))];
}

function orchestratorPricingNote(mode: OrchestratorPricingMode = getOrchestratorPricingMode()): string {
    const leadEn = 'Custom Orchestrator Mode executes on concrete Orchestrator and Executor models (e.g. Gemini 4 Neon/Carbon/Argon, Claude Opus 5.5, Gemini 4 Hydrogen, Claude Sonnet 5.5) and bills each call automatically at its base model rate with no orchestration surcharge. ';
    const leadZh = '自定义编排模式会直接调用具体的编排模型与执行模型（如 Gemini 4 Neon/Carbon/Argon、Claude Opus 5.5、Gemini 4 Hydrogen、Claude Sonnet 5.5），按每次调用实际记录的底座模型自动计费，无额外编排加价。';
    const tailEn = mode === 'mapped'
        ? 'In Mapped Base Pricing mode, legacy server-managed Orchestrator (Neon/Carbon/Argon) and Orchestrator Worker models estimate via their verified Gemini 4 base family rates (enter custom values above to override, or switch to Strict Mode).'
        : 'In Strict Mode, legacy server-managed Orchestrator (Neon/Carbon/Argon) and Orchestrator Worker entries remain unpriced unless custom-overridden.';
    const tailZh = mode === 'mapped'
        ? '在“按底座估算”模式下，旧版服务端托管编排模型（Neon/Carbon/Argon）与执行工作模型会按对应 Gemini 4 底座费率估算（可在上方填写自定义单价覆盖，或切换为严格模式）。'
        : '在严格模式下，旧版服务端托管编排模型（Neon/Carbon/Argon）与执行工作模型仅在自定义单价后计费。';
    return `<li>${tBiHtml(leadEn + tailEn, leadZh + tailZh)}</li>`;
}

function cutoverGemini4PricingNote(modelName: string, url: string): string {
    return `<li>${tBiHtml(
        `${modelName} standard API reference (USD per 1M tokens): input $2, output including thinking $10, implicit cache reads $0.10 through 2026-11-30; $4, $20, $0.20 from 2026-12-01. Automatic changes use UTC dates; day-only archives use their saved calendar day. Explicit caching is not supported. These are not Batch/Flex rates or Antigravity subscription charges.`,
        `${modelName} 标准 API 参考价（每百万 tokens，USD）：截至 2026-11-30，输入 $2、输出（含思考）$10、隐式缓存读取 $0.10；自 2026-12-01 起为 $4、$20、$0.20。自动切价按 UTC 日期，只有日期的归档按保存的日历日期计价。不支持显式缓存。这不是 Batch/Flex 费率，也不是 Antigravity 订阅收费。`,
    )} <a data-action="openExternalUrl" data-url="${url}" href="${url}" target="_blank" rel="noopener noreferrer">${tBiHtml('Official pricing', '官方价格')}</a></li>`;
}

function neonPricingNote(): string {
    return `<li>${tBiHtml(
        'Gemini 4 Neon standard API reference (USD per 1M tokens), verified 2026-11-22: input $3.00, output including thinking $15.00, implicit cache reads $0.15 (95% off), flat across the full 1M context window. The same rates apply to Low, Medium, High, and Extra High (XHigh). No scheduled price cutover is published. Explicit caching is currently unsupported.',
        'Gemini 4 Neon 标准 API 参考价（每百万 tokens，USD），2026-11-22 核实：输入 $3.00、输出（含思考）$15.00、隐式缓存读取 $0.15（95% 折扣），1M 上下文全窗口统一费率。Low、Medium、High 和 Extra High（XHigh）四档使用相同费率。官网未公布定时调价计划，当前不支持显式缓存。',
    )} <a data-action="openExternalUrl" data-url="https://aistudio.google.com/docs/whats-new-gemini-4-neon" href="https://aistudio.google.com/docs/whats-new-gemini-4-neon" target="_blank" rel="noopener noreferrer">${tBiHtml('Official pricing', '官方价格')}</a></li>`;
}

function hydrogenPricingNote(): string {
    return `<li>${tBiHtml(
        'Gemini 4 Hydrogen standard API reference (USD per 1M tokens), verified 2026-11-13: input $1.50, output including thinking $7.50, implicit cache reads $0.075. The same rates apply to Low, Medium, High and Extra High (XHigh). No scheduled price change is published. Explicit caching is not supported. These are not Batch/Flex rates or Antigravity subscription charges.',
        'Gemini 4 Hydrogen 标准 API 参考价（每百万 tokens，USD），2026-11-13 核实：输入 $1.50、输出（含思考）$7.50、隐式缓存读取 $0.075。Low、Medium、High 和 Extra High（XHigh）四档使用相同费率。官网未公布定时调价计划，不支持显式缓存。这不是 Batch/Flex 费率，也不是 Antigravity 订阅收费。',
    )} <a data-action="openExternalUrl" data-url="https://aistudio.google.com/docs/pricing#gemini-4-hydrogen" href="https://aistudio.google.com/docs/pricing#gemini-4-hydrogen" target="_blank" rel="noopener noreferrer">${tBiHtml('Official pricing', '官方价格')}</a></li>`;
}

function carbonPricingNote(): string {
    return cutoverGemini4PricingNote('Gemini 4 Carbon', 'https://aistudio.google.com/docs/pricing#gemini-4-carbon');
}

function argonPricingNote(): string {
    return cutoverGemini4PricingNote('Gemini 4 Argon', 'https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon');
}

interface PricingEditorRowSpec {
    name: string;
    responseModel: string;
    isCalled: boolean | null;
}

function renderPricingEditorSection(
    entries: PricingEditorRowSpec[],
    custom: Record<string, ModelPricing>,
    mode: OrchestratorPricingMode,
    isDefaultTable: boolean,
): string {
    if (entries.length === 0) { return ''; }
    const fields: (keyof ModelPricing)[] = ['input', 'output', 'cacheRead', 'thinking'];
    const pfx = isDefaultTable ? 'def' : 'edit';
    const unitNoteTip = richTipAttrs(
        isDefaultTable ? 'prc-default-unit-note' : 'prc-edit-unit-note',
        tBi('API Reference Unit', 'API 参考计价单位'),
        tBi(
            'All rates are in USD per 1,000,000 tokens for API reference estimates — separate from Antigravity subscription pricing.',
            '所有价格均以「美元 / 百万 Token」为单位，用于计算公开 API 参考估算值，与 Antigravity 订阅费用无关。',
        ),
    );
    let html = `<h2 class="act-section-title"><span>${tBiHtml('Custom Pricing', '自定义价格')}</span> <span class="prc-unit-note" ${unitNoteTip} tabindex="0">(${tBiHtml('USD per 1M tokens', '每百万 tokens (USD)')})</span></h2><div class="prc-edit-section"><div class="prc-edit-list">`;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const slug = `${toSafeTipKey(entry.responseModel)}-${i}`;
        const detail = resolvePricingDetail(entry.responseModel, custom, { orchestratorPricingMode: mode });
        const pricing = detail.pricing;
        const isCustom = !!custom[entry.responseModel];
        const isMapped = detail.provenance === 'mapped_base';
        const rowStateClass = entry.isCalled === null ? '' : (entry.isCalled ? ' prc-edit-called' : ' prc-edit-uncalled');
        const provBadge = isCustom
            ? renderProvenanceBadge('custom', undefined, `${pfx}-${slug}`)
            : isMapped
                ? renderProvenanceBadge('mapped_base', detail.mappedBaseLabel, `${pfx}-${slug}`)
                : !pricing
                    ? renderProvenanceBadge('unpriced', undefined, `${pfx}-${slug}`)
                    : '';
        const mappedSub = isMapped && detail.mappedBaseLabel
            ? `<span class="prc-mapped-sub">→ ${esc(detail.mappedBaseLabel)}</span>`
            : '';
        const cardNameTip = richTipAttrs(
            `prc-${pfx}-name-${slug}`,
            entry.name,
            entry.responseModel && entry.responseModel !== entry.name
                ? tBi(`Pricing key: ${entry.responseModel}`, `价格表键值：${entry.responseModel}`)
                : tBi('Edit per-1M token USD rates to override built-in reference pricing for this model.', '可编辑每百万 Token 美元单价，覆盖此模型的内置参考价。'),
            isMapped && detail.mappedBaseLabel
                ? tBi(`Currently mapped to ${detail.mappedBaseLabel} (leave blank to keep mapped rate)`, `当前按 ${detail.mappedBaseLabel} 底座估算（留空则保持自动映射）`)
                : undefined,
        );
        const calledBadge = entry.isCalled
            ? `<span class="prc-called-badge" ${richTipAttrs(
                `prc-edit-active-${slug}`,
                tBi('Active Model', '当前已调用'),
                tBi('This model has recorded usage in the current cost window.', '此模型在当前费用统计窗口内存在调用记录。'),
            )}>${tBiHtml('Active', '已调用')}</span>`
            : '';

        html += `<div class="prc-edit-row${rowStateClass}" data-pricing-provenance="${detail.provenance}"><div class="prc-edit-row-left"><span class="prc-edit-card-name" ${cardNameTip} tabindex="0"><span class="prc-edit-card-name-text">${esc(entry.name)}</span>${calledBadge}${provBadge}${mappedSub}</span></div><div class="prc-edit-row-right">`;
        for (const f of fields) {
            const [en, zh] = FIELD_LABELS[f] || [f, f];
            const value = pricing && !isMapped ? String(pricing[f]) : '';
            const placeholder = isMapped && pricing ? String(pricing[f]) : tBi('Not set', '未设置');
            const mappedAttr = isMapped && pricing ? ` data-mapped-value="${esc(String(pricing[f]))}"` : '';
            html += `<div class="prc-edit-field"><span class="prc-edit-field-label">${tBiHtml(en, zh)}</span><input type="number" class="prc-edit-input pricing-input" data-model="${esc(entry.responseModel)}" data-field="${f}" data-original-value="${esc(value)}" data-was-custom="${isCustom ? '1' : '0'}" data-cache-write="${pricing?.cacheWrite ?? 0}"${mappedAttr} value="${esc(value)}" placeholder="${esc(placeholder)}" step="any" min="0" aria-label="${esc(entry.name)} ${esc(tBi(en, zh))}"></div>`;
        }
        html += `</div></div>`;
    }

    const resetLine = isDefaultTable
        ? tBiHtml('Clear all fields in a row to remove its override. Missing prices are not zero prices.', '清空一行全部字段可移除该自定义价格；缺失价格不代表免费。')
        : tBiHtml('Reset restores built-in default prices. Clear all fields in a row to remove its override. Missing prices are not zero prices.', '“恢复默认”将还原内置价格。清空一行全部字段可移除该自定义价格；缺失价格不代表免费。');
    html += `</div><div class="prc-edit-actions"><button class="prc-btn prc-btn-primary" id="pricingSaveBtn"><span>${tBiHtml('Save Prices', '保存价格')}</span></button><button class="prc-btn" id="pricingResetBtn"><span>${tBiHtml('Reset to Default', '恢复默认')}</span></button><span class="prc-feedback" id="pricingFeedback"></span></div>`;
    html += `<div class="prc-info-bar">${PRC_INFO_SVG}<div class="prc-info-bar-body"><ul><li>${tBiHtml('Edit prices above and click Save. Changes persist across sessions.', '编辑上方价格后点击“保存”，修改跨会话持久化。')}</li><li>${resetLine}</li>${orchestratorPricingNote(mode)}${neonPricingNote()}${hydrogenPricingNote()}${carbonPricingNote()}${argonPricingNote()}<li>${tBiHtml('Built-in cache-write rates use the 5-minute TTL. Cache creation is excluded from cost estimates because the available telemetry cannot reliably identify creation tokens or the 1-hour TTL.', '内置缓存写入价格采用 5 分钟有效期。遥测无法可靠区分缓存创建 tokens 及 1 小时有效期，因此费用估算暂不计入缓存创建。')}</li><li>${tBiHtml('Default prices last updated:', '默认价格最后更新：')} <span class="prc-info-date">${PRICING_LAST_UPDATED}</span></li></ul></div></div></div>`;
    return html;
}

function buildEditablePricingTable(
    calledModelKeys: Set<string>,
    merged: Record<string, ModelPricing>,
    custom: Record<string, ModelPricing>,
    mode: OrchestratorPricingMode = getOrchestratorPricingMode(),
): string {
    const editableKeys = editablePriceKeys(merged);
    const editorKeyById = new Map(editableKeys.map(key => [resolveModelId(key), key]));
    const calledEditorKeys = new Set(Array.from(calledModelKeys, key => {
        const id = resolveModelId(key);
        return id && !editableKeys.includes(key) ? editorKeyById.get(id) || key : key;
    }));
    const allEntries: PricingEditorRowSpec[] = [];
    for (const responseModel of calledEditorKeys) {
        allEntries.push({ name: normalizeModelDisplayName(responseModel), responseModel, isCalled: true });
    }
    for (const model of editableKeys) {
        if (!calledEditorKeys.has(model)) {
            const resolved = resolveModelId(model);
            allEntries.push({ name: resolved ? getModelDisplayName(resolved) : pricingDisplayName(model), responseModel: model, isCalled: false });
        }
    }
    return renderPricingEditorSection(allEntries, custom, mode, false);
}

/** Pricing table using default keys — shown when no GM data is available. */
function buildDefaultPricingTable(
    merged: Record<string, ModelPricing>,
    custom: Record<string, ModelPricing>,
    mode: OrchestratorPricingMode = getOrchestratorPricingMode(),
): string {
    const allEntries: PricingEditorRowSpec[] = editablePriceKeys(merged).map(model => {
        const resolved = resolveModelId(model);
        return { name: resolved ? getModelDisplayName(resolved) : pricingDisplayName(model), responseModel: model, isCalled: null };
    });
    return renderPricingEditorSection(allEntries, custom, mode, true);
}

// ─── Monthly Cost Summary Builder ────────────────────────────────────────────

const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAMES_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const CALENDAR_LINK_ICON = ICON.clock;
const DOLLAR_ICON = ICON.chart;

/** Build the monthly cost summary section for the Pricing tab. */
function buildMonthlyCostSummary(
    breakdown: MonthCostBreakdown,
    currentCycleCost: number,
    currentCycleRows: ModelCostRow[],
    pendingArchiveCost: number,
    customPricing: Record<string, ModelPricing>,
    hasUnmeteredImageUsage = false,
    mode: OrchestratorPricingMode = getOrchestratorPricingMode(),
    currency: CurrencyInput = 'USD',
): string {
    const monthEn = MONTH_NAMES_EN[breakdown.month - 1];
    const monthZh = MONTH_NAMES_ZH[breakdown.month - 1];
    const now = new Date();
    const isCurrentMonth = breakdown.year === now.getFullYear() && breakdown.month === (now.getMonth() + 1);

    // Merge archived data with current live cycle
    const mergedModels = new Map<string, { name: string; totalCost: number; calls: number; inputTokens: number; outputTokens: number; thinkingTokens: number }>();

    // 1. Archived cycles from DailyStore
    for (const m of breakdown.models) {
        const cleanName = getModelBaseName(m.name) || m.name;
        const existing = mergedModels.get(cleanName);
        if (existing) {
            existing.totalCost += m.totalCost;
            existing.calls += m.calls;
            existing.inputTokens += m.inputTokens;
            existing.outputTokens += m.outputTokens;
            existing.thinkingTokens += m.thinkingTokens;
        } else {
            mergedModels.set(cleanName, {
                name: cleanName,
                totalCost: m.totalCost,
                calls: m.calls,
                inputTokens: m.inputTokens,
                outputTokens: m.outputTokens,
                thinkingTokens: m.thinkingTokens,
            });
        }
    }

    // 2. Current live cycle (not yet archived)
    if (isCurrentMonth && currentCycleRows.length > 0) {
        for (const row of currentCycleRows) {
            const key = getModelBaseName(row.name) || row.name;
            const existing = mergedModels.get(key);
            if (existing) {
                existing.totalCost += row.totalCost;
                existing.calls += row.inputTokens > 0 ? 1 : 0; // ModelCostRow is per-model aggregate; count as 1 active model entry
                existing.inputTokens += row.inputTokens;
                existing.outputTokens += row.outputTokens;
                existing.thinkingTokens += row.thinkingTokens;
            } else {
                mergedModels.set(key, {
                    name: key,
                    totalCost: row.totalCost,
                    calls: 1,
                    inputTokens: row.inputTokens,
                    outputTokens: row.outputTokens,
                    thinkingTokens: row.thinkingTokens,
                });
            }
        }
    }

    const grandTotal = breakdown.grandTotal + (isCurrentMonth ? currentCycleCost : 0) + (isCurrentMonth ? pendingArchiveCost : 0);
    const totalCycles = breakdown.cycleCount + (isCurrentMonth && currentCycleCost > 0 ? 1 : 0);
    const models = [...mergedModels.values()].sort((a, b) => b.totalCost - a.totalCost);
    const unpricedNames = new Set(models
        .filter(m => m.totalCost <= 0 && !findPricingWithCustom(m.name, customPricing, undefined, mode))
        .map(m => m.name));
    if (isCurrentMonth) {
        for (const row of currentCycleRows) {
            if (!row.pricing) { unpricedNames.add(getModelBaseName(row.name) || row.name); }
        }
    }
    const maxCost = models.length > 0 ? models[0].totalCost : 1;

    // Determine if data is incomplete (started mid-month)
    let dataCoverageNote = '';
    if (breakdown.earliestDate && isCurrentMonth) {
        const dayNum = parseInt(breakdown.earliestDate.split('-')[2], 10);
        if (dayNum > 1) {
            dataCoverageNote = tBiHtml(
                `Data recorded from ${breakdown.earliestDate}. Earlier usage in this month is not tracked.`,
                `数据从 ${breakdown.earliestDate} 开始记录。本月更早的用量未被追踪。`,
            );
        }
    }

    let html = `<section class="prc-monthly-section">`;

    // Header with title and calendar link
    html += `<div class="prc-monthly-header">
        <h2>${DOLLAR_ICON} <span>${tBiHtml(`${monthEn} ${breakdown.year} Cost`, `${breakdown.year}年${monthZh}费用`)}</span></h2>
        <button class="prc-monthly-calendar-link" data-switch-tab="calendar">
            ${CALENDAR_LINK_ICON} <span>${tBiHtml('View History', '查看历史')}</span>
        </button>
    </div>`;

    if (models.length === 0 && grandTotal === 0) {
        html += `<p class="prc-monthly-empty">${tBiHtml(
            'No cost data recorded for this month yet.',
            '本月暂无费用数据。',
        )}</p>`;
        html += `</section>`;
        return html;
    }

    // Grand total highlight
    const archivedLabel = isCurrentMonth
        ? tBiHtml(
            `${breakdown.cycleCount} archived cycle${breakdown.cycleCount !== 1 ? 's' : ''} + current`,
            `${breakdown.cycleCount} 个已归档周期 + 当前`,
        )
        : tBiHtml(
            `${totalCycles} cycle${totalCycles !== 1 ? 's' : ''}`,
            `${totalCycles} 个周期`,
        );

    const allUnavailable = unpricedNames.size === models.length && grandTotal <= 0;
    const isPartial = unpricedNames.size > 0 || hasUnmeteredImageUsage;

    const monthlyValTip = allUnavailable
        ? richTipAttrs(
            'prc-monthly-grand-val',
            tBi('Monthly Cost Not Available', '本月费用暂无法估算'),
            tBi(
                'None of this month’s recorded models have verified public API rates or valid cutover timestamps yet.',
                '本月已记录的模型均缺少已核实的公开 API 单价或调价日期，因此暂无法汇总估算。',
            ),
            tBi('Set custom overrides below to estimate unpriced usage', '可在下方设置自定义价格后重新估算'),
        )
        : richTipAttrs(
            'prc-monthly-grand-val',
            tBi('Monthly API Reference Estimate', '本月 API 参考估算总费用'),
            tBi(
                'Estimated USD equivalent based on public per-1M API list rates across the month — separate from your Antigravity subscription fee.',
                '按各模型公开每百万 Token API 标价折算的本月参考费用，并非你的 Antigravity 订阅实际扣费。',
            ),
            isPartial
                ? tBi('Partial total: excludes unpriced models or unmetered image generation', '已知小计：未计入缺少单价的模型或未计费生图用量')
                : tBi('Includes archived calendar cycles plus current live usage', '汇总范围：已归档日历周期 + 当前活跃周期'),
        );

    const monthlyLabelTip = isPartial
        ? richTipAttrs(
            'prc-monthly-grand-label',
            tBi('Partial Total', '已知小计'),
            tBi(
                'Shown whenever one or more models lack verified pricing/usage dates or unmetered image generation occurred.',
                '当存在未定价模型、缺少调价日期或检测到未计费图片生成时，总额标示为已知小计。',
            ),
            tBi(
                `${unpricedNames.size} unpriced model(s)${hasUnmeteredImageUsage ? ' + unmetered image usage' : ''}`,
                `${unpricedNames.size} 个未定价模型${hasUnmeteredImageUsage ? ' + 未计费图片生成' : ''}`,
            ),
        )
        : richTipAttrs(
            'prc-monthly-grand-label',
            tBi('Monthly Total', '本月总计'),
            tBi(
                'All recorded models in this month have verified, mapped-base, or custom API reference pricing.',
                '本月所有已记录模型均已匹配官方、底座映射或自定义 API 参考单价。',
            ),
        );

    const cyclesTip = richTipAttrs(
        'prc-monthly-cycles',
        tBi('Archived Cycles + Current', '已归档周期 + 当前'),
        tBi(
            'Each archived cycle is a completed quota-reset window or finished day saved to Calendar history; "+ current" merges live unarchived usage.',
            '每个已归档周期对应一次配额重置或跨日结算后写入日历的窗口，“+ 当前”会实时并入今日尚未归档的用量。',
        ),
        isCurrentMonth
            ? tBi(`${breakdown.cycleCount} archived + live today`, `${breakdown.cycleCount} 个已归档周期 + 今日实时`)
            : tBi(`${totalCycles} archived cycles`, `共 ${totalCycles} 个已归档周期`),
    );

    html += `<div class="prc-monthly-grand">
        <span class="prc-monthly-grand-val${allUnavailable ? ' is-unavailable' : ''}" ${monthlyValTip} tabindex="0">${allUnavailable ? tBiHtml('Not available', '暂无法估算') : esc(fmtCost(grandTotal, currency))}</span>
        <span class="prc-monthly-grand-label${isPartial ? ' is-partial' : ''}" ${monthlyLabelTip} tabindex="0">${isPartial ? tBiHtml('Partial total', '已知小计') : tBiHtml('Total', '总计')}</span>
        <span class="prc-monthly-grand-breakdown" ${cyclesTip} tabindex="0">${archivedLabel}</span>
    </div>`;

    // Per-model rows with proportional bar
    html += `<div class="prc-monthly-models">`;
    for (let mi = 0; mi < models.length; mi++) {
        const m = models[mi];
        const mSlug = `${toSafeTipKey(m.name)}-${mi}`;
        const isUnpriced = unpricedNames.has(m.name);
        const pct = maxCost > 0 && m.totalCost > 0 ? Math.max(2, (m.totalCost / maxCost) * 100) : 0;
        const partialTagTip = richTipAttrs(
            `prc-monthly-partial-${mSlug}`,
            tBi('Partial Model Total', '该模型已知小计'),
            tBi(
                'Part of this model’s monthly usage lacked a verified price or usage date and is excluded from the subtotal.',
                '该模型本月有部分调用缺少核实价格或调用日期，因此仅统计已知部分。',
            ),
        );
        const unavailTip = richTipAttrs(
            `prc-monthly-unavail-${mSlug}`,
            tBi('Cost Unavailable', '费用暂不可用'),
            tBi(
                'No verified public API rate applies to this model yet; enter a custom price below to estimate it.',
                '此模型尚无核实的公开 API 单价，可在下方填写自定义价格以纳入估算。',
            ),
        );
        const costHtml = isUnpriced
            ? (m.totalCost > 0
                ? `${esc(fmtCost(m.totalCost, currency))} <span class="prc-cost-partial-tag" ${partialTagTip} tabindex="0">· ${tBiHtml('Partial', '已知小计')}</span>`
                : `<span class="prc-cost-unavailable" ${unavailTip} tabindex="0">${tBiHtml('Cost unavailable', '费用暂不可用')}</span>`)
            : esc(fmtCost(m.totalCost, currency));
        const modelNameTip = richTipAttrs(
            `prc-monthly-model-${mSlug}`,
            m.name,
            tBi(
                `Monthly API reference cost: ${isUnpriced && m.totalCost <= 0 ? 'unavailable' : fmtCost(m.totalCost, currency)}.`,
                `本月 API 参考估算费用：${isUnpriced && m.totalCost <= 0 ? '暂不可用' : fmtCost(m.totalCost, currency)}。`,
            ),
            tBi(
                `In ${fmtTok(m.inputTokens)} · Out ${fmtTok(m.outputTokens)}${m.thinkingTokens > 0 ? ` · Think ${fmtTok(m.thinkingTokens)}` : ''}`,
                `输入 ${fmtTok(m.inputTokens)} · 输出 ${fmtTok(m.outputTokens)}${m.thinkingTokens > 0 ? ` · 思考 ${fmtTok(m.thinkingTokens)}` : ''}`,
            ),
        );
        html += `<div class="prc-monthly-card">
            <span class="prc-monthly-model-name" ${modelNameTip} tabindex="0">${esc(m.name)}</span>
            <div class="prc-monthly-bar-wrap">
                ${pct > 0 ? `<div class="prc-monthly-bar-fill" style="width:${pct.toFixed(1)}%"></div>` : ''}
            </div>
            <span class="prc-monthly-model-cost">${costHtml}</span>
        </div>`;
    }
    html += `</div>`;
    if (unpricedNames.size > 0) {
        html += `<p class="prc-monthly-note"><span>${tBiHtml(
            'This total is incomplete because some usage has no verified price or usage date.',
            '部分用量缺少已核实价格或调用日期，因此此总费用尚不完整。',
        )}</span></p>`;
    }

    // Data coverage note
    if (dataCoverageNote) {
        html += `<p class="prc-monthly-note">
            <svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path fill="currentColor" d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/></svg>
            <span>${dataCoverageNote}</span>
        </p>`;
    }

    html += `</section>`;
    return html;
}

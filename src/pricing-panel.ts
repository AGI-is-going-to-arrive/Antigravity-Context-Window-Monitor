// ─── Pricing Tab Content Builder ─────────────────────────────────────────────
// Renders the "Pricing" tab: cost estimation and editable pricing table.
// Model DNA is rendered in the dedicated Models tab.

import { getLanguage, tBi } from './i18n';
import { GMSummary, GMModelStats } from './gm-tracker';
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
import { esc, tBiHtml } from './webview-helpers';
import type { MonthCostBreakdown } from './daily-store';
import { getModelDNAKey, type PersistedModelDNA } from './model-dna-store';
import {
    ModelConfig,
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
    orchestratorSettings?: OrchestratorSettings | null;
    orchestratorPricingMode?: OrchestratorPricingMode;
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
    const pendingArchiveCost = ledgerSettled ? ledgerSettled.reduce((s, e) => s + (e.totalEstimatedCost || 0), 0) : 0;
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
        )}</p><a href="https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-image">${tBiHtml('Official image pricing reference', '官方图片价格参考')}</a></section>`);
    }

    const mergedRowsMap = new Map<string, ModelCostRow>();
    let activeGrandTotal = 0;

    // 优先从 100% 精确的今日活跃账本中提取模型明细与计算
    if (todayLedgerActive && todayLedgerActive.length > 0) {
        for (const bucket of todayLedgerActive) {
            for (const [modelKey, ms] of Object.entries(bucket.modelStats)) {
                if (ms.calls <= 0) { continue; }
                const displayName = normalizeModelDisplayName(modelKey);
                const baseName = getModelBaseName(modelKey) || displayName;
                // Retained call timestamps keep rate changes from re-pricing old
                // usage; custom prices still apply consistently to every call.
                const { pricing, provenance, mappedBaseLabel, inputCost, outputCost, cacheCost, thinkingCost, totalCost, costBreakdownUnavailable, usesHistoricalRates } =
                    calculateLedgerModelCosts(modelKey, ms, bucket, custom, undefined, mode);
                activeGrandTotal += totalCost;

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

    // Monthly total cost summary (always shown if breakdown data exists)
    if (monthBreakdown) {
        parts.push(buildMonthlyCostSummary(monthBreakdown, activeGrandTotal, rows, pendingArchiveCost, custom, hasUnmeteredImageUsage, mode));
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
            buildCostPanel(rows, fullTotal, summary, ledgerSettled, todayLedgerActive, hasUnmeteredImageUsage),
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

    /* ── Model DNA Row List (shared with Models diagnostics) ── */
    .dna-row-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 20px;
    }
    .dna-row-card {
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        overflow: hidden;
        transition: border-color var(--ed-dur-fast) var(--ed-ease);
    }
    @media (hover: hover) {
        .dna-row-card:hover {
            border-color: var(--ed-border-strong);
        }
    }
    .dna-row-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        padding: 10px 14px;
        background: var(--ed-surface-well);
        border-bottom: 1px solid var(--ed-border);
        font-weight: 600;
        font-size: 0.875rem;
        color: var(--ed-ink);
        min-width: 0;
    }
    .dna-row-title {
        min-width: 0;
        overflow-wrap: anywhere;
        word-break: break-word;
    }
    .dna-row-header .act-badge { margin-left: auto; }
    .dna-row-body {
        display: flex;
        gap: 0;
        min-height: 0;
    }
    .dna-row-stats {
        flex: 0 0 auto;
        min-width: 156px;
        max-width: 210px;
        padding: 8px 12px;
        border-right: 1px solid var(--ed-border);
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .dna-row-stats .act-card-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 4px 6px;
        font-size: 0.8125rem;
        border-radius: var(--ed-radius-xs);
        transition: background var(--ed-dur-fast) var(--ed-ease);
    }
    @media (hover: hover) {
        .dna-row-stats .act-card-row:hover {
            background: var(--ed-surface-hover);
        }
    }
    .dna-row-stats .val-danger {
        color: var(--ed-danger);
    }
    .dna-row-details {
        flex: 1;
        min-width: 0;
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .dna-row-details .inline-details { margin-top: 0; }
    .dna-row-details .inline-details + .inline-details { margin-top: 6px; }
    .dna-row-empty {
        font-size: 0.75rem;
        color: var(--ed-ink-muted);
    }
    @media (max-width: 440px) {
        .dna-row-body { flex-direction: column; }
        .dna-row-stats {
            max-width: none;
            border-right: none;
            border-bottom: 1px solid var(--ed-border);
        }
    }
    .prc-dna-provider {
        display: inline-flex;
        align-items: center;
        padding: 1px 7px;
        border-radius: var(--ed-radius-xs);
        font-size: 0.72rem;
        font-weight: 550;
        background: var(--ed-surface);
        color: var(--ed-accent);
        border: 1px solid var(--ed-accent-border);
    }
    .prc-dna-response-model {
        font-family: var(--ed-mono);
        font-size: 0.75rem;
        font-weight: 450;
        color: var(--ed-ink-muted);
    }
    .prc-dna-grid-inner {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
        gap: 6px;
    }
    .prc-dna-field {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 6px 8px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        min-width: 0;
    }
    .prc-dna-label {
        font-size: 0.72rem;
        font-weight: 500;
        color: var(--ed-ink-muted);
    }
    .prc-dna-val {
        font-weight: 600;
        font-size: 0.875rem;
        color: var(--ed-ink);
        font-variant-numeric: tabular-nums lining-nums;
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
    body:is(.vscode-light, [data-vscode-theme-kind="vscode-light"]) .prc-edit-input {
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
        .dna-row-card,
        .dna-row-stats .act-card-row,
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

// ─── Shared Formatters ───────────────────────────────────────────────────────

function fmtCost(n: number): string {
    if (!Number.isFinite(n)) { return '—'; }
    const abs = Math.abs(n);
    const precision = abs > 0 && abs < 0.01 ? 'standard' : 'call';
    return formatUsdCost(n, { precision });
}

function fmtSavedMagnitude(usd: number): string | null {
    if (!Number.isFinite(usd) || usd < 0.0001) { return null; }
    const signed = formatUsdSavings(usd);
    if (signed === '—') { return null; }
    return signed.replace(/^-/, '');
}

function renderProvenanceBadge(
    provenance: PricingProvenance | undefined,
    mappedBaseLabel?: string,
): string {
    if (provenance === 'custom') {
        return `<span class="prc-custom-badge" data-pricing-provenance="custom">${tBiHtml('Custom', '自定义')}</span>`;
    }
    if (provenance === 'mapped_base') {
        const tip = mappedBaseLabel
            ? ` title="${esc(tBi(`Estimated via base model: ${mappedBaseLabel}`, `按底座模型估算：${mappedBaseLabel}`))}"`
            : '';
        return `<span class="prc-mapped-badge" data-pricing-provenance="mapped_base"${tip}>${tBiHtml('Est. via Base Model', '按底座估算')}</span>`;
    }
    if (provenance === 'unpriced') {
        return `<span class="prc-unpriced-badge" data-pricing-provenance="unpriced">${tBiHtml('Price unavailable', '价格待确认')}</span>`;
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
        const badge = renderProvenanceBadge(detail.provenance, detail.mappedBaseLabel);
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
                ${effort ? `<span class="prc-orch-effort">${esc(effort)}</span>` : ''}
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
            'Mapped Base Pricing (Default): Legacy Orchestrator IDs (M537/M667/M681/M669) estimate costs via their verified Gemini 4 base family rates (honoring UTC cutovers). Custom overrides below always win.',
            '按底座估算（默认）：旧版编排标识（M537/M667/M681/M669）按对应 Gemini 4 底座模型费率估算（遵循 UTC 调价日期）。下方自定义价格始终优先。',
        )
        : tBiHtml(
            'Strict Mode: Legacy Orchestrator IDs (M537/M667/M681/M669) remain unpriced unless you enter a custom override below. Custom Orchestrator Mode continues billing automatically via concrete base models.',
            '严格模式：旧版编排标识（M537/M667/M681/M669）保持待确认状态，仅在下方填写自定义单价后计费；自定义编排模式仍按具体底座模型自动计费。',
        );

    return `<section class="prc-orch-card" id="activeOrchestratorPricingCard" data-orchestrator-pricing-mode="${mode}">
        <div class="prc-orch-head">
            <h2 class="prc-orch-title">${orchSvg}<span>${tBiHtml('Orchestrator Pricing', '编排计费')}</span></h2>
            <div class="prc-orch-toggle" role="radiogroup" aria-label="${esc(tBi('Orchestrator pricing mode', '编排计费模式'))}">
                <button type="button" class="prc-orch-toggle-btn${mode === 'mapped' ? ' is-active' : ''}" id="orchPricingModeMapped" data-action="setOrchestratorPricingMode" data-mode="mapped" role="radio" aria-checked="${mode === 'mapped' ? 'true' : 'false'}">${tBiHtml('Mapped Base Pricing (Default)', '按底座估算（默认）')}</button>
                <button type="button" class="prc-orch-toggle-btn${mode === 'strict' ? ' is-active' : ''}" id="orchPricingModeStrict" data-action="setOrchestratorPricingMode" data-mode="strict" role="radio" aria-checked="${mode === 'strict' ? 'true' : 'false'}">${tBiHtml('Strict Mode', '严格模式')}</button>
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
    return `<div class="rate-change-banner" role="note">
        <div class="rate-change-banner-head">${clockSvg}<span>${tBiHtml('Upcoming Scheduled Rate Changes', '官方定时调价提醒')}</span></div>
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
): string {
    const priced = rows.filter(r => r.pricing);
    const unpriced = rows.filter(r => !r.pricing);
    if (priced.length === 0 && unpriced.length === 0 && grandTotal <= 0) { return ''; }

    const topModel = priced.length > 0 ? priced[0] : null;
    const totalCalls = (todayLedgerActive ? todayLedgerActive.reduce((s, e) => s + (e.totalCalls || 0), 0) : (summary?.totalCalls || 0))
        + (ledgerSettled ? ledgerSettled.reduce((s, e) => s + (e.totalCalls || 0), 0) : 0);
    const avgPerCall = totalCalls > 0 ? grandTotal / totalCalls : 0;
    const isPartial = unpriced.length > 0 || hasUnmeteredImageUsage;

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

    let html = `<h2 class="act-section-title"><span>${tBiHtml('Cost Analysis', '费用分析')}</span></h2>`;
    html += '<div class="cost-panel">';

    // ── Summary chips (inline, compact) ──
    html += '<div class="cost-chips">';
    const totalLabel = unpriced.length > 0 && priced.length === 0 && grandTotal <= 0
        ? `<span>${tBiHtml('Not available', '暂无法估算')}</span>`
        : `<span>${esc(fmtCost(grandTotal))}${isPartial ? ` · ${tBiHtml('Partial total', '已知小计')}` : ''}</span>`;
    html += `<span class="cost-chip cost-chip-total${isPartial ? ' is-partial' : ''}">${totalLabel}</span>`;
    if (topModel) {
        html += `<span class="cost-chip" title="${esc(topModel.name)}" data-tooltip="${esc(tBi('Top Spender', '最高消费'))}"><span>${esc(topModel.name)} ${esc(fmtCost(topModel.totalCost))}</span></span>`;
    }
    if (!isPartial) {
        html += `<span class="cost-chip" data-tooltip="${esc(tBi('Avg per Call', '平均每次'))}"><span>${esc(fmtCost(avgPerCall))} ${tBiHtml('per call', '每次')}</span></span>`;
    }
    const totalSavedLabel = fmtSavedMagnitude(totalCacheSavedUsd);
    if (totalSavedLabel) {
        html += `<span class="cost-chip cost-chip-saved" data-tooltip="${esc(tBi('Estimated savings from prompt cache reads', '提示词缓存读取预计节省金额'))}"><span>${tBiHtml('Cache saved', '缓存省')} ${esc(totalSavedLabel)}</span></span>`;
    }
    if (totalThinkingCostUsd > 0 && grandTotal > 0) {
        const thinkSharePct = Math.round((totalThinkingCostUsd / grandTotal) * 100);
        if (thinkSharePct > 0) {
            html += `<span class="cost-chip" data-tooltip="${esc(tBi('Share of cost from reasoning/thinking tokens', '思考 Token 费用占比'))}"><span>${tBiHtml('Thinking', '思考占比')} ${thinkSharePct}%</span></span>`;
        }
    }
    html += `<span class="cost-chip" data-tooltip="${esc(tBi('Models with pricing', '有定价的模型'))}"><span>${priced.length} ${tBiHtml(priced.length === 1 ? 'model' : 'models', '模型')}</span></span>`;
    if (totalCalls > 0) {
        html += `<span class="cost-chip"><span>${totalCalls} ${tBiHtml(totalCalls === 1 ? 'call' : 'calls', '调用')}</span></span>`;
    }
    html += '</div>';

    // ── Bar chart (proportional per-model) ──
    const chartSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
    const detailSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
    if (priced.length > 0) {
        html += `<div class="cost-bar-section">`;
        html += `<div class="cost-sub-header">${chartSvg}<span>${tBiHtml('Cost Distribution', '费用分布')}</span></div>`;
        const maxCost = priced[0].totalCost;
        for (const r of priced) {
            const pct = maxCost > 0 ? (r.totalCost / maxCost) * 100 : 0;
            const total = r.totalCost || 1;
            const inputPct = (r.inputCost / total) * pct;
            const outputPct = (r.outputCost / total) * pct;
            const cachePct = (r.cacheCost / total) * pct;
            const thinkPct = (r.thinkingCost / total) * pct;

            html += `<div class="cost-bar-row">
                <span class="cost-bar-label" title="${esc(r.name)}" data-tooltip="${esc(r.name)}${r.responseModel && r.responseModel !== r.name ? ' · ' + esc(r.responseModel) : ''}">${esc(r.name)}</span>
                <div class="cost-bar-track">
                    ${r.costBreakdownUnavailable ? `<div class="cost-bar-seg cost-seg-historical" style="width:${pct.toFixed(1)}%" data-tooltip="${esc(tBi('Recorded historical total; token cost breakdown unavailable', '保留的历史总费用；缺少各类 Token 费用明细'))}"></div>` : `
                    ${inputPct > 0 ? `<div class="cost-bar-seg cost-seg-input" style="width:${inputPct.toFixed(1)}%" data-tooltip="${esc(tBi(`Input: ${fmtCost(r.inputCost)} (${fmtTok(r.inputTokens)} tokens)`, `输入：${fmtCost(r.inputCost)}（${fmtTok(r.inputTokens)} tokens）`))}"></div>` : ''}
                    ${outputPct > 0 ? `<div class="cost-bar-seg cost-seg-output" style="width:${outputPct.toFixed(1)}%" data-tooltip="${esc(tBi(`Output: ${fmtCost(r.outputCost)} (${fmtTok(r.outputTokens)} tokens)`, `输出：${fmtCost(r.outputCost)}（${fmtTok(r.outputTokens)} tokens）`))}"></div>` : ''}
                    ${cachePct > 0 ? `<div class="cost-bar-seg cost-seg-cache" style="width:${cachePct.toFixed(1)}%" data-tooltip="${esc(tBi(`Cache: ${fmtCost(r.cacheCost)} (${fmtTok(r.cacheTokens)} tokens)`, `缓存：${fmtCost(r.cacheCost)}（${fmtTok(r.cacheTokens)} tokens）`))}"></div>` : ''}
                    ${thinkPct > 0 ? `<div class="cost-bar-seg cost-seg-think" style="width:${thinkPct.toFixed(1)}%" data-tooltip="${esc(tBi(`Thinking: ${fmtCost(r.thinkingCost)} (${fmtTok(r.thinkingTokens)} tokens)`, `思考：${fmtCost(r.thinkingCost)}（${fmtTok(r.thinkingTokens)} tokens）`))}"></div>` : ''}`}
                </div>
                <span class="cost-bar-val">${esc(fmtCost(r.totalCost))}</span>
            </div>`;
        }

        // Legend
        html += `<div class="cost-legend">
            <span class="cost-legend-item"><span class="cost-legend-dot cost-seg-input"></span><span>${tBiHtml('Input', '输入')}</span></span>
            <span class="cost-legend-item"><span class="cost-legend-dot cost-seg-output"></span><span>${tBiHtml('Output', '输出')}</span></span>
            <span class="cost-legend-item"><span class="cost-legend-dot cost-seg-cache"></span><span>${tBiHtml('Cache', '缓存')}</span></span>
            <span class="cost-legend-item"><span class="cost-legend-dot cost-seg-think"></span><span>${tBiHtml('Thinking', '思考')}</span></span>
        </div>`;
        html += `</div>`; // cost-bar-section
    }

    // ── Per-model cost breakdown ──
    if (priced.length > 0) {
        html += `<div class="cost-detail-section">`;
        html += `<div class="cost-sub-header">${detailSvg}<span>${tBiHtml('Cost Breakdown', '费用明细')}</span></div>`;
        html += '<div class="cost-detail-rows">';
        for (const r of priced) {
            const rateTooltip = (tokens: number, rate: number): string => r.usesHistoricalRates
                ? `${tBi('Priced at each call date', '按每次调用日期计价')} · ${fmtTok(tokens)} tokens`
                : fmtTokPrice(tokens, rate);
            const rowSavedUsd = !r.costBreakdownUnavailable && r.pricing && r.cacheTokens > 0 && r.pricing.input > r.pricing.cacheRead
                ? (r.cacheTokens * (r.pricing.input - r.pricing.cacheRead)) / 1_000_000
                : 0;
            const rowSavedLabel = fmtSavedMagnitude(rowSavedUsd);
            const rowThinkShare = !r.costBreakdownUnavailable && r.thinkingCost > 0 && r.totalCost > 0
                ? Math.round((r.thinkingCost / r.totalCost) * 100)
                : 0;
            const provBadge = r.provenance === 'mapped_base'
                ? ` ${renderProvenanceBadge('mapped_base', r.mappedBaseLabel)}`
                : '';
            html += `<div class="cost-detail-row">
                <span class="cost-detail-name" title="${esc(r.name)}" data-tooltip="${esc(r.name)}${r.responseModel && r.responseModel !== r.name ? ' · ' + esc(r.responseModel) : ''}">${esc(r.name)}${provBadge}</span>
                <div class="cost-detail-items">
                    ${r.costBreakdownUnavailable ? `<span class="cost-note">${tBiHtml('Historical total; token cost breakdown unavailable', '历史总费用；各类 Token 费用明细不可用')}</span>` : `
                    <span class="cost-detail-item" data-tooltip="${esc(rateTooltip(r.inputTokens, r.pricing!.input))}">
                        <span class="cost-legend-dot cost-seg-input"></span>${esc(fmtCost(r.inputCost))}
                    </span>
                    <span class="cost-detail-item" data-tooltip="${esc(rateTooltip(r.outputTokens, r.pricing!.output))}">
                        <span class="cost-legend-dot cost-seg-output"></span>${esc(fmtCost(r.outputCost))}
                    </span>
                    <span class="cost-detail-item" data-tooltip="${esc(rateTooltip(r.cacheTokens, r.pricing!.cacheRead))}">
                        <span class="cost-legend-dot cost-seg-cache"></span>${esc(fmtCost(r.cacheCost))}
                    </span>
                    ${r.thinkingTokens > 0 ? `<span class="cost-detail-item" data-tooltip="${esc(rateTooltip(r.thinkingTokens, r.pricing!.thinking))}">
                        <span class="cost-legend-dot cost-seg-think"></span>${esc(fmtCost(r.thinkingCost))}${rowThinkShare > 0 ? ` <span class="cost-share-sub">(${rowThinkShare}%)</span>` : ''}
                    </span>` : ''}
                    ${rowSavedLabel ? `<span class="cost-detail-saved" data-tooltip="${esc(tBi('Saved by prompt cache', '缓存预计节省'))}">${tBiHtml('Saved', '省')} ${esc(rowSavedLabel)}</span>` : ''}`}
                </div>
                <span class="cost-detail-total">${esc(fmtCost(r.totalCost))}</span>
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

    const infoSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    html += `<div class="prc-info-bar prc-info-warn">${infoSvg}<span class="prc-info-bar-body">${tBiHtml(
        'Costs are estimates based on the pricing table below. Actual billing may differ.',
        '费用基于下方价格表估算，实际计费可能不同。',
    )}</span></div>`;

    html += '</div>';
    return html;
}

export function buildModelDNACards(
    s: GMSummary | null,
    persisted: Record<string, PersistedModelDNA> = {},
    configs: ModelConfig[] = [],
): string {
    const currentEntries = Object.entries(s?.modelBreakdown || {});
    const currentByKey = new Map<string, [string, GMModelStats]>();
    for (const [name, stats] of currentEntries) {
        currentByKey.set(getModelDNAKey(name, stats.responseModel), [name, stats]);
    }

    const allKeys = new Set<string>([
        ...Object.keys(persisted),
        ...currentByKey.keys(),
    ]);
    if (allKeys.size === 0) { return ''; }

    const entries = [...allKeys].map(key => {
        const current = currentByKey.get(key);
        const persistedEntry = persisted[key];
        return { key, current, persisted: persistedEntry };
    }).sort((a, b) => {
        const aSteps = a.current?.[1].stepsCovered || 0;
        const bSteps = b.current?.[1].stepsCovered || 0;
        if (aSteps !== bSteps) { return bSteps - aSteps; }
        const aName = a.current?.[0] || a.persisted?.displayName || a.key;
        const bName = b.current?.[0] || b.persisted?.displayName || b.key;
        return aName.localeCompare(bName);
    });

    // Deduplicate by normalized display name — same model can appear under
    // different DNA keys (e.g. responseModel changed). Prefer the entry with
    // current GM data; merge persisted config/MIME from the duplicate.
    const seenNames = new Map<string, number>();
    const deduped: typeof entries = [];
    for (const entry of entries) {
        const rawName = entry.current?.[0] || entry.persisted?.displayName || entry.key;
        const normName = (normalizeModelDisplayName(rawName) || rawName).toLowerCase();
        const existingIdx = seenNames.get(normName);
        if (existingIdx === undefined) {
            seenNames.set(normName, deduped.length);
            deduped.push(entry);
        } else {
            const existing = deduped[existingIdx];
            if (!existing.current && entry.current) {
                if (!entry.persisted && existing.persisted) {
                    entry.persisted = existing.persisted;
                }
                deduped[existingIdx] = entry;
            }
        }
    }

    const configByLabel = new Map<string, ModelConfig>();
    for (const config of configs) {
        const normalizedLabel = normalizeModelDisplayName(config.label) || config.label;
        configByLabel.set(normalizedLabel, config);
    }

    const ICONS = {
        bolt: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        bar: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
        coin: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
        error: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
        retry: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
    };
    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    let html = `<h2 class="act-section-title"><span>${tBiHtml('Model Info', '模型信息')}</span></h2>`;
    html += `<div class="dna-row-list">`;

    for (const entry of deduped) {
        const current = entry.current?.[1];
        const persistedEntry = entry.persisted;
        const rawName = entry.current?.[0] || persistedEntry?.displayName || entry.key;
        const name = normalizeModelDisplayName(rawName) || rawName;
        const config = configByLabel.get(normalizeModelDisplayName(name) || name);
        const provider = current?.apiProvider || persistedEntry?.apiProvider || '';
        const providerShort = provider.replace('API_PROVIDER_', '').replace(/_/g, ' ');
        const cc = current?.completionConfig || persistedEntry?.completionConfig || null;
        const responseModel = current?.responseModel || persistedEntry?.responseModel || '';
        const callCount = current?.callCount || 0;
        const stepsCovered = current?.stepsCovered || 0;
        const totalCredits = current?.totalCredits || 0;
        const totalRetries = current?.totalRetries || 0;
        const errorCount = current?.errorCount || 0;
        const isPersistedOnly = !current && !!persistedEntry;
        const entryId = toDomSafeId(entry.key);
        const supportedMimeTypes = config?.supportedMimeTypes || [];

        const headerBadge = isPersistedOnly
            ? ` <span class="act-badge">${tBiHtml('Cached', '已缓存')}</span>`
            : '';

        const resolvedFromResponse = responseModel ? resolveModelId(responseModel) : undefined;
        const showResponseModel = responseModel && !resolvedFromResponse && (() => {
            const normTitle = name.toLowerCase().replace(/[\s().\-]+/g, '');
            const normResp = responseModel.toLowerCase().replace(/[\s().\-]+/g, '');
            return normResp !== normTitle;
        })();

        let headerMeta = '';
        if (providerShort) {
            headerMeta += `<span class="prc-dna-provider">${esc(providerShort)}</span>`;
        }
        if (showResponseModel) {
            headerMeta += `<span class="prc-dna-response-model">${esc(responseModel)}</span>`;
        }

        html += `<div class="dna-row-card${isPersistedOnly ? ' act-checkpoint-model' : ''}">`;
        html += `<div class="dna-row-header"><span class="dna-row-title" title="${esc(name)}">${esc(name)}</span>${headerMeta}${headerBadge}</div>`;
        html += `<div class="dna-row-body">`;

        // ── Left: compact stats ──
        html += `<div class="dna-row-stats">`;
        html += `<div class="act-card-row"><span>${ICONS.bolt} <span>${tBiHtml('Calls', '调用')}</span></span><span class="val">${fmt(callCount)}</span></div>`;
        html += `<div class="act-card-row"><span>${ICONS.bar} <span>${tBiHtml('Steps', '步骤')}</span></span><span class="val">${fmt(stepsCovered)}</span></div>`;
        if (totalCredits > 0) {
            html += `<div class="act-card-row"><span>${ICONS.coin} <span>${tBiHtml('Credits', '积分')}</span></span><span class="val">${totalCredits.toFixed(1)}</span></div>`;
        }
        if (totalRetries > 0) {
            html += `<div class="act-card-divider"></div>`;
            html += `<div class="act-card-row"><span>${ICONS.retry} <span>${tBiHtml('Retries', '重试')}</span></span><span class="val">${totalRetries}</span></div>`;
        }
        if (errorCount > 0) {
            if (totalRetries <= 0) { html += `<div class="act-card-divider"></div>`; }
            html += `<div class="act-card-row"><span>${ICONS.error} <span>${tBiHtml('Errors', '错误')}</span></span><span class="val val-danger">${errorCount}</span></div>`;
        }
        html += `</div>`; // dna-row-stats

        // ── Right: expandable MIME + Tech params ──
        html += `<div class="dna-row-details">`;
        if (supportedMimeTypes.length > 0) {
            html += `
                <details class="collapsible inline-details" id="d-model-mime-${entryId}">
                    <summary>${tBiHtml('MIME Types', 'MIME 类型')} (${supportedMimeTypes.length})</summary>
                    <div class="details-body">
                        <div class="mime-tags-wrap">
                            ${supportedMimeTypes.map(mime => `<span class="mime-tag">${esc(mime)}</span>`).join('')}
                        </div>
                    </div>
                </details>`;
        }
        if (cc) {
            html += `
                <details class="collapsible inline-details" id="d-model-tech-${entryId}">
                    <summary>${tBiHtml('Technical Params', '技术参数')}</summary>
                    <div class="details-body">
                        <div class="prc-dna-grid-inner">
                            ${buildDNAField(tBiHtml('maxTokens', '最大 tokens'), String(cc.maxTokens))}
                            ${buildDNAField(tBiHtml('temp', '温度'), cc.temperature.toString())}
                            ${buildDNAField(tBiHtml('firstTemp', '初始温度'), cc.firstTemperature.toString())}
                            ${buildDNAField(tBiHtml('topK', 'Top K'), String(cc.topK))}
                            ${buildDNAField(tBiHtml('topP', 'Top P'), cc.topP.toString())}
                            ${buildDNAField(tBiHtml('stops', '停止词'), String(cc.stopPatternCount))}
                        </div>
                    </div>
                </details>`;
        }
        if (supportedMimeTypes.length === 0 && !cc) {
            html += `<span class="dna-row-empty">${tBiHtml('No additional info', '暂无更多信息')}</span>`;
        }
        html += `</div>`; // dna-row-details

        html += `</div>`; // dna-row-body
        html += `</div>`; // dna-row-card
    }

    html += `</div>`;
    return html;
}

function buildDNAField(labelHtml: string, value: string): string {
    return `<div class="prc-dna-field"><span class="prc-dna-label">${labelHtml}</span><span class="prc-dna-val">${esc(value)}</span></div>`;
}

function toDomSafeId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

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
    return `<li>${tBiHtml(
        mode === 'mapped'
            ? 'Custom Orchestrator Mode executes on concrete Orchestrator and Executor models (e.g. Gemini 4 Neon/Carbon/Argon, Claude Opus 5.5, Gemini 4 Hydrogen, Claude Sonnet 5.5) and bills each call automatically at its base model rate with no orchestration surcharge. In Mapped Base Pricing mode, legacy M537/M667/M681/M669 identities estimate via their verified Gemini 4 base family rates (enter custom values above to override, or switch to Strict Mode).'
            : 'Custom Orchestrator Mode executes on concrete Orchestrator and Executor models (e.g. Gemini 4 Neon/Carbon/Argon, Claude Opus 5.5, Gemini 4 Hydrogen, Claude Sonnet 5.5) and bills each call automatically at its base model rate with no orchestration surcharge. In Strict Mode, legacy server-managed Orchestrator (Neon/Carbon/Argon) and worker M669 entries remain unpriced unless custom-overridden.',
        mode === 'mapped'
            ? '自定义编排模式会直接调用具体的编排模型与执行模型（如 Gemini 4 Neon/Carbon/Argon、Claude Opus 5.5、Gemini 4 Hydrogen、Claude Sonnet 5.5），按每次调用实际记录的底座模型自动计费，无额外编排加价。在“按底座估算”模式下，旧版 M537/M667/M681/M669 会按对应 Gemini 4 底座费率估算（可在上方填写自定义单价覆盖，或切换为严格模式）。'
            : '自定义编排模式会直接调用具体的编排模型与执行模型（如 Gemini 4 Neon/Carbon/Argon、Claude Opus 5.5、Gemini 4 Hydrogen、Claude Sonnet 5.5），按每次调用实际记录的底座模型自动计费，无额外编排加价。在严格模式下，旧版服务端托管的三个 Orchestrator 变体及 M669 仅在自定义单价后计费。',
    )}</li>`;
}

function neonPricingNote(): string {
    return `<li>${tBiHtml(
        'Gemini 4 Neon standard API reference (USD per 1M tokens), verified 2026-11-22: input $3.00, output including thinking $15.00, implicit cache reads $0.15 (95% off), flat across the full 1M context window. The same rates apply to Low, Medium, High, and Extra High (XHigh). No scheduled price cutover is published. Explicit caching is currently unsupported.',
        'Gemini 4 Neon 标准 API 参考价（每百万 tokens，USD），2026-11-22 核实：输入 $3.00、输出（含思考）$15.00、隐式缓存读取 $0.15（95% 折扣），1M 上下文全窗口统一费率。Low、Medium、High 和 Extra High（XHigh）四档使用相同费率。官网未公布定时调价计划，当前不支持显式缓存。',
    )} <a href="https://aistudio.google.com/docs/whats-new-gemini-4-neon">${tBiHtml('Official pricing', '官方价格')}</a></li>`;
}

function hydrogenPricingNote(): string {
    return `<li>${tBiHtml(
        'Gemini 4 Hydrogen standard API reference (USD per 1M tokens), verified 2026-11-13: input $1.50, output including thinking $7.50, implicit cache reads $0.075. The same rates apply to Low, Medium, High and Extra High (XHigh). No scheduled price change is published. Explicit caching is not supported. These are not Batch/Flex rates or Antigravity subscription charges.',
        'Gemini 4 Hydrogen 标准 API 参考价（每百万 tokens，USD），2026-11-13 核实：输入 $1.50、输出（含思考）$7.50、隐式缓存读取 $0.075。Low、Medium、High 和 Extra High（XHigh）四档使用相同费率。官网未公布定时调价计划，不支持显式缓存。这不是 Batch/Flex 费率，也不是 Antigravity 订阅收费。',
    )} <a href="https://aistudio.google.com/docs/pricing#gemini-4-hydrogen">${tBiHtml('Official pricing', '官方价格')}</a></li>`;
}

function carbonPricingNote(): string {
    return `<li>${tBiHtml(
        'Gemini 4 Carbon standard API reference (USD per 1M tokens): input $2, output including thinking $10, implicit cache reads $0.10 through 2026-11-30; $4, $20, $0.20 from 2026-12-01. Automatic changes use UTC dates; day-only archives use their saved calendar day. Explicit caching is not supported. These are not Batch/Flex rates or Antigravity subscription charges.',
        'Gemini 4 Carbon 标准 API 参考价（每百万 tokens，USD）：截至 2026-11-30，输入 $2、输出（含思考）$10、隐式缓存读取 $0.10；自 2026-12-01 起为 $4、$20、$0.20。自动切价按 UTC 日期，只有日期的归档按保存的日历日期计价。不支持显式缓存。这不是 Batch/Flex 费率，也不是 Antigravity 订阅收费。',
    )} <a href="https://aistudio.google.com/docs/pricing#gemini-4-carbon">${tBiHtml('Official pricing', '官方价格')}</a></li>`;
}

function argonPricingNote(): string {
    return `<li>${tBiHtml(
        'Gemini 4 Argon standard API reference (USD per 1M tokens): input $2, output including thinking $10, implicit cache reads $0.10 through 2026-11-30; $4, $20, $0.20 from 2026-12-01. Automatic changes use UTC dates; day-only archives use their saved calendar day. Explicit caching is not supported. These are not Batch/Flex rates or Antigravity subscription charges.',
        'Gemini 4 Argon 标准 API 参考价（每百万 tokens，USD）：截至 2026-11-30，输入 $2、输出（含思考）$10、隐式缓存读取 $0.10；自 2026-12-01 起为 $4、$20、$0.20。自动切价按 UTC 日期，只有日期的归档按保存的日历日期计价。不支持显式缓存。这不是 Batch/Flex 费率，也不是 Antigravity 订阅收费。',
    )} <a href="https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon">${tBiHtml('Official pricing', '官方价格')}</a></li>`;
}

function buildEditablePricingTable(
    calledModelKeys: Set<string>,
    merged: Record<string, ModelPricing>,
    custom: Record<string, ModelPricing>,
    mode: OrchestratorPricingMode = getOrchestratorPricingMode(),
): string {
    // Keep family-rate editors stable when a first call adds a concrete tier.
    // Otherwise polling can remove a family row with an unsaved price draft.
    const editableKeys = editablePriceKeys(merged);
    const editorKeyById = new Map(editableKeys.map(key => [resolveModelId(key), key]));
    const calledEditorKeys = new Set(Array.from(calledModelKeys, key => {
        const id = resolveModelId(key);
        return id && !editableKeys.includes(key) ? editorKeyById.get(id) || key : key;
    }));

    // Build unified list: called models first, then uncalled defaults
    interface PricingEntry { name: string; responseModel: string; isCalled: boolean }
    const allEntries: PricingEntry[] = [];
    for (const responseModel of calledEditorKeys) {
        const displayName = normalizeModelDisplayName(responseModel);
        allEntries.push({ name: displayName, responseModel, isCalled: true });
    }
    for (const model of editableKeys) {
        if (!calledEditorKeys.has(model)) {
            const resolved = resolveModelId(model);
            const displayName = resolved ? getModelDisplayName(resolved) : pricingDisplayName(model);
            allEntries.push({ name: displayName, responseModel: model, isCalled: false });
        }
    }
    if (allEntries.length === 0) { return ''; }

    const fields: (keyof ModelPricing)[] = ['input', 'output', 'cacheRead', 'thinking'];

    let html = `<h2 class="act-section-title"><span>${tBiHtml('Custom Pricing', '自定义价格')}</span> <span class="prc-unit-note">(${tBiHtml('USD per 1M tokens', '每百万 tokens (USD)')})</span></h2>`;
    html += `<div class="prc-edit-section">`;
    html += `<div class="prc-edit-list">`;

    for (const entry of allEntries) {
        const detail = resolvePricingDetail(entry.responseModel, custom, { orchestratorPricingMode: mode });
        const pricing = detail.pricing;
        const isCustom = !!custom[entry.responseModel];
        const isMapped = detail.provenance === 'mapped_base';
        const rowStateClass = entry.isCalled ? ' prc-edit-called' : ' prc-edit-uncalled';
        const provBadge = isCustom
            ? renderProvenanceBadge('custom')
            : isMapped
                ? renderProvenanceBadge('mapped_base', detail.mappedBaseLabel)
                : !pricing
                    ? renderProvenanceBadge('unpriced')
                    : '';
        const mappedSub = isMapped && detail.mappedBaseLabel
            ? `<span class="prc-mapped-sub">→ ${esc(detail.mappedBaseLabel)}</span>`
            : '';

        html += `<div class="prc-edit-row${rowStateClass}" data-pricing-provenance="${detail.provenance}">`;
        html += `<div class="prc-edit-row-left"><span class="prc-edit-card-name" title="${esc(entry.name)}" data-tooltip="${esc(entry.name)}${entry.responseModel && entry.responseModel !== entry.name ? ' · ' + esc(entry.responseModel) : ''}"><span class="prc-edit-card-name-text">${esc(entry.name)}</span>${entry.isCalled ? `<span class="prc-called-badge">${tBiHtml('Active', '已调用')}</span>` : ''}${provBadge}${mappedSub}</span></div>`;
        html += `<div class="prc-edit-row-right">`;
        for (const f of fields) {
            const [en, zh] = FIELD_LABELS[f] || [f, f];
            // Legacy Orchestrator rows in mapped mode show effective mapped rates as
            // editable placeholders (value="") so saving untouched does not create fake overrides.
            const value = pricing && !isMapped ? String(pricing[f]) : '';
            const placeholder = isMapped && pricing
                ? String(pricing[f])
                : tBi('Not set', '未设置');
            const mappedAttr = isMapped && pricing ? ` data-mapped-value="${esc(String(pricing[f]))}"` : '';
            html += `<div class="prc-edit-field">
                <span class="prc-edit-field-label">${tBiHtml(en, zh)}</span>
                <input type="number" class="prc-edit-input pricing-input" data-model="${esc(entry.responseModel)}" data-field="${f}" data-original-value="${esc(value)}" data-was-custom="${isCustom ? '1' : '0'}" data-cache-write="${pricing?.cacheWrite ?? 0}"${mappedAttr} value="${esc(value)}" placeholder="${esc(placeholder)}" step="any" min="0" aria-label="${esc(entry.name)} ${esc(tBi(en, zh))}">
            </div>`;
        }
        html += `</div></div>`;
    }

    html += `</div>`;
    html += `<div class="prc-edit-actions">
        <button class="prc-btn prc-btn-primary" id="pricingSaveBtn"><span>${tBiHtml('Save Prices', '保存价格')}</span></button>
        <button class="prc-btn" id="pricingResetBtn"><span>${tBiHtml('Reset to Default', '恢复默认')}</span></button>
        <span class="prc-feedback" id="pricingFeedback"></span>
    </div>`;
    const infoSvg2 = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    html += `<div class="prc-info-bar">${infoSvg2}<div class="prc-info-bar-body"><ul>
        <li>${tBiHtml('Edit prices above and click Save. Changes persist across sessions.', '编辑上方价格后点击“保存”，修改跨会话持久化。')}</li>
        <li>${tBiHtml('Reset restores built-in default prices. Clear all fields in a row to remove its override. Missing prices are not zero prices.', '“恢复默认”将还原内置价格。清空一行全部字段可移除该自定义价格；缺失价格不代表免费。')}</li>
        ${orchestratorPricingNote(mode)}
        ${neonPricingNote()}
        ${hydrogenPricingNote()}
        ${carbonPricingNote()}
        ${argonPricingNote()}
        <li>${tBiHtml('Built-in cache-write rates use the 5-minute TTL. Cache creation is excluded from cost estimates because the available telemetry cannot reliably identify creation tokens or the 1-hour TTL.', '内置缓存写入价格采用 5 分钟有效期。遥测无法可靠区分缓存创建 tokens 及 1 小时有效期，因此费用估算暂不计入缓存创建。')}</li>
        <li>${tBiHtml('Default prices last updated:', '默认价格最后更新：')} <span class="prc-info-date">${PRICING_LAST_UPDATED}</span></li>
    </ul></div></div>`;
    html += `</div>`;
    return html;
}

/** Pricing table using default keys — shown when no GM data is available. */
function buildDefaultPricingTable(
    merged: Record<string, ModelPricing>,
    custom: Record<string, ModelPricing>,
    mode: OrchestratorPricingMode = getOrchestratorPricingMode(),
): string {
    const entries = editablePriceKeys(merged);
    if (entries.length === 0) { return ''; }

    const fields: (keyof ModelPricing)[] = ['input', 'output', 'cacheRead', 'thinking'];

    let html = `<h2 class="act-section-title"><span>${tBiHtml('Custom Pricing', '自定义价格')}</span> <span class="prc-unit-note">(${tBiHtml('USD per 1M tokens', '每百万 tokens (USD)')})</span></h2>`;
    html += `<div class="prc-edit-section"><div class="prc-edit-list">`;

    for (const model of entries) {
        const detail = resolvePricingDetail(model, custom, { orchestratorPricingMode: mode });
        const p = detail.pricing;
        const isCustom = !!custom[model];
        const isMapped = detail.provenance === 'mapped_base';
        const resolved = resolveModelId(model);
        const displayName = resolved ? getModelDisplayName(resolved) : pricingDisplayName(model);
        const provBadge = isCustom
            ? renderProvenanceBadge('custom')
            : isMapped
                ? renderProvenanceBadge('mapped_base', detail.mappedBaseLabel)
                : !p
                    ? renderProvenanceBadge('unpriced')
                    : '';
        const mappedSub = isMapped && detail.mappedBaseLabel
            ? `<span class="prc-mapped-sub">→ ${esc(detail.mappedBaseLabel)}</span>`
            : '';

        html += `<div class="prc-edit-row" data-pricing-provenance="${detail.provenance}">`;
        html += `<div class="prc-edit-row-left"><span class="prc-edit-card-name" title="${esc(displayName)}" data-tooltip="${esc(displayName)}${model !== displayName ? ' · ' + esc(model) : ''}"><span class="prc-edit-card-name-text">${esc(displayName)}</span>${provBadge}${mappedSub}</span></div>`;
        html += `<div class="prc-edit-row-right">`;
        for (const f of fields) {
            const [en, zh] = FIELD_LABELS[f] || [f, f];
            const value = p && !isMapped ? String(p[f]) : '';
            const placeholder = isMapped && p
                ? String(p[f])
                : tBi('Not set', '未设置');
            const mappedAttr = isMapped && p ? ` data-mapped-value="${esc(String(p[f]))}"` : '';
            html += `<div class="prc-edit-field">
                <span class="prc-edit-field-label">${tBiHtml(en, zh)}</span>
                <input type="number" class="prc-edit-input pricing-input" data-model="${esc(model)}" data-field="${f}" data-original-value="${esc(value)}" data-was-custom="${isCustom ? '1' : '0'}" data-cache-write="${p?.cacheWrite ?? 0}"${mappedAttr} value="${esc(value)}" placeholder="${esc(placeholder)}" step="any" min="0" aria-label="${esc(displayName)} ${esc(tBi(en, zh))}">
            </div>`;
        }
        html += `</div></div>`;
    }

    html += `</div>`;
    html += `<div class="prc-edit-actions"><button class="prc-btn prc-btn-primary" id="pricingSaveBtn"><span>${tBiHtml('Save Prices', '保存价格')}</span></button><button class="prc-btn" id="pricingResetBtn"><span>${tBiHtml('Reset to Default', '恢复默认')}</span></button><span class="prc-feedback" id="pricingFeedback"></span></div>`;
    const infoSvg3 = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
    html += `<div class="prc-info-bar">${infoSvg3}<div class="prc-info-bar-body"><ul>
        <li>${tBiHtml('Edit prices above and click Save. Changes persist across sessions.', '编辑上方价格后点击“保存”，修改跨会话持久化。')}</li>
        <li>${tBiHtml('Clear all fields in a row to remove its override. Missing prices are not zero prices.', '清空一行全部字段可移除该自定义价格；缺失价格不代表免费。')}</li>
        ${orchestratorPricingNote(mode)}
        ${neonPricingNote()}
        ${hydrogenPricingNote()}
        ${carbonPricingNote()}
        ${argonPricingNote()}
        <li>${tBiHtml('Built-in cache-write rates use the 5-minute TTL. Cache creation is excluded from cost estimates because the available telemetry cannot reliably identify creation tokens or the 1-hour TTL.', '内置缓存写入价格采用 5 分钟有效期。遥测无法可靠区分缓存创建 tokens 及 1 小时有效期，因此费用估算暂不计入缓存创建。')}</li>
        <li>${tBiHtml('Default prices last updated:', '默认价格最后更新：')} <span class="prc-info-date">${PRICING_LAST_UPDATED}</span></li>
    </ul></div></div></div>`;
    return html;
}

// ─── Monthly Cost Summary Builder ────────────────────────────────────────────

const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAMES_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const CALENDAR_LINK_ICON = '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/></svg>';
const DOLLAR_ICON = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M4 10.781c.148 1.667 1.513 2.85 3.591 3.003V15h1.043v-1.216c2.27-.179 3.678-1.438 3.678-3.3 0-1.59-.947-2.51-2.956-3.028l-.722-.187V3.467c1.122.11 1.879.714 2.07 1.616h1.47c-.166-1.6-1.54-2.748-3.54-2.875V1H7.591v1.233c-1.939.23-3.27 1.472-3.27 3.156 0 1.454.966 2.483 2.661 2.917l.61.162v4.031c-1.149-.17-1.94-.8-2.131-1.718zm3.391-3.836c-1.043-.263-1.6-.825-1.6-1.616 0-.944.704-1.641 1.8-1.828v3.495zM8.634 8.1C9.858 8.418 10.44 9 10.44 9.89c0 1.12-.789 1.816-2.007 1.931V8.1z"/></svg>';

/** Build the monthly cost summary section for the Pricing tab. */
function buildMonthlyCostSummary(
    breakdown: MonthCostBreakdown,
    currentCycleCost: number,
    currentCycleRows: ModelCostRow[],
    pendingArchiveCost: number,
    customPricing: Record<string, ModelPricing>,
    hasUnmeteredImageUsage = false,
    mode: OrchestratorPricingMode = getOrchestratorPricingMode(),
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

    html += `<div class="prc-monthly-grand">
        <span class="prc-monthly-grand-val${allUnavailable ? ' is-unavailable' : ''}">${allUnavailable ? tBiHtml('Not available', '暂无法估算') : esc(fmtCost(grandTotal))}</span>
        <span class="prc-monthly-grand-label${isPartial ? ' is-partial' : ''}">${isPartial ? tBiHtml('Partial total', '已知小计') : tBiHtml('Total', '总计')}</span>
        <span class="prc-monthly-grand-breakdown">${archivedLabel}</span>
    </div>`;

    // Per-model rows with proportional bar
    html += `<div class="prc-monthly-models">`;
    for (const m of models) {
        const isUnpriced = unpricedNames.has(m.name);
        const pct = maxCost > 0 && m.totalCost > 0 ? Math.max(2, (m.totalCost / maxCost) * 100) : 0;
        const costHtml = isUnpriced
            ? (m.totalCost > 0
                ? `${esc(fmtCost(m.totalCost))} <span class="prc-cost-partial-tag">· ${tBiHtml('Partial', '已知小计')}</span>`
                : `<span class="prc-cost-unavailable">${tBiHtml('Cost unavailable', '费用暂不可用')}</span>`)
            : esc(fmtCost(m.totalCost));
        html += `<div class="prc-monthly-card">
            <span class="prc-monthly-model-name" title="${esc(m.name)}">${esc(m.name)}</span>
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

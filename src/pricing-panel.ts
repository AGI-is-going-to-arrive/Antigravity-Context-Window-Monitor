// ─── Pricing Tab Content Builder ─────────────────────────────────────────────
// Renders the "Pricing" tab: cost estimation and editable pricing table.
// Model DNA is rendered in the dedicated Models tab.

import { tBi } from './i18n';
import { GMSummary, GMModelStats, GMCompletionConfig } from './gm-tracker';
import { PricingStore, DEFAULT_PRICING, PRICING_LAST_UPDATED, findPricing, ModelPricing, ModelCostRow } from './pricing-store';
import { esc } from './webview-helpers';
import type { MonthCostBreakdown } from './daily-store';
import { getModelDNAKey, type PersistedModelDNA } from './model-dna-store';
import { ModelConfig, normalizeModelDisplayName } from './models';

// ─── Public API ──────────────────────────────────────────────────────────────

export function buildPricingTabContent(
    summary: GMSummary | null,
    store: PricingStore,
    monthBreakdown?: MonthCostBreakdown,
): string {
    const hasGM = summary && summary.totalCalls > 0;
    const parts: string[] = [];

    // Pre-calculate costs once (used by both monthly summary and current cycle view)
    const costResult = hasGM ? store.calculateCosts(summary) : null;

    // Monthly total cost summary (always shown if breakdown data exists)
    if (monthBreakdown) {
        parts.push(buildMonthlyCostSummary(monthBreakdown, costResult?.grandTotal ?? 0, costResult?.rows ?? []));
    }

    if (hasGM && costResult) {
        const { rows, grandTotal } = costResult;
        const merged = store.getMerged();
        parts.push(
            buildCostVisualization(rows, grandTotal, summary),
            buildCostSummary(rows, grandTotal),
            buildEditablePricingTable(summary, merged, store.getCustom()),
        );
    } else {
        // No GM data yet — still show the editable pricing table with defaults
        parts.push(
            `<p class="empty-msg">${tBi(
                'Cost analysis will appear after GM data is available. You can configure custom prices below.',
                '费用分析将在 GM 数据可用后显示。您可以在下方配置自定义价格。',
            )}</p>`,
            buildDefaultPricingTable(store.getMerged(), store.getCustom()),
        );
    }

    return parts.join('');
}

export function getPricingTabStyles(): string {
    return `
    /* ── Model DNA Cards ── */
    .prc-dna-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: var(--space-3);
        margin-bottom: var(--space-4);
    }
    .prc-dna-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-3);
        position: relative;
        overflow: hidden;
    }
    .prc-dna-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, var(--color-accent, #007fd4), var(--color-info, #60a5fa));
        border-radius: var(--radius-md) var(--radius-md) 0 0;
    }
    .prc-dna-header {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        margin-bottom: var(--space-2);
    }
    .prc-dna-model {
        font-weight: 700;
        font-size: 1em;
    }
    .prc-dna-provider {
        display: inline-block;
        font-size: 0.78em;
        color: var(--color-text-dim);
        opacity: 0.8;
    }
    .prc-dna-response-model {
        font-size: 0.82em;
        color: var(--color-text-dim);
        margin-bottom: var(--space-2);
    }
    .prc-dna-meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        align-items: center;
        margin-bottom: var(--space-2);
        font-size: 0.8em;
        color: var(--color-text-dim);
    }
    .prc-dna-sep {
        opacity: 0.45;
    }
    .prc-dna-grid-inner {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
        gap: var(--space-1);
    }
    .prc-dna-field {
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
    }
    .prc-dna-label {
        font-size: 0.78em;
        color: var(--color-text-dim);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .prc-dna-val {
        font-weight: 700;
        font-size: 0.95em;
    }
    /* ── Cost Visualization ── */
    .prc-viz-section {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-3);
        margin-bottom: var(--space-4);
    }
    .prc-viz-highlights {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
        gap: var(--space-2);
        margin-bottom: var(--space-4);
    }
    .prc-viz-highlight {
        text-align: center;
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
    }
    .prc-viz-hl-val {
        font-weight: 700;
        font-size: 1.2em;
    }
    .prc-viz-hl-label {
        font-size: 0.78em;
        color: var(--color-text-dim);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: 2px;
    }
    .prc-bar-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin-bottom: var(--space-2);
        font-size: 0.88em;
    }
    .prc-bar-label {
        min-width: 90px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex-shrink: 0;
    }
    .prc-bar-track {
        flex: 1;
        height: 18px;
        border-radius: var(--radius-sm);
        background: var(--color-surface);
        overflow: hidden;
        display: flex;
    }
    .prc-bar-seg {
        height: 100%;
        min-width: 1px;
        transition: width 0.3s cubic-bezier(.4,0,.2,1);
    }
    .prc-bar-seg-input { background: #60a5fa; }
    .prc-bar-seg-output { background: #2dd4bf; }
    .prc-bar-seg-cache { background: #22d3ee; }
    .prc-bar-seg-thinking { background: #fb923c; }
    .prc-bar-val {
        min-width: 55px;
        text-align: right;
        font-weight: 600;
        font-size: 0.92em;
        flex-shrink: 0;
    }
    .prc-bar-legend {
        display: flex;
        gap: var(--space-3);
        flex-wrap: wrap;
        font-size: 0.82em;
        color: var(--color-text-dim);
        margin-top: var(--space-3);
        padding-top: var(--space-2);
        border-top: 1px solid var(--color-border);
    }
    .prc-bar-legend-item {
        display: flex;
        align-items: center;
        gap: var(--space-1);
    }
    .prc-bar-legend-dot {
        width: 8px;
        height: 8px;
        border-radius: 2px;
    }

    /* ── Cost Summary Cards ── */
    .prc-cost-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: var(--space-2);
        margin-bottom: var(--space-3);
    }
    .prc-cost-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-left: 3px solid var(--color-info);
        border-radius: var(--radius-md);
        padding: var(--space-3);
        transition: background 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
    }
    @media (hover: hover) {
        .prc-cost-card:hover {
            background: var(--color-surface-hover);
            border-color: var(--color-border-hover);
        }
    }
    .prc-cost-card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-2);
        padding-bottom: var(--space-1);
        border-bottom: 1px solid var(--color-border);
    }
    .prc-cost-card-name {
        font-weight: 600;
        font-size: 0.92em;
    }
    .prc-cost-card-total {
        font-weight: 700;
        font-size: 1em;
        color: #f59e0b;
    }
    .prc-cost-card-body {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-1);
    }
    .prc-cost-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.85em;
        padding: 2px var(--space-1);
        border-radius: var(--radius-sm);
    }
    .prc-cost-item-label {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        color: var(--color-text-dim);
    }
    .prc-cost-item-dot {
        width: 6px;
        height: 6px;
        border-radius: 2px;
        flex-shrink: 0;
    }
    .prc-cost-item-val {
        font-weight: 600;
    }
    .prc-cost-card.prc-cost-grand {
        border-left-color: #f59e0b;
        background: rgba(245,158,11,0.04);
    }
    .prc-cost-grand-val {
        font-size: 1.4em;
        font-weight: 700;
        color: #f59e0b;
    }
    .prc-cost-no-pricing {
        font-size: 0.85em;
        color: var(--color-text-dim);
        font-style: italic;
    }
    .prc-note {
        font-size: 0.82em;
        color: var(--color-text-dim);
        margin-top: var(--space-2);
        font-style: italic;
    }

    /* ── Editable Pricing Cards ── */
    .prc-edit-section {
        margin-bottom: var(--space-4);
    }
    .prc-edit-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: var(--space-2);
        margin-bottom: var(--space-3);
    }
    .prc-edit-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-3);
        transition: border-color 0.15s cubic-bezier(.4,0,.2,1);
    }
    @media (hover: hover) {
        .prc-edit-card:hover {
            border-color: var(--color-border-hover);
        }
    }
    .prc-edit-card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-2);
    }
    .prc-edit-card-name {
        font-weight: 600;
        font-size: 0.95em;
    }
    .prc-edit-source {
        font-size: 0.78em;
        font-weight: 600;
    }
    .prc-edit-source-custom { color: #fbbf24; }
    .prc-edit-source-builtin { color: #34d399; }
    .prc-edit-source-none { color: var(--color-text-dim); }
    .prc-edit-fields {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-2);
    }
    .prc-edit-field {
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .prc-edit-field-label {
        font-size: 0.78em;
        color: var(--color-text-dim);
        text-transform: uppercase;
        letter-spacing: 0.3px;
        font-weight: 500;
    }
    .prc-edit-input {
        appearance: none;
        width: 100%;
        padding: var(--space-1) var(--space-2);
        font-size: 0.92em;
        font-family: inherit;
        text-align: right;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: inherit;
        transition: border-color 0.2s cubic-bezier(.4,0,.2,1), background 0.2s cubic-bezier(.4,0,.2,1);
    }
    .prc-edit-input:focus-visible {
        outline: none;
        border-color: var(--color-accent);
        background: var(--color-surface-hover);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 35%, transparent);
    }
    @media (hover: hover) {
        .prc-edit-input:hover {
            border-color: var(--color-border-hover);
        }
    }
    .prc-edit-input:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }
    .prc-edit-actions {
        display: flex;
        gap: var(--space-2);
        align-items: center;
        margin-top: var(--space-3);
    }
    .prc-btn {
        appearance: none;
        padding: var(--space-1) var(--space-3);
        font-size: 0.88em;
        font-family: inherit;
        font-weight: 600;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: var(--color-surface-hover);
        color: inherit;
        cursor: pointer;
        transition: background 0.2s cubic-bezier(.4,0,.2,1), border-color 0.2s cubic-bezier(.4,0,.2,1), transform 0.1s;
    }
    @media (hover: hover) {
        .prc-btn:hover {
            background: var(--color-border-hover);
            border-color: var(--color-border-hover);
        }
    }
    .prc-btn:active {
        transform: scale(0.98);
    }
    .prc-btn:focus-visible {
        box-shadow: 0 0 0 2px var(--color-accent);
    }
    .prc-btn-primary {
        background: color-mix(in srgb, var(--color-accent) 18%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
        color: var(--color-accent);
    }
    @media (hover: hover) {
        .prc-btn-primary:hover {
            background: color-mix(in srgb, var(--color-accent) 28%, transparent);
        }
    }
    .prc-feedback {
        font-size: 0.88em;
        color: #34d399;
        font-weight: 600;
        opacity: 0;
        transition: opacity 0.3s cubic-bezier(.4,0,.2,1);
    }
    .prc-custom-badge {
        display: inline-block;
        font-size: 0.72em;
        padding: 1px var(--space-1);
        border-radius: var(--radius-sm);
        background: rgba(251,191,36,0.15);
        color: #fbbf24;
        font-weight: 600;
        margin-left: var(--space-1);
    }

    @media (prefers-reduced-motion: reduce) {
        .prc-bar-seg, .prc-edit-input, .prc-cost-card, .prc-edit-card, .prc-monthly-card { transition: none; }
    }

    /* ── Monthly Cost Summary ── */
    .prc-monthly-section {
        margin-bottom: var(--space-4);
    }
    .prc-monthly-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
        margin-bottom: var(--space-3);
    }
    .prc-monthly-header h2 {
        margin-bottom: 0;
    }
    .prc-monthly-grand {
        display: flex;
        align-items: baseline;
        gap: var(--space-2);
        padding: var(--space-3) var(--space-4);
        background: rgba(251, 191, 36, 0.06);
        border: 1px solid rgba(251, 191, 36, 0.18);
        border-left: 3px solid #f59e0b;
        border-radius: var(--radius-md);
        margin-bottom: var(--space-3);
    }
    .prc-monthly-grand-val {
        font-size: 1.6em;
        font-weight: 800;
        color: #f59e0b;
        letter-spacing: -0.02em;
    }
    .prc-monthly-grand-label {
        font-size: 0.85em;
        color: var(--color-text-dim);
    }
    .prc-monthly-grand-breakdown {
        font-size: 0.78em;
        color: var(--color-text-dim);
        margin-left: auto;
    }
    .prc-monthly-models {
        display: grid;
        gap: var(--space-2);
    }
    .prc-monthly-card {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-2) var(--space-3);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        transition: background 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
    }
    @media (hover: hover) {
        .prc-monthly-card:hover {
            background: var(--color-surface-hover);
            border-color: var(--color-border-hover);
        }
    }
    .prc-monthly-model-name {
        font-weight: 600;
        font-size: 0.9em;
        min-width: 100px;
    }
    .prc-monthly-bar-wrap {
        flex: 1;
        height: 6px;
        background: rgba(255,255,255,0.06);
        border-radius: var(--radius-full);
        overflow: hidden;
    }
    .prc-monthly-bar-fill {
        height: 100%;
        border-radius: var(--radius-full);
        background: linear-gradient(90deg, #f59e0b, #fb923c);
        transition: width 0.4s cubic-bezier(.4,0,.2,1);
    }
    .prc-monthly-model-cost {
        font-weight: 700;
        font-size: 0.92em;
        color: #f59e0b;
        min-width: 60px;
        text-align: right;
    }
    .prc-monthly-chips {
        display: flex;
        gap: var(--space-1);
        flex-wrap: wrap;
        font-size: 0.78em;
    }
    .prc-monthly-chip {
        padding: 1px var(--space-1);
        border-radius: var(--radius-sm);
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.08);
        color: var(--color-text-dim);
        white-space: nowrap;
    }
    .prc-monthly-note {
        margin-top: var(--space-2);
        font-size: 0.78em;
        color: var(--color-text-dim);
        font-style: italic;
        display: flex;
        align-items: center;
        gap: var(--space-1);
    }
    .prc-monthly-calendar-link {
        appearance: none;
        background: rgba(96,165,250,0.08);
        border: 1px solid rgba(96,165,250,0.2);
        border-radius: var(--radius-sm);
        color: var(--color-info);
        padding: var(--space-1) var(--space-2);
        font: inherit;
        font-size: 0.82em;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        transition: background 0.15s cubic-bezier(.4,0,.2,1), transform 0.1s;
    }
    .prc-monthly-calendar-link:focus-visible {
        box-shadow: 0 0 0 2px var(--color-info);
        outline: none;
    }
    .prc-monthly-calendar-link:active { transform: scale(0.97); }
    @media (hover: hover) {
        .prc-monthly-calendar-link:hover {
            background: rgba(96,165,250,0.15);
        }
    }
    .prc-monthly-empty {
        color: var(--color-text-dim);
        font-size: 0.85em;
        text-align: center;
        padding: var(--space-3) 0;
        opacity: 0.7;
    }

    /* ── Light Theme Overrides ── */
    body.vscode-light .prc-dna-provider { background: rgba(37,99,235,0.1); color: #1d4ed8; }
    body.vscode-light .prc-tool-tag { background: rgba(22,163,74,0.08); color: #15803d; }
    body.vscode-light .prc-error-tag { background: rgba(220,38,38,0.08); color: #dc2626; }
    body.vscode-light .prc-cost-card-total { color: #b45309; }
    body.vscode-light .prc-cost-grand-val { color: #b45309; }
    body.vscode-light .prc-cost-card.prc-cost-grand { border-left-color: #d97706; background: rgba(217,119,6,0.05); }
    body.vscode-light .prc-custom-badge { background: rgba(202,138,4,0.12); color: #92400e; }
    body.vscode-light .prc-edit-source-custom { color: #92400e; }
    body.vscode-light .prc-edit-source-builtin { color: #15803d; }
    body.vscode-light .prc-feedback { color: #15803d; }
    body.vscode-light .prc-monthly-grand { background: rgba(217,119,6,0.06); border-color: rgba(217,119,6,0.2); border-left-color: #d97706; }
    body.vscode-light .prc-monthly-grand-val { color: #b45309; }
    body.vscode-light .prc-monthly-model-cost { color: #b45309; }
    body.vscode-light .prc-monthly-bar-wrap { background: rgba(0,0,0,0.06); }
    body.vscode-light .prc-monthly-bar-fill { background: linear-gradient(90deg, #d97706, #ea580c); }
    body.vscode-light .prc-monthly-chip { background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.08); }
    body.vscode-light .prc-monthly-calendar-link { background: rgba(37,99,235,0.06); border-color: rgba(37,99,235,0.2); color: #1d4ed8; }
    `;
}

// ─── Cost Visualization ──────────────────────────────────────────────────────

function buildCostVisualization(
    rows: import('./pricing-store').ModelCostRow[],
    grandTotal: number,
    summary: GMSummary,
): string {
    const priced = rows.filter(r => r.pricing && r.totalCost > 0);
    if (priced.length === 0 || grandTotal <= 0) { return ''; }

    const fmtUsd = (n: number) => n < 0.01 ? `$${n.toFixed(4)}` : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;

    // Highlights
    const topModel = priced[0];
    const avgPerCall = summary.totalCalls > 0 ? grandTotal / summary.totalCalls : 0;

    let html = `<h2 class="act-section-title">${tBi('Cost Overview', '费用概览')}</h2>`;
    html += '<div class="prc-viz-section">';

    // Highlight cards
    html += '<div class="prc-viz-highlights">';
    html += `<div class="prc-viz-highlight">
        <div class="prc-viz-hl-val" style="color:#f59e0b">${fmtUsd(grandTotal)}</div>
        <div class="prc-viz-hl-label">${tBi('Total Cost', '总费用')}</div>
    </div>`;
    html += `<div class="prc-viz-highlight">
        <div class="prc-viz-hl-val" style="color:#2dd4bf">${esc(topModel.name)}</div>
        <div class="prc-viz-hl-label">${tBi('Top Spender', '最高消费')}</div>
    </div>`;
    html += `<div class="prc-viz-highlight">
        <div class="prc-viz-hl-val" style="color:#60a5fa">${fmtUsd(avgPerCall)}</div>
        <div class="prc-viz-hl-label">${tBi('Avg/Call', '平均/次')}</div>
    </div>`;
    html += `<div class="prc-viz-highlight">
        <div class="prc-viz-hl-val">${priced.length}</div>
        <div class="prc-viz-hl-label">${tBi('Models', '模型数')}</div>
    </div>`;
    html += '</div>';

    // Bar chart
    const maxCost = priced[0].totalCost;
    for (const r of priced) {
        const pct = maxCost > 0 ? (r.totalCost / maxCost) * 100 : 0;
        const total = r.totalCost || 1;
        const inputPct = (r.inputCost / total) * pct;
        const outputPct = (r.outputCost / total) * pct;
        const cachePct = ((r.cacheCost + r.cacheWriteCost) / total) * pct;
        const thinkPct = (r.thinkingCost / total) * pct;

        html += `<div class="prc-bar-row">
            <span class="prc-bar-label">${esc(r.name)}</span>
            <div class="prc-bar-track">
                ${inputPct > 0 ? `<div class="prc-bar-seg prc-bar-seg-input" style="width:${inputPct.toFixed(1)}%" data-tooltip="${tBi('Input', '输入')}: ${fmtUsd(r.inputCost)}"></div>` : ''}
                ${outputPct > 0 ? `<div class="prc-bar-seg prc-bar-seg-output" style="width:${outputPct.toFixed(1)}%" data-tooltip="${tBi('Output', '输出')}: ${fmtUsd(r.outputCost)}"></div>` : ''}
                ${cachePct > 0 ? `<div class="prc-bar-seg prc-bar-seg-cache" style="width:${cachePct.toFixed(1)}%" data-tooltip="${tBi('Cache', '缓存')}: ${fmtUsd(r.cacheCost + r.cacheWriteCost)}"></div>` : ''}
                ${thinkPct > 0 ? `<div class="prc-bar-seg prc-bar-seg-thinking" style="width:${thinkPct.toFixed(1)}%" data-tooltip="${tBi('Thinking', '思考')}: ${fmtUsd(r.thinkingCost)}"></div>` : ''}
            </div>
            <span class="prc-bar-val" style="color:#f59e0b">${fmtUsd(r.totalCost)}</span>
        </div>`;
    }

    // Legend
    html += `<div class="prc-bar-legend">
        <span class="prc-bar-legend-item"><span class="prc-bar-legend-dot" style="background:#60a5fa"></span> ${tBi('Input', '输入')}</span>
        <span class="prc-bar-legend-item"><span class="prc-bar-legend-dot" style="background:#2dd4bf"></span> ${tBi('Output', '输出')}</span>
        <span class="prc-bar-legend-item"><span class="prc-bar-legend-dot" style="background:#22d3ee"></span> ${tBi('Cache', '缓存')}</span>
        <span class="prc-bar-legend-item"><span class="prc-bar-legend-dot" style="background:#fb923c"></span> ${tBi('Thinking', '思考')}</span>
    </div>`;

    html += '</div>';
    return html;
}

// ─── Section Builders ────────────────────────────────────────────────────────

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

    const configByLabel = new Map<string, ModelConfig>();
    for (const config of configs) {
        const normalizedLabel = normalizeModelDisplayName(config.label) || config.label;
        configByLabel.set(normalizedLabel, config);
    }

    let html = `<h2 class="act-section-title">${tBi('Model Info', '模型信息')}</h2>`;
    html += `<div class="prc-dna-grid">`;

    for (const entry of entries) {
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
        const mimeDetailsHtml = supportedMimeTypes.length > 0
            ? `
                <details class="collapsible inline-details" id="d-model-mime-${entryId}">
                    <summary>${tBi('MIME Types', 'MIME 类型')} (${supportedMimeTypes.length})</summary>
                    <div class="details-body">
                        <div class="mime-tags-wrap">
                            ${supportedMimeTypes.map(mime => `<span class="mime-tag">${esc(mime)}</span>`).join('')}
                        </div>
                    </div>
                </details>`
            : '';
        const techDetailsHtml = cc
            ? `
                <details class="collapsible inline-details" id="d-model-tech-${entryId}">
                    <summary>${tBi('Technical Params', '技术参数')}</summary>
                    <div class="details-body">
                        <div class="prc-dna-grid-inner">
                            ${buildDNAField('maxTokens', String(cc.maxTokens))}
                            ${buildDNAField(tBi('temp', '温度'), cc.temperature.toString())}
                            ${buildDNAField(tBi('firstTemp', '初始温度'), cc.firstTemperature.toString())}
                            ${buildDNAField('topK', String(cc.topK))}
                            ${buildDNAField('topP', cc.topP.toString())}
                            ${buildDNAField(tBi('stops', '停止词'), String(cc.stopPatternCount))}
                        </div>
                    </div>
                </details>`
            : '';

        html += `<div class="prc-dna-card">`;
        html += `<div class="prc-dna-header">
            <span class="prc-dna-model">${esc(name)}</span>
        </div>`;

        const metaParts: string[] = [];
        if (responseModel) {
            metaParts.push(`<span class="prc-dna-response-model">${esc(responseModel)}</span>`);
        }
        if (providerShort) {
            metaParts.push(`<span class="prc-dna-provider">${esc(providerShort)}</span>`);
        }
        if (isPersistedOnly) {
            metaParts.push(`<span class="prc-dna-provider">${tBi('cached', '已缓存')}</span>`);
        }
        if (metaParts.length > 0) {
            html += `<div class="prc-dna-meta">${metaParts.join('<span class="prc-dna-sep">·</span>')}</div>`;
        }

        html += `<div class="prc-dna-grid-inner">`;
        html += buildDNAField(tBi('Calls', '调用'), String(callCount));
        html += buildDNAField(tBi('Steps', '步骤'), String(stepsCovered));
        html += buildDNAField(tBi('Credits', '积分'), String(totalCredits));
        if (totalRetries > 0) {
            html += buildDNAField(tBi('Retries', '重试'), String(totalRetries));
        }
        if (errorCount > 0) {
            html += `<div class="prc-dna-field"><span class="prc-dna-label">${tBi('Errors', '错误')}</span><span class="prc-dna-val" style="color:#ef4444">${errorCount}</span></div>`;
        }
        html += `</div>`;
        html += mimeDetailsHtml;
        html += techDetailsHtml;

        html += `</div>`;
    }

    html += `</div>`;
    return html;
}

function buildDNAField(label: string, value: string): string {
    return `<div class="prc-dna-field"><span class="prc-dna-label">${esc(label)}</span><span class="prc-dna-val">${esc(value)}</span></div>`;
}

function toDomSafeId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

// ─── Cost Summary (Card-based) ───────────────────────────────────────────────

function buildCostSummary(rows: import('./pricing-store').ModelCostRow[], grandTotal: number): string {
    if (rows.length === 0) { return ''; }

    const fmtUsd = (n: number) => n < 0.01 ? `$${n.toFixed(4)}` : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    let html = `<h2 class="act-section-title">${tBi('Cost Breakdown', '费用明细')}</h2>`;

    // Grand total card
    html += `<div class="prc-cost-grid">`;
    html += `<div class="prc-cost-card prc-cost-grand">
        <div class="prc-cost-card-header">
            <span class="prc-cost-card-name">${tBi('Grand Total', '总计')}</span>
        </div>
        <div class="prc-cost-grand-val">${fmtUsd(grandTotal)}</div>
        <div class="prc-note" style="margin-top:var(--space-1)">${rows.filter(r => r.pricing).length} ${tBi('models priced', '个模型有定价')}</div>
    </div>`;

    // Per-model cards
    for (const r of rows) {
        if (!r.pricing) {
            html += `<div class="prc-cost-card">
                <div class="prc-cost-card-header">
                    <span class="prc-cost-card-name" data-tooltip="${esc(r.responseModel)}">${esc(r.name)}</span>
                </div>
                <div class="prc-cost-no-pricing">${tBi('No pricing data available', '暂无价格数据')}</div>
            </div>`;
            continue;
        }

        html += `<div class="prc-cost-card">
            <div class="prc-cost-card-header">
                <span class="prc-cost-card-name" data-tooltip="${esc(r.responseModel)}">${esc(r.name)}</span>
                <span class="prc-cost-card-total">${fmtUsd(r.totalCost)}</span>
            </div>
            <div class="prc-cost-card-body">
                <div class="prc-cost-item" data-tooltip="${tBi(
            `${fmt(r.inputTokens)} tok × $${r.pricing.input}/M`,
            `${fmt(r.inputTokens)} 令牌 × $${r.pricing.input}/百万`,
        )}">
                    <span class="prc-cost-item-label"><span class="prc-cost-item-dot" style="background:#60a5fa"></span>${tBi('Input', '输入')}</span>
                    <span class="prc-cost-item-val">${fmtUsd(r.inputCost)}</span>
                </div>
                <div class="prc-cost-item" data-tooltip="${tBi(
            `${fmt(r.outputTokens)} tok × $${r.pricing.output}/M`,
            `${fmt(r.outputTokens)} 令牌 × $${r.pricing.output}/百万`,
        )}">
                    <span class="prc-cost-item-label"><span class="prc-cost-item-dot" style="background:#2dd4bf"></span>${tBi('Output', '输出')}</span>
                    <span class="prc-cost-item-val">${fmtUsd(r.outputCost)}</span>
                </div>
                <div class="prc-cost-item" data-tooltip="${tBi(
            `${fmt(r.cacheTokens)} tok × $${r.pricing.cacheRead}/M`,
            `${fmt(r.cacheTokens)} 令牌 × $${r.pricing.cacheRead}/百万`,
        )}">
                    <span class="prc-cost-item-label"><span class="prc-cost-item-dot" style="background:#22d3ee"></span>${tBi('Cache Read', '缓存读取')}</span>
                    <span class="prc-cost-item-val">${fmtUsd(r.cacheCost)}</span>
                </div>
                <div class="prc-cost-item" data-tooltip="${tBi(
            `${fmt(r.cacheWriteTokens)} tok × $${r.pricing.cacheWrite}/M`,
            `${fmt(r.cacheWriteTokens)} 令牌 × $${r.pricing.cacheWrite}/百万`,
        )}">
                    <span class="prc-cost-item-label"><span class="prc-cost-item-dot" style="background:#22d3ee"></span>${tBi('Cache Write', '缓存写入')}</span>
                    <span class="prc-cost-item-val">${fmtUsd(r.cacheWriteCost)}</span>
                </div>
                ${r.thinkingTokens > 0 ? `<div class="prc-cost-item" data-tooltip="${tBi(
            `${fmt(r.thinkingTokens)} tok × $${r.pricing.thinking}/M`,
            `${fmt(r.thinkingTokens)} 令牌 × $${r.pricing.thinking}/百万`,
        )}">
                    <span class="prc-cost-item-label"><span class="prc-cost-item-dot" style="background:#fb923c"></span>${tBi('Thinking', '思考')}</span>
                    <span class="prc-cost-item-val">${fmtUsd(r.thinkingCost)}</span>
                </div>` : ''}
            </div>
        </div>`;
    }

    html += `</div>`;
    html += `<p class="prc-note">${tBi(
        'Costs are estimates based on the pricing table below. Actual billing may differ with enterprise agreements.',
        '费用基于下方价格表估算。实际计费可能因企业协议而不同。'
    )}</p>`;
    return html;
}

// ─── Editable Pricing (Card-based) ───────────────────────────────────────────

const FIELD_LABELS: Record<string, [string, string]> = {
    input: ['Input', '输入'],
    output: ['Output', '输出'],
    cacheRead: ['Cache Read', '缓存读取'],
    cacheWrite: ['Cache Write', '缓存写入'],
    thinking: ['Thinking', '思考'],
};

function buildEditablePricingTable(
    summary: GMSummary,
    merged: Record<string, ModelPricing>,
    custom: Record<string, ModelPricing>,
): string {
    const entries = Object.entries(summary.modelBreakdown);
    if (entries.length === 0) { return ''; }

    const fields: (keyof ModelPricing)[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'thinking'];

    let html = `<h2 class="act-section-title">${tBi('Custom Pricing', '自定义价格')} <span style="font-size:0.82em;color:var(--color-text-dim)">(${tBi('USD / 1M tokens', 'USD / 100万令牌')})</span></h2>`;
    html += `<div class="prc-edit-section">`;
    html += `<div class="prc-edit-grid">`;

    for (const [name, ms] of entries) {
        const pricing = findPricing(ms.responseModel, merged);
        const isCustom = !!custom[ms.responseModel];
        const p = pricing || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 };

        const sourceClass = isCustom ? 'prc-edit-source-custom' : pricing ? 'prc-edit-source-builtin' : 'prc-edit-source-none';
        const sourceText = isCustom ? tBi('Custom', '自定义') : pricing ? tBi('Built-in', '内置') : tBi('None', '无');

        html += `<div class="prc-edit-card">`;
        html += `<div class="prc-edit-card-header">
            <span class="prc-edit-card-name">${esc(name)}${isCustom ? `<span class="prc-custom-badge">${tBi('CUSTOM', '自定义')}</span>` : ''}</span>
            <span class="prc-edit-source ${sourceClass}">${sourceText}</span>
        </div>`;
        html += `<div class="prc-edit-fields">`;
        for (const f of fields) {
            const [en, zh] = FIELD_LABELS[f] || [f, f];
            html += `<div class="prc-edit-field">
                <span class="prc-edit-field-label">${tBi(en, zh)}</span>
                <input type="number" class="prc-edit-input pricing-input" data-model="${esc(ms.responseModel)}" data-field="${f}" value="${p[f]}" step="0.01" min="0">
            </div>`;
        }
        html += `</div></div>`;
    }

    html += `</div>`;
    html += `<div class="prc-edit-actions">
        <button class="prc-btn prc-btn-primary" id="pricingSaveBtn">${tBi('Save Prices', '保存价格')}</button>
        <button class="prc-btn" id="pricingResetBtn">${tBi('Reset to Default', '恢复默认')}</button>
        <span class="prc-feedback" id="pricingFeedback"></span>
    </div>`;
    html += `<p class="prc-note">${tBi(
        `Edit prices above and click Save. Changes are persisted across sessions. Reset restores built-in defaults. Default prices last updated: ${PRICING_LAST_UPDATED}.`,
        `编辑上方价格后点击保存。修改跨会话持久化。重置恢复内置默认值。默认价格最后更新：${PRICING_LAST_UPDATED}。`
    )}</p>`;
    html += `</div>`;
    return html;
}

/** Pricing table using DEFAULT_PRICING keys — shown when no GM data is available. */
function buildDefaultPricingTable(
    merged: Record<string, ModelPricing>,
    custom: Record<string, ModelPricing>,
): string {
    const entries = Object.entries(merged);
    if (entries.length === 0) { return ''; }

    const fields: (keyof ModelPricing)[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'thinking'];

    let html = `<h2 class="act-section-title">${tBi('Custom Pricing', '自定义价格')} <span style="font-size:0.82em;color:var(--color-text-dim)">(${tBi('USD / 1M tokens', 'USD / 100万令牌')})</span></h2>`;
    html += `<div class="prc-edit-section"><div class="prc-edit-grid">`;

    for (const [model, p] of entries) {
        const isCustom = !!custom[model];
        const sourceClass = isCustom ? 'prc-edit-source-custom' : 'prc-edit-source-builtin';
        const sourceText = isCustom ? tBi('Custom', '自定义') : tBi('Built-in', '内置');

        html += `<div class="prc-edit-card">`;
        html += `<div class="prc-edit-card-header">
            <span class="prc-edit-card-name">${esc(model)}${isCustom ? `<span class="prc-custom-badge">${tBi('CUSTOM', '自定义')}</span>` : ''}</span>
            <span class="prc-edit-source ${sourceClass}">${sourceText}</span>
        </div>`;
        html += `<div class="prc-edit-fields">`;
        for (const f of fields) {
            const [en, zh] = FIELD_LABELS[f] || [f, f];
            html += `<div class="prc-edit-field">
                <span class="prc-edit-field-label">${tBi(en, zh)}</span>
                <input type="number" class="prc-edit-input pricing-input" data-model="${esc(model)}" data-field="${f}" value="${p[f]}" step="0.01" min="0">
            </div>`;
        }
        html += `</div></div>`;
    }

    html += `</div>`;
    html += `<div class="prc-edit-actions"><button class="prc-btn prc-btn-primary" id="pricingSaveBtn">${tBi('Save Prices', '保存价格')}</button><button class="prc-btn" id="pricingResetBtn">${tBi('Reset to Default', '恢复默认')}</button><span class="prc-feedback" id="pricingFeedback"></span></div>`;
    html += `<p class="prc-note">${tBi(
        `Edit prices above and click Save. Changes are persisted across sessions. Default prices last updated: ${PRICING_LAST_UPDATED}.`,
        `编辑上方价格后点击保存。修改跨会话持久化。默认价格最后更新：${PRICING_LAST_UPDATED}。`
    )}</p></div>`;
    return html;
}

// ─── Monthly Cost Summary Builder ────────────────────────────────────────────

const MONTH_NAMES_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAMES_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const CALENDAR_LINK_ICON = '<svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/></svg>';
const DOLLAR_ICON = '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M4 10.781c.148 1.667 1.513 2.85 3.591 3.003V15h1.043v-1.216c2.27-.179 3.678-1.438 3.678-3.3 0-1.59-.947-2.51-2.956-3.028l-.722-.187V3.467c1.122.11 1.879.714 2.07 1.616h1.47c-.166-1.6-1.54-2.748-3.54-2.875V1H7.591v1.233c-1.939.23-3.27 1.472-3.27 3.156 0 1.454.966 2.483 2.661 2.917l.61.162v4.031c-1.149-.17-1.94-.8-2.131-1.718zm3.391-3.836c-1.043-.263-1.6-.825-1.6-1.616 0-.944.704-1.641 1.8-1.828v3.495zM8.634 8.1C9.858 8.418 10.44 9 10.44 9.89c0 1.12-.789 1.816-2.007 1.931V8.1z"/></svg>';

function fmtCost(n: number): string {
    if (n >= 100) { return '$' + n.toFixed(0); }
    if (n >= 1) { return '$' + n.toFixed(2); }
    if (n > 0) { return '$' + n.toFixed(4); }
    return '$0.00';
}

function fmtTokensK(n: number): string {
    if (n >= 1_000_000) { return (n / 1_000_000).toFixed(1) + 'M'; }
    if (n >= 1_000) { return (n / 1_000).toFixed(1) + 'k'; }
    return String(n);
}

/** Build the monthly cost summary section for the Pricing tab. */
function buildMonthlyCostSummary(
    breakdown: MonthCostBreakdown,
    currentCycleCost: number,
    currentCycleRows: ModelCostRow[],
): string {
    const monthEn = MONTH_NAMES_EN[breakdown.month - 1];
    const monthZh = MONTH_NAMES_ZH[breakdown.month - 1];
    const now = new Date();
    const isCurrentMonth = breakdown.year === now.getFullYear() && breakdown.month === (now.getMonth() + 1);

    // Merge archived data with current live cycle
    const mergedModels = new Map<string, { name: string; totalCost: number; calls: number; inputTokens: number; outputTokens: number; thinkingTokens: number }>();

    // 1. Archived cycles from DailyStore
    for (const m of breakdown.models) {
        const cleanName = normalizeModelDisplayName(m.name) || m.name;
        mergedModels.set(cleanName, {
            name: cleanName,
            totalCost: m.totalCost,
            calls: m.calls,
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            thinkingTokens: m.thinkingTokens,
        });
    }

    // 2. Current live cycle (not yet archived)
    if (isCurrentMonth && currentCycleRows.length > 0) {
        for (const row of currentCycleRows) {
            const key = normalizeModelDisplayName(row.name) || row.name;
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

    const grandTotal = breakdown.grandTotal + (isCurrentMonth ? currentCycleCost : 0);
    const totalCycles = breakdown.cycleCount + (isCurrentMonth && currentCycleCost > 0 ? 1 : 0);
    const models = [...mergedModels.values()].sort((a, b) => b.totalCost - a.totalCost);
    const maxCost = models.length > 0 ? models[0].totalCost : 1;

    // Determine if data is incomplete (started mid-month)
    let dataCoverageNote = '';
    if (breakdown.earliestDate && isCurrentMonth) {
        const dayNum = parseInt(breakdown.earliestDate.split('-')[2], 10);
        if (dayNum > 1) {
            dataCoverageNote = tBi(
                `Data recorded from ${breakdown.earliestDate}. Earlier usage in this month is not tracked.`,
                `数据从 ${breakdown.earliestDate} 开始记录。本月更早的用量未被追踪。`,
            );
        }
    }

    let html = `<section class="card prc-monthly-section">`;

    // Header with title and calendar link
    html += `<div class="prc-monthly-header">
        <h2>${DOLLAR_ICON} ${tBi(`${monthEn} ${breakdown.year} Cost`, `${breakdown.year}年${monthZh}费用`)}</h2>
        <button class="prc-monthly-calendar-link" data-switch-tab="calendar">
            ${CALENDAR_LINK_ICON} ${tBi('View History', '查看历史')}
        </button>
    </div>`;

    if (models.length === 0 && grandTotal === 0) {
        html += `<p class="prc-monthly-empty">${tBi(
            'No cost data recorded for this month yet.',
            '本月暂无费用数据。',
        )}</p>`;
        html += `</section>`;
        return html;
    }

    // Grand total highlight
    const archivedLabel = isCurrentMonth
        ? tBi(
            `${breakdown.cycleCount} archived cycle${breakdown.cycleCount !== 1 ? 's' : ''} + current`,
            `${breakdown.cycleCount} 个已归档周期 + 当前`,
        )
        : tBi(
            `${totalCycles} cycle${totalCycles !== 1 ? 's' : ''}`,
            `${totalCycles} 个周期`,
        );

    html += `<div class="prc-monthly-grand">
        <span class="prc-monthly-grand-val">${fmtCost(grandTotal)}</span>
        <span class="prc-monthly-grand-label">${tBi('Total', '总计')}</span>
        <span class="prc-monthly-grand-breakdown">${archivedLabel}</span>
    </div>`;

    // Per-model rows with proportional bar
    html += `<div class="prc-monthly-models">`;
    for (const m of models) {
        const pct = maxCost > 0 ? Math.max(2, (m.totalCost / maxCost) * 100) : 0;
        html += `<div class="prc-monthly-card">
            <span class="prc-monthly-model-name">${esc(m.name)}</span>
            <div class="prc-monthly-bar-wrap">
                <div class="prc-monthly-bar-fill" style="width:${pct.toFixed(1)}%"></div>
            </div>
            <span class="prc-monthly-model-cost">${fmtCost(m.totalCost)}</span>
        </div>
        <div class="prc-monthly-chips" style="padding-left:var(--space-3); margin-top:-4px; margin-bottom:var(--space-1)">
            <span class="prc-monthly-chip">${fmtTokensK(m.inputTokens)} in</span>
            <span class="prc-monthly-chip">${fmtTokensK(m.outputTokens)} out</span>
            ${m.thinkingTokens > 0 ? `<span class="prc-monthly-chip">${fmtTokensK(m.thinkingTokens)} think</span>` : ''}
            <span class="prc-monthly-chip">${m.calls} ${tBi('calls', '调用')}</span>
        </div>`;
    }
    html += `</div>`;

    // Data coverage note
    if (dataCoverageNote) {
        html += `<p class="prc-monthly-note">
            <svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path fill="currentColor" d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/></svg>
            ${dataCoverageNote}
        </p>`;
    }

    html += `</section>`;
    return html;
}

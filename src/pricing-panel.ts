// ─── Pricing Tab Content Builder ─────────────────────────────────────────────
// Renders the "Pricing" tab: model DNA cards, cost estimation, editable pricing
// table, and built-in pricing reference. All pricing logic uses pricing-store.ts.

import { tBi } from './i18n';
import { GMSummary, GMModelStats, GMCompletionConfig } from './gm-tracker';
import { PricingStore, DEFAULT_PRICING, PRICING_LAST_UPDATED, findPricing, ModelPricing } from './pricing-store';
import { esc } from './webview-helpers';

// ─── Public API ──────────────────────────────────────────────────────────────

export function buildPricingTabContent(summary: GMSummary | null, store: PricingStore): string {
    const hasGM = summary && summary.totalCalls > 0;

    if (hasGM) {
        const { rows, grandTotal } = store.calculateCosts(summary);
        const merged = store.getMerged();
        return [
            buildModelDNACards(summary),
            buildCostVisualization(rows, grandTotal, summary),
            buildCostSummary(rows, grandTotal),
            buildEditablePricingTable(summary, merged, store.getCustom()),
        ].join('');
    }

    // No GM data yet — still show the editable pricing table with defaults
    return [
        `<p class="empty-msg">${tBi(
            'Cost analysis will appear after GM data is available. You can configure custom prices below.',
            '费用分析将在 GM 数据可用后显示。您可以在下方配置自定义价格。',
        )}</p>`,
        buildDefaultPricingTable(store.getMerged(), store.getCustom()),
    ].join('');
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
        background: linear-gradient(90deg, var(--color-accent, #8b5cf6), var(--color-info, #60a5fa));
        border-radius: var(--radius-md) var(--radius-md) 0 0;
    }
    .prc-dna-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-2);
    }
    .prc-dna-model {
        font-weight: 700;
        font-size: 1em;
    }
    .prc-dna-provider {
        display: inline-block;
        font-size: 0.72em;
        padding: 1px var(--space-1);
        border-radius: var(--radius-sm);
        background: rgba(96,165,250,0.1);
        color: var(--color-info);
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
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.04);
    }
    .prc-dna-label {
        font-size: 0.68em;
        color: var(--color-text-dim);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .prc-dna-val {
        font-weight: 700;
        font-size: 0.95em;
    }
    .prc-dna-sections {
        margin-top: var(--space-2);
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
    }
    .prc-section-tag {
        display: inline-block;
        font-size: 0.68em;
        padding: 1px var(--space-1);
        border-radius: var(--radius-sm);
        background: rgba(139,92,246,0.1);
        color: #a78bfa;
    }
    .prc-tool-tag {
        display: inline-block;
        font-size: 0.68em;
        padding: 1px var(--space-1);
        border-radius: var(--radius-sm);
        background: rgba(52,211,153,0.1);
        color: #34d399;
    }
    .prc-error-tag {
        display: inline-block;
        font-size: 0.68em;
        padding: 1px var(--space-1);
        border-radius: var(--radius-sm);
        background: rgba(239,68,68,0.1);
        color: #ef4444;
    }

    /* ── Cost Table ── */
    .prc-cost-section {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-3);
        margin-bottom: var(--space-4);
    }
    .prc-cost-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85em;
    }
    .prc-cost-table th,
    .prc-cost-table td {
        padding: var(--space-1) var(--space-2);
        text-align: right;
        border-bottom: 1px solid var(--color-border);
    }
    .prc-cost-table th {
        font-size: 0.72em;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--color-text-dim);
        font-weight: 600;
    }
    .prc-cost-table td:first-child,
    .prc-cost-table th:first-child {
        text-align: left;
    }
    .prc-cost-table tr:last-child td {
        border-bottom: none;
        font-weight: 700;
    }
    .prc-cost-total {
        color: #f59e0b;
    }
    .prc-note {
        font-size: 0.72em;
        color: var(--color-text-dim);
        margin-top: var(--space-2);
        font-style: italic;
    }

    /* ── Editable Pricing ── */
    .prc-edit-section {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-3);
        margin-bottom: var(--space-4);
    }
    .prc-edit-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.82em;
    }
    .prc-edit-table th,
    .prc-edit-table td {
        padding: var(--space-1) var(--space-1);
        text-align: right;
        border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .prc-edit-table th {
        font-size: 0.72em;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--color-text-dim);
        font-weight: 600;
    }
    .prc-edit-table td:first-child,
    .prc-edit-table th:first-child {
        text-align: left;
    }
    .prc-edit-input {
        appearance: none;
        width: 72px;
        padding: 2px var(--space-1);
        font-size: 0.9em;
        font-family: inherit;
        text-align: right;
        background: rgba(255,255,255,0.04);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        color: inherit;
        transition: border-color 0.2s cubic-bezier(.4,0,.2,1), background 0.2s cubic-bezier(.4,0,.2,1);
    }
    .prc-edit-input:focus {
        outline: none;
        border-color: var(--color-accent, #8b5cf6);
        background: rgba(139,92,246,0.08);
    }
    @media (hover: hover) {
        .prc-edit-input:hover {
            border-color: rgba(255,255,255,0.2);
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
        font-size: 0.82em;
        font-family: inherit;
        font-weight: 600;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        background: rgba(255,255,255,0.06);
        color: inherit;
        cursor: pointer;
        transition: background 0.2s cubic-bezier(.4,0,.2,1), border-color 0.2s cubic-bezier(.4,0,.2,1), transform 0.1s;
    }
    @media (hover: hover) {
        .prc-btn:hover {
            background: rgba(255,255,255,0.1);
            border-color: rgba(255,255,255,0.2);
        }
    }
    .prc-btn:active {
        transform: scale(0.98);
    }
    .prc-btn:focus-visible {
        box-shadow: 0 0 0 2px var(--color-accent, #8b5cf6);
    }
    .prc-btn-primary {
        background: rgba(139,92,246,0.15);
        border-color: rgba(139,92,246,0.3);
        color: #c4b5fd;
    }
    @media (hover: hover) {
        .prc-btn-primary:hover {
            background: rgba(139,92,246,0.25);
        }
    }
    .prc-feedback {
        font-size: 0.85em;
        color: #34d399;
        font-weight: 600;
        opacity: 0;
        transition: opacity 0.3s cubic-bezier(.4,0,.2,1);
    }
    .prc-custom-badge {
        display: inline-block;
        font-size: 0.62em;
        padding: 0 4px;
        border-radius: var(--radius-sm);
        background: rgba(251,191,36,0.15);
        color: #fbbf24;
        font-weight: 600;
        margin-left: 4px;
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
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.04);
    }

    .prc-viz-hl-val {
        font-weight: 700;
        font-size: 1.2em;
    }

    .prc-viz-hl-label {
        font-size: 0.68em;
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
        font-size: 0.82em;
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
        background: rgba(255,255,255,0.04);
        overflow: hidden;
        display: flex;
    }

    .prc-bar-seg {
        height: 100%;
        min-width: 1px;
        transition: width 0.3s cubic-bezier(.4,0,.2,1);
    }

    .prc-bar-seg-input { background: #60a5fa; }
    .prc-bar-seg-output { background: #a78bfa; }
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
        font-size: 0.72em;
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

    let html = `<h2 class="act-section-title">${tBi('Cost Overview', '费用概览')} <span class="gm-badge-real">${tBi('Visual', '可视化')}</span></h2>`;
    html += '<div class="prc-viz-section">';

    // Highlight cards
    html += '<div class="prc-viz-highlights">';
    html += `<div class="prc-viz-highlight">
        <div class="prc-viz-hl-val" style="color:#f59e0b">${fmtUsd(grandTotal)}</div>
        <div class="prc-viz-hl-label">${tBi('Total Cost', '总费用')}</div>
    </div>`;
    html += `<div class="prc-viz-highlight">
        <div class="prc-viz-hl-val" style="color:#a78bfa">${esc(topModel.name)}</div>
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
                ${inputPct > 0 ? `<div class="prc-bar-seg prc-bar-seg-input" style="width:${inputPct.toFixed(1)}%" data-tooltip="Input: ${fmtUsd(r.inputCost)}"></div>` : ''}
                ${outputPct > 0 ? `<div class="prc-bar-seg prc-bar-seg-output" style="width:${outputPct.toFixed(1)}%" data-tooltip="Output: ${fmtUsd(r.outputCost)}"></div>` : ''}
                ${cachePct > 0 ? `<div class="prc-bar-seg prc-bar-seg-cache" style="width:${cachePct.toFixed(1)}%" data-tooltip="Cache: ${fmtUsd(r.cacheCost + r.cacheWriteCost)}"></div>` : ''}
                ${thinkPct > 0 ? `<div class="prc-bar-seg prc-bar-seg-thinking" style="width:${thinkPct.toFixed(1)}%" data-tooltip="Thinking: ${fmtUsd(r.thinkingCost)}"></div>` : ''}
            </div>
            <span class="prc-bar-val" style="color:#f59e0b">${fmtUsd(r.totalCost)}</span>
        </div>`;
    }

    // Legend
    html += `<div class="prc-bar-legend">
        <span class="prc-bar-legend-item"><span class="prc-bar-legend-dot" style="background:#60a5fa"></span> Input</span>
        <span class="prc-bar-legend-item"><span class="prc-bar-legend-dot" style="background:#a78bfa"></span> Output</span>
        <span class="prc-bar-legend-item"><span class="prc-bar-legend-dot" style="background:#22d3ee"></span> Cache</span>
        <span class="prc-bar-legend-item"><span class="prc-bar-legend-dot" style="background:#fb923c"></span> Thinking</span>
    </div>`;

    html += '</div>';
    return html;
}

// ─── Section Builders ────────────────────────────────────────────────────────

function buildModelDNACards(s: GMSummary): string {
    const entries = Object.entries(s.modelBreakdown).sort((a, b) => b[1].stepsCovered - a[1].stepsCovered);
    if (entries.length === 0) { return ''; }

    let html = `<h2 class="act-section-title">${tBi('Model DNA', '模型 DNA')} <span class="gm-badge-real">${tBi('From LS', '来自 LS')}</span></h2>`;
    html += `<div class="prc-dna-grid">`;

    for (const [name, ms] of entries) {
        const providerShort = ms.apiProvider.replace('API_PROVIDER_', '').replace(/_/g, ' ');
        const cc = ms.completionConfig;

        html += `<div class="prc-dna-card">`;
        html += `<div class="prc-dna-header">
            <span class="prc-dna-model">${esc(name)}</span>
            ${providerShort ? `<span class="prc-dna-provider">${esc(providerShort)}</span>` : ''}
        </div>`;

        // Response model name
        if (ms.responseModel) {
            html += `<div style="font-size:0.78em;color:var(--color-text-dim);margin-bottom:var(--space-2)">${esc(ms.responseModel)}</div>`;
        }

        // Config grid
        html += `<div class="prc-dna-grid-inner">`;
        if (cc) {
            html += buildDNAField('maxTokens', String(cc.maxTokens));
            html += buildDNAField('temperature', cc.temperature.toString());
            html += buildDNAField('firstTemp', cc.firstTemperature.toString());
            html += buildDNAField('topK', String(cc.topK));
            html += buildDNAField('topP', cc.topP.toString());
            html += buildDNAField('stopPatterns', String(cc.stopPatternCount));
        } else {
            html += buildDNAField('config', tBi('N/A', '无'));
        }
        html += buildDNAField(tBi('Calls', '调用'), String(ms.callCount));
        html += buildDNAField(tBi('Steps', '步骤'), String(ms.stepsCovered));
        html += buildDNAField(tBi('Credits', '积分'), String(ms.totalCredits));
        if (ms.totalRetries > 0) {
            html += buildDNAField(tBi('Retries', '重试'), String(ms.totalRetries));
        }
        if (ms.errorCount > 0) {
            html += `<div class="prc-dna-field"><span class="prc-dna-label">${tBi('Errors', '错误')}</span><span class="prc-dna-val" style="color:#ef4444">${ms.errorCount}</span></div>`;
        }
        html += `</div>`;

        // Tags row: prompt sections + tools + system prompt indicator
        const hasTags = ms.promptSectionTitles.length > 0 || ms.toolCount > 0 || ms.hasSystemPrompt;
        if (hasTags) {
            html += `<div class="prc-dna-sections">`;
            if (ms.hasSystemPrompt) {
                html += `<span class="prc-section-tag">systemPrompt</span>`;
            }
            for (const title of ms.promptSectionTitles) {
                html += `<span class="prc-section-tag">${esc(title)}</span>`;
            }
            if (ms.toolCount > 0) {
                html += `<span class="prc-tool-tag">${ms.toolCount} ${tBi('tools', '工具')}</span>`;
            }
            if (ms.errorCount > 0) {
                html += `<span class="prc-error-tag">${ms.errorCount} ${tBi('errors', '错误')}</span>`;
            }
            html += `</div>`;
        }

        html += `</div>`;
    }

    html += `</div>`;
    return html;
}

function buildDNAField(label: string, value: string): string {
    return `<div class="prc-dna-field"><span class="prc-dna-label">${esc(label)}</span><span class="prc-dna-val">${esc(value)}</span></div>`;
}

function buildCostSummary(rows: import('./pricing-store').ModelCostRow[], grandTotal: number): string {
    if (rows.length === 0) { return ''; }

    const fmtUsd = (n: number) => n < 0.01 ? `$${n.toFixed(4)}` : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    let html = `<h2 class="act-section-title">${tBi('Cost Estimate', '费用估算')} <span class="gm-badge-real">${tBi('Based on pricing table', '基于价格表')}</span></h2>`;
    html += `<div class="prc-cost-section">`;
    html += `<table class="prc-cost-table">
        <thead><tr>
            <th>${tBi('Model', '模型')}</th>
            <th>${tBi('Input', '输入')}</th>
            <th>${tBi('Output', '输出')}</th>
            <th>${tBi('Cache Read', '缓存读取')}</th>
            <th>${tBi('Cache Write', '缓存写入')}</th>
            <th>${tBi('Thinking', '思考')}</th>
            <th>${tBi('Total', '合计')}</th>
        </tr></thead><tbody>`;

    for (const r of rows) {
        if (!r.pricing) {
            html += `<tr>
                <td>${esc(r.name)}</td>
                <td colspan="5" style="text-align:center;color:var(--color-text-dim);font-size:0.85em">${tBi('No pricing data', '无价格数据')}</td>
                <td>-</td>
            </tr>`;
            continue;
        }
        html += `<tr>
            <td data-tooltip="${esc(r.responseModel)}">${esc(r.name)}</td>
            <td data-tooltip="${fmt(r.inputTokens)} tok × $${r.pricing.input}/M">${fmtUsd(r.inputCost)}</td>
            <td data-tooltip="${fmt(r.outputTokens)} tok × $${r.pricing.output}/M">${fmtUsd(r.outputCost)}</td>
            <td data-tooltip="${fmt(r.cacheTokens)} tok × $${r.pricing.cacheRead}/M">${fmtUsd(r.cacheCost)}</td>
            <td data-tooltip="${fmt(r.cacheWriteTokens)} tok × $${r.pricing.cacheWrite}/M">${fmtUsd(r.cacheWriteCost)}</td>
            <td data-tooltip="${fmt(r.thinkingTokens)} tok × $${r.pricing.thinking}/M">${r.thinkingTokens > 0 ? fmtUsd(r.thinkingCost) : '-'}</td>
            <td class="prc-cost-total">${fmtUsd(r.totalCost)}</td>
        </tr>`;
    }

    html += `<tr>
        <td><strong>${tBi('Total', '合计')}</strong></td>
        <td></td><td></td><td></td><td></td><td></td>
        <td class="prc-cost-total" style="font-size:1.1em">${fmtUsd(grandTotal)}</td>
    </tr>`;

    html += `</tbody></table>`;
    html += `<p class="prc-note">${tBi(
        'Costs are estimates based on the pricing table below. Actual billing may differ with enterprise agreements.',
        '费用基于下方价格表估算。实际计费可能因企业协议而不同。'
    )}</p>`;
    html += `</div>`;
    return html;
}

function buildEditablePricingTable(
    summary: GMSummary,
    merged: Record<string, ModelPricing>,
    custom: Record<string, ModelPricing>,
): string {
    const entries = Object.entries(summary.modelBreakdown);
    if (entries.length === 0) { return ''; }

    const fields: (keyof ModelPricing)[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'thinking'];
    const fieldLabels: Record<string, string> = {
        input: 'Input',
        output: 'Output',
        cacheRead: 'Cache Read',
        cacheWrite: 'Cache Write',
        thinking: 'Thinking',
    };

    let html = `<h2 class="act-section-title">${tBi('Custom Pricing', '自定义价格')} <span style="font-size:0.72em;color:var(--color-text-dim)">(USD / 1M tokens)</span></h2>`;
    html += `<div class="prc-edit-section">`;
    html += `<table class="prc-edit-table">
        <thead><tr>
            <th>${tBi('Model', '模型')}</th>
            ${fields.map(f => `<th>${fieldLabels[f]}</th>`).join('')}
            <th>${tBi('Source', '来源')}</th>
        </tr></thead><tbody>`;

    for (const [name, ms] of entries) {
        const pricing = findPricing(ms.responseModel, merged);
        const isCustom = !!custom[ms.responseModel];
        const p = pricing || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 };

        html += `<tr>`;
        html += `<td data-tooltip="${esc(ms.responseModel)}">${esc(name)}${isCustom ? '<span class="prc-custom-badge">CUSTOM</span>' : ''}</td>`;
        for (const f of fields) {
            html += `<td><input type="number" class="prc-edit-input pricing-input" data-model="${esc(ms.responseModel)}" data-field="${f}" value="${p[f]}" step="0.01" min="0"></td>`;
        }
        const sourceLabel = isCustom
            ? `<span style="color:#fbbf24">${tBi('Custom', '自定义')}</span>`
            : pricing
                ? `<span style="color:#34d399">${tBi('Built-in', '内置')}</span>`
                : `<span style="color:var(--color-text-dim)">${tBi('None', '无')}</span>`;
        html += `<td>${sourceLabel}</td>`;
        html += `</tr>`;
    }

    html += `</tbody></table>`;
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
    const fieldLabels: Record<string, string> = {
        input: 'Input', output: 'Output', cacheRead: 'Cache Read', cacheWrite: 'Cache Write', thinking: 'Thinking',
    };

    let html = `<h2 class="act-section-title">${tBi('Custom Pricing', '自定义价格')} <span style="font-size:0.72em;color:var(--color-text-dim)">(USD / 1M tokens)</span></h2>`;
    html += `<div class="prc-edit-section"><table class="prc-edit-table"><thead><tr><th>${tBi('Model', '模型')}</th>${fields.map(f => `<th>${fieldLabels[f]}</th>`).join('')}<th>${tBi('Source', '来源')}</th></tr></thead><tbody>`;

    for (const [model, p] of entries) {
        const isCustom = !!custom[model];
        html += `<tr><td>${esc(model)}${isCustom ? '<span class="prc-custom-badge">CUSTOM</span>' : ''}</td>`;
        for (const f of fields) {
            html += `<td><input type="number" class="prc-edit-input pricing-input" data-model="${esc(model)}" data-field="${f}" value="${p[f]}" step="0.01" min="0"></td>`;
        }
        const sourceLabel = isCustom
            ? `<span style="color:#fbbf24">${tBi('Custom', '自定义')}</span>`
            : `<span style="color:#34d399">${tBi('Built-in', '内置')}</span>`;
        html += `<td>${sourceLabel}</td></tr>`;
    }

    html += `</tbody></table>`;
    html += `<div class="prc-edit-actions"><button class="prc-btn prc-btn-primary" id="pricingSaveBtn">${tBi('Save Prices', '保存价格')}</button><button class="prc-btn" id="pricingResetBtn">${tBi('Reset to Default', '恢复默认')}</button><span class="prc-feedback" id="pricingFeedback"></span></div>`;
    html += `<p class="prc-note">${tBi(
        `Edit prices above and click Save. Changes are persisted across sessions. Default prices last updated: ${PRICING_LAST_UPDATED}.`,
        `编辑上方价格后点击保存。修改跨会话持久化。默认价格最后更新：${PRICING_LAST_UPDATED}。`
    )}</p></div>`;
    return html;
}

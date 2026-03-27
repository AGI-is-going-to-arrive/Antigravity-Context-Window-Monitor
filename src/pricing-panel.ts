// ─── Pricing Tab Content Builder ─────────────────────────────────────────────
// Renders the "Pricing" tab: cost estimation and editable pricing table.
// Model DNA is rendered in the dedicated Models tab.

import { tBi } from './i18n';
import { GMSummary, GMModelStats, GMCompletionConfig } from './gm-tracker';
import { PricingStore, DEFAULT_PRICING, PRICING_LAST_UPDATED, findPricing, ModelPricing } from './pricing-store';
import { esc } from './webview-helpers';
import { getModelDNAKey, type PersistedModelDNA } from './model-dna-store';
import { ModelConfig, normalizeModelDisplayName } from './models';

// ─── Public API ──────────────────────────────────────────────────────────────

export function buildPricingTabContent(summary: GMSummary | null, store: PricingStore): string {
    const hasGM = summary && summary.totalCalls > 0;

    if (hasGM) {
        const { rows, grandTotal } = store.calculateCosts(summary);
        const merged = store.getMerged();
        return [
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
        .prc-bar-seg, .prc-edit-input, .prc-cost-card, .prc-edit-card { transition: none; }
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
        const name = entry.current?.[0] || persistedEntry?.displayName || entry.key;
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

    let html = `<h2 class="act-section-title">${tBi('Cost Breakdown', '费用明细')} <span class="gm-badge-real">${tBi('Per Model', '按模型')}</span></h2>`;

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
    input:      ['Input',       '输入'],
    output:     ['Output',      '输出'],
    cacheRead:  ['Cache Read',  '缓存读取'],
    cacheWrite: ['Cache Write', '缓存写入'],
    thinking:   ['Thinking',    '思考'],
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

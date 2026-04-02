// ─── GM Data Tab Content Builder ─────────────────────────────────────────────
// Provides HTML + CSS for the unified "GM Data" tab within the main monitor panel.
// Merges Activity tracking data with GM precision data into a single view.
// This module is a content-only builder — the panel itself is managed by webview-panel.ts.

import { tBi } from './i18n';
import { ActivitySummary, ActivityArchive, ModelActivityStats, CheckpointSnapshot, ConversationBreakdown } from './activity-tracker';
import { esc, formatShortTime as formatTime } from './webview-helpers';
import type { ContextUsage } from './tracker';
import type { GMSummary, GMModelStats, GMConversationData, TokenBreakdownGroup } from './gm-tracker';

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the complete HTML content for the unified GM Data tab.
 * Merges Activity tracking (timeline, tools, distribution) with GM precision data
 * (performance, cache efficiency, context growth, conversations).
 */
export function buildGMDataTabContent(
    summary: ActivitySummary | null,
    gmSummary: GMSummary | null,
    currentUsage?: ContextUsage | null,
): string {
    if (!summary && (!gmSummary || gmSummary.totalCalls === 0)) {
        return `<p class="empty-msg">${tBi(
            'Waiting for data... GM and Activity information will appear automatically.',
            '正在等待数据... GM 和活动信息将自动显示。',
        )}</p>`;
    }

    const parts: string[] = [];

    // ── Data scope explanation
    parts.push(`<details class="act-tl-legend gm-scope-note" id="gmScopeNote">
        <summary>${tBi('ℹ Data Scope', 'ℹ 数据范围')}</summary>
        <div class="act-tl-legend-body">
            <div class="act-tl-legend-note act-tl-legend-note-info">
                <svg class="act-tl-legend-note-icon" viewBox="0 0 16 16"><path fill="currentColor" d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path fill="currentColor" d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/></svg>
                <div>
                    <b>${tBi('Counting cycle = Quota cycle, not per-session or per-day.', '统计周期 = 额度周期，而非单个会话或单日。')}</b><br/>
                    ${tBi(
                        'All metrics (calls, tokens, credits) below accumulate within the <b>current quota cycle</b>. When a model pool\'s quota resets, only that pool\'s data is archived — other pools continue counting. For example, Claude + OSS models share one reset cycle, while Gemini Pro has its own independent cycle.',
                        '以下所有指标（调用次数、token、credits）均在<b>当前额度周期</b>内累计。当某个模型池的额度重置时，仅归档该池的数据——其他模型池的统计继续。例如 Claude + OSS 共用一个重置周期，而 Gemini Pro 拥有独立的周期。',
                    )}
                </div>
            </div>
        </div>
    </details>`);

    // ── Summary Bar (merged activity + GM)
    parts.push(buildSummaryBar(summary, gmSummary));

    // ── Recent Timeline (activity)
    if (summary) { parts.push(buildTimeline(summary, currentUsage)); }

    // ── Model Cards (merged activity counts + GM precision)
    parts.push(buildModelCards(summary, gmSummary));

    // ── Tool Ranking + Model Distribution (activity)
    if (summary) {
        const distHtml = buildDistribution(summary);
        const toolsHtml = buildToolRanking(summary);
        if (distHtml || toolsHtml) {
            parts.push(`<div class="act-two-col">
                ${toolsHtml ? `<div class="act-col">${toolsHtml}</div>` : ''}
                ${distHtml ? `<div class="act-col">${distHtml}</div>` : ''}
            </div>`);
        }
    }

    // ── Performance + Cache Efficiency (GM)
    if (gmSummary && gmSummary.totalCalls > 0) {
        const perf = buildPerformanceChart(gmSummary);
        const cache = buildCacheEfficiency(gmSummary);
        if (perf || cache) {
            parts.push(`<div class="act-two-col">
                ${perf ? `<div class="act-col">${perf}</div>` : ''}
                ${cache ? `<div class="act-col">${cache}</div>` : ''}
            </div>`);
        }
    }

    // ── Context Growth + Conversations (GM)
    if (gmSummary && gmSummary.totalCalls > 0) {
        const ctx = buildContextGrowth(gmSummary);
        const conv = buildConversations(gmSummary);
        if (ctx || conv) {
            parts.push(`<div class="act-two-col">
                ${ctx ? `<div class="act-col">${ctx}</div>` : ''}
                ${conv ? `<div class="act-col">${conv}</div>` : ''}
            </div>`);
        }
    }
    // ── Retry Overhead + Token Breakdown (GM — new probes)
    if (gmSummary && gmSummary.totalCalls > 0) {
        const retry = buildRetryOverhead(gmSummary);
        const breakdown = buildTokenBreakdownChart(gmSummary);
        if (retry || breakdown) {
            parts.push(`<div class="act-two-col">
                ${retry ? `<div class="act-col">${retry}</div>` : ''}
                ${breakdown ? `<div class="act-col">${breakdown}</div>` : ''}
            </div>`);
        }
    }

    return parts.join('');
}

/**
 * Return CSS styles specific to the Activity tab.
 * Merged into the main panel's <style> block by webview-panel.ts.
 */
export function getGMDataTabStyles(): string {
    return `
    /* ─── Activity Tab: Summary Bar ─── */
    .act-summary-bar {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2);
        padding: var(--space-2);
        margin-bottom: var(--space-4);
        justify-content: center;
    }
    .act-stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: var(--space-2) var(--space-3);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        transition: border-color 0.2s cubic-bezier(.4,0,.2,1), box-shadow 0.2s cubic-bezier(.4,0,.2,1);
        position: relative;
        cursor: default;
        min-width: 70px;
    }
    @media (hover: hover) {
        .act-stat:hover {
            border-color: rgba(96,165,250,0.5);
            box-shadow: 0 0 8px rgba(96,165,250,0.15);
        }
        .act-stat[data-tooltip]:hover::after {
            content: attr(data-tooltip);
            position: absolute;
            bottom: calc(100% + 6px);
            left: 50%;
            transform: translateX(-50%);
            padding: var(--space-1) var(--space-2);
            background: var(--color-bg);
            color: var(--color-text);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-sm);
            font-size: 0.75em;
            font-weight: 400;
            text-transform: none;
            letter-spacing: 0;
            white-space: nowrap;
            z-index: var(--z-tooltip, 500);
            pointer-events: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        }
    }
    .act-stat-icon svg { display: block; }
    .act-icon { width: 1.1em; height: 1.1em; display: inline-block; vertical-align: -0.2em; margin-right: 0.3em; color: var(--color-text-dim); }
    .act-stat-val { font-weight: 700; font-size: 1.15em; line-height: 1.2; }
    .act-est { font-weight: 400; font-size: 0.85em; opacity: 0.6; font-style: italic; }
    .act-stat-label { color: var(--color-text-dim); font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.5px; }

    /* ─── Activity Tab: Layout Grids ─── */
    .act-two-col {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: var(--space-4);
        margin-bottom: var(--space-4);
        align-items: stretch;
    }
    .act-col {
        display: flex;
        flex-direction: column;
        height: 100%;
    }
    .act-col > .act-section-title {
        margin-top: 0;
    }
    .act-col > div, .act-col > ul {
        margin-bottom: 0;
        flex: 1;
    }

    /* ─── Activity Tab: Section Title ─── */
    .act-section-title {
        font-size: 0.95em;
        font-weight: 600;
        margin: var(--space-4) 0 var(--space-2) 0;
        color: var(--color-text);
        display: flex;
        align-items: center;
        gap: var(--space-2);
    }
    .act-section-title .act-badge {
        font-weight: 400;
    }

    /* ─── Activity Tab: Model Cards ─── */
    .act-cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--space-3);
        margin-bottom: var(--space-4);
    }
    .act-model-card {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        overflow: hidden;
        transition: border-color 0.2s cubic-bezier(.4,0,.2,1), transform 0.15s cubic-bezier(.4,0,.2,1);
    }
    @media (hover: hover) {
        .act-model-card:hover {
            border-color: var(--color-accent);
            transform: translateY(-1px);
        }
    }
    .act-card-header {
        padding: var(--space-2) var(--space-3);
        font-weight: 600;
        font-size: 0.9em;
        background: rgba(255,255,255,0.03);
        border-bottom: 1px solid var(--color-border);
        word-break: break-word;
        overflow-wrap: anywhere;
        border-left: 3px solid var(--color-accent);
    }
    /* Model card color accents */
    .act-model-card:nth-child(1) .act-card-header { border-left-color: #60a5fa; }
    .act-model-card:nth-child(2) .act-card-header { border-left-color: #4ade80; }
    .act-model-card:nth-child(3) .act-card-header { border-left-color: #facc15; }
    .act-model-card:nth-child(4) .act-card-header { border-left-color: #f87171; }
    .act-model-card:nth-child(5) .act-card-header { border-left-color: #2dd4bf; }
    .act-model-card:nth-child(6) .act-card-header { border-left-color: #fb923c; }
    .act-card-body { padding: var(--space-2) var(--space-3); }
    .act-card-row {
        display: flex;
        justify-content: space-between;
        padding: 2px 0;
        font-size: 0.85em;
    }
    .act-card-row .val { font-weight: 600; }
    .act-card-divider { border-top: 1px solid var(--color-border); margin: var(--space-1) 0; }
    .act-card-footer {
        padding: var(--space-1) var(--space-3) var(--space-2);
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
    }
    .act-tool-tag {
        display: inline-block;
        padding: 1px var(--space-1);
        font-size: 0.75em;
        background: rgba(255,255,255,0.06);
        color: var(--color-text-dim);
        border-radius: var(--radius-sm);
    }

    /* ─── Activity Tab: Timeline ─── */
    .act-timeline {
        max-height: 480px;
        overflow-y: auto;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-2);
        margin-bottom: var(--space-4);
    }
    .act-tl-item {
        display: flex;
        align-items: center;
        gap: 3px;
        padding: 2px var(--space-2);
        min-height: 24px;
        font-size: 0.82em;
        border-bottom: 1px solid rgba(255,255,255,0.03);
        transition: background-color 0.15s cubic-bezier(.4,0,.2,1);
    }
    @media (hover: hover) {
        .act-tl-item:hover { background: rgba(255,255,255,0.04); }
    }
    .act-tl-item:last-child { border-bottom: none; }
    .act-tl-time { color: var(--color-text-dim); flex-shrink: 0; width: 42px; font-size: 0.78em; font-variant-numeric: tabular-nums; }
    .act-tl-icon { flex-shrink: 0; width: 18px; text-align: center; }
    .act-tl-content { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-1); overflow: hidden; }
    .act-tl-model { color: var(--color-info); font-weight: 500; flex-shrink: 0; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .act-tl-detail { color: var(--color-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .act-tl-user { color: var(--color-ok); font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: default; }
    .act-tl-ai-preview { color: #fb923c; opacity: 0.8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; cursor: default; }
    .act-tl-expandable { cursor: pointer; text-decoration-style: dotted; text-decoration-line: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
    .act-tl-user.act-tl-expandable, .act-tl-ai-preview.act-tl-expandable { cursor: pointer; }
    @media (hover: hover) { .act-tl-expandable:hover { opacity: 1; filter: brightness(1.3); } }
    .act-tl-expand { display: none; padding: var(--space-2) var(--space-3); margin: var(--space-1) 0 var(--space-1) 62px; background: rgba(255,255,255,0.03); border-radius: var(--radius-sm); border-left: 2px solid var(--color-border); font-size: 0.85em; line-height: 1.6; white-space: pre-wrap; word-break: break-word; color: var(--color-text); max-height: 300px; overflow-y: auto; }
    .act-tl-expand.act-tl-expand-open { display: block; }
    .act-tl-expand::-webkit-scrollbar { width: 4px; }
    .act-tl-expand::-webkit-scrollbar-track { background: transparent; }
    .act-tl-expand::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: var(--radius-full); }
    .act-tl-meta { margin-left: auto; display: flex; align-items: center; gap: 3px; flex-shrink: 0; white-space: nowrap; }
    .act-tl-dur { color: var(--color-text-dim); flex-shrink: 0; padding: 0 3px; border-radius: var(--radius-sm); background: var(--color-surface, rgba(128,128,128,0.1)); border: 1px solid var(--color-border, rgba(128,128,128,0.15)); font-size: 0.78em; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .act-tl-reasoning .act-tl-icon { color: var(--color-ok); }
    .act-tl-tool .act-tl-icon { color: var(--color-warn); }
    .act-tl-tool-name {
        color: var(--color-text-dim);
        font-weight: 500;
        flex-shrink: 0;
        background: var(--color-surface, rgba(128,128,128,0.1));
        padding: 0 var(--space-1);
        border-radius: var(--radius-sm);
        font-size: 0.9em;
        margin-right: var(--space-1);
    }
    .act-tl-step-idx {
        color: var(--color-text-dim);
        opacity: 0.85;
        font-size: 0.75em;
        flex-shrink: 0;
        min-width: 30px;
        text-align: center;
        padding: 1px 3px;
        background: var(--color-surface, rgba(128,128,128,0.1));
        border-radius: var(--radius-sm);
        font-variant-numeric: tabular-nums;
        font-weight: 500;
    }
    .act-tl-gm {
        display: inline-flex;
        gap: 2px;
        margin-left: auto;
        flex-shrink: 0;
        font-size: 0.78em;
        font-variant-numeric: tabular-nums;
    }
    .act-tl-gm-tag {
        padding: 0 3px;
        border-radius: var(--radius-sm);
        white-space: nowrap;
    }
    .act-tl-gm-in  { background: rgba(37,99,235,0.12); color: #2563eb; }
    .act-tl-gm-out { background: rgba(22,163,74,0.12);  color: #16a34a; }
    .act-tl-gm-ttft { background: rgba(202,138,4,0.12);  color: #ca8a04; }
    .act-tl-gm-cache { background: rgba(13,148,136,0.12); color: #0d9488; }
    .act-tl-gm-credit { background: rgba(220,38,38,0.14); color: #dc2626; }
    .act-tl-gm-retry { background: rgba(220,38,38,0.12);  color: #dc2626; }
    body.vscode-dark .act-tl-gm-in  { background: rgba(96,165,250,0.12);  color: #93c5fd; }
    body.vscode-dark .act-tl-gm-out { background: rgba(74,222,128,0.12);  color: #86efac; }
    body.vscode-dark .act-tl-gm-ttft { background: rgba(251,191,36,0.12); color: #fcd34d; }
    body.vscode-dark .act-tl-gm-cache { background: rgba(45,212,191,0.12); color: #5eead4; }
    body.vscode-dark .act-tl-gm-credit { background: rgba(248,113,113,0.16); color: #fca5a5; }
    body.vscode-dark .act-tl-gm-retry { background: rgba(248,113,113,0.15); color: #fca5a5; }
    .act-tl-segment {
        border: 1px solid var(--color-border, rgba(128,128,128,0.12));
        border-radius: var(--radius-md);
        background: var(--color-surface, rgba(128,128,128,0.04));
        overflow: hidden;
        margin-bottom: var(--space-2);
    }
    .act-tl-segment:last-child {
        margin-bottom: 0;
    }
    .act-tl-segment-user {
        background: rgba(74, 222, 128, 0.04);
        padding-left: var(--space-2);
    }
    .act-tl-segment-user::before {
        content: '';
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: #4ade80;
        flex-shrink: 0;
        margin-right: var(--space-1);
    }
    .act-tl-segment-body {
        display: flex;
        flex-direction: column;
    }
    .act-tl-segment-body .act-tl-item {
        padding-left: var(--space-2);
    }
    .act-tl-segment-body .act-tl-item::before {
        content: '';
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: rgba(255,255,255,0.16);
        flex-shrink: 0;
        margin-right: var(--space-1);
    }
    .act-tl-segment-caption {
        padding: 4px var(--space-2);
        font-size: 0.76em;
        color: var(--color-text-dim);
        background: rgba(255,255,255,0.02);
        border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .act-tl-tags {
        display: inline-flex;
        flex-wrap: nowrap;
        gap: 3px;
        align-items: center;
    }
    .act-tl-tag {
        display: inline-flex;
        align-items: center;
        padding: 0 4px;
        border-radius: var(--radius-sm);
        font-size: 0.72em;
        line-height: 1.6;
        white-space: nowrap;
        border: 1px solid transparent;
    }
    /* .act-tl-tag-exact removed — "Exact" label deemed too absolute */
    .act-tl-tag-alias {
        background: rgba(251, 191, 36, 0.12);
        color: #fcd34d;
        border-color: rgba(251, 191, 36, 0.2);
    }
    .act-tl-tag-struct {
        background: rgba(96, 165, 250, 0.12);
        color: #93c5fd;
        border-color: rgba(96, 165, 250, 0.2);
    }
    .act-tl-tag-est {
        background: rgba(248, 113, 113, 0.14);
        color: #fca5a5;
        border-color: rgba(248, 113, 113, 0.2);
    }
    .act-tl-tag-basis {
        background: rgba(45,212,191,0.12);
        color: #5eead4;
        border-color: rgba(45,212,191,0.2);
    }
    .act-tl-tag-model {
        background: var(--color-surface, rgba(128,128,128,0.08));
        color: var(--color-text-dim);
        border-color: var(--color-border, rgba(128,128,128,0.12));
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .act-tl-tag-marker {
        background: var(--color-surface, rgba(128,128,128,0.08));
        color: var(--color-text-dim);
        border-color: var(--color-border, rgba(128,128,128,0.12));
    }
    .act-badge { font-size: 0.75em; opacity: 0.7; }
    .act-checkpoint-model { border-color: var(--color-border, rgba(128,128,128,0.1)); opacity: 0.85; }

    /* ─── Activity Tab: Timeline Legend ─── */
    .act-tl-legend {
        margin-top: var(--space-2);
        margin-bottom: var(--space-2);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: var(--radius-md);
        background: rgba(255,255,255,0.015);
        font-size: 0.82em;
    }
    .act-tl-legend summary {
        padding: var(--space-2);
        cursor: pointer;
        color: var(--color-text-dim);
        user-select: none;
        list-style: none;
        display: flex;
        align-items: center;
        gap: var(--space-1);
        font-weight: 500;
    }
    .act-tl-legend summary::-webkit-details-marker { display: none; }
    .act-tl-legend summary::before {
        content: '';
        width: 0; height: 0;
        border-left: 5px solid currentColor;
        border-top: 4px solid transparent;
        border-bottom: 4px solid transparent;
        transition: transform 0.2s cubic-bezier(.4,0,.2,1);
        flex-shrink: 0;
    }
    .act-tl-legend[open] summary::before {
        transform: rotate(90deg);
    }
    .act-tl-legend-body {
        padding: 0 var(--space-2) var(--space-2);
        line-height: 1.5;
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }
    .act-tl-legend-group {
        border: 1px solid rgba(255,255,255,0.05);
        border-radius: var(--radius-md);
        background: rgba(255,255,255,0.015);
        overflow: hidden;
    }
    .act-tl-legend-group-title {
        font-size: 0.76em;
        font-weight: 600;
        color: var(--color-text-dim);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: var(--space-1) var(--space-2);
        margin: 0;
        background: rgba(255,255,255,0.03);
        border-bottom: 1px solid rgba(255,255,255,0.05);
        display: flex;
        align-items: center;
        gap: var(--space-1);
    }
    .act-tl-legend-group-title svg {
        width: 12px;
        height: 12px;
        flex-shrink: 0;
        opacity: 0.6;
    }
    .act-tl-legend-rows {
        display: flex;
        flex-direction: column;
    }
    .act-tl-legend-row {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2);
        padding: var(--space-1) var(--space-2);
        border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .act-tl-legend-row:last-child {
        border-bottom: none;
    }
    @media (hover: hover) {
        .act-tl-legend-row:hover {
            background: rgba(255,255,255,0.02);
        }
    }
    .act-tl-legend-sample {
        flex-shrink: 0;
        min-width: 90px;
        display: flex;
        align-items: center;
        padding-top: 1px;
    }
    .act-tl-legend-desc {
        flex: 1;
        color: var(--color-text-dim);
        min-width: 0;
    }
    .act-tl-legend-desc b {
        color: var(--color-text);
    }
    .act-tl-legend-note {
        display: flex;
        gap: var(--space-2);
        padding: var(--space-2);
        border-radius: var(--radius-md);
        font-size: 0.9em;
        line-height: 1.6;
        align-items: flex-start;
    }
    .act-tl-legend-note-icon {
        flex-shrink: 0;
        width: 16px;
        height: 16px;
        margin-top: 2px;
    }
    .act-tl-legend-note-info {
        background: rgba(96, 165, 250, 0.07);
        border: 1px solid rgba(96, 165, 250, 0.15);
        border-left: 3px solid rgba(96, 165, 250, 0.5);
    }
    .act-tl-legend-note-info .act-tl-legend-note-icon { color: #93c5fd; }
    .act-tl-legend-note b {
        color: var(--color-text);
    }
    .act-tl-legend-formula {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        margin: var(--space-1) var(--space-2);
        border-radius: var(--radius-sm);
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.04);
        font-family: var(--font-mono, 'SF Mono', 'Cascadia Code', 'Consolas', monospace);
        font-size: 0.88em;
        color: var(--color-text-dim);
    }
    /* keep act-dist-note for other usages */
    .act-dist-note {
        font-size: 0.8em;
        color: var(--color-warn);
        opacity: 0.7;
        margin-top: var(--space-2);
        padding: var(--space-1) var(--space-2);
        border-left: 2px solid var(--color-warn);
        line-height: 1.4;
    }

    /* ─── Activity Tab: Distribution ─── */
    .act-dist-container {
        display: flex;
        align-items: center;
        gap: var(--space-6);
        padding: var(--space-3);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        margin-bottom: var(--space-4);
    }
    .act-donut-chart { flex-shrink: 0; }
    .act-dist-legend { flex: 1; }
    .act-legend-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 2px 0;
        font-size: 0.85em;
    }
    .act-legend-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex-shrink: 0;
    }
    .act-legend-pct { color: var(--color-text-dim); margin-left: auto; }

    /* ─── Activity Tab: Context Trend Chart ─── */
    .act-trend-container {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-3);
        margin-bottom: var(--space-4);
        height: 240px;
        display: flex;
        flex-direction: column;
    }
    .act-trend-svg { width: 100%; flex: 1; display: block; }
    .act-trend-labels {
        display: flex;
        justify-content: space-between;
        font-size: 0.75em;
        color: var(--color-text-dim);
        margin-top: var(--space-2);
    }
    .act-compress-note { color: #f87171; margin-left: var(--space-2); font-size: 0.85em; }

    /* ─── Activity Tab: Tool Ranking ─── */
    .act-rank-list { padding: 0; margin: 0 0 var(--space-4) 0; list-style: none; }
    .act-rank-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 3px 0;
        font-size: 0.85em;
    }
    .act-rank-name {
        flex-shrink: 0;
        min-width: 100px;
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--color-text);
    }
    .act-rank-bar-bg {
        flex: 1;
        height: 14px;
        background: rgba(255,255,255,0.06);
        border-radius: var(--radius-sm);
        overflow: hidden;
    }
    .act-rank-bar {
        display: block;
        height: 100%;
        border-radius: var(--radius-sm);
        transition: width 0.3s cubic-bezier(.4,0,.2,1);
    }
    .act-rank-count { flex-shrink: 0; min-width: 36px; text-align: right; font-weight: 600; font-size: 0.85em; }

    /* Tool ranking color classes */
    .act-rank-c0 .act-rank-bar { background: #60a5fa; } .act-rank-c0 .act-rank-count { color: #60a5fa; }
    .act-rank-c1 .act-rank-bar { background: #34d399; } .act-rank-c1 .act-rank-count { color: #34d399; }
    .act-rank-c2 .act-rank-bar { background: #fbbf24; } .act-rank-c2 .act-rank-count { color: #fbbf24; }
    .act-rank-c3 .act-rank-bar { background: #f87171; } .act-rank-c3 .act-rank-count { color: #f87171; }
    .act-rank-c4 .act-rank-bar { background: #2dd4bf; } .act-rank-c4 .act-rank-count { color: #2dd4bf; }
    .act-rank-c5 .act-rank-bar { background: #fb923c; } .act-rank-c5 .act-rank-count { color: #fb923c; }
    .act-rank-c6 .act-rank-bar { background: #2dd4bf; } .act-rank-c6 .act-rank-count { color: #2dd4bf; }
    .act-rank-c7 .act-rank-bar { background: #e879f9; } .act-rank-c7 .act-rank-count { color: #e879f9; }
    .act-rank-c8 .act-rank-bar { background: #38bdf8; } .act-rank-c8 .act-rank-count { color: #38bdf8; }
    .act-rank-c9 .act-rank-bar { background: #4ade80; } .act-rank-c9 .act-rank-count { color: #4ade80; }

    /* ─── Activity Tab: Conversation Breakdown ─── */
    .act-conv-list {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-2);
        margin-bottom: var(--space-4);
        height: 240px;
        overflow-y: auto;
    }
    .act-conv-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 3px var(--space-1);
        font-size: 0.82em;
        border-bottom: 1px solid rgba(255,255,255,0.03);
    }
    .act-conv-item:last-child { border-bottom: none; }
    .act-conv-id {
        font-family: monospace;
        font-size: 0.85em;
        color: var(--color-text-dim);
        flex-shrink: 0;
    }
    .act-conv-gm {
        color: #fcd34d;
        font-weight: 600;
    }
    .act-conv-stats { margin-left: auto; display: flex; gap: var(--space-3); white-space: nowrap; }
    .act-conv-stats span { font-weight: 500; }

    /* ─── GM Precision Sections ─── */
    .gm-perf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-2); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-4); }
    .gm-perf-item { display: flex; flex-direction: column; gap: 2px; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.04); }
    .gm-perf-label { font-size: 0.72em; color: var(--color-text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
    .gm-perf-val { font-weight: 700; font-size: 1.05em; }
    .gm-perf-sub { font-size: 0.75em; color: var(--color-text-dim); }
    .gm-cache-bar-bg { height: 20px; background: rgba(255,255,255,0.06); border-radius: var(--radius-sm); overflow: hidden; margin-bottom: var(--space-1); }
    .gm-cache-bar { height: 100%; border-radius: var(--radius-sm); background: linear-gradient(90deg, #3b82f6, #60a5fa); transition: width 0.3s cubic-bezier(.4,0,.2,1); }
    .gm-badge-real { display: inline-block; font-size: 0.65em; padding: 1px var(--space-1); border-radius: var(--radius-sm); background: rgba(52,211,153,0.15); color: #34d399; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; vertical-align: middle; margin-left: var(--space-1); }
    .gm-provider-tag { display: inline-block; font-size: 0.72em; padding: 1px var(--space-1); border-radius: var(--radius-sm); background: rgba(96,165,250,0.1); color: var(--color-info); margin-top: var(--space-1); }

    /* ─── Retry Overhead ─── */
    .act-stat-warn { border-color: rgba(248,113,113,0.3); }
    @media (hover: hover) {
        .act-stat-warn:hover { border-color: rgba(248,113,113,0.6); box-shadow: 0 0 8px rgba(248,113,113,0.15); }
    }
    .gm-retry-card {
        background: var(--color-surface);
        border: 1px solid rgba(248,113,113,0.2);
        border-radius: var(--radius-md);
        padding: var(--space-3);
        margin-bottom: var(--space-4);
    }
    .gm-retry-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: var(--space-2);
        text-align: center;
    }
    .gm-retry-metric {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--space-2);
        border-radius: var(--radius-sm);
        background: rgba(248,113,113,0.06);
        border: 1px solid rgba(248,113,113,0.1);
    }
    .gm-retry-val { font-weight: 700; font-size: 1.1em; color: #f87171; }
    .gm-retry-label { font-size: 0.72em; color: var(--color-text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
    .gm-retry-stops {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
        margin-top: var(--space-3);
        padding-top: var(--space-2);
        border-top: 1px solid rgba(255,255,255,0.06);
    }
    .gm-stop-tag {
        display: inline-block;
        font-size: 0.72em;
        padding: 2px var(--space-2);
        border-radius: var(--radius-sm);
        background: rgba(52,211,153,0.1);
        color: #34d399;
        font-weight: 500;
    }
    .gm-stop-err {
        background: rgba(248,113,113,0.1);
        color: #f87171;
    }

    /* ─── Context X-ray Details ─── */
    .act-xray-details {
        margin-top: var(--space-3);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: var(--radius-md);
        background: rgba(255,255,255,0.015);
        font-size: 0.85em;
    }
    .act-xray-details summary {
        padding: var(--space-2) var(--space-3);
        cursor: pointer;
        color: var(--color-text-dim);
        user-select: none;
        list-style: none;
        display: flex;
        align-items: center;
        gap: var(--space-1);
        font-size: 0.88em;
        font-weight: 500;
        transition: color 0.15s cubic-bezier(.4,0,.2,1);
    }
    .act-xray-details summary::before {
        content: '▸';
        display: inline-block;
        transition: transform 0.15s cubic-bezier(.4,0,.2,1);
        font-size: 0.8em;
    }
    .act-xray-details[open] summary::before { transform: rotate(90deg); }
    @media (hover: hover) {
        .act-xray-details summary:hover { color: var(--color-text); }
    }
    .xray-body {
        padding: var(--space-2) var(--space-3) var(--space-3);
        display: grid;
        gap: var(--space-2);
        max-height: 280px;
        overflow-y: auto;
    }
    .xray-body::-webkit-scrollbar { width: 4px; }
    .xray-body::-webkit-scrollbar-track { background: transparent; }
    .xray-body::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: var(--radius-full); }
    .xray-item { font-size: 0.88em; }
    .xray-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 3px;
        color: var(--color-text-dim);
        font-size: 0.92em;
    }
    .xray-header span:first-child {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        font-weight: 500;
    }
    .xray-bar-wrap {
        height: 5px;
        background: rgba(255,255,255,0.06);
        border-radius: var(--radius-sm);
        overflow: hidden;
    }
    .xray-bar {
        height: 100%;
        border-radius: var(--radius-sm);
        transition: width 0.3s cubic-bezier(.4,0,.2,1);
    }
    .xray-chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
        margin-top: var(--space-1);
        padding-left: var(--space-3);
    }
    .xray-chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px var(--space-2);
        border-radius: var(--radius-sm);
        font-size: 0.78em;
        background: rgba(255,255,255,0.04);
        border: 1px solid var(--chip-color, var(--color-border));
        border-left: 2px solid var(--chip-color, var(--color-info));
        color: var(--color-text-dim);
        transition: background 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
    }
    @media (hover: hover) {
        .xray-chip:hover {
            background: rgba(255,255,255,0.08);
            border-color: var(--chip-color, var(--color-info));
        }
    }
    .xray-chip-val {
        font-weight: 600;
        color: var(--color-text);
        font-size: 0.95em;
    }
    .xray-total {
        font-size: 0.78em;
        color: var(--color-text-dim);
        text-align: right;
        font-weight: 600;
        padding-top: var(--space-1);
        border-top: 1px solid rgba(255,255,255,0.06);
    }
    @media (prefers-reduced-motion: reduce) {
        .xray-bar { transition: none; }
    }

    /* ─── Light Theme: Activity Panel ──── */
    body.vscode-light .act-card-header { background: rgba(0,0,0,0.03); }
    body.vscode-light .act-tool-tag { background: rgba(0,0,0,0.05); }
    body.vscode-light .act-tl-expand { background: rgba(0,0,0,0.03); }
    body.vscode-light .act-tl-segment-body .act-tl-item::before { background: rgba(0,0,0,0.16); }
    body.vscode-light .act-tl-legend-row { border-bottom-color: rgba(0,0,0,0.04); }
    body.vscode-light .act-tl-item { border-bottom-color: rgba(0,0,0,0.04); }
    @media (hover: hover) {
        body.vscode-light .act-tl-item:hover { background: rgba(0,0,0,0.03); }
    }
    body.vscode-light .act-tl-legend { border-color: rgba(0,0,0,0.08); background: rgba(0,0,0,0.015); }
    body.vscode-light .act-tl-legend-group { border-color: rgba(0,0,0,0.06); background: rgba(0,0,0,0.015); }
    body.vscode-light .act-tl-legend-group-title { background: rgba(0,0,0,0.03); border-bottom-color: rgba(0,0,0,0.06); }
    body.vscode-light .act-tl-legend-formula { background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.06); }
    body.vscode-light .act-tl-segment-caption { background: rgba(0,0,0,0.02); border-bottom-color: rgba(0,0,0,0.04); }
    body.vscode-light .act-conv-item { border-bottom-color: rgba(0,0,0,0.04); }
    body.vscode-light .gm-perf-item { background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.06); }
    body.vscode-light .gm-cache-bar-bg { background: rgba(0,0,0,0.06); }
    body.vscode-light .gm-retry-stops { border-top-color: rgba(0,0,0,0.06); }
    body.vscode-light .act-rank-bar-bg { background: rgba(0,0,0,0.06); }
    body.vscode-light .act-xray-details { border-color: rgba(0,0,0,0.08); background: rgba(0,0,0,0.015); }
    body.vscode-light .xray-bar-wrap { background: rgba(0,0,0,0.06); }
    body.vscode-light .xray-chip { background: rgba(0,0,0,0.03); }
    @media (hover: hover) {
        body.vscode-light .act-tl-legend-row:hover { background: rgba(0,0,0,0.02); }
        body.vscode-light .xray-chip:hover { background: rgba(0,0,0,0.06); }
    }
    body.vscode-light .xray-total { border-top-color: rgba(0,0,0,0.06); }

    `;
}

// ─── Section Builders ────────────────────────────────────────────────────────

function buildSummaryBar(s: ActivitySummary | null, gm: GMSummary | null): string {
    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    // When no activity data, show GM-only summary
    if (!s && gm) {
        const models = Object.keys(gm.modelBreakdown).length;
        return `<div class="act-summary-bar">
            <div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span><span class="act-stat-val">${gm.totalCalls}</span><span class="act-stat-label">${tBi('Calls', '调用')}</span></div>
            <div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg></span><span class="act-stat-val">${models}</span><span class="act-stat-label">${tBi('Models', '模型')}</span></div>
            <div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M5 10l7 7 7-7"/></svg></span><span class="act-stat-val">${fmt(gm.totalInputTokens)}</span><span class="act-stat-label">${tBi('In', '输入')}</span></div>
            <div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V9M5 14l7-7 7 7"/></svg></span><span class="act-stat-val">${fmt(gm.totalOutputTokens)}</span><span class="act-stat-label">${tBi('Out', '输出')}</span></div>
            <div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></span><span class="act-stat-val">${fmt(gm.totalCacheRead)}</span><span class="act-stat-label">${tBi('Cache', '缓存')}</span></div>
            ${gm.totalCredits > 0 ? `<div class="act-stat"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg></span><span class="act-stat-val">${gm.totalCredits}</span><span class="act-stat-label">Credits</span></div>` : ''}
            ${gm.totalRetryTokens > 0 ? `<div class="act-stat act-stat-warn" data-tooltip="${tBi('Tokens wasted on retries (input + output)', '重试浪费的 token（输入+输出）')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></span><span class="act-stat-val">${fmt(gm.totalRetryTokens)}</span><span class="act-stat-label">${tBi('Retry Waste', '重试浪费')}</span></div>` : ''}
        </div>`;
    }

    if (!s) { return ''; }

    // GM-specific stats to prepend (total calls, steps covered, models count)
    let gmStatCards = '';
    if (gm && gm.totalCalls > 0) {
        const models = Object.keys(gm.modelBreakdown).length;
        gmStatCards = `
        <div class="act-stat" data-tooltip="${tBi('Total LLM API calls (GM precise)', 'LLM API 调用总次数（GM）')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span><span class="act-stat-val">${gm.totalCalls} <span class="gm-badge-real">GM</span></span><span class="act-stat-label">${tBi('Calls', '调用')}</span></div>
        <div class="act-stat" data-tooltip="${tBi('Steps precisely attributed to models', '精确归属到模型的步骤数')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span><span class="act-stat-val">${gm.totalStepsCovered}</span><span class="act-stat-label">${tBi('Steps', '步骤')}</span></div>
        <div class="act-stat" data-tooltip="${tBi('Number of distinct models used', '使用的不同模型数')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg></span><span class="act-stat-val">${models}</span><span class="act-stat-label">${tBi('Models', '模型')}</span></div>
        `;
    }

    // Session duration
    let durText = '';
    try {
        const ms = Date.now() - new Date(s.sessionStartTime).getTime();
        if (ms > 0) {
            const mins = Math.floor(ms / 60000);
            const hrs = Math.floor(mins / 60);
            durText = hrs > 0 ? `${hrs}h${mins % 60}m` : `${mins}m`;
        }
    } catch { durText = '-'; }

    // GM vs CHECKPOINT token selection
    const hasGM = (s.gmTotalInputTokens || 0) > 0;
    const inTokens = hasGM ? s.gmTotalInputTokens! : s.totalInputTokens;
    const outTokens = hasGM ? s.gmTotalOutputTokens! : s.totalOutputTokens;
    const inTooltip = hasGM
        ? tBi('GM input tokens (all conversations)', 'GM 输入 token（全部对话）')
        : tBi('Cumulative input tokens consumed', '累计消耗的输入 token 数');
    const outTooltip = hasGM
        ? tBi('GM output tokens (all conversations)', 'GM 输出 token（全部对话）')
        : tBi('Cumulative output tokens generated', '累计生成的输出 token 数');
    const gmTag = hasGM ? ' <span class="act-badge" style="color:var(--color-ok)">GM</span>' : '';

    // Cache card (only when GM data available)
    const cacheTokens = s.gmTotalCacheRead || 0;
    const cacheCard = cacheTokens > 0 ? `<div class="act-stat" data-tooltip="${tBi('GM cache read tokens', 'GM 缓存读取 token')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></span><span class="act-stat-val">${fmt(cacheTokens)}${gmTag}</span><span class="act-stat-label">${tBi('Cache', '缓存')}</span></div>` : '';

    // Credits card (only when GM data available)
    const credits = s.gmTotalCredits || 0;
    const creditsCard = credits > 0 ? `<div class="act-stat" data-tooltip="${tBi('GM credits consumed', 'GM 消耗的 credits')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg></span><span class="act-stat-val">${credits.toFixed(1)}${gmTag}</span><span class="act-stat-label">Credits</span></div>` : '';

    return `
    <div class="act-summary-bar">
        ${gmStatCards}
        ${durText ? `<div class="act-stat" data-tooltip="${tBi('Total time since extension activation', '从插件激活起累计的会话时长')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></span><span class="act-stat-val">${durText}</span><span class="act-stat-label">${tBi('Session', '会话')}</span></div>` : ''}
        <div class="act-stat" data-tooltip="${tBi('Total user messages sent', '用户发送的消息总数')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><span class="act-stat-val">${s.totalUserInputs}</span><span class="act-stat-label">${tBi('Msgs', '消息')}</span></div>
        <div class="act-stat" data-tooltip="${tBi('AI reasoning/reply steps', 'AI 推理回复步数')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z"/><path d="M9 17h6M10 21h4"/></svg></span><span class="act-stat-val">${s.totalReasoning}</span><span class="act-stat-label">${tBi('Think', '推理')}</span></div>
        <div class="act-stat" data-tooltip="${tBi('Tool invocations (view_file, grep, etc.)', '工具调用次数（如 view_file、grep 等）')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span><span class="act-stat-val">${s.totalToolCalls}</span><span class="act-stat-label">${tBi('Tools', '工具')}</span></div>
        <div class="act-stat" data-tooltip="${tBi('Error responses from AI', 'AI 返回的错误数')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></span><span class="act-stat-val">${s.totalErrors}</span><span class="act-stat-label">${tBi('Err', '错误')}</span></div>
        ${s.totalCheckpoints > 0 ? `<div class="act-stat" data-tooltip="${tBi('Checkpoint snapshots saved by AI', 'AI 保存的检查点快照数')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2z"/><path d="M9 21V9h6v12"/></svg></span><span class="act-stat-val">${s.totalCheckpoints}</span><span class="act-stat-label">${tBi('CP', '检查点')}</span></div>` : ''}
        ${s.estSteps > 0 ? `<div class="act-stat" data-tooltip="${tBi('Estimated steps beyond API window', '超出 API 窗口范围的推算步数')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg></span><span class="act-stat-val"><span class="act-est">+${s.estSteps}</span></span><span class="act-stat-label">${tBi('Est.', '推算')}</span></div>` : ''}
        <div class="act-stat" data-tooltip="${inTooltip}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M5 10l7 7 7-7"/></svg></span><span class="act-stat-val">${fmt(inTokens)}${gmTag}</span><span class="act-stat-label">${tBi('In', '输入')}</span></div>
        <div class="act-stat" data-tooltip="${outTooltip}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V9M5 14l7-7 7 7"/></svg></span><span class="act-stat-val">${fmt(outTokens)}${gmTag}</span><span class="act-stat-label">${tBi('Out', '输出')}</span></div>
        ${s.totalToolReturnTokens > 0 ? `<div class="act-stat" data-tooltip="${tBi('Tokens returned by tool calls', '工具调用返回的 token 数')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 0 1 0 8h-1"/></svg></span><span class="act-stat-val">${fmt(s.totalToolReturnTokens)}</span><span class="act-stat-label">${tBi('Tool Output', '工具输出')}</span></div>` : ''}
        ${cacheCard}
        ${creditsCard}
        ${gm && gm.totalRetryTokens > 0 ? `<div class="act-stat act-stat-warn" data-tooltip="${tBi('Tokens wasted on retries (input + output)', '重试浪费的 token（输入+输出）')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></span><span class="act-stat-val">${fmt(gm.totalRetryTokens)}</span><span class="act-stat-label">${tBi('Retry', '重试')}</span></div>` : ''}
    </div>`;
}


function buildToolRanking(s: ActivitySummary): string {
    const entries = Object.entries(s.globalToolStats).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (entries.length === 0) { return ''; }

    const max = entries[0][1];
    let html = `<h2 class="act-section-title"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>${tBi('Tool Usage', '工具排行')}</h2><ul class="act-rank-list">`;
    for (let i = 0; i < entries.length; i++) {
        const [name, count] = entries[i];
        const pct = Math.round((count / max) * 100);
        const ci = i % 10;
        html += `<li class="act-rank-item act-rank-c${ci}">
            <span class="act-rank-name">${esc(name)}</span>
            <span class="act-rank-bar-bg"><span class="act-rank-bar" style="width:${pct}%"></span></span>
            <span class="act-rank-count">${count}</span>
        </li>`;
    }
    html += `</ul>`;
    return html;
}




function buildModelCards(s: ActivitySummary | null, gm: GMSummary | null): string {
    const actEntries = s ? Object.entries(s.modelStats).sort((a, b) => b[1].totalSteps - a[1].totalSteps) : [];
    // Collect model names that exist only in GM data (not in Activity)
    const actNames = new Set(actEntries.map(([n]) => n));
    const gmOnlyEntries: [string, GMModelStats][] = [];
    if (gm) {
        for (const [name, ms] of Object.entries(gm.modelBreakdown)) {
            if (!actNames.has(name) && ms.callCount > 0) {
                gmOnlyEntries.push([name, ms]);
            }
        }
        gmOnlyEntries.sort((a, b) => b[1].stepsCovered - a[1].stepsCovered);
    }
    const entries = actEntries;
    const ICONS = {
        think: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z"/><path d="M9 17h6M10 21h4"/></svg>`,
        tool: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        save: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
        error: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
        bar: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
        clock: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
        sum: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
        coin: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`
    };
    if (entries.length === 0 && gmOnlyEntries.length === 0) { return ''; }

    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const fmtMs = (ms: number) => ms <= 0 ? '-' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

    let html = `<h2 class="act-section-title"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>${tBi('Model Stats', '模型统计')}</h2>`;

    // Accuracy note: shown when estimated steps exist
    const totalEst = entries.reduce((a, [, ms]) => a + ms.estSteps, 0);
    if (totalEst > 0) {
        const estSvg = `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`;
        html += `<div class="act-dist-note">${tBi(
            `Reasoning, tool calls, and error counts are precisely recorded. ${totalEst} steps beyond API window are estimated — see ${estSvg} Est. above.`,
            `推理回复、工具调用、错误等数据为精准记录；其中 ${totalEst} 步超出 API 窗口范围，为估算值（详见上方 ${estSvg} 推算）。`
        )}</div>`;
    }

    html += `<div class="act-cards-grid">`;
    // Prefer full GMSummary.modelBreakdown (has responseModel/provider/streaming)
    // Fall back to ActivitySummary.gmModelBreakdown (simpler subset)
    const gmBreak: Record<string, GMModelStats> | null = gm?.modelBreakdown ?? s?.gmModelBreakdown ?? null;
    const fmtSec = (n: number) => n <= 0 ? '-' : n < 1 ? `${(n * 1000).toFixed(0)}ms` : `${n.toFixed(2)}s`;
    for (const [name, ms] of entries) {
        const isCheckpointOnly = ms.reasoning === 0 && ms.toolCalls === 0 && ms.checkpoints > 0 && ms.estSteps === 0;
        const avgThink = ms.reasoning > 0 ? fmtMs(Math.round(ms.thinkingTimeMs / ms.reasoning)) : '-';
        const toolList = Object.entries(ms.toolBreakdown)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([t, n]) => `<span class="act-tool-tag">${t}×${n}</span>`)
            .join('');

        const actualSteps = ms.reasoning + ms.toolCalls + ms.errors + ms.checkpoints;
        const totalLabel = ms.estSteps > 0
            ? tBi(`${actualSteps}+${ms.estSteps} steps`, `${actualSteps}+${ms.estSteps} 步`)
            : tBi(`${actualSteps} steps`, `共 ${actualSteps} 步`);

        // GM per-model precision data (prefer full GMModelStats when available)
        let gmSection = '';
        let gmFooterTags = '';
        if (gmBreak) {
            const gmStats = gmBreak[name];
            if (gmStats && gmStats.callCount > 0) {
                const gmTag = ' <span class="gm-badge-real">GM</span>';
                gmSection = `
                <div class="act-card-divider"></div>
                <div class="act-card-row"><span>${ICONS.tool} <span>${tBi('Calls', '调用')}</span></span><span class="val">${gmStats.callCount}${gmTag}</span></div>
                <div class="act-card-row"><span>${ICONS.clock} <span>${tBi('Avg TTFT', '平均 TTFT')}</span></span><span class="val">${fmtSec(gmStats.avgTTFT)}${gmTag}</span></div>
                ${'avgStreaming' in gmStats && gmStats.avgStreaming > 0 ? `<div class="act-card-row"><span>${ICONS.sum} <span>${tBi('Avg Stream', '平均流速')}</span></span><span class="val">${fmtSec(gmStats.avgStreaming)}${gmTag}</span></div>` : ''}
                <div class="act-card-row"><span>${ICONS.coin} <span>${tBi('In', '输入')}</span></span><span class="val">${fmt(gmStats.totalInputTokens)}${gmTag}</span></div>
                <div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Out', '输出')}</span></span><span class="val">${fmt(gmStats.totalOutputTokens)}${gmTag}</span></div>
                ${'totalThinkingTokens' in gmStats && gmStats.totalThinkingTokens > 0 ? `<div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Think', '思考')}</span></span><span class="val">${fmt(gmStats.totalThinkingTokens)}${gmTag}</span></div>` : ''}
                ${gmStats.totalCacheRead > 0 ? `<div class="act-card-row"><span>${ICONS.save} <span>${tBi('Cache', '缓存')}</span></span><span class="val">${fmt(gmStats.totalCacheRead)}${gmTag}</span></div>` : ''}
                ${gmStats.totalCredits > 0 ? `<div class="act-card-row"><span>${ICONS.coin} <span>Credits</span></span><span class="val">${gmStats.totalCredits.toFixed(1)}${gmTag}</span></div>` : ''}
                ${gmStats.cacheHitRate > 0 ? `<div class="act-card-row"><span>${ICONS.bar} <span>${tBi('Cache Hit', '缓存命中')}</span></span><span class="val">${(gmStats.cacheHitRate * 100).toFixed(0)}%${gmTag}</span></div>` : ''}
                ${'exactCallCount' in gmStats && gmStats.exactCallCount > 0 ? `<div class="act-card-row"><span>${ICONS.tool} <span>${tBi('Exact Calls', '精确调用')}</span></span><span class="val">${gmStats.exactCallCount}${gmTag}</span></div>` : ''}
                ${'placeholderOnlyCalls' in gmStats && gmStats.placeholderOnlyCalls > 0 ? `<div class="act-card-row"><span>${ICONS.error} <span>${tBi('Alias Only', '仅别名')}</span></span><span class="val">${gmStats.placeholderOnlyCalls}${gmTag}</span></div>` : ''}
                `;
                // Footer tags from full GMModelStats (responseModel, apiProvider)
                if ('responseModel' in gmStats && gmStats.responseModel) {
                    gmFooterTags += `<span class="act-tool-tag">${esc(gmStats.responseModel)}</span>`;
                }
                if ('placeholderOnlyCalls' in gmStats && gmStats.placeholderOnlyCalls > 0) {
                    gmFooterTags += `<span class="gm-provider-tag">${tBi(`Alias ${gmStats.placeholderOnlyCalls}`, `别名 ${gmStats.placeholderOnlyCalls}`)}</span>`;
                }
                if ('apiProvider' in gmStats && gmStats.apiProvider) {
                    const providerShort = gmStats.apiProvider.replace('API_PROVIDER_', '').replace(/_/g, ' ');
                    gmFooterTags += `<span class="gm-provider-tag">${esc(providerShort)}</span>`;
                }
            }
        }

        html += `
        <div class="act-model-card${isCheckpointOnly ? ' act-checkpoint-model' : ''}">
            <div class="act-card-header">${esc(name)}${isCheckpointOnly ? ` <span class="act-badge">${ICONS.save}</span>` : ''} <span class="act-badge act-badge-total">${totalLabel}</span></div>
            <div class="act-card-body">
                ${ms.reasoning > 0 ? `<div class="act-card-row"><span>${ICONS.think} <span>${tBi('Reasoning', '推理回复')}</span></span><span class="val">${ms.reasoning}</span></div>` : ''}
                ${ms.toolCalls > 0 ? `<div class="act-card-row"><span>${ICONS.tool} <span>${tBi('Tools', '工具')}</span></span><span class="val">${ms.toolCalls}</span></div>` : ''}
                ${ms.checkpoints > 0 ? `<div class="act-card-row"><span>${ICONS.save} <span>${tBi('Checkpoints', '检查点')}</span></span><span class="val">${ms.checkpoints}</span></div>` : ''}
                ${ms.errors > 0 ? `<div class="act-card-row"><span>${ICONS.error} <span>${tBi('Errors', '错误')}</span></span><span class="val">${ms.errors}</span></div>` : ''}
                ${ms.estSteps > 0 ? `<div class="act-card-row"><span>${ICONS.bar} <span>${tBi('Est. Steps', '推算步数')}</span></span><span class="val act-est">+${ms.estSteps}</span></div>` : ''}
                ${ms.reasoning > 0 ? `
                <div class="act-card-row"><span>${ICONS.clock} <span>${tBi('Avg Think', '平均思考')}</span></span><span class="val">${avgThink}</span></div>
                <div class="act-card-row"><span>${ICONS.sum} <span>${tBi('Think', '推理')}</span></span><span class="val">${fmtMs(ms.thinkingTimeMs)}</span></div>
                ` : ''}
                ${ms.toolCalls > 0 ? `<div class="act-card-row"><span>${ICONS.sum} <span>${tBi('Tool', '工具')}</span></span><span class="val">${fmtMs(ms.toolTimeMs)}</span></div>` : ''}
                ${gmSection}
            </div>
            ${(toolList || gmFooterTags) ? `<div class="act-card-footer">${gmFooterTags}${toolList}</div>` : ''}
        </div>`;
    }
    // GM-only models: models in GM data but not in Activity modelStats
    for (const [name, gms] of gmOnlyEntries) {
        const providerShort = gms.apiProvider ? gms.apiProvider.replace('API_PROVIDER_', '').replace(/_/g, ' ') : '';
        html += `
        <div class="act-model-card">
            <div class="act-card-header">${esc(name)} <span class="act-badge">${gms.callCount} ${tBi('calls', '调用')}</span> <span class="gm-badge-real">GM</span></div>
            <div class="act-card-body">
                <div class="act-card-row"><span>${ICONS.bar} <span>${tBi('Steps', '步骤')}</span></span><span class="val">${gms.stepsCovered}</span></div>
                <div class="act-card-row"><span>${ICONS.clock} <span>${tBi('Avg TTFT', '平均 TTFT')}</span></span><span class="val">${fmtSec(gms.avgTTFT)}</span></div>
                ${'avgStreaming' in gms && gms.avgStreaming > 0 ? `<div class="act-card-row"><span>${ICONS.sum} <span>${tBi('Avg Stream', '平均流速')}</span></span><span class="val">${fmtSec(gms.avgStreaming)}</span></div>` : ''}
                <div class="act-card-divider"></div>
                <div class="act-card-row"><span>${ICONS.coin} <span>${tBi('In', '输入')}</span></span><span class="val">${fmt(gms.totalInputTokens)}</span></div>
                <div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Out', '输出')}</span></span><span class="val">${fmt(gms.totalOutputTokens)}</span></div>
                ${'totalThinkingTokens' in gms && gms.totalThinkingTokens > 0 ? `<div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Think', '思考')}</span></span><span class="val">${fmt(gms.totalThinkingTokens)}</span></div>` : ''}
                ${gms.totalCacheRead > 0 ? `<div class="act-card-row"><span>${ICONS.save} <span>${tBi('Cache', '缓存')}</span></span><span class="val">${fmt(gms.totalCacheRead)}</span></div>` : ''}
                ${gms.totalCredits > 0 ? `<div class="act-card-row"><span>${ICONS.coin} <span>Credits</span></span><span class="val">${gms.totalCredits.toFixed(1)}</span></div>` : ''}
                ${gms.cacheHitRate > 0 ? `<div class="act-card-row"><span>${ICONS.bar} <span>${tBi('Cache Hit', '缓存命中')}</span></span><span class="val">${(gms.cacheHitRate * 100).toFixed(0)}%</span></div>` : ''}
                ${'exactCallCount' in gms && gms.exactCallCount > 0 ? `<div class="act-card-row"><span>${ICONS.tool} <span>${tBi('Exact Calls', '精确调用')}</span></span><span class="val">${gms.exactCallCount}</span></div>` : ''}
                ${'placeholderOnlyCalls' in gms && gms.placeholderOnlyCalls > 0 ? `<div class="act-card-row"><span>${ICONS.error} <span>${tBi('Alias Only', '仅别名')}</span></span><span class="val">${gms.placeholderOnlyCalls}</span></div>` : ''}
            </div>
            <div class="act-card-footer">
                ${'responseModel' in gms && gms.responseModel ? `<span class="act-tool-tag">${esc(gms.responseModel)}</span>` : ''}
                ${providerShort ? `<span class="gm-provider-tag">${esc(providerShort)}</span>` : ''}
                ${'placeholderOnlyCalls' in gms && gms.placeholderOnlyCalls > 0 ? `<span class="gm-provider-tag">${tBi(`Alias ${gms.placeholderOnlyCalls}`, `别名 ${gms.placeholderOnlyCalls}`)}</span>` : ''}
                <span class="act-tool-tag">${tBi('Cache', '缓存')} ${(gms.cacheHitRate * 100).toFixed(0)}%</span>
            </div>
        </div>`;
    }
    html += `</div>`;

    return html;
}

function buildTimeline(s: ActivitySummary, currentUsage?: ContextUsage | null): string {
    const currentCascadeId = currentUsage?.cascadeId;
    const scopedEvents = currentCascadeId
        ? s.recentSteps.filter(event => event.cascadeId === currentCascadeId)
        : s.recentSteps;
    const orderedEvents = [...scopedEvents];
    if (orderedEvents.length === 0) {
        if (!currentCascadeId) { return ''; }
        return `<h2 class="act-section-title"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${tBi('Recent Activity', '最近操作')} <span class="act-badge">${tBi('Current Session', '当前对话')}</span></h2><p class="empty-msg">${tBi('No recent activity for the current conversation yet.', '当前对话暂时还没有可显示的最近操作。')}</p>`;
    }

    const fmtTok = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    const getTimelineIcon = (e: any) => {
        // SVG Mapping for categories/emojis
        if (e.icon === '❌') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
        if (e.icon === '💾') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
        if (e.icon === '📊') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`;
        if (e.category === 'reasoning') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z"/><path d="M9 17h6M10 21h4"/></svg>`;
        if (e.category === 'user') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
        if (e.category === 'tool') {
            if (e.icon === '🌐') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
            if (e.icon === '🔍' || e.icon === '🔎') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
            if (e.icon === '📂') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
            if (e.icon === '📄') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
            if (e.icon === '✏️') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
            return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
        }
        // fallback system icons
        return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    };

    const buildMetaTags = (e: any) => {
        const tags: string[] = [];
        if (e.source === 'gm_virtual') {
            tags.push(`<span class="act-tl-tag act-tl-tag-struct">${e.gmPromptSnippet && !/checkpoint/i.test(String(e.gmPromptSnippet)) ? 'GM-TEXT' : 'GM-STRUCT'}</span>`);
        } else if (e.source === 'gm_user') {
            tags.push(`<span class="act-tl-tag act-tl-tag-struct">GM-USER</span>`);
        } else if (e.source === 'estimated') {
            tags.push(`<span class="act-tl-tag act-tl-tag-est">${e.estimatedResolved ? tBi('Recovered', '已补回') : tBi('Est.', '推算')}</span>`);
        }

        if (e.modelBasis === 'gm_placeholder') {
            tags.push(`<span class="act-tl-tag act-tl-tag-alias">${tBi('Alias', '别名')}</span>`);
        } else if (e.modelBasis === 'summary') {
            tags.push(`<span class="act-tl-tag act-tl-tag-basis">${tBi('Summary', '摘要')}</span>`);
        } else if (e.modelBasis === 'generator') {
            tags.push(`<span class="act-tl-tag act-tl-tag-basis">${tBi('Generator', '生成器')}</span>`);
        } else if (e.modelBasis === 'dominant') {
            tags.push(`<span class="act-tl-tag act-tl-tag-basis">${tBi('Dominant', '主模型')}</span>`);
        }

        if (e.gmModel && e.gmModelAccuracy === 'exact') {
            tags.push(`<span class="act-tl-tag act-tl-tag-model">${esc(e.gmModel)}</span>`);
        }
        if (e.gmContextTokensUsed) {
            tags.push(`<span class="act-tl-tag act-tl-tag-marker">${tBi(`Ctx ${fmtTok(e.gmContextTokensUsed)}`, `上下文 ${fmtTok(e.gmContextTokensUsed)}`)}</span>`);
        }
        return tags.length > 0 ? `<span class="act-tl-tags">${tags.join('')}</span>` : '';
    };

    // GM coverage badge
    const gmRate = s.gmCoverageRate;
    const gmBadge = gmRate !== undefined && gmRate > 0
        ? ` <span class="act-badge" style="color:var(--color-ok)">${tBi('GM', 'GM')} ${(gmRate * 100).toFixed(0)}%</span>`
        : '';

    const scopeBadge = currentCascadeId
        ? ` <span class="act-badge">${tBi('Current Session', '当前对话')}</span>`
        : '';
    let html = `<h2 class="act-section-title"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${tBi('Recent Activity', '最近操作')}${scopeBadge}${gmBadge}</h2>
    <details class="act-tl-legend" id="d-tl-legend">
        <summary>${tBi('Timeline Legend', '时间线图例')}</summary>
        <div class="act-tl-legend-body">
            <div class="act-tl-legend-group">
                <div class="act-tl-legend-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${tBi('Step Basics', '步骤基础')}</div>
                <div class="act-tl-legend-rows">
                    <div class="act-tl-legend-row"><div class="act-tl-legend-sample"><span class="act-tl-time" style="display:inline">08:20</span></div><div class="act-tl-legend-desc">${tBi('Timestamp', '步骤时间')}</div></div>
                    <div class="act-tl-legend-row"><div class="act-tl-legend-sample"><span class="act-tl-step-idx" style="display:inline">#115</span></div><div class="act-tl-legend-desc">${tBi('Step index. Gaps are normal — skipped indices are system-internal.', '步骤索引。跳号正常 — 跳过的是系统内部步骤。')}</div></div>
                    <div class="act-tl-legend-row"><div class="act-tl-legend-sample"><span style="color:var(--color-info);font-weight:500">claude-opus-4.6</span></div><div class="act-tl-legend-desc">${tBi('Model name.', '模型名。')} <b>${tBi('Alias', '别名')}</b>${tBi(' = placeholder', ' = 占位 ID')} · <b>${tBi('Summary', '摘要')}</b>${tBi(' = inferred', ' = 推断')} · <b>${tBi('Dominant', '主模型')}</b>${tBi(' = most used', ' = 最常用')}</div></div>
                    <div class="act-tl-legend-row"><div class="act-tl-legend-sample"><span style="color:var(--color-text-dim)">538ms</span></div><div class="act-tl-legend-desc">${tBi('Step duration', '步骤耗时')}</div></div>
                </div>
            </div>
            <div class="act-tl-legend-group">
                <div class="act-tl-legend-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>${tBi('GM Data', 'GM 数据')}</div>
                <div class="act-tl-legend-rows">
                    <div class="act-tl-legend-row"><div class="act-tl-legend-sample"><span class="act-tl-tag act-tl-tag-marker" style="display:inline">${tBi('Ctx 142.7k', '上下文 142.7k')}</span></div><div class="act-tl-legend-desc">${tBi('Context window — total tokens the model could "see"', '上下文窗口 — 模型能「看到」的 token 总量')}</div></div>
                    <div class="act-tl-legend-row"><div class="act-tl-legend-sample"><span class="act-tl-gm-tag act-tl-gm-in" style="display:inline">1.3k ${tBi('in', '输入')}</span></div><div class="act-tl-legend-desc">${tBi('Input tokens billed (new, excl. cached)', '计费输入 token（新内容，不含缓存）')}</div></div>
                    <div class="act-tl-legend-row"><div class="act-tl-legend-sample"><span class="act-tl-gm-tag act-tl-gm-out" style="display:inline">117 ${tBi('out', '输出')}</span></div><div class="act-tl-legend-desc">${tBi('Output tokens generated', '模型输出 token')}</div></div>
                    <div class="act-tl-legend-row"><div class="act-tl-legend-sample"><span class="act-tl-gm-tag act-tl-gm-ttft" style="display:inline">2.1s</span></div><div class="act-tl-legend-desc">${tBi('TTFT — Time To First Token', 'TTFT — 首 Token 延迟')}</div></div>
                    <div class="act-tl-legend-row"><div class="act-tl-legend-sample"><span class="act-tl-gm-tag act-tl-gm-cache" style="display:inline">176.8k ${tBi('cache', '缓存')}</span></div><div class="act-tl-legend-desc">${tBi('Cache read tokens', '缓存读取 token')}</div></div>
                    <div class="act-tl-legend-row"><div class="act-tl-legend-sample"><span class="act-tl-gm-tag act-tl-gm-credit" style="display:inline">9 ${tBi('cr', '积分')}</span></div><div class="act-tl-legend-desc">${tBi('Credits consumed by this call', '这次调用消耗的积分')}</div></div>
                </div>
                <div class="act-tl-legend-formula">${tBi('Context', '上下文')} ≈ ${tBi('Input', '输入')} + ${tBi('Cache', '缓存')} + ${tBi('overhead', '系统开销')}</div>
            </div>
            <div class="act-tl-legend-note act-tl-legend-note-info">
                <svg class="act-tl-legend-note-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                <div>${tBi(
                    '<b>Why do some rows only show "Ctx"?</b><br/>Detailed metrics (in/out/TTFT/cache) appear only on <b>reasoning rows</b> (🧠). Tool rows (⚡) share the same LLM call — tokens are counted on the reasoning row to avoid double-counting.',
                    '<b>为什么有些行只显示「上下文」？</b><br/>详细指标（输入/输出/TTFT/缓存）仅出现在<b>推理行</b>（🧠）上。工具行（⚡）共享同一次 LLM 调用 — token 在推理行统计，避免重复计数。'
                )}</div>
            </div>
        </div>
    </details><div class="act-timeline">`;

    const renderEventRow = (e: any, extraClass = '') => {
        const time = formatTime(e.timestamp);
        const dur = e.durationMs > 0 ? `<span class="act-tl-dur">${e.durationMs < 1000 ? e.durationMs + 'ms' : (e.durationMs / 1000).toFixed(1) + 's'}</span>` : '';
        // Determine if this row has expandable full text that is LONGER than the preview
        const previewText = e.userInput || e.aiResponse || '';
        const fullText = e.fullUserInput || e.fullAiResponse || '';
        const hasExpand = fullText && fullText.length > previewText.length;
        const expandableClass = hasExpand ? ' act-tl-expandable' : '';
        let detail = '';
        if (e.userInput) { detail = `<span class="act-tl-user${expandableClass}">"${esc(e.userInput.replace(/\s*\n\s*/g, ' '))}"</span>`; }
        else if (e.toolName && e.detail) {
            detail = `<span class="act-tl-tool-name">${esc(e.toolName)}</span><span class="act-tl-detail">${esc(e.detail)}</span>`;
        }
        else if (e.toolName) {
            detail = `<span class="act-tl-tool-name">${esc(e.toolName)}</span>`;
        }
        else if (e.aiResponse) {
            detail = `<span class="act-tl-ai-preview${expandableClass}">${esc(e.aiResponse)}</span>`;
        }
        else if (e.detail) { detail = `<span class="act-tl-detail">${esc(e.detail)}</span>`; }

        const stepIdx = e.stepIndex !== undefined ? `<span class="act-tl-step-idx">#${e.stepIndex}</span>` : '';
        const svgIcon = getTimelineIcon(e);
        const metaTags = buildMetaTags(e);

        // GM precision data tags — only show on reasoning steps (tools share the same GM call)
        let gmTags = '';
        if (e.category === 'reasoning' && e.gmInputTokens !== undefined) {
            const parts: string[] = [];
            parts.push(`<span class="act-tl-gm-tag act-tl-gm-in">${fmtTok(e.gmInputTokens)} ${tBi('in', '输入')}</span>`);
            if (e.gmOutputTokens) { parts.push(`<span class="act-tl-gm-tag act-tl-gm-out">${fmtTok(e.gmOutputTokens)} ${tBi('out', '输出')}</span>`); }
            if (e.gmTTFT && e.gmTTFT > 0) { parts.push(`<span class="act-tl-gm-tag act-tl-gm-ttft">${e.gmTTFT.toFixed(1)}s</span>`); }
            if (e.gmCacheReadTokens && e.gmCacheReadTokens > 0) { parts.push(`<span class="act-tl-gm-tag act-tl-gm-cache">${fmtTok(e.gmCacheReadTokens)} ${tBi('cache', '缓存')}</span>`); }
            if (e.gmCredits && e.gmCredits > 0) { parts.push(`<span class="act-tl-gm-tag act-tl-gm-credit">${e.gmCredits} ${tBi('cr', '积分')}</span>`); }
            if (e.gmRetries && e.gmRetries > 1) { parts.push(`<span class="act-tl-gm-tag act-tl-gm-retry">r${e.gmRetries}</span>`); }
            gmTags = `<span class="act-tl-gm">${parts.join('')}</span>`;
        }

        // Expandable full text block
        const expandId = hasExpand ? `tl-exp-${e.stepIndex ?? Math.random().toString(36).slice(2, 8)}` : '';
        const expandBlock = hasExpand
            ? `<div id="${expandId}" class="act-tl-expand">${esc(fullText)}</div>`
            : '';
        const toggleAttr = hasExpand ? ` data-expand-target="${expandId}"` : '';

        return `
        <div class="act-tl-item act-tl-${e.category}${extraClass ? ` ${extraClass}` : ''}"${toggleAttr}>
            <span class="act-tl-time">${time}</span>
            ${stepIdx}
            <span class="act-tl-icon">${svgIcon}</span>
            <span class="act-tl-content">
                ${e.model ? `<span class="act-tl-model">${esc(e.model)}</span>` : ''}
                ${detail}
            </span>
            <span class="act-tl-meta">
                ${metaTags}
                ${gmTags}
                ${dur}
            </span>
        </div>${expandBlock}`;
    };

    const segments: Array<{ user?: any; actions: any[] }> = [];
    let currentSegment: { user?: any; actions: any[] } | null = null;
    for (const event of orderedEvents) {
        if (event.category === 'user') {
            currentSegment = { user: event, actions: [] };
            segments.push(currentSegment);
            continue;
        }
        if (!currentSegment) {
            currentSegment = { actions: [] };
            segments.push(currentSegment);
        }
        currentSegment.actions.push(event);
    }

    for (const segment of [...segments].reverse()) {
        html += `<div class="act-tl-segment">`;
        if (segment.actions.length > 0) {
            html += `<div class="act-tl-segment-body">`;
            for (const action of [...segment.actions].reverse()) {
                html += renderEventRow(action);
            }
            html += `</div>`;
        }
        if (segment.user) {
            html += renderEventRow(segment.user, 'act-tl-segment-user');
        } else {
            html += `<div class="act-tl-segment-caption">${tBi('AI actions (user anchor unavailable)', 'AI 动作（缺少用户锚点）')}</div>`;
        }
        html += `</div>`;
    }
    html += `</div>`;
    return html;
}

function buildDistribution(s: ActivitySummary): string {
    // Use actual reasoning + toolCalls + errors + estSteps for total AI usage
    const getUsage = (ms: ModelActivityStats) =>
        ms.reasoning + ms.toolCalls + ms.errors + ms.estSteps;
    const entries = Object.entries(s.modelStats).filter(([, ms]) => getUsage(ms) > 0);
    if (entries.length === 0) { return ''; }

    const total = entries.reduce((a, [, ms]) => a + getUsage(ms), 0);
    const colors = ['#60a5fa', '#4ade80', '#facc15', '#f87171', '#2dd4bf', '#fb923c'];

    let html = `<h2 class="act-section-title"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/><path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0"/></svg>${tBi('Model Distribution', '模型分布')}</h2><div class="act-dist-container">`;

    const size = 140;
    const r = 55;
    const cx = size / 2;
    const cy = size / 2;
    const circumference = 2 * Math.PI * r;
    let offset = 0;

    html += `<svg class="act-donut-chart" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`;
    for (let i = 0; i < entries.length; i++) {
        const [, ms] = entries[i];
        const pct = getUsage(ms) / total;
        const len = pct * circumference;
        html += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="16" stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
        offset += len;
    }
    html += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="var(--color-text)" font-size="18" font-weight="600">${total}</text>`;
    html += `</svg>`;

    html += `<div class="act-dist-legend">`;
    for (let i = 0; i < entries.length; i++) {
        const [name, ms] = entries[i];
        const usage = getUsage(ms);
        const pct = ((usage / total) * 100).toFixed(1);
        html += `<div class="act-legend-item"><span class="act-legend-dot" style="background:${colors[i % colors.length]}"></span>${esc(name)} <span class="act-legend-pct">${pct}% (${usage})</span></div>`;
    }
    html += `</div>`;

    html += `</div>`;
    return html;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
// esc() and formatTime() are now imported from webview-helpers.ts

// ─── GM Precision Section Builders (migrated from gm-panel.ts) ──────────────

function buildPerformanceChart(s: GMSummary): string {
    const entries = Object.entries(s.modelBreakdown).filter(([, ms]) => ms.avgTTFT > 0);
    if (entries.length === 0) { return ''; }
    const fmtSec = (n: number) => n <= 0 ? '-' : `${n.toFixed(2)}s`;
    let html = `<h2 class="act-section-title">${tBi('Performance Baseline', '性能基线')}</h2><div class="gm-perf-grid">`;
    for (const [name, ms] of entries) {
        html += `<div class="gm-perf-item"><span class="gm-perf-label">${esc(name)}</span><span class="gm-perf-val">${fmtSec(ms.avgTTFT)}</span><span class="gm-perf-sub">${tBi('TTFT avg', 'TTFT 均值')} (${fmtSec(ms.minTTFT)}–${fmtSec(ms.maxTTFT)})</span></div>`;
        html += `<div class="gm-perf-item"><span class="gm-perf-label">${esc(name)} ${tBi('Stream', '流速')}</span><span class="gm-perf-val">${fmtSec(ms.avgStreaming)}</span><span class="gm-perf-sub">${ms.callCount} ${tBi('samples', '样本')}</span></div>`;
    }
    html += `</div>`;
    return html;
}

function buildCacheEfficiency(s: GMSummary): string {
    const entries = Object.entries(s.modelBreakdown).filter(([, ms]) => ms.totalInputTokens > 0);
    if (entries.length === 0) { return ''; }
    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    let html = `<h2 class="act-section-title">${tBi('Cache Efficiency', '缓存效率')}</h2>`;
    for (const [name, ms] of entries) {
        const ratio = ms.totalInputTokens > 0 ? ms.totalCacheRead / ms.totalInputTokens : 0;
        const pct = Math.min(ratio * 10, 100);
        html += `<div style="margin-bottom:var(--space-3)"><div style="display:flex;justify-content:space-between;font-size:0.85em;margin-bottom:var(--space-1)"><span>${esc(name)}</span><span style="color:var(--color-info);font-weight:600">${ratio.toFixed(1)}× ${tBi('cache ratio', '缓存倍率')}</span></div><div class="gm-cache-bar-bg"><div class="gm-cache-bar" style="width:${pct.toFixed(1)}%"></div></div><div style="display:flex;justify-content:space-between;font-size:0.75em;color:var(--color-text-dim)"><span>${tBi('Input', '输入')}: ${fmt(ms.totalInputTokens)}</span><span>${tBi('Cache Read', '缓存读取')}: ${fmt(ms.totalCacheRead)}</span></div></div>`;
    }
    return html;
}

function buildContextGrowth(s: GMSummary): string {
    const data = s.contextGrowth;
    if (!data || data.length < 2) { return ''; }
    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const W = 380, H = 160, PAD = 6;
    const maxTok = Math.max(...data.map(d => d.tokens));
    if (maxTok <= 0) { return ''; }
    const xStep = (W - PAD * 2) / (data.length - 1);
    const yScale = (v: number) => H - PAD - ((v / maxTok) * (H - PAD * 2));
    const points = data.map((d, i) => `${PAD + i * xStep},${yScale(d.tokens)}`).join(' ');
    const areaPoints = `${PAD},${H - PAD} ${points} ${PAD + (data.length - 1) * xStep},${H - PAD}`;
    return `<h2 class="act-section-title">${tBi('Context Growth', '上下文增长')} <span class="gm-badge-real">${tBi('Per-Call', '每次调用')}</span></h2><div class="act-trend-container"><svg class="act-trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="gmTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f97316" stop-opacity="0.5"/><stop offset="100%" stop-color="#f97316" stop-opacity="0.1"/></linearGradient></defs><polygon points="${areaPoints}" fill="url(#gmTrendFill)"/><polyline points="${points}" fill="none" stroke="#fb923c" stroke-width="2" stroke-linejoin="round"/></svg><div class="act-trend-labels"><span>${fmt(data[0].tokens)}</span><span>${data.length} ${tBi('calls', '调用')}</span><span>${fmt(data[data.length - 1].tokens)}</span></div></div>`;
}

function buildConversations(s: GMSummary): string {
    const convs = s.conversations.filter(c => c.calls.length > 0);
    if (convs.length === 0) { return ''; }
    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    let html = `<h2 class="act-section-title">${tBi('Conversations', '对话分布')}</h2><div class="act-conv-list">`;
    for (const c of convs) {
        const covPct = (c.coverageRate * 100).toFixed(0);
        let totalIn = 0;
        let totalCredits = 0;
        for (const call of c.calls) {
            totalIn += call.inputTokens;
            totalCredits += call.credits;
        }
        const shortId = c.cascadeId.substring(0, 8);
        html += `<div class="act-conv-item"><span class="act-conv-id">${tBi('Session', '会话')} ${esc(shortId)}</span><span class="act-conv-stats"><span>${c.calls.length} ${tBi('calls', '调用')}</span><span>${covPct}% ${tBi('coverage', '覆盖')}</span><span>${fmt(totalIn)} ${tBi('in', '输入')}</span>${totalCredits > 0 ? `<span class="act-conv-gm">${totalCredits} ${tBi('cr', '积分')}</span>` : ''}</span></div>`;
    }
    html += `</div>`;
    return html;
}

// ─── Retry Overhead Section ─────────────────────────────────────────────────

function buildRetryOverhead(s: GMSummary): string {
    if (s.totalRetryTokens <= 0 && s.totalRetryCount <= 0) { return ''; }
    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    // Use successful-call tokens as denominator. Retry tokens are EXTRA overhead,
    // not part of the useful work — this prevents misleading 100%+ when retries dominate.
    const successfulTokens = s.totalInputTokens + s.totalOutputTokens;
    const pctRaw = successfulTokens > 0
        ? (s.totalRetryTokens / successfulTokens) * 100
        : 0;
    // Bounded display: '<0.1' for trace amounts, '>999' for extreme edge cases
    const pctDisplay = pctRaw <= 0 ? '0'
        : pctRaw < 0.1 ? '<0.1'
        : pctRaw > 999 ? '>999'
        : pctRaw.toFixed(1);

    // Stop reason distribution
    let stopHtml = '';
    const srEntries = Object.entries(s.stopReasonCounts);
    if (srEntries.length > 0) {
        stopHtml = `<div class="gm-retry-stops">`;
        for (const [reason, count] of srEntries.sort((a, b) => b[1] - a[1])) {
            const isErr = reason !== 'STOP_PATTERN' && reason !== 'END_TURN';
            stopHtml += `<span class="gm-stop-tag${isErr ? ' gm-stop-err' : ''}">${esc(reason)} ×${count}</span>`;
        }
        stopHtml += `</div>`;
    }

    return `<h2 class="act-section-title"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>${tBi('Retry Overhead', '重试开销')} <span class="gm-badge-real">${tBi('Probe', '探针')}</span></h2>
    <div class="gm-retry-card">
        <div class="gm-retry-grid">
            <div class="gm-retry-metric">
                <span class="gm-retry-val">${fmt(s.totalRetryTokens)}</span>
                <span class="gm-retry-label">${tBi('Tokens Wasted', 'Token 浪费')}</span>
            </div>
            <div class="gm-retry-metric">
                <span class="gm-retry-val">${s.totalRetryCredits > 0 ? s.totalRetryCredits.toFixed(1) : '0'}</span>
                <span class="gm-retry-label">${tBi('Credits Lost', 'Credits 损耗')}</span>
            </div>
            <div class="gm-retry-metric">
                <span class="gm-retry-val">${s.totalRetryCount}</span>
                <span class="gm-retry-label">${tBi('Retry Calls', '重试次数')}</span>
            </div>
            <div class="gm-retry-metric">
                <span class="gm-retry-val">${pctDisplay}%</span>
                <span class="gm-retry-label">${tBi('Overhead Rate', '额外开销率')}</span>
            </div>
        </div>
        ${stopHtml}
    </div>`;
}

// ─── Token Breakdown Chart ──────────────────────────────────────────────────

function buildTokenBreakdownChart(s: GMSummary): string {
    const groups = s.latestTokenBreakdown;
    if (!groups || groups.length === 0) { return ''; }

    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const total = groups.reduce((a, g) => a + g.tokens, 0);
    if (total <= 0) { return ''; }

    const colors = ['#06b6d4', '#f59e0b', '#10b981', '#f87171', '#ec4899', '#60a5fa', '#f97316', '#14b8a6'];
    const size = 140;
    const r = 55;
    const cx = size / 2;
    const cy = size / 2;
    const circumference = 2 * Math.PI * r;
    let offset = 0;

    let donut = `<svg class="act-donut-chart" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`;
    for (let i = 0; i < groups.length; i++) {
        const pct = groups[i].tokens / total;
        const len = pct * circumference;
        donut += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="16" stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
        offset += len;
    }
    donut += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" fill="var(--color-text)" font-size="16" font-weight="600">${fmt(total)}</text>`;
    donut += `</svg>`;

    let legend = `<div class="act-dist-legend">`;
    for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const pct = ((g.tokens / total) * 100).toFixed(1);
        const name = g.name || g.type.replace('TOKEN_TYPE_', '').replace(/_/g, ' ');
        legend += `<div class="act-legend-item"><span class="act-legend-dot" style="background:${colors[i % colors.length]}"></span>${esc(name)} <span class="act-legend-pct">${pct}% (${fmt(g.tokens)})</span></div>`;
    }
    legend += `</div>`;

    // X-ray detail bars (collapsible)
    let xrayHtml = '';
    if (groups.length > 0) {
        const bars = groups.map((g, i) => {
            const pct = Math.max(1, Math.round(g.tokens / total * 100));
            const col = colors[i % colors.length];
            const name = g.name || g.type.replace('TOKEN_TYPE_', '').replace(/_/g, ' ');
            let childrenHtml = '';
            if (g.children.length > 0) {
                const chips = g.children.map(ch => {
                    const chPct = g.tokens > 0 ? Math.round(ch.tokens / g.tokens * 100) : 0;
                    return `<span class="xray-chip" style="--chip-color:${col}">${esc(ch.name)} <span class="xray-chip-val">${fmt(ch.tokens)}${chPct > 0 ? ` (${chPct}%)` : ''}</span></span>`;
                }).join('');
                childrenHtml = `<div class="xray-chips">${chips}</div>`;
            }
            return `<div class="xray-item">
                <div class="xray-header">
                    <span><span class="act-legend-dot" style="background:${col}"></span>${esc(name)}</span>
                    <span>${fmt(g.tokens)} (${pct}%)</span>
                </div>
                <div class="xray-bar-wrap"><div class="xray-bar" style="width:${pct}%;background:${col}"></div></div>
                ${childrenHtml}
            </div>`;
        }).join('');

        xrayHtml = `
        <details class="act-xray-details" id="d-xray-detail">
            <summary>${tBi('Context X-ray — Detailed Breakdown', '上下文 X 光 — 详细分解')}</summary>
            <div class="xray-body">
                ${bars}
                <div class="xray-total">${tBi('Total', '合计')}: ${fmt(total)}</div>
            </div>
        </details>`;
    }

    return `<h2 class="act-section-title"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/><path d="M12 12V2"/><path d="M12 12h10"/></svg>${tBi('Context Composition', '上下文组成')} <span class="gm-badge-real">${tBi('Probe', '探针')}</span></h2>
    <div class="act-dist-container">
        ${donut}
        ${legend}
    </div>
    ${xrayHtml}`;
}

// ─── GM Data Tab Content Builder ─────────────────────────────────────────────
// Provides HTML + CSS for the unified "GM Data" tab within the main monitor panel.
// Merges Activity tracking data with GM precision data into a single view.
// This module is a content-only builder — the panel itself is managed by webview-panel.ts.

import { tBi } from './i18n';
import { ActivitySummary, ActivityArchive, ModelActivityStats, CheckpointSnapshot, ConversationBreakdown } from './activity-tracker';
import { esc, formatShortTime as formatTime } from './webview-helpers';
import type { ContextUsage } from './tracker';
import type { GMSummary, GMModelStats, GMConversationData, GMSystemContextItem, TokenBreakdownGroup, PendingArchiveEntry, UniqueErrorEntry, RecentErrorEntry } from './gm-tracker';
import { normalizeModelDisplayName } from './models';
import { findPricing } from './pricing-store';
import { formatResetCountdown, formatResetAbsolute, parseResetDate } from './reset-time';

// ─── Account Snapshot Type ───────────────────────────────────────────────────

/** A quota reset pool — models sharing the same reset time. */
export interface ResetPool {
    /** ISO timestamp when this pool resets */
    resetTime: string;
    /** Model labels in this pool (e.g. ["Claude 3.5 Sonnet", "GPT-4o"]) */
    modelLabels: string[];
    /** Whether at least one model in this pool has consumed quota (remainingFraction < 1.0) */
    hasUsage?: boolean;
    /** Minimum remaining quota percentage across all models in this pool (0–100). undefined = unknown */
    remainingPercent?: number;
}

/** Snapshot of an account's key status, cached per-email for multi-account display. */
export interface AccountSnapshot {
    /** Account email — natural unique key */
    email: string;
    /** Display name */
    name: string;
    /** Plan tier name (e.g. "Pro", "Free") */
    planName: string;
    /** Tier display name */
    tierName: string;
    /** Earliest quota reset time ISO across all models (the soonest expiring pool) */
    earliestResetTime: string;
    /** All distinct reset times across model pools (for multi-pool visibility) */
    allResetTimes: string[];
    /** Per-pool breakdown: each pool has a resetTime and the model labels sharing it */
    resetPools: ResetPool[];
    /** Whether this is the currently active (logged-in) account */
    isActive: boolean;
    /** Last time this snapshot was updated (ISO timestamp) */
    lastSeen: string;
}

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
    accountSnapshots?: AccountSnapshot[],
    pendingArchives?: PendingArchiveEntry[],
): string {
    if (!summary && (!gmSummary || gmSummary.totalCalls === 0)) {
        return `<p class="empty-msg">${tBi(
            'Waiting for data... GM and Activity information will appear automatically.',
            '正在等待数据... GM 和活动信息将自动显示。',
        )}</p>`;
    }

    const parts: string[] = [];

    // ── Summary Bar (merged activity + GM)
    parts.push(buildSummaryBar(summary, gmSummary, currentUsage?.cascadeId));

    // ── Recent Timeline (activity)
    if (summary) { parts.push(buildTimeline(summary, currentUsage, gmSummary)); }

    // ── Model Cards (merged activity counts + GM precision)
    const activeEmail = accountSnapshots?.find(s => s.isActive)?.email || '';
    parts.push(buildModelCards(summary, gmSummary, activeEmail));

    // ── Pending Archive Panel (moved below model stats total row)
    if (pendingArchives && pendingArchives.length > 0) {
        parts.push(buildPendingArchivePanel(pendingArchives));
    }

    // ── Tool Call Ranking (from GM messagePrompts SYSTEM toolCalls)
    if (gmSummary && Object.keys(gmSummary.toolCallCounts || {}).length > 0) {
        parts.push(buildToolCallRanking(gmSummary, currentUsage?.cascadeId));
    }

    // ── Checkpoint Viewer is now embedded inside the Timeline section



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
    // ── Error Details (GM)
    if (gmSummary && gmSummary.totalCalls > 0) {
        const errorDetails = buildErrorDetailsSection(gmSummary, currentUsage?.cascadeId);
        if (errorDetails) {
            parts.push(errorDetails);
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
    /* ─── Account Status Panel ─── */
    .acct-panel {
        margin-bottom: var(--space-4);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        overflow: hidden;
    }
    .acct-panel-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        background: var(--color-surface-dim);
        border-bottom: 1px solid var(--color-border);
        font-size: 0.88em;
        font-weight: 600;
        color: var(--color-text);
    }
    .acct-panel-header svg { width: 14px; height: 14px; flex-shrink: 0; }
    .acct-panel-count {
        font-weight: 400;
        font-size: 0.82em;
        opacity: 0.6;
    }
    .acct-card {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 6px var(--space-3);
        border-bottom: 1px solid var(--color-border-subtle);
        font-size: 0.85em;
        transition: background 0.15s cubic-bezier(.4,0,.2,1);
    }
    .acct-card:last-child { border-bottom: none; }
    @media (hover: hover) {
        .acct-card:hover { background: var(--color-surface-dim); }
    }
    .acct-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }
    .acct-indicator-active {
        background: var(--color-ok);
        box-shadow: 0 0 6px rgba(74,222,128,0.5);
        animation: acctPulse 2s ease-in-out infinite;
    }
    .acct-indicator-cached {
        background: var(--color-text-dim);
        opacity: 0.4;
    }
    @keyframes acctPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.6; transform: scale(0.85); }
    }
    .acct-identity {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
        flex: 1;
    }
    .acct-name {
        font-weight: 600;
        color: var(--color-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .acct-email {
        font-size: 0.82em;
        color: var(--color-text-dim);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .acct-plan {
        flex-shrink: 0;
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        font-size: 0.75em;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .acct-plan-pro {
        background: var(--color-info-border-dim);
        color: var(--color-info-light);
        border: 1px solid rgba(96,165,250,0.25);
    }
    .acct-plan-free {
        background: var(--color-muted-border);
        color: var(--color-muted);
        border: 1px solid rgba(148,163,184,0.2);
    }
    .acct-plan-ultra {
        background: rgba(6,182,212,0.08);
        color: var(--color-cyan);
        border: 1px solid rgba(6,182,212,0.25);
    }
    .acct-plan-team {
        background: var(--color-ok-bg);
        color: var(--color-ok-light);
        border: 1px solid var(--color-ok-border);
    }
    .acct-reset {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 1px;
        min-width: 100px;
    }
    .acct-reset-countdown {
        font-weight: 600;
        font-size: 0.85em;
        font-variant-numeric: tabular-nums;
        color: var(--color-text);
        min-width: 5em;
        text-align: right;
        flex-shrink: 0;
    }
    .acct-reset-countdown-warn {
        color: var(--color-amber);
    }
    .acct-reset-countdown-expired {
        color: var(--color-danger);
        font-weight: 700;
    }
    .acct-reset-abs {
        font-size: 0.78em;
        color: var(--color-text-dim);
        font-variant-numeric: tabular-nums;
    }
    .acct-pools {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
    }
    .acct-pool-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        justify-content: flex-end;
    }
    .acct-pool-models {
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        align-items: center;
        justify-content: flex-end;
    }
    .acct-pool-model {
        display: inline-block;
        padding: 0 4px;
        border-radius: var(--radius-sm);
        font-size: 0.72em;
        line-height: 1.6;
        white-space: nowrap;
        background: var(--color-surface-hover);
        color: var(--color-text-dim);
        border: 1px solid var(--color-border);
        max-width: 100px;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .acct-pool-more {
        display: inline-block;
        padding: 0 3px;
        font-size: 0.68em;
        color: var(--color-text-dim);
        opacity: 0.6;
    }
    .acct-tag-active {
        font-size: 0.72em;
        color: var(--color-ok);
        font-weight: 500;
    }
    .acct-tag-cached {
        font-size: 0.72em;
        color: var(--color-text-dim);
        opacity: 0.6;
    }
    .acct-pool-idle {
        opacity: 0.45;
    }
    .acct-reset-idle {
        font-size: 0.85em;
        font-weight: 400;
        color: var(--color-text-dim);
        opacity: 0.7;
        font-style: italic;
        min-width: 5em;
        text-align: right;
        flex-shrink: 0;
    }
    /* ─── Quota Progress Bar (Account Panel) ─── */
    .acct-quota-bar {
        width: 50px;
        height: 4px;
        border-radius: 2px;
        background: rgba(255,255,255,0.08);
        flex-shrink: 0;
        overflow: hidden;
        position: relative;
    }
    .acct-quota-fill {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        border-radius: 2px;
        transition: width 0.3s cubic-bezier(.4,0,.2,1);
    }
    .acct-quota-ok { background: var(--color-ok); opacity: 0.7; }
    .acct-quota-warn { background: var(--color-amber); opacity: 0.85; }
    .acct-quota-danger { background: var(--color-danger); opacity: 0.9; }
    .acct-delete-link {
        font-size: 0.72em;
        font-weight: 500;
        color: var(--color-danger);
        cursor: pointer;
        border: none;
        background: none;
        padding: 0 2px;
        opacity: 0.7;
        transition: opacity 0.15s;
        white-space: nowrap;
    }
    .acct-delete-link:hover {
        opacity: 1;
        text-decoration: underline;
    }

    /* ─── Pending Archive Panel ─── */
    .pending-archive-panel {
        margin: var(--space-3) 0;
        padding: var(--space-3);
        border: 1px solid var(--color-amber-border);
        border-left: 3px solid rgba(234,179,8,0.6);
        border-radius: var(--radius);
        background: rgba(234,179,8,0.04);
    }
    .pending-archive-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
        font-size: 0.9em;
        color: var(--color-amber-dim);
        margin-bottom: var(--space-2);
    }
    .pending-archive-count {
        font-weight: 400;
        font-size: 0.85em;
        color: var(--color-text-dim);
        margin-left: auto;
    }
    .pending-archive-stats {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2) var(--space-3);
        margin-bottom: var(--space-2);
    }
    .pending-stat {
        font-size: 0.82em;
        color: var(--color-text-dim);
    }
    .pending-stat b {
        color: var(--color-text);
        margin-left: 3px;
    }
    .pending-stat-cost b {
        color: rgba(74,222,128,0.9);
    }
    body.vscode-light .pending-stat-cost b {
        color: rgba(22,163,74,0.85);
    }
    .pending-archive-models {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-bottom: var(--space-2);
    }
    .pending-model-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: var(--radius-sm);
        background: var(--color-amber-bg);
        border: 1px solid rgba(234,179,8,0.2);
        font-size: 0.78em;
        color: var(--color-text-dim);
    }
    .pending-model-chip b {
        color: var(--color-amber-dim);
    }
    .pending-archive-note {
        font-size: 0.78em;
        color: var(--color-text-dim);
        opacity: 0.7;
        font-style: italic;
    }

    /* ─── Activity Tab: Summary Bar (chip strip layout) ─── */
    .act-summary-bar {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px;
        margin-bottom: var(--space-4);
        padding: var(--space-2) 0;
    }
    .act-stat {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        transition: background 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
        position: relative;
        cursor: default;
        white-space: nowrap;
    }
    .act-stat-warn {
        background: var(--color-danger-bg-dim);
        border-color: var(--color-danger-border);
    }
    /* Override global tooltip direction: act-stat tooltips pop downward (top),
       not upward (bottom). Must override in base state (not just :hover) so
       the fade-out transition doesn't cause the tooltip to jump from bottom
       to top when the mouse leaves. */
    .act-stat[data-tooltip]::after {
        bottom: auto;
        top: calc(100% + 6px);
        transform: translateX(-50%) scale(0.92);
        padding: var(--space-1) var(--space-2);
        background: var(--color-bg);
        color: var(--color-text);
        border: 1px solid var(--color-border);
        font-size: 0.75em;
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
        white-space: normal;
        max-width: 220px;
        width: max-content;
        text-align: center;
        z-index: var(--z-tooltip, 500);
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    }
    .act-stat[data-tooltip]:hover::after,
    .act-stat[data-tooltip]:focus-visible::after {
        transform: translateX(-50%) scale(1);
    }
    /* Edge tooltip anchoring */
    .act-summary-bar > .act-stat:first-child[data-tooltip]::after {
        left: 0; right: auto; transform: translateX(0) scale(0.92); text-align: left;
    }
    .act-summary-bar > .act-stat:first-child[data-tooltip]:hover::after {
        transform: translateX(0) scale(1);
    }
    .act-summary-bar > .act-stat:last-child[data-tooltip]::after {
        left: auto; right: 0; transform: translateX(0) scale(0.92); text-align: left;
    }
    .act-summary-bar > .act-stat:last-child[data-tooltip]:hover::after {
        transform: translateX(0) scale(1);
    }
    @media (hover: hover) {
        .act-stat:hover {
            background: rgba(96,165,250,0.08);
            border-color: rgba(96,165,250,0.25);
        }
        .act-stat-warn:hover {
            background: var(--color-danger-border-dim);
            border-color: var(--color-danger-border-strong);
        }
    }
    .act-stat-icon { display: flex; align-items: center; color: var(--color-text-dim); }
    .act-stat-icon svg { display: block; }
    .act-icon { width: 1.1em; height: 1.1em; display: inline-block; vertical-align: -0.2em; margin-right: 0.3em; color: var(--color-text-dim); }
    .act-stat-val { font-weight: 700; font-size: 0.88em; line-height: 1; }
    .act-est { font-weight: 400; font-size: 0.85em; opacity: 0.6; font-style: italic; }
    .act-stat-label { color: var(--color-text-dim); font-size: 0.72em; letter-spacing: 0.3px; }

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
        background: var(--color-surface-dim);
        border-bottom: 1px solid var(--color-border);
        word-break: break-word;
        overflow-wrap: anywhere;
        border-left: 3px solid var(--color-accent);
    }
    /* Model card color accents */
    .act-model-card:nth-child(1) .act-card-header { border-left-color: var(--color-info); }
    .act-model-card:nth-child(2) .act-card-header { border-left-color: var(--color-ok); }
    .act-model-card:nth-child(3) .act-card-header { border-left-color: var(--color-warn); }
    .act-model-card:nth-child(4) .act-card-header { border-left-color: var(--color-danger); }
    .act-model-card:nth-child(5) .act-card-header { border-left-color: var(--color-teal); }
    .act-model-card:nth-child(6) .act-card-header { border-left-color: var(--color-orange); }
    .act-card-body { padding: var(--space-2) var(--space-3); }
    .act-card-row {
        display: flex;
        justify-content: space-between;
        padding: 2px var(--space-1);
        font-size: 0.85em;
        border-radius: var(--radius-sm);
        transition: background 0.1s ease;
    }
    .act-card-row:nth-child(even) {
        background: rgba(255, 255, 255, 0.02);
    }
    .act-card-row:hover {
        background: rgba(255, 255, 255, 0.06);
    }
    .act-card-row .val { font-weight: 600; padding: 0 4px; border-radius: var(--radius-sm); border: 1px solid transparent; }
    /* -- Value color coding (aligned with timeline tag colors) -- */
    .act-card-row .val-calls { color: var(--color-info-light); background: rgba(96,165,250,0.08); border-color: rgba(96,165,250,0.2); }
    .act-card-row .val-time { color: var(--color-amber-light); background: rgba(252,211,77,0.08); border-color: rgba(252,211,77,0.2); }
    .act-card-row .val-in { color: var(--color-info-light); background: rgba(96,165,250,0.08); border-color: rgba(96,165,250,0.2); }
    .act-card-row .val-out { color: var(--color-ok-light); background: rgba(74,222,128,0.08); border-color: rgba(74,222,128,0.2); }
    .act-card-row .val-cache { color: var(--color-teal-light); background: rgba(45,212,191,0.08); border-color: rgba(45,212,191,0.2); }
    .act-card-row .val-cost { color: var(--color-ok-light); background: rgba(34,197,94,0.08); border-color: rgba(34,197,94,0.25); }
    .act-card-row .val-hit { color: var(--color-amber); background: rgba(251,191,36,0.08); border-color: rgba(251,191,36,0.2); }
    .act-card-row .val-credits { color: var(--color-danger-light); background: rgba(248,113,113,0.08); border-color: rgba(248,113,113,0.2); }
    .act-card-row-cost .val { color: var(--color-ok-light); }
    body.vscode-light .act-card-row:nth-child(even) { background: rgba(0, 0, 0, 0.02); }
    body.vscode-light .act-card-row:hover { background: rgba(0, 0, 0, 0.05); }
    body.vscode-light .act-card-row .val-calls { color: #2563eb; background: rgba(37,99,235,0.06); border-color: rgba(37,99,235,0.15); }
    body.vscode-light .act-card-row .val-time { color: #ca8a04; background: rgba(202,138,4,0.06); border-color: rgba(202,138,4,0.15); }
    body.vscode-light .act-card-row .val-in { color: #2563eb; background: rgba(37,99,235,0.06); border-color: rgba(37,99,235,0.15); }
    body.vscode-light .act-card-row .val-out { color: #16a34a; background: rgba(22,163,74,0.06); border-color: rgba(22,163,74,0.15); }
    body.vscode-light .act-card-row .val-cache { color: #0d9488; background: rgba(13,148,136,0.06); border-color: rgba(13,148,136,0.15); }
    body.vscode-light .act-card-row .val-cost { color: #16a34a; background: rgba(22,163,74,0.06); border-color: rgba(22,163,74,0.15); }
    body.vscode-light .act-card-row .val-hit { color: #d97706; background: rgba(217,119,6,0.06); border-color: rgba(217,119,6,0.15); }
    body.vscode-light .act-card-row .val-credits { color: #dc2626; background: rgba(220,38,38,0.06); border-color: rgba(220,38,38,0.15); }
    body.vscode-light .act-card-row-cost .val { color: rgba(22,163,74,0.85); }
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
        background: var(--color-surface-hover);
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
        border-bottom: 1px solid var(--color-divider-subtle);
        transition: background-color 0.15s cubic-bezier(.4,0,.2,1);
    }
    @media (hover: hover) {
        .act-tl-item:hover { background: var(--color-surface); }
    }
    .act-tl-item:last-child { border-bottom: none; }
    .act-tl-time { color: var(--color-text-dim); flex-shrink: 0; width: 42px; font-size: 0.78em; font-variant-numeric: tabular-nums; white-space: nowrap; padding: 0 3px; border-radius: var(--radius-sm); background: var(--color-surface, rgba(128,128,128,0.1)); border: 1px solid var(--color-border, rgba(128,128,128,0.15)); text-align: center; }
    .act-tl-icon { flex-shrink: 0; width: 18px; text-align: center; }
    .act-tl-content { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--space-1); overflow: hidden; }
    .act-tl-model { color: var(--color-info); font-weight: 500; flex-shrink: 0; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .act-tl-detail { color: var(--color-text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .act-tl-user { color: var(--color-ok); font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: default; }
    .act-tl-ai-preview { color: var(--color-orange); opacity: 0.8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; cursor: default; }
    .act-tl-meta { margin-left: auto; display: flex; align-items: center; gap: 3px; flex-shrink: 0; white-space: nowrap; }
    .act-tl-dur { color: var(--color-text-dim); flex-shrink: 0; padding: 0 3px; border-radius: var(--radius-sm); background: var(--color-surface, rgba(128,128,128,0.1)); border: 1px solid var(--color-border, rgba(128,128,128,0.15)); font-size: 0.78em; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .act-tl-reasoning .act-tl-icon { color: var(--color-ok); }
    .act-tl-system { background: var(--color-orange-bg); border-left: 2px solid rgba(251,146,60,0.4); padding-left: 6px; }
    .act-tl-system .act-tl-icon { color: var(--color-orange); }
    .act-tl-system .act-tl-detail { color: var(--color-orange); font-weight: 500; }
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
    .act-tl-gm-status {
        display: inline-flex;
        gap: 2px;
        flex-shrink: 0;
        font-size: 0.78em;
        min-width: 7em;
        justify-content: flex-end;
    }
    .act-tl-gm-tag {
        padding: 0 3px;
        border-radius: var(--radius-sm);
        white-space: nowrap;
        border: 1px solid transparent;
    }
    .act-tl-gm-in  { background: rgba(37,99,235,0.12); color: #2563eb; border-color: rgba(37,99,235,0.25); }
    .act-tl-gm-out { background: rgba(22,163,74,0.12);  color: #16a34a; border-color: rgba(22,163,74,0.25); }
    .act-tl-gm-ttft { background: rgba(202,138,4,0.12);  color: #ca8a04; border-color: rgba(202,138,4,0.25); }
    .act-tl-gm-cache { background: rgba(13,148,136,0.12); color: #0d9488; border-color: rgba(13,148,136,0.25); }
    .act-tl-gm-cost  { background: rgba(34,197,94,0.12);  color: #16a34a; border-color: rgba(34,197,94,0.25); }
    .act-tl-gm-cost svg { width: 10px; height: 10px; vertical-align: -1px; margin-right: 1px; }
    .act-tl-gm-credit { background: rgba(220,38,38,0.14); color: #dc2626; border-color: rgba(220,38,38,0.25); }
    .act-tl-gm-retry { background: rgba(220,38,38,0.12);  color: #dc2626; border-color: rgba(220,38,38,0.25); }
    .act-tl-gm-tool { background: rgba(100,116,139,0.12); color: #64748b; font-size: 0.88em; border-color: rgba(100,116,139,0.2); }
    .act-tl-gm-ctx { background: rgba(251,146,60,0.10); color: #fb923c; border-color: rgba(251,146,60,0.25); }
    body.vscode-dark .act-tl-gm-in  { background: var(--color-info-border-dim);  color: var(--color-info-light); }
    body.vscode-dark .act-tl-gm-out { background: var(--color-ok-bg);  color: var(--color-ok-light); }
    body.vscode-dark .act-tl-gm-ttft { background: var(--color-amber-border-dim); color: var(--color-amber-light); }
    body.vscode-dark .act-tl-gm-cache { background: var(--color-teal-bg); color: var(--color-teal-light); }
    body.vscode-dark .act-tl-gm-cost  { background: rgba(34,197,94,0.10); color: var(--color-ok-light); }
    body.vscode-dark .act-tl-gm-credit { background: rgba(248,113,113,0.16); color: var(--color-danger-light); }
    body.vscode-dark .act-tl-gm-retry { background: var(--color-danger-bg-hover); color: var(--color-danger-light); }
    body.vscode-dark .act-tl-gm-tool { background: var(--color-muted-border); color: var(--color-muted); }
    body.vscode-dark .act-tl-gm-ctx { background: var(--color-orange-bg, rgba(251,146,60,0.10)); color: var(--color-orange); }
    body.vscode-light .act-tl-gm-tool { background: rgba(51,65,85,0.08); color: #334155; border-color: rgba(51,65,85,0.2); }
    /* ─── Turn Groups (collapsible segments) ─── */
    .act-tl-turn {
        border: 1px solid var(--color-border, rgba(128,128,128,0.12));
        border-radius: var(--radius-md);
        background: var(--color-surface, rgba(128,128,128,0.04));
        overflow: hidden;
        margin-bottom: var(--space-2);
        transition: border-color 0.2s cubic-bezier(.4,0,.2,1);
    }
    .act-tl-turn:last-child {
        margin-bottom: 0;
    }
    .act-tl-turn[open] {
        border-color: var(--color-ok-border);
    }
    .act-tl-turn-header {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        padding: var(--space-2);
        cursor: pointer;
        user-select: none;
        font-size: 0.85em;
        color: var(--color-text);
        list-style: none;
        transition: background 0.15s cubic-bezier(.4,0,.2,1);
    }
    .act-tl-turn-header::-webkit-details-marker { display: none; }
    .act-tl-turn-header::before {
        content: '';
        width: 0; height: 0;
        border-left: 5px solid currentColor;
        border-top: 4px solid transparent;
        border-bottom: 4px solid transparent;
        transition: transform 0.2s cubic-bezier(.4,0,.2,1);
        flex-shrink: 0;
        opacity: 0.5;
    }
    .act-tl-turn[open] > .act-tl-turn-header::before {
        transform: rotate(90deg);
    }
    @media (hover: hover) {
        .act-tl-turn-header:hover { background: var(--color-surface); }
    }
    .act-tl-turn-icon {
        flex-shrink: 0;
        color: var(--color-ok);
        display: flex;
        align-items: center;
    }
    .act-tl-turn-icon .act-icon { width: 14px; height: 14px; }
    .act-tl-turn-text {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 500;
        min-width: 0;
    }
    .seg-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
        align-items: center;
        flex-shrink: 0;
    }
    .seg-chip {
        display: inline-flex;
        align-items: center;
        padding: 1px 5px;
        border-radius: var(--radius-sm);
        font-size: 0.72em;
        line-height: 1.5;
        white-space: nowrap;
        border: 1px solid transparent;
        background: var(--color-surface-hover);
        color: var(--color-text-dim);
    }
    .seg-chip-model {
        color: var(--color-info);
        border-color: var(--color-info-border);
        background: rgba(96,165,250,0.08);
        font-weight: 500;
    }
    .seg-chip-calls {
        border-color: rgba(74,222,128,0.2);
        background: rgba(74,222,128,0.08);
        color: var(--color-ok-light);
    }
    .seg-chip-tools {
        border-color: rgba(250,204,21,0.2);
        background: rgba(250,204,21,0.08);
        color: #fde68a;
    }
    .seg-chip-tok {
        border-color: var(--color-danger-border);
        background: var(--color-danger-bg);
        color: var(--color-danger-light);
    }
    .seg-chip-cache {
        border-color: var(--color-teal-border);
        background: rgba(45,212,191,0.08);
        color: var(--color-teal-light);
    }
    .seg-chip-credits {
        border-color: var(--color-orange-border);
        background: rgba(249,115,22,0.08);
        color: var(--color-orange-light);
    }
    .seg-chip-cost {
        border-color: rgba(34,197,94,0.25);
        background: rgba(34,197,94,0.08);
        color: #22c55e;
        font-weight: 600;
    }
    .seg-chip-ctx {
        border-color: var(--color-orange-border);
        background: rgba(251,146,60,0.08);
        color: var(--color-orange-light);
    }
    .seg-chip-retry {
        border-color: var(--color-danger-border);
        background: var(--color-danger-bg);
        color: var(--color-danger-light);
    }
    body.vscode-light .seg-chip-tools { color: #b45309; border-color: rgba(180,83,9,0.2); background: rgba(180,83,9,0.06); }
    .act-tl-segment-user {
        background: var(--color-ok-bg-dim);
        padding-left: var(--space-2);
    }
    .act-tl-segment-user::before {
        content: '';
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--color-ok);
        flex-shrink: 0;
        margin-right: var(--space-1);
    }
    .act-tl-segment-body {
        display: flex;
        flex-direction: column;
        border-top: 1px solid var(--color-border-subtle);
    }
    .act-tl-segment-body .act-tl-item {
        padding-left: var(--space-2);
    }
    .act-tl-segment-body .act-tl-item::before {
        content: '';
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--color-border-hover);
        flex-shrink: 0;
        margin-right: var(--space-1);
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
        background: var(--color-amber-border-dim);
        color: var(--color-amber-light);
        border-color: rgba(251,191,36,0.2);
    }
    .act-tl-tag-struct {
        background: var(--color-info-border-dim);
        color: var(--color-info-light);
        border-color: var(--color-info-border);
    }
    .act-tl-tag-est {
        background: rgba(248,113,113,0.14);
        color: var(--color-danger-light);
        border-color: var(--color-danger-border);
    }
    .act-tl-tag-basis {
        background: var(--color-teal-bg);
        color: var(--color-teal-light);
        border-color: var(--color-teal-border);
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
    .act-badge { font-size: 0.75em; opacity: 0.7; padding: 1px 6px; border-radius: var(--radius-sm); }
    .act-checkpoint-model { border-color: var(--color-border, rgba(128,128,128,0.1)); opacity: 0.85; }

    /* ─── Activity Tab: Timeline Legend Tooltip ─── */
    .act-tl-help-wrap {
        position: relative;
        display: inline-flex;
        margin-left: auto;
    }
    .act-tl-help-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px; height: 18px;
        border-radius: var(--radius-full);
        border: 1px solid var(--color-muted-border-strong);
        background: var(--color-muted-bg);
        color: var(--color-text-dim);
        font-size: 0.7em;
        font-weight: 700;
        cursor: help;
        user-select: none;
        flex-shrink: 0;
        transition: background 0.15s ease, border-color 0.15s ease;
    }
    @media (hover: hover) {
        .act-tl-help-btn:hover {
            background: rgba(96,165,250,0.15);
            border-color: rgba(96,165,250,0.4);
            color: var(--color-text);
        }
        .act-tl-help-btn:hover + .act-tl-help-popup {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
    }
    .act-tl-help-popup {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        z-index: 100;
        width: 280px;
        max-height: 260px;
        overflow-y: auto;
        padding: var(--space-2) var(--space-3);
        background: var(--color-bg);
        border: 1px solid var(--color-border-strong);
        border-radius: var(--radius-lg);
        box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        backdrop-filter: blur(12px);
        font-size: 0.75em;
        line-height: 1.5;
        color: var(--color-text-dim);
        opacity: 0;
        visibility: hidden;
        transform: translateY(-4px);
        transition: opacity 0.15s ease, visibility 0.15s ease, transform 0.15s ease;
        pointer-events: none;
    }
    .act-tl-help-popup::-webkit-scrollbar { width: 3px; }
    .act-tl-help-popup::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: var(--radius-full); }
    .act-tl-help-row {
        display: flex;
        align-items: flex-start;
        gap: var(--space-2);
        padding: 2px 0;
    }
    .act-tl-help-sample {
        flex-shrink: 0;
        min-width: 80px;
        display: flex;
        align-items: center;
    }
    .act-tl-help-desc {
        flex: 1;
        min-width: 0;
    }
    .act-tl-help-desc b { color: var(--color-text); }
    .act-tl-help-divider {
        height: 1px;
        background: var(--color-divider);
        margin: var(--space-1) 0;
    }
    .act-tl-help-group-label {
        font-size: 0.82em;
        font-weight: 600;
        color: var(--color-text);
        margin-bottom: 2px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    body.vscode-light .act-tl-help-popup {
        background: var(--color-bg);
        border-color: var(--color-border-strong);
        box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    }
    body.vscode-light .act-tl-help-divider { background: var(--color-divider); }
    body.vscode-light .act-tl-help-btn { background: var(--color-muted-bg); border-color: var(--color-border-strong); }



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
    .act-compress-note { color: var(--color-danger); margin-left: var(--space-2); font-size: 0.85em; }
    .err-delta { color: var(--color-danger); font-weight: 600; }


    /* ─── Activity Tab: Conversation Breakdown ─── */
    .act-conv-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        margin-bottom: var(--space-4);
        max-height: 300px;
        overflow-y: auto;
        padding-right: 2px;
    }
    .act-conv-list::-webkit-scrollbar { width: 4px; }
    .act-conv-list::-webkit-scrollbar-track { background: transparent; }
    .act-conv-list::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: var(--radius-full); }
    .act-conv-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        border-left: 3px solid var(--color-accent);
        transition: border-color 0.15s cubic-bezier(.4,0,.2,1), transform 0.1s cubic-bezier(.4,0,.2,1);
    }
    @media (hover: hover) {
        .act-conv-item:hover {
            border-color: var(--color-accent);
            transform: translateX(2px);
        }
    }
    /* Color cycling for conversation cards */
    .act-conv-item:nth-child(6n+1) { border-left-color: var(--color-info); }
    .act-conv-item:nth-child(6n+2) { border-left-color: var(--color-ok); }
    .act-conv-item:nth-child(6n+3) { border-left-color: var(--color-warn); }
    .act-conv-item:nth-child(6n+4) { border-left-color: var(--color-danger); }
    .act-conv-item:nth-child(6n+5) { border-left-color: var(--color-teal); }
    .act-conv-item:nth-child(6n+6) { border-left-color: var(--color-orange); }
    .act-conv-title-chip {
        flex: 1;
        min-width: 0;
        display: inline-block;
        padding: 1px 8px;
        border-radius: var(--radius-full);
        background: var(--color-info-bg);
        border: 1px solid var(--color-info-border);
        color: var(--color-text);
        font-weight: 600;
        font-size: 0.85em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .act-conv-meta {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-shrink: 0;
        font-size: 0.78em;
        color: var(--color-text-dim);
    }
    .act-conv-meta-chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        background: var(--color-surface);
        border: 1px solid var(--color-border-dim);
        white-space: nowrap;
    }
    .act-conv-meta-chip b { color: var(--color-text); font-weight: 600; }
    .act-conv-meta-chip svg { width: 10px; height: 10px; flex-shrink: 0; opacity: 0.6; }
    .act-conv-credits { color: var(--color-amber-light); }
    .act-conv-date { color: var(--color-text-dim); font-variant-numeric: tabular-nums; }
    body.vscode-light .act-conv-item { border-color: var(--color-border); background: var(--color-surface-raised); }
    body.vscode-light .act-conv-title-chip { background: var(--color-info-bg); border-color: var(--color-info-border); }
    body.vscode-light .act-conv-meta-chip { background: var(--color-surface-dim); border-color: var(--color-border-dim); }

    /* ─── GM Precision Sections ─── */
    .gm-perf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: var(--space-2); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3); margin-bottom: var(--space-4); }
    .gm-perf-item { display: flex; flex-direction: column; gap: 2px; padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: var(--color-surface-subtle); border: 1px solid var(--color-border-subtle); }
    .gm-perf-label { font-size: 0.72em; color: var(--color-text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
    .gm-perf-val { font-weight: 700; font-size: 1.05em; }
    .gm-perf-sub { font-size: 0.75em; color: var(--color-text-dim); }
    .gm-cache-bar-bg { height: 20px; background: var(--color-surface-hover); border-radius: var(--radius-sm); overflow: hidden; margin-bottom: var(--space-1); }
    .gm-cache-bar { height: 100%; border-radius: var(--radius-sm); background: linear-gradient(90deg, #3b82f6, #60a5fa); transition: width 0.3s cubic-bezier(.4,0,.2,1); }
    .gm-badge-real { display: inline-block; font-size: 0.65em; padding: 1px var(--space-1); border-radius: var(--radius-sm); background: rgba(52,211,153,0.15); color: var(--color-ok-dim); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; vertical-align: middle; margin-left: var(--space-1); }
    .gm-provider-tag { display: inline-block; font-size: 0.72em; padding: 1px var(--space-1); border-radius: var(--radius-sm); background: var(--color-info-bg); color: var(--color-info); margin-top: var(--space-1); }
    .gm-account-section {
        padding: var(--space-1) 0 0;
    }
    .gm-account-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 2px var(--space-1);
        font-size: 0.82em;
    }
    .gm-account-row .gm-account-label {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--color-text-dim);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }
    .gm-account-row .gm-account-label svg {
        width: 12px; height: 12px;
        flex-shrink: 0;
        opacity: 0.6;
    }
    .gm-account-row .gm-account-count {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--color-info);
        flex-shrink: 0;
        padding: 0 4px;
        border-radius: var(--radius-sm);
        background: rgba(96,165,250,0.08);
        border: 1px solid rgba(96,165,250,0.2);
    }
    /* Active account highlight */
    .gm-account-row.gm-account-active {
        background: var(--color-ok-bg-dim);
        border-radius: var(--radius-sm);
    }
    .gm-account-row.gm-account-active .gm-account-label {
        color: var(--color-text);
    }
    .gm-account-row.gm-account-active .gm-account-label svg {
        stroke: var(--color-ok-dim);
        opacity: 1;
    }
    .gm-account-row.gm-account-active .gm-account-count {
        color: var(--color-ok-dim);
        background: rgba(52,211,153,0.08);
        border-color: rgba(52,211,153,0.2);
    }
    /* ── Credit call count annotation ── */
    .act-credit-calls {
        font-size: 0.82em;
        font-weight: 400;
        color: var(--color-orange-light);
        opacity: 0.7;
        margin-left: 2px;
    }
    /* ── Error count in account rows ── */
    .gm-account-err {
        color: var(--color-danger);
        font-weight: 600;
        font-size: 0.82em;
        font-variant-numeric: tabular-nums;
        margin-left: 3px;
        white-space: nowrap;
        padding: 0 4px;
        border-radius: var(--radius-sm);
        background: var(--color-danger-border-dim);
        border: 1px solid rgba(248,113,113,0.18);
        display: none; /* hidden by default */
    }
    .gm-account-row.gm-account-active .gm-account-err {
        color: var(--color-danger);
    }
    /* Shown when toggle is ON */
    .model-stats-show-errors .gm-account-err {
        display: inline;
    }
    /* ── Error Toggle Button ── */
    .model-stats-err-toggle {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 1px 8px;
        border-radius: var(--radius-full);
        border: 1px solid rgba(248,113,113,0.25);
        background: var(--color-danger-bg);
        color: var(--color-danger);
        font-size: 0.72em;
        font-weight: 600;
        cursor: pointer;
        user-select: none;
        transition: all 0.15s cubic-bezier(.4,0,.2,1);
        flex-shrink: 0;
        line-height: 1.6;
    }
    .model-stats-err-toggle svg {
        width: 10px; height: 10px;
        flex-shrink: 0;
    }
    @media (hover: hover) {
        .model-stats-err-toggle:hover {
            background: var(--color-danger-bg-hover);
            border-color: rgba(248,113,113,0.4);
        }
    }
    .model-stats-err-toggle.is-off {
        background: var(--color-surface-dim);
        border-color: var(--color-border);
        color: var(--color-text-dim);
        opacity: 0.6;
    }
    @media (hover: hover) {
        .model-stats-err-toggle.is-off:hover {
            opacity: 0.9;
            background: var(--color-surface-hover);
        }
    }
    body.vscode-light .model-stats-err-toggle {
        background: var(--color-danger-bg-dim);
        border-color: var(--color-danger-border);
    }
    body.vscode-light .model-stats-err-toggle.is-off {
        background: var(--color-surface-dim);
        border-color: var(--color-border);
    }
    /* ── Model Stats Summary Row ── */
    .model-stats-total {
        display: flex;
        align-items: center;
        gap: 0;
        padding: 6px 12px;
        margin-top: var(--space-3);
        font-size: 0.8em;
        color: var(--color-text-dim);
        background: rgba(96,165,250,0.04);
        border: 1px solid var(--color-info-border-dim);
        border-radius: var(--radius-md);
    }
    .model-stats-total .mst-icon {
        width: 14px; height: 14px;
        flex-shrink: 0;
        margin-right: 6px;
        opacity: 0.5;
    }
    .model-stats-total .mst-label {
        font-weight: 600;
        color: var(--color-info-strong);
        margin-right: 8px;
        letter-spacing: 0.3px;
    }
    .model-stats-total .mst-items {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        margin-left: auto;
    }
    .model-stats-total .mst-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
        padding: 2px 8px;
        background: var(--color-surface-dim);
        border: 1px solid var(--color-neutral-border);
        border-radius: var(--radius-sm);
        transition: border-color 0.15s ease;
    }
    @media (hover: hover) {
        .model-stats-total .mst-item:hover {
            border-color: rgba(96,165,250,0.3);
            background: rgba(96,165,250,0.06);
        }
    }
    .model-stats-total .mst-val {
        font-weight: 600;
        color: var(--color-text);
        font-variant-numeric: tabular-nums;
    }
    body.vscode-light .model-stats-total {
        background: rgba(37,99,235,0.04);
        border-color: rgba(37,99,235,0.12);
    }
    body.vscode-light .model-stats-total .mst-label {
        color: rgba(37,99,235,0.7);
    }
    body.vscode-light .model-stats-total .mst-item {
        background: rgba(0,0,0,0.02);
        border-color: rgba(0,0,0,0.08);
    }
    @media (hover: hover) {
        body.vscode-light .model-stats-total .mst-item:hover {
            border-color: rgba(37,99,235,0.3);
            background: rgba(37,99,235,0.06);
        }
    }
    .model-stats-total .mst-item-cost {
        border-color: rgba(74,222,128,0.25);
        background: rgba(74,222,128,0.06);
    }
    .model-stats-total .mst-item-cost .mst-val {
        color: rgba(74,222,128,0.9);
    }
    body.vscode-light .model-stats-total .mst-item-cost {
        border-color: rgba(22,163,74,0.2);
        background: rgba(22,163,74,0.04);
    }
    body.vscode-light .model-stats-total .mst-item-cost .mst-val {
        color: rgba(22,163,74,0.85);
    }

    /* ─── Retry Overhead ─── */
    .act-stat-warn { border-color: var(--color-danger-border-strong); }
    @media (hover: hover) {
        .act-stat-warn:hover { border-color: rgba(248,113,113,0.6); box-shadow: 0 0 8px rgba(248,113,113,0.15); }
    }
    /* ── Error Details Section ── */
    .gm-err-card {
        background: var(--color-surface);
        border: 1px solid var(--color-danger-border);
        border-radius: var(--radius-md);
        padding: var(--space-3);
        margin-bottom: var(--space-4);
    }
    .gm-err-codes {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-1);
        margin-bottom: var(--space-2);
    }
    .gm-err-tag {
        display: inline-block;
        font-size: 0.75em;
        font-weight: 600;
        padding: 2px var(--space-2);
        border-radius: var(--radius-sm);
        letter-spacing: 0.3px;
    }
    .gm-err-tag-ratelimit { background: rgba(234,88,12,0.15); color: var(--color-orange-strong); }
    .gm-err-tag-server    { background: var(--color-danger-border-dim); color: var(--color-danger); }
    .gm-err-tag-other     { background: var(--color-muted-border); color: var(--color-muted); }
    .gm-err-overhead {
        font-size: 0.75em;
        color: var(--color-text-dim);
        padding: var(--space-1) 0;
        border-top: 1px solid var(--color-divider);
        margin-top: var(--space-1);
    }
    .gm-err-list {
        display: flex;
        flex-direction: column;
        gap: 3px;
        margin-top: var(--space-2);
        padding-top: var(--space-2);
        border-top: 1px solid var(--color-divider);
    }
    .gm-err-msg {
        font-size: 0.72em;
        font-family: var(--font-mono, monospace);
        color: var(--color-danger-light);
        padding: 4px var(--space-2);
        border-radius: var(--radius-sm);
        background: var(--color-danger-bg-dim);
        line-height: 1.5;
    }
    .gm-err-idx {
        display: inline-block;
        min-width: 1.8em;
        color: rgba(252,165,165,0.5);
        font-weight: 600;
        font-size: 0.9em;
        user-select: none;
    }
    /* ── Expandable error (details/summary) ── */
    .gm-err-expand {
        border-radius: var(--radius-sm);
        background: var(--color-danger-bg-dim);
    }
    .gm-err-msg-summary {
        display: block;
        min-width: 0;
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        list-style: none;
        user-select: none;
    }
    .gm-err-msg-summary::-webkit-details-marker { display: none; }
    .gm-err-msg-summary::before {
        content: '\u25b6';
        display: inline-block;
        font-size: 0.65em;
        margin-right: 4px;
        transition: transform 0.15s ease;
        color: rgba(252,165,165,0.45);
        vertical-align: middle;
    }
    /* Non-overflowing: hide expand arrow + disable pointer */
    .gm-err-expand.no-overflow > .gm-err-msg-summary {
        cursor: default;
        pointer-events: none;
    }
    .gm-err-expand.no-overflow > .gm-err-msg-summary::before {
        display: none;
    }
    .gm-err-expand[open] > .gm-err-msg-summary::before {
        display: none;
    }
    /* When expanded: fully hide summary — collapse is via .gm-err-msg-full click */
    .gm-err-expand[open] > .gm-err-msg-summary {
        height: 0;
        padding: 0;
        margin: 0;
        overflow: hidden;
        border: none;
        pointer-events: none;
    }
    .gm-err-msg-full {
        font-size: 0.72em;
        font-family: var(--font-mono, monospace);
        color: var(--color-danger-light);
        white-space: pre-wrap;
        word-break: break-all;
        line-height: 1.6;
        padding: 5px var(--space-2);
        cursor: pointer;
    }
    .gm-err-msg-full::before {
        content: '\u25bc';
        display: inline-block;
        font-size: 0.65em;
        margin-right: 4px;
        color: rgba(252,165,165,0.45);
        vertical-align: middle;
    }

    /* ── Unique Error Types Catalog ── */
    .gm-ue-section {
        margin-top: var(--space-2);
        padding-top: var(--space-2);
        border-top: 1px solid var(--color-divider);
    }
    .gm-ue-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: 0.8em;
        font-weight: 600;
        color: var(--color-danger);
        cursor: pointer;
        list-style: none;
        user-select: none;
        padding: 2px 0;
    }
    .gm-ue-header::-webkit-details-marker { display: none; }
    .gm-ue-header::before {
        content: '\u25b6';
        display: inline-block;
        font-size: 0.6em;
        transition: transform 0.15s ease;
        color: var(--color-danger);
        flex-shrink: 0;
    }
    .gm-ue-section[open] > .gm-ue-header::before {
        transform: rotate(90deg);
    }
    .gm-ue-header .act-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--color-danger);
    }
    .gm-ue-header .act-badge {
        font-size: 0.85em;
        font-weight: 500;
    }
    /* Copy button */
    .gm-ue-copy-btn {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: transparent;
        border: 1px solid var(--color-danger-border);
        border-radius: var(--radius-sm);
        color: var(--color-danger-light);
        cursor: pointer;
        padding: 2px 6px;
        font-size: 0.85em;
        opacity: 0.6;
        transition: opacity 0.15s, background 0.15s, border-color 0.15s;
    }
    .gm-ue-copy-btn:hover {
        opacity: 1;
        background: var(--color-danger-bg-dim);
        border-color: var(--color-danger);
    }
    .gm-ue-copy-btn.copied {
        opacity: 1;
        border-color: var(--color-ok);
        color: var(--color-ok);
    }
    /* Custom tooltip for copy button */
    .gm-ue-copy-btn {
        position: relative;
    }
    .gm-ue-tooltip {
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        background: var(--color-surface-raised, #2a2a2a);
        color: var(--color-text, #e0e0e0);
        font-size: 0.75em;
        font-weight: 500;
        padding: 3px 8px;
        border-radius: var(--radius-sm);
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease;
        border: 1px solid var(--color-border);
        z-index: 10;
    }
    .gm-ue-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 4px solid transparent;
        border-top-color: var(--color-border);
    }
    .gm-ue-copy-btn:hover .gm-ue-tooltip {
        opacity: 1;
    }
    .gm-ue-copy-btn.copied .gm-ue-tooltip {
        opacity: 0;
    }
    .gm-ue-list {
        display: flex;
        flex-direction: column;
        gap: 3px;
        margin-top: var(--space-2);
    }
    .gm-ue-row {
        border-left: 3px solid var(--color-danger-border);
        transition: border-color 0.15s ease;
    }
    .gm-ue-row[open] {
        border-left-color: var(--color-danger);
    }
    .gm-ue-summary {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        min-width: 0;
        cursor: pointer;
        padding: 4px var(--space-2);
        font-size: 0.75em;
        list-style: none;
        user-select: none;
        overflow: hidden;
    }
    .gm-ue-summary::-webkit-details-marker { display: none; }
    .gm-ue-summary::before {
        content: '\u25b6';
        display: inline-block;
        font-size: 0.6em;
        margin-right: 2px;
        transition: transform 0.15s ease;
        color: rgba(252,165,165,0.45);
        flex-shrink: 0;
    }
    .gm-ue-row[open] > .gm-ue-summary::before {
        transform: rotate(90deg);
    }
    .gm-ue-idx {
        color: rgba(252,165,165,0.5);
        font-weight: 600;
        font-size: 0.9em;
        min-width: 1.6em;
        flex-shrink: 0;
    }
    .gm-ue-code {
        flex-shrink: 0;
    }
    .gm-ue-time {
        font-size: 0.85em;
        color: var(--color-text-dim);
        white-space: nowrap;
        flex-shrink: 0;
        font-family: var(--font-mono, monospace);
    }
    .gm-ue-msg-preview {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--font-mono, monospace);
        color: var(--color-danger-light);
    }
    .gm-ue-full {
        margin: 0 0 2px var(--space-4);
        border-left: 2px solid var(--color-danger-border-dim);
        padding-left: var(--space-2);
    }



    /* ─── Light Theme: Activity Panel ──── */
    body.vscode-light .act-card-header { background: var(--color-surface-dim); }
    body.vscode-light .act-tool-tag { background: var(--color-surface-hover); }
    body.vscode-light .act-tl-segment-body .act-tl-item::before { background: var(--color-border-hover); }
    body.vscode-light .act-tl-item { border-bottom-color: var(--color-border-subtle); }
    @media (hover: hover) {
        body.vscode-light .act-tl-item:hover { background: var(--color-surface-dim); }
    }
    body.vscode-light .gm-perf-item { background: var(--color-surface-subtle); border-color: var(--color-border-dim); }
    body.vscode-light .gm-cache-bar-bg { background: var(--color-surface-hover); }
    body.vscode-light .gm-retry-stops { border-top-color: var(--color-divider); }
    body.vscode-light .act-rank-bar-bg { background: var(--color-surface-hover); }


    /* ─── Context Intelligence Section ─── */
    .ci-section {
        margin-bottom: var(--space-3);
        border: 1px solid var(--color-amber-border-dim);
        border-radius: var(--radius-lg);
        background: rgba(251,191,36,0.02);
        overflow: hidden;
    }
    .ci-section-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        cursor: pointer;
        user-select: none;
        list-style: none;
        font-size: 1em;
        font-weight: 600;
        color: var(--color-text);
        transition: background 0.15s cubic-bezier(.4,0,.2,1);
    }
    .ci-section-header::-webkit-details-marker { display: none; }
    .ci-section-header::before {
        content: '▸';
        display: inline-block;
        font-size: 0.8em;
        transition: transform 0.2s cubic-bezier(.4,0,.2,1);
        opacity: 0.5;
        flex-shrink: 0;
    }
    .ci-section[open] > .ci-section-header::before { transform: rotate(90deg); opacity: 0.8; }
    @media (hover: hover) {
        .ci-section-header:hover { background: rgba(251,191,36,0.06); }
    }
    .ci-badges {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-left: auto;
    }
    .ci-section[open] > .cp-viewer {
        border-top: 1px solid var(--color-amber-border-dim);
    }
    body.vscode-light .ci-section {
        border-color: rgba(202,138,4,0.15);
        background: rgba(202,138,4,0.02);
    }
    body.vscode-light .ci-section-header:hover { background: rgba(202,138,4,0.06); }
    .cp-viewer {
        margin-bottom: var(--space-4);
        max-height: 400px;
        overflow-y: auto;
        border: 1px solid var(--color-amber-border-dim);
        border-radius: var(--radius-lg);
        background: rgba(251,191,36,0.015);
        padding: var(--space-3);
    }
    .cp-viewer::-webkit-scrollbar { width: 4px; }
    .cp-viewer::-webkit-scrollbar-track { background: transparent; }
    .cp-viewer::-webkit-scrollbar-thumb { background: rgba(251,191,36,0.25); border-radius: var(--radius-full); }
    .cp-card {
        border: 1px solid var(--color-amber-border);
        border-radius: var(--radius-md);
        background: rgba(251,191,36,0.03);
        margin-bottom: var(--space-2);
        overflow: hidden;
        transition: border-color 0.2s cubic-bezier(.4,0,.2,1);
    }
    .cp-card:last-child { margin-bottom: 0; }
    .cp-card[open] {
        border-color: rgba(251,191,36,0.35);
    }
    .cp-card-header {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        cursor: pointer;
        user-select: none;
        list-style: none;
        font-size: 0.85em;
        color: var(--color-text);
        transition: background 0.15s cubic-bezier(.4,0,.2,1);
    }
    .cp-card-header::-webkit-details-marker { display: none; }
    .cp-card-header::before {
        content: '';
        width: 0; height: 0;
        border-left: 5px solid currentColor;
        border-top: 4px solid transparent;
        border-bottom: 4px solid transparent;
        transition: transform 0.2s cubic-bezier(.4,0,.2,1);
        flex-shrink: 0;
        opacity: 0.5;
    }
    .cp-card[open] > .cp-card-header::before {
        transform: rotate(90deg);
    }
    @media (hover: hover) {
        .cp-card-header:hover { background: var(--color-amber-bg-dim); }
    }
    .cp-card-num {
        font-weight: 700;
        color: var(--color-amber);
        flex-shrink: 0;
    }
    .cp-card-chip {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: var(--radius-sm);
        font-size: 0.78em;
        white-space: nowrap;
    }
    .cp-card-chip-step {
        background: var(--color-neutral-border);
        color: var(--color-text-dim);
        border: 1px solid var(--color-muted-border);
    }
    .cp-card-chip-tok {
        background: var(--color-amber-bg);
        color: var(--color-amber-light);
        border: 1px solid var(--color-amber-border);
    }
    .cp-card-body {
        border-top: 1px solid var(--color-amber-bg);
        padding: var(--space-3);
        font-size: 0.82em;
        line-height: 1.7;
        color: var(--color-text);
        max-height: 280px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-word;
    }
    .cp-card-body::-webkit-scrollbar { width: 4px; }
    .cp-card-body::-webkit-scrollbar-track { background: transparent; }
    .cp-card-body::-webkit-scrollbar-thumb { background: rgba(251,191,36,0.3); border-radius: var(--radius-full); }
    .cp-card-body h1, .cp-card-body h2, .cp-card-body h3 {
        font-size: 1em;
        font-weight: 700;
        margin: var(--space-2) 0 var(--space-1) 0;
        color: var(--color-amber);
    }
    .cp-card-body h1:first-child, .cp-card-body h2:first-child { margin-top: 0; }
    .cp-card-body strong { color: var(--color-text); }
    .cp-card-body code {
        background: var(--color-surface-hover);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 0.9em;
    }
    body.vscode-light .cp-card {
        border-color: rgba(202,138,4,0.2);
        background: rgba(202,138,4,0.03);
    }
    body.vscode-light .cp-card[open] { border-color: rgba(202,138,4,0.4); }
    body.vscode-light .cp-card-num { color: var(--color-amber); }
    body.vscode-light .cp-card-chip-tok { background: rgba(202,138,4,0.1); color: #92400e; border-color: rgba(202,138,4,0.2); }
    body.vscode-light .cp-card-body h1, body.vscode-light .cp-card-body h2, body.vscode-light .cp-card-body h3 { color: var(--color-amber); }

    /* ─── Model DNA Cards (Context Intelligence) ─── */
    .ci-dna-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .ci-dna-chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 3px 10px;
        border-radius: 12px;
        font-size: 0.8em;
        font-family: var(--font-mono, monospace);
        background: var(--color-surface);
        border: 1px solid;
        white-space: nowrap;
        transition: background 0.12s ease, border-color 0.12s ease;
    }
    @media (hover: hover) {
        .ci-dna-chip:hover {
            background: var(--color-surface-hover);
        }
    }
    .ci-cfg-grid {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .ci-cfg-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--space-2);
        font-size: 0.88em;
    }
    .ci-cfg-label {
        font-family: var(--font-mono, monospace);
        color: var(--color-text-dim);
        font-size: 0.92em;
    }
    .ci-cfg-val {
        font-family: var(--font-mono, monospace);
        font-weight: 600;
        color: var(--color-text);
        font-variant-numeric: tabular-nums;
    }
    body.vscode-light .ci-dna-chip {
        background: var(--color-surface-dim);
    }

    /* ─── Tool Call Ranking ─── */
    .tool-rank-section {
        margin-bottom: var(--space-4);
    }
    .tool-rank-list {
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-2) var(--space-3);
        list-style: none;
        margin: 0;
    }
    .tool-rank-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: 3px 0;
        font-size: 0.82em;
        border-bottom: 1px solid var(--color-divider-subtle);
    }
    .tool-rank-row:last-child { border-bottom: none; }
    .tool-rank-idx {
        width: 18px;
        text-align: right;
        color: var(--color-text-dim);
        font-size: 0.78em;
        font-variant-numeric: tabular-nums;
        flex-shrink: 0;
        opacity: 0.6;
    }
    .tool-rank-name {
        width: 180px;
        flex-shrink: 0;
        font-family: var(--font-mono);
        font-weight: 500;
        font-size: 0.92em;
        color: var(--color-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        background: rgba(255, 255, 255, 0.04);
        padding: 1px 7px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        transition: background 0.12s ease, border-color 0.12s ease;
    }
    .tool-rank-name:hover {
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(255, 255, 255, 0.12);
    }
    .tool-rank-bar-wrap {
        flex: 1;
        min-width: 40px;
        height: 14px;
        background: var(--color-surface);
        border-radius: var(--radius-sm);
        overflow: hidden;
    }
    .tool-rank-bar {
        display: block;
        height: 100%;
        border-radius: var(--radius-sm);
        background: linear-gradient(90deg, rgba(96,165,250,0.6), rgba(96,165,250,0.3));
        transition: width 0.3s cubic-bezier(.4,0,.2,1);
        min-width: 2px;
    }
    /* Color cycling for bar rows */
    .tool-rank-row:nth-child(6n+1) .tool-rank-bar { background: linear-gradient(90deg, rgba(96,165,250,0.7), rgba(96,165,250,0.3)); }
    .tool-rank-row:nth-child(6n+2) .tool-rank-bar { background: linear-gradient(90deg, rgba(74,222,128,0.7), rgba(74,222,128,0.3)); }
    .tool-rank-row:nth-child(6n+3) .tool-rank-bar { background: linear-gradient(90deg, rgba(250,204,21,0.65), rgba(250,204,21,0.25)); }
    .tool-rank-row:nth-child(6n+4) .tool-rank-bar { background: linear-gradient(90deg, rgba(248,113,113,0.65), rgba(248,113,113,0.25)); }
    .tool-rank-row:nth-child(6n+5) .tool-rank-bar { background: linear-gradient(90deg, rgba(45,212,191,0.65), rgba(45,212,191,0.25)); }
    .tool-rank-row:nth-child(6n+6) .tool-rank-bar { background: linear-gradient(90deg, rgba(167,139,250,0.65), rgba(167,139,250,0.25)); }
    .tool-rank-count {
        width: 36px;
        text-align: right;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: var(--color-text);
        flex-shrink: 0;
    }
    .tool-rank-summary {
        display: flex;
        gap: var(--space-3);
        font-size: 0.78em;
        color: var(--color-text-dim);
        margin-top: var(--space-1);
        padding-top: var(--space-1);
        border-top: 1px solid var(--color-divider);
    }
    .tool-rank-summary b { color: var(--color-text); }
    .tool-rank-delta {
        color: var(--color-ok);
        font-size: 0.82em;
        font-weight: 500;
        margin-left: 2px;
        white-space: nowrap;
    }
    /* ── Tool Catalog Chips ── */
    .tool-cat-section {
        margin-top: var(--space-3);
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
    }
    .tool-cat-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.82em;
        color: var(--color-text-dim);
        padding: var(--space-2) var(--space-3);
        cursor: pointer;
        user-select: none;
        list-style: none;
        transition: background 0.15s ease;
    }
    .tool-cat-header::-webkit-details-marker { display: none; }
    .tool-cat-header::before {
        content: '▸';
        display: inline-block;
        font-size: 0.7em;
        transition: transform 0.2s ease;
        opacity: 0.5;
        flex-shrink: 0;
    }
    .tool-cat-section[open] > .tool-cat-header::before {
        transform: rotate(90deg);
        opacity: 0.8;
    }
    @media (hover: hover) {
        .tool-cat-header:hover { background: var(--color-surface-hover); }
    }
    .tool-cat-header svg {
        width: 13px;
        height: 13px;
        opacity: 0.6;
    }
    .tool-cat-chips {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 5px;
        padding: var(--space-2) var(--space-3);
    }
    .tool-cat-chip {
        position: relative;
        font-family: var(--font-mono);
        font-size: 0.75em;
        padding: 3px 8px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--color-border);
        color: var(--color-text);
        text-align: center;
        transition: background 0.12s ease, border-color 0.12s ease;
    }
    .tool-cat-chip-text {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .tool-cat-chip:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: var(--color-text-dim);
    }
    /* Tooltip for tool catalog chips */
    .tool-cat-chip[data-tooltip]::after {
        content: attr(data-tooltip);
        position: absolute;
        left: 50%;
        bottom: calc(100% + 6px);
        transform: translateX(-50%) scale(0.92);
        padding: var(--space-1) var(--space-2);
        background: var(--color-bg);
        color: var(--color-text);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-weight: 400;
        white-space: normal;
        word-break: break-word;
        max-width: 200px;
        width: max-content;
        text-align: center;
        z-index: var(--z-tooltip, 500);
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease, transform 0.15s ease;
    }
    .tool-cat-chip[data-tooltip]:hover::after {
        opacity: 1;
        transform: translateX(-50%) scale(1);
    }
    .tool-cat-footer {
        display: flex;
        justify-content: flex-end;
        padding: var(--space-1) var(--space-3) var(--space-2);
    }
    .tool-cat-clear-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 0.72em;
        color: var(--color-text-dim);
        background: none;
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        padding: 2px 8px;
        cursor: pointer;
        opacity: 0.5;
        transition: opacity 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .tool-cat-clear-btn:hover {
        opacity: 1;
        color: #f87171;
        border-color: rgba(248, 113, 113, 0.3);
    }

    `;
}

// ─── Section Builders ────────────────────────────────────────────────────────

function buildSummaryBar(s: ActivitySummary | null, gm: GMSummary | null, currentCascadeId?: string): string {
    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    // ── SVG icons (shared) ──
    const iconCalls = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
    const iconIn = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M5 10l7 7 7-7"/></svg>`;
    const iconOut = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V9M5 14l7-7 7 7"/></svg>`;
    const iconCache = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`;
    const iconCredits = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`;
    const iconErr = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

    // ── Helper: build error chip from GM data ──
    const buildErrorChip = (gm2: GMSummary): string => {
        const errTotal = Object.values(gm2.retryErrorCodes || {}).reduce((a, b) => a + b, 0);
        if (errTotal <= 0 && gm2.totalRetryCount <= 0) { return ''; }
        const byConv = gm2.retryErrorCodesByConv || {};
        const convCount = Object.keys(byConv).length;
        const currentConvErrs: Record<string, number> = (currentCascadeId && convCount > 1) ? (byConv[currentCascadeId] || {}) : {};
        const convDelta = Object.values(currentConvErrs).reduce((a, b) => a + b, 0);
        const errCodes = Object.entries(gm2.retryErrorCodes || {}).sort((a, b) => b[1] - a[1]).map(([c, n]) => { const d = currentConvErrs[c] || 0; return d > 0 ? `${c} ×${n} (+${d})` : `${c} ×${n}`; }).join(', ');
        const wasteInfo = gm2.totalRetryTokens > 0 ? ` | ${fmt(gm2.totalRetryTokens)} ${tBi('tokens wasted', 'token 浪费')}` : '';
        const tipText = errCodes ? `${errCodes}${wasteInfo}` : `${gm2.totalRetryCount} ${tBi('retries', '重试')}${wasteInfo}`;
        const deltaHtml = convDelta > 0 ? ` <span class="err-delta" style="font-size:0.75em">+${convDelta}</span>` : '';
        return `<div class="act-stat act-stat-warn" data-tooltip="${esc(tipText)}"><span class="act-stat-icon">${iconErr}</span><span class="act-stat-val">${errTotal > 0 ? errTotal : gm2.totalRetryCount}${deltaHtml}</span><span class="act-stat-label">${tBi('Errors', '报错')}</span></div>`;
    };

    // When no activity data, show GM-only summary
    if (!s && gm) {
        return `<div class="act-summary-bar">
            <div class="act-stat"><span class="act-stat-icon">${iconCalls}</span><span class="act-stat-val val-calls">${gm.totalCalls}</span><span class="act-stat-label">${tBi('Calls', '调用')}</span></div>
            <div class="act-stat"><span class="act-stat-icon">${iconIn}</span><span class="act-stat-val val-in">${fmt(gm.totalInputTokens)}</span><span class="act-stat-label">${tBi('In', '输入')}</span></div>
            <div class="act-stat"><span class="act-stat-icon">${iconOut}</span><span class="act-stat-val val-out">${fmt(gm.totalOutputTokens)}</span><span class="act-stat-label">${tBi('Out', '输出')}</span></div>
            ${gm.totalCacheRead > 0 ? `<div class="act-stat"><span class="act-stat-icon">${iconCache}</span><span class="act-stat-val val-cache">${fmt(gm.totalCacheRead)}</span><span class="act-stat-label">${tBi('Cache', '缓存')}</span></div>` : ''}
            ${gm.totalCredits > 0 ? `<div class="act-stat"><span class="act-stat-icon">${iconCredits}</span><span class="act-stat-val val-credits">${gm.totalCredits.toFixed(1)}</span><span class="act-stat-label">Credits</span></div>` : ''}
            ${buildErrorChip(gm)}
        </div>`;
    }

    if (!s) { return ''; }

    // GM-specific: calls chip
    let gmCallsChip = '';
    if (gm && gm.totalCalls > 0) {
        gmCallsChip = `<div class="act-stat" data-tooltip="${tBi('Total LLM API calls', 'LLM API 调用总次数')}"><span class="act-stat-icon">${iconCalls}</span><span class="act-stat-val val-calls">${gm.totalCalls}</span><span class="act-stat-label">${tBi('Calls', '调用')}</span></div>`;
    }

    // GM vs CHECKPOINT token selection
    const hasGM = (s.gmTotalInputTokens || 0) > 0;
    const inTokens = hasGM ? s.gmTotalInputTokens! : s.totalInputTokens;
    const outTokens = hasGM ? s.gmTotalOutputTokens! : s.totalOutputTokens;
    const inTooltip = hasGM
        ? tBi('Input tokens (all conversations)', '输入 token（全部对话）')
        : tBi('Cumulative input tokens consumed', '累计消耗的输入 token 数');
    const outTooltip = hasGM
        ? tBi('Output tokens (all conversations)', '输出 token（全部对话）')
        : tBi('Cumulative output tokens generated', '累计生成的输出 token 数');

    // Cache chip
    const cacheTokens = s.gmTotalCacheRead || 0;
    const cacheChip = cacheTokens > 0 ? `<div class="act-stat" data-tooltip="${tBi('Cache read tokens', '缓存读取 token')}"><span class="act-stat-icon">${iconCache}</span><span class="act-stat-val val-cache">${fmt(cacheTokens)}</span><span class="act-stat-label">${tBi('Cache', '缓存')}</span></div>` : '';

    // Credits chip
    const credits = s.gmTotalCredits || 0;
    const creditsChip = credits > 0 ? `<div class="act-stat" data-tooltip="${tBi('Credits consumed', '消耗的积分')}"><span class="act-stat-icon">${iconCredits}</span><span class="act-stat-val val-credits">${credits.toFixed(1)}</span><span class="act-stat-label">${tBi('Credits', '积分')}</span></div>` : '';

    // Tool output chip
    const toolOutChip = s.totalToolReturnTokens > 0 ? `<div class="act-stat" data-tooltip="${tBi('Tokens returned by tool calls', '工具调用返回的 token 数')}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 0 1 0 8h-1"/></svg></span><span class="act-stat-val">${fmt(s.totalToolReturnTokens)}</span><span class="act-stat-label">${tBi('Tool Out', '工具输出')}</span></div>` : '';

    return `
    <div class="act-summary-bar">
        ${gmCallsChip}
        <div class="act-stat" data-tooltip="${inTooltip}"><span class="act-stat-icon">${iconIn}</span><span class="act-stat-val val-in">${fmt(inTokens)}</span><span class="act-stat-label">${tBi('In', '输入')}</span></div>
        <div class="act-stat" data-tooltip="${outTooltip}"><span class="act-stat-icon">${iconOut}</span><span class="act-stat-val val-out">${fmt(outTokens)}</span><span class="act-stat-label">${tBi('Out', '输出')}</span></div>
        ${toolOutChip}
        ${cacheChip}
        ${creditsChip}
        ${gm ? buildErrorChip(gm) : ''}
    </div>`;
}



function buildModelCards(s: ActivitySummary | null, gm: GMSummary | null, activeEmail = ''): string {
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
    // Prefer full GMSummary.modelBreakdown (has responseModel/provider/streaming)
    // Fall back to ActivitySummary.gmModelBreakdown (simpler subset)
    const gmBreakEarly: Record<string, GMModelStats> | null = gm?.modelBreakdown ?? s?.gmModelBreakdown ?? null;
    // Filter: only show models that have GM data — Step API step counts are outdated/unreliable
    const entries = gmBreakEarly
        ? actEntries.filter(([name]) => {
            const gmStats = gmBreakEarly[name];
            return gmStats && gmStats.callCount > 0;
        })
        : actEntries;
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

    // ── Build per-account call counts + error counts for each model + cross-account totals ──
    // Map<modelDisplayName, Map<accountEmail, callCount>>
    const accountCallsByModel = new Map<string, Map<string, number>>();
    // Map<modelDisplayName, Map<accountEmail, errorCount>>
    const accountErrorsByModel = new Map<string, Map<string, number>>();
    let allAccountTotalCalls = 0;
    let allAccountTotalIn = 0;
    let allAccountTotalOut = 0;
    let allAccountTotalCache = 0;
    let allAccountTotalCost = 0;
    let hasAnyAccountErrors = false;
    if (gm) {
        for (const conv of gm.conversations) {
            for (const call of conv.calls) {
                // Accumulate cross-account totals from raw calls
                allAccountTotalCalls++;
                allAccountTotalIn += call.inputTokens || 0;
                allAccountTotalOut += call.outputTokens || 0;
                allAccountTotalCache += call.cacheReadTokens || 0;
                // Per-call cost for cross-account active total
                {
                    const pr = findPricing(call.responseModel) || findPricing(call.modelDisplay || call.model);
                    if (pr) {
                        const respOut = Math.max(0, (call.outputTokens || 0) - (call.thinkingTokens || 0));
                        allAccountTotalCost += (
                            (call.inputTokens || 0) * pr.input +
                            respOut * pr.output +
                            (call.cacheReadTokens || 0) * pr.cacheRead +
                            (call.thinkingTokens || 0) * pr.thinking
                        ) / 1_000_000;
                    }
                }

                const email = call.accountEmail || '';
                if (!email) { continue; }
                const modelName = normalizeModelDisplayName(call.modelDisplay || call.model) || call.modelDisplay || call.model;
                if (!modelName) { continue; }

                // Call counts
                let byAccount = accountCallsByModel.get(modelName);
                if (!byAccount) {
                    byAccount = new Map<string, number>();
                    accountCallsByModel.set(modelName, byAccount);
                }
                byAccount.set(email, (byAccount.get(email) || 0) + 1);

                // Error counts (per-model per-account)
                const callErrors = call.retryErrors.length
                    + ((call.hasError && call.errorMessage && call.retryErrors.length === 0) ? 1 : 0);
                if (callErrors > 0) {
                    hasAnyAccountErrors = true;
                    let errByAccount = accountErrorsByModel.get(modelName);
                    if (!errByAccount) {
                        errByAccount = new Map<string, number>();
                        accountErrorsByModel.set(modelName, errByAccount);
                    }
                    errByAccount.set(email, (errByAccount.get(email) || 0) + callErrors);
                }
            }
        }
    }
    const userSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    /** Build account breakdown section inside card body (divider + per-account rows, active highlighted, with optional error counts) */
    const buildAccountSection = (modelName: string): string => {
        const byAccount = accountCallsByModel.get(modelName);
        if (!byAccount || byAccount.size < 1) { return ''; }
        const errByAccount = accountErrorsByModel.get(modelName);
        const sorted = [...byAccount.entries()].sort((a, b) => {
            // Active account always first
            if (activeEmail) {
                if (a[0] === activeEmail) { return -1; }
                if (b[0] === activeEmail) { return 1; }
            }
            return b[1] - a[1];
        });
        const rows = sorted
            .map(([email, count]) => {
                const prefix = email.split('@')[0];
                const isActive = activeEmail && email === activeEmail;
                const cls = isActive ? ' gm-account-active' : '';
                const errCount = errByAccount?.get(email) || 0;
                const errHtml = errCount > 0
                    ? `<span class="gm-account-err">+${errCount}</span>`
                    : '';
                return `<div class="gm-account-row${cls}"><span class="gm-account-label">${userSvg} ${esc(prefix)}</span><span class="gm-account-count">${count}${errHtml}</span></div>`;
            })
            .join('');
        return `<div class="act-card-divider"></div><div class="gm-account-section">${rows}</div>`;
    };

    // Error toggle button (only shown when any account has errors)
    const errToggleSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    const errToggleBtn = hasAnyAccountErrors
        ? `<span class="model-stats-err-toggle is-off" id="modelStatsErrToggle" title="${tBi('Toggle error count visibility', '切换报错次数显示')}">${errToggleSvg} ${tBi('Errors', '报错')}</span>`
        : '';
    let html = `<h2 class="act-section-title"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>${tBi('Model Stats', '模型统计')}${errToggleBtn}</h2>`;



    html += `<div class="act-cards-grid">`;
    const gmBreak = gmBreakEarly;
    const fmtSec = (n: number) => n <= 0 ? '-' : n < 1 ? `${(n * 1000).toFixed(0)}ms` : `${n.toFixed(2)}s`;
    for (const [name, ms] of entries) {
        const isCheckpointOnly = ms.reasoning === 0 && ms.toolCalls === 0 && ms.checkpoints > 0 && ms.estSteps === 0;

        // GM per-model precision data (prefer full GMModelStats when available)
        let gmSection = '';
        let gmFooterTags = '';
        if (gmBreak) {
            const gmStats = gmBreak[name];
            if (gmStats && gmStats.callCount > 0) {
                gmSection = `
                <div class="act-card-divider"></div>
                <div class="act-card-row"><span>${ICONS.tool} <span>${tBi('Calls', '调用')}</span></span><span class="val val-calls">${gmStats.callCount}</span></div>
                <div class="act-card-row"><span>${ICONS.clock} <span>${tBi('Avg TTFT', '平均 TTFT')}</span></span><span class="val val-time">${fmtSec(gmStats.avgTTFT)}</span></div>
                ${'avgStreaming' in gmStats && gmStats.avgStreaming > 0 ? `<div class="act-card-row"><span>${ICONS.sum} <span>${tBi('Avg Stream', '平均流速')}</span></span><span class="val val-time">${fmtSec(gmStats.avgStreaming)}</span></div>` : ''}
                <div class="act-card-row"><span>${ICONS.coin} <span>${tBi('In', '输入')}</span></span><span class="val val-in">${fmt(gmStats.totalInputTokens)}</span></div>
                <div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Out', '输出')}</span></span><span class="val val-out">${fmt(gmStats.totalOutputTokens)}</span></div>
                ${'totalThinkingTokens' in gmStats && gmStats.totalThinkingTokens > 0 ? `<div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Think', '思考')}</span></span><span class="val val-out">${fmt(gmStats.totalThinkingTokens)}</span></div>` : ''}
                ${gmStats.totalCacheRead > 0 ? `<div class="act-card-row"><span>${ICONS.save} <span>${tBi('Cache', '缓存')}</span></span><span class="val val-cache">${fmt(gmStats.totalCacheRead)}</span></div>` : ''}
                ${gmStats.totalCredits > 0 ? `<div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Credits', '积分')}</span></span><span class="val val-credits">${gmStats.totalCredits.toFixed(1)} <span class="act-credit-calls">(${gmStats.creditCallCount || 0}${tBi('x', '次')})</span></span></div>` : ''}
                ${(() => { const pr = findPricing(gmStats.responseModel) || findPricing(name); if (!pr) { return ''; } const cost = (gmStats.totalInputTokens * pr.input + gmStats.totalOutputTokens * pr.output + gmStats.totalCacheRead * pr.cacheRead + gmStats.totalThinkingTokens * pr.thinking) / 1_000_000; if (cost <= 0) { return ''; } const costStr = cost < 0.01 ? cost.toFixed(4) : cost < 1 ? cost.toFixed(3) : cost.toFixed(2); return `<div class="act-card-row act-card-row-cost"><span>${ICONS.coin} <span>${tBi('Cost', '费用')}</span></span><span class="val val-cost">$${costStr}</span></div>`; })()}
                ${gmStats.cacheHitRate > 0 ? `<div class="act-card-row"><span>${ICONS.bar} <span>${tBi('Cache Hit', '缓存命中')}</span></span><span class="val val-hit">${(gmStats.cacheHitRate * 100).toFixed(0)}%</span></div>` : ''}
                `;
                // responseModel footer removed — card header already shows normalized model name
            }
        }

        html += `
        <div class="act-model-card${isCheckpointOnly ? ' act-checkpoint-model' : ''}">
            <div class="act-card-header">${esc(normalizeModelDisplayName(name))}${isCheckpointOnly ? ` <span class="act-badge">${ICONS.save}</span>` : ''}</div>
            <div class="act-card-body">
                ${gmSection}
                ${buildAccountSection(name)}
            </div>
            ${gmFooterTags ? `<div class="act-card-footer">${gmFooterTags}</div>` : ''}
        </div>`;
    }
    // GM-only models: models in GM data but not in Activity modelStats
    for (const [name, gms] of gmOnlyEntries) {
        const providerShort = gms.apiProvider ? gms.apiProvider.replace('API_PROVIDER_', '').replace(/_/g, ' ') : '';
        html += `
        <div class="act-model-card">
            <div class="act-card-header">${esc(normalizeModelDisplayName(name))}</div>
            <div class="act-card-body">
                <div class="act-card-row"><span>${ICONS.bar} <span>${tBi('Steps', '步骤')}</span></span><span class="val val-calls">${gms.stepsCovered}</span></div>
                <div class="act-card-row"><span>${ICONS.clock} <span>${tBi('Avg TTFT', '平均 TTFT')}</span></span><span class="val val-time">${fmtSec(gms.avgTTFT)}</span></div>
                ${'avgStreaming' in gms && gms.avgStreaming > 0 ? `<div class="act-card-row"><span>${ICONS.sum} <span>${tBi('Avg Stream', '平均流速')}</span></span><span class="val val-time">${fmtSec(gms.avgStreaming)}</span></div>` : ''}
                <div class="act-card-divider"></div>
                <div class="act-card-row"><span>${ICONS.coin} <span>${tBi('In', '输入')}</span></span><span class="val val-in">${fmt(gms.totalInputTokens)}</span></div>
                <div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Out', '输出')}</span></span><span class="val val-out">${fmt(gms.totalOutputTokens)}</span></div>
                ${'totalThinkingTokens' in gms && gms.totalThinkingTokens > 0 ? `<div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Think', '思考')}</span></span><span class="val val-out">${fmt(gms.totalThinkingTokens)}</span></div>` : ''}
                ${gms.totalCacheRead > 0 ? `<div class="act-card-row"><span>${ICONS.save} <span>${tBi('Cache', '缓存')}</span></span><span class="val val-cache">${fmt(gms.totalCacheRead)}</span></div>` : ''}
                ${gms.totalCredits > 0 ? `<div class="act-card-row"><span>${ICONS.coin} <span>${tBi('Credits', '积分')}</span></span><span class="val val-credits">${gms.totalCredits.toFixed(1)} <span class="act-credit-calls">(${gms.creditCallCount || 0}${tBi('x', '次')})</span></span></div>` : ''}
                ${(() => { const pr = findPricing(gms.responseModel) || findPricing(name); if (!pr) { return ''; } const cost = (gms.totalInputTokens * pr.input + gms.totalOutputTokens * pr.output + gms.totalCacheRead * pr.cacheRead + gms.totalThinkingTokens * pr.thinking) / 1_000_000; if (cost <= 0) { return ''; } const costStr = cost < 0.01 ? cost.toFixed(4) : cost < 1 ? cost.toFixed(3) : cost.toFixed(2); return `<div class="act-card-row act-card-row-cost"><span>${ICONS.coin} <span>${tBi('Cost', '费用')}</span></span><span class="val val-cost">$${costStr}</span></div>`; })()}
                ${gms.cacheHitRate > 0 ? `<div class="act-card-row"><span>${ICONS.bar} <span>${tBi('Cache Hit', '缓存命中')}</span></span><span class="val val-hit">${(gms.cacheHitRate * 100).toFixed(0)}%</span></div>` : ''}
                ${buildAccountSection(name)}
            </div>
            <div class="act-card-footer">
                <span class="act-tool-tag">${tBi('Cache', '缓存')} ${(gms.cacheHitRate * 100).toFixed(0)}%</span>
            </div>
        </div>`;
    }
    html += `</div>`;

    // ── Totals summary row below cards grid (uses cross-account totals) ──
    if (allAccountTotalCalls > 0) {
        const totalModels = accountCallsByModel.size;
        const sigmaSvg = `<svg class="mst-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 4 8 4 14 12 8 20 18 20"/></svg>`;
        const items: string[] = [];
        items.push(`<span class="mst-item"><span class="mst-val">${allAccountTotalCalls}</span> ${tBi('calls', '调用')}</span>`);
        items.push(`<span class="mst-item"><span class="mst-val">${totalModels}</span> ${tBi('models', '模型')}</span>`);
        items.push(`<span class="mst-item"><span class="mst-val">${fmt(allAccountTotalIn)}</span> ${tBi('in', '输入')}</span>`);
        items.push(`<span class="mst-item"><span class="mst-val">${fmt(allAccountTotalOut)}</span> ${tBi('out', '输出')}</span>`);
        if (allAccountTotalCache > 0) {
            items.push(`<span class="mst-item"><span class="mst-val">${fmt(allAccountTotalCache)}</span> ${tBi('cache', '缓存')}</span>`);
        }
        if (allAccountTotalCost > 0) {
            const costStr = allAccountTotalCost < 0.01 ? allAccountTotalCost.toFixed(4) : allAccountTotalCost < 1 ? allAccountTotalCost.toFixed(3) : allAccountTotalCost.toFixed(2);
            items.push(`<span class="mst-item mst-item-cost"><span class="mst-val">$${costStr}</span> ${tBi('cost', '费用')}</span>`);
        }
        html += `<div class="model-stats-total">${sigmaSvg}<span class="mst-label">${tBi('Total', '合计')}</span><span class="mst-items">${items.join('')}</span></div>`;
    }

    return html;
}

function buildTimeline(s: ActivitySummary, currentUsage?: ContextUsage | null, gm?: GMSummary | null): string {
    const currentCascadeId = currentUsage?.cascadeId;
    const scopedEvents = currentCascadeId
        ? s.recentSteps.filter(event => event.cascadeId === currentCascadeId)
        : s.recentSteps;
    const orderedEvents = [...scopedEvents];
    if (orderedEvents.length === 0) {
        if (!currentCascadeId) { return ''; }
        return `<h2 class="act-section-title"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${tBi('Recent Activity', '最近操作')}</h2><p class="empty-msg">${tBi('No recent activity for the current conversation yet.', '当前对话暂时还没有可显示的最近操作。')}</p>`;
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
        // system events (checkpoint, context injection)
        if (e.category === 'system') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`;
        // fallback system icons
        return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    };

    const buildMetaTags = (_e: any) => {
        // Model name already displayed in event row via act-tl-model (line ~2186).
        // No additional meta tags needed.
        return '';
    };

    // Resolve current conversation title from GM data
    let sessionTitle = '';
    if (currentCascadeId && gm) {
        const conv = gm.conversations.find(c => c.cascadeId === currentCascadeId);
        if (conv && conv.title) { sessionTitle = conv.title; }
    }
    const titleText = sessionTitle || (currentCascadeId ? currentCascadeId.substring(0, 8) : '');

    const scopeBadge = currentCascadeId && titleText
        ? ` <span class="act-badge" title="${esc(currentCascadeId)}">${esc(titleText)}</span>`
        : '';

    // Build compact help tooltip (replaces old collapsible legend)
    const helpPopup = `<div class="act-tl-help-wrap">
        <span class="act-tl-help-btn">?</span>
        <div class="act-tl-help-popup">
            <div class="act-tl-help-group-label">${tBi('Step Basics', '步骤基础')}</div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-time" style="display:inline">08:20</span></div><div class="act-tl-help-desc">${tBi('Timestamp', '步骤时间')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-step-idx" style="display:inline">#115</span></div><div class="act-tl-help-desc">${tBi('Step index', '步骤索引')}</div></div>
            <div class="act-tl-help-divider"></div>
            <div class="act-tl-help-group-label">${tBi('Token Metrics', 'Token 指标')}</div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-cache" style="display:inline">176k ${tBi('cache', '缓存')}</span></div><div class="act-tl-help-desc">${tBi('Cache read', '缓存读取')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-in" style="display:inline">1.3k ${tBi('in', '输入')}</span></div><div class="act-tl-help-desc">${tBi('Input tokens', '输入 token')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-out" style="display:inline">117 ${tBi('out', '输出')}</span></div><div class="act-tl-help-desc">${tBi('Output tokens', '输出 token')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-ctx" style="display:inline">${tBi('Ctx 142k', '上下文 142k')}</span></div><div class="act-tl-help-desc">${tBi('Context window size', '上下文窗口大小')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-credit" style="display:inline">9 ${tBi('credits', '积分')}</span></div><div class="act-tl-help-desc">${tBi('Credits', '积分')}</div></div>
            <div class="act-tl-help-divider"></div>
            <div class="act-tl-help-group-label">${tBi('Performance', '性能')}</div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-ttft" style="display:inline">TTFT 2.1s</span></div><div class="act-tl-help-desc">${tBi('Time to first token', '首 token 延迟')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-dur" style="display:inline">538ms</span></div><div class="act-tl-help-desc">${tBi('Duration', '耗时')}</div></div>
        </div>
    </div>`;

    // Build inline checkpoint viewer (from GM data for current conversation)
    let checkpointHtml = '';
    if (gm && gm.totalCalls > 0) {
        checkpointHtml = buildContextIntelViewer(gm);
    }

    let html = `<h2 class="act-section-title" style="display:flex;align-items:center;gap:var(--space-2)"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${tBi('Recent Activity', '最近操作')}${scopeBadge}${helpPopup}</h2>
    ${checkpointHtml}
    <div class="act-timeline">`;

    const renderEventRow = (e: any, extraClass = '') => {
        const time = formatTime(e.timestamp);
        const dur = e.durationMs > 0 ? `<span class="act-tl-dur">${e.durationMs < 1000 ? e.durationMs + 'ms' : (e.durationMs / 1000).toFixed(1) + 's'}</span>` : '';
        let detail = '';
        // For detail text, strip "→ tool_names" suffix — tools are shown as right-aligned chips
        const detailText = e.detail ? e.detail.replace(/\s*→\s*.+$/, '').trim() : '';
        if (e.userInput) { detail = `<span class="act-tl-user">"${esc(e.userInput.replace(/\s*\n\s*/g, ' '))}"</span>`; }
        else if (e.toolName && detailText) {
            detail = `<span class="act-tl-tool-name">${esc(e.toolName)}</span><span class="act-tl-detail">${esc(detailText)}</span>`;
        }
        else if (e.toolName) {
            detail = `<span class="act-tl-tool-name">${esc(e.toolName)}</span>`;
        }
        else if (e.aiResponse) {
            detail = `<span class="act-tl-ai-preview">${esc(e.aiResponse)}</span>`;
        }
        else if (detailText) { detail = `<span class="act-tl-detail">${esc(detailText)}</span>`; }

        const stepIdx = e.stepIndex !== undefined ? `<span class="act-tl-step-idx">#${e.stepIndex}</span>` : '';
        const svgIcon = getTimelineIcon(e);
        const metaTags = buildMetaTags(e);

        // GM precision data tags — only show on reasoning steps (tools share the same GM call)
        let gmTags = '';
        if (e.category === 'reasoning' && e.gmInputTokens !== undefined) {
            // Fixed token metrics (always present when GM data exists)
            const costSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
            const tokenParts: string[] = [];
            // 1. Per-call cost (leftmost in token section)
            if (e.gmModel) {
                const pricing = findPricing(e.gmModel);
                if (pricing) {
                    const respOut = Math.max(0, (e.gmOutputTokens || 0) - (e.gmThinkingTokens || 0));
                    const callCost = (
                        (e.gmInputTokens || 0) * pricing.input +
                        respOut * pricing.output +
                        (e.gmCacheReadTokens || 0) * pricing.cacheRead +
                        (e.gmThinkingTokens || 0) * pricing.thinking
                    ) / 1_000_000;
                    if (callCost > 0) {
                        const costStr = callCost < 0.001 ? callCost.toFixed(4) : callCost < 0.01 ? callCost.toFixed(3) : callCost.toFixed(2);
                        tokenParts.push(`<span class="act-tl-gm-tag act-tl-gm-cost">${costSvg}$${costStr}</span>`);
                    }
                }
            }
            // 2. Cache read tokens
            if (e.gmCacheReadTokens && e.gmCacheReadTokens > 0) { tokenParts.push(`<span class="act-tl-gm-tag act-tl-gm-cache">${fmtTok(e.gmCacheReadTokens)} ${tBi('cache', '缓存')}</span>`); }
            // 3. Input tokens
            tokenParts.push(`<span class="act-tl-gm-tag act-tl-gm-in">${fmtTok(e.gmInputTokens)} ${tBi('in', '输入')}</span>`);
            // 4. Output tokens
            if (e.gmOutputTokens) { tokenParts.push(`<span class="act-tl-gm-tag act-tl-gm-out">${fmtTok(e.gmOutputTokens)} ${tBi('out', '输出')}</span>`); }
            // 5. Context window (rightmost anchor)
            if (e.gmContextTokensUsed) { tokenParts.push(`<span class="act-tl-gm-tag act-tl-gm-ctx">${tBi('Ctx', '上下文')} ${fmtTok(e.gmContextTokensUsed)}</span>`); }

            const statusParts: string[] = [];
            // Order from right→left: duration, TTFT, tools, credits, error
            // 1. Error indicator (leftmost)
            if (e.gmRetries && e.gmRetries > 0) {
                statusParts.push(`<span class="act-tl-gm-tag act-tl-gm-retry">error(${e.gmRetries})</span>`);
            }
            // 2. Credits
            if (e.gmCredits && e.gmCredits > 0) {
                statusParts.push(`<span class="act-tl-gm-tag act-tl-gm-credit">${e.gmCredits} ${tBi('credits', '积分')}</span>`);
            }
            // 3. Tools
            if (e.detail) {
                const toolMatch = e.detail.match(/\u2192\s*(\d+)\s*/);
                if (toolMatch) {
                    const count = parseInt(toolMatch[1], 10);
                    if (count > 0) {
                        statusParts.push(`<span class="act-tl-gm-tag act-tl-gm-tool"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>${count} ${tBi(count === 1 ? 'tool' : 'tools', '工具')}</span>`);
                    }
                }
            }
            // 4. TTFT
            if (e.gmTTFT && e.gmTTFT > 0) { statusParts.push(`<span class="act-tl-gm-tag act-tl-gm-ttft">TTFT ${e.gmTTFT.toFixed(1)}s</span>`); }
            // 5. Duration (rightmost, closest to tokenParts)
            if (e.durationMs > 0) {
                statusParts.push(`<span class="act-tl-dur">${e.durationMs < 1000 ? e.durationMs + 'ms' : (e.durationMs / 1000).toFixed(1) + 's'}</span>`);
            }

            const statusHtml = statusParts.length > 0
                ? `<span class="act-tl-gm-status">${statusParts.join('')}</span>`
                : '';
            gmTags = `${statusHtml}<span class="act-tl-gm">${tokenParts.join('')}</span>`;
        }



        return `
        <div class="act-tl-item act-tl-${e.category}${extraClass ? ` ${extraClass}` : ''}">
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
                ${!gmTags ? dur : ''}
            </span>
        </div>`;
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

    // Helper: aggregate GM stats from a segment's actions
    const buildSegmentStats = (actions: any[]) => {
        let totalIn = 0, totalOut = 0, totalThinking = 0, totalCache = 0, totalCredits = 0, totalCost = 0;
        let toolCount = 0, reasoningCount = 0;
        let model = '';
        const models = new Set<string>();
        let gmToolTotal = 0;
        let retryTotal = 0;
        let lastContextTokens = 0;
        for (const a of actions) {
            if (a.category === 'tool') { toolCount++; }
            if (a.category === 'reasoning') {
                reasoningCount++;
                if (a.gmInputTokens) { totalIn += a.gmInputTokens; }
                if (a.gmOutputTokens) { totalOut += a.gmOutputTokens; }
                if (a.gmThinkingTokens) { totalThinking += a.gmThinkingTokens; }
                if (a.gmCacheReadTokens) { totalCache += a.gmCacheReadTokens; }
                if (a.gmCredits) { totalCredits += a.gmCredits; }
                // Per-call cost accumulation
                if (a.gmModel) {
                    const pricing = findPricing(a.gmModel);
                    if (pricing) {
                        const respOut = Math.max(0, (a.gmOutputTokens || 0) - (a.gmThinkingTokens || 0));
                        totalCost += (
                            (a.gmInputTokens || 0) * pricing.input +
                            respOut * pricing.output +
                            (a.gmCacheReadTokens || 0) * pricing.cacheRead +
                            (a.gmThinkingTokens || 0) * pricing.thinking
                        ) / 1_000_000;
                    }
                }
                if (a.gmRetries && a.gmRetries > 0) {
                    retryTotal += a.gmRetries;
                }
                // Track the latest context window size (last reasoning event wins)
                if (a.gmContextTokensUsed && a.gmContextTokensUsed > 0) {
                    lastContextTokens = a.gmContextTokensUsed;
                }
            }
            // Collect tool counts from detail's → suffix (e.g. "→ 1 tool")
            if (a.detail) {
                const m = a.detail.match(/\u2192\s*(\d+)\s*/);
                if (m) {
                    gmToolTotal += parseInt(m[1], 10);
                }
            }
            if (a.model) { models.add(a.model); }
            if (a.gmModel) { models.add(a.gmModel); }
        }
        // Pick the most specific model name
        if (models.size === 1) { model = [...models][0]; }
        else if (models.size > 1) { model = [...models].filter(m => !m.startsWith('MODEL_PLACEHOLDER')).pop() || [...models][0]; }
        const toolNames = gmToolTotal;
        return { totalIn, totalOut, totalThinking, totalCache, totalCredits, totalCost, toolCount, reasoningCount, model, toolNames, retryTotal, lastContextTokens };
    };

    const reversedSegments = [...segments].reverse();
    for (let si = 0; si < reversedSegments.length; si++) {
        const segment = reversedSegments[si];
        const isLatest = si === 0;
        const stats = buildSegmentStats(segment.actions);

        // Build summary chips for the segment header
        // Right-aligned: rightmost = most stable, leftmost = rare
        // Visual order (left → right): error | tools | credits | calls | in/out | ctx | cache
        const chips: string[] = [];
        // 1. Errors — rare (leftmost)
        if (stats.retryTotal > 0) {
            chips.push(`<span class="seg-chip seg-chip-retry">error(${stats.retryTotal})</span>`);
        }
        // 2. Credits — occasional
        if (stats.totalCredits > 0) {
            chips.push(`<span class="seg-chip seg-chip-credits">${stats.totalCredits.toFixed(1)} ${tBi('credits', '积分')}</span>`);
        }
        // 3. Tool calls — occasional
        if (stats.toolNames > 0) {
            chips.push(`<span class="seg-chip seg-chip-tools"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>${stats.toolNames} ${tBi('tools', '工具')}</span>`);
        } else if (stats.toolCount > 0) {
            chips.push(`<span class="seg-chip seg-chip-tools"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>${stats.toolCount}</span>`);
        }
        // 4. Call count — almost always
        if (stats.reasoningCount > 0) { chips.push(`<span class="seg-chip seg-chip-calls">${stats.reasoningCount} ${tBi('calls', '调用')}</span>`); }
        // 5. Cost — almost always (when pricing data exists)
        if (stats.totalCost > 0) {
            const costStr = stats.totalCost < 0.01 ? stats.totalCost.toFixed(3) : stats.totalCost.toFixed(2);
            chips.push(`<span class="seg-chip seg-chip-cost">$${costStr}</span>`);
        }
        // 6. Cache read tokens — almost always
        if (stats.totalCache > 0) {
            chips.push(`<span class="seg-chip seg-chip-cache">${fmtTok(stats.totalCache)} ${tBi('cache', '缓存')}</span>`);
        }
        // 6. Input / Output tokens — almost always
        if (stats.totalIn > 0 || stats.totalOut > 0) {
            chips.push(`<span class="seg-chip seg-chip-tok">${fmtTok(stats.totalIn)} ${tBi('in', '输入')} / ${fmtTok(stats.totalOut)} ${tBi('out', '输出')}</span>`);
        }
        // 7. Context window size — rightmost anchor
        if (stats.lastContextTokens > 0) {
            chips.push(`<span class="seg-chip seg-chip-ctx">${tBi('Ctx', '上下文')} ${fmtTok(stats.lastContextTokens)}</span>`);
        }
        const chipsHtml = chips.length > 0 ? `<span class="seg-chips">${chips.join('')}</span>` : '';

        // Turn number label for the segment header (1-indexed, chronological order)
        const turnNumber = segments.length - si;
        const turnLabel = segment.user
            ? `${tBi('Turn', '第')} ${turnNumber}${tBi('', ' 轮')}`
            : tBi('AI actions (no user anchor)', 'AI 动作（缺少用户锚点）');

        html += `<details class="act-tl-turn" id="turn-${si}"${isLatest ? ' open' : ''}>`;
        html += `<summary class="act-tl-turn-header">`;
        if (segment.user) {
            html += `<span class="act-tl-turn-icon"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>`;
        } else {
            html += `<span class="act-tl-turn-icon"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z"/><path d="M9 17h6M10 21h4"/></svg></span>`;
        }
        html += `<span class="act-tl-turn-text">${turnLabel}</span>`;
        html += chipsHtml;
        html += `</summary>`;

        // Segment body: actions first (newest at top), user anchor at bottom
        html += `<div class="act-tl-segment-body">`;
        for (const action of [...segment.actions].reverse()) {
            html += renderEventRow(action);
        }
        if (segment.user) {
            html += renderEventRow(segment.user, 'act-tl-segment-user');
        }
        html += `</div>`;
        html += `</details>`;
    }
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
    return `<h2 class="act-section-title">${tBi('Context Growth', '上下文增长')} <span class="act-badge">${tBi('Per-Call', '每次调用')}</span></h2><div class="act-trend-container"><svg class="act-trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="gmTrendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f97316" stop-opacity="0.5"/><stop offset="100%" stop-color="#f97316" stop-opacity="0.1"/></linearGradient></defs><polygon points="${areaPoints}" fill="url(#gmTrendFill)"/><polyline points="${points}" fill="none" stroke="#fb923c" stroke-width="2" stroke-linejoin="round"/></svg><div class="act-trend-labels"><span>${fmt(data[0].tokens)}</span><span>${data.length} ${tBi('calls', '调用')}</span><span>${fmt(data[data.length - 1].tokens)}</span></div></div>`;
}

function buildConversations(s: GMSummary): string {
    const convs = s.conversations.filter(c => c.calls.length > 0);
    if (convs.length === 0) { return ''; }

    // Date formatting helper: compact date/time
    const fmtDate = (iso: string): string => {
        if (!iso) { return ''; }
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) { return ''; }
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch { return ''; }
    };

    const iconClock = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const iconCalls = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

    let html = `<h2 class="act-section-title">${tBi('Conversations', '对话分布')}</h2><div class="act-conv-list">`;
    for (const c of convs) {
        let totalCredits = 0;
        let earliest = '';
        let latest = '';
        for (const call of c.calls) {
            totalCredits += call.credits;
            if (call.createdAt && (!earliest || call.createdAt < earliest)) { earliest = call.createdAt; }
            if (call.createdAt && (!latest || call.createdAt > latest)) { latest = call.createdAt; }
        }
        const displayName = c.title || c.cascadeId.substring(0, 8);
        const startStr = fmtDate(earliest);
        const lastStr = fmtDate(latest);
        const dateChip = startStr
            ? `<span class="act-conv-meta-chip act-conv-date">${iconClock} ${startStr}${lastStr && lastStr !== startStr ? ` → ${lastStr}` : ''}</span>`
            : '';
        const acctCredits = c.accountCredits ?? 0;
        const creditsChip = totalCredits > 0
            ? `<span class="act-conv-meta-chip act-conv-credits"><b>${totalCredits}</b> ${tBi('credits', '积分')}${acctCredits > 0 && acctCredits < totalCredits ? ` <span class="act-credit-calls">+${acctCredits}</span>` : ''}</span>`
            : '';

        html += `<div class="act-conv-item" title="${esc(c.cascadeId)}">
            <span class="act-conv-title-chip">${esc(displayName)}</span>
            <div class="act-conv-meta">
                <span class="act-conv-meta-chip">${iconCalls} <b>${c.calls.length}</b></span>
                ${creditsChip}
                ${dateChip}
            </div>
        </div>`;
    }
    html += `</div>`;
    return html;
}

// ─── Tool Call Ranking Section ──────────────────────────────────────────────

function buildToolCallRanking(gm: GMSummary, currentCascadeId?: string): string {
    const counts = gm.toolCallCounts || {};
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) { return ''; }

    const totalInvocations = entries.reduce((sum, [, c]) => sum + c, 0);
    const maxCount = entries[0][1];

    // ── Current conversation's tool call contribution (from pre-computed, archival-immune data) ──
    const byConv = gm.toolCallCountsByConv || {};
    const convCount = Object.keys(byConv).length;
    const currentConvCounts: Record<string, number> = (currentCascadeId && convCount > 1)
        ? (byConv[currentCascadeId] || {})
        : {};

    const wrenchIcon = `<svg class="act-icon" viewBox="0 0 16 16"><path fill="currentColor" d="M12.7 3.3a1 1 0 0 1 0 1.4l-1.2 1.2 1.5 1.5a1 1 0 0 1-.7 1.7H10a1 1 0 0 1-1-1V5.8a1 1 0 0 1 1.7-.7l1.5 1.5 1.2-1.2a1 1 0 0 1 1.3-.1zM4.5 2A2.5 2.5 0 0 0 2 4.5v7A2.5 2.5 0 0 0 4.5 14h7a2.5 2.5 0 0 0 2.5-2.5V10h-1v1.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 11.5v-7A1.5 1.5 0 0 1 4.5 3H6V2H4.5z"/></svg>`;

    const rows = entries.map(([name, count], i) => {
        const pct = maxCount > 0 ? (count / maxCount * 100).toFixed(1) : '0';
        const delta = currentConvCounts[name] || 0;
        const deltaHtml = delta > 0
            ? `<span class="tool-rank-delta">+${delta}</span>`
            : '';
        return `<li class="tool-rank-row">
            <span class="tool-rank-idx">${i + 1}</span>
            <span class="tool-rank-name" title="${esc(name)}">${esc(name)}</span>
            <span class="tool-rank-bar-wrap"><span class="tool-rank-bar" style="width:${pct}%"></span></span>
            <span class="tool-rank-count">${count}${deltaHtml}</span>
        </li>`;
    }).join('');

    const convNote = convCount > 1
        ? `<span>${tBi(`${convCount} conversations`, `${convCount} 个对话`)}</span>`
        : '';

    // ── Tool Catalog: persistent inventory of all unique tools used ──
    const catalog = gm.toolCatalog || [];
    let catalogHtml = '';
    if (catalog.length > 0) {
        const toolDesc: Record<string, string> = {
            view_file: '\u67e5\u770b\u6587\u4ef6\u5185\u5bb9',
            view_file_outline: '\u67e5\u770b\u6587\u4ef6\u5927\u7eb2\u7ed3\u6784',
            view_code_item: '\u67e5\u770b\u4ee3\u7801\u7b26\u53f7\u5b9a\u4e49',
            run_command: '\u6267\u884c\u7ec8\u7aef\u547d\u4ee4',
            command_status: '\u68c0\u67e5\u547d\u4ee4\u6267\u884c\u72b6\u6001',
            send_command_input: '\u5411\u8fdb\u7a0b\u53d1\u9001\u8f93\u5165',
            read_terminal: '\u8bfb\u53d6\u7ec8\u7aef\u8f93\u51fa',
            replace_file_content: '\u7f16\u8f91\u66ff\u6362\u6587\u4ef6\u5185\u5bb9',
            multi_replace_file_content: '\u591a\u5904\u7f16\u8f91\u66ff\u6362\u6587\u4ef6',
            write_to_file: '\u521b\u5efa\u65b0\u6587\u4ef6',
            find_by_name: '\u6309\u6587\u4ef6\u540d\u641c\u7d22',
            grep_search: '\u6587\u4ef6\u5185\u5bb9\u641c\u7d22',
            codebase_search: '\u8bed\u4e49\u4ee3\u7801\u641c\u7d22',
            list_dir: '\u5217\u51fa\u76ee\u5f55\u5185\u5bb9',
            search_web: '\u7f51\u9875\u641c\u7d22',
            read_url_content: '\u8bfb\u53d6\u7f51\u9875\u5185\u5bb9',
            generate_image: '\u751f\u6210\u56fe\u7247',
            browser_subagent: '\u6d4f\u89c8\u5668\u81ea\u52a8\u5316',
            view_content_chunk: '\u67e5\u770b\u6587\u6863\u5206\u7247',
        };
        // Sort catalog chips by call count (descending), matching the ranking order.
        // Tools not in the ranking sink to the bottom, ordered by firstSeen.
        const sortedCatalog = [...catalog].sort((a, b) => {
            const ca = counts[a.name] || 0;
            const cb = counts[b.name] || 0;
            if (ca !== cb) { return cb - ca; }
            return a.firstSeen.localeCompare(b.firstSeen);
        });
        const chips = sortedCatalog.map(entry => {
            const desc = toolDesc[entry.name] || '';
            const nameAttr = ` data-tooltip-name="${esc(entry.name)}"`;
            const descAttr = desc ? ` data-tooltip-desc="${esc(desc)}"` : '';
            const tooltipAttr = desc ? ` data-tooltip="${esc(desc)}"` : '';
            return `<span class="tool-cat-chip"${nameAttr}${descAttr}${tooltipAttr}><span class="tool-cat-chip-text">${esc(entry.name)}</span></span>`;
        }).join('');
        const catalogIcon = `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
        catalogHtml = `<details class="tool-cat-section" id="toolCatSection">
            <summary class="tool-cat-header">
                ${catalogIcon}
                ${tBi('Tool Catalog', '\u5de5\u5177\u76ee\u5f55')}
                <span class="act-badge">${catalog.length}</span>
            </summary>
            <div class="tool-cat-chips">${chips}</div>
            <div class="tool-cat-footer">
                <button class="tool-cat-clear-btn" id="clearToolCatalogBtn">
                    <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
                    ${tBi('Clear Catalog', '\u6e05\u7a7a\u76ee\u5f55')}
                </button>
            </div>
        </details>`;
    }

    return `<div class="tool-rank-section">
        <h3 class="act-section-title">
            ${wrenchIcon}
            ${tBi('Tool Call Ranking', '\u5de5\u5177\u8c03\u7528\u6392\u884c')}
            <span class="act-badge">${tBi(`${totalInvocations} invocations`, `${totalInvocations} \u6b21\u8c03\u7528`)}</span>
        </h3>
        <ul class="tool-rank-list">
            ${rows}
            <li class="tool-rank-summary">
                <span>${tBi('Unique Tools', '\u5de5\u5177\u79cd\u7c7b')}: <b>${entries.length}</b></span>
                <span>${tBi('Total', '\u5408\u8ba1')}: <b>${totalInvocations}</b></span>
                ${convNote}
            </li>
        </ul>
        ${catalogHtml}
    </div>`;
}

// Retry overhead section has been removed.
// Error details and token waste are now displayed in buildErrorDetailsSection() and Summary Bar tooltips.

/** Build a collapsible error details section showing recent errors and error code breakdown */
function buildErrorDetailsSection(s: GMSummary, currentCascadeId?: string): string {
    const errorCodes = s.retryErrorCodes || {};
    const recentErrors = s.recentErrors || [];
    const uniqueErrors = s.uniqueErrors || [];
    const errTotal = Object.values(errorCodes).reduce((a, b) => a + b, 0);
    if (errTotal <= 0 && recentErrors.length === 0 && s.totalRetryCount <= 0 && uniqueErrors.length === 0) { return ''; }

    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    // Per-conversation error delta (for +x display, like tool ranking)
    const byConv = s.retryErrorCodesByConv || {};
    const convCount = Object.keys(byConv).length;
    const currentConvErrors: Record<string, number> = (currentCascadeId && convCount > 1)
        ? (byConv[currentCascadeId] || {})
        : {};
    const currentConvTotal = Object.values(currentConvErrors).reduce((a, b) => a + b, 0);

    // Error code distribution tags — with per-conversation +x delta
    const codeTags = Object.entries(errorCodes)
        .sort((a, b) => b[1] - a[1])
        .map(([code, count]) => {
            const isRateLimit = code === '429';
            const isServer = code === '503' || code === '500' || code === '504';
            const tagClass = isRateLimit ? 'gm-err-tag-ratelimit' : isServer ? 'gm-err-tag-server' : 'gm-err-tag-other';
            const delta = currentConvErrors[code] || 0;
            const deltaHtml = delta > 0
                ? `<span class="err-delta" style="font-size:0.85em;margin-left:2px">+${delta}</span>`
                : '';
            return `<span class="gm-err-tag ${tagClass}">${esc(code)} \u00d7${count}${deltaHtml}</span>`;
        }).join('');

    // Section title with conversation delta badge
    const convDeltaBadge = currentConvTotal > 0
        ? ` <span class="err-delta" style="font-size:0.8em">+${currentConvTotal} ${tBi('this session', '\u672c\u5bf9\u8bdd')}</span>`
        : '';

    // -- Shared time formatter --
    const fmtTime = (iso: string): string => {
        if (!iso) { return ''; }
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) { return ''; }
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch { return ''; }
    };

    // -- Shared row builder for both unique errors and recent errors --
    const buildErrorRow = (entry: { code: string; message: string; createdAt?: string; firstSeen?: string }, i: number, idPrefix: string): string => {
        const isRateLimit = entry.code === '429';
        const isServer = entry.code === '503' || entry.code === '500' || entry.code === '504';
        const tagClass = isRateLimit ? 'gm-err-tag-ratelimit' : isServer ? 'gm-err-tag-server' : 'gm-err-tag-other';
        const time = entry.createdAt || entry.firstSeen || '';
        const timeStr = fmtTime(time);
        const timeChip = timeStr ? `<span class="gm-ue-time">${timeStr}</span>` : '';
        return `<details class="gm-err-expand gm-ue-row" id="${idPrefix}-${i}">
            <summary class="gm-ue-summary">
                <span class="gm-ue-idx">#${i + 1}</span>
                <span class="gm-err-tag ${tagClass} gm-ue-code">${esc(entry.code)}</span>
                ${timeChip}
                <span class="gm-ue-msg-preview">${esc(entry.message)}</span>
            </summary>
            <div class="gm-err-msg gm-err-msg-full gm-ue-full">${esc(entry.message)}</div>
        </details>`;
    };

    // -- Unique Error Types catalog (deduplicated by normalized message content, cross-account) --
    let uniqueErrorCatalog = '';
    if (uniqueErrors.length > 0) {
        const catalogIcon = `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
        const rows = uniqueErrors.map((entry, i) => buildErrorRow(entry, i, 'd-ue')).join('');
        uniqueErrorCatalog = `<details class="gm-ue-section" id="ue-catalog">
            <summary class="gm-ue-header">
                ${catalogIcon} ${tBi('Error Types', '\u9519\u8bef\u79cd\u7c7b')}
                <span class="act-badge">${uniqueErrors.length} ${tBi('types', '\u79cd')}</span>
            </summary>
            <div class="gm-ue-list">${rows}</div>
        </details>`;
    }

    // -- Recent error log (structured entries with code + timestamp) --
    const recentEntries = s.recentErrorEntries || [];
    let errorListHtml = '';
    if (recentEntries.length > 0) {
        const rows = recentEntries.map((entry, i) => buildErrorRow(entry, i, 'd-err')).join('');
        const logIcon = `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
        errorListHtml = `<details class="gm-ue-section" id="err-log" open>
            <summary class="gm-ue-header">
                ${logIcon} ${tBi('Error Log', '\u62a5\u9519\u65e5\u5fd7')}
                <span class="act-badge">${recentEntries.length} ${tBi('entries', '\u6761')}</span>
            </summary>
            <div class="gm-ue-list">${rows}</div>
        </details>`;
    } else if (recentErrors.length > 0) {
        // Fallback: legacy string[] without metadata
        const rows = recentErrors.slice(0, 20).map((msg, i) =>
            buildErrorRow({ code: 'unknown', message: msg }, i, 'd-err'),
        ).join('');
        errorListHtml = `<div class="gm-ue-section"><div class="gm-ue-list">${rows}</div></div>`;
    }

    // Overhead stats (token waste + credits) — shown as a compact info line
    const overheadParts: string[] = [];
    if (s.totalRetryTokens > 0) { overheadParts.push(`${fmt(s.totalRetryTokens)} ${tBi('tokens wasted', 'token \u6d6a\u8d39')}`); }
    if (s.totalRetryCredits > 0) { overheadParts.push(`${s.totalRetryCredits.toFixed(1)} ${tBi('credits lost', 'credits \u635f\u8017')}`); }
    if (s.totalRetryCount > 0) { overheadParts.push(`${s.totalRetryCount} ${tBi('calls with retries', '\u542b\u91cd\u8bd5\u8c03\u7528')}`); }
    const overheadLine = overheadParts.length > 0
        ? `<div class="gm-err-overhead">${overheadParts.join(' \u00b7 ')}</div>`
        : '';

    // -- Build clipboard text (all errors: unique types + recent log) --
    const clipboardParts: string[] = [];
    if (uniqueErrors.length > 0) {
        clipboardParts.push(`--- ${tBi('Error Types', '\u9519\u8bef\u79cd\u7c7b')} (${uniqueErrors.length} ${tBi('types', '\u79cd')}) ---`);
        uniqueErrors.forEach((e, i) => {
            const t = fmtTime(e.firstSeen);
            clipboardParts.push(`#${i + 1} [${e.code}] ${t ? t + ' ' : ''}${e.message}`);
        });
    }
    if (recentEntries.length > 0) {
        clipboardParts.push('');
        clipboardParts.push(`--- ${tBi('Error Log', '\u62a5\u9519\u65e5\u5fd7')} (${recentEntries.length} ${tBi('entries', '\u6761')}) ---`);
        recentEntries.forEach((e, i) => {
            const t = fmtTime(e.createdAt);
            clipboardParts.push(`#${i + 1} [${e.code}] ${t ? t + ' ' : ''}${e.message}`);
        });
    }
    if (overheadParts.length > 0) {
        clipboardParts.push('');
        clipboardParts.push(overheadParts.join(' | '));
    }

    const copyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const copyBtnHtml = clipboardParts.length > 0
        ? `<button class="gm-ue-copy-btn" id="copyAllErrors"><span class="gm-ue-tooltip">${tBi('Copy all errors', '\u590d\u5236\u5168\u90e8\u9519\u8bef')}</span>${copyIcon}</button>`
        : '';

    return `<h2 class="act-section-title"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${tBi('Error Details', '\u9519\u8bef\u8be6\u60c5')}${convDeltaBadge}${copyBtnHtml}</h2>
    <div class="gm-err-card">
        ${codeTags ? `<div class="gm-err-codes">${codeTags}</div>` : ''}
        ${uniqueErrorCatalog}
        ${overheadLine}
        ${errorListHtml}
        <pre id="ueClipboardData" style="display:none">${esc(clipboardParts.join('\n'))}</pre>
    </div>`;
}



// ─── Checkpoint Viewer Section ──────────────────────────────────────────────

function buildContextIntelViewer(s: GMSummary): string {
    // Find the most recently active conversation
    let primary = null as typeof s.conversations[0] | null;
    let latestTime = '';
    for (const conv of s.conversations) {
        for (const call of conv.calls) {
            if (call.createdAt && call.createdAt > latestTime) {
                latestTime = call.createdAt;
                primary = conv;
            }
        }
    }
    if (!primary) { return ''; }

    // Merge checkpoint summaries into systemContextItems format
    const rawItems: GMSystemContextItem[] = [...(primary.systemContextItems || [])];

    // Add checkpoints from checkpointSummaries that aren't already in systemContextItems
    const existingCPSteps = new Set(rawItems.filter(i => i.type === 'checkpoint').map(i => i.stepIndex));
    for (const cp of (primary.checkpointSummaries || [])) {
        if (!existingCPSteps.has(cp.stepIndex)) {
            rawItems.push({
                type: 'checkpoint',
                stepIndex: cp.stepIndex,
                tokens: cp.tokens,
                label: `Checkpoint ${cp.checkpointNumber}`,
                fullText: cp.fullText,
                checkpointNumber: cp.checkpointNumber,
            });
        }
    }

    // Even if rawItems is empty, we may still have model DNA data to show
    const hasModelDNA = Object.keys(s.modelBreakdown).some(k => {
        const ms = s.modelBreakdown[k];
        return (ms.promptSectionTitles && ms.promptSectionTitles.length > 0)
            || ms.completionConfig
            || ms.toolCount > 0;
    });
    const hasTokenBreakdown = s.latestTokenBreakdown && s.latestTokenBreakdown.length > 0;

    if (rawItems.length === 0 && !hasModelDNA && !hasTokenBreakdown) { return ''; }

    // Deduplicate by type+stepIndex, keep richest
    const byKey = new Map<string, GMSystemContextItem>();
    for (const item of rawItems) {
        const key = `${item.type}:${item.stepIndex}`;
        const existing = byKey.get(key);
        if (!existing || item.fullText.length > existing.fullText.length) {
            byKey.set(key, item);
        }
    }
    const items = [...byKey.values()].sort((a, b) => a.stepIndex - b.stepIndex);

    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    // Type → icon SVG + color
    const typeConfig: Record<string, { icon: string; color: string; label: string }> = {
        checkpoint: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2z"/><path d="M9 21V9h6v12"/></svg>',
            color: '#fbbf24',
            label: 'Checkpoint',
        },
        context_injection: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
            color: '#60a5fa',
            label: tBi('Context Injection', '上下文注入'),
        },
        user_info: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
            color: '#4ade80',
            label: tBi('User Information', '用户信息'),
        },
        user_rules: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
            color: '#06b6d4',
            label: tBi('User Rules', '用户规则'),
        },
        mcp_servers: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
            color: '#2dd4bf',
            label: 'MCP Servers',
        },
        workflows: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
            color: '#f472b6',
            label: tBi('Workflows', '工作流'),
        },
        artifacts: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
            color: '#a78bfa',
            label: 'Artifacts',
        },
        ephemeral: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>',
            color: '#94a3b8',
            label: 'Ephemeral',
        },
        system_preamble: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
            color: '#94a3b8',
            label: tBi('System Preamble', '系统前导'),
        },
    };

    // ── Build context item cards (existing) ──
    const contextCards = items.map((item, idx) => {
        const conf = typeConfig[item.type] || typeConfig.system_preamble;
        const bodyHtml = esc(item.fullText)
            .replace(/\{\{\s*CHECKPOINT\s+(\d+)\s*\}\}/gi, '<h2>CHECKPOINT $1</h2>')
            .replace(/^#\s+(.+)$/gm, '<h2>$1</h2>')
            .replace(/^##\s+(.+)$/gm, '<h3>$1</h3>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');

        const cpBadge = item.checkpointNumber !== undefined
            ? `<span class="cp-card-num" style="color:var(--ci-color)">#${item.checkpointNumber}</span>`
            : '';
        const iconHtml = `<span class="ci-icon" style="color:var(--ci-color);width:14px;height:14px;display:inline-flex;flex-shrink:0">${conf.icon}</span>`;

        return `<details class="cp-card" id="ciCard${idx}" data-ci-type="${item.type}" style="--ci-color:${conf.color}">
            <summary class="cp-card-header">
                ${iconHtml}
                ${cpBadge}
                <span style="font-weight:600;color:var(--ci-color)">${conf.label}</span>
                ${item.stepIndex >= 0 ? `<span class="cp-card-chip cp-card-chip-step">step ${item.stepIndex.toLocaleString()}</span>` : ''}
                ${item.tokens > 0 ? `<span class="cp-card-chip cp-card-chip-tok">${fmt(item.tokens)} tok</span>` : ''}
            </summary>
            <div class="cp-card-body">${bodyHtml}</div>
        </details>`;
    }).join('');

    // ── Build Model DNA cards (new) ──
    const dnaCards: string[] = [];
    const dnaIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20M7 4l10 16M17 4L7 20"/></svg>';
    const promptIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
    const configIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>';

    // Per-model iteration for DNA cards — only show models from the current conversation (primary)
    const primaryModels = new Set<string>();
    for (const call of primary.calls) {
        const mn = normalizeModelDisplayName(call.modelDisplay || call.model);
        if (mn) { primaryModels.add(mn); }
    }

    for (const [modelName, ms] of Object.entries(s.modelBreakdown)) {
        if (ms.callCount <= 0) { continue; }
        // Skip models not used in the current conversation
        if (!primaryModels.has(modelName)) { continue; }

        // 1. System Prompt Structure card
        if (ms.promptSectionTitles && ms.promptSectionTitles.length > 0) {
            const sectionChips = ms.promptSectionTitles.map((title, i) => {
                const sectionColors = ['#60a5fa', '#4ade80', '#fbbf24', '#f472b6', '#2dd4bf', '#a78bfa', '#06b6d4', '#f59e0b', '#ef4444', '#94a3b8', '#8b5cf6', '#14b8a6', '#e879f9'];
                const col = sectionColors[i % sectionColors.length];
                return `<span class="ci-dna-chip" style="border-color:${col}44;color:${col}">${esc(title)}</span>`;
            }).join('');
            dnaCards.push(`<details class="cp-card" id="ciDna-sp-${esc(modelName)}" data-ci-type="dna_prompt" style="--ci-color:#60a5fa">
                <summary class="cp-card-header">
                    <span class="ci-icon" style="color:var(--ci-color);width:14px;height:14px;display:inline-flex;flex-shrink:0">${promptIcon}</span>
                    <span style="font-weight:600;color:var(--ci-color)">${tBi('System Prompt Structure', '系统提示词结构')}</span>
                    <span class="cp-card-chip cp-card-chip-tok">${ms.promptSectionTitles.length} ${tBi('sections', '区段')}</span>
                    ${ms.toolCount > 0 ? `<span class="cp-card-chip cp-card-chip-step">${ms.toolCount} ${tBi('tools', '工具')}</span>` : ''}
                </summary>
                <div class="cp-card-body" style="white-space:normal">
                    <div style="margin-bottom:8px;font-size:0.88em;color:var(--color-text-dim)">${esc(modelName)}</div>
                    <div class="ci-dna-chips">${sectionChips}</div>
                </div>
            </details>`);
        }

        // 2. Completion Config card (with context window capacity)
        if (ms.completionConfig) {
            const cc = ms.completionConfig;
            // Find context data from current conversation only (not cross-session)
            let latestContextUsed = 0;
            let latestCallTime = '';
            let maxContextSeen = 0;
            for (const call of primary.calls) {
                const callModel = normalizeModelDisplayName(call.modelDisplay || call.model);
                if (callModel === modelName && call.contextTokensUsed > 0) {
                    if (!latestCallTime || call.createdAt > latestCallTime) {
                        latestCallTime = call.createdAt;
                        latestContextUsed = call.contextTokensUsed;
                    }
                    if (call.contextTokensUsed > maxContextSeen) {
                        maxContextSeen = call.contextTokensUsed;
                    }
                }
            }

            // Context capacity estimation:
            // maxTokens from completionConfig is the OUTPUT limit (e.g. 16384)
            // The context window threshold is not directly available, but we can show maxContextSeen
            // and a rough heuristic: typical thresholds are 128K, 160K, 200K
            const configRows: string[] = [];
            configRows.push(`<div class="ci-cfg-row"><span class="ci-cfg-label">temperature</span><span class="ci-cfg-val">${cc.temperature}</span></div>`);
            if (cc.firstTemperature !== cc.temperature) {
                configRows.push(`<div class="ci-cfg-row"><span class="ci-cfg-label">firstTemperature</span><span class="ci-cfg-val">${cc.firstTemperature}</span></div>`);
            }
            configRows.push(`<div class="ci-cfg-row"><span class="ci-cfg-label">topK</span><span class="ci-cfg-val">${cc.topK}</span></div>`);
            if (cc.topP !== 1) {
                configRows.push(`<div class="ci-cfg-row"><span class="ci-cfg-label">topP</span><span class="ci-cfg-val">${cc.topP}</span></div>`);
            }
            configRows.push(`<div class="ci-cfg-row"><span class="ci-cfg-label">maxOutputTokens</span><span class="ci-cfg-val">${fmt(cc.maxTokens)}</span></div>`);
            if (cc.stopPatternCount > 0) {
                configRows.push(`<div class="ci-cfg-row"><span class="ci-cfg-label">stopPatterns</span><span class="ci-cfg-val">${cc.stopPatternCount}</span></div>`);
            }

            // Context window capacity bar
            let capacityHtml = '';
            // Use the actual truncation threshold from plannerConfig (extracted from GM data)
            const contextCap = ms.contextWindowCapacity || 0;
            if (contextCap > 0 || maxContextSeen > 0) {
                const cap = contextCap > 0 ? contextCap : maxContextSeen;
                const usagePct = cap > 0 ? Math.min(100, Math.round(latestContextUsed / cap * 100)) : 0;
                const barColor = usagePct > 85 ? '#ef4444' : usagePct > 65 ? '#f59e0b' : '#4ade80';
                const capLabel = contextCap > 0 ? fmt(contextCap) : `~${fmt(cap)}`;
                capacityHtml = `
                    <div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--color-divider)">
                        <div class="ci-cfg-row" style="margin-bottom:4px">
                            <span class="ci-cfg-label">${tBi('Context Window', '上下文窗口')}</span>
                            <span class="ci-cfg-val">${fmt(latestContextUsed)} / ${capLabel}</span>
                        </div>
                        <div style="height:6px;background:var(--color-surface-hover);border-radius:3px;overflow:hidden">
                            <div style="height:100%;width:${usagePct}%;background:${barColor};border-radius:3px;transition:width 0.3s"></div>
                        </div>
                        <div style="font-size:0.78em;color:var(--color-text-dim);margin-top:3px">${usagePct}% ${tBi('used', '已使用')} · ${tBi('peak', '峰值')} ${fmt(maxContextSeen)}</div>
                    </div>`;
            }

            dnaCards.push(`<details class="cp-card" id="ciDna-cc-${esc(modelName)}" data-ci-type="dna_config" style="--ci-color:#f59e0b">
                <summary class="cp-card-header">
                    <span class="ci-icon" style="color:var(--ci-color);width:14px;height:14px;display:inline-flex;flex-shrink:0">${configIcon}</span>
                    <span style="font-weight:600;color:var(--ci-color)">${tBi('Generation Config', '生成配置')}</span>
                    <span class="cp-card-chip cp-card-chip-tok">T=${cc.temperature}</span>
                    ${latestContextUsed > 0 ? `<span class="cp-card-chip cp-card-chip-step">${fmt(latestContextUsed)} ctx</span>` : ''}
                </summary>
                <div class="cp-card-body" style="white-space:normal">
                    <div style="margin-bottom:8px;font-size:0.88em;color:var(--color-text-dim)">${esc(modelName)}</div>
                    <div class="ci-cfg-grid">${configRows.join('')}</div>
                    ${capacityHtml}
                </div>
            </details>`);
        }
    }

    // 3. Token Breakdown card (from latestTokenBreakdown)
    if (hasTokenBreakdown) {
        const groups = s.latestTokenBreakdown;
        const total = groups.reduce((sum, g) => sum + g.tokens, 0);
        const breakdownColors = ['#60a5fa', '#4ade80', '#fbbf24', '#f472b6', '#2dd4bf', '#a78bfa'];
        const breakdownRows = groups.map((g, i) => {
            const pct = total > 0 ? Math.max(1, Math.round(g.tokens / total * 100)) : 0;
            const col = breakdownColors[i % breakdownColors.length];
            const gName = g.name || g.type.replace('TOKEN_TYPE_', '').replace(/_/g, ' ');
            let childHtml = '';
            if (g.children.length > 0) {
                const chips = g.children.map(ch => {
                    return `<span class="ci-dna-chip" style="border-color:${col}44;color:${col};font-size:0.82em">${esc(ch.name)} <b>${fmt(ch.tokens)}</b></span>`;
                }).join('');
                childHtml = `<div class="ci-dna-chips" style="margin-top:3px;padding-left:16px">${chips}</div>`;
            }
            return `<div style="margin-bottom:6px">
                <div class="ci-cfg-row">
                    <span style="display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0"></span><span class="ci-cfg-label" style="min-width:0">${esc(gName)}</span></span>
                    <span class="ci-cfg-val">${fmt(g.tokens)} (${pct}%)</span>
                </div>
                <div style="height:4px;background:var(--color-surface-hover);border-radius:2px;overflow:hidden;margin-top:2px">
                    <div style="height:100%;width:${pct}%;background:${col};border-radius:2px"></div>
                </div>
                ${childHtml}
            </div>`;
        }).join('');
        const breakdownIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/><path d="M12 12V2"/><path d="M12 12h10"/></svg>';

        dnaCards.push(`<details class="cp-card" id="ciDna-tb" data-ci-type="dna_tokens" style="--ci-color:#f97316">
            <summary class="cp-card-header">
                <span class="ci-icon" style="color:var(--ci-color);width:14px;height:14px;display:inline-flex;flex-shrink:0">${breakdownIcon}</span>
                <span style="font-weight:600;color:var(--ci-color)">${tBi('Token Composition', 'Token 组成')}</span>
                <span class="cp-card-chip cp-card-chip-tok">${fmt(total)} total</span>
            </summary>
            <div class="cp-card-body" style="white-space:normal">
                <div style="font-size:0.82em;color:var(--color-text-dim);margin-bottom:8px">${tBi('Latest snapshot of context window token distribution', '上下文窗口 token 分布最新快照')}</div>
                ${breakdownRows}
            </div>
        </details>`);
    }

    // Combine all cards
    const allCards = contextCards + dnaCards.join('');

    // Empty state: show hint when no cards are available (e.g. after reinstall before first AI response)
    if (!allCards) {
        const emptyIcon = `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
        return `<details class="ci-section" id="ciSection">
        <summary class="ci-section-header">${emptyIcon}${tBi('Context Intelligence', '上下文情报')}</summary>
        <div class="cp-viewer"><div style="text-align:center;padding:var(--space-4);color:var(--color-text-dim);font-size:0.85em">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:28px;height:28px;margin:0 auto 8px;display:block;opacity:0.4"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            ${tBi('Waiting for AI response — context data will populate automatically after the first model call in this session.', '等待 AI 回复中 — 上下文数据将在本次会话的首次模型调用后自动填充。')}
        </div></div>
        </details>`;
    }

    // Count by type for badge
    const typeCounts = new Map<string, number>();
    for (const item of items) {
        typeCounts.set(item.type, (typeCounts.get(item.type) || 0) + 1);
    }
    const badgeParts: string[] = [];
    for (const [type, count] of typeCounts) {
        const conf = typeConfig[type] || typeConfig.system_preamble;
        badgeParts.push(`<span class="act-badge ci-badge" data-ci-type="${type}" style="background:${conf.color}22;color:${conf.color};border:1px solid ${conf.color}44">${conf.label}${count > 1 ? ' ' + count : ''}</span>`);
    }
    // Add DNA badges
    if (dnaCards.length > 0) {
        const dnaColor = '#f59e0b';
        badgeParts.push(`<span class="act-badge" style="background:${dnaColor}22;color:${dnaColor};border:1px solid ${dnaColor}44">${tBi('Model DNA', '模型 DNA')}${dnaCards.length > 1 ? ' ' + dnaCards.length : ''}</span>`);
    }

    const titleIcon = `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;

    return `<details class="ci-section" id="ciSection">
    <summary class="ci-section-header">${titleIcon}${tBi('Context Intelligence', '上下文情报')} <span class="ci-badges">${badgeParts.join(' ')}</span></summary>
    <div class="cp-viewer">${allCards}</div>
    </details>`;
}

// ─── Account Status Panel ───────────────────────────────────────────────────

function getPlanClass(planName: string): string {
    const lower = planName.toLowerCase();
    if (lower.includes('ultra')) { return 'acct-plan-ultra'; }
    if (lower.includes('pro')) { return 'acct-plan-pro'; }
    if (lower.includes('team')) { return 'acct-plan-team'; }
    return 'acct-plan-free';
}

function buildPendingArchivePanel(entries: PendingArchiveEntry[]): string {
    const totalCalls = entries.reduce((s, e) => s + e.totalCalls, 0);
    const totalIn = entries.reduce((s, e) => s + e.totalInputTokens, 0);
    const totalOut = entries.reduce((s, e) => s + e.totalOutputTokens, 0);
    const totalCache = entries.reduce((s, e) => s + (e.totalCacheRead || 0), 0);
    const totalCredits = entries.reduce((s, e) => s + e.totalCredits, 0);

    // Cost: pre-computed at baseline time using responseModel pricing
    const totalCost = entries.reduce((s, e) => s + (e.estimatedCost || 0), 0);

    // Aggregate per-model across all entries
    const allModels = new Map<string, number>();
    for (const e of entries) {
        for (const [m, c] of Object.entries(e.modelCalls)) {
            allModels.set(m, (allModels.get(m) || 0) + c);
        }
    }
    const modelChips = [...allModels.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([model, count]) => `<span class="pending-model-chip">${esc(normalizeModelDisplayName(model))} <b>${count}</b></span>`)
        .join('');

    const formatK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

    const archiveIcon = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M0 2a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1v7.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 12.5V5a1 1 0 0 1-1-1zm2 3v7.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V5zm13-3H1v2h14zM5 7.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5"/></svg>`;

    return `<div class="pending-archive-panel">
        <div class="pending-archive-header">
            ${archiveIcon}
            ${tBi('Pending Archive', '待归档')}
            <span class="pending-archive-count">${entries.length} ${tBi('cycle(s)', '个周期')}</span>
        </div>
        <div class="pending-archive-stats">
            <span class="pending-stat">${tBi('Calls', '调用')} <b>${totalCalls}</b></span>
            <span class="pending-stat">${tBi('Input', '输入')} <b>${formatK(totalIn)}</b></span>
            <span class="pending-stat">${tBi('Output', '输出')} <b>${formatK(totalOut)}</b></span>
            ${totalCache > 0 ? `<span class="pending-stat">${tBi('Cache', '缓存')} <b>${formatK(totalCache)}</b></span>` : ''}
            ${totalCredits > 0 ? `<span class="pending-stat">${tBi('Credits', '积分')} <b>${totalCredits}</b></span>` : ''}
            ${totalCost > 0 ? `<span class="pending-stat pending-stat-cost">${tBi('Cost', '费用')} <b>$${totalCost < 0.01 ? totalCost.toFixed(4) : totalCost < 1 ? totalCost.toFixed(3) : totalCost.toFixed(2)}</b></span>` : ''}
        </div>
        <div class="pending-archive-models">${modelChips}</div>
        <div class="pending-archive-note">${tBi(
        'These calls have been baselined after quota reset. They will be archived to the calendar at midnight.',
        '这些调用已在额度重置后基线化，将于午夜归档到日历。',
    )}</div>
    </div>`;
}

/**
 * Detect whether any account has a quota pool that is "Ready" (expired reset time with usage).
 * Used to show a red-dot indicator on the account popover trigger button.
 */
export function hasAccountReadyPool(snapshots: AccountSnapshot[]): boolean {
    const nowMs = Date.now();
    for (const snap of snapshots) {
        for (const pool of (snap.resetPools || [])) {
            if (pool.hasUsage === false) { continue; }
            const resetDate = parseResetDate(pool.resetTime);
            if (resetDate && resetDate.getTime() - nowMs <= 0) { return true; }
        }
    }
    return false;
}

/**
 * Build the account status panel HTML for the global floating popover.
 * This is the same visual content that was previously embedded in the GM Data tab.
 */
export function buildAccountStatusPanel(snapshots: AccountSnapshot[]): string {
    const nowMs = Date.now();
    // Sort: active first, then by lastSeen desc
    const sorted = [...snapshots].sort((a, b) => {
        if (a.isActive !== b.isActive) { return a.isActive ? -1 : 1; }
        return b.lastSeen.localeCompare(a.lastSeen);
    });

    const cards = sorted.map(snap => {
        const indicatorClass = snap.isActive ? 'acct-indicator-active' : 'acct-indicator-cached';
        const planClass = getPlanClass(snap.planName || snap.tierName);
        const planLabel = snap.tierName || snap.planName || 'Unknown';

        // Build per-pool reset rows
        const pools = snap.resetPools || [];
        let resetHtml = '';

        if (pools.length > 0) {
            // Deduplicate pools that have the same countdown (within 1 minute)
            const poolRows = pools.map(pool => {
                const resetDate = parseResetDate(pool.resetTime);
                if (!resetDate) { return ''; }
                const diffMs = resetDate.getTime() - nowMs;

                // Condense model labels: show up to 3, then "+N"
                const maxShow = 3;
                const labels = pool.modelLabels;
                const shown = labels.slice(0, maxShow);
                const extra = labels.length > maxShow ? labels.length - maxShow : 0;
                const modelChips = shown.map(l =>
                    `<span class="acct-pool-model">${esc(l)}</span>`
                ).join('');
                const extraChip = extra > 0 ? `<span class="acct-pool-more">+${extra}</span>` : '';

                // Build compact quota bar — only shown for active pools
                const buildQuotaBar = (pct: number | undefined): string => {
                    const p = pct ?? 100;
                    const colorClass = p > 40 ? 'acct-quota-ok' : p > 20 ? 'acct-quota-warn' : 'acct-quota-danger';
                    return `<div class="acct-quota-bar" title="${p}% ${tBi('remaining', '剩余')}"><div class="acct-quota-fill ${colorClass}" style="width:${p}%"></div></div>`;
                };

                // Pool has no usage — show "未使用" instead of fake countdown
                if (pool.hasUsage === false) {
                    return `<div class="acct-pool-row acct-pool-idle">
                        <div class="acct-pool-models">${modelChips}${extraChip}</div>
                        <span class="acct-reset-countdown acct-reset-idle">${tBi('Idle', '未使用')}</span>
                    </div>`;
                }

                if (diffMs <= 0) {
                    return `<div class="acct-pool-row">
                        <div class="acct-pool-models">${modelChips}${extraChip}</div>
                        <span class="acct-reset-countdown acct-reset-countdown-expired">${tBi('Ready', '已就绪')}</span>
                    </div>`;
                }

                const countdown = formatResetCountdown(pool.resetTime, nowMs);
                const warnClass = diffMs < 30 * 60 * 1000 ? ' acct-reset-countdown-warn' : '';
                return `<div class="acct-pool-row">
                    ${buildQuotaBar(pool.remainingPercent)}
                    <div class="acct-pool-models">${modelChips}${extraChip}</div>
                    <span class="acct-reset-countdown${warnClass}">${countdown}</span>
                </div>`;
            }).filter(Boolean).join('');



            resetHtml = `<div class="acct-pools">${poolRows}</div>`;
        } else if (!snap.isActive) {
            resetHtml = `<div class="acct-reset">
                <span class="acct-tag-cached">${tBi('cached', '已缓存')}</span>
            </div>`;
        }

        const statusTag = snap.isActive
            ? `<span class="acct-tag-active">${tBi('active', '在线')}</span>`
            : `<span class="acct-tag-cached">${tBi('cached', '已缓存')}</span>`;

        // Delete link for cached accounts — inline red text after status tag
        const deleteLink = !snap.isActive
            ? `<button class="acct-delete-link acct-delete-btn" data-email="${esc(snap.email)}" title="${tBi('Remove cached account', '移除缓存账号')}">${tBi('Remove', '移除')}</button>`
            : '';

        return `<div class="acct-card">
            <div class="acct-indicator ${indicatorClass}"></div>
            <div class="acct-identity">
                <span class="acct-name">${esc(snap.name || '—')} ${statusTag}${deleteLink ? ` ${deleteLink}` : ''}</span>
                <span class="acct-email">${esc(snap.email)}</span>
            </div>
            <span class="acct-plan ${planClass}">${esc(planLabel)}</span>
            ${resetHtml}
        </div>`;
    }).join('');

    // Header icon: person SVG
    const userIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z"/></svg>`;

    return `<div class="acct-panel">
        <div class="acct-panel-header">
            ${userIcon}
            ${tBi('Account Status', '账号状态')}
            <span class="acct-panel-count">(${sorted.length})</span>
        </div>
        ${cards}
    </div>`;
}


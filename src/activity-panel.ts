// ─── GM Data Tab Content Builder ─────────────────────────────────────────────
// Provides HTML + CSS for the unified "GM Data" tab within the main monitor panel.
// Merges Activity tracking data with GM precision data into a single view.
// This module is a content-only builder — the panel itself is managed by webview-panel.ts.

import { tBi, formatNumber } from './i18n';
import { ActivitySummary } from './activity-tracker';
import { esc, formatShortTime as formatTime, tBiHtml } from './webview-helpers';
import type { ContextUsage } from './tracker';
import type { GMSummary, GMModelStats, GMSystemContextItem } from './gm-tracker';
import { currentAICredits, formatCreditTypeLabel } from './account-credits';
import { normalizeModelDisplayName } from './models';
import { findPricingWithCustom, costFromTokens, selectPricingModel, type ModelPricing } from './pricing-store';
import { toLocalDateKey, type LedgerAccountBucket, type LedgerSettledEntry } from './daily-ledger';
import { formatResetCountdown, parseResetDate } from './reset-time';
import { getDaysUntilBillingDay } from './billing-day';
import {
    computeTelemetrySummary,
    computeTelemetryAggregateFromModelStats,
    computeStepSpeed,
    computeStepCacheHitRate,
    formatSpeed,
    formatLatency,
    formatCachePercent,
    type SessionTelemetrySummary,
    type TelemetryAggregate,
    type CacheState,
} from './telemetry-metrics';

function fmtCompactTokens(n: number): string {
    if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(2)}M`; }
    if (n >= 1_000) { return `${(n / 1_000).toFixed(1)}k`; }
    return String(Math.round(n));
}

function formatSavingsUsd(amount: number): string {
    if (amount < 0.0001) { return '<$0.0001'; }
    if (amount < 0.01) { return `$${amount.toFixed(4)}`; }
    return `$${amount.toFixed(2)}`;
}

function formatSpeedRange(minTokPerSec: number, maxTokPerSec: number): string {
    const minStr = formatSpeed(minTokPerSec).replace(/\s*tok\/s$/, '');
    const maxStr = formatSpeed(maxTokPerSec);
    return `${minStr}–${maxStr}`;
}

function dateKeyToStartOfDayMs(dateKey: string): number {
    const parts = dateKey.split('-');
    if (parts.length !== 3) { return 0; }
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) { return 0; }
    return new Date(y, m, d, 0, 0, 0, 0).getTime();
}

function estimatedContextDescription(): string {
    return tBi(
        'Context estimated before the request; it may differ from the token counts reported after the response.',
        '请求前估算的上下文用量，可能与回复后报告的 Token 数不同。',
    );
}

// ─── Account Snapshot Type ───────────────────────────────────────────────────

/** A quota reset pool — models sharing the same reset time. */
export interface ResetPool {
    /** ISO timestamp when this pool resets */
    resetTime: string;
    /** Model labels in this pool (e.g. ["Claude 3.5 Sonnet", "GPT-4o"]) */
    modelLabels: string[];
    /** Model IDs in this pool (for stable language-independent matching) */
    modelIds: string[];
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
    /** Available credit balances (e.g. Google One AI credits) */
    credits?: { creditType: string; creditAmount: number | null }[];
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
    todayLedgerActive?: LedgerAccountBucket[],
    ledgerSettled?: LedgerSettledEntry[],
    customPricing: Record<string, ModelPricing> = {},
): string {
    if (!summary && (!gmSummary || gmSummary.totalCalls === 0)) {
        return `<p class="empty-msg">${tBiHtml(
            'Waiting for data... GM and Activity information will appear automatically.',
            '正在等待数据... GM 和活动信息将自动显示。',
        )}</p>`;
    }

    const parts: string[] = [];
    const telemetry = computeTelemetrySummary(gmSummary, {
        activeCascadeId: currentUsage?.cascadeId,
        customPricing,
    });

    // ── Summary Bar (merged activity + account-filtered GM telemetry)
    parts.push(buildSummaryBar(summary, gmSummary, currentUsage?.cascadeId, telemetry));

    // ── Dedicated Editorial Telemetry Ledger (Speed, Cached vs Uncached TTFT, Prompt Cache)
    if (gmSummary && telemetry.overall.totalCalls > 0) {
        parts.push(buildTelemetryLedgerSection(telemetry));
    }

    // ── Recent Timeline (activity)
    if (summary) { parts.push(buildTimeline(summary, currentUsage, gmSummary, customPricing)); }

    // ── Model Cards (merged activity counts + GM precision + telemetry)
    const activeEmail = accountSnapshots?.find(s => s.isActive)?.email || '';
    parts.push(buildModelCards(summary, gmSummary, activeEmail, customPricing, telemetry));

    // ── Today's Ledger Panel (real-time incremental accumulation)
    if (todayLedgerActive && todayLedgerActive.some(b => b.totalCalls > 0)) {
        parts.push(buildTodayLedgerPanel(todayLedgerActive, accountSnapshots || [], customPricing));
    }
    if (ledgerSettled && ledgerSettled.length > 0) {
        parts.push(buildLedgerSettledPanel(ledgerSettled));
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
    /* ─── Account Status Panel / Popover ─── */
    .acct-panel {
        margin-bottom: 16px;
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        overflow: hidden;
    }
    .acct-panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 9px 14px;
        background: var(--ed-surface-well);
        border-bottom: 1px solid var(--ed-border);
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--ed-ink);
    }
    .acct-panel-header svg {
        width: 14px;
        height: 14px;
        color: var(--ed-accent);
        flex-shrink: 0;
    }
    .acct-panel-count {
        font-weight: 500;
        font-size: 0.75rem;
        color: var(--ed-ink-muted);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .acct-card {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--ed-border);
        font-size: 0.8125rem;
        transition: background var(--ed-dur-fast) var(--ed-ease);
        min-width: 0;
    }
    .acct-card:last-child { border-bottom: none; }
    @media (hover: hover) {
        .acct-card:hover { background: var(--ed-surface-hover); }
    }
    .acct-indicator {
        width: 8px;
        height: 8px;
        border-radius: var(--ed-radius-pill);
        flex-shrink: 0;
        margin-top: 5px;
    }
    .acct-indicator-active {
        background: var(--ed-good-fill);
    }
    .acct-indicator-cached {
        background: var(--ed-ink-muted);
        opacity: 0.5;
    }
    .acct-identity {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
        flex: 1;
    }
    .acct-name {
        font-weight: 600;
        color: var(--ed-ink);
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        min-width: 0;
    }
    .acct-email {
        font-family: var(--ed-mono);
        font-size: 0.75rem;
        color: var(--ed-ink-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .acct-plan {
        display: inline-flex;
        align-items: center;
        padding: 1px 8px;
        border-radius: var(--ed-radius-pill);
        font-size: 0.6875rem;
        font-weight: 600;
        line-height: 1.45;
        align-self: flex-start;
        width: fit-content;
        border: 1px solid var(--ed-border);
    }
    .acct-plan-pro,
    .acct-plan-ultra {
        background: var(--ed-accent-tint);
        color: var(--ed-accent);
        border-color: var(--ed-accent-border);
    }
    .acct-plan-free {
        background: var(--ed-surface-well);
        color: var(--ed-ink-muted);
        border-color: var(--ed-border);
    }
    .acct-plan-team {
        background: var(--ed-good-tint);
        color: var(--ed-good);
        border-color: var(--ed-good-border);
    }
    .acct-reset {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        min-width: 88px;
    }
    .acct-reset-countdown {
        font-weight: 600;
        font-size: 0.78125rem;
        font-variant-numeric: tabular-nums lining-nums;
        color: var(--ed-ink);
        min-width: 4.5em;
        text-align: right;
        flex-shrink: 0;
    }
    .acct-reset-countdown-warn { color: var(--ed-warn); }
    .acct-reset-countdown-expired { color: var(--ed-good); font-weight: 650; }
    .acct-reset-abs {
        font-size: 0.75rem;
        color: var(--ed-ink-muted);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .acct-pools {
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
    }
    .acct-pool-row {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: flex-end;
    }
    .acct-pool-models {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
        justify-content: flex-end;
    }
    .acct-pool-model {
        display: inline-block;
        padding: 1px 6px;
        border-radius: var(--ed-radius-xs);
        font-size: 0.6875rem;
        line-height: 1.5;
        white-space: nowrap;
        background: var(--ed-surface-well);
        color: var(--ed-ink-secondary);
        border: 1px solid var(--ed-border);
        max-width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
        vertical-align: bottom;
    }
    .acct-pool-more {
        display: inline-block;
        padding: 0 4px;
        font-size: 0.6875rem;
        color: var(--ed-ink-muted);
    }
    .acct-tag-active {
        font-size: 0.6875rem;
        color: var(--ed-good);
        font-weight: 600;
    }
    .acct-tag-cached {
        font-size: 0.6875rem;
        color: var(--ed-ink-muted);
        font-weight: 500;
    }
    .acct-pool-idle { opacity: 0.65; }
    .acct-reset-idle {
        font-size: 0.75rem;
        font-weight: 450;
        color: var(--ed-ink-muted);
        min-width: 4.5em;
        text-align: right;
        flex-shrink: 0;
    }
    .acct-quota-bar {
        width: 54px;
        height: 6px;
        border-radius: var(--ed-radius-pill);
        background: var(--ed-track);
        flex-shrink: 0;
        overflow: hidden;
        position: relative;
    }
    .acct-quota-fill {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        border-radius: var(--ed-radius-pill);
        transition: width 260ms var(--ed-ease);
    }
    .acct-quota-ok { background: var(--ed-good-fill); }
    .acct-quota-warn { background: var(--ed-warn-fill); }
    .acct-quota-danger { background: var(--ed-danger-fill); }
    .acct-delete-link {
        font-size: 0.6875rem;
        font-weight: 550;
        color: var(--ed-danger);
        cursor: pointer;
        border: none;
        background: none;
        padding: 0 4px;
        border-radius: var(--ed-radius-xs);
        white-space: nowrap;
        transition: background var(--ed-dur-fast) var(--ed-ease);
    }
    @media (hover: hover) {
        .acct-delete-link:hover {
            background: var(--ed-danger-tint);
            text-decoration: underline;
        }
    }
    .acct-credits {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 2px;
    }
    .acct-credit-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 8px;
        border-radius: var(--ed-radius-xs);
        font-size: 0.6875rem;
        line-height: 1.45;
        white-space: nowrap;
        background: var(--ed-surface-well);
        color: var(--ed-ink-secondary);
        border: 1px solid var(--ed-border);
    }
    .acct-credit-chip b {
        color: var(--ed-ink);
        font-weight: 650;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .acct-credit-unknown {
        color: var(--ed-ink-muted);
        font-weight: 500;
    }
    .acct-expiry-chip.is-today {
        background: var(--ed-danger-tint);
        color: var(--ed-danger);
        border-color: var(--ed-danger-border);
        font-weight: 600;
    }

    /* ─── Today & Settled Ledger Panels (L1 cards + L2 inset wells) ─── */
    .pending-archive-panel {
        margin: 0 0 20px;
        padding: 16px 18px;
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
    }
    .pending-archive-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        font-weight: 600;
        font-size: 0.9375rem;
        color: var(--ed-ink);
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--ed-border);
    }
    .pending-archive-header svg {
        width: 15px;
        height: 15px;
        color: var(--ed-accent);
        flex-shrink: 0;
    }
    .settled-header svg {
        color: var(--ed-good);
    }
    .pending-archive-count {
        font-weight: 550;
        font-size: 0.72rem;
        color: var(--ed-ink-muted);
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-pill);
        padding: 1px 8px;
        margin-left: auto;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .pending-archive-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 16px;
        margin-bottom: 10px;
    }
    .pending-stat {
        font-size: 0.78125rem;
        color: var(--ed-ink-muted);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .pending-stat b {
        color: var(--ed-ink);
        font-weight: 600;
        margin-left: 4px;
    }
    .pending-stat-cost b {
        color: var(--ed-good);
    }
    .pending-archive-models {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 8px;
    }
    .pending-model-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 8px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        font-size: 0.75rem;
        color: var(--ed-ink-secondary);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .pending-model-chip b {
        color: var(--ed-ink);
        font-weight: 650;
    }
    .ledger-reset-time {
        font-size: 0.72rem;
        margin-left: 2px;
        padding-left: 6px;
        border-left: 1px solid var(--ed-border);
        color: var(--ed-ink-muted);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .pending-archive-note {
        font-size: 0.75rem;
        color: var(--ed-ink-muted);
        margin-top: 8px;
        line-height: 1.5;
    }
    .ledger-acct-cards {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 6px;
    }
    .ledger-acct-card {
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-sm);
        padding: 10px 12px;
    }
    .ledger-acct-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 7px;
        margin-bottom: 8px;
        font-size: 0.8125rem;
    }
    .ledger-acct-dot {
        width: 7px;
        height: 7px;
        border-radius: var(--ed-radius-pill);
        flex-shrink: 0;
    }
    .ledger-acct-active { background: var(--ed-good-fill); }
    .ledger-acct-cached { background: var(--ed-ink-muted); opacity: 0.5; }
    .ledger-acct-name {
        font-weight: 600;
        color: var(--ed-ink);
    }
    .ledger-acct-email {
        font-family: var(--ed-mono);
        color: var(--ed-ink-muted);
        font-size: 0.75rem;
    }
    .ledger-acct-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 14px;
        margin-bottom: 8px;
    }

    /* ─── Top KPI Strip (L1 Card with Hairline Dividers) ─── */
    .act-summary-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 0;
        margin-bottom: 20px;
        padding: 12px 16px;
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
    }
    .act-stat {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 14px;
        border-right: 1px solid var(--ed-border);
        position: relative;
        cursor: default;
        white-space: nowrap;
        transition: background var(--ed-dur-fast) var(--ed-ease);
    }
    .act-stat:first-child { padding-left: 2px; }
    .act-stat:last-child { border-right: none; }
    .act-stat-warn {
        margin-left: 8px;
        padding: 4px 10px;
        border-right: none;
        border-radius: var(--ed-radius-sm);
        background: var(--ed-danger-tint);
        border: 1px solid var(--ed-danger-border);
        color: var(--ed-danger);
    }
    .act-stat-warn .act-stat-icon,
    .act-stat-warn .act-stat-val,
    .act-stat-warn .act-stat-label {
        color: var(--ed-danger);
    }
    .act-stat[data-tooltip]::after {
        bottom: auto;
        top: calc(100% + 6px);
        transform: translateX(-50%) scale(0.94);
        padding: 5px 9px;
        background: var(--ed-surface-overlay);
        color: var(--ed-ink);
        border: 1px solid var(--ed-border-strong);
        border-radius: var(--ed-radius-sm);
        font-size: 0.75rem;
        font-weight: 400;
        text-transform: none;
        letter-spacing: 0;
        white-space: normal;
        max-width: 240px;
        width: max-content;
        text-align: center;
        z-index: var(--z-tooltip, 500);
        box-shadow: var(--ed-shadow-tooltip);
    }
    .act-stat[data-tooltip]:hover::after,
    .act-stat[data-tooltip]:focus-visible::after {
        transform: translateX(-50%) scale(1);
    }
    .act-summary-bar > .act-stat:first-child[data-tooltip]::after {
        left: 0; right: auto; transform: translateX(0) scale(0.94); text-align: left;
    }
    .act-summary-bar > .act-stat:first-child[data-tooltip]:hover::after {
        transform: translateX(0) scale(1);
    }
    .act-summary-bar > .act-stat:last-child[data-tooltip]::after {
        left: auto; right: 0; transform: translateX(0) scale(0.94); text-align: left;
    }
    .act-summary-bar > .act-stat:last-child[data-tooltip]:hover::after {
        transform: translateX(0) scale(1);
    }
    .act-stat-icon {
        display: inline-flex;
        align-items: center;
        color: var(--ed-ink-muted);
    }
    .act-stat-icon svg { display: block; }
    .act-icon {
        width: 14px;
        height: 14px;
        display: inline-block;
        vertical-align: -2px;
        margin-right: 4px;
        color: var(--ed-ink-muted);
        flex-shrink: 0;
    }
    .act-icon-accent { color: var(--ed-accent); }
    .act-icon-good { color: var(--ed-good); }
    .act-icon-warn { color: var(--ed-warn); }
    .act-icon-danger { color: var(--ed-danger); }
    .act-stat-val {
        font-weight: 650;
        font-size: 0.9375rem;
        line-height: 1.1;
        color: var(--ed-ink);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .act-stat-sub {
        font-size: 0.72rem;
        font-weight: 500;
        color: var(--ed-ink-muted);
        margin-left: 4px;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .act-stat-label {
        color: var(--ed-ink-muted);
        font-size: 0.75rem;
        font-weight: 500;
    }

    /* ─── Speed & First-Token Cache Telemetry Ledger (L1 2-Column Editorial Section) ─── */
    .telemetry-ledger-section {
        margin-bottom: 24px;
        min-width: 0;
    }
    .telemetry-ledger-section > .act-section-title {
        margin-top: 0;
    }
    .telemetry-ledger-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        align-items: stretch;
    }
    .telemetry-ledger-card {
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        padding: 16px 18px;
        display: flex;
        flex-direction: column;
        min-width: 0;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .telemetry-card-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 6px 10px;
        margin-bottom: 12px;
        min-width: 0;
    }
    .telemetry-card-title-wrap {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
    }
    .telemetry-card-title-wrap svg {
        width: 14px;
        height: 14px;
        color: var(--ed-accent);
        flex-shrink: 0;
    }
    .telemetry-card-title {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 600;
        line-height: 1.35;
        letter-spacing: -0.008em;
        color: var(--ed-ink);
        overflow-wrap: anywhere;
    }
    .telemetry-pill,
    .telemetry-warmth-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 8px;
        border-radius: var(--ed-radius-pill);
        font-size: 0.6875rem;
        font-weight: 600;
        line-height: 1.45;
        background: var(--ed-surface);
        color: var(--ed-ink-secondary);
        border: 1px solid var(--ed-border);
        white-space: nowrap;
        max-width: 100%;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .telemetry-warmth-badge::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: var(--ed-radius-pill);
        background: currentColor;
        flex-shrink: 0;
    }
    .telemetry-warmth-badge.is-warm {
        background: var(--ed-surface);
        color: var(--ed-good);
        border-color: var(--ed-good-border);
    }
    .telemetry-warmth-badge.is-warming {
        background: var(--ed-surface);
        color: var(--ed-warn);
        border-color: var(--ed-warn-border);
    }
    .telemetry-warmth-badge.is-cold {
        background: var(--ed-surface);
        color: var(--ed-ink-secondary);
        border-color: var(--ed-border-strong);
    }
    .telemetry-warmth-badge.is-unknown {
        background: var(--ed-surface);
        color: var(--ed-ink-muted);
        border-color: var(--ed-border);
    }
    .telemetry-hero-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 6px 12px;
        margin-bottom: 10px;
        min-width: 0;
    }
    .telemetry-hero-val {
        font-family: var(--ed-sans);
        font-size: 1.625rem;
        font-weight: 650;
        line-height: 1.15;
        letter-spacing: -0.025em;
        color: var(--ed-ink);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .telemetry-hero-val.is-cache {
        color: var(--ed-chart-cache);
    }
    .telemetry-hero-val.is-empty {
        color: var(--ed-ink-muted);
        font-weight: 550;
    }
    .telemetry-hero-meta {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--ed-ink-muted);
        font-variant-numeric: tabular-nums lining-nums;
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .telemetry-subgrid {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 14px;
        padding: 8px 10px;
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-sm);
        min-width: 0;
    }
    .telemetry-subitem {
        display: inline-flex;
        align-items: baseline;
        gap: 5px;
        font-size: 0.75rem;
        min-width: 0;
        max-width: 100%;
    }
    .telemetry-sub-label {
        color: var(--ed-ink-muted);
        font-weight: 500;
    }
    .telemetry-sub-val {
        color: var(--ed-ink);
        font-weight: 600;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .telemetry-ttft-block {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--ed-border);
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
    }
    .telemetry-subhead {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 6px 8px;
        min-width: 0;
    }
    .telemetry-subhead-title {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--ed-ink-secondary);
    }
    .telemetry-delta-pill {
        display: inline-flex;
        align-items: center;
        padding: 1px 7px;
        border-radius: var(--ed-radius-pill);
        font-size: 0.6875rem;
        font-weight: 650;
        line-height: 1.45;
        background: var(--ed-surface);
        border: 1px solid var(--ed-border-strong);
        color: var(--ed-ink-secondary);
        font-variant-numeric: tabular-nums lining-nums;
        white-space: nowrap;
    }
    .telemetry-delta-pill.is-faster {
        background: var(--ed-surface);
        color: var(--ed-good);
        border-color: var(--ed-good-border);
    }
    .telemetry-delta-pill.is-neutral {
        background: var(--ed-surface);
        color: var(--ed-ink-secondary);
        border-color: var(--ed-border-strong);
    }
    .telemetry-ttft-rows {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 0;
    }
    .telemetry-ttft-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
    }
    .telemetry-ttft-row-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 4px 8px;
        font-size: 0.75rem;
        min-width: 0;
    }
    .telemetry-ttft-label {
        color: var(--ed-ink-secondary);
        font-weight: 500;
        min-width: 0;
    }
    .telemetry-ttft-val {
        color: var(--ed-ink);
        font-weight: 600;
        font-variant-numeric: tabular-nums lining-nums;
        white-space: nowrap;
        flex-shrink: 0;
    }
    .telemetry-sample-n {
        color: var(--ed-ink-muted);
        font-weight: 450;
        font-size: 0.72rem;
        margin-left: 3px;
    }
    .telemetry-bar-track {
        height: 6px;
        border-radius: var(--ed-radius-pill);
        background: var(--ed-track);
        overflow: hidden;
        width: 100%;
    }
    .telemetry-bar-fill {
        display: block;
        height: 100%;
        border-radius: var(--ed-radius-pill);
        transition: width 260ms var(--ed-ease);
        min-width: 4px;
    }
    .telemetry-bar-fill-cache { background: var(--ed-chart-cache); }
    .telemetry-bar-fill-uncached { background: var(--ed-chart-input); }
    .telemetry-bar-fill-avg { background: var(--ed-accent); }
    .telemetry-single-note,
    .telemetry-empty-note,
    .telemetry-ttft-foot {
        font-size: 0.75rem;
        color: var(--ed-ink-muted);
        margin: 0;
        line-height: 1.45;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .telemetry-cache-bar-wrap {
        display: flex;
        flex-direction: column;
        gap: 7px;
        margin: 2px 0 12px;
        min-width: 0;
    }
    .telemetry-cache-bar-track {
        height: 8px;
        border-radius: var(--ed-radius-pill);
        background: var(--ed-track);
        overflow: hidden;
        display: flex;
        width: 100%;
    }
    .telemetry-cache-seg {
        display: block;
        height: 100%;
        transition: width 260ms var(--ed-ease);
    }
    .telemetry-cache-seg-read { background: var(--ed-chart-cache); }
    .telemetry-cache-seg-fresh { background: var(--ed-chart-input); }
    .telemetry-cache-seg-write { background: var(--ed-warn-fill); }
    .telemetry-cache-legend {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
        font-size: 0.72rem;
        color: var(--ed-ink-secondary);
    }
    .telemetry-legend-item {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
    }
    .telemetry-legend-dot {
        width: 8px;
        height: 8px;
        border-radius: var(--ed-radius-pill);
        flex-shrink: 0;
    }
    .telemetry-legend-dot-read { background: var(--ed-chart-cache); }
    .telemetry-legend-dot-fresh { background: var(--ed-chart-input); }
    .telemetry-legend-dot-write { background: var(--ed-warn-fill); }
    .telemetry-ledger-rows {
        display: flex;
        flex-direction: column;
        margin-top: auto;
        border-top: 1px solid var(--ed-border);
    }
    .telemetry-ledger-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 6px 12px;
        padding: 7px 0;
        border-bottom: 1px solid var(--ed-border);
        font-size: 0.78125rem;
        min-width: 0;
    }
    .telemetry-ledger-row:last-child {
        border-bottom: none;
        padding-bottom: 0;
    }
    .telemetry-ledger-key {
        color: var(--ed-ink-secondary);
        font-weight: 500;
        flex-shrink: 0;
    }
    .telemetry-ledger-val-group {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        align-items: baseline;
        gap: 2px 6px;
        text-align: right;
        color: var(--ed-ink);
        font-variant-numeric: tabular-nums lining-nums;
        min-width: 0;
        flex: 1 1 auto;
    }
    .telemetry-ledger-val-group b {
        font-weight: 650;
        color: var(--ed-ink);
    }
    .telemetry-ledger-sub {
        color: var(--ed-ink-muted);
        font-size: 0.72rem;
        font-weight: 450;
    }
    .telemetry-ledger-muted {
        color: var(--ed-ink-muted);
        font-weight: 500;
    }
    .telemetry-savings-usd {
        color: var(--ed-good);
        font-weight: 650;
    }
    body:is(.vscode-high-contrast, .vscode-high-contrast-light,
        [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"])
        :is(.telemetry-bar-track, .telemetry-cache-bar-track) {
        outline: 1px solid var(--ed-border);
    }

    /* ─── Layout Grids & Section Titles ─── */
    .act-two-col {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
        gap: 16px;
        margin-bottom: 24px;
        align-items: stretch;
    }
    .act-col {
        display: flex;
        flex-direction: column;
        min-width: 0;
        height: 100%;
    }
    .act-col > .act-section-title { margin-top: 0; }
    .act-col > div,
    .act-col > ul {
        margin-bottom: 0;
        flex: 1;
    }
    .act-section-title {
        font-size: 0.9375rem;
        font-weight: 600;
        line-height: 1.35;
        letter-spacing: -0.012em;
        margin: 24px 0 10px;
        color: var(--ed-ink);
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }
    .act-section-title > .act-icon {
        width: 15px;
        height: 15px;
        margin-right: 0;
    }
    .act-badge {
        display: inline-flex;
        align-items: center;
        font-size: 0.72rem;
        font-weight: 550;
        color: var(--ed-ink-secondary);
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        padding: 1px 8px;
        border-radius: var(--ed-radius-pill);
        font-variant-numeric: tabular-nums lining-nums;
    }

    /* ─── Model Stats Grid (L1 Cards + L2 Recessed Header) ─── */
    .act-cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr));
        gap: 14px;
        margin-bottom: 24px;
    }
    .act-model-card {
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        overflow: hidden;
        transition: border-color var(--ed-dur-fast) var(--ed-ease);
        min-width: 0;
    }
    @media (hover: hover) {
        .act-model-card:hover {
            border-color: var(--ed-border-strong);
        }
    }
    .act-card-header {
        padding: 10px 14px;
        font-weight: 600;
        font-size: 0.875rem;
        line-height: 1.35;
        color: var(--ed-ink);
        background: var(--ed-surface-well);
        border-bottom: 1px solid var(--ed-border);
        word-break: break-word;
        overflow-wrap: anywhere;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
    }
    .act-card-body {
        padding: 6px 14px 10px;
    }
    .act-card-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 5px 4px;
        font-size: 0.8125rem;
        color: var(--ed-ink-secondary);
        border-bottom: 1px solid var(--ed-border);
        transition: background var(--ed-dur-fast) var(--ed-ease);
    }
    .act-card-row:last-child { border-bottom: none; }
    @media (hover: hover) {
        .act-card-row:hover {
            background: var(--ed-surface-hover);
            border-radius: var(--ed-radius-xs);
        }
    }
    .act-card-row > span:first-child {
        display: inline-flex;
        align-items: center;
        min-width: 0;
    }
    .act-card-row .val {
        font-weight: 600;
        color: var(--ed-ink);
        font-variant-numeric: tabular-nums lining-nums;
        flex-shrink: 0;
    }
    .act-card-val-stack {
        display: inline-flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 1px;
        text-align: right;
    }
    .act-card-sub {
        font-size: 0.6875rem;
        font-weight: 450;
        color: var(--ed-ink-muted);
        line-height: 1.3;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .act-card-row .val-cost,
    .act-card-row-cost .val { color: var(--ed-good); }
    .act-card-row .val-hit { color: var(--ed-accent); }
    .act-card-row .val-credits { color: var(--ed-warn); }
    .act-card-divider {
        border-top: 1px solid var(--ed-border);
        margin: 6px 0;
    }
    .act-credit-calls {
        font-size: 0.75rem;
        font-weight: 450;
        color: var(--ed-ink-muted);
        margin-left: 3px;
    }
    .gm-account-section {
        padding-top: 4px;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }
    .gm-account-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 4px 6px;
        border-radius: var(--ed-radius-xs);
        font-size: 0.75rem;
    }
    .gm-account-row .gm-account-label {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--ed-ink-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }
    .gm-account-row .gm-account-label svg {
        width: 12px;
        height: 12px;
        flex-shrink: 0;
    }
    .gm-account-row .gm-account-count {
        font-weight: 600;
        font-variant-numeric: tabular-nums lining-nums;
        color: var(--ed-ink);
        flex-shrink: 0;
    }
    .gm-account-row.gm-account-active {
        background: var(--ed-good-tint);
    }
    .gm-account-row.gm-account-active .gm-account-label {
        color: var(--ed-ink);
        font-weight: 550;
    }
    .gm-account-row.gm-account-active .gm-account-label svg,
    .gm-account-row.gm-account-active .gm-account-count {
        color: var(--ed-good);
    }
    .gm-account-err {
        color: var(--ed-danger);
        font-weight: 600;
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums lining-nums;
        margin-left: 5px;
        white-space: nowrap;
        padding: 1px 5px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-surface);
        border: 1px solid var(--ed-danger-border);
        display: none;
    }
    .model-stats-show-errors .gm-account-err { display: inline; }
    .model-stats-err-toggle {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 24px;
        padding: 0 9px;
        border-radius: var(--ed-radius-pill);
        border: 1px solid var(--ed-danger-border);
        background: var(--ed-surface);
        color: var(--ed-danger);
        font-family: inherit;
        font-size: 0.72rem;
        font-weight: 600;
        cursor: pointer;
        user-select: none;
        transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease), color var(--ed-dur-fast) var(--ed-ease);
        flex-shrink: 0;
    }
    .model-stats-err-toggle svg {
        width: 11px;
        height: 11px;
        flex-shrink: 0;
    }
    .model-stats-err-toggle:focus-visible {
        outline: 2px solid var(--ed-accent);
        outline-offset: 2px;
    }
    .model-stats-err-toggle.is-off {
        background: var(--ed-surface-well);
        border-color: var(--ed-border);
        color: var(--ed-ink-muted);
    }
    @media (hover: hover) {
        .model-stats-err-toggle:hover {
            border-color: var(--ed-danger);
        }
        .model-stats-err-toggle.is-off:hover {
            background: var(--ed-surface-hover);
            border-color: var(--ed-border-strong);
            color: var(--ed-ink);
        }
    }

    /* ─── Recent Activity Timeline ─── */
    .act-timeline {
        max-height: 480px;
        overflow-y: auto;
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        padding: 10px;
        margin-bottom: 24px;
    }
    .act-tl-item {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px 6px;
        padding: 6px 8px;
        min-height: 28px;
        font-size: 0.78125rem;
        border-bottom: 1px solid var(--ed-border);
        transition: background var(--ed-dur-fast) var(--ed-ease);
    }
    @media (hover: hover) {
        .act-tl-item:hover { background: var(--ed-surface-hover); }
    }
    .act-tl-item:last-child { border-bottom: none; }
    .act-tl-time {
        color: var(--ed-ink-muted);
        flex-shrink: 0;
        width: auto;
        font-family: var(--ed-mono);
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums lining-nums;
        white-space: nowrap;
        padding: 1px 6px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        text-align: center;
    }
    .act-tl-icon {
        flex-shrink: 0;
        width: 16px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
    .act-tl-icon .act-icon { margin-right: 0; }
    .act-tl-content {
        flex: 1 1 180px;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 6px;
        overflow: hidden;
    }
    .act-tl-model {
        color: var(--ed-accent);
        font-weight: 550;
        flex: 0 1 auto;
        min-width: 0;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .act-tl-detail {
        color: var(--ed-ink-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }
    .act-tl-user {
        color: var(--ed-good);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: default;
    }
    .act-tl-ai-preview {
        color: var(--ed-ink-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
        cursor: default;
    }
    .act-tl-meta {
        margin-left: auto;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        flex-shrink: 1;
        max-width: 100%;
    }
    .act-tl-meta.act-tl-meta-gm {
        flex: 1 0 100%;
        margin-left: 0;
        justify-content: flex-start;
    }
    .act-tl-dur {
        color: var(--ed-ink-muted);
        flex-shrink: 0;
        padding: 1px 5px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        font-family: var(--ed-mono);
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums lining-nums;
        white-space: nowrap;
    }
    .act-tl-reasoning .act-tl-icon .act-icon { color: var(--ed-accent); }
    .act-tl-system {
        background: var(--ed-warn-tint);
    }
    .act-tl-system .act-tl-icon .act-icon,
    .act-tl-system .act-tl-detail {
        color: var(--ed-warn);
        font-weight: 550;
    }
    .act-tl-tool .act-tl-icon .act-icon { color: var(--ed-ink-muted); }
    .act-tl-tool-name {
        font-family: var(--ed-mono);
        color: var(--ed-ink);
        font-weight: 500;
        flex-shrink: 0;
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        padding: 1px 6px;
        border-radius: var(--ed-radius-xs);
        font-size: 0.75rem;
    }
    .act-tl-step-idx {
        color: var(--ed-ink-muted);
        font-family: var(--ed-mono);
        font-size: 0.72rem;
        flex-shrink: 0;
        min-width: 30px;
        text-align: center;
        padding: 1px 4px;
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-xs);
        font-variant-numeric: tabular-nums lining-nums;
        font-weight: 500;
    }
    .act-tl-gm {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        margin-left: 0;
        flex-shrink: 1;
        max-width: 100%;
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .act-tl-gm-status {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        flex-shrink: 1;
        max-width: 100%;
        font-size: 0.72rem;
        justify-content: flex-start;
    }
    .act-tl-gm-tag {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: var(--ed-radius-xs);
        white-space: nowrap;
        border: 1px solid var(--ed-border);
        background: var(--ed-surface-well);
        color: var(--ed-ink-secondary);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .act-tl-gm-tag svg { margin-right: 3px; }
    .act-tl-gm-in { background: var(--ed-surface); color: var(--ed-accent); border-color: var(--ed-accent-border); }
    .act-tl-gm-out { background: var(--ed-surface); color: var(--ed-good); border-color: var(--ed-good-border); }
    .act-tl-gm-speed { background: var(--ed-surface); color: var(--ed-accent); border-color: var(--ed-accent-border); font-weight: 600; }
    .act-tl-gm-ttft { background: var(--ed-surface); color: var(--ed-warn); border-color: var(--ed-warn-border); }
    .act-tl-gm-stream { background: var(--ed-surface); color: var(--ed-ink-secondary); border-color: var(--ed-border); }
    .act-tl-gm-cache { background: var(--ed-surface); color: var(--ed-chart-cache); border-color: var(--ed-border-strong); }
    .act-tl-gm-cache-hit { background: var(--ed-surface); color: var(--ed-chart-cache); border-color: var(--ed-border-strong); font-weight: 550; }
    .act-tl-gm-cost { background: var(--ed-surface); color: var(--ed-good); border-color: var(--ed-good-border); font-weight: 600; }
    .act-tl-gm-cost svg { width: 10px; height: 10px; flex-shrink: 0; }
    .act-tl-gm-credit { background: var(--ed-surface); color: var(--ed-warn); border-color: var(--ed-warn-border); }
    .act-tl-gm-retry { background: var(--ed-surface); color: var(--ed-danger); border-color: var(--ed-danger-border); font-weight: 600; }
    .act-tl-gm-tool { background: var(--ed-surface-well); color: var(--ed-ink-secondary); border-color: var(--ed-border); }
    .act-tl-gm-tool .act-icon { width: 11px; height: 11px; margin-right: 1px; }
    .act-tl-gm-ctx { background: var(--ed-surface); color: var(--ed-warn); border-color: var(--ed-warn-border); }

    /* ─── Turn Groups (Collapsible Disclosures) ─── */
    .act-tl-turn {
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-sm);
        background: var(--ed-surface);
        overflow: hidden;
        margin-bottom: 8px;
        transition: border-color var(--ed-dur-fast) var(--ed-ease);
    }
    .act-tl-turn:last-child { margin-bottom: 0; }
    .act-tl-turn[open] { border-color: var(--ed-border-strong); }
    .act-tl-turn-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 8px;
        padding: 8px 12px;
        cursor: pointer;
        user-select: none;
        font-size: 0.8125rem;
        font-weight: 550;
        color: var(--ed-ink);
        background: var(--ed-surface-well);
        list-style: none;
        transition: background var(--ed-dur-fast) var(--ed-ease);
    }
    .act-tl-turn-header::-webkit-details-marker { display: none; }
    .act-tl-turn-header::before {
        content: '';
        width: 0;
        height: 0;
        border-left: 5px solid var(--ed-ink-muted);
        border-top: 4px solid transparent;
        border-bottom: 4px solid transparent;
        transition: transform 160ms var(--ed-ease);
        flex-shrink: 0;
    }
    .act-tl-turn[open] > .act-tl-turn-header::before {
        transform: rotate(90deg);
        border-left-color: var(--ed-ink);
    }
    @media (hover: hover) {
        .act-tl-turn-header:hover { background: var(--ed-surface-hover); }
    }
    .act-tl-turn-icon {
        flex-shrink: 0;
        color: var(--ed-accent);
        display: inline-flex;
        align-items: center;
    }
    .act-tl-turn-icon .act-icon { width: 14px; height: 14px; margin-right: 0; color: inherit; }
    .act-tl-turn-text {
        flex: 1 1 110px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }
    .seg-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
        flex-shrink: 1;
        max-width: 100%;
    }
    .seg-chip {
        display: inline-flex;
        align-items: center;
        padding: 1px 7px;
        border-radius: var(--ed-radius-xs);
        font-size: 0.6875rem;
        line-height: 1.5;
        white-space: nowrap;
        border: 1px solid var(--ed-border);
        background: var(--ed-surface);
        color: var(--ed-ink-secondary);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .seg-chip .act-icon { width: 11px; height: 11px; margin-right: 3px; color: inherit; }
    .seg-chip-calls { border-color: var(--ed-accent-border); background: var(--ed-surface); color: var(--ed-accent); }
    .seg-chip-speed { border-color: var(--ed-accent-border); background: var(--ed-surface); color: var(--ed-accent); font-weight: 600; }
    .seg-chip-ttft { border-color: var(--ed-warn-border); background: var(--ed-surface); color: var(--ed-warn); }
    .seg-chip-tools { border-color: var(--ed-border); background: var(--ed-surface); color: var(--ed-ink-secondary); }
    .seg-chip-tok { border-color: var(--ed-border); background: var(--ed-surface); color: var(--ed-ink); }
    .seg-chip-cache { border-color: var(--ed-border-strong); background: var(--ed-surface); color: var(--ed-chart-cache); }
    .seg-chip-cache-hit { border-color: var(--ed-border-strong); background: var(--ed-surface); color: var(--ed-chart-cache); font-weight: 550; }
    .seg-chip-credits { border-color: var(--ed-warn-border); background: var(--ed-surface); color: var(--ed-warn); }
    .seg-chip-cost { border-color: var(--ed-good-border); background: var(--ed-surface); color: var(--ed-good); font-weight: 600; }
    .seg-chip-ctx { border-color: var(--ed-warn-border); background: var(--ed-surface); color: var(--ed-warn); }
    .seg-chip-retry { border-color: var(--ed-danger-border); background: var(--ed-surface); color: var(--ed-danger); font-weight: 600; }
    .act-tl-segment-user {
        background: var(--ed-good-tint);
    }
    .act-tl-segment-body {
        display: flex;
        flex-direction: column;
        border-top: 1px solid var(--ed-border);
    }
    .act-checkpoint-model { opacity: 0.9; }

    /* ─── Timeline Legend Help Popover (L3 Overlay, zero backdrop-filter) ─── */
    .act-tl-help-wrap {
        position: relative;
        display: inline-flex;
        margin-left: auto;
    }
    .act-tl-help-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: var(--ed-radius-pill);
        border: 1px solid var(--ed-control-border);
        background: var(--ed-surface);
        color: var(--ed-ink-muted);
        font-size: 0.72rem;
        font-weight: 650;
        cursor: help;
        user-select: none;
        flex-shrink: 0;
        transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease), color var(--ed-dur-fast) var(--ed-ease);
    }
    @media (hover: hover) {
        .act-tl-help-btn:hover {
            background: var(--ed-accent-tint);
            border-color: var(--ed-accent-border);
            color: var(--ed-accent);
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
        width: 290px;
        max-height: 280px;
        overflow-y: auto;
        padding: 10px 12px;
        background: var(--ed-surface-overlay);
        border: 1px solid var(--ed-border-strong);
        border-radius: var(--ed-radius-lg);
        box-shadow: var(--ed-shadow-popover);
        font-size: 0.75rem;
        line-height: 1.5;
        color: var(--ed-ink-secondary);
        opacity: 0;
        visibility: hidden;
        transform: translateY(-4px);
        transition: opacity var(--ed-dur-fast) var(--ed-ease), visibility var(--ed-dur-fast) var(--ed-ease), transform var(--ed-dur-fast) var(--ed-ease);
        pointer-events: none;
    }
    .act-tl-help-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 0;
    }
    .act-tl-help-sample {
        flex-shrink: 0;
        min-width: 86px;
        display: flex;
        align-items: center;
    }
    .act-tl-help-desc {
        flex: 1;
        min-width: 0;
    }
    .act-tl-help-divider {
        height: 1px;
        background: var(--ed-border);
        margin: 6px 0;
    }
    .act-tl-help-group-label {
        font-size: 0.72rem;
        font-weight: 600;
        color: var(--ed-ink);
        margin-bottom: 4px;
    }

    /* ─── Context Trend Chart (Studio Cobalt Line + Soft Fill) ─── */
    .act-trend-container {
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        padding: 14px 16px;
        margin-bottom: 24px;
        height: 230px;
        display: flex;
        flex-direction: column;
    }
    .act-trend-svg { width: 100%; flex: 1; display: block; }
    .act-trend-grid { stroke: var(--ed-border); stroke-width: 1; }
    .act-trend-area { fill: var(--ed-accent-tint); }
    .act-trend-line { stroke: var(--ed-accent); stroke-width: 2; }
    .act-trend-labels {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        color: var(--ed-ink-muted);
        margin-top: 8px;
        padding-top: 6px;
        border-top: 1px solid var(--ed-border);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .err-delta { color: var(--ed-danger); font-weight: 600; font-size: 0.78rem; }

    /* ─── Conversation Breakdown (L1 Card with Hairline Rows) ─── */
    .act-conv-list {
        display: flex;
        flex-direction: column;
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        margin-bottom: 24px;
        max-height: 280px;
        overflow-y: auto;
    }
    .act-conv-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 14px;
        border-bottom: 1px solid var(--ed-border);
        transition: background var(--ed-dur-fast) var(--ed-ease);
        min-width: 0;
    }
    .act-conv-item:last-child { border-bottom: none; }
    @media (hover: hover) {
        .act-conv-item:hover {
            background: var(--ed-surface-hover);
        }
    }
    .act-conv-title-chip {
        flex: 1;
        min-width: 0;
        color: var(--ed-ink);
        font-weight: 550;
        font-size: 0.8125rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .act-conv-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        font-size: 0.75rem;
        color: var(--ed-ink-muted);
    }
    .act-conv-meta-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 7px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        white-space: nowrap;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .act-conv-meta-chip b { color: var(--ed-ink); font-weight: 600; }
    .act-conv-meta-chip svg { width: 11px; height: 11px; flex-shrink: 0; color: var(--ed-ink-muted); }
    .act-conv-credits { color: var(--ed-warn); border-color: var(--ed-warn-border); background: var(--ed-warn-tint); }
    .act-conv-credits b { color: var(--ed-warn); }
    .act-conv-date { color: var(--ed-ink-muted); }

    /* ─── Error Details Section ─── */
    .gm-err-card {
        background: var(--ed-surface);
        border: 1px solid var(--ed-danger-border);
        border-radius: var(--ed-radius-md);
        padding: 14px 16px;
        margin-bottom: 24px;
    }
    .gm-err-codes {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 10px;
    }
    .gm-err-tag {
        display: inline-flex;
        align-items: center;
        font-size: 0.72rem;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: var(--ed-radius-xs);
        border: 1px solid var(--ed-border);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .gm-err-tag-ratelimit { background: var(--ed-warn-tint); color: var(--ed-warn); border-color: var(--ed-warn-border); }
    .gm-err-tag-server { background: var(--ed-danger-tint); color: var(--ed-danger); border-color: var(--ed-danger-border); }
    .gm-err-tag-other { background: var(--ed-surface-well); color: var(--ed-ink-secondary); border-color: var(--ed-border); }
    .gm-err-expand .gm-err-tag { background: var(--ed-surface); }
    .gm-err-overhead {
        font-size: 0.75rem;
        color: var(--ed-ink-secondary);
        padding: 8px 0;
        border-top: 1px solid var(--ed-border);
        margin-top: 6px;
    }
    .gm-err-msg {
        font-size: 0.75rem;
        font-family: var(--ed-mono);
        color: var(--ed-danger);
        padding: 6px 10px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-danger-tint);
        line-height: 1.55;
    }
    .gm-err-expand {
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-xs);
        background: var(--ed-surface-well);
        overflow: hidden;
        transition: border-color var(--ed-dur-fast) var(--ed-ease);
    }
    .gm-err-expand[open] { border-color: var(--ed-danger-border); }
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
    .gm-err-expand.no-overflow > .gm-err-msg-summary { cursor: default; pointer-events: none; }
    .gm-err-expand[open] > .gm-err-msg-summary {
        height: 0;
        padding: 0;
        margin: 0;
        overflow: hidden;
        border: none;
        pointer-events: none;
    }
    .gm-err-msg-full {
        font-size: 0.75rem;
        font-family: var(--ed-mono);
        color: var(--ed-ink);
        background: var(--ed-surface);
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.55;
        padding: 8px 12px;
        border-top: 1px solid var(--ed-border);
        cursor: pointer;
    }
    .gm-ue-section {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid var(--ed-border);
    }
    .gm-ue-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--ed-ink);
        cursor: pointer;
        list-style: none;
        user-select: none;
        padding: 4px 2px;
    }
    .gm-ue-header::-webkit-details-marker { display: none; }
    .gm-ue-header::before {
        content: '';
        width: 0;
        height: 0;
        border-left: 5px solid var(--ed-ink-muted);
        border-top: 4px solid transparent;
        border-bottom: 4px solid transparent;
        transition: transform 160ms var(--ed-ease);
        flex-shrink: 0;
    }
    .gm-ue-section[open] > .gm-ue-header::before {
        transform: rotate(90deg);
        border-left-color: var(--ed-danger);
    }
    .gm-ue-header .act-icon {
        width: 14px;
        height: 14px;
        margin-right: 0;
        color: var(--ed-danger);
    }
    .gm-ue-copy-btn {
        margin-left: auto;
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 28px;
        padding: 0 9px;
        background: var(--ed-surface);
        border: 1px solid var(--ed-control-border);
        border-radius: var(--ed-radius-sm);
        color: var(--ed-ink-secondary);
        cursor: pointer;
        font-size: 0.75rem;
        transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease), color var(--ed-dur-fast) var(--ed-ease);
    }
    @media (hover: hover) {
        .gm-ue-copy-btn:hover {
            background: var(--ed-surface-hover);
            border-color: var(--ed-ink-muted);
            color: var(--ed-ink);
        }
        .gm-ue-copy-btn:hover .gm-ue-tooltip { opacity: 1; }
    }
    .gm-ue-copy-btn:focus-visible {
        outline: 2px solid var(--ed-accent);
        outline-offset: 2px;
    }
    .gm-ue-copy-btn.copied {
        border-color: var(--ed-good-border);
        background: var(--ed-good-tint);
        color: var(--ed-good);
    }
    .gm-ue-copy-btn.copied .gm-ue-tooltip { opacity: 0; }
    .gm-ue-tooltip {
        position: absolute;
        bottom: calc(100% + 6px);
        right: 0;
        background: var(--ed-surface-overlay);
        color: var(--ed-ink);
        font-size: 0.72rem;
        font-weight: 500;
        padding: 4px 8px;
        border-radius: var(--ed-radius-sm);
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: opacity var(--ed-dur-fast) var(--ed-ease);
        border: 1px solid var(--ed-border-strong);
        box-shadow: var(--ed-shadow-tooltip);
        z-index: 10;
    }
    .gm-ue-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 8px;
    }
    .gm-ue-summary {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        cursor: pointer;
        padding: 6px 10px;
        font-size: 0.75rem;
        list-style: none;
        user-select: none;
        overflow: hidden;
    }
    .gm-ue-summary::-webkit-details-marker { display: none; }
    .gm-ue-summary::before {
        content: '';
        width: 0;
        height: 0;
        border-left: 4px solid var(--ed-ink-muted);
        border-top: 3.5px solid transparent;
        border-bottom: 3.5px solid transparent;
        transition: transform 160ms var(--ed-ease);
        flex-shrink: 0;
    }
    .gm-ue-row[open] > .gm-ue-summary::before { transform: rotate(90deg); }
    .gm-ue-idx {
        color: var(--ed-ink-muted);
        font-weight: 600;
        font-family: var(--ed-mono);
        font-size: 0.72rem;
        min-width: 1.6em;
        flex-shrink: 0;
    }
    .gm-ue-code { flex-shrink: 0; }
    .gm-ue-time {
        font-size: 0.72rem;
        color: var(--ed-ink-muted);
        white-space: nowrap;
        flex-shrink: 0;
        font-family: var(--ed-mono);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .gm-ue-msg-preview {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: var(--ed-mono);
        color: var(--ed-danger);
    }

    /* ─── Context Intelligence Section (Unified Disclosure Grammar) ─── */
    .ci-section {
        margin-bottom: 14px;
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        background: var(--ed-surface);
        overflow: hidden;
    }
    .ci-section-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        padding: 10px 14px;
        cursor: pointer;
        user-select: none;
        list-style: none;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--ed-ink);
        background: var(--ed-surface-well);
        transition: background var(--ed-dur-fast) var(--ed-ease);
    }
    .ci-section-header::-webkit-details-marker { display: none; }
    .ci-section-header::before {
        content: '';
        width: 0;
        height: 0;
        border-left: 5px solid var(--ed-ink-muted);
        border-top: 4px solid transparent;
        border-bottom: 4px solid transparent;
        transition: transform 160ms var(--ed-ease);
        flex-shrink: 0;
    }
    .ci-section[open] > .ci-section-header::before {
        transform: rotate(90deg);
        border-left-color: var(--ed-ink);
    }
    @media (hover: hover) {
        .ci-section-header:hover { background: var(--ed-surface-hover); }
    }
    .ci-badges {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-left: auto;
    }
    .ci-section[open] > .cp-viewer {
        border-top: 1px solid var(--ed-border);
    }
    .cp-viewer {
        max-height: 420px;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 12px 14px;
        background: var(--ed-surface);
    }
    .ci-empty {
        text-align: center;
        padding: 20px 16px;
        color: var(--ed-ink-muted);
        font-size: 0.8125rem;
    }
    .ci-empty svg {
        width: 24px;
        height: 24px;
        margin: 0 auto 8px;
        display: block;
        color: var(--ed-ink-muted);
    }
    .cp-card {
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-sm);
        background: var(--ed-surface-well);
        margin-bottom: 8px;
        overflow: hidden;
        transition: border-color var(--ed-dur-fast) var(--ed-ease);
    }
    .cp-card:last-child { margin-bottom: 0; }
    .cp-card[open] { border-color: var(--ed-border-strong); }
    .cp-card-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        padding: 8px 12px;
        cursor: pointer;
        user-select: none;
        list-style: none;
        font-size: 0.8125rem;
        color: var(--ed-ink);
        transition: background var(--ed-dur-fast) var(--ed-ease);
    }
    .cp-card-header::-webkit-details-marker { display: none; }
    .cp-card-header::before {
        content: '';
        width: 0;
        height: 0;
        border-left: 4.5px solid var(--ed-ink-muted);
        border-top: 3.5px solid transparent;
        border-bottom: 3.5px solid transparent;
        transition: transform 160ms var(--ed-ease);
        flex-shrink: 0;
    }
    .cp-card[open] > .cp-card-header::before { transform: rotate(90deg); }
    @media (hover: hover) {
        .cp-card-header:hover { background: var(--ed-surface-hover); }
    }
    .ci-icon {
        width: 14px;
        height: 14px;
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
    }
    .ci-title-label { font-weight: 600; color: var(--ed-ink); }
    .cp-card-num {
        font-weight: 650;
        font-family: var(--ed-mono);
        font-size: 0.75rem;
        color: var(--ed-accent);
        flex-shrink: 0;
    }
    .cp-card-chip {
        display: inline-flex;
        align-items: center;
        padding: 1px 7px;
        border-radius: var(--ed-radius-xs);
        font-size: 0.72rem;
        font-weight: 550;
        white-space: nowrap;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .cp-card-chip-step {
        background: var(--ed-surface);
        color: var(--ed-ink-secondary);
        border: 1px solid var(--ed-border);
    }
    .cp-card-chip-tok {
        background: var(--ed-surface);
        color: var(--ed-accent);
        border: 1px solid var(--ed-accent-border);
    }
    .cp-card-body {
        border-top: 1px solid var(--ed-border);
        padding: 12px 14px;
        font-size: 0.78125rem;
        line-height: 1.6;
        color: var(--ed-ink);
        background: var(--ed-surface);
        max-height: 280px;
        overflow-y: auto;
        overscroll-behavior: contain;
        white-space: pre-wrap;
        word-break: break-word;
    }
    .cp-card-body.is-structured { white-space: normal; }
    .ci-raw-header {
        margin-bottom: 8px;
        padding-bottom: 6px;
        border-bottom: 1px solid var(--ed-border);
        font-weight: 600;
        font-size: 0.75rem;
        color: var(--ed-ink-secondary);
    }
    .ci-raw-content {
        white-space: pre-wrap;
        word-break: break-word;
        font-family: var(--ed-mono);
        font-size: 0.75rem;
        color: var(--ed-ink-secondary);
        line-height: 1.55;
    }
    .ci-model-sub {
        margin-bottom: 8px;
        font-size: 0.75rem;
        color: var(--ed-ink-muted);
    }
    .ci-cap-box {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid var(--ed-border);
    }
    .ci-cap-track {
        height: 6px;
        background: var(--ed-track);
        border-radius: var(--ed-radius-pill);
        overflow: hidden;
        margin-top: 4px;
    }
    .ci-cap-fill {
        height: 100%;
        border-radius: var(--ed-radius-pill);
        transition: width 260ms var(--ed-ease);
    }
    .ci-cap-meta {
        font-size: 0.72rem;
        color: var(--ed-ink-muted);
        margin-top: 4px;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .ci-bd-item { margin-bottom: 8px; }
    .ci-bd-item:last-child { margin-bottom: 0; }
    .ci-bd-label-wrap {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
    }
    .ci-bd-dot {
        width: 8px;
        height: 8px;
        border-radius: var(--ed-radius-pill);
        flex-shrink: 0;
    }
    .ci-bd-track {
        height: 6px;
        background: var(--ed-track);
        border-radius: var(--ed-radius-pill);
        overflow: hidden;
        margin-top: 3px;
    }
    .ci-bd-fill {
        height: 100%;
        border-radius: var(--ed-radius-pill);
    }
    .ci-bd-children {
        margin-top: 5px;
        padding-left: 14px;
    }

    /* Semantic Tone Tokens for Context Intelligence badges & icons */
    .ci-tone-accent { color: var(--ed-accent); }
    .ci-tone-good { color: var(--ed-good); }
    .ci-tone-warn { color: var(--ed-warn); }
    .ci-tone-danger { color: var(--ed-danger); }
    .ci-tone-cache { color: var(--ed-chart-cache); }
    .ci-tone-thinking { color: var(--ed-chart-thinking); }
    .ci-tone-neutral { color: var(--ed-ink-secondary); }

    .ci-badge.ci-tone-accent { background: var(--ed-surface); border-color: var(--ed-accent-border); color: var(--ed-accent); }
    .ci-badge.ci-tone-good { background: var(--ed-surface); border-color: var(--ed-good-border); color: var(--ed-good); }
    .ci-badge.ci-tone-warn { background: var(--ed-surface); border-color: var(--ed-warn-border); color: var(--ed-warn); }
    .ci-badge.ci-tone-danger { background: var(--ed-surface); border-color: var(--ed-danger-border); color: var(--ed-danger); }
    .ci-badge.ci-tone-cache { background: var(--ed-surface); border-color: var(--ed-border-strong); color: var(--ed-chart-cache); }
    .ci-badge.ci-tone-thinking { background: var(--ed-surface); border-color: var(--ed-border-strong); color: var(--ed-chart-thinking); }
    .ci-badge.ci-tone-neutral { background: var(--ed-surface); border-color: var(--ed-border); color: var(--ed-ink-secondary); }
    body .tab-pane :is(
        .model-stats-err-toggle:not(.is-off),
        .act-tl-gm-in,
        .act-tl-gm-out,
        .act-tl-gm-speed,
        .act-tl-gm-ttft,
        .act-tl-gm-stream,
        .act-tl-gm-cache,
        .act-tl-gm-cache-hit,
        .act-tl-gm-cost,
        .act-tl-gm-credit,
        .act-tl-gm-retry,
        .act-tl-gm-ctx,
        .seg-chip-calls,
        .seg-chip-speed,
        .seg-chip-ttft,
        .seg-chip-cache,
        .seg-chip-cache-hit,
        .seg-chip-credits,
        .seg-chip-cost,
        .seg-chip-ctx,
        .seg-chip-retry,
        .telemetry-warmth-badge.is-warm,
        .telemetry-warmth-badge.is-warming,
        .telemetry-delta-pill.is-faster,
        .act-conv-credits,
        .cp-card-chip-tok,
        .ci-badge.ci-tone-accent,
        .ci-badge.ci-tone-good,
        .ci-badge.ci-tone-warn,
        .ci-badge.ci-tone-danger,
        .ci-badge.ci-tone-cache,
        .ci-badge.ci-tone-thinking,
        .err-delta
    ) :is(.bi-sep, .bi-zh) {
        color: inherit;
    }

    .ci-dna-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .ci-dna-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 9px;
        border-radius: var(--ed-radius-xs);
        font-size: 0.72rem;
        font-family: var(--ed-mono);
        background: var(--ed-surface-well);
        color: var(--ed-ink-secondary);
        border: 1px solid var(--ed-border);
        white-space: nowrap;
        transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease);
    }
    .ci-dna-chip b { color: var(--ed-ink); font-weight: 600; }
    @media (hover: hover) {
        .ci-dna-chip:hover {
            background: var(--ed-surface-hover);
            border-color: var(--ed-border-strong);
        }
    }
    .ci-cfg-grid {
        display: flex;
        flex-direction: column;
        gap: 5px;
    }
    .ci-cfg-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        font-size: 0.78125rem;
    }
    .ci-cfg-label {
        font-family: var(--ed-mono);
        color: var(--ed-ink-muted);
        font-size: 0.75rem;
    }
    .ci-cfg-val {
        font-family: var(--ed-mono);
        font-weight: 600;
        color: var(--ed-ink);
        font-variant-numeric: tabular-nums lining-nums;
    }

    /* ─── Tool Call Ranking (L1 Card + 8px Studio Cobalt Capsule Bars) ─── */
    .tool-rank-section { margin-bottom: 24px; }
    .tool-rank-list {
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        padding: 12px 16px;
        list-style: none;
        margin: 0;
    }
    .tool-rank-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 0;
        font-size: 0.8125rem;
        border-bottom: 1px solid var(--ed-border);
        min-width: 0;
    }
    .tool-rank-row:last-child { border-bottom: none; }
    .tool-rank-idx {
        width: 20px;
        text-align: right;
        color: var(--ed-ink-muted);
        font-size: 0.75rem;
        font-variant-numeric: tabular-nums lining-nums;
        flex-shrink: 0;
    }
    .tool-rank-name {
        width: min(190px, 38%);
        flex-shrink: 0;
        font-family: var(--ed-mono);
        font-weight: 500;
        font-size: 0.78125rem;
        color: var(--ed-ink);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }
    .tool-rank-bar-wrap {
        flex: 1;
        min-width: 40px;
        height: 8px;
        background: var(--ed-track);
        border-radius: var(--ed-radius-pill);
        overflow: hidden;
    }
    .tool-rank-bar {
        display: block;
        height: 100%;
        border-radius: var(--ed-radius-pill);
        background: var(--ed-accent);
        transition: width 260ms var(--ed-ease);
        min-width: 4px;
    }
    .tool-rank-count {
        min-width: 40px;
        text-align: right;
        font-weight: 650;
        font-variant-numeric: tabular-nums lining-nums;
        color: var(--ed-ink);
        flex-shrink: 0;
    }
    .tool-rank-summary {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 16px;
        font-size: 0.75rem;
        color: var(--ed-ink-muted);
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--ed-border);
    }
    .tool-rank-summary b { color: var(--ed-ink); font-variant-numeric: tabular-nums lining-nums; }
    .tool-rank-delta {
        color: var(--ed-good);
        font-size: 0.75rem;
        font-weight: 600;
        margin-left: 3px;
        white-space: nowrap;
    }

    /* ── Tool Catalog Disclosure ── */
    .tool-cat-section {
        margin-top: 12px;
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        overflow: hidden;
    }
    .tool-cat-header {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.8125rem;
        font-weight: 550;
        color: var(--ed-ink);
        padding: 10px 14px;
        cursor: pointer;
        user-select: none;
        list-style: none;
        transition: background var(--ed-dur-fast) var(--ed-ease);
    }
    .tool-cat-header::-webkit-details-marker { display: none; }
    .tool-cat-header::before {
        content: '';
        width: 0;
        height: 0;
        border-left: 5px solid var(--ed-ink-muted);
        border-top: 4px solid transparent;
        border-bottom: 4px solid transparent;
        transition: transform 160ms var(--ed-ease);
        flex-shrink: 0;
    }
    .tool-cat-section[open] > .tool-cat-header::before {
        transform: rotate(90deg);
        border-left-color: var(--ed-ink);
    }
    @media (hover: hover) {
        .tool-cat-header:hover { background: var(--ed-surface-hover); }
    }
    .tool-cat-header svg {
        width: 14px;
        height: 14px;
        margin-right: 0;
        color: var(--ed-accent);
    }
    .tool-cat-chips {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 6px;
        padding: 12px 14px;
        border-top: 1px solid var(--ed-border);
    }
    .tool-cat-chip {
        position: relative;
        font-family: var(--ed-mono);
        font-size: 0.72rem;
        padding: 4px 8px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
        color: var(--ed-ink-secondary);
        text-align: center;
        transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease), color var(--ed-dur-fast) var(--ed-ease);
    }
    .tool-cat-chip-text {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    @media (hover: hover) {
        .tool-cat-chip:hover {
            background: var(--ed-surface-hover);
            border-color: var(--ed-border-strong);
            color: var(--ed-ink);
        }
    }
    .tool-cat-chip[data-tooltip]::after {
        content: attr(data-tooltip);
        position: absolute;
        left: 50%;
        bottom: calc(100% + 6px);
        transform: translateX(-50%) scale(0.94);
        padding: 4px 8px;
        background: var(--ed-surface-overlay);
        color: var(--ed-ink);
        border: 1px solid var(--ed-border-strong);
        border-radius: var(--ed-radius-sm);
        font-family: var(--ed-sans);
        font-size: 0.75rem;
        font-weight: 400;
        white-space: normal;
        word-break: break-word;
        max-width: 210px;
        width: max-content;
        text-align: center;
        z-index: var(--z-tooltip, 500);
        box-shadow: var(--ed-shadow-tooltip);
        pointer-events: none;
        opacity: 0;
        transition: opacity var(--ed-dur-fast) var(--ed-ease), transform var(--ed-dur-fast) var(--ed-ease);
    }
    .tool-cat-chip[data-tooltip]:hover::after {
        opacity: 1;
        transform: translateX(-50%) scale(1);
    }
    .tool-cat-footer {
        display: flex;
        justify-content: flex-end;
        padding: 6px 14px 12px;
    }
    .tool-cat-clear-btn {
        appearance: none;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 28px;
        font-family: inherit;
        font-size: 0.72rem;
        font-weight: 550;
        color: var(--ed-danger);
        background: transparent;
        border: 1px solid var(--ed-danger-border);
        border-radius: var(--ed-radius-sm);
        padding: 0 10px;
        cursor: pointer;
        transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease);
    }
    @media (hover: hover) {
        .tool-cat-clear-btn:hover {
            background: var(--ed-danger-tint);
            border-color: var(--ed-danger);
        }
    }
    .tool-cat-clear-btn:focus-visible {
        outline: 2px solid var(--ed-accent);
        outline-offset: 2px;
    }

    /* ─── Responsive Breakpoints (Zero Overflow down to 320px) ─── */
    @media (max-width: 680px) {
        .telemetry-ledger-grid {
            grid-template-columns: minmax(0, 1fr);
        }
    }

    @media (max-width: 640px) {
        .telemetry-ledger-card {
            padding: 14px 14px;
        }
        .telemetry-hero-val {
            font-size: 1.45rem;
        }
        .telemetry-ledger-row {
            flex-wrap: wrap;
        }
        .telemetry-pill,
        .telemetry-warmth-badge {
            white-space: normal;
            overflow-wrap: anywhere;
        }
        .act-summary-bar {
            position: relative;
            padding: 10px 12px;
            gap: 6px 10px;
        }
        .act-summary-bar .act-stat {
            position: static;
            border-right: none;
            padding: 3px 6px;
        }
        .act-stat-warn { margin-left: 0; }
        .act-summary-bar > .act-stat[data-tooltip]::after {
            left: 50%;
            right: auto;
            max-width: calc(100% - 20px);
            transform: translateX(-50%) scale(0.94);
        }
        .act-summary-bar > .act-stat[data-tooltip]:hover::after,
        .act-summary-bar > .act-stat[data-tooltip]:focus-visible::after {
            transform: translateX(-50%) scale(1);
        }
        .act-tl-item,
        .act-tl-turn-header,
        .cp-card-header,
        .act-conv-item,
        .acct-card {
            flex-wrap: wrap;
        }
        .acct-pools {
            flex-basis: 100%;
            align-items: flex-start;
        }
        .acct-pool-row { justify-content: flex-start; flex-wrap: wrap; }
        .acct-pool-models { justify-content: flex-start; }
        .act-tl-content,
        .act-tl-turn-text { flex-basis: 120px; }
        .act-tl-meta { max-width: 100%; flex-wrap: wrap; white-space: normal; }
        .act-conv-meta { flex-wrap: wrap; max-width: 100%; flex-shrink: 1; }
        .act-conv-meta-chip { white-space: normal; overflow-wrap: anywhere; max-width: 100%; }
        .act-tl-gm { max-width: 100%; min-width: 0; flex-wrap: wrap; flex-shrink: 1; }
        .seg-chips { flex-basis: 100%; max-width: 100%; min-width: 0; }
        .act-tl-gm-tag,
        .seg-chip,
        .cp-card-chip {
            max-width: 100%;
            white-space: normal;
            overflow-wrap: anywhere;
        }
        .act-tl-help-popup { width: min(260px, calc(100vw - 36px)); }
    }

    @media (prefers-reduced-motion: reduce) {
        .acct-card,
        .acct-quota-fill,
        .acct-delete-link,
        .act-stat,
        .telemetry-bar-fill,
        .telemetry-cache-seg,
        .act-model-card,
        .act-card-row,
        .model-stats-err-toggle,
        .act-tl-item,
        .act-tl-turn,
        .act-tl-turn-header,
        .act-tl-turn-header::before,
        .act-tl-help-btn,
        .act-tl-help-popup,
        .act-conv-item,
        .gm-err-expand,
        .gm-ue-header::before,
        .gm-ue-copy-btn,
        .gm-ue-tooltip,
        .gm-ue-summary::before,
        .ci-section-header,
        .ci-section-header::before,
        .cp-card,
        .cp-card-header,
        .cp-card-header::before,
        .ci-cap-fill,
        .ci-dna-chip,
        .tool-rank-bar,
        .tool-cat-header,
        .tool-cat-header::before,
        .tool-cat-chip,
        .tool-cat-chip[data-tooltip]::after,
        .tool-cat-clear-btn {
            transition: none;
        }
    }
    `;
}

// ─── Section Builders ────────────────────────────────────────────────────────

function buildSummaryBar(
    s: ActivitySummary | null,
    gm: GMSummary | null,
    currentCascadeId?: string,
    telemetry?: SessionTelemetrySummary,
): string {
    const fmt = fmtCompactTokens;
    const overall = telemetry?.overall ?? computeTelemetrySummary(gm, { activeCascadeId: currentCascadeId }).overall;

    // ── SVG icons (shared) ──
    const iconCalls = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
    const iconIn = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M5 10l7 7 7-7"/></svg>`;
    const iconOut = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V9M5 14l7-7 7 7"/></svg>`;
    const iconCache = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>`;
    const iconSpeed = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
    const iconTtft = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const iconCacheHit = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;
    const iconCredits = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`;
    const iconErr = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;

    // ── Helper: build Speed / Avg TTFT / Cache Hit KPI cells from account-filtered GM telemetry ──
    const buildTelemetryKpiCells = (tel: TelemetryAggregate): string => {
        if (!gm || tel.totalCalls <= 0) { return ''; }

        const speedTipParts: string[] = [];
        if (tel.weightedGenTokPerSec !== null) {
            speedTipParts.push(`${tBi('Weighted generation speed', '加权生成速度')} (n=${tel.speedSampleCount})`);
            if (tel.hasThinking && tel.weightedVisibleTokPerSec !== null) {
                speedTipParts.push(`${tBi('Visible resp', '可见输出')} ${formatSpeed(tel.weightedVisibleTokPerSec)}`);
            }
            if (tel.medianGenTokPerSec !== null) {
                speedTipParts.push(`${tBi('p50 median', 'p50 中位数')} ${formatSpeed(tel.medianGenTokPerSec)}`);
            }
            if (tel.weightedEndToEndTokPerSec !== null) {
                speedTipParts.push(`${tBi('End-to-End', '端到端')} ${formatSpeed(tel.weightedEndToEndTokPerSec)}`);
            }
        } else {
            speedTipParts.push(tBi('No timed streaming samples yet', '暂无有效流式耗时样本'));
        }
        const speedTip = speedTipParts.join(' · ');

        const ttftTipParts: string[] = [];
        if (tel.avgTtftSeconds !== null) {
            ttftTipParts.push(`${tBi('Average TTFT (valid timed samples)', '平均首字延迟（仅有效计时样本）')} (n=${tel.ttftSampleCount})`);
            if (tel.cachedAvgTtftSeconds !== null && tel.uncachedAvgTtftSeconds !== null) {
                ttftTipParts.push(`${tBi('Cached', '命中缓存')} ${formatLatency(tel.cachedAvgTtftSeconds)} vs ${tBi('Uncached', '未命中')} ${formatLatency(tel.uncachedAvgTtftSeconds)}`);
            } else if (tel.medianTtftSeconds !== null) {
                ttftTipParts.push(`p50 ${formatLatency(tel.medianTtftSeconds)}`);
            }
        } else {
            ttftTipParts.push(tBi('No valid TTFT samples yet', '暂无有效首字延迟样本'));
        }
        const ttftTip = ttftTipParts.join(' · ');

        const cacheHitTip = tel.tokenCacheHitRate !== null
            ? `${tBi('Token-weighted prompt cache hit rate', '按 Token 加权的提示词缓存命中率')} · ${fmt(tel.totalCacheReadTokens)} / ${fmt(tel.totalPromptTokens)} tokens · ${tel.cachedCallCount}/${tel.totalCalls} ${tBi('calls', '调用')}`
            : tBi('No prompt token data yet', '暂无提示词 Token 数据');
        const callRatioHtml = tel.tokenCacheHitRate !== null && tel.totalCalls > 0
            ? `<span class="act-stat-sub">${tel.cachedCallCount}/${tel.totalCalls}</span>`
            : '';

        return `<div class="act-stat act-stat-speed" data-tooltip="${esc(speedTip)}"><span class="act-stat-icon">${iconSpeed}</span><span class="act-stat-val val-speed">${esc(formatSpeed(tel.weightedGenTokPerSec))}</span><span class="act-stat-label">${tBiHtml('Speed', '生成速度')}</span></div>
            <div class="act-stat act-stat-ttft" data-tooltip="${esc(ttftTip)}"><span class="act-stat-icon">${iconTtft}</span><span class="act-stat-val val-ttft">${esc(formatLatency(tel.avgTtftSeconds))}</span><span class="act-stat-label">${tBiHtml('Avg TTFT', '平均首字')}</span></div>
            <div class="act-stat act-stat-cache-hit" data-tooltip="${esc(cacheHitTip)}"><span class="act-stat-icon">${iconCacheHit}</span><span class="act-stat-val val-cache-hit"><span>${esc(formatCachePercent(tel.tokenCacheHitRate))}</span>${callRatioHtml}</span><span class="act-stat-label">${tBiHtml('Cache Hit', '缓存命中')}</span></div>`;
    };

    // ── Helper: build error chip from GM data ──
    const buildErrorChip = (gm2: GMSummary): string => {
        const errTotal = Object.values(gm2.retryErrorCodes || {}).reduce((a, b) => a + b, 0);
        if (errTotal <= 0 && gm2.totalRetryCount <= 0) { return ''; }
        const byConv = gm2.retryErrorCodesByConv || {};
        const convCount = Object.keys(byConv).length;
        const currentConvErrs: Record<string, number> = (currentCascadeId && convCount > 1) ? (byConv[currentCascadeId] || {}) : {};
        const convDelta = Object.values(currentConvErrs).reduce((a, b) => a + b, 0);
        const errCodes = Object.entries(gm2.retryErrorCodes || {}).sort((a, b) => b[1] - a[1]).map(([c, n]) => { const d = currentConvErrs[c] || 0; return d > 0 ? `${c} ×${n} (+${d})` : `${c} ×${n}`; }).join(', ');
        const wasteInfo = gm2.totalRetryTokens > 0 ? ` · ${fmt(gm2.totalRetryTokens)} ${tBi('tokens wasted', '浪费 tokens')}` : '';
        const tipText = errCodes ? `${errCodes}${wasteInfo}` : `${gm2.totalRetryCount} ${tBi('retries', '重试')}${wasteInfo}`;
        const deltaHtml = convDelta > 0 ? ` <span class="err-delta">+${convDelta}</span>` : '';
        return `<div class="act-stat act-stat-warn" data-tooltip="${esc(tipText)}"><span class="act-stat-icon">${iconErr}</span><span class="act-stat-val">${errTotal > 0 ? errTotal : gm2.totalRetryCount}${deltaHtml}</span><span class="act-stat-label">${tBiHtml('Errors', '报错')}</span></div>`;
    };

    // When no activity data, show GM-only summary
    if (!s && gm) {
        return `<div class="act-summary-bar">
            <div class="act-stat"><span class="act-stat-icon">${iconCalls}</span><span class="act-stat-val val-calls">${gm.totalCalls}</span><span class="act-stat-label">${tBiHtml('Calls', '调用')}</span></div>
            <div class="act-stat"><span class="act-stat-icon">${iconIn}</span><span class="act-stat-val val-in">${fmt(gm.totalInputTokens)}</span><span class="act-stat-label">${tBiHtml('In', '输入')}</span></div>
            <div class="act-stat"><span class="act-stat-icon">${iconOut}</span><span class="act-stat-val val-out">${fmt(gm.totalOutputTokens)}</span><span class="act-stat-label">${tBiHtml('Out', '输出')}</span></div>
            ${gm.totalCacheRead > 0 ? `<div class="act-stat"><span class="act-stat-icon">${iconCache}</span><span class="act-stat-val val-cache">${fmt(gm.totalCacheRead)}</span><span class="act-stat-label">${tBiHtml('Cache', '缓存')}</span></div>` : ''}
            ${gm.totalCredits > 0 ? `<div class="act-stat"><span class="act-stat-icon">${iconCredits}</span><span class="act-stat-val val-credits">${gm.totalCredits.toFixed(1)}</span><span class="act-stat-label">${tBiHtml('Credits', '积分')}</span></div>` : ''}
            ${buildTelemetryKpiCells(overall)}
            ${buildErrorChip(gm)}
        </div>`;
    }

    if (!s) { return ''; }

    // GM-specific: calls chip
    let gmCallsChip = '';
    if (gm && gm.totalCalls > 0) {
        gmCallsChip = `<div class="act-stat" data-tooltip="${esc(tBi('Total LLM API calls', 'LLM API 调用总次数'))}"><span class="act-stat-icon">${iconCalls}</span><span class="act-stat-val val-calls">${gm.totalCalls}</span><span class="act-stat-label">${tBiHtml('Calls', '调用')}</span></div>`;
    }

    // Prefer account-filtered gm summary over cross-account ActivityTracker cached totals (#66 bug #7)
    const useFilteredGm = Boolean(gm && gm.totalCalls > 0);
    const hasGM = useFilteredGm || (s.gmTotalInputTokens || 0) > 0;
    const inTokens = useFilteredGm ? gm!.totalInputTokens : (hasGM ? s.gmTotalInputTokens! : s.totalInputTokens);
    const outTokens = useFilteredGm ? gm!.totalOutputTokens : (hasGM ? s.gmTotalOutputTokens! : s.totalOutputTokens);
    const inTooltip = hasGM
        ? tBi('Input tokens (all conversations)', '输入 tokens（全部对话）')
        : tBi('Cumulative input tokens consumed', '累计消耗的输入 tokens');
    const outTooltip = hasGM
        ? tBi('Output tokens (all conversations)', '输出 tokens（全部对话）')
        : tBi('Cumulative output tokens generated', '累计生成的输出 tokens');

    // Cache chip
    const cacheTokens = useFilteredGm ? gm!.totalCacheRead : (s.gmTotalCacheRead || 0);
    const cacheChip = cacheTokens > 0 ? `<div class="act-stat" data-tooltip="${esc(tBi('Cache read tokens', '缓存读取 tokens'))}"><span class="act-stat-icon">${iconCache}</span><span class="act-stat-val val-cache">${fmt(cacheTokens)}</span><span class="act-stat-label">${tBiHtml('Cache', '缓存')}</span></div>` : '';

    // Credits chip
    const credits = useFilteredGm ? gm!.totalCredits : (s.gmTotalCredits || 0);
    const creditsChip = credits > 0 ? `<div class="act-stat" data-tooltip="${esc(tBi('Credits consumed', '消耗的积分'))}"><span class="act-stat-icon">${iconCredits}</span><span class="act-stat-val val-credits">${credits.toFixed(1)}</span><span class="act-stat-label">${tBiHtml('Credits', '积分')}</span></div>` : '';

    // Tool output chip
    const toolOutChip = s.totalToolReturnTokens > 0 ? `<div class="act-stat" data-tooltip="${esc(tBi('Tokens returned by tool calls', '工具调用返回的 tokens'))}"><span class="act-stat-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 0 1 0 8h-1"/></svg></span><span class="act-stat-val">${fmt(s.totalToolReturnTokens)}</span><span class="act-stat-label">${tBiHtml('Tool Out', '工具输出')}</span></div>` : '';

    return `
    <div class="act-summary-bar">
        ${gmCallsChip}
        <div class="act-stat" data-tooltip="${esc(inTooltip)}"><span class="act-stat-icon">${iconIn}</span><span class="act-stat-val val-in">${fmt(inTokens)}</span><span class="act-stat-label">${tBiHtml('In', '输入')}</span></div>
        <div class="act-stat" data-tooltip="${esc(outTooltip)}"><span class="act-stat-icon">${iconOut}</span><span class="act-stat-val val-out">${fmt(outTokens)}</span><span class="act-stat-label">${tBiHtml('Out', '输出')}</span></div>
        ${toolOutChip}
        ${cacheChip}
        ${creditsChip}
        ${buildTelemetryKpiCells(overall)}
        ${gm ? buildErrorChip(gm) : ''}
    </div>`;
}

function buildTelemetryLedgerSection(telemetry: SessionTelemetrySummary): string {
    const o = telemetry.overall;
    if (o.totalCalls <= 0) { return ''; }

    const fmt = fmtCompactTokens;

    const sectionIcon = `<svg class="act-icon act-icon-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
    const speedIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>`;
    const cacheIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;

    // ── Left L1 Card: Generation Speed & TTFT ──
    const speedScopePill = o.speedSampleCount > 0
        ? `<span class="telemetry-pill"><span>${tBiHtml(`Weighted · ${o.speedSampleCount} timed`, `加权 · ${o.speedSampleCount} 次计时`)}</span></span>`
        : `<span class="telemetry-pill"><span>${tBiHtml('Weighted Avg', '加权平均')}</span></span>`;

    const speedHeroTipParts: string[] = [];
    if (o.weightedGenTokPerSec !== null) {
        speedHeroTipParts.push(`${tBi('Weighted Avg', '加权平均')}: ${formatSpeed(o.weightedGenTokPerSec)}`);
    }
    if (o.weightedEndToEndTokPerSec !== null) {
        speedHeroTipParts.push(`${tBi('End-to-End (incl. TTFT)', '端到端（含首字延迟）')}: ${formatSpeed(o.weightedEndToEndTokPerSec)}`);
    }
    if (o.hasThinking && o.weightedVisibleTokPerSec !== null) {
        speedHeroTipParts.push(`${tBi('Visible resp', '可见输出')}: ${formatSpeed(o.weightedVisibleTokPerSec)}`);
    }
    const speedHeroTitle = speedHeroTipParts.length > 0 ? ` title="${esc(speedHeroTipParts.join(' · '))}"` : '';

    const e2eHeroMeta = o.weightedEndToEndTokPerSec !== null
        ? `<span class="telemetry-hero-meta" title="${esc(tBi('End-to-end throughput including TTFT', '包含首字延迟的端到端速度'))}"><span>${tBiHtml('End-to-End', '端到端')} ${esc(formatSpeed(o.weightedEndToEndTokPerSec))}</span></span>`
        : '';

    const speedSubItems: string[] = [];
    if (o.latestGenTokPerSec !== null) {
        speedSubItems.push(`<div class="telemetry-subitem"><span class="telemetry-sub-label">${tBiHtml('Latest', '最近')}</span><span class="telemetry-sub-val">${esc(formatSpeed(o.latestGenTokPerSec))}</span></div>`);
    }
    if (o.medianGenTokPerSec !== null) {
        speedSubItems.push(`<div class="telemetry-subitem"><span class="telemetry-sub-label">${tBiHtml('Median p50', '中位数 p50')}</span><span class="telemetry-sub-val">${esc(formatSpeed(o.medianGenTokPerSec))}</span></div>`);
    }
    if (o.minGenTokPerSec !== null && o.maxGenTokPerSec !== null && o.speedSampleCount >= 2) {
        speedSubItems.push(`<div class="telemetry-subitem"><span class="telemetry-sub-label">${tBiHtml('Range', '范围')}</span><span class="telemetry-sub-val">${esc(formatSpeedRange(o.minGenTokPerSec, o.maxGenTokPerSec))}</span></div>`);
    }
    if (o.hasThinking && o.weightedVisibleTokPerSec !== null) {
        speedSubItems.push(`<div class="telemetry-subitem" title="${esc(tBi('Visible response tok/s excluding thinking tokens', '不含思考 Token 的可见回复速度'))}"><span class="telemetry-sub-label">${tBiHtml('Visible resp', '可见输出')}</span><span class="telemetry-sub-val">${esc(formatSpeed(o.weightedVisibleTokPerSec))}</span></div>`);
    }
    const speedSubHtml = speedSubItems.length > 0
        ? `<div class="telemetry-subgrid">${speedSubItems.join('')}</div>`
        : `<p class="telemetry-empty-note">${tBiHtml('No timed streaming samples yet.', '暂无有效流式耗时样本。')}</p>`;

    // Cached vs Uncached TTFT Comparison
    let ttftDeltaHtml = '';
    if (o.cachedAvgTtftSeconds !== null && o.uncachedAvgTtftSeconds !== null && o.ttftCacheDeltaPct !== null) {
        const roundedDelta = Math.round(o.ttftCacheDeltaPct);
        const sign = roundedDelta > 0 ? '+' : '';
        const deltaCls = roundedDelta < 0 ? 'is-faster' : 'is-neutral';
        const deltaTip = roundedDelta < 0
            ? tBi(`Cached TTFT is ${Math.abs(roundedDelta)}% faster than uncached`, `命中缓存首字延迟比未命中快 ${Math.abs(roundedDelta)}%`)
            : roundedDelta > 0
                ? tBi(`Cached TTFT is ${roundedDelta}% slower than uncached`, `命中缓存首字延迟比未命中慢 ${roundedDelta}%`)
                : tBi('Cached and uncached TTFT are equal', '命中与未命中缓存首字延迟相同');
        ttftDeltaHtml = `<span class="telemetry-delta-pill ${deltaCls}" title="${esc(deltaTip)}">${sign}${roundedDelta}%</span>`;
    }

    let ttftTracksHtml = '';
    if (o.cachedAvgTtftSeconds !== null && o.uncachedAvgTtftSeconds !== null) {
        const maxTtft = Math.max(o.cachedAvgTtftSeconds, o.uncachedAvgTtftSeconds);
        const cachedPct = maxTtft > 0 ? Math.max(4, Math.round((o.cachedAvgTtftSeconds / maxTtft) * 100)) : 0;
        const uncachedPct = maxTtft > 0 ? Math.max(4, Math.round((o.uncachedAvgTtftSeconds / maxTtft) * 100)) : 0;
        ttftTracksHtml = `<div class="telemetry-ttft-rows">
            <div class="telemetry-ttft-row">
                <div class="telemetry-ttft-row-head">
                    <span class="telemetry-ttft-label">${tBiHtml('Cached TTFT', '命中缓存')}</span>
                    <span class="telemetry-ttft-val">${esc(formatLatency(o.cachedAvgTtftSeconds))}<span class="telemetry-sample-n">(n=${o.cachedTtftCount})</span></span>
                </div>
                <div class="telemetry-bar-track"><span class="telemetry-bar-fill telemetry-bar-fill-cache" style="width:${cachedPct}%"></span></div>
            </div>
            <div class="telemetry-ttft-row">
                <div class="telemetry-ttft-row-head">
                    <span class="telemetry-ttft-label">${tBiHtml('Uncached TTFT', '未命中缓存')}</span>
                    <span class="telemetry-ttft-val">${esc(formatLatency(o.uncachedAvgTtftSeconds))}<span class="telemetry-sample-n">(n=${o.uncachedTtftCount})</span></span>
                </div>
                <div class="telemetry-bar-track"><span class="telemetry-bar-fill telemetry-bar-fill-uncached" style="width:${uncachedPct}%"></span></div>
            </div>
        </div>`;
    } else if (o.cachedAvgTtftSeconds !== null) {
        ttftTracksHtml = `<div class="telemetry-ttft-rows">
            <div class="telemetry-ttft-row">
                <div class="telemetry-ttft-row-head">
                    <span class="telemetry-ttft-label">${tBiHtml('Cached TTFT', '命中缓存')}</span>
                    <span class="telemetry-ttft-val">${esc(formatLatency(o.cachedAvgTtftSeconds))}<span class="telemetry-sample-n">(n=${o.cachedTtftCount})</span></span>
                </div>
                <div class="telemetry-bar-track"><span class="telemetry-bar-fill telemetry-bar-fill-cache" style="width:100%"></span></div>
            </div>
            <p class="telemetry-single-note">${tBiHtml('All timed calls cached', '全部计时调用均已命中缓存')}</p>
        </div>`;
    } else if (o.uncachedAvgTtftSeconds !== null) {
        ttftTracksHtml = `<div class="telemetry-ttft-rows">
            <div class="telemetry-ttft-row">
                <div class="telemetry-ttft-row-head">
                    <span class="telemetry-ttft-label">${tBiHtml('Uncached TTFT', '未命中缓存')}</span>
                    <span class="telemetry-ttft-val">${esc(formatLatency(o.uncachedAvgTtftSeconds))}<span class="telemetry-sample-n">(n=${o.uncachedTtftCount})</span></span>
                </div>
                <div class="telemetry-bar-track"><span class="telemetry-bar-fill telemetry-bar-fill-uncached" style="width:100%"></span></div>
            </div>
            <p class="telemetry-single-note">${tBiHtml('No cached TTFT samples yet', '暂无命中缓存的首字延迟样本')}</p>
        </div>`;
    } else if (o.avgTtftSeconds !== null) {
        const rangeNote = o.minTtftSeconds !== null && o.maxTtftSeconds !== null && o.ttftSampleCount >= 2
            ? `<p class="telemetry-single-note"><span>${tBiHtml('Range', '范围')} ${esc(formatLatency(o.minTtftSeconds))}–${esc(formatLatency(o.maxTtftSeconds))}</span></p>`
            : '';
        ttftTracksHtml = `<div class="telemetry-ttft-rows">
            <div class="telemetry-ttft-row">
                <div class="telemetry-ttft-row-head">
                    <span class="telemetry-ttft-label">${tBiHtml('Avg TTFT', '平均首字')}</span>
                    <span class="telemetry-ttft-val">${esc(formatLatency(o.avgTtftSeconds))}<span class="telemetry-sample-n">(n=${o.ttftSampleCount})</span></span>
                </div>
                <div class="telemetry-bar-track"><span class="telemetry-bar-fill telemetry-bar-fill-avg" style="width:100%"></span></div>
            </div>
            ${rangeNote}
        </div>`;
    } else {
        ttftTracksHtml = `<p class="telemetry-single-note">${tBiHtml('No valid TTFT samples yet', '暂无有效首字延迟样本')}</p>`;
    }

    const ttftFootParts: string[] = [];
    if (o.medianTtftSeconds !== null) {
        ttftFootParts.push(`p50 ${esc(formatLatency(o.medianTtftSeconds))}`);
    }
    if (o.p95TtftSeconds !== null && o.ttftSampleCount >= 2) {
        ttftFootParts.push(`p95 ${esc(formatLatency(o.p95TtftSeconds))}`);
    }
    if (o.avgStreamingSeconds !== null) {
        ttftFootParts.push(`<span>${tBiHtml('Avg Stream', '平均流耗时')} ${esc(formatLatency(o.avgStreamingSeconds))}</span>`);
    }
    const ttftFootHtml = ttftFootParts.length > 0
        ? `<p class="telemetry-ttft-foot">${ttftFootParts.join(' · ')}</p>`
        : '';

    const leftCard = `<div class="telemetry-ledger-card telemetry-card-speed">
        <div class="telemetry-card-head">
            <span class="telemetry-card-title-wrap">${speedIcon}<h3 class="telemetry-card-title">${tBiHtml('Generation Speed & TTFT', '生成速度与首字延迟')}</h3></span>
            ${speedScopePill}
        </div>
        <div class="telemetry-hero-row"${speedHeroTitle}>
            <span class="telemetry-hero-val${o.weightedGenTokPerSec === null ? ' is-empty' : ''}">${esc(formatSpeed(o.weightedGenTokPerSec))}</span>
            ${e2eHeroMeta}
        </div>
        ${speedSubHtml}
        <div class="telemetry-ttft-block">
            <div class="telemetry-subhead">
                <span class="telemetry-subhead-title">${tBiHtml('Cached vs Uncached TTFT', '首字缓存延迟对比')}</span>
                ${ttftDeltaHtml}
            </div>
            ${ttftTracksHtml}
            ${ttftFootHtml}
        </div>
    </div>`;

    // ── Right L1 Card: Prompt Cache Efficiency & Savings ──
    const warmthLabels: Record<CacheState, string> = {
        warm: tBiHtml('Warm', '已命中'),
        warming: tBiHtml('Warming', '预热中'),
        cold: tBiHtml('Cold', '未命中'),
        unknown: tBiHtml('No data', '无数据'),
    };
    const warmthBadge = `<span class="telemetry-warmth-badge is-${o.latestCacheState}"><span>${warmthLabels[o.latestCacheState]}</span></span>`;

    const totalPrompt = o.totalPromptTokens;
    const readPct = totalPrompt > 0 ? (o.totalCacheReadTokens / totalPrompt) * 100 : 0;
    const freshPct = totalPrompt > 0 ? (o.totalFreshInputTokens / totalPrompt) * 100 : 0;
    const writePct = totalPrompt > 0 ? (o.totalCacheCreationTokens / totalPrompt) * 100 : 0;

    const segRead = readPct > 0
        ? `<span class="telemetry-cache-seg telemetry-cache-seg-read" style="width:${readPct.toFixed(2)}%" title="${esc(`${tBi('Cache Read', '缓存读取')}: ${fmt(o.totalCacheReadTokens)} tokens (${readPct.toFixed(1)}%)`)}"></span>`
        : '';
    const segFresh = freshPct > 0
        ? `<span class="telemetry-cache-seg telemetry-cache-seg-fresh" style="width:${freshPct.toFixed(2)}%" title="${esc(`${tBi('Fresh Input', '新增输入')}: ${fmt(o.totalFreshInputTokens)} tokens (${freshPct.toFixed(1)}%)`)}"></span>`
        : '';
    const segWrite = writePct > 0
        ? `<span class="telemetry-cache-seg telemetry-cache-seg-write" style="width:${writePct.toFixed(2)}%" title="${esc(`${tBi('Cache Write', '缓存写入')}: ${fmt(o.totalCacheCreationTokens)} tokens (${writePct.toFixed(1)}%)`)}"></span>`
        : '';

    const cacheWriteLegend = o.totalCacheCreationTokens > 0
        ? `<span class="telemetry-legend-item"><span class="telemetry-legend-dot telemetry-legend-dot-write"></span><span>${tBiHtml('Cache Write', '缓存写入')}</span></span>`
        : '';

    const cacheWriteSub = o.totalCacheCreationTokens > 0
        ? ` · <span>${tBiHtml('Cache Write', '缓存写入')} ${fmt(o.totalCacheCreationTokens)}</span>`
        : '';

    const reuseSub = o.totalCacheCreationTokens > 0 && o.cacheReuseRate !== null
        ? `<span class="telemetry-ledger-sub"><span>· ${tBiHtml('Reuse', '复用')} ${esc(formatCachePercent(o.cacheReuseRate))}</span></span>`
        : '';

    const savingsHtml = o.estCacheSavedTokens > 0
        ? `<span><b>${fmt(o.estCacheSavedTokens)}</b> tokens</span>${o.estCacheSavingsUsd !== null && o.estCacheSavingsUsd > 0 ? `<span class="telemetry-savings-usd">· ${esc(formatSavingsUsd(o.estCacheSavingsUsd))}</span>` : ''}`
        : `<span class="telemetry-ledger-muted">—</span>`;

    const cacheHeroCls = o.tokenCacheHitRate === null ? ' is-empty' : o.tokenCacheHitRate > 0 ? ' is-cache' : '';
    const cacheHeroMeta = totalPrompt > 0
        ? `<span class="telemetry-hero-meta"><span>${fmt(totalPrompt)} ${tBiHtml('prompt tokens', '提示词 tokens')}</span></span>`
        : `<span class="telemetry-hero-meta"><span>${tBiHtml('Token-weighted hit rate', '按 Token 加权命中率')}</span></span>`;

    const rightCard = `<div class="telemetry-ledger-card telemetry-card-cache">
        <div class="telemetry-card-head">
            <span class="telemetry-card-title-wrap">${cacheIcon}<h3 class="telemetry-card-title">${tBiHtml('Prompt Cache Efficiency & Savings', '首字与提示词缓存')}</h3></span>
            ${warmthBadge}
        </div>
        <div class="telemetry-hero-row">
            <span class="telemetry-hero-val${cacheHeroCls}">${esc(formatCachePercent(o.tokenCacheHitRate))}</span>
            ${cacheHeroMeta}
        </div>
        <div class="telemetry-cache-bar-wrap">
            <div class="telemetry-cache-bar-track">${segRead}${segFresh}${segWrite}</div>
            <div class="telemetry-cache-legend">
                <span class="telemetry-legend-item"><span class="telemetry-legend-dot telemetry-legend-dot-read"></span><span>${tBiHtml('Cache Read', '缓存读取')}</span></span>
                <span class="telemetry-legend-item"><span class="telemetry-legend-dot telemetry-legend-dot-fresh"></span><span>${tBiHtml('Fresh Input', '新增输入')}</span></span>
                ${cacheWriteLegend}
            </div>
        </div>
        <div class="telemetry-ledger-rows">
            <div class="telemetry-ledger-row">
                <span class="telemetry-ledger-key">${tBiHtml('Cache Read', '缓存读取')}</span>
                <span class="telemetry-ledger-val-group"><b>${fmt(o.totalCacheReadTokens)}</b><span class="telemetry-ledger-sub"><span>${tBiHtml('Fresh Input', '新增输入')} ${fmt(o.totalFreshInputTokens)}</span>${cacheWriteSub}</span></span>
            </div>
            <div class="telemetry-ledger-row">
                <span class="telemetry-ledger-key">${tBiHtml('Call Hit Ratio', '命中调用')}</span>
                <span class="telemetry-ledger-val-group"><span><b>${o.cachedCallCount} / ${o.totalCalls}</b> ${tBiHtml(o.totalCalls === 1 ? 'call' : 'calls', '调用')}</span>${reuseSub}</span>
            </div>
            <div class="telemetry-ledger-row">
                <span class="telemetry-ledger-key">${tBiHtml('Est. Cache Savings', '缓存节省')}</span>
                <span class="telemetry-ledger-val-group">${savingsHtml}</span>
            </div>
        </div>
    </div>`;

    return `<section class="telemetry-ledger-section" id="telemetryLedgerSection">
        <h2 class="act-section-title">${sectionIcon}<span>${tBiHtml('Speed & First-Token Cache', '生成速度与首字缓存')}</span></h2>
        <div class="telemetry-ledger-grid">
            ${leftCard}
            ${rightCard}
        </div>
    </section>`;
}

function buildModelCards(
    s: ActivitySummary | null,
    gm: GMSummary | null,
    activeEmail = '',
    custom: Record<string, ModelPricing> = {},
    telemetry?: SessionTelemetrySummary,
): string {
    const actEntries = s ? Object.entries(s.modelStats).sort((a, b) => b[1].totalSteps - a[1].totalSteps) : [];
    const gmBreakEarly: Record<string, GMModelStats> | null = gm?.modelBreakdown ?? null;
    if (!gmBreakEarly || Object.keys(gmBreakEarly).length === 0) { return ''; }
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
    // Filter: only show models that have GM data — Step API step counts are outdated/unreliable
    const entries = gmBreakEarly
        ? actEntries.filter(([name]) => {
            const gmStats = gmBreakEarly[name];
            return gmStats && gmStats.callCount > 0;
        })
        : actEntries;
    const ICONS = {
        tool: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
        speed: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>`,
        save: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
        bar: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
        clock: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
        sum: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
        coin: `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>`,
    };
    if (entries.length === 0 && gmOnlyEntries.length === 0) { return ''; }

    const modelCostRow = (name: string, stats: GMModelStats): string => {
        const model = selectPricingModel(name, stats.responseModel, custom);
        const price = findPricingWithCustom(model, custom);
        if (!price) { return ''; }
        const cost = costFromTokens({
            inputTokens: stats.totalInputTokens,
            outputTokens: stats.totalOutputTokens,
            thinkingTokens: stats.totalThinkingTokens,
            cacheReadTokens: stats.totalCacheRead,
        }, price);
        if (cost <= 0) { return ''; }
        const amount = cost.toFixed(cost < 0.01 ? 4 : cost < 1 ? 3 : 2);
        return `<div class="act-card-row act-card-row-cost"><span>${ICONS.coin} <span>${tBiHtml('Cost', '费用')}</span></span><span class="val val-cost">$${amount}</span></div>`;
    };
    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    // ── Build per-account call counts + error counts for each model + cross-account totals ──
    const accountCallsByModel = new Map<string, Map<string, number>>();
    const accountErrorsByModel = new Map<string, Map<string, number>>();
    let hasAnyAccountErrors = false;
    if (gm) {
        const todayKey = toLocalDateKey();
        const dayStartMs = dateKeyToStartOfDayMs(todayKey);

        for (const conv of gm.conversations) {
            for (const call of conv.calls) {
                if (dayStartMs > 0 && call.createdAt) {
                    const callMs = Date.parse(call.createdAt);
                    if (!isNaN(callMs) && callMs < dayStartMs) {
                        continue;
                    }
                }

                const email = call.accountEmail || '';
                if (!email) { continue; }
                const modelName = normalizeModelDisplayName(call.modelDisplay || call.model) || call.modelDisplay || call.model;
                if (!modelName) { continue; }

                let byAccount = accountCallsByModel.get(modelName);
                if (!byAccount) {
                    byAccount = new Map<string, number>();
                    accountCallsByModel.set(modelName, byAccount);
                }
                byAccount.set(email, (byAccount.get(email) || 0) + 1);

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
    const userSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const buildAccountSection = (modelName: string): string => {
        const byAccount = accountCallsByModel.get(modelName);
        if (!byAccount || byAccount.size < 1) { return ''; }
        const errByAccount = accountErrorsByModel.get(modelName);
        const sorted = [...byAccount.entries()].sort((a, b) => {
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

    const renderModelGmRows = (name: string, gmStats: GMModelStats): string => {
        const normalizedKey = (normalizeModelDisplayName(name) || name).trim();
        const modelTel: TelemetryAggregate = telemetry?.byModel[normalizedKey]
            ?? telemetry?.byModel[name]
            ?? computeTelemetryAggregateFromModelStats({ [normalizedKey || name]: gmStats }, custom);
        const creditCalls = gmStats.creditCallCount || 0;
        const speedSub = modelTel.hasThinking && modelTel.weightedVisibleTokPerSec !== null && modelTel.weightedGenTokPerSec !== null
            ? `<span class="act-card-sub"><span>${tBiHtml('resp', '可见')} ${esc(formatSpeed(modelTel.weightedVisibleTokPerSec))}</span></span>`
            : '';
        const speedValHtml = speedSub
            ? `<span class="val val-speed act-card-val-stack"><span>${esc(formatSpeed(modelTel.weightedGenTokPerSec))}</span>${speedSub}</span>`
            : `<span class="val val-speed">${esc(formatSpeed(modelTel.weightedGenTokPerSec))}</span>`;

        const ttftSub = modelTel.cachedAvgTtftSeconds !== null && modelTel.uncachedAvgTtftSeconds !== null
            ? `<span class="act-card-sub"><span>${tBiHtml('cached', '命中缓存')} ${esc(formatLatency(modelTel.cachedAvgTtftSeconds))}</span></span>`
            : '';
        const ttftValHtml = ttftSub
            ? `<span class="val val-time act-card-val-stack"><span>${esc(formatLatency(modelTel.avgTtftSeconds))}</span>${ttftSub}</span>`
            : `<span class="val val-time">${esc(formatLatency(modelTel.avgTtftSeconds))}</span>`;

        const avgStream = modelTel.avgStreamingSeconds ?? (('avgStreaming' in gmStats && gmStats.avgStreaming > 0) ? gmStats.avgStreaming : null);
        const cacheCreation = gmStats.totalCacheCreation || modelTel.totalCacheCreationTokens || 0;
        const showCacheHitRow = modelTel.tokenCacheHitRate !== null
            && (modelTel.totalCacheReadTokens > 0 || cacheCreation > 0 || modelTel.cachedCallCount > 0 || gmStats.cacheHitRate > 0);
        const cacheHitCallsTotal = modelTel.totalCalls > 0 ? modelTel.totalCalls : gmStats.callCount;

        return `
        <div class="act-card-row"><span>${ICONS.tool} <span>${tBiHtml('Calls', '调用')}</span></span><span class="val val-calls">${gmStats.callCount}</span></div>
        <div class="act-card-row"><span>${ICONS.speed} <span>${tBiHtml('Speed', '生成速度')}</span></span>${speedValHtml}</div>
        <div class="act-card-row"><span>${ICONS.clock} <span>${tBiHtml('Avg TTFT', '平均 TTFT')}</span></span>${ttftValHtml}</div>
        ${avgStream !== null ? `<div class="act-card-row"><span>${ICONS.sum} <span>${tBiHtml('Avg Stream', '平均流耗时')}</span></span><span class="val val-time">${esc(formatLatency(avgStream))}</span></div>` : ''}
        <div class="act-card-row"><span>${ICONS.coin} <span>${tBiHtml('In', '输入')}</span></span><span class="val val-in">${fmt(gmStats.totalInputTokens)}</span></div>
        <div class="act-card-row"><span>${ICONS.coin} <span>${tBiHtml('Out', '输出')}</span></span><span class="val val-out">${fmt(gmStats.totalOutputTokens)}</span></div>
        ${'totalThinkingTokens' in gmStats && gmStats.totalThinkingTokens > 0 ? `<div class="act-card-row"><span>${ICONS.coin} <span>${tBiHtml('Think', '思考')}</span></span><span class="val val-out">${fmt(gmStats.totalThinkingTokens)}</span></div>` : ''}
        ${gmStats.totalCacheRead > 0 ? `<div class="act-card-row"><span>${ICONS.save} <span>${tBiHtml('Cache', '缓存')}</span></span><span class="val val-cache">${fmt(gmStats.totalCacheRead)}</span></div>` : ''}
        ${cacheCreation > 0 ? `<div class="act-card-row"><span>${ICONS.save} <span>${tBiHtml('Cache Write', '缓存写入')}</span></span><span class="val val-cache-write">${fmt(cacheCreation)}</span></div>` : ''}
        ${gmStats.totalCredits > 0 ? `<div class="act-card-row"><span>${ICONS.coin} <span>${tBiHtml('Credits', '积分')}</span></span><span class="val val-credits">${gmStats.totalCredits.toFixed(1)} <span class="act-credit-calls"><span>(${tBiHtml(`${creditCalls}×`, `${creditCalls} 次`)})</span></span></span></div>` : ''}
        ${modelCostRow(name, gmStats)}
        ${showCacheHitRow ? `<div class="act-card-row"><span>${ICONS.bar} <span>${tBiHtml('Cache Hit', '缓存命中')}</span></span><span class="val val-hit"><span>${esc(formatCachePercent(modelTel.tokenCacheHitRate))}</span><span class="act-credit-calls">· ${modelTel.cachedCallCount}/${cacheHitCallsTotal}</span></span></div>` : ''}
        `;
    };

    // Error toggle button (only shown when any account has errors)
    const errToggleSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    const errToggleBtn = hasAnyAccountErrors
        ? `<button type="button" class="model-stats-err-toggle is-off" id="modelStatsErrToggle" title="${esc(tBi('Toggle error count visibility', '切换报错次数显示'))}">${errToggleSvg} <span>${tBiHtml('Errors', '报错')}</span></button>`
        : '';
    let html = `<h2 class="act-section-title"><svg class="act-icon act-icon-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg><span>${tBiHtml('Model Stats', '模型统计')}</span>${errToggleBtn}</h2>`;

    html += `<div class="act-cards-grid">`;
    const gmBreak = gmBreakEarly;
    for (const [name, ms] of entries) {
        const isCheckpointOnly = ms.reasoning === 0 && ms.toolCalls === 0 && ms.checkpoints > 0 && ms.estSteps === 0;

        let gmSection = '';
        if (gmBreak) {
            const gmStats = gmBreak[name];
            if (gmStats && gmStats.callCount > 0) {
                gmSection = renderModelGmRows(name, gmStats);
            }
        }

        html += `
        <div class="act-model-card${isCheckpointOnly ? ' act-checkpoint-model' : ''}">
            <div class="act-card-header" title="${esc(normalizeModelDisplayName(name))}">${esc(normalizeModelDisplayName(name))}${isCheckpointOnly ? ` <span class="act-badge">${ICONS.save}</span>` : ''}</div>
            <div class="act-card-body">
                ${gmSection}
                ${buildAccountSection(name)}
            </div>
        </div>`;
    }
    // GM-only models: models in GM data but not in Activity modelStats (unified Calls-first layout, #66 bug #5)
    for (const [name, gms] of gmOnlyEntries) {
        html += `
        <div class="act-model-card">
            <div class="act-card-header" title="${esc(normalizeModelDisplayName(name))}">${esc(normalizeModelDisplayName(name))}</div>
            <div class="act-card-body">
                ${renderModelGmRows(name, gms)}
                ${buildAccountSection(name)}
            </div>
        </div>`;
    }
    html += `</div>`;

    return html;
}

function buildTimeline(s: ActivitySummary, currentUsage?: ContextUsage | null, gm?: GMSummary | null, custom: Record<string, ModelPricing> = {}): string {
    const currentCascadeId = currentUsage?.cascadeId;
    const scopedEvents = currentCascadeId
        ? s.recentSteps.filter(event => event.cascadeId === currentCascadeId)
        : s.recentSteps;
    const orderedEvents = [...scopedEvents];
    if (orderedEvents.length === 0) {
        if (!currentCascadeId) { return ''; }
        return `<h2 class="act-section-title"><svg class="act-icon act-icon-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>${tBiHtml('Recent Activity', '最近操作')}</span></h2><p class="empty-msg">${tBiHtml('No recent activity for the current conversation yet.', '当前对话暂时还没有可显示的最近操作。')}</p>`;
    }

    const fmtTok = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    const getTimelineIcon = (e: any) => {
        if (e.icon === '❌') return `<svg class="act-icon act-icon-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
        if (e.icon === '💾') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
        if (e.icon === '📊') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>`;
        if (e.category === 'reasoning') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z"/><path d="M9 17h6M10 21h4"/></svg>`;
        if (e.category === 'user') return `<svg class="act-icon act-icon-good" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
        if (e.category === 'tool') {
            if (e.icon === '🌐') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
            if (e.icon === '🔍' || e.icon === '🔎') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;
            if (e.icon === '📂') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
            if (e.icon === '📄') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
            if (e.icon === '✏️') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
            return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
        }
        if (e.category === 'system') return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`;
        return `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
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

    // Build compact help tooltip
    const helpPopup = `<div class="act-tl-help-wrap">
        <span class="act-tl-help-btn" aria-label="${esc(tBi('Timeline legend', '时间线图例'))}">?</span>
        <div class="act-tl-help-popup">
            <div class="act-tl-help-group-label">${tBiHtml('Step Basics', '步骤基础')}</div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-time">08:20</span></div><div class="act-tl-help-desc">${tBiHtml('Timestamp', '步骤时间')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-step-idx">#115</span></div><div class="act-tl-help-desc">${tBiHtml('Step index', '步骤索引')}</div></div>
            <div class="act-tl-help-divider"></div>
            <div class="act-tl-help-group-label">${tBiHtml('Token Metrics', 'Token 指标')}</div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-cache"><span>176k ${tBiHtml('cache', '缓存')}</span></span></div><div class="act-tl-help-desc">${tBiHtml('Cache read', '缓存读取')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-in"><span>1.3k ${tBiHtml('in', '输入')}</span></span></div><div class="act-tl-help-desc">${tBiHtml('Input tokens', '输入 tokens')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-out"><span>117 ${tBiHtml('out', '输出')}</span></span></div><div class="act-tl-help-desc">${tBiHtml('Output tokens', '输出 tokens')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-ctx"><span>${tBiHtml('Estimated context 142k', '估算上下文 142k')}</span></span></div><div class="act-tl-help-desc">${esc(estimatedContextDescription())}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-credit"><span>9 ${tBiHtml('credits', '积分')}</span></span></div><div class="act-tl-help-desc">${tBiHtml('Credits', '积分')}</div></div>
            <div class="act-tl-help-divider"></div>
            <div class="act-tl-help-group-label">${tBiHtml('Performance', '性能')}</div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-speed">64.2 tok/s</span></div><div class="act-tl-help-desc">${tBiHtml('Generation speed', '生成速度')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-ttft">TTFT 1.20s</span></div><div class="act-tl-help-desc">${tBiHtml('Time to first token', '首字延迟')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-stream"><span>${tBiHtml('Stream', '流式')} 2.50s</span></span></div><div class="act-tl-help-desc">${tBiHtml('Streaming decode time', '流式生成耗时')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-gm-tag act-tl-gm-cache-hit"><span>${tBiHtml('Cache', '缓存')} 82.0%</span></span></div><div class="act-tl-help-desc">${tBiHtml('Prompt cache hit rate', '提示词缓存命中率')}</div></div>
            <div class="act-tl-help-row"><div class="act-tl-help-sample"><span class="act-tl-dur">538ms</span></div><div class="act-tl-help-desc">${tBiHtml('Duration', '耗时')}</div></div>
        </div>
    </div>`;

    // Build inline checkpoint viewer (from GM data for current conversation)
    let checkpointHtml = '';
    if (gm && gm.totalCalls > 0) {
        checkpointHtml = buildContextIntelViewer(gm);
    }

    let html = `<h2 class="act-section-title"><svg class="act-icon act-icon-good" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>${tBiHtml('Recent Activity', '最近操作')}</span>${scopeBadge}${helpPopup}</h2>
    ${checkpointHtml}
    <div class="act-timeline">`;

    const renderEventRow = (e: any, extraClass = '') => {
        const time = formatTime(e.timestamp);
        const dur = e.durationMs > 0 ? `<span class="act-tl-dur">${e.durationMs < 1000 ? e.durationMs + 'ms' : (e.durationMs / 1000).toFixed(1) + 's'}</span>` : '';
        let detail = '';
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

        // GM precision data tags — only show on reasoning steps (tools share the same GM call)
        let gmTags = '';
        if (e.category === 'reasoning' && e.gmInputTokens !== undefined) {
            const costSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
            const tokenParts: string[] = [];
            if (e.gmModel) {
                const pricing = findPricingWithCustom(e.gmModel, custom);
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
            if (e.gmCacheReadTokens && e.gmCacheReadTokens > 0) {
                tokenParts.push(`<span class="act-tl-gm-tag act-tl-gm-cache"><span>${fmtTok(e.gmCacheReadTokens)} ${tBiHtml('cache', '缓存')}</span></span>`);
                const stepCacheRate = computeStepCacheHitRate(e.gmInputTokens, e.gmCacheReadTokens, e.gmCacheCreationTokens);
                if (stepCacheRate !== null) {
                    tokenParts.push(`<span class="act-tl-gm-tag act-tl-gm-cache-hit"><span>${tBiHtml('Cache', '缓存')} ${esc(formatCachePercent(stepCacheRate))}</span></span>`);
                }
            }
            tokenParts.push(`<span class="act-tl-gm-tag act-tl-gm-in"><span>${fmtTok(e.gmInputTokens)} ${tBiHtml('in', '输入')}</span></span>`);
            if (e.gmOutputTokens) { tokenParts.push(`<span class="act-tl-gm-tag act-tl-gm-out"><span>${fmtTok(e.gmOutputTokens)} ${tBiHtml('out', '输出')}</span></span>`); }
            if (e.gmContextTokensUsed) { tokenParts.push(`<span class="act-tl-gm-tag act-tl-gm-ctx" title="${esc(estimatedContextDescription())}">${tBi('Estimated context', '估算上下文')} ${fmtTok(e.gmContextTokensUsed)}</span>`); }

            const statusParts: string[] = [];
            if (e.gmRetries && e.gmRetries > 0) {
                statusParts.push(`<span class="act-tl-gm-tag act-tl-gm-retry"><span>${tBiHtml(`${e.gmRetries} ${e.gmRetries === 1 ? 'error' : 'errors'}`, `${e.gmRetries} 次报错`)}</span></span>`);
            }
            if (e.gmCredits && e.gmCredits > 0) {
                statusParts.push(`<span class="act-tl-gm-tag act-tl-gm-credit"><span>${e.gmCredits} ${tBiHtml(e.gmCredits === 1 ? 'credit' : 'credits', '积分')}</span></span>`);
            }
            if (e.detail) {
                const toolMatch = e.detail.match(/\u2192\s*(\d+)\s*/);
                if (toolMatch) {
                    const count = parseInt(toolMatch[1], 10);
                    if (count > 0) {
                        statusParts.push(`<span class="act-tl-gm-tag act-tl-gm-tool"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg><span>${count} ${tBiHtml(count === 1 ? 'tool' : 'tools', '工具')}</span></span>`);
                    }
                }
            }
            const stepSpeed = computeStepSpeed(e.gmOutputTokens, e.gmStreamingDuration);
            if (stepSpeed !== null) {
                statusParts.push(`<span class="act-tl-gm-tag act-tl-gm-speed">${esc(formatSpeed(stepSpeed))}</span>`);
            }
            if (e.gmTTFT && e.gmTTFT > 0) {
                statusParts.push(`<span class="act-tl-gm-tag act-tl-gm-ttft">TTFT ${esc(formatLatency(e.gmTTFT))}</span>`);
            }
            if (e.gmStreamingDuration && e.gmStreamingDuration > 0) {
                statusParts.push(`<span class="act-tl-gm-tag act-tl-gm-stream"><span>${tBiHtml('Stream', '流式')} ${esc(formatLatency(e.gmStreamingDuration))}</span></span>`);
            }
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
                ${e.model ? `<span class="act-tl-model" title="${esc(e.model)}">${esc(e.model)}</span>` : ''}
                ${detail}
            </span>
            <span class="act-tl-meta${gmTags ? ' act-tl-meta-gm' : ''}">
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

    const buildSegmentStats = (actions: any[]) => {
        let totalIn = 0, totalOut = 0, totalThinking = 0, totalCache = 0, totalCacheCreation = 0, totalCredits = 0, totalCost = 0;
        let toolCount = 0, reasoningCount = 0;
        let model = '';
        const models = new Set<string>();
        let gmToolTotal = 0;
        let retryTotal = 0;
        let lastContextTokens = 0;
        let timedOutputSum = 0;
        let timedStreamSum = 0;
        let ttftSum = 0;
        let ttftCount = 0;
        for (const a of actions) {
            if (a.category === 'tool') { toolCount++; }
            if (a.category === 'reasoning') {
                reasoningCount++;
                if (a.gmInputTokens) { totalIn += a.gmInputTokens; }
                if (a.gmOutputTokens) { totalOut += a.gmOutputTokens; }
                if (a.gmThinkingTokens) { totalThinking += a.gmThinkingTokens; }
                if (a.gmCacheReadTokens) { totalCache += a.gmCacheReadTokens; }
                if (a.gmCacheCreationTokens && a.gmCacheCreationTokens > 0) { totalCacheCreation += a.gmCacheCreationTokens; }
                if (a.gmCredits) { totalCredits += a.gmCredits; }
                if (typeof a.gmTTFT === 'number' && Number.isFinite(a.gmTTFT) && a.gmTTFT > 0) {
                    ttftSum += a.gmTTFT;
                    ttftCount++;
                }
                if (computeStepSpeed(a.gmOutputTokens, a.gmStreamingDuration) !== null) {
                    timedOutputSum += a.gmOutputTokens;
                    timedStreamSum += a.gmStreamingDuration;
                }
                if (a.gmModel) {
                    const pricing = findPricingWithCustom(a.gmModel, custom);
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
                if (a.gmContextTokensUsed && a.gmContextTokensUsed > 0) {
                    lastContextTokens = a.gmContextTokensUsed;
                }
            }
            if (a.detail) {
                const m = a.detail.match(/\u2192\s*(\d+)\s*/);
                if (m) {
                    gmToolTotal += parseInt(m[1], 10);
                }
            }
            if (a.model) { models.add(a.model); }
            if (a.gmModel) { models.add(a.gmModel); }
        }
        if (models.size === 1) { model = [...models][0]; }
        else if (models.size > 1) { model = [...models].filter(m => !m.startsWith('MODEL_PLACEHOLDER')).pop() || [...models][0]; }
        const toolNames = gmToolTotal;
        const turnSpeed = timedStreamSum > 0 ? timedOutputSum / timedStreamSum : null;
        const turnAvgTtft = ttftCount > 0 ? ttftSum / ttftCount : null;
        const turnCacheHitRate = totalCache > 0
            ? computeStepCacheHitRate(totalIn, totalCache, totalCacheCreation)
            : null;
        return {
            totalIn, totalOut, totalThinking, totalCache, totalCacheCreation, totalCredits, totalCost,
            toolCount, reasoningCount, model, toolNames, retryTotal, lastContextTokens,
            turnSpeed, turnAvgTtft, turnCacheHitRate,
        };
    };

    const reversedSegments = [...segments].reverse();
    for (let si = 0; si < reversedSegments.length; si++) {
        const segment = reversedSegments[si];
        const isLatest = si === 0;
        const stats = buildSegmentStats(segment.actions);

        const chips: string[] = [];
        if (stats.retryTotal > 0) {
            chips.push(`<span class="seg-chip seg-chip-retry"><span>${tBiHtml(`${stats.retryTotal} ${stats.retryTotal === 1 ? 'error' : 'errors'}`, `${stats.retryTotal} 次报错`)}</span></span>`);
        }
        if (stats.totalCredits > 0) {
            chips.push(`<span class="seg-chip seg-chip-credits"><span>${stats.totalCredits.toFixed(1)} ${tBiHtml('credits', '积分')}</span></span>`);
        }
        if (stats.toolNames > 0) {
            chips.push(`<span class="seg-chip seg-chip-tools"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg><span>${stats.toolNames} ${tBiHtml(stats.toolNames === 1 ? 'tool' : 'tools', '工具')}</span></span>`);
        } else if (stats.toolCount > 0) {
            chips.push(`<span class="seg-chip seg-chip-tools"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg><span>${stats.toolCount}</span></span>`);
        }
        if (stats.reasoningCount > 0) { chips.push(`<span class="seg-chip seg-chip-calls"><span>${stats.reasoningCount} ${tBiHtml(stats.reasoningCount === 1 ? 'call' : 'calls', '调用')}</span></span>`); }
        if (stats.turnSpeed !== null) {
            chips.push(`<span class="seg-chip seg-chip-speed">${esc(formatSpeed(stats.turnSpeed))}</span>`);
        }
        if (stats.turnAvgTtft !== null) {
            chips.push(`<span class="seg-chip seg-chip-ttft">TTFT ${esc(formatLatency(stats.turnAvgTtft))}</span>`);
        }
        if (stats.totalCost > 0) {
            const costStr = stats.totalCost < 0.01 ? stats.totalCost.toFixed(3) : stats.totalCost.toFixed(2);
            chips.push(`<span class="seg-chip seg-chip-cost">$${costStr}</span>`);
        }
        if (stats.turnCacheHitRate !== null) {
            chips.push(`<span class="seg-chip seg-chip-cache-hit"><span>${tBiHtml('Cache', '缓存')} ${esc(formatCachePercent(stats.turnCacheHitRate))}</span></span>`);
        }
        if (stats.totalCache > 0) {
            chips.push(`<span class="seg-chip seg-chip-cache"><span>${fmtTok(stats.totalCache)} ${tBiHtml('cache', '缓存')}</span></span>`);
        }
        if (stats.totalIn > 0 || stats.totalOut > 0) {
            chips.push(`<span class="seg-chip seg-chip-tok"><span>${fmtTok(stats.totalIn)} ${tBiHtml('in', '输入')} · ${fmtTok(stats.totalOut)} ${tBiHtml('out', '输出')}</span></span>`);
        }
        if (stats.lastContextTokens > 0) {
            chips.push(`<span class="seg-chip seg-chip-ctx" title="${esc(estimatedContextDescription())}">${tBi('Estimated context', '估算上下文')} ${fmtTok(stats.lastContextTokens)}</span>`);
        }
        const chipsHtml = chips.length > 0 ? `<span class="seg-chips">${chips.join('')}</span>` : '';

        const turnNumber = segments.length - si;
        const turnLabel = segment.user
            ? tBiHtml(`Turn ${turnNumber}`, `第 ${turnNumber} 轮`)
            : tBiHtml('AI actions (no user anchor)', 'AI 动作（缺少用户锚点）');

        html += `<details class="act-tl-turn" id="turn-${si}"${isLatest ? ' open' : ''}>`;
        html += `<summary class="act-tl-turn-header">`;
        if (segment.user) {
            html += `<span class="act-tl-turn-icon"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>`;
        } else {
            html += `<span class="act-tl-turn-icon"><svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.3 4.7-3.2 6H8.2C6.3 13.7 5 11.5 5 9a7 7 0 0 1 7-7z"/><path d="M9 17h6M10 21h4"/></svg></span>`;
        }
        html += `<span class="act-tl-turn-text">${turnLabel}</span>`;
        html += chipsHtml;
        html += `</summary>`;

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

// ─── GM Precision Section Builders ──────────────────────────────────────────

function buildContextGrowth(s: GMSummary): string {
    const data = s.contextGrowth;
    if (!data || data.length < 2) { return ''; }
    const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const W = 380, H = 160, PAD = 8;
    const maxTok = Math.max(...data.map(d => d.tokens));
    if (maxTok <= 0) { return ''; }
    const xStep = (W - PAD * 2) / (data.length - 1);
    const yScale = (v: number) => H - PAD - ((v / maxTok) * (H - PAD * 2));
    const points = data.map((d, i) => `${PAD + i * xStep},${yScale(d.tokens)}`).join(' ');
    const areaPoints = `${PAD},${H - PAD} ${points} ${PAD + (data.length - 1) * xStep},${H - PAD}`;
    const gridYs = [0.25, 0.5, 0.75].map(r => (PAD + (H - PAD * 2) * r).toFixed(1));
    const gridLines = gridYs.map(y => `<line class="act-trend-grid" x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" />`).join('');
    return `<h2 class="act-section-title">${tBi('Estimated context growth', '估算上下文增长')} <span class="act-badge">${tBiHtml('Per-Call', '每次调用')}</span></h2><div class="act-trend-container" title="${esc(estimatedContextDescription())}"><svg class="act-trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${gridLines}<polygon class="act-trend-area" points="${areaPoints}"/><polyline class="act-trend-line" points="${points}" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg><div class="act-trend-labels"><span>${fmt(data[0].tokens)}</span><span>${data.length} ${tBiHtml('calls', '调用')}</span><span>${fmt(data[data.length - 1].tokens)}</span></div></div>`;
}

function buildConversations(s: GMSummary): string {
    const convs = s.conversations.filter(c => c.calls.length > 0);
    if (convs.length === 0) { return ''; }

    const fmtDate = (iso: string): string => {
        if (!iso) { return ''; }
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) { return ''; }
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch { return ''; }
    };

    const iconClock = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const iconCalls = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

    let html = `<h2 class="act-section-title"><span>${tBiHtml('Conversations', '对话分布')}</span></h2><div class="act-conv-list">`;
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
            ? `<span class="act-conv-meta-chip act-conv-credits"><b>${totalCredits}</b> <span>${tBiHtml('credits', '积分')}</span>${acctCredits > 0 && acctCredits < totalCredits ? ` <span class="act-credit-calls">+${acctCredits}</span>` : ''}</span>`
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

    const byConv = gm.toolCallCountsByConv || {};
    const convCount = Object.keys(byConv).length;
    const currentConvCounts: Record<string, number> = (currentCascadeId && convCount > 1)
        ? (byConv[currentCascadeId] || {})
        : {};

    const wrenchIcon = `<svg class="act-icon act-icon-accent" viewBox="0 0 16 16"><path fill="currentColor" d="M12.7 3.3a1 1 0 0 1 0 1.4l-1.2 1.2 1.5 1.5a1 1 0 0 1-.7 1.7H10a1 1 0 0 1-1-1V5.8a1 1 0 0 1 1.7-.7l1.5 1.5 1.2-1.2a1 1 0 0 1 1.3-.1zM4.5 2A2.5 2.5 0 0 0 2 4.5v7A2.5 2.5 0 0 0 4.5 14h7a2.5 2.5 0 0 0 2.5-2.5V10h-1v1.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 11.5v-7A1.5 1.5 0 0 1 4.5 3H6V2H4.5z"/></svg>`;

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
        ? `<span>${tBiHtml(`${convCount} conversations`, `${convCount} 个对话`)}</span>`
        : '';

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
        const catalogIcon = `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`;
        catalogHtml = `<details class="tool-cat-section" id="toolCatSection">
            <summary class="tool-cat-header">
                ${catalogIcon}
                <span>${tBiHtml('Tool Catalog', '\u5de5\u5177\u76ee\u5f55')}</span>
                <span class="act-badge">${catalog.length}</span>
            </summary>
            <div class="tool-cat-chips">${chips}</div>
            <div class="tool-cat-footer">
                <button class="tool-cat-clear-btn" id="clearToolCatalogBtn">
                    <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>
                    <span>${tBiHtml('Clear Catalog', '\u6e05\u7a7a\u76ee\u5f55')}</span>
                </button>
            </div>
        </details>`;
    }

    return `<div class="tool-rank-section">
        <h3 class="act-section-title">
            ${wrenchIcon}
            <span>${tBiHtml('Tool Call Ranking', '\u5de5\u5177\u8c03\u7528\u6392\u884c')}</span>
            <span class="act-badge"><span>${tBiHtml(`${totalInvocations} ${totalInvocations === 1 ? 'invocation' : 'invocations'}`, `${totalInvocations} \u6b21\u8c03\u7528`)}</span></span>
        </h3>
        <ul class="tool-rank-list">
            ${rows}
            <li class="tool-rank-summary">
                <span>${tBiHtml('Unique Tools', '\u5de5\u5177\u79cd\u7c7b')}: <b>${entries.length}</b></span>
                <span>${tBiHtml('Total', '\u5408\u8ba1')}: <b>${totalInvocations}</b></span>
                ${convNote}
            </li>
        </ul>
        ${catalogHtml}
    </div>`;
}

/** Build a collapsible error details section showing recent errors and error code breakdown */
function buildErrorDetailsSection(s: GMSummary, currentCascadeId?: string): string {
    const errorCodes = s.retryErrorCodes || {};
    const recentErrors = s.recentErrors || [];
    const uniqueErrors = s.uniqueErrors || [];
    const errTotal = Object.values(errorCodes).reduce((a, b) => a + b, 0);
    if (errTotal <= 0 && recentErrors.length === 0 && s.totalRetryCount <= 0 && uniqueErrors.length === 0) { return ''; }

    const fmt = (n: number) => n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

    const byConv = s.retryErrorCodesByConv || {};
    const convCount = Object.keys(byConv).length;
    const currentConvErrors: Record<string, number> = (currentCascadeId && convCount > 1)
        ? (byConv[currentCascadeId] || {})
        : {};
    const currentConvTotal = Object.values(currentConvErrors).reduce((a, b) => a + b, 0);

    const codeTags = Object.entries(errorCodes)
        .sort((a, b) => b[1] - a[1])
        .map(([code, count]) => {
            const isRateLimit = code === '429';
            const isServer = code === '503' || code === '500' || code === '504';
            const tagClass = isRateLimit ? 'gm-err-tag-ratelimit' : isServer ? 'gm-err-tag-server' : 'gm-err-tag-other';
            const delta = currentConvErrors[code] || 0;
            const deltaHtml = delta > 0
                ? `<span class="err-delta"> +${delta}</span>`
                : '';
            return `<span class="gm-err-tag ${tagClass}">${esc(code)} \u00d7${count}${deltaHtml}</span>`;
        }).join('');

    const convDeltaBadge = currentConvTotal > 0
        ? ` <span class="err-delta">+${currentConvTotal} ${tBiHtml('this session', '\u672c\u5bf9\u8bdd')}</span>`
        : '';

    const fmtTime = (iso: string): string => {
        if (!iso) { return ''; }
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) { return ''; }
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch { return ''; }
    };

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

    let uniqueErrorCatalog = '';
    if (uniqueErrors.length > 0) {
        const catalogIcon = `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
        const rows = uniqueErrors.map((entry, i) => buildErrorRow(entry, i, 'd-ue')).join('');
        uniqueErrorCatalog = `<details class="gm-ue-section" id="ue-catalog">
            <summary class="gm-ue-header">
                ${catalogIcon} <span>${tBiHtml('Error Types', '\u9519\u8bef\u79cd\u7c7b')}</span>
                <span class="act-badge"><span>${uniqueErrors.length} ${tBiHtml(uniqueErrors.length === 1 ? 'type' : 'types', '\u79cd')}</span></span>
            </summary>
            <div class="gm-ue-list">${rows}</div>
        </details>`;
    }

    const recentEntries = s.recentErrorEntries || [];
    let errorListHtml = '';
    if (recentEntries.length > 0) {
        const rows = recentEntries.map((entry, i) => buildErrorRow(entry, i, 'd-err')).join('');
        const logIcon = `<svg class="act-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;
        errorListHtml = `<details class="gm-ue-section" id="err-log" open>
            <summary class="gm-ue-header">
                ${logIcon} <span>${tBiHtml('Error Log', '\u62a5\u9519\u65e5\u5fd7')}</span>
                <span class="act-badge"><span>${recentEntries.length} ${tBiHtml(recentEntries.length === 1 ? 'entry' : 'entries', '\u6761')}</span></span>
            </summary>
            <div class="gm-ue-list">${rows}</div>
        </details>`;
    } else if (recentErrors.length > 0) {
        const rows = recentErrors.slice(0, 20).map((msg, i) =>
            buildErrorRow({ code: 'unknown', message: msg }, i, 'd-err'),
        ).join('');
        errorListHtml = `<div class="gm-ue-section"><div class="gm-ue-list">${rows}</div></div>`;
    }

    // Overhead stats (HTML for display, plain text for clipboard)
    const overheadPartsHtml: string[] = [];
    const overheadPartsText: string[] = [];
    if (s.totalRetryTokens > 0) {
        overheadPartsHtml.push(`${fmt(s.totalRetryTokens)} ${tBiHtml('tokens wasted', '浪费 tokens')}`);
        overheadPartsText.push(`${fmt(s.totalRetryTokens)} ${tBi('tokens wasted', '浪费 tokens')}`);
    }
    if (s.totalRetryCredits > 0) {
        overheadPartsHtml.push(`${s.totalRetryCredits.toFixed(1)} ${tBiHtml('credits used', '积分消耗')}`);
        overheadPartsText.push(`${s.totalRetryCredits.toFixed(1)} ${tBi('credits used', '积分消耗')}`);
    }
    if (s.totalRetryCount > 0) {
        overheadPartsHtml.push(`${s.totalRetryCount} ${tBiHtml('calls with retries', '含重试调用')}`);
        overheadPartsText.push(`${s.totalRetryCount} ${tBi('calls with retries', '含重试调用')}`);
    }
    const overheadLine = overheadPartsHtml.length > 0
        ? `<div class="gm-err-overhead">${overheadPartsHtml.join(' \u00b7 ')}</div>`
        : '';

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
    if (overheadPartsText.length > 0) {
        clipboardParts.push('');
        clipboardParts.push(overheadPartsText.join(' | '));
    }

    const copyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const copyBtnHtml = clipboardParts.length > 0
        ? `<button type="button" class="gm-ue-copy-btn" id="copyAllErrors" aria-label="${esc(tBi('Copy all errors', '\u590d\u5236\u5168\u90e8\u9519\u8bef'))}"><span class="gm-ue-tooltip">${tBiHtml('Copy all errors', '\u590d\u5236\u5168\u90e8\u9519\u8bef')}</span>${copyIcon}</button>`
        : '';

    return `<h2 class="act-section-title"><svg class="act-icon act-icon-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg><span>${tBiHtml('Error Details', '\u9519\u8bef\u8be6\u60c5')}</span>${convDeltaBadge}${copyBtnHtml}</h2>
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
                label: tBi(`Checkpoint ${cp.checkpointNumber}`, `检查点 ${cp.checkpointNumber}`),
                fullText: cp.fullText,
                checkpointNumber: cp.checkpointNumber,
            });
        }
    }

    const hasModelDNA = Object.keys(s.modelBreakdown).some(k => {
        const ms = s.modelBreakdown[k];
        return (ms.promptSectionTitles && ms.promptSectionTitles.length > 0)
            || ms.completionConfig
            || ms.toolCount > 0;
    });
    const hasTokenBreakdown = s.latestTokenBreakdown && s.latestTokenBreakdown.length > 0;

    if (rawItems.length === 0 && !hasModelDNA && !hasTokenBreakdown) { return ''; }

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

    // Type → icon SVG + semantic tone class + localized label
    const typeConfig: Record<string, { icon: string; tone: string; label: string }> = {
        checkpoint: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2z"/><path d="M9 21V9h6v12"/></svg>',
            tone: 'ci-tone-warn',
            label: tBiHtml('Checkpoint', '检查点'),
        },
        context_injection: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
            tone: 'ci-tone-accent',
            label: tBiHtml('Context Injection', '上下文注入'),
        },
        user_info: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
            tone: 'ci-tone-good',
            label: tBiHtml('User Information', '用户信息'),
        },
        user_rules: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
            tone: 'ci-tone-accent',
            label: tBiHtml('User Rules', '用户规则'),
        },
        mcp_servers: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
            tone: 'ci-tone-cache',
            label: tBiHtml('MCP Servers', 'MCP 服务'),
        },
        workflows: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
            tone: 'ci-tone-thinking',
            label: tBiHtml('Workflows', '工作流'),
        },
        artifacts: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
            tone: 'ci-tone-thinking',
            label: tBiHtml('Artifacts', '产物'),
        },
        ephemeral: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>',
            tone: 'ci-tone-neutral',
            label: tBiHtml('Ephemeral', '临时'),
        },
        system_preamble: {
            icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
            tone: 'ci-tone-neutral',
            label: tBiHtml('System Preamble', '系统前导'),
        },
    };

    const contextCards = items.map((item, idx) => {
        const conf = typeConfig[item.type] || typeConfig.system_preamble;
        let bodyHtml = esc(item.fullText);

        if (item.type === 'user_rules') {
            const rawHeader = tBiHtml('Original User Prompt', '原始用户提示词');
            bodyHtml = `<div class="ci-raw-header">${rawHeader}</div><div class="ci-raw-content">${bodyHtml}</div>`;
        } else {
            bodyHtml = `<div class="ci-raw-content">${bodyHtml}</div>`;
        }

        const cpBadge = item.checkpointNumber !== undefined
            ? `<span class="cp-card-num ${conf.tone}">#${item.checkpointNumber}</span>`
            : '';
        const iconHtml = `<span class="ci-icon ${conf.tone}">${conf.icon}</span>`;

        return `<details class="cp-card" id="ciCard${idx}" data-ci-type="${item.type}">
            <summary class="cp-card-header">
                ${iconHtml}
                ${cpBadge}
                <span class="ci-title-label">${conf.label}</span>
                ${(item.stepIndex >= 0 && item.stepIndex < 100000) ? `<span class="cp-card-chip cp-card-chip-step">${tBiHtml(`Step ${formatNumber(item.stepIndex)}`, `步骤 ${formatNumber(item.stepIndex)}`)}</span>` : ''}
                ${item.tokens > 0 ? `<span class="cp-card-chip cp-card-chip-tok">${fmt(item.tokens)} tokens</span>` : ''}
            </summary>
            <div class="cp-card-body">${bodyHtml}</div>
        </details>`;
    }).join('');

    const dnaCards: string[] = [];
    const promptIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
    const configIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>';

    const primaryModels = new Set<string>();
    for (const call of primary.calls) {
        const mn = normalizeModelDisplayName(call.modelDisplay || call.model);
        if (mn) { primaryModels.add(mn); }
    }

    for (const [modelName, ms] of Object.entries(s.modelBreakdown)) {
        if (ms.callCount <= 0) { continue; }
        if (!primaryModels.has(modelName)) { continue; }

        // 1. System Prompt Structure card
        if (ms.promptSectionTitles && ms.promptSectionTitles.length > 0) {
            const sectionChips = ms.promptSectionTitles.map(title => `<span class="ci-dna-chip">${esc(title)}</span>`).join('');
            dnaCards.push(`<details class="cp-card" id="ciDna-sp-${esc(modelName)}" data-ci-type="dna_prompt">
                <summary class="cp-card-header">
                    <span class="ci-icon ci-tone-accent">${promptIcon}</span>
                    <span class="ci-title-label">${tBiHtml('System Prompt Structure', '系统提示词结构')}</span>
                    <span class="cp-card-chip cp-card-chip-tok"><span>${ms.promptSectionTitles.length} ${tBiHtml(ms.promptSectionTitles.length === 1 ? 'section' : 'sections', '区段')}</span></span>
                    ${ms.toolCount > 0 ? `<span class="cp-card-chip cp-card-chip-step"><span>${ms.toolCount} ${tBiHtml(ms.toolCount === 1 ? 'tool' : 'tools', '工具')}</span></span>` : ''}
                </summary>
                <div class="cp-card-body is-structured">
                    <div class="ci-model-sub">${esc(modelName)}</div>
                    <div class="ci-dna-chips">${sectionChips}</div>
                </div>
            </details>`);
        }

        // 2. Completion Config card (with context window capacity)
        if (ms.completionConfig) {
            const cc = ms.completionConfig;
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

            const configRows: string[] = [];
            configRows.push(`<div class="ci-cfg-row"><span class="ci-cfg-label">${tBiHtml('temperature', '温度')}</span><span class="ci-cfg-val">${cc.temperature}</span></div>`);
            if (cc.firstTemperature !== cc.temperature) {
                configRows.push(`<div class="ci-cfg-row"><span class="ci-cfg-label">${tBiHtml('firstTemperature', '初始温度')}</span><span class="ci-cfg-val">${cc.firstTemperature}</span></div>`);
            }
            configRows.push(`<div class="ci-cfg-row"><span class="ci-cfg-label">${tBiHtml('topK', 'Top K')}</span><span class="ci-cfg-val">${cc.topK}</span></div>`);
            if (cc.topP !== 1) {
                configRows.push(`<div class="ci-cfg-row"><span class="ci-cfg-label">${tBiHtml('topP', 'Top P')}</span><span class="ci-cfg-val">${cc.topP}</span></div>`);
            }
            configRows.push(`<div class="ci-cfg-row"><span class="ci-cfg-label">${tBiHtml('maxOutputTokens', '最大输出 tokens')}</span><span class="ci-cfg-val">${fmt(cc.maxTokens)}</span></div>`);
            if (cc.stopPatternCount > 0) {
                configRows.push(`<div class="ci-cfg-row"><span class="ci-cfg-label">${tBiHtml('stopPatterns', '停止词')}</span><span class="ci-cfg-val">${cc.stopPatternCount}</span></div>`);
            }

            let capacityHtml = '';
            const contextCap = ms.contextWindowCapacity || 0;
            if (contextCap > 0 || maxContextSeen > 0) {
                const cap = contextCap > 0 ? contextCap : maxContextSeen;
                const usagePct = cap > 0 ? Math.min(100, Math.round(latestContextUsed / cap * 100)) : 0;
                const barColor = usagePct >= 80 ? 'var(--ed-danger-fill)' : usagePct >= 65 ? 'var(--ed-warn-fill)' : 'var(--ed-accent)';
                const capLabel = contextCap > 0 ? fmt(contextCap) : `~${fmt(cap)}`;
                capacityHtml = `
                    <div class="ci-cap-box">
                        <div class="ci-cfg-row">
                            <span class="ci-cfg-label" title="${esc(estimatedContextDescription())}">${tBiHtml('Estimated context', '估算上下文')}</span>
                            <span class="ci-cfg-val">${fmt(latestContextUsed)} / ${capLabel}</span>
                        </div>
                        <div class="ci-cap-track">
                            <div class="ci-cap-fill" style="width:${usagePct}%;background:${barColor}"></div>
                        </div>
                        <div class="ci-cap-meta">${usagePct}% ${tBiHtml('estimated usage', '估算用量')} · ${tBiHtml('estimated peak', '估算峰值')} ${fmt(maxContextSeen)}</div>
                    </div>`;
            }

            dnaCards.push(`<details class="cp-card" id="ciDna-cc-${esc(modelName)}" data-ci-type="dna_config">
                <summary class="cp-card-header">
                    <span class="ci-icon ci-tone-warn">${configIcon}</span>
                    <span class="ci-title-label">${tBiHtml('Generation Config', '生成配置')}</span>
                    <span class="cp-card-chip cp-card-chip-tok">T=${cc.temperature}</span>
                    ${latestContextUsed > 0 ? `<span class="cp-card-chip cp-card-chip-step" title="${esc(estimatedContextDescription())}">${tBi('Estimated context', '估算上下文')} ${fmt(latestContextUsed)}</span>` : ''}
                </summary>
                <div class="cp-card-body is-structured">
                    <div class="ci-model-sub">${esc(modelName)}</div>
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
        const breakdownVars = [
            'var(--ed-chart-output)',
            'var(--ed-chart-cache)',
            'var(--ed-chart-thinking)',
            'var(--ed-chart-input)',
            'var(--ed-warn-fill)',
            'var(--ed-good-fill)',
        ];
        const breakdownRows = groups.map((g, i) => {
            const pct = total > 0 ? Math.max(1, Math.round(g.tokens / total * 100)) : 0;
            const col = breakdownVars[i % breakdownVars.length];
            const gName = g.name || g.type.replace('TOKEN_TYPE_', '').replace(/_/g, ' ');
            let childHtml = '';
            if (g.children.length > 0) {
                const chips = g.children.map(ch =>
                    `<span class="ci-dna-chip">${esc(ch.name)} <b>${fmt(ch.tokens)}</b></span>`,
                ).join('');
                childHtml = `<div class="ci-dna-chips ci-bd-children">${chips}</div>`;
            }
            return `<div class="ci-bd-item">
                <div class="ci-cfg-row">
                    <span class="ci-bd-label-wrap"><span class="ci-bd-dot" style="background:${col}"></span><span class="ci-cfg-label">${esc(gName)}</span></span>
                    <span class="ci-cfg-val">${fmt(g.tokens)} (${pct}%)</span>
                </div>
                <div class="ci-bd-track">
                    <div class="ci-bd-fill" style="width:${pct}%;background:${col}"></div>
                </div>
                ${childHtml}
            </div>`;
        }).join('');
        const breakdownIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 10 10"/><path d="M12 12V2"/><path d="M12 12h10"/></svg>';

        dnaCards.push(`<details class="cp-card" id="ciDna-tb" data-ci-type="dna_tokens">
            <summary class="cp-card-header">
                <span class="ci-icon ci-tone-accent">${breakdownIcon}</span>
                <span class="ci-title-label">${tBiHtml('Token Composition', 'Token 组成')}</span>
                <span class="cp-card-chip cp-card-chip-tok"><span>${fmt(total)} ${tBiHtml('total', '总计')}</span></span>
            </summary>
            <div class="cp-card-body is-structured">
                <div class="ci-model-sub">${tBiHtml('Latest estimated context token distribution', '最新估算上下文 Token 分布')}</div>
                ${breakdownRows}
            </div>
        </details>`);
    }

    const allCards = contextCards + dnaCards.join('');

    if (!allCards) {
        const emptyIcon = `<svg class="act-icon act-icon-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
        return `<details class="ci-section" id="ciSection">
        <summary class="ci-section-header">${emptyIcon}<span>${tBiHtml('Context Intelligence', '上下文情报')}</span></summary>
        <div class="cp-viewer"><div class="ci-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            ${tBiHtml('Waiting for AI response — context data will populate automatically after the first model call in this session.', '等待 AI 回复中 — 上下文数据将在本次会话的首次模型调用后自动填充。')}
        </div></div>
        </details>`;
    }

    const typeCounts = new Map<string, number>();
    for (const item of items) {
        typeCounts.set(item.type, (typeCounts.get(item.type) || 0) + 1);
    }
    const badgeParts: string[] = [];
    for (const [type, count] of typeCounts) {
        const conf = typeConfig[type] || typeConfig.system_preamble;
        badgeParts.push(`<span class="act-badge ci-badge ${conf.tone}" data-ci-type="${type}"><span>${conf.label}${count > 1 ? ` · ${count}` : ''}</span></span>`);
    }
    if (dnaCards.length > 0) {
        badgeParts.push(`<span class="act-badge ci-badge ci-tone-accent"><span>${tBiHtml('Model DNA', '模型 DNA')}${dnaCards.length > 1 ? ` · ${dnaCards.length}` : ''}</span></span>`);
    }

    const titleIcon = `<svg class="act-icon act-icon-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;

    return `<details class="ci-section" id="ciSection">
    <summary class="ci-section-header">${titleIcon}<span>${tBiHtml('Context Intelligence', '上下文情报')}</span> <span class="ci-badges">${badgeParts.join(' ')}</span></summary>
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

const CREDIT_LABEL_PAIRS: Record<string, readonly [string, string]> = {
    GOOGLE_ONE_AI: ['Google AI credits', 'Google AI 积分'],
    GOOGLE_AI: ['Google AI credits', 'Google AI 积分'],
    GOOGLE_AI_STUDIO: ['Google AI Studio credits', 'Google AI Studio 积分'],
};

function formatCreditLabelHtml(creditType: string): string {
    const key = creditType.trim().toUpperCase().replace(/^CREDIT_TYPE_/, '');
    const mapped = Object.hasOwn(CREDIT_LABEL_PAIRS, key) ? CREDIT_LABEL_PAIRS[key] : undefined;
    if (mapped) { return tBiHtml(mapped[0], mapped[1]); }
    return esc(formatCreditTypeLabel(creditType));
}

function buildTodayLedgerPanel(
    buckets: LedgerAccountBucket[],
    snapshots: AccountSnapshot[] = [],
    custom: Record<string, ModelPricing> = {},
): string {
    const activeBuckets = buckets.filter(b => b.totalCalls > 0);
    if (activeBuckets.length === 0) { return ''; }

    const costOfBucket = (b: LedgerAccountBucket): number => {
        let sum = 0;
        for (const [modelKey, ms] of Object.entries(b.modelStats)) {
            const pricing = findPricingWithCustom(modelKey, custom);
            sum += pricing ? costFromTokens(ms, pricing) : ms.estimatedCost;
        }
        return sum;
    };

    let totalCalls = 0, totalIn = 0, totalOut = 0, totalCache = 0, totalCredits = 0, totalCost = 0;
    for (const b of activeBuckets) {
        totalCalls += b.totalCalls;
        totalIn += b.totalInputTokens;
        totalOut += b.totalOutputTokens;
        totalCache += b.totalCacheRead;
        totalCredits += b.totalCredits;
        totalCost += costOfBucket(b);
    }

    const formatK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
    const fmtReset = (iso: string): string => {
        const d = new Date(iso);
        if (isNaN(d.getTime())) { return ''; }
        const diffMs = d.getTime() - Date.now();
        if (diffMs <= 0) { return tBiHtml('expired', '\u5df2\u8fc7\u671f'); }
        const h = Math.floor(diffMs / 3600000);
        const m = Math.floor((diffMs % 3600000) / 60000);
        return h > 0 ? `${h}h${m}m` : `${m}m`;
    };

    const snapshotMap = new Map<string, AccountSnapshot>();
    for (const s of snapshots) { snapshotMap.set(s.email, s); }

    const accountCards = activeBuckets.map(bucket => {
        const snap = snapshotMap.get(bucket.accountEmail);
        const displayName = snap?.name || bucket.accountEmail || tBi('Unknown', '\u672a\u77e5');
        const emailShort = bucket.accountEmail ? bucket.accountEmail.split('@')[0] : '';
        const isActive = snap?.isActive ?? false;
        const statusDot = isActive
            ? '<span class="ledger-acct-dot ledger-acct-active"></span>'
            : '<span class="ledger-acct-dot ledger-acct-cached"></span>';

        const resetPools = snap?.resetPools || [];
        const modelResetMap = new Map<string, string>();
        for (const pool of resetPools) {
            if (!pool.resetTime) { continue; }
            for (const mid of (pool.modelIds || [])) {
                modelResetMap.set(normalizeModelDisplayName(mid), pool.resetTime);
            }
            for (const label of (pool.modelLabels || [])) {
                modelResetMap.set(normalizeModelDisplayName(label), pool.resetTime);
            }
        }

        const modelChips = Object.entries(bucket.modelStats)
            .sort((a, b) => b[1].calls - a[1].calls)
            .map(([model, ms]) => {
                const resetIso = modelResetMap.get(model);
                const resetTag = resetIso
                    ? ` <span class="ledger-reset-time" title="${esc(resetIso)}">${fmtReset(resetIso)}</span>`
                    : '';
                return `<span class="pending-model-chip ledger-model-chip">${esc(normalizeModelDisplayName(model))} <b>${ms.calls}</b>${resetTag}</span>`;
            }).join('');

        const bucketCost = costOfBucket(bucket);

        return `<div class="ledger-acct-card">
            <div class="ledger-acct-header">
                ${statusDot}
                <span class="ledger-acct-name">${esc(displayName)}</span>
                ${emailShort ? `<span class="ledger-acct-email">${esc(emailShort)}</span>` : ''}
            </div>
            <div class="ledger-acct-stats">
                <span class="pending-stat">${tBiHtml('Calls', '\u8c03\u7528')} <b>${bucket.totalCalls}</b></span>
                <span class="pending-stat">${tBiHtml('Input', '\u8f93\u5165')} <b>${formatK(bucket.totalInputTokens)}</b></span>
                <span class="pending-stat">${tBiHtml('Output', '\u8f93\u51fa')} <b>${formatK(bucket.totalOutputTokens)}</b></span>
                ${bucket.totalCacheRead > 0 ? `<span class="pending-stat">${tBiHtml('Cache', '\u7f13\u5b58')} <b>${formatK(bucket.totalCacheRead)}</b></span>` : ''}
                ${bucket.totalCredits > 0 ? `<span class="pending-stat">${tBiHtml('Credits', '\u79ef\u5206')} <b>${bucket.totalCredits}</b></span>` : ''}
                ${bucketCost > 0 ? `<span class="pending-stat pending-stat-cost">${tBiHtml('Cost', '\u8d39\u7528')} <b>$${bucketCost < 0.01 ? bucketCost.toFixed(4) : bucketCost < 1 ? bucketCost.toFixed(3) : bucketCost.toFixed(2)}</b></span>` : ''}
            </div>
            <div class="pending-archive-models">${modelChips}</div>
        </div>`;
    }).join('');

    const ledgerIcon = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783"/></svg>`;

    const summaryStats = activeBuckets.length > 1 ? `<div class="pending-archive-stats">
        <span class="pending-stat">${tBiHtml('Total', '\u5408\u8ba1')} <b>${totalCalls}</b></span>
        <span class="pending-stat">${tBiHtml('Input', '\u8f93\u5165')} <b>${formatK(totalIn)}</b></span>
        <span class="pending-stat">${tBiHtml('Output', '\u8f93\u51fa')} <b>${formatK(totalOut)}</b></span>
        ${totalCache > 0 ? `<span class="pending-stat">${tBiHtml('Cache', '\u7f13\u5b58')} <b>${formatK(totalCache)}</b></span>` : ''}
        ${totalCost > 0 ? `<span class="pending-stat pending-stat-cost">${tBiHtml('Cost', '\u8d39\u7528')} <b>$${totalCost < 0.01 ? totalCost.toFixed(4) : totalCost < 1 ? totalCost.toFixed(3) : totalCost.toFixed(2)}</b></span>` : ''}
    </div>` : '';

    return `<div class="pending-archive-panel today-ledger-panel">
        <div class="pending-archive-header today-ledger-header">
            ${ledgerIcon}
            <span>${tBiHtml("Today's Ledger", '\u4eca\u65e5\u7d2f\u8ba1')}</span>
            <span class="pending-archive-count">${activeBuckets.length} ${tBiHtml(activeBuckets.length === 1 ? 'account' : 'accounts', '\u4e2a\u8d26\u53f7')}</span>
        </div>
        ${summaryStats}
        <div class="ledger-acct-cards">${accountCards}</div>
        <div class="pending-archive-note">${tBiHtml(
        'Real-time incremental recording. Data is preserved even if the IDE clears conversation history.',
        '\u5b9e\u65f6\u589e\u91cf\u8bb0\u5f55\u3002\u5373\u4f7f IDE \u6e05\u9664\u5bf9\u8bdd\u5386\u53f2\uff0c\u6570\u636e\u4e5f\u4e0d\u4f1a\u4e22\u5931\u3002',
    )}</div>
    </div>`;
}

function buildLedgerSettledPanel(entries: LedgerSettledEntry[]): string {
    const totalCalls = entries.reduce((s, e) => s + e.totalCalls, 0);
    const totalIn = entries.reduce((s, e) => s + e.totalInputTokens, 0);
    const totalOut = entries.reduce((s, e) => s + e.totalOutputTokens, 0);
    const totalCache = entries.reduce((s, e) => s + (e.totalCacheRead || 0), 0);
    const totalCredits = entries.reduce((s, e) => s + e.totalCredits, 0);
    const totalCost = entries.reduce((s, e) => s + (e.totalEstimatedCost || 0), 0);

    const allModels = new Map<string, number>();
    for (const e of entries) {
        for (const [m, c] of Object.entries(e.modelCalls)) {
            allModels.set(m, (allModels.get(m) || 0) + c);
        }
    }

    const modelChips = [...allModels.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([model, count]) => `<span class="pending-model-chip settled-model-chip">${esc(normalizeModelDisplayName(model))} <b>${count}</b></span>`)
        .join('');

    const formatK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);

    const settledIcon = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425z"/><path d="M0 2a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1v7.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 12.5V5a1 1 0 0 1-1-1zm2 3v7.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V5zm13-3H1v2h14z"/></svg>`;

    return `<div class="pending-archive-panel settled-panel">
        <div class="pending-archive-header settled-header">
            ${settledIcon}
            <span>${tBiHtml('Settled (Quota Reset)', '已结算（配额重置）')}</span>
            <span class="pending-archive-count">${entries.length} ${tBiHtml(entries.length === 1 ? 'cycle' : 'cycles', '个周期')}</span>
        </div>
        <div class="pending-archive-stats">
            <span class="pending-stat">${tBiHtml('Calls', '调用')} <b>${totalCalls}</b></span>
            <span class="pending-stat">${tBiHtml('Input', '输入')} <b>${formatK(totalIn)}</b></span>
            <span class="pending-stat">${tBiHtml('Output', '输出')} <b>${formatK(totalOut)}</b></span>
            ${totalCache > 0 ? `<span class="pending-stat">${tBiHtml('Cache', '缓存')} <b>${formatK(totalCache)}</b></span>` : ''}
            ${totalCredits > 0 ? `<span class="pending-stat">${tBiHtml('Credits', '积分')} <b>${totalCredits}</b></span>` : ''}
            ${totalCost > 0 ? `<span class="pending-stat pending-stat-cost">${tBiHtml('Cost', '费用')} <b>$${totalCost < 0.01 ? totalCost.toFixed(4) : totalCost < 1 ? totalCost.toFixed(3) : totalCost.toFixed(2)}</b></span>` : ''}
        </div>
        <div class="pending-archive-models">${modelChips}</div>
        <div class="pending-archive-note">${tBiHtml(
        'Settled by quota reset. Will be archived to the calendar at midnight.',
        '已在配额重置后结算，将于午夜归档到日历。',
    )}</div>
    </div>`;
}

/**
 * Detect whether any account has a quota pool that is "Ready" (expired reset time with usage).
 * Used to show a ready indicator on the account popover trigger button.
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
 */
export function buildAccountStatusPanel(snapshots: AccountSnapshot[], billingDays: Record<string, number> = {}): string {
    const nowMs = Date.now();
    const sorted = [...snapshots].sort((a, b) => {
        if (a.isActive !== b.isActive) { return a.isActive ? -1 : 1; }
        return b.lastSeen.localeCompare(a.lastSeen);
    });

    const cards = sorted.map(snap => {
        const indicatorClass = snap.isActive ? 'acct-indicator-active' : 'acct-indicator-cached';
        const planClass = getPlanClass(snap.planName || snap.tierName);
        const planLabelHtml = snap.tierName || snap.planName
            ? esc(snap.tierName || snap.planName)
            : tBiHtml('Unknown', '未知');

        const pools = snap.resetPools || [];
        let resetHtml = '';

        if (pools.length > 0) {
            const poolRows = pools.map(pool => {
                const resetDate = parseResetDate(pool.resetTime);
                if (!resetDate) { return ''; }
                const diffMs = resetDate.getTime() - nowMs;

                const maxShow = 3;
                const labels = pool.modelLabels;
                const shown = labels.slice(0, maxShow);
                const extra = labels.length > maxShow ? labels.length - maxShow : 0;
                const modelChips = shown.map(l =>
                    `<span class="acct-pool-model" title="${esc(l)}">${esc(l)}</span>`
                ).join('');
                const extraChip = extra > 0 ? `<span class="acct-pool-more" title="${esc(labels.slice(maxShow).join(', '))}">+${extra}</span>` : '';

                // Compact quota meter — semantic thresholds (≥50% healthy, 21–49% warn, ≤20% critical); unknown stays empty
                const buildQuotaBar = (pct: number | undefined): string => {
                    if (pct === undefined || !Number.isFinite(pct)) {
                        return `<div class="acct-quota-bar" title="${esc(tBi('Quota unknown', '配额未知'))}"></div>`;
                    }
                    const p = Math.max(0, Math.min(100, pct));
                    const colorClass = p >= 50 ? 'acct-quota-ok' : p > 20 ? 'acct-quota-warn' : 'acct-quota-danger';
                    return `<div class="acct-quota-bar" title="${esc(`${p}% ${tBi('remaining', '剩余')}`)}"><div class="acct-quota-fill ${colorClass}" style="width:${p}%"></div></div>`;
                };

                if (pool.hasUsage === false) {
                    return `<div class="acct-pool-row acct-pool-idle">
                        <div class="acct-pool-models">${modelChips}${extraChip}</div>
                        <span class="acct-reset-countdown acct-reset-idle">${tBiHtml('Idle', '未使用')}</span>
                    </div>`;
                }

                if (diffMs <= 0) {
                    return `<div class="acct-pool-row">
                        <div class="acct-pool-models">${modelChips}${extraChip}</div>
                        <span class="acct-reset-countdown acct-reset-countdown-expired">${tBiHtml('Ready', '已就绪')}</span>
                    </div>`;
                }

                const countdown = formatResetCountdown(pool.resetTime, nowMs);
                const warnClass = diffMs < 30 * 60 * 1000 ? ' acct-reset-countdown-warn' : '';
                return `<div class="acct-pool-row">
                    <div class="acct-pool-models">${modelChips}${extraChip}</div>
                    <span class="acct-reset-countdown${warnClass}">${countdown}</span>
                    ${buildQuotaBar(pool.remainingPercent)}
                </div>`;
            }).filter(Boolean).join('');

            resetHtml = `<div class="acct-pools">${poolRows}</div>`;
        } else if (!snap.isActive) {
            resetHtml = `<div class="acct-reset">
                <span class="acct-tag-cached">${tBiHtml('Cached', '已缓存')}</span>
            </div>`;
        }

        const statusTag = snap.isActive
            ? `<span class="acct-tag-active">${tBiHtml('Active', '在线')}</span>`
            : `<span class="acct-tag-cached">${tBiHtml('Cached', '已缓存')}</span>`;

        const deleteLink = !snap.isActive
            ? `<button type="button" class="acct-delete-link acct-delete-btn" data-email="${esc(snap.email)}" title="${esc(tBi('Remove cached account', '移除缓存账号'))}">${tBiHtml('Remove', '移除')}</button>`
            : '';

        // Deduplicate & localize AI credits via currentAICredits(); never fabricate 0 for unknown balances
        const dedupedCredits = (snap.credits && snap.credits.length > 0)
            ? currentAICredits(snap.credits.map(c => ({
                creditType: c.creditType,
                creditAmount: c.creditAmount,
                minimumCreditAmountForUsage: 0,
            })))
            : [];
        const creditsChips = dedupedCredits.map(c => {
            const labelHtml = formatCreditLabelHtml(c.creditType);
            const valueHtml = c.creditAmount !== null
                ? `<b>${formatNumber(c.creditAmount)}</b>`
                : `<span class="acct-credit-unknown">${tBiHtml('Not reported', '未上报')}</span>`;
            return `<span class="acct-credit-chip"><span>${labelHtml}</span> ${valueHtml}</span>`;
        }).join('');
        const creditsRow = creditsChips
            ? `<div class="acct-credits">${creditsChips}</div>`
            : '';

        // Expiry countdown chip (only if this account has billingDay configured)
        const billingDay = billingDays[snap.email] ?? 0;
        let expiryChip = '';
        if (billingDay >= 1 && billingDay <= 31) {
            const daysLeft = getDaysUntilBillingDay(billingDay);
            if (daysLeft === 0) {
                expiryChip = `<span class="acct-credit-chip acct-expiry-chip is-today"><span>${tBiHtml('Expires today', '今日到期')}</span></span>`;
            } else if (daysLeft !== null) {
                expiryChip = `<span class="acct-credit-chip acct-expiry-chip"><span>${tBiHtml(`${daysLeft}d until expiry`, `${daysLeft} 天后到期`)}</span></span>`;
            }
        }
        const expiryRow = expiryChip ? `<div class="acct-credits">${expiryChip}</div>` : '';

        return `<div class="acct-card">
            <div class="acct-indicator ${indicatorClass}"></div>
            <div class="acct-identity">
                <span class="acct-name">${esc(snap.name || '—')} ${statusTag}${deleteLink ? ` ${deleteLink}` : ''}</span>
                <span class="acct-email">${esc(snap.email)}</span>
                <span class="acct-plan ${planClass}">${planLabelHtml}</span>
                ${creditsRow}
                ${expiryRow}
            </div>
            ${resetHtml}
        </div>`;
    }).join('');

    const userIcon = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z"/></svg>`;

    return `<div class="acct-panel">
        <div class="acct-panel-header">
            ${userIcon}
            <span>${tBiHtml('Account Status', '账号状态')}</span>
            <span class="acct-panel-count">(${sorted.length})</span>
        </div>
        ${cards}
    </div>`;
}

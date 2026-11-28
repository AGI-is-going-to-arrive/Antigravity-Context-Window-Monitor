// ─── Calendar & Activity Heatmap Dashboard Builder ───────────────────────────
// Studio Telemetry Ledger Calendar tab:
// - Live DailyLedger + archived DailyStore + read-only CLI multi-source merge
// - Canonical additive token totals (input + cacheRead + cacheCreation + output)
// - Controls bar (Source filter, Tokens/Cost toggle, 5 Period views, View toggle, CSV/JSON export)
// - 4-card KPI header (Total, Today, This Month, This Year) + legacy Monthly/All-Time summary band
// - 52-week 5-level intensity heatmap, Month Grid, Weekly/Monthly/Year bar charts, All-Time cumulative strip
// - Range summary footer with Calendar Daily Avg, Active Day Avg, Streak, Multi-Currency & Plan ROI
// - Enhanced Click-Day Detail Drawer with token breakdown, model proportion bars & collapsible cycle history
// - Safe two-step confirmation for Clear History; WCAG 2.1 AA compliant across Dark/Light/HC themes.

import { getLanguage, tBi, tBiHtml, tHtml, type Language } from './i18n-core';
import {
    computeAdditiveTokens,
    computeCycleTokenTotals,
    getCycleSurfaces,
    type DailyCycleEntry,
    type DailyRecord,
    type DailyStore,
    type GMModelCycleStats,
} from './daily-store';
import {
    mergeArchivedAndLiveRecords,
    toLocalDateKey,
    type LiveLedgerSource,
} from './daily-archival';
import {
    aggregateWorkspaceLeaderboard,
    normalizeUsageSurface,
    type DailyLedger,
    type LedgerAccountBucket,
    type LedgerSettledEntry,
    type SwarmGroupAttributionSpec,
    type UsageSurface,
    type WorkspaceLeaderboardResult,
} from './daily-ledger';
import type { SwarmGroupCostSummary, SwarmTopologySnapshot } from './core/swarm-registry';
import {
    buildCalendarExportCsv,
    buildCalendarExportJson,
    buildCalendarExportMarkdown,
    cliDayRecordToDailyRecord,
    computeActivityStreaks,
    estimateSubscriptionRoi,
    type CalendarExportDayRow,
    type CalendarExportMetadata,
    type CalendarExportModelRow,
    type CliDailyUsageRecord,
    type SubscriptionConfig,
} from './cli-usage-scanner';
import {
    formatCurrencyAmount,
    formatDualCurrencyAmount,
    resolveCurrencyConfig,
    type CurrencyCode,
    type CurrencyConfig,
    type CurrencyInput,
} from './core/currency';
import type { ModelPricing } from './pricing-store';
import { ICON } from './webview-icons';
import { esc, formatShortTime, richTipAttrs, slugKey } from './webview-helpers';
import { normalizeModelDisplayName } from './models';
import { formatCachePercent, formatLatency, formatSpeed } from './telemetry-metrics';

// ─── Public Types ────────────────────────────────────────────────────────────

export type CalendarSourceFilter = 'all' | 'app' | 'ide' | 'cli';
export type CalendarMetricMode = 'tokens' | 'cost';
export type CalendarPeriodMode = 'daily' | 'weekly' | 'monthly' | 'year' | 'all';
export type CalendarViewMode = 'heatmap' | 'monthGrid';

export interface CalendarLiveLedgerInput {
    dateKey?: string;
    active?: LedgerAccountBucket[];
    settled?: LedgerSettledEntry[];
    ledger?: Pick<DailyLedger, 'dateKey' | 'hasData' | 'getLiveDaySnapshot' | 'getTodayActive' | 'getSettledEntries'> | null;
    customPricing?: Record<string, ModelPricing>;
    defaultSurface?: UsageSurface;
}

export interface CalendarRenderOptions {
    /** Live DailyLedger instance or `{ active, settled, dateKey }` snapshot for real-time Today merge. */
    liveLedger?: DailyLedger | CalendarLiveLedgerInput | null;
    /** Optional scanned Antigravity CLI daily usage records. */
    cliDays?: readonly CliDailyUsageRecord[] | null;
    /** Active source filter pill ('all' | 'app' | 'ide' | 'cli'). Default: 'all'. */
    sourceFilter?: CalendarSourceFilter;
    /** Metric visualized in heatmap/charts ('tokens' | 'cost'). Default: 'tokens'. */
    metricMode?: CalendarMetricMode;
    /** Active period tab ('daily' | 'weekly' | 'monthly' | 'year' | 'all'). Default: 'daily'. */
    periodMode?: CalendarPeriodMode;
    /**
     * Sub-view toggle in Daily mode ('heatmap' | 'monthGrid').
     * When omitted, both the 52-week Heatmap and interactive Month Grid are shown.
     */
    viewMode?: CalendarViewMode;
    /** Display currency code or custom FX rate config. Default: 'USD'. */
    currency?: CurrencyCode | Partial<CurrencyConfig>;
    /** Optional Subscription Plan ROI configuration. */
    subscription?: SubscriptionConfig | null;
    /** Currently expanded date ('YYYY-MM-DD'). */
    selectedDate?: string;
    /** Explicit UI language override ('en' | 'zh' | 'both'). Defaults to global getLanguage(). */
    language?: Language;
    /** Deterministic clock override for tests. */
    now?: Date | number;
    /** Number of weeks shown in the Daily heatmap (default: 52, clamped 12–53). */
    heatmapWeeks?: number;
    /** Optional custom pricing overrides for live ledger re-pricing. */
    customPricing?: Record<string, ModelPricing>;
    /** Render the two-step Clear History confirmation bar expanded when true (default: false). */
    confirmingClear?: boolean;
    /** Optional explicit inclusive start date ('YYYY-MM-DD') for range-scoped exports. */
    rangeStart?: string;
    /** Optional explicit inclusive end date ('YYYY-MM-DD') for range-scoped exports. */
    rangeEnd?: string;
    /** When true, scope export strictly to `selectedDate` (returns empty when `selectedDate` is blank/unmatched). */
    exportSelectedDateOnly?: boolean;
    /** Optional explicit list of selected `YYYY-MM-DD` dates (empty array strictly produces empty export/range). */
    selectedDates?: readonly string[];
    /** Optional Swarm group specs for direct vs inclusive unique-call group cost breakdown. */
    swarmGroups?: readonly SwarmGroupAttributionSpec[];
    /** Optional pre-computed Swarm group cost summaries keyed by rootId. */
    swarmGroupCosts?: Record<string, SwarmGroupCostSummary>;
    swarmTopology?: SwarmTopologySnapshot;
    /** When true, redact account emails and workspace project names in calendar drawers/leaderboard. */
    privacyMasked?: boolean;
    /** Optional timezone label carried through export metadata. */
    timezone?: string;
    /** Optional week-start convention (`1` Monday ISO default, `0` Sunday). */
    weekStartsOn?: 0 | 1;
}

export interface CalendarExportBundle {
    rows: CalendarExportDayRow[];
    meta: CalendarExportMetadata;
    json: string;
    csv: string;
    markdown: string;
}

// ─── SVG Icons ───────────────────────────────────────────────────────────────

const CALENDAR_ICON = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/></svg>';
const CHEVRON_LEFT = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"/></svg>';
const CHEVRON_RIGHT = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/></svg>';
const EXPORT_ICON = ICON.file;

const CAL_ICON = {
    calls: ICON.bolt,
    credit: ICON.star,
    speed: ICON.bolt,
    clock: ICON.clock,
    cache: ICON.database,
    dollar: ICON.chart,
} as const;

// ─── Constants & Formatters ──────────────────────────────────────────────────

const MONTH_NAMES_ZH = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_HEADERS_ZH = ['一', '二', '三', '四', '五', '六', '日'];
const DAY_HEADERS_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function calSlugKey(raw: string): string {
    return slugKey(raw, 48);
}

function calRichTipAttrs(
    key: string,
    titleEn: string,
    titleZh: string,
    bodyEn: string,
    bodyZh: string,
    bi: (en: string, zh: string) => string,
    metaEn?: string,
    metaZh?: string,
): string {
    const title = bi(titleEn, titleZh);
    const body = bi(bodyEn, bodyZh);
    const meta = metaEn || metaZh ? bi(metaEn || '', metaZh || '') : undefined;
    return richTipAttrs({ key, title, body, meta, leadingSpace: true });
}

function calRichTipRawAttrs(key: string, title: string, body: string, meta?: string): string {
    return richTipAttrs({ key, title, body, meta, leadingSpace: true });
}

function formatTokensCompact(n: number): string {
    if (!Number.isFinite(n) || n <= 0) { return '0'; }
    if (n >= 1_000_000_000) { return `${(n / 1_000_000_000).toFixed(2)}B`; }
    if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(1)}M`; }
    if (n >= 1_000) { return `${(n / 1_000).toFixed(1)}k`; }
    return String(Math.round(n));
}

function formatCostValue(usd: number, currency?: CurrencyInput): string {
    if (!Number.isFinite(usd) || usd <= 0) { return '—'; }
    return formatCurrencyAmount(usd, currency, { zeroAsDash: true });
}

function formatCostChipValue(usd: number, currency?: CurrencyInput): string {
    if (!Number.isFinite(usd) || usd <= 0) { return ''; }
    const formatted = formatCurrencyAmount(usd, currency, { zeroAsDash: true });
    return formatted === '—' ? '' : formatted;
}

function resolveNowDate(now?: Date | number): Date {
    if (now instanceof Date && Number.isFinite(now.getTime())) { return now; }
    if (typeof now === 'number' && Number.isFinite(now)) { return new Date(now); }
    return new Date();
}

function parseDateKeyLocal(dateStr: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) { return null; }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addLocalDays(date: Date, deltaDays: number): Date {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + deltaDays);
    return d;
}

/** DST-safe integer day index using UTC midnight for the Date's local Y/M/D. */
function utcDayNumber(date: Date): number {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function getMonthGrid(year: number, month: number): { daysInMonth: number; startDay: number } {
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const startDay = firstDay === 0 ? 6 : firstDay - 1; // Convert to 0=Mon
    return { daysInMonth, startDay };
}

function getIsoWeekKey(dateStr: string): { key: string; label: string; startDate: string; endDate: string } {
    const d = parseDateKeyLocal(dateStr);
    if (!d) { return { key: dateStr.slice(0, 7), label: dateStr.slice(0, 7), startDate: dateStr, endDate: dateStr }; }
    const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay(); // 1=Mon..7=Sun
    const monday = addLocalDays(d, 1 - dayOfWeek);
    const sunday = addLocalDays(monday, 6);
    // ISO week number using Thursday of the week
    const thursday = addLocalDays(monday, 3);
    const isoYear = thursday.getFullYear();
    const jan4 = new Date(isoYear, 0, 4);
    const jan4Day = jan4.getDay() === 0 ? 7 : jan4.getDay();
    const week1Monday = new Date(isoYear, 0, 4 + (1 - jan4Day));
    const weekNum = Math.floor((utcDayNumber(monday) - utcDayNumber(week1Monday)) / 7) + 1;
    const wStr = String(Math.max(1, Math.min(53, weekNum))).padStart(2, '0');
    return {
        key: `${isoYear}-W${wStr}`,
        label: `W${wStr}`,
        startDate: toLocalDateKey(monday),
        endDate: toLocalDateKey(sunday),
    };
}

// ─── Normalized Day Aggregation (Source-Filtered & Additive) ─────────────────

interface MergedCalendarGMModel {
    calls: number;
    credits: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    ttftSum: number;
    ttftWeight: number;
    speedOutputSum: number;
    speedTimeSum: number;
    speedFallbackSum: number;
    speedFallbackWeight: number;
    tokenCacheSum: number;
    tokenCacheWeight: number;
    legacyCacheSum: number;
    legacyCacheWeight: number;
    cost: number;
}

interface AggregatedCalendarDay {
    date: string;
    cycles: DailyCycleEntry[];
    cycleCount: number;
    isLive: boolean;
    sources: UsageSurface[];
    calls: number;
    credits: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    costUsd: number;
    avgTTFT?: number;
    avgGenTokPerSec?: number;
    cacheHitRate?: number;
    models: Record<string, MergedCalendarGMModel>;
}

function safeCost(n: number | undefined): number {
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

function safeInt(n: number | undefined): number {
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Filter a single DailyCycleEntry for a requested source ('all' | 'app' | 'ide' | 'cli').
 * Returns `null` when the cycle has no activity matching the source.
 * Strictly uses exact per-surface counts — NEVER proportionally scales models across surfaces.
 */
function filterCycleBySource(
    cycle: DailyCycleEntry,
    sourceFilter: CalendarSourceFilter,
): { cycle: DailyCycleEntry; surfaces: UsageSurface[] } | null {
    const surfaces = getCycleSurfaces(cycle);
    if (sourceFilter === 'all') {
        return { cycle, surfaces };
    }

    // Exact surfaceBreakdown match (zero proportional model scaling across mixed surfaces!)
    if (cycle.surfaceBreakdown) {
        const surfStats = cycle.surfaceBreakdown[sourceFilter];
        if (!surfStats || (surfStats.calls <= 0 && computeAdditiveTokens(surfStats) <= 0 && surfStats.estimatedCost <= 0)) {
            return null;
        }
        const surfTok = computeAdditiveTokens(surfStats);
        const isPureMatchingSurface = surfaces.length === 1 && surfaces[0] === sourceFilter;
        let exactModels: Record<string, GMModelCycleStats> | undefined;
        if (isPureMatchingSurface) {
            exactModels = cycle.gmModelStats;
        } else if (cycle.lateMergedCalls) {
            const matchingCalls = Object.values(cycle.lateMergedCalls).filter(
                c => normalizeUsageSurface(c.surface) === sourceFilter,
            );
            if (matchingCalls.length > 0) {
                exactModels = {};
                for (const c of matchingCalls) {
                    const key = c.modelId || 'unknown';
                    const entry = exactModels[key] || (exactModels[key] = {
                        calls: 0, credits: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
                        cacheReadTokens: 0, cacheCreationTokens: 0, avgTTFT: 0, cacheHitRate: 0, estimatedCost: 0,
                    });
                    entry.calls += 1;
                    entry.inputTokens += safeInt(c.inputTokens);
                    entry.outputTokens += safeInt(c.outputTokens);
                    entry.thinkingTokens += safeInt(c.thinkingTokens);
                    entry.cacheReadTokens = (entry.cacheReadTokens || 0) + safeInt(c.cacheReadTokens);
                    entry.cacheCreationTokens = (entry.cacheCreationTokens || 0) + safeInt(c.cacheCreationTokens);
                    entry.estimatedCost = (entry.estimatedCost || 0) + (c.unpriced ? 0 : safeCost(c.estimatedCost));
                }
            }
        }
        const filteredCycle: DailyCycleEntry = {
            ...cycle,
            gmTotalCalls: surfStats.calls,
            gmTotalCredits: surfStats.credits,
            gmTotalTokens: surfStats.inputTokens + surfStats.outputTokens,
            gmTotalAllTokens: surfTok,
            gmTotalCacheRead: surfStats.cacheReadTokens,
            gmTotalCacheCreation: surfStats.cacheCreationTokens,
            gmTotalThinkingTokens: surfStats.thinkingTokens,
            estimatedCost: surfStats.estimatedCost > 0 ? surfStats.estimatedCost : undefined,
            gmModelStats: exactModels,
            surface: sourceFilter,
            surfaceBreakdown: { [sourceFilter]: surfStats },
        };
        return { cycle: filteredCycle, surfaces: [sourceFilter] };
    }

    // Single-surface cycle match
    const cycleSurf = normalizeUsageSurface(cycle.surface);
    if (cycleSurf !== sourceFilter) {
        return null;
    }
    return { cycle, surfaces: [cycleSurf] };
}

function aggregateRecordForSource(
    record: DailyRecord,
    sourceFilter: CalendarSourceFilter,
): AggregatedCalendarDay | null {
    const matchingCycles: DailyCycleEntry[] = [];
    const surfaceSet = new Set<UsageSurface>();

    let calls = 0;
    let credits = 0;
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let thinkingTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
    let totalTokens = 0;
    let isLive = false;

    const mergedGM: Record<string, MergedCalendarGMModel> = {};

    for (const rawCycle of record.cycles) {
        const filtered = filterCycleBySource(rawCycle, sourceFilter);
        if (!filtered) { continue; }
        const c = filtered.cycle;
        matchingCycles.push(c);
        for (const s of filtered.surfaces) { surfaceSet.add(s); }
        if (c.isLive) { isLive = true; }

        calls += safeInt(c.gmTotalCalls);
        credits += safeInt(c.gmTotalCredits);
        costUsd += safeCost(c.estimatedCost);

        const cTok = computeCycleTokenTotals(c);
        inputTokens += cTok.inputTokens;
        outputTokens += cTok.outputTokens;
        thinkingTokens += cTok.thinkingTokens;
        cacheReadTokens += cTok.cacheReadTokens;
        cacheCreationTokens += cTok.cacheCreationTokens;
        totalTokens += cTok.totalTokens;

        if (c.gmModelStats) {
            for (const [rawName, gm] of Object.entries(c.gmModelStats)) {
                const name = normalizeModelDisplayName(rawName) || rawName;
                const g = mergedGM[name] || (mergedGM[name] = {
                    calls: 0, credits: 0,
                    inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
                    cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0,
                    ttftSum: 0, ttftWeight: 0,
                    speedOutputSum: 0, speedTimeSum: 0, speedFallbackSum: 0, speedFallbackWeight: 0,
                    tokenCacheSum: 0, tokenCacheWeight: 0, legacyCacheSum: 0, legacyCacheWeight: 0,
                    cost: 0,
                });
                const mIn = safeInt(gm.inputTokens);
                const mOut = safeInt(gm.outputTokens);
                const mThink = safeInt(gm.thinkingTokens);
                const mCacheRead = safeInt(gm.cacheReadTokens);
                const mCacheWrite = safeInt(gm.cacheCreationTokens);

                g.calls += safeInt(gm.calls);
                g.credits += safeInt(gm.credits);
                g.inputTokens += mIn;
                g.outputTokens += mOut;
                g.thinkingTokens += mThink;
                g.cacheReadTokens += mCacheRead;
                g.cacheCreationTokens += mCacheWrite;
                g.totalTokens += mIn + mCacheRead + mCacheWrite + mOut;
                g.cost += safeCost(gm.estimatedCost);

                if (Number.isFinite(gm.avgTTFT) && gm.avgTTFT > 0) {
                    const weight = gm.calls > 0 ? gm.calls : 1;
                    g.ttftSum += gm.avgTTFT * weight;
                    g.ttftWeight += weight;
                }
                if (typeof gm.avgGenTokPerSec === 'number' && Number.isFinite(gm.avgGenTokPerSec) && gm.avgGenTokPerSec > 0) {
                    if (mOut > 0) {
                        g.speedOutputSum += mOut;
                        g.speedTimeSum += mOut / gm.avgGenTokPerSec;
                    } else {
                        const weight = gm.calls > 0 ? gm.calls : 1;
                        g.speedFallbackSum += gm.avgGenTokPerSec * weight;
                        g.speedFallbackWeight += weight;
                    }
                }
                const hasTokenRate = typeof gm.tokenCacheHitRate === 'number'
                    && Number.isFinite(gm.tokenCacheHitRate)
                    && gm.tokenCacheHitRate >= 0;
                const hasCacheRead = typeof gm.cacheReadTokens === 'number'
                    && Number.isFinite(gm.cacheReadTokens)
                    && gm.cacheReadTokens >= 0;
                if (hasCacheRead) {
                    const promptTok = mIn + mCacheRead + mCacheWrite;
                    if (promptTok > 0) {
                        const rate = hasTokenRate ? gm.tokenCacheHitRate! : (mCacheRead / promptTok);
                        g.tokenCacheSum += Math.min(1, Math.max(0, rate)) * promptTok;
                        g.tokenCacheWeight += promptTok;
                    } else if (hasTokenRate) {
                        const weight = gm.calls > 0 ? gm.calls : 1;
                        g.tokenCacheSum += Math.min(1, Math.max(0, gm.tokenCacheHitRate!)) * weight;
                        g.tokenCacheWeight += weight;
                    }
                } else if (hasTokenRate) {
                    const weight = mIn > 0 ? mIn : (gm.calls > 0 ? gm.calls : 1);
                    g.tokenCacheSum += Math.min(1, Math.max(0, gm.tokenCacheHitRate!)) * weight;
                    g.tokenCacheWeight += weight;
                } else if (gm.calls > 0 && Number.isFinite(gm.cacheHitRate) && gm.cacheHitRate >= 0) {
                    g.legacyCacheSum += Math.min(1, Math.max(0, gm.cacheHitRate)) * gm.calls;
                    g.legacyCacheWeight += gm.calls;
                }
            }
        }
    }

    if (matchingCycles.length === 0) { return null; }

    // Day-level weighted telemetry summary
    let dayTtftSum = 0, dayTtftWeight = 0;
    let daySpeedOut = 0, daySpeedTime = 0;
    let dayCacheSum = 0, dayCacheWeight = 0;
    let dayLegacyCacheSum = 0, dayLegacyCacheWeight = 0;
    for (const g of Object.values(mergedGM)) {
        dayTtftSum += g.ttftSum;
        dayTtftWeight += g.ttftWeight;
        daySpeedOut += g.speedOutputSum;
        daySpeedTime += g.speedTimeSum;
        dayCacheSum += g.tokenCacheSum;
        dayCacheWeight += g.tokenCacheWeight;
        dayLegacyCacheSum += g.legacyCacheSum;
        dayLegacyCacheWeight += g.legacyCacheWeight;
    }

    const avgTTFT = dayTtftWeight > 0 ? dayTtftSum / dayTtftWeight : undefined;
    const avgGenTokPerSec = daySpeedTime > 0 ? daySpeedOut / daySpeedTime : undefined;
    const cacheHitRate = dayCacheWeight > 0
        ? dayCacheSum / dayCacheWeight
        : (dayLegacyCacheWeight > 0 ? dayLegacyCacheSum / dayLegacyCacheWeight : undefined);

    return {
        date: record.date,
        cycles: matchingCycles,
        cycleCount: matchingCycles.length,
        isLive,
        sources: [...surfaceSet],
        calls,
        credits,
        inputTokens,
        outputTokens,
        thinkingTokens,
        cacheReadTokens,
        cacheCreationTokens,
        totalTokens,
        costUsd,
        avgTTFT,
        avgGenTokPerSec,
        cacheHitRate,
        models: mergedGM,
    };
}

function toExportDayRow(day: AggregatedCalendarDay): CalendarExportDayRow {
    const models: Record<string, CalendarExportModelRow> = {};
    for (const [name, g] of Object.entries(day.models)) {
        models[name] = {
            calls: g.calls,
            inputTokens: g.inputTokens,
            outputTokens: g.outputTokens,
            thinkingTokens: g.thinkingTokens,
            cacheReadTokens: g.cacheReadTokens,
            cacheCreationTokens: g.cacheCreationTokens,
            totalTokens: g.totalTokens,
            estimatedCostUsd: g.cost,
            credits: g.credits,
        };
    }
    return {
        date: day.date,
        sources: day.sources,
        calls: day.calls,
        cycles: day.cycleCount,
        inputTokens: day.inputTokens,
        outputTokens: day.outputTokens,
        thinkingTokens: day.thinkingTokens,
        cacheReadTokens: day.cacheReadTokens,
        cacheCreationTokens: day.cacheCreationTokens,
        totalTokens: day.totalTokens,
        estimatedCostUsd: day.costUsd,
        credits: day.credits,
        avgTTFT: day.avgTTFT,
        avgGenTokPerSec: day.avgGenTokPerSec,
        cacheHitRate: day.cacheHitRate,
        isLive: day.isLive,
        models,
    };
}

function buildUnifiedDayMap(
    store: DailyStore | undefined,
    options: CalendarRenderOptions,
    nowDate: Date,
): {
    allSourceDays: Map<string, AggregatedCalendarDay>;
    filteredDays: Map<string, AggregatedCalendarDay>;
    availableSources: Set<UsageSurface>;
    mergedRaw: Map<string, DailyRecord>;
} {
    const cliRecords = (options.cliDays || []).map(cliDayRecordToDailyRecord);
    const mergedRaw = mergeArchivedAndLiveRecords({
        store,
        liveLedger: options.liveLedger as LiveLedgerSource | null | undefined,
        cliRecords,
        customPricing: options.customPricing,
        now: nowDate,
    });

    const sourceFilter: CalendarSourceFilter = options.sourceFilter ?? 'all';
    const allSourceDays = new Map<string, AggregatedCalendarDay>();
    const filteredDays = new Map<string, AggregatedCalendarDay>();
    const availableSources = new Set<UsageSurface>();

    for (const [date, record] of [...mergedRaw.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const allAgg = aggregateRecordForSource(record, 'all');
        if (allAgg) {
            allSourceDays.set(date, allAgg);
            for (const s of allAgg.sources) { availableSources.add(s); }
        }
        const filteredAgg = sourceFilter === 'all'
            ? allAgg
            : aggregateRecordForSource(record, sourceFilter);
        if (filteredAgg) {
            filteredDays.set(date, filteredAgg);
        }
    }

    return { allSourceDays, filteredDays, availableSources, mergedRaw };
}

function computeIntensityLevel(value: number, maxValue: number): 0 | 1 | 2 | 3 | 4 {
    if (!Number.isFinite(value) || value <= 0) { return 0; }
    if (!Number.isFinite(maxValue) || maxValue <= 0) { return 1; }
    const ratio = value / maxValue;
    if (ratio >= 0.75) { return 4; }
    if (ratio >= 0.45) { return 3; }
    if (ratio >= 0.20) { return 2; }
    return 1;
}

function dayMetricValue(day: AggregatedCalendarDay | undefined, metricMode: CalendarMetricMode): number {
    if (!day) { return 0; }
    if (metricMode === 'cost') {
        return day.costUsd > 0 ? day.costUsd : (day.totalTokens > 0 ? 1e-6 : 0);
    }
    return day.totalTokens > 0 ? day.totalTokens : day.calls;
}

const WEEKLY_CHART_WEEKS = 16;

interface WeeklyWindowSpec {
    weekInfos: Array<{ key: string; startDate: string; endDate: string }>;
    rangeStart: string;
    rangeEnd: string;
    spanDays: number;
}

/**
 * Single authoritative 16-ISO-week window resolver shared by BOTH `buildWeeklyChartSection`
 * and `filterDaysForRange` / `buildCalendarExportData` so 16w display and exports match 1:1.
 */
function resolveWeekly16Window(todayDate: Date): WeeklyWindowSpec {
    const todayKey = toLocalDateKey(todayDate);
    const seen = new Set<string>();
    const weekInfos: Array<{ key: string; startDate: string; endDate: string }> = [];
    for (let w = WEEKLY_CHART_WEEKS - 1; w >= 0; w--) {
        const refDate = addLocalDays(todayDate, -w * 7);
        const info = getIsoWeekKey(toLocalDateKey(refDate));
        if (!seen.has(info.key)) {
            seen.add(info.key);
            weekInfos.push(info);
        }
    }
    const rangeStart = weekInfos[0]?.startDate || toLocalDateKey(addLocalDays(todayDate, -(WEEKLY_CHART_WEEKS * 7 - 1)));
    const startD = parseDateKeyLocal(rangeStart);
    const spanDays = startD
        ? Math.max(1, utcDayNumber(todayDate) - utcDayNumber(startD) + 1)
        : WEEKLY_CHART_WEEKS * 7;
    return { weekInfos, rangeStart, rangeEnd: todayKey, spanDays };
}

/**
 * Single authoritative `heatmapWeeks` (default 52w) ISO-Monday-aligned window resolver
 * shared by BOTH `buildHeatmapSection` and `filterDaysForRange` / `buildCalendarExportData`.
 */
function resolveDailyHeatmapWindow(anchorDate: Date, heatmapWeeks: number, capEndKey?: string): {
    startMonday: Date;
    endSunday: Date;
    rangeStart: string;
    rangeEnd: string;
    spanDays: number;
} {
    const anchorDay = anchorDate.getDay() === 0 ? 7 : anchorDate.getDay(); // 1=Mon..7=Sun
    const endSunday = addLocalDays(anchorDate, 7 - anchorDay);
    const startMonday = addLocalDays(endSunday, -(heatmapWeeks * 7 - 1));
    const rangeStart = toLocalDateKey(startMonday);
    const endSundayKey = toLocalDateKey(endSunday);
    const rangeEnd = capEndKey && capEndKey < endSundayKey ? capEndKey : endSundayKey;
    const endD = parseDateKeyLocal(rangeEnd) ?? endSunday;
    const spanDays = Math.max(1, utcDayNumber(endD) - utcDayNumber(startMonday) + 1);
    return { startMonday, endSunday, rangeStart, rangeEnd, spanDays };
}

function filterDaysForRange(
    filteredDays: Map<string, AggregatedCalendarDay>,
    periodMode: CalendarPeriodMode,
    currentYear: number,
    todayDate: Date,
    heatmapWeeks: number,
    explicitSelection?: {
        rangeStart?: string;
        rangeEnd?: string;
        selectedDate?: string;
        exportSelectedDateOnly?: boolean;
        selectedDates?: readonly string[];
    },
): { days: AggregatedCalendarDay[]; rangeStart: string; rangeEnd: string; spanDays: number } {
    const todayKey = toLocalDateKey(todayDate);
    const allSorted = [...filteredDays.values()].sort((a, b) => a.date.localeCompare(b.date));

    // Explicit multi-date selection array: empty array MUST export strictly empty!
    if (explicitSelection?.selectedDates !== undefined) {
        const validSet = new Set(
            explicitSelection.selectedDates
                .map(d => (d || '').trim())
                .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)),
        );
        if (validSet.size === 0) {
            return { days: [], rangeStart: '', rangeEnd: '', spanDays: 0 };
        }
        const sortedKeys = [...validSet].sort();
        const matched = allSorted.filter(d => validSet.has(d.date));
        return {
            days: matched,
            rangeStart: sortedKeys[0],
            rangeEnd: sortedKeys[sortedKeys.length - 1],
            spanDays: sortedKeys.length,
        };
    }

    // Explicit single-date selection export: empty or unmatched selection MUST export empty!
    if (explicitSelection?.exportSelectedDateOnly) {
        const cleanSel = (explicitSelection.selectedDate || '').trim();
        if (!cleanSel || !/^\d{4}-\d{2}-\d{2}$/.test(cleanSel)) {
            return { days: [], rangeStart: '', rangeEnd: '', spanDays: 0 };
        }
        const match = filteredDays.get(cleanSel);
        return {
            days: match ? [match] : [],
            rangeStart: cleanSel,
            rangeEnd: cleanSel,
            spanDays: 1,
        };
    }

    // Explicit date range selection: strict inclusive filter with ZERO fallback to all history!
    const hasExplicitRange = Boolean(explicitSelection?.rangeStart || explicitSelection?.rangeEnd);
    if (hasExplicitRange) {
        const startKey = (explicitSelection?.rangeStart || '').trim();
        const endKey = (explicitSelection?.rangeEnd || '').trim();
        const validStart = /^\d{4}-\d{2}-\d{2}$/.test(startKey) ? startKey : '';
        const validEnd = /^\d{4}-\d{2}-\d{2}$/.test(endKey) ? endKey : '';
        if ((startKey && !validStart) || (endKey && !validEnd) || (validStart && validEnd && validStart > validEnd)) {
            return { days: [], rangeStart: validStart, rangeEnd: validEnd, spanDays: 0 };
        }
        const effStart = validStart || validEnd;
        const effEnd = validEnd || validStart;
        const inExplicit = allSorted.filter(d => d.date >= effStart && d.date <= effEnd);
        const sD = parseDateKeyLocal(effStart);
        const eD = parseDateKeyLocal(effEnd);
        const spanDays = sD && eD && eD >= sD ? utcDayNumber(eD) - utcDayNumber(sD) + 1 : 0;
        return { days: inExplicit, rangeStart: effStart, rangeEnd: effEnd, spanDays };
    }

    if (periodMode === 'year') {
        const yearPrefix = `${currentYear}-`;
        const rangeStart = `${currentYear}-01-01`;
        const isCurYear = currentYear === todayDate.getFullYear();
        const rangeEnd = isCurYear ? todayKey : `${currentYear}-12-31`;
        const startD = new Date(currentYear, 0, 1);
        const endD = isCurYear ? todayDate : new Date(currentYear, 11, 31);
        const spanDays = Math.max(1, utcDayNumber(endD) - utcDayNumber(startD) + 1);
        return {
            days: allSorted.filter(d => d.date.startsWith(yearPrefix)),
            rangeStart,
            rangeEnd,
            spanDays,
        };
    }

    if (periodMode === 'monthly') {
        // Last 12 months ending at selected/current month
        const startD = new Date(todayDate.getFullYear(), todayDate.getMonth() - 11, 1);
        const rangeStart = toLocalDateKey(startD);
        const spanDays = Math.max(1, utcDayNumber(todayDate) - utcDayNumber(startD) + 1);
        return {
            days: allSorted.filter(d => d.date >= rangeStart && d.date <= todayKey),
            rangeStart,
            rangeEnd: todayKey,
            spanDays,
        };
    }

    if (periodMode === 'weekly') {
        // Unified 16-ISO-week window matching buildWeeklyChartSection 1:1
        const w16 = resolveWeekly16Window(todayDate);
        return {
            days: allSorted.filter(d => d.date >= w16.rangeStart && d.date <= w16.rangeEnd),
            rangeStart: w16.rangeStart,
            rangeEnd: w16.rangeEnd,
            spanDays: w16.spanDays,
        };
    }

    if (periodMode === 'all') {
        if (allSorted.length === 0) {
            return { days: [], rangeStart: '', rangeEnd: '', spanDays: 0 };
        }
        const rangeStart = allSorted[0].date;
        const rangeEnd = allSorted[allSorted.length - 1].date;
        const sD = parseDateKeyLocal(rangeStart);
        const eD = parseDateKeyLocal(rangeEnd);
        const spanDays = sD && eD && eD >= sD
            ? utcDayNumber(eD) - utcDayNumber(sD) + 1
            : Math.max(1, allSorted.length);
        return { days: allSorted, rangeStart, rangeEnd, spanDays };
    }

    // Default 'daily': unified 52-week (heatmapWeeks) window — strictly NO fallback to allSorted when empty!
    const win = resolveDailyHeatmapWindow(todayDate, heatmapWeeks, todayKey);
    const inWindow = allSorted.filter(d => d.date >= win.rangeStart && d.date <= win.rangeEnd);
    return {
        days: inWindow,
        rangeStart: win.rangeStart,
        rangeEnd: win.rangeEnd,
        spanDays: win.spanDays,
    };
}

// ─── Public Export Data Builder ──────────────────────────────────────────────

/**
 * Build structured JSON, CSV & Markdown exports for the active Calendar filters & date range.
 * Shared by webview / sidecar export command handlers.
 * Empty selections or ranges with zero matching days strictly export EMPTY (never falling back to all history).
 */
export function buildCalendarExportData(
    store?: DailyStore,
    year?: number,
    month?: number,
    options: CalendarRenderOptions = {},
): CalendarExportBundle {
    const nowDate = resolveNowDate(options.now);
    const currentYear = year ?? nowDate.getFullYear();
    const periodMode: CalendarPeriodMode = options.periodMode ?? 'daily';
    const sourceFilter: CalendarSourceFilter = options.sourceFilter ?? 'all';
    const heatmapWeeks = Math.min(53, Math.max(12, Math.floor(options.heatmapWeeks ?? 52)));

    const { filteredDays } = buildUnifiedDayMap(store, options, nowDate);
    const range = filterDaysForRange(filteredDays, periodMode, currentYear, nowDate, heatmapWeeks, {
        rangeStart: options.rangeStart,
        rangeEnd: options.rangeEnd,
        selectedDate: options.selectedDate,
        exportSelectedDateOnly: options.exportSelectedDateOnly,
        selectedDates: options.selectedDates,
    });
    const rows = range.days.map(toExportDayRow);

    const meta: CalendarExportMetadata = {
        exportedAt: nowDate.toISOString(),
        sourceFilter,
        periodMode,
        rangeStart: range.rangeStart,
        rangeEnd: range.rangeEnd,
        spanDays: range.spanDays,
        currency: options.currency ?? 'USD',
        subscription: options.subscription ?? null,
    };

    return {
        rows,
        meta,
        json: buildCalendarExportJson(rows, meta),
        csv: buildCalendarExportCsv(rows, meta),
        markdown: buildCalendarExportMarkdown(rows, meta),
    };
}

// ─── Public HTML Builder ─────────────────────────────────────────────────────

/** Build the complete Studio-Telemetry Calendar & Activity Heatmap tab HTML. */
export function buildCalendarTabContent(
    store?: DailyStore,
    year?: number,
    month?: number,
    options: CalendarRenderOptions = {},
): string {
    const lang: Language = options.language ?? getLanguage();
    const bi = (en: string, zh: string) => tBi(en, zh, ' / ', lang);
    const biHtml = (en: string, zh: string) => tBiHtml(en, zh, ' / ', lang);

    const hasExternalSources = Boolean(
        options.liveLedger
        || (options.swarmGroupCosts && Object.keys(options.swarmGroupCosts).length > 0)
        || (options.cliDays && options.cliDays.length > 0),
    );
    if (!store && !hasExternalSources) {
        return `
            <section class="card empty">
                <h2>${CALENDAR_ICON} <span>${biHtml('Calendar', '日历')}</span></h2>
                <p class="empty-desc">${biHtml(
            'Calendar data is not initialized yet.',
            '日历数据尚未初始化。',
        )}</p>
            </section>`;
    }

    const nowDate = resolveNowDate(options.now);
    const todayKey = toLocalDateKey(nowDate);
    const currentYear = year ?? nowDate.getFullYear();
    const currentMonth = month ?? (nowDate.getMonth() + 1);
    const sourceFilter: CalendarSourceFilter = options.sourceFilter ?? 'all';
    const metricMode: CalendarMetricMode = options.metricMode ?? 'tokens';
    const periodMode: CalendarPeriodMode = options.periodMode ?? 'daily';
    const viewMode: CalendarViewMode | undefined = options.viewMode;
    const currency: CurrencyInput = options.currency ?? 'USD';
    const heatmapWeeks = Math.min(53, Math.max(12, Math.floor(options.heatmapWeeks ?? 52)));
    const selectedDate = options.selectedDate || '';

    const { allSourceDays, filteredDays, availableSources, mergedRaw } = buildUnifiedDayMap(store, options, nowDate);
    const todayAgg = filteredDays.get(todayKey);
    const hasLiveToday = Boolean(todayAgg?.isLive);

    const range = filterDaysForRange(filteredDays, periodMode, currentYear, nowDate, heatmapWeeks, {
        rangeStart: options.rangeStart,
        rangeEnd: options.rangeEnd,
        selectedDate: options.selectedDate,
        exportSelectedDateOnly: options.exportSelectedDateOnly,
        selectedDates: options.selectedDates,
    });
    const parts: string[] = [];

    // ── 1. Dashboard Controls + 4-Card KPI Header ──
    parts.push(buildControlsAndKpiCard({
        filteredDays,
        allSourceDays,
        availableSources,
        todayKey,
        hasLiveToday,
        currentYear,
        currentMonth,
        sourceFilter,
        metricMode,
        periodMode,
        viewMode,
        currency,
        lang,
        bi,
        biHtml,
    }));

    // ── 2. Main Activity Visualization Card (Heatmap / Period Chart / Month Grid / Range Footer / Day Details) ──
    // Note: Redundant legacy "Usage Summary" card removed per D5 (superseded by 4-card KPI header + Range Summary Footer).
    const vizParts: string[] = [];

    if (periodMode === 'daily') {
        if (viewMode !== 'monthGrid') {
            vizParts.push(buildHeatmapSection(
                filteredDays,
                todayDateOrMonthAnchor(filteredDays, currentYear, currentMonth, nowDate),
                heatmapWeeks,
                metricMode,
                currency,
                selectedDate,
                todayKey,
                lang,
                bi,
                biHtml,
            ));
        }
        if (viewMode !== 'heatmap') {
            vizParts.push(buildMonthGridSection(
                filteredDays,
                currentYear,
                currentMonth,
                metricMode,
                currency,
                selectedDate,
                todayKey,
                bi,
                biHtml,
            ));
        }
    } else if (periodMode === 'weekly') {
        vizParts.push(buildWeeklyChartSection(filteredDays, nowDate, metricMode, currency, bi, biHtml));
    } else if (periodMode === 'monthly') {
        vizParts.push(buildMonthlyChartSection(filteredDays, nowDate, metricMode, currency, bi, biHtml));
    } else if (periodMode === 'year') {
        vizParts.push(buildYearChartSection(filteredDays, currentYear, metricMode, currency, bi, biHtml));
    } else if (periodMode === 'all') {
        vizParts.push(buildAllTimeStripSection(filteredDays, metricMode, currency, todayKey, bi, biHtml));
    }

    // Range Summary Footer (with active day avg, calendar daily avg, streak & collapsible Plan ROI)
    vizParts.push(buildRangeSummaryFooter(
        range.days,
        range.spanDays,
        todayKey,
        currency,
        options.subscription ?? null,
        lang,
        bi,
        biHtml,
    ));

    // Day Detail Drawers:
    // Emit drawers for all active days in the current month + selectedDate + todayKey + up to 60 recent active days
    // so both Month Grid clicks and recent Heatmap clicks open instantly without bloating huge 400-day archives.
    const detailDateSet = new Set<string>();
    const monthPrefix = `${currentYear}-${String(currentMonth).padStart(2, '0')}-`;
    for (const date of filteredDays.keys()) {
        if (date.startsWith(monthPrefix)) { detailDateSet.add(date); }
    }
    if (selectedDate && filteredDays.has(selectedDate)) {
        detailDateSet.add(selectedDate);
    }
    if (filteredDays.has(todayKey)) {
        detailDateSet.add(todayKey);
    }
    const recentDates = [...filteredDays.keys()].sort().reverse().slice(0, 60);
    for (const rd of recentDates) { detailDateSet.add(rd); }

    const detailPanels: string[] = [];
    for (const dateStr of [...detailDateSet].sort()) {
        const day = filteredDays.get(dateStr);
        if (day) {
            detailPanels.push(buildDayDetail(day, dateStr, todayKey, currency, metricMode, selectedDate === dateStr, bi, biHtml, Boolean(options.privacyMasked)));
        }
    }

    const sectionTitleHtml = periodMode === 'daily'
        ? biHtml('Activity Heatmap & Calendar', '活动热力图与日历')
        : periodMode === 'weekly'
            ? biHtml('Weekly Activity', '每周活动统计')
            : periodMode === 'monthly'
                ? biHtml('Monthly Activity', '每月活动统计')
                : periodMode === 'year'
                    ? biHtml(`${currentYear} Annual Overview`, `${currentYear} 年度概览`)
                    : biHtml('All-Time Cumulative Activity', '累计总量分布');

    parts.push(`
        <section class="card cal-activity-card" data-cal-period="${periodMode}" data-cal-metric="${metricMode}" data-cal-source="${sourceFilter}">
            <div class="cal-card-head">
                <h2>${CALENDAR_ICON} <span>${sectionTitleHtml}</span></h2>
            </div>
            ${vizParts.join('')}
            <div class="cal-details-host">
                ${detailPanels.join('')}
            </div>
        </section>`);

    // ── 3. Workspace Project Leaderboard & Swarm Group Cost (Plan C / §5.2.5) ──
    const rangeDateKeys = new Set(range.days.map(d => d.date));
    const rangeRawRecords: DailyRecord[] = [];
    for (const dateKey of rangeDateKeys) {
        const rec = mergedRaw.get(dateKey);
        if (rec) { rangeRawRecords.push(rec); }
    }
    const leaderboard = aggregateWorkspaceLeaderboard({
        records: rangeRawRecords,
        surfaceFilter: sourceFilter,
        swarmGroups: options.swarmGroups,
    });
    const leaderboardHtml = buildWorkspaceLeaderboardCard(leaderboard, currency, lang, Boolean(options.privacyMasked), bi, biHtml);
    if (leaderboardHtml) {
        parts.push(leaderboardHtml);
    }
    const filteredLeaderboardSwarmCosts = leaderboard.swarmGroupCosts
        ? Object.fromEntries(
            Object.entries(leaderboard.swarmGroupCosts).filter(([, s]) =>
                (s.uniqueCallCount || 0) > 0 || (s.inclusiveGroupCostUsd || 0) > 0 || (s.unpricedCallCount || 0) > 0,
            ),
        )
        : undefined;
    const hasExplicitRange = Boolean(options.rangeStart || options.rangeEnd || options.exportSelectedDateOnly);
    const rangeIncludesToday = options.selectedDates !== undefined
        ? options.selectedDates.some(date => date.trim() === todayKey)
        : (!hasExplicitRange && periodMode === 'all')
            || (range.spanDays > 0 && range.rangeStart <= todayKey && todayKey <= range.rangeEnd);
    const swarmCostHtml = buildSwarmGroupCostCard(
        filteredLeaderboardSwarmCosts, rangeIncludesToday ? options.swarmGroupCosts : undefined,
        currency, lang, Boolean(options.privacyMasked), bi, biHtml, options.swarmTopology,
    );
    if (swarmCostHtml) {
        parts.push(swarmCostHtml);
    }

    // ── 4. Safe Two-Step Clear History Action ──
    if (store && store.totalDays > 0) {
        const confirming = Boolean(options.confirmingClear);
        parts.push(`
            <div class="cal-clear-section" data-cal-clear-wrap="true">
                <button type="button" class="cal-clear-btn" id="clearCalendarBtn"
                    data-action="calendarClearArm" data-confirm-step="arm"
                    aria-expanded="${confirming ? 'true' : 'false'}"
                    aria-controls="calClearConfirmBar">
                    ${ICON.trash} <span>${biHtml('Clear All Calendar History', '清空所有日历历史')}</span>
                </button>
                <div class="cal-clear-confirm" id="calClearConfirmBar" role="alertdialog" aria-label="${esc(bi('Confirm clearing calendar history', '确认清空日历历史'))}"${confirming ? '' : ' hidden'}>
                    <p class="cal-clear-confirm-text">${biHtml(
            'Clear all archived calendar history? Today\'s live session data is kept, but archived days cannot be undone.',
            '确认清空所有已归档日历历史？今日实时数据不受影响，但已归档日期清空后无法恢复。',
        )}</p>
                    <div class="cal-clear-confirm-actions">
                        <button type="button" class="cal-clear-confirm-btn" id="confirmClearCalendarBtn"
                            data-action="calendarClearConfirm" data-confirm-step="confirm">
                            <span>${biHtml('Confirm Clear', '确认清空')}</span>
                        </button>
                        <button type="button" class="cal-clear-cancel-btn" id="cancelClearCalendarBtn"
                            data-action="calendarClearCancel" data-confirm-step="cancel">
                            <span>${biHtml('Cancel', '取消')}</span>
                        </button>
                    </div>
                </div>
            </div>`);
    }

    return parts.join('');
}

function todayDateOrMonthAnchor(
    filteredDays: Map<string, AggregatedCalendarDay>,
    currentYear: number,
    currentMonth: number,
    nowDate: Date,
): Date {
    // Anchor heatmap at today when viewing current/past range with data in the last year;
    // if user (or test fixture) only has data in a future month relative to nowDate, anchor to that month end.
    const todayKey = toLocalDateKey(nowDate);
    const yearAgoKey = toLocalDateKey(addLocalDays(nowDate, -365));
    let hasInCurrentWindow = false;
    let maxDateKey = '';
    for (const d of filteredDays.keys()) {
        if (d >= yearAgoKey && d <= todayKey) { hasInCurrentWindow = true; }
        if (!maxDateKey || d > maxDateKey) { maxDateKey = d; }
    }
    if (hasInCurrentWindow || filteredDays.size === 0) {
        return nowDate;
    }
    const lastDayOfSelected = new Date(currentYear, currentMonth, 0);
    const maxD = parseDateKeyLocal(maxDateKey);
    if (maxD && maxD > nowDate) {
        return maxD > lastDayOfSelected ? maxD : lastDayOfSelected;
    }
    return lastDayOfSelected;
}

// ─── Section Builders ────────────────────────────────────────────────────────

function buildControlsAndKpiCard(args: {
    filteredDays: Map<string, AggregatedCalendarDay>;
    allSourceDays: Map<string, AggregatedCalendarDay>;
    availableSources: Set<UsageSurface>;
    todayKey: string;
    hasLiveToday: boolean;
    currentYear: number;
    currentMonth: number;
    sourceFilter: CalendarSourceFilter;
    metricMode: CalendarMetricMode;
    periodMode: CalendarPeriodMode;
    viewMode?: CalendarViewMode;
    currency: CurrencyInput;
    lang: Language;
    bi: (en: string, zh: string) => string;
    biHtml: (en: string, zh: string) => string;
}): string {
    const {
        filteredDays, availableSources, todayKey, hasLiveToday,
        currentYear, currentMonth, sourceFilter, metricMode, periodMode,
        viewMode, currency, bi, biHtml,
    } = args;

    const sourceOptions: Array<{ id: CalendarSourceFilter; en: string; zh: string }> = [
        { id: 'all', en: 'All', zh: '全部' },
        { id: 'app', en: 'App', zh: 'App' },
        { id: 'ide', en: 'IDE', zh: 'IDE' },
        { id: 'cli', en: 'CLI', zh: 'CLI' },
    ];

    const periodOptions: Array<{ id: CalendarPeriodMode; en: string; zh: string }> = [
        { id: 'daily', en: 'Daily', zh: '每天' },
        { id: 'weekly', en: 'Weekly', zh: '每周' },
        { id: 'monthly', en: 'Monthly', zh: '每月' },
        { id: 'year', en: 'This Year', zh: '今年' },
        { id: 'all', en: 'All-Time', zh: '累计总量' },
    ];

    const sourceTips: Record<CalendarSourceFilter, readonly [string, string, string, string]> = {
        all: [
            'All Sources',
            '全部来源',
            'Combines Antigravity App, IDE, local CLI usage logs, and legacy unlabeled archive records.',
            '合并显示 Antigravity App、IDE、本地 CLI 用量日志以及未区分来源的历史归档记录。',
        ],
        app: [
            'Antigravity App Source',
            'Antigravity App 来源',
            'Filters history to calls recorded from Antigravity App (Desktop 2.0+ Sidecar).',
            '仅筛选来自 Antigravity App（桌面版 2.0+ 侧边插件）的调用记录。',
        ],
        ide: [
            'Antigravity IDE Source',
            'Antigravity IDE 来源',
            'Filters history to calls recorded from the Antigravity IDE extension.',
            '仅筛选来自 Antigravity IDE 扩展的调用记录。',
        ],
        cli: [
            'CLI Usage Logs',
            'CLI 用量日志',
            'Reads local Antigravity CLI usage logs into Calendar history (the live monitor plugin itself runs only in IDE & App).',
            '读取本地 Antigravity CLI 用量日志并纳入日历历史统计（实时监控插件本身仅支持 IDE 与 App）。',
        ],
    };

    const sourcePills = sourceOptions.map(opt => {
        const active = sourceFilter === opt.id;
        const st = sourceTips[opt.id];
        const tip = calRichTipAttrs(`cal-src-${opt.id}`, st[0], st[1], st[2], st[3], bi);
        return `<button type="button" class="cal-pill-btn${active ? ' is-active' : ''}" data-action="calendarFilterSource" data-cal-source="${opt.id}" aria-pressed="${active ? 'true' : 'false'}"${tip}><span>${biHtml(opt.en, opt.zh)}</span></button>`;
    }).join('');

    const tokensMetricTip = calRichTipAttrs(
        'cal-metric-tokens',
        'Tokens Metric (Additive)',
        'Token 统计（累加口径）',
        'Visualizes total additive tokens per day/period across models.',
        '按天 / 区间展示模型累计处理的 Token 总量。',
        bi,
        'Formula: Fresh Input + Cache Read + Cache Write + Output (Thinking is a subset of Output, never double-counted).',
        '计算公式：新输入 + 缓存读取 + 缓存写入 + 输出（思考 Token 已包含在输出中，不会重复相加）。',
    );
    const costMetricTip = calRichTipAttrs(
        'cal-metric-cost',
        'API Reference Cost',
        'API 参考金额',
        'Visualizes estimated API reference cost using public per-1M token list rates (or your custom rates in Usage & Cost).',
        '按公开 API 每百万 Token 单价（或你在「用量与费用」页设置的自定义单价）估算的参考费用。',
        bi,
        'Reference estimate only — not your actual subscription billing.',
        '仅为等效 API 参考估值，并非实际订阅扣费。',
    );
    const metricPills = `
        <button type="button" class="cal-pill-btn${metricMode === 'tokens' ? ' is-active' : ''}" data-action="calendarSetMetric" data-cal-metric="tokens" aria-pressed="${metricMode === 'tokens' ? 'true' : 'false'}"${tokensMetricTip}><span>${biHtml('Tokens', 'Token 统计')}</span></button>
        <button type="button" class="cal-pill-btn${metricMode === 'cost' ? ' is-active' : ''}" data-action="calendarSetMetric" data-cal-metric="cost" aria-pressed="${metricMode === 'cost' ? 'true' : 'false'}"${costMetricTip}><span>${biHtml('API Cost', 'API 参考金额')}</span></button>`;

    const periodPills = periodOptions.map(opt => {
        const active = periodMode === opt.id;
        return `<button type="button" class="cal-pill-btn${active ? ' is-active' : ''}" data-action="calendarSetPeriod" data-cal-period="${opt.id}" aria-pressed="${active ? 'true' : 'false'}"><span>${biHtml(opt.en, opt.zh)}</span></button>`;
    }).join('');

    const viewToggleHtml = periodMode === 'daily' ? `
        <div class="cal-control-group" role="group" aria-label="${esc(bi('Daily view mode', '视图模式'))}">
            <button type="button" class="cal-pill-btn${viewMode !== 'monthGrid' ? ' is-active' : ''}" data-action="calendarSetView" data-cal-view="heatmap" aria-pressed="${viewMode !== 'monthGrid' ? 'true' : 'false'}"><span>${biHtml('Heatmap', '热力图')}</span></button>
            <button type="button" class="cal-pill-btn${viewMode !== 'heatmap' ? ' is-active' : ''}" data-action="calendarSetView" data-cal-view="monthGrid" aria-pressed="${viewMode !== 'heatmap' ? 'true' : 'false'}"><span>${biHtml('Month Grid', '月历')}</span></button>
        </div>` : '';

    // ── Compute 4 KPI Cards: Total, Today, This Month, This Year ──
    const monthPrefix = `${currentYear}-${String(currentMonth).padStart(2, '0')}-`;
    const yearPrefix = `${currentYear}-`;

    const acc = () => ({ tokens: 0, costUsd: 0, calls: 0, days: 0, cacheRead: 0, promptTotal: 0 });
    const kpiTotal = acc();
    const kpiToday = acc();
    const kpiMonth = acc();
    const kpiYear = acc();

    const addDay = (target: ReturnType<typeof acc>, d: AggregatedCalendarDay) => {
        target.tokens += d.totalTokens;
        target.costUsd += d.costUsd;
        target.calls += d.calls;
        target.days++;
        target.cacheRead += d.cacheReadTokens;
        target.promptTotal += d.inputTokens + d.cacheReadTokens + d.cacheCreationTokens;
    };

    for (const d of filteredDays.values()) {
        addDay(kpiTotal, d);
        if (d.date === todayKey) { addDay(kpiToday, d); }
        if (d.date.startsWith(monthPrefix)) { addDay(kpiMonth, d); }
        if (d.date.startsWith(yearPrefix)) { addDay(kpiYear, d); }
    }

    const fmtCardPrimary = (k: ReturnType<typeof acc>) => metricMode === 'cost'
        ? (k.costUsd > 0 ? esc(formatCostValue(k.costUsd, currency)) : esc(formatCurrencyAmount(0, currency)))
        : formatTokensCompact(k.tokens);

    const fmtCardSecondary = (k: ReturnType<typeof acc>) => metricMode === 'cost'
        ? `${formatTokensCompact(k.tokens)} ${bi('tokens', 'tokens')}`
        : (k.costUsd > 0 ? formatCostValue(k.costUsd, currency) : '—');

    const totalDailyAvg = kpiTotal.days > 0 ? formatTokensCompact(Math.round(kpiTotal.tokens / kpiTotal.days)) : '0';
    const monthDailyAvg = kpiMonth.days > 0 ? formatTokensCompact(Math.round(kpiMonth.tokens / kpiMonth.days)) : '0';
    const yearDailyAvg = kpiYear.days > 0 ? formatTokensCompact(Math.round(kpiYear.tokens / kpiYear.days)) : '0';
    const todayCacheStr = kpiToday.promptTotal > 0
        ? formatCachePercent(kpiToday.cacheRead / kpiToday.promptTotal)
        : '';

    const livePillTip = calRichTipAttrs(
        'cal-live-today-pill',
        'Live Today Merge',
        '今日实时合并',
        'Today\'s active session telemetry is merged live atop archived history so you see Day 1 and current-day progress immediately.',
        '今日进行中的实时调用数据会直接叠加展示在归档历史之上，无需等待午夜归档即可即时查看。',
        bi,
        'Deduplicated automatically across quota resets and midnight rollovers — never double-counted.',
        '跨配额重置与午夜跨天时自动去重，不会重复计入。',
    );
    const livePillHtml = hasLiveToday
        ? `<span class="cal-live-pill" role="status"${livePillTip}><span class="cal-live-dot" aria-hidden="true"></span><span>${biHtml('Live Today', '今日实时')}</span></span>`
        : '';

    const unknownNoticeHtml = sourceFilter === 'all' && availableSources.has('unknown') && availableSources.size > 1
        ? `<p class="cal-source-note">${biHtml(
            'Legacy records without a surface tag are included under All (labeled Unlabeled).',
            '未记录来源标签的历史数据包含在「全部」中（标记为「未区分来源」）。',
        )}</p>`
        : '';

    const mdExportTip = calRichTipAttrs(
        'cal-export-md',
        'Export Markdown',
        '导出 Markdown',
        'Exports a GitHub-Flavored Markdown table for the exact active filter, currency, and date range (empty selection exports empty).',
        '按当前筛选、币种与日期范围导出 Markdown 表格（空选择导出为空）。',
        bi,
    );
    const csvExportTip = calRichTipAttrs(
        'cal-export-csv',
        'Export CSV',
        '导出 CSV',
        'Downloads a spreadsheet-friendly CSV table for the currently selected source filter and time period.',
        '导出当前筛选来源与时间区间内的每日汇总 CSV 表格文件。',
        bi,
        'Includes additive token breakdown, API reference cost, calls, and active models.',
        '包含 Token 累加明细、API 参考费用、调用次数与活跃模型。',
    );
    const jsonExportTip = calRichTipAttrs(
        'cal-export-json',
        'Export JSON',
        '导出 JSON',
        'Downloads structured JSON telemetry for the currently selected source filter and time period.',
        '导出当前筛选来源与时间区间内的结构化 JSON 遥测数据。',
        bi,
        'Includes metadata, per-day totals, and per-model breakdowns.',
        '包含筛选元数据、每日汇总及按模型拆分明细。',
    );
    const kpiAvgTip = (scope: 'total' | 'month' | 'year', daysCount: number) => calRichTipAttrs(
        `cal-kpi-meta-${scope}`,
        'Active Day Avg (KPI)',
        '活跃日均（KPI 口径）',
        `The per-day figure here divides total tokens by active days with usage (${daysCount}d), excluding idle days.`,
        `此处的「/天」数值为活跃日均：用总 Token 除以有记录的活跃天数（${daysCount} 天），不含空闲日。`,
        bi,
        'Compare with "Calendar Daily Avg" in the summary footer below, which divides by every calendar day in the range.',
        '下方区间摘要中的「折合每天」会除以区间内全部自然日（含无记录日期）。',
    );
    const kpiTodayTip = calRichTipAttrs(
        'cal-kpi-meta-today',
        'Today\'s Calls & Cache',
        '今日调用与缓存',
        'Total GM model calls today and prompt cache hit ratio across today\'s prompt tokens.',
        '今日累计模型调用次数（GM 调用）及提示词缓存命中比例。',
        bi,
        'Cache hit % = Cache Read ÷ (Fresh Input + Cache Read + Cache Write).',
        '缓存命中率 = 缓存读取 ÷（新输入 + 缓存读取 + 缓存写入）。',
    );

    return `
        <section class="card cal-dashboard-card">
            <div class="cal-dashboard-top">
                <div class="cal-dashboard-title-row">
                    <h2>${CALENDAR_ICON} <span>${biHtml('Activity Telemetry', '活动统计与热力图')}</span></h2>
                    ${livePillHtml}
                </div>
                <div class="cal-export-actions" role="group" aria-label="${esc(bi('Export calendar data', '导出日历数据'))}">
                    <button type="button" class="cal-export-btn" data-action="calendarExportMarkdown" data-cal-export="markdown" aria-label="${esc(bi('Export filtered range as Markdown', '导出当前筛选区间为 Markdown'))}"${mdExportTip}>
                        ${EXPORT_ICON} <span>Markdown</span>
                    </button>
                    <button type="button" class="cal-export-btn" data-action="calendarExportCsv" data-cal-export="csv" aria-label="${esc(bi('Export filtered range as CSV', '导出当前筛选区间为 CSV'))}"${csvExportTip}>
                        ${EXPORT_ICON} <span>CSV</span>
                    </button>
                    <button type="button" class="cal-export-btn" data-action="calendarExportJson" data-cal-export="json" aria-label="${esc(bi('Export filtered range as JSON', '导出当前筛选区间为 JSON'))}"${jsonExportTip}>
                        ${EXPORT_ICON} <span>JSON</span>
                    </button>
                </div>
            </div>

            <div class="cal-controls-bar">
                <div class="cal-control-group" role="group" aria-label="${esc(bi('Data source filter', '数据来源筛选'))}">
                    ${sourcePills}
                </div>
                <div class="cal-control-group" role="group" aria-label="${esc(bi('Display metric', '统计指标'))}">
                    ${metricPills}
                </div>
                <div class="cal-control-group" role="group" aria-label="${esc(bi('Time period', '时间维度'))}">
                    ${periodPills}
                </div>
                ${viewToggleHtml}
            </div>
            ${unknownNoticeHtml}

            <div class="cal-kpi-grid">
                <article class="cal-kpi-card" data-cal-kpi="total">
                    <div class="cal-kpi-label">${biHtml('Total', '累计处理')}</div>
                    <div class="cal-kpi-val">${fmtCardPrimary(kpiTotal)}</div>
                    <div class="cal-kpi-sub">${esc(fmtCardSecondary(kpiTotal))}</div>
                    <div class="cal-kpi-meta"${kpiAvgTip('total', kpiTotal.days)}>${kpiTotal.calls} ${biHtml('calls', '调用')} · ${kpiTotal.days}${biHtml('d', '天')} · ${totalDailyAvg}/${biHtml('d', '天')}</div>
                </article>
                <article class="cal-kpi-card${hasLiveToday ? ' is-live' : ''}" data-cal-kpi="today">
                    <div class="cal-kpi-label">${biHtml('Today', '今日使用')}${hasLiveToday ? ` <span class="cal-kpi-live-tag">${biHtml('Live', '实时')}</span>` : ''}</div>
                    <div class="cal-kpi-val">${fmtCardPrimary(kpiToday)}</div>
                    <div class="cal-kpi-sub">${esc(fmtCardSecondary(kpiToday))}</div>
                    <div class="cal-kpi-meta"${kpiTodayTip}>${kpiToday.calls} ${biHtml('calls', '调用')}${todayCacheStr ? ` · ${biHtml('Cache', '缓存')} ${esc(todayCacheStr)}` : ''}</div>
                </article>
                <article class="cal-kpi-card" data-cal-kpi="month">
                    <div class="cal-kpi-label">${biHtml('This Month', '本月使用')}</div>
                    <div class="cal-kpi-val">${fmtCardPrimary(kpiMonth)}</div>
                    <div class="cal-kpi-sub">${esc(fmtCardSecondary(kpiMonth))}</div>
                    <div class="cal-kpi-meta"${kpiAvgTip('month', kpiMonth.days)}>${kpiMonth.calls} ${biHtml('calls', '调用')} · ${kpiMonth.days}${biHtml('d', '天')} · ${monthDailyAvg}/${biHtml('d', '天')}</div>
                </article>
                <article class="cal-kpi-card" data-cal-kpi="year">
                    <div class="cal-kpi-label">${biHtml('This Year', '年度使用')}</div>
                    <div class="cal-kpi-val">${fmtCardPrimary(kpiYear)}</div>
                    <div class="cal-kpi-sub">${esc(fmtCardSecondary(kpiYear))}</div>
                    <div class="cal-kpi-meta"${kpiAvgTip('year', kpiYear.days)}>${kpiYear.calls} ${biHtml('calls', '调用')} · ${kpiYear.days}${biHtml('d', '天')} · ${yearDailyAvg}/${biHtml('d', '天')}</div>
                </article>
            </div>
        </section>`;
}

function buildHeatmapSection(
    filteredDays: Map<string, AggregatedCalendarDay>,
    anchorDate: Date,
    weeks: number,
    metricMode: CalendarMetricMode,
    currency: CurrencyInput,
    selectedDate: string,
    todayKey: string,
    lang: Language,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
): string {
    // Align heatmap end to Sunday of anchorDate's ISO week via the shared window resolver
    const { startMonday } = resolveDailyHeatmapWindow(anchorDate, weeks);

    // Find max value across visible weeks for 5-level scaling
    let maxVal = 0;
    const gridDates: string[] = [];
    for (let i = 0; i < weeks * 7; i++) {
        const dKey = toLocalDateKey(addLocalDays(startMonday, i));
        gridDates.push(dKey);
        const val = dayMetricValue(filteredDays.get(dKey), metricMode);
        if (val > maxVal) { maxVal = val; }
    }

    // Build month labels along top columns
    const monthLabels: string[] = [];
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
        const colDate = addLocalDays(startMonday, w * 7);
        const m = colDate.getMonth();
        if (m !== lastMonth) {
            const mText = lang === 'zh' ? MONTH_NAMES_ZH[m] : MONTH_NAMES_EN[m];
            monthLabels.push(`<span class="cal-hm-month-label" style="grid-column:${w + 1}">${esc(mText)}</span>`);
            lastMonth = m;
        }
    }

    // Build columns (each column = 7 rows Mon..Sun)
    const cells: string[] = [];
    for (let w = 0; w < weeks; w++) {
        const colCells: string[] = [];
        for (let r = 0; r < 7; r++) {
            const idx = w * 7 + r;
            const dateStr = gridDates[idx];
            const day = filteredDays.get(dateStr);
            const isFuture = dateStr > todayKey && !day;
            const isTodayCell = dateStr === todayKey;
            const isSelected = Boolean(selectedDate && selectedDate === dateStr);

            if (day) {
                const level = computeIntensityLevel(dayMetricValue(day, metricMode), maxVal);
                const costText = day.costUsd > 0 ? formatCostValue(day.costUsd, currency) : '—';
                const tip = `${dateStr} · ${formatTokensCompact(day.totalTokens)} ${bi('tokens', 'tokens')} · ${costText} · ${day.calls} ${bi('calls', '调用')}${day.isLive ? ` · ${bi('Live', '实时')}` : ''}`;
                const tipTitle = day.isLive ? `${dateStr} · ${bi('Live', '实时')}` : dateStr;
                const tipBody = `${formatTokensCompact(day.totalTokens)} ${bi('tokens', 'tokens')} · ${costText} · ${day.calls} ${bi('calls', '调用')}`;
                const tipMeta = bi(
                    `Intensity level ${level}/4 (relative to visible peak) · Click to view breakdown.`,
                    `相对强度 ${level}/4 档（对照当前窗口峰值）· 点击展开当日明细。`,
                );
                const cls = `cal-hm-cell has-data cal-lvl-${level}${isTodayCell ? ' is-today' : ''}${isSelected ? ' selected' : ''}${metricMode === 'cost' ? ' is-cost' : ''}`;
                colCells.push(`<button type="button" class="${cls}" data-action="calendarSelectDate" data-cal-date="${esc(dateStr)}" data-cal-level="${level}"${calRichTipRawAttrs(`cal-hm-${dateStr}`, tipTitle, tipBody, tipMeta)} aria-label="${esc(tip)}"></button>`);
            } else {
                const emptyTip = `${dateStr} · ${bi('No activity', '无记录')}`;
                const emptyBody = isFuture
                    ? bi('Future date — no recorded activity.', '未来日期，暂无活动记录。')
                    : bi('No recorded activity on this date.', '当日无活动记录。');
                const emptyMeta = bi('Relative intensity level 0/4.', '相对强度 0/4 档（无记录）。');
                const cls = `cal-hm-cell cal-lvl-0${isTodayCell ? ' is-today' : ''}${isFuture ? ' is-future' : ''}`;
                colCells.push(`<span class="${cls}" role="img" data-cal-date="${esc(dateStr)}" data-cal-level="0"${calRichTipRawAttrs(`cal-hm-${dateStr}`, dateStr, emptyBody, emptyMeta)} aria-label="${esc(emptyTip)}"></span>`);
            }
        }
        cells.push(`<div class="cal-hm-col">${colCells.join('')}</div>`);
    }

    const legendCells = [0, 1, 2, 3, 4]
        .map(lvl => `<span class="cal-hm-swatch cal-lvl-${lvl}${metricMode === 'cost' ? ' is-cost' : ''}" aria-hidden="true"></span>`)
        .join('');
    const legendTip = calRichTipAttrs(
        'cal-hm-legend',
        '5-Level Relative Intensity Scale',
        '5 档相对强度色阶',
        'Each square\'s shade is scaled relative to the highest-activity day in the visible heatmap window.',
        '每个方格的颜色深浅按当前可见热力图窗口内的最高峰值日做相对分档。',
        bi,
        '0 = none · 1 = <20% · 2 = 20–44% · 3 = 45–74% · 4 = ≥75% of peak.',
        '0 档 = 无 · 1 档 = <20% · 2 档 = 20–44% · 3 档 = 45–74% · 4 档 = ≥75% 峰值。',
    );

    const dayAxisLabels = [0, 2, 4].map(idx => {
        const label = lang === 'zh' ? DAY_HEADERS_ZH[idx] : DAY_HEADERS_EN[idx];
        return `<span class="cal-hm-day-label" style="grid-row:${idx + 1}">${esc(label)}</span>`;
    }).join('');

    return `
        <div class="cal-heatmap-section" data-cal-heatmap="true">
            <div class="cal-heatmap-head">
                <span class="cal-heatmap-caption">${biHtml(`Last ${weeks} Weeks`, `近 ${weeks} 周活动热力图`)}</span>
                <div class="cal-hm-legend" role="group" aria-label="${esc(bi('Activity intensity scale', '活动强度图例'))}"${legendTip}>
                    <span class="cal-hm-legend-text">${biHtml('Less', '较少')}</span>
                    ${legendCells}
                    <span class="cal-hm-legend-text">${biHtml('More', '较多')}</span>
                </div>
            </div>
            <div class="cal-heatmap-scroll" tabindex="0" role="region" aria-label="${esc(bi('52-week activity heatmap', '52 周活动热力图'))}">
                <div class="cal-heatmap-inner">
                    <div class="cal-hm-months" style="--cal-hm-weeks:${weeks}">
                        ${monthLabels.join('')}
                    </div>
                    <div class="cal-hm-body">
                        <div class="cal-hm-days" aria-hidden="true">${dayAxisLabels}</div>
                        <div class="cal-hm-grid">${cells.join('')}</div>
                    </div>
                </div>
            </div>
        </div>`;
}

function buildMonthGridSection(
    filteredDays: Map<string, AggregatedCalendarDay>,
    year: number,
    month: number,
    metricMode: CalendarMetricMode,
    currency: CurrencyInput,
    selectedDate: string,
    todayKey: string,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
): string {
    const { daysInMonth, startDay } = getMonthGrid(year, month);
    const prefix = `${year}-${String(month).padStart(2, '0')}-`;

    let maxMonthVal = 0;
    for (const [date, day] of filteredDays) {
        if (!date.startsWith(prefix)) { continue; }
        const v = dayMetricValue(day, metricMode);
        if (v > maxMonthVal) { maxMonthVal = v; }
    }

    const monthLabel = biHtml(
        `${MONTH_NAMES_EN[month - 1]} ${year}`,
        `${year}年${MONTH_NAMES_ZH[month - 1]}`,
    );

    const headerCells = DAY_HEADERS_EN
        .map((enDay, idx) => `<div class="cal-header-cell">${biHtml(enDay, DAY_HEADERS_ZH[idx])}</div>`)
        .join('');

    const cells: string[] = [];
    for (let i = 0; i < startDay; i++) {
        cells.push('<div class="cal-cell empty-cell" aria-hidden="true"></div>');
    }

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const dayData = filteredDays.get(dateStr);
        const todayClass = dateStr === todayKey ? ' today' : '';
        const selectedClass = selectedDate === dateStr ? ' selected' : '';

        if (dayData) {
            const level = computeIntensityLevel(dayMetricValue(dayData, metricMode), maxMonthVal);
            const highActivity = dayData.calls > 20 || dayData.costUsd > 0.5 || level >= 3;
            const costText = dayData.costUsd > 0 ? formatCostValue(dayData.costUsd, currency) : '—';
            const tooltip = `${dateStr} · ${formatTokensCompact(dayData.totalTokens)} ${bi('tokens', 'tokens')} · ${costText} · ${dayData.calls} ${bi('calls', '调用')}${dayData.isLive ? ` · ${bi('Live', '实时')}` : ''}`;
            const tipTitle = dayData.isLive ? `${dateStr} · ${bi('Live', '实时')}` : dateStr;
            const tipBody = `${formatTokensCompact(dayData.totalTokens)} ${bi('tokens', 'tokens')} · ${costText} · ${dayData.calls} ${bi('calls', '调用')}`;
            const tipMeta = highActivity
                ? bi(
                    `High-activity day (calls > 20, API cost > $0.50, or level ≥ 3; currently level ${level}/4) · Click for details.`,
                    `高活跃日（调用 > 20、参考费用 > $0.50 或强度 ≥ 3 档，当前 ${level}/4 档）· 点击查看详情。`,
                )
                : bi(
                    `Activity level ${level}/4 (standard dot) · Click for full breakdown.`,
                    `活动强度 ${level}/4 档（常规圆点）· 点击展开完整明细。`,
                );
            const miniVal = metricMode === 'cost'
                ? (dayData.costUsd > 0 ? formatCostValue(dayData.costUsd, currency) : formatTokensCompact(dayData.totalTokens))
                : formatTokensCompact(dayData.totalTokens);
            cells.push(`
                <button type="button" class="cal-cell has-data cal-cell-lvl-${level}${todayClass}${selectedClass}${metricMode === 'cost' ? ' is-cost' : ''}" data-cal-date="${esc(dateStr)}" data-cal-level="${level}"${calRichTipRawAttrs(`cal-grid-${dateStr}`, tipTitle, tipBody, tipMeta)} aria-label="${esc(tooltip)}">
                    <span class="cal-day-num">${dayNum}</span>
                    <span class="cal-cell-mini">${esc(miniVal)}</span>
                    <span class="cal-dot${highActivity ? ' high-activity' : ''}" aria-hidden="true"></span>
                </button>`);
        } else {
            cells.push(`<div class="cal-cell${todayClass}"><span class="cal-day-num">${dayNum}</span></div>`);
        }
    }

    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const monthDotTip = calRichTipAttrs(
        'cal-month-dot-legend',
        'Month Grid Dots & Intensity',
        '月历圆点与高活跃标记',
        'Each date with recorded usage shows a dot; a highlighted high-activity dot marks heavy usage days.',
        '有记录的日期下方会显示小圆点；高亮高活跃圆点代表高用量日期。',
        bi,
        'High-activity rule: calls > 20, API cost > $0.50, or relative level ≥ 3.',
        '高活跃判定：当日调用 > 20 次、API 参考费用 > $0.50 或相对强度 ≥ 3 档。',
    );

    return `
        <div class="cal-month-section">
            <div class="cal-nav">
                <button type="button" class="cal-nav-btn" aria-label="${esc(bi('Previous month', '上个月'))}" data-cal-nav="prev" data-cal-year="${prevYear}" data-cal-month="${prevMonth}">
                    ${CHEVRON_LEFT}
                </button>
                <span class="cal-month-label"${monthDotTip}>${monthLabel}</span>
                <button type="button" class="cal-nav-btn" aria-label="${esc(bi('Next month', '下个月'))}" data-cal-nav="next" data-cal-year="${nextYear}" data-cal-month="${nextMonth}">
                    ${CHEVRON_RIGHT}
                </button>
            </div>
            <div class="cal-grid">
                ${headerCells}
                ${cells.join('')}
            </div>
        </div>`;
}

interface PeriodBarDatum {
    key: string;
    label: string;
    sublabel: string;
    tokens: number;
    costUsd: number;
    calls: number;
    activeDays: number;
    jumpYear?: number;
    jumpMonth?: number;
    jumpDate?: string;
}

function buildPeriodBarsHtml(
    chartKind: 'weekly' | 'monthly' | 'year',
    bars: readonly PeriodBarDatum[],
    metricMode: CalendarMetricMode,
    currency: CurrencyInput,
    emptyTextHtml: string,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
): string {
    const hasAny = bars.some(b => b.tokens > 0 || b.costUsd > 0 || b.calls > 0);
    if (!hasAny) {
        return `<p class="cal-summary-empty">${emptyTextHtml}</p>`;
    }

    const metricVal = (b: PeriodBarDatum) => metricMode === 'cost' ? b.costUsd : b.tokens;
    let maxVal = 0;
    let peakBar: PeriodBarDatum | null = null;
    for (const b of bars) {
        const v = metricVal(b);
        if (v > maxVal) {
            maxVal = v;
            peakBar = b;
        }
    }

    const rows = bars.map(b => {
        const v = metricVal(b);
        const pct = maxVal > 0 ? Math.max(v > 0 ? 3 : 0, Math.round((v / maxVal) * 100)) : 0;
        const isPeak = peakBar && peakBar.key === b.key && v > 0;
        const valText = metricMode === 'cost'
            ? (b.costUsd > 0 ? formatCostValue(b.costUsd, currency) : '—')
            : formatTokensCompact(b.tokens);
        const secondaryText = metricMode === 'cost'
            ? `${formatTokensCompact(b.tokens)} · ${b.calls} ${bi('calls', '调用')}`
            : `${b.costUsd > 0 ? formatCostValue(b.costUsd, currency) : '—'} · ${b.calls} ${bi('calls', '调用')}`;
        const costStr = b.costUsd > 0 ? formatCostValue(b.costUsd, currency) : '—';
        const tip = `${b.label} (${b.sublabel}) · ${formatTokensCompact(b.tokens)} ${bi('tokens', 'tokens')} · ${costStr} · ${b.calls} ${bi('calls', '调用')}`;
        const tipTitle = `${b.label} (${b.sublabel})`;
        const tipBody = `${formatTokensCompact(b.tokens)} ${bi('tokens', 'tokens')} · ${costStr} · ${b.calls} ${bi('calls', '调用')} · ${b.activeDays} ${bi('active days', '活跃天')}`;

        const jumpAttrs = b.jumpYear && b.jumpMonth
            ? ` data-cal-nav="jump" data-cal-year="${b.jumpYear}" data-cal-month="${b.jumpMonth}"`
            : (b.jumpDate ? ` data-action="calendarJumpDate" data-cal-date="${esc(b.jumpDate)}"` : '');
        const tipMeta = jumpAttrs
            ? bi('Click to jump to this period in Daily view · Bar width scales to peak period.', '点击跳转至该区间日视图 · 柱宽按峰值区间缩放。')
            : bi('No recorded activity in this period.', '该区间暂无活动记录。');
        const tag = jumpAttrs ? 'button type="button"' : 'div';
        const closeTag = jumpAttrs ? 'button' : 'div';

        const ariaLabelAttr = jumpAttrs ? ` aria-label="${esc(tip)}"` : '';

        return `
            <${tag} class="cal-bar-row${isPeak ? ' is-peak' : ''}${jumpAttrs ? ' is-interactive' : ''}"${jumpAttrs}${calRichTipRawAttrs(`cal-bar-${chartKind}-${calSlugKey(b.key)}`, tipTitle, tipBody, tipMeta)}${ariaLabelAttr}>
                <span class="cal-bar-label">
                    <span class="cal-bar-title">${esc(b.label)}</span>
                    <span class="cal-bar-sub">${esc(b.sublabel)}</span>
                </span>
                <span class="cal-bar-track" aria-hidden="true">
                    <span class="cal-bar-fill${metricMode === 'cost' ? ' is-cost' : ''}" style="width:${pct}%"></span>
                </span>
                <span class="cal-bar-val">
                    <span class="cal-bar-primary">${esc(valText)}</span>
                    <span class="cal-bar-secondary">${esc(secondaryText)}</span>
                </span>
            </${closeTag}>`;
    }).join('');

    const peakCallout = peakBar ? `
        <div class="cal-peak-banner">
            <span class="cal-peak-label">${biHtml('Peak Period', '峰值区间')}:</span>
            <strong class="cal-peak-val">${esc(peakBar.label)} (${esc(peakBar.sublabel)})</strong>
            <span class="cal-peak-meta">${formatTokensCompact(peakBar.tokens)} ${biHtml('tokens', 'tokens')}${peakBar.costUsd > 0 ? ` · ${esc(formatCostValue(peakBar.costUsd, currency))}` : ''}</span>
        </div>` : '';

    return `${peakCallout}<div class="cal-bar-chart">${rows}</div>`;
}

function buildWeeklyChartSection(
    filteredDays: Map<string, AggregatedCalendarDay>,
    nowDate: Date,
    metricMode: CalendarMetricMode,
    currency: CurrencyInput,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
): string {
    // Shares resolveWeekly16Window() with filterDaysForRange / buildCalendarExportData
    // so the 16-week display bars and 16-week CSV/JSON/Markdown exports match 1:1.
    const w16 = resolveWeekly16Window(nowDate);
    const buckets = new Map<string, PeriodBarDatum>();
    const orderedKeys: string[] = [];

    for (const info of w16.weekInfos) {
        orderedKeys.push(info.key);
        buckets.set(info.key, {
            key: info.key,
            label: info.key,
            sublabel: `${info.startDate.slice(5)}–${info.endDate.slice(5)}`,
            tokens: 0,
            costUsd: 0,
            calls: 0,
            activeDays: 0,
        });
    }

    for (const day of filteredDays.values()) {
        if (day.date < w16.rangeStart || day.date > w16.rangeEnd) { continue; }
        const info = getIsoWeekKey(day.date);
        const bucket = buckets.get(info.key);
        if (!bucket) { continue; }
        bucket.tokens += day.totalTokens;
        bucket.costUsd += day.costUsd;
        bucket.calls += day.calls;
        bucket.activeDays++;
        if (!bucket.jumpDate || day.totalTokens > 0) {
            bucket.jumpDate = day.date;
        }
    }

    const bars = orderedKeys.map(k => buckets.get(k)!);
    return `<div class="cal-period-chart" data-cal-chart="weekly">${buildPeriodBarsHtml(
        'weekly',
        bars,
        metricMode,
        currency,
        biHtml('No weekly activity recorded in the last 16 weeks.', '近 16 周暂无活动记录。'),
        bi,
        biHtml,
    )}</div>`;
}

function buildMonthlyChartSection(
    filteredDays: Map<string, AggregatedCalendarDay>,
    nowDate: Date,
    metricMode: CalendarMetricMode,
    currency: CurrencyInput,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
): string {
    const bars: PeriodBarDatum[] = [];
    const byYm = new Map<string, PeriodBarDatum>();

    for (let i = 11; i >= 0; i--) {
        const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const ym = `${y}-${String(m).padStart(2, '0')}`;
        const datum: PeriodBarDatum = {
            key: ym,
            label: ym,
            sublabel: bi(MONTH_NAMES_EN[m - 1], MONTH_NAMES_ZH[m - 1]),
            tokens: 0,
            costUsd: 0,
            calls: 0,
            activeDays: 0,
            jumpYear: y,
            jumpMonth: m,
        };
        bars.push(datum);
        byYm.set(ym, datum);
    }

    for (const day of filteredDays.values()) {
        const bucket = byYm.get(day.date.slice(0, 7));
        if (!bucket) { continue; }
        bucket.tokens += day.totalTokens;
        bucket.costUsd += day.costUsd;
        bucket.calls += day.calls;
        bucket.activeDays++;
    }

    return `<div class="cal-period-chart" data-cal-chart="monthly">${buildPeriodBarsHtml(
        'monthly',
        bars,
        metricMode,
        currency,
        biHtml('No monthly activity recorded in the last 12 months.', '近 12 个月暂无活动记录。'),
        bi,
        biHtml,
    )}</div>`;
}

function buildYearChartSection(
    filteredDays: Map<string, AggregatedCalendarDay>,
    year: number,
    metricMode: CalendarMetricMode,
    currency: CurrencyInput,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
): string {
    const bars: PeriodBarDatum[] = [];
    const byYm = new Map<string, PeriodBarDatum>();

    for (let m = 1; m <= 12; m++) {
        const ym = `${year}-${String(m).padStart(2, '0')}`;
        const datum: PeriodBarDatum = {
            key: ym,
            label: bi(`${MONTH_NAMES_EN[m - 1]} ${year}`, `${year}年${MONTH_NAMES_ZH[m - 1]}`),
            sublabel: ym,
            tokens: 0,
            costUsd: 0,
            calls: 0,
            activeDays: 0,
            jumpYear: year,
            jumpMonth: m,
        };
        bars.push(datum);
        byYm.set(ym, datum);
    }

    for (const day of filteredDays.values()) {
        const bucket = byYm.get(day.date.slice(0, 7));
        if (!bucket) { continue; }
        bucket.tokens += day.totalTokens;
        bucket.costUsd += day.costUsd;
        bucket.calls += day.calls;
        bucket.activeDays++;
    }

    return `<div class="cal-period-chart" data-cal-chart="year">${buildPeriodBarsHtml(
        'year',
        bars,
        metricMode,
        currency,
        biHtml(`No activity recorded for ${year} yet.`, `${year} 年暂无活动记录。`),
        bi,
        biHtml,
    )}</div>`;
}

function buildAllTimeStripSection(
    filteredDays: Map<string, AggregatedCalendarDay>,
    metricMode: CalendarMetricMode,
    currency: CurrencyInput,
    todayKey: string,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
): string {
    const allSorted = [...filteredDays.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (allSorted.length === 0) {
        return `<p class="cal-summary-empty">${biHtml('No recorded activity history yet.', '暂无累计活动历史。')}</p>`;
    }

    // Group by YYYY-MM for proportional cumulative strip
    const monthSpans = new Map<string, {
        ym: string;
        year: number;
        month: number;
        tokens: number;
        costUsd: number;
        calls: number;
        days: number;
        peakDate: string;
        peakValue: number;
    }>();

    let peakDay: AggregatedCalendarDay = allSorted[0];
    for (const d of allSorted) {
        const val = dayMetricValue(d, metricMode);
        if (val > dayMetricValue(peakDay, metricMode)) { peakDay = d; }
        const ym = d.date.slice(0, 7);
        const [ys, ms] = ym.split('-');
        let span = monthSpans.get(ym);
        if (!span) {
            span = {
                ym,
                year: Number(ys),
                month: Number(ms),
                tokens: 0,
                costUsd: 0,
                calls: 0,
                days: 0,
                peakDate: d.date,
                peakValue: val,
            };
            monthSpans.set(ym, span);
        }
        span.tokens += d.totalTokens;
        span.costUsd += d.costUsd;
        span.calls += d.calls;
        span.days++;
        if (val > span.peakValue) {
            span.peakValue = val;
            span.peakDate = d.date;
        }
    }

    const spans = [...monthSpans.values()].sort((a, b) => a.ym.localeCompare(b.ym));
    const useCostMetric = metricMode === 'cost' && spans.some(s => s.costUsd > 0);
    const spanMetric = (s: typeof spans[number]) => useCostMetric ? s.costUsd : s.tokens;
    const spanGrandTotal = spans.reduce((sum, s) => sum + spanMetric(s), 0);

    const peakSpan = spans.reduce((best, cur) => (spanMetric(cur) > spanMetric(best) ? cur : best), spans[0]);

    const streaks = computeActivityStreaks(allSorted.map(d => d.date), todayKey);

    const segments = spans.map((s, idx) => {
        const val = spanMetric(s);
        const share = spanGrandTotal > 0 ? (val / spanGrandTotal) * 100 : (100 / spans.length);
        const tone = idx % 4;
        const isPeak = s.ym === peakSpan.ym;
        const costStr = s.costUsd > 0 ? formatCostValue(s.costUsd, currency) : '—';
        const tip = `${s.ym} · ${share.toFixed(1)}% · ${formatTokensCompact(s.tokens)} ${bi('tokens', 'tokens')} · ${costStr} · ${s.days} ${bi('days', '天')}`;
        const segTitle = `${s.ym} · ${share.toFixed(1)}%`;
        const segBody = `${formatTokensCompact(s.tokens)} ${bi('tokens', 'tokens')} · ${costStr} · ${s.calls} ${bi('calls', '调用')} · ${s.days} ${bi('active days', '活跃天')}`;
        const segMeta = bi(
            `Proportional share of all-time ${useCostMetric ? 'API reference cost' : 'tokens'} · Click to jump to ${s.ym}.`,
            `占历史累计${useCostMetric ? ' API 参考金额' : ' Token 总量'}的比例 · 点击跳转至 ${s.ym} 月历。`,
        );
        return `<button type="button" class="cal-cum-seg cal-cum-tone-${tone}${isPeak ? ' is-peak' : ''}" style="flex-grow:${Math.max(1, Math.round(share * 10))}" data-cal-nav="jump" data-cal-year="${s.year}" data-cal-month="${s.month}"${calRichTipRawAttrs(`cal-cum-${s.ym}`, segTitle, segBody, segMeta)} aria-label="${esc(tip)}"><span class="cal-cum-seg-label">${share >= 10 ? esc(s.ym) : ''}</span></button>`;
    }).join('');

    return `
        <div class="cal-alltime-section" data-cal-chart="all">
            <div class="cal-cum-header">
                <span class="cal-cum-span-range">${esc(allSorted[0].date)} → ${esc(allSorted[allSorted.length - 1].date)}</span>
                <span class="cal-cum-span-count">${spans.length} ${biHtml('months', '个月')} · ${allSorted.length} ${biHtml('active days', '活跃天')}</span>
            </div>
            <div class="cal-cum-strip" role="group" aria-label="${esc(bi('All-time proportional cumulative activity', '累计总量占比条'))}">
                ${segments}
            </div>
            <div class="cal-peak-callouts">
                <button type="button" class="cal-peak-chip" data-action="calendarJumpDate" data-cal-date="${esc(peakDay.date)}">
                    <span class="cal-peak-chip-k">${biHtml('Peak Day', '单日峰值')}</span>
                    <strong class="cal-peak-chip-v">${esc(peakDay.date)}</strong>
                    <span class="cal-peak-chip-m">${formatTokensCompact(peakDay.totalTokens)}${peakDay.costUsd > 0 ? ` · ${esc(formatCostValue(peakDay.costUsd, currency))}` : ''}</span>
                </button>
                <button type="button" class="cal-peak-chip" data-cal-nav="jump" data-cal-year="${peakSpan.year}" data-cal-month="${peakSpan.month}">
                    <span class="cal-peak-chip-k">${biHtml('Peak Month', '峰值月份')}</span>
                    <strong class="cal-peak-chip-v">${esc(peakSpan.ym)}</strong>
                    <span class="cal-peak-chip-m">${formatTokensCompact(peakSpan.tokens)}${peakSpan.costUsd > 0 ? ` · ${esc(formatCostValue(peakSpan.costUsd, currency))}` : ''}</span>
                </button>
                <div class="cal-peak-chip is-static">
                    <span class="cal-peak-chip-k">${biHtml('Longest Streak', '最长连续活跃')}</span>
                    <strong class="cal-peak-chip-v">${streaks.longestStreak} ${biHtml('days', '天')}</strong>
                    <span class="cal-peak-chip-m">${biHtml('Current', '当前')}: ${streaks.currentStreak}${biHtml('d', '天')}</span>
                </div>
            </div>
        </div>`;
}

function buildRangeSummaryFooter(
    days: readonly AggregatedCalendarDay[],
    spanDays: number,
    todayKey: string,
    currency: CurrencyInput,
    subscription: SubscriptionConfig | null,
    lang: Language,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
): string {
    let totalTokens = 0;
    let totalCostUsd = 0;
    let totalCalls = 0;
    for (const d of days) {
        totalTokens += d.totalTokens;
        totalCostUsd += d.costUsd;
        totalCalls += d.calls;
    }

    const activeDays = days.length;
    const safeSpan = Math.max(1, spanDays);
    const calDailyAvgTok = Math.round(totalTokens / safeSpan);
    const activeDailyAvgTok = activeDays > 0 ? Math.round(totalTokens / activeDays) : 0;
    const calDailyAvgCost = totalCostUsd / safeSpan;
    const activeDailyAvgCost = activeDays > 0 ? totalCostUsd / activeDays : 0;

    const streaks = computeActivityStreaks(days.map(d => d.date), todayKey);
    const { preset } = resolveCurrencyConfig(currency);
    const costDisplay = totalCostUsd > 0
        ? (preset.code === 'USD'
            ? formatCostValue(totalCostUsd, currency)
            : formatDualCurrencyAmount(totalCostUsd, currency))
        : '—';

    const roi = estimateSubscriptionRoi(totalCostUsd, safeSpan, subscription, currency);
    const roiTip = calRichTipAttrs(
        'cal-range-roi',
        'Plan ROI Reference',
        '订阅方案 ROI 参考',
        'API Equivalent Reference Ratio, Not Actual Bill. Compares estimated public API value against prorated subscription fee.',
        'API 等效参考比，非实际账单。将区间用量的等效 API 参考估值与按天折算的订阅月费进行对比。',
        bi,
        `Formula: API reference value ÷ (monthly fee × ${safeSpan}d ÷ 30d).`,
        `计算公式：API 参考估值 ÷（月费 × ${safeSpan} 天 ÷ 30 天）。`,
    );
    const roiHtml = roi ? `
        <details class="cal-roi-advanced" id="calPlanRoiAdvanced" data-cal-roi-advanced="true" data-state-key="cal-plan-roi-advanced">
            <summary class="cal-roi-advanced-summary">
                <span>${biHtml('Advanced', '高级')} · ${tHtml('usage.planRoiTitle', lang)}</span>
                <span class="cal-roi-summary-pill">${roi.roiMultiple !== null ? `${roi.roiMultiple.toFixed(2)}×` : '—'}</span>
            </summary>
            <div class="cal-roi-banner" data-cal-roi="true"${roiTip}>
                <span class="cal-roi-badge">
                    <strong>${esc(bi(roi.planLabelEn, roi.planLabelZh))} ROI:</strong>
                    ${roi.roiMultiple !== null ? `${roi.roiMultiple.toFixed(2)}×` : '—'}
                    (${esc(formatCurrencyAmount(roi.apiReferenceValueUsd, currency))} / ${esc(formatCurrencyAmount(roi.proratedFeeUsd, currency))})
                </span>
                <span class="cal-roi-note" data-roi-disclaimer="true">${biHtml('API Equivalent Reference Ratio, Not Actual Bill', 'API 等效参考比，非实际账单')}</span>
            </div>
        </details>` : '';

    const rangeCostTip = calRichTipAttrs(
        'cal-range-cost',
        'API Reference Cost (Est.)',
        'API 参考费用（估算）',
        'Total estimated cost for this range computed from public per-1M token API list rates (or your custom rates).',
        '当前区间按公开 API 每百万 Token 单价（或自定义单价）累计估算的参考费用。',
        bi,
        'Reference estimate only — matches API Cost metric toggle, not actual subscription billing.',
        '与上方「API 参考金额」同一口径，仅供参考，并非实际订阅扣费。',
    );
    const calAvgTip = calRichTipAttrs(
        'cal-range-cal-avg',
        'Calendar Daily Avg',
        '折合每天（自然日均）',
        `Divides range total by every calendar day in this span (${safeSpan}d), including zero-activity days.`,
        `用区间总量除以该跨度内的全部自然日（${safeSpan} 天），包含无记录的空闲日。`,
        bi,
        `Denominator: ${safeSpan} calendar days (vs Active Day Avg which divides by ${activeDays} active days).`,
        `分母：${safeSpan} 个自然日（与右侧「活跃日均」按 ${activeDays} 个活跃日相除不同）。`,
    );
    const activeAvgTip = calRichTipAttrs(
        'cal-range-active-avg',
        'Active Day Avg',
        '活跃日均',
        `Divides range total only by days with recorded activity (${activeDays}d), matching the X/d figure on the top KPI cards.`,
        `仅用区间总量除以有记录的活跃天数（${activeDays} 天），与顶部 KPI 卡片的「/天」口径一致。`,
        bi,
        `Denominator: ${activeDays} active days (idle days excluded).`,
        `分母：${activeDays} 个活跃天（不含空闲日）。`,
    );
    const streakTip = calRichTipAttrs(
        'cal-range-streak',
        'Activity Streak',
        '连续活跃天数',
        'Number of consecutive calendar days with recorded usage ending today or yesterday.',
        '截至今日或昨日的连续有使用记录的天数。',
        bi,
        `Current: ${streaks.currentStreak}d · Best in range: ${streaks.longestStreak}d.`,
        `当前连续：${streaks.currentStreak} 天 · 区间最长：${streaks.longestStreak} 天。`,
    );

    return `
        <footer class="cal-range-footer" aria-label="${esc(bi('Range summary', '区间统计摘要'))}">
            <div class="cal-range-grid">
                <div class="cal-range-item">
                    <div class="cal-range-label">${biHtml('Range Total', '区间合计')}</div>
                    <div class="cal-range-val">${formatTokensCompact(totalTokens)}</div>
                    <div class="cal-range-sub">${totalCalls} ${biHtml('calls', '调用')}</div>
                </div>
                <div class="cal-range-item"${rangeCostTip}>
                    <div class="cal-range-label">${biHtml('API Cost (Est.)', 'API 参考费用')}</div>
                    <div class="cal-range-val">${esc(costDisplay)}</div>
                    <div class="cal-range-sub">${esc(preset.code)}</div>
                </div>
                <div class="cal-range-item"${calAvgTip}>
                    <div class="cal-range-label">${biHtml('Calendar Daily Avg', '折合每天')}</div>
                    <div class="cal-range-val">${formatTokensCompact(calDailyAvgTok)}</div>
                    <div class="cal-range-sub">${calDailyAvgCost > 0 ? esc(formatCostValue(calDailyAvgCost, currency)) : '—'} · ${safeSpan}${biHtml('d', '天')}</div>
                </div>
                <div class="cal-range-item"${activeAvgTip}>
                    <div class="cal-range-label">${biHtml(`Active Day Avg (${activeDays}d)`, `活跃日均 (${activeDays}天)`)}</div>
                    <div class="cal-range-val">${formatTokensCompact(activeDailyAvgTok)}</div>
                    <div class="cal-range-sub">${activeDailyAvgCost > 0 ? esc(formatCostValue(activeDailyAvgCost, currency)) : '—'}</div>
                </div>
                <div class="cal-range-item"${streakTip}>
                    <div class="cal-range-label">${biHtml('Streak', '连续活跃')}</div>
                    <div class="cal-range-val">${streaks.currentStreak}${biHtml('d', '天')}</div>
                    <div class="cal-range-sub">${biHtml('Best', '最长')}: ${streaks.longestStreak}${biHtml('d', '天')}</div>
                </div>
            </div>
            ${roiHtml}
        </footer>`;
}

// ─── Workspace Project Leaderboard & Swarm Group Cost (Plan C) ──────────────

function safeCalInt(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}
function safeCalNum(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function buildWorkspaceLeaderboardCard(
    leaderboard: WorkspaceLeaderboardResult,
    currency: CurrencyInput,
    lang: Language,
    privacyMasked: boolean,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
): string {
    if (!leaderboard.rows || leaderboard.rows.length === 0) { return ''; }
    const maxTok = Math.max(1, ...leaderboard.rows.map(r => r.totalTokens));
    let attributedIndex = 0;
    const rowsHtml = leaderboard.rows.map((row, idx) => {
        if (!row.isUnattributed) { attributedIndex += 1; }
        const labelHtml = row.isUnattributed
            ? `<span class="cal-ws-name is-unattributed">${tHtml('usage.unattributed', lang)}</span>`
            : `<span class="cal-ws-name">${esc(privacyMasked ? bi(`Project #${attributedIndex}`, `项目 #${attributedIndex}`) : row.displayLabel)}</span>`;
        const barPct = row.totalTokens > 0 ? Math.max(4, Math.round((row.totalTokens / maxTok) * 100)) : 0;
        const costStr = row.knownCostUsd > 0
            ? formatCurrencyAmount(row.knownCostUsd, currency)
            : (row.unpricedCalls > 0 ? '—' : formatCurrencyAmount(0, currency));
        const safeCalls = safeCalInt(row.calls);
        const safeUnpricedCalls = safeCalInt(row.unpricedCalls);
        const unpricedHtml = safeUnpricedCalls > 0
            ? `<span class="cal-ws-unpriced" data-unpriced-calls="${esc(String(safeUnpricedCalls))}">${esc(String(safeUnpricedCalls))} ${tHtml('swarm.unpricedCalls', lang)}</span>`
            : '';
        const wsKeyAttr = privacyMasked && !row.isUnattributed ? `project-${attributedIndex}` : row.workspaceKey;
        const tip = calRichTipAttrs(
            `cal-ws-row-${idx}-${calSlugKey(wsKeyAttr)}`,
            row.isUnattributed ? 'Unattributed Usage' : (privacyMasked ? `Project #${attributedIndex}` : row.displayLabel),
            row.isUnattributed ? '未归属用量' : (privacyMasked ? `项目 #${attributedIndex}` : row.displayLabel),
            row.isUnattributed ? 'Legacy/unattributed records kept explicit.' : `${safeCalls} calls · ${formatTokensCompact(row.totalTokens)} · ${costStr}.`,
            row.isUnattributed ? '未归属记录单独展示，不按比例平摊。' : `${safeCalls} 次调用 · ${formatTokensCompact(row.totalTokens)} · ${costStr}。`,
            bi,
        );
        return `<div class="cal-ws-row${row.isUnattributed ? ' is-unattributed' : ''}" data-workspace-key="${esc(wsKeyAttr)}" data-workspace-unattributed="${row.isUnattributed ? 'true' : 'false'}"${tip}>
            <div class="cal-ws-head">${labelHtml}<span class="cal-ws-metrics"><span>${esc(String(safeCalls))} ${biHtml('calls', '调用')}</span><span>${esc(formatTokensCompact(row.totalTokens))}</span><strong>${esc(costStr)}</strong>${unpricedHtml}</span></div>
            <div class="cal-ws-bar-track"><div class="cal-ws-bar-fill${row.isUnattributed ? ' is-unattributed' : ''}" style="width:${barPct}%"></div></div>
        </div>`;
    }).join('');
    const safeTotalUnpriced = safeCalInt(leaderboard.totals.unpricedCalls);
    const totalUnpricedBadge = safeTotalUnpriced > 0
        ? `<span class="cal-ws-unpriced">${esc(String(safeTotalUnpriced))} ${tHtml('swarm.unpricedCalls', lang)}</span>`
        : '';
    return `<section class="card cal-workspace-card" id="calWorkspaceLeaderboard" data-workspace-leaderboard="true">
        <div class="cal-card-head cal-ws-card-head">
            <h2>${ICON.folder} <span>${tHtml('usage.workspaceLeaderboard', lang)}</span></h2>
            ${totalUnpricedBadge}
        </div>
        <div class="cal-ws-list">${rowsHtml}</div>
    </section>`;
}

function buildSwarmGroupCostCard(
    periodCosts: Record<string, SwarmGroupCostSummary> | undefined,
    sessionCosts: Record<string, SwarmGroupCostSummary> | undefined,
    currency: CurrencyInput,
    lang: Language,
    privacyMasked: boolean,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
    topology: SwarmTopologySnapshot | undefined,
): string {
    const entries = [
        ...Object.values(sessionCosts ?? {}).map(summary => ({ summary, source: 'session' as const })),
        ...Object.values(periodCosts ?? {}).map(summary => ({ summary, source: 'period' as const })),
    ];
    if (entries.length === 0) { return ''; }

    const groupsHtml = entries.map(({ summary, source }, gi) => {
        const rootId = summary.rootId;
        const group = privacyMasked ? undefined : topology?.groupsByRootId.get(rootId);
        const groupAlias = bi(`Group #${gi + 1}`, `智能体组 #${gi + 1}`);
        const displayRoot = group?.title || groupAlias;
        const scopeLabel = source === 'session' ? biHtml('Current group · session history', '当前组 · 会话历史') : biHtml('Selected period · ledger', '所选时段 · 账本');
        const members = Object.values(summary.directCostByMember);
        const withCalls = members.filter(m => m.callCount > 0).length;
        const root = summary.directCostByMember[summary.rootId];
        const workerPriced = members.some(m => m.cascadeId !== summary.rootId && m.pricedCallCount > 0);
        const costText = (amount: number, hasPrice: boolean) => hasPrice
            ? formatCurrencyAmount(amount, currency) : '—';
        const memberRows = members.map((m, mi) => {
            const isRoot = m.cascadeId === summary.rootId;
            const name = privacyMasked ? undefined : topology?.nodesById.get(m.cascadeId)?.memberName;
            const alias = isRoot ? bi('Coordinator', '主智能体') : bi(`Member #${mi + 1}`, `成员 #${mi + 1}`);
            const memberLabel = name || alias;
            const safeMemberCalls = safeCalInt(m.callCount);
            const safeMemberUnpriced = safeCalInt(m.unpricedCallCount);
            const memberUnpriced = safeMemberUnpriced > 0
                ? `<span class="cal-ws-unpriced">${tHtml('swarm.unpricedCalls', lang)}: ${safeMemberUnpriced}</span>`
                : '';
            const amount = m.pricedCallCount > 0 ? safeCalNum(m.directCostUsd) : null;
            return `<div class="cal-swarm-member" data-swarm-member="${esc(memberLabel)}"${amount !== null ? ` data-swarm-direct-cost="${amount}"` : ''}>
                <span class="cal-swarm-member-id">${esc(memberLabel)}</span>
                <span class="cal-swarm-member-vals">${safeMemberCalls ? `<span>${safeMemberCalls} ${biHtml('calls', '次调用')}</span><strong>${esc(costText(m.directCostUsd, amount !== null))}</strong>` : tHtml('swarm.noCalls', lang)}${memberUnpriced}</span>
            </div>`;
        }).join('');
        const safeUniqueCalls = safeCalInt(summary.uniqueCallCount);
        const safeGroupUnpriced = safeCalInt(summary.unpricedCallCount);
        const safeGroupTotal = safeCalNum(summary.inclusiveGroupCostUsd);
        return `<div class="cal-swarm-group" data-swarm-source="${source}" data-swarm-root="${esc(privacyMasked ? groupAlias : rootId)}"${summary.pricedCallCount > 0 ? ` data-swarm-group-total="${safeGroupTotal}"` : ''} data-swarm-unpriced-calls="${safeGroupUnpriced}">
            <div class="cal-swarm-group-head">
                <strong>${scopeLabel} · ${esc(displayRoot)}</strong>
                <span class="cal-swarm-group-total"><strong>${esc(costText(safeGroupTotal, summary.pricedCallCount > 0))}</strong> · ${safeUniqueCalls} ${biHtml('unique calls', '次去重调用')}${safeGroupUnpriced > 0 ? ` · <span class="cal-ws-unpriced">${tHtml('swarm.unpricedCalls', lang)}: ${safeGroupUnpriced}</span>` : ''}</span>
            </div>
            <div class="cal-swarm-split-meta">
                <span>${tHtml('swarm.rootLabel', lang)}: ${esc(costText(summary.coordinatorDirectCostUsd, Boolean(root?.pricedCallCount)))}</span>
                <span>${biHtml('Workers', '子成员')}: ${esc(costText(summary.workersDirectCostUsd, workerPriced))}</span>
            </div>
            ${memberRows ? `<details id="cal-swarm-members-${source}-${gi + 1}"><summary>${tHtml('swarm.costCoverage', lang)} ${withCalls}/${members.length}</summary><div class="cal-swarm-members">${memberRows}</div></details>` : ''}
        </div>`;
    }).join('');

    return `<section class="card cal-swarm-cost-card" id="calSwarmGroupCost" data-swarm-group-cost="true">
        <div class="cal-card-head">
            <h2>${ICON.bolt} <span>${tHtml('swarm.groupCost', lang)}</span></h2>
        </div>
        <p class="cal-swarm-note">${biHtml('API reference cost of recorded calls. Members without call records are excluded.', '按已记录调用估算 API 费用，未计入缺少调用记录的成员。')}</p>
        <div class="cal-swarm-groups">${groupsHtml}</div>
        ${periodCosts && Object.keys(periodCosts).length ? `<p class="cal-swarm-note">${biHtml('Ledger totals use the calls retained for this period. Older records can combine several calls from the same execution and understate costs.', '账本仅统计所选时段留存的调用。旧记录可能合并同一轮执行中的多次调用，使估算偏低。')}</p>` : ''}
    </section>`;
}

// ─── Day Detail Drawer (with Token Breakdown, Model Proportion Bars & Cycles) ─

function formatSurfaceBadgeHtml(surface: UsageSurface, biHtml: (en: string, zh: string) => string): string {
    switch (surface) {
        case 'app':
            return `<span class="cal-source-badge cal-source-app">App</span>`;
        case 'ide':
            return `<span class="cal-source-badge cal-source-ide">IDE</span>`;
        case 'cli':
            return `<span class="cal-source-badge cal-source-cli">CLI</span>`;
        case 'unknown':
        default:
            return `<span class="cal-source-badge cal-source-unknown">${biHtml('Unlabeled', '未区分来源')}</span>`;
    }
}

function buildDayDetail(
    day: AggregatedCalendarDay,
    dateStr: string,
    todayKey: string,
    currency: CurrencyInput,
    metricMode: CalendarMetricMode,
    isOpen: boolean,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
    privacyMasked = false,
): string {
    const todayBadge = dateStr === todayKey
        ? `<span class="badge info-badge cal-today-badge"><span>${biHtml('Today', '今天')}</span></span>`
        : '';
    const liveBadge = day.isLive
        ? `<span class="cal-live-badge">${biHtml('Live', '实时')}</span>`
        : '';
    const sourceBadges = day.sources.map(s => formatSurfaceBadgeHtml(s, biHtml)).join('');

    const { preset } = resolveCurrencyConfig(currency);
    const dayCostStr = day.costUsd > 0
        ? (preset.code === 'USD'
            ? formatCostValue(day.costUsd, currency)
            : formatDualCurrencyAmount(day.costUsd, currency))
        : '';

    // Token breakdown bar & pills (input / cacheRead / cacheCreation / output + thinking sub-note)
    const tokBreakdownHtml = day.totalTokens > 0 ? (() => {
        const denom = Math.max(1, day.totalTokens);
        const inPct = Math.round((day.inputTokens / denom) * 100);
        const crPct = Math.round((day.cacheReadTokens / denom) * 100);
        const cwPct = Math.round((day.cacheCreationTokens / denom) * 100);
        const outPct = Math.max(0, 100 - inPct - crPct - cwPct);
        const thinkNote = day.thinkingTokens > 0
            ? ` (${biHtml('Thinking', '思考')}: ${formatTokensCompact(day.thinkingTokens)})`
            : '';
        const tokBreakdownTip = calRichTipAttrs(
            `cal-day-tokbreakdown-${dateStr}`,
            'Additive Token Breakdown',
            'Token 累加构成',
            'Total tokens = Fresh Input + Cache Read + Cache Write + Output.',
            '总 Token = 新输入 + 缓存读取 + 缓存写入 + 输出。',
            bi,
            'Thinking tokens are a subset already included inside Output (shown in parentheses, never double-counted).',
            '括号中的「思考」Token 属于「输出」的子集，不会重复计入总量。',
        );
        return `
            <div class="cal-token-breakdown" role="group" aria-label="${esc(bi('Token breakdown', 'Token 构成'))}"${tokBreakdownTip}>
                <div class="cal-tok-bar" aria-hidden="true">
                    ${day.inputTokens > 0 ? `<span class="cal-tok-seg is-input" style="width:${Math.max(1, inPct)}%"></span>` : ''}
                    ${day.cacheReadTokens > 0 ? `<span class="cal-tok-seg is-cache" style="width:${Math.max(1, crPct)}%"></span>` : ''}
                    ${day.cacheCreationTokens > 0 ? `<span class="cal-tok-seg is-cwrite" style="width:${Math.max(1, cwPct)}%"></span>` : ''}
                    ${day.outputTokens > 0 ? `<span class="cal-tok-seg is-output" style="width:${Math.max(1, outPct)}%"></span>` : ''}
                </div>
                <div class="cal-tok-legend">
                    <span class="cal-tok-item"><span class="cal-tok-dot is-input" aria-hidden="true"></span>${biHtml('Input', '新输入')}: <strong>${formatTokensCompact(day.inputTokens)}</strong></span>
                    <span class="cal-tok-item"><span class="cal-tok-dot is-cache" aria-hidden="true"></span>${biHtml('Cache Read', '缓存读取')}: <strong>${formatTokensCompact(day.cacheReadTokens)}</strong></span>
                    ${day.cacheCreationTokens > 0 ? `<span class="cal-tok-item"><span class="cal-tok-dot is-cwrite" aria-hidden="true"></span>${biHtml('Cache Write', '缓存写入')}: <strong>${formatTokensCompact(day.cacheCreationTokens)}</strong></span>` : ''}
                    <span class="cal-tok-item"><span class="cal-tok-dot is-output" aria-hidden="true"></span>${biHtml('Output', '输出')}: <strong>${formatTokensCompact(day.outputTokens)}</strong>${thinkNote}</span>
                </div>
            </div>`;
    })() : '';

    const mergedGMHtml = buildMergedGMRows(day.models, dateStr, currency, metricMode, bi, biHtml);
    const cyclesHtml = buildCyclesDetailsHtml(day.cycles, dateStr, currency, bi, biHtml, privacyMasked);
    const dayGmCallsTip = calRichTipAttrs(
        `cal-day-gmcalls-${dateStr}`,
        'GM Calls (Generator Metadata)',
        'GM 调用次数',
        'Total model generation calls recorded in runtime Generator Metadata on this date.',
        '当日在模型调用遥测（Generator Metadata）中记录的总调用次数。',
        bi,
        'Includes calls across all cycles and sources matching your active filter.',
        '涵盖当前筛选来源下当日全部周期的模型调用。',
    );
    const dayCostTip = calRichTipAttrs(
        `cal-day-cost-${dateStr}`,
        'API Reference Cost',
        'API 参考费用',
        'Estimated public API cost for this date based on per-1M token list rates (or your custom rates).',
        '按公开 API 单价（或自定义单价）估算的当日参考费用。',
        bi,
        'Reference estimate only — not your actual subscription charge.',
        '仅为等效 API 参考估值，并非实际订阅扣费。',
    );
    const dayCreditsTip = calRichTipAttrs(
        `cal-day-credits-${dateStr}`,
        'GM Call Credits',
        'GM 调用积分',
        'Per-call credit units reported in Generator Metadata for this date.',
        '当日模型调用遥测（Generator Metadata）中上报的单次调用积分累计值。',
        bi,
        'Separate from your Account AI Credits balance shown in the Profile tab.',
        '与「账号」页中展示的账号 AI 积分余额属于不同统计口径。',
    );

    const safeDateAttr = esc(dateStr);
    const safeDayCalls = safeCalInt(day.calls);
    const safeDayCredits = safeCalNum(day.credits);
    return `
        <div class="cal-detail${isOpen ? ' cal-detail-open' : ''}" id="cal-detail-${safeDateAttr}" style="display:${isOpen ? 'block' : 'none'}" data-cal-detail="${safeDateAttr}">
            <div class="cal-detail-header">
                <span class="cal-detail-date">
                    ${CALENDAR_ICON} <span>${safeDateAttr}</span> ${todayBadge} ${liveBadge}
                </span>
                <span class="cal-detail-sources">${sourceBadges}</span>
            </div>
            <div class="cal-day-summary">
                ${safeDayCalls > 0 ? `
                <div class="cal-day-total"${dayGmCallsTip}>
                    <div class="cal-day-total-val">${esc(String(safeDayCalls))}</div>
                    <div class="cal-day-total-label">${biHtml('GM Calls', 'GM 调用')}</div>
                </div>` : ''}
                ${day.totalTokens > 0 ? `
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${esc(formatTokensCompact(day.totalTokens))}</div>
                    <div class="cal-day-total-label">${biHtml('Tokens', 'Tokens')}</div>
                </div>` : ''}
                ${dayCostStr ? `
                <div class="cal-day-total"${dayCostTip}>
                    <div class="cal-day-total-val">${esc(dayCostStr)}</div>
                    <div class="cal-day-total-label">${biHtml('API Cost', 'API 费用')}</div>
                </div>` : ''}
                ${safeDayCredits > 0 ? `
                <div class="cal-day-total"${dayCreditsTip}>
                    <div class="cal-day-total-val">${esc(String(safeDayCredits))}</div>
                    <div class="cal-day-total-label">${biHtml('Credits', '积分')}</div>
                </div>` : ''}
                ${day.cacheHitRate !== undefined && day.cacheHitRate > 0 ? `
                <div class="cal-day-total">
                    <div class="cal-day-total-val">${esc(formatCachePercent(day.cacheHitRate))}</div>
                    <div class="cal-day-total-label">${biHtml('Cache Hit', '缓存命中')}</div>
                </div>` : ''}
            </div>
            ${tokBreakdownHtml}
            ${mergedGMHtml}
            ${cyclesHtml}
        </div>`;
}

/** Merged per-model GM rows across all cycles (with proportion bars & additive tokens) */
function buildMergedGMRows(
    merged: Record<string, MergedCalendarGMModel>,
    dateStr: string,
    currency: CurrencyInput,
    metricMode: CalendarMetricMode,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
): string {
    const entries = Object.entries(merged).sort((a, b) => {
        if (metricMode === 'cost' && b[1].cost !== a[1].cost) {
            return b[1].cost - a[1].cost;
        }
        return b[1].totalTokens - a[1].totalTokens || b[1].calls - a[1].calls;
    });
    if (entries.length === 0) { return ''; }

    const totalShareDenom = entries.reduce((sum, [, ms]) => sum + (metricMode === 'cost' && ms.cost > 0 ? ms.cost : ms.totalTokens), 0);
    const gmSummaryTip = calRichTipAttrs(
        `cal-gm-summary-label-${dateStr}`,
        'GM Summary (Per-Model Telemetry)',
        'GM 汇总（按模型遥测）',
        'Aggregates Generator Metadata calls, speed, TTFT, prompt cache hit rate, reference cost, and tokens per model across all cycles on this date.',
        '汇总当日所有周期中各模型的调用次数、速度、首字延迟、缓存命中率、参考费用与 Token 明细。',
        bi,
        'Hover or click any metric chip below to inspect its exact formula.',
        '悬停或点击下方任意指标标签即可查看计算口径。',
    );

    let html = '<div class="cal-model-rows">';
    html += `<div class="cal-gm-section-label"${gmSummaryTip}>${biHtml('GM Summary', 'GM 汇总')}</div>`;
    for (let idx = 0; idx < entries.length; idx++) {
        const [name, ms] = entries[idx];
        const rowKey = `${dateStr}-${idx}`;
        const chips: string[] = [];
        const safeMsCalls = safeCalInt(ms.calls);
        const safeMsCredits = safeCalNum(ms.credits);
        if (safeMsCalls > 0) {
            const callsTip = calRichTipAttrs(
                `cal-gm-calls-${rowKey}`,
                'Model GM Calls',
                '模型 GM 调用次数',
                `${name} completed ${safeMsCalls} recorded model calls on ${dateStr}.`,
                `${name} 在 ${dateStr} 共记录了 ${safeMsCalls} 次模型调用。`,
                bi,
            );
            chips.push(`<span class="cal-chip cal-chip-tools"${callsTip}>${CAL_ICON.calls} <span>${esc(String(safeMsCalls))} ${biHtml('calls', '调用')}</span></span>`);
        }
        if (safeMsCredits > 0) {
            const creditsTip = calRichTipAttrs(
                `cal-gm-credits-${rowKey}`,
                'GM Call Credits',
                'GM 调用积分',
                `${safeMsCredits} call credits reported in Generator Metadata for ${name} on ${dateStr}.`,
                `${name} 在 ${dateStr} 上报了 ${safeMsCredits} 点 GM 调用积分。`,
                bi,
                'Per-call telemetry credit units — separate from your Account AI Credits balance.',
                '单次调用遥测积分单位，与「账号」页的账号 AI 积分余额相互独立。',
            );
            chips.push(`<span class="cal-chip cal-chip-credits cal-chip-tokens" aria-label="${esc(`${safeMsCredits} ${bi('GM call credits', 'GM 调用积分')}`)}"${creditsTip}>${CAL_ICON.credit} <span>${esc(String(safeMsCredits))} ${biHtml('credits', '积分')}</span></span>`);
        }
        const avgSpeed = ms.speedTimeSum > 0
            ? ms.speedOutputSum / ms.speedTimeSum
            : (ms.speedFallbackWeight > 0 ? ms.speedFallbackSum / ms.speedFallbackWeight : 0);
        if (avgSpeed > 0) {
            const speedTip = calRichTipAttrs(
                `cal-gm-speed-${rowKey}`,
                'Avg Generation Speed',
                '平均生成速度',
                `Weighted average token output rate (${formatSpeed(avgSpeed)}) for ${name}.`,
                `${name} 的加权平均 Token 生成速度（${formatSpeed(avgSpeed)}）。`,
                bi,
                'Formula: total output tokens ÷ total streaming duration across timed calls.',
                '计算口径：计时调用的总输出 Token ÷ 总流式耗时。',
            );
            chips.push(`<span class="cal-chip cal-chip-speed" aria-label="${esc(`${bi('Avg generation speed', '平均生成速度')}: ${formatSpeed(avgSpeed)}`)}"${speedTip}>${CAL_ICON.speed} <span>${esc(formatSpeed(avgSpeed))}</span></span>`);
        }
        const avgTTFT = ms.ttftWeight > 0 ? ms.ttftSum / ms.ttftWeight : 0;
        if (avgTTFT > 0) {
            const ttftTip = calRichTipAttrs(
                `cal-gm-ttft-${rowKey}`,
                'Avg TTFT (Time to First Token)',
                '平均首字延迟 (TTFT)',
                `Average wait time (${formatLatency(avgTTFT)}) from sending a request until the first token begins streaming.`,
                `从发起请求到模型返回第一个输出 Token 的平均等待时长（${formatLatency(avgTTFT)}）。`,
                bi,
                'Weighted by call count across timed calls.',
                '按计时调用次数加权平均。',
            );
            chips.push(`<span class="cal-chip cal-chip-ttft" aria-label="${esc(`${bi('Avg TTFT', '平均首字延迟')}: ${formatLatency(avgTTFT)}`)}"${ttftTip}>${CAL_ICON.clock} <span>${esc(formatLatency(avgTTFT))}</span></span>`);
        }
        const hasTokenCache = ms.tokenCacheWeight > 0;
        const avgCache = hasTokenCache
            ? ms.tokenCacheSum / ms.tokenCacheWeight
            : (ms.legacyCacheWeight > 0 ? ms.legacyCacheSum / ms.legacyCacheWeight : 0);
        if (avgCache > 0) {
            const cacheTip = calRichTipAttrs(
                `cal-gm-cache-${rowKey}`,
                'Prompt Cache Hit Rate',
                '提示词缓存命中率',
                hasTokenCache
                    ? `Share of prompt tokens (${formatCachePercent(avgCache)}) reused from cache — reduces latency and API reference cost.`
                    : `Share of model calls (${formatCachePercent(avgCache)}) that hit prompt cache.`,
                hasTokenCache
                    ? `从提示词缓存直接复用的输入 Token 占比（${formatCachePercent(avgCache)}），可显著降低首字延迟与参考费用。`
                    : `命中提示词缓存的调用占比（${formatCachePercent(avgCache)}）。`,
                bi,
                hasTokenCache
                    ? 'Method: token-weighted — Cache Read ÷ (Fresh Input + Cache Read + Cache Write).'
                    : 'Method: legacy call-ratio fallback (token-level cache reads unavailable in older records).',
                hasTokenCache
                    ? '计算口径：按 Token 加权 — 缓存读取 ÷（新输入 + 缓存读取 + 缓存写入）。'
                    : '计算口径：旧版按调用占比回退（历史记录缺少 Token 级缓存读取字段）。',
            );
            chips.push(`<span class="cal-chip cal-chip-cache" aria-label="${esc(`${bi('Prompt cache hit rate', '提示词缓存命中率')}: ${formatCachePercent(avgCache)}`)}"${cacheTip}>${CAL_ICON.cache} <span>${esc(formatCachePercent(avgCache))}</span></span>`);
        }
        const costChip = formatCostChipValue(ms.cost, currency);
        if (costChip) {
            const costChipTip = calRichTipAttrs(
                `cal-gm-cost-${rowKey}`,
                'API Reference Cost',
                'API 参考费用',
                `Estimated API cost (${costChip}) for ${name} on ${dateStr}.`,
                `${name} 在 ${dateStr} 按 API 标价估算的参考费用（${costChip}）。`,
                bi,
                'Reference estimate based on public per-1M rates — not actual subscription billing.',
                '基于公开每百万 Token 标价估算，并非实际订阅账单。',
            );
            chips.push(`<span class="cal-chip cal-chip-cost"${costChipTip}>${CAL_ICON.dollar} <span>${esc(costChip)}</span></span>`);
        }
        if (ms.totalTokens > 0) {
            const breakdownTip = `${bi('Input', '新输入')} ${formatTokensCompact(ms.inputTokens)} + ${bi('Cache', '缓存')} ${formatTokensCompact(ms.cacheReadTokens + ms.cacheCreationTokens)} + ${bi('Output', '输出')} ${formatTokensCompact(ms.outputTokens)}${ms.thinkingTokens > 0 ? ` (${bi('Thinking', '思考')} ${formatTokensCompact(ms.thinkingTokens)})` : ''}`;
            const tokensTip = calRichTipRawAttrs(
                `cal-gm-tokens-${rowKey}`,
                bi('Additive Token Breakdown', 'Token 累加构成'),
                breakdownTip,
                bi(
                    'Total = Fresh Input + Cache Read + Cache Write + Output (Thinking is inside Output, never double-counted).',
                    '总计 = 新输入 + 缓存读取 + 缓存写入 + 输出（思考已包含在输出中，不重复相加）。',
                ),
            );
            chips.push(`<span class="cal-chip cal-chip-tokens"${tokensTip}><span>${formatTokensCompact(ms.totalTokens)} ${biHtml('tokens', 'tokens')}</span></span>`);
        }

        const shareVal = metricMode === 'cost' && ms.cost > 0 ? ms.cost : ms.totalTokens;
        const sharePct = totalShareDenom > 0 ? Math.min(100, Math.round((shareVal / totalShareDenom) * 100)) : 0;
        // NOTE: Keep all inner elements as <span> inside `.cal-model-row` so row parsing remains cleanly bounded by a single closing </div>.
        const barSpan = sharePct > 0
            ? `<span class="cal-model-bar" aria-hidden="true"><span class="cal-model-bar-fill" style="width:${Math.max(2, sharePct)}%"></span></span>`
            : '';
        const modelNameTip = calRichTipRawAttrs(
            `cal-gm-model-${rowKey}`,
            name,
            bi(
                `${sharePct}% share of ${dateStr}'s ${metricMode === 'cost' ? 'API reference cost' : 'total tokens'}.`,
                `占 ${dateStr} 当日${metricMode === 'cost' ? ' API 参考费用' : '总 Token'}的 ${sharePct}%。`,
            ),
            `${ms.calls} ${bi('calls', '调用')} · ${formatTokensCompact(ms.totalTokens)} ${bi('tokens', 'tokens')}`,
        );

        html += `<div class="cal-model-row"><span class="cal-model-name"${modelNameTip}>${esc(name)}${sharePct > 0 ? ` <span class="cal-model-share">${sharePct}%</span>` : ''}</span><span class="cal-model-chips">${chips.join('')}</span>${barSpan}</div>`;
    }
    html += '</div>';
    return html;
}

/** Revived collapsible cycle history list inside each day detail drawer. */
function buildCyclesDetailsHtml(
    cycles: readonly DailyCycleEntry[],
    dateStr: string,
    currency: CurrencyInput,
    bi: (en: string, zh: string) => string,
    biHtml: (en: string, zh: string) => string,
    privacyMasked = false,
): string {
    if (cycles.length === 0) { return ''; }

    const items = cycles.map((c, idx) => {
        const tok = computeCycleTokenTotals(c);
        const startT = c.startTime ? formatShortTime(c.startTime) : '00:00:00';
        const endT = c.isLive ? bi('Live', '实时') : (c.endTime ? formatShortTime(c.endTime) : '23:59:59');
        const surfaces = getCycleSurfaces(c).map(s => formatSurfaceBadgeHtml(s, biHtml)).join('');
        const costStr = safeCost(c.estimatedCost) > 0 ? formatCostValue(safeCost(c.estimatedCost), currency) : '';
        const acctTag = c.accountEmail && !privacyMasked ? `<span class="cal-account-tag">${esc(c.accountEmail)}</span>` : '';
        const safeCycleCalls = safeCalInt(c.gmTotalCalls);
        const safeCycleCredits = safeCalNum(c.gmTotalCredits);
        const safeCycleRetries = safeCalInt(c.gmRetryCount);
        const retryTag = safeCycleRetries > 0
            ? `<span class="cal-chip cal-chip-errors">${esc(String(safeCycleRetries))} ${biHtml('retries', '重试')}</span>`
            : '';
        const triggerList = c.triggeredBy && c.triggeredBy.length > 0 ? c.triggeredBy.slice(0, 2).join(', ') : '';
        const triggerTip = triggerList ? calRichTipAttrs(
            `cal-cycle-reset-${dateStr}-${idx}`,
            'Cycle Settlement Trigger',
            '周期结算触发原因',
            `This archival segment closed when a quota reset occurred for: ${triggerList}.`,
            `当 ${triggerList} 触发配额重置时，该段历史用量自动封存为一个周期记录。`,
            bi,
            'Cycles split a day cleanly across quota resets or midnight rollovers without double-counting.',
            '按配额重置或午夜跨天切分周期，确保全天汇总不重复统计。',
        ) : '';
        const triggerTag = triggerList
            ? `<span class="cal-chip"${triggerTip}>${biHtml('Reset', '重置')}: ${esc(triggerList)}</span>`
            : '';

        return `
            <div class="cal-cycle-item">
                <div class="cal-cycle-meta">
                    <span class="cal-cycle-idx">#${idx + 1}</span>
                    <span class="cal-cycle-time">${esc(startT)} – ${esc(endT)}</span>
                    ${surfaces}
                    ${acctTag}
                </div>
                <div class="cal-cycle-stats">
                    ${safeCycleCalls > 0 ? `<span class="cal-chip cal-chip-tools">${esc(String(safeCycleCalls))} ${biHtml('calls', '调用')}</span>` : ''}
                    ${tok.totalTokens > 0 ? `<span class="cal-chip cal-chip-tokens">${esc(formatTokensCompact(tok.totalTokens))} ${biHtml('tokens', 'tokens')}</span>` : ''}
                    ${costStr ? `<span class="cal-chip cal-chip-cost">${esc(costStr)}</span>` : ''}
                    ${safeCycleCredits > 0 ? `<span class="cal-chip">${esc(String(safeCycleCredits))} ${biHtml('credits', '积分')}</span>` : ''}
                    ${retryTag}
                    ${triggerTag}
                </div>
            </div>`;
    }).join('');

    const cyclesSummaryTip = calRichTipAttrs(
        `cal-cycles-summary-${dateStr}`,
        'Cycle History',
        '周期记录',
        'Each cycle is an archival segment bounded by a quota pool reset or midnight rollover (plus today\'s live segment if active).',
        '每条周期记录对应一次配额池重置或午夜跨天结算前的归档区间（当日进行中的会话显示为实时段）。',
        bi,
        `${cycles.length} segment(s) recorded on ${dateStr}.`,
        `${dateStr} 共记录 ${cycles.length} 个周期段。`,
    );

    const safeDateAttr = esc(dateStr);
    return `
        <details class="cal-cycles-details" id="cal-cycles-${safeDateAttr}" data-state-key="cal-cycles-${safeDateAttr}">
            <summary class="cal-cycles-summary"${cyclesSummaryTip}>
                <span>${biHtml('Cycle History', '周期记录')} (${cycles.length})</span>
            </summary>
            <div class="cal-cycles-list">${items}</div>
        </details>`;
}

// ─── Calendar Styles (Studio Telemetry Ledger, WCAG 2.1 AA) ──────────────────

/** Return calendar-specific CSS strictly using --ed-* Studio Telemetry Ledger tokens. */
export function getCalendarTabStyles(): string {
    return `
        /* ─── Calendar & Activity Heatmap (Studio Telemetry Ledger) ─────── */
        body {
            --cal-hm-0: var(--ed-surface-well);
            --cal-hm-1: rgba(91, 156, 246, 0.24);
            --cal-hm-2: rgba(91, 156, 246, 0.46);
            --cal-hm-3: rgba(91, 156, 246, 0.72);
            --cal-hm-4: var(--ed-accent);
            --cal-hm-cost-1: rgba(52, 211, 153, 0.22);
            --cal-hm-cost-2: rgba(52, 211, 153, 0.44);
            --cal-hm-cost-3: rgba(52, 211, 153, 0.70);
            --cal-hm-cost-4: var(--ed-good-fill);
        }

        body:is(.vscode-light, [data-vscode-theme-kind="vscode-light"], [data-acm-theme="light"]) {
            --cal-hm-0: var(--ed-surface-well);
            --cal-hm-1: rgba(29, 78, 216, 0.16);
            --cal-hm-2: rgba(29, 78, 216, 0.36);
            --cal-hm-3: rgba(29, 78, 216, 0.62);
            --cal-hm-4: var(--ed-accent);
            --cal-hm-cost-1: rgba(14, 116, 72, 0.16);
            --cal-hm-cost-2: rgba(14, 116, 72, 0.36);
            --cal-hm-cost-3: rgba(14, 116, 72, 0.62);
            --cal-hm-cost-4: var(--ed-good-fill);
        }

        /* ── Dashboard Controls & Export Header ─── */
        .cal-dashboard-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px 12px;
            margin-bottom: 12px;
        }

        .cal-dashboard-title-row {
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            min-width: 0;
        }

        .cal-dashboard-title-row h2,
        .cal-card-head h2 {
            margin: 0;
            min-width: 0;
        }

        .cal-card-head {
            margin-bottom: 12px;
        }

        .cal-live-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 2px 9px;
            border-radius: var(--ed-radius-pill);
            font-size: 11px;
            font-weight: 600;
            background: var(--ed-good-tint);
            color: var(--ed-good);
            border: 1px solid var(--ed-good-border);
        }

        .cal-live-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--ed-good);
            flex-shrink: 0;
        }

        .cal-export-actions {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            flex-shrink: 0;
        }

        .cal-export-btn {
            appearance: none;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            height: 26px;
            padding: 0 9px;
            border-radius: var(--ed-radius-sm);
            border: 1px solid var(--ed-control-border);
            background: var(--ed-surface);
            color: var(--ed-ink);
            font: inherit;
            font-size: 11.5px;
            font-weight: 550;
            cursor: pointer;
            transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease);
        }

        .cal-export-btn:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        @media (hover: hover) {
            .cal-export-btn:hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-accent-border);
            }
        }

        .cal-controls-bar {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px 10px;
            margin-bottom: 12px;
        }

        .cal-control-group {
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 2px;
            padding: 2px;
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            max-width: 100%;
        }

        .cal-pill-btn {
            appearance: none;
            background: transparent;
            color: var(--ed-ink-muted);
            border: 1px solid transparent;
            border-radius: var(--ed-radius-xs);
            padding: 4px 9px;
            font: inherit;
            font-size: 11.5px;
            font-weight: 500;
            cursor: pointer;
            line-height: 1.3;
            transition: background var(--ed-dur-fast) var(--ed-ease),
                color var(--ed-dur-fast) var(--ed-ease),
                border-color var(--ed-dur-fast) var(--ed-ease);
        }

        .cal-pill-btn.is-active {
            background: var(--ed-surface);
            color: var(--ed-ink);
            font-weight: 600;
            border-color: var(--ed-border-strong);
            box-shadow: var(--ed-shadow-segment);
        }

        .cal-pill-btn:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        @media (hover: hover) {
            .cal-pill-btn:not(.is-active):hover {
                background: var(--ed-surface-hover);
                color: var(--ed-ink);
            }
        }

        .cal-source-note {
            margin: 0 0 10px;
            font-size: 11.5px;
            color: var(--ed-ink-muted);
        }

        /* ── 4-Card KPI Header ─── */
        .cal-kpi-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 155px), 1fr));
            gap: 10px;
        }

        .cal-kpi-card {
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            padding: 11px 12px;
            min-width: 0;
        }

        .cal-kpi-card.is-live {
            border-color: var(--ed-good-border);
        }

        .cal-kpi-label {
            font-size: 11.5px;
            font-weight: 550;
            color: var(--ed-ink-secondary);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
        }

        .cal-kpi-live-tag {
            font-size: 10.5px;
            font-weight: 600;
            padding: 1px 6px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-good-tint);
            color: var(--ed-good);
            border: 1px solid var(--ed-good-border);
        }

        .cal-kpi-val {
            font-size: 1.28rem;
            font-weight: 650;
            line-height: 1.2;
            color: var(--ed-ink);
            margin-top: 5px;
            overflow-wrap: anywhere;
        }

        .cal-kpi-sub {
            font-size: 12px;
            font-weight: 550;
            color: var(--ed-ink-secondary);
            margin-top: 2px;
        }

        .cal-kpi-meta {
            font-size: 11px;
            color: var(--ed-ink-muted);
            margin-top: 4px;
            overflow-wrap: anywhere;
        }

        /* ── Overview Grid Helpers ─── */
        .cal-overview-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 96px), 1fr));
            gap: 1px;
            background: var(--ed-border);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            overflow: hidden;
        }

        .cal-overview-val {
            font-weight: 650;
            font-size: 1.08em;
            line-height: 1.25;
            color: var(--ed-ink);
        }

        /* ── 52-Week 5-Level Intensity Heatmap ─── */
        .cal-heatmap-section {
            margin-bottom: 16px;
        }

        .cal-heatmap-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 6px 12px;
            margin-bottom: 8px;
        }

        .cal-heatmap-caption {
            font-size: 12px;
            font-weight: 600;
            color: var(--ed-ink-secondary);
        }

        .cal-hm-legend {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            color: var(--ed-ink-muted);
        }

        .cal-hm-swatch {
            display: inline-block;
            width: 11px;
            height: 11px;
            border-radius: 2px;
            border: 1px solid var(--ed-border);
        }

        .cal-heatmap-scroll {
            overflow-x: auto;
            overflow-y: hidden;
            padding: 8px 6px 10px;
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            max-width: 100%;
        }

        .cal-heatmap-scroll:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        .cal-heatmap-inner {
            display: inline-block;
            min-width: max-content;
        }

        .cal-hm-months {
            display: grid;
            grid-template-columns: repeat(var(--cal-hm-weeks, 52), 13px);
            gap: 3px;
            padding-inline-start: 28px;
            margin-bottom: 4px;
            height: 14px;
            align-items: end;
        }

        .cal-hm-month-label {
            font-size: 10px;
            color: var(--ed-ink-muted);
            white-space: nowrap;
            line-height: 1;
        }

        .cal-hm-body {
            display: flex;
            align-items: flex-start;
            gap: 4px;
        }

        .cal-hm-days {
            display: grid;
            grid-template-rows: repeat(7, 13px);
            gap: 3px;
            width: 24px;
            flex-shrink: 0;
        }

        .cal-hm-day-label {
            font-size: 10px;
            color: var(--ed-ink-muted);
            line-height: 13px;
            text-align: end;
        }

        .cal-hm-grid {
            display: flex;
            gap: 3px;
        }

        .cal-hm-col {
            display: grid;
            grid-template-rows: repeat(7, 13px);
            gap: 3px;
        }

        .cal-hm-cell {
            appearance: none;
            display: block;
            width: 13px;
            height: 13px;
            padding: 0;
            border-radius: 2.5px;
            border: 1px solid var(--ed-border);
            background: var(--cal-hm-0);
            cursor: default;
            transition: transform 90ms var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease);
        }

        .cal-hm-cell.is-future { opacity: 0.35; }
        .cal-hm-cell.has-data { cursor: pointer; }
        .cal-hm-cell.is-today { border-color: var(--ed-ink); }
        .cal-hm-cell.selected {
            outline: 2px solid var(--ed-accent);
            outline-offset: 1px;
        }

        .cal-hm-cell.has-data:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 1px;
        }

        @media (hover: hover) {
            .cal-hm-cell.has-data:hover {
                transform: scale(1.18);
                border-color: var(--ed-ink);
            }
        }

        .cal-lvl-0 { background: var(--cal-hm-0); }
        .cal-lvl-1 { background: var(--cal-hm-1); border-color: transparent; }
        .cal-lvl-2 { background: var(--cal-hm-2); border-color: transparent; }
        .cal-lvl-3 { background: var(--cal-hm-3); border-color: transparent; }
        .cal-lvl-4 { background: var(--cal-hm-4); border-color: transparent; }

        .cal-lvl-1.is-cost { background: var(--cal-hm-cost-1); }
        .cal-lvl-2.is-cost { background: var(--cal-hm-cost-2); }
        .cal-lvl-3.is-cost { background: var(--cal-hm-cost-3); }
        .cal-lvl-4.is-cost { background: var(--cal-hm-cost-4); }

        /* ── Period Charts (Weekly / Monthly / Year) ─── */
        .cal-peak-banner {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px 10px;
            padding: 8px 12px;
            margin-bottom: 10px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-accent-tint);
            border: 1px solid var(--ed-accent-border);
            font-size: 12px;
            color: var(--ed-ink);
        }

        .cal-peak-label { color: var(--ed-ink-secondary); }
        .cal-peak-meta { color: var(--ed-ink-secondary); }

        .cal-bar-chart {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 14px;
        }

        .cal-bar-row {
            appearance: none;
            width: 100%;
            display: grid;
            grid-template-columns: minmax(76px, 118px) minmax(0, 1fr) minmax(88px, 136px);
            align-items: center;
            gap: 10px;
            padding: 6px 8px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            color: var(--ed-ink);
            font: inherit;
            text-align: start;
        }

        .cal-bar-row.is-interactive { cursor: pointer; }
        .cal-bar-row.is-peak { border-color: var(--ed-accent-border); }

        .cal-bar-row.is-interactive:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        @media (hover: hover) {
            .cal-bar-row.is-interactive:hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-accent-border);
            }
        }

        .cal-bar-label {
            display: flex;
            flex-direction: column;
            min-width: 0;
        }

        .cal-bar-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--ed-ink);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .cal-bar-sub {
            font-size: 10.5px;
            color: var(--ed-ink-muted);
        }

        .cal-bar-track {
            display: block;
            height: 8px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-track);
            overflow: hidden;
        }

        .cal-bar-fill {
            display: block;
            height: 100%;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-accent);
        }

        .cal-bar-fill.is-cost { background: var(--ed-good-fill); }

        .cal-bar-val {
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            min-width: 0;
        }

        .cal-bar-primary { font-size: 12px; font-weight: 650; color: var(--ed-ink); }
        .cal-bar-secondary { font-size: 10.5px; color: var(--ed-ink-muted); }

        /* ── All-Time Proportional Cumulative Strip ─── */
        .cal-alltime-section { margin-bottom: 14px; }

        .cal-cum-header {
            display: flex;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 6px;
            font-size: 12px;
            color: var(--ed-ink-secondary);
            margin-bottom: 8px;
        }

        .cal-cum-strip {
            display: flex;
            width: 100%;
            height: 28px;
            gap: 2px;
            padding: 2px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            overflow: hidden;
            margin-bottom: 10px;
        }

        .cal-cum-seg {
            appearance: none;
            border: 1px solid transparent;
            border-radius: 3px;
            padding: 0 4px;
            min-width: 6px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            color: var(--ed-accent-ink);
            font: inherit;
            font-size: 10.5px;
            font-weight: 600;
            overflow: hidden;
        }

        .cal-cum-tone-0 { background: var(--ed-chart-output); }
        .cal-cum-tone-1 { background: var(--ed-chart-cache); }
        .cal-cum-tone-2 { background: var(--ed-chart-thinking); }
        .cal-cum-tone-3 { background: var(--ed-chart-input); }
        .cal-cum-seg.is-peak { border-color: var(--ed-ink); }
        .cal-cum-seg:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 1px; }

        .cal-peak-callouts {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
            gap: 8px;
        }

        .cal-peak-chip {
            appearance: none;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
            padding: 9px 11px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            color: var(--ed-ink);
            font: inherit;
            text-align: start;
            cursor: pointer;
        }

        .cal-peak-chip.is-static { cursor: default; }
        .cal-peak-chip:not(.is-static):focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 2px; }
        @media (hover: hover) {
            .cal-peak-chip:not(.is-static):hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-accent-border);
            }
        }

        .cal-peak-chip-k { font-size: 11px; color: var(--ed-ink-muted); }
        .cal-peak-chip-v { font-size: 13px; font-weight: 650; color: var(--ed-ink); }
        .cal-peak-chip-m { font-size: 11px; color: var(--ed-ink-secondary); }

        /* ── Range Summary Footer & Plan ROI ─── */
        .cal-range-footer {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--ed-border);
        }

        .cal-range-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 120px), 1fr));
            gap: 1px;
            background: var(--ed-border);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            overflow: hidden;
        }

        .cal-range-item {
            background: var(--ed-surface-well);
            padding: 9px 10px;
            min-width: 0;
        }

        .cal-range-label {
            font-size: 11px;
            font-weight: 500;
            color: var(--ed-ink-muted);
            line-height: 1.3;
        }

        .cal-range-val {
            font-size: 0.98rem;
            font-weight: 650;
            color: var(--ed-ink);
            margin-top: 3px;
            overflow-wrap: anywhere;
        }

        .cal-range-sub {
            font-size: 11px;
            color: var(--ed-ink-secondary);
            margin-top: 2px;
        }

        .cal-roi-banner {
            margin-top: 10px;
            padding: 8px 11px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-good-tint);
            border: 1px solid var(--ed-good-border);
            display: flex;
            flex-wrap: wrap;
            align-items: baseline;
            justify-content: space-between;
            gap: 6px 12px;
            font-size: 11.5px;
        }

        .cal-roi-badge {
            color: var(--ed-good);
            font-weight: 600;
        }

        .cal-roi-note {
            color: var(--ed-ink-secondary);
            font-size: 11px;
        }

        /* ── Month Navigation & 7-Column Grid ─── */
        .cal-month-section { margin-top: 6px; }

        .cal-nav {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            margin-bottom: 12px;
        }

        .cal-nav-btn {
            appearance: none;
            width: 28px;
            height: 28px;
            padding: 0;
            background: var(--ed-surface);
            border: 1px solid var(--ed-control-border);
            border-radius: var(--ed-radius-sm);
            color: var(--ed-ink);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: background var(--ed-dur-fast) var(--ed-ease),
                border-color var(--ed-dur-fast) var(--ed-ease),
                color var(--ed-dur-fast) var(--ed-ease),
                transform 100ms var(--ed-ease);
        }

        .cal-nav-btn:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        .cal-nav-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .cal-nav-btn:hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-ink-muted);
                color: var(--ed-ink);
            }
        }

        .cal-month-label {
            font-weight: 600;
            font-size: 0.95em;
            min-width: 116px;
            text-align: center;
            color: var(--ed-ink);
        }

        .cal-grid {
            display: grid;
            grid-template-columns: repeat(7, minmax(0, 1fr));
            gap: 4px;
            margin-bottom: 14px;
        }

        .cal-header-cell {
            text-align: center;
            font-size: 11.5px;
            font-weight: 500;
            color: var(--ed-ink-muted);
            padding: 4px 2px 6px;
            border-bottom: 1px solid var(--ed-border);
            min-width: 0;
            overflow-wrap: anywhere;
        }

        .cal-cell {
            position: relative;
            min-width: 0;
            min-height: 44px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 2px;
            padding: 4px 2px;
            border-radius: var(--ed-radius-sm);
            font: inherit;
            font-size: 12.5px;
            color: var(--ed-ink-muted);
            background: transparent;
            border: 1.5px solid transparent;
            cursor: default;
            transition: background var(--ed-dur-fast) var(--ed-ease),
                border-color var(--ed-dur-fast) var(--ed-ease),
                color var(--ed-dur-fast) var(--ed-ease),
                transform 100ms var(--ed-ease);
        }

        .cal-day-num { line-height: 1.1; }

        .cal-cell-mini {
            font-size: 10px;
            line-height: 1.1;
            color: var(--ed-ink-secondary);
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .cal-cell.has-data {
            cursor: pointer;
            color: var(--ed-ink);
            font-weight: 550;
            background: var(--ed-surface-well);
            border-color: var(--ed-border);
        }

        .cal-cell.cal-cell-lvl-2 { background: var(--ed-accent-tint); border-color: var(--ed-accent-border); }
        .cal-cell.cal-cell-lvl-3 { background: var(--ed-accent-tint); border-color: var(--ed-accent-border); }
        .cal-cell.cal-cell-lvl-4 { background: var(--ed-accent-tint); border-color: var(--ed-accent); }
        .cal-cell.is-cost.cal-cell-lvl-3,
        .cal-cell.is-cost.cal-cell-lvl-4 { background: var(--ed-good-tint); border-color: var(--ed-good-border); }

        .cal-cell.has-data:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        .cal-cell.has-data:active { transform: scale(0.98); }

        @media (hover: hover) {
            .cal-cell.has-data:hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-accent-border);
            }
        }

        .cal-cell.today {
            border-color: var(--ed-accent);
            font-weight: 700;
            color: var(--ed-ink);
        }

        .cal-cell.selected {
            background: var(--ed-accent-tint);
            border-color: var(--ed-accent);
            color: var(--ed-ink);
        }

        .cal-cell.empty-cell {
            border-color: transparent;
            background: transparent;
            pointer-events: none;
        }

        .cal-dot {
            display: block;
            width: 5px;
            height: 5px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-accent);
            flex-shrink: 0;
        }

        .cal-dot.high-activity {
            width: 6px;
            height: 6px;
            background: var(--ed-good-fill);
        }

        /* ── Day Detail Drawer ─── */
        .cal-detail {
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-md);
            background: var(--ed-surface);
            padding: 16px 18px;
            margin-top: 12px;
            min-width: 0;
        }

        .cal-detail-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px;
            padding-bottom: 10px;
            margin-bottom: 12px;
            border-bottom: 1px solid var(--ed-border);
        }

        .cal-detail-date {
            font-weight: 600;
            font-size: 0.95em;
            color: var(--ed-ink);
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
        }

        .cal-detail-date .icon {
            width: 14px;
            height: 14px;
            color: var(--ed-accent);
            flex-shrink: 0;
        }

        .cal-detail-sources {
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 5px;
        }

        .cal-source-badge {
            display: inline-flex;
            align-items: center;
            padding: 1px 7px;
            border-radius: var(--ed-radius-pill);
            font-size: 11px;
            font-weight: 600;
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
        }

        .cal-source-app {
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border-color: var(--ed-accent-border);
        }

        .cal-source-ide {
            background: var(--ed-good-tint);
            color: var(--ed-good);
            border-color: var(--ed-good-border);
        }

        .cal-source-cli {
            background: var(--ed-warn-tint);
            color: var(--ed-warn);
            border-color: var(--ed-warn-border);
        }

        .cal-today-badge,
        .cal-live-badge {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border-radius: var(--ed-radius-pill);
            font-size: 11px;
            font-weight: 600;
            line-height: 1.4;
        }

        .cal-today-badge {
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border: 1px solid var(--ed-accent-border);
        }

        .cal-live-badge {
            background: var(--ed-good-tint);
            color: var(--ed-good);
            border: 1px solid var(--ed-good-border);
        }

        .cal-day-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(100%, 96px), 1fr));
            gap: 1px;
            background: var(--ed-border);
            border: 1px solid var(--ed-border);
            border-radius: var(--ed-radius-sm);
            overflow: hidden;
            margin-bottom: 12px;
        }

        .cal-day-total {
            text-align: center;
            padding: 10px 8px;
            background: var(--ed-surface-well);
            min-width: 0;
        }

        .cal-day-total-val {
            font-weight: 650;
            font-size: 1.05em;
            line-height: 1.25;
            color: var(--ed-ink);
            overflow-wrap: anywhere;
        }

        .cal-day-total-label {
            font-size: 11.5px;
            font-weight: 500;
            color: var(--ed-ink-muted);
            margin-top: 2px;
            line-height: 1.35;
        }

        /* ── Token Breakdown Strip ─── */
        .cal-token-breakdown {
            margin-bottom: 12px;
            padding: 9px 11px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
        }

        .cal-tok-bar {
            display: flex;
            width: 100%;
            height: 6px;
            border-radius: var(--ed-radius-pill);
            overflow: hidden;
            background: var(--ed-track);
            margin-bottom: 8px;
        }

        .cal-tok-seg { display: block; height: 100%; }
        .cal-tok-seg.is-input, .cal-tok-dot.is-input { background: var(--ed-chart-input); }
        .cal-tok-seg.is-cache, .cal-tok-dot.is-cache { background: var(--ed-chart-cache); }
        .cal-tok-seg.is-cwrite, .cal-tok-dot.is-cwrite { background: var(--ed-chart-thinking); }
        .cal-tok-seg.is-output, .cal-tok-dot.is-output { background: var(--ed-chart-output); }

        .cal-tok-legend {
            display: flex;
            flex-wrap: wrap;
            gap: 6px 14px;
            font-size: 11.5px;
            color: var(--ed-ink-secondary);
        }

        .cal-tok-item {
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }

        .cal-tok-item strong { color: var(--ed-ink); font-weight: 600; }

        .cal-tok-dot {
            display: inline-block;
            width: 7px;
            height: 7px;
            border-radius: 50%;
            flex-shrink: 0;
        }

        /* ── Per-Model Breakdown, Proportion Bars & Semantic Chips ─── */
        .cal-model-rows {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--ed-border);
        }

        .cal-gm-section-label {
            font-size: 12px;
            font-weight: 600;
            color: var(--ed-ink-secondary);
            margin-bottom: 8px;
        }

        .cal-model-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px 12px;
            padding: 8px 4px;
            font-size: 12.5px;
            flex-wrap: wrap;
            min-width: 0;
        }

        .cal-model-row + .cal-model-row {
            border-top: 1px solid var(--ed-border);
        }

        .cal-model-name {
            font-weight: 600;
            color: var(--ed-ink);
            flex: 0 1 16em;
            min-width: 0;
            overflow-wrap: anywhere;
            word-break: break-word;
        }

        .cal-model-share {
            font-size: 11px;
            font-weight: 500;
            color: var(--ed-ink-muted);
            margin-inline-start: 4px;
        }

        .cal-model-chips {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            min-width: 0;
        }

        .cal-model-bar {
            display: block;
            flex: 1 0 100%;
            height: 4px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-track);
            overflow: hidden;
            margin-top: 2px;
        }

        .cal-model-bar-fill {
            display: block;
            height: 100%;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-accent);
        }

        .cal-chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 8px;
            border-radius: var(--ed-radius-xs);
            font-size: 11.5px;
            font-weight: 550;
            line-height: 1.45;
            border: 1px solid var(--ed-border);
            background: var(--ed-surface-well);
            color: var(--ed-ink-secondary);
            max-width: 100%;
            white-space: nowrap;
        }

        .cal-chip svg { width: 11px; height: 11px; flex-shrink: 0; }
        .cal-chip-tools { background: var(--ed-accent-tint); color: var(--ed-accent); border-color: var(--ed-accent-border); }
        .cal-chip-tokens { background: var(--ed-good-tint); color: var(--ed-good); border-color: var(--ed-good-border); }
        .cal-chip-cost { background: var(--ed-warn-tint); color: var(--ed-warn); border-color: var(--ed-warn-border); }
        .cal-chip-errors { background: var(--ed-danger-tint); color: var(--ed-danger); border-color: var(--ed-danger-border); }
        .cal-chip-speed { background: var(--ed-surface-well); color: var(--ed-accent); border-color: var(--ed-accent-border); }
        .cal-chip-cache { background: var(--ed-surface-well); color: var(--ed-chart-cache); border-color: var(--ed-border-strong); }
        .cal-chip-ttft { background: var(--ed-surface-well); color: var(--ed-ink-muted); border-color: var(--ed-border); }

        .cal-model-chip {
            font-size: 11.5px;
            font-weight: 550;
            padding: 2px 8px;
            border-radius: var(--ed-radius-xs);
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border: 1px solid var(--ed-accent-border);
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .cal-account-tag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            font-weight: 600;
            padding: 2px 8px;
            border-radius: var(--ed-radius-pill);
            background: var(--ed-accent-tint);
            color: var(--ed-accent);
            border: 1px solid var(--ed-accent-border);
            margin-inline-start: 4px;
            vertical-align: middle;
        }

        /* ── Collapsible Archived Cycles ─── */
        .cal-cycles-details { margin-top: 12px; }

        .cal-cycles-summary {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            font-size: 12.5px;
            font-weight: 550;
            color: var(--ed-ink);
            padding: 8px 10px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            list-style: none;
            transition: background var(--ed-dur-fast) var(--ed-ease), border-color var(--ed-dur-fast) var(--ed-ease);
        }

        .cal-cycles-summary::-webkit-details-marker { display: none; }

        .cal-cycles-summary::before {
            content: '';
            width: 6px;
            height: 6px;
            border-right: 1.5px solid var(--ed-ink-muted);
            border-bottom: 1.5px solid var(--ed-ink-muted);
            transform: rotate(-45deg);
            transition: transform 160ms var(--ed-ease);
            flex-shrink: 0;
        }

        .cal-cycles-details[open] > .cal-cycles-summary::before { transform: rotate(45deg); }

        @media (hover: hover) {
            .cal-cycles-summary:hover {
                background: var(--ed-surface-hover);
                border-color: var(--ed-border-strong);
            }
        }

        .cal-cycles-summary:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        .cal-cycles-list {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-top: 8px;
        }

        .cal-cycle-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 6px 10px;
            padding: 8px 10px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-surface-well);
            border: 1px solid var(--ed-border);
            font-size: 12px;
        }

        .cal-cycle-meta {
            display: inline-flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
        }

        .cal-cycle-idx { font-weight: 650; color: var(--ed-ink); }
        .cal-cycle-time { color: var(--ed-ink-secondary); }
        .cal-cycle-stats { display: inline-flex; flex-wrap: wrap; gap: 5px; }

        /* ── Two-Step Clear History Action ─── */
        .cal-clear-section {
            margin-top: 20px;
            text-align: center;
        }

        .cal-clear-btn {
            appearance: none;
            height: 32px;
            padding: 0 14px;
            background: transparent;
            border: 1px solid var(--ed-danger-border);
            border-radius: var(--ed-radius-sm);
            color: var(--ed-danger);
            cursor: pointer;
            font: inherit;
            font-size: 12.5px;
            font-weight: 550;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            max-width: 100%;
            transition: background var(--ed-dur-fast) var(--ed-ease),
                border-color var(--ed-dur-fast) var(--ed-ease),
                transform 100ms var(--ed-ease);
        }

        .cal-clear-btn .icon { width: 13px; height: 13px; flex-shrink: 0; }
        .cal-clear-btn:focus-visible { outline: 2px solid var(--ed-accent); outline-offset: 2px; }
        .cal-clear-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .cal-clear-btn:hover {
                background: var(--ed-danger-tint);
                border-color: var(--ed-danger);
            }
        }

        .cal-clear-confirm {
            margin: 10px auto 0;
            max-width: 480px;
            padding: 12px 14px;
            border-radius: var(--ed-radius-sm);
            background: var(--ed-danger-tint);
            border: 1px solid var(--ed-danger-border);
            text-align: start;
        }

        .cal-clear-confirm-text {
            margin: 0 0 10px;
            font-size: 12px;
            color: var(--ed-ink);
        }

        .cal-clear-confirm-actions {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            flex-wrap: wrap;
        }

        .cal-clear-confirm-btn,
        .cal-clear-cancel-btn {
            appearance: none;
            height: 28px;
            padding: 0 12px;
            border-radius: var(--ed-radius-sm);
            font: inherit;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
        }

        .cal-clear-confirm-btn {
            background: var(--ed-danger-fill);
            color: #FFFFFF;
            border: 1px solid var(--ed-danger);
        }

        .cal-clear-cancel-btn {
            background: var(--ed-surface);
            color: var(--ed-ink);
            border: 1px solid var(--ed-control-border);
        }

        .cal-clear-confirm-btn:focus-visible,
        .cal-clear-cancel-btn:focus-visible {
            outline: 2px solid var(--ed-accent);
            outline-offset: 2px;
        }

        /* ── High-Contrast Mode Guarantees ─── */
        body:is(.vscode-high-contrast, .vscode-high-contrast-light,
            [data-vscode-theme-kind="vscode-high-contrast"], [data-vscode-theme-kind="vscode-high-contrast-light"],
            [data-acm-theme="hc"], [data-acm-theme="hc-light"])
            :is(.cal-hm-cell, .cal-hm-swatch, .cal-bar-track, .cal-tok-bar, .cal-model-bar, .cal-cum-seg) {
            outline: 1px solid var(--ed-border);
        }

        /* ── Narrow Viewport Safeguards (320px zero-overflow) ─── */
        @media (max-width: 440px) {
            .cal-grid { gap: 3px; }
            .cal-header-cell {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 1px;
                line-height: 1.2;
                font-size: 11px;
                padding: 4px 1px 6px;
            }
            .cal-header-cell .bi-sep { display: none; }
            .cal-cell { min-height: 36px; font-size: 12px; padding: 3px 1px; }
            .cal-cell-mini { display: none; }
            .cal-detail { padding: 12px; }
            .cal-bar-row {
                grid-template-columns: minmax(64px, 84px) minmax(0, 1fr) minmax(68px, 92px);
                gap: 6px;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .cal-summary-btn,
            .cal-pill-btn,
            .cal-export-btn,
            .cal-nav-btn,
            .cal-cell,
            .cal-hm-cell,
            .cal-cycles-summary,
            .cal-cycles-summary::before,
            .cal-clear-btn {
                transition: none;
            }
        }

    .cal-roi-advanced{margin-top:10px;border:1px solid var(--ed-border);border-radius:var(--ed-radius-sm);background:var(--ed-surface-well)}
.cal-roi-advanced-summary{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;cursor:pointer;font-size:12px;font-weight:550;color:var(--ed-ink-secondary);list-style:none}
.cal-roi-advanced-summary::-webkit-details-marker{display:none}
.cal-roi-summary-pill{font-family:var(--ed-mono);font-size:11px;padding:1px 7px;border-radius:var(--ed-radius-pill);background:var(--ed-surface);border:1px solid var(--ed-border);color:var(--ed-ink)}
.cal-roi-advanced .cal-roi-banner{margin:0;border:none;border-top:1px solid var(--ed-border);border-radius:0 0 var(--ed-radius-sm) var(--ed-radius-sm)}
.cal-ws-card-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.cal-ws-list,.cal-swarm-groups,.cal-swarm-members{display:flex;flex-direction:column;gap:8px}
.cal-ws-row{display:flex;flex-direction:column;gap:4px;padding:6px 8px;border:1px solid var(--ed-border);border-radius:var(--ed-radius-sm);background:var(--ed-surface-well)}
.cal-ws-row.is-unattributed{border-style:dashed}
.cal-ws-head,.cal-swarm-group-head,.cal-swarm-member{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;font-size:12px}
.cal-ws-name{font-weight:600;color:var(--ed-ink);overflow-wrap:anywhere}
.cal-ws-name.is-unattributed{color:var(--ed-ink-muted);font-style:italic}
.cal-ws-metrics,.cal-swarm-member-vals,.cal-swarm-split-meta{display:inline-flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:11.5px;color:var(--ed-ink-secondary);font-variant-numeric:tabular-nums}
.cal-ws-bar-track{height:5px;border-radius:999px;overflow:hidden;background:var(--ed-surface)}
.cal-ws-bar-fill{height:100%;background:var(--ed-accent);border-radius:999px}
.cal-ws-bar-fill.is-unattributed{background:var(--ed-ink-muted)}
.cal-ws-unpriced{padding:1px 6px;border-radius:var(--ed-radius-pill);font-size:10.5px;background:var(--ed-warn-tint);color:var(--ed-warn);border:1px solid var(--ed-warn-border)}
.cal-swarm-group{padding:8px 10px;border:1px solid var(--ed-border);border-radius:var(--ed-radius-sm);background:var(--ed-surface-well);display:flex;flex-direction:column;gap:6px}
.cal-swarm-member{padding:4px 8px;border-radius:var(--ed-radius-xs);background:var(--ed-surface);border:1px solid var(--ed-border)}
.cal-swarm-member-id,.cal-swarm-group-head strong{overflow-wrap:anywhere;min-width:0}
.cal-swarm-note,.cal-swarm-group summary{font-size:12px;color:var(--ed-ink-secondary)}
.cal-swarm-group summary{cursor:pointer;padding:4px 0}
.cal-swarm-members{margin-top:6px}
`;
}

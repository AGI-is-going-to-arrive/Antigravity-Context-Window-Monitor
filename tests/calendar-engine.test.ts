import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DailyLedger,
    type LedgerCallEntry,
} from '../src/daily-ledger';
import {
    DEFAULT_MAX_DAYS,
    DailyStore,
    MAX_RETENTION_DAYS,
    MIN_RETENTION_DAYS,
    computeAdditiveTokens,
    computeCycleTokenTotals,
    type DailyStoreState,
} from '../src/daily-store';
import {
    mergeArchivedAndLiveRecords,
    performDailyArchival,
    type DailyArchivalContext,
} from '../src/daily-archival';
import {
    buildCalendarExportData,
    buildCalendarTabContent,
    getCalendarTabStyles,
} from '../src/webview-calendar-tab';
import type { CliDailyUsageRecord } from '../src/cli-usage-scanner';
import type { ActivitySummary } from '../src/activity-tracker';
import type { GMCallEntry } from '../src/gm-tracker';

function localDate(y: number, m: number, d: number, h = 10, min = 0): Date {
    return new Date(y, m - 1, d, h, min, 0, 0);
}

function makeGlobalState() {
    const mem = new Map<string, unknown>();
    return {
        mem,
        get<T>(k: string, d: T): T { return mem.has(k) ? mem.get(k) as T : d; },
        update(k: string, v: unknown): Promise<void> { mem.set(k, v); return Promise.resolve(); },
    };
}

function makeEmptyActivity(): ActivitySummary {
    return {
        totalUserInputs: 0,
        totalReasoning: 0,
        totalToolCalls: 0,
        totalErrors: 0,
        totalCheckpoints: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalToolReturnTokens: 0,
        estSteps: 0,
        modelStats: {},
        globalToolStats: {},
        recentSteps: [],
        sessionStartTime: '2026-11-20T00:00:00.000Z',
        subAgentTokens: [],
        checkpointHistory: [],
        conversationBreakdown: [],
    };
}

function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
    return {
        stepIndices: [1],
        executionId: overrides.executionId || `exec-${Math.random().toString(36).slice(2, 10)}`,
        model: overrides.model || 'MODEL_PLACEHOLDER_M26',
        modelDisplay: overrides.modelDisplay || 'Claude Opus 4.6 (Thinking)',
        responseModel: overrides.responseModel || 'claude-opus-4-6-thinking',
        modelAccuracy: 'exact',
        inputTokens: overrides.inputTokens ?? 20_000,
        outputTokens: overrides.outputTokens ?? 10_000,
        thinkingTokens: overrides.thinkingTokens ?? 4_000,
        responseTokens: overrides.responseTokens ?? 6_000,
        cacheReadTokens: overrides.cacheReadTokens ?? 100_000,
        cacheCreationTokens: overrides.cacheCreationTokens ?? 10_000,
        apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
        ttftSeconds: overrides.ttftSeconds ?? 0.6,
        streamingSeconds: overrides.streamingSeconds ?? 2.0,
        credits: overrides.credits ?? 2,
        creditType: 'ai',
        hasError: false,
        errorMessage: '',
        contextTokensUsed: 120_000,
        completionConfig: null,
        systemPromptSnippet: '',
        toolCount: 0,
        toolNames: [],
        promptSectionTitles: [],
        promptSnippet: '',
        promptSource: 'none',
        messagePromptCount: 0,
        messageMetadataKeys: [],
        responseHeaderKeys: [],
        userMessageAnchors: [],
        aiSnippetsByStep: {},
        retries: 0,
        stopReason: 'STOP_REASON_END_TURN',
        retryTokensIn: 0,
        retryTokensOut: 0,
        retryCredits: 0,
        retryErrors: [],
        timeSinceLastInvocation: 0,
        tokenBreakdownGroups: [],
        createdAt: overrides.createdAt || localDate(2026, 11, 20, 10).toISOString(),
        latestStableMessageIndex: 0,
        startStepIndex: 0,
        checkpointIndex: 0,
        checkpointSummaries: [],
        systemContextItems: [],
        toolCallsByStep: {},
        contextWindowCapacity: 160_000,
        accountEmail: overrides.accountEmail || 'dev@example.com',
    };
}

function makeDateKeyOffset(base: Date, deltaDays: number): string {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + deltaDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

describe('DailyStore 400-day configurable retention & additive tokens', () => {
    it('retains 400 days by default (never trims at 90) and honors configurable maxDays', () => {
        expect(DEFAULT_MAX_DAYS).toBe(400);

        const base = localDate(2026, 11, 20);
        const records: DailyStoreState['records'] = {};
        for (let i = 0; i < 420; i++) {
            const dk = makeDateKeyOffset(base, -i);
            records[dk] = {
                date: dk,
                cycles: [{
                    startTime: `${dk}T00:00:00`,
                    endTime: `${dk}T23:59:59`,
                    totalReasoning: 0,
                    totalToolCalls: 0,
                    totalErrors: 0,
                    totalInputTokens: 0,
                    totalOutputTokens: 0,
                    estSteps: 0,
                    modelNames: ['Gemini 4 Neon (High)'],
                    gmTotalCalls: 1,
                    gmTotalTokens: 1000,
                    gmModelStats: {
                        'Gemini 4 Neon (High)': {
                            calls: 1,
                            credits: 0,
                            inputTokens: 800,
                            outputTokens: 200,
                            thinkingTokens: 50,
                            cacheReadTokens: 4_000,
                            cacheCreationTokens: 500,
                            avgTTFT: 0.5,
                            cacheHitRate: 1,
                            estimatedCost: 0.01,
                        },
                    },
                    estimatedCost: 0.01,
                }],
            };
        }

        const gs = makeGlobalState();
        gs.mem.set('dailyStoreState', { version: 1, records });
        const store = new DailyStore();
        store.init(gs);

        expect(store.maxDays).toBe(400);
        expect(store.totalDays).toBe(400);
        // Most recent 400 kept; oldest 20 trimmed
        expect(store.getRecord(makeDateKeyOffset(base, 0))).not.toBeNull();
        expect(store.getRecord(makeDateKeyOffset(base, -399))).not.toBeNull();
        expect(store.getRecord(makeDateKeyOffset(base, -400))).toBeNull();

        // Month summary includes additive totalTokens (800 + 4000 + 500 + 200 = 5500)
        const novCells = store.getMonthSummary(2026, 11);
        const nov20 = novCells.find(c => c.date === '2026-11-20');
        expect(nov20?.totalTokens).toBe(5_500);
        expect(nov20?.cacheReadTokens).toBe(4_000);
        expect(nov20?.cacheCreationTokens).toBe(500);

        // setMaxDays trims and persists
        store.setMaxDays(30);
        expect(store.maxDays).toBe(30);
        expect(store.totalDays).toBe(30);
        expect((gs.mem.get('dailyStoreState') as DailyStoreState).records[makeDateKeyOffset(base, -31)]).toBeUndefined();

        // Clamping bounds
        expect(new DailyStore(1).maxDays).toBe(MIN_RETENTION_DAYS);
        expect(new DailyStore(99999).maxDays).toBe(MAX_RETENTION_DAYS);
    });

    it('computes additive tokens consistently without double-adding thinkingTokens', () => {
        expect(computeAdditiveTokens({
            inputTokens: 10_000,
            cacheReadTokens: 80_000,
            cacheCreationTokens: 5_000,
            outputTokens: 15_000,
        })).toBe(110_000);

        const totals = computeCycleTokenTotals({
            startTime: '2026-11-20T00:00:00Z',
            endTime: '2026-11-20T23:59:59Z',
            totalReasoning: 0,
            totalToolCalls: 0,
            totalErrors: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            estSteps: 0,
            modelNames: ['Claude Opus 4.6 (Thinking)'],
            gmModelStats: {
                'Claude Opus 4.6 (Thinking)': {
                    calls: 2,
                    credits: 4,
                    inputTokens: 10_000,
                    outputTokens: 15_000,
                    thinkingTokens: 9_000, // subset of outputTokens!
                    cacheReadTokens: 80_000,
                    cacheCreationTokens: 5_000,
                    avgTTFT: 0.7,
                    cacheHitRate: 1,
                },
            },
        });
        expect(totals.totalTokens).toBe(110_000);
        expect(totals.thinkingTokens).toBe(9_000);
    });
});

describe('Live Today Merge, Midnight Rollover Dedup & Surface Tagging', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('merges live active + settled DailyLedger on Day 1 when DailyStore is empty', () => {
        vi.setSystemTime(localDate(2026, 11, 20, 14, 0));
        const store = new DailyStore();
        const ledger = new DailyLedger('2026-11-20', 'app');

        ledger.recordCalls([
            {
                call: makeCall({
                    executionId: 'live-1',
                    createdAt: localDate(2026, 11, 20, 9, 30).toISOString(),
                    model: 'MODEL_PLACEHOLDER_M16',
                    modelDisplay: 'Gemini 3.1 Pro (High)',
                    responseModel: 'gemini-3.1-pro-high',
                    inputTokens: 10_000,
                    cacheReadTokens: 90_000,
                    cacheCreationTokens: 0,
                    outputTokens: 5_000,
                    thinkingTokens: 1_000,
                }),
                dedupKey: 'c1:0',
                surface: 'app',
            },
            {
                call: makeCall({
                    executionId: 'live-2',
                    createdAt: localDate(2026, 11, 20, 13, 15).toISOString(),
                    model: 'MODEL_PLACEHOLDER_M26',
                    modelDisplay: 'Claude Opus 4.6 (Thinking)',
                    responseModel: 'claude-opus-4-6-thinking',
                    inputTokens: 20_000,
                    cacheReadTokens: 80_000,
                    cacheCreationTokens: 10_000,
                    outputTokens: 10_000,
                    thinkingTokens: 4_000,
                }),
                dedupKey: 'c2:0',
                surface: 'ide',
            },
        ]);

        // Settle Gemini pool (simulating mid-day quota reset) while keeping Claude active
        const settled = ledger.settleForQuotaReset(['MODEL_PLACEHOLDER_M16'], 'dev@example.com');
        expect(settled?.totalCalls).toBe(1);
        expect(settled?.surface).toBe('app');

        // Verify ledger serialization + restore preserves surface breakdown
        const restored = DailyLedger.restore(JSON.parse(JSON.stringify(ledger.serialize())));
        expect(restored.getTodayDetailedTotals().totalAdditiveTokens).toBe(105_000 + 120_000);

        const merged = mergeArchivedAndLiveRecords({
            store,
            liveLedger: restored,
            now: localDate(2026, 11, 20, 14, 0),
        });

        // DailyStore itself was NOT mutated!
        expect(store.totalDays).toBe(0);
        expect(merged.size).toBe(1);
        const todayRec = merged.get('2026-11-20')!;
        expect(todayRec.cycles).toHaveLength(1);
        expect(todayRec.cycles[0].isLive).toBe(true);
        expect(todayRec.cycles[0].gmTotalCalls).toBe(2);
        expect(todayRec.cycles[0].gmTotalAllTokens).toBe(225_000);
        expect(todayRec.cycles[0].surfaceBreakdown?.app?.calls).toBe(1);
        expect(todayRec.cycles[0].surfaceBreakdown?.ide?.calls).toBe(1);

        // Calendar HTML renders Day 1 live today immediately!
        const html = buildCalendarTabContent(store, 2026, 11, {
            liveLedger: restored,
            now: localDate(2026, 11, 20, 14, 0),
            language: 'en',
        });
        expect(html).toContain('Live Today');
        expect(html).toContain('225.0k');
        expect(html).toContain('id="cal-detail-2026-11-20"');
        // Never uses generic "has data" tooltip
        expect(html).not.toContain('data-tooltip="has data"');
    });

    it('never double-counts across midnight rollover OR stale un-flushed ledger snapshots', () => {
        vi.setSystemTime(localDate(2026, 11, 20, 23, 50));
        const store = new DailyStore();
        const ledger = new DailyLedger('2026-11-20', 'ide');
        ledger.recordCalls([
            {
                call: makeCall({
                    executionId: 'mid-1',
                    createdAt: localDate(2026, 11, 20, 22, 0).toISOString(),
                    inputTokens: 10_000,
                    cacheReadTokens: 40_000,
                    cacheCreationTokens: 0,
                    outputTokens: 5_000,
                }),
                dedupKey: 'conv:0',
            },
        ]);

        // Take a stale pre-rollover snapshot simulating a second window racing at midnight
        const staleSnapshot = ledger.getLiveDaySnapshot();

        // Cross midnight -> performDailyArchival archives 2026-11-20 and resets ledger to 2026-11-21
        vi.setSystemTime(localDate(2026, 11, 21, 0, 5));
        const ctx: DailyArchivalContext = {
            activityTracker: { getSummary: makeEmptyActivity, archiveAndReset: () => null } as any,
            gmTracker: { reset: () => {}, getDetailedSummary: () => null, getCachedSummary: () => null, getArchivalSummary: () => null } as any,
            dailyStore: store,
            pricingStore: null,
            lastGMSummary: null,
            persistedModelDNA: {},
            lastArchivalDateKey: '2026-11-20',
            dailyLedger: ledger,
            surface: 'ide',
            persist: () => {},
            log: () => {},
        };
        const res = performDailyArchival(ctx, false, localDate(2026, 11, 21, 0, 5));
        expect(res.archived).toBe(true);
        expect(store.getRecord('2026-11-20')?.cycles[0].surface).toBe('ide');
        expect(store.getRecord('2026-11-20')?.cycles[0].gmTotalAllTokens).toBe(55_000);

        // Case 1: Merging store + reset ledger -> exactly 1 call, 55k tokens
        const afterRollover = mergeArchivedAndLiveRecords({
            store,
            liveLedger: ledger,
            now: localDate(2026, 11, 21, 0, 5),
        });
        expect(afterRollover.get('2026-11-20')!.cycles).toHaveLength(1);
        expect(afterRollover.get('2026-11-20')!.cycles[0].gmTotalCalls).toBe(1);

        // Case 2: Merging store + STALE pre-rollover snapshot of 2026-11-20 -> STILL 1 call, 55k tokens (ZERO double-count!)
        const withStale = mergeArchivedAndLiveRecords({
            store,
            liveLedger: {
                dateKey: '2026-11-20',
                active: Object.values(staleSnapshot.accounts),
                settled: staleSnapshot.settled,
            },
            now: localDate(2026, 11, 21, 0, 5),
        });
        expect(withStale.get('2026-11-20')!.cycles).toHaveLength(1);
        expect(withStale.get('2026-11-20')!.cycles[0].gmTotalCalls).toBe(1);
        expect(withStale.get('2026-11-20')!.cycles[0].gmTotalAllTokens).toBe(55_000);
    });

    it('deduplicates same-day forced archival while cleanly appending strictly newer post-archival calls', () => {
        vi.setSystemTime(localDate(2026, 11, 20, 12, 0));
        const store = new DailyStore();
        const ledger = new DailyLedger('2026-11-20', 'app');
        ledger.recordCalls([{
            call: makeCall({
                executionId: 'morning-1',
                createdAt: localDate(2026, 11, 20, 10, 0).toISOString(),
                inputTokens: 10_000,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                outputTokens: 2_000,
            }),
            dedupKey: 'c:0',
        }]);
        const duplicateMorningSnapshot = ledger.getLiveDaySnapshot();

        // Forced same-day archival at 12:00
        performDailyArchival({
            activityTracker: { getSummary: makeEmptyActivity, archiveAndReset: () => null } as any,
            gmTracker: { reset: () => {}, getDetailedSummary: () => null, getCachedSummary: () => null, getArchivalSummary: () => null } as any,
            dailyStore: store,
            pricingStore: null,
            lastGMSummary: null,
            persistedModelDNA: {},
            lastArchivalDateKey: '2026-11-20',
            dailyLedger: ledger,
            persist: () => {},
            log: () => {},
        }, true, localDate(2026, 11, 20, 12, 0));

        // Merging with duplicate morning snapshot MUST NOT double-count
        const deduped = mergeArchivedAndLiveRecords({
            store,
            liveLedger: { dateKey: '2026-11-20', active: Object.values(duplicateMorningSnapshot.accounts), settled: [] },
            now: localDate(2026, 11, 20, 12, 5),
        });
        expect(deduped.get('2026-11-20')!.cycles).toHaveLength(1);
        expect(deduped.get('2026-11-20')!.cycles[0].gmTotalCalls).toBe(1);

        // Now record a genuinely NEW afternoon call at 15:00 (after archived endTime 12:00)
        vi.setSystemTime(localDate(2026, 11, 20, 15, 0));
        ledger.recordCalls([{
            call: makeCall({
                executionId: 'afternoon-1',
                createdAt: localDate(2026, 11, 20, 15, 0).toISOString(),
                inputTokens: 5_000,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                outputTokens: 1_000,
            }),
            dedupKey: 'c:1',
        }]);
        const appended = mergeArchivedAndLiveRecords({
            store,
            liveLedger: ledger,
            now: localDate(2026, 11, 20, 15, 5),
        });
        expect(appended.get('2026-11-20')!.cycles).toHaveLength(2);
        const totalCalls = appended.get('2026-11-20')!.cycles.reduce((s, c) => s + (c.gmTotalCalls || 0), 0);
        expect(totalCalls).toBe(2);
    });
});

describe('Studio-Telemetry Calendar & Activity Heatmap Dashboard UI', () => {
    function buildSampleStoreAndCli(): {
        store: DailyStore;
        cliDays: CliDailyUsageRecord[];
    } {
        const store = new DailyStore();
        store.restoreSnapshot({
            version: 1,
            records: {
                // Legacy untagged record (surface omitted -> 'unknown', visible under All)
                '2026-11-10': {
                    date: '2026-11-10',
                    cycles: [{
                        startTime: '2026-11-10T09:00:00Z',
                        endTime: '2026-11-10T18:00:00Z',
                        totalReasoning: 0,
                        totalToolCalls: 0,
                        totalErrors: 0,
                        totalInputTokens: 0,
                        totalOutputTokens: 0,
                        estSteps: 0,
                        modelNames: ['Gemini 4 Neon (High)'],
                        gmTotalCalls: 5,
                        gmTotalCredits: 2,
                        gmTotalTokens: 30_000,
                        estimatedCost: 0.5,
                        gmModelStats: {
                            'Gemini 4 Neon (High)': {
                                calls: 5,
                                credits: 2,
                                inputTokens: 20_000,
                                outputTokens: 10_000,
                                thinkingTokens: 3_000,
                                cacheReadTokens: 70_000,
                                cacheCreationTokens: 0,
                                avgTTFT: 0.45,
                                avgGenTokPerSec: 82.5,
                                cacheHitRate: 1,
                                tokenCacheHitRate: 70_000 / 90_000,
                                estimatedCost: 0.5,
                            },
                        },
                    }],
                },
                // IDE-tagged record
                '2026-11-18': {
                    date: '2026-11-18',
                    cycles: [{
                        startTime: '2026-11-18T08:00:00Z',
                        endTime: '2026-11-18T17:00:00Z',
                        totalReasoning: 0,
                        totalToolCalls: 0,
                        totalErrors: 0,
                        totalInputTokens: 0,
                        totalOutputTokens: 0,
                        estSteps: 0,
                        modelNames: ['Claude Opus 4.6 (Thinking)'],
                        gmTotalCalls: 8,
                        gmTotalCredits: 4,
                        gmTotalTokens: 50_000,
                        gmTotalAllTokens: 250_000,
                        estimatedCost: 2.0,
                        surface: 'ide',
                        accountEmail: 'dev@example.com',
                        triggeredBy: ['Claude'],
                        gmModelStats: {
                            'Claude Opus 4.6 (Thinking)': {
                                calls: 8,
                                credits: 4,
                                inputTokens: 30_000,
                                outputTokens: 20_000,
                                thinkingTokens: 6_000,
                                cacheReadTokens: 180_000,
                                cacheCreationTokens: 20_000,
                                avgTTFT: 0.85,
                                avgGenTokPerSec: 60.0,
                                cacheHitRate: 1,
                                tokenCacheHitRate: 180_000 / 230_000,
                                estimatedCost: 2.0,
                            },
                        },
                    }],
                },
            },
        });

        const cliDays: CliDailyUsageRecord[] = [
            {
                date: '2026-11-19',
                surface: 'cli',
                calls: 6,
                sessions: 2,
                inputTokens: 15_000,
                outputTokens: 5_000,
                thinkingTokens: 1_000,
                cacheReadTokens: 80_000,
                cacheCreationTokens: 0,
                totalTokens: 100_000,
                credits: 0,
                estimatedCost: 0.8,
                models: {
                    'Gemini 4 Carbon (High)': {
                        calls: 6,
                        inputTokens: 15_000,
                        outputTokens: 5_000,
                        thinkingTokens: 1_000,
                        cacheReadTokens: 80_000,
                        cacheCreationTokens: 0,
                        credits: 0,
                        estimatedCost: 0.8,
                        avgTTFT: 0.55,
                        avgGenTokPerSec: 95.0,
                        cacheHitRate: 1,
                        tokenCacheHitRate: 80_000 / 95_000,
                    },
                },
            },
        ];

        return { store, cliDays };
    }

    it('renders controls bar, 4-card KPI header, 52-week 5-level heatmap, range footer, detail drawer, and safe two-step clear', () => {
        const { store, cliDays } = buildSampleStoreAndCli();
        const now = localDate(2026, 11, 20, 12, 0);

        const html = buildCalendarTabContent(store, 2026, 11, {
            cliDays,
            selectedDate: '2026-11-18',
            now,
            language: 'both',
        });

        // Controls bar & hooks
        expect(html).toContain('data-action="calendarFilterSource"');
        expect(html).toContain('data-action="calendarSetMetric"');
        expect(html).toContain('data-action="calendarSetPeriod"');
        expect(html).toContain('data-action="calendarSetView"');
        expect(html).toContain('data-action="calendarExportCsv"');
        expect(html).toContain('data-action="calendarExportJson"');

        // 4 KPI cards
        expect(html).toContain('data-cal-kpi="total"');
        expect(html).toContain('data-cal-kpi="today"');
        expect(html).toContain('data-cal-kpi="month"');
        expect(html).toContain('data-cal-kpi="year"');

        // Additive Total = 100k (Nov 10) + 250k (Nov 18) + 100k (Nov 19 CLI) = 450.0k
        expect(html).toContain('450.0k');
        expect(html).toContain('$3.30');

        // 52-week heatmap & 5-level legend
        expect(html).toContain('data-cal-heatmap="true"');
        expect(html).toContain('cal-heatmap-scroll');
        expect(html).toContain('cal-hm-legend');
        expect(html).toContain('cal-lvl-4');

        // Selected detail drawer open with token breakdown, model proportion bar, and revived cycle history
        expect(html).toContain('id="cal-detail-2026-11-18"');
        expect(html).toContain('cal-detail-open');
        expect(html).toContain('cal-token-breakdown');
        expect(html).toContain('cal-model-bar');
        expect(html).toContain('cal-cycles-details');
        expect(html).toContain('id="cal-cycles-2026-11-18"');

        // Two-step Clear History confirmation (hidden by default)
        expect(html).toContain('id="clearCalendarBtn"');
        expect(html).toContain('data-action="calendarClearArm"');
        expect(html).toContain('id="calClearConfirmBar"');
        expect(html).toContain('id="confirmClearCalendarBtn"');
        expect(html).toContain('data-action="calendarClearConfirm"');
        expect(html).toContain('id="cancelClearCalendarBtn"');
        expect(html).toMatch(/id="calClearConfirmBar"[^>]*hidden/);

        // Confirming clear reveals dialog
        const armedHtml = buildCalendarTabContent(store, 2026, 11, {
            cliDays,
            confirmingClear: true,
            now,
            language: 'en',
        });
        expect(armedHtml).toContain('aria-expanded="true"');
        expect(armedHtml).not.toMatch(/id="calClearConfirmBar"[^>]*hidden/);

        // Strictly USD by default -> NO ¥/￥ anywhere, NO '令牌', NO NaN/Infinity
        expect(html).not.toMatch(/[\u00a5\uffe5]/);
        expect(html).not.toContain('令牌');
        expect(html).not.toMatch(/NaN|Infinity/);
    });

    it('filters cleanly by source (all / app / ide / cli) and labels legacy untagged records transparently', () => {
        const { store, cliDays } = buildSampleStoreAndCli();
        const now = localDate(2026, 11, 20, 12, 0);

        const cliOnlyHtml = buildCalendarTabContent(store, 2026, 11, {
            cliDays,
            sourceFilter: 'cli',
            now,
            language: 'en',
        });
        expect(cliOnlyHtml).toContain('100.0k');
        expect(cliOnlyHtml).toContain('$0.80');
        expect(cliOnlyHtml).toContain('id="cal-detail-2026-11-19"');
        expect(cliOnlyHtml).not.toContain('id="cal-detail-2026-11-18"');
        expect(cliOnlyHtml).not.toContain('id="cal-detail-2026-11-10"');

        const ideOnlyHtml = buildCalendarTabContent(store, 2026, 11, {
            cliDays,
            sourceFilter: 'ide',
            now,
            language: 'en',
        });
        expect(ideOnlyHtml).toContain('250.0k');
        expect(ideOnlyHtml).toContain('$2.00');
        expect(ideOnlyHtml).toContain('id="cal-detail-2026-11-18"');
        expect(ideOnlyHtml).not.toContain('id="cal-detail-2026-11-19"');

        const allHtml = buildCalendarTabContent(store, 2026, 11, {
            cliDays,
            sourceFilter: 'all',
            now,
            language: 'en',
        });
        expect(allHtml).toContain('Unlabeled');

        // Empty filtered source (no 'app' records in this fixture) degrades cleanly with zero NaN/Infinity
        const emptyAppHtml = buildCalendarTabContent(store, 2026, 11, {
            cliDays,
            sourceFilter: 'app',
            now,
            language: 'en',
        });
        expect(emptyAppHtml).toContain('data-cal-source="app"');
        expect(emptyAppHtml).not.toContain('id="cal-detail-2026-11-18"');
        expect(emptyAppHtml).not.toMatch(/NaN|Infinity/);
    });

    it('merges IDE archived + App live + CLI scanned records on the SAME date without losing or double-counting any source', () => {
        const now = localDate(2026, 11, 20, 15, 0);
        const store = new DailyStore();
        store.restoreSnapshot({
            version: 1,
            records: {
                '2026-11-20': {
                    date: '2026-11-20',
                    cycles: [{
                        startTime: '2026-11-20T08:00:00Z',
                        endTime: '2026-11-20T10:00:00Z',
                        totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                        totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                        modelNames: ['Gemini 4 Neon (High)'],
                        gmTotalCalls: 2, gmTotalCredits: 0, gmTotalTokens: 10_000, gmTotalAllTokens: 50_000,
                        estimatedCost: 0.25,
                        surface: 'ide',
                        gmModelStats: {
                            'Gemini 4 Neon (High)': {
                                calls: 2, credits: 0, inputTokens: 8_000, outputTokens: 2_000,
                                thinkingTokens: 0, cacheReadTokens: 40_000, cacheCreationTokens: 0,
                                avgTTFT: 0.4, cacheHitRate: 1, estimatedCost: 0.25,
                            },
                        },
                    }],
                },
            },
        });

        const ledger = new DailyLedger('2026-11-20', 'app');
        vi.useFakeTimers();
        vi.setSystemTime(now);
        try {
            ledger.recordCalls([{
                call: makeCall({
                    executionId: 'same-day-app-1',
                    createdAt: localDate(2026, 11, 20, 14, 0).toISOString(),
                    inputTokens: 10_000, outputTokens: 5_000, cacheReadTokens: 85_000, cacheCreationTokens: 0,
                }),
                dedupKey: 'app-conv:0',
                surface: 'app',
            }]);
        } finally {
            vi.useRealTimers();
        }

        const cliDays: CliDailyUsageRecord[] = [{
            date: '2026-11-20',
            surface: 'cli',
            calls: 3,
            sessions: 1,
            inputTokens: 5_000,
            outputTokens: 5_000,
            thinkingTokens: 0,
            cacheReadTokens: 20_000,
            cacheCreationTokens: 0,
            totalTokens: 30_000,
            credits: 0,
            estimatedCost: 0.15,
            models: {
                'Gemini 4 Carbon (High)': {
                    calls: 3, inputTokens: 5_000, outputTokens: 5_000, thinkingTokens: 0,
                    cacheReadTokens: 20_000, cacheCreationTokens: 0, credits: 0, estimatedCost: 0.15,
                    avgTTFT: 0.5, cacheHitRate: 1,
                },
            },
        }];

        // All = 50k (IDE) + 100k (App) + 30k (CLI) = 180k
        const allExport = buildCalendarExportData(store, 2026, 11, { liveLedger: ledger, cliDays, sourceFilter: 'all', now });
        expect(allExport.rows).toHaveLength(1);
        expect(allExport.rows[0].totalTokens).toBe(180_000);
        expect(allExport.rows[0].sources).toEqual(expect.arrayContaining(['ide', 'app', 'cli']));

        expect(buildCalendarExportData(store, 2026, 11, { liveLedger: ledger, cliDays, sourceFilter: 'ide', now }).rows[0].totalTokens).toBe(50_000);
        expect(buildCalendarExportData(store, 2026, 11, { liveLedger: ledger, cliDays, sourceFilter: 'app', now }).rows[0].totalTokens).toBe(100_000);
        expect(buildCalendarExportData(store, 2026, 11, { liveLedger: ledger, cliDays, sourceFilter: 'cli', now }).rows[0].totalTokens).toBe(30_000);
    });

    it('renders all 5 period modes, view modes, non-USD dual currency, and Plan ROI cleanly across en/zh/both', () => {
        const { store, cliDays } = buildSampleStoreAndCli();
        const now = localDate(2026, 11, 20, 12, 0);

        for (const periodMode of ['daily', 'weekly', 'monthly', 'year', 'all'] as const) {
            for (const language of ['en', 'zh', 'both'] as const) {
                const html = buildCalendarTabContent(store, 2026, 11, {
                    cliDays,
                    periodMode,
                    metricMode: periodMode === 'weekly' ? 'cost' : 'tokens',
                    currency: { code: 'CNY', customRatePerUsd: 7.2 },
                    subscription: { planId: 'google-ai-pro' },
                    now,
                    language,
                });
                expect(html).toContain(`data-cal-period="${periodMode}"`);
                expect(html).toContain('data-cal-roi="true"');
                expect(html).toContain('¥');
                expect(html).not.toContain('令牌');
                expect(html).not.toMatch(/NaN|Infinity/);
                if (periodMode === 'all') {
                    expect(html).toContain('cal-cum-strip');
                    expect(html).toContain('data-action="calendarJumpDate"');
                }
            }
        }

        // View mode toggle: heatmap-only omits Month Grid, monthGrid-only omits Heatmap
        const heatmapOnly = buildCalendarTabContent(store, 2026, 11, { viewMode: 'heatmap', now, language: 'en' });
        expect(heatmapOnly).toContain('data-cal-heatmap="true"');
        expect(heatmapOnly).not.toContain('class="cal-grid"');

        const monthOnly = buildCalendarTabContent(store, 2026, 11, { viewMode: 'monthGrid', now, language: 'en' });
        expect(monthOnly).toContain('class="cal-grid"');
        expect(monthOnly).not.toContain('data-cal-heatmap="true"');
    });

    it('handles empty, uninitialized, and 400-day large datasets gracefully and builds filtered exports', () => {
        // Uninitialized
        const uninit = buildCalendarTabContent(undefined);
        expect(uninit).toContain('empty-desc');

        // Empty store (0 days)
        const emptyStore = new DailyStore();
        const emptyHtml = buildCalendarTabContent(emptyStore, 2026, 11, { now: localDate(2026, 11, 20), language: 'en' });
        expect(emptyHtml).toContain('cal-kpi-grid');
        expect(emptyHtml).not.toContain('id="clearCalendarBtn"');
        expect(emptyHtml).not.toMatch(/NaN|Infinity/);

        // Large 400-day archive
        const bigStore = new DailyStore();
        const base = localDate(2026, 11, 20);
        const records: DailyStoreState['records'] = {};
        for (let i = 0; i < 400; i++) {
            const dk = makeDateKeyOffset(base, -i);
            records[dk] = {
                date: dk,
                cycles: [{
                    startTime: `${dk}T00:00:00Z`,
                    endTime: `${dk}T23:59:59Z`,
                    totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                    totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                    modelNames: ['Gemini 4 Neon (High)'],
                    gmTotalCalls: (i % 7) + 1,
                    gmTotalTokens: 10_000,
                    gmTotalAllTokens: 50_000,
                    estimatedCost: 0.25,
                    surface: i % 2 === 0 ? 'app' : 'ide',
                    gmModelStats: {
                        'Gemini 4 Neon (High)': {
                            calls: (i % 7) + 1, credits: 0,
                            inputTokens: 8_000, outputTokens: 2_000, thinkingTokens: 500,
                            cacheReadTokens: 40_000, cacheCreationTokens: 0,
                            avgTTFT: 0.5, cacheHitRate: 1, estimatedCost: 0.25,
                        },
                    },
                }],
            };
        }
        bigStore.restoreSnapshot({ version: 1, records });

        const bigHtml = buildCalendarTabContent(bigStore, 2026, 11, { now: base, language: 'en' });
        expect(bigHtml).toContain('20.0M'); // 400 * 50,000 = 20,000,000
        expect(bigHtml).toContain('$100.00'); // 400 * 0.25
        // Detail panels are bounded (not 400 panels dumped into the DOM)
        const detailMatches = bigHtml.match(/data-cal-detail="/g) || [];
        expect(detailMatches.length).toBeLessThanOrEqual(92);

        // Export bundle respects source filter
        const appExport = buildCalendarExportData(bigStore, 2026, 11, {
            sourceFilter: 'app',
            periodMode: 'all',
            now: base,
        });
        expect(appExport.rows).toHaveLength(200);
        expect(JSON.parse(appExport.json).summary.totalTokens).toBe(200 * 50_000);
        expect(appExport.csv.trim().split('\n')).toHaveLength(201);

        // Stylesheet has balanced braces and Studio Telemetry tokens
        const css = getCalendarTabStyles();
        expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
        expect(css).toContain('.cal-hm-cell');
        expect(css).toContain('.cal-kpi-grid');
        expect(css).toContain('.cal-clear-confirm');
        expect(css).toContain('--ed-accent');
    });
});

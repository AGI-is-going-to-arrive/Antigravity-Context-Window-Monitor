// Consolidated Domain Suite: Calendar Engine, CLI Usage Scanner (Unit) & agy-statusline
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { DailyLedger, type LedgerCallEntry } from '../src/daily-ledger';
import {
    computeAdditiveTokens,
    computeCycleTokenTotals,
    DailyStore,
    type DailyStoreState,
    DEFAULT_MAX_DAYS,
    MAX_RETENTION_DAYS,
    MIN_RETENTION_DAYS,
} from '../src/daily-store';
import { type DailyArchivalContext, mergeArchivedAndLiveRecords, performDailyArchival } from '../src/daily-archival';
import { buildCalendarExportData, buildCalendarTabContent, getCalendarTabStyles } from '../src/webview-calendar-tab';
import {
    aggregateCliCallsByDay,
    buildCalendarExportCsv,
    buildCalendarExportJson,
    type CalendarExportDayRow,
    type CliDailyUsageRecord,
    cliDayRecordToDailyRecord,
    CliUsageScanner,
    computeActivityStreaks,
    convertCurrencyToUsd,
    convertUsdToCurrency,
    CURRENCY_CODES,
    CURRENCY_PRESETS,
    decodeCliGenMetadataBlob,
    estimateSubscriptionRoi,
    formatCurrencyAmount,
    formatDualCurrencyAmount,
    isSubscriptionPlanPresetId,
    normalizeSubscriptionPlanId,
    resolveCurrencyConfig,
    resolveDefaultCliDataDir,
    ROI_DISCLAIMER_EN,
    ROI_DISCLAIMER_ZH,
    SUBSCRIPTION_PLAN_PRESET_ORDER,
    SUBSCRIPTION_PLAN_PRESETS,
} from '../src/cli-usage-scanner';
import type { ActivitySummary } from '../src/activity-tracker';
import type { GMCallEntry } from '../src/gm-tracker';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { PassThrough, Writable } from 'node:stream';
import {
    type AgyStatusLinePayload,
    buildStatusLineObservation,
    formatCompactTokenCount,
    formatStatusLine,
    MAX_STDIN_BYTES,
    parseStatusLineArgs,
    parseStatusLinePayload,
    readBoundedStdin,
    runStatusLineCli,
    sanitizeTerminalText,
    UNAVAILABLE_MARKER,
} from '../src/cli/agy-statusline-entry';

describe('[calendar-engine]', () => {
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

        it('keeps ISO week keys and range spans DST-safe across spring-forward transitions and emits valid ARIA roles', () => {
            const store = new DailyStore();
            // Cover both Northern (Mar 8, 2026) and Southern (Oct 4, 2026) spring-forward DST weeks
            const sampleDates = [
                '2026-03-02', // W10
                '2026-03-09', // W11
                '2026-03-16', // W12
                '2026-09-28', // W40
                '2026-10-05', // W41
                '2026-10-12', // W42
                '2026-10-19', // W43
            ];
            const records: DailyStoreState['records'] = {};
            for (const dk of sampleDates) {
                records[dk] = {
                    date: dk,
                    cycles: [{
                        startTime: `${dk}T01:00:00Z`,
                        endTime: `${dk}T02:00:00Z`,
                        totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                        totalInputTokens: 0, totalOutputTokens: 0, estSteps: 0,
                        modelNames: ['Gemini 4 Neon (High)'],
                        gmTotalCalls: 1,
                        gmTotalTokens: 10_000,
                        gmTotalAllTokens: 50_000,
                        estimatedCost: 0.5,
                        surface: 'app',
                        gmModelStats: {
                            'Gemini 4 Neon (High)': {
                                calls: 1, credits: 0,
                                inputTokens: 8_000, outputTokens: 2_000, thinkingTokens: 0,
                                cacheReadTokens: 40_000, cacheCreationTokens: 0,
                                avgTTFT: 0.4, cacheHitRate: 0.8, estimatedCost: 0.5,
                            },
                        },
                    }],
                };
            }
            store.restoreSnapshot({ version: 1, records });

            // Weekly chart in Oct 2026 must keep distinct 2026-W40..W43 bars (no DST collision!)
            const octWeeklyHtml = buildCalendarTabContent(store, 2026, 10, {
                periodMode: 'weekly',
                now: localDate(2026, 10, 20),
                language: 'en',
            });
            expect(octWeeklyHtml).toContain('>2026-W40<');
            expect(octWeeklyHtml).toContain('>2026-W41<');
            expect(octWeeklyHtml).toContain('>2026-W42<');
            expect(octWeeklyHtml).toContain('>2026-W43<');
            expect(octWeeklyHtml).not.toContain('100.0k'); // No two 50k weeks collided into one 100k week!

            // Weekly chart in Mar 2026 must keep distinct 2026-W10..W12 bars (no US DST collision!)
            const marWeeklyHtml = buildCalendarTabContent(store, 2026, 3, {
                periodMode: 'weekly',
                now: localDate(2026, 3, 20),
                language: 'en',
            });
            expect(marWeeklyHtml).toContain('>2026-W10<');
            expect(marWeeklyHtml).toContain('>2026-W11<');
            expect(marWeeklyHtml).toContain('>2026-W12<');
            expect(marWeeklyHtml).not.toContain('100.0k');

            // All-Time span from 2026-03-02 to 2026-10-19 inclusive is strictly 232 calendar days
            const allHtml = buildCalendarTabContent(store, 2026, 10, {
                periodMode: 'all',
                now: localDate(2026, 10, 20),
                language: 'en',
            });
            expect(allHtml).toContain('232d');

            // Non-interactive <div> bars must NOT carry prohibited aria-label
            expect(octWeeklyHtml).not.toMatch(/<div class="cal-bar-row[^"]*"[^>]*aria-label=/);

            // Daily view legend and day token breakdown carry role="group" with aria-label
            const dailyHtml = buildCalendarTabContent(store, 2026, 10, {
                periodMode: 'daily',
                selectedDate: '2026-10-19',
                now: localDate(2026, 10, 20),
                language: 'en',
            });
            expect(dailyHtml).toContain('<div class="cal-hm-legend" role="group" aria-label=');
            expect(dailyHtml).toContain('<div class="cal-token-breakdown" role="group" aria-label=');
        });
    });
});

describe('[cli-usage-scanner-unit]', () => {
    // ─── Minimal Protobuf Encoder for Testing CLI SQLite Blobs ───────────────────

    function encodeVarint(value: number): number[] {
        const out: number[] = [];
        let v = Math.floor(value);
        while (v >= 0x80) {
            out.push((v & 0x7f) | 0x80);
            v = Math.floor(v / 128);
        }
        out.push(v & 0x7f);
        return out;
    }


    function pbVarint(fn: number, value: number): Buffer {
        return Buffer.from([...encodeVarint((fn << 3) | 0), ...encodeVarint(value)]);
    }


    function pbBytes(fn: number, payload: Buffer | string): Buffer {
        const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
        return Buffer.concat([Buffer.from([...encodeVarint((fn << 3) | 2), ...encodeVarint(buf.length)]), buf]);
    }


    function buildTestGenMetadataBlob(opts: {
        executionId?: string;
        stepIndices?: number[];
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
        thinkingTokens?: number;
        responseModel?: string;
        modelDisplayName?: string;
        createdAtSec?: number;
        ttftSec?: number;
        ttftNanos?: number;
        streamSec?: number;
        streamNanos?: number;
    }): Buffer {
        const usageParts: Buffer[] = [
            pbVarint(1, 1437),
            pbVarint(2, opts.inputTokens),
            pbVarint(3, opts.outputTokens),
        ];
        if (opts.cacheCreationTokens) { usageParts.push(pbVarint(4, opts.cacheCreationTokens)); }
        if (opts.cacheReadTokens) { usageParts.push(pbVarint(5, opts.cacheReadTokens)); }
        if (opts.thinkingTokens) { usageParts.push(pbVarint(9, opts.thinkingTokens)); }

        const cmParts: Buffer[] = [
            pbBytes(4, Buffer.concat(usageParts)),
        ];
        if (opts.createdAtSec) {
            const tsMsg = pbVarint(1, opts.createdAtSec);
            const csmMsg = pbBytes(4, tsMsg);
            cmParts.push(pbBytes(9, csmMsg));
        }
        if (opts.ttftSec !== undefined || opts.ttftNanos !== undefined) {
            const parts: Buffer[] = [];
            if (opts.ttftSec) { parts.push(pbVarint(1, opts.ttftSec)); }
            if (opts.ttftNanos) { parts.push(pbVarint(2, opts.ttftNanos)); }
            cmParts.push(pbBytes(11, Buffer.concat(parts)));
        }
        if (opts.streamSec !== undefined || opts.streamNanos !== undefined) {
            const parts: Buffer[] = [];
            if (opts.streamSec) { parts.push(pbVarint(1, opts.streamSec)); }
            if (opts.streamNanos) { parts.push(pbVarint(2, opts.streamNanos)); }
            cmParts.push(pbBytes(12, Buffer.concat(parts)));
        }
        if (opts.responseModel) { cmParts.push(pbBytes(19, opts.responseModel)); }
        if (opts.modelDisplayName) { cmParts.push(pbBytes(21, opts.modelDisplayName)); }

        const topParts: Buffer[] = [
            pbBytes(1, Buffer.concat(cmParts)),
        ];
        if (opts.stepIndices && opts.stepIndices.length > 0) {
            const packed = Buffer.from(opts.stepIndices.flatMap(encodeVarint));
            topParts.push(pbBytes(2, packed));
        }
        if (opts.executionId) {
            topParts.push(pbBytes(4, opts.executionId));
        }
        return Buffer.concat(topParts);
    }


    const tempDirs: string[] = [];


    function makeTempDir(prefix = 'acm-cli-test-'): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        tempDirs.push(dir);
        return dir;
    }


    afterEach(() => {
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop()!;
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });


    // ─── Tests ───────────────────────────────────────────────────────────────────

    describe('resolveDefaultCliDataDir', () => {
        it('resolves cross-platform defaults and honors ANTIGRAVITY_CLI_DATA_DIR override', () => {
            expect(resolveDefaultCliDataDir({ ANTIGRAVITY_CLI_DATA_DIR: '/custom/cli/dir' }))
                .toBe(path.resolve('/custom/cli/dir'));
            expect(resolveDefaultCliDataDir({ HOME: '/Users/alice' }))
                .toBe(path.join('/Users/alice', '.gemini', 'antigravity-cli'));
            expect(resolveDefaultCliDataDir({ USERPROFILE: 'C:\\Users\\Bob' }))
                .toBe(path.join('C:\\Users\\Bob', '.gemini', 'antigravity-cli'));
        });
    });


    describe('CliUsageScanner — read-only, resilient, mtime+size cached', () => {
        it('returns empty gracefully and never throws when CLI directory is missing', () => {
            const scanner = new CliUsageScanner();
            const missing = path.join(os.tmpdir(), `nonexistent-agy-cli-${Date.now()}`);
            const res = scanner.scan({ cliRootDir: missing });

            expect(res.available).toBe(false);
            expect(res.days).toEqual([]);
            expect(res.filesScanned).toBe(0);
            expect(res.errorsSkipped).toBe(0);
        });

        it('scans JSONL/JSON CLI usage files, caches by mtime+size, and invalidates on edit', () => {
            const root = makeTempDir();
            const logsDir = path.join(root, 'brain', 'sess-1', '.system_generated', 'logs');
            fs.mkdirSync(logsDir, { recursive: true });
            const transcriptPath = path.join(logsDir, 'transcript.jsonl');

            const ts1 = new Date(2026, 10, 20, 10, 0, 0).toISOString();
            const ts2 = new Date(2026, 10, 20, 11, 0, 0).toISOString();

            const lines = [
                JSON.stringify({ type: 'USER_INPUT', created_at: ts1, content: 'hello' }),
                'malformed json line that should be skipped gracefully',
                JSON.stringify({
                    execution_id: 'cli-exec-1',
                    created_at: ts1,
                    model: 'gemini-4-neon',
                    usage: {
                        input_tokens: 100_000,
                        cache_read_tokens: 400_000,
                        cache_creation_tokens: 20_000,
                        output_tokens: 50_000,
                        thinking_tokens: 10_000,
                    },
                    ttft_seconds: 0.8,
                    streaming_seconds: 2.0,
                }),
                // Duplicate execution_id must be deduped!
                JSON.stringify({
                    execution_id: 'cli-exec-1',
                    created_at: ts1,
                    model: 'gemini-4-neon',
                    usage: { input_tokens: 100_000, output_tokens: 50_000 },
                }),
            ];
            fs.writeFileSync(transcriptPath, lines.join('\n'), 'utf8');

            const scanner = new CliUsageScanner();
            const now = new Date(2026, 10, 21, 12, 0, 0);

            const r1 = scanner.scan({ cliRootDir: root, now, disableSqlite: true });
            expect(r1.available).toBe(true);
            expect(r1.filesScanned).toBe(1);
            expect(r1.cacheMisses).toBe(1);
            expect(r1.cacheHits).toBe(0);
            expect(r1.days).toHaveLength(1);

            const day = r1.days[0];
            expect(day.date).toBe('2026-11-20');
            expect(day.surface).toBe('cli');
            expect(day.calls).toBe(1);
            expect(day.sessions).toBe(1);
            expect(day.inputTokens).toBe(100_000);
            expect(day.cacheReadTokens).toBe(400_000);
            expect(day.cacheCreationTokens).toBe(20_000);
            expect(day.outputTokens).toBe(50_000);
            expect(day.thinkingTokens).toBe(10_000);
            // Additive: 100k + 400k + 20k + 50k = 570k (thinking is subset of output, NOT double-added)
            expect(day.totalTokens).toBe(570_000);
            // Neon pricing: $3/M in + $15/M out (40k visible + 10k thinking) + $0.15/M cacheRead
            // = 0.30 + 0.75 + 0.06 = 1.11
            expect(day.estimatedCost).toBeCloseTo(1.11, 6);

            // Scan 2 without edits -> 100% cache hit
            const r2 = scanner.scan({ cliRootDir: root, now, disableSqlite: true });
            expect(r2.cacheHits).toBe(1);
            expect(r2.cacheMisses).toBe(0);
            expect(r2.days[0].calls).toBe(1);

            // Append second call -> size changes -> cache miss & picks up new call
            fs.appendFileSync(transcriptPath, '\n' + JSON.stringify({
                executionId: 'cli-exec-2',
                createdAt: ts2,
                responseModel: 'claude-sonnet-4-6',
                usageMetadata: {
                    promptTokenCount: 20_000,
                    cachedContentTokenCount: 80_000,
                    candidatesTokenCount: 10_000,
                },
            }), 'utf8');

            const r3 = scanner.scan({ cliRootDir: root, now, disableSqlite: true });
            expect(r3.cacheHits).toBe(0);
            expect(r3.cacheMisses).toBe(1);
            expect(r3.days[0].calls).toBe(2);
            expect(r3.days[0].totalTokens).toBe(570_000 + 110_000);

            // Verify DailyRecord conversion keeps additive tokens & cli surface
            const dailyRec = cliDayRecordToDailyRecord(r3.days[0]);
            expect(dailyRec.date).toBe('2026-11-20');
            expect(dailyRec.cycles[0].surface).toBe('cli');
            expect(dailyRec.cycles[0].gmTotalAllTokens).toBe(680_000);
        });

        it('enforces bounded LRU cache eviction cleanly', () => {
            const root = makeTempDir();
            const usageDir = path.join(root, 'usage');
            fs.mkdirSync(usageDir, { recursive: true });
            const ts = new Date(2026, 10, 15, 10, 0, 0).toISOString();
            for (let i = 0; i < 60; i++) {
                fs.writeFileSync(path.join(usageDir, `s-${i}.jsonl`), JSON.stringify({
                    id: `c-${i}`,
                    createdAt: ts,
                    model: 'gemini-4-neon',
                    usage: { inputTokens: 1000, outputTokens: 200 },
                }), 'utf8');
            }
            const scanner = new CliUsageScanner(50);
            const res = scanner.scan({ cliRootDir: root, now: new Date(2026, 10, 20), disableSqlite: true });
            expect(res.filesScanned).toBe(60);
            expect(scanner.cacheSize).toBeLessThanOrEqual(50);
            expect(res.days[0].calls).toBe(60);
        });

        it('W1A-FIX-8 #5: distinguishes unavailable, empty, unsupported, and busy statuses cleanly', async () => {
            const scanner = new CliUsageScanner();
            const now = new Date(2026, 10, 20, 12, 0, 0);

            // 1. Missing directory -> 'unavailable'
            const missingRes = scanner.scan({ cliRootDir: path.join(os.tmpdir(), `missing-cli-${Date.now()}`), now });
            expect(missingRes.status).toBe('unavailable');
            expect(missingRes.available).toBe(false);

            // 2. Existing directory with zero usage files -> 'empty'
            const emptyRoot = makeTempDir('acm-empty-');
            const emptyRes = scanner.scan({ cliRootDir: emptyRoot, now });
            expect(emptyRes.status).toBe('empty');
            expect(emptyRes.available).toBe(true);
            expect(emptyRes.days).toEqual([]);

            // 3. SQLite DB present when node:sqlite is unsupported -> 'unsupported'
            const unsupportedRoot = makeTempDir('acm-unsupported-');
            const convDir = path.join(unsupportedRoot, 'conversations');
            fs.mkdirSync(convDir, { recursive: true });
            fs.writeFileSync(path.join(convDir, 's1.db'), Buffer.from('SQLite format 3\0'));
            const unsupportedRes = scanner.scan({
                cliRootDir: unsupportedRoot,
                now,
                sqliteOpen: null,
            });
            expect(unsupportedRes.status).toBe('unsupported');
            expect(unsupportedRes.available).toBe(true);

            // 4. Transient SQLITE_BUSY -> 'busy' (and preserves prior complete results when available!)
            const busyRoot = makeTempDir('acm-busy-');
            const busyConvDir = path.join(busyRoot, 'conversations');
            fs.mkdirSync(busyConvDir, { recursive: true });
            const busyDbPath = path.join(busyConvDir, 's-busy.db');
            fs.writeFileSync(busyDbPath, Buffer.from('SQLite format 3\0'));

            const tsSec = Math.floor(new Date(2026, 10, 20, 10, 0, 0).getTime() / 1000);
            const goodBlob = buildTestGenMetadataBlob({
                executionId: 'busy-baseline-1',
                inputTokens: 5_000,
                outputTokens: 1_000,
                responseModel: 'gemini-4-neon',
                createdAtSec: tsSec,
            });
            const busyScanner = new CliUsageScanner();
            const goodRes = busyScanner.scan({
                cliRootDir: busyRoot,
                now,
                sqliteOpen: () => ({
                    prepare: (sql: string) => ({
                        all: (...args: unknown[]) => {
                            if (sql.includes('gen_metadata')) {
                                const lastIdx = typeof args[0] === 'number' ? args[0] : -1;
                                return lastIdx < 0 ? [{ idx: 0, data: goodBlob }] : [];
                            }
                            return [];
                        },
                    }),
                    close: () => {},
                }),
            });
            expect(goodRes.status).toBe('ok');
            expect(goodRes.days[0].calls).toBe(1);

            // Touch mtime so next scan re-opens and hits persistent SQLITE_BUSY
            const later = new Date(now.getTime() + 5_000);
            fs.utimesSync(busyDbPath, later, later);
            const busyRes = await busyScanner.scanAsync({
                cliRootDir: busyRoot,
                now,
                sqliteOpen: () => {
                    throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
                },
            });
            expect(busyRes.status).toBe('busy');
            expect(busyRes.preservedLastComplete).toBe(true);
            expect(busyRes.days[0].calls).toBe(1);

            // A disconnected volume must retain the same last complete day through both entrypoints.
            const offline = path.join(makeTempDir(), 'offline');
            fs.renameSync(busyRoot, offline);
            for (const result of [
                busyScanner.scan({ cliRootDir: busyRoot, now }),
                await busyScanner.scanAsync({ cliRootDir: busyRoot, now }),
            ]) {
                expect(result.available).toBe(false);
                expect(result.status).toBe('unavailable');
                expect(result.preservedLastComplete).toBe(true);
                expect(result.days).toEqual(goodRes.days);
            }
        });

        it('W1A-FIX-8 #5: decodes multibyte UTF-8 JSONL lines split across 64KB chunk boundaries without U+FFFD corruption', async () => {
            const root = makeTempDir('acm-utf8-chunk-');
            const logsDir = path.join(root, 'brain', 'sess-utf8', '.system_generated', 'logs');
            fs.mkdirSync(logsDir, { recursive: true });
            const jsonlPath = path.join(logsDir, 'transcript.jsonl');

            const ts = new Date(2026, 10, 20, 14, 0, 0).toISOString();
            const padLine = JSON.stringify({ type: 'PAD', note: 'a'.repeat(1000) });
            const lines: string[] = [];
            let byteLen = 0;
            // Fill right up near the 65536-byte (64KB) chunk boundary
            while (byteLen + Buffer.byteLength(padLine + '\n', 'utf8') < 65_420) {
                lines.push(padLine);
                byteLen += Buffer.byteLength(padLine + '\n', 'utf8');
            }

            // Construct a record whose 3-byte UTF-8 CJK characters ("模型测试") and 4-byte emoji ("🚀") straddle byte 65536!
            const targetModel = 'Custom-模型测试-🚀-Model';
            const prefixTemplate = `{"execution_id":"utf8-boundary-1","created_at":"${ts}","model":"${targetModel}","pad":"`;
            const suffixTemplate = `","usage":{"input_tokens":1234,"output_tokens":567}}`;
            // Position the targetModel bytes right across byte 65536 by padding the preceding line
            const prefixBeforeModel = `{"execution_id":"utf8-boundary-1","created_at":"${ts}","model":"Custom-`;
            const gapNeeded = 65_535 - byteLen - Buffer.byteLength(prefixBeforeModel, 'utf8');
            expect(gapNeeded).toBeGreaterThan(20);
            const spacer = JSON.stringify({ type: 'SPACER', p: 'x'.repeat(gapNeeded - 27) });
            lines.push(spacer);
            byteLen += Buffer.byteLength(spacer + '\n', 'utf8');
            // Verify byte 65535..65537 lands right inside the multibyte "模" (3 bytes: E6 A8 A1)
            const targetLine = `${prefixTemplate}ok${suffixTemplate}`;
            const modelStartOffset = byteLen + Buffer.byteLength(prefixBeforeModel, 'utf8');
            expect(modelStartOffset).toBeLessThanOrEqual(65_536);
            expect(modelStartOffset + Buffer.byteLength('模型测试-🚀', 'utf8')).toBeGreaterThan(65_536);
            lines.push(targetLine);
            fs.writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf8');

            const now = new Date(2026, 10, 20, 15, 0, 0);
            const syncRes = new CliUsageScanner().scan({ cliRootDir: root, now, disableSqlite: true });
            expect(syncRes.status).toBe('ok');
            expect(syncRes.days).toHaveLength(1);
            expect(syncRes.days[0].calls).toBe(1);
            const syncModelKeys = Object.keys(syncRes.days[0].models);
            expect(syncModelKeys).toEqual([targetModel]);
            expect(syncModelKeys[0]).not.toContain('\uFFFD');

            const asyncRes = await new CliUsageScanner().scanAsync({ cliRootDir: root, now, disableSqlite: true });
            expect(asyncRes.status).toBe('ok');
            expect(Object.keys(asyncRes.days[0].models)).toEqual([targetModel]);
        });
    });


    describe('Multi-Currency Engine & Subscription ROI Estimator', () => {
        it('supports all 10 required currency presets (incl. CAD) and custom FX rate overrides', () => {
            expect(CURRENCY_CODES).toEqual(['USD', 'CNY', 'EUR', 'JPY', 'GBP', 'KRW', 'HKD', 'TWD', 'CAD', 'AUD']);
            for (const code of CURRENCY_CODES) {
                const preset = CURRENCY_PRESETS[code];
                expect(preset.defaultRatePerUsd).toBeGreaterThan(0);
                expect(formatCurrencyAmount(10, code)).toContain(preset.symbol);
            }

            // Default USD formatting matches standard USD style & disambiguates CAD / AUD / JPY
            expect(formatCurrencyAmount(12.34, 'USD')).toBe('$12.34');
            expect(formatDualCurrencyAmount(12.34, 'USD')).toBe('$12.34');
            expect(formatCurrencyAmount(10, 'CAD')).toBe('CA$13.80');
            expect(formatCurrencyAmount(10, 'AUD')).toBe('A$15.40');
            expect(formatCurrencyAmount(Number.NaN, 'CNY')).toBe('—');
            expect(formatCurrencyAmount(Number.POSITIVE_INFINITY, 'USD')).toBe('—');
            expect(formatCurrencyAmount(0, 'CNY', { zeroAsDash: true })).toBe('—');

            // Custom FX rate override
            const cnyCustom = { code: 'CNY' as const, customRatePerUsd: 7.5 };
            expect(resolveCurrencyConfig(cnyCustom).isCustomRate).toBe(true);
            expect(convertUsdToCurrency(10, cnyCustom)).toBeCloseTo(75, 6);
            expect(convertCurrencyToUsd(75, cnyCustom)).toBeCloseTo(10, 6);
            expect(formatCurrencyAmount(10, cnyCustom)).toBe('¥75.00');
            expect(formatDualCurrencyAmount(10, cnyCustom)).toBe('¥75.00 ($10.00)');

            // Zero-decimal currencies (JPY, KRW) & TWD standard 2dp vs compact 0dp
            expect(formatCurrencyAmount(10, 'JPY')).toBe('JP¥1,540');
            expect(formatCurrencyAmount(10, 'JPY', { mode: 'compact' })).toBe('JP¥1,540');
            expect(formatCurrencyAmount(10, 'KRW')).toBe('₩13,900');
            expect(formatCurrencyAmount(10, 'TWD')).toBe('NT$324.00');
            expect(formatCurrencyAmount(10, 'TWD', { mode: 'compact' })).toBe('NT$324');

            // Invalid custom FX rate falls back cleanly to preset default
            expect(resolveCurrencyConfig({ code: 'EUR', customRatePerUsd: -2 }).ratePerUsd).toBe(CURRENCY_PRESETS.EUR.defaultRatePerUsd);
        });

        it('computes prorated Subscription Plan ROI with honest disclaimer and supports Pro / Ultra 5x / Ultra 20x + legacy migration', () => {
            expect(SUBSCRIPTION_PLAN_PRESET_ORDER).toEqual([
                'none',
                'google-ai-pro',
                'google-ai-ultra-5x',
                'google-ai-ultra-20x',
                'custom',
            ]);
            expect(SUBSCRIPTION_PLAN_PRESETS['google-ai-pro'].monthlyUsd).toBe(19.99);
            expect(SUBSCRIPTION_PLAN_PRESETS['google-ai-ultra-5x'].monthlyUsd).toBe(99.99);
            expect(SUBSCRIPTION_PLAN_PRESETS['google-ai-ultra-20x'].monthlyUsd).toBe(199.99);

            expect(isSubscriptionPlanPresetId('google-ai-pro')).toBe(true);
            expect(isSubscriptionPlanPresetId('google-ai-ultra-5x')).toBe(true);
            expect(isSubscriptionPlanPresetId('google-ai-ultra-20x')).toBe(true);
            expect(isSubscriptionPlanPresetId('google-ai-ultra')).toBe(false);

            // Centralized normalization & backward-compatible legacy 'google-ai-ultra' migration
            expect(normalizeSubscriptionPlanId('google-ai-pro')).toBe('google-ai-pro');
            expect(normalizeSubscriptionPlanId('google-ai-ultra-5x')).toBe('google-ai-ultra-5x');
            expect(normalizeSubscriptionPlanId('google-ai-ultra-20x')).toBe('google-ai-ultra-20x');
            expect(normalizeSubscriptionPlanId('google-ai-ultra')).toBe('google-ai-ultra-20x');
            expect(normalizeSubscriptionPlanId('google-ai-ultra', 249.99)).toBe('google-ai-ultra-20x');
            expect(normalizeSubscriptionPlanId('google-ai-ultra', 99.99)).toBe('google-ai-ultra-5x');
            expect(normalizeSubscriptionPlanId('', 19.99)).toBe('google-ai-pro');
            expect(normalizeSubscriptionPlanId('', 99.99)).toBe('google-ai-ultra-5x');
            expect(normalizeSubscriptionPlanId('', 199.99)).toBe('google-ai-ultra-20x');
            expect(normalizeSubscriptionPlanId('', 49.0)).toBe('custom');
            expect(normalizeSubscriptionPlanId('', null)).toBe('none');

            expect(estimateSubscriptionRoi(50, 30, { planId: 'none' })).toBeNull();
            expect(estimateSubscriptionRoi(50, 30, null)).toBeNull();

            // Google AI Pro ($19.99/mo) over 30 days with $39.98 API reference value -> 2.00x
            const pro = estimateSubscriptionRoi(39.98, 30, { planId: 'google-ai-pro' })!;
            expect(pro.enabled).toBe(true);
            expect(pro.planId).toBe('google-ai-pro');
            expect(pro.proratedFeeUsd).toBeCloseTo(19.99, 4);
            expect(pro.roiMultiple).toBeCloseTo(2.0, 2);
            expect(pro.disclaimerEn).toBe(ROI_DISCLAIMER_EN);
            expect(pro.disclaimerZh).toBe(ROI_DISCLAIMER_ZH);

            // Google AI Ultra 5x ($99.99/mo) over 15 days -> prorated $49.995
            const ultra5x = estimateSubscriptionRoi(99.99, 15, { planId: 'google-ai-ultra-5x' })!;
            expect(ultra5x.planId).toBe('google-ai-ultra-5x');
            expect(ultra5x.planLabelEn).toBe('Google AI Ultra 5x');
            expect(ultra5x.proratedFeeUsd).toBeCloseTo(49.995, 4);
            expect(ultra5x.roiMultiple).toBeCloseTo(2.0, 2);

            // Google AI Ultra 20x ($199.99/mo) over 15 days -> prorated $99.995
            const ultra20x = estimateSubscriptionRoi(199.99, 15, { planId: 'google-ai-ultra-20x' })!;
            expect(ultra20x.planId).toBe('google-ai-ultra-20x');
            expect(ultra20x.planLabelEn).toBe('Google AI Ultra 20x');
            expect(ultra20x.proratedFeeUsd).toBeCloseTo(99.995, 4);
            expect(ultra20x.roiMultiple).toBeCloseTo(2.0, 2);

            // Legacy 'google-ai-ultra' fallback: defaults to Ultra 20x ($199.99/mo),
            // preserves an explicit historical saved fee (e.g. $249.99), or maps ~99.99 -> Ultra 5x
            const legacyDefault = estimateSubscriptionRoi(199.99, 30, {
                planId: 'google-ai-ultra' as unknown as 'google-ai-ultra-20x',
            })!;
            expect(legacyDefault.planId).toBe('google-ai-ultra-20x');
            expect(legacyDefault.monthlyFeeUsd).toBeCloseTo(199.99, 4);
            expect(legacyDefault.roiMultiple).toBeCloseTo(1.0, 2);

            const legacyHistoricalFee = estimateSubscriptionRoi(249.99, 30, {
                planId: 'google-ai-ultra' as unknown as 'google-ai-ultra-20x',
                monthlyFee: 249.99,
                feeCurrency: 'USD',
            })!;
            expect(legacyHistoricalFee.planId).toBe('google-ai-ultra-20x');
            expect(legacyHistoricalFee.monthlyFeeUsd).toBeCloseTo(249.99, 4);

            const legacy5x = estimateSubscriptionRoi(99.99, 30, {
                planId: 'google-ai-ultra' as unknown as 'google-ai-ultra-5x',
                monthlyFee: 99.99,
                feeCurrency: 'USD',
            })!;
            expect(legacy5x.planId).toBe('google-ai-ultra-5x');
            expect(legacy5x.monthlyFeeUsd).toBeCloseTo(99.99, 4);

            // Custom plan in user's local currency (CNY 145 @ 7.25 = $20 USD/mo)
            const custom = estimateSubscriptionRoi(60, 30, {
                planId: 'custom',
                monthlyFee: 145,
                feeCurrency: 'CNY',
                customRatePerUsd: 7.25,
            })!;
            expect(custom.monthlyFeeUsd).toBeCloseTo(20, 4);
            expect(custom.roiMultiple).toBeCloseTo(3.0, 2);
        });
    });


    describe('Pure CSV & JSON Export Builders and Streaks', () => {
        const sampleDays: CalendarExportDayRow[] = [
            {
                date: '2026-11-19',
                sources: ['app', 'cli'],
                calls: 12,
                cycles: 2,
                inputTokens: 40_000,
                cacheReadTokens: 120_000,
                cacheCreationTokens: 10_000,
                outputTokens: 30_000,
                thinkingTokens: 8_000,
                totalTokens: 200_000,
                estimatedCostUsd: 1.25,
                credits: 4,
                avgTTFT: 0.65,
                avgGenTokPerSec: 72.4,
                cacheHitRate: 120_000 / 170_000,
                models: {
                    'Gemini 4 Neon (High)': {
                        calls: 12,
                        inputTokens: 40_000,
                        cacheReadTokens: 120_000,
                        cacheCreationTokens: 10_000,
                        outputTokens: 30_000,
                        thinkingTokens: 8_000,
                        totalTokens: 200_000,
                        estimatedCostUsd: 1.25,
                        credits: 4,
                    },
                },
            },
            {
                date: '2026-11-20',
                sources: ['ide'],
                calls: 5,
                cycles: 1,
                inputTokens: 10_000,
                cacheReadTokens: 40_000,
                cacheCreationTokens: 0,
                outputTokens: 10_000,
                thinkingTokens: 0,
                totalTokens: 60_000,
                estimatedCostUsd: 0.5,
                credits: 1,
                isLive: true,
                models: {
                    '=SUM(A1:A2),Evil': {
                        calls: 5,
                        inputTokens: 10_000,
                        cacheReadTokens: 40_000,
                        cacheCreationTokens: 0,
                        outputTokens: 10_000,
                        thinkingTokens: 0,
                        totalTokens: 60_000,
                        estimatedCostUsd: 0.5,
                        credits: 1,
                    },
                },
            },
        ];

        it('builds valid JSON export with summary, dual currency, streaks, and ROI', () => {
            const jsonStr = buildCalendarExportJson([...sampleDays].reverse(), {
                exportedAt: '2026-11-20T12:00:00.000Z',
                sourceFilter: 'all',
                periodMode: 'daily',
                rangeStart: '2026-11-11',
                rangeEnd: '2026-11-20',
                currency: { code: 'CNY', customRatePerUsd: 7.2 },
                subscription: { planId: 'google-ai-pro' },
            });

            const parsed = JSON.parse(jsonStr);
            expect(parsed.schemaVersion).toBe(1);
            expect(parsed.days.map((d: { date: string }) => d.date)).toEqual(['2026-11-19', '2026-11-20']);
            expect(parsed.summary.activeDays).toBe(2);
            expect(parsed.summary.spanDays).toBe(10);
            expect(parsed.summary.totalTokens).toBe(260_000);
            expect(parsed.summary.estimatedCostUsd).toBeCloseTo(1.75, 5);
            expect(parsed.summary.estimatedCostLocal).toBeCloseTo(1.75 * 7.2, 4);
            expect(parsed.summary.calendarDailyAvgTokens).toBe(26_000);
            expect(parsed.summary.activeDayAvgTokens).toBe(130_000);
            expect(parsed.summary.currentStreakDays).toBe(2);
            expect(parsed.summary.longestStreakDays).toBe(2);
            expect(parsed.summary.peakDay.date).toBe('2026-11-19');
            expect(parsed.summary.subscriptionRoi.planId).toBe('google-ai-pro');
            expect(parsed.summary.subscriptionRoi.disclaimer).toBe(ROI_DISCLAIMER_EN);
        });

        it('builds RFC 4180 CSV export with proper quoting and formula-injection guard', () => {
            const csv = buildCalendarExportCsv(sampleDays, {
                currency: { code: 'CNY', customRatePerUsd: 7.0 },
            });
            const lines = csv.trim().split('\n');
            expect(lines).toHaveLength(3);
            expect(lines[0]).toContain('date,sources,is_live,calls,cycles,total_tokens');
            expect(lines[1]).toContain('2026-11-19,app|cli,false,12,2,200000,40000,120000,10000,30000,8000,1.250000,CNY,8.7500');
            // Malicious model name starting with '=' and containing ',' must be prefixed with '\'' and quoted
            expect(lines[2]).toContain(`"'=SUM(A1:A2),Evil:60000"`);

            // Empty days emits header row only
            const emptyCsv = buildCalendarExportCsv([]);
            expect(emptyCsv.trim().split('\n')).toHaveLength(1);
        });

        it('computes current and longest streaks accurately across gaps and yesterday continuation', () => {
            expect(computeActivityStreaks([], '2026-11-20')).toEqual({ currentStreak: 0, longestStreak: 0 });
            expect(computeActivityStreaks(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-18', '2026-11-19'], '2026-11-20'))
                .toEqual({ currentStreak: 2, longestStreak: 3 });
            expect(computeActivityStreaks(['2026-11-10', '2026-11-11'], '2026-11-20'))
                .toEqual({ currentStreak: 0, longestStreak: 2 });
        });

        it('aggregates CLI calls cleanly via aggregateCliCallsByDay', () => {
            const days = aggregateCliCallsByDay([
                {
                    callId: 'c1',
                    sessionId: 's1',
                    dateKey: '2026-11-15',
                    createdAtMs: new Date(2026, 10, 15, 9, 0).getTime(),
                    modelKey: 'Gemini 4 Neon (High)',
                    responseModel: 'gemini-4-neon',
                    inputTokens: 1000,
                    outputTokens: 500,
                    thinkingTokens: 100,
                    cacheReadTokens: 4000,
                    cacheCreationTokens: 500,
                    credits: 1,
                    ttftSeconds: 0.5,
                    streamingSeconds: 2.0,
                },
            ]);
            expect(days).toHaveLength(1);
            expect(days[0].totalTokens).toBe(computeAdditiveTokens({
                inputTokens: 1000,
                outputTokens: 500,
                cacheReadTokens: 4000,
                cacheCreationTokens: 500,
            }));
            expect(days[0].models['Gemini 4 Neon (High)'].avgGenTokPerSec).toBeCloseTo(250, 4);
        });
    });
});

describe('[agy-statusline]', () => {
    const REPO_ROOT = path.resolve(__dirname, '..');

    const BUNDLED_STATUSLINE_PATH = path.join(REPO_ROOT, 'app-plugin', 'bin', 'agy-statusline.mjs');


    // ─── Redacted Versioned `agy` CLI (v1.4.5 / v1.5.18) Stdin JSON Fixtures ─────

    const FIXTURE_V1_5_FULL: AgyStatusLinePayload = {
        cwd: '/home/developer/workspace/antigravity-demo',
        session_id: '12345678-abcd-ef01-2345-6789abcdef01',
        conversation_id: '12345678-abcd-ef01-2345-6789abcdef01',
        transcript_path: '/home/developer/.gemini/antigravity/brain/12345678-abcd-ef01-2345-6789abcdef01/.system_generated/logs/transcript.jsonl',
        conversation_title: 'Audit bundle compaction and CLI status line',
        model: {
            id: 'Gemini 4 Argon (Medium)',
            display_name: 'Gemini 4 Argon (Medium)',
            effort: 'medium',
        },
        workspace: {
            current_dir: '/home/developer/workspace/antigravity-demo',
            project_dir: '/home/developer/workspace/antigravity-demo',
        },
        version: '1.5.18',
        context_window: {
            total_input_tokens: 88244,
            total_output_tokens: 61074,
            context_window_size: 1048576,
            used_percentage: 14.24,
            remaining_percentage: 85.76,
            current_usage: {
                input_tokens: 63382,
                output_tokens: 346,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 20857,
            },
        },
        exceeds_200k_tokens: false,
        product: 'antigravity',
        quota: {
            'gemini-weekly': {
                remaining_fraction: 0.9378,
                reset_time: '2026-07-06T07:50:32Z',
                reset_in_seconds: 560580,
            },
            'claude-5h': {
                remaining_fraction: 0.41,
                reset_in_seconds: 3600,
            },
            'disabled-bucket': {
                remaining_fraction: 0.01,
                disabled: true,
            },
        },
        agent_state: 'idle',
        vcs: { type: 'git' },
        cycle_mode: 'plan',
        sandbox: { enabled: true },
        subagents: [
            { name: 'verifier', role: 'worker', status: 'running' },
            { name: 'lint-check', role: 'worker', status: 'completed' },
        ],
        artifact_count: 2,
        plan_tier: 'Pro',
        email: 'sentinel-redacted@private.example',
        task_count: 1,
        terminal_width: 140,
        cost: {
            total_usd: 0.4213,
            subagent_usd: 0.08,
            estimated: false,
        },
    };


    const FIXTURE_V1_5_MINIMAL: AgyStatusLinePayload = {
        cwd: '/tmp/minimal-proj',
        version: '1.5.18',
        model: { id: 'gemini-4-pro', display_name: 'Gemini 4 Pro' },
    };


    const FIXTURE_V1_5_MISSING_COST_AND_LIMIT: AgyStatusLinePayload = {
        conversation_id: 'aaaa1111-bbbb-2222-cccc-3333dddd4444',
        model: { display_name: 'Gemini 4 Flash' },
        workspace: { project_dir: '/Users/dev/unknown-cap-repo' },
        context_window: {
            context_window_size: 0,
            current_usage: null,
        },
    };


    const FIXTURE_V1_5_FRESH_ZERO_STEP: AgyStatusLinePayload = {
        conversation_id: '00000000-0000-0000-0000-000000000001',
        model: { display_name: 'Gemini 4 Argon' },
        workspace: { project_dir: '/Users/dev/fresh-repo' },
        context_window: {
            total_input_tokens: 0,
            total_output_tokens: 0,
            context_window_size: 1048576,
            used_percentage: 0,
            current_usage: null,
        },
    };


    const FIXTURE_V1_5_DUAL_CAP_OVERFLOW: AgyStatusLinePayload = {
        conversation_id: '99999999-aaaa-bbbb-cccc-dddddddddddd',
        model: { display_name: 'Gemini 4 Pro' },
        workspace: { project_dir: '/Users/dev/heavy-repo' },
        context_window: {
            compaction_limit: 512000,
            context_window_size: 1048576,
            used_tokens: 573440,
        },
        exceeds_200k_tokens: true,
        cost: { total_usd: 2.345 },
    };


    const FIXTURE_MALICIOUS_CONTROL_INJECTION: AgyStatusLinePayload = {
        conversation_id: 'bad-id\n\x1b[31m',
        conversation_title: 'Title\x1b]0;HACKED-TERM-TITLE\x07\nSecondLine\r\n\u202eReversed',
        model: {
            display_name: '\x1b[31;1mEvil\x1b[2JModel\x9b41m\nInjected',
        },
        workspace: {
            project_dir: '/tmp/\x1bP1$r\x1b\\bad\x00dir\nrepo',
        },
        agent_state: 'working\n\x1b[5m',
        email: 'never-leak-me@corp.example',
        context_window: {
            context_window_size: 200000,
            current_usage: { input_tokens: 40000 },
        },
        cost: { total_usd: 0.004 },
    };


    describe('Opt-In Read-Only agy-statusline.mjs CLI (§5.2 #7)', () => {
        it('formats full official agy v1.5 payload using context-display.ts + currency.ts without leaking email/transcript_path', () => {
            const obs = buildStatusLineObservation(FIXTURE_V1_5_FULL);
            // current_usage: 63382 + 20857 = 84239 / 1048576 = 8.033% -> rounds to 8.0% ('8%')
            expect(obs.usedTokens).toBe(84239);
            expect(obs.primaryLimit).toBe(1048576);
            expect(obs.primaryPct).toBe(8);
            expect(obs.isIncomplete).toBe(false);
            expect(obs.healthStatus).toBe('healthy');

            const plain = formatStatusLine(FIXTURE_V1_5_FULL, { color: false, showTitle: true });
            expect(plain).not.toContain('\n');
            expect(plain).not.toContain('\r');
            expect(plain).not.toContain('\x1b');
            expect(plain).toContain('Gemini 4 Argon (Medium)');
            expect(plain).toContain('Ctx 8% (84.2k/1M)');
            expect(plain).toContain('$0.42');
            expect(plain).toContain('Q 41%'); // tightest non-disabled quota bucket (ignores disabled 1% bucket)
            expect(plain).toContain('sub:1');
            expect(plain).toContain('antigravity-demo');
            expect(plain).not.toContain('sentinel-redacted@private.example');
            expect(plain).not.toContain('transcript.jsonl');
        });

        it('emits explicit unavailable markers (—) when context limits, usage, or cost are absent (never fakes 0% or cached App data)', () => {
            const minimal = formatStatusLine(FIXTURE_V1_5_MINIMAL, { color: false });
            expect(minimal).toContain('Gemini 4 Pro');
            expect(minimal).toContain(`Ctx ${UNAVAILABLE_MARKER}`);
            expect(minimal).toContain(`Cost ${UNAVAILABLE_MARKER}`);
            expect(minimal).toContain('minimal-proj');
            expect(minimal).not.toContain('0%');
            expect(minimal).not.toContain('$0.00');

            const zeroCap = formatStatusLine(FIXTURE_V1_5_MISSING_COST_AND_LIMIT, { color: false });
            expect(zeroCap).toContain(`Ctx ${UNAVAILABLE_MARKER}`);
            expect(zeroCap).toContain(`Cost ${UNAVAILABLE_MARKER}`);
            expect(zeroCap).not.toContain('0%');

            const nullPayload = formatStatusLine(null, { color: false });
            expect(nullPayload).toBe(`ACM | Ctx ${UNAVAILABLE_MARKER} | Cost ${UNAVAILABLE_MARKER}`);
        });

        it('renders confirmed 0-step fresh sessions as 0% and preserves >100% overflow + dual-cap compaction warnings', () => {
            const fresh = formatStatusLine(FIXTURE_V1_5_FRESH_ZERO_STEP, { color: false });
            expect(fresh).toContain('Ctx 0% (0/1M)');
            expect(fresh).toContain(`Cost ${UNAVAILABLE_MARKER}`);

            const overflowCompaction = formatStatusLine(FIXTURE_V1_5_DUAL_CAP_OVERFLOW, {
                basis: 'compaction',
                color: false,
            });
            expect(overflowCompaction).toContain('Ctx 112% (573k/512k)');
            expect(overflowCompaction).toContain('$2.35');
            expect(overflowCompaction).toContain('200k+');

            const overflowNative = buildStatusLineObservation(FIXTURE_V1_5_DUAL_CAP_OVERFLOW, { basis: 'native' });
            expect(overflowNative.actualBasis).toBe('native');
            expect(overflowNative.primaryPct).toBe(54.7);
            // Compaction warning MUST remain active even when requestedBasis === 'native'
            expect(overflowNative.compactionWarningActive).toBe(true);
            expect(overflowNative.compactionWarningLevel).toBe('overflow');
            expect(overflowNative.healthStatus).toBe('overflow');
        });

        it('keeps the agy percentage-derived token count independent of display basis', () => {
            const payload = { context_window: { used_percentage: 25, context_window_size: 200_000, compaction_limit: 100_000, current_usage: {} } };
            const native = buildStatusLineObservation(payload, { basis: 'native' });
            const compaction = buildStatusLineObservation(payload, { basis: 'compaction' });
            expect(native.usedTokens).toBe(50_000);
            expect(compaction.usedTokens).toBe(native.usedTokens);
            expect(native.primaryPct).toBe(25);
            expect(compaction.primaryPct).toBe(50);
            const missing = buildStatusLineObservation({ context_window: { used_percentage: 25, compaction_limit: 100_000 } });
            expect(missing.isIncomplete).toBe(true);
            expect(parseStatusLineArgs(['--timeout-ms', '4000'], {}).timeoutMs).toBe(1500);
            expect(parseStatusLineArgs(['--timeout-ms=4000'], {}).timeoutMs).toBe(1500);

            // P2-10: Missing context capacity must NEVER render fake Ctx 0% even when used_tokens/input_tokens/used_percentage is 0
            for (const unknownCapPayload of [
                { model: { display_name: 'Unknown Model' }, context_window: { used_tokens: 0 } },
                { model: { display_name: 'Unknown Model' }, context_window: { used_percentage: 0, total_input_tokens: 0, total_output_tokens: 0 } },
                { model: { display_name: 'Unknown Model' }, context_window: { current_usage: { input_tokens: 0, cache_read_input_tokens: 0 } } },
            ]) {
                const obs = buildStatusLineObservation(unknownCapPayload);
                expect(obs.isIncomplete).toBe(true);
                expect(obs.isZeroStepFresh).toBe(false);
                expect(obs.primaryPct).toBeNull();
                const rendered = formatStatusLine(unknownCapPayload, { color: false });
                expect(rendered).toContain(`Ctx ${UNAVAILABLE_MARKER}`);
                expect(rendered).not.toContain('Ctx 0%');
            }
        });

        it('strips ALL newlines, CR, OSC, DCS/APC, CSI (7-bit & 8-bit), C0/C1, and bidi controls from untrusted fields', () => {
            expect(sanitizeTerminalText('\x1b]0;evil\x07hello\n\r\tworld\x1b[31m\x9b2J\u202e')).toBe('hello world');

            const line = formatStatusLine(FIXTURE_MALICIOUS_CONTROL_INJECTION, {
                color: false,
                showTitle: true,
            });
            expect(line.split(/\r?\n/)).toHaveLength(1);
            expect(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(line)).toBe(false);
            expect(line).not.toContain('HACKED-TERM-TITLE');
            expect(line).not.toContain('never-leak-me@corp.example');
            expect(line).toContain('EvilModel Injected');
            expect(line).toContain('Ctx 20% (40k/200k)');
            expect(line).toContain('<$0.01'); // dynamic micro-cost threshold from currency.ts
        });

        it('formats all 10 currencies via src/core/currency.ts with symbol disambiguation & decimal rules', () => {
            expect(CURRENCY_CODES).toHaveLength(10);
            const expectedSymbols: Record<string, string> = {
                USD: '$0.42',
                CNY: '¥3.05',
                EUR: '€0.39',
                JPY: 'JP¥65',
                GBP: '£0.33',
                KRW: '₩586',
                HKD: 'HK$3.28',
                TWD: 'NT$14',
                CAD: 'CA$0.58',
                AUD: 'A$0.65',
            };
            for (const code of CURRENCY_CODES) {
                const out = formatStatusLine(FIXTURE_V1_5_FULL, { currency: code, color: false });
                expect(out, `Expected ${expectedSymbols[code]} for ${code}`).toContain(expectedSymbols[code]);
            }
            expect(formatCompactTokenCount(null)).toBe(UNAVAILABLE_MARKER);
            expect(formatCompactTokenCount(950)).toBe('950');
            expect(formatCompactTokenCount(84239)).toBe('84.2k');
            expect(formatCompactTokenCount(1_048_576)).toBe('1M');
        });

        it('enforces 64 KB stdin cap, read timeout, NO_COLOR, redirected non-TTY stdout, and graceful EPIPE exit 0', async () => {
            expect(MAX_STDIN_BYTES).toBe(64 * 1024);

            // 1. Oversized stdin (> 64 KB) truncates safely without hanging or OOM
            const bigStream = new PassThrough();
            const bigPayload = `{"conversation_title":"${'A'.repeat(MAX_STDIN_BYTES + 4096)}"}`;
            bigStream.end(Buffer.from(bigPayload, 'utf8'));
            const bounded = await readBoundedStdin(bigStream, { maxBytes: MAX_STDIN_BYTES, timeoutMs: 1000 });
            expect(bounded.truncated).toBe(true);
            expect(bounded.bytesRead).toBe(MAX_STDIN_BYTES);

            const truncatedChunks: string[] = [];
            const bigStream2 = new PassThrough();
            bigStream2.end(Buffer.from(bigPayload, 'utf8'));
            const outSink = new Writable({
                write(chunk, _enc, cb) {
                    truncatedChunks.push(chunk.toString('utf8'));
                    cb();
                },
            });
            const truncCode = await runStatusLineCli({
                argv: ['--no-color'],
                env: {},
                stdin: bigStream2,
                stdout: outSink,
            });
            expect(truncCode).toBe(0);
            const truncOut = truncatedChunks.join('');
            expect(truncOut).toContain(`Ctx ${UNAVAILABLE_MARKER}`);
            expect(truncOut).toContain('[truncated]');

            // 2. Hanging stdin hits timeout cleanly and emits degraded single line
            const hangingStream = new PassThrough();
            const hangChunks: string[] = [];
            const hangOut = new Writable({
                write(chunk, _enc, cb) {
                    hangChunks.push(chunk.toString('utf8'));
                    cb();
                },
            });
            const startMs = Date.now();
            const hangCode = await runStatusLineCli({
                argv: ['--no-color', '--timeout-ms', '80'],
                env: {},
                stdin: hangingStream,
                stdout: hangOut,
            });
            const elapsedMs = Date.now() - startMs;
            expect(hangCode).toBe(0);
            expect(elapsedMs).toBeLessThan(1000);
            expect(hangChunks.join('').trim()).toBe(`ACM | Ctx ${UNAVAILABLE_MARKER} | Cost ${UNAVAILABLE_MARKER}`);

            // 3. EPIPE on stdout exits cleanly with code 0 (never throws unhandled error)
            const epipeIn = new PassThrough();
            epipeIn.end(JSON.stringify(FIXTURE_V1_5_FULL));
            const epipeOut = new Writable({
                write(_chunk, _enc, cb) {
                    const err = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
                    cb(err);
                },
            });
            const epipeCode = await runStatusLineCli({
                argv: ['--no-color'],
                env: {},
                stdin: epipeIn,
                stdout: epipeOut,
            });
            expect(epipeCode).toBe(0);

            // 4. NO_COLOR=1 vs colored output & argument parsing
            expect(parseStatusLineArgs(['--currency=CAD', '--basis=native', '--max-width', '80'], { NO_COLOR: '1' })).toMatchObject({
                currency: 'CAD',
                basis: 'native',
                maxWidth: 80,
                noColor: true,
            });
            expect(parseStatusLinePayload('not json')).toBeNull();
            expect(parseStatusLinePayload('[]')).toBeNull();
        });

        it('runs the bundled zero-dep app-plugin/bin/agy-statusline.mjs executable end-to-end', async () => {
            expect(fs.existsSync(BUNDLED_STATUSLINE_PATH)).toBe(true);
            const firstLine = fs.readFileSync(BUNDLED_STATUSLINE_PATH, 'utf8').split(/\r?\n/)[0];
            expect(firstLine).toBe('#!/usr/bin/env node');
            if (process.platform !== 'win32') {
                expect(fs.statSync(BUNDLED_STATUSLINE_PATH).mode & 0o111).not.toBe(0);
            }

            // Colored default (piped stdout) vs NO_COLOR=1
            const colored = spawnSync(process.execPath, [BUNDLED_STATUSLINE_PATH], {
                input: JSON.stringify(FIXTURE_V1_5_FULL),
                encoding: 'utf8',
                env: { PATH: process.env.PATH || '' },
                timeout: 5_000,
            });
            expect(colored.status).toBe(0);
            expect(colored.stdout).toContain('\x1b[');
            expect(colored.stdout.replace(/\r?\n$/, '').split(/\r?\n/)).toHaveLength(1);

            const noColor = spawnSync(process.execPath, [BUNDLED_STATUSLINE_PATH, '--currency', 'CAD'], {
                input: JSON.stringify(FIXTURE_V1_5_FULL),
                encoding: 'utf8',
                env: { PATH: process.env.PATH || '', NO_COLOR: '1' },
                timeout: 5_000,
            });
            expect(noColor.status).toBe(0);
            expect(noColor.stdout).not.toContain('\x1b');
            expect(noColor.stdout).toContain('CA$0.58');
            expect(noColor.stdout).toContain('Ctx 8%');
            expect(noColor.stdout.replace(/\r?\n$/, '').split(/\r?\n/)).toHaveLength(1);

            // Real OS broken-pipe (EPIPE) check: close child stdout reader before payload flush
            const epipeResult = await new Promise<{ code: number | null; stderr: string }>((resolvePromise, rejectPromise) => {
                const child = spawn(process.execPath, [BUNDLED_STATUSLINE_PATH], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: { PATH: process.env.PATH || '', NO_COLOR: '1' },
                });
                let stderr = '';
                child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
                child.on('error', rejectPromise);
                child.on('close', (code) => resolvePromise({ code, stderr }));
                // Close the parent's read end of stdout immediately so the child hits EPIPE on write
                child.stdout.destroy();
                setTimeout(() => {
                    child.stdin.end(JSON.stringify(FIXTURE_V1_5_FULL));
                }, 30);
            });
            expect(epipeResult.code).toBe(0);
            expect(epipeResult.stderr).toBe('');
        });
    });
});

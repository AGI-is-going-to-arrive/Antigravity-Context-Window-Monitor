// Consolidated Gate Suite #4: Daily Ledger Concurrency, Rewind & Late-Day Idempotency Gates
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    acquireFencedLockFile,
    DurableState,
    DurableStateLockTimeoutError,
    isUpdateAvailableForVersion,
    mergeDailyLedgerState3Way,
    mergeDailyStoreState3Way,
    mergeQuotaRunwayState3Way,
    mergeSettledEntries,
    normalizeAppSettings,
    parseLockFileContent,
} from '../src/durable-state';
import {
    canonicalLogicalCallId,
    DailyLedger,
    normalizeWorkspaceKey,
    type DailyLedgerState,
    type LedgerCallEntry,
    type LedgerSettledEntry,
    toLocalDateKey,
} from '../src/daily-ledger';
import {
    buildGMSummaryFromLedger,
    calculateSettledEntryCosts,
    type DailyArchivalContext,
    flushLateDaysToDailyStore,
    flushLateDaysToDailyStoreAsync,
    mergeArchivedAndLiveRecords,
    performDailyArchival,
    performDailyArchivalAsync,
} from '../src/daily-archival';
import { computeCycleTokenTotals, mergeLateCallsIntoCycle, redactDailyRecordIdentities, type DailyCycleEntry, type DailyMergedLateCall, DailyStore } from '../src/daily-store';
import { CliUsageScanner, decodeCliGenMetadataBlob, type SqliteDatabaseLike } from '../src/cli-usage-scanner';
import { extractLegacyDataAsync, runLegacyMigrationOnce, runLegacyMigrationOnceAsync } from '../src/legacy-migration';
import {
    buildChatHistoryTabContent,
    clearChatHistoryExistenceCache,
    fileUriToPath,
    getChatHistoryExistenceCacheStats,
    prewarmChatHistoryExistenceCache,
    setChatHistoryExistenceCacheTtlMs,
} from '../src/webview-chat-history-tab';
import type { GMCallEntry } from '../src/gm-tracker';
import type { TrajectorySummary } from '../src/tracker';
import { GMTracker, ledgerDedupKey } from '../src/gm/tracker';
import type { GMConversationData } from '../src/gm/types';
import type { ActivitySummary } from '../src/activity-tracker';
import { createFastDurableState } from './helpers/factories';

describe('[ledger-concurrency-and-rewind]', () => {
    // ─── Helpers ─────────────────────────────────────────────────────────────────

    function localDate(y: number, m: number, d: number, h = 12, min = 0, s = 0, ms = 0): Date {
        return new Date(y, m - 1, d, h, min, s, ms);
    }


    function localIso(y: number, m: number, d: number, h = 12, min = 0, s = 0, ms = 0): string {
        return localDate(y, m, d, h, min, s, ms).toISOString();
    }


    function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
        const model = overrides.model ?? 'MODEL_PLACEHOLDER_M26';
        const isGemini = model === 'MODEL_PLACEHOLDER_M16';
        const isOrch = model === 'MODEL_PLACEHOLDER_M667';
        return {
            stepIndices: [1],
            executionId: overrides.executionId !== undefined
                ? overrides.executionId
                : `exec-${Math.random().toString(36).slice(2)}`,
            model,
            modelDisplay: overrides.modelDisplay ?? (
                isOrch ? 'Gemini Pro Orchestrator (Neon)'
                    : isGemini ? 'Gemini 3.1 Pro (High)' : 'Claude Opus 4.6 (Thinking)'
            ),
            responseModel: overrides.responseModel ?? (
                isOrch ? 'gemini-pro-orchestrator-neon'
                    : isGemini ? 'gemini-3.1-pro-high' : 'claude-opus-4-6-thinking'
            ),
            modelAccuracy: 'exact',
            inputTokens: overrides.inputTokens ?? 100_000,
            outputTokens: overrides.outputTokens ?? 20_000,
            thinkingTokens: overrides.thinkingTokens ?? 5_000,
            responseTokens: overrides.responseTokens ?? 15_000,
            cacheReadTokens: overrides.cacheReadTokens ?? 10_000,
            cacheCreationTokens: overrides.cacheCreationTokens ?? 0,
            apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
            ttftSeconds: overrides.ttftSeconds ?? 1.0,
            streamingSeconds: overrides.streamingSeconds ?? 2.0,
            credits: overrides.credits ?? 2,
            creditType: 'ai',
            hasError: false,
            errorMessage: '',
            contextTokensUsed: overrides.contextTokensUsed ?? 50_000,
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
            stopReason: overrides.stopReason ?? 'STOP_REASON_END_TURN',
            retryTokensIn: 0,
            retryTokensOut: 0,
            retryCredits: 0,
            retryErrors: [],
            timeSinceLastInvocation: 0,
            tokenBreakdownGroups: [],
            createdAt: overrides.createdAt ?? localIso(2026, 6, 10, 12, 0, 0),
            latestStableMessageIndex: 0,
            startStepIndex: overrides.startStepIndex ?? 0,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            toolCallsByStep: {},
            contextWindowCapacity: 200_000,
            accountEmail: overrides.accountEmail ?? 'user@example.com',
        };
    }


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


    function buildProtoGenMetadataBlob(opts: {
        executionId?: string;
        inputTokens: number;
        outputTokens?: number;
        thinkingTokens?: number;
        responseOutputTokens?: number;
        cacheReadTokens?: number;
        createdAtSec?: number;
        responseModel?: string;
        modelDisplayName?: string;
    }): Buffer {
        const usageParts: Buffer[] = [pbVarint(2, opts.inputTokens)];
        if (opts.outputTokens !== undefined) { usageParts.push(pbVarint(3, opts.outputTokens)); }
        if (opts.cacheReadTokens) { usageParts.push(pbVarint(5, opts.cacheReadTokens)); }
        if (opts.thinkingTokens) { usageParts.push(pbVarint(9, opts.thinkingTokens)); }
        if (opts.responseOutputTokens !== undefined) { usageParts.push(pbVarint(10, opts.responseOutputTokens)); }

        const cmParts: Buffer[] = [pbBytes(4, Buffer.concat(usageParts))];
        if (opts.createdAtSec) {
            cmParts.push(pbBytes(9, pbBytes(4, pbVarint(1, opts.createdAtSec))));
        }
        if (opts.responseModel) { cmParts.push(pbBytes(19, opts.responseModel)); }
        if (opts.modelDisplayName) { cmParts.push(pbBytes(21, opts.modelDisplayName)); }

        const topParts: Buffer[] = [pbBytes(1, Buffer.concat(cmParts))];
        if (opts.executionId) { topParts.push(pbBytes(4, opts.executionId)); }
        return Buffer.concat(topParts);
    }


    const tempDirs: string[] = [];

    function makeTmpDir(prefix = 'acm-wave1a-'): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        tempDirs.push(dir);
        return dir;
    }


    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        clearChatHistoryExistenceCache();
        setChatHistoryExistenceCacheTtlMs(30_000);
        while (tempDirs.length > 0) {
            const d = tempDirs.pop()!;
            try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });


    // ─── 1. DurableState Semantic 3-Way Merge & Concurrency ──────────────────────

    describe('DurableState semantic 3-way merge (DailyLedger, QuotaRunway, lastUpdateCheck)', () => {
        it('merges concurrent App + IDE DailyLedger calls on the SAME account without dropping calls and recomputes aggregates', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(localDate(2026, 6, 10, 12, 0));

            const dir = makeTmpDir();
            const filePath = path.join(dir, 'state-v1.json');

            // Seed shared base with 1 call
            const baseLedger = new DailyLedger('2026-06-10');
            baseLedger.recordCalls([
                {
                    dedupKey: 'conv-base:0|exec:c0',
                    call: makeCall({ executionId: 'c0', inputTokens: 100_000, outputTokens: 10_000, credits: 1 }),
                    surface: 'app',
                },
            ]);

            const seed = createFastDurableState(filePath, { debounceMs: 5, retryDelayMs: 10 });
            await seed.globalBucket().update('dailyLedgerState', baseLedger.serialize());
            await seed.flush();

            // Both App and IDE load the same base state
            const appState = createFastDurableState(filePath, { debounceMs: 5, retryDelayMs: 10 });
            const ideState = createFastDurableState(filePath, { debounceMs: 5, retryDelayMs: 10 });

            const appLedger = DailyLedger.restore(appState.globalBucket().get<DailyLedgerState | null>('dailyLedgerState', null));
            const ideLedger = DailyLedger.restore(ideState.globalBucket().get<DailyLedgerState | null>('dailyLedgerState', null));

            // App adds c1 and flushes first
            appLedger.recordCalls([
                {
                    dedupKey: 'conv-app:0|exec:c1',
                    workspace: '/one',
                    call: makeCall({ executionId: 'c1', inputTokens: 200_000, outputTokens: 20_000, credits: 2 }),
                    surface: 'app',
                },
            ]);
            await appState.globalBucket().update('dailyLedgerState', appLedger.serialize());
            await appState.flush();

            // IDE adds c2 from stale base and flushes second
            ideLedger.recordCalls([
                {
                    dedupKey: 'conv-ide:0|exec:c2',
                    workspace: '/two',
                    call: makeCall({ executionId: 'c2', inputTokens: 300_000, outputTokens: 30_000, credits: 3 }),
                    surface: 'ide',
                },
            ]);
            await ideState.globalBucket().update('dailyLedgerState', ideLedger.serialize());
            await ideState.flush();

            const reloaded = DailyLedger.restore(
                createFastDurableState(filePath).globalBucket().get<DailyLedgerState | null>('dailyLedgerState', null),
            );
            const bucket = reloaded.getAccountActive('user@example.com')!;
            expect(bucket).not.toBeNull();
            expect(bucket.totalCalls).toBe(3);
            expect(bucket.totalInputTokens).toBe(600_000);
            expect(bucket.totalOutputTokens).toBe(60_000);
            expect(bucket.totalCredits).toBe(6);
            expect(bucket.recordedCallIds.sort()).toEqual([
                'conv-app:0|exec:c1',
                'conv-base:0|exec:c0',
                'conv-ide:0|exec:c2',
            ]);
            expect(bucket.workspaceBreakdown).toMatchObject({
                '/one': { calls: 1, bySurface: { app: { calls: 1 } } },
                '/two': { calls: 1, bySurface: { ide: { calls: 1 } } },
                __unattributed__: { calls: 1 },
            });
            expect(bucket.recordedCalls).toHaveLength(3);
            expect(bucket.modelStats['Claude Opus 4.6 (Thinking)'].calls).toBe(3);
            expect(bucket.modelStats['Claude Opus 4.6 (Thinking)'].inputTokens).toBe(600_000);
            expect(bucket.surfaceBreakdown?.app?.calls).toBe(2);
            expect(bucket.surfaceBreakdown?.ide?.calls).toBe(1);
        });

        it('does not resurrect base calls that one side explicitly settled during concurrent 3-way merge', () => {
            vi.useFakeTimers();
            vi.setSystemTime(localDate(2026, 6, 10, 12, 0));

            const baseLedger = new DailyLedger('2026-06-10');
            baseLedger.recordCalls([
                { dedupKey: 'c:0|exec:pre1', call: makeCall({ executionId: 'pre1', createdAt: localIso(2026, 6, 10, 11, 50) }) },
            ]);
            const baseState = baseLedger.serialize();

            // Disk settled pre1 at 12:00
            const diskLedger = DailyLedger.restore(baseState);
            diskLedger.settleForQuotaReset(['MODEL_PLACEHOLDER_M26'], 'user@example.com', localDate(2026, 6, 10, 12, 0).getTime());
            const diskState = diskLedger.serialize();

            // Local didn't see settlement yet and recorded post1 at 12:05
            const localLedger = DailyLedger.restore(baseState);
            localLedger.recordCalls([
                { dedupKey: 'c:1|exec:post1', call: makeCall({ executionId: 'post1', createdAt: localIso(2026, 6, 10, 12, 5) }) },
            ]);
            const localState = localLedger.serialize();

            const merged = mergeDailyLedgerState3Way(
                baseState as unknown as Record<string, unknown>,
                diskState as unknown as Record<string, unknown>,
                localState as unknown as Record<string, unknown>,
            ) as unknown as DailyLedgerState;

            // Active should contain ONLY post1 (not pre1), while settled retains pre1!
            expect(merged.accounts['user@example.com'].totalCalls).toBe(1);
            expect(merged.accounts['user@example.com'].recordedCalls.map(c => c.callId)).toEqual(['c:1|exec:post1']);
            // Both call IDs stay in recordedCallIds so pre1 is never re-recorded
            expect(merged.accounts['user@example.com'].recordedCallIds.sort()).toEqual(['c:0|exec:pre1', 'c:1|exec:post1']);
            expect(merged.settled).toHaveLength(1);
            expect(merged.settled[0].totalCalls).toBe(1);
        });

        it('queues only new previous-day calls when a stale writer races midnight rollover', () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(localDate(2026, 6, 10));
            const older = new DailyLedger('2026-06-10', 'ide');
            const entry = (id: string) => ({ dedupKey: `session|exec:${id}`, call: makeCall({ executionId: id }) });
            older.recordCalls([entry('archived')]);
            const base = { ...older.serialize() };
            older.recordCalls([entry('just-before-midnight')]);
            older.settleForQuotaReset(['MODEL_PLACEHOLDER_M26'], 'user@example.com');
            const next = { ...new DailyLedger('2026-06-11', 'app').serialize() };
            const previous = { ...older.serialize() };
            const merged = mergeDailyLedgerState3Way(base, next, previous);
            const replay = mergeDailyLedgerState3Way(base, merged, previous) as unknown as DailyLedgerState;
            expect(replay.dateKey).toBe('2026-06-11');
            expect(replay.accounts).toEqual({});
            expect(replay.lateDays?.['2026-06-10']['user@example.com'].recordedCallIds).toEqual(['session|exec:just-before-midnight']);
        });

        it('counts a concurrent call settled before the other host first persisted it exactly once', () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(localDate(2026, 6, 10));
            const entry = { dedupKey: 'session|exec:shared', call: makeCall({ executionId: 'shared' }), workspace: '/one' };
            const app = new DailyLedger('2026-06-10', 'app');
            const ide = new DailyLedger('2026-06-10', 'ide');
            app.recordCalls([entry]);
            ide.recordCalls([entry, { ...entry, dedupKey: 'session|exec:extra', call: makeCall({ executionId: 'extra' }), workspace: '/two' }]);
            app.settleForQuotaReset(['MODEL_PLACEHOLDER_M26'], 'user@example.com');
            const merged = mergeDailyLedgerState3Way(undefined, { ...app.serialize() }, { ...ide.serialize() }) as unknown as DailyLedgerState;
            expect(merged.settled[0].totalCalls).toBe(1);
            const active = merged.accounts['user@example.com'];
            expect(active.totalCalls).toBe(1);
            expect(active.recordedCallIds.sort()).toEqual(['session|exec:extra', 'session|exec:shared']);
            expect(active.workspaceBreakdown).toMatchObject({ '/two': { calls: 1 } });
            expect(active.workspaceBreakdown?.['/one']).toBeUndefined();
        });

        it('deduplicates concurrent settled entries within ±60s timestamp drift across minute boundaries while preserving distinct resets', () => {
            const t1 = Date.parse('2026-06-10T11:59:55.100Z');
            const t2 = Date.parse('2026-06-10T12:00:12.900Z'); // +17.8s across minute boundary
            const t3 = Date.parse('2026-06-10T17:00:00.000Z'); // 5 hours later (distinct reset)

            const diskSettled = [
                {
                    settledAt: '2026-06-10T11:59:55.100Z',
                    settledCutoffTime: t1,
                    accountEmail: 'user@example.com',
                    poolModelIds: ['MODEL_PLACEHOLDER_M26', 'MODEL_PLACEHOLDER_M35'],
                    totalCalls: 4,
                    totalInputTokens: 400_000,
                    totalOutputTokens: 20_000,
                },
            ];
            const localSettled = [
                {
                    settledAt: '2026-06-10T12:00:12.900Z',
                    settledCutoffTime: t2,
                    accountEmail: 'user@example.com',
                    poolModelIds: ['MODEL_PLACEHOLDER_M35', 'MODEL_PLACEHOLDER_M26'], // reversed order
                    totalCalls: 5, // richer snapshot wins
                    totalInputTokens: 500_000,
                    totalOutputTokens: 25_000,
                    modelStats: { 'Claude Opus 4.6 (Thinking)': { calls: 5 } },
                },
                {
                    settledAt: '2026-06-10T17:00:00.000Z',
                    settledCutoffTime: t3,
                    accountEmail: 'user@example.com',
                    poolModelIds: ['MODEL_PLACEHOLDER_M26', 'MODEL_PLACEHOLDER_M35'],
                    totalCalls: 2,
                    totalInputTokens: 200_000,
                    totalOutputTokens: 10_000,
                },
            ];

            const merged = mergeSettledEntries(diskSettled, localSettled) as Array<{ totalCalls: number; settledCutoffTime: number }>;
            expect(merged).toHaveLength(2);
            expect(merged[0].totalCalls).toBe(5);
            expect(merged[1].settledCutoffTime).toBe(t3);
        });

        it('merges quotaRunwayState semantically across concurrent App + IDE writers without clobbering observations', async () => {
            const dir = makeTmpDir();
            const filePath = path.join(dir, 'runway.json');

            const base = {
                version: 1,
                pools: {
                    claude: {
                        poolKey: 'claude',
                        samples: [{ remainingFraction: 0.9, timestampMs: 1_700_000_000_000, resetTimeMs: 1_700_010_000_000 }],
                        lastObservedAtMs: 1_700_000_000_000,
                        lastResetTimeMs: 1_700_010_000_000,
                        recoveredAtMs: null,
                    },
                },
            };
            const disk = {
                version: 1,
                pools: {
                    claude: {
                        poolKey: 'claude',
                        samples: [
                            { remainingFraction: 0.9, timestampMs: 1_700_000_000_000, resetTimeMs: 1_700_010_000_000 },
                            { remainingFraction: 0.85, timestampMs: 1_700_000_060_000, resetTimeMs: 1_700_010_000_000 },
                        ],
                        lastObservedAtMs: 1_700_000_060_000,
                        lastResetTimeMs: 1_700_010_000_000,
                        recoveredAtMs: null,
                    },
                },
            };
            const local = {
                version: 1,
                pools: {
                    claude: {
                        poolKey: 'claude',
                        samples: [
                            { remainingFraction: 0.9, timestampMs: 1_700_000_000_000, resetTimeMs: 1_700_010_000_000 },
                            { remainingFraction: 0.8, timestampMs: 1_700_000_120_000, resetTimeMs: 1_700_010_000_000 },
                        ],
                        lastObservedAtMs: 1_700_000_120_000,
                        lastResetTimeMs: 1_700_010_000_000,
                        recoveredAtMs: null,
                    },
                    gemini: {
                        poolKey: 'gemini',
                        samples: [{ remainingFraction: 0.95, timestampMs: 1_700_000_120_000, resetTimeMs: 1_700_020_000_000 }],
                        lastObservedAtMs: 1_700_000_120_000,
                        lastResetTimeMs: 1_700_020_000_000,
                        recoveredAtMs: null,
                    },
                },
            };

            const merged = mergeQuotaRunwayState3Way(base, disk, local) as {
                pools: Record<string, { samples: Array<{ timestampMs: number; remainingFraction: number }>; lastObservedAtMs: number }>;
            };
            expect(Object.keys(merged.pools).sort()).toEqual(['claude', 'gemini']);
            expect(merged.pools.claude.samples.map(s => s.remainingFraction)).toEqual([0.9, 0.85, 0.8]);
            expect(merged.pools.claude.lastObservedAtMs).toBe(1_700_000_120_000);

            // Also verify end-to-end through DurableState
            const seed = createFastDurableState(filePath, { debounceMs: 5 });
            await seed.globalBucket().update('quotaRunwayState', base);
            await seed.flush();

            const app = createFastDurableState(filePath, { debounceMs: 5 });
            const ide = createFastDurableState(filePath, { debounceMs: 5 });
            await app.globalBucket().update('quotaRunwayState', disk);
            await app.flush();
            await ide.globalBucket().update('quotaRunwayState', local);
            await ide.flush();

            const saved = createFastDurableState(filePath).globalBucket().get<typeof merged>('quotaRunwayState', { pools: {} });
            expect(saved.pools.claude.samples).toHaveLength(3);
            expect(saved.pools.gemini.samples).toHaveLength(1);
        });

        it('stores version-agnostic lastUpdateCheck and computes per-host update availability via isUpdateAvailableForVersion', () => {
            const settings = normalizeAppSettings({
                lastUpdateCheck: {
                    checkedAt: 1_763_840_000_000,
                    latestVersion: '1.18.0',
                    hasUpdate: true,
                    etag: '"v118"',
                },
            });
            expect(settings.lastUpdateCheck?.latestVersion).toBe('1.18.0');
            // Must NOT persist colliding host-specific boolean when latestVersion is stored
            expect(settings.lastUpdateCheck?.hasUpdate).toBeUndefined();

            // Staggered host versions evaluate accurately from the same shared record
            expect(isUpdateAvailableForVersion(settings.lastUpdateCheck, '1.17.11')).toBe(true);
            expect(isUpdateAvailableForVersion(settings.lastUpdateCheck, '1.18.0-beta.1')).toBe(true);
            expect(isUpdateAvailableForVersion(settings.lastUpdateCheck, '1.18.0')).toBe(false);
            expect(isUpdateAvailableForVersion(settings.lastUpdateCheck, '1.19.0')).toBe(false);

            // Legacy record lacking latestVersion falls back to legacy hasUpdate cleanly
            const legacy = normalizeAppSettings({
                lastUpdateCheck: { checkedAt: 1_763_840_000_000, hasUpdate: true },
            });
            expect(legacy.lastUpdateCheck?.hasUpdate).toBe(true);
            expect(isUpdateAvailableForVersion(legacy.lastUpdateCheck, '1.18.0')).toBe(true);
            expect(isUpdateAvailableForVersion(null, '1.18.0')).toBe(false);
        });

        it('PERF-02: skips fs.readFileSync on unchanged reloadIfChanged, writes compact JSON, and retries automatically after lock timeout', async () => {
            const dir = makeTmpDir();
            const filePath = path.join(dir, 'perf.json');

            const state = createFastDurableState(filePath, { debounceMs: 5, retryDelayMs: 25 });
            await state.globalBucket().update('displayLanguage', 'en');
            await state.flush();

            // Compact JSON (no multi-line pretty indent)
            const rawText = fs.readFileSync(filePath, 'utf8');
            expect(rawText.includes('\n')).toBe(false);
            expect(JSON.parse(rawText).global.displayLanguage).toBe('en');

            // reloadIfChanged returns false immediately WITHOUT reading file bytes when stat (mtime/size/ino) is unchanged:
            // pin a whole-second mtime so sub-millisecond APFS truncation does not perturb mtimeMs across utimesSync.
            const fixedTime = new Date(Math.floor(Date.now() / 1000) * 1000);
            fs.utimesSync(filePath, fixedTime, fixedTime);
            const reader = createFastDurableState(filePath, { debounceMs: 5, retryDelayMs: 25 });
            fs.writeFileSync(filePath, rawText.replace('"en"', '"zh"'), 'utf8');
            fs.utimesSync(filePath, fixedTime, fixedTime);
            expect(reader.reloadIfChanged()).toBe(false);
            expect(reader.globalBucket().get('displayLanguage', 'both')).toBe('en');

            // Once mtime actually changes, reloadIfChanged DOES read disk and picks up 'zh'.
            fs.utimesSync(filePath, fixedTime, new Date(fixedTime.getTime() + 2_000));
            expect(reader.reloadIfChanged()).toBe(true);
            expect(reader.globalBucket().get('displayLanguage', 'both')).toBe('zh');
            reader.dispose();
            // Restore 'en' on disk for the lock-timeout retry sub-test below
            await state.globalBucket().update('displayLanguage', 'en');
            await state.flush();

            // Lock timeout keeps dirty state pending and retries via backoff timer without a new write!
            const lockPath = `${filePath}.lock`;
            fs.writeFileSync(lockPath, `424242:${Date.now()}:active\n`, 'utf8');
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

            const writer = createFastDurableState(filePath, {
                debounceMs: 5,
                retryDelayMs: 25,
                lockOptions: { timeoutMs: 25, isPidAlive: () => true },
            });
            const pendingRetryWrite = writer.globalBucket().update('displayLanguage', 'zh');
            let resolvedBeforeCommit = false;
            void Promise.resolve(pendingRetryWrite).then(() => { resolvedBeforeCommit = true; });
            const firstReceipt = await writer.flush();

            expect(firstReceipt.committed).toBe(false);
            expect(firstReceipt.status).toBe('pending');
            expect(firstReceipt.retryScheduled).toBe(true);
            expect(resolvedBeforeCommit).toBe(false);
            expect(warnSpy).toHaveBeenCalled();
            expect(writer.hasPendingWrites()).toBe(true);
            expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).global.displayLanguage).toBe('en');

            // Release the lock WITHOUT calling update() or flush() again — retry timer flushes automatically and resolves waiter!
            fs.unlinkSync(lockPath);
            await pendingRetryWrite;

            expect(writer.hasPendingWrites()).toBe(false);
            expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).global.displayLanguage).toBe('zh');
            writer.dispose();
            state.dispose();
        });
    });


    // ─── 2. DailyLedger Cursor, Settled Dynamic Re-Pricing, Midnight & Deleted Chats ──

    describe('DailyLedger recordCallsDetailed, dynamic settled pricing, cross-midnight & deleted conversations', () => {
        it('computes per-entry statuses and contiguousAdvanceCount without deadlocking on mixed batches', () => {
            vi.useFakeTimers();
            vi.setSystemTime(localDate(2026, 6, 10, 12, 0));

            const ledger = new DailyLedger('2026-06-10');
            expect(ledger.recordCalls([
                { dedupKey: 'c:0|exec:dup', call: makeCall({ executionId: 'dup', createdAt: localIso(2026, 6, 10, 10, 0) }) },
            ])).toBe(1);

            // Mixed batch: [duplicate, ancient rejected_terminal, valid added, future rejected_terminal, valid added]
            const res = ledger.recordCallsDetailed([
                { dedupKey: 'c:0|exec:dup', call: makeCall({ executionId: 'dup', createdAt: localIso(2026, 6, 10, 10, 0) }) },
                { dedupKey: 'c:1|exec:ancient', call: makeCall({ executionId: 'ancient', createdAt: localIso(2026, 6, 1, 9, 0) }) },
                { dedupKey: 'c:2|exec:fresh1', call: makeCall({ executionId: 'fresh1', createdAt: localIso(2026, 6, 10, 11, 0) }) },
                { dedupKey: 'c:3|exec:future', call: makeCall({ executionId: 'future', createdAt: localIso(2026, 6, 12, 9, 0) }) },
                { dedupKey: 'c:4|exec:fresh2', call: makeCall({ executionId: 'fresh2', createdAt: localIso(2026, 6, 10, 11, 5) }) },
            ]);

            expect(res.added).toBe(2);
            expect(res.statuses).toEqual([
                'duplicate',
                'rejected_terminal',
                'added',
                'rejected_terminal',
                'added',
            ]);
            expect(res.contiguousAdvanceCount).toBe(5);

            // Stale ledger waiting for midnight rollover: yesterday call accepted, today call retryable -> contiguousAdvanceCount stops before retryable
            vi.setSystemTime(localDate(2026, 6, 11, 0, 5));
            const staleRes = ledger.recordCallsDetailed([
                { dedupKey: 'c:5|exec:late-yest', call: makeCall({ executionId: 'late-yest', createdAt: localIso(2026, 6, 10, 23, 59) }) },
                { dedupKey: 'c:6|exec:today-wait', call: makeCall({ executionId: 'today-wait', createdAt: localIso(2026, 6, 11, 0, 1) }) },
                { dedupKey: 'c:7|exec:late-yest-2', call: makeCall({ executionId: 'late-yest-2', createdAt: localIso(2026, 6, 10, 23, 59, 30) }) },
            ]);
            expect(staleRes.statuses).toEqual(['added', 'retryable', 'added']);
            expect(staleRes.added).toBe(2);
            expect(staleRes.contiguousAdvanceCount).toBe(1);
        });

        it('retains per-model token totals on settled buckets so custom pricing and Orchestrator billing mode recalculate dynamically', () => {
            vi.useFakeTimers();
            vi.setSystemTime(localDate(2026, 6, 10, 12, 0));

            const ledger = new DailyLedger('2026-06-10');
            ledger.recordCalls([
                {
                    dedupKey: 'o:0|exec:orch-1',
                    call: makeCall({
                        executionId: 'orch-1',
                        model: 'MODEL_PLACEHOLDER_M537',
                        modelDisplay: 'Orchestrator (Neon)',
                        responseModel: 'gemini-pro-orchestrator-neon',
                        inputTokens: 1_000_000,
                        outputTokens: 100_000,
                        thinkingTokens: 0,
                        cacheReadTokens: 0,
                        createdAt: localIso(2026, 6, 10, 11, 0),
                    }),
                },
            ]);

            const settled = ledger.settleForQuotaReset(
                ['MODEL_PLACEHOLDER_M537'],
                'user@example.com',
                localDate(2026, 6, 10, 12, 0).getTime(),
            ) as LedgerSettledEntry;

            expect(settled).not.toBeNull();
            expect(settled.modelStats?.['Orchestrator (Neon)']?.inputTokens).toBe(1_000_000);
            expect(settled.modelStats?.['Orchestrator (Neon)']?.outputTokens).toBe(100_000);

            const dayData = ledger.getLiveDaySnapshot();

            // Mapped mode uses mapped Gemini 4 Neon base rate ($3/M in + $15/M out = $4.50)
            const mapped = buildGMSummaryFromLedger(dayData, {}, 'mapped');
            expect(mapped.totalCost).toBeCloseTo(4.5, 4);

            // Strict mode recalculates dynamically to $0 (does NOT keep frozen mapped cost!)
            const strict = buildGMSummaryFromLedger(dayData, {}, 'strict');
            expect(strict.totalCost).toBe(0);

            // Custom pricing overrides dynamically even after settlement ($10/M in + $20/M out = $12.00)
            const customPricing = {
                'Orchestrator (Neon)': { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, thinking: 20 },
            };
            const custom = calculateSettledEntryCosts(settled, '2026-06-10', customPricing, 'strict');
            expect(custom.totalCost).toBeCloseTo(12.0, 4);
        });

        it('buckets late-arriving cross-midnight calls into their true local date and supports pre-archival flush', () => {
            vi.useFakeTimers();
            vi.setSystemTime(localDate(2026, 6, 11, 0, 2));

            const ledger = new DailyLedger('2026-06-11');
            const store = new DailyStore();

            // Late call from 23:59:45 on 2026-06-10 arrives after rollover to 2026-06-11
            const detailed = ledger.recordCallsDetailed([
                {
                    dedupKey: 'conv-late:0|exec:late-1',
                    call: makeCall({ executionId: 'late-1', createdAt: localIso(2026, 6, 10, 23, 59, 45), inputTokens: 50_000 }),
                    surface: 'app',
                },
                {
                    dedupKey: 'conv-today:0|exec:today-1',
                    call: makeCall({ executionId: 'today-1', createdAt: localIso(2026, 6, 11, 0, 1, 0), inputTokens: 80_000 }),
                    surface: 'app',
                },
            ]);

            expect(detailed.statuses).toEqual(['added', 'added']);
            expect(detailed.contiguousAdvanceCount).toBe(2);
            // Today's totals must NOT be polluted by yesterday's late call
            expect(ledger.getTodayTotals().totalCalls).toBe(1);
            expect(ledger.getAccountActive('user@example.com')?.totalInputTokens).toBe(80_000);
            // Yesterday's late bucket holds the late call under '2026-06-10'
            expect(ledger.getLateDayBucket('2026-06-10', 'user@example.com')?.totalInputTokens).toBe(50_000);

            // Live Calendar merge surfaces BOTH dates immediately
            const liveMerged = mergeArchivedAndLiveRecords({
                store,
                liveLedger: ledger,
                now: localDate(2026, 6, 11, 0, 2),
            });
            expect(liveMerged.get('2026-06-10')?.cycles[0].totalInputTokens).toBe(50_000);
            expect(liveMerged.get('2026-06-11')?.cycles[0].totalInputTokens).toBe(80_000);

            // Flush late days into DailyStore & verify dedup prevents re-recording
            expect(flushLateDaysToDailyStore(ledger, store)).toBe(1);
            expect(store.getRecord('2026-06-10')?.cycles[0].gmTotalCalls).toBe(1);
            expect(ledger.recordCallsDetailed([
                {
                    dedupKey: 'conv-late:0|exec:late-1',
                    call: makeCall({ executionId: 'late-1', createdAt: localIso(2026, 6, 10, 23, 59, 45), inputTokens: 50_000 }),
                },
            ]).statuses).toEqual(['duplicate']);

            // Pre-archival flush hook + automatic gmTracker sweep during performDailyArchival
            vi.setSystemTime(localDate(2026, 6, 12, 0, 1));
            const preFlushedIds: string[] = [];
            const latePreRolloverCall = makeCall({
                executionId: 'pre-rollover-2359',
                createdAt: localIso(2026, 6, 11, 23, 59, 55),
                inputTokens: 40_000,
            });
            const ctx: DailyArchivalContext = {
                activityTracker: {
                    getSummary: () => ({
                        totalUserInputs: 0, totalReasoning: 0, totalToolCalls: 0, totalErrors: 0,
                        totalCheckpoints: 0, totalInputTokens: 0, totalOutputTokens: 0, totalToolReturnTokens: 0,
                        estSteps: 0, modelStats: {}, globalToolStats: {}, recentSteps: [], sessionStartTime: '',
                        subAgentTokens: [], checkpointHistory: [], conversationBreakdown: [],
                    }),
                    archiveAndReset: () => null,
                } as any,
                gmTracker: {
                    reset: () => {},
                    getDetailedSummary: () => null,
                    getCachedSummary: () => null,
                    getArchivalSummary: () => null,
                    getNewCallsSinceLastRecord: () => ({
                        entries: [
                            {
                                dedupKey: 'conv-today|exec%3Apre-rollover-2359',
                                cascadeId: 'conv-today',
                                callIndex: 1,
                                call: latePreRolloverCall,
                            },
                        ],
                        revertedCascadeIds: [],
                    }),
                    markLedgerEntriesRecorded: () => {},
                } as any,
                dailyStore: store,
                pricingStore: null,
                lastGMSummary: null,
                persistedModelDNA: {},
                lastArchivalDateKey: '2026-06-11',
                dailyLedger: ledger,
                preArchivalFlush: () => { preFlushedIds.push('ran'); },
                persist: () => {},
                log: () => {},
            };

            const archival = performDailyArchival(ctx, false, localDate(2026, 6, 12, 0, 1));
            expect(archival.archived).toBe(true);
            expect(preFlushedIds).toEqual(['ran']);
            // Both today-1 (80k) and pre-rollover-2359 (40k) were archived into 2026-06-11!
            const archivedCycle = store.getRecord('2026-06-11')?.cycles[0];
            expect(archivedCycle?.gmTotalCalls).toBe(2);
            expect(archivedCycle?.gmModelStats?.['Claude Opus 4.6 (Thinking)']?.inputTokens).toBe(120_000);
            expect(archivedCycle?.gmTotalTokens).toBe(160_000);
        });

        it('preserves recorded usage on same-day deleted conversations and avoids fallback dedup collisions', () => {
            vi.useFakeTimers();
            vi.setSystemTime(localDate(2026, 6, 10, 14, 0));

            const ledger = new DailyLedger('2026-06-10');
            // Morning call with legacy index dedup key + fallback-only call (no executionId, no dedupKey)
            const morningFallback = makeCall({
                executionId: '',
                createdAt: '',
                inputTokens: 1000,
                outputTokens: 200,
                cacheReadTokens: 500,
                thinkingTokens: 50,
                ttftSeconds: 0.7,
            });
            expect(ledger.recordCalls([
                { dedupKey: 'deleted-conv:0', call: makeCall({ executionId: 'del-0', createdAt: localIso(2026, 6, 10, 9, 0) }) },
                { dedupKey: '', call: morningFallback },
            ])).toBe(2);

            // User deletes 'deleted-conv' on the same day
            ledger.recordConversationDeleted('deleted-conv');
            expect(ledger.getTodayTotals().totalCalls).toBe(2);

            // Afternoon call with same basic tokens/startStepIndex but different cacheRead/ttft (no executionId/dedupKey)
            const afternoonFallback = makeCall({
                executionId: '',
                createdAt: '',
                inputTokens: 1000,
                outputTokens: 200,
                cacheReadTokens: 1200,
                thinkingTokens: 80,
                ttftSeconds: 1.1,
            });
            const res = ledger.recordCallsDetailed([
                { dedupKey: 'deleted-conv:0', call: makeCall({ executionId: 'new-0', createdAt: localIso(2026, 6, 10, 14, 0) }) },
                { dedupKey: '', call: afternoonFallback },
                // Exact duplicate of afternoonFallback still deduplicates cleanly
                { dedupKey: '', call: afternoonFallback },
            ]);

            expect(res.statuses).toEqual(['added', 'added', 'duplicate']);
            expect(ledger.getTodayTotals().totalCalls).toBe(4);
        });
    });


    // ─── 3. CLI Usage Scanner Accuracy & Async Cache ─────────────────────────────

    describe('CliUsageScanner protobuf field 10, transient SQLite lock retry, DB+JSONL merge, undated calls & async cache', () => {
        it('parses protobuf field 10 (responseOutputTokens) for implicit thinking and output derivation', () => {
            const tsSec = Math.floor(localDate(2026, 6, 10, 15, 0).getTime() / 1000);

            // Case 1: field 9 omitted, field 3 (output=1000) > field 10 (response=300) => implicit thinking = 700
            const implicitThinkingBlob = buildProtoGenMetadataBlob({
                executionId: 'proto-f10-implicit',
                inputTokens: 5000,
                outputTokens: 1000,
                responseOutputTokens: 300,
                createdAtSec: tsSec,
                responseModel: 'gemini-3.7-flash-high',
            });
            const parsed1 = decodeCliGenMetadataBlob(implicitThinkingBlob, 's1', 0, 0)!;
            expect(parsed1.outputTokens).toBe(1000);
            expect(parsed1.thinkingTokens).toBe(700);

            // Case 2: field 3 omitted (0), field 10 (response=400) + field 9 (thinking=600) => output = 1000
            const derivedOutputBlob = buildProtoGenMetadataBlob({
                executionId: 'proto-f10-output',
                inputTokens: 5000,
                thinkingTokens: 600,
                responseOutputTokens: 400,
                createdAtSec: tsSec,
                responseModel: 'gemini-3.7-flash-high',
            });
            const parsed2 = decodeCliGenMetadataBlob(derivedOutputBlob, 's1', 1, 0)!;
            expect(parsed2.outputTokens).toBe(1000);
            expect(parsed2.thinkingTokens).toBe(600);
        });

        it('does NOT cache empty result on transient SQLite read-lock error and merges DB + JSONL by callId without mtime drift', async () => {
            const root = makeTmpDir('acm-cli-acc05-');
            const convDir = path.join(root, 'conversations');
            const brainDir = path.join(root, 'brain', 'sess-shared');
            fs.mkdirSync(convDir, { recursive: true });
            fs.mkdirSync(brainDir, { recursive: true });

            const dbFile = path.join(convDir, 'sess-shared.db');
            fs.writeFileSync(dbFile, 'stub-sqlite-file', 'utf8');

            const callTs = localDate(2026, 6, 5, 10, 0, 0);
            const callTsSec = Math.floor(callTs.getTime() / 1000);
            const dbBlob = buildProtoGenMetadataBlob({
                executionId: 'shared-call-1',
                inputTokens: 10_000,
                outputTokens: 2_000,
                responseOutputTokens: 1_500, // implicit thinking = 500
                createdAtSec: callTsSec,
                responseModel: 'gemini-4-neon',
            });

            // Sibling JSONL has:
            //  - duplicate 'shared-call-1' (should dedup against DB)
            //  - unique 'jsonl-only-call-2' (MUST merge instead of being masked!)
            //  - undated call with NO timestamp (MUST NOT drift to file mtime "today"!)
            fs.writeFileSync(path.join(brainDir, 'transcript.jsonl'), [
                JSON.stringify({
                    execution_id: 'shared-call-1',
                    created_at: callTs.toISOString(),
                    model: 'gemini-4-neon',
                    usage: { input_tokens: 99_999, output_tokens: 1 },
                }),
                JSON.stringify({
                    execution_id: 'jsonl-only-call-2',
                    created_at: new Date(callTs.getTime() + 60_000).toISOString(),
                    model: 'gemini-4-neon',
                    usage: { input_tokens: 4_000, output_tokens: 1_000 },
                }),
                JSON.stringify({
                    execution_id: 'undated-should-not-drift',
                    model: 'gemini-4-neon',
                    usage: { input_tokens: 77_777, output_tokens: 1_000 },
                }),
            ].join('\n'), 'utf8');

            const scanner = new CliUsageScanner();
            const nowToday = localDate(2026, 6, 10, 12, 0);
            let attempts = 0;

            const flakySqliteOpen = (): SqliteDatabaseLike => {
                attempts++;
                if (attempts === 1) {
                    throw new Error('SQLITE_BUSY: database is locked');
                }
                return {
                    prepare: () => ({
                        all: () => [{ idx: 0, data: new Uint8Array(dbBlob) }],
                    }),
                    close: () => {},
                };
            };

            // Scan 1: DB hits SQLITE_BUSY -> must NOT cache empty result for DB, still parses JSONL (ignoring undated call)
            const r1 = scanner.scan({ cliRootDir: root, now: nowToday, sqliteOpen: flakySqliteOpen });
            expect(r1.errorsSkipped).toBe(1);
            // No day entry created for "today" (2026-06-10) from undated call's file mtime!
            expect(r1.days.map(d => d.date)).toEqual(['2026-06-05']);

            // Scan 2: File mtime/size UNCHANGED — DB retries (was NOT cached empty!), succeeds, and merges cleanly with JSONL!
            const r2 = scanner.scan({ cliRootDir: root, now: nowToday, sqliteOpen: flakySqliteOpen });
            expect(attempts).toBe(2);
            expect(r2.errorsSkipped).toBe(0);
            expect(r2.days).toHaveLength(1);
            expect(r2.days[0].date).toBe('2026-06-05');
            // shared-call-1 (from DB: 10k+2k=12k, implicit thinking 500) + jsonl-only-call-2 (4k+1k=5k) = 17k total
            expect(r2.days[0].calls).toBe(2);
            expect(r2.days[0].totalTokens).toBe(17_000);
            expect(r2.days[0].thinkingTokens).toBe(500);

            // Async non-blocking scan & O(1) cached lookup
            const asyncScanner = new CliUsageScanner();
            expect(asyncScanner.getCachedScan({ cliRootDir: root, now: nowToday, triggerRefresh: false })).toBeNull();
            const asyncRes = await asyncScanner.scanAsync({ cliRootDir: root, now: nowToday, sqliteOpen: flakySqliteOpen });
            expect(asyncRes.days[0].calls).toBe(2);
            const cached = asyncScanner.getCachedScan({ cliRootDir: root, now: nowToday, triggerRefresh: false });
            expect(cached).not.toBeNull();
            expect(cached!.days[0].totalTokens).toBe(17_000);
        });
    });


    // ─── 4. Async Legacy Migration & Chat History Existence Cache ────────────────

    describe('PERF-03: async legacy migration & Chat History non-blocking existence cache + malformed URI safety', () => {
        it('extractLegacyDataAsync & runLegacyMigrationOnceAsync execute via async execFile without blocking', async () => {
            const execCalls: Array<{ file: string; args: readonly string[] }> = [];
            const result = await extractLegacyDataAsync(() => {}, {
                dbPath: '/fake/old/state.vscdb',
                nodePaths: ['/bad/node', '/good/node'],
                execFileFn: async (file, args) => {
                    execCalls.push({ file, args });
                    if (file === '/bad/node') {
                        throw new Error('node:sqlite unsupported');
                    }
                    return {
                        stdout: JSON.stringify({
                            displayLanguage: 'zh',
                            dailyStoreState: { version: 1, records: { '2026-06-01': { date: '2026-06-01', cycles: [] } } },
                        }),
                        stderr: '',
                    };
                },
            });

            expect(execCalls.map(c => c.file)).toEqual(['/bad/node', '/good/node']);
            expect(result.status).toBe('imported');
            expect(result.data?.displayLanguage).toBe('zh');

            // runLegacyMigrationOnceAsync imports and marks done
            let importedLang = '';
            let markedDone = false;
            const asyncRun = await runLegacyMigrationOnceAsync({
                migrationDone: false,
                extractLegacyData: async () => result,
                importLegacyData: (d) => { importedLang = d.displayLanguage || ''; },
                markDone: () => { markedDone = true; },
                log: () => {},
            });
            expect(asyncRun?.status).toBe('imported');
            expect(importedLang).toBe('zh');
            expect(markedDone).toBe(true);

            // runLegacyMigrationOnce with async extractor returns immediately (non-blocking) and completes in background
            let bgImported = false;
            let bgDone = false;
            const syncReturn = runLegacyMigrationOnce({
                migrationDone: false,
                extractLegacyData: async () => result,
                importLegacyData: () => { bgImported = true; },
                markDone: () => { bgDone = true; },
                log: () => {},
            });
            expect(syncReturn).toBeNull();
            expect(bgDone).toBe(false); // did NOT block synchronously!
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
            expect(bgImported).toBe(true);
            expect(bgDone).toBe(true);
        });

        it('renders Chat History with ZERO fs.accessSync calls using pre-warmed async TTL cache and safely decodes malformed URIs', async () => {
            const fakeRoot = makeTmpDir('acm-chat-hist-');
            const convDir = path.join(fakeRoot, 'conversations');
            const brainDir = path.join(fakeRoot, 'brain', 'sess-1');
            fs.mkdirSync(convDir, { recursive: true });
            fs.mkdirSync(brainDir, { recursive: true });
            fs.writeFileSync(path.join(convDir, 'sess-1.pb'), 'pb', 'utf8');

            // Malformed percent-encoding safety in fileUriToPath()
            expect(() => fileUriToPath('file:///Users/dev/100%_done%ZZ/repo')).not.toThrow();
            const decodedMixed = fileUriToPath('file:///Users/dev/%E4%B8%AD%E6%96%87/bad%ZZdir');
            expect(decodedMixed).toContain('中文');
            expect(decodedMixed).toContain('bad%ZZdir');

            const trajectories: TrajectorySummary[] = [
                {
                    cascadeId: 'sess-1',
                    summary: 'Malformed URI Session',
                    stepCount: 4,
                    status: 'CASCADE_RUN_STATUS_IDLE',
                    requestedModel: 'MODEL_PLACEHOLDER_M26',
                    createdTime: '2026-06-10T09:00:00.000Z',
                    lastModifiedTime: '2026-06-10T09:30:00.000Z',
                    lastUserInputTime: '2026-06-10T09:29:00.000Z',
                    workspaceUris: ['file:///Users/dev/100%_bad%ZZ/my-repo'],
                    repositoryName: 'my-repo',
                    branchName: 'main',
                } as TrajectorySummary,
            ];

            clearChatHistoryExistenceCache();
            setChatHistoryExistenceCacheTtlMs(60_000);
            await prewarmChatHistoryExistenceCache(trajectories, { antigravityRoot: fakeRoot });
            expect(getChatHistoryExistenceCacheStats().size).toBe(3);

            // Source uses ZERO synchronous fs.accessSync calls during rendering
            const chatHistorySrc = fs.readFileSync(
                path.resolve(__dirname, '..', 'src', 'webview-chat-history-tab.ts'),
                'utf8',
            );
            expect(chatHistorySrc).not.toMatch(/\baccessSync\s*\(/);

            // Render succeeds safely with malformed URI and serves pre-warmed cache with zero sync FS probing
            const html = buildChatHistoryTabContent(trajectories, null, null, undefined, undefined, fakeRoot);
            expect(html).toContain('Malformed URI Session');
            expect(html).toContain('my-repo');
            expect(html).toContain('data-recordable="true"');

            // Delete .pb on disk: while still inside TTL, render reads cached existence without hitting disk
            fs.unlinkSync(path.join(convDir, 'sess-1.pb'));
            const cachedHtml = buildChatHistoryTabContent(trajectories, null, null, undefined, undefined, fakeRoot);
            expect(cachedHtml).toContain('data-recordable="true"');
        });
    });
});

describe('[w1a-ledger-gates]', () => {
    function localDate(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): Date {
        return new Date(y, m - 1, d, hh, mm, ss);
    }


    function localIso(y: number, m: number, d: number, hh = 0, mm = 0, ss = 0): string {
        return localDate(y, m, d, hh, mm, ss).toISOString();
    }


    function makeCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
        return {
            stepIndices: [1],
            executionId: 'exec-default',
            model: 'MODEL_PLACEHOLDER_M400',
            modelDisplay: 'Claude Opus 4.6 (Thinking)',
            responseModel: 'claude-opus-4-6-thinking',
            modelAccuracy: 'exact',
            inputTokens: 10_000,
            outputTokens: 2_000,
            thinkingTokens: 500,
            responseTokens: 1_500,
            cacheReadTokens: 30_000,
            cacheCreationTokens: 1_000,
            apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
            ttftSeconds: 0.6,
            streamingSeconds: 1.5,
            credits: 2,
            creditType: 'GOOGLE_ONE_AI',
            hasError: false,
            errorMessage: '',
            contextTokensUsed: 0,
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
            stopReason: '',
            retryTokensIn: 0,
            retryTokensOut: 0,
            retryCredits: 0,
            retryErrors: [],
            timeSinceLastInvocation: 0,
            tokenBreakdownGroups: [],
            createdAt: localIso(2026, 6, 10, 12, 0, 0),
            latestStableMessageIndex: 0,
            startStepIndex: 1,
            checkpointIndex: 0,
            checkpointSummaries: [],
            systemContextItems: [],
            toolCallsByStep: {},
            ...overrides,
        };
    }


    function makeActivitySummary(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
        return {
            totalUserInputs: 15,
            totalReasoning: 42,
            totalToolCalls: 19,
            totalErrors: 2,
            totalInputTokens: 12_000,
            totalOutputTokens: 3_400,
            totalToolReturnTokens: 1_100,
            estSteps: 88,
            modelStats: {
                'Claude Opus 4.6 (Thinking)': {
                    reasoning: 42,
                    toolCalls: 19,
                    inputTokens: 12_000,
                    outputTokens: 3_400,
                    toolReturnTokens: 1_100,
                    estSteps: 88,
                },
            },
            globalToolStats: { read_file: 19 },
            recentSteps: [],
            sessionStartTime: localIso(2026, 6, 10, 8, 0, 0),
            subAgentTokens: [],
            checkpointHistory: [],
            conversationBreakdown: [],
            ...overrides,
        };
    }


    describe('W1A-FIX-1: Historical late-call idempotent merge, cross-midnight routing & settlement', () => {
        let tempDir: string;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-w1a-fix1-'));
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        it('MANDATORY GATE: yesterday starts with 100 calls + nonzero activity; App & IDE each add 1 distinct late call + replay + crash between history write and cursor ack -> exactly 102 unique calls, original activity preserved, accurate per-surface totals, zero change on second replay', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(localDate(2026, 6, 10, 23, 55, 0));

            const stateFile = path.join(tempDir, 'state-v1.json');

            // ── 1. Seed yesterday (2026-06-10) archive with 100 unique calls (60 app, 40 ide) + nonzero activity ──
            const seedLedger = new DailyLedger('2026-06-10', 'app');
            const originalCalls: GMCallEntry[] = [];
            const seedEntries: LedgerCallEntry[] = [];
            for (let i = 0; i < 100; i++) {
                const surface = i < 60 ? 'app' : 'ide';
                const call = makeCall({
                    executionId: `orig-${i}`,
                    inputTokens: 1_000,
                    outputTokens: 200,
                    thinkingTokens: 50,
                    cacheReadTokens: 3_000,
                    cacheCreationTokens: 0,
                    credits: 1,
                    createdAt: localIso(2026, 6, 10, 9 + Math.floor(i / 10), i % 60, 0),
                });
                originalCalls.push(call);
                seedEntries.push({
                    dedupKey: ledgerDedupKey('conv-yest', call),
                    cascadeId: 'conv-yest',
                    callIndex: i,
                    call,
                    accountEmail: 'user@example.com',
                    surface,
                });
            }
            expect(seedLedger.recordCalls(seedEntries)).toBe(100);

            const seedState = createFastDurableState(stateFile, { debounceMs: 5 });
            const seedStore = new DailyStore();
            seedStore.init(seedState.globalBucket());

            const originalActivity = makeActivitySummary();
            const archivalRes = await performDailyArchivalAsync({
                activityTracker: {
                    getSummary: () => originalActivity,
                    archiveAndReset: () => null,
                } as any,
                gmTracker: {
                    reset: () => {},
                    getDetailedSummary: () => null,
                    getCachedSummary: () => null,
                    getArchivalSummary: () => null,
                    getNewCallsSinceLastRecord: () => ({ entries: [], revertedCascadeIds: [] }),
                    markLedgerEntriesRecorded: () => {},
                } as any,
                dailyStore: seedStore,
                pricingStore: null,
                lastGMSummary: null,
                persistedModelDNA: {},
                lastArchivalDateKey: '2026-06-10',
                dailyLedger: seedLedger,
                surface: 'app',
                persist: async () => {
                    await seedState.flush();
                },
                log: () => {},
            }, false, localDate(2026, 6, 11, 0, 1, 0));

            expect(archivalRes.archived).toBe(true);
            const seedCommit = await seedState.flush();
            expect(seedCommit.committed).toBe(true);
            seedState.dispose();

            // Confirm baseline yesterday record on disk has 100 calls + nonzero activity + 60 app / 40 ide
            const verifySeedState = createFastDurableState(stateFile, { debounceMs: 5 });
            const verifySeedStore = new DailyStore();
            verifySeedStore.init(verifySeedState.globalBucket());
            const baseRec = verifySeedStore.getRecord('2026-06-10')!;
            expect(baseRec.cycles).toHaveLength(1);
            expect(baseRec.cycles[0].gmTotalCalls).toBe(100);
            expect(Object.keys(baseRec.cycles[0].lateMergedCalls ?? {})).toHaveLength(100);
            expect(baseRec.cycles[0].totalReasoning).toBe(42);
            expect(baseRec.cycles[0].totalToolCalls).toBe(19);
            expect(baseRec.cycles[0].surfaceBreakdown?.app?.calls).toBe(60);
            expect(baseRec.cycles[0].surfaceBreakdown?.ide?.calls).toBe(40);
            verifySeedState.dispose();

            // ── 2. Advance to next day (2026-06-11 00:05): App and IDE load shared state concurrently ──
            vi.setSystemTime(localDate(2026, 6, 11, 0, 5, 0));

            const appState = createFastDurableState(stateFile, { debounceMs: 5 });
            const appStore = new DailyStore();
            appStore.init(appState.globalBucket());
            const appLedger = new DailyLedger('2026-06-11', 'app');

            const ideState = createFastDurableState(stateFile, { debounceMs: 5 });
            const ideStore = new DailyStore();
            ideStore.init(ideState.globalBucket());
            const ideLedger = new DailyLedger('2026-06-11', 'ide');

            // Prepare App GMTracker with baselined pre-existing calls + 1 distinct late call L_app
            const lateCallApp = makeCall({
                executionId: 'late-app-unique',
                inputTokens: 5_000,
                outputTokens: 1_000,
                thinkingTokens: 200,
                cacheReadTokens: 10_000,
                cacheCreationTokens: 0,
                credits: 3,
                createdAt: localIso(2026, 6, 10, 23, 59, 30),
            });
            const lateCallIde = makeCall({
                executionId: 'late-ide-unique',
                inputTokens: 7_000,
                outputTokens: 1_500,
                thinkingTokens: 300,
                cacheReadTokens: 14_000,
                cacheCreationTokens: 0,
                credits: 4,
                createdAt: localIso(2026, 6, 10, 23, 59, 50),
            });

            const appTracker = new GMTracker();
            appTracker.setCurrentAccount('user@example.com');
            const appCache = (appTracker as any)._cache as Map<string, GMConversationData>;
            appCache.set('conv-yest', {
                cascadeId: 'conv-yest',
                title: 'Cross-midnight chat',
                totalSteps: 10,
                calls: [originalCalls[0], originalCalls[1]],
                lifetimeCalls: 2,
                coveredSteps: 2,
                coverageRate: 1,
                checkpointSummaries: [],
                systemContextItems: [],
            });
            // Establish prior acknowledged cursor at index 2 (simulating calls already handled yesterday)
            const appPreInit = appTracker.getNewCallsSinceLastRecord();
            appTracker.markLedgerEntriesRecorded(appPreInit.entries);
            // Save pre-crash tracker state (cursor at 2, BEFORE lateCallApp is acknowledged!)
            const preCrashAppTrackerSnapshot = appTracker.serialize();

            // App observes lateCallApp at array index 2
            appCache.get('conv-yest')!.calls = [originalCalls[0], originalCalls[1], lateCallApp];
            const appBatch = appTracker.getNewCallsSinceLastRecord();
            expect(appBatch.entries).toHaveLength(1);
            const appDetail = appLedger.recordCallsDetailed(appBatch.entries, 'app');
            expect(appDetail.statuses).toEqual(['added']);

            // Persist App's late call to history (state-v1.json)
            const appFlushed = await flushLateDaysToDailyStoreAsync(
                appLedger,
                appStore,
                undefined,
                'app',
                undefined,
                undefined,
                async () => (await appState.flush()).committed,
            );
            expect(appFlushed).toBe(1);

            // **SIMULATE CRASH between writing history (state-v1.json) and acknowledging cursor!**
            // We intentionally do NOT call appTracker.markLedgerEntriesRecorded(appBatch.entries)
            // and we discard appState/appLedger (restoring from preCrashAppTrackerSnapshot after restart).
            appState.dispose();

            // ── 3. Meanwhile, IDE (loaded from pre-App base) observes its distinct lateCallIde
            //       AND ALSO replays lateCallApp at a DIFFERENT mutable array index (index 5 instead of 2)! ──
            const ideTracker = new GMTracker();
            ideTracker.setCurrentAccount('user@example.com');
            const ideCache = (ideTracker as any)._cache as Map<string, GMConversationData>;
            ideCache.set('conv-yest', {
                cascadeId: 'conv-yest',
                title: 'Cross-midnight chat',
                totalSteps: 12,
                calls: originalCalls.slice(0, 5),
                lifetimeCalls: 5,
                coveredSteps: 5,
                coverageRate: 1,
                checkpointSummaries: [],
                systemContextItems: [],
            });
            const idePreInit = ideTracker.getNewCallsSinceLastRecord();
            ideTracker.markLedgerEntriesRecorded(idePreInit.entries);

            // IDE sees BOTH lateCallApp (replayed at index 5!) AND lateCallIde (at index 6!)
            ideCache.get('conv-yest')!.calls = [...originalCalls.slice(0, 5), lateCallApp, lateCallIde];
            const ideBatch = ideTracker.getNewCallsSinceLastRecord();
            expect(ideBatch.entries).toHaveLength(2);
            const ideDetail = ideLedger.recordCallsDetailed(ideBatch.entries, 'ide');
            expect(ideDetail.statuses).toEqual(['added', 'added']);

            const ideFlushed = await flushLateDaysToDailyStoreAsync(
                ideLedger,
                ideStore,
                undefined,
                'ide',
                undefined,
                undefined,
                async () => (await ideState.flush()).committed,
            );
            expect(ideFlushed).toBe(1);
            ideTracker.markLedgerEntriesRecorded(ideBatch.entries, ideDetail.statuses);
            ideState.dispose();

            // ── 4. Simulate App restart after crash: restore unacknowledged cursor & replay both lateCallApp + original call ──
            const restartedState = createFastDurableState(stateFile, { debounceMs: 5 });
            const restartedStore = new DailyStore();
            restartedStore.init(restartedState.globalBucket());
            const restartedLedger = new DailyLedger('2026-06-11', 'app');

            const restartedAppTracker = GMTracker.restore(preCrashAppTrackerSnapshot);
            restartedAppTracker.setCurrentAccount('user@example.com');
            // Unacknowledged cursor replays lateCallApp (plus an original archived call orig-42 at a shifted index!)
            ((restartedAppTracker as any)._cache as Map<string, GMConversationData>).set('conv-yest', {
                cascadeId: 'conv-yest',
                title: 'Cross-midnight chat',
                totalSteps: 10,
                calls: [
                    originalCalls[0],
                    originalCalls[1],
                    lateCallApp,
                    originalCalls[42],
                ],
                lifetimeCalls: 4,
                coveredSteps: 4,
                coverageRate: 1,
                checkpointSummaries: [],
                systemContextItems: [],
            });
            const replayBatch1 = restartedAppTracker.getNewCallsSinceLastRecord();
            expect(replayBatch1.entries).toHaveLength(2);
            const replayDet1 = restartedLedger.recordCallsDetailed(replayBatch1.entries, 'app');
            expect(replayDet1.statuses).toEqual(['added', 'added']);

            const replayFlushed1 = await flushLateDaysToDailyStoreAsync(
                restartedLedger,
                restartedStore,
                undefined,
                'app',
                undefined,
                undefined,
                async () => (await restartedState.flush()).committed,
            );
            // Zero new calls applied because BOTH lateCallApp and orig-42 were already archived!
            expect(replayFlushed1).toBe(0);
            // Late queue drained cleanly after confirmed persistence
            expect(restartedLedger.getLateDaySnapshots()).toHaveLength(0);
            restartedAppTracker.markLedgerEntriesRecorded(replayBatch1.entries, replayDet1.statuses);

            // Snapshot disk state after restart replay
            const afterRestartRecord = restartedStore.getRecord('2026-06-10')!;
            expect(afterRestartRecord.cycles).toHaveLength(1);
            const cycle = afterRestartRecord.cycles[0];

            // 1) EXACTLY 102 unique calls (100 original + L_app + L_ide)
            expect(cycle.gmTotalCalls).toBe(102);

            // 2) Original activity 100% preserved
            expect(cycle.totalReasoning).toBe(42);
            expect(cycle.totalToolCalls).toBe(19);
            expect(cycle.totalErrors).toBe(2);
            expect(cycle.totalInputTokens).toBe(12_000);
            expect(cycle.totalOutputTokens).toBe(3_400);
            expect(cycle.estSteps).toBe(88);
            expect(cycle.modelStats?.['Claude Opus 4.6 (Thinking)']?.reasoning).toBe(42);

            // 3) Accurate per-surface totals: app = 60 + 1 = 61, ide = 40 + 1 = 41
            expect(cycle.surfaceBreakdown?.app?.calls).toBe(61);
            expect(cycle.surfaceBreakdown?.ide?.calls).toBe(41);
            expect((cycle.surfaceBreakdown?.app?.calls || 0) + (cycle.surfaceBreakdown?.ide?.calls || 0)).toBe(102);

            // 4) Exact token & credit math (100 * 1000 + 5000 + 7000 = 112,000 input; 100*200 + 1000 + 1500 = 22,500 output)
            expect(cycle.gmModelStats?.['Claude Opus 4.6 (Thinking)']?.calls).toBe(102);
            expect(cycle.gmModelStats?.['Claude Opus 4.6 (Thinking)']?.inputTokens).toBe(112_000);
            expect(cycle.gmModelStats?.['Claude Opus 4.6 (Thinking)']?.outputTokens).toBe(22_500);
            expect(cycle.gmTotalTokens).toBe(134_500);
            expect(cycle.gmTotalCredits).toBe(100 + 3 + 4);

            const serializedAfterFirstRestart = JSON.stringify(afterRestartRecord);

            // 5) Second full replay of BOTH lateCallApp and lateCallIde (from a brand-new ledger) produces ZERO change!
            const secondReplayLedger = new DailyLedger('2026-06-11', 'ide');
            secondReplayLedger.recordCallsDetailed([
                {
                    dedupKey: `${ledgerDedupKey('conv-yest', lateCallApp)}`,
                    call: lateCallApp,
                    accountEmail: 'user@example.com',
                    surface: 'ide',
                },
                {
                    dedupKey: `conv-yest:99|${encodeURIComponent(`exec:${lateCallIde.executionId}`)}`,
                    call: lateCallIde,
                    accountEmail: 'user@example.com',
                    surface: 'app',
                },
            ]);
            const secondFlushed = await flushLateDaysToDailyStoreAsync(
                secondReplayLedger,
                restartedStore,
                undefined,
                'ide',
                undefined,
                undefined,
                async () => (await restartedState.flush()).committed,
            );
            expect(secondFlushed).toBe(0);
            expect(JSON.stringify(restartedStore.getRecord('2026-06-10'))).toBe(serializedAfterFirstRestart);
            restartedState.dispose();
        });

        it('never drains DailyLedger late queue when persistence fails and rolls back DailyStore cleanly for retry', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(localDate(2026, 6, 11, 0, 10, 0));

            const ledger = new DailyLedger('2026-06-11', 'app');
            ledger.recordCallsDetailed([{
                dedupKey: 'conv-1|exec%3Alate-retry-1',
                call: makeCall({ executionId: 'late-retry-1', createdAt: localIso(2026, 6, 10, 23, 59, 0) }),
                surface: 'app',
            }]);
            expect(ledger.getLateDaySnapshots()).toHaveLength(1);

            // Async rejection on attempt 1, success on attempt 2
            let attempts = 0;
            const flakyBucket = {
                get: <T>(_k: string, d: T): T => d,
                update: async () => {
                    attempts++;
                    if (attempts === 1) {
                        throw new Error('transient disk error');
                    }
                },
            };
            const store = new DailyStore();
            store.init(flakyBucket);

            const failCount = await flushLateDaysToDailyStoreAsync(ledger, store, undefined, undefined, undefined, undefined, () => true);
            expect(failCount).toBe(0);
            // Late queue MUST NOT be drained when persistence failed!
            expect(ledger.getLateDaySnapshots()).toHaveLength(1);
            // In-memory store rolled back so retry re-applies cleanly
            expect(store.getRecord('2026-06-10')).toBeNull();

            // Retry succeeds and drains queue
            const okCount = await flushLateDaysToDailyStoreAsync(ledger, store);
            expect(okCount).toBe(1);
            expect(ledger.getLateDaySnapshots()).toHaveLength(0);
            expect(store.getRecord('2026-06-10')?.cycles[0].gmTotalCalls).toBe(1);

            // Sync throw variant also preserves late queue
            ledger.recordCallsDetailed([{
                dedupKey: 'conv-1|exec%3Alate-sync-throw',
                call: makeCall({ executionId: 'late-sync-throw', createdAt: localIso(2026, 6, 10, 23, 59, 15) }),
                surface: 'app',
            }]);
            const throwingStore = new DailyStore();
            throwingStore.init({
                get: <T>(_k: string, d: T): T => d,
                update: () => { throw new Error('sync EACCES'); },
            });
            expect(flushLateDaysToDailyStore(ledger, throwingStore)).toBe(0);
            expect(ledger.getLateDaySnapshots()).toHaveLength(1);
            expect(throwingStore.getRecord('2026-06-10')).toBeNull();
        });

        it('GMTracker routes 48h late calls without rescanning first-start baseline, uses index-independent IDs, and advances cursor strictly contiguously', () => {
            vi.useFakeTimers();
            vi.setSystemTime(localDate(2026, 6, 11, 10, 0, 0));

            const tracker = new GMTracker();
            tracker.setCurrentAccount('user@example.com');
            const cache = (tracker as any)._cache as Map<string, GMConversationData>;

            const baselinedOldCall = makeCall({
                executionId: 'baselined-0',
                createdAt: localIso(2026, 6, 10, 20, 0, 0),
            });
            const lateWithin48h = makeCall({
                executionId: 'late-36h',
                createdAt: localIso(2026, 6, 9, 23, 30, 0), // ~34.5h ago -> inside 48h window
            });
            const tooOldBeyond48h = makeCall({
                executionId: 'ancient-72h',
                createdAt: localIso(2026, 6, 8, 9, 0, 0), // >48h ago
            });
            const todayCall = makeCall({
                executionId: 'today-1',
                createdAt: localIso(2026, 6, 11, 9, 55, 0),
            });

            // Simulate first-start baseline = 1 (baselinedOldCall MUST NEVER be rescanned!)
            ((tracker as any)._callBaselines as Map<string, number>).set('conv-win', 1);
            cache.set('conv-win', {
                cascadeId: 'conv-win',
                title: 'Window Test',
                totalSteps: 4,
                calls: [baselinedOldCall, lateWithin48h, tooOldBeyond48h, todayCall],
                lifetimeCalls: 4,
                coveredSteps: 4,
                coverageRate: 1,
                checkpointSummaries: [],
                systemContextItems: [],
            });

            // Durable logical call ID is independent of mutable array index
            expect(ledgerDedupKey('conv-win', lateWithin48h)).toBe('conv-win|exec%3Alate-36h');
            expect(canonicalLogicalCallId('conv-win:7|exec%3Alate-36h')).toBe('conv-win|exec%3Alate-36h');

            const extracted = tracker.getNewCallsSinceLastRecord();
            // baselinedOldCall (index 0) is NEVER emitted; lateWithin48h (index 1) & todayCall (index 3) ARE emitted!
            // tooOldBeyond48h (index 2) is beyond 48h window so skipped by normal extraction.
            expect(extracted.entries.map(e => e.call.executionId)).toEqual(['late-36h', 'today-1']);
            expect(extracted.entries.map(e => e.callIndex)).toEqual([1, 3]);

            // Contiguous cursor advancement with a retryable gap at index 1!
            const gapTracker = new GMTracker();
            gapTracker.setCurrentAccount('user@example.com');
            const gapCache = (gapTracker as any)._cache as Map<string, GMConversationData>;
            const c0 = makeCall({ executionId: 'g0', createdAt: localIso(2026, 6, 11, 9, 0) });
            const c1 = makeCall({ executionId: 'g1', createdAt: localIso(2026, 6, 11, 9, 1) });
            const c2 = makeCall({ executionId: 'g2', createdAt: localIso(2026, 6, 11, 9, 2) });
            gapCache.set('conv-gap', {
                cascadeId: 'conv-gap',
                title: 'Gap',
                totalSteps: 3,
                calls: [c0, c1, c2],
                lifetimeCalls: 3,
                coveredSteps: 3,
                coverageRate: 1,
                checkpointSummaries: [],
                systemContextItems: [],
            });

            const firstBatch = gapTracker.getNewCallsSinceLastRecord();
            expect(firstBatch.entries.map(e => e.call.executionId)).toEqual(['g0', 'g1', 'g2']);

            // Mark [added, retryable, added]: cursor MUST stop at 1 (before retryable g1),
            // while remembering g2 as already acknowledged so g2 is NOT re-emitted!
            gapTracker.markLedgerEntriesRecorded(firstBatch.entries, ['added', 'retryable', 'added']);
            expect(((gapTracker as any)._ledgerPositions as Map<string, number>).get('conv-gap')).toBe(1);

            // Serialize & restore across restart: sparse identity hole at index 1 must survive cleanly!
            const restoredGap = GMTracker.restore(gapTracker.serialize());
            restoredGap.setCurrentAccount('user@example.com');
            ((restoredGap as any)._cache as Map<string, GMConversationData>).set('conv-gap', {
                cascadeId: 'conv-gap',
                title: 'Gap',
                totalSteps: 3,
                calls: [c0, c1, c2],
                lifetimeCalls: 3,
                coveredSteps: 3,
                coverageRate: 1,
                checkpointSummaries: [],
                systemContextItems: [],
            });
            const retryBatch = restoredGap.getNewCallsSinceLastRecord();
            expect(retryBatch.entries.map(e => e.call.executionId)).toEqual(['g1']);

            // Now mark g1 added -> cursor advances contiguously across g1 AND already-acked g2 to 3!
            restoredGap.markLedgerEntriesRecorded(retryBatch.entries, ['added']);
            expect(((restoredGap as any)._ledgerPositions as Map<string, number>).get('conv-gap')).toBe(3);
            expect(restoredGap.getNewCallsSinceLastRecord().entries).toEqual([]);
        });

        it('mergeSettledEntries merges deduplicated calls & disjoint models across App + IDE without dropping either host', () => {
            const sharedSettledAt = localIso(2026, 6, 10, 14, 0, 0);

            const appSettled: LedgerSettledEntry = {
                settledAt: sharedSettledAt,
                accountEmail: 'user@example.com',
                poolModelIds: ['MODEL_A', 'MODEL_B'],
                totalCalls: 2,
                totalInputTokens: 3_000,
                totalOutputTokens: 600,
                totalThinkingTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
                totalCredits: 2,
                totalEstimatedCost: 0.30,
                modelCalls: { 'Model A': 2 },
                surface: 'app',
                recordedCallIds: ['conv|exec%3As1', 'conv|exec%3As2'],
                settledCalls: [
                    {
                        callId: 'conv|exec%3As1',
                        createdAt: localIso(2026, 6, 10, 13, 0),
                        createdAtMs: localDate(2026, 6, 10, 13, 0).getTime(),
                        modelId: 'MODEL_A',
                        modelKey: 'Model A',
                        inputTokens: 1_000,
                        outputTokens: 200,
                        thinkingTokens: 0,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                        credits: 1,
                        estimatedCost: 0.10,
                        surface: 'app',
                    },
                    {
                        callId: 'conv|exec%3As2',
                        createdAt: localIso(2026, 6, 10, 13, 10),
                        createdAtMs: localDate(2026, 6, 10, 13, 10).getTime(),
                        modelId: 'MODEL_A',
                        modelKey: 'Model A',
                        inputTokens: 2_000,
                        outputTokens: 400,
                        thinkingTokens: 0,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                        credits: 1,
                        estimatedCost: 0.20,
                        surface: 'app',
                    },
                ],
            };

            const ideSettled: LedgerSettledEntry = {
                settledAt: sharedSettledAt,
                accountEmail: 'user@example.com',
                poolModelIds: ['MODEL_A', 'MODEL_B'],
                totalCalls: 2,
                totalInputTokens: 6_000,
                totalOutputTokens: 1_200,
                totalThinkingTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
                totalCredits: 3,
                totalEstimatedCost: 0.60,
                modelCalls: { 'Model A': 1, 'Model B': 1 },
                surface: 'ide',
                recordedCallIds: ['conv:5|exec%3As2', 'conv|exec%3As3'],
                settledCalls: [
                    {
                        // Same logical call s2 with legacy positional index prefix — MUST deduplicate!
                        callId: 'conv:5|exec%3As2',
                        createdAt: localIso(2026, 6, 10, 13, 10),
                        createdAtMs: localDate(2026, 6, 10, 13, 10).getTime(),
                        modelId: 'MODEL_A',
                        modelKey: 'Model A',
                        inputTokens: 2_000,
                        outputTokens: 400,
                        thinkingTokens: 0,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                        credits: 1,
                        estimatedCost: 0.20,
                        surface: 'ide',
                    },
                    {
                        callId: 'conv|exec%3As3',
                        createdAt: localIso(2026, 6, 10, 13, 20),
                        createdAtMs: localDate(2026, 6, 10, 13, 20).getTime(),
                        modelId: 'MODEL_B',
                        modelKey: 'Model B',
                        inputTokens: 4_000,
                        outputTokens: 800,
                        thinkingTokens: 0,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                        credits: 2,
                        estimatedCost: 0.40,
                        surface: 'ide',
                    },
                ],
            };

            const merged = mergeDailyLedgerState3Way(
                undefined,
                { version: 1, dateKey: '2026-06-10', accounts: {}, settled: [appSettled] },
                { version: 1, dateKey: '2026-06-10', accounts: {}, settled: [ideSettled] },
            ) as { settled: LedgerSettledEntry[] };

            expect(merged.settled).toHaveLength(1);
            const s = merged.settled[0];
            // Union of {s1, s2} and {s2, s3} = exactly 3 unique calls (never 2, never 4!)
            expect(s.totalCalls).toBe(3);
            expect(s.totalInputTokens).toBe(7_000);
            expect(s.totalOutputTokens).toBe(1_400);
            expect(s.totalCredits).toBe(4);
            expect(s.modelCalls).toEqual({ 'Model A': 2, 'Model B': 1 });
            expect(s.surfaceBreakdown?.app?.calls).toBe(2);
            expect(s.surfaceBreakdown?.ide?.calls).toBe(1);

            // Legacy settled entries (no settledCalls) with disjoint models merge BOTH models instead of dropping one host!
            const legacyApp: LedgerSettledEntry = {
                settledAt: sharedSettledAt,
                accountEmail: 'user@example.com',
                poolModelIds: ['MODEL_A', 'MODEL_B'],
                totalCalls: 3,
                totalInputTokens: 3_000,
                totalOutputTokens: 300,
                totalThinkingTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
                totalCredits: 3,
                totalEstimatedCost: 0.3,
                modelCalls: { 'Model A': 3 },
                modelStats: {
                    'Model A': {
                        calls: 3, inputTokens: 3_000, outputTokens: 300,
                        thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, credits: 3, estimatedCost: 0.3,
                    },
                },
                surface: 'app',
            };
            const legacyIde: LedgerSettledEntry = {
                settledAt: sharedSettledAt,
                accountEmail: 'user@example.com',
                poolModelIds: ['MODEL_A', 'MODEL_B'],
                totalCalls: 2,
                totalInputTokens: 2_000,
                totalOutputTokens: 200,
                totalThinkingTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
                totalCredits: 2,
                totalEstimatedCost: 0.2,
                modelCalls: { 'Model B': 2 },
                modelStats: {
                    'Model B': {
                        calls: 2, inputTokens: 2_000, outputTokens: 200,
                        thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, credits: 2, estimatedCost: 0.2,
                    },
                },
                surface: 'ide',
            };
            const legacyMerged = mergeDailyLedgerState3Way(
                undefined,
                { version: 1, dateKey: '2026-06-10', accounts: {}, settled: [legacyApp] },
                { version: 1, dateKey: '2026-06-10', accounts: {}, settled: [legacyIde] },
            ) as { settled: LedgerSettledEntry[] };
            expect(legacyMerged.settled).toHaveLength(1);
            expect(legacyMerged.settled[0].totalCalls).toBe(5);
            expect(legacyMerged.settled[0].modelCalls).toEqual({ 'Model A': 3, 'Model B': 2 });

            // Partial overlap on legacy entries WITHOUT settledCalls:
            // disk={Model A: 10}, local={Model A: 10, Model B: 1} on the SAME surface MUST NOT double-count Model A!
            const partialDisk: LedgerSettledEntry = {
                settledAt: sharedSettledAt,
                accountEmail: 'user@example.com',
                poolModelIds: ['MODEL_A', 'MODEL_B'],
                totalCalls: 10,
                totalInputTokens: 10_000,
                totalOutputTokens: 1_000,
                totalThinkingTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
                totalCredits: 10,
                totalEstimatedCost: 1.0,
                modelCalls: { 'Model A': 10 },
                modelStats: {
                    'Model A': {
                        calls: 10, inputTokens: 10_000, outputTokens: 1_000,
                        thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, credits: 10, estimatedCost: 1.0,
                    },
                },
                surface: 'app',
                surfaceBreakdown: {
                    app: {
                        calls: 10, inputTokens: 10_000, outputTokens: 1_000,
                        thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, credits: 10, estimatedCost: 1.0,
                    },
                },
            };
            const partialLocal: LedgerSettledEntry = {
                settledAt: sharedSettledAt,
                accountEmail: 'user@example.com',
                poolModelIds: ['MODEL_A', 'MODEL_B'],
                totalCalls: 11,
                totalInputTokens: 11_000,
                totalOutputTokens: 1_100,
                totalThinkingTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
                totalCredits: 11,
                totalEstimatedCost: 1.1,
                modelCalls: { 'Model A': 10, 'Model B': 1 },
                modelStats: {
                    'Model A': {
                        calls: 10, inputTokens: 10_000, outputTokens: 1_000,
                        thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, credits: 10, estimatedCost: 1.0,
                    },
                    'Model B': {
                        calls: 1, inputTokens: 1_000, outputTokens: 100,
                        thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, credits: 1, estimatedCost: 0.1,
                    },
                },
                surface: 'app',
                surfaceBreakdown: {
                    app: {
                        calls: 11, inputTokens: 11_000, outputTokens: 1_100,
                        thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, credits: 11, estimatedCost: 1.1,
                    },
                },
            };
            const partialMerged = mergeDailyLedgerState3Way(
                undefined,
                { version: 1, dateKey: '2026-06-10', accounts: {}, settled: [partialDisk] },
                { version: 1, dateKey: '2026-06-10', accounts: {}, settled: [partialLocal] },
            ) as { settled: LedgerSettledEntry[] };
            expect(partialMerged.settled).toHaveLength(1);
            expect(partialMerged.settled[0].totalCalls).toBe(11);
            expect(partialMerged.settled[0].totalInputTokens).toBe(11_000);
            expect(partialMerged.settled[0].modelCalls).toEqual({ 'Model A': 10, 'Model B': 1 });
            expect(partialMerged.settled[0].surfaceBreakdown?.app?.calls).toBe(11);

            // Same partial overlap WITHOUT modelStats (modelCalls-only legacy entries) also avoids double-counting Model A
            const { modelStats: _dMs, ...partialDiskNoStats } = partialDisk;
            const { modelStats: _lMs, ...partialLocalNoStats } = partialLocal;
            const partialNoStatsMerged = mergeDailyLedgerState3Way(
                undefined,
                { version: 1, dateKey: '2026-06-10', accounts: {}, settled: [partialDiskNoStats] },
                { version: 1, dateKey: '2026-06-10', accounts: {}, settled: [partialLocalNoStats] },
            ) as { settled: LedgerSettledEntry[] };
            expect(partialNoStatsMerged.settled[0].totalCalls).toBe(11);
            expect(partialNoStatsMerged.settled[0].totalInputTokens).toBe(11_000);
            expect(partialNoStatsMerged.settled[0].surfaceBreakdown?.app?.calls).toBe(11);
        });

        it('merges independent midnight archives, redacts identity fields, and expires original projections', () => {
            const project = '/sentinel/project';
            const authority = 'sentinel-host';
            const account = 'sentinel@example.test';
            const call = (callId: string): DailyMergedLateCall => ({
                callId, createdAt: '2026-06-10T10:00:00Z', createdAtMs: 1, modelId: 'm', modelKey: 'Model',
                inputTokens: 50, outputTokens: 10, thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
                credits: 1, estimatedCost: 0.1, accountEmail: account, account, workspace: project,
                authority, cascadeId: 'sentinel-session', surface: 'app',
            });
            const day = '2026-06-10';
            const archive = (id: string) => {
                const store = new DailyStore();
                const calls = [call('sentinel-common'), call(id)];
                store.addDailySnapshot(day, makeActivitySummary(), null, undefined, undefined, false,
                    { snapshotCalls: calls, recordedCallIds: calls.map(c => c.callId), accountEmail: account });
                const cycle = store.getRecord(day)!.cycles[0];
                cycle.gmTotalCalls = 2;
                cycle.gmTotalTokens = 120;
                return store;
            };
            const a = archive('sentinel-a'), b = archive('sentinel-b');
            const merged = mergeDailyStoreState3Way(undefined, { ...a.serialize() }, { ...b.serialize() });
            const record = (merged.records as Record<string, ReturnType<DailyStore['getAllRecords']>[number]>)[day];
            expect(record.cycles[0].gmTotalCalls).toBe(3);
            expect(record.cycles[0].gmTotalTokens).toBe(180);
            const handles = new Map<string, string>();
            const masked = redactDailyRecordIdentities(record, value => {
                if (!handles.has(value)) { handles.set(value, `handle-${handles.size}`); }
                return handles.get(value)!;
            });
            expect(JSON.stringify(masked)).not.toContain('sentinel');
            expect(masked.cycles[0].recordedCallIds).toEqual(Object.keys(masked.cycles[0].lateMergedCalls!));
            expect(record.cycles[0].accountEmail).toBe(account);
            for (const next of ['2026-06-11', '2026-06-12']) { a.addDailySnapshot(next, makeActivitySummary(), null); }
            expect(a.getRecord(day)!.cycles[0].lateMergedCalls).toBeUndefined();
            expect(a.getRecord(day)!.cycles[0].recordedCallIds).toHaveLength(2);
        });

        it('keeps UNC and WSL authorities distinct in workspace attribution', () => {
            expect(normalizeWorkspaceKey('file://fileserver/share/Repo')).toBe('//fileserver/share/Repo');
            expect(normalizeWorkspaceKey('file://backup/share/Repo')).toBe('//backup/share/Repo');
            expect(normalizeWorkspaceKey('file://wsl.localhost/Debian/home/User')).toBe('//wsl.localhost/Debian/home/User');
        });

        it('mergeDailyStoreState3Way targets the primary non-CLI cycle when a day contains [cliCycle, appIdeCycle]', () => {
            const cliCycle = {
                startTime: '2026-06-10T00:00:00',
                endTime: '2026-06-10T23:59:59',
                totalReasoning: 0,
                totalToolCalls: 0,
                totalErrors: 0,
                totalInputTokens: 0,
                totalOutputTokens: 0,
                estSteps: 0,
                modelNames: [],
                surface: 'cli',
                gmTotalCalls: 5,
                gmTotalTokens: 5_000,
            };
            const baseAppIdeCycle = {
                startTime: '2026-06-10T00:00:00',
                endTime: '2026-06-10T23:59:59',
                totalReasoning: 12,
                totalToolCalls: 4,
                totalErrors: 0,
                totalInputTokens: 2_000,
                totalOutputTokens: 500,
                estSteps: 20,
                modelNames: ['Claude Opus 4.6 (Thinking)'],
                surface: 'app',
                gmTotalCalls: 10,
                gmTotalTokens: 10_000,
                recordedCallIds: ['conv|exec%3Abase-1'],
                lateMergedCalls: {},
            };

            const diskAppIde = {
                ...baseAppIdeCycle,
                gmTotalCalls: 11,
                gmTotalTokens: 11_200,
                recordedCallIds: ['conv|exec%3Abase-1', 'conv|exec%3Alate-app'],
                lateMergedCalls: {
                    'conv|exec%3Alate-app': {
                        callId: 'conv|exec%3Alate-app',
                        createdAt: localIso(2026, 6, 10, 23, 59, 30),
                        createdAtMs: localDate(2026, 6, 10, 23, 59, 30).getTime(),
                        modelId: 'MODEL_PLACEHOLDER_M400',
                        modelKey: 'Claude Opus 4.6 (Thinking)',
                        inputTokens: 1_000,
                        outputTokens: 200,
                        thinkingTokens: 0,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                        credits: 1,
                        estimatedCost: 0.05,
                        surface: 'app',
                    },
                },
            };
            const localAppIde = {
                ...baseAppIdeCycle,
                gmTotalCalls: 11,
                gmTotalTokens: 12_400,
                recordedCallIds: ['conv|exec%3Abase-1', 'conv|exec%3Alate-ide'],
                lateMergedCalls: {
                    'conv|exec%3Alate-ide': {
                        callId: 'conv|exec%3Alate-ide',
                        createdAt: localIso(2026, 6, 10, 23, 59, 45),
                        createdAtMs: localDate(2026, 6, 10, 23, 59, 45).getTime(),
                        modelId: 'MODEL_PLACEHOLDER_M400',
                        modelKey: 'Claude Opus 4.6 (Thinking)',
                        inputTokens: 2_000,
                        outputTokens: 400,
                        thinkingTokens: 0,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                        credits: 2,
                        estimatedCost: 0.10,
                        surface: 'ide',
                        workspace: '/shared/project',
                    },
                },
            };

            const merged = mergeDailyStoreState3Way(
                { version: 1, records: { '2026-06-10': { date: '2026-06-10', cycles: [cliCycle, baseAppIdeCycle] } } },
                { version: 1, records: { '2026-06-10': { date: '2026-06-10', cycles: [cliCycle, diskAppIde] } } },
                { version: 1, records: { '2026-06-10': { date: '2026-06-10', cycles: [cliCycle, localAppIde] } } },
            ) as { records: Record<string, { cycles: Array<Record<string, unknown>> }> };

            const cycles = merged.records['2026-06-10'].cycles;
            expect(cycles).toHaveLength(2);
            // cycles[0] (CLI-only) MUST remain completely untouched!
            expect(cycles[0].surface).toBe('cli');
            expect(cycles[0].gmTotalCalls).toBe(5);
            expect(cycles[0].lateMergedCalls).toBeUndefined();
            // cycles[1] (App/IDE) MUST receive BOTH late calls cleanly!
            expect(cycles[1].gmTotalCalls).toBe(12);
            expect(cycles[1].totalReasoning).toBe(12);
            // A subsequent late call must not promote partial model rows into
            // a full historical breakdown and discard the legacy GM baseline.
            const another = { ...localAppIde.lateMergedCalls['conv|exec%3Alate-ide'], callId: 'conv|later', surface: 'ide' as const };
            const replay = mergeLateCallsIntoCycle(cycles[1] as unknown as DailyCycleEntry, [another]);
            expect(replay.cycle.gmTotalTokens).toBe(16_000);
            expect(computeCycleTokenTotals(replay.cycle).totalTokens).toBe(16_000);
            expect(cycles[1].gmTotalTokens).toBe(13_600);
            expect(cycles[1].workspaceBreakdown).toMatchObject({
                '/shared/project': { calls: 1, knownCostUsd: 0.1, bySurface: { ide: { calls: 1 } } },
                __unattributed__: { calls: 11 },
            });
            expect(Object.keys((cycles[1].lateMergedCalls as Record<string, unknown>) || {}).sort()).toEqual([
                'conv|exec%3Alate-app',
                'conv|exec%3Alate-ide',
            ]);
        });

        it('performDailyArchivalAsync awaits async preArchivalFlush BEFORE sweeping and rolling over', async () => {
            vi.useFakeTimers({ toFake: ['Date'] });
            vi.setSystemTime(localDate(2026, 6, 11, 0, 0, 5));

            const ledger = new DailyLedger('2026-06-10', 'app');
            const store = new DailyStore();
            const events: string[] = [];

            const ctx: DailyArchivalContext = {
                activityTracker: {
                    getSummary: () => makeActivitySummary({ totalReasoning: 0, totalToolCalls: 0 }),
                    archiveAndReset: () => { events.push('reset'); return null; },
                } as any,
                gmTracker: {
                    reset: () => {},
                    getDetailedSummary: () => null,
                    getCachedSummary: () => null,
                    getArchivalSummary: () => null,
                    getNewCallsSinceLastRecord: () => ({ entries: [], revertedCascadeIds: [] }),
                    markLedgerEntriesRecorded: () => {},
                } as any,
                dailyStore: store,
                pricingStore: null,
                lastGMSummary: null,
                persistedModelDNA: {},
                lastArchivalDateKey: '2026-06-10',
                dailyLedger: ledger,
                surface: 'app',
                preArchivalFlush: async () => {
                    events.push('preFlush:start');
                    await new Promise<void>((resolve) => setTimeout(resolve, 25));
                    ledger.recordCalls([{
                        dedupKey: 'conv-async|exec%3Aasync-last-second',
                        call: makeCall({
                            executionId: 'async-last-second',
                            inputTokens: 9_000,
                            outputTokens: 1_000,
                            createdAt: localIso(2026, 6, 10, 23, 59, 58),
                        }),
                        surface: 'app',
                    }]);
                    events.push('preFlush:done');
                },
                persist: async () => { events.push('persist'); },
                log: () => {},
            };

            const res = await performDailyArchivalAsync(ctx, false, localDate(2026, 6, 11, 0, 0, 5));
            expect(res.archived).toBe(true);
            expect(events).toEqual(['preFlush:start', 'preFlush:done', 'reset', 'persist']);
            expect(store.getRecord('2026-06-10')?.cycles[0].gmTotalCalls).toBe(1);
            expect(store.getRecord('2026-06-10')?.cycles[0].gmTotalTokens).toBe(10_000);
        });
    });


    describe('W1A-FIX-3: DurableState real commit receipts, retry backoff & hardened lock fencing', () => {
        let tempDir: string;

        beforeEach(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-w1a-fix3-'));
        });

        afterEach(() => {
            vi.restoreAllMocks();
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        it('returns real commit receipts, keeps waiters pending during retry backoff, and resolves failed when retries exhaust', async () => {
            const filePath = path.join(tempDir, 'receipt-state.json');
            const seed = createFastDurableState(filePath, { debounceMs: 5 });
            const initReceipt = await seed.updateGlobalWithReceipt('displayLanguage', 'en');
            expect(initReceipt).toMatchObject({ committed: true, status: 'committed', retryScheduled: false });
            expect(initReceipt.revision).toBeGreaterThan(0);
            seed.dispose();

            // 1. Exhausted retries -> waiter MUST resolve with committed: false, status: 'failed' (NEVER saved!)
            const lockPath = `${filePath}.lock`;
            fs.writeFileSync(lockPath, `777777:${Date.now()}:held-lock:${os.hostname()}\n`, 'utf8');
            vi.spyOn(console, 'warn').mockImplementation(() => {});

            const exhaustingWriter = createFastDurableState(filePath, {
                debounceMs: 5,
                retryDelayMs: 15,
                maxRetryAttempts: 1,
                lockOptions: { timeoutMs: 20, isPidAlive: () => true },
            });
            const receiptPromise = exhaustingWriter.updateGlobalWithReceipt('displayLanguage', 'zh');
            const firstFlush = await exhaustingWriter.flush();
            expect(firstFlush.committed).toBe(false);
            expect(firstFlush.status).toBe('pending');
            expect(firstFlush.retryScheduled).toBe(true);
            expect(firstFlush.errorCode).toBe('ELOCKTIMEOUT');

            // After retry 1 also fails, retries are exhausted -> receiptPromise resolves with committed: false
            const finalReceipt = await receiptPromise;
            expect(finalReceipt.committed).toBe(false);
            expect(finalReceipt.status).toBe('failed');
            expect(finalReceipt.retryScheduled).toBe(false);
            expect(finalReceipt.errorCode).toBe('ELOCKTIMEOUT');
            expect(exhaustingWriter.hasPendingWrites()).toBe(true);
            expect(exhaustingWriter.getCommitStatus().committed).toBe(false);
            exhaustingWriter.dispose();

            // 2. When lock clears before retry exhaustion, updateAppSettingsWithReceipt commits cleanly
            const recoveringWriter = createFastDurableState(filePath, {
                debounceMs: 5,
                retryDelayMs: 20,
                maxRetryAttempts: 5,
                lockOptions: { timeoutMs: 20, isPidAlive: () => true },
            });
            const settingsPromise = recoveringWriter.updateAppSettingsWithReceipt({ displayCurrency: 'CNY' });
            const pendingFlush = await recoveringWriter.flush();
            expect(pendingFlush.committed).toBe(false);
            expect(pendingFlush.retryScheduled).toBe(true);

            // Release lock -> automatic backoff retry commits and resolves settingsPromise!
            fs.unlinkSync(lockPath);
            const committedSettings = await settingsPromise;
            expect(committedSettings.receipt.committed).toBe(true);
            expect(committedSettings.receipt.status).toBe('committed');
            expect(committedSettings.settings.displayCurrency).toBe('CNY');
            expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).global.appSettings.displayCurrency).toBe('CNY');
            recoveringWriter.dispose();
        });

        it('enforces explicit single-host safety check and never reclaims a foreign-host lock via local isPidAlive', async () => {
            const lockPath = path.join(tempDir, 'foreign-host.lock');
            const foreignBody = `999999:${Date.now()}:foreigntoken:other-machine.local\n`;
            fs.writeFileSync(lockPath, foreignBody, 'utf8');

            // Even though local isPidAlive returns false for PID 999999, foreign hostId MUST NOT be treated as dead local PID!
            await expect(acquireFencedLockFile(lockPath, {
                timeoutMs: 60,
                staleMs: 5_000,
                hardStaleMs: 15_000,
                hostId: 'this-machine.local',
                isPidAlive: () => false,
            })).rejects.toBeInstanceOf(DurableStateLockTimeoutError);

            // Foreign lockfile remains untouched
            expect(fs.readFileSync(lockPath, 'utf8')).toBe(foreignBody);
        });

        it.each(['same-host', 'foreign-host', 'empty'])('preserves old %s locks despite a wall-clock jump and expired hard age', async owner => {
            const lockPath = path.join(tempDir, 'clock-jump.lock');
            const original = owner === 'empty' ? '' : `888888:1000:existing:${owner}\n`;
            fs.writeFileSync(lockPath, original);
            fs.utimesSync(lockPath, new Date(1000), new Date(1000));
            await expect(acquireFencedLockFile(lockPath, {
                hostId: 'same-host', isPidAlive: () => owner === 'same-host',
                now: () => Date.now() + 7 * 86_400_000,
                staleMs: 1, hardStaleMs: 2, timeoutMs: 25,
            })).rejects.toBeInstanceOf(DurableStateLockTimeoutError);
            expect(fs.readFileSync(lockPath, 'utf8')).toBe(original);
        });

        it('times out before touching a suspended reclaim guard and retains its stale target', async () => {
            const lockPath = path.join(tempDir, 'guarded.lock');
            const guard = `${lockPath}.reclaim`;
            const dead = '777777:1000:dead:local';
            fs.writeFileSync(lockPath, dead);
            fs.writeFileSync(guard, 'existing guard');
            fs.utimesSync(guard, new Date(1000), new Date(1000));
            await expect(acquireFencedLockFile(lockPath, { hostId: 'local', isPidAlive: () => false, timeoutMs: 25 }))
                .rejects.toBeInstanceOf(DurableStateLockTimeoutError);
            expect(fs.readFileSync(guard, 'utf8')).toBe('existing guard');
            expect(fs.readFileSync(lockPath, 'utf8')).toBe(dead);
        });

        it('protects against stale-reclaim race when a dead lock is replaced by a fresh live writer lock', async () => {
            const lockPath = path.join(tempDir, 'reclaim-race.lock');
            const staleBody = `888888:${Date.now() - 60_000}:deadtoken:host-a\n`;
            fs.writeFileSync(lockPath, staleBody, 'utf8');

            // Intercept the .reclaim guard publication (POSIX hardlink or Windows wx open) to simulate
            // Peer B replacing the stale lock with a brand-new live lock right before Peer A's reclaimer runs!
            const realOpen = fs.promises.open.bind(fs.promises);
            const realLink = fs.promises.link.bind(fs.promises);
            let replaced = false;
            const freshLiveBody = `555555:${Date.now()}:brandnewlive:host-a\n`;
            const injectReplacement = () => {
                if (!replaced) {
                    replaced = true;
                    // Peer B replaces the stale lock with a brand-new inode + ownerToken!
                    fs.unlinkSync(lockPath);
                    fs.writeFileSync(lockPath, freshLiveBody, 'utf8');
                }
            };
            vi.spyOn(fs.promises, 'open').mockImplementation(async (p, flags, mode) => {
                if (String(p).endsWith('.reclaim') && flags === 'wx') { injectReplacement(); }
                return realOpen(p, flags, mode);
            });
            vi.spyOn(fs.promises, 'link').mockImplementation(async (existingPath, newPath) => {
                if (String(newPath).endsWith('.reclaim')) { injectReplacement(); }
                return realLink(existingPath, newPath);
            });

            await expect(acquireFencedLockFile(lockPath, {
                timeoutMs: 80,
                staleMs: 5_000,
                hardStaleMs: 15_000,
                hostId: 'host-a',
                isPidAlive: (pid) => pid === 555555,
            })).rejects.toBeInstanceOf(DurableStateLockTimeoutError);

            // Peer B's fresh live lock MUST still exist and be completely intact!
            expect(replaced).toBe(true);
            const onDisk = parseLockFileContent(fs.readFileSync(lockPath, 'utf8'));
            expect(onDisk?.pid).toBe(555555);
            expect(onDisk?.token).toBe('brandnewlive');
        });

        it('aborts commit with ELOCKLOST and cleans up temp file if lock ownership is lost before atomic rename', async () => {
            const filePath = path.join(tempDir, 'fencing.json');
            const seed = createFastDurableState(filePath, { debounceMs: 5 });
            await seed.updateGlobalWithReceipt('displayLanguage', 'en');
            seed.dispose();

            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const realWriteFile = fs.promises.writeFile.bind(fs.promises);
            let hijacked = false;

            vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (p, data, opts) => {
                const res = await realWriteFile(p, data, opts);
                if (!hijacked && String(p).endsWith('.tmp')) {
                    hijacked = true;
                    // Simulate another host reclaiming the lock AND writing newer state right before our rename!
                    fs.writeFileSync(`${filePath}.lock`, `666666:${Date.now()}:hijacktoken:${os.hostname()}\n`, 'utf8');
                    fs.writeFileSync(filePath, JSON.stringify({
                        version: 1,
                        global: { displayLanguage: 'fr' },
                        workspaces: {},
                    }), 'utf8');
                }
                return res;
            });

            const writer = createFastDurableState(filePath, {
                debounceMs: 5,
                maxRetryAttempts: 0,
                lockOptions: { timeoutMs: 50, isPidAlive: () => true },
            });
            const writePromise = writer.updateGlobalWithReceipt('displayLanguage', 'zh');
            const flushReceipt = await writer.flush();

            expect(hijacked).toBe(true);
            expect(flushReceipt.committed).toBe(false);
            expect(flushReceipt.errorCode).toBe('ELOCKLOST');
            expect(flushReceipt.status).toBe('failed');
            await expect(writePromise).resolves.toMatchObject({ committed: false, errorCode: 'ELOCKLOST', status: 'failed' });

            // Newer disk state ('fr') was NOT clobbered, orphan .tmp was deleted, and hijack lock was NOT deleted!
            expect(JSON.parse(fs.readFileSync(filePath, 'utf8')).global.displayLanguage).toBe('fr');
            expect(fs.readdirSync(tempDir).filter(f => f.endsWith('.tmp'))).toEqual([]);
            expect(parseLockFileContent(fs.readFileSync(`${filePath}.lock`, 'utf8'))?.token).toBe('hijacktoken');
            writer.dispose();
        });

        it('keeps v1 waiters pending (never fails prematurely) when v2 arms _saveTimer during a transiently failing v1 flush', async () => {
            const filePath = path.join(tempDir, 'inflight-v2.json');
            const seed = createFastDurableState(filePath, { debounceMs: 5 });
            await seed.updateGlobalWithReceipt('displayLanguage', 'en');
            seed.dispose();

            const lockPath = `${filePath}.lock`;
            fs.writeFileSync(lockPath, `777777:${Date.now()}:active-writer:${os.hostname()}\n`, 'utf8');
            vi.spyOn(console, 'warn').mockImplementation(() => {});

            const writer = createFastDurableState(filePath, {
                debounceMs: 35,
                retryDelayMs: 25,
                maxRetryAttempts: 4,
                lockOptions: { timeoutMs: 45, isPidAlive: () => true },
            });

            // Stage v1 and kick off its flush (which will spend ~45ms waiting on the active lock before timing out)
            const v1Promise = writer.updateGlobalWithReceipt('displayLanguage', 'zh');
            let v1Settled = false;
            void v1Promise.then(() => { v1Settled = true; });
            const flushPromise = writer.flush();

            // While v1's flush is in flight, stage v2 so _saveTimer is armed!
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
            const v2Promise = writer.updateGlobalWithReceipt('panelZoomLevel', 125);

            // v1's flush fails transiently, but because _saveTimer is armed and retries are NOT exhausted,
            // flush MUST report status: 'pending', retryScheduled: true, and v1Promise MUST stay pending!
            const firstFlushReceipt = await flushPromise;
            expect(firstFlushReceipt.committed).toBe(false);
            expect(firstFlushReceipt.status).toBe('pending');
            expect(firstFlushReceipt.retryScheduled).toBe(true);
            expect(firstFlushReceipt.errorCode).toBe('ELOCKTIMEOUT');
            expect(v1Settled).toBe(false);

            // Release the lock: _saveTimer fires and commits BOTH v1 and v2, resolving both waiters as committed!
            fs.unlinkSync(lockPath);
            const [v1Receipt, v2Receipt] = await Promise.all([v1Promise, v2Promise]);
            expect(v1Receipt.committed).toBe(true);
            expect(v1Receipt.status).toBe('committed');
            expect(v2Receipt.committed).toBe(true);
            expect(v2Receipt.status).toBe('committed');

            const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8')).global;
            expect(onDisk.displayLanguage).toBe('zh');
            expect(onDisk.panelZoomLevel).toBe(125);
            writer.dispose();
        });
    });
});

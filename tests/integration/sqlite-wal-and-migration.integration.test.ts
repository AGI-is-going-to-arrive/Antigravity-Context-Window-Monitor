import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    CliUsageScanner,
    decodeCliGenMetadataBlob,
} from '../../src/cli-usage-scanner';
import { extractLegacyDataAsync } from '../../src/legacy-migration';
import {
    buildTestGenMetadataBlob,
    createTempDirTracker,
    pbBytes,
    pbVarint,
} from '../helpers/factories';

type DatabaseSyncCtor = new (p: string, opts?: { readOnly?: boolean }) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...args: unknown[]): void };
    close(): void;
};

function requireNodeSqlite(): DatabaseSyncCtor {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('node:sqlite') as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
}

describe('Real-System Integration: Disposable SQLite Migration & Unwritable Active-WAL CLI Scanner', () => {
    const tracker = createTempDirTracker('acm-int-sqlite-');

    afterEach(() => {
        tracker.cleanup();
    });

    it('W1A-FIX-4: extracts dailyStoreState and displayLanguage from a real disposable SQLite DB via child node -e -- argv', async () => {
        const DatabaseSync = requireNodeSqlite();
        const dir = tracker.make('acm-legacy-mig-');
        const dbPath = path.join(dir, 'state.vscdb');
        const extensionKey = 'AGI-is-going-to-arrive.antigravity-context-monitor';
        const expectedPayload = {
            dailyStoreState: {
                version: 1,
                records: {
                    '2026-06-01': {
                        date: '2026-06-01',
                        cycles: [
                            {
                                startTime: '2026-06-01T00:00:00',
                                endTime: '2026-06-01T23:59:59',
                                totalReasoning: 12,
                                totalToolCalls: 7,
                                totalErrors: 0,
                                totalInputTokens: 25_000,
                                totalOutputTokens: 5_000,
                                estSteps: 20,
                                modelNames: ['Claude Opus 4.6 (Thinking)'],
                                gmTotalCalls: 14,
                                gmTotalTokens: 30_000,
                                estimatedCost: 1.45,
                            },
                        ],
                    },
                },
            },
            displayLanguage: 'zh',
            unrelatedSecret: 'ignored-by-extractor',
        };

        const db = new DatabaseSync(dbPath);
        db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);');
        db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(
            extensionKey,
            JSON.stringify(expectedPayload),
        );
        db.close();

        const logs: string[] = [];
        const result = await extractLegacyDataAsync((m) => logs.push(m), {
            dbPath,
            nodePaths: [process.execPath],
        });

        expect(result.status).toBe('imported');
        expect(result.data?.displayLanguage).toBe('zh');
        expect(result.data?.dailyStoreState).toEqual(expectedPayload.dailyStoreState);
        expect((result.data as Record<string, unknown>)?.unrelatedSecret).toBeUndefined();

        // Real disposable DB without the extension key returns 'empty' cleanly
        const emptyDbPath = path.join(dir, 'empty.vscdb');
        const emptyDb = new DatabaseSync(emptyDbPath);
        emptyDb.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);');
        emptyDb.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run('other.extension', '{}');
        emptyDb.close();

        const emptyRes = await extractLegacyDataAsync(() => {}, {
            dbPath: emptyDbPath,
            nodePaths: [process.execPath],
        });
        expect(emptyRes.status).toBe('empty');

        // Null dbPath returns 'not_found'
        const missingRes = await extractLegacyDataAsync(() => {}, { dbPath: null });
        expect(missingRes.status).toBe('not_found');
    });

    it('decodes SQLite gen_metadata protobuf blobs read-only without creating WAL/SHM files and deduplicates sibling transcripts', () => {
        const tsSec = Math.floor(new Date(2026, 10, 18, 15, 30, 0).getTime() / 1000);
        const blob = buildTestGenMetadataBlob({
            executionId: 'pb-exec-1',
            stepIndices: [2],
            inputTokens: 50_000,
            outputTokens: 10_000,
            thinkingTokens: 4_000,
            cacheReadTokens: 150_000,
            cacheCreationTokens: 5_000,
            responseModel: 'gemini-4-neon',
            modelDisplayName: 'Gemini 4 Neon (High)',
            createdAtSec: tsSec,
            ttftSec: 1,
            ttftNanos: 250_000_000,
            streamSec: 2,
            streamNanos: 500_000_000,
        });

        const parsed = decodeCliGenMetadataBlob(blob, 'conv-pb-1', 0, 0);
        expect(parsed).not.toBeNull();
        expect(parsed!.callId).toBe('pb-exec-1');
        expect(parsed!.dateKey).toBe('2026-11-18');
        expect(parsed!.inputTokens).toBe(50_000);
        expect(parsed!.outputTokens).toBe(10_000);
        expect(parsed!.thinkingTokens).toBe(4_000);
        expect(parsed!.cacheReadTokens).toBe(150_000);
        expect(parsed!.cacheCreationTokens).toBe(5_000);
        expect(parsed!.ttftSeconds).toBeCloseTo(1.25, 3);
        expect(parsed!.streamingSeconds).toBeCloseTo(2.5, 3);
        expect(parsed!.modelKey).toBe('Gemini 4 Neon (High)');

        // Corrupt buffer never throws
        expect(decodeCliGenMetadataBlob(new Uint8Array([0xff, 0xff, 0xff, 0x00]), 'x', 0, Date.now())).toBeNull();

        const DatabaseSync = requireNodeSqlite();
        const root = tracker.make('acm-cli-ro-');
        const convDir = path.join(root, 'conversations');
        const brainDir = path.join(root, 'brain', 'sess-sql-1');
        fs.mkdirSync(convDir, { recursive: true });
        fs.mkdirSync(brainDir, { recursive: true });

        const dbPath = path.join(convDir, 'sess-sql-1.db');
        const db = new DatabaseSync(dbPath);
        db.exec(`
            PRAGMA journal_mode=WAL;
            CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER DEFAULT 0);
            CREATE TABLE steps (idx INTEGER PRIMARY KEY, metadata BLOB);
        `);
        db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)').run(0, blob, blob.length);
        const blobNoTs = buildTestGenMetadataBlob({
            executionId: 'pb-exec-2',
            stepIndices: [5],
            inputTokens: 10_000,
            outputTokens: 2_000,
            responseModel: 'gemini-4-neon',
            modelDisplayName: 'Gemini 4 Neon (High)',
        });
        const stepMeta = pbBytes(1, pbVarint(1, tsSec + 60));
        db.prepare('INSERT INTO steps (idx, metadata) VALUES (?, ?)').run(5, stepMeta);
        db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)').run(1, blobNoTs, blobNoTs.length);
        db.close();

        // Write a sibling brain transcript for the SAME session ID
        fs.writeFileSync(path.join(brainDir, 'transcript.jsonl'), [
            JSON.stringify({
                execution_id: 'pb-exec-1',
                created_at: new Date(tsSec * 1000).toISOString(),
                model: 'gemini-4-neon',
                usage: { input_tokens: 999_999, output_tokens: 1 },
            }),
            JSON.stringify({
                execution_id: 'sibling-extra-1',
                created_at: new Date((tsSec + 120) * 1000).toISOString(),
                model: 'gemini-4-neon',
                usage: { input_tokens: 3_000, output_tokens: 1_000 },
            }),
        ].join('\n'), 'utf8');

        expect(fs.readdirSync(convDir)).toEqual(['sess-sql-1.db']);

        const scanner = new CliUsageScanner();
        const now = new Date(2026, 10, 20, 12, 0, 0);
        const r1 = scanner.scan({ cliRootDir: root, now });
        expect(r1.available).toBe(true);
        expect(r1.days).toHaveLength(1);
        expect(r1.days[0].calls).toBe(3);
        expect(r1.days[0].totalTokens).toBe(215_000 + 12_000 + 4_000);
        // Strictly read-only: NO -wal or -shm files created!
        expect(fs.readdirSync(convDir)).toEqual(['sess-sql-1.db']);

        const r2 = scanner.scan({ cliRootDir: root, now });
        expect(r2.cacheHits).toBe(2);
        expect(r2.cacheMisses).toBe(0);
    });

    it('W1A-FIX-8 #5: reads active uncheckpointed WAL in an unwritable (0o555) directory even when main .db mtime is stale', async () => {
        const DatabaseSync = requireNodeSqlite();
        const writerDir = tracker.make('acm-wal-writer-');
        const readonlyRoot = tracker.make('acm-wal-ro-');
        const convDir = path.join(readonlyRoot, 'conversations');
        fs.mkdirSync(convDir, { recursive: true });

        const now = new Date(2026, 10, 20, 12, 0, 0);
        const ts1Sec = Math.floor(new Date(2026, 10, 19, 14, 0, 0).getTime() / 1000);
        const ts2Sec = Math.floor(new Date(2026, 10, 20, 11, 30, 0).getTime() / 1000);

        const committedBlob = buildTestGenMetadataBlob({
            executionId: 'wal-committed-1',
            inputTokens: 40_000,
            outputTokens: 8_000,
            cacheReadTokens: 100_000,
            responseModel: 'gemini-4-neon',
            modelDisplayName: 'Gemini 4 Neon (High)',
            createdAtSec: ts1Sec,
        });
        const uncheckpointedBlob = buildTestGenMetadataBlob({
            executionId: 'wal-uncheckpointed-2',
            inputTokens: 25_000,
            outputTokens: 5_000,
            cacheReadTokens: 60_000,
            responseModel: 'gemini-4-neon',
            modelDisplayName: 'Gemini 4 Neon (High)',
            createdAtSec: ts2Sec,
        });

        const writerDbPath = path.join(writerDir, 'sess-active-wal.db');
        const writerDb = new DatabaseSync(writerDbPath);
        try {
            writerDb.exec(`
                PRAGMA journal_mode=WAL;
                PRAGMA wal_autocheckpoint=0;
                CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER DEFAULT 0);
                CREATE TABLE steps (idx INTEGER PRIMARY KEY, metadata BLOB);
            `);
            writerDb.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)').run(0, committedBlob, committedBlob.length);
            writerDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
            writerDb.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)').run(1, uncheckpointedBlob, uncheckpointedBlob.length);

            const writerWalPath = `${writerDbPath}-wal`;
            expect(fs.existsSync(writerWalPath)).toBe(true);
            expect(fs.statSync(writerWalPath).size).toBeGreaterThan(0);

            const roDbPath = path.join(convDir, 'sess-active-wal.db');
            const roWalPath = `${roDbPath}-wal`;
            fs.copyFileSync(writerDbPath, roDbPath);
            fs.copyFileSync(writerWalPath, roWalPath);

            const staleDate = new Date(now.getTime() - 500 * 86_400_000);
            fs.utimesSync(roDbPath, staleDate, staleDate);
            fs.utimesSync(roWalPath, now, now);
        } finally {
            writerDb.close();
        }

        const roDbPath = path.join(convDir, 'sess-active-wal.db');
        const roWalPath = `${roDbPath}-wal`;
        if (process.platform !== 'win32') {
            fs.chmodSync(roDbPath, 0o444);
            fs.chmodSync(roWalPath, 0o444);
            fs.chmodSync(convDir, 0o555);
        }

        try {
            const syncScanner = new CliUsageScanner();
            const syncRes = syncScanner.scan({ cliRootDir: readonlyRoot, now, maxAgeDays: 30 });
            expect(syncRes.status).toBe('ok');
            expect(syncRes.available).toBe(true);
            expect(syncRes.filesScanned).toBe(1);
            expect(syncRes.days.map(d => d.date)).toEqual(['2026-11-19', '2026-11-20']);
            expect(syncRes.days[0].calls).toBe(1);
            expect(syncRes.days[0].inputTokens).toBe(40_000);
            expect(syncRes.days[1].calls).toBe(1);
            expect(syncRes.days[1].inputTokens).toBe(25_000);
            expect(fs.readdirSync(convDir).sort()).toEqual(['sess-active-wal.db', 'sess-active-wal.db-wal']);

            const asyncScanner = new CliUsageScanner();
            const asyncRes = await asyncScanner.scanAsync({ cliRootDir: readonlyRoot, now, maxAgeDays: 30 });
            expect(asyncRes.status).toBe('ok');
            expect(asyncRes.days.map(d => d.date)).toEqual(['2026-11-19', '2026-11-20']);
            expect(asyncRes.days[0].inputTokens).toBe(40_000);
            expect(asyncRes.days[1].inputTokens).toBe(25_000);
            expect(fs.readdirSync(convDir).sort()).toEqual(['sess-active-wal.db', 'sess-active-wal.db-wal']);
        } finally {
            if (process.platform !== 'win32') {
                fs.chmodSync(convDir, 0o755);
                fs.chmodSync(roDbPath, 0o644);
                fs.chmodSync(roWalPath, 0o644);
            }
        }
    });

    it('W1A-FIX-8 #5: enforces row/byte/time budgets on SQLite & JSONL and preserves last complete results on degradation', async () => {
        const DatabaseSync = requireNodeSqlite();
        const root = tracker.make('acm-budget-');
        const convDir = path.join(root, 'conversations');
        const logsDir = path.join(root, 'brain', 'sess-b1', '.system_generated', 'logs');
        fs.mkdirSync(convDir, { recursive: true });
        fs.mkdirSync(logsDir, { recursive: true });

        const now = new Date(2026, 10, 20, 12, 0, 0);
        const tsSec = Math.floor(new Date(2026, 10, 20, 10, 0, 0).getTime() / 1000);

        const dbPath = path.join(convDir, 'sess-budget.db');
        const db = new DatabaseSync(dbPath);
        db.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER DEFAULT 0);');
        for (let i = 0; i < 6; i++) {
            const b = buildTestGenMetadataBlob({
                executionId: `sql-row-${i}`,
                inputTokens: 1_000,
                outputTokens: 500,
                responseModel: 'gemini-4-neon',
                createdAtSec: tsSec + i,
            });
            db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)').run(i, b, b.length);
        }
        db.close();

        const jsonlPath = path.join(logsDir, 'transcript.jsonl');
        const jsonlLines = Array.from({ length: 6 }, (_, i) => JSON.stringify({
            execution_id: `jsonl-row-${i}`,
            created_at: new Date((tsSec + 100 + i) * 1000).toISOString(),
            model: 'gemini-4-neon',
            usage: { input_tokens: 2_000, output_tokens: 400 },
        }));
        fs.writeFileSync(jsonlPath, jsonlLines.join('\n'), 'utf8');

        const scanner = new CliUsageScanner();
        const baseline = await scanner.scanAsync({ cliRootDir: root, now });
        expect(baseline.status).toBe('ok');
        expect(baseline.days).toHaveLength(1);
        expect(baseline.days[0].calls).toBe(12);
        expect(baseline.preservedLastComplete).toBeFalsy();

        const nextMtime = new Date(now.getTime() + 5_000);
        fs.utimesSync(dbPath, nextMtime, nextMtime);
        fs.utimesSync(jsonlPath, nextMtime, nextMtime);

        const rowBudgetRes = await scanner.scanAsync({
            cliRootDir: root,
            now,
            maxRowsPerFile: 2,
            sqlitePageSize: 2,
        });
        expect(rowBudgetRes.status).toBe('budget_exceeded');
        expect(rowBudgetRes.budgetExceeded).toBe(true);
        expect(rowBudgetRes.preservedLastComplete).toBe(true);
        expect(rowBudgetRes.days[0].calls).toBe(12);

        const byteBudgetRes = scanner.scan({
            cliRootDir: root,
            now,
            maxFileBytes: 64,
        });
        expect(byteBudgetRes.status).toBe('budget_exceeded');
        expect(byteBudgetRes.budgetExceeded).toBe(true);
        expect(byteBudgetRes.preservedLastComplete).toBe(true);
        expect(byteBudgetRes.days[0].calls).toBe(12);

        let fakeTick = 0;
        const timeBudgetRes = scanner.scan({
            cliRootDir: root,
            now,
            maxElapsedMs: 10,
            monotonicNowMs: () => {
                fakeTick += 25;
                return fakeTick;
            },
        });
        expect(timeBudgetRes.status).toBe('budget_exceeded');
        expect(timeBudgetRes.budgetExceeded).toBe(true);
        expect(timeBudgetRes.preservedLastComplete).toBe(true);
        expect(timeBudgetRes.days[0].calls).toBe(12);
    });

    it('W1A-FIX-8 #5: reports degraded unavailable status (never ok) on partial unreadable files and enforces steps-table row budget', async () => {
        if (process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0) {
            const root = tracker.make('acm-partial-unavail-');
            const usageDir = path.join(root, 'usage');
            fs.mkdirSync(usageDir, { recursive: true });
            const ts = new Date(2026, 10, 20, 10, 0, 0).toISOString();
            const goodPath = path.join(usageDir, 'a-good.jsonl');
            const blockedPath = path.join(usageDir, 'b-blocked.jsonl');
            fs.writeFileSync(goodPath, JSON.stringify({
                execution_id: 'good-1',
                created_at: ts,
                model: 'gemini-4-neon',
                usage: { input_tokens: 1_000, output_tokens: 200 },
            }), 'utf8');
            fs.writeFileSync(blockedPath, JSON.stringify({
                execution_id: 'blocked-1',
                created_at: ts,
                model: 'gemini-4-neon',
                usage: { input_tokens: 2_000, output_tokens: 300 },
            }), 'utf8');

            const scanner = new CliUsageScanner();
            const now = new Date(2026, 10, 20, 12, 0, 0);
            const complete = scanner.scan({ cliRootDir: root, now, disableSqlite: true });
            expect(complete.status).toBe('ok');
            expect(complete.days[0].calls).toBe(2);

            const later = new Date(now.getTime() + 5_000);
            fs.utimesSync(blockedPath, later, later);
            fs.chmodSync(blockedPath, 0o000);
            try {
                const degraded = await scanner.scanAsync({ cliRootDir: root, now, disableSqlite: true });
                expect(degraded.status).toBe('unavailable');
                expect(degraded.preservedLastComplete).toBe(true);
                expect(degraded.days[0].calls).toBe(2);
            } finally {
                fs.chmodSync(blockedPath, 0o644);
            }
        }

        const DatabaseSync = requireNodeSqlite();
        const sqlRoot = tracker.make('acm-steps-budget-');
        const convDir = path.join(sqlRoot, 'conversations');
        fs.mkdirSync(convDir, { recursive: true });
        const dbPath = path.join(convDir, 'sess-steps.db');
        const tsSec = Math.floor(new Date(2026, 10, 20, 11, 0, 0).getTime() / 1000);

        const db = new DatabaseSync(dbPath);
        db.exec(`
            CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER DEFAULT 0);
            CREATE TABLE steps (idx INTEGER PRIMARY KEY, metadata BLOB);
        `);
        const blobNoTs = buildTestGenMetadataBlob({
            executionId: 'steps-fallback-1',
            stepIndices: [5],
            inputTokens: 3_000,
            outputTokens: 600,
            responseModel: 'gemini-4-neon',
        });
        db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)').run(0, blobNoTs, blobNoTs.length);
        for (let i = 0; i < 6; i++) {
            const stepMeta = pbBytes(1, pbVarint(1, tsSec + i));
            db.prepare('INSERT INTO steps (idx, metadata) VALUES (?, ?)').run(i, stepMeta);
        }
        db.close();

        const now = new Date(2026, 10, 20, 12, 0, 0);
        const stepBudgetRes = new CliUsageScanner().scan({
            cliRootDir: sqlRoot,
            now,
            maxRowsPerFile: 2,
            sqlitePageSize: 2,
        });
        expect(stepBudgetRes.status).toBe('budget_exceeded');
        expect(stepBudgetRes.budgetExceeded).toBe(true);
    });
});

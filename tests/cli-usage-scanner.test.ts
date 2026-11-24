import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    CURRENCY_CODES,
    CURRENCY_PRESETS,
    CliUsageScanner,
    ROI_DISCLAIMER_EN,
    ROI_DISCLAIMER_ZH,
    SUBSCRIPTION_PLAN_PRESET_ORDER,
    SUBSCRIPTION_PLAN_PRESETS,
    aggregateCliCallsByDay,
    buildCalendarExportCsv,
    buildCalendarExportJson,
    cliDayRecordToDailyRecord,
    computeActivityStreaks,
    convertCurrencyToUsd,
    convertUsdToCurrency,
    decodeCliGenMetadataBlob,
    estimateSubscriptionRoi,
    formatCurrencyAmount,
    formatDualCurrencyAmount,
    isSubscriptionPlanPresetId,
    normalizeSubscriptionPlanId,
    resolveCurrencyConfig,
    resolveDefaultCliDataDir,
    type CalendarExportDayRow,
} from '../src/cli-usage-scanner';
import { computeAdditiveTokens } from '../src/daily-store';

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

    it('decodes SQLite gen_metadata protobuf blobs read-only without creating WAL/SHM files and deduplicates sibling transcripts', () => {
        // Test pure protobuf blob decoder first (always runs regardless of node:sqlite)
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

        // Test SQLite read-only scan if node:sqlite is available in this Node runtime
        let DatabaseSync: (new (p: string, opts?: { readOnly?: boolean }) => {
            exec(sql: string): void;
            prepare(sql: string): { run(...args: unknown[]): void };
            close(): void;
        }) | null = null;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            DatabaseSync = require('node:sqlite').DatabaseSync;
        } catch {
            DatabaseSync = null;
        }

        if (DatabaseSync) {
            const root = makeTempDir();
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
            // Row 0 has timestamp inside gen_metadata; Row 1 falls back to steps.metadata field 1 timestamp
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

            // Write a sibling brain transcript for the SAME session ID — scanner must NOT double-count it!
            fs.writeFileSync(path.join(brainDir, 'transcript.jsonl'), JSON.stringify({
                execution_id: 'sibling-should-skip',
                created_at: new Date(tsSec * 1000).toISOString(),
                model: 'gemini-4-neon',
                usage: { input_tokens: 999_999, output_tokens: 1 },
            }), 'utf8');

            expect(fs.readdirSync(convDir)).toEqual(['sess-sql-1.db']);

            const scanner = new CliUsageScanner();
            const now = new Date(2026, 10, 20, 12, 0, 0);
            const r1 = scanner.scan({ cliRootDir: root, now });
            expect(r1.available).toBe(true);
            expect(r1.days).toHaveLength(1);
            expect(r1.days[0].calls).toBe(2);
            expect(r1.days[0].totalTokens).toBe(215_000 + 12_000);
            // Strictly read-only: NO -wal or -shm files created!
            expect(fs.readdirSync(convDir)).toEqual(['sess-sql-1.db']);

            // Second scan hits cache 100%
            const r2 = scanner.scan({ cliRootDir: root, now });
            expect(r2.cacheHits).toBe(1);
            expect(r2.cacheMisses).toBe(0);
        }
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
});

describe('Multi-Currency Engine & Subscription ROI Estimator', () => {
    it('supports all 9 required currency presets and custom FX rate overrides', () => {
        expect(CURRENCY_CODES).toEqual(['USD', 'CNY', 'EUR', 'JPY', 'KRW', 'GBP', 'AUD', 'HKD', 'TWD']);
        for (const code of CURRENCY_CODES) {
            const preset = CURRENCY_PRESETS[code];
            expect(preset.defaultRatePerUsd).toBeGreaterThan(0);
            expect(formatCurrencyAmount(10, code)).toContain(preset.symbol);
        }

        // Default USD formatting matches standard USD style
        expect(formatCurrencyAmount(12.34, 'USD')).toBe('$12.34');
        expect(formatDualCurrencyAmount(12.34, 'USD')).toBe('$12.34');
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

        // Zero-decimal currencies (JPY, KRW, TWD)
        expect(formatCurrencyAmount(10, 'JPY')).toBe('¥1,540');
        expect(formatCurrencyAmount(10, 'KRW')).toBe('₩13,900');

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

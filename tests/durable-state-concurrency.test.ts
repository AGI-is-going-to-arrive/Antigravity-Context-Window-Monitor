import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DurableState } from '../src/durable-state';
import { DailyStore } from '../src/daily-store';
import { PricingStore } from '../src/pricing-store';
import { MonitorStore } from '../src/monitor-store';
import { QuotaTracker } from '../src/quota-tracker';

const execFileAsync = promisify(execFile);

describe('DurableState atomic writes & concurrent App + IDE safety', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-durable-concurrency-'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function statePath(name = 'state-v1.json'): string {
        return path.join(tempDir, name);
    }

    function readRawBytes(filePath: string): Buffer {
        return fs.readFileSync(filePath);
    }

    function readJson(filePath: string): { version: number; global: Record<string, unknown>; workspaces: Record<string, Record<string, unknown>> } {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }

    it('reads UTF-8 BOM files cleanly and never writes a UTF-8 BOM back to disk', async () => {
        const filePath = statePath('bom-state.json');
        const payload = JSON.stringify({
            version: 1,
            global: { displayLanguage: 'zh', panelZoomLevel: 110 },
            workspaces: {},
        }, null, 2);
        fs.writeFileSync(filePath, `\uFEFF${payload}`, 'utf8');

        const state = new DurableState(filePath);
        expect(state.globalBucket().get('displayLanguage', 'both')).toBe('zh');
        expect(state.globalBucket().get('panelZoomLevel', 100)).toBe(110);

        await state.globalBucket().update('panelZoomLevel', 120);
        await state.flush();

        const bytes = readRawBytes(filePath);
        // UTF-8 BOM is EF BB BF — must NEVER be written.
        expect(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf).toBe(false);
        expect(readJson(filePath).global.panelZoomLevel).toBe(120);
        expect(readJson(filePath).global.displayLanguage).toBe('zh');
    });

    it('writes atomically via sibling temp file with 0o600 permissions on POSIX and leaves zero .tmp files', async () => {
        const filePath = statePath('atomic-state.json');
        const state = new DurableState(filePath);

        await state.globalBucket().update('displayLanguage', 'en');
        await state.flush();

        const entries = fs.readdirSync(tempDir);
        expect(entries).toEqual(['atomic-state.json']);
        expect(entries.some(name => name.endsWith('.tmp'))).toBe(false);

        if (process.platform !== 'win32') {
            const mode = fs.statSync(filePath).mode & 0o777;
            expect(mode).toBe(0o600);
        }
    });

    it('retries atomic rename on transient Windows EBUSY/EPERM errors and cleans up temp file on permanent failure', async () => {
        const filePath = statePath('retry-rename.json');
        const state = new DurableState(filePath);
        const realRename = fs.promises.rename.bind(fs.promises);
        let calls = 0;

        const spy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (oldPath, newPath) => {
            calls++;
            if (calls === 1) {
                throw Object.assign(new Error('resource busy'), { code: 'EBUSY' });
            }
            if (calls === 2) {
                throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
            }
            return realRename(oldPath, newPath);
        });

        await state.globalBucket().update('displayLanguage', 'zh');
        await state.flush();

        expect(calls).toBe(3);
        expect(readJson(filePath).global.displayLanguage).toBe('zh');
        expect(fs.readdirSync(tempDir).filter(f => f.endsWith('.tmp'))).toEqual([]);

        // Permanent error cleans up temp file instead of leaking orphans.
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        spy.mockRejectedValue(Object.assign(new Error('permanent failure'), { code: 'EROFS' }));
        await state.globalBucket().update('displayLanguage', 'en');
        await state.flush();

        expect(warnSpy).toHaveBeenCalled();
        expect(fs.readdirSync(tempDir).filter(f => f.endsWith('.tmp'))).toEqual([]);
    });

    it('preserves non-dirty keys when two instances (App + IDE) update distinct keys concurrently', async () => {
        const filePath = statePath('shared-state.json');
        const initial = new DurableState(filePath);
        await initial.globalBucket().update('displayLanguage', 'both');
        await initial.flush();

        const appState = new DurableState(filePath);
        const ideState = new DurableState(filePath);

        // App updates language and flushes first.
        await appState.globalBucket().update('displayLanguage', 'zh');
        await appState.flush();

        // IDE (which loaded before App's flush) updates zoom and workspace state, then flushes.
        await ideState.globalBucket().update('panelZoomLevel', 125);
        await ideState.workspaceBucket('/repo/a').update('lastKnownModel', 'MODEL_PLACEHOLDER_M532');
        await ideState.flush();

        const onDisk = readJson(filePath);
        expect(onDisk.global.displayLanguage).toBe('zh');
        expect(onDisk.global.panelZoomLevel).toBe(125);
        expect(onDisk.workspaces['/repo/a'].lastKnownModel).toBe('MODEL_PLACEHOLDER_M532');

        // IDE reconciled App's non-dirty key in memory too.
        expect(ideState.globalBucket().get('displayLanguage', 'both')).toBe('zh');
    });

    it('deep-merges object-map keys (accountBillingDays, customPricing, accountSnapshots, dailyLedger) across concurrent writers', async () => {
        const filePath = statePath('deep-merge.json');
        const seed = new DurableState(filePath);
        await seed.globalBucket().update('accountBillingDays', { 'base@example.com': 1 });
        await seed.globalBucket().update('customPricing', {
            baseModel: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 0, thinking: 5 },
        });
        await seed.globalBucket().update('accountSnapshots', [
            { email: 'base@example.com', planName: 'Pro', capturedAt: '2026-11-22T00:00:00Z' },
        ]);
        await seed.globalBucket().update('dailyLedger', {
            version: 1,
            dateKey: '2026-11-22',
            accounts: { 'base@example.com': { totalCalls: 1 } },
            settled: [{ settledAt: '2026-11-22T01:00:00Z', accountEmail: 'base@example.com', poolModelIds: ['M1'] }],
        });
        await seed.flush();

        const appState = new DurableState(filePath);
        const ideState = new DurableState(filePath);

        // App adds App-side entries and flushes.
        await appState.globalBucket().update('accountBillingDays', {
            'base@example.com': 1,
            'app@example.com': 10,
        });
        await appState.globalBucket().update('customPricing', {
            baseModel: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 0, thinking: 5 },
            appModel: { input: 3, output: 15, cacheRead: 0.15, cacheWrite: 0, thinking: 15 },
        });
        await appState.globalBucket().update('accountSnapshots', [
            { email: 'base@example.com', planName: 'Pro', capturedAt: '2026-11-22T00:00:00Z' },
            { email: 'app@example.com', planName: 'Ultra', capturedAt: '2026-11-22T02:00:00Z' },
        ]);
        await appState.globalBucket().update('dailyLedger', {
            version: 1,
            dateKey: '2026-11-22',
            accounts: {
                'base@example.com': { totalCalls: 1 },
                'app@example.com': { totalCalls: 4 },
            },
            settled: [
                { settledAt: '2026-11-22T01:00:00Z', accountEmail: 'base@example.com', poolModelIds: ['M1'] },
                { settledAt: '2026-11-22T02:00:00Z', accountEmail: 'app@example.com', poolModelIds: ['M2'] },
            ],
        });
        await appState.flush();

        // IDE adds IDE-side entries from stale base and flushes.
        await ideState.globalBucket().update('accountBillingDays', {
            'base@example.com': 1,
            'ide@example.com': 20,
        });
        await ideState.globalBucket().update('customPricing', {
            baseModel: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 0, thinking: 5 },
            ideModel: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0, thinking: 10 },
        });
        await ideState.globalBucket().update('accountSnapshots', [
            { email: 'base@example.com', planName: 'Pro', capturedAt: '2026-11-22T00:00:00Z' },
            { email: 'ide@example.com', planName: 'Pro', capturedAt: '2026-11-22T03:00:00Z' },
        ]);
        await ideState.globalBucket().update('dailyLedger', {
            version: 1,
            dateKey: '2026-11-22',
            accounts: {
                'base@example.com': { totalCalls: 1 },
                'ide@example.com': { totalCalls: 7 },
            },
            settled: [
                { settledAt: '2026-11-22T01:00:00Z', accountEmail: 'base@example.com', poolModelIds: ['M1'] },
                { settledAt: '2026-11-22T03:00:00Z', accountEmail: 'ide@example.com', poolModelIds: ['M3'] },
            ],
        });
        await ideState.flush();

        const merged = readJson(filePath).global;
        expect(merged.accountBillingDays).toEqual({
            'base@example.com': 1,
            'app@example.com': 10,
            'ide@example.com': 20,
        });
        expect(Object.keys(merged.customPricing as Record<string, unknown>).sort()).toEqual([
            'appModel', 'baseModel', 'ideModel',
        ]);
        const snapshots = merged.accountSnapshots as Array<{ email: string }>;
        expect(snapshots.map(s => s.email).sort()).toEqual([
            'app@example.com', 'base@example.com', 'ide@example.com',
        ]);
        const ledger = merged.dailyLedger as { accounts: Record<string, unknown>; settled: Array<{ accountEmail: string }> };
        expect(Object.keys(ledger.accounts).sort()).toEqual([
            'app@example.com', 'base@example.com', 'ide@example.com',
        ]);
        expect(ledger.settled.map(s => s.accountEmail).sort()).toEqual([
            'app@example.com', 'base@example.com', 'ide@example.com',
        ]);
    });

    it('never lets a passive get() default seed overwrite a real value written concurrently by another process', async () => {
        const filePath = statePath('passive-seed.json');
        const writerA = new DurableState(filePath);
        const writerB = new DurableState(filePath);

        await writerA.globalBucket().update('displayLanguage', 'en');
        await writerA.flush();

        // writerB misses in memory and passively seeds default 'both', then writes a different key.
        expect(writerB.globalBucket().get('displayLanguage', 'both')).toBe('both');
        await writerB.globalBucket().update('panelZoomLevel', 115);
        await writerB.flush();

        const onDisk = readJson(filePath);
        expect(onDisk.global.displayLanguage).toBe('en');
        expect(onDisk.global.panelZoomLevel).toBe(115);
    });

    it('reloadIfChanged pulls external writes while preserving unsaved local dirty values', async () => {
        const filePath = statePath('reload-test.json');
        const stateA = new DurableState(filePath);
        const stateB = new DurableState(filePath);

        await stateA.globalBucket().update('displayLanguage', 'zh');
        await stateA.flush();

        // Start a debounced local write on stateB without flushing yet.
        const pending = stateB.globalBucket().update('panelZoomLevel', 130);
        expect(stateB.reloadIfChanged()).toBe(true);
        expect(stateB.globalBucket().get('displayLanguage', 'both')).toBe('zh');
        expect(stateB.globalBucket().get('panelZoomLevel', 100)).toBe(130);
        await pending;
    });

    it('reloadIfChanged still reports true after _flush absorbs concurrent external disk changes', async () => {
        const filePath = statePath('flush-absorbed-external.json');
        const stateA = new DurableState(filePath);
        const stateB = new DurableState(filePath);

        // External process (IDE) writes bob@example.com account snapshot first.
        await stateA.globalBucket().update('accountSnapshots', [
            { email: 'bob@example.com', planName: 'Pro', isActive: false },
        ]);
        await stateA.flush();

        // Local process (Sidecar) flushes an unrelated key before calling reloadIfChanged().
        await stateB.globalBucket().update('panelZoomLevel', 110);
        await stateB.flush();

        // Even though _flush() already merged bob@example.com into disk and _data,
        // reloadIfChanged() MUST return true once so callers refresh in-memory caches.
        expect(stateB.reloadIfChanged()).toBe(true);
        const snaps = stateB.globalBucket().get<Array<{ email: string }>>('accountSnapshots', []);
        expect(snaps.map(s => s.email)).toEqual(['bob@example.com']);
        // Subsequent call with no new disk change returns false.
        expect(stateB.reloadIfChanged()).toBe(false);
    });

    it('read-only get() without a fallback bucket never creates a state file or schedules spurious writes', async () => {
        const filePath = statePath('readonly-get.json');
        const reader = new DurableState(filePath);
        expect(reader.globalBucket().get('accountSnapshots', null)).toBeNull();
        expect(reader.globalBucket().get('displayLanguage', 'both')).toBe('both');
        await reader.flush();
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('works cleanly with DailyStore, PricingStore, MonitorStore, and QuotaTracker using StateBucket directly (no vscode)', async () => {
        const filePath = statePath('stores-compat.json');
        const durable = new DurableState(filePath);
        const globalBucket = durable.globalBucket();
        const wsBucket = durable.workspaceBucket('/workspace/app');

        const dailyStore = new DailyStore();
        dailyStore.init(globalBucket);

        const pricingStore = new PricingStore();
        pricingStore.init(globalBucket);
        await pricingStore.set('custom-model', { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0, thinking: 2 });

        const monitorStore = new MonitorStore();
        monitorStore.init(wsBucket);
        expect(monitorStore.restore().currentUsage).toBeNull();

        // QuotaTracker accepts a raw StateBucket directly without ExtensionContext.
        const quotaTracker = new QuotaTracker(globalBucket);
        expect(quotaTracker.isEnabled()).toBe(true);
        quotaTracker.setEnabled(false);

        await durable.flush();
        const reloaded = new DurableState(filePath);
        const reloadedPricing = new PricingStore();
        reloadedPricing.init(reloaded.globalBucket());
        expect(reloadedPricing.getCustom()['custom-model']?.output).toBe(2);

        const reloadedQuota = new QuotaTracker(reloaded.globalBucket());
        expect(reloadedQuota.isEnabled()).toBe(false);
    });

    it('survives real multi-process concurrent writes without corruption or orphan temp files', async () => {
        const filePath = statePath('multiprocess.json');
        const compiledPath = path.resolve(__dirname, '..', 'out', 'durable-state.js');
        if (!fs.existsSync(compiledPath)) {
            return;
        }
        const workerScript = `
            const { DurableState } = require(${JSON.stringify(compiledPath)});
            const [filePath, key, value, mapKey] = process.argv.slice(1);
            (async () => {
                const ds = new DurableState(filePath);
                await ds.globalBucket().update(key, value);
                await ds.globalBucket().update('accountBillingDays', { [mapKey]: Number(value) });
                await ds.flush();
            })();
        `;

        await Promise.all([
            execFileAsync(process.execPath, ['-e', workerScript, filePath, 'procA', '11', 'a@test.local'], { windowsHide: true }),
            execFileAsync(process.execPath, ['-e', workerScript, filePath, 'procB', '22', 'b@test.local'], { windowsHide: true }),
        ]);

        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as { global: Record<string, unknown> };
        expect(parsed.global.procA).toBe('11');
        expect(parsed.global.procB).toBe('22');
        expect(parsed.global.accountBillingDays).toEqual({
            'a@test.local': 11,
            'b@test.local': 22,
        });
        expect(fs.readdirSync(tempDir).filter(f => f.endsWith('.tmp') || f.endsWith('.lock'))).toEqual([]);
    });
});

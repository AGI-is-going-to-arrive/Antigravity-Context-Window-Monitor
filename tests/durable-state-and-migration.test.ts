// Consolidated Domain Suite: DurableState Unit Logic & Legacy Migration Idempotency (real multi-process & SQLite in tests/integration/)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    acquireLockFile,
    DEFAULT_APP_SETTINGS,
    DurableState,
    DurableStateLockTimeoutError,
    normalizeAppSettings,
    parseLockFileContent,
} from '../src/durable-state';
import { DailyStore } from '../src/daily-store';
import { PricingStore } from '../src/pricing-store';
import { MonitorStore } from '../src/monitor-store';
import { QuotaTracker } from '../src/quota-tracker';
import {
    extractLegacyDataAsync,
    getOldAntigravityDbPath,
    getOldAntigravityDbPathAsync,
    type LegacyMigrationData,
    type LegacyMigrationResult,
    runLegacyMigrationOnce,
    runLegacyMigrationOnceAsync,
} from '../src/legacy-migration';
import { createFastDurableState } from './helpers/factories';

describe('[durable-state-unit]', () => {
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

        it('ignores relative Linux XDG state and migration roots', async () => {
            const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
            try {
                Object.defineProperty(process, 'platform', { ...platform, value: 'linux' });
                vi.stubEnv('HOME', tempDir);
                vi.stubEnv('USERPROFILE', tempDir);
                vi.stubEnv('XDG_STATE_HOME', './state');
                vi.stubEnv('XDG_CONFIG_HOME', '../config');
                const state = new DurableState();
                expect(state.getFilePath()).toBe(path.join(tempDir, '.local', 'state', 'antigravity-context-monitor', 'state-v1.json'));
                state.dispose();
                const legacy = path.join(tempDir, '.config', 'Antigravity', 'User', 'globalStorage', 'state.vscdb');
                fs.mkdirSync(path.dirname(legacy), { recursive: true });
                fs.writeFileSync(legacy, '');
                expect(getOldAntigravityDbPath()).toBe(legacy);
                expect(await getOldAntigravityDbPathAsync()).toBe(legacy);
            } finally {
                vi.unstubAllEnvs();
                Object.defineProperty(process, 'platform', platform);
            }
        });

        it('reads UTF-8 BOM files cleanly and never writes a UTF-8 BOM back to disk', async () => {
            const filePath = statePath('bom-state.json');
            const payload = JSON.stringify({
                version: 1,
                global: { displayLanguage: 'zh', panelZoomLevel: 110 },
                workspaces: {},
            }, null, 2);
            fs.writeFileSync(filePath, `\uFEFF${payload}`, 'utf8');

            const state = createFastDurableState(filePath);
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
            const state = createFastDurableState(filePath);

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

        it.each(['', '{truncated', '{"version":2}', '{"version":1,"global":[]}', '{"version":1,"workspaces":{"project":null}}'])(
            'preserves unreadable historical state bytes and retries local edits after repair (%j)', async original => {
                const file = statePath();
                fs.writeFileSync(file, original);
                const old = new Date(Date.now() - 20_000);
                fs.utimesSync(file, old, old);
                vi.spyOn(console, 'warn').mockImplementation(() => {});
                const state = createFastDurableState(file, { maxRetryAttempts: 0 });
                expect(await state.updateGlobalWithReceipt('new', 1)).toMatchObject({ committed: false, errorCode: 'EINVALIDSTATE' });
                expect(fs.readFileSync(file, 'utf8')).toBe(original);
                fs.writeFileSync(file, JSON.stringify({ version: 1, global: { keep: true }, workspaces: {} }));
                expect((await state.flush()).committed).toBe(true);
                expect(readJson(file).global).toEqual({ keep: true, new: 1 });
                state.dispose();
            },
        );

        it.each(['first stat', 'read', 'final stat'])('preserves the store on an I/O error during %s', async failure => {
            const file = statePath();
            const original = JSON.stringify({ version: 1, global: { before: 'safe' }, workspaces: {} });
            fs.writeFileSync(file, original);
            const state = createFastDurableState(file, { maxRetryAttempts: 0 });
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const ioError = Object.assign(new Error('fixture I/O failure'), { code: 'EIO' });
            let reads = 0;
            const stat = fs.promises.stat.bind(fs.promises);
            const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (target, options) => {
                if (target === file && ++reads === (failure === 'first stat' ? 1 : failure === 'final stat' ? 2 : -1)) {
                    throw ioError;
                }
                return stat(target, options);
            });
            const readFile = fs.promises.readFile.bind(fs.promises);
            const readSpy = vi.spyOn(fs.promises, 'readFile').mockImplementation(async (target, options) => {
                if (target === file && failure === 'read') { throw ioError; }
                return readFile(target, options);
            });
            expect(await state.updateGlobalWithReceipt('new', true)).toMatchObject({ committed: false, errorCode: 'EIO' });
            expect(fs.readFileSync(file, 'utf8')).toBe(original);
            expect(state.hasPendingWrites()).toBe(true);
            readSpy.mockRestore();
            statSpy.mockRestore();
            expect((await state.flush()).committed).toBe(true);
            expect(readJson(file).global).toEqual({ before: 'safe', new: true });
            state.dispose();
        });

        it('rechecks target identity during Windows rename retry backoff', async () => {
            const file = statePath();
            const state = createFastDurableState(file, { maxRetryAttempts: 0 });
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const other = JSON.stringify({ version: 1, global: { keep: 9 }, workspaces: {} });
            const originalRename = fs.promises.rename.bind(fs.promises);
            let attempts = 0;
            vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
                if (to === file && ++attempts === 1) {
                    fs.writeFileSync(file, other);
                    throw Object.assign(new Error('retry rename'), { code: 'EBUSY' });
                }
                return originalRename(from, to);
            });
            expect(await state.updateGlobalWithReceipt('new', 1)).toMatchObject({ committed: false, errorCode: 'ELOCKLOST' });
            expect(attempts).toBe(1);
            expect(fs.readFileSync(file, 'utf8')).toBe(other);
            state.dispose();
        });

        it('retries atomic rename on transient Windows EBUSY/EPERM errors and cleans up temp file on permanent failure', async () => {
            const filePath = statePath('retry-rename.json');
            const state = createFastDurableState(filePath);
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

            // Permanent error cleans up temp file instead of leaking orphans, retains dirty data,
            // and reports committed:false instead of falsely resolving waiters as saved.
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            spy.mockRejectedValue(Object.assign(new Error('permanent failure'), { code: 'EROFS' }));
            const pendingPermanent = state.globalBucket().update('displayLanguage', 'en');
            const permanentReceipt = await state.flush();

            expect(permanentReceipt.committed).toBe(false);
            expect(permanentReceipt.errorCode).toBe('EROFS');
            expect(state.hasPendingWrites()).toBe(true);
            expect(warnSpy).toHaveBeenCalled();
            expect(fs.readdirSync(tempDir).filter(f => f.endsWith('.tmp'))).toEqual([]);
            state.dispose();
            await expect(pendingPermanent).resolves.toMatchObject({ committed: false, status: 'failed' });
        });

        it('preserves non-dirty keys when two instances (App + IDE) update distinct keys concurrently', async () => {
            const filePath = statePath('shared-state.json');
            const initial = createFastDurableState(filePath);
            await initial.globalBucket().update('displayLanguage', 'both');
            await initial.flush();

            const appState = createFastDurableState(filePath);
            const ideState = createFastDurableState(filePath);

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
            const seed = createFastDurableState(filePath);
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

            const appState = createFastDurableState(filePath);
            const ideState = createFastDurableState(filePath);

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
            const writerA = createFastDurableState(filePath);
            const writerB = createFastDurableState(filePath);

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
            const stateA = createFastDurableState(filePath);
            const stateB = createFastDurableState(filePath);

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
            const stateA = createFastDurableState(filePath);
            const stateB = createFastDurableState(filePath);

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
            const reader = createFastDurableState(filePath);
            expect(reader.globalBucket().get('accountSnapshots', null)).toBeNull();
            expect(reader.globalBucket().get('displayLanguage', 'both')).toBe('both');
            await reader.flush();
            expect(fs.existsSync(filePath)).toBe(false);
        });

        it('works cleanly with DailyStore, PricingStore, MonitorStore, and QuotaTracker using StateBucket directly (no vscode)', async () => {
            const filePath = statePath('stores-compat.json');
            const durable = createFastDurableState(filePath);
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
            const reloaded = createFastDurableState(filePath);
            const reloadedPricing = new PricingStore();
            reloadedPricing.init(reloaded.globalBucket());
            expect(reloadedPricing.getCustom()['custom-model']?.output).toBe(2);

            const reloadedQuota = new QuotaTracker(reloaded.globalBucket());
            expect(reloadedQuota.isEnabled()).toBe(false);
        });

        it('normalizes all v1.17.6 AppSettings with backward compatibility and deep-merges appSettings across App + IDE', async () => {
            // Legacy v1.17.5 payload with only old keys
            const normalizedLegacy = normalizeAppSettings({
                pollingInterval: 10,
                maxRecentSteps: 250,
                maxArchives: 40,
            });
            expect(normalizedLegacy).toMatchObject({
                pollingInterval: 10,
                maxRecentSteps: 250,
                activityMaxRecentSteps: 250,
                maxArchives: 40,
                activityMaxArchives: 40,
                appComposerRingEnabled: false,
                appTopBarEnabled: false,
                orchestratorPricingMode: 'mapped',
                displayCurrency: 'USD',
                customFxRate: null,
                subscriptionMonthlyFee: null,
                subscriptionCurrency: 'USD',
                calendarRetentionDays: 400,
                autoCheckUpdates: true,
                showNativeHudBar: true,
                lastUpdateCheck: null,
            });

            // New v1.17.6 keys with validation & clamping
            const normalizedNew = normalizeAppSettings({
                appComposerRingEnabled: true,
                appTopBarEnabled: true,
                orchestratorPricingMode: 'strict',
                displayCurrency: 'cny',
                customFxRate: 7.25,
                subscriptionMonthlyFee: 19.99,
                subscriptionCurrency: 'usd',
                calendarRetentionDays: 5000, // clamped to 3650
                autoCheckUpdates: false,
                showNativeHudBar: false,
                activityMaxRecentSteps: 300,
                activityMaxArchives: 50,
                lastUpdateCheck: {
                    checkedAt: 1700000000000,
                    latestVersion: '1.17.6',
                    hasUpdate: true,
                    etag: '"abc"',
                },
            });
            expect(normalizedNew.appComposerRingEnabled).toBe(true);
            expect(normalizedNew.appTopBarEnabled).toBe(true);
            expect(normalizedNew.orchestratorPricingMode).toBe('strict');
            expect(normalizedNew.displayCurrency).toBe('CNY');
            expect(normalizedNew.customFxRate).toBe(7.25);
            expect(normalizedNew.subscriptionMonthlyFee).toBe(19.99);
            expect(normalizedNew.calendarRetentionDays).toBe(3650);
            expect(normalizedNew.autoCheckUpdates).toBe(false);
            expect(normalizedNew.showNativeHudBar).toBe(false);
            expect(normalizedNew.maxRecentSteps).toBe(300);
            expect(normalizedNew.activityMaxRecentSteps).toBe(300);
            expect(normalizedNew.maxArchives).toBe(50);
            expect(normalizedNew.activityMaxArchives).toBe(50);
            expect(normalizedNew.lastUpdateCheck?.latestVersion).toBe('1.17.6');

            // Concurrent App + IDE updates to distinct keys in global.appSettings deep-merge cleanly
            const filePath = statePath('app-settings-merge.json');
            const seed = createFastDurableState(filePath);
            await seed.updateAppSettings({ ...DEFAULT_APP_SETTINGS });
            await seed.flush();

            const appInstance = createFastDurableState(filePath);
            const ideInstance = createFastDurableState(filePath);

            await appInstance.updateAppSettings({ appComposerRingEnabled: true, displayCurrency: 'CNY' });
            await appInstance.flush();

            await ideInstance.updateAppSettings({ orchestratorPricingMode: 'strict', calendarRetentionDays: 730 });
            await ideInstance.flush();

            const reloaded = createFastDurableState(filePath).getAppSettings();
            expect(reloaded.appComposerRingEnabled).toBe(true);
            expect(reloaded.displayCurrency).toBe('CNY');
            expect(reloaded.orchestratorPricingMode).toBe('strict');
            expect(reloaded.calendarRetentionDays).toBe(730);
        });
    });
});

describe('[legacy-migration-unit]', () => {
    const tempDirs: string[] = [];


    function makeTempDir(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-legacy-mig-'));
        tempDirs.push(dir);
        return dir;
    }


    afterEach(() => {
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop()!;
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });


    describe('legacy migration idempotency', () => {
        it('does not mark migration done when extraction fails transiently', () => {
            let markedDone = false;
            let imported = false;

            const result = runLegacyMigrationOnce({
                migrationDone: false,
                extractLegacyData: (): LegacyMigrationResult => ({ status: 'failed', error: 'database is locked' }),
                importLegacyData: () => { imported = true; },
                markDone: () => { markedDone = true; },
                log: () => {},
            });

            expect(result?.status).toBe('failed');
            expect(imported).toBe(false);
            expect(markedDone).toBe(false);
        });

        it('marks migration done for imported, empty, and not-found outcomes', () => {
            const outcomes: LegacyMigrationResult[] = [
                {
                    status: 'imported',
                    data: {
                        dailyStoreState: { version: 1, records: { '2026-06-01': { date: '2026-06-01', cycles: [] } } },
                        displayLanguage: 'zh',
                    },
                },
                { status: 'empty' },
                { status: 'not_found' },
            ];

            for (const outcome of outcomes) {
                let markedDone = false;
                const imported: LegacyMigrationData[] = [];

                const result = runLegacyMigrationOnce({
                    migrationDone: false,
                    extractLegacyData: () => outcome,
                    importLegacyData: (data) => { imported.push(data); },
                    markDone: () => { markedDone = true; },
                    log: () => {},
                });

                expect(result?.status).toBe(outcome.status);
                expect(markedDone).toBe(true);
                expect(imported).toHaveLength(outcome.status === 'imported' ? 1 : 0);
            }
        });

        it('skips extraction after migration has already completed', () => {
            let extractorCalls = 0;
            let markedDone = false;

            const result = runLegacyMigrationOnce({
                migrationDone: true,
                extractLegacyData: () => {
                    extractorCalls++;
                    return { status: 'not_found' };
                },
                importLegacyData: () => {},
                markDone: () => { markedDone = true; },
                log: () => {},
            });

            expect(result).toBeNull();
            expect(extractorCalls).toBe(0);
            expect(markedDone).toBe(false);
        });
    });


    describe('W1A-FIX-4: real disposable SQLite DB extraction & async activation setting safety', () => {

        it('passes explicit -- separator and falls back to flagless node -e only on unsupported --experimental-sqlite flag', async () => {
            const invocations: Array<readonly string[]> = [];
            const result = await extractLegacyDataAsync(() => {}, {
                dbPath: '/tmp/fake-state.vscdb',
                nodePaths: ['/usr/bin/node-no-flag'],
                execFileFn: async (_file, args) => {
                    invocations.push(args);
                    if (args[0] === '--experimental-sqlite') {
                        throw new Error('node: bad option: --experimental-sqlite');
                    }
                    return {
                        stdout: JSON.stringify({ displayLanguage: 'en' }),
                        stderr: '',
                    };
                },
            });

            expect(result.status).toBe('imported');
            expect(result.data?.displayLanguage).toBe('en');
            expect(invocations).toHaveLength(2);
            expect(invocations[0]).toContain('--');
            expect(invocations[0].slice(-3)).toEqual([
                '--',
                '/tmp/fake-state.vscdb',
                'AGI-is-going-to-arrive.antigravity-context-monitor',
            ]);
            expect(invocations[1][0]).toBe('-e');
            expect(invocations[1].slice(-3)).toEqual([
                '--',
                '/tmp/fake-state.vscdb',
                'AGI-is-going-to-arrive.antigravity-context-monitor',
            ]);
        });

        it('protects user-modified settings during async activation while still importing calendar history', async () => {
            let currentDisplayLanguage = 'both';
            const importedPayloads: LegacyMigrationData[] = [];
            let markedDone = false;

            let resolveExtract!: (res: LegacyMigrationResult) => void;
            const extractPromise = new Promise<LegacyMigrationResult>((resolve) => {
                resolveExtract = resolve;
            });

            const runPromise = runLegacyMigrationOnceAsync({
                migrationDone: false,
                extractLegacyData: () => extractPromise,
                importLegacyData: (data) => {
                    importedPayloads.push(data);
                    if (data.displayLanguage) {
                        currentDisplayLanguage = data.displayLanguage;
                    }
                },
                markDone: () => { markedDone = true; },
                log: () => {},
                settingsGuard: {
                    getCurrentDisplayLanguage: () => currentDisplayLanguage,
                },
            });

            // User modifies displayLanguage while async extraction is still in flight!
            currentDisplayLanguage = 'en';

            resolveExtract({
                status: 'imported',
                data: {
                    dailyStoreState: { version: 1, records: { '2026-06-01': { date: '2026-06-01', cycles: [] } } },
                    displayLanguage: 'zh',
                },
            });

            const result = await runPromise;
            expect(result?.status).toBe('imported');
            expect(markedDone).toBe(true);
            // User's concurrent edit ('en') MUST NOT be overwritten by legacy 'zh'!
            expect(currentDisplayLanguage).toBe('en');
            expect(importedPayloads).toHaveLength(1);
            expect(importedPayloads[0].displayLanguage).toBeUndefined();
            expect(importedPayloads[0].dailyStoreState?.records['2026-06-01']).toBeDefined();
        });

        it('imports displayLanguage when unchanged during async activation and respects explicit isDisplayLanguageModified', async () => {
            let currentLang = 'both';
            const imported: LegacyMigrationData[] = [];
            await runLegacyMigrationOnceAsync({
                migrationDone: false,
                extractLegacyData: async () => ({
                    status: 'imported',
                    data: { displayLanguage: 'zh' },
                }),
                importLegacyData: (d) => {
                    imported.push(d);
                    if (d.displayLanguage) { currentLang = d.displayLanguage; }
                },
                markDone: () => {},
                log: () => {},
                settingsGuard: { getCurrentDisplayLanguage: () => currentLang },
            });
            expect(currentLang).toBe('zh');
            expect(imported).toEqual([{ displayLanguage: 'zh' }]);

            // Background runLegacyMigrationOnce with explicit modification guard skips displayLanguage
            const bgImported: LegacyMigrationData[] = [];
            let bgDone = false;
            const ret = runLegacyMigrationOnce({
                migrationDone: false,
                extractLegacyData: () => Promise.resolve({
                    status: 'imported',
                    data: {
                        dailyStoreState: { version: 1, records: { '2026-06-02': { date: '2026-06-02', cycles: [] } } },
                        displayLanguage: 'zh',
                    },
                }),
                importLegacyData: (d) => { bgImported.push(d); },
                markDone: () => { bgDone = true; },
                log: () => {},
                settingsGuard: { isDisplayLanguageModified: () => true },
            });
            expect(ret).toBeNull();
            await new Promise<void>((r) => setTimeout(r, 20));
            expect(bgDone).toBe(true);
            expect(bgImported).toHaveLength(1);
            expect(bgImported[0].displayLanguage).toBeUndefined();
            expect(bgImported[0].dailyStoreState?.records['2026-06-02']).toBeDefined();
        });

        it('does not mark migration done when importLegacyData throws asynchronously', async () => {
            let markedDone = false;
            const res = await runLegacyMigrationOnceAsync({
                migrationDone: false,
                extractLegacyData: async () => ({
                    status: 'imported',
                    data: { displayLanguage: 'zh' },
                }),
                importLegacyData: async () => {
                    throw new Error('storage write failed');
                },
                markDone: () => { markedDone = true; },
                log: () => {},
            });
            expect(res?.status).toBe('failed');
            expect(markedDone).toBe(false);
        });
    });
});

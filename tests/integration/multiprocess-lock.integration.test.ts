import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DurableState,
    DurableStateLockTimeoutError,
    acquireLockFile,
    parseLockFileContent,
} from '../../src/durable-state';
import {
    EXPECTED_PLUGIN_NAME,
    acquirePluginUpdateLock,
    computeSha256Hex,
    getPluginUpdateLockPath,
} from '../../src/core/release-security';
import {
    applyAppPluginUpdate,
    type HttpsRequestTransport,
} from '../../src/app/plugin-updater';
import {
    createTempDirTracker,
    makeApprovedReleaseInfo,
    makeTestPluginZip,
    seedTestInstalledPlugin,
} from '../helpers/factories';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INSTALLER_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.mjs');
const COMPILED_DURABLE_STATE_PATH = path.join(REPO_ROOT, 'out', 'durable-state.js');

function readJson(filePath: string): {
    version: number;
    global: Record<string, unknown>;
    workspaces: Record<string, Record<string, unknown>>;
} {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('Real-System Integration: Multi-Process DurableState Locking, Update Lock & config.json CAS', () => {
    const tracker = createTempDirTracker('acm-int-lock-');
    let tempDir: string;

    beforeEach(() => {
        tempDir = tracker.make();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        tracker.cleanup();
    });

    function statePath(name = 'state-v1.json'): string {
        return path.join(tempDir, name);
    }

    it('survives real multi-process concurrent writes without corruption or orphan temp files', async () => {
        expect(
            fs.existsSync(COMPILED_DURABLE_STATE_PATH),
            'Run `npm run compile` before real multi-process DurableState integration tests',
        ).toBe(true);
        const filePath = statePath('multiprocess.json');
        const workerScript = `
            const { DurableState } = require(${JSON.stringify(COMPILED_DURABLE_STATE_PATH)});
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

    it('enforces real cross-process lock ownership & serialization across 3 concurrent child Node writers', async () => {
        expect(fs.existsSync(COMPILED_DURABLE_STATE_PATH)).toBe(true);
        const filePath = statePath('multiprocess-3way.json');
        const workerScript = `
            const { DurableState } = require(${JSON.stringify(COMPILED_DURABLE_STATE_PATH)});
            const [filePath, workerId, billingDay] = process.argv.slice(1);
            (async () => {
                const ds = new DurableState(filePath, { debounceMs: 5 });
                await ds.globalBucket().update('worker_' + workerId, Number(billingDay));
                await ds.globalBucket().update('accountBillingDays', { [workerId + '@test.local']: Number(billingDay) });
                const receipt = await ds.flush();
                if (!receipt.committed) { process.exit(2); }
                ds.dispose();
            })();
        `;

        await Promise.all([
            execFileAsync(process.execPath, ['-e', workerScript, filePath, 'w1', '5'], { windowsHide: true }),
            execFileAsync(process.execPath, ['-e', workerScript, filePath, 'w2', '10'], { windowsHide: true }),
            execFileAsync(process.execPath, ['-e', workerScript, filePath, 'w3', '15'], { windowsHide: true }),
        ]);

        const parsed = readJson(filePath);
        expect(parsed.global.worker_w1).toBe(5);
        expect(parsed.global.worker_w2).toBe(10);
        expect(parsed.global.worker_w3).toBe(15);
        expect(parsed.global.accountBillingDays).toEqual({
            'w1@test.local': 5,
            'w2@test.local': 10,
            'w3@test.local': 15,
        });
        expect(fs.readdirSync(tempDir).filter(f => f.endsWith('.tmp') || f.endsWith('.lock'))).toEqual([]);
    });

    it('reclaims stale locks owned by dead PIDs immediately while preserving active live-writer locks on timeout', async () => {
        const lockPath = statePath('hardened.lock');

        // 1. Dead PID lock is reclaimed immediately without waiting for mtime staleness
        fs.writeFileSync(lockPath, '999999:1700000000000:deadtoken\n', 'utf8');
        const release1 = await acquireLockFile(lockPath, {
            timeoutMs: 200,
            staleMs: 60_000,
            isPidAlive: (pid) => pid === process.pid,
        });
        const lockMeta = parseLockFileContent(fs.readFileSync(lockPath, 'utf8'));
        expect(lockMeta?.pid).toBe(process.pid);
        expect(lockMeta?.token).toBeTruthy();

        // 2. While lock1 is held by an active alive PID, a second writer MUST time out cleanly
        //    with DurableStateLockTimeoutError instead of deleting lock1 and proceeding unlocked!
        await expect(acquireLockFile(lockPath, {
            timeoutMs: 80,
            staleMs: 5_000,
            hardStaleMs: 15_000,
            isPidAlive: () => true,
        })).rejects.toBeInstanceOf(DurableStateLockTimeoutError);

        // Original lock file MUST still exist and retain lock1's owner token
        const stillOwned = parseLockFileContent(fs.readFileSync(lockPath, 'utf8'));
        expect(stillOwned?.token).toBe(lockMeta?.token);

        // 3. Releasing lock1 cleans up its own lock cleanly
        await release1();
        expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('DurableState._flush never clobbers disk or deletes an active lock on lock timeout, and retries on next flush', async () => {
        const filePath = statePath('locked-flush.json');
        const seed = new DurableState(filePath, { debounceMs: 0 });
        await seed.globalBucket().update('displayLanguage', 'en');
        await seed.flush();

        // Simulate another live process actively holding the lock
        const activeLockPath = `${filePath}.lock`;
        const activeLockBody = `424242:${Date.now()}:activewriter\n`;
        fs.writeFileSync(activeLockPath, activeLockBody, 'utf8');

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const writer = new DurableState(filePath, {
            debounceMs: 0,
            lockOptions: {
                timeoutMs: 60,
                staleMs: 5_000,
                hardStaleMs: 15_000,
                isPidAlive: () => true,
            },
        });
        const pendingLockedWrite = writer.globalBucket().update('displayLanguage', 'zh');
        let resolvedWhileLocked = false;
        void Promise.resolve(pendingLockedWrite).then(() => { resolvedWhileLocked = true; });
        const lockedReceipt = await writer.flush();

        // Flush failed safely: active lock was NOT deleted, disk still has 'en', warning was logged,
        // and waiter did NOT resolve as saved while the lock failed.
        expect(lockedReceipt.committed).toBe(false);
        expect(lockedReceipt.errorCode).toBe('ELOCKTIMEOUT');
        expect(resolvedWhileLocked).toBe(false);
        expect(warnSpy).toHaveBeenCalled();
        expect(fs.existsSync(activeLockPath)).toBe(true);
        expect(fs.readFileSync(activeLockPath, 'utf8')).toBe(activeLockBody);
        expect(readJson(filePath).global.displayLanguage).toBe('en');

        // Once the active writer releases its lock, subsequent write/flush persists cleanly and resolves waiters
        fs.unlinkSync(activeLockPath);
        const pendingZoomWrite = writer.globalBucket().update('panelZoomLevel', 115);
        const committedReceipt = await writer.flush();
        expect(committedReceipt.committed).toBe(true);
        await Promise.all([pendingLockedWrite, pendingZoomWrite]);
        expect(readJson(filePath).global.displayLanguage).toBe('zh');
        expect(readJson(filePath).global.panelZoomLevel).toBe(115);
        writer.dispose();
    });

    it('serializes concurrent UI and CLI updates via a shared lock file and reclaims stale dead-PID locks', async () => {
        const installer = await import(INSTALLER_PATH);
        const targetDir = path.join(tempDir, 'lock-test', EXPECTED_PLUGIN_NAME);
        seedTestInstalledPlugin(targetDir, '1.17.11');
        expect(installer.getPluginUpdateLockPath(targetDir)).toBe(getPluginUpdateLockPath(targetDir));

        const zip180 = makeTestPluginZip('1.18.0');
        const sha180 = computeSha256Hex(zip180);
        const rel180 = makeApprovedReleaseInfo('1.18.0');
        const transport: HttpsRequestTransport = async (url) => {
            if (url.pathname.endsWith('SHA256SUMS.txt')) {
                return { statusCode: 200, headers: {}, body: Buffer.from(`${sha180}  ${rel180.assetName}\n`) };
            }
            return { statusCode: 200, headers: {}, body: zip180 };
        };

        let releaseFirst!: () => void;
        let firstEntered!: () => void;
        const firstGate = new Promise<void>((r) => { releaseFirst = r; });
        const firstInside = new Promise<void>((r) => { firstEntered = r; });

        const firstUpdate = applyAppPluginUpdate({
            targetPluginDir: targetDir,
            releaseInfo: rel180,
            currentVersion: '1.17.11',
            transport,
            onBeforeSwap: async () => {
                firstEntered();
                await firstGate;
            },
        });

        await firstInside;
        expect(fs.existsSync(getPluginUpdateLockPath(targetDir))).toBe(true);

        // Second concurrent UI update with short lockTimeoutMs fails cleanly instead of corrupting files
        const contendedUi = await applyAppPluginUpdate({
            targetPluginDir: targetDir,
            releaseInfo: rel180,
            currentVersion: '1.17.11',
            transport,
            lockTimeoutMs: 60,
        });
        expect(contendedUi.ok).toBe(false);
        expect(contendedUi.error).toMatch(/already in progress/i);

        // Concurrent CLI installPluginAtomic also respects the EXACT same lock file!
        const srcCli = path.join(tempDir, 'cli-src');
        seedTestInstalledPlugin(srcCli, '1.18.0');
        expect(() => installer.installPluginAtomic(srcCli, targetDir, { lockTimeoutMs: 60 }))
            .toThrow(/Lock contention/i);

        releaseFirst();
        const firstRes = await firstUpdate;
        expect(firstRes.ok).toBe(true);
        expect(firstRes.installedVersion).toBe('1.18.0');
        expect(fs.existsSync(getPluginUpdateLockPath(targetDir))).toBe(false);

        // Stale lock from a dead PID is cleanly reclaimed
        const lockPath = getPluginUpdateLockPath(targetDir);
        fs.writeFileSync(lockPath, JSON.stringify({
            pid: 999999999,
            owner: 'crashed-writer',
            nonce: 'deadbeef',
            acquiredAt: Date.now() - 10_000,
        }));
        const reclaimed = await acquirePluginUpdateLock(targetDir, { owner: 'recovery', timeoutMs: 200 });
        reclaimed.release();
        expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('retries config.json CAS merge when an external writer updates unrelated settings mid-flight and preserves both edits', async () => {
        const installer = await import(INSTALLER_PATH);
        const cfgPath = path.join(tempDir, 'config.json');
        fs.writeFileSync(cfgPath, JSON.stringify({
            plugins: {
                'antigravity-context-monitor': { enabled: false },
                'other-plugin': { enabled: true },
            },
            userSettings: { theme: 'dark' },
        }, null, 2), 'utf8');

        let injectedExternalEdit = false;
        const res = installer.ensurePluginEnabled({
            configPath: cfgPath,
            allowCli: false,
            onBeforeCommit: ({ attempt }: { attempt: number }) => {
                if (attempt === 1 && !injectedExternalEdit) {
                    injectedExternalEdit = true;
                    // Simulate Antigravity host modifying an unrelated setting concurrently!
                    fs.writeFileSync(cfgPath, JSON.stringify({
                        plugins: {
                            'antigravity-context-monitor': { enabled: false },
                            'other-plugin': { enabled: false },
                        },
                        userSettings: { theme: 'light', concurrentKey: 'must-survive' },
                    }, null, 2), 'utf8');
                }
            },
        });

        expect(res).toMatchObject({
            updated: true,
            enabled: true,
            method: 'config-atomic-merge',
            casAttempts: 2,
        });
        const finalCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        expect(finalCfg.plugins['antigravity-context-monitor'].enabled).toBe(true);
        expect(finalCfg.plugins['other-plugin'].enabled).toBe(false);
        expect(finalCfg.userSettings).toEqual({ theme: 'light', concurrentKey: 'must-survive' });
        expect(fs.existsSync(`${cfgPath}.acm.lock`)).toBe(false);
    });

    it('refuses to clobber unrelated config.json settings on persistent concurrent conflict or active lock contention', async () => {
        const installer = await import(INSTALLER_PATH);
        const cfgPath = path.join(tempDir, 'config-conflict.json');
        fs.writeFileSync(cfgPath, JSON.stringify({
            plugins: { 'antigravity-context-monitor': { enabled: false } },
            userSettings: { seq: 0 },
        }, null, 2), 'utf8');

        // Case A: Constant concurrent mutations exhaust CAS attempts -> refuses to clobber!
        let seq = 0;
        const conflictRes = installer.ensurePluginEnabled({
            configPath: cfgPath,
            allowCli: false,
            maxCasAttempts: 3,
            onBeforeCommit: () => {
                seq += 1;
                fs.writeFileSync(cfgPath, JSON.stringify({
                    plugins: { 'antigravity-context-monitor': { enabled: false } },
                    userSettings: { seq },
                }, null, 2), 'utf8');
            },
        });
        expect(conflictRes).toMatchObject({
            updated: false,
            enabled: null,
            method: 'skipped-concurrent-conflict',
        });
        expect(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).userSettings.seq).toBe(3);

        // Case B: Active lock held by current live PID -> skips cleanly without clobbering
        const lockPath = `${cfgPath}.acm.lock`;
        fs.writeFileSync(lockPath, JSON.stringify({
            pid: process.pid,
            owner: 'other-installer',
            nonce: 'keep-locked',
            acquiredAt: Date.now(),
        }));
        try {
            const lockedRes = installer.ensurePluginEnabled({
                configPath: cfgPath,
                allowCli: false,
                lockTimeoutMs: 50,
            });
            expect(lockedRes).toMatchObject({
                updated: false,
                enabled: null,
                method: 'skipped-concurrent-lock',
            });
        } finally {
            fs.rmSync(lockPath, { force: true });
        }
    });
});

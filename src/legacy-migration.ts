// ─── Legacy Antigravity Data Migration ───────────────────────────────────────
// Detects old "Antigravity" (pre-2.0) globalState databases and automatically
// recovers calendar data + language preference for users who upgraded to
// "Antigravity IDE". Runs once on activation; skipped if already migrated.
//
// The old globalState is an SQLite database (state.vscdb) at:
//   Windows: %APPDATA%\Antigravity\User\globalStorage\state.vscdb
//   macOS:   ~/Library/Application Support/Antigravity/User/globalStorage/state.vscdb
//   Linux:   ~/.config/Antigravity/User/globalStorage/state.vscdb
//
// Strategy: spawn a child Node.js process with --experimental-sqlite to read
// the old DB (the extension's own Node.js runtime may not support node:sqlite).

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { resolveLinuxXdgConfigHome } from './core/cdp-launcher-core';
import type { DailyStoreState } from './daily-store';

/** Result of attempting legacy data extraction */
export interface LegacyMigrationData {
    dailyStoreState?: DailyStoreState;
    displayLanguage?: string;
}

export type LegacyMigrationStatus = 'not_found' | 'imported' | 'empty' | 'failed';

export interface LegacyMigrationResult {
    status: LegacyMigrationStatus;
    data?: LegacyMigrationData;
    error?: string;
}

/**
 * Optional guard to protect user-modified settings during asynchronous activation from
 * being overwritten when legacy migration completes in the background.
 */
export interface LegacyMigrationSettingsGuard {
    /**
     * Snapshot the current `displayLanguage` value BEFORE extraction starts and re-check
     * right BEFORE `importLegacyData()` runs. If the value changed while extraction was
     * in flight, `displayLanguage` is omitted from the imported payload.
     */
    getCurrentDisplayLanguage?: () => string | undefined | null;
    /**
     * Explicit predicate indicating the user already configured or modified `displayLanguage`.
     * When true at import time, `displayLanguage` is skipped while calendar records still import.
     */
    isDisplayLanguageModified?: () => boolean;
    /**
     * Generic per-field predicate indicating a setting key was modified during activation.
     */
    isSettingModified?: (key: keyof LegacyMigrationData) => boolean;
}

export interface LegacyMigrationRunnerOptions {
    migrationDone: boolean;
    extractLegacyData: () => LegacyMigrationResult | Promise<LegacyMigrationResult>;
    importLegacyData: (data: LegacyMigrationData) => void | Promise<void>;
    markDone: () => void | Promise<void>;
    log: (msg: string) => void;
    /** Optional guard protecting user-modified settings during async activation. */
    settingsGuard?: LegacyMigrationSettingsGuard;
}

export type LegacyMigrationAsyncRunnerOptions = LegacyMigrationRunnerOptions;

export type LegacyExecFileFn = (
    file: string,
    args: readonly string[],
    options: {
        encoding: 'utf8';
        timeout: number;
        windowsHide: boolean;
    },
) => Promise<{ stdout: string; stderr: string }>;

export interface ExtractLegacyDataOptions {
    /** Override detected DB path (useful for deterministic testing). */
    dbPath?: string | null;
    /** Override Node executables to try (defaults to [process.execPath, 'node']). */
    nodePaths?: readonly string[];
    /** Per-process timeout in ms (defaults to 10_000). */
    timeoutMs?: number;
    /** Injectable async execFile implementation for testing. */
    execFileFn?: LegacyExecFileFn;
}

function defaultExecFileAsync(
    file: string,
    args: readonly string[],
    options: { encoding: 'utf8'; timeout: number; windowsHide: boolean },
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(file, [...args], options, (err, stdout, stderr) => {
            if (err) {
                reject(err);
                return;
            }
            resolve({
                stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
                stderr: typeof stderr === 'string' ? stderr : String(stderr ?? ''),
            });
        });
    });
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
    return !!value && (typeof value === 'object' || typeof value === 'function')
        && typeof (value as PromiseLike<T>).then === 'function';
}

interface CapturedSettingsSnapshot {
    hasInitialDisplayLanguage: boolean;
    initialDisplayLanguage: string | undefined | null;
}

function captureSettingsSnapshot(guard?: LegacyMigrationSettingsGuard): CapturedSettingsSnapshot {
    if (!guard?.getCurrentDisplayLanguage) {
        return { hasInitialDisplayLanguage: false, initialDisplayLanguage: undefined };
    }
    try {
        return {
            hasInitialDisplayLanguage: true,
            initialDisplayLanguage: guard.getCurrentDisplayLanguage(),
        };
    } catch {
        return { hasInitialDisplayLanguage: false, initialDisplayLanguage: undefined };
    }
}

function filterProtectedLegacyData(
    data: LegacyMigrationData,
    snapshot: CapturedSettingsSnapshot,
    guard: LegacyMigrationSettingsGuard | undefined,
    log: (msg: string) => void,
): LegacyMigrationData {
    if (!guard) {
        return data;
    }
    const filtered: LegacyMigrationData = {};

    if (data.dailyStoreState !== undefined) {
        const blocked = Boolean(guard.isSettingModified?.('dailyStoreState'));
        if (blocked) {
            log('Legacy migration: skipped dailyStoreState because setting was modified during activation');
        } else {
            filtered.dailyStoreState = data.dailyStoreState;
        }
    }

    if (data.displayLanguage !== undefined) {
        let modifiedDuringActivation = false;
        if (snapshot.hasInitialDisplayLanguage && guard.getCurrentDisplayLanguage) {
            try {
                const currentLang = guard.getCurrentDisplayLanguage();
                if (currentLang !== snapshot.initialDisplayLanguage) {
                    modifiedDuringActivation = true;
                }
            } catch {
                // Fail safe: if we cannot read current setting after an async flight, do not overwrite.
                modifiedDuringActivation = true;
            }
        }
        const explicitlyProtected = Boolean(
            guard.isDisplayLanguageModified?.()
            || guard.isSettingModified?.('displayLanguage'),
        );
        if (modifiedDuringActivation || explicitlyProtected) {
            log('Legacy migration: skipped displayLanguage to preserve user-modified setting');
        } else {
            filtered.displayLanguage = data.displayLanguage;
        }
    }

    return filtered;
}

function hasImportableLegacyFields(data: LegacyMigrationData): boolean {
    return data.dailyStoreState !== undefined || data.displayLanguage !== undefined;
}

function applyLegacyMigrationResultSync(
    result: LegacyMigrationResult,
    options: LegacyMigrationRunnerOptions,
    snapshot: CapturedSettingsSnapshot,
): LegacyMigrationResult {
    if (result.status === 'imported' && result.data) {
        const safeData = filterProtectedLegacyData(result.data, snapshot, options.settingsGuard, options.log);
        if (hasImportableLegacyFields(safeData)) {
            void options.importLegacyData(safeData);
        }
    } else if (result.status === 'failed') {
        options.log('Legacy migration: failed, will retry next launch');
        return result;
    } else {
        options.log('Legacy migration: no recoverable data found');
    }

    void options.markDone();
    options.log('Legacy migration: done');
    return result;
}

/**
 * Asynchronous, non-blocking runner for one-time legacy Antigravity DB migration.
 * Never blocks IDE activation or the Node event loop, and snapshots current settings
 * BEFORE extraction so user changes made during async activation are never overwritten.
 */
export async function runLegacyMigrationOnceAsync(
    options: LegacyMigrationAsyncRunnerOptions,
): Promise<LegacyMigrationResult | null> {
    if (options.migrationDone) {
        options.log('Legacy migration: data OK, no migration needed');
        return null;
    }

    const snapshot = captureSettingsSnapshot(options.settingsGuard);

    let result: LegacyMigrationResult;
    try {
        result = await options.extractLegacyData();
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        options.log(`Legacy migration: unexpected error — ${message}`);
        return { status: 'failed', error: message };
    }

    if (result.status === 'imported' && result.data) {
        const safeData = filterProtectedLegacyData(result.data, snapshot, options.settingsGuard, options.log);
        try {
            if (hasImportableLegacyFields(safeData)) {
                await options.importLegacyData(safeData);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            options.log(`Legacy migration: import failed — ${message}`);
            return { status: 'failed', error: message };
        }
    } else if (result.status === 'failed') {
        options.log('Legacy migration: failed, will retry next launch');
        return result;
    } else {
        options.log('Legacy migration: no recoverable data found');
    }

    await options.markDone();
    options.log('Legacy migration: done');
    return result;
}

/**
 * Backward-compatible migration entrypoint.
 * - If `extractLegacyData` returns synchronously, completes synchronously and returns the result.
 * - If `extractLegacyData` returns a Promise (such as `extractLegacyData(log)` / `extractLegacyDataAsync(log)`),
 *   runs completely asynchronously in the background without blocking `activate()` and returns `null`.
 */
export function runLegacyMigrationOnce(options: LegacyMigrationRunnerOptions): LegacyMigrationResult | null {
    if (options.migrationDone) {
        options.log('Legacy migration: data OK, no migration needed');
        return null;
    }

    const snapshot = captureSettingsSnapshot(options.settingsGuard);

    const extracted = options.extractLegacyData();
    if (isPromiseLike<LegacyMigrationResult>(extracted)) {
        void Promise.resolve(extracted)
            .then(async (result) => {
                if (result.status === 'imported' && result.data) {
                    const safeData = filterProtectedLegacyData(result.data, snapshot, options.settingsGuard, options.log);
                    if (hasImportableLegacyFields(safeData)) {
                        await options.importLegacyData(safeData);
                    }
                } else if (result.status === 'failed') {
                    options.log('Legacy migration: failed, will retry next launch');
                    return;
                } else {
                    options.log('Legacy migration: no recoverable data found');
                }
                await options.markDone();
                options.log('Legacy migration: done');
            })
            .catch((err) => {
                const message = err instanceof Error ? err.message : String(err);
                options.log(`Legacy migration: unexpected error — ${message}`);
            });
        return null;
    }

    return applyLegacyMigrationResultSync(extracted, options, snapshot);
}

function buildOldAntigravityDbCandidatePath(): string {
    let appDataDir: string;
    switch (process.platform) {
        case 'win32':
            appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
            break;
        case 'darwin':
            appDataDir = path.join(os.homedir(), 'Library', 'Application Support');
            break;
        default: // linux
            appDataDir = resolveLinuxXdgConfigHome(os.homedir());
            break;
    }
    return path.join(appDataDir, 'Antigravity', 'User', 'globalStorage', 'state.vscdb');
}

/**
 * Get the path to the old Antigravity globalState database.
 * Returns null if the file doesn't exist.
 */
export function getOldAntigravityDbPath(): string | null {
    const dbPath = buildOldAntigravityDbCandidatePath();
    return fs.existsSync(dbPath) ? dbPath : null;
}

/**
 * Non-blocking check for the old Antigravity globalState database path.
 */
export async function getOldAntigravityDbPathAsync(): Promise<string | null> {
    const dbPath = buildOldAntigravityDbCandidatePath();
    try {
        await fs.promises.access(dbPath, fs.constants.F_OK);
        return dbPath;
    } catch {
        return null;
    }
}

// Inline extraction script — executed in a child process with node:sqlite.
// Must be self-contained (no imports from the extension).
// Note: under `node -e "<script>" -- <dbPath> <extensionKey>`, Node consumes `--` and places
// `<dbPath>` at `process.argv[1]` and `<extensionKey>` at `process.argv[2]`. We also strip a
// leading `--` defensively in case a runtime preserves it.
const EXTRACT_SCRIPT = `
const { DatabaseSync } = require('node:sqlite');
const rawArgs = process.argv.slice(1);
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const dbPath = args[0];
const extensionKey = args[1];
if (!dbPath || !extensionKey) {
    process.stderr.write('Missing required dbPath or extensionKey argument');
    process.exit(1);
}
try {
    const db = new DatabaseSync(dbPath, { open: true, readOnly: true });
    let row;
    try {
        row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(extensionKey);
    } finally {
        db.close();
    }
    if (!row || !row.value) { process.stdout.write('{}'); process.exit(0); }
    const parsed = JSON.parse(String(row.value));
    const result = {};
    if (parsed.dailyStoreState) { result.dailyStoreState = parsed.dailyStoreState; }
    if (parsed.displayLanguage) { result.displayLanguage = parsed.displayLanguage; }
    process.stdout.write(JSON.stringify(result));
} catch (e) {
    process.stderr.write(e && e.message ? e.message : String(e));
    process.exit(1);
}
`;

/**
 * Asynchronously attempt to extract calendar data and language from the old Antigravity DB.
 * Uses async child `execFile` with `node:sqlite` so IDE activation never blocks synchronously.
 * Distinguishes transient extraction failures from definitive empty/not-found results.
 */
export async function extractLegacyDataAsync(
    log: (msg: string) => void,
    options: ExtractLegacyDataOptions = {},
): Promise<LegacyMigrationResult> {
    const dbPath = options.dbPath !== undefined
        ? options.dbPath
        : await getOldAntigravityDbPathAsync();
    if (!dbPath) {
        log('Legacy migration: no old Antigravity DB found');
        return { status: 'not_found' };
    }
    log(`Legacy migration: found old DB at ${dbPath}`);

    // The extension stores all globalState under a single key
    const extensionKey = 'AGI-is-going-to-arrive.antigravity-context-monitor';
    const nodePaths = options.nodePaths && options.nodePaths.length > 0
        ? options.nodePaths
        : [process.execPath, 'node'];
    const timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.floor(options.timeoutMs)
        : 10_000;
    const execFileFn = options.execFileFn ?? defaultExecFileAsync;

    try {
        let lastError = '';

        for (const nodePath of nodePaths) {
            const argVariants: readonly (readonly string[])[] = [
                ['--experimental-sqlite', '-e', EXTRACT_SCRIPT, '--', dbPath, extensionKey],
                ['-e', EXTRACT_SCRIPT, '--', dbPath, extensionKey],
            ];
            for (let v = 0; v < argVariants.length; v++) {
                try {
                    const { stdout } = await execFileFn(nodePath, argVariants[v], {
                        encoding: 'utf8',
                        timeout: timeoutMs,
                        windowsHide: true,
                    });

                    const data = JSON.parse(stdout) as LegacyMigrationData;
                    if (data.dailyStoreState || data.displayLanguage) {
                        const recordCount = data.dailyStoreState?.records
                            ? Object.keys(data.dailyStoreState.records).length
                            : 0;
                        log(`Legacy migration: extracted ${recordCount} calendar records, language=${data.displayLanguage || 'none'}`);
                        return { status: 'imported', data };
                    }
                    log('Legacy migration: old DB exists but no extension data found');
                    return { status: 'empty' };
                } catch (err) {
                    lastError = err instanceof Error ? err.message : String(err);
                    // Only retry the flagless variant when the first attempt failed due to an unsupported CLI flag
                    const badFlag = v === 0 && /bad option|unknown option|experimental-sqlite/i.test(lastError);
                    if (badFlag) {
                        continue;
                    }
                    break; // move on to next node path
                }
            }
        }
        log(`Legacy migration: failed to read old DB — ${lastError}`);
        return { status: 'failed', error: lastError };
    } catch (err) {
        log(`Legacy migration: unexpected error — ${err}`);
        return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Non-blocking alias for `extractLegacyDataAsync` so existing callers never invoke
 * synchronous `execFileSync` during extension activation.
 */
export function extractLegacyData(
    log: (msg: string) => void,
    options?: ExtractLegacyDataOptions,
): Promise<LegacyMigrationResult> {
    return extractLegacyDataAsync(log, options);
}

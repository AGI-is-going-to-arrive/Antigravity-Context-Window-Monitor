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
import { execFileSync } from 'child_process';
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

export interface LegacyMigrationRunnerOptions {
    migrationDone: boolean;
    extractLegacyData: () => LegacyMigrationResult;
    importLegacyData: (data: LegacyMigrationData) => void;
    markDone: () => void;
    log: (msg: string) => void;
}

export function runLegacyMigrationOnce(options: LegacyMigrationRunnerOptions): LegacyMigrationResult | null {
    if (options.migrationDone) {
        options.log('Legacy migration: data OK, no migration needed');
        return null;
    }

    const result = options.extractLegacyData();
    if (result.status === 'imported' && result.data) {
        options.importLegacyData(result.data);
    } else if (result.status === 'failed') {
        options.log('Legacy migration: failed, will retry next launch');
        return result;
    } else {
        options.log('Legacy migration: no recoverable data found');
    }

    options.markDone();
    options.log('Legacy migration: done');
    return result;
}

/**
 * Get the path to the old Antigravity globalState database.
 * Returns null if the file doesn't exist.
 */
export function getOldAntigravityDbPath(): string | null {
    let appDataDir: string;
    switch (process.platform) {
        case 'win32':
            appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
            break;
        case 'darwin':
            appDataDir = path.join(os.homedir(), 'Library', 'Application Support');
            break;
        default: // linux
            appDataDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
            break;
    }
    const dbPath = path.join(appDataDir, 'Antigravity', 'User', 'globalStorage', 'state.vscdb');
    return fs.existsSync(dbPath) ? dbPath : null;
}

// Inline extraction script — executed in a child process with --experimental-sqlite.
// Must be self-contained (no imports from the extension).
const EXTRACT_SCRIPT = `
const { DatabaseSync } = require('node:sqlite');
const dbPath = process.argv[2];
const extensionKey = process.argv[3];
try {
    const db = new DatabaseSync(dbPath, { open: true, readOnly: true });
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(extensionKey);
    db.close();
    if (!row || !row.value) { process.stdout.write('{}'); process.exit(0); }
    const parsed = JSON.parse(row.value);
    const result = {};
    if (parsed.dailyStoreState) { result.dailyStoreState = parsed.dailyStoreState; }
    if (parsed.displayLanguage) { result.displayLanguage = parsed.displayLanguage; }
    process.stdout.write(JSON.stringify(result));
} catch (e) {
    process.stderr.write(e.message);
    process.exit(1);
}
`;

/**
 * Attempt to extract calendar data and language from the old Antigravity DB.
 * Uses a child process with node:sqlite to avoid adding native dependencies.
 * Distinguishes transient extraction failures from definitive empty/not-found results.
 */
export function extractLegacyData(log: (msg: string) => void): LegacyMigrationResult {
    const dbPath = getOldAntigravityDbPath();
    if (!dbPath) {
        log('Legacy migration: no old Antigravity DB found');
        return { status: 'not_found' };
    }
    log(`Legacy migration: found old DB at ${dbPath}`);

    // The extension stores all globalState under a single key
    const extensionKey = 'AGI-is-going-to-arrive.antigravity-context-monitor';

    try {
        // Use the system Node.js (process.execPath is the IDE's node, which may not have sqlite)
        // Try the IDE's node first; fall back to 'node' on PATH
        const nodePaths = [process.execPath, 'node'];
        let lastError = '';

        for (const nodePath of nodePaths) {
            try {
                const stdout = execFileSync(nodePath, [
                    '--experimental-sqlite',
                    '-e', EXTRACT_SCRIPT,
                    dbPath,
                    extensionKey,
                ], {
                    encoding: 'utf8',
                    timeout: 10_000,
                    stdio: ['pipe', 'pipe', 'pipe'],
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
                continue; // try next node path
            }
        }
        log(`Legacy migration: failed to read old DB — ${lastError}`);
        return { status: 'failed', error: lastError };
    } catch (err) {
        log(`Legacy migration: unexpected error — ${err}`);
        return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
}

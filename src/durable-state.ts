import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface StateBucket {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): PromiseLike<void>;
}

interface DurableStateFile {
    version: 1;
    global: Record<string, unknown>;
    workspaces: Record<string, Record<string, unknown>>;
}

const DEEP_MERGE_OBJECT_KEYS = new Set<string>([
    'dailyLedger',
    'dailyLedgerState',
    'accountSnapshots',
    'accountBillingDays',
    'customPricing',
    'customModelPricing',
    'dailyStoreState',
    'modelDNAState',
    'quotaActiveTracking',
]);

const RENAME_RETRY_DELAYS_MS = [15, 30, 60, 120, 200];
const MAX_MERGE_DEPTH = 6;
let tmpNonceCounter = 0;

function getDefaultStateFilePath(): string {
    if (process.platform === 'win32' && process.env.APPDATA) {
        return path.join(process.env.APPDATA, 'Antigravity Context Monitor', 'state-v1.json');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity Context Monitor', 'state-v1.json');
    }
    const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
    return path.join(stateHome, 'antigravity-context-monitor', 'state-v1.json');
}

function hasOwn(target: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(target, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stripUtf8Bom(raw: string): string {
    return raw.replace(/^\uFEFF/, '');
}

function deepClone<T>(value: T): T {
    if (value === undefined || value === null || typeof value !== 'object') {
        return value;
    }
    try {
        return JSON.parse(JSON.stringify(value)) as T;
    } catch {
        return value;
    }
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) { return true; }
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
        return false;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) { return false; }
        }
        return true;
    }
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) { return false; }
    for (const k of keysA) {
        if (!hasOwn(objB, k) || !deepEqual(objA[k], objB[k])) {
            return false;
        }
    }
    return true;
}

function parseStateFile(raw: string): DurableStateFile | null {
    try {
        const parsed = JSON.parse(stripUtf8Bom(raw)) as Partial<DurableStateFile>;
        if (!isPlainObject(parsed) || parsed.version !== 1) {
            return null;
        }
        const globalObj = isPlainObject(parsed.global) ? parsed.global : {};
        const workspacesRaw = isPlainObject(parsed.workspaces) ? parsed.workspaces : {};
        const workspaces: Record<string, Record<string, unknown>> = {};
        for (const [wsKey, wsVal] of Object.entries(workspacesRaw)) {
            if (isPlainObject(wsVal)) {
                workspaces[wsKey] = wsVal;
            }
        }
        return {
            version: 1,
            global: globalObj,
            workspaces,
        };
    } catch {
        return null;
    }
}

function mergePlainObjects3Way(
    base: Record<string, unknown> | undefined,
    disk: Record<string, unknown>,
    local: Record<string, unknown>,
    depth = 0,
): Record<string, unknown> {
    const result = deepClone(disk);

    for (const [k, localVal] of Object.entries(local)) {
        const inBase = !!base && hasOwn(base, k);
        const localChanged = !inBase || !deepEqual(base[k], localVal);
        if (!localChanged) {
            // Local did not touch this entry; keep disk's value (or disk's deletion).
            continue;
        }
        if (depth < MAX_MERGE_DEPTH && isPlainObject(result[k]) && isPlainObject(localVal)) {
            const baseSub = inBase && isPlainObject(base[k]) ? base[k] as Record<string, unknown> : undefined;
            result[k] = mergePlainObjects3Way(baseSub, result[k] as Record<string, unknown>, localVal, depth + 1);
        } else {
            result[k] = deepClone(localVal);
        }
    }

    // Honor explicit local deletions when disk did not modify the deleted entry.
    if (base) {
        for (const k of Object.keys(base)) {
            if (!hasOwn(local, k) && hasOwn(result, k) && deepEqual(base[k], result[k])) {
                delete result[k];
            }
        }
    }

    return result;
}

function isAccountSnapshotArray(value: unknown): value is Array<Record<string, unknown>> {
    return Array.isArray(value)
        && value.every(item => isPlainObject(item) && typeof item.email === 'string' && item.email.length > 0);
}

function mergeAccountSnapshotArrays3Way(
    base: unknown,
    disk: Array<Record<string, unknown>>,
    local: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
    const toMap = (arr: Array<Record<string, unknown>>): Record<string, Record<string, unknown>> => {
        const out: Record<string, Record<string, unknown>> = {};
        for (const item of arr) {
            out[item.email as string] = item;
        }
        return out;
    };
    const baseMap = isAccountSnapshotArray(base) ? toMap(base) : undefined;
    const diskMap = toMap(disk);
    const localMap = toMap(local);
    const mergedMap = mergePlainObjects3Way(baseMap, diskMap, localMap, MAX_MERGE_DEPTH);
    return Object.values(mergedMap) as Array<Record<string, unknown>>;
}

function mergeSettledEntries(diskSettled: unknown[], localSettled: unknown[]): unknown[] {
    const out: unknown[] = [];
    const seen = new Set<string>();
    const add = (entry: unknown) => {
        if (isPlainObject(entry)) {
            const settledAt = typeof entry.settledAt === 'string' ? entry.settledAt : '';
            const email = typeof entry.accountEmail === 'string' ? entry.accountEmail : '';
            const poolIds = Array.isArray(entry.poolModelIds) ? entry.poolModelIds.join(',') : '';
            const key = settledAt || email || poolIds
                ? `${settledAt}|${email}|${poolIds}`
                : JSON.stringify(entry);
            if (seen.has(key)) { return; }
            seen.add(key);
        }
        out.push(deepClone(entry));
    };
    for (const item of diskSettled) { add(item); }
    for (const item of localSettled) { add(item); }
    return out;
}

function mergeDailyLedgerState3Way(
    base: Record<string, unknown> | undefined,
    disk: Record<string, unknown>,
    local: Record<string, unknown>,
): Record<string, unknown> {
    const diskDate = typeof disk.dateKey === 'string' ? disk.dateKey : '';
    const localDate = typeof local.dateKey === 'string' ? local.dateKey : '';
    if (diskDate && localDate && diskDate !== localDate) {
        return deepClone(localDate > diskDate ? local : disk);
    }
    const merged = mergePlainObjects3Way(base, disk, local, 0);
    if (Array.isArray(disk.settled) && Array.isArray(local.settled)) {
        merged.settled = mergeSettledEntries(disk.settled, local.settled);
    }
    return merged;
}

function mergeConcurrentValue(
    key: string,
    baseVal: unknown,
    diskVal: unknown,
    localVal: unknown,
): unknown {
    if (key === 'accountSnapshots' && isAccountSnapshotArray(diskVal) && isAccountSnapshotArray(localVal)) {
        return mergeAccountSnapshotArrays3Way(baseVal, diskVal, localVal);
    }
    if ((key === 'dailyLedger' || key === 'dailyLedgerState') && isPlainObject(diskVal) && isPlainObject(localVal)) {
        return mergeDailyLedgerState3Way(
            isPlainObject(baseVal) ? baseVal : undefined,
            diskVal,
            localVal,
        );
    }
    if (key === 'monitorSnapshotState' && isPlainObject(diskVal) && isPlainObject(localVal)) {
        return mergePlainObjects3Way(
            isPlainObject(baseVal) ? baseVal : undefined,
            diskVal,
            localVal,
            0,
        );
    }
    if (DEEP_MERGE_OBJECT_KEYS.has(key) && isPlainObject(diskVal) && isPlainObject(localVal)) {
        return mergePlainObjects3Way(
            isPlainObject(baseVal) ? baseVal : undefined,
            diskVal,
            localVal,
            0,
        );
    }
    return deepClone(localVal);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, ms));
}

async function renameWithRetry(src: string, dest: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        try {
            await fs.promises.rename(src, dest);
            return;
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
            if (!retryable || attempt >= RENAME_RETRY_DELAYS_MS.length) {
                throw err;
            }
            await sleep(RENAME_RETRY_DELAYS_MS[attempt]);
        }
    }
}

async function readFileWithRetry(filePath: string): Promise<string | null> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fs.promises.readFile(filePath, 'utf8');
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ENOENT') { return null; }
            const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
            if (!retryable || attempt >= 2) {
                return null;
            }
            await sleep(15 * (attempt + 1));
        }
    }
}

function buildTempFilePath(filePath: string): string {
    tmpNonceCounter = (tmpNonceCounter + 1) >>> 0;
    const nonce = `${crypto.randomBytes(6).toString('hex')}-${tmpNonceCounter.toString(36)}`;
    return path.join(path.dirname(filePath), `${path.basename(filePath)}.${process.pid}.${nonce}.tmp`);
}

export class DurableState {
    private static readonly SAVE_DEBOUNCE_MS = 250;
    private readonly _filePath: string;
    private _data: DurableStateFile;
    private _baseData: DurableStateFile;
    private _lastSerialized: string;
    private _lastKnownMtimeMs: number | null = null;
    private _lastKnownSize: number | null = null;
    private _dirtyGlobalKeys = new Map<string, number>();
    private _dirtyWorkspaceKeys = new Map<string, Map<string, number>>();
    private _seededGlobalKeys = new Map<string, number>();
    private _seededWorkspaceKeys = new Map<string, Map<string, number>>();
    /**
     * Tracks mergeable object-map keys that were updated on disk by another process
     * during an earlier flush/reload, before local callers re-read them via `get()`.
     * Prevents a subsequent write from a stale in-memory store (e.g. PricingStore /
     * DailyLedger) from silently clobbering entries added by the peer process.
     */
    private _unseenExternalGlobal = new Map<string, { base: unknown; disk: unknown }>();
    private _saveTimer: ReturnType<typeof setTimeout> | undefined;
    private _pendingVersion = 0;
    private _writtenVersion = 0;
    private _flushInFlight: Promise<void> | null = null;
    private _waiters = new Map<number, Array<() => void>>();

    constructor(filePath: string = getDefaultStateFilePath()) {
        this._filePath = filePath;
        this._data = this._load();
        this._baseData = deepClone(this._data);
        this._lastSerialized = this._serialize(this._data);
    }

    globalBucket(fallback?: StateBucket): StateBucket {
        return this._createBucket('global', undefined, fallback);
    }

    workspaceBucket(workspaceKey: string, fallback?: StateBucket): StateBucket {
        return this._createBucket('workspace', workspaceKey, fallback);
    }

    getFilePath(): string {
        return this._filePath;
    }

    exists(): boolean {
        return fs.existsSync(this._filePath);
    }

    /** Immediately flush any pending writes to disk (useful on shutdown or in tests). */
    async flush(): Promise<void> {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = undefined;
        }
        while (this._flushInFlight || this._pendingVersion > this._writtenVersion) {
            if (this._flushInFlight) {
                await this._flushInFlight;
            } else {
                await this._flush();
            }
        }
    }

    /**
     * Re-read the on-disk file if it changed externally and merge non-dirty keys
     * into memory without discarding unsaved local updates.
     * Returns true when external changes were loaded.
     */
    reloadIfChanged(): boolean {
        try {
            const stat = fs.statSync(this._filePath);
            const changedByStat = this._lastKnownMtimeMs === null
                || stat.mtimeMs !== this._lastKnownMtimeMs
                || stat.size !== this._lastKnownSize;
            const raw = fs.readFileSync(this._filePath, 'utf8');
            const clean = stripUtf8Bom(raw);
            if (!changedByStat && clean === this._lastSerialized) {
                return false;
            }
            const diskData = parseStateFile(clean);
            if (!diskData) {
                return false;
            }
            const merged = this._mergeWithDisk(
                diskData,
                this._data,
                this._pendingVersion,
            );
            this._data = merged;
            this._baseData = deepClone(diskData);
            this._lastSerialized = this._serialize(diskData);
            this._lastKnownMtimeMs = stat.mtimeMs;
            this._lastKnownSize = stat.size;
            return true;
        } catch {
            return false;
        }
    }

    private _createBucket(kind: 'global' | 'workspace', workspaceKey?: string, fallback?: StateBucket): StateBucket {
        return {
            get: <T>(key: string, defaultValue: T): T => {
                if (kind === 'global') {
                    this._unseenExternalGlobal.delete(key);
                }
                const source = kind === 'global'
                    ? this._data.global
                    : (this._data.workspaces[workspaceKey || '__default__'] || {});
                if (hasOwn(source, key)) {
                    return source[key] as T;
                }
                const fallbackValue = fallback?.get<T>(key, defaultValue) ?? defaultValue;
                this._set(kind, key, fallbackValue, workspaceKey, false);
                return fallbackValue;
            },
            update: async (key: string, value: unknown): Promise<void> => {
                await this._set(kind, key, value, workspaceKey, true);
                if (fallback) {
                    await fallback.update(key, value);
                }
            },
        };
    }

    private _set(
        kind: 'global' | 'workspace',
        key: string,
        value: unknown,
        workspaceKey?: string,
        isExplicitWrite = true,
    ): Promise<void> {
        const nextVersion = this._pendingVersion + 1;
        if (kind === 'global') {
            let effectiveValue = value;
            if (isExplicitWrite) {
                const unseen = this._unseenExternalGlobal.get(key);
                if (unseen) {
                    this._unseenExternalGlobal.delete(key);
                    effectiveValue = mergeConcurrentValue(key, unseen.base, unseen.disk, value);
                }
            }
            this._data.global[key] = effectiveValue;
            if (isExplicitWrite) {
                this._dirtyGlobalKeys.set(key, nextVersion);
                this._seededGlobalKeys.delete(key);
            } else if (!this._dirtyGlobalKeys.has(key)) {
                this._seededGlobalKeys.set(key, nextVersion);
            }
        } else {
            const bucketKey = workspaceKey || '__default__';
            if (!this._data.workspaces[bucketKey]) {
                this._data.workspaces[bucketKey] = {};
            }
            this._data.workspaces[bucketKey][key] = value;
            if (isExplicitWrite) {
                let wsDirty = this._dirtyWorkspaceKeys.get(bucketKey);
                if (!wsDirty) {
                    wsDirty = new Map();
                    this._dirtyWorkspaceKeys.set(bucketKey, wsDirty);
                }
                wsDirty.set(key, nextVersion);
                this._seededWorkspaceKeys.get(bucketKey)?.delete(key);
            } else if (!this._dirtyWorkspaceKeys.get(bucketKey)?.has(key)) {
                let wsSeeded = this._seededWorkspaceKeys.get(bucketKey);
                if (!wsSeeded) {
                    wsSeeded = new Map();
                    this._seededWorkspaceKeys.set(bucketKey, wsSeeded);
                }
                wsSeeded.set(key, nextVersion);
            }
        }
        return this._scheduleSave();
    }

    private _load(): DurableStateFile {
        try {
            if (!fs.existsSync(this._filePath)) {
                this._lastKnownMtimeMs = null;
                this._lastKnownSize = null;
                return { version: 1, global: {}, workspaces: {} };
            }
            const stat = fs.statSync(this._filePath);
            const raw = fs.readFileSync(this._filePath, 'utf8');
            const parsed = parseStateFile(raw);
            this._lastKnownMtimeMs = stat.mtimeMs;
            this._lastKnownSize = stat.size;
            if (!parsed) {
                return { version: 1, global: {}, workspaces: {} };
            }
            return parsed;
        } catch {
            this._lastKnownMtimeMs = null;
            this._lastKnownSize = null;
            return { version: 1, global: {}, workspaces: {} };
        }
    }

    private _serialize(data: DurableStateFile): string {
        return JSON.stringify(data, null, 2);
    }

    private _scheduleSave(): Promise<void> {
        this._pendingVersion++;
        const version = this._pendingVersion;
        const pending = new Promise<void>(resolve => {
            const waiters = this._waiters.get(version) || [];
            waiters.push(resolve);
            this._waiters.set(version, waiters);
        });

        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
        }
        this._saveTimer = setTimeout(() => {
            this._saveTimer = undefined;
            void this._flush();
        }, DurableState.SAVE_DEBOUNCE_MS);

        return pending;
    }

    private _resolveWaitersUpTo(version: number): void {
        for (const waiterVersion of [...this._waiters.keys()]) {
            if (waiterVersion > version) { continue; }
            const waiters = this._waiters.get(waiterVersion) || [];
            this._waiters.delete(waiterVersion);
            for (const resolve of waiters) {
                resolve();
            }
        }
    }

    private _mergeWithDisk(
        diskData: DurableStateFile,
        localSnapshot: DurableStateFile,
        targetVersion: number,
    ): DurableStateFile {
        const merged: DurableStateFile = deepClone(diskData);

        // Apply passive seeds only if disk does not already define that key.
        for (const [k, ver] of this._seededGlobalKeys.entries()) {
            if (ver <= targetVersion && !hasOwn(merged.global, k) && hasOwn(localSnapshot.global, k)) {
                merged.global[k] = deepClone(localSnapshot.global[k]);
            }
        }

        // Apply explicit local global writes, deep-merging object maps by key.
        for (const [k, ver] of this._dirtyGlobalKeys.entries()) {
            if (ver > targetVersion || !hasOwn(localSnapshot.global, k)) { continue; }
            if (hasOwn(merged.global, k)) {
                merged.global[k] = mergeConcurrentValue(
                    k,
                    this._baseData.global[k],
                    merged.global[k],
                    localSnapshot.global[k],
                );
            } else {
                merged.global[k] = deepClone(localSnapshot.global[k]);
            }
        }

        // Apply passive workspace seeds only if disk does not already define them.
        for (const [wsKey, seededMap] of this._seededWorkspaceKeys.entries()) {
            const localWs = localSnapshot.workspaces[wsKey];
            if (!localWs) { continue; }
            for (const [k, ver] of seededMap.entries()) {
                if (ver > targetVersion || !hasOwn(localWs, k)) { continue; }
                if (!merged.workspaces[wsKey]) { merged.workspaces[wsKey] = {}; }
                if (!hasOwn(merged.workspaces[wsKey], k)) {
                    merged.workspaces[wsKey][k] = deepClone(localWs[k]);
                }
            }
        }

        // Apply explicit local workspace writes.
        for (const [wsKey, dirtyMap] of this._dirtyWorkspaceKeys.entries()) {
            const localWs = localSnapshot.workspaces[wsKey];
            if (!localWs) { continue; }
            if (!merged.workspaces[wsKey]) { merged.workspaces[wsKey] = {}; }
            const baseWs = this._baseData.workspaces[wsKey] || {};
            for (const [k, ver] of dirtyMap.entries()) {
                if (ver > targetVersion || !hasOwn(localWs, k)) { continue; }
                if (hasOwn(merged.workspaces[wsKey], k)) {
                    merged.workspaces[wsKey][k] = mergeConcurrentValue(
                        k,
                        baseWs[k],
                        merged.workspaces[wsKey][k],
                        localWs[k],
                    );
                } else {
                    merged.workspaces[wsKey][k] = deepClone(localWs[k]);
                }
            }
        }

        return merged;
    }

    private _reconcileInMemoryAfterMerge(
        merged: DurableStateFile,
        targetVersion: number,
        prevBaseGlobal: Record<string, unknown>,
    ): void {
        // Pull in merged/external disk keys for anything not mutated again after targetVersion.
        for (const [k, v] of Object.entries(merged.global)) {
            const dirtyVer = this._dirtyGlobalKeys.get(k);
            if (dirtyVer === undefined || dirtyVer <= targetVersion) {
                // If an external writer updated a mergeable key that local hasn't touched yet,
                // record the pre-external base so a later write from a stale in-memory store merges safely.
                if (dirtyVer === undefined && DEEP_MERGE_OBJECT_KEYS.has(k) && !deepEqual(prevBaseGlobal[k], v)) {
                    const existing = this._unseenExternalGlobal.get(k);
                    this._unseenExternalGlobal.set(k, {
                        base: existing ? existing.base : deepClone(prevBaseGlobal[k]),
                        disk: deepClone(v),
                    });
                }
                this._data.global[k] = deepClone(v);
            }
        }
        for (const [wsKey, wsObj] of Object.entries(merged.workspaces)) {
            if (!this._data.workspaces[wsKey]) {
                this._data.workspaces[wsKey] = {};
            }
            const dirtyWs = this._dirtyWorkspaceKeys.get(wsKey);
            for (const [k, v] of Object.entries(wsObj)) {
                const dirtyVer = dirtyWs?.get(k);
                if (dirtyVer === undefined || dirtyVer <= targetVersion) {
                    this._data.workspaces[wsKey][k] = deepClone(v);
                }
            }
        }
    }

    private _clearDirtyUpTo(version: number): void {
        for (const [k, v] of [...this._dirtyGlobalKeys.entries()]) {
            if (v <= version) { this._dirtyGlobalKeys.delete(k); }
        }
        for (const [k, v] of [...this._seededGlobalKeys.entries()]) {
            if (v <= version) { this._seededGlobalKeys.delete(k); }
        }
        for (const [wsKey, map] of [...this._dirtyWorkspaceKeys.entries()]) {
            for (const [k, v] of [...map.entries()]) {
                if (v <= version) { map.delete(k); }
            }
            if (map.size === 0) { this._dirtyWorkspaceKeys.delete(wsKey); }
        }
        for (const [wsKey, map] of [...this._seededWorkspaceKeys.entries()]) {
            for (const [k, v] of [...map.entries()]) {
                if (v <= version) { map.delete(k); }
            }
            if (map.size === 0) { this._seededWorkspaceKeys.delete(wsKey); }
        }
    }

    private async _flush(): Promise<void> {
        if (this._flushInFlight) {
            await this._flushInFlight;
            return;
        }

        const targetVersion = this._pendingVersion;
        const localSnapshot = deepClone(this._data);
        const hasAnyDirty = this._dirtyGlobalKeys.size > 0
            || this._dirtyWorkspaceKeys.size > 0
            || this._seededGlobalKeys.size > 0
            || this._seededWorkspaceKeys.size > 0;

        this._flushInFlight = (async () => {
            try {
                let dataToWrite = localSnapshot;
                let diskExists = false;
                let diskChanged = false;

                try {
                    const stat = await fs.promises.stat(this._filePath);
                    diskExists = true;
                    const statDiffers = this._lastKnownMtimeMs === null
                        || stat.mtimeMs !== this._lastKnownMtimeMs
                        || stat.size !== this._lastKnownSize
                        || Math.abs(Date.now() - stat.mtimeMs) < 1500;
                    if (statDiffers) {
                        const rawDisk = await readFileWithRetry(this._filePath);
                        if (rawDisk !== null) {
                            const cleanDisk = stripUtf8Bom(rawDisk);
                            if (cleanDisk !== this._lastSerialized || this._lastKnownMtimeMs === null) {
                                const parsedDisk = parseStateFile(cleanDisk);
                                if (parsedDisk) {
                                    diskChanged = true;
                                    dataToWrite = this._mergeWithDisk(parsedDisk, localSnapshot, targetVersion);
                                }
                            }
                        }
                    }
                } catch (err) {
                    const code = (err as NodeJS.ErrnoException).code;
                    if (code !== 'ENOENT') {
                        // Proceed with local snapshot if stat fails unexpectedly.
                    }
                }

                const serialized = this._serialize(dataToWrite);
                if (diskExists && !diskChanged && serialized === this._lastSerialized && !hasAnyDirty) {
                    this._clearDirtyUpTo(targetVersion);
                    return;
                }
                if (diskExists && !diskChanged && serialized === this._lastSerialized) {
                    this._clearDirtyUpTo(targetVersion);
                    return;
                }

                await fs.promises.mkdir(path.dirname(this._filePath), { recursive: true });
                const tmpPath = buildTempFilePath(this._filePath);
                try {
                    const writeOpts: fs.WriteFileOptions = process.platform === 'win32'
                        ? { encoding: 'utf8' }
                        : { encoding: 'utf8', mode: 0o600 };
                    await fs.promises.writeFile(tmpPath, serialized, writeOpts);
                    await renameWithRetry(tmpPath, this._filePath);
                } catch (writeErr) {
                    await fs.promises.unlink(tmpPath).catch(() => {});
                    throw writeErr;
                }

                const prevBaseGlobal = this._baseData.global;
                this._lastSerialized = serialized;
                this._baseData = deepClone(dataToWrite);
                if (diskChanged) {
                    this._reconcileInMemoryAfterMerge(dataToWrite, targetVersion, prevBaseGlobal);
                }
                this._clearDirtyUpTo(targetVersion);

                try {
                    const updatedStat = await fs.promises.stat(this._filePath);
                    this._lastKnownMtimeMs = updatedStat.mtimeMs;
                    this._lastKnownSize = updatedStat.size;
                } catch {
                    this._lastKnownMtimeMs = null;
                    this._lastKnownSize = null;
                }
            } catch (err) {
                console.warn('[Antigravity Context Monitor] Durable state persistence failed:', err);
            } finally {
                this._writtenVersion = Math.max(this._writtenVersion, targetVersion);
                this._resolveWaitersUpTo(this._writtenVersion);
                this._flushInFlight = null;
                if (!this._saveTimer && this._pendingVersion > this._writtenVersion) {
                    void this._flush();
                }
            }
        })();

        await this._flushInFlight;
    }
}

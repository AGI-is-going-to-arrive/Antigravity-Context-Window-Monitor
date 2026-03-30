import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface StateBucket {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Thenable<void>;
}

interface DurableStateFile {
    version: 1;
    global: Record<string, unknown>;
    workspaces: Record<string, Record<string, unknown>>;
}

const DEFAULT_STATE: DurableStateFile = {
    version: 1,
    global: {},
    workspaces: {},
};

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

export class DurableState {
    private static readonly SAVE_DEBOUNCE_MS = 250;
    private readonly _filePath: string;
    private _data: DurableStateFile;
    private _lastSerialized: string;
    private _saveTimer: ReturnType<typeof setTimeout> | undefined;
    private _pendingVersion = 0;
    private _writtenVersion = 0;
    private _flushInFlight: Promise<void> | null = null;
    private _waiters = new Map<number, Array<() => void>>();

    constructor(filePath: string = getDefaultStateFilePath()) {
        this._filePath = filePath;
        this._data = this._load();
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

    private _createBucket(kind: 'global' | 'workspace', workspaceKey?: string, fallback?: StateBucket): StateBucket {
        return {
            get: <T>(key: string, defaultValue: T): T => {
                const source = kind === 'global'
                    ? this._data.global
                    : (this._data.workspaces[workspaceKey || '__default__'] || {});
                if (hasOwn(source, key)) {
                    return source[key] as T;
                }
                const fallbackValue = fallback?.get<T>(key, defaultValue) ?? defaultValue;
                this._set(kind, key, fallbackValue, workspaceKey);
                return fallbackValue;
            },
            update: async (key: string, value: unknown): Promise<void> => {
                await this._set(kind, key, value, workspaceKey);
                if (fallback) {
                    await fallback.update(key, value);
                }
            },
        };
    }

    private _set(kind: 'global' | 'workspace', key: string, value: unknown, workspaceKey?: string): Promise<void> {
        if (kind === 'global') {
            this._data.global[key] = value;
        } else {
            const bucketKey = workspaceKey || '__default__';
            if (!this._data.workspaces[bucketKey]) {
                this._data.workspaces[bucketKey] = {};
            }
            this._data.workspaces[bucketKey][key] = value;
        }
        return this._scheduleSave();
    }

    private _load(): DurableStateFile {
        try {
            if (!fs.existsSync(this._filePath)) {
                return { ...DEFAULT_STATE };
            }
            const raw = fs.readFileSync(this._filePath, 'utf8');
            const parsed = JSON.parse(raw) as Partial<DurableStateFile>;
            if (parsed.version !== 1) {
                return { ...DEFAULT_STATE };
            }
            return {
                version: 1,
                global: parsed.global || {},
                workspaces: parsed.workspaces || {},
            };
        } catch {
            return { ...DEFAULT_STATE };
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

    private async _flush(): Promise<void> {
        if (this._flushInFlight) {
            await this._flushInFlight;
            return;
        }

        const targetVersion = this._pendingVersion;
        const serialized = this._serialize(this._data);
        if (serialized === this._lastSerialized) {
            this._writtenVersion = Math.max(this._writtenVersion, targetVersion);
            this._resolveWaitersUpTo(this._writtenVersion);
            return;
        }

        this._flushInFlight = (async () => {
            try {
                await fs.promises.mkdir(path.dirname(this._filePath), { recursive: true });
                await fs.promises.writeFile(this._filePath, serialized, 'utf8');
                this._lastSerialized = serialized;
            } catch {
                // Ignore persistence failures; VS Code state remains as fallback.
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

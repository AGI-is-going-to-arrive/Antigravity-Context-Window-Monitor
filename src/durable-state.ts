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
    private readonly _filePath: string;
    private _data: DurableStateFile;

    constructor(filePath: string = getDefaultStateFilePath()) {
        this._filePath = filePath;
        this._data = this._load();
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
                this._set(kind, key, value, workspaceKey);
                if (fallback) {
                    await fallback.update(key, value);
                }
            },
        };
    }

    private _set(kind: 'global' | 'workspace', key: string, value: unknown, workspaceKey?: string): void {
        if (kind === 'global') {
            this._data.global[key] = value;
        } else {
            const bucketKey = workspaceKey || '__default__';
            if (!this._data.workspaces[bucketKey]) {
                this._data.workspaces[bucketKey] = {};
            }
            this._data.workspaces[bucketKey][key] = value;
        }
        this._save();
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

    private _save(): void {
        try {
            fs.mkdirSync(path.dirname(this._filePath), { recursive: true });
            fs.writeFileSync(this._filePath, JSON.stringify(this._data, null, 2), 'utf8');
        } catch {
            // Ignore persistence failures; VS Code state remains as fallback.
        }
    }
}

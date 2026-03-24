import type { ContextUsage } from './tracker';
import type { GMConversationData } from './gm-tracker';

interface WorkspaceStateLike {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): Thenable<void>;
}

interface MonitorStoreState {
    version: 1;
    currentCascadeId: string | null;
    snapshots: Record<string, ContextUsage>;
    gmConversations?: Record<string, GMConversationData>;
}

const STORAGE_KEY = 'monitorSnapshotState';
const MAX_SNAPSHOTS = 200;

function sortByLastModified(usages: ContextUsage[]): ContextUsage[] {
    return [...usages].sort((a, b) =>
        new Date(b.lastModifiedTime).getTime() - new Date(a.lastModifiedTime).getTime(),
    );
}

export class MonitorStore {
    private _workspaceState: WorkspaceStateLike | null = null;
    private _snapshots = new Map<string, ContextUsage>();
    private _gmConversations = new Map<string, GMConversationData>();
    private _currentCascadeId: string | null = null;

    init(workspaceState: WorkspaceStateLike): void {
        this._workspaceState = workspaceState;
        const saved = workspaceState.get<MonitorStoreState | null>(STORAGE_KEY, null);
        if (!saved || saved.version !== 1 || !saved.snapshots) {
            return;
        }

        for (const [cascadeId, usage] of Object.entries(saved.snapshots)) {
            this._snapshots.set(cascadeId, usage);
        }
        for (const [cascadeId, conversation] of Object.entries(saved.gmConversations || {})) {
            this._gmConversations.set(cascadeId, conversation);
        }
        this._currentCascadeId = saved.currentCascadeId || null;
        this._trim();
    }

    restore(): { currentUsage: ContextUsage | null; allUsages: ContextUsage[]; gmConversations: Record<string, GMConversationData> } {
        return {
            currentUsage: this._currentCascadeId
                ? this._snapshots.get(this._currentCascadeId) || null
                : null,
            allUsages: this.getAll(),
            gmConversations: this.getGMConversations(),
        };
    }

    record(usages: ContextUsage[], currentCascadeId?: string): void {
        for (const usage of usages) {
            this._snapshots.set(usage.cascadeId, { ...usage });
        }
        if (currentCascadeId) {
            this._currentCascadeId = currentCascadeId;
        }
        this._trim();
        this._persist();
    }

    recordGMConversations(conversations: GMConversationData[]): void {
        for (const conversation of conversations) {
            this._gmConversations.set(conversation.cascadeId, conversation);
        }
        this._trim();
        this._persist();
    }

    clearGMConversations(): void {
        this._gmConversations.clear();
        this._persist();
    }

    getAll(): ContextUsage[] {
        return sortByLastModified([...this._snapshots.values()]);
    }

    getGMConversations(): Record<string, GMConversationData> {
        return Object.fromEntries(this._gmConversations.entries());
    }

    private _trim(): void {
        const sorted = sortByLastModified([...this._snapshots.values()]);
        if (sorted.length <= MAX_SNAPSHOTS) {
            return;
        }

        const keepIds = new Set(sorted.slice(0, MAX_SNAPSHOTS).map(usage => usage.cascadeId));
        for (const cascadeId of [...this._snapshots.keys()]) {
            if (!keepIds.has(cascadeId)) {
                this._snapshots.delete(cascadeId);
            }
        }
        for (const cascadeId of [...this._gmConversations.keys()]) {
            if (!keepIds.has(cascadeId)) {
                this._gmConversations.delete(cascadeId);
            }
        }
        if (this._currentCascadeId && !this._snapshots.has(this._currentCascadeId)) {
            this._currentCascadeId = sorted[0]?.cascadeId || null;
        }
    }

    private _persist(): void {
        if (!this._workspaceState) {
            return;
        }

        const snapshots: Record<string, ContextUsage> = {};
        for (const [cascadeId, usage] of this._snapshots) {
            snapshots[cascadeId] = usage;
        }
        const gmConversations: Record<string, GMConversationData> = {};
        for (const [cascadeId, conversation] of this._gmConversations) {
            gmConversations[cascadeId] = conversation;
        }

        this._workspaceState.update(STORAGE_KEY, {
            version: 1,
            currentCascadeId: this._currentCascadeId,
            snapshots,
            gmConversations,
        } satisfies MonitorStoreState);
    }
}

import { normalizeModelDisplayName, resolveModelId } from './models';
import type { GMCompletionConfig, GMModelStats, GMSummary } from './gm-tracker';

export interface PersistedModelDNA {
    displayName: string;
    responseModel: string;
    apiProvider: string;
    completionConfig: GMCompletionConfig | null;
    hasSystemPrompt: boolean;
    toolCount: number;
    promptSectionTitles: string[];
}

export interface ModelDNAStoreState {
    version: 1;
    entries: Record<string, PersistedModelDNA>;
}

export function getModelDNAKey(
    displayName: string,
    responseModel?: string,
): string {
    const normalizedName = normalizeModelDisplayName(displayName) || displayName;
    const resolvedId = resolveModelId(normalizedName);
    return resolvedId || responseModel || normalizedName;
}

function cloneCompletionConfig(config: GMCompletionConfig | null): GMCompletionConfig | null {
    return config ? { ...config } : null;
}

function clonePersistedEntry(entry: PersistedModelDNA): PersistedModelDNA {
    return {
        displayName: normalizeModelDisplayName(entry.displayName) || entry.displayName,
        responseModel: entry.responseModel,
        apiProvider: entry.apiProvider,
        completionConfig: cloneCompletionConfig(entry.completionConfig),
        hasSystemPrompt: !!entry.hasSystemPrompt,
        toolCount: Math.max(0, entry.toolCount || 0),
        promptSectionTitles: [...(entry.promptSectionTitles || [])],
    };
}

function buildPersistedEntry(name: string, stats: GMModelStats): PersistedModelDNA {
    return {
        displayName: normalizeModelDisplayName(name) || name,
        responseModel: stats.responseModel || '',
        apiProvider: stats.apiProvider || '',
        completionConfig: cloneCompletionConfig(stats.completionConfig),
        hasSystemPrompt: !!stats.hasSystemPrompt,
        toolCount: Math.max(0, stats.toolCount || 0),
        promptSectionTitles: [...(stats.promptSectionTitles || [])],
    };
}

export function restoreModelDNAState(
    state: ModelDNAStoreState | null | undefined,
): Record<string, PersistedModelDNA> {
    if (!state || state.version !== 1 || !state.entries) {
        return {};
    }
    const restored: Record<string, PersistedModelDNA> = {};
    for (const entry of Object.values(state.entries)) {
        const normalizedEntry = clonePersistedEntry(entry);
        const normalizedKey = getModelDNAKey(normalizedEntry.displayName, normalizedEntry.responseModel);
        const existing = restored[normalizedKey];
        if (!existing) {
            restored[normalizedKey] = normalizedEntry;
            continue;
        }
        restored[normalizedKey] = {
            displayName: normalizedEntry.displayName || existing.displayName,
            responseModel: normalizedEntry.responseModel || existing.responseModel,
            apiProvider: normalizedEntry.apiProvider || existing.apiProvider,
            completionConfig: normalizedEntry.completionConfig || existing.completionConfig,
            hasSystemPrompt: existing.hasSystemPrompt || normalizedEntry.hasSystemPrompt,
            toolCount: Math.max(existing.toolCount || 0, normalizedEntry.toolCount || 0),
            promptSectionTitles: normalizedEntry.promptSectionTitles.length >= existing.promptSectionTitles.length
                ? [...normalizedEntry.promptSectionTitles]
                : [...existing.promptSectionTitles],
        };
    }
    return restored;
}

export function serializeModelDNAState(
    entries: Record<string, PersistedModelDNA>,
): ModelDNAStoreState {
    const cloned: Record<string, PersistedModelDNA> = {};
    for (const [key, entry] of Object.entries(entries)) {
        cloned[key] = clonePersistedEntry(entry);
    }
    return { version: 1, entries: cloned };
}

export function mergeModelDNAState(
    existing: Record<string, PersistedModelDNA>,
    summary: GMSummary | null | undefined,
): { entries: Record<string, PersistedModelDNA>; changed: boolean } {
    const merged = restoreModelDNAState({
        version: 1,
        entries: existing,
    });
    let changed = Object.keys(merged).length !== Object.keys(existing).length;
    for (const [key, entry] of Object.entries(merged)) {
        merged[key] = clonePersistedEntry(entry);
    }
    if (!summary) {
        return { entries: merged, changed };
    }

    for (const [name, stats] of Object.entries(summary.modelBreakdown)) {
        const key = getModelDNAKey(name, stats.responseModel);
        const next = buildPersistedEntry(name, stats);
        const prev = merged[key];
        if (!prev) {
            merged[key] = next;
            changed = true;
            continue;
        }

        const updated: PersistedModelDNA = {
            displayName: next.displayName || prev.displayName,
            responseModel: next.responseModel || prev.responseModel,
            apiProvider: next.apiProvider || prev.apiProvider,
            completionConfig: next.completionConfig || prev.completionConfig,
            hasSystemPrompt: prev.hasSystemPrompt || next.hasSystemPrompt,
            toolCount: Math.max(prev.toolCount || 0, next.toolCount || 0),
            promptSectionTitles: next.promptSectionTitles.length >= prev.promptSectionTitles.length
                ? [...next.promptSectionTitles]
                : [...prev.promptSectionTitles],
        };

        const same = JSON.stringify(prev) === JSON.stringify(updated);
        merged[key] = updated;
        if (!same) {
            changed = true;
        }
    }

    return { entries: merged, changed };
}

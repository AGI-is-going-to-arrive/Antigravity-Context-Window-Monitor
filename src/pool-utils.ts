import { getQuotaPoolKey, type ModelConfig } from './models';
import type { QuotaSession } from './quota-tracker';
import { parseStrictResetTimestamp } from './tracker';

export interface ModelQuotaPoolGroup {
    key: string;
    resetTime: string;
    labels: string[];
    modelIds: string[];
    /**
     * Minimum finite `remainingFraction` in `[0, 1]` across models in this pool,
     * or `null` when no model in the pool has a finite numeric fraction.
     * Never fabricates `1.0` (100%) for all-NaN / unknown pools.
     */
    minFraction: number | null;
}

/**
 * Parse a pool quota resetTime into positive epoch ms (strict ISO-8601 with timezone).
 * Rejects proto3 epoch-0 placeholders (`1970-01-01T00:00:00Z`), negative epochs, and malformed dates.
 */
export function parsePositivePoolResetMs(raw: unknown): number | null {
    const ms = parseStrictResetTimestamp(raw);
    return ms !== null && ms > 0 ? ms : null;
}

/** Sort pool resetTime strings chronologically by UTC epoch ms (valid positive timestamps first). */
export function comparePoolResetTimes(a: string, b: string): number {
    const aMs = parsePositivePoolResetMs(a);
    const bMs = parsePositivePoolResetMs(b);
    if (aMs !== null && bMs !== null) {
        return aMs - bMs || a.localeCompare(b);
    }
    if (aMs !== null) { return -1; }
    if (bMs !== null) { return 1; }
    return a.localeCompare(b);
}

/**
 * Group model configs into canonical quota pools, computing `minFraction` ONLY when
 * at least one model in the pool reports a finite numeric `remainingFraction` in `[0, 1]`.
 * All-NaN / missing-fraction pools return `minFraction: null` (never fabricated `1.0`).
 */
export function groupModelConfigsByQuotaPool(configs: readonly ModelConfig[]): ModelQuotaPoolGroup[] {
    const poolMap = new Map<string, {
        labels: string[];
        modelIds: string[];
        resetEntries: Map<string, number>;
        minFraction: number | null;
    }>();

    for (const c of configs) {
        if (!c.quotaInfo) { continue; }
        const rawReset = typeof c.quotaInfo.resetTime === 'string' ? c.quotaInfo.resetTime.trim() : '';
        const resetMs = parsePositivePoolResetMs(rawReset);
        const resetTime = resetMs !== null ? rawReset : '';
        const key = getQuotaPoolKey(c.model, resetTime || undefined);
        const pool = poolMap.get(key) || {
            labels: [],
            modelIds: [],
            resetEntries: new Map<string, number>(),
            minFraction: null,
        };
        const label = c.label || c.model;
        if (label && !pool.labels.includes(label)) {
            pool.labels.push(label);
        }
        if (c.model && !pool.modelIds.includes(c.model)) {
            pool.modelIds.push(c.model);
        }
        if (resetTime && resetMs !== null && !pool.resetEntries.has(resetTime)) {
            pool.resetEntries.set(resetTime, resetMs);
        }
        const fraction = c.quotaInfo.remainingFraction;
        if (typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1) {
            pool.minFraction = pool.minFraction === null ? fraction : Math.min(pool.minFraction, fraction);
        }
        poolMap.set(key, pool);
    }

    return [...poolMap.entries()].map(([key, pool]) => {
        const sortedResets = [...pool.resetEntries.entries()]
            .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
        return {
            key,
            resetTime: sortedResets[0]?.[0] || '',
            labels: pool.labels,
            modelIds: pool.modelIds,
            minFraction: pool.minFraction,
        };
    });
}

function getPoolKey(modelId: string, configs: ModelConfig[]): string {
    const config = configs.find(c => c.model === modelId);
    return getQuotaPoolKey(modelId, config?.quotaInfo?.resetTime);
}

export function expandModelIdsToPool(modelIds: string[], configs: ModelConfig[]): string[] {
    const targetPoolKeys = new Set<string>();
    for (const config of configs) {
        if (modelIds.includes(config.model)) {
            targetPoolKeys.add(getQuotaPoolKey(config.model, config.quotaInfo?.resetTime));
        }
    }
    if (targetPoolKeys.size === 0) {
        return [...new Set(modelIds)];
    }

    const poolModels = new Set(modelIds);
    for (const config of configs) {
        if (targetPoolKeys.has(getQuotaPoolKey(config.model, config.quotaInfo?.resetTime))) {
            poolModels.add(config.model);
        }
    }
    return [...poolModels];
}

export function groupModelIdsByResetPool(modelIds: string[], configs: ModelConfig[]): string[][] {
    const grouped = new Map<string, string[]>();
    for (const modelId of modelIds) {
        const key = getPoolKey(modelId, configs);
        const existing = grouped.get(key) || [];
        existing.push(modelId);
        grouped.set(key, existing);
    }

    return [...grouped.values()].map(ids => expandModelIdsToPool(ids, configs));
}

export function findLatestQuotaSessionForPool(
    poolModelIds: string[],
    configs: ModelConfig[],
    history: QuotaSession[],
): QuotaSession | null {
    const poolLabels = new Set(
        configs
            .filter(config => poolModelIds.includes(config.model))
            .map(config => config.label),
    );

    for (const session of history) {
        if (poolModelIds.includes(session.modelId)) {
            return session;
        }
        if (session.poolModels?.some(label => poolLabels.has(label))) {
            return session;
        }
        if (poolLabels.has(session.modelLabel)) {
            return session;
        }
    }
    return null;
}

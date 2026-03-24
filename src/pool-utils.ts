import type { ModelConfig } from './models';
import type { QuotaSession } from './quota-tracker';

function getPoolKey(modelId: string, configs: ModelConfig[]): string {
    const config = configs.find(c => c.model === modelId);
    return config?.quotaInfo?.resetTime || modelId;
}

export function expandModelIdsToPool(modelIds: string[], configs: ModelConfig[]): string[] {
    const targetResetTimes = new Set<string>();
    for (const config of configs) {
        if (modelIds.includes(config.model) && config.quotaInfo?.resetTime) {
            targetResetTimes.add(config.quotaInfo.resetTime);
        }
    }
    if (targetResetTimes.size === 0) {
        return [...new Set(modelIds)];
    }

    const poolModels = new Set(modelIds);
    for (const config of configs) {
        if (config.quotaInfo?.resetTime && targetResetTimes.has(config.quotaInfo.resetTime)) {
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

// ─── Models Tab Content Builder ─────────────────────────────────────────────
// Centralizes model-related information: default model, personal model quota,
// and GM-derived model DNA.

import { tBi } from './i18n';
import { ModelConfig, UserStatusInfo } from './models';
import type { GMSummary } from './gm-tracker';
import { ICON } from './webview-icons';
import { buildDefaultModelCard, buildModelQuotaGrid, sortModels } from './webview-profile-tab';
import { buildModelDNACards } from './pricing-panel';
import type { PersistedModelDNA } from './model-dna-store';

export function buildModelsTabContent(
    userInfo: UserStatusInfo | null,
    configs: ModelConfig[],
    gmSummary: GMSummary | null,
    persistedModelDNA: Record<string, PersistedModelDNA>,
): string {
    const parts: string[] = [];
    const sortedConfigs = userInfo ? sortModels(configs, userInfo.modelSortOrder) : configs;

    const defaultModelHtml = buildDefaultModelCard(userInfo);
    if (defaultModelHtml) {
        parts.push(defaultModelHtml);
    }

    const quotaHtml = buildModelQuotaGrid(sortedConfigs);
    if (quotaHtml) {
        parts.push(quotaHtml);
    }

    const modelDNAHtml = buildModelDNACards(gmSummary, persistedModelDNA, sortedConfigs);
    if (modelDNAHtml) {
        parts.push(modelDNAHtml);
    } else {
        parts.push(`
            <section class="card empty">
                <h2>${ICON.bolt} ${tBi('Model Info', '模型信息')}</h2>
                <p class="empty-desc">${tBi(
                    'Model information will appear after GM data is available.',
                    '待 GM 数据可用后，这里会显示模型信息。',
                )}</p>
            </section>`);
    }

    if (parts.length === 0) {
        return `
            <section class="card empty">
                <h2>${ICON.bolt} ${tBi('Models', '模型')}</h2>
                <p class="empty-desc">${tBi(
                    'Waiting for model-related data from LS...',
                    '等待 LS 返回模型相关数据...',
                )}</p>
            </section>`;
    }

    return parts.join('');
}

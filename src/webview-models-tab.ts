// ─── Models Tab Content Builder ─────────────────────────────────────────────
// Centralizes model-related information: default model, personal model quota,
// and official model configurations and limit parameters without GM data contamination.

import { getLanguage, tBi } from './i18n';
import { ModelConfig, UserStatusInfo, getModelSpecs, ModelSpec, updateModelSpec, guessContextLimitSpec } from './models';
import { ICON } from './webview-icons';
import { buildDefaultModelCard, buildModelQuotaGrid, sortModels } from './webview-profile-tab';
import { esc } from './webview-helpers';

/** Use the selected UI locale, independent of the extension host's OS locale. */
function formatTokens(value: number): string {
    return Number.isFinite(value) && value > 0
        ? value.toLocaleString(getLanguage() === 'zh' ? 'zh-CN' : 'en-US')
        : tBi('Not available', '暂无数据');
}

function thinkingDescription(spec: ModelSpec): string {
    if (!spec.supportsThinking) { return tBi('Not supported', '不支持'); }
    if (spec.supportsAdaptiveThinking) { return tBi('Adaptive', '自适应'); }
    if (spec.thinkingBudget === -1) { return tBi('Dynamic', '动态'); }
    if (Number.isFinite(spec.thinkingBudget) && spec.thinkingBudget > 0) {
        return `${tBi('Budget', '预算')}: ${formatTokens(spec.thinkingBudget)}`;
    }
    // A zero/absent budget does not mean thinking is disabled. New adaptive
    // Claude models expose supportsThinking=true without a fixed token budget.
    return tBi('Supported · Budget unspecified', '支持 · 预算未指定');
}

function providerLabel(provider: string): string {
    const key = provider.replace(/^API_PROVIDER_/, '');
    const labels: Record<string, string> = {
        GOOGLE_GEMINI: 'Google Gemini',
        ANTHROPIC_VERTEX: 'Anthropic · Vertex',
        ANTHROPIC: 'Anthropic',
        OPENAI_VERTEX: 'OpenAI · Vertex',
        OPENAI: 'OpenAI',
    };
    return labels[key] || key.replace(/_/g, ' ') || tBi('Provider not available', '暂无提供商信息');
}

export function buildModelInfoGrid(specs: ModelSpec[]): string {
    const cards = specs.map((s) => {
        const shortId = s.placeholderId.replace(/^MODEL_PLACEHOLDER_/, '');
        const extraId = s.placeholderId && s.placeholderId !== s.modelId
            ? `<code class="spec-short-id" title="${esc(s.placeholderId)}">${esc(shortId)}</code>` : '';
        return `
            <article class="spec-card" aria-label="${esc(s.displayName)}" data-model-id="${esc(s.placeholderId)}">
                <header class="spec-header">
                    <h3 class="spec-name">${esc(s.displayName)}</h3>
                    <p class="spec-provider" title="${esc(s.apiProvider)}">${esc(providerLabel(s.apiProvider))}</p>
                </header>
                <dl class="spec-metrics">
                    <div class="spec-metric spec-limit">
                        <dt>${tBi('Compression limit', '压缩阈值')}</dt>
                        <dd>${formatTokens(s.cpLimit)}</dd>
                    </div>
                    <div class="spec-metric">
                        <dt>${tBi('Native context', '原生上下文')}</dt>
                        <dd>${formatTokens(s.maxTokens)}</dd>
                    </div>
                    <div class="spec-metric spec-thinking">
                        <dt>${tBi('Thinking', '思考能力')}</dt>
                        <dd>${thinkingDescription(s)}</dd>
                    </div>
                </dl>
                <div class="spec-identity">
                    <code class="spec-model-id" title="${esc(s.modelId)}">${esc(s.modelId)}</code>${extraId}
                </div>
            </article>`;
    }).join('');

    const specIconSvg = `<svg class="act-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: text-bottom; margin-right: 6px;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;

    return `
        <section class="card model-info-section">
            <h2>${specIconSvg} ${tBi('Model Info', '模型信息')}</h2>
            <p class="spec-description">${tBi('Token limits for the models available in your IDE. Compression limits differ from native context windows.', 'IDE 中可用模型的 Token 上限。压缩阈值与模型原生上下文窗口不同。')}</p>
            <div class="spec-grid">
                ${cards}
            </div>
        </section>`;
}

export function buildModelsTabContent(
    userInfo: UserStatusInfo | null,
    configs: ModelConfig[],
): string {
    const parts: string[] = [];
    const sortedConfigs = userInfo ? sortModels(configs, userInfo.modelSortOrder) : configs;

    // 1. Default Model Card
    const defaultModelHtml = buildDefaultModelCard(userInfo);
    if (defaultModelHtml) {
        parts.push(defaultModelHtml);
    }

    // 2. Personal Model Quota Grid
    const quotaHtml = buildModelQuotaGrid(sortedConfigs);
    if (quotaHtml) {
        parts.push(quotaHtml);
    }

    // 3. Official Model Info Grid
    // 范围严格限定为 sortedConfigs 中展示在前台的界面模型
    const specs: ModelSpec[] = [];
    const allSpecs = getModelSpecs();
    const specMap = new Map<string, ModelSpec>();
    for (const spec of allSpecs) {
        specMap.set(spec.placeholderId, spec);
    }

    for (const config of sortedConfigs) {
        let spec = specMap.get(config.model);
        if (!spec) {
            // 动态利用 guess 机制为此新未知模型注册一个合理的 Spec，杜绝界面挂起，保障新模型智能自适应
            const guess = guessContextLimitSpec(config.model);
            updateModelSpec(config.model, {
                modelId: config.model,
                displayName: config.label,
                // Leave the provider EMPTY rather than inventing a placeholder value. getQuotaPoolKey()
                // uses the spec's apiProvider as its last-resort pooling signal, and a sentinel like
                // 'AUTO_DETECT' matches none of its provider tests — so filing one here would silently
                // send this model to the resetTime fallback and give it its own phantom quota pool.
                apiProvider: '',
                maxTokens: guess.maxTokens,
                cpLimit: guess.cpLimit,
                cpThreshold: guess.cpThreshold,
                supportsThinking: guess.supportsThinking,
            });
            // 重新在已完成动态注册的 Spec 列表中获取实例
            spec = getModelSpecs().find(x => x.placeholderId === config.model);
        }
        if (spec) {
            // displayName 采用前端 config 里的 label，保持与界面选项一致
            const specCopy = { ...spec, displayName: config.label };
            specs.push(specCopy);
        }
    }

    if (specs.length > 0) {
        parts.push(buildModelInfoGrid(specs));
    } else {
        const specIconSvg = `<svg class="act-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: text-bottom; margin-right: 6px;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
        parts.push(`
            <section class="card empty model-info-section">
                <h2 style="display: flex; align-items: center; margin-bottom: var(--space-3);">${specIconSvg} ${tBi('Model Info', '模型信息')}</h2>
                <p class="empty-desc" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                    ${tBi(
            'Model information is not available yet. Sign in to Antigravity, then refresh.',
            '暂无模型信息。请登录 Antigravity 后刷新。',
        )}
                </p>
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

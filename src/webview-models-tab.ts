// ─── Models Tab Content Builder ─────────────────────────────────────────────
// Centralizes model-related information: default model, personal model quota,
// and official model configurations and limit parameters without GM data contamination.

import { getLanguage, tBi } from './i18n';
import { ModelConfig, UserStatusInfo, getModelSpecs, ModelSpec, updateModelSpec, guessContextLimitSpec, getAvailableImageModelSpecs } from './models';
import { ICON } from './webview-icons';
import { buildDefaultModelCard, buildModelQuotaGrid, sortModels } from './webview-profile-tab';
import { esc } from './webview-helpers';

/** Use the selected UI locale, independent of the extension host's OS locale. */
function formatTokens(value: number): string {
    return Number.isSafeInteger(value) && value > 0
        ? value.toLocaleString(getLanguage() === 'zh' ? 'zh-CN' : 'en-US')
        : tBi('Not available', '暂无数据');
}

function thinkingDescription(spec: ModelSpec): string {
    if (spec.isImageGeneration && spec.thinkingCapabilityReported === false) {
        return tBi('Not reported by IDE', 'IDE 未上报');
    }
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

export function buildModelInfoGrid(specs: ModelSpec[], kind: 'chat' | 'image' = 'chat'): string {
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
                    <div class="spec-metric spec-limit" data-metric="compression-limit">
                        <dt>${tBi('Compression limit', '压缩上限')}</dt>
                        <dd>${s.isImageGeneration ? tBi('Not applicable', '不适用') : formatTokens(s.cpLimit)}</dd>
                    </div>
                    <div class="spec-metric" data-metric="checkpoint-threshold">
                        <dt>${tBi('Checkpoint threshold', '检查点阈值')}</dt>
                        <dd>${s.isImageGeneration ? tBi('Not applicable', '不适用') : formatTokens(s.cpThreshold)}</dd>
                    </div>
                    <div class="spec-metric" data-metric="native-context">
                        <dt>${tBi('Model context', '模型上下文')}</dt>
                        <dd>${formatTokens(s.maxTokens)}</dd>
                    </div>
                    <div class="spec-metric" data-metric="max-output">
                        <dt>${tBi('Max output', '最大输出')}</dt>
                        <dd>${formatTokens(s.maxOutputTokens)}</dd>
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
        <section class="card model-info-section" data-model-kind="${kind}">
            <h2>${specIconSvg} ${kind === 'image' ? tBi('Image generation models', '图片生成模型') : tBi('Model Info', '模型信息')}</h2>
            <p class="spec-description">${kind === 'image'
            ? tBi('Image-generation models available in your IDE. Reported context and output limits may differ from public API limits; chat compression settings do not apply.', 'IDE 中可用的图片生成模型。IDE 报告的上下文和输出上限可能与公开 API 不同；聊天上下文压缩设置不适用。')
            : tBi('Limits reported by your IDE may differ from public API limits. Compression limit and checkpoint threshold are separate platform settings.', '以下限额由 IDE 报告，可能与公开 API 限额不同。压缩上限与检查点阈值是不同的平台设置。')}</p>
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
        if (spec && !spec.isImageGeneration) {
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

    // Image generation has a separate authoritative catalog; accepting images
    // in a chat prompt does not identify an image-generation model.
    const imageSpecs = getAvailableImageModelSpecs();
    if (imageSpecs.length > 0) {
        parts.push(buildModelInfoGrid(imageSpecs, 'image'));
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

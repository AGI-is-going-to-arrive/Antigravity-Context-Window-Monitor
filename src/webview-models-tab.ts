// ─── Models Tab Content Builder ─────────────────────────────────────────────
// Centralizes model-related information: default model, personal model quota,
// and official model configurations and limit parameters without GM data contamination.

import { formatNumber, getLanguage } from './i18n';
import { ModelConfig, UserStatusInfo, getModelSpecs, ModelSpec, updateModelSpec, guessContextLimitSpec, getAvailableImageModelSpecs, localizeNeonPickerLabel } from './models';
import { ICON } from './webview-icons';
import { buildDefaultModelCard, buildModelQuotaGrid, sortModels } from './webview-profile-tab';
import { esc, tBiHtml } from './webview-helpers';

const SPEC_ICON_SVG = '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
const IMAGE_SPEC_ICON_SVG = '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';

/** Use the selected UI locale, independent of the extension host's OS locale. */
function formatTokensHtml(value: number): string {
    return Number.isSafeInteger(value) && value > 0
        ? esc(formatNumber(value))
        : tBiHtml('Not available', '暂无数据');
}

function thinkingDescriptionHtml(spec: ModelSpec): string {
    if (spec.isImageGeneration && spec.thinkingCapabilityReported === false) {
        return tBiHtml('Not reported by IDE', 'IDE 未上报');
    }
    if (!spec.supportsThinking) { return tBiHtml('Not supported', '不支持'); }
    if (spec.supportsAdaptiveThinking) { return tBiHtml('Adaptive', '自适应'); }
    if (spec.thinkingBudget === -1) { return tBiHtml('Dynamic', '动态'); }
    if (Number.isFinite(spec.thinkingBudget) && spec.thinkingBudget > 0) {
        return `${tBiHtml('Budget', '预算')}: ${formatTokensHtml(spec.thinkingBudget)}`;
    }
    // A zero/absent budget does not mean thinking is disabled. New adaptive
    // Claude models expose supportsThinking=true without a fixed token budget.
    return tBiHtml('Supported · Budget unspecified', '支持 · 预算未指定');
}

function providerLabelHtml(provider: string): string {
    const key = provider.replace(/^API_PROVIDER_/, '');
    const labels: Record<string, string> = {
        GOOGLE_GEMINI: 'Google Gemini',
        ANTHROPIC_VERTEX: 'Anthropic · Vertex',
        ANTHROPIC: 'Anthropic',
        OPENAI_VERTEX: 'OpenAI · Vertex',
        OPENAI: 'OpenAI',
    };
    const resolved = labels[key] || key.replace(/_/g, ' ');
    return resolved ? esc(resolved) : tBiHtml('Provider not available', '暂无提供商信息');
}

/** A configured route is a capability, not proof of per-request delegation. */
function orchestrationDescription(spec: ModelSpec): string {
    const target = spec.executionModelId;
    if (!target || !/^MODEL_[A-Z0-9_]+$/.test(target) || target.includes('UNSPECIFIED')
        || target === spec.placeholderId) { return ''; }
    const worker = getModelSpecs().find(candidate => candidate.placeholderId === target);
    return `<div class="spec-orchestration">
        <p><strong>${tBiHtml('Configured execution model', '配置的执行模型')}:</strong> ${esc(worker?.displayName || target)}</p>
        <p><code>${esc(worker?.modelId || target)}</code></p>
        ${worker ? `<p>${tBiHtml('Execution context & max output', '执行上下文与最大输出')}: ${formatTokensHtml(worker.maxTokens)} / ${formatTokensHtml(worker.maxOutputTokens)}</p>` : ''}
        <p>${tBiHtml('The coordinator may delegate work. Usage and costs follow the model reported for each call; this route alone does not imply an execution call.', '协调模型可能委派任务。用量和费用按每次调用实际报告的模型计算；配置此关系不代表已经发生执行调用。')}</p>
    </div>`;
}

export function buildModelInfoGrid(specs: ModelSpec[], kind: 'chat' | 'image' = 'chat'): string {
    const language = getLanguage();
    const cards = specs.map((s) => {
        const name = localizeNeonPickerLabel(s.placeholderId, s.displayName, language);
        const shortId = s.placeholderId.replace(/^MODEL_PLACEHOLDER_/, '');
        const extraId = s.placeholderId && s.placeholderId !== s.modelId
            ? `<code class="spec-short-id" title="${esc(s.placeholderId)}">${esc(shortId)}</code>` : '';
        return `
            <article class="spec-card" aria-label="${esc(name)}" data-model-id="${esc(s.placeholderId)}">
                <header class="spec-header">
                    <h3 class="spec-name">${esc(name)}</h3>
                    <p class="spec-provider" title="${esc(s.apiProvider)}">${providerLabelHtml(s.apiProvider)}</p>
                </header>
                <dl class="spec-metrics">
                    <div class="spec-metric spec-limit" data-metric="compression-limit">
                        <dt>${tBiHtml('Compression limit', '压缩上限')}</dt>
                        <dd>${s.isImageGeneration ? tBiHtml('Not applicable', '不适用') : formatTokensHtml(s.cpLimit)}</dd>
                    </div>
                    <div class="spec-metric" data-metric="checkpoint-threshold">
                        <dt>${tBiHtml('Checkpoint threshold', '检查点阈值')}</dt>
                        <dd>${s.isImageGeneration ? tBiHtml('Not applicable', '不适用') : formatTokensHtml(s.cpThreshold)}</dd>
                    </div>
                    <div class="spec-metric" data-metric="native-context">
                        <dt>${tBiHtml('Model context', '模型上下文')}</dt>
                        <dd>${formatTokensHtml(s.maxTokens)}</dd>
                    </div>
                    <div class="spec-metric" data-metric="max-output">
                        <dt>${tBiHtml('Max output', '最大输出')}</dt>
                        <dd>${formatTokensHtml(s.maxOutputTokens)}</dd>
                    </div>
                    <div class="spec-metric spec-thinking">
                        <dt>${tBiHtml('Thinking', '思考能力')}</dt>
                        <dd>${thinkingDescriptionHtml(s)}</dd>
                    </div>
                </dl>
                ${orchestrationDescription(s)}
                <div class="spec-identity">
                    <code class="spec-model-id" title="${esc(s.modelId)}">${esc(s.modelId)}</code>${extraId}
                </div>
            </article>`;
    }).join('');

    const icon = kind === 'image' ? IMAGE_SPEC_ICON_SVG : SPEC_ICON_SVG;
    const sectionClass = kind === 'image'
        ? 'card model-info-section model-info-image-section'
        : 'card model-info-section';

    return `
        <section class="${sectionClass}" data-model-kind="${kind}">
            <h2>${icon} <span>${kind === 'image' ? tBiHtml('Image generation models', '图片生成模型') : tBiHtml('Model Info', '模型信息')}</span></h2>
            <p class="spec-description">${kind === 'image'
            ? tBiHtml('Image-generation models available in your IDE. Reported context and output limits may differ from public API limits; chat compression settings do not apply.', 'IDE 中可用的图片生成模型。IDE 报告的上下文和输出上限可能与公开 API 不同；聊天上下文压缩设置不适用。')
            : tBiHtml('Limits reported by your IDE may differ from public API limits. Compression limit and checkpoint threshold are separate platform settings.', '以下限额由 IDE 报告，可能与公开 API 限额不同。压缩上限与检查点阈值是不同的平台设置。')}</p>
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
        parts.push(`
            <section class="card empty model-info-section">
                <h2>${SPEC_ICON_SVG} <span>${tBiHtml('Model Info', '模型信息')}</span></h2>
                <p class="empty-desc">
                    ${tBiHtml(
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
                <h2>${ICON.bolt} <span>${tBiHtml('Models', '模型')}</span></h2>
                <p class="empty-desc">${tBiHtml(
            'Waiting for model-related data from LS...',
            '等待 LS 返回模型相关数据...',
        )}</p>
            </section>`;
    }

    return parts.join('');
}

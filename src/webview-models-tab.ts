// ─── Models Tab Content Builder ─────────────────────────────────────────────
// Centralizes model-related information: default model, personal model quota,
// and official model configurations and limit parameters without GM data contamination.

import { tBi } from './i18n';
import { ModelConfig, UserStatusInfo, getModelSpecs, ModelSpec, updateModelSpec, guessContextLimitSpec } from './models';
import { ICON } from './webview-icons';
import { buildDefaultModelCard, buildModelQuotaGrid, sortModels } from './webview-profile-tab';
import { esc } from './webview-helpers';

/** Render a thinking-budget value. -1 is the platform sentinel for dynamic / model-decided. */
function formatThinkingBudget(budget: number | null | undefined): string {
    if (typeof budget !== 'number' || !Number.isFinite(budget)) {
        return tBi('Unspecified', '未指定');
    }
    if (budget === -1) {
        return tBi('Dynamic', '动态');
    }
    if (budget === 0) {
        return tBi('None', '无');
    }
    if (budget < 0) {
        return tBi('Unspecified', '未指定');
    }
    return budget.toLocaleString();
}

/** Dual declaration so color-mix can override a pre-Chrome-111-safe rgba fallback. */
function limitBadgeColorStyle(limitColor: string): string {
    const m = /^#([0-9a-f]{6})$/i.exec(limitColor.trim());
    const rgb = m
        ? `${parseInt(m[1].slice(0, 2), 16)}, ${parseInt(m[1].slice(2, 4), 16)}, ${parseInt(m[1].slice(4, 6), 16)}`
        : null;
    const fallbackBg = rgb ? `rgba(${rgb}, 0.08)` : 'rgba(22, 26, 38, 0.45)';
    const fallbackBorder = rgb ? `rgba(${rgb}, 0.5)` : limitColor;
    const fallbackGlow = rgb ? `rgba(${rgb}, 0.3)` : 'transparent';
    return [
        `background: ${fallbackBg}`,
        `background: color-mix(in srgb, ${limitColor} 8%, rgba(22, 26, 38, 0.45))`,
        `color: ${limitColor}`,
        `border: 1px solid ${fallbackBorder}`,
        `border-color: color-mix(in srgb, ${limitColor} 50%, transparent)`,
        `box-shadow: 0 0 12px ${fallbackGlow}`,
        `box-shadow: 0 0 12px color-mix(in srgb, ${limitColor} 30%, transparent)`,
        `text-shadow: 0 0 8px ${fallbackGlow}`,
    ].join('; ');
}

export function buildModelInfoGrid(specs: ModelSpec[]): string {
    const cards = specs.map((s) => {
        const providerText = esc(s.apiProvider.replace(/_/g, ' '));
        const thinkingText = !s.supportsThinking
            ? tBi('Not Supported', '不支持')
            : s.thinkingBudget === -1
                ? tBi('Dynamic', '动态')
                : `${tBi('Enabled', '已启用')} (${tBi('Budget', '预算')}: ${formatThinkingBudget(s.thinkingBudget)})`;

        let limitColor = '#10b981'; // 256K Green
        if (s.cpLimit <= 80000) limitColor = '#a855f7'; // 80K Purple
        else if (s.cpLimit <= 128000) limitColor = '#3b82f6'; // 128K Blue
        else if (s.cpLimit <= 160000) limitColor = '#06b6d4'; // 160K Cyan

        const cpuSvg = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;margin-right:4px;flex-shrink:0;"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3"/></svg>`;
        const brainSvg = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;margin-right:4px;flex-shrink:0;"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-3.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2zM14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-3.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2z"/></svg>`;
        const providerSvg = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;margin-right:4px;flex-shrink:0;"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;

        // 使用完整数字格式化，不采用 K/M 估算值
        const limitText = s.cpLimit > 0
            ? `${s.cpLimit.toLocaleString()} ${tBi('Limit', '压缩阈值')}`
            : tBi('Loading Limit...', '正在计算阈值...');

        const maxTokensText = s.maxTokens > 0
            ? s.maxTokens.toLocaleString()
            : '-';

        return `
            <div class="model-card spec-card" style="border-left: 3px solid ${limitColor}; padding: var(--space-3); margin-bottom: var(--space-2); position: relative; min-width: 0;">
                
                <div class="model-card-header" style="margin-bottom: var(--space-2); display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); min-width: 0;">
                    <div style="min-width: 0; flex: 1; overflow: hidden;">
                        <strong class="model-card-name" title="${esc(s.displayName)}" style="font-size: 0.95rem; color: var(--color-text); display: block; line-height: 1.3; overflow-wrap: anywhere; word-break: break-word;">
                            ${esc(s.displayName)}
                        </strong>
                        <span style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--color-text-dim); opacity: 0.8; display: block; margin-top: 2px; overflow-wrap: anywhere; word-break: break-word;">
                            ${esc(s.modelId)} <span style="font-size: 0.7rem; opacity: 0.5;">(${esc(s.placeholderId.replace('MODEL_PLACEHOLDER_', ''))})</span>
                        </span>
                    </div>
                    <span class="model-tag-badge" title="${esc(limitText)}" style="${limitBadgeColorStyle(limitColor)}; padding: 3px 8px; font-size: 0.72rem; border-radius: var(--radius-sm); font-weight: 600; white-space: nowrap; flex-shrink: 0; max-width: none; overflow: visible; transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;">
                        ${limitText}
                    </span>
                </div>

                <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--space-2); font-size: 0.8rem; margin-top: var(--space-3); border-top: 1px dashed var(--color-border); padding-top: var(--space-2);">
                    <div style="display: flex; align-items: center; color: var(--color-text-dim); min-width: 0;">
                        ${providerSvg}
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;" title="${providerText}">
                            ${providerText}
                        </span>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 2px 4px; color: var(--color-text-dim); min-width: 0;">
                        ${cpuSvg}
                        <span style="font-weight: 500; color: var(--color-text);">
                            ${maxTokensText}
                        </span>
                        <span style="font-size: 0.72rem; opacity: 0.5;">${tBi('max tokens', '最大上下文')}</span>
                    </div>
                    <div style="display: flex; align-items: flex-start; color: var(--color-text-dim); grid-column: span 2; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 2px; min-width: 0;">
                        ${brainSvg}
                        <span style="font-size: 0.75rem; min-width: 0; overflow-wrap: anywhere; word-break: break-word;" title="${esc(tBi('Thinking', '思考能力') + ': ' + thinkingText)}">
                            ${tBi('Thinking', '思考能力')}: <strong style="color: var(--color-text); font-weight: 600;">${thinkingText}</strong>
                        </span>
                    </div>
                </div>
            </div>`;
    }).join('');

    const specIconSvg = `<svg class="act-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: text-bottom; margin-right: 6px;"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;

    return `
        <section class="card">
            <h2 style="display: flex; align-items: center; margin-bottom: var(--space-3);">${specIconSvg} ${tBi('Model Info', '模型信息')}</h2>
            <div class="model-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); gap: var(--space-3); margin-top: var(--space-2);">
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
            <section class="card empty">
                <h2 style="display: flex; align-items: center; margin-bottom: var(--space-3);">${specIconSvg} ${tBi('Model Info', '模型信息')}</h2>
                <p class="empty-desc" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1.5s linear infinite;"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                    ${tBi(
            'Dynamically capturing genuine model parameters from LS...',
            '正在从 LS 动态捕获最真实的核心模型信息...',
        )}
                </p>
                <style>
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
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

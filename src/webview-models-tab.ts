// ─── Models Tab Content Builder ─────────────────────────────────────────────
// Centralizes model-related information: default model, personal model quota,
// and official, pure-physical model parameters without GM data contamination.

import { tBi } from './i18n';
import { ModelConfig, UserStatusInfo, getModelSpecs, ModelSpec } from './models';
import { ICON } from './webview-icons';
import { buildDefaultModelCard, buildModelQuotaGrid, sortModels } from './webview-profile-tab';

export function buildModelInfoGrid(specs: ModelSpec[]): string {
    const cards = specs.map((s) => {
        const providerText = s.apiProvider.replace(/_/g, ' ');
        const thinkingText = s.supportsThinking
            ? `${tBi('Enabled', '已启用')} (${tBi('Budget', '预算')}: ${s.thinkingBudget.toLocaleString()})`
            : tBi('Not Supported', '不支持');
        
        let limitColor = '#10b981'; // 256K Green
        if (s.cpLimit <= 80000) limitColor = '#a855f7'; // 80K Purple
        else if (s.cpLimit <= 128000) limitColor = '#3b82f6'; // 128K Blue
        else if (s.cpLimit <= 160000) limitColor = '#06b6d4'; // 160K Cyan

        const cpuSvg = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;margin-right:4px;"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3"/></svg>`;
        const brainSvg = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;margin-right:4px;"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1 0-3.12 3 3 0 0 1 0-3.88 2.5 2.5 0 0 1 0-3.12A2.5 2.5 0 0 1 9.5 2zM14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 0-3.12 3 3 0 0 0 0-3.88 2.5 2.5 0 0 0 0-3.12A2.5 2.5 0 0 0 14.5 2z"/></svg>`;
        const providerSvg = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;margin-right:4px;"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;

        // 绝对精准格式化的参数数值，禁用模糊的 K/M 估算展示
        const limitText = s.cpLimit > 0
            ? `${s.cpLimit.toLocaleString()} Limit`
            : tBi('Loading Limit...', '正在获取限额...');

        const maxTokensText = s.maxTokens > 0
            ? s.maxTokens.toLocaleString()
            : '-';

        return `
            <div class="model-card spec-card" style="border-left: 3px solid ${limitColor}; padding: var(--space-3); margin-bottom: var(--space-2); position: relative; overflow: hidden;">
                <div style="position: absolute; right: -20px; top: -20px; width: 80px; height: 80px; border-radius: 9999px; background: color-mix(in srgb, ${limitColor} 6%, transparent); filter: blur(20px); pointer-events: none;"></div>
                
                <div class="model-card-header" style="margin-bottom: var(--space-2); display: flex; align-items: flex-start; justify-content: space-between;">
                    <div>
                        <strong class="model-card-name" style="font-size: 0.95rem; color: var(--color-text); display: block; line-height: 1.2;">
                            ${s.displayName}
                        </strong>
                        <span style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--color-text-dim); opacity: 0.8; display: block; margin-top: 2px;">
                            ${s.modelId} <span style="font-size: 0.7rem; opacity: 0.5;">(${s.placeholderId.replace('MODEL_PLACEHOLDER_', '')})</span>
                        </span>
                    </div>
                    <span class="model-tag-badge" style="background: color-mix(in srgb, ${limitColor} 12%, transparent); color: ${limitColor}; border: 1px solid color-mix(in srgb, ${limitColor} 25%, transparent); padding: 2px 6px; font-size: 0.72rem; border-radius: var(--radius-sm); font-weight: 600; white-space: nowrap; margin-left: var(--space-2);">
                        ${limitText}
                    </span>
                </div>

                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); font-size: 0.8rem; margin-top: var(--space-3); border-top: 1px dashed var(--color-border); padding-top: var(--space-2);">
                    <div style="display: flex; align-items: center; color: var(--color-text-dim);">
                        ${providerSvg}
                        <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px;" title="${providerText}">
                            ${providerText}
                        </span>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: flex-end; color: var(--color-text-dim);">
                        ${cpuSvg}
                        <span style="font-weight: 500; color: var(--color-text);">
                            ${maxTokensText}
                        </span>
                        <span style="font-size: 0.72rem; opacity: 0.5; margin-left: 4px;">max tokens</span>
                    </div>
                    <div style="display: flex; align-items: center; color: var(--color-text-dim); grid-column: span 2; border-top: 1px solid rgba(255,255,255,0.03); padding-top: 2px;">
                        ${brainSvg}
                        <span style="font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${thinkingText}">
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
            <div class="model-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-3); margin-top: var(--space-2);">
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

    // 3. Pure Official Physical Model Info Grid
    // 范围严格限定为 sortedConfigs 中展示在前台的界面模型
    const specs: ModelSpec[] = [];
    const allSpecs = getModelSpecs();
    const specMap = new Map<string, ModelSpec>();
    for (const spec of allSpecs) {
        specMap.set(spec.placeholderId, spec);
    }

    for (const config of sortedConfigs) {
        const spec = specMap.get(config.model);
        if (spec) {
            // displayName 严格采用前端 config 里的 label，保证完美契合界面选项
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

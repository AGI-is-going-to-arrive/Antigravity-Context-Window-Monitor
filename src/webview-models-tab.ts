// ─── Models Tab Content Builder ─────────────────────────────────────────────
// Centralizes model-related information: default model, personal model quota,
// and official model configurations and limit parameters without GM data contamination.

import { formatNumber, getLanguage, tBi, tHtml } from './i18n-core';
import {
    DEFAULT_CONTEXT_LIMITS,
    ModelConfig,
    UserStatusInfo,
    getModelSpecs,
    ModelSpec,
    getAvailableImageModelSpecs,
    getQuotaPoolKey,
    localizePickerEffortLabel,
    type OrchestratorSettings,
    type UserQuotaSummary,
} from './models';
import {
    resolvePricingDetail,
    formatUsdPerMillion,
    type ModelPricing,
    type OrchestratorPricingMode,
} from './pricing-store';
import type {
    QuotaDirectionMode,
    QuotaRunwayEstimate,
    QuotaWindowMode,
    WeeklyQuotaRunwayEstimate,
} from './quota-runway';
import { ICON } from './webview-icons';
import {
    buildCustomModelBannerHtml,
    buildStaleBannerHtml,
    formatRunwayBadgeHtml,
    type MonitorStaleState,
} from './webview-overview-tab';
import { buildDefaultModelCard, buildModelQuotaGrid, sortModels } from './webview-profile-tab';
import { esc, richTipBiAttrs as richTipAttrs, slugKey, tBiHtml } from './webview-helpers';

export interface ModelsTabOptions {
    orchestratorSettings?: OrchestratorSettings | null;
    quotaSummary?: UserQuotaSummary | null;
    customPricing?: Record<string, ModelPricing>;
    orchestratorPricingMode?: OrchestratorPricingMode;
    quotaRunways?: Record<string, QuotaRunwayEstimate>;
    /** Optional Weekly Active-Hours Quota Pace Forecast estimates keyed by pool (or array). */
    weeklyRunways?: Record<string, WeeklyQuotaRunwayEstimate> | readonly WeeklyQuotaRunwayEstimate[];
    /** Active quota horizon window mode (`'5h' | '7d' | 'tightest'`). */
    quotaWindowMode?: QuotaWindowMode;
    /** Active quota display direction (`'remaining' | 'used'`). */
    quotaDirectionMode?: QuotaDirectionMode;
    /** Explicit zero-day unseen model IDs to tag with the adaptive badge (auto-detected when omitted). */
    zeroDayModelIds?: readonly string[] | ReadonlySet<string>;
    isCustomModelActive?: boolean;
    staleState?: MonitorStaleState | null;
}

const ORCH_ICON_SVG = '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8.5 7.5 11 15.5"/><path d="M15.5 7.5 13 15.5"/></svg>';

const SPEC_ICON_SVG = '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
const IMAGE_SPEC_ICON_SVG = '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';

/** Use the selected UI locale, independent of the extension host's OS locale. */
function formatTokensHtml(value: number): string {
    return Number.isSafeInteger(value) && value > 0
        ? esc(formatNumber(value))
        : tBiHtml('Not available', '暂无数据');
}

function thinkingDescriptionHtml(spec: ModelSpec): string {
    if (spec.thinkingCapabilityReported === false) {
        return tBiHtml('Not reported by host', '宿主未上报');
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

function thinkingRichTipAttrs(key: string, spec: ModelSpec): string {
    if (spec.thinkingCapabilityReported === false) {
        return richTipAttrs(
            key,
            'Thinking Capability',
            '思考能力',
            'The host has not reported reasoning capabilities for this model.',
            '宿主尚未提供该模型的思考能力信息。',
        );
    }
    if (!spec.supportsThinking) {
        return richTipAttrs(
            key,
            'Thinking: Not Supported',
            '思考能力：不支持',
            'This model generates direct answers without a separate internal reasoning trace.',
            '该模型直接生成回答，不包含独立的内部思考过程。',
            'Catalog flag: supportsThinking = false.',
            '目录标记：不支持扩展思考。',
        );
    }
    if (spec.supportsAdaptiveThinking) {
        return richTipAttrs(
            key,
            'Adaptive Thinking',
            '自适应思考',
            'The model automatically scales its internal reasoning depth based on task difficulty.',
            '模型会根据任务复杂度自动调节内部思考深度，无需固定 token 预算。',
            'Mode: Adaptive · Higher effort tiers allow deeper reasoning.',
            '模式：自适应 · 更高推理档位允许更深入的思考。',
        );
    }
    if (spec.thinkingBudget === -1) {
        return richTipAttrs(
            key,
            'Dynamic Thinking',
            '动态思考',
            'The backend allocates thinking tokens dynamically per turn instead of enforcing a fixed cap.',
            '后端会按单轮任务复杂度动态分配思考 token，而不设固定上限。',
            'Mode: Dynamic (thinkingBudget = -1).',
            '模式：动态分配（thinkingBudget = -1）。',
        );
    }
    if (Number.isFinite(spec.thinkingBudget) && spec.thinkingBudget > 0) {
        const formatted = formatNumber(spec.thinkingBudget);
        return richTipAttrs(
            key,
            'Fixed Thinking Budget',
            '固定思考预算',
            `The model can spend up to ${formatted} internal reasoning tokens before writing the final answer.`,
            `模型在输出正文前最多可使用 ${formatted} 个内部思考 token。`,
            'Mode: Budget · Thinking tokens count inside Max Output.',
            '模式：固定预算 · 思考 token 计入最大输出上限内。',
        );
    }
    return richTipAttrs(
        key,
        'Thinking Supported',
        '支持思考能力',
        'Extended reasoning is supported, though the host catalog did not publish a fixed token cap.',
        '该模型支持扩展思考，但宿主目录未公布固定的 token 预算上限。',
        'Mode: Supported · Budget managed by server or effort tier.',
        '模式：支持 · 预算由服务端或所选档位管理。',
    );
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

function providerRichTipAttrs(key: string, provider: string): string {
    const normalized = provider.replace(/^API_PROVIDER_/, '');
    const descMap: Record<string, readonly [string, string]> = {
        GOOGLE_GEMINI: [
            'Served directly by Google Gemini infrastructure and billed against the Gemini shared quota pool.',
            '由 Google Gemini 平台直接提供服务，消耗 Gemini 共享配额池。',
        ],
        ANTHROPIC_VERTEX: [
            'Anthropic Claude model hosted through Google Cloud Vertex AI, drawing from the Claude / GPT quota pool.',
            '通过 Google Cloud Vertex AI 托管的 Anthropic Claude 模型，消耗 Claude / GPT 共享配额池。',
        ],
        ANTHROPIC: [
            'Anthropic Claude model served via Anthropic API routing.',
            '通过 Anthropic 接口路由提供的 Claude 模型。',
        ],
        OPENAI_VERTEX: [
            'OpenAI model hosted via Vertex AI integration, drawing from the Claude / GPT quota pool.',
            '通过 Vertex AI 接入的 OpenAI 模型，消耗 Claude / GPT 共享配额池。',
        ],
        OPENAI: [
            'OpenAI model served via OpenAI API routing.',
            '通过 OpenAI 接口路由提供的模型。',
        ],
    };
    const desc = Object.hasOwn(descMap, normalized) ? descMap[normalized] : undefined;
    if (!provider.trim()) {
        return richTipAttrs(
            key,
            'Model Provider',
            '模型提供商',
            'The local service did not report a provider identifier for this catalog entry.',
            '本地服务未上报此模型目录项的提供商标识。',
        );
    }
    return richTipAttrs(
        key,
        'Model Provider',
        '模型提供商',
        desc ? desc[0] : `Model backend provider reported by the host (${normalized.replace(/_/g, ' ')}).`,
        desc ? desc[1] : `宿主上报的模型后端提供商（${normalized.replace(/_/g, ' ')}）。`,
        `Catalog enum: ${provider}`,
        `目录枚举：${provider}`,
    );
}

/** A configured route is a capability, not proof of per-request delegation. */
function orchestrationDescription(spec: ModelSpec, cardKey: string): string {
    const target = spec.executionModelId;
    if (!target || !/^MODEL_[A-Z0-9_]+$/.test(target) || target.includes('UNSPECIFIED')
        || target === spec.placeholderId) { return ''; }
    const worker = getModelSpecs().find(candidate => candidate.placeholderId === target);
    const routeTip = richTipAttrs(
        `models-spec-execroute-${cardKey}`,
        'Configured Execution Model',
        '配置的执行模型',
        'Fixed worker model paired with this coordinator on the server to handle concrete tool and coding steps.',
        '服务端为该编排模型预设的固定执行模型，负责具体代码编辑与工具执行步骤。',
        'Capability only — actual usage & cost follow whichever model is reported per call.',
        '仅为路由能力说明；实际用量与费用按每次调用真实上报的模型统计。',
    );
    return `<div class="spec-orchestration"${routeTip}>
        <p><strong>${tBiHtml('Configured execution model', '配置的执行模型')}:</strong> ${esc(worker?.displayName || target)}</p>
        <p><code>${esc(worker?.modelId || target)}</code></p>
        ${worker ? `<p>${tBiHtml('Execution context & max output', '执行上下文与最大输出')}: ${formatTokensHtml(worker.maxTokens)} / ${formatTokensHtml(worker.maxOutputTokens)}</p>` : ''}
        <p>${tBiHtml('Server-managed fixed coordinator route. Usage and costs follow the actual model reported per call; Custom Orchestrator Mode pairs eligible models dynamically via Orchestrator Settings.', '服务端管理的固定协调器路由。用量和费用按每次调用实际报告的模型计算；自定义编排模式则通过编排设置动态组合可选模型。')}</p>
    </div>`;
}

function formatRoleFamilyName(stem: string): string {
    const known: Record<string, string> = {
        'gemini-4-neon': 'Gemini 4 Neon',
        'gemini-4-carbon': 'Gemini 4 Carbon',
        'gemini-4-argon': 'Gemini 4 Argon',
        'gemini-4-hydrogen': 'Gemini 4 Hydrogen',
        'gemini-3.8-flash': 'Gemini 3.8 Flash',
        'claude-opus-5-5': 'Claude Opus 5.5',
        'claude-sonnet-5-5': 'Claude Sonnet 5.5',
    };
    const key = stem.trim().toLowerCase();
    if (Object.hasOwn(known, key)) { return known[key]; }
    return key
        .replace(/-(\d+)-(\d+)$/, ' $1.$2')
        .split(/[-_]+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function poolChipHtml(modelId: string, keyPrefix: string): string {
    const pool = getQuotaPoolKey(modelId);
    if (pool === 'gemini') {
        const tip = richTipAttrs(
            `${keyPrefix}-pool-gemini`,
            'Gemini Shared Quota Pool',
            'Gemini 共享配额池',
            'All Gemini chat models and effort tiers draw from this shared 5-hour and weekly quota pool.',
            '所有 Gemini 对话模型与不同推理档位共用此 5 小时与每周共享配额池。',
            'Separate from the Claude / GPT pool.',
            '与 Claude / GPT 配额池相互独立。',
        );
        return `<span class="orch-pool-chip"${tip}>Gemini</span>`;
    }
    if (pool === 'premium') {
        const tip = richTipAttrs(
            `${keyPrefix}-pool-premium`,
            'Claude / GPT Shared Quota Pool',
            'Claude / GPT 共享配额池',
            'Claude and GPT models share this separate 5-hour and weekly quota pool.',
            'Claude 与 GPT 系列模型共用此独立的 5 小时与每周配额池。',
            'Cross-pool routing splits usage across Gemini and Claude / GPT pools.',
            '跨池编排时，规划与执行调用会分别消耗各自所属配额池。',
        );
        return `<span class="orch-pool-chip"${tip}>Claude / GPT</span>`;
    }
    return '';
}

function buildPricingProvenanceTipAttrs(
    key: string,
    provenance: 'official' | 'mapped_base' | 'custom' | 'unpriced',
    mappedBaseLabel?: string,
): string {
    if (provenance === 'mapped_base') {
        const baseTextEn = mappedBaseLabel ? ` (${mappedBaseLabel})` : '';
        const baseTextZh = mappedBaseLabel ? `（${mappedBaseLabel}）` : '';
        return richTipAttrs(
            key,
            'Est. via Base Model',
            '按底座估算',
            `Fixed Orchestrator model has no standalone public API list price; estimated using its underlying base model rate${baseTextEn}.`,
            `固定编排模型无独立公开 API 标价，当前按对应底座模型${baseTextZh}的官方单价估算。`,
            'Switch to Strict mode in Settings to mark mapped models Unpriced until custom rates are set.',
            '可在「设置」切换为「严格模式」，在填写自定义单价前将其标记为未定价。',
        );
    }
    if (provenance === 'custom') {
        return richTipAttrs(
            key,
            'Custom Rate',
            '自定义单价',
            'Uses the custom per-1M token rate you saved in the Usage & Cost tab instead of built-in reference rates.',
            '当前采用你在「用量与费用」页自定义的每百万 Token 单价，覆盖内置参考价。',
            'Reference estimate only — does not affect Antigravity subscription billing.',
            '仅用于费用参考估算，不影响 Antigravity 实际订阅账单。',
        );
    }
    return richTipAttrs(
        key,
        'Unpriced Model',
        '未定价模型',
        'No public per-1M token rate is available (or Strict mode hides mapped-base estimates), so USD cost is omitted.',
        '暂无公开 API 参考单价（或已开启严格模式隐藏按底座估算），暂不计入参考费用。',
        'You can enter a custom rate in the Usage & Cost tab at any time.',
        '你可随时在「用量与费用」页为此模型设置自定义单价。',
    );
}

function buildRoleEffectiveRatesHtml(
    modelId: string,
    roleKey: string,
    customPricing?: Record<string, ModelPricing>,
    orchestratorPricingMode?: OrchestratorPricingMode,
): string {
    if (!modelId) { return ''; }
    const detail = resolvePricingDetail(modelId, customPricing || {}, { orchestratorPricingMode });
    if (!detail.pricing) {
        const tip = buildPricingProvenanceTipAttrs(`models-orch-price-${roleKey}`, 'unpriced');
        return `<div class="orch-role-rates" data-price-state="unpriced"><span class="spec-price-badge is-unpriced"${tip}>${tBiHtml('Unpriced', '未定价')}</span></div>`;
    }
    const items: string[] = [
        `${tBiHtml('In', '输入')} ${esc(formatUsdPerMillion(detail.pricing.input))}`,
        `${tBiHtml('Out', '输出')} ${esc(formatUsdPerMillion(detail.pricing.output))}`,
    ];
    if (detail.pricing.cacheRead > 0) {
        items.push(`${tBiHtml('Cache', '缓存')} ${esc(formatUsdPerMillion(detail.pricing.cacheRead))}`);
    }
    if (detail.pricing.thinking > 0 && detail.pricing.thinking !== detail.pricing.output) {
        items.push(`${tBiHtml('Think', '思考')} ${esc(formatUsdPerMillion(detail.pricing.thinking))}`);
    }
    const ratesTip = richTipAttrs(
        `models-orch-rates-${roleKey}`,
        'API Reference Rates',
        'API 参考单价',
        'Public per-1M token list rates used to estimate equivalent API cost — not your actual subscription charge.',
        '按公开每百万 Token 标价计算的参考单价，用于衡量用量价值，并非实际订阅扣费。',
        'In = fresh input · Out = output · Cache = prompt cache read (USD per 1M tokens).',
        '输入 = 新输入 · 输出 = 生成输出 · 缓存 = 提示词缓存读取（USD / 1M tokens）。',
    );
    const provTag = detail.provenance === 'mapped_base'
        ? ` <span class="orch-role-status" data-pricing-provenance="mapped_base"${buildPricingProvenanceTipAttrs(`models-orch-prov-${roleKey}`, 'mapped_base', detail.mappedBaseLabel)}>${tBiHtml('Est. via Base Model', '按底座估算')}</span>`
        : detail.provenance === 'custom'
            ? ` <span class="orch-role-status is-custom" data-pricing-provenance="custom"${buildPricingProvenanceTipAttrs(`models-orch-prov-${roleKey}`, 'custom')}>${tBiHtml('Custom', '自定义')}</span>`
            : '';
    return `<div class="orch-role-rates" data-price-state="${detail.provenance === 'mapped_base' ? 'mapped' : 'priced'}"><span class="spec-price-values"${ratesTip}>${items.join(' · ')}</span>${provTag}</div>`;
}

export function buildOrchestratorSettingsCard(
    settings: OrchestratorSettings | null | undefined,
    options?: Pick<ModelsTabOptions, 'customPricing' | 'orchestratorPricingMode'>,
): string {
    if (!settings) { return ''; }
    const language = getLanguage();
    const orchLabel = localizePickerEffortLabel(
        settings.effectiveOrchestratorModel,
        settings.effectiveOrchestratorLabel || settings.effectiveOrchestratorModel,
        language,
    );
    const execLabel = localizePickerEffortLabel(
        settings.effectiveExecutorModel,
        settings.effectiveExecutorLabel || settings.effectiveExecutorModel,
        language,
    );
    const modeBadge = settings.mode === 'custom'
        ? `<span class="orch-mode-pill is-custom"${richTipAttrs(
            'models-orch-mode',
            'Custom Orchestrator Mode',
            '自定义编排模式',
            'You pinned a custom Orchestrator or Executor model instead of using the automatic platform default.',
            '你手动指定了编排模型或执行模型，而非使用平台自动默认组合。',
            'Each role draws from its own model quota pool.',
            '两个角色各自消耗所属模型的配额池。',
        )}>${tBiHtml('Custom', '自定义')}</span>`
        : `<span class="orch-mode-pill is-default"${richTipAttrs(
            'models-orch-mode',
            'Default Orchestrator Mode',
            '默认编排模式',
            'Antigravity automatically pairs the highest-effort default models for planning and execution.',
            'Antigravity 自动选用默认模型系列的最高推理档位进行规划与执行。',
            'Configure custom pairing inside Antigravity Orchestrator Settings.',
            '可在 Antigravity 编排设置中切换为自定义组合。',
        )}>${tBiHtml('Default', '默认')}</span>`;
    const roleStatus = (roleKey: string, isCustom: boolean) => isCustom
        ? `<span class="orch-role-status is-custom"${richTipAttrs(
            `models-orch-status-${roleKey}`,
            'Pinned Role Model',
            '已指定模型',
            'Explicitly pinned in your Orchestrator Settings instead of following the automatic default.',
            '你在编排设置中手动固定了该角色的模型，不会随默认档位自动切换。',
            'Source: explicit user override.',
            '触发条件：用户自定义配置。',
        )}>${tBiHtml('Pinned', '已指定')}</span>`
        : `<span class="orch-role-status"${richTipAttrs(
            `models-orch-status-${roleKey}`,
            'Auto Default',
            '默认最高档',
            'Automatically selects the highest available reasoning effort tier of the default model family.',
            '自动选用默认模型系列中可用的最高推理档位。',
            'Rule: active when no custom model is pinned for this role.',
            '触发条件：该角色未手动指定自定义模型。',
        )}>${tBiHtml('Auto default', '默认最高档')}</span>`;
    const orchFamilies = settings.roles.orchestrators.map(formatRoleFamilyName);
    const execFamilies = settings.roles.executors.map(formatRoleFamilyName);
    const shortId = (roleKey: string, id: string) => id
        ? `<code class="spec-short-id"${richTipAttrs(
            `models-orch-shortid-${roleKey}`,
            'Internal Model ID',
            '模型内部 ID',
            `Full catalog placeholder ID: ${id}`,
            `完整目录内部占位 ID：${id}`,
            'Used internally by Antigravity to route requests and match pricing.',
            'Antigravity 内部用于路由请求与匹配价格的稳定标识。',
        )}>${esc(id.replace(/^MODEL_PLACEHOLDER_/, ''))}</code>` : '';
    const sourceBadge = settings.settingsSource === 'config_fallback'
        ? `<span class="orch-role-status" data-settings-source="config_fallback"${richTipAttrs(
            'models-orch-source',
            'Local Config Fallback',
            '本地配置兜底',
            'Loaded from ~/.gemini/config/config.json because live orchestrator settings were not yet returned by the local service.',
            '因本地服务暂未返回实时编排配置，当前回退读取自 ~/.gemini/config/config.json。',
            'Updates automatically once live settings sync.',
            '实时配置同步后会自动更新。',
        )}>${tBiHtml('Local config', '本地配置')}</span>`
        : '';
    const creditsMeta = typeof settings.useAiCredits === 'boolean'
        ? `<div class="orch-family-row"${richTipAttrs(
            'models-orch-ai-credits',
            'AI Credit Overages',
            'AI 积分超额',
            'When enabled, Antigravity can spend your Account AI Credits to keep running after a shared quota pool reaches 0%.',
            '开启后，当共享配额池耗尽（0%）时，Antigravity 可继续消耗账号 AI 积分以维持运行。',
            settings.useAiCredits
                ? 'Current state: Enabled · Check balance in the Profile tab.'
                : 'Current state: Disabled · Calls pause until quota resets.',
            settings.useAiCredits
                ? '当前状态：已开启 · 可在「账号」页查看积分余额。'
                : '当前状态：已关闭 · 配额耗尽后会等待重置。',
        )}><dt>${tBiHtml('AI Credit Overages', 'AI 积分超额')}</dt><dd>${settings.useAiCredits ? tBiHtml('Enabled', '已开启') : tBiHtml('Disabled', '已关闭')}</dd></div>`
        : '';
    const orchRoleTip = richTipAttrs(
        'models-orch-role-orchestrator',
        'Orchestrator Model (Planner)',
        '编排模型（规划）',
        'High-level planner model that decomposes tasks, decides strategy, and coordinates tool/subagent steps.',
        '负责拆解任务、制定策略并统筹调度工具与子步骤的高层规划模型。',
        'Consumes its own quota pool and is metered per actual model reported on each call.',
        '消耗自身所属配额池，并按每次调用实际报告的模型独立计量。',
    );
    const execRoleTip = richTipAttrs(
        'models-orch-role-executor',
        'Executor Model (Worker)',
        '执行模型（执行）',
        'Worker model delegated by the Orchestrator to perform routine edits, searches, and concrete execution steps.',
        '由编排模型委派执行具体代码修改、检索与常规操作步骤的工作模型。',
        'Can use a different quota pool from the Orchestrator (cross-pool routing).',
        '可与编排模型分属不同配额池（跨池路由），分别独立计量。',
    );

    return `
        <section class="card orch-settings-card" data-orchestrator-mode="${settings.mode}">
            <div class="orch-settings-header">
                <h2>${ORCH_ICON_SVG} <span>${tBiHtml('Orchestrator Settings', '编排设置')}</span></h2>
                ${sourceBadge}
                ${modeBadge}
            </div>
            <div class="orch-role-list">
                <div class="orch-role-row" data-orch-role="orchestrator">
                    <div class="orch-role-meta">
                        <span class="orch-role-title"${orchRoleTip}>${tBiHtml('Orchestrator Model', '编排模型')}</span>
                        ${roleStatus('orchestrator', settings.isCustomOrchestrator)}
                    </div>
                    <div class="orch-role-value">
                        <strong>${esc(orchLabel || '—')}</strong>
                        ${shortId('orchestrator', settings.effectiveOrchestratorModel)}
                        ${poolChipHtml(settings.effectiveOrchestratorModel, 'models-orch-planner')}
                    </div>
                    ${buildRoleEffectiveRatesHtml(settings.effectiveOrchestratorModel, 'orchestrator', options?.customPricing, options?.orchestratorPricingMode)}
                </div>
                <div class="orch-role-row" data-orch-role="executor">
                    <div class="orch-role-meta">
                        <span class="orch-role-title"${execRoleTip}>${tBiHtml('Executor Model', '执行模型')}</span>
                        ${roleStatus('executor', settings.isCustomExecutor)}
                    </div>
                    <div class="orch-role-value">
                        <strong>${esc(execLabel || '—')}</strong>
                        ${shortId('executor', settings.effectiveExecutorModel)}
                        ${poolChipHtml(settings.effectiveExecutorModel, 'models-orch-worker')}
                    </div>
                    ${buildRoleEffectiveRatesHtml(settings.effectiveExecutorModel, 'executor', options?.customPricing, options?.orchestratorPricingMode)}
                </div>
            </div>
            ${(orchFamilies.length > 0 || execFamilies.length > 0 || creditsMeta) ? `
            <dl class="orch-families-grid">
                ${orchFamilies.length > 0 ? `<div class="orch-family-row"><dt>${tBiHtml('Orchestrator families', '可用编排系列')}</dt><dd>${esc(orchFamilies.join(' · '))}</dd></div>` : ''}
                ${execFamilies.length > 0 ? `<div class="orch-family-row"><dt>${tBiHtml('Executor families', '可用执行系列')}</dt><dd>${esc(execFamilies.join(' · '))}</dd></div>` : ''}
                ${creditsMeta}
            </dl>` : ''}
            <p class="orch-settings-note">${tBiHtml(
        'Orchestrator and Executor calls each draw from their own model\'s quota pool (Gemini vs Claude / GPT) and are metered under the actual model reported per call.',
        '编排模型与执行模型调用分别消耗各自所属模型的配额池（Gemini 或 Claude / GPT），并按每次调用实际报告的模型分别计量与计费。',
    )}</p>
        </section>`;
}

function buildSpecPriceRowHtml(
    spec: ModelSpec,
    cardKey: string,
    options?: Pick<ModelsTabOptions, 'customPricing' | 'orchestratorPricingMode'>,
): string {
    const custom = options?.customPricing || {};
    const mode = options?.orchestratorPricingMode;
    const detail = spec.isImageGeneration
        ? { pricing: null, provenance: 'unpriced' as const }
        : (() => {
            const byPlaceholder = resolvePricingDetail(spec.placeholderId, custom, { orchestratorPricingMode: mode });
            return byPlaceholder.pricing
                ? byPlaceholder
                : resolvePricingDetail(spec.modelId, custom, { orchestratorPricingMode: mode });
        })();
    const pricing = detail.pricing;
    const labelTip = richTipAttrs(
        `models-spec-pricelabel-${cardKey}`,
        'API Reference Price',
        'API 参考价',
        'Public per-1M token list rates used only to estimate equivalent API value — not your actual subscription billing.',
        '基于公开每百万 Token 标价的参考单价，仅用于估算等效 API 费用，并非实际订阅扣费。',
        'Unit: USD per 1M tokens (In = fresh input, Out = output, Cache = cache read).',
        '单位：USD / 每百万 Token（输入 = 新输入，输出 = 生成，缓存 = 缓存读取）。',
    );
    if (!pricing) {
        const unpricedTip = buildPricingProvenanceTipAttrs(`models-spec-unpriced-${cardKey}`, 'unpriced');
        return `<div class="spec-price-row is-unpriced" data-price-state="unpriced">
            <span class="spec-price-label"${labelTip}>${tBiHtml('API reference', 'API 参考价')}</span>
            <span class="spec-price-badge is-unpriced"${unpricedTip}>${tBiHtml('Unpriced', '未定价')}</span>
        </div>`;
    }
    const items: string[] = [
        `${tBiHtml('In', '输入')} ${esc(formatUsdPerMillion(pricing.input))}`,
        `${tBiHtml('Out', '输出')} ${esc(formatUsdPerMillion(pricing.output))}`,
    ];
    if (pricing.cacheRead > 0) {
        items.push(`${tBiHtml('Cache', '缓存')} ${esc(formatUsdPerMillion(pricing.cacheRead))}`);
    }
    const isMapped = detail.provenance === 'mapped_base';
    const badgeHtml = isMapped
        ? ` <span class="spec-price-badge is-mapped" data-pricing-provenance="mapped_base"${buildPricingProvenanceTipAttrs(`models-spec-prov-${cardKey}`, 'mapped_base', detail.mappedBaseLabel)}>${tBiHtml('Est. via Base Model', '按底座估算')}</span>`
        : detail.provenance === 'custom'
            ? ` <span class="spec-price-badge is-custom" data-pricing-provenance="custom"${buildPricingProvenanceTipAttrs(`models-spec-prov-${cardKey}`, 'custom')}>${tBiHtml('Custom', '自定义')}</span>`
            : '';
    return `<div class="spec-price-row${isMapped ? ' is-mapped' : ''}" data-price-state="${isMapped ? 'mapped' : 'priced'}">
        <span class="spec-price-label"${labelTip}>${tBiHtml('API reference', 'API 参考价')}</span>
        <span class="spec-price-values">${items.join(' · ')}${badgeHtml}</span>
    </div>`;
}

export function isZeroDayUnknownModel(
    placeholderId: string,
    explicitZeroDayIds?: readonly string[] | ReadonlySet<string>,
): boolean {
    const clean = (placeholderId || '').trim();
    if (!clean || clean === 'MODEL_UNSPECIFIED' || clean === 'MODEL_PLACEHOLDER_M21') {
        return false;
    }
    if (explicitZeroDayIds) {
        if (explicitZeroDayIds instanceof Set) {
            if (explicitZeroDayIds.has(clean)) { return true; }
        } else if (Array.isArray(explicitZeroDayIds) && explicitZeroDayIds.includes(clean)) {
            return true;
        }
    }
    return !Object.prototype.hasOwnProperty.call(DEFAULT_CONTEXT_LIMITS, clean);
}

export function buildModelInfoGrid(
    specs: ModelSpec[],
    kind: 'chat' | 'image' = 'chat',
    options?: Pick<ModelsTabOptions, 'customPricing' | 'orchestratorPricingMode' | 'zeroDayModelIds'>,
): string {
    const language = getLanguage();
    const cards = specs.map((s, idx) => {
        const name = localizePickerEffortLabel(s.placeholderId, s.displayName, language);
        const cardKey = `${kind}-${idx}-${slugKey(s.placeholderId || s.modelId)}`;
        const shortId = s.placeholderId.replace(/^MODEL_PLACEHOLDER_/, '');
        const isZeroDay = kind === 'chat' && isZeroDayUnknownModel(s.placeholderId, options?.zeroDayModelIds);
        const zeroDayBadgeHtml = isZeroDay
            ? `<span class="spec-zeroday-badge" data-zero-day-model="true"${richTipAttrs(
                `models-spec-zeroday-${cardKey}`,
                'Zero-Day Adaptive Model',
                '零日新模型（自适应）',
                'Unseen model ID adapted dynamically from live host metadata.',
                '静态目录未收录的新模型，已按宿主元数据动态适配。',
            )}>${tBiHtml('Adaptive · Zero-Day', '自适应 · 零日新模型')}</span>`
            : '';
        const extraId = s.placeholderId && s.placeholderId !== s.modelId
            ? `<code class="spec-short-id"${richTipAttrs(
                `models-spec-shortid-${cardKey}`,
                'Internal Model ID',
                '模型内部 ID',
                `Full placeholder identifier: ${s.placeholderId}`,
                `完整内部占位标识：${s.placeholderId}`,
                'Matches the internal model ID used in routing and diagnostics.',
                '与路由和诊断日志中的内部模型 ID 对应。',
            )}>${esc(shortId)}</code>` : '';
        const compactionTip = richTipAttrs(
            `models-spec-compaction-${cardKey}`,
            'Effective Budget (Compaction Limit)',
            '自动压缩上限（有效预算）',
            'Token threshold where Antigravity automatically summarizes older turns so context stays fast and within budget.',
            '对话上下文达到该 Token 上限时，Antigravity 会自动压缩较早历史以保持速度与稳定。',
            'Usually lower than Native Ceiling; Overview usage % uses this budget as its denominator.',
            '通常低于原生窗口上限；总览页上下文占用百分比即以此预算为分母。',
        );
        const checkpointTip = richTipAttrs(
            `models-spec-checkpoint-${cardKey}`,
            'Checkpoint Threshold',
            '检查点阈值',
            'Token size threshold that triggers Antigravity to write an internal checkpoint snapshot for recovery and summarization.',
            '触发 Antigravity 记录内部检查点快照的 Token 阈值，用于状态恢复与摘要。',
            'Separate platform setting from Effective Budget — does not hard-cap your prompt directly.',
            '独立于自动压缩上限的平台参数，不直接等同于对话截断上限。',
        );
        const nativeTip = richTipAttrs(
            `models-spec-native-${cardKey}`,
            'Native Ceiling (Model Context)',
            '原生窗口上限',
            'Physical maximum context window reported for the underlying model before any platform compaction rule.',
            '底层模型标称的物理最大上下文窗口上限。',
            'Antigravity normally auto-compacts earlier at the Effective Budget rather than filling to this ceiling.',
            '实际对话通常在更早的「自动压缩上限」就会触发压缩，而非填满整个原生窗口。',
        );
        const maxOutTip = richTipAttrs(
            `models-spec-maxout-${cardKey}`,
            'Max Output',
            '最大输出',
            'Maximum tokens the model can generate in a single response turn.',
            '单次模型回复最多可生成的 Token 上限。',
            'Includes internal thinking tokens when extended reasoning is active.',
            '开启思考能力时，内部思考 Token 也计入此上限内。',
        );
        const modelIdTip = richTipAttrs(
            `models-spec-modelid-${cardKey}`,
            'Catalog Model ID',
            '目录模型 ID',
            `Full backend model identifier: ${s.modelId}`,
            `完整后端模型标识：${s.modelId}`,
            'Matches the model key reported in Model Calls and Usage & Cost pricing tables.',
            '与「模型调用」和「用量与费用」定价表中的模型标识一致。',
        );
        return `
            <details class="spec-card" id="spec-${cardKey}" data-state-key="model-spec-${kind}-${esc(s.placeholderId || s.modelId)}" data-model-id="${esc(s.placeholderId)}"${isZeroDay ? ' data-zero-day="true"' : ''}>
                <summary class="spec-header"><h3 class="spec-name">${esc(name)}</h3></summary>
                <div class="spec-body">
                    ${zeroDayBadgeHtml}
                    <p class="spec-provider"${providerRichTipAttrs(`models-spec-provider-${cardKey}`, s.apiProvider)}>${providerLabelHtml(s.apiProvider)}</p>
                    <dl class="spec-metrics">
                        <div class="spec-metric spec-limit" data-metric="compression-limit"${compactionTip}>
                            <dt>${tBiHtml('Effective Budget (Compaction Limit)', '自动压缩上限（有效预算）')}</dt>
                            <dd>${s.isImageGeneration ? tBiHtml('Not applicable', '不适用') : formatTokensHtml(s.cpLimit)}</dd>
                        </div>
                        <div class="spec-metric" data-metric="checkpoint-threshold"${checkpointTip}>
                            <dt>${tBiHtml('Checkpoint Threshold', '检查点阈值')}</dt>
                            <dd>${s.isImageGeneration ? tBiHtml('Not applicable', '不适用') : formatTokensHtml(s.cpThreshold)}</dd>
                        </div>
                        <div class="spec-metric" data-metric="native-context"${nativeTip}>
                            <dt>${tBiHtml('Native Ceiling (Model Context)', '原生窗口上限')}</dt>
                            <dd>${formatTokensHtml(s.maxTokens)}</dd>
                        </div>
                        <div class="spec-metric" data-metric="max-output"${maxOutTip}>
                            <dt>${tBiHtml('Max Output', '最大输出')}</dt>
                            <dd>${formatTokensHtml(s.maxOutputTokens)}</dd>
                        </div>
                        <div class="spec-metric spec-thinking"${thinkingRichTipAttrs(`models-spec-thinking-${cardKey}`, s)}>
                            <dt>${tBiHtml('Thinking', '思考能力')}</dt>
                            <dd>${thinkingDescriptionHtml(s)}</dd>
                        </div>
                    </dl>
                    ${buildSpecPriceRowHtml(s, cardKey, options)}
                    ${orchestrationDescription(s, cardKey)}
                    <div class="spec-identity">
                        <code class="spec-model-id"${modelIdTip}>${esc(s.modelId)}</code>${extraId}
                    </div>
                </div>
            </details>`;
    }).join('');

    const icon = kind === 'image' ? IMAGE_SPEC_ICON_SVG : SPEC_ICON_SVG;
    const sectionClass = kind === 'image'
        ? 'card model-info-section model-info-image-section'
        : 'card model-info-section';

    return `
        <section class="${sectionClass}" data-model-kind="${kind}">
            <details id="model-specs-${kind}" class="spec-catalog">
                <summary class="spec-catalog-summary"><h2>${icon} <span>${kind === 'image' ? tBiHtml('Image generation models', '图片生成模型') : tBiHtml('Model Info', '模型信息')}</span> <span class="spec-count">${specs.length}</span></h2></summary>
                <p class="spec-description">${kind === 'image'
                ? tBiHtml('Available image models. Catalog limits may differ from public API limits.', '当前可用的图片生成模型。目录上限可能与公开 API 不同。')
                : tBiHtml('Choose a model to inspect its limits and reference pricing. Catalog limits may differ from public API limits.', '展开模型可查看上下文上限、思考能力与参考价格。目录上限可能与公开 API 限额不同。')}</p>
                <div class="spec-grid">
                    ${cards}
                </div>
            </details>
        </section>`;
}

function formatRunwayPoolName(poolKey: string): string {
    const key = poolKey.trim().toLowerCase();
    if (key === 'gemini') { return 'Gemini'; }
    if (key === 'premium') { return 'Claude / GPT'; }
    return poolKey;
}

function buildRunwayItemTipAttrs(poolKey: string, estimate: QuotaRunwayEstimate): string {
    const poolName = formatRunwayPoolName(poolKey);
    const rateStr = typeof estimate.burnRatePctPerHour === 'number' && Number.isFinite(estimate.burnRatePctPerHour) && estimate.burnRatePctPerHour > 0
        ? `${estimate.burnRatePctPerHour.toFixed(1)}%/h`
        : '';
    if (estimate.status === 'safe_until_reset') {
        return richTipAttrs(
            `models-runway-${slugKey(poolKey)}`,
            `${poolName} · Safe Before Reset`,
            `${poolName} · 重置前充裕`,
            'At your current burn rate, remaining quota is projected to last past the next reset time.',
            '按近期消耗速率估算，当前剩余配额足以支撑到下次配额重置。',
            `Calculated from a 45-minute rolling usage window${rateStr ? ` (${rateStr})` : ''} vs the pool reset countdown.`,
            `基于最近 45 分钟滚动窗口消耗速率${rateStr ? `（${rateStr}）` : ''}与重置倒计时对比得出。`,
        );
    }
    if (estimate.status === 'at_risk') {
        return richTipAttrs(
            `models-runway-${slugKey(poolKey)}`,
            `${poolName} · Quota At Risk`,
            `${poolName} · 配额预计提前耗尽`,
            'At your current burn rate, this quota pool may reach 0% before the next scheduled reset.',
            '按近期消耗速率估算，该配额池可能在下次重置前提前归零。',
            `Based on a 45-minute rolling usage window${rateStr ? ` (${rateStr})` : ''} compared against the reset countdown.`,
            `基于最近 45 分钟滚动窗口消耗速率${rateStr ? `（${rateStr}）` : ''}与重置倒计时对比得出。`,
        );
    }
    if (estimate.status === 'exhausted') {
        return richTipAttrs(
            `models-runway-${slugKey(poolKey)}`,
            `${poolName} · Quota Exhausted`,
            `${poolName} · 配额已耗尽`,
            'Remaining quota for this shared pool is 0% until the reset window completes (unless AI Credit overages are enabled).',
            '该共享配额池剩余配额已降至 0%，需等待窗口重置（除非已开启 AI 积分超额）。',
            'Monitored over a 45-minute rolling window.',
            '按 45 分钟滚动窗口持续追踪。',
        );
    }
    return richTipAttrs(
        `models-runway-${slugKey(poolKey)}`,
        `${poolName} · Burn Rate`,
        `${poolName} · 消耗速率`,
        estimate.recoveredRecently
            ? 'Quota recently increased after a reset; runway will resume once new consumption is observed.'
            : 'Recent quota burn rate measured over a 45-minute rolling window (not enough drop yet to forecast exhaustion).',
        estimate.recoveredRecently
            ? '配额刚经历重置恢复，待出现新消耗后会重新估算续航。'
            : '按最近 45 分钟滚动窗口统计的消耗速率（当前下降样本较少，暂不预测耗尽时间）。',
        rateStr ? `Current observed rate: ${rateStr}.` : 'Rolling 45-minute window vs reset countdown.',
        rateStr ? `当前观测速率：${rateStr}。` : '采用 45 分钟滚动窗口与重置倒计时对比。',
    );
}

function buildModelsRunwayStrip(runways?: Record<string, QuotaRunwayEstimate>): string {
    if (!runways) { return ''; }
    const items: string[] = [];
    for (const [poolKey, estimate] of Object.entries(runways)) {
        const badgeHtml = formatRunwayBadgeHtml(estimate);
        if (!badgeHtml) { continue; }
        items.push(`<div class="models-runway-item" data-runway-pool="${esc(poolKey)}"${buildRunwayItemTipAttrs(poolKey, estimate)}>
            <span class="models-runway-pool">${esc(formatRunwayPoolName(poolKey))}</span>
            ${badgeHtml}
        </div>`);
    }
    if (items.length === 0) { return ''; }
    const headingTip = richTipAttrs(
        'models-runway-heading',
        'Quota Runway',
        '配额续航',
        'Predicts whether each shared quota pool will last until its next reset based on recent consumption speed.',
        '根据近期配额消耗速度，预测各共享配额池能否平稳撑到下次重置。',
        'Uses a 45-minute rolling burn-rate window (%/h) compared against the pool reset countdown.',
        '计算口径：45 分钟滚动窗口消耗速率（%/h）对比配额重置倒计时。',
    );
    return `<section class="card models-runway-card" aria-label="${esc(tBi('Quota Runway', '配额续航'))}">
        <div class="models-runway-head">
            <h3${headingTip}>${ICON.clock} <span>${tBiHtml('Quota Runway', '配额续航')}</span></h3>
        </div>
        <div class="models-runway-grid acm-runway-grid">${items.join('')}</div>
    </section>`;
}

function buildWeeklyQuotaPaceCard(
    weeklyRunways: ModelsTabOptions['weeklyRunways'],
    quotaSummary?: UserQuotaSummary | null,
): string {
    const list: WeeklyQuotaRunwayEstimate[] = Array.isArray(weeklyRunways)
        ? [...weeklyRunways]
        : (weeklyRunways ? Object.values(weeklyRunways) : []);
    const hasWeeklySummary = Boolean(quotaSummary?.groups?.some(g => g.weekly));
    if (list.length === 0 && weeklyRunways === undefined && !hasWeeklySummary) {
        return '';
    }

    const itemsHtml = list.length > 0
        ? list.map((est, idx) => {
            const poolName = formatRunwayPoolName(est.pool);
            const cov = est.coverage;
            const covStr = `${cov.activeHours.toFixed(1)}h / ${cov.minActiveHours}h · ${cov.activeDays}/${cov.minActiveDays}d`;
            const isInsufficient = est.status === 'insufficient_history' || est.status === 'insufficient_data' || !cov.meetsThreshold;
            const statusTone = isInsufficient
                ? 'is-insufficient'
                : est.status === 'safe_until_reset'
                    ? 'is-safe'
                    : est.status === 'at_risk'
                        ? 'is-risk'
                        : 'is-exhausted';
            const detailHtml = isInsufficient
                ? `<span class="weekly-pace-badge is-insufficient" data-weekly-status="insufficient_history">${tHtml('quota.insufficientHistory')}</span><span class="weekly-pace-meta">${tHtml('quota.activeHoursSample')}: ${esc(covStr)}</span>`
                : `<span class="weekly-pace-badge ${statusTone}" data-weekly-status="${esc(est.status)}">${est.status === 'safe_until_reset'
                    ? tBiHtml('On Pace (Safe)', '节奏安全')
                    : est.status === 'at_risk'
                        ? tBiHtml('At Risk Before Reset', '重置前可能耗尽')
                        : tBiHtml('Exhausted', '已耗尽')}</span>`
                + `<span class="weekly-pace-meta">${tHtml('quota.burnRate')}: ${est.burnRatePctPerActiveHour !== null ? `${est.burnRatePctPerActiveHour.toFixed(1)}%/h` : '—'} · ${est.projectedDailyBurnPct !== null ? `${est.projectedDailyBurnPct.toFixed(1)}%/d` : '—'} · ${esc(covStr)}</span>`;
            const tip = richTipAttrs(
                `models-weekly-pace-${idx}-${slugKey(est.pool)}`,
                `${poolName} · Weekly Pace`,
                `${poolName} · 周节奏`,
                isInsufficient ? `Insufficient active-hours history (${covStr}).` : `Active-hours burn pace (${covStr}, offline gaps excluded).`,
                isInsufficient ? `活跃时长历史不足（${covStr}）。` : `按实测活跃时段估算（${covStr}，排除离线空洞）。`,
            );
            return `<div class="models-runway-item weekly-pace-item" data-weekly-pool="${esc(est.pool)}" data-weekly-meets-threshold="${cov.meetsThreshold ? 'true' : 'false'}"${tip}><span class="models-runway-pool">${esc(poolName)} (${esc(est.window)})</span><div class="weekly-pace-body">${detailHtml}</div></div>`;
        }).join('')
        : `<div class="models-runway-item weekly-pace-item" data-weekly-meets-threshold="false" data-weekly-status="insufficient_history"><span class="weekly-pace-badge is-insufficient">${tHtml('quota.insufficientHistory')}</span><span class="weekly-pace-meta">${tHtml('quota.activeHoursSample')}: ≥2h / ≥2d</span></div>`;

    const headTip = richTipAttrs(
        'models-weekly-pace-heading',
        'Weekly Active-Hours Quota Pace Forecast',
        '周活跃时长节奏预测',
        'Uses persisted hourly active buckets (excluding offline gaps), or shows Insufficient history below threshold.',
        '基于持久化活跃小时样本（排除离线空洞）预测周节奏；覆盖不足时显示「历史不足」。',
    );

    return `<section class="card models-weekly-pace-card" id="modelsWeeklyPaceCard" data-weekly-forecast="true" aria-label="${esc(tBi('Weekly Active-Hours Forecast', '周活跃时长节奏预测'))}">
        <div class="models-runway-head">
            <h3${headTip}>${ICON.clock} <span>${tHtml('quota.weeklyActiveForecast')}</span></h3>
        </div>
        <div class="models-runway-grid acm-runway-grid">${itemsHtml}</div>
    </section>`;
}

export function buildModelsTabContent(
    userInfo: UserStatusInfo | null,
    configs: ModelConfig[],
    options: ModelsTabOptions = {},
): string {
    const parts: string[] = [];
    const sortedConfigs = userInfo ? sortModels(configs, userInfo.modelSortOrder) : configs;

    // 0. Stale-Safe Cached Banner (when RPC hiccup occurred)
    const staleHtml = buildStaleBannerHtml(options.staleState);
    if (staleHtml) {
        parts.push(staleHtml);
    }

    // 1. Default Model Card
    const defaultModelHtml = buildDefaultModelCard(userInfo);
    if (defaultModelHtml) {
        parts.push(defaultModelHtml);
    }

    // 1b. Orchestrator Settings Card (live Jetbox + Mendel roles + effective per-1M rates)
    const orchestratorSettingsHtml = buildOrchestratorSettingsCard(options.orchestratorSettings, {
        customPricing: options.customPricing,
        orchestratorPricingMode: options.orchestratorPricingMode,
    });
    if (orchestratorSettingsHtml) {
        parts.push(orchestratorSettingsHtml);
    }

    // 2. Personal Model Quota Grid (dual-window 5h + Weekly + Runway + Weekly Active-Hours Forecast + Custom-Model Isolation)
    const quotaHtml = buildModelQuotaGrid(sortedConfigs, {
        quotaSummary: options.quotaSummary,
        quotaWindowMode: options.quotaWindowMode,
        quotaDirectionMode: options.quotaDirectionMode,
    });
    if (options.isCustomModelActive) {
        parts.push(buildCustomModelBannerHtml());
        if (quotaHtml) {
            const byokSummaryTip = richTipAttrs(
                'models-byok-pools-summary',
                'BYOK / Custom Model Isolation',
                'BYOK / 自定义模型配额隔离',
                'BYOK (Bring Your Own Key) and custom-* models use your own API provider and do not consume Google Antigravity shared quota pools.',
                'BYOK（自带 API 密钥）与 custom-* 自定义模型走独立接口，不消耗 Google Antigravity 共享配额池。',
                'Pools are collapsed and low-quota alerts are suppressed while this session is active.',
                '当前会话激活期间自动折叠配额池并静音低配额预警，点击可展开查看。',
            );
            parts.push(`<details id="models-custom-model-pools" class="custom-model-pools-collapse" data-state-key="models-custom-model-pools">
                <summary${byokSummaryTip}><span>${tBiHtml('Google Quota Pools (Paused for Custom Model)', 'Google 配额池（自定义模型已隔离）')}</span></summary>
                ${quotaHtml}
            </details>`);
        }
    } else {
        const runwayHtml = buildModelsRunwayStrip(options.quotaRunways);
        if (runwayHtml) {
            parts.push(runwayHtml);
        }
        const weeklyPaceHtml = buildWeeklyQuotaPaceCard(options.weeklyRunways, options.quotaSummary);
        if (weeklyPaceHtml) {
            parts.push(weeklyPaceHtml);
        }
        if (quotaHtml) {
            parts.push(quotaHtml);
        }
    }

    // 3. Official Model Info Grid
    // 范围严格限定为 sortedConfigs 中展示在前台的界面模型
    const specs: ModelSpec[] = [];
    const allSpecs = getModelSpecs();
    const specMap = new Map<string, ModelSpec>();
    for (const spec of allSpecs) {
        specMap.set(spec.placeholderId, spec);
    }

    const shown = new Set<string>();
    for (const config of sortedConfigs) {
        if (!config.model || shown.has(config.model)) { continue; }
        shown.add(config.model);
        const spec = specMap.get(config.model);
        if (spec?.isImageGeneration) { continue; }
        // A picker label establishes availability. It supplies no context or reasoning limits.
        specs.push(spec ? { ...spec, displayName: config.label } : {
            modelId: config.modelId || config.model, placeholderId: config.model,
            displayName: config.label, apiProvider: '', maxTokens: 0, maxOutputTokens: 0,
            cpLimit: 0, cpThreshold: 0, thinkingBudget: 0, supportsThinking: false,
            thinkingCapabilityReported: false,
        });
    }

    if (specs.length > 0) {
        parts.push(buildModelInfoGrid(specs, 'chat', options));
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
        parts.push(buildModelInfoGrid(imageSpecs, 'image', options));
    }

    if (parts.length === 0) {
        return `
            <section class="card empty">
                <h2>${ICON.bolt} <span>${tBiHtml('Models', '模型')}</span></h2>
                <p class="empty-desc">${tBiHtml(
            'Waiting for model-related data from the local service...',
            '正在等待本地服务返回模型相关数据...',
        )}</p>
            </section>`;
    }

    return parts.join('');
}

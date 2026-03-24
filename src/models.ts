// ─── Model Context Limits & Display Names ────────────────────────────────────
// Extracted from tracker.ts for single-responsibility.
//
// Real model IDs discovered from Antigravity LS via GetUserStatus API.
// Updated: 2026-03-16
//
// The "MODEL_PLACEHOLDER_Mxx" naming is Antigravity's convention for aliased
// models. Mapping:
//   M37 = Gemini 3.1 Pro (High quality variant)
//   M36 = Gemini 3.1 Pro (Low quality variant)
//   M47 = Gemini 3 Flash (renamed from M18 as of 2026-03-15)
//   M18 = Gemini 3 Flash [Legacy, kept for backward compat]
//   M35 = Claude Sonnet 4.6 (Thinking mode) — 1M context (GA since 2026-03-13)
//   M26 = Claude Opus 4.6 (Thinking mode)  — 1M context (GA since 2026-03-13)

import { tBi } from './i18n';

// ─── Default Context Limits ──────────────────────────────────────────────────

export const DEFAULT_CONTEXT_LIMITS: Record<string, number> = {
    'MODEL_PLACEHOLDER_M37': 1_000_000,  // Gemini 3.1 Pro (High)
    'MODEL_PLACEHOLDER_M36': 1_000_000,  // Gemini 3.1 Pro (Low)
    'MODEL_PLACEHOLDER_M47': 1_000_000,  // Gemini 3 Flash (renamed from M18 as of 2026-03-15)
    'MODEL_PLACEHOLDER_M18': 1_000_000,  // [Legacy] Gemini 3 Flash (old ID, kept for backward compat)
    'MODEL_PLACEHOLDER_M35': 1_000_000,  // Claude Sonnet 4.6 (Thinking) — updated from 200K
    'MODEL_PLACEHOLDER_M26': 1_000_000,  // Claude Opus 4.6 (Thinking)  — updated from 200K
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 128_000,  // GPT-OSS 120B (Medium)
};

export const DEFAULT_CONTEXT_LIMIT = 1_000_000;

// ─── Model Display Names ─────────────────────────────────────────────────────
// `let` — this map is mutated at runtime by `updateModelDisplayNames()`

let modelDisplayNames: Record<string, Record<'en' | 'zh', string>> = {
    'MODEL_PLACEHOLDER_M37': { en: 'Gemini 3.1 Pro (High)', zh: 'Gemini 3.1 Pro (强)' },
    'MODEL_PLACEHOLDER_M36': { en: 'Gemini 3.1 Pro (Low)', zh: 'Gemini 3.1 Pro (弱)' },
    'MODEL_PLACEHOLDER_M47': { en: 'Gemini 3 Flash', zh: 'Gemini 3 Flash' },
    'MODEL_PLACEHOLDER_M18': { en: 'Gemini 3 Flash', zh: 'Gemini 3 Flash' },  // [Legacy] old ID
    'MODEL_PLACEHOLDER_M35': { en: 'Claude Sonnet 4.6 (Thinking)', zh: 'Claude Sonnet 4.6 (思考)' },
    'MODEL_PLACEHOLDER_M26': { en: 'Claude Opus 4.6 (Thinking)', zh: 'Claude Opus 4.6 (思考)' },
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': { en: 'GPT-OSS 120B (Medium)', zh: 'GPT-OSS 120B (中)' },
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the context limit for a model.
 */
export function getContextLimit(
    model: string,
    customLimits?: Record<string, number>
): number {
    if (customLimits?.[model] !== undefined) {
        // Clamp to minimum 1 to prevent negative or zero limits
        return Math.max(1, customLimits[model]);
    }
    return DEFAULT_CONTEXT_LIMITS[model] || DEFAULT_CONTEXT_LIMIT;
}

/**
 * Get display name for a model (i18n-aware).
 */
export function getModelDisplayName(model: string): string {
    const entry = modelDisplayNames[model];
    if (entry) {
        return tBi(entry.en, entry.zh);
    }
    return model || tBi('Unknown Model', '未知模型');
}

// ─── Model Config from GetUserStatus ─────────────────────────────────────────

export interface QuotaInfo {
    remainingFraction: number;
    resetTime: string;
}

export interface ModelConfig {
    model: string;
    label: string;
    supportsImages: boolean;
    quotaInfo?: QuotaInfo;
    allowedTiers: string[];
    tagTitle?: string;
    mimeTypeCount: number;
    isRecommended: boolean;
    supportedMimeTypes: string[];
}

export interface PlanLimits {
    maxNumChatInputTokens: number;
    maxNumPremiumChatMessages: number;
    maxCustomChatInstructionCharacters: number;
    maxNumPinnedContextItems: number;
    maxLocalIndexSize: number;
    monthlyFlexCreditPurchaseAmount: number;
}

export interface TeamConfig {
    allowMcpServers: boolean;
    allowAutoRunCommands: boolean;
    allowBrowserExperimentalFeatures: boolean;
}

export interface CreditInfo {
    creditType: string;
    creditAmount: number;
    minimumCreditAmountForUsage: number;
}

export interface UserStatusInfo {
    name: string;
    email: string;
    planName: string;
    teamsTier: string;
    monthlyPromptCredits: number;
    monthlyFlowCredits: number;
    availablePromptCredits: number;
    availableFlowCredits: number;
    userTierName: string;
    userTierId: string;
    defaultModelLabel: string;
    planLimits: PlanLimits;
    teamConfig: TeamConfig;
    availableCredits: CreditInfo[];
    // Feature flags
    canBuyMoreCredits: boolean;
    browserEnabled: boolean;
    cascadeWebSearchEnabled: boolean;
    knowledgeBaseEnabled: boolean;
    canGenerateCommitMessages: boolean;
    cascadeCanAutoRunCommands: boolean;
    canAllowCascadeInBackground: boolean;
    hasAutocompleteFastMode: boolean;
    allowStickyPremiumModels: boolean;
    allowPremiumCommandModels: boolean;
    hasTabToJump: boolean;
    canCustomizeAppIcon: boolean;
    // ─── Deep-mined fields (discovered via diag-deep-mine-profile) ────────
    /** Tier description from userTier.description (e.g. "Google AI Ultra") */
    userTierDescription: string;
    /** Subscription status text from userTier.upgradeSubscriptionText */
    upgradeSubscriptionText: string;
    /** LS recommended model sort order from clientModelSorts */
    modelSortOrder: string[];
    /** Raw LS GetUserStatus response — for diagnostic Raw Data panel */
    _rawResponse?: Record<string, unknown>;
}

export interface FullUserStatus {
    configs: ModelConfig[];
    userInfo: UserStatusInfo | null;
    /** Raw LS response for diagnostic / transparency display */
    rawResponse?: Record<string, unknown>;
}

/**
 * Update model display names with dynamically fetched model configs.
 * Only appends new entries — hardcoded values are preserved as fallback.
 */
export function updateModelDisplayNames(configs: ModelConfig[]): void {
    for (const c of configs) {
        if (c.model && c.label && !modelDisplayNames[c.model]) {
            // Dynamic configs come as a single label string; use for both languages
            modelDisplayNames[c.model] = { en: c.label, zh: c.label };
        }
    }
}

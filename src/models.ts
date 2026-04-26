// ─── Model Context Limits & Display Names ────────────────────────────────────
// Extracted from tracker.ts for single-responsibility.
//
// Model display names are populated dynamically from the LS GetUserStatus API
// (`cascadeModelConfigData.clientModelConfigs[].label`). No hardcoded model
// name mapping — the API is the single source of truth.
//
// DEFAULT_CONTEXT_LIMITS and KNOWN_QUOTA_POOLS are retained as static fallbacks
// because the API does not expose context window sizes or pool groupings.

// ─── Default Context Limits ──────────────────────────────────────────────────

export const DEFAULT_CONTEXT_LIMITS: Record<string, number> = {
    // ── Platform truncation thresholds (from GM plannerConfig.truncationThresholdTokens) ──
    // These are the ACTUAL context window limits enforced by the platform,
    // NOT the model's native context window size.
    // Verified via diag-scripts/overview/model-compare.ts (2026-04-24).
    'MODEL_PLACEHOLDER_M37': 120_000,   // Gemini 3.1 Pro (High) — platform says 160K but compression triggers at ~125K
    'MODEL_PLACEHOLDER_M36': 120_000,   // Gemini 3.1 Pro (Low)  — same pool as High
    'MODEL_PLACEHOLDER_M47': 160_000,   // Gemini 3 Flash
    'MODEL_PLACEHOLDER_M18': 160_000,   // [Legacy] Gemini 3 Flash (old ID)
    'MODEL_PLACEHOLDER_M35': 160_000,   // Claude Sonnet 4.6 (Thinking) — truncationThresholdTokens=160000
    'MODEL_PLACEHOLDER_M26': 160_000,   // Claude Opus 4.6 (Thinking)  — truncationThresholdTokens=160000
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 128_000,  // GPT-OSS 120B (Medium)
};

export const DEFAULT_CONTEXT_LIMIT = 160_000;

// ─── Model Display Names ─────────────────────────────────────────────────────
// Starts empty — populated dynamically by `updateModelDisplayNames()` from
// the LS GetUserStatus API. No hardcoded model names.

let modelDisplayNames: Record<string, string> = {};

const KNOWN_QUOTA_POOLS: Record<string, string> = {
    'MODEL_PLACEHOLDER_M37': 'gemini-pro',
    'MODEL_PLACEHOLDER_M36': 'gemini-pro',
    'MODEL_PLACEHOLDER_M47': 'gemini-flash',
    'MODEL_PLACEHOLDER_M18': 'gemini-flash',
    'MODEL_PLACEHOLDER_M35': 'claude-premium',
    'MODEL_PLACEHOLDER_M26': 'claude-premium',
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 'claude-premium',
};

// ─── Legacy Chinese Name Migration ──────────────────────────────────────────
// Pre-v1.16 persisted data may contain localized Chinese display names.
// This static mapping allows `resolveModelId()` to resolve them back to
// canonical model IDs, enabling automatic cleanup of legacy persisted data.

const LEGACY_ZH_MODEL_NAMES: Record<string, string> = {
    'Gemini 3.1 Pro (强)': 'MODEL_PLACEHOLDER_M37',
    'Gemini 3.1 Pro (弱)': 'MODEL_PLACEHOLDER_M36',
    'Claude Sonnet 4.6 (思考)': 'MODEL_PLACEHOLDER_M35',
    'Claude Opus 4.6 (思考)': 'MODEL_PLACEHOLDER_M26',
    'GPT-OSS 120B (中)': 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
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
 * Get display name for a model.
 * Returns the API-provided label, or the raw model ID if not yet loaded.
 */
export function getModelDisplayName(model: string): string {
    return modelDisplayNames[model] || model || 'Unknown Model';
}

/**
 * Resolve a model ID or display label back to the canonical model ID.
 */
export function resolveModelId(modelOrDisplay: string): string | undefined {
    const clean = modelOrDisplay.trim();
    if (!clean) { return undefined; }
    // Direct model ID match
    if (modelDisplayNames[clean] !== undefined) { return clean; }
    // Reverse lookup: display label → model ID
    for (const [modelId, label] of Object.entries(modelDisplayNames)) {
        if (label === clean) {
            return modelId;
        }
    }
    // Legacy Chinese name fallback (pre-v1.16 persisted data migration)
    const legacyId = LEGACY_ZH_MODEL_NAMES[clean];
    if (legacyId) { return legacyId; }
    return undefined;
}

/**
 * Normalize a model ID or display label to the canonical display name.
 * Unknown values are returned unchanged.
 */
export function normalizeModelDisplayName(modelOrDisplay: string): string {
    const clean = modelOrDisplay.trim();
    if (!clean) { return ''; }
    const modelId = resolveModelId(clean);
    return modelId ? getModelDisplayName(modelId) : clean;
}

/**
 * Return a stable quota-pool key for models known to share quota.
 * Falls back to resetTime/modelId for unknown future models.
 */
export function getQuotaPoolKey(modelId: string, resetTime?: string): string {
    const fixedPool = KNOWN_QUOTA_POOLS[modelId];
    if (fixedPool) {
        return fixedPool;
    }
    return resetTime || modelId;
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
 * Populate model display names from LS API model configs.
 * Always overwrites — the API `label` field is the single source of truth.
 */
export function updateModelDisplayNames(configs: ModelConfig[]): void {
    for (const c of configs) {
        if (c.model && c.label) {
            modelDisplayNames[c.model] = c.label;
        }
    }
}

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
    // Verified via diag-scripts/my-tools/extra/all-models-deep-miner.ts (2026-05-19).
    'MODEL_PLACEHOLDER_M16': 128_000,   // Gemini 3.1 Pro (High) — new ID (gemini-pro-default), cp_limit=128000
    'MODEL_PLACEHOLDER_M37': 128_000,   // [Legacy] Gemini 3.1 Pro (High) — now demoted to planModel/dispatcher
    'MODEL_PLACEHOLDER_M36': 128_000,   // Gemini 3.1 Pro (Low)  — same pool as High
    'MODEL_PLACEHOLDER_M133': 128_000,  // Gemini 3 Flash (checkpoint ghost, gemini-3-flash-b)
    'MODEL_PLACEHOLDER_M132': 128_000,  // Gemini 3.5 Flash (High) — current ID (gemini-3-flash-agent), cp_threshold=128000
    'MODEL_PLACEHOLDER_M20': 128_000,   // Gemini 3.5 Flash (Medium) — (gemini-3.5-flash-low), same checkpointer as M132
    'MODEL_PLACEHOLDER_M84': 128_000,   // [Legacy] Gemini 3 Flash — old ID
    'MODEL_PLACEHOLDER_M47': 128_000,   // [Legacy] Gemini 3 Flash (older ID)
    'MODEL_PLACEHOLDER_M18': 160_000,   // [Legacy] Gemini 3 Flash (older ID)
    'MODEL_PLACEHOLDER_M35': 160_000,   // Claude Sonnet 4.6 (Thinking) — truncationThresholdTokens=160000
    'MODEL_PLACEHOLDER_M26': 160_000,   // Claude Opus 4.6 (Thinking)  — truncationThresholdTokens=160000
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 80_000,   // GPT-OSS 120B (Medium) — cp_limit=80000
};

export const DEFAULT_CONTEXT_LIMIT = 160_000;

// ─── Model Display Names ─────────────────────────────────────────────────────
// Starts empty — populated dynamically by `updateModelDisplayNames()` from
// the LS GetUserStatus API. No hardcoded model names.

let modelDisplayNames: Record<string, string> = {};
/** responseModel -> placeholder ID reverse map (populated from GM data). */
let responseModelAliases: Record<string, string> = {};
/** Whether to append diagnostic short ID suffix (e.g. "(M16)") to display names. */
let showModelShortId = false;

const KNOWN_QUOTA_POOLS: Record<string, string> = {
    // Gemini pool — Flash and Pro share the same quota since mid-2026
    'MODEL_PLACEHOLDER_M16': 'gemini',
    'MODEL_PLACEHOLDER_M37': 'gemini',
    'MODEL_PLACEHOLDER_M36': 'gemini',
    'MODEL_PLACEHOLDER_M133': 'gemini',
    'MODEL_PLACEHOLDER_M132': 'gemini',
    'MODEL_PLACEHOLDER_M20': 'gemini',
    'MODEL_PLACEHOLDER_M84': 'gemini',
    'MODEL_PLACEHOLDER_M47': 'gemini',
    'MODEL_PLACEHOLDER_M18': 'gemini',
    // Claude/GPT premium pool
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

// ─── Static Model Display Name Fallbacks ─────────────────────────────────────
// Used before GetUserStatus has populated API labels, and for retired IDs that
// may still appear in persisted/archived daily data.

const STATIC_MODEL_NAME_FALLBACKS: Record<string, string> = {
    'MODEL_PLACEHOLDER_M16': 'Gemini 3.1 Pro (High)',
    'MODEL_PLACEHOLDER_M37': 'Gemini 3.1 Pro (High)',  // Replaced by M16
    'MODEL_PLACEHOLDER_M36': 'Gemini 3.1 Pro (Low)',
    'MODEL_PLACEHOLDER_M133': 'Gemini 3 Flash',         // checkpoint ghost / legacy model (gemini-3-flash-b)
    'MODEL_PLACEHOLDER_M132': 'Gemini 3.5 Flash',       // current active
    'MODEL_PLACEHOLDER_M20': 'Gemini 3.5 Flash (Medium)',  // gemini-3.5-flash-low / same family as M132
    'MODEL_PLACEHOLDER_M84': 'Gemini 3 Flash',         // Replaced by M133
    'MODEL_PLACEHOLDER_M47': 'Gemini 3 Flash',         // Replaced by M84 → M133
    'MODEL_PLACEHOLDER_M18': 'Gemini 3 Flash',
    'MODEL_PLACEHOLDER_M35': 'Claude Sonnet 4.6 (Thinking)',
    'MODEL_PLACEHOLDER_M26': 'Claude Opus 4.6 (Thinking)',
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 'GPT-OSS 120B (Medium)',
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
    return modelDisplayNames[model] || STATIC_MODEL_NAME_FALLBACKS[model] || model || 'Unknown Model';
}

/**
 * Extract a short diagnostic ID from a model placeholder.
 * e.g. MODEL_PLACEHOLDER_M16 → "M16", MODEL_OPENAI_GPT_OSS_120B_MEDIUM → "OSS-120B"
 */
export function getModelShortId(modelId: string): string {
    const m = modelId.match(/MODEL_PLACEHOLDER_(M\d+)/);
    if (m) { return m[1]; }
    if (modelId === 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM') { return 'OSS-120B'; }
    return '';
}

/**
 * Resolve a model ID or display label back to the canonical model ID.
 */
export function resolveModelId(modelOrDisplay: string): string | undefined {
    const clean = modelOrDisplay.trim();
    if (!clean) { return undefined; }
    // Direct model ID match (API-registered or retired)
    if (modelDisplayNames[clean] !== undefined || STATIC_MODEL_NAME_FALLBACKS[clean] !== undefined) { return clean; }
    // Reverse lookup: display label → model ID
    for (const [modelId, label] of Object.entries(modelDisplayNames)) {
        if (label === clean) {
            return modelId;
        }
    }
    // Reverse lookup: legacy display label → model ID (persisted data migration)
    for (const [modelId, label] of Object.entries(STATIC_MODEL_NAME_FALLBACKS)) {
        if (label === clean) {
            return modelId;
        }
    }
    // responseModel alias lookup (e.g. "gemini-pro-default" → "MODEL_PLACEHOLDER_M16")
    const fromResponseModel = responseModelAliases[clean];
    if (fromResponseModel) { return fromResponseModel; }
    // Legacy Chinese name fallback (pre-v1.16 persisted data migration)
    const legacyId = LEGACY_ZH_MODEL_NAMES[clean];
    if (legacyId) { return legacyId; }
    // Strip trailing diagnostic suffix "(Mxx)" and retry — handles persisted keys
    // that include the short ID appended by normalizeModelDisplayName()
    const suffixStripped = clean.replace(/\s*\(M\d+\)$/, '').replace(/\s*\(OSS-120B\)$/, '');
    if (suffixStripped !== clean && suffixStripped) {
        return resolveModelId(suffixStripped);
    }
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
    if (!modelId) { return clean; }
    const displayName = getModelDisplayName(modelId);
    const shortId = getModelShortId(modelId);
    // Append diagnostic short ID when enabled and display name is resolved
    if (showModelShortId && shortId && displayName !== modelId && !displayName.includes(`(${shortId})`)) {
        return `${displayName} (${shortId})`;
    }
    return displayName;
}

/**
 * Get the base display name WITHOUT the diagnostic (Mxx) suffix.
 * Used as a stable aggregation key for cost/pricing merging, so that the
 * same model under different internal IDs (e.g. M37 and M16 both being
 * "Gemini 3.1 Pro (High)") can be merged into a single cost row.
 */
export function getModelBaseName(modelOrDisplay: string): string {
    const clean = modelOrDisplay.trim();
    if (!clean) { return ''; }
    const modelId = resolveModelId(clean);
    if (!modelId) { return clean; }
    return getModelDisplayName(modelId);
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

/**
 * Register a responseModel → placeholder ID alias.
 * Called from GM data processing when we discover the mapping.
 * e.g. registerResponseModelAlias('gemini-pro-default', 'MODEL_PLACEHOLDER_M16')
 * Allows resolveModelId('gemini-pro-default') → 'MODEL_PLACEHOLDER_M16' → "Gemini 3.1 Pro (High)"
 */
export function registerResponseModelAlias(responseModel: string, placeholderId: string): void {
    if (responseModel && placeholderId && responseModel !== placeholderId) {
        responseModelAliases[responseModel] = placeholderId;
    }
}

/**
 * Enable/disable the diagnostic short ID suffix on normalizeModelDisplayName().
 * When enabled, model names display as "Gemini 3.1 Pro (High) (M16)" etc.
 */
export function setShowModelShortId(enabled: boolean): void {
    showModelShortId = enabled;
}

/** Check whether the diagnostic short ID suffix is currently enabled. */
export function isShowModelShortId(): boolean {
    return showModelShortId;
}

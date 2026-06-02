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
    // Note: All fallback limits are intentionally offset by -1,000 (1K) so that in daily use,
    // you can instantly recognize if the extension has successfully overridden the fallback with live captures.
    'MODEL_PLACEHOLDER_M16': 127_000,   // Gemini 3.1 Pro (High) — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M37': 127_000,   // [Legacy] Gemini 3.1 Pro (High) — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M36': 127_000,   // Gemini 3.1 Pro (Low)  — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M133': 127_000,  // Gemini 3.5 Flash (High) — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M132': 127_000,  // Gemini 3.5 Flash (High) — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M187': 127_000,  // Gemini 3.5 Flash (Low) — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M20': 127_000,   // Gemini 3.5 Flash (Medium) — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M84': 127_000,   // [Legacy] Gemini 3 Flash — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M47': 127_000,   // [Legacy] Gemini 3 Flash (older ID) — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M18': 159_000,   // [Legacy] Gemini 3 Flash (older ID) — fallback offset by -1K (live: 160,000)
    'MODEL_PLACEHOLDER_M35': 159_000,   // Claude Sonnet 4.6 (Thinking) — fallback offset by -1K (live: 160,000)
    'MODEL_PLACEHOLDER_M26': 159_000,   // Claude Opus 4.6 (Thinking)  — fallback offset by -1K (live: 160,000)
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 79_000,   // GPT-OSS 120B (Medium) — fallback offset by -1K (live: 80,000)
};

export const DEFAULT_CONTEXT_LIMIT = 159_000;

// ─── Model Display Names ─────────────────────────────────────────────────────
// Starts empty — populated dynamically by `updateModelDisplayNames()` from
// the LS GetUserStatus API. No hardcoded model names.

let modelDisplayNames: Record<string, string> = {};
/** responseModel -> placeholder ID reverse map (populated from GM data).
 *  Pre-seeded with known stable aliases so findPricing works before fetchAll.
 *  Source: GetAvailableModels API (all_models_parameter_map.md 2026-05-22) */
let responseModelAliases: Record<string, string> = {
    // Gemini Pro aliases
    'gemini-pro-default': 'MODEL_PLACEHOLDER_M16',       // legacy responseModel for M16
    'gemini-pro-agent': 'MODEL_PLACEHOLDER_M16',          // current model_id for M16
    'gemini-3.1-pro-high': 'MODEL_PLACEHOLDER_M37',       // model_id for M37
    'gemini-3.1-pro-low': 'MODEL_PLACEHOLDER_M36',        // model_id for M36
    // Gemini Flash aliases
    'gemini-3-flash-a': 'MODEL_PLACEHOLDER_M132',          // legacy responseModel for 3.5 Flash
    'gemini-3-flash-agent': 'MODEL_PLACEHOLDER_M133',     // model_id for M133 (3.5 Flash High)
    'gemini-3-flash-b': 'MODEL_PLACEHOLDER_M133',          // responseModel alias for M133
    'gemini-3.5-flash-low': 'MODEL_PLACEHOLDER_M20',      // model_id for M20 (3.5 Flash Medium)
    'gemini-3-flash': 'MODEL_PLACEHOLDER_M18',             // backend command model
    // Claude aliases
    'claude-opus-4-6-thinking': 'MODEL_PLACEHOLDER_M26',  // model_id for Opus
    'claude-sonnet-4-6': 'MODEL_PLACEHOLDER_M35',          // model_id for Sonnet
    // GPT-OSS
    'gpt-oss-120b-medium': 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
};
/** Whether to append diagnostic short ID suffix (e.g. "(M16)") to display names. */
let showModelShortId = false;

const KNOWN_QUOTA_POOLS: Record<string, string> = {
    // Gemini pool — Flash and Pro share the same quota since mid-2026
    'MODEL_PLACEHOLDER_M16': 'gemini',
    'MODEL_PLACEHOLDER_M37': 'gemini',
    'MODEL_PLACEHOLDER_M36': 'gemini',
    'MODEL_PLACEHOLDER_M133': 'gemini',
    'MODEL_PLACEHOLDER_M132': 'gemini',
    'MODEL_PLACEHOLDER_M187': 'gemini',
    'MODEL_PLACEHOLDER_M20': 'gemini',
    'MODEL_PLACEHOLDER_M84': 'gemini',
    'MODEL_PLACEHOLDER_M47': 'gemini',
    'MODEL_PLACEHOLDER_M18': 'gemini',
    // Claude/GPT premium pool
    'MODEL_PLACEHOLDER_M35': 'premium',
    'MODEL_PLACEHOLDER_M26': 'premium',
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 'premium',
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
    'MODEL_PLACEHOLDER_M133': 'Gemini 3.5 Flash (High)',  // gemini-3-flash-agent (renamed from "Gemini 3 Flash")
    'MODEL_PLACEHOLDER_M132': 'Gemini 3.5 Flash (High)',  // retired predecessor of M133
    'MODEL_PLACEHOLDER_M187': 'Gemini 3.5 Flash (Low)',
    'MODEL_PLACEHOLDER_M20': 'Gemini 3.5 Flash (Medium)', // gemini-3.5-flash-low
    'MODEL_PLACEHOLDER_M84': 'Gemini 3 Flash',            // retired (replaced by M133)
    'MODEL_PLACEHOLDER_M47': 'Gemini 3 Flash',            // retired (replaced by M84)
    'MODEL_PLACEHOLDER_M18': 'Gemini 3 Flash',            // backend command model
    'MODEL_PLACEHOLDER_M35': 'Claude Sonnet 4.6 (Thinking)',
    'MODEL_PLACEHOLDER_M26': 'Claude Opus 4.6 (Thinking)',
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 'GPT-OSS 120B (Medium)',
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 启发式智能未知大模型家族推导预测
 * Predict cpLimit, cpThreshold, and maxTokens based on model keywords.
 * Prevents unknown future models from blindly inheriting a generic 160K fallback.
 */
export function guessContextLimitSpec(modelId: string): { cpLimit: number; cpThreshold: number; maxTokens: number; supportsThinking: boolean } {
    const idLower = modelId.toLowerCase();

    // 1. Claude/Premium (Thinking) series -> 160K CP Limit
    if (idLower.includes('claude') || idLower.includes('opus') || idLower.includes('sonnet') || idLower.includes('m35') || idLower.includes('m26')) {
        return { cpLimit: 160000, cpThreshold: 100000, maxTokens: 250000, supportsThinking: true };
    }

    // 2. Gemini Pro / High reasoning series -> 128K CP Limit
    if (idLower.includes('pro') || idLower.includes('m16') || idLower.includes('m37') || idLower.includes('m36')) {
        return { cpLimit: 128000, cpThreshold: 60000, maxTokens: 1048576, supportsThinking: false };
    }

    // 3. Gemini Flash / Lite series -> 128K CP Limit
    if (idLower.includes('flash') || idLower.includes('lite') || idLower.includes('m133') || idLower.includes('m20') || idLower.includes('m187') || idLower.includes('unspecified')) {
        return { cpLimit: 128000, cpThreshold: 50000, maxTokens: 1048576, supportsThinking: false };
    }

    // 4. GPT-OSS lightweight series -> 80K CP Limit
    if (idLower.includes('gpt') || idLower.includes('oss')) {
        return { cpLimit: 80000, cpThreshold: 40000, maxTokens: 131072, supportsThinking: false };
    }

    // 5. 完全未知反传统新模型 -> 暂不强套死数据（为 0 触发“正在计算阈值...”流光），待会话遥测命中
    return { cpLimit: 0, cpThreshold: 0, maxTokens: 0, supportsThinking: false };
}

/**
 * Get the context limit for a model.
 */
export function getContextLimit(
    model: string,
    customLimits?: Record<string, number>
): number {
    if (DEFAULT_CONTEXT_LIMITS[model] !== undefined) {
        return DEFAULT_CONTEXT_LIMITS[model];
    }
    const guessed = guessContextLimitSpec(model);
    return guessed.cpLimit > 0 ? (guessed.cpLimit - 1000) : DEFAULT_CONTEXT_LIMIT;
}

/**
 * Dynamically override context limits based on official checkpointer parameters.
 */
export function overrideContextLimits(overrides: Record<string, number>): void {
    for (const [model, limit] of Object.entries(overrides)) {
        if (limit > 0) {
            DEFAULT_CONTEXT_LIMITS[model] = limit;
        }
    }
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

function isConcreteAliasTarget(modelId: string): boolean {
    const clean = modelId.trim();
    return /^MODEL_[A-Z0-9_]+$/.test(clean) && !clean.includes('UNSPECIFIED');
}

/**
 * Register a responseModel → placeholder ID alias.
 * Called from GM data processing when we discover the mapping.
 * e.g. registerResponseModelAlias('gemini-pro-default', 'MODEL_PLACEHOLDER_M16')
 * Allows resolveModelId('gemini-pro-default') → 'MODEL_PLACEHOLDER_M16' → "Gemini 3.1 Pro (High)"
 */
export function registerResponseModelAlias(responseModel: string, placeholderId: string): void {
    const responseKey = responseModel.trim();
    const target = placeholderId.trim();
    if (!responseKey || !target || responseKey === target || !isConcreteAliasTarget(target)) {
        return;
    }
    const existing = responseModelAliases[responseKey];
    if (existing && existing !== target) {
        // responseModel can be less stable than chatModel.model; do not let one
        // conflicting sample remap all future response-only records.
        return;
    }
    responseModelAliases[responseKey] = target;
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

export interface ModelSpec {
    modelId: string;
    placeholderId: string;
    displayName: string;
    apiProvider: string;
    maxTokens: number;
    maxOutputTokens: number;
    thinkingBudget: number;
    supportsThinking: boolean;
    cpLimit: number;
    cpThreshold: number;
}

let activeModelSpecs: Record<string, ModelSpec> = {
    'MODEL_PLACEHOLDER_M133': {
        modelId: 'gemini-3-flash-agent',
        placeholderId: 'MODEL_PLACEHOLDER_M133',
        displayName: 'Gemini 3.5 Flash (High)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 0,
        supportsThinking: false,
        cpLimit: 128000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M20': {
        modelId: 'gemini-3.5-flash-low',
        placeholderId: 'MODEL_PLACEHOLDER_M20',
        displayName: 'Gemini 3.5 Flash (Medium)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 0,
        supportsThinking: false,
        cpLimit: 128000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M187': {
        modelId: 'gemini-3.5-flash-extra-low',
        placeholderId: 'MODEL_PLACEHOLDER_M187',
        displayName: 'Gemini 3.5 Flash (Low)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 0,
        supportsThinking: false,
        cpLimit: 128000,
        cpThreshold: 50000,
    },
    'MODEL_UNSPECIFIED': {
        modelId: 'gemini-3.5-flash-extra-low (UNSPECIFIED)',
        placeholderId: 'MODEL_UNSPECIFIED',
        displayName: 'Gemini 3.5 Flash (Low)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 0,
        supportsThinking: false,
        cpLimit: 128000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M16': {
        modelId: 'gemini-pro-agent',
        placeholderId: 'MODEL_PLACEHOLDER_M16',
        displayName: 'Gemini 3.1 Pro (High)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65535,
        thinkingBudget: 0,
        supportsThinking: false,
        cpLimit: 128000,
        cpThreshold: 60000,
    },
    'MODEL_PLACEHOLDER_M36': {
        modelId: 'gemini-3.1-pro-low',
        placeholderId: 'MODEL_PLACEHOLDER_M36',
        displayName: 'Gemini 3.1 Pro (Low)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65535,
        thinkingBudget: 0,
        supportsThinking: false,
        cpLimit: 128000,
        cpThreshold: 60000,
    },
    'MODEL_PLACEHOLDER_M35': {
        modelId: 'claude-sonnet-4-6',
        placeholderId: 'MODEL_PLACEHOLDER_M35',
        displayName: 'Claude Sonnet 4.6 (Thinking)',
        apiProvider: 'ANTHROPIC_VERTEX',
        maxTokens: 250000,
        maxOutputTokens: 64000,
        thinkingBudget: 32000,
        supportsThinking: true,
        cpLimit: 160000,
        cpThreshold: 100000,
    },
    'MODEL_PLACEHOLDER_M26': {
        modelId: 'claude-opus-4-6-thinking',
        placeholderId: 'MODEL_PLACEHOLDER_M26',
        displayName: 'Claude Opus 4.6 (Thinking)',
        apiProvider: 'ANTHROPIC_VERTEX',
        maxTokens: 250000,
        maxOutputTokens: 64000,
        thinkingBudget: 32000,
        supportsThinking: true,
        cpLimit: 160000,
        cpThreshold: 100000,
    },
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': {
        modelId: 'gpt-oss-120b-medium',
        placeholderId: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
        displayName: 'GPT-OSS 120B (Medium)',
        apiProvider: 'OPENAI_VERTEX',
        maxTokens: 131072,
        maxOutputTokens: 32768,
        thinkingBudget: 0,
        supportsThinking: false,
        cpLimit: 80000,
        cpThreshold: 40000,
    },
};

export function updateModelSpec(placeholderId: string, spec: Partial<ModelSpec>): void {
    if (!activeModelSpecs[placeholderId]) {
        activeModelSpecs[placeholderId] = {
            modelId: spec.modelId || '',
            placeholderId,
            displayName: spec.displayName || getModelDisplayName(placeholderId),
            apiProvider: spec.apiProvider || '',
            maxTokens: spec.maxTokens || 0,
            maxOutputTokens: spec.maxOutputTokens || 0,
            thinkingBudget: spec.thinkingBudget || 0,
            supportsThinking: spec.supportsThinking || false,
            cpLimit: spec.cpLimit || 0,
            cpThreshold: spec.cpThreshold || 0,
        };
    } else {
        activeModelSpecs[placeholderId] = {
            ...activeModelSpecs[placeholderId],
            ...spec,
        };
    }
}

export function getModelSpecs(): ModelSpec[] {
    const order = [
        'MODEL_PLACEHOLDER_M133',
        'MODEL_PLACEHOLDER_M20',
        'MODEL_PLACEHOLDER_M187',
        'MODEL_UNSPECIFIED',
        'MODEL_PLACEHOLDER_M16',
        'MODEL_PLACEHOLDER_M36',
        'MODEL_PLACEHOLDER_M35',
        'MODEL_PLACEHOLDER_M26',
        'MODEL_OPENAI_GPT_OSS_120B_MEDIUM'
    ];
    const ordered: ModelSpec[] = [];
    for (const key of order) {
        if (activeModelSpecs[key]) {
            const spec = activeModelSpecs[key];
            spec.displayName = getModelDisplayName(key);
            ordered.push(spec);
        }
    }
    for (const [key, spec] of Object.entries(activeModelSpecs)) {
        if (!order.includes(key)) {
            spec.displayName = getModelDisplayName(key);
            ordered.push(spec);
        }
    }
    return ordered;
}

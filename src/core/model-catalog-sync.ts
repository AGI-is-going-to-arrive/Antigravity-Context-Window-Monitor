/**
 * Shared Pure-TypeScript Model Catalog Synchronization & Normalization Helpers.
 *
 * Strictly zero `vscode` imports and zero external npm dependencies.
 * Designed to be cleanly consumed by `src/models.ts`, `src/extension.ts`, and
 * `src/app/sidecar-runtime.ts` so both hosts parse `GetAvailableModels` payloads,
 * normalize zero-day unknown models, resolve canonical IDs, and report
 * compaction/native context-limit provenance identically.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ModelFamilyKind = 'gemini' | 'claude' | 'openai' | 'image' | 'unknown';

export type ContextLimitProvenance =
    | 'live_checkpointer'
    | 'live_catalog'
    | 'static_verified'
    | 'heuristic_guess'
    | 'custom_override'
    | 'default_fallback'
    | 'none';

export interface RawAvailableModelMetadata {
    model?: unknown;
    displayName?: unknown;
    modelId?: unknown;
    model_id?: unknown;
    apiProvider?: unknown;
    maxTokens?: unknown;
    maxOutputTokens?: unknown;
    thinkingBudget?: unknown;
    supportsThinking?: unknown;
    supportsAdaptiveThinking?: unknown;
    thinkingLevel?: unknown;
    modelExperiments?: {
        experiments?: Record<string, { stringValue?: unknown } | undefined>;
    };
}

export interface NormalizedModelSpecPatch {
    modelId: string;
    displayName?: string;
    apiProvider?: string;
    isImageGeneration?: boolean;
    thinkingCapabilityReported?: boolean;
    maxTokens?: number;
    maxOutputTokens?: number;
    thinkingBudget?: number;
    supportsThinking?: boolean;
    supportsAdaptiveThinking?: boolean;
    thinkingLevel?: number;
    executionModelId?: string;
    cpLimit?: number;
    cpThreshold?: number;
}

export interface NormalizedCatalogModelEntry {
    /** Canonical model identifier (platform placeholder ID or resolved known ID). */
    resolvedId: string;
    /** Raw catalog map key from `GetAvailableModels.models`. */
    catalogId: string;
    /** Preferred response/catalog model alias to register (`modelId || model_id || catalogId`). */
    responseModelAlias: string;
    /** Whether this model was absent from the existing registry before this sync (zero-day model). */
    isZeroDay: boolean;
    /** True when provider + maxTokens + maxOutputTokens + platform model ID are all present. */
    completeMetadata: boolean;
    /** True when the entry is an image generation model. */
    isImageGeneration: boolean;
    /** Parsed checkpointer compaction cap (`0` if absent). */
    compactionLimit: number;
    /** Parsed checkpointer compaction trigger threshold (`0` if absent). */
    compactionThreshold: number;
    /** Normalized spec patch ready for `updateModelSpec(resolvedId, specPatch)`. */
    specPatch: NormalizedModelSpecPatch;
    /** Whether `executionModelId` should be explicitly cleared (`completeMetadata && no plan-execute-config`). */
    clearExecutionModelId: boolean;
}

export interface ExistingModelSpecLike {
    placeholderId?: string;
    isImageGeneration?: boolean;
    cpLimit?: number;
    cpThreshold?: number;
    maxTokens?: number;
    displayName?: string;
}

export interface ModelCatalogSyncOptions {
    /** Resolve an existing model ID / alias / display name to its canonical placeholder ID. */
    resolveKnownModelId?: (raw: string) => string | undefined;
    /** Look up an already-registered spec by canonical placeholder ID. */
    getExistingSpec?: (resolvedId: string) => ExistingModelSpecLike | undefined;
    /** Return true if `resolvedId` is present in the live user model picker configs. */
    isInLivePicker?: (resolvedId: string) => boolean;
}

export interface ModelCatalogSyncResult {
    entries: NormalizedCatalogModelEntry[];
    contextLimitOverrides: Record<string, number>;
    imageModelIds: string[];
    hasImageModelList: boolean;
    imageMetadataSynced: boolean;
    /** True when at least one context limit override or complete image metadata sync succeeded. */
    hasEffectiveUpdates: boolean;
    diagnostics: string[];
}

export interface ModelLimitProvenanceInput {
    /** Explicit checkpointer override / live checkpointer limit (highest authority for compaction). */
    liveCheckpointerLimit?: number | null;
    liveCheckpointerThreshold?: number | null;
    /** Static verified catalog spec compaction limit (`0` indicates native-only / no compaction cap). */
    staticCompactionLimit?: number | null;
    staticCompactionThreshold?: number | null;
    /** Heuristic guess compaction limit (fallback when neither live nor static verified). */
    heuristicCompactionLimit?: number | null;
    heuristicCompactionThreshold?: number | null;
    /** Live catalog `maxTokens` (native context window). */
    liveNativeLimit?: number | null;
    /** Static verified catalog `maxTokens`. */
    staticNativeLimit?: number | null;
    /** Heuristic guess `maxTokens`. */
    heuristicNativeLimit?: number | null;
    /** Explicit user/custom limit override if supplied. */
    customCompactionOverride?: number | null;
    /** True when the model is explicitly known to be native-only (e.g. `cpLimit === 0`, image/safety models). */
    explicitNativeOnly?: boolean;
}

export interface ResolvedModelLimitsWithProvenance {
    compactionLimit: number | null;
    compactionLimitProvenance: ContextLimitProvenance;
    compactionThreshold: number | null;
    nativeLimit: number | null;
    nativeLimitProvenance: ContextLimitProvenance;
    isNativeOnly: boolean;
    limitsEqual: boolean;
}

// ─── Canonical ID & Token Limit Helpers ──────────────────────────────────────

/**
 * Whether a value has the shape of a canonical platform model identifier
 * (e.g. `MODEL_PLACEHOLDER_M532`, `MODEL_OPENAI_GPT_OSS_120B_MEDIUM`).
 * Excludes `MODEL_UNSPECIFIED` / `MODEL_PLACEHOLDER_UNSPECIFIED` sentinels.
 */
export function isPlatformModelId(value: unknown): value is string {
    if (typeof value !== 'string') { return false; }
    const clean = value.trim();
    return /^MODEL_[A-Z0-9_]+$/.test(clean) && !clean.includes('UNSPECIFIED');
}

export function isUnspecifiedModelId(value: unknown): boolean {
    if (typeof value !== 'string') { return true; }
    const clean = value.trim().toUpperCase();
    return !clean || clean === 'MODEL_UNSPECIFIED' || clean === 'MODEL_PLACEHOLDER_UNSPECIFIED';
}

/**
 * Parse a strictly positive safe integer token limit from a number or digit-only string.
 * Returns `0` for missing, zero, negative, fractional, non-finite, or malformed values.
 */
export function parsePositiveTokenLimit(value: unknown): number {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value > 0 ? value : 0;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!/^\d+$/.test(trimmed)) { return 0; }
        const parsed = Number(trimmed);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
    }
    return 0;
}

/**
 * Extract a compact diagnostic ID suffix from a platform placeholder model ID
 * (e.g. `MODEL_PLACEHOLDER_M532` -> `M532`, `MODEL_OPENAI_GPT_OSS_120B_MEDIUM` -> `OSS-120B`).
 */
export function extractModelShortId(modelId: string): string {
    const clean = (modelId || '').trim();
    const m = /^MODEL_PLACEHOLDER_(M\d+)$/.exec(clean);
    if (m) { return m[1]; }
    if (clean === 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM') { return 'OSS-120B'; }
    return '';
}

/**
 * Normalize punctuation, whitespace, and optional trailing diagnostic suffixes
 * `(M123)` / `(OSS-120B)` for canonical key comparisons.
 */
export function canonicalizeModelKey(
    raw: string,
    options: { stripDiagnosticSuffix?: boolean } = {},
): string {
    let clean = (raw || '')
        .trim()
        .replace(/（/g, '(')
        .replace(/）/g, ')')
        .replace(/\s+/g, ' ');
    if (options.stripDiagnosticSuffix) {
        clean = clean
            .replace(/\s*\(M\d+\)$/i, '')
            .replace(/\s*\(OSS-120B\)$/i, '')
            .trim();
    }
    return clean;
}

export function normalizeApiProvider(raw: unknown): string {
    if (typeof raw !== 'string') { return ''; }
    return raw.trim().replace(/^API_PROVIDER_/i, '');
}

// ─── Zero-Day Unknown Model Normalization ────────────────────────────────────

const BRAND_TOKEN_MAP: Readonly<Record<string, string>> = Object.freeze({
    gemini: 'Gemini',
    claude: 'Claude',
    opus: 'Opus',
    sonnet: 'Sonnet',
    haiku: 'Haiku',
    gpt: 'GPT',
    oss: 'OSS',
    pro: 'Pro',
    flash: 'Flash',
    lite: 'Lite',
    ultra: 'Ultra',
    nano: 'Nano',
    neon: 'Neon',
    hydrogen: 'Hydrogen',
    carbon: 'Carbon',
    argon: 'Argon',
    imagen: 'Imagen',
    veo: 'Veo',
    thinking: 'Thinking',
    orchestrator: 'Orchestrator',
    coordinator: 'Coordinator',
    worker: 'Worker',
});

const EFFORT_LABEL_MAP: Readonly<Record<string, string>> = Object.freeze({
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'XHigh',
    'extra-high': 'Extra High',
    extra_high: 'Extra High',
    max: 'Max',
});

/**
 * Extract trailing effort suffix from a model catalog slug (e.g. `gemini-5-nova-xhigh` -> `'XHigh'`).
 */
export function extractModelEffortLabel(rawId: string): string | null {
    const clean = (rawId || '').trim().toLowerCase();
    const match = /[-_\s](extra[-_]high|xhigh|high|medium|low|max)$/i.exec(clean);
    if (!match) { return null; }
    return EFFORT_LABEL_MAP[match[1].toLowerCase()] ?? null;
}

/**
 * Infer broad provider/family classification for a zero-day unknown model from
 * its catalog slug and/or `apiProvider`.
 */
export function inferZeroDayModelFamily(
    modelId: string,
    apiProvider?: string,
    isImageGeneration = false,
): ModelFamilyKind {
    if (isImageGeneration) { return 'image'; }
    const idLower = (modelId || '').trim().toLowerCase();
    const providerUpper = normalizeApiProvider(apiProvider).toUpperCase();

    if (idLower.includes('imagen') || idLower.includes('image-gen') || idLower.includes('nano-banana')) {
        return 'image';
    }
    if (idLower.includes('claude') || idLower.includes('opus') || idLower.includes('sonnet') || idLower.includes('haiku')) {
        return 'claude';
    }
    if (idLower.includes('gemini')) {
        return 'gemini';
    }
    if (idLower.includes('gpt') || idLower.includes('openai')) {
        return 'openai';
    }
    if (providerUpper.includes('ANTHROPIC')) { return 'claude'; }
    if (providerUpper.includes('GEMINI') || providerUpper.includes('GOOGLE')) { return 'gemini'; }
    if (providerUpper.includes('OPENAI')) { return 'openai'; }
    return 'unknown';
}

/**
 * Gracefully humanize a zero-day unknown model identifier into a readable display label
 * while preserving explicit live display names whenever provided.
 *
 * Examples:
 * - `('MODEL_PLACEHOLDER_M999', 'Gemini 5 Nova (High)')` -> `'Gemini 5 Nova (High)'`
 * - `('gemini-5-nova-xhigh')` -> `'Gemini 5 Nova (XHigh)'`
 * - `('claude-opus-6-0-medium')` -> `'Claude Opus 6.0 (Medium)'`
 * - `('gpt-oss-240b-high')` -> `'GPT-OSS 240B (High)'`
 * - `('MODEL_PLACEHOLDER_M999')` -> `'Model M999'`
 */
export function normalizeZeroDayModelDisplayName(
    rawId: string,
    explicitDisplayName?: string | null,
): string {
    const explicit = typeof explicitDisplayName === 'string' ? explicitDisplayName.trim() : '';
    if (explicit && !isPlatformModelId(explicit) && !isUnspecifiedModelId(explicit)) {
        return explicit;
    }

    const clean = (rawId || '').trim();
    if (!clean || isUnspecifiedModelId(clean)) {
        return 'Unknown Model';
    }

    const placeholderMatch = /^MODEL_PLACEHOLDER_(M\d+)$/i.exec(clean);
    if (placeholderMatch) {
        return `Model ${placeholderMatch[1].toUpperCase()}`;
    }

    // Strip MODEL_<PROVIDER>_ prefix on constant-style identifiers
    let working = clean.replace(/^MODEL_(?:GOOGLE_|ANTHROPIC_|OPENAI_)?/i, '');

    // Extract optional trailing effort suffix
    let effortLabel: string | null = null;
    const effortMatch = /[-_\s](extra[-_]high|xhigh|high|medium|low|max)$/i.exec(working);
    if (effortMatch) {
        effortLabel = EFFORT_LABEL_MAP[effortMatch[1].toLowerCase()] ?? null;
        working = working.slice(0, effortMatch.index);
    }

    // Rejoin major-minor version pairs like `claude-opus-6-0` -> `claude-opus-6.0`
    working = working.replace(/(^|[-_\s])(\d+)[-_](\d+)(?=$|[-_\s])/g, '$1$2.$3');

    const rawTokens = working.split(/[-_\s]+/).filter(Boolean);
    const formattedTokens: string[] = [];

    for (let i = 0; i < rawTokens.length; i++) {
        const token = rawTokens[i];
        const lower = token.toLowerCase();
        // Join "GPT" + "OSS" as "GPT-OSS"
        if (lower === 'gpt' && i + 1 < rawTokens.length && rawTokens[i + 1].toLowerCase() === 'oss') {
            formattedTokens.push('GPT-OSS');
            i++;
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(BRAND_TOKEN_MAP, lower)) {
            formattedTokens.push(BRAND_TOKEN_MAP[lower]);
            continue;
        }
        // Parameter size suffixes like `120b` -> `120B`
        if (/^\d+(?:\.\d+)?[bmk]$/i.test(token)) {
            formattedTokens.push(token.toUpperCase());
            continue;
        }
        // Version numbers remain verbatim
        if (/^\d+(?:\.\d+)*$/.test(token)) {
            formattedTokens.push(token);
            continue;
        }
        formattedTokens.push(token.charAt(0).toUpperCase() + token.slice(1).toLowerCase());
    }

    const base = formattedTokens.join(' ').trim() || clean;
    return effortLabel ? `${base} (${effortLabel})` : base;
}

// ─── Live `GetAvailableModels` Catalog Sync Parser ───────────────────────────

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Pure parser for `GetAvailableModels` LS RPC payloads.
 * Produces deterministic spec patches, checkpointer context-limit overrides,
 * image-model lists, and zero-day model normalization without mutating global state.
 */
export function parseAvailableModelsSyncPayload(
    resp: unknown,
    options: ModelCatalogSyncOptions = {},
): ModelCatalogSyncResult {
    const empty: ModelCatalogSyncResult = {
        entries: [],
        contextLimitOverrides: {},
        imageModelIds: [],
        hasImageModelList: false,
        imageMetadataSynced: false,
        hasEffectiveUpdates: false,
        diagnostics: [],
    };

    if (!isPlainRecord(resp)) {
        return empty;
    }

    const nestedResp = isPlainRecord(resp.response) ? resp.response : undefined;
    const rawModels = (nestedResp && isPlainRecord(nestedResp.models) ? nestedResp.models : undefined)
        ?? (isPlainRecord(resp.models) ? resp.models : undefined);

    const rawImageIds = nestedResp?.imageGenerationModelIds ?? resp.imageGenerationModelIds;
    const hasImageModelList = Array.isArray(rawImageIds) && rawImageIds.every((id) => typeof id === 'string');
    const imageIdSet = new Set<string>(
        hasImageModelList ? (rawImageIds as string[]).map((id) => id.trim()).filter(Boolean) : [],
    );

    if (!rawModels) {
        return {
            ...empty,
            imageModelIds: [...imageIdSet],
            hasImageModelList,
        };
    }

    const entries: NormalizedCatalogModelEntry[] = [];
    const contextLimitOverrides: Record<string, number> = {};
    const diagnostics: string[] = [];
    let imageMetadataSynced = false;

    for (const [catalogId, rawEntry] of Object.entries(rawModels)) {
        if (!isPlainRecord(rawEntry)) { continue; }
        const c = rawEntry as RawAvailableModelMetadata;

        const modelVal = typeof c.model === 'string' ? c.model.trim() : '';
        const modelIdVal = (typeof c.modelId === 'string' && c.modelId.trim())
            || (typeof c.model_id === 'string' && c.model_id.trim())
            || catalogId.trim();

        if (!modelVal && !modelIdVal) { continue; }

        const resolved = (isPlatformModelId(modelVal) ? modelVal : undefined)
            || (modelVal && options.resolveKnownModelId ? options.resolveKnownModelId(modelVal) : undefined)
            || (modelIdVal && options.resolveKnownModelId ? options.resolveKnownModelId(modelIdVal) : undefined);

        const exps = isPlainRecord(c.modelExperiments?.experiments)
            ? (c.modelExperiments!.experiments as Record<string, { stringValue?: unknown } | undefined>)
            : {};

        const checkpointerRaw = exps.CASCADE_USE_EXPERIMENT_CHECKPOINTER?.stringValue;
        const checkpointerStr = typeof checkpointerRaw === 'string' ? checkpointerRaw : '';
        let compactionLimit = 0;
        let compactionThreshold = 0;

        if (checkpointerStr) {
            diagnostics.push(`[${modelIdVal || modelVal}] Exp JSON: ${checkpointerStr}`);
            try {
                const cp = JSON.parse(checkpointerStr) as Record<string, unknown>;
                if (isPlainRecord(cp)) {
                    compactionLimit = parsePositiveTokenLimit(cp.max_token_limit ?? cp.max_limit);
                    compactionThreshold = parsePositiveTokenLimit(cp.token_threshold ?? cp.threshold);
                    if (compactionLimit > 0) {
                        const resolvedKey = resolved || modelVal || modelIdVal;
                        if (resolvedKey) { contextLimitOverrides[resolvedKey] = compactionLimit; }
                        if (modelVal) { contextLimitOverrides[modelVal] = compactionLimit; }
                        if (modelIdVal) { contextLimitOverrides[modelIdVal] = compactionLimit; }
                    }
                }
            } catch {
                diagnostics.push(`[${modelIdVal || modelVal}] Exp JSON parse error`);
            }
        } else {
            diagnostics.push(`[${modelIdVal || modelVal}] Exp JSON: undefined (No active checkpointer experiment)`);
        }

        const previousSpec = resolved && options.getExistingSpec
            ? options.getExistingSpec(resolved)
            : undefined;
        const alreadyRegistered = !!previousSpec;
        const isImageGeneration = imageIdSet.has(catalogId)
            || imageIdSet.has(modelIdVal)
            || !!previousSpec?.isImageGeneration;
        const inLivePicker = !!resolved && !!options.isInLivePicker?.(resolved);
        const maxTokens = parsePositiveTokenLimit(c.maxTokens);
        const maxOutputTokens = parsePositiveTokenLimit(c.maxOutputTokens);
        const describesARealModel = (compactionLimit > 0 || isImageGeneration) && maxTokens > 0;

        if (!resolved || (!alreadyRegistered && !inLivePicker && !describesARealModel)) {
            continue;
        }

        const provider = normalizeApiProvider(c.apiProvider);
        const completeMetadata = isPlatformModelId(modelVal)
            && !!provider
            && maxTokens > 0
            && maxOutputTokens > 0;

        const planExecute = exps['plan-execute-config'];
        let executionModelId: string | undefined;
        let clearExecutionModelId = false;

        if (typeof planExecute?.stringValue === 'string') {
            try {
                const parsed: unknown = JSON.parse(planExecute.stringValue);
                if (isPlainRecord(parsed)) {
                    const candidate = parsed.executionModel;
                    if (
                        typeof candidate === 'string'
                        && isPlatformModelId(candidate)
                        && candidate === candidate.trim()
                        && candidate !== resolved
                    ) {
                        executionModelId = candidate;
                    }
                }
            } catch {
                // Preserve last known route on malformed plan-execute metadata
            }
        } else if (completeMetadata && planExecute === undefined) {
            clearExecutionModelId = true;
        }

        const explicitDisplayName = typeof c.displayName === 'string' && c.displayName.trim()
            ? c.displayName.trim()
            : undefined;
        const isZeroDay = !alreadyRegistered;
        const resolvedDisplayName = explicitDisplayName
            ?? (isZeroDay ? normalizeZeroDayModelDisplayName(modelIdVal || resolved) : undefined);

        const specPatch: NormalizedModelSpecPatch = {
            modelId: modelIdVal || modelVal,
            ...(resolvedDisplayName ? { displayName: resolvedDisplayName } : {}),
            ...(isImageGeneration
                ? {
                    isImageGeneration: true,
                    thinkingCapabilityReported: typeof c.supportsThinking === 'boolean',
                }
                : {}),
            ...(provider ? { apiProvider: provider } : {}),
            ...(maxTokens > 0 ? { maxTokens } : {}),
            ...(maxOutputTokens > 0 ? { maxOutputTokens } : {}),
            ...(typeof c.thinkingBudget === 'number' && Number.isFinite(c.thinkingBudget)
                ? { thinkingBudget: c.thinkingBudget }
                : (completeMetadata && c.thinkingBudget === undefined ? { thinkingBudget: 0 } : {})),
            ...(typeof c.supportsThinking === 'boolean'
                ? { supportsThinking: c.supportsThinking }
                : (completeMetadata && c.supportsThinking === undefined ? { supportsThinking: false } : {})),
            ...(typeof c.supportsAdaptiveThinking === 'boolean'
                ? { supportsAdaptiveThinking: c.supportsAdaptiveThinking }
                : (completeMetadata && c.supportsAdaptiveThinking === undefined ? { supportsAdaptiveThinking: false } : {})),
            ...(typeof c.thinkingLevel === 'number' && Number.isSafeInteger(c.thinkingLevel) && c.thinkingLevel >= 0
                ? { thinkingLevel: c.thinkingLevel }
                : (completeMetadata && c.thinkingLevel === undefined ? { thinkingLevel: 0 } : {})),
            ...(executionModelId !== undefined ? { executionModelId } : {}),
            ...(clearExecutionModelId ? { executionModelId: undefined } : {}),
            ...(compactionLimit > 0 ? { cpLimit: compactionLimit } : {}),
            ...(compactionThreshold > 0 ? { cpThreshold: compactionThreshold } : {}),
            ...(isImageGeneration && completeMetadata && !checkpointerStr ? { cpLimit: 0, cpThreshold: 0 } : {}),
        };

        if (isImageGeneration && completeMetadata) {
            imageMetadataSynced = true;
        }

        entries.push({
            resolvedId: resolved,
            catalogId,
            responseModelAlias: modelIdVal || modelVal,
            isZeroDay,
            completeMetadata,
            isImageGeneration,
            compactionLimit,
            compactionThreshold,
            specPatch,
            clearExecutionModelId,
        });
    }

    const hasEffectiveUpdates = Object.keys(contextLimitOverrides).length > 0 || imageMetadataSynced;

    return {
        entries,
        contextLimitOverrides,
        imageModelIds: [...imageIdSet],
        hasImageModelList,
        imageMetadataSynced,
        hasEffectiveUpdates,
        diagnostics,
    };
}

// ─── Compaction & Native Limit Provenance Resolution ─────────────────────────

function positiveLimitOrNull(value: unknown): number | null {
    const parsed = parsePositiveTokenLimit(value);
    return parsed > 0 ? parsed : null;
}

/**
 * Resolve both compaction limit and native context limit along with their
 * explicit provenance tags (`live_checkpointer`, `live_catalog`, `static_verified`,
 * `heuristic_guess`, `custom_override`, or `none`).
 *
 * Strictly avoids fabricating a fake compaction limit for native-only or zero-day
 * unknown models (`compactionLimit: null`, `compactionLimitProvenance: 'none'`).
 */
export function resolveModelLimitsWithProvenance(
    input: ModelLimitProvenanceInput,
): ResolvedModelLimitsWithProvenance {
    // 1. Native limit resolution
    let nativeLimit: number | null = null;
    let nativeLimitProvenance: ContextLimitProvenance = 'none';

    const liveNative = positiveLimitOrNull(input.liveNativeLimit);
    const staticNative = positiveLimitOrNull(input.staticNativeLimit);
    const heuristicNative = positiveLimitOrNull(input.heuristicNativeLimit);

    if (liveNative !== null) {
        nativeLimit = liveNative;
        nativeLimitProvenance = 'live_catalog';
    } else if (staticNative !== null) {
        nativeLimit = staticNative;
        nativeLimitProvenance = 'static_verified';
    } else if (heuristicNative !== null) {
        nativeLimit = heuristicNative;
        nativeLimitProvenance = 'heuristic_guess';
    }

    // 2. Compaction limit resolution
    let compactionLimit: number | null = null;
    let compactionLimitProvenance: ContextLimitProvenance = 'none';
    let compactionThreshold: number | null = null;

    const customCp = positiveLimitOrNull(input.customCompactionOverride);
    const liveCp = positiveLimitOrNull(input.liveCheckpointerLimit);
    const staticCp = positiveLimitOrNull(input.staticCompactionLimit);
    const heuristicCp = positiveLimitOrNull(input.heuristicCompactionLimit);

    if (customCp !== null) {
        compactionLimit = customCp;
        compactionLimitProvenance = 'custom_override';
        compactionThreshold = positiveLimitOrNull(input.liveCheckpointerThreshold)
            ?? positiveLimitOrNull(input.staticCompactionThreshold)
            ?? positiveLimitOrNull(input.heuristicCompactionThreshold);
    } else if (liveCp !== null) {
        compactionLimit = liveCp;
        compactionLimitProvenance = 'live_checkpointer';
        compactionThreshold = positiveLimitOrNull(input.liveCheckpointerThreshold)
            ?? positiveLimitOrNull(input.staticCompactionThreshold);
    } else if (input.explicitNativeOnly || input.staticCompactionLimit === 0) {
        compactionLimit = null;
        compactionLimitProvenance = 'none';
        compactionThreshold = null;
    } else if (staticCp !== null) {
        compactionLimit = staticCp;
        compactionLimitProvenance = 'static_verified';
        compactionThreshold = positiveLimitOrNull(input.staticCompactionThreshold);
    } else if (heuristicCp !== null) {
        compactionLimit = heuristicCp;
        compactionLimitProvenance = 'heuristic_guess';
        compactionThreshold = positiveLimitOrNull(input.heuristicCompactionThreshold);
    }

    const isNativeOnly = compactionLimit === null && nativeLimit !== null;
    const limitsEqual = compactionLimit !== null && nativeLimit !== null && compactionLimit === nativeLimit;

    return {
        compactionLimit,
        compactionLimitProvenance,
        compactionThreshold,
        nativeLimit,
        nativeLimitProvenance,
        isNativeOnly,
        limitsEqual,
    };
}

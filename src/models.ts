// ─── Model Context Limits & Display Names ────────────────────────────────────
// Extracted from tracker.ts for single-responsibility.
//
// Model display names are populated dynamically from the LS GetUserStatus API
// (`cascadeModelConfigData.clientModelConfigs[].label`). Static names provide
// cold-start and archived-data fallbacks; live labels remain authoritative.
//
// Static limits cover startup before GetAvailableModels metadata arrives; known
// quota pools supplement the catalog's provider metadata.

/** External model identifiers must never read inherited Object prototype members. */
function ownValue<T>(table: Record<string, T>, key: string): T | undefined {
    return Object.hasOwn(table, key) ? table[key] : undefined;
}

// Optional effort must be separated or enclosed in a complete pair of parentheses.
const HYDROGEN_NAME_PATTERN = /^gemini[\s_-]+4[\s_-]+(hydrogen)(?:[\s_-]+(low|medium|high|xhigh|extra(?:[\s_-]+high)?|低|中|高|超高|极高)|[\s_-]*\(\s*(low|medium|high|xhigh|extra(?:[\s_-]+high)?|低|中|高|超高|极高)\s*\))?$/i;
const GEMINI_4_NAME_PATTERN = /^gemini[\s_-]+4[\s_-]+(carbon|argon)(?:[\s_-]+(low|medium|high|低|中|高)|[\s_-]*\(\s*(low|medium|high|低|中|高)\s*\))?$/i;

/** Named coordinators are separate identities, not Carbon/Argon effort tiers. */
function resolveOrchestratorAlias(value: string): string | undefined {
    const name = value.trim().replace(/（/g, '(').replace(/）/g, ')');
    if (/^(?:orchestrator|编排器|协调器)(?:[\s_-]+carbon|\s*\(\s*carbon\s*\))?$|^gemini[-_ ]pro[-_ ]orchestrator$/i.test(name)) {
        return 'MODEL_PLACEHOLDER_M667';
    }
    if (/^(?:orchestrator|编排器|协调器)(?:[\s_-]+argon|\s*\(\s*argon\s*\))$|^gemini[-_ ]pro[-_ ]orchestrator[-_ ]argon$/i.test(name)) {
        return 'MODEL_PLACEHOLDER_M681';
    }
    return undefined;
}

// ─── Default Context Limits ──────────────────────────────────────────────────

export const DEFAULT_CONTEXT_LIMITS: Record<string, number> = {
    // Orchestrator coordinator and delegated worker, live IDE 2026-11-13.
    MODEL_PLACEHOLDER_M667: 255_000,
    MODEL_PLACEHOLDER_M681: 255_000,
    MODEL_PLACEHOLDER_M669: 255_000,
    // ── Platform truncation thresholds (from GM plannerConfig.truncationThresholdTokens) ──
    // These are the ACTUAL context window limits enforced by the platform,
    // NOT the model's native context window size.
    // Verified via diag-scripts/my-tools/extra/all-models-deep-miner.ts (2026-05-19);
    // Gemini 3.6 Flash tiers + 3.5 Flash checkpointer bump verified via live LS probe (2026-07-22);
    // Gemini 3.8 Flash tiers verified against two live Antigravity IDE LS instances (2026-09-05).
    // Gemini 3.7 Flash tiers + the 3.6 Flash renumber verified via live LS probe (2026-08-14).
    // Note: All fallback limits are intentionally offset by -1,000 (1K) so that in daily use,
    // you can instantly recognize if the extension has successfully overridden the fallback with live captures.
    // Gemini 4 Hydrogen verified via the installed IDE agent hub, 2026-11-13.
    'MODEL_PLACEHOLDER_M525': 255_000,  // High — live compression limit: 256,000
    'MODEL_PLACEHOLDER_M526': 255_000,  // Medium
    'MODEL_PLACEHOLDER_M527': 255_000,  // Low
    'MODEL_PLACEHOLDER_M528': 255_000,  // XHigh (Extra in the IDE picker)
    // Gemini 4 Carbon verified via the installed IDE agent hub, 2026-11-11.
    'MODEL_PLACEHOLDER_M427': 255_000,  // High — live compression limit: 256,000
    'MODEL_PLACEHOLDER_M437': 255_000,  // Medium
    'MODEL_PLACEHOLDER_M438': 255_000,  // Low
    // Gemini 4 Argon verified via the installed IDE agent hub, 2026-10-31.
    'MODEL_PLACEHOLDER_M417': 255_000,  // High — live compression limit: 256,000
    'MODEL_PLACEHOLDER_M418': 255_000,  // Medium
    'MODEL_PLACEHOLDER_M419': 255_000,  // Low
    'MODEL_PLACEHOLDER_M318': 255_000,  // Gemini 3.8 Flash (High) — fallback offset by -1K (live: 256,000)
    'MODEL_PLACEHOLDER_M319': 255_000,  // Gemini 3.8 Flash (Medium) — fallback offset by -1K (live: 256,000)
    'MODEL_PLACEHOLDER_M320': 255_000,  // Gemini 3.8 Flash (Low) — fallback offset by -1K (live: 256,000)
    'MODEL_PLACEHOLDER_M322': 255_000,  // Gemini 3.8 Flash (Tiered, catalog-only) — fallback offset by -1K (live: 256,000)
    'MODEL_PLACEHOLDER_M298': 255_000,  // Gemini 3.7 Flash (High) — fallback offset by -1K (live: 256,000)
    'MODEL_PLACEHOLDER_M299': 255_000,  // Gemini 3.7 Flash (Medium) — fallback offset by -1K (live: 256,000)
    'MODEL_PLACEHOLDER_M300': 255_000,  // Gemini 3.7 Flash (Low) — fallback offset by -1K (live: 256,000)
    'MODEL_PLACEHOLDER_M71': 255_000,   // Gemini 3.6 Flash (High) — fallback offset by -1K (live: 256,000)
    'MODEL_PLACEHOLDER_M72': 255_000,   // Gemini 3.6 Flash (Medium) — fallback offset by -1K (live: 256,000)
    'MODEL_PLACEHOLDER_M73': 255_000,   // Gemini 3.6 Flash (Low) — fallback offset by -1K (live: 256,000)
    'MODEL_PLACEHOLDER_M264': 255_000,  // [Retired] Gemini 3.6 Flash (High) — renumbered to M71 (2026-08 live); kept for archived-data parsing
    'MODEL_PLACEHOLDER_M265': 255_000,  // [Retired] Gemini 3.6 Flash (Medium) — renumbered to M72 (2026-08 live); kept for archived-data parsing
    'MODEL_PLACEHOLDER_M266': 255_000,  // [Retired] Gemini 3.6 Flash (Low) — renumbered to M73 (2026-08 live); kept for archived-data parsing
    'MODEL_PLACEHOLDER_M196': 255_000,  // Gemini 3.6 Flash (Tiered, catalog-only) — fallback offset by -1K (live: 256,000)
    'MODEL_PLACEHOLDER_M16': 127_000,   // Gemini 3.1 Pro (High) — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M37': 127_000,   // [Legacy] Gemini 3.1 Pro (High) — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M36': 127_000,   // Gemini 3.1 Pro (Low)  — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M84': 255_000,   // Gemini 3.5 Flash (High) — 2026-07 live doubled to 256,000 (M84 took over 3.5F High identity)
    'MODEL_PLACEHOLDER_M20': 255_000,   // Gemini 3.5 Flash (Medium) — 2026-07 live doubled to 256,000
    'MODEL_PLACEHOLDER_M187': 255_000,  // Gemini 3.5 Flash (Low) — 2026-07 live doubled to 256,000
    'MODEL_PLACEHOLDER_M133': 127_000,  // [Retired] Gemini 3.5 Flash (High) — predecessor of M84; retained for archived-data parsing
    'MODEL_PLACEHOLDER_M132': 127_000,  // [Retired] Gemini 3.5 Flash (High) — predecessor of M84; retained for archived-data parsing
    'MODEL_PLACEHOLDER_M47': 127_000,   // [Legacy] Gemini 3 Flash (older ID) — fallback offset by -1K (live: 128,000)
    'MODEL_PLACEHOLDER_M18': 127_000,   // Gemini 3 Flash (catalog-only, not in picker) — fallback offset by -1K (live 2026-08: 128,000)
    'MODEL_PLACEHOLDER_M400': 255_000,  // Claude Opus 5.5 (Low) — live LS 2026-10-03: 256,000
    'MODEL_PLACEHOLDER_M401': 255_000,  // Claude Opus 5.5 (Medium)
    'MODEL_PLACEHOLDER_M402': 255_000,  // Claude Opus 5.5 (High)
    'MODEL_PLACEHOLDER_M403': 255_000,  // Claude Sonnet 5.5 (Low)
    'MODEL_PLACEHOLDER_M404': 255_000,  // Claude Sonnet 5.5 (Medium)
    'MODEL_PLACEHOLDER_M405': 255_000,  // Claude Sonnet 5.5 (High)
    'MODEL_PLACEHOLDER_M35': 159_000,   // Claude Sonnet 4.6 (Thinking) — fallback offset by -1K (live: 160,000)
    'MODEL_PLACEHOLDER_M26': 159_000,   // Claude Opus 4.6 (Thinking)  — fallback offset by -1K (live: 160,000)
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 79_000,   // GPT-OSS 120B (Medium) — fallback offset by -1K (live: 80,000)
};

export const DEFAULT_CONTEXT_LIMIT = 159_000;

// ─── Model Display Names ─────────────────────────────────────────────────────
// Starts empty — populated dynamically by `updateModelDisplayNames()` from
// the LS GetUserStatus API. Static fallbacks below also resolve archived records.

let modelDisplayNames: Record<string, string> = {};
/** responseModel -> placeholder ID reverse map (populated from GM data).
 *  Pre-seeded with known stable aliases so findPricing works before fetchAll.
 *  Source: GetAvailableModels API (all_models_parameter_map.md 2026-05-22) */
let responseModelAliases: Record<string, string> = {
    'gemini-pro-orchestrator': 'MODEL_PLACEHOLDER_M667',
    'gemini-pro-orchestrator-argon': 'MODEL_PLACEHOLDER_M681',
    'gemini-flash-worker-agy': 'MODEL_PLACEHOLDER_M669',
    // Dedicated image model, verified from imageGenerationModelIds (2026-10-31).
    'gemini-3.1-flash-image': 'MODEL_PLACEHOLDER_M21',
    // Gemini 4 Hydrogen aliases (live GetUserStatus + GetAvailableModels, 2026-11-13).
    'gemini-4-hydrogen-high': 'MODEL_PLACEHOLDER_M525',
    'gemini-4-hydrogen-medium': 'MODEL_PLACEHOLDER_M526',
    'gemini-4-hydrogen-low': 'MODEL_PLACEHOLDER_M527',
    'gemini-4-hydrogen-xhigh': 'MODEL_PLACEHOLDER_M528',
    // Gemini 4 Carbon aliases (live GetUserStatus + GetAvailableModels, 2026-11-11).
    'gemini-4-carbon-high': 'MODEL_PLACEHOLDER_M427',
    'gemini-4-carbon-medium': 'MODEL_PLACEHOLDER_M437',
    'gemini-4-carbon-low': 'MODEL_PLACEHOLDER_M438',
    // Gemini 4 Argon aliases (live GetUserStatus + GetAvailableModels, 2026-10-31).
    'gemini-4-argon-high': 'MODEL_PLACEHOLDER_M417',
    'gemini-4-argon-medium': 'MODEL_PLACEHOLDER_M418',
    'gemini-4-argon-low': 'MODEL_PLACEHOLDER_M419',
    // Gemini Pro aliases
    'gemini-pro-default': 'MODEL_PLACEHOLDER_M16',       // legacy responseModel for M16
    'gemini-pro-agent': 'MODEL_PLACEHOLDER_M16',          // current model_id for M16
    'gemini-3.1-pro-high': 'MODEL_PLACEHOLDER_M37',       // model_id for M37
    'gemini-3.1-pro-low': 'MODEL_PLACEHOLDER_M36',        // model_id for M36
    // Gemini Flash aliases
    'gemini-3-flash-a': 'MODEL_PLACEHOLDER_M132',          // [Retired] legacy responseModel — kept for persisted-data parsing
    'gemini-3-flash-agent': 'MODEL_PLACEHOLDER_M84',      // model_id for M84 (3.5 Flash High) — took over this key from M133 (2026-07 live)
    'gemini-3-flash-b': 'MODEL_PLACEHOLDER_M133',          // [Retired] responseModel alias for M133 — kept for persisted-data parsing
    'gemini-3.5-flash-low': 'MODEL_PLACEHOLDER_M20',      // model_id for M20 (3.5 Flash Medium)
    'gemini-3-flash': 'MODEL_PLACEHOLDER_M18',             // backend command model
    // Gemini 3.8 Flash aliases (two live Antigravity IDE LS instances, 2026-09-05; M318 is the platform default)
    'gemini-3.8-flash-high': 'MODEL_PLACEHOLDER_M318',    // model_id for M318
    'gemini-3.8-flash-medium': 'MODEL_PLACEHOLDER_M319',  // model_id for M319
    'gemini-3.8-flash-low': 'MODEL_PLACEHOLDER_M320',     // model_id for M320
    'gemini-3.8-flash-tiered': 'MODEL_PLACEHOLDER_M322',  // catalog-only tiered router
    // Gemini 3.7 Flash aliases (live LS probe 2026-08-14: M298/M299/M300 picker, M298 is the platform default)
    'gemini-3.7-flash-high': 'MODEL_PLACEHOLDER_M298',    // model_id for M298
    'gemini-3.7-flash-medium': 'MODEL_PLACEHOLDER_M299',  // model_id for M299
    'gemini-3.7-flash-low': 'MODEL_PLACEHOLDER_M300',     // model_id for M300
    // Gemini 3.6 Flash aliases — the platform RENUMBERED these from M264/M265/M266 to M71/M72/M73
    // (live LS probe 2026-08-14, cross-checked against two language-server instances). The alias must
    // point at the ACTIVE ID so freshly captured GM records land on the live spec; the old IDs survive
    // only as retired display-name fallbacks for archived data (see RETIRED_PLACEHOLDER_IDS).
    'gemini-3.6-flash-high': 'MODEL_PLACEHOLDER_M71',     // model_id for M71 (was M264 before the renumber)
    'gemini-3.6-flash-medium': 'MODEL_PLACEHOLDER_M72',   // model_id for M72 (was M265 before the renumber)
    'gemini-3.6-flash-low': 'MODEL_PLACEHOLDER_M73',      // model_id for M73 (was M266 before the renumber)
    'gemini-3.6-flash-tiered': 'MODEL_PLACEHOLDER_M196',  // catalog-only tiered router
    // Claude aliases
    'claude-opus-5-5-low': 'MODEL_PLACEHOLDER_M400',
    'claude-opus-5-5-medium': 'MODEL_PLACEHOLDER_M401',
    'claude-opus-5-5-high': 'MODEL_PLACEHOLDER_M402',
    'claude-sonnet-5-5-low': 'MODEL_PLACEHOLDER_M403',
    'claude-sonnet-5-5-medium': 'MODEL_PLACEHOLDER_M404',
    'claude-sonnet-5-5-high': 'MODEL_PLACEHOLDER_M405',
    'claude-opus-4-6-thinking': 'MODEL_PLACEHOLDER_M26',  // model_id for Opus
    'claude-sonnet-4-6': 'MODEL_PLACEHOLDER_M35',          // model_id for Sonnet
    // GPT-OSS
    'gpt-oss-120b-medium': 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
};
/** Whether to append diagnostic short ID suffix (e.g. "(M16)") to display names. */
let showModelShortId = false;

const KNOWN_QUOTA_POOLS: Record<string, string> = {
    // Orchestrator and its delegated worker consume the Gemini family allowance.
    MODEL_PLACEHOLDER_M667: 'gemini',
    MODEL_PLACEHOLDER_M681: 'gemini',
    MODEL_PLACEHOLDER_M669: 'gemini',
    // Gemini pool — Hydrogen, Carbon, Argon, Flash and Pro use the Google provider pool.
    'MODEL_PLACEHOLDER_M525': 'gemini',
    'MODEL_PLACEHOLDER_M526': 'gemini',
    'MODEL_PLACEHOLDER_M527': 'gemini',
    'MODEL_PLACEHOLDER_M528': 'gemini',
    'MODEL_PLACEHOLDER_M427': 'gemini',
    'MODEL_PLACEHOLDER_M437': 'gemini',
    'MODEL_PLACEHOLDER_M438': 'gemini',
    'MODEL_PLACEHOLDER_M417': 'gemini',
    'MODEL_PLACEHOLDER_M418': 'gemini',
    'MODEL_PLACEHOLDER_M419': 'gemini',
    'MODEL_PLACEHOLDER_M16': 'gemini',
    'MODEL_PLACEHOLDER_M318': 'gemini',   // Gemini 3.8 Flash (High)
    'MODEL_PLACEHOLDER_M319': 'gemini',   // Gemini 3.8 Flash (Medium)
    'MODEL_PLACEHOLDER_M320': 'gemini',   // Gemini 3.8 Flash (Low)
    'MODEL_PLACEHOLDER_M322': 'gemini',   // Gemini 3.8 Flash (Tiered, catalog-only)
    'MODEL_PLACEHOLDER_M298': 'gemini',   // Gemini 3.7 Flash (High)
    'MODEL_PLACEHOLDER_M299': 'gemini',   // Gemini 3.7 Flash (Medium)
    'MODEL_PLACEHOLDER_M300': 'gemini',   // Gemini 3.7 Flash (Low)
    'MODEL_PLACEHOLDER_M71': 'gemini',    // Gemini 3.6 Flash (High)
    'MODEL_PLACEHOLDER_M72': 'gemini',    // Gemini 3.6 Flash (Medium)
    'MODEL_PLACEHOLDER_M73': 'gemini',    // Gemini 3.6 Flash (Low)
    'MODEL_PLACEHOLDER_M264': 'gemini',   // [Retired] Gemini 3.6 Flash (High) — pre-renumber, still pools with gemini for archived data
    'MODEL_PLACEHOLDER_M265': 'gemini',   // [Retired] Gemini 3.6 Flash (Medium) — pre-renumber
    'MODEL_PLACEHOLDER_M266': 'gemini',   // [Retired] Gemini 3.6 Flash (Low) — pre-renumber
    'MODEL_PLACEHOLDER_M196': 'gemini',   // Gemini 3.6 Flash (Tiered, catalog-only)
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
    'MODEL_PLACEHOLDER_M400': 'premium',
    'MODEL_PLACEHOLDER_M401': 'premium',
    'MODEL_PLACEHOLDER_M402': 'premium',
    'MODEL_PLACEHOLDER_M403': 'premium',
    'MODEL_PLACEHOLDER_M404': 'premium',
    'MODEL_PLACEHOLDER_M405': 'premium',
    'MODEL_PLACEHOLDER_M35': 'premium',
    'MODEL_PLACEHOLDER_M26': 'premium',
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 'premium',
};

// ─── Chinese Model Name Aliases ──────────────────────────────────────────────
// Persisted data and older UI surfaces may contain localized Chinese tier labels.
// Resolve them back to canonical IDs so pricing, quota pooling, and archival agree.

const ZH_MODEL_NAME_ALIASES: Record<string, string> = {
    'Gemini 3.8 Flash (高)': 'MODEL_PLACEHOLDER_M318',
    'Gemini 3.8 Flash (中)': 'MODEL_PLACEHOLDER_M319',
    'Gemini 3.8 Flash (低)': 'MODEL_PLACEHOLDER_M320',
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
    MODEL_PLACEHOLDER_M667: 'Orchestrator (Carbon)',
    MODEL_PLACEHOLDER_M681: 'Orchestrator (Argon)',
    MODEL_PLACEHOLDER_M669: 'Gemini Flash (Orchestrator Worker)',
    'MODEL_PLACEHOLDER_M21': 'Gemini 3.1 Flash Image',
    'MODEL_PLACEHOLDER_M525': 'Gemini 4 Hydrogen (High)',
    'MODEL_PLACEHOLDER_M526': 'Gemini 4 Hydrogen (Medium)',
    'MODEL_PLACEHOLDER_M527': 'Gemini 4 Hydrogen (Low)',
    'MODEL_PLACEHOLDER_M528': 'Gemini 4 Hydrogen (XHigh)',
    'MODEL_PLACEHOLDER_M427': 'Gemini 4 Carbon (High)',
    'MODEL_PLACEHOLDER_M437': 'Gemini 4 Carbon (Medium)',
    'MODEL_PLACEHOLDER_M438': 'Gemini 4 Carbon (Low)',
    'MODEL_PLACEHOLDER_M417': 'Gemini 4 Argon (High)',
    'MODEL_PLACEHOLDER_M418': 'Gemini 4 Argon (Medium)',
    'MODEL_PLACEHOLDER_M419': 'Gemini 4 Argon (Low)',
    'MODEL_PLACEHOLDER_M16': 'Gemini 3.1 Pro (High)',
    'MODEL_PLACEHOLDER_M37': 'Gemini 3.1 Pro (High)',  // Replaced by M16
    'MODEL_PLACEHOLDER_M36': 'Gemini 3.1 Pro (Low)',
    'MODEL_PLACEHOLDER_M318': 'Gemini 3.8 Flash (High)',
    'MODEL_PLACEHOLDER_M319': 'Gemini 3.8 Flash (Medium)',
    'MODEL_PLACEHOLDER_M320': 'Gemini 3.8 Flash (Low)',
    'MODEL_PLACEHOLDER_M322': 'Gemini 3.8 Flash (Tiered)',
    'MODEL_PLACEHOLDER_M298': 'Gemini 3.7 Flash (High)',
    'MODEL_PLACEHOLDER_M299': 'Gemini 3.7 Flash (Medium)',
    'MODEL_PLACEHOLDER_M300': 'Gemini 3.7 Flash (Low)',
    'MODEL_PLACEHOLDER_M71': 'Gemini 3.6 Flash (High)',
    'MODEL_PLACEHOLDER_M72': 'Gemini 3.6 Flash (Medium)',
    'MODEL_PLACEHOLDER_M73': 'Gemini 3.6 Flash (Low)',
    'MODEL_PLACEHOLDER_M264': 'Gemini 3.6 Flash (High)',    // [Retired] renumbered to M71
    'MODEL_PLACEHOLDER_M265': 'Gemini 3.6 Flash (Medium)',  // [Retired] renumbered to M72
    'MODEL_PLACEHOLDER_M266': 'Gemini 3.6 Flash (Low)',     // [Retired] renumbered to M73
    'MODEL_PLACEHOLDER_M196': 'Gemini 3.6 Flash (Tiered)',  // catalog-only tiered router (not in picker)
    'MODEL_PLACEHOLDER_M133': 'Gemini 3.5 Flash (High)',  // [Retired predecessor of M84]
    'MODEL_PLACEHOLDER_M132': 'Gemini 3.5 Flash (High)',  // [Retired predecessor of M84]
    'MODEL_PLACEHOLDER_M187': 'Gemini 3.5 Flash (Low)',
    'MODEL_PLACEHOLDER_M20': 'Gemini 3.5 Flash (Medium)', // gemini-3.5-flash-low
    'MODEL_PLACEHOLDER_M84': 'Gemini 3.5 Flash (High)',   // gemini-3-flash-agent — M84 took over 3.5F High identity from M133 (2026-07 live)
    'MODEL_PLACEHOLDER_M47': 'Gemini 3 Flash',            // retired (replaced by M84)
    'MODEL_PLACEHOLDER_M18': 'Gemini 3 Flash',            // backend command model
    'MODEL_PLACEHOLDER_M400': 'Claude Opus 5.5 (Low)',
    'MODEL_PLACEHOLDER_M401': 'Claude Opus 5.5 (Medium)',
    'MODEL_PLACEHOLDER_M402': 'Claude Opus 5.5 (High)',
    'MODEL_PLACEHOLDER_M403': 'Claude Sonnet 5.5 (Low)',
    'MODEL_PLACEHOLDER_M404': 'Claude Sonnet 5.5 (Medium)',
    'MODEL_PLACEHOLDER_M405': 'Claude Sonnet 5.5 (High)',
    'MODEL_PLACEHOLDER_M35': 'Claude Sonnet 4.6 (Thinking)',
    'MODEL_PLACEHOLDER_M26': 'Claude Opus 4.6 (Thinking)',
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 'GPT-OSS 120B (Medium)',
};

// IDs superseded by an active model that shares the same display label.
// Reverse label lookups must prefer the active ID so chained cpLimit/spec
// lookups don't land on a stale (retired) spec.
const RETIRED_PLACEHOLDER_IDS = new Set<string>([
    'MODEL_PLACEHOLDER_M133',  // retired 3.5 Flash (High), replaced by M84
    'MODEL_PLACEHOLDER_M132',  // retired 3.5 Flash (High), replaced by M84
    'MODEL_PLACEHOLDER_M47',   // retired 3 Flash (older ID), superseded by M18
    'MODEL_PLACEHOLDER_M37',   // retired 3.1 Pro (High), replaced by M16
    // 3.6 Flash renumber (2026-08 live): the platform moved the three tiers off M264/M265/M266
    // onto M71/M72/M73. Both numbers share a display label, so the reverse label lookup must
    // prefer the active one — otherwise a fresh capture would resolve to a pre-renumber spec.
    'MODEL_PLACEHOLDER_M264',  // retired 3.6 Flash (High), renumbered to M71
    'MODEL_PLACEHOLDER_M265',  // retired 3.6 Flash (Medium), renumbered to M72
    'MODEL_PLACEHOLDER_M266',  // retired 3.6 Flash (Low), renumbered to M73
]);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * 启发式智能未知大模型家族推导预测
 * Predict cpLimit, cpThreshold, and maxTokens based on model keywords.
 * Prevents unknown future models from blindly inheriting a generic 160K fallback.
 */
export function guessContextLimitSpec(modelId: string): { cpLimit: number; cpThreshold: number; maxTokens: number; supportsThinking: boolean } {
    if (Object.hasOwn(Object.prototype, modelId.trim())) {
        return { cpLimit: 0, cpThreshold: 0, maxTokens: 0, supportsThinking: false };
    }
    const imageSpec = getImageGenerationSpec(modelId);
    if (imageSpec) {
        return { cpLimit: imageSpec.cpLimit, cpThreshold: imageSpec.cpThreshold,
            maxTokens: imageSpec.maxTokens, supportsThinking: imageSpec.supportsThinking };
    }
    const idLower = modelId.toLowerCase();

    // Placeholder IDs (MODEL_PLACEHOLDER_Mxxx) carry no family keyword, so match the M-number by
    // EXACT equality — substring matching is unsafe here: e.g. 'model_placeholder_m264'.includes('m26')
    // would wrongly hit the Claude branch and brand Gemini 3.6 Flash as 160K thinking. Extract the
    // number and compare against known sets; keyword matching below is reserved for catalog names.
    const placeholderMatch = idLower.match(/^model_placeholder_(m\d+)$/);
    if (placeholderMatch) {
        const num = placeholderMatch[1];
        // Hydrogen, Carbon, Argon and the current 3.8 Flash picker use a 256K compression limit
        // and 50K trigger (live agent hub, 2026-10-31). Older Flash profiles
        // and the archived M322 tiered router retain their verified 140K trigger.
        if (['m667', 'm681', 'm669', 'm525', 'm526', 'm527', 'm528', 'm427', 'm437', 'm438', 'm417', 'm418', 'm419', 'm318', 'm319', 'm320'].includes(num)) {
            return { cpLimit: 256000, cpThreshold: 50000, maxTokens: 1048576, supportsThinking: true };
        }
        // Claude 5.5 uses adaptive thinking and a 1M native window, with a 256K
        // platform truncation limit (live GetAvailableModels, 2026-10-03).
        if (['m400', 'm401', 'm402', 'm403', 'm404', 'm405'].includes(num)) {
            return { cpLimit: 256000, cpThreshold: 50000, maxTokens: 1000000, supportsThinking: true };
        }
        // Claude / Premium (Thinking) series — live checkpointer threshold is 50,000 (2026-08 probe),
        // not the 100,000 this branch previously assumed.
        if (num === 'm35' || num === 'm26') {
            return { cpLimit: 160000, cpThreshold: 50000, maxTokens: 250000, supportsThinking: true };
        }
        // Gemini 3 Flash (M18) — catalog-only, keeps the pre-3.5 Flash profile (live 128,000 / 50,000).
        if (num === 'm18') {
            return { cpLimit: 128000, cpThreshold: 50000, maxTokens: 1048576, supportsThinking: true };
        }
        // Gemini Pro / High reasoning series — live checkpointer threshold is 50,000 and all three
        // tiers report supportsThinking=true (2026-08 probe).
        if (num === 'm16' || num === 'm37' || num === 'm36') {
            return { cpLimit: 128000, cpThreshold: 50000, maxTokens: 1048576, supportsThinking: true };
        }
        // Historical Flash profiles — 3.8 tiered router (M322), 3.7 (M298/M299/M300),
        // 3.6 (M71/M72/M73/M196), 3.5 (M84/M20/M187),
        // retired (M133/M132) and the pre-renumber 3.6 IDs (M264/M265/M266, kept for archived data).
        // NOTE: whenever the platform introduces or renumbers a Flash tier, its M-number MUST be added
        // here. An unlisted placeholder deliberately falls through to {0,0,0} below, which surfaces as a
        // "calculating threshold…" shimmer instead of a silently wrong limit.
        if (num === 'm322'
            || num === 'm298' || num === 'm299' || num === 'm300'
            || num === 'm71' || num === 'm72' || num === 'm73' || num === 'm196'
            || num === 'm84' || num === 'm20' || num === 'm187'
            || num === 'm264' || num === 'm265' || num === 'm266'
            || num === 'm133' || num === 'm132') {
            return { cpLimit: 256000, cpThreshold: 140000, maxTokens: 1048576, supportsThinking: true };
        }
        // Unknown placeholder — do NOT fall through to substring keyword matching (would re-introduce
        // the m26/m35 collision). Defer to live telemetry (0 → "calculating threshold" shimmer).
        return { cpLimit: 0, cpThreshold: 0, maxTokens: 0, supportsThinking: false };
    }

    // Only verified Hydrogen/Carbon/Argon and current Flash picker variants get this profile; versions
    // must not fall into a Flash/Pro guess or match Gemini 40 by prefix.
    const normalizedGeminiName = idLower.trim().replace(/（/g, '(').replace(/）/g, ')');
    if (resolveOrchestratorAlias(normalizedGeminiName)
        || /^(?:gemini[-_ ]flash[-_ ]worker[-_ ]agy|gemini flash \(orchestrator worker\))$/.test(normalizedGeminiName)
        || HYDROGEN_NAME_PATTERN.test(normalizedGeminiName) || GEMINI_4_NAME_PATTERN.test(normalizedGeminiName)
        || /^gemini[\s_-]+3[._-]8[\s_-]+flash[\s_-]*\(?\s*(?:high|medium|low)\s*\)?$/.test(idLower)) {
        return { cpLimit: 256000, cpThreshold: 50000, maxTokens: 1048576, supportsThinking: true };
    }

    // Non-placeholder names (catalog model_id / responseModel) — keyword matching is safe.
    // 1. Claude/Premium (Thinking) series -> 160K CP Limit (live threshold 50,000)
    if (idLower.includes('claude') || idLower.includes('opus') || idLower.includes('sonnet')) {
        if (/(?:^|[-_\s])5[._-]5(?:$|[-_\s(])/.test(idLower)) {
            return { cpLimit: 256000, cpThreshold: 50000, maxTokens: 1000000, supportsThinking: true };
        }
        return { cpLimit: 160000, cpThreshold: 50000, maxTokens: 250000, supportsThinking: true };
    }

    // 2. Gemini Pro / High reasoning series -> 128K CP Limit (live threshold 50,000, thinking supported)
    if (idLower.includes('pro')) {
        return { cpLimit: 128000, cpThreshold: 50000, maxTokens: 1048576, supportsThinking: true };
    }

    // 3. Gemini Flash / Lite series -> generation-aware. 3.5/3.6/3.7/3.8 Flash checkpointer
    //    uses 256K (3.8 re-verified 2026-09); pre-3.5 flash/lite stays on the
    //    128K profile and reports no thinking support (matches live gemini-2.5-flash* entries,
    //    which omit supportsThinking entirely, whereas every 3.5+ Flash tier reports true).
    if (idLower.includes('flash') || idLower.includes('lite') || idLower.includes('unspecified')) {
        // Version can be dotted ('gemini-3.7-flash-high') or underscore-separated, which is how the
        // platform spells its constant-style IDs ('MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE'). Matching only
        // the dotted form made every 2.5-series shadow model fall through to the 3.5+ branch and get a
        // 256K / thinking profile, when live reports 128K / 50K / no thinking.
        const versionMatch = idLower.match(/(\d+\.\d+)/) || idLower.match(/_(\d+)_(\d+)_/);
        const version = versionMatch
            ? parseFloat(versionMatch.length > 2 ? `${versionMatch[1]}.${versionMatch[2]}` : versionMatch[1])
            : NaN;
        if (!Number.isNaN(version) && version < 3.5) {
            return { cpLimit: 128000, cpThreshold: 50000, maxTokens: 1048576, supportsThinking: false };
        }
        return { cpLimit: 256000, cpThreshold: 140000, maxTokens: 1048576, supportsThinking: true };
    }

    // 4. GPT-OSS lightweight series -> 80K CP Limit
    if (idLower.includes('gpt') || idLower.includes('oss')) {
        return { cpLimit: 80000, cpThreshold: 50000, maxTokens: 131072, supportsThinking: true };
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
    // Image generation has a native capacity, but no inferred chat compression
    // limit. Never apply the text-model fallback or its -1K diagnostic offset.
    const imageSpec = getImageGenerationSpec(model);
    if (imageSpec) { return imageSpec.cpLimit > 0 ? imageSpec.cpLimit : imageSpec.maxTokens; }
    const directLimit = ownValue(DEFAULT_CONTEXT_LIMITS, model);
    if (directLimit !== undefined) { return directLimit; }
    // Resolve raw catalog/responseModel names (e.g. 'gemini-3-flash') to their
    // registered placeholder so both name forms of one logical model return the
    // same limit. resolveModelId never calls back into getContextLimit — no cycle.
    const resolvedId = resolveModelId(model);
    const resolvedLimit = resolvedId ? ownValue(DEFAULT_CONTEXT_LIMITS, resolvedId) : undefined;
    if (resolvedLimit !== undefined) { return resolvedLimit; }
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
    return ownValue(modelDisplayNames, model) || ownValue(STATIC_MODEL_NAME_FALLBACKS, model)
        || (isConcreteAliasTarget(model) ? ownValue(activeModelSpecs, model)?.displayName : '') || model || 'Unknown Model';
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
    if (ownValue(modelDisplayNames, clean) !== undefined || ownValue(STATIC_MODEL_NAME_FALLBACKS, clean) !== undefined
        || (isConcreteAliasTarget(clean) && ownValue(activeModelSpecs, clean) !== undefined)) { return clean; }
    // Reverse lookup: display label → model ID (prefer active over retired IDs so
    // chained cpLimit/spec lookups don't land on a stale spec — see RETIRED_PLACEHOLDER_IDS).
    let retiredMatch: string | undefined;
    for (const [modelId, label] of Object.entries(modelDisplayNames)) {
        if (label === clean) {
            if (!RETIRED_PLACEHOLDER_IDS.has(modelId)) { return modelId; }
            retiredMatch = retiredMatch ?? modelId;
        }
    }
    // Reverse lookup: legacy display label → model ID (persisted data migration)
    for (const [modelId, label] of Object.entries(STATIC_MODEL_NAME_FALLBACKS)) {
        if (label === clean) {
            if (!RETIRED_PLACEHOLDER_IDS.has(modelId)) { return modelId; }
            retiredMatch = retiredMatch ?? modelId;
        }
    }
    if (retiredMatch) { return retiredMatch; }
    // responseModel alias lookup (e.g. "gemini-pro-default" → "MODEL_PLACEHOLDER_M16")
    const fromResponseModel = ownValue(responseModelAliases, clean);
    if (fromResponseModel) { return fromResponseModel; }
    // These are single identities, not effort tiers; do not accept suffix variants.
    const orchestratorId = resolveOrchestratorAlias(clean);
    if (orchestratorId) { return orchestratorId; }
    if (/^(?:gemini[-_ ]flash[-_ ]worker[-_ ]agy|gemini flash \(orchestrator worker\))$/i.test(clean)) { return 'MODEL_PLACEHOLDER_M669'; }
    // Legacy Chinese name fallback (pre-v1.16 persisted data migration)
    const legacyId = ownValue(ZH_MODEL_NAME_ALIASES, clean);
    if (legacyId) { return legacyId; }
    // Accept readable/localized tiers and both catalog decimal spellings. A bare
    // human label defaults to Medium, as in the IDE picker. A bare responseModel
    // such as "claude-opus-5-5" intentionally has no tier: the backend can share it
    // across efforts, so it must never override a concrete chatModel/trajectory ID.
    const claude55 = clean.replace(/[（]/g, '(').replace(/[）]/g, ')').match(
        /^claude[\s_-]+(opus|sonnet)[\s_-]+5[._-]5(?:[\s_-]*\(?\s*(low|medium|high|低|中|高)\s*\)?)?$/i,
    );
    if (claude55 && (claude55[2] || /\s/.test(clean))) {
        const tier = (claude55[2] || 'medium').toLowerCase();
        const offset = tier === 'low' || tier === '低' ? 0 : tier === 'high' || tier === '高' ? 2 : 1;
        return `MODEL_PLACEHOLDER_M${(claude55[1].toLowerCase() === 'opus' ? 400 : 403) + offset}`;
    }
    // Gemini 4 effort is part of its identity. A shared family responseModel must
    // remain unassigned: guessing a tier would merge distinct effort telemetry.
    const geminiName = clean.replace(/（/g, '(').replace(/）/g, ')');
    const gemini4 = geminiName.match(HYDROGEN_NAME_PATTERN) || geminiName.match(GEMINI_4_NAME_PATTERN);
    if (gemini4 && (gemini4[2] || gemini4[3])) {
        const tier = (gemini4[2] || gemini4[3]).toLowerCase();
        if (gemini4[1].toLowerCase() === 'hydrogen') {
            if (tier === 'low' || tier === '低') { return 'MODEL_PLACEHOLDER_M527'; }
            if (tier === 'medium' || tier === '中') { return 'MODEL_PLACEHOLDER_M526'; }
            if (tier === 'high' || tier === '高') { return 'MODEL_PLACEHOLDER_M525'; }
            return 'MODEL_PLACEHOLDER_M528';
        }
        if (gemini4[1].toLowerCase() === 'carbon') {
            return tier === 'high' || tier === '高' ? 'MODEL_PLACEHOLDER_M427'
                : tier === 'medium' || tier === '中' ? 'MODEL_PLACEHOLDER_M437'
                : 'MODEL_PLACEHOLDER_M438';
        }
        return tier === 'high' || tier === '高' ? 'MODEL_PLACEHOLDER_M417'
            : tier === 'medium' || tier === '中' ? 'MODEL_PLACEHOLDER_M418'
            : 'MODEL_PLACEHOLDER_M419';
    }
    // Strip trailing diagnostic suffix "(Mxx)" and retry — handles persisted keys
    // that include the short ID appended by normalizeModelDisplayName()
    const suffixStripped = clean.replace(/（/g, '(').replace(/）/g, ')').replace(/\s*\(M\d+\)$/, '').replace(/\s*\(OSS-120B\)$/, '');
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
    const imageSpec = getImageGenerationSpec(modelId);
    if (imageSpec) { return `image:${imageSpec.placeholderId}`; }
    const fixedPool = ownValue(KNOWN_QUOTA_POOLS, modelId);
    if (fixedPool) {
        return fixedPool;
    }
    // Bare Claude 5.5 response names identify the shared pool even though they do
    // not identify an effort tier (see resolveModelId).
    if (/^claude-(?:opus|sonnet)-5[.-]5$/i.test(modelId.trim())) { return 'premium'; }
    if (/^gemini[\s_-]+4[\s_-]+(?:hydrogen|carbon|argon)$/i.test(modelId.trim())) { return 'gemini'; }
    // KNOWN_QUOTA_POOLS is keyed by placeholder ID, but callers also hold catalog model_ids
    // ('gemini-3.7-flash-high') and display labels ('Gemini 3.7 Flash (High)'). Without this
    // normalization those forms silently fall through to the resetTime branch — and resetTime is a
    // poor pool key: it drifts. Probed 2026-08-14, the same models reported 23:27:33 via
    // GetUserStatus and 23:31:25 via GetAvailableModels minutes apart, so two members of one pool
    // recorded from different samples land in different buckets and one shared Gemini quota renders
    // as several phantom pools.
    const resolvedId = resolveModelId(modelId);
    if (resolvedId) {
        const resolvedPool = ownValue(KNOWN_QUOTA_POOLS, resolvedId);
        if (resolvedPool) {
            return resolvedPool;
        }
    }

    // A provider alone is not a quota contract: orchestrators can use the same
    // backend while retaining their own allowance. Preserve future/renumbered
    // branded chat tiers only when their effort-specific catalog and provider agree;
    // arbitrary live display labels must not manufacture family membership.
    const specKey = resolvedId || modelId;
    const spec = specKey.includes('UNSPECIFIED') ? undefined : ownValue(activeModelSpecs, specKey);
    const provider = (spec?.apiProvider || '').replace(/^API_PROVIDER_/i, '').toUpperCase();
    const catalog = spec?.modelId.trim() || '';
    const hasChatEffort = /[-_\s](?:low|medium|high|xhigh)$/i.test(catalog);
    if (hasChatEffort && /^gemini[-_\s]/i.test(catalog) && /^(?:GOOGLE(?:_GEMINI)?|GEMINI)$/.test(provider)) { return 'gemini'; }
    if (hasChatEffort && /^claude[-_\s]/i.test(catalog) && /^ANTHROPIC(?:_VERTEX)?$/.test(provider)) { return 'premium'; }
    if (hasChatEffort && /^gpt[-_\s]oss[-_\s]/i.test(catalog) && /^OPENAI(?:_VERTEX)?$/.test(provider)) { return 'premium'; }
    // Keep the legacy reset-time fallback for callers that explicitly request it;
    // the model quota UI omits resetTime and keeps unverified models independent.
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
export function updateModelDisplayNames(
    configs: ModelConfig[],
    opts: { authoritative?: boolean } = {},
): void {
    // An authoritative update comes from a live language-server fetch and REPLACES the table, because
    // the reverse label lookup below iterates in insertion order and returns the first non-retired
    // match. Merging instead would let an identifier read off disk — persisted before a platform
    // renumber, and not yet known to be retired — outrank the live one for a whole session, and that
    // wrong ID then chains into getContextLimit() and getQuotaPoolKey(). Retired IDs stay resolvable
    // regardless: they live in STATIC_MODEL_NAME_FALLBACKS, which this never touches.
    if (opts.authoritative) {
        modelDisplayNames = {};
    }
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
    if (/^claude-(?:opus|sonnet)-5[.-]5$/i.test(responseKey)
        || /^gemini[\s_-]+4[\s_-]+(?:hydrogen|carbon|argon)$/i.test(responseKey)) { return; }
    // Resolve all known spellings before learning a telemetry alias. Checking
    // only the raw key lets case/localization variants override a known effort.
    // Live labels retain the resolver's precedence during a platform renumber.
    const existing = resolveModelId(responseKey);
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
    /** Explicit catalog capability; accepting image inputs does not imply generation. */
    isImageGeneration?: boolean;
    /** Image-tool catalogs may omit thinking capabilities even when the public API supports them. */
    thinkingCapabilityReported?: boolean;
    maxTokens: number;
    maxOutputTokens: number;
    thinkingBudget: number;
    supportsThinking: boolean;
    /** Adaptive thinking is independent of a fixed token budget. */
    supportsAdaptiveThinking?: boolean;
    /** Platform effort level: 1 = Low, 2 = Medium, 3 = High, 100 = XHigh (Extra). */
    thinkingLevel?: number;
    /** Configured delegation target, not evidence that a particular call used it. */
    executionModelId?: string;
    cpLimit: number;
    cpThreshold: number;
}

let activeModelSpecs: Record<string, ModelSpec> = {
    // Tool-only model: no checkpointer parameters were returned by the live catalog.
    'MODEL_PLACEHOLDER_M21': {
        modelId: 'gemini-3.1-flash-image',
        placeholderId: 'MODEL_PLACEHOLDER_M21',
        displayName: 'Gemini 3.1 Flash Image',
        apiProvider: 'GOOGLE_GEMINI',
        isImageGeneration: true,
        thinkingCapabilityReported: false,
        maxTokens: 65536,
        maxOutputTokens: 65536,
        thinkingBudget: 0,
        supportsThinking: false,
        cpLimit: 0,
        cpThreshold: 0,
    },
    // Orchestrator is selectable; its worker is catalog-only. Neither is an alias
    // for a Carbon/Hydrogen effort: real calls retain their own backend identity.
    MODEL_PLACEHOLDER_M667: {
        modelId: 'gemini-pro-orchestrator', placeholderId: 'MODEL_PLACEHOLDER_M667',
        displayName: 'Orchestrator (Carbon)', apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576, maxOutputTokens: 262144, thinkingBudget: 0,
        supportsThinking: true, thinkingLevel: 3, executionModelId: 'MODEL_PLACEHOLDER_M669',
        cpLimit: 256000, cpThreshold: 50000,
    },
    MODEL_PLACEHOLDER_M681: {
        modelId: 'gemini-pro-orchestrator-argon', placeholderId: 'MODEL_PLACEHOLDER_M681',
        displayName: 'Orchestrator (Argon)', apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576, maxOutputTokens: 65536, thinkingBudget: 0,
        supportsThinking: true, thinkingLevel: 3, executionModelId: 'MODEL_PLACEHOLDER_M669',
        cpLimit: 256000, cpThreshold: 50000,
    },
    MODEL_PLACEHOLDER_M669: {
        modelId: 'gemini-flash-worker-agy', placeholderId: 'MODEL_PLACEHOLDER_M669',
        displayName: 'Gemini Flash (Orchestrator Worker)', apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576, maxOutputTokens: 262144, thinkingBudget: 0,
        supportsThinking: true, thinkingLevel: 3, cpLimit: 256000, cpThreshold: 50000,
    },
    // Gemini 4 Hydrogen: live agent hub GetAvailableModels, 2026-11-13.
    // The picker calls XHigh "Extra"; the backend reports thinkingLevel 100, not 4.
    'MODEL_PLACEHOLDER_M525': {
        modelId: 'gemini-4-hydrogen-high',
        placeholderId: 'MODEL_PLACEHOLDER_M525',
        displayName: 'Gemini 4 Hydrogen (High)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 262144,
        thinkingBudget: 0,
        supportsThinking: true,
        thinkingLevel: 3,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M526': {
        modelId: 'gemini-4-hydrogen-medium',
        placeholderId: 'MODEL_PLACEHOLDER_M526',
        displayName: 'Gemini 4 Hydrogen (Medium)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 262144,
        thinkingBudget: 0,
        supportsThinking: true,
        thinkingLevel: 2,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M527': {
        modelId: 'gemini-4-hydrogen-low',
        placeholderId: 'MODEL_PLACEHOLDER_M527',
        displayName: 'Gemini 4 Hydrogen (Low)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 262144,
        thinkingBudget: 0,
        supportsThinking: true,
        thinkingLevel: 1,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M528': {
        modelId: 'gemini-4-hydrogen-xhigh',
        placeholderId: 'MODEL_PLACEHOLDER_M528',
        displayName: 'Gemini 4 Hydrogen (XHigh)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 262144,
        thinkingBudget: 0,
        supportsThinking: true,
        thinkingLevel: 100,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    // Gemini 4 Carbon: live agent hub GetAvailableModels, 2026-11-11.
    // Effort IDs are not contiguous; output capacity is 262,144 for every tier.
    // No fixed thinkingBudget or adaptive-thinking flag was returned.
    'MODEL_PLACEHOLDER_M427': {
        modelId: 'gemini-4-carbon-high',
        placeholderId: 'MODEL_PLACEHOLDER_M427',
        displayName: 'Gemini 4 Carbon (High)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 262144,
        thinkingBudget: 0,
        supportsThinking: true,
        thinkingLevel: 3,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M437': {
        modelId: 'gemini-4-carbon-medium',
        placeholderId: 'MODEL_PLACEHOLDER_M437',
        displayName: 'Gemini 4 Carbon (Medium)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 262144,
        thinkingBudget: 0,
        supportsThinking: true,
        thinkingLevel: 2,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M438': {
        modelId: 'gemini-4-carbon-low',
        placeholderId: 'MODEL_PLACEHOLDER_M438',
        displayName: 'Gemini 4 Carbon (Low)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 262144,
        thinkingBudget: 0,
        supportsThinking: true,
        thinkingLevel: 1,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    // Gemini 4 Argon: live agent hub GetAvailableModels, 2026-10-31.
    // No fixed thinkingBudget or adaptive-thinking flag was returned.
    'MODEL_PLACEHOLDER_M417': {
        modelId: 'gemini-4-argon-high',
        placeholderId: 'MODEL_PLACEHOLDER_M417',
        displayName: 'Gemini 4 Argon (High)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 0,
        supportsThinking: true,
        thinkingLevel: 3,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M418': {
        modelId: 'gemini-4-argon-medium',
        placeholderId: 'MODEL_PLACEHOLDER_M418',
        displayName: 'Gemini 4 Argon (Medium)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 0,
        supportsThinking: true,
        thinkingLevel: 2,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M419': {
        modelId: 'gemini-4-argon-low',
        placeholderId: 'MODEL_PLACEHOLDER_M419',
        displayName: 'Gemini 4 Argon (Low)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 0,
        supportsThinking: true,
        thinkingLevel: 1,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    // ── Gemini 3.8 Flash (current agent-hub metadata, 2026-10-31) ──
    'MODEL_PLACEHOLDER_M318': {
        modelId: 'gemini-3.8-flash-high',
        placeholderId: 'MODEL_PLACEHOLDER_M318',
        displayName: 'Gemini 3.8 Flash (High)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 0,
        thinkingLevel: 3,
        supportsThinking: true,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M319': {
        modelId: 'gemini-3.8-flash-medium',
        placeholderId: 'MODEL_PLACEHOLDER_M319',
        displayName: 'Gemini 3.8 Flash (Medium)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 0,
        thinkingLevel: 2,
        supportsThinking: true,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M320': {
        modelId: 'gemini-3.8-flash-low',
        placeholderId: 'MODEL_PLACEHOLDER_M320',
        displayName: 'Gemini 3.8 Flash (Low)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 0,
        thinkingLevel: 1,
        supportsThinking: true,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    // ── Gemini 3.7 Flash (live LS probe 2026-08-14; M298 was default until 3.8 launched) ──
    // thinkingBudget -1 is the platform's "dynamic / model-decided" sentinel, not a real token count.
    'MODEL_PLACEHOLDER_M298': {
        modelId: 'gemini-3.7-flash-high',
        placeholderId: 'MODEL_PLACEHOLDER_M298',
        displayName: 'Gemini 3.7 Flash (High)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: -1,
        supportsThinking: true,
        cpLimit: 256000,
        cpThreshold: 140000,
    },
    'MODEL_PLACEHOLDER_M299': {
        modelId: 'gemini-3.7-flash-medium',
        placeholderId: 'MODEL_PLACEHOLDER_M299',
        displayName: 'Gemini 3.7 Flash (Medium)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 4000,
        supportsThinking: true,
        cpLimit: 256000,
        cpThreshold: 140000,
    },
    'MODEL_PLACEHOLDER_M300': {
        modelId: 'gemini-3.7-flash-low',
        placeholderId: 'MODEL_PLACEHOLDER_M300',
        displayName: 'Gemini 3.7 Flash (Low)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 1000,
        supportsThinking: true,
        cpLimit: 256000,
        cpThreshold: 140000,
    },
    // ── Gemini 3.6 Flash — renumbered M264/M265/M266 → M71/M72/M73 (live LS probe 2026-08-14) ──
    'MODEL_PLACEHOLDER_M71': {
        modelId: 'gemini-3.6-flash-high',
        placeholderId: 'MODEL_PLACEHOLDER_M71',
        displayName: 'Gemini 3.6 Flash (High)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: -1,
        supportsThinking: true,
        cpLimit: 256000,
        cpThreshold: 140000,
    },
    'MODEL_PLACEHOLDER_M72': {
        modelId: 'gemini-3.6-flash-medium',
        placeholderId: 'MODEL_PLACEHOLDER_M72',
        displayName: 'Gemini 3.6 Flash (Medium)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 4000,
        supportsThinking: true,
        cpLimit: 256000,
        cpThreshold: 140000,
    },
    'MODEL_PLACEHOLDER_M73': {
        modelId: 'gemini-3.6-flash-low',
        placeholderId: 'MODEL_PLACEHOLDER_M73',
        displayName: 'Gemini 3.6 Flash (Low)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 1000,
        supportsThinking: true,
        cpLimit: 256000,
        cpThreshold: 140000,
    },
    // M84 took over the gemini-3-flash-agent key (3.5 Flash High) from M133 per 2026-07 live probe.
    'MODEL_PLACEHOLDER_M84': {
        modelId: 'gemini-3-flash-agent',
        placeholderId: 'MODEL_PLACEHOLDER_M84',
        displayName: 'Gemini 3.5 Flash (High)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: -1,
        supportsThinking: true,
        cpLimit: 256000,
        cpThreshold: 140000,
    },
    // [Legacy] retained for archived data; M84 now owns the 3.5 Flash High identity.
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
        thinkingBudget: 4000,
        supportsThinking: true,
        cpLimit: 256000,   // 2026-07 live checkpointer doubled from 128000
        cpThreshold: 140000,
    },
    'MODEL_PLACEHOLDER_M187': {
        modelId: 'gemini-3.5-flash-extra-low',
        placeholderId: 'MODEL_PLACEHOLDER_M187',
        displayName: 'Gemini 3.5 Flash (Low)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 1000,
        supportsThinking: true,
        cpLimit: 256000,   // 2026-07 live checkpointer doubled from 128000
        cpThreshold: 140000,
    },
    'MODEL_UNSPECIFIED': {
        modelId: 'gemini-3.5-flash-extra-low (UNSPECIFIED)',
        placeholderId: 'MODEL_UNSPECIFIED',
        displayName: 'Gemini 3.5 Flash (Low)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65536,
        thinkingBudget: 1000,
        supportsThinking: true,
        cpLimit: 256000,
        cpThreshold: 140000,
    },
    'MODEL_PLACEHOLDER_M16': {
        modelId: 'gemini-pro-agent',
        placeholderId: 'MODEL_PLACEHOLDER_M16',
        displayName: 'Gemini 3.1 Pro (High)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65535,
        thinkingBudget: 10001,
        supportsThinking: true,
        cpLimit: 128000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M36': {
        modelId: 'gemini-3.1-pro-low',
        placeholderId: 'MODEL_PLACEHOLDER_M36',
        displayName: 'Gemini 3.1 Pro (Low)',
        apiProvider: 'GOOGLE_GEMINI',
        maxTokens: 1048576,
        maxOutputTokens: 65535,
        thinkingBudget: 1001,
        supportsThinking: true,
        cpLimit: 128000,
        cpThreshold: 50000,
    },
    // Claude 5.5 — verified from the installed IDE's LS on 2026-10-03.
    // Budget is omitted by the API: effort is adaptive, not a fixed token count.
    'MODEL_PLACEHOLDER_M400': {
        modelId: 'claude-opus-5-5-low',
        placeholderId: 'MODEL_PLACEHOLDER_M400',
        displayName: 'Claude Opus 5.5 (Low)',
        apiProvider: 'ANTHROPIC_VERTEX',
        maxTokens: 1000000,
        maxOutputTokens: 128000,
        thinkingBudget: 0,
        supportsThinking: true,
        supportsAdaptiveThinking: true,
        thinkingLevel: 1,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M401': {
        modelId: 'claude-opus-5-5-medium',
        placeholderId: 'MODEL_PLACEHOLDER_M401',
        displayName: 'Claude Opus 5.5 (Medium)',
        apiProvider: 'ANTHROPIC_VERTEX',
        maxTokens: 1000000,
        maxOutputTokens: 128000,
        thinkingBudget: 0,
        supportsThinking: true,
        supportsAdaptiveThinking: true,
        thinkingLevel: 2,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M402': {
        modelId: 'claude-opus-5-5-high',
        placeholderId: 'MODEL_PLACEHOLDER_M402',
        displayName: 'Claude Opus 5.5 (High)',
        apiProvider: 'ANTHROPIC_VERTEX',
        maxTokens: 1000000,
        maxOutputTokens: 128000,
        thinkingBudget: 0,
        supportsThinking: true,
        supportsAdaptiveThinking: true,
        thinkingLevel: 3,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M403': {
        modelId: 'claude-sonnet-5-5-low',
        placeholderId: 'MODEL_PLACEHOLDER_M403',
        displayName: 'Claude Sonnet 5.5 (Low)',
        apiProvider: 'ANTHROPIC_VERTEX',
        maxTokens: 1000000,
        maxOutputTokens: 128000,
        thinkingBudget: 0,
        supportsThinking: true,
        supportsAdaptiveThinking: true,
        thinkingLevel: 1,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M404': {
        modelId: 'claude-sonnet-5-5-medium',
        placeholderId: 'MODEL_PLACEHOLDER_M404',
        displayName: 'Claude Sonnet 5.5 (Medium)',
        apiProvider: 'ANTHROPIC_VERTEX',
        maxTokens: 1000000,
        maxOutputTokens: 128000,
        thinkingBudget: 0,
        supportsThinking: true,
        supportsAdaptiveThinking: true,
        thinkingLevel: 2,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M405': {
        modelId: 'claude-sonnet-5-5-high',
        placeholderId: 'MODEL_PLACEHOLDER_M405',
        displayName: 'Claude Sonnet 5.5 (High)',
        apiProvider: 'ANTHROPIC_VERTEX',
        maxTokens: 1000000,
        maxOutputTokens: 128000,
        thinkingBudget: 0,
        supportsThinking: true,
        supportsAdaptiveThinking: true,
        thinkingLevel: 3,
        cpLimit: 256000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M35': {
        modelId: 'claude-sonnet-4-6',
        placeholderId: 'MODEL_PLACEHOLDER_M35',
        displayName: 'Claude Sonnet 4.6 (Thinking)',
        apiProvider: 'ANTHROPIC_VERTEX',
        maxTokens: 250000,
        maxOutputTokens: 64000,
        thinkingBudget: 1024,
        supportsThinking: true,
        cpLimit: 160000,
        cpThreshold: 50000,
    },
    'MODEL_PLACEHOLDER_M26': {
        modelId: 'claude-opus-4-6-thinking',
        placeholderId: 'MODEL_PLACEHOLDER_M26',
        displayName: 'Claude Opus 4.6 (Thinking)',
        apiProvider: 'ANTHROPIC_VERTEX',
        maxTokens: 250000,
        maxOutputTokens: 64000,
        thinkingBudget: 1024,
        supportsThinking: true,
        cpLimit: 160000,
        cpThreshold: 50000,
    },
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': {
        modelId: 'gpt-oss-120b-medium',
        placeholderId: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
        displayName: 'GPT-OSS 120B (Medium)',
        apiProvider: 'OPENAI_VERTEX',
        maxTokens: 131072,
        maxOutputTokens: 32768,
        thinkingBudget: 8192,
        supportsThinking: true,
        cpLimit: 80000,
        cpThreshold: 50000,
    },
};

export function updateModelSpec(placeholderId: string, spec: Partial<ModelSpec>): void {
    if (!isConcreteAliasTarget(placeholderId) && placeholderId !== 'MODEL_UNSPECIFIED') { return; }
    if (!ownValue(activeModelSpecs, placeholderId)) {
        activeModelSpecs[placeholderId] = {
            modelId: spec.modelId || '',
            placeholderId,
            displayName: spec.displayName || getModelDisplayName(placeholderId),
            apiProvider: spec.apiProvider || '',
            ...(spec.isImageGeneration !== undefined ? { isImageGeneration: spec.isImageGeneration } : {}),
            ...(spec.thinkingCapabilityReported !== undefined ? { thinkingCapabilityReported: spec.thinkingCapabilityReported } : {}),
            maxTokens: spec.maxTokens || 0,
            maxOutputTokens: spec.maxOutputTokens || 0,
            thinkingBudget: spec.thinkingBudget || 0,
            supportsThinking: spec.supportsThinking || false,
            ...(spec.supportsAdaptiveThinking !== undefined ? { supportsAdaptiveThinking: spec.supportsAdaptiveThinking } : {}),
            ...(spec.thinkingLevel !== undefined ? { thinkingLevel: spec.thinkingLevel } : {}),
            ...(spec.executionModelId !== undefined ? { executionModelId: spec.executionModelId } : {}),
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
    // Mirrors the platform's own "Recommended" sort group (GetUserStatus → clientModelSorts),
    // newest generation first. Hydrogen identities live-verified 2026-11-13.
    const order = [
        'MODEL_PLACEHOLDER_M667',
        'MODEL_PLACEHOLDER_M681',
        'MODEL_PLACEHOLDER_M669',
        'MODEL_PLACEHOLDER_M528',
        'MODEL_PLACEHOLDER_M525',
        'MODEL_PLACEHOLDER_M526',
        'MODEL_PLACEHOLDER_M527',
        'MODEL_PLACEHOLDER_M427',
        'MODEL_PLACEHOLDER_M437',
        'MODEL_PLACEHOLDER_M438',
        'MODEL_PLACEHOLDER_M417',
        'MODEL_PLACEHOLDER_M418',
        'MODEL_PLACEHOLDER_M419',
        'MODEL_PLACEHOLDER_M318',
        'MODEL_PLACEHOLDER_M319',
        'MODEL_PLACEHOLDER_M320',
        // Catalog-only M322 has no static spec; if live sync creates one, keep it beside its family.
        'MODEL_PLACEHOLDER_M322',
        'MODEL_PLACEHOLDER_M298',
        'MODEL_PLACEHOLDER_M299',
        'MODEL_PLACEHOLDER_M300',
        'MODEL_PLACEHOLDER_M71',
        'MODEL_PLACEHOLDER_M72',
        'MODEL_PLACEHOLDER_M73',
        'MODEL_PLACEHOLDER_M84',
        'MODEL_PLACEHOLDER_M20',
        'MODEL_PLACEHOLDER_M187',
        'MODEL_UNSPECIFIED',
        'MODEL_PLACEHOLDER_M16',
        'MODEL_PLACEHOLDER_M36',
        'MODEL_PLACEHOLDER_M400',
        'MODEL_PLACEHOLDER_M401',
        'MODEL_PLACEHOLDER_M402',
        'MODEL_PLACEHOLDER_M403',
        'MODEL_PLACEHOLDER_M404',
        'MODEL_PLACEHOLDER_M405',
        'MODEL_PLACEHOLDER_M35',
        'MODEL_PLACEHOLDER_M26',
        'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
        'MODEL_PLACEHOLDER_M21'
        // Retired M133 is intentionally omitted here — it is appended last via the leftover loop below.
        // The pre-renumber 3.6 IDs (M264/M265/M266) deliberately have NO spec entry at all: they only
        // need name/limit/pool registration to parse archived data, and giving them specs would append
        // three duplicate "Gemini 3.6 Flash" cards to the end of the Models tab.
    ];
    const ordered: ModelSpec[] = [];
    for (const key of order) {
        if (activeModelSpecs[key]) {
            const spec = activeModelSpecs[key];
            // Only adopt a resolved name. getModelDisplayName() falls back to the raw key when it
            // knows nothing, and this assignment mutates the shared spec object — so an unresolvable
            // key (MODEL_UNSPECIFIED is in neither the API map nor the static fallbacks) would
            // permanently overwrite the spec's own displayName with the placeholder string.
            const resolvedName = getModelDisplayName(key);
            if (resolvedName && resolvedName !== key) {
                spec.displayName = resolvedName;
            }
            ordered.push(spec);
        }
    }
    for (const [key, spec] of Object.entries(activeModelSpecs)) {
        if (!order.includes(key)) {
            // Only adopt a resolved name. getModelDisplayName() falls back to the raw key when it
            // knows nothing, and this assignment mutates the shared spec object — so an unresolvable
            // key (MODEL_UNSPECIFIED is in neither the API map nor the static fallbacks) would
            // permanently overwrite the spec's own displayName with the placeholder string.
            const resolvedName = getModelDisplayName(key);
            if (resolvedName && resolvedName !== key) {
                spec.displayName = resolvedName;
            }
            ordered.push(spec);
        }
    }
    return ordered;
}

/** Available image tools are account/catalog state, separate from historical identities. */
let availableImageModelIds = new Set<string>();

function getImageGenerationSpec(identity: string): ModelSpec | undefined {
    const clean = identity.trim();
    const id = resolveModelId(clean) || clean;
    const spec = ownValue(activeModelSpecs, id);
    if (spec?.isImageGeneration) { return spec; }
    return Object.values(activeModelSpecs).find(item => item.isImageGeneration
        && (item.modelId === clean || item.displayName === clean));
}

export function isImageGenerationModel(identity: string): boolean {
    return !!getImageGenerationSpec(identity);
}

/** Call with [] when the authenticated account/backend changes. */
export function setAvailableImageModelIds(ids: readonly string[]): void {
    availableImageModelIds = new Set(ids.flatMap(id => {
        const spec = getImageGenerationSpec(id);
        return spec ? [spec.placeholderId] : [];
    }));
}

export function getAvailableImageModelSpecs(): ModelSpec[] {
    return getModelSpecs().filter(spec => spec.isImageGeneration && availableImageModelIds.has(spec.placeholderId));
}

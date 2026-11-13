// ─── Pricing Store ───────────────────────────────────────────────────────────
// Manages model pricing data: default built-in prices, user custom overrides
// persisted via globalState, lookup helpers, and cost calculation.
//
// Extracted from gm-panel.ts to enable the dedicated Pricing tab.

import type { GMSummary, GMModelStats } from './gm-tracker';
import type { LedgerAccountBucket, LedgerModelStats } from './daily-ledger';
import { normalizeModelDisplayName, getModelBaseName, resolveModelId, getModelDisplayName, getModelSpecs, isImageGenerationModel } from './models';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ModelPricing {
    input: number;       // $ per 1M input tokens
    output: number;      // $ per 1M output tokens
    cacheRead: number;   // $ per 1M cache read tokens
    cacheWrite: number;  // Reference $ per 1M 5-minute cache writes; excluded from current estimates
    thinking: number;    // $ per 1M thinking tokens
}

export interface ModelCostRow {
    name: string;
    responseModel: string;
    inputCost: number;
    outputCost: number;      // cost of responseOutputTokens only (excludes thinking)
    cacheCost: number;
    thinkingCost: number;
    totalCost: number;
    inputTokens: number;
    outputTokens: number;    // responseOutputTokens (= totalOutputTokens - totalThinkingTokens)
    cacheTokens: number;
    thinkingTokens: number;
    pricing: ModelPricing | null;
    /** A frozen total survives, but its historical per-token price split does not. */
    costBreakdownUnavailable?: boolean;
    /** Components use dated rates, so a single current-price multiplication is misleading. */
    usesHistoricalRates?: boolean;
}

// ─── Default Pricing Table (per 1M tokens, USD) ─────────────────────────────
// Source: https://platform.claude.com/docs/en/about-claude/pricing
//         https://cloud.google.com/vertex-ai/generative-ai/pricing
// Claude 5.5 rates updated: 2026-10-03
// Cache: Claude cacheWrite uses the official 5-minute TTL rate; reads are model-specific.
//        Gemini cacheRead = from official table; no separate cacheWrite pricing
// Thinking: = output price (Claude extended thinking / Gemini reasoning output)

export const PRICING_LAST_UPDATED = '2026-11-13';

export type PricingDate = string | number | Date;
const CARBON_RATE_CHANGE = Date.parse('2026-12-01T00:00:00Z');
const CARBON_INTRO_PRICING: ModelPricing = { input: 2, output: 10, cacheRead: 0.10, cacheWrite: 0, thinking: 10 };
const CARBON_STANDARD_PRICING: ModelPricing = { input: 4, output: 20, cacheRead: 0.20, cacheWrite: 0, thinking: 20 };
const ARGON_RATE_CHANGE = Date.parse('2026-12-01T00:00:00Z');
const ARGON_INTRO_PRICING: ModelPricing = { input: 2, output: 10, cacheRead: 0.10, cacheWrite: 0, thinking: 10 };
const ARGON_STANDARD_PRICING: ModelPricing = { input: 4, output: 20, cacheRead: 0.20, cacheWrite: 0, thinking: 20 };
const FLASH_RATE_CHANGE = Date.parse('2027-01-01T00:00:00Z');
const FLASH_INTRO_PRICING: ModelPricing = { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.9375, thinking: 3.75 };
const FLASH_STANDARD_PRICING: ModelPricing = { input: 1.50, output: 7.50, cacheRead: 0.15, cacheWrite: 1.875, thinking: 7.50 };

/** Calendar-only archive keys keep their stored day; full timestamps use UTC. */
function pricingTimestamp(at: PricingDate): number | null {
    if (at instanceof Date) { return Number.isFinite(at.getTime()) ? at.getTime() : null; }
    if (typeof at === 'number') { return Number.isFinite(at) && Number.isFinite(new Date(at).getTime()) ? at : null; }
    if (!/^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$)/i.test(at)) { return null; }
    const day = at.slice(0, 10);
    const dayTime = Date.parse(`${day}T00:00:00Z`);
    if (!Number.isFinite(dayTime) || new Date(dayTime).toISOString().slice(0, 10) !== day) { return null; }
    const timestamp = Date.parse(at);
    return Number.isFinite(timestamp) ? timestamp : null;
}

export const DEFAULT_PRICING: Record<string, ModelPricing> = {
    // https://aistudio.google.com/docs/pricing#gemini-4-hydrogen (2026-11-13).
    // Standard API reference, all four efforts. No published scheduled cutover;
    // implicit cache reads only, no explicit caching or cache-write charge.
    'gemini-4-hydrogen': { input: 1.50, output: 7.50, cacheRead: 0.075, cacheWrite: 0, thinking: 7.50 },
    // Carbon has its own verified schedule, independent of Argon's equal rates.
    // https://aistudio.google.com/docs/pricing#gemini-4-carbon (2026-11-11).
    // Standard API reference; implicit cache reads only, no explicit cache writes.
    get 'gemini-4-carbon'() { return Date.now() < CARBON_RATE_CHANGE ? CARBON_INTRO_PRICING : CARBON_STANDARD_PRICING; },
    // Google standard API reference, not Batch/Flex/Priority or subscription credits.
    // https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon (2026-10-31).
    // Implicit cache reads only; explicit caching/cache-write fees are unsupported.
    get 'gemini-4-argon'() { return Date.now() < ARGON_RATE_CHANGE ? ARGON_INTRO_PRICING : ARGON_STANDARD_PRICING; },
    // ── Claude (platform.claude.com/docs/en/about-claude/pricing) ─────
    'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.50, cacheWrite: 6.25, thinking: 25 },
    'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75, thinking: 15 },
    // https://www.anthropic.com/pricing (verified 2026-10-03), all effort tiers.
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.20, cacheWrite: 5, thinking: 20 },
    // Exact Sonnet 5.5 row confirmed in the user's official-pricing screenshot (2026-10-03).
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.20, cacheWrite: 2.50, thinking: 10 },
    // ── GPT-OSS (cloud.google.com/vertex-ai/generative-ai/pricing) ───
    'gpt-oss-120b': { input: 0.09, output: 0.36, cacheRead: 0, cacheWrite: 0, thinking: 0.36 },
    // ── Gemini 3.x (cloud.google.com/vertex-ai/generative-ai/pricing) ─
    'gemini-3.1-pro': { input: 2, output: 12, cacheRead: 0.20, cacheWrite: 2.50, thinking: 12 },
    'gemini-3-flash': { input: 0.50, output: 3, cacheRead: 0.05, cacheWrite: 0.625, thinking: 3 },     // Gemini 3 Flash (M133=gemini-3-flash-b)
    // ── Gemini 3.5 Flash (ai.google.dev/gemini-api/docs/pricing) ────────
    'gemini-3.5-flash': { input: 1.50, output: 9, cacheRead: 0.15, cacheWrite: 1.875, thinking: 9 },
    // ── Gemini 3.6 Flash (ai.google.dev/gemini-api/docs/pricing + artificialanalysis, verified 2026-07-22) ──
    // Input unchanged at $1.50; output cut to $7.50 (vs 3.5 Flash's $9.00). Cache derived as 3.5 Flash (0.1× / 1.25× input).
    'gemini-3.6-flash': { input: 1.50, output: 7.50, cacheRead: 0.15, cacheWrite: 1.875, thinking: 7.50 },
    // ── Gemini 3.7 Flash (blog.google introduction post + VentureBeat + 9to5Google, verified 2026-08-14) ──
    // INTRODUCTORY pricing, exactly half of 3.6 Flash: $0.75 input / $3.75 output per 1M tokens,
    // context caching $0.075. Google's footnote: "Introductory pricing expires on December 31, 2026.
    // Starting January 1, 2027, $1.50/1M input tokens and $7.50/1M output tokens will apply."
    // The getter rolls to the published post-introductory rate automatically;
    // dated calls retain their introductory rate during historical calculations.
    // cacheWrite derived at 1.25× input, consistent with how the 3.5/3.6 Flash rows were derived.
    get 'gemini-3.7-flash'() { return Date.now() < FLASH_RATE_CHANGE ? FLASH_INTRO_PRICING : FLASH_STANDARD_PRICING; },
    // ── Gemini 3.8 Flash (Google Antigravity + Google launch posts, verified 2026-09-05) ──
    // Same introductory rate and expiry as 3.7 Flash: $0.75 input / $3.75 output through 2026-12-31;
    // from 2027-01-01 the rates become $1.50 / $7.50. Cache rates follow the existing Flash policy.
    get 'gemini-3.8-flash'() { return Date.now() < FLASH_RATE_CHANGE ? FLASH_INTRO_PRICING : FLASH_STANDARD_PRICING; },
};

// ─── Pricing Lookup ──────────────────────────────────────────────────────────

/** Find pricing for a model by exact identity or a complete family-name prefix.
 *  Partial/substring matching is unsafe: 'claude-opus-5-6' must never inherit a
 *  5.5 price, and a custom Low-tier rate must never price the High tier. */
export function findPricing(
    responseModel: string,
    table: Record<string, ModelPricing> = DEFAULT_PRICING,
): ModelPricing | null {
    if (!responseModel.trim()) { return null; }
    if (Object.prototype.hasOwnProperty.call(table, responseModel) && table[responseModel]) { return table[responseModel]; }
    const modelId = resolveModelId(responseModel);
    // Gemini 4 has verified concrete efforts and a shared bare response family.
    // Do not erase malformed parentheses or unknown effort suffixes into that
    // family's price. Exact-key prices above remain intentional user overrides;
    // older families retain their existing preview/latest/dated alias support.
    const clean = responseModel.trim();
    if (/^(?:orchestrator|编排器|协调器|gemini[-_ ]pro[-_ ]orchestrator)/i.test(clean) && !modelId) {
        return null;
    }
    if (/^gemini[\s_-]+4[\s_-]+(?:hydrogen|carbon|argon)/i.test(clean)
        && !/^gemini[\s_-]+4[\s_-]+(?:hydrogen|carbon|argon)$/i.test(clean)
        && !modelId) { return null; }
    const imageModel = isImageGenerationModel(responseModel);
    const candidates: string[] = [];
    // A catalog alias can differ completely from its current display identity
    // (e.g. gemini-3-flash-agent). Resolve it before trying its literal spelling.
    if (typeof modelId === 'string') {
        const displayName = getModelDisplayName(modelId);
        if (typeof displayName === 'string' && displayName && displayName !== modelId) {
            candidates.push(...kebabCandidates(displayName));
        }
    }
    candidates.push(...kebabCandidates(responseModel));
    for (const candidate of new Set(candidates)) {
        if (Object.prototype.hasOwnProperty.call(table, candidate) && table[candidate]
            && (!imageModel || isImageGenerationModel(candidate))) { return table[candidate]; }
        for (const [key, pricing] of Object.entries(table)) {
            if (imageModel && !isImageGenerationModel(key)) { continue; }
            // Normalize decimals on both sides, but keep the table row's tier.
            // Removing a custom row's tier would turn its rate into a family rate.
            const normalizedKey = kebabCandidates(key)[0];
            const suffix = normalizedKey && candidate.startsWith(`${normalizedKey}-`)
                ? candidate.slice(normalizedKey.length + 1) : '';
            // Only model variants may extend a price key. A numeric continuation
            // is another version: Sonnet 5.5 cannot use a Sonnet 5 row.
            const isVariant = /^(?:(?:low|medium|high|thinking|tiered|preview|latest)(?:-|$)|\d{8}(?:-|$))/.test(suffix)
                || (normalizedKey === 'gemini-4-hydrogen' && /^(?:xhigh|extra(?:-high)?)$/.test(suffix));
            if (normalizedKey && (candidate === normalizedKey || isVariant)) {
                return pricing;
            }
        }
    }
    // Account labels are authoritative for display, but they are not pricing
    // identities. Recover the catalog key when a renamed known placeholder did
    // not match; retain exact/custom display-name prices above. The identity
    // check also prevents stale catalog metadata from pricing a renumbered ID.
    if (typeof modelId === 'string') {
        const catalogId = getModelSpecs().find(spec => spec.placeholderId === modelId)?.modelId;
        if (catalogId && catalogId !== responseModel && resolveModelId(catalogId) === modelId) {
            return findPricing(catalogId, table);
        }
    }
    return null;
}

/**
 * Spellings of a display name to try against the pricing table, best first.
 *
 * Two things make a single spelling insufficient:
 *  - The built-in keys disagree about decimals. Claude rows dash them
 *    ('claude-opus-4-6'), Gemini rows keep the dot ('gemini-3.1-pro'), so a fixed
 *    "4.6 → 4-6" rewrite finds the Claude rows and misses every Gemini row.
 *  - A tier suffix is only resolvable while it is in English. `resolveModelId`
 *    above knows "Gemini 3.1 Pro (High)" but not its localized form, and the
 *    localized suffix survives kebab-casing, so "Gemini 3.1 Pro (高)" reached the
 *    end of this function with no match and the model's cost silently read $0 for
 *    every user running a non-English UI. Dropping the trailing parenthetical
 *    recovers the base name, which is locale-independent.
 */
function kebabCandidates(displayName: string): string[] {
    const kebab = (s: string, dashDecimals: boolean): string => {
        // Family-only response identifiers can use constant-style underscores,
        // even though they intentionally cannot resolve to a concrete effort.
        const base = s.replace(/[()]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-');
        return dashDecimals ? base.replace(/(\d+)\.(\d+)/g, '$1-$2') : base;
    };
    // Carbon/Argon in coordinator names are identities, not removable efforts.
    // Removing either would make an old custom "Orchestrator" rate price Argon.
    const withoutTier = /^(?:orchestrator|编排器|协调器)\s*[（(]/i.test(displayName.trim())
        ? displayName : displayName.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const out = [kebab(displayName, true), kebab(displayName, false)];
    if (withoutTier && withoutTier !== displayName) {
        out.push(kebab(withoutTier, false), kebab(withoutTier, true));
    }
    return out.filter((v, i) => v && out.indexOf(v) === i);
}

/**
 * Resolve pricing for a model, letting the user's custom prices win.
 *
 * Merging the two tables into one and calling `findPricing` does NOT work, for two
 * separate reasons that both had to be fixed here:
 *  - Insertion order. The prefix and fuzzy passes in `findPricing` walk keys in order,
 *    so the built-in 'gemini-3.7-flash' is reached before any custom row and wins for
 *    every variant id that starts with it. A custom row could never take effect.
 *  - Key namespace. The Pricing tab labels its editable rows with the ledger's model
 *    key — a display name such as "Gemini 3.7 Flash (High)" — while the ledger and GM
 *    data look pricing up by catalog id such as 'gemini-3.7-flash-high'. The two
 *    spellings never meet by string matching alone, so the query is also tried under
 *    the canonical display name of whatever model id it resolves to.
 */
export function findPricingWithCustom(
    responseModel: string,
    custom: Record<string, ModelPricing>,
    base: Record<string, ModelPricing> = DEFAULT_PRICING,
): ModelPricing | null {
    if (responseModel && Object.keys(custom).length > 0) {
        for (const alias of pricingLookupAliases(responseModel)) {
            if (Object.prototype.hasOwnProperty.call(custom, alias) && custom[alias]) { return custom[alias]; }
        }
        // Persisted custom prices can use a localized tier label or a diagnostic
        // suffix from a previous session. Compare concrete identities as well.
        const modelId = resolveModelId(responseModel);
        if (typeof modelId === 'string') {
            for (const [key, pricing] of Object.entries(custom)) {
                if (resolveModelId(key) === modelId) { return pricing; }
            }
        }
        const viaCustom = findPricing(responseModel, custom);
        if (viaCustom) { return viaCustom; }
    }
    return findPricing(responseModel, base);
}

/** Resolve the standard rate at usage time, while every explicit custom rate wins. */
export function findPricingForDate(
    model: string,
    custom: Record<string, ModelPricing> = {},
    at: PricingDate = new Date(),
    base: Record<string, ModelPricing> = DEFAULT_PRICING,
): ModelPricing | null {
    const override = findPricingWithCustom(model, custom, {});
    if (override) { return override; }
    const pricing = findPricing(model, base);
    if (!pricing) { return null; }
    // Check both immutable rate eras before reading dynamic default getters;
    // crossing midnight between two reads must not lose the family identity.
    const isCarbon = pricing === CARBON_INTRO_PRICING || pricing === CARBON_STANDARD_PRICING
        || pricing === base['gemini-4-carbon'];
    const isArgon = pricing === ARGON_INTRO_PRICING || pricing === ARGON_STANDARD_PRICING
        || pricing === base['gemini-4-argon'];
    const isFlash = pricing === FLASH_INTRO_PRICING || pricing === FLASH_STANDARD_PRICING
        || pricing === base['gemini-3.7-flash'] || pricing === base['gemini-3.8-flash'];
    if (!isCarbon && !isArgon && !isFlash) { return pricing; }
    const time = pricingTimestamp(at);
    // An invalid historic timestamp is not evidence that today's rate applied.
    if (time === null) { return null; }
    if (isCarbon) { return time < CARBON_RATE_CHANGE ? CARBON_INTRO_PRICING : CARBON_STANDARD_PRICING; }
    return isArgon
        ? time < ARGON_RATE_CHANGE ? ARGON_INTRO_PRICING : ARGON_STANDARD_PRICING
        : time < FLASH_RATE_CHANGE ? FLASH_INTRO_PRICING : FLASH_STANDARD_PRICING;
}

/** The spellings a single model answers to: as given, its model id, its display name. */
function pricingLookupAliases(responseModel: string): string[] {
    const out = [responseModel];
    const modelId = resolveModelId(responseModel);
    if (typeof modelId === 'string') {
        out.push(modelId);
        const displayName = getModelDisplayName(modelId);
        if (typeof displayName === 'string' && displayName) { out.push(displayName); }
    }
    return out.filter((v, i) => v && out.indexOf(v) === i);
}

/**
 * The one cost formula. Thinking tokens are billed at the thinking rate and are a
 * subset of the reported output count, so they are subtracted before applying the
 * output rate. Cache *creation* is deliberately not billed here — the platform's
 * reported cacheCreationTokens are not consistently populated, and every existing
 * cost path in this extension has always excluded them; including them in one path
 * only would make two screens disagree about the same day.
 */
export function costFromTokens(
    t: { inputTokens: number; outputTokens: number; thinkingTokens: number; cacheReadTokens: number },
    pricing: ModelPricing,
): number {
    const responseOutput = Math.max(0, (t.outputTokens || 0) - (t.thinkingTokens || 0));
    return (
        (t.inputTokens || 0) * pricing.input +
        responseOutput * pricing.output +
        (t.cacheReadTokens || 0) * pricing.cacheRead +
        (t.thinkingTokens || 0) * pricing.thinking
    ) / 1_000_000;
}

interface PricingTokenUsage {
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
}

interface DatedPricingUsage extends PricingTokenUsage {
    model: string;
    createdAt: PricingDate;
}

type CostBreakdown = Pick<ModelCostRow,
    'inputCost' | 'outputCost' | 'cacheCost' | 'thinkingCost' | 'totalCost' | 'pricing' | 'costBreakdownUnavailable' | 'usesHistoricalRates'>;

/** Match concrete tiers without letting a shared response family merge them. */
export function samePricingModel(left: string, right: string): boolean {
    if (left === right) { return true; }
    const leftId = resolveModelId(left);
    const rightId = resolveModelId(right);
    if (typeof leftId === 'string' && typeof rightId === 'string') { return leftId === rightId; }
    const leftName = getModelBaseName(left);
    const rightName = getModelBaseName(right);
    return typeof leftName === 'string' && typeof rightName === 'string'
        && leftName.toLowerCase() === rightName.toLowerCase();
}

function tokenCostBreakdown(tokens: PricingTokenUsage, pricing: ModelPricing | null): CostBreakdown {
    const responseOutput = Math.max(0, tokens.outputTokens - tokens.thinkingTokens);
    const inputCost = pricing ? tokens.inputTokens * pricing.input / 1_000_000 : 0;
    const outputCost = pricing ? responseOutput * pricing.output / 1_000_000 : 0;
    const cacheCost = pricing ? tokens.cacheReadTokens * pricing.cacheRead / 1_000_000 : 0;
    const thinkingCost = pricing ? tokens.thinkingTokens * pricing.thinking / 1_000_000 : 0;
    return { inputCost, outputCost, cacheCost, thinkingCost,
        totalCost: inputCost + outputCost + cacheCost + thinkingCost, pricing };
}

/** Price complete per-call evidence, otherwise use the archived day or a frozen total. */
export function calculateUsageCosts(
    model: string,
    tokens: PricingTokenUsage,
    custom: Record<string, ModelPricing>,
    options: { at?: PricingDate; calls?: readonly DatedPricingUsage[]; callCount?: number; frozenCost?: number } = {},
): CostBreakdown {
    const calls = options.calls || [];
    const fields = ['inputTokens', 'outputTokens', 'thinkingTokens', 'cacheReadTokens'] as const;
    // A retrieval/snapshot time is never a usage date. Only a caller supplying
    // an actual archived calendar day may price the otherwise undated remainder.
    const pricing = findPricingForDate(model, custom, options.at ?? '');
    const usableCalls = (options.callCount === undefined || calls.length <= options.callCount)
        && fields.every(field => calls.every(call => Number.isFinite(call[field]) && call[field] >= 0)
            && calls.reduce((sum, call) => sum + call[field], 0) <= tokens[field]);
    const remainder = { ...tokens };
    const parts: CostBreakdown[] = [];
    if (usableCalls) {
        for (const call of calls) {
            const callPricing = findPricingForDate(call.model || model, custom, call.createdAt);
            if (!callPricing) { continue; }
            parts.push(tokenCostBreakdown(call, callPricing));
            for (const field of fields) { remainder[field] -= call[field]; }
        }
    }
    const hasRemainder = fields.some(field => remainder[field] > 0);
    const override = findPricingWithCustom(model, custom, {});
    const builtIn = findPricing(model);
    const scheduled = builtIn === CARBON_INTRO_PRICING || builtIn === CARBON_STANDARD_PRICING
        || builtIn === ARGON_INTRO_PRICING || builtIn === ARGON_STANDARD_PRICING
        || builtIn === FLASH_INTRO_PRICING || builtIn === FLASH_STANDARD_PRICING;
    if (hasRemainder && !override && (scheduled || !pricing)
        && Number.isFinite(options.frozenCost) && (options.frozenCost || 0) > 0) {
        // A pool/day aggregate may cross a UTC price boundary. Preserve its
        // already-recorded total instead of inventing a split between rate eras.
        return { inputCost: 0, outputCost: 0, cacheCost: 0, thinkingCost: 0,
            totalCost: options.frozenCost!, pricing: pricing || builtIn, costBreakdownUnavailable: true };
    }
    if (hasRemainder && pricing) { parts.push(tokenCostBreakdown(remainder, pricing)); }
    const incomplete = hasRemainder && !pricing;
    const displayedPricing = incomplete ? null : pricing || parts[0]?.pricing || findPricingWithCustom(model, custom);
    const usesHistoricalRates = parts.some(part => part.pricing !== displayedPricing);
    return parts.reduce<CostBreakdown>((total, part) => ({
        inputCost: total.inputCost + part.inputCost, outputCost: total.outputCost + part.outputCost,
        cacheCost: total.cacheCost + part.cacheCost, thinkingCost: total.thinkingCost + part.thinkingCost,
        totalCost: total.totalCost + part.totalCost, pricing: displayedPricing, usesHistoricalRates,
    }), { inputCost: 0, outputCost: 0, cacheCost: 0, thinkingCost: 0, totalCost: 0,
        pricing: displayedPricing, usesHistoricalRates });
}

/** Shared ledger/archival/UI pricing path, with per-call timestamps when retained. */
export function calculateLedgerModelCosts(
    modelKey: string,
    stats: LedgerModelStats,
    bucket: LedgerAccountBucket,
    custom: Record<string, ModelPricing>,
    date?: PricingDate,
): CostBreakdown {
    const calls = (bucket.recordedCalls || []).filter(call => samePricingModel(call.modelKey, modelKey));
    return calculateUsageCosts(modelKey, stats, custom, {
        at: date,
        callCount: stats.calls,
        frozenCost: stats.estimatedCost,
        // createdAtMs can be the ledger's ingestion-time fallback, so it is not
        // evidence of when a historical provider call was actually made.
        calls: calls.map(call => ({ ...call, model: call.modelId || modelKey, createdAt: call.createdAt || '' })),
    });
}

// ─── Cost Calculation ────────────────────────────────────────────────────────

export function calculateCosts(
    summary: GMSummary,
    customPricing: Record<string, ModelPricing>,
): { rows: ModelCostRow[]; grandTotal: number } {
    const entries = Object.entries(summary.modelBreakdown);
    // Merge rows by base model name (e.g. M37 + M16 both → "Gemini 3.1 Pro (High)")
    const mergedRows = new Map<string, ModelCostRow>();
    let grandTotal = 0;

    for (const [name, ms] of entries) {
        const displayName = normalizeModelDisplayName(name);
        const baseName = getModelBaseName(name) || displayName;
        const model = findPricingWithCustom(name, customPricing) ? name : ms.responseModel;
        const calls = (summary.conversations || []).flatMap(conversation => conversation.calls)
            .filter(call => samePricingModel(call.modelDisplay || call.model || call.responseModel, model));
        const costs = calculateUsageCosts(model, {
            inputTokens: ms.totalInputTokens, outputTokens: ms.totalOutputTokens,
            thinkingTokens: ms.totalThinkingTokens, cacheReadTokens: ms.totalCacheRead,
        }, customPricing, { calls, callCount: ms.callCount });
        const { pricing, inputCost, outputCost, cacheCost, thinkingCost, totalCost } = costs;
        const responseOutputTokens = Math.max(0, ms.totalOutputTokens - ms.totalThinkingTokens);
        grandTotal += totalCost;

        const existing = mergedRows.get(baseName);
        if (existing) {
            existing.inputCost += inputCost;
            existing.outputCost += outputCost;
            existing.cacheCost += cacheCost;
            existing.thinkingCost += thinkingCost;
            existing.totalCost += totalCost;
            existing.inputTokens += ms.totalInputTokens;
            existing.outputTokens += responseOutputTokens;
            existing.cacheTokens += ms.totalCacheRead;
            existing.thinkingTokens += ms.totalThinkingTokens;
            existing.usesHistoricalRates ||= costs.usesHistoricalRates;
            if (!pricing) { existing.pricing = null; }
        } else {
            mergedRows.set(baseName, {
                name: displayName, responseModel: ms.responseModel,
                inputCost, outputCost, cacheCost, thinkingCost, totalCost,
                inputTokens: ms.totalInputTokens, outputTokens: responseOutputTokens,
                cacheTokens: ms.totalCacheRead,
                thinkingTokens: ms.totalThinkingTokens, pricing: pricing || null,
                usesHistoricalRates: costs.usesHistoricalRates,
            });
        }
    }

    const rows = [...mergedRows.values()].sort((a, b) => b.totalCost - a.totalCost);
    return { rows, grandTotal };
}

// ─── Pricing Store (globalState persistence) ─────────────────────────────────

const STORAGE_KEY = 'customModelPricing';

export class PricingStore {
    private _custom: Record<string, ModelPricing> = {};
    private _globalState: { get<T>(k: string, d: T): T; update(k: string, v: unknown): Thenable<void> } | null = null;

    /** Initialize from globalState */
    init(globalState: { get<T>(k: string, d: T): T; update(k: string, v: unknown): Thenable<void> }): void {
        this._globalState = globalState;
        this._custom = globalState.get<Record<string, ModelPricing>>(STORAGE_KEY, {});
    }

    /** Get merged pricing table (custom overrides default) */
    getMerged(): Record<string, ModelPricing> {
        return { ...DEFAULT_PRICING, ...this._custom };
    }

    /** Get user custom overrides only */
    getCustom(): Record<string, ModelPricing> {
        return { ...this._custom };
    }

    /** Update custom pricing for a model and persist */
    async set(responseModel: string, pricing: ModelPricing): Promise<void> {
        this._custom[responseModel] = pricing;
        await this._persist();
    }

    /** Bulk set custom pricing and persist */
    async setAll(custom: Record<string, ModelPricing>): Promise<void> {
        this._custom = { ...custom };
        await this._persist();
    }

    /** Reset all custom pricing to defaults */
    async reset(): Promise<void> {
        this._custom = {};
        await this._persist();
    }

    /** Calculate costs using current merged pricing */
    calculateCosts(summary: GMSummary): { rows: ModelCostRow[]; grandTotal: number } {
        return calculateCosts(summary, this._custom);
    }

    private async _persist(): Promise<void> {
        if (this._globalState) {
            await this._globalState.update(STORAGE_KEY, this._custom);
        }
    }
}

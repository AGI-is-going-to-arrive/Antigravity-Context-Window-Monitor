// ─── Pricing Store ───────────────────────────────────────────────────────────
// Manages model pricing data: default built-in prices, user custom overrides
// persisted via globalState, lookup helpers, and cost calculation.
//
// Extracted from gm-panel.ts to enable the dedicated Pricing tab.

import type { GMSummary, GMModelStats } from './gm-tracker';
import { normalizeModelDisplayName, getModelBaseName, resolveModelId, getModelDisplayName } from './models';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ModelPricing {
    input: number;       // $ per 1M input tokens
    output: number;      // $ per 1M output tokens
    cacheRead: number;   // $ per 1M cache read tokens
    cacheWrite: number;  // $ per 1M cache creation tokens
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
}

// ─── Default Pricing Table (per 1M tokens, USD) ─────────────────────────────
// Source: https://platform.claude.com/docs/en/about-claude/pricing
//         https://cloud.google.com/vertex-ai/generative-ai/pricing
// Updated: 2026-05-20
// Cache: Claude cacheWrite = 1.25× input (5-min), cacheRead = 0.1× input
//        Gemini cacheRead = from official table; no separate cacheWrite pricing
// Thinking: = output price (Claude extended thinking / Gemini reasoning output)

export const PRICING_LAST_UPDATED = '2026-09-05';

export const DEFAULT_PRICING: Record<string, ModelPricing> = {
    // ── Claude (platform.claude.com/docs/en/about-claude/pricing) ─────
    'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.50, cacheWrite: 6.25, thinking: 25 },
    'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75, thinking: 15 },
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
    // ACTION REQUIRED ON 2027-01-01: change this row to the post-introductory rates —
    //   { input: 1.50, output: 7.50, cacheRead: 0.15, cacheWrite: 1.875, thinking: 7.50 }
    // which is parity with the 'gemini-3.6-flash' row above.
    // cacheWrite derived at 1.25× input, consistent with how the 3.5/3.6 Flash rows were derived.
    'gemini-3.7-flash': { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.9375, thinking: 3.75 },
    // ── Gemini 3.8 Flash (Google Antigravity + Google launch posts, verified 2026-09-05) ──
    // Same introductory rate and expiry as 3.7 Flash: $0.75 input / $3.75 output through 2026-12-31;
    // from 2027-01-01 the rates become $1.50 / $7.50. Cache rates follow the existing Flash policy.
    'gemini-3.8-flash': { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.9375, thinking: 3.75 },
};

// ─── Pricing Lookup ──────────────────────────────────────────────────────────

/** Find pricing for a model by matching responseModel against a pricing table.
 *  Strategy: exact match → prefix match → fuzzy substring match → displayName fallback */
export function findPricing(
    responseModel: string,
    table: Record<string, ModelPricing> = DEFAULT_PRICING,
): ModelPricing | null {
    if (!responseModel) { return null; }
    if (table[responseModel]) { return table[responseModel]; }
    // Alias resolution: responseModel may be an alias (e.g. 'gemini-pro-default')
    // that maps to a known model ID. Resolve it and find the canonical responseModel.
    const modelId = resolveModelId(responseModel);
    if (modelId) {
        // Try looking up by canonical display name converted to kebab
        const displayName = getModelDisplayName(modelId);
        if (displayName && displayName !== modelId) {
            const kebab = displayName
                .replace(/[()]/g, '')
                .trim()
                .toLowerCase()
                .replace(/\s+/g, '-');
            if (kebab) {
                if (table[kebab]) { return table[kebab]; }
                // Prefix match: 'gemini-3.1-pro-high' should match 'gemini-3.1-pro'
                for (const [key, pricing] of Object.entries(table)) {
                    if (kebab.startsWith(key) || key.startsWith(kebab)) {
                        return pricing;
                    }
                }
            }
        }
    }
    for (const [key, pricing] of Object.entries(table)) {
        if (responseModel.startsWith(key) || key.startsWith(responseModel)) {
            return pricing;
        }
    }
    for (const [key, pricing] of Object.entries(table)) {
        if (responseModel.includes(key) || key.includes(responseModel.split('-').slice(0, 3).join('-'))) {
            return pricing;
        }
    }
    // Fallback: if responseModel looks like a display name (contains spaces/parens),
    // normalize to kebab-case and retry (e.g. "Claude Opus 4.6 (Thinking)" → "claude-opus-4-6-thinking")
    if (/[A-Z\s(]/.test(responseModel)) {
        for (const candidate of kebabCandidates(responseModel)) {
            if (candidate !== responseModel) {
                const hit = findPricing(candidate, table);
                if (hit) { return hit; }
            }
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
        const base = s.replace(/[()]/g, '').trim().toLowerCase().replace(/\s+/g, '-');
        return dashDecimals ? base.replace(/(\d+)\.(\d+)/g, '$1-$2') : base;
    };
    const withoutTier = displayName.replace(/\s*\([^)]*\)\s*$/, '').trim();
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
            if (custom[alias]) { return custom[alias]; }
        }
        const viaCustom = findPricing(responseModel, custom);
        if (viaCustom) { return viaCustom; }
    }
    return findPricing(responseModel, base);
}

/** The spellings a single model answers to: as given, its model id, its display name. */
function pricingLookupAliases(responseModel: string): string[] {
    const out = [responseModel];
    const modelId = resolveModelId(responseModel);
    if (modelId) {
        out.push(modelId);
        const displayName = getModelDisplayName(modelId);
        if (displayName) { out.push(displayName); }
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

// ─── Cost Calculation ────────────────────────────────────────────────────────

export function calculateCosts(
    summary: GMSummary,
    customPricing: Record<string, ModelPricing>,
): { rows: ModelCostRow[]; grandTotal: number } {
    const entries = Object.entries(summary.modelBreakdown);
    // Merge rows by base model name (e.g. M37 + M16 both → "Gemini 3.1 Pro (High)")
    const mergedRows = new Map<string, ModelCostRow>();
    let grandTotal = 0;

    const calcCost = (tokens: number, pricePerM: number) => (tokens / 1_000_000) * pricePerM;

    for (const [name, ms] of entries) {
        const displayName = normalizeModelDisplayName(name);
        const baseName = getModelBaseName(name) || displayName;
        const pricing = findPricingWithCustom(ms.responseModel, customPricing)
            || findPricingWithCustom(name, customPricing);
        const responseOutputTokens = Math.max(0, ms.totalOutputTokens - ms.totalThinkingTokens);

        const inputCost = pricing ? calcCost(ms.totalInputTokens, pricing.input) : 0;
        const outputCost = pricing ? calcCost(responseOutputTokens, pricing.output) : 0;
        const cacheCost = pricing ? calcCost(ms.totalCacheRead, pricing.cacheRead) : 0;
        const thinkingCost = pricing ? calcCost(ms.totalThinkingTokens, pricing.thinking) : 0;
        const totalCost = inputCost + outputCost + cacheCost + thinkingCost;
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
            if (!existing.pricing && pricing) { existing.pricing = pricing; }
        } else {
            mergedRows.set(baseName, {
                name: displayName, responseModel: ms.responseModel,
                inputCost, outputCost, cacheCost, thinkingCost, totalCost,
                inputTokens: ms.totalInputTokens, outputTokens: responseOutputTokens,
                cacheTokens: ms.totalCacheRead,
                thinkingTokens: ms.totalThinkingTokens, pricing: pricing || null,
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

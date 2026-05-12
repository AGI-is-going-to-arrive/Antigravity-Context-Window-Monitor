// ─── Pricing Store ───────────────────────────────────────────────────────────
// Manages model pricing data: default built-in prices, user custom overrides
// persisted via globalState, lookup helpers, and cost calculation.
//
// Extracted from gm-panel.ts to enable the dedicated Pricing tab.

import type { GMSummary, GMModelStats } from './gm-tracker';
import { normalizeModelDisplayName } from './models';

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
// Updated: 2026-03-22
// Cache: Claude cacheWrite = 1.25× input (5-min), cacheRead = 0.1× input
//        Gemini cacheRead = from official table; no separate cacheWrite pricing
// Thinking: = output price (Claude extended thinking / Gemini reasoning output)

export const PRICING_LAST_UPDATED = '2026-03-22';

export const DEFAULT_PRICING: Record<string, ModelPricing> = {
    // ── Claude (platform.claude.com/docs/en/about-claude/pricing) ─────
    'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.50, cacheWrite: 6.25, thinking: 25 },
    'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.30, cacheWrite: 3.75, thinking: 15 },
    // ── GPT-OSS (cloud.google.com/vertex-ai/generative-ai/pricing) ───
    'gpt-oss-120b': { input: 0.09, output: 0.36, cacheRead: 0, cacheWrite: 0, thinking: 0.36 },
    // ── Gemini 3.x (cloud.google.com/vertex-ai/generative-ai/pricing) ─
    'gemini-3.1-pro': { input: 2, output: 12, cacheRead: 0.20, cacheWrite: 2.50, thinking: 12 },
    'gemini-pro-default': { input: 2, output: 12, cacheRead: 0.20, cacheWrite: 2.50, thinking: 12 },  // M16 responseModel alias
    'gemini-3-flash': { input: 0.50, output: 3, cacheRead: 0.05, cacheWrite: 0.625, thinking: 3 },
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
    // normalize to kebab-case and retry (e.g. "Claude Opus 4.6 (Thinking)" → "claude-opus-4.6-thinking")
    if (/[A-Z\s(]/.test(responseModel)) {
        const kebab = responseModel
            .replace(/[()]/g, '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/(\d+)\.(\d+)/g, '$1-$2');  // "4.6" → "4-6"
        if (kebab && kebab !== responseModel) {
            return findPricing(kebab, table);
        }
    }
    return null;
}

// ─── Cost Calculation ────────────────────────────────────────────────────────

export function calculateCosts(
    summary: GMSummary,
    customPricing: Record<string, ModelPricing>,
): { rows: ModelCostRow[]; grandTotal: number } {
    const mergedTable = { ...DEFAULT_PRICING, ...customPricing };
    const entries = Object.entries(summary.modelBreakdown);
    const rows: ModelCostRow[] = [];
    let grandTotal = 0;

    const calcCost = (tokens: number, pricePerM: number) => (tokens / 1_000_000) * pricePerM;

    for (const [name, ms] of entries) {
        const displayName = normalizeModelDisplayName(name);
        const pricing = findPricing(ms.responseModel, mergedTable);
        // responseOutputTokens = totalOutputTokens - totalThinkingTokens
        // This avoids double-counting: outputTokens includes thinking already.
        const responseOutputTokens = Math.max(0, ms.totalOutputTokens - ms.totalThinkingTokens);
        if (!pricing) {
            rows.push({
                name: displayName, responseModel: ms.responseModel,
                inputCost: 0, outputCost: 0, cacheCost: 0, thinkingCost: 0, totalCost: 0,
                inputTokens: ms.totalInputTokens, outputTokens: responseOutputTokens,
                cacheTokens: ms.totalCacheRead,
                thinkingTokens: ms.totalThinkingTokens, pricing: null,
            });
            continue;
        }

        const inputCost = calcCost(ms.totalInputTokens, pricing.input);
        const outputCost = calcCost(responseOutputTokens, pricing.output);
        const cacheCost = calcCost(ms.totalCacheRead, pricing.cacheRead);
        const thinkingCost = calcCost(ms.totalThinkingTokens, pricing.thinking);
        const totalCost = inputCost + outputCost + cacheCost + thinkingCost;
        grandTotal += totalCost;

        rows.push({
            name: displayName, responseModel: ms.responseModel,
            inputCost, outputCost, cacheCost, thinkingCost, totalCost,
            inputTokens: ms.totalInputTokens, outputTokens: responseOutputTokens,
            cacheTokens: ms.totalCacheRead,
            thinkingTokens: ms.totalThinkingTokens, pricing,
        });
    }

    rows.sort((a, b) => b.totalCost - a.totalCost);
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

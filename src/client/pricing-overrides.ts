/**
 * Shared pure-ES2022 pricing input override collector.
 * Imported directly by both the Node/VS Code host (`src/webview-script.ts`)
 * and the independent browser WebView bundle (`src/client/browser/webview-main.ts`),
 * eliminating `Function.prototype.toString()` runtime stitching.
 */

export interface PricingInputLike {
    value: string;
    getAttribute(name: string): string | null;
}

export interface ModelPricingOverride {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    thinking: number;
}

export function collectPricingInputOverrides(
    inputs: ArrayLike<PricingInputLike>,
): Record<string, ModelPricingOverride> {
    const values: Record<string, ModelPricingOverride> = {};
    const shouldPersist: Record<string, boolean> = {};
    const fieldCounts: Record<string, number> = {};
    const blankCounts: Record<string, number> = {};
    const presentFields: Record<string, Set<string>> = {};
    const validFields: Record<string, true> = {
        input: true,
        output: true,
        cacheRead: true,
        cacheWrite: true,
        thinking: true,
    };

    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const model = (input.getAttribute('data-model') || '').trim();
        const rawField = input.getAttribute('data-field') || '';
        if (!model || !validFields[rawField]) { continue; }

        const field = rawField as keyof ModelPricingOverride;
        fieldCounts[model] = (fieldCounts[model] || 0) + 1;
        const rawValue = input.value.trim();
        if (!rawValue) {
            blankCounts[model] = (blankCounts[model] || 0) + 1;
            continue;
        }
        const value = Number(rawValue);
        if (!Number.isFinite(value) || value < 0 || !/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(rawValue)) {
            throw new Error('INVALID_PRICING');
        }
        if (!values[model]) {
            const cacheWrite = Number(input.getAttribute('data-cache-write') || 0);
            values[model] = {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: Number.isFinite(cacheWrite) && cacheWrite >= 0 ? cacheWrite : 0,
                thinking: 0,
            };
            presentFields[model] = new Set();
        }
        values[model][field] = value;
        presentFields[model].add(field);

        const originalRaw = (input.getAttribute('data-original-value') || '').trim();
        const originalValue = originalRaw ? Number(originalRaw) : NaN;
        const wasCustom = input.getAttribute('data-was-custom') === '1';
        if (wasCustom || !Number.isFinite(originalValue) || Math.abs(value - originalValue) > 1e-9) {
            shouldPersist[model] = true;
        }
    }

    const result: Record<string, ModelPricingOverride> = {};
    for (const model of Object.keys(fieldCounts)) {
        // A wholly blank row deliberately removes an override, or leaves an
        // unpriced model unpriced. A partially filled row must never become $0.
        if (blankCounts[model] === fieldCounts[model]) { continue; }
        if (blankCounts[model] || !['input', 'output', 'cacheRead', 'thinking'].every(f => presentFields[model]?.has(f))) {
            throw new Error('INVALID_PRICING');
        }
    }
    for (const [model, pricing] of Object.entries(values)) {
        if (shouldPersist[model]) {
            result[model] = pricing;
        }
    }
    return result;
}

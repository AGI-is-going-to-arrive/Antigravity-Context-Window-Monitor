import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLanguage, setLanguageToState } from '../src/i18n';
import { buildPricingTabContent, getPricingTabStyles } from '../src/pricing-panel';
import { DEFAULT_PRICING, PricingStore, type ModelPricing } from '../src/pricing-store';
import type { GMModelStats, GMSummary } from '../src/gm-tracker';

const initialLanguage = getLanguage();
const langState = { get: <T>(_k: string, fallback: T) => fallback, update: async () => {} };

function makeModelStats(responseModel: string): GMModelStats {
    return {
        calls: 1,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalThinkingTokens: 0,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        totalCredits: 1,
        avgTTFT: 0,
        minTTFT: 0,
        maxTTFT: 0,
        avgStreaming: 0,
        cacheHitRate: 0,
        responseModel,
        apiProvider: '',
        completionConfig: null,
        hasSystemPrompt: false,
        toolCount: 0,
        promptSectionTitles: [],
        totalRetries: 0,
        errorCount: 0,
        creditCallCount: 1,
        exactCallCount: responseModel ? 1 : 0,
        placeholderOnlyCalls: responseModel ? 0 : 1,
        contextWindowCapacity: 0,
    };
}

function makeSummary(modelBreakdown: Record<string, GMModelStats>): GMSummary {
    return {
        conversations: [],
        modelBreakdown,
        totalCalls: 1,
        totalStepsCovered: 1,
        totalCredits: 1,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        totalThinkingTokens: 0,
        contextGrowth: [],
        fetchedAt: '2026-05-06T00:00:00.000Z',
        totalRetryTokens: 0,
        totalRetryCredits: 0,
        totalRetryCount: 0,
        latestTokenBreakdown: [],
        stopReasonCounts: {},
        retryErrorCodes: {},
        recentErrors: [],
        toolCallCounts: {},
        toolCatalog: [],
    };
}

function makeStore(custom: Record<string, ModelPricing> = {}): PricingStore {
    const merged = { ...DEFAULT_PRICING, ...custom };
    return {
        calculateCosts: () => ({ rows: [], grandTotal: 0 }),
        getMerged: () => merged,
        getCustom: () => custom,
    } as unknown as PricingStore;
}

describe('pricing panel', () => {
    it('keeps default pricing rows visible when a called model lacks responseModel', () => {
        const html = buildPricingTabContent(
            makeSummary({ 'Unknown placeholder': makeModelStats('') }),
            makeStore(),
        );

        expect(html).not.toContain('data-model=""');
        expect(html).toContain('data-model="claude-opus-4-6"');
        expect(html).toContain('data-model="gemini-3-flash"');
    });

    it('marks pricing inputs with their original value and custom state', () => {
        const custom = {
            'claude-opus-4-6': { ...DEFAULT_PRICING['claude-opus-4-6'], input: 7 },
        };
        const html = buildPricingTabContent(
            makeSummary({ Claude: makeModelStats('claude-opus-4-6') }),
            makeStore(custom),
        );

        expect(html).toContain('data-model="claude-opus-4-6"');
        expect(html).toContain('data-original-value="7"');
        expect(html).toContain('data-was-custom="1"');
        expect(html).toContain('data-model="gpt-oss-120b"');
        expect(html).toContain('data-was-custom="0"');
    });

    it('marks default-only pricing inputs so saving does not create overrides', () => {
        const html = buildPricingTabContent(null, makeStore());

        expect(html).toContain('data-model="claude-opus-4-6"');
        expect(html).toContain('data-original-value="5"');
        expect(html).toContain('data-was-custom="0"');
    });

    it('exposes both 5.5 family prices before a model has been called', () => {
        const html = buildPricingTabContent(null, new PricingStore());
        expect(html).toContain('Claude Opus 5.5');
        expect(html).toContain('Claude Sonnet 5.5');
        expect(html).toMatch(/data-model="claude-opus-5-5" data-field="input" data-original-value="4"/);
        expect(html).toMatch(/data-model="claude-sonnet-5-5" data-field="input" data-original-value="2"/);
        expect(html).toContain('5-minute TTL');
        expect(html).toContain('5 分钟');
    });

    it('shows generic unknown usage as unavailable with blank editable prices rather than free', () => {
        const html = buildPricingTabContent(
            makeSummary({ 'Future Unpriced Model (High)': makeModelStats('future-unpriced-high') }),
            new PricingStore(),
        );
        expect(html).toContain('Not available');
        expect(html).toContain('Price unavailable');
        expect(html).toContain('The total is incomplete');
        expect(html).toMatch(/data-model="future-unpriced-high" data-field="input" data-original-value=""[^>]*value=""/);
        expect(html).not.toContain('cost-chip-total">$0');
    });

    it('marks mixed totals incomplete without hiding known 5.5 family defaults', () => {
        const html = buildPricingTabContent(makeSummary({
            'Claude Opus 5.5 (High)': makeModelStats('claude-opus-5-5-high'),
            'Future Unpriced Model': makeModelStats('future-unpriced'),
        }), new PricingStore());
        expect(html).toContain('Partial total');
        expect(html).toContain('data-model="claude-sonnet-5-5"');
        expect(html).toContain('data-model="claude-opus-4-6"');
    });

    it('keeps a custom family row editable when a called tier covers that family', async () => {
        const store = new PricingStore();
        await store.set('claude-sonnet-5-5', { ...DEFAULT_PRICING['claude-sonnet-5-5'], input: 7 });
        const html = buildPricingTabContent(makeSummary({
            'Claude Sonnet 5.5 (High)': makeModelStats('claude-sonnet-5-5-high'),
        }), store);
        expect(html).toMatch(/data-model="claude-sonnet-5-5" data-field="input" data-original-value="7" data-was-custom="1"/);
    });

    it('keeps a family editor present when its first tier call arrives', () => {
        const store = new PricingStore();
        const before = buildPricingTabContent(null, store);
        const after = buildPricingTabContent(makeSummary({
            'Claude Opus 5.5 (High)': makeModelStats('claude-opus-5-5-high'),
        }), store);
        for (const html of [before, after]) {
            expect(html.match(/data-model="claude-opus-5-5" data-field="input"/g)).toHaveLength(1);
        }
        expect(after).toContain('data-model="claude-opus-5-5-high"');
    });

    it('does not duplicate an exact family editor when a family-only response is called', () => {
        const html = buildPricingTabContent(makeSummary({
            'Claude Opus 5.5': makeModelStats('claude-opus-5-5'),
        }), new PricingStore());
        expect(html.match(/data-model="claude-opus-5-5" data-field="input"/g)).toHaveLength(1);
    });

    it('renders inline currency controls, Neon verified row/footnote, rate-change banner, and CNY + thinking share + cache savings', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-22T00:00:00Z'));
        try {
            const store = new PricingStore();
            const stats: GMModelStats = {
                ...makeModelStats('gemini-4-neon'),
                totalInputTokens: 1_000_000,
                totalOutputTokens: 200_000,
                totalThinkingTokens: 100_000,
                totalCacheRead: 1_000_000,
            };
            const html = buildPricingTabContent(
                makeSummary({ 'Gemini 4 Neon (XHigh)': stats }),
                store,
                undefined,
                undefined,
                undefined,
                false,
                { currency: 'CNY', cnyRate: 7.2 },
            );

            // Inline currency switcher + FX rate input
            expect(html).toContain('class="currency-toggle-group"');
            expect(html).toContain('class="currency-btn active" data-currency="CNY"');
            expect(html).toContain('id="pricingFxRateInput"');
            // Neon moved from UNVERIFIED_PRICE_KEYS into built-in DEFAULT_PRICING ($3)
            expect(html).toMatch(/data-model="gemini-4-neon" data-field="input" data-original-value="3"/);
            expect(html).not.toContain('data-model="gemini-4-neon-xhigh"');
            expect(html).toContain('https://aistudio.google.com/docs/whats-new-gemini-4-neon');
            // Upcoming rate-change banner (Carbon/Argon Dec 1 + Flash Jan 1)
            expect(html).toContain('class="rate-change-banner"');
            expect(html).toContain('2026-12-01');
            expect(html).toContain('2027-01-01');
            // CNY formatting + Cache savings chip + Thinking share
            expect(html).toContain('¥');
            expect(html).toContain('cost-chip-saved');
            expect(html).toContain('cost-detail-saved');
            expect(html).toContain('cost-share-sub');
            // Updated Custom Orchestrator note
            expect(html).toContain('Custom Orchestrator Mode');
            expect(html).not.toContain('令牌');

            // After all cutovers pass (2027-02-01), rate-change banner disappears cleanly
            vi.setSystemTime(new Date('2027-02-01T00:00:00Z'));
            const postCutover = buildPricingTabContent(null, store);
            expect(postCutover).not.toContain('class="rate-change-banner"');
        } finally {
            vi.useRealTimers();
        }
    });

    it('renders positive bilingual savings without double negatives or zero-rounded dashes and emits FX original value (#31 #6/#8)', async () => {
        await setLanguageToState('both', langState);
        try {
            const store = new PricingStore();
            const stats: GMModelStats = {
                ...makeModelStats('gemini-4-neon'),
                totalInputTokens: 100_000,
                totalOutputTokens: 10_000,
                totalThinkingTokens: 0,
                totalCacheRead: 100_000, // savings = 0.1 * (3.0 - 0.15) = $0.285 -> $0.29 (¥2.05)
            };

            const bothHtml = buildPricingTabContent(
                makeSummary({ 'Gemini 4 Neon (XHigh)': stats }),
                store,
                undefined,
                undefined,
                undefined,
                false,
                { currency: 'both', cnyRate: 7.2 },
            );
            expect(bothHtml).toContain('data-original-value="7.2"');
            expect(bothHtml).toContain('cost-chip-saved');
            expect(bothHtml).toContain('$0.28 (¥2.05)');
            expect(bothHtml).not.toContain('-$0.28');
            expect(bothHtml).not.toContain('(-¥');

            // Tiny CNY savings where formatCurrencySavings rounds to '—' must omit savings chips cleanly
            const tinyStats: GMModelStats = {
                ...makeModelStats('gemini-4-neon'),
                totalInputTokens: 1_000,
                totalOutputTokens: 100,
                totalThinkingTokens: 0,
                totalCacheRead: 1_000, // savings = $0.00285 -> at cnyRate 0.01 = ¥0.0000285 -> '—'
            };
            const tinyHtml = buildPricingTabContent(
                makeSummary({ 'Gemini 4 Neon (XHigh)': tinyStats }),
                store,
                undefined,
                undefined,
                undefined,
                false,
                { currency: 'CNY', cnyRate: 0.01 },
            );
            expect(tinyHtml).not.toContain('cost-chip-saved');
            expect(tinyHtml).not.toContain('cost-detail-saved');
            expect(tinyHtml).not.toContain('Cache saved —');
            expect(tinyHtml).not.toContain('Saved —');

            // WCAG 2.1 AA: .prc-currency-fx.is-muted must not reduce wrapper/button opacity below 4.5:1 contrast
            const styles = getPricingTabStyles();
            expect(styles).not.toMatch(/\.prc-currency-fx\.is-muted\s*\{[^}]*opacity\s*:/);
            expect(styles).toContain('.prc-currency-fx.is-muted .prc-currency-fx-label');
        } finally {
            await setLanguageToState(initialLanguage, langState);
        }
    });
});

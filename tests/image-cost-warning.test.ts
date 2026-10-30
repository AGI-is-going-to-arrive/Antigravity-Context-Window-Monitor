import { afterEach, describe, expect, it } from 'vitest';
import { buildPricingTabContent } from '../src/pricing-panel';
import { PricingStore } from '../src/pricing-store';
import { parseGMEntry } from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { setLanguageToState, type Language } from '../src/i18n';

const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };
afterEach(() => setLanguageToState('both', state));

describe('unmetered image costs', () => {
    it.each(['en', 'zh', 'both'] as Language[])('marks known text fees as partial when an image tool ran in %s', async language => {
        await setLanguageToState(language, state);
        const call = parseGMEntry({ stepIndices: [1], chatModel: { model: 'MODEL_PLACEHOLDER_M419',
            responseModel: 'gemini-4-argon', usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
            chatStartMetadata: { createdAt: '2026-10-31T00:00:00Z' } } });
        const gm = buildSummaryFromConversations([{ cascadeId: 'test', title: 'Fixture', totalSteps: 3,
            coveredSteps: 1, coverageRate: 1 / 3, calls: [call], checkpointSummaries: [] }], '2026-10-31T00:00:01Z')!;
        const store = new PricingStore();
        const html = buildPricingTabContent(gm, store, undefined, undefined, undefined, true);
        expect(html).toContain('image-cost-unavailable');
        expect(html).toContain(language === 'zh' ? '未计入图片生成费用' : 'exclude image-generation fees');
        expect(html).toContain(language === 'zh' ? '已知小计' : 'Partial total');
        expect(html).toContain('$12.00');
        expect(html).not.toContain('data-tooltip="Avg per Call"');
        expect(html).toContain('https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-image');
        expect(store.calculateCosts(gm).grandTotal).toBe(12);
    });

    it('does not show an image-cost warning for ordinary text or image-input conversations', () => {
        expect(buildPricingTabContent(null, new PricingStore())).not.toContain('image-cost-unavailable');
    });
});

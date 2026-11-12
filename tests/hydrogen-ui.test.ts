import { afterEach, describe, expect, it } from 'vitest';
import { setLanguageToState, type Language } from '../src/i18n';
import { getModelDisplayName, setAvailableImageModelIds, updateModelDisplayNames, type ModelConfig } from '../src/models';
import { buildModelQuotaGrid } from '../src/webview-profile-tab';
import { buildModelsTabContent } from '../src/webview-models-tab';
import type { StateBucket } from '../src/durable-state';

const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };
const hydrogenIds = ['M527', 'M526', 'M525', 'M528'];
function config(id: string, quota = 0.8, label?: string): ModelConfig {
    const model = `MODEL_PLACEHOLDER_${id}`;
    return { model, label: label || getModelDisplayName(model), supportsImages: true, allowedTiers: [],
        mimeTypeCount: 0, isRecommended: false, supportedMimeTypes: [],
        quotaInfo: { remainingFraction: quota, resetTime: '2026-11-14T00:00:00Z' } };
}

afterEach(async () => {
    updateModelDisplayNames([], { authoritative: true });
    setAvailableImageModelIds([]);
    await setLanguageToState('both', state);
});

describe('Hydrogen four-effort UI', () => {
    it.each(['en', 'zh', 'both'] as Language[])('localizes Extra in pool membership and expanded readings in %s', async language => {
        await setLanguageToState(language, state);
        const configs = hydrogenIds.map((id, i) => config(id, i === 3 ? 0.2 : 0.8));
        const html = buildModelQuotaGrid(configs);
        const effortList = language === 'en' ? 'Low · Medium · High · Extra'
            : language === 'zh' ? '低 · 中 · 高 · 超高' : 'Low · Medium · High · Extra / 低 · 中 · 高 · 超高';
        const extra = language === 'en' ? 'Extra' : language === 'zh' ? '超高' : 'Extra / 超高';
        expect(html).toContain(effortList);
        expect(html).toContain(`Gemini 4 Hydrogen (${extra})`);
        expect(html).toContain('20–80%');
        expect(html).toContain('aria-valuenow="20"');
        expect(html).not.toContain('undefined');
        expect(html.match(/data-quota-family=/g)).toHaveLength(1);
        expect(html.match(/<li><span>Gemini 4 Hydrogen \(/g)).toHaveLength(4);
    });

    it.each(['en', 'zh', 'both'] as Language[])('only lists the available Extra tier after an account switch in %s', async language => {
        await setLanguageToState(language, state);
        const full = hydrogenIds.map(id => config(id));
        updateModelDisplayNames(full, { authoritative: true });
        expect(buildModelsTabContent(null, full).match(/class="spec-card"/g)).toHaveLength(4);
        const extraOnly = [config('M528')];
        updateModelDisplayNames(extraOnly, { authoritative: true });
        const html = buildModelsTabContent(null, extraOnly);
        expect(html.match(/class="spec-card"/g)).toHaveLength(1);
        expect(html).toContain('gemini-4-hydrogen-xhigh');
        expect(html).not.toContain('gemini-4-hydrogen-high');
        expect(html).not.toContain('gemini-4-hydrogen-medium');
        expect(html).not.toContain('gemini-4-hydrogen-low');
        expect(html).not.toContain('Low · Medium · High');
        updateModelDisplayNames([], { authoritative: true });
        expect(buildModelsTabContent(null, [])).not.toContain('class="spec-card"');
    });

    it.each(['en', 'zh', 'both'] as Language[])('keeps invalid Extra quota unknown and reports missing reset in %s', async language => {
        await setLanguageToState(language, state);
        const extra = config('M528', NaN);
        extra.quotaInfo!.resetTime = '2026-02-30T00:00:00Z';
        const html = buildModelQuotaGrid([extra]);
        expect(html).toContain(language === 'zh' ? '未知' : 'Unknown');
        expect(html).toContain(language === 'zh' ? '重置时间未知' : 'Reset time unavailable');
        expect(html).not.toContain('aria-valuenow=');
        expect(html).not.toMatch(/NaN|Infinity|undefined/);
    });

    it('escapes account-supplied Hydrogen labels in both cards and quota details', () => {
        const label = 'Gemini 4 Hydrogen (Extra) <img src=x onerror="injected()">';
        const html = buildModelsTabContent(null, [config('M528', 0.2, label), config('M527', 0.8)]);
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
        expect(html).toContain('gemini-4-hydrogen-xhigh');
    });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { groupModelQuotas } from '../src/model-quota';
import { buildModelQuotaGrid } from '../src/webview-profile-tab';
import { buildModelsTabContent } from '../src/webview-models-tab';
import { getModelDisplayName, getModelSpecs, updateModelDisplayNames, updateModelSpec, type ModelConfig } from '../src/models';
import { setLanguageToState, type Language } from '../src/i18n';
import type { StateBucket } from '../src/durable-state';

const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };
const RESET = '2026-11-12T01:00:00Z';
const CURRENT_IDS = ['M437', 'M427', 'M438', 'M418', 'M417', 'M419', 'M319', 'M318', 'M320',
    'M401', 'M402', 'M400', 'M404', 'M405', 'M403', 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM'];

function config(id: string, fraction = 0.8, resetTime = RESET, label?: string): ModelConfig {
    const model = /^M\d+$/.test(id) ? `MODEL_PLACEHOLDER_${id}` : id;
    return { model, label: label || getModelDisplayName(model), supportsImages: true,
        allowedTiers: [], mimeTypeCount: 0, supportedMimeTypes: [], isRecommended: false,
        quotaInfo: { remainingFraction: fraction, resetTime } };
}

beforeEach(() => setLanguageToState('en', state));
afterEach(async () => {
    updateModelDisplayNames([], { authoritative: true });
    await setLanguageToState('both', state);
});

describe('model quota pool grouping', () => {
    it('reduces sixteen chat efforts to two shared pools while retaining six families and sixteen metadata cards', () => {
        const configs = CURRENT_IDS.map(id => config(id));
        const before = structuredClone(configs);
        const groups = groupModelQuotas(configs);
        expect(groups.map(g => g.label)).toEqual(['Gemini', 'Claude / GPT']);
        expect(groups.map(g => g.readings.length)).toEqual([9, 7]);
        const members = groups.flatMap(g => g.members);
        expect(members.map(m => m.label)).toEqual(['Gemini 4 Carbon', 'Gemini 4 Argon', 'Gemini 3.8 Flash',
            'Claude Opus 5.5', 'Claude Sonnet 5.5', 'GPT-OSS 120B']);
        expect(members.slice(0, 5).every(m => m.efforts.join(',') === 'low,medium,high')).toBe(true);
        expect(members[5].efforts).toEqual(['medium']);
        expect(groups.every(g => g.minimum === 0.8 && g.maximum === 0.8 && !g.quotaDiffers && !g.resetDiffers)).toBe(true);
        const html = buildModelsTabContent(null, configs);
        expect(html.match(/class="model-card"/g)).toHaveLength(2);
        expect(html.match(/class="spec-card"/g)).toHaveLength(16);
        expect(configs).toEqual(before);
    });

    it('keeps first pool/family occurrence order and renders only available efforts', () => {
        const groups = groupModelQuotas([config('M401'), config('M418'), config('M437'), config('M417')]);
        expect(groups.map(g => g.label)).toEqual(['Claude / GPT', 'Gemini']);
        expect(groups[1].members.map(m => m.label)).toEqual(['Gemini 4 Argon', 'Gemini 4 Carbon']);
        expect(groups[1].members[0].efforts).toEqual(['medium', 'high']);
        expect(groups[1].members[1].efforts).toEqual(['medium']);
        expect(buildModelQuotaGrid([config('M437')])).not.toContain('Low · Medium · High');
    });

    it('does not sum or mix independent Gemini and premium percentages', () => {
        const groups = groupModelQuotas([config('M438', 0.4), config('M419', 0.4),
            config('M400', 0.9), config('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 0.9)]);
        expect(groups.map(g => [g.pool, g.minimum, g.maximum, g.quotaDiffers])).toEqual([
            ['gemini', 0.4, 0.4, false], ['premium', 0.9, 0.9, false],
        ]);
    });

    it.each([
        ['M437', 'Gemini', 'Gemini 4 Carbon', 'medium'],
        ['M400', 'Claude / GPT', 'Claude Opus 5.5', 'low'],
        ['MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 'Claude / GPT', 'GPT-OSS 120B', 'medium'],
    ])('supports a single available effort %s without implying absent model efforts', (id, poolLabel, memberLabel, effort) => {
        const groups = groupModelQuotas([config(id)]);
        expect(groups).toHaveLength(1);
        expect(groups[0].label).toBe(poolLabel);
        expect(groups[0].members).toHaveLength(1);
        expect(groups[0].members[0]).toMatchObject({ label: memberLabel, efforts: [effort] });
    });

    it('supports an account with only the Gemini pool', () => {
        const groups = groupModelQuotas(CURRENT_IDS.slice(0, 9).map(id => config(id)));
        expect(groups).toHaveLength(1);
        expect(groups[0].members).toHaveLength(3);
        expect(buildModelQuotaGrid(CURRENT_IDS.slice(0, 9).map(id => config(id)))).not.toContain('Claude / GPT');
    });

    it('normalizes canonical, English, Chinese and diagnostic aliases without duplicate readings', () => {
        const aliases = ['MODEL_PLACEHOLDER_M438', 'gemini-4-carbon-low', 'GEMINI_4_CARBON_LOW',
            'Gemini 4 Carbon Low', 'Gemini 4 Carbon（低）', 'Gemini 4 Carbon (低) (M438)'];
        const groups = groupModelQuotas(aliases.map(alias => config(alias, 0.8, RESET, alias)));
        expect(groups).toHaveLength(1);
        expect(groups[0].readings).toHaveLength(1);
        expect(groups[0].efforts).toEqual(['low']);
    });

    it('lists generations and families separately inside their pool while image quota remains independent', () => {
        const groups = groupModelQuotas(['M438', 'M419', 'M320', 'M300', 'M322', 'M21', 'M400', 'M403'].map(id => config(id)));
        expect(groups).toHaveLength(3);
        expect(groups[0].pool).toBe('gemini');
        expect(groups[0].members).toHaveLength(5);
        expect(groups[1]).toMatchObject({ pool: undefined, label: 'Gemini 3.1 Flash Image' });
        expect(groups[2].pool).toBe('premium');
        expect(groups[2].members).toHaveLength(2);
    });

    it('keeps unknown IDs independent even when their labels imitate a known family', () => {
        const groups = groupModelQuotas([
            config('future-a', 0.8, RESET, 'Gemini 4 Carbon (High)'),
            config('future-b', 0.8, RESET, 'Gemini 4 Carbon (Low)'),
            config('M438'),
        ]);
        expect(groups).toHaveLength(3);
        expect(groups.slice(0, 2).every(g => g.efforts.length === 0)).toBe(true);
    });

    it('uses the registry quota contract instead of creating a second provider mapping', () => {
        const original = { ...getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M437')! };
        try {
            updateModelSpec('MODEL_PLACEHOLDER_M437', { apiProvider: 'OPENAI_VERTEX' });
            const groups = groupModelQuotas([config('M438'), config('M437')]);
            expect(groups).toHaveLength(1);
            expect(groups[0].pool).toBe('gemini');
        } finally { updateModelSpec(original.placeholderId, original); }
    });

    it('preserves live names while using catalog identity even if a label names another family', () => {
        const configs = [config('M437', 0.8, RESET, 'Account Carbon (Medium)'),
            config('M427', 0.8, RESET, 'Gemini 4 Argon (High)'), config('M438', 0.8, RESET, 'Account Carbon（低）（M438）')];
        updateModelDisplayNames(configs, { authoritative: true });
        const groups = groupModelQuotas(configs);
        expect(groups).toHaveLength(1);
        expect(groups[0].members[0].label).toBe('Account Carbon');
        expect(groups[0].efforts).toEqual(['low', 'medium', 'high']);
        const html = buildModelQuotaGrid(configs);
        expect(html).toContain('Gemini 4 Argon (High)');
        expect(groupModelQuotas([configs[2]])[0].members[0].label).toBe('Account Carbon');
    });

    it('groups legacy Flash IDs by their verified efforts despite misleading catalogs and renamed labels', () => {
        const configs = [config('M84', 0.8, RESET, '账号 Flash（高）'),
            config('M20', 0.8, RESET, '账号 Flash（中）'), config('M187', 0.8, RESET, '账号 Flash（低）')];
        updateModelDisplayNames(configs, { authoritative: true });
        const groups = groupModelQuotas(configs);
        expect(groups).toHaveLength(1);
        expect(groups[0].members[0].label).toBe('账号 Flash');
        expect(groups[0].efforts).toEqual(['low', 'medium', 'high']);
        expect(groups[0].readings.map(r => [r.model, r.effort])).toEqual([
            ['MODEL_PLACEHOLDER_M187', 'low'], ['MODEL_PLACEHOLDER_M20', 'medium'], ['MODEL_PLACEHOLDER_M84', 'high'],
        ]);
    });

    it('clears families when the account catalog becomes empty', () => {
        expect(groupModelQuotas([config('M438')])).toHaveLength(1);
        expect(groupModelQuotas([])).toEqual([]);
        expect(buildModelQuotaGrid([])).toBe('');
    });

    it('does not treat an unknown raw ID equal to a pool name as a canonical pool', () => {
        const groups = groupModelQuotas([config('gemini'), config('premium'), config('M438')]);
        expect(groups).toHaveLength(3);
        expect(groups.map(g => g.pool)).toEqual([undefined, undefined, 'gemini']);
    });

    it.each(['gemini', 'premium'])('keeps live-registered unknown ID %s separate from the canonical quota pool', id => {
        const configs = [config(id, 0.8, RESET, `Unknown ${id} model`), config('M438'), config('M400')];
        updateModelDisplayNames(configs, { authoritative: true });
        const groups = groupModelQuotas(configs);
        expect(groups).toHaveLength(3);
        expect(groups.map(g => g.pool)).toEqual([undefined, 'gemini', 'premium']);
        expect(groups[0].readings.map(reading => reading.model)).toEqual([id]);
    });
});

describe('quota differences and incomplete readings', () => {
    it('identifies the full model and effort in conflicting cross-family readings', () => {
        const html = buildModelQuotaGrid([config('M438', 0.4), config('M419', 0.8)]);
        expect(html.match(/class="model-card"/g)).toHaveLength(1);
        expect(html).toContain('40–80%');
        expect(html).toContain('<li><span>Gemini 4 Carbon (Low)</span>');
        expect(html).toContain('<li><span>Gemini 4 Argon (Low)</span>');
        expect(html).not.toContain('<li><span>Low</span>');
    });

    it('preserves raw differences rather than averaging, summing or rounding them away', () => {
        const configs = [config('M438', 0.801), config('M437', 0.804), config('M427', 0.9)];
        const group = groupModelQuotas(configs)[0];
        expect(group).toMatchObject({ minimum: 0.801, maximum: 0.9, quotaDiffers: true });
        const html = buildModelQuotaGrid(configs);
        expect(html.match(/class="model-card"/g)).toHaveLength(1);
        expect(html).toContain('80.1–90%');
        expect(html).toContain('width:80.1%');
        expect(html).toContain('Reported values differ');
        expect(html).toContain('<details');
        expect(html).toContain('80.4%');
    });

    it.each([0.29, 0.58])('formats fraction %s without binary floating-point noise', fraction => {
        const html = buildModelQuotaGrid([config('M438', fraction)]);
        expect(html).toContain(`>${Math.round(fraction * 100)}%</span>`);
        expect(html).toContain(`width:${Math.round(fraction * 100)}%`);
        expect(html).not.toMatch(/999999999|000000001/);
    });

    it('keeps a compact range for inexact binary fractions', () => {
        const html = buildModelQuotaGrid([config('M438', 0.29), config('M437', 0.58)]);
        expect(html).toContain('29–58%');
        expect(html).toContain('width:29%');
    });

    it('discloses a raw difference below the displayed precision', () => {
        const html = buildModelQuotaGrid([config('M438', 0.7000000000001), config('M437', 0.7000000000002)]);
        expect(html).toContain('>70%</span>');
        expect(html).toContain('Reported values differ');
        expect(html).toContain('Differences are below displayed precision.');
    });

    it('preserves conflicting duplicate samples but deduplicates exact aliases', () => {
        const configs = [config('M438', 0.8), config('gemini-4-carbon-low', 0.8), config('M438', 0.5)];
        const groups = groupModelQuotas(configs);
        expect(groups).toHaveLength(1);
        expect(groups[0]).toMatchObject({ efforts: ['low'], minimum: 0.5, maximum: 0.8, quotaDiffers: true });
        expect(groups[0].readings).toHaveLength(2);
    });

    it('compares reset instants across timezone spellings and exposes different instants', () => {
        const same = [config('M438', 0.8, RESET), config('M437', 0.8, '2026-11-12T12:00:00+11:00')];
        expect(groupModelQuotas(same)[0].resetDiffers).toBe(false);
        expect(buildModelQuotaGrid(same)).not.toContain('<details');
        const different = [...same, config('M427', 0.8, '2026-11-12T01:00:01Z')];
        expect(groupModelQuotas(different)[0].resetDiffers).toBe(true);
        expect(buildModelQuotaGrid(different)).toContain('Reset times differ');
    });

    it.each(['', 'not-a-date', '0', '2026-11-12T01:00:00', '2026-02-30T01:00:00Z'])('does not claim missing or invalid reset %j', reset => {
        const groups = groupModelQuotas([config('M438', 0.8, reset)]);
        expect(groups[0]).toMatchObject({ resetTime: null, missingReset: true });
        expect(buildModelQuotaGrid([config('M438', 0.8, reset)])).toContain('Reset time unavailable');
    });

    it.each([NaN, Infinity, -Infinity, -0.1, 1.1])('renders invalid fraction %s as unknown without an invalid CSS width', fraction => {
        const configs = [config('M438', fraction)];
        expect(groupModelQuotas(configs)[0]).toMatchObject({ minimum: null, maximum: null, missingQuota: true });
        const html = buildModelQuotaGrid(configs);
        expect(html).toContain('Unknown');
        expect(html).not.toContain('aria-valuenow=');
        expect(html).not.toContain('style="width:');
        expect(html).not.toMatch(/NaN|Infinity/);
    });

    it('keeps missing effort quota visible beside known readings and supports exact zero and full quota', () => {
        const missing = { ...config('M427'), quotaInfo: undefined };
        const group = groupModelQuotas([config('M438', 0), config('M437', 1), missing])[0];
        expect(group).toMatchObject({ minimum: 0, maximum: 1, missingQuota: true, missingReset: true, quotaDiffers: true });
        expect(group.readings).toHaveLength(3);
        const html = buildModelQuotaGrid([missing]);
        expect(html.match(/class="model-card"/g)).toHaveLength(1);
        expect(html).toContain('Unknown');
        expect(html).not.toContain('>0%<');
    });
});

describe('quota card rendering', () => {
    it.each(['en', 'zh', 'both'] as Language[])('renders compact normal and explanatory incomplete cards in %s', async lang => {
        await setLanguageToState(lang, state);
        const normal = buildModelQuotaGrid(['M427', 'M438', 'M437'].map(id => config(id)));
        expect(normal.match(/class="model-card-pct"/g)).toHaveLength(1);
        expect(normal.match(/class="model-card-reset"/g)).toHaveLength(1);
        expect(normal).not.toContain('<details');
        expect(normal).toContain(lang === 'en' ? 'Low · Medium · High' : lang === 'zh' ? '低 · 中 · 高' : 'Low · Medium · High / 低 · 中 · 高');
        const incomplete = buildModelQuotaGrid([config('M438', 0.8), { ...config('M427'), quotaInfo: undefined }]);
        expect(incomplete).toContain(lang === 'zh' ? '部分配额或重置数据缺失' : 'Some quota or reset data is unavailable');
        expect(incomplete).toContain(lang === 'zh' ? '各档位读数' : 'Readings by effort');
    });

    it('escapes live labels, tags, unknown IDs and malicious reset values', () => {
        const bad = '"><img src=x onerror=alert(1)>';
        const configs = [{ ...config('M438', 0.8, bad, bad), tagTitle: bad }, config(bad, 0.5, bad, bad)];
        const html = buildModelQuotaGrid(configs);
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img');
        expect(html).not.toContain('aria-label=""><');
        expect(html).toContain('Reset time unavailable');
    });
});

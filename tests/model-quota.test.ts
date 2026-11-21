import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { groupModelQuotas } from '../src/model-quota';
import { buildModelQuotaGrid } from '../src/webview-profile-tab';
import { buildModelsTabContent } from '../src/webview-models-tab';
import { getModelDisplayName, getModelSpecs, updateModelDisplayNames, updateModelSpec, type ModelConfig } from '../src/models';
import { setLanguageToState, tBiHtml, type Language } from '../src/i18n';
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

    it('recognizes new model families when provider, catalog ID and thinking level agree', () => {
        const models = [
            ['M98701', 'future-studio-7-low', 'ProviderA', 1, 'Studio 7 (Low)'],
            ['M98702', 'future-studio-7-medium', 'ProviderA', 2, 'Studio 7（中）'],
            ['M98703', 'future-studio-7-high', 'ProviderA', 3, 'Studio 7 (High)'],
            ['M98704', 'future-studio-7-extra', 'ProviderA', 100, 'Studio 7 (Extra)'],
            ['M98705', 'future-studio-7-high', 'ProviderB', 3, 'Studio 7 (High)'],
            ['M98706', 'future-studio-7-low', 'ProviderA', 3, 'Studio 7 (Low)'],
        ] as const;
        for (const [id, modelId, apiProvider, thinkingLevel, displayName] of models) {
            updateModelSpec(`MODEL_PLACEHOLDER_${id}`, { modelId, apiProvider, thinkingLevel, displayName, supportsThinking: true });
        }
        const groups = groupModelQuotas(models.map(([id, , , , label], i) => config(id, 0.5 + i / 100, RESET, label)));
        expect(groups).toHaveLength(3);
        expect(groups[0]).toMatchObject({
            label: 'Studio 7', efforts: ['low', 'medium', 'high', 'xhigh'],
            minimum: 0.5, maximum: 0.53, quotaDiffers: true,
        });
        expect(groups[0].members).toHaveLength(1);
        expect(groups[1].efforts).toEqual(['high']);
        expect(groups[2].efforts).toEqual([]);
        expect(groups.every(group => group.pool === undefined)).toBe(true);
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

    it.each([
        '',
        'not-a-date',
        '0',
        '1970',
        '1969-12-31T23:59:59Z',
        '1970-01-01T00:00:00Z',
        '1970-01-01T00:00:00.000Z',
        '1970-01-01T00:00:00+00:00',
        '2026-11-12T01:00:00',
        '2026-02-30T01:00:00Z',
        '2026-11-21T24:00:00Z',
    ])('does not claim missing, epoch or invalid reset %j', reset => {
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
        expect(normal).toContain(tBiHtml('Low · Medium · High', '低 · 中 · 高'));
        expect(normal.replace(/<[^>]+>/g, '')).toContain(lang === 'en' ? 'Low · Medium · High' : lang === 'zh' ? '低 · 中 · 高' : 'Low · Medium · High / 低 · 中 · 高');
        const incomplete = buildModelQuotaGrid([config('M438', 0.8), { ...config('M427'), quotaInfo: undefined }]);
        expect(incomplete).toContain(tBiHtml('Some quota or reset data is unavailable', '部分配额或重置数据缺失'));
        expect(incomplete).toContain(tBiHtml('Readings by effort', '各档位读数'));
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

    it('universally merges efforts across Neon, Hydrogen, Carbon, Argon, Claude 5.5, GPT-OSS while keeping all 3 Orchestrators distinct', () => {
        const configs: ModelConfig[] = [
            // Gemini 4 Neon (4 efforts -> 1 model)
            config('M534', 0.70, RESET, 'Gemini 4 Neon (Low)'),
            config('M533', 0.70, RESET, 'Gemini 4 Neon (Medium)'),
            config('M532', 0.45, RESET, 'Gemini 4 Neon (High)'),
            { ...config('M535', 0.70, RESET, 'Gemini 4 Neon (Extra / 超高)'), tagTitle: 'New' },
            // 3 distinct Orchestrator variants -> 3 models
            config('M537', 0.70, RESET, 'Orchestrator (Neon)'),
            config('M667', 0.70, RESET, 'Orchestrator (Carbon)'),
            config('M681', 0.70, RESET, 'Orchestrator (Argon)'),
            // Gemini 4 Hydrogen (4 efforts -> 1 model)
            config('M527', 0.70), config('M526', 0.70), config('M525', 0.70), config('M528', 0.70),
            // Gemini 4 Carbon (3 efforts -> 1 model) & Argon (3 efforts -> 1 model)
            config('M438', 0.70), config('M437', 0.70), config('M427', 0.70),
            config('M419', 0.70), config('M418', 0.70), config('M417', 0.70),
            // Claude Opus 5.5 (3 -> 1), Sonnet 5.5 (3 -> 1), GPT-OSS 120B (1 -> 1)
            config('M400', 0.90), config('M401', 0.80), config('M402', 0.90),
            config('M403', 0.90), config('M404', 0.90), config('M405', 0.90),
            config('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 0.90),
        ];
        const groups = groupModelQuotas(configs);
        expect(groups.map(g => g.label)).toEqual(['Gemini', 'Claude / GPT']);
        const [gemini, premium] = groups;
        expect(gemini.members.map(m => m.label)).toEqual([
            'Gemini 4 Neon', 'Orchestrator (Neon)', 'Orchestrator (Carbon)', 'Orchestrator (Argon)',
            'Gemini 4 Hydrogen', 'Gemini 4 Carbon', 'Gemini 4 Argon',
        ]);
        expect(gemini.members[0].efforts).toEqual(['low', 'medium', 'high', 'xhigh']);
        expect(gemini.members[0].tagTitle).toBe('New');
        expect(gemini).toMatchObject({ minimum: 0.45, maximum: 0.70, quotaDiffers: true });
        expect(premium.members.map(m => m.label)).toEqual(['Claude Opus 5.5', 'Claude Sonnet 5.5', 'GPT-OSS 120B']);
        expect(premium).toMatchObject({ minimum: 0.80, maximum: 0.90, quotaDiffers: true });
    });

    it('merges retired placeholder IDs (M37/M36 and M264/M265/M266) even without active specs and strips legacy Chinese 强/弱 labels', () => {
        const proGroups = groupModelQuotas([
            config('M37', 0.8, RESET, 'Gemini 3.1 Pro (强)'),
            config('M36', 0.6, RESET, 'Gemini 3.1 Pro (弱)'),
        ]);
        expect(proGroups).toHaveLength(1);
        expect(proGroups[0].members).toHaveLength(1);
        expect(proGroups[0].members[0]).toMatchObject({ label: 'Gemini 3.1 Pro', efforts: ['low', 'high'] });
        expect(proGroups[0]).toMatchObject({ minimum: 0.6, maximum: 0.8, quotaDiffers: true });

        const flash36Groups = groupModelQuotas([
            config('M264', 0.5, RESET, 'Gemini 3.6 Flash (High)'),
            config('M265', 0.5, RESET, 'Gemini 3.6 Flash (Medium)'),
            config('M266', 0.5, RESET, 'Gemini 3.6 Flash (Low)'),
        ]);
        expect(flash36Groups).toHaveLength(1);
        expect(flash36Groups[0].members).toHaveLength(1);
        expect(flash36Groups[0].members[0]).toMatchObject({ label: 'Gemini 3.6 Flash', efforts: ['low', 'medium', 'high'] });
    });
});

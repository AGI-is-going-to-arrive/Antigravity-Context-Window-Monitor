// Consolidated Gate Suite #6: Webview Helpers, Script Escaping & Tooltip Budget
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { getLanguage, setLanguageInMemory } from '../src/i18n-core';
import {
    esc,
    formatDuration,
    formatFileSize,
    formatShortTime,
    formatTime,
    richTipAttrs,
    richTipBiAttrs,
    slugKey,
    tBiHtml,
    toSafeTipKey,
} from '../src/webview-helpers';
import * as vscode from 'vscode';
import { setLanguageToState } from '../src/i18n';
import { normalizeModelDisplayName, resolveModelId, updateModelSpec } from '../src/models';
import { buildSettingsContent } from '../src/webview-settings-tab';
import { collectPricingInputOverrides, getScript } from '../src/webview-script';
import { showMonitorPanel, syncMonitorPanelSettings, updateMonitorPanel } from '../src/webview-panel';
import {
    applySectionBudget,
    countSectionLines,
    getSectionLineBudget,
    type HoverSection,
    poolSizeSuffix,
    type QuotaSelectable,
    renderHoverSections,
    SECTION_COMPACT_MAX_LINES,
    SECTION_FULL_MAX_LINES,
    SECTION_NORMAL_MAX_LINES,
    selectQuotaRows,
} from '../src/tooltip-budget';

describe('[webview-helpers]', () => {
    const originalLang = getLanguage();


    afterEach(() => {
        setLanguageInMemory(originalLang);
    });


    describe('src/webview-helpers — converged shared tooltip/slug/format helpers', () => {
        it('normalizes popover slug keys safely and bounds length cleanly', () => {
            expect(slugKey('Gemini 4 Neon (High)')).toBe('gemini-4-neon-high');
            expect(slugKey('  ___Model::A/B+C___  ')).toBe('___model-a-b-c___');
            expect(slugKey('!!!@@@###')).toBe('item');
            expect(slugKey('')).toBe('item');

            const longSlug = slugKey('a'.repeat(40) + '-'.repeat(20) + 'bbbb', 48);
            expect(longSlug.length).toBeLessThanOrEqual(48);
            expect(longSlug.endsWith('-')).toBe(false);

            expect(toSafeTipKey('Tool Name / Run Command')).toBe('tool-name-run-command');
            expect(toSafeTipKey('')).toBe('item');
        });

        it('renders richTipAttrs identically for both structured RichTipSpec and positional overloads with HTML escaping', () => {
            // Object spec defaults to leading space (Overview tab style)
            const specAttrs = richTipAttrs({
                key: 'overview:runway:gemini',
                title: 'Quota "Runway" <5h>',
                body: 'Line 1 & Line 2',
                meta: 'Window: 45m',
                htmlId: 'tpl-runway',
                pin: true,
                focusable: true,
            });
            expect(specAttrs).toBe(
                ' data-popover-key="overview:runway:gemini"'
                + ' data-tip-title="Quota &quot;Runway&quot; &lt;5h&gt;"'
                + ' data-tip-body="Line 1 &amp; Line 2"'
                + ' data-tip-meta="Window: 45m"'
                + ' data-tip-html-id="tpl-runway"'
                + ' data-tip-pin="true"'
                + ' tabindex="0"',
            );

            // Object spec with leadingSpace: false
            const noLead = richTipAttrs({
                key: 'k1',
                body: 'Simple body',
                leadingSpace: false,
            });
            expect(noLead).toBe('data-popover-key="k1" data-tip-body="Simple body"');

            // Positional overload omits leading space (Activity / Pricing / Chat-History / Orchestrator style)
            const posAttrs = richTipAttrs('gm:speed', 'Speed', 'Tokens/sec', 'Recent calls', 'tpl-speed');
            expect(posAttrs).toBe(
                'data-popover-key="gm:speed"'
                + ' data-tip-title="Speed"'
                + ' data-tip-body="Tokens/sec"'
                + ' data-tip-meta="Recent calls"'
                + ' data-tip-html-id="tpl-speed"',
            );

            // Omits optional empty attributes
            const minimalPos = richTipAttrs('k2', 'Title', '');
            expect(minimalPos).toBe('data-popover-key="k2" data-tip-title="Title"');
        });

        it('renders richTipBiAttrs honoring active language mode', () => {
            setLanguageInMemory('en');
            expect(richTipBiAttrs('m:cap', 'Cap', '上限', 'Native window', '原生窗口', 'Meta EN', '元信息'))
                .toBe(' data-popover-key="m:cap" data-tip-title="Cap" data-tip-body="Native window" data-tip-meta="Meta EN"');

            setLanguageInMemory('zh');
            expect(richTipBiAttrs('m:cap', 'Cap', '上限', 'Native window', '原生窗口'))
                .toBe(' data-popover-key="m:cap" data-tip-title="上限" data-tip-body="原生窗口"');

            setLanguageInMemory('both');
            const bi = richTipBiAttrs('m:cap', 'Cap', '上限', 'Native window', '原生窗口', undefined, undefined, { focusable: true });
            expect(bi).toContain('data-tip-title="Cap / 上限"');
            expect(bi).toContain('data-tip-body="Native window / 原生窗口"');
            expect(bi).toContain('tabindex="0"');
        });

        it('preserves existing webview-helpers utilities intact', () => {
            expect(esc(`<a href="x">&</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
            expect(formatTime('')).toBe('—');
            expect(formatTime('invalid<tag>')).toBe('invalid&lt;tag&gt;');
            expect(formatShortTime('')).toBe('—');
            expect(formatDuration(-500)).toBe('0s');
            expect(formatDuration(3_661_000)).toBe('1h 1m 1s');
            expect(formatFileSize(0)).toBe('0 B');
            expect(formatFileSize(1536)).toBe('1.5 KB');
            expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
            setLanguageInMemory('en');
            expect(tBiHtml('Hello', '你好')).toBe('Hello');
        });
    });
});

describe('[webview-script]', () => {
    type Attrs = Record<string, string>;


    function input(attrs: Attrs, value: number | string) {
        return {
            value: String(value),
            getAttribute: (name: string) => attrs[name] ?? null,
        };
    }


    function modelInputs(model: string, values: Record<string, number>, attrs: Omit<Attrs, 'data-model' | 'data-field'> = {}) {
        return Object.entries(values).map(([field, value]) => input({
            ...attrs,
            'data-model': model,
            'data-field': field,
            'data-original-value': String(value),
            'data-was-custom': attrs['data-was-custom'] ?? '0',
        }, value));
    }


    describe('collectPricingInputOverrides', () => {
        it('does not persist untouched built-in pricing rows as custom overrides', () => {
            const overrides = collectPricingInputOverrides([
                ...modelInputs('claude-opus-4-6', { input: 5, output: 25, cacheRead: 0.5, thinking: 25 }),
                ...modelInputs('gpt-oss-120b', { input: 0.09, output: 0.36, cacheRead: 0, thinking: 0.36 }),
            ]);

            expect(overrides).toEqual({});
        });

        it('keeps existing custom rows and newly changed rows', () => {
            const changed = modelInputs('gpt-oss-120b', { input: 0.09, output: 0.36, cacheRead: 0, thinking: 0.36 });
            changed[0] = input({
                'data-model': 'gpt-oss-120b',
                'data-field': 'input',
                'data-original-value': '0.09',
                'data-was-custom': '0',
            }, 0.12);

            const overrides = collectPricingInputOverrides([
                ...modelInputs('claude-opus-4-6', { input: 7, output: 25, cacheRead: 0.5, thinking: 25 }, { 'data-was-custom': '1' }),
                ...changed,
            ]);

            expect(overrides['claude-opus-4-6']).toEqual({
                input: 7,
                output: 25,
                cacheRead: 0.5,
                cacheWrite: 0,
                thinking: 25,
            });
            expect(overrides['gpt-oss-120b']).toEqual({
                input: 0.12,
                output: 0.36,
                cacheRead: 0,
                cacheWrite: 0,
                thinking: 0.36,
            });
        });

        it('leaves a wholly blank unknown row unpriced and lets users clear an override', () => {
            for (const wasCustom of ['0', '1']) {
                const inputs = ['input', 'output', 'cacheRead', 'thinking'].map(field => input({
                    'data-model': 'future-unpriced-model', 'data-field': field,
                    'data-original-value': wasCustom === '1' ? '5' : '', 'data-was-custom': wasCustom,
                }, ''));
                expect(collectPricingInputOverrides(inputs)).toEqual({});
            }
        });

        it.each(['', 'oops', '-1', 'Infinity', '1.5oops', '0x10'])(
            'rejects a partial or invalid price %s without silently saving zero', value => {
                const inputs = modelInputs('claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2, thinking: 10 });
                inputs[0].value = value;
                expect(() => collectPricingInputOverrides(inputs)).toThrow('INVALID_PRICING');
            },
        );

        it('persists explicit zero values and preserves the undisplayed cache-write rate', () => {
            const inputs = ['input', 'output', 'cacheRead', 'thinking'].map(field => input({
                'data-model': 'claude-sonnet-5-5', 'data-field': field, 'data-original-value': '',
                'data-was-custom': '0', 'data-cache-write': '2.5',
            }, 0));
            expect(collectPricingInputOverrides(inputs)).toEqual({
                'claude-sonnet-5-5': { input: 0, output: 0, cacheRead: 0, cacheWrite: 2.5, thinking: 0 },
            });
        });
    });


    describe('static model display fallbacks', () => {
        it('does not expose known model IDs before GetUserStatus labels are loaded', () => {
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M133')).toBe('Gemini 3.5 Flash (High)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M132')).toBe('Gemini 3.5 Flash (High)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M20')).toBe('Gemini 3.5 Flash (Medium)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M187')).toBe('Gemini 3.5 Flash (Low)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M18')).toBe('Gemini 3 Flash');
            expect(normalizeModelDisplayName('MODEL_OPENAI_GPT_OSS_120B_MEDIUM')).toBe('GPT-OSS 120B (Medium)');
            expect(resolveModelId('Gemini 3.5 Flash (Low)')).toBe('MODEL_PLACEHOLDER_M187');
        });

        it('exposes Gemini 3.6 Flash tiers and the M84 takeover of 3.5 Flash (High)', () => {
            // M84 took over the "Gemini 3.5 Flash (High)" identity from M133 (2026-07 live probe).
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M84')).toBe('Gemini 3.5 Flash (High)');
            // 3.6 Flash was renumbered M264/M265/M266 -> M71/M72/M73 (2026-08 live probe). Both the
            // active and the retired IDs must still render a human-readable name.
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M71')).toBe('Gemini 3.6 Flash (High)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M72')).toBe('Gemini 3.6 Flash (Medium)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M73')).toBe('Gemini 3.6 Flash (Low)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M264')).toBe('Gemini 3.6 Flash (High)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M265')).toBe('Gemini 3.6 Flash (Medium)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M266')).toBe('Gemini 3.6 Flash (Low)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M196')).toBe('Gemini 3.6 Flash (Tiered)');
            expect(resolveModelId('Gemini 3.6 Flash (High)')).toBe('MODEL_PLACEHOLDER_M71');
        });

        it('exposes the Gemini 3.7 Flash tiers', () => {
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M298')).toBe('Gemini 3.7 Flash (High)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M299')).toBe('Gemini 3.7 Flash (Medium)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M300')).toBe('Gemini 3.7 Flash (Low)');
            expect(resolveModelId('Gemini 3.7 Flash (High)')).toBe('MODEL_PLACEHOLDER_M298');
        });

        it('exposes the Gemini 3.8 Flash tiers and localized aliases before GetUserStatus loads', () => {
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M318')).toBe('Gemini 3.8 Flash (High)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M319')).toBe('Gemini 3.8 Flash (Medium)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M320')).toBe('Gemini 3.8 Flash (Low)');
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M322')).toBe('Gemini 3.8 Flash (Tiered)');
            expect(normalizeModelDisplayName('Gemini 3.8 Flash (高)')).toBe('Gemini 3.8 Flash (High)');
        });
    });


    describe('status bar speed and prompt cache settings UI & script wiring', () => {
        const initialLanguage = getLanguage();
        const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

        beforeEach(async () => {
            await setLanguageToState('both', state);
        });

        afterEach(async () => {
            vi.restoreAllMocks();
            await setLanguageToState(initialLanguage, state);
        });

        it('renders #toggleSpeed and #toggleCacheHit unchecked by default with example chips and zero 令牌', async () => {
            for (const lang of ['en', 'zh', 'both'] as const) {
                await setLanguageToState(lang, state);
                const html = buildSettingsContent([]);
                expect(html).not.toContain('令牌');
                expect(html).toContain('id="toggleSpeed"');
                expect(html).toContain('<code>64 tok/s</code>');
                expect(html).toContain('id="toggleCacheHit"');
                expect(html).toContain('<code>Cache 84%</code>');
                expect(html).not.toMatch(/id="toggleSpeed"[^>]*checked/);
                expect(html).not.toMatch(/id="toggleCacheHit"[^>]*checked/);
            }
        });

        it('reflects enabled statusBar.showSpeed and statusBar.showCacheHit configuration', () => {
            vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(() => ({
                get: <T>(key: string, fallback?: T) => {
                    if (key === 'statusBar.showSpeed' || key === 'statusBar.showCacheHit') {
                        return true as T;
                    }
                    return fallback as T;
                },
            }) as unknown as vscode.WorkspaceConfiguration);

            const html = buildSettingsContent([]);
            expect(html).toMatch(/id="toggleSpeed"[^>]*checked/);
            expect(html).toMatch(/id="toggleCacheHit"[^>]*checked/);
        });

        it('wires #toggleSpeed, #toggleCacheHit, and USD #toggleSessionCost without any currency/FX controls', async () => {
            for (const lang of ['en', 'zh', 'both'] as const) {
                await setLanguageToState(lang, state);
                const html = buildSettingsContent([]);
                expect(html).not.toContain('令牌');
                expect(html).toContain('id="toggleSessionCost"');
                expect(html).toContain('<code>$0.27</code>');
                expect(html).not.toContain('currency-toggle-group');
                expect(html).not.toContain('data-currency');
                expect(html).not.toMatch(/[\u00a5\uffe5]/);
            }
            const script = getScript();
            expect(script).toMatch(/['"]toggleSpeed['"]/);
            expect(script).toMatch(/['"]toggleCacheHit['"]/);
            expect(script).toMatch(/['"]toggleSessionCost['"]/);
            expect(script).toMatch(/['"]statusBar\.showSpeed['"]/);
            expect(script).toMatch(/['"]statusBar\.showCacheHit['"]/);
            expect(script).toMatch(/['"]statusBar\.showSessionCost['"]/);
            expect(script).toMatch(/[A-Za-z_$][\w$]*\.command\s*===\s*['"]syncSettingsControls['"]/);
            expect(script).not.toContain('data-currency');
            expect(script).not.toMatch(/key:\s*['"]pricing\./);
        });

        it('clears stale session/today costs, passes manifest version to About, and syncs live status bar settings', async () => {
            await setLanguageToState('en', state);
            let onDispose: (() => void) | undefined;
            const posted: Array<Record<string, unknown>> = [];
            const configValues: Record<string, unknown> = {
                'statusBar.showSessionCost': false,
            };
            vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
                get: <T>(key: string, fallback?: T): T => (key in configValues ? configValues[key] as T : fallback as T),
                update: async (key: string, value: unknown) => { configValues[key] = value; },
            } as unknown as vscode.WorkspaceConfiguration);

            const fakePanel = {
                visible: true,
                webview: {
                    html: '',
                    postMessage: (msg: Record<string, unknown>) => { posted.push(msg); return Promise.resolve(true); },
                    onDidReceiveMessage: () => ({ dispose: () => {} }),
                },
                reveal: () => {},
                onDidChangeViewState: () => ({ dispose: () => {} }),
                onDidDispose: (cb: () => void) => { onDispose = cb; return { dispose: () => {} }; },
            };
            vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(fakePanel as unknown as vscode.WebviewPanel);

            const fakeCtx = {
                extension: { packageJSON: { version: '9.8.7' } },
                globalState: state,
            } as unknown as vscode.ExtensionContext;

            const sampleUsage = {
                cascadeId: 'panel-test-conv',
                title: 'Panel test',
                model: 'MODEL_PLACEHOLDER_M535',
                modelDisplayName: 'Gemini 4 Neon (Extra High)',
                contextLimit: 512_000,
                contextUsed: 50_000,
                usagePercent: 9.76,
                status: 'IDLE',
                stepCount: 2,
                lastModifiedTime: '',
                isEstimated: false,
                lastModelUsage: null,
                totalOutputTokens: 200,
                totalToolCallOutputTokens: 0,
                estimatedDeltaSinceCheckpoint: 0,
                imageGenStepCount: 0,
                compressionDetected: false,
                checkpointCompressionDrop: 0,
                hasGaps: false,
                checkpointModel: '',
                createdTime: '',
                lastUserInputTime: '',
                lastUserInputStepIndex: 0,
                repositoryName: '',
                gitOriginUrl: '',
                branchName: '',
                gitRootUri: '',
            };

            try {
                showMonitorPanel({
                    currentUsage: sampleUsage,
                    allTrajectoryUsages: [sampleUsage],
                    modelConfigs: [],
                    userInfo: null,
                    context: fakeCtx,
                    todayCostUsd: 4.5,
                    sessionCostUsd: 1.25,
                });

                // #30 #5: Dynamic packageJSON.version flows into About tab
                expect(fakePanel.webview.html).toContain('v9.8.7');
                // Initial overview shows initial session/today USD costs
                expect(fakePanel.webview.html).toContain('$4.50');
                expect(fakePanel.webview.html).toContain('$1.25');

                // #31 #3: Updating with undefined sessionCostUsd / todayCostUsd clears stale costs instead of preserving them
                posted.length = 0;
                updateMonitorPanel({
                    currentUsage: sampleUsage,
                    allTrajectoryUsages: [sampleUsage],
                    modelConfigs: [],
                    userInfo: null,
                    todayCostUsd: undefined,
                    sessionCostUsd: undefined,
                });
                const clearedMsg = posted.find(m => m.command === 'updateTabs') as { tabs: { overview: string; about: string } } | undefined;
                expect(clearedMsg).toBeDefined();
                expect(clearedMsg!.tabs.overview).not.toContain('$4.50');
                expect(clearedMsg!.tabs.overview).not.toContain('$1.25');
                expect(clearedMsg!.tabs.about).toContain('v9.8.7');

                // External config sync posts syncSettingsControls and optionally refreshes tabs
                posted.length = 0;
                configValues['statusBar.showSessionCost'] = true;
                syncMonitorPanelSettings(true);
                expect(posted.some(m => m.command === 'syncSettingsControls' && m.showSessionCost === true)).toBe(true);
                expect(posted.some(m => m.command === 'updateTabs')).toBe(true);
            } finally {
                onDispose?.();
            }
        });
    });
});

describe('[tooltip-budget]', () => {
    const CARBON_HIGH = 'MODEL_PLACEHOLDER_M427';

    const CARBON_MEDIUM = 'MODEL_PLACEHOLDER_M437';

    const ARGON_HIGH = 'MODEL_PLACEHOLDER_M417';


    function model(id: string, label: string, isRecommended = false): QuotaSelectable {
        return { model: id, label, isRecommended,
            quotaInfo: { remainingFraction: 0.5, resetTime: '2026-11-11T12:00:00Z' } };
    }


    beforeAll(() => {
        // Match the live catalog's provider signal even before static registration.
        for (const id of [CARBON_HIGH, CARBON_MEDIUM]) {
            updateModelSpec(id, { apiProvider: 'GOOGLE_GEMINI' });
        }
    });


    describe('same-generation Gemini quota representative', () => {
        it.each([
            'Gemini 4 Carbon (High)',
            'Gemini 4 Carbon High',
            'Gemini 4 Carbon (高)',
            'Gemini 4 Carbon（高）',
            'Gemini 4 Carbon (High) (M427)',
        ])('prefers the newer Carbon family for %s without an active model or recommendation', label => {
            const carbon = model(CARBON_HIGH, label);
            const argon = model(ARGON_HIGH, 'Gemini 4 Argon (High)');
            for (const configs of [[argon, carbon], [carbon, argon]]) {
                const result = selectQuotaRows(configs, '', 3);
                expect(result.total).toBe(1);
                expect(result.rows[0]).toMatchObject({ model: CARBON_HIGH, poolSize: 2 });
            }
        });

        it('keeps the current model ahead of both recommendation and family recency', () => {
            const configs = [model(CARBON_HIGH, 'Gemini 4 Carbon (High)', true),
                model(ARGON_HIGH, 'Gemini 4 Argon (High)')];
            expect(selectQuotaRows(configs, ARGON_HIGH, 3).rows[0].model).toBe(ARGON_HIGH);
        });

        it('keeps a live Argon recommendation ahead of Carbon', () => {
            const configs = [model(CARBON_HIGH, 'Gemini 4 Carbon (High)'),
                model(ARGON_HIGH, 'Gemini 4 Argon (High)', true)];
            expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe(ARGON_HIGH);
        });

        it('uses Carbon recency when both families carry the same recommendation flag', () => {
            const configs = [model(ARGON_HIGH, 'Gemini 4 Argon (High)', true),
                model(CARBON_MEDIUM, 'Gemini 4 Carbon (Medium)', true)];
            expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe(CARBON_MEDIUM);
        });

        it('keeps a newer numeric generation ahead of Carbon', () => {
            const configs = [model(CARBON_HIGH, 'Gemini 4 Carbon (High)'),
                model(ARGON_HIGH, 'Gemini 4.1 Future (High)')];
            expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe(ARGON_HIGH);
        });

        it.each(['Gemini 4 Carbonated (High)', 'Gemini 4 Carbon (Highest)', 'Gemini 4 Carbon (Maximum)',
            'Gemini 4 CarbonHigh', 'Gemini 4 Carbon (High', 'Gemini 4 Carbon High)'])(
            'does not grant a known-family recency boost to %s', label => {
                const configs = [model(CARBON_HIGH, label), model(ARGON_HIGH, 'Gemini 4 Argon (High)')];
                expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe(ARGON_HIGH);
            },
        );

        it('does not mistake Gemini 40 for Gemini 4', () => {
            const configs = [model(CARBON_HIGH, 'Gemini 4 Carbon (High)'),
                model(ARGON_HIGH, 'Gemini 40 Argon (High)')];
            expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe(ARGON_HIGH);
        });

        it('prefers Gemini 4 Neon ahead of Hydrogen and Carbon without recommendation (including bilingual slash labels)', () => {
            const neon = model('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon (Extra High)');
            const hydrogen = model('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (Extra High)');
            const carbon = model(CARBON_HIGH, 'Gemini 4 Carbon (High)');
            expect(selectQuotaRows([carbon, hydrogen, neon], '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M535');

            const biNeon = model('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon (Extra High / 超高)');
            const biHydrogen = model('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (Extra High / 超高)');
            const biCarbon = model(CARBON_HIGH, 'Gemini 4 Carbon (High / 高)');
            expect(selectQuotaRows([biCarbon, biHydrogen, biNeon], '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M535');
            expect(selectQuotaRows([biCarbon, biHydrogen], '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M528');
        });

        it('formats collapsed pool size suffix with models / 个模型 units instead of bare numbers', () => {
            expect(poolSizeSuffix(1, 'en')).toBe('');
            expect(poolSizeSuffix(1, 'zh')).toBe('');
            expect(poolSizeSuffix(4, 'en')).toBe(' · 4 models');
            expect(poolSizeSuffix(4, 'both')).toBe(' · 4 models');
            expect(poolSizeSuffix(4, 'zh')).toBe(' · 4 个模型');

            const carbon = model(CARBON_HIGH, 'Gemini 4 Carbon (High)');
            const argon = model(ARGON_HIGH, 'Gemini 4 Argon (High)');
            expect(selectQuotaRows([argon, carbon], '', 3, 'en').rows[0].label).toBe('Gemini 4 Carbon (High) · 2 models');
            expect(selectQuotaRows([argon, carbon], '', 3, 'zh').rows[0].label).toBe('Gemini 4 Carbon (High) · 2 个模型');
        });
    });


    describe('priority-tiered hover section budget (P0..P5)', () => {
        it('computes zoom-aware line budgets with strict mode caps and safety floors', () => {
            expect(getSectionLineBudget('compact', 'compact', 0)).toBe(SECTION_COMPACT_MAX_LINES);
            expect(getSectionLineBudget('auto', 'normal', 0)).toBe(SECTION_NORMAL_MAX_LINES);
            expect(getSectionLineBudget('auto', 'compact', 0)).toBe(SECTION_COMPACT_MAX_LINES);
            expect(getSectionLineBudget('full', 'normal', 0)).toBe(SECTION_FULL_MAX_LINES);
            expect(SECTION_COMPACT_MAX_LINES).toBeLessThanOrEqual(14);
            expect(SECTION_NORMAL_MAX_LINES).toBeLessThanOrEqual(22);
            expect(SECTION_FULL_MAX_LINES).toBeLessThanOrEqual(32);

            // Positive zoom tightens the budget, clamped to safe floors
            expect(getSectionLineBudget('auto', 'normal', 1)).toBe(20);
            expect(getSectionLineBudget('auto', 'normal', 5)).toBe(16);
            expect(getSectionLineBudget('compact', 'compact', 5)).toBe(10);
            expect(getSectionLineBudget('full', 'normal', 5)).toBe(24);
            // Negative / non-finite zoom does not penalize
            expect(getSectionLineBudget('auto', 'normal', -1)).toBe(SECTION_NORMAL_MAX_LINES);
            expect(getSectionLineBudget('auto', 'normal', Number.NaN)).toBe(SECTION_NORMAL_MAX_LINES);
        });

        it('counts visual lines including inter-section dividers and ignores empty sections', () => {
            const sections: HoverSection[] = [
                { id: 'header', priority: 0, lines: ['Header line 1', 'Header line 2'] },
                { id: 'empty', priority: 4, lines: [] },
                { id: 'footer', priority: 0, lines: ['Footer'], pinBottom: true },
            ];
            // 2 + 1 + 1 divider = 4
            expect(countSectionLines(sections)).toBe(4);
            expect(countSectionLines(sections, 0)).toBe(3);
        });

        it('compacts before dropping within a tier, drops P5->P1, never drops P0, and pins footer last', () => {
            const sections: HoverSection[] = [
                { id: 'header', priority: 0, lines: ['H1', 'H2'] },
                { id: 'footer', priority: 0, lines: ['Footer CTA'], pinBottom: true }, // intentionally out of order
                { id: 'context', priority: 0, lines: ['C1', 'C2'] },
                { id: 'session-kpi', priority: 1, lines: ['K1', 'K2', 'K3', 'K4'], compactLines: ['K-compact'] },
                { id: 'quota', priority: 2, lines: ['Q1', 'Q2', 'Q3', 'Q4'], compactLines: ['Q-compact'] },
                { id: 'latest-call', priority: 3, lines: ['L1', 'L2', 'L3', 'L4'], compactLines: ['L-compact'] },
                { id: 'alerts', priority: 4, lines: ['A1', 'A2'] },
                { id: 'diagnostics', priority: 5, lines: ['D1', 'D2', 'D3'] },
            ];

            // Tight budget (16): P5 diagnostics dropped, P4 alerts dropped, P3 latest-call compacted (or dropped)
            const res = applySectionBudget(sections, 16);
            expect(res.totalLines).toBeLessThanOrEqual(16);
            expect(res.droppedIds).toContain('diagnostics');
            expect(res.droppedIds).toContain('alerts');
            // Header & Context (P0) always kept; Footer ALWAYS last
            const ids = res.sections.map(s => s.id);
            expect(ids[0]).toBe('header');
            expect(ids).toContain('context');
            expect(ids[ids.length - 1]).toBe('footer');
        });

        it('uses compactLines on lower-priority section before dropping it when compaction meets budget', () => {
            const sections: HoverSection[] = [
                { id: 'header', priority: 0, lines: ['H1', 'H2'] },
                { id: 'latest', priority: 3, lines: ['L1', 'L2', 'L3', 'L4', 'L5'], compactLines: ['L-short'] },
                { id: 'footer', priority: 0, lines: ['Footer'], pinBottom: true },
            ];
            // Full = 2+5+1 + 2 dividers = 10; Compacted = 2+1+1 + 2 dividers = 6
            const res = applySectionBudget(sections, 7);
            expect(res.compactedIds).toEqual(['latest']);
            expect(res.droppedIds).toEqual([]);
            expect(res.sections.find(s => s.id === 'latest')?.lines).toEqual(['L-short']);
            expect(res.totalLines).toBe(6);

            // When even compactLines still exceeds budget, Pass B drops it and removes it from compactedIds
            const dropped = applySectionBudget(sections, 5);
            expect(dropped.droppedIds).toEqual(['latest']);
            expect(dropped.compactedIds).toEqual([]);
        });

        it('keeps P0 and pinned footer intact even when they alone exceed budget', () => {
            const sections: HoverSection[] = [
                { id: 'header', priority: 0, lines: ['H1', 'H2', 'H3'] },
                { id: 'context', priority: 0, lines: ['C1', 'C2', 'C3'] },
                { id: 'optional', priority: 1, lines: ['O1', 'O2'] },
                { id: 'footer', priority: 0, lines: ['Footer'], pinBottom: true },
            ];
            const res = applySectionBudget(sections, 4);
            expect(res.sections.map(s => s.id)).toEqual(['header', 'context', 'footer']);
            expect(res.droppedIds).toEqual(['optional']);
        });

        it('compacts P0 sections with compactLines when P0 alone exceeds budget without ever dropping P0', () => {
            const sections: HoverSection[] = [
                { id: 'hero', priority: 0, lines: ['H1', 'H2', 'H3'], compactLines: ['H1', 'H3'] },
                { id: 'quota', priority: 0, lines: ['Q-title', 'Q1', 'Q2', 'Q3'], compactLines: ['Q-1line'] },
                { id: 'kpi', priority: 1, lines: ['K1', 'K2'] },
                { id: 'footer', priority: 0, lines: ['Footer'], pinBottom: true },
            ];
            // Tight budget (7): P1 kpi drops first, then P0 quota compacts (4->1): 3+1+1 + 2 dividers = 7 <= 7
            const tight = applySectionBudget(sections, 7);
            expect(tight.droppedIds).toEqual(['kpi']);
            expect(tight.compactedIds).toEqual(['quota']);
            expect(tight.sections.map(s => s.id)).toEqual(['hero', 'quota', 'footer']);
            expect(tight.sections.find(s => s.id === 'quota')?.lines).toEqual(['Q-1line']);
            expect(tight.totalLines).toBe(7);

            // Extreme budget (5): hero also compacts (3->2): 2+1+1 + 2 dividers = 6, still never drops any P0 section
            const extreme = applySectionBudget(sections, 5);
            expect(extreme.droppedIds).toEqual(['kpi']);
            expect(extreme.compactedIds).toEqual(['quota', 'hero']);
            expect(extreme.sections.map(s => s.id)).toEqual(['hero', 'quota', 'footer']);
        });

        it('renders prose with soft breaks and separates GFM tables cleanly for VS Code MarkdownString', () => {
            const md = renderHoverSections([
                {
                    id: 'latest',
                    priority: 3,
                    lines: [
                        '$(history) **Latest Call** · `gemini-4-carbon`',
                        '| In / Out | Cache | Cost | Speed |',
                        '| :--- | ---: | ---: | ---: |',
                        '| 4,543 / 388 | **97.96%** | **$0.065** | **155** tok/s |',
                        'Note after table',
                    ],
                },
                {
                    id: 'footer',
                    priority: 0,
                    lines: ['Line A', 'Line B'],
                    pinBottom: true,
                },
            ]);

            // Blank line inserted between prose title and GFM table header
            expect(md).toContain('$(history) **Latest Call** · `gemini-4-carbon`\n\n| In / Out | Cache | Cost | Speed |');
            // Consecutive table rows joined with plain newline (no trailing two spaces)
            expect(md).toContain('| In / Out | Cache | Cost | Speed |\n| :--- | ---: | ---: | ---: |\n| 4,543 / 388 | **97.96%** | **$0.065** | **155** tok/s |');
            // Blank line after table before trailing prose
            expect(md).toContain('| **155** tok/s |\n\nNote after table');
            // Sections separated by horizontal rule and prose lines joined with two-space soft break
            expect(md).toContain('\n\n---\n\nLine A  \nLine B');
        });
    });
});

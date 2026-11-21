import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getLanguage, setLanguageToState } from '../src/i18n';
import { normalizeModelDisplayName, resolveModelId } from '../src/models';
import { buildSettingsContent } from '../src/webview-settings-tab';
import { collectPricingInputOverrides, getScript } from '../src/webview-script';
import { showMonitorPanel, updateMonitorPanel, syncMonitorPanelSettings } from '../src/webview-panel';

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

    it('wires #toggleSpeed, #toggleCacheHit, #toggleSessionCost, and currency controls in settings & script', async () => {
        for (const lang of ['en', 'zh', 'both'] as const) {
            await setLanguageToState(lang, state);
            const html = buildSettingsContent([]);
            expect(html).not.toContain('令牌');
            expect(html).toContain('id="toggleSessionCost"');
            expect(html).toContain('class="currency-toggle-group"');
            expect(html).toContain('data-currency="USD"');
            expect(html).toContain('data-currency="CNY"');
            expect(html).toContain('data-currency="both"');
            expect(html).toContain('id="cnyExchangeRateInput"');
            expect(html).toContain('id="cnyExchangeRateSaveBtn"');
        }
        const script = getScript();
        expect(script).toContain("'toggleSpeed'");
        expect(script).toContain("'toggleCacheHit'");
        expect(script).toContain("'toggleSessionCost'");
        expect(script).toContain("'statusBar.showSpeed'");
        expect(script).toContain("'statusBar.showCacheHit'");
        expect(script).toContain("'statusBar.showSessionCost'");
        expect(script).toContain("'pricing.displayCurrency'");
        expect(script).toContain("'pricing.cnyExchangeRate'");
    });

    it('renders dynamic #sessionCostPreview, strict FX validation, settings sync handler, and pricing FX draft preservation (#31 #8)', async () => {
        await setLanguageToState('en', state);
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
            get: <T>(key: string, fallback?: T): T => {
                if (key === 'pricing.displayCurrency') { return 'both' as T; }
                if (key === 'pricing.cnyExchangeRate') { return 7.5 as T; }
                return fallback as T;
            },
        } as vscode.WorkspaceConfiguration);

        const html = buildSettingsContent([]);
        expect(html).toContain('id="sessionCostPreview">$0.27 (¥2.03)</code>');
        expect(html).toContain('id="cnyExchangeRateInput"');
        expect(html).toContain('data-original-value="7.5"');

        const script = getScript();
        // Strict numeric FX validation + inline error feedback
        expect(script).toContain('function parseStrictFxRate');
        expect(script).toContain('invalidFxRateText');
        expect(script).toContain('flashCurrencyFeedback');
        // External settings control sync + live preview updater
        expect(script).toContain("msg.command === 'syncSettingsControls'");
        expect(script).toContain('updateSessionCostPreview');
        // Pricing FX input draft preservation during polling updateTabs
        expect(script).toContain('pricingFxDraft');
        expect(script).toContain('#pricingFxRateInput');
    });

    it('clears stale session/today costs, passes manifest version to About, and refreshes currency even while paused (#31 #3/#8, #30 #5)', async () => {
        await setLanguageToState('en', state);
        let onMessage: ((msg: Record<string, unknown>) => Promise<void> | void) | undefined;
        let onDispose: (() => void) | undefined;
        const posted: Array<Record<string, unknown>> = [];
        const configValues: Record<string, unknown> = {
            'pricing.displayCurrency': 'USD',
            'pricing.cnyExchangeRate': 7.2,
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
                onDidReceiveMessage: (cb: (msg: Record<string, unknown>) => Promise<void> | void) => {
                    onMessage = cb;
                    return { dispose: () => {} };
                },
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
                currencyPrefs: { currency: 'USD', cnyRate: 7.2 },
            });

            // #30 #5: Dynamic packageJSON.version flows into About tab
            expect(fakePanel.webview.html).toContain('v9.8.7');
            // Initial overview shows initial session/today costs
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

            // #31 #8: Pause panel, then explicitly change currency -> tabs MUST still refresh & Settings controls MUST sync
            await onMessage?.({ command: 'togglePause' });
            posted.length = 0;
            await onMessage?.({ command: 'setConfig', key: 'pricing.displayCurrency', value: 'CNY' });
            expect(posted.some(m => m.command === 'updateTabs')).toBe(true);
            expect(posted.some(m => m.command === 'syncSettingsControls' && m.displayCurrency === 'CNY')).toBe(true);

            // External config sync posts syncSettingsControls and force-refreshes when pricing changed
            posted.length = 0;
            configValues['pricing.cnyExchangeRate'] = 7.5;
            configValues['statusBar.showSessionCost'] = true;
            syncMonitorPanelSettings(true);
            expect(posted.some(m => m.command === 'syncSettingsControls' && m.cnyExchangeRate === 7.5 && m.showSessionCost === true)).toBe(true);
            expect(posted.some(m => m.command === 'updateTabs')).toBe(true);

            // Unpause cleanly
            await onMessage?.({ command: 'togglePause' });
        } finally {
            onDispose?.();
        }
    });
});

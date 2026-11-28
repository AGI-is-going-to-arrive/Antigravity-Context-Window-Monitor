import type * as vscode from 'vscode';
import type { StateBucket } from './durable-state';
import {
    type EffectiveDisplayLanguage,
    type HostLocaleSources,
    type Language,
    type LanguagePreference,
    getLanguage,
    getLanguagePreference,
    getRuntimeLocaleSources,
    isLanguage,
    isLanguagePreference,
    resolveStoredLanguagePreference,
    setDefaultHostLocaleHints,
    setLanguageInMemory,
    setLanguagePreferenceInMemory,
    setLanguagePreferenceToState,
    setLanguageToState,
    tBi,
} from './i18n-core';

export * from './i18n-core';

/**
 * Safely read `vscode.env.language` when running inside the Antigravity IDE / VS Code host.
 * Returns `undefined` when loaded in pure Node.js without the `vscode` runtime.
 */
export function getVscodeLanguage(vscodeApi?: { env?: { language?: string } }): string | undefined {
    try {
        const api = vscodeApi ?? (require('vscode') as typeof import('vscode'));
        const lang = api?.env?.language;
        return typeof lang === 'string' && lang.trim().length > 0 ? lang : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Build IDE locale detection sources prioritizing `vscode.env.language` -> App/host locale
 * -> normalized `Intl` / platform environment locale.
 */
export function getIdeLocaleSources(overrides: HostLocaleSources = {}): HostLocaleSources {
    const vscodeLanguage = overrides.vscodeLanguage !== undefined
        ? overrides.vscodeLanguage
        : getVscodeLanguage();
    return getRuntimeLocaleSources({
        ...overrides,
        vscodeLanguage,
    });
}

/**
 * Initialize i18n from VS Code `globalState` with `vscode.env.language`-prioritized first-boot
 * detection when no explicit preference has been persisted yet.
 * Preserves an explicitly stored `'both'` preference permanently.
 * Call once during extension activation.
 */
export function initI18n(
    context: vscode.ExtensionContext,
    localeOverrides?: HostLocaleSources,
): EffectiveDisplayLanguage {
    const vscodeLanguage = localeOverrides?.vscodeLanguage !== undefined
        ? localeOverrides.vscodeLanguage
        : getVscodeLanguage();
    setDefaultHostLocaleHints({
        vscodeLanguage,
        hostLocale: localeOverrides?.hostLocale,
        intlLocale: localeOverrides?.intlLocale,
        envLocale: localeOverrides?.envLocale,
    });

    const preference = resolveStoredLanguagePreference(context.globalState);
    const sources = getIdeLocaleSources(localeOverrides);
    return setLanguagePreferenceInMemory(preference, sources);
}

/**
 * Initialize i18n for Antigravity IDE from both DurableState (if provided) and VS Code `globalState`,
 * preferring an explicitly persisted preference (including `'both'`) and falling back to `'auto'`
 * resolved via `vscode.env.language` -> `hostLocale` -> `intlLocale` -> `envLocale`.
 */
export function initI18nForIde(
    context: vscode.ExtensionContext,
    state?: StateBucket,
    localeOverrides?: HostLocaleSources,
): EffectiveDisplayLanguage {
    const vscodeLanguage = localeOverrides?.vscodeLanguage !== undefined
        ? localeOverrides.vscodeLanguage
        : getVscodeLanguage();
    setDefaultHostLocaleHints({
        vscodeLanguage,
        hostLocale: localeOverrides?.hostLocale,
        intlLocale: localeOverrides?.intlLocale,
        envLocale: localeOverrides?.envLocale,
    });

    const fromDurable = state ? resolveStoredLanguagePreference(state) : 'auto';
    const preference = fromDurable !== 'auto'
        ? fromDurable
        : resolveStoredLanguagePreference(context.globalState);
    const sources = getIdeLocaleSources(localeOverrides);
    return setLanguagePreferenceInMemory(preference, sources);
}

/**
 * Set and persist an explicit display language (`'en' | 'zh' | 'both'`).
 */
export async function setLanguage(lang: Language, context: vscode.ExtensionContext, state?: StateBucket): Promise<void> {
    if (!isLanguage(lang)) { return; }
    setLanguageInMemory(lang);
    await context.globalState.update('displayLanguage', lang);
    if (state) {
        await state.update('displayLanguage', lang);
    }
}

/**
 * Set and persist a language preference (`'auto' | 'en' | 'zh' | 'both'`), resolving `'auto'`
 * via IDE `vscode.env.language`-prioritized detection without clobbering an explicit `'both'`.
 */
export async function setLanguagePreference(
    preference: LanguagePreference,
    context: vscode.ExtensionContext,
    state?: StateBucket,
    localeOverrides?: HostLocaleSources,
): Promise<EffectiveDisplayLanguage> {
    if (!isLanguagePreference(preference)) {
        return getLanguage();
    }
    const sources = getIdeLocaleSources(localeOverrides);
    const effective = setLanguagePreferenceInMemory(preference, sources);
    await context.globalState.update('languagePreference', preference);
    await context.globalState.update('displayLanguage', preference === 'auto' ? undefined : preference);
    if (state) {
        await setLanguagePreferenceToState(preference, state, sources);
    }
    return effective;
}

/**
 * Show a QuickPick for the user to select display language preference.
 */
export async function showLanguagePicker(context: vscode.ExtensionContext, state?: StateBucket): Promise<void> {
    const vscodeApi = require('vscode') as typeof import('vscode');
    const currentPreference = getLanguagePreference();
    const currentLanguage = getLanguage();
    const items: Array<vscode.QuickPickItem & { pref: LanguagePreference }> = [
        {
            pref: 'auto',
            label: '$(globe) Auto / 自动（跟随系统）',
            description: 'Follow IDE / system locale — 跟随系统语言',
            detail: currentPreference === 'auto' ? `✅ Current / 当前 (${currentLanguage})` : '',
        },
        {
            pref: 'zh',
            label: '$(globe) 中文',
            description: 'Chinese Only — 仅显示中文',
            detail: currentPreference === 'zh' ? '✅ Current / 当前' : '',
        },
        {
            pref: 'en',
            label: '$(globe) English',
            description: 'English Only — 仅显示英文',
            detail: currentPreference === 'en' ? '✅ Current / 当前' : '',
        },
        {
            pref: 'both',
            label: '$(globe) Bilingual / 双语',
            description: 'English + Chinese — 中英双语',
            detail: currentPreference === 'both' ? '✅ Current / 当前' : '',
        },
    ];

    const picked = await vscodeApi.window.showQuickPick(items, {
        title: '📊 ' + tBi('Select Display Language', '选择显示语言'),
        placeHolder: tBi('Pick a language for the context monitor UI', '选择上下文监控界面语言'),
        canPickMany: false,
    });

    if (!picked) { return; }

    if (picked.pref === 'auto') {
        await setLanguagePreference('auto', context, state);
        return;
    }

    const lang: Language = picked.pref;
    if (state) {
        await setLanguageToState(lang, state);
        await context.globalState.update('displayLanguage', lang);
        await context.globalState.update('languagePreference', lang);
        return;
    }
    await setLanguage(lang, context);
    await context.globalState.update('languagePreference', lang);
}

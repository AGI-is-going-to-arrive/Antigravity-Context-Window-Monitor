import type * as vscode from 'vscode';
import type { StateBucket } from './durable-state';
import {
    type Language,
    isLanguage,
    getLanguage,
    setLanguageInMemory,
    setLanguageToState,
    tBi,
} from './i18n-core';

export * from './i18n-core';

/**
 * Initialize i18n from VS Code configuration.
 * Call once during extension activation.
 */
export function initI18n(context: vscode.ExtensionContext): void {
    const saved = context.globalState.get<Language>('displayLanguage', 'both');
    if (saved && isLanguage(saved)) {
        setLanguageInMemory(saved);
    }
}

/**
 * Set and persist the display language.
 */
export async function setLanguage(lang: Language, context: vscode.ExtensionContext, state?: StateBucket): Promise<void> {
    setLanguageInMemory(lang);
    await context.globalState.update('displayLanguage', lang);
    if (state) {
        await state.update('displayLanguage', lang);
    }
}

/**
 * Show a QuickPick for the user to select display language.
 */
export async function showLanguagePicker(context: vscode.ExtensionContext, state?: StateBucket): Promise<void> {
    const vscodeApi = require('vscode') as typeof import('vscode');
    const currentLanguage = getLanguage();
    const items: vscode.QuickPickItem[] = [
        {
            label: '$(globe) 中文',
            description: 'Chinese Only — 仅显示中文',
            detail: currentLanguage === 'zh' ? '✅ Current / 当前' : '',
        },
        {
            label: '$(globe) English',
            description: 'English Only — 仅显示英文',
            detail: currentLanguage === 'en' ? '✅ Current / 当前' : '',
        },
        {
            label: '$(globe) Bilingual / 双语',
            description: 'English + Chinese — 中英双语',
            detail: currentLanguage === 'both' ? '✅ Current / 当前' : '',
        },
    ];

    const picked = await vscodeApi.window.showQuickPick(items, {
        title: '📊 ' + tBi('Select Display Language', '选择显示语言'),
        placeHolder: tBi('Pick a language for the context monitor UI', '选择上下文监控界面语言'),
        canPickMany: false,
    });

    if (!picked) { return; }

    let lang: Language;
    if (picked.label.includes('中文') && !picked.label.includes('Bilingual')) {
        lang = 'zh';
    } else if (picked.label.includes('English') && !picked.label.includes('Bilingual')) {
        lang = 'en';
    } else {
        lang = 'both';
    }

    if (state) {
        await setLanguageToState(lang, state);
        await context.globalState.update('displayLanguage', lang);
        return;
    }
    await setLanguage(lang, context);
}

import * as vscode from 'vscode';

// ─── Language Types ───────────────────────────────────────────────────────────

export type Language = 'zh' | 'en' | 'both';

// ─── Translation Keys ────────────────────────────────────────────────────────

interface TranslationEntry {
    en: string;
    zh: string;
}

/** All translatable string keys used across the extension UI. */
const translations: Record<string, TranslationEntry> = {
    // ─ Status Bar
    'statusBar.initializing': { en: 'Context...', zh: '上下文...' },
    'statusBar.initializingTooltip': { en: 'Antigravity Context Monitor: Initializing...', zh: 'Antigravity 上下文监控：初始化中...' },
    'statusBar.disconnectedLabel': { en: 'Context: N/A', zh: '上下文：不可用' },
    'statusBar.noConversationTooltip': { en: 'No active conversation', zh: '无活跃会话' },
    'statusBar.clickToView': { en: 'Click to view details', zh: '点击查看详情' },
    'statusBar.idle': { en: 'Idle', zh: '空闲' },
    'statusBar.idleDescription': { en: 'New or ended conversation', zh: '新建对话或已结束' },
    'statusBar.name': { en: 'Context Window Monitor', zh: '上下文窗口监控' },

    // ─ Tooltip
    'tooltip.title': { en: 'Context Window Usage', zh: '上下文窗口使用情况' },
    'tooltip.model': { en: 'Model', zh: '模型' },
    'tooltip.session': { en: 'Session', zh: '会话' },
    'tooltip.totalContextUsed': { en: 'Total Context Used (input+output)', zh: '总上下文占用 (输入+输出)' },
    'tooltip.modelOutput': { en: 'Model Output', zh: '模型输出' },
    'tooltip.toolResults': { en: 'Tool Results', zh: '工具结果' },
    'tooltip.limit': { en: 'Limit', zh: '窗口上限' },
    'tooltip.usage': { en: 'Usage', zh: '使用率' },
    'tooltip.remaining': { en: 'Remaining', zh: '剩余' },
    'tooltip.steps': { en: 'Steps', zh: '步骤数' },
    'tooltip.compressing': { en: 'Model is auto-compressing context', zh: '模型正自动压缩上下文' },
    'tooltip.compressingHint': { en: 'Context will shrink after compression completes.', zh: '压缩完成后数值将下降。' },
    'tooltip.compressed': { en: 'Context was auto-compressed', zh: '上下文已被模型自动压缩' },
    'tooltip.before': { en: 'Before', zh: '压缩前' },
    'tooltip.after': { en: 'After', zh: '压缩后' },
    'tooltip.contextDrop': { en: 'Context Drop', zh: '上下文压缩量' },
    'tooltip.checkpointDrop': { en: 'Checkpoint Input Drop', zh: '检查点输入压缩量' },
    'tooltip.dataIncomplete': { en: 'Data may be incomplete (some step batches failed to load)', zh: '数据可能不完整（部分步骤批次加载失败）' },
    'tooltip.imageGen': { en: 'Image Gen', zh: '图片生成' },
    'tooltip.imageGenSteps': { en: 'step(s) detected', zh: '个图片生成步骤' },
    'tooltip.estDelta': { en: 'Est. delta', zh: '估算增量' },
    'tooltip.sinceCheckpoint': { en: 'since last checkpoint', zh: '自上次检查点' },
    'tooltip.lastCheckpoint': { en: 'Last Checkpoint', zh: '最近 checkpoint' },
    'tooltip.input': { en: 'Input', zh: '输入' },
    'tooltip.output': { en: 'Output', zh: '输出' },
    'tooltip.cache': { en: 'Cache', zh: '缓存' },
    'tooltip.estimated': { en: 'Estimated', zh: '估算值' },
    'tooltip.precise': { en: 'Precise (from checkpoint)', zh: '精确值 (来自 checkpoint)' },

    // ─ QuickPick Panel
    'panel.title': { en: 'Antigravity Context Window Monitor', zh: '上下文窗口使用情况' },
    'panel.placeholder': { en: 'View context details for all sessions', zh: '查看各会话的上下文使用详情' },
    'panel.currentSession': { en: 'Current Active Session', zh: '当前活跃会话' },
    'panel.otherSessions': { en: 'Other Sessions', zh: '其他会话' },
    'panel.noData': { en: 'No context window data available', zh: '没有可用的上下文使用数据' },
    'panel.used': { en: 'Used', zh: '已用' },
    'panel.limitLabel': { en: 'Limit', zh: '上限' },
    'panel.modelOut': { en: 'Model Out', zh: '模型输出' },
    'panel.toolOut': { en: 'Tool Out', zh: '工具结果' },
    'panel.remaining': { en: 'Remaining', zh: '剩余' },
    'panel.usageLabel': { en: 'Usage', zh: '使用率' },
    'panel.stepsLabel': { en: 'Steps', zh: '步骤' },
    'panel.compression': { en: 'Compression', zh: '压缩量' },
    'panel.estimated': { en: 'Est', zh: '估' },
    'panel.preciseShort': { en: 'Precise', zh: '精确' },
    'panel.compressed': { en: 'Compressed', zh: '已压缩' },
    'panel.compressing': { en: 'Compressing', zh: '压缩中' },
    'panel.gaps': { en: 'Gaps', zh: '缺失' },
    'panel.currentSessionLabel': { en: 'Current Session', zh: '当前会话' },
    'panel.comp': { en: 'Comp', zh: '压缩' },

    // ─ Commands
    'command.showDetails': { en: 'Show Context Window Details', zh: '显示上下文窗口详情' },
    'command.refresh': { en: 'Refresh Context Window Monitor', zh: '刷新上下文窗口监控' },
    'command.switchLanguage': { en: 'Switch Language', zh: '切换显示语言' },

    // ─ Language Picker
    'lang.zh': { en: '中文 (Chinese Only)', zh: '中文' },
    'lang.en': { en: 'English', zh: 'English (仅英文)' },
    'lang.both': { en: 'Bilingual (EN + ZH)', zh: '双语 (中英双语)' },
    'lang.pickerTitle': { en: 'Select Display Language', zh: '选择显示语言' },
};

// ─── Current Language State ──────────────────────────────────────────────────

let currentLanguage: Language = 'both';

/**
 * Initialize i18n from VS Code configuration.
 * Call once during extension activation.
 */
export function initI18n(context: vscode.ExtensionContext): void {
    const saved = context.globalState.get<Language>('displayLanguage');
    if (saved && (saved === 'zh' || saved === 'en' || saved === 'both')) {
        currentLanguage = saved;
    }
}

/**
 * Get the current display language.
 */
export function getLanguage(): Language {
    return currentLanguage;
}

/**
 * Set and persist the display language.
 */
export async function setLanguage(lang: Language, context: vscode.ExtensionContext): Promise<void> {
    currentLanguage = lang;
    await context.globalState.update('displayLanguage', lang);
}

/**
 * Translate a key to the current language.
 *
 * - `'zh'` → returns Chinese text only
 * - `'en'` → returns English text only
 * - `'both'` → returns "English / 中文" if both differ, otherwise just one
 */
export function t(key: string): string {
    const entry = translations[key];
    if (!entry) { return key; }

    switch (currentLanguage) {
        case 'zh':
            return entry.zh;
        case 'en':
            return entry.en;
        case 'both':
        default:
            // If both are identical (e.g. proper names), don't duplicate
            if (entry.en === entry.zh) { return entry.en; }
            return `${entry.en} / ${entry.zh}`;
    }
}

/**
 * Bilingual helper — returns the appropriate separator-joined string
 * based on current language setting.
 *
 * Usage: `tBi('Model Output', '模型输出')` →
 * - zh: "模型输出"
 * - en: "Model Output"
 * - both: "Model Output / 模型输出"
 */
export function tBi(en: string, zh: string, separator: string = ' / '): string {
    switch (currentLanguage) {
        case 'zh': return zh;
        case 'en': return en;
        case 'both':
        default:
            if (en === zh) { return en; }
            return `${en}${separator}${zh}`;
    }
}

/**
 * Show a QuickPick for the user to select display language.
 */
export async function showLanguagePicker(context: vscode.ExtensionContext): Promise<void> {
    const items: vscode.QuickPickItem[] = [
        {
            label: '$(globe) 中文',
            description: 'Chinese Only — 仅显示中文',
            detail: currentLanguage === 'zh' ? '✅ Current / 当前' : '',
        },
        {
            label: '$(globe) English',
            description: 'English Only',
            detail: currentLanguage === 'en' ? '✅ Current / 当前' : '',
        },
        {
            label: '$(globe) Bilingual / 双语',
            description: 'English + Chinese — 中英双语',
            detail: currentLanguage === 'both' ? '✅ Current / 当前' : '',
        },
    ];

    const picked = await vscode.window.showQuickPick(items, {
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

    await setLanguage(lang, context);
}

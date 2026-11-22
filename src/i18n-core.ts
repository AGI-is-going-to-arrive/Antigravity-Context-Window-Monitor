import type { StateBucket } from './durable-state';

// ─── Language Types ───────────────────────────────────────────────────────────

export type Language = 'zh' | 'en' | 'both';

export function isLanguage(value: unknown): value is Language {
    return value === 'zh' || value === 'en' || value === 'both';
}

// ─── Translation Keys ────────────────────────────────────────────────────────

export interface TranslationEntry {
    en: string;
    zh: string;
}

/** All translatable string keys used across the extension and Antigravity App UI. */
export const translations: Record<string, TranslationEntry> = {
    // ─ Status Bar
    'statusBar.initializing': { en: 'Context...', zh: '上下文...' },
    'statusBar.initializingTooltip': { en: 'Antigravity Context Monitor: Initializing...', zh: 'Antigravity 上下文监控：初始化中...' },
    'statusBar.disconnectedLabel': { en: 'Context: N/A', zh: '上下文：不可用' },
    'statusBar.backendNotFound': { en: 'Antigravity backend not found. Waiting for the language server or agy hub.', zh: '未找到 Antigravity 后端，正在等待语言服务器或 agy hub 启动。' },
    'statusBar.backendConnectionLost': { en: 'Connection to the Antigravity backend was lost. Reconnecting...', zh: '与 Antigravity 后端的连接已断开，正在重新连接...' },
    'statusBar.noConversationTooltip': { en: 'No active conversation', zh: '无活跃会话' },
    'statusBar.clickToView': { en: 'Click to view details', zh: '点击查看详情' },
    'statusBar.idle': { en: 'Idle', zh: '空闲' },
    'statusBar.idleDescription': { en: 'New or ended conversation', zh: '新建对话或已结束' },
    'statusBar.name': { en: 'Context Window Monitor', zh: '上下文窗口监控' },

    // ─ Tooltip
    'tooltip.title': { en: 'Context Window Usage', zh: '上下文窗口使用情况' },
    'tooltip.model': { en: 'Model', zh: '模型' },
    'tooltip.session': { en: 'Session', zh: '会话' },
    'tooltip.totalContextUsed': { en: 'Total Context Used (input+output)', zh: '总上下文占用（输入 + 输出）' },
    'tooltip.modelOutput': { en: 'Model Output', zh: '模型输出' },
    'tooltip.toolResults': { en: 'Tool Results', zh: '工具结果' },
    'tooltip.limit': { en: 'Limit', zh: '窗口上限' },
    'tooltip.usage': { en: 'Usage', zh: '使用率' },
    'tooltip.remaining': { en: 'Remaining', zh: '剩余' },
    'tooltip.steps': { en: 'Steps', zh: '步骤数' },
    'tooltip.compressing': { en: 'Model is auto-compressing context', zh: '模型正自动压缩上下文' },
    'tooltip.compressingHint': { en: 'Context will shrink after compression completes.', zh: '压缩完成后数值将下降。' },
    'tooltip.compressed': { en: 'Context was auto-compressed', zh: '上下文已被模型自动压缩' },
    'tooltip.contextDecreased': { en: 'Measured context decreased', zh: '实测上下文减少' },
    'tooltip.before': { en: 'Before', zh: '压缩前' },
    'tooltip.after': { en: 'After', zh: '压缩后' },
    'tooltip.contextDrop': { en: 'Context Drop', zh: '上下文压缩量' },
    'tooltip.checkpointDrop': { en: 'Checkpoint Input Drop', zh: '检查点输入压缩量' },
    'tooltip.dataIncomplete': { en: 'Data may be incomplete (some step batches failed to load)', zh: '数据可能不完整（部分步骤批次加载失败）' },
    'tooltip.imageGen': { en: 'Image Gen', zh: '图片生成' },
    'tooltip.imageGenSteps': { en: 'step(s) detected', zh: '个图片生成步骤' },
    'tooltip.estDelta': { en: 'Est. delta', zh: '估算增量' },
    'tooltip.sinceCheckpoint': { en: 'since last checkpoint', zh: '自上次检查点' },
    'tooltip.lastCheckpoint': { en: 'Last Checkpoint', zh: '最近检查点' },
    'tooltip.lastModelUsage': { en: 'Latest Model Usage', zh: '最近模型用量' },
    'tooltip.sinceModelCall': { en: 'since last model call', zh: '自上次模型调用' },
    'tooltip.input': { en: 'Input', zh: '输入' },
    'tooltip.output': { en: 'Output', zh: '输出' },
    'tooltip.cache': { en: 'Cache', zh: '缓存' },

    // ─ Units
    'unit.tokens': { en: 'tokens', zh: 'tokens' },
    'unit.token': { en: 'Token', zh: 'Token' },

    // ─ Telemetry (Speed / TTFT / Prompt Cache)
    'telemetry.speed': { en: 'Speed', zh: '生成速度' },
    'telemetry.genSpeed': { en: 'Gen Speed', zh: '生成速度' },
    'telemetry.visibleSpeed': { en: 'Visible Speed', zh: '可见速度' },
    'telemetry.endToEndSpeed': { en: 'End-to-End Speed', zh: '端到端速度' },
    'telemetry.ttft': { en: 'TTFT', zh: '首字延迟' },
    'telemetry.avgTtft': { en: 'Avg TTFT', zh: '平均首字延迟' },
    'telemetry.cachedTtft': { en: 'Cached TTFT', zh: '缓存命中首字' },
    'telemetry.uncachedTtft': { en: 'Uncached TTFT', zh: '未命中首字' },
    'telemetry.streaming': { en: 'Stream', zh: '流式耗时' },
    'telemetry.promptCache': { en: 'Prompt Cache', zh: '提示词缓存' },
    'telemetry.cacheHit': { en: 'Cache Hit', zh: '缓存命中' },
    'telemetry.cacheRead': { en: 'Cache Read', zh: '缓存读取' },
    'telemetry.cacheWrite': { en: 'Cache Write', zh: '缓存写入' },
    'telemetry.freshInput': { en: 'Fresh Input', zh: '新输入' },
    'telemetry.cacheSaved': { en: 'Cache Saved', zh: '缓存节省' },
    'telemetry.cacheReuse': { en: 'Cache Reuse', zh: '缓存复用' },
    'telemetry.callHitRatio': { en: 'Call Hit Ratio', zh: '调用命中率' },
    'telemetry.cacheState.warm': { en: 'Warm', zh: '热缓存' },
    'telemetry.cacheState.warming': { en: 'Warming', zh: '预热中' },
    'telemetry.cacheState.cold': { en: 'Cold', zh: '未命中' },
    'telemetry.cacheState.unknown': { en: 'No data', zh: '无数据' },
    'telemetry.sectionTitle': { en: 'Speed & First-Token Cache', zh: '生成速度与首字缓存' },
    'telemetry.latest': { en: 'Latest', zh: '最近' },
    'telemetry.weightedAvg': { en: 'Weighted Avg', zh: '加权平均' },
    'telemetry.median': { en: 'Median', zh: '中位数' },
    'telemetry.range': { en: 'Range', zh: '范围' },
    'telemetry.notReported': { en: 'Not reported', zh: '未上报' },
    'telemetry.totalLatency': { en: 'Total', zh: '总耗时' },
    'telemetry.latestCall': { en: 'Latest Call', zh: '最近调用' },
    'telemetry.recentCalls': { en: 'Recent Calls', zh: '最近调用明细' },
    'telemetry.sessionCost': { en: 'Session', zh: '会话' },
    'telemetry.todayCost': { en: 'Today', zh: '今日' },
    'telemetry.cost': { en: 'Cost', zh: '费用' },
    'telemetry.unpriced': { en: 'Unpriced', zh: '未定价' },
    'telemetry.rateChange': { en: 'Price Notice', zh: '调价提醒' },
    'telemetry.retryWaste': { en: 'Retry Waste', zh: '重试开销' },
    'telemetry.blendedInput': { en: 'Eff. In', zh: '有效输入' },

    // ─ Orchestrator & Quota Windows
    'orchestrator.settings': { en: 'Orchestrator Settings', zh: '编排器设置' },
    'orchestrator.model': { en: 'Orchestrator Model', zh: '编排模型' },
    'orchestrator.executor': { en: 'Executor Model', zh: '执行模型' },
    'orchestrator.planner': { en: 'Planner', zh: '规划' },
    'orchestrator.worker': { en: 'Executor', zh: '执行' },
    'orchestrator.crossPool': { en: 'Cross-pool', zh: '跨池' },
    'orchestrator.default': { en: 'Default', zh: '默认' },
    'orchestrator.custom': { en: 'Custom', zh: '自定义' },
    'quota.fiveHour': { en: '5h', zh: '5h' },
    'quota.weekly': { en: 'Weekly', zh: '周额度' },
    'quota.notice': { en: 'Notice', zh: '提示' },

    // ─ v1.17.5 Context Breakdown, Dual Cap & Measurement State
    'context.breakdown': { en: 'Context Breakdown', zh: '上下文构成' },
    'context.dotMatrix': { en: 'Dot Matrix', zh: '点阵视图' },
    'context.barView': { en: 'Bar View', zh: '条形视图' },
    'context.effectiveBudget': { en: 'Effective Budget', zh: '有效预算' },
    'context.nativeCeiling': { en: 'Native Ceiling', zh: '原生上限' },
    'context.measured': { en: 'Measured', zh: '实测' },
    'context.estimated': { en: 'Estimated', zh: '估算' },
    'context.postCompaction': { en: 'Post-Compaction', zh: '压缩后估算' },
    'context.rewind': { en: 'Rewind', zh: '回退重算' },
    'context.awaitingGeneration': { en: 'Awaiting Generation', zh: '等待生成' },
    'context.largestItems': { en: 'Largest Items', zh: '最大占用项' },

    // ─ v1.17.5 Agent & Conversation Selection
    'agent.lockToMain': { en: 'Lock to Main Agent', zh: '锁定主会话' },
    'agent.followActive': { en: 'Follow Active', zh: '跟随活跃会话' },
    'agent.conversationSwitcher': { en: 'Conversation Switcher', zh: '会话切换器' },

    // ─ v1.17.5 Turn & Cache Diagnostics
    'turn.coldStart': { en: 'Cold Start', zh: '冷启动' },
    'turn.partialStart': { en: 'Partial Start', zh: '部分命中' },
    'turn.warmStart': { en: 'Warm Start', zh: '热缓存启动' },
    'turn.lastTurnCache': { en: 'Last-Turn Cache', zh: '上轮缓存' },
    'turn.sessionCache': { en: 'Session Cache', zh: '会话缓存' },

    // ─ v1.17.5 Quota Runway, Stale Cache & Custom Model Isolation
    'quota.runway': { en: 'Quota Runway', zh: '配额续航' },
    'quota.safeBeforeReset': { en: 'Safe Before Reset', zh: '重置前充裕' },
    'quota.exhaustsIn': { en: 'Exhausts In', zh: '预计耗尽' },
    'quota.cachedStale': { en: 'Cached / Stale', zh: '缓存数据（待刷新）' },
    'quota.customModelIsolated': { en: 'Custom Model Isolated', zh: '自定义模型（配额独立）' },

    // ─ v1.17.5 Quick Copy Actions & Surfaces
    'action.copyContextReport': { en: 'Copy /context Report', zh: '复制 /context 报告' },
    'action.copyHandoffPrompt': { en: 'Copy Handoff Prompt', zh: '复制交接提示词' },
    'action.copied': { en: 'Copied', zh: '已复制' },
    'surface.antigravityApp': { en: 'Antigravity App', zh: 'Antigravity App' },
    'surface.antigravityIde': { en: 'Antigravity IDE', zh: 'Antigravity IDE' },

    // ─ v1.17.6 Navigation, Native HUD, Overlays, Updates & Cost/Currency
    'nav.profile': { en: 'Profile', zh: '账号' },
    'profile.accountInfo': { en: 'Profile', zh: '账号信息' },
    'hud.title': { en: 'Ambient HUD', zh: '顶部紧凑 HUD' },
    'hud.expand': { en: 'Expand HUD details', zh: '展开 HUD 详情' },
    'hud.collapse': { en: 'Collapse HUD details', zh: '收起 HUD 详情' },
    'hud.shortSample': { en: 'Short sample', zh: '短样本' },
    'hud.waitingTtft': { en: 'Waiting TTFT', zh: '等待首字' },
    'hud.estCost': { en: 'Est. Cost', zh: '估算费用' },
    'hud.tightestQuota': { en: 'Quota', zh: '配额' },
    'overview.lowQuotaTitle': { en: 'Low Quota Warning', zh: '低配额警告' },
    'overview.compactionLimit': { en: 'Compaction Limit', zh: '自动压缩上限' },
    'overview.physicalWindow': { en: 'Physical Window', zh: '物理窗口' },
    'overview.longContextTier': { en: '200k Long-Context Tier', zh: '200k 长上下文阶梯' },
    'overview.turnCacheStart': { en: 'Turn Start Cache', zh: '本轮首调缓存' },
    'overview.netGrowth': { en: 'Net Growth', zh: '净增长' },
    'settings.appOverlays': { en: 'App Ambient Overlays (Opt-In CDP)', zh: 'App 桌面悬浮组件（可选 CDP）' },
    'settings.composerRing': { en: 'Composer Context Ring — Left of Turbo', zh: '对话框悬浮环（Turbo 左侧）' },
    'settings.topBarOverlay': { en: 'Top-Right Status Bar & Quota Board', zh: '右上角常驻状态栏与额度看板' },
    'settings.nativeHudBar': { en: 'Native Panel Compact HUD', zh: '面板顶部紧凑 HUD' },
    'settings.cdpDisabled': { en: 'Disabled', zh: '未启用' },
    'settings.cdpConnected': { en: 'Connected', zh: '已连接' },
    'settings.cdpInactive': { en: 'CDP Inactive', zh: 'CDP 未就绪' },
    'settings.cdpError': { en: 'CDP Error', zh: 'CDP 异常' },
    'settings.updates': { en: 'Updates & Release Checks', zh: '版本更新与检查' },
    'settings.autoCheckUpdates': { en: 'Automatically check for updates', zh: '自动检查新版本' },
    'settings.checkForUpdates': { en: 'Check for Updates', zh: '检查更新' },
    'settings.upgradeNow': { en: 'Upgrade Now', zh: '立即升级' },
    'settings.upToDate': { en: 'Up to date', zh: '已是最新' },
    'settings.updateAvailable': { en: 'Update available', zh: '有可用更新' },
    'settings.costCurrencyHistory': { en: 'Cost, Currency & History', zh: '费用、货币与历史' },
    'settings.orchestratorPricingMode': { en: 'Orchestrator pricing mode', zh: '编排模型计费模式' },
    'settings.mappedBase': { en: 'Mapped Base', zh: '按底座估算' },
    'settings.strictMode': { en: 'Strict', zh: '严格模式' },
    'settings.displayCurrency': { en: 'Display currency', zh: '显示货币' },
    'settings.customFxRate': { en: 'Custom FX rate (per 1 USD)', zh: '自定义汇率（每 1 USD）' },
    'settings.subscriptionPlan': { en: 'Subscription plan (ROI reference)', zh: '订阅方案（ROI 参考）' },
    'settings.subscriptionFee': { en: 'Monthly fee', zh: '月费金额' },
    'settings.subscriptionCurrency': { en: 'Fee currency', zh: '月费币种' },
    'settings.calendarRetention': { en: 'Calendar retention (days)', zh: '日历历史保留天数' },
    'settings.maxRecentSteps': { en: 'Max recent activity steps', zh: '最近活动步骤上限' },
    'settings.maxArchives': { en: 'Max archived activity sessions', zh: '活动归档会话上限' },
    'about.versionUpdates': { en: 'Version & Updates', zh: '版本与更新' },
    'about.aiAgentInstallTip': { en: 'AI Agent Install / Upgrade Tip', zh: 'AI Agent 一句话安装 / 升级提示' },

    // ─ QuickPick Panel
    'panel.title': { en: 'Antigravity Monitor', zh: 'Antigravity 监控面板' },
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
    'panel.preciseShort': { en: 'GM', zh: 'GM' },
    'panel.compressed': { en: 'Compressed', zh: '已压缩' },
    'panel.contextDecreased': { en: 'Context decreased', zh: '上下文减少' },
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

export function initI18nFromState(state: StateBucket): void {
    const saved = state.get<Language>('displayLanguage', 'both');
    if (saved && isLanguage(saved)) {
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
 * Update the in-memory display language without touching persistent storage.
 */
export function setLanguageInMemory(lang: Language): void {
    if (isLanguage(lang)) {
        currentLanguage = lang;
    }
}

export async function setLanguageToState(lang: Language, state: StateBucket): Promise<void> {
    currentLanguage = lang;
    await state.update('displayLanguage', lang);
}

/**
 * Translate a key to the current (or explicitly requested) language.
 *
 * - `'zh'` → returns Chinese text only
 * - `'en'` → returns English text only
 * - `'both'` → returns "English / 中文" if both differ, otherwise just one
 */
export function t(key: string, lang: Language = currentLanguage): string {
    const entry = translations[key];
    if (!entry) { return key; }

    switch (lang) {
        case 'zh':
            return entry.zh;
        case 'en':
            return entry.en;
        case 'both':
        default:
            if (!entry.en) { return entry.zh; }
            if (!entry.zh) { return entry.en; }
            // If both are identical (e.g. proper names or developer units), don't duplicate
            if (entry.en === entry.zh) { return entry.en; }
            return `${entry.en} / ${entry.zh}`;
    }
}

/**
 * Bilingual helper — returns the appropriate separator-joined string
 * based on current (or explicitly requested) language setting.
 *
 * Usage: `tBi('Model Output', '模型输出')` →
 * - zh: "模型输出"
 * - en: "Model Output"
 * - both: "Model Output / 模型输出"
 */
export function tBi(en: string, zh: string, separator: string = ' / ', lang: Language = currentLanguage): string {
    switch (lang) {
        case 'zh': return zh;
        case 'en': return en;
        case 'both':
        default:
            if (!en) { return zh; }
            if (!zh) { return en; }
            if (en === zh) { return en; }
            return `${en}${separator}${zh}`;
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Structured bilingual HTML helper for visible webview headings, tabs, buttons, and labels.
 * Preserves plain-text `textContent` / accessibility names (`"English / 中文"`) while
 * allowing CSS to subordinate `.bi-sep` and `.bi-zh` in bilingual mode.
 */
export function tBiHtml(en: string, zh: string, separator: string = ' / ', lang: Language = currentLanguage): string {
    switch (lang) {
        case 'zh': return escapeHtml(zh);
        case 'en': return escapeHtml(en);
        case 'both':
        default:
            if (!en) { return escapeHtml(zh); }
            if (!zh) { return escapeHtml(en); }
            if (en === zh) { return escapeHtml(en); }
            return `<span class="bi-en">${escapeHtml(en)}</span><span class="bi-sep">${escapeHtml(separator)}</span><span class="bi-zh">${escapeHtml(zh)}</span>`;
    }
}

/**
 * Format a finite number using the extension's UI locale (`zh-CN` / `en-US`)
 * rather than the host OS locale so separators stay consistent across platforms.
 */
export function formatNumber(
    value: number,
    options?: Intl.NumberFormatOptions,
    lang: Language = currentLanguage,
): string {
    return value.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', options);
}

/**
 * Format a wall-clock timestamp in deterministic 24-hour `HH:MM:SS` using explicit
 * UI locale (`zh-CN` for `'zh'`, `en-US` for `'en'`/`'both'`) instead of host OS locale.
 */
export function formatClockTime(date: Date, lang: Language = currentLanguage): string {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
        return '--:--:--';
    }
    const locale = lang === 'zh' ? 'zh-CN' : 'en-US';
    const formatted = date.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        hourCycle: 'h23',
    });
    // Guard older ICU builds that occasionally emit "24:MM:SS" for midnight.
    return formatted.startsWith('24:') ? `00:${formatted.slice(3)}` : formatted;
}

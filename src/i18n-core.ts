import type { StateBucket } from './durable-state';

// ─── Language & Preference Types ──────────────────────────────────────────────

export type Language = 'zh' | 'en' | 'both';
export type PrimaryLanguage = 'en' | 'zh';
export type LanguagePreference = 'auto' | 'en' | 'zh' | 'both';
export type EffectiveDisplayLanguage = 'en' | 'zh' | 'both';

export const DEFAULT_COMPACT_BREAKPOINT_PX = 480;

export interface HostLocaleSources {
    /** IDE UI language (highest priority when running in Antigravity IDE / VS Code host). */
    vscodeLanguage?: string | null;
    /** App host or browser locale (e.g. `navigator.language`, `Accept-Language`, OS preferred language). */
    hostLocale?: string | null;
    /** Normalized runtime `Intl` locale (e.g. `Intl.DateTimeFormat().resolvedOptions().locale`). */
    intlLocale?: string | null;
    /** Platform environment locale (e.g. `LC_ALL`, `LC_MESSAGES`, `LANG`). */
    envLocale?: string | null;
}

export interface PerViewLanguageOptions extends HostLocaleSources {
    /** Current viewport width of THIS specific view in CSS pixels. `null`/non-positive means unknown/unmeasured. */
    viewportWidthPx?: number | null;
    /** Inclusive CSS pixel breakpoint at or below which `'both'` compacts to the detected primary single language. Defaults to `480`. */
    compactBreakpointPx?: number;
}

export function isLanguage(value: unknown): value is Language {
    return value === 'zh' || value === 'en' || value === 'both';
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
    return value === 'auto' || value === 'en' || value === 'zh' || value === 'both';
}

export function isEffectiveDisplayLanguage(value: unknown): value is EffectiveDisplayLanguage {
    return isLanguage(value);
}

// ─── Host Locale Normalization & Per-View Effective Language Engine ──────────

const NEUTRAL_LOCALE_TAGS = new Set(['C', 'POSIX', 'UND', 'UNKNOWN']);
const CHINESE_PRIMARY_SUBTAGS = new Set(['zh', 'zho', 'cmn', 'yue']);
const VALID_LOCALE_TAG_RE = /^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/;

/**
 * Normalize a raw locale string (BCP-47, POSIX `zh_CN.UTF-8`, HTTP `Accept-Language`,
 * or multi-line platform preference list) into a lowercase hyphen-separated primary tag.
 * Returns `null` for empty, malformed, `C`, or `POSIX` values so callers can safely fall through.
 */
export function normalizeLocaleTag(raw: string | null | undefined): string | null {
    if (typeof raw !== 'string') { return null; }
    // Take only the primary entry from Accept-Language or multi-line lists (never grep later entries).
    const firstEntry = raw
        .split(/[\r\n,]+/)
        .map(part => part.trim())
        .find(part => part.length > 0);
    if (!firstEntry) { return null; }

    // Strip quality weight (";q=0.9"), POSIX codeset (".UTF-8"), and modifier ("@euro").
    const cleaned = firstEntry
        .split(';')[0]
        .split('.')[0]
        .split('@')[0]
        .trim()
        .replace(/_/g, '-');
    if (!cleaned) { return null; }

    if (NEUTRAL_LOCALE_TAGS.has(cleaned.toUpperCase())) {
        return null;
    }

    const lowered = cleaned.toLowerCase();
    if (!VALID_LOCALE_TAG_RE.test(lowered)) {
        return null;
    }
    return lowered;
}

/**
 * Pure, deterministic first-boot host locale detector.
 * Priority: IDE `vscodeLanguage` -> App `hostLocale` -> `intlLocale` -> `envLocale`.
 * Maps all Chinese variants (`zh`, `zh-CN`, `zh-Hant`, `zh-TW`, `zh-HK`, `zh_CN.UTF-8`, etc.)
 * to `'zh'`, and safely maps English, other locales, `C`, `POSIX`, empty, and unknown values to `'en'`.
 */
export function detectHostLocaleLanguage(locales: HostLocaleSources = {}): PrimaryLanguage {
    const candidates = [
        locales.vscodeLanguage,
        locales.hostLocale,
        locales.intlLocale,
        locales.envLocale,
    ];
    for (const candidate of candidates) {
        const normalized = normalizeLocaleTag(candidate);
        if (!normalized) { continue; }
        const primarySubtag = normalized.split('-')[0];
        if (CHINESE_PRIMARY_SUBTAGS.has(primarySubtag)) {
            return 'zh';
        }
        return 'en';
    }
    return 'en';
}

let defaultHostLocaleHints: HostLocaleSources = {};

/**
 * Register host-level default locale hints (e.g. IDE `vscode.env.language` captured during
 * extension activation) used as defaults by `getRuntimeLocaleSources()` when not explicitly overridden.
 */
export function setDefaultHostLocaleHints(hints?: HostLocaleSources): void {
    defaultHostLocaleHints = hints ? { ...hints } : {};
}

/**
 * Collect runtime locale sources (`Intl` + `LC_ALL` / `LC_MESSAGES` / `LANG`), merged with
 * any registered host defaults and caller-supplied overrides.
 */
export function getRuntimeLocaleSources(overrides: HostLocaleSources = {}): HostLocaleSources {
    let runtimeIntl: string | undefined;
    try {
        runtimeIntl = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
        runtimeIntl = undefined;
    }
    const envObj = typeof process !== 'undefined' && process && process.env ? process.env : undefined;
    const runtimeEnv = envObj
        ? (envObj.LC_ALL || envObj.LC_MESSAGES || envObj.LANG || undefined)
        : undefined;

    return {
        vscodeLanguage: overrides.vscodeLanguage !== undefined ? overrides.vscodeLanguage : defaultHostLocaleHints.vscodeLanguage,
        hostLocale: overrides.hostLocale !== undefined ? overrides.hostLocale : defaultHostLocaleHints.hostLocale,
        intlLocale: overrides.intlLocale !== undefined
            ? overrides.intlLocale
            : (defaultHostLocaleHints.intlLocale !== undefined ? defaultHostLocaleHints.intlLocale : runtimeIntl),
        envLocale: overrides.envLocale !== undefined
            ? overrides.envLocale
            : (defaultHostLocaleHints.envLocale !== undefined ? defaultHostLocaleHints.envLocale : runtimeEnv),
    };
}

/**
 * Pure per-view effective display language resolver (D3 / §5.3).
 *
 * - Explicit `'en'` / `'zh'` always stay `'en'` / `'zh'`.
 * - `'auto'` (or missing/unset preference) resolves via `detectHostLocaleLanguage(options)`.
 * - Explicit `'both'` is preserved when viewport width is unknown or `> compactBreakpointPx` (default `480`),
 *   and compacts strictly for THIS view to the detected primary single language (`'zh'` or `'en'`)
 *   when `0 < viewportWidthPx <= compactBreakpointPx`.
 * - NEVER mutates global or persisted state, so resizing a 479px AUX_PANE never affects a 960px SIDEBAR or another host.
 */
export function resolvePerViewEffectiveLanguage(
    preference: LanguagePreference | null | undefined,
    options: PerViewLanguageOptions = {},
): EffectiveDisplayLanguage {
    const pref: LanguagePreference = isLanguagePreference(preference) ? preference : 'auto';
    if (pref === 'en' || pref === 'zh') {
        return pref;
    }

    const detectedPrimary = detectHostLocaleLanguage(options);
    if (pref === 'auto') {
        return detectedPrimary;
    }

    // pref === 'both'
    const breakpoint = typeof options.compactBreakpointPx === 'number'
        && Number.isFinite(options.compactBreakpointPx)
        && options.compactBreakpointPx > 0
        ? options.compactBreakpointPx
        : DEFAULT_COMPACT_BREAKPOINT_PX;

    const width = options.viewportWidthPx;
    if (typeof width === 'number' && Number.isFinite(width) && width > 0 && width <= breakpoint) {
        return detectedPrimary;
    }
    return 'both';
}

// ─── Translation Keys ────────────────────────────────────────────────────────

export interface TranslationEntry {
    en: string;
    zh: string;
}

function parseTranslationCatalog(raw: string): Readonly<Record<string, TranslationEntry>> {
    const out: Record<string, TranslationEntry> = {};
    for (const line of raw.split('\n')) {
        if (!line) { continue; }
        const [key, en, zh] = line.split('\t');
        if (key) { out[key] = { en, zh }; }
    }
    return out;
}

/**
 * Core live translation keys referenced across `src/` and existing tests.
 * All 119 verified dead keys from prior versions have been pruned, and all Chinese strings
 * strictly enforce the v1.18.0 terminology glossary:
 * 账号 / 配额 / 费用 / 冷启动 (vs 实测 缓存未命中) / 首字延迟 / 模型调用 / 原生窗口上限 / 冻结面板.
 */
export const CORE_TRANSLATIONS: Readonly<Record<string, TranslationEntry>> = parseTranslationCatalog(`statusBar.initializing\tContext...\t上下文...
statusBar.disconnectedLabel\tContext: N/A\t上下文：不可用
statusBar.backendNotFound\tAntigravity backend not found. Waiting for the language server or agy hub.\t未找到 Antigravity 后端，正在等待语言服务器或 agy hub 启动。
statusBar.backendConnectionLost\tConnection to the Antigravity backend was lost. Reconnecting...\t与 Antigravity 后端的连接已断开，正在重新连接...
statusBar.noConversationTooltip\tNo active conversation\t无活跃会话
statusBar.idle\tIdle\t空闲
statusBar.name\tContext Window Monitor\t上下文窗口监控
tooltip.modelOutput\tModel Output\t模型输出
tooltip.toolResults\tTool Results\t工具结果
tooltip.compressed\tContext was auto-compressed\t上下文已被模型自动压缩
tooltip.contextDecreased\tMeasured context decreased\t实测上下文减少
tooltip.imageGen\tImage Gen\t图片生成
tooltip.lastCheckpoint\tLast Checkpoint\t最近检查点
unit.tokens\ttokens\ttokens
unit.token\tToken\tToken
telemetry.promptCache\tPrompt Cache\t提示词缓存
telemetry.cacheState.warm\tWarm\t热缓存
telemetry.cacheState.warmCached\tWarm (Cached)\t热缓存（命中）
telemetry.cacheState.warming\tWarming\t预热中
telemetry.cacheState.cold\tCold\t缓存未命中
telemetry.totalLatency\tTotal\t总耗时
telemetry.latestCall\tLatest Call\t最近调用
telemetry.recentCalls\tRecent Calls\t最近模型调用
telemetry.sessionCost\tSession\t会话
telemetry.todayCost\tToday\t今日
telemetry.cost\tCost\t费用
telemetry.unpriced\tUnpriced\t未定价
telemetry.rateChange\tPrice Notice\t调价提醒
telemetry.retryWaste\tRetry Waste\t重试开销
telemetry.blendedInput\tEff. In\t有效输入
orchestrator.settings\tOrchestrator Settings\t编排设置
orchestrator.model\tOrchestrator Model\t编排模型
orchestrator.executor\tExecutor Model\t执行模型
orchestrator.planner\tPlanner\t规划
orchestrator.worker\tExecutor\t执行
orchestrator.crossPool\tCross-pool\t跨池
quota.fiveHour\t5h\t5h
quota.weekly\tWeekly\t周配额
quota.notice\tNotice\t提示
context.breakdown\tContext Breakdown\t上下文构成
context.dotMatrix\tDot Matrix\t点阵视图
context.barView\tBar View\t条形视图
context.effectiveBudget\tEffective Budget\t自动压缩上限（有效预算）
context.nativeCeiling\tNative Ceiling\t原生窗口上限
context.measured\tMeasured\t实测
context.estimated\tEstimated\t估算
context.postCompaction\tPost-Compaction\t压缩后估算
context.rewind\tRewind\t回退重算
context.awaitingGeneration\tAwaiting Generation\t等待生成
context.largestItems\tLargest Items\t最大占用项
agent.lockToMain\tLock to Main Agent\t锁定主会话
agent.followActive\tFollow Active\t跟随活跃会话
agent.conversationSwitcher\tConversation Switcher\t会话切换器
agent.subagents\tSubagents\t子智能体
service.localService\tLocal Service\t本地服务
turn.coldStart\tCold Start\t冷启动
turn.partialStart\tPartial Start\t部分命中
turn.warmStart\tWarm Start\t热缓存启动
turn.lastTurnCache\tLast-Turn Cache\t上轮缓存
turn.sessionCache\tSession Cache\t会话缓存
quota.runway\tQuota Runway\t配额续航
quota.safeBeforeReset\tSafe Before Reset\t重置前充裕
quota.exhaustsIn\tExhausts In\t预计耗尽
quota.cachedStale\tCached / Stale\t缓存数据（待刷新）
quota.customModelIsolated\tCustom Model Isolated\t自定义模型（配额独立）
action.copyContextReport\tCopy /context Report\t复制 /context 报告
action.copyHandoffPrompt\tCopy Handoff Prompt\t复制交接提示词
action.copied\tCopied\t已复制
surface.antigravityApp\tAntigravity App\tAntigravity App
surface.antigravityIde\tAntigravity IDE\tAntigravity IDE
nav.profile\tProfile\t账号
profile.accountInfo\tProfile\t账号信息
overview.compactionLimit\tCompaction Limit\t自动压缩上限
panel.currentSessionLabel\tCurrent Session\t当前会话`);

/**
 * Phase 3 Wave 3B translation catalog (v1.18.0 IA, Cache 5m TTL, Decode vs E2E speed,
 * 5h/7d/tightest & Remaining/Used quotas, Weekly Active-Hours Forecast, Workspace Leaderboard,
 * Plan ROI reference disclaimer, Swarm/Subagent tracking, Handoff v2, Compaction Recovery Brief,
 * 6-tab Settings / JSON backup / Redacted diagnostics, and A11y polite live-region announcements).
 */
export const PHASE3_TRANSLATIONS: Readonly<Record<string, TranslationEntry>> = parseTranslationCatalog(`nav.overview\tOverview\t概览
nav.modelCalls\tModel Calls\t模型调用
nav.sessions\tSessions\t会话
nav.usageCost\tUsage & Cost\t用量与费用
nav.modelsQuotas\tModels & Quotas\t模型与配额
nav.settings\tSettings\t设置
nav.about\tAbout\t关于
cache.ttl5mHeuristic\t5m Idle TTL (Heuristic)\t5 分钟空闲 TTL（启发式预测）
cache.ttlWarm\tWarm (<3m idle)\t热缓存（空闲 <3 分钟）
cache.ttlExpiring\tExpiring Soon (3m–5m idle)\t即将过期（空闲 3–5 分钟）
cache.ttlColdPredicted\tPredicted Cold Start (>5m idle)\t冷启动（计时预测，空闲 >5 分钟）
cache.measuredMiss\tMeasured Cache Miss\t实测缓存未命中
cache.measuredReuse\tMeasured Cache Reuse\t实测缓存复用率
cache.possibleMissCause\tPossible Cache-Miss Cause\t缓存未命中可能原因
cache.cause.idleTtl\tLikely exceeded 5m idle TTL (heuristic)\t可能超出 5 分钟空闲 TTL（计时推算）
cache.cause.modelSwitch\tPossible cause: model switched\t可能原因：切换了模型
cache.cause.branchChange\tPossible cause: conversation or branch changed\t可能原因：会话或分支变更
cache.cause.compaction\tPossible cause: prefix invalidated by compaction\t可能原因：上下文压缩导致前缀失效
cache.cause.promptEdit\tPossible cause: system prompt or tool schema changed\t可能原因：系统提示词或工具定义变更
cache.cause.clockJump\tClock jump or sleep wake detected; TTL estimate paused\t检测到系统休眠或时钟跳变，暂停 TTL 计时推算
cache.unreported\tCache counts unreported\t缓存计数未上报
speed.decode\tDecode Speed\t生成解码速度
speed.e2eModelCall\tE2E Speed (Model Call)\t模型调用 E2E 速度
speed.e2eScopeHint\tModel-call level: output / (TTFT + streaming), excluding tool execution\t模型调用级：输出 /（首字延迟 + 流式耗时），不含工具执行耗时
speed.ttft\tTTFT\t首字延迟
speed.sampleCoverage\tSample Coverage\t有效样本覆盖
speed.waiting\tWaiting for first token\t等待首字延迟
speed.shortSample\tShort sample\t短样本
speed.missing\tSpeed unavailable\t暂无速度数据
speed.phaseBar\tCall Latency Breakdown\t模型调用阶段耗时
modelCalls.filterAnomaly\tAnomalies Only\t仅看异常调用
modelCalls.filterAll\tAll Model Calls\t全部模型调用
quota.window5h\t5-hour window\t5 小时窗口
quota.window7d\tWeekly window\t每周窗口
quota.windowTightest\tLower remaining quota\t按剩余较少的窗口
quota.directionRemaining\tRemaining\t剩余配额
quota.directionUsed\tUsed\t已用配额
quota.weeklyActiveForecast\tWeekly Active-Hours Forecast\t周活跃时长节奏预测
quota.insufficientHistory\tInsufficient history\t历史不足
quota.activeHoursSample\tObserved Active Hours\t已观测活跃时长
quota.burnRate\tActive Burn Rate\t活跃消耗速率
context.basisCompaction\tCompaction Limit\t自动压缩上限
context.basisNative\tNative Window Limit\t原生窗口上限
context.compactionWarning\tApproaching Auto-Compaction Limit\t临近自动压缩上限
panel.freeze\tFreeze Panel\t冻结面板
panel.unfreeze\tResume Live Updates\t解除冻结面板
panel.frozenHint\tPanel frozen — live polling paused\t已冻结面板，暂停实时刷新
usage.workspaceLeaderboard\tWorkspace Project Leaderboard\t工作区项目用量榜
usage.unattributed\tUnattributed\t未归属
usage.planRoiTitle\tPlan ROI Reference\t订阅方案 ROI 参考
usage.planRoiDisclaimer\tAPI equivalent reference ratio, not actual billing\tAPI 等效参考比，非实际账单
usage.exportMarkdown\tExport Markdown\t导出 Markdown
usage.exportCsv\tExport CSV\t导出 CSV
usage.exportJson\tExport JSON\t导出 JSON
usage.emptyDateRange\tNo dates selected — export will be empty\t未选择日期范围，导出结果将为空
usage.currencyCad\tCAD (CA$)\t加元 (CAD / CA$)
swarm.liveTracking\tSwarm / Subagent Live Tracking\t多智能体实时跟踪
swarm.rootLabel\tRoot Session\t主会话（Root）
swarm.inspectedWorker\tInspected Worker\t当前查看的子成员
swarm.inspect\tMember details\t成员详情
swarm.openOverview\tOpen member overview\t在概览中查看
swarm.noTrajectory\tThe member is absent from this host’s session list. Open its overview to request data directly.\t此成员未列入当前宿主的会话列表。打开成员概览可单独读取其数据。
swarm.readUnavailable\tNo measurement is available for this member.\t暂无该成员的实测数据。
swarm.opening\tOpening member overview…\t正在打开成员概览…
swarm.stillOpening\tStill reading member data…\t仍在读取该成员的数据…
swarm.openFailed\tMember overview could not be loaded. Refresh and try again.\t成员概览未能加载，请刷新后重试。
swarm.backToMain\tBack to Main\t返回主会话
swarm.retarget\tRetarget Lock Here\t切换锁定到此会话
swarm.retargetPrompt\tNew main conversation detected in another pane\t另一分屏检测到新的主会话
swarm.pendingUnavailable\tPending / Unavailable\t待确认 / 暂不可用
swarm.directCost\tMember Direct Cost\t单成员直接费用
swarm.groupCost\tRecorded group cost\t已记录的整组费用
swarm.noCalls\tNo calls recorded\t暂无调用记录
swarm.noPrice\tNo reference price\t暂无参考价
swarm.costCoverage\tMembers with recorded calls\t有调用记录的成员
swarm.unpricedCalls\tUnpriced Calls\t未定价调用数
swarm.assignedModel\tAssigned Model\t分配模型
swarm.measuredModel\tMeasured Model\t实测调用模型
swarm.partialCoverage\tPartial coverage (round-robin refresh)\t部分成员已刷新（公平轮转调度中）
swarm.lastObserved\tLast Observed\t最近观测时间
handoff.previewTitle\tHandoff v2 Preview\t交接提示词 v2 预览
handoff.readOnlyNotice\tRead-only preview — review before copying; never auto-injected\t只读预览：请核对后手动复制，绝不自动注入
compaction.recoveryTitle\tCompaction Recovery Brief\t压缩恢复摘要
compaction.recoverySubtitle\tRead-only summary for the latest compaction event\t最近一次上下文压缩事件的只读恢复摘要
compaction.dismissBrief\tDismiss Brief\t收起恢复摘要
settings.group.general\tGeneral & Language\t常规与语言
settings.group.telemetry\tTelemetry & Metrics\t遥测与指标口径
settings.group.overlays\tOverlays & CDP\t悬浮层与 CDP
settings.group.costHistory\tCost, Currency & History\t费用、币种与历史
settings.group.backupDiag\tBackup, Diagnostics & Updates\t备份、诊断与更新
settings.languagePreference\tLanguage Preference\t显示语言偏好
settings.languageAuto\tAuto (Follow System)\t自动（跟随系统）
settings.languageEn\tEnglish\tEnglish（仅英文）
settings.languageZh\tChinese (Simplified)\t中文
settings.languageBoth\tBilingual (EN + ZH)\t中英双语
settings.narrowCompactNote\tBilingual mode automatically compacts to your primary language in narrow panes (<=480px) without changing this setting.\t双语模式在窄栏视图（<=480px）中会自动紧凑为单语，仅作用于当前视图，不会修改此偏好设置。
settings.exportJsonBackup\tExport Settings JSON\t导出设置 JSON 备份
settings.importJsonBackup\tImport Settings JSON\t导入设置 JSON 备份
settings.exportRedactedDiag\tExport Redacted Diagnostics\t导出脱敏诊断包
settings.backupExclusions\tCredentials, release metadata, local paths, permissions, and live session IDs are excluded automatically.\t已自动排除凭据、发布元数据、本机路径、权限授予与在线会话 ID。
settings.hudApp\tApp Native Compact HUD\tApp 原生精简 HUD
settings.hudIde\tIDE Native Compact HUD\tIDE 原生精简 HUD
settings.hudAutoHideOverview\tAuto-hide HUD on Overview tab\t在概览页自动隐藏 HUD
settings.privacyMask\tPrivacy Mask (Hide Account & Paths)\t隐私遮罩（隐藏账号与路径）
a11y.statusRegionLabel\tMonitor status announcements\t监控状态无障碍播报
a11y.tabChanged\tSwitched view\t已切换视图
a11y.panelFrozen\tPanel frozen\t已冻结面板
a11y.panelResumed\tPanel live updates resumed\t已解除冻结面板，恢复实时刷新
a11y.lockAnchored\tLocked to root conversation\t已锁定主会话
a11y.lockReleased\tConversation lock released\t已解除主会话锁定
a11y.workerInspected\tInspecting swarm member; root lock preserved\t正在查看子成员，主会话锁定保持不变
a11y.returnedToMain\tReturned to main conversation\t已返回主会话
a11y.settingsSaved\tSettings saved\t设置已保存
a11y.settingsSaveFailed\tFailed to save settings\t设置保存失败
a11y.popoverDismissHint\tPress Escape to close details\t按 Esc 关闭详情浮层
a11y.privacyMasked\tPrivacy mask enabled; account details hidden\t已开启隐私遮罩，账号与路径已隐藏
a11y.privacyRevealed\tPrivacy mask disabled\t已关闭隐私遮罩`);

/** Explicit set of Phase 3 Wave 3B catalog keys for programmatic dead-key audits. */
export const PHASE3_WAVE3B_KEYS: ReadonlySet<string> = new Set(Object.keys(PHASE3_TRANSLATIONS));

/** All translatable string keys used across the extension and Antigravity App UI. */
export const translations: Record<string, TranslationEntry> = {
    ...CORE_TRANSLATIONS,
    ...PHASE3_TRANSLATIONS,
};

// ─── Current Language Preference & Effective State ───────────────────────────

let currentLanguagePreference: LanguagePreference = 'auto';
// Pre-init fallback remains 'both' for standalone component unit tests that render without
// booting a host; host initialization (`initI18n` / `initI18nFromState`) resolves unset
// preference ('auto') to the detected single host language ('en' | 'zh').
let currentLanguage: EffectiveDisplayLanguage = 'both';

/**
 * Read the persisted language preference from a `StateBucket`, separating an explicitly stored
 * `'both'` (which MUST be preserved permanently) from a missing/unset preference (`'auto'`).
 */
export function resolveStoredLanguagePreference(state: StateBucket): LanguagePreference {
    const rawDisplay = state.get<unknown>('displayLanguage', undefined);
    if (isLanguage(rawDisplay)) {
        return rawDisplay;
    }

    const rawTopPref = state.get<unknown>('languagePreference', undefined);
    if (isLanguagePreference(rawTopPref)) {
        return rawTopPref;
    }

    const rawAppSettings = state.get<unknown>('appSettings', undefined);
    if (rawAppSettings && typeof rawAppSettings === 'object' && !Array.isArray(rawAppSettings)) {
        const appPref = (rawAppSettings as Record<string, unknown>).languagePreference;
        if (isLanguagePreference(appPref)) {
            return appPref;
        }
    }

    return 'auto';
}

/**
 * Initialize i18n from persisted state.
 * - Explicitly persisted `'en'`, `'zh'`, or `'both'` is restored verbatim (preserving `'both'` permanently).
 * - Missing/unset state defaults to `'auto'` and resolves via host locale priority.
 */
export function initI18nFromState(
    state: StateBucket,
    localeHints?: HostLocaleSources,
): EffectiveDisplayLanguage {
    const preference = resolveStoredLanguagePreference(state);
    const sources = localeHints !== undefined
        ? getRuntimeLocaleSources(localeHints)
        : getRuntimeLocaleSources();
    return setLanguagePreferenceInMemory(preference, sources);
}

/**
 * Get the current persisted/in-memory language preference (`'auto' | 'en' | 'zh' | 'both'`).
 */
export function getLanguagePreference(): LanguagePreference {
    return currentLanguagePreference;
}

/**
 * Get the current default effective display language (`'en' | 'zh' | 'both'`).
 */
export function getLanguage(): Language {
    return currentLanguage;
}

/**
 * Update the in-memory language preference and derive the global fallback effective language
 * without touching persistent storage.
 */
export function setLanguagePreferenceInMemory(
    preference: LanguagePreference,
    localeHints?: HostLocaleSources,
): EffectiveDisplayLanguage {
    if (!isLanguagePreference(preference)) {
        return currentLanguage;
    }
    currentLanguagePreference = preference;
    const sources = localeHints !== undefined
        ? localeHints
        : getRuntimeLocaleSources();
    currentLanguage = resolvePerViewEffectiveLanguage(preference, sources);
    return currentLanguage;
}

/**
 * Persist a `LanguagePreference` (`'auto' | 'en' | 'zh' | 'both'`) to a `StateBucket`
 * and update in-memory state.
 */
export async function setLanguagePreferenceToState(
    preference: LanguagePreference,
    state: StateBucket,
    localeHints?: HostLocaleSources,
): Promise<EffectiveDisplayLanguage> {
    const effective = setLanguagePreferenceInMemory(preference, localeHints);
    await state.update('languagePreference', preference);
    await state.update('displayLanguage', preference === 'auto' ? undefined : preference);
    return effective;
}

/**
 * Update the in-memory display language without touching persistent storage.
 */
export function setLanguageInMemory(lang: Language): void {
    if (isLanguage(lang)) {
        currentLanguagePreference = lang;
        currentLanguage = lang;
    }
}

export async function setLanguageToState(lang: Language, state: StateBucket): Promise<void> {
    if (!isLanguage(lang)) { return; }
    currentLanguagePreference = lang;
    currentLanguage = lang;
    await state.update('displayLanguage', lang);
}

// ─── Translation & Formatting Helpers ────────────────────────────────────────

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
            return `<span class="bi-en">${escapeHtml(en)}</span><span class="bi-sep">${escapeHtml(separator)}</span><span class="bi-zh" lang="zh-CN">${escapeHtml(zh)}</span>`;
    }
}

/**
 * Translate a catalog key directly into structured bilingual HTML via `tBiHtml`.
 */
export function tHtml(key: string, lang: EffectiveDisplayLanguage = currentLanguage, separator: string = ' / '): string {
    const entry = translations[key];
    if (!entry) { return escapeHtml(key); }
    return tBiHtml(entry.en, entry.zh, separator, lang);
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

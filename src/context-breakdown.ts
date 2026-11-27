// ─── Pure Context Window Breakdown Engine ────────────────────────────────────
// Parses GetCascadeTrajectoryGeneratorMetadata (promptSections + usage +
// tokenBreakdown) and trajectory steps into a normalized, dual-cap, rewind- and
// compaction-aware ContextBreakdownSnapshot, plus dot-matrix layout and
// plain-text /context & HANDOFF.md report formatters.
//
// Zero VS Code, DOM, or external npm dependencies.

import {
    COMPRESSION_MIN_DROP,
    PLANNER_RESPONSE_ESTIMATE,
    StepType,
    USER_INPUT_OVERHEAD,
} from './constants';
import {
    getModelDisplayName,
    guessContextLimitSpec,
    normalizeModelDisplayName,
} from './models';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReportLanguage = 'en' | 'zh' | 'both';

export type ContextCategoryKey =
    | 'system'
    | 'rules_skills'
    | 'plugins_mcp'
    | 'subagents'
    | 'user'
    | 'assistant_thinking'
    | 'tools'
    | 'media_files'
    | 'other';

export type ContextMeasurementState =
    | 'measured'
    | 'estimated_post_compaction'
    | 'estimated_rewind'
    | 'awaiting_generation';

export type AttributionSource =
    | 'prompt_sections'
    | 'token_breakdown'
    | 'steps'
    | 'none';

export interface ContextCategoryMeta {
    key: ContextCategoryKey;
    labelEn: string;
    labelZh: string;
    descEn: string;
    descZh: string;
    tipEn: string;
    tipZh: string;
    colorToken: string;
    fallbackColor: string;
}

export interface ContextFreeSpaceMeta {
    key: 'free';
    labelEn: string;
    labelZh: string;
    descEn: string;
    descZh: string;
    tipEn: string;
    tipZh: string;
    colorToken: string;
}

export interface ContextCategorySegment {
    key: ContextCategoryKey;
    labelEn: string;
    labelZh: string;
    colorToken: string;
    tokens: number;
    /** Percentage of effective budget (or share of usedTokens when budget is unavailable). */
    pct: number;
    /** Percentage share of total usedTokens (sums to ~100 across active segments). */
    sharePct: number;
    itemCount: number;
    /** Top items (up to 3) attributed to this category, extracted before global top-5 truncation. */
    topItems: ContextBreakdownItem[];
}

export interface DotMatrixCell {
    index: number;
    category: ContextCategoryKey | 'free';
    colorToken: string;
    labelEn: string;
    labelZh: string;
    isFree: boolean;
}

export interface CompactionCheckpoint {
    stepIndex: number;
    beforeTokens: number;
    afterTokens: number;
    savedTokens: number;
    timestamp?: string;
}

export interface LargestContextItem {
    title: string;
    category: ContextCategoryKey;
    tokens: number;
    /** Percentage of usedTokens. */
    pct: number;
    /** Percentage of effectiveBudgetTokens (0 when budget unavailable). */
    budgetPct: number;
    stepIndex?: number;
}

export type ContextBreakdownItem = LargestContextItem;

export interface ContextBreakdownSnapshot {
    model: string;
    modelDisplayName: string;
    usedTokens: number;
    effectiveBudgetTokens: number;
    nativeLimitTokens: number;
    hasDualCap: boolean;
    effectivePct: number;
    nativePct: number;
    measurementState: ContextMeasurementState;
    attributionSource: AttributionSource;
    segments: ContextCategorySegment[];
    compactionCheckpoints: CompactionCheckpoint[];
    largestItems: LargestContextItem[];
    stepCount: number;
    hasPromptSections: boolean;
}

export interface PromptSectionLike {
    title?: string;
    tokenType?: string;
    contentLen?: number | string;
    numTokens?: number | string;
    tokens?: number | string;
}

export interface ChatModelUsageLike {
    model?: string;
    inputTokens?: number | string;
    outputTokens?: number | string;
    thinkingOutputTokens?: number | string;
    responseOutputTokens?: number | string;
    cacheReadTokens?: number | string;
    cacheCreationTokens?: number | string;
    apiProvider?: string;
}

export interface TokenBreakdownGroupLike {
    name?: string;
    type?: string;
    numTokens?: number | string;
    tokens?: number | string;
    children?: Array<{
        name?: string;
        numTokens?: number | string;
        tokens?: number | string;
    }>;
}

export interface GeneratorMetadataLike {
    stepIndices?: number[];
    executionId?: string;
    plannerConfig?: {
        truncationThresholdTokens?: number | string;
        [key: string]: unknown;
    };
    chatModel?: {
        model?: string;
        modelDisplayName?: string;
        responseModel?: string;
        promptSections?: PromptSectionLike[];
        usage?: ChatModelUsageLike;
        chatStartMetadata?: {
            createdAt?: string;
            startStepIndex?: number | string;
            checkpointIndex?: number | string;
            contextWindowMetadata?: {
                estimatedTokensUsed?: number | string;
                maxContextTokens?: number | string;
                tokenBreakdown?: {
                    groups?: TokenBreakdownGroupLike[];
                };
            };
        };
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface ContextBreakdownInput {
    generatorMetadata?: ReadonlyArray<GeneratorMetadataLike | Record<string, unknown>>;
    steps?: ReadonlyArray<Record<string, unknown>>;
    currentStepCount?: number;
    previousMaxStepCount?: number;
    previousUsedTokens?: number;
    model?: string;
    modelDisplayName?: string;
    effectiveBudgetTokens?: number;
    nativeLimitTokens?: number;
}

export interface ContextQuotaSummaryLine {
    poolName: string;
    remainingPct: number;
    resetCountdown?: string;
    runwayLabel?: string;
}

export interface ContextTextReportInput {
    snapshot: ContextBreakdownSnapshot;
    title?: string;
    workspacePath?: string;
    branchName?: string;
    cacheHitPct?: number | null;
    turnStartKind?: 'cold' | 'partial' | 'warm' | 'unknown';
    quotaSummary?: ReadonlyArray<ContextQuotaSummaryLine>;
}

export interface HandoffPromptInput {
    snapshot?: ContextBreakdownSnapshot;
    title?: string;
    workspacePath?: string;
    branchName?: string;
    model?: string;
    modelDisplayName?: string;
    recentTopics?: ReadonlyArray<string>;
    activeTools?: ReadonlyArray<string>;
    pendingTasks?: ReadonlyArray<string>;
    notes?: string;
}

// ─── Category Registry ───────────────────────────────────────────────────────

export const CONTEXT_CATEGORY_ORDER: readonly ContextCategoryKey[] = [
    'system',
    'rules_skills',
    'plugins_mcp',
    'subagents',
    'user',
    'assistant_thinking',
    'tools',
    'media_files',
    'other',
] as const;

export const CONTEXT_CATEGORY_META: Record<ContextCategoryKey, ContextCategoryMeta> = {
    system: {
        key: 'system',
        labelEn: 'System Prompt',
        labelZh: '系统提示',
        descEn: 'Base system instructions, environment metadata, and compaction summaries injected by Antigravity.',
        descZh: '由 Antigravity 自动注入的系统指令、环境上下文与压缩摘要。',
        tipEn: 'Platform-managed baseline; start a fresh handoff session if older compaction summaries accumulate.',
        tipZh: '由平台自动维护；若多次压缩后摘要堆积偏多，建议通过交接提示词开启新会话。',
        colorToken: '--ctx-cat-system',
        fallbackColor: '#7C93B0',
    },
    rules_skills: {
        key: 'rules_skills',
        labelEn: 'Rules & Skills',
        labelZh: '规则与技能',
        descEn: 'Active global/workspace rules, AGENTS.md guidelines, and loaded skill instructions.',
        descZh: '当前生效的全局/工作区规则、AGENTS.md 约束与已加载的技能说明。',
        tipEn: 'Keep rules concise and disable unused skills to lower fixed per-turn overhead.',
        tipZh: '精简规则文案并停用当前不需要的技能，可降低每轮对话的固定占用。',
        colorToken: '--ctx-cat-rules-skills',
        fallbackColor: '#F97352',
    },
    plugins_mcp: {
        key: 'plugins_mcp',
        labelEn: 'Plugins & MCP',
        labelZh: '插件与 MCP',
        descEn: 'Tool declarations and responses from installed plugins and connected MCP servers.',
        descZh: '已安装插件与 MCP 服务器注册的工具定义及返回结果。',
        tipEn: 'Disable unused MCP servers or plugins—their tool schemas are included on every turn.',
        tipZh: '关闭暂不使用的 MCP 服务或插件，减少每轮重复发送的工具定义开销。',
        colorToken: '--ctx-cat-plugins-mcp',
        fallbackColor: '#22D3EE',
    },
    subagents: {
        key: 'subagents',
        labelEn: 'Subagents',
        labelZh: '子智能体',
        descEn: 'Delegated subagent specs, swarm coordination briefs, and returned summaries.',
        descZh: '子智能体配置说明、协作任务指派与执行汇报结果。',
        tipEn: 'Ask subagents to return concise summaries rather than raw logs to protect the main window.',
        tipZh: '让子智能体仅返回精简结论而非完整日志，可显著减少主上下文占用。',
        colorToken: '--ctx-cat-subagents',
        fallbackColor: '#F472B6',
    },
    user: {
        key: 'user',
        labelEn: 'User Messages',
        labelZh: '用户消息',
        descEn: 'Your prompts, pasted snippets, and follow-up messages across this conversation.',
        descZh: '你在本会话中发送的提问、粘贴片段与追问消息。',
        tipEn: 'Reference file paths instead of pasting large code blocks or terminal logs directly.',
        tipZh: '尽量直接引用文件路径，避免在输入框中粘贴大段源码或终端日志。',
        colorToken: '--ctx-cat-user',
        fallbackColor: '#3B82F6',
    },
    assistant_thinking: {
        key: 'assistant_thinking',
        labelEn: 'Assistant & Thinking',
        labelZh: '助手与思考',
        descEn: 'Model replies and internal reasoning (Thinking) tokens retained in context.',
        descZh: '模型已生成的回复正文与思考过程（Thinking）所占用的上下文空间。',
        tipEn: 'Use a lower effort tier for routine edits, or hand off to a fresh thread when answers grow long.',
        tipZh: '日常小改动可切换到较低思考档位，长对话接近上限时及时交接开启新会话。',
        colorToken: '--ctx-cat-assistant',
        fallbackColor: '#A855F7',
    },
    tools: {
        key: 'tools',
        labelEn: 'Tools & Results',
        labelZh: '工具与结果',
        descEn: 'Tool call arguments, terminal command outputs, grep matches, and build or test logs.',
        descZh: '工具调用参数、终端命令输出、搜索结果与构建测试日志。',
        tipEn: 'Filter verbose command output (tail/grep) and avoid printing full build or test logs.',
        tipZh: '缩小搜索范围并过滤冗余终端输出，避免一次性打印整段构建或测试日志。',
        colorToken: '--ctx-cat-tools',
        fallbackColor: '#F5B841',
    },
    media_files: {
        key: 'media_files',
        labelEn: 'Files & Media',
        labelZh: '文件与媒体',
        descEn: 'Files read into context, diffs, screenshots, images, and attached documents.',
        descZh: '已读取的代码文件、差异对比、截图、图片与附件文档。',
        tipEn: 'Read targeted line ranges for large files and avoid keeping unnecessary screenshots.',
        tipZh: '大文件按需读取指定行段，并减少在长对话中保留无用图片或大附件。',
        colorToken: '--ctx-cat-media',
        fallbackColor: '#22C55E',
    },
    other: {
        key: 'other',
        labelEn: 'Other Context',
        labelZh: '其他上下文',
        descEn: 'Conversation framing and prompt tokens not tagged with a more specific category.',
        descZh: '未标注具体分类的对话历史与其余提示词开销。',
        tipEn: 'Typically drops automatically after auto-compaction or starting a fresh handoff session.',
        tipZh: '通常会在触发自动压缩或通过交接提示词开启新会话后明显回落。',
        colorToken: '--ctx-cat-other',
        fallbackColor: '#A8A29E',
    },
};

export const CONTEXT_FREE_SPACE_META: ContextFreeSpaceMeta = {
    key: 'free',
    labelEn: 'Free Space',
    labelZh: '剩余空间',
    descEn: 'Unallocated tokens remaining before Antigravity reaches its auto-compaction ceiling.',
    descZh: '距离 Antigravity 自动压缩上限前仍可自由使用的上下文余量。',
    tipEn: 'Copy a Handoff Prompt before free space drops below 20% to keep responses sharp and avoid surprise compaction.',
    tipZh: '当剩余空间低于 20% 时，建议复制交接提示词开启新会话，保持响应质量并避免被动压缩。',
    colorToken: '--ctx-cat-free',
};

const FREE_CELL_META = CONTEXT_FREE_SPACE_META;

const MAX_LARGEST_ITEMS = 5;
const MAX_CATEGORY_TOP_ITEMS = 3;
const MAX_ITEM_TITLE_LEN = 80;

// ─── Primitive Helpers ───────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function parseNonNegInt(value: unknown): number {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) { return 0; }
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
    }
    return 0;
}

function round1(value: number): number {
    if (!Number.isFinite(value)) { return 0; }
    return Math.round(value * 10) / 10;
}

function estimateTextTokens(text: string): number {
    if (!text) { return 0; }
    let ascii = 0;
    let nonAscii = 0;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) < 128) {
            ascii++;
        } else {
            nonAscii++;
        }
    }
    return Math.ceil(ascii / 4 + nonAscii / 1.5);
}

function sanitizeTitle(raw: string, maxLen = MAX_ITEM_TITLE_LEN): string {
    const cleaned = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) { return 'Untitled'; }
    if (cleaned.length <= maxLen) { return cleaned; }
    return cleaned.slice(0, Math.max(1, maxLen - 3)).trimEnd() + '...';
}

function formatCompactTokens(tokens: number): string {
    if (!Number.isFinite(tokens) || tokens <= 0) { return '0'; }
    if (tokens >= 1_000_000) {
        return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '')}M`;
    }
    if (tokens >= 1_000) {
        return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    }
    return String(Math.round(tokens));
}

function biText(en: string, zh: string, lang: ReportLanguage): string {
    if (lang === 'en') { return en; }
    if (lang === 'zh') { return zh; }
    return `${en} / ${zh}`;
}

// ─── Token Type & Step Classification ────────────────────────────────────────

/**
 * Map an Antigravity `tokenType` enum (e.g. `TOKEN_TYPE_SYSTEM_PROMPT`,
 * `TOKEN_TYPE_SKILLS`, `TOKEN_TYPE_RULES`, `TOKEN_TYPE_PLUGINS`,
 * `TOKEN_TYPE_SUBAGENTS`) and/or section title to one of the 9 normalized
 * context categories.
 */
export function mapTokenTypeToCategory(tokenType?: string, title?: string): ContextCategoryKey {
    const normType = (tokenType || '').trim().toUpperCase();
    const normTitle = (title || '').trim().toLowerCase();

    // 1. Authoritative tokenType enum mapping
    if (normType) {
        if (
            normType === 'TOKEN_TYPE_RULES'
            || normType === 'TOKEN_TYPE_USER_RULES'
            || normType === 'TOKEN_TYPE_SKILLS'
            || normType === 'TOKEN_TYPE_SKILL'
            || normType === 'TOKEN_TYPE_WORKFLOWS'
            || normType === 'TOKEN_TYPE_WORKFLOW'
            || normType === 'TOKEN_TYPE_AGENTS_MD'
            || normType === 'TOKEN_TYPE_CUSTOM_INSTRUCTIONS'
            || normType.includes('SKILL')
            || normType.includes('RULE')
            || normType.includes('WORKFLOW')
        ) {
            return 'rules_skills';
        }
        if (
            normType === 'TOKEN_TYPE_PLUGINS'
            || normType === 'TOKEN_TYPE_PLUGIN'
            || normType === 'TOKEN_TYPE_MCP'
            || normType === 'TOKEN_TYPE_MCP_SERVERS'
            || normType === 'TOKEN_TYPE_MCP_TOOLS'
            || normType === 'TOKEN_TYPE_MCP_RESOURCES'
            || normType.includes('PLUGIN')
            || normType.includes('MCP')
        ) {
            return 'plugins_mcp';
        }
        if (
            normType === 'TOKEN_TYPE_SUBAGENTS'
            || normType === 'TOKEN_TYPE_SUBAGENT'
            || normType === 'TOKEN_TYPE_SWARM'
            || normType === 'TOKEN_TYPE_DELEGATED_AGENTS'
            || normType.includes('SUBAGENT')
            || normType.includes('SWARM')
        ) {
            return 'subagents';
        }
        if (
            normType === 'TOKEN_TYPE_SYSTEM_PROMPT'
            || normType === 'TOKEN_TYPE_SYSTEM'
            || normType === 'TOKEN_TYPE_SYSTEM_INSTRUCTIONS'
            || normType === 'TOKEN_TYPE_IDENTITY'
            || normType === 'TOKEN_TYPE_PREAMBLE'
            || normType === 'TOKEN_TYPE_USER_INFO'
            || normType === 'TOKEN_TYPE_ENVIRONMENT'
            || normType === 'TOKEN_TYPE_CHECKPOINT'
            || normType === 'TOKEN_TYPE_ARTIFACTS'
            || normType === 'TOKEN_TYPE_KNOWLEDGE'
            || normType === 'TOKEN_TYPE_MEMORIES'
            || normType === 'TOKEN_TYPE_EPHEMERAL'
            || normType.includes('SYSTEM')
            || normType.includes('CHECKPOINT')
        ) {
            return 'system';
        }
        if (
            normType === 'TOKEN_TYPE_USER'
            || normType === 'TOKEN_TYPE_USER_MESSAGE'
            || normType === 'TOKEN_TYPE_USER_MESSAGES'
            || normType === 'TOKEN_TYPE_USER_INPUT'
            || normType.includes('USER_MESSAGE')
            || normType.includes('USER_INPUT')
        ) {
            return 'user';
        }
        if (
            normType === 'TOKEN_TYPE_ASSISTANT'
            || normType === 'TOKEN_TYPE_ASSISTANT_MESSAGES'
            || normType === 'TOKEN_TYPE_THINKING'
            || normType === 'TOKEN_TYPE_THOUGHT'
            || normType === 'TOKEN_TYPE_REASONING'
            || normType === 'TOKEN_TYPE_PLANNER_RESPONSE'
            || normType === 'TOKEN_TYPE_MODEL_RESPONSE'
            || normType.includes('ASSISTANT')
            || normType.includes('THINKING')
            || normType.includes('PLANNER')
        ) {
            return 'assistant_thinking';
        }
        if (
            normType === 'TOKEN_TYPE_TOOLS'
            || normType === 'TOKEN_TYPE_TOOL'
            || normType === 'TOKEN_TYPE_TOOL_DEFINITIONS'
            || normType === 'TOKEN_TYPE_TOOL_DECLARATIONS'
            || normType === 'TOKEN_TYPE_TOOL_SCHEMAS'
            || normType === 'TOKEN_TYPE_TOOL_CALLS'
            || normType === 'TOKEN_TYPE_TOOL_RESULTS'
            || normType === 'TOKEN_TYPE_TOOL_OUTPUT'
            || normType === 'TOKEN_TYPE_FUNCTION_CALLS'
            || normType === 'TOKEN_TYPE_COMMAND_OUTPUT'
            || normType.includes('TOOL')
            || normType.includes('FUNCTION')
        ) {
            return 'tools';
        }
        if (
            normType === 'TOKEN_TYPE_MEDIA'
            || normType === 'TOKEN_TYPE_FILES'
            || normType === 'TOKEN_TYPE_FILE'
            || normType === 'TOKEN_TYPE_IMAGES'
            || normType === 'TOKEN_TYPE_IMAGE'
            || normType === 'TOKEN_TYPE_ATTACHMENTS'
            || normType === 'TOKEN_TYPE_ATTACHMENT'
            || normType === 'TOKEN_TYPE_OPEN_FILES'
            || normType === 'TOKEN_TYPE_ACTIVE_EDITOR'
            || normType === 'TOKEN_TYPE_CODE_CONTEXT'
            || normType === 'TOKEN_TYPE_DIFF'
            || normType.includes('MEDIA')
            || normType.includes('IMAGE')
            || normType.includes('FILE')
            || normType.includes('ATTACHMENT')
        ) {
            return 'media_files';
        }
    }

    // 2. Title-based fallback when tokenType is generic/absent
    if (normTitle) {
        if (/(?:^|\b)(?:skills?|rules?|user_rules|workflows?|agents\.md|claude\.md|gemini\.md|custom instructions?)(?:\b|$)/i.test(normTitle)) {
            return 'rules_skills';
        }
        if (/(?:^|\b)(?:plugins?|mcp|mcp_servers?|marketplace)(?:\b|$)/i.test(normTitle)) {
            return 'plugins_mcp';
        }
        if (/(?:^|\b)(?:subagents?|sub-agents?|swarm|delegated agents?)(?:\b|$)/i.test(normTitle)) {
            return 'subagents';
        }
        if (/(?:^|\b)(?:system prompts?|system instructions?|identity|preamble|user_information|checkpoints?|artifacts?|knowledge|ephemeral|environment)(?:\b|$)/i.test(normTitle)) {
            return 'system';
        }
        if (/(?:^|\b)(?:user messages?|user inputs?|user requests?|user prompts?|human)(?:\b|$)/i.test(normTitle)) {
            return 'user';
        }
        if (/(?:^|\b)(?:assistant|thinking|thoughts?|reasoning|planner responses?|model responses?)(?:\b|$)/i.test(normTitle)) {
            return 'assistant_thinking';
        }
        if (/(?:^|\b)(?:tools?|function calls?|command outputs?|terminal|shell|grep|search results?)(?:\b|$)/i.test(normTitle)) {
            return 'tools';
        }
        if (/(?:^|\b)(?:files?|media|images?|attachments?|screenshots?|pdfs?|open editors?|code context|diffs?)(?:\b|$)/i.test(normTitle)) {
            return 'media_files';
        }
    }

    return 'other';
}

// ─── Internal Parsing Structures ─────────────────────────────────────────────

interface ParsedGmRecord {
    index: number;
    stepIndices: number[];
    maxStepIndex: number;
    checkpointIndex: number;
    createdAt: string;
    model: string;
    modelDisplayName: string;
    promptTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    responseTokens: number;
    totalTokens: number;
    hasUsage: boolean;
    capacityTokens: number;
    promptSections: PromptSectionLike[];
    tokenBreakdownGroups: TokenBreakdownGroupLike[];
}

interface RawContextItem {
    title: string;
    category: ContextCategoryKey;
    tokens: number;
    stepIndex?: number;
}

interface StepAttributionResult {
    byCategory: Record<ContextCategoryKey, { tokens: number; itemCount: number }>;
    items: RawContextItem[];
    totalTokens: number;
}

function createEmptyCategoryCounters(): Record<ContextCategoryKey, { tokens: number; itemCount: number }> {
    return {
        system: { tokens: 0, itemCount: 0 },
        rules_skills: { tokens: 0, itemCount: 0 },
        plugins_mcp: { tokens: 0, itemCount: 0 },
        subagents: { tokens: 0, itemCount: 0 },
        user: { tokens: 0, itemCount: 0 },
        assistant_thinking: { tokens: 0, itemCount: 0 },
        tools: { tokens: 0, itemCount: 0 },
        media_files: { tokens: 0, itemCount: 0 },
        other: { tokens: 0, itemCount: 0 },
    };
}

function parseGmRecord(raw: unknown, index: number): ParsedGmRecord | null {
    const gm = asRecord(raw);
    if (!gm) { return null; }
    const cm = asRecord(gm.chatModel);
    const usage = asRecord(cm?.usage);
    const csm = asRecord(cm?.chatStartMetadata);
    const cwm = asRecord(csm?.contextWindowMetadata);
    const plannerConfig = asRecord(gm.plannerConfig);

    const stepIndices = Array.isArray(gm.stepIndices)
        ? gm.stepIndices.filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0)
        : [];
    const startStepIndex = parseNonNegInt(csm?.startStepIndex);
    const maxStepIndex = stepIndices.length > 0
        ? Math.max(...stepIndices)
        : (startStepIndex > 0 ? startStepIndex : -1);

    const inputTokens = parseNonNegInt(usage?.inputTokens);
    const cacheReadTokens = parseNonNegInt(usage?.cacheReadTokens);
    const cacheCreationTokens = parseNonNegInt(usage?.cacheCreationTokens);
    const outputTokens = parseNonNegInt(usage?.outputTokens);
    const thinkingTokens = parseNonNegInt(usage?.thinkingOutputTokens);
    const responseTokens = parseNonNegInt(usage?.responseOutputTokens);

    // Antigravity additive semantics: cache tokens are strictly additive with inputTokens;
    // thinkingOutputTokens is a subset of outputTokens (never double-counted).
    const promptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
    const effectiveOutput = outputTokens > 0
        ? outputTokens
        : (thinkingTokens + responseTokens);
    const totalTokens = promptTokens + effectiveOutput;
    const hasUsage = totalTokens > 0;

    const capacityTokens = parseNonNegInt(plannerConfig?.truncationThresholdTokens)
        || parseNonNegInt(cwm?.maxContextTokens);

    const promptSections: PromptSectionLike[] = Array.isArray(cm?.promptSections)
        ? (cm.promptSections.filter(s => asRecord(s) !== null) as PromptSectionLike[])
        : [];

    const tb = asRecord(cwm?.tokenBreakdown);
    const tokenBreakdownGroups: TokenBreakdownGroupLike[] = Array.isArray(tb?.groups)
        ? (tb.groups.filter(g => asRecord(g) !== null) as TokenBreakdownGroupLike[])
        : [];

    const model = (typeof cm?.model === 'string' && cm.model.trim())
        || (typeof usage?.model === 'string' && usage.model.trim())
        || (typeof cm?.responseModel === 'string' && cm.responseModel.trim())
        || '';
    const modelDisplayName = typeof cm?.modelDisplayName === 'string' ? cm.modelDisplayName.trim() : '';

    return {
        index,
        stepIndices,
        maxStepIndex,
        checkpointIndex: parseNonNegInt(csm?.checkpointIndex),
        createdAt: typeof csm?.createdAt === 'string' ? csm.createdAt : '',
        model,
        modelDisplayName,
        promptTokens,
        outputTokens: effectiveOutput,
        thinkingTokens,
        responseTokens,
        totalTokens,
        hasUsage,
        capacityTokens,
        promptSections,
        tokenBreakdownGroups,
    };
}

interface StepUsagePoint {
    stepIndex: number;
    stepType: string;
    isCheckpoint: boolean;
    intentOnly: boolean;
    promptTokens: number;
    outputTokens: number;
    totalTokens: number;
    model: string;
    timestamp?: string;
}

function extractStepUsagePoint(step: Record<string, unknown>, fallbackIndex: number): StepUsagePoint | null {
    const stepIndex = typeof step.stepIndex === 'number' && Number.isFinite(step.stepIndex) && step.stepIndex >= 0
        ? Math.round(step.stepIndex)
        : fallbackIndex;
    const stepType = typeof step.type === 'string' ? step.type : '';
    const isCheckpoint = stepType === StepType.CHECKPOINT || stepType.toUpperCase().includes('CHECKPOINT');
    const cp = asRecord(step.checkpoint);
    const intentOnly = cp?.intentOnly === true;

    const meta = asRecord(step.metadata);
    const mu = asRecord(meta?.modelUsage);
    if (!mu) { return null; }

    const inputTokens = parseNonNegInt(mu.inputTokens);
    const cacheReadTokens = parseNonNegInt(mu.cacheReadTokens);
    const cacheCreationTokens = parseNonNegInt(mu.cacheCreationTokens);
    const outputTokens = parseNonNegInt(mu.outputTokens);
    const promptTokens = inputTokens + cacheReadTokens + cacheCreationTokens;
    const totalTokens = promptTokens + outputTokens;
    if (totalTokens <= 0) { return null; }

    const model = (typeof mu.model === 'string' && mu.model.trim())
        || (typeof meta?.generatorModel === 'string' && meta.generatorModel.trim())
        || '';
    const timestamp = (typeof meta?.createdAt === 'string' && meta.createdAt)
        || (typeof meta?.startedAt === 'string' && meta.startedAt)
        || undefined;

    return {
        stepIndex,
        stepType,
        isCheckpoint,
        intentOnly,
        promptTokens,
        outputTokens,
        totalTokens,
        model,
        timestamp,
    };
}

function classifyToolStep(step: Record<string, unknown>): { category: ContextCategoryKey; title: string } {
    const stepType = typeof step.type === 'string' ? step.type : '';
    const meta = asRecord(step.metadata);
    const toolCall = asRecord(meta?.toolCall) || asRecord(step.toolCall);
    const toolName = (typeof toolCall?.name === 'string' && toolCall.name.trim())
        || (typeof meta?.toolName === 'string' && meta.toolName.trim())
        || '';
    const toolSource = typeof meta?.toolSource === 'string' ? meta.toolSource : '';
    const upperType = stepType.toUpperCase();
    const lowerTool = toolName.toLowerCase();
    const lowerSource = toolSource.toLowerCase();

    if (
        upperType.includes('SUBAGENT')
        || upperType.includes('SWARM')
        || lowerTool.includes('subagent')
        || lowerTool.startsWith('swarm')
    ) {
        return {
            category: 'subagents',
            title: toolName ? `Subagent: ${toolName}` : 'Subagent invocation',
        };
    }

    if (
        lowerSource.includes('mcp')
        || lowerTool.startsWith('mcp__')
        || lowerTool.startsWith('mcp_')
        || upperType.includes('MCP')
    ) {
        return {
            category: 'plugins_mcp',
            title: toolName ? `MCP: ${toolName}` : 'MCP tool output',
        };
    }

    if (
        upperType.includes('VIEW_FILE')
        || upperType.includes('READ_FILE')
        || upperType.includes('IMAGE')
        || upperType.includes('MEDIA')
        || upperType.includes('SCREENSHOT')
        || /^(?:read_file|view_file|view_file_outline|view_code_item|generate_image|capture_screenshot)$/i.test(lowerTool)
    ) {
        const viewFile = asRecord(step.viewFile) || asRecord(step.readFile);
        const targetPath = (typeof viewFile?.absolutePath === 'string' && viewFile.absolutePath)
            || (typeof viewFile?.path === 'string' && viewFile.path)
            || '';
        const baseName = targetPath ? targetPath.split(/[\\/]/).filter(Boolean).pop() || targetPath : '';
        return {
            category: 'media_files',
            title: baseName ? `File: ${baseName}` : (toolName || 'File / Media read'),
        };
    }

    const cleanStepLabel = stepType
        ? stepType.replace(/^CORTEX_STEP_TYPE_/i, '').toLowerCase().replace(/_/g, ' ')
        : 'tool result';
    return {
        category: 'tools',
        title: toolName ? `Tool: ${toolName}` : `Tool: ${cleanStepLabel}`,
    };
}

function attributeSteps(
    steps: ReadonlyArray<Record<string, unknown>>,
    minStepIndexExclusive = -1,
    maxStepIndexInclusive = Number.POSITIVE_INFINITY,
): StepAttributionResult {
    const byCategory = createEmptyCategoryCounters();
    const items: RawContextItem[] = [];
    let totalTokens = 0;

    const add = (category: ContextCategoryKey, tokens: number, title: string, stepIndex: number): void => {
        const rounded = Math.round(tokens);
        if (rounded <= 0) { return; }
        byCategory[category].tokens += rounded;
        byCategory[category].itemCount += 1;
        totalTokens += rounded;
        items.push({ title: sanitizeTitle(title), category, tokens: rounded, stepIndex });
    };

    for (let i = 0; i < steps.length; i++) {
        const step = asRecord(steps[i]);
        if (!step) { continue; }
        const stepIndex = typeof step.stepIndex === 'number' && Number.isFinite(step.stepIndex) && step.stepIndex >= 0
            ? Math.round(step.stepIndex)
            : i;
        if (stepIndex <= minStepIndexExclusive || stepIndex > maxStepIndexInclusive) { continue; }

        const stepType = typeof step.type === 'string' ? step.type : '';
        const meta = asRecord(step.metadata);

        if (stepType === StepType.USER_INPUT) {
            const ui = asRecord(step.userInput);
            const userText = (typeof ui?.userResponse === 'string' && ui.userResponse)
                || (typeof ui?.text === 'string' && ui.text)
                || '';
            const tokens = userText
                ? estimateTextTokens(userText)
                : (ui ? USER_INPUT_OVERHEAD : 0);
            if (tokens > 0) {
                const snippet = userText ? `User: ${userText}` : `User input (step #${stepIndex})`;
                add('user', tokens, snippet, stepIndex);
            }
            const mediaItems = (Array.isArray(ui?.media) ? ui.media : Array.isArray(ui?.images) ? ui.images : []) as unknown[];
            if (mediaItems.length > 0) {
                add('media_files', mediaItems.length * 1000, `User attachments (${mediaItems.length})`, stepIndex);
            }
            continue;
        }

        if (stepType === StepType.PLANNER_RESPONSE) {
            const pr = asRecord(step.plannerResponse);
            const responseText = typeof pr?.response === 'string' ? pr.response : '';
            const thinkingText = typeof pr?.thinking === 'string' ? pr.thinking : '';
            const assistantTokens = (responseText || thinkingText)
                ? estimateTextTokens(responseText + thinkingText)
                : (pr ? PLANNER_RESPONSE_ESTIMATE : 0);
            if (assistantTokens > 0) {
                const label = responseText
                    ? `Assistant: ${responseText}`
                    : (thinkingText ? `Thinking: ${thinkingText}` : `Assistant response (step #${stepIndex})`);
                add('assistant_thinking', assistantTokens, label, stepIndex);
            }

            const toolCalls = Array.isArray(pr?.toolCalls) ? pr.toolCalls : [];
            let toolArgsTokens = 0;
            const callNames: string[] = [];
            for (const rawTc of toolCalls) {
                const tc = asRecord(rawTc);
                if (!tc) { continue; }
                const name = typeof tc.name === 'string' ? tc.name : '';
                if (name) { callNames.push(name); }
                const args = typeof tc.argumentsJson === 'string' ? tc.argumentsJson : '';
                if (args) { toolArgsTokens += estimateTextTokens(args); }
            }
            if (toolArgsTokens > 0) {
                add('tools', toolArgsTokens, `Tool calls: ${callNames.slice(0, 3).join(', ') || `step #${stepIndex}`}`, stepIndex);
            }
            continue;
        }

        if (stepType === StepType.CHECKPOINT || stepType.toUpperCase().includes('CHECKPOINT')) {
            const cp = asRecord(step.checkpoint);
            const summaryText = [
                typeof cp?.userIntent === 'string' ? cp.userIntent : '',
                typeof cp?.sessionSummary === 'string' ? cp.sessionSummary : '',
            ].filter(Boolean).join('\n');
            const cpTokens = summaryText
                ? estimateTextTokens(summaryText)
                : parseNonNegInt(cp?.tokens);
            if (cpTokens > 0) {
                add('system', cpTokens, `Compaction checkpoint (step #${stepIndex})`, stepIndex);
            }
            continue;
        }

        const toolOutTokens = parseNonNegInt(meta?.toolCallOutputTokens);
        if (toolOutTokens > 0) {
            const classified = classifyToolStep(step);
            add(classified.category, toolOutTokens, classified.title, stepIndex);
        }
    }

    return { byCategory, items, totalTokens };
}

function detectCompactionCheckpoints(
    gmRecords: readonly ParsedGmRecord[],
    stepPoints: readonly StepUsagePoint[],
    steps: ReadonlyArray<Record<string, unknown>>,
): {
    checkpoints: CompactionCheckpoint[];
    hasUnmeasuredPostCompaction: boolean;
    lastCompactionStepIndex: number;
    newestFullCheckpoint: { stepIndex: number; timestamp?: string } | null;
} {
    const checkpoints: CompactionCheckpoint[] = [];
    const seenSteps = new Set<number>();

    const checkpointStepIndices: Array<{ stepIndex: number; intentOnly: boolean; timestamp?: string }> = [];
    for (let i = 0; i < steps.length; i++) {
        const step = asRecord(steps[i]);
        if (!step) { continue; }
        const stepType = typeof step.type === 'string' ? step.type : '';
        if (stepType !== StepType.CHECKPOINT && !stepType.toUpperCase().includes('CHECKPOINT')) { continue; }
        const stepIndex = typeof step.stepIndex === 'number' && Number.isFinite(step.stepIndex) && step.stepIndex >= 0
            ? Math.round(step.stepIndex)
            : i;
        const cp = asRecord(step.checkpoint);
        const meta = asRecord(step.metadata);
        checkpointStepIndices.push({
            stepIndex,
            intentOnly: cp?.intentOnly === true,
            timestamp: (typeof meta?.createdAt === 'string' && meta.createdAt) || undefined,
        });
    }

    // 1. Checkpoints observed across consecutive step modelUsage snapshots
    let prevStepPrompt = -1;
    for (const point of stepPoints) {
        if (prevStepPrompt > 0 && point.promptTokens < prevStepPrompt) {
            const drop = prevStepPrompt - point.promptTokens;
            if (drop >= COMPRESSION_MIN_DROP && (point.isCheckpoint || checkpointStepIndices.some(c => !c.intentOnly && c.stepIndex <= point.stepIndex))) {
                if (!seenSteps.has(point.stepIndex)) {
                    seenSteps.add(point.stepIndex);
                    checkpoints.push({
                        stepIndex: point.stepIndex,
                        beforeTokens: prevStepPrompt,
                        afterTokens: point.promptTokens,
                        savedTokens: drop,
                        ...(point.timestamp ? { timestamp: point.timestamp } : {}),
                    });
                }
            }
        }
        prevStepPrompt = point.promptTokens;
    }

    // 2. Checkpoints observed across consecutive generatorMetadata snapshots
    let prevGm: ParsedGmRecord | null = null;
    for (const gm of gmRecords) {
        if (!gm.hasUsage) { continue; }
        if (prevGm && gm.promptTokens < prevGm.promptTokens) {
            const drop = prevGm.promptTokens - gm.promptTokens;
            const checkpointIncremented = gm.checkpointIndex > prevGm.checkpointIndex;
            const interveningCheckpoint = checkpointStepIndices.find(
                c => !c.intentOnly
                    && (prevGm!.maxStepIndex < 0 || c.stepIndex >= prevGm!.maxStepIndex)
                    && (gm.maxStepIndex < 0 || c.stepIndex <= gm.maxStepIndex),
            );
            if (drop >= COMPRESSION_MIN_DROP && (checkpointIncremented || interveningCheckpoint !== undefined || gm.promptTokens <= prevGm.promptTokens * 0.75)) {
                const cpStep = interveningCheckpoint?.stepIndex
                    ?? (gm.stepIndices.length > 0 ? Math.min(...gm.stepIndices) : Math.max(0, gm.maxStepIndex));
                if (!seenSteps.has(cpStep)) {
                    seenSteps.add(cpStep);
                    checkpoints.push({
                        stepIndex: cpStep,
                        beforeTokens: prevGm.promptTokens,
                        afterTokens: gm.promptTokens,
                        savedTokens: drop,
                        ...(interveningCheckpoint?.timestamp || gm.createdAt
                            ? { timestamp: interveningCheckpoint?.timestamp || gm.createdAt }
                            : {}),
                    });
                }
            }
        }
        prevGm = gm;
    }

    checkpoints.sort((a, b) => a.stepIndex - b.stepIndex);

    // Determine whether a full compaction checkpoint happened AFTER the latest measured generation
    let latestMeasuredStepIndex = -1;
    for (const gm of gmRecords) {
        if (gm.hasUsage && gm.maxStepIndex > latestMeasuredStepIndex) {
            latestMeasuredStepIndex = gm.maxStepIndex;
        }
    }
    for (const pt of stepPoints) {
        if (!pt.isCheckpoint && pt.stepIndex > latestMeasuredStepIndex) {
            latestMeasuredStepIndex = pt.stepIndex;
        }
    }

    const fullCheckpoints = checkpointStepIndices.filter(c => !c.intentOnly);
    const newestFullCheckpoint = fullCheckpoints.length > 0
        ? fullCheckpoints[fullCheckpoints.length - 1]
        : null;

    const hasUnmeasuredPostCompaction = newestFullCheckpoint !== null
        && latestMeasuredStepIndex >= 0
        && newestFullCheckpoint.stepIndex > latestMeasuredStepIndex;

    const lastCompactionStepIndex = Math.max(
        checkpoints.length > 0 ? checkpoints[checkpoints.length - 1].stepIndex : -1,
        newestFullCheckpoint ? newestFullCheckpoint.stepIndex : -1,
    );

    return {
        checkpoints,
        hasUnmeasuredPostCompaction,
        lastCompactionStepIndex,
        newestFullCheckpoint: newestFullCheckpoint
            ? { stepIndex: newestFullCheckpoint.stepIndex, ...(newestFullCheckpoint.timestamp ? { timestamp: newestFullCheckpoint.timestamp } : {}) }
            : null,
    };
}

function extractFallbackModelFromSteps(steps: ReadonlyArray<Record<string, unknown>>): string {
    let model = '';
    for (const raw of steps) {
        const step = asRecord(raw);
        if (!step) { continue; }
        const stepType = typeof step.type === 'string' ? step.type : '';
        if (stepType === StepType.CHECKPOINT) { continue; }
        const meta = asRecord(step.metadata);
        const rm = asRecord(meta?.requestedModel);
        if (typeof rm?.model === 'string' && rm.model.trim()) {
            model = rm.model.trim();
            continue;
        }
        if (typeof meta?.generatorModel === 'string' && meta.generatorModel.trim()) {
            model = meta.generatorModel.trim();
            continue;
        }
        const mu = asRecord(meta?.modelUsage);
        if (typeof mu?.model === 'string' && mu.model.trim()) {
            model = mu.model.trim();
        }
    }
    return model;
}

// ─── Main Breakdown Parser ───────────────────────────────────────────────────

/**
 * Parse `GetCascadeTrajectoryGeneratorMetadata` and/or trajectory steps into a
 * normalized `ContextBreakdownSnapshot`.
 *
 * - Maps Antigravity `TOKEN_TYPE_*` promptSections cleanly to 9 categories.
 * - Reconciles against measured `chatModel.usage` (additive cache semantics).
 * - Falls back gracefully to `tokenBreakdown` or step-level attribution without
 *   fabricating fake zeros when `promptSections` are absent.
 * - Distinguishes rewind (`estimated_rewind`) from compaction checkpoints
 *   (`estimated_post_compaction` / `compactionCheckpoints[]`).
 */
export function parseContextBreakdown(input: ContextBreakdownInput): ContextBreakdownSnapshot {
    const rawGm = Array.isArray(input.generatorMetadata) ? input.generatorMetadata : [];
    const rawSteps = Array.isArray(input.steps) ? input.steps : [];

    const gmRecords: ParsedGmRecord[] = [];
    for (let i = 0; i < rawGm.length; i++) {
        const parsed = parseGmRecord(rawGm[i], i);
        if (parsed) { gmRecords.push(parsed); }
    }

    const stepPoints: StepUsagePoint[] = [];
    for (let i = 0; i < rawSteps.length; i++) {
        const step = asRecord(rawSteps[i]);
        if (!step) { continue; }
        const pt = extractStepUsagePoint(step, i);
        if (pt) { stepPoints.push(pt); }
    }

    // Determine observed step count
    let maxGmStep = -1;
    for (const gm of gmRecords) {
        if (gm.maxStepIndex > maxGmStep) { maxGmStep = gm.maxStepIndex; }
    }
    const stepCount = typeof input.currentStepCount === 'number' && Number.isFinite(input.currentStepCount) && input.currentStepCount >= 0
        ? Math.round(input.currentStepCount)
        : (rawSteps.length > 0 ? rawSteps.length : (maxGmStep >= 0 ? maxGmStep + 1 : 0));

    // Rewind detection: shrinking step count MUST be classified as estimated_rewind, NOT compaction!
    const isRewind = typeof input.previousMaxStepCount === 'number'
        && Number.isFinite(input.previousMaxStepCount)
        && input.previousMaxStepCount > 0
        && stepCount < input.previousMaxStepCount;

    const latestMeasuredGm = [...gmRecords].reverse().find(g => g.hasUsage) || null;
    const latestSectionsGm = [...gmRecords].reverse().find(g => g.promptSections.length > 0) || null;
    const latestBreakdownGm = [...gmRecords].reverse().find(g => g.tokenBreakdownGroups.length > 0) || null;
    const latestStepUsage = stepPoints.length > 0 ? stepPoints[stepPoints.length - 1] : null;

    const hasMeasuredUsage = latestMeasuredGm !== null || latestStepUsage !== null;

    // Compaction detection (suppressed during rewind so rewind is never misclassified as compaction)
    const compactionInfo = isRewind
        ? {
            checkpoints: [] as CompactionCheckpoint[],
            hasUnmeasuredPostCompaction: false,
            lastCompactionStepIndex: -1,
            newestFullCheckpoint: null as { stepIndex: number; timestamp?: string } | null,
        }
        : detectCompactionCheckpoints(gmRecords, stepPoints, rawSteps);

    // Measurement state classification
    let measurementState: ContextMeasurementState;
    if (isRewind) {
        measurementState = 'estimated_rewind';
    } else if (!hasMeasuredUsage) {
        measurementState = 'awaiting_generation';
    } else if (compactionInfo.hasUnmeasuredPostCompaction) {
        measurementState = 'estimated_post_compaction';
    } else {
        measurementState = 'measured';
    }

    // Resolve model & dual-cap limits
    const resolvedModel = (input.model && input.model.trim())
        || latestMeasuredGm?.model
        || latestSectionsGm?.model
        || latestStepUsage?.model
        || extractFallbackModelFromSteps(rawSteps)
        || '';

    const modelDisplayName = (input.modelDisplayName && input.modelDisplayName.trim())
        || latestMeasuredGm?.modelDisplayName
        || latestSectionsGm?.modelDisplayName
        || (resolvedModel ? (normalizeModelDisplayName(resolvedModel) || getModelDisplayName(resolvedModel)) : 'Unknown Model');

    const gmCapacity = latestMeasuredGm?.capacityTokens
        || [...gmRecords].reverse().find(g => g.capacityTokens > 0)?.capacityTokens
        || 0;
    const guessedSpec = resolvedModel ? guessContextLimitSpec(resolvedModel) : { cpLimit: 0, maxTokens: 0 };

    const explicitEffective = parseNonNegInt(input.effectiveBudgetTokens);
    const explicitNative = parseNonNegInt(input.nativeLimitTokens);

    const effectiveBudgetTokens = explicitEffective
        || gmCapacity
        || guessedSpec.cpLimit
        || explicitNative
        || guessedSpec.maxTokens
        || 0;

    let nativeLimitTokens = explicitNative
        || guessedSpec.maxTokens
        || effectiveBudgetTokens
        || 0;
    if (nativeLimitTokens > 0 && effectiveBudgetTokens > nativeLimitTokens) {
        nativeLimitTokens = effectiveBudgetTokens;
    }
    const hasDualCap = effectiveBudgetTokens > 0
        && nativeLimitTokens > 0
        && effectiveBudgetTokens < nativeLimitTokens;

    // ── Category Attribution ─────────────────────────────────────────────────
    const counters = createEmptyCategoryCounters();
    const candidateItems: RawContextItem[] = [];
    let attributionSource: AttributionSource = 'none';
    const hasPromptSections = latestSectionsGm !== null && latestSectionsGm.promptSections.length > 0;

    const latestMeasuredStepIndex = Math.max(
        latestMeasuredGm?.maxStepIndex ?? -1,
        latestStepUsage?.stepIndex ?? -1,
    );

    const addBucket = (cat: ContextCategoryKey, tokens: number, itemsToAdd = 1): void => {
        const rounded = Math.round(tokens);
        if (rounded <= 0) { return; }
        counters[cat].tokens += rounded;
        counters[cat].itemCount += Math.max(1, itemsToAdd);
    };

    const activeStepsAttribution = latestMeasuredStepIndex >= 0
        ? attributeSteps(rawSteps, compactionInfo.lastCompactionStepIndex, latestMeasuredStepIndex)
        : attributeSteps(rawSteps, compactionInfo.lastCompactionStepIndex);
    const postMeasuredStepsAttribution = latestMeasuredStepIndex >= 0
        ? attributeSteps(rawSteps, Math.max(latestMeasuredStepIndex, compactionInfo.lastCompactionStepIndex))
        : createEmptyStepAttribution();

    const compactionCheckpoints = [...compactionInfo.checkpoints];

    if (compactionInfo.hasUnmeasuredPostCompaction && compactionInfo.newestFullCheckpoint) {
        // Compaction checkpoint occurred AFTER the latest measured model generation:
        // retain fixed system-side promptSections (if available) plus the checkpoint
        // summary and post-checkpoint steps rather than showing stale pre-compaction usage.
        const cpIdx = compactionInfo.newestFullCheckpoint.stepIndex;
        const postCompactionSteps = attributeSteps(rawSteps, cpIdx - 1);
        const fixedCategories = new Set<ContextCategoryKey>(['system', 'rules_skills', 'plugins_mcp', 'subagents', 'tools']);

        if (hasPromptSections && latestSectionsGm) {
            attributionSource = 'prompt_sections';
            for (const sec of latestSectionsGm.promptSections) {
                const category = mapTokenTypeToCategory(sec.tokenType, sec.title);
                if (!fixedCategories.has(category)) { continue; }
                const explicitTokens = parseNonNegInt(sec.tokens) || parseNonNegInt(sec.numTokens);
                const contentLen = parseNonNegInt(sec.contentLen);
                const estTokens = explicitTokens > 0
                    ? explicitTokens
                    : (contentLen > 0 ? Math.ceil(contentLen / 4) : 0);
                if (estTokens <= 0) { continue; }
                const title = sanitizeTitle(
                    (typeof sec.title === 'string' && sec.title.trim())
                    || (typeof sec.tokenType === 'string' && sec.tokenType.trim())
                    || CONTEXT_CATEGORY_META[category].labelEn,
                );
                addBucket(category, estTokens, 1);
                candidateItems.push({ title, category, tokens: estTokens });
            }
        } else {
            attributionSource = 'steps';
        }

        mergeStepAttribution(counters, candidateItems, postCompactionSteps);

        let estAfter = 0;
        for (const cat of CONTEXT_CATEGORY_ORDER) { estAfter += counters[cat].tokens; }
        const preTokens = latestMeasuredGm?.promptTokens ?? latestStepUsage?.promptTokens ?? 0;
        if (
            preTokens > estAfter
            && (preTokens - estAfter) >= COMPRESSION_MIN_DROP
            && !compactionCheckpoints.some(c => c.stepIndex === cpIdx)
        ) {
            compactionCheckpoints.push({
                stepIndex: cpIdx,
                beforeTokens: preTokens,
                afterTokens: estAfter,
                savedTokens: preTokens - estAfter,
                ...(compactionInfo.newestFullCheckpoint.timestamp
                    ? { timestamp: compactionInfo.newestFullCheckpoint.timestamp }
                    : {}),
            });
            compactionCheckpoints.sort((a, b) => a.stepIndex - b.stepIndex);
        }
    } else if (hasPromptSections && latestSectionsGm) {
        attributionSource = 'prompt_sections';
        const sectionItems: Array<{ title: string; category: ContextCategoryKey; rawTokens: number }> = [];
        let rawSectionTotal = 0;

        for (const sec of latestSectionsGm.promptSections) {
            const category = mapTokenTypeToCategory(sec.tokenType, sec.title);
            const explicitTokens = parseNonNegInt(sec.tokens) || parseNonNegInt(sec.numTokens);
            const contentLen = parseNonNegInt(sec.contentLen);
            const estTokens = explicitTokens > 0
                ? explicitTokens
                : (contentLen > 0 ? Math.ceil(contentLen / 4) : 0);
            if (estTokens <= 0) { continue; }
            const title = sanitizeTitle(
                (typeof sec.title === 'string' && sec.title.trim())
                || (typeof sec.tokenType === 'string' && sec.tokenType.trim())
                || CONTEXT_CATEGORY_META[category].labelEn,
            );
            sectionItems.push({ title, category, rawTokens: estTokens });
            rawSectionTotal += estTokens;
        }

        const measuredPromptTokens = latestMeasuredGm?.promptTokens ?? latestStepUsage?.promptTokens ?? 0;
        const measuredOutputTokens = latestMeasuredGm?.outputTokens ?? latestStepUsage?.outputTokens ?? 0;

        // If section heuristic exceeds measured prompt tokens, scale down proportionally so
        // attributed sections never exceed the true measured prompt size.
        const sectionScale = (measuredPromptTokens > 0 && rawSectionTotal > measuredPromptTokens)
            ? (measuredPromptTokens / rawSectionTotal)
            : 1;

        let attributedPromptTokens = 0;
        for (const sec of sectionItems) {
            const scaled = Math.max(1, Math.round(sec.rawTokens * sectionScale));
            addBucket(sec.category, scaled, 1);
            candidateItems.push({ title: sec.title, category: sec.category, tokens: scaled });
            attributedPromptTokens += scaled;
        }

        // Attribute remaining measured prompt tokens (chat history / tool outputs not listed in promptSections)
        let remainingPrompt = Math.max(0, measuredPromptTokens - attributedPromptTokens);
        if (remainingPrompt > 0) {
            // Try tokenBreakdown groups for non-section categories first
            const coveredBySections = new Set(sectionItems.map(s => s.category));
            const uncoveredGroups: Array<{ category: ContextCategoryKey; tokens: number; title: string }> = [];
            let uncoveredGroupSum = 0;
            if (latestBreakdownGm) {
                for (const g of latestBreakdownGm.tokenBreakdownGroups) {
                    const cat = mapTokenTypeToCategory(g.type, g.name);
                    const toks = parseNonNegInt(g.tokens) || parseNonNegInt(g.numTokens);
                    if (toks <= 0 || coveredBySections.has(cat)) { continue; }
                    uncoveredGroups.push({
                        category: cat,
                        tokens: toks,
                        title: sanitizeTitle(g.name || g.type || CONTEXT_CATEGORY_META[cat].labelEn),
                    });
                    uncoveredGroupSum += toks;
                }
            }

            if (uncoveredGroupSum > 0) {
                const scale = remainingPrompt / uncoveredGroupSum;
                for (const g of uncoveredGroups) {
                    const scaled = Math.round(g.tokens * scale);
                    if (scaled <= 0) { continue; }
                    addBucket(g.category, scaled, 1);
                    candidateItems.push({ title: g.title, category: g.category, tokens: scaled });
                    remainingPrompt = Math.max(0, remainingPrompt - scaled);
                }
            } else if (activeStepsAttribution.totalTokens > 0) {
                const scale = remainingPrompt / activeStepsAttribution.totalTokens;
                for (const cat of CONTEXT_CATEGORY_ORDER) {
                    const entry = activeStepsAttribution.byCategory[cat];
                    if (entry.tokens <= 0) { continue; }
                    const scaled = Math.round(entry.tokens * scale);
                    if (scaled <= 0) { continue; }
                    addBucket(cat, scaled, entry.itemCount);
                    remainingPrompt = Math.max(0, remainingPrompt - scaled);
                }
                for (const item of activeStepsAttribution.items) {
                    const scaled = Math.round(item.tokens * scale);
                    if (scaled > 0) {
                        candidateItems.push({ ...item, tokens: scaled });
                    }
                }
            }

            if (remainingPrompt > 0) {
                addBucket('other', remainingPrompt, 1);
                candidateItems.push({
                    title: 'Conversation & unattributed prompt context',
                    category: 'other',
                    tokens: remainingPrompt,
                });
            }
        }

        if (measuredOutputTokens > 0) {
            addBucket('assistant_thinking', measuredOutputTokens, 1);
            candidateItems.push({
                title: latestMeasuredGm && latestMeasuredGm.thinkingTokens > 0
                    ? 'Latest assistant response & thinking'
                    : 'Latest assistant response',
                category: 'assistant_thinking',
                tokens: measuredOutputTokens,
                ...(latestMeasuredGm && latestMeasuredGm.maxStepIndex >= 0
                    ? { stepIndex: latestMeasuredGm.maxStepIndex }
                    : {}),
            });
        }

        // Include post-measured step delta if steps continued after last generation
        if (postMeasuredStepsAttribution.totalTokens > 0) {
            mergeStepAttribution(counters, candidateItems, postMeasuredStepsAttribution);
        }
    } else if (latestBreakdownGm && latestBreakdownGm.tokenBreakdownGroups.length > 0) {
        attributionSource = 'token_breakdown';
        const measuredPromptTokens = latestMeasuredGm?.promptTokens ?? latestStepUsage?.promptTokens ?? 0;
        const measuredOutputTokens = latestMeasuredGm?.outputTokens ?? latestStepUsage?.outputTokens ?? 0;

        let rawGroupSum = 0;
        const parsedGroups: Array<{ category: ContextCategoryKey; tokens: number; title: string; children: Array<{ title: string; tokens: number }> }> = [];
        for (const g of latestBreakdownGm.tokenBreakdownGroups) {
            const cat = mapTokenTypeToCategory(g.type, g.name);
            const toks = parseNonNegInt(g.tokens) || parseNonNegInt(g.numTokens);
            if (toks <= 0) { continue; }
            const children = Array.isArray(g.children)
                ? g.children
                    .map(c => ({
                        title: sanitizeTitle(c.name || g.name || CONTEXT_CATEGORY_META[cat].labelEn),
                        tokens: parseNonNegInt(c.tokens) || parseNonNegInt(c.numTokens),
                    }))
                    .filter(c => c.tokens > 0)
                : [];
            parsedGroups.push({
                category: cat,
                tokens: toks,
                title: sanitizeTitle(g.name || g.type || CONTEXT_CATEGORY_META[cat].labelEn),
                children,
            });
            rawGroupSum += toks;
        }

        const scale = (measuredPromptTokens > 0 && rawGroupSum > measuredPromptTokens)
            ? (measuredPromptTokens / rawGroupSum)
            : 1;
        let attributed = 0;
        for (const g of parsedGroups) {
            const scaled = Math.max(1, Math.round(g.tokens * scale));
            addBucket(g.category, scaled, Math.max(1, g.children.length));
            attributed += scaled;
            if (g.children.length > 0) {
                for (const c of g.children) {
                    const cScaled = Math.round(c.tokens * scale);
                    if (cScaled > 0) {
                        candidateItems.push({ title: c.title, category: g.category, tokens: cScaled });
                    }
                }
            } else {
                candidateItems.push({ title: g.title, category: g.category, tokens: scaled });
            }
        }

        const remainder = Math.max(0, measuredPromptTokens - attributed);
        if (remainder > 0) {
            addBucket('other', remainder, 1);
            candidateItems.push({ title: 'Other prompt context', category: 'other', tokens: remainder });
        }
        if (measuredOutputTokens > 0) {
            addBucket('assistant_thinking', measuredOutputTokens, 1);
            candidateItems.push({
                title: latestMeasuredGm && latestMeasuredGm.thinkingTokens > 0
                    ? 'Latest assistant response & thinking'
                    : 'Latest assistant response',
                category: 'assistant_thinking',
                tokens: measuredOutputTokens,
                ...(latestMeasuredGm && latestMeasuredGm.maxStepIndex >= 0
                    ? { stepIndex: latestMeasuredGm.maxStepIndex }
                    : {}),
            });
        }
        if (postMeasuredStepsAttribution.totalTokens > 0) {
            mergeStepAttribution(counters, candidateItems, postMeasuredStepsAttribution);
        }
    } else if (activeStepsAttribution.totalTokens > 0 || hasMeasuredUsage) {
        // Graceful fallback when promptSections/tokenBreakdown are absent (older LS or pre-generation)
        const measuredPromptTokens = latestMeasuredGm?.promptTokens ?? latestStepUsage?.promptTokens ?? 0;
        const measuredOutputTokens = latestMeasuredGm?.outputTokens ?? latestStepUsage?.outputTokens ?? 0;

        if (activeStepsAttribution.totalTokens > 0) {
            attributionSource = 'steps';
            if (hasMeasuredUsage && measuredPromptTokens > 0) {
                const measuredTotal = measuredPromptTokens + measuredOutputTokens;
                if (activeStepsAttribution.totalTokens > measuredTotal) {
                    const scale = measuredTotal / activeStepsAttribution.totalTokens;
                    for (const cat of CONTEXT_CATEGORY_ORDER) {
                        const entry = activeStepsAttribution.byCategory[cat];
                        if (entry.tokens <= 0) { continue; }
                        addBucket(cat, Math.max(1, Math.round(entry.tokens * scale)), entry.itemCount);
                    }
                    for (const item of activeStepsAttribution.items) {
                        const scaled = Math.round(item.tokens * scale);
                        if (scaled > 0) {
                            candidateItems.push({ ...item, tokens: scaled });
                        }
                    }
                } else {
                    mergeStepAttribution(counters, candidateItems, activeStepsAttribution);
                    const unattributedOverhead = measuredTotal - activeStepsAttribution.totalTokens;
                    if (unattributedOverhead > 0) {
                        // Unattributed measured gap when promptSections is absent represents system/framework overhead
                        const gapCat: ContextCategoryKey = counters.system.tokens === 0 ? 'system' : 'other';
                        addBucket(gapCat, unattributedOverhead, 1);
                        candidateItems.push({
                            title: gapCat === 'system'
                                ? 'System prompt & context overhead'
                                : 'Unattributed context overhead',
                            category: gapCat,
                            tokens: unattributedOverhead,
                        });
                    }
                }
            } else {
                // Pre-generation / unmeasured steps: use honest step-level attribution directly
                mergeStepAttribution(counters, candidateItems, activeStepsAttribution);
            }
        } else if (hasMeasuredUsage) {
            attributionSource = 'steps';
            if (measuredPromptTokens > 0) {
                addBucket('other', measuredPromptTokens, 1);
                candidateItems.push({
                    title: 'Measured prompt context',
                    category: 'other',
                    tokens: measuredPromptTokens,
                });
            }
            if (measuredOutputTokens > 0) {
                addBucket('assistant_thinking', measuredOutputTokens, 1);
                candidateItems.push({
                    title: 'Latest assistant output',
                    category: 'assistant_thinking',
                    tokens: measuredOutputTokens,
                });
            }
        }
    }

    // Reconcile total usedTokens from populated buckets
    let usedTokens = 0;
    for (const cat of CONTEXT_CATEGORY_ORDER) {
        usedTokens += counters[cat].tokens;
    }

    const effectivePct = effectiveBudgetTokens > 0 ? round1((usedTokens / effectiveBudgetTokens) * 100) : 0;
    const nativePct = nativeLimitTokens > 0 ? round1((usedTokens / nativeLimitTokens) * 100) : 0;

    // Sort all positive candidate items ONCE before global top-5 truncation so every
    // category retains its own top 3 items even when dominated globally by another category.
    const sortedNormalizedItems: ContextBreakdownItem[] = candidateItems
        .filter(item => item.tokens > 0)
        .sort((a, b) => (b.tokens - a.tokens) || a.title.localeCompare(b.title))
        .map(item => ({
            title: sanitizeTitle(item.title),
            category: item.category,
            tokens: item.tokens,
            pct: usedTokens > 0 ? round1((item.tokens / usedTokens) * 100) : 0,
            budgetPct: effectiveBudgetTokens > 0 ? round1((item.tokens / effectiveBudgetTokens) * 100) : 0,
            ...(item.stepIndex !== undefined ? { stepIndex: item.stepIndex } : {}),
        }));

    const topItemsByCategory: Record<ContextCategoryKey, ContextBreakdownItem[]> = {
        system: [],
        rules_skills: [],
        plugins_mcp: [],
        subagents: [],
        user: [],
        assistant_thinking: [],
        tools: [],
        media_files: [],
        other: [],
    };
    for (const item of sortedNormalizedItems) {
        const list = topItemsByCategory[item.category];
        if (list.length < MAX_CATEGORY_TOP_ITEMS) {
            list.push(item);
        }
    }

    // Emit ONLY non-empty segments (never fabricate fake zero categories)
    const pctDenominator = effectiveBudgetTokens > 0 ? effectiveBudgetTokens : usedTokens;
    const segments: ContextCategorySegment[] = [];
    for (const key of CONTEXT_CATEGORY_ORDER) {
        const entry = counters[key];
        if (entry.tokens <= 0) { continue; }
        const meta = CONTEXT_CATEGORY_META[key];
        segments.push({
            key,
            labelEn: meta.labelEn,
            labelZh: meta.labelZh,
            colorToken: meta.colorToken,
            tokens: entry.tokens,
            pct: pctDenominator > 0 ? round1((entry.tokens / pctDenominator) * 100) : 0,
            sharePct: usedTokens > 0 ? round1((entry.tokens / usedTokens) * 100) : 0,
            itemCount: entry.itemCount,
            topItems: topItemsByCategory[key],
        });
    }

    // Top 5 largest items globally, safely truncated and sorted descending
    const largestItems: LargestContextItem[] = sortedNormalizedItems.slice(0, MAX_LARGEST_ITEMS);

    return {
        model: resolvedModel,
        modelDisplayName,
        usedTokens,
        effectiveBudgetTokens,
        nativeLimitTokens,
        hasDualCap,
        effectivePct,
        nativePct,
        measurementState,
        attributionSource,
        segments,
        compactionCheckpoints,
        largestItems,
        stepCount,
        hasPromptSections,
    };
}

function createEmptyStepAttribution(): StepAttributionResult {
    return {
        byCategory: createEmptyCategoryCounters(),
        items: [],
        totalTokens: 0,
    };
}

function mergeStepAttribution(
    counters: Record<ContextCategoryKey, { tokens: number; itemCount: number }>,
    candidateItems: RawContextItem[],
    source: StepAttributionResult,
): void {
    for (const cat of CONTEXT_CATEGORY_ORDER) {
        const entry = source.byCategory[cat];
        if (entry.tokens <= 0) { continue; }
        counters[cat].tokens += entry.tokens;
        counters[cat].itemCount += entry.itemCount;
    }
    for (const item of source.items) {
        if (item.tokens > 0) {
            candidateItems.push(item);
        }
    }
}

// ─── Dot Matrix Builder ──────────────────────────────────────────────────────

/**
 * Build a fixed-size dot matrix (default 100 cells for 20x5 or 10x10 layouts).
 *
 * Guarantees:
 * - Output length is ALWAYS strictly equal to `gridSize`.
 * - Every non-empty segment (`tokens > 0`) receives at least 1 dot (up to `gridSize`).
 * - Remaining capacity becomes free-space dots (`isFree: true`).
 * - Clamps cleanly when `totalTokens >= capacityTokens` (overflow -> 0 free dots).
 */
export function buildDotMatrix(
    segments: ReadonlyArray<Pick<ContextCategorySegment, 'key' | 'tokens' | 'labelEn' | 'labelZh' | 'colorToken'>>,
    totalTokens: number,
    capacityTokens: number,
    gridSize = 100,
): DotMatrixCell[] {
    const safeGridSize = Number.isFinite(gridSize) && gridSize >= 1 ? Math.round(gridSize) : 100;
    const active = segments.filter(seg => Number.isFinite(seg.tokens) && seg.tokens > 0);
    const safeTotal = Number.isFinite(totalTokens) && totalTokens > 0 ? totalTokens : 0;
    const safeCap = Number.isFinite(capacityTokens) && capacityTokens > 0 ? capacityTokens : 0;

    const makeFreeCells = (startIndex: number, count: number): DotMatrixCell[] => {
        const out: DotMatrixCell[] = [];
        for (let i = 0; i < count; i++) {
            out.push({
                index: startIndex + i,
                category: 'free',
                colorToken: FREE_CELL_META.colorToken,
                labelEn: FREE_CELL_META.labelEn,
                labelZh: FREE_CELL_META.labelZh,
                isFree: true,
            });
        }
        return out;
    };

    if (active.length === 0 || (safeTotal <= 0 && safeCap > 0)) {
        return makeFreeCells(0, safeGridSize);
    }

    const segmentSum = active.reduce((sum, seg) => sum + seg.tokens, 0);
    const effectiveUsed = safeTotal > 0 ? safeTotal : segmentSum;
    const effectiveCap = safeCap > 0 ? safeCap : effectiveUsed;

    // More active segments than grid cells: assign 1 dot each to heaviest segments
    if (active.length >= safeGridSize) {
        const top = [...active]
            .sort((a, b) => b.tokens - a.tokens)
            .slice(0, safeGridSize);
        return top.map((seg, index) => ({
            index,
            category: seg.key,
            colorToken: seg.colorToken,
            labelEn: seg.labelEn,
            labelZh: seg.labelZh,
            isFree: false,
        }));
    }

    const usageRatio = effectiveCap > 0 ? Math.min(1, effectiveUsed / effectiveCap) : 1;
    const targetOccupied = Math.min(
        safeGridSize,
        Math.max(active.length, Math.round(usageRatio * safeGridSize)),
    );

    // Every non-empty segment starts with 1 guaranteed dot
    const dots = active.map(() => 1);
    const remaining = targetOccupied - active.length;

    if (remaining > 0 && segmentSum > 0) {
        // Compute excess demand above the guaranteed 1-dot floor using Hamilton's method
        const ideals = active.map(seg => (seg.tokens / segmentSum) * targetOccupied);
        const excesses = ideals.map(ideal => Math.max(0, ideal - 1));
        const excessSum = excesses.reduce((sum, x) => sum + x, 0);

        if (excessSum > 0) {
            const rawAdds = excesses.map(ex => (ex / excessSum) * remaining);
            const floors = rawAdds.map(x => Math.floor(x));
            let distributed = 0;
            for (let i = 0; i < active.length; i++) {
                dots[i] += floors[i];
                distributed += floors[i];
            }
            const leftover = remaining - distributed;
            if (leftover > 0) {
                const ranked = rawAdds
                    .map((val, idx) => ({ idx, frac: val - floors[idx], tokens: active[idx].tokens }))
                    .sort((a, b) => (b.frac - a.frac) || (b.tokens - a.tokens) || (a.idx - b.idx));
                for (let k = 0; k < leftover && k < ranked.length; k++) {
                    dots[ranked[k].idx] += 1;
                }
            }
        } else {
            // Equal split fallback if all segments are tiny/equal
            for (let k = 0; k < remaining; k++) {
                dots[k % active.length] += 1;
            }
        }
    }

    const cells: DotMatrixCell[] = [];
    for (let i = 0; i < active.length; i++) {
        const seg = active[i];
        for (let d = 0; d < dots[i]; d++) {
            cells.push({
                index: cells.length,
                category: seg.key,
                colorToken: seg.colorToken,
                labelEn: seg.labelEn,
                labelZh: seg.labelZh,
                isFree: false,
            });
        }
    }

    const freeCount = Math.max(0, safeGridSize - cells.length);
    cells.push(...makeFreeCells(cells.length, freeCount));

    return cells.slice(0, safeGridSize);
}

/** Group a flat dot matrix array into rows (e.g. 20x5 or 10x10). */
export function formatDotMatrixRows(cells: readonly DotMatrixCell[], cols = 20): DotMatrixCell[][] {
    const safeCols = Number.isFinite(cols) && cols >= 1 ? Math.round(cols) : 20;
    const rows: DotMatrixCell[][] = [];
    for (let i = 0; i < cells.length; i += safeCols) {
        rows.push(cells.slice(i, i + safeCols));
    }
    return rows;
}

// ─── Report Formatters ───────────────────────────────────────────────────────

export function getMeasurementNote(state: ContextMeasurementState, lang: ReportLanguage): string {
    switch (state) {
        case 'measured':
            return biText(
                'Measured from Language Server model telemetry.',
                '来自语言服务器模型遥测实测数据。',
                lang,
            );
        case 'estimated_post_compaction':
            return biText(
                'Estimated (post-compaction): a compaction checkpoint occurred after the latest model generation.',
                '估算（压缩后）：最近一次模型生成后发生了上下文压缩检查点。',
                lang,
            );
        case 'estimated_rewind':
            return biText(
                'Estimated (rewind): step count shrank below previous peak; classified as rewind, not compaction.',
                '估算（回退）：步骤数低于先前峰值，判定为会话回退而非自动压缩。',
                lang,
            );
        case 'awaiting_generation':
            return biText(
                'Awaiting generation: no completed model usage reported yet; showing observed step telemetry only.',
                '等待生成：尚无已完成模型用量上报，仅展示已观测步骤遥测。',
                lang,
            );
    }
}

function buildAsciiProgressBar(pct: number, width = 20): string {
    const clamped = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
    const filled = Math.round((clamped / 100) * width);
    return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}]`;
}

function getCategoryLabel(seg: Pick<ContextCategorySegment, 'labelEn' | 'labelZh'>, lang: ReportLanguage): string {
    return biText(seg.labelEn, seg.labelZh, lang);
}

function getStartKindLabel(kind: 'cold' | 'partial' | 'warm' | 'unknown', lang: ReportLanguage): string {
    switch (kind) {
        case 'cold': return biText('Cold Start', '冷启动', lang);
        case 'partial': return biText('Partial Cache', '部分缓存', lang);
        case 'warm': return biText('Warm Cache', '热缓存', lang);
        default: return biText('Unknown', '未知', lang);
    }
}

/**
 * Format a CLI-style `/context` plain-text report suitable for clipboard copy,
 * bug reports, or terminal output in English, Chinese, or Bilingual mode.
 */
export function formatContextTextReport(
    input: ContextTextReportInput,
    lang: ReportLanguage = 'en',
): string {
    const { snapshot } = input;
    const lines: string[] = [];

    const headerTitle = biText('Context Window Report', '上下文窗口报告', lang);
    lines.push(`=== ${headerTitle} ===`);

    if (input.title) {
        lines.push(`${biText('Session', '会话', lang)}: ${sanitizeTitle(input.title, 100)}`);
    }
    if (input.workspacePath) {
        const branchSuffix = input.branchName ? ` (${input.branchName})` : '';
        lines.push(`${biText('Workspace', '工作区', lang)}: ${input.workspacePath}${branchSuffix}`);
    }

    const modelIdSuffix = snapshot.model && snapshot.model !== snapshot.modelDisplayName
        ? ` (${snapshot.model})`
        : '';
    lines.push(`${biText('Model', '模型', lang)}: ${snapshot.modelDisplayName}${modelIdSuffix}`);

    // Usage bar & Dual-Cap line
    const bar = buildAsciiProgressBar(snapshot.effectivePct, 20);
    if (snapshot.effectiveBudgetTokens > 0) {
        const capLabel = snapshot.hasDualCap
            ? biText('effective budget', '有效预算', lang)
            : biText('limit', '上限', lang);
        lines.push(
            `${biText('Usage', '用量', lang)}: ${bar} ${snapshot.effectivePct.toFixed(1)}% ` +
            `(${formatCompactTokens(snapshot.usedTokens)} / ${formatCompactTokens(snapshot.effectiveBudgetTokens)} ${capLabel})`,
        );
        if (snapshot.hasDualCap) {
            lines.push(
                `${biText('Native Ceiling', '原生上限', lang)}: ` +
                `${formatCompactTokens(snapshot.nativeLimitTokens)} (${snapshot.nativePct.toFixed(1)}%)`,
            );
        }
    } else {
        lines.push(`${biText('Usage', '用量', lang)}: ${formatCompactTokens(snapshot.usedTokens)} tokens`);
    }

    // Measurement state & compaction checkpoints
    lines.push(`${biText('Status', '状态', lang)}: ${getMeasurementNote(snapshot.measurementState, lang)}`);
    if (snapshot.compactionCheckpoints.length > 0) {
        const latestCp = snapshot.compactionCheckpoints[snapshot.compactionCheckpoints.length - 1];
        lines.push(
            `${biText('Compactions', '压缩记录', lang)}: ${snapshot.compactionCheckpoints.length} ` +
            `(${biText('latest saved', '最近节省', lang)} ${formatCompactTokens(latestCp.savedTokens)}: ` +
            `${formatCompactTokens(latestCp.beforeTokens)} -> ${formatCompactTokens(latestCp.afterTokens)} @ #${latestCp.stepIndex})`,
        );
    }

    // Optional prompt cache summary
    if (typeof input.cacheHitPct === 'number' && Number.isFinite(input.cacheHitPct)) {
        const kindSuffix = input.turnStartKind ? ` [${getStartKindLabel(input.turnStartKind, lang)}]` : '';
        lines.push(`${biText('Prompt Cache', '提示词缓存', lang)}: ${input.cacheHitPct.toFixed(1)}%${kindSuffix}`);
    }

    // Category breakdown table
    lines.push('');
    lines.push(`${biText('Category Breakdown', '分类明细', lang)}:`);
    if (snapshot.segments.length === 0) {
        lines.push(`  (${biText('No attributed token categories yet', '暂无可归因的分类数据', lang)})`);
    } else {
        const rows = snapshot.segments.map(seg => ({
            label: getCategoryLabel(seg, lang),
            tokens: formatCompactTokens(seg.tokens),
            pct: `${seg.pct.toFixed(1)}%`,
            items: `${seg.itemCount}`,
        }));
        const maxLabel = Math.min(34, Math.max(12, ...rows.map(r => r.label.length)));
        for (const r of rows) {
            const paddedLabel = r.label.length > maxLabel
                ? r.label.slice(0, maxLabel - 1) + '…'
                : r.label.padEnd(maxLabel, ' ');
            lines.push(`  ${paddedLabel}  ${r.tokens.padStart(7, ' ')}  ${r.pct.padStart(6, ' ')}  (${r.items})`);
        }
    }

    // Largest items
    if (snapshot.largestItems.length > 0) {
        lines.push('');
        lines.push(`${biText('Largest Items', '最大占用项', lang)}:`);
        for (let i = 0; i < snapshot.largestItems.length; i++) {
            const item = snapshot.largestItems[i];
            const catMeta = CONTEXT_CATEGORY_META[item.category];
            const catLabel = biText(catMeta.labelEn, catMeta.labelZh, lang);
            const stepTag = item.stepIndex !== undefined ? ` #${item.stepIndex}` : '';
            lines.push(
                `  ${i + 1}. [${catLabel}] ${item.title}${stepTag} — ` +
                `${formatCompactTokens(item.tokens)} (${item.pct.toFixed(1)}%)`,
            );
        }
    }

    // Optional quota summary
    if (input.quotaSummary && input.quotaSummary.length > 0) {
        lines.push('');
        lines.push(`${biText('Quota Summary', '配额摘要', lang)}:`);
        for (const q of input.quotaSummary) {
            const pctStr = Number.isFinite(q.remainingPct) ? `${Math.round(q.remainingPct)}%` : 'N/A';
            const parts = [pctStr];
            if (q.resetCountdown) { parts.push(`${biText('resets in', '重置倒计时', lang)} ${q.resetCountdown}`); }
            if (q.runwayLabel) { parts.push(q.runwayLabel); }
            lines.push(`  - ${q.poolName}: ${parts.join(' | ')}`);
        }
    }

    return lines.join('\n');
}

/**
 * Generate a concise, practical HANDOFF.md continuation prompt to paste into a
 * fresh conversation when approaching the context window ceiling.
 */
export function formatHandoffPrompt(
    input: HandoffPromptInput,
    lang: ReportLanguage = 'en',
): string {
    const snap = input.snapshot;
    const modelName = (input.modelDisplayName && input.modelDisplayName.trim())
        || snap?.modelDisplayName
        || (input.model ? getModelDisplayName(input.model) : 'Unknown Model');
    const title = (input.title && input.title.trim())
        || biText('Untitled Conversation', '未命名会话', lang);
    const workspace = (input.workspacePath && input.workspacePath.trim())
        || biText('(unspecified workspace)', '（未指定工作区）', lang);

    const lines: string[] = [];
    lines.push(`# ${biText('HANDOFF — Session Continuation', 'HANDOFF — 会话交接继续执行', lang)}`);
    lines.push('');
    lines.push(`## ${biText('Session Context', '会话概况', lang)}`);
    lines.push(`- **${biText('Workspace', '工作区', lang)}**: \`${workspace}\`${input.branchName ? ` (\`${input.branchName}\`)` : ''}`);
    lines.push(`- **${biText('Previous Conversation', '原会话', lang)}**: ${sanitizeTitle(title, 120)}`);
    lines.push(`- **${biText('Model', '模型', lang)}**: ${modelName}`);

    if (snap) {
        if (snap.effectiveBudgetTokens > 0) {
            const dualNote = snap.hasDualCap
                ? ` (${biText('native', '原生', lang)} ${formatCompactTokens(snap.nativeLimitTokens)}, ${snap.nativePct.toFixed(1)}%)`
                : '';
            lines.push(
                `- **${biText('Context Utilization', '上下文占用', lang)}**: ` +
                `${formatCompactTokens(snap.usedTokens)} / ${formatCompactTokens(snap.effectiveBudgetTokens)} ` +
                `(${snap.effectivePct.toFixed(1)}%)${dualNote}`,
            );
        } else {
            lines.push(
                `- **${biText('Context Utilization', '上下文占用', lang)}**: ${formatCompactTokens(snap.usedTokens)} tokens`,
            );
        }
        lines.push(`- **${biText('Telemetry State', '遥测状态', lang)}**: ${getMeasurementNote(snap.measurementState, lang)}`);
        if (snap.compactionCheckpoints.length > 0) {
            lines.push(
                `- **${biText('Compactions Observed', '已发生压缩', lang)}**: ${snap.compactionCheckpoints.length}`,
            );
        }
    }

    // Active topics / key context items
    const topics: string[] = [];
    if (input.recentTopics && input.recentTopics.length > 0) {
        for (const t of input.recentTopics) {
            const cleaned = sanitizeTitle(t, 120);
            if (cleaned && cleaned !== 'Untitled') { topics.push(cleaned); }
        }
    }
    if (topics.length === 0 && snap && snap.largestItems.length > 0) {
        for (const item of snap.largestItems.slice(0, 3)) {
            topics.push(`${item.title} (${formatCompactTokens(item.tokens)})`);
        }
    }

    if (topics.length > 0) {
        lines.push('');
        lines.push(`## ${biText('Active Focus & Key Context', '当前焦点与关键上下文', lang)}`);
        for (const topic of topics.slice(0, 5)) {
            lines.push(`- ${topic}`);
        }
    }

    // Active tools
    if (input.activeTools && input.activeTools.length > 0) {
        const uniqueTools = [...new Set(input.activeTools.map(t => t.trim()).filter(Boolean))].slice(0, 8);
        if (uniqueTools.length > 0) {
            lines.push('');
            lines.push(`## ${biText('Top Active Tools', '常用工具', lang)}`);
            lines.push(`- ${uniqueTools.map(t => `\`${t}\``).join(', ')}`);
        }
    }

    if (input.notes && input.notes.trim()) {
        lines.push('');
        lines.push(`## ${biText('Additional Notes', '补充说明', lang)}`);
        lines.push(input.notes.trim());
    }

    // Resume checklist
    lines.push('');
    lines.push(`## ${biText('Resume Checklist', '续接检查清单', lang)}`);
    if (input.pendingTasks && input.pendingTasks.length > 0) {
        for (const task of input.pendingTasks) {
            const cleaned = task.trim();
            if (cleaned) {
                lines.push(`- [ ] ${cleaned}`);
            }
        }
    } else {
        lines.push(
            `- [ ] ${biText(
                'Inspect current git status, active branch, and recent edits in the workspace before changing files.',
                '修改文件前先检查当前工作区的 git 状态、所在分支及近期改动。',
                lang,
            )}`,
        );
        lines.push(
            `- [ ] ${biText(
                'Re-read the key files and active focus items listed above to rebuild minimal necessary context.',
                '重新阅读上方列出的关键文件与焦点事项，以最小上下文恢复状态。',
                lang,
            )}`,
        );
        lines.push(
            `- [ ] ${biText(
                'Continue the remaining implementation work and run the relevant compile/test checks to verify.',
                '继续推进剩余实现任务，并运行相关编译与测试校验结果。',
                lang,
            )}`,
        );
    }

    return lines.join('\n');
}

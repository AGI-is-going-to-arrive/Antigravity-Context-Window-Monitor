import { parseGeneratorStepIndex } from './gm/types';
import { parseCreditBalance } from './account-credits';
import { isFullCompactionCheckpoint, parseContextBreakdown } from './context-breakdown';
import { LSInfo } from './discovery';
import { rpcCall, rpcStreamFirstFrame } from './rpc-client';
import { getTrajectoryPollBudgetSnapshot } from './core/swarm-registry';
import { normalizeWorkspaceUri, type NormalizeWorkspaceUriOptions } from './conversation-selector';
import {
    getAntigravityUserConfigPath,
    parseAntigravityUserConfig,
    readLocalOrchestratorConfigFallback,
    type OrchestratorRouteSegment,
} from './orchestrator-attribution';
import {
    getContextLimit,
    getModelDisplayName,
    normalizeModelDisplayName,
    updateModelDisplayNames,
    resolveOrchestratorSettings,
    ModelConfig,
    FullUserStatus,
    UserStatusInfo,
    GroupedModelInfo,
    GroupedModelThinkingLevel,
    OrchestratorModelRoles,
    OrchestratorSettings,
    QuotaPoolSummary,
    QuotaWindowSummary,
    UserQuotaSummary,
    isImageGenerationModel,
    resolveModelId,
} from './models';
import {
    StepType,
    SYSTEM_PROMPT_OVERHEAD,
    USER_INPUT_OVERHEAD,
    PLANNER_RESPONSE_ESTIMATE,
    COMPRESSION_MIN_DROP,
    MAX_CONCURRENT_BATCHES,
    MAX_TRAJECTORY_STEPS,
    MAX_RESPONSE_BODY_SIZE,
    STEP_BATCH_SIZE,
} from './constants';

declare module './models' {
    interface FullUserStatus {
        /** True when GetUserStatus RPC succeeded and returned a valid userStatus object. */
        ok?: boolean;
        /** Optional error message when ok is false (RPC failure or malformed userStatus). */
        error?: string;
    }
}

/** Return type of `fetchFullUserStatus()` with explicit `ok` status so callers never confuse RPC failures with valid empty data. */
export interface FullUserStatusFetchResult extends FullUserStatus {
    ok: boolean;
    error?: string;
}

export interface FetchTrajectoryGeneratorMetadataResult {
    ok: boolean;
    metadata: RawGeneratorMetadataEntry[];
    error?: string;
}

export interface FetchTrajectoryStepsResult {
    ok: boolean;
    steps: Array<Record<string, unknown>>;
    hasGaps: boolean;
    /** True when suffix recovery retrieved a verified contiguous live tail `[suffixStartOffset..totalSteps)`. */
    suffixRecovered?: boolean;
    /** Starting step offset of `steps[0]` when suffix recovery skipped an oversize prefix `[0..suffixStartOffset)`. */
    suffixStartOffset?: number;
    error?: string;
}

export interface FetchTrajectoryStepsOptions {
    /** Optional per-request response byte cap (clamped to `<= MAX_RESPONSE_BODY_SIZE`). */
    maxResponseBytes?: number;
    /** Optional cap on suffix-recovery probe requests (clamped to `[1, 8]`, default `8`). */
    maxSuffixProbes?: number;
}

// Re-export from models.ts so extension.ts imports stay compatible
export {
    getContextLimit,
    getModelDisplayName,
    normalizeModelDisplayName,
    updateModelDisplayNames,
    ModelConfig,
    FullUserStatus,
    UserStatusInfo,
    GroupedModelInfo,
    OrchestratorModelRoles,
    OrchestratorSettings,
    QuotaPoolSummary,
    QuotaWindowSummary,
    UserQuotaSummary,
    getAntigravityUserConfigPath,
    parseAntigravityUserConfig,
    readLocalOrchestratorConfigFallback,
    type OrchestratorRouteSegment,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrajectorySummary {
    /** Measured directly by ID because the host's conversation index omitted this swarm member. */
    manifestMember?: boolean;
    cascadeId: string;
    trajectoryId: string;
    summary: string;
    stepCount: number;
    status: string;
    lastModifiedTime: string;
    createdTime: string;
    requestedModel: string;
    generatorModel: string;
    workspaceUris: string[];
    /** Last user input timestamp */
    lastUserInputTime: string;
    /** Step index of last user input */
    lastUserInputStepIndex: number;
    /** Git repository computed name (e.g. "user/repo") */
    repositoryName: string;
    /** Git remote origin URL */
    gitOriginUrl: string;
    /** Current git branch name */
    branchName: string;
    /** Git root absolute URI */
    gitRootUri: string;
    /** Optional trajectory kind reported by v2.34+ hubs (e.g. subagent/swarm vs user chat) */
    trajectoryType?: string;
    /** Optional parent cascade ID when trajectory was spawned as a subagent */
    parentCascadeId?: string;
    /** Optional parent trajectory ID when trajectory was spawned as a child */
    parentTrajectoryId?: string;
    /** Optional explicit subagent flag from trajectory summary */
    isSubagent?: boolean;
    /** Optional agent/swarm role (e.g. coordinator vs worker) */
    role?: string;
    /** Optional swarm identifier if trajectory belongs to a swarm */
    swarmId?: string;
    /** Optional raw trajectoryMetadata bag from GetAllCascadeTrajectories */
    trajectoryMetadata?: Record<string, unknown>;
    /** Whether the trajectory has been explicitly killed */
    killed?: boolean;
}

export interface RawPromptSection {
    title?: string;
    tokenType?: string;
    contentLen?: number;
    [key: string]: unknown;
}

export interface RawGeneratorMetadataEntry {
    stepIndices?: number[];
    chatModel?: Record<string, unknown> & {
        promptSections?: RawPromptSection[];
        usage?: Record<string, unknown>;
    };
    [key: string]: unknown;
}

export interface StepTokenInfo {
    type: string;
    /** toolCallOutputTokens — tool results fed back as input context */
    toolCallOutputTokens: number;
    model: string;
}

export interface ModelUsageInfo {
    model: string;
    inputTokens: number;
    outputTokens: number;
    responseOutputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens?: number;
}

/** Active per-conversation dynamic Orchestrator pair from USER_INPUT plannerConfig. */
export interface ConversationOrchestratorConfig {
    planModel: string;
    executionModel: string;
}

export interface TokenUsageResult {
    postCompactionPending?: boolean;
    /** Source of the latest token snapshot; absent only in pre-1.16.19 caches. */
    tokenUsageSource?: 'checkpoint' | 'planner' | 'estimated';
    /** Actual input tokens from the latest provider snapshot (if available) */
    inputTokens: number;
    /** Actual model output tokens from the latest modelUsage snapshot */
    totalOutputTokens: number;
    /** Cumulative toolCallOutputTokens (tool results — part of input context) */
    totalToolCallOutputTokens: number;
    /** The effective context usage (inputTokens if precise, estimated otherwise) */
    contextUsed: number;
    /** Whether the values are precise (from modelUsage) or estimated */
    isEstimated: boolean;
    /** Model identifier */
    model: string;
    /** Per-step token details */
    stepDetails: StepTokenInfo[];
    /** Latest planner/checkpoint modelUsage (if available) */
    lastModelUsage: ModelUsageInfo | null;
    /** Estimated tokens added since the last checkpoint (for debugging/display) */
    estimatedDeltaSinceCheckpoint: number;
    /** Number of image generation steps detected */
    imageGenStepCount: number;
    /** Canonical image-tool identities, separate from their text coordinators. */
    imageGenerationModels?: string[];
    /** Explicit child references emitted by invokeSubagent.results. */
    linkedSubagentCascadeIds?: string[];
    /** True when step batch fetching had gaps (some batches failed) */
    hasGaps: boolean;
    /** True when step fetching recovered a contiguous live tail suffix `[suffixStartOffset..totalSteps)` after an oversize prefix. */
    suffixRecovered?: boolean;
    /** Starting step offset of the recovered live tail suffix when `suffixRecovered` is true. */
    suffixStartOffset?: number;
    /** In-memory raw steps from the same foreground fetch (non-serialized reuse for breakdown). */
    _fetchedSteps?: Array<Record<string, unknown>>;
    /** True when consecutive checkpoint inputTokens show a significant drop */
    checkpointCompressionDetected: boolean;
    /** Size of the inputTokens drop between consecutive checkpoints (0 if none) */
    checkpointCompressionDrop: number;
    /** Model ID from the last checkpoint's modelUsage (shadow model, e.g. M50 Flash Lite) */
    checkpointModel: string;
    /** Active Planner → Executor pair when dynamic Orchestrator mode is used in this conversation. */
    orchestratorConfig?: ConversationOrchestratorConfig;
    /** Chronological per-turn Orchestrator route segments (tracks mid-conversation reconfigurations). */
    orchestratorHistory?: OrchestratorRouteSegment[];
}

// ─── Token Estimation from Text ──────────────────────────────────────────────

/**
 * Estimate token count from raw text content.
 * Uses character-based heuristic: ASCII ~4 chars/token, non-ASCII ~1.5 chars/token.
 */
export function estimateTokensFromText(text: string): number {
    if (!text) { return 0; }
    let asciiChars = 0;
    let nonAsciiChars = 0;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) < 128) {
            asciiChars++;
        } else {
            nonAsciiChars++;
        }
    }
    return Math.ceil(asciiChars / 4 + nonAsciiChars / 1.5);
}

export interface ContextUsage {
    /** A full compaction has completed and the next planner measurement is pending. */
    postCompactionPending?: boolean;
    /** Source of the latest token snapshot; also invalidates legacy usage caches. */
    tokenUsageSource?: 'checkpoint' | 'planner' | 'estimated';
    cascadeId: string;
    /** Host trajectory identity within the conversation (when exposed by the backend). */
    trajectoryId?: string;
    title: string;
    model: string;
    modelDisplayName: string;
    /** Context occupancy includes fresh input, cached input, output and subsequent estimated delta. */
    contextUsed: number;
    /** Actual model output tokens (from checkpoint modelUsage.outputTokens) */
    totalOutputTokens: number;
    /** Cumulative toolCallOutputTokens (tool results — part of input context) */
    totalToolCallOutputTokens: number;
    contextLimit: number;
    usagePercent: number;
    stepCount: number;
    lastModifiedTime: string;
    status: string;
    /** Whether the values come from precise modelUsage or estimation */
    isEstimated: boolean;
    /** Latest planner/checkpoint model usage details */
    lastModelUsage: ModelUsageInfo | null;
    /** Estimated tokens added since the last checkpoint */
    estimatedDeltaSinceCheckpoint: number;
    /** Number of image generation steps detected */
    imageGenStepCount: number;
    imageGenerationModels?: string[];
    /** True when a linked child was unavailable or traversal reached a safety bound. */
    imageGenerationIncomplete?: boolean;
    /** Direct observations retained so refreshing children never accumulates counts twice. */
    imageWorkflow?: ImageWorkflowInfo;
    /** True when context compression was detected. */
    compressionDetected: boolean;
    /** Input token drop between consecutive checkpoints */
    checkpointCompressionDrop: number;
    /** Previous contextUsed before compression was detected (for display) */
    previousContextUsed?: number;
    /** True when step data may be incomplete (batch fetch gaps) */
    hasGaps: boolean;
    /** True when step fetching recovered a contiguous live tail suffix after an oversize prefix. */
    suffixRecovered?: boolean;
    /** Starting step offset of the recovered live tail suffix when `suffixRecovered` is true. */
    suffixStartOffset?: number;
    /** Non-enumerable in-memory steps attached by getContextUsage to avoid duplicate foreground reads. */
    _fetchedSteps?: Array<Record<string, unknown>>;
    /** Shadow model used by the last checkpoint (e.g. M50 Flash Lite) for transparency */
    checkpointModel: string;
    /** Active Planner → Executor pair when dynamic Orchestrator mode is used in this conversation. */
    orchestratorConfig?: ConversationOrchestratorConfig;
    /** Chronological per-turn Orchestrator route segments (tracks mid-conversation reconfigurations). */
    orchestratorHistory?: OrchestratorRouteSegment[];
    // ─── Extended Transparency Fields ─────────────────────────────────────
    /** Created time of the trajectory */
    createdTime: string;
    /** Last user input timestamp */
    lastUserInputTime: string;
    /** Step index of last user input */
    lastUserInputStepIndex: number;
    /** Git repository computed name */
    repositoryName: string;
    /** Git remote origin URL */
    gitOriginUrl: string;
    /** Current git branch name */
    branchName: string;
    /** Git root absolute URI */
    gitRootUri: string;
}

export interface ImageWorkflowInfo {
    directStepCount: number;
    directModels: string[];
    linkedCascadeIds: string[];
}

// ─── Trajectory Queries ───────────────────────────────────────────────────────

/**
 * Get all cascade trajectories (conversations) from the LS.
 */
export async function getAllTrajectories(ls: LSInfo, signal?: AbortSignal): Promise<TrajectorySummary[]> {
    const resp = await rpcCall(ls, 'GetAllCascadeTrajectories', {
        metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
    }, 10000, signal);

    const summaries = resp.trajectorySummaries as Record<string, Record<string, unknown>> | undefined;
    if (!summaries) {
        return [];
    }

    const result: TrajectorySummary[] = [];
    for (const [cascadeId, data] of Object.entries(summaries)) {
        let requestedModel = '';
        let generatorModel = '';

        const latestTask = data.latestTaskBoundaryStep as Record<string, unknown> | undefined;
        const latestNotify = data.latestNotifyUserStep as Record<string, unknown> | undefined;

        for (const latest of [latestTask, latestNotify]) {
            if (latest) {
                const step = latest.step as Record<string, unknown> | undefined;
                if (step) {
                    const meta = step.metadata as Record<string, unknown> | undefined;
                    if (meta) {
                        if (meta.generatorModel) { generatorModel = meta.generatorModel as string; }
                        const rm = meta.requestedModel as Record<string, unknown> | undefined;
                        if (rm?.model) { requestedModel = rm.model as string; }
                    }
                }
            }
        }

        const workspaces = data.workspaces as Array<Record<string, unknown>> | undefined;
        const workspaceUris: string[] = [];
        if (workspaces) {
            for (const ws of workspaces) {
                const uri = ws.workspaceFolderAbsoluteUri as string | undefined;
                if (uri) {
                    workspaceUris.push(uri);
                }
            }
        }

        // Extract Git info from first workspace
        const firstWs = workspaces?.[0] as Record<string, unknown> | undefined;
        const repo = firstWs?.repository as Record<string, unknown> | undefined;
        const repositoryName = (repo?.computedName as string) || '';
        const gitOriginUrl = (repo?.gitOriginUrl as string) || '';
        const branchName = (firstWs?.branchName as string) || '';
        const gitRootUri = (firstWs?.gitRootAbsoluteUri as string) || '';

        const asMetaBag = (raw: unknown): Record<string, unknown> | undefined =>
            raw && typeof raw === 'object' && !Array.isArray(raw)
                ? (raw as Record<string, unknown>)
                : undefined;
        const rawMetaBags = [
            asMetaBag(data.metadata),
            asMetaBag(data.cascadeMetadata),
            asMetaBag(data.swarmMetadata),
            asMetaBag(data.trajectoryMetadata),
        ].filter((bag): bag is Record<string, unknown> => Boolean(bag));
        const trajectoryMetadata = rawMetaBags.length > 0
            ? Object.assign({}, ...rawMetaBags) as Record<string, unknown>
            : undefined;
        const pickMetaStr = (...values: unknown[]): string | undefined => {
            for (const v of values) {
                if (typeof v === 'string' && v.trim()) { return v.trim(); }
            }
            return undefined;
        };
        const rawParentCascadeId = pickMetaStr(
            data.parentCascadeId,
            data.parentConversationId,
            trajectoryMetadata?.parentCascadeId,
            trajectoryMetadata?.parentConversationId,
        );
        const rawParentTrajectoryId = pickMetaStr(
            data.parentTrajectoryId,
            trajectoryMetadata?.parentTrajectoryId,
        );
        const rawTrajectoryType = pickMetaStr(
            data.trajectoryType,
            trajectoryMetadata?.trajectoryType,
        );
        const rawRole = pickMetaStr(
            data.role,
            data.agentRole,
            data.agentType,
            data.swarmRole,
            trajectoryMetadata?.role,
            trajectoryMetadata?.agentRole,
            trajectoryMetadata?.agentType,
            trajectoryMetadata?.swarmRole,
        );
        const rawSwarmId = pickMetaStr(
            data.swarmId,
            trajectoryMetadata?.swarmId,
        );
        const rawIsSubagent = data.isSubagent === true
            || data.isChild === true
            || trajectoryMetadata?.isSubagent === true
            || trajectoryMetadata?.isChild === true;

        result.push({
            cascadeId,
            trajectoryId: (data.trajectoryId as string) || '',
            summary: (data.summary as string) || cascadeId,
            stepCount: (data.stepCount as number) || 0,
            status: (data.status as string) || 'unknown',
            lastModifiedTime: (data.lastModifiedTime as string) || '',
            createdTime: (data.createdTime as string) || '',
            requestedModel: requestedModel || generatorModel,
            generatorModel,
            workspaceUris,
            lastUserInputTime: (data.lastUserInputTime as string) || '',
            lastUserInputStepIndex: (data.lastUserInputStepIndex as number) || 0,
            repositoryName,
            gitOriginUrl,
            branchName,
            gitRootUri,
            ...(rawTrajectoryType ? { trajectoryType: rawTrajectoryType } : {}),
            ...(rawParentCascadeId ? { parentCascadeId: rawParentCascadeId } : {}),
            ...(rawParentTrajectoryId ? { parentTrajectoryId: rawParentTrajectoryId } : {}),
            ...(rawIsSubagent ? { isSubagent: true } : {}),
            ...(rawRole ? { role: rawRole } : {}),
            ...(rawSwarmId ? { swarmId: rawSwarmId } : {}),
            ...(trajectoryMetadata ? { trajectoryMetadata } : {}),
            ...(typeof data.killed === 'boolean' ? { killed: data.killed } : {}),
        });
    }

    // Sort chronologically by lastModifiedTime (falling back to createdTime so brand-new
    // conversations with empty lastModifiedTime stay at the top instead of sinking to the bottom).
    const sortTimestampMs = (item: TrajectorySummary): number => {
        const raw = (item.lastModifiedTime || item.createdTime || '').trim();
        if (!raw) { return 0; }
        const parsed = Date.parse(raw);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    result.sort((a, b) => {
        const diff = sortTimestampMs(b) - sortTimestampMs(a);
        if (diff !== 0) { return diff; }
        const rawA = a.lastModifiedTime || a.createdTime;
        const rawB = b.lastModifiedTime || b.createdTime;
        if (!rawA && !rawB) { return a.cascadeId.localeCompare(b.cascadeId); }
        if (!rawA) { return 1; }
        if (!rawB) { return -1; }
        return rawB.localeCompare(rawA);
    });

    return result;
}

/**
 * Normalize a URI for comparison:
 * - Preserves Remote-SSH and WSL distro authorities so distinct remote hosts or WSL distros
 *   (e.g. `Ubuntu` vs `Debian`) with identical paths never collide
 * - Translates `\\wsl$` / `\\wsl.localhost` aliases into canonical `vscode-remote://wsl+<distro>/...`
 *   while preserving POSIX case sensitivity
 * - Strips file:// prefix, URL-decodes, strips trailing slash
 * - Case-folds on Windows and confirmed case-insensitive macOS APFS while preserving case on Linux,
 *   macOS case-sensitive APFS volumes, and indeterminate macOS APFS probes.
 */
export function normalizeUri(
    uri: string,
    platformOrOptions: NodeJS.Platform | NormalizeWorkspaceUriOptions = process.platform,
): string {
    if (typeof platformOrOptions === 'string') {
        return normalizeWorkspaceUri(uri, {
            platform: platformOrOptions,
            ...(platformOrOptions === 'linux' ? { caseSensitive: true } : {}),
        });
    }
    return normalizeWorkspaceUri(uri, platformOrOptions);
}

// ─── Step Processing ──────────────────────────────────────────────────────────

/** Process a user input step and return estimated tokens. */
function processUserInputStep(step: Record<string, unknown>): number {
    const ui = step.userInput as Record<string, unknown> | undefined;
    const userText = (ui?.userResponse as string) || '';
    return ui ? estimateTokensFromText(userText) : USER_INPUT_OVERHEAD;
}

/** Process a planner response step and return estimated tokens. */
function processPlannerResponseStep(step: Record<string, unknown>): number {
    const pr = step.plannerResponse as Record<string, unknown> | undefined;
    const responseText = (pr?.response as string) || '';
    const thinkingText = (pr?.thinking as string) || '';
    let toolCallsText = '';
    const toolCalls = pr?.toolCalls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
        for (const tc of toolCalls) {
            toolCallsText += (tc.argumentsJson as string) || '';
        }
    }
    const totalText = responseText + thinkingText + toolCallsText;
    return pr ? estimateTokensFromText(totalText) : PLANNER_RESPONSE_ESTIMATE;
}

/** Detect image generation, not an image input, image viewer, or code generator. */
export function isImageGenStep(step: Record<string, unknown>, stepModel: string): boolean {
    const type = step.type;
    if (type === 'CORTEX_STEP_TYPE_GENERATE_IMAGE' || type === 'CORTEX_STEP_TYPE_IMAGE_GENERATION') { return true; }
    if (step.generateImage && typeof step.generateImage === 'object' && !Array.isArray(step.generateImage)) { return true; }
    return type !== StepType.USER_INPUT && type !== StepType.CHECKPOINT && isImageGenerationModel(stepModel);
}

/** Follow only typed subagent / swarm spawn invocation results, never arbitrary IDs in prompts or tool arguments. */
export function extractLinkedSubagentIds(steps: Array<Record<string, unknown>>): string[] {
    const ids = new Set<string>();
    const addId = (value: unknown): void => {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed && trimmed.length <= 256) {
                ids.add(trimmed);
            }
        }
    };
    const collectFromRecord = (rec: Record<string, unknown>): void => {
        addId(rec.conversationId);
        addId(rec.cascadeId);
        addId(rec.childCascadeId);
        addId(rec.workerConversationId);
        addId(rec.workerCascadeId);
    };
    for (const step of steps) {
        if (step.type === 'CORTEX_STEP_TYPE_INVOKE_SUBAGENT') {
            const invocation = step.invokeSubagent;
            if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)) { continue; }
            const invRec = invocation as Record<string, unknown>;
            collectFromRecord(invRec);
            const results = invRec.results;
            if (Array.isArray(results)) {
                for (const result of results) {
                    if (!result || typeof result !== 'object' || Array.isArray(result)) { continue; }
                    collectFromRecord(result as Record<string, unknown>);
                }
            }
            continue;
        }
        // Also collect typed child IDs from native swarm spawn steps when present
        const rawType = typeof step.type === 'string' ? step.type : '';
        if (rawType === 'CORTEX_STEP_TYPE_SWARM' || rawType === 'CORTEX_STEP_TYPE_SPAWN_SUBAGENT') {
            for (const key of ['swarm', 'swarmAdd', 'spawnSubagent', 'subagentSpawn'] as const) {
                const bag = step[key];
                if (!bag || typeof bag !== 'object' || Array.isArray(bag)) { continue; }
                const bagRec = bag as Record<string, unknown>;
                collectFromRecord(bagRec);
                for (const arrKey of ['results', 'workers', 'agents'] as const) {
                    const list = bagRec[arrKey];
                    if (!Array.isArray(list)) { continue; }
                    for (const item of list) {
                        if (!item || typeof item !== 'object' || Array.isArray(item)) { continue; }
                        collectFromRecord(item as Record<string, unknown>);
                    }
                }
            }
        }
    }
    return [...ids];
}

function imageModelForStep(step: Record<string, unknown>, coordinatorModel: string): string {
    const payload = step.generateImage;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const name = (payload as Record<string, unknown>).modelName;
        if (typeof name === 'string' && name.trim()) { return resolveModelId(name) || name.trim(); }
    }
    return isImageGenerationModel(coordinatorModel) ? resolveModelId(coordinatorModel) || coordinatorModel : '';
}

/** Extract provider token counts from a checkpoint or completed planner response. */
function extractModelUsage(meta: Record<string, unknown>): ModelUsageInfo | null {
    const mu = meta.modelUsage as Record<string, unknown> | undefined;
    if (!mu || typeof mu !== 'object' || Array.isArray(mu)) { return null; }

    const count = (value: unknown): number | null => {
        if (value === undefined) { return 0; }
        if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) { return null; }
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
    };
    const inputTokens = count(mu.inputTokens);
    const outputTokens = count(mu.outputTokens);
    const responseOutputTokens = count(mu.responseOutputTokens);
    const cacheReadTokens = count(mu.cacheReadTokens);
    const cacheCreationTokens = count(mu.cacheCreationTokens);
    if (inputTokens === null || outputTokens === null || responseOutputTokens === null
        || cacheReadTokens === null || cacheCreationTokens === null) { return null; }
    const model = typeof mu.model === 'string' ? mu.model : '';

    if (inputTokens > 0 || outputTokens > 0 || cacheReadTokens > 0 || cacheCreationTokens > 0) {
        return { model, inputTokens, outputTokens, responseOutputTokens, cacheReadTokens, cacheCreationTokens };
    }
    return null;
}

function isConcreteModelString(value: unknown): value is string {
    if (typeof value !== 'string') { return false; }
    const trimmed = value.trim();
    if (!trimmed) { return false; }
    const upper = trimmed.toUpperCase();
    return upper !== 'MODEL_UNSPECIFIED' && upper !== 'MODEL_PLACEHOLDER_UNSPECIFIED';
}

/**
 * Process an array of trajectory steps and compute token usage.
 * Pure function — no RPC calls, no side effects.
 */
export function processSteps(steps: Array<Record<string, unknown>>): TokenUsageResult {
    let toolOutputTokens = 0;
    let model = '';
    let orchestratorConfig: ConversationOrchestratorConfig | undefined;
    const orchestratorHistory: OrchestratorRouteSegment[] = [];
    const stepDetails: StepTokenInfo[] = [];
    let lastModelUsage: ModelUsageInfo | null = null;
    let tokenUsageSource: 'checkpoint' | 'planner' | 'estimated' = 'estimated';
    let checkpointModel = '';
    let pendingCheckpoint = -1;
    let imageGenStepCount = 0;
    const imageGenStepIndices = new Set<number>();
    const imageGenerationModels = new Set<string>();

    let estimationOverhead = 0;
    let outputTokensSinceCheckpoint = 0;

    interface CompressionBaseline {
        model: string;
        role: string;
        branch: string;
        inputTokens: number;
        stepIndex: number | null;
    }

    let prevCheckpoint: CompressionBaseline | null = null;
    let prevPlanner: CompressionBaseline | null = null;
    let activeBranch = 'default';
    let branchEpoch = 0;
    let checkpointCompressionDetected = false;
    let checkpointCompressionDrop = 0;

    const canonicalModelKey = (candidate: unknown): string => {
        if (!isConcreteModelString(candidate)) { return ''; }
        const trimmed = candidate.trim();
        return resolveModelId(trimmed) || trimmed;
    };

    const isDelegatedExecutor = (candidate: string): boolean => {
        if (!orchestratorConfig || !candidate) { return false; }
        const normCandidate = resolveModelId(candidate) || candidate;
        const normExec = resolveModelId(orchestratorConfig.executionModel) || orchestratorConfig.executionModel;
        return normCandidate === normExec;
    };

    const extractExplicitBranch = (
        step: Record<string, unknown>,
        meta?: Record<string, unknown>,
    ): string | null => {
        const pr = step.plannerResponse && typeof step.plannerResponse === 'object' && !Array.isArray(step.plannerResponse)
            ? step.plannerResponse as Record<string, unknown>
            : undefined;
        const explicitStr = [
            meta?.branchId,
            meta?.trajectoryBranchId,
            meta?.conversationBranchId,
            meta?.executionBranchId,
            meta?.branchName,
            meta?.branch,
            meta?.forkId,
            step.branchId,
            step.trajectoryBranchId,
            step.branchName,
            step.branch,
            step.forkId,
            pr?.branchId,
            pr?.branch,
        ].find(v => typeof v === 'string' && v.trim().length > 0);
        if (typeof explicitStr === 'string') {
            return explicitStr.trim();
        }
        const explicitNum = [meta?.branchIndex, step.branchIndex].find(
            v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0,
        );
        if (typeof explicitNum === 'number') {
            return `branch:${explicitNum}`;
        }
        return null;
    };

    const extractStepRole = (
        step: Record<string, unknown>,
        meta: Record<string, unknown>,
        usageModel: string,
    ): string => {
        const pr = step.plannerResponse && typeof step.plannerResponse === 'object' && !Array.isArray(step.plannerResponse)
            ? step.plannerResponse as Record<string, unknown>
            : undefined;
        const explicitRole = [
            meta.role,
            meta.agentRole,
            meta.plannerRole,
            meta.stepRole,
            meta.executionRole,
            step.role,
            pr?.role,
        ].find(v => typeof v === 'string' && v.trim().length > 0);
        if (typeof explicitRole === 'string') {
            return explicitRole.trim().toLowerCase();
        }
        if (meta.isSubagent === true || step.isSubagent === true) {
            return 'subagent';
        }
        if (usageModel && isDelegatedExecutor(usageModel)) {
            return 'executor';
        }
        return 'planner';
    };

    const isDelegatedOrChildRole = (role: string): boolean =>
        role === 'executor'
        || role === 'delegated_executor'
        || role === 'subagent'
        || role === 'worker';

    const maybeClearStaleOrchestrator = (nextModel: string): void => {
        if (!orchestratorConfig || !nextModel) { return; }
        const resolvedNext = resolveModelId(nextModel);
        const concreteNext = resolvedNext || (/^MODEL_[A-Z0-9_]+$/i.test(nextModel.trim()) ? nextModel.trim() : '');
        if (!concreteNext) { return; }
        const normPlan = resolveModelId(orchestratorConfig.planModel) || orchestratorConfig.planModel;
        if (concreteNext !== normPlan) {
            orchestratorConfig = undefined;
        }
    };

    for (let globalStepIdx = 0; globalStepIdx < steps.length; globalStepIdx++) {
        const step = steps[globalStepIdx];
        if (!step || typeof step !== 'object' || Array.isArray(step)) { continue; }
        const meta = step.metadata as Record<string, unknown> | undefined;
        const stepType = (step.type as string) || '';
        const stepModel = typeof meta?.generatorModel === 'string' ? meta.generatorModel : '';
        const imageStep = isImageGenStep(step, stepModel);
        const explicitStepIdx = typeof step.stepIndex === 'number' && Number.isSafeInteger(step.stepIndex) && step.stepIndex >= 0
            ? step.stepIndex
            : null;
        const previousBranch = activeBranch;
        const startsBranch = stepType === 'CORTEX_STEP_TYPE_BRANCH' || stepType === 'CORTEX_STEP_TYPE_REWIND' || meta?.isBranchStart === true;
        if (startsBranch) {
            branchEpoch++;
            activeBranch = `epoch:${branchEpoch}`;
        }
        const explicitBranch = extractExplicitBranch(step, meta);
        if (explicitBranch) {
            activeBranch = explicitBranch;
        }
        const stepBranch = explicitBranch || activeBranch;
        if (pendingCheckpoint >= 0 && (startsBranch || stepBranch !== previousBranch)) {
            // A different branch may have forked before the compacted prefix.
            pendingCheckpoint = -1;
            lastModelUsage = null;
            estimationOverhead = 0;
            outputTokensSinceCheckpoint = 0;
            prevPlanner = null;
            prevCheckpoint = null;
        }
        if (stepType === StepType.CHECKPOINT && isFullCompactionCheckpoint(step)) {
            pendingCheckpoint = globalStepIdx;
        }

        // Count user input steps
        if (stepType === StepType.USER_INPUT) {
            estimationOverhead += processUserInputStep(step);
            // The agy hub records the user's selection here, before any planner
            // response exists; its trajectory summaries omit the old model hints.
            const userInput = step.userInput as Record<string, unknown> | undefined;
            const userConfig = userInput?.userConfig as Record<string, unknown> | undefined;
            const plannerConfig = userConfig?.plannerConfig as Record<string, unknown> | undefined;
            const rawReq = plannerConfig?.requestedModel;
            const reqModel = typeof rawReq === 'string'
                ? rawReq
                : (rawReq && typeof rawReq === 'object' && !Array.isArray(rawReq)
                    ? (rawReq as Record<string, unknown>).model
                    : undefined);
            const rawSelected = plannerConfig?.planModel || plannerConfig?.modelName || reqModel;
            const selected = isConcreteModelString(rawSelected) ? rawSelected.trim() : '';
            const planExecuteConfig = plannerConfig?.planExecuteConfig as Record<string, unknown> | undefined;
            const rawExec = planExecuteConfig?.executionModel;
            const executionModel = isConcreteModelString(rawExec) ? rawExec.trim() : '';
            if (selected) {
                model = selected;
                const normSelected = resolveModelId(selected) || selected;
                const normExec = executionModel ? (resolveModelId(executionModel) || executionModel) : '';
                const segStep = explicitStepIdx ?? globalStepIdx;
                const prevSeg = orchestratorHistory[orchestratorHistory.length - 1];
                if (!prevSeg
                    || (resolveModelId(prevSeg.planModel) || prevSeg.planModel) !== normSelected
                    || (prevSeg.executionModel ? (resolveModelId(prevSeg.executionModel) || prevSeg.executionModel) : '') !== normExec) {
                    orchestratorHistory.push({
                        startStepIndex: segStep,
                        planModel: selected,
                        executionModel: executionModel || '',
                    });
                }
                if (executionModel && normExec !== normSelected) {
                    orchestratorConfig = { planModel: selected, executionModel };
                } else {
                    orchestratorConfig = undefined;
                }
            }
        }

        // Count planner response steps
        if (stepType === StepType.PLANNER_RESPONSE && !imageStep) {
            estimationOverhead += processPlannerResponseStep(step);
        }

        // Extract modelUsage from CHECKPOINT steps
        // Payload-less legacy checkpoints carry measured context snapshots.
        // Modern checkpoints carry the separate summarizer's usage, including
        // for intent-only, failed, and in-flight summaries.
        if (stepType === StepType.CHECKPOINT && meta && !isPlainRecord(step.checkpoint)) {
            const usage = extractModelUsage(meta);
            if (usage) {
                // Detect compression by comparing consecutive checkpoint inputTokens on the same model & branch
                const checkpointInput = usage.inputTokens + usage.cacheReadTokens + (usage.cacheCreationTokens || 0);
                const ckptModelKey = canonicalModelKey(usage.model) || canonicalModelKey(stepModel);
                if (checkpointInput > 0) {
                    const forwardOrder = explicitStepIdx === null
                        || prevCheckpoint?.stepIndex === null
                        || prevCheckpoint === null
                        || explicitStepIdx > prevCheckpoint.stepIndex;
                    const sameModel = prevCheckpoint !== null && prevCheckpoint.model === ckptModelKey;
                    if (
                        prevCheckpoint
                        && prevCheckpoint.branch === stepBranch
                        && sameModel
                        && forwardOrder
                        && checkpointInput < prevCheckpoint.inputTokens
                    ) {
                        const drop = prevCheckpoint.inputTokens - checkpointInput;
                        if (drop > COMPRESSION_MIN_DROP) {
                            checkpointCompressionDetected = true;
                            checkpointCompressionDrop = drop;
                        }
                    }
                    prevCheckpoint = {
                        model: ckptModelKey,
                        role: 'checkpoint',
                        branch: stepBranch,
                        inputTokens: checkpointInput,
                        stepIndex: explicitStepIdx,
                    };
                }

                lastModelUsage = usage;
                tokenUsageSource = 'checkpoint';
                checkpointModel = usage.model;
                estimationOverhead = 0;
                outputTokensSinceCheckpoint = 0;
            }
        }

        // Current agy trajectories report usage directly on the planner step,
        // often with no CHECKPOINT at all. This is a full context snapshot, not
        // an amount to add to previous calls or to the response text estimate.
        if (stepType === StepType.PLANNER_RESPONSE && meta && !imageStep) {
            const usage = extractModelUsage(meta);
            if (usage) {
                pendingCheckpoint = -1;
                // Detect input-drop compaction on modern PLANNER_RESPONSE snapshots ONLY within
                // the same canonical model, same role, and same branch (and forward step order),
                // ignoring delegated Orchestrator sub-executor / subagent steps so model/role/branch
                // switches NEVER trigger false compaction events.
                // Resolve the step's measured model strictly from the step itself
                // (`usage.model` or `meta.generatorModel`), NEVER inheriting a prior
                // step's conversation-level `model` when this step's model is unknown.
                const rawMeasuredModel = isConcreteModelString(usage.model)
                    ? usage.model.trim()
                    : (isConcreteModelString(stepModel) ? stepModel.trim() : '');
                const canonicalMeasuredModel = canonicalModelKey(rawMeasuredModel);
                const stepRole = extractStepRole(step, meta, rawMeasuredModel);

                if (!isDelegatedOrChildRole(stepRole)) {
                    const plannerInput = usage.inputTokens + usage.cacheReadTokens + (usage.cacheCreationTokens || 0);
                    if (plannerInput > 0) {
                        if (canonicalMeasuredModel) {
                            const forwardOrder = explicitStepIdx === null
                                || prevPlanner?.stepIndex === null
                                || prevPlanner === null
                                || explicitStepIdx > prevPlanner.stepIndex;
                            if (
                                prevPlanner
                                && prevPlanner.model === canonicalMeasuredModel
                                && prevPlanner.role === stepRole
                                && prevPlanner.branch === stepBranch
                                && forwardOrder
                                && plannerInput < prevPlanner.inputTokens
                            ) {
                                const drop = prevPlanner.inputTokens - plannerInput;
                                if (drop > COMPRESSION_MIN_DROP) {
                                    checkpointCompressionDetected = true;
                                    checkpointCompressionDrop = drop;
                                }
                            }
                            prevPlanner = {
                                model: canonicalMeasuredModel,
                                role: stepRole,
                                branch: stepBranch,
                                inputTokens: plannerInput,
                                stepIndex: explicitStepIdx,
                            };
                        } else {
                            // Never compare across unknown/unspecified models.
                            prevPlanner = null;
                        }
                    }
                }
                lastModelUsage = usage;
                tokenUsageSource = 'planner';
                estimationOverhead = 0;
                outputTokensSinceCheckpoint = 0;
                if (usage.model && !isDelegatedExecutor(usage.model)) {
                    model = usage.model;
                    maybeClearStaleOrchestrator(usage.model);
                }
            }
        }

        // Detect image generation steps
        if (imageStep && !imageGenStepIndices.has(globalStepIdx)) {
            imageGenStepIndices.add(globalStepIdx);
            imageGenStepCount++;
            const imageModel = imageModelForStep(step, stepModel);
            if (imageModel) { imageGenerationModels.add(imageModel); }
        }

        if (!meta) { continue; }

        const outputTokens = (meta.toolCallOutputTokens as number) || 0;

        if (outputTokens > 0) {
            toolOutputTokens += outputTokens;
            outputTokensSinceCheckpoint += outputTokens;
            stepDetails.push({
                type: stepType,
                toolCallOutputTokens: outputTokens,
                model: stepModel
            });
        }

        // Track the latest model used (for dynamic model switching).
        // Skip CHECKPOINT steps — their generatorModel belongs to internal
        // shadow models (e.g. M50 Flash Lite for title/intent/compression).
        // Display model should only reflect user-facing model selections.
        if (stepModel && stepType !== StepType.CHECKPOINT && !imageStep && !isDelegatedExecutor(stepModel)) {
            model = stepModel;
            maybeClearStaleOrchestrator(stepModel);
        }

        // requestedModel is highest priority (user's explicit selection)
        const rm = meta.requestedModel as Record<string, unknown> | undefined;
        if (!imageStep && typeof rm?.model === 'string' && !isDelegatedExecutor(rm.model)) {
            model = rm.model;
            maybeClearStaleOrchestrator(rm.model);
        }
    }

    const estimatedDelta = outputTokensSinceCheckpoint + estimationOverhead;
    // CHECKPOINT.modelUsage measures the summarizer's input. Only a later
    // planner call measures the resulting context. Use the dashboard's same
    // post-checkpoint estimator until then, including any new tool/user steps.
    let postCompactionEstimate: number | undefined;
    if (pendingCheckpoint >= 0) {
        const snapshot = parseContextBreakdown({ steps: steps.slice(pendingCheckpoint), model });
        postCompactionEstimate = snapshot.usedTokens;
        lastModelUsage = null;
    }

    // Priority 1: Use the latest measured input + output snapshot and subsequent estimated delta
    if (lastModelUsage) {
        return {
            tokenUsageSource,
            inputTokens: lastModelUsage.inputTokens,
            totalOutputTokens: lastModelUsage.outputTokens,
            totalToolCallOutputTokens: toolOutputTokens,
            contextUsed: lastModelUsage.inputTokens + lastModelUsage.cacheReadTokens
                + (lastModelUsage.cacheCreationTokens || 0) + lastModelUsage.outputTokens + estimatedDelta,
            isEstimated: estimatedDelta > 0,
            model,
            stepDetails,
            lastModelUsage,
            estimatedDeltaSinceCheckpoint: estimatedDelta,
            imageGenStepCount,
            imageGenerationModels: [...imageGenerationModels],
            linkedSubagentCascadeIds: extractLinkedSubagentIds(steps),
            hasGaps: false,
            checkpointCompressionDetected,
            checkpointCompressionDrop,
            checkpointModel,
            ...(orchestratorConfig ? { orchestratorConfig } : {}),
            ...(orchestratorHistory.length > 0 ? { orchestratorHistory } : {}),
        };
    }

    // Fallback: estimate total context window usage.
    // A brand-new 0-step conversation has zero context occupancy until its first turn begins.
    const estimatedTotal = postCompactionEstimate ?? (steps.length === 0
        ? 0
        : outputTokensSinceCheckpoint + SYSTEM_PROMPT_OVERHEAD + estimationOverhead);

    return {
        tokenUsageSource: 'estimated',
        postCompactionPending: pendingCheckpoint >= 0,
        inputTokens: 0,
        totalOutputTokens: 0,
        totalToolCallOutputTokens: toolOutputTokens,
        contextUsed: estimatedTotal,
        isEstimated: true,
        model,
        stepDetails,
        lastModelUsage: null,
        estimatedDeltaSinceCheckpoint: estimatedTotal,
        imageGenStepCount,
        imageGenerationModels: [...imageGenerationModels],
        linkedSubagentCascadeIds: extractLinkedSubagentIds(steps),
        hasGaps: false,
        checkpointCompressionDetected: pendingCheckpoint >= 0,
        checkpointCompressionDrop: 0,
        checkpointModel: '',
        ...(orchestratorConfig ? { orchestratorConfig } : {}),
        ...(orchestratorHistory.length > 0 ? { orchestratorHistory } : {}),
    };
}

/** True when a Connect-RPC error indicates an unimplemented or removed endpoint (HTTP 404/501). */
export function isRpcUnimplementedError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err ?? '');
    return /\bHTTP\s+(?:404|501)\b/i.test(message) || /\bunimplemented\b/i.test(message);
}

const MAX_STEP_FETCH_PAGES = 10_000;
const MAX_GENERATOR_METADATA_ENTRIES = 100_000;
const MAX_SUFFIX_RECOVERY_PROBES = 8;
const MIN_POLL_BUDGET_FOR_HEADROOM_CAP_BYTES = 4 * 1024;

function isOversizeRpcError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err ?? '');
    return /RPC response exceeded \d+ bytes/i.test(message);
}

function isTrajectoryByteBudgetError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err ?? '');
    return /Trajectory poll byte budget exhausted/i.test(message);
}

function isTrajectoryPollBudgetError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err ?? '');
    return /Trajectory poll (?:byte )?budget exhausted/i.test(message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isValidGeneratorMetadataEntry(item: unknown): item is RawGeneratorMetadataEntry {
    if (!isPlainRecord(item)) { return false; }
    if (item.stepIndices !== undefined) {
        if (!Array.isArray(item.stepIndices)) { return false; }
        for (const idx of item.stepIndices) {
            if (parseGeneratorStepIndex(idx) === null) { return false; }
        }
    }
    if (item.chatModel !== undefined) {
        if (!isPlainRecord(item.chatModel)) { return false; }
        if (item.chatModel.promptSections !== undefined) {
            if (!Array.isArray(item.chatModel.promptSections)) { return false; }
            for (const sec of item.chatModel.promptSections) {
                if (!isPlainRecord(sec)) { return false; }
            }
        }
        if (item.chatModel.usage !== undefined && !isPlainRecord(item.chatModel.usage)) {
            return false;
        }
    }
    return true;
}

/**
 * Fetch raw GetCascadeTrajectoryGeneratorMetadata entries with an explicit `ok` flag
 * so callers can distinguish a genuine empty result from an RPC/payload failure or
 * filtered malformed entries without latching incomplete data into cache.
 */
export async function fetchTrajectoryGeneratorMetadataResult(
    ls: LSInfo,
    cascadeId: string,
    signal?: AbortSignal,
    timeoutMs = 15_000,
): Promise<FetchTrajectoryGeneratorMetadataResult> {
    try {
        const resp = await rpcCall(ls, 'GetCascadeTrajectoryGeneratorMetadata', {
            cascadeId,
            metadata: { ideName: 'antigravity', extensionName: 'antigravity' },
        }, timeoutMs, signal);
        if (!isPlainRecord(resp)) {
            return { ok: false, metadata: [], error: 'Invalid GetCascadeTrajectoryGeneratorMetadata response' };
        }
        const raw = resp.generatorMetadata;
        if (raw === undefined) {
            // Proto3 omits genuinely empty repeated fields (`{}`), whereas an error envelope
            // without `generatorMetadata` is inconclusive/failed.
            if ('error' in resp || 'code' in resp) {
                return { ok: false, metadata: [], error: 'Error payload in GetCascadeTrajectoryGeneratorMetadata response' };
            }
            return { ok: true, metadata: [] };
        }
        if (!Array.isArray(raw)) {
            return { ok: false, metadata: [], error: 'Invalid generatorMetadata payload' };
        }
        if (raw.length > MAX_GENERATOR_METADATA_ENTRIES) {
            return { ok: false, metadata: [], error: `generatorMetadata exceeded maximum safe bound (${MAX_GENERATOR_METADATA_ENTRIES})` };
        }
        const metadata: RawGeneratorMetadataEntry[] = [];
        let invalidCount = 0;
        for (const item of raw) {
            if (isValidGeneratorMetadataEntry(item)) {
                metadata.push(item.stepIndices?.some(idx => typeof idx !== 'number')
                    ? { ...item, stepIndices: item.stepIndices.map(Number) }
                    : item);
            } else {
                invalidCount++;
            }
        }
        if (invalidCount > 0) {
            return {
                ok: false,
                metadata,
                error: `Filtered ${invalidCount} malformed generatorMetadata ${invalidCount === 1 ? 'entry' : 'entries'}`,
            };
        }
        return { ok: true, metadata };
    } catch (err) {
        if (signal?.aborted) { throw err; }
        const message = err instanceof Error ? err.message : String(err ?? 'Unknown GM metadata error');
        return { ok: false, metadata: [], error: message };
    }
}

/**
 * Fetch raw GetCascadeTrajectoryGeneratorMetadata entries without stripping
 * `chatModel.promptSections` (`{ title, tokenType, contentLen }`) or `chatModel.usage`.
 * Gracefully degrades to `[]` on 501/404 or transient errors.
 */
export async function fetchTrajectoryGeneratorMetadata(
    ls: LSInfo,
    cascadeId: string,
    signal?: AbortSignal,
): Promise<RawGeneratorMetadataEntry[]> {
    const result = await fetchTrajectoryGeneratorMetadataResult(ls, cascadeId, signal);
    return result.metadata;
}

interface ValidatedStepsPage {
    ok: boolean;
    steps: Array<Record<string, unknown>>;
    stepIndexMismatch: boolean;
    error?: string;
}

/** A manifest identifies a member but cannot establish its step count. Start at the
 * last indexed generator step and verify the end of the trajectory with bounded
 * tail reads. Empty, failed, malformed or oversized probes are not new chats. */
export async function readUnlistedMemberStepCount(
    ls: LSInfo, cascadeId: string, signal?: AbortSignal,
    fetchMetadata = fetchTrajectoryGeneratorMetadataResult,
): Promise<number | null> {
    const gm = await fetchMetadata(ls, cascadeId, signal);
    if (!gm.ok) { return null; }
    let offset = 0;
    for (const entry of gm.metadata) {
        for (const index of entry.stepIndices ?? []) { offset = Math.max(offset, Number(index) + 1); }
    }
    for (let page = 0; page < 3 && offset <= MAX_TRAJECTORY_STEPS; page++) {
        const response = await rpcCall(ls, 'GetCascadeTrajectorySteps', {
            cascadeId, stepOffset: offset, startIndex: offset, endIndex: offset + 32,
        }, 4_000, signal, { maxResponseBytes: 1024 * 1024 });
        const tail = validateStepsPageResponse(response, offset);
        if (!tail.ok) { return null; }
        if (!tail.steps.length) { return offset > 0 ? offset : null; }
        offset += tail.steps.length;
    }
    return null;
}

/** Preserve transport failures for the GM tracker's retry policy. */
export function requireGeneratorMetadata(result: FetchTrajectoryGeneratorMetadataResult): RawGeneratorMetadataEntry[] {
    if (!result.ok) { throw new Error(result.error || 'Generator metadata unavailable'); }
    return result.metadata;
}

export function validateStepsPageResponse(resp: unknown, expectedStart: number): ValidatedStepsPage {
    if (!isPlainRecord(resp)) {
        return {
            ok: false,
            steps: [],
            stepIndexMismatch: false,
            error: `Invalid steps response object at offset ${expectedStart}`,
        };
    }
    const rawSteps = resp.steps;
    if (rawSteps === undefined) {
        if ('error' in resp || 'code' in resp) {
            return {
                ok: false,
                steps: [],
                stepIndexMismatch: false,
                error: `Error payload in steps batch at offset ${expectedStart}`,
            };
        }
        // Proto3 omits empty repeated `steps` field; caller treats 0 steps for a needed range as empty/gap.
        return { ok: true, steps: [], stepIndexMismatch: false };
    }
    if (!Array.isArray(rawSteps)) {
        return {
            ok: false,
            steps: [],
            stepIndexMismatch: false,
            error: `Invalid steps payload at offset ${expectedStart}`,
        };
    }
    if (rawSteps.length > MAX_TRAJECTORY_STEPS) {
        return {
            ok: false,
            steps: [],
            stepIndexMismatch: false,
            error: `Steps page exceeded maximum safe bound (${MAX_TRAJECTORY_STEPS}) at offset ${expectedStart}`,
        };
    }

    const validSteps: Array<Record<string, unknown>> = [];
    let invalidCount = 0;
    let stepIndexMismatch = false;
    let stepIndexError: string | undefined;

    for (let i = 0; i < rawSteps.length; i++) {
        const entry = rawSteps[i];
        if (!isPlainRecord(entry)) {
            invalidCount++;
            continue;
        }
        if (entry.stepIndex !== undefined) {
            const idx = entry.stepIndex;
            if (typeof idx !== 'number' || !Number.isSafeInteger(idx) || idx < 0 || idx > MAX_TRAJECTORY_STEPS) {
                invalidCount++;
                continue;
            }
            if (idx !== expectedStart + i) {
                stepIndexMismatch = true;
                if (!stepIndexError) {
                    stepIndexError = `Non-contiguous stepIndex ${idx} at expected offset ${expectedStart + i}`;
                }
            }
        }
        validSteps.push(entry);
    }

    if (invalidCount > 0) {
        return {
            ok: false,
            steps: validSteps,
            stepIndexMismatch,
            error: `Filtered ${invalidCount} malformed step ${invalidCount === 1 ? 'entry' : 'entries'} at offset ${expectedStart}`,
        };
    }
    if (stepIndexMismatch) {
        return {
            ok: false,
            steps: validSteps,
            stepIndexMismatch: true,
            error: stepIndexError,
        };
    }
    return { ok: true, steps: validSteps, stepIndexMismatch: false };
}

/**
 * Fetch trajectory steps across both legacy `startIndex`/`endIndex` servers
 * and Antigravity v2.34+ `stepOffset` hubs without dropping short pages, duplicating
 * overlapping batches, OOMing on >50MB conversations, or masking malformed/empty pages as complete.
 * When page 0 hits a response-size or byte-budget cap on a large conversation, runs a bounded
 * suffix recovery probe (`<= 8` sequential probes) to retrieve the earliest fitting live tail
 * `[suffixStartOffset .. totalSteps)` while preserving poll headroom for downstream metadata.
 * Returns `{ ok, steps, hasGaps, suffixStartOffset?, error? }` so callers distinguish genuine empty
 * from RPC errors, mid-conversation gaps, and live-tail suffix recovery.
 */
export async function fetchTrajectorySteps(
    ls: LSInfo,
    cascadeId: string,
    totalSteps: number,
    signal?: AbortSignal,
    options?: FetchTrajectoryStepsOptions,
): Promise<FetchTrajectoryStepsResult> {
    if (
        typeof totalSteps !== 'number'
        || !Number.isSafeInteger(totalSteps)
        || totalSteps < 0
        || totalSteps > MAX_TRAJECTORY_STEPS
    ) {
        return {
            ok: false,
            steps: [],
            hasGaps: true,
            error: `Invalid totalSteps count: ${String(totalSteps)}`,
        };
    }
    if (totalSteps === 0) {
        return { ok: true, steps: [], hasGaps: false };
    }

    const baseMaxResponseBytes = typeof options?.maxResponseBytes === 'number'
        && Number.isFinite(options.maxResponseBytes)
        && options.maxResponseBytes > 0
        ? Math.min(Math.floor(options.maxResponseBytes), MAX_RESPONSE_BODY_SIZE)
        : MAX_RESPONSE_BODY_SIZE;
    const maxSuffixProbes = typeof options?.maxSuffixProbes === 'number'
        && Number.isFinite(options.maxSuffixProbes)
        && options.maxSuffixProbes >= 1
        ? Math.min(Math.floor(options.maxSuffixProbes), MAX_SUFFIX_RECOVERY_PROBES)
        : MAX_SUFFIX_RECOVERY_PROBES;

    const allSteps: Array<Record<string, unknown>> = [];
    const appendSteps = (dst: Array<Record<string, unknown>>, src: readonly Record<string, unknown>[]): void => {
        for (let i = 0; i < src.length; i++) { dst.push(src[i]); }
    };
    const isSizeErr = (err: unknown): boolean => isOversizeRpcError(err) || isTrajectoryByteBudgetError(err);
    const maxBoundMsg = (off: number): string => `Accumulated steps exceeded maximum safe bound (${MAX_TRAJECTORY_STEPS}) at offset ${off}`;
    let hasGaps = false;
    let firstError: string | undefined;
    let pagesFetched = 0;

    const recordError = (msg: string): void => {
        hasGaps = true;
        if (!firstError) { firstError = msg; }
    };

    const fetchBatch = (
        { start, end }: { start: number; end: number },
        maxResponseBytes?: number,
    ) => {
        const cap = maxResponseBytes !== undefined ? maxResponseBytes : baseMaxResponseBytes;
        return rpcCall(ls, 'GetCascadeTrajectorySteps', {
            cascadeId,
            startIndex: start,
            endIndex: end,
            stepOffset: start,
        }, 30000, signal, cap < MAX_RESPONSE_BODY_SIZE ? { maxResponseBytes: cap } : undefined);
    };

    const logBatchError = (start: number, end: number, err: unknown): string => {
        if (!isRpcUnimplementedError(err)) {
            console.warn(`[ContextMonitor] Failed to fetch steps batch [${start}-${end}] for cascade ${cascadeId.substring(0, 8)}: ${err}`);
        }
        return err instanceof Error ? err.message : String(err ?? 'Unknown steps batch error');
    };

    const fetchSequentialRange = async (
        startOffset: number,
        targetEnd: number,
        allowExceedTargetEnd: boolean,
        maxResponseBytes?: number,
        existingCount = allSteps.length,
        minReserveRequests = 0,
        minReserveBytes = 0,
    ): Promise<{ ok: boolean; covered: number; steps: Array<Record<string, unknown>>; error?: string; budgetExhausted?: boolean }> => {
        const collected: Array<Record<string, unknown>> = [];
        let cursor = startOffset;
        const fail = (error: string, budgetExhausted?: boolean, covered = cursor) =>
            ({ ok: false, covered, steps: collected, ...(budgetExhausted ? { budgetExhausted: true } : {}), error });

        while (cursor < targetEnd) {
            if (signal?.aborted) { throw new Error('RPC aborted'); }
            let reqMaxBytes = maxResponseBytes;
            if (minReserveRequests > 0 || minReserveBytes > 0) {
                const snap = getTrajectoryPollBudgetSnapshot();
                if (snap) {
                    if (
                        (minReserveRequests > 0 && snap.effectiveRequestsLeft <= minReserveRequests)
                        || snap.remainingMs <= 100
                    ) {
                        return fail(`Reserved poll budget for live tail recovery at offset ${cursor}`, true);
                    }
                    if (minReserveBytes > 0) {
                        const availBytes = snap.effectiveBytesLeft - minReserveBytes;
                        if (availBytes <= 0) {
                            return fail(`Reserved byte budget for live tail recovery at offset ${cursor}`, true);
                        }
                        reqMaxBytes = Math.min(reqMaxBytes ?? baseMaxResponseBytes, availBytes);
                    }
                }
            }
            if (pagesFetched >= MAX_STEP_FETCH_PAGES) {
                return fail(`Exceeded maximum step pagination pages (${MAX_STEP_FETCH_PAGES}) at offset ${cursor}`, true);
            }
            const remainingStepCapacity = MAX_TRAJECTORY_STEPS - (existingCount + collected.length);
            if (remainingStepCapacity <= 0) { return fail(maxBoundMsg(cursor)); }
            const reqEnd = Math.min(cursor + STEP_BATCH_SIZE, targetEnd);
            pagesFetched++;
            let resp: Record<string, unknown>;
            try {
                resp = await fetchBatch({ start: cursor, end: reqEnd }, reqMaxBytes);
            } catch (err) {
                if (signal?.aborted) { throw err; }
                return fail(logBatchError(cursor, reqEnd, err), isSizeErr(err) || isTrajectoryPollBudgetError(err));
            }
            const validated = validateStepsPageResponse(resp, cursor);
            if (!validated.ok) {
                if (!validated.stepIndexMismatch) { appendSteps(collected, validated.steps.slice(0, remainingStepCapacity)); }
                return fail(validated.error ?? `Malformed steps page at offset ${cursor}`);
            }
            if (validated.steps.length === 0) { return fail(`Empty steps page at offset ${cursor} (expected up to ${targetEnd})`); }
            const accepted = !allowExceedTargetEnd && cursor + validated.steps.length > targetEnd
                ? validated.steps.slice(0, targetEnd - cursor) : validated.steps;
            if (accepted.length > remainingStepCapacity) {
                appendSteps(collected, accepted.slice(0, remainingStepCapacity));
                return fail(maxBoundMsg(cursor), false, cursor + remainingStepCapacity);
            }
            appendSteps(collected, accepted);
            if (accepted.length <= 0) { return fail(`Steps pagination cursor failed to advance at offset ${cursor}`); }
            cursor += accepted.length;
        }
        return { ok: true, covered: cursor, steps: collected };
    };

    const normalizeSuffixSteps = (
        steps: Array<Record<string, unknown>>,
        startOffset: number,
    ): Array<Record<string, unknown>> => steps.map((s, idx) =>
        typeof s.stepIndex === 'number' && Number.isFinite(s.stepIndex) && s.stepIndex >= 0
            ? s
            : { ...s, stepIndex: startOffset + idx },
    );

    const recoverOversizeSuffix = async (page0Error: string): Promise<FetchTrajectoryStepsResult> => {
        const postPage0Budget = getTrajectoryPollBudgetSnapshot();
        if (
            postPage0Budget
            && (postPage0Budget.effectiveRequestsLeft <= 0
                || postPage0Budget.effectiveBytesLeft <= 0
                || postPage0Budget.remainingMs <= 50)
        ) {
            return { ok: false, steps: [], hasGaps: true, error: page0Error };
        }

        // Preserve downstream headroom (GM metadata / swarm / activity) when inside a poll budget.
        const reserveBytes = postPage0Budget
            ? Math.min(4 * 1024 * 1024, Math.floor(postPage0Budget.effectiveBytesLeft * 0.25))
            : 0;
        const reserveRequests = postPage0Budget && postPage0Budget.effectiveRequestsLeft > 2
            ? Math.min(4, Math.floor(postPage0Budget.effectiveRequestsLeft * 0.25))
            : 0;

        let probesUsed = 0;
        let bestOffset = totalSteps;
        let bestSteps: Array<Record<string, unknown>> = [];
        let bestWireBytes = 0;

        type ProbeOutcome =
            | { kind: 'ok'; steps: Array<Record<string, unknown>>; reachedEnd: boolean; wireBytes: number }
            | { kind: 'too_large' }
            | { kind: 'stop' };

        const tryProbeOffset = async (offset: number, capBytes: number): Promise<ProbeOutcome> => {
            if (signal?.aborted) {
                throw new Error('RPC aborted');
            }
            if (probesUsed >= maxSuffixProbes || pagesFetched >= MAX_STEP_FETCH_PAGES) {
                return { kind: 'stop' };
            }
            const snap = getTrajectoryPollBudgetSnapshot();
            if (snap && (snap.effectiveRequestsLeft <= 0 || snap.effectiveBytesLeft <= 0 || snap.remainingMs <= 50)) {
                return { kind: 'stop' };
            }
            const bytesBefore = snap?.effectiveBytesLeft ?? 0;
            probesUsed++;
            pagesFetched++;
            const reqEnd = Math.min(offset + STEP_BATCH_SIZE, totalSteps);
            let resp: Record<string, unknown>;
            try {
                resp = await fetchBatch({ start: offset, end: reqEnd }, capBytes);
            } catch (probeErr) {
                if (signal?.aborted) { throw probeErr; }
                return isSizeErr(probeErr) ? { kind: 'too_large' } : { kind: 'stop' };
            }
            const validated = validateStepsPageResponse(resp, offset);
            if (!validated.ok || validated.steps.length === 0) {
                return { kind: 'stop' };
            }
            const cappedSteps = validated.steps.length > MAX_TRAJECTORY_STEPS
                ? validated.steps.slice(0, MAX_TRAJECTORY_STEPS)
                : validated.steps;
            const bytesAfter = getTrajectoryPollBudgetSnapshot()?.effectiveBytesLeft ?? 0;
            const wireBytes = snap ? Math.max(0, bytesBefore - bytesAfter) : 0;
            return {
                kind: 'ok',
                steps: cappedSteps,
                reachedEnd: offset + cappedSteps.length >= totalSteps,
                wireBytes,
            };
        };

        const canBridgeGap = (gapStart: number, gapEnd: number, reserveFloor: number, pageSize = STEP_BATCH_SIZE): boolean => {
            const need = Math.ceil(Math.max(0, gapEnd - gapStart) / Math.max(1, Math.min(STEP_BATCH_SIZE, pageSize)));
            const snap = getTrajectoryPollBudgetSnapshot();
            const avail = snap ? Math.max(0, snap.effectiveRequestsLeft - reserveFloor) : (MAX_STEP_FETCH_PAGES - pagesFetched);
            return need <= avail && need <= maxSuffixProbes;
        };

        const runFineGrainedTailSearch = async (fineStart: number, fineEnd: number): Promise<void> => {
            let fineLo = fineStart;
            let fineHi = fineEnd;
            while (fineLo <= fineHi && probesUsed < maxSuffixProbes) {
                const snap = getTrajectoryPollBudgetSnapshot();
                const hasTail = bestSteps.length > 0;
                let fineCap = baseMaxResponseBytes;
                if (snap) {
                    const reqFloor = hasTail ? reserveRequests : 0;
                    const usable = snap.effectiveBytesLeft > reserveBytes
                        ? snap.effectiveBytesLeft - reserveBytes
                        : (hasTail ? 0 : snap.effectiveBytesLeft);
                    if (snap.effectiveRequestsLeft <= reqFloor || usable <= 0 || snap.remainingMs <= 100) {
                        break;
                    }
                    const isFinalCandidate = fineLo === fineHi || probesUsed + 1 >= maxSuffixProbes || (!hasTail && snap.effectiveRequestsLeft <= 1);
                    const share = isFinalCandidate ? usable : Math.max(1, Math.floor(usable * 0.6));
                    fineCap = Math.min(baseMaxResponseBytes, share);
                    if (hasTail && bestWireBytes > 0 && fineCap <= bestWireBytes) {
                        break;
                    }
                }
                const isLastProbe = (!hasTail && ((snap ? snap.effectiveRequestsLeft <= 1 : (MAX_STEP_FETCH_PAGES - pagesFetched <= 1)) || probesUsed + 1 >= maxSuffixProbes));
                const fineMid = isLastProbe ? fineHi : Math.floor((fineLo + fineHi) / 2);
                const probe = await tryProbeOffset(fineMid, fineCap);
                if (probe.kind === 'ok') {
                    if (probe.reachedEnd) {
                        bestOffset = fineMid;
                        bestSteps = probe.steps;
                        bestWireBytes = probe.wireBytes;
                        fineHi = fineMid - 1;
                    } else if (bestSteps.length > 0 && fineMid + probe.steps.length >= bestOffset) {
                        const prefix = probe.steps.slice(0, bestOffset - fineMid);
                        if (prefix.length + bestSteps.length <= MAX_TRAJECTORY_STEPS) {
                            bestOffset = fineMid;
                            bestSteps = [...prefix, ...bestSteps];
                            fineHi = fineMid - 1;
                        } else {
                            break;
                        }
                    } else {
                        const tailEnd = bestSteps.length > 0 ? bestOffset : totalSteps;
                        const bridgeStart = fineMid + probe.steps.length;
                        const postSnap = getTrajectoryPollBudgetSnapshot();
                        const resReq = bestSteps.length > 0 ? reserveRequests : (postSnap && postSnap.effectiveRequestsLeft > 1 ? 1 : 0);
                        if (!canBridgeGap(bridgeStart, tailEnd, resReq, probe.steps.length)) {
                            fineLo = fineMid + 1;
                            continue;
                        }
                        const bridge = await fetchSequentialRange(
                            bridgeStart,
                            tailEnd,
                            bestSteps.length === 0,
                            fineCap,
                            probe.steps.length + bestSteps.length,
                            resReq,
                        );
                        if (bridge.ok && bridge.covered >= tailEnd) {
                            bestOffset = fineMid;
                            bestSteps = bestSteps.length > 0
                                ? [...probe.steps, ...bridge.steps, ...bestSteps]
                                : [...probe.steps, ...bridge.steps];
                            fineHi = fineMid - 1;
                        } else {
                            fineLo = fineMid + 1;
                        }
                    }
                } else if (probe.kind === 'too_large') {
                    fineLo = fineMid + 1;
                } else {
                    break;
                }
            }
        };

        const alignedOffsets: number[] = [];
        for (let off = STEP_BATCH_SIZE; off < totalSteps; off += STEP_BATCH_SIZE) {
            alignedOffsets.push(off);
        }

        if (alignedOffsets.length > 0) {
            // 1. Anchor the live tail first at the final aligned bucket (1..STEP_BATCH_SIZE steps)
            //    so we obtain a usable suffix immediately before spending budget on earlier probes.
            const anchorIdx = alignedOffsets.length - 1;
            const anchorOffset = alignedOffsets[anchorIdx];
            const anchorSnap = getTrajectoryPollBudgetSnapshot();
            const anchorUsable = anchorSnap
                ? (anchorSnap.effectiveBytesLeft > reserveBytes
                    ? anchorSnap.effectiveBytesLeft - reserveBytes
                    : anchorSnap.effectiveBytesLeft)
                : baseMaxResponseBytes;
            const anchorCap = Math.min(baseMaxResponseBytes, Math.max(1, anchorUsable));
            const anchorProbe = await tryProbeOffset(anchorOffset, anchorCap);

            if (anchorProbe.kind === 'ok') {
                if (anchorProbe.reachedEnd) {
                    bestOffset = anchorOffset;
                    bestSteps = anchorProbe.steps;
                    bestWireBytes = anchorProbe.wireBytes;
                } else {
                    const gapStart = anchorOffset + anchorProbe.steps.length;
                    const postAnchorSnap = getTrajectoryPollBudgetSnapshot();
                    const anchorTailReserve = postAnchorSnap
                        ? (postAnchorSnap.effectiveRequestsLeft > 2 ? 2 : (postAnchorSnap.effectiveRequestsLeft > 1 ? 1 : 0))
                        : 0;
                    if (canBridgeGap(gapStart, totalSteps, anchorTailReserve, anchorProbe.steps.length)) {
                        const tailRest = await fetchSequentialRange(
                            gapStart,
                            totalSteps,
                            true,
                            anchorCap,
                            anchorProbe.steps.length,
                            anchorTailReserve,
                        );
                        if (tailRest.ok && tailRest.covered >= totalSteps) {
                            bestOffset = anchorOffset;
                            bestSteps = [...anchorProbe.steps, ...tailRest.steps];
                        } else if (anchorOffset + 1 < totalSteps) {
                            await runFineGrainedTailSearch(Math.max(anchorOffset + 1, tailRest.covered), totalSteps - 1);
                        }
                    } else if (anchorOffset + 1 < totalSteps) {
                        const directTailOffset = Math.max(gapStart, totalSteps - Math.max(1, anchorProbe.steps.length));
                        const directProbe = await tryProbeOffset(directTailOffset, anchorCap);
                        if (directProbe.kind === 'ok' && directProbe.reachedEnd) {
                            bestOffset = directTailOffset;
                            bestSteps = directProbe.steps;
                            bestWireBytes = directProbe.wireBytes;
                        } else {
                            const nextStart = directProbe.kind === 'ok'
                                ? Math.min(totalSteps - 1, directTailOffset + directProbe.steps.length)
                                : Math.min(totalSteps - 1, directTailOffset + 1);
                            await runFineGrainedTailSearch(nextStart, totalSteps - 1);
                        }
                    }
                }

                // 2. Binary-search earlier aligned offsets `[0 .. anchorIdx - 1]` ONLY when we hold a complete live tail.
                let lo = 0;
                let hi = bestSteps.length > 0 && bestOffset + bestSteps.length >= totalSteps ? anchorIdx - 1 : -1;
                while (lo <= hi && probesUsed < maxSuffixProbes) {
                    const snap = getTrajectoryPollBudgetSnapshot();
                    let midCap = baseMaxResponseBytes;
                    if (snap) {
                        const usableBytes = snap.effectiveBytesLeft - reserveBytes;
                        if (snap.effectiveRequestsLeft <= reserveRequests || usableBytes <= 0 || snap.remainingMs <= 150) {
                            break;
                        }
                        if (bestWireBytes > 0 && usableBytes <= bestWireBytes) {
                            break;
                        }
                        midCap = Math.min(baseMaxResponseBytes, Math.max(1, Math.floor(usableBytes * 0.6)));
                        if (bestWireBytes > 0 && midCap <= bestWireBytes) {
                            break;
                        }
                    }

                    const mid = Math.floor((lo + hi) / 2);
                    const midOffset = alignedOffsets[mid];
                    const probe = await tryProbeOffset(midOffset, midCap);
                    if (probe.kind === 'ok') {
                        if (probe.reachedEnd) {
                            bestOffset = midOffset;
                            bestSteps = probe.steps;
                            bestWireBytes = probe.wireBytes;
                            hi = mid - 1;
                        } else {
                            // Paginated server respected endIndex; bridge strictly `[midOffset + got .. bestOffset)`
                            // without re-fetching or duplicating the already-captured live tail `bestSteps`.
                            const gapStart = midOffset + probe.steps.length;
                            if (gapStart >= bestOffset) {
                                const prefix = gapStart > bestOffset
                                    ? probe.steps.slice(0, bestOffset - midOffset)
                                    : probe.steps;
                                if (prefix.length + bestSteps.length <= MAX_TRAJECTORY_STEPS) {
                                    bestOffset = midOffset;
                                    bestSteps = [...prefix, ...bestSteps];
                                    hi = mid - 1;
                                } else {
                                    break;
                                }
                            } else {
                                if (!canBridgeGap(gapStart, bestOffset, reserveRequests, probe.steps.length)) {
                                    lo = mid + 1;
                                    continue;
                                }
                                const bridge = await fetchSequentialRange(
                                    gapStart,
                                    bestOffset,
                                    false,
                                    midCap,
                                    probe.steps.length + bestSteps.length,
                                    reserveRequests,
                                );
                                if (bridge.ok && bridge.covered === bestOffset) {
                                    bestOffset = midOffset;
                                    bestSteps = [...probe.steps, ...bridge.steps, ...bestSteps];
                                    hi = mid - 1;
                                } else {
                                    lo = mid + 1;
                                }
                            }
                        }
                    } else if (probe.kind === 'too_large') {
                        lo = mid + 1;
                    } else {
                        break;
                    }
                }
            } else if (anchorProbe.kind === 'too_large' && anchorOffset + 1 < totalSteps) {
                // Even the final aligned bucket exceeded the cap; shrink inside `(anchorOffset .. totalSteps - 1]`.
                await runFineGrainedTailSearch(anchorOffset + 1, totalSteps - 1);
            }
        } else if (totalSteps > 1) {
            await runFineGrainedTailSearch(1, totalSteps - 1);
        }

        if (bestSteps.length > 0 && bestOffset + bestSteps.length >= totalSteps) {
            return {
                ok: false,
                steps: normalizeSuffixSteps(bestSteps, bestOffset),
                hasGaps: true,
                suffixRecovered: true,
                suffixStartOffset: bestOffset,
                error: page0Error,
            };
        }
        return { ok: false, steps: [], hasGaps: true, error: page0Error };
    };

    const tryTailRecovery = async (reason: string): Promise<FetchTrajectoryStepsResult | null> => {
        if (totalSteps <= 1) { return null; }
        const rec = await recoverOversizeSuffix(reason);
        return rec.suffixRecovered && rec.steps.length > 0 ? rec : null;
    };

    // Always probe page 0 first:
    const firstRange = { start: 0, end: Math.min(STEP_BATCH_SIZE, totalSteps) };
    const initialBudget = getTrajectoryPollBudgetSnapshot();
    let page0MaxBytes = baseMaxResponseBytes;
    if (
        initialBudget
        && totalSteps > 1
        && initialBudget.effectiveBytesLeft >= MIN_POLL_BUDGET_FOR_HEADROOM_CAP_BYTES
    ) {
        const headroomCap = Math.floor(initialBudget.effectiveBytesLeft * 0.6);
        if (headroomCap > 0 && headroomCap < page0MaxBytes) {
            page0MaxBytes = headroomCap;
        }
    }

    pagesFetched++;
    let firstResp: Record<string, unknown>;
    try {
        firstResp = await fetchBatch(firstRange, page0MaxBytes);
    } catch (err) {
        if (signal?.aborted) { throw err; }
        const message = logBatchError(firstRange.start, firstRange.end, err);
        if (totalSteps > 1 && isSizeErr(err)) {
            return recoverOversizeSuffix(message);
        }
        return { ok: false, steps: [], hasGaps: true, error: message };
    }

    const firstPage = validateStepsPageResponse(firstResp, 0);
    if (!firstPage.ok) {
        return {
            ok: false,
            steps: firstPage.stepIndexMismatch ? [] : firstPage.steps,
            hasGaps: true,
            error: firstPage.error ?? 'Malformed steps page at offset 0',
        };
    }
    if (firstPage.steps.length === 0) {
        return {
            ok: false,
            steps: [],
            hasGaps: true,
            error: `Empty steps page at offset 0 (expected ${totalSteps})`,
        };
    }

    appendSteps(allSteps, firstPage.steps);
    let contiguousCovered = firstPage.steps.length;
    if (contiguousCovered >= totalSteps) {
        return { ok: true, steps: allSteps, hasGaps: false };
    }

    // Check up front if full pagination exceeds page or active poll request budget:
    // recover the live tail suffix immediately while budget remains instead of exhausting
    // requests on the prefix `[0..1200)` and starving the tail every poll (Issue #79).
    const postPage0Snap = getTrajectoryPollBudgetSnapshot();
    const prefixTailReserveBytes = postPage0Snap
        ? Math.min(4 * 1024 * 1024, Math.floor(postPage0Snap.effectiveBytesLeft * 0.25))
        : 0;
    const estRemainingPages = Math.ceil((totalSteps - contiguousCovered) / Math.max(1, contiguousCovered));
    if (
        estRemainingPages > MAX_STEP_FETCH_PAGES - pagesFetched
        || (postPage0Snap !== null && estRemainingPages > Math.max(1, postPage0Snap.effectiveRequestsLeft - 2))
    ) {
        const budgetReason = `Step pagination requires ~${estRemainingPages} pages beyond budget`;
        const recovered = await tryTailRecovery(budgetReason);
        if (recovered) { return recovered; }
    }

    // Short first page (< STEP_BATCH_SIZE) OR oversized first page (> STEP_BATCH_SIZE):
    // paginate sequentially, reserving 2 requests + tail bytes for recovery if poll budget runs low.
    if (contiguousCovered !== firstRange.end) {
        const rest = await fetchSequentialRange(
            contiguousCovered,
            totalSteps,
            true,
            undefined,
            allSteps.length,
            postPage0Snap ? 2 : 0,
            prefixTailReserveBytes,
        );
        appendSteps(allSteps, rest.steps);
        if (!rest.ok) {
            recordError(rest.error ?? `Incomplete steps pagination after offset ${rest.covered}`);
        } else {
            contiguousCovered = rest.covered;
        }
        if (contiguousCovered < totalSteps) {
            recordError(`Incomplete step coverage: got ${contiguousCovered} of ${totalSteps}`);
            if (rest.budgetExhausted) {
                const recovered = await tryTailRecovery(firstError || 'Sequential step pagination exhausted budget');
                if (recovered) { return recovered; }
            }
        }
        return {
            ok: !hasGaps,
            steps: allSteps,
            hasGaps,
            ...(firstError ? { error: firstError } : {}),
        };
    }

    // First page covered exact STEP_BATCH_SIZE: plan remaining ranges and fetch in bounded concurrent groups.
    const pageSize = contiguousCovered;
    const remainingRanges: Array<{ start: number; end: number }> = [];
    for (let start = pageSize; start < totalSteps; start += pageSize) {
        remainingRanges.push({ start, end: Math.min(start + pageSize, totalSteps) });
        if (remainingRanges.length > MAX_STEP_FETCH_PAGES - pagesFetched) {
            recordError(`Exceeded maximum step pagination pages (${MAX_STEP_FETCH_PAGES})`);
            const recovered = await tryTailRecovery(firstError!);
            if (recovered) { return recovered; }
            return { ok: false, steps: allSteps, hasGaps: true, error: firstError };
        }
    }

    let highestAppendedEnd = contiguousCovered;
    let stopRemainingGroups = false;
    let midPaginationBudgetExhausted = false;
    let switchToSequentialFrom: number | null = null;
    let fallbackRecoveredTail: { offset: number; steps: Array<Record<string, unknown>> } | null = null;

    for (let groupStart = 0; groupStart < remainingRanges.length && !stopRemainingGroups; ) {
        if (signal?.aborted) {
            throw new Error('RPC aborted');
        }
        if (highestAppendedEnd >= totalSteps) {
            break;
        }
        const preGroupSnap = getTrajectoryPollBudgetSnapshot();
        const rangesLeft = remainingRanges.length - groupStart;
        let maxGroupLen = MAX_CONCURRENT_BATCHES;
        let nonFinalCap: number | undefined;
        if (preGroupSnap) {
            const coversTail = rangesLeft <= MAX_CONCURRENT_BATCHES;
            if (
                rangesLeft > preGroupSnap.effectiveRequestsLeft
                || (!coversTail && preGroupSnap.effectiveRequestsLeft <= 2)
                || preGroupSnap.remainingMs <= 100
            ) {
                recordError(`Reserved poll budget for tail recovery with ${rangesLeft} step pages remaining`);
                midPaginationBudgetExhausted = true;
                break;
            }
            if (!coversTail) {
                maxGroupLen = Math.max(1, Math.min(MAX_CONCURRENT_BATCHES, preGroupSnap.effectiveRequestsLeft - 2));
            }
        }
        const group = remainingRanges.slice(groupStart, groupStart + maxGroupLen);
        const nonFinalCount = group.filter(r => r.end < totalSteps).length;
        if (preGroupSnap && nonFinalCount > 0 && prefixTailReserveBytes > 0) {
            const availBytes = preGroupSnap.effectiveBytesLeft - prefixTailReserveBytes;
            if (availBytes <= 0) {
                recordError(`Reserved byte budget for tail recovery with ${rangesLeft} step pages remaining`);
                midPaginationBudgetExhausted = true;
                break;
            }
            nonFinalCap = Math.min(baseMaxResponseBytes, Math.max(1, Math.floor(availBytes / nonFinalCount)));
        }
        pagesFetched += group.length;
        const groupResults = await Promise.allSettled(
            group.map(range => fetchBatch(range, range.end < totalSteps ? nonFinalCap : undefined)),
        );
        const curGroupStart = groupStart;
        groupStart += group.length;

        const captureFallbackTail = (fromIdx: number): { offset: number; steps: Array<Record<string, unknown>> } | null => {
            for (let j = fromIdx; j < groupResults.length; j++) {
                const tailRes = groupResults[j];
                const tailRange = group[j];
                if (tailRes.status !== 'fulfilled' || tailRange.end < totalSteps) { continue; }
                const tailPage = validateStepsPageResponse(tailRes.value, tailRange.start);
                if (!tailPage.ok || tailPage.steps.length === 0) { continue; }
                const tailSteps = tailPage.steps.length > MAX_TRAJECTORY_STEPS
                    ? tailPage.steps.slice(0, MAX_TRAJECTORY_STEPS)
                    : tailPage.steps;
                if (tailRange.start + tailSteps.length >= totalSteps) {
                    return {
                        offset: tailRange.start,
                        steps: normalizeSuffixSteps(tailSteps, tailRange.start),
                    };
                }
            }
            return null;
        };

        for (let i = 0; i < groupResults.length; i++) {
            const result = groupResults[i];
            const { start, end } = group[i];
            const isLastOverall = curGroupStart + i === remainingRanges.length - 1;
            const expectedLen = end - start;

            // Earlier oversized page in this group already covered `[start .. end)` — never duplicate!
            if (end <= highestAppendedEnd) {
                continue;
            }

            if (result.status !== 'fulfilled') {
                if (signal?.aborted) {
                    throw result.reason;
                }
                recordError(logBatchError(start, end, result.reason));
                if (isTrajectoryPollBudgetError(result.reason) || isSizeErr(result.reason)) {
                    const tail = captureFallbackTail(i + 1);
                    if (tail && (!fallbackRecoveredTail || tail.offset < fallbackRecoveredTail.offset)) {
                        fallbackRecoveredTail = tail;
                    }
                    midPaginationBudgetExhausted = true;
                    stopRemainingGroups = true;
                    break;
                }
                continue;
            }

            const page = validateStepsPageResponse(result.value, start);
            if (!page.ok) {
                if (!page.stepIndexMismatch) {
                    const remainingCap = MAX_TRAJECTORY_STEPS - allSteps.length;
                    if (remainingCap > 0) {
                        appendSteps(allSteps, page.steps.slice(0, remainingCap));
                    }
                }
                recordError(page.error ?? `Malformed steps page at offset ${start}`);
                continue;
            }

            if (page.steps.length === 0) {
                recordError(`Empty steps page at offset ${start} (expected ${expectedLen})`);
                continue;
            }

            // Trim any leading overlap if an earlier page in this group extended past `start`.
            const overlap = Math.max(0, highestAppendedEnd - start);
            if (page.steps.length <= overlap) {
                continue;
            }
            const effectiveStart = start + overlap;
            const trimmedSteps = overlap > 0 ? page.steps.slice(overlap) : page.steps;
            const remainingStepCap = MAX_TRAJECTORY_STEPS - allSteps.length;
            if (remainingStepCap <= 0) {
                recordError(maxBoundMsg(effectiveStart));
                stopRemainingGroups = true;
                break;
            }

            // Short page: keep received prefix and repair `[start + got, end)` sequentially before moving on.
            if (start + page.steps.length < end) {
                const safePrefix = trimmedSteps.slice(0, remainingStepCap);
                appendSteps(allSteps, safePrefix);
                if (safePrefix.length < trimmedSteps.length) {
                    recordError(maxBoundMsg(effectiveStart));
                    stopRemainingGroups = true;
                    break;
                }
                const gapStart = start + page.steps.length;
                highestAppendedEnd = Math.max(highestAppendedEnd, gapStart);
                const repaired = await fetchSequentialRange(
                    gapStart,
                    end,
                    isLastOverall,
                    undefined,
                    allSteps.length,
                    postPage0Snap ? 2 : 0,
                    prefixTailReserveBytes,
                );
                appendSteps(allSteps, repaired.steps);
                highestAppendedEnd = Math.max(highestAppendedEnd, repaired.covered);
                if (!repaired.ok || repaired.covered < end) {
                    recordError(repaired.error ?? `Short steps page at offset ${start} (got ${repaired.covered - start} of ${expectedLen})`);
                    if (repaired.budgetExhausted || (repaired.error && isTrajectoryPollBudgetError(repaired.error))) {
                        const tail = captureFallbackTail(i + 1);
                        if (tail && (!fallbackRecoveredTail || tail.offset < fallbackRecoveredTail.offset)) {
                            fallbackRecoveredTail = tail;
                        }
                        midPaginationBudgetExhausted = true;
                        stopRemainingGroups = true;
                        break;
                    }
                } else if (!hasGaps && contiguousCovered === effectiveStart) {
                    contiguousCovered = repaired.covered;
                }
                if (highestAppendedEnd >= totalSteps) {
                    stopRemainingGroups = true;
                    break;
                }
                continue;
            }

            // Server returned MORE than `expectedLen` (e.g. hub ignored `endIndex` and returned a suffix).
            const pageEnd = start + page.steps.length;
            if (pageEnd > end) {
                const safeSteps = trimmedSteps.slice(0, remainingStepCap);
                appendSteps(allSteps, safeSteps);
                const coveredEnd = effectiveStart + safeSteps.length;
                highestAppendedEnd = Math.max(highestAppendedEnd, coveredEnd);
                if (safeSteps.length < trimmedSteps.length) {
                    recordError(`Accumulated steps exceeded maximum safe bound (${MAX_TRAJECTORY_STEPS}) at offset ${effectiveStart}`);
                    stopRemainingGroups = true;
                    break;
                }
                if (!hasGaps && contiguousCovered === effectiveStart) {
                    contiguousCovered = coveredEnd;
                }
                if (coveredEnd >= totalSteps) {
                    stopRemainingGroups = true;
                    break;
                }
                switchToSequentialFrom = coveredEnd;
                stopRemainingGroups = true;
                break;
            }

            const safeAccepted = trimmedSteps.slice(0, remainingStepCap);
            appendSteps(allSteps, safeAccepted);
            const coveredEnd = effectiveStart + safeAccepted.length;
            highestAppendedEnd = Math.max(highestAppendedEnd, coveredEnd);
            if (safeAccepted.length < trimmedSteps.length) {
                recordError(`Accumulated steps exceeded maximum safe bound (${MAX_TRAJECTORY_STEPS}) at offset ${effectiveStart}`);
                stopRemainingGroups = true;
                break;
            }
            if (!hasGaps && contiguousCovered === effectiveStart) {
                contiguousCovered = coveredEnd;
            }
        }
    }

    if (switchToSequentialFrom !== null && switchToSequentialFrom < totalSteps) {
        const tail = await fetchSequentialRange(
            switchToSequentialFrom,
            totalSteps,
            true,
            undefined,
            allSteps.length,
            postPage0Snap ? 2 : 0,
            prefixTailReserveBytes,
        );
        appendSteps(allSteps, tail.steps);
        if (!tail.ok) {
            recordError(tail.error ?? `Incomplete steps pagination after offset ${tail.covered}`);
            if (tail.budgetExhausted) { midPaginationBudgetExhausted = true; }
        } else if (!hasGaps && contiguousCovered === switchToSequentialFrom) {
            contiguousCovered = tail.covered;
        }
    }

    if (contiguousCovered < totalSteps) {
        recordError(`Incomplete step coverage: got ${contiguousCovered} of ${totalSteps}`);
        if (midPaginationBudgetExhausted) {
            const recoveryErr = firstError || `Incomplete step coverage at ${contiguousCovered}/${totalSteps}`;
            const recovered = await tryTailRecovery(recoveryErr);
            if (
                recovered
                && (!fallbackRecoveredTail
                    || (recovered.suffixStartOffset !== undefined && recovered.suffixStartOffset <= fallbackRecoveredTail.offset))
            ) {
                return recovered;
            }
            if (fallbackRecoveredTail) {
                return {
                    ok: false,
                    steps: fallbackRecoveredTail.steps,
                    hasGaps: true,
                    suffixRecovered: true,
                    suffixStartOffset: fallbackRecoveredTail.offset,
                    error: recoveryErr,
                };
            }
        }
    }

    return {
        ok: !hasGaps,
        steps: allSteps,
        hasGaps,
        ...(firstError ? { error: firstError } : {}),
    };
}

/**
 * Get context window usage for a cascade by iterating through steps.
 * Fetches steps in batches from the LS via RPC.
 */
export async function getTrajectoryTokenUsage(
    ls: LSInfo,
    cascadeId: string,
    totalSteps: number,
    signal?: AbortSignal
): Promise<TokenUsageResult> {
    const { ok, steps: allSteps, hasGaps, suffixRecovered, suffixStartOffset } = await fetchTrajectorySteps(ls, cascadeId, totalSteps, signal);
    const result = processSteps(allSteps);
    result.hasGaps = hasGaps || !ok;
    if (
        suffixRecovered
        && suffixStartOffset !== undefined
        && allSteps.length > 0
        && suffixStartOffset + allSteps.length >= totalSteps
    ) {
        result.suffixRecovered = true;
        result.suffixStartOffset = suffixStartOffset;
    }
    if (allSteps.length > 0 && (!result.hasGaps || result.suffixRecovered)) {
        result._fetchedSteps = allSteps;
    }
    return result;
}

/** A member overview needs the last model measurement. Looking at a short
 * contiguous tail first avoids spending the shared poll allowance on old tool
 * outputs. Coverage of the earlier steps remains explicitly incomplete. */
async function getMemberTokenUsage(ls: LSInfo, trajectory: TrajectorySummary, signal?: AbortSignal): Promise<TokenUsageResult> {
    const { cascadeId, stepCount } = trajectory;
    for (const width of [12, 40]) {
        const start = Math.max(0, stepCount - width);
        try {
            const response = await rpcCall(ls, 'GetCascadeTrajectorySteps', {
                cascadeId, stepOffset: start, startIndex: start, endIndex: stepCount,
            }, 4_000, signal, { maxResponseBytes: 2 * 1024 * 1024 });
            const page = validateStepsPageResponse(response, start);
            if (page.ok && page.steps.length === stepCount - start) {
                const steps = page.steps.map((step, i) => ({ ...step, stepIndex: start + i }));
                const result = processSteps(steps);
                result.hasGaps = start > 0;
                if (start > 0) { result.suffixRecovered = true; result.suffixStartOffset = start; }
                result._fetchedSteps = steps;
                if (result.lastModelUsage || result.postCompactionPending || start === 0) { return result; }
            }
        } catch (error) {
            if (signal?.aborted) { throw error; }
            break;
        }
        if (start === 0) { break; }
    }
    const unavailable = processSteps([]);
    unavailable.hasGaps = true;
    return unavailable;
}

const MAX_IMAGE_WORKFLOW_CHILDREN = 16;
const MAX_IMAGE_WORKFLOW_DEPTH = 4;
const MAX_IMAGE_CHILD_STEPS = 2000;
const IMAGE_IDLE_CACHE_MS = 30_000;

interface CachedImageWorkflow {
    info: ImageWorkflowInfo;
    status: string;
    incomplete: boolean;
    fetchedAt: number;
}

let imageWorkflowGeneration = 0;
const imageWorkflowCache = new Map<string, CachedImageWorkflow>();
const imageWorkflowPending = new Map<string, Promise<CachedImageWorkflow>>();

/** Child observations belong to one account/backend lifetime and are never persisted as global data. */
export function resetImageWorkflowCache(): void {
    imageWorkflowGeneration++;
    imageWorkflowCache.clear();
    imageWorkflowPending.clear();
}

async function readChildImageWorkflow(ls: LSInfo, cascadeId: string, signal?: AbortSignal): Promise<CachedImageWorkflow> {
    const generation = imageWorkflowGeneration;
    const key = `${generation}:${ls.pid}:${ls.port}:${ls.useTls}:${ls.csrfToken}:${cascadeId}`;
    const cached = imageWorkflowCache.get(key);
    // Running/unknown children are re-read every poll even when their parent is idle.
    if (cached && !cached.incomplete && cached.status === 'CASCADE_RUN_STATUS_IDLE'
        && Date.now() - cached.fetchedAt < IMAGE_IDLE_CACHE_MS) { return cached; }
    const pending = imageWorkflowPending.get(key);
    if (pending) { return pending; }
    const request = (async (): Promise<CachedImageWorkflow> => {
        try {
            const response = await rpcCall(ls, 'GetCascadeTrajectory', { cascadeId }, 10_000, signal);
            const trajectory = response.trajectory as Record<string, unknown> | undefined;
            if (!trajectory || !Array.isArray(trajectory.steps)) { throw new Error('Missing linked trajectory steps'); }
            const allSteps = trajectory.steps;
            const steps = allSteps.slice(0, MAX_IMAGE_CHILD_STEPS)
                .filter((step): step is Record<string, unknown> => !!step && typeof step === 'object' && !Array.isArray(step));
            const models = new Set<string>();
            let directStepCount = 0;
            for (const step of steps) {
                const metadata = step.metadata as Record<string, unknown> | undefined;
                const coordinator = typeof metadata?.generatorModel === 'string' ? metadata.generatorModel : '';
                if (!isImageGenStep(step, coordinator)) { continue; }
                directStepCount++;
                const model = imageModelForStep(step, coordinator);
                if (model) { models.add(model); }
            }
            const totalSteps = Number(response.numTotalSteps);
            const result: CachedImageWorkflow = {
                info: { directStepCount, directModels: [...models], linkedCascadeIds: extractLinkedSubagentIds(steps) },
                status: typeof response.status === 'string' ? response.status : '',
                incomplete: allSteps.length > MAX_IMAGE_CHILD_STEPS || steps.length !== allSteps.length
                    || (Number.isSafeInteger(totalSteps) && totalSteps > allSteps.length),
                fetchedAt: Date.now(),
            };
            if (generation === imageWorkflowGeneration) {
                imageWorkflowCache.set(key, result);
                while (imageWorkflowCache.size > 128) { imageWorkflowCache.delete(imageWorkflowCache.keys().next().value!); }
            }
            return result;
        } catch (error) {
            if (signal?.aborted) { throw error; }
            // Retain any previously observed images, but disclose that this read
            // is incomplete. A missing child must never erase a known image.
            return cached ? { ...cached, incomplete: true } : {
                info: { directStepCount: 0, directModels: [], linkedCascadeIds: [] },
                status: '', incomplete: true, fetchedAt: Date.now(),
            };
        }
    })();
    imageWorkflowPending.set(key, request);
    try { return await request; }
    finally { if (imageWorkflowPending.get(key) === request) { imageWorkflowPending.delete(key); } }
}

/** Count image-tool steps in this workflow only; child text tokens never alter parent context. */
export async function refreshWorkflowImageUsage(ls: LSInfo, usage: ContextUsage, signal?: AbortSignal): Promise<ContextUsage> {
    const direct = usage.imageWorkflow;
    if (!direct) { return usage; }
    const generation = imageWorkflowGeneration;
    let imageGenStepCount = direct.directStepCount;
    const models = new Set(direct.directModels);
    let incomplete = usage.hasGaps;
    const visited = new Set([usage.cascadeId]);
    const queue: Array<{ id: string; depth: number }> = [];
    const enqueue = (id: string, depth: number): void => {
        if (visited.has(id)) { return; }
        if (depth > MAX_IMAGE_WORKFLOW_DEPTH || visited.size - 1 >= MAX_IMAGE_WORKFLOW_CHILDREN) {
            incomplete = true;
            return;
        }
        visited.add(id);
        queue.push({ id, depth });
    };
    for (const id of direct.linkedCascadeIds) { enqueue(id, 1); }
    while (queue.length > 0) {
        if (generation !== imageWorkflowGeneration) { break; }
        if (signal?.aborted) { throw new Error('Image workflow read aborted'); }
        const batch = queue.splice(0, 4);
        const children = await Promise.all(batch.map(child => readChildImageWorkflow(ls, child.id, signal)));
        if (generation !== imageWorkflowGeneration) { break; }
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            imageGenStepCount += child.info.directStepCount;
            child.info.directModels.forEach(model => models.add(model));
            incomplete ||= child.incomplete;
            child.info.linkedCascadeIds.forEach(id => enqueue(id, batch[i].depth + 1));
        }
    }
    if (generation !== imageWorkflowGeneration) {
        return { ...usage, imageGenStepCount: direct.directStepCount,
            imageGenerationModels: [...direct.directModels], imageGenerationIncomplete: true };
    }
    return { ...usage, imageGenStepCount, imageGenerationModels: [...models], imageGenerationIncomplete: incomplete };
}

// ─── Full User Status from GetUserStatus ─────────────────────────────────────

/**
 * Fetch full user status including model configs, plan info, and credits.
 */
export async function fetchFullUserStatus(ls: LSInfo, signal?: AbortSignal): Promise<FullUserStatusFetchResult> {
    try {
        const resp = await rpcCall(ls, 'GetUserStatus', {
            metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
        }, 10000, signal);
        const rawUserStatus = resp?.userStatus;
        if (!rawUserStatus || typeof rawUserStatus !== 'object' || Array.isArray(rawUserStatus)) {
            return {
                ok: false,
                configs: [],
                userInfo: null,
                error: 'Missing or invalid userStatus payload in GetUserStatus response',
            };
        }
        const userStatus = rawUserStatus as Record<string, unknown>;

        // ─── Model Configs ───
        const configData = userStatus.cascadeModelConfigData as Record<string, unknown> | undefined;
        const rawConfigs = configData?.clientModelConfigs as Array<Record<string, unknown>> | undefined;
        const configs: ModelConfig[] = (rawConfigs || []).map(c => {
            const qi = c.quotaInfo as Record<string, unknown> | undefined;
            const mimeTypes = c.supportedMimeTypes as Record<string, boolean> | undefined;
            // Proto3 omits float fields when value is 0.0 (the default).
            // Two reasons remainingFraction can be missing:
            //   1. Quota untouched (resetTime is empty or epoch 1970) → treat as 1.0 (full)
            //   2. Quota exhausted (resetTime is a valid non-epoch date) → treat as 0.0
            // Malformed values stay NaN so downstream marks quota unknown instead of 0%.
            const resolveRemainingFraction = (q: Record<string, unknown>): number => {
                if (q.remainingFraction != null) {
                    const raw = typeof q.remainingFraction === 'string' && q.remainingFraction.trim() !== ''
                        ? Number(q.remainingFraction) : q.remainingFraction;
                    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : Number.NaN;
                }
                if (q.resetTime == null) { return 1; }
                if (typeof q.resetTime !== 'string') { return Number.NaN; }
                const rt = q.resetTime.trim();
                if (!rt) { return 1; }
                const parsed = parseStrictResetTimestamp(rt);
                if (parsed === null || parsed < 0) { return Number.NaN; }
                return parsed === 0 ? 1 : 0;
            };
            return {
                model: ((c.modelOrAlias as Record<string, unknown>)?.model as string) || '',
                label: (c.label as string) || '',
                supportsImages: (c.supportsImages as boolean) || false,
                quotaInfo: qi ? {
                    remainingFraction: resolveRemainingFraction(qi),
                    resetTime: (qi.resetTime as string) || '',
                } : undefined,
                allowedTiers: (c.allowedTiers as string[]) || [],
                tagTitle: (c.tagTitle as string) || undefined,
                ...(typeof c.tagDescription === 'string' && c.tagDescription.trim()
                    ? { tagDescription: c.tagDescription.trim() } : {}),
                ...(typeof c.modelId === 'string' && c.modelId.trim()
                    ? { modelId: c.modelId.trim() } : {}),
                mimeTypeCount: mimeTypes ? Object.keys(mimeTypes).length : 0,
                isRecommended: (c.isRecommended as boolean) || false,
                supportedMimeTypes: mimeTypes ? Object.keys(mimeTypes) : [],
            };
        }).filter(c => c.model && c.label);

        const rawGroupedModels = configData?.groupedModels as Record<string, unknown> | undefined;
        let groupedModels: Record<string, GroupedModelInfo> | undefined;
        if (rawGroupedModels && typeof rawGroupedModels === 'object' && !Array.isArray(rawGroupedModels)) {
            const parsedGroups: Record<string, GroupedModelInfo> = {};
            for (const [familyKey, rawEntry] of Object.entries(rawGroupedModels)) {
                if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) { continue; }
                const entry = rawEntry as Record<string, unknown>;
                const displayName = typeof entry.displayName === 'string' ? entry.displayName.trim() : '';
                const rawLevels = Array.isArray(entry.supportedThinkingLevels) ? entry.supportedThinkingLevels : [];
                const supportedThinkingLevels: GroupedModelThinkingLevel[] = rawLevels.flatMap((lvl: unknown) => {
                    if (!lvl || typeof lvl !== 'object' || Array.isArray(lvl)) { return []; }
                    const rec = lvl as Record<string, unknown>;
                    const thinkingSuffix = typeof rec.thinkingSuffix === 'string' ? rec.thinkingSuffix.trim() : '';
                    const thinkingDisplayName = typeof rec.thinkingDisplayName === 'string' ? rec.thinkingDisplayName.trim() : '';
                    return thinkingSuffix && thinkingDisplayName ? [{ thinkingSuffix, thinkingDisplayName }] : [];
                });
                const defaultThinkingSuffix = typeof entry.defaultThinkingSuffix === 'string' && entry.defaultThinkingSuffix.trim()
                    ? entry.defaultThinkingSuffix.trim() : undefined;
                if (displayName || supportedThinkingLevels.length > 0) {
                    parsedGroups[familyKey] = {
                        displayName: displayName || familyKey,
                        supportedThinkingLevels,
                        ...(defaultThinkingSuffix ? { defaultThinkingSuffix } : {}),
                    };
                }
            }
            if (Object.keys(parsedGroups).length > 0) {
                groupedModels = parsedGroups;
            }
        }

        // ─── Plan Info ───
        const planStatus = userStatus.planStatus as Record<string, unknown> | undefined;
        const planInfo = planStatus?.planInfo as Record<string, unknown> | undefined;
        const userTier = userStatus.userTier as Record<string, unknown> | undefined;
        const teamCfg = planInfo?.defaultTeamConfig as Record<string, boolean> | undefined;
        const defaultOverride = configData?.defaultOverrideModelConfig as Record<string, unknown> | undefined;
        const defaultModelId = (defaultOverride?.modelOrAlias as Record<string, unknown>)?.model as string || '';
        const defaultModelCfg = configs.find(c => c.model === defaultModelId);
        const rawCredits = Array.isArray(userTier?.availableCredits) ? userTier.availableCredits : [];

        // Deep-mined fields
        const tierDescription = (userTier?.description as string) || '';
        const upgradeText = (userTier?.upgradeSubscriptionText as string) || '';
        const clientModelSorts = (configData?.clientModelSorts as Array<Record<string, unknown>>) || [];
        let modelSortOrder: string[] = [];
        if (clientModelSorts.length > 0) {
            const sortGroups = (clientModelSorts[0].groups as Array<Record<string, unknown>>) || [];
            if (sortGroups.length > 0) {
                modelSortOrder = (sortGroups[0].modelLabels as string[]) || [];
            }
        }

        const parsePlanLimit = (value: unknown): number | null => {
            if (typeof value === 'string' && /^(?:-1|\d+)$/.test(value.trim())) {
                value = Number(value);
            }
            return typeof value === 'number' && Number.isSafeInteger(value) && value >= -1 ? value : null;
        };
        const parseNum = (v: unknown): number => {
            if (typeof v === 'number') { return Number.isFinite(v) ? v : 0; }
            if (typeof v === 'string') { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; }
            return 0;
        };

        const hasAccountData = !!(planInfo || userTier || userStatus.email || userStatus.name);
        const userInfo: UserStatusInfo | null = hasAccountData ? {
            name: (userStatus.name as string) || '',
            email: (userStatus.email as string) || '',
            planName: (planInfo?.planName as string) || '',
            teamsTier: (planInfo?.teamsTier as string) || '',
            userTierName: (userTier?.name as string) || '',
            userTierId: (userTier?.id as string) || '',
            defaultModelLabel: defaultModelCfg?.label || defaultModelId || '',
            planLimits: {
                maxNumChatInputTokens: parsePlanLimit(planInfo?.maxNumChatInputTokens),
                maxNumPremiumChatMessages: parsePlanLimit(planInfo?.maxNumPremiumChatMessages),
                maxCustomChatInstructionCharacters: parsePlanLimit(planInfo?.maxCustomChatInstructionCharacters),
                maxNumPinnedContextItems: parsePlanLimit(planInfo?.maxNumPinnedContextItems),
                maxLocalIndexSize: parsePlanLimit(planInfo?.maxLocalIndexSize),
                monthlyFlexCreditPurchaseAmount: parsePlanLimit(planInfo?.monthlyFlexCreditPurchaseAmount),
            },
            teamConfig: {
                allowMcpServers: Boolean(teamCfg?.allowMcpServers),
                allowAutoRunCommands: Boolean(teamCfg?.allowAutoRunCommands),
                allowBrowserExperimentalFeatures: Boolean(teamCfg?.allowBrowserExperimentalFeatures),
            },
            availableCredits: rawCredits.flatMap((entry: unknown) => {
                if (!entry || typeof entry !== 'object') { return []; }
                const credit = entry as Record<string, unknown>;
                if (typeof credit.creditType !== 'string') { return []; }
                return [{
                    creditType: credit.creditType,
                    creditAmount: parseCreditBalance(credit.creditAmount),
                    minimumCreditAmountForUsage: parseNum(credit.minimumCreditAmountForUsage),
                }];
            }),
            // Feature flags
            canBuyMoreCredits: Boolean(planInfo?.canBuyMoreCredits),
            browserEnabled: Boolean(planInfo?.browserEnabled),
            cascadeWebSearchEnabled: Boolean(planInfo?.cascadeWebSearchEnabled),
            knowledgeBaseEnabled: Boolean(planInfo?.knowledgeBaseEnabled),
            canGenerateCommitMessages: Boolean(planInfo?.canGenerateCommitMessages),
            cascadeCanAutoRunCommands: Boolean(planInfo?.cascadeCanAutoRunCommands),
            canAllowCascadeInBackground: Boolean(planInfo?.canAllowCascadeInBackground),
            hasAutocompleteFastMode: Boolean(planInfo?.hasAutocompleteFastMode),
            allowStickyPremiumModels: Boolean(planInfo?.allowStickyPremiumModels),
            allowPremiumCommandModels: Boolean(planInfo?.allowPremiumCommandModels),
            hasTabToJump: Boolean(planInfo?.hasTabToJump),
            canCustomizeAppIcon: Boolean(planInfo?.canCustomizeAppIcon),
            // Deep-mined fields
            userTierDescription: tierDescription,
            upgradeSubscriptionText: upgradeText,
            modelSortOrder,
        } : null;

        // Attach raw LS response for transparency panel
        if (userInfo) {
            userInfo._rawResponse = resp as Record<string, unknown>;
        }

        return {
            ok: true,
            configs,
            userInfo,
            ...(groupedModels ? { groupedModels } : {}),
            rawResponse: resp as Record<string, unknown>,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err ?? 'Unknown GetUserStatus error');
        return { ok: false, configs: [], userInfo: null, error: message };
    }
}

// ─── Orchestrator Settings (JetboxSubscribeToState + GetMendelFlags) ─────────

/** Parse Mendel experiment payload for `orchestrator-model-roles`. */
export function parseOrchestratorModelRoles(raw: unknown): OrchestratorModelRoles | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return null; }
    const root = raw as Record<string, unknown>;
    const response = (root.response && typeof root.response === 'object' && !Array.isArray(root.response))
        ? root.response as Record<string, unknown> : root;
    const expCfg = (response.experimentConfig && typeof response.experimentConfig === 'object' && !Array.isArray(response.experimentConfig))
        ? response.experimentConfig as Record<string, unknown> : response;
    const experiments = Array.isArray(expCfg.experiments) ? expCfg.experiments : [];
    for (const item of experiments) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) { continue; }
        const exp = item as Record<string, unknown>;
        if (exp.disabled === true) { continue; }
        const keyStr = typeof exp.keyString === 'string' ? exp.keyString.trim() : '';
        if (keyStr !== 'orchestrator-model-roles') { continue; }
        const payloadObj = (exp.payload && typeof exp.payload === 'object' && !Array.isArray(exp.payload))
            ? exp.payload as Record<string, unknown> : undefined;
        const jsonStr = typeof exp.string === 'string' ? exp.string
            : typeof exp.stringValue === 'string' ? exp.stringValue
                : typeof payloadObj?.value === 'string' ? payloadObj.value : '';
        if (!jsonStr.trim()) { continue; }
        try {
            const parsed: unknown = JSON.parse(jsonStr);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { continue; }
            const rec = parsed as Record<string, unknown>;
            const orchestrators = Array.isArray(rec.orchestrators)
                ? rec.orchestrators.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim())
                : [];
            const executors = Array.isArray(rec.executors)
                ? rec.executors.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim())
                : [];
            if (orchestrators.length > 0 || executors.length > 0) {
                return { orchestrators, executors };
            }
        } catch {
            return null;
        }
    }
    return null;
}

export interface JetboxOrchestratorPrefs {
    orchestratorModel: string;
    orchestratorExecutorModel: string;
    lastSelectedAgentModel: string;
    useAiCredits?: boolean;
}

/** Extract Orchestrator preferences from frame 1 of JetboxSubscribeToState. */
export function parseJetboxOrchestratorPrefs(frame: unknown): JetboxOrchestratorPrefs | null {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) { return null; }
    const rec = frame as Record<string, unknown>;
    const appState = (rec.appState && typeof rec.appState === 'object' && !Array.isArray(rec.appState))
        ? rec.appState as Record<string, unknown> : undefined;
    const userConfig = (rec.userConfig && typeof rec.userConfig === 'object' && !Array.isArray(rec.userConfig))
        ? rec.userConfig as Record<string, unknown> : undefined;
    const userSettings = (userConfig?.userSettings && typeof userConfig.userSettings === 'object' && !Array.isArray(userConfig.userSettings))
        ? userConfig.userSettings as Record<string, unknown>
        : (rec.userSettings && typeof rec.userSettings === 'object' && !Array.isArray(rec.userSettings))
            ? rec.userSettings as Record<string, unknown> : undefined;

    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const useAiCredits = typeof userSettings?.useAiCredits === 'boolean'
        ? userSettings.useAiCredits
        : typeof userConfig?.useAiCredits === 'boolean'
            ? userConfig.useAiCredits
            : undefined;
    return {
        orchestratorModel: str(userSettings?.orchestratorModel ?? userConfig?.orchestratorModel),
        orchestratorExecutorModel: str(userSettings?.orchestratorExecutorModel ?? userConfig?.orchestratorExecutorModel),
        lastSelectedAgentModel: str(appState?.lastSelectedAgentModel),
        ...(useAiCredits !== undefined ? { useAiCredits } : {}),
    };
}

export interface FetchOrchestratorSettingsOptions {
    /** Override path to `~/.gemini/config/config.json` (used for testing / custom profiles). */
    configPath?: string;
    /** Override home directory for `~/.gemini/config/config.json` fallback resolution. */
    homeDir?: string;
    /** Skip local `config.json` fallback read when true. */
    disableConfigFallback?: boolean;
}

function isConcretePrefModel(value: string | undefined): boolean {
    const clean = (value || '').trim().toUpperCase();
    return Boolean(clean) && clean !== 'MODEL_UNSPECIFIED' && clean !== 'MODEL_PLACEHOLDER_UNSPECIFIED';
}

/**
 * Fetch global Orchestrator Settings (Orchestrator Model + Executor Model + Mendel roles).
 * Falls back read-only to `~/.gemini/config/config.json` (`userSettings.{orchestratorModel,
 * orchestratorExecutorModel, useAiCredits}`) when `JetboxSubscribeToState` has not populated
 * them yet, and gracefully degrades to null when neither RPC nor local config has data.
 */
export async function fetchOrchestratorSettings(
    ls: LSInfo,
    configs: readonly ModelConfig[],
    signal?: AbortSignal,
    options?: FetchOrchestratorSettingsOptions,
): Promise<OrchestratorSettings | null> {
    try {
        const [jetboxRes, mendelRes] = await Promise.allSettled([
            rpcStreamFirstFrame(ls, 'JetboxSubscribeToState', {}, 5000, signal),
            rpcCall(ls, 'GetMendelFlags', {}, 5000, signal),
        ]);
        const rpcPrefs = jetboxRes.status === 'fulfilled'
            ? parseJetboxOrchestratorPrefs(jetboxRes.value) : null;
        const roles = mendelRes.status === 'fulfilled'
            ? parseOrchestratorModelRoles(mendelRes.value) : null;

        const needsConfigFallback = !options?.disableConfigFallback && (
            !rpcPrefs
            || !isConcretePrefModel(rpcPrefs.orchestratorModel)
            || !isConcretePrefModel(rpcPrefs.orchestratorExecutorModel)
            || rpcPrefs.useAiCredits === undefined
        );
        const diskPrefs = needsConfigFallback
            ? readLocalOrchestratorConfigFallback({ configPath: options?.configPath, homeDir: options?.homeDir })
            : null;

        if (!rpcPrefs && !diskPrefs && !roles) { return null; }

        const mergedOrch = isConcretePrefModel(rpcPrefs?.orchestratorModel)
            ? rpcPrefs!.orchestratorModel
            : (diskPrefs?.orchestratorModel || rpcPrefs?.orchestratorModel || '');
        const mergedExec = isConcretePrefModel(rpcPrefs?.orchestratorExecutorModel)
            ? rpcPrefs!.orchestratorExecutorModel
            : (diskPrefs?.orchestratorExecutorModel || rpcPrefs?.orchestratorExecutorModel || '');
        const mergedCredits = rpcPrefs?.useAiCredits !== undefined
            ? rpcPrefs.useAiCredits
            : diskPrefs?.useAiCredits;

        const usedDisk = Boolean(
            diskPrefs && (
                (!isConcretePrefModel(rpcPrefs?.orchestratorModel) && isConcretePrefModel(diskPrefs.orchestratorModel))
                || (!isConcretePrefModel(rpcPrefs?.orchestratorExecutorModel) && isConcretePrefModel(diskPrefs.orchestratorExecutorModel))
                || (rpcPrefs?.useAiCredits === undefined && diskPrefs.useAiCredits !== undefined)
            ),
        );
        const settingsSource: 'rpc' | 'config_fallback' | 'merged' = rpcPrefs
            ? (usedDisk ? 'merged' : 'rpc')
            : (diskPrefs ? 'config_fallback' : 'rpc');

        const mergedPrefs = (rpcPrefs || diskPrefs) ? {
            orchestratorModel: mergedOrch,
            orchestratorExecutorModel: mergedExec,
            lastSelectedAgentModel: rpcPrefs?.lastSelectedAgentModel || '',
            ...(mergedCredits !== undefined ? { useAiCredits: mergedCredits } : {}),
            settingsSource,
        } : null;

        return resolveOrchestratorSettings(mergedPrefs, roles, configs);
    } catch {
        return null;
    }
}

// ─── Dual-Window Quota Summary (RetrieveUserQuotaSummary) ────────────────────

const STRICT_ISO_RESET_TIMESTAMP_RE =
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i;

/**
 * Parse a strict ISO-8601 / RFC 3339 reset timestamp with explicit timezone (`Z` or `±HH:MM`)
 * and real calendar-date round-trip validation.
 * Returns epoch milliseconds (including `0` for equivalent proto3 epoch-0 spellings such as
 * `1970-01-01T00:00:00Z`, `1970-01-01T00:00:00.000Z`, or `1970-01-01T00:00:00+00:00`),
 * or `null` when missing, malformed, missing timezone, or an impossible calendar date.
 */
export function parseStrictResetTimestamp(raw: unknown): number | null {
    const reset = typeof raw === 'string' ? raw.trim() : '';
    if (!reset || !STRICT_ISO_RESET_TIMESTAMP_RE.test(reset)) { return null; }
    const day = reset.slice(0, 10);
    const calendarDate = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== day) {
        return null;
    }
    const parsed = Date.parse(reset);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseWindowResetTimestamp(raw: unknown): { resetTime: string | null; resetAt: number | null; parsedMs: number | null } {
    if (typeof raw !== 'string') { return { resetTime: null, resetAt: null, parsedMs: null }; }
    const reset = raw.trim();
    const parsedMs = parseStrictResetTimestamp(reset);
    if (parsedMs === null || parsedMs <= 0) {
        return { resetTime: null, resetAt: null, parsedMs };
    }
    return { resetTime: reset, resetAt: parsedMs, parsedMs };
}

function parseQuotaWindowRemaining(bucket: Record<string, unknown>, parsedResetMs: number | null): number | null {
    if (bucket.remainingFraction != null) {
        const raw = typeof bucket.remainingFraction === 'string' && bucket.remainingFraction.trim() !== ''
            ? Number(bucket.remainingFraction) : bucket.remainingFraction;
        return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : null;
    }
    // Proto3 omits float 0.0: untouched quota has no/epoch resetTime → 1.0,
    // exhausted quota has a valid future/non-epoch resetTime → 0.0.
    if (bucket.resetTime == null) { return 1; }
    if (typeof bucket.resetTime !== 'string') { return null; }
    if (!bucket.resetTime.trim()) { return 1; }
    if (parsedResetMs === null || parsedResetMs < 0) { return null; }
    return parsedResetMs === 0 ? 1 : 0;
}

function inferQuotaSummaryPool(displayName: string, buckets: readonly QuotaWindowSummary[]): 'gemini' | 'premium' | undefined {
    const ids = buckets.map(b => b.bucketId.toLowerCase());
    if (ids.some(id => id.startsWith('gemini')) || /\bgemini\b/i.test(displayName)) {
        return 'gemini';
    }
    if (ids.some(id => id.startsWith('3p') || id.startsWith('claude') || id.startsWith('gpt'))
        || /\b(?:claude|gpt)\b/i.test(displayName)) {
        return 'premium';
    }
    return undefined;
}

/** Parse RetrieveUserQuotaSummary response into canonical dual-window pool summaries. */
export function parseUserQuotaSummary(raw: unknown): UserQuotaSummary | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { return null; }
    const root = raw as Record<string, unknown>;
    const payload = (root.response && typeof root.response === 'object' && !Array.isArray(root.response))
        ? root.response as Record<string, unknown> : root;
    const rawGroups = Array.isArray(payload.groups) ? payload.groups : [];
    const groups: QuotaPoolSummary[] = [];

    for (const item of rawGroups) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) { continue; }
        const rec = item as Record<string, unknown>;
        const displayName = typeof rec.displayName === 'string' ? rec.displayName.trim() : '';
        const description = typeof rec.description === 'string' && rec.description.trim()
            ? rec.description.trim() : undefined;
        const rawBuckets = Array.isArray(rec.buckets) ? rec.buckets : [];
        const buckets: QuotaWindowSummary[] = [];

        for (const rawBucket of rawBuckets) {
            if (!rawBucket || typeof rawBucket !== 'object' || Array.isArray(rawBucket)) { continue; }
            const b = rawBucket as Record<string, unknown>;
            const bucketId = typeof b.bucketId === 'string' ? b.bucketId.trim() : '';
            const rawWindow = typeof b.window === 'string' ? b.window.trim().toLowerCase() : '';
            const window = rawWindow
                || (bucketId.toLowerCase().endsWith('-weekly') ? 'weekly'
                    : bucketId.toLowerCase().endsWith('-5h') ? '5h' : '');
            if (!bucketId && !window) { continue; }
            const { resetTime, resetAt, parsedMs } = parseWindowResetTimestamp(b.resetTime);
            const remainingFraction = parseQuotaWindowRemaining(b, parsedMs);
            const bucketDisplayName = typeof b.displayName === 'string' ? b.displayName.trim() : '';
            const bucketDescription = typeof b.description === 'string' && b.description.trim()
                ? b.description.trim() : undefined;
            buckets.push({
                bucketId,
                window,
                displayName: bucketDisplayName || window || bucketId,
                ...(bucketDescription ? { description: bucketDescription } : {}),
                remainingFraction,
                resetTime,
                resetAt,
            });
        }

        if (!displayName && buckets.length === 0) { continue; }
        const pool = inferQuotaSummaryPool(displayName, buckets);
        const fiveHour = buckets.find(b => b.window === '5h');
        const weekly = buckets.find(b => b.window === 'weekly');
        groups.push({
            ...(pool ? { pool } : {}),
            displayName: displayName || (pool === 'gemini' ? 'Gemini Models' : pool === 'premium' ? 'Claude and GPT models' : 'Models'),
            ...(description ? { description } : {}),
            ...(fiveHour ? { fiveHour } : {}),
            ...(weekly ? { weekly } : {}),
            buckets,
        });
    }

    if (groups.length === 0) { return null; }
    const description = typeof payload.description === 'string' && payload.description.trim()
        ? payload.description.trim() : undefined;
    return { groups, ...(description ? { description } : {}) };
}

/**
 * Fetch dual-window (5h + weekly) quota summary from RetrieveUserQuotaSummary.
 * Returns null gracefully on older LS builds or RPC failure.
 */
export async function fetchUserQuotaSummary(
    ls: LSInfo,
    signal?: AbortSignal,
): Promise<UserQuotaSummary | null> {
    try {
        const resp = await rpcCall(ls, 'RetrieveUserQuotaSummary', {
            metadata: { ideName: 'antigravity', extensionName: 'antigravity' },
        }, 10000, signal);
        return parseUserQuotaSummary(resp);
    } catch {
        return null;
    }
}

/**
 * Safely read model configs without hitting `GetCommandModelConfigs` `501 unimplemented`
 * spam on Antigravity App v2.34+ / IDE v2.7+ hubs. Uses `GetUserStatus` directly and
 * degrades cleanly to `[]` if unavailable.
 */
export async function fetchCommandModelConfigsSafe(
    ls: LSInfo,
    signal?: AbortSignal,
): Promise<ModelConfig[]> {
    try {
        const result = await fetchFullUserStatus(ls, signal);
        return result.configs;
    } catch (err) {
        if (signal?.aborted) { throw err; }
        return [];
    }
}

/**
 * Get full context usage for a specific cascade.
 */
export async function getContextUsage(
    ls: LSInfo,
    trajectory: TrajectorySummary,
    customLimits?: Record<string, number>,
    signal?: AbortSignal
): Promise<ContextUsage> {
    const result = trajectory.manifestMember && trajectory.stepCount > 0
        ? await getMemberTokenUsage(ls, trajectory, signal)
        : await getTrajectoryTokenUsage(ls, trajectory.cascadeId, trajectory.stepCount, signal);

    const effectiveModel = result.model || trajectory.requestedModel || trajectory.generatorModel;
    // When the latest token snapshot came directly from a planner/executor step
    // (never a CHECKPOINT whose lastModelUsage.model is a shadow model like M50),
    // resolve contextLimit against that actual model so cross-pool Orchestrator
    // turns (e.g. Opus 5.5 256K planner + Hydrogen 512K executor) match occupancy
    // to the active step's compression limit.
    const limitModel = result.tokenUsageSource === 'planner' && result.lastModelUsage?.model
        ? result.lastModelUsage.model
        : effectiveModel;
    const contextLimit = getContextLimit(limitModel, customLimits);
    const usagePercent = contextLimit > 0 ? (result.contextUsed / contextLimit) * 100 : 0;

    const usage: ContextUsage = {
        postCompactionPending: result.postCompactionPending === true,
        tokenUsageSource: result.tokenUsageSource,
        cascadeId: trajectory.cascadeId,
        ...(trajectory.trajectoryId ? { trajectoryId: trajectory.trajectoryId } : {}),
        title: trajectory.summary,
        model: effectiveModel,
        modelDisplayName: normalizeModelDisplayName(effectiveModel),
        contextUsed: result.contextUsed,
        totalOutputTokens: result.totalOutputTokens,
        totalToolCallOutputTokens: result.totalToolCallOutputTokens,
        contextLimit,
        usagePercent,
        stepCount: trajectory.stepCount,
        lastModifiedTime: trajectory.lastModifiedTime,
        status: trajectory.status,
        isEstimated: result.isEstimated,
        lastModelUsage: result.lastModelUsage,
        estimatedDeltaSinceCheckpoint: result.estimatedDeltaSinceCheckpoint,
        imageGenStepCount: result.imageGenStepCount,
        imageGenerationModels: result.imageGenerationModels || [],
        imageGenerationIncomplete: false,
        imageWorkflow: { directStepCount: result.imageGenStepCount, directModels: result.imageGenerationModels || [],
            linkedCascadeIds: result.linkedSubagentCascadeIds || [] },
        compressionDetected: result.checkpointCompressionDetected,
        checkpointCompressionDrop: result.checkpointCompressionDrop,
        hasGaps: result.hasGaps,
        ...(result.suffixRecovered ? { suffixRecovered: true, suffixStartOffset: result.suffixStartOffset } : {}),
        checkpointModel: result.checkpointModel,
        ...(result.orchestratorConfig ? { orchestratorConfig: result.orchestratorConfig } : {}),
        ...(result.orchestratorHistory ? { orchestratorHistory: result.orchestratorHistory } : {}),
        // Extended transparency fields
        createdTime: trajectory.createdTime,
        lastUserInputTime: trajectory.lastUserInputTime,
        lastUserInputStepIndex: trajectory.lastUserInputStepIndex,
        repositoryName: trajectory.repositoryName,
        gitOriginUrl: trajectory.gitOriginUrl,
        branchName: trajectory.branchName,
        gitRootUri: trajectory.gitRootUri,
    };
    const finalUsage = await refreshWorkflowImageUsage(ls, usage, signal);
    if (result._fetchedSteps && result._fetchedSteps.length > 0) {
        Object.defineProperty(finalUsage, '_fetchedSteps', {
            value: result._fetchedSteps,
            enumerable: false,
            configurable: true,
            writable: true,
        });
    }
    return finalUsage;
}

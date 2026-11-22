import { parseCreditBalance } from './account-credits';
import { LSInfo } from './discovery';
import { rpcCall, rpcStreamFirstFrame } from './rpc-client';
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
    STEP_BATCH_SIZE,
} from './constants';

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
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrajectorySummary {
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
    /** True when consecutive checkpoint inputTokens show a significant drop */
    checkpointCompressionDetected: boolean;
    /** Size of the inputTokens drop between consecutive checkpoints (0 if none) */
    checkpointCompressionDrop: number;
    /** Model ID from the last checkpoint's modelUsage (shadow model, e.g. M50 Flash Lite) */
    checkpointModel: string;
    /** Active Planner → Executor pair when dynamic Orchestrator mode is used in this conversation. */
    orchestratorConfig?: ConversationOrchestratorConfig;
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
    /** Source of the latest token snapshot; also invalidates legacy usage caches. */
    tokenUsageSource?: 'checkpoint' | 'planner' | 'estimated';
    cascadeId: string;
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
    /** Shadow model used by the last checkpoint (e.g. M50 Flash Lite) for transparency */
    checkpointModel: string;
    /** Active Planner → Executor pair when dynamic Orchestrator mode is used in this conversation. */
    orchestratorConfig?: ConversationOrchestratorConfig;
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

        const trajectoryMetadata = data.trajectoryMetadata && typeof data.trajectoryMetadata === 'object'
            && !Array.isArray(data.trajectoryMetadata)
            ? data.trajectoryMetadata as Record<string, unknown>
            : undefined;
        const rawParentCascadeId = typeof data.parentCascadeId === 'string' && data.parentCascadeId.trim()
            ? data.parentCascadeId.trim()
            : typeof trajectoryMetadata?.parentCascadeId === 'string' && trajectoryMetadata.parentCascadeId.trim()
                ? trajectoryMetadata.parentCascadeId.trim()
                : undefined;

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
            ...(typeof data.trajectoryType === 'string' && data.trajectoryType ? { trajectoryType: data.trajectoryType } : {}),
            ...(rawParentCascadeId ? { parentCascadeId: rawParentCascadeId } : {}),
            ...(trajectoryMetadata ? { trajectoryMetadata } : {}),
            ...(typeof data.killed === 'boolean' ? { killed: data.killed } : {}),
        });
    }

    // Sort by lastModifiedTime descending (most recent first)
    result.sort((a, b) => {
        if (!a.lastModifiedTime) { return 1; }
        if (!b.lastModifiedTime) { return -1; }
        return b.lastModifiedTime.localeCompare(a.lastModifiedTime);
    });

    return result;
}

/**
 * Normalize a URI for comparison:
 * - Strip vscode-remote:// scheme+authority (e.g., vscode-remote://wsl+Ubuntu/path → /path)
 * - Strip file:// prefix
 * - URL-decode (handle %20 etc.)
 * - Remove trailing slash
 * - Lowercase for macOS/Windows case-insensitive FS
 */
export function normalizeUri(uri: string, platform: NodeJS.Platform = process.platform): string {
    let normalized = uri.trim();
    // Handle vscode-remote:// URIs — extract just the path portion
    // e.g., vscode-remote://wsl+Ubuntu/home/user/project → /home/user/project
    // e.g., vscode-remote://ssh-remote+host/home/user/project → /home/user/project
    const remoteMatch = normalized.match(/^vscode-remote:\/\/[^/]+(\/.*)/i);
    if (remoteMatch) {
        normalized = remoteMatch[1];
    }
    // RFC 8089 file:// URIs (case-insensitive scheme, optional localhost authority)
    normalized = normalized.replace(/^file:\/\/localhost\//i, '/');
    normalized = normalized.replace(/^file:\/\/\//i, '/');
    normalized = normalized.replace(/^file:\/\//i, '');
    try {
        normalized = decodeURIComponent(normalized);
    } catch {
        // If decoding fails, keep as-is
    }
    const isWindowsDrivePath = /^\/?[a-zA-Z]:(?:[\\/]|$)/.test(normalized);
    // Normalize Windows backslashes so raw paths and file:/// URIs compare equal.
    if (platform === 'win32' || isWindowsDrivePath) {
        normalized = normalized.replace(/\\/g, '/');
    }
    // Strip leading slash(es) before Windows drive letters (e.g., /C:/ → C:/)
    if (platform === 'win32' || isWindowsDrivePath) {
        normalized = normalized.replace(/^\/+([a-zA-Z]:)/, '$1');
    }
    normalized = normalized.replace(/\/+$/, '');
    if (platform === 'darwin' || platform === 'win32') {
        normalized = normalized.toLowerCase();
    }
    return normalized;
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

/** Follow only the typed invocation result, never arbitrary IDs in prompts or tool arguments. */
export function extractLinkedSubagentIds(steps: Array<Record<string, unknown>>): string[] {
    const ids = new Set<string>();
    for (const step of steps) {
        if (step.type !== 'CORTEX_STEP_TYPE_INVOKE_SUBAGENT') { continue; }
        const invocation = step.invokeSubagent;
        if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)) { continue; }
        const results = (invocation as Record<string, unknown>).results;
        if (!Array.isArray(results)) { continue; }
        for (const result of results) {
            if (!result || typeof result !== 'object' || Array.isArray(result)) { continue; }
            const id = (result as Record<string, unknown>).conversationId;
            if (typeof id === 'string' && id.trim() && id.length <= 256) { ids.add(id.trim()); }
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
    const stepDetails: StepTokenInfo[] = [];
    let lastModelUsage: ModelUsageInfo | null = null;
    let tokenUsageSource: 'checkpoint' | 'planner' | 'estimated' = 'estimated';
    let checkpointModel = '';
    let imageGenStepCount = 0;
    const imageGenStepIndices = new Set<number>();
    const imageGenerationModels = new Set<string>();

    let estimationOverhead = 0;
    let outputTokensSinceCheckpoint = 0;

    let prevCheckpointInputTokens = -1;
    let checkpointCompressionDetected = false;
    let checkpointCompressionDrop = 0;

    const isDelegatedExecutor = (candidate: string): boolean => {
        if (!orchestratorConfig || !candidate) { return false; }
        const normCandidate = resolveModelId(candidate) || candidate;
        const normExec = resolveModelId(orchestratorConfig.executionModel) || orchestratorConfig.executionModel;
        return normCandidate === normExec;
    };

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
        const meta = step.metadata as Record<string, unknown> | undefined;
        const stepType = (step.type as string) || '';
        const stepModel = typeof meta?.generatorModel === 'string' ? meta.generatorModel : '';
        const imageStep = isImageGenStep(step, stepModel);

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
        if (stepType === StepType.CHECKPOINT && meta) {
            const usage = extractModelUsage(meta);
            if (usage) {
                // Detect compression by comparing consecutive checkpoint inputTokens
                const checkpointInput = usage.inputTokens + usage.cacheReadTokens + (usage.cacheCreationTokens || 0);
                if (prevCheckpointInputTokens > 0 && checkpointInput < prevCheckpointInputTokens) {
                    const drop = prevCheckpointInputTokens - checkpointInput;
                    if (drop > COMPRESSION_MIN_DROP) {
                        checkpointCompressionDetected = true;
                        checkpointCompressionDrop = drop;
                    }
                }
                prevCheckpointInputTokens = checkpointInput;

                lastModelUsage = usage;
                tokenUsageSource = 'checkpoint';
                checkpointModel = usage.model;
                estimationOverhead = 0;
                outputTokensSinceCheckpoint = 0;
            }

            // Log retryInfos (observation mode — NOT added to totals)
            const retryInfos = meta.retryInfos as Array<Record<string, unknown>> | undefined;
            if (retryInfos && retryInfos.length > 0) {
                let retryInputTokens = 0;
                let retryOutputTokens = 0;
                for (const retry of retryInfos) {
                    const retryUsage = retry.usage as Record<string, unknown> | undefined;
                    if (retryUsage) {
                        retryInputTokens += parseInt(String(retryUsage.inputTokens || '0'), 10);
                        retryOutputTokens += parseInt(String(retryUsage.outputTokens || '0'), 10);
                    }
                }
                console.log(
                    `[ContextMonitor] Checkpoint retryInfos: ${retryInfos.length} retries, ` +
                    `retryInputTokens=${retryInputTokens}, retryOutputTokens=${retryOutputTokens}, ` +
                    `mainInputTokens=${usage?.inputTokens ?? 0}, mainOutputTokens=${usage?.outputTokens ?? 0}`
                );
            }
        }

        // Current agy trajectories report usage directly on the planner step,
        // often with no CHECKPOINT at all. This is a full context snapshot, not
        // an amount to add to previous calls or to the response text estimate.
        if (stepType === StepType.PLANNER_RESPONSE && meta && !imageStep) {
            const usage = extractModelUsage(meta);
            if (usage) {
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
        };
    }

    // Fallback: estimate total context window usage
    const estimatedTotal = toolOutputTokens + SYSTEM_PROMPT_OVERHEAD + estimationOverhead;

    return {
        tokenUsageSource: 'estimated',
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
        checkpointCompressionDetected: false,
        checkpointCompressionDrop: 0,
        checkpointModel: '',
        ...(orchestratorConfig ? { orchestratorConfig } : {}),
    };
}

/** True when a Connect-RPC error indicates an unimplemented or removed endpoint (HTTP 404/501). */
export function isRpcUnimplementedError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err ?? '');
    return /\bHTTP\s+(?:404|501)\b/i.test(message) || /\bunimplemented\b/i.test(message);
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
    try {
        const resp = await rpcCall(ls, 'GetCascadeTrajectoryGeneratorMetadata', {
            cascadeId,
            metadata: { ideName: 'antigravity', extensionName: 'antigravity' },
        }, 15000, signal);
        const raw = resp.generatorMetadata;
        if (!Array.isArray(raw)) { return []; }
        return raw.filter((item): item is RawGeneratorMetadataEntry =>
            !!item && typeof item === 'object' && !Array.isArray(item));
    } catch (err) {
        if (signal?.aborted) { throw err; }
        return [];
    }
}

/**
 * Fetch trajectory steps across both legacy `startIndex`/`endIndex` servers
 * and Antigravity v2.34+ `stepOffset` hubs without duplicating overlapping batches.
 */
export async function fetchTrajectorySteps(
    ls: LSInfo,
    cascadeId: string,
    totalSteps: number,
    signal?: AbortSignal,
): Promise<{ steps: Array<Record<string, unknown>>; hasGaps: boolean }> {
    const maxSteps = Math.max(totalSteps, 0);
    const allSteps: Array<Record<string, unknown>> = [];
    let hasGaps = false;

    const batchRanges: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < maxSteps; start += STEP_BATCH_SIZE) {
        batchRanges.push({ start, end: Math.min(start + STEP_BATCH_SIZE, maxSteps) });
    }
    if (batchRanges.length === 0) {
        return { steps: allSteps, hasGaps: false };
    }

    const fetchBatch = ({ start, end }: { start: number; end: number }) =>
        rpcCall(ls, 'GetCascadeTrajectorySteps', {
            cascadeId,
            startIndex: start,
            endIndex: end,
            stepOffset: start,
        }, 30000, signal);

    // Probe the first batch when multiple pages are expected: v2.34+ hubs ignore
    // endIndex and can return all steps from stepOffset=0 in one response.
    let remainingStart = 0;
    if (batchRanges.length > 1) {
        remainingStart = 1;
        try {
            const firstResp = await fetchBatch(batchRanges[0]);
            const firstSteps = firstResp.steps as Array<Record<string, unknown>> | undefined;
            if (firstSteps && firstSteps.length > 0) {
                allSteps.push(...firstSteps);
                if (firstSteps.length >= maxSteps || firstSteps.length > STEP_BATCH_SIZE) {
                    return { steps: allSteps, hasGaps: false };
                }
            }
        } catch (err) {
            if (signal?.aborted) { throw err; }
            if (!isRpcUnimplementedError(err)) {
                console.warn(
                    `[ContextMonitor] Failed to fetch steps batch [${batchRanges[0].start}-${batchRanges[0].end}] ` +
                    `for cascade ${cascadeId.substring(0, 8)}: ${err}`,
                );
            }
            hasGaps = true;
        }
    }

    // Process remaining batches in groups to avoid bursting concurrent RPC calls
    for (let groupStart = remainingStart; groupStart < batchRanges.length; groupStart += MAX_CONCURRENT_BATCHES) {
        const group = batchRanges.slice(groupStart, groupStart + MAX_CONCURRENT_BATCHES);
        const groupResults = await Promise.allSettled(group.map(fetchBatch));

        for (let i = 0; i < groupResults.length; i++) {
            const result = groupResults[i];
            if (result.status === 'fulfilled') {
                const steps = result.value.steps as Array<Record<string, unknown>> | undefined;
                if (steps && steps.length > 0) {
                    allSteps.push(...steps);
                }
            } else {
                const { start, end } = group[i];
                if (!isRpcUnimplementedError(result.reason)) {
                    console.warn(
                        `[ContextMonitor] Failed to fetch steps batch [${start}-${end}] ` +
                        `for cascade ${cascadeId.substring(0, 8)}: ${result.reason}`,
                    );
                }
                hasGaps = true;
            }
        }
    }

    return { steps: allSteps, hasGaps };
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
    const { steps: allSteps, hasGaps } = await fetchTrajectorySteps(ls, cascadeId, totalSteps, signal);
    const result = processSteps(allSteps);
    result.hasGaps = hasGaps;
    return result;
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
export async function fetchFullUserStatus(ls: LSInfo, signal?: AbortSignal): Promise<FullUserStatus> {
    try {
        const resp = await rpcCall(ls, 'GetUserStatus', {
            metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
        }, 10000, signal);
        const rawUserStatus = resp?.userStatus;
        if (!rawUserStatus || typeof rawUserStatus !== 'object' || Array.isArray(rawUserStatus)) {
            return { configs: [], userInfo: null };
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
                maxNumChatInputTokens: parseNum(planInfo?.maxNumChatInputTokens),
                maxNumPremiumChatMessages: parseNum(planInfo?.maxNumPremiumChatMessages),
                maxCustomChatInstructionCharacters: parseNum(planInfo?.maxCustomChatInstructionCharacters),
                maxNumPinnedContextItems: parseNum(planInfo?.maxNumPinnedContextItems),
                maxLocalIndexSize: parseNum(planInfo?.maxLocalIndexSize),
                monthlyFlexCreditPurchaseAmount: parseNum(planInfo?.monthlyFlexCreditPurchaseAmount),
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
            configs,
            userInfo,
            ...(groupedModels ? { groupedModels } : {}),
            rawResponse: resp as Record<string, unknown>,
        };
    } catch {
        return { configs: [], userInfo: null };
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
    return {
        orchestratorModel: str(userSettings?.orchestratorModel ?? userConfig?.orchestratorModel),
        orchestratorExecutorModel: str(userSettings?.orchestratorExecutorModel ?? userConfig?.orchestratorExecutorModel),
        lastSelectedAgentModel: str(appState?.lastSelectedAgentModel),
    };
}

/**
 * Fetch global Orchestrator Settings (Orchestrator Model + Executor Model + Mendel roles).
 * Gracefully degrades to null on older LS builds that lack JetboxSubscribeToState / GetMendelFlags.
 */
export async function fetchOrchestratorSettings(
    ls: LSInfo,
    configs: readonly ModelConfig[],
    signal?: AbortSignal,
): Promise<OrchestratorSettings | null> {
    try {
        const [jetboxRes, mendelRes] = await Promise.allSettled([
            rpcStreamFirstFrame(ls, 'JetboxSubscribeToState', {}, 5000, signal),
            rpcCall(ls, 'GetMendelFlags', {}, 5000, signal),
        ]);
        const prefs = jetboxRes.status === 'fulfilled'
            ? parseJetboxOrchestratorPrefs(jetboxRes.value) : null;
        const roles = mendelRes.status === 'fulfilled'
            ? parseOrchestratorModelRoles(mendelRes.value) : null;
        if (!prefs && !roles) { return null; }
        return resolveOrchestratorSettings(prefs, roles, configs);
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
 * @deprecated Use `fetchFullUserStatus()` instead.
 * Backward-compatible wrapper — relies on `GetUserStatus` (never calling
 * `GetCommandModelConfigs`, which returns `501 unimplemented` on v2.34+ App & v2.7+ IDE).
 */
export async function fetchModelConfigs(ls: LSInfo, signal?: AbortSignal): Promise<ModelConfig[]> {
    const result = await fetchFullUserStatus(ls, signal);
    return result.configs;
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
    const result = await getTrajectoryTokenUsage(
        ls,
        trajectory.cascadeId,
        trajectory.stepCount,
        signal
    );

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
        tokenUsageSource: result.tokenUsageSource,
        cascadeId: trajectory.cascadeId,
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
        checkpointModel: result.checkpointModel,
        ...(result.orchestratorConfig ? { orchestratorConfig: result.orchestratorConfig } : {}),
        // Extended transparency fields
        createdTime: trajectory.createdTime,
        lastUserInputTime: trajectory.lastUserInputTime,
        lastUserInputStepIndex: trajectory.lastUserInputStepIndex,
        repositoryName: trajectory.repositoryName,
        gitOriginUrl: trajectory.gitOriginUrl,
        branchName: trajectory.branchName,
        gitRootUri: trajectory.gitRootUri,
    };
    return refreshWorkflowImageUsage(ls, usage, signal);
}

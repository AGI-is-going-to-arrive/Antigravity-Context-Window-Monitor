import { LSInfo } from './discovery';
import { rpcCall } from './rpc-client';
import {
    getContextLimit,
    getModelDisplayName,
    normalizeModelDisplayName,
    updateModelDisplayNames,
    ModelConfig,
    FullUserStatus,
    UserStatusInfo,
    DEFAULT_CONTEXT_LIMITS,
    DEFAULT_CONTEXT_LIMIT,
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
export function normalizeUri(uri: string): string {
    let normalized = uri;
    // Handle vscode-remote:// URIs — extract just the path portion
    // e.g., vscode-remote://wsl+Ubuntu/home/user/project → /home/user/project
    // e.g., vscode-remote://ssh-remote+host/home/user/project → /home/user/project
    const remoteMatch = normalized.match(/^vscode-remote:\/\/[^/]+(\/.*)/);
    if (remoteMatch) {
        normalized = remoteMatch[1];
    }
    normalized = normalized.replace(/^file:\/\/\//, '/');
    normalized = normalized.replace(/^file:\/\//, '');
    try {
        normalized = decodeURIComponent(normalized);
    } catch {
        // If decoding fails, keep as-is
    }
    // Windows: strip leading / before drive letter (e.g., /c:/ → c:/)
    if (process.platform === 'win32') {
        normalized = normalized.replace(/^\/([a-zA-Z]:)/, '$1');
    }
    normalized = normalized.replace(/\/$/, '');
    if (process.platform === 'darwin' || process.platform === 'win32') {
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

/**
 * Process an array of trajectory steps and compute token usage.
 * Pure function — no RPC calls, no side effects.
 */
export function processSteps(steps: Array<Record<string, unknown>>): TokenUsageResult {
    let toolOutputTokens = 0;
    let model = '';
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
            const selected = plannerConfig?.planModel || plannerConfig?.modelName;
            if (typeof selected === 'string' && selected) { model = selected; }
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
                if (usage.model) { model = usage.model; }
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
        if (stepModel && stepType !== StepType.CHECKPOINT && !imageStep) {
            model = stepModel;
        }

        // requestedModel is highest priority (user's explicit selection)
        const rm = meta.requestedModel as Record<string, unknown> | undefined;
        if (!imageStep && typeof rm?.model === 'string') { model = rm.model; }
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
    const maxSteps = Math.max(totalSteps, 0);
    const allSteps: Array<Record<string, unknown>> = [];
    let hasGaps = false;

    // Build batch ranges
    const batchRanges: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < maxSteps; start += STEP_BATCH_SIZE) {
        batchRanges.push({ start, end: Math.min(start + STEP_BATCH_SIZE, maxSteps) });
    }

    // Process batches in groups to avoid bursting concurrent RPC calls
    for (let groupStart = 0; groupStart < batchRanges.length; groupStart += MAX_CONCURRENT_BATCHES) {
        const group = batchRanges.slice(groupStart, groupStart + MAX_CONCURRENT_BATCHES);
        const groupResults = await Promise.allSettled(
            group.map(({ start, end }) =>
                rpcCall(ls, 'GetCascadeTrajectorySteps', {
                    cascadeId,
                    startIndex: start,
                    endIndex: end
                }, 30000, signal)
            )
        );

        for (let i = 0; i < groupResults.length; i++) {
            const result = groupResults[i];
            if (result.status === 'fulfilled') {
                const steps = result.value.steps as Array<Record<string, unknown>> | undefined;
                if (steps && steps.length > 0) {
                    allSteps.push(...steps);
                }
            } else {
                const { start, end } = group[i];
                console.warn(
                    `[ContextMonitor] Failed to fetch steps batch [${start}-${end}] ` +
                    `for cascade ${cascadeId.substring(0, 8)}: ${result.reason}`
                );
                hasGaps = true;
            }
        }
    }

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
        const userStatus = resp.userStatus as Record<string, unknown> | undefined;
        if (!userStatus) { return { configs: [], userInfo: null }; }

        // ─── Model Configs ───
        const configData = userStatus.cascadeModelConfigData as Record<string, unknown> | undefined;
        const rawConfigs = configData?.clientModelConfigs as Array<Record<string, unknown>> | undefined;
        const configs: ModelConfig[] = (rawConfigs || []).map(c => {
            const qi = c.quotaInfo as Record<string, unknown> | undefined;
            const mimeTypes = c.supportedMimeTypes as Record<string, boolean> | undefined;
            // Proto3 omits float fields when value is 0.0 (the default).
            // Two reasons remainingFraction can be missing:
            //   1. Quota untouched (resetTime is epoch 1970) → treat as 1.0 (full)
            //   2. Quota exhausted (resetTime is real future date) → treat as 0.0
            const resolveRemainingFraction = (q: Record<string, unknown>): number => {
                if (q.remainingFraction != null) { return q.remainingFraction as number; }
                const rt = (q.resetTime as string) || '';
                if (!rt || rt === '1970-01-01T00:00:00Z') { return 1; }
                return 0;
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
                mimeTypeCount: mimeTypes ? Object.keys(mimeTypes).length : 0,
                isRecommended: (c.isRecommended as boolean) || false,
                supportedMimeTypes: mimeTypes ? Object.keys(mimeTypes) : [],
            };
        }).filter(c => c.model && c.label);

        // ─── Plan Info ───
        const planStatus = userStatus.planStatus as Record<string, unknown> | undefined;
        const planInfo = planStatus?.planInfo as Record<string, unknown> | undefined;
        const userTier = userStatus.userTier as Record<string, unknown> | undefined;
        const teamCfg = planInfo?.defaultTeamConfig as Record<string, boolean> | undefined;
        const defaultOverride = configData?.defaultOverrideModelConfig as Record<string, unknown> | undefined;
        const defaultModelId = (defaultOverride?.modelOrAlias as Record<string, unknown>)?.model as string || '';
        const defaultModelCfg = configs.find(c => c.model === defaultModelId);
        const rawCredits = (userTier?.availableCredits as Array<Record<string, unknown>>) || [];

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
            if (typeof v === 'number') { return v; }
            if (typeof v === 'string') { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
            return 0;
        };

        const userInfo: UserStatusInfo | null = planInfo ? {
            name: (userStatus.name as string) || '',
            email: (userStatus.email as string) || '',
            planName: (planInfo.planName as string) || '',
            teamsTier: (planInfo.teamsTier as string) || '',
            monthlyPromptCredits: (planInfo.monthlyPromptCredits as number) || 0,
            monthlyFlowCredits: (planInfo.monthlyFlowCredits as number) || 0,
            availablePromptCredits: (planStatus?.availablePromptCredits as number) ?? 0,
            availableFlowCredits: (planStatus?.availableFlowCredits as number) ?? 0,
            userTierName: (userTier?.name as string) || '',
            userTierId: (userTier?.id as string) || '',
            defaultModelLabel: defaultModelCfg?.label || defaultModelId || '',
            planLimits: {
                maxNumChatInputTokens: parseNum(planInfo.maxNumChatInputTokens),
                maxNumPremiumChatMessages: parseNum(planInfo.maxNumPremiumChatMessages),
                maxCustomChatInstructionCharacters: parseNum(planInfo.maxCustomChatInstructionCharacters),
                maxNumPinnedContextItems: parseNum(planInfo.maxNumPinnedContextItems),
                maxLocalIndexSize: parseNum(planInfo.maxLocalIndexSize),
                monthlyFlexCreditPurchaseAmount: (planInfo.monthlyFlexCreditPurchaseAmount as number) || 0,
            },
            teamConfig: {
                allowMcpServers: teamCfg?.allowMcpServers || false,
                allowAutoRunCommands: teamCfg?.allowAutoRunCommands || false,
                allowBrowserExperimentalFeatures: teamCfg?.allowBrowserExperimentalFeatures || false,
            },
            availableCredits: rawCredits.map(c => ({
                creditType: (c.creditType as string) || '',
                creditAmount: parseNum(c.creditAmount),
                minimumCreditAmountForUsage: parseNum(c.minimumCreditAmountForUsage),
            })),
            // Feature flags
            canBuyMoreCredits: (planInfo.canBuyMoreCredits as boolean) || false,
            browserEnabled: (planInfo.browserEnabled as boolean) || false,
            cascadeWebSearchEnabled: (planInfo.cascadeWebSearchEnabled as boolean) || false,
            knowledgeBaseEnabled: (planInfo.knowledgeBaseEnabled as boolean) || false,
            canGenerateCommitMessages: (planInfo.canGenerateCommitMessages as boolean) || false,
            cascadeCanAutoRunCommands: (planInfo.cascadeCanAutoRunCommands as boolean) || false,
            canAllowCascadeInBackground: (planInfo.canAllowCascadeInBackground as boolean) || false,
            hasAutocompleteFastMode: (planInfo.hasAutocompleteFastMode as boolean) || false,
            allowStickyPremiumModels: (planInfo.allowStickyPremiumModels as boolean) || false,
            allowPremiumCommandModels: (planInfo.allowPremiumCommandModels as boolean) || false,
            hasTabToJump: (planInfo.hasTabToJump as boolean) || false,
            canCustomizeAppIcon: (planInfo.canCustomizeAppIcon as boolean) || false,
            // Deep-mined fields
            userTierDescription: tierDescription,
            upgradeSubscriptionText: upgradeText,
            modelSortOrder,
        } : null;

        // Attach raw LS response for transparency panel
        if (userInfo) {
            userInfo._rawResponse = resp as Record<string, unknown>;
        }

        return { configs, userInfo, rawResponse: resp as Record<string, unknown> };
    } catch {
        return { configs: [], userInfo: null };
    }
}

/**
 * @deprecated Use `fetchFullUserStatus()` instead.
 * Backward-compatible wrapper — returns only model configs (no user info).
 */
export async function fetchModelConfigs(ls: LSInfo, signal?: AbortSignal): Promise<ModelConfig[]> {
    const result = await fetchFullUserStatus(ls, signal);
    return result.configs;
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
    const contextLimit = getContextLimit(effectiveModel, customLimits);
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

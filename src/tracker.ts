import { LSInfo } from './discovery';
import { rpcCall } from './rpc-client';
import { fetchCloudPlanInfo } from './cloud-plan';
import {
    getContextLimit,
    getModelDisplayName,
    updateModelDisplayNames,
    stabilizeUserStatusInfo,
    ModelConfig,
    FullUserStatus,
    UserStatusInfo,
    DEFAULT_CONTEXT_LIMITS,
    DEFAULT_CONTEXT_LIMIT,
} from './models';
import {
    StepType,
    IMAGE_GEN_STEP_KEYWORDS,
    IMAGE_GEN_MODEL_KEYWORDS,
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
    updateModelDisplayNames,
    stabilizeUserStatusInfo,
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
}

export interface TokenUsageResult {
    /** Actual input tokens from the last checkpoint (if available) */
    inputTokens: number;
    /** Actual MODEL output tokens (from checkpoint modelUsage.outputTokens only) */
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
    /** Last checkpoint's modelUsage (if available) */
    lastModelUsage: ModelUsageInfo | null;
    /** Estimated tokens added since the last checkpoint (for debugging/display) */
    estimatedDeltaSinceCheckpoint: number;
    /** Number of image generation steps detected */
    imageGenStepCount: number;
    /** True when step batch fetching had gaps (some batches failed) */
    hasGaps: boolean;
    /** True when consecutive checkpoint inputTokens show a significant drop */
    checkpointCompressionDetected: boolean;
    /** Size of the inputTokens drop between consecutive checkpoints (0 if none) */
    checkpointCompressionDrop: number;
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
    cascadeId: string;
    title: string;
    model: string;
    modelDisplayName: string;
    /** Effective context window usage (inputTokens + outputTokens + estimatedDelta) */
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
    /** Last checkpoint model usage details */
    lastModelUsage: ModelUsageInfo | null;
    /** Estimated tokens added since the last checkpoint */
    estimatedDeltaSinceCheckpoint: number;
    /** Number of image generation steps detected */
    imageGenStepCount: number;
    /** True when context compression was detected. */
    compressionDetected: boolean;
    /** Input token drop between consecutive checkpoints */
    checkpointCompressionDrop: number;
    /** Previous contextUsed before compression was detected (for display) */
    previousContextUsed?: number;
    /** True when step data may be incomplete (batch fetch gaps) */
    hasGaps: boolean;
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

/** Check if a step is an image generation step by type or model. */
function isImageGenStep(stepType: string, stepModel: string): boolean {
    if (IMAGE_GEN_STEP_KEYWORDS.some(kw => stepType.includes(kw))) {
        return true;
    }
    if (stepModel) {
        const lower = stepModel.toLowerCase();
        return IMAGE_GEN_MODEL_KEYWORDS.some(kw => lower.includes(kw));
    }
    return false;
}

/** Extract modelUsage from a checkpoint step's metadata. */
function extractCheckpointModelUsage(meta: Record<string, unknown>): ModelUsageInfo | null {
    const mu = meta.modelUsage as Record<string, unknown> | undefined;
    if (!mu) { return null; }

    const inputTokens = parseInt(String(mu.inputTokens || '0'), 10);
    const outputTokens = parseInt(String(mu.outputTokens || '0'), 10);
    const responseOutputTokens = parseInt(String(mu.responseOutputTokens || '0'), 10);
    const cacheReadTokens = parseInt(String(mu.cacheReadTokens || '0'), 10);
    const model = (mu.model as string) || '';

    if (inputTokens > 0 || outputTokens > 0) {
        return { model, inputTokens, outputTokens, responseOutputTokens, cacheReadTokens };
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
    let imageGenStepCount = 0;
    const imageGenStepIndices = new Set<number>();

    let estimationOverhead = 0;
    let outputTokensSinceCheckpoint = 0;

    let prevCheckpointInputTokens = -1;
    let checkpointCompressionDetected = false;
    let checkpointCompressionDrop = 0;

    for (let globalStepIdx = 0; globalStepIdx < steps.length; globalStepIdx++) {
        const step = steps[globalStepIdx];
        const meta = step.metadata as Record<string, unknown> | undefined;
        const stepType = (step.type as string) || '';

        // Count user input steps
        if (stepType === StepType.USER_INPUT) {
            estimationOverhead += processUserInputStep(step);
        }

        // Count planner response steps
        if (stepType === StepType.PLANNER_RESPONSE) {
            estimationOverhead += processPlannerResponseStep(step);
        }

        // Extract modelUsage from CHECKPOINT steps
        if (stepType === StepType.CHECKPOINT && meta) {
            const usage = extractCheckpointModelUsage(meta);
            if (usage) {
                // Detect compression by comparing consecutive checkpoint inputTokens
                if (prevCheckpointInputTokens > 0 && usage.inputTokens < prevCheckpointInputTokens) {
                    const drop = prevCheckpointInputTokens - usage.inputTokens;
                    if (drop > COMPRESSION_MIN_DROP) {
                        checkpointCompressionDetected = true;
                        checkpointCompressionDrop = drop;
                    }
                }
                prevCheckpointInputTokens = usage.inputTokens;

                lastModelUsage = usage;
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

        // Detect image generation steps
        const stepModel = meta ? ((meta.generatorModel as string) || '') : '';
        if (isImageGenStep(stepType, stepModel) && !imageGenStepIndices.has(globalStepIdx)) {
            imageGenStepIndices.add(globalStepIdx);
            imageGenStepCount++;
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

        // Track the latest model used (for dynamic model switching)
        if (stepModel) { model = stepModel; }

        // Checkpoint modelUsage.model has higher priority than generatorModel
        if (lastModelUsage && lastModelUsage.model) {
            model = lastModelUsage.model;
        }

        // requestedModel is highest priority (user's explicit selection)
        const rm = meta.requestedModel as Record<string, unknown> | undefined;
        if (rm?.model) { model = rm.model as string; }
    }

    const estimatedDelta = outputTokensSinceCheckpoint + estimationOverhead;

    // Priority 1: Use inputTokens + outputTokens from the last checkpoint + estimated delta
    if (lastModelUsage && lastModelUsage.inputTokens > 0) {
        return {
            inputTokens: lastModelUsage.inputTokens,
            totalOutputTokens: lastModelUsage.outputTokens,
            totalToolCallOutputTokens: toolOutputTokens,
            contextUsed: lastModelUsage.inputTokens + lastModelUsage.outputTokens + estimatedDelta,
            isEstimated: estimatedDelta > 0,
            model,
            stepDetails,
            lastModelUsage,
            estimatedDeltaSinceCheckpoint: estimatedDelta,
            imageGenStepCount,
            hasGaps: false,
            checkpointCompressionDetected,
            checkpointCompressionDrop,
        };
    }

    // Fallback: estimate total context window usage
    const estimatedTotal = toolOutputTokens + SYSTEM_PROMPT_OVERHEAD + estimationOverhead;

    return {
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
        hasGaps: false,
        checkpointCompressionDetected: false,
        checkpointCompressionDrop: 0,
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
            return {
                model: ((c.modelOrAlias as Record<string, unknown>)?.model as string) || '',
                label: (c.label as string) || '',
                supportsImages: (c.supportsImages as boolean) || false,
                quotaInfo: qi ? {
                    remainingFraction: (qi.remainingFraction as number) ?? 0, // LS omits field when exhausted
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

        const lsPlanName = (planInfo?.planName as string) || '';
        const lsTeamsTier = (planInfo?.teamsTier as string) || '';
        const lsUserTierName = (userTier?.name as string) || '';
        const cloudPlan = await fetchCloudPlanInfo(ls, signal);
        const displayPlanName = cloudPlan?.displayPlanName || lsPlanName;
        const displayTeamsTier = cloudPlan?.displayTierKey || lsTeamsTier;
        const planDetailName = cloudPlan?.planDetailName || lsUserTierName;
        const effectiveUpgradeText = cloudPlan?.upgradeSubscriptionText || upgradeText;
        const effectivePlanDescription = cloudPlan?.currentTierDescription || tierDescription;

        const userInfo: UserStatusInfo | null = planInfo ? {
            name: (userStatus.name as string) || '',
            email: (userStatus.email as string) || '',
            planName: displayPlanName,
            teamsTier: displayTeamsTier,
            planDetailName,
            planSource: cloudPlan ? (cloudPlan.isStale ? 'cloud-cache' : 'cloud') : 'ls',
            monthlyPromptCredits: (planInfo.monthlyPromptCredits as number) || 0,
            monthlyFlowCredits: (planInfo.monthlyFlowCredits as number) || 0,
            availablePromptCredits: (planStatus?.availablePromptCredits as number) ?? 0,
            availableFlowCredits: (planStatus?.availableFlowCredits as number) ?? 0,
            userTierName: lsUserTierName,
            userTierId: (userTier?.id as string) || '',
            lsPlanName,
            lsTeamsTier,
            cloudTierId: cloudPlan?.currentTierId || '',
            cloudTierName: cloudPlan?.currentTierName || '',
            cloudTierDescription: cloudPlan?.currentTierDescription || '',
            cloudUpgradeSubscriptionUri: cloudPlan?.upgradeSubscriptionUri || '',
            cloudUpgradeSubscriptionType: cloudPlan?.upgradeSubscriptionType || '',
            cloudAllowedTiers: cloudPlan?.allowedTiers || [],
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
            planDescription: effectivePlanDescription,
            upgradeSubscriptionText: effectiveUpgradeText,
            modelSortOrder,
        } : null;

        // Attach raw LS response for transparency panel
        if (userInfo) {
            userInfo._rawResponse = resp as Record<string, unknown>;
            userInfo._rawCloudPlanResponse = cloudPlan?.rawResponse;
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

    return {
        cascadeId: trajectory.cascadeId,
        title: trajectory.summary,
        model: effectiveModel,
        modelDisplayName: getModelDisplayName(effectiveModel),
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
        compressionDetected: result.checkpointCompressionDetected,
        checkpointCompressionDrop: result.checkpointCompressionDrop,
        hasGaps: result.hasGaps,
        // Extended transparency fields
        createdTime: trajectory.createdTime,
        lastUserInputTime: trajectory.lastUserInputTime,
        lastUserInputStepIndex: trajectory.lastUserInputStepIndex,
        repositoryName: trajectory.repositoryName,
        gitOriginUrl: trajectory.gitOriginUrl,
        branchName: trajectory.branchName,
        gitRootUri: trajectory.gitRootUri,
    };
}

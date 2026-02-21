import * as https from 'https';
import * as http from 'http';
import { LSInfo } from './discovery';

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
}

// ─── Token Estimation Constants ──────────────────────────────────────────────
// These are rough estimates used as fallback when no checkpoint data is available.

/** Estimated tokens for system prompt + context injected per execution turn */
const SYSTEM_PROMPT_OVERHEAD = 2000;
/** Estimated tokens per user input message */
const USER_INPUT_OVERHEAD = 500;
/** Estimated tokens per model planner response (no toolCallOutputTokens field) */
const PLANNER_RESPONSE_ESTIMATE = 800;

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
    /** True when context compression was detected (inputTokens dropped between polls) */
    compressionDetected: boolean;
    /** Previous contextUsed before compression was detected (for display) */
    previousContextUsed?: number;
}

// ─── Model Context Limits ─────────────────────────────────────────────────────
// Real model IDs discovered from Antigravity LS via GetUserStatus API.
// Updated: 2026-02-21

const DEFAULT_CONTEXT_LIMITS: Record<string, number> = {
    // Gemini 3.1 Pro (real IDs from live LS)
    'MODEL_PLACEHOLDER_M37': 1_000_000,  // Gemini 3.1 Pro (High)
    'MODEL_PLACEHOLDER_M36': 1_000_000,  // Gemini 3.1 Pro (Low)

    // Gemini 3 Flash
    'MODEL_PLACEHOLDER_M18': 1_000_000,  // Gemini 3 Flash

    // Gemini 3.0 Pro (legacy IDs — user confirms still available)
    '1008': 1_000_000,  // Gemini 3.0 Pro (High)
    '1007': 1_000_000,  // Gemini 3.0 Pro (Low)

    // Also keep the old Flash ID as fallback
    '1018': 1_000_000,  // Gemini 3 Flash (old ID)

    // Internal/system models (discovered from live step metadata)
    'MODEL_PLACEHOLDER_M2': 1_000_000,   // Internal model used by LS for lightweight tasks
    'MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE': 1_000_000,  // Gemini Flash Lite (checkpoint model)

    // Claude models
    'MODEL_PLACEHOLDER_M35': 200_000,  // Claude Sonnet 4.6 (Thinking)
    'MODEL_PLACEHOLDER_M26': 200_000,  // Claude Opus 4.6 (Thinking)

    // Legacy Claude IDs (in case LS returns the old format)
    '334': 200_000,  // Claude Sonnet (Thinking) old ID
    '333': 200_000,  // Claude Sonnet old ID

    // GPT-OSS
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 128_000,  // GPT-OSS 120B (Medium)

    // Legacy GPT ID
    '342': 128_000,  // GPT-OSS 120B old ID
};

const MODEL_DISPLAY_NAMES: Record<string, string> = {
    // Gemini 3.1 Pro
    'MODEL_PLACEHOLDER_M37': 'Gemini 3.1 Pro (High) / Gemini 3.1 Pro (强)',
    'MODEL_PLACEHOLDER_M36': 'Gemini 3.1 Pro (Low) / Gemini 3.1 Pro (弱)',

    // Gemini 3 Flash
    'MODEL_PLACEHOLDER_M18': 'Gemini 3 Flash',

    // Gemini 3.0 Pro (legacy)
    '1008': 'Gemini 3.0 Pro (High) / Gemini 3.0 Pro (强)',
    '1007': 'Gemini 3.0 Pro (Low) / Gemini 3.0 Pro (弱)',
    '1018': 'Gemini 3 Flash',

    // Internal/system models
    'MODEL_PLACEHOLDER_M2': 'Gemini (Internal) / Gemini (内部)',
    'MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE': 'Gemini Flash Lite',

    // Claude
    'MODEL_PLACEHOLDER_M35': 'Claude Sonnet 4.6 (Thinking) / Claude Sonnet 4.6 (思考)',
    'MODEL_PLACEHOLDER_M26': 'Claude Opus 4.6 (Thinking) / Claude Opus 4.6 (思考)',

    // Legacy Claude
    '334': 'Claude Sonnet 4.6 (Thinking) / Claude Sonnet 4.6 (思考)',
    '333': 'Claude Sonnet 4.6',

    // GPT-OSS
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 'GPT-OSS 120B (Medium)',
    '342': 'GPT-OSS 120B (Medium)',
};

const DEFAULT_CONTEXT_LIMIT = 1_000_000;

// ─── RPC Client ───────────────────────────────────────────────────────────────

function rpcCall(ls: LSInfo, endpoint: string, body: Record<string, unknown>, timeoutMs: number = 10000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(body);

        const options: https.RequestOptions = {
            hostname: '127.0.0.1',
            port: ls.port,
            path: `/exa.language_server_pb.LanguageServerService/${endpoint}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Connect-Protocol-Version': '1',
                'x-codeium-csrf-token': ls.csrfToken,
                'Content-Length': Buffer.byteLength(postData)
            },
            timeout: timeoutMs,
            rejectUnauthorized: false
        };

        const transport = ls.useTls ? https : http;
        const req = transport.request(options, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer | string) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data) as Record<string, unknown>);
                } catch (e) {
                    reject(new Error(`Failed to parse RPC response: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.on('timeout', () => { req.destroy(); reject(new Error('RPC timeout')); });
        req.write(postData);
        req.end();
    });
}

// ─── Trajectory Queries ───────────────────────────────────────────────────────

/**
 * Get all cascade trajectories (conversations) from the LS.
 */
export async function getAllTrajectories(ls: LSInfo): Promise<TrajectorySummary[]> {
    const resp = await rpcCall(ls, 'GetAllCascadeTrajectories', {
        metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
    });

    const summaries = resp.trajectorySummaries as Record<string, Record<string, unknown>> | undefined;
    if (!summaries) {
        return [];
    }

    const result: TrajectorySummary[] = [];
    for (const [cascadeId, data] of Object.entries(summaries)) {
        // Extract model from the latest step metadata
        let requestedModel = '';
        let generatorModel = '';

        const latestTask = data.latestTaskBoundaryStep as Record<string, unknown> | undefined;
        const latestNotify = data.latestNotifyUserStep as Record<string, unknown> | undefined;

        // Try to get model from task boundary or notify step
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

        // Extract workspace URIs
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
            workspaceUris
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
 * - Strip file:// prefix
 * - URL-decode (handle %20 etc.)
 * - Remove trailing slash
 * - Lowercase for macOS case-insensitive FS
 */
export function normalizeUri(uri: string): string {
    let normalized = uri;
    // Strip file:// or file:/// prefix
    normalized = normalized.replace(/^file:\/\/\//, '/');
    normalized = normalized.replace(/^file:\/\//, '');
    // URL decode
    try {
        normalized = decodeURIComponent(normalized);
    } catch {
        // If decoding fails, keep as-is
    }
    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');
    // Lowercase for macOS case-insensitive comparison
    normalized = normalized.toLowerCase();
    return normalized;
}

// NOTE: filterByWorkspace, findActiveTrajectory, findMostRecentTrajectory
// were removed in v1.3.0 — workspace filtering is now inlined in extension.ts

/**
 * Get context window usage for a cascade by iterating through steps.
 *
 * Strategy (prioritized):
 * 1. Use modelUsage.inputTokens from the LAST checkpoint step — this is the
 *    precise context window size the model actually received.
 * 2. Fallback: estimate from toolCallOutputTokens + overhead constants.
 *
 * IMPORTANT: endIndex is capped at stepCount to avoid the LS API's
 * wrap-around behavior that returns duplicate step data.
 *
 * This function is called fresh on every poll, so after an Undo/Rewind
 * (which decreases stepCount), only the surviving steps are traversed,
 * automatically giving the correct post-undo token count.
 */
export async function getTrajectoryTokenUsage(
    ls: LSInfo,
    cascadeId: string,
    totalSteps: number
): Promise<TokenUsageResult> {
    let toolOutputTokens = 0;
    let model = '';
    const stepDetails: StepTokenInfo[] = [];
    const executionIds = new Set<string>();
    let userInputCount = 0;
    let plannerResponseCount = 0;
    let lastModelUsage: ModelUsageInfo | null = null;
    let imageGenStepCount = 0;
    /** Track step indices already counted as image-gen to prevent double-counting */
    const imageGenStepIndices = new Set<number>();
    /** Global step index counter across batches */
    let globalStepIdx = 0;

    const BATCH_SIZE = 50;

    // CRITICAL: Cap endIndex at stepCount to prevent duplicate step data.
    // The LS API wraps around when endIndex > stepCount, returning identical
    // steps in a cycle (e.g., steps 0-49 repeated at 50-99, 100-149, etc.)
    const maxSteps = Math.max(totalSteps, 0);

    // Track estimation overhead separately from actual output tokens.
    // estimationOverhead: USER_INPUT_OVERHEAD + PLANNER_RESPONSE_ESTIMATE counts
    // outputTokensSinceCheckpoint: actual toolCallOutputTokens since last checkpoint
    let estimationOverhead = 0;
    let outputTokensSinceCheckpoint = 0;

    for (let start = 0; start < maxSteps; start += BATCH_SIZE) {
        const end = Math.min(start + BATCH_SIZE, maxSteps);

        try {
            const resp = await rpcCall(ls, 'GetCascadeTrajectorySteps', {
                cascadeId,
                startIndex: start,
                endIndex: end
            }, 30000);

            const steps = resp.steps as Array<Record<string, unknown>> | undefined;
            if (!steps || steps.length === 0) { continue; }

            for (const step of steps) {
                const meta = step.metadata as Record<string, unknown> | undefined;
                const stepType = (step.type as string) || '';

                // Count user input steps
                if (stepType === 'CORTEX_STEP_TYPE_USER_INPUT') {
                    userInputCount++;
                    estimationOverhead += USER_INPUT_OVERHEAD;
                }

                // Count planner response steps (model replies without token field)
                if (stepType === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
                    plannerResponseCount++;
                    estimationOverhead += PLANNER_RESPONSE_ESTIMATE;
                }

                // Detect image generation steps (by stepType)
                // Nano Banana Pro is used for image generation within Gemini 3.0/3.1 Pro conversations
                // Use a Set to prevent the same step from being counted twice
                if (stepType.includes('IMAGE') || stepType.includes('GENERATE')) {
                    if (!imageGenStepIndices.has(globalStepIdx)) {
                        imageGenStepIndices.add(globalStepIdx);
                        imageGenStepCount++;
                    }
                }

                // Extract modelUsage from CHECKPOINT steps
                if (stepType === 'CORTEX_STEP_TYPE_CHECKPOINT' && meta) {
                    const mu = meta.modelUsage as Record<string, unknown> | undefined;
                    if (mu) {
                        const inputTokens = parseInt(String(mu.inputTokens || '0'), 10);
                        const outputTokens = parseInt(String(mu.outputTokens || '0'), 10);
                        const responseOutputTokens = parseInt(String(mu.responseOutputTokens || '0'), 10);
                        const cacheReadTokens = parseInt(String(mu.cacheReadTokens || '0'), 10);
                        const muModel = (mu.model as string) || '';

                        // Always keep the LAST checkpoint's modelUsage
                        // (it represents the most recent model context state)
                        if (inputTokens > 0 || outputTokens > 0) {
                            lastModelUsage = {
                                model: muModel,
                                inputTokens,
                                outputTokens,
                                responseOutputTokens,
                                cacheReadTokens
                            };
                            // Reset per-checkpoint counters
                            estimationOverhead = 0;
                            outputTokensSinceCheckpoint = 0;
                        }
                    }
                }

                if (!meta) {
                    // Increment AFTER all checks for this step (no meta = skip remaining)
                    globalStepIdx++;
                    continue;
                }

                // Track unique execution turns
                const execId = meta.executionId as string | undefined;
                if (execId) {
                    executionIds.add(execId);
                }

                const outputTokens = (meta.toolCallOutputTokens as number) || 0;
                const stepModel = (meta.generatorModel as string) || '';

                if (outputTokens > 0) {
                    toolOutputTokens += outputTokens;
                    outputTokensSinceCheckpoint += outputTokens;
                    stepDetails.push({
                        type: stepType,
                        toolCallOutputTokens: outputTokens,
                        model: stepModel
                    });
                }

                // Check generatorModel for image generation models (e.g., nano banana pro)
                // Uses same globalStepIdx as the stepType check above — prevents double-counting
                if (stepModel && (
                    stepModel.toLowerCase().includes('nano') ||
                    stepModel.toLowerCase().includes('banana') ||
                    stepModel.toLowerCase().includes('image')
                )) {
                    if (!imageGenStepIndices.has(globalStepIdx)) {
                        imageGenStepIndices.add(globalStepIdx);
                        imageGenStepCount++;
                    }
                }

                // Track the latest model used (for dynamic model switching)
                if (stepModel) {
                    model = stepModel;
                }

                // Also check requestedModel (higher priority — what user selected)
                const rm = meta.requestedModel as Record<string, unknown> | undefined;
                if (rm?.model) {
                    model = rm.model as string;
                }

                // Increment globalStepIdx at the END of the loop body
                // so both image-gen checks (stepType + model name) use the same index
                globalStepIdx++;
            }
        } catch {
            // Skip failed batch, continue with next
            continue;
        }
    }

    // The estimated delta since the last checkpoint includes both:
    // - Actual output tokens not yet covered by a checkpoint
    // - Estimation overhead (user input + planner response approximations)
    const estimatedDelta = outputTokensSinceCheckpoint + estimationOverhead;

    // Determine context usage:
    // Priority 1: Use inputTokens + outputTokens from the last checkpoint + estimated delta.
    // inputTokens = full prompt context the model received (all history).
    // outputTokens = model's response for the current turn — also occupies the context window.
    // C2 fix: Both input AND output tokens count toward context window occupation.
    // Post-compression, inputTokens naturally drops, giving correct lower values.
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
            imageGenStepCount
        };
    }

    // Fallback: estimate total context window usage
    // SYSTEM_PROMPT_OVERHEAD is counted only ONCE (system prompt exists once in context)
    const estimatedTotal =
        toolOutputTokens +
        SYSTEM_PROMPT_OVERHEAD +
        (userInputCount * USER_INPUT_OVERHEAD) +
        (plannerResponseCount * PLANNER_RESPONSE_ESTIMATE);

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
        imageGenStepCount
    };
}

/**
 * Get the context limit for a model.
 */
export function getContextLimit(
    model: string,
    customLimits?: Record<string, number>
): number {
    if (customLimits?.[model]) {
        return customLimits[model];
    }
    return DEFAULT_CONTEXT_LIMITS[model] || DEFAULT_CONTEXT_LIMIT;
}

/**
 * Get display name for a model.
 */
export function getModelDisplayName(model: string): string {
    return MODEL_DISPLAY_NAMES[model] || model || 'Unknown Model / 未知模型';
}

/**
 * Get full context usage for a specific cascade.
 * usagePercent is NOT capped — allows raw values including >100% which the
 * status bar layer uses to decide whether to show compression indicator.
 */
export async function getContextUsage(
    ls: LSInfo,
    trajectory: TrajectorySummary,
    customLimits?: Record<string, number>
): Promise<ContextUsage> {
    const result = await getTrajectoryTokenUsage(
        ls,
        trajectory.cascadeId,
        trajectory.stepCount
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
        compressionDetected: false,  // Will be set by extension.ts cross-poll comparison
    };
}

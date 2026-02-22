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
    /** CR-C3: True when step batch fetching had gaps (some batches failed) */
    hasGaps: boolean;
    /** v1.5.1: True when consecutive checkpoint inputTokens show a significant drop (> COMPRESSION_MIN_DROP) */
    checkpointCompressionDetected: boolean;
    /** v1.5.1: Size of the inputTokens drop between consecutive checkpoints (0 if none) */
    checkpointCompressionDrop: number;
}

// ─── Token Estimation Constants ──────────────────────────────────────────────
// These are rough estimates used as FALLBACK when no text content or checkpoint
// data is available. v1.4.0: Primary estimation now uses actual step text content.

/** Estimated tokens for system prompt + context injected per execution turn.
 *  Measured at ~10,000 tokens via real Antigravity LS sessions. */
const SYSTEM_PROMPT_OVERHEAD = 10_000;
/** Fallback estimated tokens per user input message (used when text content unavailable) */
const USER_INPUT_OVERHEAD = 500;
/** Fallback estimated tokens per planner response (used when text content unavailable) */
const PLANNER_RESPONSE_ESTIMATE = 800;

// ─── Token Estimation from Text ──────────────────────────────────────────────

/**
 * Estimate token count from raw text content.
 * Uses character-based heuristic: ASCII ~4 chars/token, non-ASCII ~1.5 chars/token.
 * This is more accurate than fixed constants for variable-length inputs.
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
    /** True when context compression was detected.
     *  v1.5.1: Primary signal = checkpoint inputTokens drop (from processSteps).
     *  Fallback signal = cross-poll contextUsed drop (extension.ts), guarded by Undo exclusion. */
    compressionDetected: boolean;
    /** v1.5.1: Input token drop between consecutive checkpoints (0 if unavailable/no drop). */
    checkpointCompressionDrop: number;
    /** Previous contextUsed before compression was detected (for display) */
    previousContextUsed?: number;
    /** CR-C3: True when step data may be incomplete (batch fetch gaps) */
    hasGaps: boolean;
}

// ─── Model Context Limits ─────────────────────────────────────────────────────
// Real model IDs discovered from Antigravity LS via GetUserStatus API.
// Updated: 2026-02-22
//
// L5: These model IDs are the actual internal identifiers returned by the
// Antigravity Language Server's GetUserStatus API. The "MODEL_PLACEHOLDER_Mxx"
// naming is Antigravity's convention for aliased models. Mapping:
//   M37 = Gemini 3.1 Pro (High quality variant)
//   M36 = Gemini 3.1 Pro (Low quality variant)
//   M18 = Gemini 3 Flash
//   M35 = Claude Sonnet 4.6 (Thinking mode)
//   M26 = Claude Opus 4.6 (Thinking mode)
// See also: README.md "Supported Models" section and
// llmdoc/guides/how-to-add-a-new-model.md for adding new models.

const DEFAULT_CONTEXT_LIMITS: Record<string, number> = {
    'MODEL_PLACEHOLDER_M37': 1_000_000,  // Gemini 3.1 Pro (High)
    'MODEL_PLACEHOLDER_M36': 1_000_000,  // Gemini 3.1 Pro (Low)
    'MODEL_PLACEHOLDER_M18': 1_000_000,  // Gemini 3 Flash
    'MODEL_PLACEHOLDER_M35': 200_000,    // Claude Sonnet 4.6 (Thinking)
    'MODEL_PLACEHOLDER_M26': 200_000,    // Claude Opus 4.6 (Thinking)
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 128_000,  // GPT-OSS 120B (Medium)
};

// CR-M2: `let` — this map is mutated at runtime by `updateModelDisplayNames()`
let modelDisplayNames: Record<string, string> = {
    'MODEL_PLACEHOLDER_M37': 'Gemini 3.1 Pro (High) / Gemini 3.1 Pro (强)',
    'MODEL_PLACEHOLDER_M36': 'Gemini 3.1 Pro (Low) / Gemini 3.1 Pro (弱)',
    'MODEL_PLACEHOLDER_M18': 'Gemini 3 Flash',
    'MODEL_PLACEHOLDER_M35': 'Claude Sonnet 4.6 (Thinking) / Claude Sonnet 4.6 (思考)',
    'MODEL_PLACEHOLDER_M26': 'Claude Opus 4.6 (Thinking) / Claude Opus 4.6 (思考)',
    'MODEL_OPENAI_GPT_OSS_120B_MEDIUM': 'GPT-OSS 120B (Medium)',
};

const DEFAULT_CONTEXT_LIMIT = 1_000_000;

// ─── RPC Client ───────────────────────────────────────────────────────────────

/** CR-C2: Maximum response body size (50 MB) to prevent OOM from abnormal responses. */
const MAX_RESPONSE_BODY_SIZE = 50 * 1024 * 1024;

/**
 * Generic Connect-RPC caller.
 * M2 fix: Checks HTTP status code — non-2xx responses are rejected.
 * A1 fix: Supports AbortSignal for cancellation on extension deactivate.
 */
function rpcCall(
    ls: LSInfo,
    endpoint: string,
    body: Record<string, unknown>,
    timeoutMs: number = 10000,
    signal?: AbortSignal
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        // A1: Early abort check
        if (signal?.aborted) {
            reject(new Error('RPC aborted'));
            return;
        }

        // CR-M3: Settled flag prevents double resolve/reject from
        // abort + error event overlap (abort → req.destroy → error event).
        let settled = false;
        const safeResolve = (value: Record<string, unknown>) => {
            if (settled) { return; }
            settled = true;
            cleanupAbortListener();
            resolve(value);
        };
        const safeReject = (err: Error) => {
            if (settled) { return; }
            settled = true;
            cleanupAbortListener();
            reject(err);
        };

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

        // C2: Track abort handler for cleanup after request completes
        let onAbort: (() => void) | undefined;
        const cleanupAbortListener = () => {
            if (onAbort && signal) {
                signal.removeEventListener('abort', onAbort);
                onAbort = undefined;
            }
        };

        const transport = ls.useTls ? https : http;
        const req = transport.request(options, (res) => {
            let data = '';
            let bodySize = 0;
            res.on('data', (chunk: Buffer | string) => {
                // CR-C2: Guard against abnormally large responses
                bodySize += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
                if (bodySize > MAX_RESPONSE_BODY_SIZE) {
                    req.destroy();
                    safeReject(new Error(`RPC response exceeded ${MAX_RESPONSE_BODY_SIZE} bytes`));
                    return;
                }
                data += chunk;
            });
            res.on('end', () => {
                // M2: Check HTTP status code — 4xx/5xx are RPC failures
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    safeReject(new Error(`RPC HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                    return;
                }
                try {
                    safeResolve(JSON.parse(data) as Record<string, unknown>);
                } catch (e) {
                    safeReject(new Error(`Failed to parse RPC response: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', (e) => { safeReject(e as Error); });
        req.on('timeout', () => { req.destroy(); safeReject(new Error('RPC timeout')); });

        // A1: Abort listener — destroy the request on signal abort
        if (signal) {
            onAbort = () => {
                req.destroy();
                safeReject(new Error('RPC aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }

        req.write(postData);
        req.end();
    });
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
 * Process an array of trajectory steps and compute token usage.
 * This is a pure function — no RPC calls, no side effects — making it
 * directly unit-testable with constructed step data.
 *
 * Strategy (prioritized):
 * 1. Use modelUsage.inputTokens from the LAST checkpoint step — this is the
 *    precise context window size the model actually received.
 * 2. Fallback: estimate from toolCallOutputTokens + overhead constants.
 */
/** v1.5.1: Minimum inputTokens drop between consecutive checkpoints to flag as compression.
 *  5000 tokens avoids noise from small fluctuations (e.g., cache vs non-cache runs). */
const COMPRESSION_MIN_DROP = 5000;

export function processSteps(steps: Array<Record<string, unknown>>): TokenUsageResult {
    let toolOutputTokens = 0;
    let model = '';
    const stepDetails: StepTokenInfo[] = [];
    let lastModelUsage: ModelUsageInfo | null = null;
    let imageGenStepCount = 0;
    /** Track step indices already counted as image-gen to prevent double-counting */
    const imageGenStepIndices = new Set<number>();

    // Track estimation overhead separately from actual output tokens.
    // estimationOverhead: content-based estimates or fixed-constant fallbacks
    // outputTokensSinceCheckpoint: actual toolCallOutputTokens since last checkpoint
    let estimationOverhead = 0;
    let outputTokensSinceCheckpoint = 0;

    // v1.5.1: Track checkpoint inputTokens for compression detection (Plan A).
    // A drop in inputTokens between consecutive checkpoints is a reliable
    // compression signal — the LS reports exact values, no estimation needed.
    let prevCheckpointInputTokens = -1; // -1 = no previous checkpoint yet
    let checkpointCompressionDetected = false;
    let checkpointCompressionDrop = 0;

    for (let globalStepIdx = 0; globalStepIdx < steps.length; globalStepIdx++) {
        const step = steps[globalStepIdx];
        const meta = step.metadata as Record<string, unknown> | undefined;
        const stepType = (step.type as string) || '';

        // Count user input steps — use actual text content for estimation
        if (stepType === 'CORTEX_STEP_TYPE_USER_INPUT') {
            const ui = step.userInput as Record<string, unknown> | undefined;
            const userText = (ui?.userResponse as string) || '';
            // Fallback to fixed constant only when the parent object is missing
            // (structural data absence). Empty text = real empty input ≈ 0 tokens.
            const contentTokens = ui
                ? estimateTokensFromText(userText)
                : USER_INPUT_OVERHEAD;
            estimationOverhead += contentTokens;
        }

        // Count planner response steps — use actual text content for estimation
        if (stepType === 'CORTEX_STEP_TYPE_PLANNER_RESPONSE') {
            const pr = step.plannerResponse as Record<string, unknown> | undefined;
            const responseText = (pr?.response as string) || '';
            const thinkingText = (pr?.thinking as string) || '';
            // toolCalls arguments also consume context
            let toolCallsText = '';
            const toolCalls = pr?.toolCalls as Array<Record<string, unknown>> | undefined;
            if (toolCalls) {
                for (const tc of toolCalls) {
                    toolCallsText += (tc.argumentsJson as string) || '';
                }
            }
            const totalText = responseText + thinkingText + toolCallsText;
            // Fallback to fixed constant only when the parent object is missing.
            // Empty text = real empty response ≈ 0 tokens.
            const contentTokens = pr
                ? estimateTokensFromText(totalText)
                : PLANNER_RESPONSE_ESTIMATE;
            estimationOverhead += contentTokens;
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

                // v1.4.0: Log retryInfos token usage (observation mode — NOT added to totals yet)
                const retryInfos = meta.retryInfos as Array<Record<string, unknown>> | undefined;
                if (retryInfos && retryInfos.length > 0) {
                    let retryInputTokens = 0;
                    let retryOutputTokens = 0;
                    for (const retry of retryInfos) {
                        const usage = retry.usage as Record<string, unknown> | undefined;
                        if (usage) {
                            retryInputTokens += parseInt(String(usage.inputTokens || '0'), 10);
                            retryOutputTokens += parseInt(String(usage.outputTokens || '0'), 10);
                        }
                    }
                    // NOTE (CR-M3): Using console.log intentionally here, not outputChannel.
                    // tracker.ts has no dependency on vscode API / outputChannel.
                    // This is observation-mode logging for retryInfos — per v1.4.0 plan,
                    // we log retry token usage to decide in a future version whether
                    // to count them toward context (risk of double-counting with modelUsage).
                    console.log(
                        `[ContextMonitor] Checkpoint retryInfos: ${retryInfos.length} retries, ` +
                        `retryInputTokens=${retryInputTokens}, retryOutputTokens=${retryOutputTokens}, ` +
                        `mainInputTokens=${inputTokens}, mainOutputTokens=${outputTokens}`
                    );
                }

                // Always keep the LAST checkpoint's modelUsage
                // (it represents the most recent model context state)
                if (inputTokens > 0 || outputTokens > 0) {
                    // v1.5.1: Detect compression by comparing consecutive checkpoint inputTokens.
                    // A significant drop indicates the model compressed its context window.
                    // This is immune to Undo false positives because Undo removes steps
                    // (reducing stepCount) but doesn't alter existing checkpoint data.
                    if (prevCheckpointInputTokens > 0 && inputTokens < prevCheckpointInputTokens) {
                        const drop = prevCheckpointInputTokens - inputTokens;
                        if (drop > COMPRESSION_MIN_DROP) {
                            checkpointCompressionDetected = true;
                            checkpointCompressionDrop = drop;
                        }
                    }
                    prevCheckpointInputTokens = inputTokens;

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
            // No metadata — skip remaining meta-dependent processing
            continue;
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

        // CR2-Fix7: Checkpoint modelUsage.model has higher priority than
        // generatorModel because it reflects what the LS actually used for
        // that checkpoint's inference. Applied after generatorModel but
        // before requestedModel (user's explicit selection wins).
        if (lastModelUsage && lastModelUsage.model) {
            model = lastModelUsage.model;
        }

        // Also check requestedModel (highest priority — what user selected)
        const rm = meta.requestedModel as Record<string, unknown> | undefined;
        if (rm?.model) {
            model = rm.model as string;
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
            imageGenStepCount,
            hasGaps: false,  // Set by getTrajectoryTokenUsage caller
            checkpointCompressionDetected,
            checkpointCompressionDrop,
        };
    }

    // Fallback: estimate total context window usage
    // SYSTEM_PROMPT_OVERHEAD is counted only ONCE (system prompt exists once in context)
    // CR-M2: Use estimationOverhead (which already contains per-step content-based
    // estimates or fixed-constant fallbacks) instead of recalculating with fixed constants.
    const estimatedTotal =
        toolOutputTokens +
        SYSTEM_PROMPT_OVERHEAD +
        estimationOverhead;

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
        hasGaps: false,  // Set by getTrajectoryTokenUsage caller
        checkpointCompressionDetected: false, // No checkpoints = no compression detection possible
        checkpointCompressionDrop: 0,
    };
}

/**
 * Get context window usage for a cascade by iterating through steps.
 *
 * Fetches steps in batches from the LS via RPC, then delegates all
 * computation to the pure processSteps() function.
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
    totalSteps: number,
    signal?: AbortSignal
): Promise<TokenUsageResult> {
    const BATCH_SIZE = 50;
    // CR2-Fix6: Limit concurrent RPC calls to prevent overwhelming the LS
    // with too many parallel requests on long conversations.
    const MAX_CONCURRENT_BATCHES = 5;

    // CRITICAL: Cap endIndex at stepCount to prevent duplicate step data.
    // The LS API wraps around when endIndex > stepCount, returning identical
    // steps in a cycle (e.g., steps 0-49 repeated at 50-99, 100-149, etc.)
    const maxSteps = Math.max(totalSteps, 0);

    // Collect all steps from batched RPC calls
    const allSteps: Array<Record<string, unknown>> = [];
    // CR-C3: Track whether any batch failed (data may be incomplete)
    let hasGaps = false;

    // CR-M5: Build batch ranges, then fetch all in parallel for faster loading.
    // Each batch is an independent read-only RPC call for a different step range.
    const batchRanges: Array<{ start: number; end: number }> = [];
    for (let start = 0; start < maxSteps; start += BATCH_SIZE) {
        batchRanges.push({ start, end: Math.min(start + BATCH_SIZE, maxSteps) });
    }

    // CR2-Fix6: Process batches in groups of MAX_CONCURRENT_BATCHES to avoid
    // bursting hundreds of concurrent RPC calls on long conversations.
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

        // Collect steps in order, tracking gaps from failed batches
        for (let i = 0; i < groupResults.length; i++) {
            const result = groupResults[i];
            if (result.status === 'fulfilled') {
                const steps = result.value.steps as Array<Record<string, unknown>> | undefined;
                if (steps && steps.length > 0) {
                    allSteps.push(...steps);
                }
            } else {
                // CR-C3: Log batch failures for debugging
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

/**
 * Get the context limit for a model.
 */
export function getContextLimit(
    model: string,
    customLimits?: Record<string, number>
): number {
    if (customLimits?.[model] !== undefined) {
        // CR2-Fix8: Clamp to minimum 1 to prevent negative or zero limits
        // from user config causing division-by-zero or nonsensical display.
        return Math.max(1, customLimits[model]);
    }
    return DEFAULT_CONTEXT_LIMITS[model] || DEFAULT_CONTEXT_LIMIT;
}

/**
 * Get display name for a model.
 */
export function getModelDisplayName(model: string): string {
    return modelDisplayNames[model] || model || 'Unknown Model / 未知模型';
}

// ─── Dynamic Model Config from GetUserStatus ─────────────────────────────────

export interface ModelConfig {
    model: string;
    label: string;
    supportsImages: boolean;
}

/**
 * Fetch model configurations from the LS GetUserStatus endpoint.
 * Returns display names and capabilities for all available models.
 * Fails silently — returns empty array on error.
 */
export async function fetchModelConfigs(ls: LSInfo, signal?: AbortSignal): Promise<ModelConfig[]> {
    try {
        const resp = await rpcCall(ls, 'GetUserStatus', {
            metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
        }, 10000, signal);
        const userStatus = resp.userStatus as Record<string, unknown> | undefined;
        const configData = userStatus?.cascadeModelConfigData as Record<string, unknown> | undefined;
        const configs = configData?.clientModelConfigs as Array<Record<string, unknown>> | undefined;
        if (!configs) { return []; }

        return configs.map(c => ({
            model: ((c.modelOrAlias as Record<string, unknown>)?.model as string) || '',
            label: (c.label as string) || '',
            supportsImages: (c.supportsImages as boolean) || false,
        })).filter(c => c.model && c.label);
    } catch {
        return [];  // Silent degradation
    }
}

/**
 * Update MODEL_DISPLAY_NAMES with dynamically fetched model configs.
 * Only appends new entries — hardcoded values are preserved as fallback.
 */
export function updateModelDisplayNames(configs: ModelConfig[]): void {
    for (const c of configs) {
        if (c.model && c.label && !modelDisplayNames[c.model]) {
            modelDisplayNames[c.model] = c.label;
        }
    }
}

/**
 * Get full context usage for a specific cascade.
 * usagePercent is NOT capped — allows raw values including >100% which the
 * status bar layer uses to decide whether to show compression indicator.
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
        // v1.5.1: Primary compression signal from checkpoint inputTokens diff.
        // Falls through to extension.ts cross-poll comparison as secondary signal.
        compressionDetected: result.checkpointCompressionDetected,
        checkpointCompressionDrop: result.checkpointCompressionDrop,
        hasGaps: result.hasGaps,
    };
}

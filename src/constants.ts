// ─── Step Type Constants ──────────────────────────────────────────────────────
// Extracted from magic strings used across tracker.ts and extension.ts.

export const StepType = {
    USER_INPUT: 'CORTEX_STEP_TYPE_USER_INPUT',
    PLANNER_RESPONSE: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
    CHECKPOINT: 'CORTEX_STEP_TYPE_CHECKPOINT',
} as const;

// ─── Cascade Status Constants ─────────────────────────────────────────────────

export const CascadeStatus = {
    RUNNING: 'CASCADE_RUN_STATUS_RUNNING',
} as const;

// ─── Image Generation Detection ───────────────────────────────────────────────
// Keywords used to detect image generation steps (by step type or model name).

export const IMAGE_GEN_STEP_KEYWORDS = ['IMAGE', 'GENERATE'] as const;
export const IMAGE_GEN_MODEL_KEYWORDS = ['nano', 'banana', 'image'] as const;

// ─── Token Estimation Constants ──────────────────────────────────────────────
// Rough estimates used as FALLBACK when no text content or checkpoint data
// is available. v1.4.0: Primary estimation now uses actual step text content.

/** Estimated tokens for system prompt + context injected per execution turn.
 *  Measured at ~10,000 tokens via real Antigravity LS sessions. */
export const SYSTEM_PROMPT_OVERHEAD = 10_000;

/** Fallback estimated tokens per user input message (used when text content unavailable) */
export const USER_INPUT_OVERHEAD = 500;

/** Fallback estimated tokens per planner response (used when text content unavailable) */
export const PLANNER_RESPONSE_ESTIMATE = 800;

// ─── Compression Detection ───────────────────────────────────────────────────

/** Minimum inputTokens drop between consecutive checkpoints to flag as compression.
 *  5000 tokens avoids noise from small fluctuations. */
export const COMPRESSION_MIN_DROP = 5000;

// ─── RPC Limits ──────────────────────────────────────────────────────────────

/** Maximum response body size (50 MB) to prevent OOM from abnormal responses. */
export const MAX_RESPONSE_BODY_SIZE = 50 * 1024 * 1024;

/** Maximum number of concurrent RPC batch calls for step fetching. */
export const MAX_CONCURRENT_BATCHES = 5;

/** Number of steps to fetch per RPC call. */
export const STEP_BATCH_SIZE = 50;

// ─── Polling Backoff ─────────────────────────────────────────────────────────

/** Maximum backoff interval for RPC communication failures: 60 seconds. */
export const MAX_BACKOFF_INTERVAL_MS = 60_000;

/** Maximum backoff interval for LS discovery failures: 15 seconds.
 *  Lower than RPC backoff so the extension detects a newly started LS quickly. */
export const MAX_DISCOVERY_BACKOFF_MS = 15_000;

/** Number of poll cycles to persist the compression indicator. */
export const COMPRESSION_PERSIST_POLLS = 3;


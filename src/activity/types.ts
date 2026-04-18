// ─── Activity Types ──────────────────────────────────────────────────────────
// All type definitions for Activity tracking.

import type { GMModelStats } from '../gm-tracker';

// ─── Step Type Classification ────────────────────────────────────────────────

export type StepCategory = 'reasoning' | 'tool' | 'user' | 'system';

export interface StepClassification {
    icon: string;
    label: string;
    category: StepCategory;
}

export interface ModelActivityStats {
    modelName: string;
    userInputs: number;
    reasoning: number;
    toolCalls: number;
    errors: number;
    checkpoints: number;
    totalSteps: number;
    thinkingTimeMs: number;
    toolTimeMs: number;
    inputTokens: number;
    outputTokens: number;
    toolReturnTokens: number;
    toolBreakdown: Record<string, number>;
    /** Estimated steps from stepCount delta (beyond API ~500 step window) */
    estSteps: number;
    /** Earliest observed timestamp for this model in current cycle */
    firstSeenAt?: string;
}

/** A single step event for the timeline */
export interface StepEvent {
    timestamp: string;      // ISO string
    icon: string;
    category: StepCategory;
    model: string;
    detail: string;         // human-readable description
    durationMs: number;
    cascadeId?: string;     // conversation ID for GM correlation
    source?: 'step' | 'gm_user' | 'gm_virtual' | 'estimated';
    modelBasis?: 'step' | 'summary' | 'generator' | 'dominant' | 'gm_exact' | 'gm_placeholder';
    estimatedCount?: number;
    estimatedResolved?: boolean;
    userInput?: string;     // user message preview (category='user')
    fullUserInput?: string; // full user message text (for expand UI)
    aiResponse?: string;    // AI response brief preview (category='reasoning')
    fullAiResponse?: string; // full AI response text (for expand UI)
    browserSub?: string;    // browser sub-step summary
    toolName?: string;      // tool type label (e.g. 'view_file', 'gh/search_issues')
    stepIndex?: number;     // step position within conversation (e.g. 142)
    // ── GM precision data (injected by injectGMData) ──
    gmInputTokens?: number;
    gmOutputTokens?: number;
    gmThinkingTokens?: number;
    gmCacheReadTokens?: number;
    gmCredits?: number;
    gmTTFT?: number;              // seconds
    gmStreamingDuration?: number; // seconds
    gmRetries?: number;
    gmModel?: string;             // responseModel or placeholder model ID
    gmModelAccuracy?: 'exact' | 'placeholder';
    gmPromptSnippet?: string;
    gmPromptSource?: 'none' | 'messagePrompts' | 'messageMetadata';
    gmExecutionId?: string;
    gmLatestStableMessageIndex?: number;
    gmStartStepIndex?: number;
    gmContextTokensUsed?: number;
    /** Stable identity for a real step across shifting API windows */
    stepFingerprint?: string;
}

/** Archived activity snapshot (saved on quota reset) */
export interface ActivityArchive {
    /** ISO: when this period started */
    startTime: string;
    /** ISO: when this period ended (quota reset) */
    endTime: string;
    /** The full summary snapshot */
    summary: ActivitySummary;
    /** Model IDs whose quota reset triggered this archive */
    triggeredBy?: string[];
    /** Preserved timeline events from the archived period */
    recentSteps?: StepEvent[];
}

export interface ArchiveResetOptions {
    startTime?: string;
    endTime?: string;
}

/** Sub-agent token consumption (e.g. FLASH_LITE for checkpoint summaries) */
export interface SubAgentTokenEntry {
    modelId: string;
    displayName: string;
    ownerModel?: string;
    cascadeIds?: string[];       // conversation IDs that generated this consumption
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;     // cache read tokens consumed
    count: number;               // how many checkpoints used this sub-agent
    compressionEvents: number;   // times inputTokens dropped ≥30% vs previous (context compression)
    lastInputTokens: number;     // last checkpoint inputTokens (for compression detection, not displayed)
}

/** Per-checkpoint snapshot for context growth trend */
export interface CheckpointSnapshot {
    timestamp: string;    // ISO
    inputTokens: number;
    outputTokens: number;
    compressed: boolean;  // inputTokens < previous → compression detected
}

/** Per-conversation breakdown */
export interface ConversationBreakdown {
    id: string;           // cascadeId (first 8 chars)
    steps: number;
    inputTokens: number;
    outputTokens: number;
}

export interface ActivitySummary {
    totalUserInputs: number;
    totalReasoning: number;
    totalToolCalls: number;
    totalErrors: number;
    totalCheckpoints: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalToolReturnTokens: number;
    /** Total estimated steps across all models (stepCount delta) */
    estSteps: number;
    modelStats: Record<string, ModelActivityStats>;
    globalToolStats: Record<string, number>;
    recentSteps: StepEvent[];
    sessionStartTime: string;   // ISO
    /** Sub-agent token consumption detected from CHECKPOINT.modelUsage */
    subAgentTokens: SubAgentTokenEntry[];
    /** Context growth trend across checkpoints */
    checkpointHistory: CheckpointSnapshot[];
    /** Per-conversation stats */
    conversationBreakdown: ConversationBreakdown[];
    // ── GM precision aggregates (cached from injectGMData) ──
    gmTotalInputTokens?: number;
    gmTotalOutputTokens?: number;
    gmTotalCacheRead?: number;
    gmTotalCredits?: number;
    gmCoverageRate?: number;    // 0-1 fraction of steps with GM data
    gmTotalRetries?: number;
    /** GM per-model breakdown for model cards */
    gmModelBreakdown?: Record<string, GMModelStats>;
}

/** Serialized form for globalState persistence */
export interface ActivityTrackerState {
    version: 1;
    summary: ActivitySummary;
    trajectoryBaselines: Record<string, {
        stepCount: number;
        processedIndex: number;
        dominantModel?: string;
        requestedModel?: string;
        generatorModel?: string;
    }>;
    warmedUp: boolean;
    archives?: ActivityArchive[];
    /** Cached GM global totals (persisted to prevent flicker on restore) */
    gmTotals?: {
        inputTokens: number;
        outputTokens: number;
        cacheRead: number;
        credits: number;
        retries: number;
    };
    /** Cached GM per-model breakdown */
    gmModelBreakdown?: Record<string, GMModelStats>;
    /** Per-conversation attribution for steps outside the visible Steps API window */
    windowOutsideAttribution?: Record<string, {
        basis: 'estimated' | 'gm_recovered';
        stepsByModel: Record<string, number>;
    }>;
}

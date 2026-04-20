// ─── Activity Module Barrel ──────────────────────────────────────────────────
// Re-exports everything so external consumers can still use:
//   import { ActivityTracker, ActivitySummary, ... } from './activity';

// Types
export type {
    StepCategory,
    StepClassification,
    ModelActivityStats,
    StepEvent,
    ActivityArchive,
    ArchiveResetOptions,
    SubAgentTokenEntry,
    CheckpointSnapshot,
    ConversationBreakdown,
    ActivitySummary,
    ActivityTrackerState,
} from './types';

// Helpers
export {
    classifyStep,
    truncate,
    stepDurationReasoning,
    stepDurationTool,
    extractToolDetail,
    extractToolName,
    buildGMEventKey,
    buildRawStepFingerprint,
    buildLegacyStepEventIdentity,
    isLowSignalPromptSnippet,
    extractNotifyMessage,
    buildGMVirtualPreview,
    sameStepDistribution,
    mergeCountRecord,
    mergeActivityStats,
    mergeGMStats,
    normalizeStepsByModelRecord,
} from './helpers';

// Tracker Class
export { ActivityTracker } from './tracker';

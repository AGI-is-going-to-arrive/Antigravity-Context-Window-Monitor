// ─── Activity Tracker (Barrel Re-export) ─────────────────────────────────────
// This file exists for backward compatibility.
// All logic has been modularized into src/activity/.
// External consumers can continue to:  import { ... } from './activity-tracker';

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
} from './activity';

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
    ActivityTracker,
} from './activity';

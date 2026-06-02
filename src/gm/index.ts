// ─── GM Module Barrel ────────────────────────────────────────────────────────
// Re-exports everything so external consumers can still use:
//   import { GMTracker, GMSummary, ... } from './gm';

// Types
export type {
    GMCompletionConfig,
    TokenBreakdownGroup,
    GMModelAccuracy,
    GMModelSource,
    GMPromptSource,
    GMUserMessageAnchor,
    GMCheckpointSummary,
    GMSystemContextItem,
    GMSystemContextType,
    GMCallEntry,
    GMModelStats,
    GMConversationData,
    GMSummary,
    GMTrackerState,
    UniqueErrorEntry,
    RecentErrorEntry,
    ToolCatalogEntry,
} from './types';
export { cloneTokenBreakdownGroups, cloneGMCallEntry, cloneConversationData, slimCallForPersistence, slimSummaryForPersistence, slimConversationForPersistence } from './types';

// Parser & Enrichment
export {
    parseDuration,
    parseInt0,
    uniqueStrings,
    pickPromptSnippet,
    extractUserMessageAnchors,
    extractCheckpointSummaries,
    extractAISnippetsByStep,
    extractPromptData,
    buildGMMatchKey,
    buildGMArchiveKey,
    mergeGMCallEntries,
    maybeEnrichCallsFromTrajectory,
    extractTrajectoryModelHints,
    applyTrajectoryModelHints,
    shouldEnrichConversation,
    parseGMEntry,
} from './parser';

// Summary
export {
    MAX_RECENT_ERRORS,
    filterGMSummaryByModels,
    mergeGMModelStats,
    normalizeGMSummary,
    buildSummaryFromConversations,
} from './summary';

// Tracker Class
export { GMTracker } from './tracker';

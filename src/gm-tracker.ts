// ─── GM Tracker (Barrel Re-export) ───────────────────────────────────────────
// This file exists for backward compatibility.
// All logic has been modularized into src/gm/.
// External consumers can continue to:  import { ... } from './gm-tracker';

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
} from './gm';

export {
    cloneTokenBreakdownGroups,
    cloneGMCallEntry,
    cloneConversationData,
    slimCallForPersistence,
    slimSummaryForPersistence,
    slimConversationForPersistence,
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
    filterGMSummaryByModels,
    mergeGMModelStats,
    normalizeGMSummary,
    buildSummaryFromConversations,
    GMTracker,
} from './gm';

// ─── IDE Webview Panel Shared Types & Host Bridge ────────────────────────────
// Lightweight interface module decoupling `src/extension.ts` <-> `src/webview-panel.ts`.
// Zero imports from `src/extension.ts` or `src/webview-panel.ts`, breaking the
// circular module dependency cleanly for TypeScript, Vitest, and esbuild bundling.

import type * as vscode from 'vscode';
import type { ContextUsage, TrajectorySummary } from './tracker';
import type { ModelConfig, OrchestratorSettings, UserQuotaSummary, UserStatusInfo } from './models';
import type { ActivityArchive, ActivitySummary, ActivityTracker } from './activity-tracker';
import type { AccountSnapshot } from './activity-panel';
import type { LedgerAccountBucket, LedgerSettledEntry } from './daily-ledger';
import type { ModelPricing, OrchestratorPricingMode, PricingStore } from './pricing-store';
import type { GMConversationData, GMSummary } from './gm-tracker';
import type { StorageDiagnostics, UpdateStatusView } from './webview-settings-tab';
import type { DailyStore } from './daily-store';
import type { MonitorStatus, OverviewDestination } from './monitor-overview';
import type { AppSettings, DurableStateCommitReceipt } from './durable-state';
import type { PersistedModelDNA } from './model-dna-store';
import type { ContextBreakdownSnapshot } from './context-breakdown';
import type { TurnDiagnosticsSummary } from './turn-diagnostics';
import type { QuotaRunwayEstimate } from './quota-runway';
import type { ConversationOption, WindowSelectionState } from './conversation-selector';
import type { LowQuotaWarningState, MonitorStaleState } from './webview-overview-tab';
import type { CliDailyUsageRecord } from './cli-usage-scanner';
import type { UpdateCheckResult } from './app/sidecar-types';
import type { PublishedMonitorObservation } from './core/context-display';
import type { SwarmGroupCostSummary, SwarmTopologySnapshot } from './core/swarm-registry';
import { DEFAULT_APP_SETTINGS } from './durable-state';
import { getRuntimeVersion } from './core/version';

export const OPEN_VSX_EXTENSION_URL = 'https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor';

// ─── Panel Payload ────────────────────────────────────────────────────────────

/** Unified data payload for `showMonitorPanel` / `updateMonitorPanel`. */
export interface PanelPayload {
    currentUsage: ContextUsage | null;
    monitorStatus?: MonitorStatus;
    allTrajectoryUsages: ContextUsage[];
    allTrajectories?: TrajectorySummary[];
    modelConfigs: ModelConfig[];
    userInfo: UserStatusInfo | null;
    workspaceUri?: string;
    context?: vscode.ExtensionContext;
    activitySummary?: ActivitySummary | null;
    initialTab?: OverviewDestination | 'gmdata' | 'pricing';
    archives?: ActivityArchive[];
    activityTracker?: ActivityTracker;
    gmSummary?: GMSummary | null;
    /** Full summary with ALL accounts (no account filtering) — used by Cost tab. */
    gmFullSummary?: GMSummary | null;
    gmConversations?: Record<string, GMConversationData>;
    pricingStore?: PricingStore;
    dailyStore?: DailyStore;
    storageDiagnostics?: StorageDiagnostics;
    modelDNA?: Record<string, PersistedModelDNA>;
    accountSnapshots?: AccountSnapshot[];
    /** DailyLedger: today's active (unsettled) account buckets */
    ledgerDateKey?: string;
    todayLedgerActive?: LedgerAccountBucket[];
    /** DailyLedger: settled entries from quota resets */
    ledgerSettled?: LedgerSettledEntry[];
    /** User custom model prices — applied when re-pricing Today's Ledger from tokens */
    customPricing?: Record<string, ModelPricing>;
    /** Global Orchestrator Settings (Orchestrator Model + Executor Model + roles). */
    orchestratorSettings?: OrchestratorSettings | null;
    /** Dual-window (5h + weekly) quota summary from RetrieveUserQuotaSummary. */
    quotaSummary?: UserQuotaSummary | null;
    /** Today's total estimated cost in USD (active + settled ledger). */
    todayCostUsd?: number;
    /** Current session/active conversation estimated cost in USD. */
    sessionCostUsd?: number;
    /** v1.17.5 Context Composition Breakdown snapshot. */
    contextBreakdown?: ContextBreakdownSnapshot | null;
    /** v1.17.5 Per-turn cache / delta diagnostics. */
    turnDiagnostics?: TurnDiagnosticsSummary | null;
    /** v1.17.5 Per-pool quota burn-rate runway estimates. */
    quotaRunways?: Record<string, QuotaRunwayEstimate>;
    /** v1.17.5 True when active model is a custom-* / BYOK / local model. */
    isCustomModelActive?: boolean;
    /** v1.17.5 Stale-cache status during transient RPC hiccups. */
    staleState?: MonitorStaleState | null;
    /** v1.17.5 Conversation Switcher options. */
    conversationOptions?: ConversationOption[];
    /** v1.17.5 Currently active conversation cascadeId. */
    activeConversationId?: string | null;
    /** v1.17.5 Manually pinned conversation cascadeId (null = Follow Active). */
    pinnedConversationId?: string | null;
    /** v1.17.5 Whether Lock to Main Agent is active. */
    lockToMainAgent?: boolean;
    /** v1.17.6 Scanned Antigravity CLI daily usage records. */
    cliDays?: CliDailyUsageRecord[];
    /** v1.17.6 Orchestrator pricing mode ('mapped' | 'strict'). */
    orchestratorPricingMode?: OrchestratorPricingMode;
    /** v1.17.6+ Shared AppSettings snapshot (for synchronized Settings controls). */
    appSettings?: Partial<AppSettings>;
    /** v1.17.6 Latest release update status view. */
    updateStatus?: UpdateStatusView | null;
    /** v1.17.6 Low-quota warning banner state (when active). */
    lowQuotaWarning?: LowQuotaWarningState | null;
    /** v1.18.0 D9 Unified immutable observation shared with IDE Status Bar. */
    publishedObservation?: PublishedMonitorObservation | null;
    /** v1.18.0 D9 Per-window 3-field lock & inspect selection state. */
    windowSelectionState?: WindowSelectionState | null;
    /** v1.18.0 D9 Authoritative read-only swarm & subagent topology snapshot. */
    swarmTopology?: SwarmTopologySnapshot | null;
    swarmGroupCost?: SwarmGroupCostSummary | null;
}

// ─── Host Bridge Interface ───────────────────────────────────────────────────

export interface SharedAppSettingUpdateResult {
    ok: boolean;
    normalizedKey: string;
    committed?: boolean;
    receipt?: DurableStateCommitReceipt;
    error?: string;
}

export interface SharedOrchestratorModeResult {
    ok: boolean;
    committed: boolean;
    receipt?: DurableStateCommitReceipt;
    error?: string;
}

/**
 * Callback bridge registered by `src/extension.ts` so `src/webview-panel.ts`
 * can invoke extension host services without importing `./extension`.
 */
export interface IdePanelHostBridge {
    removeAccountSnapshot(email: string): AccountSnapshot[];
    getBillingDaysMap(): Record<string, number>;
    setAccountBillingDay(email: string, day: number): boolean;
    refreshStatusBarTelemetry(): void;
    getLockToMainAgent(): boolean;
    setLockToMainAgent(locked?: boolean): boolean;
    getPinnedConversationId?(): string | null;
    selectPinnedConversation(cascadeId: string | null): void;
    refreshSelection?(): void;
    inspectSwarmMember?(cascadeId: string): WindowSelectionState | null;
    clearInspectedSwarmMember?(): WindowSelectionState | null;
    retargetLockedRoot?(cascadeId: string): WindowSelectionState | null;
    getWindowSelectionState?(): WindowSelectionState | null;
    getSharedAppSettings(): AppSettings;
    isSharedAppSettingsHydrated(): boolean;
    updateSharedAppSetting(key: string, value: unknown): Promise<SharedAppSettingUpdateResult>;
    setSharedOrchestratorPricingMode(mode: OrchestratorPricingMode): Promise<SharedOrchestratorModeResult>;
    syncDurableStateFromDisk(refreshUi?: boolean): boolean;
    getCachedCliUsageDays(force?: boolean): CliDailyUsageRecord[];
    checkIdeReleaseUpdates(force?: boolean): Promise<UpdateCheckResult>;
    getLastUpdateStatusView(): UpdateStatusView | null;
    flushDurableState(): Promise<DurableStateCommitReceipt>;
    markDisplayLanguageModified(): void;
}

function makeFallbackCommittedReceipt(): DurableStateCommitReceipt {
    return {
        committed: true,
        revision: 0,
        pendingRevision: 0,
        status: 'committed',
        retryScheduled: false,
    };
}

const DEFAULT_HOST_BRIDGE: IdePanelHostBridge = {
    removeAccountSnapshot: () => [],
    getBillingDaysMap: () => ({}),
    setAccountBillingDay: () => false,
    refreshStatusBarTelemetry: () => {},
    getLockToMainAgent: () => false,
    setLockToMainAgent: (locked) => Boolean(locked),
    selectPinnedConversation: () => {},
    getSharedAppSettings: () => ({ ...DEFAULT_APP_SETTINGS, showNativeHudBar: false, ideShowNativeHudBar: false }),
    isSharedAppSettingsHydrated: () => false,
    updateSharedAppSetting: async (key) => ({
        ok: false,
        normalizedKey: key,
        committed: false,
        error: 'IDE host bridge is not registered',
    }),
    setSharedOrchestratorPricingMode: async () => ({
        ok: false,
        committed: false,
        error: 'IDE host bridge is not registered',
    }),
    syncDurableStateFromDisk: () => false,
    getCachedCliUsageDays: () => [],
    checkIdeReleaseUpdates: async () => ({
        status: 'error',
        currentVersion: getRuntimeVersion(),
        hasUpdate: false,
        checkedAt: Date.now(),
        error: 'IDE host bridge is not registered',
    }),
    getLastUpdateStatusView: () => null,
    flushDurableState: async () => makeFallbackCommittedReceipt(),
    markDisplayLanguageModified: () => {},
};

let registeredHostBridge: IdePanelHostBridge = DEFAULT_HOST_BRIDGE;

/** Register the live IDE extension host bridge for `src/webview-panel.ts`. */
export function registerIdePanelHostBridge(bridge: IdePanelHostBridge): void {
    registeredHostBridge = bridge;
}

/** Read the currently active IDE host bridge (defaults to safe inert fallback). */
export function getIdePanelHostBridge(): IdePanelHostBridge {
    return registeredHostBridge;
}

/** Reset the registered IDE host bridge back to inert defaults (for isolated unit tests). */
export function resetIdePanelHostBridge(): void {
    registeredHostBridge = DEFAULT_HOST_BRIDGE;
}

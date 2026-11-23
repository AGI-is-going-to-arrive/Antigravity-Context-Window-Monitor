// ─── Orchestrator Attribution, Config Fallback & Turn Cache Intelligence ─────
// Pure zero-vscode module providing:
//   1. Cross-platform read-only fallback reader for `~/.gemini/config/config.json`
//      (`userSettings.orchestratorModel`, `orchestratorExecutorModel`, `useAiCredits`).
//   2. Per-call role classification (`'orchestrator' | 'executor' | 'subagent' | 'direct'`)
//      handling Custom Orchestrator concrete models, legacy M537/M667/M681/M669 IDs,
//      same-model orchestrator sessions, and mid-conversation orchestrator reconfigurations.
//   3. Orchestrator ↔ Executor context-switch cold-cache detection (`cacheRead === 0`).
//   4. Reusable Studio Telemetry HTML/CSS helpers for GM Data & Phase B Overview cards
//      (auto-hidden for single-model conversations).
//   5. User-turn first-GM-call cache start classification (`cold` | `partial` | `warm`)
//      and net `+Δ` context growth + dual-watermark re-exports.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { COMPRESSION_MIN_DROP } from './constants';
import type { GMCallEntry } from './gm/types';
import { formatNumber, getLanguage, tBi } from './i18n';
import {
    getModelDisplayName,
    localizePickerEffortLabel,
    normalizeModelDisplayName,
    resolveModelId,
    type OrchestratorSettings,
} from './models';
import {
    costFromTokens,
    formatUsdCost,
    getOrchestratorPricingMode,
    resolvePricingDetail,
    selectPricingModel,
    type ModelPricing,
    type OrchestratorPricingMode,
    type PricingProvenance,
} from './pricing-store';
import {
    computeContextWatermarks,
    evaluateSpeedSample,
    formatCachePercent,
    isInternalCompactionCall,
    LONG_CONTEXT_TIER_THRESHOLD,
    type ContextDualWatermark,
    type ContextDualWatermarkInput,
    type SpeedSampleEvaluation,
    type SpeedSampleInput,
} from './telemetry-metrics';
import { esc, tBiHtml } from './webview-helpers';

export {
    computeContextWatermarks,
    evaluateSpeedSample,
    LONG_CONTEXT_TIER_THRESHOLD,
    type ContextDualWatermark,
    type ContextDualWatermarkInput,
    type SpeedSampleEvaluation,
    type SpeedSampleInput,
};

// ─── Legacy Fixed Orchestrator Identities ────────────────────────────────────

export const LEGACY_ORCHESTRATOR_PLANNER_IDS = new Set<string>([
    'MODEL_PLACEHOLDER_M537', // Orchestrator (Neon)
    'MODEL_PLACEHOLDER_M667', // Orchestrator (Carbon)
    'MODEL_PLACEHOLDER_M681', // Orchestrator (Argon)
]);

export const LEGACY_ORCHESTRATOR_EXECUTOR_IDS = new Set<string>([
    'MODEL_PLACEHOLDER_M669', // Gemini 4 Hydrogen (Orchestrator / Worker)
]);

// ─── Cross-Platform ~/.gemini/config/config.json Fallback Reader ─────────────

export interface ParsedLocalOrchestratorConfig {
    orchestratorModel: string;
    orchestratorExecutorModel: string;
    useAiCredits?: boolean;
}

export interface LocalOrchestratorConfigFile extends ParsedLocalOrchestratorConfig {
    configPath: string;
}

/**
 * Resolve cross-platform Antigravity config path (`~/.gemini/config/config.json`).
 * macOS/Linux: `~/.gemini/config/config.json`
 * Windows: `%USERPROFILE%\.gemini\config\config.json`
 */
export function getAntigravityUserConfigPath(homeDir?: string): string {
    const base = homeDir && homeDir.trim() ? homeDir.trim() : os.homedir();
    return path.join(base, '.gemini', 'config', 'config.json');
}

/**
 * Parse `userSettings.{orchestratorModel, orchestratorExecutorModel, useAiCredits}`
 * from raw Antigravity `config.json` JSON data.
 */
export function parseAntigravityUserConfig(raw: unknown): ParsedLocalOrchestratorConfig | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const root = raw as Record<string, unknown>;
    const userConfig = root.userConfig && typeof root.userConfig === 'object' && !Array.isArray(root.userConfig)
        ? (root.userConfig as Record<string, unknown>)
        : undefined;
    const userSettings = root.userSettings && typeof root.userSettings === 'object' && !Array.isArray(root.userSettings)
        ? (root.userSettings as Record<string, unknown>)
        : userConfig?.userSettings && typeof userConfig.userSettings === 'object' && !Array.isArray(userConfig.userSettings)
            ? (userConfig.userSettings as Record<string, unknown>)
            : undefined;
    if (!userSettings) {
        return null;
    }

    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const orchestratorModel = str(userSettings.orchestratorModel);
    const orchestratorExecutorModel = str(userSettings.orchestratorExecutorModel);
    const hasUseAiCredits = typeof userSettings.useAiCredits === 'boolean';

    if (!orchestratorModel && !orchestratorExecutorModel && !hasUseAiCredits) {
        return null;
    }

    return {
        orchestratorModel,
        orchestratorExecutorModel,
        ...(hasUseAiCredits ? { useAiCredits: userSettings.useAiCredits as boolean } : {}),
    };
}

/**
 * Read-only cross-platform fallback reader for `~/.gemini/config/config.json`.
 * Never throws; returns null when missing, unreadable, or malformed.
 */
export function readLocalOrchestratorConfigFallback(options?: {
    configPath?: string;
    homeDir?: string;
}): LocalOrchestratorConfigFile | null {
    const configPath = options?.configPath && options.configPath.trim()
        ? options.configPath.trim()
        : getAntigravityUserConfigPath(options?.homeDir);
    try {
        const rawText = fs.readFileSync(configPath, 'utf8');
        if (!rawText || !rawText.trim()) { return null; }
        const parsedJson: unknown = JSON.parse(rawText);
        const parsed = parseAntigravityUserConfig(parsedJson);
        if (!parsed) { return null; }
        return {
            ...parsed,
            configPath,
        };
    } catch {
        return null;
    }
}

// ─── Role Attribution & Cold-Cache Switch Types ──────────────────────────────

export type OrchestratorCallRole = 'orchestrator' | 'executor' | 'subagent' | 'direct';
export type RoleSwitchDirection = 'orchestrator_to_executor' | 'executor_to_orchestrator';

export interface ConversationOrchestratorPair {
    planModel: string;
    executionModel: string;
}

/** A per-turn route configuration extracted from USER_INPUT.userConfig.plannerConfig. */
export interface OrchestratorRouteSegment {
    /** Step index where this route took effect. */
    startStepIndex: number;
    /** Planner / Orchestrator model ID (or raw string). */
    planModel: string;
    /** Delegated Executor model ID (empty string when switched back to single-model mode). */
    executionModel: string;
}

export interface OrchestratorSplitOptions {
    orchestratorConfig?: ConversationOrchestratorPair;
    orchestratorHistory?: readonly OrchestratorRouteSegment[];
    orchestratorSettings?: OrchestratorSettings | null;
    orchestratorPricingMode?: OrchestratorPricingMode;
    isSubagentConversation?: boolean;
}

export interface AttributedGMCall {
    callIndex: number;
    call: GMCallEntry;
    canonicalModelId: string;
    role: OrchestratorCallRole;
    isRoleSwitch: boolean;
    switchDirection?: RoleSwitchDirection;
    isColdCacheSwitch: boolean;
    coldSwitchFreshInputTokens: number;
    costUsd: number | null;
    pricingProvenance: PricingProvenance;
    mappedBaseLabel?: string;
}

export interface OrchestratorCacheSwitchEvent {
    callIndex: number;
    createdAt: string;
    fromRole: 'orchestrator' | 'executor';
    toRole: 'orchestrator' | 'executor';
    direction: RoleSwitchDirection;
    fromModel: string;
    toModel: string;
    freshInputTokens: number;
    cacheReadTokens: number;
    isColdCache: boolean;
}

export interface OrchestratorRoleMetrics {
    calls: number;
    models: string[];
    labels: string[];
    primaryLabel: string;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalPromptTokens: number;
    cacheHitRate: number | null;
    costUsd: number | null;
    pricedCalls: number;
    unpricedCalls: number;
    mappedBaseCalls: number;
}

export interface OrchestratorSplitSummary {
    // Backward-compatible fields consumed by statusbar.ts
    plannerLabel: string;
    plannerCalls: number;
    plannerCostUsd: number | null;
    executorLabel: string;
    executorCalls: number;
    executorCostUsd: number | null;
    hasUnpriced: boolean;

    // Rich attribution metrics for GM Data, Overview & App Sidecar
    isMultiModelOrchestrated: boolean;
    isSameModelOrchestrated: boolean;
    hasMidConversationReconfig: boolean;
    distinctModelCount: number;
    orchestrator: OrchestratorRoleMetrics;
    executor: OrchestratorRoleMetrics;
    subagent: OrchestratorRoleMetrics;
    direct: OrchestratorRoleMetrics;
    totalCalls: number;
    totalCostUsd: number | null;
    roleSwitchCount: number;
    coldCacheSwitchCount: number;
    coldCacheSwitchInputTokens: number;
    switches: OrchestratorCacheSwitchEvent[];
    attributedCalls: AttributedGMCall[];
}

// ─── Internal Attribution Helpers ────────────────────────────────────────────

function safeNonNeg(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function isUnspecifiedModel(value: string | undefined): boolean {
    const clean = (value || '').trim().toUpperCase();
    return !clean || clean === 'MODEL_UNSPECIFIED' || clean === 'MODEL_PLACEHOLDER_UNSPECIFIED';
}

function canonicalModel(raw: string | undefined): string {
    const trimmed = (raw || '').trim();
    if (!trimmed || isUnspecifiedModel(trimmed)) { return ''; }
    return resolveModelId(trimmed) || trimmed;
}

function canonicalCallModel(call: Pick<GMCallEntry, 'model' | 'modelDisplay' | 'responseModel'>): string {
    return canonicalModel(call.model)
        || canonicalModel(call.modelDisplay)
        || canonicalModel(call.responseModel)
        || '';
}

function getCallPrimaryStep(call: Pick<GMCallEntry, 'stepIndices' | 'startStepIndex'>): number | null {
    if (Array.isArray(call.stepIndices) && call.stepIndices.length > 0) {
        const valid = call.stepIndices.filter(s => typeof s === 'number' && Number.isFinite(s) && s >= 0);
        if (valid.length > 0) { return Math.min(...valid); }
    }
    if (typeof call.startStepIndex === 'number' && Number.isFinite(call.startStepIndex) && call.startStepIndex >= 0) {
        return call.startStepIndex;
    }
    return null;
}

function isSubagentCall(call: GMCallEntry, isSubagentConversation: boolean): boolean {
    if (isSubagentConversation) { return true; }
    const execId = (call.executionId || '').trim();
    if (execId && /^(?:subagent|swarm[-_]?worker)(?:[-_:]|$)/i.test(execId)) {
        return true;
    }
    if (Array.isArray(call.promptSectionTitles)
        && call.promptSectionTitles.some(t => /^(?:subagent|swarm\s+worker)\b/i.test((t || '').trim()))) {
        return true;
    }
    return false;
}

interface ActiveRouteState {
    planId: string;
    execId: string;
    isSameModel: boolean;
}

function normalizeOptions(
    arg?: ConversationOrchestratorPair | OrchestratorSplitOptions,
): OrchestratorSplitOptions {
    if (!arg) { return {}; }
    if ('planModel' in arg || 'executionModel' in arg) {
        return { orchestratorConfig: arg as ConversationOrchestratorPair };
    }
    return arg as OrchestratorSplitOptions;
}

function createEmptyRoleMetrics(): OrchestratorRoleMetrics {
    return {
        calls: 0,
        models: [],
        labels: [],
        primaryLabel: '',
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalPromptTokens: 0,
        cacheHitRate: null,
        costUsd: null,
        pricedCalls: 0,
        unpricedCalls: 0,
        mappedBaseCalls: 0,
    };
}

function localizedModelLabel(modelId: string, fallbackRaw = ''): string {
    const lang = getLanguage();
    if (!modelId) { return fallbackRaw || '—'; }
    const display = getModelDisplayName(modelId) || normalizeModelDisplayName(modelId) || fallbackRaw || modelId;
    return localizePickerEffortLabel(modelId, display, lang);
}

// ─── Core Role Classification & Split Computation ────────────────────────────

/**
 * Classify every GMCallEntry in a conversation with its role
 * (`'orchestrator' | 'executor' | 'subagent' | 'direct'`) and detect
 * Orchestrator ↔ Executor cold-cache switches (`cacheRead === 0`).
 */
export function classifyConversationCalls(
    calls: readonly GMCallEntry[],
    orchestratorConfigOrOptions?: ConversationOrchestratorPair | OrchestratorSplitOptions,
    customPricing: Record<string, ModelPricing> = {},
): AttributedGMCall[] {
    if (!calls || calls.length === 0) { return []; }

    const opts = normalizeOptions(orchestratorConfigOrOptions);
    const pricingMode = opts.orchestratorPricingMode ?? getOrchestratorPricingMode();
    const isSubagentConv = opts.isSubagentConversation === true;

    // Sort history segments ascending by startStepIndex
    const sortedHistory: Array<{ startStepIndex: number; planId: string; execId: string }> =
        (opts.orchestratorHistory || [])
            .filter(seg => typeof seg.startStepIndex === 'number' && Number.isFinite(seg.startStepIndex) && seg.startStepIndex >= 0)
            .map(seg => ({
                startStepIndex: seg.startStepIndex,
                planId: canonicalModel(seg.planModel),
                execId: canonicalModel(seg.executionModel),
            }))
            .sort((a, b) => a.startStepIndex - b.startStepIndex);

    // Pass 1: Discover per-call route announcements (calls carrying `executionModel`)
    // so earlier planner calls before the first delegation turn in the same segment
    // can inherit the announced route if no history segment contradicts it.
    interface CallRouteAnchor {
        callIndex: number;
        planId: string;
        execId: string;
        isSameModel: boolean;
    }
    const callAnchors: CallRouteAnchor[] = [];
    for (let i = 0; i < calls.length; i++) {
        const c = calls[i];
        const cid = canonicalCallModel(c);
        const execId = canonicalModel(c.executionModel);
        if (cid && execId) {
            callAnchors.push({ callIndex: i, planId: cid, execId, isSameModel: cid === execId });
        } else if (LEGACY_ORCHESTRATOR_PLANNER_IDS.has(cid)) {
            callAnchors.push({ callIndex: i, planId: cid, execId: 'MODEL_PLACEHOLDER_M669', isSameModel: false });
        }
    }

    const fallbackPlanId = canonicalModel(opts.orchestratorConfig?.planModel);
    const fallbackExecId = canonicalModel(opts.orchestratorConfig?.executionModel);
    const fallbackRoute: ActiveRouteState | null = fallbackPlanId && fallbackExecId
        ? { planId: fallbackPlanId, execId: fallbackExecId, isSameModel: fallbackPlanId === fallbackExecId }
        : null;

    const historySegmentAt = (step: number | null): { planId: string; execId: string } | null => {
        if (sortedHistory.length === 0 || step === null) { return null; }
        let matched: { startStepIndex: number; planId: string; execId: string } | null = null;
        for (const seg of sortedHistory) {
            if (seg.startStepIndex <= step) {
                matched = seg;
            } else {
                break;
            }
        }
        return matched;
    };

    // Pass 2: Classify calls in chronological order and detect cold-cache role switches.
    const attributed: AttributedGMCall[] = [];
    let currentDynamicRoute: ActiveRouteState | null = null;
    let prevRole: OrchestratorCallRole | null = null;
    let prevRoleWasOrchestratorInSameModel = false;

    for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        const cid = canonicalCallModel(call);
        const callExecId = canonicalModel(call.executionModel);
        const callStep = getCallPrimaryStep(call);
        const histSeg = historySegmentAt(callStep);

        let role: OrchestratorCallRole = 'direct';

        if (isSubagentCall(call, isSubagentConv)) {
            role = 'subagent';
        } else if (LEGACY_ORCHESTRATOR_PLANNER_IDS.has(cid)) {
            role = 'orchestrator';
            currentDynamicRoute = {
                planId: cid,
                execId: callExecId || 'MODEL_PLACEHOLDER_M669',
                isSameModel: false,
            };
        } else if (LEGACY_ORCHESTRATOR_EXECUTOR_IDS.has(cid)) {
            role = 'executor';
        } else if (cid && callExecId) {
            // Explicit plannerConfig.planExecuteConfig.executionModel on this GM call
            role = 'orchestrator';
            currentDynamicRoute = {
                planId: cid,
                execId: callExecId,
                isSameModel: cid === callExecId,
            };
            prevRoleWasOrchestratorInSameModel = cid === callExecId;
        } else if (histSeg) {
            // Authoritative per-turn trajectory USER_INPUT route segment
            if (!histSeg.execId) {
                // Explicitly switched back to direct single-model mode
                role = 'direct';
                currentDynamicRoute = null;
                prevRoleWasOrchestratorInSameModel = false;
            } else if (histSeg.planId === histSeg.execId) {
                // Same-model orchestrator configured at this turn
                currentDynamicRoute = { planId: histSeg.planId, execId: histSeg.execId, isSameModel: true };
                if (cid === histSeg.planId) {
                    const hasExplicitPlannerAnchor = callAnchors.some(a => a.isSameModel && a.planId === cid);
                    if (hasExplicitPlannerAnchor && prevRoleWasOrchestratorInSameModel) {
                        role = 'executor';
                    } else if (!hasExplicitPlannerAnchor && prevRole === 'orchestrator' && safeNonNeg(call.cacheReadTokens) === 0 && (safeNonNeg(call.inputTokens) + safeNonNeg(call.cacheCreationTokens)) > 0) {
                        role = 'executor';
                    } else {
                        role = 'orchestrator';
                    }
                } else {
                    role = 'direct';
                }
            } else {
                currentDynamicRoute = { planId: histSeg.planId, execId: histSeg.execId, isSameModel: false };
                if (cid === histSeg.planId) {
                    role = 'orchestrator';
                } else if (cid === histSeg.execId) {
                    role = 'executor';
                } else {
                    role = 'direct';
                }
            }
        } else {
            // Resolve active route: prefer latest dynamic route, else upcoming first anchor
            // (for initial planner turns before the final planning turn emitted executionModel),
            // else fallback conversation orchestratorConfig.
            let activeRoute = currentDynamicRoute;
            if (!activeRoute && callAnchors.length > 0) {
                const upcoming = callAnchors.find(a => a.callIndex >= i);
                if (upcoming && (cid === upcoming.planId || cid === upcoming.execId)) {
                    activeRoute = {
                        planId: upcoming.planId,
                        execId: upcoming.execId,
                        isSameModel: upcoming.isSameModel,
                    };
                }
            }
            if (!activeRoute) {
                activeRoute = fallbackRoute;
            }

            if (activeRoute) {
                if (activeRoute.isSameModel) {
                    if (cid === activeRoute.planId) {
                        // In same-model orchestrator mode, calls with `executionModel` were classified
                        // `'orchestrator'` above; follow-up calls without `executionModel` execute delegated work.
                        const hasExplicitPlannerAnchor = callAnchors.some(a => a.isSameModel && a.planId === cid);
                        if (hasExplicitPlannerAnchor && prevRoleWasOrchestratorInSameModel) {
                            role = 'executor';
                        } else if (!hasExplicitPlannerAnchor && prevRole === 'orchestrator'
                            && safeNonNeg(call.cacheReadTokens) === 0
                            && (safeNonNeg(call.inputTokens) + safeNonNeg(call.cacheCreationTokens)) > 0) {
                            role = 'executor';
                        } else {
                            role = 'orchestrator';
                        }
                    } else {
                        role = 'direct';
                    }
                } else if (cid === activeRoute.planId) {
                    role = 'orchestrator';
                } else if (cid === activeRoute.execId) {
                    role = 'executor';
                } else {
                    role = 'direct';
                }
            }
        }

        // Cold-cache context switch detection (Orchestrator <-> Executor)
        let isRoleSwitch = false;
        let switchDirection: RoleSwitchDirection | undefined;
        let isColdCacheSwitch = false;
        let coldSwitchFreshInputTokens = 0;

        const compaction = isInternalCompactionCall(call);
        if (!compaction && prevRole !== null && prevRole !== role) {
            if (prevRole === 'orchestrator' && role === 'executor') {
                isRoleSwitch = true;
                switchDirection = 'orchestrator_to_executor';
            } else if (prevRole === 'executor' && role === 'orchestrator') {
                isRoleSwitch = true;
                switchDirection = 'executor_to_orchestrator';
            }
            if (isRoleSwitch) {
                const freshIn = safeNonNeg(call.inputTokens);
                const cacheRead = safeNonNeg(call.cacheReadTokens);
                const cacheCreate = safeNonNeg(call.cacheCreationTokens);
                const totalPrompt = freshIn + cacheRead + cacheCreate;
                if (cacheRead === 0 && totalPrompt > 0) {
                    isColdCacheSwitch = true;
                    coldSwitchFreshInputTokens = freshIn;
                }
            }
        }

        if (!compaction) {
            prevRole = role;
        }

        // Per-call pricing & provenance
        const pricingModel = selectPricingModel(call.model || call.modelDisplay, call.responseModel, customPricing);
        const detail = resolvePricingDetail(pricingModel, customPricing, {
            at: call.createdAt || '',
            orchestratorPricingMode: pricingMode,
        });
        const costUsd = detail.pricing ? costFromTokens(call, detail.pricing) : null;

        attributed.push({
            callIndex: i,
            call,
            canonicalModelId: cid,
            role,
            isRoleSwitch,
            ...(switchDirection ? { switchDirection } : {}),
            isColdCacheSwitch,
            coldSwitchFreshInputTokens,
            costUsd,
            pricingProvenance: detail.provenance,
            ...(detail.mappedBaseLabel ? { mappedBaseLabel: detail.mappedBaseLabel } : {}),
        });
    }

    return attributed;
}

/**
 * Compute full Orchestrator vs Executor (and Subagent / Direct) attribution split,
 * token/cost totals, cache hit rates, mid-conversation reconfiguration flags,
 * and cold-cache context switch telemetry.
 *
 * Returns `null` when `calls` is empty or contains zero Orchestrator and zero Executor calls
 * (e.g. a pure single-model direct conversation).
 */
export function computeOrchestratorSplit(
    calls: readonly GMCallEntry[],
    orchestratorConfigOrOptions?: ConversationOrchestratorPair | OrchestratorSplitOptions,
    customPricing: Record<string, ModelPricing> = {},
): OrchestratorSplitSummary | null {
    if (!calls || calls.length === 0) { return null; }

    const opts = normalizeOptions(orchestratorConfigOrOptions);
    const attributedCalls = classifyConversationCalls(calls, opts, customPricing);

    const roleBuckets: Record<OrchestratorCallRole, OrchestratorRoleMetrics> = {
        orchestrator: createEmptyRoleMetrics(),
        executor: createEmptyRoleMetrics(),
        subagent: createEmptyRoleMetrics(),
        direct: createEmptyRoleMetrics(),
    };
    const roleModelCounts: Record<OrchestratorCallRole, Map<string, number>> = {
        orchestrator: new Map(),
        executor: new Map(),
        subagent: new Map(),
        direct: new Map(),
    };

    const distinctModels = new Set<string>();
    const switches: OrchestratorCacheSwitchEvent[] = [];
    let coldCacheSwitchCount = 0;
    let coldCacheSwitchInputTokens = 0;
    let totalCostSum = 0;
    let anyPricedCall = false;
    let hasUnpriced = false;

    for (let i = 0; i < attributedCalls.length; i++) {
        const entry = attributedCalls[i];
        const c = entry.call;
        const bucket = roleBuckets[entry.role];
        const modelCounts = roleModelCounts[entry.role];

        if (entry.canonicalModelId) {
            distinctModels.add(entry.canonicalModelId);
            modelCounts.set(entry.canonicalModelId, (modelCounts.get(entry.canonicalModelId) || 0) + 1);
            if (!bucket.models.includes(entry.canonicalModelId)) {
                bucket.models.push(entry.canonicalModelId);
                bucket.labels.push(localizedModelLabel(entry.canonicalModelId, c.modelDisplay || c.responseModel));
            }
        }

        const freshIn = safeNonNeg(c.inputTokens);
        const out = safeNonNeg(c.outputTokens);
        const think = safeNonNeg(c.thinkingTokens);
        const cacheRead = safeNonNeg(c.cacheReadTokens);
        const cacheCreate = safeNonNeg(c.cacheCreationTokens);
        const totalPrompt = freshIn + cacheRead + cacheCreate;

        bucket.calls++;
        bucket.inputTokens += freshIn;
        bucket.outputTokens += out;
        bucket.thinkingTokens += think;
        bucket.cacheReadTokens += cacheRead;
        bucket.cacheCreationTokens += cacheCreate;
        bucket.totalPromptTokens += totalPrompt;

        if (entry.costUsd !== null) {
            bucket.costUsd = (bucket.costUsd ?? 0) + entry.costUsd;
            bucket.pricedCalls++;
            totalCostSum += entry.costUsd;
            anyPricedCall = true;
            if (entry.pricingProvenance === 'mapped_base') {
                bucket.mappedBaseCalls++;
            }
        } else {
            bucket.unpricedCalls++;
            if (entry.role === 'orchestrator' || entry.role === 'executor') {
                hasUnpriced = true;
            }
        }

        if (entry.isRoleSwitch && entry.switchDirection) {
            const fromRole: 'orchestrator' | 'executor' = entry.switchDirection === 'orchestrator_to_executor' ? 'orchestrator' : 'executor';
            const toRole: 'orchestrator' | 'executor' = entry.switchDirection === 'orchestrator_to_executor' ? 'executor' : 'orchestrator';
            // Find immediate previous non-compaction attributed call
            let prevModel = '';
            for (let j = i - 1; j >= 0; j--) {
                if (!isInternalCompactionCall(attributedCalls[j].call)) {
                    prevModel = attributedCalls[j].canonicalModelId;
                    break;
                }
            }
            switches.push({
                callIndex: entry.callIndex,
                createdAt: c.createdAt || '',
                fromRole,
                toRole,
                direction: entry.switchDirection,
                fromModel: prevModel,
                toModel: entry.canonicalModelId,
                freshInputTokens: freshIn,
                cacheReadTokens: cacheRead,
                isColdCache: entry.isColdCacheSwitch,
            });
            if (entry.isColdCacheSwitch) {
                coldCacheSwitchCount++;
                coldCacheSwitchInputTokens += entry.coldSwitchFreshInputTokens;
            }
        }
    }

    const orchBucket = roleBuckets.orchestrator;
    const execBucket = roleBuckets.executor;
    if (orchBucket.calls === 0 && execBucket.calls === 0) {
        return null;
    }

    // Finalize cache hit rates & primary labels per role
    for (const role of ['orchestrator', 'executor', 'subagent', 'direct'] as const) {
        const bucket = roleBuckets[role];
        bucket.cacheHitRate = bucket.totalPromptTokens > 0
            ? Math.max(0, Math.min(1, bucket.cacheReadTokens / bucket.totalPromptTokens))
            : null;
        // Dominant model (tie-break: latest model in bucket.models)
        let bestId = '';
        let bestCount = -1;
        for (const [mId, cnt] of roleModelCounts[role].entries()) {
            if (cnt >= bestCount) {
                bestCount = cnt;
                bestId = mId;
            }
        }
        bucket.primaryLabel = bestId ? localizedModelLabel(bestId) : '';
    }

    // Fallback planner/executor labels from orchestratorConfig when one side has 0 calls so far
    const cfgPlanId = canonicalModel(opts.orchestratorConfig?.planModel);
    const cfgExecId = canonicalModel(opts.orchestratorConfig?.executionModel);
    const plannerLabel = orchBucket.primaryLabel
        || (cfgPlanId ? localizedModelLabel(cfgPlanId) : '');
    const executorLabel = execBucket.primaryLabel
        || (cfgExecId ? localizedModelLabel(cfgExecId) : '');

    // Detect same-model orchestrator & mid-conversation reconfigurations
    const isSameModelOrchestrated = Boolean(
        (orchBucket.models.length === 1 && execBucket.models.length === 1 && orchBucket.models[0] === execBucket.models[0])
        || (cfgPlanId && cfgExecId && cfgPlanId === cfgExecId)
        || (opts.orchestratorHistory || []).some(s => {
            const p = canonicalModel(s.planModel);
            const e = canonicalModel(s.executionModel);
            return Boolean(p && e && p === e);
        }),
    );

    const distinctHistoryPairs = new Set(
        (opts.orchestratorHistory || [])
            .map(s => `${canonicalModel(s.planModel)}->${canonicalModel(s.executionModel)}`)
            .filter(pair => pair !== '->'),
    );
    const hasMidConversationReconfig = orchBucket.models.length > 1
        || execBucket.models.length > 1
        || distinctHistoryPairs.size > 1;

    const isMultiModelOrchestrated = (orchBucket.calls > 0 && execBucket.calls > 0)
        || (distinctModels.size >= 2 && (orchBucket.calls > 0 || execBucket.calls > 0));

    return {
        plannerLabel,
        plannerCalls: orchBucket.calls,
        plannerCostUsd: orchBucket.pricedCalls > 0 ? orchBucket.costUsd : null,
        executorLabel,
        executorCalls: execBucket.calls,
        executorCostUsd: execBucket.pricedCalls > 0 ? execBucket.costUsd : null,
        hasUnpriced,

        isMultiModelOrchestrated,
        isSameModelOrchestrated,
        hasMidConversationReconfig,
        distinctModelCount: distinctModels.size,
        orchestrator: orchBucket,
        executor: execBucket,
        subagent: roleBuckets.subagent,
        direct: roleBuckets.direct,
        totalCalls: attributedCalls.length,
        totalCostUsd: anyPricedCall ? totalCostSum : null,
        roleSwitchCount: switches.length,
        coldCacheSwitchCount,
        coldCacheSwitchInputTokens,
        switches,
        attributedCalls,
    };
}

// ─── User-Turn First-GM-Call Cache State & Net +Δ Growth ─────────────────────

export type TurnCacheStartState = 'cold' | 'partial' | 'warm' | 'unknown';

const TURN_COLD_THRESHOLD_PCT = 10;
const TURN_WARM_THRESHOLD_PCT = 70;

export interface FirstCallCacheClassification {
    cacheStart: TurnCacheStartState;
    cacheHitRate: number | null;
    cacheHitPct: number | null;
    totalPromptTokens: number;
}

/**
 * Classify a call's prompt-cache start state using Antigravity's additive prompt semantics:
 *   totalPrompt = freshInput + cacheRead + cacheCreation
 *   - `< 10%` (including `cacheRead === 0`) -> `'cold'`
 *   - `10% .. < 70%` -> `'partial'`
 *   - `>= 70%` -> `'warm'`
 *   - `totalPrompt <= 0` -> `'unknown'`
 */
export function classifyFirstCallCacheStart(
    inputTokens: number | undefined,
    cacheReadTokens: number | undefined,
    cacheCreationTokens?: number | undefined,
): FirstCallCacheClassification {
    const fresh = safeNonNeg(inputTokens);
    const read = safeNonNeg(cacheReadTokens);
    const create = safeNonNeg(cacheCreationTokens);
    const totalPromptTokens = fresh + read + create;
    if (totalPromptTokens <= 0) {
        return { cacheStart: 'unknown', cacheHitRate: null, cacheHitPct: null, totalPromptTokens: 0 };
    }
    const cacheHitRate = Math.max(0, Math.min(1, read / totalPromptTokens));
    const cacheHitPct = Math.round(cacheHitRate * 1000) / 10;
    const cacheStart: TurnCacheStartState = cacheHitPct < TURN_COLD_THRESHOLD_PCT
        ? 'cold'
        : cacheHitPct < TURN_WARM_THRESHOLD_PCT
            ? 'partial'
            : 'warm';
    return { cacheStart, cacheHitRate, cacheHitPct, totalPromptTokens };
}

export interface UserTurnCacheState {
    /** 1-based user turn index. */
    turnIndex: number;
    /** 0-based index of this turn's first GM call in the filtered call list. */
    firstCallIndex: number;
    /** Total GM calls executed inside this user turn. */
    callCount: number;
    firstStepIndex?: number;
    createdAt: string;
    model: string;
    firstCallRole: OrchestratorCallRole;
    cacheStart: TurnCacheStartState;
    cacheHitRate: number | null;
    cacheHitPct: number | null;
    firstCallPromptTokens: number;
    firstCallFreshInputTokens: number;
    firstCallCacheReadTokens: number;
    lastCallPromptTokens: number;
    /** Net context growth (+Δ) compared to previous user turn's first GM call (null on turn 1). */
    netContextDeltaTokens: number | null;
    /** Context growth within this user turn (lastCallPromptTokens - firstCallPromptTokens). */
    intraTurnGrowthTokens: number;
    /** True when netContextDeltaTokens drops below -COMPRESSION_MIN_DROP. */
    isCompactionDrop: boolean;
    /** True when an Orchestrator <-> Executor cold-cache switch happened inside this turn. */
    hadColdCacheSwitch: boolean;
}

export interface UserTurnCacheSummary {
    turns: UserTurnCacheState[];
    latestTurn: UserTurnCacheState | null;
    coldCount: number;
    partialCount: number;
    warmCount: number;
    unknownCount: number;
}

function getLatestAnchorStep(call: GMCallEntry): number | null {
    if (!Array.isArray(call.userMessageAnchors) || call.userMessageAnchors.length === 0) {
        return null;
    }
    let maxStep = -1;
    for (const anchor of call.userMessageAnchors) {
        if (typeof anchor.stepIndex === 'number' && Number.isFinite(anchor.stepIndex) && anchor.stepIndex > maxStep) {
            maxStep = anchor.stepIndex;
        }
    }
    return maxStep >= 0 ? maxStep : null;
}

/**
 * Group a conversation's GM calls into user turns and classify each user turn's
 * first GM call as `cold` / `partial` / `warm` cache start + net `+Δ` context growth.
 */
export function analyzeUserTurnCacheStates(
    calls: readonly GMCallEntry[],
    options?: OrchestratorSplitOptions & { userTurnStepIndices?: readonly number[] },
): UserTurnCacheSummary {
    const empty: UserTurnCacheSummary = {
        turns: [],
        latestTurn: null,
        coldCount: 0,
        partialCount: 0,
        warmCount: 0,
        unknownCount: 0,
    };
    if (!calls || calls.length === 0) { return empty; }

    const nonCompaction = calls.filter(c => !isInternalCompactionCall(c));
    if (nonCompaction.length === 0) { return empty; }

    const attributed = classifyConversationCalls(nonCompaction, options);
    const explicitBoundaries = (options?.userTurnStepIndices || [])
        .filter(s => typeof s === 'number' && Number.isFinite(s) && s >= 0)
        .sort((a, b) => a - b);

    const resolveTurnBucket = (call: GMCallEntry, idx: number): string => {
        // Priority 1: Explicit USER_INPUT step boundaries from trajectory
        if (explicitBoundaries.length > 0) {
            const step = getCallPrimaryStep(call);
            if (step !== null) {
                let boundary = -1;
                for (const b of explicitBoundaries) {
                    if (b <= step) { boundary = b; } else { break; }
                }
                if (boundary >= 0) { return `step:${boundary}`; }
            }
        }
        // Priority 2: User message anchor progression inside GM metadata
        const anchorStep = getLatestAnchorStep(call);
        if (anchorStep !== null) {
            return `anchor:${anchorStep}`;
        }
        // Priority 3: Distinct executionId groups (if executionIds actually vary or group calls)
        if (call.executionId && call.executionId.trim()) {
            return `exec:${call.executionId.trim()}`;
        }
        // Fallback: each call is its own turn
        return `call:${idx}`;
    };

    const groups: AttributedGMCall[][] = [];
    let currentKey = '';
    for (let i = 0; i < attributed.length; i++) {
        const entry = attributed[i];
        const key = resolveTurnBucket(entry.call, i);
        if (groups.length === 0 || key !== currentKey) {
            groups.push([entry]);
            currentKey = key;
        } else {
            groups[groups.length - 1].push(entry);
        }
    }

    const turns: UserTurnCacheState[] = [];
    let prevFirstPrompt: number | null = null;
    let coldCount = 0;
    let partialCount = 0;
    let warmCount = 0;
    let unknownCount = 0;

    for (let t = 0; t < groups.length; t++) {
        const group = groups[t];
        const first = group[0];
        const last = group[group.length - 1];
        const firstCall = first.call;
        const lastCall = last.call;

        const firstCache = classifyFirstCallCacheStart(
            firstCall.inputTokens,
            firstCall.cacheReadTokens,
            firstCall.cacheCreationTokens,
        );
        const lastPromptTokens = safeNonNeg(lastCall.inputTokens)
            + safeNonNeg(lastCall.cacheReadTokens)
            + safeNonNeg(lastCall.cacheCreationTokens);

        const netContextDeltaTokens = (prevFirstPrompt !== null && firstCache.totalPromptTokens > 0)
            ? firstCache.totalPromptTokens - prevFirstPrompt
            : null;
        const isCompactionDrop = netContextDeltaTokens !== null && netContextDeltaTokens < -COMPRESSION_MIN_DROP;
        const intraTurnGrowthTokens = (lastPromptTokens > 0 && firstCache.totalPromptTokens > 0)
            ? lastPromptTokens - firstCache.totalPromptTokens
            : 0;
        const hadColdCacheSwitch = group.some(item => item.isColdCacheSwitch);

        if (firstCache.totalPromptTokens > 0) {
            prevFirstPrompt = firstCache.totalPromptTokens;
        }

        if (firstCache.cacheStart === 'cold') { coldCount++; }
        else if (firstCache.cacheStart === 'partial') { partialCount++; }
        else if (firstCache.cacheStart === 'warm') { warmCount++; }
        else { unknownCount++; }

        const step = getCallPrimaryStep(firstCall);
        turns.push({
            turnIndex: t + 1,
            firstCallIndex: first.callIndex,
            callCount: group.length,
            ...(step !== null ? { firstStepIndex: step } : {}),
            createdAt: firstCall.createdAt || '',
            model: first.canonicalModelId || firstCall.modelDisplay || firstCall.responseModel || '',
            firstCallRole: first.role,
            cacheStart: firstCache.cacheStart,
            cacheHitRate: firstCache.cacheHitRate,
            cacheHitPct: firstCache.cacheHitPct,
            firstCallPromptTokens: firstCache.totalPromptTokens,
            firstCallFreshInputTokens: safeNonNeg(firstCall.inputTokens),
            firstCallCacheReadTokens: safeNonNeg(firstCall.cacheReadTokens),
            lastCallPromptTokens: lastPromptTokens,
            netContextDeltaTokens,
            intraTurnGrowthTokens,
            isCompactionDrop,
            hadColdCacheSwitch,
        });
    }

    return {
        turns,
        latestTurn: turns.length > 0 ? turns[turns.length - 1] : null,
        coldCount,
        partialCount,
        warmCount,
        unknownCount,
    };
}

// ─── Reusable Studio Telemetry HTML & CSS Helpers ────────────────────────────

function fmtCompact(n: number): string {
    if (!Number.isFinite(n) || n <= 0) { return '0'; }
    if (n >= 1_000_000) { return `${(n / 1_000_000).toFixed(2)}M`; }
    if (n >= 1_000) { return `${(n / 1_000).toFixed(1)}k`; }
    return String(Math.round(n));
}

/**
 * Render a compact role badge (`Orchestrator` / `Executor` / `Subagent`) and optional
 * cold-cache switch pill for Recent Calls Ledger rows and Overview details.
 * Returns `''` for `'direct'` calls so single-model conversations stay uncluttered.
 */
export function renderCallRoleBadgeHtml(
    role: OrchestratorCallRole,
    isColdCacheSwitch = false,
    switchDirection?: RoleSwitchDirection,
): string {
    const parts: string[] = [];
    if (role === 'orchestrator') {
        parts.push(`<span class="orch-role-badge is-orchestrator" data-call-role="orchestrator">${tBiHtml('Orchestrator', '编排')}</span>`);
    } else if (role === 'executor') {
        parts.push(`<span class="orch-role-badge is-executor" data-call-role="executor">${tBiHtml('Executor', '执行')}</span>`);
    } else if (role === 'subagent') {
        parts.push(`<span class="orch-role-badge is-subagent" data-call-role="subagent">${tBiHtml('Subagent', '子智能体')}</span>`);
    }

    if (isColdCacheSwitch) {
        const dirTip = switchDirection === 'orchestrator_to_executor'
            ? tBi('Role switch (Orchestrator → Executor) started with cold prompt cache (0 cache read)', '角色切换（编排模型 → 执行模型）触发冷缓存（缓存读取为 0）')
            : switchDirection === 'executor_to_orchestrator'
                ? tBi('Role switch (Executor → Orchestrator) started with cold prompt cache (0 cache read)', '角色切换（执行模型 → 编排模型）触发冷缓存（缓存读取为 0）')
                : tBi('Role switch started with cold prompt cache (0 cache read)', '角色切换触发冷缓存（缓存读取为 0）');
        parts.push(`<span class="orch-cold-switch-pill" data-cold-cache-switch="true" title="${esc(dirTip)}">${tBiHtml('Switch Cold', '切换冷启动')}</span>`);
    }

    return parts.join(' ');
}

/**
 * Build an auto-hiding Orchestrator vs Executor breakdown card (reusable in GM Data & Phase B Overview).
 * Automatically returns `''` for single-model direct conversations (`!split || !split.isMultiModelOrchestrated`).
 */
export function buildOrchestratorSplitCardHtml(
    split: OrchestratorSplitSummary | null | undefined,
    options?: { compact?: boolean },
): string {
    if (!split || !split.isMultiModelOrchestrated) {
        return '';
    }

    const compact = options?.compact === true;
    const orch = split.orchestrator;
    const exec = split.executor;
    const sub = split.subagent;

    const orchWeight = (orch.costUsd ?? 0) > 0 || (exec.costUsd ?? 0) > 0
        ? (orch.costUsd ?? 0)
        : (orch.totalPromptTokens + orch.outputTokens);
    const execWeight = (orch.costUsd ?? 0) > 0 || (exec.costUsd ?? 0) > 0
        ? (exec.costUsd ?? 0)
        : (exec.totalPromptTokens + exec.outputTokens);
    const totalWeight = orchWeight + execWeight;
    const orchPct = totalWeight > 0 ? Math.round((orchWeight / totalWeight) * 100) : 50;
    const execPct = Math.max(0, 100 - orchPct);

    const renderRoleRow = (
        roleKey: 'orchestrator' | 'executor' | 'subagent',
        titleEn: string,
        titleZh: string,
        metrics: OrchestratorRoleMetrics,
        fallbackLabel: string,
    ): string => {
        const modelLabel = metrics.labels.length > 1
            ? metrics.labels.join(' / ')
            : (metrics.primaryLabel || fallbackLabel || '—');
        const totalTok = metrics.totalPromptTokens + metrics.outputTokens;
        const costStr = metrics.costUsd !== null
            ? formatUsdCost(metrics.costUsd, { precision: metrics.costUsd < 0.01 ? 'standard' : 'call' })
            : tBi('Unpriced', '未定价');
        const mappedHint = metrics.mappedBaseCalls > 0
            ? ` <span class="orch-split-mapped-tag">${tBiHtml('Est.', '估算')}</span>`
            : '';
        const cacheStr = formatCachePercent(metrics.cacheHitRate);
        return `<div class="orch-split-row" data-split-role="${roleKey}">
            <div class="orch-split-row-main">
                <span class="orch-role-badge is-${roleKey}">${tBiHtml(titleEn, titleZh)}</span>
                <span class="orch-split-model" title="${esc(modelLabel)}">${esc(modelLabel)}</span>
            </div>
            <div class="orch-split-row-metrics">
                <span class="orch-split-metric">${formatNumber(metrics.calls)} ${tBiHtml(metrics.calls === 1 ? 'call' : 'calls', '次')}</span>
                <span class="orch-split-metric">${esc(fmtCompact(totalTok))} tok</span>
                <span class="orch-split-metric">${tBiHtml('Cache', '缓存')} ${esc(cacheStr)}</span>
                <span class="orch-split-metric is-cost">${esc(costStr)}${mappedHint}</span>
            </div>
        </div>`;
    };

    const metaPills: string[] = [];
    if (split.isSameModelOrchestrated) {
        metaPills.push(`<span class="orch-split-meta-pill">${tBiHtml('Same-model', '同模型编排')}</span>`);
    }
    if (split.hasMidConversationReconfig) {
        metaPills.push(`<span class="orch-split-meta-pill">${tBiHtml('Reconfigured', '中途切换配置')}</span>`);
    }
    if (split.totalCostUsd !== null) {
        metaPills.push(`<span class="orch-split-meta-pill is-total">${esc(formatUsdCost(split.totalCostUsd))}</span>`);
    }

    const coldSwitchBanner = split.coldCacheSwitchCount > 0
        ? `<div class="orch-split-cold-note" data-cold-switch-count="${split.coldCacheSwitchCount}">
            <span class="orch-cold-switch-pill">${tBiHtml('Cold Switch', '切换冷启动')} ×${split.coldCacheSwitchCount}</span>
            <span>${tBiHtml(
                `${fmtCompact(split.coldCacheSwitchInputTokens)} fresh input re-prefilled when switching between Orchestrator and Executor (each role keeps a separate prompt cache).`,
                `编排模型与执行模型切换时有 ${fmtCompact(split.coldCacheSwitchInputTokens)} 新增输入重新预填充（两者的提示词缓存相互独立）。`,
            )}</span>
        </div>`
        : '';

    const branchIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8.5 7.5 11 15.5"/><path d="M15.5 7.5 13 15.5"/></svg>`;

    const cardId = compact ? 'overviewOrchestratorSplitCard' : 'orchestratorSplitCard';

    return `<section class="orch-split-card${compact ? ' is-compact' : ''}" id="${cardId}" data-orchestrator-split="true" data-cold-switches="${split.coldCacheSwitchCount}">
        <div class="orch-split-head">
            <h3 class="orch-split-title">${branchIcon}<span>${tBiHtml('Orchestrator vs Executor', '编排模型 vs 执行模型')}</span></h3>
            <div class="orch-split-meta">${metaPills.join('')}</div>
        </div>
        <div class="orch-split-bar" aria-hidden="true">
            <span class="orch-split-bar-orch" style="width:${orchPct}%"></span>
            <span class="orch-split-bar-exec" style="width:${execPct}%"></span>
        </div>
        <div class="orch-split-rows">
            ${renderRoleRow('orchestrator', 'Orchestrator', '编排模型', orch, split.plannerLabel)}
            ${renderRoleRow('executor', 'Executor', '执行模型', exec, split.executorLabel)}
            ${sub.calls > 0 ? renderRoleRow('subagent', 'Subagent', '子智能体', sub, '') : ''}
        </div>
        ${coldSwitchBanner}
    </section>`;
}

/**
 * Balanced Studio Telemetry CSS for Orchestrator role badges, cold-cache switch pills,
 * and the Orchestrator vs Executor breakdown card.
 */
export function getOrchestratorAttributionStyles(): string {
    return `
    /* ─── Orchestrator Role Badges & Cold-Cache Switch Pills ─── */
    .orch-role-badge,
    .orch-cold-switch-pill {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: var(--ed-radius-pill);
        font-size: 0.65rem;
        font-weight: 600;
        line-height: 1.4;
        border: 1px solid;
        background: var(--ed-surface);
        white-space: nowrap;
        flex-shrink: 0;
    }
    .orch-role-badge.is-orchestrator {
        color: var(--ed-accent);
        border-color: var(--ed-accent-border);
    }
    .orch-role-badge.is-executor {
        color: var(--ed-good);
        border-color: var(--ed-good-border);
    }
    .orch-role-badge.is-subagent {
        color: var(--ed-ink-secondary);
        border-color: var(--ed-border-strong);
    }
    .orch-cold-switch-pill {
        color: var(--ed-warn);
        border-color: var(--ed-warn-border);
    }
    .rc-role-wrap {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 5px;
    }
    .rc-short-sample {
        display: inline-flex;
        align-items: center;
        padding: 1px 6px;
        border-radius: var(--ed-radius-xs);
        border: 1px solid var(--ed-border-strong);
        background: var(--ed-surface);
        color: var(--ed-ink-muted);
        font-size: 0.68rem;
        font-weight: 550;
        white-space: nowrap;
    }

    /* ─── Orchestrator vs Executor Breakdown Card ─── */
    .orch-split-card {
        background: var(--ed-surface);
        border: 1px solid var(--ed-border);
        border-radius: var(--ed-radius-md);
        padding: 12px 14px;
        margin-bottom: 16px;
    }
    .orch-split-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 6px 10px;
        margin-bottom: 8px;
    }
    .orch-split-title {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin: 0;
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--ed-ink);
    }
    .orch-split-title svg {
        color: var(--ed-accent);
        flex-shrink: 0;
    }
    .orch-split-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
    }
    .orch-split-meta-pill {
        display: inline-flex;
        align-items: center;
        padding: 1px 7px;
        border-radius: var(--ed-radius-pill);
        border: 1px solid var(--ed-border);
        background: var(--ed-surface-well);
        color: var(--ed-ink-secondary);
        font-size: 0.6875rem;
        font-weight: 550;
        font-variant-numeric: tabular-nums lining-nums;
    }
    .orch-split-meta-pill.is-total {
        color: var(--ed-accent);
        border-color: var(--ed-accent-border);
        background: var(--ed-surface);
        font-weight: 650;
    }
    .orch-split-bar {
        display: flex;
        height: 6px;
        border-radius: var(--ed-radius-pill);
        overflow: hidden;
        background: var(--ed-track);
        margin-bottom: 10px;
        gap: 2px;
    }
    .orch-split-bar-orch {
        background: var(--ed-accent);
        height: 100%;
    }
    .orch-split-bar-exec {
        background: var(--ed-good);
        height: 100%;
    }
    .orch-split-rows {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .orch-split-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 6px 12px;
        padding: 6px 8px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-surface-well);
        border: 1px solid var(--ed-border);
    }
    .orch-split-row-main {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
    }
    .orch-split-model {
        font-size: 0.78rem;
        font-weight: 600;
        color: var(--ed-ink);
        overflow-wrap: anywhere;
    }
    .orch-split-row-metrics {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px 10px;
        font-size: 0.72rem;
        color: var(--ed-ink-secondary);
        font-variant-numeric: tabular-nums lining-nums;
    }
    .orch-split-metric.is-cost {
        font-weight: 650;
        color: var(--ed-ink);
    }
    .orch-split-mapped-tag {
        font-size: 0.65rem;
        font-weight: 550;
        color: var(--ed-accent);
    }
    .orch-split-cold-note {
        display: flex;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 6px 8px;
        margin-top: 8px;
        padding: 7px 9px;
        border-radius: var(--ed-radius-xs);
        background: var(--ed-warn-tint);
        border: 1px solid var(--ed-warn-border);
        font-size: 0.72rem;
        line-height: 1.45;
        color: var(--ed-ink-secondary);
    }
    `;
}

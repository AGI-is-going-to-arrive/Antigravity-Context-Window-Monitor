// ─── Daily Ledger ────────────────────────────────────────────────────────────
// Incremental GM call ledger: records every new GM call in real-time,
// bucketed by date + account email. Does not depend on LS keeping
// conversations in memory — once a call is recorded, it's permanent
// until midnight rollover.
//
// Lifecycle:
//   fetchAll() → getNewCallsSinceLastRecord() → ledger.recordCalls()  (real-time)
//   quota reset → ledger.settleForQuotaReset()                        (per-pool settle)
//   midnight   → ledger.rollover() → DailyStore                      (day-end flush)

import type { GMCallEntry } from './gm-tracker';
import { normalizeModelDisplayName, resolveModelId } from './models';
import { buildGMArchiveKey, isValidCallTimestamp } from './gm/parser';
import { findPricingForDate, costFromTokens, selectPricingModel } from './pricing-store';
import { MIN_OUTPUT_TOKENS_FOR_SPEED, MIN_STREAM_SECONDS } from './telemetry-metrics';
import {
    aggregateSwarmGroupCost,
    type SwarmCostCallLike,
    type SwarmGroupCostSummary,
} from './core/swarm-registry';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Canonical workspace key for legacy or unattributable usage records (never smeared across projects). */
export const UNATTRIBUTED_WORKSPACE_KEY = '__unattributed__';

/** Origin surface where usage was captured (backward-compatible; legacy records default to 'unknown'). */
export type UsageSurface = 'app' | 'ide' | 'cli' | 'unknown';

/** Normalize raw surface strings (e.g. 'app-sidecar', 'vscode', 'desktop') to canonical UsageSurface. */
export function normalizeUsageSurface(raw?: string | null): UsageSurface {
    if (!raw || typeof raw !== 'string') { return 'unknown'; }
    const v = raw.trim().toLowerCase();
    if (!v) { return 'unknown'; }
    if (v === 'app' || v === 'app-sidecar' || v === 'desktop' || v === 'antigravity-app') { return 'app'; }
    if (v === 'ide' || v === 'vscode' || v === 'antigravity-ide') { return 'ide'; }
    if (v === 'cli' || v === 'agy-cli' || v === 'antigravity-cli') { return 'cli'; }
    return 'unknown';
}

/** Per-surface aggregated usage breakdown within a bucket, settled entry, or archived cycle. */
export interface SurfaceUsageStats {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    credits: number;
    estimatedCost: number;
}

/** Per-workspace aggregated usage breakdown captured at ingestion time (never proportionally smeared). */
export interface WorkspaceUsageStats {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    credits: number;
    /** Known USD cost across priced calls (unpriced calls contribute 0 here and increment `unpricedCalls`). */
    knownCostUsd: number;
    /** Count of calls whose model had no resolved pricing at evaluation time. */
    unpricedCalls: number;
    /** Optional host/remote authority (e.g. `'local'`, `'wsl+ubuntu'`, `'ssh-remote+box'`). */
    authority?: string;
    /** Exact per-surface usage split within this workspace. */
    bySurface?: Partial<Record<UsageSurface, SurfaceUsageStats>>;
}

/** Normalize a workspace path/URI + optional remote authority into a stable workspace key.
 *  Preserves case (POSIX/APFS/WSL safe) and authority (prevents WSL/SSH collisions).
 *  Empty/missing/legacy workspaces map explicitly to `UNATTRIBUTED_WORKSPACE_KEY` (`'__unattributed__'`). */
export function normalizeWorkspaceKey(
    workspace?: string | null,
    authority?: string | null,
): string {
    const rawWs = typeof workspace === 'string' ? workspace.trim() : '';
    if (!rawWs || rawWs === UNATTRIBUTED_WORKSPACE_KEY) {
        return UNATTRIBUTED_WORKSPACE_KEY;
    }
    let clean = rawWs;
    // Strip file:// scheme while preserving path case and Windows drive letters
    if (/^file:\/\//i.test(clean)) {
        try {
            const u = new URL(clean);
            const pathname = decodeURIComponent(u.pathname || '');
            clean = u.hostname ? `//${u.hostname}${pathname}` : pathname;
            // file:///C:/path -> C:/path
            if (/^\/[A-Za-z]:\//.test(clean)) {
                clean = clean.slice(1);
            }
        } catch {
            clean = clean.replace(/^file:\/\//i, '');
        }
    }
    // Strip trailing slashes except root '/' or drive root 'C:/' / 'C:\'
    if (clean.length > 1 && !/^[A-Za-z]:[\\/]$/.test(clean)) {
        clean = clean.replace(/[\\/]+$/, '');
    }
    if (!clean || clean === UNATTRIBUTED_WORKSPACE_KEY) {
        return UNATTRIBUTED_WORKSPACE_KEY;
    }
    const cleanAuth = typeof authority === 'string' ? authority.trim() : '';
    if (cleanAuth && cleanAuth.toLowerCase() !== 'local') {
        const prefix = `${cleanAuth}::`;
        return clean.startsWith(prefix) ? clean : `${prefix}${clean}`;
    }
    return clean;
}

/** Derive a human-readable short project display label from a canonical workspace key. */
export function deriveWorkspaceDisplayLabel(workspaceKey: string): string {
    const clean = (workspaceKey || '').trim();
    if (!clean || clean === UNATTRIBUTED_WORKSPACE_KEY) {
        return 'Unattributed';
    }
    let authorityPrefix = '';
    let pathPart = clean;
    const sepIdx = clean.indexOf('::');
    if (sepIdx > 0) {
        authorityPrefix = clean.slice(0, sepIdx);
        pathPart = clean.slice(sepIdx + 2);
    }
    const trimmed = pathPart.replace(/[\\/]+$/, '');
    const segments = trimmed.split(/[\\/]/).filter(Boolean);
    const base = segments.length > 0 ? segments[segments.length - 1] : (pathPart || clean);
    return authorityPrefix ? `${base} (${authorityPrefix})` : base;
}

/** Additive timing and cache-hit telemetry carried per model in ledger & settled entries */
export interface LedgerModelTelemetry {
    ttftSum: number;
    ttftCount: number;
    minTTFT?: number;
    maxTTFT?: number;
    streamingSum: number;
    streamingCount: number;
    timedOutputTokens: number;
    timedStreamingSeconds: number;
    cacheHitCalls: number;
}

/** Per-model statistics within a ledger bucket */
export interface LedgerModelStats {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    credits: number;
    estimatedCost: number;
    /** Sum of valid ttftSeconds (> 0) across calls (optional for v1 compat) */
    ttftSum?: number;
    /** Count of calls with valid ttftSeconds > 0 (optional for v1 compat) */
    ttftCount?: number;
    /** Minimum valid ttftSeconds (> 0) observed (optional for v1 compat) */
    minTTFT?: number;
    /** Maximum valid ttftSeconds (> 0) observed (optional for v1 compat) */
    maxTTFT?: number;
    /** Sum of valid streamingSeconds (> 0) across calls (optional for v1 compat) */
    streamingSum?: number;
    /** Count of calls with valid streamingSeconds > 0 (optional for v1 compat) */
    streamingCount?: number;
    /** Sum of outputTokens across speed-valid calls (optional for v1 compat) */
    timedOutputTokens?: number;
    /** Sum of streamingSeconds across speed-valid calls (optional for v1 compat) */
    timedStreamingSeconds?: number;
    /** Count of calls with cacheReadTokens > 0 (optional for v1 compat) */
    cacheHitCalls?: number;
}

/** Per-call data retained so quota-reset settlement can split by reset cutoff. */
export interface LedgerRecordedCall {
    callId: string;
    createdAt: string;
    createdAtMs: number;
    modelId: string;
    modelKey: string;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    credits: number;
    estimatedCost: number;
    /** Valid ttftSeconds (> 0) for timing preservation across settlement (optional for v1 compat) */
    ttftSeconds?: number;
    /** Valid streamingSeconds (> 0) for timing preservation across settlement (optional for v1 compat) */
    streamingSeconds?: number;
    /** Origin surface where this call was captured (optional for v1 compat) */
    surface?: UsageSurface;
    /** Account identifier captured once at ingestion time (optional for v1 compat) */
    account?: string;
    /** Host/remote authority (e.g. `'local'`, `'wsl+ubuntu'`, `'ssh-remote+box'`) captured at ingestion (optional for v1 compat) */
    authority?: string;
    /** Conversation cascadeId captured once at ingestion time (optional for v1 compat) */
    cascadeId?: string;
    /** Canonical workspace key captured once at ingestion time (or `'__unattributed__'` when absent) */
    workspace?: string;
    /** True when the call's model had no resolved pricing at ingestion time (`estimatedCost === 0`) */
    unpriced?: boolean;
}

/** A single account bucket within a day */
export interface LedgerAccountBucket {
    accountEmail: string;
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalThinkingTokens: number;
    totalCacheRead: number;
    totalCacheCreation: number;
    totalCredits: number;
    totalEstimatedCost: number;
    /** Per-model breakdown (key = display name) */
    modelStats: Record<string, LedgerModelStats>;
    /** Call IDs already recorded — prevents double-counting */
    recordedCallIds: string[];
    /** Accepted calls retained for cutoff-aware quota settlement */
    recordedCalls: LedgerRecordedCall[];
    /** Dominant/latest known origin surface for this bucket (optional for v1 compat) */
    surface?: UsageSurface;
    /** Per-surface usage breakdown when tagged calls are present (optional for v1 compat) */
    surfaceBreakdown?: Partial<Record<UsageSurface, SurfaceUsageStats>>;
    /** Per-workspace attribution breakdown captured at ingestion time (optional for v1 compat) */
    workspaceBreakdown?: Record<string, WorkspaceUsageStats>;
}

/** A settled (quota-reset) entry — frozen snapshot of a pool's data at reset time */
export interface LedgerSettledEntry {
    /** ISO timestamp when settlement occurred */
    settledAt: string;
    /** Account email */
    accountEmail: string;
    /** Model IDs in the settled pool */
    poolModelIds: string[];
    /** Display names of models in the settled pool */
    poolModelLabels: string[];
    /** Settled statistics */
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalThinkingTokens: number;
    totalCacheRead: number;
    totalCacheCreation: number;
    totalCredits: number;
    totalEstimatedCost: number;
    /** Optional reset boundary used for this settlement */
    settledCutoffTime?: number;
    /** Per-model call counts (key = display name) */
    modelCalls: Record<string, number>;
    /** Per-model token & cost totals preserved across quota settlement so custom pricing
     *  and Orchestrator billing mode changes can recalculate dynamically (optional for v1 compat). */
    modelStats?: Record<string, LedgerModelStats>;
    /** Per-model additive timing & cache-hit telemetry preserved across quota settlement (optional for v1 compat) */
    modelTelemetry?: Record<string, LedgerModelTelemetry>;
    /** Dominant/origin surface for this settled entry (optional for v1 compat) */
    surface?: UsageSurface;
    /** Per-surface usage breakdown preserved across settlement (optional for v1 compat) */
    surfaceBreakdown?: Partial<Record<UsageSurface, SurfaceUsageStats>>;
    /** Per-workspace attribution breakdown preserved across settlement (optional for v1 compat) */
    workspaceBreakdown?: Record<string, WorkspaceUsageStats>;
    /** Accepted calls settled into this entry for lossless cross-host settlement merge (optional for v1 compat) */
    settledCalls?: LedgerRecordedCall[];
    /** Canonical call IDs settled into this entry for deduplication across hosts and late replays (optional for v1 compat) */
    recordedCallIds?: string[];
}

/** Full day entry containing active buckets + settled entries */
export interface LedgerDayData {
    dateKey: string;
    /** Per-account active buckets */
    accounts: Record<string, LedgerAccountBucket>;
    /** Settled entries from quota resets */
    settled: LedgerSettledEntry[];
}

/** Per-entry outcome reported by `DailyLedger.recordCallsDetailed`. */
export type RecordCallStatus = 'added' | 'duplicate' | 'rejected_terminal' | 'retryable';

/** Detailed batch recording result enabling non-deadlocking cursor advancement. */
export interface RecordCallsDetailedResult {
    added: number;
    statuses: RecordCallStatus[];
    /** Length of the leading prefix whose status is 'added' | 'duplicate' | 'rejected_terminal'. */
    contiguousAdvanceCount: number;
}

/** Serialized state for persistence */
export interface DailyLedgerState {
    version: 1;
    dateKey: string;
    accounts: Record<string, LedgerAccountBucket>;
    settled: LedgerSettledEntry[];
    /** Optional late-arriving cross-midnight buckets keyed by true local YYYY-MM-DD (omitted when empty). */
    lateDays?: Record<string, Record<string, LedgerAccountBucket>>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function toLocalDateKey(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Convert a dateKey like "2026-05-29" to the Unix timestamp (ms) of
 * midnight local time on that date.
 * Returns 0 on parse failure (caller treats 0 as "no filter").
 */
function dateKeyToDayStartMs(dateKey: string, dayOffset = 0): number {
    const parts = dateKey.split('-');
    if (parts.length !== 3) { return 0; }
    const [y, m, d] = parts.map(p => parseInt(p, 10));
    if (isNaN(y) || isNaN(m) || isNaN(d)) { return 0; }
    return new Date(y, m - 1, d + dayOffset, 0, 0, 0, 0).getTime();
}
const dateKeyToStartOfDayMs = (dateKey: string): number => dateKeyToDayStartMs(dateKey, 0);
const dateKeyToNextDayStartMs = (dateKey: string): number => dateKeyToDayStartMs(dateKey, 1);

/** Bounded cross-midnight late-arrival window: calls up to 48 hours old arriving after rollover still bucket into their true local date. */
export const LATE_CROSS_MIDNIGHT_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Normalize a raw dedupKey/callId into a durable logical call ID independent of mutable
 * array indices.
 * - Legacy fingerprinted key `<cascadeId>:<index>|<fingerprint>` → `<cascadeId>|<fingerprint>`.
 * - Durable fingerprinted key `<cascadeId>|<fingerprint>` → unchanged.
 * - Legacy index-only key `<cascadeId>:<index>` (no `|`) → unchanged (still clearable on revert).
 */
export function canonicalLogicalCallId(rawId: string): string {
    if (!rawId) { return ''; }
    const pipeIdx = rawId.indexOf('|');
    if (pipeIdx <= 0) {
        return rawId;
    }
    const prefix = rawId.slice(0, pipeIdx);
    const strippedPrefix = prefix.replace(/:\d+$/, '');
    if (!strippedPrefix) {
        return rawId;
    }
    return `${strippedPrefix}${rawId.slice(pipeIdx)}`;
}

/** A call entry with an externally-provided dedup key.
 *  The tracker supplies a durable logical dedupKey (`<cascadeId>|<fingerprint>`) independent
 *  of mutable array indices, plus optional cursor metadata (`cascadeId`, `callIndex`). */
export interface LedgerCallEntry {
    call: GMCallEntry;
    /** Externally-provided unique logical call key. Used for dedup. */
    dedupKey: string;
    /** Optional origin surface ('app' | 'ide' | 'cli' | 'unknown'). */
    surface?: UsageSurface;
    /** Optional conversation ID for per-conversation cursor advancement & attribution. */
    cascadeId?: string;
    /** Optional array index hint within the conversation's calls[] snapshot for contiguous cursor tracking. */
    callIndex?: number;
    /** Optional account identifier override at ingestion time (falls back to `call.accountEmail`). */
    account?: string;
    /** Optional legacy alias for `account`. */
    accountEmail?: string;
    /** Optional host/remote authority (e.g. `'local'`, `'wsl+ubuntu'`, `'ssh-remote+host'`) recorded at ingestion. */
    authority?: string;
    /** Optional workspace root/path recorded once at ingestion (absent maps to `'__unattributed__'`). */
    workspace?: string;
}

/** Fallback: build a high-entropy dedup key from call fields when neither dedupKey nor executionId is available.
 *  Includes cache, thinking, credits, context, timing, stop reason, and account fields so calls across
 *  same-day deleted and newly created conversations do not collide accidentally. */
function fallbackCallId(call: GMCallEntry): string {
    if (call.executionId) { return call.executionId; }
    const base = buildGMArchiveKey(call);
    const ttft = typeof call.ttftSeconds === 'number' && Number.isFinite(call.ttftSeconds) && call.ttftSeconds > 0
        ? call.ttftSeconds.toFixed(3)
        : '0';
    const stream = typeof call.streamingSeconds === 'number' && Number.isFinite(call.streamingSeconds) && call.streamingSeconds > 0
        ? call.streamingSeconds.toFixed(3)
        : '0';
    return `${base}|in:${call.inputTokens}|out:${call.outputTokens}|th:${call.thinkingTokens}|cr:${call.cacheReadTokens}|cc:${call.cacheCreationTokens}|cred:${call.credits}|ssi:${call.startStepIndex}|ctx:${call.contextTokensUsed || 0}|sr:${call.stopReason || ''}|ttft:${ttft}|st:${stream}|acct:${call.accountEmail || ''}`;
}

/**
 * Compute per-call estimated cost using the concrete model identity, with
 * responseModel/display fallbacks for incomplete historical records.
 *
 * Deliberately uses the built-in table only. This value is persisted, and two windows
 * can hold different custom prices (the durable store is read once at construction and
 * has no watcher), so pricing it per-window would make the same day serialize to
 * different numbers and flip back and forth under last-writer-wins. Custom prices are
 * applied where the number is read instead — see the Pricing tab and
 * `buildGMSummaryFromLedger`, which re-price from the token counts kept alongside.
 */
function estimateCallCostDetail(call: GMCallEntry, dateKey: string): { cost: number; priced: boolean } {
    const at = call.createdAt || dateKey;
    const fallback = selectPricingModel(call.modelDisplay, call.responseModel);
    const pr = findPricingForDate(selectPricingModel(call.model, fallback), {}, at);
    return pr ? { cost: costFromTokens(call, pr), priced: true } : { cost: 0, priced: false };
}

function resolveCallCascadeId(entry: LedgerCallEntry): string | undefined {
    if (typeof entry.cascadeId === 'string' && entry.cascadeId.trim()) {
        return entry.cascadeId.trim();
    }
    const rawKey = typeof entry.dedupKey === 'string' ? entry.dedupKey.trim() : '';
    if (!rawKey) { return undefined; }
    const pipeIdx = rawKey.indexOf('|');
    if (pipeIdx > 0) {
        const prefix = rawKey.slice(0, pipeIdx).replace(/:\d+$/, '').trim();
        if (prefix && !prefix.startsWith('steps:') && !prefix.startsWith('exec:') && !prefix.startsWith('archive')) {
            return prefix;
        }
    }
    return undefined;
}

function normalizeAuthorityTag(authority?: string | null): string | undefined {
    const clean = typeof authority === 'string' ? authority.trim() : '';
    return clean || undefined;
}

/** A timestamp enrichment changes an archive key, but not the underlying call. */
function recordedCallIdentityMatches(recordedId: string, entry: LedgerCallEntry): boolean {
    const nextId = entry.dedupKey || fallbackCallId(entry.call);
    if (recordedId === nextId || canonicalLogicalCallId(recordedId) === canonicalLogicalCallId(nextId)) {
        return true;
    }
    if (entry.call.executionId) {
        return recordedId === entry.call.executionId
            || recordedId.endsWith(`|${encodeURIComponent(`exec:${entry.call.executionId}`)}`);
    }
    const archiveIdentity = (id: string): { scope: string; key: string; date: string } | null => {
        const split = id.indexOf('|');
        if (split < 0) { return null; }
        try {
            const identity = decodeURIComponent(id.slice(split + 1));
            if (!identity.startsWith('archive|')) { return null; }
            const start = identity.lastIndexOf('|created:');
            const end = identity.indexOf('|in:', start);
            if (start < 0 || end < 0) { return null; }
            return { scope: id.slice(0, split).replace(/:\d+$/, ''), key: identity.slice(0, start) + identity.slice(end),
                date: identity.slice(start + '|created:'.length, end) };
        } catch { return null; }
    };
    const before = archiveIdentity(recordedId);
    const after = archiveIdentity(nextId);
    return !!before && !!after && before.scope === after.scope && before.key === after.key
        && !isValidCallTimestamp(before.date) && isValidCallTimestamp(after.date);
}

function sameAmount(left: number, right: number): boolean {
    return Number.isFinite(left) && Number.isFinite(right)
        && Math.abs(left - right) <= Math.max(1e-9, Math.abs(left) * 1e-9, Math.abs(right) * 1e-9);
}

/**
 * Pick the per-model key a ledger bucket is filed under.
 *
 * The key has to survive being written before model labels are available, because the ledger is
 * persisted and later reads merge by key. `normalizeModelDisplayName()` echoes an unresolvable input
 * back unchanged, so using it directly would file a raw `MODEL_PLACEHOLDER_Mxxx` string — and once
 * that string is on disk nothing ever merges it with the same model's named row. Fall through the
 * identifiers a call carries and take the first one that is actually a name; only use a raw
 * identifier when the call offers nothing else.
 */
export function resolveModelKeyForLedger(
    call: Pick<GMCallEntry, 'modelDisplay' | 'model' | 'responseModel'>,
): string {
    const isRaw = (v: string): boolean => /^MODEL_[A-Z0-9_]+$/.test((v || '').trim());
    for (const candidate of [call.modelDisplay, call.model, call.responseModel]) {
        const clean = (candidate || '').trim();
        if (!clean) { continue; }
        const named = normalizeModelDisplayName(clean);
        if (named && !isRaw(named)) { return named; }
    }
    // Nothing resolved to a name. Prefer the responseModel: a catalog id such as
    // 'gemini-3.7-flash-high' at least identifies the model to a human, where a bare placeholder
    // does not. Note this does NOT retroactively merge — rows already written under a catalog id
    // stay under it once later rows start using the display name; it only narrows the window.
    const response = (call.responseModel || '').trim();
    if (response && !isRaw(response)) { return response; }
    return (call.modelDisplay || call.model || call.responseModel || '').trim();
}

function emptyModelStats(): LedgerModelStats {
    return {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        credits: 0,
        estimatedCost: 0,
        ttftSum: 0,
        ttftCount: 0,
        minTTFT: 0,
        maxTTFT: 0,
        streamingSum: 0,
        streamingCount: 0,
        timedOutputTokens: 0,
        timedStreamingSeconds: 0,
        cacheHitCalls: 0,
    };
}

function addCallTelemetryToModelStats(
    target: LedgerModelStats,
    ttftSeconds: number | undefined,
    streamingSeconds: number | undefined,
    outputTokens: number,
    cacheReadTokens: number,
): void {
    if (typeof ttftSeconds === 'number' && Number.isFinite(ttftSeconds) && ttftSeconds > 0) {
        target.ttftSum = (target.ttftSum || 0) + ttftSeconds;
        target.ttftCount = (target.ttftCount || 0) + 1;
        target.minTTFT = target.minTTFT && target.minTTFT > 0
            ? Math.min(target.minTTFT, ttftSeconds)
            : ttftSeconds;
        target.maxTTFT = Math.max(target.maxTTFT || 0, ttftSeconds);
    }
    if (typeof streamingSeconds === 'number' && Number.isFinite(streamingSeconds) && streamingSeconds > 0) {
        target.streamingSum = (target.streamingSum || 0) + streamingSeconds;
        target.streamingCount = (target.streamingCount || 0) + 1;
        if (streamingSeconds >= MIN_STREAM_SECONDS && outputTokens >= MIN_OUTPUT_TOKENS_FOR_SPEED) {
            target.timedOutputTokens = (target.timedOutputTokens || 0) + outputTokens;
            target.timedStreamingSeconds = (target.timedStreamingSeconds || 0) + streamingSeconds;
        }
    }
    if (cacheReadTokens > 0) {
        target.cacheHitCalls = (target.cacheHitCalls || 0) + 1;
    }
}

function resolveCallModelId(call: GMCallEntry, modelKey: string): string {
    return resolveModelId(call.model)
        || resolveModelId(call.responseModel || '')
        || resolveModelId(modelKey)
        || call.model
        || call.responseModel
        || modelKey;
}

function callMatchesPool(modelKey: string, modelId: string | undefined, poolModelIds: string[]): boolean {
    const poolModelIdSet = new Set(poolModelIds.map(id => id.toLowerCase()));
    if (modelId && poolModelIdSet.has(modelId.toLowerCase())) {
        return true;
    }
    const resolvedId = resolveModelId(modelKey);
    if (resolvedId && poolModelIdSet.has(resolvedId.toLowerCase())) {
        return true;
    }
    for (const pid of poolModelIds) {
        const pidDisplay = normalizeModelDisplayName(pid);
        if (pidDisplay && pidDisplay.toLowerCase() === modelKey.toLowerCase()) {
            return true;
        }
    }
    return false;
}

function addRecordedCallStats(target: LedgerModelStats, call: LedgerRecordedCall): void {
    target.calls++;
    target.inputTokens += call.inputTokens;
    target.outputTokens += call.outputTokens;
    target.thinkingTokens += call.thinkingTokens;
    target.cacheReadTokens += call.cacheReadTokens;
    target.cacheCreationTokens += call.cacheCreationTokens;
    target.credits += call.credits;
    target.estimatedCost += call.estimatedCost;
    addCallTelemetryToModelStats(target, call.ttftSeconds, call.streamingSeconds, call.outputTokens, call.cacheReadTokens);
}

const CORE_STAT_KEYS = [
    'calls', 'inputTokens', 'outputTokens', 'thinkingTokens', 'cacheReadTokens', 'cacheCreationTokens', 'credits', 'estimatedCost',
] as const;
const TELEMETRY_SUM_KEYS = [
    'ttftSum', 'ttftCount', 'streamingSum', 'streamingCount', 'timedOutputTokens', 'timedStreamingSeconds', 'cacheHitCalls',
] as const;
const BUCKET_TOTAL_MAP = [
    ['totalCalls', 'calls'], ['totalInputTokens', 'inputTokens'], ['totalOutputTokens', 'outputTokens'],
    ['totalThinkingTokens', 'thinkingTokens'], ['totalCacheRead', 'cacheReadTokens'],
    ['totalCacheCreation', 'cacheCreationTokens'], ['totalCredits', 'credits'], ['totalEstimatedCost', 'estimatedCost'],
] as const;

function addModelStats(target: LedgerModelStats, source: LedgerModelStats): void {
    for (const k of CORE_STAT_KEYS) { target[k] += source[k]; }
    for (const k of TELEMETRY_SUM_KEYS) { target[k] = (target[k] || 0) + (source[k] || 0); }
    const sMin = source.minTTFT || 0;
    const tMin = target.minTTFT || 0;
    target.minTTFT = tMin > 0 && sMin > 0 ? Math.min(tMin, sMin) : Math.max(tMin, sMin);
    target.maxTTFT = Math.max(target.maxTTFT || 0, source.maxTTFT || 0);
}

function subtractModelStatsSnapshot(total: LedgerModelStats, represented?: LedgerModelStats): LedgerModelStats {
    const rep = represented || emptyModelStats();
    const out = emptyModelStats();
    for (const k of CORE_STAT_KEYS) { out[k] = Math.max(0, total[k] - rep[k]); }
    for (const k of TELEMETRY_SUM_KEYS) { out[k] = Math.max(0, (total[k] || 0) - (rep[k] || 0)); }
    out.minTTFT = (out.ttftCount || 0) > 0 ? (total.minTTFT || 0) : 0;
    out.maxTTFT = (out.ttftCount || 0) > 0 ? (total.maxTTFT || 0) : 0;
    return out;
}

function hasModelStatsData(stats: LedgerModelStats): boolean {
    return CORE_STAT_KEYS.some(k => stats[k] > 0);
}

function parseCallCreatedAtMs(createdAt: string | undefined): number {
    const parsed = Date.parse(createdAt || '');
    return Number.isNaN(parsed) ? Date.now() : parsed;
}

function isRecordedCallBeforeCutoff(call: LedgerRecordedCall, cutoffMs: number | undefined): boolean {
    if (cutoffMs === undefined) { return true; }
    return Number.isFinite(call.createdAtMs) ? call.createdAtMs <= cutoffMs : true;
}

function subtractStatsFromBucket(bucket: LedgerAccountBucket, key: string, stats: LedgerModelStats): void {
    for (const [bk, sk] of BUCKET_TOTAL_MAP) { bucket[bk] = Math.max(0, bucket[bk] - stats[sk]); }
    const activeStats = bucket.modelStats[key];
    if (!activeStats) { return; }
    for (const k of CORE_STAT_KEYS) { activeStats[k] = Math.max(0, activeStats[k] - stats[k]); }
    for (const k of TELEMETRY_SUM_KEYS) {
        if (activeStats[k] !== undefined || stats[k]) {
            activeStats[k] = Math.max(0, (activeStats[k] || 0) - (stats[k] || 0));
        }
    }
    if (activeStats.calls === 0) {
        delete bucket.modelStats[key];
    } else if ((activeStats.ttftCount || 0) === 0) {
        activeStats.minTTFT = 0;
        activeStats.maxTTFT = 0;
    } else if (Array.isArray(bucket.recordedCalls)) {
        const remainingTtfts = bucket.recordedCalls
            .filter(c => c.modelKey === key && typeof c.ttftSeconds === 'number' && c.ttftSeconds > 0)
            .map(c => c.ttftSeconds!);
        if (remainingTtfts.length > 0) {
            activeStats.minTTFT = Math.min(...remainingTtfts);
            activeStats.maxTTFT = Math.max(...remainingTtfts);
        }
    }
}

function emptySurfaceStats(): SurfaceUsageStats {
    return { calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, credits: 0, estimatedCost: 0 };
}

function callToSurfaceStats(
    call: { inputTokens: number; outputTokens: number; thinkingTokens: number; cacheReadTokens: number; cacheCreationTokens: number; credits: number },
    estimatedCost: number,
    calls = 1,
): SurfaceUsageStats {
    return {
        calls, inputTokens: call.inputTokens, outputTokens: call.outputTokens, thinkingTokens: call.thinkingTokens,
        cacheReadTokens: call.cacheReadTokens, cacheCreationTokens: call.cacheCreationTokens, credits: call.credits, estimatedCost,
    };
}

function bucketToSurfaceStats(b: LedgerAccountBucket): SurfaceUsageStats {
    return {
        calls: b.totalCalls, inputTokens: b.totalInputTokens, outputTokens: b.totalOutputTokens, thinkingTokens: b.totalThinkingTokens,
        cacheReadTokens: b.totalCacheRead, cacheCreationTokens: b.totalCacheCreation, credits: b.totalCredits, estimatedCost: b.totalEstimatedCost,
    };
}

export function addSurfaceStats(target: SurfaceUsageStats, source: SurfaceUsageStats): void {
    for (const k of CORE_STAT_KEYS) { target[k] += source[k]; }
}

function subtractSurfaceStats(target: SurfaceUsageStats, source: SurfaceUsageStats): void {
    for (const k of CORE_STAT_KEYS) { target[k] = Math.max(0, target[k] - source[k]); }
}

function hasSurfaceStatsData(stats: SurfaceUsageStats): boolean {
    return CORE_STAT_KEYS.some(k => stats[k] > 0);
}

const FORBIDDEN_MAP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const hasOwnKey = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key);
const safeFiniteNonNeg = (v: unknown): number => {
    const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
    return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function cloneSurfaceBreakdown(
    breakdown?: Partial<Record<UsageSurface, SurfaceUsageStats>>,
): Partial<Record<UsageSurface, SurfaceUsageStats>> | undefined {
    if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) { return undefined; }
    const acc = Object.create(null) as Partial<Record<UsageSurface, SurfaceUsageStats>>;
    let count = 0;
    for (const [key, val] of Object.entries(breakdown)) {
        if (FORBIDDEN_MAP_KEYS.has(key) || !val || typeof val !== 'object' || Array.isArray(val)) { continue; }
        const surf = normalizeUsageSurface(key);
        const existing = hasOwnKey(acc, surf) ? acc[surf]! : emptySurfaceStats();
        addSurfaceStats(existing, {
            calls: safeFiniteNonNeg(val.calls), inputTokens: safeFiniteNonNeg(val.inputTokens),
            outputTokens: safeFiniteNonNeg(val.outputTokens), thinkingTokens: safeFiniteNonNeg(val.thinkingTokens),
            cacheReadTokens: safeFiniteNonNeg(val.cacheReadTokens), cacheCreationTokens: safeFiniteNonNeg(val.cacheCreationTokens),
            credits: safeFiniteNonNeg(val.credits), estimatedCost: safeFiniteNonNeg(val.estimatedCost),
        });
        if (hasSurfaceStatsData(existing)) {
            if (!hasOwnKey(acc, surf)) { count++; }
            acc[surf] = existing;
        }
    }
    return count > 0 ? { ...acc } : undefined;
}

export function dominantUsageSurface(
    breakdown?: Partial<Record<UsageSurface, SurfaceUsageStats>>,
    fallback?: UsageSurface,
): UsageSurface | undefined {
    if (breakdown) {
        let best: UsageSurface | undefined;
        let bestCalls = -1;
        for (const [k, v] of Object.entries(breakdown)) {
            const surf = normalizeUsageSurface(k);
            if (surf === 'unknown' || !v || !hasSurfaceStatsData(v)) { continue; }
            if (v.calls > bestCalls) {
                bestCalls = v.calls;
                best = surf;
            }
        }
        if (best) { return best; }
    }
    return fallback && fallback !== 'unknown' ? fallback : undefined;
}

function emptyWorkspaceStats(authority?: string): WorkspaceUsageStats {
    return {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        credits: 0,
        knownCostUsd: 0,
        unpricedCalls: 0,
        ...(authority ? { authority } : {}),
    };
}

const WS_STAT_KEYS = [
    'calls', 'inputTokens', 'outputTokens', 'thinkingTokens', 'cacheReadTokens', 'cacheCreationTokens', 'credits', 'knownCostUsd', 'unpricedCalls',
] as const;

export function addWorkspaceStats(target: WorkspaceUsageStats, source: WorkspaceUsageStats): void {
    for (const k of WS_STAT_KEYS) { target[k] += safeFiniteNonNeg(source[k]); }
    if (!target.authority && source.authority) { target.authority = source.authority; }
    if (source.bySurface && typeof source.bySurface === 'object' && !Array.isArray(source.bySurface)) {
        if (!target.bySurface) { target.bySurface = {}; }
        for (const [sk, sv] of Object.entries(source.bySurface)) {
            if (FORBIDDEN_MAP_KEYS.has(sk) || !sv || typeof sv !== 'object' || !hasSurfaceStatsData(sv)) { continue; }
            const surf = normalizeUsageSurface(sk);
            const cur = hasOwnKey(target.bySurface, surf) ? target.bySurface[surf]! : emptySurfaceStats();
            addSurfaceStats(cur, sv);
            target.bySurface[surf] = cur;
        }
    }
}

function subtractWorkspaceStats(target: WorkspaceUsageStats, source: WorkspaceUsageStats): void {
    for (const k of WS_STAT_KEYS) { target[k] = Math.max(0, target[k] - source[k]); }
    if (target.bySurface && source.bySurface) {
        for (const [sk, sv] of Object.entries(source.bySurface)) {
            if (!sv) { continue; }
            const surf = normalizeUsageSurface(sk);
            const cur = target.bySurface[surf];
            if (!cur) { continue; }
            subtractSurfaceStats(cur, sv);
            if (!hasSurfaceStatsData(cur)) { delete target.bySurface[surf]; }
        }
        if (Object.keys(target.bySurface).length === 0) { delete target.bySurface; }
    }
}

function hasWorkspaceStatsData(stats: WorkspaceUsageStats): boolean {
    return WS_STAT_KEYS.some(k => stats[k] > 0);
}

export function cloneWorkspaceBreakdown(
    breakdown?: Record<string, WorkspaceUsageStats>,
): Record<string, WorkspaceUsageStats> | undefined {
    if (!breakdown || typeof breakdown !== 'object' || Array.isArray(breakdown)) { return undefined; }
    const acc = Object.create(null) as Record<string, WorkspaceUsageStats>;
    let count = 0;
    for (const [rawKey, val] of Object.entries(breakdown)) {
        if (FORBIDDEN_MAP_KEYS.has(rawKey) || !val || typeof val !== 'object' || Array.isArray(val)) { continue; }
        const wsKey = rawKey === UNATTRIBUTED_WORKSPACE_KEY
            ? UNATTRIBUTED_WORKSPACE_KEY
            : normalizeWorkspaceKey(rawKey, undefined);
        if (!wsKey || FORBIDDEN_MAP_KEYS.has(wsKey)) { continue; }
        const existing = hasOwnKey(acc, wsKey)
            ? acc[wsKey]
            : emptyWorkspaceStats(normalizeAuthorityTag(val.authority));
        const clonedSurfaces = cloneSurfaceBreakdown(val.bySurface);
        addWorkspaceStats(existing, {
            calls: val.calls, inputTokens: val.inputTokens, outputTokens: val.outputTokens,
            thinkingTokens: val.thinkingTokens, cacheReadTokens: val.cacheReadTokens,
            cacheCreationTokens: val.cacheCreationTokens, credits: val.credits,
            knownCostUsd: val.knownCostUsd, unpricedCalls: val.unpricedCalls,
            ...(val.authority ? { authority: normalizeAuthorityTag(val.authority) } : {}),
            ...(clonedSurfaces ? { bySurface: clonedSurfaces } : {}),
        });
        if (hasWorkspaceStatsData(existing)) {
            if (!hasOwnKey(acc, wsKey)) { count++; }
            acc[wsKey] = existing;
        }
    }
    return count > 0 ? Object.assign({}, acc) : undefined;
}

export function addCallToWorkspaceBreakdown(
    breakdown: Record<string, WorkspaceUsageStats>,
    workspaceKey: string,
    call: {
        inputTokens: number;
        outputTokens: number;
        thinkingTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        credits: number;
        estimatedCost: number;
        unpriced?: boolean;
        authority?: string;
        surface?: UsageSurface;
    },
    fallbackSurface: UsageSurface = 'unknown',
): void {
    const rawKey = workspaceKey || UNATTRIBUTED_WORKSPACE_KEY;
    const key = FORBIDDEN_MAP_KEYS.has(rawKey) ? UNATTRIBUTED_WORKSPACE_KEY : rawKey;
    const entry = hasOwnKey(breakdown, key)
        ? breakdown[key]
        : emptyWorkspaceStats(normalizeAuthorityTag(call.authority));
    const surf = normalizeUsageSurface(call.surface ?? fallbackSurface);
    const knownCost = call.unpriced ? 0 : (Number.isFinite(call.estimatedCost) && call.estimatedCost > 0 ? call.estimatedCost : 0);
    addWorkspaceStats(entry, {
        calls: 1, inputTokens: call.inputTokens, outputTokens: call.outputTokens, thinkingTokens: call.thinkingTokens,
        cacheReadTokens: call.cacheReadTokens, cacheCreationTokens: call.cacheCreationTokens, credits: call.credits,
        knownCostUsd: knownCost, unpricedCalls: call.unpriced ? 1 : 0,
        ...(call.authority ? { authority: normalizeAuthorityTag(call.authority) } : {}),
        bySurface: { [surf]: callToSurfaceStats(call, knownCost) },
    });
    breakdown[key] = entry;
}

function emptyBucket(email: string): LedgerAccountBucket {
    return {
        accountEmail: email,
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalThinkingTokens: 0,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        totalCredits: 0,
        totalEstimatedCost: 0,
        modelStats: {},
        recordedCallIds: [],
        recordedCalls: [],
    };
}

// ─── DailyLedger Class ──────────────────────────────────────────────────────

export class DailyLedger {
    private _dateKey: string;
    private _defaultSurface?: UsageSurface;
    /** Per-account active buckets (key = accountEmail or '' for unknown) */
    private _accounts = new Map<string, LedgerAccountBucket>();
    /** Settled entries from quota resets (waiting for midnight flush) */
    private _settled: LedgerSettledEntry[] = [];
    /** Late-arriving cross-midnight calls keyed by true local dateKey -> accountEmail -> bucket */
    private _lateDays = new Map<string, Map<string, LedgerAccountBucket>>();
    /** Fast lookup set for deduplication (union of all bucket + late-day recordedCallIds) */
    private _allRecordedIds = new Set<string>();
    /** Recorded IDs from drained late-day calls retained for in-session dedup */
    private _lateRecordedIds = new Set<string>();

    constructor(dateKey?: string, surface?: UsageSurface) {
        this._dateKey = dateKey || toLocalDateKey();
        const normalized = normalizeUsageSurface(surface);
        if (normalized !== 'unknown') {
            this._defaultSurface = normalized;
        }
    }

    /** Current date key */
    get dateKey(): string { return this._dateKey; }

    /** Default surface tag applied to calls without an explicit per-call surface */
    get surface(): UsageSurface { return this._defaultSurface || 'unknown'; }

    /** Configure default surface tag ('app' | 'ide' | 'cli' | 'unknown') */
    setSurface(surface?: UsageSurface): void {
        const normalized = normalizeUsageSurface(surface);
        this._defaultSurface = normalized === 'unknown' ? undefined : normalized;
    }

    /**
     * Normalize an empty ledger whose date no longer matches the local day.
     * Data-bearing ledgers must wait for performDailyArchival() to rollover.
     */
    normalizeIfStaleEmpty(todayKey = toLocalDateKey()): boolean {
        if (this._dateKey === todayKey || this.hasData) { return false; }
        this._resetForNewDay(todayKey);
        return true;
    }

    /**
     * Clear recorded dedup IDs that belong to a specific conversation.
     * Called when a conversation is reverted — the old indices are invalidated
     * and new calls at the same indices must be accepted.
     * Does NOT reduce call counts (those represent actual API usage).
     */
    clearRecordedIdsForConversation(cascadeId: string): void {
        const prefix = cascadeId + ':';
        const isLegacyIndexOnlyId = (id: string): boolean => {
            if (!id.startsWith(prefix)) { return false; }
            return /^\d+$/.test(id.slice(prefix.length));
        };
        const toRemove: string[] = [];
        for (const id of this._allRecordedIds) {
            if (isLegacyIndexOnlyId(id)) { toRemove.push(id); }
        }
        for (const id of toRemove) { this._allRecordedIds.delete(id); }
        // Also clean legacy per-account bucket recordedCallIds
        for (const bucket of this._accounts.values()) {
            bucket.recordedCallIds = bucket.recordedCallIds.filter(id => !isLegacyIndexOnlyId(id));
        }
    }

    /**
     * Handle a same-day deleted conversation safely:
     * Preserves ALL recorded call counts, tokens, costs, and content-qualified dedup keys
     * while clearing only legacy index-only keys so subsequent conversations or increments
     * on the same day are never swallowed or collided.
     */
    recordConversationDeleted(cascadeId: string): void {
        if (!cascadeId) { return; }
        this.clearRecordedIdsForConversation(cascadeId);
    }

    /**
     * Check if a specific pool (by modelIds + email) has already been settled.
     * Used by proactive settlement to avoid duplicate settlements.
     */
    isPoolSettled(modelIds: string[], email?: string, cutoffTime?: number): boolean {
        const querySet = new Set(modelIds.map(id => id.toLowerCase()));
        const cutoffMs = typeof cutoffTime === 'number' && !Number.isNaN(cutoffTime)
            ? cutoffTime
            : undefined;
        for (const entry of this._settled) {
            const matchEmail = !email || entry.accountEmail === email;
            if (!matchEmail) { continue; }
            // Compare by poolModelIds (raw model IDs), not modelCalls (display names)
            const overlap = (entry.poolModelIds || []).some(
                pid => querySet.has(pid.toLowerCase()),
            );
            if (!overlap) { continue; }
            if (cutoffMs === undefined) { return true; }
            if (typeof entry.settledCutoffTime === 'number'
                && entry.settledCutoffTime >= cutoffMs) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if the active bucket for a given email has any recorded calls
     * for models in the specified pool. Used to detect real usage even when
     * the account snapshot's `hasUsage` flag is stale.
     */
    hasActiveCallsForPool(poolModelIds: string[], email?: string): boolean {
        const acctEmail = email || '';
        const bucket = this._accounts.get(acctEmail);
        if (!bucket || bucket.totalCalls === 0) { return false; }

        const poolIdSet = new Set(poolModelIds.map(id => id.toLowerCase()));
        for (const modelKey of Object.keys(bucket.modelStats)) {
            const resolvedId = resolveModelId(modelKey);
            if (resolvedId && poolIdSet.has(resolvedId.toLowerCase())) {
                return true;
            }
            // Fallback: display name match
            for (const pid of poolModelIds) {
                const pidDisplay = normalizeModelDisplayName(pid);
                if (pidDisplay && pidDisplay.toLowerCase() === modelKey.toLowerCase()) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Record a batch of new GM calls into the ledger, returning per-entry statuses and
     * `contiguousAdvanceCount` (length of leading prefix whose status is
     * `'added' | 'duplicate' | 'rejected_terminal'`) so callers can advance `_ledgerPositions`
     * without cursor deadlock on mixed batches.
     *
     * Late-arriving pre-midnight calls (within 6h before midnight) are routed into their
     * true local date bucket (`_lateDays`) rather than dropped or misattributed to today.
     */
    recordCallsDetailed(entries: LedgerCallEntry[], defaultSurface?: UsageSurface): RecordCallsDetailedResult {
        const statuses: RecordCallStatus[] = [];
        let added = 0;
        const todayKey = toLocalDateKey();
        const fallbackSurface = normalizeUsageSurface(defaultSurface ?? this._defaultSurface);

        // If the date has rolled over, empty stale ledgers have nothing to flush so normalize immediately.
        // Data-bearing stale ledgers must wait for performDailyArchival() before recording new-day calls,
        // though late calls timestamped for `this._dateKey` itself can still be captured before rollover.
        if (todayKey !== this._dateKey) {
            this.normalizeIfStaleEmpty(todayKey);
        }
        const isStaleWaitingForRollover = todayKey !== this._dateKey;

        const dayStartMs = dateKeyToStartOfDayMs(this._dateKey);
        const nextDayStartMs = dateKeyToNextDayStartMs(this._dateKey);
        const nowMs = Date.now();
        const isWithinLateWindow = (callMs: number, callDateKey: string): boolean => {
            if (!callDateKey || callDateKey >= this._dateKey) { return false; }
            const refMs = Math.max(nowMs, dayStartMs);
            return (refMs - callMs) <= LATE_CROSS_MIDNIGHT_WINDOW_MS;
        };

        for (const entry of entries) {
            const call = entry.call;
            const callMs = call.createdAt ? Date.parse(call.createdAt) : Number.NaN;
            const hasValidTs = !Number.isNaN(callMs);

            if (isStaleWaitingForRollover) {
                if (hasValidTs && dayStartMs > 0 && callMs >= dayStartMs && (nextDayStartMs <= 0 || callMs < nextDayStartMs)) {
                    // Late pre-midnight call belonging to the un-rolled-over ledger day: accept into _accounts.
                    const st = this._recordIntoAccountMap(
                        this._accounts,
                        this._dateKey,
                        entry,
                        fallbackSurface,
                        false,
                    );
                    statuses.push(st);
                    if (st === 'added') { added++; }
                    continue;
                }
                if (hasValidTs && dayStartMs > 0 && callMs < dayStartMs) {
                    const callDateKey = toLocalDateKey(new Date(callMs));
                    if (isWithinLateWindow(callMs, callDateKey)) {
                        const st = this._recordIntoLateDay(callDateKey, entry, fallbackSurface);
                        statuses.push(st);
                        if (st === 'added') { added++; }
                    } else {
                        statuses.push('rejected_terminal');
                    }
                    continue;
                }
                // Belongs to today (or undated) while yesterday's data-bearing ledger awaits archival rollover.
                statuses.push('retryable');
                continue;
            }

            if (dayStartMs > 0 && hasValidTs) {
                if (nextDayStartMs > 0 && callMs >= nextDayStartMs) {
                    statuses.push('rejected_terminal');
                    continue;
                }
                if (callMs < dayStartMs) {
                    const callDateKey = toLocalDateKey(new Date(callMs));
                    if (isWithinLateWindow(callMs, callDateKey)) {
                        const st = this._recordIntoLateDay(callDateKey, entry, fallbackSurface);
                        statuses.push(st);
                        if (st === 'added') { added++; }
                    } else {
                        statuses.push('rejected_terminal');
                    }
                    continue;
                }
            }

            const st = this._recordIntoAccountMap(
                this._accounts,
                this._dateKey,
                entry,
                fallbackSurface,
                false,
            );
            statuses.push(st);
            if (st === 'added') { added++; }
        }

        let contiguousAdvanceCount = 0;
        for (const st of statuses) {
            if (st === 'added' || st === 'duplicate' || st === 'rejected_terminal') {
                contiguousAdvanceCount++;
            } else {
                break;
            }
        }

        return { added, statuses, contiguousAdvanceCount };
    }

    /**
     * Record a batch of new GM calls into the ledger.
     * Each entry carries a `dedupKey` (provided by the tracker) for reliable dedup.
     * @returns number of newly recorded calls
     */
    recordCalls(entries: LedgerCallEntry[], defaultSurface?: UsageSurface): number {
        return this.recordCallsDetailed(entries, defaultSurface).added;
    }

    private _recordIntoLateDay(
        targetDateKey: string,
        entry: LedgerCallEntry,
        fallbackSurface: UsageSurface,
    ): 'added' | 'duplicate' {
        let dayMap = this._lateDays.get(targetDateKey);
        if (!dayMap) {
            dayMap = new Map<string, LedgerAccountBucket>();
            this._lateDays.set(targetDateKey, dayMap);
        }
        return this._recordIntoAccountMap(dayMap, targetDateKey, entry, fallbackSurface, true);
    }

    private _recordIntoAccountMap(
        accountMap: Map<string, LedgerAccountBucket>,
        effectiveDateKey: string,
        entry: LedgerCallEntry,
        fallbackSurface: UsageSurface,
        isLateDay: boolean,
    ): 'added' | 'duplicate' {
        const call = entry.call;
        const id = entry.dedupKey || fallbackCallId(call);
        const canonicalId = canonicalLogicalCallId(id);
        if (
            this._allRecordedIds.has(id)
            || this._allRecordedIds.has(canonicalId)
            || (isLateDay && (this._lateRecordedIds.has(id) || this._lateRecordedIds.has(canonicalId)))
        ) {
            return 'duplicate';
        }

        const email = (entry.account ?? entry.accountEmail ?? call.accountEmail ?? '').trim();
        let bucket = accountMap.get(email);
        if (!bucket) {
            bucket = emptyBucket(email);
            accountMap.set(email, bucket);
        }

        const callSurface = normalizeUsageSurface(
            entry.surface ?? (call as { surface?: string }).surface ?? fallbackSurface,
        );
        const callAuthority = normalizeAuthorityTag(entry.authority);
        const callCascadeId = resolveCallCascadeId(entry);
        const callWorkspace = normalizeWorkspaceKey(entry.workspace, callAuthority);
        const hasExplicitAttribution = Boolean(
            entry.workspace
            || callAuthority
            || bucket.workspaceBreakdown,
        );

        if (callSurface !== 'unknown' && !bucket.surfaceBreakdown && bucket.totalCalls > 0) {
            bucket.surfaceBreakdown = { [normalizeUsageSurface(bucket.surface)]: bucketToSurfaceStats(bucket) };
        }

        if (hasExplicitAttribution && !bucket.workspaceBreakdown && bucket.totalCalls > 0) {
            const snap = bucketToSurfaceStats(bucket);
            const seededPriorSurfaces = cloneSurfaceBreakdown(bucket.surfaceBreakdown)
                ?? { [normalizeUsageSurface(bucket.surface)]: snap };
            bucket.workspaceBreakdown = {
                [UNATTRIBUTED_WORKSPACE_KEY]: {
                    calls: snap.calls, inputTokens: snap.inputTokens, outputTokens: snap.outputTokens,
                    thinkingTokens: snap.thinkingTokens, cacheReadTokens: snap.cacheReadTokens,
                    cacheCreationTokens: snap.cacheCreationTokens, credits: snap.credits,
                    knownCostUsd: snap.estimatedCost, unpricedCalls: 0, bySurface: seededPriorSurfaces,
                },
            };
        }

        // Accumulate totals
        bucket.totalCalls++;
        bucket.totalInputTokens += call.inputTokens;
        bucket.totalOutputTokens += call.outputTokens;
        bucket.totalThinkingTokens += call.thinkingTokens;
        bucket.totalCacheRead += call.cacheReadTokens;
        bucket.totalCacheCreation += call.cacheCreationTokens;
        bucket.totalCredits += call.credits;

        const costDetail = estimateCallCostDetail(call, effectiveDateKey);
        const cost = costDetail.cost;
        const unpriced = !costDetail.priced;
        bucket.totalEstimatedCost += cost;

        if (callSurface !== 'unknown' || bucket.surfaceBreakdown) {
            if (!bucket.surfaceBreakdown) {
                bucket.surfaceBreakdown = {};
            }
            const sStats = bucket.surfaceBreakdown[callSurface] || emptySurfaceStats();
            addSurfaceStats(sStats, callToSurfaceStats(call, cost));
            bucket.surfaceBreakdown[callSurface] = sStats;
            const dominant = dominantUsageSurface(bucket.surfaceBreakdown, callSurface);
            if (dominant) {
                bucket.surface = dominant;
            }
        }

        if (hasExplicitAttribution || callWorkspace !== UNATTRIBUTED_WORKSPACE_KEY) {
            if (!bucket.workspaceBreakdown) {
                bucket.workspaceBreakdown = {};
            }
            addCallToWorkspaceBreakdown(bucket.workspaceBreakdown, callWorkspace, {
                inputTokens: call.inputTokens,
                outputTokens: call.outputTokens,
                thinkingTokens: call.thinkingTokens,
                cacheReadTokens: call.cacheReadTokens,
                cacheCreationTokens: call.cacheCreationTokens,
                credits: call.credits,
                estimatedCost: cost,
                unpriced,
                authority: callAuthority,
                surface: callSurface,
            }, callSurface);
        }

        // Per-model breakdown.
        const modelKey = resolveModelKeyForLedger(call);

        let ms = bucket.modelStats[modelKey];
        if (!ms) {
            ms = emptyModelStats();
            bucket.modelStats[modelKey] = ms;
        }
        ms.calls++;
        ms.inputTokens += call.inputTokens;
        ms.outputTokens += call.outputTokens;
        ms.thinkingTokens += call.thinkingTokens;
        ms.cacheReadTokens += call.cacheReadTokens;
        ms.cacheCreationTokens += call.cacheCreationTokens;
        ms.credits += call.credits;
        ms.estimatedCost += cost;
        addCallTelemetryToModelStats(
            ms,
            call.ttftSeconds,
            call.streamingSeconds,
            call.outputTokens,
            call.cacheReadTokens,
        );

        // Mark as recorded (assigned ONCE per logical call)
        bucket.recordedCallIds.push(id);
        const createdAtMs = parseCallCreatedAtMs(call.createdAt);
        const recordedCall: LedgerRecordedCall = {
            callId: id,
            createdAt: call.createdAt || '',
            createdAtMs,
            modelId: resolveCallModelId(call, modelKey),
            modelKey,
            inputTokens: call.inputTokens,
            outputTokens: call.outputTokens,
            thinkingTokens: call.thinkingTokens,
            cacheReadTokens: call.cacheReadTokens,
            cacheCreationTokens: call.cacheCreationTokens,
            credits: call.credits,
            estimatedCost: cost,
        };
        if (typeof call.ttftSeconds === 'number' && Number.isFinite(call.ttftSeconds) && call.ttftSeconds > 0) {
            recordedCall.ttftSeconds = call.ttftSeconds;
        }
        if (typeof call.streamingSeconds === 'number' && Number.isFinite(call.streamingSeconds) && call.streamingSeconds > 0) {
            recordedCall.streamingSeconds = call.streamingSeconds;
        }
        if (callSurface !== 'unknown') {
            recordedCall.surface = callSurface;
        }
        if (email) {
            recordedCall.account = email;
        }
        if (callAuthority) {
            recordedCall.authority = callAuthority;
        }
        if (callCascadeId) {
            recordedCall.cascadeId = callCascadeId;
        }
        if (callWorkspace !== UNATTRIBUTED_WORKSPACE_KEY || hasExplicitAttribution) {
            recordedCall.workspace = callWorkspace;
        }
        if (unpriced) {
            recordedCall.unpriced = true;
        }
        bucket.recordedCalls.push(recordedCall);
        this._allRecordedIds.add(id);
        this._allRecordedIds.add(canonicalId);
        if (isLateDay) {
            this._lateRecordedIds.add(id);
            this._lateRecordedIds.add(canonicalId);
        }
        return 'added';
    }

    /**
     * Upgrade metadata/cost gaps for already-recorded active calls, without adding
     * tokens or call counts. GM dedup correctly suppresses these calls as "new",
     * so a separate pass is required when a later version learns their timestamp
     * or official price. Positive historical costs are never rewritten.
     */
    reconcileRecordedCalls(entries: readonly LedgerCallEntry[]): number {
        let changed = 0;
        const start = dateKeyToStartOfDayMs(this._dateKey);
        const end = dateKeyToNextDayStartMs(this._dateKey);
        const indexes = new Map<LedgerAccountBucket, Map<string, LedgerRecordedCall[]>>();
        const tokenFields = ['inputTokens', 'outputTokens', 'thinkingTokens', 'cacheReadTokens', 'cacheCreationTokens'] as const;
        for (const entry of entries) {
            const call = entry.call;
            if (!isValidCallTimestamp(call.createdAt)) { continue; }
            const callTime = Date.parse(call.createdAt);
            if ((start > 0 && callTime < start) || (end > 0 && callTime >= end)) { continue; }
            const bucket = this._accounts.get(call.accountEmail || '');
            if (!bucket) { continue; }
            let index = indexes.get(bucket);
            if (!index) {
                index = new Map();
                for (const recorded of bucket.recordedCalls || []) {
                    const matches = index.get(recorded.callId) || [];
                    matches.push(recorded); index.set(recorded.callId, matches);
                }
                indexes.set(bucket, index);
            }
            const id = entry.dedupKey || fallbackCallId(call);
            const matches = index.get(id)
                || bucket.recordedCalls.filter(recorded => recordedCallIdentityMatches(recorded.callId, entry));
            // Never guess which of several historical records a refreshed call belongs to.
            if (matches.length !== 1) { continue; }
            const recorded = matches[0];
            const modelId = resolveCallModelId(call, resolveModelKeyForLedger(call));
            if ((resolveModelId(recorded.modelId) || recorded.modelId) !== modelId
                || !tokenFields.every(field => recorded[field] === call[field])) { continue; }
            if (isValidCallTimestamp(recorded.createdAt) && Date.parse(recorded.createdAt) !== callTime) { continue; }
            let updated = false;
            if (!isValidCallTimestamp(recorded.createdAt)) {
                recorded.createdAt = call.createdAt;
                recorded.createdAtMs = callTime;
                updated = true;
            }
            if ((recorded.estimatedCost === 0 || recorded.estimatedCost === undefined)
                && Object.prototype.hasOwnProperty.call(bucket.modelStats, recorded.modelKey)) {
                const stats = bucket.modelStats[recorded.modelKey];
                const modelCalls = bucket.recordedCalls.filter(item => item.modelKey === recorded.modelKey);
                const representedCost = modelCalls.reduce((sum, item) => sum + (item.estimatedCost || 0), 0);
                const bucketCost = Object.values(bucket.modelStats).reduce((sum, item) => sum + item.estimatedCost, 0);
                // An unexplained positive aggregate might already include the
                // missing per-call amount. Only add a gap when totals reconcile.
                const fullyRepresented = modelCalls.length === stats.calls
                    && tokenFields.every(field => modelCalls.reduce((sum, item) => sum + item[field], 0) === stats[field])
                    && sameAmount(stats.estimatedCost, representedCost)
                    && sameAmount(bucket.totalEstimatedCost, bucketCost);
                if (fullyRepresented) {
                    const price = findPricingForDate(recorded.modelId || recorded.modelKey, {}, recorded.createdAt);
                    const cost = price ? costFromTokens(recorded, price) : 0;
                    if (Number.isFinite(cost) && cost > 0) {
                        recorded.estimatedCost = cost;
                        stats.estimatedCost += cost;
                        bucket.totalEstimatedCost += cost;
                        if (bucket.surfaceBreakdown) {
                            const surf = normalizeUsageSurface(recorded.surface ?? bucket.surface);
                            if (bucket.surfaceBreakdown[surf]) {
                                bucket.surfaceBreakdown[surf]!.estimatedCost += cost;
                            }
                        }
                        if (bucket.workspaceBreakdown) {
                            const wsKey = normalizeWorkspaceKey(recorded.workspace, recorded.authority);
                            const wsEntry = bucket.workspaceBreakdown[wsKey];
                            if (wsEntry) {
                                wsEntry.knownCostUsd += cost;
                                if (recorded.unpriced) {
                                    wsEntry.unpricedCalls = Math.max(0, wsEntry.unpricedCalls - 1);
                                }
                                const surf = normalizeUsageSurface(recorded.surface ?? bucket.surface);
                                if (wsEntry.bySurface?.[surf]) {
                                    wsEntry.bySurface[surf]!.estimatedCost += cost;
                                }
                            }
                        }
                        if (recorded.unpriced) {
                            delete recorded.unpriced;
                        }
                        updated = true;
                    }
                }
            }
            if (updated) { changed++; }
        }
        return changed;
    }

    /**
     * Settle (freeze) data for a specific quota pool after reset.
     * Moves matching model data from active bucket to a settled entry.
     * The settled data stays until midnight rollover.
     *
     * @param poolModelIds Model IDs in the reset pool (e.g. ['MODEL_PLACEHOLDER_M16', ...])
     * @param accountEmail Account email to settle
     * @param cutoffTime Optional reset boundary. Only calls created at or before
     *                   this time are settled; later calls remain active.
     * @returns the settled entry, or null if no matching data
     */
    settleForQuotaReset(poolModelIds: string[], accountEmail?: string, cutoffTime?: number): LedgerSettledEntry | null {
        const email = accountEmail || '';
        const bucket = this._accounts.get(email);
        if (!bucket || bucket.totalCalls === 0) { return null; }
        const cutoffMs = typeof cutoffTime === 'number' && !Number.isNaN(cutoffTime)
            ? cutoffTime
            : undefined;
        const settledStatsByModel: Record<string, LedgerModelStats> = {};
        const representedStatsByModel: Record<string, LedgerModelStats> = {};
        const settledSurfaceBreakdown: Partial<Record<UsageSurface, SurfaceUsageStats>> = {};
        const settledWorkspaceBreakdown: Record<string, WorkspaceUsageStats> = {};
        const hasSurfaceTracking = Boolean(bucket.surfaceBreakdown || bucket.surface);
        const hasWorkspaceTracking = Boolean(bucket.workspaceBreakdown);
        const recordedCalls = Array.isArray(bucket.recordedCalls) ? bucket.recordedCalls : [];
        const remainingCalls: LedgerRecordedCall[] = [];
        const settledCalls: LedgerRecordedCall[] = [];
        const settledCallIds: string[] = [];
        const seenSettledCallIds = new Set<string>();

        for (const call of recordedCalls) {
            const matches = callMatchesPool(call.modelKey, call.modelId, poolModelIds);
            if (matches) {
                const represented = representedStatsByModel[call.modelKey] || emptyModelStats();
                addRecordedCallStats(represented, call);
                representedStatsByModel[call.modelKey] = represented;
            }
            if (!matches || !isRecordedCallBeforeCutoff(call, cutoffMs)) {
                remainingCalls.push(call);
                continue;
            }
            const stats = settledStatsByModel[call.modelKey] || emptyModelStats();
            addRecordedCallStats(stats, call);
            settledStatsByModel[call.modelKey] = stats;

            const callCanon = canonicalLogicalCallId(call.callId);
            if (call.callId && !seenSettledCallIds.has(callCanon)) {
                seenSettledCallIds.add(callCanon);
                settledCallIds.push(call.callId);
                settledCalls.push({
                    ...call,
                    ...(call.surface ? {} : (bucket.surface && bucket.surface !== 'unknown' ? { surface: bucket.surface } : {})),
                });
            }

            if (hasSurfaceTracking || call.surface) {
                const surf = normalizeUsageSurface(call.surface ?? bucket.surface);
                const sStats = settledSurfaceBreakdown[surf] || emptySurfaceStats();
                addSurfaceStats(sStats, callToSurfaceStats(call, call.estimatedCost));
                settledSurfaceBreakdown[surf] = sStats;
            }

            if (hasWorkspaceTracking || call.workspace || call.authority) {
                const wsKey = normalizeWorkspaceKey(call.workspace, call.authority);
                addCallToWorkspaceBreakdown(
                    settledWorkspaceBreakdown,
                    wsKey,
                    call,
                    normalizeUsageSurface(call.surface ?? bucket.surface),
                );
            }
        }
        bucket.recordedCalls = remainingCalls;

        for (const [modelKey, ms] of Object.entries(bucket.modelStats)) {
            if (!callMatchesPool(modelKey, resolveModelId(modelKey), poolModelIds)) { continue; }
            const unrepresented = subtractModelStatsSnapshot(ms, representedStatsByModel[modelKey]);
            if (hasModelStatsData(unrepresented)) {
                const stats = settledStatsByModel[modelKey] || emptyModelStats();
                addModelStats(stats, unrepresented);
                settledStatsByModel[modelKey] = stats;
                const fallbackSurf = normalizeUsageSurface(bucket.surface);
                const unrepSurf = callToSurfaceStats(unrepresented, unrepresented.estimatedCost, unrepresented.calls);
                if (hasSurfaceTracking) {
                    const sStats = settledSurfaceBreakdown[fallbackSurf] || emptySurfaceStats();
                    addSurfaceStats(sStats, unrepSurf);
                    settledSurfaceBreakdown[fallbackSurf] = sStats;
                }
                if (hasWorkspaceTracking) {
                    const wsEntry = settledWorkspaceBreakdown[UNATTRIBUTED_WORKSPACE_KEY] || emptyWorkspaceStats();
                    addWorkspaceStats(wsEntry, {
                        calls: unrepSurf.calls, inputTokens: unrepSurf.inputTokens, outputTokens: unrepSurf.outputTokens,
                        thinkingTokens: unrepSurf.thinkingTokens, cacheReadTokens: unrepSurf.cacheReadTokens,
                        cacheCreationTokens: unrepSurf.cacheCreationTokens, credits: unrepSurf.credits,
                        knownCostUsd: unrepSurf.estimatedCost, unpricedCalls: 0,
                        bySurface: { [fallbackSurf]: unrepSurf },
                    });
                    settledWorkspaceBreakdown[UNATTRIBUTED_WORKSPACE_KEY] = wsEntry;
                }
            }
        }

        const matchingModelKeys = Object.keys(settledStatsByModel);
        if (matchingModelKeys.length === 0) { return null; }

        let totalCalls = 0;
        let totalIn = 0, totalOut = 0, totalThinking = 0, totalCache = 0, totalCacheCreation = 0;
        let totalCredits = 0, totalCost = 0;
        const modelCalls: Record<string, number> = {};
        const modelStatsSnapshot: Record<string, LedgerModelStats> = {};
        const modelTelemetry: Record<string, LedgerModelTelemetry> = {};

        for (const key of matchingModelKeys) {
            const ms = settledStatsByModel[key];
            if (!ms) { continue; }
            totalCalls += ms.calls;
            totalIn += ms.inputTokens;
            totalOut += ms.outputTokens;
            totalThinking += ms.thinkingTokens;
            totalCache += ms.cacheReadTokens;
            totalCacheCreation += ms.cacheCreationTokens;
            totalCredits += ms.credits;
            totalCost += ms.estimatedCost;
            modelCalls[key] = ms.calls;
            modelStatsSnapshot[key] = { ...ms };
            if ((ms.ttftCount || 0) > 0 || (ms.streamingCount || 0) > 0
                || (ms.timedStreamingSeconds || 0) > 0 || (ms.cacheHitCalls || 0) > 0) {
                modelTelemetry[key] = {
                    ttftSum: ms.ttftSum || 0,
                    ttftCount: ms.ttftCount || 0,
                    ...(ms.minTTFT && ms.minTTFT > 0 ? { minTTFT: ms.minTTFT } : {}),
                    ...(ms.maxTTFT && ms.maxTTFT > 0 ? { maxTTFT: ms.maxTTFT } : {}),
                    streamingSum: ms.streamingSum || 0,
                    streamingCount: ms.streamingCount || 0,
                    timedOutputTokens: ms.timedOutputTokens || 0,
                    timedStreamingSeconds: ms.timedStreamingSeconds || 0,
                    cacheHitCalls: ms.cacheHitCalls || 0,
                };
            }
            subtractStatsFromBucket(bucket, key, ms);
        }

        if (bucket.surfaceBreakdown) {
            for (const [surfKey, sStats] of Object.entries(settledSurfaceBreakdown)) {
                const surf = normalizeUsageSurface(surfKey);
                const activeSurf = bucket.surfaceBreakdown[surf];
                if (activeSurf && sStats) {
                    subtractSurfaceStats(activeSurf, sStats);
                    if (!hasSurfaceStatsData(activeSurf)) {
                        delete bucket.surfaceBreakdown[surf];
                    }
                }
            }
            if (Object.keys(bucket.surfaceBreakdown).length === 0) {
                delete bucket.surfaceBreakdown;
            }
        }

        if (bucket.workspaceBreakdown) {
            for (const [wsKey, wStats] of Object.entries(settledWorkspaceBreakdown)) {
                const activeWs = bucket.workspaceBreakdown[wsKey];
                if (activeWs && wStats) {
                    subtractWorkspaceStats(activeWs, wStats);
                    if (!hasWorkspaceStatsData(activeWs)) {
                        delete bucket.workspaceBreakdown[wsKey];
                    }
                }
            }
            if (Object.keys(bucket.workspaceBreakdown).length === 0) {
                delete bucket.workspaceBreakdown;
            }
        }

        const clonedSettledBreakdown = cloneSurfaceBreakdown(settledSurfaceBreakdown);
        const clonedSettledWorkspaceBreakdown = cloneWorkspaceBreakdown(settledWorkspaceBreakdown);
        const settledDominantSurface = dominantUsageSurface(clonedSettledBreakdown, bucket.surface);

        const entry: LedgerSettledEntry = {
            settledAt: new Date().toISOString(),
            accountEmail: email,
            poolModelIds,
            poolModelLabels: matchingModelKeys,
            totalCalls,
            totalInputTokens: totalIn,
            totalOutputTokens: totalOut,
            totalThinkingTokens: totalThinking,
            totalCacheRead: totalCache,
            totalCacheCreation,
            totalCredits,
            totalEstimatedCost: totalCost,
            settledCutoffTime: cutoffMs,
            modelCalls,
            modelStats: modelStatsSnapshot,
            ...(Object.keys(modelTelemetry).length > 0 ? { modelTelemetry } : {}),
            ...(settledDominantSurface ? { surface: settledDominantSurface } : {}),
            ...(clonedSettledBreakdown ? { surfaceBreakdown: clonedSettledBreakdown } : {}),
            ...(clonedSettledWorkspaceBreakdown ? { workspaceBreakdown: clonedSettledWorkspaceBreakdown } : {}),
            ...(settledCalls.length > 0 ? { settledCalls } : {}),
            ...(settledCallIds.length > 0 ? { recordedCallIds: settledCallIds } : {}),
        };

        this._settled.push(entry);
        return entry;
    }

    /**
     * Non-destructive snapshot of the current ledger day (active + settled) for
     * live Calendar rendering and diagnostics without resetting state.
     */
    getLiveDaySnapshot(dateKeyOverride?: string): LedgerDayData {
        const dateKey = dateKeyOverride || this._dateKey;
        const accounts: Record<string, LedgerAccountBucket> = {};
        for (const [email, bucket] of this._accounts) {
            accounts[email] = this._cloneBucket(bucket);
        }
        return { dateKey, accounts, settled: this._settled.map(s => DailyLedger._cloneSettled(s, true)) };
    }

    /**
     * Non-destructive snapshots of any late-arriving pre-midnight calls bucketed by their true local date.
     */
    getLateDaySnapshots(): LedgerDayData[] {
        const out: LedgerDayData[] = [];
        for (const [dateKey, acctMap] of [...this._lateDays.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            const accounts: Record<string, LedgerAccountBucket> = {};
            let hasCalls = false;
            for (const [email, bucket] of acctMap) {
                if (bucket.totalCalls > 0) {
                    accounts[email] = this._cloneBucket(bucket);
                    hasCalls = true;
                }
            }
            if (hasCalls) {
                out.push({ dateKey, accounts, settled: [] });
            }
        }
        return out;
    }

    /**
     * Acknowledge that late-arriving calls for `dateKey` have been durably persisted to `DailyStore`.
     * Removes only the confirmed calls from `_lateDays` (never draining before persistence succeeds),
     * while retaining their canonical call IDs in `_lateRecordedIds` and `_allRecordedIds` so
     * subsequent polls will not duplicate them.
     *
     * If `callIds` is omitted, acknowledges all currently queued calls for `dateKey`.
     * Returns the number of acknowledged calls removed from the pending queue.
     */
    acknowledgeLateDayCalls(dateKey: string, callIds?: readonly string[]): number {
        const acctMap = this._lateDays.get(dateKey);
        if (!acctMap) { return 0; }

        if (!callIds) {
            let removed = 0;
            for (const bucket of acctMap.values()) {
                removed += bucket.totalCalls;
                for (const id of bucket.recordedCallIds) {
                    const canon = canonicalLogicalCallId(id);
                    this._lateRecordedIds.add(id);
                    this._lateRecordedIds.add(canon);
                    this._allRecordedIds.add(id);
                    this._allRecordedIds.add(canon);
                }
            }
            this._lateDays.delete(dateKey);
            return removed;
        }

        const ackCanonSet = new Set<string>();
        for (const id of callIds) {
            if (!id) { continue; }
            const canon = canonicalLogicalCallId(id);
            ackCanonSet.add(id);
            ackCanonSet.add(canon);
            this._lateRecordedIds.add(id);
            this._lateRecordedIds.add(canon);
            this._allRecordedIds.add(id);
            this._allRecordedIds.add(canon);
        }
        if (ackCanonSet.size === 0) { return 0; }

        let removed = 0;
        for (const [email, bucket] of [...acctMap.entries()]) {
            const remainingCalls: LedgerRecordedCall[] = [];
            for (const call of bucket.recordedCalls) {
                if (ackCanonSet.has(call.callId) || ackCanonSet.has(canonicalLogicalCallId(call.callId))) {
                    removed++;
                } else {
                    remainingCalls.push(call);
                }
            }
            if (remainingCalls.length === 0) {
                acctMap.delete(email);
                continue;
            }
            if (remainingCalls.length === bucket.recordedCalls.length) {
                continue;
            }
            // Rebuild bucket aggregates strictly from remaining unacknowledged late calls
            const rebuilt = emptyBucket(email);
            const hasSurf = Boolean(bucket.surfaceBreakdown || bucket.surface);
            const hasWs = Boolean(bucket.workspaceBreakdown);
            for (const call of remainingCalls) {
                rebuilt.totalCalls++;
                rebuilt.totalInputTokens += call.inputTokens;
                rebuilt.totalOutputTokens += call.outputTokens;
                rebuilt.totalThinkingTokens += call.thinkingTokens;
                rebuilt.totalCacheRead += call.cacheReadTokens;
                rebuilt.totalCacheCreation += call.cacheCreationTokens;
                rebuilt.totalCredits += call.credits;
                rebuilt.totalEstimatedCost += call.estimatedCost;
                const ms = rebuilt.modelStats[call.modelKey] || emptyModelStats();
                addRecordedCallStats(ms, call);
                rebuilt.modelStats[call.modelKey] = ms;
                rebuilt.recordedCallIds.push(call.callId);
                rebuilt.recordedCalls.push(call);
                if (hasSurf || call.surface) {
                    const surf = normalizeUsageSurface(call.surface ?? bucket.surface);
                    if (!rebuilt.surfaceBreakdown) { rebuilt.surfaceBreakdown = {}; }
                    const sb = rebuilt.surfaceBreakdown[surf] || emptySurfaceStats();
                    addSurfaceStats(sb, callToSurfaceStats(call, call.estimatedCost));
                    rebuilt.surfaceBreakdown[surf] = sb;
                }
                if (hasWs || call.workspace || call.authority) {
                    if (!rebuilt.workspaceBreakdown) { rebuilt.workspaceBreakdown = {}; }
                    const wsKey = normalizeWorkspaceKey(call.workspace, call.authority);
                    addCallToWorkspaceBreakdown(
                        rebuilt.workspaceBreakdown,
                        wsKey,
                        call,
                        normalizeUsageSurface(call.surface ?? bucket.surface),
                    );
                }
            }
            const dom = dominantUsageSurface(rebuilt.surfaceBreakdown, bucket.surface);
            if (dom) { rebuilt.surface = dom; }
            acctMap.set(email, rebuilt);
        }

        if (acctMap.size === 0) {
            this._lateDays.delete(dateKey);
        }
        return removed;
    }

    /**
     * Drain all pending late-arriving pre-midnight day buckets (after flushing them to DailyStore).
     * Retains their call IDs in `_lateRecordedIds` so subsequent polls will not duplicate them.
     */
    drainLateDaySnapshots(): LedgerDayData[] {
        const snapshots = this.getLateDaySnapshots();
        for (const snap of snapshots) {
            this.acknowledgeLateDayCalls(snap.dateKey);
        }
        return snapshots;
    }

    /** Inspect a pending late-day account bucket by local dateKey and email. */
    getLateDayBucket(dateKey: string, email: string): LedgerAccountBucket | null {
        return this._lateDays.get(dateKey)?.get(email) || null;
    }

    /**
     * Midnight rollover: return all data for the completed day, then reset.
     * Returns combined active + settled data for the day.
     */
    rollover(archiveDateKey?: string): LedgerDayData {
        const result = this.getLiveDaySnapshot(archiveDateKey || this._dateKey);

        // Reset for new day
        this._resetForNewDay(toLocalDateKey());

        return result;
    }

    /** Get active (unsettled) data for all accounts */
    getTodayActive(): LedgerAccountBucket[] {
        return [...this._accounts.values()].filter(b => b.totalCalls > 0);
    }

    /** Get active data for a specific account */
    getAccountActive(email: string): LedgerAccountBucket | null {
        return this._accounts.get(email) || null;
    }

    /** Get settled entries (from quota resets, waiting for midnight flush) */
    getSettledEntries(): LedgerSettledEntry[] {
        return [...this._settled];
    }

    /** Get combined totals (active + settled) for today */
    getTodayTotals(): { totalCalls: number; totalCost: number } {
        const { totalCalls, totalCost } = this.getTodayDetailedTotals();
        return { totalCalls, totalCost };
    }

    /** Get combined additive token, call, credit, and cost totals (active + settled) for today */
    getTodayDetailedTotals(): {
        totalCalls: number;
        totalCost: number;
        totalCredits: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        totalThinkingTokens: number;
        totalCacheRead: number;
        totalCacheCreation: number;
        totalAdditiveTokens: number;
    } {
        let totalCalls = 0;
        let totalCost = 0;
        let totalCredits = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalThinkingTokens = 0;
        let totalCacheRead = 0;
        let totalCacheCreation = 0;

        for (const bucket of this._accounts.values()) {
            totalCalls += bucket.totalCalls;
            totalCost += bucket.totalEstimatedCost;
            totalCredits += bucket.totalCredits;
            totalInputTokens += bucket.totalInputTokens;
            totalOutputTokens += bucket.totalOutputTokens;
            totalThinkingTokens += bucket.totalThinkingTokens;
            totalCacheRead += bucket.totalCacheRead;
            totalCacheCreation += bucket.totalCacheCreation;
        }
        for (const entry of this._settled) {
            totalCalls += entry.totalCalls;
            totalCost += entry.totalEstimatedCost;
            totalCredits += entry.totalCredits;
            totalInputTokens += entry.totalInputTokens;
            totalOutputTokens += entry.totalOutputTokens;
            totalThinkingTokens += entry.totalThinkingTokens || 0;
            totalCacheRead += entry.totalCacheRead;
            totalCacheCreation += entry.totalCacheCreation || 0;
        }

        return {
            totalCalls,
            totalCost,
            totalCredits,
            totalInputTokens,
            totalOutputTokens,
            totalThinkingTokens,
            totalCacheRead,
            totalCacheCreation,
            totalAdditiveTokens: totalInputTokens + totalCacheRead + totalCacheCreation + totalOutputTokens,
        };
    }

    /** Check if ledger has any data (active, settled, or pending late prior-day calls) */
    get hasData(): boolean {
        for (const bucket of this._accounts.values()) {
            if (bucket.totalCalls > 0) { return true; }
        }
        if (this._settled.length > 0) { return true; }
        for (const acctMap of this._lateDays.values()) {
            for (const bucket of acctMap.values()) {
                if (bucket.totalCalls > 0) { return true; }
            }
        }
        return false;
    }

    // ─── Serialization ───────────────────────────────────────────────────

    serialize(): DailyLedgerState {
        const snapshot = this.getLiveDaySnapshot(this._dateKey);
        const lateDays: Record<string, Record<string, LedgerAccountBucket>> = {};
        for (const late of this.getLateDaySnapshots()) {
            lateDays[late.dateKey] = late.accounts;
        }
        return {
            version: 1,
            dateKey: snapshot.dateKey,
            accounts: snapshot.accounts,
            settled: snapshot.settled,
            ...(Object.keys(lateDays).length > 0 ? { lateDays } : {}),
        };
    }

    private static _cloneSettled(s: LedgerSettledEntry, forSnapshot: boolean): LedgerSettledEntry {
        const { surfaceBreakdown: rawSb, workspaceBreakdown: rawWb, ...rest } = s;
        const clonedBreakdown = cloneSurfaceBreakdown(rawSb);
        const clonedWorkspaceBreakdown = cloneWorkspaceBreakdown(rawWb);
        return {
            ...rest,
            ...(forSnapshot ? {
                poolModelIds: [...(s.poolModelIds || [])],
                poolModelLabels: [...(s.poolModelLabels || [])],
                modelCalls: { ...(s.modelCalls || {}) },
            } : {}),
            ...(s.modelStats ? { modelStats: Object.fromEntries(Object.entries(s.modelStats).map(([k, v]) => [k, { ...v }])) } : {}),
            ...(forSnapshot && s.modelTelemetry ? { modelTelemetry: Object.fromEntries(Object.entries(s.modelTelemetry).map(([k, v]) => [k, { ...v }])) } : {}),
            ...(clonedBreakdown ? { surfaceBreakdown: clonedBreakdown } : {}),
            ...(clonedWorkspaceBreakdown ? { workspaceBreakdown: clonedWorkspaceBreakdown } : {}),
            ...(Array.isArray(s.settledCalls) && s.settledCalls.length > 0 ? { settledCalls: s.settledCalls.map(c => ({ ...c })) } : {}),
            ...(Array.isArray(s.recordedCallIds) && s.recordedCallIds.length > 0 ? { recordedCallIds: [...s.recordedCallIds] } : {}),
        };
    }

    static restore(data: DailyLedgerState | undefined | null): DailyLedger {
        const ledger = new DailyLedger();
        if (!data || data.version !== 1) { return ledger; }

        ledger._dateKey = data.dateKey;
        ledger._settled = Array.isArray(data.settled)
            ? data.settled.map(s => {
                const cloned = DailyLedger._cloneSettled(s, false);
                for (const id of cloned.recordedCallIds || []) {
                    ledger._allRecordedIds.add(id);
                    ledger._allRecordedIds.add(canonicalLogicalCallId(id));
                }
                for (const c of cloned.settledCalls || []) {
                    if (c.callId) {
                        ledger._allRecordedIds.add(c.callId);
                        ledger._allRecordedIds.add(canonicalLogicalCallId(c.callId));
                    }
                }
                return cloned;
            })
            : [];

        if (data.accounts && typeof data.accounts === 'object') {
            for (const [email, bucket] of Object.entries(data.accounts)) {
                const restored = ledger._cloneBucket(bucket);
                ledger._accounts.set(email, restored);
                for (const id of restored.recordedCallIds) {
                    ledger._allRecordedIds.add(id);
                    ledger._allRecordedIds.add(canonicalLogicalCallId(id));
                }
            }
        }

        if (data.lateDays && typeof data.lateDays === 'object') {
            for (const [dateKey, acctObj] of Object.entries(data.lateDays)) {
                if (!acctObj || typeof acctObj !== 'object') { continue; }
                const acctMap = new Map<string, LedgerAccountBucket>();
                for (const [email, bucket] of Object.entries(acctObj)) {
                    const restored = ledger._cloneBucket(bucket);
                    acctMap.set(email, restored);
                    for (const id of restored.recordedCallIds) {
                        const canon = canonicalLogicalCallId(id);
                        ledger._allRecordedIds.add(id);
                        ledger._allRecordedIds.add(canon);
                        ledger._lateRecordedIds.add(id);
                        ledger._lateRecordedIds.add(canon);
                    }
                }
                if (acctMap.size > 0) {
                    ledger._lateDays.set(dateKey, acctMap);
                }
            }
        }

        ledger.normalizeIfStaleEmpty();

        return ledger;
    }

    // ─── Internal ────────────────────────────────────────────────────────

    private _cloneBucket(bucket: LedgerAccountBucket): LedgerAccountBucket {
        const { surfaceBreakdown: rawSb, workspaceBreakdown: rawWb, ...rest } = bucket;
        const clonedBreakdown = cloneSurfaceBreakdown(rawSb);
        const clonedWorkspaceBreakdown = cloneWorkspaceBreakdown(rawWb);
        return {
            ...rest,
            modelStats: Object.fromEntries(
                Object.entries(bucket.modelStats && typeof bucket.modelStats === 'object' ? bucket.modelStats : {}).map(([k, v]) => [k, { ...v }]),
            ),
            recordedCallIds: Array.isArray(bucket.recordedCallIds) ? [...bucket.recordedCallIds] : [],
            recordedCalls: Array.isArray(bucket.recordedCalls) ? bucket.recordedCalls.map(c => ({ ...c })) : [],
            ...(clonedBreakdown ? { surfaceBreakdown: clonedBreakdown } : {}),
            ...(clonedWorkspaceBreakdown ? { workspaceBreakdown: clonedWorkspaceBreakdown } : {}),
        };
    }

    private _resetForNewDay(newDateKey: string): void {
        this._dateKey = newDateKey;
        this._accounts.clear();
        this._settled = [];
        this._allRecordedIds.clear();
        for (const id of this._lateRecordedIds) {
            this._allRecordedIds.add(id);
        }
    }
}

// ─── Workspace Attribution Leaderboard & Swarm Cost Compatibility ────────────

export interface WorkspaceLeaderboardCycleLike {
    gmTotalCalls?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    gmTotalTokens?: number;
    gmTotalAllTokens?: number;
    gmTotalCacheRead?: number;
    gmTotalCacheCreation?: number;
    gmTotalThinkingTokens?: number;
    gmTotalCredits?: number;
    estimatedCost?: number;
    surface?: UsageSurface;
    surfaceBreakdown?: Partial<Record<UsageSurface, SurfaceUsageStats>>;
    workspaceBreakdown?: Record<string, WorkspaceUsageStats>;
    gmModelStats?: Record<string, {
        calls: number;
        inputTokens: number;
        outputTokens: number;
        thinkingTokens: number;
        cacheReadTokens?: number;
        cacheCreationTokens?: number;
        credits: number;
        estimatedCost?: number;
    }>;
    lateMergedCalls?: Record<string, {
        callId: string;
        cascadeId?: string;
        workspace?: string;
        authority?: string;
        surface?: UsageSurface;
        inputTokens: number;
        outputTokens: number;
        thinkingTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        estimatedCost: number;
        unpriced?: boolean;
        modelId?: string;
        createdAt?: string;
    }>;
}

export interface WorkspaceLeaderboardRecordLike {
    date: string;
    cycles: readonly WorkspaceLeaderboardCycleLike[];
}

export interface SwarmGroupAttributionSpec {
    rootId: string;
    memberIds?: readonly string[];
}

export interface WorkspaceLeaderboardInput {
    records?: readonly WorkspaceLeaderboardRecordLike[];
    cycles?: readonly WorkspaceLeaderboardCycleLike[];
    ledger?: Pick<DailyLedger, 'getLiveDaySnapshot' | 'getLateDaySnapshots'> | LedgerDayData | null;
    calls?: readonly LedgerRecordedCall[];
    /** Exact surface filter (`'app' | 'ide' | 'cli' | 'unknown' | 'all'`); NEVER proportionally scales legacy aggregates. */
    surfaceFilter?: UsageSurface | 'all';
    /** Sort `__unattributed__` after attributed projects (default `true`). */
    sortUnattributedLast?: boolean;
    /** Optional swarm groups for direct vs inclusive unique-call group cost compatibility. */
    swarmGroups?: readonly SwarmGroupAttributionSpec[];
}

export interface WorkspaceLeaderboardRow {
    workspaceKey: string;
    displayLabel: string;
    isUnattributed: boolean;
    authority?: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    thinkingTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /** Additive total tokens: `inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens` (thinking is a subset of output). */
    totalTokens: number;
    knownCostUsd: number;
    unpricedCalls: number;
    bySurface: Partial<Record<UsageSurface, SurfaceUsageStats>>;
}

export interface WorkspaceLeaderboardResult {
    rows: WorkspaceLeaderboardRow[];
    totals: {
        calls: number;
        inputTokens: number;
        outputTokens: number;
        thinkingTokens: number;
        cacheReadTokens: number;
        cacheCreationTokens: number;
        totalTokens: number;
        knownCostUsd: number;
        unpricedCalls: number;
        bySurface: Partial<Record<UsageSurface, SurfaceUsageStats>>;
    };
    unattributedRow: WorkspaceLeaderboardRow | null;
    /** Deduplicated direct vs inclusive Swarm group cost summaries keyed by `rootId` when `swarmGroups` is provided. */
    swarmGroupCosts?: Record<string, SwarmGroupCostSummary>;
}

/**
 * Convert ledger recorded calls into {@link SwarmCostCallLike} entries compatible with
 * `src/core/swarm-registry.ts`'s `aggregateSwarmGroupCost`, preserving canonical logical
 * call IDs and explicit `costUsd: null` for unpriced calls.
 */
export function convertLedgerCallsToSwarmCostCalls(
    calls: readonly LedgerRecordedCall[],
): SwarmCostCallLike[] {
    const out: SwarmCostCallLike[] = [];
    for (const c of calls) {
        if (!c) { continue; }
        const cid = (c.cascadeId || '').trim()
            || (() => {
                const pipeIdx = (c.callId || '').indexOf('|');
                if (pipeIdx > 0) {
                    return c.callId.slice(0, pipeIdx).replace(/:\d+$/, '').trim();
                }
                return '';
            })();
        if (!cid) { continue; }
        out.push({
            logicalCallId: canonicalLogicalCallId(c.callId),
            cascadeId: cid,
            costUsd: c.unpriced ? null : (Number.isFinite(c.estimatedCost) && c.estimatedCost >= 0 ? c.estimatedCost : null),
            model: c.modelId || c.modelKey,
            createdAt: c.createdAt,
            inputTokens: c.inputTokens,
            outputTokens: c.outputTokens,
            cacheReadTokens: c.cacheReadTokens,
            cacheCreationTokens: c.cacheCreationTokens,
            thinkingTokens: c.thinkingTokens,
        });
    }
    return out;
}

/**
 * Aggregate Swarm direct member costs vs inclusive unique-call group totals directly
 * from a {@link DailyLedger}, {@link LedgerDayData}, or recorded call list.
 */
export function aggregateLedgerSwarmGroupCost(input: {
    rootId: string;
    memberIds?: readonly string[];
    ledger?: Pick<DailyLedger, 'getLiveDaySnapshot' | 'getLateDaySnapshots'> | LedgerDayData | null;
    calls?: readonly LedgerRecordedCall[];
}): SwarmGroupCostSummary {
    const collected: LedgerRecordedCall[] = [];
    if (input.calls) {
        collected.push(...input.calls);
    }
    if (input.ledger) {
        const daySnapshots: LedgerDayData[] = 'getLiveDaySnapshot' in input.ledger
            ? [
                input.ledger.getLiveDaySnapshot(),
                ...(typeof input.ledger.getLateDaySnapshots === 'function' ? input.ledger.getLateDaySnapshots() : []),
            ]
            : [input.ledger];
        for (const day of daySnapshots) {
            for (const b of Object.values(day.accounts || {})) {
                if (Array.isArray(b.recordedCalls)) { collected.push(...b.recordedCalls); }
            }
            for (const s of day.settled || []) {
                if (Array.isArray(s.settledCalls)) { collected.push(...s.settledCalls); }
            }
        }
    }
    return aggregateSwarmGroupCost({
        rootId: input.rootId,
        memberIds: input.memberIds,
        calls: convertLedgerCallsToSwarmCostCalls(collected),
    });
}

function safePos(n: number | undefined): number {
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

function compareCodeUnitAsc(a: string, b: string): number {
    if (a < b) { return -1; }
    if (a > b) { return 1; }
    return 0;
}

/**
 * Pure project attribution leaderboard aggregator over archived records/cycles, live ledgers,
 * and/or call arrays.
 *
 * Guarantees:
 * - Legacy or unattributable historical records map explicitly to `'__unattributed__'`
 *   (`isUnattributed: true`, `displayLabel: 'Unattributed'`) — NEVER proportionally smeared!
 * - Surface filtering uses exact per-surface counts (`bySurface[surf]`), NEVER proportional scaling!
 * - Raw call inputs are deduplicated by canonical logical call ID (`canonicalLogicalCallId`).
 * - Optional `swarmGroups` computes compatible direct vs inclusive unique-call Swarm group costs.
 */
export function aggregateWorkspaceLeaderboard(
    input: WorkspaceLeaderboardInput,
): WorkspaceLeaderboardResult {
    const surfaceFilter = input.surfaceFilter && input.surfaceFilter !== 'all'
        ? normalizeUsageSurface(input.surfaceFilter)
        : null;
    const sortUnattributedLast = input.sortUnattributedLast !== false;

    const acc = new Map<string, WorkspaceUsageStats>();
    const swarmCallsPool: LedgerRecordedCall[] = [];
    const seenLogicalCallIds = new Set<string>();

    const ensureAcc = (wsKey: string, authority?: string): WorkspaceUsageStats => {
        const key = wsKey || UNATTRIBUTED_WORKSPACE_KEY;
        let entry = acc.get(key);
        if (!entry) {
            entry = emptyWorkspaceStats(authority);
            acc.set(key, entry);
        } else if (!entry.authority && authority) {
            entry.authority = authority;
        }
        return entry;
    };

    const ingestWorkspaceBreakdown = (
        breakdown: Record<string, WorkspaceUsageStats>,
    ): void => {
        for (const [rawKey, rawStats] of Object.entries(breakdown)) {
            if (!rawStats || !hasWorkspaceStatsData(rawStats)) { continue; }
            const wsKey = rawKey === UNATTRIBUTED_WORKSPACE_KEY
                ? UNATTRIBUTED_WORKSPACE_KEY
                : normalizeWorkspaceKey(rawKey, undefined);

            if (surfaceFilter) {
                const surfStats = rawStats.bySurface?.[surfaceFilter];
                if (!surfStats || !hasSurfaceStatsData(surfStats)) { continue; }
                const target = ensureAcc(wsKey, rawStats.authority);
                const totalWsCalls = safePos(rawStats.calls);
                // Preserve unpricedCalls only when unambiguously single-surface; never fabricate fractional splits.
                const exactUnpriced = (totalWsCalls > 0 && surfStats.calls === totalWsCalls)
                    ? safePos(rawStats.unpricedCalls)
                    : 0;
                addWorkspaceStats(target, {
                    calls: safePos(surfStats.calls),
                    inputTokens: safePos(surfStats.inputTokens),
                    outputTokens: safePos(surfStats.outputTokens),
                    thinkingTokens: safePos(surfStats.thinkingTokens),
                    cacheReadTokens: safePos(surfStats.cacheReadTokens),
                    cacheCreationTokens: safePos(surfStats.cacheCreationTokens),
                    credits: safePos(surfStats.credits),
                    knownCostUsd: safePos(surfStats.estimatedCost),
                    unpricedCalls: exactUnpriced,
                    authority: rawStats.authority,
                    bySurface: { [surfaceFilter]: { ...surfStats } },
                });
            } else {
                const target = ensureAcc(wsKey, rawStats.authority);
                addWorkspaceStats(target, rawStats);
            }
        }
    };

    const ingestRecordedCalls = (
        calls: readonly LedgerRecordedCall[],
        fallbackSurface: UsageSurface = 'unknown',
    ): void => {
        for (const c of calls) {
            if (!c) { continue; }
            const canonId = c.callId ? canonicalLogicalCallId(c.callId) : '';
            if (canonId) {
                if (seenLogicalCallIds.has(canonId)) { continue; }
                seenLogicalCallIds.add(canonId);
            }
            const surf = normalizeUsageSurface(c.surface ?? fallbackSurface);
            if (surfaceFilter && surf !== surfaceFilter) { continue; }
            const wsKey = normalizeWorkspaceKey(c.workspace, c.authority);
            const target = ensureAcc(wsKey, c.authority);
            const knownCost = c.unpriced ? 0 : safePos(c.estimatedCost);
            addWorkspaceStats(target, {
                calls: 1,
                inputTokens: safePos(c.inputTokens),
                outputTokens: safePos(c.outputTokens),
                thinkingTokens: safePos(c.thinkingTokens),
                cacheReadTokens: safePos(c.cacheReadTokens),
                cacheCreationTokens: safePos(c.cacheCreationTokens),
                credits: safePos(c.credits),
                knownCostUsd: knownCost,
                unpricedCalls: c.unpriced ? 1 : 0,
                authority: c.authority,
                bySurface: {
                    [surf]: {
                        calls: 1,
                        inputTokens: safePos(c.inputTokens),
                        outputTokens: safePos(c.outputTokens),
                        thinkingTokens: safePos(c.thinkingTokens),
                        cacheReadTokens: safePos(c.cacheReadTokens),
                        cacheCreationTokens: safePos(c.cacheCreationTokens),
                        credits: safePos(c.credits),
                        estimatedCost: knownCost,
                    },
                },
            });
            swarmCallsPool.push(c);
        }
    };

    const ingestCycle = (cycle: WorkspaceLeaderboardCycleLike): void => {
        if (!cycle) { return; }
        if (cycle.lateMergedCalls) {
            for (const lc of Object.values(cycle.lateMergedCalls)) {
                if (!lc || !lc.callId) { continue; }
                const lcSurf = normalizeUsageSurface(lc.surface ?? cycle.surface);
                if (surfaceFilter && lcSurf !== surfaceFilter) { continue; }
                swarmCallsPool.push({
                    callId: lc.callId,
                    createdAt: lc.createdAt || '',
                    createdAtMs: 0,
                    modelId: lc.modelId || '',
                    modelKey: lc.modelId || '',
                    inputTokens: safePos(lc.inputTokens),
                    outputTokens: safePos(lc.outputTokens),
                    thinkingTokens: safePos(lc.thinkingTokens),
                    cacheReadTokens: safePos(lc.cacheReadTokens),
                    cacheCreationTokens: safePos(lc.cacheCreationTokens),
                    credits: 0,
                    estimatedCost: safePos(lc.estimatedCost),
                    ...(lc.surface ? { surface: lc.surface } : {}),
                    ...(lc.cascadeId ? { cascadeId: lc.cascadeId } : {}),
                    ...(lc.workspace ? { workspace: lc.workspace } : {}),
                    ...(lc.authority ? { authority: lc.authority } : {}),
                    ...(lc.unpriced ? { unpriced: true } : {}),
                });
            }
        }
        if (cycle.workspaceBreakdown && Object.keys(cycle.workspaceBreakdown).length > 0) {
            ingestWorkspaceBreakdown(cycle.workspaceBreakdown);
            return;
        }
        // Legacy unattributed cycle -> map explicitly to UNATTRIBUTED_WORKSPACE_KEY (NEVER smear!)
        const gmCalls = safePos(cycle.gmTotalCalls);
        let inputTokens = 0;
        let outputTokens = 0;
        let thinkingTokens = 0;
        let cacheReadTokens = 0;
        let cacheCreationTokens = 0;
        let credits = safePos(cycle.gmTotalCredits);
        let knownCostUsd = safePos(cycle.estimatedCost);
        let unpricedCalls = 0;

        if (cycle.gmModelStats && Object.keys(cycle.gmModelStats).length > 0) {
            for (const gms of Object.values(cycle.gmModelStats)) {
                inputTokens += safePos(gms.inputTokens);
                outputTokens += safePos(gms.outputTokens);
                thinkingTokens += safePos(gms.thinkingTokens);
                cacheReadTokens += safePos(gms.cacheReadTokens);
                cacheCreationTokens += safePos(gms.cacheCreationTokens);
                if (gms.estimatedCost === undefined && gms.calls > 0 && knownCostUsd === 0) {
                    unpricedCalls += safePos(gms.calls);
                }
            }
        } else {
            inputTokens = safePos(cycle.totalInputTokens);
            outputTokens = safePos(cycle.totalOutputTokens);
            thinkingTokens = safePos(cycle.gmTotalThinkingTokens);
            cacheReadTokens = safePos(cycle.gmTotalCacheRead);
            cacheCreationTokens = safePos(cycle.gmTotalCacheCreation);
        }

        if (gmCalls <= 0 && inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0 && knownCostUsd <= 0) {
            return;
        }

        const clonedSurfaces = cloneSurfaceBreakdown(cycle.surfaceBreakdown);
        if (surfaceFilter) {
            if (clonedSurfaces) {
                const match = clonedSurfaces[surfaceFilter];
                if (!match || !hasSurfaceStatsData(match)) { return; }
                const target = ensureAcc(UNATTRIBUTED_WORKSPACE_KEY);
                addWorkspaceStats(target, {
                    calls: safePos(match.calls),
                    inputTokens: safePos(match.inputTokens),
                    outputTokens: safePos(match.outputTokens),
                    thinkingTokens: safePos(match.thinkingTokens),
                    cacheReadTokens: safePos(match.cacheReadTokens),
                    cacheCreationTokens: safePos(match.cacheCreationTokens),
                    credits: safePos(match.credits),
                    knownCostUsd: safePos(match.estimatedCost),
                    unpricedCalls: 0,
                    bySurface: { [surfaceFilter]: { ...match } },
                });
                return;
            }
            const cycleSurf = normalizeUsageSurface(cycle.surface);
            if (cycleSurf !== surfaceFilter) { return; }
        }

        const fallbackSurf = normalizeUsageSurface(cycle.surface);
        const bySurface: Partial<Record<UsageSurface, SurfaceUsageStats>> = clonedSurfaces ?? {
            [fallbackSurf]: {
                calls: gmCalls,
                inputTokens,
                outputTokens,
                thinkingTokens,
                cacheReadTokens,
                cacheCreationTokens,
                credits,
                estimatedCost: knownCostUsd,
            },
        };

        const target = ensureAcc(UNATTRIBUTED_WORKSPACE_KEY);
        addWorkspaceStats(target, {
            calls: gmCalls,
            inputTokens,
            outputTokens,
            thinkingTokens,
            cacheReadTokens,
            cacheCreationTokens,
            credits,
            knownCostUsd,
            unpricedCalls,
            bySurface,
        });
    };

    if (input.records) {
        for (const rec of input.records) {
            if (!rec || !Array.isArray(rec.cycles)) { continue; }
            for (const c of rec.cycles) {
                ingestCycle(c);
            }
        }
    }
    if (input.cycles) {
        for (const c of input.cycles) {
            ingestCycle(c);
        }
    }
    if (input.ledger) {
        const daySnapshots: LedgerDayData[] = 'getLiveDaySnapshot' in input.ledger
            ? [
                input.ledger.getLiveDaySnapshot(),
                ...(typeof input.ledger.getLateDaySnapshots === 'function' ? input.ledger.getLateDaySnapshots() : []),
            ]
            : [input.ledger];
        const ingestLegacyItem = (
            item: Pick<LedgerAccountBucket, 'totalCalls' | 'totalInputTokens' | 'totalOutputTokens' | 'totalThinkingTokens' | 'totalCacheRead' | 'totalCacheCreation' | 'totalCredits' | 'totalEstimatedCost' | 'surface' | 'surfaceBreakdown'>,
        ): void => {
            const surf = normalizeUsageSurface(item.surface);
            if (surfaceFilter && surf !== surfaceFilter && !item.surfaceBreakdown?.[surfaceFilter]) { return; }
            const snap: SurfaceUsageStats = {
                calls: item.totalCalls, inputTokens: item.totalInputTokens, outputTokens: item.totalOutputTokens,
                thinkingTokens: item.totalThinkingTokens || 0, cacheReadTokens: item.totalCacheRead,
                cacheCreationTokens: item.totalCacheCreation || 0, credits: item.totalCredits, estimatedCost: item.totalEstimatedCost,
            };
            ingestWorkspaceBreakdown({
                [UNATTRIBUTED_WORKSPACE_KEY]: {
                    calls: snap.calls, inputTokens: snap.inputTokens, outputTokens: snap.outputTokens,
                    thinkingTokens: snap.thinkingTokens, cacheReadTokens: snap.cacheReadTokens,
                    cacheCreationTokens: snap.cacheCreationTokens, credits: snap.credits,
                    knownCostUsd: snap.estimatedCost, unpricedCalls: 0,
                    bySurface: cloneSurfaceBreakdown(item.surfaceBreakdown) ?? { [surf]: snap },
                },
            });
        };
        for (const day of daySnapshots) {
            for (const bucket of Object.values(day.accounts || {})) {
                if (Array.isArray(bucket.recordedCalls) && bucket.recordedCalls.length > 0) {
                    ingestRecordedCalls(bucket.recordedCalls, normalizeUsageSurface(bucket.surface));
                } else if (bucket.workspaceBreakdown && Object.keys(bucket.workspaceBreakdown).length > 0) {
                    ingestWorkspaceBreakdown(bucket.workspaceBreakdown);
                } else if (bucket.totalCalls > 0) {
                    ingestLegacyItem(bucket);
                }
            }
            for (const settled of day.settled || []) {
                if (Array.isArray(settled.settledCalls) && settled.settledCalls.length > 0) {
                    ingestRecordedCalls(settled.settledCalls, normalizeUsageSurface(settled.surface));
                } else if (settled.workspaceBreakdown && Object.keys(settled.workspaceBreakdown).length > 0) {
                    ingestWorkspaceBreakdown(settled.workspaceBreakdown);
                } else if (settled.totalCalls > 0) {
                    ingestLegacyItem(settled);
                }
            }
        }
    }
    if (input.calls && input.calls.length > 0) {
        ingestRecordedCalls(input.calls);
    }

    const rows: WorkspaceLeaderboardRow[] = [];
    const totalBySurface: Partial<Record<UsageSurface, SurfaceUsageStats>> = {};
    const totals = {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        knownCostUsd: 0,
        unpricedCalls: 0,
        bySurface: totalBySurface,
    };

    for (const [wsKey, stats] of acc.entries()) {
        if (!hasWorkspaceStatsData(stats)) { continue; }
        const isUnattributed = wsKey === UNATTRIBUTED_WORKSPACE_KEY;
        const totalTokens = stats.inputTokens + stats.cacheReadTokens + stats.cacheCreationTokens + stats.outputTokens;
        const bySurface = cloneSurfaceBreakdown(stats.bySurface) ?? {};
        const row: WorkspaceLeaderboardRow = {
            workspaceKey: wsKey,
            displayLabel: deriveWorkspaceDisplayLabel(wsKey),
            isUnattributed,
            ...(stats.authority ? { authority: stats.authority } : {}),
            calls: stats.calls,
            inputTokens: stats.inputTokens,
            outputTokens: stats.outputTokens,
            thinkingTokens: stats.thinkingTokens,
            cacheReadTokens: stats.cacheReadTokens,
            cacheCreationTokens: stats.cacheCreationTokens,
            totalTokens,
            knownCostUsd: stats.knownCostUsd,
            unpricedCalls: stats.unpricedCalls,
            bySurface,
        };
        rows.push(row);

        totals.calls += row.calls;
        totals.inputTokens += row.inputTokens;
        totals.outputTokens += row.outputTokens;
        totals.thinkingTokens += row.thinkingTokens;
        totals.cacheReadTokens += row.cacheReadTokens;
        totals.cacheCreationTokens += row.cacheCreationTokens;
        totals.totalTokens += row.totalTokens;
        totals.knownCostUsd += row.knownCostUsd;
        totals.unpricedCalls += row.unpricedCalls;
        for (const [sk, sv] of Object.entries(bySurface)) {
            if (!sv || !hasSurfaceStatsData(sv)) { continue; }
            const surf = normalizeUsageSurface(sk);
            const cur = totalBySurface[surf] || emptySurfaceStats();
            addSurfaceStats(cur, sv);
            totalBySurface[surf] = cur;
        }
    }

    rows.sort((a, b) => {
        if (sortUnattributedLast && a.isUnattributed !== b.isUnattributed) {
            return a.isUnattributed ? 1 : -1;
        }
        if (b.knownCostUsd !== a.knownCostUsd) { return b.knownCostUsd - a.knownCostUsd; }
        if (b.totalTokens !== a.totalTokens) { return b.totalTokens - a.totalTokens; }
        if (b.calls !== a.calls) { return b.calls - a.calls; }
        return compareCodeUnitAsc(a.workspaceKey, b.workspaceKey);
    });

    const unattributedRow = rows.find(r => r.isUnattributed) ?? null;

    let swarmGroupCosts: Record<string, SwarmGroupCostSummary> | undefined;
    if (input.swarmGroups && input.swarmGroups.length > 0) {
        swarmGroupCosts = {};
        const swarmCostCalls = convertLedgerCallsToSwarmCostCalls(swarmCallsPool);
        for (const group of input.swarmGroups) {
            const rootId = (group.rootId || '').trim();
            if (!rootId) { continue; }
            swarmGroupCosts[rootId] = aggregateSwarmGroupCost({
                rootId,
                memberIds: group.memberIds,
                calls: swarmCostCalls,
            });
        }
    }

    return {
        rows,
        totals,
        unattributedRow,
        ...(swarmGroupCosts ? { swarmGroupCosts } : {}),
    };
}

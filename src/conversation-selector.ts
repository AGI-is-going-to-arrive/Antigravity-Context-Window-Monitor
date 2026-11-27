// ─── Pure Conversation Selector & Subagent / Main-Agent Lock Engine ──────────
// Resolves the target conversation across IDE and Antigravity App Sidecar surfaces
// with 3 modes: manual pin, Lock to Main Agent (subagent-burst resistant), and
// auto-follow (host conversationId or active workspace trajectory).
//
// Zero VS Code, DOM, or external npm dependencies.

import { CascadeStatus } from './constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TrajectoryMetadataLike {
    trajectoryType?: string;
    parentCascadeId?: string;
    parentTrajectoryId?: string;
    parentConversationId?: string;
    isSubagent?: boolean;
    isChild?: boolean;
    role?: string;
    agentRole?: string;
    agentType?: string;
    kind?: string;
    source?: string;
    spawnedBy?: string;
    swarmId?: string;
    [key: string]: unknown;
}

/**
 * Structural trajectory summary compatible with both `src/tracker.ts`
 * (`TrajectorySummary`) and raw `GetAllCascadeTrajectories` responses.
 */
export interface ConversationTrajectoryLike {
    cascadeId: string;
    trajectoryId?: string;
    summary?: string;
    title?: string;
    stepCount?: number;
    status?: string;
    lastModifiedTime?: string;
    createdTime?: string;
    lastUserInputTime?: string;
    lastUserInputStepIndex?: number;
    requestedModel?: string;
    generatorModel?: string;
    workspaceUris?: readonly string[];
    workspaces?: ReadonlyArray<{ workspaceFolderAbsoluteUri?: string; [key: string]: unknown }>;
    repositoryName?: string;
    branchName?: string;
    gitRootUri?: string;
    trajectoryType?: string;
    parentCascadeId?: string;
    parentTrajectoryId?: string;
    parentConversationId?: string;
    isSubagent?: boolean;
    role?: string;
    agentRole?: string;
    agentType?: string;
    spawnedBy?: string;
    swarmId?: string;
    killed?: boolean;
    trajectoryMetadata?: TrajectoryMetadataLike | Record<string, unknown>;
}

export type ConversationSelectionMode = 'pinned' | 'locked_main' | 'auto_follow';

export interface ResolveTargetConversationInput {
    trajectories: ReadonlyArray<ConversationTrajectoryLike>;
    /** Manually pinned conversation cascadeId (highest priority while present). */
    pinnedId?: string | null;
    /** When true, ignore subagent trajectories and stay locked on the active/most-recent main trajectory. */
    lockToMainAgent?: boolean;
    /** Previously locked main-agent cascadeId. */
    lockedMainId?: string | null;
    /** Active conversation reported by host (e.g. `window.sidecar.conversationId`). */
    hostConversationId?: string | null;
    /** Currently active/tracked cascadeId for continuity when multiple tasks run. */
    currentActiveId?: string | null;
    /** Optional epoch ms when `currentActiveId` became active (anchors 0-step new chats lacking createdTime). */
    currentActiveSinceMs?: number;
    /** Current workspace folder URIs/paths used to prefer in-workspace trajectories. */
    workspaceUris?: ReadonlyArray<string>;
    /** Optional set of explicitly linked child/subagent cascadeIds (e.g. from invokeSubagent). */
    knownSubagentIds?: ReadonlySet<string>;
    /** Optional set of cascadeIds newly observed on the current poll cycle. */
    newlyCreatedIds?: ReadonlySet<string>;
    /** Optional set of cascadeIds previously seen and now removed (deleted), preventing pending hold on deleted chats. */
    deletedConversationIds?: ReadonlySet<string>;
    /** When true (default), an unseen non-deleted hostConversationId stays pending at 0% instead of falling back to another session. */
    hostConversationPendingAllowed?: boolean;
    /** True when the host explicitly reports the user opened a blank New Conversation screen (no cascadeId yet). */
    hostNewConversationPending?: boolean;
    /** Platform override for workspace URI normalization (defaults to `process.platform`). */
    platform?: NodeJS.Platform;
}

export interface ResolvedConversationTarget {
    target: ConversationTrajectoryLike | null;
    cascadeId: string | null;
    mode: ConversationSelectionMode;
    /** Recommended main-agent cascadeId to persist for Lock to Main Agent continuity. */
    lockedMainId: string | null;
    /** True when `pinnedId` was provided but not found in `trajectories` (clean fallback occurred). */
    pinnedFallback: boolean;
    /** True when a subagent burst (running subagent or subagent hostId) was ignored due to Lock to Main Agent. */
    ignoredSubagentBurst: boolean;
    /** True when the host's focused brand-new conversation is not yet present in `trajectories` (render 0% awaiting generation instead of falling back to another session). */
    hostPending?: boolean;
    reason: string;
}

export interface ConversationOption {
    cascadeId: string;
    title: string;
    isUntitled: boolean;
    isSubagent: boolean;
    isActive: boolean;
    isLockedMain: boolean;
    isRunning: boolean;
    matchesWorkspace: boolean;
    stepCount: number;
    lastModifiedTime: string;
    model: string;
    workspaceLabel: string;
    branchName: string;
}

export interface BuildConversationOptionsConfig {
    workspaceUris?: ReadonlyArray<string>;
    knownSubagentIds?: ReadonlySet<string>;
    platform?: NodeJS.Platform;
    /** Optional language for untitled fallback label (`'en' | 'zh' | 'both'`). Defaults to `'en'`. */
    lang?: 'en' | 'zh' | 'both';
    /** If true, omit subagent trajectories from the returned options list. Defaults to `false`. */
    excludeSubagents?: boolean;
    /** If true and `workspaceUris` is non-empty, place workspace-matching conversations first. Defaults to `true`. */
    prioritizeWorkspace?: boolean;
}

// ─── Cross-Platform Workspace URI Normalization ──────────────────────────────

function isWindowsDrivePath(value: string): boolean {
    return /^[a-zA-Z]:[/\\]/.test(value) || /^\/[a-zA-Z]:[/\\]/.test(value);
}

function isWindowsUncPath(value: string): boolean {
    return /^\\\\[^\\]/.test(value) || /^\/\/[^/]/.test(value);
}

/**
 * Normalize a workspace URI or filesystem path for reliable cross-platform comparison
 * across Windows, macOS, Linux, and VS Code Remote (WSL / SSH).
 */
export function normalizeWorkspaceUri(
    uri: string,
    platform: NodeJS.Platform = process.platform,
): string {
    if (typeof uri !== 'string') { return ''; }
    let normalized = uri.trim();
    if (!normalized) { return ''; }

    // Strip vscode-remote://<authority>/... preserving the remote POSIX path
    const remoteMatch = normalized.match(/^vscode-remote:\/\/[^/]+(\/.*)/i);
    if (remoteMatch) {
        normalized = remoteMatch[1];
    }

    // Handle file:// URLs (including Windows UNC file://server/share and file://localhost/...)
    if (/^file:\/\//i.test(normalized)) {
        if (/^file:\/\/localhost\//i.test(normalized)) {
            normalized = normalized.replace(/^file:\/\/localhost\//i, '/');
        } else if (/^file:\/\/\//i.test(normalized)) {
            normalized = normalized.replace(/^file:\/\/\//i, '/');
        } else {
            // file://server/share -> //server/share
            normalized = '//' + normalized.replace(/^file:\/\//i, '');
        }
    }

    // Safe URL decoding (handles %20 spaces and %3A Windows drive colons)
    try {
        normalized = decodeURIComponent(normalized);
    } catch {
        // Leave malformed percent sequences untouched
    }

    const windowsLike = platform === 'win32'
        || isWindowsDrivePath(normalized)
        || isWindowsUncPath(normalized);

    if (windowsLike) {
        normalized = normalized.replace(/\\/g, '/');
        // Strip leading slash before Windows drive letter: /C:/Users -> C:/Users
        normalized = normalized.replace(/^\/([a-zA-Z]:)/, '$1');
    }

    // Collapse repeated internal slashes (preserving leading // for UNC paths)
    if (normalized.startsWith('//')) {
        normalized = '//' + normalized.slice(2).replace(/\/{2,}/g, '/');
    } else {
        normalized = normalized.replace(/\/{2,}/g, '/');
    }

    // Strip trailing slashes while preserving root '/' or 'C:/'
    if (normalized.length > 1 && !/^[a-zA-Z]:\/$/.test(normalized)) {
        normalized = normalized.replace(/\/+$/, '');
    }
    // Canonicalize bare Windows drive 'C:' -> 'C:/'
    if (/^[a-zA-Z]:$/.test(normalized)) {
        normalized = `${normalized}/`;
    }

    // Case-fold on case-insensitive OSes or Windows drive/UNC paths; preserve case on Linux POSIX
    if (windowsLike || platform === 'darwin') {
        normalized = normalized.toLowerCase();
    }

    return normalized;
}

function extractTrajectoryWorkspaceUris(summary: ConversationTrajectoryLike): string[] {
    const out: string[] = [];
    if (Array.isArray(summary.workspaceUris)) {
        for (const uri of summary.workspaceUris) {
            if (typeof uri === 'string' && uri.trim()) {
                out.push(uri);
            }
        }
    }
    if (Array.isArray(summary.workspaces)) {
        for (const ws of summary.workspaces) {
            const uri = ws?.workspaceFolderAbsoluteUri;
            if (typeof uri === 'string' && uri.trim()) {
                out.push(uri);
            }
        }
    }
    return out;
}

function buildNormalizedWorkspaceSet(
    uris: ReadonlyArray<string> | undefined,
    platform: NodeJS.Platform,
): Set<string> {
    const set = new Set<string>();
    if (!uris) { return set; }
    for (const uri of uris) {
        const norm = normalizeWorkspaceUri(uri, platform);
        if (norm) { set.add(norm); }
    }
    return set;
}

function trajectoryMatchesWorkspaceSet(
    summary: ConversationTrajectoryLike,
    targetSet: ReadonlySet<string>,
    platform: NodeJS.Platform,
): boolean {
    if (targetSet.size === 0) { return false; }
    const uris = extractTrajectoryWorkspaceUris(summary);
    for (const uri of uris) {
        const norm = normalizeWorkspaceUri(uri, platform);
        if (norm && targetSet.has(norm)) {
            return true;
        }
    }
    return false;
}

function extractWorkspaceBasename(summary: ConversationTrajectoryLike): string {
    const uris = extractTrajectoryWorkspaceUris(summary);
    if (uris.length === 0) {
        return (summary.repositoryName || '').trim();
    }
    const raw = uris[0].replace(/\\/g, '/').replace(/\/+$/, '');
    let decoded = raw;
    try {
        decoded = decodeURIComponent(raw);
    } catch {
        // Keep raw
    }
    const parts = decoded.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : '';
}

// ─── Subagent Trajectory Detection ───────────────────────────────────────────

const SUBAGENT_TYPE_PATTERN = /(?:SUBAGENT|SUB_AGENT|CHILD|SWARM_WORKER|WORKER|DELEGATED|BACKGROUND_AGENT|HELPER)/i;
const SUBAGENT_ROLE_PATTERN = /^(?:subagent|sub-agent|sub_agent|swarm[-_]?worker|worker|child[-_]?agent|helper|delegated(?:[-_]?agent)?)$/i;
const SUBAGENT_TITLE_PREFIX_PATTERNS: readonly RegExp[] = [
    /^\[(?:subagent|sub-agent|swarm|swarm-worker|worker|delegated|helper)(?:\s*[:#/-][^\]]*)?\]\s*/i,
    /^(?:subagent|sub-agent|swarm\s+worker|delegated\s+agent)\s*[:—-]\s+/i,
    /^swarm-[a-z0-9][a-z0-9_-]*-[0-9a-f]{4,}$/i,
];
const SWARM_WORKTREE_PATH_PATTERN = /(?:^|\/)\.gemini\/antigravity\/worktrees\/[^/]+\/swarm-[a-z0-9][a-z0-9_-]*-[0-9a-f]{4,}(?:\/|$)/i;
const SWARM_BRANCH_PATTERN = /^swarm-[a-z0-9][a-z0-9_-]*-[0-9a-f]{6,}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function nonEmptyString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function matchesSwarmWorktreePath(rawUri: string): boolean {
    if (!rawUri) { return false; }
    let normalized = rawUri.trim();
    try {
        normalized = decodeURIComponent(normalized);
    } catch {
        // Keep raw if malformed percent encoding
    }
    normalized = normalized.replace(/\\/g, '/');
    return SWARM_WORKTREE_PATH_PATTERN.test(normalized);
}

/**
 * Detect whether a trajectory belongs to a subagent / swarm worker / child agent.
 *
 * Uses authoritative structural metadata first (`isSubagent`, `parentCascadeId`,
 * `trajectoryType`, `trajectoryMetadata`, `knownSubagentIds`), Antigravity Swarm
 * worktree paths/branches (`.gemini/antigravity/worktrees/<id>/swarm-...`), plus
 * strictly anchored system title prefixes so normal user chats mentioning
 * "subagent" or "swarm" in their topic NEVER produce false positives.
 */
export function isSubagentTrajectory(
    summary: ConversationTrajectoryLike | null | undefined,
    knownSubagentIds?: ReadonlySet<string>,
): boolean {
    if (!summary || typeof summary !== 'object') { return false; }

    const cascadeId = nonEmptyString(summary.cascadeId);
    if (cascadeId && knownSubagentIds?.has(cascadeId)) {
        return true;
    }

    if (summary.isSubagent === true) {
        return true;
    }

    const meta = asRecord(summary.trajectoryMetadata);
    if (meta) {
        if (meta.isSubagent === true || meta.isChild === true) {
            return true;
        }
    }

    // Parent linkage (must be non-empty and distinct from self)
    const parentIds = [
        nonEmptyString(summary.parentCascadeId),
        nonEmptyString(summary.parentTrajectoryId),
        nonEmptyString(summary.parentConversationId),
        nonEmptyString(meta?.parentCascadeId),
        nonEmptyString(meta?.parentTrajectoryId),
        nonEmptyString(meta?.parentConversationId),
    ].filter(Boolean);
    for (const parentId of parentIds) {
        if (parentId !== cascadeId && parentId !== nonEmptyString(summary.trajectoryId)) {
            return true;
        }
    }

    // Trajectory type enum
    const trajectoryTypes = [
        nonEmptyString(summary.trajectoryType),
        nonEmptyString(meta?.trajectoryType),
    ].filter(Boolean);
    for (const t of trajectoryTypes) {
        if (SUBAGENT_TYPE_PATTERN.test(t)) {
            return true;
        }
    }

    // Explicit role / spawnedBy metadata
    const roles = [
        nonEmptyString(summary.role),
        nonEmptyString(summary.agentRole),
        nonEmptyString(summary.agentType),
        nonEmptyString(meta?.role),
        nonEmptyString(meta?.agentRole),
        nonEmptyString(meta?.agentType),
        nonEmptyString(meta?.kind),
    ].filter(Boolean);
    for (const role of roles) {
        if (SUBAGENT_ROLE_PATTERN.test(role)) {
            return true;
        }
    }

    const spawnedBy = nonEmptyString(summary.spawnedBy) || nonEmptyString(meta?.spawnedBy);
    if (spawnedBy) {
        return true;
    }

    // Swarm worker metadata: has swarmId with a non-coordinator/non-main role
    const swarmId = nonEmptyString(summary.swarmId) || nonEmptyString(meta?.swarmId);
    const effectiveRole = roles[0]?.toLowerCase() || '';
    const isExplicitMainOrCoordinator = effectiveRole === 'coordinator' || effectiveRole === 'main' || effectiveRole === 'user';
    if (swarmId) {
        if (effectiveRole && !isExplicitMainOrCoordinator) {
            return true;
        }
    }

    // Antigravity-managed Swarm worker worktrees & worker branches (unless explicitly marked coordinator/main)
    if (!isExplicitMainOrCoordinator) {
        const wsUris = extractTrajectoryWorkspaceUris(summary);
        const gitRoot = nonEmptyString(summary.gitRootUri);
        if (gitRoot) { wsUris.push(gitRoot); }
        if (wsUris.some(matchesSwarmWorktreePath)) {
            return true;
        }
        const branchName = nonEmptyString(summary.branchName);
        if (branchName && SWARM_BRANCH_PATTERN.test(branchName)) {
            return true;
        }
    }

    // Strictly anchored system title prefixes (never match mid-sentence user chat titles)
    const rawTitle = nonEmptyString(summary.summary) || nonEmptyString(summary.title);
    if (rawTitle && rawTitle !== cascadeId) {
        if (SUBAGENT_TITLE_PREFIX_PATTERNS.some(re => re.test(rawTitle))) {
            return true;
        }
    }

    return false;
}

// ─── Ordering & Status Helpers ───────────────────────────────────────────────

function isRunningTrajectory(summary: ConversationTrajectoryLike): boolean {
    if (summary.killed === true) { return false; }
    const status = nonEmptyString(summary.status).toUpperCase();
    if (!status) { return false; }
    if (status === CascadeStatus.RUNNING || status === 'RUNNING') { return true; }
    return status.includes('RUNNING') && !status.includes('NOT_RUNNING');
}

function parseTimestampMs(raw: unknown): number {
    const clean = nonEmptyString(raw);
    if (!clean) { return 0; }
    const ms = Date.parse(clean);
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function getTimestampScore(summary: ConversationTrajectoryLike): number {
    return parseTimestampMs(summary.lastModifiedTime) || parseTimestampMs(summary.createdTime);
}

function getCreatedTimestampScore(summary: ConversationTrajectoryLike): number {
    return parseTimestampMs(summary.createdTime);
}

/**
 * Timestamp of the most recent explicit human user activity in this conversation:
 * `lastUserInputTime` when present, or `createdTime` for brand-new 0-step conversations.
 * Background checkpoints, title summaries, and async tool finishes update `lastModifiedTime`
 * without advancing `lastUserInputTime`.
 */
function getUserActivityScore(summary: ConversationTrajectoryLike): number {
    const userInputMs = parseTimestampMs(summary.lastUserInputTime);
    const createdMs = parseTimestampMs(summary.createdTime);
    if (userInputMs > 0) {
        return (summary.stepCount || 0) === 0 ? Math.max(userInputMs, createdMs) : userInputMs;
    }
    return (summary.stepCount || 0) === 0 ? createdMs : 0;
}

function compareRecencyDesc(a: ConversationTrajectoryLike, b: ConversationTrajectoryLike): number {
    const timeDiff = getTimestampScore(b) - getTimestampScore(a);
    if (timeDiff !== 0) { return timeDiff; }
    const createdDiff = getCreatedTimestampScore(b) - getCreatedTimestampScore(a);
    if (createdDiff !== 0) { return createdDiff; }
    const rawA = nonEmptyString(a.lastModifiedTime) || nonEmptyString(a.createdTime);
    const rawB = nonEmptyString(b.lastModifiedTime) || nonEmptyString(b.createdTime);
    if (rawA !== rawB) {
        if (!rawA) { return 1; }
        if (!rawB) { return -1; }
        return rawB.localeCompare(rawA);
    }
    const stepsDiff = (b.stepCount || 0) - (a.stepCount || 0);
    if (stepsDiff !== 0) { return stepsDiff; }
    return a.cascadeId.localeCompare(b.cascadeId);
}

/**
 * Determine whether a background `RUNNING` candidate should preempt the user's
 * currently tracked `IDLE` conversation (e.g. a brand-new 0-step chat or a chat at 9%
 * waiting for the next prompt).
 *
 * Prevents older background sessions (e.g. a 54% session finishing an async tool/summary)
 * from hijacking a newer user conversation, while immediately allowing genuine switches
 * when the user submits a prompt in another conversation (`lastUserInputTime` advances).
 */
function shouldRunningCandidatePreemptActive(
    candidate: ConversationTrajectoryLike,
    active: ConversationTrajectoryLike,
    workspaceSet: ReadonlySet<string>,
    platform: NodeJS.Platform,
    currentActiveSinceMs = 0,
): boolean {
    if (candidate.cascadeId === active.cascadeId) { return true; }

    const candUserMs = getUserActivityScore(candidate);
    const activeUserMs = getUserActivityScore(active);
    const activeSinceAnchor = (active.stepCount || 0) === 0 && currentActiveSinceMs > 0
        ? currentActiveSinceMs
        : 0;
    const effectiveActiveUserMs = Math.max(activeUserMs, activeSinceAnchor);

    if (candUserMs > 0 && effectiveActiveUserMs > 0) {
        if (candUserMs < effectiveActiveUserMs) {
            return false;
        }
        if (candUserMs > effectiveActiveUserMs) {
            return true;
        }
        const candCreated = getCreatedTimestampScore(candidate);
        const activeCreated = Math.max(getCreatedTimestampScore(active), activeSinceAnchor);
        if (candCreated > 0 && activeCreated > 0 && candCreated < activeCreated) {
            return false;
        }
    } else if ((active.stepCount || 0) === 0) {
        // Active is a brand-new 0-step conversation awaiting its first generation:
        // never let an older conversation preempt it.
        const activeCreated = Math.max(getCreatedTimestampScore(active), activeSinceAnchor);
        const candCreated = getCreatedTimestampScore(candidate);
        if (activeCreated > 0) {
            if (candUserMs > 0 && candUserMs < activeCreated) {
                return false;
            }
            if (candCreated > 0 && candCreated < activeCreated) {
                return false;
            }
        }
    }

    // If active belongs to the current workspace, don't let a background RUNNING task
    // from a different explicit workspace hijack it unless user activity is strictly newer.
    if (workspaceSet.size > 0) {
        const activeInWs = trajectoryMatchesWorkspaceSet(active, workspaceSet, platform);
        const candInWs = trajectoryMatchesWorkspaceSet(candidate, workspaceSet, platform);
        const candHasExplicitWs = extractTrajectoryWorkspaceUris(candidate).length > 0;
        if (activeInWs && !candInWs && candHasExplicitWs && !(candUserMs > effectiveActiveUserMs)) {
            return false;
        }
    }

    return true;
}

/**
 * Determine whether another `IDLE` candidate should replace the currently tracked `IDLE`
 * conversation. Prevents background metadata/checkpoint `lastModifiedTime` bumps on older
 * sessions from causing 54% -> 9% jumps while still following explicit new user turns.
 */
function shouldIdleCandidatePreemptActive(
    candidate: ConversationTrajectoryLike,
    active: ConversationTrajectoryLike,
    currentActiveSinceMs = 0,
): boolean {
    if (candidate.cascadeId === active.cascadeId) { return false; }

    const candUserInputMs = parseTimestampMs(candidate.lastUserInputTime);
    const activeUserInputMs = parseTimestampMs(active.lastUserInputTime);
    const activeSinceAnchor = (active.stepCount || 0) === 0 && currentActiveSinceMs > 0
        ? currentActiveSinceMs
        : 0;
    const activeAnchorMs = Math.max(activeUserInputMs, getCreatedTimestampScore(active), activeSinceAnchor);

    if (candUserInputMs > 0 && activeAnchorMs > 0) {
        return candUserInputMs > activeAnchorMs;
    }

    const candCreated = getCreatedTimestampScore(candidate);
    const activeCreated = Math.max(getCreatedTimestampScore(active), activeSinceAnchor);
    if (candCreated > 0 && activeCreated > 0) {
        return candCreated > activeCreated;
    }

    return false;
}

function pickBestCandidate(
    candidates: readonly ConversationTrajectoryLike[],
    workspaceSet: ReadonlySet<string>,
    platform: NodeJS.Platform,
    currentActiveId?: string | null,
    currentActiveSinceMs = 0,
): { target: ConversationTrajectoryLike | null; reason: string } {
    if (candidates.length === 0) {
        return { target: null, reason: 'no_candidates' };
    }

    const sorted = [...candidates].sort(compareRecencyDesc);
    const inWorkspace = workspaceSet.size > 0
        ? sorted.filter(t => trajectoryMatchesWorkspaceSet(t, workspaceSet, platform))
        : [];
    const activeCandidate = currentActiveId
        ? sorted.find(t => t.cascadeId === currentActiveId)
        : undefined;

    // 1. Keep currently tracked RUNNING conversation in current workspace (prevents flicker)
    if (currentActiveId) {
        const activeLocal = inWorkspace.find(t => t.cascadeId === currentActiveId && isRunningTrajectory(t));
        if (activeLocal) {
            return { target: activeLocal, reason: 'active_running_in_workspace' };
        }
    }

    // 2. Most recent RUNNING conversation in current workspace (guarded against older background hijacks)
    const runningLocal = inWorkspace.find(t =>
        isRunningTrajectory(t)
        && (!activeCandidate || shouldRunningCandidatePreemptActive(t, activeCandidate, workspaceSet, platform, currentActiveSinceMs)),
    );
    if (runningLocal) {
        return { target: runningLocal, reason: 'running_in_workspace' };
    }

    // 3. If no workspace filter, keep active RUNNING or pick most recent RUNNING globally
    if (workspaceSet.size === 0 && currentActiveId) {
        const activeRunning = sorted.find(t => t.cascadeId === currentActiveId && isRunningTrajectory(t));
        if (activeRunning) {
            return { target: activeRunning, reason: 'active_running' };
        }
    }

    // Keep currently tracked RUNNING conversation even if it has no workspace URI yet (brand-new chat)
    if (activeCandidate && isRunningTrajectory(activeCandidate)) {
        return { target: activeCandidate, reason: 'active_running' };
    }

    const runningAny = sorted.find(t =>
        isRunningTrajectory(t)
        && (!activeCandidate || shouldRunningCandidatePreemptActive(t, activeCandidate, workspaceSet, platform, currentActiveSinceMs)),
    );
    if (runningAny) {
        return {
            target: runningAny,
            reason: workspaceSet.size > 0 ? 'running_cross_workspace' : 'running_latest',
        };
    }

    // 4. Preserve currently tracked IDLE conversation against background lastModifiedTime bumps
    //    (only switch when another conversation has strictly newer user input or creation time).
    if (activeCandidate) {
        const activeEligibleForWorkspace = workspaceSet.size === 0
            || inWorkspace.length === 0
            || trajectoryMatchesWorkspaceSet(activeCandidate, workspaceSet, platform)
            || extractTrajectoryWorkspaceUris(activeCandidate).length === 0;
        if (activeEligibleForWorkspace) {
            const topIdlePool = inWorkspace.length > 0 ? inWorkspace : sorted;
            const topIdle = topIdlePool[0];
            if (!topIdle || topIdle.cascadeId === activeCandidate.cascadeId
                || !shouldIdleCandidatePreemptActive(topIdle, activeCandidate, currentActiveSinceMs)) {
                return { target: activeCandidate, reason: 'active_idle_preserved' };
            }
        }
    }

    // 5. Most recent conversation in current workspace
    if (inWorkspace.length > 0) {
        return { target: inWorkspace[0], reason: 'latest_in_workspace' };
    }

    // 6. Fallback: most recent conversation overall
    return { target: sorted[0], reason: 'latest_overall' };
}

function pickNewestCreatedCandidate(
    candidates: readonly ConversationTrajectoryLike[],
    newlyCreatedIds: ReadonlySet<string> | undefined,
    workspaceSet: ReadonlySet<string>,
    platform: NodeJS.Platform,
): ConversationTrajectoryLike | null {
    if (!newlyCreatedIds || newlyCreatedIds.size === 0 || candidates.length === 0) {
        return null;
    }
    const fresh = candidates.filter(t => newlyCreatedIds.has(t.cascadeId) && t.killed !== true);
    if (fresh.length === 0) {
        return null;
    }
    const sortedFresh = [...fresh].sort(compareRecencyDesc);
    if (workspaceSet.size > 0) {
        // Prefer newly created chats in the active workspace or brand-new chats without workspace URIs bound yet
        const inWsOrUnbound = sortedFresh.filter(t =>
            trajectoryMatchesWorkspaceSet(t, workspaceSet, platform)
            || extractTrajectoryWorkspaceUris(t).length === 0,
        );
        if (inWsOrUnbound.length > 0) {
            return inWsOrUnbound[0];
        }
    }
    return sortedFresh[0];
}

// ─── Target Conversation Resolver ────────────────────────────────────────────

/**
 * Resolve which conversation should be monitored given available trajectories
 * and user/host selection preferences.
 *
 * Modes:
 * 1. `pinned` — explicit `pinnedId` (if still present; falls back cleanly if deleted).
 * 2. `locked_main` — `lockToMainAgent: true` ignores subagent bursts and stays on the
 *    active or most-recent main-agent trajectory.
 * 3. `auto_follow` — follows `hostConversationId` (e.g. `window.sidecar.conversationId`)
 *    or the latest active workspace trajectory, resisting subagent/swarm hijacks and
 *    cross-session jumps when starting brand-new conversations.
 */
export function resolveTargetConversation(
    input: ResolveTargetConversationInput,
): ResolvedConversationTarget {
    const trajectories = Array.isArray(input.trajectories) ? input.trajectories : [];
    const platform = input.platform ?? process.platform;
    const pinnedId = nonEmptyString(input.pinnedId);
    const lockToMainAgent = input.lockToMainAgent === true;
    const prevLockedMainId = nonEmptyString(input.lockedMainId);
    const hostConversationId = nonEmptyString(input.hostConversationId);
    const currentActiveId = nonEmptyString(input.currentActiveId);
    const currentActiveSinceMs = typeof input.currentActiveSinceMs === 'number'
        && Number.isFinite(input.currentActiveSinceMs)
        && input.currentActiveSinceMs > 0
        ? input.currentActiveSinceMs
        : 0;
    const workspaceSet = buildNormalizedWorkspaceSet(input.workspaceUris, platform);
    const knownSubagents = input.knownSubagentIds;
    const newlyCreatedIds = input.newlyCreatedIds;
    const deletedIds = input.deletedConversationIds;
    const hostPendingAllowed = input.hostConversationPendingAllowed !== false;
    const hostNewConversationPending = input.hostNewConversationPending === true;

    const hostIdIsKnownSubagent = Boolean(hostConversationId && knownSubagents?.has(hostConversationId));
    const hostIdIsDeleted = Boolean(hostConversationId && deletedIds?.has(hostConversationId));

    if (trajectories.length === 0) {
        if (!pinnedId && hostNewConversationPending) {
            return {
                target: null,
                cascadeId: null,
                mode: lockToMainAgent ? 'locked_main' : 'auto_follow',
                lockedMainId: null,
                pinnedFallback: false,
                ignoredSubagentBurst: false,
                hostPending: true,
                reason: lockToMainAgent ? 'locked_main_new_conversation_pending' : 'host_new_conversation_pending',
            };
        }
        if (hostConversationId && hostPendingAllowed && !hostIdIsDeleted && !(lockToMainAgent && hostIdIsKnownSubagent)) {
            return {
                target: null,
                cascadeId: hostConversationId,
                mode: lockToMainAgent ? 'locked_main' : 'auto_follow',
                lockedMainId: lockToMainAgent ? hostConversationId : null,
                pinnedFallback: Boolean(pinnedId),
                ignoredSubagentBurst: false,
                hostPending: true,
                reason: lockToMainAgent ? 'locked_main_host_pending' : 'host_conversation_pending',
            };
        }
        return {
            target: null,
            cascadeId: null,
            mode: pinnedId ? 'pinned' : (lockToMainAgent ? 'locked_main' : 'auto_follow'),
            lockedMainId: null,
            pinnedFallback: Boolean(pinnedId),
            ignoredSubagentBurst: false,
            reason: 'empty_trajectories',
        };
    }

    const byId = new Map<string, ConversationTrajectoryLike>();
    for (const t of trajectories) {
        const id = nonEmptyString(t?.cascadeId);
        if (id && !byId.has(id)) {
            byId.set(id, t);
        }
    }

    const uniqueTrajectories = [...byId.values()];
    const mainTrajectories = uniqueTrajectories.filter(t => !isSubagentTrajectory(t, knownSubagents));
    const subagentTrajectories = uniqueTrajectories.filter(t => isSubagentTrajectory(t, knownSubagents));

    const findFallbackMainId = (preferred?: ConversationTrajectoryLike | null): string | null => {
        if (preferred && !isSubagentTrajectory(preferred, knownSubagents)) {
            return preferred.cascadeId;
        }
        if (prevLockedMainId) {
            const prev = byId.get(prevLockedMainId);
            if (prev && !isSubagentTrajectory(prev, knownSubagents)) {
                return prev.cascadeId;
            }
        }
        const bestMain = pickBestCandidate(mainTrajectories, workspaceSet, platform, currentActiveId, currentActiveSinceMs).target;
        return bestMain ? bestMain.cascadeId : null;
    };

    // ── Mode 1: Manual Pin ───────────────────────────────────────────────────
    let pinnedFallback = false;
    if (pinnedId) {
        const pinned = byId.get(pinnedId);
        if (pinned) {
            return {
                target: pinned,
                cascadeId: pinned.cascadeId,
                mode: 'pinned',
                lockedMainId: findFallbackMainId(pinned),
                pinnedFallback: false,
                ignoredSubagentBurst: false,
                reason: 'manual_pin',
            };
        }
        // Pinned conversation was deleted or is no longer returned -> fall through cleanly
        pinnedFallback = true;
    }

    // ── Mode 2: Lock to Main Agent ───────────────────────────────────────────
    if (lockToMainAgent) {
        const hostTarget = hostConversationId ? byId.get(hostConversationId) : undefined;
        const hostIsSubagent = Boolean(
            (hostTarget && isSubagentTrajectory(hostTarget, knownSubagents))
            || hostIdIsKnownSubagent,
        );
        const hasRunningSubagent = subagentTrajectories.some(isRunningTrajectory);

        if (hostNewConversationPending) {
            return {
                target: null,
                cascadeId: null,
                mode: 'locked_main',
                lockedMainId: findFallbackMainId(),
                pinnedFallback,
                ignoredSubagentBurst: hasRunningSubagent,
                hostPending: true,
                reason: pinnedFallback
                    ? 'pinned_missing_locked_main_new_conversation_pending'
                    : 'locked_main_new_conversation_pending',
            };
        }

        // Brand-new host main conversation not yet returned by GetAllCascadeTrajectories:
        // NEVER fall back to an older locked main conversation (prevents 54% -> 9% jump!).
        if (hostConversationId && !hostTarget && !hostIsSubagent && !hostIdIsDeleted && hostPendingAllowed) {
            return {
                target: null,
                cascadeId: hostConversationId,
                mode: 'locked_main',
                lockedMainId: hostConversationId,
                pinnedFallback,
                ignoredSubagentBurst: hasRunningSubagent,
                hostPending: true,
                reason: pinnedFallback
                    ? 'pinned_missing_locked_main_host_pending'
                    : 'locked_main_host_pending',
            };
        }

        if (mainTrajectories.length === 0) {
            // Edge case: only subagent trajectories exist; fall back gracefully instead of blanking
            const fallback = pickBestCandidate(uniqueTrajectories, workspaceSet, platform, currentActiveId);
            return {
                target: fallback.target,
                cascadeId: fallback.target?.cascadeId ?? null,
                mode: 'locked_main',
                lockedMainId: null,
                pinnedFallback,
                ignoredSubagentBurst: false,
                reason: pinnedFallback ? 'pinned_missing_fallback_subagent_only' : 'fallback_subagent_only',
            };
        }

        // Check if any subagent is strictly newer than the best main or currently running / hijacking hostId
        let chosen: ConversationTrajectoryLike | null = null;
        let reason = 'locked_main_latest';

        // Priority 2a: hostConversationId if it is a main trajectory
        if (hostTarget && !hostIsSubagent) {
            chosen = hostTarget;
            reason = 'locked_main_host';
        }
        // Priority 2a-new: newly created main trajectory (ignoring newly spawned swarm workers/subagents)
        if (!chosen) {
            const freshMain = pickNewestCreatedCandidate(mainTrajectories, newlyCreatedIds, workspaceSet, platform);
            if (freshMain) {
                chosen = freshMain;
                reason = 'locked_main_new_conversation';
            }
        }
        // Priority 2b: previously locked main conversation while it still exists
        if (!chosen && prevLockedMainId) {
            const locked = byId.get(prevLockedMainId);
            if (locked && !isSubagentTrajectory(locked, knownSubagents)) {
                chosen = locked;
                reason = 'locked_main_preserved';
            }
        }
        // Priority 2c: current active conversation if it is a main trajectory
        if (!chosen && currentActiveId) {
            const active = byId.get(currentActiveId);
            if (active && !isSubagentTrajectory(active, knownSubagents)) {
                chosen = active;
                reason = 'locked_main_active';
            }
        }
        // Priority 2d: best active/recent main trajectory (preferring current workspace)
        if (!chosen) {
            const bestMain = pickBestCandidate(mainTrajectories, workspaceSet, platform, currentActiveId, currentActiveSinceMs);
            chosen = bestMain.target;
            reason = `locked_main_${bestMain.reason}`;
        }

        const chosenTime = chosen ? getTimestampScore(chosen) : 0;
        const newerSubagentExists = subagentTrajectories.some(s => getTimestampScore(s) > chosenTime);
        const ignoredSubagentBurst = hostIsSubagent || hasRunningSubagent || newerSubagentExists;

        return {
            target: chosen,
            cascadeId: chosen?.cascadeId ?? null,
            mode: 'locked_main',
            lockedMainId: chosen?.cascadeId ?? null,
            pinnedFallback,
            ignoredSubagentBurst,
            reason: pinnedFallback ? `pinned_missing_${reason}` : reason,
        };
    }

    // ── Mode 3: Auto-Follow ──────────────────────────────────────────────────
    if (hostNewConversationPending) {
        return {
            target: null,
            cascadeId: null,
            mode: 'auto_follow',
            lockedMainId: findFallbackMainId(),
            pinnedFallback,
            ignoredSubagentBurst: false,
            hostPending: true,
            reason: pinnedFallback ? 'pinned_missing_host_new_conversation_pending' : 'host_new_conversation_pending',
        };
    }

    if (hostConversationId) {
        const hostTarget = byId.get(hostConversationId);
        if (hostTarget) {
            return {
                target: hostTarget,
                cascadeId: hostTarget.cascadeId,
                mode: 'auto_follow',
                lockedMainId: findFallbackMainId(hostTarget),
                pinnedFallback,
                ignoredSubagentBurst: false,
                reason: pinnedFallback ? 'pinned_missing_host_conversation' : 'host_conversation',
            };
        }
        // Host reports a brand-new conversation ID not yet indexed by GetAllCascadeTrajectories:
        // hold cleanly at pending 0% instead of jumping to an unrelated older session!
        if (!hostIdIsDeleted && hostPendingAllowed) {
            return {
                target: null,
                cascadeId: hostConversationId,
                mode: 'auto_follow',
                lockedMainId: findFallbackMainId(),
                pinnedFallback,
                ignoredSubagentBurst: false,
                hostPending: true,
                reason: pinnedFallback ? 'pinned_missing_host_conversation_pending' : 'host_conversation_pending',
            };
        }
    }

    // Newly created main conversation takes immediate precedence (never newly spawned swarm workers/subagents)
    const newlyCreatedMain = pickNewestCreatedCandidate(mainTrajectories, newlyCreatedIds, workspaceSet, platform);
    if (newlyCreatedMain) {
        return {
            target: newlyCreatedMain,
            cascadeId: newlyCreatedMain.cascadeId,
            mode: 'auto_follow',
            lockedMainId: newlyCreatedMain.cascadeId,
            pinnedFallback,
            ignoredSubagentBurst: subagentTrajectories.some(isRunningTrajectory),
            reason: pinnedFallback ? 'pinned_missing_new_main_conversation' : 'new_main_conversation',
        };
    }

    // Once a main conversation is actively tracked (or any main conversation is RUNNING),
    // prevent concurrent background subagents / swarm workers from hijacking context display.
    const currentActiveObj = currentActiveId ? byId.get(currentActiveId) : undefined;
    const currentActiveIsMain = Boolean(currentActiveObj && !isSubagentTrajectory(currentActiveObj, knownSubagents));
    const hasRunningMain = mainTrajectories.some(isRunningTrajectory);
    const restrictToMain = mainTrajectories.length > 0 && (currentActiveIsMain || hasRunningMain);
    const autoCandidates = restrictToMain ? mainTrajectories : uniqueTrajectories;

    const best = pickBestCandidate(autoCandidates, workspaceSet, platform, currentActiveId, currentActiveSinceMs);
    const ignoredSubagentBurst = restrictToMain && subagentTrajectories.some(isRunningTrajectory);
    return {
        target: best.target,
        cascadeId: best.target?.cascadeId ?? null,
        mode: 'auto_follow',
        lockedMainId: findFallbackMainId(best.target),
        pinnedFallback,
        ignoredSubagentBurst,
        reason: pinnedFallback ? `pinned_missing_${best.reason}` : best.reason,
    };
}

// ─── Conversation Switcher Options Builder ───────────────────────────────────

function formatConversationTitle(
    summary: ConversationTrajectoryLike,
    lang: 'en' | 'zh' | 'both',
): { title: string; isUntitled: boolean } {
    const cascadeId = nonEmptyString(summary.cascadeId);
    const raw = (nonEmptyString(summary.summary) || nonEmptyString(summary.title))
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!raw || raw === cascadeId || /^untitled$/i.test(raw)) {
        const shortId = cascadeId ? cascadeId.slice(0, 8) : 'unknown';
        const prefix = lang === 'zh'
            ? '未命名会话'
            : (lang === 'both' ? 'Untitled / 未命名' : 'Untitled');
        return {
            title: `${prefix} (${shortId})`,
            isUntitled: true,
        };
    }

    const truncated = raw.length > 90 ? raw.slice(0, 87).trimEnd() + '...' : raw;
    return { title: truncated, isUntitled: false };
}

/**
 * Build UI-ready conversation switcher options from trajectory summaries with
 * subagent tags, active/locked indicators, workspace match flags, and clean
 * untitled fallbacks.
 */
export function buildConversationOptions(
    trajectories: ReadonlyArray<ConversationTrajectoryLike>,
    activeId?: string | null,
    lockedMainId?: string | null,
    config: BuildConversationOptionsConfig = {},
): ConversationOption[] {
    if (!Array.isArray(trajectories) || trajectories.length === 0) {
        return [];
    }

    const platform = config.platform ?? process.platform;
    const lang = config.lang ?? 'en';
    const excludeSubagents = config.excludeSubagents === true;
    const prioritizeWorkspace = config.prioritizeWorkspace !== false;
    const workspaceSet = buildNormalizedWorkspaceSet(config.workspaceUris, platform);
    const activeClean = nonEmptyString(activeId);
    const lockedClean = nonEmptyString(lockedMainId);

    const seen = new Set<string>();
    const options: ConversationOption[] = [];

    for (const traj of trajectories) {
        if (!traj || typeof traj !== 'object') { continue; }
        const cascadeId = nonEmptyString(traj.cascadeId);
        if (!cascadeId || seen.has(cascadeId)) { continue; }
        seen.add(cascadeId);

        const subagent = isSubagentTrajectory(traj, config.knownSubagentIds);
        if (excludeSubagents && subagent) { continue; }

        const { title, isUntitled } = formatConversationTitle(traj, lang);
        const matchesWorkspace = trajectoryMatchesWorkspaceSet(traj, workspaceSet, platform);

        options.push({
            cascadeId,
            title,
            isUntitled,
            isSubagent: subagent,
            isActive: cascadeId === activeClean,
            isLockedMain: cascadeId === lockedClean,
            isRunning: isRunningTrajectory(traj),
            matchesWorkspace,
            stepCount: typeof traj.stepCount === 'number' && Number.isFinite(traj.stepCount) && traj.stepCount >= 0
                ? Math.round(traj.stepCount)
                : 0,
            lastModifiedTime: nonEmptyString(traj.lastModifiedTime),
            model: nonEmptyString(traj.requestedModel) || nonEmptyString(traj.generatorModel),
            workspaceLabel: extractWorkspaceBasename(traj),
            branchName: nonEmptyString(traj.branchName),
        });
    }

    options.sort((a, b) => {
        if (prioritizeWorkspace && workspaceSet.size > 0 && a.matchesWorkspace !== b.matchesWorkspace) {
            return a.matchesWorkspace ? -1 : 1;
        }
        const timeA = a.lastModifiedTime ? Date.parse(a.lastModifiedTime) : 0;
        const timeB = b.lastModifiedTime ? Date.parse(b.lastModifiedTime) : 0;
        const safeA = Number.isFinite(timeA) ? timeA : 0;
        const safeB = Number.isFinite(timeB) ? timeB : 0;
        if (safeB !== safeA) { return safeB - safeA; }
        if (b.lastModifiedTime !== a.lastModifiedTime) {
            return b.lastModifiedTime.localeCompare(a.lastModifiedTime);
        }
        return a.cascadeId.localeCompare(b.cascadeId);
    });

    return options;
}

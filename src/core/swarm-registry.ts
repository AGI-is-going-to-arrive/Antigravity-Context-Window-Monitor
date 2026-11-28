// ─── Authoritative Read-Only Swarm & Subagent Topology Registry + Scheduler ──
// Implements Blueprint §1.2 & §3.3:
// - Strict read-only allowlisted manifest parser (`members.json` / `swarm.json` ONLY;
//   NEVER reads `board.jsonl`, `transcript.jsonl`, `plan.json`, `steps/`, or prompts;
//   NEVER writes `.system_generated/swarm/`).
// - Hard filesystem safety: safe single-segment cascadeId validation, Remote-SSH/WSL
//   root scoping guard, ancestor symlink & Windows junction verification, `lstat` +
//   `open` + `fstat` dev/ino match, streaming read hard cap <= 512 KB, bounded sweep
//   with continuation cursor, same-size/same-mtime replacement & deletion detection,
//   and bounded partial-JSON grace TTL.
// - Explicit handling of all topology anomalies (unknown parent, conflicting manifests,
//   0/multiple coordinators, nested sub-swarms, duplicate member names, forks, orphans,
//   cycles, deleted coordinator, unknown roles).
// - Unified per-backend fair-budget scheduler (`SwarmPollScheduler`) with <= 3 max
//   concurrency, guaranteed Coordinator + inspectedMember priority, 1 final terminal
//   refresh, and starvation-free round-robin across 20+ active members.
// - Deduplicated group cost aggregator separating direct worker cost, inclusive group
//   total, and unpriced call count.
//
// Zero VS Code, DOM, or external npm dependencies.

import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import type { GMCallEntry, GMConversationData } from '../gm/types';
import { buildGMMatchKey } from '../gm/parser';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Strict Read-Only Manifest Allowlist (§1.2) ──────────────────────────────

/** ONLY these exact manifest filenames may ever be opened under `.system_generated/swarm/`. */
export const ALLOWED_MANIFEST_FILENAMES: ReadonlySet<string> = new Set([
    'members.json',
    'swarm.json',
]);

export const DEFAULT_SWARM_SCAN_BUDGETS = Object.freeze({
    /** Hard byte cap enforced during streaming file read (512 KB). */
    maxFileBytes: 512 * 1024,
    /** Maximum total manifest bytes read across a single sweep (4 MB). */
    maxTotalBytesPerSweep: 4 * 1024 * 1024,
    /** Bounded directory count inspected per sweep before advancing continuation cursor. */
    maxDirsPerSweep: 200,
    /** Maximum concurrent manifest file opens/reads during a sweep. */
    maxConcurrentOpens: 4,
    /** Maximum cached manifest entries retained in memory. */
    maxCachedManifests: 256,
    /** Maximum member entries parsed from any single manifest file. */
    maxMembersPerManifest: 128,
    /** Maximum length of any single string field retained from a manifest. */
    maxStringLength: 256,
    /** Wall-clock budget per sweep in milliseconds. */
    maxSweepElapsedMs: 1_500,
    /** Grace window (ms) to preserve last valid manifest during a partial/corrupt write before marking stale. */
    partialJsonGraceTtlMs: 10_000,
});

export interface SwarmScanBudgets {
    maxFileBytes: number;
    maxTotalBytesPerSweep: number;
    maxDirsPerSweep: number;
    maxConcurrentOpens: number;
    maxCachedManifests: number;
    maxMembersPerManifest: number;
    maxStringLength: number;
    maxSweepElapsedMs: number;
    partialJsonGraceTtlMs: number;
}

// ─── Topology Types ──────────────────────────────────────────────────────────

export type SwarmRelationshipKind =
    | 'swarm_member'
    | 'direct_subagent'
    | 'nested_helper'
    | 'fork';

export type TopologyEvidenceSource =
    | 'manifest'
    | 'rpc_step'
    | 'trajectory_meta'
    | 'worktree';

export interface SwarmMemberNode {
    cascadeId: string;
    directParentId: string | null;
    rootId: string;
    relationshipKind: SwarmRelationshipKind;
    evidenceSource: TopologyEvidenceSource;
    confidence: number;
    freshnessMs: number;
    memberName?: string;
    assignedRole?: string;
    /** Model assigned in swarm manifest (`applied_model` ?? `model`), strictly distinct from RPC-measured model. */
    assignedModel?: string;
    /** Explicit `applied_model` from manifest when present. */
    appliedModel?: string;
    phase?: string;
    killed?: boolean;
    workspaceMode?: 'inherit' | 'share' | 'branch' | string;
    /** Strictly display metadata only — NEVER use for filesystem reveal or authorization! */
    workspaceDisplay?: string;
    lastObservedAt?: number;
    measuredModel?: string;
    contextPct?: number;
    /** True when this node explicitly coordinates its own swarm (outer root or nested sub-swarm). */
    isCoordinator?: boolean;
    /** Immediate sub-swarm coordinator ID when this node is a nested helper inside a worker's sub-swarm. */
    subSwarmCoordinatorId?: string | null;
    /** True when conflicting manifests or sources disagreed on this node. */
    hasConflict?: boolean;
    conflictDetails?: string[];
    /** True when parent/coordinator is missing/unknown/deleted. */
    isOrphan?: boolean;
    /** True when cycle detection broke a loop while walking parent/root links. */
    cycleDetected?: boolean;
    /** True when the underlying manifest is stale after partial/corrupt JSON TTL expiry. */
    isStaleManifest?: boolean;
    /** True when `assignedRole` was not recognized (unknown roles MUST NOT auto-classify as workers!). */
    hasUnknownRole?: boolean;
    /** True when multiple distinct cascadeIds share the same `memberName` within the swarm. */
    duplicateNameConflict?: boolean;
}

export type TopologyAnomalyKind =
    | 'unknown_parent'
    | 'conflicting_manifest'
    | 'zero_coordinators'
    | 'multiple_coordinators'
    | 'nested_sub_swarm'
    | 'duplicate_member_name'
    | 'fork_with_parent'
    | 'orphan'
    | 'cycle'
    | 'deleted_coordinator'
    | 'unknown_role'
    | 'stale_manifest'
    | 'unsafe_manifest_skipped';

export interface TopologyAnomaly {
    kind: TopologyAnomalyKind;
    cascadeId?: string;
    rootId?: string;
    manifestDirId?: string;
    detail: string;
}

export interface SwarmGroupSummary {
    rootId: string;
    title?: string;
    coordinatorIds: string[];
    memberIds: string[];
    activeMemberIds: string[];
    killedMemberIds: string[];
    nestedSubSwarmCoordinatorIds: string[];
    hasConflict: boolean;
    coordinatorDeleted: boolean;
    isStaleManifest: boolean;
}

export interface SwarmTopologySnapshot {
    backendEpoch: number;
    nodesById: ReadonlyMap<string, SwarmMemberNode>;
    groupsByRootId: ReadonlyMap<string, SwarmGroupSummary>;
    anomalies: readonly TopologyAnomaly[];
    lastSweepAtMs: number;
    cursorCompletedFullPass: boolean;
    scannedDirsInLastSweep: number;
    bytesReadInLastSweep: number;
    /** True when local `brain/` scanning was disabled (e.g. Remote-SSH / WSL without remote-scoped root). */
    localScanDisabled: boolean;
}

// ─── Allowlisted Manifest Data Structures ────────────────────────────────────

export interface ParsedAllowedManifestMember {
    memberName: string;
    conversationId: string;
    role?: string;
    model?: string;
    appliedModel?: string;
    workspaceMode?: string;
    phase?: string;
    killed: boolean;
    /** Strictly display metadata only. */
    workspaceDisplay?: string;
}

export interface ParsedAllowedManifest {
    manifestDirId: string;
    filename: 'members.json' | 'swarm.json';
    title?: string;
    members: ParsedAllowedManifestMember[];
    truncatedMembers: boolean;
}

// ─── External Inputs for Topology Reconciliation ─────────────────────────────

export interface TopologyTrajectoryInput {
    cascadeId: string;
    summary?: string;
    title?: string;
    status?: string;
    stepCount?: number;
    lastModifiedTime?: string;
    createdTime?: string;
    parentCascadeId?: string;
    parentTrajectoryId?: string;
    parentConversationId?: string;
    isSubagent?: boolean;
    isFork?: boolean;
    forkedFromCascadeId?: string;
    role?: string;
    agentRole?: string;
    agentType?: string;
    trajectoryType?: string;
    spawnedBy?: string;
    swarmId?: string;
    killed?: boolean;
    workspaceUris?: readonly string[];
    workspaces?: ReadonlyArray<{ workspaceFolderAbsoluteUri?: string; [key: string]: unknown }>;
    branchName?: string;
    gitRootUri?: string;
    /** Optional branch/content revision key so equal-step edits/rewinds invalidate cached RPC links. */
    branchRevision?: string;
    trajectoryMetadata?: Record<string, unknown>;
}

/**
 * Privacy-safe projection of typed invocation links from already-authorized RPC steps.
 * Contains ONLY structured IDs and relationship enums — NEVER prompt text!
 */
export interface RpcTopologyLinkProjection {
    parentCascadeId: string;
    childCascadeId: string;
    kind: 'direct_subagent' | 'swarm_member' | 'nested_helper';
    observedAtMs: number;
    branchRevision?: string;
    memberName?: string;
    assignedRole?: string;
}

export interface ReconcileTopologyInput {
    backendEpoch: number;
    nowMs?: number;
    trajectories?: ReadonlyArray<TopologyTrajectoryInput>;
    rpcLinks?: ReadonlyArray<RpcTopologyLinkProjection>;
    deletedConversationIds?: ReadonlySet<string>;
    branchRevisionByCascade?: ReadonlyMap<string, string>;
}

// ─── Safe Filesystem Abstraction (Injectable for Hardened Tests) ─────────────

export interface SafeStatLike {
    dev: number | bigint;
    ino: number | bigint;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}

export interface SafeFileHandleLike {
    stat(): Promise<SafeStatLike>;
    read(buffer: Buffer, offset: number, length: number, position: number | null): Promise<{ bytesRead: number; buffer: Buffer }>;
    close(): Promise<void>;
}

export interface SwarmManifestFsOps {
    readdir(dirPath: string): Promise<string[]>;
    lstat(targetPath: string): Promise<SafeStatLike>;
    realpath(targetPath: string): Promise<string>;
    openReadOnly(targetPath: string, flags: number): Promise<SafeFileHandleLike>;
    platform?: NodeJS.Platform;
}

const DEFAULT_FS_OPS: SwarmManifestFsOps = {
    readdir: (dirPath) => fs.promises.readdir(dirPath),
    lstat: (targetPath) => fs.promises.lstat(targetPath),
    realpath: (targetPath) => fs.promises.realpath(targetPath),
    openReadOnly: async (targetPath, flags) => {
        const handle = await fs.promises.open(targetPath, flags);
        return {
            stat: () => handle.stat(),
            read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
            close: () => handle.close(),
        };
    },
    platform: process.platform,
};

// ─── Path Safety & Host Root Scoping ─────────────────────────────────────────

const SAFE_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WINDOWS_RESERVED_NAME_RE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

/**
 * Deterministic UTF-16 code-unit comparator matching JS `<` / `>` comparisons.
 * MUST be used for any sorted list traversed with `id > cursor` so mixed-case IDs
 * (e.g. `'Alpha'`, `'beta'`, `'Gamma'`) never diverge between sort order and cursor resume.
 */
function compareCodeUnit(a: string, b: string): number {
    return a < b ? -1 : (a > b ? 1 : 0);
}

/**
 * Strictly validate that `cascadeId` is a single safe filesystem path segment
 * before constructing any path under `brain/`. Rejects traversal (`..`), slashes,
 * null bytes, control chars, colons, trailing dots, and Windows device names.
 */
export function isSafeCascadeIdSegment(value: unknown): value is string {
    if (typeof value !== 'string') { return false; }
    if (value.length === 0 || value.length > 128) { return false; }
    if (value === '.' || value === '..') { return false; }
    if (value.includes('/') || value.includes('\\') || value.includes('\0') || value.includes(':')) {
        return false;
    }
    if (value.endsWith('.') || value.endsWith(' ')) { return false; }
    if (!SAFE_SEGMENT_RE.test(value)) { return false; }
    if (WINDOWS_RESERVED_NAME_RE.test(value)) { return false; }
    return true;
}

export interface BrainRootScopeOptions {
    brainDir?: string | null;
    dataDir?: string | null;
    env?: Record<string, string | undefined>;
    homeDir?: string;
    /** True when running connected to a remote host (Remote-SSH / WSL UI host) where local `~/.gemini` does NOT belong to the remote LS. */
    isRemoteHost?: boolean;
    /** Optional VS Code remoteAuthority (e.g. `ssh-remote+host`, `wsl+Ubuntu`). */
    remoteAuthority?: string | null;
    /** Explicitly allow local brain root only when the caller verified the brain dir belongs to the owning remote/WSL host. */
    remoteBrainVerified?: boolean;
}

/**
 * Scope the swarm manifest root strictly to the owning host/profile.
 * Returns `null` when Remote-SSH / WSL is active without a verified matching
 * brain root so an unrelated local `brain/` directory is NEVER scanned!
 */
export function resolveScopedBrainRoot(options: BrainRootScopeOptions = {}): string | null {
    const env = options.env ?? process.env;
    const remoteAuth = typeof options.remoteAuthority === 'string' ? options.remoteAuthority.trim() : '';
    const isRemote = options.isRemoteHost === true || remoteAuth.length > 0;

    if (isRemote && options.remoteBrainVerified !== true) {
        return null;
    }

    const explicitBrain = typeof options.brainDir === 'string' ? options.brainDir.trim() : '';
    if (explicitBrain) {
        return path.resolve(explicitBrain);
    }

    const envBrain = typeof env.ANTIGRAVITY_BRAIN_DIR === 'string' ? env.ANTIGRAVITY_BRAIN_DIR.trim() : '';
    if (envBrain) {
        return path.resolve(envBrain);
    }

    const explicitData = typeof options.dataDir === 'string' ? options.dataDir.trim() : '';
    if (explicitData) {
        return path.resolve(explicitData, 'brain');
    }

    const envData = typeof env.ANTIGRAVITY_DATA_DIR === 'string' ? env.ANTIGRAVITY_DATA_DIR.trim() : '';
    if (envData) {
        return path.resolve(envData, 'brain');
    }

    const home = typeof options.homeDir === 'string' && options.homeDir.trim()
        ? options.homeDir.trim()
        : os.homedir();
    if (!home) { return null; }
    return path.resolve(home, '.gemini', 'antigravity', 'brain');
}

function normalizePathForContainment(p: string, platform: NodeJS.Platform): string {
    const resolved = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
    return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isStrictlyInsideRoot(candidateReal: string, rootReal: string, platform: NodeJS.Platform): boolean {
    const normRoot = normalizePathForContainment(rootReal, platform);
    const normCand = normalizePathForContainment(candidateReal, platform);
    if (!normRoot || !normCand) { return false; }
    return normCand.startsWith(`${normRoot}/`);
}

// ─── Safe Bounded Manifest Reader ────────────────────────────────────────────

export type SafeReadManifestResult =
    | {
        ok: true;
        rawText: string;
        bytesRead: number;
        sha256: string;
        dev: string;
        ino: string;
        size: number;
        mtimeMs: number;
        ctimeMs: number;
    }
    | {
        ok: false;
        reason:
            | 'disallowed_filename'
            | 'sweep_budget'
            | 'unsafe_cascade_id'
            | 'not_found'
            | 'symlink_or_junction'
            | 'not_regular_file'
            | 'identity_mismatch'
            | 'file_too_large'
            | 'read_error';
        bytesRead: number;
        detail?: string;
    };

const STREAM_READ_CHUNK_BYTES = 16 * 1024;

/**
 * Safely read ONE allowlisted manifest file (`members.json` or `swarm.json`) from
 * `<brainRoot>/<cascadeId>/.system_generated/swarm/<filename>`:
 * - Enforces filename allowlist (`ALLOWED_MANIFEST_FILENAMES`)
 * - Enforces single safe segment validation on `cascadeId`
 * - Checks EVERY ancestor segment for symlinks and Windows junctions (`lstat` + `realpath` containment)
 * - Verifies regular-file identity (`lstat` + `open` read-only + `fstat` dev/ino match)
 * - Enforces hard streaming byte cap (`<= maxFileBytes`, default 512 KB) at read time
 */
export async function safeReadManifestFile(
    brainRoot: string,
    cascadeId: string,
    filename: string,
    options: {
        maxFileBytes?: number;
        reserveBytes?: (maxRead: number) => boolean;
        fsOps?: SwarmManifestFsOps;
    } = {},
): Promise<SafeReadManifestResult> {
    if (!ALLOWED_MANIFEST_FILENAMES.has(filename)) {
        return {
            ok: false,
            reason: 'disallowed_filename',
            bytesRead: 0,
            detail: `Disallowed manifest filename: ${filename}`,
        };
    }
    if (!isSafeCascadeIdSegment(cascadeId)) {
        return {
            ok: false,
            reason: 'unsafe_cascade_id',
            bytesRead: 0,
            detail: 'Unsafe cascadeId path segment',
        };
    }

    const fsOps = options.fsOps ?? DEFAULT_FS_OPS;
    const platform = fsOps.platform ?? process.platform;
    const maxFileBytes = typeof options.maxFileBytes === 'number' && options.maxFileBytes > 0
        ? Math.min(options.maxFileBytes, DEFAULT_SWARM_SCAN_BUDGETS.maxFileBytes)
        : DEFAULT_SWARM_SCAN_BUDGETS.maxFileBytes;

    let rootReal: string;
    try {
        const rootStat = await fsOps.lstat(brainRoot);
        if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
            return { ok: false, reason: 'symlink_or_junction', bytesRead: 0, detail: 'brainRoot is symlink or non-directory' };
        }
        rootReal = await fsOps.realpath(brainRoot);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        return {
            ok: false,
            reason: code === 'ENOENT' ? 'not_found' : 'read_error',
            bytesRead: 0,
        };
    }

    const segments = [cascadeId, '.system_generated', 'swarm', filename];
    let currentPath = brainRoot;
    let leafLstat: SafeStatLike | null = null;

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        currentPath = path.join(currentPath, seg);
        const isLeaf = i === segments.length - 1;

        let st: SafeStatLike;
        try {
            st = await fsOps.lstat(currentPath);
        } catch (err) {
            const code = (err as NodeJS.ErrnoException | undefined)?.code;
            if (code === 'ENOENT' || code === 'ENOTDIR') {
                return { ok: false, reason: 'not_found', bytesRead: 0 };
            }
            return { ok: false, reason: 'read_error', bytesRead: 0 };
        }

        if (st.isSymbolicLink()) {
            return {
                ok: false,
                reason: 'symlink_or_junction',
                bytesRead: 0,
                detail: `Symlink/junction rejected at segment ${i}`,
            };
        }

        if (isLeaf) {
            if (!st.isFile()) {
                return { ok: false, reason: 'not_regular_file', bytesRead: 0 };
            }
            leafLstat = st;
        } else if (!st.isDirectory()) {
            return { ok: false, reason: 'not_found', bytesRead: 0 };
        }

        // Verify realpath containment at each segment to defeat Windows NTFS junctions / reparse points
        try {
            const segReal = await fsOps.realpath(currentPath);
            if (!isStrictlyInsideRoot(segReal, rootReal, platform)) {
                return {
                    ok: false,
                    reason: 'symlink_or_junction',
                    bytesRead: 0,
                    detail: `Realpath escaped brainRoot at segment ${i}`,
                };
            }
            const expectedTail = path.join(rootReal, ...segments.slice(0, i + 1));
            if (normalizePathForContainment(segReal, platform) !== normalizePathForContainment(expectedTail, platform)) {
                return {
                    ok: false,
                    reason: 'symlink_or_junction',
                    bytesRead: 0,
                    detail: `Realpath mismatch (possible junction) at segment ${i}`,
                };
            }
        } catch {
            return { ok: false, reason: 'read_error', bytesRead: 0 };
        }
    }

    if (!leafLstat) {
        return { ok: false, reason: 'not_found', bytesRead: 0 };
    }
    if (leafLstat.size > maxFileBytes) {
        return {
            ok: false,
            reason: 'file_too_large',
            bytesRead: 0,
            detail: `lstat size ${leafLstat.size} > ${maxFileBytes}`,
        };
    }

    const noFollowFlag = typeof fs.constants?.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const openFlags = fs.constants.O_RDONLY | noFollowFlag;

    let handle: SafeFileHandleLike;
    try {
        handle = await fsOps.openReadOnly(currentPath, openFlags);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code === 'ELOOP') {
            return { ok: false, reason: 'symlink_or_junction', bytesRead: 0 };
        }
        if (code === 'ENOENT') {
            return { ok: false, reason: 'not_found', bytesRead: 0 };
        }
        return { ok: false, reason: 'read_error', bytesRead: 0 };
    }

    let totalRead = 0;
    try {
        const fstat = await handle.stat();
        if (!fstat.isFile()) {
            return { ok: false, reason: 'not_regular_file', bytesRead: 0 };
        }
        if (String(fstat.dev) !== String(leafLstat.dev) || String(fstat.ino) !== String(leafLstat.ino)) {
            return {
                ok: false,
                reason: 'identity_mismatch',
                bytesRead: 0,
                detail: 'lstat/fstat dev+ino mismatch',
            };
        }
        if (fstat.size > maxFileBytes) {
            return {
                ok: false,
                reason: 'file_too_large',
                bytesRead: 0,
                detail: `fstat size ${fstat.size} > ${maxFileBytes}`,
            };
        }

        // Stream in bounded chunks, stopping immediately if actual bytes exceed maxFileBytes!
        const chunks: Buffer[] = [];
        const readCap = Math.min(maxFileBytes, fstat.size + 1);
        if (options.reserveBytes && !options.reserveBytes(readCap)) {
            return { ok: false, reason: 'sweep_budget', bytesRead: 0 };
        }
        while (totalRead < readCap) {
            const remaining = readCap - totalRead;
            const toRead = Math.min(STREAM_READ_CHUNK_BYTES, remaining);
            const buf = Buffer.allocUnsafe(toRead);
            const { bytesRead } = await handle.read(buf, 0, toRead, totalRead);
            if (bytesRead <= 0) {
                break;
            }
            totalRead += bytesRead;
            if (totalRead > fstat.size) {
                return {
                    ok: false,
                    reason: 'file_too_large',
                    bytesRead: totalRead,
                    detail: `Streaming read exceeded hard limit ${maxFileBytes} bytes`,
                };
            }
            chunks.push(bytesRead === toRead ? buf : buf.subarray(0, bytesRead));
        }

        const final = await handle.stat();
        if (totalRead !== fstat.size || final.size !== fstat.size || final.ctimeMs !== fstat.ctimeMs
            || final.mtimeMs !== fstat.mtimeMs || String(final.ino) !== String(fstat.ino) || String(final.dev) !== String(fstat.dev)) {
            return { ok: false, reason: 'identity_mismatch', bytesRead: totalRead };
        }
        const fullBuf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, totalRead);
        const sha256 = crypto.createHash('sha256').update(fullBuf).digest('hex');
        const rawText = fullBuf.toString('utf8');

        return {
            ok: true,
            rawText,
            bytesRead: totalRead,
            sha256,
            dev: String(fstat.dev),
            ino: String(fstat.ino),
            size: totalRead,
            mtimeMs: fstat.mtimeMs,
            ctimeMs: fstat.ctimeMs,
        };
    } catch {
        return { ok: false, reason: 'read_error', bytesRead: totalRead };
    } finally {
        try {
            await handle.close();
        } catch {
            // Ignore close errors
        }
    }
}

// ─── Strict Allowlisted Manifest Parser (§1.2) ───────────────────────────────

function boundedString(value: unknown, maxLen: number): string | undefined {
    if (typeof value !== 'string') { return undefined; }
    const trimmed = value.replace(/[\r\n\t\x00-\x1f\x7f]+/g, ' ').trim();
    if (!trimmed) { return undefined; }
    return trimmed.length <= maxLen ? trimmed : trimmed.slice(0, maxLen);
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

/**
 * Parse manifest JSON strictly retaining ONLY the §1.2 allowlisted fields:
 * `{ title, members[name]: { conversation_id, role, model, applied_model, workspace_mode, phase, killed, workspace } }`.
 * Any prompt text, briefs, messages, or extra fields are completely discarded.
 */
export function parseAllowedManifestJson(
    rawText: string,
    manifestDirId: string,
    filename: 'members.json' | 'swarm.json',
    options: {
        maxMembersPerManifest?: number;
        maxStringLength?: number;
    } = {},
): { ok: true; manifest: ParsedAllowedManifest } | { ok: false; error: string } {
    const maxMembers = options.maxMembersPerManifest ?? DEFAULT_SWARM_SCAN_BUDGETS.maxMembersPerManifest;
    const maxStr = options.maxStringLength ?? DEFAULT_SWARM_SCAN_BUDGETS.maxStringLength;

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'invalid_json' };
    }

    const rootObj = asPlainObject(parsed);
    if (!rootObj) {
        return { ok: false, error: 'root_not_object' };
    }

    const membersObj = asPlainObject(rootObj.members);
    if (!membersObj) {
        return { ok: false, error: 'missing_members_map' };
    }

    const title = boundedString(rootObj.title, maxStr);
    const entries = Object.entries(membersObj);
    const truncatedMembers = entries.length > maxMembers;
    const limitedEntries = truncatedMembers ? entries.slice(0, maxMembers) : entries;

    const members: ParsedAllowedManifestMember[] = [];
    for (const [rawName, rawMember] of limitedEntries) {
        const m = asPlainObject(rawMember);
        if (!m) { continue; }
        const memberName = boundedString(rawName, maxStr);
        const conversationId = boundedString(m.conversation_id, maxStr);
        if (!memberName || !conversationId) { continue; }

        const role = boundedString(m.role, 64);
        const model = boundedString(m.model, maxStr);
        const appliedModel = boundedString(m.applied_model, maxStr);
        const workspaceMode = boundedString(m.workspace_mode, 32);
        const phase = boundedString(m.phase, 64);
        const killed = m.killed === true || (typeof phase === 'string' && phase.toUpperCase() === 'KILLED');
        // Strictly display metadata only (never used for reveal/access grants)
        const workspaceDisplay = boundedString(m.workspace, maxStr);

        members.push({
            memberName,
            conversationId,
            ...(role ? { role } : {}),
            ...(model ? { model } : {}),
            ...(appliedModel ? { appliedModel } : {}),
            ...(workspaceMode ? { workspaceMode } : {}),
            ...(phase ? { phase } : {}),
            killed,
            ...(workspaceDisplay ? { workspaceDisplay } : {}),
        });
    }

    return {
        ok: true,
        manifest: {
            manifestDirId,
            filename,
            ...(title ? { title } : {}),
            members,
            truncatedMembers,
        },
    };
}

// ─── Role Classification Helpers ─────────────────────────────────────────────

const COORDINATOR_ROLES = new Set(['coordinator', 'main', 'root', 'user', 'orchestrator']);
const WORKER_ROLES = new Set([
    'worker',
    'subagent',
    'sub-agent',
    'sub_agent',
    'swarm-worker',
    'swarm_worker',
    'swarmworker',
    'helper',
    'child',
    'child-agent',
    'child_agent',
    'delegated',
    'delegated-agent',
    'delegated_agent',
]);

export type ClassifiedRole = 'coordinator' | 'worker' | 'unknown' | 'absent';

/**
 * Classify an explicit role string.
 * CRITICAL INVARIANT (§3.3): An unknown role MUST return `'unknown'` and MUST NEVER
 * auto-classify as `'worker'`!
 */
export function classifyAssignedRole(role: string | undefined): ClassifiedRole {
    if (!role || !role.trim()) { return 'absent'; }
    const norm = role.trim().toLowerCase();
    if (COORDINATOR_ROLES.has(norm)) { return 'coordinator'; }
    if (WORKER_ROLES.has(norm)) { return 'worker'; }
    return 'unknown';
}

const SWARM_WORKTREE_RE = /(?:^|\/)\.gemini\/antigravity\/worktrees\/([^/]+)\/swarm-[a-z0-9][a-z0-9_-]*-[0-9a-f]{4,}(?:\/|$)/i;
const SWARM_BRANCH_RE = /^swarm-[a-z0-9][a-z0-9_-]*-[0-9a-f]{6,}$/i;

function extractWorktreeParentCandidate(traj: TopologyTrajectoryInput): { isWorktreeWorker: boolean; worktreeParentId: string | null } {
    const uris: string[] = [];
    if (Array.isArray(traj.workspaceUris)) {
        for (const u of traj.workspaceUris) {
            if (typeof u === 'string' && u.trim()) { uris.push(u.trim()); }
        }
    }
    if (Array.isArray(traj.workspaces)) {
        for (const ws of traj.workspaces) {
            const u = ws?.workspaceFolderAbsoluteUri;
            if (typeof u === 'string' && u.trim()) { uris.push(u.trim()); }
        }
    }
    if (typeof traj.gitRootUri === 'string' && traj.gitRootUri.trim()) {
        uris.push(traj.gitRootUri.trim());
    }
    for (const raw of uris) {
        let norm = raw;
        try { norm = decodeURIComponent(raw); } catch { /* keep raw */ }
        norm = norm.replace(/\\/g, '/');
        const m = norm.match(SWARM_WORKTREE_RE);
        if (m) {
            return { isWorktreeWorker: true, worktreeParentId: m[1] || null };
        }
    }
    if (typeof traj.branchName === 'string' && SWARM_BRANCH_RE.test(traj.branchName.trim())) {
        return { isWorktreeWorker: true, worktreeParentId: null };
    }
    return { isWorktreeWorker: false, worktreeParentId: null };
}

function isTrajectoryFork(traj: TopologyTrajectoryInput): boolean {
    if (traj.isFork === true) { return true; }
    if (typeof traj.forkedFromCascadeId === 'string' && traj.forkedFromCascadeId.trim().length > 0) {
        return true;
    }
    const meta = asPlainObject(traj.trajectoryMetadata);
    if (meta?.isFork === true) { return true; }
    if (typeof meta?.forkedFromCascadeId === 'string' && meta.forkedFromCascadeId.trim().length > 0) {
        return true;
    }
    const types = [traj.trajectoryType, meta?.trajectoryType, meta?.kind]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    return types.some(t => /(?:^|[_-])FORK(?:$|[_-])/i.test(t.trim()));
}

function extractTrajectoryExplicitRole(traj: TopologyTrajectoryInput): string | undefined {
    const meta = asPlainObject(traj.trajectoryMetadata);
    const candidates = [
        traj.role,
        traj.agentRole,
        traj.agentType,
        meta?.role,
        meta?.agentRole,
        meta?.agentType,
        meta?.kind,
    ];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) {
            return c.trim();
        }
    }
    return undefined;
}

function extractTrajectoryParentId(traj: TopologyTrajectoryInput): string | null {
    const meta = asPlainObject(traj.trajectoryMetadata);
    const candidates = [
        traj.parentCascadeId,
        traj.parentTrajectoryId,
        traj.parentConversationId,
        traj.forkedFromCascadeId,
        meta?.parentCascadeId,
        meta?.parentTrajectoryId,
        meta?.parentConversationId,
        meta?.forkedFromCascadeId,
    ];
    for (const c of candidates) {
        if (typeof c === 'string') {
            const trimmed = c.trim();
            if (trimmed && trimmed !== traj.cascadeId) {
                return trimmed;
            }
        }
    }
    return null;
}

// ─── Manifest Cache Entry ────────────────────────────────────────────────────

interface CachedManifestEntry {
    key: string; // `${manifestDirId}/${filename}`
    manifestDirId: string;
    filename: 'members.json' | 'swarm.json';
    manifest: ParsedAllowedManifest;
    sha256: string;
    dev: string;
    ino: string;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
    lastValidAtMs: number;
    lastCheckedAtMs: number;
    isPartialCorrupt: boolean;
    isStale: boolean;
    /** Historical member records previously seen in this manifest (e.g. killed worker recreated under same name). */
    historicalMembersById: Map<string, ParsedAllowedManifestMember>;
}

// ─── Authoritative Swarm & Subagent Topology Registry ────────────────────────

export interface SwarmTopologyRegistryOptions {
    scope?: BrainRootScopeOptions;
    budgets?: Partial<SwarmScanBudgets>;
    fsOps?: SwarmManifestFsOps;
    now?: () => number;
}

export interface SweepManifestsOptions {
    /** Active/locked/inspected cascade IDs checked first before continuing the bounded sweep cursor. */
    priorityCascadeIds?: ReadonlyArray<string>;
    nowMs?: number;
}

export interface SweepManifestsResult {
    scannedDirs: number;
    manifestsRead: number;
    manifestsChanged: number;
    manifestsDeleted: number;
    bytesRead: number;
    cursorAfter: string | null;
    completedFullPass: boolean;
    localScanDisabled: boolean;
    anomalies: TopologyAnomaly[];
}

export class SwarmTopologyRegistry {
    private readonly scope: BrainRootScopeOptions;
    private readonly budgets: SwarmScanBudgets;
    private readonly fsOps: SwarmManifestFsOps;
    private readonly nowFn: () => number;

    private readonly manifestCache = new Map<string, CachedManifestEntry>();
    private readonly rpcLinksByKey = new Map<string, RpcTopologyLinkProjection>();
    private readonly lastBranchRevisionByCascade = new Map<string, string>();
    private readonly sweepAnomalies: TopologyAnomaly[] = [];

    private backendEpoch = 1;
    private sweepCursor: string | null = null;
    private lastSweepAtMs = 0;
    private lastScannedDirs = 0;
    private lastBytesRead = 0;
    private lastCompletedFullPass = false;
    private localScanDisabled = false;
    private latestSnapshot: SwarmTopologySnapshot;

    constructor(options: SwarmTopologyRegistryOptions = {}) {
        this.scope = options.scope ?? {};
        this.budgets = {
            ...DEFAULT_SWARM_SCAN_BUDGETS,
            ...(options.budgets ?? {}),
            // Always hard-cap maxFileBytes <= 512 KB
            maxFileBytes: Math.min(
                DEFAULT_SWARM_SCAN_BUDGETS.maxFileBytes,
                Math.max(1024, options.budgets?.maxFileBytes ?? DEFAULT_SWARM_SCAN_BUDGETS.maxFileBytes),
            ),
            maxConcurrentOpens: Math.max(1, Math.min(8, options.budgets?.maxConcurrentOpens ?? DEFAULT_SWARM_SCAN_BUDGETS.maxConcurrentOpens)),
            maxDirsPerSweep: Math.max(1, options.budgets?.maxDirsPerSweep ?? DEFAULT_SWARM_SCAN_BUDGETS.maxDirsPerSweep),
            maxCachedManifests: Math.max(1, options.budgets?.maxCachedManifests ?? DEFAULT_SWARM_SCAN_BUDGETS.maxCachedManifests),
        };
        this.fsOps = options.fsOps ?? DEFAULT_FS_OPS;
        this.nowFn = options.now ?? (() => Date.now());
        this.latestSnapshot = {
            backendEpoch: this.backendEpoch,
            nodesById: new Map(),
            groupsByRootId: new Map(),
            anomalies: [],
            lastSweepAtMs: 0,
            cursorCompletedFullPass: false,
            scannedDirsInLastSweep: 0,
            bytesReadInLastSweep: 0,
            localScanDisabled: resolveScopedBrainRoot(this.scope) === null,
        };
    }

    public getSweepCursor(): string | null {
        return this.sweepCursor;
    }

    public getCachedManifestCount(): number {
        return this.manifestCache.size;
    }

    public setBackendEpoch(epoch: number): void {
        if (epoch !== this.backendEpoch) {
            this.backendEpoch = epoch;
            this.rpcLinksByKey.clear();
            this.lastBranchRevisionByCascade.clear();
        }
    }

    /**
     * Ingest privacy-safe typed subagent/swarm link projections from already-authorized RPC steps.
     * Invalidates links from prior backend epochs or superseded branch revisions.
     */
    public ingestRpcProjections(
        links: ReadonlyArray<RpcTopologyLinkProjection>,
        backendEpoch: number,
        branchRevisionByCascade?: ReadonlyMap<string, string>,
    ): void {
        if (backendEpoch !== this.backendEpoch) {
            this.setBackendEpoch(backendEpoch);
        }
        if (branchRevisionByCascade) {
            for (const [cid, rev] of branchRevisionByCascade.entries()) {
                const prevRev = this.lastBranchRevisionByCascade.get(cid);
                if (prevRev !== undefined && prevRev !== rev) {
                    // Branch/content changed (e.g. fork, equal-length edit, rewind): expire stale links from this parent!
                    for (const [k, existing] of this.rpcLinksByKey.entries()) {
                        if (existing.parentCascadeId === cid && existing.branchRevision !== rev) {
                            this.rpcLinksByKey.delete(k);
                        }
                    }
                }
                this.lastBranchRevisionByCascade.set(cid, rev);
            }
        }
        for (const link of links) {
            const parentId = typeof link.parentCascadeId === 'string' ? link.parentCascadeId.trim() : '';
            const childId = typeof link.childCascadeId === 'string' ? link.childCascadeId.trim() : '';
            if (!parentId || !childId) { continue; }
            const key = `${parentId}->${childId}`;
            const curRev = branchRevisionByCascade?.get(parentId) ?? link.branchRevision;
            if (link.branchRevision && curRev && link.branchRevision !== curRev) {
                continue;
            }
            const prev = this.rpcLinksByKey.get(key);
            if (!prev || link.observedAtMs >= prev.observedAtMs) {
                this.rpcLinksByKey.set(key, {
                    parentCascadeId: parentId,
                    childCascadeId: childId,
                    kind: link.kind,
                    observedAtMs: link.observedAtMs,
                    ...(link.branchRevision ? { branchRevision: link.branchRevision } : {}),
                    ...(link.memberName ? { memberName: boundedString(link.memberName, this.budgets.maxStringLength) } : {}),
                    ...(link.assignedRole ? { assignedRole: boundedString(link.assignedRole, 64) } : {}),
                });
            }
        }
    }

    private touchCacheEntry(key: string, entry: CachedManifestEntry): void {
        if (this.manifestCache.has(key)) {
            this.manifestCache.delete(key);
        }
        this.manifestCache.set(key, entry);
        while (this.manifestCache.size > this.budgets.maxCachedManifests) {
            const oldestKey = this.manifestCache.keys().next().value;
            if (oldestKey === undefined) { break; }
            this.manifestCache.delete(oldestKey);
        }
    }

    /**
     * Perform one bounded read-only sweep of `<brainRoot>/<cascadeId>/.system_generated/swarm/{members.json,swarm.json}`:
     * - Honors Remote-SSH / WSL scoping guard (`resolveScopedBrainRoot`).
     * - Bounded to `maxDirsPerSweep` (200) per call with a persistent continuation cursor
     *   so directories beyond #200 are never permanently starved.
     * - Enforces `maxTotalBytesPerSweep`, `maxFileBytes` (<=512 KB), `maxConcurrentOpens`,
     *   `maxSweepElapsedMs`, and `maxCachedManifests`.
     * - Tracks manifest files directly (detecting same-size/same-mtime in-place changes via SHA-256
     *   and manifest deletions via ENOENT).
     * - Keeps last valid manifest for `partialJsonGraceTtlMs` during partial/corrupt writes, then marks stale.
     */
    public async sweepManifests(options: SweepManifestsOptions = {}): Promise<SweepManifestsResult> {
        const clockStart = performance.now();
        const startMs = options.nowMs ?? this.nowFn();
        const elapsed = () => performance.now() - clockStart;
        const brainRoot = resolveScopedBrainRoot(this.scope);
        this.sweepAnomalies.length = 0;

        const emptySweep = (localScanDisabled: boolean): SweepManifestsResult => ({
            scannedDirs: 0, manifestsRead: 0, manifestsChanged: 0, manifestsDeleted: 0, bytesRead: 0,
            cursorAfter: this.sweepCursor, completedFullPass: false, localScanDisabled, anomalies: [],
        });

        if (!brainRoot) {
            this.localScanDisabled = true;
            this.lastSweepAtMs = startMs;
            this.lastScannedDirs = 0;
            this.lastBytesRead = 0;
            this.lastCompletedFullPass = false;
            return emptySweep(true);
        }

        this.localScanDisabled = false;
        let allEntries: string[];
        try {
            allEntries = await this.fsOps.readdir(brainRoot);
        } catch {
            this.lastSweepAtMs = startMs;
            return emptySweep(false);
        }

        const safeDirs = allEntries.filter(isSafeCascadeIdSegment).sort(compareCodeUnit);
        const safeDirSet = new Set(safeDirs);

        // Immediately evict cached manifests whose parent cascade directory disappeared
        let manifestsDeleted = 0;
        for (const [key, cached] of [...this.manifestCache.entries()]) {
            if (!safeDirSet.has(cached.manifestDirId)) {
                this.manifestCache.delete(key);
                manifestsDeleted++;
            }
        }

        // Build bounded dir batch: priority cascadeIds first (capped to <=25% of budget so cursor always advances!)
        const selectedDirs: string[] = [];
        const selectedSet = new Set<string>();
        const priorityCap = Math.min(this.budgets.maxDirsPerSweep - 1, Math.max(1, Math.floor(this.budgets.maxDirsPerSweep * 0.25)));
        if (options.priorityCascadeIds) {
            for (const cid of options.priorityCascadeIds) {
                if (selectedDirs.length >= priorityCap) { break; }
                if (isSafeCascadeIdSegment(cid) && safeDirSet.has(cid) && !selectedSet.has(cid)) {
                    selectedSet.add(cid);
                    selectedDirs.push(cid);
                }
            }
        }

        // Continue in exact UTF-16 code-unit order strictly after `this.sweepCursor`
        const prevCursor = this.sweepCursor;
        let cursorStartIdx = 0;
        if (prevCursor !== null) {
            cursorStartIdx = safeDirs.findIndex(d => d > prevCursor);
            if (cursorStartIdx < 0) {
                cursorStartIdx = 0;
            }
        }

        const cursorSlice: string[] = [];
        let reachedEnd = safeDirs.length === 0;
        const remainingDirSlots = Math.max(1, this.budgets.maxDirsPerSweep - selectedDirs.length);

        for (let idx = cursorStartIdx; idx < safeDirs.length && cursorSlice.length < remainingDirSlots; idx++) {
            const dirName = safeDirs[idx];
            cursorSlice.push(dirName);
            if (!selectedSet.has(dirName)) {
                selectedSet.add(dirName);
                selectedDirs.push(dirName);
            }
            if (idx === safeDirs.length - 1) {
                reachedEnd = true;
            }
        }

        let scannedDirs = 0;
        let manifestsRead = 0;
        let manifestsChanged = 0;
        let bytesRead = 0;
        let reservedBytes = 0;
        let budgetExhaustedEarly = false;
        const completedDirs = new Set<string>();
        const anomalies: TopologyAnomaly[] = [];

        const processDir = async (dirId: string): Promise<void> => {
            const nowMs = options.nowMs ?? this.nowFn();
            if (bytesRead >= this.budgets.maxTotalBytesPerSweep
                || elapsed() >= this.budgets.maxSweepElapsedMs) {
                budgetExhaustedEarly = true;
                return;
            }
            scannedDirs++;

            let abortedMidDir = false;
            const filenames: ReadonlyArray<'members.json' | 'swarm.json'> = ['members.json', 'swarm.json'];
            for (const filename of filenames) {
                const remainingSweepBytes = this.budgets.maxTotalBytesPerSweep - bytesRead;
                if (remainingSweepBytes <= 0 || elapsed() >= this.budgets.maxSweepElapsedMs) {
                    budgetExhaustedEarly = true;
                    abortedMidDir = true;
                    break;
                }
                const cacheKey = `${dirId}/${filename}`;
                const prev = this.manifestCache.get(cacheKey);
                const cappedBySweepBudget = remainingSweepBytes < this.budgets.maxFileBytes;
                let reserved = 0;
                const readRes = await safeReadManifestFile(brainRoot, dirId, filename, {
                    maxFileBytes: Math.min(this.budgets.maxFileBytes, remainingSweepBytes),
                    reserveBytes: count => {
                        if (bytesRead + reservedBytes + count > this.budgets.maxTotalBytesPerSweep) { return false; }
                        reservedBytes += count;
                        reserved = count;
                        return true;
                    },
                    fsOps: this.fsOps,
                });
                reservedBytes -= reserved;
                bytesRead += readRes.bytesRead;

                if (!readRes.ok) {
                    if (readRes.reason === 'sweep_budget' || (readRes.reason === 'file_too_large' && cappedBySweepBudget)) {
                        // File exceeded remaining sweep byte budget (NOT necessarily >512 KB hard file cap):
                        // abort cleanly without marking the manifest unsafe or evicting cached data!
                        budgetExhaustedEarly = true;
                        abortedMidDir = true;
                        break;
                    }
                    if (readRes.reason === 'not_found') {
                        if (prev) {
                            this.manifestCache.delete(cacheKey);
                            manifestsDeleted++;
                        }
                    } else if (
                        readRes.reason === 'symlink_or_junction'
                        || readRes.reason === 'file_too_large'
                        || readRes.reason === 'identity_mismatch'
                        || readRes.reason === 'not_regular_file'
                    ) {
                        anomalies.push({
                            kind: 'unsafe_manifest_skipped',
                            manifestDirId: dirId,
                            detail: `${filename}: ${readRes.reason}`,
                        });
                        if (prev) {
                            this.manifestCache.delete(cacheKey);
                            manifestsDeleted++;
                        }
                    }
                    continue;
                }

                manifestsRead++;
                const changed = !prev || prev.sha256 !== readRes.sha256;

                // Always parse (or reuse if identical SHA-256 and previously valid)
                if (prev && !changed && !prev.isPartialCorrupt) {
                    prev.lastCheckedAtMs = nowMs;
                    prev.lastValidAtMs = nowMs;
                    prev.mtimeMs = readRes.mtimeMs;
                    prev.ctimeMs = readRes.ctimeMs;
                    prev.dev = readRes.dev;
                    prev.ino = readRes.ino;
                    prev.isStale = false;
                    this.touchCacheEntry(cacheKey, prev);
                    continue;
                }

                const parsed = parseAllowedManifestJson(readRes.rawText, dirId, filename, {
                    maxMembersPerManifest: this.budgets.maxMembersPerManifest,
                    maxStringLength: this.budgets.maxStringLength,
                });

                if (parsed.ok) {
                    const historical = prev
                        ? new Map(prev.historicalMembersById)
                        : new Map<string, ParsedAllowedManifestMember>();
                    if (prev) {
                        // Retain killed/replaced members when a memberName is recreated with a different conversation_id
                        const nextIds = new Set(parsed.manifest.members.map(m => m.conversationId));
                        for (const oldMember of prev.manifest.members) {
                            if (!nextIds.has(oldMember.conversationId)) {
                                historical.set(oldMember.conversationId, { ...oldMember, killed: true });
                            }
                        }
                        for (const newMember of parsed.manifest.members) {
                            historical.delete(newMember.conversationId);
                        }
                    }
                    const entry: CachedManifestEntry = {
                        key: cacheKey,
                        manifestDirId: dirId,
                        filename,
                        manifest: parsed.manifest,
                        sha256: readRes.sha256,
                        dev: readRes.dev,
                        ino: readRes.ino,
                        size: readRes.size,
                        mtimeMs: readRes.mtimeMs,
                        ctimeMs: readRes.ctimeMs,
                        lastValidAtMs: nowMs,
                        lastCheckedAtMs: nowMs,
                        isPartialCorrupt: false,
                        isStale: false,
                        historicalMembersById: historical,
                    };
                    this.touchCacheEntry(cacheKey, entry);
                    if (changed) {
                        manifestsChanged++;
                    }
                } else {
                    // Partial / corrupt JSON write: preserve last valid manifest within bounded grace TTL, then mark stale!
                    if (prev) {
                        const ageMs = Math.max(0, nowMs - prev.lastValidAtMs);
                        prev.lastCheckedAtMs = nowMs;
                        prev.isPartialCorrupt = true;
                        prev.isStale = ageMs > this.budgets.partialJsonGraceTtlMs;
                        this.touchCacheEntry(cacheKey, prev);
                        if (prev.isStale) {
                            anomalies.push({
                                kind: 'stale_manifest',
                                manifestDirId: dirId,
                                detail: `${filename} corrupt/partial beyond TTL (${ageMs}ms > ${this.budgets.partialJsonGraceTtlMs}ms)`,
                            });
                        }
                    } else {
                        anomalies.push({
                            kind: 'stale_manifest',
                            manifestDirId: dirId,
                            detail: `${filename} unreadable JSON: ${parsed.error}`,
                        });
                    }
                }
            }

            if (!abortedMidDir) {
                completedDirs.add(dirId);
            }
        };

        // Bounded concurrency pool (`<= maxConcurrentOpens`)
        let nextIndex = 0;
        const workers: Promise<void>[] = [];
        const concurrency = Math.min(this.budgets.maxConcurrentOpens, Math.max(1, selectedDirs.length));
        for (let w = 0; w < concurrency; w++) {
            workers.push((async () => {
                while (nextIndex < selectedDirs.length) {
                    const idx = nextIndex++;
                    const dirId = selectedDirs[idx];
                    await processDir(dirId);
                    if (budgetExhaustedEarly) {
                        break;
                    }
                }
            })());
        }
        await Promise.all(workers);

        // Advance `this.sweepCursor` ONLY across the contiguous completed prefix of `cursorSlice`,
        // so priority dirs overlapping later in the slice or out-of-order concurrent completions
        // NEVER jump the cursor past unscanned earlier directories!
        let contiguousCursorIdx = -1;
        for (let i = 0; i < cursorSlice.length; i++) {
            if (!completedDirs.has(cursorSlice[i])) {
                break;
            }
            contiguousCursorIdx = i;
        }

        const completedFullPass = safeDirs.length === 0
            || (reachedEnd && cursorSlice.length > 0 && contiguousCursorIdx === cursorSlice.length - 1);
        this.sweepCursor = completedFullPass
            ? null
            : (contiguousCursorIdx >= 0 ? cursorSlice[contiguousCursorIdx] : prevCursor);
        this.lastSweepAtMs = startMs;
        this.lastScannedDirs = scannedDirs;
        this.lastBytesRead = bytesRead;
        this.lastCompletedFullPass = completedFullPass;
        this.sweepAnomalies.push(...anomalies);

        return {
            scannedDirs,
            manifestsRead,
            manifestsChanged,
            manifestsDeleted,
            bytesRead,
            cursorAfter: this.sweepCursor,
            completedFullPass,
            localScanDisabled: false,
            anomalies,
        };
    }

    /**
     * Reconcile cached manifests, RPC projections, trajectory metadata, and worktree
     * heuristics into an authoritative `SwarmTopologySnapshot`.
     */
    public reconcile(input: ReconcileTopologyInput): SwarmTopologySnapshot {
        const nowMs = input.nowMs ?? this.nowFn();
        if (input.backendEpoch !== this.backendEpoch) {
            this.setBackendEpoch(input.backendEpoch);
        }
        if (input.rpcLinks && input.rpcLinks.length > 0) {
            this.ingestRpcProjections(input.rpcLinks, input.backendEpoch, input.branchRevisionByCascade);
        } else if (input.branchRevisionByCascade) {
            this.ingestRpcProjections([], input.backendEpoch, input.branchRevisionByCascade);
        }

        const trajectories = Array.isArray(input.trajectories) ? input.trajectories : [];
        const trajById = new Map<string, TopologyTrajectoryInput>();
        for (const t of trajectories) {
            const id = typeof t?.cascadeId === 'string' ? t.cascadeId.trim() : '';
            if (id && !trajById.has(id)) {
                trajById.set(id, t);
            }
        }
        const deletedIds = input.deletedConversationIds ?? new Set<string>();

        const anomalies: TopologyAnomaly[] = [...this.sweepAnomalies];

        // Refresh stale TTL flags on cached partial-corrupt manifests at current `nowMs`
        for (const entry of this.manifestCache.values()) {
            if (entry.isPartialCorrupt) {
                const ageMs = Math.max(0, nowMs - entry.lastValidAtMs);
                entry.isStale = ageMs > this.budgets.partialJsonGraceTtlMs;
                if (entry.isStale) {
                    anomalies.push({
                        kind: 'stale_manifest',
                        manifestDirId: entry.manifestDirId,
                        detail: `${entry.filename} stale after partial write (${ageMs}ms)`,
                    });
                }
            }
        }

        // 1. Group manifests by directory (deterministic precedence: `members.json` > `swarm.json`)
        interface ResolvedDirManifest {
            manifestDirId: string;
            title?: string;
            primaryCoordinatorId: string;
            coordinatorIds: string[];
            members: ParsedAllowedManifestMember[];
            historicalMembers: ParsedAllowedManifestMember[];
            mtimeMs: number;
            lastValidAtMs: number;
            isStale: boolean;
            hasConflict: boolean;
            conflictDetails: string[];
        }

        const byDir = new Map<string, { membersJson?: CachedManifestEntry; swarmJson?: CachedManifestEntry }>();
        for (const entry of this.manifestCache.values()) {
            const bucket = byDir.get(entry.manifestDirId) ?? {};
            if (entry.filename === 'members.json') {
                bucket.membersJson = entry;
            } else {
                bucket.swarmJson = entry;
            }
            byDir.set(entry.manifestDirId, bucket);
        }

        const resolvedManifests: ResolvedDirManifest[] = [];
        for (const [dirId, pair] of [...byDir.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            const primary = pair.membersJson ?? pair.swarmJson;
            if (!primary) { continue; }
            let hasConflict = false;
            const conflictDetails: string[] = [];

            // Detect conflicts between members.json and swarm.json in the same directory
            if (pair.membersJson && pair.swarmJson) {
                const m1Ids = new Set(pair.membersJson.manifest.members.map(m => `${m.conversationId}:${m.role ?? ''}`));
                const m2Ids = new Set(pair.swarmJson.manifest.members.map(m => `${m.conversationId}:${m.role ?? ''}`));
                const differs = m1Ids.size !== m2Ids.size || [...m1Ids].some(x => !m2Ids.has(x));
                if (differs) {
                    hasConflict = true;
                    conflictDetails.push(`members.json and swarm.json disagree in ${dirId}; members.json takes precedence`);
                    anomalies.push({
                        kind: 'conflicting_manifest',
                        manifestDirId: dirId,
                        detail: 'members.json and swarm.json disagree; members.json chosen',
                    });
                }
            }

            const members = primary.manifest.members;
            const historicalMembers = [...primary.historicalMembersById.values()];
            const coordinators = members.filter(m => classifyAssignedRole(m.role) === 'coordinator');

            let primaryCoordinatorId = dirId;
            if (coordinators.length === 0) {
                anomalies.push({
                    kind: 'zero_coordinators',
                    manifestDirId: dirId,
                    detail: `Manifest in ${dirId} declares 0 coordinators`,
                });
                primaryCoordinatorId = dirId;
            } else if (coordinators.length > 1) {
                hasConflict = true;
                const coordIds = coordinators.map(c => c.conversationId);
                conflictDetails.push(`Multiple coordinators declared: ${coordIds.join(', ')}`);
                anomalies.push({
                    kind: 'multiple_coordinators',
                    manifestDirId: dirId,
                    detail: `Multiple coordinators (${coordIds.length}) in ${dirId}`,
                });
                // Deterministic choice: dirId match > active non-killed > lexicographically smallest
                const sortedCoords = [...coordinators].sort((a, b) => {
                    const aDir = a.conversationId === dirId ? 0 : 1;
                    const bDir = b.conversationId === dirId ? 0 : 1;
                    if (aDir !== bDir) { return aDir - bDir; }
                    const aKilled = a.killed ? 1 : 0;
                    const bKilled = b.killed ? 1 : 0;
                    if (aKilled !== bKilled) { return aKilled - bKilled; }
                    return a.conversationId.localeCompare(b.conversationId);
                });
                primaryCoordinatorId = sortedCoords[0].conversationId;
            } else {
                primaryCoordinatorId = coordinators[0].conversationId;
            }

            // Detect duplicate member names across active + historical members in the same manifest
            const idsByName = new Map<string, Set<string>>();
            for (const m of [...members, ...historicalMembers]) {
                const set = idsByName.get(m.memberName) ?? new Set<string>();
                set.add(m.conversationId);
                idsByName.set(m.memberName, set);
            }
            for (const [name, idSet] of idsByName.entries()) {
                if (idSet.size > 1) {
                    anomalies.push({
                        kind: 'duplicate_member_name',
                        manifestDirId: dirId,
                        detail: `Member name "${name}" maps to ${idSet.size} distinct cascadeIds`,
                    });
                }
            }

            resolvedManifests.push({
                manifestDirId: dirId,
                title: primary.manifest.title,
                primaryCoordinatorId,
                coordinatorIds: coordinators.map(c => c.conversationId),
                members,
                historicalMembers,
                mtimeMs: primary.mtimeMs,
                lastValidAtMs: primary.lastValidAtMs,
                isStale: primary.isStale,
                hasConflict,
                conflictDetails,
            });
        }

        // 2. Build membership claims per cascadeId across all manifests to detect:
        //    - Nested sub-swarms (worker in outer swarm A is coordinator of inner swarm B)
        //    - Conflicting manifests (two distinct non-nested manifests claim same worker)
        interface ManifestMemberClaim {
            manifest: ResolvedDirManifest;
            member: ParsedAllowedManifestMember;
            isHistorical: boolean;
            isCoordinatorRole: boolean;
        }

        const claimsByCascade = new Map<string, ManifestMemberClaim[]>();
        const manifestByCoordinator = new Map<string, ResolvedDirManifest>();
        for (const m of resolvedManifests) {
            if (!manifestByCoordinator.has(m.primaryCoordinatorId)) {
                manifestByCoordinator.set(m.primaryCoordinatorId, m);
            }
            for (const mem of m.members) {
                const list = claimsByCascade.get(mem.conversationId) ?? [];
                list.push({
                    manifest: m,
                    member: mem,
                    isHistorical: false,
                    isCoordinatorRole: classifyAssignedRole(mem.role) === 'coordinator',
                });
                claimsByCascade.set(mem.conversationId, list);
            }
            for (const hist of m.historicalMembers) {
                const list = claimsByCascade.get(hist.conversationId) ?? [];
                list.push({
                    manifest: m,
                    member: hist,
                    isHistorical: true,
                    isCoordinatorRole: classifyAssignedRole(hist.role) === 'coordinator',
                });
                claimsByCascade.set(hist.conversationId, list);
            }
        }

        // Identify nested sub-swarm links: innerCoordinator -> outerCoordinator
        const nestedSubSwarmParent = new Map<string, string>();
        for (const [cid, claims] of claimsByCascade.entries()) {
            const coordClaim = claims.find(c => c.isCoordinatorRole && c.manifest.primaryCoordinatorId === cid);
            const outerWorkerClaims = claims.filter(c => !c.isCoordinatorRole && c.manifest.primaryCoordinatorId !== cid);
            if (coordClaim && outerWorkerClaims.length > 0) {
                const sortedOuter = [...outerWorkerClaims].sort((a, b) =>
                    (Number(a.member.killed) - Number(b.member.killed))
                    || (b.manifest.mtimeMs - a.manifest.mtimeMs)
                    || a.manifest.manifestDirId.localeCompare(b.manifest.manifestDirId),
                );
                const outerCoord = sortedOuter[0].manifest.primaryCoordinatorId;
                nestedSubSwarmParent.set(cid, outerCoord);
                anomalies.push({
                    kind: 'nested_sub_swarm',
                    cascadeId: cid,
                    rootId: outerCoord,
                    detail: `Worker ${cid} coordinates nested sub-swarm under ${outerCoord}`,
                });
            }
        }

        // 3. Construct base nodes map keyed strictly by cascadeId
        const nodes = new Map<string, SwarmMemberNode>();

        // 3a. Materialize manifest-backed nodes (highest authority: confidence 0.95)
        for (const [cid, claims] of claimsByCascade.entries()) {
            // Separate own coordinator claim vs non-coordinator membership claims
            const nonCoordClaims = claims.filter(c => !(c.isCoordinatorRole && c.manifest.primaryCoordinatorId === cid));
            const ownCoordClaim = claims.find(c => c.isCoordinatorRole && c.manifest.primaryCoordinatorId === cid);

            let winningClaim: ManifestMemberClaim;
            let hasConflict = false;
            const conflictDetails: string[] = [];

            if (ownCoordClaim && nonCoordClaims.length === 0) {
                winningClaim = ownCoordClaim;
            } else if (ownCoordClaim && nonCoordClaims.length > 0) {
                // Worker coordinating a nested sub-swarm: outer membership anchors group membership,
                // while `isCoordinator: true` preserves its sub-swarm coordinator identity!
                const sortedOuter = [...nonCoordClaims].sort((a, b) =>
                    (Number(a.isHistorical) - Number(b.isHistorical))
                    || (Number(a.member.killed) - Number(b.member.killed))
                    || (b.manifest.mtimeMs - a.manifest.mtimeMs)
                    || a.manifest.manifestDirId.localeCompare(b.manifest.manifestDirId),
                );
                winningClaim = sortedOuter[0];
            } else {
                const sorted = [...claims].sort((a, b) => {
                    const aHist = a.isHistorical ? 1 : 0;
                    const bHist = b.isHistorical ? 1 : 0;
                    if (aHist !== bHist) { return aHist - bHist; }
                    const aKilled = a.member.killed ? 1 : 0;
                    const bKilled = b.member.killed ? 1 : 0;
                    if (aKilled !== bKilled) { return aKilled - bKilled; }
                    const aMatchDir = a.manifest.primaryCoordinatorId === a.manifest.manifestDirId ? 0 : 1;
                    const bMatchDir = b.manifest.primaryCoordinatorId === b.manifest.manifestDirId ? 0 : 1;
                    if (aMatchDir !== bMatchDir) { return aMatchDir - bMatchDir; }
                    if (b.manifest.mtimeMs !== a.manifest.mtimeMs) {
                        return b.manifest.mtimeMs - a.manifest.mtimeMs;
                    }
                    return a.manifest.manifestDirId.localeCompare(b.manifest.manifestDirId);
                });
                winningClaim = sorted[0];
                // Detect conflicting distinct manifests claiming the same member
                const distinctManifestDirs = new Set(claims.map(c => c.manifest.manifestDirId));
                if (distinctManifestDirs.size > 1) {
                    hasConflict = true;
                    conflictDetails.push(
                        `Claimed by multiple manifests (${[...distinctManifestDirs].join(', ')}); chose ${winningClaim.manifest.manifestDirId}`,
                    );
                    anomalies.push({
                        kind: 'conflicting_manifest',
                        cascadeId: cid,
                        manifestDirId: winningClaim.manifest.manifestDirId,
                        detail: `Cascade claimed by ${distinctManifestDirs.size} manifests`,
                    });
                }
            }

            if (winningClaim.manifest.hasConflict) {
                hasConflict = true;
                conflictDetails.push(...winningClaim.manifest.conflictDetails);
            }

            const mem = winningClaim.member;
            const roleClass = classifyAssignedRole(mem.role);
            const hasUnknownRole = roleClass === 'unknown';
            if (hasUnknownRole) {
                anomalies.push({
                    kind: 'unknown_role',
                    cascadeId: cid,
                    manifestDirId: winningClaim.manifest.manifestDirId,
                    detail: `Unrecognized manifest role "${mem.role}" (NOT auto-classified as worker)`,
                });
            }

            const immediateCoordId = winningClaim.manifest.primaryCoordinatorId;
            const isNestedHelper = immediateCoordId !== cid && nestedSubSwarmParent.has(immediateCoordId);
            const relationshipKind: SwarmRelationshipKind = isNestedHelper ? 'nested_helper' : 'swarm_member';

            // Duplicate name detection inside winning manifest
            const sameNameCount = new Set(
                [...winningClaim.manifest.members, ...winningClaim.manifest.historicalMembers]
                    .filter(x => x.memberName === mem.memberName)
                    .map(x => x.conversationId),
            ).size;

            const isCoordNode = Boolean(ownCoordClaim) || (roleClass === 'coordinator' && immediateCoordId === cid);
            const freshnessMs = Math.max(0, nowMs - winningClaim.manifest.lastValidAtMs);

            nodes.set(cid, {
                cascadeId: cid,
                // Flat membership list establishes group membership, NOT necessarily direct parentage
                // (except nested sub-swarm helpers whose immediate sub-swarm coordinator is known).
                directParentId: isNestedHelper ? immediateCoordId : null,
                rootId: immediateCoordId,
                relationshipKind,
                evidenceSource: 'manifest',
                confidence: winningClaim.manifest.isStale ? 0.6 : 0.95,
                freshnessMs,
                memberName: mem.memberName,
                assignedRole: mem.role,
                assignedModel: mem.appliedModel ?? mem.model,
                ...(mem.appliedModel ? { appliedModel: mem.appliedModel } : {}),
                phase: mem.phase,
                killed: mem.killed,
                workspaceMode: mem.workspaceMode,
                ...(mem.workspaceDisplay ? { workspaceDisplay: mem.workspaceDisplay } : {}),
                ...(isCoordNode ? { isCoordinator: true } : {}),
                ...(isNestedHelper ? { subSwarmCoordinatorId: immediateCoordId } : {}),
                ...(hasConflict ? { hasConflict: true, conflictDetails } : {}),
                ...(winningClaim.manifest.isStale ? { isStaleManifest: true } : {}),
                ...(hasUnknownRole ? { hasUnknownRole: true } : {}),
                ...(sameNameCount > 1 ? { duplicateNameConflict: true } : {}),
            });
        }

        // 3b. Merge RPC step link projections (confidence 0.9; supplies directParentId without overriding manifest coordinator)
        for (const link of this.rpcLinksByKey.values()) {
            const existing = nodes.get(link.childCascadeId);
            const freshnessMs = Math.max(0, nowMs - link.observedAtMs);
            if (existing) {
                // Enrich flat manifest member with directParentId if RPC observed the spawn directly
                if (!existing.isCoordinator && existing.directParentId === null && link.parentCascadeId !== link.childCascadeId) {
                    existing.directParentId = link.parentCascadeId;
                    if (nodes.has(link.parentCascadeId) && !nodes.get(link.parentCascadeId)!.isCoordinator) {
                        existing.relationshipKind = 'nested_helper';
                    }
                }
                continue;
            }
            const parentNode = nodes.get(link.parentCascadeId);
            const isNested = link.kind === 'nested_helper'
                || Boolean(parentNode && !parentNode.isCoordinator && parentNode.rootId !== link.parentCascadeId);
            const roleClass = classifyAssignedRole(link.assignedRole);
            const hasUnknownRole = roleClass === 'unknown';
            if (hasUnknownRole) {
                anomalies.push({
                    kind: 'unknown_role',
                    cascadeId: link.childCascadeId,
                    detail: `Unrecognized RPC role "${link.assignedRole}"`,
                });
            }
            nodes.set(link.childCascadeId, {
                cascadeId: link.childCascadeId,
                directParentId: link.parentCascadeId,
                rootId: link.parentCascadeId,
                relationshipKind: isNested ? 'nested_helper' : (link.kind === 'swarm_member' ? 'swarm_member' : 'direct_subagent'),
                evidenceSource: 'rpc_step',
                confidence: 0.9,
                freshnessMs,
                ...(link.memberName ? { memberName: link.memberName } : {}),
                ...(link.assignedRole ? { assignedRole: link.assignedRole } : {}),
                ...(hasUnknownRole ? { hasUnknownRole: true } : {}),
            });
        }

        // 3c. Merge trajectory metadata & worktree heuristics (never overriding explicit coordinator!)
        for (const traj of trajectories) {
            const cid = traj.cascadeId.trim();
            if (!cid) { continue; }
            const existing = nodes.get(cid);
            const explicitRole = extractTrajectoryExplicitRole(traj);
            const roleClass = classifyAssignedRole(explicitRole);
            const fork = isTrajectoryFork(traj);
            const parentId = extractTrajectoryParentId(traj);
            const worktreeInfo = extractWorktreeParentCandidate(traj);

            if (existing) {
                // Update killed flag from live trajectory if explicitly killed
                if (traj.killed === true) {
                    existing.killed = true;
                }
                // Populate directParentId for non-coordinator nodes when trajectory metadata supplies one
                if (!existing.isCoordinator && !fork && existing.directParentId === null && parentId) {
                    existing.directParentId = parentId;
                }
                continue;
            }

            // Forked chat retaining parentId -> independent root, NOT a subagent!
            if (fork) {
                if (parentId) {
                    anomalies.push({
                        kind: 'fork_with_parent',
                        cascadeId: cid,
                        rootId: cid,
                        detail: `Forked chat retains parentId=${parentId}; treated as independent root`,
                    });
                }
                nodes.set(cid, {
                    cascadeId: cid,
                    directParentId: parentId,
                    rootId: cid,
                    relationshipKind: 'fork',
                    evidenceSource: 'trajectory_meta',
                    confidence: 0.85,
                    freshnessMs: 0,
                    ...(explicitRole ? { assignedRole: explicitRole } : {}),
                    killed: traj.killed === true,
                });
                continue;
            }

            // Explicit coordinator role in trajectory metadata -> NEVER overridden by worktree/branch heuristics!
            if (roleClass === 'coordinator') {
                nodes.set(cid, {
                    cascadeId: cid,
                    directParentId: null,
                    rootId: cid,
                    relationshipKind: 'swarm_member',
                    isCoordinator: true,
                    evidenceSource: 'trajectory_meta',
                    confidence: 0.85,
                    freshnessMs: 0,
                    assignedRole: explicitRole,
                    killed: traj.killed === true,
                });
                continue;
            }

            // Unknown explicit role -> record anomaly, DO NOT auto-classify as worker!
            if (roleClass === 'unknown') {
                anomalies.push({
                    kind: 'unknown_role',
                    cascadeId: cid,
                    detail: `Unrecognized trajectory role "${explicitRole}" (NOT auto-classified as worker)`,
                });
                if (parentId) {
                    nodes.set(cid, {
                        cascadeId: cid,
                        directParentId: parentId,
                        rootId: parentId,
                        relationshipKind: 'direct_subagent',
                        evidenceSource: 'trajectory_meta',
                        confidence: 0.5,
                        freshnessMs: 0,
                        assignedRole: explicitRole,
                        hasUnknownRole: true,
                        killed: traj.killed === true,
                    });
                }
                continue;
            }

            // Structured subagent/worker trajectory metadata
            const meta = asPlainObject(traj.trajectoryMetadata);
            const spawnedBy = typeof traj.spawnedBy === 'string'
                ? traj.spawnedBy.trim()
                : (typeof meta?.spawnedBy === 'string' ? meta.spawnedBy.trim() : '');
            const spawnedByAgent = spawnedBy.length > 0
                && !/^(?:user|human|manual|fork)$/i.test(spawnedBy);
            const isExplicitSub = traj.isSubagent === true
                || meta?.isSubagent === true
                || meta?.isChild === true
                || roleClass === 'worker'
                || spawnedByAgent
                || parentId !== null;

            if (isExplicitSub) {
                const resolvedParent = parentId ?? worktreeInfo.worktreeParentId;
                nodes.set(cid, {
                    cascadeId: cid,
                    directParentId: resolvedParent,
                    rootId: resolvedParent ?? cid,
                    relationshipKind: roleClass === 'worker' && traj.swarmId ? 'swarm_member' : 'direct_subagent',
                    evidenceSource: 'trajectory_meta',
                    confidence: 0.8,
                    freshnessMs: 0,
                    ...(explicitRole ? { assignedRole: explicitRole } : {}),
                    killed: traj.killed === true,
                });
                continue;
            }

            // Lowest-priority heuristic: Antigravity swarm worktree path / swarm-* branch
            if (worktreeInfo.isWorktreeWorker) {
                nodes.set(cid, {
                    cascadeId: cid,
                    directParentId: worktreeInfo.worktreeParentId,
                    rootId: worktreeInfo.worktreeParentId ?? cid,
                    relationshipKind: 'swarm_member',
                    evidenceSource: 'worktree',
                    confidence: 0.45,
                    freshnessMs: 0,
                    workspaceMode: 'share',
                    killed: traj.killed === true,
                });
            }
        }

        // 4. Cycle-safe root resolution, nested helper promotion, orphan & deleted-coordinator detection
        const knownLiveOrManifestIds = new Set<string>([...trajById.keys(), ...nodes.keys()]);
        const MAX_DEPTH = 32;

        const resolveUpward = (startId: string): { rootId: string; cycleDetected: boolean; cyclePath: string[]; depth: number } => {
            const visited = new Set<string>([startId]);
            const pathIds: string[] = [startId];
            let currentId = startId;
            let depth = 0;

            while (depth < MAX_DEPTH) {
                const node = nodes.get(currentId);
                if (!node) {
                    break;
                }
                // Fork is always its own root
                if (node.relationshipKind === 'fork') {
                    return { rootId: currentId, cycleDetected: false, cyclePath: [], depth };
                }

                // Determine next hop upward
                let nextId: string | null = null;
                if (nestedSubSwarmParent.has(currentId)) {
                    nextId = nestedSubSwarmParent.get(currentId)!;
                } else if (node.isCoordinator && node.rootId === currentId) {
                    break;
                } else if (node.directParentId && node.directParentId !== currentId) {
                    nextId = node.directParentId;
                } else if (node.rootId && node.rootId !== currentId) {
                    nextId = node.rootId;
                }

                if (!nextId) {
                    break;
                }

                if (visited.has(nextId)) {
                    // Cycle detected! Pick deterministic root inside the cycle
                    const cycleStart = pathIds.indexOf(nextId);
                    const cycleMembers = cycleStart >= 0 ? pathIds.slice(cycleStart) : [...visited];
                    const explicitCoord = cycleMembers
                        .filter(id => nodes.get(id)?.isCoordinator)
                        .sort((a, b) => a.localeCompare(b))[0];
                    const chosenRoot = explicitCoord ?? [...cycleMembers].sort((a, b) => a.localeCompare(b))[0];
                    return { rootId: chosenRoot, cycleDetected: true, cyclePath: cycleMembers, depth };
                }

                visited.add(nextId);
                pathIds.push(nextId);
                currentId = nextId;
                depth++;
            }

            return { rootId: currentId, cycleDetected: false, cyclePath: [], depth };
        };

        const recordedCycleKeys = new Set<string>();
        for (const node of nodes.values()) {
            const res = resolveUpward(node.cascadeId);
            node.rootId = res.rootId;

            if (res.cycleDetected) {
                node.cycleDetected = true;
                node.hasConflict = true;
                const cycleKey = [...res.cyclePath].sort().join(',');
                if (!recordedCycleKeys.has(cycleKey)) {
                    recordedCycleKeys.add(cycleKey);
                    anomalies.push({
                        kind: 'cycle',
                        cascadeId: node.cascadeId,
                        rootId: res.rootId,
                        detail: `Cycle detected among ${res.cyclePath.length} nodes`,
                    });
                }
            }

            // Promote multi-hop descendants (e.g. subagent of subagent) to nested_helper
            if (
                node.relationshipKind === 'direct_subagent'
                && node.directParentId
                && node.rootId !== node.directParentId
                && !res.cycleDetected
            ) {
                node.relationshipKind = 'nested_helper';
            }

            // Unknown parent detection
            if (node.directParentId && !knownLiveOrManifestIds.has(node.directParentId) && node.relationshipKind !== 'fork') {
                node.isOrphan = true;
                anomalies.push({
                    kind: 'unknown_parent',
                    cascadeId: node.cascadeId,
                    rootId: node.rootId,
                    detail: `Parent ${node.directParentId} is not present in manifests or trajectories`,
                });
            }

            // Orphan / deleted coordinator detection
            const coordDeleted = node.rootId !== node.cascadeId
                && (deletedIds.has(node.rootId) || (!trajById.has(node.rootId) && trajById.size > 0 && !nodes.get(node.rootId)?.isCoordinator));
            if (coordDeleted) {
                node.isOrphan = true;
                if (deletedIds.has(node.rootId)) {
                    anomalies.push({
                        kind: 'deleted_coordinator',
                        cascadeId: node.cascadeId,
                        rootId: node.rootId,
                        detail: `Coordinator ${node.rootId} is confirmed deleted`,
                    });
                } else if (!node.directParentId || knownLiveOrManifestIds.has(node.directParentId)) {
                    anomalies.push({
                        kind: 'orphan',
                        cascadeId: node.cascadeId,
                        rootId: node.rootId,
                        detail: `Root ${node.rootId} missing from active trajectories`,
                    });
                }
            }
        }

        // 5. Assemble SwarmGroupSummary map by rootId
        const groupsByRootId = new Map<string, SwarmGroupSummary>();
        const groupNodes = new Map<string, SwarmMemberNode[]>();
        for (const node of nodes.values()) {
            const list = groupNodes.get(node.rootId) ?? [];
            list.push(node);
            groupNodes.set(node.rootId, list);
        }

        for (const [rootId, members] of groupNodes.entries()) {
            const manifest = manifestByCoordinator.get(rootId)
                ?? resolvedManifests.find(m => m.primaryCoordinatorId === rootId || m.manifestDirId === rootId);
            const coordinatorIds = new Set<string>();
            if (manifest) {
                for (const cid of manifest.coordinatorIds) {
                    coordinatorIds.add(cid);
                }
            }
            for (const m of members) {
                if (m.isCoordinator && m.cascadeId === rootId) {
                    coordinatorIds.add(m.cascadeId);
                }
            }
            const memberIds: string[] = [];
            const activeMemberIds: string[] = [];
            const killedMemberIds: string[] = [];
            const nestedCoords: string[] = [];
            let hasConflict = Boolean(manifest?.hasConflict);
            let isStaleManifest = Boolean(manifest?.isStale);

            for (const m of members) {
                memberIds.push(m.cascadeId);
                if (m.killed) {
                    killedMemberIds.push(m.cascadeId);
                } else {
                    activeMemberIds.push(m.cascadeId);
                }
                if (m.isCoordinator && m.cascadeId !== rootId) {
                    nestedCoords.push(m.cascadeId);
                }
                if (m.hasConflict) { hasConflict = true; }
                if (m.isStaleManifest) { isStaleManifest = true; }
            }

            const coordinatorDeleted = deletedIds.has(rootId);

            if (coordinatorDeleted) {
                anomalies.push({
                    kind: 'deleted_coordinator',
                    rootId,
                    detail: `Group coordinator ${rootId} was deleted`,
                });
            }

            groupsByRootId.set(rootId, {
                rootId,
                ...(manifest?.title ? { title: manifest.title } : {}),
                coordinatorIds: [...coordinatorIds],
                memberIds,
                activeMemberIds,
                killedMemberIds,
                nestedSubSwarmCoordinatorIds: nestedCoords,
                hasConflict,
                coordinatorDeleted,
                isStaleManifest,
            });
        }

        // Deduplicate identical anomalies
        const uniqueAnomalies: TopologyAnomaly[] = [];
        const seenAnom = new Set<string>();
        for (const a of anomalies) {
            const k = `${a.kind}|${a.cascadeId ?? ''}|${a.rootId ?? ''}|${a.manifestDirId ?? ''}|${a.detail}`;
            if (!seenAnom.has(k)) {
                seenAnom.add(k);
                uniqueAnomalies.push(a);
            }
        }

        if (this.latestSnapshot.backendEpoch === this.backendEpoch) {
            for (const [id, node] of nodes) {
                const previous = this.latestSnapshot.nodesById.get(id);
                if (previous?.lastObservedAt !== undefined) {
                    node.lastObservedAt = previous.lastObservedAt;
                    node.measuredModel = previous.measuredModel;
                    node.contextPct = previous.contextPct;
                }
            }
        }
        const snapshot: SwarmTopologySnapshot = {
            backendEpoch: this.backendEpoch,
            nodesById: nodes,
            groupsByRootId,
            anomalies: uniqueAnomalies,
            lastSweepAtMs: this.lastSweepAtMs,
            cursorCompletedFullPass: this.lastCompletedFullPass,
            scannedDirsInLastSweep: this.lastScannedDirs,
            bytesReadInLastSweep: this.lastBytesRead,
            localScanDisabled: this.localScanDisabled,
        };
        this.latestSnapshot = snapshot;
        return snapshot;
    }

    public recordMemberMeasurements(
        epoch: number,
        measurements: ReadonlyMap<string, Pick<SwarmMemberNode, 'lastObservedAt' | 'measuredModel' | 'contextPct'>>,
    ): SwarmTopologySnapshot {
        if (epoch !== this.backendEpoch || !measurements.size) { return this.latestSnapshot; }
        const nodesById = new Map(this.latestSnapshot.nodesById);
        for (const [id, measurement] of measurements) {
            const node = nodesById.get(id);
            if (node) { nodesById.set(id, { ...node, measuredModel: undefined, contextPct: undefined, ...measurement }); }
        }
        return this.latestSnapshot = { ...this.latestSnapshot, nodesById };
    }

    public getSnapshot(): SwarmTopologySnapshot {
        return this.latestSnapshot;
    }

    public getNode(cascadeId: string): SwarmMemberNode | undefined {
        return this.latestSnapshot.nodesById.get(cascadeId);
    }

    /**
     * Synchronously walk topology upward from `cascadeId` to its root ID with cycle protection.
     * Used when enabling Lock to Main Agent while inspecting a worker/subagent.
     */
    public resolveRootId(cascadeId: string): string {
        const clean = typeof cascadeId === 'string' ? cascadeId.trim() : '';
        if (!clean) { return ''; }
        const visited = new Set<string>([clean]);
        let current = clean;
        for (let i = 0; i < 32; i++) {
            const node = this.latestSnapshot.nodesById.get(current);
            if (!node) { return current; }
            if (node.relationshipKind === 'fork') { return current; }
            if (node.rootId && node.rootId !== current && !visited.has(node.rootId)) {
                visited.add(node.rootId);
                current = node.rootId;
                continue;
            }
            if (node.directParentId && node.directParentId !== current && !visited.has(node.directParentId)) {
                visited.add(node.directParentId);
                current = node.directParentId;
                continue;
            }
            return current;
        }
        return current;
    }

    public getGroupMembers(rootId: string): SwarmMemberNode[] {
        const group = this.latestSnapshot.groupsByRootId.get(rootId);
        if (!group) { return []; }
        const out: SwarmMemberNode[] = [];
        for (const id of group.memberIds) {
            const n = this.latestSnapshot.nodesById.get(id);
            if (n) { out.push(n); }
        }
        return out;
    }

    /**
     * Authoritative check whether `cascadeId` is a confirmed worker / subagent / nested helper.
     * Returns `false` for coordinators, forks, and nodes with unrecognized roles!
     */
    public isKnownWorkerOrSubagent(cascadeId: string): boolean {
        const node = this.latestSnapshot.nodesById.get(cascadeId);
        if (!node) { return false; }
        if (node.relationshipKind === 'fork') { return false; }
        if (node.hasUnknownRole) { return false; }
        if (node.isCoordinator && node.rootId === node.cascadeId) { return false; }
        if (node.assignedRole && classifyAssignedRole(node.assignedRole) === 'coordinator' && node.rootId === node.cascadeId) {
            return false;
        }
        return node.rootId !== node.cascadeId
            || node.relationshipKind === 'direct_subagent'
            || node.relationshipKind === 'nested_helper';
    }
}

// ─── Unified Per-Backend Fair-Budget Poll Scheduler ──────────────────────────

export type PollTaskCategory = 'gm' | 'activity' | 'steps' | 'image' | 'swarm_member';

export interface SwarmPollBudgetConfig {
    maxRequests: number;
    maxBytes: number;
    maxPages: number;
    /** Hard-capped to <= 3 per §3.3 to prevent RPC storms. */
    maxConcurrency: number;
    maxElapsedMs: number;
}

export const DEFAULT_SWARM_POLL_BUDGET: Readonly<SwarmPollBudgetConfig> = Object.freeze({
    maxRequests: 24,
    maxBytes: 32 * 1024 * 1024,
    maxPages: 32,
    maxConcurrency: 3,
    maxElapsedMs: 8_000,
});

/** All trajectory readers inside a host poll share one transport allowance, including nested page and image requests. */
interface TrajectoryRpcAllowance {
    requestsLeft: number;
    pagesLeft: number;
    bytesLeft: number;
    concurrency: number;
    inFlight: number;
    maxElapsedMs: number;
    deadline?: number;
    waiters: Array<() => void>;
}

const trajectoryAllowance = new AsyncLocalStorage<TrajectoryRpcAllowance | undefined>();
const phaseRequestLimit = new AsyncLocalStorage<{ remaining: number; bytesRemaining: number }>();

export interface TrajectoryPollBudgetSnapshot {
    requestsLeft: number;
    pagesLeft: number;
    bytesLeft: number;
    /** Effective byte allowance for the current execution scope (phase byte share if active, else poll bytesLeft). */
    effectiveBytesLeft: number;
    /** Effective request allowance for the current execution scope. */
    effectiveRequestsLeft: number;
    remainingMs: number;
    inPhaseShare: boolean;
}

/** Read-only snapshot of the active trajectory poll budget, or `null` when outside `withTrajectoryPollBudget`. */
export function getTrajectoryPollBudgetSnapshot(): TrajectoryPollBudgetSnapshot | null {
    const allowance = trajectoryAllowance.getStore();
    if (!allowance) { return null; }
    const phase = phaseRequestLimit.getStore();
    const remainingMs = allowance.deadline !== undefined
        ? Math.max(0, allowance.deadline - performance.now())
        : allowance.maxElapsedMs;
    const effectiveBytesLeft = phase
        ? Math.min(allowance.bytesLeft, phase.bytesRemaining)
        : allowance.bytesLeft;
    const effectiveRequestsLeft = Math.min(
        allowance.requestsLeft,
        allowance.pagesLeft,
        ...(phase ? [phase.remaining] : []),
    );
    return {
        requestsLeft: Math.max(0, allowance.requestsLeft),
        pagesLeft: Math.max(0, allowance.pagesLeft),
        bytesLeft: Math.max(0, allowance.bytesLeft),
        effectiveBytesLeft: Math.max(0, effectiveBytesLeft),
        effectiveRequestsLeft: Math.max(0, effectiveRequestsLeft),
        remainingMs,
        inPhaseShare: Boolean(phase),
    };
}

/** Keep one background reader from using every wire request or byte before the next consumer runs. */
export function withTrajectoryRequestShare<T>(work: () => Promise<T>): Promise<T> {
    const allowance = trajectoryAllowance.getStore();
    return allowance
        ? phaseRequestLimit.run({
            remaining: Math.max(1, Math.ceil(allowance.requestsLeft / 3)),
            bytesRemaining: Math.max(1, Math.ceil(allowance.bytesLeft / 2)),
        }, work)
        : work();
}

export function withTrajectoryPollBudget<T>(
    limits: { maxRequests: number; maxPages: number; maxBytes: number; maxConcurrency: number; maxElapsedMs: number },
    work: () => Promise<T>,
): Promise<T> {
    return trajectoryAllowance.run({
        requestsLeft: limits.maxRequests, pagesLeft: limits.maxPages, bytesLeft: limits.maxBytes,
        concurrency: Math.max(1, Math.min(3, limits.maxConcurrency)), inFlight: 0,
        maxElapsedMs: limits.maxElapsedMs, waiters: [],
    }, work);
}

export function withoutTrajectoryPollBudget<T>(work: () => Promise<T>): Promise<T> {
    return trajectoryAllowance.run(undefined, work);
}

export function withTrajectoryRpcSlot<T>(
    endpoint: string, timeoutMs: number,
    request: (timeout: number, consumeBytes?: (count: number) => boolean) => Promise<T>,
): Promise<T> {
    const budget = trajectoryAllowance.getStore();
    if (!budget || !endpoint.startsWith('GetCascadeTrajectory')) { return request(timeoutMs); }
    return budgetedRequest();

    async function budgetedRequest(): Promise<T> {
        const allowance = budget!;
        allowance.deadline ??= performance.now() + allowance.maxElapsedMs;
        // Reserve a wire request before queuing; excess callers never open a socket.
        const phase = phaseRequestLimit.getStore();
        if (
            (phase && (phase.remaining <= 0 || phase.bytesRemaining <= 0))
            || allowance.requestsLeft <= 0
            || allowance.pagesLeft <= 0
            || allowance.bytesLeft <= 0
            || performance.now() >= allowance.deadline
        ) {
            throw new Error('Trajectory poll budget exhausted');
        }
        if (phase) { phase.remaining--; }
        allowance.requestsLeft--;
        allowance.pagesLeft--;
        if (allowance.inFlight >= allowance.concurrency) {
            await new Promise<void>(resume => allowance.waiters.push(resume));
        } else {
            allowance.inFlight++;
        }
        try {
            const remainingMs = allowance.deadline - performance.now();
            if (remainingMs <= 0 || allowance.bytesLeft <= 0 || (phase && phase.bytesRemaining <= 0)) {
                throw new Error('Trajectory poll budget exhausted');
            }
            return await request(Math.min(remainingMs, timeoutMs), count => {
                if (phase) {
                    const prevPhase = phase.bytesRemaining;
                    phase.bytesRemaining -= count;
                    if (phase.bytesRemaining < 0) {
                        // Charge at most this phase's remaining byte share so one large TCP chunk
                        // cannot drain outer poll bytes reserved for subsequent readers (e.g. GM).
                        allowance.bytesLeft -= Math.max(0, prevPhase);
                        return false;
                    }
                }
                allowance.bytesLeft -= count;
                return allowance.bytesLeft >= 0;
            });
        } finally {
            const resume = allowance.waiters.shift();
            if (resume) { resume(); } else { allowance.inFlight--; }
        }
    }
}

/** Prioritize current subjects, then rotate the inventory so budgeted readers do not always visit its same prefix. */
export function orderTelemetryPoll<T extends { cascadeId: string }>(
    inventory: readonly T[], priorityIds: readonly (string | null | undefined)[], tick: number,
): T[] {
    const byId = new Map(inventory.map(tr => [tr.cascadeId, tr]));
    const priority: T[] = [];
    for (const id of priorityIds) {
        const tr = id ? byId.get(id) : undefined;
        if (tr) { priority.push(tr); byId.delete(tr.cascadeId); }
    }
    const remaining = [...byId.values()].sort((a, b) => compareCodeUnit(a.cascadeId, b.cascadeId));
    const offset = remaining.length ? tick % remaining.length : 0;
    return priority.concat(remaining.slice(offset), remaining.slice(0, offset));
}

export interface SwarmSchedulableMember {
    cascadeId: string;
    isKilled?: boolean;
    isTerminal?: boolean;
    isRunning?: boolean;
}

export interface UnifiedPollTaskResult {
    ok: boolean;
    requestsUsed?: number;
    bytesUsed?: number;
    pagesUsed?: number;
}

export interface UnifiedPollTask {
    id: string;
    category: PollTaskCategory;
    cascadeId?: string;
    /** Lower number = higher priority (0 = reserved coordinator/inspected, 1 = terminal final, 2 = round-robin/normal). */
    priority: number;
    estimatedRequests?: number;
    estimatedPages?: number;
    estimatedBytes?: number;
    run: () => Promise<UnifiedPollTaskResult>;
}

export interface SwarmPollTickInput {
    rootCascadeId?: string | null;
    inspectedMemberId?: string | null;
    members: ReadonlyArray<SwarmSchedulableMember>;
    /** Additional non-swarm poll tasks sharing this exact same per-backend tick budget. */
    extraTasks?: ReadonlyArray<UnifiedPollTask>;
    /** Callback invoked to refresh a scheduled swarm member. */
    pollMember: (cascadeId: string, reason: 'coordinator' | 'inspected' | 'terminal_final' | 'round_robin') => Promise<UnifiedPollTaskResult>;
    budget?: Partial<SwarmPollBudgetConfig>;
    nowMs?: number;
}

export interface SwarmPollTickResult {
    executedMemberIds: string[];
    executedExtraTaskIds: string[];
    deferredMemberIds: string[];
    terminalFinalRefreshIds: string[];
    partialCoverage: boolean;
    coverageRatio: number;
    totalActiveMembers: number;
    observedActiveMembers: number;
    requestsUsed: number;
    bytesUsed: number;
    pagesUsed: number;
    elapsedMs: number;
    maxObservedConcurrency: number;
    budgetExhaustedReason: 'requests' | 'bytes' | 'pages' | 'elapsed' | null;
    lastObservedAtByCascade: Record<string, number>;
}

/**
 * Unified per-backend fair-budget scheduler (§3.3):
 * - Coordinates GM, Activity, Steps, Image, and Swarm member polling under one shared
 *   budget (`maxRequests`, `maxBytes`, `maxPages`, `maxConcurrency <= 3`, `maxElapsedMs`).
 * - Always prioritizes `rootCascadeId` (Coordinator) and `inspectedMemberId`.
 * - Grants exactly ONE final refresh when a member transitions to `killed`/terminal.
 * - Rotates ALL remaining active members (20+ members) via persistent fair round-robin
 *   so members #9..#20 are NEVER permanently starved.
 */
export class SwarmPollScheduler {
    private readonly defaultBudget: SwarmPollBudgetConfig;
    private readonly nowFn: () => number;

    private roundRobinCursorId: string | null = null;
    private readonly lastObservedAtByCascade = new Map<string, number>();
    private readonly knownActiveIds = new Set<string>();
    private readonly terminalFinalRefreshedIds = new Set<string>();

    constructor(options: { budget?: Partial<SwarmPollBudgetConfig>; now?: () => number } = {}) {
        this.defaultBudget = this.normalizeBudget(options.budget);
        this.nowFn = options.now ?? (() => Date.now());
    }

    private normalizeBudget(override?: Partial<SwarmPollBudgetConfig>): SwarmPollBudgetConfig {
        const merged = {
            ...DEFAULT_SWARM_POLL_BUDGET,
            ...(this.defaultBudget ?? {}),
            ...(override ?? {}),
        };
        return {
            maxRequests: Math.max(1, Math.floor(merged.maxRequests)),
            maxBytes: Math.max(1024, Math.floor(merged.maxBytes)),
            maxPages: Math.max(1, Math.floor(merged.maxPages)),
            // Hard cap <= 3 per §3.3
            maxConcurrency: Math.max(1, Math.min(3, Math.floor(merged.maxConcurrency))),
            maxElapsedMs: Math.max(10, Math.floor(merged.maxElapsedMs)),
        };
    }

    public getLastObservedAt(cascadeId: string): number | null {
        return this.lastObservedAtByCascade.get(cascadeId) ?? null;
    }

    public resetForBackendEpoch(): void {
        this.roundRobinCursorId = null;
        this.lastObservedAtByCascade.clear();
        this.knownActiveIds.clear();
        this.terminalFinalRefreshedIds.clear();
    }

    public async runTick(input: SwarmPollTickInput): Promise<SwarmPollTickResult> {
        const budget = this.normalizeBudget(input.budget);
        const startMs = performance.now();

        const rootId = typeof input.rootCascadeId === 'string' && input.rootCascadeId.trim()
            ? input.rootCascadeId.trim()
            : null;
        const inspectedId = typeof input.inspectedMemberId === 'string' && input.inspectedMemberId.trim()
            ? input.inspectedMemberId.trim()
            : null;

        // Deduplicate member list
        const memberMap = new Map<string, SwarmSchedulableMember>();
        for (const m of input.members) {
            const id = typeof m?.cascadeId === 'string' ? m.cascadeId.trim() : '';
            if (id && !memberMap.has(id)) {
                memberMap.set(id, m);
            }
        }

        const activeMemberIds: string[] = [];
        const terminalTransitionIds: string[] = [];

        for (const [id, m] of memberMap.entries()) {
            const isTerminal = m.isKilled === true || m.isTerminal === true;
            if (!isTerminal) {
                activeMemberIds.push(id);
                this.knownActiveIds.add(id);
                // If an ID somehow revived (non-terminal again), allow future terminal refresh
                this.terminalFinalRefreshedIds.delete(id);
            } else {
                // Newly transitioned to killed/terminal -> grant 1 final refresh!
                const wasPreviouslyActiveOrUnobserved = this.knownActiveIds.has(id) || !this.lastObservedAtByCascade.has(id);
                if (wasPreviouslyActiveOrUnobserved && !this.terminalFinalRefreshedIds.has(id)) {
                    terminalTransitionIds.push(id);
                }
            }
        }

        // Build ordered swarm member queue:
        // Tier 0: rootCascadeId (Coordinator) + inspectedMemberId
        // Tier 1: newly terminal members (1 final refresh each)
        // Tier 2: ALL remaining active members in persistent fair round-robin order
        const queuedMemberIds = new Set<string>();
        interface PlannedMemberTask {
            cascadeId: string;
            reason: 'coordinator' | 'inspected' | 'terminal_final' | 'round_robin';
            priority: number;
        }
        const plannedMembers: PlannedMemberTask[] = [];

        if (rootId && (memberMap.has(rootId) || activeMemberIds.length === 0)) {
            queuedMemberIds.add(rootId);
            plannedMembers.push({ cascadeId: rootId, reason: 'coordinator', priority: 0 });
        }
        if (inspectedId && !queuedMemberIds.has(inspectedId)) {
            queuedMemberIds.add(inspectedId);
            plannedMembers.push({ cascadeId: inspectedId, reason: 'inspected', priority: 0 });
        }

        for (const tid of terminalTransitionIds.sort(compareCodeUnit)) {
            if (!queuedMemberIds.has(tid)) {
                queuedMemberIds.add(tid);
                plannedMembers.push({ cascadeId: tid, reason: 'terminal_final', priority: 1 });
            }
        }

        // Fair round-robin ordering for remaining active members (deterministic UTF-16 code-unit ring)
        const rrPool = activeMemberIds
            .filter(id => !queuedMemberIds.has(id))
            .sort(compareCodeUnit);

        const rrRotated: string[] = [];
        if (rrPool.length > 0) {
            let startIdx = 0;
            if (this.roundRobinCursorId !== null) {
                const nextPos = rrPool.findIndex(id => id > this.roundRobinCursorId!);
                startIdx = nextPos >= 0 ? nextPos : 0;
            }
            rrRotated.push(...rrPool.slice(startIdx), ...rrPool.slice(0, startIdx));
            for (const id of rrRotated) {
                queuedMemberIds.add(id);
                plannedMembers.push({ cascadeId: id, reason: 'round_robin', priority: 2 });
            }
        }

        // Combine swarm member tasks + extra backend tasks (gm, activity, steps, image) sorted by priority
        type ScheduledWork =
            | { kind: 'member'; task: PlannedMemberTask }
            | { kind: 'extra'; task: UnifiedPollTask };

        const queue: ScheduledWork[] = [
            ...plannedMembers.map((task): ScheduledWork => ({ kind: 'member', task })),
            ...(input.extraTasks ?? []).map((task): ScheduledWork => ({ kind: 'extra', task })),
        ].sort((a, b) => {
            const pA = a.task.priority;
            const pB = b.task.priority;
            if (pA !== pB) { return pA - pB; }
            // Preserve relative order within same priority (member tasks keep round-robin order)
            if (a.kind !== b.kind) {
                return a.kind === 'member' ? -1 : 1;
            }
            return 0;
        });

        let requestsUsed = 0;
        let bytesUsed = 0;
        let pagesUsed = 0;
        let inFlight = 0;
        let maxObservedConcurrency = 0;
        let budgetExhaustedReason: 'requests' | 'bytes' | 'pages' | 'elapsed' | null = null;

        const executedMemberIds: string[] = [];
        const executedExtraTaskIds: string[] = [];
        const deferredMemberIds: string[] = [];
        const terminalFinalRefreshIds: string[] = [];
        const finishedRrIds = new Set<string>();

        const checkBudgetExhausted = (): 'requests' | 'bytes' | 'pages' | 'elapsed' | null => {
            const wire = trajectoryAllowance.getStore();
            const share = phaseRequestLimit.getStore();
            if (wire && (wire.requestsLeft <= 0 || (share && share.remaining <= 0))) { return 'requests'; }
            if (wire && (wire.bytesLeft <= 0 || (share && share.bytesRemaining <= 0))) { return 'bytes'; }
            if (wire && wire.pagesLeft <= 0) { return 'pages'; }
            if (wire?.deadline !== undefined && performance.now() >= wire.deadline) { return 'elapsed'; }
            if (requestsUsed >= budget.maxRequests) { return 'requests'; }
            if (bytesUsed >= budget.maxBytes) { return 'bytes'; }
            if (pagesUsed >= budget.maxPages) { return 'pages'; }
            const elapsed = performance.now() - startMs;
            if (elapsed >= budget.maxElapsedMs) { return 'elapsed'; }
            return null;
        };

        // Group queue into strict ascending priority waves so higher-priority work (Coordinator,
        // Inspected, Terminal Final, GM/Activity) is accounted in budget before dispatching
        // lower-priority round-robin members, while running parallel (<= 3) within each wave.
        const waves: ScheduledWork[][] = [];
        for (const item of queue) {
            const lastWave = waves[waves.length - 1];
            if (!lastWave || lastWave[0].task.priority !== item.task.priority) {
                waves.push([item]);
            } else {
                lastWave.push(item);
            }
        }

        let stopAll = false;
        for (const wave of waves) {
            if (stopAll) {
                for (const rem of wave) {
                    if (rem.kind === 'member') { deferredMemberIds.push(rem.task.cascadeId); }
                }
                continue;
            }
            const preExhausted = checkBudgetExhausted();
            if (preExhausted) {
                if (budgetExhaustedReason === null) { budgetExhaustedReason = preExhausted; }
                stopAll = true;
                for (const rem of wave) {
                    if (rem.kind === 'member') { deferredMemberIds.push(rem.task.cascadeId); }
                }
                continue;
            }

            let cursor = 0;
            const worker = async (): Promise<void> => {
                while (cursor < wave.length) {
                    const exhausted = checkBudgetExhausted();
                    if (exhausted) {
                        if (budgetExhaustedReason === null) {
                            budgetExhaustedReason = exhausted;
                        }
                        stopAll = true;
                        break;
                    }
                    const item = wave[cursor++];
                    const estReq = item.kind === 'extra' ? Math.max(1, item.task.estimatedRequests ?? 1) : 1;
                    const estPages = item.kind === 'extra' ? Math.max(1, item.task.estimatedPages ?? 1) : 1;
                    const estBytes = item.kind === 'extra' && typeof item.task.estimatedBytes === 'number' && item.task.estimatedBytes > 0
                        ? item.task.estimatedBytes
                        : 0;
                    if (requestsUsed + estReq > budget.maxRequests) {
                        if (budgetExhaustedReason === null) { budgetExhaustedReason = 'requests'; }
                        if (item.kind === 'member') { deferredMemberIds.push(item.task.cascadeId); }
                        stopAll = true;
                        break;
                    }
                    if (pagesUsed + estPages > budget.maxPages) {
                        if (budgetExhaustedReason === null) { budgetExhaustedReason = 'pages'; }
                        if (item.kind === 'member') { deferredMemberIds.push(item.task.cascadeId); }
                        stopAll = true;
                        break;
                    }
                    if (estBytes > 0 && bytesUsed + estBytes > budget.maxBytes) {
                        if (budgetExhaustedReason === null) { budgetExhaustedReason = 'bytes'; }
                        if (item.kind === 'member') { deferredMemberIds.push(item.task.cascadeId); }
                        stopAll = true;
                        break;
                    }

                    // Reserve minimum unit before async dispatch so concurrent workers respect hard budget
                    requestsUsed += estReq;
                    pagesUsed += estPages;
                    bytesUsed += estBytes;
                    inFlight++;
                    if (inFlight > maxObservedConcurrency) {
                        maxObservedConcurrency = inFlight;
                    }

                    try {
                        const res = item.kind === 'member'
                            ? await input.pollMember(item.task.cascadeId, item.task.reason)
                            : await item.task.run();

                        const actualReq = typeof res?.requestsUsed === 'number' && res.requestsUsed >= 0 ? res.requestsUsed : estReq;
                        const actualPages = typeof res?.pagesUsed === 'number' && res.pagesUsed >= 0 ? res.pagesUsed : estPages;
                        const actualBytes = typeof res?.bytesUsed === 'number' && res.bytesUsed >= 0 ? res.bytesUsed : estBytes;
                        requestsUsed += actualReq - estReq;
                        pagesUsed += actualPages - estPages;
                        bytesUsed += actualBytes - estBytes;

                        const obsTime = this.nowFn();
                        if (item.kind === 'member') {
                            executedMemberIds.push(item.task.cascadeId);
                            if (res?.ok !== false) {
                                this.lastObservedAtByCascade.set(item.task.cascadeId, obsTime);
                                if (item.task.reason === 'terminal_final') {
                                    this.terminalFinalRefreshedIds.add(item.task.cascadeId);
                                    this.knownActiveIds.delete(item.task.cascadeId);
                                    terminalFinalRefreshIds.push(item.task.cascadeId);
                                }
                            }
                            if (item.task.reason === 'round_robin') {
                                finishedRrIds.add(item.task.cascadeId);
                            }
                        } else {
                            executedExtraTaskIds.push(item.task.id);
                        }
                    } catch {
                        if (item.kind === 'member') {
                            deferredMemberIds.push(item.task.cascadeId);
                            if (item.task.reason === 'round_robin') {
                                finishedRrIds.add(item.task.cascadeId);
                            }
                        }
                    } finally {
                        inFlight--;
                    }
                }
            };

            const workerCount = Math.min(budget.maxConcurrency, Math.max(1, wave.length));
            await Promise.all(Array.from({ length: workerCount }, () => worker()));

            // Collect any remaining unstarted member tasks in this wave into deferredMemberIds
            for (let i = cursor; i < wave.length; i++) {
                const rem = wave[i];
                if (rem.kind === 'member') {
                    deferredMemberIds.push(rem.task.cascadeId);
                }
            }
        }

        // Advance round-robin cursor strictly across the contiguous completed prefix of `rrRotated`
        // so out-of-order concurrent completions never regress or skip members!
        let rrContiguousIdx = -1;
        for (let i = 0; i < rrRotated.length; i++) {
            if (!finishedRrIds.has(rrRotated[i])) {
                break;
            }
            rrContiguousIdx = i;
        }
        if (rrContiguousIdx >= 0) {
            this.roundRobinCursorId = rrRotated[rrContiguousIdx];
        }

        const observedActiveMembers = activeMemberIds.filter(id => this.lastObservedAtByCascade.has(id)).length;
        const totalActiveMembers = activeMemberIds.length;
        const partialCoverage = deferredMemberIds.length > 0 || (totalActiveMembers > 0 && observedActiveMembers < totalActiveMembers);
        const coverageRatio = totalActiveMembers > 0 ? observedActiveMembers / totalActiveMembers : 1;

        const snapshotLastObserved: Record<string, number> = {};
        for (const [k, v] of this.lastObservedAtByCascade.entries()) {
            snapshotLastObserved[k] = v;
        }

        return {
            executedMemberIds,
            executedExtraTaskIds,
            deferredMemberIds,
            terminalFinalRefreshIds,
            partialCoverage,
            coverageRatio,
            totalActiveMembers,
            observedActiveMembers,
            requestsUsed,
            bytesUsed,
            pagesUsed,
            elapsedMs: performance.now() - startMs,
            maxObservedConcurrency,
            budgetExhaustedReason,
            lastObservedAtByCascade: snapshotLastObserved,
        };
    }
}

// ─── Deduplicated Swarm Group Cost Aggregator ────────────────────────────────

export function priceSwarmGroup(
    group: SwarmGroupSummary | undefined, conversations: ReadonlyArray<Pick<GMConversationData, 'cascadeId' | 'calls'>>,
    price: (call: GMCallEntry) => number | null,
): SwarmGroupCostSummary | null {
    if (!group || !group.memberIds.length) { return null; }
    const memberIds = [...new Set([group.rootId, ...group.memberIds])];
    const members = new Set(memberIds);
    const calls: SwarmCostCallLike[] = [];
    for (const conv of conversations) {
        if (!members.has(conv.cascadeId)) { continue; }
        for (const c of conv.calls) {
            const steps = Array.isArray(c.stepIndices) ? c.stepIndices.filter(s => Number.isSafeInteger(s) && s >= 0) : [];
            if (!steps.length && c.startStepIndexReported !== false && Number.isSafeInteger(c.startStepIndex) && c.startStepIndex >= 0) {
                steps.push(c.startStepIndex);
            }
            calls.push({
                // A single execution can cover many planner calls. Step identity also
                // lets the same call reported under two members count once.
                logicalCallId: c.executionId && steps.length ? buildGMMatchKey({ ...c, stepIndices: steps })
                    : c.executionId && c.createdAt ? `exec:${c.executionId}|time:${c.createdAt}` : undefined,
                executionId: c.executionId,
                cascadeId: conv.cascadeId, model: c.model || c.modelDisplay,
                createdAt: c.createdAt, startStepIndex: c.startStepIndex, inputTokens: c.inputTokens,
                outputTokens: c.outputTokens, cacheReadTokens: c.cacheReadTokens, cacheCreationTokens: c.cacheCreationTokens,
                thinkingTokens: c.thinkingTokens, costUsd: price(c),
            });
        }
    }
    return aggregateSwarmGroupCost({ rootId: group.rootId, memberIds, calls });
}

export interface SwarmCostCallLike {
    /** Canonical durable logical call ID (e.g. `ledgerDedupKey` or unique execution/call key). */
    logicalCallId?: string;
    executionId?: string;
    cascadeId: string;
    /** Exact USD cost (`0` = priced $0.00; `null | undefined` = unpriced!). */
    costUsd?: number | null;
    model?: string;
    createdAt?: string;
    startStepIndex?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    thinkingTokens?: number;
}

export interface SwarmMemberDirectCost {
    cascadeId: string;
    directCostUsd: number;
    callCount: number;
    pricedCallCount: number;
    unpricedCallCount: number;
    totalTokens: number;
}

export interface SwarmGroupCostSummary {
    rootId: string;
    directCostByMember: Record<string, SwarmMemberDirectCost>;
    coordinatorDirectCostUsd: number;
    workersDirectCostUsd: number;
    /** Inclusive group total deduplicated by unique logical call ID across coordinator + all workers/helpers. */
    inclusiveGroupCostUsd: number;
    uniqueCallCount: number;
    duplicateCallsDeduplicated: number;
    pricedCallCount: number;
    unpricedCallCount: number;
    hasUnpricedCalls: boolean;
}

function buildCanonicalLogicalCallId(call: SwarmCostCallLike): string {
    const explicit = typeof call.logicalCallId === 'string' ? call.logicalCallId.trim() : '';
    if (explicit) { return explicit; }
    const execId = typeof call.executionId === 'string' ? call.executionId.trim() : '';
    if (execId) { return `exec:${execId}`; }
    return [
        'call',
        call.cascadeId.trim(),
        (call.model ?? '').trim(),
        (call.createdAt ?? '').trim(),
        String(call.startStepIndex ?? -1),
        String(call.inputTokens ?? 0),
        String(call.outputTokens ?? 0),
        String(call.cacheReadTokens ?? 0),
        String(call.cacheCreationTokens ?? 0),
    ].join('|');
}

function computeCallTokens(call: SwarmCostCallLike): number {
    // Additive prompt semantics; thinkingTokens is a subset of outputTokens (never double-counted).
    const input = typeof call.inputTokens === 'number' && Number.isFinite(call.inputTokens) && call.inputTokens > 0 ? call.inputTokens : 0;
    const output = typeof call.outputTokens === 'number' && Number.isFinite(call.outputTokens) && call.outputTokens > 0 ? call.outputTokens : 0;
    const cacheRead = typeof call.cacheReadTokens === 'number' && Number.isFinite(call.cacheReadTokens) && call.cacheReadTokens > 0 ? call.cacheReadTokens : 0;
    const cacheCreate = typeof call.cacheCreationTokens === 'number' && Number.isFinite(call.cacheCreationTokens) && call.cacheCreationTokens > 0 ? call.cacheCreationTokens : 0;
    return input + output + cacheRead + cacheCreate;
}

/**
 * Aggregate swarm group cost deduplicating strictly by unique logical call ID while
 * cleanly separating per-member direct cost, coordinator vs worker direct totals,
 * inclusive deduplicated group total, and unpriced call count.
 */
export function aggregateSwarmGroupCost(input: {
    rootId: string;
    memberIds?: ReadonlyArray<string>;
    calls: ReadonlyArray<SwarmCostCallLike>;
}): SwarmGroupCostSummary {
    const rootId = input.rootId.trim();
    const allowedMembers = input.memberIds && input.memberIds.length > 0
        ? new Set([rootId, ...input.memberIds.map(id => id.trim()).filter(Boolean)])
        : null;

    const directCostByMember: Record<string, SwarmMemberDirectCost> = Object.create(null);
    const ensureMember = (cid: string): SwarmMemberDirectCost => {
        let rec = directCostByMember[cid];
        if (!rec) {
            rec = {
                cascadeId: cid,
                directCostUsd: 0,
                callCount: 0,
                pricedCallCount: 0,
                unpricedCallCount: 0,
                totalTokens: 0,
            };
            directCostByMember[cid] = rec;
        }
        return rec;
    };

    if (allowedMembers) {
        for (const id of allowedMembers) {
            ensureMember(id);
        }
    } else if (rootId) {
        ensureMember(rootId);
    }

    // Track per-member dedup AND group-wide dedup by logicalCallId
    // Keep the pricing state so a priced mirror can fill a missing price without adding a call.
    const seenGroupCallIds = new Map<string, boolean>();
    const seenMemberCallIds = new Map<string, Map<string, boolean>>();

    let inclusiveGroupCostUsd = 0;
    let uniqueCallCount = 0;
    let duplicateCallsDeduplicated = 0;
    let pricedCallCount = 0;
    let unpricedCallCount = 0;

    for (const call of input.calls) {
        const cid = typeof call?.cascadeId === 'string' ? call.cascadeId.trim() : '';
        if (!cid) { continue; }
        if (allowedMembers && !allowedMembers.has(cid)) { continue; }

        const logicalId = buildCanonicalLogicalCallId(call);
        const isPriced = typeof call.costUsd === 'number' && Number.isFinite(call.costUsd) && call.costUsd >= 0;
        const cost = isPriced ? call.costUsd! : 0;
        const tokens = computeCallTokens(call);

        // Per-member direct attribution (deduplicated within member)
        let memberSeen = seenMemberCallIds.get(cid);
        if (!memberSeen) {
            memberSeen = new Map();
            seenMemberCallIds.set(cid, memberSeen);
        }
        const rec = ensureMember(cid);
        const prevMemberPriced = memberSeen.get(logicalId);
        if (prevMemberPriced === undefined) {
            rec.callCount++;
            rec.totalTokens += tokens;
            if (!isPriced) { rec.unpricedCallCount++; }
        }
        if (isPriced && !prevMemberPriced) {
            rec.directCostUsd += cost;
            rec.pricedCallCount++;
            if (prevMemberPriced === false) { rec.unpricedCallCount--; }
        }
        memberSeen.set(logicalId, Boolean(prevMemberPriced || isPriced));

        const prevGroupPriced = seenGroupCallIds.get(logicalId);
        if (prevGroupPriced === undefined) {
            uniqueCallCount++;
            if (!isPriced) { unpricedCallCount++; }
        } else {
            duplicateCallsDeduplicated++;
        }
        if (isPriced && !prevGroupPriced) {
            inclusiveGroupCostUsd += cost;
            pricedCallCount++;
            if (prevGroupPriced === false) { unpricedCallCount--; }
        }
        seenGroupCallIds.set(logicalId, Boolean(prevGroupPriced || isPriced));
    }

    const coordinatorDirectCostUsd = directCostByMember[rootId]?.directCostUsd ?? 0;
    let workersDirectCostUsd = 0;
    for (const [cid, rec] of Object.entries(directCostByMember)) {
        if (cid !== rootId) {
            workersDirectCostUsd += rec.directCostUsd;
        }
    }

    return {
        rootId,
        directCostByMember,
        coordinatorDirectCostUsd,
        workersDirectCostUsd,
        inclusiveGroupCostUsd,
        uniqueCallCount,
        duplicateCallsDeduplicated,
        pricedCallCount,
        unpricedCallCount,
        hasUnpricedCalls: unpricedCallCount > 0,
    };
}

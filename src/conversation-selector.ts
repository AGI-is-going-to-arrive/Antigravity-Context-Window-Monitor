// ─── Pure Conversation Selector & Subagent / Main-Agent Lock Engine ──────────
// Resolves the target conversation across IDE and Antigravity App Sidecar surfaces
// with 3 modes: manual pin, Lock to Main Agent (subagent-burst resistant), and
// auto-follow (host conversationId or active workspace trajectory).
//
// Zero VS Code, DOM, or external npm dependencies.

import * as fs from 'fs';
import * as path from 'path';
import { CascadeStatus } from './constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TrajectoryMetadataLike {
    trajectoryType?: string;
    parentCascadeId?: string;
    parentTrajectoryId?: string;
    parentConversationId?: string;
    isSubagent?: boolean;
    isChild?: boolean;
    isFork?: boolean;
    forkedFromCascadeId?: string;
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
    isFork?: boolean;
    forkedFromCascadeId?: string;
    role?: string;
    agentRole?: string;
    agentType?: string;
    spawnedBy?: string;
    swarmId?: string;
    killed?: boolean;
    trajectoryMetadata?: TrajectoryMetadataLike | Record<string, unknown>;
}

export type ConversationSelectionMode = 'pinned' | 'locked_main' | 'auto_follow';

/**
 * Strict authority grading for focus & selection events (§3.2):
 * - `user_explicit` (Level 1): Pin/Inspect, Lock/Unlock, Back to Main, explicit Retarget.
 * - `host_sdk` (Level 2): Authenticated host SDK observation (`window.sidecar` callback).
 * - `cdp_passive` (Level 3): Passive CDP DOM guess (lowest authority; visible composer
 *   and first route UUID NEVER establish human intent).
 */
export type FocusAuthorityLevel = 'user_explicit' | 'host_sdk' | 'cdp_passive';

export interface ObservedHostFocus {
    cascadeId: string | null;
    authority: FocusAuthorityLevel;
    focusRevision: number;
    observedAtMs: number;
    /** True ONLY when human new-chat intent is explicitly confirmed (NEVER from a visible composer alone). */
    isNewConversation?: boolean;
    /** Surface view mode (e.g. `'aux' | 'sidebar' | 'topbar' | 'ide'`). */
    viewMode?: string;
    sourceInstanceId?: string;
    /** Explicit split-pane focus indicator (`?focused=` or active pane); `false` means background/unfocused pane. */
    isFocusedPane?: boolean;
    /** Passive CDP heuristic flag: visible composer alone MUST NOT imply human new-chat intent. */
    inferredFromVisibleComposer?: boolean;
    /** Passive CDP heuristic flag: first route UUID fallback MUST NOT override focus authority. */
    inferredFromFirstUrlUuid?: boolean;
    /** True when delivered via live host SDK callback (outranks stale non-empty getter at equal revision). */
    fromSdkCallback?: boolean;
}

/**
 * Per-window 3-field lock state machine state (§3.2), strictly scoped to
 * `(backendEpoch, windowId)` and separate from shared `AppSettings`.
 */
export interface WindowSelectionState {
    backendEpoch: number;
    windowId: string;
    observedHostFocus: ObservedHostFocus | null;
    lockedRootId: string | null;
    inspectedMemberId: string | null;
    /** Previous auto-follow target, restored when ending a temporary inspection. */
    inspectionReturnId?: string | null;
    lockPendingUnavailable?: boolean;
    retargetOfferId?: string | null;
    selectionRevision: number;
    /** Explicit lock toggle flag; when omitted, `lockedRootId !== null` implies locked. */
    lockToMainAgent?: boolean;
    /** Highest acknowledged `focusRevision` processed for this window. */
    acknowledgedFocusRevision?: number;
}

export interface ResolveTargetConversationInput {
    trajectories: ReadonlyArray<ConversationTrajectoryLike>;
    /** Manually pinned conversation cascadeId (highest priority while present). */
    pinnedId?: string | null;
    /** When true, ignore subagent trajectories and stay locked on the active/most-recent main trajectory. */
    lockToMainAgent?: boolean;
    /** Previously locked main-agent cascadeId (locked root anchor). */
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
    /** Optional set of cascadeIds confirmed deleted in the current `backendEpoch`. */
    deletedConversationIds?: ReadonlySet<string>;
    /** When true (default), an unseen non-deleted hostConversationId stays pending at 0% in unlocked navigation. */
    hostConversationPendingAllowed?: boolean;
    /** True when the host explicitly reports the user opened a blank New Conversation screen (no cascadeId yet). */
    hostNewConversationPending?: boolean;
    /** Platform override for workspace URI normalization (defaults to `process.platform`). */
    platform?: NodeJS.Platform;
    /** Explicit case-sensitivity override for local workspace paths (e.g. macOS case-sensitive APFS). */
    caseSensitive?: boolean;
    /** Optional filesystem case-sensitivity probe override (returns true for case-sensitive volume, false for insensitive, null if unknown). */
    isCaseSensitivePath?: (fsPath: string) => boolean | null;
    /** Optional active WSL distro name for scoping local POSIX workspace paths. */
    wslDistro?: string;
    /**
     * When true and `workspaceUris` is non-empty, exclude trajectories bound to a different
     * explicit workspace from auto-follow selection (still allows unbound brand-new chats).
     */
    strictWorkspaceIsolation?: boolean;
    /**
     * When true, filter out subagent / swarm worker trajectories during auto-follow
     * whenever at least one non-worker candidate exists.
     */
    isolateWorkers?: boolean;
    /** Optional current backend epoch for scoping confirmed deletions. */
    backendEpoch?: number;
    /** Optional backend epoch under which `lockedMainId` was anchored (prevents cross-epoch deletion eviction). */
    lockedRootEpoch?: number;
    /** Optional inspected worker/subagent cascadeId (never overwrites `lockedMainId`). */
    inspectedMemberId?: string | null;
    /** Authority level of `hostConversationId` / `hostNewConversationPending` observation. */
    hostFocusAuthority?: FocusAuthorityLevel;
    /** True if `hostNewConversationPending` was guessed from a visible composer (rejected at `cdp_passive`). */
    hostFocusInferredFromComposer?: boolean;
    /** True if `hostConversationId` was guessed from first route UUID (rejected at `cdp_passive`). */
    hostFocusInferredFromFirstUrlUuid?: boolean;
    /** False when `hostConversationId` comes from an unfocused/other split pane (offers `retargetOfferId` instead of hijacking). */
    hostFocusIsFocusedPane?: boolean;
    /** View surface reporting host focus (e.g. `'sidebar'`, `'aux'`, `'topbar'`). */
    hostViewMode?: string;
    /** Optional synchronous topology root resolver (e.g. `SwarmTopologyRegistry.resolveRootId`). */
    topologyResolveRootId?: (cascadeId: string) => string | null;
}

export interface ResolveIdeAutoFollowInput {
    trajectories: ReadonlyArray<ConversationTrajectoryLike>;
    /** All workspace folder URIs from the IDE window (multi-root aware). */
    workspaceUris?: ReadonlyArray<string>;
    /** Manually pinned conversation cascadeId (highest priority while present). */
    pinnedId?: string | null;
    /** When true, stay locked to the active/most-recent main-agent trajectory. */
    lockToMainAgent?: boolean;
    /** Previously locked main-agent cascadeId. */
    lockedMainId?: string | null;
    /** Currently tracked cascadeId in this IDE window. */
    currentActiveId?: string | null;
    /** Optional epoch ms when `currentActiveId` became active. */
    currentActiveSinceMs?: number;
    /** Optional set of explicitly linked child/subagent cascadeIds. */
    knownSubagentIds?: ReadonlySet<string>;
    /** Optional set of newly observed cascadeIds on the current poll cycle. */
    newlyCreatedIds?: ReadonlySet<string>;
    /** Optional map of previous step counts by cascadeId for stepCount-change detection. */
    previousStepCounts?: ReadonlyMap<string, number>;
    /** When true (default), never auto-follow into a different explicit workspace when `workspaceUris` is non-empty. */
    strictWorkspaceIsolation?: boolean;
    /** When true (default), ignore subagent / swarm worker trajectories when any non-worker candidate exists. */
    isolateWorkers?: boolean;
    /** Platform override for workspace URI normalization (defaults to `process.platform`). */
    platform?: NodeJS.Platform;
    /** Explicit case-sensitivity override for local workspace paths. */
    caseSensitive?: boolean;
    /** Optional filesystem case-sensitivity probe override. */
    isCaseSensitivePath?: (fsPath: string) => boolean | null;
    /** Optional active WSL distro name for scoping local POSIX workspace paths. */
    wslDistro?: string;
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
    /** True when the host's focused brand-new conversation is not yet present in `trajectories` (unlocked navigation only). */
    hostPending?: boolean;
    /** True when `lockedRootId` is temporarily absent from trajectories (NOT confirmed deleted) and preserved cleanly. */
    lockPendingUnavailable?: boolean;
    /** Non-intrusive retarget suggestion when another main conversation appears while locked or in an unfocused split pane. */
    retargetOfferId?: string | null;
    /** Anchored root conversation ID (preserved even while `inspectedMemberId` is active). */
    rootCascadeId?: string | null;
    /** Active inspected worker/subagent member ID when inspecting inside a locked or unlocked view. */
    inspectedMemberId?: string | null;
    /** Subject classification of the resolved `cascadeId`. */
    subjectKind?: 'main' | 'worker' | 'subagent';
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
    caseSensitive?: boolean;
    isCaseSensitivePath?: (fsPath: string) => boolean | null;
    wslDistro?: string;
    /** Optional language for untitled fallback label (`'en' | 'zh' | 'both'`). Defaults to `'en'`. */
    lang?: 'en' | 'zh' | 'both';
    /** If true, omit subagent trajectories from the returned options list. Defaults to `false`. */
    excludeSubagents?: boolean;
    /** If true and `workspaceUris` is non-empty, place workspace-matching conversations first. Defaults to `true`. */
    prioritizeWorkspace?: boolean;
}

// ─── Cross-Platform Workspace URI Normalization ──────────────────────────────

export interface PathCaseProbeFs {
    statSync: (targetPath: string) => { dev: number | bigint; ino: number | bigint };
    readdirSync?: (targetPath: string) => string[];
    /** Enable per-device caching with custom fsOps (defaults to true only when using real `fs`). */
    useCache?: boolean;
}

export interface NormalizeWorkspaceUriOptions {
    platform?: NodeJS.Platform;
    /**
     * Explicit path case sensitivity override:
     * - `true`: preserve case (Linux, macOS case-sensitive APFS, Remote-SSH POSIX)
     * - `false`: case-fold (Windows, macOS case-insensitive APFS)
     */
    caseSensitive?: boolean;
    /** Optional custom probe for macOS APFS volume case-sensitivity (used in tests or custom FS). */
    isCaseSensitivePath?: (fsPath: string) => boolean | null;
    /**
     * Optional active WSL distro name (e.g. `process.env.WSL_DISTRO_NAME` when running inside WSL).
     * When set, local POSIX paths (e.g. `file:///home/dev/repo`) are scoped under
     * `vscode-remote://wsl+<distro>/...` so they match `vscode-remote://wsl+<distro>/...`,
     * `\\wsl$\<distro>\...`, and `\\wsl.localhost\<distro>\...` only for that matching distro.
     */
    wslDistro?: string;
}

const volumeCaseSensitivityCache = new Map<string, boolean>();
const MAX_MOUNT_PROBE_ENTRIES = 32;

/** Reset cached per-device macOS volume case-sensitivity probe results (for tests). */
export function resetPathCaseSensitivityCache(): void {
    volumeCaseSensitivityCache.clear();
}

function toggleAsciiCase(segment: string): string | null {
    let changed = false;
    let out = '';
    for (let i = 0; i < segment.length; i++) {
        const ch = segment[i];
        const code = ch.charCodeAt(0);
        if (code >= 65 && code <= 90) {
            out += String.fromCharCode(code + 32);
            changed = true;
        } else if (code >= 97 && code <= 122) {
            out += String.fromCharCode(code - 32);
            changed = true;
        } else {
            out += ch;
        }
    }
    return changed ? out : null;
}

function probeEntryInSameDeviceDir(
    dirPath: string,
    dirDevKey: string,
    entryName: string,
    entryStat: { dev: number | bigint; ino: number | bigint },
    statSync: (targetPath: string) => { dev: number | bigint; ino: number | bigint },
    useCache: boolean,
): boolean | null {
    const toggled = toggleAsciiCase(entryName);
    if (!toggled) { return null; }
    // Ensure both directory and entry belong to the exact same device before probing.
    if (String(entryStat.dev) !== dirDevKey) { return null; }
    const altPath = path.posix.join(dirPath, toggled);
    try {
        const altStat = statSync(altPath);
        const sameInode = String(altStat.dev) === String(entryStat.dev)
            && String(altStat.ino) === String(entryStat.ino);
        const sensitive = !sameInode;
        if (useCache) {
            volumeCaseSensitivityCache.set(dirDevKey, sensitive);
        }
        return sensitive;
    } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            if (useCache) {
                volumeCaseSensitivityCache.set(dirDevKey, true);
            }
            return true;
        }
        return null;
    }
}

/**
 * Probe whether `fsPath` resides on a case-sensitive filesystem volume (e.g. macOS
 * case-sensitive APFS) using read-only `statSync`, cached per mount device (`dev`).
 *
 * Mount-point safety:
 * - Never looks up an alternate spelling in a parent directory residing on a different
 *   device (mount boundary) and never caches a parent volume's result against the mounted
 *   device.
 * - Never walks past an unmounted `/Volumes/<name>` entry onto `/Volumes`.
 * - Returns `true` (case-sensitive), `false` (case-insensitive), or `null` if indeterminate.
 */
export function detectPathCaseSensitivity(
    fsPath: string,
    fsOps?: PathCaseProbeFs,
): boolean | null {
    if (!fsPath || !fsPath.startsWith('/')) { return null; }
    const statSync = fsOps?.statSync ?? ((target: string) => fs.statSync(target));
    const readdirSync = fsOps ? fsOps.readdirSync : ((target: string) => fs.readdirSync(target));
    const useCache = fsOps ? fsOps.useCache === true : true;

    const cleanPath = fsPath.length > 1 ? fsPath.replace(/\/+$/, '') || '/' : '/';
    const volumeRootMatch = cleanPath.match(/^\/Volumes\/([^/]+)(?:\/|$)/);
    const volumeRootPath = volumeRootMatch ? `/Volumes/${volumeRootMatch[1]}` : null;

    let current = cleanPath;
    let stat: { dev: number | bigint; ino: number | bigint } | null = null;
    for (let depth = 0; depth < 32; depth++) {
        try {
            stat = statSync(current);
            break;
        } catch {
            // Do not fall back onto `/Volumes` when `/Volumes/<name>` itself is unmounted/absent.
            if (volumeRootPath && current === volumeRootPath) {
                return null;
            }
            const parent = path.posix.dirname(current);
            if (!parent || parent === current || parent === '/') { return null; }
            current = parent;
        }
    }
    if (!stat) { return null; }

    const devKey = String(stat.dev);
    if (useCache && volumeCaseSensitivityCache.has(devKey)) {
        return volumeCaseSensitivityCache.get(devKey)!;
    }

    // Walk up within the SAME mounted device (`devKey`) looking for a segment with ASCII letters.
    let probeTarget = current;
    let mountRoot: string | null = null;
    for (let step = 0; step < 32; step++) {
        if (probeTarget === '/') {
            mountRoot = '/';
            break;
        }
        const base = path.posix.basename(probeTarget);
        const dir = path.posix.dirname(probeTarget);
        if (!dir || dir === probeTarget) {
            mountRoot = probeTarget;
            break;
        }

        let targetStat = stat;
        if (probeTarget !== current) {
            try {
                targetStat = statSync(probeTarget);
            } catch {
                break;
            }
            if (String(targetStat.dev) !== devKey) {
                break;
            }
        }

        let dirStat: { dev: number | bigint; ino: number | bigint };
        try {
            dirStat = statSync(dir);
        } catch {
            // Cannot verify whether `dir` is on the same device as `probeTarget`; stay indeterminate.
            break;
        }

        if (String(dirStat.dev) !== devKey) {
            // `probeTarget` is a mount point: NEVER look up `path.posix.join(dir, toggled)` on the
            // parent volume or cache the parent volume's sensitivity under `devKey`.
            mountRoot = probeTarget;
            break;
        }

        if (base && toggleAsciiCase(base)) {
            const probed = probeEntryInSameDeviceDir(dir, devKey, base, targetStat, statSync, useCache);
            if (probed !== null) {
                return probed;
            }
        }

        probeTarget = dir;
    }

    // At a mount root on `devKey`, optionally probe an existing child entry inside `mountRoot`
    // that lives on the exact same device (`devKey`). If none is available, return null (indeterminate).
    if (mountRoot && readdirSync) {
        try {
            const entries = readdirSync(mountRoot);
            const limit = Math.min(entries.length, MAX_MOUNT_PROBE_ENTRIES);
            for (let i = 0; i < limit; i++) {
                const entry = entries[i];
                if (!entry || entry === '.' || entry === '..' || entry.includes('/')) { continue; }
                if (!toggleAsciiCase(entry)) { continue; }
                const childPath = path.posix.join(mountRoot, entry);
                let childStat: { dev: number | bigint; ino: number | bigint };
                try {
                    childStat = statSync(childPath);
                } catch {
                    continue;
                }
                if (String(childStat.dev) !== devKey) { continue; }
                const probed = probeEntryInSameDeviceDir(mountRoot, devKey, entry, childStat, statSync, useCache);
                if (probed !== null) {
                    return probed;
                }
            }
        } catch {
            // Unreadable mount directory — remain indeterminate.
        }
    }

    return null;
}

function resolveNormOptions(
    platformOrOptions: NodeJS.Platform | NormalizeWorkspaceUriOptions = process.platform,
): {
    platform: NodeJS.Platform;
    caseSensitive?: boolean;
    isCaseSensitivePath?: (fsPath: string) => boolean | null;
    wslDistro?: string;
} {
    if (typeof platformOrOptions === 'string') {
        return { platform: platformOrOptions };
    }
    return {
        platform: platformOrOptions.platform ?? process.platform,
        caseSensitive: platformOrOptions.caseSensitive,
        isCaseSensitivePath: platformOrOptions.isCaseSensitivePath,
        wslDistro: platformOrOptions.wslDistro,
    };
}

function isWindowsDrivePath(value: string): boolean {
    return /^[a-zA-Z]:[/\\]/.test(value) || /^\/[a-zA-Z]:[/\\]/.test(value);
}

function isWindowsUncPath(value: string): boolean {
    return /^\\\\[^\\]/.test(value) || /^\/\/[^/]/.test(value);
}

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function normalizePosixWslPath(rawPath: string, convertBackslashes: boolean): string {
    let p = safeDecodeURIComponent(rawPath);
    if (convertBackslashes) {
        p = p.replace(/\\/g, '/');
    }
    if (!p.startsWith('/')) {
        p = `/${p}`;
    }
    p = p.replace(/\/{2,}/g, '/');
    if (p.length > 1) {
        p = p.replace(/\/+$/, '');
    }
    return p || '/';
}

function normalizeWslDistroName(rawDistro: string): string {
    return safeDecodeURIComponent(rawDistro).trim().toLowerCase();
}

/**
 * Translate Windows WSL UNC aliases (`\\wsl$\<distro>\...`, `\\wsl.localhost\<distro>\...`,
 * `\\?\UNC\wsl$\<distro>\...`, `//wsl$/<distro>/...`, `file://wsl$/<distro>/...`) into
 * canonical `vscode-remote://wsl+<distro><posixPath>` preserving distro authority and POSIX case.
 */
function tryNormalizeWslUncAlias(candidate: string): string | null {
    const match = candidate.match(
        /^(?:\\\\\?\\UNC\\|\/\/\?\/UNC\/|\\\\|\/\/)(?:wsl(?:\$|%24)|wsl\.localhost)[\\/]+([^\\/]+)([\\/].*)?$/i,
    );
    if (!match) { return null; }
    const distro = normalizeWslDistroName(match[1]);
    if (!distro) { return null; }
    const posixPath = normalizePosixWslPath(match[2] || '/', true);
    return `vscode-remote://wsl+${distro}${posixPath}`;
}

function normalizeRemotePath(rawPath: string): string {
    let p = safeDecodeURIComponent(rawPath);
    const remoteWindows = isWindowsDrivePath(p);
    if (remoteWindows) {
        p = p.replace(/\\/g, '/').replace(/^\/+([a-zA-Z]:)/, '/$1');
        p = p.replace(/\/{2,}/g, '/');
        if (p.length > 1 && !/^\/[a-zA-Z]:\/$/.test(p)) {
            p = p.replace(/\/+$/, '');
        }
        if (/^\/[a-zA-Z]:$/.test(p)) {
            p = `${p}/`;
        }
        return p.toLowerCase();
    }
    p = p.replace(/\/{2,}/g, '/');
    if (p.length > 1) {
        p = p.replace(/\/+$/, '');
    }
    return p || '/';
}

/**
 * Normalize a workspace URI or filesystem path for reliable cross-platform comparison
 * across Windows, macOS (case-insensitive and case-sensitive APFS), Linux, WSL, and
 * Remote-SSH (preserving remote & WSL distro authorities so distinct hosts/distros with
 * identical paths never collide).
 */
export function normalizeWorkspaceUri(
    uri: string,
    platformOrOptions: NodeJS.Platform | NormalizeWorkspaceUriOptions = process.platform,
): string {
    if (typeof uri !== 'string') { return ''; }
    let normalized = uri.trim();
    if (!normalized) { return ''; }

    const opts = resolveNormOptions(platformOrOptions);
    const platform = opts.platform;

    // Handle vscode-remote://<authority>/...
    // - WSL (`wsl+<distro>`) PRESERVES distro authority (so `Ubuntu` != `Debian`) and preserves
    //   POSIX path case sensitivity even when normalized on Windows/macOS.
    // - Remote-SSH (`ssh-remote+...`), tunnels, containers, codespaces PRESERVE authority
    //   so distinct remote hosts sharing `/srv/app` NEVER collapse into the same key.
    const remoteMatch = normalized.match(/^vscode-remote:\/\/([^/]+)(\/.*)?$/i);
    if (remoteMatch) {
        const decodedAuthority = safeDecodeURIComponent(remoteMatch[1]).trim().toLowerCase();
        if (decodedAuthority.startsWith('wsl+')) {
            const distro = decodedAuthority.slice(4).trim();
            const wslPath = normalizePosixWslPath(remoteMatch[2] || '/', false);
            return `vscode-remote://wsl+${distro}${wslPath}`;
        }
        const remotePath = normalizeRemotePath(remoteMatch[2] || '/');
        return `vscode-remote://${decodedAuthority}${remotePath}`;
    }

    // Preserve explicit ssh://[user@]host[:port]/path authority as well
    const sshMatch = normalized.match(/^ssh:\/\/([^/]+)(\/.*)?$/i);
    if (sshMatch) {
        const decodedAuthority = safeDecodeURIComponent(sshMatch[1]).trim().toLowerCase();
        const remotePath = normalizeRemotePath(sshMatch[2] || '/');
        return `ssh://${decodedAuthority}${remotePath}`;
    }

    // Translate direct `\\wsl$\<distro>\...` / `\\wsl.localhost\<distro>\...` UNC aliases before
    // Windows case-folding so distro authority and POSIX case sensitivity are preserved.
    const directWslUnc = tryNormalizeWslUncAlias(normalized);
    if (directWslUnc) {
        return directWslUnc;
    }

    // Handle file:// URLs (including Windows UNC file://server/share, file://wsl$/..., and file://localhost/...)
    if (/^file:\/\//i.test(normalized)) {
        if (/^file:\/\/localhost\//i.test(normalized)) {
            normalized = normalized.replace(/^file:\/\/localhost\//i, '/');
        } else if (/^file:\/\/\//i.test(normalized)) {
            normalized = normalized.replace(/^file:\/\/\//i, '/');
        } else {
            // file://server/share -> //server/share
            normalized = '//' + normalized.replace(/^file:\/\//i, '');
        }
        // Check WSL UNC alias form from file://wsl$/... or file://wsl.localhost/... (including file:////wsl$/...)
        const fileWslUnc = tryNormalizeWslUncAlias(normalized);
        if (fileWslUnc) {
            return fileWslUnc;
        }
    }

    // Safe URL decoding (handles %20 spaces and %3A Windows drive colons)
    normalized = safeDecodeURIComponent(normalized);

    const decodedWslUnc = tryNormalizeWslUncAlias(normalized);
    if (decodedWslUnc) {
        return decodedWslUnc;
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

    // When caller explicitly supplies an active WSL distro context, scope local POSIX paths
    // under that distro authority (never folding POSIX case and never touching Windows paths).
    const activeWslDistro = typeof opts.wslDistro === 'string'
        ? normalizeWslDistroName(opts.wslDistro)
        : '';
    if (activeWslDistro && !windowsLike && normalized.startsWith('/') && !normalized.startsWith('//')) {
        return `vscode-remote://wsl+${activeWslDistro}${normalized}`;
    }

    // Case-folding rules:
    // - Windows / UNC paths: always case-insensitive (unless explicitly forced caseSensitive: true)
    // - macOS (darwin): respect explicit `caseSensitive`, custom probe, or live APFS volume
    //   case-sensitivity probe on darwin. ONLY fold to lowercase when confirmed case-insensitive
    //   (`false`); when indeterminate (`null`) or case-sensitive (`true`), preserve original case!
    // - Linux / POSIX: always case-sensitive (unless explicitly forced caseSensitive: false)
    if (windowsLike) {
        if (opts.caseSensitive !== true) {
            normalized = normalized.toLowerCase();
        }
    } else if (platform === 'darwin') {
        let isCaseSensitive: boolean | null;
        if (typeof opts.caseSensitive === 'boolean') {
            isCaseSensitive = opts.caseSensitive;
        } else if (typeof opts.isCaseSensitivePath === 'function') {
            isCaseSensitive = opts.isCaseSensitivePath(normalized);
        } else if (process.platform === 'darwin') {
            isCaseSensitive = detectPathCaseSensitivity(normalized);
        } else {
            isCaseSensitive = null;
        }
        if (isCaseSensitive === false) {
            normalized = normalized.toLowerCase();
        }
    } else if (opts.caseSensitive === false) {
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
    normOptions: NormalizeWorkspaceUriOptions,
): Set<string> {
    const set = new Set<string>();
    if (!uris) { return set; }
    for (const uri of uris) {
        const norm = normalizeWorkspaceUri(uri, normOptions);
        if (norm) { set.add(norm); }
    }
    return set;
}

function trajectoryMatchesWorkspaceSet(
    summary: ConversationTrajectoryLike,
    targetSet: ReadonlySet<string>,
    normOptions: NormalizeWorkspaceUriOptions,
): boolean {
    if (targetSet.size === 0) { return false; }
    const uris = extractTrajectoryWorkspaceUris(summary);
    for (const uri of uris) {
        const norm = normalizeWorkspaceUri(uri, normOptions);
        if (norm && targetSet.has(norm)) {
            return true;
        }
    }
    return false;
}

/**
 * Check whether a trajectory belongs to ANY root in a multi-root workspace folder list.
 * Preserves Remote-SSH authorities and respects macOS case-sensitive APFS volumes.
 */
export function matchesAnyWorkspace(
    summary: ConversationTrajectoryLike,
    workspaceUris: ReadonlyArray<string> | undefined,
    platformOrOptions: NodeJS.Platform | NormalizeWorkspaceUriOptions = process.platform,
): boolean {
    const normOptions = resolveNormOptions(platformOrOptions);
    const targetSet = buildNormalizedWorkspaceSet(workspaceUris, normOptions);
    return trajectoryMatchesWorkspaceSet(summary, targetSet, normOptions);
}

/**
 * Filter trajectories to those matching ANY root in a multi-root workspace folder list.
 * When `workspaceUris` is empty/undefined, returns all trajectories unchanged.
 */
export function filterTrajectoriesByWorkspaces<T extends ConversationTrajectoryLike>(
    trajectories: ReadonlyArray<T>,
    workspaceUris: ReadonlyArray<string> | undefined,
    platformOrOptions: NodeJS.Platform | NormalizeWorkspaceUriOptions = process.platform,
): T[] {
    const normOptions = resolveNormOptions(platformOrOptions);
    const targetSet = buildNormalizedWorkspaceSet(workspaceUris, normOptions);
    if (targetSet.size === 0) {
        return [...trajectories];
    }
    return trajectories.filter(t => trajectoryMatchesWorkspaceSet(t, targetSet, normOptions));
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

const COORDINATOR_OR_MAIN_ROLE_PATTERN = /^(?:coordinator|main|root|user|orchestrator)$/i;
const FORK_TYPE_PATTERN = /(?:^|[_-])FORK(?:$|[_-])/i;
const NON_AGENT_SPAWNED_BY_PATTERN = /^(?:user|human|manual|fork)$/i;

function isForkedChatTrajectory(summary: ConversationTrajectoryLike, meta: Record<string, unknown> | null): boolean {
    if (summary.isFork === true || meta?.isFork === true) {
        return true;
    }
    if (nonEmptyString(summary.forkedFromCascadeId) || nonEmptyString(meta?.forkedFromCascadeId)) {
        return true;
    }
    const types = [
        nonEmptyString(summary.trajectoryType),
        nonEmptyString(meta?.trajectoryType),
        nonEmptyString(meta?.kind),
    ].filter(Boolean);
    return types.some(t => FORK_TYPE_PATTERN.test(t));
}

/**
 * Detect whether a trajectory belongs to a subagent / swarm worker / child agent.
 *
 * Precedence & §3.3 safety invariants:
 * - Explicit coordinator / main role (`coordinator`, `main`, `root`, `user`, `orchestrator`)
 *   is NEVER overridden by title, branch, worktree, or `swarmId` heuristics.
 * - Forked chats retaining `parentCascadeId` are independent main roots, NOT subagents.
 * - Unknown `role` values MUST NOT auto-classify as worker/subagent.
 * - Uses authoritative structural metadata first (`knownSubagentIds`, `isSubagent`,
 *   known worker roles, non-fork `parentCascadeId`, `trajectoryType`, agent `spawnedBy`),
 *   followed by Swarm worktree/branch and strictly anchored title prefixes.
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

    const roles = [
        nonEmptyString(summary.role),
        nonEmptyString(summary.agentRole),
        nonEmptyString(summary.agentType),
        nonEmptyString(meta?.role),
        nonEmptyString(meta?.agentRole),
        nonEmptyString(meta?.agentType),
        nonEmptyString(meta?.kind),
    ].filter(Boolean);

    const isExplicitMainOrCoordinator = roles.some(r => COORDINATOR_OR_MAIN_ROLE_PATTERN.test(r));
    if (isExplicitMainOrCoordinator) {
        // Explicit coordinator/main marker NEVER yields to title/branch/worktree/swarm heuristics
        return false;
    }

    const isFork = isForkedChatTrajectory(summary, meta);
    if (isFork) {
        // Forked chats retaining parentCascadeId are independent roots, NOT subagents
        return false;
    }

    // Explicit known worker/subagent roles (unknown roles MUST NOT auto-classify as worker!)
    for (const role of roles) {
        if (SUBAGENT_ROLE_PATTERN.test(role)) {
            return true;
        }
    }

    // Parent linkage (must be non-empty, distinct from self, and not a fork)
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

    const spawnedBy = nonEmptyString(summary.spawnedBy) || nonEmptyString(meta?.spawnedBy);
    if (spawnedBy && !NON_AGENT_SPAWNED_BY_PATTERN.test(spawnedBy)) {
        return true;
    }

    // Note: Having `swarmId` with an unrecognized `role` MUST NOT auto-classify as worker!
    // Only recognized worker roles (checked above) or worktree/branch/title heuristics below apply
    // when no unrecognized explicit role contradicts them.
    const hasUnknownExplicitRole = roles.length > 0;
    if (hasUnknownExplicitRole) {
        return false;
    }

    // Antigravity-managed Swarm worker worktrees & worker branches
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
    normOptions: NormalizeWorkspaceUriOptions,
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
        const activeInWs = trajectoryMatchesWorkspaceSet(active, workspaceSet, normOptions);
        const candInWs = trajectoryMatchesWorkspaceSet(candidate, workspaceSet, normOptions);
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
    normOptions: NormalizeWorkspaceUriOptions,
    currentActiveId?: string | null,
    currentActiveSinceMs = 0,
    strictWorkspaceIsolation = false,
): { target: ConversationTrajectoryLike | null; reason: string } {
    if (candidates.length === 0) {
        return { target: null, reason: 'no_candidates' };
    }

    const sorted = [...candidates].sort(compareRecencyDesc);
    const inWorkspace = workspaceSet.size > 0
        ? sorted.filter(t => trajectoryMatchesWorkspaceSet(t, workspaceSet, normOptions))
        : [];
    const eligiblePool = (strictWorkspaceIsolation && workspaceSet.size > 0)
        ? sorted.filter(t =>
            trajectoryMatchesWorkspaceSet(t, workspaceSet, normOptions)
            || extractTrajectoryWorkspaceUris(t).length === 0,
        )
        : sorted;
    if (eligiblePool.length === 0) {
        return { target: null, reason: 'no_workspace_candidates' };
    }
    const activeCandidate = currentActiveId
        ? eligiblePool.find(t => t.cascadeId === currentActiveId)
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
        && (!activeCandidate || shouldRunningCandidatePreemptActive(t, activeCandidate, workspaceSet, normOptions, currentActiveSinceMs)),
    );
    if (runningLocal) {
        return { target: runningLocal, reason: 'running_in_workspace' };
    }

    // 3. If no workspace filter, keep active RUNNING or pick most recent RUNNING globally
    if (workspaceSet.size === 0 && currentActiveId) {
        const activeRunning = eligiblePool.find(t => t.cascadeId === currentActiveId && isRunningTrajectory(t));
        if (activeRunning) {
            return { target: activeRunning, reason: 'active_running' };
        }
    }

    // Keep currently tracked RUNNING conversation even if it has no workspace URI yet (brand-new chat)
    if (activeCandidate && isRunningTrajectory(activeCandidate)) {
        return { target: activeCandidate, reason: 'active_running' };
    }

    const runningAny = eligiblePool.find(t =>
        isRunningTrajectory(t)
        && (!activeCandidate || shouldRunningCandidatePreemptActive(t, activeCandidate, workspaceSet, normOptions, currentActiveSinceMs)),
    );
    if (runningAny) {
        const unbound = extractTrajectoryWorkspaceUris(runningAny).length === 0;
        return {
            target: runningAny,
            reason: workspaceSet.size > 0
                ? (unbound ? 'running_unbound_workspace' : 'running_cross_workspace')
                : 'running_latest',
        };
    }

    // 4. Preserve currently tracked IDLE conversation against background lastModifiedTime bumps
    //    (only switch when another conversation has strictly newer user input or creation time).
    if (activeCandidate) {
        const activeEligibleForWorkspace = workspaceSet.size === 0
            || inWorkspace.length === 0
            || trajectoryMatchesWorkspaceSet(activeCandidate, workspaceSet, normOptions)
            || extractTrajectoryWorkspaceUris(activeCandidate).length === 0;
        if (activeEligibleForWorkspace) {
            const topIdlePool = inWorkspace.length > 0 ? inWorkspace : eligiblePool;
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

    // 6. Fallback: most recent eligible conversation
    return { target: eligiblePool[0], reason: strictWorkspaceIsolation && workspaceSet.size > 0 ? 'latest_unbound_workspace' : 'latest_overall' };
}

function pickNewestCreatedCandidate(
    candidates: readonly ConversationTrajectoryLike[],
    newlyCreatedIds: ReadonlySet<string> | undefined,
    workspaceSet: ReadonlySet<string>,
    normOptions: NormalizeWorkspaceUriOptions,
    strictWorkspaceIsolation = false,
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
            trajectoryMatchesWorkspaceSet(t, workspaceSet, normOptions)
            || extractTrajectoryWorkspaceUris(t).length === 0,
        );
        if (inWsOrUnbound.length > 0) {
            return inWsOrUnbound[0];
        }
        if (strictWorkspaceIsolation) {
            return null;
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
    const normOptions: NormalizeWorkspaceUriOptions = {
        platform: input.platform ?? process.platform,
        caseSensitive: input.caseSensitive,
        isCaseSensitivePath: input.isCaseSensitivePath,
        wslDistro: input.wslDistro,
    };
    const strictWorkspaceIsolation = input.strictWorkspaceIsolation === true;
    const isolateWorkers = input.isolateWorkers === true;
    const pinnedId = nonEmptyString(input.pinnedId);
    const inspectedMemberId = nonEmptyString(input.inspectedMemberId);
    const lockToMainAgent = input.lockToMainAgent === true;
    const prevLockedMainId = nonEmptyString(input.lockedMainId);
    const rawHostConversationId = nonEmptyString(input.hostConversationId);
    const currentActiveId = nonEmptyString(input.currentActiveId);
    const currentActiveSinceMs = typeof input.currentActiveSinceMs === 'number'
        && Number.isFinite(input.currentActiveSinceMs)
        && input.currentActiveSinceMs > 0
        ? input.currentActiveSinceMs
        : 0;
    const workspaceSet = buildNormalizedWorkspaceSet(input.workspaceUris, normOptions);
    const knownSubagents = input.knownSubagentIds;
    const newlyCreatedIds = input.newlyCreatedIds;
    const deletedIds = input.deletedConversationIds;
    const hostPendingAllowed = input.hostConversationPendingAllowed !== false;
    const hostFocusAuthority: FocusAuthorityLevel = input.hostFocusAuthority ?? 'host_sdk';
    const hostViewMode = nonEmptyString(input.hostViewMode).toLowerCase();

    // Level 3 (`cdp_passive`) anti-hijack filters (§3.2 #4):
    // - A visible composer alone NEVER establishes human new-chat intent.
    // - A first route UUID guess NEVER establishes host focus authority.
    // - SIDEBAR null focus NEVER clears or triggers blank-new-chat.
    const hostConversationId = (hostFocusAuthority === 'cdp_passive' && input.hostFocusInferredFromFirstUrlUuid === true)
        ? ''
        : rawHostConversationId;
    const hostNewConversationPending = input.hostNewConversationPending === true
        && !(hostFocusAuthority === 'cdp_passive' && input.hostFocusInferredFromComposer === true)
        && !(hostViewMode === 'sidebar' && !rawHostConversationId);
    const isUnfocusedSplitPaneHost = input.hostFocusIsFocusedPane === false;

    const sameBackendEpoch = input.backendEpoch === undefined
        || input.lockedRootEpoch === undefined
        || input.backendEpoch === input.lockedRootEpoch;
    const lockedRootConfirmedDeleted = Boolean(
        prevLockedMainId
        && sameBackendEpoch
        && deletedIds?.has(prevLockedMainId),
    );
    const hasActiveLockedRoot = lockToMainAgent && Boolean(prevLockedMainId) && !lockedRootConfirmedDeleted;

    const hostIdIsKnownSubagent = Boolean(hostConversationId && knownSubagents?.has(hostConversationId));
    const hostIdIsDeleted = Boolean(hostConversationId && deletedIds?.has(hostConversationId));

    const classifySubjectKind = (
        traj: ConversationTrajectoryLike | null | undefined,
        cid: string | null,
    ): 'main' | 'worker' | 'subagent' => {
        if (!cid) { return 'main'; }
        if (traj && !isSubagentTrajectory(traj, knownSubagents)) {
            return 'main';
        }
        const meta = asRecord(traj?.trajectoryMetadata);
        const role = (nonEmptyString(traj?.role) || nonEmptyString(meta?.role)).toLowerCase();
        if (role.includes('worker') || Boolean(nonEmptyString(traj?.swarmId) || nonEmptyString(meta?.swarmId))) {
            return 'worker';
        }
        if (traj && isSubagentTrajectory(traj, knownSubagents)) {
            return 'subagent';
        }
        if (knownSubagents?.has(cid)) {
            return 'subagent';
        }
        return 'main';
    };

    if (trajectories.length === 0) {
        // Explicit inspected member preserves lockedRootId even on transiently empty inventory
        if (inspectedMemberId) {
            return {
                target: null,
                cascadeId: inspectedMemberId,
                mode: lockToMainAgent ? 'locked_main' : 'auto_follow',
                lockedMainId: hasActiveLockedRoot ? prevLockedMainId : null,
                rootCascadeId: hasActiveLockedRoot ? prevLockedMainId : null,
                inspectedMemberId,
                pinnedFallback: false,
                ignoredSubagentBurst: false,
                lockPendingUnavailable: true,
                subjectKind: classifySubjectKind(null, inspectedMemberId),
                reason: 'inspected_member_pending_unavailable',
            };
        }

        // §3.2 Invariant #1: Active `lockedRootId` takes ABSOLUTE priority BEFORE empty/blank/pending-host branches!
        if (hasActiveLockedRoot) {
            const retargetOfferId = (hostConversationId && hostConversationId !== prevLockedMainId && !hostIdIsKnownSubagent && !hostIdIsDeleted)
                ? hostConversationId
                : null;
            return {
                target: null,
                cascadeId: prevLockedMainId,
                mode: 'locked_main',
                lockedMainId: prevLockedMainId,
                rootCascadeId: prevLockedMainId,
                inspectedMemberId: null,
                pinnedFallback: Boolean(pinnedId),
                ignoredSubagentBurst: hostIdIsKnownSubagent,
                hostPending: false,
                lockPendingUnavailable: true,
                retargetOfferId,
                subjectKind: 'main',
                reason: pinnedId ? 'pinned_missing_locked_main_pending_unavailable' : 'locked_main_pending_unavailable',
            };
        }

        if (!pinnedId && hostNewConversationPending) {
            return {
                target: null,
                cascadeId: null,
                mode: lockToMainAgent ? 'locked_main' : 'auto_follow',
                lockedMainId: null,
                rootCascadeId: null,
                inspectedMemberId: null,
                pinnedFallback: false,
                ignoredSubagentBurst: false,
                hostPending: true,
                subjectKind: 'main',
                reason: lockToMainAgent ? 'locked_main_new_conversation_pending' : 'host_new_conversation_pending',
            };
        }
        if (hostConversationId && hostPendingAllowed && !hostIdIsDeleted && !isUnfocusedSplitPaneHost && !(lockToMainAgent && hostIdIsKnownSubagent)) {
            return {
                target: null,
                cascadeId: hostConversationId,
                mode: lockToMainAgent ? 'locked_main' : 'auto_follow',
                lockedMainId: lockToMainAgent ? hostConversationId : null,
                rootCascadeId: lockToMainAgent ? hostConversationId : null,
                inspectedMemberId: null,
                pinnedFallback: Boolean(pinnedId),
                ignoredSubagentBurst: false,
                hostPending: true,
                subjectKind: 'main',
                reason: lockToMainAgent ? 'locked_main_host_pending' : 'host_conversation_pending',
            };
        }
        return {
            target: null,
            cascadeId: null,
            mode: pinnedId ? 'pinned' : (lockToMainAgent ? 'locked_main' : 'auto_follow'),
            lockedMainId: null,
            rootCascadeId: null,
            inspectedMemberId: null,
            pinnedFallback: Boolean(pinnedId),
            ignoredSubagentBurst: false,
            subjectKind: 'main',
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
        if (hasActiveLockedRoot) {
            return prevLockedMainId;
        }
        if (preferred && !isSubagentTrajectory(preferred, knownSubagents)) {
            return preferred.cascadeId;
        }
        if (prevLockedMainId && !lockedRootConfirmedDeleted) {
            const prev = byId.get(prevLockedMainId);
            if (prev && !isSubagentTrajectory(prev, knownSubagents)) {
                return prev.cascadeId;
            }
        }
        const bestMain = pickBestCandidate(
            mainTrajectories,
            workspaceSet,
            normOptions,
            currentActiveId,
            currentActiveSinceMs,
            strictWorkspaceIsolation,
        ).target;
        return bestMain ? bestMain.cascadeId : null;
    };

    // ── Mode 1: Manual Pin ───────────────────────────────────────────────────
    let pinnedFallback = false;
    if (pinnedId && !inspectedMemberId) {
        const pinned = byId.get(pinnedId);
        if (pinned) {
            const rootId = findFallbackMainId(pinned);
            return {
                target: pinned,
                cascadeId: pinned.cascadeId,
                mode: 'pinned',
                lockedMainId: rootId,
                rootCascadeId: rootId,
                inspectedMemberId: isSubagentTrajectory(pinned, knownSubagents) ? pinned.cascadeId : null,
                pinnedFallback: false,
                ignoredSubagentBurst: false,
                subjectKind: classifySubjectKind(pinned, pinned.cascadeId),
                reason: 'manual_pin',
            };
        }
        // Pinned conversation was deleted or is no longer returned -> fall through cleanly
        pinnedFallback = true;
    }

    // ── Mode 1b: Explicit Member Inspection (NEVER overwrites `lockedRootId`!) ─
    if (inspectedMemberId) {
        const inspectedConfirmedDeleted = Boolean(sameBackendEpoch && deletedIds?.has(inspectedMemberId));
        const inspected = byId.get(inspectedMemberId);
        const preservedRoot = hasActiveLockedRoot ? prevLockedMainId : findFallbackMainId(inspected);
        const memberRoot = input.topologyResolveRootId?.(inspectedMemberId) || preservedRoot;
        if (inspected && !inspectedConfirmedDeleted) {
            return {
                target: inspected,
                cascadeId: inspected.cascadeId,
                mode: lockToMainAgent ? 'locked_main' : 'auto_follow',
                lockedMainId: preservedRoot,
                rootCascadeId: memberRoot,
                inspectedMemberId: inspected.cascadeId,
                pinnedFallback,
                ignoredSubagentBurst: false,
                lockPendingUnavailable: hasActiveLockedRoot ? !byId.has(prevLockedMainId) : false,
                subjectKind: classifySubjectKind(inspected, inspected.cascadeId),
                reason: 'inspect_member',
            };
        }
        // The inventory can omit manifest-only and archived members for every poll.
        return {
            target: null,
            cascadeId: inspectedMemberId,
            mode: lockToMainAgent ? 'locked_main' : 'auto_follow',
            lockedMainId: preservedRoot,
            rootCascadeId: memberRoot,
            inspectedMemberId,
            pinnedFallback,
            ignoredSubagentBurst: false,
            lockPendingUnavailable: true,
            subjectKind: classifySubjectKind(null, inspectedMemberId),
            reason: 'inspect_member_pending_unavailable',
        };
    }

    // ── Mode 2: Lock to Main Agent (§3.2 Anti-Hijack Invariants) ─────────────
    if (lockToMainAgent) {
        const hostTarget = hostConversationId ? byId.get(hostConversationId) : undefined;
        const hostIsSubagent = Boolean(
            (hostTarget && isSubagentTrajectory(hostTarget, knownSubagents))
            || hostIdIsKnownSubagent,
        );
        const hasRunningSubagent = subagentTrajectories.some(isRunningTrajectory);

        // Compute advisory non-intrusive retarget offer if another main conversation appeared passively
        const computeRetargetOffer = (lockedId: string): string | null => {
            if (hostTarget && !hostIsSubagent && hostTarget.cascadeId !== lockedId) {
                return hostTarget.cascadeId;
            }
            if (hostConversationId && !hostTarget && !hostIsSubagent && !hostIdIsDeleted && hostConversationId !== lockedId) {
                return hostConversationId;
            }
            const freshMain = pickNewestCreatedCandidate(
                mainTrajectories.filter(t => t.cascadeId !== lockedId),
                newlyCreatedIds,
                workspaceSet,
                normOptions,
                strictWorkspaceIsolation,
            );
            return freshMain ? freshMain.cascadeId : null;
        };

        // §3.2 Invariant #1: Existing `lockedRootId` (NOT confirmed deleted in current `backendEpoch`)
        // takes ABSOLUTE priority BEFORE blank-new-chat, unseen-host-ID, child-only, hostConversationId,
        // newlyCreatedIds, SIDEBAR null focus, and ALL background activity!
        if (hasActiveLockedRoot) {
            const lockedObj = byId.get(prevLockedMainId);
            const retargetOfferId = computeRetargetOffer(prevLockedMainId);
            if (lockedObj) {
                const chosenTime = getTimestampScore(lockedObj);
                const newerSubagentExists = subagentTrajectories.some(s => getTimestampScore(s) > chosenTime);
                const ignoredSubagentBurst = hostIsSubagent || hasRunningSubagent || newerSubagentExists;
                return {
                    target: lockedObj,
                    cascadeId: lockedObj.cascadeId,
                    mode: 'locked_main',
                    lockedMainId: lockedObj.cascadeId,
                    rootCascadeId: lockedObj.cascadeId,
                    inspectedMemberId: null,
                    pinnedFallback,
                    ignoredSubagentBurst,
                    hostPending: false,
                    lockPendingUnavailable: false,
                    retargetOfferId,
                    subjectKind: 'main',
                    reason: pinnedFallback ? 'pinned_missing_locked_main_preserved' : 'locked_main_preserved',
                };
            }
            // Transient absence (NOT confirmed deleted in same backendEpoch) — e.g. LS omitted it or only
            // children are visible right now: preserve `lockedRootId` and surface `lockPendingUnavailable: true`!
            return {
                target: null,
                cascadeId: prevLockedMainId,
                mode: 'locked_main',
                lockedMainId: prevLockedMainId,
                rootCascadeId: prevLockedMainId,
                inspectedMemberId: null,
                pinnedFallback,
                ignoredSubagentBurst: hostIsSubagent || hasRunningSubagent,
                hostPending: false,
                lockPendingUnavailable: true,
                retargetOfferId,
                subjectKind: 'main',
                reason: pinnedFallback ? 'pinned_missing_locked_main_pending_unavailable' : 'locked_main_pending_unavailable',
            };
        }

        // Below here: NO active locked root yet (or previous locked root was confirmed deleted in same epoch).
        if (hostNewConversationPending) {
            return {
                target: null,
                cascadeId: null,
                mode: 'locked_main',
                lockedMainId: findFallbackMainId(),
                rootCascadeId: findFallbackMainId(),
                inspectedMemberId: null,
                pinnedFallback,
                ignoredSubagentBurst: hasRunningSubagent,
                hostPending: true,
                subjectKind: 'main',
                reason: pinnedFallback
                    ? 'pinned_missing_locked_main_new_conversation_pending'
                    : 'locked_main_new_conversation_pending',
            };
        }

        if (hostConversationId && !hostTarget && !hostIsSubagent && !hostIdIsDeleted && hostPendingAllowed && !isUnfocusedSplitPaneHost) {
            return {
                target: null,
                cascadeId: hostConversationId,
                mode: 'locked_main',
                lockedMainId: hostConversationId,
                rootCascadeId: hostConversationId,
                inspectedMemberId: null,
                pinnedFallback,
                ignoredSubagentBurst: hasRunningSubagent,
                hostPending: true,
                subjectKind: 'main',
                reason: pinnedFallback
                    ? 'pinned_missing_locked_main_host_pending'
                    : 'locked_main_host_pending',
            };
        }

        if (mainTrajectories.length === 0) {
            // Only subagent trajectories exist and NO locked root is anchored
            const fallback = pickBestCandidate(
                uniqueTrajectories,
                workspaceSet,
                normOptions,
                currentActiveId,
                currentActiveSinceMs,
                strictWorkspaceIsolation,
            );
            return {
                target: fallback.target,
                cascadeId: fallback.target?.cascadeId ?? null,
                mode: 'locked_main',
                lockedMainId: null,
                rootCascadeId: null,
                inspectedMemberId: null,
                pinnedFallback,
                ignoredSubagentBurst: false,
                subjectKind: classifySubjectKind(fallback.target, fallback.target?.cascadeId ?? null),
                reason: pinnedFallback ? 'pinned_missing_fallback_subagent_only' : 'fallback_subagent_only',
            };
        }

        let chosen: ConversationTrajectoryLike | null = null;
        let reason = 'locked_main_latest';

        // Initial anchor acquisition when no locked root exists yet
        if (hostTarget && !hostIsSubagent && !isUnfocusedSplitPaneHost) {
            chosen = hostTarget;
            reason = 'locked_main_host';
        }
        if (!chosen) {
            const freshMain = pickNewestCreatedCandidate(
                mainTrajectories,
                newlyCreatedIds,
                workspaceSet,
                normOptions,
                strictWorkspaceIsolation,
            );
            if (freshMain) {
                chosen = freshMain;
                reason = 'locked_main_new_conversation';
            }
        }
        if (!chosen && currentActiveId) {
            const active = byId.get(currentActiveId);
            if (active && !isSubagentTrajectory(active, knownSubagents)) {
                const wsOk = !strictWorkspaceIsolation
                    || workspaceSet.size === 0
                    || trajectoryMatchesWorkspaceSet(active, workspaceSet, normOptions)
                    || extractTrajectoryWorkspaceUris(active).length === 0;
                if (wsOk) {
                    chosen = active;
                    reason = 'locked_main_active';
                }
            }
        }
        if (!chosen) {
            const bestMain = pickBestCandidate(
                mainTrajectories,
                workspaceSet,
                normOptions,
                currentActiveId,
                currentActiveSinceMs,
                strictWorkspaceIsolation,
            );
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
            rootCascadeId: chosen?.cascadeId ?? null,
            inspectedMemberId: null,
            pinnedFallback,
            ignoredSubagentBurst,
            lockPendingUnavailable: false,
            retargetOfferId: null,
            subjectKind: 'main',
            reason: pinnedFallback ? `pinned_missing_${reason}` : reason,
        };
    }

    // ── Mode 3: Auto-Follow (Unlocked Navigation) ────────────────────────────
    if (hostNewConversationPending) {
        return {
            target: null,
            cascadeId: null,
            mode: 'auto_follow',
            lockedMainId: findFallbackMainId(),
            rootCascadeId: findFallbackMainId(),
            inspectedMemberId: null,
            pinnedFallback,
            ignoredSubagentBurst: false,
            hostPending: true,
            subjectKind: 'main',
            reason: pinnedFallback ? 'pinned_missing_host_new_conversation_pending' : 'host_new_conversation_pending',
        };
    }

    let unfocusedRetargetOfferId: string | null = null;
    if (hostConversationId) {
        const hostTarget = byId.get(hostConversationId);
        const hostIsSubagent = Boolean(
            (hostTarget && isSubagentTrajectory(hostTarget, knownSubagents))
            || hostIdIsKnownSubagent,
        );

        // Unfocused split pane passive observation: NEVER passively hijack active conversation; offer Retarget!
        if (isUnfocusedSplitPaneHost && currentActiveId && hostConversationId !== currentActiveId && byId.has(currentActiveId)) {
            if (!hostIsSubagent && !hostIdIsDeleted) {
                unfocusedRetargetOfferId = hostConversationId;
            }
        } else if (hostTarget) {
            // In worker-isolated unlocked auto-follow, do not accept passive Level-3 CDP worker guesses over active main
            const passiveWorkerBlocked = isolateWorkers
                && hostIsSubagent
                && hostFocusAuthority === 'cdp_passive'
                && mainTrajectories.length > 0;
            if (!passiveWorkerBlocked) {
                const rootId = findFallbackMainId(hostTarget);
                return {
                    target: hostTarget,
                    cascadeId: hostTarget.cascadeId,
                    mode: 'auto_follow',
                    lockedMainId: rootId,
                    rootCascadeId: rootId,
                    inspectedMemberId: null,
                    pinnedFallback,
                    ignoredSubagentBurst: false,
                    subjectKind: classifySubjectKind(hostTarget, hostTarget.cascadeId),
                    reason: pinnedFallback ? 'pinned_missing_host_conversation' : 'host_conversation',
                };
            }
        } else if (!hostIdIsDeleted && hostPendingAllowed && !isUnfocusedSplitPaneHost) {
            // Unlocked navigation: hold cleanly at pending 0% for unseen non-deleted host conversation!
            const rootId = findFallbackMainId();
            return {
                target: null,
                cascadeId: hostConversationId,
                mode: 'auto_follow',
                lockedMainId: rootId,
                rootCascadeId: rootId,
                inspectedMemberId: null,
                pinnedFallback,
                ignoredSubagentBurst: false,
                hostPending: true,
                subjectKind: 'main',
                reason: pinnedFallback ? 'pinned_missing_host_conversation_pending' : 'host_conversation_pending',
            };
        }
    }

    // Newly created main conversation takes immediate precedence (never newly spawned swarm workers/subagents)
    const newlyCreatedMain = pickNewestCreatedCandidate(
        mainTrajectories,
        newlyCreatedIds,
        workspaceSet,
        normOptions,
        strictWorkspaceIsolation,
    );
    if (newlyCreatedMain) {
        return {
            target: newlyCreatedMain,
            cascadeId: newlyCreatedMain.cascadeId,
            mode: 'auto_follow',
            lockedMainId: newlyCreatedMain.cascadeId,
            rootCascadeId: newlyCreatedMain.cascadeId,
            inspectedMemberId: null,
            pinnedFallback,
            ignoredSubagentBurst: subagentTrajectories.some(isRunningTrajectory),
            retargetOfferId: unfocusedRetargetOfferId,
            subjectKind: 'main',
            reason: pinnedFallback ? 'pinned_missing_new_main_conversation' : 'new_main_conversation',
        };
    }

    // Prevent concurrent background subagents / swarm workers from hijacking context display
    const currentActiveObj = currentActiveId ? byId.get(currentActiveId) : undefined;
    const currentActiveIsMain = Boolean(currentActiveObj && !isSubagentTrajectory(currentActiveObj, knownSubagents));
    const hasRunningMain = mainTrajectories.some(isRunningTrajectory);
    const restrictToMain = mainTrajectories.length > 0 && (isolateWorkers || currentActiveIsMain || hasRunningMain);
    const autoCandidates = restrictToMain ? mainTrajectories : uniqueTrajectories;

    const best = pickBestCandidate(
        autoCandidates,
        workspaceSet,
        normOptions,
        currentActiveId,
        currentActiveSinceMs,
        strictWorkspaceIsolation,
    );
    const ignoredSubagentBurst = restrictToMain && subagentTrajectories.some(isRunningTrajectory);
    const rootId = findFallbackMainId(best.target);
    return {
        target: best.target,
        cascadeId: best.target?.cascadeId ?? null,
        mode: 'auto_follow',
        lockedMainId: rootId,
        rootCascadeId: rootId,
        inspectedMemberId: null,
        pinnedFallback,
        ignoredSubagentBurst,
        retargetOfferId: unfocusedRetargetOfferId,
        subjectKind: classifySubjectKind(best.target, best.target?.cascadeId ?? null),
        reason: pinnedFallback ? `pinned_missing_${best.reason}` : best.reason,
    };
}

// ─── Window-Scoped 3-Field Lock State Machine (§3.2) ─────────────────────────

export interface LockAnchorTopologyContext {
    trajectories?: ReadonlyArray<ConversationTrajectoryLike>;
    currentActiveId?: string | null;
    knownSubagentIds?: ReadonlySet<string>;
    workspaceUris?: ReadonlyArray<string>;
    platform?: NodeJS.Platform;
    caseSensitive?: boolean;
    isCaseSensitivePath?: (fsPath: string) => boolean | null;
    wslDistro?: string;
    /** Optional synchronous root resolver (e.g. `SwarmTopologyRegistry.resolveRootId`). */
    topologyResolveRootId?: (cascadeId: string) => string | null;
    /** Optional explicit parent map for upward root resolution. */
    parentByCascade?: ReadonlyMap<string, string | null>;
}

export interface SelectConversationInput {
    trajectories: ReadonlyArray<ConversationTrajectoryLike>;
    backendEpoch?: number;
    currentActiveId?: string | null;
    currentActiveSinceMs?: number;
    pinnedId?: string | null;
    workspaceUris?: ReadonlyArray<string>;
    knownSubagentIds?: ReadonlySet<string>;
    newlyCreatedIds?: ReadonlySet<string>;
    /** Confirmed deleted IDs scoped strictly to `input.backendEpoch` (NEVER single transient omission!). */
    deletedConversationIds?: ReadonlySet<string>;
    hostConversationPendingAllowed?: boolean;
    strictWorkspaceIsolation?: boolean;
    isolateWorkers?: boolean;
    platform?: NodeJS.Platform;
    caseSensitive?: boolean;
    isCaseSensitivePath?: (fsPath: string) => boolean | null;
    wslDistro?: string;
    topologyResolveRootId?: (cascadeId: string) => string | null;
    parentByCascade?: ReadonlyMap<string, string | null>;
}

export interface WindowConversationSelectionResult {
    state: WindowSelectionState;
    resolution: ResolvedConversationTarget;
}

const AUTHORITY_RANK: Record<FocusAuthorityLevel, number> = {
    user_explicit: 3,
    host_sdk: 2,
    cdp_passive: 1,
};

function isWindowLocked(state: WindowSelectionState): boolean {
    if (typeof state.lockToMainAgent === 'boolean') {
        return state.lockToMainAgent;
    }
    return state.lockedRootId !== null;
}

/**
 * Create a clean per-window 3-field selection state bound to `(backendEpoch, windowId)`.
 */
export function createWindowSelectionState(params: {
    backendEpoch: number;
    windowId: string;
    lockedRootId?: string | null;
    lockToMainAgent?: boolean;
    inspectedMemberId?: string | null;
    observedHostFocus?: ObservedHostFocus | null;
    selectionRevision?: number;
}): WindowSelectionState {
    const lockedRootId = nonEmptyString(params.lockedRootId) || null;
    const lockToMainAgent = typeof params.lockToMainAgent === 'boolean'
        ? params.lockToMainAgent
        : lockedRootId !== null;
    return {
        backendEpoch: Number.isFinite(params.backendEpoch) ? Math.floor(params.backendEpoch) : 1,
        windowId: nonEmptyString(params.windowId) || 'default',
        observedHostFocus: params.observedHostFocus ?? null,
        lockedRootId,
        inspectedMemberId: nonEmptyString(params.inspectedMemberId) || null,
        lockPendingUnavailable: false,
        retargetOfferId: null,
        selectionRevision: typeof params.selectionRevision === 'number' && Number.isFinite(params.selectionRevision)
            ? Math.max(0, Math.floor(params.selectionRevision))
            : 0,
        lockToMainAgent,
        acknowledgedFocusRevision: params.observedHostFocus?.focusRevision ?? 0,
    };
}

/**
 * Synchronously walk upward from `cascadeId` to its authoritative root conversation ID
 * using topology registry, parent map, and trajectory metadata, with `visited` Set
 * cycle protection and fork boundaries.
 */
export function resolveRootCascadeIdSync(
    cascadeId: string | null | undefined,
    context: LockAnchorTopologyContext = {},
): string | null {
    const start = nonEmptyString(cascadeId);
    if (!start) { return null; }

    const byId = new Map<string, ConversationTrajectoryLike>();
    if (Array.isArray(context.trajectories)) {
        for (const t of context.trajectories) {
            const id = nonEmptyString(t?.cascadeId);
            if (id && !byId.has(id)) {
                byId.set(id, t);
            }
        }
    }

    const visited = new Set<string>([start]);
    let current = start;

    for (let depth = 0; depth < 32; depth++) {
        const traj = byId.get(current);
        const meta = asRecord(traj?.trajectoryMetadata);

        // Forked chats are their own roots — stop walking upward
        if (traj && isForkedChatTrajectory(traj, meta)) {
            return current;
        }

        // 1. Authoritative topology registry resolver (if provided)
        if (context.topologyResolveRootId) {
            const topoRoot = nonEmptyString(context.topologyResolveRootId(current));
            if (topoRoot && topoRoot !== current && !visited.has(topoRoot)) {
                visited.add(topoRoot);
                current = topoRoot;
                continue;
            }
        }

        // 2. Explicit parent map (if provided)
        if (context.parentByCascade) {
            const mapParent = nonEmptyString(context.parentByCascade.get(current));
            if (mapParent && mapParent !== current && !visited.has(mapParent)) {
                visited.add(mapParent);
                current = mapParent;
                continue;
            }
        }

        // 3. Trajectory structural parent fields (non-fork)
        if (traj) {
            const parents = [
                nonEmptyString(traj.parentCascadeId),
                nonEmptyString(traj.parentTrajectoryId),
                nonEmptyString(traj.parentConversationId),
                nonEmptyString(meta?.parentCascadeId),
                nonEmptyString(meta?.parentTrajectoryId),
                nonEmptyString(meta?.parentConversationId),
            ].filter(Boolean);
            const nextParent = parents.find(p => p !== current && p !== nonEmptyString(traj.trajectoryId) && !visited.has(p));
            if (nextParent) {
                visited.add(nextParent);
                current = nextParent;
                continue;
            }
        }

        return current;
    }

    return current;
}

/**
 * Level 1 explicit user action: Enable Lock to Main Agent synchronously!
 * Immediately anchors `lockedRootId` without awaiting persistence; if currently
 * inspecting or tracking a worker/subagent, walks topology upward synchronously
 * to anchor its `rootId`.
 */
export function enableLockToMainAgent(
    state: WindowSelectionState,
    context: LockAnchorTopologyContext = {},
): WindowSelectionState {
    const trajectories = Array.isArray(context.trajectories) ? context.trajectories : [];
    const byId = new Map<string, ConversationTrajectoryLike>();
    for (const t of trajectories) {
        const id = nonEmptyString(t?.cascadeId);
        if (id && !byId.has(id)) { byId.set(id, t); }
    }

    const activeSubject = nonEmptyString(state.inspectedMemberId)
        || nonEmptyString(context.currentActiveId)
        || nonEmptyString(state.observedHostFocus?.cascadeId)
        || nonEmptyString(state.lockedRootId)
        || null;

    let anchoredRoot: string | null = null;
    if (activeSubject) {
        const walked = resolveRootCascadeIdSync(activeSubject, context);
        if (walked) {
            const walkedObj = byId.get(walked);
            // If walked target is a known main (or isn't contradicted as a subagent), anchor it!
            if (!walkedObj || !isSubagentTrajectory(walkedObj, context.knownSubagentIds)) {
                anchoredRoot = walked;
            }
        }
    }

    if (!anchoredRoot && trajectories.length > 0) {
        const normOptions: NormalizeWorkspaceUriOptions = {
            platform: context.platform ?? process.platform,
            caseSensitive: context.caseSensitive,
            isCaseSensitivePath: context.isCaseSensitivePath,
            wslDistro: context.wslDistro,
        };
        const workspaceSet = buildNormalizedWorkspaceSet(context.workspaceUris, normOptions);
        const mainTrajectories = trajectories.filter(t => !isSubagentTrajectory(t, context.knownSubagentIds));
        const best = pickBestCandidate(mainTrajectories, workspaceSet, normOptions, context.currentActiveId).target;
        anchoredRoot = best?.cascadeId ?? null;
    }

    return {
        ...state,
        lockToMainAgent: true,
        lockedRootId: anchoredRoot,
        lockPendingUnavailable: Boolean(anchoredRoot && trajectories.length > 0 && !byId.has(anchoredRoot)),
        retargetOfferId: null,
        selectionRevision: state.selectionRevision + 1,
    };
}

/**
 * Level 1 explicit user action: Disable Lock to Main Agent.
 */
export function disableLockToMainAgent(state: WindowSelectionState): WindowSelectionState {
    return {
        ...state,
        lockToMainAgent: false,
        lockedRootId: null,
        lockPendingUnavailable: false,
        retargetOfferId: null,
        selectionRevision: state.selectionRevision + 1,
    };
}

/**
 * Level 1 explicit user action: Inspect a swarm worker / subagent member.
 * Temporarily selects the member and remembers the initial return target without changing the root lock.
 */
export function inspectMember(
    state: WindowSelectionState,
    memberCascadeId: string,
    currentCascadeId?: string | null,
): WindowSelectionState {
    const clean = nonEmptyString(memberCascadeId);
    if (!clean) { return state; }
    return {
        ...state,
        inspectedMemberId: clean,
        inspectionReturnId: state.inspectedMemberId ? state.inspectionReturnId : currentCascadeId,
        selectionRevision: state.selectionRevision + 1,
    };
}

/**
 * Level 1 explicit user action: "Back to Main" — clears `inspectedMemberId`
 * and restores `lockedRootId` instantly.
 */
export function clearInspect(state: WindowSelectionState): WindowSelectionState {
    if (state.inspectedMemberId === null) {
        return state;
    }
    return {
        ...state,
        inspectedMemberId: null,
        inspectionReturnId: null,
        selectionRevision: state.selectionRevision + 1,
    };
}

/**
 * Level 1 explicit user action: Retarget `lockedRootId` to a new main conversation.
 * Clears any active `inspectedMemberId`, `lockPendingUnavailable`, and `retargetOfferId`.
 */
export function retargetLockedRoot(
    state: WindowSelectionState,
    newRootId: string,
    context?: LockAnchorTopologyContext,
): WindowSelectionState {
    const clean = nonEmptyString(newRootId);
    if (!clean) { return state; }
    const resolvedRoot = context ? (resolveRootCascadeIdSync(clean, context) ?? clean) : clean;
    return {
        ...state,
        lockToMainAgent: true,
        lockedRootId: resolvedRoot,
        inspectedMemberId: null,
        inspectionReturnId: null,
        lockPendingUnavailable: false,
        retargetOfferId: null,
        selectionRevision: state.selectionRevision + 1,
    };
}

/**
 * Record an observed host focus event into `state.observedHostFocus` obeying
 * strict authority grading (Level 1 > Level 2 > Level 3), monotonic `focusRevision`,
 * `backendEpoch` verification, and SIDEBAR / passive CDP anti-hijack guards.
 *
 * NEVER modifies `lockedRootId` or `inspectedMemberId`!
 */
export function recordObservedHostFocus(
    state: WindowSelectionState,
    incoming: ObservedHostFocus,
    options: { backendEpoch?: number } = {},
): { state: WindowSelectionState; accepted: boolean; reason: string } {
    if (options.backendEpoch !== undefined && options.backendEpoch !== state.backendEpoch) {
        return { state, accepted: false, reason: 'stale_backend_epoch' };
    }

    const viewMode = nonEmptyString(incoming.viewMode).toLowerCase();
    const cleanId = nonEmptyString(incoming.cascadeId) || null;

    // Level 3 passive CDP anti-hijack guards
    if (incoming.authority === 'cdp_passive') {
        if (incoming.inferredFromFirstUrlUuid === true) {
            return { state, accepted: false, reason: 'rejected_cdp_first_url_uuid' };
        }
    }

    // SIDEBAR null focus must NEVER erase an existing non-null observed host focus
    if (viewMode === 'sidebar' && cleanId === null && incoming.isNewConversation !== true) {
        return { state, accepted: false, reason: 'ignored_sidebar_null_focus' };
    }

    const sanitizedIsNew = incoming.isNewConversation === true
        && !(incoming.authority === 'cdp_passive' && incoming.inferredFromVisibleComposer === true);

    if (incoming.authority === 'cdp_passive' && incoming.inferredFromVisibleComposer === true && cleanId === null) {
        return { state, accepted: false, reason: 'rejected_cdp_visible_composer_new_chat' };
    }

    const sanitized: ObservedHostFocus = {
        ...incoming,
        cascadeId: cleanId,
        isNewConversation: sanitizedIsNew,
    };

    const prev = state.observedHostFocus;
    if (prev) {
        const prevRank = AUTHORITY_RANK[prev.authority];
        const nextRank = AUTHORITY_RANK[sanitized.authority];

        // Monotonic revision: reject older revisions unless strictly higher authority
        if (sanitized.focusRevision < prev.focusRevision && nextRank <= prevRank) {
            return { state, accepted: false, reason: 'stale_focus_revision' };
        }
        // Lower authority NEVER displaces a higher authority observation at equal or lower revision
        if (nextRank < prevRank && (sanitized.isFocusedPane !== false || sanitized.focusRevision <= prev.focusRevision)) {
            return { state, accepted: false, reason: 'lower_authority_rejected' };
        }
        // Live SDK callback beats stale non-empty getter at equal revision
        if (
            sanitized.authority === 'host_sdk'
            && prev.authority === 'host_sdk'
            && sanitized.sourceInstanceId === prev.sourceInstanceId
            && prev.fromSdkCallback === true
            && sanitized.fromSdkCallback !== true
        ) {
            return { state, accepted: false, reason: 'stale_sdk_getter_rejected' };
        }
    }

    const nextAck = Math.max(state.acknowledgedFocusRevision ?? 0, sanitized.focusRevision);
    return {
        state: {
            ...state,
            observedHostFocus: sanitized,
            acknowledgedFocusRevision: nextAck,
        },
        accepted: true,
        reason: 'focus_recorded',
    };
}

/**
 * Advance the window state to a new `backendEpoch` (e.g. LS reconnect / restart).
 * Resets epoch-bound host focus & offers while preserving `lockedRootId` by default
 * (marking `lockPendingUnavailable: true` until the new epoch confirms it or user unlocks/retargets).
 */
export function advanceWindowBackendEpoch(
    state: WindowSelectionState,
    nextBackendEpoch: number,
    options: { clearLock?: boolean } = {},
): WindowSelectionState {
    const cleanEpoch = Number.isFinite(nextBackendEpoch) ? Math.floor(nextBackendEpoch) : state.backendEpoch + 1;
    if (cleanEpoch === state.backendEpoch) {
        return state;
    }
    const keepLock = options.clearLock !== true && isWindowLocked(state) && state.lockedRootId !== null;
    return {
        ...state,
        backendEpoch: cleanEpoch,
        observedHostFocus: null,
        lockedRootId: keepLock ? state.lockedRootId : null,
        lockToMainAgent: keepLock ? true : false,
        inspectedMemberId: null,
        inspectionReturnId: null,
        lockPendingUnavailable: keepLock,
        retargetOfferId: null,
        acknowledgedFocusRevision: 0,
        selectionRevision: state.selectionRevision + 1,
    };
}

/**
 * Window-scoped 3-field conversation resolver (`selectConversation`, §3.2).
 *
 * Enforces all 5 lock invariants:
 * 1. Active `lockedRootId` (not confirmed deleted in current `backendEpoch`) wins BEFORE
 *    blank-new-chat, unseen-host-ID, child-only, `hostConversationId`, `newlyCreatedIds`,
 *    `SIDEBAR` null focus, and ALL background activity.
 * 2. Inspecting a member (`inspectedMemberId`) displays that member while NEVER overwriting
 *    `lockedRootId`; `clearInspect()` restores `lockedRootId` instantly.
 * 3. Transient absence preserves `lockedRootId` with `lockPendingUnavailable: true` instead of
 *    evicting it or treating a single omission as deletion.
 * 4. Strict Level 1 > Level 2 > Level 3 authority grading (passive CDP guesses never hijack).
 * 5. Unfocused split-pane or locked alternate main surfaces non-intrusive `retargetOfferId`.
 */
export function selectConversation(
    state: WindowSelectionState,
    input: SelectConversationInput,
): WindowConversationSelectionResult {
    const effectiveEpoch = input.backendEpoch ?? state.backendEpoch;
    const locked = isWindowLocked(state);
    const focus = state.observedHostFocus;

    const resolution = resolveTargetConversation({
        trajectories: input.trajectories,
        pinnedId: input.pinnedId,
        inspectedMemberId: state.inspectedMemberId,
        lockToMainAgent: locked,
        lockedMainId: state.lockedRootId,
        backendEpoch: effectiveEpoch,
        lockedRootEpoch: state.backendEpoch,
        hostConversationId: focus?.cascadeId ?? null,
        hostNewConversationPending: focus?.isNewConversation === true,
        hostFocusAuthority: focus?.authority ?? 'host_sdk',
        hostFocusInferredFromComposer: focus?.inferredFromVisibleComposer === true,
        hostFocusInferredFromFirstUrlUuid: focus?.inferredFromFirstUrlUuid === true,
        hostFocusIsFocusedPane: focus?.isFocusedPane,
        hostViewMode: focus?.viewMode,
        currentActiveId: input.currentActiveId,
        currentActiveSinceMs: input.currentActiveSinceMs,
        workspaceUris: input.workspaceUris,
        knownSubagentIds: input.knownSubagentIds,
        newlyCreatedIds: input.newlyCreatedIds,
        deletedConversationIds: input.deletedConversationIds,
        hostConversationPendingAllowed: input.hostConversationPendingAllowed,
        strictWorkspaceIsolation: input.strictWorkspaceIsolation,
        isolateWorkers: input.isolateWorkers,
        platform: input.platform,
        caseSensitive: input.caseSensitive,
        isCaseSensitivePath: input.isCaseSensitivePath,
        wslDistro: input.wslDistro,
        topologyResolveRootId: input.topologyResolveRootId,
    });

    // Compute updated state without ever losing lockedRootId on transient absence or worker inspect!
    const lockedRootConfirmedDeleted = Boolean(
        state.lockedRootId
        && effectiveEpoch === state.backendEpoch
        && input.deletedConversationIds?.has(state.lockedRootId),
    );
    const nextLockedRootId = locked
        ? (state.lockedRootId && !lockedRootConfirmedDeleted
            ? state.lockedRootId
            : (resolution.lockedMainId ?? null))
        : null;
    const nextPendingUnavailable = Boolean(resolution.lockPendingUnavailable);
    const nextRetargetOfferId = resolution.retargetOfferId ?? null;

    const stateChanged = nextLockedRootId !== state.lockedRootId
        || nextPendingUnavailable !== Boolean(state.lockPendingUnavailable)
        || nextRetargetOfferId !== (state.retargetOfferId ?? null);

    const nextState: WindowSelectionState = stateChanged
        ? {
            ...state,
            lockedRootId: nextLockedRootId,
            lockPendingUnavailable: nextPendingUnavailable,
            retargetOfferId: nextRetargetOfferId,
            selectionRevision: state.selectionRevision + 1,
        }
        : state;

    return { state: nextState, resolution };
}

/**
 * Worker-isolated, multi-root-aware conversation selector for IDE auto-follow.
 *
 * Guarantees:
 * - Manual pin always takes precedence while present (falls back cleanly if deleted).
 * - Subagent / swarm worker trajectories never hijack IDE auto-follow when non-worker
 *   conversations exist (and `ignoredSubagentBurst` reports filtered worker activity).
 * - When `workspaceUris` is non-empty and `strictWorkspaceIsolation` is enabled (default),
 *   auto-follow matches across ALL multi-root folders (preserving Remote-SSH authorities
 *   and respecting macOS case-sensitive APFS) and NEVER jumps into another explicit workspace.
 * - Detects `previousStepCounts` changes (including undo/rewind) on workspace-eligible
 *   non-worker trajectories when no trajectory is actively `RUNNING`.
 */
export function resolveIdeAutoFollowConversation(
    input: ResolveIdeAutoFollowInput,
): ResolvedConversationTarget {
    const trajectories = Array.isArray(input.trajectories) ? input.trajectories : [];
    const strictWorkspaceIsolation = input.strictWorkspaceIsolation !== false;
    const isolateWorkers = input.isolateWorkers !== false;
    const normOptions: NormalizeWorkspaceUriOptions = {
        platform: input.platform ?? process.platform,
        caseSensitive: input.caseSensitive,
        isCaseSensitivePath: input.isCaseSensitivePath,
        wslDistro: input.wslDistro,
    };
    const workspaceSet = buildNormalizedWorkspaceSet(input.workspaceUris, normOptions);
    const knownSubagents = input.knownSubagentIds;
    const currentActiveId = nonEmptyString(input.currentActiveId);

    // Delegate first when manual pin or lockToMainAgent is active, or when no stepCount change applies
    if (nonEmptyString(input.pinnedId) || input.lockToMainAgent === true) {
        return resolveTargetConversation({
            trajectories,
            pinnedId: input.pinnedId,
            lockToMainAgent: input.lockToMainAgent,
            lockedMainId: input.lockedMainId,
            currentActiveId: input.currentActiveId,
            currentActiveSinceMs: input.currentActiveSinceMs,
            workspaceUris: input.workspaceUris,
            knownSubagentIds: input.knownSubagentIds,
            newlyCreatedIds: input.newlyCreatedIds,
            strictWorkspaceIsolation,
            isolateWorkers,
            platform: normOptions.platform,
            caseSensitive: normOptions.caseSensitive,
            isCaseSensitivePath: normOptions.isCaseSensitivePath,
            wslDistro: normOptions.wslDistro,
        });
    }

    // Deduplicate and partition trajectories
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
    const restrictToMain = isolateWorkers && mainTrajectories.length > 0;
    const candidatePool = restrictToMain ? mainTrajectories : uniqueTrajectories;

    // Filter to multi-root workspace-eligible candidates when strict workspace isolation is active
    const eligibleCandidates = (strictWorkspaceIsolation && workspaceSet.size > 0)
        ? candidatePool.filter(t =>
            trajectoryMatchesWorkspaceSet(t, workspaceSet, normOptions)
            || extractTrajectoryWorkspaceUris(t).length === 0,
        )
        : candidatePool;

    // If no eligible trajectory is RUNNING and previousStepCounts detected a step change
    // on an eligible non-worker conversation, prefer the changed trajectory (tracked first).
    const hasEligibleRunning = eligibleCandidates.some(isRunningTrajectory);
    if (!hasEligibleRunning && input.previousStepCounts && input.previousStepCounts.size > 0 && eligibleCandidates.length > 0) {
        const sortedEligible = [...eligibleCandidates].sort(compareRecencyDesc);
        const changed = sortedEligible.filter(t => {
            const prev = input.previousStepCounts!.get(t.cascadeId);
            return prev !== undefined && (t.stepCount ?? 0) !== prev;
        });
        if (changed.length > 0) {
            const picked = (currentActiveId ? changed.find(t => t.cascadeId === currentActiveId) : undefined)
                ?? (!currentActiveId ? changed[0] : undefined);
            if (picked) {
                const prev = input.previousStepCounts.get(picked.cascadeId) ?? 0;
                const next = picked.stepCount ?? 0;
                const direction = next > prev ? 'increased' : 'decreased';
                return {
                    target: picked,
                    cascadeId: picked.cascadeId,
                    mode: 'auto_follow',
                    lockedMainId: !isSubagentTrajectory(picked, knownSubagents) ? picked.cascadeId : null,
                    pinnedFallback: false,
                    ignoredSubagentBurst: restrictToMain && subagentTrajectories.some(isRunningTrajectory),
                    reason: `ide_step_count_${direction}`,
                };
            }
        }
    }

    return resolveTargetConversation({
        trajectories,
        pinnedId: input.pinnedId,
        lockToMainAgent: false,
        lockedMainId: input.lockedMainId,
        currentActiveId: input.currentActiveId,
        currentActiveSinceMs: input.currentActiveSinceMs,
        workspaceUris: input.workspaceUris,
        knownSubagentIds: input.knownSubagentIds,
        newlyCreatedIds: input.newlyCreatedIds,
        strictWorkspaceIsolation,
        isolateWorkers,
        platform: normOptions.platform,
        caseSensitive: normOptions.caseSensitive,
        isCaseSensitivePath: normOptions.isCaseSensitivePath,
        wslDistro: normOptions.wslDistro,
    });
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

    const normOptions: NormalizeWorkspaceUriOptions = {
        platform: config.platform ?? process.platform,
        caseSensitive: config.caseSensitive,
        isCaseSensitivePath: config.isCaseSensitivePath,
        wslDistro: config.wslDistro,
    };
    const lang = config.lang ?? 'en';
    const excludeSubagents = config.excludeSubagents === true;
    const prioritizeWorkspace = config.prioritizeWorkspace !== false;
    const workspaceSet = buildNormalizedWorkspaceSet(config.workspaceUris, normOptions);
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
        const matchesWorkspace = trajectoryMatchesWorkspaceSet(traj, workspaceSet, normOptions);

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

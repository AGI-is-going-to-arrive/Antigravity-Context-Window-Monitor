/**
 * Shared Pure-Node Release Security & Supply-Chain Verification Core.
 *
 * Strictly zero `vscode` imports and zero external npm dependencies (pure Node
 * built-ins: `crypto`, `fs`, `path`, `zlib`).
 *
 * Single source of truth for:
 * - Semantic version parsing, comparison, and release-tag <-> plugin.json parity
 * - Strict HTTPS port-443 GitHub host allowlist validation
 * - Case-insensitive / lowercase-normalized SHA256SUMS.txt parsing & timing-safe verification
 * - Pure-Node safe PKZIP extraction with CRC-32, zip-slip, symlink, encryption, and zip-bomb guards
 * - Extracted plugin bundle validation
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export const EXPECTED_PLUGIN_NAME = 'antigravity-context-monitor';
export const APPROVED_GITHUB_REPO_OWNER = 'AGI-is-going-to-arrive';
export const APPROVED_GITHUB_REPO_NAME = 'Antigravity-Context-Window-Monitor';
export const APPROVED_GITHUB_REPO_SLUG = `${APPROVED_GITHUB_REPO_OWNER}/${APPROVED_GITHUB_REPO_NAME}`;
export const CHECKSUMS_ASSET_NAME = 'SHA256SUMS.txt';

export const MAX_REDIRECT_HOPS = 5;
export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
export const MAX_CHECKSUMS_BYTES = 256 * 1024;
export const MAX_API_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 2_000;
export const DEFAULT_UPDATE_LOCK_TIMEOUT_MS = 10_000;
export const DEFAULT_UPDATE_LOCK_STALE_MS = 5 * 60 * 1000;

export const ALLOWED_RELEASE_HOSTS: ReadonlySet<string> = new Set([
    'github.com',
    'api.github.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
]);

// ─── Semver Parsing, Comparison & Release Parity ─────────────────────────────

export interface SemverParts {
    major: number;
    minor: number;
    patch: number;
    prerelease: string[];
    normalized: string;
}

const SEMVER_RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseSemver(raw: string): SemverParts | null {
    if (typeof raw !== 'string') { return null; }
    const match = raw.trim().match(SEMVER_RE);
    if (!match) { return null; }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) {
        return null;
    }
    const prerelease = match[4] ? match[4].split('.') : [];
    if (prerelease.some(part => !part || /^0\d+$/.test(part))
        || match[5]?.split('.').some(part => !part)) { return null; }
    const normalized = `${major}.${minor}.${patch}${prerelease.length > 0 ? `-${prerelease.join('.')}` : ''}`;
    return { major, minor, patch, prerelease, normalized };
}

export function compareSemver(a: string, b: string): number {
    const pa = parseSemver(a);
    const pb = parseSemver(b);
    if (!pa || !pb) {
        throw new Error(`Invalid semantic version comparison: "${a}" vs "${b}"`);
    }
    if (pa.major !== pb.major) { return pa.major - pb.major; }
    if (pa.minor !== pb.minor) { return pa.minor - pb.minor; }
    if (pa.patch !== pb.patch) { return pa.patch - pb.patch; }

    // Stable release has higher precedence than a pre-release of the same version
    if (pa.prerelease.length === 0 && pb.prerelease.length === 0) { return 0; }
    if (pa.prerelease.length === 0) { return 1; }
    if (pb.prerelease.length === 0) { return -1; }

    const len = Math.max(pa.prerelease.length, pb.prerelease.length);
    for (let i = 0; i < len; i++) {
        if (i >= pa.prerelease.length) { return -1; }
        if (i >= pb.prerelease.length) { return 1; }
        const ia = pa.prerelease[i];
        const ib = pb.prerelease[i];
        if (ia === ib) { continue; }
        const numA = /^\d+$/.test(ia);
        const numB = /^\d+$/.test(ib);
        if (numA && numB) {
            return ia.length !== ib.length ? ia.length - ib.length : (ia < ib ? -1 : 1);
        }
        if (numA) { return -1; }
        if (numB) { return 1; }
        return ia < ib ? -1 : 1;
    }
    return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
    const pc = parseSemver(candidate);
    const pb = parseSemver(current);
    if (!pc || !pb) { return false; }
    return compareSemver(pc.normalized, pb.normalized) > 0;
}

/**
 * Enforce strict version parity between an extracted bundle's `plugin.json`
 * version and the expected GitHub release tag/version.
 */
export function assertReleaseVersionMatches(
    manifestVersion: string,
    expectedReleaseVersion: string,
): string {
    const parsedManifest = parseSemver(manifestVersion);
    if (!parsedManifest) {
        throw new Error(`Plugin bundle validation failed: invalid manifest semver "${manifestVersion}"`);
    }
    const parsedExpected = parseSemver(expectedReleaseVersion);
    if (!parsedExpected) {
        throw new Error(`Plugin bundle validation failed: invalid expected release semver "${expectedReleaseVersion}"`);
    }
    if (parsedManifest.normalized !== parsedExpected.normalized) {
        throw new Error(
            `Plugin bundle version mismatch: extracted plugin.json is v${parsedManifest.normalized}, expected release v${parsedExpected.normalized}`,
        );
    }
    return parsedManifest.normalized;
}

// ─── Strict HTTPS Port-443 GitHub Host Allowlist & Release Identity Binding ──

const REPO_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_TAG_SEGMENT_RE = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function validateRepoSlug(raw: string): string {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!REPO_SLUG_RE.test(trimmed)) {
        throw new Error(`Invalid GitHub repository slug: "${raw}"`);
    }
    return trimmed;
}

export function isApprovedReleaseRepo(repoSlug: string): boolean {
    if (typeof repoSlug !== 'string') { return false; }
    return repoSlug.trim().toLowerCase() === APPROVED_GITHUB_REPO_SLUG.toLowerCase();
}

export function expectedAppZipAssetName(version: string): string {
    const parsed = parseSemver(version);
    if (!parsed) {
        throw new Error(`Invalid release version for asset name: "${version}"`);
    }
    return `${EXPECTED_PLUGIN_NAME}-app-${parsed.normalized}.zip`;
}

export function buildApprovedReleaseApiUrl(
    tagOrVersion?: string,
    repoSlug: string = APPROVED_GITHUB_REPO_SLUG,
): string {
    const cleanRepo = validateRepoSlug(repoSlug);
    if (!tagOrVersion || !tagOrVersion.trim()) {
        return `https://api.github.com/repos/${cleanRepo}/releases/latest`;
    }
    const rawTag = tagOrVersion.trim();
    if (!SAFE_TAG_SEGMENT_RE.test(rawTag)) {
        throw new Error(`Invalid release tag: "${tagOrVersion}"`);
    }
    const tag = rawTag.startsWith('v') || rawTag.startsWith('V') ? rawTag : `v${rawTag}`;
    return `https://api.github.com/repos/${cleanRepo}/releases/tags/${encodeURIComponent(tag)}`;
}

export function validateReleaseUrl(rawUrl: string): URL {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
        throw new Error('Release URL is empty');
    }
    let parsed: URL;
    try {
        parsed = new URL(rawUrl.trim());
    } catch {
        throw new Error(`Malformed release URL: ${rawUrl}`);
    }
    if (parsed.protocol !== 'https:') {
        throw new Error(`Refusing non-HTTPS release URL protocol: ${parsed.protocol}`);
    }
    if (parsed.username || parsed.password) {
        throw new Error('Refusing release URL containing embedded credentials');
    }
    if (parsed.port && parsed.port !== '443') {
        throw new Error(`Refusing non-standard HTTPS port in release URL: ${parsed.port}`);
    }
    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_RELEASE_HOSTS.has(host)) {
        throw new Error(`Refusing release URL with non-allowlisted host: ${host}`);
    }
    return parsed;
}

export interface ExpectedReleaseAssetBinding {
    repoSlug?: string;
    tagName: string;
    assetName: string;
    caseInsensitiveAssetName?: boolean;
}

/**
 * Bind a GitHub release asset download URL strictly to the approved repository,
 * exact release tag, and exact asset filename (`https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>`).
 */
export function validateApprovedReleaseAssetUrl(
    rawUrl: string,
    expected: ExpectedReleaseAssetBinding,
): URL {
    const parsed = validateReleaseUrl(rawUrl);
    if (parsed.hostname.toLowerCase() !== 'github.com') {
        throw new Error(`Refusing release asset URL from unexpected host "${parsed.hostname}" (expected github.com)`);
    }
    const repoSlug = validateRepoSlug(expected.repoSlug ?? APPROVED_GITHUB_REPO_SLUG);
    const [expectedOwner, expectedRepo] = repoSlug.split('/');
    const expectedTag = expected.tagName.trim();
    const expectedAsset = expected.assetName.trim();
    if (!expectedTag || expectedTag.includes('/') || expectedTag.includes('..') || !parseSemver(expectedTag)) {
        throw new Error(`Invalid expected release tag: "${expected.tagName}"`);
    }
    if (!expectedAsset || expectedAsset.includes('/') || expectedAsset.includes('\\') || expectedAsset.includes('..')) {
        throw new Error(`Invalid expected release asset name: "${expected.assetName}"`);
    }

    const segments = parsed.pathname.split('/').filter(Boolean).map((seg) => {
        try {
            return decodeURIComponent(seg);
        } catch {
            throw new Error(`Malformed percent-encoding in release asset URL: ${rawUrl}`);
        }
    });
    if (
        segments.length !== 6
        || segments[0].toLowerCase() !== expectedOwner.toLowerCase()
        || segments[1].toLowerCase() !== expectedRepo.toLowerCase()
        || segments[2] !== 'releases'
        || segments[3] !== 'download'
    ) {
        throw new Error(
            `Release asset URL is not bound to approved repository ${repoSlug}: ${rawUrl}`,
        );
    }
    if (segments[4] !== expectedTag) {
        throw new Error(
            `Release asset URL tag "${segments[4]}" does not match expected tag "${expectedTag}"`,
        );
    }
    const assetMatches = expected.caseInsensitiveAssetName
        ? segments[5].toLowerCase() === expectedAsset.toLowerCase()
        : segments[5] === expectedAsset;
    if (!assetMatches) {
        throw new Error(
            `Release asset URL filename "${segments[5]}" does not match expected asset "${expectedAsset}"`,
        );
    }
    return parsed;
}

export function validateApprovedReleaseHtmlUrl(
    rawUrl: string,
    expected: { repoSlug?: string; tagName: string },
): URL {
    const parsed = validateReleaseUrl(rawUrl);
    if (parsed.hostname.toLowerCase() !== 'github.com') {
        throw new Error(`Refusing release page URL from unexpected host "${parsed.hostname}" (expected github.com)`);
    }
    const repoSlug = validateRepoSlug(expected.repoSlug ?? APPROVED_GITHUB_REPO_SLUG);
    const [expectedOwner, expectedRepo] = repoSlug.split('/');
    const expectedTag = expected.tagName.trim();
    const segments = parsed.pathname.split('/').filter(Boolean).map((seg) => {
        try {
            return decodeURIComponent(seg);
        } catch {
            throw new Error(`Malformed percent-encoding in release page URL: ${rawUrl}`);
        }
    });
    if (
        segments.length !== 5
        || segments[0].toLowerCase() !== expectedOwner.toLowerCase()
        || segments[1].toLowerCase() !== expectedRepo.toLowerCase()
        || segments[2] !== 'releases'
        || segments[3] !== 'tag'
        || segments[4] !== expectedTag
    ) {
        throw new Error(
            `Release page URL is not bound to approved release ${repoSlug}@${expectedTag}: ${rawUrl}`,
        );
    }
    return parsed;
}

export interface ReleaseIdentityInput {
    repoSlug?: string;
    version: string;
    tagName: string;
    assetName: string;
    assetUrl: string;
    checksumsUrl?: string | null;
    releaseUrl?: string;
}

export interface ValidatedReleaseIdentity {
    repoSlug: string;
    version: string;
    tagName: string;
    assetName: string;
    assetUrl: string;
    checksumsUrl: string;
    releaseUrl: string;
}

/**
 * Strictly bind a plugin release descriptor to the approved GitHub repository,
 * matching semver tag/version, exact expected app ZIP asset name, fail-closed
 * `SHA256SUMS.txt` asset URL, and matching release page URL.
 */
export function validateReleaseIdentity(input: ReleaseIdentityInput): ValidatedReleaseIdentity {
    const repoSlug = validateRepoSlug(input.repoSlug ?? APPROVED_GITHUB_REPO_SLUG);
    if (!isApprovedReleaseRepo(repoSlug)) {
        throw new Error(`Refusing unapproved release repository "${repoSlug}" (expected ${APPROVED_GITHUB_REPO_SLUG})`);
    }
    const rawChecksumsUrl = typeof input.checksumsUrl === 'string' ? input.checksumsUrl.trim() : '';
    if (!rawChecksumsUrl) {
        throw new Error(
            `SHA256SUMS.txt is required for plugin self-update but was not published for release ${input.tagName || input.version}`,
        );
    }

    const parsedVersion = parseSemver(input.version);
    if (!parsedVersion) {
        throw new Error(`Invalid expected release version: "${input.version}"`);
    }
    const tagName = typeof input.tagName === 'string' && input.tagName.trim()
        ? input.tagName.trim()
        : `v${parsedVersion.normalized}`;
    assertReleaseVersionMatches(parsedVersion.normalized, tagName);

    const expectedAsset = expectedAppZipAssetName(parsedVersion.normalized);
    const assetName = typeof input.assetName === 'string' ? input.assetName.trim() : '';
    if (assetName !== expectedAsset) {
        throw new Error(
            `Release asset name "${assetName}" does not match expected asset "${expectedAsset}" for v${parsedVersion.normalized}`,
        );
    }

    const validatedAssetUrl = validateApprovedReleaseAssetUrl(input.assetUrl, {
        repoSlug,
        tagName,
        assetName: expectedAsset,
    }).toString();
    const validatedChecksumsUrl = validateApprovedReleaseAssetUrl(rawChecksumsUrl, {
        repoSlug,
        tagName,
        assetName: CHECKSUMS_ASSET_NAME,
        caseInsensitiveAssetName: true,
    }).toString();

    const validatedReleaseUrl = typeof input.releaseUrl === 'string' && input.releaseUrl.trim()
        ? validateApprovedReleaseHtmlUrl(input.releaseUrl, { repoSlug, tagName }).toString()
        : `https://github.com/${repoSlug}/releases/tag/${encodeURIComponent(tagName)}`;

    return {
        repoSlug,
        version: parsedVersion.normalized,
        tagName,
        assetName: expectedAsset,
        assetUrl: validatedAssetUrl,
        checksumsUrl: validatedChecksumsUrl,
        releaseUrl: validatedReleaseUrl,
    };
}

// ─── Cross-Process Update Lock File (Serializes CLI & UI Updates) ────────────

export interface PluginUpdateLockHandle {
    lockPath: string;
    nonce: string;
    release: () => void;
    /** Verify this process still owns `lockPath` on disk (same nonce). */
    verifyOwned?: () => boolean;
}

export interface AcquireUpdateLockOptions {
    owner?: string;
    timeoutMs?: number;
    staleMs?: number;
    pollIntervalMs?: number;
    now?: () => number;
}

export function getPluginUpdateLockPath(targetPluginDir: string): string {
    const resolved = path.resolve(targetPluginDir);
    return path.join(path.dirname(resolved), `.${path.basename(resolved)}.update.lock`);
}

function isLocalPidAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) { return false; }
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        return code === 'EPERM';
    }
}

function isLockPayloadStale(
    lockFilePath: string,
    raw: string,
    nowMs: number,
    staleMs: number,
): { stale: boolean; expectedNonce: string | null } {
    let stale = false;
    let expectedNonce: string | null = null;
    try {
        const parsed = JSON.parse(raw) as { pid?: unknown; acquiredAt?: unknown; nonce?: unknown };
        if (typeof parsed.nonce === 'string') {
            expectedNonce = parsed.nonce;
        }
        const acquiredAt = typeof parsed.acquiredAt === 'number' && Number.isFinite(parsed.acquiredAt)
            ? parsed.acquiredAt
            : 0;
        stale = typeof parsed.pid === 'number' && Number.isSafeInteger(parsed.pid) && parsed.pid > 0
            ? !isLocalPidAlive(parsed.pid)
            : nowMs - acquiredAt >= staleMs;
    } catch {
        // Corrupt/partial/empty lock file: only reclaim if mtime is old enough to avoid racing a writer mid-write
        const st = fs.lstatSync(lockFilePath);
        if (nowMs - st.mtimeMs >= Math.min(staleMs, 5_000)) {
            stale = true;
        }
    }
    return { stale, expectedNonce };
}

export function publishExclusiveFileSync(filePath: string, payload: string, nonce: string): boolean {
    if (process.platform !== 'win32') {
        const initPath = `${filePath}.init-${process.pid}-${nonce}`;
        try {
            fs.writeFileSync(initPath, payload, { encoding: 'utf8', mode: 0o600 });
            fs.linkSync(initPath, filePath);
            return true;
        } catch (err) {
            if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') { return false; }
        } finally {
            try { fs.unlinkSync(initPath); } catch { /* ignore */ }
        }
    }
    try {
        const fd = fs.openSync(filePath, 'wx', 0o600);
        try {
            fs.writeFileSync(fd, payload, 'utf8');
        } catch (e) {
            try { fs.closeSync(fd); } catch { /* ignore */ }
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
            throw e;
        }
        fs.closeSync(fd);
        return true;
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') { return false; }
        throw err;
    }
}

function acquireStaleReclaimGuard(
    reclaimGuardPath: string,
    nowMs: number,
    staleMs: number,
): { nonce: string; release: () => void } | null {
    const guardNonce = crypto.randomBytes(8).toString('hex');
    const guardPayload = JSON.stringify({ pid: process.pid, nonce: guardNonce, acquiredAt: nowMs });
    const guardStaleMs = Math.min(staleMs, 10_000);

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            if (publishExclusiveFileSync(reclaimGuardPath, guardPayload, guardNonce)) {
                let released = false;
                return {
                    nonce: guardNonce,
                    release: () => {
                        if (released) { return; }
                        released = true;
                        try {
                            if (JSON.parse(fs.readFileSync(reclaimGuardPath, 'utf8'))?.nonce === guardNonce) {
                                fs.unlinkSync(reclaimGuardPath);
                            }
                        } catch { /* ignore */ }
                    },
                };
            }
            if (attempt > 0) { return null; }
            const recoverMeta = `${reclaimGuardPath}.recover`;
            const recoverNonce = crypto.randomBytes(8).toString('hex');
            const recoverPayload = JSON.stringify({ pid: process.pid, nonce: recoverNonce, acquiredAt: nowMs });
            if (!publishExclusiveFileSync(recoverMeta, recoverPayload, recoverNonce)) {
                try {
                    const rmSt0 = fs.lstatSync(recoverMeta);
                    const rmRaw0 = fs.readFileSync(recoverMeta, 'utf8');
                    if (isLockPayloadStale(recoverMeta, rmRaw0, nowMs, Math.min(guardStaleMs, 5_000)).stale) {
                        const rmSt1 = fs.lstatSync(recoverMeta);
                        const rmRaw1 = fs.readFileSync(recoverMeta, 'utf8');
                        if (rmSt1.ino === rmSt0.ino && rmSt1.dev === rmSt0.dev && rmRaw1 === rmRaw0) {
                            const dead = `${recoverMeta}.dead-${process.pid}-${guardNonce}`;
                            fs.renameSync(recoverMeta, dead);
                            try { fs.unlinkSync(dead); } catch { /* ignore */ }
                        }
                    }
                } catch { /* ignore */ }
                return null;
            }
            try {
                const st0 = fs.lstatSync(reclaimGuardPath);
                const raw0 = fs.readFileSync(reclaimGuardPath, 'utf8');
                const c0 = isLockPayloadStale(reclaimGuardPath, raw0, nowMs, guardStaleMs);
                if (!c0.stale) { return null; }
                const st1 = fs.lstatSync(reclaimGuardPath);
                const raw1 = fs.readFileSync(reclaimGuardPath, 'utf8');
                if (st1.ino !== st0.ino || st1.dev !== st0.dev || raw1 !== raw0) { return null; }
                const dead = `${reclaimGuardPath}.dead-${process.pid}-${guardNonce}`;
                fs.renameSync(reclaimGuardPath, dead);
                try { fs.unlinkSync(dead); } catch { /* ignore */ }
            } catch {
                return null;
            } finally {
                try {
                    if (JSON.parse(fs.readFileSync(recoverMeta, 'utf8'))?.nonce === recoverNonce) {
                        fs.unlinkSync(recoverMeta);
                    }
                } catch { /* ignore */ }
            }
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Crash-safe, TOCTOU-free stale-lock reclamation:
 * Serializes concurrent reclaimers with an exclusive crash-recoverable `${lockPath}.reclaim`
 * guard, re-verifies lock identity & staleness while holding the guard, and atomically moves
 * the stale lock to a unique tombstone path before unlinking it so a delayed peer can NEVER
 * delete a freshly acquired lock.
 */
export function tryReclaimStaleUpdateLock(lockPath: string, nowMs: number, staleMs: number): boolean {
    try {
        const initialRaw = fs.readFileSync(lockPath, 'utf8');
        const initialCheck = isLockPayloadStale(lockPath, initialRaw, nowMs, staleMs);
        if (!initialCheck.stale) {
            return false;
        }

        const reclaimGuardPath = `${lockPath}.reclaim`;
        const guard = acquireStaleReclaimGuard(reclaimGuardPath, nowMs, staleMs);
        if (!guard) {
            return false;
        }
        try {
            // Re-read & re-verify inside the exclusive reclaim guard so a freshly acquired lock
            // created between our initial read and guard acquisition is NEVER removed!
            const verifyRaw = fs.readFileSync(lockPath, 'utf8');
            if (verifyRaw !== initialRaw) {
                return false;
            }
            const verifiedCheck = isLockPayloadStale(lockPath, verifyRaw, nowMs, staleMs);
            if (!verifiedCheck.stale) {
                return false;
            }
            if (initialCheck.expectedNonce && verifiedCheck.expectedNonce !== initialCheck.expectedNonce) {
                return false;
            }

            // Rename to a unique tombstone before unlinking (never bare unlinkSync on lockPath)
            const tombstonePath = `${lockPath}.tombstone-${process.pid}-${guard.nonce}`;
            fs.renameSync(lockPath, tombstonePath);
            try {
                fs.unlinkSync(tombstonePath);
            } catch {
                // Best-effort tombstone cleanup
            }
            return true;
        } finally {
            guard.release();
        }
    } catch {
        return false;
    }
}

export async function acquirePluginUpdateLock(
    targetPluginDir: string,
    options: AcquireUpdateLockOptions = {},
): Promise<PluginUpdateLockHandle> {
    const lockPath = getPluginUpdateLockPath(targetPluginDir);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    const timeoutMs = options.timeoutMs ?? DEFAULT_UPDATE_LOCK_TIMEOUT_MS;
    const staleMs = options.staleMs ?? DEFAULT_UPDATE_LOCK_STALE_MS;
    const pollIntervalMs = Math.max(5, options.pollIntervalMs ?? 25);
    const nowFn = options.now ?? (() => Date.now());
    const deadline = nowFn() + Math.max(0, timeoutMs);
    const nonce = crypto.randomBytes(12).toString('hex');
    const owner = options.owner ?? 'ui-updater';

    while (true) {
        const nowMs = nowFn();
        const payload = JSON.stringify({ pid: process.pid, owner, nonce, acquiredAt: nowMs });
        if (publishExclusiveFileSync(lockPath, payload, nonce)) {
            let released = false;
            const verifyOwned = (): boolean => {
                if (released) { return false; }
                try { return JSON.parse(fs.readFileSync(lockPath, 'utf8'))?.nonce === nonce; } catch { return false; }
            };
            return {
                lockPath,
                nonce,
                verifyOwned,
                release: () => {
                    if (released) { return; }
                    released = true;
                    try {
                        if (JSON.parse(fs.readFileSync(lockPath, 'utf8'))?.nonce === nonce) { fs.unlinkSync(lockPath); }
                    } catch { /* Lock already removed */ }
                },
            };
        }
        if (tryReclaimStaleUpdateLock(lockPath, nowMs, staleMs)) { continue; }
        if (nowFn() >= deadline) {
            let holderInfo = '';
            try {
                const holder = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { owner?: string; pid?: number };
                if (holder.owner || holder.pid) { holderInfo = ` (held by ${holder.owner ?? 'unknown'} pid=${holder.pid ?? '?'})`; }
            } catch { /* ignore */ }
            throw new Error(`Another plugin install or update is already in progress for ${path.resolve(targetPluginDir)}${holderInfo}`);
        }
        await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
    }
}

// ─── SHA-256 Checksum Parsing & Constant-Time Verification ───────────────────

export function computeSha256Hex(buf: Buffer): string {
    return crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
}

export function verifyBufferSha256(buf: Buffer, expectedHex: string): boolean {
    if (typeof expectedHex !== 'string') { return false; }
    const cleanExpected = expectedHex.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(cleanExpected)) { return false; }
    const actualHex = computeSha256Hex(buf);
    return crypto.timingSafeEqual(Buffer.from(actualHex, 'utf8'), Buffer.from(cleanExpected, 'utf8'));
}

/**
 * Parse a `SHA256SUMS.txt` file into a case-insensitive (lowercase-keyed) lookup map
 * from normalized relative path and basename to 64-character lowercase SHA-256 hex digest.
 *
 * Strictly rejects conflicting duplicate filenames or basenames (case-insensitively
 * normalized) so ambiguous checksum manifests always fail closed.
 */
export function parseSha256Sums(content: string): Map<string, string> {
    const map = new Map<string, string>();
    const fullMeta = new Map<string, { digest: string; rawName: string }>();
    const baseMeta = new Map<string, { digest: string; rawName: string }>();
    if (typeof content !== 'string') { return map; }
    for (const rawLine of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) { continue; }
        const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/);
        if (!match) { continue; }
        const digest = match[1].toLowerCase();
        const rawName = match[2].trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
        if (!rawName || rawName.includes('\0')) { continue; }
        if (rawName.startsWith('/') || /^[A-Za-z]:/.test(rawName) || rawName.split('/').some((seg) => seg === '..')) {
            throw new Error(`Unsafe filename in SHA256SUMS.txt: "${rawName}"`);
        }
        const lowerFull = rawName.toLowerCase();
        const lowerBase = path.posix.basename(lowerFull);
        if (!lowerBase) { continue; }

        const prevFull = fullMeta.get(lowerFull);
        if (prevFull) {
            if (prevFull.digest !== digest || prevFull.rawName !== rawName) {
                throw new Error(
                    `Conflicting SHA256SUMS.txt entries for "${rawName}" (conflicts with "${prevFull.rawName}")`,
                );
            }
        } else {
            fullMeta.set(lowerFull, { digest, rawName });
        }

        const prevBase = baseMeta.get(lowerBase);
        if (prevBase) {
            if (prevBase.digest !== digest || prevBase.rawName !== rawName) {
                throw new Error(
                    `Conflicting SHA256SUMS.txt basename entries for "${rawName}" (conflicts with "${prevBase.rawName}")`,
                );
            }
        } else {
            baseMeta.set(lowerBase, { digest, rawName });
        }

        map.set(lowerFull, digest);
        map.set(lowerBase, digest);
    }
    return map;
}

export function lookupSha256Sum(sums: ReadonlyMap<string, string>, assetName: string): string | undefined {
    if (typeof assetName !== 'string' || !assetName.trim()) { return undefined; }
    const normalized = assetName.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    return sums.get(normalized) ?? sums.get(path.posix.basename(normalized));
}

// ─── Pure-Node Safe ZIP Extractor (Stored + Deflate, Zip-Slip Guarded) ───────

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c >>> 0;
    }
    return table;
})();

export function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function findEocdOffset(zipBuf: Buffer): number {
    if (zipBuf.length < 22) {
        throw new Error('Invalid ZIP archive: file too small');
    }
    const minOffset = Math.max(0, zipBuf.length - 22 - 65_535);
    for (let i = zipBuf.length - 22; i >= minOffset; i--) {
        if (zipBuf.readUInt32LE(i) === 0x06054b50) {
            const commentLen = zipBuf.readUInt16LE(i + 20);
            if (i + 22 + commentLen === zipBuf.length) {
                return i;
            }
        }
    }
    throw new Error('Invalid ZIP archive: missing End-Of-Central-Directory record');
}

export function sanitizeZipEntryPath(rawName: string): { relPath: string; isDir: boolean } {
    if (typeof rawName !== 'string' || !rawName || rawName.includes('\0')) {
        throw new Error('Unsafe ZIP entry: empty or contains NUL byte');
    }
    if (/^[A-Za-z]:/.test(rawName) || rawName.startsWith('\\\\') || rawName.startsWith('//')) {
        throw new Error(`Unsafe ZIP entry (absolute path rejected): ${rawName}`);
    }
    const normalized = rawName.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
        throw new Error(`Unsafe ZIP entry (absolute path rejected): ${rawName}`);
    }
    const isDir = normalized.endsWith('/');
    const trimmed = normalized.replace(/\/+$/, '');
    if (!trimmed) {
        if (isDir) { return { relPath: '', isDir: true }; }
        throw new Error(`Unsafe ZIP entry path: ${rawName}`);
    }
    const segments = trimmed.split('/');
    for (const seg of segments) {
        if (!seg || seg === '.' || seg === '..') {
            throw new Error(`Unsafe ZIP entry (path traversal rejected): ${rawName}`);
        }
        if (/[<>:"|?*\u0000-\u001f]|[. ]$/.test(seg)
            || /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³])(?:\.|$)/i.test(seg)) {
            throw new Error(`Unsafe ZIP entry (non-portable path component): ${rawName}`);
        }
    }
    return { relPath: segments.join('/'), isDir };
}

export function assertSafeArchiveEntryPath(
    rawEntryName: string,
    destDir: string,
): { relPath: string; targetPath: string; isDir: boolean } {
    const { relPath, isDir } = sanitizeZipEntryPath(rawEntryName);
    const resolvedDest = path.resolve(destDir);
    if (!relPath) {
        return { relPath: '', targetPath: resolvedDest, isDir: true };
    }
    const targetPath = path.resolve(resolvedDest, relPath);
    const relCheck = path.relative(resolvedDest, targetPath);
    if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
        throw new Error(`Unsafe ZIP entry escapes destination directory: ${rawEntryName}`);
    }
    return { relPath, targetPath, isDir };
}

export interface ExtractZipOptions {
    maxEntries?: number;
    maxTotalBytes?: number;
}

export interface ExtractZipResult {
    entries: string[];
    totalBytes: number;
}

/**
 * Pure-Node safe ZIP extractor supporting Stored (method 0) and Deflate (method 8).
 * Strictly rejects zip-slip (`..`), absolute paths, symlinks (unconditionally across
 * hostOs values), special Unix file types, encrypted entries, CRC-32 mismatches,
 * and zip-bomb size/entry limits.
 */
export function extractZipSafe(
    zipBuf: Buffer,
    destDir: string,
    options: ExtractZipOptions = {},
): ExtractZipResult {
    const maxEntries = options.maxEntries ?? MAX_ZIP_ENTRIES;
    const maxTotalBytes = options.maxTotalBytes ?? MAX_EXTRACTED_BYTES;

    const eocdOffset = findEocdOffset(zipBuf);
    const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
    const centralDirSize = zipBuf.readUInt32LE(eocdOffset + 12);
    const centralDirOffset = zipBuf.readUInt32LE(eocdOffset + 16);

    if (totalEntries === 0) {
        throw new Error('Invalid ZIP archive: archive contains 0 entries');
    }
    if (totalEntries > maxEntries) {
        throw new Error(`ZIP archive exceeds maximum entry limit (${totalEntries} > ${maxEntries})`);
    }
    if (centralDirOffset + centralDirSize > eocdOffset) {
        throw new Error('Invalid ZIP archive: central directory exceeds bounds');
    }

    const resolvedDest = path.resolve(destDir);
    fs.mkdirSync(resolvedDest, { recursive: true });

    let cursor = centralDirOffset;
    let totalExtractedBytes = 0;
    const extractedEntries: string[] = [];
    const names = new Map<string, string>();
    const explicitEntries = new Set<string>();

    for (let i = 0; i < totalEntries; i++) {
        if (cursor + 46 > centralDirOffset + centralDirSize) {
            throw new Error('Invalid ZIP archive: truncated central directory entry');
        }
        const sig = zipBuf.readUInt32LE(cursor);
        if (sig !== 0x02014b50) {
            throw new Error(`Invalid ZIP archive: bad central directory signature at offset ${cursor}`);
        }

        const versionMadeBy = zipBuf.readUInt16LE(cursor + 4);
        const flags = zipBuf.readUInt16LE(cursor + 8);
        const method = zipBuf.readUInt16LE(cursor + 10);
        const expectedCrc = zipBuf.readUInt32LE(cursor + 16);
        const compressedSize = zipBuf.readUInt32LE(cursor + 20);
        const uncompressedSize = zipBuf.readUInt32LE(cursor + 24);
        const nameLen = zipBuf.readUInt16LE(cursor + 28);
        const extraLen = zipBuf.readUInt16LE(cursor + 30);
        const commentLen = zipBuf.readUInt16LE(cursor + 32);
        const externalAttrs = zipBuf.readUInt32LE(cursor + 38);
        const localHeaderOffset = zipBuf.readUInt32LE(cursor + 42);

        const nameEnd = cursor + 46 + nameLen;
        if (nameEnd + extraLen + commentLen > centralDirOffset + centralDirSize) {
            throw new Error('Invalid ZIP archive: central directory entry overflows bounds');
        }
        const rawName = zipBuf.subarray(cursor + 46, nameEnd).toString('utf8');
        cursor = nameEnd + extraLen + commentLen;

        if ((flags & 0x0001) !== 0) {
            throw new Error(`Unsupported encrypted ZIP entry: ${rawName}`);
        }

        // Check Unix file mode bits for symlinks unconditionally (even when hostOs != 3),
        // and reject special Unix file types (FIFO/device/socket).
        const hostOs = (versionMadeBy >>> 8) & 0xff;
        const unixMode = (externalAttrs >>> 16) & 0xffff;
        const unixFileType = unixMode & 0o170000;
        if (unixFileType === 0o120000) {
            throw new Error(`Unsafe ZIP entry (symlink rejected): ${rawName}`);
        }
        if (hostOs === 3 && unixFileType !== 0 && unixFileType !== 0o100000 && unixFileType !== 0o040000) {
            throw new Error(`Unsafe ZIP entry (special file type rejected): ${rawName}`);
        }

        const { relPath, targetPath, isDir } = assertSafeArchiveEntryPath(rawName, resolvedDest);
        if (!relPath) { continue; }
        // Reject aliases consistently across case-sensitive, case-insensitive,
        // and Unicode-normalizing volumes, including implicit parent directories.
        let prefix = '';
        for (const segment of relPath.split('/')) {
            prefix = prefix ? prefix + '/' + segment : segment;
            const key = prefix.normalize('NFC').toLowerCase();
            const previous = names.get(key);
            if (previous !== undefined && previous !== prefix) {
                throw new Error(`Ambiguous ZIP entry path: ${rawName}`);
            }
            names.set(key, prefix);
        }
        if (explicitEntries.has(relPath)) { throw new Error(`Duplicate ZIP entry: ${rawName}`); }
        explicitEntries.add(relPath);


        if (isDir || unixFileType === 0o040000) {
            fs.mkdirSync(targetPath, { recursive: true });
            continue;
        }

        if (method !== 0 && method !== 8) {
            throw new Error(`Unsupported ZIP compression method ${method} for entry: ${rawName}`);
        }

        if (localHeaderOffset + 30 > zipBuf.length) {
            throw new Error(`Invalid ZIP archive: local header out of bounds for ${rawName}`);
        }
        if (zipBuf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
            throw new Error(`Invalid ZIP archive: bad local file header signature for ${rawName}`);
        }
        const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > zipBuf.length) {
            throw new Error(`Invalid ZIP archive: compressed payload out of bounds for ${rawName}`);
        }

        if (totalExtractedBytes + uncompressedSize > maxTotalBytes) {
            throw new Error(`ZIP archive exceeds maximum extracted size limit (${maxTotalBytes} bytes)`);
        }

        const compressedSlice = zipBuf.subarray(dataStart, dataEnd);
        let fileData: Buffer;
        if (method === 0) {
            fileData = Buffer.from(compressedSlice);
        } else {
            const remainingBudget = Math.max(0, maxTotalBytes - totalExtractedBytes);
            fileData = zlib.inflateRawSync(compressedSlice, { maxOutputLength: remainingBudget });
        }

        if (fileData.length !== uncompressedSize) {
            throw new Error(`ZIP entry size mismatch for ${rawName} (expected ${uncompressedSize}, got ${fileData.length})`);
        }
        if (crc32(fileData) !== expectedCrc) {
            throw new Error(`ZIP entry CRC-32 mismatch for ${rawName}`);
        }

        totalExtractedBytes += fileData.length;
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, fileData, { flag: 'wx' });
        if (process.platform !== 'win32' && hostOs === 3 && (unixMode & 0o111) !== 0) {
            try { fs.chmodSync(targetPath, 0o755); } catch { /* ignore */ }
        }
        extractedEntries.push(relPath);
    }

    return { entries: extractedEntries, totalBytes: totalExtractedBytes };
}

// ─── Extracted Bundle Validation ─────────────────────────────────────────────

export interface ValidatedPluginBundle {
    name: string;
    version: string;
    pluginRootDir: string;
    manifest: Record<string, unknown>;
}

export interface ValidateBundleOptions {
    /** When provided, enforces strict `plugin.json.version === expectedVersion` semver parity. */
    expectedVersion?: string;
}

/**
 * Locate the plugin root directory inside an extracted archive staging folder
 * (supports both `antigravity-context-monitor/plugin.json` and flat `plugin.json`).
 */
export function resolveExtractedPluginRoot(extractDir: string): string {
    if (fs.existsSync(path.join(extractDir, 'plugin.json'))) {
        return extractDir;
    }
    const namedDir = path.join(extractDir, EXPECTED_PLUGIN_NAME);
    if (fs.existsSync(path.join(namedDir, 'plugin.json'))) {
        return namedDir;
    }
    const entries = fs.readdirSync(extractDir).filter(name => !name.startsWith('.') && name !== '__MACOSX');
    if (entries.length === 1) {
        const candidate = path.join(extractDir, entries[0]);
        try {
            if (fs.lstatSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, 'plugin.json'))) {
                return candidate;
            }
        } catch {
            // fall through
        }
    }
    throw new Error('Extracted update archive does not contain a valid plugin.json root');
}

/**
 * Validate an extracted plugin bundle before atomic swap:
 * - `plugin.json` exists, is a regular file (not symlink), and parses cleanly
 * - `name === 'antigravity-context-monitor'`
 * - valid semver `version` (and matches `options.expectedVersion` when supplied)
 * - `sidecars/context_monitor/main.mjs` exists and is a regular file
 */
export function validateExtractedPluginBundle(
    pluginRootDir: string,
    options: ValidateBundleOptions = {},
): ValidatedPluginBundle {
    const assertRegFile = (rel: string): string => {
        const p = path.join(pluginRootDir, ...rel.split('/'));
        if (!fs.existsSync(p)) { throw new Error(`Plugin bundle validation failed: missing ${rel}`); }
        const st = fs.lstatSync(p);
        if (!st.isFile() || st.isSymbolicLink()) { throw new Error(`Plugin bundle validation failed: ${rel} must be a regular file`); }
        return p;
    };
    const manifestPath = assertRegFile('plugin.json');
    let manifest: Record<string, unknown>;
    try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { throw new Error('manifest is not an object'); }
        manifest = parsed as Record<string, unknown>;
    } catch (err) {
        throw new Error(`Plugin bundle validation failed: invalid plugin.json (${err instanceof Error ? err.message : String(err)})`);
    }

    if (manifest.name !== EXPECTED_PLUGIN_NAME) {
        throw new Error(`Plugin bundle validation failed: unexpected plugin name "${String(manifest.name ?? '')}"`);
    }
    const versionStr = typeof manifest.version === 'string' ? manifest.version.trim() : '';
    const semver = parseSemver(versionStr);
    if (!semver) {
        throw new Error(`Plugin bundle validation failed: invalid semver version "${versionStr}"`);
    }
    if (options.expectedVersion && options.expectedVersion.trim()) {
        assertReleaseVersionMatches(semver.normalized, options.expectedVersion);
    }

    assertRegFile('sidecars/context_monitor/main.mjs');
    const sidecarManifestPath = assertRegFile('sidecars/context_monitor/sidecar.json');
    try {
        const sc = JSON.parse(fs.readFileSync(sidecarManifestPath, 'utf8').replace(/^\uFEFF/, ''));
        if (!sc || typeof sc !== 'object' || Array.isArray(sc)) { throw new Error('sidecar.json is not an object'); }
    } catch (err) {
        throw new Error(`Plugin bundle validation failed: invalid sidecar.json (${err instanceof Error ? err.message : String(err)})`);
    }
    const rtPkgRel = 'sidecars/context_monitor/runtime/package.json';
    let unbundled = false;
    if (fs.existsSync(path.join(pluginRootDir, ...rtPkgRel.split('/')))) {
        try {
            const p = assertRegFile(rtPkgRel);
            unbundled = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))?.bundled === false;
        } catch (err) {
            throw new Error(`Plugin bundle validation failed: invalid runtime/package.json (${err instanceof Error ? err.message : String(err)})`);
        }
    }
    for (const f of unbundled ? ['sidecar-server.js', 'sidecar-runtime.js'] : ['sidecar-bundle.js', 'sidecar-server.js', 'sidecar-runtime.js']) {
        assertRegFile(`sidecars/context_monitor/runtime/out/app/${f}`);
    }

    return {
        name: EXPECTED_PLUGIN_NAME,
        version: semver.normalized,
        pluginRootDir,
        manifest,
    };
}

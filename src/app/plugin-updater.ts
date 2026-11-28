/**
 * In-App GitHub Release Update Checker & Pure-Node Self-Upgrader for the
 * Antigravity App native Sidecar plugin (`antigravity-context-monitor`).
 *
 * Security & Runtime Guarantees:
 * - Zero external npm dependencies (pure Node built-ins: `crypto`, `fs`, `http`, `https`, `net`, `path`, `tls`, `zlib`).
 * - Reuses `src/core/release-security.ts` as single source of truth for semver, strict HTTPS port-443
 *   GitHub host allowlist (`github.com`, `api.github.com`, `objects.githubusercontent.com`,
 *   `release-assets.githubusercontent.com`), lowercase SHA256SUMS.txt normalization, safe ZIP
 *   extraction (Stored + Deflate, CRC-32, zip-slip / symlink / encryption / zip-bomb rejection),
 *   and release-tag <-> `plugin.json` version parity enforcement.
 * - Fail-closed SHA-256 verification: `SHA256SUMS.txt` is ALWAYS required in App self-update.
 * - Supports `HTTPS_PROXY` / `ALL_PROXY` HTTP CONNECT tunneling (respecting `NO_PROXY`).
 * - Supports strict HTTPS port-443 `github.com/.../releases.atom` check-only fallback when the
 *   GitHub API is rate-limited (never downloads/installs without fail-closed `SHA256SUMS.txt`).
 * - Atomic install with backup & transactional rollback (including Windows locked-dir staging swap).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import type * as net from 'net';
import * as path from 'path';
import * as tls from 'tls';
import {
    ALLOWED_RELEASE_HOSTS,
    APPROVED_GITHUB_REPO_NAME,
    APPROVED_GITHUB_REPO_OWNER,
    APPROVED_GITHUB_REPO_SLUG,
    CHECKSUMS_ASSET_NAME,
    DEFAULT_UPDATE_LOCK_STALE_MS,
    DEFAULT_UPDATE_LOCK_TIMEOUT_MS,
    EXPECTED_PLUGIN_NAME,
    MAX_API_BODY_BYTES,
    MAX_ARCHIVE_BYTES,
    MAX_CHECKSUMS_BYTES,
    MAX_EXTRACTED_BYTES,
    MAX_REDIRECT_HOPS,
    MAX_ZIP_ENTRIES,
    acquirePluginUpdateLock,
    assertReleaseVersionMatches,
    assertSafeArchiveEntryPath,
    buildApprovedReleaseApiUrl,
    compareSemver,
    computeSha256Hex,
    crc32,
    expectedAppZipAssetName,
    extractZipSafe,
    getPluginUpdateLockPath,
    isApprovedReleaseRepo,
    isNewerVersion,
    lookupSha256Sum,
    parseSemver,
    parseSha256Sums,
    resolveExtractedPluginRoot,
    sanitizeZipEntryPath,
    validateApprovedReleaseAssetUrl,
    validateApprovedReleaseHtmlUrl,
    validateExtractedPluginBundle,
    validateReleaseIdentity,
    validateReleaseUrl,
    validateRepoSlug,
    verifyBufferSha256,
    type AcquireUpdateLockOptions,
    type ExpectedReleaseAssetBinding,
    type ExtractZipOptions,
    type ExtractZipResult,
    type PluginUpdateLockHandle,
    type ReleaseIdentityInput,
    type SemverParts,
    type ValidateBundleOptions,
    type ValidatedPluginBundle,
    type ValidatedReleaseIdentity,
} from '../core/release-security';
import type {
    ApplyPluginUpdateResult,
    PluginReleaseInfo,
    UpdateCheckResult,
} from './sidecar-types';

export {
    ALLOWED_RELEASE_HOSTS,
    APPROVED_GITHUB_REPO_NAME,
    APPROVED_GITHUB_REPO_OWNER,
    APPROVED_GITHUB_REPO_SLUG,
    CHECKSUMS_ASSET_NAME,
    DEFAULT_UPDATE_LOCK_STALE_MS,
    DEFAULT_UPDATE_LOCK_TIMEOUT_MS,
    EXPECTED_PLUGIN_NAME,
    MAX_API_BODY_BYTES,
    MAX_ARCHIVE_BYTES,
    MAX_CHECKSUMS_BYTES,
    MAX_EXTRACTED_BYTES,
    MAX_REDIRECT_HOPS,
    MAX_ZIP_ENTRIES,
    acquirePluginUpdateLock,
    assertReleaseVersionMatches,
    assertSafeArchiveEntryPath,
    buildApprovedReleaseApiUrl,
    compareSemver,
    computeSha256Hex,
    crc32,
    expectedAppZipAssetName,
    extractZipSafe,
    getPluginUpdateLockPath,
    isApprovedReleaseRepo,
    isNewerVersion,
    lookupSha256Sum,
    parseSemver,
    parseSha256Sums,
    resolveExtractedPluginRoot,
    sanitizeZipEntryPath,
    validateApprovedReleaseAssetUrl,
    validateApprovedReleaseHtmlUrl,
    validateExtractedPluginBundle,
    validateReleaseIdentity,
    validateReleaseUrl,
    validateRepoSlug,
    verifyBufferSha256,
    type AcquireUpdateLockOptions,
    type ExpectedReleaseAssetBinding,
    type ExtractZipOptions,
    type ExtractZipResult,
    type PluginUpdateLockHandle,
    type ReleaseIdentityInput,
    type SemverParts,
    type ValidateBundleOptions,
    type ValidatedPluginBundle,
    type ValidatedReleaseIdentity,
};

export const GITHUB_REPO_OWNER = APPROVED_GITHUB_REPO_OWNER;
export const GITHUB_REPO_NAME = APPROVED_GITHUB_REPO_NAME;
export const GITHUB_LATEST_RELEASE_URL =
    `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`;
export const GITHUB_RELEASES_ATOM_URL =
    `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases.atom`;

export const DEFAULT_UPDATE_CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 hours
export const DEFAULT_API_TIMEOUT_MS = 12_000;
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;

// ─── Proxy Resolution & HTTP CONNECT Tunnel ──────────────────────────────────

export function isHostBypassedByNoProxy(
    hostname: string,
    port = '443',
    noProxyRaw?: string,
): boolean {
    if (!noProxyRaw || !noProxyRaw.trim()) { return false; }
    const targetHost = hostname.trim().toLowerCase();
    const targetPort = port || '443';
    for (const rawEntry of noProxyRaw.split(',')) {
        const entry = rawEntry.trim().toLowerCase();
        if (!entry) { continue; }
        if (entry === '*') { return true; }
        let patternHost = entry;
        let patternPort = '';
        const colonIdx = entry.lastIndexOf(':');
        if (colonIdx > 0 && !entry.endsWith(']')) {
            const candidatePort = entry.slice(colonIdx + 1);
            if (/^\d+$/.test(candidatePort)) {
                patternHost = entry.slice(0, colonIdx);
                patternPort = candidatePort;
            }
        }
        if (patternPort && patternPort !== targetPort) {
            continue;
        }
        if (patternHost.startsWith('.')) {
            const bare = patternHost.slice(1);
            if (targetHost === bare || targetHost.endsWith(patternHost)) {
                return true;
            }
        } else if (targetHost === patternHost || targetHost.endsWith(`.${patternHost}`)) {
            return true;
        }
    }
    return false;
}

/**
 * Resolve an HTTP/HTTPS CONNECT proxy URL for an outbound HTTPS request from
 * `HTTPS_PROXY` / `https_proxy` / `ALL_PROXY` / `all_proxy`, respecting `NO_PROXY` / `no_proxy`.
 */
export function resolveHttpsProxyUrl(
    targetUrl: URL,
    env: NodeJS.ProcessEnv = process.env,
): URL | null {
    const noProxy = env.NO_PROXY || env.no_proxy;
    if (isHostBypassedByNoProxy(targetUrl.hostname, targetUrl.port || '443', noProxy)) {
        return null;
    }
    const candidates = [
        env.HTTPS_PROXY,
        env.https_proxy,
        env.ALL_PROXY,
        env.all_proxy,
    ];
    for (const raw of candidates) {
        if (typeof raw !== 'string' || !raw.trim()) { continue; }
        const trimmed = raw.trim();
        const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
            ? trimmed
            : `http://${trimmed}`;
        try {
            const parsed = new URL(withScheme);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed;
            }
        } catch {
            // Ignore malformed proxy entry and continue checking fallbacks
        }
    }
    return null;
}

/**
 * Establish an HTTP CONNECT tunnel socket through an HTTP or HTTPS proxy server.
 */
export function establishHttpConnectTunnel(
    proxyUrl: URL,
    targetHost: string,
    targetPort: number,
    timeoutMs: number,
): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const authority = `${targetHost}:${targetPort}`;

        const headers: Record<string, string> = {
            Host: authority,
        };
        if (proxyUrl.username || proxyUrl.password) {
            const creds = `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`;
            headers['Proxy-Authorization'] = `Basic ${Buffer.from(creds, 'utf8').toString('base64')}`;
        }

        const isHttpsProxy = proxyUrl.protocol === 'https:';
        const proxyPort = proxyUrl.port
            ? Number(proxyUrl.port)
            : (isHttpsProxy ? 443 : 80);

        const requester = isHttpsProxy ? https.request : http.request;
        const connectReq = requester({
            protocol: proxyUrl.protocol,
            hostname: proxyUrl.hostname,
            port: proxyPort,
            method: 'CONNECT',
            path: authority,
            headers,
            agent: false,
        });

        const finish = (err: Error | null, socket?: net.Socket) => {
            if (settled) { return; }
            settled = true;
            if (timer) { clearTimeout(timer); timer = null; }
            if (err) {
                try { connectReq.destroy(); } catch { /* ignore */ }
                reject(err);
            } else {
                resolve(socket!);
            }
        };

        timer = setTimeout(() => {
            finish(new Error(`Proxy CONNECT timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();

        connectReq.once('connect', (proxyRes, socket, head) => {
            const status = proxyRes.statusCode ?? 0;
            if (status !== 200) {
                socket.destroy();
                finish(new Error(`Proxy CONNECT to ${authority} failed (HTTP ${status})`));
                return;
            }
            if (head && head.length > 0) {
                socket.unshift(head);
            }
            finish(null, socket);
        });

        connectReq.once('response', (proxyRes) => {
            const status = proxyRes.statusCode ?? 0;
            proxyRes.resume();
            finish(new Error(`Proxy CONNECT to ${authority} failed (HTTP ${status})`));
        });

        connectReq.once('error', (err) => finish(err));
        connectReq.end();
    });
}

// ─── Strict HTTPS Host Allowlist & Safe Redirect Fetch ───────────────────────

export interface HttpsTransportResponse {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
}

export interface HttpsTransportRequestOptions {
    headers: Record<string, string>;
    timeoutMs: number;
    maxBytes: number;
    env?: NodeJS.ProcessEnv;
    /** Optional additional trusted CA PEM/DER certificate(s) for TLS verification (rejectUnauthorized is always true). */
    ca?: string | Buffer | Array<string | Buffer>;
}

export type HttpsRequestTransport = (
    url: URL,
    options: HttpsTransportRequestOptions,
) => Promise<HttpsTransportResponse>;

export function defaultHttpsTransport(
    url: URL,
    options: HttpsTransportRequestOptions,
): Promise<HttpsTransportResponse> {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        let settled = false;
        let activeReq: http.ClientRequest | null = null;
        let tunnelSocket: net.Socket | null = null;
        let tunnelAgent: https.Agent | null = null;
        let hardTimer: ReturnType<typeof setTimeout> | null = null;

        const finish = (err: Error | null, result?: HttpsTransportResponse) => {
            if (settled) { return; }
            settled = true;
            if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
            if (err) {
                try { activeReq?.destroy(); } catch { /* ignore */ }
                try { tunnelSocket?.destroy(); } catch { /* ignore */ }
                try { tunnelAgent?.destroy(); } catch { /* ignore */ }
                reject(err);
            } else {
                try { tunnelAgent?.destroy(); } catch { /* ignore */ }
                resolve(result!);
            }
        };

        hardTimer = setTimeout(() => {
            finish(new Error(`HTTPS request timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
        hardTimer.unref?.();

        const targetPort = url.port ? Number(url.port) : 443;

        const runRequest = (socketForTunnel?: net.Socket) => {
            if (settled) {
                socketForTunnel?.destroy();
                return;
            }
            const remainingMs = Math.max(1, options.timeoutMs - (Date.now() - startedAt));
            let requestAgent: https.Agent | undefined;
            if (socketForTunnel) {
                // Node.js ignores request-level `createConnection` whenever `agent: false` is set.
                // Use a dedicated single-use `https.Agent` whose `createConnection` upgrades the
                // established HTTP CONNECT tunnel with strict TLS verification (`rejectUnauthorized: true`).
                const agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
                agent.createConnection = () => tls.connect({
                    socket: socketForTunnel,
                    servername: url.hostname,
                    rejectUnauthorized: true,
                    ...(options.ca ? { ca: options.ca } : {}),
                });
                tunnelAgent = agent;
                requestAgent = agent;
            }

            const reqOptions: https.RequestOptions = {
                protocol: url.protocol,
                hostname: url.hostname,
                port: targetPort,
                path: `${url.pathname}${url.search}`,
                method: 'GET',
                headers: options.headers,
                timeout: remainingMs,
                rejectUnauthorized: true,
                ...(options.ca ? { ca: options.ca } : {}),
                ...(requestAgent ? { agent: requestAgent } : {}),
            };

            const req = https.request(reqOptions, (res) => {
                const statusCode = res.statusCode ?? 0;
                const headers: Record<string, string | string[] | undefined> = {};
                for (const [k, v] of Object.entries(res.headers)) {
                    headers[k.toLowerCase()] = v;
                }
                // Don't buffer redirect response bodies
                if (statusCode >= 300 && statusCode < 400) {
                    res.resume();
                    finish(null, { statusCode, headers, body: Buffer.alloc(0) });
                    return;
                }

                const chunks: Buffer[] = [];
                let total = 0;
                res.on('data', (chunk: Buffer | string) => {
                    if (settled) { return; }
                    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
                    total += buf.length;
                    if (total > options.maxBytes) {
                        req.destroy();
                        finish(new Error(`Response body exceeded maximum allowed limit (${options.maxBytes} bytes)`));
                        return;
                    }
                    chunks.push(buf);
                });
                res.on('error', (err) => finish(err));
                res.on('end', () => {
                    finish(null, { statusCode, headers, body: Buffer.concat(chunks) });
                });
            });

            activeReq = req;
            req.on('error', (err) => finish(err));
            req.on('timeout', () => {
                req.destroy();
                finish(new Error(`HTTPS request timed out after ${options.timeoutMs}ms`));
            });
            req.end();
        };

        const proxyUrl = resolveHttpsProxyUrl(url, options.env ?? process.env);
        if (proxyUrl) {
            establishHttpConnectTunnel(proxyUrl, url.hostname, targetPort, options.timeoutMs)
                .then((sock) => {
                    tunnelSocket = sock;
                    runRequest(sock);
                })
                .catch((err) => finish(err instanceof Error ? err : new Error(String(err))));
        } else {
            runRequest();
        }
    });
}

function headerFirst(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
    const val = headers[name.toLowerCase()];
    if (typeof val === 'string') { return val; }
    if (Array.isArray(val) && typeof val[0] === 'string') { return val[0]; }
    return undefined;
}

/**
 * Perform an HTTPS GET strictly constrained to `ALLOWED_RELEASE_HOSTS`, following
 * up to `MAX_REDIRECT_HOPS` redirects and re-validating the host allowlist on EVERY hop.
 */
export async function fetchAllowedHttps(
    rawUrl: string,
    options: {
        headers?: Record<string, string>;
        timeoutMs?: number;
        maxBytes?: number;
        maxRedirects?: number;
        transport?: HttpsRequestTransport;
        env?: NodeJS.ProcessEnv;
        ca?: string | Buffer | Array<string | Buffer>;
    } = {},
): Promise<HttpsTransportResponse & { finalUrl: string }> {
    const transport = options.transport ?? defaultHttpsTransport;
    const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
    const maxBytes = options.maxBytes ?? MAX_API_BODY_BYTES;
    const maxRedirects = options.maxRedirects ?? MAX_REDIRECT_HOPS;
    const baseHeaders = options.headers ?? {};

    let currentUrl = validateReleaseUrl(rawUrl);

    for (let hop = 0; hop <= maxRedirects; hop++) {
        const res = await transport(currentUrl, {
            headers: baseHeaders,
            timeoutMs,
            maxBytes,
            ...(options.env ? { env: options.env } : {}),
            ...(options.ca ? { ca: options.ca } : {}),
        });

        const isRedirect = res.statusCode === 301
            || res.statusCode === 302
            || res.statusCode === 303
            || res.statusCode === 307
            || res.statusCode === 308;

        if (!isRedirect) {
            return { ...res, finalUrl: currentUrl.toString() };
        }

        if (hop >= maxRedirects) {
            throw new Error(`Too many redirects (exceeded max ${maxRedirects} hops)`);
        }

        const location = headerFirst(res.headers, 'location');
        if (!location || !location.trim()) {
            throw new Error(`Redirect response HTTP ${res.statusCode} missing Location header`);
        }

        const resolvedNext = new URL(location.trim(), currentUrl).toString();
        // Re-validate strict HTTPS host allowlist on EVERY hop!
        currentUrl = validateReleaseUrl(resolvedNext);
    }

    throw new Error('Redirect loop exhausted');
}

// ─── GitHub `releases.atom` Check-Only Rate-Limit Fallback ───────────────────

export interface ParsedAtomRelease {
    tagName: string;
    version: string;
    releaseUrl: string;
    publishedAt?: string;
    title?: string;
}

export function isGitHubRateLimitResponse(res: HttpsTransportResponse): boolean {
    if (res.statusCode === 429) {
        return true;
    }
    if (res.statusCode === 403) {
        const remaining = headerFirst(res.headers, 'x-ratelimit-remaining');
        if (remaining !== undefined && remaining.trim() === '0') {
            return true;
        }
        const snippet = res.body.toString('utf8', 0, Math.min(res.body.length, 1024));
        if (/rate\s*limit/i.test(snippet)) {
            return true;
        }
    }
    return false;
}

function decodeXmlEntities(raw: string): string {
    return raw
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

/**
 * Parse a GitHub `releases.atom` feed to extract the latest stable semver release
 * for check-only update discovery when the JSON API is rate-limited.
 *
 * Strictly validates that the parsed release URL is an HTTPS port-443 `github.com` URL.
 */
export function parseReleasesAtomLatest(atomXml: string): ParsedAtomRelease | null {
    if (typeof atomXml !== 'string' || !atomXml.trim()) { return null; }

    const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
    const candidates: Array<ParsedAtomRelease & { isPrerelease: boolean }> = [];
    let match: RegExpExecArray | null;

    while ((match = entryRe.exec(atomXml)) !== null) {
        const entry = match[1];
        const linkMatch = entry.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i);
        const rawHref = linkMatch ? decodeXmlEntities(linkMatch[1].trim()) : '';

        let rawTag = '';
        let validatedUrl = '';
        let rejectedForeignHref = false;
        if (rawHref) {
            try {
                const parsedHref = validateReleaseUrl(rawHref);
                const segments = parsedHref.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
                if (
                    parsedHref.hostname.toLowerCase() === 'github.com'
                    && segments.length === 5
                    && segments[0].toLowerCase() === GITHUB_REPO_OWNER.toLowerCase()
                    && segments[1].toLowerCase() === GITHUB_REPO_NAME.toLowerCase()
                    && segments[2] === 'releases'
                    && segments[3] === 'tag'
                ) {
                    validatedUrl = parsedHref.toString();
                    rawTag = segments[4];
                } else {
                    rejectedForeignHref = true;
                }
            } catch {
                rejectedForeignHref = true;
            }
        }
        if (rejectedForeignHref) { continue; }

        if (!rawTag) {
            const idMatch = entry.match(/<id\b[^>]*>([\s\S]*?)<\/id>/i);
            const idText = idMatch ? decodeXmlEntities(idMatch[1].trim()) : '';
            const idTail = idText.split('/').pop() || '';
            if (idTail) {
                rawTag = idTail;
            }
        }

        const semver = parseSemver(rawTag);
        if (!semver) { continue; }

        if (!validatedUrl) {
            validatedUrl = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/tag/${encodeURIComponent(rawTag)}`;
        }

        const updatedMatch = entry.match(/<updated\b[^>]*>([\s\S]*?)<\/updated>/i);
        const titleMatch = entry.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);

        candidates.push({
            tagName: rawTag,
            version: semver.normalized,
            releaseUrl: validatedUrl,
            ...(updatedMatch ? { publishedAt: decodeXmlEntities(updatedMatch[1].trim()) } : {}),
            ...(titleMatch ? { title: decodeXmlEntities(titleMatch[1].trim()) } : {}),
            isPrerelease: semver.prerelease.length > 0,
        });
    }

    if (candidates.length === 0) { return null; }

    // Prefer stable releases (matching `/releases/latest` semantics), choosing the highest semver.
    const stable = candidates.filter((c) => !c.isPrerelease);
    const pool = stable.length > 0 ? stable : candidates;
    let best = pool[0];
    for (let i = 1; i < pool.length; i++) {
        if (compareSemver(pool[i].version, best.version) > 0) {
            best = pool[i];
        }
    }
    return {
        tagName: best.tagName,
        version: best.version,
        releaseUrl: best.releaseUrl,
        ...(best.publishedAt ? { publishedAt: best.publishedAt } : {}),
        ...(best.title ? { title: best.title } : {}),
    };
}

// ─── GitHub Release Update Checker ───────────────────────────────────────────

export interface CheckForUpdatesOptions {
    currentVersion: string;
    force?: boolean;
    etag?: string | null;
    lastCheckedAt?: number | null;
    throttleMs?: number;
    timeoutMs?: number;
    releaseApiUrl?: string;
    /** Optional check-only Atom feed URL (must be strict HTTPS port-443 `github.com`). */
    releasesAtomUrl?: string;
    now?: () => number;
    transport?: HttpsRequestTransport;
    env?: NodeJS.ProcessEnv;
    ca?: string | Buffer | Array<string | Buffer>;
}

interface GitHubReleaseAsset {
    name?: unknown;
    browser_download_url?: unknown;
    size?: unknown;
}

interface GitHubReleasePayload {
    tag_name?: unknown;
    html_url?: unknown;
    published_at?: unknown;
    body?: unknown;
    assets?: unknown;
}

function parseApprovedReleasePayload(
    parsed: GitHubReleasePayload,
    options: { expectedTagOrVersion?: string; requireChecksums?: boolean } = {},
): { latestVersion: string; tagName: string; releaseInfo?: PluginReleaseInfo } {
    const tagName = typeof parsed.tag_name === 'string' ? parsed.tag_name.trim() : '';
    const semver = parseSemver(tagName);
    if (!semver) {
        throw new Error(`Invalid release tag version: ${tagName || '(empty)'}`);
    }
    const latestVersion = semver.normalized;
    if (options.expectedTagOrVersion && options.expectedTagOrVersion.trim()) {
        assertReleaseVersionMatches(latestVersion, options.expectedTagOrVersion);
    }

    const assets = Array.isArray(parsed.assets) ? (parsed.assets as GitHubReleaseAsset[]) : [];
    const expectedZipName = expectedAppZipAssetName(latestVersion);
    const matchingZips = assets.filter((a) => typeof a?.name === 'string' && a.name === expectedZipName);
    if (matchingZips.length > 1) {
        throw new Error(`Release ${tagName} contains duplicate ${expectedZipName} assets`);
    }
    const zipAsset = matchingZips[0];

    const matchingChecksums = assets.filter(
        (a) => typeof a?.name === 'string' && a.name.toLowerCase() === CHECKSUMS_ASSET_NAME.toLowerCase(),
    );
    if (matchingChecksums.length > 1) {
        throw new Error(`Release ${tagName} contains conflicting duplicate ${CHECKSUMS_ASSET_NAME} assets`);
    }
    const checksumAsset = matchingChecksums[0];

    let releaseInfo: PluginReleaseInfo | undefined;
    if (zipAsset && typeof zipAsset.name === 'string' && typeof zipAsset.browser_download_url === 'string') {
        // Strictly bind every asset URL to the approved repo, exact tag, and exact asset filename
        const validatedZipUrl = validateApprovedReleaseAssetUrl(zipAsset.browser_download_url, {
            repoSlug: APPROVED_GITHUB_REPO_SLUG,
            tagName,
            assetName: expectedZipName,
        }).toString();

        let validatedChecksumsUrl: string | null = null;
        if (checksumAsset && typeof checksumAsset.browser_download_url === 'string') {
            validatedChecksumsUrl = validateApprovedReleaseAssetUrl(checksumAsset.browser_download_url, {
                repoSlug: APPROVED_GITHUB_REPO_SLUG,
                tagName,
                assetName: CHECKSUMS_ASSET_NAME,
                caseInsensitiveAssetName: true,
            }).toString();
        } else if (options.requireChecksums) {
            throw new Error(
                `SHA256SUMS.txt is required for plugin self-update but was not published for release ${tagName}`,
            );
        }

        const rawHtmlUrl = typeof parsed.html_url === 'string' && parsed.html_url.trim()
            ? validateApprovedReleaseHtmlUrl(parsed.html_url, {
                repoSlug: APPROVED_GITHUB_REPO_SLUG,
                tagName,
            }).toString()
            : `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/tag/${encodeURIComponent(tagName)}`;

        releaseInfo = {
            version: latestVersion,
            tagName,
            releaseUrl: rawHtmlUrl,
            publishedAt: typeof parsed.published_at === 'string' ? parsed.published_at : undefined,
            releaseNotesSummary: summarizeReleaseNotes(typeof parsed.body === 'string' ? parsed.body : ''),
            assetName: zipAsset.name,
            assetUrl: validatedZipUrl,
            assetSize: typeof zipAsset.size === 'number' && Number.isFinite(zipAsset.size) ? zipAsset.size : undefined,
            checksumsUrl: validatedChecksumsUrl,
        };
    } else if (options.requireChecksums) {
        throw new Error(
            `Release ${tagName} does not publish the exact expected asset ${expectedZipName}`,
        );
    }

    return { latestVersion, tagName, releaseInfo };
}

export interface ResolveApprovedReleaseOptions {
    currentVersion: string;
    tagOrVersion?: string;
    timeoutMs?: number;
    transport?: HttpsRequestTransport;
    env?: NodeJS.ProcessEnv;
    ca?: string | Buffer | Array<string | Buffer>;
}

/**
 * Re-resolve an approved GitHub Release directly from the official repository API
 * (`AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor`) and bind its exact
 * tag, expected ZIP asset, and fail-closed `SHA256SUMS.txt` asset before Apply.
 */
export async function resolveApprovedRelease(
    options: ResolveApprovedReleaseOptions,
): Promise<PluginReleaseInfo> {
    const currentVersion = (options.currentVersion || '0.0.0').trim();
    const timeoutMs = options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS;
    const headers: Record<string, string> = {
        'User-Agent': `Antigravity-Context-Monitor/${currentVersion}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };

    const candidateUrls: string[] = [];
    if (options.tagOrVersion && options.tagOrVersion.trim()) {
        const raw = options.tagOrVersion.trim();
        const parsed = parseSemver(raw);
        if (!parsed) {
            throw new Error(`Invalid target release version/tag: "${raw}"`);
        }
        const primaryUrl = buildApprovedReleaseApiUrl(raw, APPROVED_GITHUB_REPO_SLUG);
        candidateUrls.push(primaryUrl);
        if (!raw.startsWith('v') && !raw.startsWith('V')) {
            const bareUrl = `https://api.github.com/repos/${APPROVED_GITHUB_REPO_SLUG}/releases/tags/${encodeURIComponent(parsed.normalized)}`;
            if (!candidateUrls.includes(bareUrl)) {
                candidateUrls.push(bareUrl);
            }
        }
    } else {
        candidateUrls.push(buildApprovedReleaseApiUrl(undefined, APPROVED_GITHUB_REPO_SLUG));
    }

    let lastStatus = 0;
    for (const apiUrl of candidateUrls) {
        const res = await fetchAllowedHttps(apiUrl, {
            headers,
            timeoutMs,
            maxBytes: MAX_API_BODY_BYTES,
            transport: options.transport,
            env: options.env,
            ca: options.ca,
        });
        lastStatus = res.statusCode;
        if (res.statusCode === 404 && candidateUrls.length > 1) {
            continue;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
            throw new Error(`Failed to resolve approved release metadata (HTTP ${res.statusCode})`);
        }
        const payload = JSON.parse(res.body.toString('utf8')) as GitHubReleasePayload;
        const { releaseInfo } = parseApprovedReleasePayload(payload, {
            expectedTagOrVersion: options.tagOrVersion,
            requireChecksums: true,
        });
        if (!releaseInfo) {
            throw new Error('Approved release metadata did not include required release assets');
        }
        validateReleaseIdentity(releaseInfo);
        return releaseInfo;
    }

    throw new Error(`Failed to resolve approved release metadata (HTTP ${lastStatus || 404})`);
}

export function summarizeReleaseNotes(rawBody: string, maxChars = 600): string {
    if (typeof rawBody !== 'string' || !rawBody.trim()) { return ''; }
    const cleaned = rawBody
        .replace(/\r\n/g, '\n')
        .replace(/^#+\s*/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (cleaned.length <= maxChars) {
        return cleaned;
    }
    return `${cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

async function tryCheckViaReleasesAtom(
    options: CheckForUpdatesOptions,
    currentVersion: string,
    nowMs: number,
    nextEtag: string | null,
): Promise<UpdateCheckResult | null> {
    try {
        const atomUrl = validateReleaseUrl(options.releasesAtomUrl || GITHUB_RELEASES_ATOM_URL);
        const atomSegments = atomUrl.pathname.split('/').filter(Boolean);
        if (
            atomUrl.hostname.toLowerCase() !== 'github.com'
            || atomSegments.length !== 3
            || atomSegments[0].toLowerCase() !== GITHUB_REPO_OWNER.toLowerCase()
            || atomSegments[1].toLowerCase() !== GITHUB_REPO_NAME.toLowerCase()
            || atomSegments[2] !== 'releases.atom'
        ) {
            return null;
        }
        const atomRes = await fetchAllowedHttps(atomUrl.toString(), {
            headers: {
                'User-Agent': `Antigravity-Context-Monitor/${currentVersion}`,
                'Accept': 'application/atom+xml, application/xml;q=0.9',
            },
            timeoutMs: options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
            maxBytes: MAX_API_BODY_BYTES,
            transport: options.transport,
            env: options.env,
            ca: options.ca,
        });
        if (atomRes.statusCode < 200 || atomRes.statusCode >= 300) {
            return null;
        }
        const parsedAtom = parseReleasesAtomLatest(atomRes.body.toString('utf8'));
        if (!parsedAtom) {
            return null;
        }
        const hasUpdate = isNewerVersion(parsedAtom.version, currentVersion);
        return {
            status: hasUpdate ? 'update_available' : 'up_to_date',
            hasUpdate,
            currentVersion,
            latestVersion: parsedAtom.version,
            etag: nextEtag,
            checkedAt: nowMs,
            // Check-only discovery: intentionally omit `releaseInfo` so download/install
            // can never bypass fail-closed `SHA256SUMS.txt` verification.
        };
    } catch {
        return null;
    }
}

/**
 * Check GitHub Releases for a newer App plugin release.
 * Throttled by default (6h) unless `force: true`; supports ETag (`If-None-Match`)
 * conditional requests, 12s timeout, and strict HTTPS `github.com` `releases.atom`
 * check-only fallback when the GitHub API is rate-limited (HTTP 403/429).
 */
export async function checkForUpdates(options: CheckForUpdatesOptions): Promise<UpdateCheckResult> {
    const currentVersion = (options.currentVersion || '0.0.0').trim();
    const nowFn = options.now ?? (() => Date.now());
    const nowMs = nowFn();
    const throttleMs = options.throttleMs ?? DEFAULT_UPDATE_CHECK_THROTTLE_MS;
    const etag = options.etag && options.etag.trim() ? options.etag.trim() : null;

    if (!options.force && typeof options.lastCheckedAt === 'number' && options.lastCheckedAt > 0) {
        if (nowMs - options.lastCheckedAt < throttleMs) {
            return {
                status: 'throttled',
                hasUpdate: false,
                currentVersion,
                etag,
                checkedAt: options.lastCheckedAt,
            };
        }
    }

    const headers: Record<string, string> = {
        'User-Agent': `Antigravity-Context-Monitor/${currentVersion}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    };
    if (etag) {
        headers['If-None-Match'] = etag;
    }

    try {
        const res = await fetchAllowedHttps(options.releaseApiUrl || GITHUB_LATEST_RELEASE_URL, {
            headers,
            timeoutMs: options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
            maxBytes: MAX_API_BODY_BYTES,
            transport: options.transport,
            env: options.env,
            ca: options.ca,
        });

        const nextEtag = headerFirst(res.headers, 'etag') || etag;

        if (res.statusCode === 304) {
            return {
                status: 'not_modified',
                hasUpdate: false,
                currentVersion,
                etag: nextEtag,
                checkedAt: nowMs,
            };
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
            if (isGitHubRateLimitResponse(res)) {
                const atomFallback = await tryCheckViaReleasesAtom(options, currentVersion, nowMs, nextEtag);
                if (atomFallback) {
                    return atomFallback;
                }
            }
            return {
                status: 'error',
                hasUpdate: false,
                currentVersion,
                etag: nextEtag,
                checkedAt: nowMs,
                error: `GitHub Releases API returned HTTP ${res.statusCode}`,
            };
        }

        const parsed = JSON.parse(res.body.toString('utf8')) as GitHubReleasePayload;
        const { latestVersion, releaseInfo } = parseApprovedReleasePayload(parsed, {
            requireChecksums: false,
        });

        const hasUpdate = isNewerVersion(latestVersion, currentVersion);
        return {
            status: hasUpdate ? 'update_available' : 'up_to_date',
            hasUpdate,
            currentVersion,
            latestVersion,
            etag: nextEtag,
            checkedAt: nowMs,
            ...(releaseInfo ? { releaseInfo } : {}),
        };
    } catch (err) {
        return {
            status: 'error',
            hasUpdate: false,
            currentVersion,
            etag,
            checkedAt: nowMs,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

// ─── Atomic Install with Backup, Windows Transactional Swap & Rollback ───────

const SWAP_RETRY_DELAYS_MS = [20, 50, 100, 200];
const STAGING_TEMP_FILE_RE = /\.acm-(?:stage|restore)-[0-9a-f-]+$/i;

function isRetryableFsLockError(err: unknown): boolean {
    const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
    return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

function isStagingTempFilename(name: string): boolean {
    return STAGING_TEMP_FILE_RE.test(name);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, ms));
}

async function retryOnFsLock(op: () => Promise<void>): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        try {
            await op();
            return;
        } catch (err) {
            if (!isRetryableFsLockError(err) || attempt >= SWAP_RETRY_DELAYS_MS.length) { throw err; }
            await sleep(SWAP_RETRY_DELAYS_MS[attempt]);
        }
    }
}

const renameWithRetry = (
    src: string,
    dest: string,
    renameFn: (oldPath: string, newPath: string) => Promise<void> = (a, b) => fs.promises.rename(a, b),
): Promise<void> => retryOnFsLock(() => renameFn(src, dest));

const rmWithRetry = (
    targetPath: string,
    options: fs.RmOptions,
    rmFn: (p: string, opts?: fs.RmOptions) => Promise<void> = (p, o) => fs.promises.rm(p, o),
): Promise<void> => retryOnFsLock(() => rmFn(targetPath, options));

async function copyDirContents(srcDir: string, destDir: string): Promise<void> {
    await fs.promises.mkdir(destDir, { recursive: true });
    await fs.promises.cp(srcDir, destDir, {
        recursive: true,
        force: true,
        filter: (src) => !isStagingTempFilename(path.basename(src)),
    });
}

async function listRelativeFiles(rootDir: string, prefix = ''): Promise<string[]> {
    const out: string[] = [];
    if (!fs.existsSync(rootDir)) { return out; }
    const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
        const rel = prefix ? path.posix.join(prefix, entry.name) : entry.name;
        const full = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            out.push(...await listRelativeFiles(full, rel));
        } else if (entry.isFile() || entry.isSymbolicLink()) {
            out.push(rel);
        }
    }
    return out;
}

/**
 * Best-effort pruning of empty subdirectories inside `rootDir`.
 * NEVER throws on `EBUSY`/`EPERM`/`EACCES`/`ENOTEMPTY`/`ENOENT` so locked Windows
 * working directories (such as a running sidecar's `sidecars/context_monitor` CWD)
 * are left harmlessly in place instead of failing an update or rollback.
 */
async function pruneEmptyDirs(
    rootDir: string,
    currentDir = rootDir,
    rmdirFn: (dirPath: string) => Promise<void> = (dirPath) => fs.promises.rmdir(dirPath),
): Promise<void> {
    if (!fs.existsSync(currentDir)) { return; }
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            await pruneEmptyDirs(rootDir, path.join(currentDir, entry.name), rmdirFn);
        }
    }
    if (path.resolve(currentDir) !== path.resolve(rootDir)) {
        try {
            const remaining = await fs.promises.readdir(currentDir);
            if (remaining.length === 0) {
                await rmdirFn(currentDir).catch(() => {});
            }
        } catch {
            // Ignore locked/transient unreadable dirs during best-effort prune
        }
    }
}

interface TransactionalSwapState {
    stagedTempFiles: string[];
    swappedRelPaths: string[];
    movedObsoleteRelPaths: string[];
    obsoleteDir: string;
}

/**
 * Windows locked-directory fallback: stages every new file to a sibling temp file
 * BEFORE modifying any live file, then atomically renames each staged file into place
 * and moves obsolete entries into `obsoleteDir` so any mid-swap lock failure cleanly
 * rolls back every touched file from `backupDir` / `obsoleteDir` without leaving a
 * half-overwritten plugin directory or failing `rmdir` on a running sidecar's CWD.
 */
const IS_CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';
const normRelPath = (rel: string): string => (IS_CASE_INSENSITIVE_FS ? rel.toLowerCase() : rel);

async function swapDirectoryContentsTransactionally(
    extractedRoot: string,
    targetPluginDir: string,
    obsoleteDir: string,
    nonce: string,
    renameFileFn: (src: string, dest: string) => Promise<void>,
    swapState: TransactionalSwapState,
    rmdirDirFn: (dirPath: string) => Promise<void> = (dirPath) => fs.promises.rmdir(dirPath),
): Promise<void> {
    const newFiles = await listRelativeFiles(extractedRoot);
    const existingFiles = await listRelativeFiles(targetPluginDir);
    const newFileSet = new Set(newFiles.map(normRelPath));
    const obsoleteFiles = existingFiles.filter((rel) => !newFileSet.has(normRelPath(rel)));
    const movedObsoleteSet = new Set<string>(swapState.movedObsoleteRelPaths.map(normRelPath));

    const moveObsoleteFileToTrash = async (rel: string): Promise<void> => {
        const key = normRelPath(rel);
        if (movedObsoleteSet.has(key)) { return; }
        const livePath = path.join(targetPluginDir, ...rel.split('/'));
        if (!fs.existsSync(livePath)) { return; }
        const trashPath = path.join(obsoleteDir, ...rel.split('/'));
        await fs.promises.mkdir(path.dirname(trashPath), { recursive: true });
        await renameWithRetry(livePath, trashPath, renameFileFn);
        movedObsoleteSet.add(key);
        swapState.movedObsoleteRelPaths.push(rel);
    };

    // Pre-phase: resolve file-vs-directory type collisions (e.g. obsolete file sitting at a path
    // that must now be a parent directory, or obsolete directory sitting at a new file's path).
    for (const rel of newFiles) {
        const parts = rel.split('/');
        for (let depth = 1; depth < parts.length; depth++) {
            const ancestorRel = parts.slice(0, depth).join('/');
            const ancestorPath = path.join(targetPluginDir, ...parts.slice(0, depth));
            let st: fs.Stats | null = null;
            try {
                st = await fs.promises.lstat(ancestorPath);
            } catch {
                st = null;
            }
            if (st && !st.isDirectory()) {
                await moveObsoleteFileToTrash(ancestorRel);
            }
        }
        const destPath = path.join(targetPluginDir, ...parts);
        let destStat: fs.Stats | null = null;
        try {
            destStat = await fs.promises.lstat(destPath);
        } catch {
            destStat = null;
        }
        if (destStat && destStat.isDirectory()) {
            const nestedObsolete = await listRelativeFiles(destPath, rel);
            for (const nestedRel of nestedObsolete) {
                await moveObsoleteFileToTrash(nestedRel);
            }
            await pruneEmptyDirs(destPath, destPath, rmdirDirFn);
            await rmdirDirFn(destPath);
        }
    }

    // Phase 1: Stage all new payloads into temp files without touching any live file yet
    const stagedPairs: Array<{ rel: string; stagedPath: string; destPath: string }> = [];
    for (const rel of newFiles) {
        const srcPath = path.join(extractedRoot, ...rel.split('/'));
        const destPath = path.join(targetPluginDir, ...rel.split('/'));
        const stagedPath = `${destPath}.acm-stage-${nonce}`;
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        await fs.promises.copyFile(srcPath, stagedPath);
        swapState.stagedTempFiles.push(stagedPath);
        stagedPairs.push({ rel, stagedPath, destPath });
    }

    // Phase 2: Atomically swap each staged file into its final path
    for (const pair of stagedPairs) {
        await renameWithRetry(pair.stagedPath, pair.destPath, renameFileFn);
        swapState.swappedRelPaths.push(pair.rel);
    }

    // Phase 3: Move obsolete old files out to `obsoleteDir` (reversible on rollback)
    if (obsoleteFiles.length > 0) {
        await fs.promises.mkdir(obsoleteDir, { recursive: true });
        for (const rel of obsoleteFiles) {
            await moveObsoleteFileToTrash(rel);
        }
    }

    // Phase 4: Best-effort prune empty directories without ever failing on locked Windows CWDs
    await pruneEmptyDirs(targetPluginDir, targetPluginDir, rmdirDirFn);
}

interface RollbackSwapOutcome {
    ok: boolean;
    failedFiles: string[];
    error?: string;
}

async function rollbackTransactionalSwap(
    targetPluginDir: string,
    backupDir: string,
    nonce: string,
    swapState: TransactionalSwapState,
    rollbackRenameFileFn: (src: string, dest: string) => Promise<void> = fs.promises.rename,
    rmdirDirFn: (dirPath: string) => Promise<void> = (dirPath) => fs.promises.rmdir(dirPath),
    rmPathFn: (p: string, opts?: fs.RmOptions) => Promise<void> = (p, o) => fs.promises.rm(p, o),
): Promise<RollbackSwapOutcome> {
    const failedFiles: string[] = [];
    const errors: string[] = [];

    // 1. Clean up any unswapped temp stage files first
    for (const stagedPath of swapState.stagedTempFiles) {
        if (fs.existsSync(stagedPath)) {
            await rmWithRetry(stagedPath, { force: true }, rmPathFn).catch(() => {});
        }
    }

    // 2. Restore every swapped file from backupDir (or remove newly introduced files) first
    //    so any newly-created files/directories blocking obsolete paths are cleared cleanly.
    const backupFileMap = new Map<string, string>();
    for (const bRel of await listRelativeFiles(backupDir)) {
        backupFileMap.set(normRelPath(bRel), bRel);
    }
    for (const rel of swapState.swappedRelPaths) {
        const livePath = path.join(targetPluginDir, ...rel.split('/'));
        const matchedBackupRel = backupFileMap.get(normRelPath(rel));
        try {
            if (matchedBackupRel !== undefined) {
                const backupFile = path.join(backupDir, ...matchedBackupRel.split('/'));
                const restoreTmp = `${livePath}.acm-restore-${nonce}`;
                await fs.promises.mkdir(path.dirname(livePath), { recursive: true });
                await fs.promises.copyFile(backupFile, restoreTmp);
                try {
                    await renameWithRetry(restoreTmp, livePath, rollbackRenameFileFn);
                } catch (renameErr) {
                    await rmWithRetry(restoreTmp, { force: true }, rmPathFn).catch(() => {});
                    throw renameErr;
                }
            } else if (fs.existsSync(livePath)) {
                await rmWithRetry(livePath, { force: true }, rmPathFn);
            }
        } catch (err) {
            failedFiles.push(rel);
            errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    await pruneEmptyDirs(targetPluginDir, targetPluginDir, rmdirDirFn);

    // 3. Restore any obsolete files moved out of targetPluginDir
    for (const rel of swapState.movedObsoleteRelPaths) {
        const trashPath = path.join(swapState.obsoleteDir, ...rel.split('/'));
        const livePath = path.join(targetPluginDir, ...rel.split('/'));
        if (fs.existsSync(trashPath)) {
            try {
                await fs.promises.mkdir(path.dirname(livePath), { recursive: true });
                await renameWithRetry(trashPath, livePath, rollbackRenameFileFn);
            } catch (err) {
                failedFiles.push(rel);
                errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    await pruneEmptyDirs(targetPluginDir, targetPluginDir, rmdirDirFn);

    if (failedFiles.length === 0) {
        // Retain backupDir / obsoleteDir until caller completes post-rollback bundle verification!
        return { ok: true, failedFiles: [] };
    }

    // Preserve backupDir / obsoleteDir when rollback could not restore every file!
    return {
        ok: false,
        failedFiles,
        error: `Rollback failed for ${failedFiles.join(', ')} (${errors.join('; ')})`,
    };
}

export interface ObservedPluginDiskState {
    targetExists: boolean;
    manifestVersion: string | null;
    bundleValid: boolean;
    integrity: 'intact' | 'partial' | 'missing' | 'corrupt';
    backupPreservedAt?: string;
    rollbackError?: string;
    failedRollbackFiles?: string[];
}

export interface ApplyAppPluginUpdateResult extends ApplyPluginUpdateResult {
    observedDiskState?: ObservedPluginDiskState;
}

function observeInstalledPluginDiskState(
    targetPluginDir: string,
    opts: {
        expectedIntactVersion: string;
        mutated: boolean;
        rolledBack: boolean;
        backupDir: string;
        rollbackError?: string;
        failedRollbackFiles?: string[];
    },
): { observed: ObservedPluginDiskState; honestInstalledVersion: string } {
    const targetExists = fs.existsSync(targetPluginDir);
    let manifestVersion: string | null = null;
    let bundleValid = false;

    if (targetExists) {
        const manifestPath = path.join(targetPluginDir, 'plugin.json');
        if (fs.existsSync(manifestPath)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')) as { version?: unknown };
                if (typeof parsed?.version === 'string' && parsed.version.trim()) {
                    manifestVersion = parsed.version.trim();
                }
            } catch {
                manifestVersion = null;
            }
        }
        try {
            validateExtractedPluginBundle(targetPluginDir);
            bundleValid = true;
        } catch {
            bundleValid = false;
        }
    }

    const backupPreservedAt = fs.existsSync(opts.backupDir) ? opts.backupDir : undefined;

    let integrity: ObservedPluginDiskState['integrity'];
    if (!targetExists) {
        integrity = 'missing';
    } else if (opts.mutated && !opts.rolledBack) {
        integrity = manifestVersion !== null ? 'partial' : 'corrupt';
    } else if (bundleValid && manifestVersion === opts.expectedIntactVersion) {
        integrity = 'intact';
    } else if (bundleValid && manifestVersion !== null) {
        integrity = 'intact';
    } else {
        integrity = 'corrupt';
    }

    const honestInstalledVersion =
        integrity === 'intact' && manifestVersion
            ? manifestVersion
            : 'unknown';

    const observed: ObservedPluginDiskState = {
        targetExists,
        manifestVersion,
        bundleValid,
        integrity,
        ...(backupPreservedAt ? { backupPreservedAt } : {}),
        ...(opts.rollbackError ? { rollbackError: opts.rollbackError } : {}),
        ...(opts.failedRollbackFiles && opts.failedRollbackFiles.length > 0
            ? { failedRollbackFiles: opts.failedRollbackFiles }
            : {}),
    };
    return { observed, honestInstalledVersion };
}

export interface ApplyAppPluginUpdateOptions {
    targetPluginDir: string;
    releaseInfo?: PluginReleaseInfo;
    /** Optional explicit tag or version to re-resolve directly from the approved GitHub repo before Apply. */
    targetTagOrVersion?: string;
    currentVersion: string;
    timeoutMs?: number;
    now?: () => number;
    transport?: HttpsRequestTransport;
    env?: NodeJS.ProcessEnv;
    ca?: string | Buffer | Array<string | Buffer>;
    /**
     * Re-resolve the exact approved release assets & SHA256SUMS.txt from the official GitHub API
     * before downloading. Defaults to `true` for live transport, or `false` when a custom unit-test
     * `transport` is injected without `reResolveRelease: true`.
     */
    reResolveRelease?: boolean;
    /** Cross-process update lock wait timeout in ms (default 10s). */
    lockTimeoutMs?: number;
    /** Stale lock age threshold in ms (default 5m). */
    lockStaleMs?: number;
    /** Optional test hook fired inside the update lock immediately before filesystem swap. */
    onBeforeSwap?: () => Promise<void> | void;
    /** Optional hook invoked when renaming directories (for rollback/lock testing). */
    renameDir?: (src: string, dest: string) => Promise<void>;
    /** Optional hook invoked when renaming individual files during Windows transactional fallback testing. */
    renameFile?: (src: string, dest: string) => Promise<void>;
    /** Optional hook invoked when renaming directories during rollback testing. */
    rollbackRenameDir?: (src: string, dest: string) => Promise<void>;
    /** Optional hook invoked when renaming individual files during Windows transactional rollback testing. */
    rollbackRenameFile?: (src: string, dest: string) => Promise<void>;
    /** Optional hook invoked when removing empty subdirectories (for Windows CWD EBUSY testing). */
    rmdirDir?: (dirPath: string) => Promise<void>;
    /** Optional hook invoked when removing files/dirs during cleanup or rollback (for Windows EBUSY testing). */
    rmPath?: (targetPath: string, options?: fs.RmOptions) => Promise<void>;
}

/**
 * Download, verify (approved repo+tag+asset identity + fail-closed SHA-256 + safe ZIP +
 * bundle manifest & release-tag version parity), and atomically install a GitHub Release
 * App plugin update into `targetPluginDir` under a cross-process lock with automatic
 * backup, rollback, and honest post-failure disk state reporting.
 */
export async function applyAppPluginUpdate(
    options: ApplyAppPluginUpdateOptions,
): Promise<ApplyAppPluginUpdateResult> {
    const currentVersion = (options.currentVersion || '0.0.0').trim();
    const targetPluginDir = path.resolve(options.targetPluginDir);
    const parentDir = path.dirname(targetPluginDir);
    const nowFn = options.now ?? (() => Date.now());
    const nowMs = nowFn();
    const nonce = crypto.randomBytes(4).toString('hex');
    const stageDir = path.join(parentDir, `.${path.basename(targetPluginDir)}.stage-${nowMs}-${nonce}`);
    const backupDir = `${targetPluginDir}.bak-${nowMs}-${nonce}`;
    const obsoleteDir = `${targetPluginDir}.obsolete-${nowMs}-${nonce}`;
    const renameDirFn = options.renameDir ?? fs.promises.rename;
    const renameFileFn = options.renameFile ?? fs.promises.rename;
    const rollbackRenameDirFn = options.rollbackRenameDir ?? fs.promises.rename;
    const rollbackRenameFileFn = options.rollbackRenameFile ?? fs.promises.rename;
    const rmdirDirFn = options.rmdirDir ?? ((dirPath: string) => fs.promises.rmdir(dirPath));
    const rmPathFn = options.rmPath ?? ((targetPath: string, opts?: fs.RmOptions) => fs.promises.rm(targetPath, opts));
    const downloadTimeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;

    const reqHeaders = {
        'User-Agent': `Antigravity-Context-Monitor/${currentVersion}`,
        'Accept': 'application/octet-stream',
    };

    let checksumVerified = false;
    let movedExistingToBackup = false;
    let copiedExistingToBackup = false;
    let previousDiskVersion = currentVersion;
    let lockHandle: PluginUpdateLockHandle | null = null;
    const swapState: TransactionalSwapState = {
        stagedTempFiles: [],
        swappedRelPaths: [],
        movedObsoleteRelPaths: [],
        obsoleteDir,
    };

    try {
        // 1. Resolve & strictly bind release identity (approved repo + tag + exact ZIP + fail-closed SHA256SUMS.txt)
        const shouldReResolve = options.reResolveRelease ?? (!options.transport);
        let activeRelease: PluginReleaseInfo;
        if (shouldReResolve) {
            const targetTagOrVersion =
                options.targetTagOrVersion
                || options.releaseInfo?.tagName
                || options.releaseInfo?.version;
            activeRelease = await resolveApprovedRelease({
                currentVersion,
                tagOrVersion: targetTagOrVersion,
                timeoutMs: DEFAULT_API_TIMEOUT_MS,
                transport: options.transport,
                env: options.env,
                ca: options.ca,
            });
        } else {
            if (!options.releaseInfo) {
                throw new Error('Release metadata is required when reResolveRelease is disabled');
            }
            activeRelease = options.releaseInfo;
        }

        const boundIdentity = validateReleaseIdentity({
            repoSlug: APPROVED_GITHUB_REPO_SLUG,
            version: activeRelease.version,
            tagName: activeRelease.tagName,
            assetName: activeRelease.assetName,
            assetUrl: activeRelease.assetUrl,
            checksumsUrl: activeRelease.checksumsUrl,
            releaseUrl: activeRelease.releaseUrl,
        });

        // 2. Acquire cross-process lock to serialize concurrent UI/CLI updates on targetPluginDir
        lockHandle = await acquirePluginUpdateLock(targetPluginDir, {
            owner: 'ui-updater',
            timeoutMs: options.lockTimeoutMs,
            staleMs: options.lockStaleMs,
            now: nowFn,
        });

        // 3. Download ZIP archive
        const zipRes = await fetchAllowedHttps(boundIdentity.assetUrl, {
            headers: reqHeaders,
            timeoutMs: downloadTimeoutMs,
            maxBytes: MAX_ARCHIVE_BYTES,
            transport: options.transport,
            env: options.env,
            ca: options.ca,
        });
        if (zipRes.statusCode < 200 || zipRes.statusCode >= 300) {
            throw new Error(`Failed to download update archive (HTTP ${zipRes.statusCode})`);
        }
        const zipBuf = zipRes.body;

        // 4. Download & verify SHA256SUMS.txt (strict fail-closed — NEVER skipped in App self-update)
        const sumRes = await fetchAllowedHttps(boundIdentity.checksumsUrl, {
            headers: {
                'User-Agent': `Antigravity-Context-Monitor/${currentVersion}`,
                'Accept': 'text/plain',
            },
            timeoutMs: DEFAULT_API_TIMEOUT_MS,
            maxBytes: MAX_CHECKSUMS_BYTES,
            transport: options.transport,
            env: options.env,
            ca: options.ca,
        });
        if (sumRes.statusCode < 200 || sumRes.statusCode >= 300) {
            throw new Error(`Failed to download SHA256SUMS.txt (HTTP ${sumRes.statusCode})`);
        }
        const sums = parseSha256Sums(sumRes.body.toString('utf8'));
        const expectedDigest = lookupSha256Sum(sums, boundIdentity.assetName);
        if (!expectedDigest) {
            throw new Error(`SHA256SUMS.txt did not contain an entry for ${boundIdentity.assetName}`);
        }
        if (!verifyBufferSha256(zipBuf, expectedDigest)) {
            throw new Error(`SHA-256 checksum mismatch for ${boundIdentity.assetName}`);
        }
        checksumVerified = true;

        // 5. Safe pure-Node ZIP extraction into temp staging dir
        await fs.promises.mkdir(parentDir, { recursive: true });
        await fs.promises.mkdir(stageDir, { recursive: true });
        extractZipSafe(zipBuf, stageDir);

        // 6. Resolve & validate extracted plugin bundle AND enforce tag <-> plugin.json version parity
        const extractedRoot = resolveExtractedPluginRoot(stageDir);
        const validated = validateExtractedPluginBundle(extractedRoot, {
            expectedVersion: boundIdentity.version,
        });

        if (typeof options.onBeforeSwap === 'function') {
            await options.onBeforeSwap();
        }

        // Re-verify lock ownership immediately before mutating the live plugin directory
        if (lockHandle?.verifyOwned && !lockHandle.verifyOwned()) {
            throw new Error('Lost plugin update lock ownership before filesystem swap');
        }

        // Capture actual pre-update on-disk version (which may differ from the running process's
        // `currentVersion` when a previous upgrade is awaiting reload) so rollback verifies honestly.
        const hadExisting = fs.existsSync(targetPluginDir);
        if (hadExisting) {
            try {
                const existingManifest = path.join(targetPluginDir, 'plugin.json');
                if (fs.existsSync(existingManifest)) {
                    const parsedExisting = JSON.parse(
                        fs.readFileSync(existingManifest, 'utf8').replace(/^\uFEFF/, ''),
                    ) as { version?: unknown };
                    if (typeof parsedExisting?.version === 'string' && parseSemver(parsedExisting.version.trim())) {
                        previousDiskVersion = parsedExisting.version.trim();
                    }
                }
            } catch {
                // Keep fallback `currentVersion` when existing manifest is unreadable
            }
        }

        // 7. Atomic swap with backup & Windows locked-dir transactional staging swap fallback
        if (hadExisting) {
            try {
                await renameWithRetry(targetPluginDir, backupDir, renameDirFn);
                movedExistingToBackup = true;
            } catch (backupErr) {
                const code = (backupErr as NodeJS.ErrnoException).code;
                const isLockErr = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
                if (!isLockErr) {
                    throw backupErr;
                }
                // Windows open-handle fallback: snapshot existing dir to backup, then perform
                // per-file staging + atomic rename swap (never pre-wiping targetPluginDir).
                await copyDirContents(targetPluginDir, backupDir);
                copiedExistingToBackup = true;
            }
        }

        if (copiedExistingToBackup) {
            await swapDirectoryContentsTransactionally(
                extractedRoot,
                targetPluginDir,
                obsoleteDir,
                nonce,
                renameFileFn,
                swapState,
                rmdirDirFn,
            );
        } else {
            await renameWithRetry(extractedRoot, targetPluginDir, renameDirFn);
        }

        // 8. Post-swap sanity validation (including version parity)
        validateExtractedPluginBundle(targetPluginDir, {
            expectedVersion: boundIdentity.version,
        });

        // 9. Cleanup backup, obsolete trash & staging on success (never fails on Windows locks)
        if (fs.existsSync(backupDir)) {
            await rmWithRetry(backupDir, { recursive: true, force: true }, rmPathFn).catch(() => {});
        }
        if (fs.existsSync(obsoleteDir)) {
            await rmWithRetry(obsoleteDir, { recursive: true, force: true }, rmPathFn).catch(() => {});
        }
        await rmWithRetry(stageDir, { recursive: true, force: true }, rmPathFn).catch(() => {});

        return {
            ok: true,
            previousVersion: currentVersion,
            installedVersion: validated.version,
            requiresReload: true,
            checksumVerified,
            message: `Updated antigravity-context-monitor from v${currentVersion} to v${validated.version}. Reload or toggle the plugin in Antigravity Customizations to apply.`,
        };
    } catch (err) {
        let rolledBack = false;
        let rollbackError: string | undefined;
        let failedRollbackFiles: string[] = [];
        const mutated = movedExistingToBackup
            || swapState.swappedRelPaths.length > 0
            || swapState.movedObsoleteRelPaths.length > 0;

        if (movedExistingToBackup || copiedExistingToBackup) {
            try {
                if (movedExistingToBackup) {
                    let removedLockedTarget = true;
                    if (fs.existsSync(targetPluginDir)) {
                        try {
                            await rmWithRetry(targetPluginDir, { recursive: true, force: true }, rmPathFn);
                        } catch (rmErr) {
                            if (!isRetryableFsLockError(rmErr)) {
                                throw rmErr;
                            }
                            removedLockedTarget = false;
                        }
                    }
                    if (!fs.existsSync(backupDir)) {
                        rollbackError = 'Backup directory missing during rollback';
                    } else if (removedLockedTarget) {
                        await renameWithRetry(backupDir, targetPluginDir, rollbackRenameDirFn);
                        rolledBack = true;
                    } else {
                        // Windows locked target dir during post-swap rollback: restore in-place
                        // from `backupDir` without requiring `rmdir` on the locked CWD!
                        const restoreObsoleteDir = `${targetPluginDir}.rb-obsolete-${nowMs}-${nonce}`;
                        const restoreState: TransactionalSwapState = {
                            stagedTempFiles: [],
                            swappedRelPaths: [],
                            movedObsoleteRelPaths: [],
                            obsoleteDir: restoreObsoleteDir,
                        };
                        await swapDirectoryContentsTransactionally(
                            backupDir,
                            targetPluginDir,
                            restoreObsoleteDir,
                            `rb-${nonce}`,
                            rollbackRenameFileFn,
                            restoreState,
                            rmdirDirFn,
                        );
                        await rmWithRetry(restoreObsoleteDir, { recursive: true, force: true }, rmPathFn).catch(() => {});
                        rolledBack = true;
                    }
                } else if (copiedExistingToBackup && fs.existsSync(backupDir)) {
                    const rb = await rollbackTransactionalSwap(
                        targetPluginDir,
                        backupDir,
                        nonce,
                        swapState,
                        rollbackRenameFileFn,
                        rmdirDirFn,
                        rmPathFn,
                    );
                    rolledBack = rb.ok;
                    failedRollbackFiles = rb.failedFiles;
                    if (!rb.ok) {
                        rollbackError = rb.error;
                    }
                }
            } catch (rbErr) {
                rolledBack = false;
                rollbackError = rbErr instanceof Error ? rbErr.message : String(rbErr);
            }
        }

        // Verify that a claimed rollback actually restored a valid bundle matching the pre-update
        // on-disk version BEFORE deleting backupDir / obsoleteDir!
        if (rolledBack) {
            try {
                validateExtractedPluginBundle(targetPluginDir, {
                    expectedVersion: previousDiskVersion,
                });
            } catch (verifyErr) {
                rolledBack = false;
                rollbackError = `Post-rollback verification failed: ${verifyErr instanceof Error ? verifyErr.message : String(verifyErr)}`;
            }
        }

        // Preserve recovery artifacts when rollback failed on a mutated directory;
        // clean up backup/obsolete/stage artifacts ONLY when pre-mutation or after verified rollback.
        if (!mutated || rolledBack) {
            await rmWithRetry(backupDir, { recursive: true, force: true }, rmPathFn).catch(() => {});
            await rmWithRetry(obsoleteDir, { recursive: true, force: true }, rmPathFn).catch(() => {});
        }
        await rmWithRetry(stageDir, { recursive: true, force: true }, rmPathFn).catch(() => {});

        const { observed, honestInstalledVersion } = observeInstalledPluginDiskState(targetPluginDir, {
            expectedIntactVersion: previousDiskVersion,
            mutated,
            rolledBack,
            backupDir,
            rollbackError,
            failedRollbackFiles,
        });

        const msg = err instanceof Error ? err.message : String(err);
        let detailedMessage: string;
        if (rolledBack) {
            detailedMessage = `Plugin update failed and was rolled back to v${honestInstalledVersion}: ${msg}`;
        } else if (mutated) {
            const diskDesc = !observed.targetExists
                ? 'target directory missing on disk'
                : (observed.manifestVersion
                    ? `partial/unverified on-disk state (observed plugin.json v${observed.manifestVersion})`
                    : 'corrupt/unreadable on-disk state');
            const backupHint = observed.backupPreservedAt
                ? `; backup preserved at ${observed.backupPreservedAt}`
                : '';
            const rbDetail = rollbackError ? `; rollback failed (${rollbackError})` : '; rollback incomplete';
            detailedMessage = `Plugin update failed (${msg})${rbDetail}; ${diskDesc}${backupHint}.`;
        } else {
            detailedMessage = `Plugin update failed: ${msg}`;
        }

        return {
            ok: false,
            previousVersion: currentVersion,
            installedVersion: honestInstalledVersion,
            requiresReload: false,
            checksumVerified,
            rolledBack,
            observedDiskState: observed,
            message: detailedMessage,
            error: mutated && !rolledBack && rollbackError ? `${msg}; ${rollbackError}` : msg,
        };
    } finally {
        lockHandle?.release();
    }
}

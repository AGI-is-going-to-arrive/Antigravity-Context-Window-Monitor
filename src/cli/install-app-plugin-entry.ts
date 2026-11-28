/**
 * Single-Source Cross-Platform Installer, Upgrader, Status Inspector & Uninstaller
 * for the Antigravity Context Monitor App Sidecar plugin (D6, §4.3, Stage 2).
 *
 * Bundled via `scripts/build-bundles.mjs` into zero-dependency standalone ESM
 * `scripts/install-app-plugin.mjs` consuming the shared pure-Node cores:
 *   - `src/core/release-security.ts` (semver, HTTPS allowlist, release binding, SHA256SUMS, safe ZIP, update lock path)
 *   - `src/core/cdp-launcher-core.ts` (macOS/Windows/Linux launcher paths, AppleScript/Shell/Desktop/SVG builders)
 *   - `src/core/version.ts` (build-time & manifest version/buildId resolution)
 *
 * Strictly zero `vscode` imports and zero external npm dependencies.
 * Works identically when executed from:
 *   - repository checkout (`node scripts/install-app-plugin.mjs ...`)
 *   - downloaded standalone file (`node /tmp/acm-install.mjs ...`)
 *   - stdin pipe (`node - ... < acm-install.mjs` or `node --input-type=module - ...`)
 */

import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
    chmodSync,
    closeSync,
    copyFileSync,
    cpSync,
    existsSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmdirSync,
    rmSync,
    statSync,
    unlinkSync,
    utimesSync,
    writeFileSync,
    type Stats,
} from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import * as tls from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    CDP_LAUNCHER_DISPLAY_NAME,
    LINUX_APPIMAGE_PROCESS_RE,
    LINUX_CDP_ICON_FILENAME,
    LINUX_FLATPAK_APP_ID,
    MACOS_ANTIGRAVITY_BUNDLE_ID,
    MACOS_CDP_BUNDLE_NAME,
    MACOS_CDP_LAUNCHER_BUNDLE_ID,
    MACOS_SYSTEM_APPLICATIONS_DIR,
    WINDOWS_DESKTOP_PS_SCRIPT,
    assertSafeMacOsBundleWriteTarget,
    buildLinuxBadgedSvg,
    buildLinuxDesktopEntry,
    buildLinuxLauncherScript,
    buildMacOsInfoPlist,
    buildMacOsLauncherScript,
    defaultCommandExists,
    dirnameTargetPath,
    getFastWindowsDesktopFallback,
    getSafeCdpLaunchCommand,
    isMacAppBundleInstalled,
    isOwnedMacCdpBundle,
    joinTargetPath,
    normalizePosixComparable,
    readMacBundleIdentifier,
    resolveCoreCdpLauncherPaths,
    resolveLinuxXdgConfigHome,
    type CoreResolvedLauncherPaths,
} from '../core/cdp-launcher-core';
import {
    ALLOWED_RELEASE_HOSTS,
    APPROVED_GITHUB_REPO_SLUG,
    EXPECTED_PLUGIN_NAME,
    MAX_ARCHIVE_BYTES,
    MAX_EXTRACTED_BYTES,
    MAX_REDIRECT_HOPS,
    MAX_ZIP_ENTRIES,
    assertReleaseVersionMatches,
    assertSafeArchiveEntryPath as coreAssertSafeArchiveEntryPath,
    compareSemver as coreCompareSemver,
    computeSha256Hex,
    extractZipSafe,
    getPluginUpdateLockPath,
    parseSemver,
    parseSha256Sums,
    tryReclaimStaleUpdateLock,
    resolveExtractedPluginRoot,
    validateApprovedReleaseAssetUrl,
    publishExclusiveFileSync,
    validateExtractedPluginBundle,
    validateReleaseUrl,
    validateRepoSlug as coreValidateRepoSlug,
    verifyBufferSha256 as coreVerifyBufferSha256,
} from '../core/release-security';
import {
    FALLBACK_APP_VERSION,
    resolveRuntimeVersion,
} from '../core/version';

// Build-time macros substituted by `scripts/build-bundles.mjs` when emitting ESM.
declare const __ACM_IMPORT_META_URL__: string | undefined;
declare const __ACM_IMPORT_META_MAIN__: boolean | undefined;

export const PLUGIN_DIR_NAME = EXPECTED_PLUGIN_NAME;
export const DEFAULT_GITHUB_REPO = APPROVED_GITHUB_REPO_SLUG;
export const IDE_EXTENSION_ID_PREFIX = 'agi-is-going-to-arrive.antigravity-context-monitor-';
export const ALLOWED_DOWNLOAD_HOSTS: ReadonlySet<string> = ALLOWED_RELEASE_HOSTS;

export {
    CDP_LAUNCHER_DISPLAY_NAME,
    LINUX_APPIMAGE_PROCESS_RE,
    LINUX_CDP_ICON_FILENAME,
    LINUX_FLATPAK_APP_ID,
    MACOS_ANTIGRAVITY_BUNDLE_ID,
    MACOS_CDP_BUNDLE_NAME,
    MACOS_CDP_LAUNCHER_BUNDLE_ID,
    MACOS_SYSTEM_APPLICATIONS_DIR,
    WINDOWS_DESKTOP_PS_SCRIPT,
    assertReleaseVersionMatches,
    buildLinuxBadgedSvg,
    buildLinuxDesktopEntry,
    buildLinuxLauncherScript,
    buildMacOsInfoPlist,
    buildMacOsLauncherScript,
    computeSha256Hex,
    getPluginUpdateLockPath,
    getSafeCdpLaunchCommand,
    isOwnedMacCdpBundle,
    parseSemver,
    parseSha256Sums,
    readMacBundleIdentifier,
};
export const buildMacOsLauncherPlist = buildMacOsInfoPlist;

const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const USER_AGENT = `Antigravity-Context-Monitor-Installer/${resolveRuntimeVersion({ fallbackVersion: FALLBACK_APP_VERSION })}`;
const MAX_EMBEDDED_ICON_BYTES = 2 * 1024 * 1024;
export const WINDOWS_DESKTOP_CACHE_TTL_MS = 60_000;

// ─── Entrypoint & Checkout Detection (Downloaded-File & Stdin Safe) ──────────

function getEntryMetaUrl(): string {
    try {
        if (typeof __ACM_IMPORT_META_URL__ === 'string') {
            return __ACM_IMPORT_META_URL__;
        }
    } catch {
        // Unbundled CJS/Vitest runtime
    }
    if (typeof __filename === 'string' && __filename) {
        return pathToFileURL(__filename).href;
    }
    return '';
}

function getEntryMetaMain(): boolean | undefined {
    try {
        if (typeof __ACM_IMPORT_META_MAIN__ === 'boolean') {
            return __ACM_IMPORT_META_MAIN__;
        }
    } catch {
        // Unbundled runtime
    }
    return undefined;
}

function getScriptFilePath(metaUrl: string = getEntryMetaUrl()): string | null {
    if (!metaUrl || !metaUrl.startsWith('file:')) {
        return null;
    }
    if (/\/\[eval\d*\]$/i.test(metaUrl)) {
        return null;
    }
    try {
        const filePath = fileURLToPath(metaUrl);
        if (filePath && existsSync(filePath)) {
            return filePath;
        }
    } catch {
        // ignore invalid file URL
    }
    return null;
}

/**
 * Direct-execution guard supporting BOTH downloaded standalone files (including
 * macOS `/tmp` -> `/private/tmp` symlinks) AND stdin pipe execution
 * (`node - ... < acm-install.mjs`, `node --input-type=module - ...`, `node < acm-install.mjs`),
 * while returning `false` when imported as a module by Vitest or scripts.
 */
export function isDirectExecution(
    argv: readonly string[] = process.argv,
    metaUrl: string = getEntryMetaUrl(),
    metaMain: boolean | undefined = getEntryMetaMain(),
): boolean {
    if (metaMain === true) {
        return true;
    }
    const entryArg = argv[1];
    const isEvalMeta = typeof metaUrl === 'string' && /\/\[eval\d*\]$/i.test(metaUrl);
    if (isEvalMeta && (!entryArg || entryArg === '-')) {
        return true;
    }
    if (!entryArg || entryArg === '-') {
        return false;
    }
    let metaPath: string;
    try {
        metaPath = fileURLToPath(metaUrl);
    } catch {
        return false;
    }
    const resolvedArg = resolve(entryArg);
    if (resolvedArg === metaPath) {
        return true;
    }
    try {
        return realpathSync(resolvedArg) === realpathSync(metaPath);
    } catch {
        return false;
    }
}

function isOwnedPluginManifestFile(manifestPath: string): boolean {
    if (!existsSync(manifestPath)) { return false; }
    try {
        const parsed = readJsonNoBom(manifestPath);
        return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.name === PLUGIN_DIR_NAME);
    } catch {
        return false;
    }
}

/** Only replace our own installation or a fresh, empty destination. */
function assertPluginTarget(targetDir: string, allowEmpty = false): void {
    const target = lstatSync(targetDir, { throwIfNoEntry: false });
    if (!target) { return; }
    if (target.isDirectory() && !target.isSymbolicLink()) {
        const manifestPath = join(targetDir, 'plugin.json');
        if (lstatSync(manifestPath, { throwIfNoEntry: false })?.isFile() && isOwnedPluginManifestFile(manifestPath)) { return; }
        if (allowEmpty && readdirSync(targetDir).length === 0) { return; }
    }
    throw new Error(`Refusing to modify an unrecognized plugin destination: ${targetDir}`);
}

function isVerifiedRepoCheckout(candidateRoot: string): boolean {
    const pkgPath = join(candidateRoot, 'package.json');
    if (!existsSync(pkgPath)) { return false; }
    try {
        const pkg = readJsonNoBom(pkgPath);
        if (!pkg || typeof pkg !== 'object' || pkg.name !== PLUGIN_DIR_NAME) {
            return false;
        }
    } catch {
        return false;
    }
    return isOwnedPluginManifestFile(join(candidateRoot, 'app-plugin', 'plugin.json'))
        || isOwnedPluginManifestFile(join(candidateRoot, 'dist', 'antigravity-context-monitor-app', 'plugin.json'));
}

/**
 * Only returns a repository root when the script physically resides inside a
 * verified Antigravity Context Monitor source checkout. Returns `null` for
 * downloaded files (e.g. `/tmp/acm-install.mjs`) and stdin-piped invocations.
 */
export function detectCheckoutRepoRoot(metaUrl: string = getEntryMetaUrl()): string | null {
    const scriptFile = getScriptFilePath(metaUrl);
    if (!scriptFile) {
        return null;
    }
    const scriptDir = dirname(scriptFile);
    const parentCandidate = resolve(scriptDir, '..');
    if (isVerifiedRepoCheckout(parentCandidate)) {
        return parentCandidate;
    }
    if (isVerifiedRepoCheckout(scriptDir)) {
        return scriptDir;
    }
    return null;
}

// ─── Cross-Platform Path Helpers ─────────────────────────────────────────────

export function resolveUserHome(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    if (platform === 'win32') {
        if (env.USERPROFILE && env.USERPROFILE.trim()) { return env.USERPROFILE.trim(); }
        if (env.HOMEDRIVE && env.HOMEPATH) { return `${env.HOMEDRIVE}${env.HOMEPATH}`; }
    } else if (env.HOME && env.HOME.trim()) {
        return env.HOME.trim();
    }
    return homedir();
}

export function getDefaultTargetDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    return join(resolveUserHome(env, platform), '.gemini', 'config', 'plugins', PLUGIN_DIR_NAME);
}

export function getDefaultConfigPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    return join(resolveUserHome(env, platform), '.gemini', 'config', 'config.json');
}

export function getSidecarLogPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    return join(
        resolveUserHome(env, platform),
        '.gemini',
        'antigravity',
        'sidecar_data',
        PLUGIN_DIR_NAME,
        'context_monitor',
        'logs',
        'sidecar.log',
    );
}

export function getAntigravityUserDataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    const home = resolveUserHome(env, platform);
    if (platform === 'darwin') {
        return join(home, 'Library', 'Application Support', 'Antigravity');
    }
    if (platform === 'win32') {
        const appData = env.APPDATA && env.APPDATA.trim()
            ? env.APPDATA.trim()
            : join(home, 'AppData', 'Roaming');
        return join(appData, 'Antigravity');
    }
    return join(resolveLinuxXdgConfigHome(home, env), 'Antigravity');
}

export function getDevToolsActivePortPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
    if (env.AGY_BROWSER_ACTIVE_PORT_FILE && env.AGY_BROWSER_ACTIVE_PORT_FILE.trim()) {
        return env.AGY_BROWSER_ACTIVE_PORT_FILE.trim();
    }
    return join(getAntigravityUserDataDir(env, platform), 'DevToolsActivePort');
}

export function getIdeExtensionDirs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Array<{ editor: string; dir: string }> {
    const home = resolveUserHome(env, platform);
    return [
        { editor: 'Antigravity IDE', dir: join(home, '.antigravity-ide', 'extensions') },
        { editor: 'Antigravity', dir: join(home, '.antigravity', 'extensions') },
        { editor: 'VS Code', dir: join(home, '.vscode', 'extensions') },
    ];
}

// ─── Argument Parsing & Validation ───────────────────────────────────────────

export type InstallerAction =
    | 'install'
    | 'from-github'
    | 'upgrade'
    | 'status'
    | 'uninstall'
    | 'print-cdp-guide'
    | 'setup-cdp-launcher'
    | 'remove-cdp-launcher';

export interface ParsedInstallerArgs {
    action: InstallerAction;
    source: string | null;
    localDir: string | null;
    target: string | null;
    version: string | null;
    repo: string;
    useCli: boolean;
    checkRemote: boolean;
    json: boolean;
    dryRun: boolean;
    help: boolean;
    requireChecksum: boolean;
    noRemoteFallback: boolean;
}

export function normalizeVersionArg(raw: unknown): string {
    const cleaned = String(raw || '').trim().replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(cleaned)) {
        throw new Error(`Invalid --version value "${raw}". Expected semver like ${FALLBACK_APP_VERSION} or v${FALLBACK_APP_VERSION}.`);
    }
    return cleaned;
}

export function validateRepoSlug(raw: unknown): string {
    try {
        return coreValidateRepoSlug(String(raw ?? ''));
    } catch {
        throw new Error(`Invalid --repo value "${raw}". Expected owner/name.`);
    }
}

export function parseInstallerArgs(argv: readonly string[]): ParsedInstallerArgs {
    const opts: ParsedInstallerArgs = {
        action: 'install',
        source: null,
        localDir: null,
        target: null,
        version: null,
        repo: DEFAULT_GITHUB_REPO,
        useCli: false,
        checkRemote: false,
        json: false,
        dryRun: false,
        help: false,
        requireChecksum: true,
        noRemoteFallback: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--install') {
            opts.action = 'install';
        } else if (arg === '--from-github') {
            opts.action = 'from-github';
        } else if (arg === '--upgrade') {
            opts.action = 'upgrade';
        } else if (arg === '--status') {
            opts.action = 'status';
        } else if (arg === '--uninstall') {
            opts.action = 'uninstall';
        } else if (arg === '--print-cdp-guide') {
            opts.action = 'print-cdp-guide';
        } else if (arg === '--setup-cdp-launcher') {
            opts.action = 'setup-cdp-launcher';
        } else if (arg === '--remove-cdp-launcher') {
            opts.action = 'remove-cdp-launcher';
        } else if (arg === '--use-cli') {
            opts.useCli = true;
        } else if (arg === '--check-remote') {
            opts.checkRemote = true;
        } else if (arg === '--json') {
            opts.json = true;
        } else if (arg === '--dry-run') {
            opts.dryRun = true;
        } else if (arg === '--require-checksum') {
            opts.requireChecksum = true;
        } else if (arg === '--allow-missing-checksum') {
            opts.requireChecksum = false;
        } else if (arg === '--no-remote-fallback') {
            opts.noRemoteFallback = true;
        } else if (arg === '--help' || arg === '-h') {
            opts.help = true;
        } else if (arg === '--local-dir') {
            if (i + 1 >= argv.length) { throw new Error('Missing value for --local-dir.'); }
            opts.localDir = resolve(argv[++i]);
        } else if (arg.startsWith('--local-dir=')) {
            const val = arg.slice('--local-dir='.length).trim();
            if (!val) { throw new Error('Missing value for --local-dir.'); }
            opts.localDir = resolve(val);
        } else if (arg === '--source') {
            if (i + 1 >= argv.length) { throw new Error('Missing value for --source.'); }
            opts.source = resolve(argv[++i]);
        } else if (arg.startsWith('--source=')) {
            const val = arg.slice('--source='.length).trim();
            if (!val) { throw new Error('Missing value for --source.'); }
            opts.source = resolve(val);
        } else if (arg === '--target') {
            if (i + 1 >= argv.length) { throw new Error('Missing value for --target.'); }
            opts.target = resolve(argv[++i]);
        } else if (arg.startsWith('--target=')) {
            const val = arg.slice('--target='.length).trim();
            if (!val) { throw new Error('Missing value for --target.'); }
            opts.target = resolve(val);
        } else if (arg === '--version') {
            if (i + 1 >= argv.length) { throw new Error('Missing value for --version.'); }
            opts.version = normalizeVersionArg(argv[++i]);
        } else if (arg.startsWith('--version=')) {
            opts.version = normalizeVersionArg(arg.slice('--version='.length));
        } else if (arg === '--repo') {
            if (i + 1 >= argv.length) { throw new Error('Missing value for --repo.'); }
            opts.repo = validateRepoSlug(argv[++i]);
        } else if (arg.startsWith('--repo=')) {
            opts.repo = validateRepoSlug(arg.slice('--repo='.length));
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }
    return opts;
}

// ─── Semver & Security Core Wrappers ─────────────────────────────────────────

export function compareSemver(a: unknown, b: unknown): number {
    const sa = String(a || '');
    const sb = String(b || '');
    if (!parseSemver(sa) || !parseSemver(sb)) { return 0; }
    const diff = coreCompareSemver(sa, sb);
    return diff > 0 ? 1 : (diff < 0 ? -1 : 0);
}

export function assertAllowedDownloadUrl(rawUrl: unknown): URL {
    return validateReleaseUrl(String(rawUrl ?? ''));
}

export function assertApprovedReleaseAssetUrl(
    rawUrl: string,
    repoSlug: string,
    tagName: string,
    expectedAssetName: string,
    caseInsensitive = false,
): URL {
    return validateApprovedReleaseAssetUrl(rawUrl, {
        repoSlug,
        tagName,
        assetName: expectedAssetName,
        caseInsensitiveAssetName: caseInsensitive,
    });
}

export function verifyBufferSha256(buffer: Buffer, expectedHex: string, label = 'download'): string {
    const normalizedExpected = String(expectedHex || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalizedExpected)) {
        throw new Error(`Invalid expected SHA-256 checksum for ${label}: "${expectedHex}"`);
    }
    const actualHex = computeSha256Hex(buffer);
    if (!coreVerifyBufferSha256(buffer, normalizedExpected)) {
        throw new Error(
            `SHA-256 checksum mismatch for ${label}: expected ${normalizedExpected}, got ${actualHex}`,
        );
    }
    return actualHex;
}

export function assertSafeArchiveEntryPath(rawEntryName: string, destDir: string): {
    relPath: string;
    targetPath: string;
    isDir: boolean;
    isDirectory: boolean;
    segments: string[];
} {
    const res = coreAssertSafeArchiveEntryPath(rawEntryName, destDir);
    return {
        relPath: res.relPath,
        targetPath: res.targetPath,
        isDir: res.isDir,
        isDirectory: res.isDir,
        segments: res.relPath ? res.relPath.split('/') : [],
    };
}

export function extractZipBufferSafely(
    zipBuffer: Buffer | Uint8Array,
    destDir: string,
    options: { maxFiles?: number; maxBytes?: number } = {},
): { extractedFiles: number; totalBytes: number; pluginRoot: string | null } {
    const buf = Buffer.isBuffer(zipBuffer) ? zipBuffer : Buffer.from(zipBuffer);
    const extracted = extractZipSafe(buf, destDir, {
        maxEntries: options.maxFiles ?? MAX_ZIP_ENTRIES,
        maxTotalBytes: options.maxBytes ?? MAX_EXTRACTED_BYTES,
    });
    let pluginRoot: string | null = null;
    try {
        pluginRoot = resolveExtractedPluginRoot(destDir);
    } catch {
        pluginRoot = null;
    }
    return {
        extractedFiles: extracted.entries.length,
        totalBytes: extracted.totalBytes,
        pluginRoot,
    };
}

// ─── Strict HTTPS Proxy-Aware Fetcher (Wave 1A TLS Hardened) ─────────────────

export interface HttpsGetResponse {
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    buffer: Buffer;
}

export type HttpsRequestFn = (
    urlObj: URL,
    headers: Record<string, string>,
    timeoutMs: number,
    maxBytes: number,
) => Promise<HttpsGetResponse>;

export function resolveInstallerProxyUrl(targetUrl: URL, env: NodeJS.ProcessEnv = process.env): URL | null {
    const noProxy = env.NO_PROXY || env.no_proxy || '';
    const host = targetUrl.hostname.toLowerCase();
    const targetPort = targetUrl.port || '443';
    for (const raw of noProxy.split(',')) {
        const entry = raw.trim().toLowerCase();
        if (!entry) { continue; }
        if (entry === '*') { return null; }
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
        if (patternPort && patternPort !== targetPort) { continue; }
        if (patternHost.startsWith('.')) {
            if (host === patternHost.slice(1) || host.endsWith(patternHost)) { return null; }
        } else if (host === patternHost || host.endsWith(`.${patternHost}`)) {
            return null;
        }
    }
    for (const raw of [env.HTTPS_PROXY, env.https_proxy, env.ALL_PROXY, env.all_proxy]) {
        if (typeof raw !== 'string' || !raw.trim()) { continue; }
        const val = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw.trim()) ? raw.trim() : `http://${raw.trim()}`;
        try {
            const parsed = new URL(val);
            if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
                return parsed;
            }
        } catch {
            // ignore invalid proxy URL
        }
    }
    return null;
}

function openInstallerConnectTunnel(
    proxyUrl: URL,
    targetHost: string,
    targetPort: number,
    timeoutMs: number,
): Promise<net.Socket> {
    return new Promise((resolvePromise, rejectPromise) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const authority = `${targetHost}:${targetPort}`;
        const headers: Record<string, string> = { Host: authority };
        if (proxyUrl.username || proxyUrl.password) {
            const creds = `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`;
            headers['Proxy-Authorization'] = `Basic ${Buffer.from(creds, 'utf8').toString('base64')}`;
        }
        const isHttpsProxy = proxyUrl.protocol === 'https:';
        const requester = isHttpsProxy ? https.request : http.request;
        const req = requester({
            protocol: proxyUrl.protocol,
            hostname: proxyUrl.hostname,
            port: proxyUrl.port ? Number(proxyUrl.port) : (isHttpsProxy ? 443 : 80),
            method: 'CONNECT',
            path: authority,
            headers,
            agent: false,
        });
        const finish = (err: Error | null, sock?: net.Socket) => {
            if (settled) { return; }
            settled = true;
            if (timer) { clearTimeout(timer); timer = null; }
            if (err || !sock) {
                try { req.destroy(); } catch { /* ignore */ }
                rejectPromise(err || new Error('Proxy CONNECT failed without socket'));
            } else {
                resolvePromise(sock);
            }
        };
        timer = setTimeout(() => {
            finish(new Error(`Proxy CONNECT timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
        req.once('connect', (res, socket, head) => {
            if (res.statusCode !== 200) {
                socket.destroy();
                finish(new Error(`Proxy CONNECT failed (HTTP ${res.statusCode})`));
                return;
            }
            if (head && head.length > 0) { socket.unshift(head); }
            finish(null, socket);
        });
        req.once('response', (res) => {
            res.resume();
            finish(new Error(`Proxy CONNECT failed (HTTP ${res.statusCode})`));
        });
        req.once('error', (err) => finish(err));
        req.end();
    });
}

export function defaultHttpsGet(
    urlObj: URL,
    headers: Record<string, string>,
    timeoutMs: number,
    maxBytes: number,
    transportOpts: { env?: NodeJS.ProcessEnv; ca?: string | Buffer | Array<string | Buffer> } = {},
): Promise<HttpsGetResponse> {
    return new Promise((resolvePromise, rejectPromise) => {
        let settled = false;
        let tunnelAgent: https.Agent | null = null;
        let activeTunnelSocket: net.Socket | null = null;
        let activeReq: http.ClientRequest | null = null;
        let hardTimer: ReturnType<typeof setTimeout> | null = null;

        const finish = (err: Error | null, result?: HttpsGetResponse) => {
            if (settled) { return; }
            settled = true;
            if (hardTimer) { clearTimeout(hardTimer); hardTimer = null; }
            if (err || !result) {
                try { activeReq?.destroy(); } catch { /* ignore */ }
                try { activeTunnelSocket?.destroy(); } catch { /* ignore */ }
                try { tunnelAgent?.destroy(); } catch { /* ignore */ }
                rejectPromise(err || new Error('HTTPS request failed'));
            } else {
                try { tunnelAgent?.destroy(); } catch { /* ignore */ }
                resolvePromise(result);
            }
        };

        hardTimer = setTimeout(() => {
            finish(new Error(`HTTPS request timed out after ${timeoutMs}ms: ${urlObj.hostname}${urlObj.pathname}`));
        }, timeoutMs);
        hardTimer.unref?.();

        const targetPort = Number(urlObj.port || 443);
        const ca = transportOpts.ca;

        const runWithSocket = (tunnelSocket: net.Socket | null) => {
            if (settled) {
                tunnelSocket?.destroy();
                return;
            }
            let requestAgent: https.Agent | undefined;
            if (tunnelSocket) {
                const agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
                (agent as unknown as { createConnection: () => tls.TLSSocket }).createConnection = () => tls.connect({
                    socket: tunnelSocket,
                    servername: urlObj.hostname,
                    rejectUnauthorized: true,
                    ...(ca ? { ca } : {}),
                });
                tunnelAgent = agent;
                requestAgent = agent;
            }

            const req = https.request({
                protocol: urlObj.protocol,
                hostname: urlObj.hostname,
                port: targetPort,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers,
                rejectUnauthorized: true,
                ...(ca ? { ca } : {}),
                ...(requestAgent ? { agent: requestAgent } : {}),
            }, (res) => {
                const statusCode = res.statusCode || 0;
                if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
                    res.resume();
                    finish(null, {
                        statusCode,
                        headers: res.headers,
                        buffer: Buffer.alloc(0),
                    });
                    return;
                }
                const chunks: Buffer[] = [];
                let total = 0;
                res.on('data', (chunk) => {
                    if (settled) { return; }
                    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    total += buf.length;
                    if (total > maxBytes) {
                        req.destroy();
                        finish(new Error(`Response exceeded max allowed size (${maxBytes} bytes).`));
                        return;
                    }
                    chunks.push(buf);
                });
                res.on('end', () => {
                    finish(null, {
                        statusCode,
                        headers: res.headers,
                        buffer: Buffer.concat(chunks),
                    });
                });
                res.on('error', (err) => finish(err));
            });

            activeReq = req;
            req.setTimeout(timeoutMs, () => {
                req.destroy();
                finish(new Error(`HTTPS request timed out after ${timeoutMs}ms: ${urlObj.hostname}${urlObj.pathname}`));
            });
            req.on('error', (err) => finish(err));
            req.end();
        };

        const proxyUrl = resolveInstallerProxyUrl(urlObj, transportOpts.env || process.env);
        if (proxyUrl) {
            openInstallerConnectTunnel(proxyUrl, urlObj.hostname, targetPort, timeoutMs)
                .then((sock) => {
                    activeTunnelSocket = sock;
                    runWithSocket(sock);
                })
                .catch((err) => finish(err instanceof Error ? err : new Error(String(err))));
        } else {
            runWithSocket(null);
        }
    });
}

export async function fetchBufferWithAllowlist(
    rawUrl: string,
    options: {
        maxRedirects?: number;
        timeoutMs?: number;
        maxBytes?: number;
        requestFn?: HttpsRequestFn;
        headers?: Record<string, string>;
        env?: NodeJS.ProcessEnv;
        ca?: string | Buffer | Array<string | Buffer>;
    } = {},
): Promise<{ url: string; statusCode: number; headers: http.IncomingHttpHeaders; buffer: Buffer }> {
    const maxRedirects = Number.isInteger(options.maxRedirects) ? options.maxRedirects! : MAX_REDIRECT_HOPS;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs! : DEFAULT_HTTP_TIMEOUT_MS;
    const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes! : MAX_ARCHIVE_BYTES;
    const requestFn: HttpsRequestFn = options.requestFn || ((u, h, t, m) => defaultHttpsGet(u, h, t, m, {
        env: options.env,
        ca: options.ca,
    }));

    let currentUrl = assertAllowedDownloadUrl(rawUrl);
    for (let hop = 0; hop <= maxRedirects; hop++) {
        const isApi = currentUrl.hostname.toLowerCase() === 'api.github.com';
        const headers: Record<string, string> = {
            'User-Agent': USER_AGENT,
            Accept: isApi ? 'application/vnd.github+json' : 'application/octet-stream',
            ...(isApi ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}),
            ...(options.headers || {}),
        };

        const res = await requestFn(currentUrl, headers, timeoutMs, maxBytes);
        const statusCode = res.statusCode || 0;
        const location = res.headers?.location || (res.headers as Record<string, unknown>)?.Location;

        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
            if (hop >= maxRedirects) {
                throw new Error(`Exceeded maximum redirect hops (${maxRedirects}) for ${rawUrl}`);
            }
            const nextRaw = new URL(String(location), currentUrl).toString();
            currentUrl = assertAllowedDownloadUrl(nextRaw);
            continue;
        }

        if (statusCode < 200 || statusCode >= 300) {
            const snippet = res.buffer ? res.buffer.toString('utf8', 0, 200).trim() : '';
            throw new Error(`HTTP ${statusCode} fetching ${currentUrl.toString()}${snippet ? `: ${snippet}` : ''}`);
        }

        return {
            url: currentUrl.toString(),
            statusCode,
            headers: res.headers || {},
            buffer: Buffer.isBuffer(res.buffer) ? res.buffer : Buffer.from(res.buffer || ''),
        };
    }
    throw new Error(`Failed to fetch ${rawUrl}`);
}

// ─── Bundle Validation & Atomic Swap ─────────────────────────────────────────

export function readJsonNoBom(filePath: string): any {
    return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

export function validatePluginBundle(
    bundleDir: string,
    options: { requireSidecarEntrypoints?: boolean } = {},
): { manifest: Record<string, unknown>; version: string } {
    const manifestPath = join(bundleDir, 'plugin.json');
    if (!existsSync(manifestPath)) {
        throw new Error(`Invalid plugin bundle (missing plugin.json): ${bundleDir}`);
    }
    let manifest: any;
    try {
        manifest = readJsonNoBom(manifestPath);
    } catch (err) {
        throw new Error(`Invalid plugin.json JSON in ${bundleDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error(`Invalid plugin.json structure in ${bundleDir}.`);
    }
    if (manifest.name !== PLUGIN_DIR_NAME) {
        throw new Error(`Unexpected plugin name "${manifest.name}" (expected "${PLUGIN_DIR_NAME}").`);
    }
    const version = String(manifest.version || '').trim();
    if (!parseSemver(version)) {
        throw new Error(`Invalid plugin version "${manifest.version}" in ${manifestPath}.`);
    }

    if (options.requireSidecarEntrypoints) {
        const required = [
            join('sidecars', 'context_monitor', 'sidecar.json'),
            join('sidecars', 'context_monitor', 'main.mjs'),
            join('sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'),
        ];
        for (const rel of required) {
            if (!existsSync(join(bundleDir, rel))) {
                throw new Error(`Incomplete plugin bundle (missing ${rel.replace(/\\/g, '/')}): ${bundleDir}`);
            }
        }
    }

    return { manifest, version };
}

function copyDirectoryRealFiles(
    srcDir: string,
    dstDir: string,
    filterFn?: (srcPath: string, name: string, st: Stats) => boolean,
): void {
    mkdirSync(dstDir, { recursive: true });
    for (const name of readdirSync(srcDir)) {
        if (name === '.DS_Store' || name === 'Thumbs.db') { continue; }
        const srcPath = join(srcDir, name);
        const dstPath = join(dstDir, name);
        const st = lstatSync(srcPath);
        if (st.isSymbolicLink()) { throw new Error('Plugin bundle contains a symbolic link: ' + srcPath); }
        if (filterFn && !filterFn(srcPath, name, st)) { continue; }
        if (st.isDirectory()) {
            copyDirectoryRealFiles(srcPath, dstPath, filterFn);
        } else if (st.isFile()) {
            cpSync(srcPath, dstPath, { dereference: true });
            if (process.platform !== 'win32' && (st.mode & 0o111) !== 0) {
                try { chmodSync(dstPath, 0o755); } catch { /* ignore */ }
            }
        }
    }
}

const STAGING_TEMP_FILE_RE = /\.acm-(?:stage|restore)-[0-9a-z-]+$/i;

function isRetryableFsLockError(err: unknown): boolean {
    const code = err && typeof err === 'object' ? (err as NodeJS.ErrnoException).code : '';
    return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

function isStagingTempFilename(name: string): boolean {
    return STAGING_TEMP_FILE_RE.test(name);
}

function sleepSync(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // bounded short retry backoff for Windows file locks
    }
}

function renameWithRetry(
    fromPath: string,
    toPath: string,
    retries = 4,
    renameFn: (src: string, dest: string) => void = renameSync,
): void {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            renameFn(fromPath, toPath);
            return;
        } catch (err) {
            lastErr = err;
            if (!isRetryableFsLockError(err) || attempt === retries) {
                throw err;
            }
            sleepSync(40 * (attempt + 1));
        }
    }
    throw lastErr;
}

function rmSyncWithRetry(
    targetPath: string,
    options: { recursive?: boolean; force?: boolean } = { force: true },
    retries = 4,
    rmFn: (p: string, opts?: { recursive?: boolean; force?: boolean }) => void = rmSync,
): void {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            rmFn(targetPath, options);
            return;
        } catch (err) {
            lastErr = err;
            if (!isRetryableFsLockError(err) || attempt === retries) {
                throw err;
            }
            sleepSync(40 * (attempt + 1));
        }
    }
    throw lastErr;
}

function listRelativeFilesSync(rootDir: string, prefix = ''): string[] {
    const out: string[] = [];
    if (!existsSync(rootDir)) { return out; }
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const full = join(rootDir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listRelativeFilesSync(full, rel));
        } else if (entry.isFile() || entry.isSymbolicLink()) {
            out.push(rel);
        }
    }
    return out;
}

/**
 * Best-effort pruning of empty subdirectories inside `rootDir`.
 * NEVER throws on `EBUSY`/`EPERM`/`EACCES`/`ENOTEMPTY`/`ENOENT` so locked Windows
 * directories (such as a running sidecar's `sidecars/context_monitor` CWD) never
 * break CLI upgrades or rollbacks.
 */
function pruneEmptyDirsSync(
    rootDir: string,
    currentDir = rootDir,
    rmdirFn: (dirPath: string) => void = rmdirSync,
): void {
    if (!existsSync(currentDir)) { return; }
    let entries;
    try {
        entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry.isDirectory()) {
            pruneEmptyDirsSync(rootDir, join(currentDir, entry.name), rmdirFn);
        }
    }
    if (resolve(currentDir) !== resolve(rootDir)) {
        try {
            if (readdirSync(currentDir).length === 0) {
                rmdirFn(currentDir);
            }
        } catch {
            // Ignore locked Windows CWD / transient errors during best-effort prune
        }
    }
}

interface SyncTransactionalSwapState {
    stagedTempFiles: string[];
    swappedRelPaths: string[];
    movedObsoleteRelPaths: string[];
    obsoleteDir: string;
}

/**
 * Synchronous Windows locked-directory fallback for `installPluginAtomic`:
 * stages every new file to a sibling temp file BEFORE mutating any live file,
 * atomically renames each staged file into place, moves obsolete files into
 * `obsoleteDir` (reversible on rollback), and safely skips locked directories
 * during empty-dir pruning.
 */
const IS_CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin';
const normRelPath = (rel: string): string => (IS_CASE_INSENSITIVE_FS ? rel.toLowerCase() : rel);

function swapDirectoryContentsTransactionallySync(
    stagedRoot: string,
    targetDir: string,
    obsoleteDir: string,
    stamp: string,
    renameFileFn: (src: string, dest: string) => void,
    rmdirDirFn: (dirPath: string) => void,
    swapState: SyncTransactionalSwapState,
): void {
    const newFiles = listRelativeFilesSync(stagedRoot);
    const existingFiles = listRelativeFilesSync(targetDir);
    const newFileSet = new Set(newFiles.map(normRelPath));
    const obsoleteFiles = existingFiles.filter((rel) => !newFileSet.has(normRelPath(rel)));
    const movedObsoleteSet = new Set<string>(swapState.movedObsoleteRelPaths.map(normRelPath));

    const moveObsoleteToTrash = (rel: string): void => {
        const key = normRelPath(rel);
        if (movedObsoleteSet.has(key)) { return; }
        const livePath = join(targetDir, ...rel.split('/'));
        if (!existsSync(livePath)) { return; }
        const trashPath = join(obsoleteDir, ...rel.split('/'));
        mkdirSync(dirname(trashPath), { recursive: true });
        renameWithRetry(livePath, trashPath, 4, renameFileFn);
        movedObsoleteSet.add(key);
        swapState.movedObsoleteRelPaths.push(rel);
    };

    // Pre-phase: resolve file-vs-directory type collisions cleanly
    for (const rel of newFiles) {
        const parts = rel.split('/');
        for (let depth = 1; depth < parts.length; depth++) {
            const ancestorRel = parts.slice(0, depth).join('/');
            const ancestorPath = join(targetDir, ...parts.slice(0, depth));
            const st = lstatSync(ancestorPath, { throwIfNoEntry: false });
            if (st && !st.isDirectory()) {
                moveObsoleteToTrash(ancestorRel);
            }
        }
        const destPath = join(targetDir, ...parts);
        const destStat = lstatSync(destPath, { throwIfNoEntry: false });
        if (destStat && destStat.isDirectory()) {
            for (const nestedRel of listRelativeFilesSync(destPath, rel)) {
                moveObsoleteToTrash(nestedRel);
            }
            pruneEmptyDirsSync(destPath, destPath, rmdirDirFn);
            rmdirDirFn(destPath);
        }
    }

    // Phase 1: Stage every new payload into sibling temp files without touching live files
    const stagedPairs: Array<{ rel: string; stagedPath: string; destPath: string }> = [];
    for (const rel of newFiles) {
        const srcPath = join(stagedRoot, ...rel.split('/'));
        const destPath = join(targetDir, ...rel.split('/'));
        const stagedPath = `${destPath}.acm-stage-${stamp}`;
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(srcPath, stagedPath);
        const srcStat = lstatSync(srcPath, { throwIfNoEntry: false });
        if (process.platform !== 'win32' && srcStat && (srcStat.mode & 0o111) !== 0) {
            try { chmodSync(stagedPath, 0o755); } catch { /* ignore */ }
        }
        swapState.stagedTempFiles.push(stagedPath);
        stagedPairs.push({ rel, stagedPath, destPath });
    }

    // Phase 2: Atomically rename each staged file into its final destination
    for (const pair of stagedPairs) {
        renameWithRetry(pair.stagedPath, pair.destPath, 4, renameFileFn);
        swapState.swappedRelPaths.push(pair.rel);
    }

    // Phase 3: Move obsolete files into `obsoleteDir`
    if (obsoleteFiles.length > 0) {
        mkdirSync(obsoleteDir, { recursive: true });
        for (const rel of obsoleteFiles) {
            moveObsoleteToTrash(rel);
        }
    }

    // Phase 4: Best-effort prune empty dirs (never fails on locked sidecars/context_monitor CWD)
    pruneEmptyDirsSync(targetDir, targetDir, rmdirDirFn);
}

function rollbackTransactionalSwapSync(
    targetDir: string,
    backupDir: string,
    stamp: string,
    swapState: SyncTransactionalSwapState,
    rollbackRenameFileFn: (src: string, dest: string) => void = renameSync,
    rmdirDirFn: (dirPath: string) => void = rmdirSync,
    rmPathFn: (p: string, opts?: { recursive?: boolean; force?: boolean }) => void = rmSync,
): { ok: boolean; failedFiles: string[]; error?: string } {
    const failedFiles: string[] = [];
    const errors: string[] = [];

    // 1. Clean up unswapped temp stage files first
    for (const stagedPath of swapState.stagedTempFiles) {
        if (existsSync(stagedPath)) {
            try { rmSyncWithRetry(stagedPath, { force: true }, 4, rmPathFn); } catch { /* ignore */ }
        }
    }

    // 2. Restore swapped files from backupDir (or remove newly introduced files)
    const backupFileMap = new Map<string, string>();
    for (const bRel of listRelativeFilesSync(backupDir)) {
        backupFileMap.set(normRelPath(bRel), bRel);
    }
    for (const rel of swapState.swappedRelPaths) {
        const livePath = join(targetDir, ...rel.split('/'));
        const matchedBackupRel = backupFileMap.get(normRelPath(rel));
        try {
            if (matchedBackupRel !== undefined) {
                const backupFile = join(backupDir, ...matchedBackupRel.split('/'));
                const restoreTmp = `${livePath}.acm-restore-${stamp}`;
                mkdirSync(dirname(livePath), { recursive: true });
                copyFileSync(backupFile, restoreTmp);
                try {
                    renameWithRetry(restoreTmp, livePath, 4, rollbackRenameFileFn);
                } catch (renameErr) {
                    try { rmSyncWithRetry(restoreTmp, { force: true }, 4, rmPathFn); } catch { /* ignore */ }
                    throw renameErr;
                }
            } else if (existsSync(livePath)) {
                rmSyncWithRetry(livePath, { force: true }, 4, rmPathFn);
            }
        } catch (err) {
            failedFiles.push(rel);
            errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    pruneEmptyDirsSync(targetDir, targetDir, rmdirDirFn);

    // 3. Restore moved obsolete files
    for (const rel of swapState.movedObsoleteRelPaths) {
        const trashPath = join(swapState.obsoleteDir, ...rel.split('/'));
        const livePath = join(targetDir, ...rel.split('/'));
        if (!existsSync(trashPath)) {
            failedFiles.push(rel);
            errors.push(`${rel}: missing obsolete trash file`);
            continue;
        }
        try {
            mkdirSync(dirname(livePath), { recursive: true });
            renameWithRetry(trashPath, livePath, 4, rollbackRenameFileFn);
        } catch (err) {
            failedFiles.push(rel);
            errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    pruneEmptyDirsSync(targetDir, targetDir, rmdirDirFn);

    if (failedFiles.length === 0) {
        if (existsSync(join(backupDir, 'plugin.json'))) {
            try {
                validateExtractedPluginBundle(targetDir);
            } catch (err) {
                return {
                    ok: false,
                    failedFiles: ['<bundle-validation>'],
                    error: `Rollback validation failed (backup preserved): ${err instanceof Error ? err.message : String(err)}`,
                };
            }
        }
        try { rmSyncWithRetry(swapState.obsoleteDir, { recursive: true, force: true }, 4, rmPathFn); } catch { /* ignore */ }
        try { rmSyncWithRetry(backupDir, { recursive: true, force: true }, 4, rmPathFn); } catch { /* ignore */ }
        return { ok: true, failedFiles: [] };
    }

    return {
        ok: false,
        failedFiles,
        error: `Rollback failed for ${failedFiles.join(', ')} (${errors.join('; ')})`,
    };
}

function acquireExclusiveLockSync(
    lockPath: string,
    options: { owner?: string; timeoutMs?: number; staleMs?: number; pollIntervalMs?: number } = {},
): { lockPath: string; nonce: string; release: () => void } {
    const owner = options.owner || 'cli-installer';
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs! : 10_000;
    const staleMs = Number.isFinite(options.staleMs) ? options.staleMs! : 5 * 60 * 1000;
    const pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? Math.max(5, options.pollIntervalMs!) : 25;
    mkdirSync(dirname(lockPath), { recursive: true });
    const deadline = Date.now() + Math.max(0, timeoutMs);
    const nonce = randomBytes(12).toString('hex');

    while (true) {
        const nowMs = Date.now();
        const payload = JSON.stringify({ pid: process.pid, owner, nonce, acquiredAt: nowMs });
        if (publishExclusiveFileSync(lockPath, payload, nonce)) {
            let released = false;
            return {
                lockPath,
                nonce,
                release: () => {
                    if (released) { return; }
                    released = true;
                    try {
                        const current = readFileSync(lockPath, 'utf8');
                        if (JSON.parse(current)?.nonce === nonce) {
                            unlinkSync(lockPath);
                        }
                    } catch {
                        // Lock already removed
                    }
                },
            };
        }
        if (tryReclaimStaleUpdateLock(lockPath, nowMs, staleMs)) {
            continue;
        }
        if (Date.now() >= deadline) {
            let holderInfo = '';
            try {
                const holder = JSON.parse(readFileSync(lockPath, 'utf8')) as { owner?: string; pid?: number };
                if (holder.owner || holder.pid) {
                    holderInfo = ` (held by ${holder.owner || 'unknown'} pid=${holder.pid || '?'})`;
                }
            } catch { /* ignore */ }
            throw new Error(`Lock contention on ${lockPath}${holderInfo}`);
        }
        sleepSync(pollIntervalMs);
    }
}

export function installPluginAtomic(
    sourceDir: string,
    targetDir: string,
    options: {
        skipLock?: boolean;
        lockTimeoutMs?: number;
        lockStaleMs?: number;
        needsRuntimeCopy?: boolean;
        distStageAppDir?: string;
        outSrc?: string;
        imagesSrc?: string;
        version?: string;
        onBeforeSwap?: (ctx: { stagingDir: string; targetDir: string; backupDir: string }) => void;
        renameDir?: (src: string, dest: string) => void;
        renameFile?: (src: string, dest: string) => void;
        rollbackRenameDir?: (src: string, dest: string) => void;
        rollbackRenameFile?: (src: string, dest: string) => void;
        rmdirDir?: (dirPath: string) => void;
        rmPath?: (targetPath: string, opts?: { recursive?: boolean; force?: boolean }) => void;
    } = {},
): { previousVersion: string | null; replaced: boolean } {
    const parentDir = dirname(targetDir);
    mkdirSync(parentDir, { recursive: true });

    const lockHandle = options.skipLock
        ? null
        : acquireExclusiveLockSync(getPluginUpdateLockPath(targetDir), {
            owner: 'cli-installer',
            timeoutMs: options.lockTimeoutMs,
            staleMs: options.lockStaleMs,
        });

    const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const stagingDir = join(parentDir, `.${basename(targetDir)}.staging-${stamp}`);
    const backupDir = join(parentDir, `.${basename(targetDir)}.bak-${stamp}`);
    const obsoleteDir = join(parentDir, `.${basename(targetDir)}.obsolete-${stamp}`);
    const renameDirFn = options.renameDir ?? renameSync;
    const renameFileFn = options.renameFile ?? renameSync;
    const rollbackRenameDirFn = options.rollbackRenameDir ?? renameSync;
    const rollbackRenameFileFn = options.rollbackRenameFile ?? renameSync;
    const rmdirDirFn = options.rmdirDir ?? rmdirSync;
    const rmPathFn = options.rmPath ?? rmSync;

    let previousVersion: string | null = null;
    let movedExistingToBackup = false;
    let copiedExistingToBackup = false;
    let swappedStagingToTarget = false;
    const swapState: SyncTransactionalSwapState = {
        stagedTempFiles: [],
        swappedRelPaths: [],
        movedObsoleteRelPaths: [],
        obsoleteDir,
    };
    try {
        assertPluginTarget(targetDir, true);
        if (existsSync(join(targetDir, 'plugin.json'))) {
            try {
                previousVersion = String(readJsonNoBom(join(targetDir, 'plugin.json')).version || '').trim() || null;
            } catch {
                previousVersion = null;
            }
        }

        copyDirectoryRealFiles(sourceDir, stagingDir);

        if (options.needsRuntimeCopy) {
            const runtimeDir = join(stagingDir, 'sidecars', 'context_monitor', 'runtime');
            const distStageAppDir = options.distStageAppDir;
            const useBundledStage = Boolean(
                distStageAppDir
                && existsSync(join(distStageAppDir, 'sidecar-bundle.js'))
                && existsSync(join(distStageAppDir, 'sidecar-server.js'))
                && existsSync(join(distStageAppDir, 'sidecar-runtime.js')),
            );
            let buildId: string | undefined;
            if (useBundledStage && distStageAppDir) {
                const dstAppDir = join(runtimeDir, 'out', 'app');
                mkdirSync(dstAppDir, { recursive: true });
                for (const fileName of ['sidecar-bundle.js', 'sidecar-server.js', 'sidecar-runtime.js']) {
                    cpSync(join(distStageAppDir, fileName), join(dstAppDir, fileName));
                }
                const stageManifestPath = join(distStageAppDir, 'manifest.json');
                if (existsSync(stageManifestPath)) {
                    try {
                        const m = readJsonNoBom(stageManifestPath);
                        if (typeof m.buildId === 'string' && m.buildId.trim()) {
                            buildId = m.buildId.trim();
                        }
                    } catch { /* ignore */ }
                }
            } else if (options.outSrc) {
                copyDirectoryRealFiles(
                    options.outSrc,
                    join(runtimeDir, 'out'),
                    (_p, name, st) => st.isDirectory() || (name.endsWith('.js') && !name.endsWith('.map')),
                );
            }
            const runtimePkg: Record<string, unknown> = {
                name: 'antigravity-context-monitor-app-runtime',
                version: options.version,
                ...(buildId ? { buildId } : {}),
                bundled: useBundledStage,
                private: true,
                license: 'MIT',
            };
            writeFileSync(join(runtimeDir, 'package.json'), JSON.stringify(runtimePkg, null, 2) + '\n', 'utf8');
        }

        if (existsSync(targetDir)) {
            try {
                renameWithRetry(targetDir, backupDir, 4, renameDirFn);
                movedExistingToBackup = true;
            } catch (backupErr) {
                if (!isRetryableFsLockError(backupErr)) {
                    throw backupErr;
                }
                // Windows locked-dir fallback (running sidecar holds `sidecars/context_monitor` as CWD):
                // snapshot to backupDir, then perform per-file transactional staging + atomic rename
                // without ever requiring `rename` or `rmdir` on the locked directory.
                copyDirectoryRealFiles(targetDir, backupDir, (_p, name) => !isStagingTempFilename(name));
                copiedExistingToBackup = true;
            }
        }

        if (typeof options.onBeforeSwap === 'function') {
            options.onBeforeSwap({ stagingDir, targetDir, backupDir });
        }

        if (copiedExistingToBackup) {
            swapDirectoryContentsTransactionallySync(
                stagingDir,
                targetDir,
                obsoleteDir,
                stamp,
                renameFileFn,
                rmdirDirFn,
                swapState,
            );
        } else {
            renameWithRetry(stagingDir, targetDir, 4, renameDirFn);
            swappedStagingToTarget = true;
        }

        // Verify required runtime entries & manifest parity BEFORE deleting backupDir/obsoleteDir.
        validateExtractedPluginBundle(targetDir, {
            ...(options.version ? { expectedVersion: options.version } : {}),
        });

        const replaced = movedExistingToBackup || copiedExistingToBackup;
        if (replaced) {
            try { rmSyncWithRetry(backupDir, { recursive: true, force: true }, 4, rmPathFn); } catch { /* ignore */ }
            try { rmSyncWithRetry(obsoleteDir, { recursive: true, force: true }, 4, rmPathFn); } catch { /* ignore */ }
        }
        try { rmSyncWithRetry(stagingDir, { recursive: true, force: true }, 4, rmPathFn); } catch { /* ignore */ }

        return { previousVersion, replaced };
    } catch (err) {
        try { rmSyncWithRetry(stagingDir, { recursive: true, force: true }, 4, rmPathFn); } catch { /* ignore */ }
        if (movedExistingToBackup) {
            try {
                let targetRemoved = true;
                if (existsSync(targetDir)) {
                    if (!swappedStagingToTarget) {
                        throw new Error('target is already occupied');
                    }
                    try {
                        rmSyncWithRetry(targetDir, { recursive: true, force: true }, 4, rmPathFn);
                    } catch (rmErr) {
                        if (!isRetryableFsLockError(rmErr)) { throw rmErr; }
                        targetRemoved = false;
                    }
                }
                if (targetRemoved) {
                    renameWithRetry(backupDir, targetDir, 4, rollbackRenameDirFn);
                } else {
                    const rbObs = `${targetDir}.rb-obsolete-${stamp}`;
                    const rbState: SyncTransactionalSwapState = {
                        stagedTempFiles: [],
                        swappedRelPaths: [],
                        movedObsoleteRelPaths: [],
                        obsoleteDir: rbObs,
                    };
                    swapDirectoryContentsTransactionallySync(backupDir, targetDir, rbObs, `rb-${stamp}`, rollbackRenameFileFn, rmdirDirFn, rbState);
                    if (existsSync(join(backupDir, 'plugin.json'))) {
                        validateExtractedPluginBundle(targetDir);
                    }
                    try { rmSyncWithRetry(rbObs, { recursive: true, force: true }, 4, rmPathFn); } catch { /* ignore */ }
                    try { rmSyncWithRetry(backupDir, { recursive: true, force: true }, 4, rmPathFn); } catch { /* ignore */ }
                }
            } catch (rollbackErr) {
                throw new Error(`Plugin swap failed and rollback failed. Target ${targetDir} is ${existsSync(targetDir) ? 'present' : 'missing'}. Backup ${backupDir} is ${existsSync(backupDir) ? 'present' : 'missing'}. ${String(rollbackErr)}`, { cause: err });
            }
        } else if (copiedExistingToBackup && existsSync(backupDir)) {
            const rb = rollbackTransactionalSwapSync(
                targetDir,
                backupDir,
                stamp,
                swapState,
                rollbackRenameFileFn,
                rmdirDirFn,
                rmPathFn,
            );
            if (!rb.ok) {
                throw new Error(`Plugin swap failed and rollback failed. Target ${targetDir} is ${existsSync(targetDir) ? 'present' : 'missing'}. Backup ${backupDir} is ${existsSync(backupDir) ? 'present' : 'missing'}. ${rb.error ?? ''}`, { cause: err });
            }
        } else {
            // Pre-mutation failure: clean up any partial backup/obsolete artifacts
            try { rmSyncWithRetry(backupDir, { recursive: true, force: true }, 4, rmPathFn); } catch { /* ignore */ }
            try { rmSyncWithRetry(obsoleteDir, { recursive: true, force: true }, 4, rmPathFn); } catch { /* ignore */ }
        }
        throw err;
    } finally {
        lockHandle?.release();
    }
}

// ─── `agy` CLI Integration & Safe Registration (Locked + Atomic CAS) ─────────

export function findAgyBinary(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
    const ext = platform === 'win32' ? '.exe' : '';
    const home = resolveUserHome(env, platform);
    const candidates = [
        'agy',
        join(home, '.gemini', 'bin', `agy${ext}`),
        join(home, '.local', 'bin', `agy${ext}`),
    ];
    for (const bin of candidates) {
        if (bin !== 'agy' && !existsSync(bin)) { continue; }
        try {
            execFileSync(bin, ['--version'], { env, stdio: 'ignore', windowsHide: true, timeout: 5_000 });
            return bin;
        } catch {
            // Try next
        }
    }
    return null;
}

function isPlainObject(val: unknown): val is Record<string, any> {
    return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

export function ensurePluginEnabled(options: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    configPath?: string;
    allowCli?: boolean;
    agyBinary?: string | null;
    lockTimeoutMs?: number;
    lockStaleMs?: number;
    maxCasAttempts?: number;
    onBeforeCommit?: (ctx: { attempt: number; configPath: string; beforeSha: string; tmpPath: string }) => void;
} = {}): {
    updated: boolean;
    enabled: boolean | null;
    method: string;
    configPath: string;
    casAttempts?: number;
    error?: string;
} {
    const env = options.env || process.env;
    const platform = options.platform || process.platform;
    const configPath = options.configPath || getDefaultConfigPath(env, platform);
    const allowCli = options.allowCli !== false && !options.configPath;

    if (allowCli) {
        const agyBin = options.agyBinary !== undefined ? options.agyBinary : findAgyBinary(env, platform);
        if (agyBin) {
            try {
                execFileSync(agyBin, ['plugin', 'enable', PLUGIN_DIR_NAME], {
                    env,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true,
                });
                return { updated: true, enabled: true, method: 'agy-cli', configPath };
            } catch {
                // Fall through to safe JSON merge
            }
        }
    }

    if (!existsSync(configPath)) {
        return { updated: false, enabled: true, method: 'default-enabled', configPath };
    }

    const configLockPath = `${configPath}.acm.lock`;
    let lockHandle: { release: () => void };
    try {
        lockHandle = acquireExclusiveLockSync(configLockPath, {
            owner: 'config-merge',
            timeoutMs: Number.isFinite(options.lockTimeoutMs) ? options.lockTimeoutMs : 5_000,
            staleMs: Number.isFinite(options.lockStaleMs) ? options.lockStaleMs : 30_000,
        });
    } catch (lockErr) {
        return {
            updated: false,
            enabled: null,
            method: 'skipped-concurrent-lock',
            configPath,
            error: lockErr instanceof Error ? lockErr.message : String(lockErr),
        };
    }

    const maxCasAttempts = Number.isInteger(options.maxCasAttempts) && options.maxCasAttempts! > 0
        ? options.maxCasAttempts!
        : 5;

    try {
        for (let attempt = 1; attempt <= maxCasAttempts; attempt++) {
            if (!existsSync(configPath)) {
                return { updated: false, enabled: true, method: 'default-enabled', configPath };
            }

            let beforeRaw: Buffer;
            let parsed: unknown;
            try {
                beforeRaw = readFileSync(configPath);
                parsed = JSON.parse(beforeRaw.toString('utf8').replace(/^\uFEFF/, ''));
            } catch {
                return { updated: false, enabled: null, method: 'skipped-invalid-config', configPath };
            }
            if (!isPlainObject(parsed)) {
                return { updated: false, enabled: null, method: 'skipped-invalid-config', configPath };
            }

            if (parsed.plugins !== undefined && !isPlainObject(parsed.plugins)) {
                return { updated: false, enabled: null, method: 'skipped-invalid-config', configPath };
            }
            const existingPlugins = parsed.plugins ?? {};
            if (existingPlugins[PLUGIN_DIR_NAME] !== undefined && !isPlainObject(existingPlugins[PLUGIN_DIR_NAME])) {
                return { updated: false, enabled: null, method: 'skipped-invalid-config', configPath };
            }
            const existingEntry = isPlainObject(existingPlugins[PLUGIN_DIR_NAME]) ? existingPlugins[PLUGIN_DIR_NAME] : {};
            if (existingEntry.enabled === true) {
                return { updated: false, enabled: true, method: 'already-enabled', configPath };
            }

            const beforeSha = computeSha256Hex(beforeRaw);
            const nextConfig = {
                ...parsed,
                plugins: {
                    ...existingPlugins,
                    [PLUGIN_DIR_NAME]: {
                        ...existingEntry,
                        enabled: true,
                    },
                },
            };

            const tmpNonce = randomBytes(6).toString('hex');
            const tmpPath = `${configPath}.tmp-${process.pid}-${Date.now()}-${tmpNonce}`;
            const serialized = JSON.stringify(nextConfig, null, 2) + '\n';
            const expectedAfterSha = computeSha256Hex(Buffer.from(serialized, 'utf8'));

            try {
                const fd = openSync(tmpPath, 'wx', 0o600);
                try {
                    writeFileSync(fd, serialized, 'utf8');
                    try { fsyncSync(fd); } catch { /* best-effort */ }
                } finally {
                    closeSync(fd);
                }
                if (platform !== 'win32') {
                    try { chmodSync(tmpPath, 0o600); } catch { /* ignore */ }
                }

                if (typeof options.onBeforeCommit === 'function') {
                    options.onBeforeCommit({ attempt, configPath, beforeSha, tmpPath });
                }

                if (!existsSync(configPath)) {
                    rmSync(tmpPath, { force: true });
                    continue;
                }
                const currentSha = computeSha256Hex(readFileSync(configPath));
                if (currentSha !== beforeSha) {
                    rmSync(tmpPath, { force: true });
                    sleepSync(15 * attempt);
                    continue;
                }

                renameWithRetry(tmpPath, configPath);

                const committedRaw = readFileSync(configPath);
                const committedSha = computeSha256Hex(committedRaw);
                if (committedSha === expectedAfterSha) {
                    return { updated: true, enabled: true, method: 'config-atomic-merge', configPath, casAttempts: attempt };
                }
                try {
                    const committedParsed = JSON.parse(committedRaw.toString('utf8').replace(/^\uFEFF/, ''));
                    if (isPlainObject(committedParsed) && committedParsed.plugins?.[PLUGIN_DIR_NAME]?.enabled === true) {
                        return { updated: true, enabled: true, method: 'config-atomic-merge', configPath, casAttempts: attempt };
                    }
                } catch {
                    // External writer raced mid-write; retry CAS loop cleanly
                }
                sleepSync(15 * attempt);
            } catch (err) {
                try { rmSync(tmpPath, { force: true }); } catch { /* ignore */ }
                throw err;
            }
        }

        return {
            updated: false,
            enabled: null,
            method: 'skipped-concurrent-conflict',
            configPath,
            error: `config.json was modified concurrently across ${maxCasAttempts} CAS attempts; refused to overwrite unrelated settings.`,
        };
    } finally {
        lockHandle.release();
    }
}

function installViaAgyCli(
    stagedDir: string,
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform,
    agyBinOverride?: string | null,
): { agyBin: string; output: string } {
    const agyBin = agyBinOverride || findAgyBinary(env, platform);
    if (!agyBin) {
        throw new Error('`--use-cli` requested, but `agy` CLI was not found on PATH or ~/.gemini/bin.');
    }
    const output = execFileSync(agyBin, ['plugin', 'install', stagedDir], {
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    return { agyBin, output: output.trim() };
}

// ─── GitHub Releases Fetch & Install ─────────────────────────────────────────

export async function fetchGitHubReleaseInfo(options: {
    repo?: string;
    version?: string | null;
    requestFn?: HttpsRequestFn;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    ca?: string | Buffer | Array<string | Buffer>;
} = {}): Promise<{
    repo: string;
    tagName: string;
    version: string;
    releaseUrl: string;
    publishedAt: string | null;
    zipAsset: { name: string; url: string; size?: number } | null;
    checksumAsset: { name: string; url: string } | null;
    vsixAsset: { name: string; url: string; size?: number } | null;
}> {
    const repo = validateRepoSlug(options.repo || DEFAULT_GITHUB_REPO);
    const requestedVersion = options.version ? normalizeVersionArg(options.version) : null;
    const apiUrls = requestedVersion
        ? [
            `https://api.github.com/repos/${repo}/releases/tags/v${requestedVersion}`,
            `https://api.github.com/repos/${repo}/releases/tags/${requestedVersion}`,
        ]
        : [`https://api.github.com/repos/${repo}/releases/latest`];

    let release: any = null;
    let lastError: unknown = null;
    for (const apiUrl of apiUrls) {
        try {
            const res = await fetchBufferWithAllowlist(apiUrl, {
                requestFn: options.requestFn,
                timeoutMs: options.timeoutMs,
                env: options.env,
                ca: options.ca,
            });
            release = JSON.parse(res.buffer.toString('utf8'));
            break;
        } catch (err) {
            lastError = err;
        }
    }
    if (!release) {
        throw lastError || new Error(`Could not fetch GitHub release metadata for ${repo}.`);
    }

    const tagName = String(release.tag_name || '').trim();
    const version = tagName.replace(/^v/i, '') || requestedVersion || '';
    const assets: any[] = Array.isArray(release.assets) ? release.assets : [];

    const exactZipName = version ? `${PLUGIN_DIR_NAME}-app-${version}.zip` : null;
    const zipAsset =
        (exactZipName && assets.find((a) => a && a.name === exactZipName)) ||
        assets.find((a) => a && typeof a.name === 'string' && /^antigravity-context-monitor-app-.+\.zip$/i.test(a.name)) ||
        null;

    const checksumAsset =
        assets.find((a) => a && typeof a.name === 'string' && /^sha256sums\.txt$/i.test(a.name)) ||
        null;

    const vsixAsset =
        assets.find((a) => a && typeof a.name === 'string' && /^antigravity-context-monitor-.+\.vsix$/i.test(a.name)) ||
        null;

    return {
        repo,
        tagName,
        version,
        releaseUrl: release.html_url || `https://github.com/${repo}/releases`,
        publishedAt: release.published_at || null,
        zipAsset: zipAsset ? { name: zipAsset.name, url: zipAsset.browser_download_url, size: zipAsset.size } : null,
        checksumAsset: checksumAsset ? { name: checksumAsset.name, url: checksumAsset.browser_download_url } : null,
        vsixAsset: vsixAsset ? { name: vsixAsset.name, url: vsixAsset.browser_download_url, size: vsixAsset.size } : null,
    };
}

export async function installFromGitHub(options: Record<string, any> = {}): Promise<Record<string, any>> {
    const env: NodeJS.ProcessEnv = options.env || process.env;
    const platform: NodeJS.Platform = options.platform || process.platform;
    const defaultTarget = getDefaultTargetDir(env, platform);
    const targetDir: string = options.target || defaultTarget;
    const isDefaultTarget = resolve(targetDir) === resolve(defaultTarget);
    const dryRun = Boolean(options.dryRun);

    const release = await fetchGitHubReleaseInfo({
        repo: options.repo,
        version: options.version,
        requestFn: options.requestFn,
        timeoutMs: options.timeoutMs,
        env,
        ca: options.ca,
    });

    const expectedReleaseVersion = String(options.version || release.version || release.tagName || '').trim();
    const parsedExpected = parseSemver(expectedReleaseVersion);
    if (!parsedExpected) {
        throw new Error(`Unable to determine valid expected release version from GitHub release metadata ("${expectedReleaseVersion}").`);
    }
    const expectedExactZipName = `${PLUGIN_DIR_NAME}-app-${parsedExpected.normalized}.zip`;
    if (!release.zipAsset || !release.zipAsset.url) {
        throw new Error(
            `Release ${release.tagName || release.version || 'latest'} does not contain an ${expectedExactZipName} asset.`,
        );
    }
    if (release.zipAsset.name !== expectedExactZipName) {
        throw new Error(
            `Release asset name "${release.zipAsset.name}" does not match expected "${expectedExactZipName}" for v${parsedExpected.normalized}.`,
        );
    }
    const effectiveTag = release.tagName || `v${parsedExpected.normalized}`;
    assertReleaseVersionMatches(parsedExpected.normalized, effectiveTag);
    assertApprovedReleaseAssetUrl(release.zipAsset.url, release.repo, effectiveTag, expectedExactZipName, false);
    if (release.checksumAsset?.url) {
        assertApprovedReleaseAssetUrl(release.checksumAsset.url, release.repo, effectiveTag, 'SHA256SUMS.txt', true);
    }

    if (dryRun) {
        return {
            action: options.action || 'from-github',
            sourceMode: 'github',
            repo: release.repo,
            version: release.version,
            targetDir,
            zipAsset: release.zipAsset.name,
            zipUrl: release.zipAsset.url,
            checksumAsset: release.checksumAsset?.name || null,
            dryRun: true,
        };
    }

    const zipRes = await fetchBufferWithAllowlist(release.zipAsset.url, {
        requestFn: options.requestFn,
        timeoutMs: options.timeoutMs,
        env,
        ca: options.ca,
    });
    const actualSha256 = computeSha256Hex(zipRes.buffer);

    const requireChecksum = options.requireChecksum !== false;
    let checksumVerified = false;
    let checksumStatus = 'not-published';
    if (release.checksumAsset?.url) {
        const sumRes = await fetchBufferWithAllowlist(release.checksumAsset.url, {
            requestFn: options.requestFn,
            timeoutMs: options.timeoutMs,
            env,
            ca: options.ca,
        });
        const sums = parseSha256Sums(sumRes.buffer.toString('utf8'));
        const normalizedAsset = release.zipAsset.name.trim().replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
        const expected = sums.get(normalizedAsset) || sums.get(basename(normalizedAsset));
        if (expected) {
            verifyBufferSha256(zipRes.buffer, expected, release.zipAsset.name);
            checksumVerified = true;
            checksumStatus = 'verified';
        } else {
            throw new Error(`SHA256SUMS.txt did not contain an entry for ${release.zipAsset.name}.`);
        }
    } else if (requireChecksum) {
        throw new Error(
            `Release ${release.tagName || release.version || 'latest'} did not publish SHA256SUMS.txt ` +
            '(fail-closed by default; pass --allow-missing-checksum to bypass explicitly).',
        );
    } else {
        checksumStatus = 'skipped-by-flag';
    }

    const tempRoot = mkdtempSync(join(tmpdir(), 'acm-github-install-'));
    try {
        const extractDir = join(tempRoot, 'extracted');
        const extracted = extractZipBufferSafely(zipRes.buffer, extractDir);
        if (!extracted.pluginRoot) {
            throw new Error('Downloaded ZIP archive did not contain a valid plugin.json root.');
        }

        const { version } = validatePluginBundle(extracted.pluginRoot, {
            requireSidecarEntrypoints: true,
        });

        assertReleaseVersionMatches(version, parsedExpected.normalized);

        let installMethod = 'atomic-swap';
        let previousVersion: string | null = null;
        let replaced = false;

        if (options.useCli && isDefaultTarget) {
            const lockHandle = acquireExclusiveLockSync(getPluginUpdateLockPath(targetDir), {
                owner: 'cli-installer',
                timeoutMs: options.lockTimeoutMs,
                staleMs: options.lockStaleMs,
            });
            try {
                assertPluginTarget(targetDir, true);
                replaced = existsSync(targetDir);
                if (existsSync(join(targetDir, 'plugin.json'))) {
                    try {
                        previousVersion = String(readJsonNoBom(join(targetDir, 'plugin.json')).version || '').trim() || null;
                    } catch {
                        previousVersion = null;
                    }
                }
                installViaAgyCli(extracted.pluginRoot, env, platform, options.agyBinary);
                installMethod = 'agy-cli';
            } finally {
                lockHandle.release();
            }
        } else {
            const swap = installPluginAtomic(extracted.pluginRoot, targetDir, {
                onBeforeSwap: options.onBeforeSwap,
                lockTimeoutMs: options.lockTimeoutMs,
                lockStaleMs: options.lockStaleMs,
            });
            previousVersion = swap.previousVersion;
            replaced = swap.replaced;
        }

        let registration: Record<string, unknown> = { updated: false, enabled: null, method: 'skipped-custom-target' };
        if (isDefaultTarget || options.configPath) {
            registration = ensurePluginEnabled({
                env,
                platform,
                configPath: options.configPath,
                agyBinary: options.agyBinary,
            });
        }

        const installedRuntimeMeta = readInstalledRuntimeMetadata(targetDir);

        return {
            action: options.action || 'from-github',
            sourceMode: 'github',
            repo: release.repo,
            sourceDir: release.zipAsset.url,
            targetDir,
            version,
            buildId: installedRuntimeMeta.buildId,
            previousVersion,
            replaced,
            dryRun: false,
            bundledRuntime: installedRuntimeMeta.bundled,
            installMethod,
            sha256: actualSha256,
            checksumVerified,
            checksumStatus,
            extractedFiles: extracted.extractedFiles,
            registration,
            reloadRequired: Boolean(replaced),
        };
    } finally {
        try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}

// ─── Local Source Detection & Synchronous Install/Uninstall ──────────────────

function readInstalledRuntimeMetadata(pluginDir: string): { buildId: string | null; bundled: boolean } {
    const runtimePkgPath = join(pluginDir, 'sidecars', 'context_monitor', 'runtime', 'package.json');
    if (!existsSync(runtimePkgPath)) {
        return { buildId: null, bundled: false };
    }
    try {
        const parsed = readJsonNoBom(runtimePkgPath);
        const buildId = typeof parsed?.buildId === 'string' && parsed.buildId.trim()
            ? parsed.buildId.trim()
            : null;
        return { buildId, bundled: Boolean(parsed?.bundled) };
    } catch {
        return { buildId: null, bundled: false };
    }
}

export function detectLocalSourceDir(
    explicitSource: string | null | undefined,
    explicitRepoRoot?: string | null,
    metaUrl: string = getEntryMetaUrl(),
): { dir: string; needsRuntimeCopy: boolean; repoRoot: string | null } | null {
    if (explicitSource) {
        const resolvedSource = resolve(explicitSource);
        if (!existsSync(join(resolvedSource, 'plugin.json'))) {
            throw new Error(`Invalid local plugin directory (missing plugin.json): ${resolvedSource}`);
        }
        return {
            dir: resolvedSource,
            needsRuntimeCopy: !existsSync(
                join(resolvedSource, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'),
            ),
            repoRoot: explicitRepoRoot ? resolve(explicitRepoRoot) : detectCheckoutRepoRoot(metaUrl),
        };
    }

    const effectiveRepoRoot = explicitRepoRoot !== undefined
        ? (explicitRepoRoot ? resolve(explicitRepoRoot) : null)
        : detectCheckoutRepoRoot(metaUrl);

    if (effectiveRepoRoot) {
        const staged = join(effectiveRepoRoot, 'dist', 'antigravity-context-monitor-app');
        if (
            isOwnedPluginManifestFile(join(staged, 'plugin.json')) &&
            existsSync(join(staged, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'))
        ) {
            return { dir: staged, needsRuntimeCopy: false, repoRoot: effectiveRepoRoot };
        }
        const repoAppPlugin = join(effectiveRepoRoot, 'app-plugin');
        const hasStageBundle = existsSync(join(effectiveRepoRoot, 'dist-stage', 'app', 'sidecar-server.js'))
            && existsSync(join(effectiveRepoRoot, 'dist-stage', 'app', 'sidecar-runtime.js'))
            && existsSync(join(effectiveRepoRoot, 'dist-stage', 'app', 'sidecar-bundle.js'));
        const hasCompiledOut = existsSync(join(effectiveRepoRoot, 'out', 'app', 'sidecar-server.js'));
        if (isOwnedPluginManifestFile(join(repoAppPlugin, 'plugin.json')) && (hasStageBundle || hasCompiledOut)) {
            return { dir: repoAppPlugin, needsRuntimeCopy: true, repoRoot: effectiveRepoRoot };
        }
        return null;
    }

    // Outside a source checkout (e.g. script shipped inside an extracted bundle dir):
    // ONLY accept co-located plugin.json if it is explicitly an owned bundle with compiled runtime.
    const scriptFile = getScriptFilePath(metaUrl);
    if (scriptFile) {
        const scriptDir = dirname(scriptFile);
        if (
            isOwnedPluginManifestFile(join(scriptDir, 'plugin.json'))
            && existsSync(join(scriptDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'))
        ) {
            return { dir: scriptDir, needsRuntimeCopy: false, repoRoot: null };
        }
    }

    return null;
}

export function runInstaller(options: Record<string, any> = {}): Record<string, any> {
    const env: NodeJS.ProcessEnv = options.env || process.env;
    const platform: NodeJS.Platform = options.platform || process.platform;
    const action: InstallerAction = options.action || 'install';
    const defaultTarget = getDefaultTargetDir(env, platform);
    const targetDir: string = options.target || defaultTarget;
    const isDefaultTarget = resolve(targetDir) === resolve(defaultTarget);
    const dryRun = Boolean(options.dryRun);

    if (action === 'print-cdp-guide') {
        return {
            action: 'print-cdp-guide',
            guide: formatCdpGuide(),
        };
    }

    if (action === 'setup-cdp-launcher') {
        return setupCdpLauncher({
            env,
            platform,
            homeDir: options.homeDir,
            appPath: options.appPath,
            systemAppsDir: options.systemAppsDir,
            desktopDir: options.desktopDir,
            dryRun,
            execFileSyncFn: options.execFileSyncFn,
            commandExistsFn: options.commandExistsFn,
        });
    }

    if (action === 'remove-cdp-launcher') {
        return removeCdpLauncher({
            env,
            platform,
            homeDir: options.homeDir,
            appPath: options.appPath,
            systemAppsDir: options.systemAppsDir,
            desktopDir: options.desktopDir,
            dryRun,
            execFileSyncFn: options.execFileSyncFn,
            commandExistsFn: options.commandExistsFn,
        });
    }

    if (action === 'uninstall') {
        const existed = existsSync(targetDir);
        if (!dryRun && existed) {
            const lock = acquireExclusiveLockSync(getPluginUpdateLockPath(targetDir), {
                owner: 'cli-uninstall', timeoutMs: options.lockTimeoutMs, staleMs: options.lockStaleMs,
            });
            try {
                assertPluginTarget(targetDir);
                const agyBin = options.useCli && isDefaultTarget ? options.agyBinary || findAgyBinary(env, platform) : null;
                if (agyBin) {
                    execFileSync(agyBin, ['plugin', 'uninstall', PLUGIN_DIR_NAME], {
                        env,
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'pipe'],
                        windowsHide: true,
                    });
                } else {
                    try {
                        rmSyncWithRetry(targetDir, { recursive: true, force: true });
                    } catch (rmErr) {
                        if (isRetryableFsLockError(rmErr)) {
                            const lockedErr = new Error(
                                `Failed to remove ${targetDir} because a running Antigravity sidecar still holds an open handle (${(rmErr as NodeJS.ErrnoException).code}). Toggle the plugin Off in Antigravity Customizations (or close Antigravity App) and re-run --uninstall.`,
                                { cause: rmErr },
                            ) as NodeJS.ErrnoException;
                            lockedErr.code = (rmErr as NodeJS.ErrnoException).code;
                            throw lockedErr;
                        }
                        throw rmErr;
                    }
                }
            } finally {
                lock.release();
            }
        }
        return {
            action: 'uninstall',
            targetDir,
            dryRun,
            existed,
            removed: existed && !dryRun && !existsSync(targetDir),
        };
    }

    const explicitLocal = options.localDir || options.source || null;
    const detected = detectLocalSourceDir(explicitLocal, options.repoRoot);
    if (!detected) {
        throw new Error(
            'Could not locate built local plugin directory (pass `--local-dir <dir>` or `--source <dir>`, ' +
            'run from a built checkout, or omit `--no-remote-fallback` / pass `--from-github`).',
        );
    }

    const { dir: sourceDir, needsRuntimeCopy, repoRoot } = detected;
    const distStageAppDir = repoRoot ? join(repoRoot, 'dist-stage', 'app') : undefined;
    const outSrc = repoRoot ? join(repoRoot, 'out') : undefined;
    const imagesSrc = repoRoot ? join(repoRoot, 'src', 'images') : undefined;

    if (needsRuntimeCopy) {
        const hasStage = Boolean(
            distStageAppDir
            && existsSync(join(distStageAppDir, 'sidecar-bundle.js'))
            && existsSync(join(distStageAppDir, 'sidecar-server.js'))
            && existsSync(join(distStageAppDir, 'sidecar-runtime.js')),
        );
        const hasOut = Boolean(outSrc && existsSync(join(outSrc, 'app', 'sidecar-server.js')));
        if (!hasStage && !hasOut) {
            throw new Error(
                'Compiled runtime not found at dist-stage/app or out/app/sidecar-server.js. ' +
                'Run `npm run build:bundles` (or `node scripts/package-app-plugin.mjs`) before installing.',
            );
        }
    }

    const { version } = validatePluginBundle(sourceDir, { requireSidecarEntrypoints: !needsRuntimeCopy });

    let previousVersion: string | null = null;
    let replaced = false;
    let installMethod = 'atomic-swap';
    let registration: Record<string, unknown> = { updated: false, enabled: null, method: 'skipped' };

    if (!dryRun) {
        if (options.useCli && isDefaultTarget && !needsRuntimeCopy) {
            const lock = acquireExclusiveLockSync(getPluginUpdateLockPath(targetDir), {
                owner: 'cli-installer', timeoutMs: options.lockTimeoutMs, staleMs: options.lockStaleMs,
            });
            try {
                assertPluginTarget(targetDir, true);
                replaced = existsSync(targetDir);
                if (isOwnedPluginManifestFile(join(targetDir, 'plugin.json'))) {
                    previousVersion = String(readJsonNoBom(join(targetDir, 'plugin.json')).version || '').trim() || null;
                }
                installViaAgyCli(sourceDir, env, platform, options.agyBinary);
                installMethod = 'agy-cli';
            } finally {
                lock.release();
            }
        } else {
            const swap = installPluginAtomic(sourceDir, targetDir, {
                needsRuntimeCopy,
                distStageAppDir,
                outSrc,
                imagesSrc,
                version,
                onBeforeSwap: options.onBeforeSwap,
                lockTimeoutMs: options.lockTimeoutMs,
                lockStaleMs: options.lockStaleMs,
            });
            previousVersion = swap.previousVersion;
            replaced = swap.replaced;
        }

        if (isDefaultTarget || options.configPath) {
            registration = ensurePluginEnabled({
                env,
                platform,
                configPath: options.configPath,
                agyBinary: options.agyBinary,
            });
        }
    }

    const installedRuntimeMeta = dryRun
        ? readInstalledRuntimeMetadata(sourceDir)
        : readInstalledRuntimeMetadata(targetDir);

    return {
        action,
        sourceMode: 'local',
        sourceDir,
        targetDir,
        version,
        buildId: installedRuntimeMeta.buildId,
        previousVersion,
        replaced,
        dryRun,
        bundledRuntime: needsRuntimeCopy,
        installMethod,
        registration,
        reloadRequired: Boolean(replaced),
    };
}

// ─── Status Inspector ────────────────────────────────────────────────────────

function probeLoopbackHealth(port: number, timeoutMs = 2000): Promise<Record<string, any> | null> {
    return new Promise((resolvePromise) => {
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
            resolvePromise(null);
            return;
        }
        let settled = false;
        const finish = (value: Record<string, any> | null) => {
            if (settled) { return; }
            settled = true;
            resolvePromise(value);
        };
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: '/api/health',
            method: 'GET',
            headers: { Connection: 'close' },
        }, (res) => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            res.on('data', (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > 16 * 1024) {
                    req.destroy();
                    finish(null);
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    finish(null);
                    return;
                }
                try {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    finish(body && body.ok ? body : null);
                } catch {
                    finish(null);
                }
            });
            res.on('error', () => finish(null));
        });
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            finish(null);
        });
        req.on('error', () => finish(null));
        req.end();
    });
}

function parseLatestSidecarLogPort(logContent: string): number | null {
    const matches = [...String(logContent || '').matchAll(/listening on (?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/gi)];
    if (matches.length === 0) { return null; }
    const port = Number(matches[matches.length - 1][1]);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function probeSingleLoopbackHost(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; code: string | null }> {
    return new Promise((resolvePromise) => {
        let settled = false;
        const finish = (result: { ok: boolean; code: string | null }) => {
            if (settled) { return; }
            settled = true;
            resolvePromise(result);
        };
        const sock = net.createConnection({ host, port });
        sock.setTimeout(timeoutMs);
        sock.once('connect', () => {
            sock.destroy();
            finish({ ok: true, code: null });
        });
        sock.once('timeout', () => {
            sock.destroy();
            finish({ ok: false, code: 'ETIMEDOUT' });
        });
        sock.once('error', (err) => {
            sock.destroy();
            const code = err && typeof err === 'object' && 'code' in err && err.code ? String(err.code) : 'ERR';
            finish({ ok: false, code });
        });
    });
}

export async function probeLoopbackTcpPort(port: number, timeoutMs = 300): Promise<boolean> {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        return false;
    }
    const ipv4 = await probeSingleLoopbackHost('127.0.0.1', port, timeoutMs);
    if (ipv4.ok) { return true; }
    if (ipv4.code === 'ECONNREFUSED') {
        const ipv6 = await probeSingleLoopbackHost('::1', port, timeoutMs);
        return ipv6.ok;
    }
    return false;
}

export async function inspectDevToolsActivePort(
    portFilePath: string,
    options: { probeCdpPort?: boolean; probeCdpPortFn?: (port: number) => Promise<boolean> } = {},
): Promise<{ active: boolean; stale: boolean; portFilePath: string; port: number | null; wsPath: string | null }> {
    if (!existsSync(portFilePath)) {
        return { active: false, stale: false, portFilePath, port: null, wsPath: null };
    }
    try {
        const lines = readFileSync(portFilePath, 'utf8')
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        const port = Number(lines[0]);
        const wsPath = lines[1] || null;
        const valid = Number.isInteger(port) && port > 0 && port <= 65535;
        if (!valid) {
            return { active: false, stale: true, portFilePath, port: null, wsPath: null };
        }
        if (options.probeCdpPort === false) {
            return { active: true, stale: false, portFilePath, port, wsPath };
        }
        const probeFn = options.probeCdpPortFn || probeLoopbackTcpPort;
        const reachable = Boolean(await probeFn(port));
        return {
            active: reachable,
            stale: !reachable,
            portFilePath,
            port,
            wsPath,
        };
    } catch {
        return { active: false, stale: false, portFilePath, port: null, wsPath: null };
    }
}

function detectIdeExtensions(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): {
    installed: boolean;
    installations: Array<{ editor: string; version: string; path: string }>;
} {
    const installations: Array<{ editor: string; version: string; path: string }> = [];
    for (const { editor, dir } of getIdeExtensionDirs(env, platform)) {
        if (!existsSync(dir)) { continue; }
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            continue;
        }
        const matching = entries
            .filter((n) => n.toLowerCase().startsWith(IDE_EXTENSION_ID_PREFIX))
            .map((n) => {
                const extPath = join(dir, n);
                let version = n.slice(IDE_EXTENSION_ID_PREFIX.length);
                const pkgPath = join(extPath, 'package.json');
                if (existsSync(pkgPath)) {
                    try {
                        const pkg = readJsonNoBom(pkgPath);
                        if (pkg.version) { version = String(pkg.version).trim(); }
                    } catch { /* fallback to dir suffix */ }
                }
                return { editor, version, path: extPath };
            })
            .sort((a, b) => compareSemver(b.version, a.version));
        if (matching.length > 0) {
            installations.push(matching[0]);
        }
    }
    return {
        installed: installations.length > 0,
        installations,
    };
}

export async function collectStatus(options: Record<string, any> = {}): Promise<Record<string, any>> {
    const env: NodeJS.ProcessEnv = options.env || process.env;
    const platform: NodeJS.Platform = options.platform || process.platform;
    const targetDir: string = options.target || getDefaultTargetDir(env, platform);
    const configPath: string = options.configPath || getDefaultConfigPath(env, platform);
    const sidecarLogPath: string = options.sidecarLogPath || getSidecarLogPath(env, platform);
    const cdpPortFilePath: string = options.cdpPortFilePath || getDevToolsActivePortPath(env, platform);

    let installed = false;
    let version: string | null = null;
    let buildId: string | null = null;
    let bundled = false;
    let hasCompiledRuntime = false;
    let manifestDisabled = false;
    if (existsSync(join(targetDir, 'plugin.json'))) {
        installed = true;
        try {
            const manifest = readJsonNoBom(join(targetDir, 'plugin.json'));
            version = typeof manifest.version === 'string' ? manifest.version.trim() : null;
            manifestDisabled = Boolean(manifest.disabled);
        } catch {
            version = null;
        }
        hasCompiledRuntime = existsSync(
            join(targetDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'),
        );
        const runtimeMeta = readInstalledRuntimeMetadata(targetDir);
        buildId = runtimeMeta.buildId;
        bundled = runtimeMeta.bundled;
    }

    const configExists = existsSync(configPath);
    let enabledInConfig: boolean | null = null;
    let sidecarConfigured = false;
    if (configExists) {
        try {
            const cfg = readJsonNoBom(configPath);
            if (isPlainObject(cfg?.plugins?.[PLUGIN_DIR_NAME]) && typeof cfg.plugins[PLUGIN_DIR_NAME].enabled === 'boolean') {
                enabledInConfig = cfg.plugins[PLUGIN_DIR_NAME].enabled;
            }
            sidecarConfigured = Boolean(cfg?.sidecars?.[`${PLUGIN_DIR_NAME}/context_monitor`]);
        } catch {
            enabledInConfig = null;
        }
    }
    const effectiveEnabled = installed
        ? (enabledInConfig !== null ? enabledInConfig : !manifestDisabled)
        : false;

    const logExists = existsSync(sidecarLogPath);
    let lastLogUpdate: string | null = null;
    let listeningPort: number | null = null;
    if (logExists) {
        try {
            const st = statSync(sidecarLogPath);
            lastLogUpdate = st.mtime.toISOString();
            const content = readFileSync(sidecarLogPath, 'utf8');
            listeningPort = parseLatestSidecarLogPort(content);
        } catch {
            // ignore
        }
    }

    let health: Record<string, any> | null = null;
    if (listeningPort && options.probeHealth !== false) {
        const probeFn = options.probeHealthFn || probeLoopbackHealth;
        const result = await probeFn(listeningPort);
        if (result?.ok === true && result.surface === 'app-sidecar'
            && typeof result.version === 'string' && parseSemver(result.version)) {
            health = result;
        }
    }
    const processActive = Boolean(health && health.ok);
    const runningVersion = health && typeof health.version === 'string' ? health.version : null;
    const runningBuildId = health && typeof health.buildId === 'string' && health.buildId.trim()
        ? health.buildId.trim()
        : null;
    const runningPid = health && Number.isInteger(health.pid) ? health.pid : null;
    const reloadRequired = Boolean(
        processActive
        && (
            (runningVersion && version && runningVersion !== version)
            || (buildId && runningBuildId !== buildId)
        ),
    );

    const cdp = await inspectDevToolsActivePort(cdpPortFilePath, {
        probeCdpPort: options.probeCdpPort,
        probeCdpPortFn: options.probeCdpPortFn,
    });
    const launcherStatus = inspectCdpLauncher({
        env,
        platform,
        homeDir: options.homeDir,
        appPath: options.appPath,
        systemAppsDir: options.systemAppsDir,
        desktopDir: options.desktopDir,
        execFileSyncFn: options.execFileSyncFn,
        commandExistsFn: options.commandExistsFn,
    });
    const cdpLauncher = {
        installed: launcherStatus.installed,
        path: launcherStatus.launcherPath,
        platform: launcherStatus.platform,
        supported: launcherStatus.supported,
        displayName: launcherStatus.displayName,
        targetAppFound: launcherStatus.targetAppFound,
    };

    const ideVsix = detectIdeExtensions(env, platform);

    let remote: Record<string, unknown> = { checked: false, latestVersion: null, updateAvailable: false, releaseUrl: null, error: null };
    if (options.checkRemote) {
        try {
            const rel = await fetchGitHubReleaseInfo({
                repo: options.repo,
                requestFn: options.requestFn,
                timeoutMs: options.timeoutMs,
            });
            const updateAvailable = Boolean(rel.version && (!version || compareSemver(rel.version, version) > 0));
            remote = {
                checked: true,
                latestVersion: rel.version || null,
                updateAvailable,
                releaseUrl: rel.releaseUrl,
                zipAsset: rel.zipAsset?.name || null,
                hasChecksums: Boolean(rel.checksumAsset),
                error: null,
            };
        } catch (err) {
            remote = {
                checked: true,
                latestVersion: null,
                updateAvailable: false,
                releaseUrl: null,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    return {
        action: 'status',
        appPlugin: {
            installed,
            version,
            buildId,
            bundled,
            path: targetDir,
            hasCompiledRuntime,
            enabled: effectiveEnabled,
            enabledInConfig,
            configPath,
            configExists,
            sidecarConfigured,
        },
        sidecar: {
            logPath: sidecarLogPath,
            logExists,
            lastLogUpdate,
            listeningPort,
            processActive,
            runningPid,
            runningVersion,
            runningBuildId,
            reloadRequired,
        },
        cdp,
        cdpLauncher,
        ideVsix,
        remote,
    };
}

// ─── Async Entry Orchestrator ────────────────────────────────────────────────

export async function runInstallerAsync(options: Record<string, any> = {}): Promise<Record<string, any>> {
    const action: InstallerAction = options.action || 'install';
    if (action === 'print-cdp-guide') {
        return { action: 'print-cdp-guide', guide: formatCdpGuide() };
    }
    if (action === 'setup-cdp-launcher' || action === 'remove-cdp-launcher') {
        return runInstaller(options);
    }
    if (action === 'status') {
        return collectStatus(options);
    }
    if (action === 'uninstall') {
        return runInstaller(options);
    }
    if (action === 'from-github') {
        return installFromGitHub({ ...options, action: 'from-github' });
    }
    const explicitLocal = options.localDir || options.source || null;
    if (action === 'upgrade') {
        if (explicitLocal) {
            return runInstaller({ ...options, action: 'upgrade' });
        }
        if (options.noRemoteFallback) {
            throw new Error(
                'Refusing remote GitHub upgrade because `--no-remote-fallback` was specified without `--local-dir <dir>` or `--source <dir>`.',
            );
        }
        return installFromGitHub({ ...options, action: 'upgrade' });
    }
    // action === 'install'
    if (explicitLocal) {
        return runInstaller({ ...options, action: 'install' });
    }
    const detected = detectLocalSourceDir(null, options.repoRoot);
    if (detected) {
        return runInstaller({ ...options, action: 'install' });
    }
    if (options.noRemoteFallback) {
        return runInstaller({ ...options, action: 'install' });
    }
    return installFromGitHub({ ...options, action: 'install', fallbackFromLocal: true });
}

// ─── Zero-Patch Persistent CDP Launcher (Consumes src/core/cdp-launcher-core) ─

const windowsDesktopDirCache = new Map<string, { dir: string; expiresAt: number }>();
const windowsDesktopDirInFlight = new Map<string, Promise<string>>();

export function clearWindowsDesktopDirCache(): void {
    windowsDesktopDirCache.clear();
    windowsDesktopDirInFlight.clear();
}

function createLauncherRunner(execFileSyncFn?: (file: string, args: readonly string[], opts?: any) => unknown) {
    return execFileSyncFn || ((file: string, args: readonly string[], opts?: any) => execFileSync(file, [...args], {
        env: opts?.env,
        windowsHide: opts?.windowsHide ?? true,
        stdio: opts?.stdio ?? 'pipe',
        ...(typeof opts?.timeout === 'number' ? { timeout: opts.timeout } : {}),
        ...(opts?.encoding ? { encoding: opts.encoding } : {}),
    }));
}

function createLauncherAsyncRunner(execFileAsyncFn?: (file: string, args: readonly string[], opts?: any) => Promise<string | Buffer>) {
    if (typeof execFileAsyncFn === 'function') { return execFileAsyncFn; }
    return (file: string, args: readonly string[], opts?: any) => new Promise<string>((resolvePromise, rejectPromise) => {
        execFile(file, [...args], {
            env: opts?.env,
            windowsHide: opts?.windowsHide ?? true,
            timeout: opts?.timeout ?? 3_000,
            encoding: opts?.encoding ?? 'utf8',
        }, (err, stdout) => {
            if (err) { rejectPromise(err); return; }
            resolvePromise(typeof stdout === 'string' ? stdout : String(stdout ?? ''));
        });
    });
}

export async function resolveWindowsDesktopDirAsync(options: Record<string, any> = {}): Promise<string> {
    if (options.desktopDir && String(options.desktopDir).trim()) {
        return String(options.desktopDir).trim();
    }
    const env: NodeJS.ProcessEnv = options.env || process.env;
    const homeDir = (options.homeDir && String(options.homeDir).trim()) || resolveUserHome(env, 'win32');
    const key = homeDir.trim().toLowerCase();
    const nowFn = typeof options.now === 'function' ? options.now : (() => Date.now());
    const ttlMs = typeof options.desktopCacheTtlMs === 'number' ? options.desktopCacheTtlMs : WINDOWS_DESKTOP_CACHE_TTL_MS;

    const cached = windowsDesktopDirCache.get(key);
    if (cached && nowFn() < cached.expiresAt) {
        return cached.dir;
    }
    const inFlight = windowsDesktopDirInFlight.get(key);
    if (inFlight) { return inFlight; }

    const fallback = getFastWindowsDesktopFallback(homeDir, env);
    const promise = (async () => {
        let resolved = fallback;
        if (process.platform === 'win32' || typeof options.execFileAsyncFn === 'function') {
            try {
                const asyncRunner = createLauncherAsyncRunner(options.execFileAsyncFn);
                const raw = await asyncRunner(
                    'powershell.exe',
                    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_DESKTOP_PS_SCRIPT],
                    { env, windowsHide: true, stdio: 'pipe', timeout: 3_000, encoding: 'utf8' },
                );
                const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : (typeof raw === 'string' ? raw : '');
                const cleaned = text.replace(/^\uFEFF/, '').trim();
                if (cleaned && !/[\r\n]/.test(cleaned)) {
                    resolved = cleaned;
                }
            } catch { /* fallback */ }
        }
        windowsDesktopDirCache.set(key, { dir: resolved, expiresAt: nowFn() + ttlMs });
        return resolved;
    })().finally(() => {
        windowsDesktopDirInFlight.delete(key);
    });
    windowsDesktopDirInFlight.set(key, promise);
    return promise;
}

export function getCachedWindowsDesktopDir(
    options: Record<string, any> = {},
    homeDirArg?: string,
    envArg?: NodeJS.ProcessEnv,
): string {
    if (options.desktopDir && String(options.desktopDir).trim()) {
        return String(options.desktopDir).trim();
    }
    const env = envArg || options.env || process.env;
    const homeDir = homeDirArg || (options.homeDir && String(options.homeDir).trim()) || resolveUserHome(env, 'win32');
    const key = homeDir.trim().toLowerCase();
    const nowFn = typeof options.now === 'function' ? options.now : (() => Date.now());
    const cached = windowsDesktopDirCache.get(key);
    if (cached && nowFn() < cached.expiresAt) {
        return cached.dir;
    }
    if (process.platform === 'win32' || typeof options.execFileAsyncFn === 'function') {
        void resolveWindowsDesktopDirAsync({ ...options, homeDir, env }).catch(() => {});
    }
    return cached?.dir || getFastWindowsDesktopFallback(homeDir, env);
}

function resolveWindowsDesktopDir(
    options: Record<string, any> = {},
    homeDir: string,
    env: NodeJS.ProcessEnv = process.env,
    allowSyncProbe = false,
): string {
    if (options.desktopDir && String(options.desktopDir).trim()) {
        return String(options.desktopDir).trim();
    }
    if (!allowSyncProbe) {
        return getCachedWindowsDesktopDir(options, homeDir, env);
    }
    const key = homeDir.trim().toLowerCase();
    const nowFn = typeof options.now === 'function' ? options.now : (() => Date.now());
    const ttlMs = typeof options.desktopCacheTtlMs === 'number' ? options.desktopCacheTtlMs : WINDOWS_DESKTOP_CACHE_TTL_MS;
    const cached = windowsDesktopDirCache.get(key);
    if (cached && nowFn() < cached.expiresAt) {
        return cached.dir;
    }
    let resolved = getFastWindowsDesktopFallback(homeDir, env);
    if (process.platform === 'win32' || typeof options.execFileSyncFn === 'function') {
        try {
            const runner = createLauncherRunner(options.execFileSyncFn);
            const raw = runner(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_DESKTOP_PS_SCRIPT],
                { env, windowsHide: true, stdio: 'pipe', timeout: 3_000, encoding: 'utf8' },
            );
            const text = Buffer.isBuffer(raw)
                ? raw.toString('utf8')
                : (typeof raw === 'string' ? raw : '');
            const cleaned = text.replace(/^\uFEFF/, '').trim();
            if (cleaned && !/[\r\n]/.test(cleaned)) {
                resolved = cleaned;
            }
        } catch {
            // Fallback cleanly to %USERPROFILE%\Desktop
        }
    }
    windowsDesktopDirCache.set(key, { dir: resolved, expiresAt: nowFn() + ttlMs });
    return resolved;
}

export function resolveCdpLauncherPaths(options: Record<string, any> = {}): CoreResolvedLauncherPaths {
    const platform: NodeJS.Platform = options.platform || process.platform;
    const env: NodeJS.ProcessEnv = options.env || process.env;
    const homeDir = (options.homeDir && String(options.homeDir).trim()) || resolveUserHome(env, platform);
    const desktopDir = platform === 'win32'
        ? (options.desktopDir && String(options.desktopDir).trim()
            ? String(options.desktopDir).trim()
            : resolveWindowsDesktopDir(options, homeDir, env, false))
        : undefined;

    return resolveCoreCdpLauncherPaths({
        platform,
        homeDir: options.homeDir,
        env,
        appPath: options.appPath,
        systemAppsDir: options.systemAppsDir,
        preferredMacAppDir: options.preferredMacAppDir,
        desktopDir,
        commandExistsFn: options.commandExistsFn,
    });
}

export const MACOS_ICON_BADGE_JXA = [
    'ObjC.import("AppKit");',
    'ObjC.import("Foundation");',
    'const env = $.NSProcessInfo.processInfo.environment;',
    'const srcPath = ObjC.unwrap(env.objectForKey("ACM_SRC_PNG"));',
    'const dstPath = ObjC.unwrap(env.objectForKey("ACM_DST_PNG"));',
    'const img = $.NSImage.alloc.initWithContentsOfFile(srcPath);',
    'if (!img || img.isNil()) { throw new Error("Failed to load base icon PNG"); }',
    'const size = 1024;',
    'const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, size, size, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0);',
    'const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);',
    '$.NSGraphicsContext.saveGraphicsState;',
    '$.NSGraphicsContext.setCurrentContext(ctx);',
    'img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, size, size), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1.0);',
    'const badgeW = 468; const badgeH = 228; const badgeX = size - badgeW - 36; const badgeY = 44;',
    'const rect = $.NSMakeRect(badgeX, badgeY, badgeW, badgeH);',
    'const bp = $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius(rect, 60, 60);',
    'const shadow = $.NSShadow.alloc.init;',
    'shadow.setShadowColor($.NSColor.colorWithCalibratedRedGreenBlueAlpha(0, 0, 0, 0.58));',
    'shadow.setShadowOffset($.NSMakeSize(0, -10));',
    'shadow.setShadowBlurRadius(24);',
    'shadow.set;',
    '$.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.055, 0.082, 0.133, 0.96).setFill;',
    'bp.fill;',
    'const noShadow = $.NSShadow.alloc.init; noShadow.set;',
    '$.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.357, 0.612, 0.965, 1.0).setStroke;',
    'bp.setLineWidth(14);',
    'bp.stroke;',
    'const font = $.NSFont.systemFontOfSizeWeight(152, $.NSFontWeightHeavy);',
    'const attrs = $.NSMutableDictionary.dictionary;',
    'attrs.setObjectForKey(font, $.NSFontAttributeName);',
    'attrs.setObjectForKey($.NSColor.whiteColor, $.NSForegroundColorAttributeName);',
    'const text = $.NSString.stringWithString("CDP");',
    'const textSize = text.sizeWithAttributes(attrs);',
    'const textX = badgeX + (badgeW - textSize.width) / 2;',
    'const textY = badgeY + (badgeH - textSize.height) / 2 - 4;',
    'text.drawAtPointWithAttributes($.NSMakePoint(textX, textY), attrs);',
    '$.NSGraphicsContext.restoreGraphicsState;',
    'const pngData = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary);',
    'if (!pngData.writeToFileAtomically(dstPath, true)) { throw new Error("Failed to write badged PNG"); }',
].join(' ');

export const WINDOWS_SHORTCUT_PS_SCRIPT = [
    '$ErrorActionPreference = "Stop"',
    '$iconLoc = ""',
    'if ($env:ACM_BADGE_ICON_PATH -and $env:ACM_TARGET_EXE -and (Test-Path -LiteralPath $env:ACM_TARGET_EXE)) {',
    '  try {',
    '    Add-Type -AssemblyName System.Drawing',
    '    $iconDir = Split-Path -Parent $env:ACM_BADGE_ICON_PATH',
    '    if ($iconDir -and -not (Test-Path -LiteralPath $iconDir)) { New-Item -ItemType Directory -Path $iconDir -Force | Out-Null }',
    '    $srcIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:ACM_TARGET_EXE)',
    '    if ($srcIcon) {',
    '      $srcBmp = $srcIcon.ToBitmap()',
    '      $size = 256',
    '      $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)',
    '      $g = [System.Drawing.Graphics]::FromImage($bmp)',
    '      try {',
    '        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias',
    '        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
    '        $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit',
    '        $g.Clear([System.Drawing.Color]::Transparent)',
    '        $g.DrawImage($srcBmp, 0, 0, $size, $size)',
    '        $bw = 124; $bh = 62; $bx = $size - $bw - 8; $by = $size - $bh - 8; $r = 16; $d = $r * 2',
    '        $gp = New-Object System.Drawing.Drawing2D.GraphicsPath',
    '        $gp.AddArc($bx, $by, $d, $d, 180, 90)',
    '        $gp.AddArc($bx + $bw - $d, $by, $d, $d, 270, 90)',
    '        $gp.AddArc($bx + $bw - $d, $by + $bh - $d, $d, $d, 0, 90)',
    '        $gp.AddArc($bx, $by + $bh - $d, $d, $d, 90, 90)',
    '        $gp.CloseFigure()',
    '        $fillBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 14, 21, 34))',
    '        $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 91, 156, 246), 4)',
    '        $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)',
    '        $font = New-Object System.Drawing.Font("Segoe UI", 30, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)',
    '        $sf = New-Object System.Drawing.StringFormat',
    '        $sf.Alignment = [System.Drawing.StringAlignment]::Center',
    '        $sf.LineAlignment = [System.Drawing.StringAlignment]::Center',
    '        $g.FillPath($fillBrush, $gp)',
    '        $g.DrawPath($borderPen, $gp)',
    '        $rectF = New-Object System.Drawing.RectangleF($bx, $by + 1, $bw, $bh)',
    '        $g.DrawString("CDP", $font, $textBrush, $rectF, $sf)',
    '        $sf.Dispose(); $font.Dispose(); $textBrush.Dispose(); $borderPen.Dispose(); $fillBrush.Dispose(); $gp.Dispose()',
    '      } finally { $g.Dispose() }',
    '      $pngMs = New-Object System.IO.MemoryStream',
    '      try { $bmp.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png); $pngBytes = $pngMs.ToArray() } finally { $pngMs.Dispose(); $bmp.Dispose(); $srcBmp.Dispose(); $srcIcon.Dispose() }',
    '      $icoMs = New-Object System.IO.MemoryStream',
    '      $bwStream = New-Object System.IO.BinaryWriter($icoMs)',
    '      try {',
    '        $bwStream.Write([UInt16]0); $bwStream.Write([UInt16]1); $bwStream.Write([UInt16]1)',
    '        $bwStream.Write([Byte]0); $bwStream.Write([Byte]0); $bwStream.Write([Byte]0); $bwStream.Write([Byte]0)',
    '        $bwStream.Write([UInt16]1); $bwStream.Write([UInt16]32)',
    '        $bwStream.Write([UInt32]$pngBytes.Length); $bwStream.Write([UInt32]22)',
    '        $bwStream.Write($pngBytes); $bwStream.Flush()',
    '        [System.IO.File]::WriteAllBytes($env:ACM_BADGE_ICON_PATH, $icoMs.ToArray())',
    '        $iconLoc = "$env:ACM_BADGE_ICON_PATH,0"',
    '      } finally { $bwStream.Dispose(); $icoMs.Dispose() }',
    '    }',
    '  } catch {',
    '    if (Test-Path -LiteralPath $env:ACM_BADGE_ICON_PATH) { Remove-Item -LiteralPath $env:ACM_BADGE_ICON_PATH -Force -ErrorAction SilentlyContinue }',
    '    $iconLoc = ""',
    '  }',
    '}',
    'if (-not $iconLoc -and $env:ACM_TARGET_EXE -and (Test-Path -LiteralPath $env:ACM_TARGET_EXE)) { $iconLoc = "$env:ACM_TARGET_EXE,0" }',
    '$ws = New-Object -ComObject WScript.Shell',
    '$targets = @($env:ACM_LNK_DESKTOP, $env:ACM_LNK_STARTMENU) | Where-Object { $_ -and $_.Trim().Length -gt 0 }',
    'foreach ($lnkPath in $targets) {',
    '  $dir = Split-Path -Parent $lnkPath',
    '  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
    '  $sc = $ws.CreateShortcut($lnkPath)',
    '  $sc.TargetPath = $env:ACM_TARGET_EXE',
    '  $sc.Arguments = "--remote-debugging-port=0"',
    '  $sc.WorkingDirectory = $env:ACM_WORKDIR',
    '  $sc.WindowStyle = 1',
    '  $sc.Description = "Launch Antigravity with CDP remote debugging enabled (zero-patch)"',
    '  if ($iconLoc) { $sc.IconLocation = $iconLoc }',
    '  $sc.Save()',
    '}',
].join('\n');

function generateMacOsBadgedIcon(srcIcnsPath: string, destIcnsPath: string, options: Record<string, any> = {}): boolean {
    if (process.platform !== 'darwin' && typeof options.execFileSyncFn !== 'function') {
        return false;
    }
    const runner = createLauncherRunner(options.execFileSyncFn);
    const env = options.env || process.env;
    let tmpDir: string | null = null;
    try {
        tmpDir = mkdtempSync(join(tmpdir(), 'acm-mac-icon-'));
        const basePng = join(tmpDir, 'base.png');
        const badgedPng = join(tmpDir, 'badged.png');
        const iconsetDir = join(tmpDir, 'icon.iconset');

        runner('sips', ['-s', 'format', 'png', '-z', '1024', '1024', srcIcnsPath, '--out', basePng], {
            env,
            stdio: 'pipe',
            timeout: 5_000,
        });
        runner('osascript', ['-l', 'JavaScript', '-e', MACOS_ICON_BADGE_JXA], {
            env: { ...env, ACM_SRC_PNG: basePng, ACM_DST_PNG: badgedPng },
            stdio: 'pipe',
            timeout: 8_000,
        });

        mkdirSync(iconsetDir, { recursive: true });
        const iconsetSizes: Array<[string, number]> = [
            ['icon_16x16.png', 16],
            ['icon_16x16@2x.png', 32],
            ['icon_32x32.png', 32],
            ['icon_32x32@2x.png', 64],
            ['icon_128x128.png', 128],
            ['icon_128x128@2x.png', 256],
            ['icon_256x256.png', 256],
            ['icon_256x256@2x.png', 512],
            ['icon_512x512.png', 512],
            ['icon_512x512@2x.png', 1024],
        ];
        for (const [filename, px] of iconsetSizes) {
            const outPng = join(iconsetDir, filename);
            if (px === 1024 && existsSync(badgedPng)) {
                copyFileSync(badgedPng, outPng);
            } else {
                runner('sips', ['-z', String(px), String(px), badgedPng, '--out', outPng], {
                    env,
                    stdio: 'pipe',
                    timeout: 5_000,
                });
            }
        }
        runner('iconutil', ['-c', 'icns', iconsetDir, '-o', destIcnsPath], {
            env,
            stdio: 'pipe',
            timeout: 5_000,
        });
        return existsSync(destIcnsPath) && statSync(destIcnsPath).size > 0;
    } catch {
        return false;
    } finally {
        if (tmpDir) {
            try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }
}

function writeMacOsBundleAt(appDir: string, targetAppPath: string, options: Record<string, any> = {}): void {
    assertSafeMacOsBundleWriteTarget(appDir);
    const contentsDir = join(appDir, 'Contents');
    const macOsDir = join(contentsDir, 'MacOS');
    const resourcesDir = join(contentsDir, 'Resources');
    mkdirSync(macOsDir, { recursive: true });
    mkdirSync(resourcesDir, { recursive: true });
    writeFileSync(join(contentsDir, 'Info.plist'), buildMacOsInfoPlist(), 'utf8');
    const launchScriptPath = join(macOsDir, 'launch');
    writeFileSync(launchScriptPath, buildMacOsLauncherScript(targetAppPath), 'utf8');
    chmodSync(launchScriptPath, 0o755);

    if (targetAppPath) {
        const iconCandidates = [
            join(targetAppPath, 'Contents', 'Resources', 'icon.icns'),
            join(targetAppPath, 'Contents', 'Resources', 'Antigravity.icns'),
            join(targetAppPath, 'Contents', 'Resources', 'electron.icns'),
        ];
        const destIcns = join(resourcesDir, 'icon.icns');
        for (const iconSrc of iconCandidates) {
            if (!existsSync(iconSrc)) { continue; }
            if (generateMacOsBadgedIcon(iconSrc, destIcns, options)) {
                break;
            }
            try {
                copyFileSync(iconSrc, destIcns);
                break;
            } catch {
                // Best-effort icon copy fallback
            }
        }
    }

    try {
        const now = new Date();
        utimesSync(appDir, now, now);
    } catch {
        // Best-effort Finder icon cache refresh
    }
}

function findLinuxOriginalIcon(
    homeDir: string,
    targetAppPath: string | undefined,
    xdgDataHome: string | undefined,
): { mimeType: 'image/png' | 'image/svg+xml'; base64: string } | undefined {
    const candidates: string[] = [];
    if (targetAppPath && targetAppPath.includes('/')) {
        const binDir = dirname(targetAppPath);
        candidates.push(
            join(binDir, 'antigravity.png'),
            join(binDir, 'antigravity.svg'),
            join(binDir, 'icon.png'),
            join(binDir, 'resources', 'app', 'resources', 'linux', 'code.png'),
        );
    }
    if (xdgDataHome) {
        candidates.push(
            joinTargetPath('linux', xdgDataHome, 'icons', 'hicolor', 'scalable', 'apps', 'antigravity.svg'),
            joinTargetPath('linux', xdgDataHome, 'icons', 'hicolor', '256x256', 'apps', 'antigravity.png'),
        );
    }
    candidates.push(
        '/usr/share/pixmaps/antigravity.png',
        '/usr/share/pixmaps/antigravity.svg',
        '/usr/share/icons/hicolor/512x512/apps/antigravity.png',
        '/usr/share/icons/hicolor/256x256/apps/antigravity.png',
        '/usr/share/icons/hicolor/128x128/apps/antigravity.png',
        '/usr/share/icons/hicolor/scalable/apps/antigravity.svg',
        '/opt/Antigravity/antigravity.png',
        '/snap/antigravity/current/meta/gui/icon.png',
        '/snap/antigravity/current/meta/gui/icon.svg',
        joinTargetPath('linux', homeDir, '.local', 'share', 'icons', 'hicolor', 'scalable', 'apps', 'antigravity.svg'),
        joinTargetPath('linux', homeDir, '.local', 'share', 'icons', 'hicolor', '256x256', 'apps', 'antigravity.png'),
    );

    for (const candidate of candidates) {
        try {
            if (!existsSync(candidate)) { continue; }
            const st = statSync(candidate);
            if (!st.isFile() || st.size === 0 || st.size > MAX_EMBEDDED_ICON_BYTES) { continue; }
            const raw = readFileSync(candidate);
            const mimeType: 'image/png' | 'image/svg+xml' = candidate.toLowerCase().endsWith('.svg')
                ? 'image/svg+xml'
                : 'image/png';
            return { mimeType, base64: raw.toString('base64') };
        } catch {
            // Try next candidate
        }
    }
    return undefined;
}

function writeLinuxBadgedIcon(
    iconPath: string,
    homeDir: string,
    targetAppPath: string | undefined,
    xdgDataHome: string | undefined,
): boolean {
    try {
        mkdirSync(dirname(iconPath), { recursive: true });
        const embedded = findLinuxOriginalIcon(homeDir, targetAppPath, xdgDataHome);
        writeFileSync(iconPath, buildLinuxBadgedSvg(embedded), 'utf8');
        return true;
    } catch {
        return false;
    }
}

function runLinuxUpdateDesktopDatabase(applicationsDir: string, options: Record<string, any> = {}): void {
    if (process.platform !== 'linux' && typeof options.execFileSyncFn !== 'function') {
        return;
    }
    try {
        const runner = createLauncherRunner(options.execFileSyncFn);
        runner('update-desktop-database', [applicationsDir], {
            env: options.env || process.env,
            stdio: 'ignore',
            timeout: 5_000,
        });
    } catch {
        // Best-effort — update-desktop-database may not be installed on minimal systems
    }
}

export function inspectCdpLauncher(options: Record<string, any> = {}): {
    supported: boolean;
    platform: NodeJS.Platform;
    installed: boolean;
    launcherPath: string;
    displayName: string;
    targetAppFound: boolean;
    targetAppPath?: string;
    safeTerminalCommand: string;
} {
    const resolved = resolveCdpLauncherPaths(options);
    const safeTerminalCommand = getSafeCdpLaunchCommand(resolved.platform);
    let installed = false;
    let targetAppFound = false;

    if (resolved.platform === 'darwin') {
        const candidates = resolved.macCandidateAppDirs || (resolved.macAppDir ? [resolved.macAppDir] : []);
        installed = candidates.some((d) => isMacAppBundleInstalled(d));
        targetAppFound = Boolean(resolved.targetAppPath && existsSync(resolved.targetAppPath));
    } else if (resolved.platform === 'win32' && resolved.winDesktopLnkPath && resolved.winStartMenuLnkPath) {
        const hasDesktopLnk = existsSync(resolved.winDesktopLnkPath)
            || Boolean(
                resolved.winFallbackDesktopLnkPath
                && resolved.winFallbackDesktopLnkPath.toLowerCase() !== resolved.winDesktopLnkPath.toLowerCase()
                && existsSync(resolved.winFallbackDesktopLnkPath),
            );
        installed = hasDesktopLnk || existsSync(resolved.winStartMenuLnkPath);
        targetAppFound = Boolean(resolved.targetAppPath && existsSync(resolved.targetAppPath));
    } else if (resolved.platform === 'linux' && resolved.linuxDesktopEntryPath && resolved.linuxWrapperPath) {
        installed = existsSync(resolved.linuxDesktopEntryPath) && existsSync(resolved.linuxWrapperPath);
        const existsFn: (cmd: string) => boolean = options.commandExistsFn
            || ((cmd: string) => defaultCommandExists(cmd, options.env || process.env));
        if (resolved.targetAppPath && resolved.targetAppPath.startsWith('flatpak:')) {
            targetAppFound = existsFn('flatpak');
        } else if (resolved.targetAppPath && resolved.targetAppPath !== 'antigravity') {
            targetAppFound = existsSync(resolved.targetAppPath);
        } else {
            targetAppFound = existsFn('antigravity');
        }
    }

    return {
        supported: resolved.supported,
        platform: resolved.platform,
        installed,
        launcherPath: resolved.launcherPath,
        displayName: CDP_LAUNCHER_DISPLAY_NAME,
        targetAppFound,
        ...(resolved.targetAppPath ? { targetAppPath: resolved.targetAppPath } : {}),
        safeTerminalCommand,
    };
}

export function setupCdpLauncher(options: Record<string, any> = {}): Record<string, any> {
    const platform: NodeJS.Platform = options.platform || process.platform;
    const env: NodeJS.ProcessEnv = options.env || process.env;
    const homeDir = (options.homeDir && String(options.homeDir).trim()) || resolveUserHome(env, platform);
    const effectiveOptions = platform === 'win32'
        ? { ...options, desktopDir: resolveWindowsDesktopDir(options, homeDir, env, true) }
        : options;

    const resolved = resolveCdpLauncherPaths(effectiveOptions);
    const dryRun = Boolean(effectiveOptions.dryRun);

    if (!resolved.supported) {
        const status = inspectCdpLauncher(effectiveOptions);
        return {
            action: 'setup-cdp-launcher',
            ok: false,
            dryRun,
            launcherPath: resolved.launcherPath,
            platform: resolved.platform,
            status,
            error: `Unsupported platform: ${resolved.platform}`,
        };
    }

    if (dryRun) {
        const previewPath = resolved.platform === 'darwin' && resolved.macPreferredAppDir
            ? resolved.macPreferredAppDir
            : resolved.launcherPath;
        return {
            action: 'setup-cdp-launcher',
            ok: true,
            dryRun: true,
            launcherPath: previewPath,
            platform: resolved.platform,
            status: inspectCdpLauncher(
                resolved.winDesktopDir ? { ...effectiveOptions, desktopDir: resolved.winDesktopDir } : effectiveOptions,
            ),
        };
    }

    let createdMacDir: string | undefined;
    if (resolved.platform === 'darwin' && resolved.macPreferredAppDir) {
        const primaryDir = resolved.macPreferredAppDir;
        const fallbackDir = resolved.macUserAppDir || primaryDir;
        let createdDir = primaryDir;

        try {
            writeMacOsBundleAt(primaryDir, resolved.targetAppPath, effectiveOptions);
        } catch (err) {
            const code = err && typeof err === 'object' ? (err as NodeJS.ErrnoException).code : '';
            const isPermError = code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
            if (isPermError && normalizePosixComparable(primaryDir) !== normalizePosixComparable(fallbackDir)) {
                createdDir = fallbackDir;
                writeMacOsBundleAt(fallbackDir, resolved.targetAppPath, effectiveOptions);
            } else {
                throw err;
            }
        }
        createdMacDir = createdDir;

        const createdNorm = normalizePosixComparable(createdDir);
        for (const candidate of resolved.macCandidateAppDirs || []) {
            if (
                normalizePosixComparable(candidate) !== createdNorm
                && isOwnedMacCdpBundle(candidate)
            ) {
                try {
                    rmSync(candidate, { recursive: true, force: true });
                } catch {
                    // Best-effort stale copy cleanup
                }
            }
        }
    } else if (resolved.platform === 'win32' && resolved.winDesktopLnkPath && resolved.winStartMenuLnkPath) {
        if (resolved.winCmdPath && existsSync(resolved.winCmdPath)) {
            try {
                rmSync(resolved.winCmdPath, { force: true });
            } catch {
                // Best-effort legacy .cmd cleanup
            }
        }

        const runner = createLauncherRunner(effectiveOptions.execFileSyncFn);
        const targetExe = resolved.targetAppPath;
        runner(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SHORTCUT_PS_SCRIPT],
            {
                env: {
                    ...(effectiveOptions.env || process.env),
                    ACM_LNK_DESKTOP: resolved.winDesktopLnkPath,
                    ACM_LNK_STARTMENU: resolved.winStartMenuLnkPath,
                    ACM_TARGET_EXE: targetExe,
                    ACM_WORKDIR: dirnameTargetPath('win32', targetExe),
                    ACM_BADGE_ICON_PATH: resolved.winIconPath || '',
                },
                windowsHide: true,
                stdio: 'pipe',
                timeout: 15_000,
            },
        );

        if (
            resolved.winFallbackDesktopLnkPath
            && resolved.winFallbackDesktopLnkPath.toLowerCase() !== resolved.winDesktopLnkPath.toLowerCase()
            && existsSync(resolved.winDesktopLnkPath)
            && existsSync(resolved.winFallbackDesktopLnkPath)
        ) {
            try {
                rmSync(resolved.winFallbackDesktopLnkPath, { force: true });
            } catch {
                // Best-effort stale Desktop shortcut cleanup
            }
        }

        if (resolved.winCmdPath) {
            const dataDir = dirnameTargetPath('win32', resolved.winCmdPath);
            try {
                if (existsSync(dataDir) && readdirSync(dataDir).length === 0) {
                    rmdirSync(dataDir);
                }
            } catch { /* ignore */ }
        }
    } else if (resolved.platform === 'linux' && resolved.linuxWrapperPath && resolved.linuxDesktopEntryPath) {
        mkdirSync(dirname(resolved.linuxWrapperPath), { recursive: true });
        const applicationsDir = dirname(resolved.linuxDesktopEntryPath);
        mkdirSync(applicationsDir, { recursive: true });
        writeFileSync(resolved.linuxWrapperPath, buildLinuxLauncherScript(resolved.targetAppPath), 'utf8');
        if (process.platform !== 'win32') {
            chmodSync(resolved.linuxWrapperPath, 0o755);
        }
        const iconWritten = resolved.linuxIconPath
            ? writeLinuxBadgedIcon(
                resolved.linuxIconPath,
                resolved.homeDir,
                resolved.targetAppPath,
                resolved.linuxXdgDataHome,
            )
            : false;
        const iconValue = iconWritten && resolved.linuxIconPath ? resolved.linuxIconPath : 'antigravity';
        writeFileSync(resolved.linuxDesktopEntryPath, buildLinuxDesktopEntry(resolved.linuxWrapperPath, iconValue), 'utf8');
        runLinuxUpdateDesktopDatabase(applicationsDir, effectiveOptions);
    }

    const inspectOpts = createdMacDir
        ? { ...effectiveOptions, preferredMacAppDir: createdMacDir }
        : (resolved.winDesktopDir ? { ...effectiveOptions, desktopDir: resolved.winDesktopDir } : effectiveOptions);
    const status = inspectCdpLauncher(inspectOpts);
    return {
        action: 'setup-cdp-launcher',
        ok: true,
        dryRun: false,
        launcherPath: status.launcherPath,
        platform: status.platform,
        status,
    };
}

export function removeCdpLauncher(options: Record<string, any> = {}): Record<string, any> {
    const platform: NodeJS.Platform = options.platform || process.platform;
    const env: NodeJS.ProcessEnv = options.env || process.env;
    const homeDir = (options.homeDir && String(options.homeDir).trim()) || resolveUserHome(env, platform);
    const effectiveOptions = platform === 'win32'
        ? { ...options, desktopDir: resolveWindowsDesktopDir(options, homeDir, env, true) }
        : options;

    const resolved = resolveCdpLauncherPaths(effectiveOptions);
    const dryRun = Boolean(effectiveOptions.dryRun);
    const inspectOpts = resolved.winDesktopDir ? { ...effectiveOptions, desktopDir: resolved.winDesktopDir } : effectiveOptions;
    const before = inspectCdpLauncher(inspectOpts);

    if (!resolved.supported) {
        return {
            action: 'remove-cdp-launcher',
            ok: false,
            dryRun,
            existed: false,
            removed: false,
            launcherPath: resolved.launcherPath,
            platform: resolved.platform,
            status: before,
            error: `Unsupported platform: ${resolved.platform}`,
        };
    }

    let existed = before.installed;
    if (!dryRun) {
        if (resolved.platform === 'darwin') {
            const candidates = resolved.macCandidateAppDirs || (resolved.macAppDir ? [resolved.macAppDir] : []);
            for (const candidate of candidates) {
                if (isOwnedMacCdpBundle(candidate)) {
                    existed = true;
                    rmSync(candidate, { recursive: true, force: true });
                }
            }
        } else if (resolved.platform === 'win32') {
            const winTargets = [
                resolved.winDesktopLnkPath,
                resolved.winFallbackDesktopLnkPath,
                resolved.winStartMenuLnkPath,
                resolved.winIconPath,
                resolved.winCmdPath,
            ];
            for (const p of winTargets) {
                if (p && existsSync(p)) {
                    existed = true;
                    rmSync(p, { force: true });
                }
            }
            if (resolved.winCmdPath) {
                const dir = dirnameTargetPath('win32', resolved.winCmdPath);
                try {
                    if (existsSync(dir) && readdirSync(dir).length === 0) {
                        rmdirSync(dir);
                    }
                } catch { /* ignore */ }
            }
        } else if (resolved.platform === 'linux') {
            for (const p of [resolved.linuxDesktopEntryPath, resolved.linuxWrapperPath, resolved.linuxIconPath]) {
                if (p && existsSync(p)) {
                    existed = true;
                    rmSync(p, { force: true });
                }
            }
            if (resolved.linuxDesktopEntryPath) {
                runLinuxUpdateDesktopDatabase(dirname(resolved.linuxDesktopEntryPath), effectiveOptions);
            }
        }
    }

    const status = inspectCdpLauncher(inspectOpts);
    return {
        action: 'remove-cdp-launcher',
        ok: true,
        dryRun,
        existed,
        removed: existed && !dryRun && !status.installed,
        launcherPath: resolved.launcherPath,
        platform: resolved.platform,
        status,
    };
}

// ─── CDP Guide & Bilingual CLI Output ────────────────────────────────────────

export function formatCdpGuide(): string {
    const macSafeCmd = getSafeCdpLaunchCommand('darwin');
    return `
Antigravity Context Monitor — Optional CDP Launch Guide (Zero Binary Patching)
Antigravity Context Monitor — 可选 CDP 启动指南（零二进制 / 零 app.asar 修改）

NOTE: The core Context Monitor Sidecar (AUX_PANE + SIDEBAR) and Native Panel Compact HUD
work 100% natively without CDP. Only enable --remote-debugging-port=0 if you opt in to
ambient in-chrome overlays (Composer Ring & Top-Right Status Bar) on Antigravity Desktop 2.33+.
提示：核心 Context Monitor 侧栏/主视图与面板顶部紧凑 HUD 完全原生运行，无需 CDP。
仅当你主动开启 Antigravity 2.33+ 的对话框悬浮环与右上角常驻状态栏时，才需要附带 --remote-debugging-port=0 启动。

RECOMMENDED — 1-Command Persistent Launcher (Zero Terminal After Setup, Auto-Update Proof)
推荐 — 一键创建持久化启动器（创建后无需终端，自动更新后依然有效，零二进制修改）：
  Create / 创建: node scripts/install-app-plugin.mjs --setup-cdp-launcher
  Remove / 移除: node scripts/install-app-plugin.mjs --remove-cdp-launcher
  - macOS  : /Applications/Antigravity (CDP).app (fallback ~/Applications/Antigravity (CDP).app; CDP-badged icon; waits for 5s Cmd+Q teardown!)
  - Windows: Direct Desktop (OneDrive-aware) & Start Menu "Antigravity (CDP).lnk" -> Antigravity.exe --remote-debugging-port=0 (CDP-badged icon, native Pin to Taskbar, zero CMD flash)
  - Linux  : ~/.local/share/applications/antigravity-cdp.desktop + ~/.local/bin/antigravity-cdp + ~/.local/share/icons/hicolor/scalable/apps/antigravity-cdp.svg

IMPORTANT / 重要提示 (Dock / Taskbar Pinning Pitfall & macOS 5-Second Teardown):
  - macOS Dock: Drag "Antigravity (CDP).app" from Finder into your Dock. NEVER right-click
    the running Antigravity Dock icon and choose "Keep in Dock" — that pins argless Antigravity.app!
    macOS 程序坞：请直接从访达将「Antigravity (CDP).app」拖入程序坞；切勿右键运行中的图标选「在程序坞中保留」（否则固定的是无参原版 Antigravity.app）！
  - Windows Taskbar: Right-click the "Antigravity (CDP)" shortcut -> "Pin to taskbar" (avoid pinning the running taskbar icon).
    Windows 任务栏：请右键「Antigravity (CDP)」快捷方式选「固定到任务栏」（勿直接右键运行中的任务栏图标固定）。
  - Ubuntu / Linux Dock: Search "Antigravity (CDP)" in Show Apps / Application Launcher -> "Pin to Dash" / "Add to Favorites" (avoid pinning the running Dock window icon).
    Ubuntu 停靠栏：请在「显示应用」中搜索「Antigravity (CDP)」并选「固定到停靠栏 / 添加到收藏夹」（勿右键运行中的窗口图标固定）。
  - macOS 5-Second Background Teardown / macOS 5 秒后台退出陷阱:
    Always quit Antigravity App COMPLETELY first before relaunching with --remote-debugging-port=0.
    On macOS, pressing Cmd+Q closes all windows immediately, but Antigravity stays alive in the background
    for up to ~5 seconds while terminating language_server. Running "open -a" during those 5 seconds
    silently ignores --args! Wait until the Dock indicator dot disappears, or use the race-free command below.
    请务必先完全退出 Antigravity App 再重启：macOS 按 Cmd+Q 后窗口会立刻消失，但后台仍需约 5 秒清理 language_server；
    在此 5 秒内运行 open -a 会静默丢弃 --args。请等待程序坞指示灯彻底消失，或直接使用下方防竞态等待命令。

[macOS]
  1. Recommended persistent Dock/Spotlight launcher (zero binary patching, survives auto-updates):
       node scripts/install-app-plugin.mjs --setup-cdp-launcher
     (Drag Antigravity (CDP).app from Finder into the Dock — do NOT right-click running icon -> Keep in Dock!)
  2. Manual race-free Terminal command (after Cmd+Q, automatically waits for the 5s background exit):
       ${macSafeCmd}

[Windows]
  1. Recommended persistent Desktop & Start Menu direct shortcuts (OneDrive-aware, zero binary patching):
       node scripts/install-app-plugin.mjs --setup-cdp-launcher
  2. Or close Antigravity Desktop completely (all windows & system tray icon), then launch:
     PowerShell:
       & "$env:LOCALAPPDATA\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0
     CMD / Run dialog:
       "%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0

[Linux]
  1. Recommended persistent application menu / dock launcher (standard/Snap/Flatpak/AppImage aware, non-killing conflict dialog):
       node scripts/install-app-plugin.mjs --setup-cdp-launcher
  2. Or close Antigravity completely (all windows & tray icon), then launch from terminal:
       antigravity --remote-debugging-port=0
     Flatpak (sandboxed):
       flatpak run ${LINUX_FLATPAK_APP_ID} --remote-debugging-port=0
       (Note: Flatpak apps run inside a sandbox and only see explicitly granted directories; their
       DevToolsActivePort lives under ~/.var/app/${LINUX_FLATPAK_APP_ID}/config/Antigravity/ —
       set AGY_BROWSER_ACTIVE_PORT_FILE if your host runtime cannot read that sandbox path.)

Auto-Update Note / 自动更新提示:
  Antigravity auto-updates restart the app without CLI flags. After an update, simply open
  "Antigravity (CDP)" (your persistent launcher) or quit completely and relaunch with
  --remote-debugging-port=0, then click Recheck CDP.
  Antigravity 自动更新重启后会丢弃命令行参数；更新后直接点击持久化启动器「Antigravity (CDP)」
  （或完全退出后按上述命令重启），再点击「重新检测」即可。

Verify CDP is active / 验证 CDP 状态:
  node scripts/install-app-plugin.mjs --status
`.trim();
}

function printHelp(): void {
    console.log(`Antigravity Context Monitor — App Plugin Installer & Upgrader
Antigravity Context Monitor — 应用插件安装与升级脚本

Usage:
  node scripts/install-app-plugin.mjs [mode] [options]

Modes:
  --install               Install from local build/dist (falls back to --from-github unless --no-remote-fallback)
  --from-github           Download & install latest (or --version <v>) release from GitHub Releases
  --upgrade               Upgrade to latest (or --version <v>) GitHub Release (atomic backup + swap)
  --status                Inspect installed version, buildId, config, sidecar, CDP, launcher, and IDE VSIX status
  --uninstall             Remove the installed App plugin directory
  --print-cdp-guide       Print zero-patch macOS / Windows / Linux --remote-debugging-port=0 guide
  --setup-cdp-launcher    Create a zero-patch persistent CDP launcher (macOS .app / Windows .lnk / Linux .desktop)
  --remove-cdp-launcher   Remove the zero-patch persistent CDP launcher

Options:
  --version <v>           Target GitHub release version (e.g. ${FALLBACK_APP_VERSION} or v${FALLBACK_APP_VERSION})
  --local-dir <dir>       Explicit local plugin directory containing plugin.json (never falls back to GitHub)
  --source <dir>          Alias for --local-dir
  --no-remote-fallback    Refuse silent fallback to GitHub Releases when local source is missing
  --target <dir>          Override install path (default: ~/.gemini/config/plugins/antigravity-context-monitor)
  --use-cli               Use \`agy plugin install\` / \`agy plugin uninstall\` when available
  --check-remote          With --status, check latest GitHub Release for updates
  --require-checksum      Require SHA256SUMS.txt verification (enabled by default; fail-closed)
  --allow-missing-checksum Explicitly allow installing when a release omits SHA256SUMS.txt
  --json                  Print machine-readable JSON output
  --dry-run               Preview actions without modifying files
  --repo <owner/repo>     Override GitHub repository slug
  -h, --help              Show this help message`);
}

function formatStatusText(status: Record<string, any>): string {
    const app = status.appPlugin;
    const sc = status.sidecar;
    const cdp = status.cdp;
    const launcher = status.cdpLauncher;
    const ide = status.ideVsix;
    const rem = status.remote;

    const buildIdSuffix = app.buildId ? ` [buildId=${app.buildId}]` : '';
    const runningBuildSuffix = sc.runningBuildId ? `, buildId=${sc.runningBuildId}` : '';

    const lines = [
        'Antigravity Context Monitor — Status / 运行状态',
        '',
        `App Plugin : ${app.installed ? `Installed v${app.version || 'unknown'}${buildIdSuffix}` : 'Not installed'}`,
        `  Path     : ${app.path}`,
        `  Runtime  : ${app.hasCompiledRuntime ? 'Bundled (ready)' : 'Missing compiled runtime'}`,
        `  Enabled  : ${app.enabled ? 'Yes' : 'No'} (config.json: ${app.configExists ? (app.enabledInConfig === null ? 'default-enabled' : String(app.enabledInConfig)) : 'absent'})`,
        `Sidecar    : ${sc.processActive ? `Running (PID ${sc.runningPid}, v${sc.runningVersion}${runningBuildSuffix}, 127.0.0.1:${sc.listeningPort})` : (sc.logExists ? `Idle / Not reachable (last port ${sc.listeningPort ?? 'none'})` : 'No sidecar log found')}`,
    ];
    if (sc.reloadRequired) {
        lines.push(`  Notice   : Installed v${app.version}${buildIdSuffix} differs from running sidecar v${sc.runningVersion}${runningBuildSuffix} — toggle plugin Off -> On in Customizations to reload.`);
    }
    lines.push(
        `CDP        : ${cdp.active ? `Active (port ${cdp.port})` : (cdp.stale ? `Inactive — stale DevToolsActivePort (port ${cdp.port ?? 'invalid'} unreachable; quit & relaunch with --remote-debugging-port=0)` : 'Inactive (not required for core Sidecar UI)')}`,
        `CDP Launch : ${launcher?.installed ? `Installed (${launcher.path})` : (launcher?.supported ? `Not created (run --setup-cdp-launcher -> ${launcher.path})` : `Unsupported (${launcher?.platform || process.platform})`)}`,
        `IDE VSIX   : ${ide.installed ? ide.installations.map((i: { editor: string; version: string }) => `${i.editor} v${i.version}`).join(', ') : 'Not detected'}`,
    );
    if (rem.checked) {
        if (rem.error) {
            lines.push(`Remote     : Check failed (${rem.error})`);
        } else {
            lines.push(`Remote     : Latest v${rem.latestVersion || 'unknown'} (${rem.updateAvailable ? 'Update available' : 'Up to date'})`);
        }
    }
    return lines.join('\n');
}

function printCliResult(result: Record<string, any>, asJson: boolean): void {
    if (asJson) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    if (result.action === 'print-cdp-guide') {
        console.log(result.guide);
        return;
    }

    if (result.action === 'setup-cdp-launcher') {
        if (!result.ok) {
            console.error(`Failed to create persistent CDP launcher: ${result.error || 'unknown error'}`);
            return;
        }
        if (result.dryRun) {
            console.log(`[dry-run] Would create persistent CDP launcher (${result.platform}): ${result.launcherPath}`);
            return;
        }
        const pinTip = result.platform === 'darwin'
            ? '\n  Dock Tip / 程序坞提示: Drag "Antigravity (CDP).app" from Finder into your Dock — NEVER right-click the running icon to choose "Keep in Dock".\n  请从访达将「Antigravity (CDP).app」拖入程序坞固定，切勿右键运行中图标选「在程序坞中保留」。'
            : (result.platform === 'win32'
                ? '\n  Taskbar Tip / 任务栏提示: Right-click "Antigravity (CDP)" shortcut -> Pin to taskbar (avoid pinning the running taskbar icon directly).'
                : (result.platform === 'linux'
                    ? '\n  Dock Tip / 停靠栏提示: Pin "Antigravity (CDP)" from Show Apps / Application Launcher (avoid pinning the running Dock window icon).'
                    : ''));
        console.log(`✓ Created zero-patch persistent CDP launcher (${result.platform}):\n  ${result.launcherPath}\n已创建零侵入持久化 CDP 启动器。${pinTip}`);
        return;
    }

    if (result.action === 'remove-cdp-launcher') {
        if (!result.ok) {
            console.error(`Failed to remove persistent CDP launcher: ${result.error || 'unknown error'}`);
            return;
        }
        console.log(result.dryRun
            ? `[dry-run] Would remove persistent CDP launcher: ${result.launcherPath}`
            : (result.existed
                ? `Removed persistent CDP launcher:\n  ${result.launcherPath}\n已移除持久化 CDP 启动器。`
                : `Persistent CDP launcher was not installed:\n  ${result.launcherPath}\n未检测到已安装的持久化 CDP 启动器。`));
        return;
    }

    if (result.action === 'status') {
        console.log(formatStatusText(result));
        return;
    }

    if (result.action === 'uninstall') {
        console.log(result.dryRun
            ? `[dry-run] Would remove: ${result.targetDir}`
            : (result.existed
                ? `Uninstalled Antigravity Context Monitor plugin from:\n  ${result.targetDir}\n已卸载 Antigravity Context Monitor 插件。`
                : `Plugin was not installed at:\n  ${result.targetDir}\n未在目标目录发现已安装的插件。`));
        return;
    }

    if (result.dryRun) {
        console.log(`[dry-run] Would install v${result.version} (${result.sourceMode}):`);
        console.log(`  Source: ${result.zipUrl || result.sourceDir}`);
        console.log(`  Target: ${result.targetDir}`);
        return;
    }

    const checksumNote = result.sourceMode === 'github'
        ? `\n  SHA-256: ${result.sha256} (${result.checksumVerified ? 'verified via SHA256SUMS.txt' : result.checksumStatus})`
        : '';
    const buildNote = result.buildId ? `\n  BuildId: ${result.buildId}` : '';
    const upgradeNote = result.previousVersion && result.previousVersion !== result.version
        ? ` (upgraded from v${result.previousVersion})`
        : '';

    console.log(`
✓ Installed Antigravity Context Monitor App Plugin (v${result.version})${upgradeNote}
  Path: ${result.targetDir}
  Method: ${result.installMethod}${buildNote}${checksumNote}

Next steps (English):
  1. In Antigravity App, open Customizations > Installed (or click:
     customization://antigravity-context-monitor) and confirm the plugin & Context Monitor sidecar are enabled.
  2. Open the monitor from the side panel '+' menu (AUX_PANE), from Plugins in the left sidebar (SIDEBAR),
     or by asking the agent to open Context Monitor (sidecar://antigravity-context-monitor/context_monitor/).
  3. Upgrading an existing install? Do NOT force-quit an active agent session — toggle the plugin Off -> On
     in Customizations (or restart Antigravity App when convenient) so the sidecar loads v${result.version}.

后续步骤（中文）：
  1. 在 Antigravity App 中打开「自定义 > 已安装」（或访问 customization://antigravity-context-monitor），
     确认插件及 Context Monitor Sidecar 已启用。
  2. 可通过侧边栏「+」菜单（AUX_PANE）、左侧导航「Plugins」（SIDEBAR 宽屏视图）
     或对话中点击 sidecar://antigravity-context-monitor/context_monitor/ 打开监控面板。
  3. 若为覆盖升级，切勿在对话期间强杀 Antigravity 主进程——请在自定义页面关闭再重新开启插件
     （或在方便时重启 Antigravity App）以加载 v${result.version} 新运行时。
`.trim());
}

if (isDirectExecution()) {
    (async () => {
        try {
            const opts = parseInstallerArgs(process.argv.slice(2));
            if (opts.help) {
                printHelp();
                process.exit(0);
            }
            const result = await runInstallerAsync(opts);
            printCliResult(result, opts.json);
            if (result && result.ok === false) {
                process.exitCode = 1;
            }
        } catch (err) {
            console.error(`[install-app-plugin] ERROR: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    })();
}

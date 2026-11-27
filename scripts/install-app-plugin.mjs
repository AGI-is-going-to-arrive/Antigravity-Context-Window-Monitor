#!/usr/bin/env node
/**
 * Cross-platform installer, upgrader, status inspector & uninstaller
 * for the Antigravity Context Monitor App Sidecar plugin.
 *
 * Pure Node.js built-ins only — zero external npm dependencies.
 * Works with system `node`, Antigravity's bundled `agy-node`, or Electron
 * `ELECTRON_RUN_AS_NODE=1` across macOS, Windows, and Linux.
 *
 * Usage:
 *   node scripts/install-app-plugin.mjs [options]
 *
 * Modes:
 *   --install               Install from local dist/build (auto-falls back to --from-github if missing)
 *   --from-github           Download & install latest (or --version <v>) release from GitHub Releases
 *   --upgrade               Upgrade to latest (or --version <v>) GitHub Release (atomic backup + swap)
 *   --status                Show installed App plugin, config, sidecar, CDP, launcher, and IDE VSIX status
 *   --uninstall             Remove the installed App plugin directory
 *   --print-cdp-guide       Print zero-patch macOS/Windows/Linux --remote-debugging-port=0 guide
 *   --setup-cdp-launcher    Create a zero-patch persistent CDP launcher (macOS .app / Windows .lnk / Linux .desktop)
 *   --remove-cdp-launcher   Remove the zero-patch persistent CDP launcher
 *
 * Options:
 *   --version <v>        Specific release version (e.g. 1.17.11 or v1.17.11)
 *   --source <dir>       Explicit local plugin directory containing plugin.json
 *   --target <dir>       Override install path (default: ~/.gemini/config/plugins/antigravity-context-monitor)
 *   --use-cli            Use `agy plugin install` / `agy plugin uninstall` when available
 *   --check-remote       With --status, also check latest GitHub Release version
 *   --json               Emit machine-readable JSON output
 *   --dry-run            Preview actions without modifying the filesystem
 *   --repo <owner/repo>  Override GitHub repo (default: AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor)
 *   -h, --help           Show help
 */

import { execFileSync } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
    accessSync,
    chmodSync,
    constants as fsConstants,
    copyFileSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmdirSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { homedir, tmpdir, userInfo } from 'node:os';
import { basename, delimiter, dirname, join, resolve, sep, win32 as win32Path } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const PLUGIN_DIR_NAME = 'antigravity-context-monitor';
export const DEFAULT_GITHUB_REPO = 'AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor';
export const IDE_EXTENSION_ID_PREFIX = 'agi-is-going-to-arrive.antigravity-context-monitor-';

export const ALLOWED_DOWNLOAD_HOSTS = new Set([
    'github.com',
    'api.github.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
]);

const MAX_REDIRECTS = 5;
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_FILES = 2000;
const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024;
const USER_AGENT = 'Antigravity-Context-Monitor-Installer/1.0';

// ─── Cross-Platform Path Helpers ─────────────────────────────────────────────

export function resolveUserHome(env = process.env, platform = process.platform) {
    if (platform === 'win32') {
        if (env.USERPROFILE && env.USERPROFILE.trim()) { return env.USERPROFILE.trim(); }
        if (env.HOMEDRIVE && env.HOMEPATH) { return `${env.HOMEDRIVE}${env.HOMEPATH}`; }
    } else if (env.HOME && env.HOME.trim()) {
        return env.HOME.trim();
    }
    return homedir();
}

export function getDefaultTargetDir(env = process.env, platform = process.platform) {
    return join(resolveUserHome(env, platform), '.gemini', 'config', 'plugins', PLUGIN_DIR_NAME);
}

export function getDefaultConfigPath(env = process.env, platform = process.platform) {
    return join(resolveUserHome(env, platform), '.gemini', 'config', 'config.json');
}

export function getSidecarLogPath(env = process.env, platform = process.platform) {
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

export function getAntigravityUserDataDir(env = process.env, platform = process.platform) {
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
    const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim()
        ? env.XDG_CONFIG_HOME.trim()
        : join(home, '.config');
    return join(xdg, 'Antigravity');
}

export function getDevToolsActivePortPath(env = process.env, platform = process.platform) {
    if (env.AGY_BROWSER_ACTIVE_PORT_FILE && env.AGY_BROWSER_ACTIVE_PORT_FILE.trim()) {
        return env.AGY_BROWSER_ACTIVE_PORT_FILE.trim();
    }
    return join(getAntigravityUserDataDir(env, platform), 'DevToolsActivePort');
}

export function getIdeExtensionDirs(env = process.env, platform = process.platform) {
    const home = resolveUserHome(env, platform);
    return [
        { editor: 'Antigravity IDE', dir: join(home, '.antigravity-ide', 'extensions') },
        { editor: 'Antigravity', dir: join(home, '.antigravity', 'extensions') },
        { editor: 'VS Code', dir: join(home, '.vscode', 'extensions') },
    ];
}

// ─── Argument Parsing & Validation ───────────────────────────────────────────

export function normalizeVersionArg(raw) {
    const cleaned = String(raw || '').trim().replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(cleaned)) {
        throw new Error(`Invalid --version value "${raw}". Expected semver like 1.17.11 or v1.17.11.`);
    }
    return cleaned;
}

export function validateRepoSlug(raw) {
    const trimmed = String(raw || '').trim();
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
        throw new Error(`Invalid --repo value "${raw}". Expected owner/name.`);
    }
    return trimmed;
}

export function parseInstallerArgs(argv) {
    const opts = {
        action: 'install',
        source: null,
        target: null,
        version: null,
        repo: DEFAULT_GITHUB_REPO,
        useCli: false,
        checkRemote: false,
        json: false,
        dryRun: false,
        help: false,
        requireChecksum: false,
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
        } else if (arg === '--no-remote-fallback') {
            opts.noRemoteFallback = true;
        } else if (arg === '--help' || arg === '-h') {
            opts.help = true;
        } else if (arg === '--source' && i + 1 < argv.length) {
            opts.source = resolve(argv[++i]);
        } else if (arg.startsWith('--source=')) {
            opts.source = resolve(arg.slice('--source='.length));
        } else if (arg === '--target' && i + 1 < argv.length) {
            opts.target = resolve(argv[++i]);
        } else if (arg.startsWith('--target=')) {
            opts.target = resolve(arg.slice('--target='.length));
        } else if (arg === '--version' && i + 1 < argv.length) {
            opts.version = normalizeVersionArg(argv[++i]);
        } else if (arg.startsWith('--version=')) {
            opts.version = normalizeVersionArg(arg.slice('--version='.length));
        } else if (arg === '--repo' && i + 1 < argv.length) {
            opts.repo = validateRepoSlug(argv[++i]);
        } else if (arg.startsWith('--repo=')) {
            opts.repo = validateRepoSlug(arg.slice('--repo='.length));
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }
    return opts;
}

// ─── Semver Comparison ───────────────────────────────────────────────────────

function parseSemverParts(raw) {
    const cleaned = String(raw || '').trim().replace(/^v/i, '');
    const m = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
    if (!m) { return null; }
    return {
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3]),
        pre: m[4] || '',
    };
}

export function compareSemver(a, b) {
    const pa = parseSemverParts(a);
    const pb = parseSemverParts(b);
    if (!pa || !pb) { return 0; }
    if (pa.major !== pb.major) { return pa.major > pb.major ? 1 : -1; }
    if (pa.minor !== pb.minor) { return pa.minor > pb.minor ? 1 : -1; }
    if (pa.patch !== pb.patch) { return pa.patch > pb.patch ? 1 : -1; }
    if (pa.pre === pb.pre) { return 0; }
    if (!pa.pre) { return 1; }
    if (!pb.pre) { return -1; }
    return pa.pre > pb.pre ? 1 : -1;
}

// ─── Strict HTTPS Host Allowlist & Fetcher ───────────────────────────────────

export function assertAllowedDownloadUrl(rawUrl) {
    let parsed;
    try {
        parsed = new URL(String(rawUrl));
    } catch {
        throw new Error(`Invalid download URL: ${rawUrl}`);
    }
    if (parsed.protocol !== 'https:') {
        throw new Error(`Refusing non-HTTPS URL (protocol "${parsed.protocol}"): ${rawUrl}`);
    }
    if (parsed.username || parsed.password) {
        throw new Error(`Refusing URL with embedded credentials: ${parsed.origin}${parsed.pathname}`);
    }
    if (parsed.port && parsed.port !== '443') {
        throw new Error(`Refusing non-443 HTTPS port "${parsed.port}": ${rawUrl}`);
    }
    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_DOWNLOAD_HOSTS.has(host)) {
        throw new Error(`Refusing download host "${host}" (not in GitHub HTTPS allowlist).`);
    }
    return parsed;
}

function defaultHttpsGet(urlObj, headers, timeoutMs, maxBytes) {
    return new Promise((resolvePromise, rejectPromise) => {
        const req = https.request({
            protocol: urlObj.protocol,
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers,
        }, (res) => {
            const statusCode = res.statusCode || 0;
            if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
                res.resume();
                resolvePromise({
                    statusCode,
                    headers: res.headers,
                    buffer: Buffer.alloc(0),
                });
                return;
            }
            const chunks = [];
            let total = 0;
            res.on('data', (chunk) => {
                const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                total += buf.length;
                if (total > maxBytes) {
                    req.destroy(new Error(`Response exceeded max allowed size (${maxBytes} bytes).`));
                    return;
                }
                chunks.push(buf);
            });
            res.on('end', () => {
                resolvePromise({
                    statusCode,
                    headers: res.headers,
                    buffer: Buffer.concat(chunks),
                });
            });
            res.on('error', rejectPromise);
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`HTTPS request timed out after ${timeoutMs}ms: ${urlObj.hostname}${urlObj.pathname}`));
        });
        req.on('error', rejectPromise);
        req.end();
    });
}

export async function fetchBufferWithAllowlist(rawUrl, options = {}) {
    const maxRedirects = Number.isInteger(options.maxRedirects) ? options.maxRedirects : MAX_REDIRECTS;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_HTTP_TIMEOUT_MS;
    const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_DOWNLOAD_BYTES;
    const requestFn = options.requestFn || defaultHttpsGet;

    let currentUrl = assertAllowedDownloadUrl(rawUrl);
    for (let hop = 0; hop <= maxRedirects; hop++) {
        const isApi = currentUrl.hostname.toLowerCase() === 'api.github.com';
        const headers = {
            'User-Agent': USER_AGENT,
            'Accept': isApi ? 'application/vnd.github+json' : 'application/octet-stream',
            ...(isApi ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}),
            ...(options.headers || {}),
        };

        const res = await requestFn(currentUrl, headers, timeoutMs, maxBytes);
        const statusCode = res.statusCode || 0;
        const location = res.headers?.location || res.headers?.Location;

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

// ─── SHA-256 Checksum Parsing & Verification ─────────────────────────────────

export function computeSha256Hex(buf) {
    return createHash('sha256').update(buf).digest('hex');
}

export function parseSha256Sums(text) {
    const map = new Map();
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) { continue; }
        const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/);
        if (!match) { continue; }
        const hex = match[1].toLowerCase();
        const fileRef = match[2].replace(/\\/g, '/').replace(/^\.\//, '');
        map.set(fileRef, hex);
        map.set(basename(fileRef), hex);
    }
    return map;
}

export function verifyBufferSha256(buffer, expectedHex, label = 'download') {
    const normalizedExpected = String(expectedHex || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalizedExpected)) {
        throw new Error(`Invalid expected SHA-256 checksum for ${label}: "${expectedHex}"`);
    }
    const actualHex = computeSha256Hex(buffer);
    const a = Buffer.from(actualHex, 'hex');
    const b = Buffer.from(normalizedExpected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new Error(
            `SHA-256 checksum mismatch for ${label}: expected ${normalizedExpected}, got ${actualHex}`,
        );
    }
    return actualHex;
}

// ─── Pure-Node Safe PKZIP Extractor (Zip-Slip & Symlink Protected) ───────────

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

function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

export function assertSafeArchiveEntryPath(rawEntryName, destDir) {
    if (typeof rawEntryName !== 'string' || rawEntryName.length === 0) {
        throw new Error('Archive contains an empty entry path.');
    }
    if (rawEntryName.includes('\0')) {
        throw new Error(`Refusing archive entry containing NUL byte: ${JSON.stringify(rawEntryName)}`);
    }
    if (/^[A-Za-z]:/.test(rawEntryName) || rawEntryName.startsWith('\\\\') || rawEntryName.startsWith('//')) {
        throw new Error(`Refusing archive entry with absolute/drive path: ${rawEntryName}`);
    }
    const normalized = rawEntryName.replace(/\\/g, '/');
    if (normalized.startsWith('/')) {
        throw new Error(`Refusing absolute archive entry path: ${rawEntryName}`);
    }
    const isDirectory = normalized.endsWith('/');
    const rawSegments = normalized.split('/');
    const safeSegments = [];
    for (const seg of rawSegments) {
        if (seg === '') { continue; }
        if (seg === '.' || seg === '..') {
            throw new Error(`Refusing archive entry with path traversal segment ("${seg}"): ${rawEntryName}`);
        }
        if (/^[A-Za-z]:/.test(seg)) {
            throw new Error(`Refusing archive entry with drive prefix segment: ${rawEntryName}`);
        }
        safeSegments.push(seg);
    }
    if (safeSegments.length === 0) {
        if (isDirectory) {
            return { targetPath: resolve(destDir), isDirectory: true, segments: [] };
        }
        throw new Error(`Refusing empty normalized archive entry path: ${rawEntryName}`);
    }
    const resolvedDest = resolve(destDir);
    const targetPath = resolve(resolvedDest, ...safeSegments);
    if (targetPath !== resolvedDest && !targetPath.startsWith(resolvedDest + sep)) {
        throw new Error(`Refusing zip-slip entry escaping target directory: ${rawEntryName}`);
    }
    return { targetPath, isDirectory, segments: safeSegments };
}

function findZipEocdOffset(buf) {
    if (buf.length < 22) {
        throw new Error('Invalid ZIP archive: file too small.');
    }
    const minOffset = Math.max(0, buf.length - 65557);
    for (let pos = buf.length - 22; pos >= minOffset; pos--) {
        if (buf.readUInt32LE(pos) === 0x06054b50) {
            const commentLen = buf.readUInt16LE(pos + 20);
            if (pos + 22 + commentLen === buf.length) {
                return pos;
            }
        }
    }
    throw new Error('Invalid ZIP archive: End of Central Directory record not found.');
}

export function extractZipBufferSafely(zipBuffer, destDir, options = {}) {
    const buf = Buffer.isBuffer(zipBuffer) ? zipBuffer : Buffer.from(zipBuffer);
    const maxFiles = options.maxFiles || MAX_EXTRACTED_FILES;
    const maxBytes = options.maxBytes || MAX_EXTRACTED_BYTES;

    const eocdOffset = findZipEocdOffset(buf);
    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const centralDirSize = buf.readUInt32LE(eocdOffset + 12);
    const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

    if (totalEntries > maxFiles) {
        throw new Error(`Archive contains too many entries (${totalEntries} > ${maxFiles}).`);
    }
    if (centralDirOffset + centralDirSize > eocdOffset) {
        throw new Error('Invalid ZIP archive: Central Directory extends past EOCD.');
    }

    mkdirSync(destDir, { recursive: true });

    let cursor = centralDirOffset;
    let extractedFiles = 0;
    let totalBytes = 0;

    for (let idx = 0; idx < totalEntries; idx++) {
        if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== 0x02014b50) {
            throw new Error(`Invalid ZIP archive: malformed Central Directory header at entry ${idx}.`);
        }

        const versionMadeBy = buf.readUInt16LE(cursor + 4);
        const flags = buf.readUInt16LE(cursor + 8);
        const method = buf.readUInt16LE(cursor + 10);
        const expectedCrc = buf.readUInt32LE(cursor + 16);
        const compressedSize = buf.readUInt32LE(cursor + 20);
        const uncompressedSize = buf.readUInt32LE(cursor + 24);
        const fileNameLen = buf.readUInt16LE(cursor + 28);
        const extraLen = buf.readUInt16LE(cursor + 30);
        const commentLen = buf.readUInt16LE(cursor + 32);
        const externalAttrs = buf.readUInt32LE(cursor + 38);
        const localHeaderOffset = buf.readUInt32LE(cursor + 42);

        if ((flags & 0x0001) !== 0) {
            throw new Error('Encrypted ZIP entries are not supported.');
        }

        const nameStart = cursor + 46;
        const nameEnd = nameStart + fileNameLen;
        if (nameEnd + extraLen + commentLen > buf.length) {
            throw new Error(`Invalid ZIP archive: truncated Central Directory entry ${idx}.`);
        }
        const entryName = buf.toString('utf8', nameStart, nameEnd);
        cursor = nameEnd + extraLen + commentLen;

        // Check Unix file mode for symlinks unconditionally, and reject special files on Unix entries
        const hostOs = versionMadeBy >> 8;
        const unixMode = (externalAttrs >>> 16) & 0xffff;
        if ((unixMode & 0o170000) === 0o120000) {
            throw new Error(`Refusing symlink entry in archive: ${entryName}`);
        }
        if (hostOs === 3 && unixMode !== 0) {
            const fileType = unixMode & 0o170000;
            if (fileType !== 0 && fileType !== 0o100000 && fileType !== 0o040000) {
                throw new Error(`Refusing special file entry (mode 0o${unixMode.toString(8)}) in archive: ${entryName}`);
            }
        }

        const { targetPath, isDirectory } = assertSafeArchiveEntryPath(entryName, destDir);

        if (isDirectory || (hostOs === 3 && (unixMode & 0o170000) === 0o040000)) {
            mkdirSync(targetPath, { recursive: true });
            continue;
        }

        if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
            throw new Error(`Invalid ZIP archive: malformed Local File Header for "${entryName}".`);
        }
        const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > buf.length) {
            throw new Error(`Invalid ZIP archive: truncated payload for "${entryName}".`);
        }

        if (totalBytes + uncompressedSize > maxBytes) {
            throw new Error(`Archive exceeds maximum extracted byte limit (${maxBytes} bytes).`);
        }

        const compressedSlice = buf.subarray(dataStart, dataEnd);
        let fileData;
        if (method === 0) {
            fileData = compressedSlice;
        } else if (method === 8) {
            fileData = inflateRawSync(compressedSlice, {
                maxOutputLength: Math.max(uncompressedSize + 1024, maxBytes - totalBytes),
            });
        } else {
            throw new Error(`Unsupported ZIP compression method ${method} for "${entryName}".`);
        }

        if (fileData.length !== uncompressedSize) {
            throw new Error(`ZIP size mismatch for "${entryName}": expected ${uncompressedSize}, got ${fileData.length}`);
        }
        const actualCrc = crc32(fileData);
        if (actualCrc !== expectedCrc) {
            throw new Error(`ZIP CRC-32 mismatch for "${entryName}": expected 0x${expectedCrc.toString(16)}, got 0x${actualCrc.toString(16)}`);
        }

        totalBytes += fileData.length;
        if (totalBytes > maxBytes) {
            throw new Error(`Archive exceeds maximum extracted byte limit (${maxBytes} bytes).`);
        }

        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, fileData);
        if (process.platform !== 'win32' && hostOs === 3 && (unixMode & 0o111) !== 0) {
            try { chmodSync(targetPath, 0o755); } catch { /* ignore */ }
        }
        extractedFiles += 1;
    }

    // Locate extracted plugin root (either destDir directly or a single top-level directory)
    let pluginRoot = null;
    if (existsSync(join(destDir, 'plugin.json'))) {
        pluginRoot = destDir;
    } else if (existsSync(join(destDir, PLUGIN_DIR_NAME, 'plugin.json'))) {
        pluginRoot = join(destDir, PLUGIN_DIR_NAME);
    } else {
        const topDirs = readdirSync(destDir).filter((n) => {
            if (n === '__MACOSX' || n === '.DS_Store') { return false; }
            return statSync(join(destDir, n)).isDirectory();
        });
        if (topDirs.length === 1 && existsSync(join(destDir, topDirs[0], 'plugin.json'))) {
            pluginRoot = join(destDir, topDirs[0]);
        }
    }

    return { extractedFiles, totalBytes, pluginRoot };
}

// ─── Bundle Validation & Atomic Swap ─────────────────────────────────────────

export function readJsonNoBom(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

export function validatePluginBundle(bundleDir, options = {}) {
    const manifestPath = join(bundleDir, 'plugin.json');
    if (!existsSync(manifestPath)) {
        throw new Error(`Invalid plugin bundle (missing plugin.json): ${bundleDir}`);
    }
    let manifest;
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
    if (!/^\d+\.\d+\.\d+/.test(version)) {
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

function copyDirectoryRealFiles(srcDir, dstDir, filterFn) {
    mkdirSync(dstDir, { recursive: true });
    for (const name of readdirSync(srcDir)) {
        if (name === '.DS_Store' || name === 'Thumbs.db') { continue; }
        const srcPath = join(srcDir, name);
        const dstPath = join(dstDir, name);
        const st = statSync(srcPath);
        if (filterFn && !filterFn(srcPath, name, st)) { continue; }
        if (st.isDirectory()) {
            copyDirectoryRealFiles(srcPath, dstPath, filterFn);
        } else if (st.isFile()) {
            // dereference: true ensures real files are copied rather than dangling symlinks
            cpSync(srcPath, dstPath, { dereference: true });
        }
    }
}

function sleepSync(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // bounded short retry backoff for Windows file locks
    }
}

function renameWithRetry(fromPath, toPath, retries = 4) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            renameSync(fromPath, toPath);
            return;
        } catch (err) {
            lastErr = err;
            const code = err && typeof err === 'object' ? err.code : '';
            if (!['EPERM', 'EACCES', 'EBUSY'].includes(code) || attempt === retries) {
                throw err;
            }
            sleepSync(40 * (attempt + 1));
        }
    }
    throw lastErr;
}

/**
 * Atomically installs `sourceDir` into `targetDir` via sibling staging + backup + rollback.
 */
export function installPluginAtomic(sourceDir, targetDir, options = {}) {
    const parentDir = dirname(targetDir);
    mkdirSync(parentDir, { recursive: true });

    const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const stagingDir = join(parentDir, `.${basename(targetDir)}.staging-${stamp}`);
    const backupDir = join(parentDir, `.${basename(targetDir)}.bak-${stamp}`);

    let previousVersion = null;
    if (existsSync(join(targetDir, 'plugin.json'))) {
        try {
            previousVersion = String(readJsonNoBom(join(targetDir, 'plugin.json')).version || '').trim() || null;
        } catch {
            previousVersion = null;
        }
    }

    let backedUp = false;
    try {
        copyDirectoryRealFiles(sourceDir, stagingDir);

        if (options.needsRuntimeCopy) {
            const outSrc = options.outSrc;
            const imagesSrc = options.imagesSrc;
            const version = options.version;
            const runtimeDir = join(stagingDir, 'sidecars', 'context_monitor', 'runtime');
            copyDirectoryRealFiles(
                outSrc,
                join(runtimeDir, 'out'),
                (_p, name, st) => st.isDirectory() || (name.endsWith('.js') && !name.endsWith('.map')),
            );
            if (imagesSrc && existsSync(imagesSrc)) {
                copyDirectoryRealFiles(
                    imagesSrc,
                    join(runtimeDir, 'src', 'images'),
                    (_p, name, st) => st.isDirectory() || /^[a-z0-9-]+\.png$/.test(name),
                );
            }
            const runtimePkg = {
                name: 'antigravity-context-monitor-app-runtime',
                version,
                private: true,
                license: 'MIT',
            };
            writeFileSync(join(runtimeDir, 'package.json'), JSON.stringify(runtimePkg, null, 2) + '\n', 'utf8');
        }

        if (existsSync(targetDir)) {
            renameWithRetry(targetDir, backupDir);
            backedUp = true;
        }

        if (typeof options.onBeforeSwap === 'function') {
            options.onBeforeSwap({ stagingDir, targetDir, backupDir });
        }

        renameWithRetry(stagingDir, targetDir);

        if (backedUp) {
            try {
                rmSync(backupDir, { recursive: true, force: true });
            } catch {
                // Best-effort backup cleanup
            }
        }

        return { previousVersion, replaced: backedUp };
    } catch (err) {
        try { rmSync(stagingDir, { recursive: true, force: true }); } catch { /* ignore */ }
        if (backedUp && !existsSync(targetDir) && existsSync(backupDir)) {
            try { renameWithRetry(backupDir, targetDir); } catch { /* ignore */ }
        }
        throw err;
    }
}

// ─── `agy` CLI Integration & Safe Registration ───────────────────────────────

export function findAgyBinary(env = process.env, platform = process.platform) {
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
            execFileSync(bin, ['--version'], { stdio: 'ignore', windowsHide: true });
            return bin;
        } catch {
            // Try next
        }
    }
    return null;
}

function isPlainObject(val) {
    return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Ensures the plugin is registered & enabled cleanly without clobbering sibling
 * keys (`userSettings`, `sidecars`, permission grants, other plugins).
 *
 * Prefers official `agy plugin enable` when available; otherwise performs an
 * atomic preserve-all-keys update ONLY when `config.json` already exists.
 */
export function ensurePluginEnabled(options = {}) {
    const env = options.env || process.env;
    const platform = options.platform || process.platform;
    const configPath = options.configPath || getDefaultConfigPath(env, platform);
    const allowCli = options.allowCli !== false && !options.configPath;

    if (allowCli) {
        const agyBin = options.agyBinary !== undefined ? options.agyBinary : findAgyBinary(env, platform);
        if (agyBin) {
            try {
                execFileSync(agyBin, ['plugin', 'enable', PLUGIN_DIR_NAME], {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true,
                });
                return { updated: true, enabled: true, method: 'agy-cli', configPath };
            } catch {
                // Fall through to safe JSON check
            }
        }
    }

    if (!existsSync(configPath)) {
        // Antigravity enables plugins in ~/.gemini/config/plugins/ by default when not disabled in config.json.
        return { updated: false, enabled: true, method: 'default-enabled', configPath };
    }

    let parsed;
    try {
        parsed = readJsonNoBom(configPath);
    } catch {
        return { updated: false, enabled: null, method: 'skipped-invalid-config', configPath };
    }
    if (!isPlainObject(parsed)) {
        return { updated: false, enabled: null, method: 'skipped-invalid-config', configPath };
    }

    const existingPlugins = isPlainObject(parsed.plugins) ? parsed.plugins : {};
    const existingEntry = isPlainObject(existingPlugins[PLUGIN_DIR_NAME]) ? existingPlugins[PLUGIN_DIR_NAME] : {};
    if (existingEntry.enabled === true) {
        return { updated: false, enabled: true, method: 'already-enabled', configPath };
    }

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

    const tmpPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
    const serialized = JSON.stringify(nextConfig, null, 2) + '\n';
    writeFileSync(tmpPath, serialized, { encoding: 'utf8', mode: 0o600 });
    if (platform !== 'win32') {
        try { chmodSync(tmpPath, 0o600); } catch { /* ignore */ }
    }
    renameWithRetry(tmpPath, configPath);
    return { updated: true, enabled: true, method: 'config-atomic-merge', configPath };
}

function installViaAgyCli(stagedDir, env = process.env, platform = process.platform, agyBinOverride) {
    const agyBin = agyBinOverride || findAgyBinary(env, platform);
    if (!agyBin) {
        throw new Error('`--use-cli` requested, but `agy` CLI was not found on PATH or ~/.gemini/bin.');
    }
    const output = execFileSync(agyBin, ['plugin', 'install', stagedDir], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    return { agyBin, output: output.trim() };
}

// ─── GitHub Releases Fetch & Install ─────────────────────────────────────────

export async function fetchGitHubReleaseInfo(options = {}) {
    const repo = validateRepoSlug(options.repo || DEFAULT_GITHUB_REPO);
    const requestedVersion = options.version ? normalizeVersionArg(options.version) : null;
    const apiUrls = requestedVersion
        ? [
            `https://api.github.com/repos/${repo}/releases/tags/v${requestedVersion}`,
            `https://api.github.com/repos/${repo}/releases/tags/${requestedVersion}`,
        ]
        : [`https://api.github.com/repos/${repo}/releases/latest`];

    let release = null;
    let lastError = null;
    for (const apiUrl of apiUrls) {
        try {
            const res = await fetchBufferWithAllowlist(apiUrl, {
                requestFn: options.requestFn,
                timeoutMs: options.timeoutMs,
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
    const assets = Array.isArray(release.assets) ? release.assets : [];

    const exactZipName = version ? `antigravity-context-monitor-app-${version}.zip` : null;
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

export async function installFromGitHub(options = {}) {
    const env = options.env || process.env;
    const platform = options.platform || process.platform;
    const defaultTarget = getDefaultTargetDir(env, platform);
    const targetDir = options.target || defaultTarget;
    const isDefaultTarget = resolve(targetDir) === resolve(defaultTarget);
    const dryRun = Boolean(options.dryRun);

    const release = await fetchGitHubReleaseInfo({
        repo: options.repo,
        version: options.version,
        requestFn: options.requestFn,
        timeoutMs: options.timeoutMs,
    });

    if (!release.zipAsset || !release.zipAsset.url) {
        throw new Error(
            `Release ${release.tagName || release.version || 'latest'} does not contain an antigravity-context-monitor-app-*.zip asset.`,
        );
    }

    assertAllowedDownloadUrl(release.zipAsset.url);
    if (release.checksumAsset?.url) {
        assertAllowedDownloadUrl(release.checksumAsset.url);
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
    });
    const actualSha256 = computeSha256Hex(zipRes.buffer);

    let checksumVerified = false;
    let checksumStatus = 'not-published';
    if (release.checksumAsset?.url) {
        const sumRes = await fetchBufferWithAllowlist(release.checksumAsset.url, {
            requestFn: options.requestFn,
            timeoutMs: options.timeoutMs,
        });
        const sums = parseSha256Sums(sumRes.buffer.toString('utf8'));
        const expected = sums.get(release.zipAsset.name) || sums.get(basename(release.zipAsset.name));
        if (expected) {
            verifyBufferSha256(zipRes.buffer, expected, release.zipAsset.name);
            checksumVerified = true;
            checksumStatus = 'verified';
        } else {
            throw new Error(`SHA256SUMS.txt did not contain an entry for ${release.zipAsset.name}.`);
        }
    } else if (options.requireChecksum) {
        throw new Error(`Release ${release.tagName} did not publish SHA256SUMS.txt (--require-checksum set).`);
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

        let installMethod = 'atomic-swap';
        let previousVersion = null;
        let replaced = false;

        if (options.useCli && isDefaultTarget) {
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
        } else {
            const swap = installPluginAtomic(extracted.pluginRoot, targetDir, {
                onBeforeSwap: options.onBeforeSwap,
            });
            previousVersion = swap.previousVersion;
            replaced = swap.replaced;
        }

        let registration = { updated: false, enabled: null, method: 'skipped-custom-target' };
        if (isDefaultTarget || options.configPath) {
            registration = ensurePluginEnabled({
                env,
                platform,
                configPath: options.configPath,
                agyBinary: options.agyBinary,
            });
        }

        return {
            action: options.action || 'from-github',
            sourceMode: 'github',
            repo: release.repo,
            sourceDir: release.zipAsset.url,
            targetDir,
            version,
            previousVersion,
            replaced,
            dryRun: false,
            bundledRuntime: false,
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

function detectLocalSourceDir(explicitSource, repoRoot = REPO_ROOT) {
    if (explicitSource) {
        if (!existsSync(join(explicitSource, 'plugin.json'))) {
            throw new Error(`Invalid --source directory (missing plugin.json): ${explicitSource}`);
        }
        return {
            dir: explicitSource,
            needsRuntimeCopy: !existsSync(
                join(explicitSource, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'),
            ),
        };
    }
    const staged = join(repoRoot, 'dist', 'antigravity-context-monitor-app');
    if (
        existsSync(join(staged, 'plugin.json')) &&
        existsSync(join(staged, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'))
    ) {
        return { dir: staged, needsRuntimeCopy: false };
    }
    if (existsSync(join(__dirname, 'plugin.json'))) {
        return { dir: __dirname, needsRuntimeCopy: false };
    }
    const repoAppPlugin = join(repoRoot, 'app-plugin');
    if (
        existsSync(join(repoAppPlugin, 'plugin.json')) &&
        existsSync(join(repoRoot, 'out', 'app', 'sidecar-server.js'))
    ) {
        return { dir: repoAppPlugin, needsRuntimeCopy: true };
    }
    return null;
}

/**
 * Synchronous local installer/uninstaller (preserved for direct sync callers & tests).
 */
export function runInstaller(options = {}) {
    const env = options.env || process.env;
    const platform = options.platform || process.platform;
    const repoRoot = options.repoRoot || REPO_ROOT;
    const action = options.action || 'install';
    const defaultTarget = getDefaultTargetDir(env, platform);
    const targetDir = options.target || defaultTarget;
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
            if (options.useCli && isDefaultTarget) {
                const agyBin = options.agyBinary || findAgyBinary(env, platform);
                if (agyBin) {
                    execFileSync(agyBin, ['plugin', 'uninstall', PLUGIN_DIR_NAME], {
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'pipe'],
                        windowsHide: true,
                    });
                } else {
                    rmSync(targetDir, { recursive: true, force: true });
                }
            } else {
                rmSync(targetDir, { recursive: true, force: true });
            }
        }
        return {
            action: 'uninstall',
            targetDir,
            dryRun,
            existed,
            removed: existed && !dryRun,
        };
    }

    const detected = detectLocalSourceDir(options.source, repoRoot);
    if (!detected) {
        throw new Error(
            'Could not locate built plugin source directory (dist/antigravity-context-monitor-app or compiled out/app/sidecar-server.js). ' +
            'Run with `--from-github`, pass `--source <path>`, or run `npm run compile && node scripts/package-app-plugin.mjs`.',
        );
    }

    const { dir: sourceDir, needsRuntimeCopy } = detected;
    const outSrc = join(repoRoot, 'out');
    const imagesSrc = join(repoRoot, 'src', 'images');

    if (needsRuntimeCopy && !existsSync(join(outSrc, 'app', 'sidecar-server.js'))) {
        throw new Error(
            'Compiled runtime not found at out/app/sidecar-server.js. ' +
            'Run `npm run compile` (or `node scripts/package-app-plugin.mjs`) before installing.',
        );
    }

    const { version } = validatePluginBundle(sourceDir, { requireSidecarEntrypoints: false });

    let previousVersion = null;
    let replaced = false;
    let installMethod = 'atomic-swap';
    let registration = { updated: false, enabled: null, method: 'skipped' };

    if (!dryRun) {
        if (options.useCli && isDefaultTarget && !needsRuntimeCopy) {
            replaced = existsSync(targetDir);
            if (existsSync(join(targetDir, 'plugin.json'))) {
                try {
                    previousVersion = String(readJsonNoBom(join(targetDir, 'plugin.json')).version || '').trim() || null;
                } catch {
                    previousVersion = null;
                }
            }
            installViaAgyCli(sourceDir, env, platform, options.agyBinary);
            installMethod = 'agy-cli';
        } else {
            const swap = installPluginAtomic(sourceDir, targetDir, {
                needsRuntimeCopy,
                outSrc,
                imagesSrc,
                version,
                onBeforeSwap: options.onBeforeSwap,
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

    return {
        action,
        sourceMode: 'local',
        sourceDir,
        targetDir,
        version,
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

function probeLoopbackHealth(port, timeoutMs = 2000) {
    return new Promise((resolvePromise) => {
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
            resolvePromise(null);
            return;
        }
        let settled = false;
        const finish = (value) => {
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
            const chunks = [];
            res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
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

function parseLatestSidecarLogPort(logContent) {
    const matches = [...String(logContent || '').matchAll(/listening on (?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/gi)];
    if (matches.length === 0) { return null; }
    const port = Number(matches[matches.length - 1][1]);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function probeSingleLoopbackHost(host, port, timeoutMs) {
    return new Promise((resolvePromise) => {
        let settled = false;
        const finish = (result) => {
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
            finish({ ok: false, code: err && err.code ? String(err.code) : 'ERR' });
        });
    });
}

export async function probeLoopbackTcpPort(port, timeoutMs = 300) {
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

export async function inspectDevToolsActivePort(portFilePath, options = {}) {
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

function detectIdeExtensions(env, platform) {
    const installations = [];
    for (const { editor, dir } of getIdeExtensionDirs(env, platform)) {
        if (!existsSync(dir)) { continue; }
        let entries;
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

export async function collectStatus(options = {}) {
    const env = options.env || process.env;
    const platform = options.platform || process.platform;
    const targetDir = options.target || getDefaultTargetDir(env, platform);
    const configPath = options.configPath || getDefaultConfigPath(env, platform);
    const sidecarLogPath = options.sidecarLogPath || getSidecarLogPath(env, platform);
    const cdpPortFilePath = options.cdpPortFilePath || getDevToolsActivePortPath(env, platform);

    // 1. Installed App plugin
    let installed = false;
    let version = null;
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
    }

    // 2. config.json status
    const configExists = existsSync(configPath);
    let enabledInConfig = null;
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

    // 3. Sidecar log & live health check
    const logExists = existsSync(sidecarLogPath);
    let lastLogUpdate = null;
    let listeningPort = null;
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

    let health = null;
    if (listeningPort && options.probeHealth !== false) {
        const probeFn = options.probeHealthFn || probeLoopbackHealth;
        health = await probeFn(listeningPort);
    }
    const processActive = Boolean(health && health.ok);
    const runningVersion = health && typeof health.version === 'string' ? health.version : null;
    const runningPid = health && Number.isInteger(health.pid) ? health.pid : null;
    const reloadRequired = Boolean(processActive && runningVersion && version && runningVersion !== version);

    // 4. CDP & Persistent Launcher status
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

    // 5. IDE VSIX status
    const ideVsix = detectIdeExtensions(env, platform);

    // 6. Optional remote GitHub release check
    let remote = { checked: false, latestVersion: null, updateAvailable: false, releaseUrl: null, error: null };
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
            reloadRequired,
        },
        cdp,
        cdpLauncher,
        ideVsix,
        remote,
    };
}

// ─── Async Entry Orchestrator ────────────────────────────────────────────────

export async function runInstallerAsync(options = {}) {
    const action = options.action || 'install';
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
    if (action === 'upgrade') {
        if (options.source) {
            return runInstaller({ ...options, action: 'upgrade' });
        }
        return installFromGitHub({ ...options, action: 'upgrade' });
    }
    // action === 'install'
    const repoRoot = options.repoRoot || REPO_ROOT;
    const detected = detectLocalSourceDir(options.source, repoRoot);
    if (detected) {
        return runInstaller({ ...options, action: 'install' });
    }
    if (options.noRemoteFallback) {
        return runInstaller({ ...options, action: 'install' });
    }
    return installFromGitHub({ ...options, action: 'install', fallbackFromLocal: true });
}

// ─── Zero-Patch Persistent CDP Launcher (Standalone Pure Node.js) ────────────

export const CDP_LAUNCHER_DISPLAY_NAME = 'Antigravity (CDP)';
export const MACOS_CDP_LAUNCHER_BUNDLE_ID = 'com.antigravity-context-monitor.cdp-launcher';
export const MACOS_ANTIGRAVITY_BUNDLE_ID = 'com.google.antigravity';
export const MACOS_CDP_BUNDLE_NAME = `${CDP_LAUNCHER_DISPLAY_NAME}.app`;
export const MACOS_SYSTEM_APPLICATIONS_DIR = '/Applications';
export const LINUX_CDP_ICON_FILENAME = 'antigravity-cdp.svg';

const MAX_EMBEDDED_ICON_BYTES = 2 * 1024 * 1024;

function joinLauncherTargetPath(platform, ...segments) {
    if (
        platform === 'win32'
        && segments.length > 0
        && (/^[A-Za-z]:/.test(segments[0]) || segments[0].includes('\\'))
    ) {
        return win32Path.join(...segments);
    }
    return join(...segments);
}

function dirnameLauncherTargetPath(platform, target) {
    if (platform === 'win32' && (/^[A-Za-z]:/.test(target) || target.includes('\\'))) {
        return win32Path.dirname(target);
    }
    return dirname(target);
}

function normalizeLauncherPosixPath(p) {
    return resolve(p).replace(/\/+$/, '') || '/';
}

function getRealOsHomeDir() {
    try {
        const ui = userInfo();
        if (ui && ui.homedir && ui.homedir.trim()) {
            return ui.homedir.trim();
        }
    } catch {
        // Fallback when passwd lookup is unavailable
    }
    return homedir();
}

function resolveMacSystemAppsDir(options = {}, env = process.env) {
    if (options.systemAppsDir !== undefined) {
        const trimmed = String(options.systemAppsDir || '').trim();
        return trimmed || null;
    }
    if (typeof env.ACM_MACOS_APPLICATIONS_DIR === 'string') {
        const trimmed = env.ACM_MACOS_APPLICATIONS_DIR.trim();
        return trimmed || null;
    }
    if (options.homeDir && String(options.homeDir).trim()) {
        return null;
    }
    const realHome = normalizeLauncherPosixPath(getRealOsHomeDir());
    if (typeof env.HOME === 'string' && env.HOME.trim()) {
        if (normalizeLauncherPosixPath(env.HOME.trim()) !== realHome) {
            return null;
        }
    }
    if (options.platform && options.platform !== process.platform) {
        return null;
    }
    return MACOS_SYSTEM_APPLICATIONS_DIR;
}

function isDirectoryWritable(dirPath) {
    try {
        if (!existsSync(dirPath)) {
            return false;
        }
        const st = statSync(dirPath);
        if (!st.isDirectory()) {
            return false;
        }
        if (process.platform !== 'win32' && (st.mode & 0o222) === 0) {
            return false;
        }
        accessSync(dirPath, fsConstants.W_OK | fsConstants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function isMacAppBundleInstalled(appDir) {
    if (!appDir) { return false; }
    return existsSync(join(appDir, 'Contents', 'Info.plist'))
        && existsSync(join(appDir, 'Contents', 'MacOS', 'launch'));
}

function createLauncherRunner(execFileSyncFn) {
    return execFileSyncFn || ((file, args, opts) => execFileSync(file, [...args], {
        env: opts?.env,
        windowsHide: opts?.windowsHide ?? true,
        stdio: opts?.stdio ?? 'pipe',
        ...(typeof opts?.timeout === 'number' ? { timeout: opts.timeout } : {}),
        ...(opts?.encoding ? { encoding: opts.encoding } : {}),
    }));
}

function escapeSingleQuotedPosix(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function escapeExtendedRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeFreedesktopExecArg(value) {
    const clean = String(value).replace(/[\r\n]+/g, '');
    const pctEscaped = clean.replace(/%/g, '%%');
    if (pctEscaped.length === 0 || /[\s"'\\><~|&;$*?#()`]/.test(pctEscaped)) {
        const execQuoted = pctEscaped.replace(/([\\"`$])/g, '\\$1');
        const desktopEscaped = execQuoted.replace(/\\/g, '\\\\');
        return `"${desktopEscaped}"`;
    }
    return pctEscaped;
}

function defaultLauncherCommandExists(cmd, env = process.env) {
    const pathEnv = env.PATH || '';
    for (const dir of pathEnv.split(delimiter)) {
        if (!dir) { continue; }
        const full = join(dir, cmd);
        try {
            if (statSync(full).isFile()) { return true; }
        } catch {
            // ignore
        }
    }
    return false;
}

export const WINDOWS_DESKTOP_PS_SCRIPT =
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')";

function resolveWindowsDesktopDir(options = {}, homeDir, env = process.env) {
    if (options.desktopDir && String(options.desktopDir).trim()) {
        return String(options.desktopDir).trim();
    }
    const fallback = joinLauncherTargetPath('win32', homeDir, 'Desktop');
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
                return cleaned;
            }
        } catch {
            // Fallback cleanly to %USERPROFILE%\Desktop
        }
    }
    return fallback;
}

export function getSafeCdpLaunchCommand(platform = process.platform) {
    if (platform === 'darwin') {
        return 'while pgrep -f \'^/Applications/Antigravity\\.app/Contents/MacOS/Antigravity($| )\' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0';
    }
    if (platform === 'win32') {
        return '& "$env:LOCALAPPDATA\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0';
    }
    return 'antigravity --remote-debugging-port=0';
}

export function resolveCdpLauncherPaths(options = {}) {
    const platform = options.platform || process.platform;
    const env = options.env || process.env;
    const homeDir = (options.homeDir && String(options.homeDir).trim()) || resolveUserHome(env, platform);

    if (platform === 'darwin') {
        const macSystemAppsDir = resolveMacSystemAppsDir(options, env);
        const macSystemAppDir = macSystemAppsDir
            ? joinLauncherTargetPath('darwin', macSystemAppsDir, MACOS_CDP_BUNDLE_NAME)
            : undefined;
        const macUserAppDir = joinLauncherTargetPath('darwin', homeDir, 'Applications', MACOS_CDP_BUNDLE_NAME);

        const macCandidateAppDirs = [];
        const seenDirs = new Set();
        for (const candidate of [macSystemAppDir, macUserAppDir]) {
            if (!candidate) { continue; }
            const key = normalizeLauncherPosixPath(candidate);
            if (!seenDirs.has(key)) {
                seenDirs.add(key);
                macCandidateAppDirs.push(candidate);
            }
        }

        const preferSystem = Boolean(macSystemAppsDir && macSystemAppDir && isDirectoryWritable(macSystemAppsDir));
        const macPreferredAppDir = preferSystem && macSystemAppDir ? macSystemAppDir : macUserAppDir;
        const installedAppDir = macCandidateAppDirs.find(isMacAppBundleInstalled);
        const macAppDir = installedAppDir || macPreferredAppDir;

        let targetAppPath = (options.appPath && String(options.appPath).trim()) || '';
        if (!targetAppPath) {
            const targetCandidates = [
                ...(macSystemAppsDir ? [joinLauncherTargetPath('darwin', macSystemAppsDir, 'Antigravity.app')] : []),
                '/Applications/Antigravity.app',
                joinLauncherTargetPath('darwin', homeDir, 'Applications', 'Antigravity.app'),
            ];
            targetAppPath = targetCandidates.find((p) => existsSync(p))
                || (macSystemAppsDir ? joinLauncherTargetPath('darwin', macSystemAppsDir, 'Antigravity.app') : '/Applications/Antigravity.app');
        }
        return {
            platform,
            supported: true,
            homeDir,
            launcherPath: macAppDir,
            targetAppPath,
            macAppDir,
            ...(macSystemAppsDir ? { macSystemAppsDir } : {}),
            ...(macSystemAppDir ? { macSystemAppDir } : {}),
            macUserAppDir,
            macPreferredAppDir,
            macCandidateAppDirs,
        };
    }

    if (platform === 'win32') {
        const localAppData = env.LOCALAPPDATA && env.LOCALAPPDATA.trim()
            ? env.LOCALAPPDATA.trim()
            : joinLauncherTargetPath('win32', homeDir, 'AppData', 'Local');
        const appData = env.APPDATA && env.APPDATA.trim()
            ? env.APPDATA.trim()
            : joinLauncherTargetPath('win32', homeDir, 'AppData', 'Roaming');
        const winDataDir = joinLauncherTargetPath('win32', localAppData, 'AntigravityContextMonitor');
        const winCmdPath = joinLauncherTargetPath('win32', winDataDir, 'launch-antigravity-cdp.cmd');
        const winIconPath = joinLauncherTargetPath('win32', winDataDir, 'antigravity-cdp.ico');
        const winDesktopDir = resolveWindowsDesktopDir(options, homeDir, env);
        const winDesktopLnkPath = joinLauncherTargetPath('win32', winDesktopDir, `${CDP_LAUNCHER_DISPLAY_NAME}.lnk`);
        const winFallbackDesktopLnkPath = joinLauncherTargetPath('win32', homeDir, 'Desktop', `${CDP_LAUNCHER_DISPLAY_NAME}.lnk`);
        const winStartMenuLnkPath = joinLauncherTargetPath(
            'win32',
            appData,
            'Microsoft',
            'Windows',
            'Start Menu',
            'Programs',
            `${CDP_LAUNCHER_DISPLAY_NAME}.lnk`,
        );
        const targetAppPath = (options.appPath && String(options.appPath).trim())
            || joinLauncherTargetPath('win32', localAppData, 'Programs', 'Antigravity', 'Antigravity.exe');
        return {
            platform,
            supported: true,
            homeDir,
            launcherPath: winDesktopLnkPath,
            targetAppPath,
            winCmdPath,
            winDesktopDir,
            winDesktopLnkPath,
            winFallbackDesktopLnkPath,
            winStartMenuLnkPath,
            winIconPath,
        };
    }

    if (platform === 'linux') {
        const linuxWrapperPath = joinLauncherTargetPath('linux', homeDir, '.local', 'bin', 'antigravity-cdp');
        const linuxDesktopEntryPath = joinLauncherTargetPath(
            'linux',
            homeDir,
            '.local',
            'share',
            'applications',
            'antigravity-cdp.desktop',
        );
        const linuxIconPath = joinLauncherTargetPath(
            'linux',
            homeDir,
            '.local',
            'share',
            'icons',
            'hicolor',
            'scalable',
            'apps',
            LINUX_CDP_ICON_FILENAME,
        );
        let targetAppPath = (options.appPath && String(options.appPath).trim()) || '';
        if (!targetAppPath) {
            const candidates = [
                '/usr/bin/antigravity',
                '/usr/local/bin/antigravity',
                '/snap/bin/antigravity',
                '/opt/Antigravity/antigravity',
                joinLauncherTargetPath('linux', homeDir, '.local', 'bin', 'antigravity'),
            ];
            targetAppPath = candidates.find((p) => existsSync(p)) || 'antigravity';
        }
        return {
            platform,
            supported: true,
            homeDir,
            launcherPath: linuxDesktopEntryPath,
            targetAppPath,
            linuxWrapperPath,
            linuxDesktopEntryPath,
            linuxIconPath,
        };
    }

    return {
        platform,
        supported: false,
        homeDir,
        launcherPath: '',
        targetAppPath: (options.appPath && String(options.appPath).trim()) || '',
    };
}

export function buildMacOsLauncherPlist() {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '    <key>CFBundleDevelopmentRegion</key>',
        '    <string>en</string>',
        '    <key>CFBundleDisplayName</key>',
        `    <string>${CDP_LAUNCHER_DISPLAY_NAME}</string>`,
        '    <key>CFBundleExecutable</key>',
        '    <string>launch</string>',
        '    <key>CFBundleIconFile</key>',
        '    <string>icon.icns</string>',
        '    <key>CFBundleIdentifier</key>',
        `    <string>${MACOS_CDP_LAUNCHER_BUNDLE_ID}</string>`,
        '    <key>CFBundleInfoDictionaryVersion</key>',
        '    <string>6.0</string>',
        '    <key>CFBundleName</key>',
        `    <string>${CDP_LAUNCHER_DISPLAY_NAME}</string>`,
        '    <key>CFBundlePackageType</key>',
        '    <string>APPL</string>',
        '    <key>CFBundleShortVersionString</key>',
        '    <string>1.0.0</string>',
        '    <key>CFBundleVersion</key>',
        '    <string>1</string>',
        '    <key>LSMinimumSystemVersion</key>',
        '    <string>12.0</string>',
        '    <key>LSUIElement</key>',
        '    <true/>',
        '</dict>',
        '</plist>',
        '',
    ].join('\n');
}

export function buildMacOsLauncherScript(targetAppPath = '/Applications/Antigravity.app') {
    const cleanTarget = String(targetAppPath || '/Applications/Antigravity.app').replace(/\/+$/, '') || '/Applications/Antigravity.app';
    const mainBinaryRegex = `^${escapeExtendedRegex(`${cleanTarget}/Contents/MacOS/Antigravity`)}($| )`;

    return [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        '',
        '# Zero-patch persistent CDP launcher generated by Antigravity Context Monitor.',
        '# Never modifies /Applications/Antigravity.app and eliminates the 5s before-quit race.',
        `APP_PATH=${escapeSingleQuotedPosix(cleanTarget)}`,
        `APP_REGEX=${escapeSingleQuotedPosix(mainBinaryRegex)}`,
        `BUNDLE_ID=${escapeSingleQuotedPosix(MACOS_ANTIGRAVITY_BUNDLE_ID)}`,
        '',
        'if [ ! -d "$APP_PATH" ]; then',
        '  osascript -e \'activate\' -e \'display alert "Antigravity App Not Found" message "Could not locate Antigravity.app. Please install Antigravity App first."\' >/dev/null 2>&1 || true',
        '  exit 1',
        'fi',
        '',
        'find_main_pids() {',
        '  pgrep -f "$APP_REGEX" 2>/dev/null || true',
        '}',
        '',
        'wait_for_exit() {',
        '  local max_ticks=60',
        '  local tick=0',
        '  while [ "$tick" -lt "$max_ticks" ]; do',
        '    if [ -z "$(find_main_pids)" ]; then',
        '      return 0',
        '    fi',
        '    sleep 0.25',
        '    tick=$((tick + 1))',
        '  done',
        '  return 1',
        '}',
        '',
        'PIDS="$(find_main_pids)"',
        '',
        'if [ -n "$PIDS" ]; then',
        '  HAS_CDP=0',
        '  for pid in $PIDS; do',
        '    CMDLINE="$(ps -p "$pid" -o command= 2>/dev/null || true)"',
        '    if printf \'%s\' "$CMDLINE" | grep -q -- \'--remote-debugging-port\'; then',
        '      HAS_CDP=1',
        '      break',
        '    fi',
        '  done',
        '',
        '  if [ "$HAS_CDP" -eq 1 ]; then',
        '    open -a "$APP_PATH"',
        '    exit 0',
        '  fi',
        '',
        '  CHOICE="$(osascript \\',
        '    -e \'activate\' \\',
        '    -e \'set dialogResult to display dialog "Antigravity is currently running without CDP remote debugging. Quit & relaunch with CDP enabled?" with title "Antigravity (CDP)" buttons {"Cancel", "Quit & Relaunch"} default button "Quit & Relaunch" cancel button "Cancel"\' \\',
        '    -e \'return button returned of dialogResult\' 2>/dev/null || true)"',
        '  if [ "$CHOICE" != "Quit & Relaunch" ]; then',
        '    exit 0',
        '  fi',
        '',
        '  QUIT_RC=0',
        '  osascript -e "tell application id \\"$BUNDLE_ID\\" to quit" >/dev/null 2>&1 || QUIT_RC=$?',
        '  if [ "$QUIT_RC" -ne 0 ]; then',
        '    sleep 0.5',
        '    if [ -n "$(find_main_pids)" ]; then',
        '      osascript \\',
        '        -e \'activate\' \\',
        '        -e \'display alert "Permission Needed to Quit Antigravity" message "Allow Automation permission for Antigravity (CDP) in System Settings > Privacy & Security > Automation, or press Cmd+Q to quit Antigravity first and then open Antigravity (CDP) again."\' >/dev/null 2>&1 || true',
        '      exit 1',
        '    fi',
        '  fi',
        '  if ! wait_for_exit; then',
        '    osascript -e \'activate\' -e \'display alert "Antigravity Still Closing" message "Antigravity did not finish exiting within 15 seconds. Wait for its Dock indicator dot to disappear, then open Antigravity (CDP) again."\' >/dev/null 2>&1 || true',
        '    exit 1',
        '  fi',
        'else',
        '  # Wait cleanly up to 15s in case a dying PID is still finishing background teardown.',
        '  if ! wait_for_exit; then',
        '    exit 1',
        '  fi',
        'fi',
        '',
        'open -a "$APP_PATH" --args --remote-debugging-port=0',
        '',
    ].join('\n');
}

export function buildLinuxLauncherScript(targetAppPath) {
    const rawTarget = targetAppPath && String(targetAppPath).trim() && String(targetAppPath).trim() !== 'antigravity'
        ? String(targetAppPath).trim().replace(/[\r\n]+/g, '')
        : 'antigravity';
    const cleanTarget = rawTarget || 'antigravity';
    return [
        '#!/usr/bin/env sh',
        'set -eu',
        '',
        '# Zero-patch persistent CDP launcher generated by Antigravity Context Monitor.',
        '# Detects standard binary, Snap, and AppImage instances while excluding antigravity-cdp itself.',
        '# Never kills Antigravity — shows a friendly non-killing dialog if an argless instance is open.',
        `DEFAULT_BIN=${escapeSingleQuotedPosix(cleanTarget)}`,
        'APP_BIN="${ANTIGRAVITY_BIN:-$DEFAULT_BIN}"',
        '',
        'detect_running_state() {',
        '  ps -eo pid=,args= 2>/dev/null | awk -v self_pid="$$" \'',
        '    BEGIN { found_cdp = 0; found_nocdp = 0 }',
        '    {',
        '      pid = $1',
        '      if (pid == self_pid) next',
        '      line = $0',
        '      sub(/^[ \\t]*[0-9]+[ \\t]+/, "", line)',
        '      lower = tolower(line)',
        '      if (lower ~ /(^|[ \\t\\/"\\047])antigravity-cdp([ \\t"\\047]|$)/) next',
        '      if (index(lower, "antigravity-context-monitor") > 0) next',
        '      if (index(lower, "language_server") > 0) next',
        '      if (index(lower, "crashpad") > 0) next',
        '      if (index(lower, "chrome-sandbox") > 0) next',
        '      if (lower ~ /(^|[ \\t])--type=/) next',
        '      if (lower ~ /(^|[ \\t\\/])antigravity[ \\t-]+(ide|tools)([ \\t\\/]|$)/) next',
        '      exe = tolower($2)',
        '      cmd_head = lower',
        '      sub(/[ \\t]+--.*/, "", cmd_head)',
        '      is_shell = (exe ~ /(^|\\/)(sh|bash|dash|zsh|fish|awk|mawk|gawk|grep|pgrep|ps|env|node|python[0-9.]*)$/)',
        '      is_main = 0',
        '      if (exe ~ /(^|\\/)antigravity$/) is_main = 1',
        '      else if (exe ~ /^\\/snap\\/(bin\\/antigravity|antigravity\\/.*\\/antigravity)$/) is_main = 1',
        '      else if (exe ~ /(^|\\/)[^\\/]*antigravity[^\\/]*\\.appimage$/) is_main = 1',
        '      else if (exe ~ /^\\/tmp\\/\\.mount_[^\\/]*antigravity[^\\/]*\\/(.*\\/)?(antigravity|apprun)$/) is_main = 1',
        '      else if (!is_shell && cmd_head ~ /^\\//) {',
        '        if (cmd_head ~ /(^|\\/)antigravity$/) is_main = 1',
        '        else if (cmd_head ~ /(^|\\/)[^\\/]*antigravity[^\\/]*\\.appimage$/) is_main = 1',
        '        else if (cmd_head ~ /^\\/tmp\\/\\.mount_[^\\/]*antigravity[^\\/]*\\/(.*\\/)?(antigravity|apprun)$/) is_main = 1',
        '      }',
        '      if (!is_main) next',
        '      if (index(lower, "--remote-debugging-port") > 0) found_cdp = 1',
        '      else found_nocdp = 1',
        '    }',
        '    END {',
        '      if (found_cdp) print "cdp"',
        '      else if (found_nocdp) print "nocdp"',
        '      else print "none"',
        '    }',
        '  \' || printf \'none\\n\'',
        '}',
        '',
        'show_conflict_notice() {',
        '  msg="$1"',
        '  if command -v zenity >/dev/null 2>&1 && zenity --warning --title="Antigravity (CDP)" --text="$msg" >/dev/null 2>&1; then',
        '    return 0',
        '  fi',
        '  if command -v kdialog >/dev/null 2>&1 && kdialog --title "Antigravity (CDP)" --sorry "$msg" >/dev/null 2>&1; then',
        '    return 0',
        '  fi',
        '  if command -v notify-send >/dev/null 2>&1 && notify-send "Antigravity (CDP)" "$msg" >/dev/null 2>&1; then',
        '    return 0',
        '  fi',
        '  printf \'Antigravity (CDP): %s\\n\' "$msg" >&2',
        '}',
        '',
        'STATE="$(detect_running_state)"',
        '',
        'if [ "$STATE" = "nocdp" ]; then',
        '  # Wait cleanly up to 5s if an exiting Antigravity process is still tearing down.',
        '  max_ticks="${ACM_EXIT_WAIT_TICKS:-20}"',
        '  tick=0',
        '  while [ "$tick" -lt "$max_ticks" ]; do',
        '    sleep 0.25',
        '    STATE="$(detect_running_state)"',
        '    if [ "$STATE" != "nocdp" ]; then',
        '      break',
        '    fi',
        '    tick=$((tick + 1))',
        '  done',
        'fi',
        '',
        'if [ "$STATE" = "nocdp" ]; then',
        '  show_conflict_notice "Antigravity is already running without CDP remote debugging. Please quit Antigravity completely first, then open Antigravity (CDP) again."',
        '  exit 1',
        'fi',
        '',
        'exec "$APP_BIN" --remote-debugging-port=0 "$@"',
        '',
    ].join('\n');
}

export function buildLinuxDesktopEntry(wrapperPath, iconValue = 'antigravity') {
    const escapedExec = escapeFreedesktopExecArg(wrapperPath);
    const cleanIcon = (iconValue && String(iconValue).replace(/[\r\n]+/g, '').trim()) || 'antigravity';
    return [
        '[Desktop Entry]',
        'Type=Application',
        'Version=1.0',
        `Name=${CDP_LAUNCHER_DISPLAY_NAME}`,
        'Comment=Launch Antigravity with local CDP remote debugging enabled for Antigravity Context Monitor',
        `Exec=${escapedExec} %U`,
        `Icon=${cleanIcon}`,
        'Terminal=false',
        'Categories=Development;IDE;',
        'StartupWMClass=Antigravity',
        '',
    ].join('\n');
}

export function buildLinuxBadgedSvg(embeddedIcon) {
    const baseLayer = embeddedIcon
        ? `  <image href="data:${embeddedIcon.mimeType};base64,${embeddedIcon.base64}" x="8" y="8" width="240" height="240" preserveAspectRatio="xMidYMid meet"/>`
        : [
            '  <defs>',
            '    <linearGradient id="acmBg" x1="0%" y1="0%" x2="100%" y2="100%">',
            '      <stop offset="0%" stop-color="#162033"/>',
            '      <stop offset="100%" stop-color="#0B101A"/>',
            '    </linearGradient>',
            '    <linearGradient id="acmMark" x1="0%" y1="0%" x2="100%" y2="100%">',
            '      <stop offset="0%" stop-color="#60A5FA"/>',
            '      <stop offset="100%" stop-color="#3B82F6"/>',
            '    </linearGradient>',
            '  </defs>',
            '  <rect x="12" y="12" width="232" height="232" rx="52" fill="url(#acmBg)" stroke="#2A3750" stroke-width="4"/>',
            '  <path d="M128 52 L188 184 L156 184 L142 152 L114 152 L100 184 L68 184 Z M128 92 L119 128 L137 128 Z" fill="url(#acmMark)"/>',
        ].join('\n');

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">',
        baseLayer,
        '  <g>',
        '    <rect x="122" y="182" width="124" height="62" rx="18" fill="#0E1522" fill-opacity="0.96" stroke="#5B9CF6" stroke-width="5"/>',
        '    <text x="184" y="224" text-anchor="middle" fill="#FFFFFF" font-family="Inter, Ubuntu, DejaVu Sans, sans-serif" font-size="38" font-weight="800" letter-spacing="1.5">CDP</text>',
        '  </g>',
        '</svg>',
        '',
    ].join('\n');
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

function generateMacOsBadgedIcon(srcIcnsPath, destIcnsPath, options = {}) {
    if (process.platform !== 'darwin' && typeof options.execFileSyncFn !== 'function') {
        return false;
    }
    const runner = createLauncherRunner(options.execFileSyncFn);
    const env = options.env || process.env;
    let tmpDir = null;
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
        const iconsetSizes = [
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

function writeMacOsBundleAt(appDir, targetAppPath, options = {}) {
    const contentsDir = join(appDir, 'Contents');
    const macOsDir = join(contentsDir, 'MacOS');
    const resourcesDir = join(contentsDir, 'Resources');
    mkdirSync(macOsDir, { recursive: true });
    mkdirSync(resourcesDir, { recursive: true });
    writeFileSync(join(contentsDir, 'Info.plist'), buildMacOsLauncherPlist(), 'utf8');
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

function findLinuxOriginalIcon(homeDir, targetAppPath) {
    const candidates = [];
    if (targetAppPath && targetAppPath.includes('/')) {
        const binDir = dirname(targetAppPath);
        candidates.push(
            join(binDir, 'antigravity.png'),
            join(binDir, 'antigravity.svg'),
            join(binDir, 'icon.png'),
            join(binDir, 'resources', 'app', 'resources', 'linux', 'code.png'),
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
        joinLauncherTargetPath('linux', homeDir, '.local', 'share', 'icons', 'hicolor', 'scalable', 'apps', 'antigravity.svg'),
        joinLauncherTargetPath('linux', homeDir, '.local', 'share', 'icons', 'hicolor', '256x256', 'apps', 'antigravity.png'),
    );

    for (const candidate of candidates) {
        try {
            if (!existsSync(candidate)) { continue; }
            const st = statSync(candidate);
            if (!st.isFile() || st.size === 0 || st.size > MAX_EMBEDDED_ICON_BYTES) { continue; }
            const raw = readFileSync(candidate);
            const mimeType = candidate.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
            return { mimeType, base64: raw.toString('base64') };
        } catch {
            // Try next candidate
        }
    }
    return undefined;
}

function writeLinuxBadgedIcon(iconPath, homeDir, targetAppPath) {
    try {
        mkdirSync(dirname(iconPath), { recursive: true });
        const embedded = findLinuxOriginalIcon(homeDir, targetAppPath);
        writeFileSync(iconPath, buildLinuxBadgedSvg(embedded), 'utf8');
        return true;
    } catch {
        return false;
    }
}

function runLinuxUpdateDesktopDatabase(applicationsDir, options = {}) {
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

export function inspectCdpLauncher(options = {}) {
    const resolved = resolveCdpLauncherPaths(options);
    const safeTerminalCommand = getSafeCdpLaunchCommand(resolved.platform);
    let installed = false;
    let targetAppFound = false;

    if (resolved.platform === 'darwin') {
        const candidates = resolved.macCandidateAppDirs || (resolved.macAppDir ? [resolved.macAppDir] : []);
        installed = candidates.some(isMacAppBundleInstalled);
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
        if (resolved.targetAppPath && resolved.targetAppPath !== 'antigravity') {
            targetAppFound = existsSync(resolved.targetAppPath);
        } else {
            const existsFn = options.commandExistsFn || ((cmd) => defaultLauncherCommandExists(cmd, options.env || process.env));
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

export function setupCdpLauncher(options = {}) {
    const resolved = resolveCdpLauncherPaths(options);
    const dryRun = Boolean(options.dryRun);

    if (!resolved.supported) {
        const status = inspectCdpLauncher(options);
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
                resolved.winDesktopDir ? { ...options, desktopDir: resolved.winDesktopDir } : options,
            ),
        };
    }

    if (resolved.platform === 'darwin' && resolved.macPreferredAppDir) {
        const primaryDir = resolved.macPreferredAppDir;
        const fallbackDir = resolved.macUserAppDir || primaryDir;
        let createdDir = primaryDir;

        try {
            writeMacOsBundleAt(primaryDir, resolved.targetAppPath, options);
        } catch (err) {
            const code = err && typeof err === 'object' ? err.code : '';
            const isPermError = code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
            if (isPermError && normalizeLauncherPosixPath(primaryDir) !== normalizeLauncherPosixPath(fallbackDir)) {
                createdDir = fallbackDir;
                writeMacOsBundleAt(fallbackDir, resolved.targetAppPath, options);
            } else {
                throw err;
            }
        }

        const createdNorm = normalizeLauncherPosixPath(createdDir);
        for (const candidate of resolved.macCandidateAppDirs || []) {
            if (
                normalizeLauncherPosixPath(candidate) !== createdNorm
                && basename(candidate) === MACOS_CDP_BUNDLE_NAME
                && existsSync(candidate)
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

        const runner = createLauncherRunner(options.execFileSyncFn);
        const targetExe = resolved.targetAppPath;
        runner(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SHORTCUT_PS_SCRIPT],
            {
                env: {
                    ...(options.env || process.env),
                    ACM_LNK_DESKTOP: resolved.winDesktopLnkPath,
                    ACM_LNK_STARTMENU: resolved.winStartMenuLnkPath,
                    ACM_TARGET_EXE: targetExe,
                    ACM_WORKDIR: dirnameLauncherTargetPath('win32', targetExe),
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
            const dataDir = dirnameLauncherTargetPath('win32', resolved.winCmdPath);
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
            ? writeLinuxBadgedIcon(resolved.linuxIconPath, resolved.homeDir, resolved.targetAppPath)
            : false;
        const iconValue = iconWritten && resolved.linuxIconPath ? resolved.linuxIconPath : 'antigravity';
        writeFileSync(resolved.linuxDesktopEntryPath, buildLinuxDesktopEntry(resolved.linuxWrapperPath, iconValue), 'utf8');
        runLinuxUpdateDesktopDatabase(applicationsDir, options);
    }

    const status = inspectCdpLauncher(
        resolved.winDesktopDir ? { ...options, desktopDir: resolved.winDesktopDir } : options,
    );
    return {
        action: 'setup-cdp-launcher',
        ok: true,
        dryRun: false,
        launcherPath: status.launcherPath,
        platform: status.platform,
        status,
    };
}

export function removeCdpLauncher(options = {}) {
    const resolved = resolveCdpLauncherPaths(options);
    const dryRun = Boolean(options.dryRun);
    const inspectOpts = resolved.winDesktopDir ? { ...options, desktopDir: resolved.winDesktopDir } : options;
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
                if (basename(candidate) === MACOS_CDP_BUNDLE_NAME && existsSync(candidate)) {
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
                const dir = dirnameLauncherTargetPath('win32', resolved.winCmdPath);
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
                runLinuxUpdateDesktopDatabase(dirname(resolved.linuxDesktopEntryPath), options);
            }
        }
    }

    const status = inspectCdpLauncher(inspectOpts);
    return {
        action: 'remove-cdp-launcher',
        ok: true,
        dryRun,
        existed,
        removed: existed && !dryRun,
        launcherPath: resolved.launcherPath,
        platform: resolved.platform,
        status,
    };
}

// ─── CDP Guide & Bilingual CLI Output ────────────────────────────────────────

export function formatCdpGuide() {
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
  1. Recommended persistent application menu / dock launcher (Snap/AppImage aware, non-killing conflict dialog):
       node scripts/install-app-plugin.mjs --setup-cdp-launcher
  2. Or close Antigravity completely (all windows & tray icon), then launch from terminal:
       antigravity --remote-debugging-port=0

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

function printHelp() {
    console.log(`Antigravity Context Monitor — App Plugin Installer & Upgrader
Antigravity Context Monitor — 应用插件安装与升级脚本

Usage:
  node scripts/install-app-plugin.mjs [mode] [options]

Modes:
  --install               Install from local build/dist (auto-falls back to --from-github if missing)
  --from-github           Download & install latest (or --version <v>) release from GitHub Releases
  --upgrade               Upgrade to latest (or --version <v>) GitHub Release (atomic backup + swap)
  --status                Inspect installed version, config, sidecar, CDP, launcher, and IDE VSIX status
  --uninstall             Remove the installed App plugin directory
  --print-cdp-guide       Print zero-patch macOS / Windows / Linux --remote-debugging-port=0 guide
  --setup-cdp-launcher    Create a zero-patch persistent CDP launcher (macOS .app / Windows .lnk / Linux .desktop)
  --remove-cdp-launcher   Remove the zero-patch persistent CDP launcher

Options:
  --version <v>           Target GitHub release version (e.g. 1.17.11 or v1.17.11)
  --source <dir>          Explicit local plugin directory containing plugin.json
  --target <dir>          Override install path (default: ~/.gemini/config/plugins/antigravity-context-monitor)
  --use-cli               Use \`agy plugin install\` / \`agy plugin uninstall\` when available
  --check-remote          With --status, check latest GitHub Release for updates
  --require-checksum      Fail if SHA256SUMS.txt is absent from the GitHub Release
  --json                  Print machine-readable JSON output
  --dry-run               Preview actions without modifying files
  --repo <owner/repo>     Override GitHub repository slug
  -h, --help              Show this help message`);
}

function formatStatusText(status) {
    const app = status.appPlugin;
    const sc = status.sidecar;
    const cdp = status.cdp;
    const launcher = status.cdpLauncher;
    const ide = status.ideVsix;
    const rem = status.remote;

    const lines = [
        'Antigravity Context Monitor — Status / 运行状态',
        '',
        `App Plugin : ${app.installed ? `Installed v${app.version || 'unknown'}` : 'Not installed'}`,
        `  Path     : ${app.path}`,
        `  Runtime  : ${app.hasCompiledRuntime ? 'Bundled (ready)' : 'Missing compiled runtime'}`,
        `  Enabled  : ${app.enabled ? 'Yes' : 'No'} (config.json: ${app.configExists ? (app.enabledInConfig === null ? 'default-enabled' : String(app.enabledInConfig)) : 'absent'})`,
        `Sidecar    : ${sc.processActive ? `Running (PID ${sc.runningPid}, v${sc.runningVersion}, 127.0.0.1:${sc.listeningPort})` : (sc.logExists ? `Idle / Not reachable (last port ${sc.listeningPort ?? 'none'})` : 'No sidecar log found')}`,
    ];
    if (sc.reloadRequired) {
        lines.push(`  Notice   : Installed v${app.version} differs from running sidecar v${sc.runningVersion} — toggle plugin Off -> On in Customizations to reload.`);
    }
    lines.push(
        `CDP        : ${cdp.active ? `Active (port ${cdp.port})` : (cdp.stale ? `Inactive — stale DevToolsActivePort (port ${cdp.port ?? 'invalid'} unreachable; quit & relaunch with --remote-debugging-port=0)` : 'Inactive (not required for core Sidecar UI)')}`,
        `CDP Launch : ${launcher?.installed ? `Installed (${launcher.path})` : (launcher?.supported ? `Not created (run --setup-cdp-launcher -> ${launcher.path})` : `Unsupported (${launcher?.platform || process.platform})`)}`,
        `IDE VSIX   : ${ide.installed ? ide.installations.map((i) => `${i.editor} v${i.version}`).join(', ') : 'Not detected'}`,
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

function printCliResult(result, asJson) {
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
    const upgradeNote = result.previousVersion && result.previousVersion !== result.version
        ? ` (upgraded from v${result.previousVersion})`
        : '';

    console.log(`
✓ Installed Antigravity Context Monitor App Plugin (v${result.version})${upgradeNote}
  Path: ${result.targetDir}
  Method: ${result.installMethod}${checksumNote}

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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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

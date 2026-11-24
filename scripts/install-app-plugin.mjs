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
 *   --version <v>        Specific release version (e.g. 1.17.7 or v1.17.7)
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
    chmodSync,
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
    writeFileSync,
} from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { homedir, tmpdir } from 'node:os';
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
        throw new Error(`Invalid --version value "${raw}". Expected semver like 1.17.7 or v1.17.7.`);
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
            dryRun,
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

function escapeSingleQuotedPosix(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function escapeExtendedRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        const macAppDir = joinLauncherTargetPath('darwin', homeDir, 'Applications', `${CDP_LAUNCHER_DISPLAY_NAME}.app`);
        let targetAppPath = (options.appPath && String(options.appPath).trim()) || '/Applications/Antigravity.app';
        if (!options.appPath && !existsSync(targetAppPath)) {
            const userApp = joinLauncherTargetPath('darwin', homeDir, 'Applications', 'Antigravity.app');
            if (existsSync(userApp)) {
                targetAppPath = userApp;
            }
        }
        return {
            platform,
            supported: true,
            homeDir,
            launcherPath: macAppDir,
            targetAppPath,
            macAppDir,
        };
    }

    if (platform === 'win32') {
        const localAppData = env.LOCALAPPDATA && env.LOCALAPPDATA.trim()
            ? env.LOCALAPPDATA.trim()
            : joinLauncherTargetPath('win32', homeDir, 'AppData', 'Local');
        const appData = env.APPDATA && env.APPDATA.trim()
            ? env.APPDATA.trim()
            : joinLauncherTargetPath('win32', homeDir, 'AppData', 'Roaming');
        const winCmdPath = joinLauncherTargetPath('win32', localAppData, 'AntigravityContextMonitor', 'launch-antigravity-cdp.cmd');
        const winDesktopLnkPath = joinLauncherTargetPath('win32', homeDir, 'Desktop', `${CDP_LAUNCHER_DISPLAY_NAME}.lnk`);
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
            winDesktopLnkPath,
            winStartMenuLnkPath,
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
        let targetAppPath = (options.appPath && String(options.appPath).trim()) || '';
        if (!targetAppPath) {
            const candidates = [
                '/usr/bin/antigravity',
                '/usr/local/bin/antigravity',
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

function buildMacOsLauncherPlist() {
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

function buildMacOsLauncherScript(targetAppPath = '/Applications/Antigravity.app') {
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
        '  osascript -e \'display alert "Antigravity App Not Found" message "Could not locate Antigravity.app. Please install Antigravity App first."\' >/dev/null 2>&1 || true',
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
        '    -e \'set dialogResult to display dialog "Antigravity is currently running without CDP remote debugging. Quit & relaunch with CDP enabled?" with title "Antigravity (CDP)" buttons {"Cancel", "Quit & Relaunch"} default button "Quit & Relaunch" cancel button "Cancel"\' \\',
        '    -e \'return button returned of dialogResult\' 2>/dev/null || true)"',
        '  if [ "$CHOICE" != "Quit & Relaunch" ]; then',
        '    exit 0',
        '  fi',
        '',
        '  osascript -e "tell application id \\"$BUNDLE_ID\\" to quit" >/dev/null 2>&1 || true',
        '  if ! wait_for_exit; then',
        '    osascript -e \'display alert "Antigravity Still Closing" message "Antigravity did not finish exiting within 15 seconds. Wait for its Dock indicator dot to disappear, then open Antigravity (CDP) again."\' >/dev/null 2>&1 || true',
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

function buildWindowsLauncherCmd(targetExePath) {
    const exeExpr = targetExePath && String(targetExePath).trim()
        ? String(targetExePath).trim().replace(/\//g, '\\').replace(/"/g, '')
        : '%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe';

    return [
        '@echo off',
        'setlocal EnableExtensions',
        'rem Zero-patch persistent CDP launcher generated by Antigravity Context Monitor.',
        `set "APP_EXE=${exeExpr}"`,
        'if not exist "%APP_EXE%" (',
        '  set "APP_EXE=%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe"',
        ')',
        'if not exist "%APP_EXE%" (',
        '  powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(\'Could not find Antigravity.exe. Please install Antigravity App first.\', \'Antigravity (CDP)\')" >nul 2>&1',
        '  exit /b 1',
        ')',
        '',
        'powershell -NoProfile -NonInteractive -Command "$p = Get-CimInstance Win32_Process -Filter \\"Name=\'Antigravity.exe\'\\" -ErrorAction SilentlyContinue; if ($p | Where-Object { $_.CommandLine -match \'--remote-debugging-port\' }) { exit 10 } elseif ($p) { exit 20 } else { exit 0 }" >nul 2>&1',
        'set "STATE=%ERRORLEVEL%"',
        '',
        'if "%STATE%"=="10" (',
        '  start "" "%APP_EXE%"',
        '  exit /b 0',
        ')',
        'if not "%STATE%"=="20" goto launch_cdp',
        '',
        'set /a TICKS=0',
        ':wait_loop',
        'tasklist /FI "IMAGENAME eq Antigravity.exe" 2>nul | find /I "Antigravity.exe" >nul',
        'if errorlevel 1 goto launch_cdp',
        'if %TICKS% GEQ 12 goto still_running',
        'set /a TICKS+=1',
        'powershell -NoProfile -NonInteractive -Command "Start-Sleep -Milliseconds 500" >nul 2>&1',
        'goto wait_loop',
        '',
        ':still_running',
        'powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(\'Antigravity is currently running without CDP remote debugging. Please close all Antigravity windows and tray icon first, then open Antigravity (CDP) again.\', \'Antigravity (CDP)\')" >nul 2>&1',
        'exit /b 0',
        '',
        ':launch_cdp',
        'start "" "%APP_EXE%" --remote-debugging-port=0',
        'exit /b 0',
        '',
    ].join('\r\n');
}

function buildLinuxLauncherScript(targetAppPath) {
    const cleanTarget = targetAppPath && String(targetAppPath).trim() && String(targetAppPath).trim() !== 'antigravity'
        ? String(targetAppPath).trim()
        : 'antigravity';
    return [
        '#!/usr/bin/env sh',
        'set -eu',
        '',
        '# Zero-patch persistent CDP launcher generated by Antigravity Context Monitor.',
        `APP_BIN="\${ANTIGRAVITY_BIN:-${cleanTarget.replace(/["$`\\]/g, '\\$&')}}"`,
        '',
        'tick=0',
        'while [ "$tick" -lt 20 ]; do',
        '  if ! pgrep -x antigravity >/dev/null 2>&1; then',
        '    break',
        '  fi',
        '  if pgrep -af \'antigravity.*--remote-debugging-port\' >/dev/null 2>&1; then',
        '    break',
        '  fi',
        '  sleep 0.25',
        '  tick=$((tick + 1))',
        'done',
        '',
        'exec "$APP_BIN" --remote-debugging-port=0 "$@"',
        '',
    ].join('\n');
}

function buildLinuxDesktopEntry(wrapperPath) {
    const escapedExec = wrapperPath.includes(' ')
        ? `"${wrapperPath.replace(/"/g, '\\"')}"`
        : wrapperPath;
    return [
        '[Desktop Entry]',
        'Type=Application',
        'Version=1.0',
        `Name=${CDP_LAUNCHER_DISPLAY_NAME}`,
        'Comment=Launch Antigravity with local CDP remote debugging enabled for Antigravity Context Monitor',
        `Exec=${escapedExec} %U`,
        'Icon=antigravity',
        'Terminal=false',
        'Categories=Development;IDE;',
        'StartupWMClass=Antigravity',
        '',
    ].join('\n');
}

const WINDOWS_SHORTCUT_PS_SCRIPT = [
    '$ErrorActionPreference = "Stop"',
    '$ws = New-Object -ComObject WScript.Shell',
    '$targets = @($env:ACM_LNK_DESKTOP, $env:ACM_LNK_STARTMENU) | Where-Object { $_ -and $_.Trim().Length -gt 0 }',
    'foreach ($lnkPath in $targets) {',
    '  $dir = Split-Path -Parent $lnkPath',
    '  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
    '  $sc = $ws.CreateShortcut($lnkPath)',
    '  $sc.TargetPath = $env:ACM_CMD_PATH',
    '  $sc.WorkingDirectory = $env:ACM_WORKDIR',
    '  $sc.WindowStyle = 7',
    '  $sc.Description = "Launch Antigravity with CDP remote debugging enabled (zero-patch)"',
    '  if ($env:ACM_ICON_PATH -and (Test-Path -LiteralPath $env:ACM_ICON_PATH)) { $sc.IconLocation = "$env:ACM_ICON_PATH,0" }',
    '  $sc.Save()',
    '}',
].join('; ');

export function inspectCdpLauncher(options = {}) {
    const resolved = resolveCdpLauncherPaths(options);
    const safeTerminalCommand = getSafeCdpLaunchCommand(resolved.platform);
    let installed = false;
    let targetAppFound = false;

    if (resolved.platform === 'darwin' && resolved.macAppDir) {
        installed = existsSync(join(resolved.macAppDir, 'Contents', 'Info.plist'))
            && existsSync(join(resolved.macAppDir, 'Contents', 'MacOS', 'launch'));
        targetAppFound = Boolean(resolved.targetAppPath && existsSync(resolved.targetAppPath));
    } else if (resolved.platform === 'win32' && resolved.winCmdPath) {
        installed = existsSync(resolved.winCmdPath)
            && (existsSync(resolved.winDesktopLnkPath) || existsSync(resolved.winStartMenuLnkPath));
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
        return {
            action: 'setup-cdp-launcher',
            ok: true,
            dryRun: true,
            launcherPath: resolved.launcherPath,
            platform: resolved.platform,
            status: inspectCdpLauncher(options),
        };
    }

    if (resolved.platform === 'darwin' && resolved.macAppDir) {
        const contentsDir = join(resolved.macAppDir, 'Contents');
        const macOsDir = join(contentsDir, 'MacOS');
        const resourcesDir = join(contentsDir, 'Resources');
        mkdirSync(macOsDir, { recursive: true });
        mkdirSync(resourcesDir, { recursive: true });
        writeFileSync(join(contentsDir, 'Info.plist'), buildMacOsLauncherPlist(), 'utf8');
        const launchScriptPath = join(macOsDir, 'launch');
        writeFileSync(launchScriptPath, buildMacOsLauncherScript(resolved.targetAppPath), 'utf8');
        chmodSync(launchScriptPath, 0o755);

        const iconCandidates = [
            join(resolved.targetAppPath, 'Contents', 'Resources', 'icon.icns'),
            join(resolved.targetAppPath, 'Contents', 'Resources', 'Antigravity.icns'),
            join(resolved.targetAppPath, 'Contents', 'Resources', 'electron.icns'),
        ];
        for (const iconSrc of iconCandidates) {
            if (existsSync(iconSrc)) {
                try {
                    copyFileSync(iconSrc, join(resourcesDir, 'icon.icns'));
                    break;
                } catch {
                    // Best-effort icon copy
                }
            }
        }
    } else if (resolved.platform === 'win32' && resolved.winCmdPath) {
        mkdirSync(dirname(resolved.winCmdPath), { recursive: true });
        writeFileSync(resolved.winCmdPath, buildWindowsLauncherCmd(resolved.targetAppPath), 'utf8');

        const runner = options.execFileSyncFn || ((file, args, opts) => execFileSync(file, args, opts));
        runner(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SHORTCUT_PS_SCRIPT],
            {
                env: {
                    ...(options.env || process.env),
                    ACM_LNK_DESKTOP: resolved.winDesktopLnkPath,
                    ACM_LNK_STARTMENU: resolved.winStartMenuLnkPath,
                    ACM_CMD_PATH: resolved.winCmdPath,
                    ACM_WORKDIR: dirname(resolved.winCmdPath),
                    ACM_ICON_PATH: resolved.targetAppPath || '',
                },
                windowsHide: true,
                stdio: 'pipe',
            },
        );
    } else if (resolved.platform === 'linux' && resolved.linuxWrapperPath && resolved.linuxDesktopEntryPath) {
        mkdirSync(dirname(resolved.linuxWrapperPath), { recursive: true });
        mkdirSync(dirname(resolved.linuxDesktopEntryPath), { recursive: true });
        writeFileSync(resolved.linuxWrapperPath, buildLinuxLauncherScript(resolved.targetAppPath), 'utf8');
        if (process.platform !== 'win32') {
            chmodSync(resolved.linuxWrapperPath, 0o755);
        }
        writeFileSync(resolved.linuxDesktopEntryPath, buildLinuxDesktopEntry(resolved.linuxWrapperPath), 'utf8');
    }

    const status = inspectCdpLauncher(options);
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
    const before = inspectCdpLauncher(options);

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
        if (resolved.platform === 'darwin' && resolved.macAppDir) {
            if (basename(resolved.macAppDir) === `${CDP_LAUNCHER_DISPLAY_NAME}.app` && existsSync(resolved.macAppDir)) {
                existed = true;
                rmSync(resolved.macAppDir, { recursive: true, force: true });
            }
        } else if (resolved.platform === 'win32') {
            for (const p of [resolved.winDesktopLnkPath, resolved.winStartMenuLnkPath, resolved.winCmdPath]) {
                if (p && existsSync(p)) {
                    existed = true;
                    rmSync(p, { force: true });
                }
            }
            if (resolved.winCmdPath) {
                const dir = dirname(resolved.winCmdPath);
                try {
                    if (existsSync(dir) && readdirSync(dir).length === 0) {
                        rmdirSync(dir);
                    }
                } catch { /* ignore */ }
            }
        } else if (resolved.platform === 'linux') {
            for (const p of [resolved.linuxDesktopEntryPath, resolved.linuxWrapperPath]) {
                if (p && existsSync(p)) {
                    existed = true;
                    rmSync(p, { force: true });
                }
            }
        }
    }

    const status = inspectCdpLauncher(options);
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
  - macOS  : ~/Applications/Antigravity (CDP).app (pin to Dock or open via Spotlight; waits for 5s Cmd+Q teardown!)
  - Windows: Desktop & Start Menu "Antigravity (CDP).lnk" + %LOCALAPPDATA%\\AntigravityContextMonitor\\launch-antigravity-cdp.cmd
  - Linux  : ~/.local/share/applications/antigravity-cdp.desktop + ~/.local/bin/antigravity-cdp

IMPORTANT / 重要提示 (macOS 5-Second Background Teardown / macOS 5 秒后台退出陷阱):
  Always quit Antigravity App COMPLETELY first before relaunching with --remote-debugging-port=0.
  On macOS, pressing Cmd+Q closes all windows immediately, but Antigravity stays alive in the background
  for up to ~5 seconds while terminating language_server. Running "open -a" during those 5 seconds
  silently ignores --args! Wait until the Dock indicator dot disappears, or use the race-free command below.
  请务必先完全退出 Antigravity App 再重启：macOS 按 Cmd+Q 后窗口会立刻消失，但后台仍需约 5 秒清理 language_server；
  在此 5 秒内运行 open -a 会静默丢弃 --args。请等待程序坞指示灯彻底消失，或直接使用下方防竞态等待命令。

[macOS]
  1. Recommended persistent Dock/Spotlight launcher (zero binary patching, survives auto-updates):
       node scripts/install-app-plugin.mjs --setup-cdp-launcher
  2. Manual race-free Terminal command (after Cmd+Q, automatically waits for the 5s background exit):
       ${macSafeCmd}

[Windows]
  1. Recommended persistent Desktop & Start Menu shortcuts (zero binary patching):
       node scripts/install-app-plugin.mjs --setup-cdp-launcher
  2. Or close Antigravity Desktop completely (all windows & system tray icon), then launch:
     PowerShell:
       & "$env:LOCALAPPDATA\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0
     CMD / Run dialog:
       "%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0

[Linux]
  1. Recommended persistent application menu / dock launcher (zero binary patching):
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
  --version <v>           Target GitHub release version (e.g. 1.17.7 or v1.17.7)
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
        console.log(`✓ Created zero-patch persistent CDP launcher (${result.platform}):\n  ${result.launcherPath}\n已创建零侵入持久化 CDP 启动器。`);
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

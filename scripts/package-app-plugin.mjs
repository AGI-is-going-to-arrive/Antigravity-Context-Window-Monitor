#!/usr/bin/env node
/**
 * Cross-platform allowlist packager for the Antigravity App Sidecar plugin.
 *
 * Pure Node.js with zero external npm or OS archive binary dependencies
 * (no `zip`, no Windows `tar.exe` / MSYS2 collisions).
 *
 * Packaging Contract (v1.18.0 §4.3):
 *   - Explicit artifact allowlist: ships ONLY verified plugin metadata, logo,
 *     sidecar entrypoint, skill, and isolated esbuild App Sidecar bundle
 *     (`sidecar-bundle.js` + previous-release compatible `sidecar-server.js` /
 *     `sidecar-runtime.js` entry shims). Never ships `.map`, `.png`, `.d.ts`,
 *     `.test.js`, or retired docs/screenshots.
 *   - Embeds content-hash `buildId` in `runtime/package.json`.
 *   - Emits single canonical `dist/SHA256SUMS.txt` covering all 3 release
 *     artifacts (`.vsix`, `-app.zip`, `-app.tar.gz`) — hard-failing when
 *     `--require-all` / `{ requireAll: true }` is set and any artifact is missing.
 *   - Enforces hard size ceilings (VSIX uncompressed <= 1.55 MB, VSIX compressed
 *     <= 560 KB for v1.18+, App ZIP < 0.55 MB) and logs target vs ceiling metrics.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, gzipSync, inflateRawSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PLUGIN_DIR_NAME = 'antigravity-context-monitor';
const require = createRequire(import.meta.url);

// Explicit allowlist of static plugin files copied from `app-plugin/`
export const APP_PLUGIN_ALLOWLIST = Object.freeze([
    'plugin.json',
    'assets/logo.svg',
    'bin/agy-statusline.mjs',
    'sidecars/context_monitor/sidecar.json',
    'sidecars/context_monitor/main.mjs',
    'skills/context-monitor/SKILL.md',
]);

// Files that MUST carry executable Unix mode bits (0o755) in staged dirs and archives
export const APP_EXECUTABLE_FILES = new Set([
    'bin/agy-statusline.mjs',
    'sidecars/context_monitor/main.mjs',
]);

// Explicit allowlist of bundled esbuild App Sidecar runtime files
export const APP_BUNDLED_RUNTIME_FILES = Object.freeze([
    'sidecar-bundle.js',
    'sidecar-server.js',
    'sidecar-runtime.js',
]);

// Calibrated default hard artifact size ceilings (App ZIP < 0.55 MB ALWAYS enforced as hard error).
// Pre-README-trim default allows <= 520 KB comp / <= 1.78 MB raw; automatically tightens to
// POST_README_TRIM_SIZE_CEILINGS (<= 515 KB comp / <= 1.75 MB raw, plus allowlisted icon.png bytes
// when present) once Phase 4 README trim (<= 20 KB) + CHANGELOG.md + Marketplace icon land.
export const ARTIFACT_SIZE_CEILINGS = Object.freeze({
    vsixUncompressedMaxBytes: 1_866_465,  // <= 1.78 MB pre-README-trim hard ceiling
    vsixCompressedMaxBytes: 532_480,      // <= 520 KB pre-README-trim hard ceiling
    appZipMaxBytes: 576_716,              // < 0.55 MB (563.2 KB) hard ceiling ALWAYS enforced
});

export const POST_README_TRIM_SIZE_CEILINGS = Object.freeze({
    vsixUncompressedMaxBytes: 1_835_008,  // <= 1.75 MB post-README-trim (+changelog) base ceiling
    vsixCompressedMaxBytes: 527_360,      // <= 515 KB post-README-trim (+changelog) base ceiling
    appZipMaxBytes: 576_716,              // < 0.55 MB (563.2 KB) hard ceiling ALWAYS enforced
});

// Calibrated v1.18.0+ release limits, mandatory for candidates from 1.18 onward.
// Captures the verified 75-module Plan C + D9 + Marketplace icon floor (~533.1 KB comp / ~1.44 MB raw)
// while keeping App Sidecar ZIP < 0.55 MB (563.2 KB) strictly unchanged.
export const RELEASE_STRICT_SIZE_CEILINGS = Object.freeze({
    vsixUncompressedMaxBytes: 1_625_292,  // <= 1.55 MB calibrated v1.18.0+ release ceiling
    vsixCompressedMaxBytes: 573_440,      // <= 560 KB calibrated v1.18.0+ release ceiling
    appZipMaxBytes: 576_716,              // < 0.55 MB (563.2 KB) hard ceiling ALWAYS enforced
});

// Pre-Plan-C §4.3 blueprint VSIX estimate retained for transparent console comparison.
export const BLUEPRINT_VSIX_ESTIMATE_BYTES = Object.freeze({
    vsixUncompressedBytes: 1_048_576,     // 1.00 MB pre-Plan-C §4.3 estimate
    vsixCompressedBytes: 409_600,         // 400 KB pre-Plan-C §4.3 estimate
});

// The working tree stays on 1.17.x during Phase 5.5. Stamping a 1.18+
// candidate must automatically enable the published release limits.
export function requiresReleaseSize(version) {
    const match = /^(\d+)\.(\d+)\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.exec(String(version));
    if (!match) { throw new Error(`Invalid package version: ${version}`); }
    return Number(match[1]) > 1 || (Number(match[1]) === 1 && Number(match[2]) >= 18);
}

const README_TRIMMED_THRESHOLD_BYTES = 20_480; // <= 20 KB indicates Phase 4 README trim landed

const BANNED_ARTIFACT_EXTENSIONS = ['.map', '.png', '.d.ts'];
const BANNED_BASENAMES = new Set(['CHANGELOG.md', 'DESIGN.md', 'PRODUCT.md', 'readme_CN.md', 'AGENTS.md']);

// ─── CRC-32 (IEEE 802.3) ─────────────────────────────────────────────────────

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

export function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function toDosTimeDate(date) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const year = Math.max(1980, Math.min(2107, d.getFullYear()));
    const dosDate = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    return { dosTime, dosDate };
}

function normalizeArchivePath(p) {
    return p.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Pure Node zero-dependency PKZIP archive builder.
 * @param {Array<{ name: string, data: Buffer, mode?: number, mtime?: Date }>} entries
 * @returns {Buffer}
 */
export function buildZipBuffer(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
        const nameStr = normalizeArchivePath(entry.name);
        const nameBuf = Buffer.from(nameStr, 'utf8');
        const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
        const checksum = crc32(rawData);
        const deflated = deflateRawSync(rawData, { level: 9 });
        const useDeflate = deflated.length < rawData.length;
        const method = useDeflate ? 8 : 0;
        const payload = useDeflate ? deflated : rawData;
        const { dosTime, dosDate } = toDosTimeDate(entry.mtime);
        const unixMode = (entry.mode ?? 0o100644) & 0xffff;
        const externalAttrs = (unixMode << 16) >>> 0;

        // Local file header (30 bytes + filename)
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);            // version needed: 2.0
        localHeader.writeUInt16LE(0x0800, 6);        // UTF-8 filename flag
        localHeader.writeUInt16LE(method, 8);
        localHeader.writeUInt16LE(dosTime, 10);
        localHeader.writeUInt16LE(dosDate, 12);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(payload.length, 18);
        localHeader.writeUInt32LE(rawData.length, 22);
        localHeader.writeUInt16LE(nameBuf.length, 26);
        localHeader.writeUInt16LE(0, 28);            // extra field length

        localParts.push(localHeader, nameBuf, payload);

        // Central directory header (46 bytes + filename)
        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE((3 << 8) | 20, 4); // version made by: Unix + 2.0
        centralHeader.writeUInt16LE(20, 6);            // version needed: 2.0
        centralHeader.writeUInt16LE(0x0800, 8);        // UTF-8 filename flag
        centralHeader.writeUInt16LE(method, 10);
        centralHeader.writeUInt16LE(dosTime, 12);
        centralHeader.writeUInt16LE(dosDate, 14);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(payload.length, 20);
        centralHeader.writeUInt32LE(rawData.length, 24);
        centralHeader.writeUInt16LE(nameBuf.length, 28);
        centralHeader.writeUInt16LE(0, 30);            // extra len
        centralHeader.writeUInt16LE(0, 32);            // comment len
        centralHeader.writeUInt16LE(0, 34);            // disk number start
        centralHeader.writeUInt16LE(0, 36);            // internal attrs
        centralHeader.writeUInt32LE(externalAttrs, 38);
        centralHeader.writeUInt32LE(offset, 42);

        centralParts.push(centralHeader, nameBuf);
        offset += localHeader.length + nameBuf.length + payload.length;
    }

    const centralDirBuf = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);                        // disk number
    eocd.writeUInt16LE(0, 6);                        // central dir start disk
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDirBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);                       // comment length

    return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

/**
 * Pure Node PKZIP central-directory inspector for measuring VSIX / ZIP
 * uncompressed bytes and verifying zero banned files inside archives.
 * Returns null if the buffer is not a valid PKZIP archive.
 */
export function inspectZipBuffer(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 22) { return null; }
    let eocdOffset = -1;
    const minOffset = Math.max(0, buf.length - 65_557);
    for (let pos = buf.length - 22; pos >= minOffset; pos--) {
        if (buf.readUInt32LE(pos) === 0x06054b50) {
            eocdOffset = pos;
            break;
        }
    }
    if (eocdOffset < 0) { return null; }

    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdSize = buf.readUInt32LE(eocdOffset + 12);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    if (cdOffset + cdSize > buf.length) { return null; }

    const entries = [];
    let uncompressedBytes = 0;
    let cursor = cdOffset;
    for (let i = 0; i < totalEntries && cursor + 46 <= cdOffset + cdSize; i++) {
        if (buf.readUInt32LE(cursor) !== 0x02014b50) { return null; }
        const method = buf.readUInt16LE(cursor + 10);
        const compressedSize = buf.readUInt32LE(cursor + 20);
        const uncompressedSize = buf.readUInt32LE(cursor + 24);
        const nameLen = buf.readUInt16LE(cursor + 28);
        const extraLen = buf.readUInt16LE(cursor + 30);
        const commentLen = buf.readUInt16LE(cursor + 32);
        const externalAttrs = buf.readUInt32LE(cursor + 38);
        const localHeaderOffset = buf.readUInt32LE(cursor + 42);
        const mode = (externalAttrs >>> 16) & 0xffff;
        const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
        entries.push({ name, method, compressedSize, uncompressedSize, mode, localHeaderOffset });
        uncompressedBytes += uncompressedSize;
        cursor += 46 + nameLen + extraLen + commentLen;
    }

    return {
        entryCount: entries.length,
        compressedBytes: buf.length,
        uncompressedBytes,
        entries,
    };
}

function readZipEntryBuffer(buf, entry) {
    if (!entry || typeof entry.localHeaderOffset !== 'number') { return null; }
    const lh = entry.localHeaderOffset;
    if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) { return null; }
    const nameLen = buf.readUInt16LE(lh + 26);
    const extraLen = buf.readUInt16LE(lh + 28);
    const dataStart = lh + 30 + nameLen + extraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataEnd > buf.length) { return null; }
    const raw = buf.subarray(dataStart, dataEnd);
    if (entry.method === 0) { return Buffer.from(raw); }
    if (entry.method === 8) { return inflateRawSync(raw); }
    return null;
}

function fromDosTimeDate(dosTime, dosDate) {
    const year = ((dosDate >>> 9) & 0x7f) + 1980;
    const month = Math.max(1, Math.min(12, (dosDate >>> 5) & 0x0f)) - 1;
    const day = Math.max(1, Math.min(31, dosDate & 0x1f));
    const hours = Math.min(23, (dosTime >>> 11) & 0x1f);
    const minutes = Math.min(59, (dosTime >>> 5) & 0x3f);
    const seconds = Math.min(58, (dosTime & 0x1f) * 2);
    return new Date(year, month, day, hours, minutes, seconds);
}

/**
 * Losslessly re-deflate a PKZIP/VSIX archive using standard RFC 1951 deflate level 9,
 * verifying every entry's CRC-32 and uncompressed length before returning.
 * Returns null if the archive cannot be safely re-compressed.
 */
export function recompressZipBufferLevel9(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 22) { return null; }
    let eocdOffset = -1;
    const minOffset = Math.max(0, buf.length - 65_557);
    for (let pos = buf.length - 22; pos >= minOffset; pos--) {
        if (buf.readUInt32LE(pos) === 0x06054b50) {
            const commentLen = buf.readUInt16LE(pos + 20);
            if (pos + 22 + commentLen === buf.length) {
                eocdOffset = pos;
                break;
            }
        }
    }
    if (eocdOffset < 0) { return null; }

    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdSize = buf.readUInt32LE(eocdOffset + 12);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    if (cdOffset + cdSize > eocdOffset) { return null; }

    const entries = [];
    let cursor = cdOffset;
    for (let i = 0; i < totalEntries; i++) {
        if (cursor + 46 > cdOffset + cdSize || buf.readUInt32LE(cursor) !== 0x02014b50) {
            return null;
        }
        const method = buf.readUInt16LE(cursor + 10);
        if (method !== 0 && method !== 8) { return null; }
        const dosTime = buf.readUInt16LE(cursor + 12);
        const dosDate = buf.readUInt16LE(cursor + 14);
        const expectedCrc = buf.readUInt32LE(cursor + 16);
        const compressedSize = buf.readUInt32LE(cursor + 20);
        const uncompressedSize = buf.readUInt32LE(cursor + 24);
        const nameLen = buf.readUInt16LE(cursor + 28);
        const extraLen = buf.readUInt16LE(cursor + 30);
        const commentLen = buf.readUInt16LE(cursor + 32);
        const externalAttrs = buf.readUInt32LE(cursor + 38);
        const localOffset = buf.readUInt32LE(cursor + 42);
        const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
        cursor += 46 + nameLen + extraLen + commentLen;

        if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
            return null;
        }
        const localNameLen = buf.readUInt16LE(localOffset + 26);
        const localExtraLen = buf.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        if (dataStart + compressedSize > buf.length) { return null; }

        const slice = buf.subarray(dataStart, dataStart + compressedSize);
        const rawData = method === 0 ? Buffer.from(slice) : inflateRawSync(slice);
        if (rawData.length !== uncompressedSize || crc32(rawData) !== expectedCrc) {
            return null;
        }
        const unixMode = (externalAttrs >>> 16) & 0xffff;
        entries.push({
            name,
            data: rawData,
            mode: unixMode || 0o100644,
            mtime: fromDosTimeDate(dosTime, dosDate),
        });
    }

    return buildZipBuffer(entries);
}

// ─── Pure Node USTAR TAR.GZ Builder ──────────────────────────────────────────

function writeOctal(buf, value, offset, length) {
    const str = Math.max(0, Math.floor(value)).toString(8).padStart(length - 1, '0');
    buf.write(str.slice(-(length - 1)), offset, length - 1, 'ascii');
    buf[offset + length - 1] = 0;
}

function splitUstarPath(fullPath) {
    const normalized = normalizeArchivePath(fullPath);
    if (Buffer.byteLength(normalized, 'utf8') <= 100) {
        return { prefix: '', name: normalized };
    }
    const slashIdx = normalized.lastIndexOf('/');
    if (slashIdx > 0) {
        const prefix = normalized.slice(0, slashIdx);
        const name = normalized.slice(slashIdx + 1);
        if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(name, 'utf8') <= 100) {
            return { prefix, name };
        }
    }
    throw new Error(`Archive path exceeds POSIX USTAR limits: ${normalized}`);
}

/**
 * Pure Node zero-dependency POSIX USTAR `.tar.gz` builder.
 * @param {Array<{ name: string, data: Buffer, mode?: number, mtime?: Date }>} entries
 * @returns {Buffer}
 */
export function buildTarGzBuffer(entries) {
    const blocks = [];

    for (const entry of entries) {
        const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
        const { prefix, name } = splitUstarPath(entry.name);
        const header = Buffer.alloc(512, 0);

        header.write(name, 0, 100, 'utf8');
        writeOctal(header, (entry.mode ?? 0o644) & 0o777, 100, 8);
        writeOctal(header, 0, 108, 8);               // uid
        writeOctal(header, 0, 116, 8);               // gid
        writeOctal(header, rawData.length, 124, 12); // size
        const mtimeSec = entry.mtime instanceof Date
            ? Math.floor(entry.mtime.getTime() / 1000)
            : Math.floor(Date.now() / 1000);
        writeOctal(header, mtimeSec, 136, 12);       // mtime
        header.fill(0x20, 148, 156);                 // checksum placeholder (spaces)
        header[156] = 0x30;                          // typeflag '0' (regular file)
        header.write('ustar\0', 257, 6, 'ascii');
        header.write('00', 263, 2, 'ascii');
        if (prefix) {
            header.write(prefix, 345, 155, 'utf8');
        }

        let sum = 0;
        for (let i = 0; i < 512; i++) { sum += header[i]; }
        writeOctal(header, sum, 148, 7);
        header[155] = 0x20;

        blocks.push(header);
        if (rawData.length > 0) {
            blocks.push(rawData);
            const remainder = rawData.length % 512;
            if (remainder !== 0) {
                blocks.push(Buffer.alloc(512 - remainder, 0));
            }
        }
    }

    // Two 512-byte zero blocks mark end-of-archive
    blocks.push(Buffer.alloc(1024, 0));
    return gzipSync(Buffer.concat(blocks), { level: 9 });
}

// ─── File Collection & Allowlist Enforcement ─────────────────────────────────

function collectEntries(rootDir, archivePrefix) {
    const entries = [];
    function walk(currentDir) {
        const names = readdirSync(currentDir).sort();
        for (const name of names) {
            if (name === '.DS_Store' || name === 'Thumbs.db') { continue; }
            const fullPath = join(currentDir, name);
            const st = statSync(fullPath);
            if (st.isDirectory()) {
                walk(fullPath);
            } else if (st.isFile()) {
                const rel = normalizeArchivePath(relative(rootDir, fullPath));
                const archiveName = archivePrefix ? `${archivePrefix}/${rel}` : rel;
                const isExec = name.endsWith('.sh') || APP_EXECUTABLE_FILES.has(rel) || (st.mode & 0o111) !== 0;
                entries.push({
                    name: archiveName,
                    relPath: rel,
                    data: readFileSync(fullPath),
                    mode: isExec ? 0o100755 : 0o100644,
                    mtime: st.mtime,
                });
            }
        }
    }
    walk(rootDir);
    return entries;
}

function readJsonNoBom(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function minifyStagedMainMjs(stagedMainPath) {
    let esbuildMod = null;
    try {
        esbuildMod = require('esbuild');
    } catch {
        return { minified: false, beforeBytes: statSync(stagedMainPath).size, afterBytes: statSync(stagedMainPath).size };
    }
    const raw = readFileSync(stagedMainPath, 'utf8');
    const beforeBytes = Buffer.byteLength(raw, 'utf8');
    const shebangMatch = raw.match(/^(#![^\r\n]*\r?\n)/);
    const shebang = shebangMatch ? shebangMatch[1] : '';
    const body = shebang ? raw.slice(shebang.length) : raw;

    const transformed = esbuildMod.transformSync(body, {
        loader: 'js',
        format: 'esm',
        minify: true,
        target: 'node22',
        legalComments: 'none',
        charset: 'utf8',
    }).code;
    const finalText = shebang + transformed;
    if (Buffer.byteLength(finalText, 'utf8') < beforeBytes) {
        writeFileSync(stagedMainPath, finalText, 'utf8');
        if (process.platform !== 'win32') {
            chmodSync(stagedMainPath, 0o755);
        }
        // Fail closed if minified ESM syntax ever breaks Node's parser
        try {
            execFileSync(process.execPath, ['--check', stagedMainPath], {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
        } catch (err) {
            // Restore original readable copy and surface failure clearly
            writeFileSync(stagedMainPath, raw, 'utf8');
            if (process.platform !== 'win32') {
                chmodSync(stagedMainPath, 0o755);
            }
            const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr || '') : String(err);
            throw new Error(`Minified staged main.mjs failed \`node --check\`: ${stderr.trim()}`);
        }
        return { minified: true, beforeBytes, afterBytes: Buffer.byteLength(finalText, 'utf8') };
    }
    return { minified: false, beforeBytes, afterBytes: beforeBytes };
}

function copyAllowlistedAppPluginFiles(appPluginSrc, stageDir) {
    let mainMjsStats = null;
    for (const rel of APP_PLUGIN_ALLOWLIST) {
        const srcPath = join(appPluginSrc, rel);
        if (!existsSync(srcPath) || !statSync(srcPath).isFile()) {
            throw new Error(`Missing allowlisted plugin file: app-plugin/${rel}`);
        }
        const dstPath = join(stageDir, rel);
        mkdirSync(dirname(dstPath), { recursive: true });
        cpSync(srcPath, dstPath);
        if (process.platform !== 'win32' && APP_EXECUTABLE_FILES.has(rel)) {
            chmodSync(dstPath, 0o755);
        }
        if (rel === 'sidecars/context_monitor/main.mjs') {
            mainMjsStats = minifyStagedMainMjs(dstPath);
        }
    }
    return { mainMjsStats };
}

function copyFilteredOutJs(srcDir, dstDir) {
    mkdirSync(dstDir, { recursive: true });
    for (const name of readdirSync(srcDir).sort()) {
        if (name === '.DS_Store' || name === 'Thumbs.db') { continue; }
        const srcPath = join(srcDir, name);
        const dstPath = join(dstDir, name);
        const st = statSync(srcPath);
        if (st.isDirectory()) {
            copyFilteredOutJs(srcPath, dstPath);
        } else if (
            st.isFile()
            && name.endsWith('.js')
            && !name.endsWith('.map')
            && !name.endsWith('.test.js')
            && !name.endsWith('.spec.js')
        ) {
            cpSync(srcPath, dstPath);
        }
    }
}

function assertCleanStageEntries(entries, runtimeMode) {
    const allowedExactSet = new Set([
        ...APP_PLUGIN_ALLOWLIST,
        'sidecars/context_monitor/runtime/package.json',
        ...APP_BUNDLED_RUNTIME_FILES.map((f) => `sidecars/context_monitor/runtime/out/app/${f}`),
    ]);

    for (const entry of entries) {
        const rel = entry.relPath;
        const base = basename(rel);
        const lower = rel.toLowerCase();
        if (BANNED_BASENAMES.has(base)) {
            throw new Error(`Allowlist violation: banned file "${rel}" staged in App plugin.`);
        }
        for (const ext of BANNED_ARTIFACT_EXTENSIONS) {
            if (lower.endsWith(ext)) {
                throw new Error(`Allowlist violation: banned "${ext}" artifact "${rel}" staged in App plugin.`);
            }
        }
        if (lower.endsWith('.test.js') || lower.endsWith('.spec.js')) {
            throw new Error(`Allowlist violation: test file "${rel}" staged in App plugin.`);
        }
        if (runtimeMode === 'bundled' && !allowedExactSet.has(rel)) {
            throw new Error(`Allowlist violation: unexpected non-allowlisted file "${rel}" in bundled App plugin.`);
        }
        if (APP_EXECUTABLE_FILES.has(rel) && ((entry.mode ?? 0) & 0o111) === 0) {
            throw new Error(`Executable bit violation: "${rel}" must have mode 0o755 in App plugin archive.`);
        }
    }
    const stagedRelPaths = new Set(entries.map((e) => e.relPath));
    for (const execRel of APP_EXECUTABLE_FILES) {
        if (!stagedRelPaths.has(execRel)) {
            throw new Error(`Missing required executable entry "${execRel}" in App plugin archive.`);
        }
    }
}

function verifyBundledRealProviderMarker(runtimeEntryPath) {
    const resolved = resolve(runtimeEntryPath);
    delete require.cache[resolved];
    const mod = require(resolved);
    if (!mod || mod.ACM_REAL_PROVIDER !== true || typeof mod.createSidecarRuntimeProvider !== 'function') {
        throw new Error(
            `Bundled sidecar-runtime.js failed positive real-provider check (ACM_REAL_PROVIDER === ${String(mod?.ACM_REAL_PROVIDER)}).`,
        );
    }
    return {
        version: mod.ACM_VERSION,
        buildId: typeof mod.ACM_BUILD_ID === 'string' && mod.ACM_BUILD_ID ? mod.ACM_BUILD_ID : null,
    };
}

// ─── SHA-256 Checksum Helpers ────────────────────────────────────────────────

export function computeSha256Hex(data) {
    return createHash('sha256').update(data).digest('hex');
}

export function computeFileSha256Hex(filePath) {
    return computeSha256Hex(readFileSync(filePath));
}

/**
 * Formats checksum entries into standard GNU `sha256sum` text (UTF-8, LF, no BOM).
 * @param {Array<{ filename: string, sha256: string }>} entries
 * @returns {string}
 */
export function formatSha256Sums(entries) {
    return entries
        .map(({ filename, sha256 }) => `${String(sha256).toLowerCase()}  ${basename(filename)}`)
        .join('\n') + '\n';
}

function findAgyCliBinary() {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const home = homedir();
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
            // Try next candidate
        }
    }
    return null;
}

export function validateWithAgyCli(targetPath) {
    const agyBin = findAgyCliBinary();
    if (!agyBin) {
        return { ran: false, ok: true, skipped: true, findings: [] };
    }
    try {
        const out = execFileSync(agyBin, ['plugin', 'validate', '--strict', '--json', targetPath], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const trimmed = out.trim();
        let report = null;
        try {
            report = JSON.parse(trimmed);
        } catch {
            return {
                ran: true,
                ok: false,
                output: `Invalid JSON from agy plugin validate --strict --json:\n${trimmed}`,
                findings: null,
            };
        }
        const findings = Array.isArray(report?.findings) ? report.findings : null;
        if (!findings || findings.length > 0) {
            return {
                ran: true,
                ok: false,
                output: trimmed,
                findings: findings || [],
            };
        }
        return { ran: true, ok: true, output: trimmed, findings: [] };
    } catch (err) {
        if (err && typeof err === 'object' && err.code === 'ENOENT') {
            return { ran: false, ok: true, skipped: true, findings: [] };
        }
        const stderr = err && err.stderr ? String(err.stderr) : '';
        const stdout = err && err.stdout ? String(err.stdout) : '';
        return { ran: true, ok: false, output: `${stdout}\n${stderr}`.trim(), findings: null };
    }
}

function formatBytesMb(bytes) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB (${(bytes / 1024).toFixed(1)} KB)`;
}

export function packageAppPlugin(options = {}) {
    const repoRoot = options.repoRoot || REPO_ROOT;
    const appPluginSrc = join(repoRoot, 'app-plugin');
    const distStageAppSrc = join(repoRoot, 'dist-stage', 'app');
    const outSrc = join(repoRoot, 'out');
    const distRoot = options.distRoot || join(repoRoot, 'dist');
    const skipValidation = Boolean(options.skipValidation);
    const requireAll = Boolean(options.requireAll);
    const includeVsix = requireAll || options.includeVsix !== false;
    const requireBundled = Boolean(options.requireBundled);
    const manifest = readJsonNoBom(join(appPluginSrc, 'plugin.json'));
    const version = manifest.version;
    const strictSize = requiresReleaseSize(version) || Boolean(options.strictSize);
    const enforceSizeCeilings = options.enforceSizeCeilings !== false;
    const baseCeilings = strictSize ? RELEASE_STRICT_SIZE_CEILINGS : ARTIFACT_SIZE_CEILINGS;
    const ceilings = {
        ...baseCeilings,
        ...(options.sizeCeilings || {}),
    };

    if (!existsSync(join(appPluginSrc, 'plugin.json'))) {
        throw new Error(`Missing app-plugin/plugin.json under ${repoRoot}`);
    }

    const hasBundledRuntime = APP_BUNDLED_RUNTIME_FILES.every((f) => existsSync(join(distStageAppSrc, f)));
    if (requireBundled && !hasBundledRuntime) {
        throw new Error(
            `Missing isolated esbuild App Sidecar bundle under ${distStageAppSrc}. ` +
            'Run `npm run build:bundles` first.',
        );
    }

    const runtimeMode = hasBundledRuntime ? 'bundled' : 'compiled-out';
    if (runtimeMode === 'compiled-out') {
        const requiredCompiledFiles = [
            'webview-document.js',
            join('app', 'sidecar-server.js'),
            join('app', 'sidecar-runtime.js'),
        ];
        for (const rel of requiredCompiledFiles) {
            if (!existsSync(join(outSrc, rel))) {
                throw new Error(
                    `Missing compiled runtime (${distStageAppSrc} and out/${rel.replace(/\\/g, '/')}). ` +
                    'Run `npm run build:bundles` or `npm run compile` first.',
                );
            }
        }
    }

    const stageDir = join(distRoot, 'antigravity-context-monitor-app');
    const runtimeDir = join(stageDir, 'sidecars', 'context_monitor', 'runtime');
    const runtimeOutAppDir = join(runtimeDir, 'out', 'app');

    rmSync(stageDir, { recursive: true, force: true });
    mkdirSync(stageDir, { recursive: true });

    // 1. Copy strictly allowlisted plugin metadata, logo, sidecar entrypoint, and skill
    //    (losslessly minifying only the staged copy of main.mjs while keeping git source readable)
    const { mainMjsStats } = copyAllowlistedAppPluginFiles(appPluginSrc, stageDir);

    // 2. Copy runtime: prefer isolated esbuild bundle (allowlist of 3 files),
    //    or allowlisted compiled JS fallback for synthetic fixture tests.
    let buildId = null;
    let appTopInputs = null;
    let ideTopInputs = null;
    if (runtimeMode === 'bundled') {
        mkdirSync(runtimeOutAppDir, { recursive: true });
        for (const fileName of APP_BUNDLED_RUNTIME_FILES) {
            cpSync(join(distStageAppSrc, fileName), join(runtimeOutAppDir, fileName));
        }
        const manifestPath = join(distStageAppSrc, 'manifest.json');
        if (existsSync(manifestPath)) {
            const stageManifest = readJsonNoBom(manifestPath);
            if (typeof stageManifest.buildId === 'string' && stageManifest.buildId.trim()) {
                buildId = stageManifest.buildId.trim();
            }
            if (Array.isArray(stageManifest.topInputs)) {
                appTopInputs = stageManifest.topInputs;
            }
        }
        const ideManifestPath = join(repoRoot, 'dist-stage', 'ide', 'manifest.json');
        if (existsSync(ideManifestPath)) {
            try {
                const ideStageManifest = readJsonNoBom(ideManifestPath);
                if (Array.isArray(ideStageManifest.topInputs)) {
                    ideTopInputs = ideStageManifest.topInputs;
                }
            } catch { /* ignore */ }
        }
        const verified = verifyBundledRealProviderMarker(join(runtimeOutAppDir, 'sidecar-runtime.js'));
        const launcherPath = join(appPluginSrc, 'sidecars', 'context_monitor', 'main.mjs');
        const launcherHash = computeFileSha256Hex(launcherPath).slice(0, 16);
        const actualBuildId = createHash('sha256').update(launcherHash)
            .update(readFileSync(join(runtimeOutAppDir, 'sidecar-bundle.js'))).digest('hex').slice(0, 16);
        if (verified.buildId !== actualBuildId || (buildId && buildId !== actualBuildId) || verified.version !== version) {
            throw new Error('App bundle buildId/version does not match the launcher and runtime. Rebuild before packaging.');
        }
        buildId = actualBuildId;
    } else {
        copyFilteredOutJs(outSrc, join(runtimeDir, 'out'));
    }

    if (!buildId) {
        const runtimeBytes = readFileSync(join(runtimeOutAppDir, 'sidecar-runtime.js'));
        buildId = computeSha256Hex(runtimeBytes).slice(0, 16);
    }

    // Legacy offline PNG screenshots (src/images/*.png) are intentionally excluded
    // by the v1.18.0 allowlist packaging contract to eliminate ~2.9 MB bloat.
    const bundledImages = [];

    const hasSidecarRuntime = existsSync(join(runtimeOutAppDir, 'sidecar-runtime.js'));
    const hasWebviewDocument = runtimeMode === 'bundled'
        ? existsSync(join(runtimeOutAppDir, 'sidecar-bundle.js'))
        : existsSync(join(runtimeDir, 'out', 'webview-document.js'));

    // 3. Write minimal runtime package.json with content-hash buildId (UTF-8, no BOM)
    const runtimePkg = {
        name: 'antigravity-context-monitor-app-runtime',
        version,
        buildId,
        bundled: runtimeMode === 'bundled',
        private: true,
        license: 'MIT',
    };
    writeFileSync(join(runtimeDir, 'package.json'), JSON.stringify(runtimePkg, null, 2) + '\n', 'utf8');

    // 4. Collect staged entries & enforce strict allowlist audit
    const entries = collectEntries(stageDir, PLUGIN_DIR_NAME);
    assertCleanStageEntries(entries, runtimeMode);

    // 5. Validate assembled plugin directory with `agy plugin validate --strict` if available
    let validation = { ran: false, ok: true, skipped: true, findings: [] };
    if (!skipValidation) {
        validation = validateWithAgyCli(stageDir);
        if (strictSize && requireAll && !validation.ran) {
            throw new Error('Candidate packaging requires agy plugin validate --strict --json.');
        }
        if (!validation.ok) {
            throw new Error(`agy plugin validate --strict failed:\n${validation.output}`);
        }
    }

    // 6. Build cross-platform zero-dependency .zip and .tar.gz archives
    const zipFilename = `antigravity-context-monitor-app-${version}.zip`;
    const tarGzFilename = `antigravity-context-monitor-app-${version}.tar.gz`;

    const zipBuf = buildZipBuffer(entries);
    const tarGzBuf = buildTarGzBuffer(entries);

    const appUncompressedBytes = entries.reduce((sum, e) => sum + e.data.length, 0);
    const appZipBytes = zipBuf.length;
    const appTarGzBytes = tarGzBuf.length;

    if (enforceSizeCeilings && appZipBytes > ceilings.appZipMaxBytes) {
        throw new Error(
            `App ZIP size ceiling exceeded: ${formatBytesMb(appZipBytes)} > hard ceiling ${formatBytesMb(ceilings.appZipMaxBytes)}.`,
        );
    }

    // 7. Locate VSIX (preferring distRoot over repoRoot) and audit its size & contents if present (or hard-fail under --require-all)
    const vsixFilename = `antigravity-context-monitor-${version}.vsix`;
    const candidateVsix = join(distRoot, vsixFilename);
    const foundVsixPath = includeVsix && existsSync(candidateVsix) && statSync(candidateVsix).isFile()
        ? candidateVsix : null;

    if (requireAll && !foundVsixPath) {
        throw new Error(
            `Missing required IDE VSIX artifact "${vsixFilename}" in the output directory. ` +
            'Run `npm run package` before `node scripts/package-app-plugin.mjs --require-all` so dist/SHA256SUMS.txt covers all 3 release artifacts.',
        );
    }

    let vsixMetrics = null;
    let effectiveCeilings = ceilings;
    let vsixGateProfile = strictSize ? 'strict-release' : 'pre-readme-trim';
    if (foundVsixPath) {
        const vsixBuf = readFileSync(foundVsixPath);
        const inspected = inspectZipBuffer(vsixBuf);
        if (!inspected) {
            throw new Error(`VSIX artifact "${foundVsixPath}" is not a valid PKZIP archive.`);
        }
        const readmeEntry = inspected
            ? inspected.entries.find((e) => e.name.toLowerCase() === 'extension/readme.md')
            : null;
        const iconEntry = inspected
            ? inspected.entries.find((e) => e.name.toLowerCase() === 'extension/assets/icon.png')
            : null;
        const extJsEntry = inspected
            ? inspected.entries.find((e) => e.name.toLowerCase() === 'extension/dist-stage/ide/extension.js')
            : null;
        const stagedIdeExtPath = join(repoRoot, 'dist-stage', 'ide', 'extension.js');
        if (existsSync(stagedIdeExtPath) && statSync(stagedIdeExtPath).isFile()) {
            if (!extJsEntry) {
                throw new Error(`VSIX binding check failed: "${vsixFilename}" is missing extension/dist-stage/ide/extension.js.`);
            }
            const embeddedExtBuf = readZipEntryBuffer(vsixBuf, extJsEntry);
            if (!embeddedExtBuf) {
                throw new Error(`VSIX binding check failed: unable to extract extension/dist-stage/ide/extension.js from "${vsixFilename}".`);
            }
            const expectedSha = computeFileSha256Hex(stagedIdeExtPath);
            const actualSha = computeSha256Hex(embeddedExtBuf);
            if (actualSha !== expectedSha) {
                throw new Error(
                    `VSIX binding check failed: "${vsixFilename}" embeds stale extension.js (${actualSha.slice(0, 12)}) != dist-stage/ide/extension.js (${expectedSha.slice(0, 12)}). Re-run \`npm run package\` before emitting SHA256SUMS.txt.`,
                );
            }
        }
        const readmeTrimmed = Boolean(readmeEntry && readmeEntry.uncompressedSize <= README_TRIMMED_THRESHOLD_BYTES);
        if (!strictSize && readmeTrimmed) {
            const iconExtraComp = iconEntry ? iconEntry.compressedSize : 0;
            const iconExtraRaw = iconEntry ? iconEntry.uncompressedSize : 0;
            effectiveCeilings = {
                ...POST_README_TRIM_SIZE_CEILINGS,
                vsixCompressedMaxBytes: POST_README_TRIM_SIZE_CEILINGS.vsixCompressedMaxBytes + iconExtraComp,
                vsixUncompressedMaxBytes: POST_README_TRIM_SIZE_CEILINGS.vsixUncompressedMaxBytes + iconExtraRaw,
                ...(options.sizeCeilings || {}),
            };
            vsixGateProfile = iconEntry ? 'post-readme-trim+icon' : 'post-readme-trim';
        }
        vsixMetrics = {
            path: foundVsixPath,
            compressedBytes: vsixBuf.length,
            uncompressedBytes: inspected ? inspected.uncompressedBytes : null,
            entryCount: inspected ? inspected.entryCount : null,
            entries: inspected ? inspected.entries.map((e) => e.name) : null,
            readmeBytes: readmeEntry ? readmeEntry.uncompressedSize : null,
            readmeCompressedBytes: readmeEntry ? readmeEntry.compressedSize : null,
            readmeTrimmed,
            iconBytes: iconEntry ? iconEntry.uncompressedSize : null,
            extensionJsBytes: extJsEntry ? extJsEntry.uncompressedSize : null,
            extensionJsCompressedBytes: extJsEntry ? extJsEntry.compressedSize : null,
            gateProfile: vsixGateProfile,
            stretchTarget: {
                vsixCompressedMaxBytes: BLUEPRINT_VSIX_ESTIMATE_BYTES.vsixCompressedBytes,
                vsixUncompressedMaxBytes: BLUEPRINT_VSIX_ESTIMATE_BYTES.vsixUncompressedBytes,
            },
        };
        if (enforceSizeCeilings) {
            if (vsixMetrics.compressedBytes > effectiveCeilings.vsixCompressedMaxBytes) {
                throw new Error(
                    `VSIX compressed size ceiling exceeded: ${formatBytesMb(vsixMetrics.compressedBytes)} > hard ceiling ${formatBytesMb(effectiveCeilings.vsixCompressedMaxBytes)}.`,
                );
            }
            if (vsixMetrics.uncompressedBytes !== null && vsixMetrics.uncompressedBytes > effectiveCeilings.vsixUncompressedMaxBytes) {
                throw new Error(
                    `VSIX uncompressed size ceiling exceeded: ${formatBytesMb(vsixMetrics.uncompressedBytes)} > hard ceiling ${formatBytesMb(effectiveCeilings.vsixUncompressedMaxBytes)}.`,
                );
            }
        }
        if (inspected) {
            for (const entry of inspected.entries) {
                const lower = entry.name.toLowerCase();
                const isAllowedMarketplaceIcon = lower === 'extension/assets/icon.png';
                if (lower.endsWith('.map') || (lower.endsWith('.png') && !isAllowedMarketplaceIcon) || lower.endsWith('.test.js')) {
                    throw new Error(`VSIX allowlist audit failed: banned file "${entry.name}" inside ${vsixFilename}.`);
                }
            }
        }
    }

    // Local builds cannot invalidate the archives named by a prior release manifest.
    const archiveDir = foundVsixPath ? distRoot : join(distRoot, 'app-only');
    mkdirSync(archiveDir, { recursive: true });
    const zipPath = join(archiveDir, zipFilename);
    const tarGzPath = join(archiveDir, tarGzFilename);
    // 8. Emit the canonical manifest only for the complete release.
    const checksumEntries = [
        { filename: zipFilename, path: zipPath, sha256: computeSha256Hex(zipBuf) },
        { filename: tarGzFilename, path: tarGzPath, sha256: computeSha256Hex(tarGzBuf) },
    ];
    if (foundVsixPath) {
        checksumEntries.push({
            filename: vsixFilename,
            path: foundVsixPath,
            sha256: computeFileSha256Hex(foundVsixPath),
        });
    }
    if (requireAll && checksumEntries.length !== 3) {
        throw new Error(`Expected exactly 3 artifacts in dist/SHA256SUMS.txt, found ${checksumEntries.length}.`);
    }

    writeFileSync(zipPath, zipBuf);
    writeFileSync(tarGzPath, tarGzBuf);
    const checksumsPath = foundVsixPath ? join(distRoot, 'SHA256SUMS.txt') : null;
    if (checksumsPath) {
        writeFileSync(checksumsPath, formatSha256Sums(checksumEntries), 'utf8');
    }

    return {
        version,
        buildId,
        runtimeMode,
        stageDir,
        zipPath,
        tarGzPath,
        checksumsPath,
        checksums: checksumEntries.map(({ filename, sha256 }) => ({ filename, sha256 })),
        vsixIncluded: Boolean(foundVsixPath),
        entryCount: entries.length,
        validation,
        hasSidecarRuntime,
        hasWebviewDocument,
        bundledImages,
        mainMjsStats,
        topInputs: {
            app: appTopInputs,
            ide: ideTopInputs,
        },
        sizes: {
            appUncompressedBytes,
            appZipBytes,
            appTarGzBytes,
            vsix: vsixMetrics,
            ceilings: effectiveCeilings,
        },
    };
}

export function packageVsixToDist(options = {}) {
    const repoRoot = options.repoRoot || REPO_ROOT;
    const distRoot = options.distRoot || join(repoRoot, 'dist');
    const pkg = readJsonNoBom(join(repoRoot, 'package.json'));
    const name = String(pkg.name || PLUGIN_DIR_NAME).trim();
    const version = pkg.version;
    requiresReleaseSize(version);
    const vsixPath = join(distRoot, `${name}-${version}.vsix`);
    mkdirSync(distRoot, { recursive: true });

    const vsceBin = join(repoRoot, 'node_modules', '@vscode', 'vsce', 'vsce');
    if (!existsSync(vsceBin)) {
        throw new Error(`Pinned local @vscode/vsce binary not found at ${vsceBin}. Run \`npm ci\` first.`);
    }

    const extraArgs = Array.isArray(options.extraArgs) ? options.extraArgs : [];
    const vsceArgs = ['package', '--no-dependencies', '-o', vsixPath, ...extraArgs];
    execFileSync(process.execPath, [vsceBin, ...vsceArgs], {
        cwd: repoRoot,
        stdio: 'inherit',
        windowsHide: true,
    });

    if (!existsSync(vsixPath)) {
        throw new Error(`Expected VSIX artifact was not created at ${vsixPath}`);
    }
    let vsixBuf = readFileSync(vsixPath);
    const optimizedBuf = recompressZipBufferLevel9(vsixBuf);
    if (optimizedBuf && optimizedBuf.length < vsixBuf.length) {
        writeFileSync(vsixPath, optimizedBuf);
        vsixBuf = optimizedBuf;
    }
    const inspected = inspectZipBuffer(vsixBuf);
    return {
        vsixPath,
        version,
        compressedBytes: vsixBuf.length,
        uncompressedBytes: inspected ? inspected.uncompressedBytes : null,
        entryCount: inspected ? inspected.entryCount : null,
    };
}

// Run as CLI when executed directly
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const rawArgs = process.argv.slice(2);
    const args = new Set(rawArgs);

    if (args.has('--package-vsix')) {
        const extraArgs = rawArgs.filter((a) => a !== '--package-vsix');
        try {
            const res = packageVsixToDist({ extraArgs });
            const uncomp = res.uncompressedBytes !== null ? formatBytesMb(res.uncompressedBytes) : 'n/a';
            console.log(`[package-app-plugin] Packaged IDE VSIX v${res.version} -> ${res.vsixPath}`);
            console.log(`  VSIX size : compressed ${formatBytesMb(res.compressedBytes)}, uncompressed ${uncomp} (${res.entryCount ?? '?'} files)`);
            process.exit(0);
        } catch (err) {
            console.error(`[package-app-plugin] ERROR: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        }
    }

    const requireAll = args.has('--require-all') || !args.has('--app-only');
    const requireBundled = true;
    const strictSize = args.has('--strict-size');
    const skipValidation = args.has('--skip-validation');
    const jsonMode = args.has('--json');

    try {
        const result = packageAppPlugin({ requireAll, includeVsix: requireAll, requireBundled, strictSize, skipValidation });
        if (jsonMode) {
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        } else {
            console.log(`[package-app-plugin] Packaged v${result.version} (${result.entryCount} files, mode=${result.runtimeMode}, buildId=${result.buildId})`);
            console.log(`  Stage dir : ${result.stageDir}`);
            console.log(`  ZIP       : ${result.zipPath} — ${formatBytesMb(result.sizes.appZipBytes)} (hard ceiling < 0.55 MB / 563.2 KB; headroom ${((result.sizes.ceilings.appZipMaxBytes - result.sizes.appZipBytes) / 1024).toFixed(1)} KB)`);
            console.log(`  TAR.GZ    : ${result.tarGzPath} — ${formatBytesMb(result.sizes.appTarGzBytes)}`);
            console.log(`  App raw   : ${formatBytesMb(result.sizes.appUncompressedBytes)} (${result.entryCount} allowlisted files, 0 legacy PNGs)`);
            if (result.mainMjsStats) {
                const m = result.mainMjsStats;
                console.log(`  main.mjs  : staged minified ${(m.beforeBytes / 1024).toFixed(1)} KB -> ${(m.afterBytes / 1024).toFixed(1)} KB (${m.minified ? 'esbuild+node--check OK' : 'raw fallback'})`);
            }
            if (result.sizes.vsix) {
                const v = result.sizes.vsix;
                const c = result.sizes.ceilings;
                const uncompLabel = v.uncompressedBytes !== null ? formatBytesMb(v.uncompressedBytes) : 'n/a';
                const gateLabel = `${v.gateProfile} ceiling <= ${(c.vsixCompressedMaxBytes / 1024).toFixed(0)} KB / <= ${(c.vsixUncompressedMaxBytes / (1024 * 1024)).toFixed(2)} MB`;
                console.log(`  VSIX      : ${v.path} — compressed ${formatBytesMb(v.compressedBytes)}, uncompressed ${uncompLabel} (${v.entryCount ?? '?'} files; ${gateLabel})`);
                const stretchCompDiffKb = ((v.compressedBytes - BLUEPRINT_VSIX_ESTIMATE_BYTES.vsixCompressedBytes) / 1024).toFixed(1);
                const stretchRawDiffKb = v.uncompressedBytes !== null
                    ? ((v.uncompressedBytes - BLUEPRINT_VSIX_ESTIMATE_BYTES.vsixUncompressedBytes) / 1024).toFixed(1)
                    : 'n/a';
                const extFloor = v.extensionJsBytes !== null
                    ? `extension.js floor=${(v.extensionJsBytes / 1024).toFixed(1)} KB raw / ${(v.extensionJsCompressedBytes / 1024).toFixed(1)} KB deflated`
                    : 'extension.js floor=n/a';
                const readmeInfo = v.readmeBytes !== null
                    ? `, readme.md=${(v.readmeBytes / 1024).toFixed(1)} KB raw / ${(v.readmeCompressedBytes / 1024).toFixed(1)} KB deflated`
                    : '';
                const iconInfo = v.iconBytes !== null ? `, icon.png=${(v.iconBytes / 1024).toFixed(1)} KB` : '';
                console.log(`  VSIX floor: ${extFloor}${readmeInfo}${iconInfo} | vs pre-Plan-C §4.3 blueprint estimate (400 KB / 1.00 MB): ${Number(stretchCompDiffKb) >= 0 ? '+' : ''}${stretchCompDiffKb} KB comp, ${stretchRawDiffKb !== 'n/a' && Number(stretchRawDiffKb) >= 0 ? '+' : ''}${stretchRawDiffKb} KB raw`);
            }
            if (Array.isArray(result.topInputs?.app) && result.topInputs.app.length > 0) {
                console.log('  App Top-10 metafile contributors:');
                for (const item of result.topInputs.app) {
                    console.log(`    - ${(item.bytes / 1024).toFixed(1).padStart(6)} KB  ${item.path}`);
                }
            }
            if (Array.isArray(result.topInputs?.ide) && result.topInputs.ide.length > 0) {
                console.log('  IDE Top-10 metafile contributors:');
                for (const item of result.topInputs.ide) {
                    console.log(`    - ${(item.bytes / 1024).toFixed(1).padStart(6)} KB  ${item.path}`);
                }
            }
            if (result.checksumsPath) { console.log(`  SHA256SUMS: ${result.checksumsPath}`); }
            console.log(`  Runtime   : sidecar-runtime=${result.hasSidecarRuntime ? 'yes' : 'no'}, webview-document=${result.hasWebviewDocument ? 'yes' : 'fallback'}, images=${result.bundledImages.length}`);
            if (result.validation.ran) {
                console.log('  Validation: agy plugin validate --strict --json PASSED (0 findings)');
            } else {
                console.log('  Validation: skipped (`agy` CLI not on PATH)');
            }
        }
    } catch (err) {
        console.error(`[package-app-plugin] ERROR: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

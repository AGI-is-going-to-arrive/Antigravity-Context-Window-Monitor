#!/usr/bin/env node
/**
 * Cross-platform packager for the Antigravity App Sidecar plugin.
 *
 * Pure Node.js with zero external npm or OS archive binary dependencies
 * (no `zip`, no Windows `tar.exe` / MSYS2 collisions).
 *
 * Outputs:
 *   - dist/antigravity-context-monitor-app/
 *   - dist/antigravity-context-monitor-app-<version>.zip
 *   - dist/antigravity-context-monitor-app-<version>.tar.gz
 *   - dist/SHA256SUMS.txt
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    cpSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PLUGIN_DIR_NAME = 'antigravity-context-monitor';

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
        const deflated = deflateRawSync(rawData, { level: 6 });
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
    return gzipSync(Buffer.concat(blocks), { level: 6 });
}

// ─── File Collection & Packaging ─────────────────────────────────────────────

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
                const isExec = name.endsWith('.sh') || (st.mode & 0o111) !== 0;
                entries.push({
                    name: archiveName,
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

function copyFilteredDir(srcDir, dstDir, filterFn) {
    mkdirSync(dstDir, { recursive: true });
    for (const name of readdirSync(srcDir)) {
        if (name === '.DS_Store' || name === 'Thumbs.db') { continue; }
        const srcPath = join(srcDir, name);
        const dstPath = join(dstDir, name);
        const st = statSync(srcPath);
        if (filterFn && !filterFn(srcPath, name, st)) { continue; }
        if (st.isDirectory()) {
            copyFilteredDir(srcPath, dstPath, filterFn);
        } else if (st.isFile()) {
            cpSync(srcPath, dstPath);
        }
    }
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

export function packageAppPlugin(options = {}) {
    const repoRoot = options.repoRoot || REPO_ROOT;
    const appPluginSrc = join(repoRoot, 'app-plugin');
    const outSrc = join(repoRoot, 'out');
    const imagesSrc = join(repoRoot, 'src', 'images');
    const distRoot = options.distRoot || join(repoRoot, 'dist');
    const skipValidation = Boolean(options.skipValidation);

    if (!existsSync(join(appPluginSrc, 'plugin.json'))) {
        throw new Error(`Missing app-plugin/plugin.json under ${repoRoot}`);
    }
    const requiredCompiledFiles = [
        'webview-document.js',
        join('app', 'sidecar-server.js'),
        join('app', 'sidecar-runtime.js'),
    ];
    for (const rel of requiredCompiledFiles) {
        if (!existsSync(join(outSrc, rel))) {
            throw new Error(`Missing compiled out/${rel.replace(/\\/g, '/')}. Run \`npm run compile\` first.`);
        }
    }
    if (options.requireWebviewDocument && !existsSync(join(outSrc, 'webview-document.js'))) {
        throw new Error('Missing compiled out/webview-document.js. Run `npm run compile` first.');
    }

    const manifest = readJsonNoBom(join(appPluginSrc, 'plugin.json'));
    const version = String(manifest.version || '1.17.8').trim();
    const stageDir = join(distRoot, 'antigravity-context-monitor-app');
    const runtimeDir = join(stageDir, 'sidecars', 'context_monitor', 'runtime');

    rmSync(stageDir, { recursive: true, force: true });
    mkdirSync(stageDir, { recursive: true });

    // 1. Copy plugin manifest, logo, sidecar entrypoint, and skill
    copyFilteredDir(appPluginSrc, stageDir);

    // 2. Copy all compiled out/**/*.js runtime files (excluding source maps to keep package lean)
    copyFilteredDir(outSrc, join(runtimeDir, 'out'), (_p, name, st) => st.isDirectory() || (name.endsWith('.js') && !name.endsWith('.map')));

    // 3. Copy static offline PNG illustrations if present
    const bundledImages = [];
    if (existsSync(imagesSrc)) {
        const dstImagesDir = join(runtimeDir, 'src', 'images');
        copyFilteredDir(imagesSrc, dstImagesDir, (_p, name, st) => {
            if (st.isDirectory()) { return true; }
            const ok = /^[a-z0-9-]+\.png$/.test(name);
            if (ok) { bundledImages.push(name); }
            return ok;
        });
        bundledImages.sort();
    }

    const hasSidecarRuntime = existsSync(join(runtimeDir, 'out', 'app', 'sidecar-runtime.js'));
    const hasWebviewDocument = existsSync(join(runtimeDir, 'out', 'webview-document.js'));

    // 4. Write minimal runtime package.json (strict UTF-8, no BOM)
    const runtimePkg = {
        name: 'antigravity-context-monitor-app-runtime',
        version,
        private: true,
        license: 'MIT',
    };
    writeFileSync(join(runtimeDir, 'package.json'), JSON.stringify(runtimePkg, null, 2) + '\n', 'utf8');

    // 5. Validate assembled plugin directory with `agy plugin validate --strict` if available
    let validation = { ran: false, ok: true, skipped: true };
    if (!skipValidation) {
        validation = validateWithAgyCli(stageDir);
        if (!validation.ok) {
            throw new Error(`agy plugin validate --strict failed:\n${validation.output}`);
        }
    }

    // 6. Build cross-platform zero-dependency .zip and .tar.gz archives
    const entries = collectEntries(stageDir, PLUGIN_DIR_NAME);
    const zipFilename = `antigravity-context-monitor-app-${version}.zip`;
    const tarGzFilename = `antigravity-context-monitor-app-${version}.tar.gz`;
    const zipPath = join(distRoot, zipFilename);
    const tarGzPath = join(distRoot, tarGzFilename);

    const zipBuf = buildZipBuffer(entries);
    const tarGzBuf = buildTarGzBuffer(entries);
    writeFileSync(zipPath, zipBuf);
    writeFileSync(tarGzPath, tarGzBuf);

    // 7. Emit dist/SHA256SUMS.txt for release verification (zip, tar.gz, and optional root vsix)
    const checksumEntries = [
        { filename: zipFilename, path: zipPath, sha256: computeSha256Hex(zipBuf) },
        { filename: tarGzFilename, path: tarGzPath, sha256: computeSha256Hex(tarGzBuf) },
    ];
    const vsixFilename = `antigravity-context-monitor-${version}.vsix`;
    const vsixCandidates = [join(repoRoot, vsixFilename), join(distRoot, vsixFilename)];
    const foundVsixPath = vsixCandidates.find((p) => existsSync(p) && statSync(p).isFile()) || null;
    if (foundVsixPath) {
        checksumEntries.push({
            filename: vsixFilename,
            path: foundVsixPath,
            sha256: computeFileSha256Hex(foundVsixPath),
        });
    }
    const checksumsPath = join(distRoot, 'SHA256SUMS.txt');
    writeFileSync(checksumsPath, formatSha256Sums(checksumEntries), 'utf8');

    return {
        version,
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
    };
}

// Run as CLI when executed directly
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const result = packageAppPlugin();
        console.log(`[package-app-plugin] Packaged v${result.version} (${result.entryCount} files)`);
        console.log(`  Stage dir : ${result.stageDir}`);
        console.log(`  ZIP       : ${result.zipPath}`);
        console.log(`  TAR.GZ    : ${result.tarGzPath}`);
        console.log(`  SHA256SUMS: ${result.checksumsPath} (${result.checksums.map((c) => c.filename).join(', ')})`);
        console.log(`  Runtime   : sidecar-runtime=${result.hasSidecarRuntime ? 'yes' : 'no'}, webview-document=${result.hasWebviewDocument ? 'yes' : 'fallback'}, images=${result.bundledImages.length}`);
        if (result.validation.ran) {
            console.log('  Validation: agy plugin validate --strict --json PASSED (0 findings)');
        } else {
            console.log('  Validation: skipped (`agy` CLI not on PATH)');
        }
    } catch (err) {
        console.error(`[package-app-plugin] ERROR: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

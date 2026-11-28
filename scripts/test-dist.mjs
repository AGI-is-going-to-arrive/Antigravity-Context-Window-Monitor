#!/usr/bin/env node
/**
 * Out-of-Repo Extracted-Artifact Verification Lane (`npm run test:dist`, §8 #2).
 *
 * Extracts the built IDE VSIX, App Sidecar ZIP, App Sidecar tar.gz, standalone
 * `scripts/install-app-plugin.mjs`, and `app-plugin/bin/agy-statusline.mjs` into
 * a fresh temporary directory strictly OUTSIDE the repository with ZERO source
 * tree access and ZERO `node_modules`, and verifies every public entrypoint:
 *
 *   A. Exact 3-artifact manifest (`dist/SHA256SUMS.txt` == `.vsix` + `-app.zip` +
 *      `-app.tar.gz`), SHA-256 parity, zero `.map`/retired `.png`/`.d.ts`/`.test.js`,
 *      executable bits on `bin/agy-statusline.mjs` & `main.mjs`, size ceilings, and
 *      `agy plugin validate --strict --json` (0 findings when `agy` is installed).
 *   B. Extracted IDE VSIX: requires extracted `extension.js` with mock `vscode`,
 *      activates & deactivates cleanly with zero `node_modules` / repo files,
 *      verifies BOTH `node:sqlite` supported & unavailable fallback branches,
 *      and verifies 16-hex `ACM_BUILD_ID` presence.
 *   C. Extracted App Sidecar ZIP & tar.gz: executes extracted `main.mjs` positively
 *      loading the REAL bundled provider (`ACM_REAL_PROVIDER === true`, NEVER fallback!)
 *      in BOTH SDK adapter mode (mock `sidecar_sdk`, `getSnapshot` + `200 { unchanged: true }`)
 *      AND standalone mode (inert unpaired `/`, `401` unauthenticated `/api/snapshot`,
 *      one-time `/api/auth/pair` burning code + deleting `--pairing-file`, authenticated
 *      `/api/snapshot` + bodyless `304` on matching `If-None-Match`).
 *   D. Extracted standalone `install-app-plugin.mjs`: verifies BOTH downloaded-file mode
 *      AND stdin-pipe mode (`--status --json`, `--print-cdp-guide`, `--install --local-dir`
 *      + `--no-remote-fallback` into isolated temp `HOME`), fails closed without local dir
 *      under `--no-remote-fallback`, AND simulates upgrading from a v1.17.11 previous-release
 *      layout while preserving unrelated `config.json` keys.
 *   E. Extracted `bin/agy-statusline.mjs`: pipes redacted fixtures into the extracted binary
 *      outside the repo and verifies single-line output, ANSI/OSC/newline stripping,
 *      `NO_COLOR=1`, 10-currency (`CAD` -> `CA$`), and explicit `—` missing-metric markers.
 *   F. Browser bundle sanity: verifies CSP safety (`</script` escaped, zero forbidden
 *      Trusted Types constructs in CDP overlay), deterministic `buildId` content hashes,
 *      and `preload -> bridge -> client` injection order in rendered HTML.
 */

import assert from 'node:assert/strict';
import { APP_PLUGIN_ALLOWLIST, APP_BUNDLED_RUNTIME_FILES, requiresReleaseSize } from './package-app-plugin.mjs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import * as http from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, inflateRawSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PLUGIN_NAME = 'antigravity-context-monitor';

const PRE_README_TRIM_SIZE_CEILINGS = {
    vsixUncompressedMaxBytes: 1_866_465, // <= 1.78 MB pre-README-trim ceiling
    vsixCompressedMaxBytes: 532_480,     // <= 520 KB pre-README-trim ceiling
    appZipMaxBytes: 576_716,             // < 0.55 MB (563.2 KB) hard ceiling ALWAYS enforced
};

const POST_README_TRIM_SIZE_CEILINGS = {
    vsixUncompressedMaxBytes: 1_835_008, // <= 1.75 MB post-README-trim (+changelog) base ceiling
    vsixCompressedMaxBytes: 527_360,     // <= 515 KB post-README-trim (+changelog) base ceiling
    appZipMaxBytes: 576_716,             // < 0.55 MB (563.2 KB) hard ceiling ALWAYS enforced
};

// Calibrated v1.18.0+ release limits (75-module Plan C + D9 + Marketplace icon floor);
// App Sidecar ZIP < 0.55 MB (563.2 KB) stays strictly unchanged.
const STRICT_RELEASE_SIZE_CEILINGS = {
    vsixUncompressedMaxBytes: 1_625_292, // <= 1.55 MB calibrated v1.18.0+ release ceiling
    vsixCompressedMaxBytes: 573_440,     // <= 560 KB calibrated v1.18.0+ release ceiling
    appZipMaxBytes: 576_716,             // < 0.55 MB (563.2 KB) hard ceiling ALWAYS enforced
};

const BLUEPRINT_VSIX_ESTIMATE_BYTES = {
    vsixUncompressedBytes: 1_048_576,    // 1.00 MB pre-Plan-C §4.3 blueprint estimate
    vsixCompressedBytes: 409_600,        // 400 KB pre-Plan-C §4.3 blueprint estimate
};

const README_TRIMMED_THRESHOLD_BYTES = 20_480;

// ─── Pure-Node Archive Extractors (Zero External Dependencies) ───────────────

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

function sha256File(filePath) {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function assertSafeDestPath(destDir, rawEntryName) {
    assert.ok(rawEntryName && !rawEntryName.includes('\0'), `Invalid archive entry: ${rawEntryName}`);
    const norm = rawEntryName.replace(/\\/g, '/');
    assert.ok(!norm.startsWith('/') && !/^[A-Za-z]:/.test(norm), `Absolute archive path rejected: ${rawEntryName}`);
    const segments = norm.split('/').filter((s) => s.length > 0);
    for (const seg of segments) {
        assert.ok(seg !== '.' && seg !== '..', `Path traversal rejected: ${rawEntryName}`);
    }
    const resolvedDest = resolve(destDir);
    const targetPath = segments.length > 0 ? resolve(resolvedDest, ...segments) : resolvedDest;
    assert.ok(
        targetPath === resolvedDest || targetPath.startsWith(resolvedDest + sep),
        `Archive entry escapes destDir: ${rawEntryName}`,
    );
    return { targetPath, relPath: segments.join('/'), isDir: norm.endsWith('/') };
}

function extractZipPreservingModes(zipPath, destDir) {
    const buf = readFileSync(zipPath);
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
    assert.ok(eocdOffset >= 0, `Invalid ZIP archive (missing EOCD): ${zipPath}`);
    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdSize = buf.readUInt32LE(eocdOffset + 12);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    assert.ok(cdOffset + cdSize <= eocdOffset, `Corrupt ZIP central directory: ${zipPath}`);

    mkdirSync(destDir, { recursive: true });
    let cursor = cdOffset;
    const entries = [];
    let uncompressedBytes = 0;

    for (let i = 0; i < totalEntries; i++) {
        assert.equal(buf.readUInt32LE(cursor), 0x02014b50, `Bad CD sig at entry ${i}`);
        const versionMadeBy = buf.readUInt16LE(cursor + 4);
        const method = buf.readUInt16LE(cursor + 10);
        const expectedCrc = buf.readUInt32LE(cursor + 16);
        const compressedSize = buf.readUInt32LE(cursor + 20);
        const uncompressedSize = buf.readUInt32LE(cursor + 24);
        const nameLen = buf.readUInt16LE(cursor + 28);
        const extraLen = buf.readUInt16LE(cursor + 30);
        const commentLen = buf.readUInt16LE(cursor + 32);
        const externalAttrs = buf.readUInt32LE(cursor + 38);
        const localOffset = buf.readUInt32LE(cursor + 42);

        const rawName = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
        cursor += 46 + nameLen + extraLen + commentLen;

        const hostOs = (versionMadeBy >>> 8) & 0xff;
        const unixMode = (externalAttrs >>> 16) & 0xffff;
        assert.notEqual(unixMode & 0o170000, 0o120000, `Symlink rejected in ZIP: ${rawName}`);

        const { targetPath, relPath, isDir } = assertSafeDestPath(destDir, rawName);
        if (!relPath) { continue; }
        if (isDir || (hostOs === 3 && (unixMode & 0o170000) === 0o040000)) {
            mkdirSync(targetPath, { recursive: true });
            continue;
        }

        assert.equal(buf.readUInt32LE(localOffset), 0x04034b50, `Bad LFH sig for ${rawName}`);
        const localNameLen = buf.readUInt16LE(localOffset + 26);
        const localExtraLen = buf.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const slice = buf.subarray(dataStart, dataStart + compressedSize);
        const data = method === 0 ? Buffer.from(slice) : inflateRawSync(slice);
        assert.equal(data.length, uncompressedSize, `Size mismatch for ${rawName}`);
        assert.equal(crc32(data), expectedCrc, `CRC-32 mismatch for ${rawName}`);

        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, data);
        if (process.platform !== 'win32' && (unixMode & 0o111) !== 0) {
            chmodSync(targetPath, 0o755);
        }
        uncompressedBytes += uncompressedSize;
        entries.push({ name: relPath, size: uncompressedSize, compressedSize, mode: unixMode });
    }

    return { entries, compressedBytes: buf.length, uncompressedBytes };
}

function parseOctal(buf, start, len) {
    const str = buf.subarray(start, start + len).toString('ascii').replace(/\0.*$/, '').trim();
    return str ? parseInt(str, 8) : 0;
}

function extractTarGzPreservingModes(tarGzPath, destDir) {
    const compressed = readFileSync(tarGzPath);
    const tar = gunzipSync(compressed);
    mkdirSync(destDir, { recursive: true });

    const entries = [];
    let offset = 0;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        let allZero = true;
        for (let i = 0; i < 512; i++) {
            if (header[i] !== 0) { allZero = false; break; }
        }
        if (allZero) { break; }

        const namePart = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
        const prefixPart = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
        const rawName = prefixPart ? `${prefixPart}/${namePart}` : namePart;
        const mode = parseOctal(header, 100, 8);
        const size = parseOctal(header, 124, 12);
        const typeFlag = String.fromCharCode(header[156] || 0x30);
        offset += 512;

        assert.ok(typeFlag === '0' || typeFlag === '\0' || typeFlag === '5', `Unsupported/unsafe tar entry type "${typeFlag}": ${rawName}`);
        const data = tar.subarray(offset, offset + size);
        offset += Math.ceil(size / 512) * 512;

        const { targetPath, relPath, isDir } = assertSafeDestPath(destDir, rawName);
        if (!relPath) { continue; }
        if (typeFlag === '5' || isDir) {
            mkdirSync(targetPath, { recursive: true });
            continue;
        }
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, data);
        if (process.platform !== 'win32' && (mode & 0o111) !== 0) {
            chmodSync(targetPath, 0o755);
        }
        entries.push({ name: relPath, size, mode });
    }

    return { entries, compressedBytes: compressed.length };
}

// ─── HTTP & Subprocess Helpers ───────────────────────────────────────────────

function rawHttp(baseUrl, method, reqPath, options = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const u = new URL(reqPath, baseUrl);
        const body = options.body;
        const headers = { ...(options.headers || {}) };
        if (body !== undefined && !headers['Content-Length']) {
            headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'));
        }
        const req = http.request({
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            method,
            headers,
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                const text = buf.toString('utf8');
                resolvePromise({
                    status: res.statusCode || 0,
                    headers: res.headers,
                    buffer: buf,
                    text,
                    json: () => JSON.parse(text),
                });
            });
        });
        req.on('error', rejectPromise);
        if (body !== undefined) {
            req.write(body);
        }
        req.end();
    });
}

function cleanChildEnv(extra = {}) {
    const base = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (v === undefined) { continue; }
        if (k === 'NODE_PATH' || k === 'NODE_OPTIONS' || k.startsWith('npm_') || k.startsWith('ANTIGRAVITY_')) {
            continue;
        }
        base[k] = v;
    }
    return { ...base, ...extra };
}

function findAgyBinary() {
    const ext = process.platform === 'win32' ? '.exe' : '';
    const home = homedir();
    for (const bin of ['agy', join(home, '.gemini', 'bin', `agy${ext}`), join(home, '.local', 'bin', `agy${ext}`)]) {
        if (bin !== 'agy' && !existsSync(bin)) { continue; }
        try {
            execFileSync(bin, ['--version'], { stdio: 'ignore', windowsHide: true });
            return bin;
        } catch { /* next */ }
    }
    return null;
}

function waitForChildExit(child, timeoutMs = 5000) {
    return new Promise((resolvePromise) => {
        if (child.exitCode !== null || child.signalCode !== null) {
            resolvePromise({ code: child.exitCode, signal: child.signalCode });
            return;
        }
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
            resolvePromise({ code: child.exitCode, signal: child.signalCode, timedOut: true });
        }, timeoutMs);
        timer.unref?.();
        child.once('exit', (code, signal) => {
            clearTimeout(timer);
            resolvePromise({ code, signal });
        });
    });
}

function formatKb(bytes) {
    return `${(bytes / 1024).toFixed(1)} KB`;
}

// ─── Verification Runner ─────────────────────────────────────────────────────

async function runDistTests(options = {}) {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, ''));
    const version = String(pkg.version || '').trim();
    const strictSize = requiresReleaseSize(version) || Boolean(options.strictSize);
    assert.equal(pkg.dependencies, undefined, 'package.json MUST have ZERO runtime dependencies');

    const distDir = join(REPO_ROOT, 'dist');
    const vsixFilename = `${PLUGIN_NAME}-${version}.vsix`;
    const zipFilename = `${PLUGIN_NAME}-app-${version}.zip`;
    const tarGzFilename = `${PLUGIN_NAME}-app-${version}.tar.gz`;
    const vsixPath = join(distDir, vsixFilename);
    const zipPath = join(distDir, zipFilename);
    const tarGzPath = join(distDir, tarGzFilename);
    const sumsPath = join(distDir, 'SHA256SUMS.txt');
    const installerSrcPath = join(REPO_ROOT, 'scripts', 'install-app-plugin.mjs');
    const statuslineSrcPath = join(REPO_ROOT, 'app-plugin', 'bin', 'agy-statusline.mjs');

    const clientManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'dist-stage', 'client', 'manifest.json'), 'utf8'));
    const ideManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'dist-stage', 'ide', 'manifest.json'), 'utf8'));
    const appManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'dist-stage', 'app', 'manifest.json'), 'utf8'));

    const tempRoot = mkdtempSync(join(tmpdir(), 'acm-test-dist-'));
    const realTempRoot = realpathSync(tempRoot);
    const realRepoRoot = realpathSync(REPO_ROOT);
    assert.ok(
        !realTempRoot.startsWith(realRepoRoot + sep) && realTempRoot !== realRepoRoot,
        `test:dist temp dir MUST live outside repository (${realTempRoot})`,
    );

    const results = [];
    const runCheck = async (id, label, fn) => {
        const started = Date.now();
        await fn();
        const ms = Date.now() - started;
        results.push({ id, label, ms });
        console.log(`  [PASS] ${id}: ${label} (${ms} ms)`);
    };

    try {
        console.log(`[test:dist] Isolated out-of-repo workspace: ${realTempRoot}`);
        console.log(`[test:dist] Verifying v${version} artifacts (zero repo tree, zero node_modules)...`);

        const vsixExtractDir = join(tempRoot, 'vsix-extracted');
        const appZipExtractDir = join(tempRoot, 'app-zip-extracted');
        const appTarGzExtractDir = join(tempRoot, 'app-targz-extracted');
        const downloadedInstallerPath = join(tempRoot, 'downloaded', 'acm-install.mjs');
        const standaloneStatuslinePath = join(tempRoot, 'standalone-bin', 'agy-statusline.mjs');
        const appZipPluginDir = join(appZipExtractDir, PLUGIN_NAME);
        const appTarGzPluginDir = join(appTarGzExtractDir, PLUGIN_NAME);

        let vsixExtracted;
        let appZipExtracted;
        let appTarGzExtracted;

        // ── Check A: Exact 3-artifact manifest, checksums, hygiene, exec bits, ceilings, agy validate ──
        await runCheck('A', 'Exact 3-artifact SHA256SUMS.txt, archive hygiene, exec bits, ceilings & agy validate', async () => {
            for (const reqFile of [vsixPath, zipPath, tarGzPath, sumsPath, installerSrcPath, statuslineSrcPath]) {
                assert.ok(existsSync(reqFile), `Missing required built artifact: ${reqFile}`);
            }

            const sumsRaw = readFileSync(sumsPath, 'utf8');
            const sumLines = sumsRaw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
            assert.equal(sumLines.length, 3, `dist/SHA256SUMS.txt must contain EXACTLY 3 entries, got ${sumLines.length}`);
            const sumMap = new Map();
            for (const line of sumLines) {
                const m = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/);
                assert.ok(m, `Malformed SHA256SUMS.txt line: ${line}`);
                sumMap.set(m[2], m[1]);
            }
            assert.deepEqual(
                [...sumMap.keys()].sort(),
                [vsixFilename, zipFilename, tarGzFilename].sort(),
                'SHA256SUMS.txt must list exact .vsix, -app.zip, and -app.tar.gz',
            );
            assert.equal(sumMap.get(vsixFilename), sha256File(vsixPath), 'VSIX SHA-256 mismatch');
            assert.equal(sumMap.get(zipFilename), sha256File(zipPath), 'App ZIP SHA-256 mismatch');
            assert.equal(sumMap.get(tarGzFilename), sha256File(tarGzPath), 'App tar.gz SHA-256 mismatch');

            vsixExtracted = extractZipPreservingModes(vsixPath, vsixExtractDir);
            appZipExtracted = extractZipPreservingModes(zipPath, appZipExtractDir);
            appTarGzExtracted = extractTarGzPreservingModes(tarGzPath, appTarGzExtractDir);

            const vsixFiles = [
                '[Content_Types].xml', 'extension.vsixmanifest', 'extension/package.json',
                'extension/changelog.md', 'extension/readme.md', 'extension/LICENSE.txt',
                'extension/assets/icon.png', 'extension/dist-stage/ide/extension.js',
            ];
            assert.deepEqual(vsixExtracted.entries.map(e => e.name).sort(), vsixFiles.sort(), 'Unexpected VSIX contents');
            const appFiles = [
                ...APP_PLUGIN_ALLOWLIST, 'sidecars/context_monitor/runtime/package.json',
                ...APP_BUNDLED_RUNTIME_FILES.map(file => `sidecars/context_monitor/runtime/out/app/${file}`),
            ].map(file => `${PLUGIN_NAME}/${file}`).sort();
            for (const archive of [appZipExtracted, appTarGzExtracted]) {
                assert.deepEqual(archive.entries.map(e => e.name).sort(), appFiles, 'Unexpected App archive contents');
            }
            for (const file of appFiles) {
                assert.equal(sha256File(join(appZipExtractDir, file)), sha256File(join(appTarGzExtractDir, file)),
                    `ZIP and tar.gz disagree on ${file}`);
            }

            mkdirSync(dirname(downloadedInstallerPath), { recursive: true });
            mkdirSync(dirname(standaloneStatuslinePath), { recursive: true });
            copyFileSync(installerSrcPath, downloadedInstallerPath);
            copyFileSync(statuslineSrcPath, standaloneStatuslinePath);
            if (process.platform !== 'win32') {
                chmodSync(downloadedInstallerPath, 0o755);
                chmodSync(standaloneStatuslinePath, 0o755);
            }

            // Ban .map, retired .png (exempting ONLY extension/assets/icon.png in VSIX), .d.ts, .test.js in ALL 3 archives
            for (const [label, list] of [
                ['VSIX', vsixExtracted.entries],
                ['App ZIP', appZipExtracted.entries],
                ['App tar.gz', appTarGzExtracted.entries],
            ]) {
                for (const entry of list) {
                    const lower = entry.name.toLowerCase();
                    const isAllowedVsixIcon = label === 'VSIX' && lower === 'extension/assets/icon.png';
                    assert.ok(!lower.endsWith('.map'), `${label} contains banned sourcemap: ${entry.name}`);
                    assert.ok(!lower.endsWith('.png') || isAllowedVsixIcon, `${label} contains retired PNG: ${entry.name}`);
                    assert.ok(!lower.endsWith('.d.ts'), `${label} contains banned .d.ts: ${entry.name}`);
                    assert.ok(!lower.endsWith('.test.js'), `${label} contains banned test file: ${entry.name}`);
                }
            }

            // Verify executable bits on bin/agy-statusline.mjs & main.mjs in BOTH App ZIP and App tar.gz
            for (const [label, list, pluginRoot] of [
                ['App ZIP', appZipExtracted.entries, appZipPluginDir],
                ['App tar.gz', appTarGzExtracted.entries, appTarGzPluginDir],
            ]) {
                for (const relExec of ['bin/agy-statusline.mjs', 'sidecars/context_monitor/main.mjs']) {
                    const archiveEntry = list.find((e) => e.name === `${PLUGIN_NAME}/${relExec}`);
                    assert.ok(archiveEntry, `${label} missing ${relExec}`);
                    assert.ok((archiveEntry.mode & 0o111) !== 0, `${label} entry ${relExec} missing executable bit (mode=0o${archiveEntry.mode.toString(8)})`);
                    if (process.platform !== 'win32') {
                        const diskMode = statSync(join(pluginRoot, relExec)).mode;
                        assert.ok((diskMode & 0o111) !== 0, `Extracted ${label} ${relExec} not executable on disk`);
                    }
                }
            }

            // Verify size ceilings (App ZIP < 0.55 MB ALWAYS hard error; VSIX tightens after Phase 4 README trim)
            const vsixReadmeEntry = vsixExtracted.entries.find((e) => e.name.toLowerCase() === 'extension/readme.md') || null;
            const vsixIconEntry = vsixExtracted.entries.find((e) => e.name.toLowerCase() === 'extension/assets/icon.png') || null;
            const readmeTrimmed = Boolean(vsixReadmeEntry && vsixReadmeEntry.size <= README_TRIMMED_THRESHOLD_BYTES);
            const ceilings = strictSize
                ? STRICT_RELEASE_SIZE_CEILINGS
                : readmeTrimmed
                    ? {
                        ...POST_README_TRIM_SIZE_CEILINGS,
                        vsixCompressedMaxBytes: POST_README_TRIM_SIZE_CEILINGS.vsixCompressedMaxBytes + (vsixIconEntry ? vsixIconEntry.compressedSize : 0),
                        vsixUncompressedMaxBytes: POST_README_TRIM_SIZE_CEILINGS.vsixUncompressedMaxBytes + (vsixIconEntry ? vsixIconEntry.size : 0),
                    }
                    : PRE_README_TRIM_SIZE_CEILINGS;
            assert.ok(
                vsixExtracted.uncompressedBytes <= ceilings.vsixUncompressedMaxBytes,
                `VSIX uncompressed ${vsixExtracted.uncompressedBytes} > ceiling ${ceilings.vsixUncompressedMaxBytes}`,
            );
            assert.ok(
                vsixExtracted.compressedBytes <= ceilings.vsixCompressedMaxBytes,
                `VSIX compressed ${vsixExtracted.compressedBytes} > ceiling ${ceilings.vsixCompressedMaxBytes}`,
            );
            assert.ok(
                appZipExtracted.compressedBytes <= ceilings.appZipMaxBytes,
                `App ZIP ${appZipExtracted.compressedBytes} > ceiling ${ceilings.appZipMaxBytes}`,
            );

            // Verify agy plugin validate --strict --json (0 findings) on BOTH extracted archives if agy is installed
            const agyBin = findAgyBinary();
            if (strictSize) { assert.ok(agyBin, 'Candidate validation requires agy plugin validate'); }
            if (agyBin) {
                for (const dir of [appZipPluginDir, appTarGzPluginDir]) {
                    const out = execFileSync(agyBin, ['plugin', 'validate', '--strict', '--json', dir], {
                        cwd: tempRoot,
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'pipe'],
                        windowsHide: true,
                    });
                    const report = JSON.parse(out.trim());
                    assert.ok(Array.isArray(report?.findings), `Invalid agy validate JSON for ${dir}`);
                    assert.equal(report.findings.length, 0, `agy plugin validate returned findings: ${out}`);
                }
            }
        });

        // ── Check B: Extracted IDE VSIX activation, node:sqlite supported & unavailable branches, buildId ──
        await runCheck('B', 'Extracted IDE VSIX activation (mock vscode, zero node_modules, sqlite supported & unavailable, buildId)', async () => {
            const extPkgPath = join(vsixExtractDir, 'extension', 'package.json');
            assert.ok(existsSync(extPkgPath), 'Extracted VSIX missing extension/package.json');
            const extPkg = JSON.parse(readFileSync(extPkgPath, 'utf8'));
            assert.equal(extPkg.version, version);
            assert.equal(extPkg.dependencies, undefined);
            const extEntryPath = resolve(join(vsixExtractDir, 'extension'), extPkg.main);
            assert.ok(existsSync(extEntryPath), `Extracted VSIX missing main entrypoint: ${extPkg.main}`);
            assert.equal(existsSync(join(vsixExtractDir, 'extension', 'node_modules')), false, 'VSIX must contain zero node_modules');

            const probeDir = join(tempRoot, 'probes');
            mkdirSync(probeDir, { recursive: true });
            const ideProbeScript = join(probeDir, 'probe-ide.cjs');
            writeFileSync(ideProbeScript, `
'use strict';
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

const extEntry = process.argv[2];
const blockSqlite = process.argv[3] === 'block-sqlite';
const fakeStorageDir = process.argv[4];
const resultOutPath = process.argv[5];
fs.mkdirSync(fakeStorageDir, { recursive: true });

const registeredCommands = [];
let statusBarCreated = 0;

class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor(v = '') { this.value = v; this.supportThemeIcons = false; } }

const mockVscode = {
    version: '1.96.0',
    ThemeColor,
    MarkdownString,
    StatusBarAlignment: { Left: 1, Right: 2 },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    Uri: {
        file: (fsPath) => ({ scheme: 'file', fsPath, toString: () => 'file://' + fsPath }),
        parse: (v) => ({ scheme: 'file', fsPath: v, toString: () => String(v) }),
    },
    window: {
        createStatusBarItem: () => {
            statusBarCreated++;
            return { text: '', tooltip: '', command: '', name: '', backgroundColor: undefined, show() {}, hide() {}, dispose() {} };
        },
        createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
        createWebviewPanel: () => ({
            webview: { html: '', postMessage() {}, onDidReceiveMessage: () => ({ dispose() {} }) },
            reveal() {}, onDidDispose: () => ({ dispose() {} }), onDidChangeViewState: () => ({ dispose() {} }), dispose() {},
        }),
        showQuickPick: async () => undefined,
        showInformationMessage: async () => undefined,
        showWarningMessage: async () => undefined,
        showErrorMessage: async () => undefined,
        showTextDocument: async () => undefined,
        registerWebviewViewProvider: () => ({ dispose() {} }),
    },
    workspace: {
        workspaceFolders: [],
        getConfiguration: () => ({
            get: (_k, def) => def,
            update: async () => undefined,
        }),
        onDidChangeConfiguration: () => ({ dispose() {} }),
        onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
        openTextDocument: async (t) => ({ uri: t }),
        fs: { stat: async (t) => t },
    },
    commands: {
        registerCommand: (cmd) => { registeredCommands.push(cmd); return { dispose() {} }; },
        executeCommand: async () => undefined,
    },
    env: {
        language: 'en',
        clipboard: { writeText: async () => undefined },
        openExternal: async () => true,
    },
    extensions: {
        getExtension: () => undefined,
    },
};

const origLoad = Module._load;
const cliRoot = process.env.ANTIGRAVITY_CLI_DATA_DIR;
const dbDir = path.join(cliRoot, 'conversations');
const usageDir = path.join(cliRoot, 'usage');
fs.mkdirSync(dbDir, { recursive: true });
fs.mkdirSync(usageDir, { recursive: true });
const fixtureDb = new (require('node:sqlite').DatabaseSync)(path.join(dbDir, 'fixture.db'));
fixtureDb.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER); CREATE TABLE steps (idx INTEGER PRIMARY KEY, metadata BLOB)');
// ChatModel.usage { input: 42, output: 3 } plus a provider timestamp.
const blob = Buffer.from([10, 16, 34, 4, 16, 42, 24, 3, 74, 8, 34, 6, 8, 128, 226, 207, 170, 6]);
fixtureDb.prepare('INSERT INTO gen_metadata VALUES (?, ?, ?)').run(0, blob, blob.length);
fixtureDb.close();
fs.writeFileSync(path.join(usageDir, 'fallback.jsonl'), JSON.stringify({
    execution_id: 'fixture-json', created_at: new Date().toISOString(), model: 'fixture',
    usage: { input_tokens: 7, output_tokens: 2 },
}));

let sqliteRequests = 0;
Module._load = function (request, parent, isMain) {
    if (request === 'vscode') { return mockVscode; }
    if (request === 'node:sqlite') { sqliteRequests++; }
    if (blockSqlite && request === 'node:sqlite') {
        const err = new Error("Cannot find module 'node:sqlite'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
    }
    return origLoad.apply(this, arguments);
};

(async () => {
    const ext = require(extEntry);
    if (typeof ext.activate !== 'function' || typeof ext.deactivate !== 'function') {
        throw new Error('Extracted extension.js missing activate/deactivate exports');
    }
    const store = new Map();
    const subscriptions = [];
    const context = {
        subscriptions,
        extensionPath: path.dirname(path.dirname(path.dirname(extEntry))),
        extensionUri: mockVscode.Uri.file(path.dirname(path.dirname(path.dirname(extEntry)))),
        extension: { packageJSON: { version: ${JSON.stringify(version)} } },
        globalStorageUri: mockVscode.Uri.file(fakeStorageDir),
        globalState: {
            get: (k, d) => (store.has(k) ? store.get(k) : d),
            update: async (k, v) => { store.set(k, v); },
            keys: () => [...store.keys()],
        },
        workspaceState: {
            get: (k, d) => d,
            update: async () => undefined,
            keys: () => [],
        },
    };
    await ext.activate(context);
    let scannedTokens = 0;
    for (let attempt = 0; attempt < 100 && !scannedTokens; attempt++) {
        scannedTokens = ext.getCachedCliUsageDays().reduce((total, day) => total + day.totalTokens, 0);
        if (!scannedTokens) { await new Promise(resolve => setTimeout(resolve, 20)); }
    }
    await ext.deactivate();
    for (const sub of subscriptions) {
        try { sub && typeof sub.dispose === 'function' && sub.dispose(); } catch {}
    }

    fs.writeFileSync(resultOutPath, JSON.stringify({
        ok: true,
        buildId: ext.ACM_BUILD_ID || null,
        version: ext.ACM_VERSION || null,
        commands: registeredCommands,
        statusBarCreated,
        scannedTokens,
        sqliteRequests,
    }) + '\\n', 'utf8');
    process.exit(0);
})().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
});
`, 'utf8');

            // 1. node:sqlite supported branch
            const ideHome1 = join(tempRoot, 'home-ide-sqlite-ok');
            mkdirSync(ideHome1, { recursive: true });
            const ideOut1Path = join(ideHome1, 'probe-result.json');
            const resSupported = spawnSync(process.execPath, [ideProbeScript, extEntryPath, 'allow-sqlite', join(ideHome1, 'storage'), ideOut1Path], {
                cwd: tempRoot,
                encoding: 'utf8',
                env: cleanChildEnv({
                    HOME: ideHome1,
                    USERPROFILE: ideHome1,
                    ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH: join(ideHome1, 'state-v1.json'),
                    ANTIGRAVITY_CLI_DATA_DIR: join(ideHome1, 'empty-cli'),
                }),
                timeout: 15_000,
            });
            assert.equal(resSupported.status, 0, `IDE VSIX activation failed (sqlite supported):\n${resSupported.stderr}`);
            const out1 = JSON.parse(readFileSync(ideOut1Path, 'utf8'));
            assert.equal(out1.ok, true);
            assert.match(String(out1.buildId), /^[a-f0-9]{16}$/, 'IDE extension.js missing 16-hex ACM_BUILD_ID');
            assert.equal(out1.buildId, ideManifest.buildId, 'Extracted VSIX ACM_BUILD_ID mismatch with ide manifest');
            assert.ok(out1.statusBarCreated >= 1, 'Expected StatusBarItem creation on activation');
            for (const cmd of [
                'antigravity-context-monitor.showDetails',
                'antigravity-context-monitor.refresh',
                'antigravity-context-monitor.switchLanguage',
                'antigravity-context-monitor.showActivityPanel',
            ]) {
                assert.ok(out1.commands.includes(cmd), `Missing registered command: ${cmd}`);
            }
            assert.ok(out1.sqliteRequests > 0, 'Packaged CLI scanner did not load SQLite');
            assert.equal(out1.scannedTokens, 54, 'Expected tokens from both SQLite and JSONL');

            // 2. node:sqlite unavailable fallback branch
            const ideHome2 = join(tempRoot, 'home-ide-sqlite-unavail');
            mkdirSync(ideHome2, { recursive: true });
            const ideOut2Path = join(ideHome2, 'probe-result.json');
            const resUnavailable = spawnSync(process.execPath, [ideProbeScript, extEntryPath, 'block-sqlite', join(ideHome2, 'storage'), ideOut2Path], {
                cwd: tempRoot,
                encoding: 'utf8',
                env: cleanChildEnv({
                    HOME: ideHome2,
                    USERPROFILE: ideHome2,
                    ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH: join(ideHome2, 'state-v1.json'),
                    ANTIGRAVITY_CLI_DATA_DIR: join(ideHome2, 'empty-cli'),
                }),
                timeout: 15_000,
            });
            assert.equal(resUnavailable.status, 0, `IDE VSIX activation failed (sqlite unavailable fallback):\n${resUnavailable.stderr}`);
            const out2 = JSON.parse(readFileSync(ideOut2Path, 'utf8'));
            assert.equal(out2.ok, true);
            assert.equal(out2.buildId, ideManifest.buildId);
            assert.ok(out2.sqliteRequests > 0, 'SQLite-unavailable branch did not exercise the scanner');
            assert.equal(out2.scannedTokens, 9, 'Expected JSONL usage with SQLite unavailable');
            assert.ok(out2.commands.includes('antigravity-context-monitor.showDetails'));
        });

        // ── Check C: Extracted App Sidecar ZIP & tar.gz (Real Provider + SDK Adapter + Standalone) ──
        let renderedAppHtmlFromSdk = '';
        await runCheck('C', 'Extracted App Sidecar ZIP & tar.gz (ACM_REAL_PROVIDER, SDK adapter 200 unchanged, Standalone pairing + 401 + bodyless 304)', async () => {
            const probeDir = join(tempRoot, 'probes');
            mkdirSync(probeDir, { recursive: true });

            // Write mock `sidecar_sdk` ESM hook strictly inside tempRoot (zero repo files)
            const sdkHookRegisterPath = join(probeDir, 'register-mock-sdk.mjs');
            const mockSdkModulePath = join(probeDir, 'mock-sidecar-sdk.mjs');

            writeFileSync(mockSdkModulePath, `
import { writeFileSync } from 'node:fs';

export class Response {
    constructor(body, init = {}) {
        this.body = body;
        this.status = init.status ?? 200;
        this.contentType = init.contentType ?? 'text/plain';
        this.headers = init.headers ?? {};
    }
}

export class SidecarApp {
    constructor() {
        this.pages = new Map();
        this.apis = new Map();
    }
    page(route, handler) { this.pages.set(route, handler); }
    api(route, handler, method = 'GET') { this.apis.set(method.toUpperCase() + ' ' + route, handler); }
    async close() {}
    async run() {
        const healthHandler = this.apis.get('GET /api/health');
        const snapHandler = this.apis.get('GET /api/snapshot');
        const auxHandler = this.pages.get('/');
        const fullHandler = this.pages.get('/full');
        if (!healthHandler || !snapHandler || !auxHandler || !fullHandler) {
            throw new Error('SidecarApp missing expected routes');
        }
        const health = await healthHandler();
        const snap1Res = await snapHandler({});
        const snap1Body = JSON.parse(snap1Res.body);
        const snap2Res = await snapHandler({ etag: snap1Body.hash });
        const snap2Body = JSON.parse(snap2Res.body);
        const auxRes = await auxHandler();
        const fullRes = await fullHandler();

        writeFileSync(process.env.ACM_DIST_SDK_OUT, JSON.stringify({
            ok: true,
            health,
            pageRoutes: [...this.pages.keys()].sort(),
            snap1Status: snap1Res.status,
            snap1Unchanged: snap1Body.unchanged,
            snap1Hash: snap1Body.hash,
            hasTabs: Boolean(snap1Body.snapshot && snap1Body.snapshot.tabs),
            snap2Status: snap2Res.status,
            snap2Unchanged: snap2Body.unchanged,
            auxStatus: auxRes.status,
            fullStatus: fullRes.status,
            auxHtml: auxRes.body,
        }) + '\\n', 'utf8');
        process.exit(0);
    }
}
`, 'utf8');

            writeFileSync(sdkHookRegisterPath, `
import { registerHooks } from 'node:module';
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === 'sidecar_sdk') {
            return { url: ${JSON.stringify(pathToFileURL(mockSdkModulePath).href)}, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});
`, 'utf8');

            for (const [label, pluginRoot] of [
                ['ZIP', appZipPluginDir],
                ['tar.gz', appTarGzPluginDir],
            ]) {
                // 1. Positive real-provider verification on extracted runtime/out/app/sidecar-runtime.js
                const runtimePkg = JSON.parse(readFileSync(join(pluginRoot, 'sidecars', 'context_monitor', 'runtime', 'package.json'), 'utf8'));
                assert.equal(runtimePkg.bundled, true, `${label}: runtime/package.json must mark bundled=true`);
                assert.equal(runtimePkg.version, version, `${label}: runtime/package.json version mismatch`);
                assert.equal(runtimePkg.buildId, appManifest.buildId, `${label}: runtime/package.json buildId mismatch`);

                const realCheck = spawnSync(
                    process.execPath,
                    ['-e', `const m = require(process.argv[1]); console.log(JSON.stringify({ real: m.ACM_REAL_PROVIDER, buildId: m.ACM_BUILD_ID, hasFactory: typeof m.createSidecarRuntimeProvider === 'function' }));`,
                        join(pluginRoot, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-runtime.js')],
                    { cwd: tempRoot, encoding: 'utf8', env: cleanChildEnv() },
                );
                assert.equal(realCheck.status, 0, `${label}: loading sidecar-runtime.js failed: ${realCheck.stderr}`);
                const realInfo = JSON.parse(realCheck.stdout.trim());
                assert.equal(realInfo.real, true, `${label}: ACM_REAL_PROVIDER must be true`);
                assert.equal(realInfo.buildId, appManifest.buildId, `${label}: ACM_BUILD_ID mismatch`);
                assert.equal(realInfo.hasFactory, true, `${label}: createSidecarRuntimeProvider missing`);

                // 2. SDK adapter mode via extracted main.mjs
                const sdkHome = join(tempRoot, `home-sdk-${label.replace('.', '')}`);
                mkdirSync(sdkHome, { recursive: true });
                const sdkOutPath = join(sdkHome, 'sdk-result.json');
                const mainMjs = join(pluginRoot, 'sidecars', 'context_monitor', 'main.mjs');
                const sdkProc = spawnSync(
                    process.execPath,
                    ['--import', pathToFileURL(sdkHookRegisterPath).href, mainMjs],
                    {
                        cwd: tempRoot,
                        encoding: 'utf8',
                        env: cleanChildEnv({
                            HOME: sdkHome,
                            USERPROFILE: sdkHome,
                            ACM_DIST_SDK_OUT: sdkOutPath,
                            ANTIGRAVITY_SIDECAR_WEB_PORT: '19999',
                            ANTIGRAVITY_LS_ADDRESS: '127.0.0.1:19998',
                            ANTIGRAVITY_CSRF_TOKEN: 'dist-test-csrf-token',
                            ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH: join(sdkHome, 'state-v1.json'),
                            ANTIGRAVITY_CLI_DATA_DIR: join(sdkHome, 'empty-cli'),
                        }),
                        timeout: 15_000,
                    },
                );
                assert.equal(sdkProc.status, 0, `${label} SDK adapter mode failed:\n${sdkProc.stderr}`);
                const sdkOut = JSON.parse(readFileSync(sdkOutPath, 'utf8'));
                assert.equal(sdkOut.ok, true);
                assert.deepEqual(sdkOut.pageRoutes, ['/', '/full']);
                assert.equal(sdkOut.health.ok, true);
                assert.equal(sdkOut.health.version, version);
                assert.equal(sdkOut.health.buildId, appManifest.buildId);
                assert.equal(sdkOut.snap1Status, 200);
                assert.equal(sdkOut.snap1Unchanged, false);
                assert.ok(sdkOut.snap1Hash && sdkOut.hasTabs, `${label} SDK snapshot missing hash/tabs`);
                assert.equal(sdkOut.snap2Status, 200, `${label} SDK unchanged response must be 200`);
                assert.equal(sdkOut.snap2Unchanged, true, `${label} SDK unchanged response must return { unchanged: true }`);
                assert.equal(sdkOut.auxStatus, 200);
                assert.equal(sdkOut.fullStatus, 200);
                if (!renderedAppHtmlFromSdk) {
                    renderedAppHtmlFromSdk = sdkOut.auxHtml;
                }

                // 3. Standalone mode via extracted main.mjs
                const standHome = join(tempRoot, `home-standalone-${label.replace('.', '')}`);
                mkdirSync(standHome, { recursive: true });
                const pairingFile = join(standHome, 'pairing.json');
                const child = spawn(
                    process.execPath,
                    [mainMjs, '--standalone-port=0', '--print-url', `--pairing-file=${pairingFile}`],
                    {
                        cwd: tempRoot,
                        env: cleanChildEnv({
                            HOME: standHome,
                            USERPROFILE: standHome,
                            ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH: join(standHome, 'state-v1.json'),
                            ANTIGRAVITY_CLI_DATA_DIR: join(standHome, 'empty-cli'),
                        }),
                        stdio: ['ignore', 'pipe', 'pipe'],
                    },
                );

                let stdoutAcc = '';
                let stderrAcc = '';
                try {
                    const baseUrl = await new Promise((resolveUrl, rejectUrl) => {
                        const timer = setTimeout(() => {
                            rejectUrl(new Error(`${label} standalone timed out waiting for URL. stdout=${stdoutAcc} stderr=${stderrAcc}`));
                        }, 15_000);
                        timer.unref?.();
                        child.stdout.on('data', (chunk) => {
                            stdoutAcc += chunk.toString('utf8');
                            const m = stdoutAcc.match(/http:\/\/127\.0\.0\.1:\d+/);
                            if (m) {
                                clearTimeout(timer);
                                resolveUrl(m[0]);
                            }
                        });
                        child.stderr.on('data', (chunk) => { stderrAcc += chunk.toString('utf8'); });
                        child.once('exit', (code) => {
                            clearTimeout(timer);
                            rejectUrl(new Error(`${label} standalone exited early (${code}): ${stderrAcc}`));
                        });
                    });

                    // Wait briefly for pairing file write right after URL print
                    for (let tick = 0; tick < 30 && !existsSync(pairingFile); tick++) {
                        await new Promise((r) => setTimeout(r, 50));
                    }
                    assert.ok(existsSync(pairingFile), `${label} standalone did not create --pairing-file`);
                    if (process.platform !== 'win32') {
                        const mode = statSync(pairingFile).mode & 0o777;
                        assert.equal(mode, 0o600, `${label} pairing file must be mode 0600, got 0o${mode.toString(8)}`);
                    }
                    const pairingData = JSON.parse(readFileSync(pairingFile, 'utf8'));
                    const pairingCode = pairingData.pairingCode;
                    assert.match(String(pairingCode), /^[a-f0-9]{64}$/, `${label} invalid pairingCode`);
                    assert.ok(!stdoutAcc.includes(pairingCode), `${label} leaked pairingCode on stdout!`);
                    assert.ok(!stderrAcc.includes(pairingCode), `${label} leaked pairingCode on stderr!`);

                    const health = await rawHttp(baseUrl, 'GET', '/api/health');
                    assert.equal(health.json().buildId, appManifest.buildId);
                    // Unpaired GET / -> inert shell with zero telemetry/tokens
                    const unpairedPage = await rawHttp(baseUrl, 'GET', '/');
                    assert.equal(unpairedPage.status, 200);
                    assert.ok(unpairedPage.text.includes('data-acm-paired="false"'), `${label} unpaired / missing inert shell marker`);
                    assert.ok(unpairedPage.text.includes('acmPairingForm'), `${label} unpaired / missing pairing form`);
                    assert.ok(!unpairedPage.text.includes(pairingCode), `${label} unpaired / leaked pairingCode`);

                    // Unauthenticated GET /api/snapshot -> 401
                    const unauthSnap = await rawHttp(baseUrl, 'GET', '/api/snapshot');
                    assert.equal(unauthSnap.status, 401, `${label} unauthenticated /api/snapshot must return 401`);

                    // One-time POST /api/auth/pair succeeds once, issues an origin-bound browser session, burns code & deletes file
                    const pairRes = await rawHttp(baseUrl, 'POST', '/api/auth/pair', {
                        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
                        body: JSON.stringify({ pairingCode }),
                    });
                    assert.equal(pairRes.status, 200, `${label} valid pairing failed: ${pairRes.text}`);
                    assert.equal(pairRes.headers['set-cookie'], undefined);
                    const sessionToken = pairRes.json().sessionToken;
                    assert.match(sessionToken, /^[a-f0-9]{64}$/);
                    assert.equal(existsSync(pairingFile), false, `${label} pairing file must be deleted after consumption`);

                    // Replay of burned pairingCode -> 401
                    const replayRes = await rawHttp(baseUrl, 'POST', '/api/auth/pair', {
                        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
                        body: JSON.stringify({ pairingCode }),
                    });
                    assert.equal(replayRes.status, 401, `${label} replayed pairingCode must return 401`);

                    // Authenticated GET /api/snapshot -> 200 + ETag
                    const authSnap = await rawHttp(baseUrl, 'GET', '/api/snapshot', {
                        headers: { 'X-Monitor-Session': sessionToken },
                    });
                    assert.equal(authSnap.status, 200, `${label} authenticated /api/snapshot failed`);
                    const etag = String(authSnap.headers.etag || '');
                    assert.ok(etag.length > 4, `${label} authenticated /api/snapshot missing ETag header`);
                    const authSnapJson = authSnap.json();
                    assert.equal(authSnapJson.unchanged, false);

                    // Authenticated GET /api/snapshot with matching If-None-Match -> bodyless 304
                    let validator = etag;
                    let response;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        response = await rawHttp(baseUrl, 'GET', '/api/snapshot', {
                            headers: { 'X-Monitor-Session': sessionToken, 'If-None-Match': validator },
                        });
                        if (response.status === 304) { break; }
                        // The live provider may finish a startup poll between requests.
                        assert.equal(response.status, 200);
                        const next = response.headers.etag;
                        assert.ok(typeof next === 'string' && next.length > 4);
                        assert.notEqual(next, validator, `${label} returned HTTP 200 with a matching ETag`);
                        assert.equal(response.json().unchanged, false);
                        validator = next;
                    }
                    assert.equal(response.status, 304, `${label} ETag hit must return HTTP 304`);
                    assert.equal(response.buffer.length, 0, `${label} HTTP 304 must be bodyless`);
                } finally {
                    try { child.kill('SIGTERM'); } catch { /* ignore */ }
                    await waitForChildExit(child, 5_000);
                }
            }
        });

        // ── Check D: Extracted standalone install-app-plugin.mjs (file + stdin + v1.17.11 upgrade) ──
        await runCheck('D', 'Extracted install-app-plugin.mjs (downloaded-file mode, stdin-pipe mode, --local-dir + --no-remote-fallback, v1.17.11 upgrade)', async () => {
            const installerBytes = readFileSync(downloadedInstallerPath);

            // 1. Downloaded-file mode
            const homeFile = join(tempRoot, 'home-installer-file');
            mkdirSync(homeFile, { recursive: true });
            const fileEnv = cleanChildEnv({ HOME: homeFile, USERPROFILE: homeFile });

            const statusFile = spawnSync(process.execPath, [downloadedInstallerPath, '--status', '--json'], {
                cwd: tempRoot, encoding: 'utf8', env: fileEnv, timeout: 10_000,
            });
            assert.equal(statusFile.status, 0, `Downloaded installer --status failed: ${statusFile.stderr}`);
            const statusFileJson = JSON.parse(statusFile.stdout);
            assert.equal(statusFileJson.appPlugin.installed, false);

            const guideFile = spawnSync(process.execPath, [downloadedInstallerPath, '--print-cdp-guide'], {
                cwd: tempRoot, encoding: 'utf8', env: fileEnv, timeout: 10_000,
            });
            assert.equal(guideFile.status, 0);
            assert.ok(guideFile.stdout.includes('--remote-debugging-port=0'));

            // Outside repo, --install --no-remote-fallback without --local-dir MUST fail closed (never hit GitHub!)
            const noFallbackFail = spawnSync(process.execPath, [downloadedInstallerPath, '--install', '--no-remote-fallback'], {
                cwd: tempRoot, encoding: 'utf8', env: fileEnv, timeout: 10_000,
            });
            assert.notEqual(noFallbackFail.status, 0, 'Expected --install --no-remote-fallback without local dir to fail closed');

            // Local install with --local-dir & --no-remote-fallback
            const installFile = spawnSync(
                process.execPath,
                [downloadedInstallerPath, '--install', '--local-dir', appZipPluginDir, '--no-remote-fallback', '--json'],
                { cwd: tempRoot, encoding: 'utf8', env: fileEnv, timeout: 15_000 },
            );
            assert.equal(installFile.status, 0, `Downloaded installer --install --local-dir failed: ${installFile.stderr}`);
            const installFileJson = JSON.parse(installFile.stdout);
            assert.equal(installFileJson.sourceMode, 'local');
            assert.equal(installFileJson.version, version);
            assert.equal(installFileJson.buildId, appManifest.buildId);

            const postStatusFile = JSON.parse(
                execFileSync(process.execPath, [downloadedInstallerPath, '--status', '--json'], {
                    cwd: tempRoot, encoding: 'utf8', env: fileEnv,
                }),
            );
            assert.equal(postStatusFile.appPlugin.installed, true);
            assert.equal(postStatusFile.appPlugin.version, version);
            assert.equal(postStatusFile.appPlugin.buildId, appManifest.buildId);
            assert.equal(postStatusFile.appPlugin.hasCompiledRuntime, true);

            // 2. Stdin-pipe mode (`node - ... < acm-install.mjs`)
            const homeStdin = join(tempRoot, 'home-installer-stdin');
            mkdirSync(homeStdin, { recursive: true });
            const stdinEnv = cleanChildEnv({ HOME: homeStdin, USERPROFILE: homeStdin });

            const stdinStatus = spawnSync(process.execPath, ['-', '--status', '--json'], {
                cwd: tempRoot, input: installerBytes, encoding: 'utf8', env: stdinEnv, timeout: 10_000,
            });
            assert.equal(stdinStatus.status, 0, `Stdin-pipe installer --status failed: ${stdinStatus.stderr}`);
            assert.equal(JSON.parse(stdinStatus.stdout).appPlugin.installed, false);

            const stdinGuide = spawnSync(process.execPath, ['-', '--print-cdp-guide'], {
                cwd: tempRoot, input: installerBytes, encoding: 'utf8', env: stdinEnv, timeout: 10_000,
            });
            assert.equal(stdinGuide.status, 0, `Stdin-pipe installer --print-cdp-guide failed: ${stdinGuide.stderr}`);
            assert.ok(stdinGuide.stdout.includes('--remote-debugging-port=0'));

            const stdinInstall = spawnSync(
                process.execPath,
                ['-', '--install', '--local-dir', appZipPluginDir, '--no-remote-fallback', '--json'],
                { cwd: tempRoot, input: installerBytes, encoding: 'utf8', env: stdinEnv, timeout: 15_000 },
            );
            assert.equal(stdinInstall.status, 0, `Stdin-pipe installer --install failed: ${stdinInstall.stderr}`);
            const stdinInstallJson = JSON.parse(stdinInstall.stdout);
            assert.equal(stdinInstallJson.sourceMode, 'local');
            assert.equal(stdinInstallJson.version, version);
            assert.equal(stdinInstallJson.buildId, appManifest.buildId);

            // 3. Upgrade simulation from previous-release v1.17.11 layout
            const homeUpgrade = join(tempRoot, 'home-installer-upgrade');
            const prevPluginDir = join(homeUpgrade, '.gemini', 'config', 'plugins', PLUGIN_NAME);
            const prevConfigPath = join(homeUpgrade, '.gemini', 'config', 'config.json');
            mkdirSync(join(prevPluginDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app'), { recursive: true });
            mkdirSync(join(prevPluginDir, 'sidecars', 'context_monitor', 'runtime', 'src', 'images'), { recursive: true });
            writeFileSync(join(prevPluginDir, 'plugin.json'), JSON.stringify({ name: PLUGIN_NAME, version: '1.17.11' }, null, 2));
            writeFileSync(join(prevPluginDir, 'sidecars', 'context_monitor', 'sidecar.json'), JSON.stringify({ command: 'node', args: ['main.mjs'] }));
            writeFileSync(join(prevPluginDir, 'sidecars', 'context_monitor', 'main.mjs'), '// legacy v1.17.11 main\n');
            writeFileSync(join(prevPluginDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'), 'module.exports={legacy:true};\n');
            writeFileSync(join(prevPluginDir, 'sidecars', 'context_monitor', 'runtime', 'src', 'images', 'monitor-overview.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
            mkdirSync(dirname(prevConfigPath), { recursive: true });
            writeFileSync(prevConfigPath, JSON.stringify({
                plugins: {
                    [PLUGIN_NAME]: { enabled: false, customNote: 'preserve-me' },
                    'sibling-plugin': { enabled: true },
                },
                userSettings: { theme: 'dark', keepSetting: 42 },
            }, null, 2));

            const upgradeEnv = cleanChildEnv({ HOME: homeUpgrade, USERPROFILE: homeUpgrade, PATH: dirname(process.execPath) });
            const upgradeRes = spawnSync(
                process.execPath,
                [downloadedInstallerPath, '--install', '--local-dir', appZipPluginDir, '--no-remote-fallback', '--json'],
                { cwd: tempRoot, encoding: 'utf8', env: upgradeEnv, timeout: 15_000 },
            );
            assert.equal(upgradeRes.status, 0, `Upgrade from v1.17.11 failed: ${upgradeRes.stderr}`);
            const upgradeJson = JSON.parse(upgradeRes.stdout);
            assert.equal(upgradeJson.previousVersion, '1.17.11');
            assert.equal(upgradeJson.replaced, true);
            assert.equal(upgradeJson.reloadRequired, true);
            assert.equal(existsSync(join(prevPluginDir, 'sidecars', 'context_monitor', 'runtime', 'src', 'images', 'monitor-overview.png')), false, 'Legacy PNG must be cleared on upgrade');
            assert.equal(existsSync(join(prevPluginDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-bundle.js')), true, 'Bundled sidecar-bundle.js missing after upgrade');
            assert.equal(existsSync(join(prevPluginDir, 'bin', 'agy-statusline.mjs')), true, 'bin/agy-statusline.mjs missing after upgrade');

            const upgradedCfg = JSON.parse(readFileSync(prevConfigPath, 'utf8'));
            assert.equal(upgradedCfg.plugins[PLUGIN_NAME].enabled, true);
            assert.equal(upgradedCfg.plugins[PLUGIN_NAME].customNote, 'preserve-me');
            assert.equal(upgradedCfg.plugins['sibling-plugin'].enabled, true);
            assert.deepEqual(upgradedCfg.userSettings, { theme: 'dark', keepSetting: 42 });

            // Exercise the released installer itself against the extracted candidate.
            // Pin the release commit so a moved tag or working-tree edit cannot replace it.
            const legacyInstaller = join(tempRoot, 'downloaded', 'v1.17.11-installer.mjs');
            const legacyBytes = execFileSync('git', [
                'show', '93cd3e9cd3382a1174537f365ee5b9f664cca9f9:scripts/install-app-plugin.mjs',
            ], { cwd: REPO_ROOT });
            writeFileSync(legacyInstaller, legacyBytes);
            const legacyHome = join(tempRoot, 'home-released-installer');
            const legacyResult = spawnSync(process.execPath, [
                realpathSync(legacyInstaller), '--install', '--source', appTarGzPluginDir, '--no-remote-fallback', '--json',
            ], {
                cwd: tempRoot, encoding: 'utf8', timeout: 15_000,
                env: cleanChildEnv({ HOME: legacyHome, USERPROFILE: legacyHome, PATH: dirname(process.execPath) }),
            });
            assert.equal(legacyResult.status, 0, legacyResult.stderr);
            assert.equal(JSON.parse(legacyResult.stdout).version, version);
            const installedRuntime = join(legacyHome, '.gemini', 'config', 'plugins', PLUGIN_NAME,
                'sidecars', 'context_monitor', 'runtime');
            assert.equal(JSON.parse(readFileSync(join(installedRuntime, 'package.json'), 'utf8')).buildId, appManifest.buildId);
            assert.equal(sha256File(join(installedRuntime, 'out', 'app', 'sidecar-bundle.js')),
                sha256File(join(appTarGzPluginDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-bundle.js')));
        });

        // ── Check E: Extracted bin/agy-statusline.mjs outside repo ──
        await runCheck('E', 'Extracted bin/agy-statusline.mjs (single-line, ANSI/OSC stripping, NO_COLOR, 10-currency CAD, missing-metric —)', async () => {
            const fullFixture = JSON.stringify({
                cwd: '/home/dev/sample-project',
                session_id: '12345678-abcd-ef01-2345-6789abcdef01',
                conversation_id: '12345678-abcd-ef01-2345-6789abcdef01',
                conversation_title: 'Refactor bundler',
                model: { id: 'gemini-4-argon', display_name: 'Gemini 4 Argon (Medium)', effort: 'medium' },
                workspace: { current_dir: '/home/dev/sample-project', project_dir: '/home/dev/sample-project' },
                version: '1.5.18',
                context_window: {
                    total_input_tokens: 88244,
                    total_output_tokens: 61074,
                    context_window_size: 1048576,
                    used_percentage: 14.24,
                    current_usage: {
                        input_tokens: 63382,
                        output_tokens: 346,
                        cache_creation_input_tokens: 0,
                        cache_read_input_tokens: 20857,
                    },
                },
                exceeds_200k_tokens: false,
                quota: { 'gemini-weekly': { remaining_fraction: 0.9378 } },
                agent_state: 'idle',
                email: 'private-sentinel@corp.example',
                cost: { total_usd: 0.4213, subagent_usd: 0, estimated: false },
            });

            const maliciousFixture = JSON.stringify({
                model: { display_name: '\x1b[31mEvil\nModel\x1b]0;pwned\x07\r\n' },
                workspace: { project_dir: '/tmp/\x1b[2Jbad\nrepo' },
                conversation_title: 'Line1\nLine2\x9b31mInjected',
                email: 'never-leak@secret.example',
                context_window: { context_window_size: 200000, current_usage: { input_tokens: 50000 } },
                cost: { total_usd: 1.5 },
            });

            const missingFixture = JSON.stringify({
                model: { display_name: 'Gemini 4 Pro' },
                workspace: { project_dir: '/tmp/no-metrics' },
                context_window: { context_window_size: 0, current_usage: null },
            });

            for (const binPath of [
                join(appZipPluginDir, 'bin', 'agy-statusline.mjs'),
                join(appTarGzPluginDir, 'bin', 'agy-statusline.mjs'),
                standaloneStatuslinePath,
            ]) {
                // 1. Full payload + NO_COLOR=1
                const r1 = spawnSync(process.execPath, [binPath], {
                    cwd: tempRoot,
                    input: fullFixture,
                    encoding: 'utf8',
                    env: cleanChildEnv({ NO_COLOR: '1' }),
                    timeout: 5_000,
                });
                assert.equal(r1.status, 0, `agy-statusline failed on full payload: ${r1.stderr}`);
                const lines1 = r1.stdout.replace(/\r?\n$/, '').split(/\r?\n/);
                assert.equal(lines1.length, 1, `Expected strictly 1 line, got ${lines1.length}`);
                assert.ok(!lines1[0].includes('\x1b'), 'NO_COLOR=1 output must contain zero ANSI escapes');
                assert.ok(lines1[0].includes('Gemini 4 Argon (Medium)'));
                assert.ok(lines1[0].includes('Ctx 8%'));
                assert.ok(lines1[0].includes('$0.42'));
                assert.ok(lines1[0].includes('Q 94%'));
                assert.ok(lines1[0].includes('sample-project'));
                assert.ok(!lines1[0].includes('private-sentinel@corp.example'), 'Email must NEVER appear in statusline output');

                // 2. Malicious ANSI/OSC/newline injection + --show-title + NO_COLOR=1
                const r2 = spawnSync(process.execPath, [binPath, '--show-title'], {
                    cwd: tempRoot,
                    input: maliciousFixture,
                    encoding: 'utf8',
                    env: cleanChildEnv({ NO_COLOR: '1' }),
                    timeout: 5_000,
                });
                assert.equal(r2.status, 0);
                const lines2 = r2.stdout.replace(/\r?\n$/, '').split(/\r?\n/);
                assert.equal(lines2.length, 1, 'Malicious newline payload broke single-line invariant');
                assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(lines2[0]), `Unsanitized control chars leaked: ${JSON.stringify(lines2[0])}`);
                assert.ok(!lines2[0].includes('never-leak@secret.example'));

                // 3. Missing metrics -> explicit — placeholders
                const r3 = spawnSync(process.execPath, [binPath, '--no-color'], {
                    cwd: tempRoot,
                    input: missingFixture,
                    encoding: 'utf8',
                    env: cleanChildEnv(),
                    timeout: 5_000,
                });
                assert.equal(r3.status, 0);
                assert.ok(r3.stdout.includes('Ctx —'), `Expected explicit Ctx — placeholder, got: ${r3.stdout}`);
                assert.ok(r3.stdout.includes('Cost —'), `Expected explicit Cost — placeholder, got: ${r3.stdout}`);

                // 4. CAD currency check
                const r4 = spawnSync(process.execPath, [binPath, '--currency', 'CAD', '--no-color'], {
                    cwd: tempRoot,
                    input: fullFixture,
                    encoding: 'utf8',
                    env: cleanChildEnv(),
                    timeout: 5_000,
                });
                assert.equal(r4.status, 0);
                assert.ok(r4.stdout.includes('CA$'), `Expected disambiguated CA$ symbol, got: ${r4.stdout}`);
            }
        });

        // ── Check F: Browser bundle sanity (CSP safety, buildId content hash, preload -> bridge -> client order) ──
        await runCheck('F', 'Browser bundle sanity (CSP </script escaping, buildId hashes, preload -> bridge -> client order)', async () => {
            const ideExtCode = readFileSync(join(vsixExtractDir, 'extension', 'dist-stage', 'ide', 'extension.js'), 'utf8');
            const appBundleCode = readFileSync(
                join(appZipPluginDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-bundle.js'),
                'utf8',
            );

            assert.match(clientManifest.webview.buildId, /^[a-f0-9]{16}$/);
            assert.match(clientManifest.cdpOverlay.buildId, /^[a-f0-9]{16}$/);
            assert.ok(ideExtCode.includes(clientManifest.webview.buildId), 'Extracted IDE bundle missing WEBVIEW_CLIENT_BUILD_ID');
            assert.ok(appBundleCode.includes(clientManifest.webview.buildId), 'Extracted App bundle missing WEBVIEW_CLIENT_BUILD_ID');
            assert.ok(appBundleCode.includes(clientManifest.cdpOverlay.buildId), 'Extracted App bundle missing CDP_OVERLAY_CLIENT_BUILD_ID');

            // Verify rendered HTML from extracted App Sidecar SDK mode preserves preload -> bridge -> client order
            assert.ok(renderedAppHtmlFromSdk.length > 500, 'Expected non-empty rendered HTML from extracted App Sidecar');
            const preloadIdx = renderedAppHtmlFromSdk.indexOf('src="/preload.js"');
            const bridgeIdx = renderedAppHtmlFromSdk.indexOf('window.__ACM_BRIDGE__');
            const clientIdx = renderedAppHtmlFromSdk.indexOf('__ACM_WEBVIEW_FACTORY__.mountWebviewClient');
            assert.ok(preloadIdx > -1, 'Missing /preload.js script tag in rendered Sidecar HTML');
            assert.ok(bridgeIdx > preloadIdx, `Expected host bridge (${bridgeIdx}) after /preload.js (${preloadIdx})`);
            assert.ok(clientIdx > bridgeIdx, `Expected client bundle (${clientIdx}) after host bridge (${bridgeIdx})`);

            // Every inline <script> block in rendered HTML must contain ZERO raw nested </script
            const scriptBlocks = [...renderedAppHtmlFromSdk.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
            assert.ok(scriptBlocks.length >= 2, 'Expected host bridge + client inline script blocks');
            for (const m of scriptBlocks) {
                assert.ok(!/<\/script/i.test(m[1]), 'Unescaped </script found inside rendered inline <script> body');
            }

            // Verify staged CDP overlay client bundle has zero forbidden Trusted Types constructs or raw </script
            const stagedCdpPath = join(REPO_ROOT, 'dist-stage', 'client', 'cdp-overlay-client.js');
            const cdpCode = readFileSync(stagedCdpPath, 'utf8');
            assert.ok(!/<\/script/i.test(cdpCode), 'Unescaped </script in CDP overlay bundle');
            for (const re of [/\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /\bdocument\.write\b/, /\beval\s*\(/, /\bnew\s+Function\b/]) {
                assert.ok(!re.test(cdpCode), `Forbidden pattern ${re} detected in CDP overlay bundle`);
            }

            const stagedWebview = readFileSync(join(REPO_ROOT, 'dist-stage', 'client', 'webview-client.js'), 'utf8').trimEnd();
            assert.ok(renderedAppHtmlFromSdk.includes(stagedWebview), 'SDK did not render the staged Webview client');
        });

        console.log('');
        console.log(`[test:dist] ALL ${results.length}/${results.length} out-of-repo checks PASSED!`);
        console.log(`[test:dist] Measured Artifact Sizes (v${version}):`);
        const extJsEntry = vsixExtracted.entries.find((e) => e.name.toLowerCase() === 'extension/dist-stage/ide/extension.js') || null;
        const readmeEntry = vsixExtracted.entries.find((e) => e.name.toLowerCase() === 'extension/readme.md') || null;
        const iconEntry = vsixExtracted.entries.find((e) => e.name.toLowerCase() === 'extension/assets/icon.png') || null;
        const stretchCompDeltaKb = ((vsixExtracted.compressedBytes - BLUEPRINT_VSIX_ESTIMATE_BYTES.vsixCompressedBytes) / 1024).toFixed(1);
        const stretchRawDeltaKb = ((vsixExtracted.uncompressedBytes - BLUEPRINT_VSIX_ESTIMATE_BYTES.vsixUncompressedBytes) / 1024).toFixed(1);
        console.log(`  IDE VSIX             : compressed ${formatKb(vsixExtracted.compressedBytes)}, uncompressed ${formatKb(vsixExtracted.uncompressedBytes)} (${(vsixExtracted.uncompressedBytes / (1024 * 1024)).toFixed(2)} MB; release ceiling <= 560 KB / <= 1.55 MB)`);
        if (extJsEntry) {
            const readmePart = readmeEntry ? `, readme.md=${formatKb(readmeEntry.size)} raw / ${formatKb(readmeEntry.compressedSize)} deflated` : '';
            const iconPart = iconEntry ? `, icon.png=${formatKb(iconEntry.size)}` : '';
            console.log(`  IDE VSIX floor       : extension.js=${formatKb(extJsEntry.size)} raw / ${formatKb(extJsEntry.compressedSize)} deflated${readmePart}${iconPart} | vs pre-Plan-C §4.3 blueprint estimate (400 KB / 1.00 MB): ${Number(stretchCompDeltaKb) >= 0 ? '+' : ''}${stretchCompDeltaKb} KB comp, ${Number(stretchRawDeltaKb) >= 0 ? '+' : ''}${stretchRawDeltaKb} KB raw`);
        }
        console.log(`  App Sidecar ZIP      : ${formatKb(appZipExtracted.compressedBytes)} (${appZipExtracted.entries.length} files; hard ceiling < 563.2 KB / 0.55 MB)`);
        console.log(`  App Sidecar TAR.GZ   : ${formatKb(appTarGzExtracted.compressedBytes)} (${appTarGzExtracted.entries.length} files)`);
        console.log(`  install-app-plugin   : ${formatKb(statSync(installerSrcPath).size)}`);
        console.log(`  agy-statusline.mjs   : ${formatKb(statSync(statuslineSrcPath).size)}`);
        for (const [label, relManifest] of [
            ['App Top-10 metafile', join(REPO_ROOT, 'dist-stage', 'app', 'manifest.json')],
            ['IDE Top-10 metafile', join(REPO_ROOT, 'dist-stage', 'ide', 'manifest.json')],
        ]) {
            if (existsSync(relManifest)) {
                try {
                    const m = JSON.parse(readFileSync(relManifest, 'utf8'));
                    if (Array.isArray(m?.topInputs) && m.topInputs.length > 0) {
                        console.log(`  ${label}:`);
                        for (const item of m.topInputs) {
                            console.log(`    - ${(item.bytes / 1024).toFixed(1).padStart(6)} KB  ${item.path}`);
                        }
                    }
                } catch { /* ignore */ }
            }
        }
        return { ok: true, passed: results.length, total: results.length };
    } finally {
        try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const strictSize = process.argv.includes('--strict-size');
    runDistTests({ strictSize })
        .catch((err) => {
            console.error(`[test:dist] FAILED: ${err instanceof Error ? (err.stack || err.message) : String(err)}`);
            process.exit(1);
        });
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ALLOWED_RELEASE_HOSTS,
    DEFAULT_UPDATE_CHECK_THROTTLE_MS,
    EXPECTED_PLUGIN_NAME,
    applyAppPluginUpdate,
    checkForUpdates,
    compareSemver,
    computeSha256Hex,
    crc32,
    extractZipSafe,
    fetchAllowedHttps,
    isNewerVersion,
    parseSemver,
    parseSha256Sums,
    resolveExtractedPluginRoot,
    summarizeReleaseNotes,
    validateExtractedPluginBundle,
    validateReleaseUrl,
    verifyBufferSha256,
    type HttpsRequestTransport,
} from '../src/app/plugin-updater';
import type { PluginReleaseInfo } from '../src/app/sidecar-types';

interface TestZipEntry {
    name: string;
    data: Buffer | string;
    method?: 0 | 8;
    unixMode?: number;
    flags?: number;
    corruptCrc?: boolean;
}

/**
 * Pure-Node test PKZIP builder supporting Stored (0), Deflate (8), custom Unix modes
 * (e.g. symlink 0o120777), flags, and optional CRC corruption for adversarial tests.
 */
function buildTestZip(entries: readonly TestZipEntry[]): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
        const method = entry.method ?? 8;
        const payload = method === 8 ? zlib.deflateRawSync(rawData) : rawData;
        const checksum = entry.corruptCrc ? ((crc32(rawData) ^ 0xdeadbeef) >>> 0) : crc32(rawData);
        const flags = entry.flags ?? 0x0800;
        const unixMode = (entry.unixMode ?? 0o100644) & 0xffff;
        const externalAttrs = (unixMode << 16) >>> 0;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(payload.length, 18);
        local.writeUInt32LE(rawData.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        localParts.push(local, nameBuf, payload);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE((3 << 8) | 20, 4); // Unix + 2.0
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(flags, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(payload.length, 20);
        central.writeUInt32LE(rawData.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(externalAttrs, 38);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, nameBuf);

        offset += local.length + nameBuf.length + payload.length;
    }

    const centralBuf = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralBuf, eocd]);
}

function makeValidPluginZip(version: string, pluginName = EXPECTED_PLUGIN_NAME, includeMainMjs = true): Buffer {
    const entries: TestZipEntry[] = [
        {
            name: `${EXPECTED_PLUGIN_NAME}/plugin.json`,
            data: JSON.stringify({ name: pluginName, version, displayName: 'Antigravity Context Monitor' }, null, 2),
            method: 8,
        },
        {
            name: `${EXPECTED_PLUGIN_NAME}/assets/logo.svg`,
            data: '<svg></svg>',
            method: 0,
        },
    ];
    if (includeMainMjs) {
        entries.push({
            name: `${EXPECTED_PLUGIN_NAME}/sidecars/context_monitor/main.mjs`,
            data: `// v${version}\nexport const version = ${JSON.stringify(version)};\n`,
            method: 8,
            unixMode: 0o100755,
        });
    }
    return buildTestZip(entries);
}

describe('App Plugin Self-Updater Engine', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-updater-test-'));
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('Semver parsing & comparison', () => {
        it('parses and compares standard and prerelease versions accurately', () => {
            expect(parseSemver('v1.17.6')?.normalized).toBe('1.17.6');
            expect(parseSemver('1.17.6-rc.2')?.prerelease).toEqual(['rc', '2']);
            expect(parseSemver('not-a-version')).toBeNull();
            expect(parseSemver('01.2.3')).toBeNull();

            expect(compareSemver('1.17.6', '1.17.5')).toBeGreaterThan(0);
            expect(compareSemver('v1.17.6', '1.17.6')).toBe(0);
            expect(compareSemver('1.17.6', '1.17.6-rc.1')).toBeGreaterThan(0);
            expect(compareSemver('1.17.6-rc.2', '1.17.6-rc.1')).toBeGreaterThan(0);

            expect(isNewerVersion('1.17.6', '1.17.5')).toBe(true);
            expect(isNewerVersion('1.17.5', '1.17.5')).toBe(false);
            expect(isNewerVersion('1.17.4', '1.17.5')).toBe(false);
            expect(isNewerVersion('invalid', '1.17.5')).toBe(false);
        });
    });

    describe('Strict HTTPS host allowlist & safe redirect handling', () => {
        it('permits only the 4 official GitHub HTTPS hosts and rejects all others', () => {
            for (const host of ALLOWED_RELEASE_HOSTS) {
                expect(validateReleaseUrl(`https://${host}/path/to/asset.zip`).hostname).toBe(host);
            }
            expect(() => validateReleaseUrl('http://github.com/a/b')).toThrow(/non-HTTPS/i);
            expect(() => validateReleaseUrl('https://evil.example.com/a.zip')).toThrow(/non-allowlisted/i);
            expect(() => validateReleaseUrl('https://github.com.evil.com/a.zip')).toThrow(/non-allowlisted/i);
            expect(() => validateReleaseUrl('https://user:pass@github.com/a.zip')).toThrow(/credentials/i);
            expect(() => validateReleaseUrl('https://github.com:8443/a.zip')).toThrow(/port/i);
        });

        it('follows allowlisted redirects and rejects redirects onto disallowed hosts or exceeding 5 hops', async () => {
            const seenHosts: string[] = [];
            const okTransport: HttpsRequestTransport = async (url) => {
                seenHosts.push(url.hostname);
                if (url.hostname === 'github.com') {
                    return {
                        statusCode: 302,
                        headers: { location: 'https://objects.githubusercontent.com/dl/pkg.zip' },
                        body: Buffer.alloc(0),
                    };
                }
                return { statusCode: 200, headers: {}, body: Buffer.from('ok') };
            };
            const res = await fetchAllowedHttps('https://github.com/AGI-is-going-to-arrive/r/releases/download/v1.17.6/pkg.zip', {
                transport: okTransport,
            });
            expect(res.statusCode).toBe(200);
            expect(seenHosts).toEqual(['github.com', 'objects.githubusercontent.com']);

            // Redirect to untrusted host MUST fail immediately on hop 2
            const evilRedirect: HttpsRequestTransport = async () => ({
                statusCode: 302,
                headers: { location: 'https://attacker.invalid/malware.zip' },
                body: Buffer.alloc(0),
            });
            await expect(fetchAllowedHttps('https://github.com/a/b', { transport: evilRedirect }))
                .rejects.toThrow(/non-allowlisted/i);

            // Exceeding 5 hops MUST fail
            let hopCount = 0;
            const infiniteRedirect: HttpsRequestTransport = async () => {
                hopCount++;
                return {
                    statusCode: 302,
                    headers: { location: `https://github.com/hop/${hopCount}` },
                    body: Buffer.alloc(0),
                };
            };
            await expect(fetchAllowedHttps('https://github.com/start', { transport: infiniteRedirect }))
                .rejects.toThrow(/Too many redirects/i);
        });
    });

    describe('checkForUpdates (throttling, ETag 304, asset discovery)', () => {
        it('throttles within 6h unless force=true, sends ETag & User-Agent, and handles 304 Not Modified', async () => {
            const nowMs = 1_700_000_000_000;
            const transportSpy = vi.fn<HttpsRequestTransport>();

            // Throttled when checked 1 hour ago
            const throttled = await checkForUpdates({
                currentVersion: '1.17.5',
                lastCheckedAt: nowMs - 3_600_000,
                etag: 'W/"etag-1"',
                now: () => nowMs,
                transport: transportSpy,
            });
            expect(throttled.status).toBe('throttled');
            expect(transportSpy).not.toHaveBeenCalled();

            // Force bypasses throttle, sends If-None-Match + User-Agent, handles 304
            transportSpy.mockResolvedValueOnce({
                statusCode: 304,
                headers: { etag: 'W/"etag-1"' },
                body: Buffer.alloc(0),
            });
            const notMod = await checkForUpdates({
                currentVersion: '1.17.5',
                force: true,
                lastCheckedAt: nowMs - 60_000,
                etag: 'W/"etag-1"',
                now: () => nowMs,
                transport: transportSpy,
            });
            expect(notMod.status).toBe('not_modified');
            expect(notMod.hasUpdate).toBe(false);
            const sentHeaders = transportSpy.mock.calls[0][1].headers;
            expect(sentHeaders['User-Agent']).toBe('Antigravity-Context-Monitor/1.17.5');
            expect(sentHeaders['If-None-Match']).toBe('W/"etag-1"');
            expect(transportSpy.mock.calls[0][1].timeoutMs).toBe(12_000);

            // Unthrottled after 6h parses release JSON and locates zip + SHA256SUMS.txt
            transportSpy.mockResolvedValueOnce({
                statusCode: 200,
                headers: { etag: '"etag-2"' },
                body: Buffer.from(JSON.stringify({
                    tag_name: 'v1.17.6',
                    html_url: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.17.6',
                    published_at: '2026-11-23T00:00:00Z',
                    body: '## Highlights\n- Opt-in CDP overlays\n- Self-updater',
                    assets: [
                        {
                            name: 'antigravity-context-monitor-app-1.17.6.zip',
                            browser_download_url: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.17.6/antigravity-context-monitor-app-1.17.6.zip',
                            size: 123456,
                        },
                        {
                            name: 'SHA256SUMS.txt',
                            browser_download_url: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.17.6/SHA256SUMS.txt',
                        },
                    ],
                }), 'utf8'),
            });

            const available = await checkForUpdates({
                currentVersion: '1.17.5',
                lastCheckedAt: nowMs - DEFAULT_UPDATE_CHECK_THROTTLE_MS - 1,
                now: () => nowMs,
                transport: transportSpy,
            });
            expect(available.status).toBe('update_available');
            expect(available.hasUpdate).toBe(true);
            expect(available.latestVersion).toBe('1.17.6');
            expect(available.etag).toBe('"etag-2"');
            expect(available.releaseInfo?.assetName).toBe('antigravity-context-monitor-app-1.17.6.zip');
            expect(available.releaseInfo?.checksumsUrl).toContain('SHA256SUMS.txt');
            expect(available.releaseInfo?.releaseNotesSummary).toContain('Opt-in CDP overlays');
            expect(summarizeReleaseNotes('a'.repeat(700), 100).length).toBeLessThanOrEqual(100);
        });
    });

    describe('SHA-256 verification & Pure-Node ZIP extraction security', () => {
        it('parses SHA256SUMS.txt and verifies digests in constant time', () => {
            const data = Buffer.from('test-archive-bytes');
            const hex = computeSha256Hex(data);
            const sums = parseSha256Sums([
                '# SHA256 checksums',
                `${hex}  dist/antigravity-context-monitor-app-1.17.6.zip`,
                `${'a'.repeat(64)} *other.tar.gz`,
            ].join('\n'));
            expect(sums.get('antigravity-context-monitor-app-1.17.6.zip')).toBe(hex);
            expect(verifyBufferSha256(data, hex)).toBe(true);
            expect(verifyBufferSha256(data, 'b'.repeat(64))).toBe(false);
            expect(verifyBufferSha256(data, 'not-hex')).toBe(false);
        });

        it('extracts Stored and Deflate entries and rejects zip-slip, absolute paths, symlinks, encrypted entries, and bad CRC', () => {
            const goodZip = makeValidPluginZip('1.17.6');
            const outDir = path.join(tempDir, 'good');
            const res = extractZipSafe(goodZip, outDir);
            expect(res.entries.length).toBe(3);
            const root = resolveExtractedPluginRoot(outDir);
            expect(validateExtractedPluginBundle(root).version).toBe('1.17.6');

            // Zip-slip traversal
            const slipZip = buildTestZip([{ name: '../escape.txt', data: 'evil', method: 0 }]);
            expect(() => extractZipSafe(slipZip, path.join(tempDir, 'slip'))).toThrow(/traversal/i);

            const nestedSlipZip = buildTestZip([{ name: 'a/b/../../../escape.txt', data: 'evil', method: 0 }]);
            expect(() => extractZipSafe(nestedSlipZip, path.join(tempDir, 'nslip'))).toThrow(/traversal/i);

            // Absolute paths (POSIX & Windows)
            const absPosixZip = buildTestZip([{ name: '/etc/passwd', data: 'evil', method: 0 }]);
            expect(() => extractZipSafe(absPosixZip, path.join(tempDir, 'abs1'))).toThrow(/absolute/i);

            const absWinZip = buildTestZip([{ name: 'C:\\Windows\\evil.dll', data: 'evil', method: 0 }]);
            expect(() => extractZipSafe(absWinZip, path.join(tempDir, 'abs2'))).toThrow(/absolute/i);

            // Symlink rejection (Unix mode 0o120777)
            const symlinkZip = buildTestZip([{
                name: 'antigravity-context-monitor/evil-link',
                data: '/etc/passwd',
                method: 0,
                unixMode: 0o120777,
            }]);
            expect(() => extractZipSafe(symlinkZip, path.join(tempDir, 'sym'))).toThrow(/symlink/i);

            // Encrypted flag rejection
            const encZip = buildTestZip([{ name: 'a.txt', data: 'secret', method: 0, flags: 0x0001 }]);
            expect(() => extractZipSafe(encZip, path.join(tempDir, 'enc'))).toThrow(/encrypted/i);

            // CRC-32 corruption rejection
            const crcZip = buildTestZip([{ name: 'a.txt', data: 'corrupted', method: 8, corruptCrc: true }]);
            expect(() => extractZipSafe(crcZip, path.join(tempDir, 'crc'))).toThrow(/CRC-32/i);
        });
    });

    describe('applyAppPluginUpdate (SHA-256 verification, atomic install, rollback, Windows EBUSY fallback)', () => {
        function seedInstalledPlugin(dir: string, version: string): void {
            fs.mkdirSync(path.join(dir, 'sidecars', 'context_monitor'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: EXPECTED_PLUGIN_NAME, version }), 'utf8');
            fs.writeFileSync(path.join(dir, 'sidecars', 'context_monitor', 'main.mjs'), `// old ${version}\n`, 'utf8');
        }

        function makeReleaseInfo(version = '1.17.6', withChecksums = true): PluginReleaseInfo {
            return {
                version,
                tagName: `v${version}`,
                releaseUrl: `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v${version}`,
                releaseNotesSummary: 'New features',
                assetName: `antigravity-context-monitor-app-${version}.zip`,
                assetUrl: `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v${version}/antigravity-context-monitor-app-${version}.zip`,
                checksumsUrl: withChecksums
                    ? `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v${version}/SHA256SUMS.txt`
                    : null,
            };
        }

        it('verifies SHA-256, swaps atomically, cleans up backup, and returns requiresReload=true', async () => {
            const targetDir = path.join(tempDir, 'plugins', EXPECTED_PLUGIN_NAME);
            seedInstalledPlugin(targetDir, '1.17.5');

            const zipBuf = makeValidPluginZip('1.17.6');
            const shaHex = computeSha256Hex(zipBuf);
            const sumsText = `${shaHex}  antigravity-context-monitor-app-1.17.6.zip\n`;

            const transport: HttpsRequestTransport = async (url) => {
                if (url.pathname.endsWith('SHA256SUMS.txt')) {
                    return { statusCode: 200, headers: {}, body: Buffer.from(sumsText, 'utf8') };
                }
                return { statusCode: 200, headers: {}, body: zipBuf };
            };

            const res = await applyAppPluginUpdate({
                targetPluginDir: targetDir,
                releaseInfo: makeReleaseInfo('1.17.6', true),
                currentVersion: '1.17.5',
                transport,
            });

            expect(res.ok).toBe(true);
            expect(res.previousVersion).toBe('1.17.5');
            expect(res.installedVersion).toBe('1.17.6');
            expect(res.requiresReload).toBe(true);
            expect(res.checksumVerified).toBe(true);

            const installedManifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8'));
            expect(installedManifest.version).toBe('1.17.6');
            // No leftover .bak or .stage sibling dirs
            const siblings = fs.readdirSync(path.dirname(targetDir));
            expect(siblings).toEqual([EXPECTED_PLUGIN_NAME]);
        });

        it('aborts on SHA-256 mismatch without touching the existing installed plugin', async () => {
            const targetDir = path.join(tempDir, 'plugins-badsha', EXPECTED_PLUGIN_NAME);
            seedInstalledPlugin(targetDir, '1.17.5');
            const zipBuf = makeValidPluginZip('1.17.6');

            const transport: HttpsRequestTransport = async (url) => {
                if (url.pathname.endsWith('SHA256SUMS.txt')) {
                    return { statusCode: 200, headers: {}, body: Buffer.from(`${'0'.repeat(64)}  antigravity-context-monitor-app-1.17.6.zip\n`, 'utf8') };
                }
                return { statusCode: 200, headers: {}, body: zipBuf };
            };

            const res = await applyAppPluginUpdate({
                targetPluginDir: targetDir,
                releaseInfo: makeReleaseInfo('1.17.6', true),
                currentVersion: '1.17.5',
                transport,
            });

            expect(res.ok).toBe(false);
            expect(res.error).toMatch(/SHA-256 checksum mismatch/i);
            const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8'));
            expect(manifest.version).toBe('1.17.5');
        });

        it('fails closed when SHA256SUMS.txt is published but returns non-2xx or omits assetName', async () => {
            const targetDir = path.join(tempDir, 'plugins-failclosed-sha', EXPECTED_PLUGIN_NAME);
            seedInstalledPlugin(targetDir, '1.17.5');
            const zipBuf = makeValidPluginZip('1.17.6');

            // Case A: SHA256SUMS.txt returns 500
            const resHttpErr = await applyAppPluginUpdate({
                targetPluginDir: targetDir,
                releaseInfo: makeReleaseInfo('1.17.6', true),
                currentVersion: '1.17.5',
                transport: async (url) => {
                    if (url.pathname.endsWith('SHA256SUMS.txt')) {
                        return { statusCode: 500, headers: {}, body: Buffer.from('upstream error', 'utf8') };
                    }
                    return { statusCode: 200, headers: {}, body: zipBuf };
                },
            });
            expect(resHttpErr.ok).toBe(false);
            expect(resHttpErr.error).toMatch(/SHA256SUMS\.txt.*HTTP 500/i);
            expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version).toBe('1.17.5');

            // Case B: SHA256SUMS.txt returns 200 OK but omits our asset entry
            const resMissingEntry = await applyAppPluginUpdate({
                targetPluginDir: targetDir,
                releaseInfo: makeReleaseInfo('1.17.6', true),
                currentVersion: '1.17.5',
                transport: async (url) => {
                    if (url.pathname.endsWith('SHA256SUMS.txt')) {
                        return {
                            statusCode: 200,
                            headers: {},
                            body: Buffer.from(`${'a'.repeat(64)}  unrelated-asset.vsix\n`, 'utf8'),
                        };
                    }
                    return { statusCode: 200, headers: {}, body: zipBuf };
                },
            });
            expect(resMissingEntry.ok).toBe(false);
            expect(resMissingEntry.error).toMatch(/did not contain an entry/i);
            expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version).toBe('1.17.5');
        });

        it('rejects invalid bundles (wrong name or missing main.mjs) before touching existing install', async () => {
            const targetDir = path.join(tempDir, 'plugins-invalid', EXPECTED_PLUGIN_NAME);
            seedInstalledPlugin(targetDir, '1.17.5');

            const wrongNameZip = makeValidPluginZip('1.17.6', 'evil-plugin', true);
            const res1 = await applyAppPluginUpdate({
                targetPluginDir: targetDir,
                releaseInfo: makeReleaseInfo('1.17.6', false),
                currentVersion: '1.17.5',
                transport: async () => ({ statusCode: 200, headers: {}, body: wrongNameZip }),
            });
            expect(res1.ok).toBe(false);
            expect(res1.error).toMatch(/unexpected plugin name/i);

            const missingMainZip = makeValidPluginZip('1.17.6', EXPECTED_PLUGIN_NAME, false);
            const res2 = await applyAppPluginUpdate({
                targetPluginDir: targetDir,
                releaseInfo: makeReleaseInfo('1.17.6', false),
                currentVersion: '1.17.5',
                transport: async () => ({ statusCode: 200, headers: {}, body: missingMainZip }),
            });
            expect(res2.ok).toBe(false);
            expect(res2.error).toMatch(/missing sidecars\/context_monitor\/main\.mjs/i);
        });

        it('automatically rolls back backup when staging-to-target swap fails mid-flight', async () => {
            const targetDir = path.join(tempDir, 'plugins-rollback', EXPECTED_PLUGIN_NAME);
            seedInstalledPlugin(targetDir, '1.17.5');
            const zipBuf = makeValidPluginZip('1.17.6');

            let renameCalls = 0;
            const failingSwapRename = async (src: string, dest: string) => {
                renameCalls++;
                if (renameCalls === 1) {
                    // First rename (existing -> backup) succeeds
                    await fs.promises.rename(src, dest);
                    return;
                }
                // Second rename (staging -> target) fails permanently
                throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
            };

            const res = await applyAppPluginUpdate({
                targetPluginDir: targetDir,
                releaseInfo: makeReleaseInfo('1.17.6', false),
                currentVersion: '1.17.5',
                transport: async () => ({ statusCode: 200, headers: {}, body: zipBuf }),
                renameDir: failingSwapRename,
            });

            expect(res.ok).toBe(false);
            expect(res.rolledBack).toBe(true);
            expect(res.installedVersion).toBe('1.17.5');
            // Original v1.17.5 files are restored cleanly!
            const restored = JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8'));
            expect(restored.version).toBe('1.17.5');
            expect(fs.readdirSync(path.dirname(targetDir))).toEqual([EXPECTED_PLUGIN_NAME]);
        });

        it('falls back cleanly to copy-replace when Windows EBUSY/EPERM blocks renaming targetPluginDir', async () => {
            const targetDir = path.join(tempDir, 'plugins-winlock', EXPECTED_PLUGIN_NAME);
            seedInstalledPlugin(targetDir, '1.17.5');
            fs.writeFileSync(path.join(targetDir, 'stale-file.txt'), 'old', 'utf8');
            const zipBuf = makeValidPluginZip('1.17.6');

            const alwaysEbusyRename = async () => {
                throw Object.assign(new Error('resource busy'), { code: 'EBUSY' });
            };

            const res = await applyAppPluginUpdate({
                targetPluginDir: targetDir,
                releaseInfo: makeReleaseInfo('1.17.6', false),
                currentVersion: '1.17.5',
                transport: async () => ({ statusCode: 200, headers: {}, body: zipBuf }),
                renameDir: alwaysEbusyRename,
            });

            expect(res.ok).toBe(true);
            expect(res.installedVersion).toBe('1.17.6');
            const manifest = JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8'));
            expect(manifest.version).toBe('1.17.6');
            expect(fs.existsSync(path.join(targetDir, 'stale-file.txt'))).toBe(false);
        });
    });
});

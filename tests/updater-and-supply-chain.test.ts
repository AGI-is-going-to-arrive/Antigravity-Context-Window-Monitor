// Consolidated Domain Suite: App Plugin Updater, Supply-Chain Security, Release Identity & Rollback
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import {
    buildTestZip,
    makeApprovedReleaseInfo as makeSharedApprovedReleaseInfo,
    makeTestPluginZip,
    seedTestInstalledPlugin,
} from './helpers/factories';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    ALLOWED_RELEASE_HOSTS,
    applyAppPluginUpdate,
    checkForUpdates,
    compareSemver,
    computeSha256Hex,
    crc32,
    DEFAULT_UPDATE_CHECK_THROTTLE_MS,
    defaultHttpsTransport,
    establishHttpConnectTunnel,
    EXPECTED_PLUGIN_NAME,
    extractZipSafe,
    fetchAllowedHttps,
    GITHUB_RELEASES_ATOM_URL,
    type HttpsRequestTransport,
    isGitHubRateLimitResponse,
    isHostBypassedByNoProxy,
    isNewerVersion,
    parseReleasesAtomLatest,
    parseSemver,
    parseSha256Sums,
    resolveApprovedRelease,
    resolveExtractedPluginRoot,
    resolveHttpsProxyUrl,
    summarizeReleaseNotes,
    validateExtractedPluginBundle,
    validateReleaseUrl,
    verifyBufferSha256,
} from '../src/app/plugin-updater';
import type { PluginReleaseInfo } from '../src/app/sidecar-types';
import { execFileSync, spawn } from 'child_process';
import * as http from 'http';
import * as net from 'net';
import { ALLOWED_EXTERNAL_URL_HOSTS, validateExternalUrl } from '../src/core/external-url';
import {
    acquirePluginUpdateLock,
    APPROVED_GITHUB_REPO_SLUG,
    assertReleaseVersionMatches,
    assertSafeArchiveEntryPath,
    getPluginUpdateLockPath,
    lookupSha256Sum,
    validateApprovedReleaseAssetUrl,
    validateReleaseIdentity,
} from '../src/core/release-security';
import {
    buildLinuxDesktopEntry,
    buildLinuxLauncherScript,
    buildMacOsInfoPlist,
    buildMacOsLauncherScript,
    buildWindowsExplorerRevealCommand,
    clearWindowsLauncherCaches,
    createCdpLauncher,
    escapeFreedesktopExecArg,
    extractAntigravityExeFromLnkFile,
    getCachedWindowsDesktopDir,
    inspectCdpLauncher,
    isOwnedMacCdpBundle,
    LINUX_APPIMAGE_PROCESS_RE,
    LINUX_FLATPAK_APP_ID,
    LINUX_FLATPAK_BOUNDARY_NOTE_EN,
    LINUX_FLATPAK_BOUNDARY_NOTE_ZH,
    MACOS_CDP_LAUNCHER_BUNDLE_ID,
    readMacBundleIdentifier,
    refreshWindowsDesktopDirCache,
    removeCdpLauncher,
    resolveCdpLauncherPaths,
    resolveLinuxXdgDataHome,
    resolveWindowsAntigravityExeAsync,
    resolveWindowsDesktopDirAsync,
    revealCdpLauncher,
    revealCdpLauncherAsync,
    sanitizeLinuxXdgDir,
    type SpawnedLauncherProcessLike,
    WINDOWS_DESKTOP_CACHE_TTL_MS,
} from '../src/app/cdp-launcher';
import { buildPricingTabContent } from '../src/pricing-panel';
import { PricingStore } from '../src/pricing-store';
import { buildAboutTabContent } from '../src/webview-about-tab';
import { buildProfileContent } from '../src/webview-profile-tab';
import type { UserStatusInfo } from '../src/models';
import { EventEmitter } from 'events';
import * as https from 'https';

describe('[app-plugin-updater]', () => {
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
                name: `${EXPECTED_PLUGIN_NAME}/sidecars/context_monitor/sidecar.json`,
                data: JSON.stringify({ command: 'node', args: ['main.mjs'] }),
                method: 8,
            });
            entries.push({
                name: `${EXPECTED_PLUGIN_NAME}/sidecars/context_monitor/main.mjs`,
                data: `// v${version}\nexport const version = ${JSON.stringify(version)};\n`,
                method: 8,
                unixMode: 0o100755,
            });
            for (const f of ['sidecar-bundle.js', 'sidecar-server.js', 'sidecar-runtime.js']) {
                entries.push({
                    name: `${EXPECTED_PLUGIN_NAME}/sidecars/context_monitor/runtime/out/app/${f}`,
                    data: `module.exports = { version: ${JSON.stringify(version)} };\n`,
                    method: 8,
                });
            }
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

                for (const invalid of ['1.2.3-rc..2', '1.2.3-alpha.01', '1.2.3+ci.']) {
                    expect(parseSemver(invalid)).toBeNull();
                }
                expect(compareSemver('1.0.0-9007199254740993', '1.0.0-9007199254740992')).toBeGreaterThan(0);
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

            it('requires portable unique release file names and respects the active installer lock', async () => {
                for (const [a, b] of [
                    ['Lib/a.js', 'lib/b.js'], ['config.json', 'config.json'],
                    ['café.md', 'cafe\u0301.md'],
                ]) {
                    const zip = buildTestZip([a, b].map(name => ({ name, data: 'fixture', method: 0 })));
                    const dest = fs.mkdtempSync(path.join(tempDir, 'portable-'));
                    expect(() => extractZipSafe(zip, dest)).toThrow(/ambiguous|duplicate/i);
                }
                for (const name of ['report:summary.txt', 'aux.json', 'README.']) {
                    const zip = buildTestZip([{ name, data: 'fixture', method: 0 }]);
                    expect(() => extractZipSafe(zip, tempDir)).toThrow(/non-portable/i);
                }
                const target = path.join(tempDir, 'plugin');
                const lock = await acquirePluginUpdateLock(target, { now: () => 1 });
                try {
                    await expect(acquirePluginUpdateLock(target, { staleMs: 1, timeoutMs: 0 }))
                        .rejects.toThrow(/already in progress/);
                } finally {
                    lock.release();
                }
            });

            it('extracts Stored and Deflate entries and rejects zip-slip, absolute paths, symlinks, encrypted entries, and bad CRC', () => {
                const goodZip = makeValidPluginZip('1.17.6');
                const outDir = path.join(tempDir, 'good');
                const res = extractZipSafe(goodZip, outDir);
                expect(res.entries.length).toBe(7);
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
                fs.mkdirSync(path.join(dir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app'), { recursive: true });
                fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: EXPECTED_PLUGIN_NAME, version }), 'utf8');
                fs.writeFileSync(path.join(dir, 'sidecars', 'context_monitor', 'sidecar.json'), JSON.stringify({ command: 'node', args: ['main.mjs'] }), 'utf8');
                fs.writeFileSync(path.join(dir, 'sidecars', 'context_monitor', 'main.mjs'), `// old ${version}\n`, 'utf8');
                for (const f of ['sidecar-bundle.js', 'sidecar-server.js', 'sidecar-runtime.js']) {
                    fs.writeFileSync(path.join(dir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', f), `module.exports = { version: ${JSON.stringify(version)} };\n`, 'utf8');
                }
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

            function makeVerifiedTransport(zipBuf: Buffer, assetName: string): HttpsRequestTransport {
                const shaHex = computeSha256Hex(zipBuf);
                const sumsText = `${shaHex}  ${assetName}\n`;
                return async (url) => {
                    if (url.pathname.endsWith('SHA256SUMS.txt')) {
                        return { statusCode: 200, headers: {}, body: Buffer.from(sumsText, 'utf8') };
                    }
                    return { statusCode: 200, headers: {}, body: zipBuf };
                };
            }

            it('rejects invalid bundles (wrong name or missing main.mjs) before touching existing install', async () => {
                const targetDir = path.join(tempDir, 'plugins-invalid', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir, '1.17.5');
                const releaseInfo = makeReleaseInfo('1.17.6', true);

                const wrongNameZip = makeValidPluginZip('1.17.6', 'evil-plugin', true);
                const res1 = await applyAppPluginUpdate({
                    targetPluginDir: targetDir,
                    releaseInfo,
                    currentVersion: '1.17.5',
                    transport: makeVerifiedTransport(wrongNameZip, releaseInfo.assetName),
                });
                expect(res1.ok).toBe(false);
                expect(res1.error).toMatch(/unexpected plugin name/i);

                const missingMainZip = makeValidPluginZip('1.17.6', EXPECTED_PLUGIN_NAME, false);
                const res2 = await applyAppPluginUpdate({
                    targetPluginDir: targetDir,
                    releaseInfo,
                    currentVersion: '1.17.5',
                    transport: makeVerifiedTransport(missingMainZip, releaseInfo.assetName),
                });
                expect(res2.ok).toBe(false);
                expect(res2.error).toMatch(/missing sidecars\/context_monitor\/main\.mjs/i);
            });

            it('automatically rolls back backup when staging-to-target swap fails mid-flight', async () => {
                const targetDir = path.join(tempDir, 'plugins-rollback', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir, '1.17.5');
                const zipBuf = makeValidPluginZip('1.17.6');
                const releaseInfo = makeReleaseInfo('1.17.6', true);

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
                    releaseInfo,
                    currentVersion: '1.17.5',
                    transport: makeVerifiedTransport(zipBuf, releaseInfo.assetName),
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
                const releaseInfo = makeReleaseInfo('1.17.6', true);

                const alwaysEbusyRename = async () => {
                    throw Object.assign(new Error('resource busy'), { code: 'EBUSY' });
                };

                const res = await applyAppPluginUpdate({
                    targetPluginDir: targetDir,
                    releaseInfo,
                    currentVersion: '1.17.5',
                    transport: makeVerifiedTransport(zipBuf, releaseInfo.assetName),
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
});

describe('[supply-chain-unit]', () => {
    const REPO_ROOT = path.resolve(__dirname, '..');

    const INSTALLER_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.mjs');

    const INSTALLER_SH_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.sh');

    const PACKAGER_PATH = path.join(REPO_ROOT, 'scripts', 'package-app-plugin.mjs');

    const MAIN_MJS_PATH = path.join(REPO_ROOT, 'app-plugin', 'sidecars', 'context_monitor', 'main.mjs');
    const buildZip = buildTestZip;
    const makePluginBundleZip = makeTestPluginZip;
    const seedInstalledPlugin = seedTestInstalledPlugin;

    describe('Phase 1 Wave 1A: Supply-Chain Security, Standalone Auth, External URLs, Cross-Platform Launchers & Privacy', () => {
        let tempRoot: string;

        beforeEach(() => {
            clearWindowsLauncherCaches();
            tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-p1-sec-'));
        });

        afterEach(() => {
            clearWindowsLauncherCaches();
            vi.restoreAllMocks();
            fs.rmSync(tempRoot, { recursive: true, force: true });
        });

        // ─── Core Release Security Module (src/core/release-security.ts) ─────────

        describe('src/core/release-security.ts (pure Node, zero vscode)', () => {
            it('normalizes semver, prerelease numeric ordering, and release tag <-> plugin.json parity', () => {
                expect(parseSemver('v1.18.0-rc.10')?.normalized).toBe('1.18.0-rc.10');
                expect(compareSemver('1.18.0-rc.10', '1.18.0-rc.2')).toBeGreaterThan(0);
                expect(compareSemver('1.18.0', '1.18.0-rc.10')).toBeGreaterThan(0);
                expect(isNewerVersion('v1.18.0', '1.17.11')).toBe(true);
                expect(assertReleaseVersionMatches('1.18.0', 'v1.18.0')).toBe('1.18.0');
                expect(() => assertReleaseVersionMatches('1.17.11', 'v1.18.0')).toThrow(/version mismatch/i);
            });

            it('normalizes SHA256SUMS.txt digests and filenames case-insensitively', () => {
                const payload = Buffer.from('release-artifact-payload', 'utf8');
                const lowerHex = computeSha256Hex(payload);
                const upperHex = lowerHex.toUpperCase();
                const sums = parseSha256Sums([
                    '# uppercase hex + mixed-case asset filename',
                    `${upperHex}  *./Dist/Antigravity-Context-Monitor-App-1.18.0.ZIP`,
                ].join('\n'));

                expect(lookupSha256Sum(sums, 'antigravity-context-monitor-app-1.18.0.zip')).toBe(lowerHex);
                expect(lookupSha256Sum(sums, 'DIST/ANTIGRAVITY-CONTEXT-MONITOR-APP-1.18.0.ZIP')).toBe(lowerHex);
                expect(verifyBufferSha256(payload, upperHex)).toBe(true);
                expect(verifyBufferSha256(payload, lowerHex)).toBe(true);
            });

            it('enforces strict HTTPS port-443 GitHub allowlist and rejects unsafe ZIP entries', () => {
                for (const host of ALLOWED_RELEASE_HOSTS) {
                    expect(validateReleaseUrl(`https://${host}/a/b`).hostname).toBe(host);
                }
                expect(() => validateReleaseUrl('http://github.com/a/b')).toThrow(/non-HTTPS/i);
                expect(() => validateReleaseUrl('https://github.com:8443/a/b')).toThrow(/port/i);
                expect(() => validateReleaseUrl('https://tok@github.com/a/b')).toThrow(/credentials/i);
                expect(() => validateReleaseUrl('https://evil.example/a.zip')).toThrow(/non-allowlisted/i);

                expect(() => assertSafeArchiveEntryPath('../escape.txt', tempRoot)).toThrow(/traversal/i);
                expect(() => assertSafeArchiveEntryPath('C:\\Windows\\evil.dll', tempRoot)).toThrow(/absolute/i);
                expect(() => assertSafeArchiveEntryPath('good/\0bad.txt', tempRoot)).toThrow(/NUL/i);

                // Symlink rejected even when ZIP hostOs is spoofed as DOS (0)
                const spoofedSymlinkZip = buildZip([{
                    name: 'antigravity-context-monitor/link',
                    data: '/etc/passwd',
                    method: 0,
                    unixMode: 0o120777,
                    hostOs: 0,
                }]);
                expect(() => extractZipSafe(spoofedSymlinkZip, path.join(tempRoot, 'sym-out'))).toThrow(/symlink/i);

                // Bundle manifest version mismatch rejected
                const rootDir = path.join(tempRoot, 'bundle-mismatch');
                seedInstalledPlugin(rootDir, '1.17.11');
                expect(() => validateExtractedPluginBundle(rootDir, { expectedVersion: '1.18.0' }))
                    .toThrow(/version mismatch/i);
                expect(validateExtractedPluginBundle(rootDir, { expectedVersion: 'v1.17.11' }).version).toBe('1.17.11');
            });
        });

        // ─── Core External URL Allowlist (src/core/external-url.ts) ──────────────

        describe('src/core/external-url.ts (SEC-04)', () => {
            it('preserves all existing hosts and adds ai.google.dev & aistudio.google.com', () => {
                for (const host of [
                    'github.com',
                    'docs.github.com',
                    'raw.githubusercontent.com',
                    'open-vsx.org',
                    'marketplace.visualstudio.com',
                    'antigravity.google',
                    'ai.google.dev',
                    'aistudio.google.com',
                ]) {
                    expect(ALLOWED_EXTERNAL_URL_HOSTS.has(host)).toBe(true);
                    expect(validateExternalUrl(`https://${host}/docs/pricing`)).toBe(`https://${host}/docs/pricing`);
                }

                expect(validateExternalUrl('https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon'))
                    .toBe('https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon');
                expect(validateExternalUrl('https://aistudio.google.com/docs/whats-new-gemini-4-neon'))
                    .toBe('https://aistudio.google.com/docs/whats-new-gemini-4-neon');

                // Reject insecure / disallowed / injection URLs
                for (const bad of [
                    null,
                    undefined,
                    '',
                    'http://ai.google.dev/pricing',
                    'https://ai.google.dev:8443/pricing',
                    'https://user:pass@aistudio.google.com/docs',
                    'https://evil.example.com/phish',
                    'https://ai.google.dev.evil.com/pricing',
                    'javascript:alert(1)',
                    'file:///etc/passwd',
                    'https://github.com/a/b"onclick="evil()',
                ]) {
                    expect(validateExternalUrl(bad)).toBeNull();
                }
            });
        });

        // ─── SEC-03: plugin-updater.ts (fail-closed, tag parity, proxy, Atom, Windows swap) ─

        describe('SEC-03: src/app/plugin-updater.ts hardening', () => {
            function makeReleaseInfo(version: string, checksumsUrl: string | null): PluginReleaseInfo {
                return {
                    version,
                    tagName: `v${version}`,
                    releaseUrl: `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v${version}`,
                    releaseNotesSummary: 'Release notes',
                    assetName: `antigravity-context-monitor-app-${version}.zip`,
                    assetUrl: `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v${version}/antigravity-context-monitor-app-${version}.zip`,
                    checksumsUrl,
                };
            }

            it('fails closed in App self-update when SHA256SUMS.txt is absent (never skips checksum)', async () => {
                const targetDir = path.join(tempRoot, 'fail-closed-missing-sum', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir, '1.17.11');
                const transportSpy = vi.fn<HttpsRequestTransport>();

                const res = await applyAppPluginUpdate({
                    targetPluginDir: targetDir,
                    releaseInfo: makeReleaseInfo('1.18.0', null),
                    currentVersion: '1.17.11',
                    transport: transportSpy,
                });

                expect(res.ok).toBe(false);
                expect(res.error).toMatch(/SHA256SUMS\.txt is required/i);
                expect(transportSpy).not.toHaveBeenCalled();
                expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version).toBe('1.17.11');
            });

            it('accepts uppercase SHA256SUMS.txt hex & mixed-case filename, and rejects plugin.json version mismatch against release tag', async () => {
                const targetDir = path.join(tempRoot, 'tag-parity', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir, '1.17.11');

                // Case A: ZIP claims v1.17.11 inside plugin.json while release tag expects v1.18.0
                const mismatchedZip = makePluginBundleZip('1.17.11');
                const mismatchSha = computeSha256Hex(mismatchedZip).toUpperCase();
                const rel = makeReleaseInfo(
                    '1.18.0',
                    'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.18.0/SHA256SUMS.txt',
                );
                const mismatchRes = await applyAppPluginUpdate({
                    targetPluginDir: targetDir,
                    releaseInfo: rel,
                    currentVersion: '1.17.11',
                    transport: async (url) => {
                        if (url.pathname.endsWith('SHA256SUMS.txt')) {
                            return { statusCode: 200, headers: {}, body: Buffer.from(`${mismatchSha}  ANTIGRAVITY-CONTEXT-MONITOR-APP-1.18.0.ZIP\n`) };
                        }
                        return { statusCode: 200, headers: {}, body: mismatchedZip };
                    },
                });
                expect(mismatchRes.ok).toBe(false);
                expect(mismatchRes.error).toMatch(/version mismatch/i);
                expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version).toBe('1.17.11');

                // Case B: Matching v1.18.0 with uppercase SHA256SUMS succeeds cleanly
                const validZip = makePluginBundleZip('1.18.0');
                const validSha = computeSha256Hex(validZip).toUpperCase();
                const okRes = await applyAppPluginUpdate({
                    targetPluginDir: targetDir,
                    releaseInfo: rel,
                    currentVersion: '1.17.11',
                    transport: async (url) => {
                        if (url.pathname.endsWith('SHA256SUMS.txt')) {
                            return { statusCode: 200, headers: {}, body: Buffer.from(`${validSha}  ./Antigravity-Context-Monitor-App-1.18.0.ZIP\n`) };
                        }
                        return { statusCode: 200, headers: {}, body: validZip };
                    },
                });
                expect(okRes.ok).toBe(true);
                expect(okRes.checksumVerified).toBe(true);
                expect(okRes.installedVersion).toBe('1.18.0');
            });

            it('rolls back cleanly without half-overwritten files when Windows file swap hits mid-flight EBUSY lock', async () => {
                const targetDir = path.join(tempRoot, 'win-midswap-lock', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir, '1.17.11');
                fs.writeFileSync(path.join(targetDir, 'obsolete.txt'), 'keep-on-rollback', 'utf8');

                const newZip = makePluginBundleZip('1.18.0', [
                    { name: `${EXPECTED_PLUGIN_NAME}/extra-new.txt`, data: 'brand-new-file' },
                ]);
                const sha = computeSha256Hex(newZip);
                const rel = makeReleaseInfo(
                    '1.18.0',
                    'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.18.0/SHA256SUMS.txt',
                );

                // Allow plugin.json swap to succeed, then persistently lock main.mjs mid-swap!
                const res = await applyAppPluginUpdate({
                    targetPluginDir: targetDir,
                    releaseInfo: rel,
                    currentVersion: '1.17.11',
                    transport: async (url) => {
                        if (url.pathname.endsWith('SHA256SUMS.txt')) {
                            return { statusCode: 200, headers: {}, body: Buffer.from(`${sha}  ${rel.assetName}\n`) };
                        }
                        return { statusCode: 200, headers: {}, body: newZip };
                    },
                    // Force Windows directory-handle lock fallback
                    renameDir: async () => {
                        throw Object.assign(new Error('dir locked'), { code: 'EBUSY' });
                    },
                    // Persistently lock main.mjs mid-swap after plugin.json already swapped!
                    renameFile: async (src, dest) => {
                        if (dest.endsWith('main.mjs')) {
                            throw Object.assign(new Error('locked file mid-swap'), { code: 'EPERM' });
                        }
                        await fs.promises.rename(src, dest);
                    },
                });

                expect(res.ok).toBe(false);
                expect(res.rolledBack).toBe(true);
                expect(res.installedVersion).toBe('1.17.11');
                // Original files intact, newly introduced file removed, zero leftover .acm-stage-* files!
                expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version).toBe('1.17.11');
                expect(fs.readFileSync(path.join(targetDir, 'obsolete.txt'), 'utf8')).toBe('keep-on-rollback');
                expect(fs.existsSync(path.join(targetDir, 'extra-new.txt'))).toBe(false);
                const topEntries = fs.readdirSync(targetDir);
                expect(topEntries.some((f) => f.includes('.acm-stage-'))).toBe(false);
                expect(fs.readdirSync(path.dirname(targetDir))).toEqual([EXPECTED_PLUGIN_NAME]);
            });

            it('falls back to strict HTTPS github.com releases.atom (check-only, no installable releaseInfo) on GitHub API rate limit', async () => {
                const sampleAtom = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>tag:github.com,2008:Repository/12345/v1.19.0-beta.1</id>
        <updated>2026-11-28T00:00:00Z</updated>
        <link rel="alternate" type="text/html" href="https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.19.0-beta.1"/>
        <title>v1.19.0-beta.1</title>
      </entry>
      <entry>
        <id>tag:github.com,2008:Repository/12345/v1.18.0</id>
        <updated>2026-11-27T00:00:00Z</updated>
        <link rel="alternate" type="text/html" href="https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.18.0"/>
        <title>v1.18.0</title>
      </entry>
    </feed>`;

                const parsed = parseReleasesAtomLatest(sampleAtom);
                expect(parsed?.version).toBe('1.18.0');
                expect(parsed?.tagName).toBe('v1.18.0');

                expect(isGitHubRateLimitResponse({
                    statusCode: 403,
                    headers: { 'x-ratelimit-remaining': '0' },
                    body: Buffer.from('API rate limit exceeded'),
                })).toBe(true);
                expect(isGitHubRateLimitResponse({
                    statusCode: 429,
                    headers: {},
                    body: Buffer.alloc(0),
                })).toBe(true);

                const seenUrls: string[] = [];
                const res = await checkForUpdates({
                    currentVersion: '1.17.11',
                    force: true,
                    transport: async (url) => {
                        seenUrls.push(url.toString());
                        if (url.hostname === 'api.github.com') {
                            return {
                                statusCode: 403,
                                headers: { 'x-ratelimit-remaining': '0' },
                                body: Buffer.from('{"message":"API rate limit exceeded"}'),
                            };
                        }
                        return {
                            statusCode: 200,
                            headers: {},
                            body: Buffer.from(sampleAtom, 'utf8'),
                        };
                    },
                });

                expect(seenUrls).toContain(GITHUB_RELEASES_ATOM_URL);
                expect(res.status).toBe('update_available');
                expect(res.hasUpdate).toBe(true);
                expect(res.latestVersion).toBe('1.18.0');
                // Check-only: releaseInfo MUST NOT be fabricated without verified SHA256SUMS.txt
                expect(res.releaseInfo).toBeUndefined();

                // Non-github.com Atom URL MUST be rejected (strict github.com HTTPS 443 only)
                const blockedAtomRes = await checkForUpdates({
                    currentVersion: '1.17.11',
                    force: true,
                    releasesAtomUrl: 'https://objects.githubusercontent.com/releases.atom',
                    transport: async () => ({
                        statusCode: 429,
                        headers: {},
                        body: Buffer.from('rate limit'),
                    }),
                });
                expect(blockedAtomRes.status).toBe('error');
            });
        });

        // ─── SEC-04 & PERF-01: Cross-Platform CDP Launcher & Installers ──────────

        describe('SEC-04 & PERF-01: Cross-platform CDP launcher & installer hardening', () => {

            it('enforces fail-closed SHA256SUMS.txt default, --allow-missing-checksum opt-in, and tag parity in install-app-plugin.mjs + Linux paths in install-app-plugin.sh', async () => {
                const installer = await import(INSTALLER_PATH);
                const packager = await import(PACKAGER_PATH);

                // CLI default is fail-closed requireChecksum === true; --allow-missing-checksum explicitly disables it
                expect(installer.parseInstallerArgs([]).requireChecksum).toBe(true);
                expect(installer.parseInstallerArgs(['--from-github']).requireChecksum).toBe(true);
                expect(installer.parseInstallerArgs(['--from-github', '--allow-missing-checksum']).requireChecksum).toBe(false);

                const zip180 = packager.buildZipBuffer([
                    {
                        name: 'antigravity-context-monitor/plugin.json',
                        data: Buffer.from(JSON.stringify({ name: 'antigravity-context-monitor', version: '1.18.0' }), 'utf8'),
                        mode: 0o100644,
                    },
                    {
                        name: 'antigravity-context-monitor/sidecars/context_monitor/sidecar.json',
                        data: Buffer.from(JSON.stringify({ command: 'node', args: ['main.mjs'], has_web_ui: true }), 'utf8'),
                        mode: 0o100644,
                    },
                    {
                        name: 'antigravity-context-monitor/sidecars/context_monitor/main.mjs',
                        data: Buffer.from('console.log("ok");\n', 'utf8'),
                        mode: 0o100755,
                    },
                    {
                        name: 'antigravity-context-monitor/sidecars/context_monitor/runtime/out/app/sidecar-bundle.js',
                        data: Buffer.from('module.exports = {};\n', 'utf8'),
                        mode: 0o100644,
                    },
                    {
                        name: 'antigravity-context-monitor/sidecars/context_monitor/runtime/out/app/sidecar-server.js',
                        data: Buffer.from('module.exports = {};\n', 'utf8'),
                        mode: 0o100644,
                    },
                    {
                        name: 'antigravity-context-monitor/sidecars/context_monitor/runtime/out/app/sidecar-runtime.js',
                        data: Buffer.from('module.exports = {};\n', 'utf8'),
                        mode: 0o100644,
                    },
                ]);
                const zipName = 'antigravity-context-monitor-app-1.18.0.zip';
                const releaseNoSum = {
                    tag_name: 'v1.18.0',
                    html_url: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.18.0',
                    assets: [
                        {
                            name: zipName,
                            size: zip180.length,
                            browser_download_url: `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.18.0/${zipName}`,
                        },
                    ],
                };
                const noSumRequestFn = async (urlObj: URL) => {
                    if (urlObj.hostname === 'api.github.com') {
                        return { statusCode: 200, headers: {}, buffer: Buffer.from(JSON.stringify(releaseNoSum)) };
                    }
                    return { statusCode: 200, headers: {}, buffer: zip180 };
                };

                const targetFailClosed = path.join(tempRoot, 'inst-fail-closed');
                await expect(installer.installFromGitHub({
                    target: targetFailClosed,
                    requestFn: noSumRequestFn,
                })).rejects.toThrow(/SHA256SUMS\.txt.*fail-closed/i);
                expect(fs.existsSync(targetFailClosed)).toBe(false);

                // Explicit opt-out (--allow-missing-checksum -> requireChecksum: false) succeeds
                const allowedRes = await installer.installFromGitHub({
                    target: targetFailClosed,
                    requireChecksum: false,
                    requestFn: noSumRequestFn,
                });
                expect(allowedRes.version).toBe('1.18.0');
                expect(allowedRes.checksumVerified).toBe(false);
                expect(allowedRes.checksumStatus).toBe('skipped-by-flag');

                // Extracted plugin.json version mismatch against release tag MUST fail closed
                const zipWrongVer = packager.buildZipBuffer([
                    {
                        name: 'antigravity-context-monitor/plugin.json',
                        data: Buffer.from(JSON.stringify({ name: 'antigravity-context-monitor', version: '1.17.11' }), 'utf8'),
                        mode: 0o100644,
                    },
                    {
                        name: 'antigravity-context-monitor/sidecars/context_monitor/sidecar.json',
                        data: Buffer.from(JSON.stringify({ command: 'node', args: ['main.mjs'], has_web_ui: true }), 'utf8'),
                        mode: 0o100644,
                    },
                    {
                        name: 'antigravity-context-monitor/sidecars/context_monitor/main.mjs',
                        data: Buffer.from('console.log("ok");\n', 'utf8'),
                        mode: 0o100755,
                    },
                    {
                        name: 'antigravity-context-monitor/sidecars/context_monitor/runtime/out/app/sidecar-bundle.js',
                        data: Buffer.from('module.exports = {};\n', 'utf8'),
                        mode: 0o100644,
                    },
                    {
                        name: 'antigravity-context-monitor/sidecars/context_monitor/runtime/out/app/sidecar-server.js',
                        data: Buffer.from('module.exports = {};\n', 'utf8'),
                        mode: 0o100644,
                    },
                    {
                        name: 'antigravity-context-monitor/sidecars/context_monitor/runtime/out/app/sidecar-runtime.js',
                        data: Buffer.from('module.exports = {};\n', 'utf8'),
                        mode: 0o100644,
                    },
                ]);
                const wrongShaUpper = installer.computeSha256Hex(zipWrongVer).toUpperCase();
                const releaseWithSum = {
                    ...releaseNoSum,
                    assets: [
                        ...releaseNoSum.assets,
                        {
                            name: 'SHA256SUMS.txt',
                            browser_download_url: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.18.0/SHA256SUMS.txt',
                        },
                    ],
                };
                await expect(installer.installFromGitHub({
                    target: path.join(tempRoot, 'inst-ver-mismatch'),
                    requestFn: async (urlObj: URL) => {
                        if (urlObj.hostname === 'api.github.com') {
                            return { statusCode: 200, headers: {}, buffer: Buffer.from(JSON.stringify(releaseWithSum)) };
                        }
                        if (urlObj.pathname.endsWith('SHA256SUMS.txt')) {
                            return { statusCode: 200, headers: {}, buffer: Buffer.from(`${wrongShaUpper}  ANTIGRAVITY-CONTEXT-MONITOR-APP-1.18.0.ZIP\n`) };
                        }
                        return { statusCode: 200, headers: {}, buffer: zipWrongVer };
                    },
                })).rejects.toThrow(/version mismatch/i);

                // install-app-plugin.sh includes Linux bundled Node & Electron runtime paths
                const shText = fs.readFileSync(INSTALLER_SH_PATH, 'utf8');
                expect(shText).toContain('/usr/share/antigravity/resources/bin/agy-node');
                expect(shText).toContain('/snap/antigravity/current/resources/bin/agy-node');
                expect(shText).toContain('/usr/lib/antigravity/antigravity');
                expect(shText).toContain('/opt/Antigravity/antigravity');
                expect(shText).toContain('/snap/antigravity/current/usr/share/antigravity/antigravity');
                if (process.platform !== 'win32') {
                    execFileSync('bash', ['-n', INSTALLER_SH_PATH], { stdio: 'pipe' });
                }
            });
        });

        // ─── SEC-04: Privacy Mask & Bare External Links ──────────────────────────

        describe('SEC-04: Profile privacy mask & zero bare external links across Profile, About, and Pricing panels', () => {
            const sampleUser: UserStatusInfo = {
                name: 'Secret Alice',
                email: 'secret.alice@example.com',
                planName: 'Pro',
                userTierName: 'Ultra',
                modelSortOrder: [],
                availableCredits: [],
                monthlyPromptCredits: 0,
                availablePromptCredits: 0,
                monthlyFlowCredits: 0,
                availableFlowCredits: 0,
                promptCreditsPercent: null,
                flowCreditsPercent: null,
            } as unknown as UserStatusInfo;

            it('never emits plaintext name or email into data-real attributes when privacy mask is enabled (default)', () => {
                const maskedHtml = buildProfileContent(sampleUser, [], 15);
                expect(maskedHtml).not.toContain('data-real=');
                expect(maskedHtml).not.toContain('Secret Alice');
                expect(maskedHtml).toContain('S***');
                expect(maskedHtml).toContain('se****@example.com');
                expect(maskedHtml).toContain('id="privacyToggle" aria-pressed="true"');

                const explicitlyMasked = buildProfileContent(sampleUser, [], 15, null, { privacyMasked: true });
                expect(explicitlyMasked).not.toContain('data-real=');
                expect(explicitlyMasked).not.toContain('Secret Alice');

                const unmaskedHtml = buildProfileContent(sampleUser, [], 15, null, { privacyMasked: false });
                expect(unmaskedHtml).toContain('Secret Alice');
                expect(unmaskedHtml).toContain('id="privacyToggle" aria-pressed="false"');
            });

            it('routes EVERY external https:// anchor across Profile, About, and Pricing panels through data-action="openExternalUrl" and allowlisted hosts', () => {
                const profileHtml = buildProfileContent(sampleUser, [], 15);
                const aboutHtml = buildAboutTabContent('1.18.0', { surface: 'ide' });
                const pricingHtml = buildPricingTabContent(null, new PricingStore(), undefined, undefined, undefined, true);

                const checkAllLinks = (label: string, html: string, expectedMinLinks: number) => {
                    const anchorMatches = [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
                    const externalAnchors = anchorMatches.filter((tag) => /href="https:\/\//i.test(tag));
                    expect(externalAnchors.length, `${label} should contain expected external links`).toBeGreaterThanOrEqual(expectedMinLinks);
                    for (const tag of externalAnchors) {
                        expect(tag, `${label} anchor missing data-action="openExternalUrl": ${tag}`).toContain('data-action="openExternalUrl"');
                        const hrefMatch = tag.match(/href="(https:\/\/[^"]+)"/i);
                        expect(hrefMatch, `${label} anchor missing href: ${tag}`).not.toBeNull();
                        const url = hrefMatch![1];
                        expect(validateExternalUrl(url), `${label} URL rejected by external URL allowlist: ${url}`).toBe(url);
                    }
                };

                checkAllLinks('Profile tab', profileHtml, 1);
                checkAllLinks('About tab', aboutHtml, 10);
                checkAllLinks('Pricing tab', pricingHtml, 5);
            });
        });
    });
});

describe('[w1a-release-identity-and-rollback]', () => {
    const REPO_ROOT = path.resolve(__dirname, '..');

    const INSTALLER_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.mjs');

    const INSTALLER_SH_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.sh');

    const INSTALLER_PS1_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.ps1');
    const makePluginZip = makeTestPluginZip;
    const seedInstalledPlugin = seedTestInstalledPlugin;
    const makeApprovedReleaseInfo = makeSharedApprovedReleaseInfo;

    describe('Phase 1 Wave 1A Hardening: Release Identity & Rollback Honesty', () => {
        let tempRoot: string;

        beforeEach(() => {
            clearWindowsLauncherCaches();
            tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-w1a-sec-hard-'));
        });

        afterEach(() => {
            clearWindowsLauncherCaches();
            vi.restoreAllMocks();
            fs.rmSync(tempRoot, { recursive: true, force: true });
        });

        // ─── 2. Release Identity, Conflicting Checksums, Re-Resolve & Locking ────

        describe('W1A-FIX-6: Release identity binding, conflicting SHA256SUMS rejection, pre-Apply re-resolve & update lock', () => {
            it('rejects conflicting checksum filenames case-insensitively in both core and installer', async () => {
                const installer = await import(INSTALLER_PATH);
                const h1 = 'a'.repeat(64);
                const h2 = 'b'.repeat(64);

                // Different digests for case-colliding filenames
                const caseConflict = `${h1}  Antigravity-Context-Monitor-App-1.18.0.zip\n${h2}  antigravity-context-monitor-app-1.18.0.zip\n`;
                expect(() => parseSha256Sums(caseConflict)).toThrow(/Conflicting SHA256SUMS/i);
                expect(() => installer.parseSha256Sums(caseConflict)).toThrow(/Conflicting SHA256SUMS/i);

                // Different paths colliding on the same basename
                const baseConflict = `${h1}  dist/antigravity-context-monitor-app-1.18.0.zip\n${h2}  evil/ANTIGRAVITY-CONTEXT-MONITOR-APP-1.18.0.ZIP\n`;
                expect(() => parseSha256Sums(baseConflict)).toThrow(/Conflicting SHA256SUMS/i);
                expect(() => installer.parseSha256Sums(baseConflict)).toThrow(/Conflicting SHA256SUMS/i);

                // Same digest but conflicting filename casing also rejected
                const sameDigestCaseConflict = `${h1}  Foo.zip\n${h1}  foo.zip\n`;
                expect(() => parseSha256Sums(sameDigestCaseConflict)).toThrow(/Conflicting SHA256SUMS/i);
                expect(() => installer.parseSha256Sums(sameDigestCaseConflict)).toThrow(/Conflicting SHA256SUMS/i);

                // Path traversal inside SHA256SUMS rejected
                const traversalSum = `${h1}  ../evil.zip\n`;
                expect(() => parseSha256Sums(traversalSum)).toThrow(/Unsafe filename/i);
                expect(() => installer.parseSha256Sums(traversalSum)).toThrow(/Unsafe filename/i);
            });

            it('strictly binds release URLs to approved repo + exact tag + exact asset set and rejects foreign/spoofed metadata', async () => {
                // Foreign repository on github.com MUST be rejected even though github.com is allowlisted
                expect(() => validateApprovedReleaseAssetUrl(
                    'https://github.com/attacker/evil-fork/releases/download/v1.18.0/antigravity-context-monitor-app-1.18.0.zip',
                    { tagName: 'v1.18.0', assetName: 'antigravity-context-monitor-app-1.18.0.zip' },
                )).toThrow(/not bound to approved repository/i);

                // Direct objects.githubusercontent.com initial asset URL (unverified) MUST be rejected
                expect(() => validateApprovedReleaseAssetUrl(
                    'https://objects.githubusercontent.com/github-production-release-asset/12345',
                    { tagName: 'v1.18.0', assetName: 'antigravity-context-monitor-app-1.18.0.zip' },
                )).toThrow(/expected github\.com/i);

                // Mismatched tag or asset name rejected
                expect(() => validateReleaseIdentity({
                    ...makeApprovedReleaseInfo('1.18.0'),
                    assetName: 'antigravity-context-monitor-app-1.17.11.zip',
                })).toThrow(/does not match expected asset/i);

                expect(() => validateReleaseIdentity({
                    ...makeApprovedReleaseInfo('1.18.0'),
                    assetUrl: `https://github.com/${APPROVED_GITHUB_REPO_SLUG}/releases/download/v1.17.11/antigravity-context-monitor-app-1.18.0.zip`,
                })).toThrow(/does not match expected tag/i);

                // Foreign repo Atom entry ignored by parseReleasesAtomLatest
                const foreignAtom = `<?xml version="1.0"?><feed><entry>
                    <link href="https://github.com/evil/fork/releases/tag/v9.9.9"/>
                    <title>v9.9.9</title>
                </entry></feed>`;
                expect(parseReleasesAtomLatest(foreignAtom)).toBeNull();

                // checkForUpdates rejects release JSON pointing assets at a foreign repo
                const foreignRes = await checkForUpdates({
                    currentVersion: '1.17.11',
                    force: true,
                    transport: async () => ({
                        statusCode: 200,
                        headers: {},
                        body: Buffer.from(JSON.stringify({
                            tag_name: 'v1.18.0',
                            html_url: `https://github.com/${APPROVED_GITHUB_REPO_SLUG}/releases/tag/v1.18.0`,
                            assets: [
                                {
                                    name: 'antigravity-context-monitor-app-1.18.0.zip',
                                    browser_download_url: 'https://github.com/evil/fork/releases/download/v1.18.0/antigravity-context-monitor-app-1.18.0.zip',
                                },
                                {
                                    name: 'SHA256SUMS.txt',
                                    browser_download_url: 'https://github.com/evil/fork/releases/download/v1.18.0/SHA256SUMS.txt',
                                },
                            ],
                        })),
                    }),
                });
                expect(foreignRes.status).toBe('error');
                expect(foreignRes.error).toMatch(/approved repository/i);
            });

            it('re-resolves exact approved release assets before Apply instead of trusting stale or Atom-omitted cached metadata', async () => {
                const targetDir = path.join(tempRoot, 'reresolve', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir, '1.17.11');
                const zip180 = makePluginZip('1.18.0');
                const sha180 = computeSha256Hex(zip180);
                const assetName = `${EXPECTED_PLUGIN_NAME}-app-1.18.0.zip`;

                const requestedUrls: string[] = [];
                const transport: HttpsRequestTransport = async (url) => {
                    requestedUrls.push(url.toString());
                    if (url.hostname === 'api.github.com') {
                        return {
                            statusCode: 200,
                            headers: {},
                            body: Buffer.from(JSON.stringify({
                                tag_name: 'v1.18.0',
                                html_url: `https://github.com/${APPROVED_GITHUB_REPO_SLUG}/releases/tag/v1.18.0`,
                                assets: [
                                    {
                                        name: assetName,
                                        browser_download_url: `https://github.com/${APPROVED_GITHUB_REPO_SLUG}/releases/download/v1.18.0/${assetName}`,
                                    },
                                    {
                                        name: 'SHA256SUMS.txt',
                                        browser_download_url: `https://github.com/${APPROVED_GITHUB_REPO_SLUG}/releases/download/v1.18.0/SHA256SUMS.txt`,
                                    },
                                ],
                            })),
                        };
                    }
                    if (url.pathname.endsWith('SHA256SUMS.txt')) {
                        return { statusCode: 200, headers: {}, body: Buffer.from(`${sha180}  ${assetName}\n`) };
                    }
                    return { statusCode: 200, headers: {}, body: zip180 };
                };

                // Pass stale/poisoned cached metadata pointing to a foreign repo & null checksumsUrl!
                const staleCached: PluginReleaseInfo = {
                    version: '1.18.0',
                    tagName: 'v1.18.0',
                    releaseUrl: 'https://github.com/evil/poisoned/releases/tag/v1.18.0',
                    releaseNotesSummary: 'stale',
                    assetName: 'wrong-asset.zip',
                    assetUrl: 'https://github.com/evil/poisoned/releases/download/v1.18.0/wrong-asset.zip',
                    checksumsUrl: null,
                };

                const res = await applyAppPluginUpdate({
                    targetPluginDir: targetDir,
                    releaseInfo: staleCached,
                    reResolveRelease: true,
                    currentVersion: '1.17.11',
                    transport,
                });

                expect(res.ok).toBe(true);
                expect(res.installedVersion).toBe('1.18.0');
                expect(res.checksumVerified).toBe(true);
                // Must have queried the approved repo tag API and NEVER touched evil/poisoned URLs!
                expect(requestedUrls[0]).toBe(`https://api.github.com/repos/${APPROVED_GITHUB_REPO_SLUG}/releases/tags/v1.18.0`);
                expect(requestedUrls.some((u) => u.includes('poisoned'))).toBe(false);

                // resolveApprovedRelease fails closed if official API release omits SHA256SUMS.txt
                await expect(resolveApprovedRelease({
                    currentVersion: '1.17.11',
                    tagOrVersion: 'v1.18.0',
                    transport: async () => ({
                        statusCode: 200,
                        headers: {},
                        body: Buffer.from(JSON.stringify({
                            tag_name: 'v1.18.0',
                            assets: [{
                                name: assetName,
                                browser_download_url: `https://github.com/${APPROVED_GITHUB_REPO_SLUG}/releases/download/v1.18.0/${assetName}`,
                            }],
                        })),
                    }),
                })).rejects.toThrow(/SHA256SUMS\.txt is required/i);
            });
        });

        // ─── 3. Honest Windows Rollback Failure Reporting ────────────────────────

        describe('W1A-FIX-6: Honest post-failure on-disk state when Windows rollback fails', () => {
            it('never claims previous version is cleanly installed when Windows transactional rollback hits locked destination (EBUSY/EPERM)', async () => {
                const targetDir = path.join(tempRoot, 'win-rollback-fail', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir, '1.17.11');

                const zip180 = makePluginZip('1.18.0');
                const sha180 = computeSha256Hex(zip180);
                const rel180 = makeApprovedReleaseInfo('1.18.0');

                const res = await applyAppPluginUpdate({
                    targetPluginDir: targetDir,
                    releaseInfo: rel180,
                    currentVersion: '1.17.11',
                    transport: async (url) => {
                        if (url.pathname.endsWith('SHA256SUMS.txt')) {
                            return { statusCode: 200, headers: {}, body: Buffer.from(`${sha180}  ${rel180.assetName}\n`) };
                        }
                        return { statusCode: 200, headers: {}, body: zip180 };
                    },
                    renameDir: async () => {
                        throw Object.assign(new Error('dir handle locked'), { code: 'EBUSY' });
                    },
                    // Allow plugin.json (v1.18.0) to swap in, then fail main.mjs with EPERM
                    renameFile: async (src, dest) => {
                        if (dest.endsWith('main.mjs')) {
                            throw Object.assign(new Error('main.mjs locked'), { code: 'EPERM' });
                        }
                        await fs.promises.rename(src, dest);
                    },
                    // During rollback, plugin.json destination is ALSO locked (EBUSY)!
                    rollbackRenameFile: async (_src, dest) => {
                        if (dest.endsWith('plugin.json')) {
                            throw Object.assign(new Error('plugin.json locked on rollback'), { code: 'EBUSY' });
                        }
                        await fs.promises.rename(_src, dest);
                    },
                });

                expect(res.ok).toBe(false);
                expect(res.rolledBack).toBe(false);
                // MUST NOT falsely claim previous version 1.17.11 is cleanly installed!
                expect(res.installedVersion).toBe('unknown');
                expect(res.installedVersion).not.toBe('1.17.11');
                expect(res.observedDiskState).toMatchObject({
                    targetExists: true,
                    manifestVersion: '1.18.0',
                    integrity: 'partial',
                    failedRollbackFiles: ['plugin.json'],
                });
                expect(res.observedDiskState?.backupPreservedAt).toBeTruthy();
                expect(fs.existsSync(res.observedDiskState!.backupPreservedAt!)).toBe(true);
                expect(res.message).toMatch(/rollback failed/i);
                expect(res.message).toContain('v1.18.0');
                expect(res.message).toContain(res.observedDiskState!.backupPreservedAt!);
            });

            it('reports missing target directory honestly when directory-move rollback fails', async () => {
                const targetDir = path.join(tempRoot, 'dir-rollback-fail', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir, '1.17.11');
                const zip180 = makePluginZip('1.18.0');
                const sha180 = computeSha256Hex(zip180);
                const rel180 = makeApprovedReleaseInfo('1.18.0');

                let dirCalls = 0;
                const res = await applyAppPluginUpdate({
                    targetPluginDir: targetDir,
                    releaseInfo: rel180,
                    currentVersion: '1.17.11',
                    transport: async (url) => {
                        if (url.pathname.endsWith('SHA256SUMS.txt')) {
                            return { statusCode: 200, headers: {}, body: Buffer.from(`${sha180}  ${rel180.assetName}\n`) };
                        }
                        return { statusCode: 200, headers: {}, body: zip180 };
                    },
                    renameDir: async (src, dest) => {
                        dirCalls++;
                        if (dirCalls === 1) {
                            await fs.promises.rename(src, dest);
                            return;
                        }
                        throw Object.assign(new Error('swap ENOSPC'), { code: 'ENOSPC' });
                    },
                    rollbackRenameDir: async () => {
                        throw Object.assign(new Error('restore EPERM'), { code: 'EPERM' });
                    },
                });

                expect(res.ok).toBe(false);
                expect(res.rolledBack).toBe(false);
                expect(res.installedVersion).toBe('unknown');
                expect(res.observedDiskState).toMatchObject({
                    targetExists: false,
                    manifestVersion: null,
                    integrity: 'missing',
                });
                expect(res.observedDiskState?.backupPreservedAt).toBeTruthy();
                expect(fs.existsSync(res.observedDiskState!.backupPreservedAt!)).toBe(true);
                expect(res.message).toMatch(/target directory missing/i);
            });

            it('Issue #79: survives Windows EBUSY rmdir locks on sidecars/context_monitor during transactional update, file/dir collision, and post-swap rollback', async () => {
                // Case 1: Transactional in-place swap when target dir & sidecars/context_monitor CWD throw EBUSY on rename & rmdir,
                // PLUS an obsolete nested subdir & obsolete file sitting at a path that becomes a directory!
                const targetDir = path.join(tempRoot, 'win-cwd-ebusy', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir, '1.17.11');
                fs.mkdirSync(path.join(targetDir, 'sidecars', 'context_monitor', 'legacy-empty'), { recursive: true });
                fs.writeFileSync(path.join(targetDir, 'sidecars', 'context_monitor', 'legacy-empty', 'old.js'), '// old', 'utf8');
                // File-vs-dir collision: `assets` is a file in v1.17.11, and becomes `assets/logo.svg` in v1.18.0
                fs.writeFileSync(path.join(targetDir, 'assets'), 'old-file-collision', 'utf8');
                // Stale leftover temp file from a prior crash
                fs.writeFileSync(path.join(targetDir, 'plugin.json.acm-stage-deadbeef'), 'stale-stage', 'utf8');

                const zip180 = makePluginZip('1.18.0', [
                    { name: `${EXPECTED_PLUGIN_NAME}/assets/logo.svg`, data: '<svg>v1.18</svg>' },
                ]);
                const sha180 = computeSha256Hex(zip180);
                const rel180 = makeApprovedReleaseInfo('1.18.0');
                const rmdirAttempts: string[] = [];

                const okRes = await applyAppPluginUpdate({
                    targetPluginDir: targetDir,
                    releaseInfo: rel180,
                    currentVersion: '1.17.11',
                    transport: async (url) => {
                        if (url.pathname.endsWith('SHA256SUMS.txt')) {
                            return { statusCode: 200, headers: {}, body: Buffer.from(`${sha180}  ${rel180.assetName}\n`) };
                        }
                        return { statusCode: 200, headers: {}, body: zip180 };
                    },
                    renameDir: async () => {
                        throw Object.assign(new Error('EBUSY: target dir locked by sidecar CWD'), { code: 'EBUSY' });
                    },
                    rmdirDir: async (dirPath) => {
                        rmdirAttempts.push(dirPath);
                        // Simulate Windows CWD lock on `sidecars/context_monitor` and any directory under `sidecars`
                        if (dirPath.includes('context_monitor')) {
                            throw Object.assign(new Error('EBUSY: resource busy or locked, rmdir'), { code: 'EBUSY' });
                        }
                        await fs.promises.rmdir(dirPath);
                    },
                });

                expect(okRes.ok).toBe(true);
                expect(okRes.installedVersion).toBe('1.18.0');
                expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version).toBe('1.18.0');
                expect(fs.readFileSync(path.join(targetDir, 'assets', 'logo.svg'), 'utf8')).toBe('<svg>v1.18</svg>');
                expect(fs.existsSync(path.join(targetDir, 'sidecars', 'context_monitor', 'legacy-empty', 'old.js'))).toBe(false);
                expect(fs.existsSync(path.join(targetDir, 'plugin.json.acm-stage-deadbeef'))).toBe(false);
                // Locked empty subdir inside context_monitor did NOT abort the update!
                expect(rmdirAttempts.some(p => p.includes('legacy-empty'))).toBe(true);

                // Case 2: Mid-swap rollback restores file-vs-dir collision AND tolerates EBUSY on rmdir!
                const targetDir2 = path.join(tempRoot, 'win-cwd-ebusy-rb', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir2, '1.17.11');
                fs.writeFileSync(path.join(targetDir2, 'assets'), 'restore-original-file', 'utf8');

                const rbRes = await applyAppPluginUpdate({
                    targetPluginDir: targetDir2,
                    releaseInfo: rel180,
                    currentVersion: '1.17.11',
                    transport: async (url) => {
                        if (url.pathname.endsWith('SHA256SUMS.txt')) {
                            return { statusCode: 200, headers: {}, body: Buffer.from(`${sha180}  ${rel180.assetName}\n`) };
                        }
                        return { statusCode: 200, headers: {}, body: zip180 };
                    },
                    renameDir: async () => {
                        throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
                    },
                    renameFile: async (src, dest) => {
                        if (dest.endsWith('main.mjs')) {
                            throw Object.assign(new Error('EBUSY mid-swap'), { code: 'EBUSY' });
                        }
                        await fs.promises.rename(src, dest);
                    },
                    rmdirDir: async (dirPath) => {
                        if (dirPath.includes('context_monitor')) {
                            throw Object.assign(new Error('EBUSY rmdir'), { code: 'EBUSY' });
                        }
                        await fs.promises.rmdir(dirPath);
                    },
                });

                expect(rbRes.ok).toBe(false);
                expect(rbRes.rolledBack).toBe(true);
                expect(rbRes.installedVersion).toBe('1.17.11');
                expect(fs.lstatSync(path.join(targetDir2, 'assets')).isFile()).toBe(true);
                expect(fs.readFileSync(path.join(targetDir2, 'assets'), 'utf8')).toBe('restore-original-file');

                // Case 3: Post-swap rollback when targetPluginDir becomes locked (rmPath throws EBUSY)
                // -> falls back to in-place transactional restore from backupDir and restores v1.17.11!
                const targetDir3 = path.join(tempRoot, 'win-postswap-ebusy-rb', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir3, '1.17.11');
                const badPostSwapZip = makePluginZip('1.18.0');
                const badPostSwapSha = computeSha256Hex(badPostSwapZip);
                let renameCount = 0;

                const postSwapRb = await applyAppPluginUpdate({
                    targetPluginDir: targetDir3,
                    releaseInfo: rel180,
                    currentVersion: '1.17.11',
                    transport: async (url) => {
                        if (url.pathname.endsWith('SHA256SUMS.txt')) {
                            return { statusCode: 200, headers: {}, body: Buffer.from(`${badPostSwapSha}  ${rel180.assetName}\n`) };
                        }
                        return { statusCode: 200, headers: {}, body: badPostSwapZip };
                    },
                    renameDir: async (src, dest) => {
                        renameCount++;
                        await fs.promises.rename(src, dest);
                        if (renameCount === 2) {
                            // Corrupt plugin.json right after swap so post-swap validateExtractedPluginBundle fails!
                            fs.writeFileSync(path.join(dest, 'plugin.json'), '{corrupt', 'utf8');
                        }
                    },
                    rmPath: async (p, opts) => {
                        if (path.resolve(p) === path.resolve(targetDir3)) {
                            throw Object.assign(new Error('EBUSY target locked during rollback rm'), { code: 'EBUSY' });
                        }
                        await fs.promises.rm(p, opts);
                    },
                });

                expect(postSwapRb.ok).toBe(false);
                expect(postSwapRb.rolledBack).toBe(true);
                expect(postSwapRb.installedVersion).toBe('1.17.11');
                expect(JSON.parse(fs.readFileSync(path.join(targetDir3, 'plugin.json'), 'utf8')).version).toBe('1.17.11');
            });

            it('P1-4: validates rollback against actual pre-update on-disk version and preserves backup when post-rollback validation fails', async () => {
                // Case 1: Running sidecar reports currentVersion 1.17.11, but disk already holds 1.17.12 (pending reload).
                // On swap failure, rollback MUST validate against 1.17.12 (not stale 1.17.11)!
                const targetDir = path.join(tempRoot, 'p1-4-disk-ver', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir, '1.17.12');
                const zip180 = makePluginZip('1.18.0');
                const sha180 = computeSha256Hex(zip180);
                const rel180 = makeApprovedReleaseInfo('1.18.0');

                const rbRes = await applyAppPluginUpdate({
                    targetPluginDir: targetDir,
                    releaseInfo: rel180,
                    currentVersion: '1.17.11',
                    transport: async (url) => {
                        if (url.pathname.endsWith('SHA256SUMS.txt')) {
                            return { statusCode: 200, headers: {}, body: Buffer.from(`${sha180}  ${rel180.assetName}\n`) };
                        }
                        return { statusCode: 200, headers: {}, body: zip180 };
                    },
                    renameDir: async () => {
                        throw Object.assign(new Error('EBUSY dir locked'), { code: 'EBUSY' });
                    },
                    renameFile: async (src, dest) => {
                        if (dest.endsWith('main.mjs')) {
                            throw Object.assign(new Error('EBUSY mid-swap'), { code: 'EBUSY' });
                        }
                        await fs.promises.rename(src, dest);
                    },
                });

                expect(rbRes.ok).toBe(false);
                expect(rbRes.rolledBack).toBe(true);
                expect(rbRes.installedVersion).toBe('1.17.12');
                expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version).toBe('1.17.12');

                // Case 2: Post-rollback verification fails (corrupt backup manifest restored) ->
                // MUST NOT claim rolledBack: true and MUST preserve backupDir on disk!
                const targetDir2 = path.join(tempRoot, 'p1-4-preserve-backup', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir2, '1.17.11');
                let renameCount = 0;
                const badRbRes = await applyAppPluginUpdate({
                    targetPluginDir: targetDir2,
                    releaseInfo: rel180,
                    currentVersion: '1.17.11',
                    transport: async (url) => {
                        if (url.pathname.endsWith('SHA256SUMS.txt')) {
                            return { statusCode: 200, headers: {}, body: Buffer.from(`${sha180}  ${rel180.assetName}\n`) };
                        }
                        return { statusCode: 200, headers: {}, body: zip180 };
                    },
                    renameDir: async (src, dest) => {
                        renameCount++;
                        await fs.promises.rename(src, dest);
                        if (renameCount === 1) {
                            // Corrupt backupDir's plugin.json before swap so restored backup fails validation
                            fs.writeFileSync(path.join(dest, 'plugin.json'), JSON.stringify({ name: EXPECTED_PLUGIN_NAME, version: '0.0.1-corrupt' }), 'utf8');
                        } else if (renameCount === 2) {
                            // Corrupt swapped target so update triggers rollback
                            fs.writeFileSync(path.join(dest, 'plugin.json'), '{bad', 'utf8');
                        }
                    },
                });

                expect(badRbRes.ok).toBe(false);
                expect(badRbRes.rolledBack).toBe(false);
                expect(badRbRes.installedVersion).toBe('unknown');
                expect(badRbRes.observedDiskState?.integrity).toBe('partial');

                // Case 3: Windows locked-dir (copiedExistingToBackup) where post-rollback verification fails ->
                // MUST NOT delete backupDir before verification succeeds!
                const targetDir3 = path.join(tempRoot, 'p1-4-win-preserve-backup', EXPECTED_PLUGIN_NAME);
                seedInstalledPlugin(targetDir3, '1.17.11');
                const badWinRbRes = await applyAppPluginUpdate({
                    targetPluginDir: targetDir3,
                    releaseInfo: rel180,
                    currentVersion: '1.17.11',
                    transport: async (url) => {
                        if (url.pathname.endsWith('SHA256SUMS.txt')) {
                            return { statusCode: 200, headers: {}, body: Buffer.from(`${sha180}  ${rel180.assetName}\n`) };
                        }
                        return { statusCode: 200, headers: {}, body: zip180 };
                    },
                    renameDir: async () => {
                        throw Object.assign(new Error('EBUSY dir locked'), { code: 'EBUSY' });
                    },
                    renameFile: async (src, dest) => {
                        if (dest.endsWith('main.mjs')) {
                            // Corrupt backupDir's plugin.json before triggering rollback so post-rollback verify fails
                            const parentEntries = fs.readdirSync(path.dirname(targetDir3));
                            const bkp = parentEntries.find(e => e.includes('.bak-'));
                            expect(bkp).toBeTruthy();
                            fs.writeFileSync(path.join(path.dirname(targetDir3), bkp!, 'plugin.json'), '{broken', 'utf8');
                            throw Object.assign(new Error('EBUSY mid-swap'), { code: 'EBUSY' });
                        }
                        await fs.promises.rename(src, dest);
                    },
                });
                expect(badWinRbRes.ok).toBe(false);
                expect(badWinRbRes.rolledBack).toBe(false);
                expect(badWinRbRes.installedVersion).toBe('unknown');
                expect(badWinRbRes.observedDiskState?.integrity).toBe('corrupt');
                expect(badWinRbRes.observedDiskState?.backupPreservedAt).toBeTruthy();
                expect(fs.existsSync(badWinRbRes.observedDiskState!.backupPreservedAt!)).toBe(true);
            });

            it('P1-5: serializes stale update lock reclamation via crash-recoverable guard, never unlinks fresh active lock, and exposes verifyOwned()', async () => {
                const targetDir = path.join(tempRoot, 'p1-5-lock', EXPECTED_PLUGIN_NAME);
                fs.mkdirSync(targetDir, { recursive: true });
                const lockPath = getPluginUpdateLockPath(targetDir);

                // 1. Seed a genuinely stale lock (dead PID + old timestamp) AND an abandoned .reclaim guard from a dead PID
                fs.writeFileSync(lockPath, JSON.stringify({
                    pid: 99999999,
                    nonce: 'dead-lock-token',
                    acquiredAt: Date.now() - 60 * 60 * 1000,
                }), 'utf8');
                fs.writeFileSync(`${lockPath}.reclaim`, JSON.stringify({
                    pid: 99999999,
                    nonce: 'dead-reclaim-guard',
                    acquiredAt: Date.now() - 60 * 60 * 1000,
                }), 'utf8');

                const handle = await acquirePluginUpdateLock(targetDir, { staleMs: 1000, timeoutMs: 200 });
                expect(handle.verifyOwned?.()).toBe(true);
                expect(fs.existsSync(`${lockPath}.reclaim`)).toBe(false);

                // 2. Concurrent caller MUST NOT reclaim an active owned lock
                await expect(acquirePluginUpdateLock(targetDir, { staleMs: 1000, timeoutMs: 30, pollIntervalMs: 10 }))
                    .rejects.toThrow(/already in progress/i);
                expect(handle.verifyOwned?.()).toBe(true);

                // 3. If lock file is externally replaced, verifyOwned() returns false and release() does NOT delete the new owner's lock
                const newOwnerPayload = JSON.stringify({
                    pid: process.pid,
                    nonce: 'external-owner-token',
                    acquiredAt: Date.now(),
                });
                fs.writeFileSync(lockPath, newOwnerPayload, 'utf8');
                expect(handle.verifyOwned?.()).toBe(false);
                handle.release();
                expect(fs.existsSync(lockPath)).toBe(true);
                expect(fs.readFileSync(lockPath, 'utf8')).toBe(newOwnerPayload);
                fs.rmSync(lockPath, { force: true });
            });
        });
    });
});

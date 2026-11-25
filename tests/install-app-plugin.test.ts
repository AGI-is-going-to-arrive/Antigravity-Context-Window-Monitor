import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const INSTALLER_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.mjs');
const PACKAGER_PATH = path.join(REPO_ROOT, 'scripts', 'package-app-plugin.mjs');

async function loadInstaller() {
    return import(INSTALLER_PATH);
}

async function loadPackager() {
    return import(PACKAGER_PATH);
}

function makeMinimalPluginEntries(version: string) {
    const manifest = JSON.stringify({
        $schema: 'https://antigravity.google/schemas/v1/plugin.json',
        name: 'antigravity-context-monitor',
        displayName: 'Antigravity Context Monitor',
        version,
        description: 'Real-time context window telemetry and quota runway monitor for Antigravity.',
    }, null, 2) + '\n';

    const sidecarJson = JSON.stringify({
        command: 'node',
        args: ['main.mjs'],
        has_web_ui: true,
        restart_policy: 'always',
    }, null, 2) + '\n';

    // Include a larger repeatable payload so PKZIP exercises Deflate (method 8) alongside Stored (method 0)
    const serverJs = `// compiled server runtime ${version}\n` + 'module.exports = { ok: true };\n'.repeat(40);

    return [
        { name: 'antigravity-context-monitor/plugin.json', data: Buffer.from(manifest, 'utf8'), mode: 0o100644 },
        { name: 'antigravity-context-monitor/sidecars/context_monitor/sidecar.json', data: Buffer.from(sidecarJson, 'utf8'), mode: 0o100644 },
        { name: 'antigravity-context-monitor/sidecars/context_monitor/main.mjs', data: Buffer.from('console.log("sidecar");\n', 'utf8'), mode: 0o100755 },
        { name: 'antigravity-context-monitor/sidecars/context_monitor/runtime/out/app/sidecar-server.js', data: Buffer.from(serverJs, 'utf8'), mode: 0o100644 },
    ];
}

function createFakeInstalledPlugin(dir: string, version: string) {
    fs.mkdirSync(path.join(dir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app'), { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'plugin.json'),
        JSON.stringify({ name: 'antigravity-context-monitor', version }, null, 2) + '\n',
        'utf8',
    );
    fs.writeFileSync(
        path.join(dir, 'sidecars', 'context_monitor', 'sidecar.json'),
        JSON.stringify({ command: 'node', args: ['main.mjs'], has_web_ui: true }),
        'utf8',
    );
    fs.writeFileSync(path.join(dir, 'sidecars', 'context_monitor', 'main.mjs'), 'console.log("ok");\n', 'utf8');
    fs.writeFileSync(
        path.join(dir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'),
        `module.exports = { version: "${version}" };\n`,
        'utf8',
    );
}

describe('install-app-plugin CLI parsing, security & cross-platform helpers', () => {
    const tmpDirs: string[] = [];

    afterEach(() => {
        while (tmpDirs.length > 0) {
            const d = tmpDirs.pop();
            if (d) { fs.rmSync(d, { recursive: true, force: true }); }
        }
    });

    it('parses all supported installer CLI modes and flags and rejects invalid inputs', async () => {
        const mod = await loadInstaller();

        expect(mod.parseInstallerArgs([])).toMatchObject({
            action: 'install',
            dryRun: false,
            json: false,
            checkRemote: false,
            useCli: false,
            version: null,
        });

        expect(mod.parseInstallerArgs(['--from-github', '--version', 'v1.17.6', '--use-cli', '--require-checksum'])).toMatchObject({
            action: 'from-github',
            version: '1.17.6',
            useCli: true,
            requireChecksum: true,
        });

        expect(mod.parseInstallerArgs(['--upgrade', '--version=1.18.0-beta.1', '--dry-run'])).toMatchObject({
            action: 'upgrade',
            version: '1.18.0-beta.1',
            dryRun: true,
        });

        expect(mod.parseInstallerArgs(['--status', '--json', '--check-remote'])).toMatchObject({
            action: 'status',
            json: true,
            checkRemote: true,
        });

        expect(mod.parseInstallerArgs(['--uninstall'])).toMatchObject({ action: 'uninstall' });
        expect(mod.parseInstallerArgs(['--print-cdp-guide'])).toMatchObject({ action: 'print-cdp-guide' });
        expect(mod.parseInstallerArgs(['--setup-cdp-launcher'])).toMatchObject({ action: 'setup-cdp-launcher' });
        expect(mod.parseInstallerArgs(['--remove-cdp-launcher'])).toMatchObject({ action: 'remove-cdp-launcher' });
        expect(mod.parseInstallerArgs(['-h'])).toMatchObject({ help: true });

        expect(() => mod.parseInstallerArgs(['--unknown-flag'])).toThrow(/Unknown option/);
        expect(() => mod.parseInstallerArgs(['--version', '../1.0.0'])).toThrow(/Invalid --version/);
        expect(() => mod.parseInstallerArgs(['--repo', 'https://evil.com/a/b'])).toThrow(/Invalid --repo/);
    });

    it('resolves cross-platform home, plugin, config, sidecar log, and CDP paths', async () => {
        const mod = await loadInstaller();

        expect(mod.getDefaultTargetDir({ HOME: '/Users/alice' }, 'darwin'))
            .toBe(path.join('/Users/alice', '.gemini', 'config', 'plugins', 'antigravity-context-monitor'));
        expect(mod.getDevToolsActivePortPath({ HOME: '/Users/alice' }, 'darwin'))
            .toBe(path.join('/Users/alice', 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort'));

        expect(mod.resolveUserHome({ USERPROFILE: 'C:\\Users\\Bob' }, 'win32')).toBe('C:\\Users\\Bob');
        expect(mod.resolveUserHome({ HOMEDRIVE: 'D:', HOMEPATH: '\\Users\\Bob' }, 'win32')).toBe('D:\\Users\\Bob');
        expect(mod.getDevToolsActivePortPath({ USERPROFILE: 'C:\\Users\\Bob', APPDATA: 'C:\\Users\\Bob\\AppData\\Roaming' }, 'win32'))
            .toBe(path.join('C:\\Users\\Bob\\AppData\\Roaming', 'Antigravity', 'DevToolsActivePort'));

        expect(mod.getDevToolsActivePortPath({ HOME: '/home/carol', XDG_CONFIG_HOME: '/home/carol/.xdg' }, 'linux'))
            .toBe(path.join('/home/carol/.xdg', 'Antigravity', 'DevToolsActivePort'));
        expect(mod.getDevToolsActivePortPath({ HOME: '/home/carol' }, 'linux'))
            .toBe(path.join('/home/carol', '.config', 'Antigravity', 'DevToolsActivePort'));
    });

    it('enforces strict HTTPS GitHub host allowlist on initial URLs and redirects', async () => {
        const mod = await loadInstaller();

        for (const okUrl of [
            'https://api.github.com/repos/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/latest',
            'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.17.6/antigravity-context-monitor-app-1.17.6.zip',
            'https://objects.githubusercontent.com/github-production-release-asset/12345',
            'https://release-assets.githubusercontent.com/github-production-release-asset/12345',
        ]) {
            expect(mod.assertAllowedDownloadUrl(okUrl).protocol).toBe('https:');
        }

        for (const badUrl of [
            'http://github.com/owner/repo/releases/download/v1.0.0/a.zip',
            'file:///etc/passwd',
            'https://evil.example.com/a.zip',
            'https://github.com.evil.example.com/a.zip',
            'https://user:pass@github.com/owner/repo',
            'not-a-url',
        ]) {
            expect(() => mod.assertAllowedDownloadUrl(badUrl)).toThrow();
        }

        // Valid redirect across allowlisted hosts succeeds
        const seen: string[] = [];
        const okRes = await mod.fetchBufferWithAllowlist('https://github.com/a/b/releases/download/v1/x.zip', {
            requestFn: async (urlObj: URL) => {
                seen.push(urlObj.toString());
                if (urlObj.hostname === 'github.com') {
                    return {
                        statusCode: 302,
                        headers: { location: 'https://objects.githubusercontent.com/asset/x.zip' },
                        buffer: Buffer.alloc(0),
                    };
                }
                return { statusCode: 200, headers: {}, buffer: Buffer.from('ok-bytes') };
            },
        });
        expect(okRes.buffer.toString('utf8')).toBe('ok-bytes');
        expect(seen).toHaveLength(2);

        // Redirect onto untrusted host is blocked immediately
        await expect(mod.fetchBufferWithAllowlist('https://github.com/a/b/releases/download/v1/x.zip', {
            requestFn: async () => ({
                statusCode: 302,
                headers: { location: 'https://attacker.example/evil.zip' },
                buffer: Buffer.alloc(0),
            }),
        })).rejects.toThrow(/allowlist/i);

        // Explicit non-443 HTTPS port is rejected
        expect(() => mod.assertAllowedDownloadUrl('https://github.com:8443/a/b/releases/download/v1/x.zip'))
            .toThrow(/port/i);

        // Redirect loop (>5 hops) is blocked
        await expect(mod.fetchBufferWithAllowlist('https://github.com/loop', {
            requestFn: async () => ({
                statusCode: 302,
                headers: { location: 'https://github.com/loop' },
                buffer: Buffer.alloc(0),
            }),
        })).rejects.toThrow(/redirect/i);
    });

    it('parses SHA256SUMS.txt and enforces strict SHA-256 verification', async () => {
        const mod = await loadInstaller();
        const payload = Buffer.from('verified-archive-payload', 'utf8');
        const hex = mod.computeSha256Hex(payload);

        const sumsText = [
            '# release checksums',
            `${hex}  antigravity-context-monitor-app-1.17.6.zip`,
            `${'0'.repeat(64)} *./dist/antigravity-context-monitor-1.17.6.vsix`,
            '',
        ].join('\n');

        const parsed = mod.parseSha256Sums(sumsText);
        expect(parsed.get('antigravity-context-monitor-app-1.17.6.zip')).toBe(hex);
        expect(parsed.get('antigravity-context-monitor-1.17.6.vsix')).toBe('0'.repeat(64));

        expect(mod.verifyBufferSha256(payload, hex, 'test.zip')).toBe(hex);
        expect(() => mod.verifyBufferSha256(Buffer.from('tampered'), hex, 'test.zip')).toThrow(/checksum mismatch/i);
    });

    it('protects against zip-slip path traversal, symlinks, and CRC corruption in ZIP extraction', async () => {
        const mod = await loadInstaller();
        const packager = await loadPackager();
        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-zip-sec-'));
        tmpDirs.push(tmpBase);

        // Path traversal / absolute / drive / NUL checks
        for (const badPath of [
            '../escape.txt',
            'antigravity-context-monitor/../../escape.txt',
            '/etc/passwd',
            'C:\\Windows\\System32\\evil.dll',
            'foo\\..\\..\\bar.txt',
            'good/\0bad.txt',
        ]) {
            expect(() => mod.assertSafeArchiveEntryPath(badPath, tmpBase)).toThrow();
        }

        // Malicious zip-slip ZIP archive must be rejected before writing outside dest
        const evilSlipZip = packager.buildZipBuffer([
            { name: '../pwned.txt', data: Buffer.from('nope'), mode: 0o100644 },
        ]);
        const slipDest = path.join(tmpBase, 'slip-out');
        expect(() => mod.extractZipBufferSafely(evilSlipZip, slipDest)).toThrow(/traversal/i);
        expect(fs.existsSync(path.join(tmpBase, 'pwned.txt'))).toBe(false);

        // Symlink entry (Unix mode S_IFLNK = 0o120777) must be rejected — even when versionMadeBy hostOs != 3
        const symlinkZip = packager.buildZipBuffer([
            { name: 'antigravity-context-monitor/evil-link', data: Buffer.from('/etc/passwd'), mode: 0o120777 },
        ]);
        const symDest = path.join(tmpBase, 'sym-out');
        expect(() => mod.extractZipBufferSafely(symlinkZip, symDest)).toThrow(/symlink/i);

        const spoofedHostOsSymlinkZip = Buffer.from(symlinkZip);
        const cdSigOffset = spoofedHostOsSymlinkZip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        expect(cdSigOffset).toBeGreaterThan(-1);
        spoofedHostOsSymlinkZip.writeUInt16LE(20, cdSigOffset + 4); // hostOs=0 (DOS) + version 2.0
        expect(() => mod.extractZipBufferSafely(spoofedHostOsSymlinkZip, path.join(tmpBase, 'sym-dos-out'))).toThrow(/symlink/i);

        // Corrupted CRC-32 payload must be rejected
        const validZip: Buffer = packager.buildZipBuffer(makeMinimalPluginEntries('1.17.6'));
        const corrupted = Buffer.from(validZip);
        // Flip a byte inside the first local file header CRC field (offset 14)
        corrupted[14] ^= 0xff;
        // Also flip in central directory? Even flipping payload byte triggers CRC check
        const payloadCorrupted = Buffer.from(validZip);
        const markerIdx = payloadCorrupted.indexOf(Buffer.from('Antigravity Context Monitor'));
        if (markerIdx !== -1) {
            payloadCorrupted[markerIdx] ^= 0x01;
            expect(() => mod.extractZipBufferSafely(payloadCorrupted, path.join(tmpBase, 'crc-out'))).toThrow(/CRC-32|inflate|invalid/i);
        }

        // Valid ZIP extracts both Stored and Deflate entries cleanly
        const okDest = path.join(tmpBase, 'ok-out');
        const extracted = mod.extractZipBufferSafely(validZip, okDest);
        expect(extracted.extractedFiles).toBe(4);
        expect(extracted.pluginRoot).toBe(path.join(okDest, 'antigravity-context-monitor'));
        const validated = mod.validatePluginBundle(extracted.pluginRoot, { requireSidecarEntrypoints: true });
        expect(validated.version).toBe('1.17.6');
    });

    it('performs atomic backup + swap and rolls back cleanly on swap failure', async () => {
        const mod = await loadInstaller();
        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-atomic-'));
        tmpDirs.push(tmpBase);

        const targetDir = path.join(tmpBase, 'plugins', 'antigravity-context-monitor');
        const srcNew = path.join(tmpBase, 'src-1.17.6');
        createFakeInstalledPlugin(targetDir, '1.17.5');
        createFakeInstalledPlugin(srcNew, '1.17.6');

        // Failure mid-swap restores original v1.17.5 intact
        expect(() => mod.installPluginAtomic(srcNew, targetDir, {
            onBeforeSwap: () => { throw new Error('Simulated disk swap error'); },
        })).toThrow(/Simulated disk swap error/);
        expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version).toBe('1.17.5');
        expect(fs.readdirSync(path.dirname(targetDir))).toEqual(['antigravity-context-monitor']);

        // Successful swap updates to v1.17.6 and removes backup dir
        const swap = mod.installPluginAtomic(srcNew, targetDir);
        expect(swap).toEqual({ previousVersion: '1.17.5', replaced: true });
        expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version).toBe('1.17.6');
        expect(fs.readdirSync(path.dirname(targetDir))).toEqual(['antigravity-context-monitor']);
    });

    it('enables plugin in config.json atomically without clobbering sibling user settings', async () => {
        const mod = await loadInstaller();
        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-cfg-'));
        tmpDirs.push(tmpBase);

        // Missing config.json -> does not create a partial config file
        const missingCfg = path.join(tmpBase, 'missing-config.json');
        const resMissing = mod.ensurePluginEnabled({ configPath: missingCfg, allowCli: false });
        expect(resMissing).toMatchObject({ updated: false, enabled: true, method: 'default-enabled' });
        expect(fs.existsSync(missingCfg)).toBe(false);

        // Existing config.json with disabled plugin + sibling state -> enables cleanly and preserves everything
        const cfgPath = path.join(tmpBase, 'config.json');
        const originalConfig = {
            plugins: {
                'antigravity-context-monitor': { enabled: false, customFlag: 'keep-me' },
                'other-plugin': { enabled: true },
            },
            sidecars: {
                'swarm/swarm_board': { projectId: 'abc-123' },
            },
            userSettings: {
                useAiCredits: false,
                permissionPreset: 'AGENT_PERMISSION_PRESET_TURBO',
            },
        };
        fs.writeFileSync(cfgPath, JSON.stringify(originalConfig, null, 2), { encoding: 'utf8', mode: 0o600 });

        const resUpdated = mod.ensurePluginEnabled({ configPath: cfgPath, allowCli: false });
        expect(resUpdated).toMatchObject({ updated: true, enabled: true, method: 'config-atomic-merge' });

        const updatedConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        expect(updatedConfig.plugins['antigravity-context-monitor']).toEqual({ enabled: true, customFlag: 'keep-me' });
        expect(updatedConfig.plugins['other-plugin']).toEqual({ enabled: true });
        expect(updatedConfig.sidecars).toEqual(originalConfig.sidecars);
        expect(updatedConfig.userSettings).toEqual(originalConfig.userSettings);

        // Malformed config.json -> refuses to overwrite
        const badCfg = path.join(tmpBase, 'bad-config.json');
        fs.writeFileSync(badCfg, '{broken json', 'utf8');
        const resBad = mod.ensurePluginEnabled({ configPath: badCfg, allowCli: false });
        expect(resBad).toMatchObject({ updated: false, enabled: null, method: 'skipped-invalid-config' });
        expect(fs.readFileSync(badCfg, 'utf8')).toBe('{broken json');
    });

    it('installs & upgrades via --from-github / --upgrade with SHA-256 verification and --install auto-fallback', async () => {
        const mod = await loadInstaller();
        const packager = await loadPackager();
        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-gh-e2e-'));
        tmpDirs.push(tmpBase);

        const zipBuf: Buffer = packager.buildZipBuffer(makeMinimalPluginEntries('1.17.6'));
        const zipSha = mod.computeSha256Hex(zipBuf);
        const zipName = 'antigravity-context-monitor-app-1.17.6.zip';
        const sumsBuf = Buffer.from(`${zipSha}  ${zipName}\n`, 'utf8');

        const releaseJson = {
            tag_name: 'v1.17.6',
            html_url: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.17.6',
            assets: [
                {
                    name: zipName,
                    size: zipBuf.length,
                    browser_download_url: `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.17.6/${zipName}`,
                },
                {
                    name: 'SHA256SUMS.txt',
                    browser_download_url: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.17.6/SHA256SUMS.txt',
                },
            ],
        };

        const mockRequestFn = async (urlObj: URL) => {
            if (urlObj.hostname === 'api.github.com') {
                return { statusCode: 200, headers: {}, buffer: Buffer.from(JSON.stringify(releaseJson)) };
            }
            if (urlObj.pathname.endsWith('.zip')) {
                return { statusCode: 200, headers: {}, buffer: zipBuf };
            }
            if (urlObj.pathname.endsWith('SHA256SUMS.txt')) {
                return { statusCode: 200, headers: {}, buffer: sumsBuf };
            }
            return { statusCode: 404, headers: {}, buffer: Buffer.from('Not Found') };
        };

        const targetDir = path.join(tmpBase, 'plugins', 'antigravity-context-monitor');
        const cfgPath = path.join(tmpBase, 'config.json');
        fs.writeFileSync(cfgPath, JSON.stringify({ plugins: {}, userSettings: { keep: 1 } }), 'utf8');

        // 1. Dry-run touches nothing
        const dry = await mod.runInstallerAsync({
            action: 'from-github',
            target: targetDir,
            configPath: cfgPath,
            dryRun: true,
            requestFn: mockRequestFn,
        });
        expect(dry.dryRun).toBe(true);
        expect(dry.version).toBe('1.17.6');
        expect(fs.existsSync(targetDir)).toBe(false);

        // 2. Existing v1.17.5 upgraded cleanly via --upgrade with SHA-256 verification
        createFakeInstalledPlugin(targetDir, '1.17.5');
        const upgraded = await mod.runInstallerAsync({
            action: 'upgrade',
            target: targetDir,
            configPath: cfgPath,
            requestFn: mockRequestFn,
        });
        expect(upgraded.version).toBe('1.17.6');
        expect(upgraded.previousVersion).toBe('1.17.5');
        expect(upgraded.replaced).toBe(true);
        expect(upgraded.reloadRequired).toBe(true);
        expect(upgraded.checksumVerified).toBe(true);
        expect(upgraded.sha256).toBe(zipSha);
        expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version).toBe('1.17.6');
        expect(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).plugins['antigravity-context-monitor'].enabled).toBe(true);
        expect(JSON.parse(fs.readFileSync(cfgPath, 'utf8')).userSettings).toEqual({ keep: 1 });

        // 3. Checksum mismatch rejects tampered download and preserves installed v1.17.6
        const badSumsRequestFn = async (urlObj: URL) => {
            if (urlObj.pathname.endsWith('SHA256SUMS.txt')) {
                return { statusCode: 200, headers: {}, buffer: Buffer.from(`${'f'.repeat(64)}  ${zipName}\n`) };
            }
            return mockRequestFn(urlObj);
        };
        await expect(mod.runInstallerAsync({
            action: 'upgrade',
            target: targetDir,
            configPath: cfgPath,
            requestFn: badSumsRequestFn,
        })).rejects.toThrow(/checksum mismatch/i);
        expect(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version).toBe('1.17.6');

        // 3b. Missing entry in published SHA256SUMS.txt fails closed even without --require-checksum
        const missingEntryRequestFn = async (urlObj: URL) => {
            if (urlObj.pathname.endsWith('SHA256SUMS.txt')) {
                return { statusCode: 200, headers: {}, buffer: Buffer.from(`${'a'.repeat(64)}  other-file.vsix\n`) };
            }
            return mockRequestFn(urlObj);
        };
        await expect(mod.runInstallerAsync({
            action: 'upgrade',
            target: targetDir,
            configPath: cfgPath,
            requestFn: missingEntryRequestFn,
        })).rejects.toThrow(/did not contain an entry/i);

        // 4. --install auto-falls back to --from-github when local dist/out are missing
        const emptyRepo = path.join(tmpBase, 'empty-repo');
        fs.mkdirSync(emptyRepo, { recursive: true });
        const fallbackTarget = path.join(tmpBase, 'fallback-target');
        const fallbackRes = await mod.runInstallerAsync({
            action: 'install',
            repoRoot: emptyRepo,
            target: fallbackTarget,
            requestFn: mockRequestFn,
        });
        expect(fallbackRes.sourceMode).toBe('github');
        expect(fallbackRes.version).toBe('1.17.6');
        expect(fs.existsSync(path.join(fallbackTarget, 'plugin.json'))).toBe(true);
    });

    it('reports complete --status diagnostics (plugin, config, sidecar, CDP, IDE VSIX, remote check) and --print-cdp-guide', async () => {
        const mod = await loadInstaller();
        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-status-'));
        tmpDirs.push(tmpBase);

        const fakeHome = path.join(tmpBase, 'home');
        const fakeEnv = { HOME: fakeHome };
        const targetDir = mod.getDefaultTargetDir(fakeEnv, 'darwin');
        const configPath = mod.getDefaultConfigPath(fakeEnv, 'darwin');
        const sidecarLogPath = mod.getSidecarLogPath(fakeEnv, 'darwin');
        const cdpPortPath = mod.getDevToolsActivePortPath(fakeEnv, 'darwin');

        createFakeInstalledPlugin(targetDir, '1.17.6');
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({
            plugins: { 'antigravity-context-monitor': { enabled: true } },
            sidecars: { 'antigravity-context-monitor/context_monitor': { schemaVersion: 1 } },
        }), 'utf8');

        fs.mkdirSync(path.dirname(sidecarLogPath), { recursive: true });
        fs.writeFileSync(sidecarLogPath, '[sidecar] listening on 127.0.0.1:54321\n', 'utf8');

        fs.mkdirSync(path.dirname(cdpPortPath), { recursive: true });
        fs.writeFileSync(cdpPortPath, '9222\n/devtools/browser/test-id\n', 'utf8');

        const ideExtDir = path.join(fakeHome, '.antigravity-ide', 'extensions', 'agi-is-going-to-arrive.antigravity-context-monitor-1.17.6');
        fs.mkdirSync(ideExtDir, { recursive: true });
        fs.writeFileSync(path.join(ideExtDir, 'package.json'), JSON.stringify({ version: '1.17.6' }), 'utf8');

        const status = await mod.collectStatus({
            env: fakeEnv,
            platform: 'darwin',
            checkRemote: true,
            probeHealthFn: async (port: number) => ({
                ok: port === 54321,
                version: '1.17.5',
                pid: 42424,
            }),
            probeCdpPortFn: async (port: number) => port === 9222,
            requestFn: async () => ({
                statusCode: 200,
                headers: {},
                buffer: Buffer.from(JSON.stringify({
                    tag_name: 'v1.17.9',
                    html_url: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.17.9',
                    assets: [
                        { name: 'antigravity-context-monitor-app-1.17.9.zip', browser_download_url: 'https://github.com/a/b/x.zip' },
                        { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/a/b/SHA256SUMS.txt' },
                    ],
                })),
            }),
        });

        expect(status.appPlugin).toMatchObject({
            installed: true,
            version: '1.17.6',
            hasCompiledRuntime: true,
            enabled: true,
            enabledInConfig: true,
            sidecarConfigured: true,
        });
        expect(status.sidecar).toMatchObject({
            logExists: true,
            listeningPort: 54321,
            processActive: true,
            runningPid: 42424,
            runningVersion: '1.17.5',
            reloadRequired: true,
        });
        expect(status.cdp).toMatchObject({
            active: true,
            stale: false,
            port: 9222,
            wsPath: '/devtools/browser/test-id',
        });
        expect(status.cdpLauncher).toMatchObject({
            installed: false,
            platform: 'darwin',
            path: path.join(fakeHome, 'Applications', 'Antigravity (CDP).app'),
        });
        expect(status.ideVsix.installed).toBe(true);
        expect(status.ideVsix.installations[0]).toMatchObject({
            editor: 'Antigravity IDE',
            version: '1.17.6',
        });
        expect(status.remote).toMatchObject({
            checked: true,
            latestVersion: '1.17.9',
            updateAvailable: true,
            hasChecksums: true,
            error: null,
        });

        const cdpGuide = mod.runInstaller({ action: 'print-cdp-guide' }).guide;
        expect(cdpGuide).toContain('--remote-debugging-port=0');
        expect(cdpGuide).toContain('--setup-cdp-launcher');
        expect(cdpGuide).toContain('--remove-cdp-launcher');
        expect(cdpGuide).toContain('while pgrep -f');
        expect(cdpGuide).toMatch(/5-Second|5 秒/);
        expect(cdpGuide).toContain('[macOS]');
        expect(cdpGuide).toContain('[Windows]');
        expect(cdpGuide).toContain('[Linux]');
        expect(cdpGuide).toContain('PowerShell:');
        expect(cdpGuide).toContain('CMD / Run dialog:');
        expect(cdpGuide).toMatch(/Auto-Update|自动更新/);
        expect(cdpGuide).toMatch(/Zero Binary Patching|零二进制/);
    });

    it('supports --setup-cdp-launcher, --remove-cdp-launcher, --dry-run, and --status --json cdpLauncher field', async () => {
        const mod = await loadInstaller();
        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-cli-launcher-'));
        tmpDirs.push(tmpBase);

        const fakeHome = path.join(tmpBase, 'home');
        const fakeApp = path.join(tmpBase, 'Antigravity.app');
        fs.mkdirSync(path.join(fakeApp, 'Contents', 'Resources'), { recursive: true });
        fs.writeFileSync(path.join(fakeApp, 'Contents', 'Resources', 'icon.icns'), 'icns');

        // 1. Dry-run creates nothing
        const dryRes = await mod.runInstallerAsync({
            action: 'setup-cdp-launcher',
            platform: 'darwin',
            homeDir: fakeHome,
            appPath: fakeApp,
            dryRun: true,
        });
        expect(dryRes).toMatchObject({
            action: 'setup-cdp-launcher',
            ok: true,
            dryRun: true,
            platform: 'darwin',
        });
        expect(fs.existsSync(dryRes.launcherPath)).toBe(false);

        // 2. Real setup creates ~/Applications/Antigravity (CDP).app and --status reports installed: true
        const setupRes = await mod.runInstallerAsync({
            action: 'setup-cdp-launcher',
            platform: 'darwin',
            homeDir: fakeHome,
            appPath: fakeApp,
        });
        expect(setupRes.ok).toBe(true);
        expect(setupRes.status.installed).toBe(true);
        const macLaunchPath = path.join(setupRes.launcherPath, 'Contents', 'MacOS', 'launch');
        expect(fs.existsSync(path.join(setupRes.launcherPath, 'Contents', 'Info.plist'))).toBe(true);
        expect(fs.existsSync(macLaunchPath)).toBe(true);
        const macLaunchScript = fs.readFileSync(macLaunchPath, 'utf8');
        expect(macLaunchScript).toContain("-e 'activate'");
        expect(macLaunchScript).toContain('Allow Automation permission for Antigravity (CDP)');
        if (process.platform !== 'win32') {
            execFileSync('bash', ['-n', macLaunchPath], { stdio: 'pipe' });
        }

        const statusInstalled = await mod.collectStatus({
            env: { HOME: fakeHome },
            platform: 'darwin',
            probeHealth: false,
            probeCdpPort: false,
        });
        expect(statusInstalled.cdpLauncher).toMatchObject({
            installed: true,
            platform: 'darwin',
            path: setupRes.launcherPath,
        });

        // 3. CLI subprocess --status --json with isolated HOME returns cdpLauncher object
        const cliOut = execFileSync(process.execPath, [INSTALLER_PATH, '--status', '--json'], {
            encoding: 'utf8',
            env: { ...process.env, HOME: fakeHome },
        });
        const cliJson = JSON.parse(cliOut);
        expect(cliJson.cdpLauncher).toMatchObject({
            installed: process.platform === 'darwin',
            platform: process.platform,
        });
        expect(typeof cliJson.cdpLauncher.path).toBe('string');

        // 4. --remove-cdp-launcher removes launcher cleanly
        const removeRes = await mod.runInstallerAsync({
            action: 'remove-cdp-launcher',
            platform: 'darwin',
            homeDir: fakeHome,
            appPath: fakeApp,
        });
        expect(removeRes).toMatchObject({
            action: 'remove-cdp-launcher',
            ok: true,
            existed: true,
            removed: true,
        });
        expect(removeRes.status.installed).toBe(false);
        expect(fs.existsSync(setupRes.launcherPath)).toBe(false);

        // 5. Linux launcher via installer (including custom appPath with apostrophe & closing brace)
        const linuxHome = path.join(tmpBase, "linux user's home");
        const trickyLinuxApp = "/opt/user's {dir}/anti}gravity/antigravity";
        const linuxSetup = await mod.runInstallerAsync({
            action: 'setup-cdp-launcher',
            platform: 'linux',
            homeDir: linuxHome,
            appPath: trickyLinuxApp,
        });
        expect(linuxSetup.ok).toBe(true);
        expect(linuxSetup.status.installed).toBe(true);
        const linuxWrapperPath = path.join(linuxHome, '.local', 'bin', 'antigravity-cdp');
        const linuxWrapperText = fs.readFileSync(linuxWrapperPath, 'utf8');
        expect(linuxWrapperText).toContain('DEFAULT_BIN=');
        expect(linuxWrapperText).toContain('APP_BIN="${ANTIGRAVITY_BIN:-$DEFAULT_BIN}"');
        if (process.platform !== 'win32') {
            execFileSync('sh', ['-n', linuxWrapperPath], { stdio: 'pipe' });
        }
        const linuxDesktopText = fs.readFileSync(linuxSetup.launcherPath, 'utf8');
        expect(linuxDesktopText).toContain(`Exec="${linuxWrapperPath}" %U`);
        const linuxRemove = await mod.runInstallerAsync({
            action: 'remove-cdp-launcher',
            platform: 'linux',
            homeDir: linuxHome,
        });
        expect(linuxRemove.removed).toBe(true);
        expect(linuxRemove.status.installed).toBe(false);
    });

    it('probes TCP reachability for DevToolsActivePort (distinguishing live vs stale ports) and respects AGY_BROWSER_ACTIVE_PORT_FILE', async () => {
        const mod = await loadInstaller();
        const net = await import('node:net');
        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-cdp-probe-'));
        tmpDirs.push(tmpBase);

        // AGY_BROWSER_ACTIVE_PORT_FILE override
        const customPortFile = path.join(tmpBase, 'CustomDevToolsActivePort');
        expect(mod.getDevToolsActivePortPath({ HOME: tmpBase, AGY_BROWSER_ACTIVE_PORT_FILE: customPortFile }, 'darwin'))
            .toBe(customPortFile);

        // Bind a real ephemeral loopback server, then close it for the stale check
        const srv = net.createServer();
        await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
        const livePort = (srv.address() as import('node:net').AddressInfo).port;

        try {
            fs.writeFileSync(customPortFile, `${livePort}\n/devtools/browser/live-id\n`, 'utf8');
            const liveRes = await mod.inspectDevToolsActivePort(customPortFile);
            expect(liveRes).toMatchObject({
                active: true,
                stale: false,
                port: livePort,
                wsPath: '/devtools/browser/live-id',
            });
        } finally {
            await new Promise<void>((resolve) => srv.close(() => resolve()));
        }

        // Now that the listener is closed, the same DevToolsActivePort file must be reported as stale!
        const staleRes = await mod.inspectDevToolsActivePort(customPortFile);
        expect(staleRes).toMatchObject({
            active: false,
            stale: true,
            port: livePort,
            wsPath: '/devtools/browser/live-id',
        });
    });

    it('ships valid cross-platform .sh and .ps1 wrappers with bundled agy-node & Electron fallbacks', () => {
        const shPath = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.sh');
        const ps1Path = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.ps1');

        const shBuf = fs.readFileSync(shPath);
        const ps1Buf = fs.readFileSync(ps1Path);
        // Zero UTF-8 BOM in both wrappers
        expect(shBuf[0] === 0xef && shBuf[1] === 0xbb && shBuf[2] === 0xbf).toBe(false);
        expect(ps1Buf[0] === 0xef && ps1Buf[1] === 0xbb && ps1Buf[2] === 0xbf).toBe(false);

        const shText = shBuf.toString('utf8');
        expect(shText).toContain('/Applications/Antigravity.app/Contents/Resources/bin/agy-node');
        expect(shText).toContain('${HOME}/.gemini/bin/agy-node');
        expect(shText).toContain('ELECTRON_RUN_AS_NODE=1');
        if (process.platform !== 'win32') {
            execFileSync('bash', ['-n', shPath], { stdio: 'pipe' });
        }

        const ps1Text = ps1Buf.toString('utf8');
        expect(ps1Text).toContain('Programs\\Antigravity\\bin\\agy-node.exe');
        expect(ps1Text).toContain('Programs\\Antigravity\\bin\\agy-node.cmd');
        expect(ps1Text).toContain('.gemini\\bin\\agy-node.exe');
        expect(ps1Text).toContain('ELECTRON_RUN_AS_NODE');
    });
});

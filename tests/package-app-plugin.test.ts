import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const PACKAGER_PATH = path.join(REPO_ROOT, 'scripts', 'package-app-plugin.mjs');
const INSTALLER_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.mjs');

function createFixtureRepo(tmpBase: string, version: string, includeVsix: boolean) {
    const repoDir = path.join(tmpBase, includeVsix ? 'repo-with-vsix' : 'repo-no-vsix');
    const appPluginDst = path.join(repoDir, 'app-plugin');
    const outDir = path.join(repoDir, 'out');
    const imagesDir = path.join(repoDir, 'src', 'images');

    fs.cpSync(path.join(REPO_ROOT, 'app-plugin'), appPluginDst, { recursive: true });
    // Stamp fixture manifest version cleanly without touching real repo
    const manifestPath = path.join(appPluginDst, 'plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.version = version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    fs.mkdirSync(path.join(outDir, 'app'), { recursive: true });
    fs.writeFileSync(path.join(outDir, 'webview-document.js'), 'module.exports = { buildMonitorDocumentHtml() { return "<!DOCTYPE html>"; } };\n', 'utf8');
    fs.writeFileSync(path.join(outDir, 'app', 'sidecar-server.js'), 'module.exports = { createSidecarHandler() {} };\n', 'utf8');
    fs.writeFileSync(path.join(outDir, 'app', 'sidecar-runtime.js'), 'module.exports = { createSidecarRuntimeProvider() {} };\n', 'utf8');
    fs.writeFileSync(path.join(outDir, 'ignored.js.map'), '{"version":3}', 'utf8');

    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(path.join(imagesDir, 'monitor-overview.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    let vsixPath: string | null = null;
    if (includeVsix) {
        vsixPath = path.join(repoDir, `antigravity-context-monitor-${version}.vsix`);
        fs.writeFileSync(vsixPath, Buffer.from(`fake-vsix-bytes-${version}`, 'utf8'));
    }

    return { repoDir, distDir: path.join(repoDir, 'dist'), vsixPath };
}

describe('package-app-plugin.mjs packaging, SHA256SUMS.txt & strict validation', () => {
    const tmpDirs: string[] = [];

    afterEach(() => {
        while (tmpDirs.length > 0) {
            const d = tmpDirs.pop();
            if (d) { fs.rmSync(d, { recursive: true, force: true }); }
        }
    });

    it('emits dist/SHA256SUMS.txt matching .zip and .tar.gz when no root .vsix exists, and round-trips through safe ZIP extraction', async () => {
        const packager = await import(PACKAGER_PATH);
        const installer = await import(INSTALLER_PATH);
        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-pkg-test-'));
        tmpDirs.push(tmpBase);

        const version = '1.17.6';
        const { repoDir, distDir } = createFixtureRepo(tmpBase, version, false);

        const result = packager.packageAppPlugin({ repoRoot: repoDir, distRoot: distDir });
        expect(result.version).toBe(version);
        expect(result.vsixIncluded).toBe(false);
        expect(fs.existsSync(result.zipPath)).toBe(true);
        expect(fs.existsSync(result.tarGzPath)).toBe(true);
        expect(fs.existsSync(result.checksumsPath)).toBe(true);
        expect(path.basename(result.checksumsPath)).toBe('SHA256SUMS.txt');

        // Strict agy validation must have 0 findings if agy CLI is installed
        expect(result.validation.ok).toBe(true);
        if (result.validation.ran) {
            expect(result.validation.findings).toEqual([]);
        }

        // SHA256SUMS.txt has zero BOM and matches exact file hashes
        const rawSumsBuf = fs.readFileSync(result.checksumsPath);
        expect(rawSumsBuf[0] === 0xef && rawSumsBuf[1] === 0xbb && rawSumsBuf[2] === 0xbf).toBe(false);
        const sumsText = rawSumsBuf.toString('utf8');
        const parsed = installer.parseSha256Sums(sumsText);

        const zipName = `antigravity-context-monitor-app-${version}.zip`;
        const tgzName = `antigravity-context-monitor-app-${version}.tar.gz`;
        expect(parsed.get(zipName)).toBe(packager.computeFileSha256Hex(result.zipPath));
        expect(parsed.get(tgzName)).toBe(packager.computeFileSha256Hex(result.tarGzPath));
        expect(result.checksums).toHaveLength(2);

        // Source maps must be excluded from packaged runtime
        expect(fs.existsSync(path.join(result.stageDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'ignored.js.map'))).toBe(false);

        // Round-trip: installer safely extracts the generated ZIP and validates all entrypoints
        const extractDir = path.join(tmpBase, 'roundtrip-extract');
        const extracted = installer.extractZipBufferSafely(fs.readFileSync(result.zipPath), extractDir);
        expect(extracted.pluginRoot).toBe(path.join(extractDir, 'antigravity-context-monitor'));
        const validated = installer.validatePluginBundle(extracted.pluginRoot, { requireSidecarEntrypoints: true });
        expect(validated.version).toBe(version);
    });

    it('includes root antigravity-context-monitor-<version>.vsix in dist/SHA256SUMS.txt when present', async () => {
        const packager = await import(PACKAGER_PATH);
        const installer = await import(INSTALLER_PATH);
        const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-pkg-vsix-'));
        tmpDirs.push(tmpBase);

        const version = '1.17.6';
        const { repoDir, distDir, vsixPath } = createFixtureRepo(tmpBase, version, true);

        const result = packager.packageAppPlugin({ repoRoot: repoDir, distRoot: distDir, skipValidation: true });
        expect(result.vsixIncluded).toBe(true);
        expect(result.checksums).toHaveLength(3);

        const sumsText = fs.readFileSync(result.checksumsPath, 'utf8');
        const parsed = installer.parseSha256Sums(sumsText);
        const vsixName = `antigravity-context-monitor-${version}.vsix`;
        expect(parsed.get(vsixName)).toBe(packager.computeFileSha256Hex(vsixPath!));
        expect(sumsText).toContain(`${parsed.get(vsixName)}  ${vsixName}\n`);
    });
});

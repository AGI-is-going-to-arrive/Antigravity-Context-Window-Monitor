// Consolidated Gate Suite #3: Schema, Docs, Icon, Manifest, Client Bundle & Packaging Hygiene
import * as fs from 'fs';
import * as path from 'path';
import packageManifest from '../package.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import * as os from 'os';
import * as vm from 'vm';
import {
    buildOverlayBootstrapScript,
    buildOverlayUnmountScript,
    buildOverlayUpdateScript,
    CDP_COMPOSER_HOST_ID,
    CDP_OVERLAY_BUILD_ID,
    CDP_OVERLAY_SCRIPT_VERSION,
    CDP_RUNTIME_GLOBAL_KEY,
    CDP_TOPBAR_HOST_ID,
} from '../src/app/cdp-overlay-assets';
import { CDP_OVERLAY_CLIENT_BUILD_ID, CDP_OVERLAY_CLIENT_BUNDLE, WEBVIEW_CLIENT_BUILD_ID, WEBVIEW_CLIENT_BUNDLE } from '../src/client/generated/client-bundles.generated';
import { collectPricingInputOverrides as collectSharedPricingOverrides } from '../src/client/pricing-overrides';
import { getGMDataTabStyles } from '../src/activity-panel';
import { buildMonitorDocumentHtml, DEFAULT_MONITOR_DOCUMENT_SETTINGS } from '../src/webview-document';
import { getEditorialStyles } from '../src/webview-editorial-styles';
import { collectPricingInputOverrides, getScript } from '../src/webview-script';
import { getStyles } from '../src/webview-styles';
import { resolveScopedBrainRoot } from '../src/core/swarm-registry';

describe('[schema-and-package-hygiene]', () => {
    const REPO_ROOT = path.resolve(__dirname, '..');


    const EXPECTED_CURRENCIES = ['USD', 'CNY', 'EUR', 'JPY', 'GBP', 'KRW', 'HKD', 'TWD', 'CAD', 'AUD'] as const;


    const PHASE6_EN_WEBP_IMAGES = new Set([
        'docs/images/en/hero-overview.webp',
        'docs/images/en/overview-swarm.webp',
        'docs/images/en/settings-global-rules.webp',
        'docs/images/en/model-calls.webp',
        'docs/images/en/usage-cost.webp',
        'docs/images/en/models-quotas.webp',
        'docs/images/en/cdp-overlays.webp',
        'docs/images/en/ide-light.webp',
        'docs/images/en/aux-pane-sessions.webp',
    ]);


    const PHASE6_ZH_WEBP_IMAGES = new Set([
        'docs/images/zh/hero-overview.webp',
        'docs/images/zh/overview-swarm.webp',
        'docs/images/zh/settings-global-rules.webp',
        'docs/images/zh/model-calls.webp',
        'docs/images/zh/usage-cost.webp',
        'docs/images/zh/models-quotas.webp',
        'docs/images/zh/cdp-overlays.webp',
        'docs/images/zh/ide-light.webp',
        'docs/images/zh/aux-pane-sessions.webp',
    ]);


    const FORBIDDEN_ABSOLUTIST_TOS_PATTERNS: readonly RegExp[] = [
        /100%\s*ToS-safe/i,
        /100%\s*Antigravity\s+ToS-compliant/i,
        /100%\s*ToS-compliant/i,
        /100%\s*合规/,
    ];


    function hasUtf8Bom(filePath: string): boolean {
        const buf = fs.readFileSync(filePath);
        return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    }


    function countLines(text: string): number {
        if (!text) { return 0; }
        const normalized = text.replace(/\r\n/g, '\n');
        const lines = normalized.split('\n');
        if (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        return lines.length;
    }


    function stripCodeBlocksAndSpans(md: string): string {
        return md
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`\n]*`/g, '');
    }


    function githubHeadingSlug(heading: string): string {
        return heading
            .trim()
            .toLowerCase()
            .replace(/<[^>]+>/g, '')
            .replace(/[^\p{L}\p{N}\s-]/gu, '')
            .replace(/\s/g, '-');
    }


    function collectMarkdownHeadingSlugs(filePath: string): Set<string> {
        const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
        const cleaned = raw.replace(/```[\s\S]*?```/g, '');
        const counts = new Map<string, number>();
        const slugs = new Set<string>();
        for (const line of cleaned.split('\n')) {
            const anchor = /^\s*<a\s+(?:id|name)=(["'])([^"']+)\1\s*>\s*<\/a>\s*$/i.exec(line);
            if (anchor) { slugs.add(anchor[2].toLowerCase()); }
            const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
            if (!m) { continue; }
            const base = githubHeadingSlug(m[1]);
            if (!base) { continue; }
            const prev = counts.get(base) ?? 0;
            counts.set(base, prev + 1);
            slugs.add(prev === 0 ? base : `${base}-${prev}`);
        }
        return slugs;
    }


    function extractMarkdownLinks(md: string): Array<{ isImage: boolean; target: string }> {
        const cleaned = stripCodeBlocksAndSpans(md);
        const out: Array<{ isImage: boolean; target: string }> = [];
        const re = /(!)?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(cleaned)) !== null) {
            out.push({ isImage: Boolean(m[1]), target: m[2] });
        }
        return out;
    }


    function collectSourceFiles(dir: string, exts: readonly string[]): string[] {
        if (!fs.existsSync(dir)) { return []; }
        const out: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                out.push(...collectSourceFiles(full, exts));
            } else if (entry.isFile() && exts.some((ext) => entry.name.endsWith(ext))) {
                out.push(full);
            }
        }
        return out;
    }


    describe('Phase 4 Schema, Documentation, Icon & Packaging Hygiene', () => {
        it('enforces README.md (<150 lines) and lowercase readme_CN.md (<150 lines) single-source WebP contracts', () => {
            const rootEntries = fs.readdirSync(REPO_ROOT);
            expect(rootEntries).toContain('README.md');
            expect(rootEntries).toContain('readme_CN.md');
            expect(rootEntries).not.toContain('README_CN.md');

            const readmePath = path.join(REPO_ROOT, 'README.md');
            const readmeCnPath = path.join(REPO_ROOT, 'readme_CN.md');
            expect(hasUtf8Bom(readmePath)).toBe(false);
            expect(hasUtf8Bom(readmeCnPath)).toBe(false);

            const readme = fs.readFileSync(readmePath, 'utf8');
            const readmeCn = fs.readFileSync(readmeCnPath, 'utf8');
            expect(countLines(readme)).toBeLessThan(150);
            expect(countLines(readmeCn)).toBeLessThan(150);

            // Zero references to retired src/images/monitor-*.png
            expect(readme).not.toContain('src/images/monitor-');
            expect(readmeCn).not.toContain('src/images/monitor-');

            // When the live captures land, keep their locale-specific README links in sync.
            for (const img of PHASE6_EN_WEBP_IMAGES) {
                expect(readme.includes(`(${img})`)).toBe(fs.existsSync(path.join(REPO_ROOT, img)));
            }
            for (const img of PHASE6_ZH_WEBP_IMAGES) {
                expect(readmeCn.includes(`(${img})`)).toBe(fs.existsSync(path.join(REPO_ROOT, img)));
            }

            // Core sections present in README.md
            expect(readme).toContain('## Capability Matrix');
            expect(readme).toContain('## 3-Step Install & Upgrade');
            expect(readme).toContain(`## Highlights in v${packageManifest.version}`);
            expect(readme).toContain('## Thresholds & Quick Troubleshooting');
            expect(readme).toContain('## Architecture & Technical Compliance Boundaries');
        });

        it('enforces slim CHANGELOG.md (<25 KB) with complete docs/CHANGELOG_ARCHIVE.md history', () => {
            const changelogPath = path.join(REPO_ROOT, 'CHANGELOG.md');
            const archivePath = path.join(REPO_ROOT, 'docs', 'CHANGELOG_ARCHIVE.md');
            expect(fs.existsSync(changelogPath)).toBe(true);
            expect(fs.existsSync(archivePath)).toBe(true);
            expect(hasUtf8Bom(changelogPath)).toBe(false);
            expect(hasUtf8Bom(archivePath)).toBe(false);

            const changelogSize = fs.statSync(changelogPath).size;
            expect(changelogSize).toBeLessThan(25_600);

            const changelog = fs.readFileSync(changelogPath, 'utf8');
            const archive = fs.readFileSync(archivePath, 'utf8');
            expect(changelog).toContain(`## [${packageManifest.version}]`);
            expect(changelog).toContain('docs/CHANGELOG_ARCHIVE.md');
            expect(archive).toContain('## [1.17.11]');
            expect(archive).toContain('## [1.16.0]');
            expect(archive.length).toBeGreaterThan(500_000);
        });

        it('ships bilingual docs/releases/1.18.0.md (English first, then Simplified Chinese) and focused deep guides', () => {
            const rel118Path = path.join(REPO_ROOT, 'docs', 'releases', '1.18.0.md');
            expect(fs.existsSync(rel118Path)).toBe(true);
            expect(hasUtf8Bom(rel118Path)).toBe(false);

            const rel118 = fs.readFileSync(rel118Path, 'utf8');
            const enIdx = rel118.indexOf('## English');
            const zhIdx = rel118.indexOf('## 中文');
            expect(enIdx).toBeGreaterThan(-1);
            expect(zhIdx).toBeGreaterThan(enIdx);
            expect(rel118).toContain('PublishedMonitorObservation');
            expect(rel118).toContain('SwarmRegistry');
            expect(rel118).toContain('agy-statusline.mjs');
            expect(rel118).toContain('--local-dir');
            expect(rel118).toContain('--no-remote-fallback');

            for (const relPath of [
                'docs/architecture.md',
                'docs/telemetry-and-pricing.md',
                'docs/cdp-overlays.md',
                'DESIGN.md',
                'PRODUCT.md',
                'AGENTS.md',
                'app-plugin/skills/context-monitor/SKILL.md',
            ]) {
                const full = path.join(REPO_ROOT, relPath);
                expect(fs.existsSync(full), `Missing doc: ${relPath}`).toBe(true);
                expect(hasUtf8Bom(full), `Unexpected BOM in ${relPath}`).toBe(false);
            }

            const agents = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
            expect(agents).toContain('--local-dir');
            expect(agents).toContain('--no-remote-fallback');
            expect(agents).toContain('agy-statusline.mjs');
            expect(agents).toContain('Cancel');

            const skill = fs.readFileSync(path.join(REPO_ROOT, 'app-plugin', 'skills', 'context-monitor', 'SKILL.md'), 'utf8');
            expect(skill).toContain('Overview');
            expect(skill).toContain('Model Calls');
            expect(skill).toContain('Usage & Cost');
            expect(skill).toContain('Models & Quotas');
            expect(skill).toContain('Back to Main');
            expect(skill).toContain('Handoff v2');
            expect(skill).toContain('Recovery Brief');
            expect(skill).toContain('agy-statusline.mjs');
        });

        it('ships a valid crisp 256x256 RGBA PNG at assets/icon.png and deletes all 9 retired src/images/monitor-*.png files', () => {
            const iconPath = path.join(REPO_ROOT, 'assets', 'icon.png');
            expect(fs.existsSync(iconPath)).toBe(true);
            const buf = fs.readFileSync(iconPath);

            // PNG 8-byte signature + IHDR chunk
            expect(buf.length).toBeGreaterThan(33);
            expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
            expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
            expect(buf.readUInt32BE(16)).toBe(256); // width
            expect(buf.readUInt32BE(20)).toBe(256); // height
            expect(buf[24]).toBe(8);                // 8-bit depth
            expect(buf[25]).toBe(6);                // RGBA color type
            expect(buf.length).toBeLessThan(65_536);

            // Zero legacy src/images/monitor-*.png files remain
            const legacyImagesDir = path.join(REPO_ROOT, 'src', 'images');
            if (fs.existsSync(legacyImagesDir)) {
                const legacyPngs = fs.readdirSync(legacyImagesDir).filter((f) => /^monitor-.*\.png$/i.test(f));
                expect(legacyPngs).toEqual([]);
            }
        });

        it('enforces zero absolutist ToS claims across all active docs, SKILL.md, manifests, and src/', () => {
            const filesToScan = [
                path.join(REPO_ROOT, 'README.md'),
                path.join(REPO_ROOT, 'readme_CN.md'),
                path.join(REPO_ROOT, 'CHANGELOG.md'),
                path.join(REPO_ROOT, 'DESIGN.md'),
                path.join(REPO_ROOT, 'PRODUCT.md'),
                path.join(REPO_ROOT, 'AGENTS.md'),
                path.join(REPO_ROOT, 'package.json'),
                path.join(REPO_ROOT, 'app-plugin', 'plugin.json'),
                path.join(REPO_ROOT, 'app-plugin', 'skills', 'context-monitor', 'SKILL.md'),
                path.join(REPO_ROOT, 'docs', 'CHANGELOG_ARCHIVE.md'),
                path.join(REPO_ROOT, 'docs', 'architecture.md'),
                path.join(REPO_ROOT, 'docs', 'telemetry-and-pricing.md'),
                path.join(REPO_ROOT, 'docs', 'cdp-overlays.md'),
                path.join(REPO_ROOT, 'docs', 'releases', '1.18.0.md'),
                ...collectSourceFiles(path.join(REPO_ROOT, 'src'), ['.ts']),
            ];

            for (const filePath of filesToScan) {
                const content = fs.readFileSync(filePath, 'utf8');
                const rel = path.relative(REPO_ROOT, filePath);
                for (const pattern of FORBIDDEN_ABSOLUTIST_TOS_PATTERNS) {
                    expect(content, `Forbidden absolutist ToS claim (${pattern}) in ${rel}`).not.toMatch(pattern);
                }
            }
        });

        it('validates package.json Marketplace metadata, 10-currency enums incl. CAD, safe keybindings, zero runtime deps, and .vscodeignore', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
            const pluginManifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'app-plugin', 'plugin.json'), 'utf8'));

            expect(pkg.dependencies).toBeUndefined();
            expect(pkg.version).toBe(pluginManifest.version);
            expect(pkg.icon).toBe('assets/icon.png');
            expect(fs.existsSync(path.join(REPO_ROOT, pkg.icon))).toBe(true);
            expect(pkg.homepage).toMatch(/^https:\/\/github\.com\/AGI-is-going-to-arrive\/Antigravity-Context-Window-Monitor/);
            expect(pkg.bugs?.url).toBe('https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/issues');
            expect(pkg.galleryBanner).toEqual({ color: '#0D1014', theme: 'dark' });
            expect(pkg.categories).toEqual(['Visualization', 'Other']);
            expect(Array.isArray(pkg.keywords)).toBe(true);
            expect(pkg.keywords.length).toBeGreaterThanOrEqual(5);
            expect(pkg.scripts.package).toBe(
                `node scripts/package-app-plugin.mjs --package-vsix --baseImagesUrl https://raw.githubusercontent.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/v${pkg.version} --baseContentUrl https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/blob/v${pkg.version}`,
            );

            // 10 currencies incl. CAD
            const props = pkg.contributes.configuration.properties;
            expect(props['antigravityContextMonitor.displayCurrency'].enum).toEqual([...EXPECTED_CURRENCIES]);
            expect(props['antigravityContextMonitor.subscriptionCurrency'].enum).toEqual([...EXPECTED_CURRENCIES]);
            expect(props['antigravityContextMonitor.customFxCurrency'].enum).toEqual([...EXPECTED_CURRENCIES, null]);

            // Conflict-free keybindings (NEVER macOS system Log Out cmd+shift+q)
            const keybindings: Array<{ command: string; key: string; mac?: string }> = pkg.contributes.keybindings;
            expect(Array.isArray(keybindings)).toBe(true);
            expect(keybindings.length).toBeGreaterThanOrEqual(2);
            for (const kb of keybindings) {
                expect(kb.key.toLowerCase()).not.toBe('cmd+shift+q');
                expect((kb.mac || '').toLowerCase()).not.toBe('cmd+shift+q');
                expect(kb.key.toLowerCase()).not.toBe('ctrl+shift+q');
            }
            const detailsKb = keybindings.find((k) => k.command === 'antigravity-context-monitor.showDetails');
            expect(detailsKb?.mac).toBe('cmd+alt+m');
            expect(detailsKb?.key).toBe('ctrl+alt+m');

            // .vscodeignore strict allowlist + explicit exclusions
            const vscodeignore = fs.readFileSync(path.join(REPO_ROOT, '.vscodeignore'), 'utf8');
            const lines = vscodeignore.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
            expect(lines[0]).toBe('**');
            for (const allowed of ['!package.json', '!README.md', '!CHANGELOG.md', '!LICENSE', '!assets/icon.png', '!dist-stage/ide/extension.js']) {
                expect(lines).toContain(allowed);
            }
            for (const excluded of ['readme_CN.md', 'DESIGN.md', 'PRODUCT.md', 'docs/**', 'src/**', 'tests/**', 'scripts/**', 'app-plugin/**', 'out-tsc/**', '**/*.map']) {
                expect(lines).toContain(excluded);
            }
            expect(vscodeignore).not.toContain('!src/images/**');
            expect(vscodeignore).not.toContain('!readme_CN.md');
        });

        it('verifies all internal markdown links and heading anchors across Phase 4 docs resolve cleanly', () => {
            const docsToCheck = [
                'README.md',
                'readme_CN.md',
                'CHANGELOG.md',
                'docs/releases/1.18.0.md',
                `docs/releases/${packageManifest.version}.md`,
                'docs/architecture.md',
                'docs/telemetry-and-pricing.md',
                'docs/cdp-overlays.md',
                'AGENTS.md',
                'app-plugin/skills/context-monitor/SKILL.md',
            ];
            const headingCache = new Map<string, Set<string>>();

            for (const relDoc of docsToCheck) {
                const absDoc = path.join(REPO_ROOT, relDoc);
                const md = fs.readFileSync(absDoc, 'utf8');
                const links = extractMarkdownLinks(md);

                for (const { target } of links) {
                    if (/^(?:https?:|mailto:|sidecar:|customization:)/i.test(target)) {
                        continue;
                    }
                    const [rawFilePart, rawAnchor] = target.split('#');
                    const targetAbs = rawFilePart
                        ? path.resolve(path.dirname(absDoc), decodeURIComponent(rawFilePart))
                        : absDoc;
                    const targetRel = path.relative(REPO_ROOT, targetAbs).replace(/\\/g, '/');

                    expect(
                        fs.existsSync(targetAbs),
                        `Broken internal link in ${relDoc}: "${target}" -> missing ${targetRel}`,
                    ).toBe(true);

                    if (rawAnchor && targetAbs.endsWith('.md')) {
                        let slugs = headingCache.get(targetAbs);
                        if (!slugs) {
                            slugs = collectMarkdownHeadingSlugs(targetAbs);
                            headingCache.set(targetAbs, slugs);
                        }
                        const decodedAnchor = decodeURIComponent(rawAnchor).toLowerCase();
                        expect(
                            slugs.has(decodedAnchor),
                            `Broken anchor "#${decodedAnchor}" in ${relDoc} -> ${targetRel}`,
                        ).toBe(true);
                    }
                }
            }
        });
    });
});

describe('[app-plugin-manifest]', () => {
    const REPO_ROOT = path.resolve(__dirname, '..');

    const PLUGIN_DIR = path.join(REPO_ROOT, 'app-plugin');


    const ALLOWED_PLUGIN_MANIFEST_KEYS = new Set([
        '$schema',
        'name',
        'displayName',
        'description',
        'version',
        'disabled',
        'logo',
        'suggestedPrompts',
        'skills',
        'author',
        'homepage',
        'repository',
        'license',
        'keywords',
    ]);


    function hasUtf8Bom(filePath: string): boolean {
        const buf = fs.readFileSync(filePath);
        return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    }


    function findAgyBinary(): string | null {
        try {
            execFileSync('agy', ['--version'], { stdio: 'ignore', windowsHide: true });
            return 'agy';
        } catch {
            return null;
        }
    }


    describe('app-plugin manifest & sidecar assets', () => {
        it('has a strict schema-compliant plugin.json with zero BOM and zero unknown top-level keys', () => {
            const manifestPath = path.join(PLUGIN_DIR, 'plugin.json');
            expect(fs.existsSync(manifestPath)).toBe(true);
            expect(hasUtf8Bom(manifestPath)).toBe(false);

            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            for (const key of Object.keys(manifest)) {
                expect(ALLOWED_PLUGIN_MANIFEST_KEYS.has(key)).toBe(true);
            }

            expect(manifest.$schema).toBe('https://antigravity.google/schemas/v1/plugin.json');
            expect(manifest.name).toBe('antigravity-context-monitor');
            expect(manifest.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
            expect(manifest.displayName).toBe('Antigravity Context Monitor');
            expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
            expect(typeof manifest.description).toBe('string');
            expect(manifest.description.length).toBeGreaterThan(20);
            expect(manifest.logo).toBe('assets/logo.svg');
            expect(Array.isArray(manifest.suggestedPrompts)).toBe(true);
            expect(manifest.suggestedPrompts.length).toBe(3);
            for (const prompt of manifest.suggestedPrompts) {
                expect(typeof prompt).toBe('string');
                expect(prompt.trim().length).toBeGreaterThan(0);
            }
            expect(manifest.homepage).toMatch(/^https:\/\//);
            expect(manifest.repository).toMatch(/^https:\/\//);
            expect(manifest.license).toBe('MIT');
        });

        it('ships a square SVG logo with safe outer margin', () => {
            const logoPath = path.join(PLUGIN_DIR, 'assets', 'logo.svg');
            expect(fs.existsSync(logoPath)).toBe(true);
            expect(hasUtf8Bom(logoPath)).toBe(false);

            const svg = fs.readFileSync(logoPath, 'utf8');
            expect(svg).toContain('<svg');
            expect(svg).toContain('viewBox="0 0 128 128"');
            expect(svg).toContain('width="128"');
            expect(svg).toContain('height="128"');
        });

        it('declares dual AUX_PANE + SIDEBAR entrypoints in sidecar.json and valid main.mjs', () => {
            const sidecarDir = path.join(PLUGIN_DIR, 'sidecars', 'context_monitor');
            const sidecarJsonPath = path.join(sidecarDir, 'sidecar.json');
            const mainMjsPath = path.join(sidecarDir, 'main.mjs');

            expect(fs.existsSync(sidecarJsonPath)).toBe(true);
            expect(fs.existsSync(mainMjsPath)).toBe(true);
            expect(hasUtf8Bom(sidecarJsonPath)).toBe(false);
            expect(hasUtf8Bom(mainMjsPath)).toBe(false);

            const cfg = JSON.parse(fs.readFileSync(sidecarJsonPath, 'utf8'));
            expect(cfg.command).toBe('node');
            expect(cfg.args).toEqual(['main.mjs']);
            expect(cfg.has_web_ui).toBe(true);
            expect(cfg.restart_policy).toBe('always');
            expect(cfg.ui_config).toBeDefined();
            expect(Array.isArray(cfg.ui_config.views)).toBe(true);

            const auxView = cfg.ui_config.views.find((v: any) => v.entrypoint === 'SIDECAR_UI_ENTRYPOINT_AUX_PANE');
            const sidebarView = cfg.ui_config.views.find((v: any) => v.entrypoint === 'SIDECAR_UI_ENTRYPOINT_SIDEBAR');
            expect(auxView).toBeDefined();
            expect(auxView.path).toBe('/');
            expect(sidebarView).toBeDefined();
            expect(sidebarView.path).toBe('/full');

            // Verify main.mjs passes Node syntax check
            execFileSync(process.execPath, ['--check', mainMjsPath], { stdio: 'pipe', windowsHide: true });
        });

        it('includes a valid companion SKILL.md with frontmatter, clickable sidecar:// pill, and safe upgrade guidance', () => {
            const skillPath = path.join(PLUGIN_DIR, 'skills', 'context-monitor', 'SKILL.md');
            expect(fs.existsSync(skillPath)).toBe(true);
            expect(hasUtf8Bom(skillPath)).toBe(false);

            const md = fs.readFileSync(skillPath, 'utf8');
            expect(md.startsWith('---\n')).toBe(true);
            expect(md).toMatch(/^name:\s*context-monitor$/m);
            expect(md).toMatch(/^description:/m);
            expect(md).toContain('sidecar://antigravity-context-monitor/context_monitor/');
            expect(md).toContain('customization://antigravity-context-monitor');
            expect(md).toContain('--status');
            expect(md).toContain('--upgrade');
        });

        it('keeps app-plugin/plugin.json version aligned with root package.json', () => {
            const rootPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
            const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'plugin.json'), 'utf8'));
            expect(manifest.version).toBe(rootPkg.version);
        });

        it('ships bilingual root AGENTS.md with one-sentence install/upgrade commands and safety boundaries', () => {
            const agentsPath = path.join(REPO_ROOT, 'AGENTS.md');
            expect(fs.existsSync(agentsPath)).toBe(true);
            expect(hasUtf8Bom(agentsPath)).toBe(false);

            const md = fs.readFileSync(agentsPath, 'utf8');
            expect(md).toContain('## English');
            expect(md).toContain('## 中文');
            expect(md).toContain('AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor');
            expect(md).toContain('--from-github');
            expect(md).toContain('--upgrade');
            expect(md).toContain('--status');
            expect(md).toContain('SHA256SUMS.txt');
            expect(md).toContain('app.asar');
            expect(md).toMatch(/NEVER Kill or Force-Quit/i);
            expect(md).toContain('严禁强杀');
            expect(md).toContain('customization://antigravity-context-monitor');
            expect(md).toContain('sidecar://antigravity-context-monitor/context_monitor/');
            expect(md).toContain('antigravity-ide --install-extension');
        });

        it('passes `agy plugin validate --strict --json` with zero findings when agy CLI is installed', () => {
            const agy = findAgyBinary();
            if (!agy) {
                return;
            }
            const raw = execFileSync(agy, ['plugin', 'validate', '--strict', '--json', PLUGIN_DIR], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
            const report = JSON.parse(raw);
            expect(report.name).toBe('antigravity-context-monitor');
            expect(report.findings).toEqual([]);
            expect(report.components.sidecars).toBe(1);
            expect(report.components.skills).toBe(1);
        });
    });
});

describe('[package-app-plugin]', () => {
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

        const distDir = path.join(repoDir, 'dist');
        fs.mkdirSync(distDir, { recursive: true });
        let vsixPath: string | null = null;
        if (includeVsix) {
            vsixPath = path.join(distDir, `antigravity-context-monitor-${version}.vsix`);

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

        it('builds local App archives without replacing the release manifest when no matching VSIX exists', async () => {
            const packager = await import(PACKAGER_PATH);
            const installer = await import(INSTALLER_PATH);
            const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-pkg-test-'));
            tmpDirs.push(tmpBase);

            const version = '1.17.6';
            const { repoDir, distDir } = createFixtureRepo(tmpBase, version, false);

            const priorManifest = path.join(distDir, 'SHA256SUMS.txt');
            fs.writeFileSync(priorManifest, 'prior release\n');
            const result = packager.packageAppPlugin({ repoRoot: repoDir, distRoot: distDir });
            expect(result.version).toBe(version);
            expect(result.vsixIncluded).toBe(false);
            expect(fs.existsSync(result.zipPath)).toBe(true);
            expect(fs.existsSync(result.tarGzPath)).toBe(true);
            expect(result.checksumsPath).toBeNull();
            expect(path.dirname(result.zipPath)).toBe(path.join(distDir, 'app-only'));
            expect(fs.readFileSync(priorManifest, 'utf8')).toBe('prior release\n');

            // Strict agy validation must have 0 findings if agy CLI is installed
            expect(result.validation.ok).toBe(true);
            if (result.validation.ran) {
                expect(result.validation.findings).toEqual([]);
            }

            const parsed = installer.parseSha256Sums(packager.formatSha256Sums(result.checksums));
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

        it('includes the staged antigravity-context-monitor-<version>.vsix in dist/SHA256SUMS.txt when present', async () => {
            const packager = await import(PACKAGER_PATH);
            const installer = await import(INSTALLER_PATH);
            const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-pkg-vsix-'));
            tmpDirs.push(tmpBase);

            const version = '1.17.6';
            const { repoDir, distDir, vsixPath } = createFixtureRepo(tmpBase, version, true);
            fs.writeFileSync(vsixPath!, packager.buildZipBuffer([
                { name: 'extension/package.json', data: Buffer.from(JSON.stringify({ version })) },
            ]));

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
});

describe('[client-bundle-and-packaging]', () => {
    const REPO_ROOT = path.resolve(__dirname, '..');

    const MAIN_MJS_PATH = path.join(REPO_ROOT, 'app-plugin', 'sidecars', 'context_monitor', 'main.mjs');

    const PACKAGER_PATH = path.join(REPO_ROOT, 'scripts', 'package-app-plugin.mjs');

    const BUNDLER_PATH = path.join(REPO_ROOT, 'scripts', 'build-bundles.mjs');


    async function resolveOrBuildAppStageDir(tmpBase: string): Promise<string> {
        const existingStageDir = path.join(REPO_ROOT, 'dist-stage', 'app');
        if (
            fs.existsSync(path.join(existingStageDir, 'sidecar-bundle.js'))
            && fs.existsSync(path.join(existingStageDir, 'sidecar-server.js'))
            && fs.existsSync(path.join(existingStageDir, 'sidecar-runtime.js'))
        ) {
            return existingStageDir;
        }
        const bundler = await import(BUNDLER_PATH);
        const isolatedStageApp = path.join(tmpBase, 'isolated-stage-app');
        await bundler.buildAppSidecarBundle({ repoRoot: REPO_ROOT, stageAppDir: isolatedStageApp });
        return isolatedStageApp;
    }


    function makeWebviewVmHarness() {
        type ListenerEntry = { type: string; fn: (ev: any) => void };
        const winListeners: ListenerEntry[] = [];
        const docListeners: ListenerEntry[] = [];
        const bodyListeners: ListenerEntry[] = [];
        const postedMessages: Array<Record<string, unknown>> = [];
        let savedState: Record<string, unknown> = {};

        const createClassList = (initial: string[] = []) => {
            const set = new Set(initial);
            return {
                add: (...cls: string[]) => cls.forEach((c) => set.add(c)),
                remove: (...cls: string[]) => cls.forEach((c) => set.delete(c)),
                toggle: (c: string, force?: boolean) => {
                    const on = force === undefined ? !set.has(c) : Boolean(force);
                    if (on) { set.add(c); } else { set.delete(c); }
                    return on;
                },
                contains: (c: string) => set.has(c),
            };
        };

        class FakeElement {
            id = '';
            tagName = 'DIV';
            className = '';
            textContent = '';
            innerHTML = '';
            value = '';
            hidden = false;
            disabled = false;
            dataset: Record<string, string> = {};
            style: Record<string, string> = { setProperty: (() => {}) as any };
            attrs = new Map<string, string>();
            classList = createClassList();
            listeners: ListenerEntry[] = [];
            getAttribute(k: string) { return this.attrs.get(k) ?? null; }
            setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); }
            removeAttribute(k: string) { this.attrs.delete(k); }
            hasAttribute(k: string) { return this.attrs.has(k); }
            addEventListener(type: string, fn: (ev: any) => void) { this.listeners.push({ type, fn }); }
            removeEventListener(type: string, fn: (ev: any) => void) {
                const idx = this.listeners.findIndex((l) => l.type === type && l.fn === fn);
                if (idx >= 0) { this.listeners.splice(idx, 1); }
            }
            closest(_sel: string): any { return null; }
            querySelector(_sel: string): any { return null; }
            querySelectorAll(_sel: string): any[] { return []; }
            appendChild<T>(child: T): T {
                if (child && typeof (child as any).textContent === 'string') {
                    this.textContent += (child as any).textContent;
                }
                return child;
            }
            removeChild<T>(child: T): T { return child; }
            getBoundingClientRect() { return { left: 0, top: 0, right: 80, bottom: 28, width: 80, height: 28 }; }
            focus() {}
            scrollIntoView() {}
            scrollTo() {}
        }

        const tabOverviewBtn = new FakeElement();
        tabOverviewBtn.dataset.tab = 'overview';
        tabOverviewBtn.classList.add('active');
        const tabSettingsBtn = new FakeElement();
        tabSettingsBtn.dataset.tab = 'settings';

        const tabOverviewPane = new FakeElement();
        tabOverviewPane.id = 'tab-overview';
        tabOverviewPane.classList.add('active');
        const tabSettingsPane = new FakeElement();
        tabSettingsPane.id = 'tab-settings';

        const privacyBtn = new FakeElement();
        privacyBtn.id = 'privacyToggle';
        privacyBtn.closest = (sel: string) => (sel.includes('#privacyToggle') ? privacyBtn : null);

        const updateTimeEl = new FakeElement();
        updateTimeEl.id = 'updateTime';

        const domById = new Map<string, FakeElement>([
            ['tab-overview', tabOverviewPane],
            ['tab-settings', tabSettingsPane],
            ['privacyToggle', privacyBtn],
            ['updateTime', updateTimeEl],
        ]);

        const bodyAttrs = new Map<string, string>([
            ['data-lang', 'en'],
            ['data-privacy-default', 'true'],
            ['data-privacy-masked', 'true'],
        ]);

        const bodyEl: any = {
            style: {},
            dataset: {},
            classList: createClassList(),
            getAttribute: (k: string) => bodyAttrs.get(k) ?? null,
            setAttribute: (k: string, v: string) => { bodyAttrs.set(k, String(v)); },
            removeAttribute: (k: string) => { bodyAttrs.delete(k); },
            appendChild: <T>(c: T): T => c,
            removeChild: <T>(c: T): T => c,
            addEventListener: (type: string, fn: (ev: any) => void) => { bodyListeners.push({ type, fn }); },
            removeEventListener: (type: string, fn: (ev: any) => void) => {
                const idx = bodyListeners.findIndex((l) => l.type === type && l.fn === fn);
                if (idx >= 0) { bodyListeners.splice(idx, 1); }
            },
        };

        const docStub: any = {
            body: bodyEl,
            documentElement: { style: { setProperty: () => {} }, setAttribute: () => {}, removeAttribute: () => {} },
            getElementById: (id: string) => domById.get(id) ?? null,
            querySelector: (sel: string) => {
                if (sel === '.tab-btn.active') {
                    return tabSettingsBtn.classList.contains('active') ? tabSettingsBtn : tabOverviewBtn;
                }
                if (sel === '.update-time') {
                    return updateTimeEl;
                }
                return null;
            },
            querySelectorAll: (sel: string) => {
                if (sel === '.tab-btn') { return [tabOverviewBtn, tabSettingsBtn]; }
                if (sel === '.tab-pane') { return [tabOverviewPane, tabSettingsPane]; }
                return [];
            },
            createElement: () => new FakeElement(),
            createTextNode: (text: string) => ({ nodeType: 3, textContent: String(text) }),
            addEventListener: (type: string, fn: (ev: any) => void) => { docListeners.push({ type, fn }); },
            removeEventListener: (type: string, fn: (ev: any) => void) => {
                const idx = docListeners.findIndex((l) => l.type === type && l.fn === fn);
                if (idx >= 0) { docListeners.splice(idx, 1); }
            },
        };

        const winStub: any = {
            location: { origin: 'http://127.0.0.1:41234', href: 'http://127.0.0.1:41234/' },
            scrollY: 0,
            scrollTo: () => {},
            addEventListener: (type: string, fn: (ev: any) => void) => { winListeners.push({ type, fn }); },
            removeEventListener: (type: string, fn: (ev: any) => void) => {
                const idx = winListeners.findIndex((l) => l.type === type && l.fn === fn);
                if (idx >= 0) { winListeners.splice(idx, 1); }
            },
            requestAnimationFrame: () => 0,
            setTimeout: () => 0,
            clearTimeout: () => {},
        };

        const context = vm.createContext({
            window: winStub,
            document: docStub,
            Element: FakeElement,
            HTMLElement: FakeElement,
            URL,
            acquireVsCodeApi: () => ({
                getState: () => ({ ...savedState }),
                setState: (next: Record<string, unknown>) => { savedState = { ...next }; },
                postMessage: (msg: Record<string, unknown>) => { postedMessages.push(msg); },
            }),
            requestAnimationFrame: () => 0,
            setTimeout: () => 0,
            clearTimeout: () => {},
            navigator: {},
            console,
        });

        return {
            context,
            winStub,
            docStub,
            bodyAttrs,
            winListeners,
            docListeners,
            bodyListeners,
            postedMessages,
            tabOverviewBtn,
            tabSettingsBtn,
            tabOverviewPane,
            tabSettingsPane,
            privacyBtn,
            updateTimeEl,
            getSavedState: () => savedState,
        };
    }


    function makeCdpVmHarness() {
        class FakeNode {
            tagName: string;
            id = '';
            className = '';
            textContent = '';
            attrs = new Map<string, string>();
            style: Record<string, string> = {};
            children: FakeNode[] = [];
            parentNode: FakeNode | null = null;
            shadowRoot: FakeNode | null = null;
            listeners = new Map<string, Array<(ev: any) => void>>();
            _classes = new Set<string>();
            classList = {
                add: (...cls: string[]) => cls.forEach((c) => this._classes.add(c)),
                remove: (...cls: string[]) => cls.forEach((c) => this._classes.delete(c)),
                toggle: (c: string, force?: boolean) => {
                    const on = force === undefined ? !this._classes.has(c) : Boolean(force);
                    if (on) { this._classes.add(c); } else { this._classes.delete(c); }
                    return on;
                },
                contains: (c: string) => this._classes.has(c),
            };
            constructor(tagName = 'DIV') { this.tagName = tagName.toUpperCase(); }
            get isConnected() {
                let cur: FakeNode | null = this;
                while (cur) {
                    if (cur === docBody || cur === docEl) { return true; }
                    cur = cur.parentNode;
                }
                return false;
            }
            setAttribute(k: string, v: string) {
                this.attrs.set(k, String(v));
                if (k === 'id') { this.id = String(v); }
                if (k === 'class') { this.className = String(v); }
            }
            getAttribute(k: string) { return this.attrs.get(k) ?? null; }
            removeAttribute(k: string) { this.attrs.delete(k); }
            hasAttribute(k: string) { return this.attrs.has(k); }
            appendChild(child: FakeNode) {
                if (child.parentNode) { child.parentNode.removeChild(child); }
                child.parentNode = this;
                this.children.push(child);
                return child;
            }
            removeChild(child: FakeNode) {
                const idx = this.children.indexOf(child);
                if (idx >= 0) {
                    this.children.splice(idx, 1);
                    child.parentNode = null;
                }
                return child;
            }
            attachShadow() {
                const root = new FakeNode('#shadow-root');
                root.parentNode = this;
                this.shadowRoot = root;
                return root;
            }
            addEventListener(type: string, fn: (ev: any) => void) {
                const arr = this.listeners.get(type) || [];
                arr.push(fn);
                this.listeners.set(type, arr);
            }
            removeEventListener(type: string, fn: (ev: any) => void) {
                const arr = this.listeners.get(type) || [];
                const idx = arr.indexOf(fn);
                if (idx >= 0) { arr.splice(idx, 1); }
            }
            querySelector() { return null; }
            querySelectorAll() { return []; }
            closest() { return null; }
            contains(other: FakeNode | null) {
                let cur = other;
                while (cur) {
                    if (cur === this) { return true; }
                    cur = cur.parentNode;
                }
                return false;
            }
            getBoundingClientRect() { return { left: 100, top: 40, right: 300, bottom: 80, width: 200, height: 40 }; }
        }

        const docEl = new FakeNode('HTML');
        const docBody = new FakeNode('BODY');
        docEl.appendChild(docBody);

        function findById(root: FakeNode, id: string): FakeNode | null {
            if (root.id === id) { return root; }
            for (const c of root.children) {
                const hit = findById(c, id);
                if (hit) { return hit; }
            }
            return null;
        }

        const winListeners = new Map<string, Array<(ev: any) => void>>();
        const docStub: any = {
            documentElement: docEl,
            body: docBody,
            activeElement: null,
            getElementById: (id: string) => findById(docEl, id),
            createElement: (tag: string) => new FakeNode(tag),
            createElementNS: (_ns: string, tag: string) => new FakeNode(tag),
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener: () => {},
            removeEventListener: () => {},
        };
        const winStub: any = {
            innerWidth: 1280,
            innerHeight: 800,
            location: { origin: 'http://127.0.0.1:3000', href: 'http://127.0.0.1:3000/' },
            navigator: {},
            getComputedStyle: () => ({ backgroundColor: 'rgb(13, 16, 20)', display: 'block', visibility: 'visible', opacity: '1' }),
            addEventListener: (type: string, fn: (ev: any) => void) => {
                const arr = winListeners.get(type) || [];
                arr.push(fn);
                winListeners.set(type, arr);
            },
            removeEventListener: (type: string, fn: (ev: any) => void) => {
                const arr = winListeners.get(type) || [];
                const idx = arr.indexOf(fn);
                if (idx >= 0) { arr.splice(idx, 1); }
            },
            setTimeout: () => 0,
            clearTimeout: () => {},
            setInterval: () => 0,
            clearInterval: () => {},
            requestAnimationFrame: () => 0,
        };

        const context = vm.createContext({
            window: winStub,
            document: docStub,
            navigator: winStub.navigator,
            HTMLElement: FakeNode,
            Element: FakeNode,
            MutationObserver: class { observe() {} disconnect() {} },
            ResizeObserver: class { observe() {} disconnect() {} },
            getComputedStyle: winStub.getComputedStyle,
            setTimeout: () => 0,
            clearTimeout: () => {},
            setInterval: () => 0,
            clearInterval: () => {},
            requestAnimationFrame: () => 0,
            console,
        });

        return { context, winStub, docStub, docBody };
    }


    describe('Phase 2 Wave 2A: Toolchain, Independent Client Bundling, Packaging & CSS Cascade', () => {
        const tmpDirs: string[] = [];

        afterEach(() => {
            while (tmpDirs.length > 0) {
                const d = tmpDirs.pop();
                if (d) { fs.rmSync(d, { recursive: true, force: true }); }
            }
        });

        it('pins esbuild and @vscode/vsce strictly in devDependencies with zero runtime dependencies and isolated vscode:prepublish', () => {
            const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
            expect(pkg.dependencies).toBeUndefined();
            expect(pkg.devDependencies.esbuild).toMatch(/^\d+\.\d+\.\d+$/);
            expect(pkg.devDependencies['@vscode/vsce']).toMatch(/^\d+\.\d+\.\d+$/);
            expect(pkg.main).toBe('./dist-stage/ide/extension.js');
            expect(pkg.scripts['vscode:prepublish']).toContain('build:bundles');
            expect(pkg.scripts['vscode:prepublish']).not.toContain('tsc -p ./');
            expect(pkg.scripts.package).toBe(`node scripts/package-app-plugin.mjs --package-vsix --baseImagesUrl https://raw.githubusercontent.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/v${pkg.version} --baseContentUrl https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/blob/v${pkg.version}`);
            expect(pkg.scripts.package).not.toContain('npx');
            expect(pkg.scripts['test:dist']).toBe('node scripts/test-dist.mjs');
            expect(pkg.scripts['typecheck:client']).toContain('tsconfig.client.json');

            const vscodeignore = fs.readFileSync(path.join(REPO_ROOT, '.vscodeignore'), 'utf8');
            expect(vscodeignore).toContain('!dist-stage/ide/extension.js');
            expect(vscodeignore).toContain('!assets/icon.png');
            expect(vscodeignore).toContain('!CHANGELOG.md');
            expect(vscodeignore).toContain('readme_CN.md');
            expect(vscodeignore).not.toContain('!src/images/**');
        });

        it('eliminates Function.prototype.toString() stitching and duplicate isInsideUnfocusedPane while keeping strict CSP & injection order', () => {
            const webviewScriptSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'webview-script.ts'), 'utf8');
            expect(webviewScriptSrc).not.toMatch(/\.toString\s*\(\s*\)/);
            expect(collectPricingInputOverrides).toBe(collectSharedPricingOverrides);

            // Generated browser bundles have valid syntax, deterministic 16-hex buildIds, and zero raw </script or <!--
            expect(WEBVIEW_CLIENT_BUILD_ID).toMatch(/^[a-f0-9]{16}$/);
            expect(CDP_OVERLAY_CLIENT_BUILD_ID).toMatch(/^[a-f0-9]{16}$/);
            expect(CDP_OVERLAY_BUILD_ID).toMatch(/^[a-f0-9]{16}$/);
            expect(() => new vm.Script(WEBVIEW_CLIENT_BUNDLE)).not.toThrow();
            expect(() => new vm.Script(CDP_OVERLAY_CLIENT_BUNDLE)).not.toThrow();

            const script = getScript();
            expect(script).not.toMatch(/<\/script/i);
            expect(script).not.toContain('<!--');
            expect(() => new vm.Script(script)).not.toThrow();

            // Single unified isInsideUnfocusedPane & zero forbidden Trusted Types patterns in CDP overlay client
            const cdpMainSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'client', 'browser', 'cdp-overlay-main.ts'), 'utf8');
            expect(cdpMainSrc.match(/function\s+isInsideUnfocusedPane\b/g)).toHaveLength(1);
            for (const forbidden of [/\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /\bdocument\.write\b/, /\beval\s*\(/, /\bnew\s+Function\b/]) {
                expect(CDP_OVERLAY_CLIENT_BUNDLE).not.toMatch(forbidden);
            }

            // Exact injection order in shared document: preload -> bridge -> client
            const html = buildMonitorDocumentHtml({
                surface: 'app-sidecar',
                version: '1.17.11',
                data: null,
                modelConfigs: [],
                settings: DEFAULT_MONITOR_DOCUMENT_SETTINGS,
                extraHeadHtml: '<script id="acm-preload">window.__PRELOAD__=1;</script><script id="acm-bridge">window.__ACM_BRIDGE__={};</script>',
                now: Date.now(),
            });
            const preloadIdx = html.indexOf('window.__PRELOAD__=1;');
            const bridgeIdx = html.indexOf('window.__ACM_BRIDGE__={};');
            const clientIdx = html.indexOf('__ACM_WEBVIEW_FACTORY__.mountWebviewClient');
            expect(preloadIdx).toBeGreaterThan(-1);
            expect(bridgeIdx).toBeGreaterThan(preloadIdx);
            expect(clientIdx).toBeGreaterThan(bridgeIdx);
        });

        it('verifies WebView client first mount, idempotent second mount, update, navigation, unmount, Wave 1B guards, and same-version buildId hot reinjection', () => {
            const harness = makeWebviewVmHarness();

            // 1. First mount
            const first = vm.runInContext(getScript({ buildId: 'build-aaa-111111' }), harness.context);
            expect(first).toMatchObject({ installed: true, reused: false, buildId: 'build-aaa-111111' });
            const winCountAfterFirst = harness.winListeners.length;
            const bodyCountAfterFirst = harness.bodyListeners.length;
            expect(winCountAfterFirst).toBeGreaterThan(0);
            expect(bodyCountAfterFirst).toBeGreaterThan(0);

            // 2. Second mount with SAME buildId is idempotent (no duplicate listeners)
            const second = vm.runInContext(getScript({ buildId: 'build-aaa-111111' }), harness.context);
            expect(second).toMatchObject({ installed: true, reused: true, buildId: 'build-aaa-111111' });
            expect(harness.winListeners.length).toBe(winCountAfterFirst);
            expect(harness.bodyListeners.length).toBe(bodyCountAfterFirst);

            // 3. Wave 1B message origin guard rejects cross-origin & null-origin messages, accepts own-origin updateContent
            const msgHandlers = harness.winListeners.filter((l) => l.type === 'message').map((l) => l.fn);
            const msgCountAfterFirst = msgHandlers.length;
            expect(msgCountAfterFirst).toBeGreaterThanOrEqual(1);
            for (const fn of msgHandlers) {
                fn({ origin: 'https://evil.example', data: { command: 'updateTabs', tabs: { overview: 'HACKED' }, time: 'HACKED' } });
                fn({ origin: 'null', data: { command: 'updateTabs', tabs: { overview: 'NULL_ORIGIN' }, time: 'NULL_ORIGIN' } });
            }
            expect(harness.updateTimeEl.textContent).toBe('');
            expect(harness.tabOverviewPane.innerHTML).toBe('');
            for (const fn of msgHandlers) {
                fn({ origin: 'http://127.0.0.1:41234', data: { command: 'updateTabs', tabs: { overview: '<p>Live</p>' }, time: '19:10:00', privacyMasked: false } });
            }
            expect(harness.tabOverviewPane.innerHTML).toBe('<p>Live</p>');
            expect(harness.updateTimeEl.textContent.trim()).toBe('19:10:00');
            expect(harness.bodyAttrs.get('data-privacy-masked')).toBe('false');

            // 4. Tab navigation updates active tab & persists state
            const settingsClick = harness.tabSettingsBtn.listeners.find((l) => l.type === 'click');
            expect(settingsClick).toBeDefined();
            settingsClick!.fn({ preventDefault: () => {} });
            expect(harness.tabSettingsBtn.classList.contains('active')).toBe(true);
            expect(harness.tabSettingsPane.classList.contains('active')).toBe(true);
            expect(harness.getSavedState().activeTab).toBe('settings');

            // 5. Same-version buildId hot reinjection unmounts old listeners cleanly and mounts new buildId
            const reinjected = vm.runInContext(getScript({ buildId: 'build-bbb-222222' }), harness.context);
            expect(reinjected).toMatchObject({ installed: true, reused: false, buildId: 'build-bbb-222222' });
            expect(harness.winListeners.filter((l) => l.type === 'message')).toHaveLength(msgCountAfterFirst);

            // 6. Clean unmount detaches all tracked listeners
            reinjected.unmount();
            expect(harness.winListeners).toHaveLength(0);
            expect(harness.docListeners).toHaveLength(0);
            expect(harness.bodyListeners).toHaveLength(0);
        });

        it('verifies CDP overlay first mount, idempotent second mount, update, unmount, and same-version buildId hot reinjection', () => {
            const harness = makeCdpVmHarness();
            const samplePayload: any = {
                version: CDP_OVERLAY_SCRIPT_VERSION,
                language: 'en',
                updatedAt: Date.now(),
                contextUsed: 120_000,
                contextLimit: 512_000,
                usagePercent: 23.4,
                modelName: 'Gemini 4 Pro',
                quotaPools: [],
            };

            // 1. First mount
            const m1 = vm.runInContext(
                buildOverlayBootstrapScript({ scriptVersion: CDP_OVERLAY_SCRIPT_VERSION, buildId: 'cdp-hash-11111111' }),
                harness.context,
            );
            expect(m1).toMatchObject({
                installed: true,
                reused: false,
                version: CDP_OVERLAY_SCRIPT_VERSION,
                buildId: 'cdp-hash-11111111',
            });

            // 2. Idempotent second mount with same semver AND same buildId
            const m2 = vm.runInContext(
                buildOverlayBootstrapScript({ scriptVersion: CDP_OVERLAY_SCRIPT_VERSION, buildId: 'cdp-hash-11111111' }),
                harness.context,
            );
            expect(m2).toMatchObject({ installed: true, reused: true, buildId: 'cdp-hash-11111111' });

            // 3. Apply state mounts topBar host in Shadow DOM & detects buildId mismatch when requested
            const upOk = vm.runInContext(
                buildOverlayUpdateScript(samplePayload, { appComposerRingEnabled: false, appTopBarEnabled: true }, { expectedBuildId: 'cdp-hash-11111111' }),
                harness.context,
            );
            expect(upOk).toMatchObject({ ok: true, topBarMounted: true, buildId: 'cdp-hash-11111111' });
            expect(harness.docStub.getElementById(CDP_TOPBAR_HOST_ID)).not.toBeNull();

            const upDrift = vm.runInContext(
                buildOverlayUpdateScript(samplePayload, { appComposerRingEnabled: false, appTopBarEnabled: true }, { expectedBuildId: 'cdp-hash-22222222' }),
                harness.context,
            );
            expect(upDrift).toMatchObject({ ok: false, missingRuntime: true, buildIdMismatch: true });

            // 4. Same-version rebuild (SAME semver, NEW buildId) MUST hot-reinject instead of reusing!
            const m3 = vm.runInContext(
                buildOverlayBootstrapScript({ scriptVersion: CDP_OVERLAY_SCRIPT_VERSION, buildId: 'cdp-hash-22222222' }),
                harness.context,
            );
            expect(m3).toMatchObject({
                installed: true,
                reused: false,
                version: CDP_OVERLAY_SCRIPT_VERSION,
                buildId: 'cdp-hash-22222222',
            });
            expect(harness.winStub[CDP_RUNTIME_GLOBAL_KEY].buildId).toBe('cdp-hash-22222222');

            // 5. Unmount cleans both Shadow DOM hosts
            const unmounted = vm.runInContext(buildOverlayUnmountScript('all'), harness.context);
            expect(unmounted).toMatchObject({ ok: true, unmounted: 'all' });
            expect(harness.docStub.getElementById(CDP_COMPOSER_HOST_ID)).toBeNull();
            expect(harness.docStub.getElementById(CDP_TOPBAR_HOST_ID)).toBeNull();
        });

        it('loads swarm manifests from the host profile independently of the plugin executable data directory', async () => {
            const main = await import(MAIN_MJS_PATH);
            const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-host-profile-'));
            tmpDirs.push(homeDir);
            const runtimePath = path.join(homeDir, 'capture-options.cjs');
            fs.writeFileSync(runtimePath, `
                exports.createSidecarRuntimeProvider = (options) => ({
                    renderHtml() {}, getSnapshot() {}, handleAction() {}, pollNow() {},
                    getState: () => options,
                });
            `);
            const resolveStartupBrain = async () => {
                const provider = await main.loadRealProvider({ runtimePath }, '1.18.0');
                return resolveScopedBrainRoot({ ...provider.getState(), homeDir, env: {} });
            };
            try {
                vi.stubEnv('ANTIGRAVITY_EXECUTABLE_DATA_DIR', path.join(homeDir, 'sidecar_data', 'monitor', 'data'));
                vi.stubEnv('ANTIGRAVITY_BRAIN_DIR', undefined);
                vi.stubEnv('ANTIGRAVITY_DATA_DIR', undefined);
                expect(await resolveStartupBrain()).toBe(path.join(homeDir, '.gemini', 'antigravity', 'brain'));
                vi.stubEnv('ANTIGRAVITY_DATA_DIR', path.join(homeDir, 'profile'));
                expect(await resolveStartupBrain()).toBe(path.join(homeDir, 'profile', 'brain'));
                vi.stubEnv('ANTIGRAVITY_BRAIN_DIR', path.join(homeDir, 'custom-brain'));
                expect(await resolveStartupBrain()).toBe(path.join(homeDir, 'custom-brain'));
            } finally {
                vi.unstubAllEnvs();
            }
        });

        it('enforces positive real-provider verification in main.mjs (fails explicitly, never runs silent fallback shell)', async () => {
            const mainMod = await import(MAIN_MJS_PATH);
            const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-provider-check-'));
            tmpDirs.push(tmpBase);

            // Bundled runtime MUST export ACM_REAL_PROVIDER === true
            const stageAppDir = await resolveOrBuildAppStageDir(tmpBase);
            const stageRuntimePath = path.join(stageAppDir, 'sidecar-runtime.js');
            expect(fs.existsSync(stageRuntimePath)).toBe(true);
            const bundledRuntime = require(stageRuntimePath);
            expect(bundledRuntime.ACM_REAL_PROVIDER).toBe(true);
            expect(typeof bundledRuntime.ACM_BUILD_ID).toBe('string');
            expect(bundledRuntime.ACM_BUILD_ID.length).toBeGreaterThanOrEqual(8);

            // 1. Missing sidecar-runtime.js must reject explicitly
            await expect(
                mainMod.loadRealProvider({ layout: 'packaged', isBundled: true, serverPath: null, runtimePath: null, buildId: null }, '1.17.11'),
            ).rejects.toThrow(/Missing real sidecar runtime provider/i);

            // 2. Bundled runtime missing ACM_REAL_PROVIDER === true must reject explicitly
            const fakeRuntimeDir = path.join(tmpBase, 'sidecars', 'context_monitor', 'runtime', 'out', 'app');
            fs.mkdirSync(fakeRuntimeDir, { recursive: true });
            fs.writeFileSync(path.join(fakeRuntimeDir, 'sidecar-bundle.js'), 'module.exports = {};\n', 'utf8');
            fs.writeFileSync(
                path.join(fakeRuntimeDir, 'sidecar-runtime.js'),
                'module.exports = { createSidecarRuntimeProvider() { return { renderHtml() {}, getSnapshot() {}, handleAction() {}, pollNow() {}, getState() {} }; } };\n',
                'utf8',
            );
            await expect(
                mainMod.loadRealProvider(
                    { layout: 'packaged', isBundled: true, serverPath: null, runtimePath: path.join(fakeRuntimeDir, 'sidecar-runtime.js'), buildId: null },
                    '1.17.11',
                    path.join(tmpBase, 'sidecars', 'context_monitor'),
                ),
            ).rejects.toThrow(/ACM_REAL_PROVIDER === true/);

            // 3. Runtime returning fallback shell (missing pollNow/getState) must reject explicitly
            const fallbackShellPath = path.join(fakeRuntimeDir, 'fallback-shell-runtime.js');
            fs.writeFileSync(
                fallbackShellPath,
                'module.exports = { ACM_REAL_PROVIDER: true, createSidecarRuntimeProvider() { return { renderHtml() {}, getSnapshot() {}, handleAction() {} }; } };\n',
                'utf8',
            );
            await expect(
                mainMod.loadRealProvider(
                    { layout: 'packaged', isBundled: true, serverPath: null, runtimePath: fallbackShellPath, buildId: null },
                    '1.17.11',
                    path.join(tmpBase, 'sidecars', 'context_monitor'),
                ),
            ).rejects.toThrow(/missing methods: pollNow, getState/i);

            // 4. End-to-end subprocess: broken runtime exits non-zero instead of binding fallback shell
            const brokenPluginDir = path.join(tmpBase, 'broken-plugin');
            const brokenSidecarDir = path.join(brokenPluginDir, 'sidecars', 'context_monitor');
            const brokenAppDir = path.join(brokenSidecarDir, 'runtime', 'out', 'app');
            fs.mkdirSync(brokenAppDir, { recursive: true });
            fs.copyFileSync(MAIN_MJS_PATH, path.join(brokenSidecarDir, 'main.mjs'));
            fs.writeFileSync(path.join(brokenSidecarDir, 'runtime', 'package.json'), JSON.stringify({ version: '1.17.11', bundled: true }), 'utf8');
            fs.writeFileSync(path.join(brokenAppDir, 'sidecar-server.js'), 'module.exports = { startStandaloneServer() { throw new Error("should not start"); } };\n', 'utf8');
            fs.writeFileSync(path.join(brokenAppDir, 'sidecar-runtime.js'), 'throw new Error("corrupted runtime chunk");\n', 'utf8');

            const proc = spawnSync(process.execPath, [path.join(brokenSidecarDir, 'main.mjs'), '--standalone-port=0'], {
                encoding: 'utf8',
                env: {
                    ...process.env,
                    ANTIGRAVITY_SIDECAR_WEB_PORT: '',
                    ANTIGRAVITY_LS_ADDRESS: '',
                    ANTIGRAVITY_CSRF_TOKEN: '',
                },
                timeout: 8000,
            });
            expect(proc.status).not.toBe(0);
            expect(proc.stderr).toContain('corrupted runtime chunk');
            expect(proc.stderr).toContain('Refusing to fall back');
        });

        it('automatically applies strict size limits to v1.18 candidates and later releases', async () => {
            const { requiresReleaseSize } = await import(PACKAGER_PATH);
            expect(requiresReleaseSize('1.17.11')).toBe(false);
            for (const version of ['1.18.0-rc.1', '1.19.0', '2.0.0']) {
                expect(requiresReleaseSize(version)).toBe(true);
            }
            expect(() => requiresReleaseSize('')).toThrow();
        });

        it('enforces allowlist packaging, --require-all 3-artifact SHA256SUMS.txt, buildId metadata, and size ceilings', async () => {
            const packager = await import(PACKAGER_PATH);
            const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-allowlist-pkg-'));
            tmpDirs.push(tmpBase);

            const repoDir = path.join(tmpBase, 'repo');
            const distDir = path.join(repoDir, 'dist');
            const stageAppDir = await resolveOrBuildAppStageDir(tmpBase);
            fs.cpSync(path.join(REPO_ROOT, 'app-plugin'), path.join(repoDir, 'app-plugin'), { recursive: true });
            fs.cpSync(stageAppDir, path.join(repoDir, 'dist-stage', 'app'), { recursive: true });
            // Place banned legacy PNG + sourcemap files in repo to prove allowlist ignores them
            fs.mkdirSync(path.join(repoDir, 'src', 'images'), { recursive: true });
            fs.writeFileSync(path.join(repoDir, 'src', 'images', 'monitor-overview.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
            fs.writeFileSync(path.join(repoDir, 'app-plugin', 'extra-unlisted.txt'), 'must-not-be-packaged', 'utf8');

            // 1. requireAll without VSIX MUST hard-fail
            expect(() => packager.packageAppPlugin({
                repoRoot: repoDir,
                distRoot: distDir,
                requireAll: true,
                requireBundled: true,
                skipValidation: true,
            })).toThrow(/Missing required IDE VSIX artifact/);

            // 2. With valid synthetic VSIX ZIP -> succeeds with exact 3 artifacts + 9 allowlisted App files + buildId
            fs.mkdirSync(distDir, { recursive: true });
            const vsixPath = path.join(distDir, `antigravity-context-monitor-${JSON.parse(fs.readFileSync(path.join(repoDir, 'app-plugin/plugin.json'), 'utf8')).version}.vsix`);
            const syntheticVsixBuf = packager.buildZipBuffer([
                { name: 'extension/package.json', data: Buffer.from('{"name":"antigravity-context-monitor","version":"1.17.11"}') },
                { name: 'extension/dist-stage/ide/extension.js', data: Buffer.from('module.exports={activate(){}};') },
            ]);
            fs.writeFileSync(vsixPath, syntheticVsixBuf);

            const result = packager.packageAppPlugin({
                repoRoot: repoDir,
                distRoot: distDir,
                requireAll: true,
                requireBundled: true,
                skipValidation: true,
            });
            expect(result.runtimeMode).toBe('bundled');
            expect(result.entryCount).toBe(10);
            expect(result.bundledImages).toEqual([]);
            expect(result.vsixIncluded).toBe(true);
            expect(result.checksums).toHaveLength(3);
            expect(result.buildId).toMatch(/^[a-f0-9]{16}$/);
            expect(fs.existsSync(path.join(result.stageDir, 'extra-unlisted.txt'))).toBe(false);
            expect(fs.existsSync(path.join(result.stageDir, 'bin', 'agy-statusline.mjs'))).toBe(true);
            const inspectedAppZip = packager.inspectZipBuffer(fs.readFileSync(result.zipPath));
            const statuslineEntry = inspectedAppZip.entries.find((e: { name: string }) => e.name === 'antigravity-context-monitor/bin/agy-statusline.mjs');
            expect(statuslineEntry).toBeDefined();
            expect(statuslineEntry.mode & 0o111).not.toBe(0);

            const runtimePkg = JSON.parse(
                fs.readFileSync(path.join(result.stageDir, 'sidecars', 'context_monitor', 'runtime', 'package.json'), 'utf8'),
            );
            expect(runtimePkg.buildId).toBe(result.buildId);
            expect(runtimePkg.bundled).toBe(true);

            // 3. Size ceiling breach MUST hard-fail (both custom/App ZIP and --strict-size release VSIX gate)
            expect(() => packager.packageAppPlugin({
                repoRoot: repoDir,
                distRoot: distDir,
                requireAll: true,
                requireBundled: true,
                skipValidation: true,
                sizeCeilings: { appZipMaxBytes: 1024 },
            })).toThrow(/App ZIP size ceiling exceeded/);

            const largeVsixBuf = packager.buildZipBuffer([
                { name: 'extension/package.json', data: Buffer.from('{"name":"antigravity-context-monitor","version":"1.18.0"}') },
                { name: 'extension/dist-stage/ide/extension.js', data: Buffer.alloc(1_650_000, 'a') },
            ]);
            fs.writeFileSync(vsixPath, largeVsixBuf);
            expect(() => packager.packageAppPlugin({
                repoRoot: repoDir,
                distRoot: distDir,
                requireAll: true,
                requireBundled: true,
                strictSize: true,
                skipValidation: true,
            })).toThrow(/VSIX uncompressed size ceiling exceeded/);
            // Within calibrated v1.18.0 release ceiling (<= 1.55 MB uncompressed, <= 560 KB compressed)
            const validReleaseVsixBuf = packager.buildZipBuffer([
                { name: 'extension/package.json', data: Buffer.from('{"name":"antigravity-context-monitor","version":"1.18.0"}') },
                { name: 'extension/dist-stage/ide/extension.js', data: Buffer.alloc(1_500_000, 'a') },
            ]);
            fs.writeFileSync(vsixPath, validReleaseVsixBuf);
            const releaseRes = packager.packageAppPlugin({
                repoRoot: repoDir,
                distRoot: distDir,
                requireAll: true,
                requireBundled: true,
                skipValidation: true,
            });
            expect(releaseRes.vsixIncluded).toBe(true);

            const checksumsBefore = fs.readFileSync(result.checksumsPath);
            fs.appendFileSync(path.join(repoDir, 'app-plugin/sidecars/context_monitor/main.mjs'), '\n// changed launcher');
            expect(() => packager.packageAppPlugin({
                repoRoot: repoDir, distRoot: distDir, requireAll: true, skipValidation: true,
            })).toThrow(/buildId\/version/);
            expect(fs.readFileSync(result.checksumsPath)).toEqual(checksumsBefore);

        });

        it('eliminates duplicate getOrchestratorAttributionStyles() injection and preserves 4-theme & focus-ring CSS cascade', () => {
            const html = buildMonitorDocumentHtml({
                surface: 'ide',
                version: '1.17.11',
                data: null,
                modelConfigs: [],
                settings: DEFAULT_MONITOR_DOCUMENT_SETTINGS,
                now: Date.now(),
            });
            // getGMDataTabStyles() must no longer double-inject getOrchestratorAttributionStyles()
            expect(getGMDataTabStyles()).not.toContain('.orch-split-card');
            expect((html.match(/\.orch-split-head\s*\{/g) || [])).toHaveLength(1);

            const baseCss = getStyles();
            const editorialCss = getEditorialStyles();
            for (const css of [baseCss, editorialCss]) {
                expect((css.match(/\{/g) || []).length).toBe((css.match(/\}/g) || []).length);
                expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/SimSun|Songti|宋体/i);
            }

            // 4 themes, tooltip neutralization, focus rings, and responsive .stg-card padding preserved
            expect(baseCss).toContain('[data-tooltip]::after');
            expect(editorialCss).toContain('[data-tooltip]::after');
            expect(editorialCss).toContain('[data-acm-theme="light"]');
            expect(editorialCss).toContain('[data-acm-theme="hc"]');
            expect(editorialCss).toContain('[data-acm-theme="hc-light"]');
            expect(editorialCss).toContain('.rich-tip-disabled-wrap');
            expect(editorialCss).toMatch(/body\s+\.acm-rich-tip-close:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--ed-accent\)/);
            expect(editorialCss).toMatch(/body\s+\.jargon-tip:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--ed-accent\)/);
            expect(editorialCss).not.toMatch(/body\s+\.tab-pane\s+\.stg-card\s*\{/);
        });

        it('round-trips pooled UTF-8 resources, template substitutions, object keys and tagged raw escapes', async () => {
            const { packStaticText, sanitizeInlineScriptBundle } = await import(BUNDLER_PATH);
            const value = '监控面板 – '.repeat(24);
            const literal = JSON.stringify(value);
            const source = [
                'const key = ' + literal + ';',
                'function label(){return' + literal + '}',
                'const lookup = {' + literal + ': label()};',
                'const nested = `' + value + '${lookup[key]}' + value + '`;',
                'const raw = String.raw`' + value + '\\u1234`;',
                'module.exports = [label(), nested, raw];',
            ].join('\n');
            function evaluate(code: string) {
                const context = { module: { exports: [] }, require, Buffer };
                vm.runInNewContext(code, context);
                return Array.from(context.module.exports);
            }
            const closingTag = 'module.exports = ["</ScRiPt>"];';
            expect(evaluate(sanitizeInlineScriptBundle(closingTag))).toEqual(evaluate(closingTag));
            expect(evaluate(packStaticText(source))).toEqual(evaluate(source));
        });

        it('conservatively compacts static HTML/CSS templates while strictly preserving <pre>/<code>/<textarea>/attributes/${...}', async () => {
            const bundler = await import(BUNDLER_PATH);
            const sampleTs = [
                'export function renderSample(name: string) {',
                '  return `',
                '    <!-- strip me -->',
                '    <div   class="card   wide"   data-note="keep   spaces\ninside   attr">',
                '      <span>Hello</span>',
                '      <span>${name}</span>',
                '      <pre>  line 1\n    line 2  </pre>',
                '      <code>  a   +   b  </code>',
                '      <textarea>  keep\n  exact  </textarea>',
                '      <style>',
                '        .card { color: #ffffff; margin: 0px; }',
                '      </style>',
                '    </div>',
                '  `;',
                '}',
            ].join('\n');

            const compacted = bundler.compactHtmlTemplatesInTsSource(sampleTs, 'src/webview-sample.ts');
            expect(compacted.length).toBeLessThan(sampleTs.length);
            expect(compacted).not.toContain('<!-- strip me -->');
            expect(compacted).toContain('class="card   wide"');
            expect(compacted).toContain('data-note="keep   spaces\ninside   attr"');
            expect(compacted).toContain('<span>Hello</span> <span>${name}</span>');
            expect(compacted).toContain('<pre>  line 1\n    line 2  </pre>');
            expect(compacted).toContain('<code>  a   +   b  </code>');
            expect(compacted).toContain('<textarea>  keep\n  exact  </textarea>');
            expect(compacted).toContain('<style>.card{color:#fff;margin:0}</style>');
        });

        it('losslessly compacts platform scripts, minifies staged main.mjs without mutating source, and reports top-10 metafile contributors', async () => {
            const bundler = await import(BUNDLER_PATH);
            const packager = await import(PACKAGER_PATH);

            // 1. Platform script template compactor preserves valid macOS bash -n, Linux sh -n, plist & SVG
            const coreSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'core', 'cdp-launcher-core.ts'), 'utf8');
            const compactedCore = bundler.compactScriptTemplatesInTsSource(coreSrc, 'src/core/cdp-launcher-core.ts');
            expect(compactedCore.length).toBeLessThan(coreSrc.length);

            const launcherSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'app', 'cdp-launcher.ts'), 'utf8');
            const compactedLauncher = bundler.compactScriptTemplatesInTsSource(launcherSrc, 'src/app/cdp-launcher.ts');
            expect(compactedLauncher.length).toBeLessThan(launcherSrc.length);

            // 2. Staged main.mjs is minified in packaged App ZIP while git source stays readable,
            //    and VSIX .png allowlist exempts ONLY extension/assets/icon.png (banning legacy PNGs).
            const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-p3c-pkg-'));
            tmpDirs.push(tmpBase);
            const repoDir = path.join(tmpBase, 'repo');
            const distDir = path.join(repoDir, 'dist');
            const stageAppDir = await resolveOrBuildAppStageDir(tmpBase);
            fs.cpSync(path.join(REPO_ROOT, 'app-plugin'), path.join(repoDir, 'app-plugin'), { recursive: true });
            fs.cpSync(stageAppDir, path.join(repoDir, 'dist-stage', 'app'), { recursive: true });

            const stageManifest = JSON.parse(fs.readFileSync(path.join(stageAppDir, 'manifest.json'), 'utf8'));
            expect(Array.isArray(stageManifest.topInputs)).toBe(true);
            expect(stageManifest.topInputs.length).toBeGreaterThan(0);
            expect(stageManifest.topInputs.length).toBeLessThanOrEqual(10);

            fs.mkdirSync(distDir, { recursive: true });
            const vsixPath = path.join(distDir, `antigravity-context-monitor-${JSON.parse(fs.readFileSync(path.join(repoDir, 'app-plugin/plugin.json'), 'utf8')).version}.vsix`);
            const vsixWithAllowedIcon = packager.buildZipBuffer([
                { name: 'extension/package.json', data: Buffer.from('{"name":"antigravity-context-monitor","version":"1.17.11"}') },
                { name: 'extension/dist-stage/ide/extension.js', data: Buffer.from('module.exports={activate(){}};') },
                { name: 'extension/readme.md', data: Buffer.from('# Short README\n') },
                { name: 'extension/assets/icon.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
            ]);
            fs.writeFileSync(vsixPath, vsixWithAllowedIcon);

            const pkgRes = packager.packageAppPlugin({
                repoRoot: repoDir,
                distRoot: distDir,
                requireAll: true,
                requireBundled: true,
                skipValidation: true,
            });
            expect(pkgRes.sizes.appZipBytes).toBeLessThanOrEqual(576_716);
            expect(pkgRes.mainMjsStats?.minified).toBe(true);
            expect(pkgRes.mainMjsStats?.afterBytes).toBeLessThan(pkgRes.mainMjsStats?.beforeBytes);
            // Source main.mjs in git repo must stay readable (unmodified)
            expect(fs.readFileSync(MAIN_MJS_PATH, 'utf8').length).toBeGreaterThan(pkgRes.mainMjsStats.afterBytes);
            expect(pkgRes.sizes.vsix?.readmeTrimmed).toBe(true);
            expect(pkgRes.sizes.vsix?.gateProfile).toBe('strict-release');

            // Legacy PNG inside VSIX MUST still be rejected
            const vsixWithBannedPng = packager.buildZipBuffer([
                { name: 'extension/package.json', data: Buffer.from('{"name":"antigravity-context-monitor","version":"1.17.11"}') },
                { name: 'extension/src/images/monitor-overview.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
            ]);
            fs.writeFileSync(vsixPath, vsixWithBannedPng);
            expect(() => packager.packageAppPlugin({
                repoRoot: repoDir,
                distRoot: distDir,
                requireAll: true,
                requireBundled: true,
                skipValidation: true,
            })).toThrow(/VSIX allowlist audit failed: banned file/);
        });
    });
});

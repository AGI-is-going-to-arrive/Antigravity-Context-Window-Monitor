import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

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

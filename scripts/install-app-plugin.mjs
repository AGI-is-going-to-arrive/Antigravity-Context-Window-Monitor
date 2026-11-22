#!/usr/bin/env node
/**
 * Cross-platform installer & uninstaller for the Antigravity App Sidecar plugin.
 *
 * Pure Node.js, zero external npm deps, macOS / Windows / Linux compatible.
 * Never creates brittle `_npx` symlinks, never writes UTF-8 BOM, and never
 * hand-edits `~/.gemini/config/config.json`.
 *
 * Usage:
 *   node scripts/install-app-plugin.mjs [--install] [--uninstall]
 *                                       [--source <dir>] [--target <dir>]
 *                                       [--dry-run] [--help]
 */

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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PLUGIN_DIR_NAME = 'antigravity-context-monitor';

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

export function parseInstallerArgs(argv) {
    const opts = {
        action: 'install',
        source: null,
        target: null,
        dryRun: false,
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--install') {
            opts.action = 'install';
        } else if (arg === '--uninstall') {
            opts.action = 'uninstall';
        } else if (arg === '--dry-run') {
            opts.dryRun = true;
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
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }
    return opts;
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

function detectSourceDir(explicitSource, repoRoot = REPO_ROOT) {
    if (explicitSource) {
        if (!existsSync(join(explicitSource, 'plugin.json'))) {
            throw new Error(`Invalid --source directory (missing plugin.json): ${explicitSource}`);
        }
        return { dir: explicitSource, needsRuntimeCopy: !existsSync(join(explicitSource, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js')) };
    }
    const staged = join(repoRoot, 'dist', 'antigravity-context-monitor-app');
    if (existsSync(join(staged, 'plugin.json'))) {
        return { dir: staged, needsRuntimeCopy: false };
    }
    // Check if script sits directly inside an extracted plugin bundle
    if (existsSync(join(__dirname, 'plugin.json'))) {
        return { dir: __dirname, needsRuntimeCopy: false };
    }
    const repoAppPlugin = join(repoRoot, 'app-plugin');
    if (existsSync(join(repoAppPlugin, 'plugin.json'))) {
        return { dir: repoAppPlugin, needsRuntimeCopy: true };
    }
    throw new Error('Could not locate plugin source directory. Pass --source <path> or run `node scripts/package-app-plugin.mjs` first.');
}

export function runInstaller(options = {}) {
    const repoRoot = options.repoRoot || REPO_ROOT;
    const action = options.action || 'install';
    const targetDir = options.target || getDefaultTargetDir();
    const dryRun = Boolean(options.dryRun);

    if (action === 'uninstall') {
        const existed = existsSync(targetDir);
        if (!dryRun && existed) {
            rmSync(targetDir, { recursive: true, force: true });
        }
        return {
            action: 'uninstall',
            targetDir,
            dryRun,
            existed,
            removed: existed && !dryRun,
        };
    }

    const { dir: sourceDir, needsRuntimeCopy } = detectSourceDir(options.source, repoRoot);
    const outSrc = join(repoRoot, 'out');
    const imagesSrc = join(repoRoot, 'src', 'images');

    if (needsRuntimeCopy && !existsSync(join(outSrc, 'app', 'sidecar-server.js'))) {
        throw new Error(
            'Compiled runtime not found at out/app/sidecar-server.js. ' +
            'Run `npm run compile` (or `node scripts/package-app-plugin.mjs`) before installing.'
        );
    }

    const manifest = JSON.parse(readFileSync(join(sourceDir, 'plugin.json'), 'utf8').replace(/^\uFEFF/, ''));
    const version = String(manifest.version || '1.17.5').trim();

    if (!dryRun) {
        rmSync(targetDir, { recursive: true, force: true });
        copyDirectoryRealFiles(sourceDir, targetDir);

        if (needsRuntimeCopy) {
            const runtimeDir = join(targetDir, 'sidecars', 'context_monitor', 'runtime');
            copyDirectoryRealFiles(outSrc, join(runtimeDir, 'out'), (_p, name, st) => st.isDirectory() || (name.endsWith('.js') && !name.endsWith('.map')));
            if (existsSync(imagesSrc)) {
                copyDirectoryRealFiles(imagesSrc, join(runtimeDir, 'src', 'images'), (_p, name, st) => st.isDirectory() || /^[a-z0-9-]+\.png$/.test(name));
            }
            const runtimePkg = {
                name: 'antigravity-context-monitor-app-runtime',
                version,
                private: true,
                license: 'MIT',
            };
            writeFileSync(join(runtimeDir, 'package.json'), JSON.stringify(runtimePkg, null, 2) + '\n', 'utf8');
        }
    }

    return {
        action: 'install',
        sourceDir,
        targetDir,
        version,
        dryRun,
        bundledRuntime: needsRuntimeCopy,
    };
}

function printHelp() {
    console.log(`Antigravity Context Monitor — App Plugin Installer / Antigravity 应用插件安装脚本

Usage:
  node scripts/install-app-plugin.mjs [options]

Options:
  --install          Install or upgrade the plugin (default)
  --uninstall        Remove the installed plugin directory
  --source <dir>     Explicit plugin directory containing plugin.json
  --target <dir>     Override install path (default: ~/.gemini/config/plugins/antigravity-context-monitor)
  --dry-run          Preview actions without touching the filesystem
  -h, --help         Show this help message`);
}

function printBilingualNextSteps(result) {
    if (result.action === 'uninstall') {
        console.log(result.dryRun
            ? `[dry-run] Would remove: ${result.targetDir}`
            : (result.existed
                ? `Uninstalled Antigravity Context Monitor plugin from:\n  ${result.targetDir}\n已卸载 Antigravity Context Monitor 插件。`
                : `Plugin was not installed at:\n  ${result.targetDir}\n未在目标目录发现已安装的插件。`));
        return;
    }

    if (result.dryRun) {
        console.log(`[dry-run] Would install v${result.version}:`);
        console.log(`  Source: ${result.sourceDir}`);
        console.log(`  Target: ${result.targetDir}`);
        return;
    }

    console.log(`
✓ Installed Antigravity Context Monitor App Plugin (v${result.version})
  Path: ${result.targetDir}

Next steps (English):
  1. In Antigravity App, open Customizations > Installed (or click:
     customization://antigravity-context-monitor) and confirm the plugin & Context Monitor sidecar are enabled.
  2. Open the monitor from the side panel '+' menu (AUX_PANE), from Plugins in the left sidebar (SIDEBAR),
     or by asking the agent to open Context Monitor (sidecar://antigravity-context-monitor/context_monitor/).
  3. Upgrading an existing install? Toggle the plugin off/on in Customizations (or restart Antigravity App /
     refresh servers) so the running sidecar reloads the updated runtime.

后续步骤（中文）：
  1. 在 Antigravity App 中打开「自定义 > 已安装」（或访问 customization://antigravity-context-monitor），
     确认插件及 Context Monitor Sidecar 已启用。
  2. 可通过侧边栏「+」菜单（AUX_PANE）、左侧导航「Plugins」（SIDEBAR 宽屏视图）
     或对话中点击 sidecar://antigravity-context-monitor/context_monitor/ 打开监控面板。
  3. 若为升级覆盖安装，请在自定义页面关闭再重新开启插件（或重启 Antigravity App）以加载新版本运行时。
`.trim());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const opts = parseInstallerArgs(process.argv.slice(2));
        if (opts.help) {
            printHelp();
            process.exit(0);
        }
        const result = runInstaller(opts);
        printBilingualNextSteps(result);
    } catch (err) {
        console.error(`[install-app-plugin] ERROR: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
}

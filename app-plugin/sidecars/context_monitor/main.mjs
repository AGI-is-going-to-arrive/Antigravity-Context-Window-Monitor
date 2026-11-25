#!/usr/bin/env node
/**
 * Antigravity App native Sidecar entrypoint for Antigravity Context Monitor.
 *
 * Zero external npm dependencies — runs directly on Antigravity App's bundled
 * Node.js runtime (`"command": "node"`, Node v24+) across macOS, Windows, and Linux.
 *
 * Supports two runtime modes:
 *   1. Antigravity App Sidecar mode (`ANTIGRAVITY_SIDECAR_WEB_PORT` set):
 *      imports `sidecar_sdk` (auto-injected by Antigravity) and serves:
 *        - GET  /             -> AUX_PANE side panel UI
 *        - GET  /full         -> SIDEBAR full-pane UI
 *        - GET  /api/health   -> health metadata
 *        - GET  /api/snapshot -> ETag-diffed telemetry snapshot
 *        - POST /api/action   -> UI action dispatcher
 *   2. Standalone loopback HTTP mode (`--standalone-port <port>` or no sidecar env):
 *      binds strictly to `127.0.0.1` for local debugging and headless tests.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Suppress noisy Node experimental warnings (e.g. node:sqlite) cleanly.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
    const type = typeof args[0] === 'string'
        ? args[0]
        : (args[0] && typeof args[0] === 'object' ? args[0].type : undefined);
    const name = warning && typeof warning === 'object' ? warning.name : undefined;
    if (type === 'ExperimentalWarning' || name === 'ExperimentalWarning') {
        return;
    }
    return originalEmitWarning(warning, ...args);
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function readPluginVersion() {
    const candidates = [
        resolve(__dirname, '..', '..', 'plugin.json'),
        resolve(__dirname, 'runtime', 'package.json'),
        resolve(__dirname, '..', '..', '..', 'package.json'),
    ];
    for (const candidate of candidates) {
        if (!existsSync(candidate)) { continue; }
        try {
            const raw = readFileSync(candidate, 'utf8').replace(/^\uFEFF/, '');
            const parsed = JSON.parse(raw);
            if (typeof parsed.version === 'string' && parsed.version.trim()) {
                return parsed.version.trim();
            }
        } catch {
            // Try next candidate
        }
    }
    return '1.17.9';
}

function resolveCompiledModule(relPath) {
    const candidates = [
        // Packaged Antigravity App plugin layout:
        //   <plugin>/sidecars/context_monitor/runtime/out/...
        resolve(__dirname, 'runtime', 'out', relPath),
        // Source repository layouts:
        resolve(__dirname, '..', '..', 'out', relPath),
        resolve(__dirname, '..', '..', '..', 'out', relPath),
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

function resolveImagesDir() {
    const candidates = [
        resolve(__dirname, 'runtime', 'src', 'images'),
        resolve(__dirname, '..', '..', 'src', 'images'),
        resolve(__dirname, '..', '..', '..', 'src', 'images'),
    ];
    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

function loadServerModule() {
    const serverPath = resolveCompiledModule(join('app', 'sidecar-server.js'));
    if (!serverPath) {
        throw new Error(
            'Compiled runtime not found (missing out/app/sidecar-server.js). ' +
            'Run `npm run compile` or `node scripts/package-app-plugin.mjs` first.'
        );
    }
    return require(serverPath);
}

async function loadProvider(serverMod, version) {
    const runtimePath = resolveCompiledModule(join('app', 'sidecar-runtime.js'));
    if (runtimePath) {
        try {
            const runtimeMod = require(runtimePath);
            const factory =
                runtimeMod.createSidecarRuntimeProvider ||
                runtimeMod.createSidecarProvider ||
                (typeof runtimeMod.default === 'function' ? runtimeMod.default : null);
            if (typeof factory === 'function') {
                return await factory({
                    version,
                    statePath: process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH || undefined,
                    dataDir: process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || undefined,
                    pluginRoot: resolve(__dirname, '..', '..'),
                    targetPluginDir: process.env.ANTIGRAVITY_PLUGIN_DIR || undefined,
                    cliDataDir: process.env.ANTIGRAVITY_CLI_DATA_DIR || undefined,
                });
            }
        } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error(`[context_monitor] Failed to load sidecar-runtime.js, using fallback provider: ${reason}`);
        }
    }
    return serverMod.createFallbackSidecarProvider({ version });
}

function parseCliArgs(argv) {
    let standalonePort = null;
    let printUrl = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--standalone-port' && i + 1 < argv.length) {
            const parsed = Number(argv[++i]);
            if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
                standalonePort = parsed;
            }
        } else if (arg.startsWith('--standalone-port=')) {
            const parsed = Number(arg.slice('--standalone-port='.length));
            if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535) {
                standalonePort = parsed;
            }
        } else if (arg === '--print-url') {
            printUrl = true;
        }
    }
    return { standalonePort, printUrl };
}

async function startSidecarMode(serverMod, provider, version, imagesDir) {
    const { SidecarApp, Response } = await import('sidecar_sdk');
    const app = new SidecarApp();
    const handler = serverMod.createSidecarHandler(provider, {
        version,
        isSidecarEnv: true,
        imagesDir,
    });

    app.page('/', async () => {
        const rendered = await handler.renderPage('aux', '/');
        return new Response(rendered.body, {
            contentType: rendered.contentType,
            status: rendered.status,
            headers: rendered.headers,
        });
    });

    app.page('/full', async () => {
        const rendered = await handler.renderPage('sidebar', '/full');
        return new Response(rendered.body, {
            contentType: rendered.contentType,
            status: rendered.status,
            headers: rendered.headers,
        });
    });

    // Register allowlisted offline PNG illustrations for SidecarApp exact-path routing
    if (typeof handler.listAssetImages === 'function' && typeof handler.handleAssetImage === 'function') {
        for (const fileName of handler.listAssetImages()) {
            app.page(`/assets/images/${fileName}`, async () => {
                const asset = await handler.handleAssetImage(fileName);
                return new Response(asset.body, {
                    contentType: asset.contentType,
                    status: asset.status,
                    headers: asset.headers,
                });
            });
        }
    }

    app.api('/api/health', () => handler.getHealth(), 'GET');

    app.api('/api/snapshot', async (data) => {
        const result = await handler.handleSnapshotQuery(data || {});
        return new Response(JSON.stringify(result.body), {
            contentType: 'application/json; charset=utf-8',
            status: result.status,
            headers: result.headers,
        });
    }, 'GET');

    app.api('/api/action', async (data) => {
        const result = await handler.handleActionPayload(data);
        return new Response(JSON.stringify(result.body), {
            contentType: 'application/json; charset=utf-8',
            status: result.status,
        });
    }, 'POST');

    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) { return; }
        shuttingDown = true;
        try { await provider.dispose?.(); } catch { /* ignore */ }
        try { await app.close(); } catch { /* ignore */ }
        process.exit(0);
    };
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });

    await app.run();
}

async function startStandaloneMode(serverMod, provider, version, port, printUrl, imagesDir) {
    const handle = await serverMod.startStandaloneServer(provider, {
        port,
        host: '127.0.0.1',
        version,
        imagesDir,
    });

    if (printUrl) {
        process.stdout.write(`${handle.url}\n`);
    } else {
        console.log(`[context_monitor] standalone listening on ${handle.url}`);
    }

    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) { return; }
        shuttingDown = true;
        try { await handle.close(); } catch { /* ignore */ }
        process.exit(0);
    };
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
}

async function main() {
    const version = readPluginVersion();
    const { standalonePort, printUrl } = parseCliArgs(process.argv.slice(2));
    const imagesDir = resolveImagesDir();
    const serverMod = loadServerModule();
    const provider = await loadProvider(serverMod, version);

    const hasSidecarEnv = Boolean(
        process.env.ANTIGRAVITY_SIDECAR_WEB_PORT &&
        process.env.ANTIGRAVITY_LS_ADDRESS &&
        process.env.ANTIGRAVITY_CSRF_TOKEN
    );

    if (standalonePort === null && hasSidecarEnv) {
        await startSidecarMode(serverMod, provider, version, imagesDir);
    } else {
        const port = standalonePort !== null ? standalonePort : 17835;
        await startStandaloneMode(serverMod, provider, version, port, printUrl, imagesDir);
    }
}

main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[context_monitor] fatal startup error: ${message}`);
    process.exit(1);
});

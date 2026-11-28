#!/usr/bin/env node
/**
 * Antigravity App native Sidecar entrypoint for Antigravity Context Monitor.
 *
 * Zero external npm dependencies — runs directly on Antigravity App's bundled
 * Node.js runtime (`"command": "node"`, Node v24+) across macOS, Windows, and Linux.
 *
 * Supports two runtime modes:
 *   1. Antigravity App Sidecar mode (`ANTIGRAVITY_SIDECAR_WEB_PORT`,
 *      `ANTIGRAVITY_LS_ADDRESS`, and `ANTIGRAVITY_CSRF_TOKEN` set):
 *      imports `sidecar_sdk` (auto-injected by Antigravity) and serves:
 *        - GET  /             -> AUX_PANE side panel UI
 *        - GET  /full         -> SIDEBAR full-pane UI
 *        - GET  /api/health   -> health metadata
 *        - GET  /api/snapshot -> ETag-diffed telemetry snapshot
 *        - POST /api/action   -> UI action dispatcher
 *   2. Explicit Standalone loopback HTTP mode (`--standalone-port=<port|0>`):
 *      binds strictly to `127.0.0.1` with a freshly generated 256-bit single-use
 *      bootstrap pairing contract (`standaloneAuth`) for local debugging and
 *      headless tests. Long-lived bearer/API credentials are NEVER printed to
 *      stdout, stderr, or URLs. When `sidecar_sdk` env vars are absent, refuses
 *      to silently bind any fixed port.
 *
 * Positive Real-Provider Contract (v1.18.0 §4.3):
 *   Never silently degrades to an empty fallback shell if the real bundled or
 *   compiled `sidecar-runtime.js` fails to load. Positively verifies
 *   `ACM_REAL_PROVIDER === true` on bundled runtimes and real provider methods
 *   (`pollNow`, `getState`, `getSnapshot`, `renderHtml`, `handleAction`), failing
 *   explicitly with an actionable diagnostic message otherwise.
 */

import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
    closeSync,
    fstatSync,
    existsSync,
    lstatSync,
    openSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

function readJsonSafe(filePath) {
    if (!existsSync(filePath)) { return null; }
    try {
        return JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
        return null;
    }
}

export function readPluginVersion(baseDir = __dirname) {
    const candidates = [
        resolve(baseDir, '..', '..', 'plugin.json'),
        resolve(baseDir, 'runtime', 'package.json'),
        resolve(baseDir, '..', '..', '..', 'package.json'),
    ];
    for (const candidate of candidates) {
        const parsed = readJsonSafe(candidate);
        if (parsed && typeof parsed.version === 'string' && parsed.version.trim()) {
            return parsed.version.trim();
        }
    }
    return '1.18.2';
}

/**
 * Resolve `sidecar-server.js` and `sidecar-runtime.js` from a consistent runtime root.
 * Preserves previous-release packaged entry paths (`runtime/out/app/...`) first,
 * then isolated `dist-stage/app/...`, then dev `out/app/...`.
 */
export function resolveRuntimeModulePaths(baseDir = __dirname) {
    const appDirCandidates = [
        // 1. Packaged Antigravity App plugin layout (previous-release compatible):
        //    <plugin>/sidecars/context_monitor/runtime/out/app/
        { dir: resolve(baseDir, 'runtime', 'out', 'app'), layout: 'packaged' },
        // 2. Isolated esbuild bundle stage in source repository:
        //    <repo>/dist-stage/app/
        { dir: resolve(baseDir, '..', '..', '..', 'dist-stage', 'app'), layout: 'dist-stage' },
        // 3. Dev tsc output layouts in source repository:
        { dir: resolve(baseDir, '..', '..', 'out', 'app'), layout: 'dev-out' },
        { dir: resolve(baseDir, '..', '..', '..', 'out', 'app'), layout: 'dev-out' },
    ];

    for (const candidate of appDirCandidates) {
        const serverPath = join(candidate.dir, 'sidecar-server.js');
        const runtimePath = join(candidate.dir, 'sidecar-runtime.js');
        if (existsSync(serverPath) || existsSync(runtimePath)) {
            const runtimePkg = candidate.layout === 'packaged'
                ? readJsonSafe(resolve(baseDir, 'runtime', 'package.json'))
                : null;
            const isBundled = existsSync(join(candidate.dir, 'sidecar-bundle.js'))
                || candidate.layout === 'dist-stage'
                || Boolean(runtimePkg && runtimePkg.bundled === true);
            return {
                layout: candidate.layout,
                isBundled,
                serverPath: existsSync(serverPath) ? serverPath : null,
                runtimePath: existsSync(runtimePath) ? runtimePath : null,
                buildId: (runtimePkg && typeof runtimePkg.buildId === 'string') ? runtimePkg.buildId : null,
            };
        }
    }

    return {
        layout: 'missing',
        isBundled: false,
        serverPath: null,
        runtimePath: null,
        buildId: null,
    };
}

export function loadServerModule(runtimePaths = resolveRuntimeModulePaths()) {
    if (!runtimePaths.serverPath) {
        throw new Error(
            'Compiled sidecar server runtime not found (missing sidecar-server.js). ' +
            'Run `npm run build:bundles` or `node scripts/package-app-plugin.mjs` first.',
        );
    }
    const serverMod = require(runtimePaths.serverPath);
    if (!serverMod || typeof serverMod !== 'object') {
        throw new Error(`Invalid sidecar-server module loaded from ${runtimePaths.serverPath}.`);
    }
    return serverMod;
}

export function assertVerifiedRealProvider(provider, sourceLabel) {
    if (!provider || typeof provider !== 'object') {
        throw new Error(
            `Real sidecar runtime (${sourceLabel}) returned an invalid provider object. ` +
            'Refusing to start an empty fallback shell.',
        );
    }
    if (provider.isFallback === true) {
        throw new Error(
            `Sidecar runtime (${sourceLabel}) returned a fallback shell provider. ` +
            'Refusing to run silently without the real telemetry provider.',
        );
    }
    const requiredMethods = ['renderHtml', 'getSnapshot', 'handleAction', 'pollNow', 'getState'];
    const missing = requiredMethods.filter((name) => typeof provider[name] !== 'function');
    if (missing.length > 0) {
        throw new Error(
            `Sidecar runtime (${sourceLabel}) failed positive real-provider verification ` +
            `(missing methods: ${missing.join(', ')}). Refusing to run an empty fallback shell.`,
        );
    }
    return provider;
}

export async function loadRealProvider(runtimePaths, version, baseDir = __dirname) {
    if (!runtimePaths || !runtimePaths.runtimePath) {
        throw new Error(
            'Missing real sidecar runtime provider (sidecar-runtime.js). ' +
            'Refusing to silently start an empty fallback shell. ' +
            'Run `npm run build:bundles` or reinstall Antigravity Context Monitor.',
        );
    }

    let runtimeMod;
    try {
        runtimeMod = require(runtimePaths.runtimePath);
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
            `Failed to load real sidecar runtime (${runtimePaths.runtimePath}): ${reason}. ` +
            'Refusing to fall back to an empty shell.',
        );
    }

    if (!runtimeMod || typeof runtimeMod !== 'object') {
        throw new Error(
            `Sidecar runtime (${runtimePaths.runtimePath}) did not export a module object. ` +
            'Refusing to fall back to an empty shell.',
        );
    }

    if (runtimePaths.isBundled && runtimeMod.ACM_REAL_PROVIDER !== true) {
        throw new Error(
            `Bundled sidecar runtime (${runtimePaths.runtimePath}) failed positive identification ` +
            '(expected export ACM_REAL_PROVIDER === true). Refusing to fall back to an empty shell.',
        );
    }
    if (runtimeMod.ACM_REAL_PROVIDER === false) {
        throw new Error(
            `Sidecar runtime (${runtimePaths.runtimePath}) explicitly reported ACM_REAL_PROVIDER === false. ` +
            'Refusing to start.',
        );
    }

    const factory =
        runtimeMod.createSidecarRuntimeProvider ||
        runtimeMod.createSidecarProvider ||
        (typeof runtimeMod.default === 'function' ? runtimeMod.default : null);

    if (typeof factory !== 'function') {
        throw new Error(
            `Sidecar runtime (${runtimePaths.runtimePath}) does not export createSidecarRuntimeProvider. ` +
            'Refusing to fall back to an empty shell.',
        );
    }

    let provider;
    try {
        provider = await factory({
            version,
            statePath: process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH || undefined,
            // The executable data directory belongs to this plugin. Swarm manifests
            // live in the host profile, alongside its conversations.
            brainDir: process.env.ANTIGRAVITY_BRAIN_DIR || undefined,
            dataDir: process.env.ANTIGRAVITY_DATA_DIR || undefined,
            pluginRoot: resolve(baseDir, '..', '..'),
            targetPluginDir: process.env.ANTIGRAVITY_PLUGIN_DIR || undefined,
            cliDataDir: process.env.ANTIGRAVITY_CLI_DATA_DIR || undefined,
        });
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
            `Failed to initialize real sidecar runtime provider (${runtimePaths.runtimePath}): ${reason}. ` +
            'Refusing to fall back to an empty shell.',
        );
    }

    return assertVerifiedRealProvider(provider, runtimePaths.runtimePath);
}

function parsePortValue(raw) {
    const text = String(raw ?? '').trim();
    if (!/^\d+$/.test(text)) {
        return null;
    }
    const parsed = Number(text);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        return null;
    }
    return parsed;
}

function parsePairingFileValue(raw) {
    const text = String(raw ?? '').trim();
    if (!text || text.includes('\0') || /[\r\n]/.test(text)) {
        return null;
    }
    return resolve(text);
}

function parseCliArgs(argv) {
    let standalonePort = null;
    let printUrl = false;
    let pairingFile = null;
    let help = false;
    let error = null;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            help = true;
        } else if (arg === '--standalone-port') {
            if (i + 1 >= argv.length) {
                error = 'Missing port value for --standalone-port (expected integer 0..65535).';
                break;
            }
            const rawVal = argv[++i];
            const parsed = parsePortValue(rawVal);
            if (parsed === null) {
                error = `Invalid --standalone-port value "${rawVal}" (expected integer 0..65535).`;
                break;
            }
            standalonePort = parsed;
        } else if (arg.startsWith('--standalone-port=')) {
            const rawVal = arg.slice('--standalone-port='.length);
            const parsed = parsePortValue(rawVal);
            if (parsed === null) {
                error = `Invalid --standalone-port value "${rawVal}" (expected integer 0..65535).`;
                break;
            }
            standalonePort = parsed;
        } else if (arg === '--pairing-file') {
            if (i + 1 >= argv.length) {
                error = 'Missing path value for --pairing-file.';
                break;
            }
            const parsed = parsePairingFileValue(argv[++i]);
            if (parsed === null) {
                error = 'Invalid --pairing-file path.';
                break;
            }
            pairingFile = parsed;
        } else if (arg.startsWith('--pairing-file=')) {
            const parsed = parsePairingFileValue(arg.slice('--pairing-file='.length));
            if (parsed === null) {
                error = 'Invalid --pairing-file path.';
                break;
            }
            pairingFile = parsed;
        } else if (arg === '--print-url') {
            printUrl = true;
        } else {
            error = `Unknown option: ${arg}`;
            break;
        }
    }
    if (!pairingFile && typeof process.env.ANTIGRAVITY_STANDALONE_PAIRING_FILE === 'string' && process.env.ANTIGRAVITY_STANDALONE_PAIRING_FILE.trim()) {
        const parsedEnv = parsePairingFileValue(process.env.ANTIGRAVITY_STANDALONE_PAIRING_FILE);
        if (parsedEnv === null) {
            error = 'Invalid ANTIGRAVITY_STANDALONE_PAIRING_FILE path.';
        } else {
            pairingFile = parsedEnv;
        }
    }
    return { standalonePort, printUrl, pairingFile, help, error };
}

function formatUsage() {
    return [
        'Usage:',
        '  1. Antigravity App Sidecar mode (default when launched by Antigravity App):',
        '     Requires ANTIGRAVITY_SIDECAR_WEB_PORT, ANTIGRAVITY_LS_ADDRESS, and ANTIGRAVITY_CSRF_TOKEN.',
        '  2. Explicit standalone loopback mode (local debugging / headless testing):',
        '     node main.mjs --standalone-port=<port|0> [--print-url] [--pairing-file=<path>]',
        '',
        'Notes:',
        '  - Standalone mode requires an explicit --standalone-port=<0..65535> flag (never silently binds a default port).',
        '  - Long-lived bearer/API credentials are NEVER printed to stdout, stderr, or URLs.',
        '  - Pass --pairing-file=<path> (new file, mode 0600) to receive a single-use bootstrap pairing code privately.',
    ].join('\n');
}

async function startSidecarMode(serverMod, provider, version, buildId) {
    const { SidecarApp, Response } = await import('sidecar_sdk');
    const app = new SidecarApp();
    const handler = serverMod.createSidecarHandler(provider, {
        version,
        isSidecarEnv: true,
        buildId,
    });

    app.page('/', async () => {
        const rendered = await handler.renderPage('aux', '/', undefined, 'sdk', true);
        return new Response(rendered.body, {
            contentType: rendered.contentType,
            status: rendered.status,
            headers: rendered.headers,
        });
    });

    app.page('/full', async () => {
        const rendered = await handler.renderPage('sidebar', '/full', undefined, 'sdk', true);
        return new Response(rendered.body, {
            contentType: rendered.contentType,
            status: rendered.status,
            headers: rendered.headers,
        });
    });

    app.api('/api/health', () => handler.getHealth(), 'GET');

    app.api('/api/snapshot', async (data) => {
        const result = await handler.handleSnapshotQuery(data || {}, undefined, {
            transport: 'sdk',
            authScope: 'sdk',
            authSubject: 'sdk',
        });
        if (result.status === 304) {
            return new Response('', {
                contentType: 'application/json; charset=utf-8',
                status: 304,
                headers: result.headers,
            });
        }
        return new Response(JSON.stringify(result.body), {
            contentType: 'application/json; charset=utf-8',
            status: result.status,
            headers: result.headers,
        });
    }, 'GET');

    app.api('/api/action', async (data) => {
        const result = await handler.handleActionPayload(data, {
            transport: 'sdk',
            authScope: 'sdk',
            authSubject: 'sdk',
        });
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

const STANDALONE_BOOTSTRAP_TTL_MS = 60_000;

function writePrivateBootstrapPairingFile(filePath, payload) {
    // The pathname must be unused. Existing files may have other readers,
    // links or ACLs, and must never be truncated to deliver a credential.
    const fd = openSync(filePath, 'wx', 0o600);
    const identity = fstatSync(fd, { bigint: true });
    const cleanup = () => {
        try {
            const current = lstatSync(filePath, { bigint: true });
            if (current.dev === identity.dev && current.ino === identity.ino) {
                rmSync(filePath);
            }
        } catch { /* already removed */ }
    };
    try {
        if (process.platform === 'win32') {
            // POSIX mode bits cannot restrict a Windows ACL. Remove inherited
            // grants from the newly created empty file before writing the code.
            const system32 = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
            const opts = { encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
            const who = execFileSync(join(system32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], opts);
            const sid = /"(S-1-(?:[0-9]+-)*[0-9]+)"\s*$/i.exec(who)?.[1];
            if (!sid) { throw new Error('Could not identify the current Windows user for private pairing'); }
            execFileSync(join(system32, 'icacls.exe'), [filePath, '/inheritance:r', '/grant:r', '*' + sid + ':F'], opts);
        }
        writeFileSync(fd, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8' });
        return cleanup;
    } catch (error) {
        cleanup();
        throw error;
    } finally {
        closeSync(fd);
    }
}

function createStandaloneBootstrapPairing(deliveryChannel) {
    const code = randomBytes(32).toString('hex');
    const nowMs = Date.now();
    return {
        mode: 'one-time-exchange',
        code,
        codeSha256: createHash('sha256').update(code, 'utf8').digest('hex'),
        singleUse: true,
        ttlMs: STANDALONE_BOOTSTRAP_TTL_MS,
        expiresAtMs: nowMs + STANDALONE_BOOTSTRAP_TTL_MS,
        exchangeEndpoint: '/api/auth/pair',
        deliveryChannel,
    };
}

async function startStandaloneMode(serverMod, provider, version, port, printUrl, pairingFile, buildId) {
    const bootstrapPairing = createStandaloneBootstrapPairing(pairingFile ? 'private-file' : 'in-memory');
    const startServer = serverMod.startStandaloneServer || serverMod.startSidecarServer;
    if (typeof startServer !== 'function') {
        throw new Error('Compiled sidecar-server module does not export startStandaloneServer.');
    }

    let cleanupPairingFile;
    const removePairingFileOnce = () => {
        cleanupPairingFile?.();
        cleanupPairingFile = undefined;
    };

    const handle = await startServer(provider, {
        port,
        host: '127.0.0.1',
        version,
        buildId,
        // Clean private one-time bootstrap pairing contract enforced by sidecar-server:
        // long-lived bearer/API credentials are NEVER printed to stdout, stderr, or URLs.
        standaloneAuth: {
            requirePairing: true,
            unpairedShellOnly: true,
            bootstrapPairing,
            onPairingConsumed: removePairingFileOnce,
        },
    });

    if (pairingFile) {
        const effectivePairing = handle && typeof handle.bootstrapPairing === 'object' && handle.bootstrapPairing
            ? handle.bootstrapPairing
            : bootstrapPairing;
        const pairingCode = typeof effectivePairing.code === 'string' && effectivePairing.code
            ? effectivePairing.code
            : bootstrapPairing.code;
        cleanupPairingFile = writePrivateBootstrapPairingFile(pairingFile, {
            url: handle.url,
            pairingCode,
            exchangeEndpoint: effectivePairing.exchangeEndpoint || '/api/auth/pair',
            singleUse: true,
            expiresAtMs: typeof effectivePairing.expiresAtMs === 'number'
                ? effectivePairing.expiresAtMs
                : bootstrapPairing.expiresAtMs,
        });
    }

    // Security invariant (W1A-FIX-5 / SEC-02): NEVER print any long-lived bearer/API
    // credential or bootstrap secret to stdout, stderr, or URLs (including under --print-url).
    if (printUrl) {
        process.stdout.write(`${handle.url}\n`);
    } else {
        process.stdout.write(`[context_monitor] standalone listening on ${handle.url}\n`);
    }

    let shuttingDown = false;
    const shutdown = async () => {
        if (shuttingDown) { return; }
        shuttingDown = true;
        removePairingFileOnce();
        try { await handle.close(); } catch { /* ignore */ }
        process.exit(0);
    };
    process.once('SIGINT', () => { void shutdown(); });
    process.once('SIGTERM', () => { void shutdown(); });
}

async function main() {
    const { standalonePort, printUrl, pairingFile, help, error } = parseCliArgs(process.argv.slice(2));
    if (help) {
        process.stdout.write(`${formatUsage()}\n`);
        process.exit(0);
    }
    if (error) {
        process.stderr.write(`[context_monitor] ${error}\n\n${formatUsage()}\n`);
        process.exit(1);
    }

    const hasSidecarEnv = Boolean(
        process.env.ANTIGRAVITY_SIDECAR_WEB_PORT &&
        process.env.ANTIGRAVITY_LS_ADDRESS &&
        process.env.ANTIGRAVITY_CSRF_TOKEN,
    );

    if (standalonePort === null && !hasSidecarEnv) {
        process.stderr.write(
            '[context_monitor] Missing Antigravity Sidecar environment variables ' +
            '(ANTIGRAVITY_SIDECAR_WEB_PORT, ANTIGRAVITY_LS_ADDRESS, ANTIGRAVITY_CSRF_TOKEN).\n' +
            'Refusing to silently bind a standalone port. Pass --standalone-port=<port|0> explicitly to start in standalone mode.\n\n' +
            `${formatUsage()}\n`,
        );
        process.exit(1);
    }

    const version = readPluginVersion();
    const runtimePaths = resolveRuntimeModulePaths();
    const serverMod = loadServerModule(runtimePaths);
    const provider = await loadRealProvider(runtimePaths, version);

    if (standalonePort === null && hasSidecarEnv) {
        await startSidecarMode(serverMod, provider, version, runtimePaths.buildId);
    } else {
        await startStandaloneMode(serverMod, provider, version, standalonePort, printUrl, pairingFile, runtimePaths.buildId);
    }
}

function isDirectEntrypoint() {
    if (!process.argv[1]) { return false; }
    try {
        return realpathSync(resolve(process.argv[1])) === realpathSync(__filename);
    } catch {
        return resolve(process.argv[1]) === __filename;
    }
}

if (isDirectEntrypoint()) {
    main().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[context_monitor] fatal startup error: ${message}`);
        process.exit(1);
    });
}

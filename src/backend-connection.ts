import * as vscode from 'vscode';
import {
    discoverLanguageServer,
    type DiscoverLanguageServerOptions,
    type LSConnectionHint,
    type LSInfo,
} from './discovery';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function parseLoopbackServerUrlPort(rawUrl: unknown): number | null {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) { return null; }
    const trimmed = rawUrl.trim();
    if (/\s/.test(trimmed)) { return null; }
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
    try {
        const parsed = new URL(hasScheme ? trimmed : `http://${trimmed}`);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return null; }
        if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) { return null; }
        if (hasScheme) {
            const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
            return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? port : null;
        }
        if (!parsed.port || !/^\d+$/.test(parsed.port)) { return null; }
        const port = Number(parsed.port);
        return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? port : null;
    } catch {
        return null;
    }
}

/**
 * Parse loopback `ANTIGRAVITY_LS_ADDRESS` + `ANTIGRAVITY_CSRF_TOKEN` injected by
 * Antigravity App Sidecar / agent subprocesses into an `LSConnectionHint`.
 */
export function getEnvBackendHint(env: NodeJS.ProcessEnv = process.env): LSConnectionHint | null {
    const port = parseLoopbackServerUrlPort(env.ANTIGRAVITY_LS_ADDRESS);
    const csrfToken = typeof env.ANTIGRAVITY_CSRF_TOKEN === 'string' ? env.ANTIGRAVITY_CSRF_TOKEN.trim() : '';
    if (port === null || !csrfToken || /\s/.test(csrfToken)) {
        return null;
    }
    return { port, csrfToken };
}

function getConfiguredLoopbackServerPort(): number | null {
    const envPort = parseLoopbackServerUrlPort(process.env.ANTIGRAVITY_SERVER_URL);
    if (envPort !== null) { return envPort; }
    try {
        const cfgUrl = vscode.workspace?.getConfiguration?.('antigravity')?.get<string>('serverUrl');
        return parseLoopbackServerUrlPort(cfgUrl);
    } catch {
        return null;
    }
}

/** undefined: legacy IDE; null: this IDE's backend is present but not ready. */
export function getActiveBackendHint(): LSConnectionHint | null | undefined {
    try {
        const extension = vscode.extensions?.getExtension('google.google-antigravity');
        if (!extension) { return undefined; }
        if (!extension.isActive) { return null; }
        const api: unknown = extension.exports;
        if (!api || typeof api !== 'object') { return null; }
        const { port, csrfToken } = api as Record<string, unknown>;
        if (typeof csrfToken !== 'string' || !csrfToken || /\s/.test(csrfToken)) {
            return null;
        }
        const resolvedPort = port === undefined ? getConfiguredLoopbackServerPort() : port;
        if (typeof resolvedPort !== 'number' || !Number.isSafeInteger(resolvedPort)
            || resolvedPort < 1 || resolvedPort > 65535) {
            return null;
        }
        return { port: resolvedPort, csrfToken };
    } catch {
        // Exports may be unavailable or replaced while the built-in extension restarts.
        return null;
    }
}

/** Full backend identity check (handles pid=0 direct-hint connections and port/token/TLS/host changes). */
export function isSameBackendConnection(
    a: LSInfo | null | undefined,
    b: LSInfo | null | undefined,
): boolean {
    if (!a || !b) { return false; }
    return a.pid === b.pid
        && a.port === b.port
        && a.csrfToken === b.csrfToken
        && a.useTls === b.useTls
        && (a.hostname || '127.0.0.1') === (b.hostname || '127.0.0.1');
}

/**
 * Whether a cached LS connection still matches the current IDE's active hint.
 * - undefined hint (legacy IDE): always matches.
 * - null hint (IDE backend restarting/not ready): stale, must re-discover/wait.
 * - active hint: token must match; for HTTP connections port must also match
 *   (HTTPS fallback may legitimately sit on the paired httpsPort of the same hub).
 */
export function doesConnectionMatchActiveHint(
    ls: LSInfo,
    hint: LSConnectionHint | null | undefined,
): boolean {
    if (hint === undefined) { return true; }
    if (hint === null) { return false; }
    if (ls.csrfToken !== hint.csrfToken) { return false; }
    if (!ls.useTls && ls.port !== hint.port) { return false; }
    return true;
}

export function discoverCurrentLanguageServer(
    workspaceUri?: string, signal?: AbortSignal, log?: (message: string) => void,
): Promise<LSInfo | null> {
    const hint = getActiveBackendHint();
    if (hint === null) {
        log?.('Current IDE backend is starting or restarting; waiting without selecting another instance');
        return Promise.resolve(null);
    }
    return discoverLanguageServer(workspaceUri, signal, log, hint);
}

/**
 * Surface-aware backend discovery for unified IDE + Antigravity App callers.
 * When `preferredSurface === 'app'`, skips VS Code extension affinity and prefers
 * `ANTIGRAVITY_LS_ADDRESS` env vars / App standalone hub. When `'ide'`, respects
 * strict built-in extension hint affinity.
 */
export function discoverPreferredBackend(
    options: Omit<DiscoverLanguageServerOptions, 'hint'> = {},
): Promise<LSInfo | null> {
    if (options.preferredSurface === 'app') {
        return discoverLanguageServer({ ...options, preferredSurface: 'app' });
    }
    const hint = getActiveBackendHint();
    if (hint === null) {
        options.log?.('Current IDE backend is starting or restarting; waiting without selecting another instance');
        return Promise.resolve(null);
    }
    return discoverLanguageServer({
        ...options,
        preferredSurface: options.preferredSurface ?? 'ide',
        hint,
    });
}

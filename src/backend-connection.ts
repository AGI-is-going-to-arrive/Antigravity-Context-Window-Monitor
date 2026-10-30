import * as vscode from 'vscode';
import { discoverLanguageServer, type LSConnectionHint, type LSInfo } from './discovery';

/** undefined: legacy IDE; null: this IDE's backend is present but not ready. */
export function getActiveBackendHint(): LSConnectionHint | null | undefined {
    try {
        const extension = vscode.extensions?.getExtension('google.google-antigravity');
        if (!extension) { return undefined; }
        if (!extension.isActive) { return null; }
        const api: unknown = extension.exports;
        if (!api || typeof api !== 'object') { return null; }
        const { port, csrfToken } = api as Record<string, unknown>;
        if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65535
            || typeof csrfToken !== 'string' || !csrfToken || /\s/.test(csrfToken)) {
            return null;
        }
        return { port, csrfToken };
    } catch {
        // Exports may be unavailable or replaced while the built-in extension restarts.
        return null;
    }
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

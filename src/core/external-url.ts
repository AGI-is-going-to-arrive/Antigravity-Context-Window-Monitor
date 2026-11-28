/**
 * Shared Pure-Node External URL Allowlist & Validator.
 *
 * Strictly zero `vscode` imports and zero external npm dependencies so both
 * IDE VSIX (`webview-panel.ts`) and App Sidecar (`sidecar-runtime.ts`) can
 * import this module without pulling in the opposite host runtime.
 */

export const ALLOWED_EXTERNAL_URL_HOSTS: ReadonlySet<string> = new Set([
    'github.com',
    'docs.github.com',
    'raw.githubusercontent.com',
    'open-vsx.org',
    'marketplace.visualstudio.com',
    'antigravity.google',
    'ai.google.dev',
    'aistudio.google.com',
]);

/**
 * Strictly validate external URLs before delegating to the OS browser opener.
 * Allows ONLY `https://` URLs on port 443 targeting allowlisted hosts with
 * zero embedded credentials and zero shell/control metacharacters.
 */
export function validateExternalUrl(rawUrl: unknown): string | null {
    if (typeof rawUrl !== 'string') { return null; }
    const trimmed = rawUrl.trim();
    if (!trimmed || trimmed.length > 2048 || /[\0\r\n"&|^<>`%]/.test(trimmed.replace(/%[0-9A-Fa-f]{2}/g, ''))) {
        return null;
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'https:') { return null; }
    if (parsed.username || parsed.password) { return null; }
    if (parsed.port && parsed.port !== '443') { return null; }
    const host = parsed.hostname.toLowerCase();
    if (!ALLOWED_EXTERNAL_URL_HOSTS.has(host)) { return null; }
    return parsed.toString();
}

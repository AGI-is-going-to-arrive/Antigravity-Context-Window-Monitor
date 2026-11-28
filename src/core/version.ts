/**
 * Single-Source Runtime Version & Build-ID Resolver (§4.1 / §4.3).
 *
 * Strictly zero `vscode` imports and zero external npm dependencies.
 * Resolves the active package/plugin version without assuming repository checkout
 * directory layouts — works identically in:
 * - esbuild single-file bundles (via build-time injected `__ACM_APP_VERSION__` / `__ACM_BUILD_ID__`)
 * - Installed Antigravity App Sidecar plugin (`plugin.json`)
 * - Installed Antigravity IDE VSIX extension (`package.json` or `extension.packageJSON.version`)
 * - Source / Vitest workspace runs
 * - Standalone / extracted temp-dir smoke runs outside the repository
 */

import * as fs from 'fs';
import * as path from 'path';

// Optional compile-time macros replaced by `esbuild --define`.
declare const __ACM_APP_VERSION__: string | undefined;
declare const __ACM_BUILD_ID__: string | undefined;

/** Last-resort fallback version when neither build metadata nor an owned manifest is readable. */
export const FALLBACK_APP_VERSION = '1.18.1';

const OWNED_MANIFEST_NAMES: ReadonlySet<string> = new Set([
    'antigravity-context-monitor',
    'antigravity context monitor',
    'antigravity context window monitor',
]);

const SEMVER_RE = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;
const MAX_PARENT_HOPS = 4;

export interface VersionResolutionOptions {
    /** Explicit version supplied by host (e.g. `context.extension.packageJSON.version` or CLI flag). */
    explicitVersion?: string | null;
    /** Build-time injected version override (primarily for deterministic testing). */
    bundledVersion?: string | null;
    /** Optional plugin root directory containing `plugin.json`. */
    pluginRoot?: string | null;
    /** Optional explicit manifest file paths to inspect (checked in order). */
    manifestPaths?: readonly string[];
    /** Starting directory for bounded upward manifest lookup (defaults to `__dirname`). */
    searchStartDir?: string;
    /** Environment variables (defaults to `process.env`). */
    env?: NodeJS.ProcessEnv;
    /** Injectable file reader for hermetic tests. */
    readFileSyncFn?: (filePath: string, encoding: 'utf8') => string;
    /** Injectable existence check for hermetic tests. */
    existsSyncFn?: (filePath: string) => boolean;
    /** Fallback version if all sources fail (defaults to `FALLBACK_APP_VERSION`). */
    fallbackVersion?: string;
}

export interface BuildIdResolutionOptions extends VersionResolutionOptions {
    /** Explicit build ID override (e.g. content hash from bundler). */
    explicitBuildId?: string | null;
    /** Build-time injected build ID override (for testing). */
    bundledBuildId?: string | null;
}

let cachedDefaultVersion: string | null = null;

/**
 * Validate and normalize a semver string (stripping any leading `v`), or return `null`.
 */
export function normalizeSemverVersion(raw: unknown): string | null {
    if (typeof raw !== 'string') { return null; }
    const trimmed = raw.trim();
    if (!trimmed) { return null; }
    const match = SEMVER_RE.exec(trimmed);
    return match ? match[1] : null;
}

export function isValidSemverVersion(raw: unknown): boolean {
    return normalizeSemverVersion(raw) !== null;
}

function getBuildTimeMacroVersion(): string | null {
    try {
        if (typeof __ACM_APP_VERSION__ === 'string') {
            return normalizeSemverVersion(__ACM_APP_VERSION__);
        }
    } catch {
        // ReferenceError when unbundled without esbuild --define
    }
    const g = globalThis as Record<string, unknown>;
    if (typeof g.__ACM_APP_VERSION__ === 'string') {
        return normalizeSemverVersion(g.__ACM_APP_VERSION__);
    }
    return null;
}

function getBuildTimeMacroBuildId(): string | null {
    try {
        if (typeof __ACM_BUILD_ID__ === 'string' && __ACM_BUILD_ID__.trim()) {
            return __ACM_BUILD_ID__.trim();
        }
    } catch {
        // ReferenceError when unbundled without esbuild --define
    }
    const g = globalThis as Record<string, unknown>;
    if (typeof g.__ACM_BUILD_ID__ === 'string' && g.__ACM_BUILD_ID__.trim()) {
        return g.__ACM_BUILD_ID__.trim();
    }
    return null;
}

function isOwnedManifestObject(parsed: Record<string, unknown>): boolean {
    for (const field of [parsed.name, parsed.id, parsed.displayName]) {
        if (typeof field === 'string' && OWNED_MANIFEST_NAMES.has(field.trim().toLowerCase())) {
            return true;
        }
    }
    return false;
}

/**
 * Read and validate `version` from a `package.json` or `plugin.json` manifest file.
 * When `requireOwnedIdentity` is true, refuses unrelated parent `package.json` files
 * whose `name`/`id` does not belong to Antigravity Context Monitor.
 */
export function readVersionFromManifestFile(
    filePath: string,
    options: {
        requireOwnedIdentity?: boolean;
        existsSyncFn?: (p: string) => boolean;
        readFileSyncFn?: (p: string, enc: 'utf8') => string;
    } = {},
): string | null {
    const existsFn = options.existsSyncFn ?? ((p: string) => fs.existsSync(p));
    const readFn = options.readFileSyncFn ?? ((p: string, enc: 'utf8') => fs.readFileSync(p, enc));
    try {
        if (!existsFn(filePath)) { return null; }
        const raw = readFn(filePath, 'utf8').replace(/^\uFEFF/, '');
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        const rec = parsed as Record<string, unknown>;
        if (options.requireOwnedIdentity && !isOwnedManifestObject(rec)) {
            return null;
        }
        return normalizeSemverVersion(rec.version);
    } catch {
        return null;
    }
}

/**
 * Resolve the active runtime version cleanly across bundled, installed plugin,
 * installed VSIX, and source-checkout environments.
 *
 * Resolution order:
 * 1. `options.explicitVersion` (valid semver)
 * 2. `options.bundledVersion` or build-time `__ACM_APP_VERSION__`
 * 3. `env.ACM_APP_VERSION` (valid semver)
 * 4. Explicit `pluginRoot/plugin.json` & `manifestPaths`
 * 5. Bounded upward walk (max 4 parent dirs) checking owned `plugin.json` / `package.json`
 * 6. `options.fallbackVersion ?? FALLBACK_APP_VERSION`
 */
export function resolveRuntimeVersion(options: VersionResolutionOptions = {}): string {
    const explicit = normalizeSemverVersion(options.explicitVersion);
    if (explicit) { return explicit; }

    const bundled = options.bundledVersion !== undefined
        ? normalizeSemverVersion(options.bundledVersion)
        : getBuildTimeMacroVersion();
    if (bundled) { return bundled; }

    const env = options.env ?? process.env;
    const fromEnv = normalizeSemverVersion(env.ACM_APP_VERSION);
    if (fromEnv) { return fromEnv; }

    const ioOpts = {
        existsSyncFn: options.existsSyncFn,
        readFileSyncFn: options.readFileSyncFn,
    };

    if (typeof options.pluginRoot === 'string' && options.pluginRoot.trim()) {
        const pluginManifest = path.join(options.pluginRoot.trim(), 'plugin.json');
        const fromPluginRoot = readVersionFromManifestFile(pluginManifest, {
            ...ioOpts,
            requireOwnedIdentity: false,
        });
        if (fromPluginRoot) { return fromPluginRoot; }
    }

    if (Array.isArray(options.manifestPaths)) {
        for (const manifestPath of options.manifestPaths) {
            if (typeof manifestPath !== 'string' || !manifestPath.trim()) { continue; }
            const v = readVersionFromManifestFile(manifestPath.trim(), {
                ...ioOpts,
                requireOwnedIdentity: false,
            });
            if (v) { return v; }
        }
    }

    // Bounded upward walk accepting ONLY manifests belonging to Antigravity Context Monitor.
    // Guard `__dirname` safely so ESM `.mjs` entrypoints never throw ReferenceError.
    const defaultStartDir = typeof __dirname === 'string' ? __dirname : '';
    const startDir = options.searchStartDir !== undefined
        ? options.searchStartDir.trim()
        : defaultStartDir;
    if (startDir) {
        let currentDir = path.resolve(startDir);
        for (let hop = 0; hop <= MAX_PARENT_HOPS; hop++) {
            for (const filename of ['plugin.json', 'package.json']) {
                const candidate = path.join(currentDir, filename);
                const found = readVersionFromManifestFile(candidate, {
                    ...ioOpts,
                    requireOwnedIdentity: true,
                });
                if (found) { return found; }
            }
            const parentDir = path.dirname(currentDir);
            if (!parentDir || parentDir === currentDir) {
                break;
            }
            currentDir = parentDir;
        }
    }

    return normalizeSemverVersion(options.fallbackVersion) ?? FALLBACK_APP_VERSION;
}

/**
 * Memoized default runtime version getter for hot code paths.
 */
export function getRuntimeVersion(): string {
    if (cachedDefaultVersion === null) {
        cachedDefaultVersion = resolveRuntimeVersion();
    }
    return cachedDefaultVersion;
}

/**
 * Clear memoized version cache (intended for unit tests).
 */
export function resetRuntimeVersionCache(): void {
    cachedDefaultVersion = null;
}

/**
 * Resolve a deterministic build identifier (content hash injected by `esbuild`
 * when bundled, or falling back to `v<version>` in unbundled/dev runs).
 */
export function resolveRuntimeBuildId(options: BuildIdResolutionOptions = {}): string {
    if (typeof options.explicitBuildId === 'string' && options.explicitBuildId.trim()) {
        return options.explicitBuildId.trim();
    }
    if (options.bundledBuildId !== undefined) {
        if (typeof options.bundledBuildId === 'string' && options.bundledBuildId.trim()) {
            return options.bundledBuildId.trim();
        }
    } else {
        const macroId = getBuildTimeMacroBuildId();
        if (macroId) { return macroId; }
    }
    const env = options.env ?? process.env;
    if (typeof env.ACM_BUILD_ID === 'string' && env.ACM_BUILD_ID.trim()) {
        return env.ACM_BUILD_ID.trim();
    }
    return `v${resolveRuntimeVersion(options)}`;
}

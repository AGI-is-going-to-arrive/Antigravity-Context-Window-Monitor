/**
 * Zero-Patch, Cross-Platform Persistent CDP Launcher Generator & Inspector.
 *
 * Critical Compliance & Safety Guarantees:
 * - Pure Node.js built-ins ONLY (`child_process`, `fs`, `os`, `path`) + native OS utilities — zero external npm deps.
 * - ZERO modification to `/Applications/Antigravity.app`, `app.asar`, `Info.plist`, `codesign`, or `com.apple.dock`.
 * - NEVER terminates any running Antigravity App / IDE process from inside this module.
 * - Generated user-invoked macOS launcher prompts the user via native dialog (default button "Cancel" / "取消",
 *   auto-detecting EN/ZH OS locale) before graceful quit and polls cleanly up to 15s (0.25s interval) until
 *   the old PID exits, eliminating the 5-second `before-quit` language_server teardown race.
 * - Validates macOS bundle targets against symlinks and verifies `CFBundleIdentifier` before writing or removing.
 * - Windows Desktop resolution is process-level async cached (TTL >= 60s) so polling NEVER blocks on `powershell.exe`.
 */

import { execFile, execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    CDP_LAUNCHER_DISPLAY_NAME,
    LINUX_APPIMAGE_PROCESS_RE,
    LINUX_CDP_ICON_FILENAME,
    LINUX_FLATPAK_APP_ID,
    LINUX_FLATPAK_BOUNDARY_NOTE_EN,
    LINUX_FLATPAK_BOUNDARY_NOTE_ZH,
    MACOS_ANTIGRAVITY_BUNDLE_ID,
    MACOS_CDP_BUNDLE_NAME,
    MACOS_CDP_LAUNCHER_BUNDLE_ID,
    MACOS_SYSTEM_APPLICATIONS_DIR,
    WINDOWS_DESKTOP_PS_SCRIPT,
    WINDOWS_EXE_REGISTRY_PS_SCRIPT,
    assertSafeMacOsBundleWriteTarget,
    buildLinuxBadgedSvg,
    buildLinuxDesktopEntry,
    buildLinuxLauncherScript,
    buildMacOsInfoPlist,
    buildMacOsLauncherScript as buildCoreMacOsLauncherScript,
    buildWindowsExplorerRevealCommand,
    defaultCommandExists,
    dirnameTargetPath,
    escapeFreedesktopExecArg,
    extractAntigravityExeFromLnkFile,
    findWindowsAntigravityExeFromShortcuts,
    getCdpLauncherPlatformNotes,
    getFastWindowsDesktopFallback,
    getSafeCdpLaunchCommand,
    getWindowsExeFilesystemCandidates,
    isMacAppBundleInstalled,
    isOwnedMacCdpBundle,
    joinTargetPath,
    normalizePosixComparable,
    readMacBundleIdentifier,
    resolveCoreCdpLauncherPaths,
    resolveLauncherHomeDir,
    resolveLinuxXdgDataHome,
    sanitizeLinuxXdgDir,
    type WindowsExplorerRevealSpec,
} from '../core/cdp-launcher-core';
import type { CdpLauncherActionResult, CdpLauncherStatus } from './sidecar-types';

export type { CdpLauncherActionResult, CdpLauncherStatus, WindowsExplorerRevealSpec };
export {
    CDP_LAUNCHER_DISPLAY_NAME,
    LINUX_APPIMAGE_PROCESS_RE,
    LINUX_CDP_ICON_FILENAME,
    LINUX_FLATPAK_APP_ID,
    LINUX_FLATPAK_BOUNDARY_NOTE_EN,
    LINUX_FLATPAK_BOUNDARY_NOTE_ZH,
    MACOS_ANTIGRAVITY_BUNDLE_ID,
    MACOS_CDP_BUNDLE_NAME,
    MACOS_CDP_LAUNCHER_BUNDLE_ID,
    MACOS_SYSTEM_APPLICATIONS_DIR,
    WINDOWS_DESKTOP_PS_SCRIPT,
    WINDOWS_EXE_REGISTRY_PS_SCRIPT,
    buildLinuxBadgedSvg,
    buildLinuxDesktopEntry,
    buildLinuxLauncherScript,
    buildMacOsInfoPlist,
    buildWindowsExplorerRevealCommand,
    escapeFreedesktopExecArg,
    extractAntigravityExeFromLnkFile,
    getSafeCdpLaunchCommand,
    isOwnedMacCdpBundle,
    readMacBundleIdentifier,
    resolveLinuxXdgDataHome,
    sanitizeLinuxXdgDir,
};

export function buildMacOsLauncherScript(targetAppPath?: string): string {
    return buildCoreMacOsLauncherScript(targetAppPath).replace(
        '  fi\n\n  if ! wait_for_exit; then',
        '  fi\n  if ! wait_for_exit; then',
    );
}

/** Minimum TTL (60s) for process-level async Windows Desktop & executable caches. */
export const WINDOWS_DESKTOP_CACHE_TTL_MS = 60_000;
export const WINDOWS_EXE_CACHE_TTL_MS = 60_000;

const MAX_EMBEDDED_ICON_BYTES = 2 * 1024 * 1024;

export interface SpawnedLauncherProcessLike {
    pid?: number;
    exitCode?: number | null;
    unref?: () => void;
    on?: (event: string, listener: (...args: any[]) => void) => unknown;
    once?: (event: string, listener: (...args: any[]) => void) => unknown;
    off?: (event: string, listener: (...args: any[]) => void) => unknown;
    removeListener?: (event: string, listener: (...args: any[]) => void) => unknown;
}

export interface CdpLauncherExecOptions {
    env?: NodeJS.ProcessEnv;
    windowsHide?: boolean;
    stdio?: 'pipe' | 'ignore';
    timeout?: number;
    encoding?: BufferEncoding;
}

export interface CdpLauncherSpawnOptions {
    detached?: boolean;
    stdio?: 'ignore';
    windowsHide?: boolean;
    windowsVerbatimArguments?: boolean;
    shell?: boolean;
}

export interface CdpLauncherOptions {
    platform?: NodeJS.Platform;
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    appPath?: string;
    /** Optional macOS system Applications directory override (e.g. for isolated tests). Pass `""` to disable system dir lookup. */
    systemAppsDir?: string;
    /** Optional macOS installed bundle path to prioritize when both `/Applications` and `~/Applications` contain valid copies. */
    preferredMacAppDir?: string;
    /** Optional Windows Desktop directory override (bypasses PowerShell lookup when set). */
    desktopDir?: string;
    /** Optional Windows Desktop cache TTL override (defaults to `WINDOWS_DESKTOP_CACHE_TTL_MS = 60_000`). */
    desktopCacheTtlMs?: number;
    /** Injectable clock for deterministic TTL cache tests. */
    now?: () => number;
    /** Injectable sync command runner for explicit setup/remove actions in hermetic tests. */
    execFileSyncFn?: (
        file: string,
        args: readonly string[],
        options?: CdpLauncherExecOptions,
    ) => unknown;
    /** Injectable async command runner for non-blocking Windows Desktop & registry probes in tests. */
    execFileAsyncFn?: (
        file: string,
        args: readonly string[],
        options?: CdpLauncherExecOptions,
    ) => Promise<string | Buffer>;
    /** Injectable detached process spawner for hermetic `revealCdpLauncher` tests. */
    spawnImpl?: (
        command: string,
        args: readonly string[],
        options?: CdpLauncherSpawnOptions,
    ) => SpawnedLauncherProcessLike | undefined;
    /** Injectable PATH lookup for Linux `antigravity` / `xdg-open` / `flatpak` binary detection in tests. */
    commandExistsFn?: (cmd: string) => boolean;
    /** Optional settle window (ms) for `revealCdpLauncherAsync` early-exit verification (default 150ms). */
    revealSettleMs?: number;
    /** Optional spawn timeout (ms) for `revealCdpLauncherAsync` (default 3000ms). */
    revealSpawnTimeoutMs?: number;
}

export interface ResolvedCdpLauncherPaths {
    platform: NodeJS.Platform;
    supported: boolean;
    homeDir: string;
    launcherPath: string;
    targetAppPath: string;
    /** Secondary paths managed by the launcher (Windows Start Menu shortcut/icon/legacy cmd, Linux wrapper/icon, macOS alternate dir). */
    auxiliaryPaths: string[];
    // Platform-specific structured fields
    macAppDir?: string;
    macSystemAppsDir?: string;
    macSystemAppDir?: string;
    macUserAppDir?: string;
    macPreferredAppDir?: string;
    macCandidateAppDirs?: string[];
    winCmdPath?: string;
    winDesktopDir?: string;
    winDesktopLnkPath?: string;
    winFallbackDesktopLnkPath?: string;
    winStartMenuLnkPath?: string;
    winIconPath?: string;
    linuxWrapperPath?: string;
    linuxDesktopEntryPath?: string;
    linuxIconPath?: string;
    linuxXdgDataHome?: string;
}

// ─── Process-Level Async Caches (Windows Desktop & Registry Exe) ─────────────

interface CachedDesktopEntry {
    dir: string;
    expiresAt: number;
}

interface CachedWindowsExeEntry {
    exePath: string | null;
    expiresAt: number;
}

const windowsDesktopDirCache = new Map<string, CachedDesktopEntry>();
const windowsDesktopDirInFlight = new Map<string, Promise<string>>();
const windowsExeCache = new Map<string, CachedWindowsExeEntry>();
const windowsExeInFlight = new Map<string, Promise<string | null>>();

export function clearWindowsDesktopDirCache(): void {
    windowsDesktopDirCache.clear();
    windowsDesktopDirInFlight.clear();
}

export function clearWindowsLauncherCaches(): void {
    clearWindowsDesktopDirCache();
    windowsExeCache.clear();
    windowsExeInFlight.clear();
}

// ─── Command Runners & Escaping Helpers ──────────────────────────────────────

function createDefaultRunner(
    execFileSyncFn?: CdpLauncherOptions['execFileSyncFn'],
): (file: string, args: readonly string[], options?: CdpLauncherExecOptions) => unknown {
    return execFileSyncFn
        ?? ((file: string, args: readonly string[], options?: CdpLauncherExecOptions) =>
            execFileSync(file, [...args], {
                env: options?.env,
                windowsHide: options?.windowsHide ?? true,
                stdio: options?.stdio ?? 'pipe',
                ...(typeof options?.timeout === 'number' ? { timeout: options.timeout } : {}),
                ...(options?.encoding ? { encoding: options.encoding } : {}),
            }));
}

function createDefaultAsyncRunner(
    execFileAsyncFn?: CdpLauncherOptions['execFileAsyncFn'],
): (file: string, args: readonly string[], options?: CdpLauncherExecOptions) => Promise<string | Buffer> {
    if (execFileAsyncFn) {
        return execFileAsyncFn;
    }
    return (file: string, args: readonly string[], options?: CdpLauncherExecOptions) =>
        new Promise<string>((resolve, reject) => {
            execFile(file, [...args], {
                env: options?.env,
                windowsHide: options?.windowsHide ?? true,
                timeout: options?.timeout ?? 3_000,
                encoding: options?.encoding ?? 'utf8',
            }, (err, stdout) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(typeof stdout === 'string' ? stdout : String(stdout ?? ''));
            });
        });
}

// ─── Windows Desktop Dir (Process-Level Async Cache, Zero Sync Polling) ──────

function desktopCacheKey(homeDir: string): string {
    return homeDir.trim().toLowerCase();
}

function parseSingleLinePsOutput(raw: unknown): string | null {
    const text = Buffer.isBuffer(raw)
        ? raw.toString('utf8')
        : (typeof raw === 'string' ? raw : '');
    const cleaned = text.replace(/^\uFEFF/, '').trim();
    if (cleaned && !/[\r\n]/.test(cleaned)) {
        return cleaned;
    }
    return null;
}

/**
 * Asynchronously resolve the user's real Windows Desktop folder (handling OneDrive
 * Known Folder Move) and cache it at process level for >= 60s (`WINDOWS_DESKTOP_CACHE_TTL_MS`).
 */
export async function resolveWindowsDesktopDirAsync(opts: CdpLauncherOptions = {}): Promise<string> {
    if (opts.desktopDir && opts.desktopDir.trim()) {
        return opts.desktopDir.trim();
    }
    const env = opts.env ?? process.env;
    const homeDir = resolveLauncherHomeDir(opts, 'win32');
    const key = desktopCacheKey(homeDir);
    const nowFn = opts.now ?? (() => Date.now());
    const ttlMs = opts.desktopCacheTtlMs ?? WINDOWS_DESKTOP_CACHE_TTL_MS;

    const cached = windowsDesktopDirCache.get(key);
    if (cached && nowFn() < cached.expiresAt) {
        return cached.dir;
    }

    const inFlight = windowsDesktopDirInFlight.get(key);
    if (inFlight) {
        return inFlight;
    }

    const fallback = getFastWindowsDesktopFallback(homeDir, env);
    const promise = (async () => {
        let resolved = fallback;
        if (process.platform === 'win32' || typeof opts.execFileAsyncFn === 'function') {
            try {
                const asyncRunner = createDefaultAsyncRunner(opts.execFileAsyncFn);
                const raw = await asyncRunner(
                    'powershell.exe',
                    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_DESKTOP_PS_SCRIPT],
                    { env, windowsHide: true, stdio: 'pipe', timeout: 3_000, encoding: 'utf8' },
                );
                const cleaned = parseSingleLinePsOutput(raw);
                if (cleaned) {
                    resolved = cleaned;
                }
            } catch {
                // Fallback cleanly to fast heuristic / %USERPROFILE%\Desktop
            }
        }
        windowsDesktopDirCache.set(key, {
            dir: resolved,
            expiresAt: nowFn() + ttlMs,
        });
        return resolved;
    })().finally(() => {
        windowsDesktopDirInFlight.delete(key);
    });

    windowsDesktopDirInFlight.set(key, promise);
    return promise;
}

/**
 * Force an asynchronous refresh of the cached Windows Desktop folder path.
 */
export async function refreshWindowsDesktopDirCache(opts: CdpLauncherOptions = {}): Promise<string> {
    const homeDir = resolveLauncherHomeDir(opts, 'win32');
    windowsDesktopDirCache.delete(desktopCacheKey(homeDir));
    return resolveWindowsDesktopDirAsync(opts);
}

/**
 * Non-blocking synchronous getter for the Windows Desktop folder path.
 * NEVER spawns synchronous `powershell.exe` during polling: returns the cached
 * value immediately if fresh, otherwise returns a zero-subprocess fallback while
 * triggering a deduplicated background async refresh.
 */
export function getCachedWindowsDesktopDir(opts: CdpLauncherOptions = {}): string {
    if (opts.desktopDir && opts.desktopDir.trim()) {
        return opts.desktopDir.trim();
    }
    const env = opts.env ?? process.env;
    const homeDir = resolveLauncherHomeDir(opts, 'win32');
    const key = desktopCacheKey(homeDir);
    const nowFn = opts.now ?? (() => Date.now());

    const cached = windowsDesktopDirCache.get(key);
    if (cached && nowFn() < cached.expiresAt) {
        return cached.dir;
    }

    if (process.platform === 'win32' || typeof opts.execFileAsyncFn === 'function') {
        void resolveWindowsDesktopDirAsync(opts).catch(() => { /* best-effort background warmup */ });
    }

    return cached?.dir ?? getFastWindowsDesktopFallback(homeDir, env);
}

/**
 * Resolve Windows Desktop for explicit user-initiated setup/remove actions:
 * uses the warm cache first, and only runs a single sync PowerShell query when the
 * cache is cold (populating the 60s cache for subsequent polls).
 */
function resolveWindowsDesktopDirForAction(
    opts: CdpLauncherOptions,
    homeDir: string,
    env: NodeJS.ProcessEnv,
): string {
    if (opts.desktopDir && opts.desktopDir.trim()) {
        return opts.desktopDir.trim();
    }
    const key = desktopCacheKey(homeDir);
    const nowFn = opts.now ?? (() => Date.now());
    const ttlMs = opts.desktopCacheTtlMs ?? WINDOWS_DESKTOP_CACHE_TTL_MS;
    const cached = windowsDesktopDirCache.get(key);
    if (cached && nowFn() < cached.expiresAt) {
        return cached.dir;
    }

    let resolved = getFastWindowsDesktopFallback(homeDir, env);
    if (process.platform === 'win32' || typeof opts.execFileSyncFn === 'function') {
        try {
            const runner = createDefaultRunner(opts.execFileSyncFn);
            const raw = runner(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_DESKTOP_PS_SCRIPT],
                { env, windowsHide: true, stdio: 'pipe', timeout: 3_000, encoding: 'utf8' },
            );
            const cleaned = parseSingleLinePsOutput(raw);
            if (cleaned) {
                resolved = cleaned;
            }
        } catch {
            // Fallback cleanly to %USERPROFILE%\Desktop
        }
    }
    windowsDesktopDirCache.set(key, {
        dir: resolved,
        expiresAt: nowFn() + ttlMs,
    });
    return resolved;
}

// ─── Windows Executable Detection (Async Registry Cache + Core Helpers) ──────

function resolveWindowsEnvDirs(homeDir: string, env: NodeJS.ProcessEnv): { localAppData: string; appData: string; defaultExe: string } {
    const localAppData = env.LOCALAPPDATA?.trim()
        ? env.LOCALAPPDATA.trim()
        : joinTargetPath('win32', homeDir, 'AppData', 'Local');
    const appData = env.APPDATA?.trim()
        ? env.APPDATA.trim()
        : joinTargetPath('win32', homeDir, 'AppData', 'Roaming');
    const defaultExe = joinTargetPath('win32', localAppData, 'Programs', 'Antigravity', 'Antigravity.exe');
    return { localAppData, appData, defaultExe };
}

function findWindowsExeFast(
    opts: CdpLauncherOptions,
    homeDir: string,
    env: NodeJS.ProcessEnv,
    localAppData: string,
    appData: string,
): string | null {
    if (opts.appPath?.trim()) {
        return opts.appPath.trim();
    }
    const fsMatch = getWindowsExeFilesystemCandidates(localAppData, env).find((p) => fs.existsSync(p));
    return fsMatch ?? findWindowsAntigravityExeFromShortcuts(homeDir, appData, env);
}

/**
 * Asynchronously probe Windows executable candidates including `%LOCALAPPDATA%`,
 * `%ProgramFiles%`, `%ProgramFiles(x86)%`, Start Menu `.lnk` shortcuts, and
 * Uninstall / App Paths registry keys (cached for >= 60s).
 */
export async function resolveWindowsAntigravityExeAsync(opts: CdpLauncherOptions = {}): Promise<string> {
    const env = opts.env ?? process.env;
    const homeDir = resolveLauncherHomeDir(opts, 'win32');
    const { localAppData, appData, defaultExe } = resolveWindowsEnvDirs(homeDir, env);

    const fastMatch = findWindowsExeFast(opts, homeDir, env, localAppData, appData);
    if (fastMatch) { return fastMatch; }

    const key = desktopCacheKey(homeDir);
    const nowFn = opts.now ?? (() => Date.now());
    const cached = windowsExeCache.get(key);
    if (cached && nowFn() < cached.expiresAt) {
        return cached.exePath || defaultExe;
    }

    let inFlight = windowsExeInFlight.get(key);
    if (!inFlight) {
        inFlight = (async (): Promise<string | null> => {
            let found: string | null = null;
            if (process.platform === 'win32' || typeof opts.execFileAsyncFn === 'function') {
                try {
                    const asyncRunner = createDefaultAsyncRunner(opts.execFileAsyncFn);
                    const raw = await asyncRunner(
                        'powershell.exe',
                        ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_EXE_REGISTRY_PS_SCRIPT],
                        { env, windowsHide: true, stdio: 'pipe', timeout: 3_000, encoding: 'utf8' },
                    );
                    const cleaned = parseSingleLinePsOutput(raw);
                    if (cleaned && /antigravity\.exe$/i.test(cleaned)) {
                        found = cleaned;
                    }
                } catch {
                    // Best-effort registry fallback
                }
            }
            windowsExeCache.set(key, {
                exePath: found,
                expiresAt: nowFn() + WINDOWS_EXE_CACHE_TTL_MS,
            });
            return found;
        })().finally(() => {
            windowsExeInFlight.delete(key);
        });
        windowsExeInFlight.set(key, inFlight);
    }

    const regFound = await inFlight;
    return regFound || defaultExe;
}

function resolveWindowsAntigravityExeSync(
    opts: CdpLauncherOptions,
    homeDir: string,
    env: NodeJS.ProcessEnv,
    localAppData: string,
    appData: string,
    defaultExe: string,
): string {
    const fastMatch = findWindowsExeFast(opts, homeDir, env, localAppData, appData);
    if (fastMatch) { return fastMatch; }
    const key = desktopCacheKey(homeDir);
    const nowFn = opts.now ?? (() => Date.now());
    const cached = windowsExeCache.get(key);
    if (cached && nowFn() < cached.expiresAt && cached.exePath) {
        return cached.exePath;
    }
    if (process.platform === 'win32' || typeof opts.execFileAsyncFn === 'function') {
        void resolveWindowsAntigravityExeAsync(opts).catch(() => { /* best-effort async registry warmup */ });
    }
    return cached?.exePath || defaultExe;
}

export function resolveCdpLauncherPaths(opts: CdpLauncherOptions = {}): ResolvedCdpLauncherPaths {
    const platform = opts.platform ?? process.platform;
    if (platform === 'win32') {
        const env = opts.env ?? process.env;
        const homeDir = resolveLauncherHomeDir(opts, 'win32');
        const { localAppData, appData, defaultExe } = resolveWindowsEnvDirs(homeDir, env);
        // Strictly non-blocking cached Desktop & exe lookup (NEVER spawns sync powershell.exe during polling)
        const winDesktopDir = getCachedWindowsDesktopDir({ ...opts, homeDir, env });
        const targetAppPath = resolveWindowsAntigravityExeSync(opts, homeDir, env, localAppData, appData, defaultExe);
        return resolveCoreCdpLauncherPaths({
            ...opts,
            platform,
            homeDir,
            env,
            desktopDir: winDesktopDir,
            appPath: targetAppPath,
        });
    }
    return resolveCoreCdpLauncherPaths(opts);
}

// ─── Legacy Windows .cmd Helper & Platform Icon/Shortcut Builders ────────────

/**
 * Legacy helper retained for backward compatibility with existing callers/exports.
 * Windows setup now points Desktop & Start Menu `.lnk` directly at `Antigravity.exe --remote-debugging-port=0`
 * and cleans up any legacy `launch-antigravity-cdp.cmd`.
 */
export function buildWindowsLauncherCmd(targetExePath?: string): string {
    const exeExpr = targetExePath && targetExePath.trim()
        ? targetExePath.trim().replace(/\//g, '\\').replace(/"/g, '')
        : '%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe';

    return [
        '@echo off',
        'setlocal EnableExtensions',
        'rem Zero-patch persistent CDP launcher generated by Antigravity Context Monitor.',
        `set "APP_EXE=${exeExpr}"`,
        'if not exist "%APP_EXE%" (',
        '  set "APP_EXE=%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe"',
        ')',
        'if not exist "%APP_EXE%" (',
        '  powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(\'Could not find Antigravity.exe. Please install Antigravity App first.\', \'Antigravity (CDP)\')" >nul 2>&1',
        '  exit /b 1',
        ')',
        '',
        'rem Check if Antigravity.exe is already running with --remote-debugging-port',
        'powershell -NoProfile -NonInteractive -Command "$p = Get-CimInstance Win32_Process -Filter \\"Name=\'Antigravity.exe\'\\" -ErrorAction SilentlyContinue; if ($p | Where-Object { $_.CommandLine -match \'--remote-debugging-port\' }) { exit 10 } elseif ($p) { exit 20 } else { exit 0 }" >nul 2>&1',
        'set "STATE=%ERRORLEVEL%"',
        '',
        'if "%STATE%"=="10" (',
        '  start "" "%APP_EXE%"',
        '  exit /b 0',
        ')',
        'if not "%STATE%"=="20" goto launch_cdp',
        '',
        'rem Wait up to 6 seconds in case Antigravity.exe is currently exiting.',
        'set /a TICKS=0',
        ':wait_loop',
        'tasklist /FI "IMAGENAME eq Antigravity.exe" 2>nul | find /I "Antigravity.exe" >nul',
        'if errorlevel 1 goto launch_cdp',
        'if %TICKS% GEQ 12 goto still_running',
        'set /a TICKS+=1',
        'powershell -NoProfile -NonInteractive -Command "Start-Sleep -Milliseconds 500" >nul 2>&1',
        'goto wait_loop',
        '',
        ':still_running',
        'powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(\'Antigravity is currently running without CDP remote debugging. Please close all Antigravity windows and tray icon first, then open Antigravity (CDP) again.\', \'Antigravity (CDP)\')" >nul 2>&1',
        'exit /b 0',
        '',
        ':launch_cdp',
        'start "" "%APP_EXE%" --remote-debugging-port=0',
        'exit /b 0',
        '',
    ].join('\r\n');
}

export const MACOS_ICON_BADGE_JXA = [
    'ObjC.import("AppKit");',
    'ObjC.import("Foundation");',
    'const env = $.NSProcessInfo.processInfo.environment;',
    'const srcPath = ObjC.unwrap(env.objectForKey("ACM_SRC_PNG"));',
    'const dstPath = ObjC.unwrap(env.objectForKey("ACM_DST_PNG"));',
    'const img = $.NSImage.alloc.initWithContentsOfFile(srcPath);',
    'if (!img || img.isNil()) { throw new Error("Failed to load base icon PNG"); }',
    'const size = 1024;',
    'const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, size, size, 8, 4, true, false, $.NSCalibratedRGBColorSpace, 0, 0);',
    'const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);',
    '$.NSGraphicsContext.saveGraphicsState;',
    '$.NSGraphicsContext.setCurrentContext(ctx);',
    'img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, size, size), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1.0);',
    'const badgeW = 468; const badgeH = 228; const badgeX = size - badgeW - 36; const badgeY = 44;',
    'const rect = $.NSMakeRect(badgeX, badgeY, badgeW, badgeH);',
    'const bp = $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius(rect, 60, 60);',
    'const shadow = $.NSShadow.alloc.init;',
    'shadow.setShadowColor($.NSColor.colorWithCalibratedRedGreenBlueAlpha(0, 0, 0, 0.58));',
    'shadow.setShadowOffset($.NSMakeSize(0, -10));',
    'shadow.setShadowBlurRadius(24);',
    'shadow.set;',
    '$.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.055, 0.082, 0.133, 0.96).setFill;',
    'bp.fill;',
    'const noShadow = $.NSShadow.alloc.init; noShadow.set;',
    '$.NSColor.colorWithCalibratedRedGreenBlueAlpha(0.357, 0.612, 0.965, 1.0).setStroke;',
    'bp.setLineWidth(14);',
    'bp.stroke;',
    'const font = $.NSFont.systemFontOfSizeWeight(152, $.NSFontWeightHeavy);',
    'const attrs = $.NSMutableDictionary.dictionary;',
    'attrs.setObjectForKey(font, $.NSFontAttributeName);',
    'attrs.setObjectForKey($.NSColor.whiteColor, $.NSForegroundColorAttributeName);',
    'const text = $.NSString.stringWithString("CDP");',
    'const textSize = text.sizeWithAttributes(attrs);',
    'const textX = badgeX + (badgeW - textSize.width) / 2;',
    'const textY = badgeY + (badgeH - textSize.height) / 2 - 4;',
    'text.drawAtPointWithAttributes($.NSMakePoint(textX, textY), attrs);',
    '$.NSGraphicsContext.restoreGraphicsState;',
    'const pngData = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $.NSDictionary.dictionary);',
    'if (!pngData.writeToFileAtomically(dstPath, true)) { throw new Error("Failed to write badged PNG"); }',
].join(' ');

export const WINDOWS_SHORTCUT_PS_SCRIPT = [
    '$ErrorActionPreference = "Stop"',
    '$iconLoc = ""',
    'if ($env:ACM_BADGE_ICON_PATH -and $env:ACM_TARGET_EXE -and (Test-Path -LiteralPath $env:ACM_TARGET_EXE)) {',
    '  try {',
    '    Add-Type -AssemblyName System.Drawing',
    '    $iconDir = Split-Path -Parent $env:ACM_BADGE_ICON_PATH',
    '    if ($iconDir -and -not (Test-Path -LiteralPath $iconDir)) { New-Item -ItemType Directory -Path $iconDir -Force | Out-Null }',
    '    $srcIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($env:ACM_TARGET_EXE)',
    '    if ($srcIcon) {',
    '      $srcBmp = $srcIcon.ToBitmap()',
    '      $size = 256',
    '      $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)',
    '      $g = [System.Drawing.Graphics]::FromImage($bmp)',
    '      try {',
    '        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias',
    '        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic',
    '        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality',
    '        $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit',
    '        $g.Clear([System.Drawing.Color]::Transparent)',
    '        $g.DrawImage($srcBmp, 0, 0, $size, $size)',
    '        $bw = 124; $bh = 62; $bx = $size - $bw - 8; $by = $size - $bh - 8; $r = 16; $d = $r * 2',
    '        $gp = New-Object System.Drawing.Drawing2D.GraphicsPath',
    '        $gp.AddArc($bx, $by, $d, $d, 180, 90)',
    '        $gp.AddArc($bx + $bw - $d, $by, $d, $d, 270, 90)',
    '        $gp.AddArc($bx + $bw - $d, $by + $bh - $d, $d, $d, 0, 90)',
    '        $gp.AddArc($bx, $by + $bh - $d, $d, $d, 90, 90)',
    '        $gp.CloseFigure()',
    '        $fillBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 14, 21, 34))',
    '        $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 91, 156, 246), 4)',
    '        $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)',
    '        $font = New-Object System.Drawing.Font("Segoe UI", 30, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)',
    '        $sf = New-Object System.Drawing.StringFormat',
    '        $sf.Alignment = [System.Drawing.StringAlignment]::Center',
    '        $sf.LineAlignment = [System.Drawing.StringAlignment]::Center',
    '        $g.FillPath($fillBrush, $gp)',
    '        $g.DrawPath($borderPen, $gp)',
    '        $rectF = New-Object System.Drawing.RectangleF($bx, $by + 1, $bw, $bh)',
    '        $g.DrawString("CDP", $font, $textBrush, $rectF, $sf)',
    '        $sf.Dispose(); $font.Dispose(); $textBrush.Dispose(); $borderPen.Dispose(); $fillBrush.Dispose(); $gp.Dispose()',
    '      } finally { $g.Dispose() }',
    '      $pngMs = New-Object System.IO.MemoryStream',
    '      try { $bmp.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png); $pngBytes = $pngMs.ToArray() } finally { $pngMs.Dispose(); $bmp.Dispose(); $srcBmp.Dispose(); $srcIcon.Dispose() }',
    '      $icoMs = New-Object System.IO.MemoryStream',
    '      $bwStream = New-Object System.IO.BinaryWriter($icoMs)',
    '      try {',
    '        $bwStream.Write([UInt16]0); $bwStream.Write([UInt16]1); $bwStream.Write([UInt16]1)',
    '        $bwStream.Write([Byte]0); $bwStream.Write([Byte]0); $bwStream.Write([Byte]0); $bwStream.Write([Byte]0)',
    '        $bwStream.Write([UInt16]1); $bwStream.Write([UInt16]32)',
    '        $bwStream.Write([UInt32]$pngBytes.Length); $bwStream.Write([UInt32]22)',
    '        $bwStream.Write($pngBytes); $bwStream.Flush()',
    '        [System.IO.File]::WriteAllBytes($env:ACM_BADGE_ICON_PATH, $icoMs.ToArray())',
    '        $iconLoc = "$env:ACM_BADGE_ICON_PATH,0"',
    '      } finally { $bwStream.Dispose(); $icoMs.Dispose() }',
    '    }',
    '  } catch {',
    '    if (Test-Path -LiteralPath $env:ACM_BADGE_ICON_PATH) { Remove-Item -LiteralPath $env:ACM_BADGE_ICON_PATH -Force -ErrorAction SilentlyContinue }',
    '    $iconLoc = ""',
    '  }',
    '}',
    'if (-not $iconLoc -and $env:ACM_TARGET_EXE -and (Test-Path -LiteralPath $env:ACM_TARGET_EXE)) { $iconLoc = "$env:ACM_TARGET_EXE,0" }',
    '$ws = New-Object -ComObject WScript.Shell',
    '$targets = @($env:ACM_LNK_DESKTOP, $env:ACM_LNK_STARTMENU) | Where-Object { $_ -and $_.Trim().Length -gt 0 }',
    'foreach ($lnkPath in $targets) {',
    '  $dir = Split-Path -Parent $lnkPath',
    '  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
    '  $sc = $ws.CreateShortcut($lnkPath)',
    '  $sc.TargetPath = $env:ACM_TARGET_EXE',
    '  $sc.Arguments = "--remote-debugging-port=0"',
    '  $sc.WorkingDirectory = $env:ACM_WORKDIR',
    '  $sc.WindowStyle = 1',
    '  $sc.Description = "Launch Antigravity with CDP remote debugging enabled (zero-patch)"',
    '  if ($iconLoc) { $sc.IconLocation = $iconLoc }',
    '  $sc.Save()',
    '}',
].join('\n');

function generateMacOsBadgedIcon(
    srcIcnsPath: string,
    destIcnsPath: string,
    opts: CdpLauncherOptions,
): boolean {
    if (process.platform !== 'darwin' && typeof opts.execFileSyncFn !== 'function') {
        return false;
    }
    const runner = createDefaultRunner(opts.execFileSyncFn);
    const env = opts.env ?? process.env;
    let tmpDir: string | null = null;
    try {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-mac-icon-'));
        const basePng = path.join(tmpDir, 'base.png');
        const badgedPng = path.join(tmpDir, 'badged.png');
        const iconsetDir = path.join(tmpDir, 'icon.iconset');

        runner('sips', ['-s', 'format', 'png', '-z', '1024', '1024', srcIcnsPath, '--out', basePng], {
            env,
            stdio: 'pipe',
            timeout: 5_000,
        });
        runner('osascript', ['-l', 'JavaScript', '-e', MACOS_ICON_BADGE_JXA], {
            env: { ...env, ACM_SRC_PNG: basePng, ACM_DST_PNG: badgedPng },
            stdio: 'pipe',
            timeout: 8_000,
        });

        fs.mkdirSync(iconsetDir, { recursive: true });
        const iconsetSizes: Array<[string, number]> = [
            ['icon_16x16.png', 16],
            ['icon_16x16@2x.png', 32],
            ['icon_32x32.png', 32],
            ['icon_32x32@2x.png', 64],
            ['icon_128x128.png', 128],
            ['icon_128x128@2x.png', 256],
            ['icon_256x256.png', 256],
            ['icon_256x256@2x.png', 512],
            ['icon_512x512.png', 512],
            ['icon_512x512@2x.png', 1024],
        ];
        for (const [filename, px] of iconsetSizes) {
            const outPng = path.join(iconsetDir, filename);
            if (px === 1024 && fs.existsSync(badgedPng)) {
                fs.copyFileSync(badgedPng, outPng);
            } else {
                runner('sips', ['-z', String(px), String(px), badgedPng, '--out', outPng], {
                    env,
                    stdio: 'pipe',
                    timeout: 5_000,
                });
            }
        }
        runner('iconutil', ['-c', 'icns', iconsetDir, '-o', destIcnsPath], {
            env,
            stdio: 'pipe',
            timeout: 5_000,
        });
        return fs.existsSync(destIcnsPath) && fs.statSync(destIcnsPath).size > 0;
    } catch {
        return false;
    } finally {
        if (tmpDir) {
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }
}

function copyMacOsIconIfPresent(
    targetAppPath: string,
    resourcesDir: string,
    opts: CdpLauncherOptions = {},
): boolean {
    const srcResources = path.join(targetAppPath, 'Contents', 'Resources');
    const preferred = [
        path.join(srcResources, 'icon.icns'),
        path.join(srcResources, 'Antigravity.icns'),
        path.join(srcResources, 'electron.icns'),
    ];
    const destIcns = path.join(resourcesDir, 'icon.icns');
    for (const candidate of preferred) {
        if (!fs.existsSync(candidate)) { continue; }
        if (generateMacOsBadgedIcon(candidate, destIcns, opts)) {
            return true;
        }
        try {
            fs.copyFileSync(candidate, destIcns);
            return true;
        } catch {
            // Best-effort icon copy fallback
        }
    }
    return false;
}

function findLinuxOriginalIcon(
    homeDir: string,
    targetAppPath: string,
    xdgDataHome?: string,
): { mimeType: 'image/png' | 'image/svg+xml'; base64: string } | undefined {
    const candidates: string[] = [];
    if (targetAppPath && targetAppPath.includes('/')) {
        const binDir = path.dirname(targetAppPath);
        candidates.push(
            path.join(binDir, 'antigravity.png'),
            path.join(binDir, 'antigravity.svg'),
            path.join(binDir, 'icon.png'),
            path.join(binDir, 'resources', 'app', 'resources', 'linux', 'code.png'),
        );
    }
    if (xdgDataHome) {
        candidates.push(
            joinTargetPath('linux', xdgDataHome, 'icons', 'hicolor', 'scalable', 'apps', 'antigravity.svg'),
            joinTargetPath('linux', xdgDataHome, 'icons', 'hicolor', '256x256', 'apps', 'antigravity.png'),
        );
    }
    candidates.push(
        '/usr/share/pixmaps/antigravity.png',
        '/usr/share/pixmaps/antigravity.svg',
        '/usr/share/icons/hicolor/512x512/apps/antigravity.png',
        '/usr/share/icons/hicolor/256x256/apps/antigravity.png',
        '/usr/share/icons/hicolor/128x128/apps/antigravity.png',
        '/usr/share/icons/hicolor/scalable/apps/antigravity.svg',
        '/opt/Antigravity/antigravity.png',
        '/snap/antigravity/current/meta/gui/icon.png',
        '/snap/antigravity/current/meta/gui/icon.svg',
        joinTargetPath('linux', homeDir, '.local', 'share', 'icons', 'hicolor', 'scalable', 'apps', 'antigravity.svg'),
        joinTargetPath('linux', homeDir, '.local', 'share', 'icons', 'hicolor', '256x256', 'apps', 'antigravity.png'),
    );

    for (const candidate of candidates) {
        try {
            if (!fs.existsSync(candidate)) { continue; }
            const st = fs.statSync(candidate);
            if (!st.isFile() || st.size === 0 || st.size > MAX_EMBEDDED_ICON_BYTES) { continue; }
            const raw = fs.readFileSync(candidate);
            const mimeType = candidate.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png';
            return { mimeType, base64: raw.toString('base64') };
        } catch {
            // Try next candidate
        }
    }
    return undefined;
}

function writeLinuxBadgedIcon(
    iconPath: string,
    homeDir: string,
    targetAppPath: string,
    xdgDataHome?: string,
): boolean {
    try {
        fs.mkdirSync(path.dirname(iconPath), { recursive: true });
        const embedded = findLinuxOriginalIcon(homeDir, targetAppPath, xdgDataHome);
        fs.writeFileSync(iconPath, buildLinuxBadgedSvg(embedded), 'utf8');
        return true;
    } catch {
        return false;
    }
}

function runLinuxUpdateDesktopDatabase(applicationsDir: string, opts: CdpLauncherOptions): void {
    if (process.platform !== 'linux' && typeof opts.execFileSyncFn !== 'function') {
        return;
    }
    try {
        const runner = createDefaultRunner(opts.execFileSyncFn);
        runner('update-desktop-database', [applicationsDir], {
            env: opts.env ?? process.env,
            stdio: 'ignore',
            timeout: 5_000,
        });
    } catch {
        // Best-effort — update-desktop-database may not be installed on minimal systems
    }
}

// ─── Public API: Inspect, Create, Reveal, Remove ─────────────────────────────

export function inspectCdpLauncher(opts: CdpLauncherOptions = {}): CdpLauncherStatus {
    const resolved = resolveCdpLauncherPaths(opts);
    const safeTerminalCommand = getSafeCdpLaunchCommand(resolved.platform);
    const { noteEn, noteZh } = getCdpLauncherPlatformNotes(resolved.platform, resolved.launcherPath);

    let installed = false;
    let targetAppFound = false;

    if (resolved.platform === 'darwin') {
        const candidates = resolved.macCandidateAppDirs ?? (resolved.macAppDir ? [resolved.macAppDir] : []);
        installed = candidates.some((dir) => isMacAppBundleInstalled(dir));
        targetAppFound = Boolean(resolved.targetAppPath && fs.existsSync(resolved.targetAppPath));
    } else if (resolved.platform === 'win32' && resolved.winDesktopLnkPath && resolved.winStartMenuLnkPath) {
        const hasDesktopLnk = fs.existsSync(resolved.winDesktopLnkPath)
            || Boolean(
                resolved.winFallbackDesktopLnkPath
                && resolved.winFallbackDesktopLnkPath.toLowerCase() !== resolved.winDesktopLnkPath.toLowerCase()
                && fs.existsSync(resolved.winFallbackDesktopLnkPath),
            );
        installed = hasDesktopLnk || fs.existsSync(resolved.winStartMenuLnkPath);
        targetAppFound = Boolean(resolved.targetAppPath && fs.existsSync(resolved.targetAppPath));
    } else if (resolved.platform === 'linux' && resolved.linuxDesktopEntryPath && resolved.linuxWrapperPath) {
        installed = fs.existsSync(resolved.linuxDesktopEntryPath) && fs.existsSync(resolved.linuxWrapperPath);
        const existsFn = opts.commandExistsFn ?? ((cmd: string) => defaultCommandExists(cmd, opts.env ?? process.env));
        if (resolved.targetAppPath && resolved.targetAppPath.startsWith('flatpak:')) {
            targetAppFound = existsFn('flatpak');
        } else if (resolved.targetAppPath && resolved.targetAppPath !== 'antigravity') {
            targetAppFound = fs.existsSync(resolved.targetAppPath);
        } else {
            targetAppFound = existsFn('antigravity');
        }
    }

    return {
        supported: resolved.supported,
        platform: resolved.platform,
        installed,
        launcherPath: resolved.launcherPath,
        displayName: CDP_LAUNCHER_DISPLAY_NAME,
        targetAppFound,
        ...(resolved.targetAppPath ? { targetAppPath: resolved.targetAppPath } : {}),
        safeTerminalCommand,
        noteEn,
        noteZh,
    };
}

function writeMacOsBundleAt(appDir: string, targetAppPath: string, opts: CdpLauncherOptions): void {
    assertSafeMacOsBundleWriteTarget(appDir);

    const contentsDir = path.join(appDir, 'Contents');
    const macOsDir = path.join(contentsDir, 'MacOS');
    const resourcesDir = path.join(contentsDir, 'Resources');

    fs.mkdirSync(macOsDir, { recursive: true });
    fs.mkdirSync(resourcesDir, { recursive: true });

    fs.writeFileSync(path.join(contentsDir, 'Info.plist'), buildMacOsInfoPlist(), 'utf8');
    const launchScriptPath = path.join(macOsDir, 'launch');
    fs.writeFileSync(launchScriptPath, buildMacOsLauncherScript(targetAppPath), 'utf8');
    fs.chmodSync(launchScriptPath, 0o755);

    if (targetAppPath) {
        copyMacOsIconIfPresent(targetAppPath, resourcesDir, opts);
    }

    try {
        const now = new Date();
        fs.utimesSync(appDir, now, now);
    } catch {
        // Best-effort Finder icon cache refresh
    }
}

function resolveEffectiveLauncherOpts(opts: CdpLauncherOptions): {
    effectiveOpts: CdpLauncherOptions;
    resolved: ResolvedCdpLauncherPaths;
} {
    const platform = opts.platform ?? process.platform;
    const env = opts.env ?? process.env;
    const homeDir = resolveLauncherHomeDir(opts, platform);
    const effectiveOpts: CdpLauncherOptions = platform === 'win32'
        ? { ...opts, desktopDir: resolveWindowsDesktopDirForAction(opts, homeDir, env) }
        : opts;
    return { effectiveOpts, resolved: resolveCdpLauncherPaths(effectiveOpts) };
}

function cleanupEmptyDir(filePath: string | undefined): void {
    if (!filePath) { return; }
    const dir = dirnameTargetPath('win32', filePath);
    try {
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
            fs.rmdirSync(dir);
        }
    } catch {
        // Best-effort empty directory cleanup
    }
}

function buildLauncherFailureResult(
    resolved: ResolvedCdpLauncherPaths,
    effectiveOpts: CdpLauncherOptions,
    err: unknown,
    verbEn: string,
    verbZh: string,
): CdpLauncherActionResult {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const status = inspectCdpLauncher(
        resolved.winDesktopDir ? { ...effectiveOpts, desktopDir: resolved.winDesktopDir } : effectiveOpts,
    );
    return {
        ok: false,
        status,
        messageEn: `Failed to ${verbEn} persistent CDP launcher: ${errorMsg}`,
        messageZh: `${verbZh}持久化 CDP 启动器失败：${errorMsg}`,
        error: errorMsg,
    };
}

export function createCdpLauncher(opts: CdpLauncherOptions = {}): CdpLauncherActionResult {
    const { effectiveOpts, resolved } = resolveEffectiveLauncherOpts(opts);
    if (!resolved.supported) {
        return buildUnsupportedLauncherResult(inspectCdpLauncher(effectiveOpts), 'create', '创建');
    }

    try {
        if (resolved.platform === 'darwin' && resolved.macPreferredAppDir) {
            const primaryDir = resolved.macPreferredAppDir;
            const fallbackDir = resolved.macUserAppDir ?? primaryDir;
            let createdDir = primaryDir;

            try {
                writeMacOsBundleAt(primaryDir, resolved.targetAppPath, effectiveOpts);
            } catch (err) {
                const code = (err as NodeJS.ErrnoException)?.code;
                const isPermError = code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
                if (isPermError && normalizePosixComparable(primaryDir) !== normalizePosixComparable(fallbackDir)) {
                    createdDir = fallbackDir;
                    writeMacOsBundleAt(fallbackDir, resolved.targetAppPath, effectiveOpts);
                } else {
                    throw err;
                }
            }

            // Auto-remove stale `Antigravity (CDP).app` in the alternate candidate dir ONLY
            // after verifying it is not a symlink and matches our exact CFBundleIdentifier.
            const createdNorm = normalizePosixComparable(createdDir);
            for (const candidate of resolved.macCandidateAppDirs ?? []) {
                if (
                    normalizePosixComparable(candidate) !== createdNorm
                    && isOwnedMacCdpBundle(candidate)
                ) {
                    try {
                        fs.rmSync(candidate, { recursive: true, force: true });
                    } catch {
                        // Best-effort cleanup if stale dir is in an unwritable location
                    }
                }
            }

            const status = inspectCdpLauncher({ ...effectiveOpts, preferredMacAppDir: createdDir });
            return {
                ok: true,
                status,
                messageEn: `Created persistent macOS launcher at "${status.launcherPath}". Click "Reveal in Finder" and drag "Antigravity (CDP).app" from Finder into your Dock — NEVER right-click the running Antigravity icon to choose "Keep in Dock" (that saves argless Antigravity.app).`,
                messageZh: `已创建带 CDP 角标的 macOS 持久化启动器："${status.launcherPath}"。请点击「在访达中显示」并从访达拖入程序坞固定——切勿右键正在运行的 Antigravity 图标选「在程序坞中保留」（否则会保存无参原版）。`,
            };
        }

        if (resolved.platform === 'win32' && resolved.winDesktopLnkPath && resolved.winStartMenuLnkPath) {
            // Clean up legacy `.cmd` wrapper if present from earlier versions
            if (resolved.winCmdPath && fs.existsSync(resolved.winCmdPath)) {
                try {
                    fs.rmSync(resolved.winCmdPath, { force: true });
                } catch {
                    // Best-effort legacy cleanup
                }
            }

            const runner = createDefaultRunner(effectiveOpts.execFileSyncFn);
            const targetExe = resolved.targetAppPath;
            const psEnv: NodeJS.ProcessEnv = {
                ...(effectiveOpts.env ?? process.env),
                ACM_LNK_DESKTOP: resolved.winDesktopLnkPath,
                ACM_LNK_STARTMENU: resolved.winStartMenuLnkPath,
                ACM_TARGET_EXE: targetExe,
                ACM_WORKDIR: dirnameTargetPath('win32', targetExe),
                ACM_BADGE_ICON_PATH: resolved.winIconPath || '',
            };

            runner(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SHORTCUT_PS_SCRIPT],
                { env: psEnv, windowsHide: true, stdio: 'pipe', timeout: 15_000 },
            );

            // Clean up stale fallback Desktop `.lnk` if OneDrive redirected Desktop succeeded
            if (
                resolved.winFallbackDesktopLnkPath
                && resolved.winFallbackDesktopLnkPath.toLowerCase() !== resolved.winDesktopLnkPath.toLowerCase()
                && fs.existsSync(resolved.winDesktopLnkPath)
                && fs.existsSync(resolved.winFallbackDesktopLnkPath)
            ) {
                try {
                    fs.rmSync(resolved.winFallbackDesktopLnkPath, { force: true });
                } catch {
                    // Best-effort stale shortcut cleanup
                }
            }

            // If plugin data dir is empty (e.g. legacy .cmd removed and .ico fell back), tidy it up
            cleanupEmptyDir(resolved.winCmdPath);

            const status = inspectCdpLauncher({ ...effectiveOpts, desktopDir: resolved.winDesktopDir });
            return {
                ok: true,
                status,
                messageEn: `Created direct Windows CDP shortcuts (Desktop & Start Menu) pointing to Antigravity.exe --remote-debugging-port=0 at "${status.launcherPath}". Right-click "Antigravity (CDP)" to Pin to Taskbar (avoid pinning the running taskbar icon directly).`,
                messageZh: `已创建直连 Antigravity.exe --remote-debugging-port=0 的 Windows 持久化快捷方式（桌面与开始菜单）："${status.launcherPath}"。可右键「Antigravity (CDP)」快捷方式直接「固定到任务栏」（无黑框闪烁；请勿右键运行中的任务栏图标固定）。`,
            };
        }

        if (resolved.platform === 'linux' && resolved.linuxWrapperPath && resolved.linuxDesktopEntryPath) {
            fs.mkdirSync(path.dirname(resolved.linuxWrapperPath), { recursive: true });
            const applicationsDir = path.dirname(resolved.linuxDesktopEntryPath);
            fs.mkdirSync(applicationsDir, { recursive: true });

            fs.writeFileSync(resolved.linuxWrapperPath, buildLinuxLauncherScript(resolved.targetAppPath), 'utf8');
            if (process.platform !== 'win32') {
                fs.chmodSync(resolved.linuxWrapperPath, 0o755);
            }

            const iconWritten = resolved.linuxIconPath
                ? writeLinuxBadgedIcon(
                    resolved.linuxIconPath,
                    resolved.homeDir,
                    resolved.targetAppPath,
                    resolved.linuxXdgDataHome,
                )
                : false;
            const iconValue = iconWritten && resolved.linuxIconPath ? resolved.linuxIconPath : 'antigravity';

            fs.writeFileSync(
                resolved.linuxDesktopEntryPath,
                buildLinuxDesktopEntry(resolved.linuxWrapperPath, iconValue),
                'utf8',
            );

            runLinuxUpdateDesktopDatabase(applicationsDir, effectiveOpts);

            const status = inspectCdpLauncher(effectiveOpts);
            return {
                ok: true,
                status,
                messageEn: `Created persistent Linux CDP launcher at "${resolved.linuxDesktopEntryPath}" (wrapper: "${resolved.linuxWrapperPath}"). Pin "Antigravity (CDP)" from Show Apps / Application Launcher ("Pin to Dash" / "Add to Favorites") rather than pinning the running Dock window icon.`,
                messageZh: `已创建 Linux 持久化 CDP 启动入口："${resolved.linuxDesktopEntryPath}"（脚本："${resolved.linuxWrapperPath}"）。请在「显示应用」菜单中搜索「Antigravity (CDP)」并「固定到停靠栏 / 添加到收藏夹」，切勿右键运行中的窗口图标固定。`,
            };
        }

        const status = inspectCdpLauncher(effectiveOpts);
        return {
            ok: false,
            status,
            messageEn: 'Failed to resolve persistent launcher paths.',
            messageZh: '无法解析持久化启动器路径。',
            error: 'Unresolved launcher paths',
        };
    } catch (err) {
        return buildLauncherFailureResult(resolved, effectiveOpts, err, 'create', '创建');
    }
}

function resolveRevealSpawnFn(opts: CdpLauncherOptions) {
    return opts.spawnImpl
        ?? ((
            command: string,
            args: readonly string[],
            options?: CdpLauncherSpawnOptions,
        ) => spawn(command, [...args], {
            detached: options?.detached ?? true,
            stdio: options?.stdio ?? 'ignore',
            windowsHide: options?.windowsHide ?? true,
            ...(options?.shell !== undefined ? { shell: options.shell } : {}),
            ...(options?.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
        }));
}

function resolveWindowsRevealTargets(
    status: CdpLauncherStatus,
    resolved: ResolvedCdpLauncherPaths,
): { selectTarget: string; parentDir: string } {
    const selectTarget = fs.existsSync(status.launcherPath)
        ? status.launcherPath
        : (resolved.winFallbackDesktopLnkPath && fs.existsSync(resolved.winFallbackDesktopLnkPath)
            ? resolved.winFallbackDesktopLnkPath
            : (resolved.winStartMenuLnkPath && fs.existsSync(resolved.winStartMenuLnkPath)
                ? resolved.winStartMenuLnkPath
                : ''));
    const parentDir = dirnameTargetPath('win32', selectTarget || status.launcherPath);
    return { selectTarget, parentDir };
}

function attachListener(
    child: SpawnedLauncherProcessLike,
    event: string,
    listener: (...args: any[]) => void,
    once = false,
): void {
    if (once && typeof child.once === 'function') {
        child.once(event, listener);
    } else if (typeof child.on === 'function') {
        child.on(event, listener);
    }
}

function detachListener(
    child: SpawnedLauncherProcessLike,
    event: string,
    listener: (...args: any[]) => void,
): void {
    if (typeof child.off === 'function') {
        child.off(event, listener);
    } else if (typeof child.removeListener === 'function') {
        child.removeListener(event, listener);
    }
}

async function launchRevealProcessAndWait(
    spawnFn: NonNullable<CdpLauncherOptions['spawnImpl']>,
    command: string,
    args: readonly string[],
    options: CdpLauncherSpawnOptions,
    waitOpts: { checkEarlyExit: boolean; settleMs: number; spawnTimeoutMs: number },
): Promise<void> {
    const child = spawnFn(command, args, options);
    if (!child) {
        throw new Error(`Failed to spawn reveal helper "${command}"`);
    }

    await new Promise<void>((resolvePromise, rejectPromise) => {
        let settled = false;
        let spawned = false;
        let spawnTimer: ReturnType<typeof setTimeout> | null = null;
        let settleTimer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
            if (spawnTimer) { clearTimeout(spawnTimer); spawnTimer = null; }
            if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
            detachListener(child, 'error', onError);
            detachListener(child, 'spawn', onSpawn);
            detachListener(child, 'exit', onExit);
            // Keep a no-op error listener after settling to prevent unhandled post-settle EventEmitter errors
            if (typeof child.on === 'function') {
                child.on('error', () => { /* already settled */ });
            }
        };

        const finishOk = () => {
            if (settled) { return; }
            settled = true;
            cleanup();
            child.unref?.();
            resolvePromise();
        };

        const finishErr = (err: Error) => {
            if (settled) { return; }
            settled = true;
            cleanup();
            rejectPromise(err);
        };

        const onError = (err: unknown) => {
            const errorObj = err instanceof Error ? err : new Error(String(err || `Failed to spawn "${command}"`));
            finishErr(errorObj);
        };

        const onExit = (code: unknown, signal: unknown) => {
            if (settled) { return; }
            if (waitOpts.checkEarlyExit) {
                if (code === 0 && !signal) {
                    finishOk();
                } else {
                    const detail = signal ? `signal ${String(signal)}` : `exit code ${String(code ?? 'unknown')}`;
                    finishErr(new Error(`Reveal helper "${command}" failed (${detail})`));
                }
            } else if (spawned) {
                // On Windows, explorer.exe commonly exits with code 1 even on success when delegating
                // to the running shell, so once 'spawn' succeeded do not treat exit code as failure.
                finishOk();
            }
        };

        const onSpawn = () => {
            if (settled) { return; }
            spawned = true;
            if (spawnTimer) { clearTimeout(spawnTimer); spawnTimer = null; }
            if (!waitOpts.checkEarlyExit || waitOpts.settleMs <= 0) {
                finishOk();
                return;
            }
            settleTimer = setTimeout(() => {
                finishOk();
            }, waitOpts.settleMs);
            settleTimer.unref?.();
        };

        attachListener(child, 'error', onError, true);
        attachListener(child, 'spawn', onSpawn, true);
        attachListener(child, 'exit', onExit, true);

        if (settled) { return; }

        spawnTimer = setTimeout(() => {
            finishErr(new Error(`Timed out waiting for reveal helper "${command}" to spawn`));
        }, waitOpts.spawnTimeoutMs);
        spawnTimer.unref?.();
    });
}

function buildUnsupportedLauncherResult(
    status: CdpLauncherStatus,
    actionEn: string,
    actionZh: string,
): CdpLauncherActionResult {
    return {
        ok: false,
        status,
        messageEn: `Persistent CDP launcher is not supported on ${status.platform}.`,
        messageZh: `当前平台 ${status.platform} 不支持${actionZh}持久化 CDP 启动器。`,
        error: `Unsupported platform: ${status.platform}`,
    };
}

function resolveRevealTargetAndOutcome(
    opts: CdpLauncherOptions,
): { status: CdpLauncherStatus; resolved: ResolvedCdpLauncherPaths; earlyError?: CdpLauncherActionResult } {
    const resolved = resolveCdpLauncherPaths(opts);
    const status = inspectCdpLauncher(
        resolved.winDesktopDir ? { ...opts, desktopDir: resolved.winDesktopDir } : opts,
    );
    if (!status.supported) {
        return { status, resolved, earlyError: buildUnsupportedLauncherResult(status, 'reveal', '定位') };
    }
    if (!status.installed) {
        return {
            status,
            resolved,
            earlyError: {
                ok: false,
                status,
                messageEn: 'Persistent CDP launcher has not been created yet. Click "Create Persistent Launcher" first.',
                messageZh: '尚未创建持久化 CDP 启动器，请先点击「一键生成持久化启动器」。',
                error: 'Launcher not created yet',
            },
        };
    }
    return { status, resolved };
}

function buildRevealSuccessResult(status: CdpLauncherStatus, target: string): CdpLauncherActionResult {
    if (status.platform === 'darwin') {
        return {
            ok: true,
            status,
            messageEn: `Revealed "${target}" in Finder. Drag "Antigravity (CDP).app" from Finder into your Dock — NEVER right-click the running Antigravity icon to choose "Keep in Dock".`,
            messageZh: `已在访达中定位「${target}」。请直接从访达拖入程序坞固定——切勿右键运行中的图标选「在程序坞中保留」。`,
        };
    }
    if (status.platform === 'win32') {
        return {
            ok: true,
            status,
            messageEn: `Opened Explorer at "${target}". Launch "Antigravity (CDP)" (or right-click it -> Pin to taskbar) to keep CDP enabled.`,
            messageZh: `已在资源管理器中定位「${target}」。请从该「Antigravity (CDP)」快捷方式启动（或右键「固定到任务栏」）。`,
        };
    }
    return {
        ok: true,
        status,
        messageEn: `Opened launcher folder "${target}". Launch or pin "Antigravity (CDP)" from Show Apps / Application Launcher (not the running Dock icon).`,
        messageZh: `已打开启动器目录「${target}」。请从「显示应用」菜单启动或固定「Antigravity (CDP)」（勿右键运行中的窗口图标固定）。`,
    };
}

function buildRevealFailureResult(status: CdpLauncherStatus, err: unknown): CdpLauncherActionResult {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
        ok: false,
        status,
        messageEn: `Failed to reveal persistent CDP launcher: ${errorMsg}`,
        messageZh: `无法打开持久化 CDP 启动器位置：${errorMsg}`,
        error: errorMsg,
    };
}

/**
 * Asynchronous reveal helper that waits for the actual child-process spawn outcome
 * (`'spawn'` vs async `'error'`, plus early non-zero exit verification for `xdg-open`
 * and `open`) so failed spawns NEVER return false success.
 */
export async function revealCdpLauncherAsync(opts: CdpLauncherOptions = {}): Promise<CdpLauncherActionResult> {
    const { status, resolved, earlyError } = resolveRevealTargetAndOutcome(opts);
    if (earlyError) { return earlyError; }

    const spawnFn = resolveRevealSpawnFn(opts);
    const defaultSpawnOpts: CdpLauncherSpawnOptions = { detached: true, stdio: 'ignore', windowsHide: true };
    const settleMs = typeof opts.revealSettleMs === 'number' ? Math.max(0, opts.revealSettleMs) : 150;
    const spawnTimeoutMs = typeof opts.revealSpawnTimeoutMs === 'number' ? Math.max(50, opts.revealSpawnTimeoutMs) : 3_000;

    try {
        if (status.platform === 'darwin') {
            await launchRevealProcessAndWait(spawnFn, 'open', ['-R', status.launcherPath], defaultSpawnOpts, {
                checkEarlyExit: true,
                settleMs,
                spawnTimeoutMs,
            });
            return buildRevealSuccessResult(status, status.launcherPath);
        }

        if (status.platform === 'win32') {
            const { selectTarget, parentDir } = resolveWindowsRevealTargets(status, resolved);
            let revealedTarget = selectTarget || parentDir;
            const winWait = { checkEarlyExit: false, settleMs: 0, spawnTimeoutMs };
            if (selectTarget) {
                try {
                    const selectSpec = buildWindowsExplorerRevealCommand(selectTarget, false);
                    await launchRevealProcessAndWait(spawnFn, selectSpec.cmd, selectSpec.args, selectSpec.options, winWait);
                } catch {
                    const dirSpec = buildWindowsExplorerRevealCommand(parentDir, true);
                    await launchRevealProcessAndWait(spawnFn, dirSpec.cmd, dirSpec.args, dirSpec.options, winWait);
                    revealedTarget = parentDir;
                }
            } else {
                const dirSpec = buildWindowsExplorerRevealCommand(parentDir, true);
                await launchRevealProcessAndWait(spawnFn, dirSpec.cmd, dirSpec.args, dirSpec.options, winWait);
            }
            return buildRevealSuccessResult(status, revealedTarget);
        }

        if (status.platform === 'linux') {
            const folderPath = dirnameTargetPath('linux', status.launcherPath);
            await launchRevealProcessAndWait(spawnFn, 'xdg-open', [folderPath], defaultSpawnOpts, {
                checkEarlyExit: true,
                settleMs,
                spawnTimeoutMs,
            });
            return buildRevealSuccessResult(status, folderPath);
        }

        return buildUnsupportedLauncherResult(status, 'reveal', '定位');
    } catch (err) {
        return buildRevealFailureResult(status, err);
    }
}

export function revealCdpLauncher(opts: CdpLauncherOptions = {}): CdpLauncherActionResult {
    const { status, resolved, earlyError } = resolveRevealTargetAndOutcome(opts);
    if (earlyError) { return earlyError; }

    const usingDefaultSpawn = !opts.spawnImpl;
    const spawnFn = resolveRevealSpawnFn(opts);
    const defaultSpawnOpts: CdpLauncherSpawnOptions = { detached: true, stdio: 'ignore', windowsHide: true };
    const launchDetached = (
        command: string,
        args: readonly string[],
        options: CdpLauncherSpawnOptions = defaultSpawnOpts,
    ): void => {
        if (usingDefaultSpawn && status.platform === 'linux') {
            const existsFn = opts.commandExistsFn ?? ((cmd: string) => defaultCommandExists(cmd, opts.env ?? process.env));
            if (!existsFn(command)) {
                throw new Error(`Reveal helper "${command}" was not found on PATH`);
            }
        }
        const child = spawnFn(command, args, options);
        if (!child) {
            throw new Error(`Failed to spawn reveal helper "${command}"`);
        }
        let syncError: Error | null = null;
        child.on?.('error', (err: unknown) => {
            syncError = err instanceof Error ? err : new Error(String(err || `Failed to spawn "${command}"`));
        });
        if (syncError) {
            throw syncError;
        }
        // In Node.js, failed OS spawn (e.g. ENOENT/EACCES) leaves `child.pid === undefined` synchronously
        // before emitting the async 'error' event — fail honestly instead of reporting false success.
        if ((usingDefaultSpawn || 'pid' in child) && (typeof child.pid !== 'number' || child.pid <= 0)) {
            throw new Error(`Failed to spawn reveal helper "${command}" (no process ID assigned)`);
        }
        child.unref?.();
    };

    try {
        if (status.platform === 'darwin') {
            launchDetached('open', ['-R', status.launcherPath]);
            return buildRevealSuccessResult(status, status.launcherPath);
        }

        if (status.platform === 'win32') {
            const { selectTarget, parentDir } = resolveWindowsRevealTargets(status, resolved);
            let revealedTarget = selectTarget || parentDir;
            if (selectTarget) {
                try {
                    const selectSpec = buildWindowsExplorerRevealCommand(selectTarget, false);
                    launchDetached(selectSpec.cmd, selectSpec.args, selectSpec.options);
                } catch {
                    const dirSpec = buildWindowsExplorerRevealCommand(parentDir, true);
                    launchDetached(dirSpec.cmd, dirSpec.args, dirSpec.options);
                    revealedTarget = parentDir;
                }
            } else {
                const dirSpec = buildWindowsExplorerRevealCommand(parentDir, true);
                launchDetached(dirSpec.cmd, dirSpec.args, dirSpec.options);
            }
            return buildRevealSuccessResult(status, revealedTarget);
        }

        if (status.platform === 'linux') {
            const folderPath = dirnameTargetPath('linux', status.launcherPath);
            launchDetached('xdg-open', [folderPath]);
            return buildRevealSuccessResult(status, folderPath);
        }

        return buildUnsupportedLauncherResult(status, 'reveal', '定位');
    } catch (err) {
        return buildRevealFailureResult(status, err);
    }
}

export function removeCdpLauncher(opts: CdpLauncherOptions = {}): CdpLauncherActionResult {
    const { effectiveOpts, resolved } = resolveEffectiveLauncherOpts(opts);
    if (!resolved.supported) {
        return buildUnsupportedLauncherResult(inspectCdpLauncher(effectiveOpts), 'remove', '移除');
    }

    try {
        let removedAny = false;
        const removeIfPresent = (target: string | undefined, recursive: boolean) => {
            if (!target || !fs.existsSync(target)) { return; }
            fs.rmSync(target, { recursive, force: true });
            removedAny = true;
        };

        if (resolved.platform === 'darwin') {
            // Safety invariant: ONLY remove a non-symlink `Antigravity (CDP).app`
            // matching our exact CFBundleIdentifier — NEVER foreign apps or symlinks!
            const candidates = resolved.macCandidateAppDirs ?? (resolved.macAppDir ? [resolved.macAppDir] : []);
            for (const candidate of candidates) {
                if (isOwnedMacCdpBundle(candidate)) {
                    removeIfPresent(candidate, true);
                }
            }
        } else if (resolved.platform === 'win32') {
            removeIfPresent(resolved.winDesktopLnkPath, false);
            if (
                resolved.winFallbackDesktopLnkPath
                && resolved.winFallbackDesktopLnkPath.toLowerCase() !== (resolved.winDesktopLnkPath || '').toLowerCase()
            ) {
                removeIfPresent(resolved.winFallbackDesktopLnkPath, false);
            }
            removeIfPresent(resolved.winStartMenuLnkPath, false);
            removeIfPresent(resolved.winIconPath, false);
            removeIfPresent(resolved.winCmdPath, false);
            cleanupEmptyDir(resolved.winCmdPath);
        } else if (resolved.platform === 'linux') {
            removeIfPresent(resolved.linuxDesktopEntryPath, false);
            removeIfPresent(resolved.linuxWrapperPath, false);
            removeIfPresent(resolved.linuxIconPath, false);
            if (resolved.linuxDesktopEntryPath) {
                runLinuxUpdateDesktopDatabase(path.dirname(resolved.linuxDesktopEntryPath), effectiveOpts);
            }
        }

        const status = inspectCdpLauncher(
            resolved.winDesktopDir ? { ...effectiveOpts, desktopDir: resolved.winDesktopDir } : effectiveOpts,
        );
        return {
            ok: true,
            status,
            messageEn: removedAny
                ? `Removed persistent CDP launcher (${resolved.launcherPath}).`
                : `Persistent CDP launcher was not installed (${resolved.launcherPath}).`,
            messageZh: removedAny
                ? `已移除持久化 CDP 启动器（${resolved.launcherPath}）。`
                : `未检测到已安装的持久化 CDP 启动器（${resolved.launcherPath}）。`,
        };
    } catch (err) {
        return buildLauncherFailureResult(resolved, effectiveOpts, err, 'remove', '移除');
    }
}

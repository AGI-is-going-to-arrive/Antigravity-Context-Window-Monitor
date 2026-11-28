/**
 * Pure Cross-Platform CDP Launcher Core Helpers (§4.1 / D4 / D6).
 *
 * Strictly zero `vscode` imports and zero external npm dependencies.
 * Extracted as the single source of truth shared between `src/app/cdp-launcher.ts`,
 * `src/app/cdp-discovery.ts`, and `scripts/install-app-plugin.mjs`:
 * - Safe launcher path & target discovery across macOS, Windows, and Linux
 * - macOS AppleScript `default button "Cancel"` / `"取消"`, first-entry `AppleLanguages`
 *   locale detection, symlink & `CFBundleIdentifier` bundle ownership guards
 * - Linux XDG Base Directory validation, `.desktop` `Exec=` Freedesktop escaping,
 *   Flatpak / Snap / AppImage detection & sandbox boundary notes
 * - Windows `%LOCALAPPDATA%` / `%ProgramFiles%` / `%ProgramFiles(x86)%` / `%ProgramW6432%`
 *   candidate discovery, OneDrive Desktop fallback, `.lnk` binary target extraction,
 *   and verbatim `explorer.exe /select,` reveal command construction
 *
 * Safety boundary: NEVER modifies host Antigravity binaries or `app.asar`, and NEVER
 * terminates any running Antigravity App or IDE host process.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Shared Platform Constants ───────────────────────────────────────────────

export const CDP_LAUNCHER_DISPLAY_NAME = 'Antigravity (CDP)';
export const MACOS_CDP_LAUNCHER_BUNDLE_ID = 'com.antigravity-context-monitor.cdp-launcher';
export const MACOS_ANTIGRAVITY_BUNDLE_ID = 'com.google.antigravity';
export const MACOS_CDP_BUNDLE_NAME = `${CDP_LAUNCHER_DISPLAY_NAME}.app`;
export const MACOS_SYSTEM_APPLICATIONS_DIR = '/Applications';
export const LINUX_CDP_ICON_FILENAME = 'antigravity-cdp.svg';
export const LINUX_FLATPAK_APP_ID = 'com.google.Antigravity';

export const LINUX_FLATPAK_BOUNDARY_NOTE_EN =
    'Flatpak runs inside a user-controlled sandbox: launch via `flatpak run com.google.Antigravity --remote-debugging-port=0` (or its exported shim). Flatpak only sees directories granted by its sandbox permissions and stores DevToolsActivePort under `~/.var/app/com.google.Antigravity/config/Antigravity/`.';
export const LINUX_FLATPAK_BOUNDARY_NOTE_ZH =
    'Flatpak 运行在受用户控制的沙箱内：请通过 `flatpak run com.google.Antigravity --remote-debugging-port=0`（或其导出入口）启动。Flatpak 仅能访问沙箱授权目录，其 DevToolsActivePort 位于 `~/.var/app/com.google.Antigravity/config/Antigravity/`。';

/** Process-matching regex covering Linux AppImage invocations and `/tmp/.mount_*` mounts. */
export const LINUX_APPIMAGE_PROCESS_RE =
    /(?:^|\/)[^/]*antigravity[^/]*\.appimage$|^\/tmp\/\.mount_[^/]+\/(?:.*\/)?antigravity$|^\/tmp\/\.mount_[^/]*antigr[^/]*\/(?:.*\/)?(?:antigravity|apprun)$/i;

const MAX_LNK_INSPECT_BYTES = 64 * 1024;

// ─── Shared Types ────────────────────────────────────────────────────────────

export interface CoreLauncherFsOps {
    existsSync?: (p: string) => boolean;
    lstatSync?: (p: string) => fs.Stats;
    statSync?: (p: string) => fs.Stats;
    readdirSync?: (p: string) => string[];
    readFileSync?: {
        (p: string, enc: 'utf8'): string;
        (p: string): Buffer;
    };
    accessSync?: (p: string, mode?: number) => void;
}

export interface CoreLauncherPathOptions {
    platform?: NodeJS.Platform;
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    appPath?: string;
    /** Optional macOS system Applications dir override (pass `""` to disable `/Applications` lookup). */
    systemAppsDir?: string;
    /** Optional macOS installed bundle path to prioritize when both dirs contain valid bundles. */
    preferredMacAppDir?: string;
    /** Optional Windows Desktop directory override. */
    desktopDir?: string;
    /** Injectable PATH command lookup for Linux (`antigravity`, `flatpak`). */
    commandExistsFn?: (cmd: string) => boolean;
    /** Injectable fs ops for hermetic tests. */
    fsOps?: CoreLauncherFsOps;
}

export interface CoreResolvedLauncherPaths {
    platform: NodeJS.Platform;
    supported: boolean;
    homeDir: string;
    launcherPath: string;
    targetAppPath: string;
    auxiliaryPaths: string[];
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
    linuxIsFlatpak?: boolean;
}

export interface WindowsExplorerRevealSpawnOptions {
    detached: true;
    stdio: 'ignore';
    windowsHide: true;
    shell: false;
    windowsVerbatimArguments: true;
}

export interface WindowsExplorerRevealSpec {
    cmd: 'explorer.exe';
    args: string[];
    options: WindowsExplorerRevealSpawnOptions;
}

export interface LinuxFlatpakDetectionResult {
    detected: boolean;
    appId: string;
    /** Exported shim path if found on disk, or `flatpak:<appId>` if only `flatpak` command is available. */
    launchTarget: string | null;
    /** Sandbox `DevToolsActivePort` location under `~/.var/app/<appId>/config/Antigravity/`. */
    sandboxPortFilePath: string;
    noteEn: string;
    noteZh: string;
}

// ─── Cross-Platform Path & Escaping Helpers ──────────────────────────────────

export function joinTargetPath(platform: NodeJS.Platform, ...segments: string[]): string {
    if (
        platform === 'win32'
        && segments.length > 0
        && (/^[A-Za-z]:/.test(segments[0]) || segments[0].includes('\\'))
    ) {
        return path.win32.join(...segments);
    }
    return path.join(...segments);
}

export function dirnameTargetPath(platform: NodeJS.Platform, target: string): string {
    if (platform === 'win32' && (/^[A-Za-z]:/.test(target) || target.includes('\\'))) {
        return path.win32.dirname(target);
    }
    return path.dirname(target);
}

export function normalizePosixComparable(p: string): string {
    return path.resolve(p).replace(/\/+$/, '') || '/';
}

export function escapeSingleQuotedPosix(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function escapeExtendedRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function escapeXmlText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Escape a single command argument for a Freedesktop `.desktop` `Exec=` key:
 * - Strips NUL/CR/LF control characters
 * - Escapes `%` as `%%` so field codes are never accidentally expanded
 * - Quotes arguments containing spaces or reserved Freedesktop characters with
 *   proper double-level backslash escaping required by the Desktop Entry Spec.
 */
export function escapeFreedesktopExecArg(value: string): string {
    const clean = value.replace(/[\0\r\n]+/g, '');
    const pctEscaped = clean.replace(/%/g, '%%');
    if (pctEscaped.length === 0 || /[\s"'\\><~|&;$*?#()`=]/.test(pctEscaped)) {
        const execQuoted = pctEscaped.replace(/([\\"`$])/g, '\\$1');
        const desktopEscaped = execQuoted.replace(/\\/g, '\\\\');
        return `"${desktopEscaped}"`;
    }
    return pctEscaped;
}

export function getRealOsHomeDir(): string {
    try {
        const ui = os.userInfo();
        if (ui && ui.homedir && ui.homedir.trim()) {
            return ui.homedir.trim();
        }
    } catch {
        // Fallback if passwd database lookup is unavailable
    }
    return os.homedir();
}

export function resolveLauncherHomeDir(
    opts: Pick<CoreLauncherPathOptions, 'homeDir' | 'env'>,
    platform: NodeJS.Platform,
): string {
    if (opts.homeDir && opts.homeDir.trim()) {
        return opts.homeDir.trim();
    }
    const env = opts.env ?? process.env;
    if (platform === 'win32') {
        if (env.USERPROFILE && env.USERPROFILE.trim()) { return env.USERPROFILE.trim(); }
        if (env.HOMEDRIVE && env.HOMEPATH) { return `${env.HOMEDRIVE}${env.HOMEPATH}`; }
    } else if (env.HOME && env.HOME.trim()) {
        return env.HOME.trim();
    }
    return os.homedir();
}

export function defaultCommandExists(
    cmd: string,
    env: NodeJS.ProcessEnv = process.env,
    fsOps?: CoreLauncherFsOps,
): boolean {
    const statFn = fsOps?.statSync ?? fs.statSync;
    const pathEnv = env.PATH || '';
    for (const dir of pathEnv.split(path.delimiter)) {
        if (!dir) { continue; }
        const full = path.join(dir, cmd);
        try {
            const st = statFn(full);
            if (st.isFile()) { return true; }
        } catch {
            // ignore
        }
    }
    return false;
}

// ─── Linux XDG, Flatpak & AppImage Helpers ───────────────────────────────────

/**
 * Validate a Linux `XDG_*` directory environment variable per the XDG Base Directory
 * Specification: relative paths, NUL/newline characters, and `..` segments are invalid
 * and MUST be ignored in favor of the default path.
 */
export function sanitizeLinuxXdgDir(raw: unknown): string | null {
    if (typeof raw !== 'string') { return null; }
    const trimmed = raw.trim();
    if (!trimmed || /[\0\r\n]/.test(trimmed)) { return null; }
    if (!trimmed.startsWith('/')) { return null; }
    if (trimmed.split('/').some((seg) => seg === '..')) { return null; }
    return trimmed;
}

export function resolveLinuxXdgDataHome(
    homeDir: string,
    env: NodeJS.ProcessEnv = process.env,
): string {
    const valid = sanitizeLinuxXdgDir(env.XDG_DATA_HOME);
    if (valid) {
        return valid;
    }
    return joinTargetPath('linux', homeDir, '.local', 'share');
}

export function resolveLinuxXdgConfigHome(
    homeDir: string,
    env: NodeJS.ProcessEnv = process.env,
): string {
    const valid = sanitizeLinuxXdgDir(env.XDG_CONFIG_HOME);
    if (valid) {
        return valid;
    }
    return joinTargetPath('linux', homeDir, '.config');
}

export function isLinuxFlatpakTarget(targetAppPath: string | undefined): boolean {
    if (!targetAppPath) { return false; }
    const trimmed = targetAppPath.trim();
    return trimmed.startsWith('flatpak:')
        || /\/flatpak\/exports\/bin\/com\.google\.Antigravity$/i.test(trimmed);
}

export function resolveLinuxFlatpakPortFilePath(
    homeDir: string,
    appId = LINUX_FLATPAK_APP_ID,
): string {
    return path.posix.join(homeDir, '.var', 'app', appId, 'config', 'Antigravity', 'DevToolsActivePort');
}

export function detectLinuxFlatpakInstallation(options: {
    homeDir: string;
    env?: NodeJS.ProcessEnv;
    fsOps?: CoreLauncherFsOps;
    commandExistsFn?: (cmd: string) => boolean;
} ): LinuxFlatpakDetectionResult {
    const env = options.env ?? process.env;
    const existsFn = options.fsOps?.existsSync ?? fs.existsSync;
    const xdgDataHome = resolveLinuxXdgDataHome(options.homeDir, env);
    const sandboxPortFilePath = resolveLinuxFlatpakPortFilePath(options.homeDir);

    const shimCandidates = [
        joinTargetPath('linux', xdgDataHome, 'flatpak', 'exports', 'bin', LINUX_FLATPAK_APP_ID),
        `/var/lib/flatpak/exports/bin/${LINUX_FLATPAK_APP_ID}`,
    ];
    const shimMatch = shimCandidates.find((p) => {
        try { return existsFn(p); } catch { return false; }
    });
    if (shimMatch) {
        return {
            detected: true,
            appId: LINUX_FLATPAK_APP_ID,
            launchTarget: shimMatch,
            sandboxPortFilePath,
            noteEn: LINUX_FLATPAK_BOUNDARY_NOTE_EN,
            noteZh: LINUX_FLATPAK_BOUNDARY_NOTE_ZH,
        };
    }

    const flatpakAppDir = path.posix.join(options.homeDir, '.var', 'app', LINUX_FLATPAK_APP_ID);
    let hasSandboxDir = false;
    try { hasSandboxDir = existsFn(flatpakAppDir); } catch { hasSandboxDir = false; }
    const hasFlatpakBin = (options.commandExistsFn ?? ((cmd: string) => defaultCommandExists(cmd, env, options.fsOps)))('flatpak');

    if (hasSandboxDir && hasFlatpakBin) {
        return {
            detected: true,
            appId: LINUX_FLATPAK_APP_ID,
            launchTarget: `flatpak:${LINUX_FLATPAK_APP_ID}`,
            sandboxPortFilePath,
            noteEn: LINUX_FLATPAK_BOUNDARY_NOTE_EN,
            noteZh: LINUX_FLATPAK_BOUNDARY_NOTE_ZH,
        };
    }

    return {
        detected: false,
        appId: LINUX_FLATPAK_APP_ID,
        launchTarget: null,
        sandboxPortFilePath,
        noteEn: LINUX_FLATPAK_BOUNDARY_NOTE_EN,
        noteZh: LINUX_FLATPAK_BOUNDARY_NOTE_ZH,
    };
}

export function getLinuxTargetCandidates(
    homeDir: string,
    env: NodeJS.ProcessEnv = process.env,
): string[] {
    const linuxXdgDataHome = resolveLinuxXdgDataHome(homeDir, env);
    return [
        '/usr/bin/antigravity',
        '/usr/local/bin/antigravity',
        '/snap/bin/antigravity',
        '/opt/Antigravity/antigravity',
        joinTargetPath('linux', homeDir, '.local', 'bin', 'antigravity'),
        joinTargetPath('linux', linuxXdgDataHome, 'flatpak', 'exports', 'bin', LINUX_FLATPAK_APP_ID),
        `/var/lib/flatpak/exports/bin/${LINUX_FLATPAK_APP_ID}`,
    ];
}

export function findLinuxAppImageCandidate(
    homeDir: string,
    env: NodeJS.ProcessEnv = process.env,
    fsOps?: CoreLauncherFsOps,
): string | null {
    const existsFn = fsOps?.existsSync ?? fs.existsSync;
    const readdirFn = fsOps?.readdirSync ?? ((p: string) => fs.readdirSync(p));
    const statFn = fsOps?.statSync ?? fs.statSync;

    if (typeof env.APPIMAGE === 'string' && env.APPIMAGE.trim()) {
        const candidate = env.APPIMAGE.trim();
        try {
            if (LINUX_APPIMAGE_PROCESS_RE.test(candidate) && existsFn(candidate)) {
                return candidate;
            }
        } catch {
            // ignore
        }
    }
    const dirs = [
        joinTargetPath('linux', homeDir, 'Applications'),
        joinTargetPath('linux', homeDir, '.local', 'bin'),
    ];
    for (const dir of dirs) {
        try {
            if (!existsFn(dir)) { continue; }
            for (const entry of readdirFn(dir)) {
                if (/antigravity.*\.appimage$/i.test(entry)) {
                    const full = joinTargetPath('linux', dir, entry);
                    if (statFn(full).isFile()) {
                        return full;
                    }
                }
            }
        } catch {
            // ignore
        }
    }
    return null;
}

// ─── macOS AppleLanguages, Symlink & Bundle Ownership Guards ─────────────────

/**
 * Parse ONLY the first preferred language entry from `defaults read -g AppleLanguages`
 * output (plist array format like `(\n    "en-US",\n    "zh-Hans-CN"\n)`).
 *
 * Prevents secondary `zh` entries from overriding an English primary preference!
 */
export function parseMacOsFirstAppleLanguage(rawDefaultsOutput: string): string | null {
    if (typeof rawDefaultsOutput !== 'string' || !rawDefaultsOutput.trim()) {
        return null;
    }
    const lines = rawDefaultsOutput.split(/\r?\n/);
    for (const line of lines) {
        let s = line.replace(/^[\s()]+/, '');
        if (!s || s === ')') { continue; }
        s = s.replace(/,.*$/, '');
        s = s.replace(/^[\s"]+|[\s");]+$/g, '');
        if (s) {
            return s;
        }
    }
    return null;
}

/**
 * Decide whether a macOS locale string (from env or first-entry `AppleLanguages`)
 * selects Chinese UI prompts for the CDP launcher dialog.
 */
export function isMacOsChineseLocale(locale: string | null | undefined): boolean {
    if (typeof locale !== 'string') { return false; }
    const trimmed = locale.trim();
    if (!trimmed || /^(?:C|POSIX)(?:\.|$)/i.test(trimmed)) {
        return false;
    }
    return /^zh(?:[-_@.]|$)/i.test(trimmed);
}

/**
 * Resolve macOS launcher locale from env variables and optional `defaults read` outputs,
 * mirroring `detect_locale_zh()` in `buildMacOsLauncherScript`.
 */
export function resolveMacOsLauncherLocaleIsZh(options: {
    env?: NodeJS.ProcessEnv;
    appleLanguagesRaw?: string | null;
    appleLocaleRaw?: string | null;
} = {}): boolean {
    const env = options.env ?? process.env;
    const rawEnvLoc = (
        env.ACM_LAUNCHER_LANG
        || env.LC_ALL
        || env.LC_MESSAGES
        || env.LANG
        || ''
    ).trim();
    const effectiveEnvLoc = /^(?:C|POSIX)(?:\.|$)/i.test(rawEnvLoc) ? '' : rawEnvLoc;
    if (effectiveEnvLoc) {
        return isMacOsChineseLocale(effectiveEnvLoc);
    }
    const firstAppleLang = options.appleLanguagesRaw
        ? parseMacOsFirstAppleLanguage(options.appleLanguagesRaw)
        : null;
    if (firstAppleLang) {
        return isMacOsChineseLocale(firstAppleLang);
    }
    if (options.appleLocaleRaw && options.appleLocaleRaw.trim()) {
        return isMacOsChineseLocale(options.appleLocaleRaw);
    }
    return false;
}

export function isSymlinkPath(targetPath: string, fsOps?: CoreLauncherFsOps): boolean {
    const lstatFn = fsOps?.lstatSync ?? fs.lstatSync;
    try {
        return lstatFn(targetPath).isSymbolicLink();
    } catch {
        return false;
    }
}

export function pathExistsOrSymlink(targetPath: string, fsOps?: CoreLauncherFsOps): boolean {
    const lstatFn = fsOps?.lstatSync ?? fs.lstatSync;
    try {
        lstatFn(targetPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Safely read `CFBundleIdentifier` from a macOS `.app` bundle's `Contents/Info.plist`,
 * refusing symlinks on `appDir`, `Contents`, or `Info.plist`.
 */
export function readMacBundleIdentifier(appDir: string, fsOps?: CoreLauncherFsOps): string | null {
    const lstatFn = fsOps?.lstatSync ?? fs.lstatSync;
    const readFileFn = fsOps?.readFileSync ?? fs.readFileSync;
    try {
        const dirStat = lstatFn(appDir);
        if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
            return null;
        }
        const contentsDir = path.join(appDir, 'Contents');
        const contentsStat = lstatFn(contentsDir);
        if (contentsStat.isSymbolicLink() || !contentsStat.isDirectory()) {
            return null;
        }
        const plistPath = path.join(contentsDir, 'Info.plist');
        const plistStat = lstatFn(plistPath);
        if (plistStat.isSymbolicLink() || !plistStat.isFile()) {
            return null;
        }
        const content = readFileFn(plistPath, 'utf8');
        const match = content.match(/<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/i);
        return match ? match[1].trim() : null;
    } catch {
        return null;
    }
}

/**
 * Returns true ONLY if `appDir` is a non-symlink directory named `Antigravity (CDP).app`
 * whose `Contents/Info.plist` carries our exact `MACOS_CDP_LAUNCHER_BUNDLE_ID`.
 */
export function isOwnedMacCdpBundle(appDir: string | undefined, fsOps?: CoreLauncherFsOps): boolean {
    if (!appDir || path.basename(appDir) !== MACOS_CDP_BUNDLE_NAME) {
        return false;
    }
    return readMacBundleIdentifier(appDir, fsOps) === MACOS_CDP_LAUNCHER_BUNDLE_ID;
}

export function isMacAppBundleInstalled(appDir: string | undefined, fsOps?: CoreLauncherFsOps): boolean {
    if (!appDir || !isOwnedMacCdpBundle(appDir, fsOps)) { return false; }
    const lstatFn = fsOps?.lstatSync ?? fs.lstatSync;
    const macOsDir = path.join(appDir, 'Contents', 'MacOS');
    const launchPath = path.join(macOsDir, 'launch');
    try {
        const macStat = lstatFn(macOsDir);
        const launchStat = lstatFn(launchPath);
        return !macStat.isSymbolicLink() && macStat.isDirectory() && !launchStat.isSymbolicLink() && launchStat.isFile();
    } catch {
        return false;
    }
}

export function getMacBundleMtimeMs(appDir: string, fsOps?: CoreLauncherFsOps): number {
    const lstatFn = fsOps?.lstatSync ?? fs.lstatSync;
    let newest = 0;
    for (const p of [
        appDir,
        path.join(appDir, 'Contents', 'Info.plist'),
        path.join(appDir, 'Contents', 'MacOS', 'launch'),
    ]) {
        try {
            const st = lstatFn(p);
            if (!st.isSymbolicLink() && st.mtimeMs > newest) {
                newest = st.mtimeMs;
            }
        } catch {
            // ignore
        }
    }
    return newest;
}

export function isDirectoryWritable(dirPath: string, fsOps?: CoreLauncherFsOps): boolean {
    const existsFn = fsOps?.existsSync ?? fs.existsSync;
    const statFn = fsOps?.statSync ?? fs.statSync;
    const accessFn = fsOps?.accessSync ?? fs.accessSync;
    try {
        if (!existsFn(dirPath)) {
            return false;
        }
        const st = statFn(dirPath);
        if (!st.isDirectory()) {
            return false;
        }
        if (process.platform !== 'win32' && (st.mode & 0o222) === 0) {
            return false;
        }
        accessFn(dirPath, fs.constants.W_OK | fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

export function isRegularFileWritable(filePath: string, fsOps?: CoreLauncherFsOps): boolean {
    const lstatFn = fsOps?.lstatSync ?? fs.lstatSync;
    const accessFn = fsOps?.accessSync ?? fs.accessSync;
    try {
        const st = lstatFn(filePath);
        if (st.isSymbolicLink() || !st.isFile()) {
            return false;
        }
        if (process.platform !== 'win32' && (st.mode & 0o222) === 0) {
            return false;
        }
        accessFn(filePath, fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

export function isMacBundleWritable(appDir: string, fsOps?: CoreLauncherFsOps): boolean {
    const existsFn = fsOps?.existsSync ?? fs.existsSync;
    if (isSymlinkPath(appDir, fsOps)) { return false; }
    if (!existsFn(appDir)) { return true; }
    if (!isDirectoryWritable(appDir, fsOps)) { return false; }
    const contentsDir = path.join(appDir, 'Contents');
    if (pathExistsOrSymlink(contentsDir, fsOps) && (isSymlinkPath(contentsDir, fsOps) || !isDirectoryWritable(contentsDir, fsOps))) {
        return false;
    }
    const macOsDir = path.join(contentsDir, 'MacOS');
    if (pathExistsOrSymlink(macOsDir, fsOps) && (isSymlinkPath(macOsDir, fsOps) || !isDirectoryWritable(macOsDir, fsOps))) {
        return false;
    }
    const plistPath = path.join(contentsDir, 'Info.plist');
    if (pathExistsOrSymlink(plistPath, fsOps) && !isRegularFileWritable(plistPath, fsOps)) {
        return false;
    }
    const launchPath = path.join(macOsDir, 'launch');
    if (pathExistsOrSymlink(launchPath, fsOps) && !isRegularFileWritable(launchPath, fsOps)) {
        return false;
    }
    return true;
}

export function assertSafeMacOsBundleWriteTarget(appDir: string, fsOps?: CoreLauncherFsOps): void {
    const lstatFn = fsOps?.lstatSync ?? fs.lstatSync;
    const readdirFn = fsOps?.readdirSync ?? ((p: string) => fs.readdirSync(p));
    if (isSymlinkPath(appDir, fsOps)) {
        throw new Error(`Refusing to write macOS CDP launcher: target path is a symlink (${appDir})`);
    }
    if (pathExistsOrSymlink(appDir, fsOps)) {
        const st = lstatFn(appDir);
        if (!st.isDirectory()) {
            throw new Error(`Refusing to write macOS CDP launcher: target path is not a directory (${appDir})`);
        }
        const entries = readdirFn(appDir);
        if (entries.length > 0) {
            const bundleId = readMacBundleIdentifier(appDir, fsOps);
            if (bundleId !== MACOS_CDP_LAUNCHER_BUNDLE_ID) {
                throw new Error(
                    `Refusing to overwrite existing macOS bundle with unexpected CFBundleIdentifier "${bundleId ?? '(missing)'}" at ${appDir}`,
                );
            }
        }
    }
    const internalPaths = [
        path.join(appDir, 'Contents'),
        path.join(appDir, 'Contents', 'Info.plist'),
        path.join(appDir, 'Contents', 'MacOS'),
        path.join(appDir, 'Contents', 'MacOS', 'launch'),
        path.join(appDir, 'Contents', 'Resources'),
        path.join(appDir, 'Contents', 'Resources', 'icon.icns'),
    ];
    for (const internalPath of internalPaths) {
        if (isSymlinkPath(internalPath, fsOps)) {
            throw new Error(`Refusing to write macOS CDP launcher: symlink detected inside bundle (${internalPath})`);
        }
    }
}

/**
 * Determine the macOS system Applications directory while maintaining strict test isolation.
 */
export function resolveMacSystemAppsDir(
    opts: Pick<CoreLauncherPathOptions, 'systemAppsDir' | 'homeDir' | 'platform'>,
    env: NodeJS.ProcessEnv = process.env,
): string | null {
    if (opts.systemAppsDir !== undefined) {
        const trimmed = opts.systemAppsDir.trim();
        return trimmed || null;
    }
    if (typeof env.ACM_MACOS_APPLICATIONS_DIR === 'string') {
        const trimmed = env.ACM_MACOS_APPLICATIONS_DIR.trim();
        return trimmed || null;
    }
    if (opts.homeDir && opts.homeDir.trim()) {
        return null;
    }
    const realHome = normalizePosixComparable(getRealOsHomeDir());
    if (typeof env.HOME === 'string' && env.HOME.trim()) {
        if (normalizePosixComparable(env.HOME.trim()) !== realHome) {
            return null;
        }
    }
    if (opts.platform && opts.platform !== process.platform) {
        return null;
    }
    return MACOS_SYSTEM_APPLICATIONS_DIR;
}

// ─── Windows Program Files, OneDrive, .lnk & Verbatim Reveal Helpers ─────────

export function getFastWindowsDesktopFallback(
    homeDir: string,
    env: NodeJS.ProcessEnv = process.env,
    fsOps?: CoreLauncherFsOps,
): string {
    const existsFn = fsOps?.existsSync ?? fs.existsSync;
    const statFn = fsOps?.statSync ?? fs.statSync;
    for (const oneDriveRoot of [env.OneDrive, env.OneDriveCommercial, env.OneDriveConsumer]) {
        if (typeof oneDriveRoot === 'string' && oneDriveRoot.trim()) {
            const candidate = joinTargetPath('win32', oneDriveRoot.trim(), 'Desktop');
            try {
                if (existsFn(candidate) && statFn(candidate).isDirectory()) {
                    return candidate;
                }
            } catch {
                // ignore
            }
        }
    }
    return joinTargetPath('win32', homeDir, 'Desktop');
}

/**
 * Enumerate Windows filesystem candidates for `Antigravity.exe` across
 * `%LOCALAPPDATA%`, `%ProgramFiles%`, `%ProgramFiles(x86)%`, and `%ProgramW6432%`
 * (deduplicated case-insensitively).
 */
export function getWindowsExeFilesystemCandidates(
    localAppData: string,
    env: NodeJS.ProcessEnv = process.env,
): string[] {
    const candidates: string[] = [
        joinTargetPath('win32', localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'),
        joinTargetPath('win32', localAppData, 'Antigravity', 'Antigravity.exe'),
    ];
    const programDirs = [
        env.ProgramFiles || env.PROGRAMFILES,
        env['ProgramFiles(x86)'] || env['PROGRAMFILES(X86)'],
        env.ProgramW6432 || env.PROGRAMW6432,
    ];
    const seen = new Set<string>(candidates.map((p) => p.toLowerCase()));
    for (const dir of programDirs) {
        if (typeof dir !== 'string' || !dir.trim()) { continue; }
        const trimmed = dir.trim();
        for (const candidate of [
            joinTargetPath('win32', trimmed, 'Antigravity', 'Antigravity.exe'),
            joinTargetPath('win32', trimmed, 'Google', 'Antigravity', 'Antigravity.exe'),
        ]) {
            const lower = candidate.toLowerCase();
            if (!seen.has(lower)) {
                seen.add(lower);
                candidates.push(candidate);
            }
        }
    }
    return candidates;
}

/**
 * Pure binary buffer scanner for a Windows `.lnk` file's embedded `...\Antigravity.exe`
 * target path (supports both UTF-16LE and ASCII/Latin-1 Shell Link payloads).
 */
export function extractAntigravityExeFromLnkBuffer(buf: Buffer): string | null {
    if (!Buffer.isBuffer(buf) || buf.length === 0 || buf.length > MAX_LNK_INSPECT_BYTES) {
        return null;
    }
    const pathRe = /[A-Za-z]:\\[^<>:"|?*\0\r\n]+\\Antigravity\.exe/i;
    for (const encoding of ['utf16le', 'latin1'] as const) {
        const decoded = buf.toString(encoding);
        const match = decoded.match(pathRe);
        if (match && match[0]) {
            return match[0].trim();
        }
    }
    return null;
}

/**
 * Bounded pure-Node `.lnk` target extractor that also verifies the extracted
 * executable exists on disk.
 */
export function extractAntigravityExeFromLnkFile(
    lnkPath: string,
    fsOps?: CoreLauncherFsOps,
): string | null {
    const statFn = fsOps?.statSync ?? fs.statSync;
    const readFileFn = fsOps?.readFileSync ?? fs.readFileSync;
    const existsFn = fsOps?.existsSync ?? fs.existsSync;
    try {
        const st = statFn(lnkPath);
        if (!st.isFile() || st.size === 0 || st.size > MAX_LNK_INSPECT_BYTES) {
            return null;
        }
        const buf = readFileFn(lnkPath);
        const candidate = extractAntigravityExeFromLnkBuffer(buf);
        if (candidate && existsFn(candidate)) {
            return candidate;
        }
    } catch {
        // ignore unreadable/malformed shortcut
    }
    return null;
}

export function findWindowsAntigravityExeFromShortcuts(
    homeDir: string,
    appData: string,
    env: NodeJS.ProcessEnv = process.env,
    fsOps?: CoreLauncherFsOps,
): string | null {
    const existsFn = fsOps?.existsSync ?? fs.existsSync;
    const programData = (env.ProgramData || env.PROGRAMDATA || '').trim();
    const lnkCandidates = [
        joinTargetPath('win32', appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Antigravity', 'Antigravity.lnk'),
        joinTargetPath('win32', appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Antigravity.lnk'),
        ...(programData
            ? [
                joinTargetPath('win32', programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Antigravity', 'Antigravity.lnk'),
                joinTargetPath('win32', programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Antigravity.lnk'),
            ]
            : []),
        joinTargetPath('win32', homeDir, 'Desktop', 'Antigravity.lnk'),
    ];
    for (const lnkPath of lnkCandidates) {
        if (!existsFn(lnkPath)) { continue; }
        const extracted = extractAntigravityExeFromLnkFile(lnkPath, fsOps);
        if (extracted) {
            return extracted;
        }
    }
    return null;
}

/**
 * Build a verbatim `explorer.exe` reveal spec: uses `['/select,', '"' + targetPath + '"']`
 * with `windowsVerbatimArguments: true` and `shell: false` so paths containing
 * spaces, commas, semicolons, or Unicode select cleanly without quote-escaping bugs.
 */
export function buildWindowsExplorerRevealCommand(
    targetPath: string,
    isDirectory = false,
): WindowsExplorerRevealSpec {
    if (typeof targetPath !== 'string' || !targetPath.trim()) {
        throw new Error('Windows reveal target path is required');
    }
    if (/[\0\r\n]/.test(targetPath)) {
        throw new Error('Windows reveal target path contains forbidden control characters');
    }
    if (targetPath.includes('"')) {
        throw new Error('Windows reveal target path contains forbidden quote character');
    }
    // Strip redundant non-root trailing backslashes so a trailing `\` inside `"..."`
    // cannot escape the closing quote under Windows CommandLineToArgvW.
    let safePath = targetPath;
    if (!/^[A-Za-z]:\\$/.test(safePath) && !/^\\\\[^\\]+\\[^\\]+\\?$/.test(safePath)) {
        safePath = safePath.replace(/\\+$/, '') || safePath;
    }
    const quoted = `"${safePath}"`;
    return {
        cmd: 'explorer.exe',
        args: isDirectory ? [quoted] : ['/select,', quoted],
        options: {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            shell: false,
            windowsVerbatimArguments: true,
        },
    };
}

// ─── Cross-Platform Safe Terminal Command & Launcher Path Resolution ─────────

export function getSafeCdpLaunchCommand(platform: NodeJS.Platform = process.platform): string {
    if (platform === 'darwin') {
        return 'while pgrep -f \'^/Applications/Antigravity\\.app/Contents/MacOS/Antigravity($| )\' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0';
    }
    if (platform === 'win32') {
        return '& "$env:LOCALAPPDATA\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0';
    }
    return 'antigravity --remote-debugging-port=0';
}

export function getCdpLauncherPlatformNotes(
    platform: NodeJS.Platform,
    launcherPath: string,
): { noteEn: string; noteZh: string } {
    if (platform === 'darwin') {
        return {
            noteEn: `Creates a zero-patch CDP-badged launcher bundle at "${launcherPath}" (prefers /Applications when writable, falls back to ~/Applications; never modifies /Applications/Antigravity.app). Drag "Antigravity (CDP).app" from Finder into your Dock — NEVER right-click the running Antigravity Dock icon and choose "Keep in Dock" (that pins argless Antigravity.app and loses CDP after restart).`,
            noteZh: `在 "${launcherPath}" 创建带 CDP 角标的零侵入持久化启动器（优先写入 /Applications，无权限时自动回退 ~/Applications；绝不修改 /Applications/Antigravity.app）。请从访达将「Antigravity (CDP).app」拖入程序坞固定，切勿右键运行中的图标选「在程序坞中保留」（否则固定的是无参原版，完全退出重开后会丢失 CDP）。`,
        };
    }
    if (platform === 'win32') {
        return {
            noteEn: `Creates zero-patch Desktop (OneDrive-aware) & Start Menu "${CDP_LAUNCHER_DISPLAY_NAME}" shortcuts with a CDP-badged icon pointing directly to Antigravity.exe --remote-debugging-port=0 (supports native right-click "Pin to taskbar", single icon merge, zero CMD flash; avoid pinning the running taskbar icon directly).`,
            noteZh: `在真实桌面（兼容 OneDrive 重定向）与开始菜单创建带 CDP 角标的零侵入「${CDP_LAUNCHER_DISPLAY_NAME}」快捷方式，直接指向 Antigravity.exe 并附带 --remote-debugging-port=0（支持原生右键「固定到任务栏」、单图标合并且无黑框闪烁；请勿直接右键运行中的任务栏图标固定）。`,
        };
    }
    if (platform === 'linux') {
        return {
            noteEn: `Creates a zero-patch CDP-badged desktop entry at "${launcherPath}" and wrapper in ~/.local/bin/antigravity-cdp (handles standard/Snap/Flatpak/AppImage detection with non-killing conflict dialog and StartupWMClass=Antigravity). Pin "Antigravity (CDP)" from the Ubuntu Application Launcher / Show Apps ("Pin to Dash" / "Add to Favorites") rather than pinning the running Dock window icon. ${LINUX_FLATPAK_BOUNDARY_NOTE_EN}`,
            noteZh: `在 "${launcherPath}" 创建带 CDP 角标的零侵入桌面入口并在 ~/.local/bin/antigravity-cdp 生成启动脚本（兼容标准安装/Snap/Flatpak/AppImage 检测、冲突时弹窗提醒绝不强杀，保留 StartupWMClass=Antigravity）。请在 Ubuntu「显示应用」菜单中搜索「Antigravity (CDP)」并选择「固定到停靠栏 / 添加到收藏夹」，切勿右键运行中的窗口图标固定。${LINUX_FLATPAK_BOUNDARY_NOTE_ZH}`,
        };
    }
    return {
        noteEn: `Persistent CDP launcher generation is not supported on platform "${platform}". Launch Antigravity with --remote-debugging-port=0 manually.`,
        noteZh: `当前平台 "${platform}" 暂不支持自动生成持久化 CDP 启动器，请手动附带 --remote-debugging-port=0 启动 Antigravity。`,
    };
}

/**
 * Pure, non-blocking launcher path and target app discovery across macOS, Windows, and Linux.
 * Never spawns subprocesses (suitable for polling, IDE Settings discovery, and installer CLI).
 */
export function resolveCoreCdpLauncherPaths(opts: CoreLauncherPathOptions = {}): CoreResolvedLauncherPaths {
    const platform = opts.platform ?? process.platform;
    const env = opts.env ?? process.env;
    const homeDir = resolveLauncherHomeDir(opts, platform);
    const fsOps = opts.fsOps;
    const existsFn = fsOps?.existsSync ?? fs.existsSync;

    if (platform === 'darwin') {
        const macSystemAppsDir = resolveMacSystemAppsDir(opts, env);
        const macSystemAppDir = macSystemAppsDir
            ? joinTargetPath('darwin', macSystemAppsDir, MACOS_CDP_BUNDLE_NAME)
            : undefined;
        const macUserAppDir = joinTargetPath('darwin', homeDir, 'Applications', MACOS_CDP_BUNDLE_NAME);

        const macCandidateAppDirs: string[] = [];
        const seenDirs = new Set<string>();
        for (const candidate of [macSystemAppDir, macUserAppDir]) {
            if (!candidate) { continue; }
            const key = normalizePosixComparable(candidate);
            if (!seenDirs.has(key)) {
                seenDirs.add(key);
                macCandidateAppDirs.push(candidate);
            }
        }

        const systemTargetExists = Boolean(macSystemAppDir && pathExistsOrSymlink(macSystemAppDir, fsOps));
        const canWriteSystem = Boolean(
            macSystemAppsDir
            && macSystemAppDir
            && isDirectoryWritable(macSystemAppsDir, fsOps)
            && (!systemTargetExists || (isOwnedMacCdpBundle(macSystemAppDir, fsOps) && isMacBundleWritable(macSystemAppDir, fsOps))),
        );
        const macPreferredAppDir = canWriteSystem && macSystemAppDir ? macSystemAppDir : macUserAppDir;

        const installedCandidates = macCandidateAppDirs.filter((dir) => isMacAppBundleInstalled(dir, fsOps));
        let installedAppDir: string | undefined;
        if (opts.preferredMacAppDir) {
            const prefNorm = normalizePosixComparable(opts.preferredMacAppDir);
            installedAppDir = installedCandidates.find((p) => normalizePosixComparable(p) === prefNorm);
        }
        if (!installedAppDir) {
            if (installedCandidates.length === 1) {
                installedAppDir = installedCandidates[0];
            } else if (installedCandidates.length > 1 && macSystemAppDir) {
                if (!canWriteSystem) {
                    installedAppDir = macUserAppDir;
                } else {
                    const userMtime = getMacBundleMtimeMs(macUserAppDir, fsOps);
                    const sysMtime = getMacBundleMtimeMs(macSystemAppDir, fsOps);
                    installedAppDir = userMtime > sysMtime ? macUserAppDir : macPreferredAppDir;
                }
            }
        }
        const macAppDir = installedAppDir ?? macPreferredAppDir;

        let targetAppPath = opts.appPath?.trim() || '';
        if (!targetAppPath) {
            const targetCandidates = [
                ...(macSystemAppsDir ? [joinTargetPath('darwin', macSystemAppsDir, 'Antigravity.app')] : []),
                '/Applications/Antigravity.app',
                joinTargetPath('darwin', homeDir, 'Applications', 'Antigravity.app'),
            ];
            targetAppPath = targetCandidates.find((p) => existsFn(p))
                || (macSystemAppsDir ? joinTargetPath('darwin', macSystemAppsDir, 'Antigravity.app') : '/Applications/Antigravity.app');
        }

        const auxiliaryPaths = macCandidateAppDirs.filter(
            (p) => normalizePosixComparable(p) !== normalizePosixComparable(macAppDir),
        );

        return {
            platform,
            supported: true,
            homeDir,
            launcherPath: macAppDir,
            targetAppPath,
            auxiliaryPaths,
            macAppDir,
            ...(macSystemAppsDir ? { macSystemAppsDir } : {}),
            ...(macSystemAppDir ? { macSystemAppDir } : {}),
            macUserAppDir,
            macPreferredAppDir,
            macCandidateAppDirs,
        };
    }

    if (platform === 'win32') {
        const localAppData = env.LOCALAPPDATA?.trim()
            ? env.LOCALAPPDATA.trim()
            : joinTargetPath('win32', homeDir, 'AppData', 'Local');
        const appData = env.APPDATA?.trim()
            ? env.APPDATA.trim()
            : joinTargetPath('win32', homeDir, 'AppData', 'Roaming');
        const winDataDir = joinTargetPath('win32', localAppData, 'AntigravityContextMonitor');
        const winCmdPath = joinTargetPath('win32', winDataDir, 'launch-antigravity-cdp.cmd');
        const winIconPath = joinTargetPath('win32', winDataDir, 'antigravity-cdp.ico');
        const winDesktopDir = opts.desktopDir?.trim()
            ? opts.desktopDir.trim()
            : getFastWindowsDesktopFallback(homeDir, env, fsOps);
        const winDesktopLnkPath = joinTargetPath('win32', winDesktopDir, `${CDP_LAUNCHER_DISPLAY_NAME}.lnk`);
        const winFallbackDesktopLnkPath = joinTargetPath('win32', homeDir, 'Desktop', `${CDP_LAUNCHER_DISPLAY_NAME}.lnk`);
        const winStartMenuLnkPath = joinTargetPath(
            'win32',
            appData,
            'Microsoft',
            'Windows',
            'Start Menu',
            'Programs',
            `${CDP_LAUNCHER_DISPLAY_NAME}.lnk`,
        );

        let targetAppPath = opts.appPath?.trim() || '';
        if (!targetAppPath) {
            const fsCandidates = getWindowsExeFilesystemCandidates(localAppData, env);
            targetAppPath = fsCandidates.find((p) => existsFn(p))
                || findWindowsAntigravityExeFromShortcuts(homeDir, appData, env, fsOps)
                || joinTargetPath('win32', localAppData, 'Programs', 'Antigravity', 'Antigravity.exe');
        }

        const auxiliaryPaths = [winStartMenuLnkPath, winIconPath, winCmdPath];
        if (winFallbackDesktopLnkPath.toLowerCase() !== winDesktopLnkPath.toLowerCase()) {
            auxiliaryPaths.push(winFallbackDesktopLnkPath);
        }

        return {
            platform,
            supported: true,
            homeDir,
            launcherPath: winDesktopLnkPath,
            targetAppPath,
            auxiliaryPaths,
            winCmdPath,
            winDesktopDir,
            winDesktopLnkPath,
            winFallbackDesktopLnkPath,
            winStartMenuLnkPath,
            winIconPath,
        };
    }

    if (platform === 'linux') {
        const linuxXdgDataHome = resolveLinuxXdgDataHome(homeDir, env);
        const linuxWrapperPath = joinTargetPath('linux', homeDir, '.local', 'bin', 'antigravity-cdp');
        const linuxDesktopEntryPath = joinTargetPath(
            'linux',
            linuxXdgDataHome,
            'applications',
            'antigravity-cdp.desktop',
        );
        const linuxIconPath = joinTargetPath(
            'linux',
            linuxXdgDataHome,
            'icons',
            'hicolor',
            'scalable',
            'apps',
            LINUX_CDP_ICON_FILENAME,
        );

        let targetAppPath = opts.appPath?.trim() || '';
        if (!targetAppPath) {
            const candidates = getLinuxTargetCandidates(homeDir, env);
            const flatpakDetection = detectLinuxFlatpakInstallation({
                homeDir,
                env,
                fsOps,
                commandExistsFn: opts.commandExistsFn,
            });
            targetAppPath = candidates.find((p) => existsFn(p))
                || findLinuxAppImageCandidate(homeDir, env, fsOps)
                || flatpakDetection.launchTarget
                || 'antigravity';
        }

        return {
            platform,
            supported: true,
            homeDir,
            launcherPath: linuxDesktopEntryPath,
            targetAppPath,
            auxiliaryPaths: [linuxWrapperPath, linuxIconPath],
            linuxWrapperPath,
            linuxDesktopEntryPath,
            linuxIconPath,
            linuxXdgDataHome,
            linuxIsFlatpak: isLinuxFlatpakTarget(targetAppPath),
        };
    }

    return {
        platform,
        supported: false,
        homeDir,
        launcherPath: '',
        targetAppPath: opts.appPath?.trim() || '',
        auxiliaryPaths: [],
    };
}

// ─── Launcher Script & Artifact Builders ─────────────────────────────────────

export function buildMacOsInfoPlist(): string {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '    <key>CFBundleDevelopmentRegion</key>',
        '    <string>en</string>',
        '    <key>CFBundleDisplayName</key>',
        `    <string>${escapeXmlText(CDP_LAUNCHER_DISPLAY_NAME)}</string>`,
        '    <key>CFBundleExecutable</key>',
        '    <string>launch</string>',
        '    <key>CFBundleIconFile</key>',
        '    <string>icon.icns</string>',
        '    <key>CFBundleIdentifier</key>',
        `    <string>${escapeXmlText(MACOS_CDP_LAUNCHER_BUNDLE_ID)}</string>`,
        '    <key>CFBundleInfoDictionaryVersion</key>',
        '    <string>6.0</string>',
        '    <key>CFBundleName</key>',
        `    <string>${escapeXmlText(CDP_LAUNCHER_DISPLAY_NAME)}</string>`,
        '    <key>CFBundlePackageType</key>',
        '    <string>APPL</string>',
        '    <key>CFBundleShortVersionString</key>',
        '    <string>1.0.0</string>',
        '    <key>CFBundleVersion</key>',
        '    <string>1</string>',
        '    <key>LSMinimumSystemVersion</key>',
        '    <string>12.0</string>',
        '    <key>LSUIElement</key>',
        '    <true/>',
        '</dict>',
        '</plist>',
        '',
    ].join('\n');
}

/**
 * Build the macOS `Antigravity (CDP).app/Contents/MacOS/launch` script.
 * - Uses `default button "Cancel"` / `"取消"` (D4 safe default)
 * - Reads ONLY the first entry of `AppleLanguages` (never matches secondary `zh` lines)
 * - Activates foreground dialogs + falls back cleanly on TCC Automation permission denial
 * - Waits up to 15s (0.25s ticks) for graceful teardown before launching with `--remote-debugging-port=0`
 */
export function buildMacOsLauncherScript(targetAppPath = '/Applications/Antigravity.app'): string {
    const cleanTarget = targetAppPath.replace(/\/+$/, '') || '/Applications/Antigravity.app';
    const mainBinaryRegex = `^${escapeExtendedRegex(`${cleanTarget}/Contents/MacOS/Antigravity`)}($| )`;

    return [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        '',
        '# Zero-patch persistent CDP launcher generated by Antigravity Context Monitor.',
        '# Never modifies /Applications/Antigravity.app and eliminates the 5s before-quit race.',
        `APP_PATH=${escapeSingleQuotedPosix(cleanTarget)}`,
        `APP_REGEX=${escapeSingleQuotedPosix(mainBinaryRegex)}`,
        `BUNDLE_ID=${escapeSingleQuotedPosix(MACOS_ANTIGRAVITY_BUNDLE_ID)}`,
        '',
        'detect_locale_zh() {',
        '  local loc="${ACM_LAUNCHER_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}"',
        '  case "$loc" in',
        '    ""|C|POSIX|C.*|POSIX.*) loc="" ;;',
        '  esac',
        '  if [ -z "$loc" ]; then',
        '    loc="$(defaults read -g AppleLanguages 2>/dev/null | awk \'{ s=$0; sub(/^[[:space:]()]+/, "", s); if (s == "" || s == ")") next; sub(/,.*$/, "", s); gsub(/^[[:space:]"]+|[[:space:]");]+$/, "", s); if (s != "") { print s; exit } }\' || true)"',
        '  fi',
        '  if [ -z "$loc" ]; then',
        '    loc="$(defaults read -g AppleLocale 2>/dev/null || true)"',
        '  fi',
        '  case "$loc" in',
        '    zh*|ZH*) return 0 ;;',
        '    *) return 1 ;;',
        '  esac',
        '}',
        '',
        'if [ ! -d "$APP_PATH" ]; then',
        '  if detect_locale_zh; then',
        '    osascript -e \'activate\' -e \'display alert "未找到 Antigravity App" message "未能找到 Antigravity.app，请先安装 Antigravity App。"\' >/dev/null 2>&1 || true',
        '  else',
        '    osascript -e \'activate\' -e \'display alert "Antigravity App Not Found" message "Could not locate Antigravity.app. Please install Antigravity App first."\' >/dev/null 2>&1 || true',
        '  fi',
        '  exit 1',
        'fi',
        '',
        'find_main_pids() {',
        '  pgrep -f "$APP_REGEX" 2>/dev/null || true',
        '}',
        '',
        'wait_for_exit() {',
        '  local max_ticks=60',
        '  local tick=0',
        '  while [ "$tick" -lt "$max_ticks" ]; do',
        '    if [ -z "$(find_main_pids)" ]; then',
        '      return 0',
        '    fi',
        '    sleep 0.25',
        '    tick=$((tick + 1))',
        '  done',
        '  return 1',
        '}',
        '',
        'PIDS="$(find_main_pids)"',
        '',
        'if [ -n "$PIDS" ]; then',
        '  HAS_CDP=0',
        '  for pid in $PIDS; do',
        '    CMDLINE="$(ps -p "$pid" -o command= 2>/dev/null || true)"',
        '    if printf \'%s\' "$CMDLINE" | grep -q -- \'--remote-debugging-port\'; then',
        '      HAS_CDP=1',
        '      break',
        '    fi',
        '  done',
        '',
        '  if [ "$HAS_CDP" -eq 1 ]; then',
        '    open -a "$APP_PATH"',
        '    exit 0',
        '  fi',
        '',
        '  if detect_locale_zh; then',
        '    CHOICE="$(osascript \\',
        '      -e \'activate\' \\',
        '      -e \'set dialogResult to display dialog "Antigravity 当前正在运行且未开启 CDP 远程调试。是否退出并以 CDP 模式重新启动？" with title "Antigravity (CDP)" buttons {"取消", "退出并重启"} default button "取消" cancel button "取消"\' \\',
        '      -e \'return button returned of dialogResult\' 2>/dev/null || true)"',
        '    if [ "$CHOICE" != "退出并重启" ]; then',
        '      exit 0',
        '    fi',
        '  else',
        '    CHOICE="$(osascript \\',
        '      -e \'activate\' \\',
        '      -e \'set dialogResult to display dialog "Antigravity is currently running without CDP remote debugging. Quit & relaunch with CDP enabled?" with title "Antigravity (CDP)" buttons {"Cancel", "Quit & Relaunch"} default button "Cancel" cancel button "Cancel"\' \\',
        '      -e \'return button returned of dialogResult\' 2>/dev/null || true)"',
        '    if [ "$CHOICE" != "Quit & Relaunch" ]; then',
        '      exit 0',
        '    fi',
        '  fi',
        '',
        '  QUIT_RC=0',
        '  osascript -e "tell application id \\"$BUNDLE_ID\\" to quit" >/dev/null 2>&1 || QUIT_RC=$?',
        '  if [ "$QUIT_RC" -ne 0 ]; then',
        '    sleep 0.5',
        '    if [ -n "$(find_main_pids)" ]; then',
        '      if detect_locale_zh; then',
        '        osascript \\',
        '          -e \'activate\' \\',
        '          -e \'display alert "需要权限以退出 Antigravity" message "请在「系统设置 > 隐私与安全性 > 自动化」中允许 Antigravity (CDP) 控制权限，或先按 Cmd+Q 手动退出 Antigravity 后再重新打开 Antigravity (CDP)。"\' >/dev/null 2>&1 || true',
        '      else',
        '        osascript \\',
        '          -e \'activate\' \\',
        '          -e \'display alert "Permission Needed to Quit Antigravity" message "Allow Automation permission for Antigravity (CDP) in System Settings > Privacy & Security > Automation, or press Cmd+Q to quit Antigravity first and then open Antigravity (CDP) again."\' >/dev/null 2>&1 || true',
        '      fi',
        '      exit 1',
        '    fi',
        '  fi',
        '',
        '  if ! wait_for_exit; then',
        '    if detect_locale_zh; then',
        '      osascript -e \'activate\' -e \'display alert "Antigravity 仍在退出中" message "Antigravity 在 15 秒内尚未完全退出。请等待程序坞图标下方的指示点消失后，再重新打开 Antigravity (CDP)。"\' >/dev/null 2>&1 || true',
        '    else',
        '      osascript -e \'activate\' -e \'display alert "Antigravity Still Closing" message "Antigravity did not finish exiting within 15 seconds. Wait for its Dock indicator dot to disappear, then open Antigravity (CDP) again."\' >/dev/null 2>&1 || true',
        '    fi',
        '    exit 1',
        '  fi',
        'else',
        '  # Wait cleanly up to 15s in case a dying PID is still finishing background teardown.',
        '  if ! wait_for_exit; then',
        '    exit 1',
        '  fi',
        'fi',
        '',
        'open -a "$APP_PATH" --args --remote-debugging-port=0',
        '',
    ].join('\n');
}

export function buildLinuxLauncherScript(targetAppPath?: string): string {
    const rawTarget = targetAppPath && targetAppPath.trim() && targetAppPath.trim() !== 'antigravity'
        ? targetAppPath.trim().replace(/[\r\n]+/g, '')
        : 'antigravity';
    const cleanTarget = rawTarget || 'antigravity';

    return [
        '#!/usr/bin/env sh',
        'set -eu',
        '',
        '# Zero-patch persistent CDP launcher generated by Antigravity Context Monitor.',
        '# Detects standard binary, Snap, Flatpak, and AppImage instances while excluding antigravity-cdp itself.',
        '# Never terminates Antigravity — shows a friendly localized dialog if an argless instance is open.',
        `DEFAULT_BIN=${escapeSingleQuotedPosix(cleanTarget)}`,
        'APP_BIN="${ANTIGRAVITY_BIN:-$DEFAULT_BIN}"',
        '',
        'is_zh_locale() {',
        '  loc="${ACM_LAUNCHER_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}"',
        '  case "$loc" in',
        '    zh*|ZH*|*zh_CN*|*zh_TW*|*zh_HK*|*zh-Hans*|*zh-Hant*) return 0 ;;',
        '    *) return 1 ;;',
        '  esac',
        '}',
        '',
        'detect_running_state() {',
        '  ps -eo pid=,args= 2>/dev/null | awk -v self_pid="$$" \'',
        '    BEGIN { found_cdp = 0; found_nocdp = 0 }',
        '    {',
        '      pid = $1',
        '      if (pid == self_pid) next',
        '      line = $0',
        '      sub(/^[ \\t]*[0-9]+[ \\t]+/, "", line)',
        '      lower = tolower(line)',
        '      if (lower ~ /(^|[ \\t\\/"\\047])antigravity-cdp([ \\t"\\047]|$)/) next',
        '      if (index(lower, "antigravity-context-monitor") > 0) next',
        '      if (index(lower, "language_server") > 0) next',
        '      if (index(lower, "crashpad") > 0) next',
        '      if (index(lower, "chrome-sandbox") > 0) next',
        '      if (index(lower, "flatpak-spawn") > 0) next',
        '      if (lower ~ /(^|[ \\t])--type=/) next',
        '      if (lower ~ /(^|[ \\t\\/])antigravity[ \\t-]+(ide|tools)([ \\t\\/]|$)/) next',
        '      exe = tolower($2)',
        '      cmd_head = lower',
        '      sub(/[ \\t]+--.*/, "", cmd_head)',
        '      is_shell = (exe ~ /(^|\\/)(sh|bash|dash|zsh|fish|awk|mawk|gawk|grep|pgrep|ps|env|node|python[0-9.]*)$/)',
        '      is_main = 0',
        '      if (exe ~ /(^|\\/)antigravity$/) is_main = 1',
        '      else if (exe ~ /^\\/snap\\/(bin\\/antigravity|antigravity\\/.*\\/antigravity)$/) is_main = 1',
        '      else if (exe ~ /^\\/app\\/(.*\\/)?antigravity$/) is_main = 1',
        '      else if (exe ~ /(^|\\/)flatpak$/ && lower ~ /[ \\t]run([ \\t]|$)/ && lower ~ /com\\.google\\.antigravity/) is_main = 1',
        '      else if (exe ~ /(^|\\/)[^\\/]*antigravity[^\\/]*\\.appimage$/) is_main = 1',
        '      else if (exe ~ /^\\/tmp\\/\\.mount_[^\\/]+\\/(.*\\/)?antigravity$/) is_main = 1',
        '      else if (exe ~ /^\\/tmp\\/\\.mount_[^\\/]*antigr[^\\/]*\\/(.*\\/)?(antigravity|apprun)$/) is_main = 1',
        '      else if (!is_shell && cmd_head ~ /^\\//) {',
        '        if (cmd_head ~ /(^|\\/)antigravity$/) is_main = 1',
        '        else if (cmd_head ~ /^\\/app\\/(.*\\/)?antigravity$/) is_main = 1',
        '        else if (cmd_head ~ /(^|\\/)[^\\/]*antigravity[^\\/]*\\.appimage$/) is_main = 1',
        '        else if (cmd_head ~ /^\\/tmp\\/\\.mount_[^\\/]+\\/(.*\\/)?antigravity$/) is_main = 1',
        '        else if (cmd_head ~ /^\\/tmp\\/\\.mount_[^\\/]*antigr[^\\/]*\\/(.*\\/)?(antigravity|apprun)$/) is_main = 1',
        '      }',
        '      if (!is_main) next',
        '      if (index(lower, "--remote-debugging-port") > 0) found_cdp = 1',
        '      else found_nocdp = 1',
        '    }',
        '    END {',
        '      if (found_cdp) print "cdp"',
        '      else if (found_nocdp) print "nocdp"',
        '      else print "none"',
        '    }',
        '  \' || printf \'none\\n\'',
        '}',
        '',
        'show_conflict_notice() {',
        '  msg="$1"',
        '  if command -v zenity >/dev/null 2>&1 && zenity --warning --title="Antigravity (CDP)" --text="$msg" >/dev/null 2>&1; then',
        '    return 0',
        '  fi',
        '  if command -v kdialog >/dev/null 2>&1 && kdialog --title "Antigravity (CDP)" --sorry "$msg" >/dev/null 2>&1; then',
        '    return 0',
        '  fi',
        '  if command -v notify-send >/dev/null 2>&1 && notify-send "Antigravity (CDP)" "$msg" >/dev/null 2>&1; then',
        '    return 0',
        '  fi',
        '  printf \'Antigravity (CDP): %s\\n\' "$msg" >&2',
        '}',
        '',
        'STATE="$(detect_running_state)"',
        '',
        'if [ "$STATE" = "nocdp" ]; then',
        '  # Wait cleanly up to 5s if an exiting Antigravity process is still tearing down.',
        '  max_ticks="${ACM_EXIT_WAIT_TICKS:-20}"',
        '  tick=0',
        '  while [ "$tick" -lt "$max_ticks" ]; do',
        '    sleep 0.25',
        '    STATE="$(detect_running_state)"',
        '    if [ "$STATE" != "nocdp" ]; then',
        '      break',
        '    fi',
        '    tick=$((tick + 1))',
        '  done',
        'fi',
        '',
        'if [ "$STATE" = "nocdp" ]; then',
        '  if is_zh_locale; then',
        '    CONFLICT_MSG="Antigravity 当前正在运行且未开启 CDP 远程调试。请先完全退出 Antigravity，再重新打开 Antigravity (CDP)。"',
        '  else',
        '    CONFLICT_MSG="Antigravity is already running without CDP remote debugging. Please quit Antigravity completely first, then open Antigravity (CDP) again."',
        '  fi',
        '  show_conflict_notice "$CONFLICT_MSG"',
        '  exit 1',
        'fi',
        '',
        'case "$APP_BIN" in',
        '  flatpak:*)',
        '    FLATPAK_APP_ID="${APP_BIN#flatpak:}"',
        '    exec flatpak run "$FLATPAK_APP_ID" --remote-debugging-port=0 "$@"',
        '    ;;',
        'esac',
        '',
        'exec "$APP_BIN" --remote-debugging-port=0 "$@"',
        '',
    ].join('\n');
}

export function buildLinuxDesktopEntry(wrapperPath: string, iconValue = 'antigravity'): string {
    const escapedExec = escapeFreedesktopExecArg(wrapperPath);
    const cleanIcon = (iconValue && iconValue.replace(/[\r\n]+/g, '').trim()) || 'antigravity';
    return [
        '[Desktop Entry]',
        'Type=Application',
        'Version=1.0',
        `Name=${CDP_LAUNCHER_DISPLAY_NAME}`,
        'Comment=Launch Antigravity with local CDP remote debugging enabled for Antigravity Context Monitor',
        `Exec=${escapedExec} %U`,
        `Icon=${cleanIcon}`,
        'Terminal=false',
        'Categories=Development;IDE;',
        'StartupWMClass=Antigravity',
        '',
    ].join('\n');
}

export function buildLinuxBadgedSvg(
    embeddedIcon?: { mimeType: 'image/png' | 'image/svg+xml'; base64: string },
): string {
    const baseLayer = embeddedIcon
        ? `  <image href="data:${embeddedIcon.mimeType};base64,${embeddedIcon.base64}" x="8" y="8" width="240" height="240" preserveAspectRatio="xMidYMid meet"/>`
        : [
            '  <defs>',
            '    <linearGradient id="acmBg" x1="0%" y1="0%" x2="100%" y2="100%">',
            '      <stop offset="0%" stop-color="#162033"/>',
            '      <stop offset="100%" stop-color="#0B101A"/>',
            '    </linearGradient>',
            '    <linearGradient id="acmMark" x1="0%" y1="0%" x2="100%" y2="100%">',
            '      <stop offset="0%" stop-color="#60A5FA"/>',
            '      <stop offset="100%" stop-color="#3B82F6"/>',
            '    </linearGradient>',
            '  </defs>',
            '  <rect x="12" y="12" width="232" height="232" rx="52" fill="url(#acmBg)" stroke="#2A3750" stroke-width="4"/>',
            '  <path d="M128 52 L188 184 L156 184 L142 152 L114 152 L100 184 L68 184 Z M128 92 L119 128 L137 128 Z" fill="url(#acmMark)"/>',
        ].join('\n');

    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">',
        baseLayer,
        '  <g>',
        '    <rect x="122" y="182" width="124" height="62" rx="18" fill="#0E1522" fill-opacity="0.96" stroke="#5B9CF6" stroke-width="5"/>',
        '    <text x="184" y="224" text-anchor="middle" fill="#FFFFFF" font-family="Inter, Ubuntu, DejaVu Sans, sans-serif" font-size="38" font-weight="800" letter-spacing="1.5">CDP</text>',
        '  </g>',
        '</svg>',
        '',
    ].join('\n');
}

export const WINDOWS_DESKTOP_PS_SCRIPT =
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')";

export const WINDOWS_EXE_REGISTRY_PS_SCRIPT = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$paths = @(',
    '  "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",',
    '  "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",',
    '  "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"',
    ')',
    'foreach ($p in $paths) {',
    '  Get-ItemProperty -Path $p -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match "^Antigravity" } | ForEach-Object {',
    '    if ($_.InstallLocation) {',
    '      $cand = Join-Path $_.InstallLocation "Antigravity.exe"',
    '      if (Test-Path -LiteralPath $cand) { Write-Output $cand; exit 0 }',
    '    }',
    '    if ($_.DisplayIcon) {',
    '      $ico = ($_.DisplayIcon -replace ",\\d+$", "").Trim(\'"\')',
    '      if ($ico -match "Antigravity\\.exe$" -and (Test-Path -LiteralPath $ico)) { Write-Output $ico; exit 0 }',
    '    }',
    '  }',
    '}',
    'foreach ($ap in @("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Antigravity.exe", "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Antigravity.exe")) {',
    '  $val = (Get-ItemProperty -Path $ap -ErrorAction SilentlyContinue)."(default)"',
    '  if ($val) {',
    '    $clean = $val.Trim(\'"\')',
    '    if (Test-Path -LiteralPath $clean) { Write-Output $clean; exit 0 }',
    '  }',
    '}',
].join('\n');

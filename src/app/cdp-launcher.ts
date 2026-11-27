/**
 * Zero-Patch, Cross-Platform Persistent CDP Launcher Generator & Inspector.
 *
 * Critical Compliance & Safety Guarantees:
 * - Pure Node.js built-ins ONLY (`child_process`, `fs`, `os`, `path`) + native OS utilities — zero external npm deps.
 * - ZERO modification to `/Applications/Antigravity.app`, `app.asar`, `Info.plist`, `codesign`, or `com.apple.dock`.
 * - NEVER kills or terminates any running Antigravity App / IDE process from inside this module.
 * - Generated user-invoked macOS launcher prompts the user via native dialog before graceful quit
 *   and polls cleanly up to 15s (0.25s interval) until the old PID exits, eliminating the 5-second
 *   `before-quit` language_server teardown race.
 */

import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CdpLauncherActionResult, CdpLauncherStatus } from './sidecar-types';

export type { CdpLauncherActionResult, CdpLauncherStatus };

export const CDP_LAUNCHER_DISPLAY_NAME = 'Antigravity (CDP)';
export const MACOS_CDP_LAUNCHER_BUNDLE_ID = 'com.antigravity-context-monitor.cdp-launcher';
export const MACOS_ANTIGRAVITY_BUNDLE_ID = 'com.google.antigravity';
export const MACOS_CDP_BUNDLE_NAME = `${CDP_LAUNCHER_DISPLAY_NAME}.app`;
export const MACOS_SYSTEM_APPLICATIONS_DIR = '/Applications';
export const LINUX_CDP_ICON_FILENAME = 'antigravity-cdp.svg';

const MAX_EMBEDDED_ICON_BYTES = 2 * 1024 * 1024;

export interface SpawnedLauncherProcessLike {
    unref?: () => void;
    on?: (event: string, listener: (err: Error) => void) => unknown;
}

export interface CdpLauncherExecOptions {
    env?: NodeJS.ProcessEnv;
    windowsHide?: boolean;
    stdio?: 'pipe' | 'ignore';
    timeout?: number;
    encoding?: BufferEncoding;
}

export interface CdpLauncherOptions {
    platform?: NodeJS.Platform;
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    appPath?: string;
    /** Optional macOS system Applications directory override (e.g. for isolated tests). Pass `""` to disable system dir lookup. */
    systemAppsDir?: string;
    /** Optional Windows Desktop directory override (bypasses PowerShell lookup when set). */
    desktopDir?: string;
    /** Injectable command runner for Windows PowerShell, macOS icon badging, or Linux `update-desktop-database` in hermetic tests. */
    execFileSyncFn?: (
        file: string,
        args: readonly string[],
        options?: CdpLauncherExecOptions,
    ) => unknown;
    /** Injectable detached process spawner for hermetic `revealCdpLauncher` tests. */
    spawnImpl?: (
        command: string,
        args: readonly string[],
        options?: { detached?: boolean; stdio?: 'ignore'; windowsHide?: boolean },
    ) => SpawnedLauncherProcessLike | undefined;
    /** Injectable PATH lookup for Linux `antigravity` binary detection in tests. */
    commandExistsFn?: (cmd: string) => boolean;
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
}

// ─── Cross-Platform Path & Escaping Helpers ──────────────────────────────────

function joinTargetPath(platform: NodeJS.Platform, ...segments: string[]): string {
    if (
        platform === 'win32'
        && segments.length > 0
        && (/^[A-Za-z]:/.test(segments[0]) || segments[0].includes('\\'))
    ) {
        return path.win32.join(...segments);
    }
    return path.join(...segments);
}

function dirnameTargetPath(platform: NodeJS.Platform, target: string): string {
    if (platform === 'win32' && (/^[A-Za-z]:/.test(target) || target.includes('\\'))) {
        return path.win32.dirname(target);
    }
    return path.dirname(target);
}

function normalizePosixComparable(p: string): string {
    return path.resolve(p).replace(/\/+$/, '') || '/';
}

function getRealOsHomeDir(): string {
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

function resolveHomeDir(opts: CdpLauncherOptions, platform: NodeJS.Platform): string {
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

/**
 * Determine the macOS system Applications directory while maintaining strict test isolation.
 * - Explicit `opts.systemAppsDir` or `env.ACM_MACOS_APPLICATIONS_DIR` always takes precedence.
 * - When `homeDir` or `HOME` is overridden in tests without explicit `systemAppsDir`, returns `null`
 *   so tests NEVER inspect, write, or delete inside the host's real `/Applications`.
 */
function resolveMacSystemAppsDir(opts: CdpLauncherOptions, env: NodeJS.ProcessEnv): string | null {
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

function isDirectoryWritable(dirPath: string): boolean {
    try {
        if (!fs.existsSync(dirPath)) {
            return false;
        }
        const st = fs.statSync(dirPath);
        if (!st.isDirectory()) {
            return false;
        }
        if (process.platform !== 'win32' && (st.mode & 0o222) === 0) {
            return false;
        }
        fs.accessSync(dirPath, fs.constants.W_OK | fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function isMacAppBundleInstalled(appDir: string | undefined): boolean {
    if (!appDir) { return false; }
    return fs.existsSync(path.join(appDir, 'Contents', 'Info.plist'))
        && fs.existsSync(path.join(appDir, 'Contents', 'MacOS', 'launch'));
}

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

function escapeSingleQuotedPosix(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeExtendedRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXmlText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function escapeFreedesktopExecArg(value: string): string {
    const clean = value.replace(/[\r\n]+/g, '');
    const pctEscaped = clean.replace(/%/g, '%%');
    if (pctEscaped.length === 0 || /[\s"'\\><~|&;$*?#()`]/.test(pctEscaped)) {
        const execQuoted = pctEscaped.replace(/([\\"`$])/g, '\\$1');
        const desktopEscaped = execQuoted.replace(/\\/g, '\\\\');
        return `"${desktopEscaped}"`;
    }
    return pctEscaped;
}

function defaultCommandExists(cmd: string, env: NodeJS.ProcessEnv = process.env): boolean {
    const pathEnv = env.PATH || '';
    for (const dir of pathEnv.split(path.delimiter)) {
        if (!dir) { continue; }
        const full = path.join(dir, cmd);
        try {
            const st = fs.statSync(full);
            if (st.isFile()) { return true; }
        } catch {
            // ignore
        }
    }
    return false;
}

export const WINDOWS_DESKTOP_PS_SCRIPT =
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Environment]::GetFolderPath('Desktop')";

function resolveWindowsDesktopDir(opts: CdpLauncherOptions, homeDir: string, env: NodeJS.ProcessEnv): string {
    if (opts.desktopDir && opts.desktopDir.trim()) {
        return opts.desktopDir.trim();
    }
    const fallback = joinTargetPath('win32', homeDir, 'Desktop');
    if (process.platform === 'win32' || typeof opts.execFileSyncFn === 'function') {
        try {
            const runner = createDefaultRunner(opts.execFileSyncFn);
            const raw = runner(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_DESKTOP_PS_SCRIPT],
                { env, windowsHide: true, stdio: 'pipe', timeout: 3_000, encoding: 'utf8' },
            );
            const text = Buffer.isBuffer(raw)
                ? raw.toString('utf8')
                : (typeof raw === 'string' ? raw : '');
            const cleaned = text.replace(/^\uFEFF/, '').trim();
            if (cleaned && !/[\r\n]/.test(cleaned)) {
                return cleaned;
            }
        } catch {
            // Fallback cleanly to %USERPROFILE%\Desktop
        }
    }
    return fallback;
}

/**
 * Race-free, zero-patch terminal command for launching Antigravity with
 * Chromium's documented `--remote-debugging-port=0` flag.
 */
export function getSafeCdpLaunchCommand(platform: NodeJS.Platform = process.platform): string {
    if (platform === 'darwin') {
        return 'while pgrep -f \'^/Applications/Antigravity\\.app/Contents/MacOS/Antigravity($| )\' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0';
    }
    if (platform === 'win32') {
        return '& "$env:LOCALAPPDATA\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0';
    }
    return 'antigravity --remote-debugging-port=0';
}

export function resolveCdpLauncherPaths(opts: CdpLauncherOptions = {}): ResolvedCdpLauncherPaths {
    const platform = opts.platform ?? process.platform;
    const env = opts.env ?? process.env;
    const homeDir = resolveHomeDir(opts, platform);

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

        const preferSystem = Boolean(macSystemAppsDir && macSystemAppDir && isDirectoryWritable(macSystemAppsDir));
        const macPreferredAppDir = preferSystem && macSystemAppDir ? macSystemAppDir : macUserAppDir;
        const installedAppDir = macCandidateAppDirs.find(isMacAppBundleInstalled);
        const macAppDir = installedAppDir ?? macPreferredAppDir;

        let targetAppPath = opts.appPath?.trim() || '';
        if (!targetAppPath) {
            const targetCandidates = [
                ...(macSystemAppsDir ? [joinTargetPath('darwin', macSystemAppsDir, 'Antigravity.app')] : []),
                '/Applications/Antigravity.app',
                joinTargetPath('darwin', homeDir, 'Applications', 'Antigravity.app'),
            ];
            targetAppPath = targetCandidates.find((p) => fs.existsSync(p))
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
        const winDesktopDir = resolveWindowsDesktopDir(opts, homeDir, env);
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
        const targetAppPath = opts.appPath?.trim()
            || joinTargetPath('win32', localAppData, 'Programs', 'Antigravity', 'Antigravity.exe');
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
        const linuxWrapperPath = joinTargetPath('linux', homeDir, '.local', 'bin', 'antigravity-cdp');
        const linuxDesktopEntryPath = joinTargetPath(
            'linux',
            homeDir,
            '.local',
            'share',
            'applications',
            'antigravity-cdp.desktop',
        );
        const linuxIconPath = joinTargetPath(
            'linux',
            homeDir,
            '.local',
            'share',
            'icons',
            'hicolor',
            'scalable',
            'apps',
            LINUX_CDP_ICON_FILENAME,
        );
        let targetAppPath = opts.appPath?.trim() || '';
        if (!targetAppPath) {
            const candidates = [
                '/usr/bin/antigravity',
                '/usr/local/bin/antigravity',
                '/snap/bin/antigravity',
                '/opt/Antigravity/antigravity',
                joinTargetPath('linux', homeDir, '.local', 'bin', 'antigravity'),
            ];
            targetAppPath = candidates.find((p) => fs.existsSync(p)) || 'antigravity';
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

// ─── Launcher File & Icon Badge Builders ─────────────────────────────────────

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
        'if [ ! -d "$APP_PATH" ]; then',
        '  osascript -e \'activate\' -e \'display alert "Antigravity App Not Found" message "Could not locate Antigravity.app. Please install Antigravity App first."\' >/dev/null 2>&1 || true',
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
        '  CHOICE="$(osascript \\',
        '    -e \'activate\' \\',
        '    -e \'set dialogResult to display dialog "Antigravity is currently running without CDP remote debugging. Quit & relaunch with CDP enabled?" with title "Antigravity (CDP)" buttons {"Cancel", "Quit & Relaunch"} default button "Quit & Relaunch" cancel button "Cancel"\' \\',
        '    -e \'return button returned of dialogResult\' 2>/dev/null || true)"',
        '  if [ "$CHOICE" != "Quit & Relaunch" ]; then',
        '    exit 0',
        '  fi',
        '',
        '  QUIT_RC=0',
        '  osascript -e "tell application id \\"$BUNDLE_ID\\" to quit" >/dev/null 2>&1 || QUIT_RC=$?',
        '  if [ "$QUIT_RC" -ne 0 ]; then',
        '    sleep 0.5',
        '    if [ -n "$(find_main_pids)" ]; then',
        '      osascript \\',
        '        -e \'activate\' \\',
        '        -e \'display alert "Permission Needed to Quit Antigravity" message "Allow Automation permission for Antigravity (CDP) in System Settings > Privacy & Security > Automation, or press Cmd+Q to quit Antigravity first and then open Antigravity (CDP) again."\' >/dev/null 2>&1 || true',
        '      exit 1',
        '    fi',
        '  fi',
        '  if ! wait_for_exit; then',
        '    osascript -e \'activate\' -e \'display alert "Antigravity Still Closing" message "Antigravity did not finish exiting within 15 seconds. Wait for its Dock indicator dot to disappear, then open Antigravity (CDP) again."\' >/dev/null 2>&1 || true',
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
        '# Detects standard binary, Snap, and AppImage instances while excluding antigravity-cdp itself.',
        '# Never kills Antigravity — shows a friendly non-killing dialog if an argless instance is open.',
        `DEFAULT_BIN=${escapeSingleQuotedPosix(cleanTarget)}`,
        'APP_BIN="${ANTIGRAVITY_BIN:-$DEFAULT_BIN}"',
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
        '      if (lower ~ /(^|[ \\t])--type=/) next',
        '      if (lower ~ /(^|[ \\t\\/])antigravity[ \\t-]+(ide|tools)([ \\t\\/]|$)/) next',
        '      exe = tolower($2)',
        '      cmd_head = lower',
        '      sub(/[ \\t]+--.*/, "", cmd_head)',
        '      is_shell = (exe ~ /(^|\\/)(sh|bash|dash|zsh|fish|awk|mawk|gawk|grep|pgrep|ps|env|node|python[0-9.]*)$/)',
        '      is_main = 0',
        '      if (exe ~ /(^|\\/)antigravity$/) is_main = 1',
        '      else if (exe ~ /^\\/snap\\/(bin\\/antigravity|antigravity\\/.*\\/antigravity)$/) is_main = 1',
        '      else if (exe ~ /(^|\\/)[^\\/]*antigravity[^\\/]*\\.appimage$/) is_main = 1',
        '      else if (exe ~ /^\\/tmp\\/\\.mount_[^\\/]*antigravity[^\\/]*\\/(.*\\/)?(antigravity|apprun)$/) is_main = 1',
        '      else if (!is_shell && cmd_head ~ /^\\//) {',
        '        if (cmd_head ~ /(^|\\/)antigravity$/) is_main = 1',
        '        else if (cmd_head ~ /(^|\\/)[^\\/]*antigravity[^\\/]*\\.appimage$/) is_main = 1',
        '        else if (cmd_head ~ /^\\/tmp\\/\\.mount_[^\\/]*antigravity[^\\/]*\\/(.*\\/)?(antigravity|apprun)$/) is_main = 1',
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
        '  show_conflict_notice "Antigravity is already running without CDP remote debugging. Please quit Antigravity completely first, then open Antigravity (CDP) again."',
        '  exit 1',
        'fi',
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

export function buildLinuxBadgedSvg(embeddedIcon?: { mimeType: 'image/png' | 'image/svg+xml'; base64: string }): string {
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

const MACOS_ICON_BADGE_JXA = [
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
    'const style = $.NSMutableParagraphStyle.alloc.init; style.setAlignment($.NSTextAlignmentCenter);',
    'const attrs = $.NSMutableDictionary.dictionary;',
    'attrs.setObjectForKey(font, $.NSFontAttributeName);',
    'attrs.setObjectForKey($.NSColor.whiteColor, $.NSForegroundColorAttributeName);',
    'attrs.setObjectForKey(style, $.NSParagraphStyleAttributeName);',
    'const text = $.NSString.stringWithString("CDP");',
    'const textSize = text.sizeWithAttributes(attrs);',
    'text.drawInRectWithAttributes($.NSMakeRect(badgeX, badgeY + (badgeH - textSize.height) / 2 - 4, badgeW, textSize.height), attrs);',
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

function findLinuxOriginalIcon(homeDir: string, targetAppPath: string): { mimeType: 'image/png' | 'image/svg+xml'; base64: string } | undefined {
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

function writeLinuxBadgedIcon(iconPath: string, homeDir: string, targetAppPath: string): boolean {
    try {
        fs.mkdirSync(path.dirname(iconPath), { recursive: true });
        const embedded = findLinuxOriginalIcon(homeDir, targetAppPath);
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

function getPlatformNotes(platform: NodeJS.Platform, launcherPath: string): { noteEn: string; noteZh: string } {
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
            noteEn: `Creates a zero-patch CDP-badged desktop entry at "${launcherPath}" and wrapper in ~/.local/bin/antigravity-cdp (handles standard/Snap/AppImage detection with non-killing conflict dialog and StartupWMClass=Antigravity). Pin "Antigravity (CDP)" from the Ubuntu Application Launcher / Show Apps ("Pin to Dash" / "Add to Favorites") rather than pinning the running Dock window icon.`,
            noteZh: `在 "${launcherPath}" 创建带 CDP 角标的零侵入桌面入口并在 ~/.local/bin/antigravity-cdp 生成启动脚本（兼容标准安装/Snap/AppImage 检测、冲突时弹窗提醒绝不强杀，保留 StartupWMClass=Antigravity）。请在 Ubuntu「显示应用」菜单中搜索「Antigravity (CDP)」并选择「固定到停靠栏 / 添加到收藏夹」，切勿右键运行中的窗口图标固定。`,
        };
    }
    return {
        noteEn: `Persistent CDP launcher generation is not supported on platform "${platform}". Launch Antigravity with --remote-debugging-port=0 manually.`,
        noteZh: `当前平台 "${platform}" 暂不支持自动生成持久化 CDP 启动器，请手动附带 --remote-debugging-port=0 启动 Antigravity。`,
    };
}

// ─── Public API: Inspect, Create, Remove ─────────────────────────────────────

export function inspectCdpLauncher(opts: CdpLauncherOptions = {}): CdpLauncherStatus {
    const resolved = resolveCdpLauncherPaths(opts);
    const safeTerminalCommand = getSafeCdpLaunchCommand(resolved.platform);
    const { noteEn, noteZh } = getPlatformNotes(resolved.platform, resolved.launcherPath);

    let installed = false;
    let targetAppFound = false;

    if (resolved.platform === 'darwin') {
        const candidates = resolved.macCandidateAppDirs ?? (resolved.macAppDir ? [resolved.macAppDir] : []);
        installed = candidates.some(isMacAppBundleInstalled);
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
        if (resolved.targetAppPath && resolved.targetAppPath !== 'antigravity') {
            targetAppFound = fs.existsSync(resolved.targetAppPath);
        } else {
            const existsFn = opts.commandExistsFn ?? ((cmd: string) => defaultCommandExists(cmd, opts.env ?? process.env));
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

export function createCdpLauncher(opts: CdpLauncherOptions = {}): CdpLauncherActionResult {
    const resolved = resolveCdpLauncherPaths(opts);
    if (!resolved.supported) {
        const status = inspectCdpLauncher(opts);
        return {
            ok: false,
            status,
            messageEn: `Persistent CDP launcher is not supported on ${resolved.platform}.`,
            messageZh: `当前平台 ${resolved.platform} 不支持创建持久化 CDP 启动器。`,
            error: `Unsupported platform: ${resolved.platform}`,
        };
    }

    try {
        if (resolved.platform === 'darwin' && resolved.macPreferredAppDir) {
            const primaryDir = resolved.macPreferredAppDir;
            const fallbackDir = resolved.macUserAppDir ?? primaryDir;
            let createdDir = primaryDir;

            try {
                writeMacOsBundleAt(primaryDir, resolved.targetAppPath, opts);
            } catch (err) {
                const code = (err as NodeJS.ErrnoException)?.code;
                const isPermError = code === 'EACCES' || code === 'EPERM' || code === 'EROFS';
                if (isPermError && normalizePosixComparable(primaryDir) !== normalizePosixComparable(fallbackDir)) {
                    createdDir = fallbackDir;
                    writeMacOsBundleAt(fallbackDir, resolved.targetAppPath, opts);
                } else {
                    throw err;
                }
            }

            // Auto-remove stale `Antigravity (CDP).app` in the other candidate dir after creation succeeds
            const createdNorm = normalizePosixComparable(createdDir);
            for (const candidate of resolved.macCandidateAppDirs ?? []) {
                if (
                    normalizePosixComparable(candidate) !== createdNorm
                    && path.basename(candidate) === MACOS_CDP_BUNDLE_NAME
                    && fs.existsSync(candidate)
                ) {
                    try {
                        fs.rmSync(candidate, { recursive: true, force: true });
                    } catch {
                        // Best-effort cleanup if stale dir is in an unwritable location
                    }
                }
            }

            const status = inspectCdpLauncher(opts);
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

            const runner = createDefaultRunner(opts.execFileSyncFn);
            const targetExe = resolved.targetAppPath;
            const psEnv: NodeJS.ProcessEnv = {
                ...(opts.env ?? process.env),
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
            if (resolved.winCmdPath) {
                const dataDir = dirnameTargetPath('win32', resolved.winCmdPath);
                try {
                    if (fs.existsSync(dataDir) && fs.readdirSync(dataDir).length === 0) {
                        fs.rmdirSync(dataDir);
                    }
                } catch {
                    // ignore
                }
            }

            const status = inspectCdpLauncher({ ...opts, desktopDir: resolved.winDesktopDir });
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
                ? writeLinuxBadgedIcon(resolved.linuxIconPath, resolved.homeDir, resolved.targetAppPath)
                : false;
            const iconValue = iconWritten && resolved.linuxIconPath ? resolved.linuxIconPath : 'antigravity';

            fs.writeFileSync(
                resolved.linuxDesktopEntryPath,
                buildLinuxDesktopEntry(resolved.linuxWrapperPath, iconValue),
                'utf8',
            );

            runLinuxUpdateDesktopDatabase(applicationsDir, opts);

            const status = inspectCdpLauncher(opts);
            return {
                ok: true,
                status,
                messageEn: `Created persistent Linux CDP launcher at "${resolved.linuxDesktopEntryPath}" (wrapper: "${resolved.linuxWrapperPath}"). Pin "Antigravity (CDP)" from Show Apps / Application Launcher ("Pin to Dash" / "Add to Favorites") rather than pinning the running Dock window icon.`,
                messageZh: `已创建 Linux 持久化 CDP 启动入口："${resolved.linuxDesktopEntryPath}"（脚本："${resolved.linuxWrapperPath}"）。请在「显示应用」菜单中搜索「Antigravity (CDP)」并「固定到停靠栏 / 添加到收藏夹」，切勿右键运行中的窗口图标固定。`,
            };
        }

        const status = inspectCdpLauncher(opts);
        return {
            ok: false,
            status,
            messageEn: 'Failed to resolve persistent launcher paths.',
            messageZh: '无法解析持久化启动器路径。',
            error: 'Unresolved launcher paths',
        };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const status = inspectCdpLauncher(
            resolved.winDesktopDir ? { ...opts, desktopDir: resolved.winDesktopDir } : opts,
        );
        return {
            ok: false,
            status,
            messageEn: `Failed to create persistent CDP launcher: ${errorMsg}`,
            messageZh: `创建持久化 CDP 启动器失败：${errorMsg}`,
            error: errorMsg,
        };
    }
}

export function revealCdpLauncher(opts: CdpLauncherOptions = {}): CdpLauncherActionResult {
    const resolved = resolveCdpLauncherPaths(opts);
    const status = inspectCdpLauncher(
        resolved.winDesktopDir ? { ...opts, desktopDir: resolved.winDesktopDir } : opts,
    );

    if (!status.supported) {
        return {
            ok: false,
            status,
            messageEn: `Persistent CDP launcher is not supported on ${status.platform}.`,
            messageZh: `当前平台 ${status.platform} 不支持定位持久化 CDP 启动器。`,
            error: `Unsupported platform: ${status.platform}`,
        };
    }

    if (!status.installed) {
        return {
            ok: false,
            status,
            messageEn: 'Persistent CDP launcher has not been created yet. Click "Create Persistent Launcher" first.',
            messageZh: '尚未创建持久化 CDP 启动器，请先点击「一键生成持久化启动器」。',
            error: 'Launcher not created yet',
        };
    }

    const spawnFn = opts.spawnImpl
        ?? ((
            command: string,
            args: readonly string[],
            options?: { detached?: boolean; stdio?: 'ignore'; windowsHide?: boolean },
        ) => spawn(command, [...args], {
            detached: options?.detached ?? true,
            stdio: options?.stdio ?? 'ignore',
            windowsHide: options?.windowsHide ?? true,
        }));
    const spawnOpts = { detached: true, stdio: 'ignore' as const, windowsHide: true };
    const launchDetached = (command: string, args: readonly string[]): void => {
        const child = spawnFn(command, args, spawnOpts);
        child?.on?.('error', () => { /* avoid unhandled error events on detached launcher helper */ });
        child?.unref?.();
    };

    try {
        if (status.platform === 'darwin') {
            launchDetached('open', ['-R', status.launcherPath]);
            return {
                ok: true,
                status,
                messageEn: `Revealed "${status.launcherPath}" in Finder. Drag "Antigravity (CDP).app" from Finder into your Dock — NEVER right-click the running Antigravity icon to choose "Keep in Dock".`,
                messageZh: `已在访达中定位「${status.launcherPath}」。请直接从访达拖入程序坞固定——切勿右键运行中的图标选「在程序坞中保留」。`,
            };
        }

        if (status.platform === 'win32') {
            const selectTarget = fs.existsSync(status.launcherPath)
                ? status.launcherPath
                : (resolved.winFallbackDesktopLnkPath && fs.existsSync(resolved.winFallbackDesktopLnkPath)
                    ? resolved.winFallbackDesktopLnkPath
                    : (resolved.winStartMenuLnkPath && fs.existsSync(resolved.winStartMenuLnkPath)
                        ? resolved.winStartMenuLnkPath
                        : ''));
            const parentDir = dirnameTargetPath('win32', selectTarget || status.launcherPath);
            if (selectTarget) {
                try {
                    launchDetached('explorer.exe', [`/select,${selectTarget}`]);
                } catch {
                    launchDetached('explorer.exe', [parentDir]);
                }
            } else {
                launchDetached('explorer.exe', [parentDir]);
            }
            const revealedTarget = selectTarget || parentDir;
            return {
                ok: true,
                status,
                messageEn: `Opened Explorer at "${revealedTarget}". Launch "Antigravity (CDP)" (or right-click it -> Pin to taskbar) to keep CDP enabled.`,
                messageZh: `已在资源管理器中定位「${revealedTarget}」。请从该「Antigravity (CDP)」快捷方式启动（或右键「固定到任务栏」）。`,
            };
        }

        if (status.platform === 'linux') {
            const folderPath = dirnameTargetPath('linux', status.launcherPath);
            launchDetached('xdg-open', [folderPath]);
            return {
                ok: true,
                status,
                messageEn: `Opened launcher folder "${folderPath}". Launch or pin "Antigravity (CDP)" from Show Apps / Application Launcher (not the running Dock icon).`,
                messageZh: `已打开启动器目录「${folderPath}」。请从「显示应用」菜单启动或固定「Antigravity (CDP)」（勿右键运行中的窗口图标固定）。`,
            };
        }

        return {
            ok: false,
            status,
            messageEn: `Persistent CDP launcher is not supported on ${status.platform}.`,
            messageZh: `当前平台 ${status.platform} 不支持定位持久化 CDP 启动器。`,
            error: `Unsupported platform: ${status.platform}`,
        };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            status,
            messageEn: `Failed to reveal persistent CDP launcher: ${errorMsg}`,
            messageZh: `无法打开持久化 CDP 启动器位置：${errorMsg}`,
            error: errorMsg,
        };
    }
}

export function removeCdpLauncher(opts: CdpLauncherOptions = {}): CdpLauncherActionResult {
    const resolved = resolveCdpLauncherPaths(opts);
    if (!resolved.supported) {
        const status = inspectCdpLauncher(opts);
        return {
            ok: false,
            status,
            messageEn: `Persistent CDP launcher is not supported on ${resolved.platform}.`,
            messageZh: `当前平台 ${resolved.platform} 不支持移除持久化 CDP 启动器。`,
            error: `Unsupported platform: ${resolved.platform}`,
        };
    }

    try {
        let removedAny = false;
        const removeIfPresent = (target: string | undefined, recursive: boolean) => {
            if (!target || !fs.existsSync(target)) { return; }
            fs.rmSync(target, { recursive, force: true });
            removedAny = true;
        };

        if (resolved.platform === 'darwin') {
            // Safety invariant: ONLY remove our own `Antigravity (CDP).app`, NEVER `/Applications/Antigravity.app`
            const candidates = resolved.macCandidateAppDirs ?? (resolved.macAppDir ? [resolved.macAppDir] : []);
            for (const candidate of candidates) {
                if (path.basename(candidate) === MACOS_CDP_BUNDLE_NAME) {
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
            if (resolved.winCmdPath) {
                const wrapperDir = dirnameTargetPath('win32', resolved.winCmdPath);
                try {
                    if (fs.existsSync(wrapperDir) && fs.readdirSync(wrapperDir).length === 0) {
                        fs.rmdirSync(wrapperDir);
                    }
                } catch {
                    // Best-effort empty directory cleanup
                }
            }
        } else if (resolved.platform === 'linux') {
            removeIfPresent(resolved.linuxDesktopEntryPath, false);
            removeIfPresent(resolved.linuxWrapperPath, false);
            removeIfPresent(resolved.linuxIconPath, false);
            if (resolved.linuxDesktopEntryPath) {
                runLinuxUpdateDesktopDatabase(path.dirname(resolved.linuxDesktopEntryPath), opts);
            }
        }

        const status = inspectCdpLauncher(
            resolved.winDesktopDir ? { ...opts, desktopDir: resolved.winDesktopDir } : opts,
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
        const errorMsg = err instanceof Error ? err.message : String(err);
        const status = inspectCdpLauncher(
            resolved.winDesktopDir ? { ...opts, desktopDir: resolved.winDesktopDir } : opts,
        );
        return {
            ok: false,
            status,
            messageEn: `Failed to remove persistent CDP launcher: ${errorMsg}`,
            messageZh: `移除持久化 CDP 启动器失败：${errorMsg}`,
            error: errorMsg,
        };
    }
}

/**
 * Zero-Patch, Cross-Platform Persistent CDP Launcher Generator & Inspector.
 *
 * Critical Compliance & Safety Guarantees:
 * - Pure Node.js built-ins ONLY (`child_process`, `fs`, `os`, `path`) — zero external npm deps.
 * - ZERO modification to `/Applications/Antigravity.app`, `app.asar`, `Info.plist`, or `codesign`.
 * - NEVER kills or terminates any running Antigravity App / IDE process from inside this module.
 * - Generated user-invoked macOS launcher prompts the user via native dialog before graceful quit
 *   and polls cleanly up to 15s (0.25s interval) until the old PID exits, eliminating the 5-second
 *   `before-quit` language_server teardown race.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CdpLauncherActionResult, CdpLauncherStatus } from './sidecar-types';

export type { CdpLauncherActionResult, CdpLauncherStatus };

export const CDP_LAUNCHER_DISPLAY_NAME = 'Antigravity (CDP)';
export const MACOS_CDP_LAUNCHER_BUNDLE_ID = 'com.antigravity-context-monitor.cdp-launcher';
export const MACOS_ANTIGRAVITY_BUNDLE_ID = 'com.google.antigravity';

export interface CdpLauncherOptions {
    platform?: NodeJS.Platform;
    homeDir?: string;
    env?: NodeJS.ProcessEnv;
    appPath?: string;
    /** Injectable command runner for Windows `.lnk` creation in hermetic tests. */
    execFileSyncFn?: (
        file: string,
        args: readonly string[],
        options?: { env?: NodeJS.ProcessEnv; windowsHide?: boolean; stdio?: 'pipe' | 'ignore' },
    ) => unknown;
    /** Injectable PATH lookup for Linux `antigravity` binary detection in tests. */
    commandExistsFn?: (cmd: string) => boolean;
}

export interface ResolvedCdpLauncherPaths {
    platform: NodeJS.Platform;
    supported: boolean;
    homeDir: string;
    launcherPath: string;
    targetAppPath: string;
    /** Secondary paths managed by the launcher (Windows wrapper/Start Menu shortcut, Linux wrapper). */
    auxiliaryPaths: string[];
    // Platform-specific structured fields
    macAppDir?: string;
    winCmdPath?: string;
    winDesktopLnkPath?: string;
    winStartMenuLnkPath?: string;
    linuxWrapperPath?: string;
    linuxDesktopEntryPath?: string;
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
        const macAppDir = joinTargetPath('darwin', homeDir, 'Applications', `${CDP_LAUNCHER_DISPLAY_NAME}.app`);
        let targetAppPath = opts.appPath?.trim() || '/Applications/Antigravity.app';
        if (!opts.appPath && !fs.existsSync(targetAppPath)) {
            const userApp = joinTargetPath('darwin', homeDir, 'Applications', 'Antigravity.app');
            if (fs.existsSync(userApp)) {
                targetAppPath = userApp;
            }
        }
        return {
            platform,
            supported: true,
            homeDir,
            launcherPath: macAppDir,
            targetAppPath,
            auxiliaryPaths: [],
            macAppDir,
        };
    }

    if (platform === 'win32') {
        const localAppData = env.LOCALAPPDATA?.trim()
            ? env.LOCALAPPDATA.trim()
            : joinTargetPath('win32', homeDir, 'AppData', 'Local');
        const appData = env.APPDATA?.trim()
            ? env.APPDATA.trim()
            : joinTargetPath('win32', homeDir, 'AppData', 'Roaming');
        const winCmdPath = joinTargetPath('win32', localAppData, 'AntigravityContextMonitor', 'launch-antigravity-cdp.cmd');
        const winDesktopLnkPath = joinTargetPath('win32', homeDir, 'Desktop', `${CDP_LAUNCHER_DISPLAY_NAME}.lnk`);
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
        return {
            platform,
            supported: true,
            homeDir,
            launcherPath: winDesktopLnkPath,
            targetAppPath,
            auxiliaryPaths: [winStartMenuLnkPath, winCmdPath],
            winCmdPath,
            winDesktopLnkPath,
            winStartMenuLnkPath,
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
        let targetAppPath = opts.appPath?.trim() || '';
        if (!targetAppPath) {
            const candidates = [
                '/usr/bin/antigravity',
                '/usr/local/bin/antigravity',
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
            auxiliaryPaths: [linuxWrapperPath],
            linuxWrapperPath,
            linuxDesktopEntryPath,
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

// ─── Launcher File Builders ──────────────────────────────────────────────────

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
        '  osascript -e \'display alert "Antigravity App Not Found" message "Could not locate Antigravity.app. Please install Antigravity App first."\' >/dev/null 2>&1 || true',
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
        '    -e \'set dialogResult to display dialog "Antigravity is currently running without CDP remote debugging. Quit & relaunch with CDP enabled?" with title "Antigravity (CDP)" buttons {"Cancel", "Quit & Relaunch"} default button "Quit & Relaunch" cancel button "Cancel"\' \\',
        '    -e \'return button returned of dialogResult\' 2>/dev/null || true)"',
        '  if [ "$CHOICE" != "Quit & Relaunch" ]; then',
        '    exit 0',
        '  fi',
        '',
        '  osascript -e "tell application id \\"$BUNDLE_ID\\" to quit" >/dev/null 2>&1 || true',
        '  if ! wait_for_exit; then',
        '    osascript -e \'display alert "Antigravity Still Closing" message "Antigravity did not finish exiting within 15 seconds. Wait for its Dock indicator dot to disappear, then open Antigravity (CDP) again."\' >/dev/null 2>&1 || true',
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
    const cleanTarget = targetAppPath && targetAppPath.trim() && targetAppPath.trim() !== 'antigravity'
        ? targetAppPath.trim()
        : 'antigravity';

    return [
        '#!/usr/bin/env sh',
        'set -eu',
        '',
        '# Zero-patch persistent CDP launcher generated by Antigravity Context Monitor.',
        `APP_BIN="\${ANTIGRAVITY_BIN:-${cleanTarget.replace(/["$`\\]/g, '\\$&')}}"`,
        '',
        '# Wait cleanly up to 5s if an exiting Antigravity process is still tearing down.',
        'tick=0',
        'while [ "$tick" -lt 20 ]; do',
        '  if ! pgrep -x antigravity >/dev/null 2>&1; then',
        '    break',
        '  fi',
        '  if pgrep -af \'antigravity.*--remote-debugging-port\' >/dev/null 2>&1; then',
        '    break',
        '  fi',
        '  sleep 0.25',
        '  tick=$((tick + 1))',
        'done',
        '',
        'exec "$APP_BIN" --remote-debugging-port=0 "$@"',
        '',
    ].join('\n');
}

export function buildLinuxDesktopEntry(wrapperPath: string): string {
    const escapedExec = wrapperPath.includes(' ')
        ? `"${wrapperPath.replace(/"/g, '\\"')}"`
        : wrapperPath;
    return [
        '[Desktop Entry]',
        'Type=Application',
        'Version=1.0',
        `Name=${CDP_LAUNCHER_DISPLAY_NAME}`,
        'Comment=Launch Antigravity with local CDP remote debugging enabled for Antigravity Context Monitor',
        `Exec=${escapedExec} %U`,
        'Icon=antigravity',
        'Terminal=false',
        'Categories=Development;IDE;',
        'StartupWMClass=Antigravity',
        '',
    ].join('\n');
}

const WINDOWS_SHORTCUT_PS_SCRIPT = [
    '$ErrorActionPreference = "Stop"',
    '$ws = New-Object -ComObject WScript.Shell',
    '$targets = @($env:ACM_LNK_DESKTOP, $env:ACM_LNK_STARTMENU) | Where-Object { $_ -and $_.Trim().Length -gt 0 }',
    'foreach ($lnkPath in $targets) {',
    '  $dir = Split-Path -Parent $lnkPath',
    '  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
    '  $sc = $ws.CreateShortcut($lnkPath)',
    '  $sc.TargetPath = $env:ACM_CMD_PATH',
    '  $sc.WorkingDirectory = $env:ACM_WORKDIR',
    '  $sc.WindowStyle = 7',
    '  $sc.Description = "Launch Antigravity with CDP remote debugging enabled (zero-patch)"',
    '  if ($env:ACM_ICON_PATH -and (Test-Path -LiteralPath $env:ACM_ICON_PATH)) { $sc.IconLocation = "$env:ACM_ICON_PATH,0" }',
    '  $sc.Save()',
    '}',
].join('; ');

function copyMacOsIconIfPresent(targetAppPath: string, resourcesDir: string): boolean {
    const srcResources = path.join(targetAppPath, 'Contents', 'Resources');
    const preferred = [
        path.join(srcResources, 'icon.icns'),
        path.join(srcResources, 'Antigravity.icns'),
        path.join(srcResources, 'electron.icns'),
    ];
    for (const candidate of preferred) {
        if (fs.existsSync(candidate)) {
            try {
                fs.copyFileSync(candidate, path.join(resourcesDir, 'icon.icns'));
                return true;
            } catch {
                // Best-effort icon copy
            }
        }
    }
    return false;
}

function getPlatformNotes(platform: NodeJS.Platform, launcherPath: string): { noteEn: string; noteZh: string } {
    if (platform === 'darwin') {
        return {
            noteEn: `Creates a zero-patch launcher bundle at "${launcherPath}" (never modifies /Applications/Antigravity.app). Pin it to your Dock or open it via Spotlight — it waits cleanly for Antigravity's 5-second background shutdown after Cmd+Q, prompts before relaunching if already open without CDP, and survives every auto-update.`,
            noteZh: `在 "${launcherPath}" 创建零侵入持久化启动器（绝不修改 /Applications/Antigravity.app）。固定到程序坞或通过 Spotlight 打开即可：它会自动等待 Cmd+Q 后的 5 秒后台退出清理，若检测到未带 CDP 运行会先弹窗确认，且在应用自动更新后依然有效。`,
        };
    }
    if (platform === 'win32') {
        return {
            noteEn: `Creates zero-patch Desktop & Start Menu "${CDP_LAUNCHER_DISPLAY_NAME}" shortcuts backed by a local .cmd launcher wrapper (never modifies Antigravity.exe). Survives Antigravity auto-updates.`,
            noteZh: `在桌面与开始菜单创建零侵入「${CDP_LAUNCHER_DISPLAY_NAME}」快捷方式（由本地 .cmd 脚本驱动，绝不修改 Antigravity.exe），应用自动更新后依然可用。`,
        };
    }
    if (platform === 'linux') {
        return {
            noteEn: `Creates a zero-patch desktop entry at "${launcherPath}" and wrapper in ~/.local/bin/antigravity-cdp so "${CDP_LAUNCHER_DISPLAY_NAME}" stays available in your application menu/dock across updates.`,
            noteZh: `在 "${launcherPath}" 创建零侵入桌面入口并在 ~/.local/bin/antigravity-cdp 生成启动脚本，应用更新后依然可从应用菜单或停靠栏一键以 CDP 启动。`,
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

    if (resolved.platform === 'darwin' && resolved.macAppDir) {
        installed = fs.existsSync(path.join(resolved.macAppDir, 'Contents', 'Info.plist'))
            && fs.existsSync(path.join(resolved.macAppDir, 'Contents', 'MacOS', 'launch'));
        targetAppFound = Boolean(resolved.targetAppPath && fs.existsSync(resolved.targetAppPath));
    } else if (resolved.platform === 'win32' && resolved.winCmdPath && resolved.winDesktopLnkPath && resolved.winStartMenuLnkPath) {
        installed = fs.existsSync(resolved.winCmdPath)
            && (fs.existsSync(resolved.winDesktopLnkPath) || fs.existsSync(resolved.winStartMenuLnkPath));
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
        if (resolved.platform === 'darwin' && resolved.macAppDir) {
            const contentsDir = path.join(resolved.macAppDir, 'Contents');
            const macOsDir = path.join(contentsDir, 'MacOS');
            const resourcesDir = path.join(contentsDir, 'Resources');

            fs.mkdirSync(macOsDir, { recursive: true });
            fs.mkdirSync(resourcesDir, { recursive: true });

            fs.writeFileSync(path.join(contentsDir, 'Info.plist'), buildMacOsInfoPlist(), 'utf8');
            const launchScriptPath = path.join(macOsDir, 'launch');
            fs.writeFileSync(launchScriptPath, buildMacOsLauncherScript(resolved.targetAppPath), 'utf8');
            fs.chmodSync(launchScriptPath, 0o755);

            if (resolved.targetAppPath) {
                copyMacOsIconIfPresent(resolved.targetAppPath, resourcesDir);
            }

            const status = inspectCdpLauncher(opts);
            return {
                ok: true,
                status,
                messageEn: `Created persistent macOS launcher at "${status.launcherPath}". Drag it to your Dock or launch it via Spotlight whenever you want CDP enabled.`,
                messageZh: `已创建 macOS 持久化启动器："${status.launcherPath}"。可将其拖入程序坞或通过 Spotlight 打开以带 CDP 启动 Antigravity。`,
            };
        }

        if (resolved.platform === 'win32' && resolved.winCmdPath && resolved.winDesktopLnkPath && resolved.winStartMenuLnkPath) {
            fs.mkdirSync(path.dirname(resolved.winCmdPath), { recursive: true });
            fs.writeFileSync(resolved.winCmdPath, buildWindowsLauncherCmd(resolved.targetAppPath), 'utf8');

            const runner = opts.execFileSyncFn
                ?? ((file: string, args: readonly string[], options?: { env?: NodeJS.ProcessEnv; windowsHide?: boolean; stdio?: 'pipe' | 'ignore' }) =>
                    execFileSync(file, [...args], {
                        env: options?.env,
                        windowsHide: options?.windowsHide ?? true,
                        stdio: options?.stdio ?? 'pipe',
                    }));

            const psEnv: NodeJS.ProcessEnv = {
                ...(opts.env ?? process.env),
                ACM_LNK_DESKTOP: resolved.winDesktopLnkPath,
                ACM_LNK_STARTMENU: resolved.winStartMenuLnkPath,
                ACM_CMD_PATH: resolved.winCmdPath,
                ACM_WORKDIR: path.dirname(resolved.winCmdPath),
                ACM_ICON_PATH: resolved.targetAppPath || '',
            };

            runner(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_SHORTCUT_PS_SCRIPT],
                { env: psEnv, windowsHide: true, stdio: 'pipe' },
            );

            const status = inspectCdpLauncher(opts);
            return {
                ok: true,
                status,
                messageEn: `Created persistent Windows CDP shortcuts (Desktop & Start Menu) using "${resolved.winCmdPath}".`,
                messageZh: `已创建 Windows 持久化 CDP 快捷方式（桌面与开始菜单），底层脚本位于 "${resolved.winCmdPath}"。`,
            };
        }

        if (resolved.platform === 'linux' && resolved.linuxWrapperPath && resolved.linuxDesktopEntryPath) {
            fs.mkdirSync(path.dirname(resolved.linuxWrapperPath), { recursive: true });
            fs.mkdirSync(path.dirname(resolved.linuxDesktopEntryPath), { recursive: true });

            fs.writeFileSync(resolved.linuxWrapperPath, buildLinuxLauncherScript(resolved.targetAppPath), 'utf8');
            if (process.platform !== 'win32') {
                fs.chmodSync(resolved.linuxWrapperPath, 0o755);
            }
            fs.writeFileSync(resolved.linuxDesktopEntryPath, buildLinuxDesktopEntry(resolved.linuxWrapperPath), 'utf8');

            const status = inspectCdpLauncher(opts);
            return {
                ok: true,
                status,
                messageEn: `Created persistent Linux CDP launcher at "${resolved.linuxDesktopEntryPath}" (wrapper: "${resolved.linuxWrapperPath}").`,
                messageZh: `已创建 Linux 持久化 CDP 启动入口："${resolved.linuxDesktopEntryPath}"（脚本："${resolved.linuxWrapperPath}"）。`,
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
        const status = inspectCdpLauncher(opts);
        return {
            ok: false,
            status,
            messageEn: `Failed to create persistent CDP launcher: ${errorMsg}`,
            messageZh: `创建持久化 CDP 启动器失败：${errorMsg}`,
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

        if (resolved.platform === 'darwin' && resolved.macAppDir) {
            // Safety invariant: ONLY remove our own `Antigravity (CDP).app`, NEVER `/Applications/Antigravity.app`
            if (path.basename(resolved.macAppDir) === `${CDP_LAUNCHER_DISPLAY_NAME}.app`) {
                removeIfPresent(resolved.macAppDir, true);
            }
        } else if (resolved.platform === 'win32') {
            removeIfPresent(resolved.winDesktopLnkPath, false);
            removeIfPresent(resolved.winStartMenuLnkPath, false);
            removeIfPresent(resolved.winCmdPath, false);
            if (resolved.winCmdPath) {
                const wrapperDir = path.dirname(resolved.winCmdPath);
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
        }

        const status = inspectCdpLauncher(opts);
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
        const status = inspectCdpLauncher(opts);
        return {
            ok: false,
            status,
            messageEn: `Failed to remove persistent CDP launcher: ${errorMsg}`,
            messageZh: `移除持久化 CDP 启动器失败：${errorMsg}`,
            error: errorMsg,
        };
    }
}

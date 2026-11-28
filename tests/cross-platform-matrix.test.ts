// Consolidated Gate Suite #8: Cross-Platform Matrix (Windows, macOS, Linux, WSL & Remote-SSH)
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    formatNumber,
    getLanguage,
    setLanguageToState,
    t,
    tBi,
    tBiHtml,
} from '../src/i18n';
import { fetchFullUserStatus, normalizeUri, parseStrictResetTimestamp, parseUserQuotaSummary } from '../src/tracker';
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    buildLinuxBadgedSvg,
    buildLinuxDesktopEntry,
    buildLinuxLauncherScript,
    buildMacOsInfoPlist,
    buildMacOsLauncherScript,
    buildWindowsExplorerRevealCommand,
    buildWindowsLauncherCmd,
    CDP_LAUNCHER_DISPLAY_NAME,
    clearWindowsLauncherCaches,
    createCdpLauncher,
    escapeFreedesktopExecArg,
    extractAntigravityExeFromLnkFile,
    getCachedWindowsDesktopDir,
    getSafeCdpLaunchCommand,
    inspectCdpLauncher,
    isOwnedMacCdpBundle,
    LINUX_APPIMAGE_PROCESS_RE,
    LINUX_CDP_ICON_FILENAME,
    LINUX_FLATPAK_APP_ID,
    LINUX_FLATPAK_BOUNDARY_NOTE_EN,
    LINUX_FLATPAK_BOUNDARY_NOTE_ZH,
    MACOS_CDP_LAUNCHER_BUNDLE_ID,
    MACOS_ICON_BADGE_JXA,
    readMacBundleIdentifier,
    refreshWindowsDesktopDirCache,
    removeCdpLauncher,
    resolveCdpLauncherPaths,
    resolveLinuxXdgDataHome,
    resolveWindowsAntigravityExeAsync,
    resolveWindowsDesktopDirAsync,
    revealCdpLauncher,
    revealCdpLauncherAsync,
    sanitizeLinuxXdgDir,
    type SpawnedLauncherProcessLike,
    WINDOWS_DESKTOP_CACHE_TTL_MS,
    WINDOWS_DESKTOP_PS_SCRIPT,
    WINDOWS_SHORTCUT_PS_SCRIPT,
} from '../src/app/cdp-launcher';
import { EventEmitter } from 'events';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import {
    detectPathCaseSensitivity,
    normalizeWorkspaceUri,
    resetPathCaseSensitivityCache,
} from '../src/conversation-selector';
import {
    resolveScopedBrainRoot,
    safeReadManifestFile,
} from '../src/core/swarm-registry';
import * as zlib from 'zlib';
import {
    acquirePluginUpdateLock,
    ALLOWED_RELEASE_HOSTS,
    APPROVED_GITHUB_REPO_SLUG,
    assertReleaseVersionMatches,
    assertSafeArchiveEntryPath,
    compareSemver,
    computeSha256Hex,
    crc32,
    EXPECTED_PLUGIN_NAME,
    extractZipSafe,
    getPluginUpdateLockPath,
    isNewerVersion,
    lookupSha256Sum,
    parseSemver,
    parseSha256Sums,
    validateApprovedReleaseAssetUrl,
    validateExtractedPluginBundle,
    validateReleaseIdentity,
    validateReleaseUrl,
    verifyBufferSha256,
} from '../src/core/release-security';
import {
    applyAppPluginUpdate,
    checkForUpdates,
    defaultHttpsTransport,
    establishHttpConnectTunnel,
    fetchAllowedHttps,
    GITHUB_RELEASES_ATOM_URL,
    type HttpsRequestTransport,
    isGitHubRateLimitResponse,
    isHostBypassedByNoProxy,
    parseReleasesAtomLatest,
    resolveApprovedRelease,
    resolveHttpsProxyUrl,
} from '../src/app/plugin-updater';
import type { PluginReleaseInfo } from '../src/app/sidecar-types';
import { ALLOWED_EXTERNAL_URL_HOSTS, validateExternalUrl } from '../src/core/external-url';
import { buildPricingTabContent } from '../src/pricing-panel';
import { PricingStore } from '../src/pricing-store';
import { buildAboutTabContent } from '../src/webview-about-tab';
import { buildProfileContent } from '../src/webview-profile-tab';
import type { UserStatusInfo } from '../src/models';

describe('[cross-platform-uri-normalization]', () => {
    const initialLanguage = getLanguage();

    const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };


    beforeEach(async () => {
        vi.clearAllMocks();
        await setLanguageToState('both', state);
    });


    afterEach(async () => {
        await setLanguageToState(initialLanguage, state);
    });


    describe('cross-platform URI normalization', () => {
        it('normalizes Windows file URIs and backslash paths identically on win32', () => {
            expect(normalizeUri('file:///c%3A/Users/Alice/My%20Repo/', 'win32')).toBe('c:/users/alice/my repo');
            expect(normalizeUri('C:\\Users\\Alice\\My Repo\\', 'win32')).toBe('c:/users/alice/my repo');
            expect(normalizeUri('  C:\\Users\\Alice\\My Repo\r\n', 'win32')).toBe('c:/users/alice/my repo');
        });

        it('preserves case on linux, folds confirmed case-insensitive darwin, and preserves WSL distro authority', () => {
            expect(normalizeUri('file:///Users/Alice/Repo///', { platform: 'darwin', caseSensitive: false })).toBe('/users/alice/repo');
            expect(normalizeUri('file:///Users/Alice/Repo///', { platform: 'darwin', isCaseSensitivePath: () => null })).toBe('/Users/Alice/Repo');
            expect(normalizeUri('file:///home/Alice/Repo/', 'linux')).toBe('/home/Alice/Repo');
            expect(normalizeUri('file:///home/alice/repo/', 'linux')).toBe('/home/alice/repo');
            expect(normalizeUri('vscode-remote://wsl+Ubuntu/home/Dev/App///', 'linux')).toBe('vscode-remote://wsl+ubuntu/home/Dev/App');
            expect(normalizeUri('vscode-remote://wsl+Debian/home/Dev/App///', 'linux')).toBe('vscode-remote://wsl+debian/home/Dev/App');
        });
    });
});

describe('[app-cdp-launcher]', () => {
    describe('Zero-Patch Persistent CDP Launcher (macOS, Windows, Linux)', () => {
        let tempRoot: string;

        beforeEach(() => {
            clearWindowsLauncherCaches();
            tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-cdp-launcher-test-'));
        });

        afterEach(() => {
            clearWindowsLauncherCaches();
            vi.restoreAllMocks();
            fs.rmSync(tempRoot, { recursive: true, force: true });
        });

        it('returns race-free zero-patch terminal commands for macOS, Windows, and Linux', () => {
            expect(getSafeCdpLaunchCommand('darwin')).toBe(
                'while pgrep -f \'^/Applications/Antigravity\\.app/Contents/MacOS/Antigravity($| )\' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0',
            );
            expect(getSafeCdpLaunchCommand('win32')).toBe(
                '& "$env:LOCALAPPDATA\\Programs\\Antigravity\\Antigravity.exe" --remote-debugging-port=0',
            );
            expect(getSafeCdpLaunchCommand('linux')).toBe(
                'antigravity --remote-debugging-port=0',
            );
        });

        it('creates, inspects, validates syntax, and removes the macOS .app bundle inside temp HOME without touching target app', () => {
            const fakeHome = path.join(tempRoot, 'mac-home');
            const fakeApp = path.join(tempRoot, 'MockApps', 'Antigravity.app');
            const fakeIconDir = path.join(fakeApp, 'Contents', 'Resources');
            fs.mkdirSync(fakeIconDir, { recursive: true });
            fs.writeFileSync(path.join(fakeIconDir, 'icon.icns'), Buffer.from('icns-mock-bytes'));

            // Before creation
            const before = inspectCdpLauncher({ platform: 'darwin', homeDir: fakeHome, appPath: fakeApp });
            expect(before).toMatchObject({
                supported: true,
                platform: 'darwin',
                installed: false,
                displayName: CDP_LAUNCHER_DISPLAY_NAME,
                targetAppFound: true,
                targetAppPath: fakeApp,
            });
            expect(before.launcherPath).toBe(path.join(fakeHome, 'Applications', 'Antigravity (CDP).app'));
            expect(before.safeTerminalCommand).toContain('while pgrep -f');

            // Create bundle
            const created = createCdpLauncher({ platform: 'darwin', homeDir: fakeHome, appPath: fakeApp });
            expect(created.ok).toBe(true);
            expect(created.status.installed).toBe(true);
            expect(created.messageEn).toContain('Antigravity (CDP).app');
            expect(created.messageZh).toContain('Antigravity (CDP).app');

            const plistPath = path.join(created.status.launcherPath, 'Contents', 'Info.plist');
            const launchPath = path.join(created.status.launcherPath, 'Contents', 'MacOS', 'launch');
            const copiedIconPath = path.join(created.status.launcherPath, 'Contents', 'Resources', 'icon.icns');

            expect(fs.existsSync(plistPath)).toBe(true);
            expect(fs.existsSync(launchPath)).toBe(true);
            expect(fs.existsSync(copiedIconPath)).toBe(true);
            expect(fs.readFileSync(copiedIconPath).toString('utf8')).toBe('icns-mock-bytes');

            // Verify Info.plist metadata
            expect(MACOS_ICON_BADGE_JXA).toContain('const textX = badgeX + (badgeW - textSize.width) / 2;');
            expect(MACOS_ICON_BADGE_JXA).toContain('text.drawAtPointWithAttributes($.NSMakePoint(textX, textY), attrs);');
            expect(MACOS_ICON_BADGE_JXA).not.toContain('NSTextAlignmentCenter');
            const plist = fs.readFileSync(plistPath, 'utf8');
            expect(plist).toContain(`<string>${MACOS_CDP_LAUNCHER_BUNDLE_ID}</string>`);
            expect(plist).toContain('<key>CFBundleName</key>');
            expect(plist).toContain(`<string>${CDP_LAUNCHER_DISPLAY_NAME}</string>`);
            expect(plist).toContain('<key>CFBundleExecutable</key>');
            expect(plist).toContain('<string>launch</string>');
            expect(plist).toContain('<key>CFBundleIconFile</key>');
            expect(plist).toContain('<string>icon.icns</string>');
            expect(plist).toContain('<key>LSUIElement</key>');
            expect(plist).toContain('<true/>');

            // Verify executable bit and bash syntax
            const launchScript = fs.readFileSync(launchPath, 'utf8');
            if (process.platform !== 'win32') {
                const mode = fs.statSync(launchPath).mode & 0o777;
                expect(mode).toBe(0o755);
                execFileSync('bash', ['-n', launchPath], { stdio: 'pipe' });
            }

            // Verify race-free logic, exact Antigravity.app regex, frontmost user dialog, graceful AppleScript quit + TCC fallback alert, 15s poll, and zero force-kill
            expect(launchScript).toContain('Contents/MacOS/Antigravity($| )');
            expect(launchScript).toContain('--remote-debugging-port');
            expect(launchScript).toContain("-e 'activate'");
            expect(launchScript.indexOf("-e 'activate'")).toBeLessThan(launchScript.indexOf('display dialog'));
            expect(launchScript).toContain('display dialog "Antigravity is currently running without CDP remote debugging. Quit & relaunch with CDP enabled?"');
            expect(launchScript).toContain('buttons {"Cancel", "Quit & Relaunch"}');
            expect(launchScript).toContain('tell application id \\"$BUNDLE_ID\\" to quit');
            expect(launchScript).toContain('QUIT_RC=0');
            expect(launchScript).toContain('Allow Automation permission for Antigravity (CDP)');
            expect(launchScript).toContain('Cmd+Q');
            expect(launchScript).toContain('max_ticks=60');
            expect(launchScript).toContain('sleep 0.25');
            expect(launchScript).toContain('open -a "$APP_PATH" --args --remote-debugging-port=0');
            expect(launchScript).not.toMatch(/\b(kill|pkill|killall)\b/);

            // Inspect after creation
            const afterCreate = inspectCdpLauncher({ platform: 'darwin', homeDir: fakeHome, appPath: fakeApp });
            expect(afterCreate.installed).toBe(true);

            // Remove launcher — mock target Antigravity.app must remain completely untouched
            const removed = removeCdpLauncher({ platform: 'darwin', homeDir: fakeHome, appPath: fakeApp });
            expect(removed.ok).toBe(true);
            expect(removed.status.installed).toBe(false);
            expect(fs.existsSync(created.status.launcherPath)).toBe(false);
            expect(fs.existsSync(path.join(fakeIconDir, 'icon.icns'))).toBe(true);
        });

        it('creates direct Windows Desktop & Start Menu .lnk shortcuts targeting Antigravity.exe, supports OneDrive Desktop, cleans legacy .cmd, and generates CDP-badged .ico with fallback', () => {
            const fakeHome = path.join(tempRoot, 'win-home');
            const fakeOneDriveDesktop = path.join(fakeHome, 'OneDrive', 'Desktop');
            const fakeLocalAppData = path.join(fakeHome, 'AppData', 'Local');
            const fakeAppData = path.join(fakeHome, 'AppData', 'Roaming');
            const fakeExe = path.join(fakeLocalAppData, 'Programs', 'Antigravity', 'Antigravity.exe');
            fs.mkdirSync(path.dirname(fakeExe), { recursive: true });
            fs.writeFileSync(fakeExe, 'mock-exe');

            // Seed a legacy launch-antigravity-cdp.cmd AND a stale %USERPROFILE%\Desktop shortcut to verify automatic cleanup
            const legacyCmdPath = path.join(fakeLocalAppData, 'AntigravityContextMonitor', 'launch-antigravity-cdp.cmd');
            fs.mkdirSync(path.dirname(legacyCmdPath), { recursive: true });
            fs.writeFileSync(legacyCmdPath, buildWindowsLauncherCmd(fakeExe), 'utf8');
            const staleFallbackDesktopLnk = path.join(fakeHome, 'Desktop', 'Antigravity (CDP).lnk');
            fs.mkdirSync(path.dirname(staleFallbackDesktopLnk), { recursive: true });
            fs.writeFileSync(staleFallbackDesktopLnk, 'stale-lnk', 'utf8');

            const winEnv = {
                USERPROFILE: fakeHome,
                LOCALAPPDATA: fakeLocalAppData,
                APPDATA: fakeAppData,
            };

            const mockWinRunner = (
                file: string,
                args: readonly string[],
                options?: { env?: NodeJS.ProcessEnv },
            ) => {
                const cmd = String(args[args.length - 1] ?? '');
                if (cmd.includes("GetFolderPath('Desktop')")) {
                    return `${fakeOneDriveDesktop}\r\n`;
                }
                // Simulate PowerShell creating badged .ico + direct .lnk files
                if (options?.env?.ACM_BADGE_ICON_PATH) {
                    fs.mkdirSync(path.dirname(options.env.ACM_BADGE_ICON_PATH), { recursive: true });
                    fs.writeFileSync(options.env.ACM_BADGE_ICON_PATH, Buffer.from([0, 0, 1, 0, 1, 0]));
                }
                for (const p of [options?.env?.ACM_LNK_DESKTOP, options?.env?.ACM_LNK_STARTMENU]) {
                    if (p) {
                        fs.mkdirSync(path.dirname(p), { recursive: true });
                        fs.writeFileSync(p, 'mock-direct-lnk', 'utf8');
                    }
                }
                return '';
            };

            // Before setup: inspectCdpLauncher is strictly non-blocking (never spawns sync powershell.exe during polling)
            fs.rmSync(staleFallbackDesktopLnk, { force: true });
            const before = inspectCdpLauncher({
                platform: 'win32',
                homeDir: fakeHome,
                env: winEnv,
                execFileSyncFn: mockWinRunner,
            });
            expect(before.supported).toBe(true);
            expect(before.installed).toBe(false);
            expect(before.targetAppFound).toBe(true);
            expect(before.launcherPath).toBe(path.join(fakeHome, 'Desktop', 'Antigravity (CDP).lnk'));

            // Re-seed stale fallback desktop .lnk before create
            fs.writeFileSync(staleFallbackDesktopLnk, 'stale-lnk', 'utf8');

            const execCalls: Array<{ file: string; args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
            const created = createCdpLauncher({
                platform: 'win32',
                homeDir: fakeHome,
                env: winEnv,
                execFileSyncFn: (file, args, options) => {
                    execCalls.push({ file, args, env: options?.env });
                    return mockWinRunner(file, args, options);
                },
            });

            expect(created.ok).toBe(true);
            expect(created.status.installed).toBe(true);
            expect(created.status.launcherPath).toBe(path.join(fakeOneDriveDesktop, 'Antigravity (CDP).lnk'));
            expect(execCalls).toHaveLength(2);
            expect(execCalls[0].file).toBe('powershell.exe');
            expect(execCalls[0].args[execCalls[0].args.length - 1]).toBe(WINDOWS_DESKTOP_PS_SCRIPT);
            expect(execCalls[1].file).toBe('powershell.exe');
            expect(execCalls[1].args).toContain('-NoProfile');
            expect(execCalls[1].args).toContain('-NonInteractive');

            // Verify PowerShell shortcut script targets Antigravity.exe directly with --remote-debugging-port=0, System.Drawing PNG-in-ICO + fallback, zero path interpolation
            const psScript = execCalls[1].args[execCalls[1].args.length - 1];
            expect(psScript).toBe(WINDOWS_SHORTCUT_PS_SCRIPT);
            expect(psScript).toContain('WScript.Shell');
            expect(psScript).toContain('$sc.TargetPath = $env:ACM_TARGET_EXE');
            expect(psScript).toContain('$sc.Arguments = "--remote-debugging-port=0"');
            expect(psScript).toContain('$sc.WindowStyle = 1');
            expect(psScript).toContain('System.Drawing');
            expect(psScript).toContain('ExtractAssociatedIcon');
            expect(psScript).toContain('"CDP"');
            expect(psScript).toContain('$iconLoc = "$env:ACM_TARGET_EXE,0"');
            expect(psScript).toContain('$env:ACM_LNK_DESKTOP');
            expect(psScript).toContain('$env:ACM_LNK_STARTMENU');
            expect(psScript).not.toContain(fakeHome);

            // Env vars passed safely to shortcut creation
            expect(execCalls[1].env?.ACM_TARGET_EXE).toBe(fakeExe);
            expect(execCalls[1].env?.ACM_WORKDIR).toBe(path.dirname(fakeExe));
            expect(execCalls[1].env?.ACM_LNK_DESKTOP).toBe(path.join(fakeOneDriveDesktop, 'Antigravity (CDP).lnk'));

            const iconPath = path.join(fakeLocalAppData, 'AntigravityContextMonitor', 'antigravity-cdp.ico');
            const desktopLnk = path.join(fakeOneDriveDesktop, 'Antigravity (CDP).lnk');
            const startMenuLnk = path.join(fakeAppData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Antigravity (CDP).lnk');
            // Legacy .cmd and stale %USERPROFILE%\Desktop shortcut are cleaned up during setup!
            expect(fs.existsSync(legacyCmdPath)).toBe(false);
            expect(fs.existsSync(staleFallbackDesktopLnk)).toBe(false);
            expect(fs.existsSync(iconPath)).toBe(true);
            expect(fs.existsSync(desktopLnk)).toBe(true);
            expect(fs.existsSync(startMenuLnk)).toBe(true);

            // Legacy buildWindowsLauncherCmd export stays backward-compatible
            const legacyCmdContent = buildWindowsLauncherCmd(fakeExe);
            expect(legacyCmdContent).toContain('\r\n');
            expect(legacyCmdContent).toContain('--remote-debugging-port=0');
            expect(legacyCmdContent).not.toMatch(/\btaskkill\b/i);

            // Seed legacy .cmd + stale fallback desktop .lnk again and verify remove cleans EVERYTHING including .ico & empty data dir
            fs.writeFileSync(legacyCmdPath, 'legacy', 'utf8');
            fs.writeFileSync(staleFallbackDesktopLnk, 'stale', 'utf8');
            const removed = removeCdpLauncher({
                platform: 'win32',
                homeDir: fakeHome,
                env: winEnv,
                execFileSyncFn: mockWinRunner,
            });
            expect(removed.ok).toBe(true);
            expect(removed.status.installed).toBe(false);
            expect(fs.existsSync(legacyCmdPath)).toBe(false);
            expect(fs.existsSync(iconPath)).toBe(false);
            expect(fs.existsSync(path.dirname(iconPath))).toBe(false);
            expect(fs.existsSync(desktopLnk)).toBe(false);
            expect(fs.existsSync(staleFallbackDesktopLnk)).toBe(false);
            expect(fs.existsSync(startMenuLnk)).toBe(false);

            // Fallback to %USERPROFILE%\Desktop when cache is cleared and PowerShell is unavailable
            clearWindowsLauncherCaches();
            const fallbackPaths = resolveCdpLauncherPaths({
                platform: 'win32',
                homeDir: fakeHome,
                env: winEnv,
                execFileSyncFn: () => { throw new Error('powershell unavailable'); },
            });
            expect(fallbackPaths.winDesktopLnkPath).toBe(path.join(fakeHome, 'Desktop', 'Antigravity (CDP).lnk'));
        });

        it('creates, inspects, validates syntax, and removes Linux ~/.local/bin/antigravity-cdp + .desktop entry', () => {
            const fakeHome = path.join(tempRoot, 'linux-home');
            const fakeBin = path.join(fakeHome, '.local', 'bin', 'antigravity');
            fs.mkdirSync(path.dirname(fakeBin), { recursive: true });
            fs.writeFileSync(fakeBin, '#!/bin/sh\nexit 0\n', 'utf8');

            const before = inspectCdpLauncher({ platform: 'linux', homeDir: fakeHome });
            expect(before.supported).toBe(true);
            expect(before.installed).toBe(false);
            expect(before.targetAppFound).toBe(true);
            expect(before.launcherPath).toBe(path.join(fakeHome, '.local', 'share', 'applications', 'antigravity-cdp.desktop'));

            const created = createCdpLauncher({ platform: 'linux', homeDir: fakeHome });
            expect(created.ok).toBe(true);
            expect(created.status.installed).toBe(true);

            const wrapperPath = path.join(fakeHome, '.local', 'bin', 'antigravity-cdp');
            const desktopPath = path.join(fakeHome, '.local', 'share', 'applications', 'antigravity-cdp.desktop');
            expect(fs.existsSync(wrapperPath)).toBe(true);
            expect(fs.existsSync(desktopPath)).toBe(true);

            const wrapperContent = fs.readFileSync(wrapperPath, 'utf8');
            expect(wrapperContent).toContain('--remote-debugging-port=0 "$@"');
            if (process.platform !== 'win32') {
                expect(fs.statSync(wrapperPath).mode & 0o777).toBe(0o755);
                execFileSync('sh', ['-n', wrapperPath], { stdio: 'pipe' });
            }

            const desktopContent = fs.readFileSync(desktopPath, 'utf8');
            expect(desktopContent).toContain('[Desktop Entry]');
            expect(desktopContent).toContain(`Name=${CDP_LAUNCHER_DISPLAY_NAME}`);
            expect(desktopContent).toContain(wrapperPath);
            expect(desktopContent).toContain('%U');

            const removed = removeCdpLauncher({ platform: 'linux', homeDir: fakeHome });
            expect(removed.ok).toBe(true);
            expect(removed.status.installed).toBe(false);
            expect(fs.existsSync(wrapperPath)).toBe(false);
            expect(fs.existsSync(desktopPath)).toBe(false);
            // Existing antigravity binary itself must remain untouched
            expect(fs.existsSync(fakeBin)).toBe(true);
        });

        it('reports unsupported platforms gracefully without throwing', () => {
            const plat = 'freebsd' as NodeJS.Platform;
            const st = inspectCdpLauncher({ platform: plat, homeDir: tempRoot });
            expect(st.supported).toBe(false);
            expect(st.installed).toBe(false);

            const createRes = createCdpLauncher({ platform: plat, homeDir: tempRoot });
            expect(createRes.ok).toBe(false);
            expect(createRes.error).toMatch(/Unsupported platform/);

            const removeRes = removeCdpLauncher({ platform: plat, homeDir: tempRoot });
            expect(removeRes.ok).toBe(false);

            const revealRes = revealCdpLauncher({ platform: plat, homeDir: tempRoot });
            expect(revealRes.ok).toBe(false);
            expect(revealRes.error).toMatch(/Unsupported platform/);
        });

        it('reveals installed launchers across darwin, win32, and linux via injected spawnImpl and fails cleanly when not installed', () => {
            // 1. Not installed -> clear error without spawning anything
            const unusedSpawn = vi.fn();
            const macHome = path.join(tempRoot, 'reveal-mac');
            const missingRes = revealCdpLauncher({
                platform: 'darwin',
                homeDir: macHome,
                spawnImpl: unusedSpawn,
            });
            expect(missingRes.ok).toBe(false);
            expect(missingRes.error).toBe('Launcher not created yet');
            expect(unusedSpawn).not.toHaveBeenCalled();

            // 2. macOS -> open -R <launcherPath>
            createCdpLauncher({ platform: 'darwin', homeDir: macHome });
            const macSpawnCalls: Array<{ cmd: string; args: readonly string[]; detached?: boolean }> = [];
            const macUnref = vi.fn();
            const macReveal = revealCdpLauncher({
                platform: 'darwin',
                homeDir: macHome,
                spawnImpl: (cmd, args, options) => {
                    macSpawnCalls.push({ cmd, args, detached: options?.detached });
                    return { unref: macUnref, on: vi.fn() };
                },
            });
            expect(macReveal.ok).toBe(true);
            expect(macReveal.messageEn).toContain('Finder');
            expect(macReveal.messageZh).toContain('访达');
            expect(macSpawnCalls).toEqual([{
                cmd: 'open',
                args: ['-R', path.join(macHome, 'Applications', 'Antigravity (CDP).app')],
                detached: true,
            }]);
            expect(macUnref).toHaveBeenCalledTimes(1);

            // 3. Windows -> explorer.exe /select,<launcherPath> (and parent dir fallback if /select throws)
            const winHome = path.join(tempRoot, 'reveal-win');
            const winEnv = {
                USERPROFILE: winHome,
                LOCALAPPDATA: path.join(winHome, 'AppData', 'Local'),
                APPDATA: path.join(winHome, 'AppData', 'Roaming'),
            };
            createCdpLauncher({
                platform: 'win32',
                homeDir: winHome,
                env: winEnv,
                execFileSyncFn: (_file, _args, options) => {
                    for (const p of [options?.env?.ACM_LNK_DESKTOP, options?.env?.ACM_LNK_STARTMENU]) {
                        if (p) {
                            fs.mkdirSync(path.dirname(p), { recursive: true });
                            fs.writeFileSync(p, 'mock-lnk', 'utf8');
                        }
                    }
                },
            });
            const winDesktopLnk = path.join(winHome, 'Desktop', 'Antigravity (CDP).lnk');
            const winCalls: Array<{ cmd: string; args: readonly string[]; verbatim?: boolean; shell?: boolean }> = [];
            const winReveal = revealCdpLauncher({
                platform: 'win32',
                homeDir: winHome,
                env: winEnv,
                spawnImpl: (cmd, args, options) => {
                    winCalls.push({ cmd, args, verbatim: options?.windowsVerbatimArguments, shell: options?.shell });
                    return { unref: vi.fn(), on: vi.fn() };
                },
            });
            expect(winReveal.ok).toBe(true);
            expect(winReveal.messageEn).toContain('Explorer');
            expect(winReveal.messageZh).toContain('资源管理器');
            expect(winCalls).toEqual([{
                cmd: 'explorer.exe',
                args: ['/select,', `"${winDesktopLnk}"`],
                verbatim: true,
                shell: false,
            }]);

            // Windows fallback to parent directory if /select throws
            const winFallbackCalls: Array<{ cmd: string; args: readonly string[]; verbatim?: boolean }> = [];
            const winFallback = revealCdpLauncher({
                platform: 'win32',
                homeDir: winHome,
                env: winEnv,
                spawnImpl: (cmd, args, options) => {
                    winFallbackCalls.push({ cmd, args, verbatim: options?.windowsVerbatimArguments });
                    if (args[0] === '/select,') {
                        throw new Error('select failed');
                    }
                    return { unref: vi.fn(), on: vi.fn() };
                },
            });
            expect(winFallback.ok).toBe(true);
            expect(winFallbackCalls).toEqual([
                { cmd: 'explorer.exe', args: ['/select,', `"${winDesktopLnk}"`], verbatim: true },
                { cmd: 'explorer.exe', args: [`"${path.dirname(winDesktopLnk)}"`], verbatim: true },
            ]);

            // 4. Linux -> xdg-open <dirname(launcherPath)>
            const linuxHome = path.join(tempRoot, 'reveal-linux');
            createCdpLauncher({ platform: 'linux', homeDir: linuxHome });
            const linuxCalls: Array<{ cmd: string; args: readonly string[] }> = [];
            const linuxReveal = revealCdpLauncher({
                platform: 'linux',
                homeDir: linuxHome,
                spawnImpl: (cmd, args) => {
                    linuxCalls.push({ cmd, args });
                    return { unref: vi.fn(), on: vi.fn() };
                },
            });
            expect(linuxReveal.ok).toBe(true);
            expect(linuxCalls).toEqual([{
                cmd: 'xdg-open',
                args: [path.join(linuxHome, '.local', 'share', 'applications')],
            }]);
        });

        it('escapes Linux custom paths containing apostrophes, braces, and Freedesktop reserved characters cleanly', () => {
            const trickyBin = "/opt/user's {custom}/anti}gravity/$bin \"quoted\"";
            const script = buildLinuxLauncherScript(trickyBin);
            expect(script).toContain('DEFAULT_BIN=');
            expect(script).toContain('APP_BIN="${ANTIGRAVITY_BIN:-$DEFAULT_BIN}"');

            const scriptFile = path.join(tempRoot, 'tricky-linux-wrapper.sh');
            fs.writeFileSync(scriptFile, script, 'utf8');
            if (process.platform !== 'win32') {
                execFileSync('sh', ['-n', scriptFile], { stdio: 'pipe' });
            }

            // Plain path stays unquoted
            const plainEntry = buildLinuxDesktopEntry('/home/alice/.local/bin/antigravity-cdp');
            expect(plainEntry).toContain('Exec=/home/alice/.local/bin/antigravity-cdp %U');

            // Reserved characters (space, apostrophe, quotes, $, `, \, %) are quoted/escaped per Freedesktop Exec spec
            const specialWrapper = `/home/o'malley/my "app" $1 \`x\` 100%\\bin/antigravity-cdp`;
            const specialEntry = buildLinuxDesktopEntry(specialWrapper);
            expect(specialEntry).toContain(
                'Exec="/home/o\'malley/my \\\\"app\\\\" \\\\$1 \\\\`x\\\\` 100%%\\\\\\\\bin/antigravity-cdp" %U',
            );
            expect(specialEntry).toContain('StartupWMClass=Antigravity');
        });

        it('prefers writable macOS systemAppsDir, cleans stale ~/Applications copy, falls back when read-only, isolates HOME overrides, and badges icons with silent fallback', () => {
            const fakeHome = path.join(tempRoot, 'mac-prio-home');
            const fakeSysApps = path.join(tempRoot, 'FakeApplications');
            const fakeApp = path.join(fakeSysApps, 'Antigravity.app');
            fs.mkdirSync(path.join(fakeApp, 'Contents', 'Resources'), { recursive: true });
            fs.writeFileSync(path.join(fakeApp, 'Contents', 'Resources', 'icon.icns'), Buffer.from('mock-orig-icns'));

            // 1. Seed a stale ~/Applications/Antigravity (CDP).app first -> inspect finds it across both dirs!
            const userBundle = path.join(fakeHome, 'Applications', 'Antigravity (CDP).app');
            fs.mkdirSync(path.join(userBundle, 'Contents', 'MacOS'), { recursive: true });
            fs.writeFileSync(path.join(userBundle, 'Contents', 'Info.plist'), buildMacOsInfoPlist(), 'utf8');
            fs.writeFileSync(path.join(userBundle, 'Contents', 'MacOS', 'launch'), buildMacOsLauncherScript(fakeApp), 'utf8');

            const detectedOld = inspectCdpLauncher({
                platform: 'darwin',
                homeDir: fakeHome,
                systemAppsDir: fakeSysApps,
                appPath: fakeApp,
            });
            expect(detectedOld.installed).toBe(true);
            expect(detectedOld.launcherPath).toBe(userBundle);

            // 2. Create with writable systemAppsDir -> writes to FakeApplications, removes stale ~/Applications copy, NEVER touches Antigravity.app!
            const badgeCalls: string[] = [];
            const createdSys = createCdpLauncher({
                platform: 'darwin',
                homeDir: fakeHome,
                systemAppsDir: fakeSysApps,
                appPath: fakeApp,
                execFileSyncFn: (file, args) => {
                    badgeCalls.push(file);
                    if (file === 'iconutil') {
                        const outIdx = args.indexOf('-o');
                        if (outIdx >= 0 && args[outIdx + 1]) {
                            fs.writeFileSync(args[outIdx + 1], Buffer.from('icns-badged-bytes'));
                        }
                    }
                },
            });
            const sysBundle = path.join(fakeSysApps, 'Antigravity (CDP).app');
            expect(createdSys.ok).toBe(true);
            expect(createdSys.status.installed).toBe(true);
            expect(createdSys.status.launcherPath).toBe(sysBundle);
            expect(fs.existsSync(sysBundle)).toBe(true);
            expect(fs.existsSync(userBundle)).toBe(false);
            expect(fs.existsSync(fakeApp)).toBe(true);
            expect(badgeCalls).toContain('sips');
            expect(badgeCalls).toContain('osascript');
            expect(badgeCalls).toContain('iconutil');
            expect(fs.readFileSync(path.join(sysBundle, 'Contents', 'Resources', 'icon.icns'), 'utf8')).toBe('icns-badged-bytes');
            // Anti-pitfall Dock warning is present in EN & ZH
            expect(createdSys.messageEn).toContain('Keep in Dock');
            expect(createdSys.messageZh).toContain('在程序坞中保留');
            expect(createdSys.status.noteEn).toContain('Keep in Dock');
            expect(createdSys.status.noteZh).toContain('在程序坞中保留');

            // 3. ACM_MACOS_APPLICATIONS_DIR env var also selects systemAppsDir
            const envDetected = inspectCdpLauncher({
                platform: 'darwin',
                env: { HOME: fakeHome, ACM_MACOS_APPLICATIONS_DIR: fakeSysApps },
                appPath: fakeApp,
            });
            expect(envDetected.installed).toBe(true);
            expect(envDetected.launcherPath).toBe(sysBundle);

            // 4. Test isolation: overriding HOME or homeDir WITHOUT systemAppsDir/ACM_MACOS_APPLICATIONS_DIR NEVER inspects real /Applications
            const isolatedResolved = resolveCdpLauncherPaths({
                platform: 'darwin',
                env: { HOME: path.join(tempRoot, 'isolated-home') },
            });
            expect(isolatedResolved.macSystemAppsDir).toBeUndefined();
            expect(isolatedResolved.launcherPath).toBe(path.join(tempRoot, 'isolated-home', 'Applications', 'Antigravity (CDP).app'));

            // 5. Remove covers BOTH systemAppsDir AND ~/Applications (without touching Antigravity.app!)
            fs.mkdirSync(path.join(userBundle, 'Contents', 'MacOS'), { recursive: true });
            fs.writeFileSync(path.join(userBundle, 'Contents', 'Info.plist'), buildMacOsInfoPlist(), 'utf8');
            fs.writeFileSync(path.join(userBundle, 'Contents', 'MacOS', 'launch'), buildMacOsLauncherScript(fakeApp), 'utf8');
            const removedBoth = removeCdpLauncher({
                platform: 'darwin',
                homeDir: fakeHome,
                systemAppsDir: fakeSysApps,
                appPath: fakeApp,
            });
            expect(removedBoth.ok).toBe(true);
            expect(removedBoth.status.installed).toBe(false);
            expect(fs.existsSync(sysBundle)).toBe(false);
            expect(fs.existsSync(userBundle)).toBe(false);
            expect(fs.existsSync(fakeApp)).toBe(true);

            // 6. Read-only systemAppsDir -> automatically falls back to ~/Applications and falls back to copying raw icon when badging fails
            const roSysApps = path.join(tempRoot, 'ReadOnlyApplications');
            fs.mkdirSync(roSysApps, { recursive: true });
            if (process.platform !== 'win32') {
                fs.chmodSync(roSysApps, 0o555);
            }
            try {
                const fallbackCreated = createCdpLauncher({
                    platform: 'darwin',
                    homeDir: fakeHome,
                    systemAppsDir: process.platform === 'win32' ? path.join(tempRoot, 'nonexistent-sys-apps') : roSysApps,
                    appPath: fakeApp,
                    execFileSyncFn: () => { throw new Error('sips failed'); },
                });
                expect(fallbackCreated.ok).toBe(true);
                expect(fallbackCreated.status.launcherPath).toBe(userBundle);
                expect(fs.readFileSync(path.join(userBundle, 'Contents', 'Resources', 'icon.icns'), 'utf8')).toBe('mock-orig-icns');
            } finally {
                if (process.platform !== 'win32') {
                    fs.chmodSync(roSysApps, 0o755);
                }
            }
        });

        it('detects Linux standard/Snap/AppImage processes (excluding antigravity-cdp), shows non-killing dialog fallback (zenity -> kdialog -> notify-send -> stderr), creates/removes SVG badge, and runs update-desktop-database', () => {
            const fakeHome = path.join(tempRoot, 'linux-adv-home');
            const fakeBinDir = path.join(fakeHome, 'opt-antigravity');
            const fakeBin = path.join(fakeBinDir, 'antigravity');
            fs.mkdirSync(fakeBinDir, { recursive: true });
            fs.writeFileSync(fakeBin, '#!/bin/sh\necho "LAUNCHED:$*"\n', 'utf8');
            if (process.platform !== 'win32') {
                fs.chmodSync(fakeBin, 0o755);
            }
            // Provide an original PNG icon next to binary so SVG embeds it
            fs.writeFileSync(path.join(fakeBinDir, 'antigravity.png'), Buffer.from('fake-png-data'));

            const dbCalls: Array<{ file: string; args: readonly string[] }> = [];
            const created = createCdpLauncher({
                platform: 'linux',
                homeDir: fakeHome,
                appPath: fakeBin,
                execFileSyncFn: (file, args) => {
                    dbCalls.push({ file, args });
                },
            });
            expect(created.ok).toBe(true);
            expect(created.status.installed).toBe(true);
            expect(created.status.noteEn).toContain('StartupWMClass=Antigravity');
            expect(created.status.noteEn).toContain('Pin to Dash');
            expect(created.status.noteZh).toContain('固定到停靠栏');

            const svgPath = path.join(fakeHome, '.local', 'share', 'icons', 'hicolor', 'scalable', 'apps', LINUX_CDP_ICON_FILENAME);
            const desktopPath = path.join(fakeHome, '.local', 'share', 'applications', 'antigravity-cdp.desktop');
            const wrapperPath = path.join(fakeHome, '.local', 'bin', 'antigravity-cdp');
            expect(fs.existsSync(svgPath)).toBe(true);
            const svgContent = fs.readFileSync(svgPath, 'utf8');
            expect(svgContent).toContain('<svg');
            expect(svgContent).toContain('>CDP</text>');
            expect(svgContent).toContain('data:image/png;base64,');

            // Standalone SVG badge also renders cleanly when no original icon is available
            const standaloneSvg = buildLinuxBadgedSvg();
            expect(standaloneSvg).toContain('<svg');
            expect(standaloneSvg).toContain('>CDP</text>');

            const desktopContent = fs.readFileSync(desktopPath, 'utf8');
            expect(desktopContent).toContain(`Icon=${svgPath}`);
            expect(desktopContent).toContain('StartupWMClass=Antigravity');
            expect(dbCalls).toEqual([{
                file: 'update-desktop-database',
                args: [path.dirname(desktopPath)],
            }]);

            // Wrapper script must never kill Antigravity and includes zenity -> kdialog -> notify-send -> stderr fallback
            const wrapperText = fs.readFileSync(wrapperPath, 'utf8');
            expect(wrapperText).not.toMatch(/\b(kill|pkill|killall)\b/);
            expect(wrapperText).toContain('zenity');
            expect(wrapperText).toContain('kdialog');
            expect(wrapperText).toContain('notify-send');

            // (Live POSIX /bin/sh wrapper execution runs in tests/integration/shell-launchers.integration.test.ts)

            // Remove cleans up .desktop, wrapper, SVG icon, and invokes update-desktop-database again
            const removed = removeCdpLauncher({
                platform: 'linux',
                homeDir: fakeHome,
                appPath: fakeBin,
                execFileSyncFn: (file, args) => {
                    dbCalls.push({ file, args });
                },
            });
            expect(removed.ok).toBe(true);
            expect(removed.status.installed).toBe(false);
            expect(fs.existsSync(svgPath)).toBe(false);
            expect(fs.existsSync(desktopPath)).toBe(false);
            expect(fs.existsSync(wrapperPath)).toBe(false);
            expect(dbCalls).toHaveLength(2);

            // SVG write failure gracefully falls back to Icon=antigravity
            const blockedHome = path.join(tempRoot, 'linux-icon-fallback');
            const blockingFile = path.join(blockedHome, '.local', 'share', 'icons');
            fs.mkdirSync(path.dirname(blockingFile), { recursive: true });
            fs.writeFileSync(blockingFile, 'not-a-directory', 'utf8');
            const fallbackRes = createCdpLauncher({
                platform: 'linux',
                homeDir: blockedHome,
                appPath: fakeBin,
                execFileSyncFn: () => { throw new Error('update-desktop-database missing'); },
            });
            expect(fallbackRes.ok).toBe(true);
            const fallbackDesktop = fs.readFileSync(fallbackRes.status.launcherPath, 'utf8');
            expect(fallbackDesktop).toContain('Icon=antigravity');
        }, 15_000);
    });
});

describe('[w1a-cross-platform-launchers-and-wrappers]', () => {
    const REPO_ROOT = path.resolve(__dirname, '..');

    const INSTALLER_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.mjs');

    const INSTALLER_SH_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.sh');

    const INSTALLER_PS1_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.ps1');

    describe('Phase 1 Wave 1A Hardening: Cross-Platform Launchers & Wrapper Scripts', () => {
        let tempRoot: string;

        beforeEach(() => {
            clearWindowsLauncherCaches();
            tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-w1a-sec-hard-'));
        });

        afterEach(() => {
            clearWindowsLauncherCaches();
            vi.restoreAllMocks();
            fs.rmSync(tempRoot, { recursive: true, force: true });
        });

        // ─── 5. W1A-FIX-8 #3 & #4 + D4 + §6 Launcher & Wrapper Script Hardening ──

        describe('W1A-FIX-8 #3 & #4 + D4: macOS AppleLanguages, reveal spawn outcomes, Linux XDG/Flatpak, PS1 & SH Node>=22', () => {
            it('waits for real reveal spawn outcome, captures async error/exit failures honestly, and preserves Windows verbatim args with semicolons/commas/spaces/Unicode', async () => {
                // 1. Windows verbatim args with spaces, commas, semicolons, Unicode & trailing backslash handling
                const trickyFile = 'C:\\Users\\Alice; Bob, Inc\\桌面\\Antigravity (CDP).lnk';
                const fileSpec = buildWindowsExplorerRevealCommand(trickyFile, false);
                expect(fileSpec.cmd).toBe('explorer.exe');
                expect(fileSpec.args).toEqual(['/select,', `"${trickyFile}"`]);
                expect(fileSpec.options.windowsVerbatimArguments).toBe(true);
                expect(fileSpec.options.shell).toBe(false);

                // Trailing backslash on non-root directory stripped so it cannot escape closing quote
                const dirSpec = buildWindowsExplorerRevealCommand('C:\\Users\\Alice; Bob, Inc\\桌面\\', true);
                expect(dirSpec.args).toEqual(['"C:\\Users\\Alice; Bob, Inc\\桌面"']);

                // 2. Linux reveal async ENOENT error MUST NOT return false success!
                const linuxHome = path.join(tempRoot, 'reveal-async-linux');
                createCdpLauncher({ platform: 'linux', homeDir: linuxHome });

                const linuxEnoent = await revealCdpLauncherAsync({
                    platform: 'linux',
                    homeDir: linuxHome,
                    spawnImpl: () => {
                        const emitter = new EventEmitter() as EventEmitter & SpawnedLauncherProcessLike;
                        emitter.unref = vi.fn();
                        process.nextTick(() => {
                            emitter.emit('error', Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' }));
                        });
                        return emitter;
                    },
                });
                expect(linuxEnoent.ok).toBe(false);
                expect(linuxEnoent.error).toMatch(/ENOENT/i);

                // Linux reveal early non-zero exit (e.g. headless environment where xdg-open exits 3) MUST fail honestly!
                const linuxHeadlessFail = await revealCdpLauncherAsync({
                    platform: 'linux',
                    homeDir: linuxHome,
                    revealSettleMs: 100,
                    spawnImpl: () => {
                        const emitter = new EventEmitter() as EventEmitter & SpawnedLauncherProcessLike;
                        emitter.pid = 5555;
                        emitter.unref = vi.fn();
                        process.nextTick(() => {
                            emitter.emit('spawn');
                            setTimeout(() => emitter.emit('exit', 3, null), 10);
                        });
                        return emitter;
                    },
                });
                expect(linuxHeadlessFail.ok).toBe(false);
                expect(linuxHeadlessFail.error).toMatch(/exit code 3/i);

                // Linux reveal successful spawn + exit 0 returns ok: true
                const linuxOk = await revealCdpLauncherAsync({
                    platform: 'linux',
                    homeDir: linuxHome,
                    revealSettleMs: 100,
                    spawnImpl: () => {
                        const emitter = new EventEmitter() as EventEmitter & SpawnedLauncherProcessLike;
                        emitter.pid = 5556;
                        emitter.unref = vi.fn();
                        process.nextTick(() => {
                            emitter.emit('spawn');
                            setTimeout(() => emitter.emit('exit', 0, null), 10);
                        });
                        return emitter;
                    },
                });
                expect(linuxOk.ok).toBe(true);

                // Sync revealCdpLauncher also fails honestly when xdg-open is absent on PATH
                const syncMissingXdg = revealCdpLauncher({
                    platform: 'linux',
                    homeDir: linuxHome,
                    commandExistsFn: () => false,
                });
                expect(syncMissingXdg.ok).toBe(false);
                expect(syncMissingXdg.error).toMatch(/xdg-open/i);

                // 3. Windows reveal async error on /select, falls back to parent dir, and fails honestly if both emit ENOENT
                const winHome = path.join(tempRoot, 'reveal-async-win');
                const winEnv = {
                    USERPROFILE: winHome,
                    LOCALAPPDATA: path.join(winHome, 'AppData', 'Local'),
                    APPDATA: path.join(winHome, 'AppData', 'Roaming'),
                };
                const winDesktop = path.join(winHome, 'OneDrive; Team, Inc', '桌面');
                const winLnk = path.join(winDesktop, 'Antigravity (CDP).lnk');
                fs.mkdirSync(winDesktop, { recursive: true });
                fs.writeFileSync(winLnk, 'mock-lnk', 'utf8');

                const winAttemptArgs: string[][] = [];
                const winFallbackOk = await revealCdpLauncherAsync({
                    platform: 'win32',
                    homeDir: winHome,
                    env: winEnv,
                    desktopDir: winDesktop,
                    spawnImpl: (_cmd, args) => {
                        winAttemptArgs.push([...args]);
                        const emitter = new EventEmitter() as EventEmitter & SpawnedLauncherProcessLike;
                        emitter.unref = vi.fn();
                        process.nextTick(() => {
                            if (args[0] === '/select,') {
                                emitter.emit('error', new Error('select spawn failed'));
                            } else {
                                emitter.pid = 7777;
                                emitter.emit('spawn');
                            }
                        });
                        return emitter;
                    },
                });
                expect(winFallbackOk.ok).toBe(true);
                expect(winAttemptArgs).toEqual([
                    ['/select,', `"${winLnk}"`],
                    [`"${winDesktop}"`],
                ]);

                const winBothFail = await revealCdpLauncherAsync({
                    platform: 'win32',
                    homeDir: winHome,
                    env: winEnv,
                    desktopDir: winDesktop,
                    spawnImpl: () => {
                        const emitter = new EventEmitter() as EventEmitter & SpawnedLauncherProcessLike;
                        emitter.unref = vi.fn();
                        process.nextTick(() => {
                            emitter.emit('error', Object.assign(new Error('spawn explorer.exe ENOENT'), { code: 'ENOENT' }));
                        });
                        return emitter;
                    },
                });
                expect(winBothFail.ok).toBe(false);
                expect(winBothFail.error).toMatch(/ENOENT/i);
            });

            it('ignores relative/invalid XDG_* env vars, escapes spaces & % in .desktop Exec=, and handles Linux Flatpak cleanly', async () => {
                const installer = await import(INSTALLER_PATH);
                const linuxHome = path.join(tempRoot, 'linux-xdg-sec');

                // Relative & invalid XDG_DATA_HOME values MUST be ignored
                for (const badXdg of ['relative/share', './share', '../escape', '/ok/../escape', '/bad\npath', '   ', '']) {
                    expect(sanitizeLinuxXdgDir(badXdg)).toBeNull();
                    expect(resolveLinuxXdgDataHome(linuxHome, { XDG_DATA_HOME: badXdg }))
                        .toBe(path.join(linuxHome, '.local', 'share'));
                    expect(installer.getAntigravityUserDataDir({ HOME: linuxHome, XDG_CONFIG_HOME: badXdg }, 'linux'))
                        .toBe(path.join(linuxHome, '.config', 'Antigravity'));
                }

                // Valid absolute XDG_DATA_HOME is respected
                const absXdg = path.join(tempRoot, 'valid xdg 100%');
                expect(resolveLinuxXdgDataHome(linuxHome, { XDG_DATA_HOME: absXdg })).toBe(absXdg);

                // Spaces & % escaping in .desktop Exec=
                expect(escapeFreedesktopExecArg('/home/alice/my apps/100% ready/antigravity-cdp'))
                    .toBe('"/home/alice/my apps/100%% ready/antigravity-cdp"');
                expect(escapeFreedesktopExecArg('/home/alice/50%off/antigravity-cdp'))
                    .toBe('/home/alice/50%%off/antigravity-cdp');
                const desktopEntry = buildLinuxDesktopEntry('/home/alice/my apps/100% ready/antigravity-cdp');
                expect(desktopEntry).toContain('Exec="/home/alice/my apps/100%% ready/antigravity-cdp" %U');

                // Flatpak export discovery, launch command, boundary notes, and live process detection
                const flatpakBin = path.join(absXdg, 'flatpak', 'exports', 'bin', LINUX_FLATPAK_APP_ID);
                fs.mkdirSync(path.dirname(flatpakBin), { recursive: true });
                fs.writeFileSync(flatpakBin, '#!/bin/sh\nexit 0\n', 'utf8');
                const resolvedFlatpak = resolveCdpLauncherPaths({
                    platform: 'linux',
                    homeDir: linuxHome,
                    env: { HOME: linuxHome, XDG_DATA_HOME: absXdg },
                });
                expect(resolvedFlatpak.targetAppPath).toBe(flatpakBin);

                const flatpakInspect = inspectCdpLauncher({
                    platform: 'linux',
                    homeDir: linuxHome,
                    appPath: `flatpak:${LINUX_FLATPAK_APP_ID}`,
                    commandExistsFn: (cmd) => cmd === 'flatpak',
                });
                expect(flatpakInspect.targetAppFound).toBe(true);
                expect(flatpakInspect.noteEn).toContain(LINUX_FLATPAK_BOUNDARY_NOTE_EN);
                expect(flatpakInspect.noteZh).toContain(LINUX_FLATPAK_BOUNDARY_NOTE_ZH);
                expect(installer.formatCdpGuide()).toContain(`flatpak run ${LINUX_FLATPAK_APP_ID} --remote-debugging-port=0`);
                // (Live POSIX /bin/sh Flatpak execution runs in tests/integration/shell-launchers.integration.test.ts)
            });

            it('aligns install-app-plugin.ps1 Program Files discovery and checks Node >= 22 in install-app-plugin.sh', () => {
                // 1. PowerShell wrapper aligns with cdp-launcher.ts (%ProgramFiles%, %ProgramFiles(x86)%, %ProgramW6432%, Google\Antigravity, Node >= 22)
                const ps1Buf = fs.readFileSync(INSTALLER_PS1_PATH);
                expect(ps1Buf[0] === 0xef && ps1Buf[1] === 0xbb && ps1Buf[2] === 0xbf).toBe(false);
                const ps1Text = ps1Buf.toString('utf8');
                expect(ps1Text).toContain('$env:ProgramFiles');
                expect(ps1Text).toContain('${env:ProgramFiles(x86)}');
                expect(ps1Text).toContain('$env:ProgramW6432');
                expect(ps1Text).toContain('Google\\Antigravity');
                expect(ps1Text).toContain('$MinNodeMajor = 22');
                expect(ps1Text).toContain('Test-NodeRuntimeCompatible');

                // 2. Shell wrapper enforces Node >= 22 and XDG sanitization (live bash execution in tests/integration/shell-launchers.integration.test.ts)
                const shText = fs.readFileSync(INSTALLER_SH_PATH, 'utf8');
                expect(shText).toContain('MIN_NODE_MAJOR=22');
                expect(shText).toContain('is_compatible_node');
                expect(shText).toContain('type -aP node');
                expect(shText).toContain('resolve_xdg_data_home');
            });
        });
    });
});

describe('[supply-chain-cross-platform-launchers]', () => {
    const REPO_ROOT = path.resolve(__dirname, '..');

    const INSTALLER_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.mjs');

    const INSTALLER_SH_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.sh');

    const PACKAGER_PATH = path.join(REPO_ROOT, 'scripts', 'package-app-plugin.mjs');

    const MAIN_MJS_PATH = path.join(REPO_ROOT, 'app-plugin', 'sidecars', 'context_monitor', 'main.mjs');


    interface TestZipEntry {
        name: string;
        data: Buffer | string;
        method?: 0 | 8;
        unixMode?: number;
        hostOs?: number;
    }


    describe('Phase 1 Wave 1A: Cross-Platform Launchers', () => {
        let tempRoot: string;

        beforeEach(() => {
            clearWindowsLauncherCaches();
            tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-p1-sec-'));
        });

        afterEach(() => {
            clearWindowsLauncherCaches();
            vi.restoreAllMocks();
            fs.rmSync(tempRoot, { recursive: true, force: true });
        });

        // ─── SEC-04 & PERF-01: Cross-Platform CDP Launcher & Installers ──────────

        describe('SEC-04 & PERF-01: Cross-platform CDP launcher & installer hardening', () => {
            it('sets macOS default button to Cancel (EN & ZH), auto-detects locale, validates symlinks/bundleID, and prevents stale /Applications shadowing', () => {
                const macScript = buildMacOsLauncherScript('/Applications/Antigravity.app');
                expect(macScript).toContain('default button "Cancel" cancel button "Cancel"');
                expect(macScript).not.toContain('default button "Quit & Relaunch"');
                expect(macScript).toContain('default button "取消" cancel button "取消"');
                expect(macScript).toContain('detect_locale_zh');
                expect(macScript).toContain('AppleLanguages');
                expect(macScript).not.toMatch(/\b(kill|pkill|killall)\b/);

                const fakeHome = path.join(tempRoot, 'mac-sec-home');
                const fakeSysApps = path.join(tempRoot, 'FakeSysApps');
                const fakeApp = path.join(fakeSysApps, 'Antigravity.app');
                fs.mkdirSync(path.join(fakeApp, 'Contents', 'Resources'), { recursive: true });

                // 1. Refuse overwriting a symlink at ~/Applications/Antigravity (CDP).app
                const symlinkHome = path.join(tempRoot, 'mac-symlink-home');
                const symlinkTarget = path.join(tempRoot, 'symlink-victim');
                fs.mkdirSync(symlinkTarget, { recursive: true });
                const userAppsDir = path.join(symlinkHome, 'Applications');
                fs.mkdirSync(userAppsDir, { recursive: true });
                const symlinkBundle = path.join(userAppsDir, 'Antigravity (CDP).app');
                fs.symlinkSync(symlinkTarget, symlinkBundle);

                const symCreate = createCdpLauncher({ platform: 'darwin', homeDir: symlinkHome, appPath: fakeApp });
                expect(symCreate.ok).toBe(false);
                expect(symCreate.error).toMatch(/symlink/i);
                expect(fs.readdirSync(symlinkTarget)).toEqual([]);

                // removeCdpLauncher also refuses to remove symlinks or foreign bundles
                const symRemove = removeCdpLauncher({ platform: 'darwin', homeDir: symlinkHome, appPath: fakeApp });
                expect(symRemove.ok).toBe(true);
                expect(fs.lstatSync(symlinkBundle).isSymbolicLink()).toBe(true);

                // 2. Foreign bundle with different CFBundleIdentifier is NEVER overwritten or deleted
                const foreignHome = path.join(tempRoot, 'mac-foreign-home');
                const foreignBundle = path.join(foreignHome, 'Applications', 'Antigravity (CDP).app');
                fs.mkdirSync(path.join(foreignBundle, 'Contents', 'MacOS'), { recursive: true });
                fs.writeFileSync(
                    path.join(foreignBundle, 'Contents', 'Info.plist'),
                    '<plist><dict><key>CFBundleIdentifier</key><string>com.someone-else.app</string></dict></plist>',
                    'utf8',
                );
                expect(readMacBundleIdentifier(foreignBundle)).toBe('com.someone-else.app');
                expect(isOwnedMacCdpBundle(foreignBundle)).toBe(false);
                const foreignCreate = createCdpLauncher({ platform: 'darwin', homeDir: foreignHome, appPath: fakeApp });
                expect(foreignCreate.ok).toBe(false);
                expect(foreignCreate.error).toMatch(/CFBundleIdentifier/i);
                removeCdpLauncher({ platform: 'darwin', homeDir: foreignHome, appPath: fakeApp });
                expect(fs.existsSync(foreignBundle)).toBe(true);

                // 3. Undeletable stale /Applications copy causing fallback to ~/Applications MUST NOT shadow ~/Applications!
                const staleSysBundle = path.join(fakeSysApps, 'Antigravity (CDP).app');
                fs.mkdirSync(path.join(staleSysBundle, 'Contents', 'MacOS'), { recursive: true });
                fs.writeFileSync(path.join(staleSysBundle, 'Contents', 'Info.plist'), buildMacOsInfoPlist(), 'utf8');
                fs.writeFileSync(path.join(staleSysBundle, 'Contents', 'MacOS', 'launch'), '# stale', 'utf8');
                if (process.platform !== 'win32') {
                    fs.chmodSync(path.join(staleSysBundle, 'Contents', 'MacOS', 'launch'), 0o444);
                    fs.chmodSync(path.join(staleSysBundle, 'Contents', 'MacOS'), 0o555);
                    fs.chmodSync(path.join(staleSysBundle, 'Contents'), 0o555);
                    fs.chmodSync(staleSysBundle, 0o555);
                    fs.chmodSync(fakeSysApps, 0o555);
                }
                try {
                    if (process.platform !== 'win32') {
                        const userBundle = path.join(fakeHome, 'Applications', 'Antigravity (CDP).app');
                        const fallbackCreate = createCdpLauncher({
                            platform: 'darwin',
                            homeDir: fakeHome,
                            systemAppsDir: fakeSysApps,
                            appPath: fakeApp,
                        });
                        expect(fallbackCreate.ok).toBe(true);
                        expect(fallbackCreate.status.launcherPath).toBe(userBundle);
                        // Subsequent inspectCdpLauncher & resolveCdpLauncherPaths ALSO prioritize ~/Applications!
                        const reinspect = inspectCdpLauncher({
                            platform: 'darwin',
                            homeDir: fakeHome,
                            systemAppsDir: fakeSysApps,
                            appPath: fakeApp,
                        });
                        expect(reinspect.launcherPath).toBe(userBundle);
                        expect(readMacBundleIdentifier(userBundle)).toBe(MACOS_CDP_LAUNCHER_BUNDLE_ID);
                    }
                } finally {
                    if (process.platform !== 'win32') {
                        fs.chmodSync(fakeSysApps, 0o755);
                        fs.chmodSync(staleSysBundle, 0o755);
                        fs.chmodSync(path.join(staleSysBundle, 'Contents'), 0o755);
                        fs.chmodSync(path.join(staleSysBundle, 'Contents', 'MacOS'), 0o755);
                        fs.chmodSync(path.join(staleSysBundle, 'Contents', 'MacOS', 'launch'), 0o755);
                    }
                }
            });

            it('caches Windows Desktop dir asynchronously (TTL >= 60s), never blocks polling with sync powershell.exe, quotes reveal verbatim, and detects ProgramFiles/.lnk/registry exes', async () => {
                expect(WINDOWS_DESKTOP_CACHE_TTL_MS).toBeGreaterThanOrEqual(60_000);

                const fakeHome = path.join(tempRoot, 'win-perf-home');
                const fakeOneDriveDesktop = path.join(fakeHome, 'OneDrive - Corp, Inc', '桌面');
                const winEnv = {
                    USERPROFILE: fakeHome,
                    LOCALAPPDATA: path.join(fakeHome, 'AppData', 'Local'),
                    APPDATA: path.join(fakeHome, 'AppData', 'Roaming'),
                };

                // 1. Sync polling MUST NEVER invoke execFileSyncFn
                const syncSpy = vi.fn(() => { throw new Error('sync powershell forbidden during polling'); });
                let fakeNow = 1_000_000;
                const poll1 = inspectCdpLauncher({
                    platform: 'win32',
                    homeDir: fakeHome,
                    env: winEnv,
                    execFileSyncFn: syncSpy,
                    now: () => fakeNow,
                });
                expect(syncSpy).not.toHaveBeenCalled();
                expect(poll1.launcherPath).toBe(path.join(fakeHome, 'Desktop', 'Antigravity (CDP).lnk'));

                // 2. Async warmup populates process cache for >= 60s
                let asyncCalls = 0;
                const asyncRunner = async () => {
                    asyncCalls++;
                    return `${fakeOneDriveDesktop}\r\n`;
                };
                const resolvedDesktop = await resolveWindowsDesktopDirAsync({
                    homeDir: fakeHome,
                    env: winEnv,
                    execFileAsyncFn: asyncRunner,
                    now: () => fakeNow,
                });
                expect(resolvedDesktop).toBe(fakeOneDriveDesktop);
                expect(asyncCalls).toBe(1);

                // Repeated sync polls within 59s read straight from memory (0 sync calls, 0 extra async calls)
                fakeNow += 59_000;
                expect(getCachedWindowsDesktopDir({ homeDir: fakeHome, env: winEnv, execFileAsyncFn: asyncRunner, now: () => fakeNow }))
                    .toBe(fakeOneDriveDesktop);
                expect(inspectCdpLauncher({ platform: 'win32', homeDir: fakeHome, env: winEnv, execFileSyncFn: syncSpy, now: () => fakeNow }).launcherPath)
                    .toBe(path.join(fakeOneDriveDesktop, 'Antigravity (CDP).lnk'));
                expect(syncSpy).not.toHaveBeenCalled();
                expect(asyncCalls).toBe(1);

                // Explicit refresh or TTL expiration triggers new async fetch
                fakeNow += 2_000; // past 60s TTL
                await refreshWindowsDesktopDirCache({ homeDir: fakeHome, env: winEnv, execFileAsyncFn: asyncRunner, now: () => fakeNow });
                expect(asyncCalls).toBe(2);

                // 3. Verbatim Windows Explorer reveal handles spaces, commas, and Unicode cleanly
                const trickyTarget = path.join(fakeOneDriveDesktop, 'Antigravity (CDP).lnk');
                const revealSpec = buildWindowsExplorerRevealCommand(trickyTarget, false);
                expect(revealSpec.cmd).toBe('explorer.exe');
                expect(revealSpec.args).toEqual(['/select,', `"${trickyTarget}"`]);
                expect(revealSpec.options.windowsVerbatimArguments).toBe(true);
                expect(revealSpec.options.shell).toBe(false);

                fs.mkdirSync(fakeOneDriveDesktop, { recursive: true });
                fs.writeFileSync(trickyTarget, 'mock-lnk', 'utf8');
                const spawned: Array<{ cmd: string; args: readonly string[]; verbatim?: boolean }> = [];
                const revealRes = revealCdpLauncher({
                    platform: 'win32',
                    homeDir: fakeHome,
                    env: winEnv,
                    desktopDir: fakeOneDriveDesktop,
                    spawnImpl: (cmd, args, opts) => {
                        spawned.push({ cmd, args, verbatim: opts?.windowsVerbatimArguments });
                        return { unref: vi.fn(), on: vi.fn() };
                    },
                });
                expect(revealRes.ok).toBe(true);
                expect(spawned).toEqual([{
                    cmd: 'explorer.exe',
                    args: ['/select,', `"${trickyTarget}"`],
                    verbatim: true,
                }]);

                // 4. Expanded Windows executable detection: %ProgramFiles%, %ProgramFiles(x86)%, .lnk fallback, registry async
                const pfDir = path.join(tempRoot, 'ProgramFiles');
                const pfExe = path.join(pfDir, 'Antigravity', 'Antigravity.exe');
                fs.mkdirSync(path.dirname(pfExe), { recursive: true });
                fs.writeFileSync(pfExe, 'exe');
                expect(resolveCdpLauncherPaths({
                    platform: 'win32',
                    homeDir: fakeHome,
                    env: { ...winEnv, ProgramFiles: pfDir },
                }).targetAppPath).toBe(pfExe);

                const pf86Dir = path.join(tempRoot, 'ProgramFiles86');
                const pf86Exe = path.join(pf86Dir, 'Antigravity', 'Antigravity.exe');
                fs.mkdirSync(path.dirname(pf86Exe), { recursive: true });
                fs.writeFileSync(pf86Exe, 'exe86');
                expect(resolveCdpLauncherPaths({
                    platform: 'win32',
                    homeDir: fakeHome,
                    env: { ...winEnv, 'ProgramFiles(x86)': pf86Dir },
                }).targetAppPath).toBe(pf86Exe);

                // Pure-Node .lnk extraction helper
                const lnkFile = path.join(tempRoot, 'Antigravity.lnk');
                const realExeForLnk = path.join(tempRoot, 'CustomInstall', 'Antigravity.exe');
                fs.mkdirSync(path.dirname(realExeForLnk), { recursive: true });
                fs.writeFileSync(realExeForLnk, 'exe');
                // On POSIX test runners we test the extractor with a synthetic Windows drive-letter match via temp mock or check null cleanly
                expect(extractAntigravityExeFromLnkFile(lnkFile)).toBeNull();

                // Registry async fallback
                const regHome = path.join(tempRoot, 'win-reg-home');
                const regExe = await resolveWindowsAntigravityExeAsync({
                    homeDir: regHome,
                    env: { USERPROFILE: regHome, LOCALAPPDATA: path.join(regHome, 'Local'), APPDATA: path.join(regHome, 'Roaming') },
                    execFileAsyncFn: async () => 'C:\\CustomDir\\Antigravity\\Antigravity.exe\r\n',
                });
                expect(regExe).toBe('C:\\CustomDir\\Antigravity\\Antigravity.exe');
            });

            it('supports Linux XDG_DATA_HOME, AppImage process regex (/tmp/.mount_AntigrXXXXXX), and localized EN/ZH notices', () => {
                expect(LINUX_APPIMAGE_PROCESS_RE.test('/home/alice/Antigravity-1.18.0.AppImage')).toBe(true);
                expect(LINUX_APPIMAGE_PROCESS_RE.test('/tmp/.mount_AntigrABC123/antigravity')).toBe(true);
                expect(LINUX_APPIMAGE_PROCESS_RE.test('/tmp/.mount_AntigrXYZ999/AppRun')).toBe(true);
                expect(LINUX_APPIMAGE_PROCESS_RE.test('/usr/bin/chrome')).toBe(false);

                const fakeHome = path.join(tempRoot, 'linux-xdg-home');
                const xdgDataHome = path.join(tempRoot, 'custom-xdg-data');
                const created = createCdpLauncher({
                    platform: 'linux',
                    homeDir: fakeHome,
                    env: { HOME: fakeHome, XDG_DATA_HOME: xdgDataHome },
                });
                expect(created.ok).toBe(true);
                expect(created.status.launcherPath).toBe(path.join(xdgDataHome, 'applications', 'antigravity-cdp.desktop'));
                expect(fs.existsSync(path.join(xdgDataHome, 'icons', 'hicolor', 'scalable', 'apps', 'antigravity-cdp.svg'))).toBe(true);

                // Verify generated script includes localized EN/ZH detection (live POSIX sh execution in tests/integration/shell-launchers.integration.test.ts)
                const scriptStr = buildLinuxLauncherScript('/opt/Antigravity/antigravity');
                expect(scriptStr).toContain('is_zh_locale');
            });
        });
    });
});

describe('[section-6-cross-platform-corner-case-matrix]', () => {
    const REPO_ROOT = path.resolve(__dirname, '..');

    afterEach(() => {
        clearWindowsLauncherCaches();
        resetPathCaseSensitivityCache();
        vi.restoreAllMocks();
    });

    it('§6.1 Windows: 32/64-bit PowerShell & .cmd/.exe selection, OneDrive offline fallback, UNC roots, junctions, long paths, CRLF & verbatim explorer.exe /select,', async () => {
        // 1. 32/64-bit PowerShell wrapper (.ps1) covers %LOCALAPPDATA%, %ProgramFiles%, %ProgramFiles(x86)%, %ProgramW6432% and both .exe & .cmd
        const ps1 = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'install-app-plugin.ps1'), 'utf8');
        expect(ps1).toContain('$env:ProgramW6432');
        expect(ps1).toContain('${env:ProgramFiles(x86)}');
        expect(ps1).toContain('$env:ProgramFiles');
        expect(ps1).toContain('agy-node.exe');
        expect(ps1).toContain('agy-node.cmd');
        expect(ps1).toContain('ELECTRON_RUN_AS_NODE');

        // 2. Windows launcher .cmd helper stays CRLF-safe and uses --remote-debugging-port=0
        const winCmd = buildWindowsLauncherCmd('C:\\Program Files\\Antigravity\\Antigravity.exe');
        expect(winCmd).toContain('--remote-debugging-port=0');
        expect(winCmd).not.toMatch(/\btaskkill\b/i);

        // 3. OneDrive Desktop offline/failing async probe falls back cleanly to USERPROFILE\Desktop without throwing
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-s6-win-'));
        try {
            const winEnv = {
                USERPROFILE: tmpRoot,
                LOCALAPPDATA: path.join(tmpRoot, 'AppData', 'Local'),
                APPDATA: path.join(tmpRoot, 'AppData', 'Roaming'),
            };
            const offlineDesktop = await resolveWindowsDesktopDirAsync({
                homeDir: tmpRoot,
                env: winEnv,
                execFileAsyncFn: async () => { throw new Error('OneDrive Desktop offline'); },
            });
            expect(offlineDesktop).toBe(path.join(tmpRoot, 'Desktop'));

            // 4. UNC share roots, Windows drive-case folding, long paths (>260 chars), and CRLF trimming
            expect(normalizeWorkspaceUri('\\\\BuildServer\\Share\\Team Repo\\', 'win32'))
                .toBe('//buildserver/share/team repo');
            expect(normalizeWorkspaceUri('file://BuildServer/Share/Team%20Repo/', 'win32'))
                .toBe('//buildserver/share/team repo');
            expect(normalizeWorkspaceUri('C:\\Users\\Alice\\Repo\r\n', 'win32'))
                .toBe(normalizeWorkspaceUri('c:/users/alice/repo/', 'win32'));

            const deepSegments = Array.from({ length: 14 }, (_, i) => `segment_${i}_0123456789abcdef`).join('\\');
            const longWinPath = `C:\\Work\\${deepSegments}`;
            expect(longWinPath.length).toBeGreaterThan(260);
            expect(normalizeWorkspaceUri(`${longWinPath}\r\n`, 'win32'))
                .toBe(`c:/work/${deepSegments.replace(/\\/g, '/').toLowerCase()}`);

            // 5. Verbatim explorer.exe /select, preserves spaces, commas, semicolons, Unicode, and UNC paths
            const uncTarget = '\\\\CorpFS\\Shared, Data; 2026\\桌面\\Antigravity (CDP).lnk';
            const spec = buildWindowsExplorerRevealCommand(uncTarget, false);
            expect(spec.cmd).toBe('explorer.exe');
            expect(spec.args).toEqual(['/select,', `"${uncTarget}"`]);
            expect(spec.options.windowsVerbatimArguments).toBe(true);
            expect(spec.options.shell).toBe(false);

            // 6. Windows junction / symlink inside brain/ swarm manifest path is rejected fail-closed
            const brainDir = path.join(tmpRoot, 'brain');
            const coordDir = path.join(brainDir, 'coord-junc-1', '.system_generated', 'swarm');
            const outsideDir = path.join(tmpRoot, 'outside-secret');
            fs.mkdirSync(coordDir, { recursive: true });
            fs.mkdirSync(outsideDir, { recursive: true });
            fs.writeFileSync(path.join(outsideDir, 'members.json'), '{"members":{}}', 'utf8');
            const manifestPath = path.join(coordDir, 'members.json');
            fs.symlinkSync(path.join(outsideDir, 'members.json'), manifestPath);
            const juncRead = await safeReadManifestFile(brainDir, 'coord-junc-1', 'members.json');
            expect(juncRead.ok).toBe(false);
            if (!juncRead.ok) {
                expect(juncRead.reason).toBe('symlink_or_junction');
            }
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    it('§6.2 macOS: APFS indeterminate & mount-point probe safety, TCC denial fallback, Cancel default, Dock reopen & zero Cmd+Shift+Q', () => {
        // 1. Indeterminate APFS probe preserves original case (never blindly folds!)
        expect(normalizeWorkspaceUri('/Users/Alice/MixedCaseRepo', {
            platform: 'darwin',
            isCaseSensitivePath: () => null,
        })).toBe('/Users/Alice/MixedCaseRepo');
        expect(normalizeWorkspaceUri('/Users/Alice/MixedCaseRepo', {
            platform: 'darwin',
            isCaseSensitivePath: () => true,
        })).toBe('/Users/Alice/MixedCaseRepo');
        expect(normalizeWorkspaceUri('/Users/Alice/MixedCaseRepo', {
            platform: 'darwin',
            isCaseSensitivePath: () => false,
        })).toBe('/users/alice/mixedcaserepo');

        // 2. Mount-point boundary safety: NEVER probe parent volume across dev boundary or walk past unmounted /Volumes/<vol>
        const probedPaths: string[] = [];
        const mountRes = detectPathCaseSensitivity('/Volumes/CaseSensitiveVol', {
            useCache: false,
            statSync: (p) => {
                probedPaths.push(p);
                if (p === '/Volumes/CaseSensitiveVol') { return { dev: 200, ino: 1 }; }
                if (p === '/Volumes') { return { dev: 100, ino: 2 }; }
                throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            },
            readdirSync: () => [],
        });
        expect(mountRes).toBeNull();
        expect(probedPaths.some((p) => p.toLowerCase() === '/volumes/casesensitivevol' && p !== '/Volumes/CaseSensitiveVol')).toBe(false);

        const unmountedRes = detectPathCaseSensitivity('/Volumes/OfflineDrive/Repo', {
            useCache: false,
            statSync: (p) => {
                if (p === '/Volumes') { return { dev: 100, ino: 2 }; }
                throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            },
            readdirSync: () => [],
        });
        expect(unmountedRes).toBeNull();

        // 3. macOS launcher script: Cancel default button, TCC Automation denial fallback, zero kill/pkill/killall
        const macScript = buildMacOsLauncherScript('/Applications/Antigravity.app');
        expect(macScript).toContain('default button "Cancel" cancel button "Cancel"');
        expect(macScript).toContain('default button "取消" cancel button "取消"');
        expect(macScript).toMatch(/Automation|System Events|Cmd\+Q|Command\+Q/i);
        expect(macScript).not.toMatch(/\b(kill|pkill|killall)\b/);

        // 4. package.json IDE keybindings NEVER bind macOS system Log Out shortcut (Cmd+Shift+Q)
        const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
        for (const kb of pkg.contributes.keybindings as Array<{ key: string; mac?: string }>) {
            expect(kb.key.toLowerCase()).not.toBe('cmd+shift+q');
            expect((kb.mac || '').toLowerCase()).not.toBe('cmd+shift+q');
        }
    });

    it('§6.3 Linux: Snap/Flatpak/AppImage boundaries, relative/traversal XDG rejection, .desktop % escaping & obsolete system Node guard', () => {
        // Relative / traversal / empty XDG dirs are rejected safely
        for (const bad of ['', '   ', 'relative/path', './local', '../escape', '/ok/../bad']) {
            expect(sanitizeLinuxXdgDir(bad), `sanitizeLinuxXdgDir(${JSON.stringify(bad)})`).toBeNull();
        }
        expect(resolveLinuxXdgDataHome('/home/alice', { XDG_DATA_HOME: 'relative/share' }))
            .toBe('/home/alice/.local/share');

        // .desktop Exec= escapes spaces and % -> %% while keeping StartupWMClass=Antigravity
        const desktop = buildLinuxDesktopEntry('/opt/my apps/100% safe/antigravity-cdp');
        expect(desktop).toContain('Exec="/opt/my apps/100%% safe/antigravity-cdp" %U');
        expect(desktop).toContain('StartupWMClass=Antigravity');
        expect(escapeFreedesktopExecArg('/opt/50%off/bin')).toBe('/opt/50%%off/bin');

        // AppImage mount regex & Flatpak sandbox notes
        expect(LINUX_APPIMAGE_PROCESS_RE.test('/tmp/.mount_Antigr999/AppRun')).toBe(true);
        expect(LINUX_FLATPAK_BOUNDARY_NOTE_EN).toContain(`flatpak run ${LINUX_FLATPAK_APP_ID}`);
        expect(LINUX_FLATPAK_BOUNDARY_NOTE_ZH).toContain(`flatpak run ${LINUX_FLATPAK_APP_ID}`);

        // install-app-plugin.sh enforces Node >= 22 over obsolete system node and covers Snap/Linux paths
        const sh = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'install-app-plugin.sh'), 'utf8');
        expect(sh).toContain('/snap/antigravity/current/resources/bin/agy-node');
        expect(sh).toContain('22');
    });

    it('§6.4 WSL & Remote-SSH: preserves distro authority (Ubuntu != Debian), POSIX case sensitivity, \\wsl$ aliasing & non-local brain/ isolation', () => {
        // 1. WSL distro authority isolation: Ubuntu != Debian even for identical POSIX paths
        const ubuntu = normalizeWorkspaceUri('vscode-remote://wsl+Ubuntu/home/Dev/App/', 'win32');
        const debian = normalizeWorkspaceUri('vscode-remote://wsl+Debian/home/Dev/App/', 'win32');
        expect(ubuntu).toBe('vscode-remote://wsl+ubuntu/home/Dev/App');
        expect(debian).toBe('vscode-remote://wsl+debian/home/Dev/App');
        expect(ubuntu).not.toBe(debian);

        // 2. POSIX case sensitivity preserved under WSL even when normalized on win32
        const upper = normalizeWorkspaceUri('vscode-remote://wsl+Ubuntu/home/Dev/App', 'win32');
        const lower = normalizeWorkspaceUri('vscode-remote://wsl+Ubuntu/home/dev/app', 'win32');
        expect(upper).not.toBe(lower);

        // 3. \\wsl$ and \\wsl.localhost UNC aliases match their exact distro authority and keep POSIX case
        expect(normalizeWorkspaceUri('\\\\wsl$\\Ubuntu\\home\\Dev\\App\\', 'win32'))
            .toBe('vscode-remote://wsl+ubuntu/home/Dev/App');
        expect(normalizeWorkspaceUri('\\\\wsl.localhost\\Debian\\home\\Dev\\App\\', 'win32'))
            .toBe('vscode-remote://wsl+debian/home/Dev/App');
        expect(normalizeWorkspaceUri('\\\\wsl$\\Ubuntu\\home\\Dev\\App', 'win32'))
            .not.toBe(normalizeWorkspaceUri('\\\\wsl$\\Debian\\home\\Dev\\App', 'win32'));

        // 4. Remote-SSH distinct hosts sharing /srv/app NEVER collide
        const sshA = normalizeWorkspaceUri('vscode-remote://ssh-remote+prod-a/srv/App/', 'darwin');
        const sshB = normalizeWorkspaceUri('vscode-remote://ssh-remote+prod-b/srv/App/', 'darwin');
        expect(sshA).not.toBe(sshB);

        // 5. Remote-SSH & WSL NEVER scan an unrelated local brain/ directory without explicit verification!
        expect(resolveScopedBrainRoot({
            homeDir: '/Users/localuser',
            remoteAuthority: 'ssh-remote+prod-a',
        })).toBeNull();
        expect(resolveScopedBrainRoot({
            homeDir: '/Users/localuser',
            remoteAuthority: 'wsl+Ubuntu',
        })).toBeNull();
        expect(resolveScopedBrainRoot({
            homeDir: '/Users/localuser',
            isRemoteHost: true,
        })).toBeNull();

        // Only explicitly verified remote brain root is accepted
        expect(resolveScopedBrainRoot({
            brainDir: '/remote-verified/brain',
            remoteAuthority: 'ssh-remote+prod-a',
            remoteBrainVerified: true,
        })).toBe(path.resolve('/remote-verified/brain'));
    });
});

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CDP_LAUNCHER_DISPLAY_NAME,
    LINUX_CDP_ICON_FILENAME,
    MACOS_CDP_LAUNCHER_BUNDLE_ID,
    MACOS_ICON_BADGE_JXA,
    WINDOWS_DESKTOP_PS_SCRIPT,
    WINDOWS_SHORTCUT_PS_SCRIPT,
    buildLinuxBadgedSvg,
    buildLinuxDesktopEntry,
    buildLinuxLauncherScript,
    buildMacOsInfoPlist,
    buildMacOsLauncherScript,
    buildWindowsLauncherCmd,
    createCdpLauncher,
    getSafeCdpLaunchCommand,
    inspectCdpLauncher,
    removeCdpLauncher,
    resolveCdpLauncherPaths,
    revealCdpLauncher,
} from '../src/app/cdp-launcher';

describe('Zero-Patch Persistent CDP Launcher (macOS, Windows, Linux)', () => {
    let tempRoot: string;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-cdp-launcher-test-'));
    });

    afterEach(() => {
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

        // Before setup: stale fallback desktop .lnk is detected even without .cmd, then remove it first for clean "before" check
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
        expect(before.launcherPath).toBe(path.join(fakeOneDriveDesktop, 'Antigravity (CDP).lnk'));

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

        // Fallback to %USERPROFILE%\Desktop when PowerShell GetFolderPath fails
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
        const winCalls: Array<{ cmd: string; args: readonly string[] }> = [];
        const winReveal = revealCdpLauncher({
            platform: 'win32',
            homeDir: winHome,
            env: winEnv,
            spawnImpl: (cmd, args) => {
                winCalls.push({ cmd, args });
                return { unref: vi.fn(), on: vi.fn() };
            },
        });
        expect(winReveal.ok).toBe(true);
        expect(winReveal.messageEn).toContain('Explorer');
        expect(winReveal.messageZh).toContain('资源管理器');
        expect(winCalls).toEqual([{
            cmd: 'explorer.exe',
            args: [`/select,${winDesktopLnk}`],
        }]);

        // Windows fallback to parent directory if /select throws
        const winFallbackCalls: Array<{ cmd: string; args: readonly string[] }> = [];
        const winFallback = revealCdpLauncher({
            platform: 'win32',
            homeDir: winHome,
            env: winEnv,
            spawnImpl: (cmd, args) => {
                winFallbackCalls.push({ cmd, args });
                if (args[0]?.startsWith('/select,')) {
                    throw new Error('select failed');
                }
                return { unref: vi.fn(), on: vi.fn() };
            },
        });
        expect(winFallback.ok).toBe(true);
        expect(winFallbackCalls).toEqual([
            { cmd: 'explorer.exe', args: [`/select,${winDesktopLnk}`] },
            { cmd: 'explorer.exe', args: [path.dirname(winDesktopLnk)] },
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

        // Live POSIX sh execution tests with reusable mock ps & dialog tools (POSIX only)
        if (process.platform !== 'win32') {
            const mockBinDir = fs.mkdtempSync(path.join(tempRoot, 'mock-bin-'));
            const logFile = path.join(mockBinDir, 'tool.log');
            fs.writeFileSync(path.join(mockBinDir, 'ps'), '#!/bin/sh\nprintf "%s\\n" "$MOCK_PS_OUT"\n', 'utf8');
            fs.chmodSync(path.join(mockBinDir, 'ps'), 0o755);
            for (const [toolName, envKey] of [
                ['zenity', 'MOCK_ZENITY_RC'],
                ['kdialog', 'MOCK_KDIALOG_RC'],
                ['notify-send', 'MOCK_NOTIFY_RC'],
            ] as const) {
                const p = path.join(mockBinDir, toolName);
                fs.writeFileSync(
                    p,
                    `#!/bin/sh\nrc="\${${envKey}:-1}"\nif [ "$rc" -eq 0 ]; then echo "${toolName.toUpperCase()}:$*" >> "$MOCK_LOG"; fi\nexit "$rc"\n`,
                    'utf8',
                );
                fs.chmodSync(p, 0o755);
            }

            const runWrapperWithMockPs = (
                psLines: string[],
                rcs: { zenity?: number; kdialog?: number; notify?: number } = {},
            ) => {
                fs.rmSync(logFile, { force: true });
                try {
                    const stdout = execFileSync('/bin/sh', [wrapperPath, '--extra-arg'], {
                        encoding: 'utf8',
                        env: {
                            PATH: `${mockBinDir}:/usr/bin:/bin`,
                            ACM_EXIT_WAIT_TICKS: '0',
                            MOCK_PS_OUT: psLines.join('\n'),
                            MOCK_LOG: logFile,
                            MOCK_ZENITY_RC: String(rcs.zenity ?? 1),
                            MOCK_KDIALOG_RC: String(rcs.kdialog ?? 1),
                            MOCK_NOTIFY_RC: String(rcs.notify ?? 1),
                        },
                        stdio: ['ignore', 'pipe', 'pipe'],
                    });
                    return { code: 0, stdout, stderr: '', log: fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '' };
                } catch (err: unknown) {
                    const e = err as { status?: number; stdout?: string; stderr?: string };
                    return {
                        code: e.status ?? 1,
                        stdout: String(e.stdout ?? ''),
                        stderr: String(e.stderr ?? ''),
                        log: fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '',
                    };
                }
            };

            // Case 1: Only wrapper itself + language_server + renderer + crashpad + IDE running -> launches with --remote-debugging-port=0
            const cleanRun = runWrapperWithMockPs([
                `  9001 /bin/sh ${wrapperPath}`,
                '  9002 /opt/Antigravity/resources/bin/language_server_linux_x64',
                '  9003 /usr/bin/antigravity --type=renderer',
                '  9004 /snap/antigravity/42/chrome_crashpad_handler',
                '  9005 /usr/bin/antigravity-ide',
            ]);
            expect(cleanRun.code).toBe(0);
            expect(cleanRun.stdout).toContain('LAUNCHED:--remote-debugging-port=0 --extra-arg');

            // Case 2: Snap non-CDP instance running -> triggers zenity warning & exits 1 without launching/killing
            const snapConflict = runWrapperWithMockPs(
                ['  9101 /snap/antigravity/42/usr/share/antigravity/antigravity'],
                { zenity: 0 },
            );
            expect(snapConflict.code).toBe(1);
            expect(snapConflict.stdout).toBe('');
            expect(snapConflict.log).toContain('ZENITY:');
            expect(snapConflict.log).toContain('without CDP remote debugging');

            // Case 3: AppImage non-CDP instance running + zenity fails -> falls back to kdialog
            const appImageConflict = runWrapperWithMockPs(
                ['  9201 /tmp/.mount_AntigravityABC123/AppRun'],
                { zenity: 1, kdialog: 0 },
            );
            expect(appImageConflict.code).toBe(1);
            expect(appImageConflict.log).toContain('KDIALOG:');

            // Case 4: Standard non-CDP instance + zenity/kdialog fail -> falls back to notify-send
            const notifyFallback = runWrapperWithMockPs(
                ['  9301 /usr/bin/antigravity'],
                { zenity: 1, kdialog: 1, notify: 0 },
            );
            expect(notifyFallback.code).toBe(1);
            expect(notifyFallback.log).toContain('NOTIFY-SEND:');

            // Case 5: No GUI dialog tools succeed -> falls back to stderr
            const stderrFallback = runWrapperWithMockPs(
                ['  9401 /home/alice/Antigravity-1.17.10.AppImage'],
                { zenity: 1, kdialog: 1, notify: 1 },
            );
            expect(stderrFallback.code).toBe(1);
            expect(stderrFallback.stderr).toContain('Antigravity (CDP):');
            expect(stderrFallback.stderr).toContain('without CDP remote debugging');

            // Case 6: CDP-enabled instance already running -> passes through cleanly
            const cdpAlreadyRunning = runWrapperWithMockPs([
                '  9501 /snap/bin/antigravity --remote-debugging-port=0',
            ]);
            expect(cdpAlreadyRunning.code).toBe(0);
            expect(cdpAlreadyRunning.stdout).toContain('LAUNCHED:--remote-debugging-port=0 --extra-arg');
        }

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

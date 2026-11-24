import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CDP_LAUNCHER_DISPLAY_NAME,
    MACOS_CDP_LAUNCHER_BUNDLE_ID,
    buildLinuxDesktopEntry,
    buildLinuxLauncherScript,
    createCdpLauncher,
    getSafeCdpLaunchCommand,
    inspectCdpLauncher,
    removeCdpLauncher,
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

    it('creates, inspects, and removes Windows .cmd wrapper + Desktop & Start Menu .lnk shortcuts safely via execFileSync', () => {
        const fakeHome = path.join(tempRoot, 'win-home');
        const fakeLocalAppData = path.join(fakeHome, 'AppData', 'Local');
        const fakeAppData = path.join(fakeHome, 'AppData', 'Roaming');
        const fakeExe = path.join(fakeLocalAppData, 'Programs', 'Antigravity', 'Antigravity.exe');
        fs.mkdirSync(path.dirname(fakeExe), { recursive: true });
        fs.writeFileSync(fakeExe, 'mock-exe');

        const winEnv = {
            USERPROFILE: fakeHome,
            LOCALAPPDATA: fakeLocalAppData,
            APPDATA: fakeAppData,
        };

        const before = inspectCdpLauncher({ platform: 'win32', homeDir: fakeHome, env: winEnv });
        expect(before.supported).toBe(true);
        expect(before.installed).toBe(false);
        expect(before.targetAppFound).toBe(true);

        const execCalls: Array<{ file: string; args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
        const created = createCdpLauncher({
            platform: 'win32',
            homeDir: fakeHome,
            env: winEnv,
            execFileSyncFn: (file, args, options) => {
                execCalls.push({ file, args, env: options?.env });
                // Simulate PowerShell WScript.Shell creating the two .lnk files from env vars
                for (const p of [options?.env?.ACM_LNK_DESKTOP, options?.env?.ACM_LNK_STARTMENU]) {
                    if (p) {
                        fs.mkdirSync(path.dirname(p), { recursive: true });
                        fs.writeFileSync(p, 'mock-lnk', 'utf8');
                    }
                }
            },
        });

        expect(created.ok).toBe(true);
        expect(created.status.installed).toBe(true);
        expect(execCalls).toHaveLength(1);
        expect(execCalls[0].file).toBe('powershell.exe');
        expect(execCalls[0].args).toContain('-NoProfile');
        expect(execCalls[0].args).toContain('-NonInteractive');
        // Paths are passed via environment variables — NEVER interpolated into the PowerShell script string!
        const psScript = execCalls[0].args[execCalls[0].args.length - 1];
        expect(psScript).toContain('WScript.Shell');
        expect(psScript).toContain('$env:ACM_LNK_DESKTOP');
        expect(psScript).toContain('$env:ACM_LNK_STARTMENU');
        expect(psScript).not.toContain(fakeHome);

        const cmdPath = path.join(fakeLocalAppData, 'AntigravityContextMonitor', 'launch-antigravity-cdp.cmd');
        const desktopLnk = path.join(fakeHome, 'Desktop', 'Antigravity (CDP).lnk');
        const startMenuLnk = path.join(fakeAppData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Antigravity (CDP).lnk');
        expect(fs.existsSync(cmdPath)).toBe(true);
        expect(fs.existsSync(desktopLnk)).toBe(true);
        expect(fs.existsSync(startMenuLnk)).toBe(true);

        const cmdContent = fs.readFileSync(cmdPath, 'utf8');
        expect(cmdContent).toContain('\r\n');
        expect(cmdContent).toContain('--remote-debugging-port=0');
        expect(cmdContent).toContain('if not "%STATE%"=="20" goto launch_cdp');
        expect(cmdContent).toContain(':wait_loop');
        expect(cmdContent).toContain('Antigravity.exe');
        expect(cmdContent).not.toMatch(/\btaskkill\b/i);

        // Remove cleans up .lnk + .cmd + empty wrapper dir
        const removed = removeCdpLauncher({ platform: 'win32', homeDir: fakeHome, env: winEnv });
        expect(removed.ok).toBe(true);
        expect(removed.status.installed).toBe(false);
        expect(fs.existsSync(cmdPath)).toBe(false);
        expect(fs.existsSync(desktopLnk)).toBe(false);
        expect(fs.existsSync(startMenuLnk)).toBe(false);
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
    });
});

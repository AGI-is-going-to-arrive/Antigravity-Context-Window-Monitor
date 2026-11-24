import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    CDP_LAUNCHER_DISPLAY_NAME,
    MACOS_CDP_LAUNCHER_BUNDLE_ID,
    createCdpLauncher,
    getSafeCdpLaunchCommand,
    inspectCdpLauncher,
    removeCdpLauncher,
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

        // Verify race-free logic, exact Antigravity.app regex, user dialog, graceful AppleScript quit, 15s poll, and zero force-kill
        expect(launchScript).toContain('Contents/MacOS/Antigravity($| )');
        expect(launchScript).toContain('--remote-debugging-port');
        expect(launchScript).toContain('display dialog "Antigravity is currently running without CDP remote debugging. Quit & relaunch with CDP enabled?"');
        expect(launchScript).toContain('buttons {"Cancel", "Quit & Relaunch"}');
        expect(launchScript).toContain('tell application id \\"$BUNDLE_ID\\" to quit');
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
    });
});

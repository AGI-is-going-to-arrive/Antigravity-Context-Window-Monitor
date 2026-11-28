import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    LINUX_FLATPAK_APP_ID,
    buildLinuxLauncherScript,
    buildMacOsLauncherScript,
    clearWindowsLauncherCaches,
    createCdpLauncher,
} from '../../src/app/cdp-launcher';
import { createTempDirTracker } from '../helpers/factories';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INSTALLER_SH_PATH = path.join(REPO_ROOT, 'scripts', 'install-app-plugin.sh');

describe('Real-System Integration: Live OS Shell Launchers & Installer Wrapper Scripts', () => {
    const tracker = createTempDirTracker('acm-int-shell-');
    let tempRoot: string;

    beforeEach(() => {
        clearWindowsLauncherCaches();
        tempRoot = tracker.make();
    });

    afterEach(() => {
        clearWindowsLauncherCaches();
        tracker.cleanup();
    });

    it('detects Linux standard/Snap/AppImage processes (excluding antigravity-cdp) and executes non-killing dialog fallback chain (zenity -> kdialog -> notify-send -> stderr)', () => {
        if (process.platform === 'win32') { return; }

        const fakeHome = path.join(tempRoot, 'linux-adv-home');
        const fakeBinDir = path.join(fakeHome, 'opt-antigravity');
        const fakeBin = path.join(fakeBinDir, 'antigravity');
        fs.mkdirSync(fakeBinDir, { recursive: true });
        fs.writeFileSync(fakeBin, '#!/bin/sh\necho "LAUNCHED:$*"\n', 'utf8');
        fs.chmodSync(fakeBin, 0o755);

        const created = createCdpLauncher({
            platform: 'linux',
            homeDir: fakeHome,
            appPath: fakeBin,
            execFileSyncFn: () => {},
        });
        expect(created.ok).toBe(true);
        const wrapperPath = path.join(fakeHome, '.local', 'bin', 'antigravity-cdp');

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

        // Case 2: Snap non-CDP instance -> zenity warning & exit 1 without killing
        const snapConflict = runWrapperWithMockPs(
            ['  9101 /snap/antigravity/42/usr/share/antigravity/antigravity'],
            { zenity: 0 },
        );
        expect(snapConflict.code).toBe(1);
        expect(snapConflict.stdout).toBe('');
        expect(snapConflict.log).toContain('ZENITY:');
        expect(snapConflict.log).toContain('without CDP remote debugging');

        // Case 3: AppImage non-CDP instance + zenity fails -> kdialog fallback
        const appImageConflict = runWrapperWithMockPs(
            ['  9201 /tmp/.mount_AntigravityABC123/AppRun'],
            { zenity: 1, kdialog: 0 },
        );
        expect(appImageConflict.code).toBe(1);
        expect(appImageConflict.log).toContain('KDIALOG:');

        // Case 4: Standard non-CDP instance + zenity/kdialog fail -> notify-send fallback
        const notifyFallback = runWrapperWithMockPs(
            ['  9301 /usr/bin/antigravity'],
            { zenity: 1, kdialog: 1, notify: 0 },
        );
        expect(notifyFallback.code).toBe(1);
        expect(notifyFallback.log).toContain('NOTIFY-SEND:');

        // Case 5: No GUI dialog tools -> stderr fallback
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
    }, 15_000);

    it('checks ONLY the first preferred AppleLanguages entry and keeps Cancel / 取消 as default button (live bash)', () => {
        if (process.platform === 'win32') { return; }

        const mockBin = fs.mkdtempSync(path.join(tempRoot, 'mac-locale-bin-'));
        const fakeApp = path.join(tempRoot, 'Antigravity.app');
        fs.mkdirSync(path.join(fakeApp, 'Contents', 'MacOS'), { recursive: true });
        const scriptPath = path.join(tempRoot, 'launch.sh');
        fs.writeFileSync(scriptPath, buildMacOsLauncherScript(fakeApp), 'utf8');
        fs.chmodSync(scriptPath, 0o755);
        execFileSync('bash', ['-n', scriptPath], { stdio: 'pipe' });

        const osaLog = path.join(tempRoot, 'osascript.log');
        fs.writeFileSync(path.join(mockBin, 'defaults'), '#!/bin/sh\nprintf "%s\\n" "$MOCK_DEFAULTS_OUT"\n', 'utf8');
        fs.writeFileSync(path.join(mockBin, 'pgrep'), '#!/bin/sh\necho "4242"\n', 'utf8');
        fs.writeFileSync(path.join(mockBin, 'ps'), `#!/bin/sh\necho "${fakeApp}/Contents/MacOS/Antigravity"\n`, 'utf8');
        fs.writeFileSync(path.join(mockBin, 'osascript'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOCK_OSA_LOG"\necho "Cancel"\n', 'utf8');
        for (const f of ['defaults', 'pgrep', 'ps', 'osascript']) {
            fs.chmodSync(path.join(mockBin, f), 0o755);
        }

        const runWithAppleLanguages = (defaultsOut: string, extraEnv: Record<string, string> = {}) => {
            fs.rmSync(osaLog, { force: true });
            execFileSync('bash', [scriptPath], {
                env: {
                    PATH: `${mockBin}:/usr/bin:/bin`,
                    MOCK_DEFAULTS_OUT: defaultsOut,
                    MOCK_OSA_LOG: osaLog,
                    ...extraEnv,
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            return fs.readFileSync(osaLog, 'utf8');
        };

        // English FIRST, Chinese SECOND -> English dialog with default button "Cancel"
        const enLog = runWithAppleLanguages('(\n    "en-US",\n    "zh-Hans-CN",\n    "ja-JP"\n)');
        expect(enLog).toContain('default button "Cancel" cancel button "Cancel"');
        expect(enLog).not.toContain('取消');

        // Single-line ("en-GB", "zh-Hant-TW") -> English
        const singleLineEnLog = runWithAppleLanguages('("en-GB", "zh-Hant-TW")');
        expect(singleLineEnLog).toContain('default button "Cancel" cancel button "Cancel"');
        expect(singleLineEnLog).not.toContain('取消');

        // Chinese FIRST, English SECOND (even with LANG=C) -> Chinese dialog with default button "取消"
        const zhLog = runWithAppleLanguages('(\n    "zh-Hans-CN",\n    "en-US"\n)', { LANG: 'C' });
        expect(zhLog).toContain('default button "取消" cancel button "取消"');
        expect(zhLog).not.toContain('default button "Cancel"');
    });

    it('executes Flatpak Linux wrapper script cleanly and reports non-CDP Flatpak conflict without killing', () => {
        if (process.platform === 'win32') { return; }

        const fpScript = path.join(tempRoot, 'flatpak-wrapper.sh');
        fs.writeFileSync(fpScript, buildLinuxLauncherScript(`flatpak:${LINUX_FLATPAK_APP_ID}`), 'utf8');
        fs.chmodSync(fpScript, 0o755);
        execFileSync('sh', ['-n', fpScript], { stdio: 'pipe' });

        const mockBin = fs.mkdtempSync(path.join(tempRoot, 'mock-fp-bin-'));
        fs.writeFileSync(path.join(mockBin, 'ps'), '#!/bin/sh\nprintf "%s\\n" "$MOCK_PS_OUT"\n', 'utf8');
        fs.writeFileSync(path.join(mockBin, 'flatpak'), '#!/bin/sh\necho "FLATPAK_EXEC:$*"\n', 'utf8');
        fs.chmodSync(path.join(mockBin, 'ps'), 0o755);
        fs.chmodSync(path.join(mockBin, 'flatpak'), 0o755);

        const launchOut = execFileSync('/bin/sh', [fpScript, '--extra'], {
            encoding: 'utf8',
            env: { PATH: `${mockBin}:/usr/bin:/bin`, MOCK_PS_OUT: '' },
        });
        expect(launchOut.trim()).toBe(`FLATPAK_EXEC:run ${LINUX_FLATPAK_APP_ID} --remote-debugging-port=0 --extra`);

        let conflictCode = 0;
        let conflictErr = '';
        try {
            execFileSync('/bin/sh', [fpScript], {
                encoding: 'utf8',
                env: {
                    PATH: `${mockBin}:/usr/bin:/bin`,
                    ACM_EXIT_WAIT_TICKS: '0',
                    MOCK_PS_OUT: '  8123 /app/extra/antigravity/antigravity',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (err: unknown) {
            const e = err as { status?: number; stderr?: string };
            conflictCode = e.status ?? 1;
            conflictErr = String(e.stderr ?? '');
        }
        expect(conflictCode).toBe(1);
        expect(conflictErr).toContain('without CDP remote debugging');
    });

    it('runs install-app-plugin.sh live under bash and selects bundled agy-node v22 over obsolete system node v18 on PATH', () => {
        if (process.platform === 'win32') { return; }

        execFileSync('bash', ['-n', INSTALLER_SH_PATH], { stdio: 'pipe' });

        const shTestDir = fs.mkdtempSync(path.join(tempRoot, 'sh-node-ver-'));
        const fakeHome = path.join(shTestDir, 'home');
        const oldBinDir = path.join(shTestDir, 'old-bin');
        const bundledBinDir = path.join(fakeHome, '.gemini', 'bin');
        const scriptCopyDir = path.join(shTestDir, 'scripts');
        fs.mkdirSync(oldBinDir, { recursive: true });
        fs.mkdirSync(bundledBinDir, { recursive: true });
        fs.mkdirSync(scriptCopyDir, { recursive: true });

        fs.copyFileSync(INSTALLER_SH_PATH, path.join(scriptCopyDir, 'install-app-plugin.sh'));
        fs.chmodSync(path.join(scriptCopyDir, 'install-app-plugin.sh'), 0o755);
        fs.writeFileSync(path.join(scriptCopyDir, 'install-app-plugin.mjs'), '// sentinel\n', 'utf8');

        fs.writeFileSync(
            path.join(oldBinDir, 'node'),
            '#!/bin/sh\nif [ "$1" = "-v" ]; then echo "v18.20.4"; exit 0; fi\necho "WRONG_OLD_NODE:$*"\nexit 99\n',
            'utf8',
        );
        fs.chmodSync(path.join(oldBinDir, 'node'), 0o755);

        fs.writeFileSync(
            path.join(bundledBinDir, 'agy-node'),
            '#!/bin/sh\nif [ "$1" = "-v" ]; then echo "v22.14.0"; exit 0; fi\necho "SELECTED_BUNDLED_AGY_NODE:$*"\nexit 0\n',
            'utf8',
        );
        fs.chmodSync(path.join(bundledBinDir, 'agy-node'), 0o755);

        const utilBin = path.join(shTestDir, 'util-bin');
        fs.mkdirSync(utilBin, { recursive: true });
        for (const tool of ['head', 'dirname', 'pwd', 'bash']) {
            for (const dir of ['/usr/bin', '/bin']) {
                const candidate = path.join(dir, tool);
                if (fs.existsSync(candidate)) {
                    fs.symlinkSync(candidate, path.join(utilBin, tool));
                    break;
                }
            }
        }

        // A failed version probe may still print a plausible version to stdout.
        const failingBinDir = path.join(shTestDir, 'broken-bin');
        fs.mkdirSync(failingBinDir);
        fs.writeFileSync(path.join(failingBinDir, 'node'), '#!/bin/sh\necho v22.0.0\nexit 12\n', { mode: 0o755 });
        const stdout = execFileSync('bash', [path.join(scriptCopyDir, 'install-app-plugin.sh'), '--status'], {
            encoding: 'utf8',
            env: {
                HOME: fakeHome,
                XDG_DATA_HOME: 'relative/invalid/xdg',
                PATH: `${failingBinDir}:${oldBinDir}:${utilBin}`,
            },
        });
        expect(stdout).toContain('SELECTED_BUNDLED_AGY_NODE:');
        expect(stdout).toContain('--status');
        expect(stdout).not.toContain('WRONG_OLD_NODE');
    });

    it('executes Linux AppImage truncated mount (/tmp/.mount_Antigr*) conflict notice in ZH locale under /bin/sh', () => {
        if (process.platform === 'win32') { return; }

        const fakeHome = path.join(tempRoot, 'linux-xdg-home');
        const xdgDataHome = path.join(tempRoot, 'custom-xdg-data');
        const created = createCdpLauncher({
            platform: 'linux',
            homeDir: fakeHome,
            env: { HOME: fakeHome, XDG_DATA_HOME: xdgDataHome },
        });
        expect(created.ok).toBe(true);

        const wrapperPath = path.join(fakeHome, '.local', 'bin', 'antigravity-cdp');
        const mockBin = fs.mkdtempSync(path.join(tempRoot, 'mock-linux-zh-'));
        fs.writeFileSync(
            path.join(mockBin, 'ps'),
            '#!/bin/sh\necho "  9876 /tmp/.mount_AntigrA1B2C3/antigravity"\n',
            'utf8',
        );
        fs.chmodSync(path.join(mockBin, 'ps'), 0o755);

        let zhStderr = '';
        let zhCode = 0;
        try {
            execFileSync('/bin/sh', [wrapperPath], {
                encoding: 'utf8',
                env: {
                    PATH: `${mockBin}:/usr/bin:/bin`,
                    ACM_EXIT_WAIT_TICKS: '0',
                    LANG: 'zh_CN.UTF-8',
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (err: unknown) {
            const e = err as { status?: number; stderr?: string };
            zhCode = e.status ?? 1;
            zhStderr = String(e.stderr ?? '');
        }
        expect(zhCode).toBe(1);
        expect(zhStderr).toContain('未开启 CDP 远程调试');
    });
});

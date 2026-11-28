import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getHostBridgeScript } from '../src/app/host-bridge';
import { injectSidecarHeadAndScripts, isCommandAllowedForScope } from '../src/app/sidecar-server';
import { getThemeAdapterStyles } from '../src/app/theme-adapter';
import { createSidecarRuntimeProvider, type SidecarDocumentParams, type SidecarRuntimeProvider } from '../src/app/sidecar-runtime';
import {
    buildAllowlistedHandoffV2,
    buildCompactionRecoveryEventKey,
    buildRedactedDiagnostics,
    buildSettingsBackupJson,
    CompactionRecoveryBriefTracker,
    formatCompactionRecoveryBriefForPrivacy,
    parseAndValidateSettingsBackup,
    SETTINGS_BACKUP_MAX_BYTES,
} from '../src/app/sidecar-types';
import { DailyStore } from '../src/daily-store';
import { acquireFencedLockFile, DEFAULT_APP_SETTINGS, DurableState, normalizeAppSettings } from '../src/durable-state';
import { buildIdePublishedObservation, resolveMonitorCommandDestination } from '../src/extension';
import { getCurrentIdePanelHostNonce, ideCdpLauncherActions, showMonitorPanel, updateMonitorPanel } from '../src/webview-panel';
import { createFastDurableState } from './helpers/factories';

describe('v1.18.0 Wave 1 Core Bridge, Theme, IDE IPC, Onboarding & Audit Regressions', () => {
    const tmpDirs: string[] = [];
    const providers: SidecarRuntimeProvider[] = [];

    function makeTmpDir(prefix = 'acm-v118-audit-'): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        tmpDirs.push(dir);
        return dir;
    }

    afterEach(async () => {
        while (providers.length > 0) {
            await providers.pop()!.dispose().catch(() => {});
        }
        while (tmpDirs.length > 0) {
            fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
        }
    });

    it('P0-1: injectSidecarHeadAndScripts does not corrupt $& / $&& / $$ / $\' / </script> in minified bridge and fills blank #tab-overview', () => {
        const minifiedWithDollar = 'var $=y.command||y.type||"";$&&(O[$]=!0);var t="$$ $\' $` </script>";';
        const rawHtml = '<!DOCTYPE html><html><head><title>T</title></head><body><main id="monitor-content"><div class="tab-pane active" id="tab-overview">   </div></main></body></html>';
        const injected = injectSidecarHeadAndScripts(rawHtml, {
            viewMode: 'aux',
            hostBridgeScript: minifiedWithDollar,
        });

        // Exactly ONE </head> tag (never corrupted into </head>&)
        expect((injected.match(/<\/head>/gi) || []).length).toBe(1);
        expect(injected).not.toContain('</head>&');
        expect(injected).toContain('$&&(O[$]=!0)');

        // Extract bridge script tag and verify valid JS syntax
        const match = injected.match(/<script data-acm-host-bridge="true">([\s\S]*?)<\/script>/);
        expect(match).not.toBeNull();
        expect(() => new vm.Script(match![1])).not.toThrow();

        // Empty #tab-overview receives non-blank initializing fallback
        expect(injected).toContain('data-acm-initializing="true"');
    });

    it('P1-2: theme-adapter defines complete light @media fallback and full dark tokens', () => {
        const css = getThemeAdapterStyles();
        const mediaStart = css.indexOf('@media (prefers-color-scheme: light)');
        expect(mediaStart).toBeGreaterThan(-1);
        const mediaSlice = css.slice(mediaStart);
        for (const token of [
            '--ed-bg:', '--ed-surface:', '--ed-surface-well:', '--ed-surface-overlay:',
            '--ed-input-bg:', '--ed-track:', '--ed-ink:', '--ed-ink-secondary:',
            '--ed-ink-muted:', '--ed-border:', '--vscode-editor-background:', '--vscode-foreground:',
        ]) {
            expect(mediaSlice).toContain(token);
        }
        const darkStart = css.indexOf('body[data-acm-theme="dark"]');
        const lightStart = css.indexOf('body[data-acm-theme="light"]');
        const darkSlice = css.slice(darkStart, lightStart);
        expect(darkSlice).toContain('--vscode-editor-background:');
        expect(darkSlice).toContain('--ed-input-bg:');
        expect(darkSlice).toContain('--ed-ink-secondary:');
    });

    it('P1-1/P1-2/P2-4: host-bridge parses hsl/bare-hsl/oklch/color(), accepts trusted parent theme-change, observes :root mutations, and replays cached snapshot on panelReady', async () => {
        const script = getHostBridgeScript({ autoPoll: false });
        expect(() => new vm.Script(script)).not.toThrow();

        const rootProps: Record<string, string> = {};
        const bodyAttrs: Record<string, string> = {};
        const bodyClasses = new Set<string>();
        const winListeners: Record<string, Array<(ev: any) => void>> = {};
        const mutationCallbacks: Array<() => void> = [];
        const fetchCalls: Array<{ url: string; opts: any; resolve: (v: any) => void; reject: (e: any) => void }> = [];
        const parentWin = { __isParent: true };
        const evilWin = { __isEvil: true };
        let currentThemeMqLight = false;

        const doc: any = {
            readyState: 'complete',
            hidden: false,
            documentElement: {
                style: {
                    setProperty: (k: string, v: string) => { rootProps[k] = v; },
                    getPropertyValue: (k: string) => rootProps[k] || '',
                },
                getAttribute: (k: string) => bodyAttrs[`html:${k}`] ?? null,
                setAttribute: (k: string, v: string) => { bodyAttrs[`html:${k}`] = v; },
                className: '',
            },
            body: {
                getAttribute: (k: string) => bodyAttrs[k] ?? null,
                setAttribute: (k: string, v: string) => { bodyAttrs[k] = v; },
                classList: {
                    toggle: (cls: string, force?: boolean) => {
                        if (force) { bodyClasses.add(cls); } else { bodyClasses.delete(cls); }
                    },
                },
                style: {},
            },
            getElementById: () => null,
            addEventListener: () => {},
        };

        const win: any = {
            document: doc,
            parent: parentWin,
            location: { origin: 'http://127.0.0.1:41234', href: 'http://127.0.0.1:41234/', pathname: '/', search: '' },
            URL,
            URLSearchParams,
            MutationObserver: class {
                private cb: () => void;
                constructor(cb: () => void) { this.cb = cb; }
                observe() { mutationCallbacks.push(this.cb); }
                disconnect() {}
            },
            matchMedia: (q: string) => ({
                matches: q.includes('prefers-color-scheme: light') ? currentThemeMqLight : false,
                addEventListener: () => {},
            }),
            getComputedStyle: () => ({ getPropertyValue: (k: string) => rootProps[k] || '' }),
            addEventListener: (type: string, fn: (ev: any) => void) => {
                (winListeners[type] ||= []).push(fn);
            },
            dispatchEvent: (ev: any) => {
                for (const fn of winListeners[ev.type] || []) { fn(ev); }
            },
            sidecar: {
                fetch: (url: string, opts: any) => new Promise((resolve, reject) => {
                    fetchCalls.push({ url, opts, resolve, reject });
                }),
            },
            setTimeout,
            clearTimeout,
        };
        win.window = win;
        win.self = win;

        vm.runInNewContext(script, {
            window: win,
            document: doc,
            URL,
            URLSearchParams,
            MutationObserver: win.MutationObserver,
            setTimeout,
            clearTimeout,
            Promise,
        });

        expect(win.__ACM_BRIDGE__).toBeDefined();
        expect(bodyAttrs['data-acm-theme']).toBe('dark');

        // Reject evil foreign window & external origin theme-change
        for (const fn of winListeners.message || []) {
            fn({ source: evilWin, origin: 'https://evil.example', data: { type: 'theme-change', payload: { cssVariables: { '--background': '#ffffff' } } } });
            fn({ source: parentWin, origin: 'https://evil.example', data: { type: 'theme-change', payload: { cssVariables: { '--background': '#ffffff' } } } });
        }
        expect(rootProps['--background']).toBeUndefined();
        expect(bodyAttrs['data-acm-theme']).toBe('dark');

        // Accept trusted parent plugin:// theme-change with modern oklch() light background
        for (const fn of winListeners.message || []) {
            fn({ source: parentWin, origin: 'plugin://antigravity-context-monitor', data: { type: 'theme-change', payload: { cssVariables: { '--background': 'oklch(0.985 0.002 247)' } } } });
        }
        expect(bodyAttrs['data-acm-theme']).toBe('light');

        // Direct :root mutation via /preload.js with bare shadcn dark HSL triplet triggers MutationObserver
        rootProps['--background'] = '222.2 84% 4.9%';
        for (const cb of mutationCallbacks) { cb(); }
        expect(bodyAttrs['data-acm-theme']).toBe('dark');

        // color(srgb 0.99 0.99 0.99) -> light
        rootProps['--background'] = 'color(srgb 0.99 0.99 0.99)';
        for (const cb of mutationCallbacks) { cb(); }
        expect(bodyAttrs['data-acm-theme']).toBe('light');

        // Transparent rgba(0, 0, 0, 0) must NOT falsely force dark when OS is light
        currentThemeMqLight = true;
        rootProps['--background'] = 'rgba(0, 0, 0, 0)';
        for (const cb of mutationCallbacks) { cb(); }
        expect(bodyAttrs['data-acm-theme']).toBe('light');

        // Pre-mount hydration: cached snapshot replayed immediately on panelReady, and in-flight poll queues forceFull
        const receivedUpdates: any[] = [];
        win.addEventListener('message', (ev: any) => {
            if (ev.data?.command === 'updateTabs') { receivedUpdates.push(ev.data); }
        });
        const p1 = win.__ACM_BRIDGE__.pollNow(false);
        expect(fetchCalls).toHaveLength(1);
        // Trigger panelReady while p1 is still in-flight -> must queue pendingForceFullPoll
        void win.__ACM_BRIDGE__.sendAction({ command: 'panelReady' });
        fetchCalls.shift()!.resolve({
            ok: true,
            status: 200,
            json: async () => ({
                unchanged: false,
                hash: 'h1',
                snapshot: { tabs: { overview: '<p>hello</p>' }, time: '12:00' },
            }),
        });
        await p1;
        await new Promise(r => setTimeout(r, 10));
        expect(receivedUpdates.length).toBeGreaterThanOrEqual(1);
        expect(fetchCalls).toHaveLength(1); // Queued forceFull poll fired on settle!
        fetchCalls.shift()!.resolve({ ok: true, status: 304, headers: { get: () => '"h1"' } });
    });

    it('P0-2: resolveMonitorCommandDestination supports all 18 aliases and showMonitorPanel authenticates messages with per-panel nonce + reliable secondary tab switch', () => {
        for (const alias of [
            'overview', 'gm', 'gmdata', 'gm-data', 'activity',
            'sessions', 'chats', 'chat-history', 'calendar', 'usage',
            'cost', 'pricing', 'models', 'profile', 'account', 'accounts',
            'settings', 'about',
        ]) {
            expect(resolveMonitorCommandDestination(alias)).toBe(alias);
            expect(resolveMonitorCommandDestination([alias])).toBe(alias);
            expect(resolveMonitorCommandDestination({ tab: alias })).toBe(alias);
            expect(resolveMonitorCommandDestination(`#tab-${alias}`)).toBe(alias);
        }
        expect(resolveMonitorCommandDestination('unknown-tab')).toBe('overview');
        expect(resolveMonitorCommandDestination(null)).toBe('overview');

        const posted: any[] = [];
        let onMsgCb: ((msg: any) => void) | undefined;
        let onViewStateCb: ((e: any) => void) | undefined;
        let onDisposeCb: (() => void) | undefined;
        const fakePanel: any = {
            visible: true,
            active: true,
            title: '',
            webview: {
                html: '',
                postMessage: (m: any) => { posted.push(m); return Promise.resolve(true); },
                onDidReceiveMessage: (cb: any) => { onMsgCb = cb; return { dispose: () => {} }; },
            },
            reveal: vi.fn(() => { fakePanel.visible = true; }),
            onDidChangeViewState: (cb: any) => { onViewStateCb = cb; return { dispose: () => {} }; },
            onDidDispose: (cb: any) => { onDisposeCb = cb; return { dispose: () => {} }; },
            dispose: () => { onDisposeCb?.(); },
        };
        const createSpy = vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(fakePanel);

        try {
            const basePayload: any = {
                currentUsage: null,
                allTrajectoryUsages: [],
                modelConfigs: [],
                userInfo: null,
                initialTab: 'overview',
            };
            showMonitorPanel(basePayload);
            const nonce = getCurrentIdePanelHostNonce();
            expect(nonce).toMatch(/^[a-f0-9]{48}$/);
            // Nonce passed via one-shot closure script, NEVER via DOM data attribute
            expect(fakePanel.webview.html).toContain('__ACM_CONSUME_HOST_NONCE__');
            expect(fakePanel.webview.html).not.toMatch(/data-[a-z-]+="[^"]*[a-f0-9]{48}/);

            // Secondary tab jump while panel was hidden -> reveal flips visible=true -> sends switchToTab WITH nonce AFTER updateTabs
            fakePanel.visible = false;
            posted.length = 0;
            showMonitorPanel({ ...basePayload, initialTab: 'models' });
            const switchIdx = posted.findIndex(m => m.command === 'switchToTab' && m.tab === 'models');
            const updateIdx = posted.findIndex(m => m.command === 'updateTabs');
            expect(updateIdx).toBeGreaterThanOrEqual(0);
            expect(switchIdx).toBeGreaterThan(updateIdx);
            expect(posted[switchIdx].__acmHostNonce).toBe(nonce);
            const reqId = posted[switchIdx].requestId;

            // Unacknowledged pendingTab retries on updateMonitorPanel & onDidChangeViewState
            posted.length = 0;
            updateMonitorPanel(basePayload);
            expect(posted.some(m => m.command === 'switchToTab' && m.requestId === reqId)).toBe(true);

            // Once tabShown acknowledges requestId, no further switchToTab retries
            onMsgCb?.({ command: 'tabShown', requestId: reqId });
            posted.length = 0;
            onViewStateCb?.({ webviewPanel: { visible: true, active: true } });
            expect(posted.some(m => m.command === 'switchToTab')).toBe(false);
        } finally {
            onDisposeCb?.();
            expect(getCurrentIdePanelHostNonce()).toBe('');
            createSpy.mockRestore();
        }
    });

    it('Onboarding: AppSettings.appOnboardingDismissed defaults false, persists across restarts, and updates via dismissAppOnboarding / updateAppSettings', async () => {
        expect(DEFAULT_APP_SETTINGS.appOnboardingDismissed).toBe(false);
        expect(normalizeAppSettings({}).appOnboardingDismissed).toBe(false);
        expect(normalizeAppSettings({ appOnboardingDismissed: true }).appOnboardingDismissed).toBe(true);
        expect(isCommandAllowedForScope('standalone', 'dismissAppOnboarding')).toBe(true);
        expect(isCommandAllowedForScope('standalone', 'updateAppSettings')).toBe(true);

        const dir = makeTmpDir();
        const statePath = path.join(dir, 'state-v1.json');
        let capturedParams: SidecarDocumentParams | null = null;

        const p1 = createSidecarRuntimeProvider({
            statePath,
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            renderDocument: (params) => { capturedParams = params; return '<html></html>'; },
            deps: { homedir: () => dir, discoverLS: async () => null },
        });
        providers.push(p1);

        expect(p1.getAppSettings().appOnboardingDismissed).toBe(false);
        const dismissRes = await p1.handleAction({ command: 'dismissAppOnboarding' });
        expect(dismissRes.ok).toBe(true);
        expect(dismissRes.result).toMatchObject({ appOnboardingDismissed: true, dismissed: true, committed: true });
        expect(dismissRes.messages?.some(m => m.command === 'appOnboardingDismissed' && m.dismissed === true)).toBe(true);

        await p1.renderHtml({ viewMode: 'aux' });
        expect(capturedParams!.appSettings?.appOnboardingDismissed).toBe(true);
        await p1.dispose();
        providers.pop();

        // Reload fresh provider from same disk file -> persisted!
        const p2 = createSidecarRuntimeProvider({
            statePath,
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: { homedir: () => dir, discoverLS: async () => null },
        });
        providers.push(p2);
        expect(p2.getAppSettings().appOnboardingDismissed).toBe(true);

        // Toggle back via updateAppSettings
        const upd = await p2.handleAction({ command: 'updateAppSettings', patch: { appOnboardingDismissed: false } });
        expect(upd.ok).toBe(true);
        expect(p2.getAppSettings().appOnboardingDismissed).toBe(false);
    });

    it('P1-6 & P1-7: DurableState preserves concurrent appSettings edits during flush and recovers from empty lock / dead .reclaim guard', async () => {
        const dir = makeTmpDir();
        const statePath = path.join(dir, 'state-v1.json');
        const lockPath = `${statePath}.lock`;

        // P1-7: Dead-PID lock + dead-PID .reclaim guard are both recovered cleanly, and new locks publish owner metadata atomically
        fs.writeFileSync(lockPath, `88888888:${Date.now() - 60_000}:deadlock:local\n`, 'utf8');
        fs.writeFileSync(`${lockPath}.reclaim`, `99999999:${Date.now() - 60_000}:deadbeef:local\n`, 'utf8');

        const handle = await acquireFencedLockFile(lockPath, {
            staleMs: 100,
            timeoutMs: 2000,
            isPidAlive: () => false,
            hostId: 'local',
        });
        expect(await handle.verifyOwned()).toBe(true);
        expect(fs.readFileSync(lockPath, 'utf8')).toContain(String(process.pid));
        await handle.release();

        // P1-6: Concurrent second appSettings edit while flush N is waiting on disk merge must NOT lose edit N
        const ds1 = createFastDurableState(statePath);
        await ds1.patchAppSettingsWithReceipt({ pollingInterval: 10 });
        await ds1.flush();

        // External process writes another field directly on disk
        const diskObj = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        diskObj.global.appSettings.quotaNotificationThreshold = 33;
        fs.writeFileSync(statePath, JSON.stringify(diskObj), 'utf8');

        const pA = ds1.patchAppSettingsWithReceipt({ appOnboardingDismissed: true });
        const flushA = ds1.flush();
        // Immediately mutate another field before flushA finishes
        const pB = ds1.patchAppSettingsWithReceipt({ showSpeed: true });
        const [rA, rB] = await Promise.all([pA, pB, flushA]);
        await ds1.flush();
        expect(rA.receipt.committed).toBe(true);
        expect(rB.receipt.committed).toBe(true);

        const reloaded = new DurableState(statePath);
        const finalSettings = reloaded.getAppSettings();
        expect(finalSettings.quotaNotificationThreshold).toBe(33);
        expect(finalSettings.appOnboardingDismissed).toBe(true);
        expect(finalSettings.showSpeed).toBe(true);
    });

    it('P1-10/P1-11/P1-12/P2-16/P2-17: privacy redaction, DailyStore validation, diagnostics pool allowlist & backup 64 KiB contract', () => {
        // P1-10: Recovery Brief eventKey never embeds raw secret branch name, and masked formatter strips it from summary
        const key = buildCompactionRecoveryEventKey({
            cascadeId: 'c-1',
            model: 'M37',
            role: 'single',
            branch: 'feat/top-secret-client-branch',
            eventStepOrTimestamp: 42,
        });
        expect(key).not.toContain('top-secret-client-branch');
        const tracker = new CompactionRecoveryBriefTracker();
        const brief = tracker.evaluate({
            cascadeId: 'c-1',
            model: 'M37',
            branch: 'feat/top-secret-client-branch',
            stepCount: 42,
            previousTokens: 120_000,
            currentTokens: 20_000,
            compressionDetected: true,
            privacyMasked: false,
        });
        expect(brief).not.toBeNull();
        expect(brief!.eventKey).toBe(key);
        const maskedBrief = formatCompactionRecoveryBriefForPrivacy(brief!, { privacyMasked: true, lang: 'en' });
        expect(maskedBrief.branch).toBe('[Redacted Branch]');
        expect(maskedBrief.summaryText).not.toContain('top-secret-client-branch');

        // P1-11: Masked Handoff v2 omits free-text title
        const maskedHandoff = buildAllowlistedHandoffV2({
            subjectCascadeId: 'abcdef123456',
            title: 'SECRET_PROJECT_TITLE_XYZ',
            privacyMasked: true,
        });
        expect(maskedHandoff.previewText).not.toContain('SECRET_PROJECT_TITLE_XYZ');

        // P1-12: DailyStore rejects XSS/malformed date keys and sanitizes NaN/negative numbers
        const store = new DailyStore(365);
        const added = store.mergeRecords({
            version: 1,
            records: {
                '2026-04-01"><img src=x onerror=alert(1)>': { date: 'bad', cycles: [] },
                '2026-02-31': { date: '2026-02-31', cycles: [] },
                '2026-04-02': {
                    date: '2026-04-02',
                    cycles: [{
                        startTime: '2026-04-02T00:00:00',
                        endTime: '2026-04-02T23:59:59',
                        totalReasoning: Number.NaN,
                        totalToolCalls: -5,
                        totalErrors: 2,
                        totalInputTokens: 100,
                        totalOutputTokens: 50,
                        estSteps: 3,
                        modelNames: ['M37'],
                        gmTotalCalls: '10<script>' as unknown as number,
                    }],
                },
            },
        });
        expect(added).toBe(1);
        expect(store.totalDays).toBe(1);
        const rec = store.getRecord('2026-04-02')!;
        expect(rec.cycles[0].totalReasoning).toBe(0);
        expect(rec.cycles[0].totalToolCalls).toBe(0);
        expect(rec.cycles[0].gmTotalCalls).toBeUndefined();

        // P2-16: Redacted diagnostics allowlists public pools and aliases unknown internal pool names
        const diag = buildRedactedDiagnostics({
            surface: 'app-sidecar',
            version: '1.18.0',
            counters: {},
            quotaRunway: [
                { poolKey: 'gemini', status: 'safe' },
                { poolKey: 'Internal Secret Enterprise Pool', status: 'at_risk' },
            ],
        });
        expect(diag.json).not.toContain('Enterprise');
        expect(diag.json).not.toContain('Internal');
        expect((diag.diagnostics.quotaRunway as Array<{ poolKey: string }>).map(r => r.poolKey)).toEqual(['gemini', 'pool_1']);

        // P2-17: Settings backup switches to compact JSON to stay within 64 KiB and re-imports cleanly
        const bigPricing: Record<string, { input: number; output: number; cacheRead: number }> = {};
        for (let i = 0; i < 250; i++) {
            bigPricing[`MODEL_CUSTOM_${String(i).padStart(3, '0')}_${'X'.repeat(60)}`] = {
                input: 1.5,
                output: 6.0,
                cacheRead: 0.15,
            };
        }
        const built = buildSettingsBackupJson({ displayCurrency: 'CAD' }, bigPricing);
        expect(Buffer.byteLength(built.json, 'utf8')).toBeLessThanOrEqual(SETTINGS_BACKUP_MAX_BYTES);
        expect(parseAndValidateSettingsBackup(built.json).ok).toBe(true);
    });

    it('P1-14: ideCdpLauncherActions.create handles win32 shortcuts and macOS ~/Applications permission fallback', () => {
        // Windows creation via injected runner
        const winHome = makeTmpDir('acm-win-cdp-');
        const desktopDir = path.join(winHome, 'Desktop');
        const startMenuDir = path.join(winHome, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
        const execCalls: Array<{ file: string; args: readonly string[] }> = [];
        const winRes = ideCdpLauncherActions.create({
            platform: 'win32',
            homeDir: winHome,
            desktopDir,
            env: {
                USERPROFILE: winHome,
                LOCALAPPDATA: path.join(winHome, 'AppData', 'Local'),
                APPDATA: path.join(winHome, 'AppData', 'Roaming'),
            },
            execFileSyncFn: (file: string, args: readonly string[], execOpts?: Record<string, unknown>) => {
                execCalls.push({ file, args });
                const env = execOpts?.env as Record<string, string>;
                fs.mkdirSync(path.dirname(env.ACM_LNK_DESKTOP), { recursive: true });
                fs.writeFileSync(env.ACM_LNK_DESKTOP, '--remote-debugging-port=0', 'utf8');
                fs.mkdirSync(startMenuDir, { recursive: true });
                fs.writeFileSync(env.ACM_LNK_STARTMENU, '--remote-debugging-port=0', 'utf8');
                return '';
            },
        } as any);
        expect(execCalls).toHaveLength(1);
        expect(execCalls[0].file).toBe('powershell.exe');
        expect(winRes.ok).toBe(true);

        // macOS ~/Applications fallback when /Applications is unwritable (simulated via unwritable systemAppsDir)
        const macHome = makeTmpDir('acm-mac-cdp-');
        const readonlySys = path.join(macHome, 'ro-apps');
        fs.mkdirSync(readonlySys, { recursive: true });
        if (process.platform !== 'win32') {
            fs.chmodSync(readonlySys, 0o555);
            try {
                const macRes = ideCdpLauncherActions.create({
                    platform: 'darwin',
                    homeDir: macHome,
                    systemAppsDir: readonlySys,
                    appPath: '/Applications/Antigravity.app',
                });
                expect(macRes.ok).toBe(true);
                expect(macRes.status.launcherPath).toContain(path.join(macHome, 'Applications', 'Antigravity (CDP).app'));
            } finally {
                fs.chmodSync(readonlySys, 0o755);
            }
        }
    });

    it('P2-3: App Sidecar scopes privacyMasked per windowId (unmasking win-1 never reveals win-2)', async () => {
        const dir = makeTmpDir();
        const provider = createSidecarRuntimeProvider({
            statePath: path.join(dir, 'state-v1.json'),
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: { homedir: () => dir, discoverLS: async () => null },
        });
        providers.push(provider);

        // Unmask win-1 only
        const unm = await provider.handleAction({ command: 'setPrivacyMask', windowId: 'win-1', masked: false });
        expect(unm.ok).toBe(true);
        const snap1 = await provider.getSnapshot({ viewMode: 'aux', windowId: 'win-1' });
        const snap2 = await provider.getSnapshot({ viewMode: 'aux', windowId: 'win-2' });
        expect(snap1.privacyMasked).toBe(false);
        expect(snap2.privacyMasked).toBe(true);
    });

    it('P0-3 handoff (#8/#9): suffixRecovered + lastModelUsage publishes live context while non-recovered hasGaps stays incomplete', async () => {
        // IDE observation test
        const baseUsage: any = {
            cascadeId: 'conv-huge-1',
            title: 'Huge 2500-step session',
            model: 'MODEL_PLACEHOLDER_M37',
            modelDisplayName: 'Gemini 3.1 Pro (High)',
            contextUsed: 128_000,
            totalOutputTokens: 4_000,
            totalToolCallOutputTokens: 0,
            contextLimit: 256_000,
            usagePercent: 50,
            stepCount: 2500,
            lastModifiedTime: new Date().toISOString(),
            status: 'CASCADE_RUN_STATUS_IDLE',
            isEstimated: false,
            estimatedDeltaSinceCheckpoint: 0,
            imageGenStepCount: 0,
            imageGenerationModels: [],
            imageGenerationIncomplete: false,
            compressionDetected: false,
            checkpointCompressionDrop: 0,
            hasGaps: true,
            lastModelUsage: { model: 'MODEL_PLACEHOLDER_M37', inputTokens: 128_000, outputTokens: 1000, cacheReadTokens: 0 },
            createdTime: '',
            lastUserInputTime: '',
            lastUserInputStepIndex: 0,
            repositoryName: '',
            gitOriginUrl: '',
            branchName: '',
            gitRootUri: '',
        };
        const nonRecoveredObs = buildIdePublishedObservation(baseUsage, { summary: null });
        expect(nonRecoveredObs!.isIncomplete).toBe(true);
        expect(nonRecoveredObs!.primaryPct).toBeNull();

        const recoveredObs = buildIdePublishedObservation({ ...baseUsage, suffixRecovered: true }, { summary: null });
        expect(recoveredObs!.isIncomplete).toBe(false);
        expect(recoveredObs!.usedTokens).toBe(128_000);
        expect(recoveredObs!.primaryPct).toBeGreaterThan(0);

        // App Sidecar runtime test
        const dir = makeTmpDir();
        const tr: any = {
            cascadeId: 'conv-huge-1',
            summary: 'Huge session',
            stepCount: 2500,
            lastModifiedTime: new Date().toISOString(),
            status: 'CASCADE_RUN_STATUS_IDLE',
            requestedModel: 'MODEL_PLACEHOLDER_M37',
        };
        const provider = createSidecarRuntimeProvider({
            statePath: path.join(dir, 'state-v1.json'),
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            deps: {
                homedir: () => dir,
                discoverLS: async () => ({ pid: 1, port: 12345, csrfToken: 'tok', useTls: false, hostname: '127.0.0.1', surface: 'app', source: 'hub-file' }),
                fetchFullUserStatus: async () => ({ ok: true, configs: [], userInfo: null }),
                getAllTrajectories: async () => [tr],
                getContextUsage: async () => ({ ...baseUsage, suffixRecovered: true }),
                fetchTrajectoryGeneratorMetadataResult: async () => ({ ok: true, metadata: [] }),
                fetchTrajectorySteps: async () => ({ ok: true, steps: [], hasGaps: true }),
                fetchOrchestratorSettings: async () => null,
                fetchUserQuotaSummary: async () => null,
                fetchAvailableModels: async () => null,
            },
        });
        providers.push(provider);
        await provider.pollNow(true);
        const appObs = provider.getLatestObservation()!;
        expect(appObs.isIncomplete).toBe(false);
        expect(appObs.usedTokens).toBe(128_000);
    });
});

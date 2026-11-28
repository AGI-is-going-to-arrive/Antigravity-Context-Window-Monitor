// Wave 3.5 Backend Polish Regression Suite (R2-P0-1 through R2-P2-11)
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ActivityTracker } from '../src/activity/tracker';
import { applyAppPluginUpdate } from '../src/app/plugin-updater';
import {
    createSidecarRuntimeProvider,
    type SidecarRuntimeProvider,
} from '../src/app/sidecar-runtime';
import { MAX_ACTION_BODY_BYTES } from '../src/app/sidecar-server';
import { CascadeStatus, StepType } from '../src/constants';
import {
    acquirePluginUpdateLock,
    validateExtractedPluginBundle,
} from '../src/core/release-security';
import {
    DEFAULT_SWARM_POLL_BUDGET,
    withTrajectoryPollBudget,
} from '../src/core/swarm-registry';
import {
    aggregateWorkspaceLeaderboard,
    cloneWorkspaceBreakdown,
} from '../src/daily-ledger';
import { DailyStore } from '../src/daily-store';
import type { LSInfo } from '../src/discovery';
import {
    acquireFencedLockFile,
    DurableState,
} from '../src/durable-state';
import { readGlobalRulesStatus } from '../src/global-rules';
import { slimCallForPersistence, type GMCallEntry } from '../src/gm/types';
import type { GMSummary } from '../src/gm-tracker';
import { mergeSerializedQuotaRunwayStates, QuotaRunwayTracker } from '../src/quota-runway';
import { fetchTrajectorySteps, getContextUsage, type TrajectorySummary } from '../src/tracker';
import { getCurrentIdePanelHostNonce, showMonitorPanel } from '../src/webview-panel';
import { createFastDurableState } from './helpers/factories';

describe('[wave35-backend-polish]', () => {
    const tmpDirs: string[] = [];
    const providers: SidecarRuntimeProvider[] = [];
    const servers: http.Server[] = [];

    function makeTmpDir(prefix = 'acm-w35-'): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        tmpDirs.push(dir);
        return dir;
    }

    async function withHttpServer(
        handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
        fn: (ls: LSInfo) => Promise<void>,
    ): Promise<void> {
        const server = http.createServer(handler);
        servers.push(server);
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => resolve());
        });
        const port = (server.address() as AddressInfo).port;
        const ls: LSInfo = {
            pid: 4242,
            port,
            csrfToken: 'test-csrf',
            useTls: false,
            hostname: '127.0.0.1',
        };
        try {
            await fn(ls);
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
            const idx = servers.indexOf(server);
            if (idx >= 0) { servers.splice(idx, 1); }
        }
    }

    afterEach(async () => {
        vi.restoreAllMocks();
        while (providers.length > 0) {
            await providers.pop()!.dispose().catch(() => {});
        }
        while (servers.length > 0) {
            await new Promise<void>(resolve => servers.pop()!.close(() => resolve()));
        }
        while (tmpDirs.length > 0) {
            fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
        }
    });

    // ─── R2-P0-1 & R2-P1-4: Paginated tail recovery, honest suffix flag, _fetchedSteps reuse ───

    it('R2-P0-1: recovers live tail on 2,500-step paginated conversation within DEFAULT_SWARM_POLL_BUDGET', async () => {
        const totalSteps = 2500;
        const pageSize = 50;
        let rpcCalls = 0;

        await withHttpServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                rpcCalls++;
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { startIndex?: number; endIndex?: number };
                const start = Math.max(0, body.startIndex ?? 0);
                const end = Math.min(totalSteps, body.endIndex ?? totalSteps);
                const sliceEnd = Math.min(end, start + pageSize);
                const steps = [];
                for (let i = start; i < sliceEnd; i++) {
                    steps.push(
                        i === totalSteps - 1
                            ? {
                                type: StepType.CHECKPOINT,
                                metadata: {
                                    modelUsage: { inputTokens: '88000', outputTokens: '1200', model: 'MODEL_CLAUDE_4_SONNET' },
                                },
                            }
                            : { type: StepType.PLANNER_RESPONSE, metadata: {} },
                    );
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steps }));
            });
        }, async (ls) => {
            const result = await withTrajectoryPollBudget(
                DEFAULT_SWARM_POLL_BUDGET,
                () => fetchTrajectorySteps(ls, 'cid-2500', totalSteps),
            );
            expect(result.suffixRecovered).toBe(true);
            expect(result.suffixStartOffset).toBeDefined();
            expect(result.suffixStartOffset! + result.steps.length).toBe(totalSteps);
            expect(result.steps.length).toBeGreaterThan(0);
            expect(rpcCalls).toBeLessThanOrEqual(DEFAULT_SWARM_POLL_BUDGET.maxRequests);

            // getContextUsage attaches non-enumerable _fetchedSteps excluded from JSON.stringify
            const traj: TrajectorySummary = {
                cascadeId: 'cid-2500',
                trajectoryId: 'traj-2500',
                summary: 'Long session',
                stepCount: totalSteps,
                status: CascadeStatus.RUNNING,
                lastModifiedTime: new Date().toISOString(),
                createdTime: new Date().toISOString(),
                workspaceUris: [],
                requestedModel: 'MODEL_CLAUDE_4_SONNET',
                generatorModel: 'MODEL_CLAUDE_4_SONNET',
            };
            const usage = await withTrajectoryPollBudget(
                DEFAULT_SWARM_POLL_BUDGET,
                () => getContextUsage(ls, traj, []),
            );
            expect(usage.contextUsed).toBe(89200);
            expect(Array.isArray(usage._fetchedSteps)).toBe(true);
            expect(usage._fetchedSteps!.length).toBeGreaterThan(0);
            expect(Object.keys(usage)).not.toContain('_fetchedSteps');
            expect(JSON.stringify(usage)).not.toContain('_fetchedSteps');
        });
    });

    it('R2-P1-4: never marks suffixRecovered=true when tail anchor fails to reach totalSteps', async () => {
        const totalSteps = 1000;
        await withHttpServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { startIndex?: number };
                const start = body.startIndex ?? 0;
                // Simulate oversize failure on full read AND on steps >= 950 (incomplete anchor)
                if (start === 0 || start >= 950) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 'resource_exhausted', message: 'response too large' }));
                    return;
                }
                const count = Math.min(20, 950 - start);
                const steps = Array.from({ length: count }, () => ({ type: StepType.PLANNER_RESPONSE, metadata: {} }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steps }));
            });
        }, async (ls) => {
            const result = await withTrajectoryPollBudget(
                DEFAULT_SWARM_POLL_BUDGET,
                () => fetchTrajectorySteps(ls, 'cid-gap', totalSteps),
            );
            expect(result.ok).toBe(false);
            expect(result.suffixRecovered).not.toBe(true);
            expect(result.suffixStartOffset).toBeUndefined();
        });
    });

    // ─── R2-P1-1: Fail-closed privacy isolation when windowId is absent ───

    it('R2-P1-1: fails closed when windowId is absent even after another window unmasks, and main.mjs enforces privacyMasked=true', async () => {
        const tmpDir = makeTmpDir('acm-w35-priv-');
        const isolatedStatePath = path.join(tmpDir, 'state.json');
        const provider = createSidecarRuntimeProvider({
            statePath: isolatedStatePath,
            autoStart: false,
            disableCliScan: true,
            deps: {
                homedir: () => tmpDir,
                discoverLS: async () => null,
            },
        });
        providers.push(provider);

        // Unmask win-1 explicitly
        const unmaskWin1 = await provider.handleAction({ command: 'setPrivacyMask', masked: false, windowId: 'win-1' });
        expect(unmaskWin1.ok).toBe(true);
        expect(unmaskWin1.snapshot?.privacyMasked).toBe(false);

        // Unmask WITHOUT windowId MUST fail closed with HTTP 400
        const unmaskNoWin = await provider.handleAction({ command: 'setPrivacyMask', masked: false });
        expect(unmaskNoWin.ok).toBe(false);
        expect(unmaskNoWin.statusCode).toBe(400);

        // Absent windowId (and win-2) MUST remain masked across snapshot, state path, and calendar export
        const snapNoWin = await provider.getSnapshot({});
        expect(snapNoWin.privacyMasked).toBe(true);
        const snapWin2 = await provider.getSnapshot({ windowId: 'win-2' });
        expect(snapWin2.privacyMasked).toBe(true);
        const snapWin1 = await provider.getSnapshot({ windowId: 'win-1' });
        expect(snapWin1.privacyMasked).toBe(false);

        const copyStateNoWin = await provider.handleAction({ command: 'copyStatePath' });
        expect(copyStateNoWin.ok).toBe(true);
        expect(JSON.stringify(copyStateNoWin.result || {})).toContain('[Redacted State Path]');
        expect(JSON.stringify(copyStateNoWin.result || {})).not.toContain(tmpDir);

        // R4-P1-1: verify provider bound isolated statePath inside tmpDir (never real user production state-v1.json)
        const copyStateWin1 = await provider.handleAction({ command: 'copyStatePath', windowId: 'win-1' });
        expect(copyStateWin1.ok).toBe(true);
        expect(JSON.stringify(copyStateWin1.result || {})).toContain(isolatedStatePath);

        const calExportNoWin = await provider.handleAction({ command: 'calendarExportJson' });
        expect(calExportNoWin.ok).toBe(true);
        expect(JSON.stringify(calExportNoWin.result || {})).not.toContain(tmpDir);

        // main.mjs statically passes explicit privacyMasked: true on '/' and '/full'
        const mainMjsSrc = fs.readFileSync(
            path.resolve(__dirname, '..', 'app-plugin', 'sidecars', 'context_monitor', 'main.mjs'),
            'utf8',
        );
        expect(mainMjsSrc).toMatch(/renderPage\([^)]*true\)/);
    });

    // ─── R2-P1-3 & R2-P2-1: Global rules READ_FAILED, ok:true on open/reveal, 512 KiB action cap ───

    it('R2-P1-3 & R2-P2-1: returns READ_FAILED on unreadable GEMINI.md, includes ok:true on open/reveal, and keeps 512 KiB HTTP action cap', async () => {
        expect(MAX_ACTION_BODY_BYTES).toBe(512 * 1024);

        const fakeHome = makeTmpDir('acm-w35-gr-');
        const geminiDir = path.join(fakeHome, '.gemini');
        fs.mkdirSync(geminiDir, { recursive: true });
        const geminiMd = path.join(geminiDir, 'GEMINI.md');
        fs.writeFileSync(geminiMd, '# Private rules\n', 'utf8');

        // Real POSIX unreadable file check (non-root)
        if (process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0) {
            fs.chmodSync(geminiMd, 0o000);
            try {
                const status = readGlobalRulesStatus({ homedir: fakeHome, includeContent: true });
                expect(status.error).toBe('READ_FAILED');
                expect(status.content).toBe('');
            } finally {
                fs.chmodSync(geminiMd, 0o600);
            }
        }

        // Sidecar openGlobalRulesFile & revealGlobalRulesFile include ok: true inside result (strictly isolated to fakeHome)
        const openedPaths: string[] = [];
        const revealedPaths: string[] = [];
        const provider = createSidecarRuntimeProvider({
            statePath: path.join(fakeHome, 'state.json'),
            autoStart: false,
            disableCliScan: true,
            deps: {
                discoverLS: async () => null,
                homedir: () => fakeHome,
                openFileInOs: async (target) => { openedPaths.push(target); },
                revealInOs: async (target) => { revealedPaths.push(target); },
            },
        });
        providers.push(provider);

        const openRes = await provider.handleAction({ command: 'openGlobalRulesFile', windowId: 'w1' });
        expect(openRes.ok).toBe(true);
        expect((openRes.result as Record<string, unknown>)?.ok).toBe(true);
        expect(openedPaths).toHaveLength(1);
        expect(openedPaths[0].startsWith(fs.realpathSync(fakeHome))).toBe(true);

        const revealRes = await provider.handleAction({ command: 'revealGlobalRulesFile', windowId: 'w1' });
        expect(revealRes.ok).toBe(true);
        expect((revealRes.result as Record<string, unknown>)?.ok).toBe(true);
        expect(revealedPaths).toHaveLength(1);
        expect(revealedPaths[0].startsWith(fs.realpathSync(fakeHome))).toBe(true);
    });

    // ─── R2-P1-6 & R2-P2-6: workspaceBreakdown prototype pollution guard & surface-filtered swarm lateMergedCalls ───

    it('R2-P1-6 & R2-P2-6: blocks prototype pollution keys & invalid numbers in workspaceBreakdown and filters lateMergedCalls by surface', () => {
        const maliciousPayload = JSON.parse(
            '{"__proto__":{"calls":9,"inputTokens":100},"constructor":{"calls":5},"prototype":{"calls":3},"/repo/ok":{"calls":2,"inputTokens":50,"outputTokens":-10,"thinkingTokens":null,"cacheReadTokens":0,"cacheCreationTokens":0,"credits":1,"knownCostUsd":0.25,"unpricedCalls":0}}',
        ) as Record<string, any>;

        const cloned = cloneWorkspaceBreakdown(maliciousPayload);
        expect(({} as Record<string, unknown>).calls).toBeUndefined();
        expect(cloned).toBeDefined();
        expect(Object.prototype.hasOwnProperty.call(cloned!, '__proto__')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(cloned!, 'constructor')).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(cloned!, 'prototype')).toBe(false);
        expect(cloned!['/repo/ok'].calls).toBe(2);
        expect(cloned!['/repo/ok'].outputTokens).toBe(0);

        const store = new DailyStore();
        const imported = store.mergeRecords({
            version: 1,
            records: {
                '2026-11-20': {
                    date: '2026-11-20',
                    cycles: [{
                        startTime: '2026-11-20T00:00:00Z',
                        endTime: '2026-11-20T23:59:59Z',
                        totalReasoning: 1,
                        totalToolCalls: 0,
                        totalErrors: 0,
                        totalInputTokens: 50,
                        totalOutputTokens: 10,
                        estSteps: 1,
                        modelNames: ['Claude'],
                        workspaceBreakdown: maliciousPayload,
                    }],
                },
            },
        });
        expect(imported).toBe(1);
        expect(({} as Record<string, unknown>).calls).toBeUndefined();

        // R2-P2-6: surfaceFilter excludes mismatched lateMergedCalls from swarmGroupCosts
        const lb = aggregateWorkspaceLeaderboard({
            surfaceFilter: 'app',
            swarmGroups: [{ rootId: 'root-1', memberIds: ['worker-1'] }],
            cycles: [{
                surface: 'ide',
                lateMergedCalls: {
                    'root-1|c1': {
                        callId: 'root-1|c1',
                        cascadeId: 'root-1',
                        surface: 'app',
                        inputTokens: 100,
                        outputTokens: 50,
                        thinkingTokens: 0,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                        estimatedCost: 1.5,
                    },
                    'worker-1|c2': {
                        callId: 'worker-1|c2',
                        cascadeId: 'worker-1',
                        surface: 'ide',
                        inputTokens: 200,
                        outputTokens: 100,
                        thinkingTokens: 0,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                        estimatedCost: 9.0,
                    },
                },
            }],
        });
        expect(lb.swarmGroupCosts?.['root-1']?.inclusiveGroupCostUsd).toBeCloseTo(1.5, 5);
    });

    // ─── R2-P1-7, R2-P1-8, R2-P2-3: IDE handoff revisionMismatch, masked GM fullText redaction, bootstrap script removal ───

    it('R2-P1-7, R2-P1-8 & R2-P2-3: IDE rejects revisionMismatch without clipboard write, redacts systemContextItems/checkpointSummaries fullText, and removes nonce script element', async () => {
        const posted: any[] = [];
        let messageHandler: ((msg: any) => Promise<void> | void) | null = null;
        const fakeWebview = {
            html: '',
            postMessage: vi.fn((m: any) => { posted.push(m); return Promise.resolve(true); }),
            onDidReceiveMessage: vi.fn((cb: any) => { messageHandler = cb; return { dispose() {} }; }),
        };
        const fakePanel = {
            visible: true,
            webview: fakeWebview,
            reveal: vi.fn(),
            dispose: vi.fn(),
            onDidDispose: vi.fn(() => ({ dispose() {} })),
            onDidChangeViewState: vi.fn(() => ({ dispose() {} })),
        };
        const createPanelSpy = vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(fakePanel as any);
        const clipSpy = vi.spyOn(vscode.env.clipboard, 'writeText').mockResolvedValue(undefined);

        const gmSummary: GMSummary = {
            conversations: [{
                cascadeId: 'cid-secret',
                title: 'Secret Session',
                totalCalls: 1,
                totalInputTokens: 1000,
                totalOutputTokens: 200,
                totalThinkingTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
                totalCredits: 0,
                avgTTFT: 0.5,
                minTTFT: 0.5,
                maxTTFT: 0.5,
                cacheHitRate: 0,
                responseModel: 'claude-sonnet-4',
                apiProvider: 'anthropic',
                completionConfig: null,
                totalRetries: 0,
                totalRetryTokens: 0,
                totalRetryCredits: 0,
                calls: [{
                    executionId: 'e1',
                    model: 'MODEL_CLAUDE_4_SONNET',
                    modelDisplay: 'Claude Sonnet 4',
                    responseModel: 'claude-sonnet-4',
                    apiProvider: 'anthropic',
                    inputTokens: 1000,
                    outputTokens: 200,
                    thinkingTokens: 0,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    credits: 0,
                    ttftSeconds: 0.5,
                    streamingSeconds: 1.0,
                    createdAt: '2026-11-28T00:00:00Z',
                    stopReason: 'STOP',
                    stepIndices: [1],
                    startStepIndex: 1,
                    contextTokensUsed: 1000,
                    systemContextItems: [{ type: 'rule', label: 'Rule', tokens: 50, fullText: 'SUPER_SECRET_SYSTEM_PROMPT_TEXT' }],
                    checkpointSummaries: [{ stepIndex: 1, tokens: 40, fullText: 'SUPER_SECRET_CHECKPOINT_SUMMARY' }],
                } as GMCallEntry],
                systemContextItems: [{ type: 'rule', stepIndex: 0, label: 'Rule', tokens: 50, fullText: 'SUPER_SECRET_SYSTEM_PROMPT_TEXT' }],
                checkpointSummaries: [{ stepIndex: 1, checkpointNumber: 1, tokens: 40, fullText: 'SUPER_SECRET_CHECKPOINT_SUMMARY' }],
            }],
            modelBreakdown: {},
            totalCalls: 1,
            totalInputTokens: 1000,
            totalOutputTokens: 200,
            totalThinkingTokens: 0,
            totalCacheRead: 0,
            totalCacheCreation: 0,
            totalCredits: 0,
            totalRetries: 0,
            totalRetryTokens: 0,
            totalRetryCredits: 0,
            totalRetryCount: 0,
            contextGrowth: [],
            fetchedAt: Date.now(),
        };

        const actSummary = new ActivityTracker().getSummary();
        actSummary.totalSteps = 1;
        actSummary.recentSteps.push({
            cascadeId: 'cid-secret',
            stepIndex: 1,
            type: StepType.PLANNER_RESPONSE,
            category: 'reasoning',
            timestamp: '2026-11-28T00:00:00Z',
            durationMs: 100,
            detail: 'response',
        } as any);
        showMonitorPanel({
            currentUsage: null,
            monitorStatus: 'ready',
            allTrajectoryUsages: [],
            modelConfigs: [],
            userInfo: null,
            gmSummary,
            activitySummary: actSummary,
        });
        expect(createPanelSpy).toHaveBeenCalled();

        // R2-P1-8: fresh panel starts masked; rendered viewer MUST show [Redacted] and NEVER contain private fullText prose
        expect(fakeWebview.html).toContain('[Redacted]');
        expect(fakeWebview.html).not.toContain('SUPER_SECRET_SYSTEM_PROMPT_TEXT');
        expect(fakeWebview.html).not.toContain('SUPER_SECRET_CHECKPOINT_SUMMARY');

        // R2-P2-3: nonce bootstrap script removes document.currentScript from DOM
        const nonce = getCurrentIdePanelHostNonce();
        expect(nonce).toBeTruthy();
        expect(fakeWebview.html).toContain('document.currentScript');
        expect(fakeWebview.html).toContain('s.parentNode.removeChild(s)');

        // R2-P1-7: previewHandoffV2 with mismatched dataRevision returns ok:false and performs ZERO clipboard writes
        expect(messageHandler).not.toBeNull();
        posted.length = 0;
        await messageHandler!({
            command: 'previewHandoffV2',
            __acmHostNonce: nonce,
            dataRevision: 999999,
            copy: true,
        });
        expect(clipSpy).not.toHaveBeenCalled();
        const handoffResp = posted.find(m => m.command === 'handoffV2PreviewResult');
        expect(handoffResp).toMatchObject({ ok: false, revisionMismatch: true });

        // Cleanup panel singleton state
        const onDisposeCb = (fakePanel.onDidDispose as any).mock.calls[0]?.[0];
        if (typeof onDisposeCb === 'function') { onDisposeCb(); }
    });

    // ─── R2-P1-9: Bundle validator requires runtime bundles & case-only rename survival on win32/darwin ───

    it('R2-P1-9: validateExtractedPluginBundle rejects missing sidecar-bundle.js / sidecar-runtime.js', () => {
        const dir = makeTmpDir('acm-w35-val-');
        fs.mkdirSync(path.join(dir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: 'antigravity-context-monitor', version: '1.18.0' }), 'utf8');
        fs.writeFileSync(path.join(dir, 'sidecars', 'context_monitor', 'sidecar.json'), JSON.stringify({ command: 'node', args: ['main.mjs'] }), 'utf8');
        fs.writeFileSync(path.join(dir, 'sidecars', 'context_monitor', 'main.mjs'), 'export {};', 'utf8');
        fs.writeFileSync(path.join(dir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'), 'module.exports={};', 'utf8');

        // Missing sidecar-bundle.js must fail closed
        expect(() => validateExtractedPluginBundle(dir)).toThrow(/sidecar-bundle\.js/);

        // Add sidecar-bundle.js but omit sidecar-runtime.js -> must still fail closed
        fs.writeFileSync(path.join(dir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-bundle.js'), 'module.exports={};', 'utf8');
        expect(() => validateExtractedPluginBundle(dir)).toThrow(/sidecar-runtime\.js/);

        // Add sidecar-runtime.js -> passes
        fs.writeFileSync(path.join(dir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-runtime.js'), 'module.exports={};', 'utf8');
        expect(validateExtractedPluginBundle(dir).version).toBe('1.18.0');
    });

    it('R2-P1-9: transactional swap preserves case-only renamed files on win32/darwin', async () => {
        if (process.platform !== 'darwin' && process.platform !== 'win32') { return; }
        const tmp = makeTmpDir('acm-w35-case-');
        const targetDir = path.join(tmp, 'plugin');
        fs.mkdirSync(path.join(targetDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app'), { recursive: true });
        fs.writeFileSync(path.join(targetDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-context-monitor', version: '1.17.9' }), 'utf8');
        fs.writeFileSync(path.join(targetDir, 'sidecars', 'context_monitor', 'sidecar.json'), JSON.stringify({ command: 'node', args: ['main.mjs'] }), 'utf8');
        fs.writeFileSync(path.join(targetDir, 'sidecars', 'context_monitor', 'main.mjs'), 'export {};', 'utf8');
        fs.writeFileSync(path.join(targetDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-bundle.js'), 'v1', 'utf8');
        fs.writeFileSync(path.join(targetDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'), 'v1', 'utf8');
        fs.writeFileSync(path.join(targetDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-runtime.js'), 'v1', 'utf8');
        fs.writeFileSync(path.join(targetDir, 'README.md'), 'old readme', 'utf8');

        // Build a ZIP with case-only rename `readme.md` (lowercase!) + v1.18.0
        const packager = await import(path.resolve(__dirname, '..', 'scripts', 'package-app-plugin.mjs'));
        const zipBuf: Buffer = packager.buildZipBuffer([
            { name: 'antigravity-context-monitor/plugin.json', data: Buffer.from(JSON.stringify({ name: 'antigravity-context-monitor', version: '1.18.0' })), mode: 0o100644 },
            { name: 'antigravity-context-monitor/sidecars/context_monitor/sidecar.json', data: Buffer.from(JSON.stringify({ command: 'node', args: ['main.mjs'] })), mode: 0o100644 },
            { name: 'antigravity-context-monitor/sidecars/context_monitor/main.mjs', data: Buffer.from('export {};'), mode: 0o100644 },
            { name: 'antigravity-context-monitor/sidecars/context_monitor/runtime/out/app/sidecar-bundle.js', data: Buffer.from('v2'), mode: 0o100644 },
            { name: 'antigravity-context-monitor/sidecars/context_monitor/runtime/out/app/sidecar-server.js', data: Buffer.from('v2'), mode: 0o100644 },
            { name: 'antigravity-context-monitor/sidecars/context_monitor/runtime/out/app/sidecar-runtime.js', data: Buffer.from('v2'), mode: 0o100644 },
            { name: 'antigravity-context-monitor/readme.md', data: Buffer.from('new lowercase readme'), mode: 0o100644 },
        ]);
        const sha = crypto.createHash('sha256').update(zipBuf).digest('hex');
        const assetName = 'antigravity-context-monitor-app-1.18.0.zip';
        const sumsBuf = Buffer.from(`${sha}  ${assetName}\n`, 'utf8');

        const res = await applyAppPluginUpdate({
            targetPluginDir: targetDir,
            currentVersion: '1.17.9',
            reResolveRelease: false,
            releaseInfo: {
                version: '1.18.0',
                tagName: 'v1.18.0',
                assetName,
                assetUrl: `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.18.0/${assetName}`,
                checksumsUrl: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/download/v1.18.0/SHA256SUMS.txt',
                releaseUrl: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.18.0',
                publishedAt: '2026-11-28T00:00:00Z',
                notes: '',
            },
            transport: async (url) => ({
                statusCode: 200,
                headers: {},
                body: String(url).endsWith('SHA256SUMS.txt') ? sumsBuf : zipBuf,
            }),
            // Force Windows-style transactional in-place swap fallback
            renameDir: async () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); },
        });
        expect(res.error).toBeUndefined();
        expect(res.ok).toBe(true);
        // The case-only renamed readme must STILL exist with the new content (not deleted into obsoleteDir!)
        expect(fs.readFileSync(path.join(targetDir, 'readme.md'), 'utf8')).toBe('new lowercase readme');
    });

    // ─── R2-P1-10: Reload-under-wait preservation, bounded empty-lock recovery, release-security dead .reclaim recovery ───

    it('R2-P1-10: bounded monotonic grace expires crashed empty lock, reload-under-wait preserves peer edit, and dead .reclaim recovers', async () => {
        const tmp = makeTmpDir('acm-w35-lock-');

        // 1. Crashed 0-byte empty lock expires cleanly after bounded monotonic grace (250ms)
        const emptyLock = path.join(tmp, 'empty.lock');
        fs.writeFileSync(emptyLock, '', 'utf8');
        const acquired = await acquireFencedLockFile(emptyLock, {
            hostId: 'local-host',
            staleMs: 250,
            timeoutMs: 1200,
        });
        expect(acquired.ownerToken).toBeTruthy();
        await acquired.release();

        // 2. Reload-under-wait during DurableState._flush() preserves peer edit B
        const statePath = path.join(tmp, 'durable.json');
        const seed = createFastDurableState(statePath, { debounceMs: 5 });
        await seed.updateGlobalWithReceipt('displayLanguage', 'en');
        seed.dispose();

        const writerA = new DurableState(statePath, { debounceMs: 5 });
        const peerLock = await acquireFencedLockFile(`${statePath}.lock`, { timeoutMs: 1000 });
        const flushPromise = writerA.patchAppSettingsWithReceipt({ displayCurrency: 'EUR' });

        fs.writeFileSync(statePath, JSON.stringify({
            version: 1,
            global: {
                displayLanguage: 'zh',
                appSettings: { displayCurrency: 'USD', displayLanguage: 'zh' },
            },
            workspaces: {},
        }), 'utf8');
        writerA.reloadIfChanged();
        await peerLock.release();

        const { receipt } = await flushPromise;
        expect(receipt.committed).toBe(true);
        const onDisk = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        expect(onDisk.global.displayLanguage).toBe('zh');
        expect(onDisk.global.appSettings.displayCurrency).toBe('EUR');
        writerA.dispose();

        // 3. release-security dead-PID .reclaim guard recovers via .recover meta-guard
        const pluginTarget = path.join(tmp, 'plugin-dir');
        fs.mkdirSync(pluginTarget, { recursive: true });
        const lockFile = `${pluginTarget}.update.lock`;
        const reclaimFile = `${lockFile}.reclaim`;
        fs.writeFileSync(lockFile, JSON.stringify({ pid: 999998, createdAtMs: 1000, owner: 'dead', token: 't1', hostId: os.hostname() }), 'utf8');
        fs.writeFileSync(reclaimFile, JSON.stringify({ pid: 999997, createdAtMs: 1000, owner: 'dead-reclaim', token: 't2', hostId: os.hostname() }), 'utf8');
        const updLock = await acquirePluginUpdateLock(pluginTarget, {
            owner: 'test-runner',
            timeoutMs: 1000,
            isPidAlive: () => false,
        });
        expect(updLock.verifyOwned()).toBe(true);
        updLock.release();
    });

    // ─── R2-P1-11 & R2-P1-4 (IDE): extension.ts flushes durableState BEFORE pricingStore.setAll ───

    it('R2-P1-11 & R3-P1-6 & R2-P1-4 (IDE): extension.ts flushes DurableState and syncs PricingStore in-memory without double-writing, and accepts suffix-recovered steps when ok=false', () => {
        const extSrc = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'extension.ts'), 'utf8');
        const customPricingIdx = extSrc.indexOf("durableState.updateGlobalWithReceipt('customModelPricing'");
        expect(customPricingIdx).toBeGreaterThan(-1);
        const importWindow = extSrc.slice(customPricingIdx, customPricingIdx + 800);
        const flushIdx = importWindow.indexOf('await durableState.flush()');
        const reloadIdx = importWindow.indexOf('pricingStore.reloadFromStorage()');
        expect(flushIdx).toBeGreaterThan(-1);
        expect(reloadIdx).toBeGreaterThan(flushIdx);
        expect(importWindow.slice(flushIdx, reloadIdx + 60)).not.toContain('pricingStore.setAll(');

        // R2-P1-4 IDE gate: stepsSuffixRecovered accepted even when stepsRes.ok === false
        expect(extSrc).toMatch(/stepsRes\.steps\.length > 0[\s\S]*?\(stepsRes\.suffixRecovered \|\| stepsRes\.suffixStartOffset !== undefined\)/);
        expect(extSrc).toContain('suffixStartOffset: stepsRes.suffixStartOffset');
    });

    // ─── R2-P2-7, R2-P2-9, R2-P2-11: Activity short-page watermark, weekly runway clamp, cacheTelemetryAvailable, VSIX binding ───

    it('R2-P2-7: ActivityTracker short-page prefix keeps stepIndex 0..N-1 and advances stepCount only to verified coverage', async () => {
        const tracker = new ActivityTracker();
        await withHttpServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                const steps = Array.from({ length: 10 }, (_, i) => ({
                    type: StepType.PLANNER_RESPONSE,
                    metadata: {
                        generatorModel: 'MODEL_CLAUDE_4_SONNET',
                        createdAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
                    },
                    plannerResponse: { response: `reply-${i}` },
                }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steps }));
            });
        }, async (ls) => {
            await tracker.processTrajectories(ls, [{
                cascadeId: 'cid-short',
                stepCount: 100,
                status: CascadeStatus.IDLE,
            }]);
            const state = tracker.serialize();
            expect(state.trajectoryBaselines['cid-short'].stepCount).toBe(10);
            expect(state.trajectoryBaselines['cid-short'].processedIndex).toBe(10);
            const indices = state.summary.recentSteps
                .filter(ev => ev.cascadeId === 'cid-short' && ev.stepIndex !== undefined)
                .map(ev => ev.stepIndex);
            expect(indices.length).toBeGreaterThan(0);
            expect(Math.max(...indices)).toBeLessThan(10);
        });
    });

    it('R2-P2-9: weekly runway merge clamps stale higher lastFraction to merged bucket endFraction and slimCallForPersistence preserves cacheTelemetryAvailable', () => {
        const t1 = new QuotaRunwayTracker();
        const t2 = new QuotaRunwayTracker();
        const baseTs = 1_760_000_000_000;
        const resetMs = baseTs + 7 * 86_400_000;
        t1.recordWeeklyObservation({ account: 'acct', pool: 'pool', window: '7d', remainingFraction: 0.70, timestampMs: baseTs, resetTimeMs: resetMs, hasUserActivity: true, surface: 'app' });
        t1.recordWeeklyObservation({ account: 'acct', pool: 'pool', window: '7d', remainingFraction: 0.65, timestampMs: baseTs + 60_000, resetTimeMs: resetMs, hasUserActivity: true, surface: 'app' });
        // Second host observed a later stale reading of 0.70 without a fractional reset
        t2.recordWeeklyObservation({ account: 'acct', pool: 'pool', window: '7d', remainingFraction: 0.70, timestampMs: baseTs + 120_000, resetTimeMs: resetMs, hasUserActivity: true, surface: 'ide' });

        const merged = mergeSerializedQuotaRunwayStates(t1.serialize(), t2.serialize());
        const seriesList = Object.values(merged.weeklyBuckets || {});
        expect(seriesList.length).toBe(1);
        expect(seriesList[0].buckets[0].endFraction).toBeCloseTo(0.65, 5);
        expect(seriesList[0].lastFraction).toBeCloseTo(0.65, 5);

        // cacheTelemetryAvailable preserved through slimCallForPersistence
        const slimmed = slimCallForPersistence({
            executionId: 'exec-1',
            model: 'MODEL_CLAUDE_4_SONNET',
            modelDisplay: 'Claude Sonnet 4',
            responseModel: 'claude-sonnet-4',
            apiProvider: 'anthropic',
            inputTokens: 100,
            outputTokens: 50,
            thinkingTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            credits: 0,
            ttftSeconds: 0.2,
            streamingSeconds: 0.5,
            createdAt: '2026-11-28T00:00:00Z',
            stopReason: 'STOP',
            stepIndices: [1],
            startStepIndex: 1,
            contextTokensUsed: 100,
            cacheTelemetryAvailable: false,
        } as GMCallEntry);
        expect(slimmed.cacheTelemetryAvailable).toBe(false);
    });

    it('R2-P2-11: package-app-plugin.mjs rejects a VSIX whose embedded extension.js mismatches dist-stage/ide/extension.js', async () => {
        const packagerPath = path.resolve(__dirname, '..', 'scripts', 'package-app-plugin.mjs');
        const packager = await import(packagerPath);
        const tmpOut = makeTmpDir('acm-w35-vsix-');
        const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
        const fakeVsixPath = path.join(tmpOut, `antigravity-context-monitor-${pkg.version}.vsix`);

        // Build a synthetic VSIX with mismatched extension.js bytes
        const staleVsix = packager.buildZipBuffer([
            { name: 'extension/dist-stage/ide/extension.js', data: Buffer.from('// stale vsix extension bytes\n', 'utf8'), mode: 0o100644 },
        ]);
        fs.writeFileSync(fakeVsixPath, staleVsix);

        expect(() => packager.packageAppPlugin({
            distRoot: tmpOut,
            skipValidation: true,
            includeVsix: true,
        })).toThrow(/VSIX binding check failed/i);
    });
});

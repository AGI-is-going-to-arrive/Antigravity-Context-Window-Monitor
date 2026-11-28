import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import vm from 'vm';
import * as vscode from 'vscode';

import { fetchTrajectorySteps, type LSInfo } from '../src/tracker';
import { CascadeStatus, StepType } from '../src/constants';
import { DEFAULT_SWARM_POLL_BUDGET, withTrajectoryPollBudget } from '../src/core/swarm-registry';
import { acquireFencedLockFile } from '../src/durable-state';
import { parseContextBreakdown } from '../src/context-breakdown';
import { DailyLedger } from '../src/daily-ledger';
import { buildGMSummaryFromLedger } from '../src/daily-archival';
import { PricingStore } from '../src/pricing-store';
import { createSidecarRuntimeProvider, type SidecarRuntimeProvider } from '../src/app/sidecar-runtime';
import { getHostBridgeScript } from '../src/app/host-bridge';
import { writeGlobalRulesFile, readGlobalRulesStatus } from '../src/global-rules';
import { validateExtractedPluginBundle } from '../src/core/release-security';
import { DailyStore } from '../src/daily-store';
import { buildCalendarTabContent } from '../src/webview-calendar-tab';
import { installPluginAtomic } from '../src/cli/install-app-plugin-entry';
import { showMonitorPanel } from '../src/webview-panel';
import type { GMCallEntry, GMSummary } from '../src/gm/types';

const tmpDirs: string[] = [];
const providers: SidecarRuntimeProvider[] = [];

function makeTmpDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
}

async function withHttpServer<T>(
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
    run: (ls: LSInfo) => Promise<T>,
): Promise<T> {
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
        return await run({ pid: process.pid, csrfToken: 'test-csrf', port, useTls: false });
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

afterEach(async () => {
    while (providers.length > 0) {
        const p = providers.pop()!;
        try { await p.dispose(); } catch { /* ignore */ }
    }
    while (tmpDirs.length > 0) {
        const d = tmpDirs.pop()!;
        try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    vi.restoreAllMocks();
});

describe('[wave36-final-fixes]', () => {
    it('R3-P0-1: short-page anchorProbe and mid-pagination byte exhaustion preserve tail recovery headroom', async () => {
        // 1. Short-page anchorProbe (2 steps per page on a 2500-step session under 24-req poll budget)
        const totalSteps = 2500;
        let shortReqCount = 0;
        await withHttpServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                shortReqCount++;
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { startIndex?: number };
                const start = Math.max(0, Number(body.startIndex ?? 0));
                const end = Math.min(start + 2, totalSteps);
                const steps = Array.from({ length: end - start }, (_, idx) => ({
                    type: StepType.PLANNER_RESPONSE,
                    metadata: {
                        modelUsage: {
                            model: 'MODEL_CLAUDE_4_SONNET',
                            inputTokens: 10000 + start + idx,
                            outputTokens: 500,
                        },
                    },
                }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steps }));
            });
        }, async (ls) => {
            const res = await withTrajectoryPollBudget(
                { ...DEFAULT_SWARM_POLL_BUDGET },
                () => fetchTrajectorySteps(ls, 'cid-short-anchor', totalSteps),
            );
            expect(res.suffixRecovered).toBe(true);
            expect(res.suffixStartOffset).toBeDefined();
            expect(res.suffixStartOffset! + res.steps.length).toBe(totalSteps);
            expect(shortReqCount).toBeLessThanOrEqual(24);
            // R3-P1-4: recovered suffix steps without explicit stepIndex are normalized to absolute offsets
            expect((res.steps[0] as Record<string, unknown>).stepIndex).toBe(res.suffixStartOffset);
            expect((res.steps[res.steps.length - 1] as Record<string, unknown>).stepIndex).toBe(totalSteps - 1);
        });

        // 2. Concurrent prefix batch byte exhaustion preserves byte reserve for tryTailRecovery
        const byteSteps = 300;
        const padHeavy = 'X'.repeat(6000);
        await withHttpServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { startIndex?: number; endIndex?: number };
                const start = Math.max(0, Number(body.startIndex ?? 0));
                const end = Math.min(Number(body.endIndex ?? start + 50), byteSteps);
                const isHeavyPrefix = start >= 50 && start < 250;
                const steps = Array.from({ length: end - start }, (_, idx) => ({
                    stepIndex: start + idx,
                    type: StepType.PLANNER_RESPONSE,
                    ...(isHeavyPrefix ? { plannerResponse: { response: padHeavy } } : {}),
                    metadata: {
                        modelUsage: {
                            model: 'MODEL_CLAUDE_4_SONNET',
                            inputTokens: 8000 + start + idx,
                            outputTokens: 200,
                        },
                    },
                }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steps }));
            });
        }, async (ls) => {
            const res = await withTrajectoryPollBudget(
                { ...DEFAULT_SWARM_POLL_BUDGET, maxBytes: 400_000 },
                () => fetchTrajectorySteps(ls, 'cid-byte-reserve', byteSteps),
            );
            expect(res.suffixRecovered).toBe(true);
            expect(res.suffixStartOffset! + res.steps.length).toBe(byteSteps);
        });
    });

    it('R3-P1-2: crashed 0-byte empty lockfile is reclaimed within production default timeout (2500ms / stale 5000ms)', async () => {
        const tmp = makeTmpDir('acm-w36-lock-');
        const emptyLock = path.join(tmp, 'prod-default.lock');
        fs.writeFileSync(emptyLock, '', 'utf8');
        // Production defaults (no staleMs/timeoutMs overrides) MUST reclaim within 2500ms
        const handle = await acquireFencedLockFile(emptyLock);
        expect(handle.ownerToken).toBeTruthy();
        expect(await handle.verifyOwned()).toBe(true);
        await handle.release();
    });

    it('R3-P1-3: masked App Model Calls emits [Redacted] for checkpointSummaries & systemContextItems fullText', async () => {
        const tmp = makeTmpDir('acm-w36-app-gm-');
        const gmSummary: GMSummary = {
            conversations: [{
                cascadeId: 'cid-app-secret',
                title: 'Private Planning Session',
                totalCalls: 1,
                totalInputTokens: 1200,
                totalOutputTokens: 300,
                totalThinkingTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
                totalCredits: 0,
                avgTTFT: 0.4,
                minTTFT: 0.4,
                maxTTFT: 0.4,
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
                    inputTokens: 1200,
                    outputTokens: 300,
                    thinkingTokens: 0,
                    cacheReadTokens: 0,
                    cacheCreationTokens: 0,
                    credits: 0,
                    ttftSeconds: 0.4,
                    streamingSeconds: 0.8,
                    createdAt: '2026-11-28T00:00:00Z',
                    stopReason: 'STOP',
                    stepIndices: [1],
                    startStepIndex: 1,
                    contextTokensUsed: 1200,
                    systemContextItems: [{ type: 'rule', stepIndex: 0, label: 'Rule', tokens: 60, fullText: 'APP_PRIVATE_SYSTEM_PROSE_991' }],
                    checkpointSummaries: [{ stepIndex: 1, checkpointNumber: 1, tokens: 50, fullText: 'APP_PRIVATE_CHECKPOINT_PROSE_992' }],
                } as GMCallEntry],
                systemContextItems: [{ type: 'rule', stepIndex: 0, label: 'Rule', tokens: 60, fullText: 'APP_PRIVATE_SYSTEM_PROSE_991' }],
                checkpointSummaries: [{ stepIndex: 1, checkpointNumber: 1, tokens: 50, fullText: 'APP_PRIVATE_CHECKPOINT_PROSE_992' }],
            }],
            modelBreakdown: {},
            totalCalls: 1,
            totalInputTokens: 1200,
            totalOutputTokens: 300,
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

        await withHttpServer((_req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                steps: [{
                    stepIndex: 0,
                    type: StepType.PLANNER_RESPONSE,
                    metadata: { createdAt: '2026-11-28T00:00:00Z', generatorModel: 'MODEL_CLAUDE_4_SONNET' },
                    plannerResponse: { response: 'ok' },
                }],
            }));
        }, async (ls) => {
            const provider = createSidecarRuntimeProvider({
                statePath: path.join(tmp, 'state.json'),
                autoStart: false,
                disableCliScan: true,
                deps: {
                    homedir: () => tmp,
                    discoverLS: async () => ls,
                    fetchFullUserStatus: async () => ({ configs: [], userInfo: null, quotaSummary: null }),
                    getAllTrajectories: async () => [{
                        cascadeId: 'cid-app-secret',
                        summary: 'Private Planning Session',
                        stepCount: 1,
                        status: CascadeStatus.IDLE,
                        lastModifiedTime: '2026-11-28T00:00:00Z',
                        workspaceUris: ['file:///Users/secret/project'],
                    }],
                    getContextUsage: async () => ({
                        cascadeId: 'cid-app-secret',
                        title: 'Private Planning Session',
                        model: 'MODEL_CLAUDE_4_SONNET',
                        modelDisplayName: 'Claude Sonnet 4',
                        contextUsed: 1200,
                        totalOutputTokens: 300,
                        totalToolCallOutputTokens: 0,
                        contextLimit: 200000,
                        usagePercent: 0.6,
                        stepCount: 1,
                        lastModifiedTime: '2026-11-28T00:00:00Z',
                        status: CascadeStatus.IDLE,
                        isEstimated: false,
                        imageGenStepCount: 0,
                        imageGenerationModels: [],
                    }),
                    fetchGM: async () => gmSummary,
                    fetchTrajectoryGeneratorMetadata: async () => [],
                    fetchTrajectorySteps: async () => ({ ok: true, steps: [], hasGaps: false }),
                    fetchOrchestratorSettings: async () => null,
                    fetchUserQuotaSummary: async () => null,
                    fetchAvailableModels: async () => null,
                },
            });
            providers.push(provider);
            await provider.pollNow(true);

            const snap = await provider.getSnapshot({ includeHtml: true, windowId: 'win-masked' });
            const gmHtml = String(snap.tabs?.gm ?? '');
            expect(gmHtml).toContain('[Redacted]');
            expect(gmHtml).not.toContain('APP_PRIVATE_SYSTEM_PROSE_991');
            expect(gmHtml).not.toContain('APP_PRIVATE_CHECKPOINT_PROSE_992');
        });
    });

    it('R3-P1-4: parseContextBreakdown threads suffixStartOffset for suffix steps without stepIndex', () => {
        const bd = parseContextBreakdown({
            generatorMetadata: [{
                stepIndices: [2399, 2400],
                chatModel: {
                    model: 'MODEL_CLAUDE_4_SONNET',
                    usage: { inputTokens: 160_000, outputTokens: 2_000 },
                },
            }],
            steps: [
                { type: StepType.USER_INPUT, userInput: { text: 'continue after compaction' } },
                { type: StepType.CHECKPOINT, checkpoint: { sessionSummary: 'short summary after compact', intentOnly: false } },
            ],
            suffixStartOffset: 2497,
            currentStepCount: 2499,
            model: 'MODEL_CLAUDE_4_SONNET',
            effectiveBudgetTokens: 200_000,
        });
        expect(bd.measurementState).toBe('estimated_post_compaction');
        expect(bd.usedTokens).toBeLessThan(160_000);
    });

    it('R3-P1-5: DailyLedger.restore drops rejected polluted workspaceBreakdown instead of spreading raw keys, and archival ignores non-primitive numbers', () => {
        const polluted = JSON.parse('{"__proto__":{"calls":5},"constructor":{"calls":3},"prototype":{"calls":2}}');
        const restored = DailyLedger.restore({
            version: 1,
            dateKey: '2026-11-28',
            accounts: {
                'a@example.com': {
                    accountEmail: 'a@example.com',
                    totalCalls: 1,
                    totalInputTokens: 100,
                    totalOutputTokens: 50,
                    totalThinkingTokens: 0,
                    totalCacheRead: 0,
                    totalCacheCreation: 0,
                    totalCredits: 0,
                    modelStats: {},
                    recordedCallIds: [],
                    recordedCalls: [],
                    workspaceBreakdown: polluted,
                } as any,
            },
            settled: [{
                poolKey: 'p1',
                poolModelIds: [],
                poolModelLabels: [],
                settledAt: '2026-11-28T00:00:00Z',
                totalCalls: 1,
                totalInputTokens: 100,
                totalOutputTokens: 50,
                totalThinkingTokens: 0,
                totalCacheRead: 0,
                totalCacheCreation: 0,
                totalCredits: 0,
                modelCalls: {},
                workspaceBreakdown: polluted,
            } as any],
        });
        const snap = restored.serialize();
        expect(snap.accounts['a@example.com'].workspaceBreakdown).toBeUndefined();
        expect(snap.settled[0].workspaceBreakdown).toBeUndefined();

        const summary = buildGMSummaryFromLedger({
            dateKey: '2026-11-28',
            accounts: {
                'a@example.com': {
                    ...snap.accounts['a@example.com'],
                    workspaceBreakdown: polluted,
                },
            },
            settled: [],
        });
        expect(summary.workspaceBreakdown).toBeUndefined();
        expect(({} as Record<string, unknown>).calls).toBeUndefined();
    });

    it('R3-P1-6: PricingStore.reloadFromStorage syncs committed pricing into memory without issuing a second globalState.update', async () => {
        const backing: Record<string, unknown> = {
            customModelPricing: {
                'claude-sonnet-4': { input: 2.5, output: 12 },
                'app-concurrent-model': { input: 1, output: 4 },
            },
        };
        const updateSpy = vi.fn(async (k: string, v: unknown) => { backing[k] = v; });
        const store = new PricingStore();
        store.init({
            get: <T>(k: string, d: T) => (k in backing ? backing[k] as T : d),
            update: updateSpy,
        });
        backing.customModelPricing = {
            'claude-sonnet-4': { input: 3.5, output: 15 },
            'app-concurrent-model': { input: 1, output: 4 },
        };
        store.reloadFromStorage();
        expect(updateSpy).not.toHaveBeenCalled();
        expect(store.getCustom()['claude-sonnet-4']?.input).toBe(3.5);
        expect(store.getCustom()['app-concurrent-model']?.input).toBe(1);
    });

    it('R3-P1-7: App /context scopes per window, syncHostFocus without windowId stays masked, and unresolved CDP target stays masked', async () => {
        const tmp = makeTmpDir('acm-w36-priv-');
        let capturedPayloadForTarget: ((targetId: string, common: any) => any) | null = null;
        const provider = createSidecarRuntimeProvider({
            statePath: path.join(tmp, 'state.json'),
            autoStart: false,
            disableCliScan: true,
            deps: {
                homedir: () => tmp,
                discoverLS: async () => ({ pid: 2001, csrfToken: 't', port: 40001, useTls: false }),
                fetchFullUserStatus: async () => ({ configs: [], userInfo: { name: 'Alice', email: 'alice@secret.test', planName: 'Pro' }, quotaSummary: null }),
                getAllTrajectories: async () => [
                    { cascadeId: 'cid-win1', summary: 'Win1 Secret Title', stepCount: 5, status: CascadeStatus.IDLE, lastModifiedTime: '2026-11-28T00:00:01Z', workspaceUris: ['file:///secret/win1-repo'] },
                    { cascadeId: 'cid-win2', summary: 'Win2 Safe Title', stepCount: 3, status: CascadeStatus.IDLE, lastModifiedTime: '2026-11-28T00:00:00Z', workspaceUris: ['file:///safe/win2-repo'] },
                ],
                getContextUsage: async (_ls, tr) => ({
                    cascadeId: tr.cascadeId,
                    title: tr.summary,
                    model: 'MODEL_CLAUDE_4_SONNET',
                    modelDisplayName: 'Claude Sonnet 4',
                    contextUsed: tr.cascadeId === 'cid-win1' ? 50_000 : 12_000,
                    totalOutputTokens: 500,
                    totalToolCallOutputTokens: 0,
                    contextLimit: 200_000,
                    usagePercent: 10,
                    stepCount: tr.stepCount,
                    lastModifiedTime: tr.lastModifiedTime,
                    status: tr.status,
                    isEstimated: false,
                    imageGenStepCount: 0,
                    imageGenerationModels: [],
                }),
                fetchTrajectoryGeneratorMetadata: async () => [],
                fetchTrajectorySteps: async () => ({ ok: true, steps: [], hasGaps: false }),
                fetchOrchestratorSettings: async () => null,
                fetchUserQuotaSummary: async () => null,
                fetchAvailableModels: async () => null,
                processActivity: async () => false,
                fetchGM: async () => null,
                createCdpOverlayManager: ((opts: any) => {
                    capturedPayloadForTarget = opts.payloadForTarget;
                    return {
                        getStatus: () => ({ state: 'idle', composerEnabled: false, topBarEnabled: false }),
                        updatePayload: async () => ({ state: 'idle', composerEnabled: false, topBarEnabled: false }),
                        recheck: async () => ({ state: 'idle', composerEnabled: false, topBarEnabled: false }),
                        dispose: async () => {},
                    };
                }) as any,
            },
        });
        providers.push(provider);
        await provider.pollNow(true);

        // Register win-1 on cid-win1 (unmasked) and win-2 on cid-win2 (unmasked)
        await provider.handleAction({ command: 'syncHostFocus', windowId: 'win-1', conversationId: 'cid-win1', focusRevision: 1, sourceInstanceId: 's1' });
        await provider.handleAction({ command: 'syncHostFocus', windowId: 'win-2', conversationId: 'cid-win2', focusRevision: 1, sourceInstanceId: 's2', isFocusedPane: false });
        await provider.handleAction({ command: 'setPrivacyMask', windowId: 'win-2', masked: false });

        // copyContextReport for background win-2 MUST return win-2's data, never win-1's active repo/title!
        const ctxW2 = await provider.handleAction({ command: 'copyContextReport', windowId: 'win-2' });
        expect(ctxW2.ok).toBe(true);
        const textW2 = String((ctxW2 as any).text || '');
        expect(textW2).toContain('Win2 Safe Title');
        expect(textW2).not.toContain('win1-repo');
        expect(textW2).not.toContain('Win1 Secret Title');

        // syncHostFocus without windowId must stay fail-closed masked even if default was unmasked
        await provider.handleAction({ command: 'setPrivacyMask', windowId: 'default', masked: false });
        const focusNoWin = await provider.handleAction({ command: 'syncHostFocus', conversationId: 'cid-win1', focusRevision: 2, sourceInstanceId: 's0' });
        expect(focusNoWin.snapshot?.privacyMasked).toBe(true);

        // Unresolved CDP target payload stays masked (does not return unmasked common)
        expect(capturedPayloadForTarget).not.toBeNull();
        const unresolvedPayload = capturedPayloadForTarget!('unknown-target', { swarmSummary: { rootTitle: 'LEAKED' } });
        expect(unresolvedPayload?.swarmSummary?.rootTitle).not.toBe('LEAKED');
    });

    it('R3-P1-8: host-bridge persists pending re-mask across reload and retries setPrivacyMask(true) on panelReady', async () => {
        const script = getHostBridgeScript({ autoPoll: false });
        const storage = new Map<string, string>();
        const mockSessionStorage = {
            getItem: (k: string) => storage.get(k) ?? null,
            setItem: (k: string, v: string) => { storage.set(k, v); },
            removeItem: (k: string) => { storage.delete(k); },
        };

        const bootBridge = (fetchImpl: (url: string, opts?: any) => Promise<any>) => {
            const dispatched: any[] = [];
            const listeners = new Map<string, Array<(e: any) => void>>();
            const ctx: any = {
                console, setTimeout, clearTimeout, URLSearchParams, JSON, Promise, Math, Date, Object, Array, String, Number, Boolean, Error, RegExp,
                sessionStorage: mockSessionStorage,
                location: { href: 'http://127.0.0.1:45000/', origin: 'http://127.0.0.1:45000', search: '' },
                document: {
                    hidden: false,
                    body: { dataset: {}, getAttribute: () => null, setAttribute() {}, removeAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } },
                    documentElement: { style: { setProperty() {}, removeProperty() {} }, getAttribute: () => null, setAttribute() {}, removeAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } },
                    addEventListener(ev: string, fn: (e: any) => void) { (listeners.get(ev) || (listeners.set(ev, []), listeners.get(ev)!)).push(fn); },
                    querySelector: () => null,
                    querySelectorAll: () => [],
                },
                addEventListener(ev: string, fn: (e: any) => void) { (listeners.get(ev) || (listeners.set(ev, []), listeners.get(ev)!)).push(fn); },
                dispatchEvent(ev: any) { dispatched.push(ev); return true; },
                CustomEvent: class { constructor(public type: string, public detail?: any) {} },
                matchMedia: () => ({ matches: false, addEventListener() {} }),
                getComputedStyle: () => ({ getPropertyValue: () => '' }),
                fetch: fetchImpl,
                navigator: {},
            };
            ctx.window = ctx;
            ctx.self = ctx;
            vm.runInNewContext(script, ctx);
            return { bridge: ctx.__ACM_BRIDGE__, dispatched };
        };

        // Load 1: setPrivacyMask(true) fails on network -> pendingRemask persisted in sessionStorage
        const b1 = bootBridge(async () => { throw new Error('offline'); });
        await b1.bridge.sendAction({ command: 'setPrivacyMask', masked: true }).catch(() => {});
        const pendingKeys = [...storage.keys()].filter(k => k.includes('pendingRemask'));
        expect(pendingKeys.length).toBe(1);

        // Load 2 (same windowId from sessionStorage): panelReady MUST retry setPrivacyMask(true), NOT paint unmasked GET
        const calls: Array<{ url: string; body?: string }> = [];
        const b2 = bootBridge(async (url: string, opts?: any) => {
            calls.push({ url: String(url), body: opts?.body });
            if (String(url).includes('/api/action')) {
                return { ok: true, status: 200, json: async () => ({ ok: true, snapshot: { privacyMasked: true, tabs: {} } }) };
            }
            return { ok: true, status: 200, json: async () => ({ unchanged: false, snapshot: { privacyMasked: false, tabs: {} } }) };
        });
        await b2.bridge.sendAction({ command: 'panelReady' });
        expect(calls.some(c => c.url.includes('/api/action') && String(c.body || '').includes('"setPrivacyMask"'))).toBe(true);
        // After server confirms privacyMasked: true, pendingRemask is cleared
        expect([...storage.keys()].filter(k => k.includes('pendingRemask'))).toHaveLength(0);
    });

    it('R3-P1-9: Global Rules createOnly(wx), sidecar.json validator, and historical Calendar Swarm range guard', async () => {
        const tmp = makeTmpDir('acm-w36-hardening-');
        // 1. Global Rules createOnly refuses to overwrite an existing GEMINI.md
        const first = writeGlobalRulesFile('# First rules\n', tmp, { createOnly: true });
        expect(first.exists).toBe(true);
        expect(() => writeGlobalRulesFile('# Clobber\n', tmp, { createOnly: true })).toThrow(/already exists|EEXIST/i);
        expect(readGlobalRulesStatus({ homedir: tmp, includeContent: true }).content).toBe('# First rules\n');

        // App saveGlobalRulesFile with createOnly=true returns 409 ALREADY_EXISTS without clobbering
        const provider = createSidecarRuntimeProvider({
            statePath: path.join(tmp, 'state.json'),
            autoStart: false,
            disableCliScan: true,
            deps: { discoverLS: async () => null, homedir: () => tmp, openFileInOs: async () => {}, revealInOs: async () => {} },
        });
        providers.push(provider);
        const conflictRes = await provider.handleAction({ command: 'saveGlobalRulesFile', content: '# Overwrite', createOnly: true, windowId: 'w1' });
        expect(conflictRes.ok).toBe(false);
        expect(conflictRes.statusCode).toBe(409);
        expect(readGlobalRulesStatus({ homedir: tmp, includeContent: true }).content).toBe('# First rules\n');

        // 2. validateExtractedPluginBundle rejects missing sidecar.json
        const bundleDir = path.join(tmp, 'bundle');
        fs.mkdirSync(path.join(bundleDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app'), { recursive: true });
        fs.writeFileSync(path.join(bundleDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-context-monitor', version: '1.18.0' }));
        fs.writeFileSync(path.join(bundleDir, 'sidecars', 'context_monitor', 'main.mjs'), 'export {};');
        for (const f of ['sidecar-bundle.js', 'sidecar-server.js', 'sidecar-runtime.js']) {
            fs.writeFileSync(path.join(bundleDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', f), 'module.exports={};');
        }
        expect(() => validateExtractedPluginBundle(bundleDir)).toThrow(/sidecar\.json/);
        fs.writeFileSync(path.join(bundleDir, 'sidecars', 'context_monitor', 'sidecar.json'), JSON.stringify({ command: 'node', args: ['main.mjs'] }));
        expect(validateExtractedPluginBundle(bundleDir).version).toBe('1.18.0');

        // 3. Calendar historical range outside today does NOT show active live swarmGroupCosts fallback
        const store = new DailyStore();
        const historicalHtml = buildCalendarTabContent(store, 2025, 10, {
            periodMode: 'year',
            now: new Date(2026, 10, 28, 12, 0, 0),
            swarmGroupCosts: {
                'root-today': {
                    rootId: 'root-today',
                    directCostByMember: {},
                    coordinatorDirectCostUsd: 1,
                    workersDirectCostUsd: 0.5,
                    inclusiveGroupCostUsd: 1.5,
                    uniqueCallCount: 3,
                    duplicateCallsDeduplicated: 0,
                    pricedCallCount: 3,
                    unpricedCallCount: 0,
                    hasUnpricedCalls: false,
                },
            },
        });
        expect(historicalHtml).not.toContain('id="calSwarmGroupCost"');
    });

    it('R4-P1-2: setPrivacyMask/togglePrivacyMask pushes overlay immediately and settings/recheck/launcher pushes enforce masked common payload', async () => {
        const tmp = makeTmpDir('acm-w36-r4p12-');
        const pushedPayloads: any[] = [];
        const connectedStatus = { state: 'connected', composerEnabled: true, topBarEnabled: true };
        const provider = createSidecarRuntimeProvider({
            statePath: path.join(tmp, 'state.json'),
            autoStart: false,
            disableCliScan: true,
            deps: {
                homedir: () => tmp,
                discoverLS: async () => ({ pid: 3001, csrfToken: 't', port: 40002, useTls: false }),
                fetchFullUserStatus: async () => ({ configs: [], userInfo: null, quotaSummary: null }),
                getAllTrajectories: async () => [
                    { cascadeId: 'cid-root', summary: 'SecretSwarmRootTitle', stepCount: 4, status: CascadeStatus.IDLE, lastModifiedTime: '2026-11-28T00:00:01Z', workspaceUris: [] },
                    { cascadeId: 'cid-worker', summary: 'SecretSwarmWorkerTitle', stepCount: 2, status: CascadeStatus.IDLE, lastModifiedTime: '2026-11-28T00:00:00Z', workspaceUris: [] },
                ],
                getContextUsage: async (_ls, tr) => ({
                    cascadeId: tr.cascadeId,
                    title: tr.summary,
                    model: 'MODEL_CLAUDE_4_SONNET',
                    modelDisplayName: 'Claude Sonnet 4',
                    contextUsed: 20_000,
                    totalOutputTokens: 500,
                    totalToolCallOutputTokens: 0,
                    contextLimit: 200_000,
                    usagePercent: 10,
                    stepCount: tr.stepCount,
                    lastModifiedTime: tr.lastModifiedTime,
                    status: tr.status,
                    isEstimated: false,
                    imageGenStepCount: 0,
                    imageGenerationModels: [],
                    ...(tr.cascadeId === 'cid-root' ? { imageWorkflow: { linkedCascadeIds: ['cid-worker'], hasImageGeneration: false, totalImageSteps: 0, models: [] } } : {}),
                } as any),
                fetchTrajectoryGeneratorMetadata: async () => [],
                fetchTrajectorySteps: async () => ({ ok: true, steps: [], hasGaps: false }),
                fetchOrchestratorSettings: async () => null,
                fetchUserQuotaSummary: async () => null,
                fetchAvailableModels: async () => null,
                processActivity: async () => false,
                fetchGM: async () => null,
                createCdpLauncher: () => ({ ok: true, messageEn: 'ok', messageZh: 'ok', status: { supported: true, installed: true } } as any),
                createCdpOverlayManager: (() => ({
                    getStatus: () => connectedStatus,
                    setToggles: async () => connectedStatus,
                    updatePayload: async (p: any) => { pushedPayloads.push(p); return connectedStatus; },
                    recheck: async () => connectedStatus,
                    dispose: async () => {},
                })) as any,
            },
        });
        providers.push(provider);
        await provider.pollNow(true);
        await provider.handleAction({ command: 'syncHostFocus', windowId: 'win-1', conversationId: 'cid-root', focusRevision: 1, sourceInstanceId: 's1' });
        await provider.handleAction({ command: 'togglePause', windowId: 'win-1' });
        await provider.handleAction({ command: 'setPrivacyMask', windowId: 'win-1', masked: false });

        // 1. setPrivacyMask(true) and togglePrivacyMask while paused MUST immediately push overlay updates
        pushedPayloads.length = 0;
        await provider.handleAction({ command: 'setPrivacyMask', windowId: 'win-1', masked: true });
        expect(pushedPayloads.length).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(pushedPayloads[pushedPayloads.length - 1].swarmSummary)).not.toContain('SecretSwarm');

        pushedPayloads.length = 0;
        await provider.handleAction({ command: 'togglePrivacyMask', windowId: 'win-1' });
        expect(pushedPayloads.length).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(pushedPayloads[pushedPayloads.length - 1].swarmSummary)).not.toContain('SecretSwarm');

        // 2. Active window is now UNMASKED, yet settings toggle / recheckCdp / setupCdpLauncher MUST still push masked common payload
        pushedPayloads.length = 0;
        await provider.handleAction({ command: 'updateSetting', key: 'appTopBarEnabled', value: true, windowId: 'win-1' });
        expect(pushedPayloads.length).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(pushedPayloads[pushedPayloads.length - 1].swarmSummary)).not.toContain('SecretSwarm');

        pushedPayloads.length = 0;
        await provider.handleAction({ command: 'recheckCdp', windowId: 'win-1' });
        expect(pushedPayloads.length).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(pushedPayloads[pushedPayloads.length - 1].swarmSummary)).not.toContain('SecretSwarm');

        pushedPayloads.length = 0;
        await provider.handleAction({ command: 'setupCdpLauncher', windowId: 'win-1' });
        expect(pushedPayloads.length).toBeGreaterThanOrEqual(1);
        expect(JSON.stringify(pushedPayloads[pushedPayloads.length - 1].swarmSummary)).not.toContain('SecretSwarm');
    });

    it('R4-P1-3: preserves fulfilled final tail page from concurrent batch when prefix fails and retains prefixTailReserveBytes on short tail repair', async () => {
        // 1. Concurrent final group `[prefix 50..100, prefix 100..150, lastPage 150..200]`:
        //    prefix 50..100 exceeds nonFinalCap (isOversizeRpcError) while uncapped lastPage 150..200 succeeds
        //    and consumes remaining bytes so tryTailRecovery cannot re-fetch [150..200).
        const totalSteps = 200;
        const padPrefix = 'P'.repeat(3500);
        const padTail = 'T'.repeat(3900);
        let tailFetches = 0;
        await withHttpServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { startIndex?: number; endIndex?: number };
                const start = Math.max(0, Number(body.startIndex ?? 0));
                const end = Math.min(Number(body.endIndex ?? start + 50), totalSteps);
                if (start === 50) {
                    const steps = Array.from({ length: end - start }, (_, idx) => ({
                        stepIndex: start + idx,
                        type: StepType.PLANNER_RESPONSE,
                        plannerResponse: { response: padPrefix },
                        metadata: { modelUsage: { model: 'MODEL_CLAUDE_4_SONNET', inputTokens: 9000 + start + idx, outputTokens: 200 } },
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                    return;
                }
                if (start === 150) {
                    tailFetches++;
                    const steps = Array.from({ length: end - start }, (_, idx) => ({
                        type: StepType.PLANNER_RESPONSE,
                        plannerResponse: { response: padTail },
                        metadata: { modelUsage: { model: 'MODEL_CLAUDE_4_SONNET', inputTokens: 12000 + start + idx, outputTokens: 300 } },
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ steps }));
                    return;
                }
                const steps = Array.from({ length: end - start }, (_, idx) => ({
                    stepIndex: start + idx,
                    type: StepType.PLANNER_RESPONSE,
                    metadata: { modelUsage: { model: 'MODEL_CLAUDE_4_SONNET', inputTokens: 1000 + start + idx, outputTokens: 100 } },
                }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steps }));
            });
        }, async (ls) => {
            const res = await withTrajectoryPollBudget(
                { ...DEFAULT_SWARM_POLL_BUDGET, maxBytes: 400_000 },
                () => fetchTrajectorySteps(ls, 'cid-r4p13-concurrent-tail', totalSteps),
            );
            expect(tailFetches).toBeGreaterThanOrEqual(1);
            expect(res.suffixRecovered).toBe(true);
            expect(res.suffixStartOffset).toBe(150);
            expect(res.steps).toHaveLength(50);
            expect((res.steps[0] as Record<string, unknown>).stepIndex).toBe(150);
            expect((res.steps[49] as Record<string, unknown>).stepIndex).toBe(199);
        });

        // 2. Sequential short-page repair on final page keeps prefixTailReserveBytes so tryTailRecovery can anchor tail
        const shortTotal = 100;
        const padHeavy = 'H'.repeat(7000);
        await withHttpServer((req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { startIndex?: number; endIndex?: number };
                const start = Math.max(0, Number(body.startIndex ?? 0));
                const end = Math.min(Number(body.endIndex ?? start + 50), shortTotal);
                let sliceEnd = end;
                if (start === 50) { sliceEnd = 60; } // Short final page triggers sequential repair at line 1957
                else if (start >= 60 && start < 90) { sliceEnd = Math.min(start + 15, 90); }
                const heavy = start >= 60 && start < 90;
                const steps = Array.from({ length: Math.max(0, sliceEnd - start) }, (_, idx) => ({
                    stepIndex: start + idx,
                    type: StepType.PLANNER_RESPONSE,
                    ...(heavy ? { plannerResponse: { response: padHeavy } } : {}),
                    metadata: { modelUsage: { model: 'MODEL_CLAUDE_4_SONNET', inputTokens: 5000 + start + idx, outputTokens: 100 } },
                }));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ steps }));
            });
        }, async (ls) => {
            const res = await withTrajectoryPollBudget(
                { ...DEFAULT_SWARM_POLL_BUDGET, maxBytes: 150_000 },
                () => fetchTrajectorySteps(ls, 'cid-r4p13-short-tail-reserve', shortTotal),
            );
            expect(res.suffixRecovered).toBe(true);
            expect(res.suffixStartOffset! + res.steps.length).toBe(shortTotal);
        });
    });

    it('R4-P1-4: locked-target rollback validates targetDir before deleting backupDir', () => {
        const tmp = makeTmpDir('acm-w36-r4p14-');
        const targetDir = path.join(tmp, 'antigravity-context-monitor');
        const sourceDir = path.join(tmp, 'source');
        const writeBundle = (root: string, ver: string, includeRuntime: boolean) => {
            fs.mkdirSync(path.join(root, 'sidecars', 'context_monitor', 'runtime', 'out', 'app'), { recursive: true });
            fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({ name: 'antigravity-context-monitor', version: ver }), 'utf8');
            fs.writeFileSync(path.join(root, 'sidecars', 'context_monitor', 'sidecar.json'), JSON.stringify({ command: 'node', args: ['main.mjs'] }), 'utf8');
            fs.writeFileSync(path.join(root, 'sidecars', 'context_monitor', 'main.mjs'), 'export {};', 'utf8');
            fs.writeFileSync(path.join(root, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-bundle.js'), ver, 'utf8');
            fs.writeFileSync(path.join(root, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-server.js'), ver, 'utf8');
            if (includeRuntime) {
                fs.writeFileSync(path.join(root, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-runtime.js'), ver, 'utf8');
            }
        };
        writeBundle(targetDir, '1.17.9', true);
        writeBundle(sourceDir, '1.18.0', false); // Triggers post-swap validation failure

        let capturedBackupDir = '';
        expect(() => installPluginAtomic(sourceDir, targetDir, {
            skipLock: true,
            version: '1.18.0',
            onBeforeSwap: ({ backupDir }) => {
                capturedBackupDir = backupDir;
                // Simulate corrupted/incomplete restore source so rollback validation fails
                fs.rmSync(path.join(backupDir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', 'sidecar-runtime.js'), { force: true });
            },
            rmPath: (p, opts) => {
                if (path.resolve(p) === path.resolve(targetDir)) {
                    throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
                }
                fs.rmSync(p, opts);
            },
        })).toThrow(/Plugin swap failed and rollback failed/i);
        expect(capturedBackupDir).toBeTruthy();
        expect(fs.existsSync(capturedBackupDir)).toBe(true);
    });

    it('R4-P1-5: masked IDE Calendar maps swarmGroups via HMAC to join redacted archived calls', () => {
        const fakeWebview = {
            html: '',
            postMessage: vi.fn(() => Promise.resolve(true)),
            onDidReceiveMessage: vi.fn(() => ({ dispose() {} })),
        };
        const fakePanel = {
            visible: true,
            webview: fakeWebview,
            reveal: vi.fn(),
            dispose: vi.fn(),
            onDidDispose: vi.fn(() => ({ dispose() {} })),
            onDidChangeViewState: vi.fn(() => ({ dispose() {} })),
        };
        vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(fakePanel as any);

        const now = new Date();
        const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const store = new DailyStore();
        store.mergeRecords({
            version: 1,
            records: {
                [dateKey]: {
                    date: dateKey,
                    cycles: [{
                        startTime: `${dateKey}T00:00:00Z`,
                        endTime: `${dateKey}T23:59:59Z`,
                        totalReasoning: 2,
                        totalToolCalls: 0,
                        totalErrors: 0,
                        totalInputTokens: 300,
                        totalOutputTokens: 150,
                        estSteps: 2,
                        modelNames: ['Claude Sonnet 4'],
                        surface: 'ide',
                        lateMergedCalls: {
                            'cid-swarm-root|c1': {
                                callId: 'cid-swarm-root|c1',
                                cascadeId: 'cid-swarm-root',
                                surface: 'ide',
                                inputTokens: 100,
                                outputTokens: 50,
                                thinkingTokens: 0,
                                cacheReadTokens: 0,
                                cacheCreationTokens: 0,
                                estimatedCost: 1.25,
                            },
                            'cid-swarm-worker|c2': {
                                callId: 'cid-swarm-worker|c2',
                                cascadeId: 'cid-swarm-worker',
                                surface: 'ide',
                                inputTokens: 200,
                                outputTokens: 100,
                                thinkingTokens: 0,
                                cacheReadTokens: 0,
                                cacheCreationTokens: 0,
                                estimatedCost: 2.75,
                            },
                        },
                    }],
                },
            },
        });

        try {
            showMonitorPanel({
                currentUsage: null,
                monitorStatus: 'ready',
                allTrajectoryUsages: [],
                modelConfigs: [],
                userInfo: null,
                dailyStore: store,
                swarmTopology: {
                    backendEpoch: 1,
                    nodesById: new Map(),
                    groupsByRootId: new Map([
                        ['cid-swarm-root', {
                            rootId: 'cid-swarm-root',
                            title: 'Secret Swarm Group Title',
                            coordinatorIds: ['cid-swarm-root'],
                            memberIds: ['cid-swarm-root', 'cid-swarm-worker'],
                            activeMemberIds: ['cid-swarm-root'],
                            killedMemberIds: [],
                            nestedSubSwarmCoordinatorIds: [],
                            hasConflict: false,
                            coordinatorDeleted: false,
                            isStaleManifest: false,
                        }],
                    ]),
                    anomalies: [],
                    lastSweepAtMs: Date.now(),
                    cursorCompletedFullPass: true,
                    scannedDirsInLastSweep: 0,
                    bytesReadInLastSweep: 0,
                    localScanDisabled: false,
                },
            });
            // Fresh panel renders masked by default: archived Swarm calls MUST join via HMAC swarmGroups without leaking raw cascadeIds
            expect(fakeWebview.html).toContain('id="calSwarmGroupCost"');
            expect(fakeWebview.html).toContain('$4.00');
            expect(fakeWebview.html).not.toContain('cid-swarm-root');
            expect(fakeWebview.html).not.toContain('cid-swarm-worker');
        } finally {
            const onDisposeCb = (fakePanel.onDidDispose as any).mock.calls[0]?.[0];
            if (typeof onDisposeCb === 'function') { onDisposeCb(); }
        }
    });
});

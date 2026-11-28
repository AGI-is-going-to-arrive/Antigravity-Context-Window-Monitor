import { createFastDurableState } from './helpers/factories';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CascadeStatus } from '../src/constants';
import { DailyStore } from '../src/daily-store';
import { DurableState, type DurableStateCommitReceipt } from '../src/durable-state';
import { GMTracker, type GMSummary } from '../src/gm-tracker';
import { ActivityTracker } from '../src/activity-tracker';
import { PricingStore } from '../src/pricing-store';
import type { LSInfo } from '../src/discovery';
import type { FullUserStatus, ModelConfig, UserStatusInfo } from '../src/models';
import type { ContextUsage, TrajectorySummary } from '../src/tracker';
import * as backendConnection from '../src/backend-connection';
import * as trackerModule from '../src/tracker';
import * as legacyMigrationModule from '../src/legacy-migration';
import {
    PollRpcCache,
    activate,
    applyLiveModelStatus,
    buildPollRpcCacheKey,
    deactivate,
    getBillingDaysMap,
    getLastUpdateStatusView,
    getLegacyMigrationPromise,
    getLsAuthority,
    getWorkspaceUris,
    groupModelConfigsByQuotaPool,
    hasSameUsageInputs,
    buildIdePublishedObservation,
    applyGMContextToUsage,
    isRepollNeeded,
    inspectSwarmMember,
    getWindowSelectionState,
    markDisplayLanguageModified,
    setAccountBillingDay,
    syncFromDurableStateIfChanged,
    updateSharedAppSetting,
} from '../src/extension';
import {
    getOpaqueAccountHandle,
    isIdePanelPrivacyMasked,
    resolveOpaqueAccountHandle,
    showMonitorPanel,
    updateMonitorPanel,
    validateIdeRevealTarget,
} from '../src/webview-panel';
import { getLanguage } from '../src/i18n';

const tmpDirs: string[] = [];

function makeTmpDir(prefix = 'acm-w1b-ide-'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
}

function makeFakeContext(version = '1.17.11'): {
    context: vscode.ExtensionContext;
    memGlobal: Map<string, unknown>;
    memWorkspace: Map<string, unknown>;
} {
    const memGlobal = new Map<string, unknown>();
    const memWorkspace = new Map<string, unknown>();
    const context = {
        subscriptions: [] as Array<{ dispose(): void }>,
        globalState: {
            get: <T>(k: string, d?: T) => (memGlobal.has(k) ? memGlobal.get(k) : d) as T,
            update: async (k: string, v: unknown) => { memGlobal.set(k, v); },
        },
        workspaceState: {
            get: <T>(k: string, d?: T) => (memWorkspace.has(k) ? memWorkspace.get(k) : d) as T,
            update: async (k: string, v: unknown) => { memWorkspace.set(k, v); },
        },
        extension: { packageJSON: { version } },
    } as unknown as vscode.ExtensionContext;
    return { context, memGlobal, memWorkspace };
}

function makeMockLS(overrides: Partial<LSInfo> = {}): LSInfo {
    return {
        pid: 4242,
        port: 54242,
        csrfToken: 'secret-loopback-csrf-token-never-in-key',
        useTls: false,
        hostname: '127.0.0.1',
        surface: 'ide',
        source: 'hub-file',
        ...overrides,
    };
}

function makeTrajectory(
    cascadeId: string,
    overrides: Partial<TrajectorySummary> = {},
): TrajectorySummary {
    return {
        cascadeId,
        trajectoryId: `traj-${cascadeId}`,
        summary: `Session ${cascadeId}`,
        stepCount: 4,
        status: CascadeStatus.RUNNING,
        lastModifiedTime: '2026-11-27T10:00:00.000Z',
        createdTime: '2026-11-27T09:50:00.000Z',
        requestedModel: 'MODEL_PLACEHOLDER_M535',
        generatorModel: 'MODEL_PLACEHOLDER_M535',
        workspaceUris: ['file:///tmp/ws-root-a'],
        lastUserInputTime: '2026-11-27T09:59:00.000Z',
        lastUserInputStepIndex: 3,
        repositoryName: 'org/repo',
        gitOriginUrl: '',
        branchName: 'main',
        gitRootUri: 'file:///tmp/ws-root-a',
        ...overrides,
    };
}

function makeUsage(traj: TrajectorySummary, overrides: Partial<ContextUsage> = {}): ContextUsage {
    return {
        tokenUsageSource: 'planner',
        trajectoryId: traj.trajectoryId,
        cascadeId: traj.cascadeId,
        title: traj.summary,
        model: traj.requestedModel || 'MODEL_PLACEHOLDER_M535',
        modelDisplayName: 'Gemini 4 Neon (Extra High)',
        contextUsed: 120_000,
        totalOutputTokens: 2_000,
        totalToolCallOutputTokens: 4_000,
        contextLimit: 256_000,
        usagePercent: 46.875,
        stepCount: traj.stepCount,
        lastModifiedTime: traj.lastModifiedTime,
        status: traj.status,
        isEstimated: false,
        lastModelUsage: {
            model: traj.requestedModel || 'MODEL_PLACEHOLDER_M535',
            inputTokens: 100_000,
            outputTokens: 2_000,
            responseOutputTokens: 2_000,
            cacheReadTokens: 18_000,
        },
        estimatedDeltaSinceCheckpoint: 0,
        imageGenStepCount: 0,
        imageGenerationModels: [],
        imageWorkflow: { directStepCount: 0, directModels: [], linkedCascadeIds: [] },
        compressionDetected: false,
        checkpointCompressionDrop: 0,
        hasGaps: false,
        checkpointModel: '',
        createdTime: traj.createdTime,
        lastUserInputTime: traj.lastUserInputTime,
        lastUserInputStepIndex: traj.lastUserInputStepIndex,
        repositoryName: traj.repositoryName,
        gitOriginUrl: traj.gitOriginUrl,
        branchName: traj.branchName,
        gitRootUri: traj.gitRootUri,
        ...overrides,
    };
}

function makeFakeWebviewPanel() {
    const posted: Array<Record<string, unknown>> = [];
    let onMessage: ((msg: Record<string, unknown>) => Promise<void> | void) | undefined;
    let onDispose: (() => void) | undefined;
    const fakePanel = {
        visible: true,
        title: '',
        webview: {
            html: '',
            postMessage: (msg: Record<string, unknown>) => {
                posted.push(msg);
                return Promise.resolve(true);
            },
            onDidReceiveMessage: (cb: (msg: Record<string, unknown>) => Promise<void> | void) => {
                onMessage = cb;
                return { dispose: () => {} };
            },
        },
        reveal: () => {},
        onDidChangeViewState: () => ({ dispose: () => {} }),
        onDidDispose: (cb: () => void) => {
            onDispose = cb;
            return { dispose: () => {} };
        },
    };
    return {
        fakePanel,
        posted,
        getOnMessage: () => onMessage!,
        dispose: () => onDispose?.(),
    };
}

const origWorkspaceFolders = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');
const origOnDidChangeWorkspaceFolders = (vscode.workspace as unknown as Record<string, unknown>).onDidChangeWorkspaceFolders;

afterEach(async () => {
    vi.restoreAllMocks();
    await deactivate();
    delete process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH;
    if (origWorkspaceFolders) {
        Object.defineProperty(vscode.workspace, 'workspaceFolders', origWorkspaceFolders);
    } else {
        (vscode.workspace as unknown as Record<string, unknown>).workspaceFolders = undefined;
    }
    (vscode.workspace as unknown as Record<string, unknown>).onDidChangeWorkspaceFolders = origOnDidChangeWorkspaceFolders;
    while (tmpDirs.length > 0) {
        fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
    }
});

// ─── 1. Decoupling: Zero sidecar-runtime.ts imports in IDE modules ───────────

describe('Wave 1B IDE Decoupling: zero sidecar-runtime.ts dependency', () => {
    it('imports validateExternalUrl from ./core/external-url and has ZERO sidecar-runtime imports in extension.ts & webview-panel.ts', () => {
        const panelSrc = fs.readFileSync(path.resolve(__dirname, '../src/webview-panel.ts'), 'utf8');
        const extSrc = fs.readFileSync(path.resolve(__dirname, '../src/extension.ts'), 'utf8');

        expect(panelSrc).toContain("from './core/external-url'");
        expect(panelSrc).not.toMatch(/sidecar-runtime/);
        expect(extSrc).not.toMatch(/sidecar-runtime/);
    });
});

// ─── 2. Single-Poll PollRpcCache ─────────────────────────────────────────────

describe('Wave 1B PollRpcCache: 6-field key isolation, non-poisoning abort & shouldCache', () => {
    const baseKey = {
        backendEpoch: 1,
        authority: '127.0.0.1:54242:http:pid=4242',
        method: 'GetCascadeTrajectorySteps',
        cascadeId: 'conv-001',
        range: '0:20',
        branchRevision: '20:2026-11-27T10:00:00Z:RUNNING:main',
    };

    it('never leaks csrfToken in getLsAuthority and differentiates all 6 key fields', () => {
        const ls = makeMockLS();
        const auth = getLsAuthority(ls);
        expect(auth).not.toContain(ls.csrfToken);
        expect(auth).toContain('127.0.0.1:54242:http:pid=4242');

        const base = buildPollRpcCacheKey(baseKey);
        expect(buildPollRpcCacheKey({ ...baseKey, backendEpoch: 2 })).not.toBe(base);
        expect(buildPollRpcCacheKey({ ...baseKey, authority: '127.0.0.1:54243:http:pid=4243' })).not.toBe(base);
        expect(buildPollRpcCacheKey({ ...baseKey, method: 'GetCascadeTrajectoryGeneratorMetadata' })).not.toBe(base);
        expect(buildPollRpcCacheKey({ ...baseKey, cascadeId: 'conv-002' })).not.toBe(base);
        expect(buildPollRpcCacheKey({ ...baseKey, range: '0:50' })).not.toBe(base);
        expect(buildPollRpcCacheKey({ ...baseKey, branchRevision: '21:2026-11-27T10:00:05Z:IDLE:main' })).not.toBe(base);
    });

    it('deduplicates equivalent in-flight and sequential requests without poisoning sibling consumers on single-consumer cancel', async () => {
        const cache = new PollRpcCache();
        let fetchCount = 0;
        let upstreamAborted = false;
        let resolveUpstream!: (val: { ok: boolean; steps: number[] }) => void;

        const fetcher = (upstreamSignal: AbortSignal) => {
            fetchCount++;
            upstreamSignal.addEventListener('abort', () => { upstreamAborted = true; });
            return new Promise<{ ok: boolean; steps: number[] }>((resolve) => {
                resolveUpstream = resolve;
            });
        };

        const acA = new AbortController();
        const acB = new AbortController();

        const pA = cache.getOrFetch(baseKey, fetcher, acA.signal, { shouldCache: r => r.ok });
        const pB = cache.getOrFetch(baseKey, fetcher, acB.signal, { shouldCache: r => r.ok });
        expect(fetchCount).toBe(1);

        // Consumer A cancels — must reject ONLY A, never abort upstream or poison B!
        acA.abort();
        await expect(pA).rejects.toThrow('RPC aborted');
        expect(upstreamAborted).toBe(false);

        resolveUpstream({ ok: true, steps: [1, 2, 3] });
        await expect(pB).resolves.toEqual({ ok: true, steps: [1, 2, 3] });

        // Subsequent sequential call in the same poll hits cached value without hitting wire
        const pC = await cache.getOrFetch(baseKey, fetcher, undefined, { shouldCache: r => r.ok });
        expect(pC).toEqual({ ok: true, steps: [1, 2, 3] });
        expect(fetchCount).toBe(1);
    });

    it('aborts upstream ONLY when every subscribed consumer cancels, and never caches shouldCache=false responses', async () => {
        const cache = new PollRpcCache();
        let fetchCount = 0;
        let upstreamAborted = false;

        const ac1 = new AbortController();
        const ac2 = new AbortController();
        const p1 = cache.getOrFetch(
            baseKey,
            (sig) => {
                fetchCount++;
                return new Promise<string>((_res, rej) => {
                    sig.addEventListener('abort', () => {
                        upstreamAborted = true;
                        rej(new Error('upstream aborted'));
                    });
                });
            },
            ac1.signal,
        );
        const p2 = cache.getOrFetch(baseKey, async () => 'unused', ac2.signal);
        expect(fetchCount).toBe(1);

        ac1.abort();
        await expect(p1).rejects.toThrow('RPC aborted');
        expect(upstreamAborted).toBe(false);

        ac2.abort();
        await expect(p2).rejects.toThrow('RPC aborted');
        expect(upstreamAborted).toBe(true);
        expect(cache.inFlightCount).toBe(0);

        // Failed / gapped response (shouldCache returns false) must NOT be cached
        let gapCalls = 0;
        const first = await cache.getOrFetch(
            baseKey,
            async () => {
                gapCalls++;
                return { ok: false, hasGaps: true };
            },
            undefined,
            { shouldCache: r => r.ok && !r.hasGaps },
        );
        expect(first.hasGaps).toBe(true);
        const second = await cache.getOrFetch(
            baseKey,
            async () => {
                gapCalls++;
                return { ok: true, hasGaps: false };
            },
            undefined,
            { shouldCache: r => r.ok && !r.hasGaps },
        );
        expect(second.ok).toBe(true);
        expect(gapCalls).toBe(2);
    });
});

// ─── 3. Wave 1A Producer Wiring & Accuracy in extension.ts ───────────────────

describe('Wave 1B IDE Wiring: minFraction null, fullStatus.ok, cache gating, multi-root, repollNeeded, update check & async migration', () => {
    it('preserves minFraction: null for all-NaN pools (never legacy 1.0) and never triggers false low-quota warnings', () => {
        const nanConfig: ModelConfig = {
            model: 'MODEL_PLACEHOLDER_M535',
            label: 'Gemini 4 Neon',
            supportsImages: false,
            quotaInfo: { remainingFraction: Number.NaN, resetTime: '2026-11-28T00:00:00Z' },
            allowedTiers: [],
            mimeTypeCount: 0,
            isRecommended: false,
            supportedMimeTypes: [],
        };
        const groups = groupModelConfigsByQuotaPool([nanConfig]);
        expect(groups).toHaveLength(1);
        expect(groups[0].minFraction).toBeNull();

        // applyLiveModelStatus rejects ok === false without invoking handlers
        const replaceConfigs = vi.fn();
        const switchAccount = vi.fn();
        const updateQuota = vi.fn();
        expect(
            applyLiveModelStatus(
                { ok: false, configs: [nanConfig], userInfo: { email: 'u@example.test' } as UserStatusInfo },
                { replaceConfigs, switchAccount, updateQuota },
            ),
        ).toBe(false);
        expect(replaceConfigs).not.toHaveBeenCalled();
        expect(switchAccount).not.toHaveBeenCalled();
        expect(updateQuota).not.toHaveBeenCalled();
    });

    it('hasSameUsageInputs rejects cached usage with hasGaps: true', () => {
        const traj = makeTrajectory('conv-gap', { status: 'CASCADE_RUN_STATUS_IDLE' });
        const cleanUsage = makeUsage(traj, { hasGaps: false, status: 'CASCADE_RUN_STATUS_IDLE' });
        const gappedUsage = makeUsage(traj, { hasGaps: true, status: 'CASCADE_RUN_STATUS_IDLE' });
        expect(hasSameUsageInputs(cleanUsage, traj)).toBe(true);
        expect(hasSameUsageInputs(gappedUsage, traj)).toBe(false);
    });

    it('invalidates an idle usage cache when its branch changes at the same step count', () => {
        const trajectory = makeTrajectory('branch', { status: CascadeStatus.IDLE });
        const usage = makeUsage(trajectory);
        expect(hasSameUsageInputs(usage, { ...trajectory, branchName: 'changed' })).toBe(false);
        expect(hasSameUsageInputs(usage, { ...trajectory, trajectoryId: 'replaced' })).toBe(false);
        expect(hasSameUsageInputs({ ...usage, trajectoryId: undefined }, trajectory)).toBe(false);
    });

    it('rejects a cached pre-compaction GM estimate while waiting for a fresh usage sample', () => {
        const usage = makeUsage(makeTrajectory('waiting'), {
            lastModelUsage: null, contextUsed: 124, postCompactionPending: true, isEstimated: true,
        });
        expect(applyGMContextToUsage(usage, 320_000)).toBe(false);
        expect(usage.contextUsed).toBe(124);
    });

    it('replaces the pre-compaction count with an estimate, then accepts the next measured call', () => {
        const usage = makeUsage(makeTrajectory('compacted'));
        for (const [state, used, expected, source] of [
            ['estimated_post_compaction', 0, null, 'unavailable'],
            ['estimated_post_compaction', 1000, 1000, 'breakdown_buckets'],
            ['measured', 3200, 3200, 'gm_usage'],
        ] as const) {
            const observation = buildIdePublishedObservation(usage, {
                summary: null, breakdown: { measurementState: state, usedTokens: used },
            });
            expect(observation?.usedTokens).toBe(expected);
            expect(observation?.isIncomplete).toBe(expected === null);
            expect(observation?.tokenSource).toBe(source);
        }
    });

    it('accepts a positive post-checkpoint estimate from a recovered tail', () => {
        const usage = makeUsage(makeTrajectory('tail'), {
            hasGaps: true, suffixRecovered: true, postCompactionPending: true,
            lastModelUsage: null, isEstimated: true, contextUsed: 125,
        });
        expect(buildIdePublishedObservation(usage, {
            summary: null, breakdown: { measurementState: 'estimated_post_compaction', usedTokens: 125 },
        })).toMatchObject({ isIncomplete: false, usedTokens: 125, tokenSource: 'breakdown_buckets' });
    });

    it('computes version-aware update availability via isUpdateAvailableForVersion (no App vs IDE collision)', async () => {
        const tmp = makeTmpDir('acm-upd-ver-');
        const stateFile = path.join(tmp, 'state.json');
        process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH = stateFile;

        // Simulate App v1.17.9 writing lastUpdateCheck with latestVersion 1.17.10 & hasUpdate: true
        const appState = createFastDurableState(stateFile);
        await appState.updateAppSettings({
            lastUpdateCheck: {
                checkedAt: Date.now(),
                latestVersion: '1.17.10',
                hasUpdate: true,
                etag: '"v11710"',
                releaseUrl: 'https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases/tag/v1.17.10',
                releaseNotesSummary: 'v1.17.10 notes',
                assetName: null,
                assetUrl: null,
                checksumsUrl: null,
                error: null,
            },
        });
        await appState.flush();

        vi.spyOn(backendConnection, 'discoverPreferredBackend').mockResolvedValue(null);
        (vscode.workspace as unknown as Record<string, unknown>).onDidChangeWorkspaceFolders = () => ({ dispose: () => {} });

        // IDE is already on v1.17.11 -> MUST report updateAvailable: false despite App's stored hasUpdate: true!
        const { context } = makeFakeContext('1.17.11');
        activate(context);
        const view = getLastUpdateStatusView();
        expect(view).not.toBeNull();
        expect(view!.currentVersion).toBe('1.17.11');
        expect(view!.latestVersion).toBe('1.17.10');
        expect(view!.updateAvailable).toBe(false);
        expect(view!.hasUpdate).toBe(false);
        expect(view!.status).toBe('up_to_date');

        // Re-activate as older IDE v1.17.9 against the exact same state.json -> MUST report updateAvailable: true!
        await deactivate();
        const { context: olderCtx } = makeFakeContext('1.17.9');
        activate(olderCtx);
        const olderView = getLastUpdateStatusView();
        expect(olderView).not.toBeNull();
        expect(olderView!.currentVersion).toBe('1.17.9');
        expect(olderView!.updateAvailable).toBe(true);
        expect(olderView!.hasUpdate).toBe(true);
        expect(olderView!.status).toBe('update_available');
    });

    it('runs legacy migration asynchronously with settingsGuard so concurrent user language edits are never clobbered', async () => {
        const tmp = makeTmpDir('acm-mig-guard-');
        const stateFile = path.join(tmp, 'state.json');
        process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH = stateFile;

        let resolveExtract!: (res: legacyMigrationModule.LegacyMigrationResult) => void;
        vi.spyOn(legacyMigrationModule, 'extractLegacyDataAsync').mockImplementation(
            () => new Promise((resolve) => { resolveExtract = resolve; }),
        );
        vi.spyOn(backendConnection, 'discoverPreferredBackend').mockResolvedValue(null);
        (vscode.workspace as unknown as Record<string, unknown>).onDidChangeWorkspaceFolders = () => ({ dispose: () => {} });

        const { context } = makeFakeContext('1.18.0');
        // activate() returns immediately without blocking on async extraction
        activate(context);
        const migPromise = getLegacyMigrationPromise();
        expect(migPromise).not.toBeNull();

        // User edits language while async legacy extraction is still in flight
        markDisplayLanguageModified();
        const langBefore = getLanguage();

        resolveExtract({
            status: 'imported',
            data: {
                displayLanguage: langBefore === 'zh' ? 'en' : 'zh',
                dailyStoreState: {
                    version: 1,
                    records: {
                        '2026-10-15': {
                            date: '2026-10-15',
                            cycles: [{
                                startTime: '2026-10-15T00:00:00Z',
                                endTime: '2026-10-15T23:59:59Z',
                                totalReasoning: 5,
                                totalToolCalls: 3,
                                totalErrors: 0,
                                totalInputTokens: 1000,
                                totalOutputTokens: 200,
                                estSteps: 8,
                                modelNames: ['Gemini 4 Neon'],
                                gmTotalCalls: 2,
                                gmTotalTokens: 1200,
                            }],
                        },
                    },
                },
            },
        });

        await migPromise;
        // User's concurrent language edit MUST NOT be overwritten
        expect(getLanguage()).toBe(langBefore);
        // Calendar history WAS still imported and persisted
        const disk = createFastDurableState(stateFile);
        const migratedDaily = disk.globalBucket().get<{ records?: Record<string, unknown> } | null>('dailyStoreState', null);
        expect(migratedDaily?.records?.['2026-10-15']).toBeDefined();
    });

    it('supports multi-root workspaceFolders, worker isolation via resolveIdeAutoFollowConversation, repollNeeded mid-poll, fullStatus.ok & step/meta cache gating', async () => {
        const tmp = makeTmpDir('acm-multiroot-');
        const stateFile = path.join(tmp, 'state.json');
        process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH = stateFile;

        let onWsFoldersChanged: (() => void) | undefined;
        (vscode.workspace as unknown as Record<string, unknown>).onDidChangeWorkspaceFolders = (cb: () => void) => {
            onWsFoldersChanged = cb;
            return { dispose: () => {} };
        };
        const rootA = path.join(tmp, 'root-a');
        const rootB = path.join(tmp, 'root-b');
        fs.mkdirSync(rootA, { recursive: true });
        fs.mkdirSync(rootB, { recursive: true });
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            configurable: true,
            value: [
                { uri: { scheme: 'file', fsPath: rootA, toString: () => `file://${rootA}` } },
                { uri: { scheme: 'file', fsPath: rootB, toString: () => `file://${rootB}` } },
            ],
        });

        expect(getWorkspaceUris()).toEqual([`file://${rootA}`, `file://${rootB}`]);

        // Trajectory in 2nd workspace root + running swarm worker that must NOT hijack IDE auto-follow
        const mainInRootB = makeTrajectory('conv-main-root-b', {
            workspaceUris: [`file://${rootB}`],
            status: 'CASCADE_RUN_STATUS_IDLE',
            lastModifiedTime: '2026-11-27T10:05:00.000Z',
        });
        const workerBurst = makeTrajectory('conv-worker-burst', {
            workspaceUris: [`file://${rootA}`],
            status: CascadeStatus.RUNNING,
            isSubagent: true,
            role: 'worker',
            parentCascadeId: 'conv-main-root-b',
            lastModifiedTime: '2026-11-27T10:06:00.000Z',
        });

        let discoverCount = 0;
        let releaseFirstDiscover!: () => void;
        const firstDiscoverGate = new Promise<void>(r => { releaseFirstDiscover = r; });

        vi.spyOn(backendConnection, 'discoverPreferredBackend').mockImplementation(async () => {
            discoverCount++;
            if (discoverCount === 1) {
                await firstDiscoverGate;
            }
            return makeMockLS({ pid: 4000 + discoverCount, port: 54000 + discoverCount });
        });

        // First poll returns fullStatus.ok = false -> must NOT populate userInfo/configs; second poll returns ok = true
        let statusCalls = 0;
        const warnSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);
        vi.spyOn(trackerModule, 'fetchFullUserStatus').mockImplementation(async () => {
            statusCalls++;
            if (statusCalls === 1) {
                return { ok: false, configs: [], userInfo: null, error: 'transient rpc failure' };
            }
            return {
                ok: true,
                configs: [{
                    model: 'MODEL_PLACEHOLDER_M535',
                    label: 'Gemini 4 Neon',
                    supportsImages: false,
                    // All-NaN quota -> must NEVER trigger low-quota warning
                    quotaInfo: { remainingFraction: Number.NaN, resetTime: '2026-11-28T00:00:00Z' },
                    allowedTiers: [],
                    mimeTypeCount: 0,
                    isRecommended: true,
                    supportedMimeTypes: [],
                }],
                userInfo: {
                    name: 'MultiRoot User',
                    email: 'multiroot@example.test',
                    planName: 'Pro',
                    userTierId: 'pro',
                    userTierName: 'Pro',
                    tierDescription: '',
                    upgradeText: '',
                    upgradeUri: '',
                    promptCredits: 0,
                    flowCredits: 0,
                    availableCredits: [],
                    browserEnabled: true,
                    knowledgeBaseEnabled: true,
                    canBuyMoreCredits: false,
                    monthlyPromptCredits: 0,
                    monthlyFlowCredits: 0,
                    modelSortOrder: [],
                },
            };
        });
        vi.spyOn(trackerModule, 'fetchOrchestratorSettings').mockResolvedValue(null);
        vi.spyOn(trackerModule, 'fetchUserQuotaSummary').mockResolvedValue(null);
        vi.spyOn(trackerModule, 'getAllTrajectories').mockResolvedValue([workerBurst, mainInRootB]);

        const selectedIds: string[] = [];
        vi.spyOn(trackerModule, 'getContextUsage').mockImplementation(async (_ls, traj) => {
            selectedIds.push(traj.cascadeId);
            return makeUsage(traj);
        });
        vi.spyOn(trackerModule, 'refreshWorkflowImageUsage').mockImplementation(async (_ls, u) => u);
        vi.spyOn(ActivityTracker.prototype, 'processTrajectories').mockResolvedValue(false);
        vi.spyOn(GMTracker.prototype, 'fetchAll').mockResolvedValue({
            conversations: [],
            modelBreakdown: {},
            totalCalls: 0,
            totalStepsCovered: 0,
            totalCredits: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCacheRead: 0,
            totalCacheCreation: 0,
            totalThinkingTokens: 0,
            totalRetryCount: 0,
            totalRetryTokens: 0,
            totalRetryCredits: 0,
            stopReasonCounts: {},
            retryErrorCodes: {},
            toolCallCounts: {},
            recentErrors: [],
            contextGrowth: [],
        } as unknown as GMSummary);

        // Step/meta cache gating: first call fails metaRes.ok = false -> must NOT latch;
        // second call returns metaRes.ok = true but stepsRes.hasGaps = true -> STILL must NOT latch;
        // third call returns both ok && !hasGaps -> latches cleanly!
        let metaCalls = 0;
        let stepCalls = 0;
        const metaCascadeIds: string[] = [];
        const stepCascadeIds: string[] = [];
        vi.spyOn(trackerModule, 'fetchTrajectoryGeneratorMetadataResult').mockImplementation(async (_ls, cascadeId) => {
            metaCalls++;
            metaCascadeIds.push(cascadeId);
            if (metaCalls === 1) {
                return { ok: false, metadata: [], error: 'meta failed' };
            }
            return { ok: true, metadata: [] };
        });
        vi.spyOn(trackerModule, 'fetchTrajectorySteps').mockImplementation(async (_ls, cascadeId) => {
            stepCalls++;
            stepCascadeIds.push(cascadeId);
            if (stepCalls === 1) {
                return { ok: true, steps: [], hasGaps: true, error: 'short page gap' };
            }
            return { ok: true, steps: [], hasGaps: false };
        });

        const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
        vi.spyOn(vscode.commands, 'registerCommand').mockImplementation((cmd: string, cb: (...args: unknown[]) => unknown) => {
            registeredCommands.set(cmd, cb);
            return { dispose: () => {} };
        });

        const { fakePanel, dispose } = makeFakeWebviewPanel();
        vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(fakePanel as unknown as vscode.WebviewPanel);

        const { context } = makeFakeContext('1.18.0');
        try {
            showMonitorPanel({
                currentUsage: null,
                allTrajectoryUsages: [],
                modelConfigs: [],
                userInfo: null,
                context,
            });
            activate(context);

            // While the 1st poll is blocked in discovery, fire onDidChangeWorkspaceFolders!
            await vi.waitFor(() => expect(discoverCount).toBe(1));
            onWsFoldersChanged!();
            expect(isRepollNeeded()).toBe(true);

            // Unblock 1st poll -> stale discovery result is discarded and finally MUST immediately trigger poll #2!
            releaseFirstDiscover();
            await vi.waitFor(() => expect(discoverCount).toBeGreaterThanOrEqual(2), { timeout: 5_000 });
            await vi.waitFor(() => expect(metaCalls).toBeGreaterThanOrEqual(1), { timeout: 5_000 });
            // Because metaRes.ok was false on call #1, stepCalls MUST still be 0 (short-circuited & not latched)!
            expect(stepCalls).toBe(0);

            // Trigger poll #3 via refresh -> metaCalls=2 (ok=true), stepCalls=1 (hasGaps=true -> NOT latched!)
            registeredCommands.get('antigravity-context-monitor.refresh')!();
            await vi.waitFor(() => expect(stepCalls).toBeGreaterThanOrEqual(1), { timeout: 5_000 });
            expect(metaCalls).toBeGreaterThanOrEqual(2);

            // Trigger poll #4 via refresh -> because stepCalls=1 had gaps and was NOT latched, retries and succeeds!
            registeredCommands.get('antigravity-context-monitor.refresh')!();
            await vi.waitFor(() => expect(stepCalls).toBeGreaterThanOrEqual(2), { timeout: 5_000 });

            // Multi-root + worker isolation: activeTrajectory MUST be mainInRootB (2nd root), NEVER workerBurst!
            // (Step 6 also fetches background usages for all recent trajectories, while step 5's first call and
            // step 6d's breakdown meta/step fetches run strictly for the selected activeTrajectory.)
            expect(selectedIds[0]).toBe('conv-main-root-b');
            expect(metaCascadeIds.length).toBeGreaterThanOrEqual(2);
            expect(metaCascadeIds.every(id => id === 'conv-main-root-b')).toBe(true);
            expect(stepCascadeIds.length).toBeGreaterThanOrEqual(2);
            expect(stepCascadeIds.every(id => id === 'conv-main-root-b')).toBe(true);
            // All-NaN quota pool NEVER emitted a false low-quota warning!
            expect(warnSpy).not.toHaveBeenCalled();

            // A manual refresh against the same backend retains the inspected target.
            inspectSwarmMember('worker-burst');
            registeredCommands.get('antigravity-context-monitor.refresh')!();
            expect(getWindowSelectionState().inspectedMemberId).toBe('worker-burst');
        } finally {
            dispose();
        }
    });

    it('consumes real DurableState commit receipts (W1A-FIX-3) and NEVER emits configSaved/pricingSaved when disk flush fails', async () => {
        const tmp = makeTmpDir('acm-receipt-');
        const stateFile = path.join(tmp, 'state.json');
        process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH = stateFile;

        const discoverSpy = vi.spyOn(backendConnection, 'discoverPreferredBackend').mockResolvedValue(null);
        (vscode.workspace as unknown as Record<string, unknown>).onDidChangeWorkspaceFolders = () => ({ dispose: () => {} });
        const { context } = makeFakeContext('1.18.0');
        activate(context);
        await vi.waitFor(() => expect(discoverSpy).toHaveBeenCalledTimes(1));
        await new Promise(r => setTimeout(r, 20));

        const failedReceipt: DurableStateCommitReceipt = {
            committed: false,
            revision: 0,
            pendingRevision: 1,
            status: 'failed',
            error: 'EROFS: read-only file system',
            errorCode: 'EROFS',
            retryScheduled: false,
        };
        const flushSpy = vi.spyOn(DurableState.prototype, 'flush').mockResolvedValue(failedReceipt);
        const updateReceiptSpy = vi.spyOn(DurableState.prototype, 'updateAppSettingsWithReceipt').mockImplementation(
            async function (this: DurableState, patch) {
                return { settings: { ...this.getAppSettings(), ...patch }, receipt: failedReceipt };
            },
        );

        // Direct updateSharedAppSetting must report committed: false / ok: false
        const setRes = await updateSharedAppSetting('displayCurrency', 'EUR');
        expect(setRes.ok).toBe(false);
        expect(setRes.committed).toBe(false);
        expect(setRes.error).toContain('EROFS');

        const { fakePanel, posted, getOnMessage, dispose } = makeFakeWebviewPanel();
        vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(fakePanel as unknown as vscode.WebviewPanel);
        const pricingStore = new PricingStore();

        try {
            showMonitorPanel({
                currentUsage: null,
                allTrajectoryUsages: [],
                modelConfigs: [],
                userInfo: null,
                pricingStore,
                context,
            });
            const onMessage = getOnMessage();
            posted.length = 0;

            await onMessage({ command: 'setAppSetting', key: 'displayCurrency', value: 'JPY' });
            await onMessage({ command: 'setPollingInterval', value: 12 });
            await onMessage({ command: 'setConfig', key: 'statusBar.showSpeed', value: true });
            await onMessage({ command: 'setOrchestratorPricingMode', mode: 'strict' });
            await onMessage({ command: 'setPanelPref', key: 'panelShowScrollbar', value: true });
            await onMessage({ command: 'savePricing', overrides: {} });
            await onMessage({ command: 'resetPricing' });

            // ZERO false "Saved" signals while disk commit fails!
            expect(posted.filter(m => m.command === 'configSaved')).toHaveLength(0);
            expect(posted.filter(m => m.command === 'pricingSaved')).toHaveLength(0);
            expect(posted.filter(m => m.command === 'pricingReset')).toHaveLength(0);
            expect(posted.filter(m => m.command === 'configSaveFailed').length).toBeGreaterThanOrEqual(6);

            // Restore real disk flush -> now saving succeeds and emits configSaved!
            flushSpy.mockRestore();
            updateReceiptSpy.mockRestore();
            posted.length = 0;
            await onMessage({ command: 'setAppSetting', key: 'displayCurrency', value: 'GBP' });
            expect(posted.some(m => m.command === 'configSaved' && m.key === 'displayCurrency')).toBe(true);
        } finally {
            dispose();
        }
    });

    it('wires recordCallsDetailed (passing statuses to markLedgerEntriesRecorded), idempotent flushLateDaysToDailyStoreAsync, and async performDailyArchivalAsync', async () => {
        const tmp = makeTmpDir('acm-ledger-wiring-');
        const stateFile = path.join(tmp, 'state.json');
        process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH = stateFile;

        const now = new Date();
        const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 55, 0);
        const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

        // Seed yesterday in DailyStore with 10 existing calls & nonzero activity so we verify idempotent late-day merge (never overwrite!)
        const seedState = createFastDurableState(stateFile);
        await seedState.globalBucket().update('dailyStoreState', {
            version: 1,
            records: {
                [yKey]: {
                    date: yKey,
                    cycles: [{
                        startTime: `${yKey}T00:00:00`,
                        endTime: `${yKey}T23:59:59`,
                        totalReasoning: 7,
                        totalToolCalls: 5,
                        totalErrors: 0,
                        totalInputTokens: 10_000,
                        totalOutputTokens: 2_000,
                        estSteps: 12,
                        modelNames: ['Gemini 4 Neon'],
                        gmTotalCalls: 10,
                        gmTotalTokens: 12_000,
                        recordedCallIds: ['existing-1'],
                    }],
                },
            },
        });
        await seedState.flush();

        const traj = makeTrajectory('conv-late-wiring', {
            status: CascadeStatus.RUNNING,
            workspaceUris: [],
        });

        vi.spyOn(backendConnection, 'discoverPreferredBackend').mockResolvedValue(makeMockLS());
        (vscode.workspace as unknown as Record<string, unknown>).onDidChangeWorkspaceFolders = () => ({ dispose: () => {} });
        vi.spyOn(trackerModule, 'fetchFullUserStatus').mockResolvedValue({
            ok: true,
            configs: [],
            userInfo: null,
        });
        vi.spyOn(trackerModule, 'fetchOrchestratorSettings').mockResolvedValue(null);
        vi.spyOn(trackerModule, 'fetchUserQuotaSummary').mockResolvedValue(null);
        vi.spyOn(trackerModule, 'getAllTrajectories').mockResolvedValue([traj]);
        vi.spyOn(trackerModule, 'getContextUsage').mockResolvedValue(makeUsage(traj));
        vi.spyOn(trackerModule, 'refreshWorkflowImageUsage').mockImplementation(async (_ls, u) => u);
        vi.spyOn(ActivityTracker.prototype, 'processTrajectories').mockResolvedValue(false);
        vi.spyOn(GMTracker.prototype, 'fetchAll').mockResolvedValue({
            conversations: [],
            modelBreakdown: {},
            totalCalls: 0,
            totalStepsCovered: 0,
            totalCredits: 0,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            totalCacheRead: 0,
            totalCacheCreation: 0,
            totalThinkingTokens: 0,
            totalRetryCount: 0,
            totalRetryTokens: 0,
            totalRetryCredits: 0,
            stopReasonCounts: {},
            retryErrorCodes: {},
            toolCallCounts: {},
            recentErrors: [],
            contextGrowth: [],
        } as unknown as GMSummary);

        let emitted = false;
        vi.spyOn(GMTracker.prototype, 'getNewCallsSinceLastRecord').mockImplementation(() => {
            if (emitted) {
                return { entries: [], debug: [], revertedCascadeIds: [] };
            }
            emitted = true;
            return {
                entries: [{
                    cascadeId: 'conv-late-wiring',
                    callIndex: 0,
                    dedupKey: 'conv-late-wiring::exec-late-001',
                    call: {
                        executionId: 'exec-late-001',
                        model: 'MODEL_PLACEHOLDER_M535',
                        modelDisplay: 'Gemini 4 Neon',
                        responseModel: 'gemini-4-neon',
                        inputTokens: 1_500,
                        outputTokens: 300,
                        thinkingTokens: 0,
                        cacheReadTokens: 0,
                        cacheCreationTokens: 0,
                        credits: 1,
                        ttftSeconds: 0.4,
                        streamingSeconds: 1.0,
                        createdAt: yesterday.toISOString(),
                        stepIndices: [1],
                        contextTokensUsed: 1_800,
                    },
                }],
                debug: [],
                revertedCascadeIds: [],
            };
        });
        const markSpy = vi.spyOn(GMTracker.prototype, 'markLedgerEntriesRecorded');

        const { context } = makeFakeContext('1.18.0');
        activate(context);

        await vi.waitFor(() => expect(markSpy).toHaveBeenCalledTimes(1), { timeout: 5_000 });
        // Verify recordCallsDetailed statuses array was passed as 2nd argument to markLedgerEntriesRecorded
        const statusesArg = markSpy.mock.calls[0][1];
        expect(Array.isArray(statusesArg)).toBe(true);
        expect(statusesArg).toEqual(['added']);

        // Verify yesterday's record in DailyStore was idempotently merged (10 + 1 = 11 calls) AND preserved existing activity!
        await vi.waitFor(() => {
            const verifyDisk = createFastDurableState(stateFile);
            const ds = verifyDisk.globalBucket().get<{ records?: Record<string, { cycles: Array<{ gmTotalCalls?: number; totalReasoning?: number }> }> } | null>('dailyStoreState', null);
            const yCycle = ds?.records?.[yKey]?.cycles?.[0];
            expect(yCycle?.gmTotalCalls).toBe(11);
            expect(yCycle?.totalReasoning).toBe(7);
        }, { timeout: 5_000 });
    });
});

// ─── 4. Positive IDE File Reveal Authorization (SEC-04) ──────────────────────

describe('Wave 1B Positive IDE File Reveal Auth (APFS / WSL / Symlink / Multi-root / Fail-closed)', () => {
    it('positively authorizes ONLY active workspace roots, blocks symlink escapes, non-existent targets, and sibling prefix traps', () => {
        const tmp = makeTmpDir('acm-reveal-');
        const ws1 = path.join(tmp, 'ws');
        const ws2 = path.join(tmp, 'ws-second');
        const siblingPrefixTrap = path.join(tmp, 'ws2');
        const outsideDir = path.join(tmp, 'outside');
        fs.mkdirSync(ws1, { recursive: true });
        fs.mkdirSync(ws2, { recursive: true });
        fs.mkdirSync(siblingPrefixTrap, { recursive: true });
        fs.mkdirSync(outsideDir, { recursive: true });

        const fileInWs1 = path.join(ws1, 'src.ts');
        const fileInWs2 = path.join(ws2, 'app.ts');
        const trapFile = path.join(siblingPrefixTrap, 'secret.txt');
        const outsideFile = path.join(outsideDir, 'creds.pem');
        fs.writeFileSync(fileInWs1, 'ok', 'utf8');
        fs.writeFileSync(fileInWs2, 'ok', 'utf8');
        fs.writeFileSync(trapFile, 'secret', 'utf8');
        fs.writeFileSync(outsideFile, 'secret', 'utf8');

        // Symlink inside ws1 pointing outside ws1 -> MUST BE REJECTED!
        const escapeLink = path.join(ws1, 'escape-link.pem');
        fs.symlinkSync(outsideFile, escapeLink);

        const activeRoots = [`file://${ws1}`, `file://${ws2}`];

        // Positive hits inside active multi-root folders
        expect(validateIdeRevealTarget(fileInWs1, { authorizedRoots: activeRoots }).ok).toBe(true);
        expect(validateIdeRevealTarget(`file://${fileInWs2}`, { authorizedRoots: activeRoots }).ok).toBe(true);

        // Symlink escape -> REJECTED
        expect(validateIdeRevealTarget(escapeLink, { authorizedRoots: activeRoots }).ok).toBe(false);
        // Sibling prefix trap (`/tmp/.../ws2` vs `/tmp/.../ws`) -> REJECTED
        expect(validateIdeRevealTarget(trapFile, { authorizedRoots: activeRoots }).ok).toBe(false);
        // Arbitrary outside path -> REJECTED
        expect(validateIdeRevealTarget(outsideFile, { authorizedRoots: activeRoots }).ok).toBe(false);
        // Non-existent file (NO parent dir fallback!) -> REJECTED
        expect(validateIdeRevealTarget(path.join(ws1, 'does-not-exist.ts'), { authorizedRoots: activeRoots }).ok).toBe(false);
        // Empty authorized roots (no active workspace folders) -> FAIL-CLOSED
        expect(validateIdeRevealTarget(fileInWs1, { authorizedRoots: [] }).ok).toBe(false);
        // Unsupported schemes / relative traversal / NUL byte -> REJECTED
        expect(validateIdeRevealTarget('https://github.com/org/repo', { authorizedRoots: activeRoots }).ok).toBe(false);
        expect(validateIdeRevealTarget('vscode-remote://ssh-remote+prod/etc/passwd', { authorizedRoots: activeRoots }).ok).toBe(false);
        expect(validateIdeRevealTarget('../outside/creds.pem', { authorizedRoots: activeRoots }).ok).toBe(false);
        expect(validateIdeRevealTarget(`${fileInWs1}\0.txt`, { authorizedRoots: activeRoots }).ok).toBe(false);
    });

    it('abolishes lexical fallback on canonicalization failure and blind macOS case-folding on APFS / indeterminate volumes', () => {
        const fakeStat = (isDir: boolean) => ({
            isFile: () => !isDir,
            isDirectory: () => isDir,
            dev: 100,
            ino: 200,
        });

        // 1. Canonicalization failure on root or target -> FAIL-CLOSED (zero lexical fallback!)
        const failingRootRes = validateIdeRevealTarget('/Volumes/CaseAPFS/app/src/a.ts', {
            authorizedRoots: ['/Volumes/CaseAPFS/app'],
            platform: 'darwin',
            fsOps: {
                realpathSync: (p) => {
                    if (p === '/Volumes/CaseAPFS/app') { throw new Error('EACCES'); }
                    return p;
                },
                statSync: (p) => fakeStat(p === '/Volumes/CaseAPFS/app'),
            },
        });
        expect(failingRootRes.ok).toBe(false);

        const baseFsOps = {
            realpathSync: (p: string) => p,
            statSync: (p: string) => fakeStat(!p.endsWith('.ts')),
        };

        // 2. macOS case-sensitive APFS (`isCaseSensitivePath -> true`): case mismatch REJECTED!
        expect(
            validateIdeRevealTarget('/Volumes/CaseAPFS/APP/src/a.ts', {
                authorizedRoots: ['/Volumes/CaseAPFS/app'],
                platform: 'darwin',
                isCaseSensitivePath: () => true,
                fsOps: baseFsOps,
            }).ok,
        ).toBe(false);

        // 3. macOS indeterminate volume (`isCaseSensitivePath -> null`): case mismatch FAILS CLOSED!
        expect(
            validateIdeRevealTarget('/Volumes/UnknownVol/APP/src/a.ts', {
                authorizedRoots: ['/Volumes/UnknownVol/app'],
                platform: 'darwin',
                isCaseSensitivePath: () => null,
                fsOps: baseFsOps,
            }).ok,
        ).toBe(false);

        // Exact canonical casing on indeterminate volume is determinate -> allowed
        expect(
            validateIdeRevealTarget('/Volumes/UnknownVol/app/src/a.ts', {
                authorizedRoots: ['/Volumes/UnknownVol/app'],
                platform: 'darwin',
                isCaseSensitivePath: () => null,
                fsOps: baseFsOps,
            }).ok,
        ).toBe(true);

        // 4. Confirmed case-insensitive APFS (`false` on BOTH root and target) -> allowed
        expect(
            validateIdeRevealTarget('/Volumes/InsensitiveAPFS/APP/src/a.ts', {
                authorizedRoots: ['/Volumes/InsensitiveAPFS/app'],
                platform: 'darwin',
                isCaseSensitivePath: () => false,
                fsOps: baseFsOps,
            }).ok,
        ).toBe(true);

        // Nested case-sensitive mount inside case-insensitive root -> REJECTED on case mismatch!
        expect(
            validateIdeRevealTarget('/Volumes/InsensitiveAPFS/APP/sub/a.ts', {
                authorizedRoots: ['/Volumes/InsensitiveAPFS/app'],
                platform: 'darwin',
                isCaseSensitivePath: (p) => (p.includes('/sub/') ? true : false),
                fsOps: baseFsOps,
            }).ok,
        ).toBe(false);
    });

    it('honors WSL distro boundaries and POSIX case sensitivity (Ubuntu != Debian, /Dev != /dev)', () => {
        const fakeWslFsOps = {
            realpathSync: (p: string) => p,
            statSync: (p: string) => ({
                isFile: () => p.endsWith('.ts'),
                isDirectory: () => !p.endsWith('.ts'),
                dev: 1,
                ino: 1,
            }),
        };

        // Same distro + exact POSIX casing -> ALLOWED
        expect(
            validateIdeRevealTarget('\\\\wsl$\\Ubuntu\\home\\dev\\repo\\index.ts', {
                authorizedRoots: ['vscode-remote://wsl+ubuntu/home/dev/repo'],
                platform: 'win32',
                fsOps: fakeWslFsOps,
            }).ok,
        ).toBe(true);

        // Different WSL distro (Debian vs Ubuntu) -> REJECTED
        expect(
            validateIdeRevealTarget('\\\\wsl$\\Debian\\home\\dev\\repo\\index.ts', {
                authorizedRoots: ['vscode-remote://wsl+ubuntu/home/dev/repo'],
                platform: 'win32',
                fsOps: fakeWslFsOps,
            }).ok,
        ).toBe(false);

        // Same WSL distro but different POSIX casing (`/home/DEV` vs `/home/dev`) -> REJECTED!
        expect(
            validateIdeRevealTarget('\\\\wsl$\\Ubuntu\\home\\DEV\\repo\\index.ts', {
                authorizedRoots: ['vscode-remote://wsl+ubuntu/home/dev/repo'],
                platform: 'win32',
                fsOps: fakeWslFsOps,
            }).ok,
        ).toBe(false);

        // Windows extended-length canonical paths (`\\?\C:\...`) match standard root, while `%00` is rejected!
        expect(
            validateIdeRevealTarget('C:\\Users\\Dev\\repo\\index.ts', {
                authorizedRoots: ['C:\\Users\\Dev\\repo'],
                platform: 'win32',
                fsOps: {
                    realpathSync: (p: string) => (p.startsWith('C:') ? `\\\\?\\${p}` : p),
                    statSync: fakeWslFsOps.statSync,
                },
            }).ok,
        ).toBe(true);
        expect(
            validateIdeRevealTarget('file:///home/dev/repo/index.ts%00.txt', {
                authorizedRoots: ['/home/dev/repo'],
                platform: 'linux',
                fsOps: fakeWslFsOps,
            }).ok,
        ).toBe(false);
    });

    it('webview historyAction workspace reveal enforces active workspaceFolders positively and blocks historical/unauthorized paths', async () => {
        const tmp = makeTmpDir('acm-hist-reveal-');
        const activeWs = path.join(tmp, 'active-ws');
        const historicalWs = path.join(tmp, 'historical-swarm-ws');
        fs.mkdirSync(activeWs, { recursive: true });
        fs.mkdirSync(historicalWs, { recursive: true });
        const activeFile = path.join(activeWs, 'main.ts');
        const historicalFile = path.join(historicalWs, 'worker.ts');
        fs.writeFileSync(activeFile, 'ok', 'utf8');
        fs.writeFileSync(historicalFile, 'nope', 'utf8');

        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            configurable: true,
            value: [{ uri: { scheme: 'file', fsPath: activeWs, toString: () => `file://${activeWs}` } }],
        });

        const revealed: string[] = [];
        vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (cmd: string, arg?: unknown) => {
            if (cmd === 'revealFileInOS') {
                revealed.push(String((arg as { fsPath?: string })?.fsPath || arg));
            }
            return undefined;
        });

        const { fakePanel, posted, getOnMessage, dispose } = makeFakeWebviewPanel();
        vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(fakePanel as unknown as vscode.WebviewPanel);

        try {
            showMonitorPanel({
                currentUsage: null,
                allTrajectoryUsages: [],
                allTrajectories: [makeTrajectory('hist-1', { workspaceUris: [`file://${historicalWs}`] })],
                modelConfigs: [],
                userInfo: null,
            });
            const onMessage = getOnMessage();

            // Historical trajectory / swarm workspace NOT in vscode.workspace.workspaceFolders -> BLOCKED!
            await onMessage({ command: 'historyAction', action: 'workspace', uri: `file://${historicalFile}` });
            expect(revealed).toHaveLength(0);
            expect(posted.some(m => m.command === 'historyActionResult' && m.ok === false)).toBe(true);

            // Active workspace folder target -> ALLOWED!
            posted.length = 0;
            await onMessage({ command: 'historyAction', action: 'workspace', uri: `file://${activeFile}` });
            expect(revealed).toHaveLength(1);
            expect(fs.realpathSync(revealed[0])).toBe(fs.realpathSync(activeFile));
            expect(posted.some(m => m.command === 'historyActionResult' && m.ok === true)).toBe(true);
        } finally {
            dispose();
        }
    });
});

// ─── 5. Sentinel Identity Full-Chain Privacy Redaction Test (SEC-04) ─────────

describe('Wave 1B Sentinel Identity Privacy Redaction: ZERO plaintext leak across IDE payload, copy, diagnostics & exports', () => {
    it('emits ZERO sentinel tokens across initial HTML, updateTabs, syncSettingsControls, copy/handoff, and CSV/JSON exports when masked, and supports explicit host unmask/re-mask + opaque handles', async () => {
        const tmp = makeTmpDir('acm-sentinel-');
        const stateFile = path.join(tmp, 'sentinel_os_user_88', '.gemini', 'state-v1.json');
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        process.env.ANTIGRAVITY_CONTEXT_MONITOR_STATE_PATH = stateFile;

        // Sentinel identity strings — NONE of these may appear ANYWHERE while privacy mask is ON!
        const SENTINEL_NAME = 'SentinelOwner_9182';
        // Explicitly test a 1-character email local part (`x@...`) that previously bypassed `^(.{2}).*(@.*)$`!
        const SENTINEL_EMAIL_1CHAR = 'x@sentinel-alpha-9182.example';
        const SENTINEL_EMAIL_DOMAIN = 'sentinel-alpha-9182.example';
        const SENTINEL_BACKUP_NAME = 'SentinelBackup_4420';
        const SENTINEL_BACKUP_EMAIL = 'backup.7731@sentinel-beta-4420.example';
        const SENTINEL_BACKUP_DOMAIN = 'sentinel-beta-4420.example';
        const SENTINEL_WS_PATH = '/Users/sentinel_os_user_88/secret-workspace-7741';
        const SENTINEL_WS_URI = `file://${SENTINEL_WS_PATH}`;
        const SENTINEL_REPO = 'sentinel-org-99/secret-repo-7741';
        const SENTINEL_GIT_ORIGIN = 'https://github.com/sentinel-org-99/secret-repo-7741.git';
        const SENTINEL_STATE_DIR = 'sentinel_os_user_88';

        const ALL_SENTINELS = [
            SENTINEL_NAME,
            SENTINEL_EMAIL_1CHAR,
            SENTINEL_EMAIL_DOMAIN,
            SENTINEL_BACKUP_NAME,
            SENTINEL_BACKUP_EMAIL,
            SENTINEL_BACKUP_DOMAIN,
            SENTINEL_WS_PATH,
            SENTINEL_WS_URI,
            SENTINEL_REPO,
            SENTINEL_GIT_ORIGIN,
            SENTINEL_STATE_DIR,
        ];

        const assertZeroSentinelLeak = (surfaceLabel: string, serialized: string) => {
            for (const token of ALL_SENTINELS) {
                expect(
                    serialized.toLowerCase(),
                    `Sentinel token "${token}" leaked in ${surfaceLabel}!`,
                ).not.toContain(token.toLowerCase());
            }
        };

        const discoverSpy = vi.spyOn(backendConnection, 'discoverPreferredBackend').mockResolvedValue(null);
        (vscode.workspace as unknown as Record<string, unknown>).onDidChangeWorkspaceFolders = () => ({ dispose: () => {} });
        const { context } = makeFakeContext('1.18.0');
        activate(context);
        await vi.waitFor(() => expect(discoverSpy).toHaveBeenCalledTimes(1));
        await new Promise(r => setTimeout(r, 20));

        const sentinelUser: UserStatusInfo = {
            name: SENTINEL_NAME,
            email: SENTINEL_EMAIL_1CHAR,
            planName: 'Google AI Pro',
            userTierId: 'pro',
            userTierName: 'Pro',
            tierDescription: 'Pro Plan',
            upgradeText: '',
            upgradeUri: '',
            promptCredits: 0,
            flowCredits: 0,
            availableCredits: [{ creditType: 'GOOGLE_ONE_AI', creditAmount: 500, minimumCreditAmountForUsage: 1 }],
            browserEnabled: true,
            knowledgeBaseEnabled: true,
            canBuyMoreCredits: false,
            monthlyPromptCredits: 0,
            monthlyFlowCredits: 0,
            modelSortOrder: [],
        };

        const sentinelTraj = makeTrajectory('conv-sentinel-01', {
            summary: `Debug ${SENTINEL_EMAIL_1CHAR} in ${SENTINEL_WS_PATH}`,
            workspaceUris: [SENTINEL_WS_URI],
            repositoryName: SENTINEL_REPO,
            gitOriginUrl: SENTINEL_GIT_ORIGIN,
            gitRootUri: SENTINEL_WS_URI,
        });
        const sentinelUsage = makeUsage(sentinelTraj);

        const dailyStore = new DailyStore();
        dailyStore.restoreSnapshot({
            version: 1,
            records: {
                '2026-11-26': {
                    date: '2026-11-26',
                    cycles: [{
                        startTime: '2026-11-26T00:00:00Z',
                        endTime: '2026-11-26T23:59:59Z',
                        totalReasoning: 10,
                        totalToolCalls: 4,
                        totalErrors: 0,
                        totalInputTokens: 20_000,
                        totalOutputTokens: 3_000,
                        estSteps: 14,
                        modelNames: ['Gemini 4 Neon'],
                        gmTotalCalls: 5,
                        gmTotalTokens: 23_000,
                        estimatedCost: 0.25,
                        accountEmail: SENTINEL_EMAIL_1CHAR,
                        surface: 'ide',
                    }],
                },
            },
        });

        const sentinelGMSummary = {
            conversations: [{
                cascadeId: sentinelTraj.cascadeId,
                title: `Chat for ${SENTINEL_NAME} (${SENTINEL_EMAIL_1CHAR})`,
                totalSteps: 4,
                coveredSteps: 4,
                coverageRate: 1,
                calls: [{
                    model: 'MODEL_PLACEHOLDER_M535',
                    modelDisplay: 'Gemini 4 Neon',
                    responseModel: 'gemini-4-neon',
                    inputTokens: 10_000,
                    outputTokens: 1_500,
                    thinkingTokens: 0,
                    cacheReadTokens: 2_000,
                    cacheCreationTokens: 0,
                    credits: 1,
                    ttftSeconds: 0.5,
                    streamingSeconds: 2.0,
                    createdAt: '2026-11-27T09:55:00.000Z',
                    stepIndices: [1, 2],
                    contextTokensUsed: 12_000,
                    accountEmail: SENTINEL_EMAIL_1CHAR,
                }],
            }],
            modelBreakdown: {},
            totalCalls: 1,
            totalStepsCovered: 4,
            totalCredits: 1,
            totalInputTokens: 10_000,
            totalOutputTokens: 1_500,
            totalCacheRead: 2_000,
            totalCacheCreation: 0,
            totalThinkingTokens: 0,
            totalRetryCount: 0,
            totalRetryTokens: 0,
            totalRetryCredits: 0,
            stopReasonCounts: {},
            retryErrorCodes: {},
            toolCallCounts: { read_file: 2 },
            recentErrors: [`Auth error for ${SENTINEL_EMAIL_1CHAR} at ${SENTINEL_WS_PATH}`],
            contextGrowth: [],
        } as unknown as GMSummary;

        const copiedTexts: string[] = [];
        vi.spyOn(vscode.env.clipboard, 'writeText').mockImplementation(async (txt: string) => {
            copiedTexts.push(txt);
        });

        const exportedFiles = new Map<string, string>();
        let nextExportPath = path.join(tmp, 'export.csv');
        (vscode.window as unknown as Record<string, unknown>).showSaveDialog = vi.fn(async () => vscode.Uri.file(nextExportPath));
        (vscode.workspace.fs as unknown as Record<string, unknown>).writeFile = vi.fn(async (uri: { fsPath: string }, data: Uint8Array) => {
            exportedFiles.set(uri.fsPath, Buffer.from(data).toString('utf8'));
        });

        const { fakePanel, posted, getOnMessage, dispose } = makeFakeWebviewPanel();
        vi.spyOn(vscode.window, 'createWebviewPanel').mockReturnValue(fakePanel as unknown as vscode.WebviewPanel);

        try {
            showMonitorPanel({
                currentUsage: sentinelUsage,
                allTrajectoryUsages: [sentinelUsage],
                allTrajectories: [sentinelTraj],
                modelConfigs: [{
                    model: 'MODEL_PLACEHOLDER_M535',
                    label: 'Gemini 4 Neon',
                    supportsImages: false,
                    quotaInfo: { remainingFraction: Number.NaN, resetTime: '2026-11-28T00:00:00Z' },
                    allowedTiers: [],
                    mimeTypeCount: 0,
                    isRecommended: true,
                    supportedMimeTypes: [],
                }],
                userInfo: sentinelUser,
                workspaceUri: SENTINEL_WS_URI,
                activitySummary: {
                    totalReasoning: 2,
                    totalToolCalls: 2,
                    totalErrors: 0,
                    totalUserInputs: 1,
                    totalCheckpoints: 0,
                    totalSteps: 4,
                    totalThinkingTimeMs: 500,
                    totalToolTimeMs: 200,
                    totalInputTokens: 1000,
                    totalOutputTokens: 200,
                    totalToolReturnTokens: 100,
                    sessionStartTime: '2026-11-27T09:50:00Z',
                    modelStats: {},
                    recentSteps: [{
                        timestamp: '2026-11-27T09:55:00Z',
                        icon: '•',
                        category: 'user',
                        model: 'Gemini 4 Neon',
                        detail: `Read ${SENTINEL_WS_PATH} as ${SENTINEL_NAME}`,
                        durationMs: 10,
                        userInput: `Email ${SENTINEL_EMAIL_1CHAR}`,
                    }],
                    subAgentTokens: [],
                    checkpointHistory: [],
                    quotaResetCount: 0,
                } as unknown as import('../src/activity-tracker').ActivitySummary,
                gmSummary: sentinelGMSummary,
                gmFullSummary: sentinelGMSummary,
                dailyStore,
                pricingStore: new PricingStore(),
                storageDiagnostics: {
                    stateFilePath: stateFile,
                    stateFileExists: true,
                    stateFileSizeBytes: 512,
                    stateFileOpenWarnBytes: 1024 * 1024,
                    calendarDayCount: 1,
                },
                accountSnapshots: [
                    {
                        email: SENTINEL_EMAIL_1CHAR,
                        name: SENTINEL_NAME,
                        planName: 'Pro',
                        tierName: 'Pro',
                        earliestResetTime: '2026-11-28T00:00:00Z',
                        allResetTimes: ['2026-11-28T00:00:00Z'],
                        resetPools: [],
                        isActive: true,
                        lastSeen: '2026-11-27T10:00:00Z',
                    },
                    {
                        email: SENTINEL_BACKUP_EMAIL,
                        name: SENTINEL_BACKUP_NAME,
                        planName: 'Pro',
                        tierName: 'Pro',
                        earliestResetTime: '2026-11-28T00:00:00Z',
                        allResetTimes: ['2026-11-28T00:00:00Z'],
                        resetPools: [],
                        isActive: false,
                        lastSeen: '2026-11-26T10:00:00Z',
                    },
                ],
                todayLedgerActive: [{
                    accountEmail: SENTINEL_EMAIL_1CHAR,
                    surface: 'ide',
                    totalCalls: 2,
                    totalInputTokens: 10_000,
                    totalOutputTokens: 1_500,
                    totalThinkingTokens: 0,
                    totalCacheRead: 2_000,
                    totalCacheCreation: 0,
                    totalCredits: 1,
                    totalEstimatedCost: 0.12,
                    modelStats: {},
                    recordedCallIds: ['c1'],
                    recordedCalls: [],
                }],
                ledgerSettled: [{
                    accountEmail: SENTINEL_BACKUP_EMAIL,
                    settledAt: '2026-11-27T01:00:00Z',
                    poolModelIds: ['MODEL_PLACEHOLDER_M535'],
                    poolModelLabels: ['Gemini 4 Neon'],
                    totalCalls: 1,
                    totalInputTokens: 1000,
                    totalOutputTokens: 200,
                    totalThinkingTokens: 0,
                    totalCacheRead: 0,
                    totalCacheCreation: 0,
                    totalCredits: 0,
                    totalEstimatedCost: 0.01,
                    modelCalls: { 'Gemini 4 Neon': 1 },
                }],
                conversationOptions: [{
                    cascadeId: sentinelTraj.cascadeId,
                    title: `Session for ${SENTINEL_NAME}`,
                    isUntitled: false,
                    isSubagent: false,
                    isActive: true,
                    isLockedMain: false,
                    isRunning: true,
                    matchesWorkspace: true,
                    stepCount: 4,
                    lastModifiedTime: sentinelTraj.lastModifiedTime,
                    model: 'MODEL_PLACEHOLDER_M535',
                    workspaceLabel: 'secret-workspace-7741',
                    branchName: 'main',
                }],
                context,
            });

            // Privacy mask MUST default to ON (fail-closed)
            expect(isIdePanelPrivacyMasked()).toBe(true);

            // 1. Initial HTML document: ZERO sentinel leaks & ZERO data-real attributes
            assertZeroSentinelLeak('initial panel.webview.html', fakePanel.webview.html);
            expect(fakePanel.webview.html).not.toContain('data-real=');
            expect(fakePanel.webview.html).toContain('id="privacyToggle" aria-pressed="true"');

            // Opaque handle is deterministic & reversible ONLY on host
            const primaryHandle = getOpaqueAccountHandle(SENTINEL_EMAIL_1CHAR);
            const backupHandle = getOpaqueAccountHandle(SENTINEL_BACKUP_EMAIL);
            expect(primaryHandle).toMatch(/^acct_[0-9a-f]{12}$/);
            expect(backupHandle).toMatch(/^acct_[0-9a-f]{12}$/);
            expect(primaryHandle).not.toBe(backupHandle);
            expect(resolveOpaqueAccountHandle(primaryHandle)).toBe(SENTINEL_EMAIL_1CHAR);
            expect(fakePanel.webview.html).toContain(primaryHandle);

            const onMessage = getOnMessage();

            // 2. updateTabs + syncSettingsControls payloads via panelReady & updateMonitorPanel: ZERO sentinel leaks
            posted.length = 0;
            await onMessage({ command: 'panelReady' });
            updateMonitorPanel({
                currentUsage: sentinelUsage,
                allTrajectoryUsages: [sentinelUsage],
                modelConfigs: [{
                    model: 'MODEL_PLACEHOLDER_M535',
                    label: 'Gemini 4 Neon',
                    supportsImages: false,
                    quotaInfo: { remainingFraction: Number.NaN, resetTime: '2026-11-28T00:00:00Z' },
                    allowedTiers: [],
                    mimeTypeCount: 0,
                    isRecommended: true,
                    supportedMimeTypes: [],
                }],
                userInfo: sentinelUser,
            });
            const tabsMsgs = posted.filter(m => m.command === 'updateTabs');
            expect(tabsMsgs.length).toBeGreaterThanOrEqual(1);
            assertZeroSentinelLeak('all posted messages (updateTabs + syncSettingsControls)', JSON.stringify(posted));

            // 3. Copy / Handoff / State path / arbitrary copyText actions: ZERO sentinel leaks
            copiedTexts.length = 0;
            await onMessage({ command: 'copyContextReport' });
            await onMessage({ command: 'copyHandoffPrompt' });
            await onMessage({ command: 'copyStatePath' });
            await onMessage({ command: 'copyText', text: `Leak check ${SENTINEL_EMAIL_1CHAR} ${SENTINEL_WS_PATH}` });
            expect(copiedTexts).toHaveLength(4);
            // Also verify unknown quota fraction renders 'N/A' rather than fabricated '0%'
            expect(copiedTexts[0]).toContain('N/A');
            assertZeroSentinelLeak('copyContextReport', copiedTexts[0]);
            assertZeroSentinelLeak('copyHandoffPrompt', copiedTexts[1]);
            assertZeroSentinelLeak('copyStatePath', copiedTexts[2]);
            assertZeroSentinelLeak('copyText', copiedTexts[3]);

            // 4. Calendar CSV & JSON exports: ZERO sentinel leaks
            nextExportPath = path.join(tmp, 'sentinel-export.csv');
            await onMessage({ command: 'calendarExportCsv' });
            nextExportPath = path.join(tmp, 'sentinel-export.json');
            await onMessage({ command: 'calendarExportJson' });
            const exportedCsv = exportedFiles.get(path.join(tmp, 'sentinel-export.csv')) || '';
            const exportedJson = exportedFiles.get(path.join(tmp, 'sentinel-export.json')) || '';
            expect(exportedCsv).toContain('2026-11-26');
            expect(exportedJson).toContain('2026-11-26');
            assertZeroSentinelLeak('calendarExportCsv', exportedCsv);
            assertZeroSentinelLeak('calendarExportJson', exportedJson);

            // 5. Opaque handle actions resolve back to real emails in host memory while masked
            // Pre-seed known account via durableState so setAccountBillingDay accepts primary email
            const diskSeed = createFastDurableState(stateFile);
            await diskSeed.globalBucket().update('accountSnapshots', [
                {
                    email: SENTINEL_EMAIL_1CHAR,
                    name: SENTINEL_NAME,
                    planName: 'Pro',
                    tierName: 'Pro',
                    earliestResetTime: '',
                    allResetTimes: [],
                    resetPools: [],
                    isActive: true,
                    lastSeen: '2026-11-27T10:00:00Z',
                },
                {
                    email: SENTINEL_BACKUP_EMAIL,
                    name: SENTINEL_BACKUP_NAME,
                    planName: 'Pro',
                    tierName: 'Pro',
                    earliestResetTime: '',
                    allResetTimes: [],
                    resetPools: [],
                    isActive: false,
                    lastSeen: '2026-11-26T10:00:00Z',
                },
            ]);
            await diskSeed.flush();
            syncFromDurableStateIfChanged(false);
            // Trigger billing day save using opaque handle (zero plaintext email in client message)
            await onMessage({ command: 'setAccountBillingDay', accountHandle: primaryHandle, day: 19 });
            expect(resolveOpaqueAccountHandle(primaryHandle)).toBe(SENTINEL_EMAIL_1CHAR);
            expect(resolveOpaqueAccountHandle(backupHandle)).toBe(SENTINEL_BACKUP_EMAIL);
            expect(getBillingDaysMap()[SENTINEL_EMAIL_1CHAR]).toBe(19);
            // Verify the opaque handle (not plaintext email) is used for removeAccount
            await onMessage({ command: 'removeAccount', accountHandle: backupHandle });
            const afterRemoveDisk = createFastDurableState(stateFile);
            const remainingSnaps = afterRemoveDisk.globalBucket().get<Array<{ email: string }>>('accountSnapshots', []);
            expect(remainingSnaps.some(s => s.email === SENTINEL_BACKUP_EMAIL)).toBe(false);
            expect(remainingSnaps.some(s => s.email === SENTINEL_EMAIL_1CHAR)).toBe(true);

            // 6. Explicit Unmask requests host re-render & reveals plaintext identity
            posted.length = 0;
            await onMessage({ command: 'setPrivacyMask', masked: false });
            expect(isIdePanelPrivacyMasked()).toBe(false);
            const unmaskedStateMsg = posted.find(m => m.command === 'privacyMaskState');
            expect(unmaskedStateMsg).toMatchObject({ masked: false, privacyMasked: false });
            const unmaskedTabsMsg = posted.find(m => m.command === 'updateTabs') as { tabs: Record<string, string> };
            expect(unmaskedTabsMsg).toBeDefined();
            expect(unmaskedTabsMsg.tabs.profile).toContain(SENTINEL_NAME);
            expect(unmaskedTabsMsg.tabs.profile).toContain(SENTINEL_EMAIL_1CHAR);
            expect(unmaskedTabsMsg.tabs.profile).toContain('id="privacyToggle" aria-pressed="false"');

            // 7. Re-mask clears revealed state & returns to ZERO sentinel leak immediately!
            posted.length = 0;
            await onMessage({ command: 'setPrivacyMask', masked: true });
            expect(isIdePanelPrivacyMasked()).toBe(true);
            const remaskedStateMsg = posted.find(m => m.command === 'privacyMaskState');
            expect(remaskedStateMsg).toMatchObject({ masked: true, privacyMasked: true, clearRevealedCache: true });
            const remaskedTabsMsg = posted.find(m => m.command === 'updateTabs');
            expect(remaskedTabsMsg).toBeDefined();
            assertZeroSentinelLeak('re-masked updateTabs', JSON.stringify(remaskedTabsMsg));
            expect(JSON.stringify(remaskedTabsMsg)).not.toContain('data-real=');
        } finally {
            dispose();
            delete (vscode.window as unknown as Record<string, unknown>).showSaveDialog;
            delete (vscode.workspace.fs as unknown as Record<string, unknown>).writeFile;
        }
    });
});

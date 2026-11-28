// Consolidated Domain Suite: Context Jump Regressions & Extension Selection
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { getHostBridgeScript } from '../src/app/host-bridge';
import { createSidecarRuntimeProvider, type SidecarRuntimeDeps, type SidecarRuntimeProvider } from '../src/app/sidecar-runtime';
import { createSidecarHandler } from '../src/app/sidecar-server';
import type { CdpOverlayPayload, CdpStatus } from '../src/app/sidecar-types';
import type { CdpAmbientOverlayManager } from '../src/app/cdp-injector';
import { CascadeStatus } from '../src/constants';
import { buildConversationOptions, type ConversationTrajectoryLike, isSubagentTrajectory, resolveTargetConversation } from '../src/conversation-selector';
import type { LSInfo } from '../src/discovery';
import type { GMSummary } from '../src/gm-tracker';
import type { FullUserStatus, ModelConfig } from '../src/models';
import { rpcCall } from '../src/rpc-client';
import {
    type ContextUsage,
    extractLinkedSubagentIds,
    getAllTrajectories,
    processSteps,
    type RawGeneratorMetadataEntry,
    type TrajectorySummary,
} from '../src/tracker';
import {
    buildUsageScopeTrajectories,
    comparePoolResetTimes,
    groupModelConfigsByQuotaPool,
    hasAuxiliaryMetadataChanged,
    parsePositivePoolResetMs,
    selectRunningTrajectoryCandidate,
    shouldSettleOnResetTimeChange,
} from '../src/extension';

vi.mock('../src/rpc-client', () => ({
    rpcCall: vi.fn(),
    rpcStreamFirstFrame: vi.fn(),
}));

describe('[context-jump-regression]', () => {
    function makeLS(): LSInfo {
        return {
            pid: 7777,
            port: 62505,
            csrfToken: 'ctx-jump-test-csrf',
            useTls: false,
            hostname: '127.0.0.1',
            surface: 'app',
            source: 'hub-file',
        };
    }


    function makeConfigs(): ModelConfig[] {
        return [
            {
                model: 'MODEL_PLACEHOLDER_M37',
                label: 'Gemini 3.1 Pro (High)',
                supportsImages: true,
                quotaInfo: {
                    remainingFraction: 0.78,
                    resetTime: '2026-11-27T15:00:00.000Z',
                },
                allowedTiers: ['pro'],
                mimeTypeCount: 2,
                isRecommended: true,
                supportedMimeTypes: ['image/png'],
            },
        ];
    }


    function makeUserStatus(): FullUserStatus {
        return {
            configs: makeConfigs(),
            userInfo: {
                name: 'Dev User',
                email: 'dev@example.com',
                planName: 'Google AI Pro',
                teamsTier: '',
                userTierId: 'tier-pro',
                userTierName: 'Pro',
                defaultModelLabel: 'Gemini 3.1 Pro (High)',
                planLimits: {
                    maxNumChatInputTokens: 0,
                    maxNumPremiumChatMessages: 0,
                    maxCustomChatInstructionCharacters: 0,
                    maxNumPinnedContextItems: 0,
                    maxLocalIndexSize: 0,
                    monthlyFlexCreditPurchaseAmount: 0,
                },
                teamConfig: {
                    allowMcpServers: true,
                    allowAutoRunCommands: true,
                    allowBrowserExperimentalFeatures: false,
                },
                availableCredits: [],
                canBuyMoreCredits: true,
                browserEnabled: true,
                cascadeWebSearchEnabled: true,
                knowledgeBaseEnabled: true,
                canGenerateCommitMessages: true,
                cascadeCanAutoRunCommands: true,
                canAllowCascadeInBackground: true,
                hasAutocompleteFastMode: true,
                allowStickyPremiumModels: true,
                allowPremiumCommandModels: true,
                hasTabToJump: true,
                canCustomizeAppIcon: true,
                userTierDescription: '',
                upgradeSubscriptionText: '',
                modelSortOrder: [],
            },
        };
    }


    function makeTraj(
        cascadeId: string,
        overrides: Partial<TrajectorySummary> = {},
    ): TrajectorySummary {
        return {
            cascadeId,
            trajectoryId: `traj-${cascadeId}`,
            summary: `Chat ${cascadeId}`,
            stepCount: 10,
            status: 'CASCADE_RUN_STATUS_IDLE',
            lastModifiedTime: '2026-11-27T10:00:00.000Z',
            createdTime: '2026-11-27T09:00:00.000Z',
            requestedModel: 'MODEL_PLACEHOLDER_M37',
            generatorModel: 'MODEL_PLACEHOLDER_M37',
            workspaceUris: ['file:///Users/dev/project-main'],
            lastUserInputTime: '2026-11-27T09:59:00.000Z',
            lastUserInputStepIndex: 8,
            repositoryName: 'project-main',
            gitOriginUrl: '',
            branchName: 'main',
            gitRootUri: 'file:///Users/dev/project-main',
            ...overrides,
        };
    }


    function makeUsageForPercent(
        traj: TrajectorySummary,
        pct: number,
        contextLimit = 256_000,
    ): ContextUsage {
        const contextUsed = Math.round((pct / 100) * contextLimit);
        const hasMeasured = pct > 0 && traj.stepCount > 0;
        return {
            tokenUsageSource: hasMeasured ? 'planner' : 'estimated',
            cascadeId: traj.cascadeId,
            title: traj.summary,
            model: traj.requestedModel || 'MODEL_PLACEHOLDER_M37',
            modelDisplayName: 'Gemini 3.1 Pro (High)',
            contextUsed,
            totalOutputTokens: hasMeasured ? 1_200 : 0,
            totalToolCallOutputTokens: 0,
            contextLimit,
            usagePercent: pct,
            stepCount: traj.stepCount,
            lastModifiedTime: traj.lastModifiedTime,
            status: traj.status,
            isEstimated: !hasMeasured,
            lastModelUsage: hasMeasured
                ? {
                    model: traj.requestedModel || 'MODEL_PLACEHOLDER_M37',
                    inputTokens: Math.max(0, contextUsed - 1_200),
                    outputTokens: 1_200,
                    responseOutputTokens: 800,
                    cacheReadTokens: 0,
                }
                : null,
            estimatedDeltaSinceCheckpoint: 0,
            imageGenStepCount: 0,
            imageGenerationModels: [],
            imageGenerationIncomplete: false,
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
        };
    }


    function makeGmEntriesForPercent(pct: number, contextLimit = 256_000): RawGeneratorMetadataEntry[] {
        if (pct <= 0) { return []; }
        const promptTokens = Math.round((pct / 100) * contextLimit) - 1_000;
        return [
            {
                stepIndices: [1, 2],
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M37',
                    timeToFirstToken: '0.4s',
                    streamingDuration: '1.5s',
                    usage: {
                        inputTokens: promptTokens,
                        cacheReadTokens: 0,
                        outputTokens: 1_000,
                        responseOutputTokens: 800,
                    },
                    promptSections: [
                        { title: 'System Prompt', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', numTokens: promptTokens },
                    ],
                },
            },
        ];
    }


    function makeRecordingOverlayManager(pushedPayloads: CdpOverlayPayload[]): CdpAmbientOverlayManager {
        const status: CdpStatus = {
            state: 'connected',
            diagnosticCode: 'connected',
            composerEnabled: true,
            topBarEnabled: true,
            targetUrl: 'https://127.0.0.1:49999/',
            targetTitle: 'Antigravity',
            platformGuide: { platform: 'darwin', command: 'open', en: 'en', zh: 'zh' },
        };
        return {
            getStatus: () => ({ ...status }),
            setToggles: async () => ({ ...status }),
            updatePayload: async (payload: CdpOverlayPayload) => {
                pushedPayloads.push(payload);
                return { ...status };
            },
            dispose: async () => {},
        };
    }


    describe('context-jump regression: tracker metadata, swarm detection, and 0-step zeroing', () => {
        it('returns 0 context tokens for a brand-new 0-step conversation in processSteps([])', () => {
            const res = processSteps([]);
            expect(res.contextUsed).toBe(0);
            expect(res.inputTokens).toBe(0);
            expect(res.totalOutputTokens).toBe(0);
            expect(res.lastModelUsage).toBeNull();
            expect(res.tokenUsageSource).toBe('estimated');
            expect(res.estimatedDeltaSinceCheckpoint).toBe(0);
        });

        it('detects Antigravity Swarm workers by worktree path and branch name with zero false positives', () => {
            const macSwarmWorker: ConversationTrajectoryLike = {
                cascadeId: 'worker-mac-1',
                summary: 'Fix cross-session context jump bug', // ordinary generated title, NOT prefixed!
                workspaceUris: [
                    'file:///Users/alice/.gemini/antigravity/worktrees/0323401e-1fdf-418a-a0eb-8697e0becc9f/swarm-bug-ctx-jump-9d32e585',
                ],
                branchName: 'swarm-bug-ctx-jump-9d32e585',
            };
            const winSwarmWorker: ConversationTrajectoryLike = {
                cascadeId: 'worker-win-1',
                summary: 'Implement regression tests',
                workspaceUris: [
                    'C:\\Users\\Alice\\.gemini\\antigravity\\worktrees\\parent-uuid\\swarm-test-runner-a1b2c3d4',
                ],
                branchName: 'main',
            };
            const branchOnlySwarmWorker: ConversationTrajectoryLike = {
                cascadeId: 'worker-branch-1',
                summary: 'Audit tooltips across tabs',
                workspaceUris: ['file:///Users/alice/repo'],
                branchName: 'swarm-tabs-meta-487645d5',
            };
            const coordinatorChat: ConversationTrajectoryLike = {
                cascadeId: 'coord-1',
                summary: 'Coordinate swarm fix for context jump',
                workspaceUris: ['file:///Users/alice/repo'],
                branchName: 'main',
                trajectoryMetadata: { swarmId: 'swarm-1', role: 'coordinator' },
            };
            const normalChatMentioningSwarm: ConversationTrajectoryLike = {
                cascadeId: 'user-normal-1',
                summary: 'Why did my swarm worker cause a 54% context jump?',
                workspaceUris: ['file:///Users/alice/repo'],
                branchName: 'fix/swarm-context-jump',
            };

            expect(isSubagentTrajectory(macSwarmWorker)).toBe(true);
            expect(isSubagentTrajectory(winSwarmWorker)).toBe(true);
            expect(isSubagentTrajectory(branchOnlySwarmWorker)).toBe(true);
            expect(isSubagentTrajectory(coordinatorChat)).toBe(false);
            expect(isSubagentTrajectory(normalChatMentioningSwarm)).toBe(false);

            const opts = buildConversationOptions([macSwarmWorker, coordinatorChat, normalChatMentioningSwarm]);
            expect(opts.find(o => o.cascadeId === 'worker-mac-1')?.isSubagent).toBe(true);
            expect(opts.find(o => o.cascadeId === 'coord-1')?.isSubagent).toBe(false);
            expect(opts.find(o => o.cascadeId === 'user-normal-1')?.isSubagent).toBe(false);
        });

        it('preserves subagent/swarm metadata and sorts brand-new createdTime-only conversations first in getAllTrajectories()', async () => {
            vi.mocked(rpcCall).mockResolvedValueOnce({
                trajectorySummaries: {
                    'conv-old-54': {
                        summary: 'Older Heavy Session',
                        stepCount: 40,
                        status: 'CASCADE_RUN_STATUS_IDLE',
                        createdTime: '2026-11-27T09:00:00.000Z',
                        lastModifiedTime: '2026-11-27T10:00:00.000Z',
                    },
                    'conv-brand-new': {
                        summary: '',
                        stepCount: 0,
                        status: 'CASCADE_RUN_STATUS_IDLE',
                        createdTime: '2026-11-27T10:05:00.000Z',
                        lastModifiedTime: '', // brand-new trajectory before first write
                    },
                    'conv-swarm-worker': {
                        summary: 'Worker Task',
                        stepCount: 15,
                        status: CascadeStatus.RUNNING,
                        createdTime: '2026-11-27T10:02:00.000Z',
                        lastModifiedTime: '2026-11-27T10:04:00.000Z',
                        isSubagent: true,
                        role: 'worker',
                        swarmId: 'swarm-42',
                        swarmMetadata: { spawnedBy: 'coordinator' },
                    },
                },
            });

            const list = await getAllTrajectories(makeLS());
            expect(list.map(t => t.cascadeId)).toEqual(['conv-brand-new', 'conv-swarm-worker', 'conv-old-54']);
            const worker = list.find(t => t.cascadeId === 'conv-swarm-worker')!;
            expect(worker.isSubagent).toBe(true);
            expect(worker.role).toBe('worker');
            expect(worker.swarmId).toBe('swarm-42');
            expect(isSubagentTrajectory(worker)).toBe(true);
        });

        it('extracts linked child IDs from both invokeSubagent and native swarm spawn steps', () => {
            const ids = extractLinkedSubagentIds([
                {
                    type: 'CORTEX_STEP_TYPE_INVOKE_SUBAGENT',
                    invokeSubagent: {
                        results: [
                            { conversationId: 'sub-a' },
                            { cascadeId: 'sub-b' },
                        ],
                    },
                },
                {
                    type: 'CORTEX_STEP_TYPE_SWARM',
                    swarm: {
                        workers: [
                            { conversationId: 'swarm-w1' },
                            { cascadeId: 'swarm-w2' },
                        ],
                    },
                },
            ]);
            expect(ids.sort()).toEqual(['sub-a', 'sub-b', 'swarm-w1', 'swarm-w2']);
        });
    });


    describe('context-jump regression: resolveTargetConversation anti-hijack & pending-host guards', () => {
        it('holds pending 0% on a brand-new hostConversationId not yet in trajectories instead of falling back to a 54% session', () => {
            const old54 = makeTraj('conv-old-54', {
                status: CascadeStatus.RUNNING,
                stepCount: 45,
                lastModifiedTime: '2026-11-27T10:05:00.000Z',
            });

            // Auto-follow mode
            const autoRes = resolveTargetConversation({
                trajectories: [old54],
                hostConversationId: 'conv-new-b',
                currentActiveId: 'conv-old-54',
                workspaceUris: ['file:///Users/dev/project-main'],
            });
            expect(autoRes.cascadeId).toBe('conv-new-b');
            expect(autoRes.target).toBeNull();
            expect(autoRes.hostPending).toBe(true);
            expect(autoRes.reason).toBe('host_conversation_pending');

            // Lock to Main Agent mode (§3.2): pending-host applies ONLY to unlocked navigation;
            // an unseen passive hostConversationId MUST NOT displace an active `lockedMainId`!
            const lockRes = resolveTargetConversation({
                trajectories: [old54],
                lockToMainAgent: true,
                lockedMainId: 'conv-old-54',
                hostConversationId: 'conv-new-b',
                currentActiveId: 'conv-old-54',
                workspaceUris: ['file:///Users/dev/project-main'],
            });
            expect(lockRes.cascadeId).toBe('conv-old-54');
            expect(lockRes.target?.cascadeId).toBe('conv-old-54');
            expect(lockRes.hostPending).toBe(false);
            expect(lockRes.lockedMainId).toBe('conv-old-54');
            expect(lockRes.retargetOfferId).toBe('conv-new-b');
            expect(lockRes.reason).toBe('locked_main_preserved');
        });

        it('prevents older background RUNNING or IDLE 54% session from hijacking a brand-new 0-step or 9% conversation', () => {
            const old54Running = makeTraj('conv-old-54', {
                status: CascadeStatus.RUNNING,
                stepCount: 42,
                createdTime: '2026-11-27T09:00:00.000Z',
                lastUserInputTime: '2026-11-27T09:50:00.000Z',
                lastModifiedTime: '2026-11-27T10:06:00.000Z',
            });
            const newZeroSteps = makeTraj('conv-new-b', {
                status: 'CASCADE_RUN_STATUS_IDLE',
                stepCount: 0,
                createdTime: '2026-11-27T10:05:00.000Z',
                lastUserInputTime: '',
                lastModifiedTime: '',
                workspaceUris: [], // workspace not bound yet on 0-step chat
            });

            // Poll 1: brand-new conversation appears -> immediately selected despite old 54% RUNNING!
            const r1 = resolveTargetConversation({
                trajectories: [old54Running, newZeroSteps],
                currentActiveId: 'conv-old-54',
                newlyCreatedIds: new Set(['conv-new-b']),
                workspaceUris: ['file:///Users/dev/project-main'],
            });
            expect(r1.cascadeId).toBe('conv-new-b');
            expect(r1.reason).toBe('new_main_conversation');

            // Poll 2: no longer in newlyCreatedIds, still 0 steps IDLE while old 54% is still RUNNING -> MUST stay on conv-new-b!
            const r2 = resolveTargetConversation({
                trajectories: [old54Running, newZeroSteps],
                currentActiveId: 'conv-new-b',
                currentActiveSinceMs: Date.parse('2026-11-27T10:05:00.000Z'),
                workspaceUris: ['file:///Users/dev/project-main'],
            });
            expect(r2.cascadeId).toBe('conv-new-b');
            expect(r2.reason).toBe('active_idle_preserved');

            // Poll 3: conv-new-b completes Turn 1 (9%, IDLE) while old 54% gets background lastModifiedTime bump (IDLE) -> stays on conv-new-b!
            const new9Idle = makeTraj('conv-new-b', {
                status: 'CASCADE_RUN_STATUS_IDLE',
                stepCount: 2,
                createdTime: '2026-11-27T10:05:00.000Z',
                lastUserInputTime: '2026-11-27T10:05:10.000Z',
                lastModifiedTime: '2026-11-27T10:05:20.000Z',
            });
            const old54BumpedIdle = makeTraj('conv-old-54', {
                status: 'CASCADE_RUN_STATUS_IDLE',
                stepCount: 43,
                createdTime: '2026-11-27T09:00:00.000Z',
                lastUserInputTime: '2026-11-27T09:50:00.000Z',
                lastModifiedTime: '2026-11-27T10:07:00.000Z', // async checkpoint/summary bump
            });
            const r3 = resolveTargetConversation({
                trajectories: [old54BumpedIdle, new9Idle],
                currentActiveId: 'conv-new-b',
                workspaceUris: ['file:///Users/dev/project-main'],
            });
            expect(r3.cascadeId).toBe('conv-new-b');
            expect(r3.reason).toBe('active_idle_preserved');

            // Poll 4: user genuinely switches back to conv-old-54 and sends a new prompt -> switches cleanly!
            const old54UserPrompted = makeTraj('conv-old-54', {
                status: CascadeStatus.RUNNING,
                stepCount: 44,
                createdTime: '2026-11-27T09:00:00.000Z',
                lastUserInputTime: '2026-11-27T10:08:00.000Z',
                lastModifiedTime: '2026-11-27T10:08:01.000Z',
            });
            const r4 = resolveTargetConversation({
                trajectories: [old54UserPrompted, new9Idle],
                currentActiveId: 'conv-new-b',
                workspaceUris: ['file:///Users/dev/project-main'],
            });
            expect(r4.cascadeId).toBe('conv-old-54');
            expect(r4.reason).toBe('running_in_workspace');
        });

        it('blocks rapid Swarm worker / subagent bursts from hijacking an active 9% main conversation even with lockToMainAgent=false', () => {
            const main9 = makeTraj('conv-main-9', {
                status: 'CASCADE_RUN_STATUS_IDLE',
                stepCount: 4,
                lastUserInputTime: '2026-11-27T10:05:00.000Z',
                lastModifiedTime: '2026-11-27T10:05:15.000Z',
            });
            const swarmWorker54 = makeTraj('conv-swarm-54', {
                summary: 'Analyze overlay anchoring edge cases',
                status: CascadeStatus.RUNNING,
                stepCount: 28,
                createdTime: '2026-11-27T10:05:20.000Z',
                lastModifiedTime: '2026-11-27T10:06:30.000Z',
                workspaceUris: [
                    'file:///Users/dev/.gemini/antigravity/worktrees/conv-main-9/swarm-cdp-launcher-9e202f73',
                ],
                branchName: 'swarm-cdp-launcher-9e202f73',
            });
            const explicitSubagent = makeTraj('conv-sub-77', {
                summary: '[Subagent] Verify build',
                status: CascadeStatus.RUNNING,
                parentCascadeId: 'conv-main-9',
                createdTime: '2026-11-27T10:05:25.000Z',
                lastModifiedTime: '2026-11-27T10:06:35.000Z',
            });

            const res = resolveTargetConversation({
                trajectories: [explicitSubagent, swarmWorker54, main9],
                lockToMainAgent: false,
                currentActiveId: 'conv-main-9',
                newlyCreatedIds: new Set(['conv-swarm-54', 'conv-sub-77']),
                workspaceUris: ['file:///Users/dev/project-main'],
            });
            expect(res.cascadeId).toBe('conv-main-9');
            expect(res.ignoredSubagentBurst).toBe(true);
        });
    });


    describe('context-jump regression: end-to-end Sidecar runtime + CDP overlay + HTTP bridge', () => {
        const tmpDirs: string[] = [];
        const providers: SidecarRuntimeProvider[] = [];
        const savedEnvConvId = process.env.ANTIGRAVITY_CONVERSATION_ID;

        function makeTempStatePath(): string {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-ctx-jump-'));
            tmpDirs.push(dir);
            return path.join(dir, 'state-v1.json');
        }

        afterEach(async () => {
            if (savedEnvConvId === undefined) {
                delete process.env.ANTIGRAVITY_CONVERSATION_ID;
            } else {
                process.env.ANTIGRAVITY_CONVERSATION_ID = savedEnvConvId;
            }
            while (providers.length > 0) {
                const p = providers.pop();
                if (p) { await p.dispose(); }
            }
            while (tmpDirs.length > 0) {
                const d = tmpDirs.pop();
                if (d) { fs.rmSync(d, { recursive: true, force: true }); }
            }
        });

        it('transitions cleanly A(54%) -> pending new B(0%) -> 0-step B(0%) -> B(9%) with ZERO 54% flicker on Top-Right CDP overlay', async () => {
            delete process.env.ANTIGRAVITY_CONVERSATION_ID;
            let nowMs = Date.parse('2026-11-27T10:05:00.000Z');
            const pushedPayloads: CdpOverlayPayload[] = [];

            const convA = makeTraj('conv-a-54', {
                summary: 'Previous Heavy Chat (54%)',
                status: 'CASCADE_RUN_STATUS_IDLE',
                stepCount: 30,
                createdTime: '2026-11-27T09:00:00.000Z',
                lastUserInputTime: '2026-11-27T09:50:00.000Z',
                lastModifiedTime: '2026-11-27T10:00:00.000Z',
            });
            let liveTrajectories: TrajectorySummary[] = [convA];
            const usageById = new Map<string, number>([['conv-a-54', 54]]);

            const gmSummaryA: GMSummary = {
                totalCalls: 4,
                totalInputTokens: 120_000,
                totalOutputTokens: 4_000,
                totalCacheRead: 90_000,
                totalCacheCreation: 0,
                totalThinkingTokens: 1_000,
                totalCredits: 0,
                totalRetryCount: 0,
                totalRetryTokens: 0,
                retryErrorCodes: {},
                toolCallCounts: {},
                toolCatalog: [],
                uniqueErrors: [],
                modelBreakdown: {},
                conversations: [
                    {
                        cascadeId: 'conv-a-54',
                        title: 'Previous Heavy Chat (54%)',
                        totalSteps: 30,
                        coveredSteps: 30,
                        coverageRate: 1,
                        calls: [
                            {
                                model: 'MODEL_PLACEHOLDER_M37',
                                modelDisplay: 'Gemini 3.1 Pro (High)',
                                responseModel: 'MODEL_PLACEHOLDER_M37',
                                modelAccuracy: 'exact',
                                inputTokens: 30_000,
                                outputTokens: 1_000,
                                cacheReadTokens: 90_000,
                                cacheCreationTokens: 0,
                                thinkingTokens: 200,
                                credits: 0,
                                streamingSeconds: 10,
                                ttftSeconds: 0.5,
                                createdAt: '2026-11-27T09:55:00.000Z',
                                stepIndices: [28, 29],
                                hasError: false,
                            },
                        ],
                        checkpointSummaries: [],
                        systemContextItems: [],
                    },
                ],
            };

            const deps: Partial<SidecarRuntimeDeps> = {
                discoverLS: async () => makeLS(),
                fetchFullUserStatus: async () => makeUserStatus(),
                getAllTrajectories: async () => liveTrajectories,
                getContextUsage: async (_ls, tr) => makeUsageForPercent(tr, usageById.get(tr.cascadeId) ?? 0),
                refreshWorkflowImageUsage: async (_ls, u) => u,
                fetchTrajectoryGeneratorMetadata: async (_ls, cid) => makeGmEntriesForPercent(usageById.get(cid) ?? 0),
                fetchTrajectorySteps: async () => ({ steps: [], hasGaps: false }),
                fetchOrchestratorSettings: async () => null,
                fetchUserQuotaSummary: async () => null,
                fetchAvailableModels: async () => null,
                processActivity: async () => false,
                fetchGM: async () => gmSummaryA,
                createCdpOverlayManager: () => makeRecordingOverlayManager(pushedPayloads),
                now: () => nowMs,
            };

            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                initialWorkspaceUris: ['file:///Users/dev/project-main'],
                deps,
            });
            providers.push(provider);

            // Step 1: Track conv-a-54 -> 54%
            await provider.pollNow(true);
            expect(provider.getState().activeConversationId).toBe('conv-a-54');
            expect(provider.buildOverlayPayload().contextPct).toBe(54);

            const switchStartIndex = pushedPayloads.length;

            // Step 2: Host AUX_PANE reports brand-new conv-b-new via dedicated syncHostFocus BEFORE GetAllCascadeTrajectories returns it!
            const focusRes = await provider.handleAction({
                command: 'syncHostFocus',
                conversationId: 'conv-b-new',
                focusRevision: 1,
                viewMode: 'aux',
            });
            expect(focusRes.ok).toBe(true);
            const pendingSnap = focusRes.snapshot!;
            expect(pendingSnap.activeConversationId).toBe('conv-b-new');
            expect((pendingSnap.meta as Record<string, unknown>).hostPending).toBe(true);
            expect((pendingSnap.data as { usage: ContextUsage | null }).usage).toBeNull();

            const pendingOverlay = provider.buildOverlayPayload();
            expect(pendingOverlay.contextPct).toBe(0);
            expect(pendingOverlay.contextUsedTokens).toBe(0);
            expect(pendingOverlay.estCostUsd).toBeNull();
            expect(pendingOverlay.outputSpeedTps).toBeNull();
            expect(pendingOverlay.turnCacheState).toBe('unknown');

            // Step 3: Poll runs while conv-b-new is STILL not in trajectories and conv-a-54 ticks RUNNING -> MUST stay 0%!
            nowMs += 2_000;
            liveTrajectories = [
                makeTraj('conv-a-54', {
                    status: CascadeStatus.RUNNING,
                    stepCount: 31,
                    lastUserInputTime: '2026-11-27T09:50:00.000Z',
                    lastModifiedTime: '2026-11-27T10:05:02.000Z',
                }),
            ];
            await provider.pollNow(false);
            expect(provider.getState().activeConversationId).toBe('conv-b-new');
            expect(provider.buildOverlayPayload().contextPct).toBe(0);

            // Step 4: conv-b-new appears with 0 steps (awaiting generation) -> stays 0%
            nowMs += 2_000;
            usageById.set('conv-b-new', 0);
            liveTrajectories = [
                makeTraj('conv-b-new', {
                    summary: '',
                    stepCount: 0,
                    status: 'CASCADE_RUN_STATUS_IDLE',
                    createdTime: '2026-11-27T10:05:03.000Z',
                    lastUserInputTime: '',
                    lastModifiedTime: '',
                    workspaceUris: [],
                }),
                liveTrajectories[0],
            ];
            await provider.pollNow(false);
            expect(provider.getState().activeConversationId).toBe('conv-b-new');
            expect(provider.buildOverlayPayload().contextPct).toBe(0);

            // Step 5: conv-b-new finishes first turn at 9% while a Swarm worker at 54% runs in background
            nowMs += 3_000;
            usageById.set('conv-b-new', 9);
            usageById.set('conv-swarm-worker', 54);
            liveTrajectories = [
                makeTraj('conv-swarm-worker', {
                    summary: 'Background Swarm Research',
                    stepCount: 22,
                    status: CascadeStatus.RUNNING,
                    createdTime: '2026-11-27T10:05:05.000Z',
                    lastModifiedTime: '2026-11-27T10:05:07.000Z',
                    workspaceUris: ['file:///Users/dev/.gemini/antigravity/worktrees/conv-b-new/swarm-research-12ab34cd'],
                    branchName: 'swarm-research-12ab34cd',
                }),
                makeTraj('conv-b-new', {
                    summary: 'Brand New Chat B',
                    stepCount: 2,
                    status: 'CASCADE_RUN_STATUS_IDLE',
                    createdTime: '2026-11-27T10:05:03.000Z',
                    lastUserInputTime: '2026-11-27T10:05:06.000Z',
                    lastModifiedTime: '2026-11-27T10:05:07.000Z',
                }),
                makeTraj('conv-a-54', {
                    status: 'CASCADE_RUN_STATUS_IDLE',
                    stepCount: 31,
                    lastUserInputTime: '2026-11-27T09:50:00.000Z',
                    lastModifiedTime: '2026-11-27T10:05:08.000Z',
                }),
            ];
            await provider.pollNow(false);
            expect(provider.getState().activeConversationId).toBe('conv-b-new');
            expect(provider.buildOverlayPayload().contextPct).toBe(9);

            // Verify ZERO pushed overlay payloads jumped back to 54% after starting conv-b-new!
            const postSwitchPayloads = pushedPayloads.slice(switchStartIndex);
            expect(postSwitchPayloads.length).toBeGreaterThanOrEqual(4);
            expect(postSwitchPayloads.every(p => p.contextPct === 0 || p.contextPct === 9)).toBe(true);
            expect(postSwitchPayloads.some(p => p.contextPct >= 50)).toBe(false);
        });

        it('handles authenticated focusConversation overlay actions (isNewConversation + explicit ID) via SidecarHandler', async () => {
            delete process.env.ANTIGRAVITY_CONVERSATION_ID;
            let nowMs = Date.parse('2026-11-27T10:10:00.000Z');
            const pushedPayloads: CdpOverlayPayload[] = [];
            let liveTrajectories: TrajectorySummary[] = [
                makeTraj('conv-a-54', { stepCount: 30, lastModifiedTime: '2026-11-27T10:09:00.000Z' }),
            ];
            const usageById = new Map<string, number>([['conv-a-54', 54]]);

            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: {
                    discoverLS: async () => makeLS(),
                    fetchFullUserStatus: async () => makeUserStatus(),
                    getAllTrajectories: async () => liveTrajectories,
                    getContextUsage: async (_ls, tr) => makeUsageForPercent(tr, usageById.get(tr.cascadeId) ?? 0),
                    refreshWorkflowImageUsage: async (_ls, u) => u,
                    fetchTrajectoryGeneratorMetadata: async (_ls, cid) => makeGmEntriesForPercent(usageById.get(cid) ?? 0),
                    fetchTrajectorySteps: async () => ({ steps: [], hasGaps: false }),
                    fetchOrchestratorSettings: async () => null,
                    fetchUserQuotaSummary: async () => null,
                    fetchAvailableModels: async () => null,
                    processActivity: async () => false,
                    fetchGM: async () => null,
                    createCdpOverlayManager: () => makeRecordingOverlayManager(pushedPayloads),
                    now: () => nowMs,
                },
            });
            providers.push(provider);
            await provider.pollNow(true);
            expect(provider.buildOverlayPayload().contextPct).toBe(54);

            const handler = createSidecarHandler(provider, { isSidecarEnv: true });
            const token = handler.getOverlayBridgeToken();

            // 1. User clicks "+ New Conversation" in Hub (blank composer, no cascadeId yet)
            const newChatRes = await handler.handleOverlayAction({
                method: 'POST',
                originHeader: 'https://127.0.0.1:49999',
                tokenHeader: token,
                rawBody: {
                    command: 'focusConversation',
                    source: 'topbar',
                    conversationId: null,
                    isNewConversation: true,
                },
            });
            expect(newChatRes.status).toBe(200);
            expect(newChatRes.body?.ok).toBe(true);
            expect(provider.buildOverlayPayload().contextPct).toBe(0);
            expect(provider.getState().currentUsage).toBeNull();

            // 2. New trajectory lands in LS -> exits blank hold and tracks new conversation at 9%
            nowMs += 2_000;
            usageById.set('conv-fresh-9', 9);
            liveTrajectories = [
                makeTraj('conv-fresh-9', {
                    stepCount: 2,
                    status: CascadeStatus.RUNNING,
                    createdTime: '2026-11-27T10:10:01.000Z',
                    lastUserInputTime: '2026-11-27T10:10:01.000Z',
                    lastModifiedTime: '2026-11-27T10:10:02.000Z',
                }),
                liveTrajectories[0],
            ];
            await provider.pollNow(false);
            expect(provider.getState().activeConversationId).toBe('conv-fresh-9');
            expect(provider.buildOverlayPayload().contextPct).toBe(9);
        });

        it('prevents slow in-flight conv-a (54%) RPC from overwriting newer conv-b (9%) via telemetryRefreshSeq epoch guard', async () => {
            delete process.env.ANTIGRAVITY_CONVERSATION_ID;
            const convA = makeTraj('conv-a-54', {
                stepCount: 30,
                status: CascadeStatus.RUNNING,
                lastModifiedTime: '2026-11-27T10:00:00.000Z',
            });
            const convB = makeTraj('conv-b-9', {
                stepCount: 2,
                status: 'CASCADE_RUN_STATUS_IDLE',
                lastModifiedTime: '2026-11-27T09:59:00.000Z',
            });

            let releaseSlowA!: (u: ContextUsage) => void;
            let slowAStarted!: () => void;
            const slowAStartedPromise = new Promise<void>(resolve => { slowAStarted = resolve; });
            let delayNextA = false;

            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: {
                    discoverLS: async () => makeLS(),
                    fetchFullUserStatus: async () => makeUserStatus(),
                    getAllTrajectories: async () => [convA, convB],
                    getContextUsage: async (_ls, tr) => {
                        if (tr.cascadeId === 'conv-a-54' && delayNextA) {
                            delayNextA = false;
                            slowAStarted();
                            return new Promise<ContextUsage>(resolve => {
                                releaseSlowA = resolve;
                            });
                        }
                        return makeUsageForPercent(tr, tr.cascadeId === 'conv-a-54' ? 54 : 9);
                    },
                    refreshWorkflowImageUsage: async (_ls, u) => u,
                    fetchTrajectoryGeneratorMetadata: async (_ls, cid) =>
                        makeGmEntriesForPercent(cid === 'conv-a-54' ? 54 : 9),
                    fetchTrajectorySteps: async () => ({ steps: [], hasGaps: false }),
                    fetchOrchestratorSettings: async () => null,
                    fetchUserQuotaSummary: async () => null,
                    fetchAvailableModels: async () => null,
                    processActivity: async () => false,
                    fetchGM: async () => null,
                },
            });
            providers.push(provider);

            // Initial poll discovers LS and populates trajectories
            await provider.pollNow(true);
            expect(provider.getState().activeConversationId).toBe('conv-a-54');

            // Start a slow background poll on conv-a-54
            delayNextA = true;
            const slowPollPromise = provider.pollNow(false);
            await slowAStartedPromise;

            // Mid-flight, user switches to conv-b-9 (completes immediately!)
            await provider.handleAction({ command: 'selectConversation', conversationId: 'conv-b-9' });
            expect(provider.getState().activeConversationId).toBe('conv-b-9');
            expect(provider.buildOverlayPayload().contextPct).toBe(9);

            // Now release the stale slow RPC for conv-a-54 (54%)
            releaseSlowA(makeUsageForPercent(convA, 54));
            await slowPollPromise;

            // MUST remain conv-b-9 at 9% — stale conv-a-54 write MUST have been discarded!
            expect(provider.getState().activeConversationId).toBe('conv-b-9');
            expect(provider.getState().currentUsage?.cascadeId).toBe('conv-b-9');
            expect(provider.buildOverlayPayload().contextPct).toBe(9);
        });

        it('clears stale conv-a (54%) telemetry instead of showing 54% if switching to conv-b fails transiently', async () => {
            delete process.env.ANTIGRAVITY_CONVERSATION_ID;
            const convA = makeTraj('conv-a-54', { stepCount: 30, lastModifiedTime: '2026-11-27T10:00:00.000Z' });
            const convB = makeTraj('conv-b-err', { stepCount: 1, lastModifiedTime: '2026-11-27T09:59:00.000Z' });

            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: {
                    discoverLS: async () => makeLS(),
                    fetchFullUserStatus: async () => makeUserStatus(),
                    getAllTrajectories: async () => [convA, convB],
                    getContextUsage: async (_ls, tr) => {
                        if (tr.cascadeId === 'conv-b-err') {
                            throw new Error('transient RPC timeout on new conversation');
                        }
                        return makeUsageForPercent(tr, 54);
                    },
                    refreshWorkflowImageUsage: async (_ls, u) => u,
                    fetchTrajectoryGeneratorMetadata: async (_ls, cid) =>
                        makeGmEntriesForPercent(cid === 'conv-a-54' ? 54 : 0),
                    fetchTrajectorySteps: async () => ({ steps: [], hasGaps: false }),
                    fetchOrchestratorSettings: async () => null,
                    fetchUserQuotaSummary: async () => null,
                    fetchAvailableModels: async () => null,
                    processActivity: async () => false,
                    fetchGM: async () => null,
                },
            });
            providers.push(provider);

            await provider.pollNow(true);
            expect(provider.buildOverlayPayload().contextPct).toBe(54);

            // Switch to conv-b-err whose RPC fails -> must NOT keep showing conv-a-54's 54%!
            await provider.handleAction({ command: 'selectConversation', conversationId: 'conv-b-err' });
            expect(provider.getState().activeConversationId).toBe('conv-b-err');
            expect(provider.getState().currentUsage).toBeNull();
            expect(provider.buildOverlayPayload().contextPct).toBe(0);
        });

        it('expires stale AUX_PANE hostConversationId and falls back cleanly on deleted host conversation', async () => {
            delete process.env.ANTIGRAVITY_CONVERSATION_ID;
            let nowMs = Date.parse('2026-11-27T10:00:00.000Z');
            const convA = makeTraj('conv-a-54', {
                stepCount: 30,
                status: 'CASCADE_RUN_STATUS_IDLE',
                lastUserInputTime: '2026-11-27T09:50:00.000Z',
                lastModifiedTime: '2026-11-27T09:55:00.000Z',
            });
            let liveTrajectories: TrajectorySummary[] = [convA];
            const usageById = new Map<string, number>([['conv-a-54', 54], ['conv-b-9', 9]]);

            const provider = createSidecarRuntimeProvider({
                statePath: makeTempStatePath(),
                autoStart: false,
                disableCliScan: true,
                enableAutoUpdateCheck: false,
                deps: {
                    discoverLS: async () => makeLS(),
                    fetchFullUserStatus: async () => makeUserStatus(),
                    getAllTrajectories: async () => liveTrajectories,
                    getContextUsage: async (_ls, tr) => makeUsageForPercent(tr, usageById.get(tr.cascadeId) ?? 0),
                    refreshWorkflowImageUsage: async (_ls, u) => u,
                    fetchTrajectoryGeneratorMetadata: async (_ls, cid) => makeGmEntriesForPercent(usageById.get(cid) ?? 0),
                    fetchTrajectorySteps: async () => ({ steps: [], hasGaps: false }),
                    fetchOrchestratorSettings: async () => null,
                    fetchUserQuotaSummary: async () => null,
                    fetchAvailableModels: async () => null,
                    processActivity: async () => false,
                    fetchGM: async () => null,
                    now: () => nowMs,
                },
            });
            providers.push(provider);

            // User had AUX_PANE open on conv-a-54 at t=0, then closed AUX_PANE
            await provider.pollNow(true);
            await provider.handleAction({ command: 'syncHostFocus', conversationId: 'conv-a-54', focusRevision: 1, viewMode: 'aux' });
            expect(provider.getState().activeConversationId).toBe('conv-a-54');

            // 30s later (no AUX_PANE polls), user starts brand-new conv-b-9 -> stale hostConversationId expires!
            nowMs += 30_000;
            liveTrajectories = [
                makeTraj('conv-b-9', {
                    stepCount: 2,
                    status: CascadeStatus.RUNNING,
                    createdTime: '2026-11-27T10:00:25.000Z',
                    lastUserInputTime: '2026-11-27T10:00:26.000Z',
                    lastModifiedTime: '2026-11-27T10:00:28.000Z',
                }),
                convA,
            ];
            await provider.pollNow(false);
            expect(provider.getState().activeConversationId).toBe('conv-b-9');
            expect(provider.buildOverlayPayload().contextPct).toBe(9);

            // Now test deleted hostConversationId: host focuses conv-b-9, then conv-b-9 is deleted -> cleanly falls back to conv-a-54
            await provider.handleAction({ command: 'syncHostFocus', conversationId: 'conv-b-9', focusRevision: 2, viewMode: 'aux' });
            nowMs += 2_000;
            liveTrajectories = [convA];
            await provider.pollNow(false);
            expect(provider.getState().activeConversationId).toBe('conv-a-54');
        });

        it('emits host-bridge script with immediate conversation-change detection and conversationCleared propagation', () => {
            const script = getHostBridgeScript({ pollIntervalMs: 4000, autoPoll: true });
            expect(() => new Function(script)).not.toThrow();
            expect(script).toContain('syncHostConversationChange');
            expect(script).toContain('onConversationChange');
            expect(script).toContain('conversationCleared');
            expect(script).toContain('conversation-change');
        });
    });
});

describe('[extension-selection]', () => {
    function trajectory(
        cascadeId: string,
        status: string,
        workspaceUris: string[] = [],
        stepCount = 1,
    ): TrajectorySummary {
        return {
            cascadeId,
            trajectoryId: `trajectory-${cascadeId}`,
            summary: cascadeId,
            stepCount,
            status,
            lastModifiedTime: `2026-05-07T00:00:0${stepCount}.000Z`,
            createdTime: '2026-05-07T00:00:00.000Z',
            requestedModel: 'MODEL_PLACEHOLDER_M37',
            generatorModel: 'MODEL_PLACEHOLDER_M37',
            workspaceUris,
            lastUserInputTime: '2026-05-07T00:00:00.000Z',
            lastUserInputStepIndex: 0,
            repositoryName: '',
            gitOriginUrl: '',
            branchName: '',
            gitRootUri: '',
        };
    }


    function modelConfig(model: string, label: string, resetTime: string, remainingFraction: number): ModelConfig {
        return {
            model,
            label,
            supportsImages: false,
            quotaInfo: { resetTime, remainingFraction },
            allowedTiers: [],
            mimeTypeCount: 0,
            isRecommended: false,
            supportedMimeTypes: [],
        };
    }


    describe('selectRunningTrajectoryCandidate', () => {
        it('keeps the tracked cascade when it is still running in the current workspace', () => {
            const first = trajectory('first', CascadeStatus.RUNNING, ['file:///repo']);
            const tracked = trajectory('tracked', CascadeStatus.RUNNING, ['file:///repo']);

            const result = selectRunningTrajectoryCandidate(
                [first, tracked],
                [first, tracked],
                'tracked',
            );

            expect(result.candidateId).toBe('tracked');
            expect(result.selectionReason).toBe('tracked cascade is RUNNING');
            expect(result.selectedOutsideWorkspace).toBe(false);
        });

        it('keeps current-workspace RUNNING ahead of cross-workspace RUNNING', () => {
            const crossWorkspace = trajectory('cross', CascadeStatus.RUNNING, ['file:///other']);
            const currentWorkspace = trajectory('current', CascadeStatus.RUNNING, ['file:///repo']);

            const result = selectRunningTrajectoryCandidate(
                [crossWorkspace, currentWorkspace],
                [currentWorkspace],
                null,
            );

            expect(result.candidateId).toBe('current');
            expect(result.selectionReason).toBe('new RUNNING cascade in ws');
            expect(result.selectedOutsideWorkspace).toBe(false);
        });

        it('falls back to a RUNNING cascade from another workspace when none are running locally', () => {
            const localIdle = trajectory('local-idle', 'CASCADE_RUN_STATUS_IDLE', ['file:///repo']);
            const crossWorkspace = trajectory('cross-running', CascadeStatus.RUNNING, ['file:///other']);

            const result = selectRunningTrajectoryCandidate(
                [localIdle, crossWorkspace],
                [localIdle],
                'local-idle',
            );

            expect(result.candidateId).toBe('cross-running');
            expect(result.selectionReason).toBe('RUNNING cascade from another workspace (cross-workspace tracking)');
            expect(result.selectedOutsideWorkspace).toBe(true);
        });

        it('preserves the existing fallback for RUNNING cascades without workspace URIs', () => {
            const localIdle = trajectory('local-idle', 'CASCADE_RUN_STATUS_IDLE', ['file:///repo']);
            const noWorkspace = trajectory('no-workspace', CascadeStatus.RUNNING);

            const result = selectRunningTrajectoryCandidate(
                [localIdle, noWorkspace],
                [localIdle],
                null,
            );

            expect(result.candidateId).toBe('no-workspace');
            expect(result.selectionReason).toBe('RUNNING cascade without workspace (new conversation)');
            expect(result.selectedOutsideWorkspace).toBe(true);
        });

        it('returns no candidate when no trajectory is running', () => {
            const localIdle = trajectory('local-idle', 'CASCADE_RUN_STATUS_IDLE', ['file:///repo']);
            const otherIdle = trajectory('other-idle', 'CASCADE_RUN_STATUS_IDLE', ['file:///other']);

            const result = selectRunningTrajectoryCandidate(
                [localIdle, otherIdle],
                [localIdle],
                null,
            );

            expect(result.candidateId).toBeNull();
            expect(result.selectionReason).toBe('');
            expect(result.selectedOutsideWorkspace).toBe(false);
        });
    });


    describe('buildUsageScopeTrajectories', () => {
        it('includes an active cross-workspace trajectory before qualified local history', () => {
            const localIdle = trajectory('local-idle', 'CASCADE_RUN_STATUS_IDLE', ['file:///repo']);
            const crossWorkspace = trajectory('cross-running', CascadeStatus.RUNNING, ['file:///other']);

            const scope = buildUsageScopeTrajectories(
                [localIdle],
                [localIdle, crossWorkspace],
                crossWorkspace,
            );

            expect(scope.map(t => t.cascadeId)).toEqual(['cross-running', 'local-idle']);
        });

        it('does not duplicate the active trajectory when it is already in scope', () => {
            const currentWorkspace = trajectory('current', CascadeStatus.RUNNING, ['file:///repo']);

            const scope = buildUsageScopeTrajectories(
                [currentWorkspace],
                [currentWorkspace],
                currentWorkspace,
            );

            expect(scope.map(t => t.cascadeId)).toEqual(['current']);
        });
    });


    describe('groupModelConfigsByQuotaPool', () => {
        it('keeps known quota pools separate even when resetTime strings match', () => {
            const groups = groupModelConfigsByQuotaPool([
                modelConfig('MODEL_PLACEHOLDER_M133', 'Gemini 3 Flash', '2026-05-21T00:00:00Z', 0.8),
                modelConfig('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 'GPT-OSS 120B (Medium)', '2026-05-21T00:00:00Z', 0.4),
            ]);

            expect(groups.map(g => g.key).sort()).toEqual(['gemini', 'premium']);
            expect(groups.find(g => g.key === 'gemini')?.labels).toEqual(['Gemini 3 Flash']);
            expect(groups.find(g => g.key === 'premium')?.labels).toEqual(['GPT-OSS 120B (Medium)']);
        });

        it('still groups unknown future models by resetTime fallback', () => {
            const groups = groupModelConfigsByQuotaPool([
                modelConfig('MODEL_FUTURE_A', 'Future A', '2026-05-21T00:00:00Z', 0.7),
                modelConfig('MODEL_FUTURE_B', 'Future B', '2026-05-21T00:00:00Z', 0.5),
            ]);

            expect(groups).toHaveLength(1);
            expect(groups[0].modelIds).toEqual(['MODEL_FUTURE_A', 'MODEL_FUTURE_B']);
            expect(groups[0].minFraction).toBe(0.5);
        });

        it('groups Gemini 3.6 Flash into the shared gemini pool via KNOWN_QUOTA_POOLS, not resetTime', () => {
            // M71 and M133 carry different resetTimes, yet both must land in the fixed 'gemini' pool.
            // Before the fix, the 3.6 tier fell back to its resetTime key and split into its own pool.
            const groups = groupModelConfigsByQuotaPool([
                modelConfig('MODEL_PLACEHOLDER_M71', 'Gemini 3.6 Flash (High)', '2026-07-21T21:41:45Z', 0.9),
                modelConfig('MODEL_PLACEHOLDER_M133', 'Gemini 3.5 Flash (High)', '2026-07-22T09:00:00Z', 0.7),
                modelConfig('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 'GPT-OSS 120B (Medium)', '2026-07-21T21:41:45Z', 0.3),
            ]);

            expect(groups.map(g => g.key).sort()).toEqual(['gemini', 'premium']);
            const gemini = groups.find(g => g.key === 'gemini');
            expect(gemini?.modelIds.slice().sort()).toEqual(['MODEL_PLACEHOLDER_M133', 'MODEL_PLACEHOLDER_M71']);
            expect(gemini?.minFraction).toBe(0.7);
            expect(groups.find(g => g.key === 'premium')?.modelIds).toEqual(['MODEL_OPENAI_GPT_OSS_120B_MEDIUM']);
        });

        it('groups the whole live 3.8 / 3.7 / 3.6 Flash lineup into a single gemini pool', () => {
            // The 2026-09 picker carries three Flash generations at once. Each tier can report its own
            // resetTime, so without KNOWN_QUOTA_POOLS the status bar would show up to nine separate
            // "pools" for what is really one shared Gemini quota.
            const groups = groupModelConfigsByQuotaPool([
                modelConfig('MODEL_PLACEHOLDER_M318', 'Gemini 3.8 Flash (High)', '2026-09-05T08:18:40Z', 1.0),
                modelConfig('MODEL_PLACEHOLDER_M319', 'Gemini 3.8 Flash (Medium)', '2026-09-05T08:18:40Z', 1.0),
                modelConfig('MODEL_PLACEHOLDER_M320', 'Gemini 3.8 Flash (Low)', '2026-09-05T08:17:59Z', 1.0),
                modelConfig('MODEL_PLACEHOLDER_M298', 'Gemini 3.7 Flash (High)', '2026-08-13T23:31:25Z', 1.0),
                modelConfig('MODEL_PLACEHOLDER_M299', 'Gemini 3.7 Flash (Medium)', '2026-08-13T23:31:25Z', 1.0),
                modelConfig('MODEL_PLACEHOLDER_M300', 'Gemini 3.7 Flash (Low)', '2026-08-13T23:27:33Z', 1.0),
                modelConfig('MODEL_PLACEHOLDER_M71', 'Gemini 3.6 Flash (High)', '2026-08-13T23:31:25Z', 0.8),
                modelConfig('MODEL_PLACEHOLDER_M72', 'Gemini 3.6 Flash (Medium)', '2026-08-13T22:00:00Z', 0.8),
                modelConfig('MODEL_PLACEHOLDER_M73', 'Gemini 3.6 Flash (Low)', '2026-08-13T22:00:00Z', 0.8),
                modelConfig('MODEL_PLACEHOLDER_M16', 'Gemini 3.1 Pro (High)', '2026-08-13T21:00:00Z', 0.6),
                modelConfig('MODEL_PLACEHOLDER_M36', 'Gemini 3.1 Pro (Low)', '2026-08-13T21:00:00Z', 0.6),
                modelConfig('MODEL_PLACEHOLDER_M35', 'Claude Sonnet 4.6 (Thinking)', '2026-08-13T21:00:00Z', 0.4),
            ]);

            expect(groups.map(g => g.key).sort()).toEqual(['gemini', 'premium']);
            const gemini = groups.find(g => g.key === 'gemini');
            expect(gemini?.modelIds).toHaveLength(11);
            expect(gemini?.minFraction).toBe(0.6);
        });

        it('strips all proto3 epoch-0 variants, negative epochs, and malformed dates while sorting valid resetTimes chronologically', () => {
            const groups = groupModelConfigsByQuotaPool([
                modelConfig('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon (XHigh)', '1970-01-01T00:00:00.000Z', 1.0),
                modelConfig('MODEL_PLACEHOLDER_M534', 'Gemini 4 Neon (Low)', '1970-01-01T00:00:00+00:00', 1.0),
                modelConfig('MODEL_PLACEHOLDER_M533', 'Gemini 4 Neon (Medium)', '1969-12-31T23:59:59Z', 1.0),
                modelConfig('MODEL_PLACEHOLDER_M532', 'Gemini 4 Neon (High)', '0bad', 1.0),
                modelConfig('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (XHigh)', '2026-02-30T00:00:00Z', 1.0),
                // Chronologically earlier (2026-11-22T00:00:00Z) despite lexicographically sorting after 01:00:00Z
                modelConfig('MODEL_PLACEHOLDER_M525', 'Gemini 4 Hydrogen (High)', '2026-11-22T02:00:00+02:00', 0.8),
                modelConfig('MODEL_PLACEHOLDER_M526', 'Gemini 4 Hydrogen (Medium)', '2026-11-22T01:00:00Z', 0.8),
                // Pool whose models only carry epoch-0 / malformed timestamps -> empty resetTime
                modelConfig('MODEL_PLACEHOLDER_M401', 'Claude Opus 5.5 (Medium)', '1970-01-01T00:00:00.000Z', 1.0),
                modelConfig('MODEL_PLACEHOLDER_M404', 'Claude Sonnet 5.5 (Medium)', '0', 1.0),
            ]);

            const gemini = groups.find(g => g.key === 'gemini');
            const premium = groups.find(g => g.key === 'premium');
            expect(gemini?.resetTime).toBe('2026-11-22T02:00:00+02:00');
            expect(premium?.resetTime).toBe('');
        });
    });


    describe('parsePositivePoolResetMs & shouldSettleOnResetTimeChange epoch-0 guards', () => {
        it('rejects proto3 epoch-0 variants, negative timestamps, and malformed/non-ISO strings', () => {
            for (const bad of [
                '',
                '   ',
                '1970-01-01T00:00:00Z',
                '1970-01-01T00:00:00.000Z',
                '1970-01-01T00:00:00+00:00',
                '1969-12-31T23:59:59Z',
                '0',
                '1970',
                '0bad',
                '2026-02-30T00:00:00Z',
                '2026-11-22',
                null,
                undefined,
            ]) {
                expect(parsePositivePoolResetMs(bad), String(bad)).toBeNull();
            }
            expect(parsePositivePoolResetMs('2026-11-22T02:00:00.000Z')).toBe(Date.parse('2026-11-22T02:00:00.000Z'));
            expect(parsePositivePoolResetMs('2026-11-22T02:00:00+02:00')).toBe(Date.parse('2026-11-22T00:00:00Z'));
        });

        it('never triggers cycle-turnover settlement from an epoch-0 or malformed old resetTime', () => {
            const nowMs = Date.parse('2026-11-22T00:00:00Z');
            expect(shouldSettleOnResetTimeChange('1970-01-01T00:00:00.000Z', '2026-11-22T05:00:00Z', nowMs)).toBe(false);
            expect(shouldSettleOnResetTimeChange('1970-01-01T00:00:00Z', '2026-11-22T05:00:00Z', nowMs)).toBe(false);
            expect(shouldSettleOnResetTimeChange('0', '2026-11-22T05:00:00Z', nowMs)).toBe(false);
            expect(shouldSettleOnResetTimeChange('2026-02-30T00:00:00Z', '2026-11-22T05:00:00Z', nowMs)).toBe(false);
        });

        it('sorts pool resetTimes chronologically across timezone offsets and puts empty/invalid last', () => {
            const unsorted = [
                '',
                '2026-11-22T01:00:00Z',
                '2026-11-22T02:00:00+02:00', // 00:00Z (earliest)
                '1970-01-01T00:00:00.000Z',
                '2026-11-22T00:30:00Z',
            ];
            expect([...unsorted].sort(comparePoolResetTimes)).toEqual([
                '2026-11-22T02:00:00+02:00',
                '2026-11-22T00:30:00Z',
                '2026-11-22T01:00:00Z',
                '',
                '1970-01-01T00:00:00.000Z',
            ]);
        });
    });


    describe('hasAuxiliaryMetadataChanged', () => {
        it('detects structural equality vs genuine changes cleanly', () => {
            const snap = { groups: [{ pool: 'gemini', fiveHour: { remainingFraction: 0.87, resetTime: '2026-11-22T02:00:00Z' } }] };
            expect(hasAuxiliaryMetadataChanged(null, snap)).toBe(true);
            expect(hasAuxiliaryMetadataChanged(snap, JSON.parse(JSON.stringify(snap)))).toBe(false);
            expect(hasAuxiliaryMetadataChanged(snap, {
                groups: [{ pool: 'gemini', fiveHour: { remainingFraction: 0.86, resetTime: '2026-11-22T02:00:00Z' } }],
            })).toBe(true);
        });
    });
});

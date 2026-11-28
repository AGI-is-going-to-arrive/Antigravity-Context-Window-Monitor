import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DiagnosticAliasMap,
    buildPublishedMonitorObservation,
    formatObservationDiagnostic,
    formatObservationPrimaryPct,
    projectForCdpComposerRing,
    projectForCdpTopbar,
    projectForIdeStatusBar,
    projectForNativeHud,
    projectForOverview,
    verifySurfaceProjectionParity,
    type PublishedMonitorObservation,
} from '../src/core/context-display';
import {
    ALLOWED_MANIFEST_FILENAMES,
    withTrajectoryPollBudget, withTrajectoryRpcSlot,
    SwarmPollScheduler,
    SwarmTopologyRegistry,
    aggregateSwarmGroupCost,
    classifyAssignedRole,
    isSafeCascadeIdSegment,
    parseAllowedManifestJson,
    resolveScopedBrainRoot,
    safeReadManifestFile,
    type SafeFileHandleLike,
    type SafeStatLike,
    type SwarmManifestFsOps,
    type TopologyTrajectoryInput,
} from '../src/core/swarm-registry';
import {
    advanceWindowBackendEpoch,
    clearInspect,
    createWindowSelectionState,
    disableLockToMainAgent,
    enableLockToMainAgent,
    inspectMember,
    isSubagentTrajectory,
    recordObservedHostFocus,
    resolveRootCascadeIdSync,
    resolveTargetConversation,
    retargetLockedRoot,
    selectConversation,
    type ConversationTrajectoryLike,
    type WindowSelectionState,
} from '../src/conversation-selector';
import { CascadeStatus } from '../src/constants';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const tmpDirs: string[] = [];

function makeTempBrainRoot(prefix = 'acm-swarm-reg-'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
}

function writeManifestFile(
    brainRoot: string,
    cascadeId: string,
    filename: string,
    content: string | Record<string, unknown>,
): string {
    const swarmDir = path.join(brainRoot, cascadeId, '.system_generated', 'swarm');
    fs.mkdirSync(swarmDir, { recursive: true });
    const filePath = path.join(swarmDir, filename);
    fs.writeFileSync(
        filePath,
        typeof content === 'string' ? content : JSON.stringify(content, null, 2),
        'utf8',
    );
    return filePath;
}

function makeTraj(
    cascadeId: string,
    overrides: Partial<ConversationTrajectoryLike> = {},
): ConversationTrajectoryLike {
    return {
        cascadeId,
        trajectoryId: `traj-${cascadeId}`,
        summary: `Session ${cascadeId}`,
        stepCount: 8,
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: '2026-11-27T10:00:00.000Z',
        createdTime: '2026-11-27T09:00:00.000Z',
        lastUserInputTime: '2026-11-27T09:58:00.000Z',
        workspaceUris: ['file:///Users/dev/project-main'],
        ...overrides,
    };
}

afterEach(() => {
    while (tmpDirs.length > 0) {
        const d = tmpDirs.pop();
        if (d) {
            fs.rmSync(d, { recursive: true, force: true });
        }
    }
});

// ─── Architecture Safety Guard ───────────────────────────────────────────────

describe('D9 architecture boundary: zero vscode imports in core & selector modules', () => {
    it('contains zero vscode imports across src/core/context-display.ts, src/core/swarm-registry.ts, src/conversation-selector.ts, and src/context-breakdown.ts', () => {
        const repoRoot = path.resolve(__dirname, '..');
        const files = [
            'src/core/context-display.ts',
            'src/core/swarm-registry.ts',
            'src/conversation-selector.ts',
            'src/context-breakdown.ts',
        ];
        for (const rel of files) {
            const content = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
            expect(content, `${rel} must not import vscode`).not.toMatch(/from\s+['"]vscode['"]/);
            expect(content, `${rel} must not require vscode`).not.toMatch(/require\(\s*['"]vscode['"]\s*\)/);
        }
    });
});

// ─── §3.1 Unified Immutable Observation & Surface Parity ─────────────────────

describe('§3.1 Unified Immutable Observation (src/core/context-display.ts)', () => {
    it('builds a deeply frozen PublishedMonitorObservation and enforces 100% parity across all 5 display surfaces', () => {
        const obs: PublishedMonitorObservation = buildPublishedMonitorObservation({
            backendEpoch: 3,
            windowId: 'win-main-1',
            rootCascadeId: 'coord-root-01',
            subjectCascadeId: 'coord-root-01',
            subjectKind: 'main',
            selectionRevision: 7,
            dataRevision: 42,
            measuredModel: 'MODEL_PLACEHOLDER_M532',
            tokenSource: 'gm_usage',
            usedTokens: 108_032,
            compactionLimit: 512_000,
            compactionLimitProvenance: 'planner_config',
            nativeLimit: 1_048_576,
            nativeLimitProvenance: 'model_catalog',
            requestedBasis: 'compaction',
            speedMode: 'decode',
            speedSampleScope: 'latest_call',
            speedCallId: 'exec-abc-999',
            displaySpeedTps: 254.44,
            sessionCostUsd: 0.42,
            observedAtMs: 1_795_000_000_000,
        });

        // Deeply frozen / immutable
        expect(Object.isFrozen(obs)).toBe(true);
        expect(Object.isFrozen(obs.markers)).toBe(true);
        expect(() => {
            (obs as unknown as Record<string, unknown>).primaryPct = 99;
        }).toThrow();

        // Required contract fields
        expect(obs.backendEpoch).toBe(3);
        expect(obs.windowId).toBe('win-main-1');
        expect(obs.rootCascadeId).toBe('coord-root-01');
        expect(obs.subjectCascadeId).toBe('coord-root-01');
        expect(obs.subjectKind).toBe('main');
        expect(obs.selectionRevision).toBe(7);
        expect(obs.dataRevision).toBe(42);
        expect(obs.measuredModel).toBe('MODEL_PLACEHOLDER_M532');
        expect(obs.tokenSource).toBe('gm_usage');
        expect(obs.usedTokens).toBe(108_032);
        expect(obs.compactionLimit).toBe(512_000);
        expect(obs.compactionLimitProvenance).toBe('planner_config');
        expect(obs.nativeLimit).toBe(1_048_576);
        expect(obs.nativeLimitProvenance).toBe('model_catalog');
        expect(obs.requestedBasis).toBe('compaction');
        expect(obs.actualBasis).toBe('compaction');
        expect(obs.primaryPct).toBe(21.1);
        expect(obs.primaryPctRaw).toBeCloseTo((108_032 / 512_000) * 100, 6);
        expect(obs.displaySpeedTps).toBe(254.4);
        expect(obs.isZeroStepFresh).toBe(false);
        expect(obs.isIncomplete).toBe(false);
        expect(obs.hasDualCap).toBe(true);
        expect(obs.isSingleScale).toBe(false);
        expect(obs.healthStatus).toBe('healthy');

        // 200k marker positioned strictly on compaction 512k axis: 200000 / 512000 = 39.1%
        expect(obs.markers).toHaveLength(1);
        expect(obs.markers[0]).toMatchObject({
            id: 'tier_200k',
            axis: 'compaction',
            positionPct: 39.1,
            exceeded: false,
        });

        // All 5 surfaces project identical primary %, denominator, rounding, health, and markers!
        const projections = [
            projectForOverview(obs),
            projectForNativeHud(obs),
            projectForCdpTopbar(obs),
            projectForCdpComposerRing(obs),
            projectForIdeStatusBar(obs),
        ];
        const parity = verifySurfaceProjectionParity(projections);
        expect(parity.ok).toBe(true);
        expect(parity.mismatches).toEqual([]);
        for (const p of projections) {
            expect(p.primaryPct).toBe(21.1);
            expect(p.primaryPctText).toBe('21.1%');
            expect(p.denominatorTokens).toBe(512_000);
            expect(p.healthStatus).toBe('healthy');
            expect(p.geometryFillPct).toBe(21.1);
            expect(p.displaySpeedTps).toBe(254.4);
        }
    });

    it('handles confirmed 0-step fresh, incomplete, native-only, equal-limits, overflow, and native-basis compaction warnings accurately', () => {
        // 1. Confirmed 0-step fresh conversation -> 0%, null speed/cost, NEVER unhealthy!
        const fresh = buildPublishedMonitorObservation({
            backendEpoch: 1,
            windowId: 'w1',
            subjectCascadeId: 'new-chat',
            selectionRevision: 1,
            dataRevision: 1,
            isZeroStepFresh: true,
            compactionLimit: 512_000,
            nativeLimit: 1_048_576,
            displaySpeedTps: 120, // must be nullified for fresh!
            sessionCostUsd: 0.99, // must be nullified for fresh!
        });
        expect(fresh.isZeroStepFresh).toBe(true);
        expect(fresh.isIncomplete).toBe(false);
        expect(fresh.primaryPct).toBe(0);
        expect(fresh.primaryPctRaw).toBe(0);
        expect(fresh.usedTokens).toBe(0);
        expect(fresh.displaySpeedTps).toBeNull();
        expect(fresh.speedCallId).toBeNull();
        expect(fresh.speedSampleScope).toBe('none');
        expect(fresh.sessionCostUsd).toBeNull();
        expect(fresh.healthStatus).toBe('fresh');
        expect(formatObservationPrimaryPct(fresh)).toBe('0%');

        // 2. Missing / incomplete measurement -> primaryPct: null, '—', NEVER '0%' or 'healthy'!
        const incomplete = buildPublishedMonitorObservation({
            backendEpoch: 1,
            windowId: 'w1',
            subjectCascadeId: 'conv-missing',
            selectionRevision: 1,
            dataRevision: 2,
            usedTokens: null,
            compactionLimit: 512_000,
        });
        expect(incomplete.isIncomplete).toBe(true);
        expect(incomplete.isZeroStepFresh).toBe(false);
        expect(incomplete.primaryPct).toBeNull();
        expect(incomplete.primaryPctRaw).toBeNull();
        expect(incomplete.healthStatus).toBe('incomplete');
        expect(incomplete.healthStatus).not.toBe('healthy');
        expect(formatObservationPrimaryPct(incomplete)).toBe('—');
        expect(projectForCdpTopbar(incomplete).primaryPctText).toBe('—');
        expect(projectForIdeStatusBar(incomplete).healthStatus).toBe('incomplete');

        // 3. Native-only model (cpLimit = 0) -> actualBasis falls back to 'native' with explicit provenance
        const nativeOnly = buildPublishedMonitorObservation({
            backendEpoch: 1,
            windowId: 'w1',
            subjectCascadeId: 'conv-m578',
            selectionRevision: 1,
            dataRevision: 3,
            usedTokens: 209_715,
            compactionLimit: 0,
            nativeLimit: 1_048_576,
            nativeLimitProvenance: 'model_catalog',
            requestedBasis: 'compaction',
        });
        expect(nativeOnly.actualBasis).toBe('native');
        expect(nativeOnly.compactionLimit).toBeNull();
        expect(nativeOnly.compactionLimitProvenance).toBe('unavailable');
        expect(nativeOnly.nativeLimitProvenance).toBe('model_catalog');
        expect(nativeOnly.isSingleScale).toBe(true);
        expect(nativeOnly.hasDualCap).toBe(false);
        expect(nativeOnly.primaryPct).toBe(20);

        // 4. Equal limits -> single-scale flag, no redundant compaction marker
        const equalLimits = buildPublishedMonitorObservation({
            backendEpoch: 1,
            windowId: 'w1',
            subjectCascadeId: 'conv-eq',
            selectionRevision: 1,
            dataRevision: 4,
            usedTokens: 100_000,
            compactionLimit: 200_000,
            nativeLimit: 200_000,
            requestedBasis: 'native',
        });
        expect(equalLimits.isSingleScale).toBe(true);
        expect(equalLimits.hasDualCap).toBe(false);
        expect(equalLimits.markers.some(m => m.id === 'compaction_limit')).toBe(false);

        // 5. Overflow (>100%) -> preserve raw percentage in text (e.g. '112%'), clamp ONLY geometryFillPct to 100!
        const overflow = buildPublishedMonitorObservation({
            backendEpoch: 1,
            windowId: 'w1',
            subjectCascadeId: 'conv-ovf',
            selectionRevision: 1,
            dataRevision: 5,
            usedTokens: 573_440,
            compactionLimit: 512_000,
            nativeLimit: 1_048_576,
            requestedBasis: 'compaction',
        });
        expect(overflow.isOverflow).toBe(true);
        expect(overflow.primaryPctRaw).toBeCloseTo(112, 5);
        expect(overflow.primaryPct).toBe(112);
        expect(overflow.geometryFillPct).toBe(100);
        expect(formatObservationPrimaryPct(overflow)).toBe('112%');
        expect(projectForCdpComposerRing(overflow).primaryPctText).toBe('112%');
        expect(projectForCdpComposerRing(overflow).geometryFillPct).toBe(100);
        expect(overflow.healthStatus).toBe('overflow');

        // 6. Native basis preserves compaction warning AND positions markers on the native 1M axis!
        const nativeBasisHighCompaction = buildPublishedMonitorObservation({
            backendEpoch: 1,
            windowId: 'w1',
            subjectCascadeId: 'conv-native-warn',
            selectionRevision: 1,
            dataRevision: 6,
            usedTokens: 450_000, // 87.9% of 512k compaction, only 42.9% of 1M native!
            compactionLimit: 512_000,
            nativeLimit: 1_048_576,
            requestedBasis: 'native',
        });
        expect(nativeBasisHighCompaction.actualBasis).toBe('native');
        expect(nativeBasisHighCompaction.primaryPct).toBe(42.9);
        expect(nativeBasisHighCompaction.compactionPct).toBe(87.9);
        expect(nativeBasisHighCompaction.compactionWarningActive).toBe(true);
        expect(nativeBasisHighCompaction.compactionWarningLevel).toBe('critical');
        expect(nativeBasisHighCompaction.healthStatus).toBe('high_pressure');
        expect(nativeBasisHighCompaction.markers).toEqual([
            { id: 'tier_200k', label: '200k', tokens: 200_000, axis: 'native', positionPct: 19.1, exceeded: true },
            { id: 'compaction_limit', label: 'Compaction', tokens: 512_000, axis: 'native', positionPct: 48.8, exceeded: false },
        ]);
    });

    it('maps diagnostic telemetry exclusively through run-scoped opaque aliases with zero raw ID/path/title/secret leakage', () => {
        const aliasMap = new DiagnosticAliasMap();
        const secretCascade = 'secret-uuid-9876-customer-acme';
        const secretModel = 'MODEL_SECRET_INTERNAL_X';
        const obs = buildPublishedMonitorObservation({
            backendEpoch: 2,
            windowId: '/Users/alice/private-repo-window',
            rootCascadeId: secretCascade,
            subjectCascadeId: secretCascade,
            selectionRevision: 4,
            dataRevision: 9,
            measuredModel: secretModel,
            usedTokens: 50_000,
            compactionLimit: 256_000,
            speedCallId: 'exec-token-bearer-xyz',
            displaySpeedTps: 140,
        });

        const diag = formatObservationDiagnostic(obs, aliasMap);
        const serialized = JSON.stringify(diag);
        expect(diag.rootAlias).toBe('conv_1');
        expect(diag.subjectAlias).toBe('conv_1');
        expect(diag.modelAlias).toBe('model_1');
        expect(diag.windowAlias).toBe('win_1');
        expect(diag.speedCallAlias).toBe('call_1');
        expect(aliasMap.aliasLabel('Confidential Prompt Title')).toBe('label_1');

        expect(serialized).not.toContain(secretCascade);
        expect(serialized).not.toContain(secretModel);
        expect(serialized).not.toContain('/Users/alice');
        expect(serialized).not.toContain('exec-token-bearer-xyz');

        aliasMap.reset();
        expect(aliasMap.aliasConversation('another-id')).toBe('conv_1');
    });
});

// ─── §1.2 & §3.3 Swarm Topology Registry: Security, Budgets, Anomalies ───────

describe('§1.2 & §3.3 SwarmTopologyRegistry: read-only allowlist, filesystem safety & hard budgets', () => {
    it('enforces §1.2 filename allowlist (rejects board.jsonl, transcript.jsonl, plan.json, steps/) and strips non-allowlisted prompt/brief fields', async () => {
        const brainRoot = makeTempBrainRoot();
        writeManifestFile(brainRoot, 'coord-1', 'members.json', {
            title: 'Wave 2A Swarm',
            secretPrompt: 'TOP_SECRET_PROMPT_DO_NOT_RETAIN',
            members: {
                coordinator: {
                    conversation_id: 'coord-1',
                    role: 'coordinator',
                    model: 'MODEL_PLACEHOLDER_M532',
                    applied_model: 'MODEL_PLACEHOLDER_M532',
                    workspace_mode: 'inherit',
                    phase: 'RUNNING',
                    killed: false,
                    workspace: '/Users/dev/repo',
                    brief: 'SECRET_BRIEF_MUST_BE_DISCARDED',
                    prompt: 'SECRET_PROMPT_MUST_BE_DISCARDED',
                },
                'worker-share': {
                    conversation_id: 'w-share-1',
                    role: 'worker',
                    model: 'MODEL_PLACEHOLDER_M532',
                    applied_model: 'MODEL_PLACEHOLDER_M537',
                    workspace_mode: 'share',
                    phase: 'RUNNING',
                    killed: false,
                    workspace: '/Users/dev/.gemini/antigravity/worktrees/coord-1/swarm-w-share',
                    brief: 'ANOTHER_SECRET_BRIEF',
                },
                'worker-branch': {
                    conversation_id: 'w-branch-1',
                    role: 'worker',
                    model: 'MODEL_PLACEHOLDER_M402',
                    workspace_mode: 'branch',
                    phase: 'KILLED',
                    killed: true,
                    workspace: '/Users/dev/.gemini/antigravity/worktrees/coord-1/swarm-w-branch',
                },
            },
        });
        // Write disallowed files beside members.json
        writeManifestFile(brainRoot, 'coord-1', 'board.jsonl', '{"text":"SECRET_BOARD_LINE"}\n');
        writeManifestFile(brainRoot, 'coord-1', 'transcript.jsonl', '{"prompt":"SECRET_TRANSCRIPT"}\n');
        writeManifestFile(brainRoot, 'coord-1', 'plan.json', '{"plan":"SECRET_PLAN"}');

        expect(ALLOWED_MANIFEST_FILENAMES.has('members.json')).toBe(true);
        expect(ALLOWED_MANIFEST_FILENAMES.has('swarm.json')).toBe(true);
        expect(ALLOWED_MANIFEST_FILENAMES.has('board.jsonl')).toBe(false);
        expect(ALLOWED_MANIFEST_FILENAMES.has('transcript.jsonl')).toBe(false);
        expect(ALLOWED_MANIFEST_FILENAMES.has('plan.json')).toBe(false);

        for (const forbidden of ['board.jsonl', 'transcript.jsonl', 'plan.json', 'steps/001.json']) {
            const res = await safeReadManifestFile(brainRoot, 'coord-1', forbidden);
            expect(res.ok).toBe(false);
            if (!res.ok) {
                expect(res.reason).toBe('disallowed_filename');
            }
        }

        const okRead = await safeReadManifestFile(brainRoot, 'coord-1', 'members.json');
        expect(okRead.ok).toBe(true);
        if (!okRead.ok) { throw new Error('expected ok'); }

        const parsed = parseAllowedManifestJson(okRead.rawText, 'coord-1', 'members.json');
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) { throw new Error('expected valid manifest'); }

        const jsonDump = JSON.stringify(parsed.manifest);
        expect(jsonDump).not.toContain('TOP_SECRET_PROMPT');
        expect(jsonDump).not.toContain('SECRET_BRIEF');
        expect(jsonDump).not.toContain('SECRET_PROMPT');

        // Verify inherit / share / branch workspace modes & assignedModel/appliedModel preserved cleanly
        const reg = new SwarmTopologyRegistry({ scope: { brainDir: brainRoot } });
        await reg.sweepManifests({ nowMs: 10_000 });
        const snap = reg.reconcile({ backendEpoch: 1, nowMs: 10_000 });

        expect(snap.nodesById.get('coord-1')).toMatchObject({
            rootId: 'coord-1',
            isCoordinator: true,
            workspaceMode: 'inherit',
            assignedModel: 'MODEL_PLACEHOLDER_M532',
            killed: false,
        });
        expect(snap.nodesById.get('w-share-1')).toMatchObject({
            rootId: 'coord-1',
            directParentId: null, // flat membership does not fabricate directParentId!
            relationshipKind: 'swarm_member',
            evidenceSource: 'manifest',
            workspaceMode: 'share',
            assignedModel: 'MODEL_PLACEHOLDER_M537',
            appliedModel: 'MODEL_PLACEHOLDER_M537',
            phase: 'RUNNING',
            killed: false,
        });
        expect(snap.nodesById.get('w-branch-1')).toMatchObject({
            rootId: 'coord-1',
            workspaceMode: 'branch',
            phase: 'KILLED',
            killed: true,
        });
    });

    it('validates safe cascadeId path segments and disables local brain scan on Remote-SSH / WSL without verified remote root', () => {
        expect(isSafeCascadeIdSegment('09dc88bc-c61d-47c0-ae69-7e88289ebcd8')).toBe(true);
        expect(isSafeCascadeIdSegment('../escape')).toBe(false);
        expect(isSafeCascadeIdSegment('..')).toBe(false);
        expect(isSafeCascadeIdSegment('.')).toBe(false);
        expect(isSafeCascadeIdSegment('a/b')).toBe(false);
        expect(isSafeCascadeIdSegment('a\\b')).toBe(false);
        expect(isSafeCascadeIdSegment('abc\0def')).toBe(false);
        expect(isSafeCascadeIdSegment('CON')).toBe(false);
        expect(isSafeCascadeIdSegment('NUL.json')).toBe(false);
        expect(isSafeCascadeIdSegment('trailing.')).toBe(false);
        expect(isSafeCascadeIdSegment('x'.repeat(129))).toBe(false);

        // Remote-SSH / WSL MUST return null so unrelated local ~/.gemini/antigravity/brain is NEVER scanned!
        expect(resolveScopedBrainRoot({ isRemoteHost: true, homeDir: '/Users/alice' })).toBeNull();
        expect(resolveScopedBrainRoot({ remoteAuthority: 'ssh-remote+prod', homeDir: '/Users/alice' })).toBeNull();
        expect(resolveScopedBrainRoot({ remoteAuthority: 'wsl+Ubuntu', homeDir: 'C:\\Users\\Alice' })).toBeNull();
        // Explicit verified remote root is allowed
        expect(resolveScopedBrainRoot({
            remoteAuthority: 'wsl+Ubuntu',
            remoteBrainVerified: true,
            brainDir: '/home/dev/.gemini/antigravity/brain',
        })).toBe(path.resolve('/home/dev/.gemini/antigravity/brain'));
        // Local priority: ANTIGRAVITY_BRAIN_DIR > ANTIGRAVITY_DATA_DIR > default home
        expect(resolveScopedBrainRoot({
            env: { ANTIGRAVITY_BRAIN_DIR: '/custom/brain', ANTIGRAVITY_DATA_DIR: '/custom/data' },
            homeDir: '/Users/alice',
        })).toBe(path.resolve('/custom/brain'));
        expect(resolveScopedBrainRoot({
            env: { ANTIGRAVITY_DATA_DIR: '/custom/data' },
            homeDir: '/Users/alice',
        })).toBe(path.resolve('/custom/data', 'brain'));
    });

    it('rejects symlinks, Windows junctions, lstat/fstat identity swaps, and enforces the 512 KB streaming byte cap', async () => {
        const brainRoot = makeTempBrainRoot();
        const outsideDir = makeTempBrainRoot('acm-outside-');
        const outsideManifest = path.join(outsideDir, 'members.json');
        fs.writeFileSync(outsideManifest, JSON.stringify({ members: {} }), 'utf8');

        // 1. Real POSIX symlink on members.json -> rejected!
        const symSwarmDir = path.join(brainRoot, 'sym-leaf', '.system_generated', 'swarm');
        fs.mkdirSync(symSwarmDir, { recursive: true });
        fs.symlinkSync(outsideManifest, path.join(symSwarmDir, 'members.json'));
        const symRes = await safeReadManifestFile(brainRoot, 'sym-leaf', 'members.json');
        expect(symRes.ok).toBe(false);
        if (!symRes.ok) { expect(symRes.reason).toBe('symlink_or_junction'); }

        // 2. Real POSIX symlink on ancestor directory -> rejected!
        fs.symlinkSync(outsideDir, path.join(brainRoot, 'sym-ancestor'));
        const ancRes = await safeReadManifestFile(brainRoot, 'sym-ancestor', 'members.json');
        expect(ancRes.ok).toBe(false);
        if (!ancRes.ok) { expect(ancRes.reason).toBe('symlink_or_junction'); }

        // 3. Simulated Windows NTFS junction (lstat non-symlink, realpath escapes brainRoot) -> rejected!
        const dirStat = (ino: number): SafeStatLike => ({
            dev: 1, ino, size: 0, mtimeMs: 1000, ctimeMs: 1000,
            isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false,
        });
        const fileStat = (dev: number, ino: number, size: number): SafeStatLike => ({
            dev, ino, size, mtimeMs: 1000, ctimeMs: 1000,
            isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
        });
        const junctionFs: SwarmManifestFsOps = {
            platform: 'win32',
            readdir: async () => ['junc-1'],
            lstat: async (p) => (p.endsWith('members.json') ? fileStat(1, 50, 20) : dirStat(10)),
            realpath: async (p) => (p.includes('swarm') ? 'C:\\OtherDrive\\Escaped\\swarm' : p),
            openReadOnly: async () => { throw new Error('should not open junction'); },
        };
        const juncRes = await safeReadManifestFile('C:\\Users\\Alice\\.gemini\\antigravity\\brain', 'junc-1', 'members.json', {
            fsOps: junctionFs,
        });
        expect(juncRes.ok).toBe(false);
        if (!juncRes.ok) { expect(juncRes.reason).toBe('symlink_or_junction'); }

        // 4. TOCTOU lstat vs fstat dev/ino mismatch -> rejected!
        let closed = false;
        const swapFs: SwarmManifestFsOps = {
            platform: 'linux',
            readdir: async () => ['swap-1'],
            lstat: async (p) => (p.endsWith('members.json') ? fileStat(1, 100, 20) : dirStat(10)),
            realpath: async (p) => p,
            openReadOnly: async (): Promise<SafeFileHandleLike> => ({
                stat: async () => fileStat(1, 999, 20), // different inode!
                read: async () => ({ bytesRead: 0, buffer: Buffer.alloc(0) }),
                close: async () => { closed = true; },
            }),
        };
        const swapRes = await safeReadManifestFile('/brain', 'swap-1', 'members.json', { fsOps: swapFs });
        expect(swapRes.ok).toBe(false);
        if (!swapRes.ok) { expect(swapRes.reason).toBe('identity_mismatch'); }
        expect(closed).toBe(true);

        // 5. Real file > 512 KB rejected cleanly
        const hugePayload = 'x'.repeat(512 * 1024 + 64);
        writeManifestFile(brainRoot, 'huge-1', 'members.json', hugePayload);
        const hugeRes = await safeReadManifestFile(brainRoot, 'huge-1', 'members.json');
        expect(hugeRes.ok).toBe(false);
        if (!hugeRes.ok) { expect(hugeRes.reason).toBe('file_too_large'); }

        // 6. Streaming byte cap enforced AT READ TIME even if stat.size lied and claimed 100 bytes!
        let streamReads = 0;
        const lyingStreamFs: SwarmManifestFsOps = {
            platform: 'linux',
            readdir: async () => ['grow-1'],
            lstat: async (p) => (p.endsWith('members.json') ? fileStat(1, 200, 100) : dirStat(10)),
            realpath: async (p) => p,
            openReadOnly: async (): Promise<SafeFileHandleLike> => ({
                stat: async () => fileStat(1, 200, 100), // lies about size!
                read: async (buf, offset, len) => {
                    streamReads++;
                    buf.fill(0x61, offset, offset + len);
                    return { bytesRead: len, buffer: buf }; // keeps emitting forever!
                },
                close: async () => {},
            }),
        };
        const streamRes = await safeReadManifestFile('/brain', 'grow-1', 'members.json', {
            maxFileBytes: 512 * 1024,
            fsOps: lyingStreamFs,
        });
        expect(streamRes.ok).toBe(false);
        if (!streamRes.ok) {
            expect(streamRes.reason).toBe('file_too_large');
            expect(streamRes.bytesRead).toBeLessThanOrEqual(512 * 1024 + 16 * 1024);
        }
        expect(streamReads).toBeLessThanOrEqual(34);
    });

    it('detects same-size/same-mtime in-place manifest edits, deletions, partial-JSON TTL expiry, and sweeps 205 dirs with continuation cursor', async () => {
        const brainRoot = makeTempBrainRoot();

        // 1. Same-size / same-mtime in-place edit detection via direct file hash + deletion detection
        const fixedTime = new Date('2026-11-27T10:00:00.000Z');
        const v1 = '{"members":{"coordinator":{"conversation_id":"c-mut","role":"coordinator","phase":"WAITING"}}}';
        const v2 = '{"members":{"coordinator":{"conversation_id":"c-mut","role":"coordinator","phase":"RUNNING"}}}';
        expect(Buffer.byteLength(v1)).toBe(Buffer.byteLength(v2)); // exact same byte size!

        const filePath = writeManifestFile(brainRoot, 'c-mut', 'members.json', v1);
        fs.utimesSync(filePath, fixedTime, fixedTime);

        let clock = 10_000;
        const reg = new SwarmTopologyRegistry({
            scope: { brainDir: brainRoot },
            budgets: { partialJsonGraceTtlMs: 5_000, maxDirsPerSweep: 200 },
            now: () => clock,
        });

        await reg.sweepManifests({ nowMs: clock });
        expect(reg.reconcile({ backendEpoch: 1, nowMs: clock }).nodesById.get('c-mut')?.phase).toBe('WAITING');

        // Overwrite in-place with identical size and restore identical mtime!
        fs.writeFileSync(filePath, v2, 'utf8');
        fs.utimesSync(filePath, fixedTime, fixedTime);
        clock += 1_000;
        const s2 = await reg.sweepManifests({ nowMs: clock });
        expect(s2.manifestsChanged).toBe(1);
        expect(reg.reconcile({ backendEpoch: 1, nowMs: clock }).nodesById.get('c-mut')?.phase).toBe('RUNNING');

        // Partial/corrupt JSON within 5s TTL -> preserves last valid manifest cleanly!
        fs.writeFileSync(filePath, '{"members":{"coordinator":', 'utf8');
        clock += 2_000; // 2s since last valid (<= 5s TTL)
        await reg.sweepManifests({ nowMs: clock });
        const duringGrace = reg.reconcile({ backendEpoch: 1, nowMs: clock });
        expect(duringGrace.nodesById.get('c-mut')?.phase).toBe('RUNNING');
        expect(duringGrace.nodesById.get('c-mut')?.isStaleManifest).toBeFalsy();

        // Still corrupt past 5s TTL -> marks stale!
        clock += 6_000; // 8s since last valid (> 5s TTL)
        await reg.sweepManifests({ nowMs: clock });
        const afterTtl = reg.reconcile({ backendEpoch: 1, nowMs: clock });
        expect(afterTtl.nodesById.get('c-mut')?.isStaleManifest).toBe(true);
        expect(afterTtl.anomalies.some(a => a.kind === 'stale_manifest')).toBe(true);

        // Deletion -> evicted cleanly!
        fs.unlinkSync(filePath);
        clock += 1_000;
        const sDel = await reg.sweepManifests({ nowMs: clock });
        expect(sDel.manifestsDeleted).toBe(1);
        expect(reg.reconcile({ backendEpoch: 1, nowMs: clock }).nodesById.has('c-mut')).toBe(false);

        // 2. Bounded 200-dir sweep with continuation cursor across 210 directories (dir #209 discovered on pass 2!)
        const cursorRoot = makeTempBrainRoot('acm-cursor-');
        for (let i = 1; i <= 210; i++) {
            const id = `dir-${String(i).padStart(3, '0')}`;
            fs.mkdirSync(path.join(cursorRoot, id), { recursive: true });
        }
        writeManifestFile(cursorRoot, 'dir-209', 'members.json', {
            members: {
                coordinator: { conversation_id: 'dir-209', role: 'coordinator', phase: 'RUNNING' },
                'late-worker': { conversation_id: 'late-w-209', role: 'worker', phase: 'RUNNING' },
            },
        });
        const cursorReg = new SwarmTopologyRegistry({
            scope: { brainDir: cursorRoot },
            budgets: { maxDirsPerSweep: 200 },
        });
        const pass1 = await cursorReg.sweepManifests({ nowMs: 1000 });
        expect(pass1.scannedDirs).toBe(200);
        expect(pass1.completedFullPass).toBe(false);
        expect(pass1.cursorAfter).toBe('dir-200');
        expect(cursorReg.reconcile({ backendEpoch: 1, nowMs: 1000 }).nodesById.has('late-w-209')).toBe(false);

        // Pass 2 resumes at dir-201..dir-210 -> discovers dir-209 without permanent starvation!
        const pass2 = await cursorReg.sweepManifests({ nowMs: 2000 });
        expect(pass2.scannedDirs).toBe(10);
        expect(pass2.completedFullPass).toBe(true);
        expect(pass2.cursorAfter).toBeNull();
        expect(cursorReg.reconcile({ backendEpoch: 1, nowMs: 2000 }).nodesById.get('late-w-209')?.rootId).toBe('dir-209');
    });

    it('shares the sweep byte budget across concurrent readers and reserves one cursor slot with a one-directory budget', async () => {
        const root = makeTempBrainRoot();
        for (const id of ['first', 'last', 'middle']) {
            writeManifestFile(root, id, 'members.json', { title: 'x'.repeat(600), members: {} });
        }
        const limited = new SwarmTopologyRegistry({
            scope: { brainDir: root }, budgets: { maxDirsPerSweep: 3, maxConcurrentOpens: 3, maxTotalBytesPerSweep: 1_000 },
        });
        const partial = await limited.sweepManifests();
        expect(partial.bytesRead).toBeGreaterThan(600);
        expect(partial.bytesRead).toBeLessThanOrEqual(1_000);
        const single = new SwarmTopologyRegistry({ scope: { brainDir: root }, budgets: { maxDirsPerSweep: 1 } });
        for (let tick = 0; tick < 3; tick++) {
            expect((await single.sweepManifests({ priorityCascadeIds: ['middle'] })).scannedDirs).toBe(1);
        }
        expect(single.getSweepCursor()).toBeNull();
    });

    it('never starves mixed-case directory IDs or skips unscanned cursor-slice dirs when an overlapping priority dir exhausts budget early', async () => {
        // 1. Mixed-case directory IDs ('Alpha', 'beta', 'Gamma', 'delta') with bounded 2-dir passes:
        //    UTF-16 code-unit sort matches `>` cursor comparison so 'Gamma' is NEVER permanently starved!
        const mixedRoot = makeTempBrainRoot('acm-mixed-case-');
        for (const id of ['Alpha', 'beta', 'Gamma', 'delta']) {
            writeManifestFile(mixedRoot, id, 'members.json', {
                members: {
                    coordinator: { conversation_id: id, role: 'coordinator', phase: 'RUNNING' },
                    worker: { conversation_id: `w-${id}`, role: 'worker', phase: 'RUNNING' },
                },
            });
        }
        const mixedReg = new SwarmTopologyRegistry({
            scope: { brainDir: mixedRoot },
            budgets: { maxDirsPerSweep: 2, maxConcurrentOpens: 2 },
        });
        const m1 = await mixedReg.sweepManifests({ nowMs: 1_000 });
        expect(m1.scannedDirs).toBe(2);
        expect(m1.completedFullPass).toBe(false);
        const m2 = await mixedReg.sweepManifests({ nowMs: 2_000 });
        expect(m2.scannedDirs).toBe(2);
        expect(m2.completedFullPass).toBe(true);
        expect(m2.cursorAfter).toBeNull();
        const mixedSnap = mixedReg.reconcile({ backendEpoch: 1, nowMs: 2_000 });
        for (const id of ['Alpha', 'beta', 'Gamma', 'delta']) {
            expect(mixedSnap.nodesById.has(`w-${id}`), `missing mixed-case worker w-${id}`).toBe(true);
        }

        // 2. Overlapping priority dir (`dir-018` inside active cursor slice `dir-011..dir-020`) exhausting byte budget early:
        //    cursor MUST stay at `dir-010` (NEVER jumping to `dir-018` and skipping `dir-011..dir-017`)!
        const prioRoot = makeTempBrainRoot('acm-prio-budget-');
        for (let i = 1; i <= 20; i++) {
            const id = `dir-${String(i).padStart(3, '0')}`;
            if (i === 18) {
                // Make dir-018 ~1050 bytes so it reads cleanly under 1200-byte sweep budget,
                // leaving <150 bytes so dir-011 hits sweep byte budget immediately after!
                writeManifestFile(prioRoot, id, 'members.json', {
                    title: 'x'.repeat(900),
                    members: {
                        coordinator: { conversation_id: id, role: 'coordinator', phase: 'RUNNING' },
                    },
                });
            } else if (i >= 11 && i <= 17) {
                writeManifestFile(prioRoot, id, 'members.json', {
                    members: {
                        coordinator: { conversation_id: id, role: 'coordinator', phase: 'RUNNING' },
                        worker: { conversation_id: `w-${id}`, role: 'worker', phase: 'RUNNING' },
                    },
                });
            } else {
                fs.mkdirSync(path.join(prioRoot, id), { recursive: true });
            }
        }

        const prioReg = new SwarmTopologyRegistry({
            scope: { brainDir: prioRoot },
            budgets: { maxDirsPerSweep: 10, maxTotalBytesPerSweep: 1_200, maxConcurrentOpens: 1 },
        });
        // Sweep 1 covers dir-001..dir-010 cleanly -> cursor sits at dir-010
        const s1 = await prioReg.sweepManifests({ nowMs: 1_000 });
        expect(s1.cursorAfter).toBe('dir-010');

        // Sweep 2 puts dir-018 as priority (overlapping dir-011..dir-020 slice); dir-018 exhausts byte budget!
        const s2 = await prioReg.sweepManifests({ priorityCascadeIds: ['dir-018'], nowMs: 2_000 });
        expect(s2.completedFullPass).toBe(false);
        expect(s2.cursorAfter).toBe('dir-010'); // MUST NOT jump to dir-018!

        // Sweep 3 (without dir-018 blowing the budget ahead of dir-011) resumes at dir-011 and discovers dir-011..dir-017!
        const s3 = await prioReg.sweepManifests({ nowMs: 3_000 });
        expect(s3.cursorAfter).not.toBe('dir-010');
        const snapAfter3 = prioReg.reconcile({ backendEpoch: 1, nowMs: 3_000 });
        for (let i = 11; i <= 14; i++) {
            const id = `dir-${String(i).padStart(3, '0')}`;
            expect(snapAfter3.nodesById.has(`w-${id}`), `dir ${id} must not be skipped`).toBe(true);
        }
    });

    it('handles ALL topology anomalies explicitly (conflicts, 0/multiple coords, nested sub-swarm, duplicate names, fork, orphan, cycle, deleted coord, unknown role)', async () => {
        const brainRoot = makeTempBrainRoot();

        // Outer swarm A + worker-1 coordinating nested sub-swarm + unknown role 'reviewer'
        writeManifestFile(brainRoot, 'coord-a', 'members.json', {
            title: 'Outer Swarm A',
            members: {
                coordinator: { conversation_id: 'coord-a', role: 'coordinator', phase: 'RUNNING', workspace_mode: 'inherit' },
                'worker-1': { conversation_id: 'w-1', role: 'worker', phase: 'RUNNING', workspace_mode: 'share' },
                'worker-2': { conversation_id: 'w-2-old', role: 'worker', phase: 'KILLED', killed: true, workspace_mode: 'share' },
                observer: { conversation_id: 'obs-1', role: 'reviewer', phase: 'RUNNING', workspace_mode: 'inherit' },
            },
        });
        // Nested sub-swarm coordinated by w-1
        writeManifestFile(brainRoot, 'w-1', 'members.json', {
            title: 'Nested Sub-Swarm',
            members: {
                coordinator: { conversation_id: 'w-1', role: 'coordinator', phase: 'RUNNING' },
                'helper-1': { conversation_id: 'h-1', role: 'worker', phase: 'RUNNING', workspace_mode: 'branch' },
            },
        });
        // Conflicting manifest B also claiming w-2-old + declaring 2 coordinators
        writeManifestFile(brainRoot, 'coord-b', 'members.json', {
            title: 'Conflicting Swarm B',
            members: {
                coord1: { conversation_id: 'coord-b', role: 'coordinator', phase: 'RUNNING' },
                coord2: { conversation_id: 'coord-b2', role: 'coordinator', phase: 'RUNNING' },
                contested: { conversation_id: 'w-2-old', role: 'worker', phase: 'RUNNING' },
            },
        });
        // Zero-coordinator manifest
        writeManifestFile(brainRoot, 'no-coord-dir', 'members.json', {
            members: {
                lone: { conversation_id: 'lone-w', role: 'worker', phase: 'RUNNING' },
            },
        });

        const reg = new SwarmTopologyRegistry({ scope: { brainDir: brainRoot } });
        await reg.sweepManifests({ nowMs: 1_000 });

        // Recreate worker-2 in coord-a with a new conversation_id -> duplicate member name with different IDs!
        writeManifestFile(brainRoot, 'coord-a', 'members.json', {
            title: 'Outer Swarm A',
            members: {
                coordinator: { conversation_id: 'coord-a', role: 'coordinator', phase: 'RUNNING', workspace_mode: 'inherit' },
                'worker-1': { conversation_id: 'w-1', role: 'worker', phase: 'RUNNING', workspace_mode: 'share' },
                'worker-2': { conversation_id: 'w-2-new', role: 'worker', phase: 'RUNNING', workspace_mode: 'share' },
                observer: { conversation_id: 'obs-1', role: 'reviewer', phase: 'RUNNING', workspace_mode: 'inherit' },
            },
        });
        await reg.sweepManifests({ nowMs: 2_000 });

        const trajectories: TopologyTrajectoryInput[] = [
            { cascadeId: 'coord-a' },
            { cascadeId: 'w-1' },
            { cascadeId: 'h-1' },
            { cascadeId: 'w-2-new' },
            { cascadeId: 'obs-1' },
            // Forked chat retaining parentCascadeId -> MUST be independent root, NOT worker!
            { cascadeId: 'fork-1', parentCascadeId: 'coord-a', isFork: true },
            // Unknown parent / orphan
            { cascadeId: 'orphan-1', parentCascadeId: 'nonexistent-parent', isSubagent: true },
            // Cycle: cyc-a -> cyc-b -> cyc-a
            { cascadeId: 'cyc-a', parentCascadeId: 'cyc-b', isSubagent: true },
            { cascadeId: 'cyc-b', parentCascadeId: 'cyc-a', isSubagent: true },
            // Worker whose coordinator is confirmed deleted
            { cascadeId: 'child-of-deleted', parentCascadeId: 'dead-coord', isSubagent: true },
            // Explicit coordinator with swarm-* branch MUST NOT be reclassified as worker!
            { cascadeId: 'explicit-coord-branch', role: 'coordinator', branchName: 'swarm-fake-1234abcd' },
        ];

        const snap = reg.reconcile({
            backendEpoch: 1,
            nowMs: 2_000,
            trajectories,
            deletedConversationIds: new Set(['dead-coord']),
        });

        // Nested sub-swarm: h-1 resolves all the way up to coord-a as rootId with directParentId w-1!
        expect(snap.nodesById.get('w-1')?.rootId).toBe('coord-a');
        expect(snap.nodesById.get('w-1')?.isCoordinator).toBe(true);
        expect(snap.nodesById.get('h-1')).toMatchObject({
            rootId: 'coord-a',
            directParentId: 'w-1',
            relationshipKind: 'nested_helper',
            subSwarmCoordinatorId: 'w-1',
        });
        expect(reg.resolveRootId('h-1')).toBe('coord-a');

        // Duplicate member names with different IDs: BOTH w-2-old and w-2-new retained!
        expect(snap.nodesById.has('w-2-old')).toBe(true);
        expect(snap.nodesById.has('w-2-new')).toBe(true);
        expect(snap.nodesById.get('w-2-new')?.duplicateNameConflict).toBe(true);
        expect(snap.anomalies.some(a => a.kind === 'duplicate_member_name')).toBe(true);

        // Conflicting manifests + multiple coordinators + zero coordinators
        expect(snap.nodesById.get('w-2-old')?.hasConflict).toBe(true);
        expect(snap.anomalies.some(a => a.kind === 'conflicting_manifest')).toBe(true);
        expect(snap.anomalies.some(a => a.kind === 'multiple_coordinators')).toBe(true);
        expect(snap.anomalies.some(a => a.kind === 'zero_coordinators')).toBe(true);

        // Unknown role MUST NOT auto-classify as worker!
        expect(classifyAssignedRole('reviewer')).toBe('unknown');
        expect(snap.nodesById.get('obs-1')?.hasUnknownRole).toBe(true);
        expect(reg.isKnownWorkerOrSubagent('obs-1')).toBe(false);
        expect(snap.anomalies.some(a => a.kind === 'unknown_role' && a.cascadeId === 'obs-1')).toBe(true);

        // Explicit coordinator with swarm branch stays coordinator
        expect(reg.isKnownWorkerOrSubagent('explicit-coord-branch')).toBe(false);

        // Forked chat retaining parentId stays independent root
        expect(snap.nodesById.get('fork-1')).toMatchObject({
            relationshipKind: 'fork',
            directParentId: 'coord-a',
            rootId: 'fork-1',
        });
        expect(reg.isKnownWorkerOrSubagent('fork-1')).toBe(false);
        expect(reg.resolveRootId('fork-1')).toBe('fork-1');

        // Unknown parent / orphan
        expect(snap.nodesById.get('orphan-1')?.isOrphan).toBe(true);
        expect(snap.anomalies.some(a => a.kind === 'unknown_parent' && a.cascadeId === 'orphan-1')).toBe(true);

        // Cycle terminated cleanly
        expect(snap.nodesById.get('cyc-a')?.cycleDetected).toBe(true);
        expect(snap.nodesById.get('cyc-b')?.cycleDetected).toBe(true);
        expect(snap.anomalies.some(a => a.kind === 'cycle')).toBe(true);

        // Deleted coordinator flagged cleanly
        expect(snap.groupsByRootId.get('dead-coord')?.coordinatorDeleted).toBe(true);
        expect(snap.anomalies.some(a => a.kind === 'deleted_coordinator' && a.rootId === 'dead-coord')).toBe(true);
    });

    it('invalidates RPC step topology projections on backendEpoch or branchRevision change (even with equal stepCount)', () => {
        const reg = new SwarmTopologyRegistry({ scope: { isRemoteHost: true } });
        reg.reconcile({
            backendEpoch: 1,
            nowMs: 1_000,
            rpcLinks: [
                { parentCascadeId: 'root-1', childCascadeId: 'sub-old', kind: 'direct_subagent', observedAtMs: 1_000, branchRevision: 'rev-A' },
            ],
            branchRevisionByCascade: new Map([['root-1', 'rev-A']]),
        });
        expect(reg.getNode('sub-old')?.directParentId).toBe('root-1');

        // Equal-step edit / rewind changes branchRevision from rev-A -> rev-B -> expires sub-old!
        const snap2 = reg.reconcile({
            backendEpoch: 1,
            nowMs: 2_000,
            rpcLinks: [
                { parentCascadeId: 'root-1', childCascadeId: 'sub-new', kind: 'direct_subagent', observedAtMs: 2_000, branchRevision: 'rev-B' },
            ],
            branchRevisionByCascade: new Map([['root-1', 'rev-B']]),
        });
        expect(snap2.nodesById.has('sub-old')).toBe(false);
        expect(snap2.nodesById.get('sub-new')?.directParentId).toBe('root-1');

        // New backendEpoch clears old epoch RPC links
        const snap3 = reg.reconcile({ backendEpoch: 2, nowMs: 3_000 });
        expect(snap3.nodesById.size).toBe(0);
    });
});

// ─── §3.3 Fair-Budget Scheduler & Deduplicated Group Cost Aggregator ─────────

describe('§3.3 SwarmPollScheduler (20+ members fair round-robin) & aggregateSwarmGroupCost', () => {
    it('uses monotonic elapsed time for transport and scheduling across wall-clock jumps', async () => {
        let monoMs = 100;
        let wallMs = 2_000_000;
        const monotonic = vi.spyOn(performance, 'now').mockImplementation(() => monoMs);
        const wall = vi.spyOn(Date, 'now').mockImplementation(() => wallMs);
        const limits = { maxRequests: 10, maxBytes: 4096, maxPages: 10, maxConcurrency: 1, maxElapsedMs: 50 };
        try {
            await withTrajectoryPollBudget(limits, async () => {
                const getTimeout = () => withTrajectoryRpcSlot('GetCascadeTrajectorySteps', 10_000, async timeout => timeout);
                expect(await getTimeout()).toBe(50);
                wallMs += 86_400_000;
                monoMs += 12;
                expect(await getTimeout()).toBe(38);
                wallMs -= 172_800_000;
                monoMs += 38;
                await expect(getTimeout()).rejects.toThrow('budget exhausted');
            });
            const scheduler = new SwarmPollScheduler({ budget: limits });
            const result = await scheduler.runTick({
                nowMs: 1, rootCascadeId: 'root', members: [{ cascadeId: 'root' }, { cascadeId: 'a' }, { cascadeId: 'b' }],
                pollMember: async id => {
                    monoMs += 26;
                    wallMs += id === 'root' ? 86_400_000 : -172_800_000;
                    return { ok: true };
                },
            });
            expect(result.executedMemberIds).toEqual(['root', 'a']);
            expect(result.deferredMemberIds).toEqual(['b']);
            expect(result.budgetExhaustedReason).toBe('elapsed');
            expect(result.elapsedMs).toBe(52);
            expect(result.lastObservedAtByCascade.a).toBe(wallMs);
        } finally {
            wall.mockRestore();
            monotonic.mockRestore();
        }
    });

    it('prioritizes Coordinator + inspectedMember, enforces concurrency <= 3, rotates 22 active members without starvation, and gives 1 final refresh on killed transition', async () => {
        let nowMs = 10_000;
        const scheduler = new SwarmPollScheduler({
            budget: {
                maxRequests: 6,
                maxBytes: 1_000_000,
                maxPages: 20,
                maxConcurrency: 10, // MUST be clamped to <= 3!
                maxElapsedMs: 5_000,
            },
            now: () => nowMs,
        });

        const members = [
            { cascadeId: 'coord-root', isRunning: true },
            ...Array.from({ length: 22 }, (_, i) => ({
                cascadeId: `w-${String(i + 1).padStart(2, '0')}`,
                isRunning: true,
            })),
        ];

        const observedWorkers = new Set<string>();
        const pollCounts = new Map<string, number>();

        // Run 6 ticks with budget=6 (2 reserved: coord-root + w-15 inspected; 4 round-robin slots per tick -> 24 slots across 6 ticks covers all 21 remaining workers!)
        for (let tick = 0; tick < 6; tick++) {
            nowMs += 1_000;
            const res = await scheduler.runTick({
                rootCascadeId: 'coord-root',
                inspectedMemberId: 'w-15',
                members,
                pollMember: async (cid) => {
                    await new Promise(r => setTimeout(r, 2));
                    pollCounts.set(cid, (pollCounts.get(cid) ?? 0) + 1);
                    if (cid.startsWith('w-')) { observedWorkers.add(cid); }
                    return { ok: true, requestsUsed: 1, bytesUsed: 1024, pagesUsed: 1 };
                },
                nowMs,
            });
            expect(res.maxObservedConcurrency).toBeLessThanOrEqual(3);
            expect(res.executedMemberIds).toContain('coord-root');
            expect(res.executedMemberIds).toContain('w-15');
            expect(res.requestsUsed).toBeLessThanOrEqual(6);
            expect(res.partialCoverage).toBe(true);
        }

        // ZERO starvation: EVERY ONE of the 22 workers (#1..#22, including #9..#22!) was observed!
        expect(observedWorkers.size).toBe(22);
        expect(pollCounts.get('coord-root')).toBe(6);
        expect(pollCounts.get('w-15')).toBe(6);

        // Transition w-03 to killed -> gets EXACTLY ONE final refresh, then 0 refreshes after!
        const membersWithKilled = members.map(m => (m.cascadeId === 'w-03' ? { ...m, isKilled: true, isRunning: false } : m));
        nowMs += 1_000;
        const killTick1 = await scheduler.runTick({
            rootCascadeId: 'coord-root',
            inspectedMemberId: 'w-15',
            members: membersWithKilled,
            pollMember: async (cid) => {
                pollCounts.set(cid, (pollCounts.get(cid) ?? 0) + 1);
                return { ok: true, requestsUsed: 1, bytesUsed: 512, pagesUsed: 1 };
            },
            nowMs,
        });
        expect(killTick1.terminalFinalRefreshIds).toEqual(['w-03']);
        const w03CountAfterFinal = pollCounts.get('w-03')!;

        // Next tick: w-03 is NOT polled again!
        nowMs += 1_000;
        const killTick2 = await scheduler.runTick({
            rootCascadeId: 'coord-root',
            inspectedMemberId: 'w-15',
            members: membersWithKilled,
            pollMember: async (cid) => {
                pollCounts.set(cid, (pollCounts.get(cid) ?? 0) + 1);
                return { ok: true, requestsUsed: 1, bytesUsed: 512, pagesUsed: 1 };
            },
            nowMs,
        });
        expect(killTick2.terminalFinalRefreshIds).toEqual([]);
        expect(pollCounts.get('w-03')).toBe(w03CountAfterFinal);
    });

    it('shares a single unified budget across GM, Activity, Steps, Image, and Swarm tasks', async () => {
        let nowMs = 50_000;
        const scheduler = new SwarmPollScheduler({
            budget: { maxRequests: 5, maxBytes: 5_000, maxPages: 10, maxConcurrency: 3, maxElapsedMs: 1_000 },
            now: () => nowMs,
        });

        const res = await scheduler.runTick({
            rootCascadeId: 'coord-1',
            members: [
                { cascadeId: 'coord-1', isRunning: true },
                { cascadeId: 'w-1', isRunning: true },
                { cascadeId: 'w-2', isRunning: true },
            ],
            extraTasks: [
                {
                    id: 'gm-poll',
                    category: 'gm',
                    priority: 1,
                    run: async () => ({ ok: true, requestsUsed: 1, bytesUsed: 3_000, pagesUsed: 2 }),
                },
                {
                    id: 'activity-poll',
                    category: 'activity',
                    priority: 1,
                    run: async () => ({ ok: true, requestsUsed: 1, bytesUsed: 3_000, pagesUsed: 1 }),
                },
            ],
            pollMember: async () => ({ ok: true, requestsUsed: 1, bytesUsed: 1_000, pagesUsed: 1 }),
            nowMs,
        });

        // Byte budget (5_000) stops remaining lower-priority swarm member tasks cleanly!
        expect(res.executedMemberIds).toContain('coord-1');
        expect(res.executedExtraTaskIds.length).toBeGreaterThanOrEqual(1);
        expect(res.budgetExhaustedReason).toBe('bytes');
        expect(res.deferredMemberIds.length).toBeGreaterThan(0);
    });

    it('never starves mixed-case worker IDs in SwarmPollScheduler round-robin even with out-of-order async completions', async () => {
        let nowMs = 1_000;
        const scheduler = new SwarmPollScheduler({
            budget: { maxRequests: 3, maxBytes: 1_000_000, maxPages: 10, maxConcurrency: 2, maxElapsedMs: 5_000 },
            now: () => nowMs,
        });
        const members = [
            { cascadeId: 'coord-root', isRunning: true },
            { cascadeId: 'Alpha', isRunning: true },
            { cascadeId: 'beta', isRunning: true },
            { cascadeId: 'Gamma', isRunning: true },
            { cascadeId: 'delta', isRunning: true },
        ];
        const seenWorkers = new Set<string>();
        // 1 coord + 2 round-robin workers per tick -> 2 ticks MUST cover all 4 mixed-case workers!
        for (let tick = 0; tick < 2; tick++) {
            nowMs += 1_000;
            const res = await scheduler.runTick({
                rootCascadeId: 'coord-root',
                members,
                pollMember: async (cid) => {
                    // Intentionally finish 'Alpha' slower than 'Gamma' to exercise out-of-order completion!
                    const delay = cid === 'Alpha' || cid === 'beta' ? 8 : 1;
                    await new Promise(r => setTimeout(r, delay));
                    if (cid !== 'coord-root') { seenWorkers.add(cid); }
                    return { ok: true, requestsUsed: 1, bytesUsed: 100, pagesUsed: 1 };
                },
                nowMs,
            });
            expect(res.executedMemberIds).toContain('coord-root');
        }
        expect([...seenWorkers].sort()).toEqual(['Alpha', 'Gamma', 'beta', 'delta']);
    });

    it('deduplicates group cost by unique logical call ID while separating direct member costs, inclusive total, and unpriced calls', () => {
        const summary = aggregateSwarmGroupCost({
            rootId: 'coord-1',
            memberIds: ['w-1', 'w-2'],
            calls: [
                { logicalCallId: 'call-c1', cascadeId: 'coord-1', costUsd: 0.25, inputTokens: 10_000, outputTokens: 1_000 },
                { logicalCallId: 'call-w1-a', cascadeId: 'w-1', costUsd: 0.40, inputTokens: 20_000, outputTokens: 2_000 },
                // Exact duplicate logical call ID reported on both w-1 and w-2 -> counted ONCE in inclusiveGroupCostUsd!
                { logicalCallId: 'call-w1-a', cascadeId: 'w-2', costUsd: 0.40, inputTokens: 20_000, outputTokens: 2_000 },
                // Exact $0.00 priced call (NOT unpriced!)
                { logicalCallId: 'call-w2-free', cascadeId: 'w-2', costUsd: 0, inputTokens: 5_000, outputTokens: 500 },
                // Unpriced call (null costUsd)
                { logicalCallId: 'call-w2-unpriced', cascadeId: 'w-2', costUsd: null, inputTokens: 8_000, outputTokens: 800 },
                // Unrelated conversation outside group -> ignored
                { logicalCallId: 'call-foreign', cascadeId: 'other-conv', costUsd: 9.99, inputTokens: 1_000, outputTokens: 100 },
            ],
        });

        expect(summary.coordinatorDirectCostUsd).toBeCloseTo(0.25, 6);
        expect(summary.directCostByMember['w-1'].directCostUsd).toBeCloseTo(0.40, 6);
        expect(summary.directCostByMember['w-2'].directCostUsd).toBeCloseTo(0.40, 6);
        expect(summary.directCostByMember['w-2'].pricedCallCount).toBe(2); // 0.40 + 0.00
        expect(summary.directCostByMember['w-2'].unpricedCallCount).toBe(1);
        // Inclusive group total deduplicates call-w1-a -> 0.25 + 0.40 + 0.00 = 0.65 (NOT 1.05!)
        expect(summary.inclusiveGroupCostUsd).toBeCloseTo(0.65, 6);
        expect(summary.uniqueCallCount).toBe(4);
        expect(summary.duplicateCallsDeduplicated).toBe(1);
        expect(summary.pricedCallCount).toBe(3);
        expect(summary.unpricedCallCount).toBe(1);
        expect(summary.hasUnpricedCalls).toBe(true);
    });
});

// ─── §3.2 Window-Scoped 3-Field Lock State Machine ───────────────────────────

describe('§3.2 Window-Scoped 3-Field Lock State Machine (src/conversation-selector.ts)', () => {
    it('survives ALL 5 passive hijack classes while locked to lockedRootId', () => {
        const root = makeTraj('root-1', { status: 'CASCADE_RUN_STATUS_IDLE', lastModifiedTime: '2026-11-27T10:00:00Z' });
        const otherMain = makeTraj('main-2', { status: CascadeStatus.RUNNING, lastModifiedTime: '2026-11-27T10:05:00Z' });
        const worker = makeTraj('w-1', {
            status: CascadeStatus.RUNNING,
            parentCascadeId: 'root-1',
            lastModifiedTime: '2026-11-27T10:06:00Z',
        });

        let state: WindowSelectionState = createWindowSelectionState({
            backendEpoch: 1,
            windowId: 'win-1',
            lockedRootId: 'root-1',
            lockToMainAgent: true,
        });

        // Hijack Class 1: Blank new chat (`isNewConversation: true`)
        const blankFocus = recordObservedHostFocus(state, {
            cascadeId: null,
            authority: 'host_sdk',
            focusRevision: 1,
            observedAtMs: 1000,
            isNewConversation: true,
        });
        state = blankFocus.state;
        const r1 = selectConversation(state, { trajectories: [root, otherMain, worker] });
        expect(r1.resolution.cascadeId).toBe('root-1');
        expect(r1.resolution.hostPending).toBe(false);
        expect(r1.state.lockedRootId).toBe('root-1');

        // Hijack Class 2: Unseen host conversation ID
        state = recordObservedHostFocus(state, {
            cascadeId: 'unseen-host-999',
            authority: 'host_sdk',
            focusRevision: 2,
            observedAtMs: 2000,
        }).state;
        const r2 = selectConversation(state, { trajectories: [root, worker] });
        expect(r2.resolution.cascadeId).toBe('root-1');
        expect(r2.resolution.hostPending).toBe(false);
        expect(r2.state.lockedRootId).toBe('root-1');
        expect(r2.resolution.retargetOfferId).toBe('unseen-host-999');

        // Hijack Class 3: Child-only / transient root omission -> MUST show pending unavailable and NEVER jump to worker!
        const r3 = selectConversation(state, { trajectories: [worker] });
        expect(r3.resolution.cascadeId).toBe('root-1');
        expect(r3.resolution.target).toBeNull();
        expect(r3.resolution.lockPendingUnavailable).toBe(true);
        expect(r3.state.lockedRootId).toBe('root-1');
        expect(r3.state.lockPendingUnavailable).toBe(true);

        // Hijack Class 4: Passive hostConversationId on another main + newlyCreatedIds + background RUNNING
        state = recordObservedHostFocus(state, {
            cascadeId: 'main-2',
            authority: 'host_sdk',
            focusRevision: 3,
            observedAtMs: 3000,
        }).state;
        const r4 = selectConversation(state, {
            trajectories: [root, otherMain, worker],
            newlyCreatedIds: new Set(['main-2']),
        });
        expect(r4.resolution.cascadeId).toBe('root-1');
        expect(r4.state.lockedRootId).toBe('root-1');
        expect(r4.resolution.retargetOfferId).toBe('main-2');
        expect(r4.resolution.ignoredSubagentBurst).toBe(true);

        // Hijack Class 5: SIDEBAR null focus + Level 3 passive CDP visible composer / first URL UUID
        const sidebarNull = recordObservedHostFocus(state, {
            cascadeId: null,
            authority: 'host_sdk',
            focusRevision: 4,
            observedAtMs: 4000,
            viewMode: 'sidebar',
        });
        expect(sidebarNull.accepted).toBe(false);
        expect(sidebarNull.reason).toBe('ignored_sidebar_null_focus');

        const cdpComposer = recordObservedHostFocus(state, {
            cascadeId: null,
            authority: 'cdp_passive',
            focusRevision: 5,
            observedAtMs: 5000,
            isNewConversation: true,
            inferredFromVisibleComposer: true,
        });
        expect(cdpComposer.accepted).toBe(false);
        expect(cdpComposer.reason).toBe('rejected_cdp_visible_composer_new_chat');

        const cdpFirstUuid = recordObservedHostFocus(state, {
            cascadeId: 'main-2',
            authority: 'cdp_passive',
            focusRevision: 6,
            observedAtMs: 6000,
            inferredFromFirstUrlUuid: true,
        });
        expect(cdpFirstUuid.accepted).toBe(false);
        expect(cdpFirstUuid.reason).toBe('rejected_cdp_first_url_uuid');

        const r5 = selectConversation(state, { trajectories: [root, otherMain, worker] });
        expect(r5.resolution.cascadeId).toBe('root-1');
        expect(r5.state.lockedRootId).toBe('root-1');
    });

    it('inspects an unindexed member without switching to the pinned root, then restores the pin', () => {
        const pinned = makeTraj('pinned-root');
        const state = inspectMember(createWindowSelectionState({ backendEpoch: 1, windowId: 'w' }), 'archived-worker', pinned.cascadeId);
        const input = {
            trajectories: [pinned], pinnedId: pinned.cascadeId,
            deletedConversationIds: new Set(['archived-worker']),
            topologyResolveRootId: (id: string) => id === 'archived-worker' ? 'other-group' : null,
        };
        const missing = selectConversation(state, input);
        expect(missing.resolution).toMatchObject({ cascadeId: 'archived-worker', target: null, rootCascadeId: 'other-group', pinnedFallback: false });
        expect(missing.state.inspectedMemberId).toBe('archived-worker');
        const worker = makeTraj('archived-worker', { role: 'worker' });
        const found = selectConversation(missing.state, { ...input, trajectories: [pinned, worker], deletedConversationIds: new Set() });
        expect(found.resolution.target).toBe(worker);
        expect(found.state.inspectionReturnId).toBe('pinned-root');
        expect(selectConversation(clearInspect(found.state), input).resolution.cascadeId).toBe('pinned-root');
    });

    it('synchronously anchors rootId when enabling lock while inspecting a nested worker, preserves lockedRootId during inspectMember, and restores instantly on clearInspect', () => {
        const root = makeTraj('coord-root');
        const worker = makeTraj('worker-1', { parentCascadeId: 'coord-root', role: 'worker' });
        const helper = makeTraj('helper-1', { parentCascadeId: 'worker-1', role: 'helper' });

        // Cycle protection in resolveRootCascadeIdSync
        const cycParent = new Map<string, string | null>([['x', 'y'], ['y', 'x']]);
        expect(resolveRootCascadeIdSync('x', { parentByCascade: cycParent })).toBe('y');

        // Start unlocked while inspecting nested helper-1
        let state = createWindowSelectionState({
            backendEpoch: 1,
            windowId: 'win-1',
            inspectedMemberId: 'helper-1',
            lockToMainAgent: false,
        });

        // Synchronous lock enable walks helper-1 -> worker-1 -> coord-root!
        state = enableLockToMainAgent(state, {
            trajectories: [root, worker, helper],
            currentActiveId: 'helper-1',
        });
        expect(state.lockedRootId).toBe('coord-root');
        expect(state.inspectedMemberId).toBe('helper-1');

        // Inspecting another worker sets ONLY inspectedMemberId — NEVER overwrites lockedRootId!
        state = inspectMember(state, 'worker-1');
        expect(state.lockedRootId).toBe('coord-root');
        expect(state.inspectedMemberId).toBe('worker-1');

        const inspectedRes = selectConversation(state, { trajectories: [root, worker, helper] });
        expect(inspectedRes.resolution.cascadeId).toBe('worker-1');
        expect(inspectedRes.resolution.rootCascadeId).toBe('coord-root');
        expect(inspectedRes.resolution.lockedMainId).toBe('coord-root');
        expect(inspectedRes.resolution.subjectKind).toBe('worker');

        // Back to Main (`clearInspect`) restores lockedRootId instantly!
        state = clearInspect(state);
        expect(state.inspectedMemberId).toBeNull();
        expect(state.lockedRootId).toBe('coord-root');
        const backRes = selectConversation(state, { trajectories: [root, worker, helper] });
        expect(backRes.resolution.cascadeId).toBe('coord-root');
        expect(backRes.resolution.subjectKind).toBe('main');

        // Explicit Level 1 Retarget moves lockedRootId cleanly
        const main2 = makeTraj('main-2');
        state = retargetLockedRoot(state, 'main-2');
        expect(state.lockedRootId).toBe('main-2');
        expect(state.inspectedMemberId).toBeNull();
        const retargetRes = selectConversation(state, { trajectories: [root, main2] });
        expect(retargetRes.resolution.cascadeId).toBe('main-2');

        // Unlock clears lockedRootId
        state = disableLockToMainAgent(state);
        expect(state.lockedRootId).toBeNull();
        expect(state.lockToMainAgent).toBe(false);
    });

    it('enforces authority grading (SDK callback > stale getter > passive CDP), epoch-scoped deletion, and split-pane retarget offers in unlocked mode', () => {
        let state = createWindowSelectionState({ backendEpoch: 2, windowId: 'win-2', lockToMainAgent: false });

        // Live SDK callback at rev 5
        const sdkCb = recordObservedHostFocus(state, {
            cascadeId: 'main-a',
            authority: 'host_sdk',
            focusRevision: 5,
            observedAtMs: 1000,
            fromSdkCallback: true,
        });
        expect(sdkCb.accepted).toBe(true);
        state = sdkCb.state;

        // Stale non-empty SDK getter at same rev 5 -> REJECTED!
        const staleGetter = recordObservedHostFocus(state, {
            cascadeId: 'stale-initial-url',
            authority: 'host_sdk',
            focusRevision: 5,
            observedAtMs: 1001,
            fromSdkCallback: false,
        });
        expect(staleGetter.accepted).toBe(false);
        expect(staleGetter.reason).toBe('stale_sdk_getter_rejected');

        // Passive CDP at rev 5 -> REJECTED (lower authority)!
        const lowerCdp = recordObservedHostFocus(state, {
            cascadeId: 'main-b',
            authority: 'cdp_passive',
            focusRevision: 5,
            observedAtMs: 1002,
        });
        expect(lowerCdp.accepted).toBe(false);
        expect(lowerCdp.reason).toBe('lower_authority_rejected');

        // Cross-epoch focus event -> REJECTED!
        const wrongEpoch = recordObservedHostFocus(state, {
            cascadeId: 'main-b',
            authority: 'host_sdk',
            focusRevision: 99,
            observedAtMs: 2000,
        }, { backendEpoch: 1 });
        expect(wrongEpoch.accepted).toBe(false);
        expect(wrongEpoch.reason).toBe('stale_backend_epoch');

        // Unlocked auto-follow with unfocused split-pane main offers retargetOfferId without hijacking!
        const mainA = makeTraj('main-a', { lastModifiedTime: '2026-11-27T10:00:00Z' });
        const mainB = makeTraj('main-b', { lastModifiedTime: '2026-11-27T10:02:00Z' });
        const splitFocus = recordObservedHostFocus(state, {
            cascadeId: 'main-b',
            authority: 'cdp_passive',
            focusRevision: 6,
            observedAtMs: 3000,
            isFocusedPane: false,
        });
        expect(splitFocus.accepted).toBe(true);
        const splitRes = selectConversation(splitFocus.state, {
            trajectories: [mainA, mainB],
            currentActiveId: 'main-a',
        });
        expect(splitRes.resolution.cascadeId).toBe('main-a');
        expect(splitRes.resolution.retargetOfferId).toBe('main-b');

        // Backend epoch change preserves lock as pending-unavailable and does NOT accept deletion from old epoch
        const lockedEpoch2 = createWindowSelectionState({
            backendEpoch: 2,
            windowId: 'win-2',
            lockedRootId: 'main-a',
            lockToMainAgent: true,
        });
        const epoch3 = advanceWindowBackendEpoch(lockedEpoch2, 3);
        expect(epoch3.backendEpoch).toBe(3);
        expect(epoch3.lockedRootId).toBe('main-a');
        expect(epoch3.lockPendingUnavailable).toBe(true);
        // Deletion reported under old epoch 2 MUST NOT evict epoch 3's lock!
        const crossEpochDel = selectConversation(epoch3, {
            trajectories: [mainB],
            backendEpoch: 2,
            deletedConversationIds: new Set(['main-a']),
        });
        expect(crossEpochDel.state.lockedRootId).toBe('main-a');
        expect(crossEpochDel.resolution.lockPendingUnavailable).toBe(true);
    });
});

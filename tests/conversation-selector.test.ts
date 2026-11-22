import { describe, expect, it } from 'vitest';
import {
    buildConversationOptions,
    isSubagentTrajectory,
    normalizeWorkspaceUri,
    resolveTargetConversation,
    type ConversationTrajectoryLike,
} from '../src/conversation-selector';
import { CascadeStatus } from '../src/constants';

function makeTrajectory(
    cascadeId: string,
    overrides: Partial<ConversationTrajectoryLike> = {},
): ConversationTrajectoryLike {
    return {
        cascadeId,
        trajectoryId: `traj-${cascadeId}`,
        summary: `Conversation ${cascadeId}`,
        stepCount: 5,
        status: 'CASCADE_RUN_STATUS_IDLE',
        lastModifiedTime: '2026-11-22T10:00:00.000Z',
        createdTime: '2026-11-22T09:00:00.000Z',
        requestedModel: 'MODEL_PLACEHOLDER_M532',
        generatorModel: 'MODEL_PLACEHOLDER_M532',
        workspaceUris: ['file:///Users/dev/antigravity'],
        ...overrides,
    };
}

describe('isSubagentTrajectory', () => {
    it('detects subagent / swarm / child trajectories cleanly across metadata fields and prefixes', () => {
        expect(isSubagentTrajectory(makeTrajectory('c1', { isSubagent: true }))).toBe(true);
        expect(isSubagentTrajectory(makeTrajectory('c2', { parentCascadeId: 'main-1' }))).toBe(true);
        expect(isSubagentTrajectory(makeTrajectory('c3', { trajectoryType: 'TRAJECTORY_TYPE_SUBAGENT' }))).toBe(true);
        expect(isSubagentTrajectory(makeTrajectory('c4', { trajectoryType: 'SWARM_WORKER' }))).toBe(true);
        expect(isSubagentTrajectory(makeTrajectory('c5', { trajectoryMetadata: { parentCascadeId: 'main-1' } }))).toBe(true);
        expect(isSubagentTrajectory(makeTrajectory('c6', { trajectoryMetadata: { isChild: true } }))).toBe(true);
        expect(isSubagentTrajectory(makeTrajectory('c7', { trajectoryMetadata: { role: 'worker', swarmId: 's1' } }))).toBe(true);
        expect(isSubagentTrajectory(makeTrajectory('c8', { trajectoryMetadata: { spawnedBy: 'coordinator' } }))).toBe(true);
        expect(isSubagentTrajectory(makeTrajectory('c9', { summary: '[Subagent] Audit repo architecture' }))).toBe(true);
        expect(isSubagentTrajectory(makeTrajectory('c10', { summary: '[Swarm: telemetry-architect] Build modules' }))).toBe(true);
        expect(isSubagentTrajectory(makeTrajectory('c11', { summary: 'Subagent: inspect RPC payloads' }))).toBe(true);
        expect(isSubagentTrajectory(makeTrajectory('c12', { summary: 'swarm-telemetry-architect-22593eb9' }))).toBe(true);
        expect(isSubagentTrajectory(makeTrajectory('c13'), new Set(['c13']))).toBe(true);
    });

    it('never triggers false positives on normal user chats discussing subagents or swarms', () => {
        expect(isSubagentTrajectory(makeTrajectory('u1', {
            summary: 'How do I design a subagent swarm architecture in TypeScript?',
            trajectoryType: 'TRAJECTORY_TYPE_MAIN',
        }))).toBe(false);
        expect(isSubagentTrajectory(makeTrajectory('u2', {
            summary: 'Add Lock to Main Agent toggle to ignore subagent bursts',
        }))).toBe(false);
        expect(isSubagentTrajectory(makeTrajectory('u3', {
            summary: 'Fix parentCascadeId and worker timeout handling',
            trajectoryMetadata: { swarmId: 's1', role: 'coordinator' },
        }))).toBe(false);
        // Self-referential parent ID does not misclassify as child
        expect(isSubagentTrajectory(makeTrajectory('u4', { parentCascadeId: 'u4' }))).toBe(false);
        expect(isSubagentTrajectory(makeTrajectory('u5', { summary: '' }))).toBe(false);
        expect(isSubagentTrajectory(null)).toBe(false);
    });
});

describe('normalizeWorkspaceUri', () => {
    it('normalizes Windows URIs, encoded colons, backslashes, and UNC paths identically', () => {
        const expected = 'c:/users/alice/my repo';
        expect(normalizeWorkspaceUri('file:///C:/Users/Alice/My%20Repo/', 'win32')).toBe(expected);
        expect(normalizeWorkspaceUri('file:///c%3A/Users/Alice/My%20Repo', 'win32')).toBe(expected);
        expect(normalizeWorkspaceUri('C:\\Users\\Alice\\My Repo\\', 'win32')).toBe(expected);
        // Windows paths still normalize consistently even when tested on Linux/macOS
        expect(normalizeWorkspaceUri('file:///C:/Users/Alice/My%20Repo', 'linux')).toBe(expected);
        expect(normalizeWorkspaceUri('C:\\Users\\Alice\\My Repo', 'darwin')).toBe(expected);

        expect(normalizeWorkspaceUri('file://fileserver/Share/Project/', 'win32')).toBe('//fileserver/share/project');
        expect(normalizeWorkspaceUri('\\\\fileserver\\Share\\Project\\', 'win32')).toBe('//fileserver/share/project');
    });

    it('handles macOS case-insensitivity, Linux case-sensitivity, and vscode-remote URIs', () => {
        expect(normalizeWorkspaceUri('file:///Users/Alice/Desktop/Repo/', 'darwin'))
            .toBe(normalizeWorkspaceUri('/users/alice/desktop/repo', 'darwin'));

        expect(normalizeWorkspaceUri('file:///home/Alice/Repo/', 'linux')).toBe('/home/Alice/Repo');
        expect(normalizeWorkspaceUri('file:///home/alice/repo/', 'linux')).toBe('/home/alice/repo');
        expect(normalizeWorkspaceUri('file:///home/Alice/Repo', 'linux'))
            .not.toBe(normalizeWorkspaceUri('file:///home/alice/repo', 'linux'));

        expect(normalizeWorkspaceUri('vscode-remote://wsl+Ubuntu/home/alice/repo/', 'linux'))
            .toBe('/home/alice/repo');
        expect(normalizeWorkspaceUri('vscode-remote://ssh-remote+dev/srv/app%20one/', 'linux'))
            .toBe('/srv/app one');
        expect(normalizeWorkspaceUri('   ', 'darwin')).toBe('');
    });
});

describe('resolveTargetConversation', () => {
    it('handles empty trajectory lists cleanly', () => {
        const res = resolveTargetConversation({ trajectories: [], pinnedId: 'missing' });
        expect(res.target).toBeNull();
        expect(res.cascadeId).toBeNull();
        expect(res.pinnedFallback).toBe(true);
        expect(res.reason).toBe('empty_trajectories');
    });

    it('respects manual pin and falls back cleanly when pinnedId is deleted/missing', () => {
        const mainA = makeTrajectory('main-a', { lastModifiedTime: '2026-11-22T10:00:00Z' });
        const mainB = makeTrajectory('main-b', {
            status: CascadeStatus.RUNNING,
            lastModifiedTime: '2026-11-22T10:05:00Z',
        });

        const pinned = resolveTargetConversation({
            trajectories: [mainA, mainB],
            pinnedId: 'main-a',
            hostConversationId: 'main-b',
        });
        expect(pinned.mode).toBe('pinned');
        expect(pinned.cascadeId).toBe('main-a');
        expect(pinned.pinnedFallback).toBe(false);

        const deletedPin = resolveTargetConversation({
            trajectories: [mainA, mainB],
            pinnedId: 'deleted-id',
            hostConversationId: 'main-b',
        });
        expect(deletedPin.mode).toBe('auto_follow');
        expect(deletedPin.cascadeId).toBe('main-b');
        expect(deletedPin.pinnedFallback).toBe(true);
    });

    it('Lock to Main Agent ignores subagent bursts (both RUNNING subagents and subagent hostConversationId)', () => {
        const main = makeTrajectory('main-1', {
            status: 'CASCADE_RUN_STATUS_IDLE',
            lastModifiedTime: '2026-11-22T10:00:00Z',
        });
        const sub1 = makeTrajectory('sub-1', {
            parentCascadeId: 'main-1',
            status: CascadeStatus.RUNNING,
            lastModifiedTime: '2026-11-22T10:05:00Z',
        });
        const sub2 = makeTrajectory('sub-2', {
            trajectoryType: 'TRAJECTORY_TYPE_SUBAGENT',
            status: CascadeStatus.RUNNING,
            lastModifiedTime: '2026-11-22T10:06:00Z',
        });

        // Subagent burst with hostConversationId hijacked to sub-2
        const locked = resolveTargetConversation({
            trajectories: [sub2, sub1, main],
            lockToMainAgent: true,
            lockedMainId: 'main-1',
            hostConversationId: 'sub-2',
            workspaceUris: ['/Users/dev/antigravity'],
            platform: 'darwin',
        });
        expect(locked.mode).toBe('locked_main');
        expect(locked.cascadeId).toBe('main-1');
        expect(locked.lockedMainId).toBe('main-1');
        expect(locked.ignoredSubagentBurst).toBe(true);

        // User explicitly switches host to a DIFFERENT main conversation -> follows new main!
        const main2 = makeTrajectory('main-2', { lastModifiedTime: '2026-11-22T10:07:00Z' });
        const switchedMain = resolveTargetConversation({
            trajectories: [main2, sub2, main],
            lockToMainAgent: true,
            lockedMainId: 'main-1',
            hostConversationId: 'main-2',
            platform: 'darwin',
        });
        expect(switchedMain.mode).toBe('locked_main');
        expect(switchedMain.cascadeId).toBe('main-2');
        expect(switchedMain.lockedMainId).toBe('main-2');
    });

    it('falls back gracefully in Lock to Main Agent when only subagent trajectories exist', () => {
        const sub = makeTrajectory('sub-only', { isSubagent: true, status: CascadeStatus.RUNNING });
        const res = resolveTargetConversation({
            trajectories: [sub],
            lockToMainAgent: true,
        });
        expect(res.cascadeId).toBe('sub-only');
        expect(res.lockedMainId).toBeNull();
        expect(res.reason).toBe('fallback_subagent_only');
    });

    it('auto-follow prioritizes hostConversationId, workspace RUNNING, cross-workspace RUNNING, then workspace latest', () => {
        const wsLocal = makeTrajectory('local-idle', {
            workspaceUris: ['file:///C:/Users/Dev/Repo'],
            lastModifiedTime: '2026-11-22T10:00:00Z',
        });
        const wsOtherRunning = makeTrajectory('other-running', {
            workspaceUris: ['file:///C:/Users/Dev/Other'],
            status: CascadeStatus.RUNNING,
            lastModifiedTime: '2026-11-22T10:02:00Z',
        });
        const wsLocalRunning = makeTrajectory('local-running', {
            workspaces: [{ workspaceFolderAbsoluteUri: 'C:\\Users\\Dev\\Repo\\' }],
            status: CascadeStatus.RUNNING,
            lastModifiedTime: '2026-11-22T10:01:00Z',
        });
        const killedRunning = makeTrajectory('killed-running', {
            workspaceUris: ['file:///C:/Users/Dev/Repo'],
            status: CascadeStatus.RUNNING,
            killed: true,
            lastModifiedTime: '2026-11-22T10:09:00Z',
        });

        // 1. hostConversationId wins directly
        const fromHost = resolveTargetConversation({
            trajectories: [wsLocal, wsOtherRunning, wsLocalRunning],
            hostConversationId: 'local-idle',
            workspaceUris: ['C:\\Users\\Dev\\Repo'],
            platform: 'win32',
        });
        expect(fromHost.cascadeId).toBe('local-idle');
        expect(fromHost.reason).toBe('host_conversation');

        // 2. Local RUNNING beats cross-workspace RUNNING and killed trajectories (matching Windows URI formats)
        const localWin = resolveTargetConversation({
            trajectories: [killedRunning, wsOtherRunning, wsLocalRunning, wsLocal],
            workspaceUris: ['file:///c%3A/Users/Dev/Repo'],
            platform: 'win32',
        });
        expect(localWin.cascadeId).toBe('local-running');
        expect(localWin.reason).toBe('running_in_workspace');

        // 3. Cross-workspace RUNNING beats local idle
        const crossRunning = resolveTargetConversation({
            trajectories: [wsLocal, wsOtherRunning],
            workspaceUris: ['C:\\Users\\Dev\\Repo'],
            platform: 'win32',
        });
        expect(crossRunning.cascadeId).toBe('other-running');
        expect(crossRunning.reason).toBe('running_cross_workspace');

        // 4. Local idle beats newer cross-workspace idle
        const wsOtherIdle = makeTrajectory('other-idle', {
            workspaceUris: ['file:///C:/Users/Dev/Other'],
            lastModifiedTime: '2026-11-22T11:00:00Z',
        });
        const localIdle = resolveTargetConversation({
            trajectories: [wsOtherIdle, wsLocal],
            workspaceUris: ['C:\\Users\\Dev\\Repo'],
            platform: 'win32',
        });
        expect(localIdle.cascadeId).toBe('local-idle');
        expect(localIdle.reason).toBe('latest_in_workspace');
    });
});

describe('buildConversationOptions', () => {
    it('builds deduplicated options with untitled fallbacks, subagent badges, and workspace priority', () => {
        const untitled = makeTrajectory('abcdef1234567890', {
            summary: 'abcdef1234567890', // echoes cascadeId -> untitled!
            workspaceUris: ['file:///Users/dev/antigravity'],
            lastModifiedTime: '2026-11-22T10:01:00Z',
            branchName: 'main',
        });
        const sub = makeTrajectory('sub-99', {
            summary: '[Subagent] Check tests',
            isSubagent: true,
            status: CascadeStatus.RUNNING,
            workspaceUris: ['file:///Users/dev/antigravity'],
            lastModifiedTime: '2026-11-22T10:02:00Z',
        });
        const otherWs = makeTrajectory('other-1', {
            summary: 'Other Workspace Chat',
            workspaceUris: ['C:\\Projects\\OtherApp'],
            lastModifiedTime: '2026-11-22T12:00:00Z',
        });

        const optsEn = buildConversationOptions(
            [otherWs, untitled, untitled, sub],
            'abcdef1234567890',
            'abcdef1234567890',
            {
                workspaceUris: ['/Users/dev/antigravity'],
                platform: 'darwin',
                lang: 'en',
            },
        );

        expect(optsEn).toHaveLength(3); // deduplicated!
        // Workspace matches prioritized before newer other-workspace chat
        expect(optsEn[0].cascadeId).toBe('sub-99');
        expect(optsEn[0].isSubagent).toBe(true);
        expect(optsEn[0].isRunning).toBe(true);

        expect(optsEn[1]).toMatchObject({
            cascadeId: 'abcdef1234567890',
            title: 'Untitled (abcdef12)',
            isUntitled: true,
            isActive: true,
            isLockedMain: true,
            matchesWorkspace: true,
            workspaceLabel: 'antigravity',
            branchName: 'main',
        });

        expect(optsEn[2].workspaceLabel).toBe('OtherApp');

        // Localized Chinese & Bilingual untitled labels + excludeSubagents filter
        const optsZh = buildConversationOptions([untitled, sub], null, null, {
            lang: 'zh',
            excludeSubagents: true,
        });
        expect(optsZh).toHaveLength(1);
        expect(optsZh[0].title).toBe('未命名会话 (abcdef12)');

        const optsBoth = buildConversationOptions([makeTrajectory('xyz1234567', { summary: '   ' })], null, null, {
            lang: 'both',
        });
        expect(optsBoth[0].title).toBe('Untitled / 未命名 (xyz12345)');
        expect(optsBoth[0].isUntitled).toBe(true);
    });
});

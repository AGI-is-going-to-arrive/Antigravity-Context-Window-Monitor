import type { TrajectorySummary } from '../tracker';
import type { SwarmMemberNode, SwarmTopologySnapshot } from './swarm-registry';

interface Sample {
    rootId: string;
    killed: boolean;
    nextAttempt: number;
    summary?: TrajectorySummary;
}

/** Some hosts list only coordinators but still serve member RPCs. Probe members of
 * the selected group, under the host poll budget, before exposing them as readable.
 * Keep only structural summaries; the normal telemetry readers own calls and usage. */
export class SwarmMemberInventory {
    private samples = new Map<string, Sample>();

    reset(): void { this.samples = new Map(); }

    async expand(
        indexed: TrajectorySummary[], topology: SwarmTopologySnapshot,
        targets: readonly (string | null | undefined)[], inspected: string | null,
        readCount: (cascadeId: string) => Promise<number | null>, now: number,
    ): Promise<TrajectorySummary[]> {
        const samples = this.samples;
        // Reading a worker may cause the host to list it on the next poll with its
        // bare ID as its title. Keep the real index measurements but preserve the
        // manifest identity and first-read ledger semantics across that transition.
        const trajectories = indexed.map(tr => {
            const node = topology.nodesById.get(tr.cascadeId);
            if (node?.evidenceSource !== 'manifest' || node.rootId === tr.cascadeId
                || node.isOrphan || node.hasConflict || node.isStaleManifest) { return tr; }
            const unnamed = !tr.summary || tr.summary === tr.cascadeId;
            return {
                ...tr, isSubagent: true, parentCascadeId: tr.parentCascadeId || node.directParentId || node.rootId,
                summary: (unnamed && node.memberName) || tr.summary,
                manifestMember: unnamed || samples.has(tr.cascadeId) || tr.manifestMember,
                killed: node.killed || tr.killed,
            };
        });
        const listed = new Set(indexed.map(t => t.cascadeId));
        for (const [id, sample] of samples) {
            const node = topology.nodesById.get(id);
            if (!node || node.rootId !== sample.rootId || listed.has(id)
                || node.hasConflict || node.isStaleManifest || Boolean(node.killed) !== sample.killed) {
                samples.delete(id);
            }
        }
        const target = targets.find(Boolean) ?? indexed[0]?.cascadeId;
        const rootId = (target && topology.nodesById.get(target)?.rootId) || target;
        const group = rootId ? topology.groupsByRootId.get(rootId) : undefined;
        if (!group || group.hasConflict || group.coordinatorDeleted || group.isStaleManifest) {
            return trajectories;
        }
        const candidates: SwarmMemberNode[] = [];
        for (const id of group.memberIds) {
            const node = topology.nodesById.get(id);
            if (node?.evidenceSource !== 'manifest' || node.isStaleManifest || node.hasConflict || node.isOrphan
                || node.cascadeId === group.rootId || listed.has(id)) { continue; }
            // Historical groups without an indexed anchor require a user's explicit member selection.
            if (!listed.has(group.rootId) && id !== inspected) { continue; }
            candidates.push(node);
        }
        const ready = candidates.filter(node => (samples.get(node.cascadeId)?.nextAttempt ?? 0) <= now);
        ready.sort((a, b) => Number(b.cascadeId === inspected) - Number(a.cascadeId === inspected)
            || (samples.get(a.cascadeId)?.nextAttempt ?? 0) - (samples.get(b.cascadeId)?.nextAttempt ?? 0)
            || Number(Boolean(a.killed)) - Number(Boolean(b.killed)));
        await Promise.all(ready.slice(0, 2).map(async node => {
            const id = node.cascadeId;
            const sample: Sample = {
                rootId: group.rootId, killed: Boolean(node.killed), nextAttempt: now + 30_000,
                summary: samples.get(id)?.summary,
            };
            samples.set(id, sample);
            try {
                const count = await readCount(id);
                if (count === null || !Number.isSafeInteger(count) || count <= 0) { return; }
                sample.summary = {
                    manifestMember: true, cascadeId: id, trajectoryId: '', summary: node.memberName || id,
                    stepCount: count, status: 'unknown', lastModifiedTime: '', createdTime: '',
                    requestedModel: node.appliedModel || node.assignedModel || '', generatorModel: '',
                    workspaceUris: [], lastUserInputTime: '', lastUserInputStepIndex: 0,
                    repositoryName: '', gitOriginUrl: '', branchName: '', gitRootUri: '',
                    isSubagent: true, role: node.assignedRole, parentCascadeId: node.directParentId || group.rootId,
                    killed: sample.killed,
                };
                sample.nextAttempt = sample.killed ? Infinity : now + 30_000;
            } catch { /* An unavailable member can be retried without breaking the index. */ }
        }));
        if (this.samples !== samples) { return indexed; }
        return [...trajectories, ...candidates.flatMap(node => samples.get(node.cascadeId)?.summary ?? [])];
    }
}

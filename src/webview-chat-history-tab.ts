import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { tBi } from './i18n';
import { ContextUsage, TrajectorySummary, getModelDisplayName, normalizeUri } from './tracker';
import { esc, formatTime } from './webview-helpers';
import type { GMSummary, GMConversationData } from './gm-tracker';
import { ICON } from './webview-icons';

interface HistoryGMStats {
    calls: number;
    credits: number;
    latestModel: string;
}

interface HistoryEntry {
    cascadeId: string;
    title: string;
    workspaceLabel: string;
    workspacePath: string;
    workspaceUri: string;
    repositoryName: string;
    branchName: string;
    status: string;
    modelLabel: string;
    stepCount: number;
    createdTime: string;
    lastModifiedTime: string;
    lastUserInputTime: string;
    isCurrentSession: boolean;
    isCurrentWorkspace: boolean;
    isCurrentRepo: boolean;
    hasPb: boolean;
    hasBrain: boolean;
    hasRecording: boolean;
    gmCalls: number;
    gmCredits: number;
    latestGMModel: string;
}

interface HistoryGroup {
    key: string;
    label: string;
    subtitle: string;
    entries: HistoryEntry[];
    isCurrentWorkspace: boolean;
}

function getAntigravityRoot(): string {
    return path.join(os.homedir(), '.gemini', 'antigravity');
}

function exists(targetPath: string): boolean {
    try {
        fs.accessSync(targetPath);
        return true;
    } catch {
        return false;
    }
}

function fileUriToPath(uri: string): string {
    if (!uri) { return ''; }
    if (uri.startsWith('file:///')) {
        const raw = decodeURIComponent(uri.replace('file:///', ''));
        return process.platform === 'win32'
            ? raw.replace(/\//g, path.sep)
            : '/' + raw;
    }
    return uri;
}

function getWorkspaceLabel(workspaceUri: string, repositoryName: string): { label: string; subtitle: string; localPath: string } {
    const localPath = fileUriToPath(workspaceUri);
    const cleanPath = localPath.replace(/[\\/]+$/, '');
    const base = cleanPath ? path.basename(cleanPath) : '';
    const label = base || repositoryName || tBi('Unscoped', '未分组');
    const subtitle = repositoryName && repositoryName !== label
        ? repositoryName
        : (cleanPath || tBi('No workspace path', '无工作区路径'));
    return { label, subtitle, localPath: cleanPath };
}

function getGMStats(
    cascadeId: string,
    gmSummary: GMSummary | null,
    gmConversations?: Record<string, GMConversationData>,
): HistoryGMStats {
    const conversation = gmSummary?.conversations.find(item => item.cascadeId === cascadeId)
        || gmConversations?.[cascadeId]
        || null;
    if (!conversation || conversation.calls.length === 0) {
        return { calls: 0, credits: 0, latestModel: '' };
    }

    let credits = 0;
    for (const call of conversation.calls) {
        credits += call.credits;
    }
    const latestCall = conversation.calls[conversation.calls.length - 1];
    return {
        calls: conversation.calls.length,
        credits,
        latestModel: latestCall.responseModel || latestCall.modelDisplay || latestCall.model || '',
    };
}

function buildEntries(
    trajectories: TrajectorySummary[],
    currentUsage: ContextUsage | null,
    gmSummary: GMSummary | null,
    gmConversations: Record<string, GMConversationData> | undefined,
    currentWorkspaceUri?: string,
): HistoryEntry[] {
    const antigravityRoot = getAntigravityRoot();
    const normalizedCurrentWorkspace = currentWorkspaceUri ? normalizeUri(currentWorkspaceUri) : '';
    const currentRepoName = currentUsage?.repositoryName || '';

    return trajectories.map((trajectory) => {
        const workspaceUri = trajectory.workspaceUris[0] || trajectory.gitRootUri || '';
        const workspaceMeta = getWorkspaceLabel(workspaceUri, trajectory.repositoryName);
        const normalizedWorkspace = workspaceUri ? normalizeUri(workspaceUri) : '';
        const gmStats = getGMStats(trajectory.cascadeId, gmSummary, gmConversations);
        const pbPath = path.join(antigravityRoot, 'conversations', `${trajectory.cascadeId}.pb`);
        const brainDir = path.join(antigravityRoot, 'brain', trajectory.cascadeId);
        const recordingDir = path.join(antigravityRoot, 'browser_recordings', trajectory.cascadeId);
        const modelId = trajectory.requestedModel || trajectory.generatorModel || '';

        return {
            cascadeId: trajectory.cascadeId,
            title: trajectory.summary || `${tBi('Conversation', '对话')} ${trajectory.cascadeId.substring(0, 8)}`,
            workspaceLabel: workspaceMeta.label,
            workspacePath: workspaceMeta.localPath,
            workspaceUri,
            repositoryName: trajectory.repositoryName,
            branchName: trajectory.branchName,
            status: trajectory.status.replace('CASCADE_STATUS_', '').replace('CASCADE_RUN_STATUS_', ''),
            modelLabel: getModelDisplayName(modelId || ''),
            stepCount: trajectory.stepCount,
            createdTime: trajectory.createdTime,
            lastModifiedTime: trajectory.lastModifiedTime,
            lastUserInputTime: trajectory.lastUserInputTime,
            isCurrentSession: currentUsage?.cascadeId === trajectory.cascadeId,
            isCurrentWorkspace: !!normalizedCurrentWorkspace && normalizedWorkspace === normalizedCurrentWorkspace,
            isCurrentRepo: !!currentRepoName && trajectory.repositoryName === currentRepoName,
            hasPb: exists(pbPath),
            hasBrain: exists(brainDir),
            hasRecording: exists(recordingDir),
            gmCalls: gmStats.calls,
            gmCredits: gmStats.credits,
            latestGMModel: gmStats.latestModel,
        };
    }).sort((a, b) =>
        Date.parse(b.lastModifiedTime || '') - Date.parse(a.lastModifiedTime || ''),
    );
}

function buildGroups(entries: HistoryEntry[]): HistoryGroup[] {
    const grouped = new Map<string, HistoryGroup>();
    for (const entry of entries) {
        const key = entry.workspacePath || entry.repositoryName || entry.workspaceLabel;
        const existing = grouped.get(key);
        if (existing) {
            existing.entries.push(entry);
            existing.isCurrentWorkspace = existing.isCurrentWorkspace || entry.isCurrentWorkspace;
            continue;
        }
        grouped.set(key, {
            key,
            label: entry.workspaceLabel,
            subtitle: entry.workspacePath || entry.repositoryName || tBi('No workspace path', '无工作区路径'),
            entries: [entry],
            isCurrentWorkspace: entry.isCurrentWorkspace,
        });
    }

    return [...grouped.values()]
        .sort((a, b) => {
            if (a.isCurrentWorkspace !== b.isCurrentWorkspace) {
                return a.isCurrentWorkspace ? -1 : 1;
            }
            const aLatest = Date.parse(a.entries[0]?.lastModifiedTime || '') || 0;
            const bLatest = Date.parse(b.entries[0]?.lastModifiedTime || '') || 0;
            return bLatest - aLatest;
        });
}

// ── Inline SVG Icons ──
const IC = {
    calls: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    credits: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    model: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
    pulse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    workspace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7z"/><line x1="9" y1="21" x2="15" y2="21"/></svg>',
};

// ── Compact date formatting ──
function fmtCompactDate(iso: string): string {
    if (!iso) { return ''; }
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) { return ''; }
        const p = (n: number) => String(n).padStart(2, '0');
        return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch { return ''; }
}

// ── Shortcut filter cards ──
function renderShortcuts(entries: HistoryEntry[], currentUsage: ContextUsage | null): string {
    const currentRepoName = currentUsage?.repositoryName || entries.find(e => e.isCurrentRepo)?.repositoryName || '';
    const currentWorkspaceCount = entries.filter(e => e.isCurrentWorkspace).length;
    const currentRepoCount = currentRepoName ? entries.filter(e => e.isCurrentRepo).length : 0;
    const recordableCount = entries.filter(e => e.hasBrain || e.hasPb || e.hasRecording).length;

    const cards = [
        {
            filter: 'current',
            icon: ICON.folder,
            title: tBi('Current Workspace', '当前工作区'),
            count: currentWorkspaceCount,
            active: currentWorkspaceCount > 0,
        },
        {
            filter: 'currentrepo',
            icon: ICON.git,
            title: currentRepoName || tBi('Current Repo', '当前仓库'),
            count: currentRepoCount,
            active: currentRepoCount > 0,
        },
        {
            filter: 'recordable',
            icon: ICON.database,
            title: tBi('Backup Ready', '可备份'),
            count: recordableCount,
            active: recordableCount > 0,
        },
    ];

    return `
        <div class="ses-shortcuts">
            ${cards.map(card => `
                <button
                    class="ses-shortcut${card.active ? '' : ' is-disabled'}"
                    data-history-shortcut="${card.filter}"
                    ${card.active ? '' : 'disabled'}
                >
                    <span class="ses-shortcut-icon">${card.icon}</span>
                    <span class="ses-shortcut-title">${esc(card.title)}</span>
                    <span class="ses-shortcut-count">${card.count}</span>
                </button>
            `).join('')}
        </div>`;
}

// ── Compact toolbar (search + filters) ──
function renderToolbar(): string {
    return `
        <div class="ses-toolbar">
            <div class="ses-search-wrap">
                ${ICON.chat}
                <input
                    id="historySearchInput"
                    class="ses-search-input"
                    type="text"
                    placeholder="${esc(tBi('Search title / folder / repo / model...', '搜索标题 / 文件夹 / 仓库 / 模型...'))}"
                    autocomplete="off"
                    spellcheck="false"
                />
            </div>
            <div class="ses-filters" role="tablist" aria-label="${esc(tBi('Session catalog filters', '会话目录筛选'))}">
                <button class="ses-filter-btn is-active" data-history-filter="all">${tBi('All', '全部')}</button>
                <button class="ses-filter-btn" data-history-filter="current">${tBi('Workspace', '工作区')}</button>
                <button class="ses-filter-btn" data-history-filter="currentrepo">${tBi('Repo', '仓库')}</button>
                <button class="ses-filter-btn" data-history-filter="running">${tBi('Running', '运行中')}</button>
                <button class="ses-filter-btn" data-history-filter="recordable">${tBi('Recordable', '可备份')}</button>
            </div>
        </div>`;
}

// ── Single session row (compact card) ──
function renderRow(entry: HistoryEntry): string {
    const searchCorpus = [
        entry.title, entry.workspaceLabel, entry.workspacePath,
        entry.repositoryName, entry.branchName, entry.modelLabel, entry.latestGMModel,
    ].join(' ').toLowerCase();

    const statusClass = entry.status === 'RUNNING' ? 'is-running'
        : entry.status === 'FINISHED' ? 'is-finished' : 'is-idle';

    // ── Context line: repo/branch ──
    const contextParts: string[] = [];
    if (entry.repositoryName) { contextParts.push(esc(entry.repositoryName)); }
    if (entry.branchName) { contextParts.push(`<span class="ses-ctx-branch">${ICON.branch} ${esc(entry.branchName)}</span>`); }

    // ── Metric chips (time only; calls/credits/steps shown elsewhere) ──
    const chips: string[] = [];

    // ── Time range ──
    const created = fmtCompactDate(entry.createdTime);
    const modified = fmtCompactDate(entry.lastModifiedTime);
    if (created || modified) {
        const timeStr = created && modified && created !== modified
            ? `${created} → ${modified}`
            : (modified || created);
        chips.push(`<span class="ses-chip ses-chip-time">${IC.clock} ${timeStr}</span>`);
    }

    // ── Storage badges (inline, minimal) ──
    const storageParts: string[] = [];
    if (entry.hasBrain) { storageParts.push('Brain'); }
    if (entry.hasRecording) { storageParts.push(tBi('Rec', '录屏')); }
    if (entry.hasPb) { storageParts.push('PB'); }

    // ── Action buttons (icon-only, compact, CSS tooltip) ──
    const actions = `
        <div class="ses-row-actions">
            <button
                class="ses-act-btn" data-tooltip="${esc(tBi('Open Workspace', '打开工作区'))}"
                data-history-action="workspace"
                data-history-uri="${esc(entry.workspaceUri)}"
                ${entry.workspaceUri ? '' : 'disabled'}
            >${ICON.folder}</button>
            <button
                class="ses-act-btn ses-act-accent" data-tooltip="${esc(tBi('Record Folder', '记录目录'))}"
                data-history-action="record"
                data-cascade-id="${esc(entry.cascadeId)}"
            >${ICON.chat}</button>
            <button
                class="ses-act-btn" data-tooltip="${esc(tBi('PB File', 'PB 文件'))}"
                data-history-action="pb"
                data-cascade-id="${esc(entry.cascadeId)}"
                ${entry.hasPb ? '' : 'disabled'}
            >${ICON.file}</button>
        </div>`;

    return `
        <article
            class="ses-row${entry.isCurrentSession ? ' is-current' : ''}"
            data-history-row="true"
            data-search="${esc(searchCorpus)}"
            data-current-workspace="${entry.isCurrentWorkspace ? 'true' : 'false'}"
            data-current-repo="${entry.isCurrentRepo ? 'true' : 'false'}"
            data-running="${entry.status === 'RUNNING' ? 'true' : 'false'}"
            data-recordable="${entry.hasPb || entry.hasBrain || entry.hasRecording ? 'true' : 'false'}"
        >
            <div class="ses-row-head">
                <h3 class="ses-row-title" title="${esc(entry.cascadeId)}">${esc(entry.title)}</h3>
                <div class="ses-row-badges">
                    ${entry.isCurrentSession ? `<span class="ses-badge is-current">${tBi('Current', '当前')}</span>` : ''}
                    ${entry.isCurrentWorkspace ? `<span class="ses-badge is-workspace">${tBi('WS', '本区')}</span>` : ''}
                    <span class="ses-badge ${statusClass}">${esc(entry.status || 'UNKNOWN')}</span>
                </div>
            </div>
            ${contextParts.length > 0 ? `<div class="ses-row-ctx">${contextParts.join(' <span class="ses-ctx-sep">·</span> ')}</div>` : ''}
            <div class="ses-row-metrics">
                <div class="ses-chips">${chips.join('')}</div>
                ${storageParts.length > 0 ? `<div class="ses-storage">${storageParts.map(s => `<span class="ses-storage-tag">${s}</span>`).join('')}</div>` : ''}
            </div>
            ${actions}
        </article>`;
}

// ── Group (collapsible) ──
function renderGroup(group: HistoryGroup, index: number): string {
    const runningCount = group.entries.filter(e => e.status === 'RUNNING').length;
    const openAttr = group.isCurrentWorkspace || index === 0 ? ' open' : '';

    return `
        <details class="collapsible ses-group" id="history-group-${index}"${openAttr}>
            <summary>
                <div class="ses-group-head">
                    <div class="ses-group-labels">
                        <span class="ses-group-title">${esc(group.label)}</span>
                        <span class="ses-group-path">${esc(group.subtitle)}</span>
                    </div>
                    <div class="ses-group-chips">
                        ${group.isCurrentWorkspace ? `<span class="ses-group-chip is-ws">${tBi('Current', '当前')}</span>` : ''}
                        <span class="ses-group-chip">${group.entries.length}</span>
                        ${runningCount > 0 ? `<span class="ses-group-chip is-run">${runningCount} ${tBi('run', '运行')}</span>` : ''}
                    </div>
                </div>
            </summary>
            <div class="details-body ses-group-body">
                ${group.entries.map(e => renderRow(e)).join('')}
            </div>
        </details>`;
}

export function buildChatHistoryTabContent(
    trajectories: TrajectorySummary[],
    currentUsage: ContextUsage | null,
    gmSummary: GMSummary | null,
    gmConversations?: Record<string, GMConversationData>,
    currentWorkspaceUri?: string,
): string {
    if (!trajectories || trajectories.length === 0) {
        return `<p class="empty-msg">${tBi(
            'Waiting for trajectory data... the session catalog will appear after the first LS sync.',
            '正在等待轨迹数据... 首次和 LS 同步后会自动显示会话目录。',
        )}</p>`;
    }

    const entries = buildEntries(trajectories, currentUsage, gmSummary, gmConversations, currentWorkspaceUri);
    const groups = buildGroups(entries);

    return `
        ${renderShortcuts(entries, currentUsage)}
        ${renderToolbar()}
        <section class="ses-groups" id="historyGroups">
            ${groups.map((group, index) => renderGroup(group, index)).join('')}
        </section>`;
}

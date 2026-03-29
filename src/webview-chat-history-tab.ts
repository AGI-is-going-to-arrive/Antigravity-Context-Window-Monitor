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

function countPbFiles(): number {
    try {
        const conversationsDir = path.join(getAntigravityRoot(), 'conversations');
        return fs.readdirSync(conversationsDir).filter(name => name.endsWith('.pb')).length;
    } catch {
        return 0;
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

function renderSummary(entries: HistoryEntry[], groups: HistoryGroup[]): string {
    const currentWorkspaceCount = entries.filter(entry => entry.isCurrentWorkspace).length;
    const runningCount = entries.filter(entry => entry.status === 'RUNNING').length;
    const recordableCount = entries.filter(entry => entry.hasBrain || entry.hasPb || entry.hasRecording).length;
    const rawPbCount = countPbFiles();
    const invisibleRawCount = Math.max(0, rawPbCount - entries.length);

    return `
        <div class="history-stats-grid">
            <section class="card history-stat-card">
                <div class="history-stat-kicker">${tBi('Catalog', '目录')}</div>
                <div class="history-stat-value">${entries.length}</div>
                <div class="history-stat-label">${tBi('Conversations', '对话总数')}</div>
            </section>
            <section class="card history-stat-card">
                <div class="history-stat-kicker">${tBi('Folders', '文件夹')}</div>
                <div class="history-stat-value">${groups.length}</div>
                <div class="history-stat-label">${tBi('Workspace Groups', '工作区分组')}</div>
            </section>
            <section class="card history-stat-card">
                <div class="history-stat-kicker">${tBi('Current', '当前')}</div>
                <div class="history-stat-value">${currentWorkspaceCount}</div>
                <div class="history-stat-label">${tBi('Current Workspace', '当前工作区')}</div>
            </section>
            <section class="card history-stat-card">
                <div class="history-stat-kicker">${tBi('Backup', '备份')}</div>
                <div class="history-stat-value">${recordableCount}</div>
                <div class="history-stat-label">${tBi('Recordable Items', '可定位记录')}</div>
            </section>
            <section class="card history-stat-card">
                <div class="history-stat-kicker">${tBi('Running', '运行中')}</div>
                <div class="history-stat-value">${runningCount}</div>
                <div class="history-stat-label">${tBi('Active Conversations', '活跃对话')}</div>
            </section>
            <section class="card history-stat-card">
                <div class="history-stat-kicker">${tBi('Raw PB', '原始 PB')}</div>
                <div class="history-stat-value">${rawPbCount}</div>
                <div class="history-stat-label">${invisibleRawCount > 0
                    ? tBi(`${invisibleRawCount} raw archives are not title-resolved by LS`, `${invisibleRawCount} 个原始档案未被 LS 解析出标题`)
                    : tBi('All raw archives are currently title-resolved', '当前原始档案都已解析出标题')
                }</div>
            </section>
        </div>`;
}

function renderShortcuts(entries: HistoryEntry[], currentUsage: ContextUsage | null): string {
    const currentRepoName = currentUsage?.repositoryName || entries.find(entry => entry.isCurrentRepo)?.repositoryName || '';
    const currentWorkspaceCount = entries.filter(entry => entry.isCurrentWorkspace).length;
    const currentRepoCount = currentRepoName ? entries.filter(entry => entry.isCurrentRepo).length : 0;
    const recordableCount = entries.filter(entry => entry.hasBrain || entry.hasPb || entry.hasRecording).length;

    const cards = [
        {
            filter: 'current',
            icon: ICON.folder,
            kicker: tBi('Quick Entry', '固定入口'),
            title: tBi('Current Workspace', '当前工作区'),
            subtitle: tBi(`${currentWorkspaceCount} conversations ready to continue`, `${currentWorkspaceCount} 条对话可继续`),
            count: currentWorkspaceCount,
            active: currentWorkspaceCount > 0,
        },
        {
            filter: 'currentrepo',
            icon: ICON.git,
            kicker: tBi('Quick Entry', '固定入口'),
            title: currentRepoName || tBi('Current Repository', '当前仓库'),
            subtitle: currentRepoName
                ? tBi(`${currentRepoCount} conversations under this repo`, `${currentRepoCount} 条对话归属这个仓库`)
                : tBi('Current conversation has no repository metadata yet', '当前对话暂时没有仓库元数据'),
            count: currentRepoCount,
            active: currentRepoCount > 0,
        },
        {
            filter: 'recordable',
            icon: ICON.database,
            kicker: tBi('Quick Entry', '固定入口'),
            title: tBi('Backup Ready', '可备份记录'),
            subtitle: tBi(`${recordableCount} conversations already have local artifacts`, `${recordableCount} 条对话已有本地记录`),
            count: recordableCount,
            active: recordableCount > 0,
        },
    ];

    return `
        <section class="history-shortcuts-grid">
            ${cards.map(card => `
                <button
                    class="history-shortcut-card${card.active ? '' : ' is-disabled'}"
                    data-history-shortcut="${card.filter}"
                    ${card.active ? '' : 'disabled'}
                >
                    <div class="history-shortcut-head">
                        <span class="history-shortcut-kicker">${card.kicker}</span>
                        <span class="history-shortcut-count">${card.count}</span>
                    </div>
                    <div class="history-shortcut-title">${card.icon} ${esc(card.title)}</div>
                    <div class="history-shortcut-subtitle">${esc(card.subtitle)}</div>
                </button>
            `).join('')}
        </section>`;
}

function renderToolbar(): string {
    return `
        <section class="card history-toolbar-card">
            <div class="history-toolbar-grid">
                <label class="history-search-field">
                    <span class="history-search-label">${ICON.chat} ${tBi('Search', '搜索')}</span>
                    <input
                        id="historySearchInput"
                        class="history-search-input"
                        type="text"
                        placeholder="${esc(tBi('Search title / folder / repo / model', '搜索标题 / 文件夹 / 仓库 / 模型'))}"
                        autocomplete="off"
                        spellcheck="false"
                    />
                </label>
                <div class="history-filter-bar" role="tablist" aria-label="${esc(tBi('Session catalog filters', '会话目录筛选'))}">
                    <button class="history-filter-btn is-active" data-history-filter="all">${tBi('All', '全部')}</button>
                    <button class="history-filter-btn" data-history-filter="current">${tBi('Current Workspace', '当前工作区')}</button>
                    <button class="history-filter-btn" data-history-filter="currentrepo">${tBi('Current Repo', '当前仓库')}</button>
                    <button class="history-filter-btn" data-history-filter="running">${tBi('Running', '运行中')}</button>
                    <button class="history-filter-btn" data-history-filter="recordable">${tBi('Recordable', '可备份')}</button>
                </div>
            </div>
            <p class="history-toolbar-note">
                ${tBi(
                    '“Record Folder” prefers brain/<id>, then browser_recordings/<id>, and finally the conversations store.',
                    '“记录目录”优先定位 brain/<id>，其次 browser_recordings/<id>，最后回退到 conversations 存储目录。',
                )}
                ${' '}
                ${tBi(
                    'This catalog is built from LS-visible trajectories. Local raw .pb archives may be more numerous, but rows without LS-resolved titles are not promoted as normal sessions.',
                    '这个目录基于 LS 当前可见的 trajectories。磁盘上的原始 .pb 档案可能更多，但没有被 LS 解析出标题的条目不会直接提升成普通会话行。',
                )}
            </p>
        </section>`;
}

function renderGroup(group: HistoryGroup, index: number): string {
    const runningCount = group.entries.filter(entry => entry.status === 'RUNNING').length;
    const recordableCount = group.entries.filter(entry => entry.hasPb || entry.hasBrain || entry.hasRecording).length;
    const openAttr = group.isCurrentWorkspace || index === 0 ? ' open' : '';

    const rows = group.entries.map((entry) => {
        const searchCorpus = [
            entry.title,
            entry.workspaceLabel,
            entry.workspacePath,
            entry.repositoryName,
            entry.branchName,
            entry.modelLabel,
            entry.latestGMModel,
        ].join(' ').toLowerCase();

        const statusClass = entry.status === 'RUNNING'
            ? 'is-running'
            : entry.status === 'FINISHED'
                ? 'is-finished'
                : 'is-idle';

        const storageBadges: string[] = [];
        if (entry.hasBrain) { storageBadges.push(`<span class="history-storage-badge">${tBi('Brain', 'Brain')}</span>`); }
        if (entry.hasRecording) { storageBadges.push(`<span class="history-storage-badge">${tBi('Recording', '录屏')}</span>`); }
        if (entry.hasPb) { storageBadges.push(`<span class="history-storage-badge">${tBi('PB', 'PB')}</span>`); }

        const gmBits: string[] = [];
        if (entry.gmCalls > 0) { gmBits.push(`${entry.gmCalls} ${tBi('calls', '调用')}`); }
        if (entry.gmCredits > 0) { gmBits.push(`${entry.gmCredits} ${tBi('cr', '积分')}`); }
        if (entry.latestGMModel) { gmBits.push(entry.latestGMModel); }

        return `
            <article
                class="history-row${entry.isCurrentSession ? ' is-current-session' : ''}"
                data-history-row="true"
                data-search="${esc(searchCorpus)}"
                data-current-workspace="${entry.isCurrentWorkspace ? 'true' : 'false'}"
                data-current-repo="${entry.isCurrentRepo ? 'true' : 'false'}"
                data-running="${entry.status === 'RUNNING' ? 'true' : 'false'}"
                data-recordable="${entry.hasPb || entry.hasBrain || entry.hasRecording ? 'true' : 'false'}"
            >
                <div class="history-row-main">
                    <div class="history-row-header">
                        <div class="history-row-title-wrap">
                            <h3 class="history-row-title">${esc(entry.title)}</h3>
                            <div class="history-row-subtitle">${esc(entry.repositoryName || entry.workspaceLabel)}</div>
                        </div>
                        <div class="history-row-badges">
                            ${entry.isCurrentSession ? `<span class="history-badge is-current">${tBi('Current', '当前')}</span>` : ''}
                            ${entry.isCurrentWorkspace ? `<span class="history-badge is-workspace">${tBi('Workspace', '本工作区')}</span>` : ''}
                            ${entry.isCurrentRepo ? `<span class="history-badge is-repo">${tBi('Repo', '当前仓库')}</span>` : ''}
                            <span class="history-badge ${statusClass}">${esc(entry.status || 'UNKNOWN')}</span>
                        </div>
                    </div>
                    <div class="history-row-meta">
                        <span class="history-meta-chip">${ICON.folder} ${esc(entry.workspaceLabel)}</span>
                        ${entry.branchName ? `<span class="history-meta-chip">${ICON.branch} ${esc(entry.branchName)}</span>` : ''}
                        ${entry.modelLabel ? `<span class="history-meta-chip">${ICON.bolt} ${esc(entry.modelLabel)}</span>` : ''}
                        <span class="history-meta-chip">${ICON.chart} ${entry.stepCount} ${tBi('steps', '步')}</span>
                    </div>
                    <div class="history-spotlight-grid">
                        <div class="history-spotlight-card is-credit${entry.gmCredits > 0 ? '' : ' is-muted'}">
                            <div class="history-spotlight-label">${tBi('Cumulative Credits', '累计积分')}</div>
                            <div class="history-spotlight-value">${entry.gmCredits > 0 ? `${entry.gmCredits} ${tBi('cr', '积分')}` : '—'}</div>
                        </div>
                        <div class="history-spotlight-card is-model${entry.latestGMModel ? '' : ' is-muted'}">
                            <div class="history-spotlight-label">${tBi('Latest Actual Model', '最后实际模型')}</div>
                            <div class="history-spotlight-value is-model-name">${entry.latestGMModel ? esc(entry.latestGMModel) : '—'}</div>
                        </div>
                    </div>
                    <div class="history-row-foot">
                        <span class="history-foot-item">${tBi('Modified', '最后修改')} ${formatTime(entry.lastModifiedTime)}</span>
                        <span class="history-foot-item">${tBi('Created', '创建')} ${formatTime(entry.createdTime)}</span>
                        <span class="history-foot-item">${tBi('Last Input', '最后输入')} ${formatTime(entry.lastUserInputTime)}</span>
                        ${gmBits.length > 0 ? `<span class="history-foot-item is-gm">${gmBits.join(' · ')}</span>` : ''}
                    </div>
                    ${storageBadges.length > 0 ? `<div class="history-storage-row">${storageBadges.join('')}</div>` : ''}
                </div>
                <div class="history-row-actions">
                    <button
                        class="history-action-btn"
                        data-history-action="workspace"
                        data-history-uri="${esc(entry.workspaceUri)}"
                        ${entry.workspaceUri ? '' : 'disabled'}
                    >${ICON.folder} ${tBi('Workspace', '工作区')}</button>
                    <button
                        class="history-action-btn is-accent"
                        data-history-action="record"
                        data-cascade-id="${esc(entry.cascadeId)}"
                    >${ICON.chat} ${tBi('Record Folder', '记录目录')}</button>
                    <button
                        class="history-action-btn"
                        data-history-action="pb"
                        data-cascade-id="${esc(entry.cascadeId)}"
                        ${entry.hasPb ? '' : 'disabled'}
                    >${ICON.file} ${tBi('PB File', 'PB 文件')}</button>
                </div>
            </article>`;
    }).join('');

    return `
        <details class="collapsible history-group" id="history-group-${index}"${openAttr}>
            <summary>
                <div class="history-group-summary">
                    <div class="history-group-labels">
                        <span class="history-group-title">${esc(group.label)}</span>
                        <span class="history-group-subtitle">${esc(group.subtitle)}</span>
                    </div>
                    <div class="history-group-metrics">
                        ${group.isCurrentWorkspace ? `<span class="history-group-chip is-workspace">${tBi('Current Workspace', '当前工作区')}</span>` : ''}
                        <span class="history-group-chip">${group.entries.length} ${tBi('items', '条')}</span>
                        <span class="history-group-chip">${runningCount} ${tBi('running', '运行中')}</span>
                        <span class="history-group-chip">${recordableCount} ${tBi('recordable', '可备份')}</span>
                    </div>
                </div>
            </summary>
            <div class="details-body history-group-body">
                ${rows}
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
        ${renderSummary(entries, groups)}
        ${renderShortcuts(entries, currentUsage)}
        ${renderToolbar()}
        <section class="history-groups" id="historyGroups">
            ${groups.map((group, index) => renderGroup(group, index)).join('')}
        </section>`;
}

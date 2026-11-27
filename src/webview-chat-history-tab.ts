import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { tBi } from './i18n';
import { ContextUsage, TrajectorySummary, getModelDisplayName, normalizeUri } from './tracker';
import { esc, tBiHtml } from './webview-helpers';
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
    titleHtml: string;
    workspaceLabel: string;
    workspaceLabelHtml: string;
    workspaceSubtitleHtml: string;
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
    labelHtml: string;
    subtitleHtml: string;
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

function getWorkspaceLabel(
    workspaceUri: string,
    repositoryName: string,
): { label: string; labelHtml: string; subtitleHtml: string; localPath: string } {
    const localPath = fileUriToPath(workspaceUri);
    const cleanPath = localPath.replace(/[\\/]+$/, '');
    const base = cleanPath ? path.basename(cleanPath) : '';
    const resolvedName = base || repositoryName;
    const label = resolvedName || tBi('Unscoped', '未分组');
    const labelHtml = resolvedName ? esc(resolvedName) : tBiHtml('Unscoped', '未分组');
    const subtitleHtml = repositoryName && repositoryName !== label
        ? esc(repositoryName)
        : (cleanPath ? esc(cleanPath) : tBiHtml('No workspace path', '无工作区路径'));
    return { label, labelHtml, subtitleHtml, localPath: cleanPath };
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
        const workspaceUri = (Array.isArray(trajectory.workspaceUris) ? trajectory.workspaceUris[0] : '') || trajectory.gitRootUri || '';
        const workspaceMeta = getWorkspaceLabel(workspaceUri, trajectory.repositoryName || '');
        const normalizedWorkspace = workspaceUri ? normalizeUri(workspaceUri) : '';
        const gmStats = getGMStats(trajectory.cascadeId, gmSummary, gmConversations);
        const pbPath = path.join(antigravityRoot, 'conversations', `${trajectory.cascadeId}.pb`);
        const brainDir = path.join(antigravityRoot, 'brain', trajectory.cascadeId);
        const recordingDir = path.join(antigravityRoot, 'browser_recordings', trajectory.cascadeId);
        const modelId = trajectory.requestedModel || trajectory.generatorModel || '';

        const shortId = (trajectory.cascadeId || '').substring(0, 8);
        return {
            cascadeId: trajectory.cascadeId,
            title: trajectory.summary || `${tBi('Conversation', '对话')} ${shortId}`,
            titleHtml: trajectory.summary
                ? esc(trajectory.summary)
                : `${tBiHtml('Conversation', '对话')} ${esc(shortId)}`,
            workspaceLabel: workspaceMeta.label,
            workspaceLabelHtml: workspaceMeta.labelHtml,
            workspaceSubtitleHtml: workspaceMeta.subtitleHtml,
            workspacePath: workspaceMeta.localPath,
            workspaceUri,
            repositoryName: trajectory.repositoryName || '',
            branchName: trajectory.branchName || '',
            status: (trajectory.status || 'UNKNOWN').replace('CASCADE_STATUS_', '').replace('CASCADE_RUN_STATUS_', ''),
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
            labelHtml: entry.workspaceLabelHtml,
            subtitleHtml: entry.workspacePath
                ? esc(entry.workspacePath)
                : (entry.repositoryName ? esc(entry.repositoryName) : entry.workspaceSubtitleHtml),
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
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
};

// ── Local Rich-Tip Attribute Helper (frozen #acmRichTipPopover contract) ──
function richTipAttrs(key: string, title: string, body: string, meta?: string): string {
    const parts = [
        `data-popover-key="${esc(key)}"`,
        `data-tip-title="${esc(title)}"`,
        `data-tip-body="${esc(body)}"`,
    ];
    if (meta) {
        parts.push(`data-tip-meta="${esc(meta)}"`);
    }
    return parts.join(' ');
}

function toSafeTipKey(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

// ── Localized status badge helper ──
function renderStatusBadgeLabel(status: string): string {
    switch ((status || 'UNKNOWN').toUpperCase()) {
        case 'RUNNING': return tBiHtml('Running', '运行中');
        case 'FINISHED': return tBiHtml('Finished', '已完成');
        case 'IDLE': return tBiHtml('Idle', '空闲');
        case 'CANCELLED':
        case 'CANCELED': return tBiHtml('Cancelled', '已取消');
        case 'FAILED':
        case 'ERROR': return tBiHtml('Failed', '失败');
        case 'PENDING':
        case 'QUEUED': return tBiHtml('Pending', '等待中');
        case 'UNKNOWN': return tBiHtml('Unknown', '未知');
        default: return esc(status);
    }
}

function getStatusBadgeTip(status: string): { title: string; body: string; meta: string } {
    switch ((status || 'UNKNOWN').toUpperCase()) {
        case 'RUNNING':
            return {
                title: tBi('Running', '运行中'),
                body: tBi(
                    'The agent is actively generating responses or running tools in this session.',
                    '当前会话正在积极生成回复或执行工具步骤。',
                ),
                meta: tBi('Live session status reported by Antigravity local service', '来自 Antigravity 本地服务的实时会话状态'),
            };
        case 'FINISHED':
            return {
                title: tBi('Finished', '已完成'),
                body: tBi(
                    'This conversation run has ended and is no longer awaiting immediate turn continuation.',
                    '本次对话流程已结束，不再等待即时轮次续接。',
                ),
                meta: tBi('Contrast with Idle (open and waiting for your next prompt)', '区别于「空闲」（会话仍保持打开、等待你的下一条输入）'),
            };
        case 'IDLE':
            return {
                title: tBi('Idle', '空闲'),
                body: tBi(
                    'The session is open and paused between turns, ready for your next message.',
                    '会话仍处于打开状态，正等待你的下一条消息。',
                ),
                meta: tBi('Contrast with Finished (completed conversation run)', '区别于「已完成」（已结束的对话流程）'),
            };
        case 'CANCELLED':
        case 'CANCELED':
            return {
                title: tBi('Cancelled', '已取消'),
                body: tBi(
                    'The latest run in this session was stopped before finishing.',
                    '该会话最近一次执行在完成前被中断或取消。',
                ),
                meta: tBi('Reported session status', '本地服务上报状态'),
            };
        case 'FAILED':
        case 'ERROR':
            return {
                title: tBi('Failed', '失败'),
                body: tBi(
                    'The latest run exited with an error.',
                    '该会话最近一次执行因异常而终止。',
                ),
                meta: tBi('Check GM Data Error Details for exact status codes', '可在 GM 数据页的错误详情中查看具体状态码'),
            };
        case 'PENDING':
        case 'QUEUED':
            return {
                title: tBi('Pending', '等待中'),
                body: tBi(
                    'This session is queued and waiting to start execution.',
                    '该会话正在排队等待开始执行。',
                ),
                meta: tBi('Reported session status', '本地服务上报状态'),
            };
        default:
            return {
                title: tBi('Unknown Status', '未知状态'),
                body: tBi(
                    'The local service has not reported a recognized run state for this session.',
                    '本地服务暂未上报该会话的明确运行状态。',
                ),
                meta: tBi(`Raw status: ${status || 'UNKNOWN'}`, `原始状态：${status || 'UNKNOWN'}`),
            };
    }
}

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
            titleHtml: tBiHtml('Current Workspace', '当前工作区'),
            count: currentWorkspaceCount,
            active: currentWorkspaceCount > 0,
            tipTitle: tBi('Current Workspace', '当前工作区'),
            tipBody: currentWorkspaceCount > 0
                ? tBi(
                    'Filter to sessions recorded in the workspace folder currently open in Antigravity.',
                    '筛选出属于当前在 Antigravity 中打开的工作区目录的会话。',
                )
                : tBi(
                    'Disabled because no sessions in the catalog match the currently open workspace.',
                    '暂无匹配当前打开工作区的历史会话，因此此快捷筛选已禁用。',
                ),
            tipMeta: tBi(`${currentWorkspaceCount} matching sessions`, `匹配 ${currentWorkspaceCount} 个会话`),
        },
        {
            filter: 'currentrepo',
            icon: ICON.git,
            titleHtml: currentRepoName ? esc(currentRepoName) : tBiHtml('Current Repo', '当前仓库'),
            count: currentRepoCount,
            active: currentRepoCount > 0,
            tipTitle: currentRepoName || tBi('Current Repo', '当前仓库'),
            tipBody: currentRepoCount > 0
                ? tBi(
                    'Filter to sessions belonging to the active Git repository.',
                    '筛选出属于当前活跃 Git 仓库的全部会话。',
                )
                : tBi(
                    'Disabled because no active Git repository or matching repo sessions were detected.',
                    '未检测到当前活跃 Git 仓库或对应仓库会话，因此此快捷筛选已禁用。',
                ),
            tipMeta: tBi(`${currentRepoCount} matching sessions`, `匹配 ${currentRepoCount} 个会话`),
        },
        {
            filter: 'recordable',
            icon: ICON.database,
            titleHtml: tBiHtml('Backup Ready', '可备份'),
            count: recordableCount,
            active: recordableCount > 0,
            tipTitle: tBi('Backup Ready', '可备份'),
            tipBody: recordableCount > 0
                ? tBi(
                    'Filter to sessions that have local files on disk ready to inspect or back up.',
                    '筛选出在本地磁盘上存有可查看或备份文件的会话。',
                )
                : tBi(
                    'Disabled because no sessions currently have local Session Records, .pb archives, or recordings on disk.',
                    '本地磁盘暂未发现任何会话记录目录、对话存档 (.pb) 或录屏文件，因此已禁用。',
                ),
            tipMeta: tBi(
                'Criteria: has Session Records folder, Archive (.pb), or browser recording locally',
                '判定口径：本地存在会话记录目录、对话存档 (.pb) 或浏览器录屏之一',
            ),
        },
    ];

    return `
        <div class="ses-shortcuts">
            ${cards.map(card => {
                const tipAttrs = richTipAttrs(`ses-shortcut-${card.filter}`, card.tipTitle, card.tipBody, card.tipMeta);
                const btnHtml = `<button
                    type="button"
                    class="ses-shortcut${card.active ? '' : ' is-disabled'}"
                    data-history-shortcut="${card.filter}"
                    ${card.active ? tipAttrs : 'disabled'}
                >
                    <span class="ses-shortcut-icon">${card.icon}</span>
                    <span class="ses-shortcut-title">${card.titleHtml}</span>
                    <span class="ses-shortcut-count">${card.count}</span>
                </button>`;
                return card.active
                    ? btnHtml
                    : `<span class="rich-tip-disabled-wrap" ${tipAttrs} tabindex="0">${btnHtml}</span>`;
            }).join('')}
        </div>`;
}

// ── Compact toolbar (search + filters) ──
function renderToolbar(): string {
    const backupFilterTip = richTipAttrs(
        'ses-filter-recordable',
        tBi('Backup Ready', '可备份'),
        tBi(
            'Show only sessions that have local Session Records, Archive (.pb), or browser recordings on disk.',
            '仅显示本地磁盘上存在会话记录、对话存档 (.pb) 或录屏文件的会话。',
        ),
        tBi('Matches ~/.gemini/antigravity/{brain,conversations,browser_recordings}', '匹配 ~/.gemini/antigravity 下的本地会话产物'),
    );
    return `
        <div class="ses-toolbar">
            <div class="ses-search-wrap">
                ${ICON.search}
                <input
                    id="historySearchInput" aria-label="${esc(tBi('Search sessions', '搜索会话'))}"
                    class="ses-search-input"
                    type="text"
                    placeholder="${esc(tBi('Search title, folder, repo, model...', '搜索标题、文件夹、仓库、模型...'))}"
                    autocomplete="off"
                    spellcheck="false"
                />
            </div>
            <div class="ses-filters" role="group" aria-label="${esc(tBi('Session catalog filters', '会话目录筛选'))}">
                <button type="button" class="ses-filter-btn is-active" aria-pressed="true" data-history-filter="all"><span>${tBiHtml('All', '全部')}</span></button>
                <button type="button" class="ses-filter-btn" aria-pressed="false" data-history-filter="current"><span>${tBiHtml('Workspace', '工作区')}</span></button>
                <button type="button" class="ses-filter-btn" aria-pressed="false" data-history-filter="currentrepo"><span>${tBiHtml('Repo', '仓库')}</span></button>
                <button type="button" class="ses-filter-btn" aria-pressed="false" data-history-filter="running"><span>${tBiHtml('Running', '运行中')}</span></button>
                <button type="button" class="ses-filter-btn" aria-pressed="false" data-history-filter="recordable" ${backupFilterTip}><span>${tBiHtml('Backup Ready', '可备份')}</span></button>
            </div>
        </div>`;
}

// ── Single session row (compact card) ──
function renderRow(entry: HistoryEntry, rowIdx: number): string {
    const safeId = `${toSafeTipKey(entry.cascadeId.substring(0, 12))}-${rowIdx}`;
    const shortId = (entry.cascadeId || '').substring(0, 8);
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
        chips.push(`<span class="ses-chip ses-chip-time">${IC.clock} ${esc(timeStr)}</span>`);
    }

    // ── Storage badges (consistent plain-language localized labeling + rich-tip popovers) ──
    const storageTags: string[] = [];
    if (entry.hasBrain) {
        const brainTip = richTipAttrs(
            `ses-storage-records-${safeId}`,
            tBi('Session Records', '会话记录'),
            tBi(
                'Local folder holding markdown artifacts, plans, and scratch files created during this conversation.',
                '保存本次对话生成的计划文档、产物与临时分析文件的本地目录。',
            ),
            `~/.gemini/antigravity/brain/${shortId}…`,
        );
        storageTags.push(`<span class="ses-storage-tag" ${brainTip} tabindex="0"><span>${tBiHtml('Session Records', '会话记录')}</span></span>`);
    }
    if (entry.hasRecording) {
        const recTip = richTipAttrs(
            `ses-storage-rec-${safeId}`,
            tBi('Browser Recording', '浏览器录屏'),
            tBi(
                'Screen recordings captured when a browser subagent navigated pages during this session.',
                '浏览器子智能体在本次会话中执行网页操作时保存的录屏文件。',
            ),
            `~/.gemini/antigravity/browser_recordings/${shortId}…`,
        );
        storageTags.push(`<span class="ses-storage-tag" ${recTip} tabindex="0"><span>${tBiHtml('Rec', '录屏')}</span></span>`);
    }
    if (entry.hasPb) {
        const pbTip = richTipAttrs(
            `ses-storage-pb-${safeId}`,
            tBi('Archive (.pb)', '对话存档 (.pb)'),
            tBi(
                'Serialized binary conversation archive (.pb) storing the full turn-by-turn message history locally.',
                '以序列化格式保存在本地的完整对话历史存档文件（.pb）。',
            ),
            `~/.gemini/antigravity/conversations/${shortId}….pb`,
        );
        storageTags.push(`<span class="ses-storage-tag" ${pbTip} tabindex="0"><span>${tBiHtml('Archive (.pb)', '对话存档 (.pb)')}</span></span>`);
    }

    // ── Action buttons (frozen #acmRichTipPopover + accessible disabled wrappers) ──
    const wsLabel = tBi('Open Workspace', '打开工作区');
    const wsEnabledTip = richTipAttrs(
        `ses-act-ws-${safeId}`,
        wsLabel,
        tBi(
            'Open this session’s recorded project folder in your workspace.',
            '打开此会话关联的项目工作区目录。',
        ),
        entry.workspacePath || entry.workspaceUri,
    );
    const wsDisabledTip = richTipAttrs(
        `ses-act-ws-${safeId}`,
        wsLabel,
        tBi(
            'Disabled because this conversation has no local workspace path recorded.',
            '此对话未记录本地工作区路径（例如全局/未分组对话），因此无法打开工作区。',
        ),
        tBi('Unavailable for unscoped sessions', '未关联工作区的会话不可用'),
    );
    const wsBtnHtml = entry.workspaceUri
        ? `<button
                type="button"
                class="ses-act-btn" ${wsEnabledTip} aria-label="${esc(wsLabel)}"
                data-history-action="workspace"
                data-history-uri="${esc(entry.workspaceUri)}"
            >${ICON.folder}</button>`
        : `<span class="rich-tip-disabled-wrap" ${wsDisabledTip} tabindex="0"><button
                type="button"
                class="ses-act-btn" aria-label="${esc(wsLabel)}"
                data-history-action="workspace"
                data-history-uri=""
                disabled
            >${ICON.folder}</button></span>`;

    const recordLabel = tBi('Session Records', '会话记录');
    const recordTip = richTipAttrs(
        `ses-act-records-${safeId}`,
        recordLabel,
        tBi(
            'Reveal this conversation’s local Session Records folder (artifacts, plans, and scratch files).',
            '在文件管理器中打开此对话的本地会话记录目录（含产物、计划与临时文件）。',
        ),
        `~/.gemini/antigravity/brain/${shortId}…`,
    );
    const recordBtnHtml = `<button
                type="button"
                class="ses-act-btn ses-act-accent" ${recordTip} aria-label="${esc(recordLabel)}"
                data-history-action="record"
                data-cascade-id="${esc(entry.cascadeId)}"
            >${ICON.chat}</button>`;

    const pbLabel = tBi('Archive (.pb)', '对话存档 (.pb)');
    const pbEnabledTip = richTipAttrs(
        `ses-act-pb-${safeId}`,
        pbLabel,
        tBi(
            'Reveal the serialized conversation archive (.pb) file on disk for inspection or backup.',
            '在文件管理器中定位该会话的本地对话存档（.pb）文件以便查看或备份。',
        ),
        `~/.gemini/antigravity/conversations/${shortId}….pb`,
    );
    const pbDisabledTip = richTipAttrs(
        `ses-act-pb-${safeId}`,
        pbLabel,
        tBi(
            'Disabled because no local .pb conversation archive file was found for this session.',
            '本地未找到此会话对应的 .pb 对话存档文件，因此无法打开。',
        ),
        tBi('Expected under ~/.gemini/antigravity/conversations/', '默认路径：~/.gemini/antigravity/conversations/'),
    );
    const pbBtnHtml = entry.hasPb
        ? `<button
                type="button"
                class="ses-act-btn" ${pbEnabledTip} aria-label="${esc(pbLabel)}"
                data-history-action="pb"
                data-cascade-id="${esc(entry.cascadeId)}"
            >${ICON.file}</button>`
        : `<span class="rich-tip-disabled-wrap" ${pbDisabledTip} tabindex="0"><button
                type="button"
                class="ses-act-btn" aria-label="${esc(pbLabel)}"
                data-history-action="pb"
                data-cascade-id="${esc(entry.cascadeId)}"
                disabled
            >${ICON.file}</button></span>`;

    const actions = `
        <div class="ses-row-actions">
            ${wsBtnHtml}
            ${recordBtnHtml}
            ${pbBtnHtml}
        </div>`;

    const titleMetaParts = [`ID ${shortId || '—'}`];
    if (entry.modelLabel) { titleMetaParts.push(entry.modelLabel); }
    if (entry.stepCount > 0) { titleMetaParts.push(tBi(`${entry.stepCount} steps`, `${entry.stepCount} 步`)); }
    const titleTip = richTipAttrs(
        `ses-row-title-${safeId}`,
        entry.title,
        entry.workspacePath
            ? tBi(`Workspace: ${entry.workspacePath}`, `工作区：${entry.workspacePath}`)
            : tBi('Unscoped conversation session', '未绑定工作区的对话会话'),
        titleMetaParts.join(' · '),
    );

    const currentSessionBadge = entry.isCurrentSession
        ? `<span class="ses-badge is-current" ${richTipAttrs(
            `ses-badge-cur-${safeId}`,
            tBi('Current Session', '当前会话'),
            tBi('This is the active conversation currently being monitored.', '当前正在监控的活跃对话。'),
            `ID ${shortId || '—'}`,
        )}><span>${tBiHtml('Current', '当前')}</span></span>`
        : '';

    const currentWsBadge = entry.isCurrentWorkspace
        ? `<span class="ses-badge is-workspace" ${richTipAttrs(
            `ses-badge-ws-${safeId}`,
            tBi('Current Workspace', '当前工作区'),
            tBi('This session belongs to the workspace folder currently open in Antigravity.', '此会话属于当前在 Antigravity 中打开的工作区目录。'),
            entry.workspaceLabel,
        )}><span>${tBiHtml('Current Workspace', '当前工作区')}</span></span>`
        : '';

    const statusInfo = getStatusBadgeTip(entry.status);
    const statusTip = richTipAttrs(`ses-badge-status-${safeId}`, statusInfo.title, statusInfo.body, statusInfo.meta);

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
                <h3 class="ses-row-title" ${titleTip}>${entry.titleHtml}</h3>
                <div class="ses-row-badges">
                    ${currentSessionBadge}
                    ${currentWsBadge}
                    <span class="ses-badge ${statusClass}" ${statusTip}><span>${renderStatusBadgeLabel(entry.status)}</span></span>
                </div>
            </div>
            ${contextParts.length > 0 ? `<div class="ses-row-ctx">${contextParts.join(' <span class="ses-ctx-sep">·</span> ')}</div>` : ''}
            <div class="ses-row-metrics">
                <div class="ses-chips">${chips.join('')}</div>
                ${storageTags.length > 0 ? `<div class="ses-storage">${storageTags.join('')}</div>` : ''}
            </div>
            ${actions}
        </article>`;
}

// ── Group (collapsible) ──
function renderGroup(group: HistoryGroup, index: number, rowOffset: number): string {
    const runningCount = group.entries.filter(e => e.status === 'RUNNING').length;
    const openAttr = group.isCurrentWorkspace || index === 0 ? ' open' : '';
    const wsGroupTip = richTipAttrs(
        `ses-grp-ws-${index}`,
        tBi('Current Workspace', '当前工作区'),
        tBi('Matches the workspace folder currently open in Antigravity.', '与当前在 Antigravity 中打开的工作区目录一致。'),
    );
    const countGroupTip = richTipAttrs(
        `ses-grp-count-${index}`,
        tBi('Sessions in Group', '该分组会话数'),
        tBi(
            `Contains ${group.entries.length} ${group.entries.length === 1 ? 'conversation' : 'conversations'} recorded under this workspace.`,
            `此工作区下共记录了 ${group.entries.length} 个历史对话。`,
        ),
    );
    const runGroupTip = richTipAttrs(
        `ses-grp-run-${index}`,
        tBi('Active Running Sessions', '正在运行的会话'),
        tBi(
            `${runningCount} ${runningCount === 1 ? 'conversation is' : 'conversations are'} actively executing in this workspace group right now.`,
            `此工作区分组中当前有 ${runningCount} 个对话正在活跃执行。`,
        ),
        tBi('Count of sessions with status = Running', '统计口径：状态为「运行中」的会话数量'),
    );

    return `
        <details class="collapsible ses-group" id="history-group-${index}"${openAttr}>
            <summary>
                <div class="ses-group-head">
                    <div class="ses-group-labels">
                        <span class="ses-group-title">${group.labelHtml}</span>
                        <span class="ses-group-path">${group.subtitleHtml}</span>
                    </div>
                    <div class="ses-group-chips">
                        ${group.isCurrentWorkspace ? `<span class="ses-group-chip is-ws" ${wsGroupTip}><span>${tBiHtml('Current', '当前')}</span></span>` : ''}
                        <span class="ses-group-chip" ${countGroupTip}>${group.entries.length}</span>
                        ${runningCount > 0 ? `<span class="ses-group-chip is-run" ${runGroupTip}><span>${runningCount} ${tBiHtml('run', '运行')}</span></span>` : ''}
                    </div>
                </div>
            </summary>
            <div class="details-body ses-group-body">
                ${group.entries.map((e, ei) => renderRow(e, rowOffset + ei)).join('')}
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
    const header = `<header class="ed-pane-header"><h2 class="ed-pane-title">${tBiHtml('Sessions', '会话')}</h2></header>`;
    if (!trajectories || trajectories.length === 0) {
        return `${header}<p class="empty-msg">${tBiHtml(
            'Waiting for conversation history... the session catalog will appear after the first local service sync.',
            '正在等待对话历史... 首次与本地服务同步后会自动显示会话目录。',
        )}</p>`;
    }

    const entries = buildEntries(trajectories, currentUsage, gmSummary, gmConversations, currentWorkspaceUri);
    const groups = buildGroups(entries);
    let offset = 0;
    const groupsHtml = groups.map((group, index) => {
        const html = renderGroup(group, index, offset);
        offset += group.entries.length;
        return html;
    }).join('');

    return `
        ${header}
        ${renderShortcuts(entries, currentUsage)}
        ${renderToolbar()}
        <section class="ses-groups" id="historyGroups">
            ${groupsHtml}
        </section>`;
}

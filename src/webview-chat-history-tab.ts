import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { t, tBi, tHtml } from './i18n-core';
import { ContextUsage, TrajectorySummary, getModelDisplayName, normalizeUri } from './tracker';
import { esc, richTipAttrs, tBiHtml, toSafeTipKey } from './webview-helpers';
import type { GMSummary, GMConversationData } from './gm-tracker';
import { ICON } from './webview-icons';
import type { CurrencyInput } from './core/currency';
import type { SwarmMemberNode, SwarmTopologySnapshot } from './core/swarm-registry';
import { renderSwarmRecordedCost, renderSwarmMemberItemHtml, type SwarmMemberLiveRow, type SwarmOverviewDisplayData } from './webview-overview-tab';

export interface ChatHistoryRenderOptions {
    activeCascadeId?: string;
    swarmTopology?: SwarmTopologySnapshot | null;
    swarmOverview?: SwarmOverviewDisplayData | null;
    inspectedMemberId?: string | null;
    lockedRootId?: string | null;
    displayCurrency?: CurrencyInput;
    privacyMasked?: boolean;
}

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

interface PathExistenceCacheEntry {
    exists: boolean;
    checkedAtMs: number;
}

const DEFAULT_EXISTENCE_CACHE_TTL_MS = 30_000;
const MAX_EXISTENCE_CACHE_ENTRIES = 5_000;
const PREWARM_CONCURRENCY = 16;

let existenceCacheTtlMs = DEFAULT_EXISTENCE_CACHE_TTL_MS;
const pathExistenceCache = new Map<string, PathExistenceCacheEntry>();
const pathExistenceInFlight = new Map<string, Promise<boolean>>();

function setExistenceCacheEntry(targetPath: string, existsFlag: boolean, checkedAtMs: number): void {
    if (pathExistenceCache.has(targetPath)) {
        pathExistenceCache.delete(targetPath);
    } else if (pathExistenceCache.size >= MAX_EXISTENCE_CACHE_ENTRIES) {
        const oldestKey = pathExistenceCache.keys().next().value;
        if (oldestKey !== undefined) {
            pathExistenceCache.delete(oldestKey);
        }
    }
    pathExistenceCache.set(targetPath, { exists: existsFlag, checkedAtMs });
}

function probePathExistenceAsync(targetPath: string, nowFn: () => number = Date.now): Promise<boolean> {
    const existingFlight = pathExistenceInFlight.get(targetPath);
    if (existingFlight) {
        return existingFlight;
    }
    const promise = fs.promises.access(targetPath)
        .then(() => {
            setExistenceCacheEntry(targetPath, true, nowFn());
            return true;
        })
        .catch(() => {
            setExistenceCacheEntry(targetPath, false, nowFn());
            return false;
        })
        .finally(() => {
            pathExistenceInFlight.delete(targetPath);
        });
    pathExistenceInFlight.set(targetPath, promise);
    return promise;
}

/**
 * Non-blocking TTL cache lookup for local session artifacts during rendering.
 * Never performs synchronous `fs.accessSync` on the render thread; triggers an
 * asynchronous background refresh on cache miss or TTL expiry.
 */
function existsCachedNonBlocking(targetPath: string, nowMs = Date.now()): boolean {
    const cached = pathExistenceCache.get(targetPath);
    if (cached && (nowMs - cached.checkedAtMs) <= existenceCacheTtlMs) {
        return cached.exists;
    }
    void probePathExistenceAsync(targetPath);
    return cached ? cached.exists : false;
}

/**
 * Pre-warm the async existence cache for all conversation artifacts (`.pb`, `brain/`, `browser_recordings/`)
 * before rendering the Sessions / Chat History tab.
 */
export async function prewarmChatHistoryExistenceCache(
    trajectories: readonly Pick<TrajectorySummary, 'cascadeId'>[],
    options: { antigravityRoot?: string; force?: boolean; nowMs?: number } = {},
): Promise<void> {
    if (!trajectories || trajectories.length === 0) { return; }
    const root = options.antigravityRoot || getAntigravityRoot();
    const nowMs = typeof options.nowMs === 'number' && Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const force = Boolean(options.force);
    const pathsToProbe: string[] = [];

    for (const trajectory of trajectories) {
        if (!trajectory?.cascadeId) { continue; }
        const candidates = [
            path.join(root, 'conversations', `${trajectory.cascadeId}.pb`),
            path.join(root, 'brain', trajectory.cascadeId),
            path.join(root, 'browser_recordings', trajectory.cascadeId),
        ];
        for (const p of candidates) {
            const cached = pathExistenceCache.get(p);
            if (force || !cached || (nowMs - cached.checkedAtMs) > existenceCacheTtlMs) {
                pathsToProbe.push(p);
            }
        }
    }

    if (pathsToProbe.length === 0) { return; }

    let cursor = 0;
    const workerCount = Math.min(PREWARM_CONCURRENCY, pathsToProbe.length);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
        workers.push((async () => {
            while (cursor < pathsToProbe.length) {
                const idx = cursor++;
                await probePathExistenceAsync(pathsToProbe[idx], () => nowMs);
            }
        })());
    }
    await Promise.all(workers);
}

/** Clear all cached local artifact existence entries (for tests or manual refresh). */
export function clearChatHistoryExistenceCache(): void {
    pathExistenceCache.clear();
}

/** Override cache TTL in ms (clamped to >= 0; defaults to 30_000ms). */
export function setChatHistoryExistenceCacheTtlMs(ttlMs: number): void {
    existenceCacheTtlMs = Number.isFinite(ttlMs) && ttlMs >= 0 ? Math.floor(ttlMs) : DEFAULT_EXISTENCE_CACHE_TTL_MS;
}

/** Inspect cache diagnostics without mutating state. */
export function getChatHistoryExistenceCacheStats(): { size: number; inFlight: number; ttlMs: number } {
    return {
        size: pathExistenceCache.size,
        inFlight: pathExistenceInFlight.size,
        ttlMs: existenceCacheTtlMs,
    };
}

export function fileUriToPath(uri: string): string {
    if (!uri) { return ''; }
    if (uri.startsWith('file:///')) {
        const rawEncoded = uri.slice('file:///'.length);
        let raw = rawEncoded;
        try {
            raw = decodeURIComponent(rawEncoded);
        } catch {
            // Malformed percent-encoding (e.g. '%ZZ' or bare '%'): decode valid segments independently.
            raw = rawEncoded.split('/').map((segment) => {
                try {
                    return decodeURIComponent(segment);
                } catch {
                    return segment;
                }
            }).join('/');
        }
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
    antigravityRootOverride?: string,
): HistoryEntry[] {
    const antigravityRoot = antigravityRootOverride || getAntigravityRoot();
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
            hasPb: existsCachedNonBlocking(pbPath),
            hasBrain: existsCachedNonBlocking(brainDir),
            hasRecording: existsCachedNonBlocking(recordingDir),
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

const STATUS_TIP_TABLE: Record<string, [string, string, string, string, string?, string?]> = {
    RUNNING: ['Running', '运行中', 'Actively generating or running tools.', '当前正在生成回复或执行工具。'],
    FINISHED: ['Finished', '已完成', 'Conversation run ended.', '本次对话流程已结束。', 'Contrast with Idle', '区别于「空闲」'],
    IDLE: ['Idle', '空闲', 'Session is open and ready for your next message.', '会话保持打开，正等待你的下一条消息。', 'Contrast with Finished', '区别于「已完成」'],
    CANCELLED: ['Cancelled', '已取消', 'Latest run stopped before finishing.', '最近执行在完成前已取消。'],
    CANCELED: ['Cancelled', '已取消', 'Latest run stopped before finishing.', '最近执行在完成前已取消。'],
    FAILED: ['Failed', '失败', 'Latest run exited with an error.', '最近执行因异常终止。'],
    ERROR: ['Failed', '失败', 'Latest run exited with an error.', '最近执行因异常终止。'],
    PENDING: ['Pending', '等待中', 'Queued to start execution.', '正在排队等待执行。'],
    QUEUED: ['Pending', '等待中', 'Queued to start execution.', '正在排队等待执行。'],
};

function getStatusBadgeTip(status: string): { title: string; body: string; meta: string } {
    const key = (status || 'UNKNOWN').toUpperCase();
    const row = STATUS_TIP_TABLE[key];
    if (row) {
        return {
            title: tBi(row[0], row[1]),
            body: tBi(row[2], row[3]),
            meta: row[4] ? tBi(row[4], row[5]!) : tBi('Local service status', '本地服务状态'),
        };
    }
    return {
        title: tBi('Unknown Status', '未知状态'),
        body: tBi('Unrecognized run state.', '暂未上报明确状态。'),
        meta: key,
    };
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

function renderSwarmHierarchyTree(trajectories: readonly TrajectorySummary[], options?: ChatHistoryRenderOptions): string {
    const topo = options?.swarmTopology;
    const overview = options?.swarmOverview;
    if (!topo && (!overview || overview.members.length === 0)) { return ''; }

    const overviewById = new Map((overview?.members ?? []).map(m => [m.cascadeId, m]));
    const itemOpts = {
        displayCurrency: options?.displayCurrency,
        inspectedMemberId: options?.inspectedMemberId,
        lockedRootId: options?.lockedRootId,
        treeMode: true,
        activeCascadeId: options?.activeCascadeId,
        readableMemberIds: new Set(trajectories.map(tr => tr.cascadeId)),
    };

    type TreeGroup = { rootId: string; title: string; activeCount: number; rows: Array<SwarmMemberLiveRow & { depth: number; anomalyTags?: string[] }> };
    const groups: TreeGroup[] = [];

    if (topo && topo.groupsByRootId.size > 0) {
        for (const group of topo.groupsByRootId.values()) {
            const nodes = Array.from(new Set([...group.coordinatorIds, ...group.memberIds]))
                .map(id => topo.nodesById.get(id)).filter((n): n is SwarmMemberNode => Boolean(n));
            if (nodes.length === 0) { continue; }
            const kidsMap = new Map<string, SwarmMemberNode[]>();
            const roots: SwarmMemberNode[] = [];
            for (const n of nodes) {
                if (n.cascadeId === group.rootId) { roots.unshift(n); continue; }
                const pid = n.directParentId && n.directParentId !== n.cascadeId && topo.nodesById.has(n.directParentId) ? n.directParentId : group.rootId;
                const list = kidsMap.get(pid) || [];
                list.push(n);
                kidsMap.set(pid, list);
            }
            if (roots.length === 0) { roots.push(nodes.find(n => n.isCoordinator) || nodes[0]); }
            const seen = new Set<string>();
            const rows: TreeGroup['rows'] = [];
            const visit = (n: SwarmMemberNode, depth: number): void => {
                if (seen.has(n.cascadeId) || depth > 6) { return; }
                seen.add(n.cascadeId);
                const live = overviewById.get(n.cascadeId);
                rows.push({
                    cascadeId: n.cascadeId,
                    memberName: live?.memberName || n.memberName || n.cascadeId.slice(0, 8),
                    role: live?.role || n.assignedRole,
                    isCoordinator: Boolean(n.isCoordinator || n.cascadeId === group.rootId),
                    relationshipKind: n.relationshipKind,
                    phase: live?.phase || n.phase || (n.killed ? 'KILLED' : ''),
                    killed: Boolean(n.killed || live?.killed),
                    assignedModel: live?.assignedModel ?? n.assignedModel ?? null,
                    measuredModel: live?.measuredModel ?? n.measuredModel ?? null,
                    contextPct: live?.contextPct ?? n.contextPct ?? null,
                    directCostUsd: live?.directCostUsd ?? null,
                    recordedCalls: live?.recordedCalls,
                    unpricedCalls: live?.unpricedCalls,
                    lastObservedAt: live?.lastObservedAt ?? n.lastObservedAt ?? null,
                    isInspected: live?.isInspected,
                    isLockedRoot: live?.isLockedRoot,
                    depth,
                    anomalyTags: [n.isOrphan ? tBi('Orphan', '缺少父成员') : '', n.cycleDetected ? tBi('Cycle', '循环引用') : '', n.hasConflict ? tBi('Conflict', '记录冲突') : '', n.isStaleManifest ? tBi('Stale', '清单已过期') : ''].filter(Boolean),
                });
                for (const kid of kidsMap.get(n.cascadeId) || []) { visit(kid, depth + 1); }
            };
            for (const r of roots) { visit(r, 0); }
            for (const n of nodes) { visit(n, 1); }
            groups.push({ rootId: group.rootId, title: group.title || overview?.title || `${t('swarm.rootLabel')} ${group.rootId.slice(0, 8)}`, activeCount: group.activeMemberIds.length, rows });
        }
    } else if (overview && overview.members.length > 0) {
        groups.push({
            rootId: overview.rootId,
            title: overview.title || `${t('swarm.rootLabel')} ${overview.rootId.slice(0, 8)}`,
            activeCount: overview.members.filter(m => !m.killed).length,
            rows: overview.members.map(m => ({ ...m, depth: m.isCoordinator ? 0 : (m.relationshipKind === 'nested_helper' ? 2 : 1) })),
        });
    }

    if (groups.length === 0) { return ''; }
    const groupsHtml = groups.map(g => {
        const isCurrentGroup = g.rows.some(m => m.cascadeId === options?.activeCascadeId || m.cascadeId === options?.inspectedMemberId);
        const cost = overview?.rootId === g.rootId ? renderSwarmRecordedCost(overview, options?.displayCurrency) : '';
        const costLine = cost ? `<span class="swarm-group-cost">${cost}</span>` : '';
        return `<details class="collapsible ses-swarm-group" id="sessions-swarm-group-${esc(g.rootId)}"${isCurrentGroup || groups.length === 1 ? ' open' : ''}><summary><div class="ses-group-head"><div class="ses-group-labels"><span class="ses-group-title swarm-member-name">${esc(g.title)}</span>${costLine}</div><div class="ses-group-chips"><span class="ses-group-chip">${g.rows.length}</span>${g.activeCount > 0 ? `<span class="ses-group-chip is-run">${g.activeCount} ${tBiHtml('active', '活跃')}</span>` : ''}</div></div></summary><ul class="swarm-tree-list">${g.rows.map(r => renderSwarmMemberItemHtml(r, { ...itemOpts, groupId: g.rootId })).join('')}</ul></details>`;
    }).join('');
    const partialHtml = (overview?.partialCoverage || (overview && (overview.totalMemberCount ?? overview.members.length) >= 20))
        ? `<p class="swarm-partial-note" data-swarm-partial-coverage="true">${tHtml('swarm.partialCoverage')}</p>`
        : '';
    return `<section class="ses-swarm-tree" id="sessionsSwarmTree" data-swarm-hierarchy="true" aria-labelledby="ses-swarm-heading"><div class="ses-swarm-head"><h3 id="ses-swarm-heading">${tHtml('swarm.liveTracking')}</h3>${partialHtml}</div>${groupsHtml}</section>`;
}

export function buildChatHistoryTabContent(
    trajectories: TrajectorySummary[],
    currentUsage: ContextUsage | null,
    gmSummary: GMSummary | null,
    gmConversations?: Record<string, GMConversationData>,
    currentWorkspaceUri?: string,
    antigravityRootOverride?: string,
    options?: ChatHistoryRenderOptions,
): string {
    const header = `<header class="ed-pane-header"><h2 class="ed-pane-title">${tHtml('nav.sessions')}</h2></header>`;
    const swarmTreeHtml = renderSwarmHierarchyTree(trajectories, options);
    if (!trajectories || trajectories.length === 0) {
        return `${header}${swarmTreeHtml}<p class="empty-msg">${tBiHtml(
            'Waiting for conversation history... the session catalog will appear after the first local service sync.',
            '正在等待对话历史... 首次与本地服务同步后会自动显示会话目录。',
        )}</p>`;
    }

    const entries = buildEntries(
        trajectories,
        currentUsage,
        gmSummary,
        gmConversations,
        currentWorkspaceUri,
        antigravityRootOverride,
    );
    const groups = buildGroups(entries);
    let offset = 0;
    const groupsHtml = groups.map((group, index) => {
        const html = renderGroup(group, index, offset);
        offset += group.entries.length;
        return html;
    }).join('');

    return `
        ${header}
        ${swarmTreeHtml}
        ${renderShortcuts(entries, currentUsage)}
        ${renderToolbar()}
        <section class="ses-groups" id="historyGroups">
            ${groupsHtml}
        </section>`;
}

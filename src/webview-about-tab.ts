// ─── About Tab Content Builder ───────────────────────────────────────────────
// Builds HTML for the "About" tab: plugin overview, feature navigation cards,
// GitHub info, tips, and disclaimer — consolidated from the former topbar chips.

import { formatClockTime, getLanguage, tBi } from './i18n-core';
import type { UpdateStatusView } from './webview-settings-tab';
import { ICON } from './webview-icons';
import { esc, tBiHtml } from './webview-helpers';

export interface AboutTabOptions {
    surface?: 'ide' | 'app-sidecar' | 'app';
    updateStatus?: UpdateStatusView | null;
    now?: number;
}

// ─── SVG Icons (About-specific, 16px / stroke-width 1.65) ───────────────────

const ABOUT_ICON = {
    /** Lightning bolt — GM Data */
    gmdata: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
    /** Chat bubbles — Sessions */
    chats: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    /** Dollar — Cost */
    cost: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    /** CPU — Models */
    models: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
    /** Calendar — Calendar */
    calendar: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    /** Person — Profile */
    profile: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    /** Gear — Settings */
    settings: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    /** Grid — Navigation */
    grid: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    /** Info circle */
    info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    /** Alert triangle */
    alert: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    /** Shield with check — Compatibility */
    shieldCheck: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11.5 14.5 15.5 10"/></svg>',
    /** Globe */
    globe: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    /** Heart — Acknowledgments */
    heart: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
} as const;

// ─── Feature Card Definitions ────────────────────────────────────────────────

interface FeatureCard {
    tabId: string;
    icon: string;
    titleHtml: string;
    descriptionHtml: string;
}

function aboutRichTipAttrs(
    key: string,
    titleEn: string,
    titleZh: string,
    bodyEn: string,
    bodyZh: string,
    metaEn?: string,
    metaZh?: string,
): string {
    const title = tBi(titleEn, titleZh);
    const body = tBi(bodyEn, bodyZh);
    const meta = metaEn || metaZh ? tBi(metaEn || '', metaZh || '') : '';
    return ` data-popover-key="${esc(key)}" data-tip-title="${esc(title)}" data-tip-body="${esc(body)}"${meta ? ` data-tip-meta="${esc(meta)}"` : ''}`;
}

function getFeatureCards(): FeatureCard[] {
    return [
        {
            tabId: 'overview',
            icon: ICON.chart,
            titleHtml: tBiHtml('Overview', '总览'),
            descriptionHtml: tBiHtml(
                'Current context, shared quota pools, reset times, and session diagnostics.',
                '查看当前上下文、共享配额池、重置时间和会话诊断。',
            ),
        },
        {
            tabId: 'gmdata',
            icon: ABOUT_ICON.gmdata,
            titleHtml: tBiHtml('GM Data', 'GM 数据'),
            descriptionHtml: tBiHtml(
                'Real-time model call analytics: per-call tokens, credits, reference cost, latency, error tracking, tool usage ranking, and context intelligence from runtime call telemetry (Generator Metadata).',
                '实时模型调用分析：逐次调用的 Token、积分、参考费用、延迟、错误追踪、工具排行与上下文情报（来自模型调用遥测 Generator Metadata）。',
            ),
        },
        {
            tabId: 'chats',
            icon: ABOUT_ICON.chats,
            titleHtml: tBiHtml('Sessions', '会话'),
            descriptionHtml: tBiHtml(
                'Browse all AI conversations with quick access to local session records (Brain), conversation archives (.pb / Protobuf), and workspace folders.',
                '浏览与 AI 的全部对话，快速访问每个会话的本地会话记录（Brain）、对话存档（.pb / Protobuf）和工作区文件夹。',
            ),
        },
        {
            tabId: 'pricing',
            icon: ABOUT_ICON.cost,
            titleHtml: tBiHtml('Cost', '成本'),
            descriptionHtml: tBiHtml(
                'Estimated USD cost analysis per model with monthly breakdown charts and custom rates per token type (input, output, cache, thinking).',
                '按模型估算 USD 费用，含月度分项图表，支持按 Token 类型（输入、输出、缓存、思考）自定义单价。',
            ),
        },
        {
            tabId: 'models',
            icon: ABOUT_ICON.models,
            titleHtml: tBiHtml('Models', '模型'),
            descriptionHtml: tBiHtml(
                'All available AI models and specifications: shared quota pools, reset schedules, compaction and native context limits, and thinking capabilities.',
                '所有可用 AI 模型及其规格：共享配额池、重置时间、自动压缩上限与原生窗口上限，以及思考能力参数。',
            ),
        },
        {
            tabId: 'calendar',
            icon: ABOUT_ICON.calendar,
            titleHtml: tBiHtml('Calendar', '日历'),
            descriptionHtml: tBiHtml(
                'Daily usage archive with interactive heatmap and monthly calendar recording calls, tokens, credits, archived cycles, and optional local CLI usage logs.',
                '每日用量归档、活动热力图与交互式月历，记录每日调用、Token、积分、归档周期及可选的本地 CLI 用量日志。',
            ),
        },
        {
            tabId: 'profile',
            icon: ABOUT_ICON.profile,
            titleHtml: tBiHtml('Profile', '账号'),
            descriptionHtml: tBiHtml(
                'Account identity with privacy mask, shared model quota pools, AI credits and expiry countdown, plus plan limits and capabilities.',
                '当前账号身份与隐私遮罩、共享模型配额池、AI 积分与到期倒计时，以及计划限制与功能配置。',
            ),
        },
        {
            tabId: 'settings',
            icon: ABOUT_ICON.settings,
            titleHtml: tBiHtml('Settings', '设置'),
            descriptionHtml: tBiHtml(
                'Extension preferences: persistent storage diagnostics, low-quota alerts, polling interval, status bar toggles, and interface zoom.',
                '扩展偏好设置：持久化存储诊断、低配额警报、轮询间隔、状态栏开关和界面缩放。',
            ),
        },
    ];
}

// ─── Public API ──────────────────────────────────────────────────────────────

function formatCheckedAtLabel(checkedAt: number | null | undefined): string {
    if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt) || checkedAt <= 0) {
        return tBiHtml('Not checked yet', '尚未检查');
    }
    const d = new Date(checkedAt);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const clock = formatClockTime(d, getLanguage());
    return esc(`${yyyy}-${mm}-${dd} ${clock}`);
}

const OPEN_VSX_URL = 'https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor';

export function buildAboutTabContent(version = '1.18.0', options?: AboutTabOptions): string {
    const cards = getFeatureCards();
    const normalizedVersion = typeof version === 'string' && version.trim() ? version.trim() : '1.18.0';
    const versionTag = normalizedVersion.startsWith('v') ? normalizedVersion : `v${normalizedVersion}`;
    const surface = options?.surface ?? 'ide';
    const isAppSidecar = surface === 'app-sidecar' || surface === 'app';
    const updateStatus = options?.updateStatus ?? null;
    const updateAvailable = Boolean(
        updateStatus?.updateAvailable
        || updateStatus?.hasUpdate
        || updateStatus?.status === 'update_available',
    );
    const rawLatest = updateStatus?.latestVersion?.trim() || null;
    const latestTag = rawLatest ? (rawLatest.startsWith('v') ? rawLatest : `v${rawLatest}`) : null;

    let updateStatusPillHtml: string;
    if (updateAvailable && latestTag) {
        const tip = aboutRichTipAttrs(
            'about-update-status-pill',
            `Update Available (${latestTag})`,
            `有可用更新（${latestTag}）`,
            `A newer release (${latestTag}) is published on GitHub Releases (current: ${versionTag}).`,
            `GitHub Releases 已发布新版本 ${latestTag}（当前版本：${versionTag}）。`,
            'Use Upgrade Now (App) or Open VSX (IDE) to update.',
            'App 端可点击「立即升级」，IDE 端可前往 Open VSX 更新。',
        );
        updateStatusPillHtml = `<span class="stg-status-pill is-update" data-about-update-status="update_available"${tip}>${tBiHtml(`Update available: ${latestTag}`, `有可用更新：${latestTag}`)}</span>`;
    } else if (updateStatus?.status === 'error') {
        const errDetail = updateStatus.error?.trim()
            || tBi('Unable to reach GitHub Releases to check for updates.', '无法连接 GitHub Releases 检查更新。');
        const tip = ` data-popover-key="about-update-status-pill" data-tip-title="${esc(tBi('Update Check Failed', '更新检查失败'))}" data-tip-body="${esc(errDetail)}" data-tip-meta="${esc(tBi('Click "Check for Updates" to retry once network access is available.', '网络恢复后可点击「检查更新」重试。'))}"`;
        updateStatusPillHtml = `<span class="stg-status-pill is-error" data-about-update-status="error"${tip}>${tBiHtml('Check failed', '检查失败')}</span>`;
    } else if (updateStatus?.status === 'up_to_date' || updateStatus?.status === 'not_modified' || (updateStatus?.checkedAt && !updateAvailable)) {
        const tip = aboutRichTipAttrs(
            'about-update-status-pill',
            `Up to Date (${versionTag})`,
            `已是最新（${versionTag}）`,
            `Installed version ${versionTag} matches the latest GitHub Release.`,
            `当前已安装的 ${versionTag} 已是 GitHub Releases 最新版本。`,
        );
        updateStatusPillHtml = `<span class="stg-status-pill is-uptodate" data-about-update-status="up_to_date"${tip}>${tBiHtml('Up to date', '已是最新')}</span>`;
    } else {
        const tip = aboutRichTipAttrs(
            'about-update-status-pill',
            `Installed Version ${versionTag}`,
            `当前版本 ${versionTag}`,
            'No update check has run yet in this session.',
            '本次会话尚未执行更新检查。',
            'Click "Check for Updates" to check GitHub Releases.',
            '点击「检查更新」可立即查询 GitHub Releases。',
        );
        updateStatusPillHtml = `<span class="stg-status-pill" data-about-update-status="idle"${tip}>${tBiHtml('Ready', '就绪')}</span>`;
    }

    const versionUpdates = `
    <section class="about-section" id="aboutUpdatesSection">
        <h3 class="about-section-title">
            ${ICON.refresh}
            <span>${tBiHtml('Version & Updates', '版本与更新')}</span>
        </h3>
        <div class="about-updates-card" data-about-updates="true" data-surface="${isAppSidecar ? 'app-sidecar' : 'ide'}">
            <div class="about-updates-head">
                <div class="about-updates-meta">
                    <span><strong>${tBiHtml('Current', '当前版本')}:</strong> ${esc(versionTag)}</span>
                    <span><strong>${tBiHtml('Last checked', '上次检查')}:</strong> ${formatCheckedAtLabel(updateStatus?.checkedAt)}</span>
                </div>
                ${updateStatusPillHtml}
            </div>
            <div class="about-updates-actions">
                <button type="button" class="about-action-btn" id="aboutCheckUpdatesBtn" data-action="checkForUpdates">
                    ${ICON.refresh} <span>${tBiHtml('Check for Updates', '检查更新')}</span>
                </button>
                ${isAppSidecar && updateAvailable
            ? `<button type="button" class="about-action-btn is-primary" id="aboutUpgradeNowBtn" data-action="applyPluginUpdate"><span>${tBiHtml('Upgrade Now', '立即升级')}</span></button>`
            : (!isAppSidecar
                ? `<a class="about-action-btn" id="aboutOpenVsxLink" data-action="openExternalUrl" data-url="${OPEN_VSX_URL}" href="${OPEN_VSX_URL}" target="_blank" rel="noopener noreferrer">${ICON.externalLink} <span>${tBiHtml('Open VSX', 'Open VSX 市场')}</span></a>`
                : '')}
                <span id="aboutUpdatesFeedback" class="threshold-feedback" role="status"></span>
            </div>
            <div class="about-agent-tip" data-agents-tip="true">
                <strong>${tBiHtml('AI Agent one-sentence install / upgrade (AGENTS.md):', 'AI Agent 一句话安装 / 升级（AGENTS.md）：')}</strong>
                <span>${tBiHtml(
        'Ask your coding agent: ',
        '直接对 AI 助手说：',
    )}</span><code>${esc(tBi(
        'Follow AGENTS.md in AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor to install or upgrade this plugin.',
        '请按 AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor 仓库的 AGENTS.md 安装或升级该插件。',
    ))}</code>
            </div>
        </div>
    </section>`;

    // ── Hero section ──
    const hero = `
    <header class="about-hero">
        <div class="about-hero-heading">
            <h2 class="about-hero-title">${tBiHtml('Antigravity Context Window Monitor', 'Antigravity 上下文窗口监控')}</h2>
            <span class="about-version-pill">${esc(versionTag)}</span>
        </div>
        <p class="about-hero-subtitle">${tBiHtml(
        'An open-source community monitor for real-time context window, quota runway, and AI model telemetry across Antigravity IDE and Antigravity App.',
        '一款开源社区监控工具，用于实时分析 Antigravity IDE 与 Antigravity App 中的上下文窗口、配额续航与 AI 模型遥测数据。',
    )}</p>
        <div class="about-platform-chips" role="group" aria-label="${esc(tBi('Supported platforms', '支持的平台'))}">
            <span class="about-platform-chip about-platform-active" role="status" aria-label="${esc(tBi('Antigravity IDE: actively supported', 'Antigravity IDE：已支持'))}"${aboutRichTipAttrs(
        'about-platform-ide',
        'Antigravity IDE (VSIX)',
        'Antigravity IDE（VSIX 扩展）',
        'Actively supported via the standard VSIX extension with status bar telemetry and full webview dashboard.',
        '通过标准 VSIX 扩展完整支持，提供状态栏监控与全功能面板。',
    )}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                <span>${tBiHtml('Antigravity IDE', 'Antigravity IDE')}</span>
            </span>
            <span class="about-platform-chip about-platform-active" role="status" aria-label="${esc(tBi('Antigravity App (Desktop 2.0+ Sidecar): actively supported', 'Antigravity App（桌面版 2.0+ 侧边插件 (Sidecar)）：已支持'))}"${aboutRichTipAttrs(
        'about-platform-app',
        'Antigravity App (Sidecar)',
        'Antigravity App（侧边插件 Sidecar）',
        'Actively supported via Antigravity\'s official zero-patch Sidecar plugin API (side pane + sidebar + optional CDP overlays).',
        '通过 Antigravity 官方零魔改侧边插件（Sidecar）接口完整支持，含辅助栏、主侧栏与可选 CDP 悬浮层。',
    )}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M8 21h8"/><path d="M12 17v4"/><circle cx="12" cy="10" r="3"/></svg>
                <span>${tBiHtml('Antigravity App (Desktop 2.0+ Sidecar)', 'Antigravity App（桌面版 2.0+ 侧边插件 (Sidecar)）')}</span>
            </span>
            <span class="about-platform-chip" role="status" aria-label="${esc(tBi('SDK: runtime plugin not supported', 'SDK：不支持运行时插件'))}"${aboutRichTipAttrs(
        'about-platform-sdk',
        'SDK (Not Supported)',
        'SDK（暂不支持）',
        'Programmatic SDK integrations are a separate product line without a monitor UI host.',
        'SDK 属于独立的程序化开发产品线，不提供监控面板宿主，不在支持范围内。',
    )}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                <span>${tBiHtml('SDK', 'SDK')}</span>
            </span>
            <span class="about-platform-chip" role="status" aria-label="${esc(tBi('CLI: standalone runtime plugin not supported (Calendar reads local CLI usage logs)', 'CLI：不支持独立运行时插件（日历页可读取本地 CLI 用量日志）'))}"${aboutRichTipAttrs(
        'about-platform-cli',
        'CLI (History Logs Only)',
        'CLI（仅读取历史日志）',
        'There is no standalone CLI runtime monitor plugin, but the Calendar tab can still read local CLI usage logs into your history.',
        '独立 CLI 不支持安装实时监控插件，但「日历」页仍可读取本地 CLI 用量日志并计入历史统计。',
        'Filter by "CLI" in the Calendar tab to inspect scanned CLI history.',
        '在「日历」页切换到「CLI」筛选即可查看已扫描的本地 CLI 历史记录。',
    )}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                <span>${tBiHtml('CLI', 'CLI')}</span>
            </span>
        </div>
        <p class="about-platform-note">${tBiHtml(
        'Actively supports both Antigravity IDE (VSIX extension) and Antigravity App (Desktop 2.0+ native Sidecar plugin). SDK and standalone CLI runtime plugins are not supported, though local CLI usage logs can still be read in Calendar history.',
        '现已同时支持 Antigravity IDE（VSIX 扩展）与 Antigravity App（桌面版 2.0+ 原生侧边插件 (Sidecar)）。SDK 与独立 CLI 运行时插件不在支持范围内（日历页仍可读取本地 CLI 用量日志纳入历史统计）。',
    )}</p>
    </header>`;

    // ── Feature navigation grid ──
    const cardItems = cards.map(c => `
        <button type="button" class="about-card" data-navigate-tab="${c.tabId}">
            <span class="about-card-icon">${c.icon}</span>
            <span class="about-card-body">
                <span class="about-card-title">${c.titleHtml}</span>
                <span class="about-card-desc">${c.descriptionHtml}</span>
            </span>
            <svg class="about-card-arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path fill="currentColor" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/>
            </svg>
        </button>`).join('');

    const nav = `
    <section class="about-section">
        <h3 class="about-section-title">
            ${ABOUT_ICON.grid}
            <span>${tBiHtml('Feature Navigation', '功能导航')}</span>
        </h3>
        <div class="about-cards">${cardItems}</div>
    </section>`;

    // ── GitHub section ──
    const github = `
    <section class="about-section about-github">
        <h3 class="about-section-title">
            ${ICON.git}
            <span>${tBiHtml('Open Source', '开源项目')}</span>
        </h3>
        <div class="about-info-box about-info-github">
            <p><strong>AGI-is-going-to-arrive</strong> · ${tBiHtml(
        'Open-source on GitHub under the MIT License. Stars, bug reports, and contributions are welcome.',
        '项目已在 GitHub 以 MIT 协议开源，欢迎 Star、反馈问题或参与贡献。',
    )}</p>
            <a class="about-github-link" href="https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor" target="_blank" rel="noopener noreferrer">
                ${ICON.externalLink} <span>${tBiHtml('GitHub Repository', 'GitHub 仓库')}</span>
            </a>
        </div>
    </section>`;

    // ── Acknowledgments section ──
    const ackProjects: Array<{
        links: Array<{ label: string; href: string }>;
        en: string;
        zh: string;
    }> = [
        {
            links: [{ label: 'dimitr-io/antigravity-desktop-context', href: 'https://github.com/dimitr-io/antigravity-desktop-context' }],
            en: 'App Sidecar AUX_PANE workflow, 20×5 dot-matrix context view, dual-cap clarity, and /context text export.',
            zh: 'App Sidecar AUX_PANE 工作流、20×5 点阵上下文视图、双上限清晰标注与 /context 文本导出。',
        },
        {
            links: [{ label: 'elviscjn-cjn/antigravity-context-viewer', href: 'https://github.com/elviscjn-cjn/antigravity-context-viewer' }],
            en: 'Desktop telemetry UX exploration, turn/cache visualization ideas, and v2.33+/v2.34+ stability lessons.',
            zh: '桌面端遥测交互探索、轮次/缓存可视化思路与 Antigravity v2.33+/v2.34+ 稳定性实践经验。',
        },
        {
            links: [{ label: 'yuhuan-dev/antigravity-usage-monitor', href: 'https://github.com/yuhuan-dev/antigravity-usage-monitor' }],
            en: 'Zero-dependency Sidecar architecture, Linux /proc port discovery fallback, and Lock to Main Agent.',
            zh: '零依赖 Sidecar 架构、Linux /proc 端口发现兜底与「锁定主会话」防子智能体抢占机制。',
        },
        {
            links: [
                { label: 'ahmetdotsh/agy-context', href: 'https://github.com/ahmetdotsh/agy-context' },
                { label: 'agy-usage', href: 'https://github.com/ahmetdotsh/agy-usage' },
            ],
            en: 'Segmented bar ↔ matrix toggle, effective vs native limits, last-turn vs cumulative cache rate, and ETag short-circuiting.',
            zh: '分段条形 ↔ 点阵切换、有效预算与原生上限对照、最近一轮与累计缓存率区分及 ETag 增量短路。',
        },
        {
            links: [
                { label: 'arthurcavallari/antigravity-context-monitor', href: 'https://github.com/arthurcavallari/antigravity-context-monitor' },
                { label: 'antigravity-sidecar-kit', href: 'https://github.com/arthurcavallari/antigravity-sidecar-kit' },
            ],
            en: 'Compaction checkpoint & largest-items inspection, custom-* quota isolation, and BOM-safe installation.',
            zh: '压缩检查点与最大占用项排查、custom-* 自定义模型配额隔离及跨平台无 BOM 安装实践。',
        },
        {
            links: [{ label: 'Lumidarin/agy-capsule', href: 'https://github.com/Lumidarin/agy-capsule' }],
            en: 'Design inspiration for compact desktop context capsule and composer-adjacent ring telemetry UX.',
            zh: '为紧凑桌面端上下文胶囊与输入框旁悬浮环交互体验提供设计灵感。',
        },
        {
            links: [{ label: 'evenluo/agy-pulse', href: 'https://github.com/evenluo/agy-pulse' }],
            en: 'Design inspiration for multi-period activity pulse heatmaps and usage analytics dashboards.',
            zh: '为多周期活动脉搏热力图与用量统计看板提供设计灵感。',
        },
        {
            links: [{ label: 'jule-x/antigravity-context-monitor', href: 'https://github.com/jule-x/antigravity-context-monitor' }],
            en: 'Per-turn Cold / Partial / Warm prompt cache classification and +Δ context growth diagnostics.',
            zh: '逐轮冷启动 / 部分命中 / 热缓存提示词缓存分类与 +Δ 上下文净增长诊断。',
        },
        {
            links: [{ label: 'bocai991/antigravity-quota-meter', href: 'https://github.com/bocai991/antigravity-quota-meter' }],
            en: 'Dual AUX_PANE + SIDEBAR Sidecar mounting and rolling quota burn-rate / runway estimation.',
            zh: 'AUX_PANE + SIDEBAR 双入口 Sidecar 挂载与滚动窗口配额消耗速率及续航预测。',
        },
        {
            links: [{ label: 'vladsboev-web/chat_tokens', href: 'https://github.com/vladsboev-web/chat_tokens' }],
            en: 'One-click HANDOFF.md continuation prompt export and recent conversation switching.',
            zh: '一键导出 HANDOFF.md 续接提示词与近期会话切换。',
        },
        {
            links: [{ label: 'benedictusrey/Antigravity-Monitor', href: 'https://github.com/benedictusrey/Antigravity-Monitor' }],
            en: 'Explicit Measured vs Estimated state badges and distinguishing Rewind from Compaction.',
            zh: '明确区分实测与估算状态徽章，以及将回退（Rewind）与压缩（Compaction）区分呈现。',
        },
    ];

    const ackItems = ackProjects.map(project => {
        const linkHtml = project.links
            .map(l => `<a class="about-ack-link" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`)
            .join(' &amp; ');
        return `<li class="about-ack-item">${linkHtml} — <span class="about-ack-desc">${tBiHtml(project.en, project.zh)}</span></li>`;
    }).join('');

    const acknowledgments = `
    <section class="about-section about-acks">
        <h3 class="about-section-title">
            ${ABOUT_ICON.heart}
            <span>${tBiHtml('Acknowledgments', '致谢')}</span>
        </h3>
        <div class="about-info-box about-info-acks">
            <p>${tBiHtml(
        'Built independently from scratch with a zero-patch architecture atop our own core and official Sidecar / VSIX APIs (never patching app.asar or copying third-party code). Grateful to the open-source Antigravity community projects that offered design inspiration:',
        '本项目采用独立零篡改架构，基于自有核心与官方 Sidecar / VSIX 接口从零实现（绝不修改 app.asar，不复制外部代码）。衷心感谢以下开源 Antigravity 社区项目带来的设计启发：',
    )}</p>
            <ul class="about-ack-list">${ackItems}</ul>
        </div>
    </section>`;

    // ── Tips section ──
    const tips = `
    <section class="about-section">
        <h3 class="about-section-title">
            ${ABOUT_ICON.info}
            <span>${tBiHtml('Tips', '使用提示')}</span>
        </h3>
        <div class="about-info-box about-info-tips">
            <p>${tBiHtml(
        'Recommended: use a single IDE window. Multi-window setups may cause data desync between instances (e.g. activity timeline and GM data refresh).',
        '建议使用单窗口运行。多窗口可能导致实例间数据不同步（如活动时间线和 GM 数据刷新）。',
    )}</p>
        </div>
    </section>`;

    // ── Compatibility section ──
    const compatibility = `
    <section class="about-section">
        <h3 class="about-section-title">
            ${ABOUT_ICON.shieldCheck}
            <span>${tBiHtml('Compatibility', '兼容性验证')}</span>
        </h3>
        <div class="about-info-box about-info-compat">
            <p><strong class="about-compat-lead">${tBiHtml(`Verified for ${versionTag}:`, `${versionTag} 本次验证：`)}</strong> ${tBiHtml(
        'Verified against both Antigravity IDE (agy hub LS 2.34.0) and Antigravity App (Desktop 2.0+ Sidecar plugin) on macOS. Includes Context Composition Breakdown (Bar & 100-Dot Matrix, Dual-Cap Clarity), Conversation Switcher & Main-Agent Lock, Quota Burn-Rate Runway with Stale-Safe fallback and custom-* isolation, Orchestrator Settings (Orchestrator Model + Executor Model, including Claude Opus 5.5 and Sonnet 5.5), dual-window (5h + Weekly) quota tracking, Extra High effort alignment across Gemini 4 Neon & Hydrogen, 512K context support across all Gemini 4 models, and official USD cost & telemetry tracking.',
        '在 macOS 上同时通过 Antigravity IDE（agy hub 本地服务 2.34.0）与 Antigravity App（桌面版 2.0+ Sidecar）原生侧边插件双端验证。包含上下文构成明细（条形 / 100 点阵视图与双上限标注）、会话切换与锁定主会话、配额续航预测与缓存保底及 custom-* 模型隔离、编排设置（含 Claude Opus 5.5 与 Sonnet 5.5）、双窗口（5 小时 + 每周）配额追踪、Gemini 4 Neon 与 Hydrogen 统一 Extra High / 超高档位、全系列 Gemini 4 模型 512K 上下文支持以及官方 USD 费用与调用遥测追踪。',
    )}</p>
            <p><strong>${tBiHtml('Earlier contributor checks:', '此前贡献者验证版本：')}</strong> v1.18.4, v1.19.6, v1.20.6, v1.23.2.</p>
            <p>${tBiHtml(
        'Windows and Linux compatibility is covered by platform regression tests; native IDE & Antigravity App validation is performed on macOS. Future updates may change internal APIs. See the Disclaimer below for details.',
        'Windows 和 Linux 兼容性由平台回归测试覆盖；原生 IDE 与 Antigravity App 验证环境为 macOS。未来版本更新可能变更内部 API，详见下方免责声明。',
    )}</p>
        </div>
    </section>`;

    // ── Disclaimer section ──
    const disclaimer = `
    <section class="about-section about-section-disclaimer">
        <h3 class="about-section-title">
            ${ABOUT_ICON.alert}
            <span>${tBiHtml('Disclaimer', '免责声明')}</span>
        </h3>
        <div class="about-info-box about-info-disclaimer">
            <p><strong class="about-disclaimer-lead">${tBiHtml(
        'This is an unofficial community project and is not affiliated with, endorsed by, or associated with Google.',
        '本扩展为非官方社区开源项目，与 Google 没有任何关联或官方背书。',
    )}</strong> ${tBiHtml(
        'It acts strictly in read-only mode to visualize usage data. Use at your own risk.',
        '本工具仅以只读模式监控本地内部接口用于可视化个人日常数据，使用风险自负。',
    )}</p>
            <p>${tBiHtml(
        'Data is derived from undocumented internal interfaces that may change without notice. Metrics come from runtime call telemetry (Generator Metadata), checkpoint snapshots, or character-based heuristics, and all numbers are best-effort approximations.',
        '数据通过未公开文档且可能随时变更的内部接口获取。指标来自模型调用遥测（Generator Metadata）、检查点快照或字符启发式计算，所有数值均为尽力计算的近似值。',
    )}</p>
            <p><strong>${tBiHtml('Context Window Limitation:', '上下文窗口限制：')}</strong> ${tBiHtml(
        'Antigravity does not always expose the full advertised context window of every underlying model. Effective compression limits are determined dynamically by each model\'s checkpoint parameters, currently ranging from 80K up to 512K tokens (with 512K across Gemini 4 Neon, Carbon, Argon, Hydrogen, and Orchestrator Neon/Carbon/Argon models; 256K on Claude Opus/Sonnet 5.5 and Gemini 3.8 Flash).',
        'Antigravity 并非总是使用底层模型标称的完整上下文窗口。实际有效压缩上限由各模型的检查点（checkpoint）参数动态决定，当前范围从 80K 至最高 512K tokens（Gemini 4 Neon、Carbon、Argon、Hydrogen 与 Orchestrator Neon/Carbon/Argon 均为 512K；Claude Opus/Sonnet 5.5 与 Gemini 3.8 Flash 为 256K）。',
    )}</p>
        </div>
    </section>`;

    // ── Language hint ──
    const langHint = `
    <section class="about-section">
        <h3 class="about-section-title">
            ${ABOUT_ICON.globe}
            <span>${tBiHtml('Language', '语言')}</span>
        </h3>
        <div class="about-info-box about-info-lang">
            <p>${tBiHtml(
        'This extension supports Chinese, English, and Bilingual display. Use the 中文 | EN | Both controls in the top-right corner of this panel to switch.',
        '本插件支持中文、English 与双语显示。请使用面板右上角的 中文 | EN | 双语 按钮切换。',
    )}</p>
        </div>
    </section>`;

    return `<div class="about-page">${hero}${versionUpdates}${nav}${github}${acknowledgments}${tips}${compatibility}${disclaimer}${langHint}</div>`;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

export function getAboutTabStyles(): string {
    return `
/* ═══ About Tab (Studio Telemetry Ledger) ════════════════════════════════════ */

.about-page {
    max-width: 820px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding-top: 6px;
    min-width: 0;
}

/* Hero */
.about-hero {
    text-align: start;
    padding: 4px 0 8px;
    min-width: 0;
}

.about-hero-heading {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px 10px;
    margin-bottom: 8px;
}

.about-hero-title {
    margin: 0;
    color: var(--ed-ink);
    font-size: 1.5rem;
    font-weight: 550;
    line-height: 1.24;
    letter-spacing: -0.02em;
    min-width: 0;
}

.about-version-pill {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--ed-radius-pill);
    font-family: var(--ed-mono);
    font-size: 11.5px;
    font-weight: 600;
    line-height: 1.4;
    background: var(--ed-surface-well);
    color: var(--ed-ink-secondary);
    border: 1px solid var(--ed-border);
    font-variant-numeric: tabular-nums lining-nums;
}

.about-hero-subtitle {
    font-size: 0.875rem;
    color: var(--ed-ink-secondary);
    margin: 0;
    max-width: 65ch;
    line-height: 1.54;
}

/* Platform chips */
.about-platform-chips {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
}

.about-platform-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    border-radius: var(--ed-radius-pill);
    font-size: 12px;
    font-weight: 550;
    border: 1px solid var(--ed-border);
    color: var(--ed-ink-muted);
    background: var(--ed-surface-well);
    opacity: 1;
}

.about-platform-chip svg {
    flex-shrink: 0;
}

.about-platform-active {
    border-color: var(--ed-accent-border);
    color: var(--ed-accent);
    background: var(--ed-accent-tint);
    font-weight: 600;
}

.about-platform-note {
    font-size: 12px;
    color: var(--ed-ink-muted);
    margin: 10px 0 0;
    text-align: start;
    max-width: 65ch;
    line-height: 1.5;
}

/* Section */
.about-section {
    padding: 0;
    min-width: 0;
}

.about-section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: -0.012em;
    line-height: 1.35;
    color: var(--ed-ink);
    margin: 0 0 10px;
    text-transform: none;
}

.about-section-title svg {
    width: 16px;
    height: 16px;
    color: var(--ed-accent);
    flex-shrink: 0;
}

.about-section-disclaimer .about-section-title svg {
    color: var(--ed-danger);
}

/* Feature Navigation Cards (2-column responsive L1 grid) */
.about-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 10px;
}

.about-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--ed-radius-md);
    border: 1px solid var(--ed-border);
    background: var(--ed-surface);
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: var(--ed-ink);
    min-width: 0;
    transition: background var(--ed-dur-fast) var(--ed-ease),
        border-color var(--ed-dur-fast) var(--ed-ease),
        transform 100ms var(--ed-ease);
}

@media (hover: hover) {
    .about-card:hover {
        border-color: var(--ed-accent-border);
        background: var(--ed-surface-hover);
    }
}

.about-card:active {
    transform: scale(0.99);
}

.about-card:focus-visible {
    outline: 2px solid var(--ed-accent);
    outline-offset: 2px;
}

.about-card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    border-radius: var(--ed-radius-sm);
    background: var(--ed-surface-well);
    color: var(--ed-accent);
    border: 1px solid var(--ed-border);
}

.about-card-icon svg,
.about-card-icon .icon {
    width: 16px;
    height: 16px;
}

.about-card-body {
    flex: 1;
    min-width: 0;
}

.about-card-title {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
    line-height: 1.38;
    color: var(--ed-ink);
    margin-bottom: 3px;
}

.about-card-desc {
    display: block;
    font-size: 12px;
    color: var(--ed-ink-secondary);
    line-height: 1.5;
    overflow-wrap: anywhere;
}

body[data-lang="both"] .about-card-desc {
    display: block;
    -webkit-line-clamp: unset;
    overflow: visible;
}

body[data-lang="both"] .about-card-desc .bi-en {
    display: block;
}

body[data-lang="both"] .about-card-desc .bi-sep {
    display: none;
}

body[data-lang="both"] .about-card-desc .bi-zh {
    display: block;
    margin-top: 4px;
    font-size: 11.5px;
    line-height: 1.48;
    color: var(--ed-ink-muted);
}

.about-card-arrow {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--ed-ink-muted);
    transition: transform var(--ed-dur-fast) var(--ed-ease), color var(--ed-dur-fast) var(--ed-ease);
}

@media (hover: hover) {
    .about-card:hover .about-card-arrow {
        color: var(--ed-accent);
        transform: translateX(2px);
    }
}

/* Info panels (clean L1 cards, zero 3px colored left borders) */
.about-info-box {
    padding: 14px 16px;
    border-radius: var(--ed-radius-md);
    font-size: 0.8125rem;
    line-height: 1.56;
    color: var(--ed-ink-secondary);
    border: 1px solid var(--ed-border);
    background: var(--ed-surface);
    min-width: 0;
}

.about-info-box p {
    margin: 0 0 10px;
    max-width: 72ch;
}

.about-info-box p:last-child {
    margin-bottom: 0;
}

.about-info-box strong {
    color: var(--ed-ink);
    font-weight: 600;
}

.about-compat-lead {
    color: var(--ed-good);
}

.about-disclaimer-lead {
    color: var(--ed-danger);
}

/* Secondary GitHub Repository action button */
.about-github-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--ed-radius-sm);
    background: var(--ed-surface);
    border: 1px solid var(--ed-control-border);
    color: var(--ed-ink);
    font-size: 12.5px;
    font-weight: 550;
    text-decoration: none;
    transition: background var(--ed-dur-fast) var(--ed-ease),
        border-color var(--ed-dur-fast) var(--ed-ease),
        color var(--ed-dur-fast) var(--ed-ease);
}

@media (hover: hover) {
    .about-github-link:hover {
        background: var(--ed-surface-hover);
        border-color: var(--ed-ink-muted);
        color: var(--ed-ink);
    }
}

.about-github-link:focus-visible {
    outline: 2px solid var(--ed-accent);
    outline-offset: 2px;
}

.about-github-link .icon {
    width: 13px;
    height: 13px;
    color: var(--ed-accent);
    flex-shrink: 0;
}

/* Open-source community acknowledgments list */
.about-ack-list {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 7px;
}

.about-ack-item {
    font-size: 12px;
    line-height: 1.52;
    color: var(--ed-ink-secondary);
    overflow-wrap: anywhere;
    min-width: 0;
}

.about-ack-link {
    color: var(--ed-accent);
    font-weight: 550;
    text-decoration: underline;
    text-underline-offset: 2px;
    overflow-wrap: anywhere;
}

@media (hover: hover) {
    .about-ack-link:hover {
        color: var(--ed-accent-hover);
    }
}

.about-ack-link:focus-visible {
    outline: 2px solid var(--ed-accent);
    outline-offset: 2px;
    border-radius: 2px;
}

@media (prefers-reduced-motion: reduce) {
    .about-card,
    .about-card-arrow,
    .about-github-link {
        transition: none;
    }
}
`;
}

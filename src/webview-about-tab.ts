// ─── About Tab Content Builder ───────────────────────────────────────────────
// Builds HTML for the "About" tab: plugin overview, feature navigation cards,
// GitHub info, tips, and disclaimer — consolidated from the former topbar chips.

import { tBi } from './i18n';
import { ICON } from './webview-icons';
import { esc, tBiHtml } from './webview-helpers';

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
} as const;

// ─── Feature Card Definitions ────────────────────────────────────────────────

interface FeatureCard {
    tabId: string;
    icon: string;
    titleHtml: string;
    descriptionHtml: string;
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
                'Real-time model call analytics: per-call tokens, credits, cost, latency, error tracking, tool usage ranking, and context intelligence from Generator Metadata.',
                '实时模型调用分析：逐次调用的 Token、积分、费用、延迟、错误追踪、工具使用排行和上下文情报，全部来自 Generator Metadata。',
            ),
        },
        {
            tabId: 'chats',
            icon: ABOUT_ICON.chats,
            titleHtml: tBiHtml('Sessions', '会话'),
            descriptionHtml: tBiHtml(
                'Browse all AI conversations with quick access to Brain records, protobuf archives, and workspace folders.',
                '浏览与 AI 的全部对话，快速访问每个会话的 Brain 记录、Protobuf 存档和工作区文件夹。',
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
                'All available AI models and specifications: shared quota pools, reset schedules, compression and context limits, and thinking capabilities.',
                '所有可用 AI 模型及其规格：共享配额池、重置时间、压缩与上下文限制，以及思考能力参数。',
            ),
        },
        {
            tabId: 'calendar',
            icon: ABOUT_ICON.calendar,
            titleHtml: tBiHtml('Calendar', '日历'),
            descriptionHtml: tBiHtml(
                'Daily usage archive with interactive monthly calendar view recording total calls, tokens, credits, and archived cycles.',
                '每日用量归档与交互式月历视图，记录每日总调用、Token、积分和归档周期。',
            ),
        },
        {
            tabId: 'profile',
            icon: ABOUT_ICON.profile,
            titleHtml: tBiHtml('Profile', '个人'),
            descriptionHtml: tBiHtml(
                'Account identity with privacy mask, shared model quota pools, AI credits and expiry countdown, plus plan limits and capabilities.',
                '当前账户身份与隐私遮罩、共享模型配额池、AI 积分与到期倒计时，以及计划限制与功能配置。',
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

export function buildAboutTabContent(): string {
    const cards = getFeatureCards();

    // ── Hero section ──
    const hero = `
    <header class="about-hero">
        <div class="about-hero-heading">
            <h2 class="about-hero-title">${tBiHtml('Antigravity Context Window Monitor', 'Antigravity 上下文窗口监控')}</h2>
            <span class="about-version-pill">v1.17.2</span>
        </div>
        <p class="about-hero-subtitle">${tBiHtml(
        'An open-source community extension for real-time monitoring and analytics of AI model usage in Antigravity IDE.',
        '一款开源社区扩展，用于实时监控和分析 Antigravity IDE 中 AI 模型的使用情况。',
    )}</p>
        <div class="about-platform-chips" role="group" aria-label="${esc(tBi('Supported platforms', '支持的平台'))}">
            <span class="about-platform-chip about-platform-active" role="status" aria-label="${esc(tBi('IDE: actively supported', 'IDE：已支持'))}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                <span>${tBiHtml('IDE', 'IDE')}</span>
            </span>
            <span class="about-platform-chip" aria-label="${esc(tBi('Desktop: not supported', '桌面版：不支持'))}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><path d="M8 21h8"/><path d="M12 17v4"/><circle cx="12" cy="10" r="3"/></svg>
                <span>${tBiHtml('Desktop', '桌面版')}</span>
            </span>
            <span class="about-platform-chip" aria-label="${esc(tBi('SDK: not supported', 'SDK：不支持'))}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                <span>${tBiHtml('SDK', 'SDK')}</span>
            </span>
            <span class="about-platform-chip" aria-label="${esc(tBi('CLI: not supported', 'CLI：不支持'))}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
                <span>${tBiHtml('CLI', 'CLI')}</span>
            </span>
        </div>
        <p class="about-platform-note">${tBiHtml(
        'Designed for the Antigravity IDE platform. Desktop, SDK, and CLI are separate product lines and are not supported.',
        '本插件面向 Antigravity IDE 平台开发。桌面版、SDK 和 CLI 均为独立产品线，不在支持范围内。',
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
            <p><strong class="about-compat-lead">${tBiHtml('Verified for extension v1.17.2:', '扩展 v1.17.2 本次验证：')}</strong> ${tBiHtml(
        'Installed VSIX in Antigravity IDE 2.7.0 on macOS. This release adds Gemini 4 Neon (Low, Medium, High, Extra), Orchestrator (Neon), and the status bar Overview.',
        '在 macOS 的 Antigravity IDE 2.7.0 中安装 VSIX。本版新增 Gemini 4 Neon（低、中、高、超高）、Orchestrator (Neon) 和状态栏总览。',
    )}</p>
            <p><strong>${tBiHtml('Earlier contributor checks:', '此前贡献者验证版本：')}</strong> v1.18.4, v1.19.6, v1.20.6, v1.23.2.</p>
            <p>${tBiHtml(
        'Windows and Linux compatibility is covered by platform regression tests; native IDE validation is performed on macOS. Future IDE updates may change internal APIs. See the Disclaimer below for details.',
        'Windows 和 Linux 兼容性由平台回归测试覆盖；原生 IDE 验证环境为 macOS。未来 IDE 更新可能变更内部 API，详见下方免责声明。',
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
        'Data is derived from undocumented internal interfaces that may change without notice. Metrics come from Generator Metadata, checkpoint snapshots, or character-based heuristics, and all numbers are best-effort approximations.',
        '数据通过未公开文档且可能随时变更的内部接口获取。指标来自 Generator Metadata、检查点快照或字符启发式计算，所有数值均为尽力计算的近似值。',
    )}</p>
            <p><strong>${tBiHtml('Context Window Limitation:', '上下文窗口限制：')}</strong> ${tBiHtml(
        'Antigravity does not always expose the full advertised context window of every underlying model. Effective compression limits are determined dynamically by each model\'s checkpoint parameters, currently ranging from 80K up to 512K tokens (with 512K on Gemini 4 Neon and Orchestrator (Neon) models).',
        'Antigravity 并非总是使用底层模型标称的完整上下文窗口。实际有效压缩上限由各模型的检查点（checkpoint）参数动态决定，当前范围从 80K 至最高 512K tokens（Gemini 4 Neon 与 Orchestrator (Neon) 为 512K）。',
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

    return `<div class="about-page">${hero}${nav}${github}${tips}${compatibility}${disclaimer}${langHint}</div>`;
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

@media (prefers-reduced-motion: reduce) {
    .about-card,
    .about-card-arrow,
    .about-github-link {
        transition: none;
    }
}
`;
}

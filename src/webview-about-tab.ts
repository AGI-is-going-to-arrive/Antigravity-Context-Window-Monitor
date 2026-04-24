// ─── About Tab Content Builder ───────────────────────────────────────────────
// Builds HTML for the "About" tab: plugin overview, feature navigation cards,
// GitHub info, tips, and disclaimer — consolidated from the former topbar chips.

import { tBi } from './i18n';
import { ICON } from './webview-icons';

// ─── SVG Icons (About-specific) ──────────────────────────────────────────────

const ABOUT_ICON = {
    /** Lightning bolt — GM Data */
    gmdata: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
    /** Chat bubbles — Sessions */
    chats: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    /** Dollar — Cost */
    cost: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    /** CPU — Models */
    models: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
    /** Clock/gauge — Quota Tracking */
    quota: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    /** Calendar — Calendar */
    calendar: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    /** Person — Profile */
    profile: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    /** Gear — Settings */
    settings: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    /** Info circle */
    info: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    /** Alert triangle */
    alert: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    /** Globe */
    globe: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
} as const;

// ─── Feature Card Definitions ────────────────────────────────────────────────

interface FeatureCard {
    tabId: string;
    icon: string;
    color: string;        // CSS color for the accent
    title: string;
    description: string;
}

function getFeatureCards(): FeatureCard[] {
    return [
        {
            tabId: 'gmdata',
            icon: ABOUT_ICON.gmdata,
            color: 'var(--color-orange)',
            title: tBi('GM Data', 'GM 数据'),
            description: tBi(
                'Real-time model call analytics: per-call tokens, credits, cost, latency, error tracking, tool usage ranking, and context intelligence — all from Generator Metadata.',
                '实时模型调用分析：逐次调用的 Token、积分、费用、延迟、错误追踪、工具使用排行、上下文情报 —— 全部来自 Generator Metadata。',
            ),
        },
        {
            tabId: 'chats',
            icon: ABOUT_ICON.chats,
            color: 'var(--color-teal-light)',
            title: tBi('Sessions', '会话'),
            description: tBi(
                'Browse all conversations with the AI. Quick access to brain records, protobuf data, and workspace folders for each session.',
                '浏览与 AI 的全部对话。快速访问每个会话的 Brain 记录、Protobuf 数据和工作区文件夹。',
            ),
        },
        {
            tabId: 'pricing',
            icon: ABOUT_ICON.cost,
            color: 'var(--color-ok-light)',
            title: tBi('Cost', '成本'),
            description: tBi(
                'Estimated USD cost analysis per model, with monthly breakdown charts. Customize pricing per token type (input/output/cache/thinking).',
                '按模型估算 USD 费用，含月度分项柱状图。可自定义每种 Token 类型（输入/输出/缓存/思考）的单价。',
            ),
        },
        {
            tabId: 'models',
            icon: ABOUT_ICON.models,
            color: 'var(--color-ok)',
            title: tBi('Models', '模型'),
            description: tBi(
                'All available AI models and their configurations: quota pools, reset times, rate limits, and supported MIME types.',
                '所有可用 AI 模型及其配置：额度池、重置时间、速率限制、支持的 MIME 类型。',
            ),
        },
        {
            tabId: 'history',
            icon: ABOUT_ICON.quota,
            color: 'var(--color-amber-light)',
            title: tBi('Quota Tracking', '额度追踪'),
            description: tBi(
                'Track quota consumption across reset cycles. View historical usage sessions with per-model call counts and credential costs.',
                '跨重置周期追踪额度消耗。查看历史使用会话，含每模型调用次数和积分费用。',
            ),
        },
        {
            tabId: 'calendar',
            icon: ABOUT_ICON.calendar,
            color: 'var(--color-teal-light)',
            title: tBi('Calendar', '日历'),
            description: tBi(
                'Daily usage archive with heat-map calendar view. Each day records total calls, tokens, credits, and archived cycles.',
                '每日用量归档，热力图日历视图。每天记录总调用、Token、积分和归档周期。',
            ),
        },
        {
            tabId: 'profile',
            icon: ABOUT_ICON.profile,
            color: 'var(--color-muted)',
            title: tBi('Profile', '个人'),
            description: tBi(
                'Current account information, login status, and model API configuration details.',
                '当前账户信息、登录状态和模型 API 配置详情。',
            ),
        },
        {
            tabId: 'settings',
            icon: ABOUT_ICON.settings,
            color: 'var(--color-muted)',
            title: tBi('Settings', '设置'),
            description: tBi(
                'Plugin preferences: polling interval, status bar toggles, context limits, storage diagnostics, and data management.',
                '插件偏好：轮询间隔、状态栏开关、上下文限制、存储诊断和数据管理。',
            ),
        },
    ];
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function buildAboutTabContent(): string {
    const cards = getFeatureCards();

    // ── Hero section ──
    const hero = `
    <div class="about-hero">
        <div class="about-hero-icon">
            ${ICON.chart}
        </div>
        <h2 class="about-hero-title">Antigravity Context Window Monitor</h2>
        <p class="about-hero-subtitle">${tBi(
        'An open-source community plugin for real-time monitoring and analytics of AI model usage in Antigravity (Windsurf).',
        '一款开源社区插件，用于实时监控和分析 Antigravity (Windsurf) 中 AI 模型的使用情况。',
    )}</p>
    </div>`;

    // ── Feature navigation grid ──
    const cardItems = cards.map(c => `
        <button class="about-card" data-navigate-tab="${c.tabId}">
            <div class="about-card-icon" style="color:${c.color}">${c.icon}</div>
            <div class="about-card-body">
                <span class="about-card-title">${c.title}</span>
                <span class="about-card-desc">${c.description}</span>
            </div>
            <svg class="about-card-arrow" viewBox="0 0 16 16" width="14" height="14">
                <path fill="currentColor" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/>
            </svg>
        </button>`).join('');

    const nav = `
    <div class="about-section">
        <h3 class="about-section-title">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            ${tBi('Feature Navigation', '功能导航')}
        </h3>
        <div class="about-cards">${cardItems}</div>
    </div>`;

    // ── GitHub section ──
    const github = `
    <div class="about-section about-github">
        <h3 class="about-section-title">
            ${ICON.git}
            ${tBi('Open Source', '开源项目')}
        </h3>
        <div class="about-info-box about-info-github">
            <p>
                ${tBi(
        'By <strong>AGI-is-going-to-arrive</strong> — open-source on GitHub. If you find it helpful, a',
        '作者 <strong>AGI-is-going-to-arrive</strong> — 项目已在 GitHub 开源。如果觉得有帮助，点个',
    )}
                <span class="star-inline">${ICON.star}</span>
                ${tBi('would be appreciated.', '就是最大的支持。')}
                <span class="heart-inline">${ICON.heart}</span>
            </p>
            <a class="about-github-link" href="https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor" target="_blank" rel="noopener noreferrer">
                ${ICON.externalLink} GitHub Repository
            </a>
        </div>
    </div>`;

    // ── Tips section ──
    const tips = `
    <div class="about-section">
        <h3 class="about-section-title">
            ${ABOUT_ICON.info}
            ${tBi('Tips', '使用提示')}
        </h3>
        <div class="about-info-box about-info-tips">
            <p>${tBi(
        'Recommended: use a single IDE window. Multi-window setups may cause data desync between instances (e.g. activity timeline, quota tracking).',
        '建议使用单窗口运行。多窗口可能导致实例间数据不同步（如活动时间线、额度追踪等）。',
    )}</p>
        </div>
    </div>`;

    // ── Disclaimer section ──
    const disclaimer = `
    <div class="about-section">
        <h3 class="about-section-title">
            ${ABOUT_ICON.alert}
            ${tBi('Disclaimer', '免责声明')}
        </h3>
        <div class="about-info-box about-info-disclaimer">
            ${tBi(
        '<p><strong>This is an unofficial community project and is not affiliated with, endorsed by, or associated with Google.</strong> It acts strictly in read-only mode to visualize usage data. Use at your own risk.</p><p>Data is derived from <strong>internal interfaces that are undocumented and may change without notice</strong>. Items marked with a <strong style="color:var(--color-ok)">GM</strong> badge come from Generator Metadata and have <strong>higher per-call fidelity</strong>. Other metrics are derived from checkpoint snapshots or character-based heuristics. <strong>All numbers are best-effort approximations.</strong></p><p><strong>Context Window Limitation:</strong> Antigravity does not utilize the full context window advertised by the underlying model. The effective context is roughly <strong>128K–200K tokens</strong>.</p>',
        '<p><strong>本分支扩展为非官方社区开源项目，与 Google 没有任何关联或官方背书。</strong>本工具仅以只读模式监控本地内部 API 用于可视化个人日常数据，使用风险自负。</p><p>数据通过<strong>内部接口</strong>获取，这些接口<strong>未公开文档且可能随时变更</strong>。标有 <strong style="color:var(--color-ok)">GM</strong> 徽章的数据来自 Generator Metadata，<strong>单次调用精度较高</strong>。其余指标基于检查点快照或字符启发式计算。<strong>所有数值均为尽力计算的近似值。</strong></p><p><strong>上下文窗口限制：</strong>Antigravity 并未适配底层模型标称的完整上下文窗口，实际有效上下文大致为 <strong>128K–200K Token</strong>。</p>',
    )}
        </div>
    </div>`;

    // ── Language hint ──
    const langHint = `
    <div class="about-section">
        <h3 class="about-section-title">
            ${ABOUT_ICON.globe}
            ${tBi('Language', '语言')}
        </h3>
        <div class="about-info-box about-info-lang">
            <p>${tBi(
        'This extension supports <strong>Chinese / English / Bilingual</strong> display. Use the <strong>中文 | EN | 双语</strong> buttons in the top-right corner of this panel to switch.',
        '本插件支持 <strong>中文 / English / 双语</strong> 显示。请使用面板右上角的 <strong>中文 | EN | 双语</strong> 按钮切换。',
    )}</p>
        </div>
    </div>`;

    return hero + nav + github + tips + disclaimer + langHint;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

export function getAboutTabStyles(): string {
    return `
/* ═══ About Tab ═══════════════════════════════════════════════════════════════ */

/* Hero */
.about-hero {
    text-align: center;
    padding: var(--space-6) var(--space-4) var(--space-4);
}
.about-hero-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 56px; height: 56px;
    border-radius: 16px;
    background: linear-gradient(135deg, rgba(255,160,40,0.15), rgba(255,120,20,0.08));
    border: 1px solid rgba(255,160,40,0.25);
    margin-bottom: var(--space-3);
}
.about-hero-icon .icon {
    width: 28px; height: 28px;
    color: var(--color-orange);
}
.about-hero-title {
    font-size: 1.15em;
    font-weight: 700;
    margin: 0 0 var(--space-2);
    letter-spacing: -0.01em;
}
.about-hero-subtitle {
    font-size: 0.82em;
    color: var(--color-muted);
    margin: 0;
    max-width: 420px;
    margin-inline: auto;
    line-height: 1.55;
}

/* Section */
.about-section {
    padding: 0 var(--space-4) var(--space-4);
}
.about-section-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.82em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-muted);
    margin: 0 0 var(--space-3);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-color);
}
.about-section-title svg {
    opacity: 0.65;
    flex-shrink: 0;
}

/* Feature Navigation Cards */
.about-cards {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.about-card {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 10px 12px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
    background: var(--card-bg);
    cursor: pointer;
    transition: all 0.18s ease;
    text-align: left;
    font: inherit;
    color: inherit;
}
.about-card:hover {
    border-color: var(--color-orange);
    background: rgba(255,160,40,0.04);
    transform: translateX(2px);
}
.about-card:active {
    transform: translateX(2px) scale(0.995);
}
.about-card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px; height: 36px;
    flex-shrink: 0;
    border-radius: 10px;
    background: rgba(128,128,128,0.08);
    transition: background 0.18s;
}
.about-card:hover .about-card-icon {
    background: rgba(255,160,40,0.1);
}
.about-card-body {
    flex: 1;
    min-width: 0;
}
.about-card-title {
    display: block;
    font-size: 0.85em;
    font-weight: 600;
    margin-bottom: 2px;
}
.about-card-desc {
    display: block;
    font-size: 0.73em;
    color: var(--color-muted);
    line-height: 1.45;
}
.about-card-arrow {
    flex-shrink: 0;
    color: var(--color-muted);
    opacity: 0;
    transform: translateX(-4px);
    transition: all 0.18s ease;
}
.about-card:hover .about-card-arrow {
    opacity: 0.6;
    transform: translateX(0);
}

/* Info boxes (shared) */
.about-info-box {
    padding: 12px 14px;
    border-radius: var(--radius-md);
    font-size: 0.8em;
    line-height: 1.6;
    border: 1px solid var(--border-color);
    background: var(--card-bg);
}
.about-info-box p {
    margin: 0 0 var(--space-2);
}
.about-info-box p:last-child {
    margin-bottom: 0;
}

/* GitHub */
.about-info-github {
    border-left: 3px solid var(--color-ok);
}
.about-info-github .star-inline .icon {
    color: #f59e0b;
    width: 13px; height: 13px;
    vertical-align: -1px;
}
.about-info-github .heart-inline .icon {
    color: #ef4444;
    width: 12px; height: 12px;
    vertical-align: -1px;
}
.about-github-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: var(--space-2);
    padding: 5px 12px;
    border-radius: var(--radius-sm);
    background: rgba(74,222,128,0.1);
    border: 1px solid rgba(74,222,128,0.2);
    color: var(--color-ok-light);
    font-size: 0.9em;
    font-weight: 500;
    text-decoration: none;
    transition: all 0.15s;
}
.about-github-link:hover {
    background: rgba(74,222,128,0.18);
    border-color: rgba(74,222,128,0.35);
}
.about-github-link .icon {
    width: 12px; height: 12px;
}

/* Tips */
.about-info-tips {
    border-left: 3px solid var(--color-amber-light);
}

/* Disclaimer */
.about-info-disclaimer {
    border-left: 3px solid var(--vscode-editorError-foreground, #f14c4c);
}
.about-info-disclaimer strong:first-child {
    color: var(--vscode-editorError-foreground, #f14c4c);
}

/* Language */
.about-info-lang {
    border-left: 3px solid var(--color-info-light);
}

/* ═══ Light theme overrides ═══════════════════════════════════════════════════ */
[data-vscode-theme-kind="vscode-light"] .about-hero-icon {
    background: linear-gradient(135deg, rgba(255,140,20,0.12), rgba(255,100,0,0.06));
}
[data-vscode-theme-kind="vscode-light"] .about-card:hover {
    background: rgba(255,140,20,0.06);
}
[data-vscode-theme-kind="vscode-light"] .about-card-icon {
    background: rgba(0,0,0,0.04);
    --color-ok-light: #16a34a;
    --color-ok: #15803d;
    --color-teal-light: #0d9488;
    --color-amber-light: #d97706;
    --color-orange: #ea580c;
    --color-muted: #64748b;
    --color-info-light: #2563eb;
}
[data-vscode-theme-kind="vscode-light"] .about-card:hover .about-card-icon {
    background: rgba(255,140,20,0.08);
}
[data-vscode-theme-kind="vscode-light"] .about-info-github {
    border-left-color: #16a34a;
    background: rgba(22,163,74,0.04);
}
[data-vscode-theme-kind="vscode-light"] .about-github-link {
    color: #15803d;
    background: rgba(22,163,74,0.08);
    border-color: rgba(22,163,74,0.3);
}
[data-vscode-theme-kind="vscode-light"] .about-github-link:hover {
    background: rgba(22,163,74,0.14);
    border-color: rgba(22,163,74,0.45);
}
[data-vscode-theme-kind="vscode-light"] .about-info-tips {
    border-left-color: #d97706;
}
[data-vscode-theme-kind="vscode-light"] .about-info-disclaimer {
    border-left-color: #dc2626;
}
[data-vscode-theme-kind="vscode-light"] .about-info-lang {
    border-left-color: #2563eb;
}
`;
}

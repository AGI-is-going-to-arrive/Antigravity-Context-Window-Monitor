// ─── About Tab Content Builder ───────────────────────────────────────────────
// Streamlined About utility view: single-source version, update checks, 6-tab IA
// navigation, objective compliance summary, community credits, and disclaimer.

import { resolveRuntimeVersion } from './core/version';
import { tBi, tHtml } from './i18n-core';
import { buildUpdateStatusPillHtml, type UpdateStatusView } from './webview-settings-tab';
import { ICON } from './webview-icons';
import { esc, richTipBiAttrs as aboutRichTipAttrs, tBiHtml } from './webview-helpers';

export interface AboutTabOptions {
    surface?: 'ide' | 'app-sidecar' | 'app';
    updateStatus?: UpdateStatusView | null;
    now?: number;
}

const ABOUT_ICON = {
    gmdata: ICON.bolt,
    chats: ICON.chat,
    models: ICON.database,
    calendar: ICON.clock,
    settings: ICON.windows,
    grid: ICON.windows,
    alert: ICON.shield,
    shieldCheck: ICON.shield,
    heart: ICON.heart,
} as const;

interface FeatureCard {
    tabId: string;
    icon: string;
    titleHtml: string;
    descriptionHtml: string;
}

const FEATURE_CARDS_CATALOG = `overview\tnav.overview\tLive context breakdown, dual limits, Swarm tracking strip, quota pools, and Handoff v2.\t实时上下文构成、双上限标注、多智能体跟踪、配额池与交接指令 v2。
gm\tnav.modelCalls\tModel call analytics from runtime call telemetry (Generator Metadata): anomaly filters, Decode/E2E speed, TTFT, 5m cache TTL, and timeline.\t基于模型调用遥测（Generator Metadata）的实时分析：异常筛选、解码/E2E 速度、首字延迟、5 分钟缓存 TTL 与活动时间线。
sessions\tnav.sessions\tBrowse conversations & Swarm trees with local session records (Brain), conversation archives (.pb / Protobuf), and workspace links.\t浏览会话与多智能体树，访问本地会话记录（Brain）、会话存档（.pb / Protobuf）与工作区目录。
calendar\tnav.usageCost\tDaily heatmap, workspace leaderboard, USD & 10-currency API reference pricing, Swarm group costs, and Markdown/CSV/JSON exports.\t活动热力图、工作区项目榜、官方 USD 与 10 币种参考费用、多智能体组费用与 Markdown/CSV/JSON 导出。
models\tnav.modelsQuotas\tAccount status with privacy mask, 5h/7d quota pools, weekly active-hours forecast, orchestrator settings, and zero-day model specs.\t账号隐私遮罩、5h/7d 配额池、周活跃时长节奏预测、编排设置与零日新模型参数。
settings\tnav.settings\tDisplay & language, telemetry modes, 10-currency pricing, opt-in CDP overlays & launcher, ~/.gemini/GEMINI.md Global Rules editor, and allowlisted JSON backup/diagnostics.\t显示与语言、遥测口径、10 币种费用、可选 CDP 悬浮层与启动器、~/.gemini/GEMINI.md 全局规则编辑，以及白名单设置备份与脱敏诊断包。`;

function getFeatureCards(): FeatureCard[] {
    const iconByTab: Record<string, string> = {
        overview: ICON.chart,
        gm: ABOUT_ICON.gmdata,
        sessions: ABOUT_ICON.chats,
        calendar: ABOUT_ICON.calendar,
        models: ABOUT_ICON.models,
        settings: ABOUT_ICON.settings,
    };
    return FEATURE_CARDS_CATALOG.split('\n').map(line => {
        const [tabId, titleKey, en, zh] = line.split('\t');
        return { tabId, icon: iconByTab[tabId], titleHtml: tHtml(titleKey), descriptionHtml: tBiHtml(en, zh) };
    });
}

const ACK_PROJECTS_CATALOG = `dimitr-io/antigravity-desktop-context\thttps://github.com/dimitr-io/antigravity-desktop-context\tAUX_PANE workflow, dot-matrix & /context report ideas.\tAUX_PANE、点阵视图与 /context 报告灵感。
benedictusrey/Antigravity-Monitor\thttps://github.com/benedictusrey/Antigravity-Monitor\tQuota visualization reference.\t配额可视化参考。
elviscjn-cjn/antigravity-context-viewer\thttps://github.com/elviscjn-cjn/antigravity-context-viewer\tDesktop telemetry UX & turn/cache visualization.\t桌面端遥测交互与轮次/缓存可视化思路。
yuhuan-dev/antigravity-usage-monitor\thttps://github.com/yuhuan-dev/antigravity-usage-monitor\tZero-dep Sidecar & Lock to Main Agent concept.\t零依赖 Sidecar 与锁定主会话思路。
ahmetdotsh/agy-context\thttps://github.com/ahmetdotsh/agy-context\tDual-cap clarity, bar/matrix toggle & ETag ideas.\t双上限标注、条形/点阵切换与 ETag 灵感。
arthurcavallari/antigravity-context-monitor\thttps://github.com/arthurcavallari/antigravity-context-monitor\tLargest-items inspection & custom-* isolation.\t最大占用项排查与自定义模型隔离思路。
Lumidarin/agy-capsule\thttps://github.com/Lumidarin/agy-capsule\tCompact desktop capsule & composer ring inspiration.\t桌面胶囊与输入框悬浮环设计启发。
evenluo/agy-pulse\thttps://github.com/evenluo/agy-pulse\tMulti-period activity pulse heatmap inspiration.\t多周期活动热力图设计启发。
jule-x/antigravity-context-monitor\thttps://github.com/jule-x/antigravity-context-monitor\tCold/Partial/Warm cache classification & +Δ diagnostics.\t冷启动/部分/热缓存分类与净增量诊断思路。
bocai991/antigravity-quota-meter\thttps://github.com/bocai991/antigravity-quota-meter\tAUX_PANE + SIDEBAR mounting & quota runway.\t双入口挂载与配额续航预测思路。
@gitstq (PR #78)\thttps://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/78\tImplemented the Settings editor for viewing, locating and saving ~/.gemini/GEMINI.md in the App and IDE.\t实现了 App 与 IDE 的全局规则编辑器，可在设置中查看、定位和保存 ~/.gemini/GEMINI.md。
@GHTGXL (Issue #79)\thttps://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/issues/79\tReported repeated Windows Sidecar out-of-memory crashes on a 2,500+ step conversation and an EBUSY update failure, with logs and suggested fixes.\t报告 Windows 上超过 2,500 步的会话触发 Sidecar 循环内存溢出及更新时的 EBUSY 错误，提供了日志和修复建议。`;

export function buildAboutTabContent(version = resolveRuntimeVersion(), options?: AboutTabOptions): string {
    const cards = getFeatureCards();
    const normalizedVersion = typeof version === 'string' && version.trim() ? version.trim() : resolveRuntimeVersion();
    const versionTag = normalizedVersion.startsWith('v') ? normalizedVersion : `v${normalizedVersion}`;
    const { pillHtml } = buildUpdateStatusPillHtml(normalizedVersion, options?.updateStatus, 'about');

    const hero = `
    <header class="about-hero">
        <div class="about-hero-heading">
            <h2 class="about-hero-title">${tBiHtml('Antigravity Context Window Monitor', 'Antigravity 上下文窗口监控')}</h2>
            <span class="about-version-pill">${esc(versionTag)}</span>
            ${pillHtml}
            <button type="button" class="about-action-btn" data-navigate-tab="updates">${tBiHtml('Version & Updates', '版本与更新')}</button>
        </div>
        <p class="about-hero-subtitle">${tBiHtml(
        'Open-source read-only context, quota, Swarm, and model-call monitor for Antigravity IDE and Antigravity App.',
        '开源只读上下文、配额、多智能体与模型调用监控工具，支持 Antigravity IDE 与 Antigravity App。',
    )}</p>
        <div class="about-platform-chips" role="group" aria-label="${esc(tBi('Supported platforms', '支持的平台'))}">
            <span class="about-platform-chip about-platform-active" role="status" aria-label="${esc(tBi('Antigravity IDE: actively supported', 'Antigravity IDE：已支持'))}"${aboutRichTipAttrs('about-platform-ide', 'Antigravity IDE (VSIX)', 'Antigravity IDE（VSIX 扩展）', 'Standard VSIX extension with status bar and full webview dashboard.', '标准 VSIX 扩展，提供状态栏监控与完整面板。')}><span>${tBiHtml('Antigravity IDE', 'Antigravity IDE')}</span></span>
            <span class="about-platform-chip about-platform-active" role="status" aria-label="${esc(tBi('Antigravity App (Desktop 2.0+ Sidecar): actively supported', 'Antigravity App（桌面版 2.0+ 侧边插件 (Sidecar)）：已支持'))}"${aboutRichTipAttrs('about-platform-app', 'Antigravity App (Sidecar)', 'Antigravity App（侧边插件 (Sidecar)）', 'Official zero-patch Sidecar plugin (AUX_PANE + SIDEBAR + optional CDP overlays).', '官方零魔改侧边插件 (Sidecar)，支持辅助栏、主侧栏与可选 CDP 悬浮层。')}><span>${tBiHtml('Antigravity App (Desktop 2.0+ Sidecar)', 'Antigravity App（桌面版 2.0+ Sidecar）')}</span></span>
            <span class="about-platform-chip" role="status" aria-label="${esc(tBi('SDK: runtime plugin not supported', 'SDK：不支持运行时插件'))}"${aboutRichTipAttrs('about-platform-sdk', 'SDK (Not Supported)', 'SDK（暂不支持）', 'Programmatic SDK integrations have no monitor UI host.', 'SDK 属程序化接口产品线，无监控面板宿主。')}><span>SDK</span></span>
            <span class="about-platform-chip" role="status" aria-label="${esc(tBi('CLI: optional read-only statusLine & local CLI usage logs', 'CLI：支持可选只读 statusLine 与本地 CLI 用量日志'))}"${aboutRichTipAttrs('about-platform-cli', 'CLI (Logs & Optional statusLine)', 'CLI（历史日志与可选 statusLine）', 'No standalone CLI UI plugin; Usage & Cost reads local CLI usage logs and bundles an opt-in read-only agy statusLine script.', '无独立 CLI 面板插件；「用量与费用」可读取本地 CLI 用量日志，并提供可选只读 agy statusLine 脚本。')}><span>CLI</span></span>
        </div>
        <p class="about-platform-note">${tBiHtml(
        'Supports Antigravity IDE (VSIX), Antigravity App (official Sidecar), and local CLI usage logs + opt-in read-only agy statusLine.',
        '支持 Antigravity IDE（VSIX）、Antigravity App（官方侧边插件 (Sidecar)），以及本地 CLI 用量日志与可选只读 agy statusLine。',
    )}</p>
    </header>`;

    const cardItems = cards.map(c => `
        <button type="button" class="about-card" data-navigate-tab="${c.tabId}">
            <span class="about-card-icon">${c.icon}</span>
            <span class="about-card-body">
                <span class="about-card-title">${c.titleHtml}</span>
                <span class="about-card-desc">${c.descriptionHtml}</span>
            </span>
            <svg class="about-card-arrow" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/></svg>
        </button>`).join('');

    const nav = `
    <section class="about-section">
        <h3 class="about-section-title">${ABOUT_ICON.grid} <span>${tBiHtml('Feature Navigation', '功能导航')}</span></h3>
        <div class="about-cards">${cardItems}</div>
    </section>`;

    const compliance = `
    <section class="about-section" data-about-compliance="true">
        <h3 class="about-section-title">${ABOUT_ICON.shieldCheck} <span>${tBiHtml('Architecture & Technical Boundaries', '架构与技术边界')}</span></h3>
        <div class="about-info-box about-info-compat">
            <p>${tBiHtml(
        'Zero host binary or app.asar modification; zero runtime npm dependencies; strictly read-only loopback telemetry; no OAuth credential extraction, multi-account switching, or external telemetry transmission.',
        '零宿主二进制或 app.asar 修改、零运行时外部 npm 依赖、严格本机回环只读遥测；不提取 OAuth 凭据、不切换账号、不向外网上传任何遥测数据。',
    )}</p>
            <p>${tBiHtml(
        `Runtime version ${versionTag} (resolved from single-source manifest). Optional CDP overlays mount read-only Shadow DOM widgets only when the user explicitly enables CDP.`,
        `当前运行时版本 ${versionTag}（来自单一事实源清单）。可选 CDP 悬浮层仅在用户显式启用调试端口时挂载只读 Shadow DOM 组件。`,
    )}</p>
            <a class="about-github-link" data-action="openExternalUrl" data-url="https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor" href="https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor" target="_blank" rel="noopener noreferrer">${ICON.externalLink} <span>${tBiHtml('GitHub Repository (MIT)', 'GitHub 开源仓库（MIT）')}</span></a>
        </div>
    </section>`;

    const ackItems = ACK_PROJECTS_CATALOG.split('\n').map(line => {
        const [label, href, en, zh] = line.split('\t');
        return `<li class="about-ack-item"><a class="about-ack-link" data-action="openExternalUrl" data-url="${esc(href)}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a> — <span class="about-ack-desc">${tBiHtml(en, zh)}</span></li>`;
    }).join('');

    const acknowledgments = `
    <section class="about-section about-acks">
        <h3 class="about-section-title">${ABOUT_ICON.heart} <span>${tBiHtml('Acknowledgments', '致谢')}</span></h3>
        <div class="about-info-box about-info-acks">
            <p>${tBiHtml(
        'Thanks to the Antigravity community for implementation work, bug reports and design ideas.',
        '感谢 Antigravity 社区贡献代码、反馈问题并分享设计思路。',
    )}</p>
            <ul class="about-ack-list">${ackItems}</ul>
        </div>
    </section>`;

    const disclaimer = `
    <section class="about-section about-section-disclaimer">
        <h3 class="about-section-title">${ABOUT_ICON.alert} <span>${tBiHtml('Disclaimer', '免责声明')}</span></h3>
        <div class="about-info-box about-info-disclaimer">
            <p><strong class="about-disclaimer-lead">${tBiHtml(
        'Unofficial community project, not affiliated with or endorsed by Google.',
        '非官方社区开源项目，与 Google 无任何关联或官方背书。',
    )}</strong> ${tBiHtml(
        'Metrics come from local internal telemetry interfaces and represent best-effort approximations. USD API reference costs do not represent actual subscription billing.',
        '指标来自本地内部遥测接口，均为尽力计算的近似值；USD API 参考费用不代表实际订阅账单。',
    )}</p>
            <p><strong>${tBiHtml('Context Window Limitation:', '上下文窗口限制：')}</strong> ${tBiHtml(
        'Gemini 4 Neon, Carbon, Argon, and Hydrogen (incl. Extra High tiers) and Orchestrator Neon/Carbon/Argon use platform compaction limits (e.g. 512K) that may sit below the native model ceiling.',
        'Gemini 4 Neon、Carbon、Argon 与 Hydrogen（含 Extra High 档位）及 Orchestrator Neon/Carbon/Argon 存在平台自动压缩上限（如 512K），可能低于原生窗口上限。',
    )}</p>
        </div>
    </section>`;

    return `<div class="about-page">${hero}${nav}${compliance}${acknowledgments}${disclaimer}</div>`;
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

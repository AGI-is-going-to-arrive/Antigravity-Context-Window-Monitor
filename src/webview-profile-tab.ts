// ─── Profile Tab Content Builder ─────────────────────────────────────────────
// Builds HTML for the "Profile" tab: Account info, Model quota grid,
// Plan limits, Feature flags, Team config — with deep-mined data supplements.

import { tBi } from './i18n';
import { ModelConfig, UserStatusInfo } from './models';
import { ICON } from './webview-icons';
import { esc } from './webview-helpers';

// ─── MIME Category Helpers ───────────────────────────────────────────────────

interface MimeCategory {
    icon: string;
    label: string;
    labelZh: string;
    count: number;
}

function formatCreditTypeLabel(creditType: string): string {
    const key = creditType.replace('CREDIT_TYPE_', '');
    const labelMap: Record<string, [string, string]> = {
        PROMPT: ['Prompt Credits', 'Prompt 额度'],
        FLOW: ['Flow Credits', 'Flow 额度'],
        GOOGLE_AI: ['Google AI Credits', 'Google AI 额度'],
        GOOGLE_AI_STUDIO: ['Google AI Studio Credits', 'Google AI Studio 额度'],
    };
    const mapped = labelMap[key];
    return mapped ? tBi(mapped[0], mapped[1]) : key.replace(/_/g, ' ');
}

function categorizeMimeTypes(mimeTypes: string[]): MimeCategory[] {
    let docs = 0, code = 0, images = 0, media = 0;
    for (const m of mimeTypes) {
        if (m.startsWith('image/')) { images++; }
        else if (m.startsWith('video/') || m.startsWith('audio/')) { media++; }
        else if (
            m.includes('javascript') || m.includes('typescript') ||
            m.includes('python') || m.includes('ipynb')
        ) { code++; }
        else { docs++; }
    }
    const cats: MimeCategory[] = [];
    if (docs > 0)   { cats.push({ icon: docIcon,   label: 'Docs',  labelZh: '文档', count: docs }); }
    if (code > 0)   { cats.push({ icon: codeIcon,  label: 'Code',  labelZh: '代码', count: code }); }
    if (images > 0) { cats.push({ icon: imgIcon,   label: 'Image', labelZh: '图片', count: images }); }
    if (media > 0)  { cats.push({ icon: mediaIcon, label: 'Media', labelZh: '音视频', count: media }); }
    return cats;
}

// Inline SVG micro-icons (12×12)
const docIcon = '<svg class="mime-icon" viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.414A2 2 0 0 0 13.414 3L11 .586A2 2 0 0 0 9.586 0zm5.5 1.5v2a1 1 0 0 0 1 1h2zM4.5 8a.5.5 0 0 1 0-1h7a.5.5 0 0 1 0 1zm0 2a.5.5 0 0 1 0-1h7a.5.5 0 0 1 0 1zm0 2a.5.5 0 0 1 0-1h4a.5.5 0 0 1 0 1z"/></svg>';
const codeIcon = '<svg class="mime-icon" viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 8zm4.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L13.293 8z"/></svg>';
const imgIcon = '<svg class="mime-icon" viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/><path fill="currentColor" d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z"/></svg>';
const mediaIcon = '<svg class="mime-icon" viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M6.79 5.093A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814z"/><path fill="currentColor" d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm15 0a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1z"/></svg>';

// ─── Public API ──────────────────────────────────────────────────────────────

/** Build the complete Profile tab HTML. */
export function buildProfileContent(
    userInfo: UserStatusInfo | null,
    configs: ModelConfig[],
): string {
    if (!userInfo) {
        return `
            <section class="card empty">
                <h2>${ICON.user} ${tBi('Profile', '个人')}</h2>
                <p class="empty-desc">${tBi(
                    'Waiting for user data from LS...',
                    '等待 LS 用户数据...',
                )}</p>
            </section>`;
    }

    // Sort models by LS recommended order if available
    const sortedConfigs = sortModels(configs, userInfo.modelSortOrder);

    return [
        buildAccountSection(userInfo),
        buildModelQuotaGrid(sortedConfigs),
        buildLimitsSection(userInfo),
        buildFeaturesAndTeamSection(userInfo),
    ].join('');
}

// ─── Model Sort ──────────────────────────────────────────────────────────────

function sortModels(configs: ModelConfig[], sortOrder: string[]): ModelConfig[] {
    if (!sortOrder || sortOrder.length === 0) { return configs; }
    const orderMap = new Map(sortOrder.map((label, i) => [label, i]));
    return [...configs].sort((a, b) => {
        const aIdx = orderMap.get(a.label) ?? 999;
        const bIdx = orderMap.get(b.label) ?? 999;
        return aIdx - bIdx;
    });
}

// ─── Section Builders ────────────────────────────────────────────────────────

function buildAccountSection(userInfo: UserStatusInfo): string {
    const tierMap: Record<string, { bg: string; color: string }> = {
        'TEAMS_TIER_FREE': { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af' },
        'TEAMS_TIER_PRO': { bg: 'rgba(74,222,128,0.15)', color: 'var(--color-ok)' },
        'TEAMS_TIER_TEAMS': { bg: 'rgba(96,165,250,0.15)', color: 'var(--color-info)' },
        'TEAMS_TIER_ENTERPRISE_SAAS': { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af' },
        'TEAMS_TIER_PRO_ULTIMATE': { bg: 'rgba(250,204,21,0.15)', color: 'var(--color-warn)' },
    };
    const tier = tierMap[userInfo.teamsTier] || tierMap['TEAMS_TIER_PRO'];
    const maskedEmail = userInfo.email.replace(/^(.{2}).*(@.*)$/, '$1****$2');

    const promptPct = userInfo.monthlyPromptCredits > 0
        ? Math.round((userInfo.availablePromptCredits / userInfo.monthlyPromptCredits) * 100) : 0;
    const flowPct = userInfo.monthlyFlowCredits > 0
        ? Math.round((userInfo.availableFlowCredits / userInfo.monthlyFlowCredits) * 100) : 0;
    const promptBarColor = promptPct <= 10 ? 'var(--color-danger)' : promptPct <= 30 ? 'var(--color-warn)' : 'var(--color-ok)';
    const flowBarColor = flowPct <= 10 ? 'var(--color-danger)' : flowPct <= 30 ? 'var(--color-warn)' : 'var(--color-info)';

    // Subscription hint
    const subHint = userInfo.upgradeSubscriptionText
        ? `<div class="subscription-hint">${esc(userInfo.upgradeSubscriptionText)}</div>` : '';

    // Google AI Credits inline
    const validCredits = userInfo.availableCredits.filter(c => c.creditAmount > 0);
    const creditsHtml = validCredits.length > 0
        ? `<div class="gai-credits">${validCredits.map(c => {
            const typeName = formatCreditTypeLabel(c.creditType);
            return `<div class="gai-credit-item">
                        <span class="gai-label">${esc(typeName)}</span>
                        <span class="gai-value">${c.creditAmount.toLocaleString()}</span>
                    </div>`;
        }).join('')}</div>` : '';

    return `
        <section class="card">
            <h2>
                ${ICON.user}
                ${tBi('Account', '账户')}
                <span class="tier-badge" style="background:${tier.bg};color:${tier.color}">${esc(userInfo.planName)}</span>
                ${userInfo.userTierName ? `<span class="tier-badge tier-sub" style="background:rgba(255,255,255,0.06);color:var(--color-text-dim)">${esc(userInfo.userTierName)}</span>` : ''}
                <button class="privacy-btn" id="privacyToggle" aria-label="${tBi('Toggle privacy mask', '切换隐私遮罩')}">${ICON.shield}</button>
            </h2>
            <div class="account-info">
                <span class="account-name" data-real="${esc(userInfo.name)}" data-masked="${esc(userInfo.name.charAt(0))}***">${esc(userInfo.name)}</span>
                <span class="account-email" data-real="${esc(userInfo.email)}" data-masked="${esc(maskedEmail)}">${esc(userInfo.email)}</span>
            </div>
            <p class="privacy-hint">${tBi(
                'Privacy mask is ON by default. Click the shield button above to reveal sensitive data.',
                '隐私遮罩默认开启。点击上方 🛡️ 按钮可显示/隐藏真实信息。',
            )}</p>
            ${userInfo.defaultModelLabel ? `<div class="default-model">${tBi('Default Model', '默认模型')}: <strong>${esc(userInfo.defaultModelLabel)}</strong></div>` : ''}
            ${subHint}
            <div class="credits-section">
                <div class="credit-row">
                    <div class="credit-header">
                        <span>${tBi('Prompt Credits', 'Prompt 额度')}</span>
                        <span>${userInfo.availablePromptCredits.toLocaleString()} / ${userInfo.monthlyPromptCredits.toLocaleString()}</span>
                    </div>
                    <div class="credit-bar-wrap">
                        <div class="credit-bar" style="width:${promptPct}%;background:${promptBarColor}"></div>
                    </div>
                </div>
                <div class="credit-row">
                    <div class="credit-header">
                        <span>${tBi('Flow Credits', 'Flow 额度')}</span>
                        <span>${userInfo.availableFlowCredits.toLocaleString()} / ${userInfo.monthlyFlowCredits.toLocaleString()}</span>
                    </div>
                    <div class="credit-bar-wrap">
                        <div class="credit-bar" style="width:${flowPct}%;background:${flowBarColor}"></div>
                    </div>
                </div>
            </div>
            ${creditsHtml}
        </section>`;
}

function buildModelQuotaGrid(configs: ModelConfig[]): string {
    const quotaModels = configs.filter(c => c.quotaInfo);
    if (quotaModels.length === 0) { return ''; }

    const cards = quotaModels.map((c, idx) => {
        const qi = c.quotaInfo!;
        const pct = Math.round(qi.remainingFraction * 100);
        const barColor = pct <= 20 ? 'var(--color-danger)' : pct < 80 ? 'var(--color-warn)' : 'var(--color-ok)';

        let resetLabel = '';
        if (qi.resetTime) {
            try {
                const d = new Date(qi.resetTime);
                resetLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } catch { resetLabel = ''; }
        }

        // Tag badge (e.g. "New")
        const tagBadge = c.tagTitle
            ? `<span class="model-tag-badge">${esc(c.tagTitle)}</span>` : '';

        // MIME category chips
        const mimeCategories = categorizeMimeTypes(c.supportedMimeTypes);
        const mimeChipsHtml = mimeCategories.length > 0
            ? `<div class="mime-chips">${mimeCategories.map(cat =>
                `<span class="mime-chip">${cat.icon} ${cat.count}</span>`
            ).join('')}</div>`
            : `<div class="mime-chips"><span class="mime-chip mime-chip-none">${tBi('No file upload', '不支持文件')}</span></div>`;

        // Full MIME list (collapsible)
        let mimeDetailsHtml = '';
        if (c.supportedMimeTypes.length > 0) {
            const mimeTags = c.supportedMimeTypes.map(m => `<span class="mime-tag">${esc(m)}</span>`).join('');
            mimeDetailsHtml = `
                <details class="collapsible inline-details" id="d-mime-${idx}">
                    <summary>${tBi('All MIME Types', '所有 MIME 类型')} (${c.supportedMimeTypes.length})</summary>
                    <div class="details-body"><div class="mime-tags-wrap">${mimeTags}</div></div>
                </details>`;
        }

        return `
            <div class="model-card">
                <div class="model-card-header">
                    <span class="model-card-name">${esc(c.label)}${tagBadge}</span>
                    <span class="model-card-pct" style="color:${barColor}">${pct}%</span>
                </div>
                <div class="quota-bar-wrap">
                    <div class="quota-bar" style="width:${pct}%;background:${barColor}"></div>
                </div>
                <div class="model-card-meta">
                    ${mimeChipsHtml}
                    ${resetLabel ? `<span class="model-card-reset">${tBi('Reset', '重置')} ${resetLabel}</span>` : ''}
                </div>
                <div class="quota-id">${esc(c.model)}</div>
                ${mimeDetailsHtml}
            </div>`;
    }).join('');

    return `
        <section class="card">
            <h2>${ICON.bolt} ${tBi('Model Quota', '模型配额')}</h2>
            <div class="model-grid">
                ${cards}
            </div>
        </section>`;
}

function buildLimitsSection(userInfo: UserStatusInfo): string {
    const fmtLimit = (v: number): string => v === -1 ? '∞' : v.toLocaleString();
    const pl = userInfo.planLimits;
    const limitsRows = [
        [tBi('Max Input Tokens', '最大输入'), fmtLimit(pl.maxNumChatInputTokens)],
        [tBi('Premium Messages', '高级消息数'), fmtLimit(pl.maxNumPremiumChatMessages)],
        [tBi('Custom Instructions', '自定义指令'), tBi(
            `${fmtLimit(pl.maxCustomChatInstructionCharacters)} chars`,
            `${fmtLimit(pl.maxCustomChatInstructionCharacters)} 字符`,
        )],
        [tBi('Pinned Context', '固定上下文'), fmtLimit(pl.maxNumPinnedContextItems)],
        [tBi('Local Index', '本地索引'), fmtLimit(pl.maxLocalIndexSize)],
        [tBi('Flex Credits', 'Flex 额度'), tBi(
            `${pl.monthlyFlexCreditPurchaseAmount.toLocaleString()} / mo`,
            `${pl.monthlyFlexCreditPurchaseAmount.toLocaleString()} /月`,
        )],
    ].map(([k, v]) => `<div class="detail-row"><span>${k}</span><span>${v}</span></div>`).join('');

    return `
        <section class="card">
            <details class="collapsible" id="d-limits">
                <summary>${ICON.shield} ${tBi('Plan Limits', '计划限制')}</summary>
                <div class="details-body">${limitsRows}</div>
            </details>
        </section>`;
}

function buildFeaturesAndTeamSection(userInfo: UserStatusInfo): string {
    // Feature flags
    const allFeatures: { label: string; enabled: boolean }[] = [
        { label: tBi('Web Search', '网页搜索'), enabled: userInfo.cascadeWebSearchEnabled },
        { label: tBi('Browser', '浏览器'), enabled: userInfo.browserEnabled },
        { label: tBi('Knowledge Base', '知识库'), enabled: userInfo.knowledgeBaseEnabled },
        { label: tBi('Commit Msg', '提交信息'), enabled: userInfo.canGenerateCommitMessages },
        { label: tBi('Auto Run', '自动执行'), enabled: userInfo.cascadeCanAutoRunCommands },
        { label: tBi('Background', '后台'), enabled: userInfo.canAllowCascadeInBackground },
        { label: tBi('Buy Credits', '购买额度'), enabled: userInfo.canBuyMoreCredits },
        { label: tBi('Fast Autocomplete', '快速补全'), enabled: userInfo.hasAutocompleteFastMode },
        { label: tBi('Sticky Premium', '锁定高级'), enabled: userInfo.allowStickyPremiumModels },
        { label: tBi('Command Models', '命令模型'), enabled: userInfo.allowPremiumCommandModels },
        { label: tBi('Tab Jump', 'Tab 跳转'), enabled: userInfo.hasTabToJump },
        { label: tBi('Custom Icon', '自定义图标'), enabled: userInfo.canCustomizeAppIcon },
    ];
    const featureTags = allFeatures.map(f =>
        `<span class="feature-tag${f.enabled ? ' enabled' : ''}">${f.label}</span>`
    ).join('');

    // Team config
    const tc = userInfo.teamConfig;
    const teamTags = [
        { label: tBi('MCP Servers', 'MCP 服务'), enabled: tc.allowMcpServers },
        { label: tBi('Auto Run Cmd', '自动执行命令'), enabled: tc.allowAutoRunCommands },
        { label: tBi('Browser Experimental', '浏览器实验'), enabled: tc.allowBrowserExperimentalFeatures },
    ].map(f => `<span class="feature-tag${f.enabled ? ' enabled' : ''}">${f.label}</span>`).join('');

    return `
        <section class="card">
            <details class="collapsible" id="d-features">
                <summary>${ICON.bolt} ${tBi('Features & Team', '功能与团队')}</summary>
                <div class="details-body">
                    <div class="section-subtitle">${tBi('Feature Flags', '功能开关')}</div>
                    <div class="feature-tags">${featureTags}</div>
                    <div class="section-subtitle" style="margin-top:var(--space-3)">${tBi('Team Config', '团队配置')}</div>
                    <div class="feature-tags">${teamTags}</div>
                </div>
            </details>
        </section>`;
}

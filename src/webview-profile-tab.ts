// ─── Profile Tab Content Builder ─────────────────────────────────────────────
// Builds HTML for the "Profile" tab: Account info, Plan limits, Feature flags,
// Team config, Google AI credits, and detailed model quota progress bars.

import { tBi } from './i18n';
import { ModelConfig, UserStatusInfo } from './models';
import { ICON } from './webview-icons';
import { esc } from './webview-helpers';

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

    return [
        buildAccountSection(userInfo),
        buildQuotaDetailSection(configs),
        buildLimitsSection(userInfo),
        buildFeaturesSection(userInfo),
        buildTeamSection(userInfo),
        buildCreditsSection(userInfo),
    ].join('');
}

// ─── Section Builders ────────────────────────────────────────────────────────

function buildAccountSection(userInfo: UserStatusInfo): string {
    const tierMap: Record<string, { bg: string; color: string }> = {
        'TEAMS_TIER_FREE': { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af' },
        'TEAMS_TIER_PRO': { bg: 'rgba(74,222,128,0.15)', color: 'var(--color-ok)' },
        'TEAMS_TIER_TEAMS': { bg: 'rgba(96,165,250,0.15)', color: 'var(--color-info)' },
        'TEAMS_TIER_ENTERPRISE_SAAS': { bg: 'rgba(192,132,252,0.15)', color: '#c084fc' },
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

    return `
        <section class="card">
            <h2>
                ${ICON.user}
                ${tBi('Account', '账户')}
                <span class="tier-badge" style="background:${tier.bg};color:${tier.color}">${esc(userInfo.planName)}</span>
                ${userInfo.userTierName ? `<span class="tier-badge tier-sub" style="background:rgba(192,132,252,0.12);color:#c084fc">${esc(userInfo.userTierName)}</span>` : ''}
                <button class="privacy-btn" id="privacyToggle" aria-label="Toggle privacy mask">${ICON.shield}</button>
            </h2>
            <div class="account-info">
                <span class="account-name" data-real="${esc(userInfo.name)}" data-masked="${esc(userInfo.name.charAt(0))}***">${esc(userInfo.name)}</span>
                <span class="account-email" data-real="${esc(userInfo.email)}" data-masked="${esc(maskedEmail)}">${esc(userInfo.email)}</span>
            </div>
            ${userInfo.defaultModelLabel ? `<div class="default-model">${tBi('Default Model', '默认模型')}: <strong>${esc(userInfo.defaultModelLabel)}</strong></div>` : ''}
            <div class="credits-section">
                <div class="credit-row">
                    <div class="credit-header">
                        <span>Prompt Credits</span>
                        <span>${userInfo.availablePromptCredits.toLocaleString()} / ${userInfo.monthlyPromptCredits.toLocaleString()}</span>
                    </div>
                    <div class="credit-bar-wrap">
                        <div class="credit-bar" style="width:${promptPct}%;background:${promptBarColor}"></div>
                    </div>
                </div>
                <div class="credit-row">
                    <div class="credit-header">
                        <span>Flow Credits</span>
                        <span>${userInfo.availableFlowCredits.toLocaleString()} / ${userInfo.monthlyFlowCredits.toLocaleString()}</span>
                    </div>
                    <div class="credit-bar-wrap">
                        <div class="credit-bar" style="width:${flowPct}%;background:${flowBarColor}"></div>
                    </div>
                </div>
            </div>
        </section>`;
}

function buildQuotaDetailSection(configs: ModelConfig[]): string {
    const quotaModels = configs.filter(c => c.quotaInfo);
    if (quotaModels.length === 0) { return ''; }

    const quotaRows = quotaModels.map((c, idx) => {
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
        const tagHtml = c.tagTitle ? `<span class="badge info-badge">${esc(c.tagTitle)}</span>` : '';
        const imgTag = c.supportsImages ? `<span class="badge ok-badge">${ICON.image} IMG</span>` : '';
        const recTag = c.isRecommended ? `<span class="badge rec-badge">${ICON.star} REC</span>` : '';
        const mimeTag = c.mimeTypeCount > 0 ? `<span class="mime-count">${c.mimeTypeCount} MIME</span>` : '';

        let mimeDetailsHtml = '';
        if (c.supportedMimeTypes.length > 0) {
            const mimeTags = c.supportedMimeTypes.map(m => `<span class="mime-tag">${esc(m)}</span>`).join('');
            mimeDetailsHtml = `
                    <details class="collapsible inline-details" id="d-mime-${idx}">
                        <summary>${tBi('MIME Types', 'MIME 类型')} (${c.supportedMimeTypes.length})</summary>
                        <div class="details-body"><div class="mime-tags-wrap">${mimeTags}</div></div>
                    </details>`;
        }

        return `
                <div class="quota-row">
                    <div class="quota-label">${esc(c.label)} ${tagHtml} ${imgTag} ${recTag}</div>
                    <div class="quota-bar-wrap">
                        <div class="quota-bar" style="width:${pct}%;background:${barColor}"></div>
                    </div>
                    <div class="quota-meta">
                        <span class="quota-pct">${pct}%</span>
                        <span>${mimeTag}</span>
                        ${resetLabel ? `<span class="quota-reset">${tBi('Reset', '重置')}: ${resetLabel}</span>` : ''}
                    </div>
                    <div class="quota-id">${esc(c.model)}</div>
                    ${mimeDetailsHtml}
                </div>`;
    }).join('');

    return `
        <section class="card">
            <h2>${ICON.bolt} ${tBi('Model Quota', '模型配额')}</h2>
            ${quotaRows}
        </section>`;
}

function buildLimitsSection(userInfo: UserStatusInfo): string {
    const fmtLimit = (v: number): string => v === -1 ? '∞' : v.toLocaleString();
    const pl = userInfo.planLimits;
    const limitsRows = [
        [tBi('Max Input Tokens', '最大输入'), fmtLimit(pl.maxNumChatInputTokens)],
        [tBi('Premium Messages', '高级消息数'), fmtLimit(pl.maxNumPremiumChatMessages)],
        [tBi('Custom Instructions', '自定义指令'), `${fmtLimit(pl.maxCustomChatInstructionCharacters)} chars`],
        [tBi('Pinned Context', '固定上下文'), fmtLimit(pl.maxNumPinnedContextItems)],
        [tBi('Local Index', '本地索引'), fmtLimit(pl.maxLocalIndexSize)],
        [tBi('Flex Credits', 'Flex 额度'), `${pl.monthlyFlexCreditPurchaseAmount.toLocaleString()} / mo`],
    ].map(([k, v]) => `<div class="detail-row"><span>${k}</span><span>${v}</span></div>`).join('');

    return `
        <section class="card">
            <details class="collapsible" id="d-limits">
                <summary>${ICON.shield} ${tBi('Plan Limits', '计划限制')}</summary>
                <div class="details-body">${limitsRows}</div>
            </details>
        </section>`;
}

function buildFeaturesSection(userInfo: UserStatusInfo): string {
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

    return `
        <section class="card">
            <details class="collapsible" id="d-features">
                <summary>${ICON.bolt} ${tBi('Feature Flags', '功能开关')}</summary>
                <div class="details-body"><div class="feature-tags">${featureTags}</div></div>
            </details>
        </section>`;
}

function buildTeamSection(userInfo: UserStatusInfo): string {
    const tc = userInfo.teamConfig;
    const teamTags = [
        { label: tBi('MCP Servers', 'MCP 服务'), enabled: tc.allowMcpServers },
        { label: tBi('Auto Run Cmd', '自动执行命令'), enabled: tc.allowAutoRunCommands },
        { label: tBi('Browser Experimental', '浏览器实验'), enabled: tc.allowBrowserExperimentalFeatures },
    ].map(f => `<span class="feature-tag${f.enabled ? ' enabled' : ''}">${f.label}</span>`).join('');

    return `
        <section class="card">
            <details class="collapsible" id="d-team">
                <summary>${ICON.user} ${tBi('Team Config', '团队配置')}</summary>
                <div class="details-body"><div class="feature-tags">${teamTags}</div></div>
            </details>
        </section>`;
}

function buildCreditsSection(userInfo: UserStatusInfo): string {
    if (userInfo.availableCredits.length === 0) { return ''; }

    const creditRows = userInfo.availableCredits.map(c => {
        const typeName = c.creditType.replace('CREDIT_TYPE_', '').replace(/_/g, ' ');
        return `<div class="detail-row">
                <span>${typeName}</span>
                <span>${c.creditAmount.toLocaleString()} (min: ${c.minimumCreditAmountForUsage})</span>
            </div>`;
    }).join('');

    return `
        <section class="card">
            <details class="collapsible" id="d-credits">
                <summary>${ICON.bolt} ${tBi('Google AI Credits', 'Google AI 额度')}</summary>
                <div class="details-body">${creditRows}</div>
            </details>
        </section>`;
}

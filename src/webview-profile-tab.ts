// ─── Profile Tab Content Builder ─────────────────────────────────────────────
// Builds HTML for the "Profile" tab: Account info, plan limits,
// and feature/team config. Model-specific content is rendered in Models tab.

import { tBi } from './i18n';
import { ModelConfig, UserStatusInfo } from './models';
import { formatResetAbsolute, formatResetCountdown } from './reset-time';
import { ICON } from './webview-icons';
import { esc } from './webview-helpers';

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
        buildLimitsSection(userInfo),
        buildEnvironmentSection(userInfo),
        buildFeatureAndTeamGrid(userInfo),
    ].join('');
}

// ─── Model Sort ──────────────────────────────────────────────────────────────

export function sortModels(configs: ModelConfig[], sortOrder: string[]): ModelConfig[] {
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
        'CLOUD_TIER_FREE': { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af' },
        'CLOUD_TIER_STANDARD': { bg: 'rgba(74,222,128,0.15)', color: 'var(--color-ok)' },
        'CLOUD_TIER_PRO': { bg: 'rgba(74,222,128,0.15)', color: 'var(--color-ok)' },
        'CLOUD_TIER_ULTRA': { bg: 'rgba(250,204,21,0.15)', color: 'var(--color-warn)' },
        'CLOUD_TIER_UNKNOWN': { bg: 'rgba(96,165,250,0.15)', color: 'var(--color-info)' },
    };
    const tier = tierMap[userInfo.teamsTier] || tierMap['CLOUD_TIER_UNKNOWN'];
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
    const displaySecondaryLabel = userInfo.planDetailName || userInfo.userTierName;
    const planSourceNote = userInfo.planSource === 'cloud'
        ? `<p class="raw-desc">${esc(tBi(
            `Cloud verified plan: ${userInfo.cloudTierName || userInfo.planName}. LS compatibility tier: ${userInfo.lsPlanName || '-'} / ${userInfo.lsTeamsTier || '-'}.`,
            `云端校验计划：${userInfo.cloudTierName || userInfo.planName}。LS 兼容层级：${userInfo.lsPlanName || '-'} / ${userInfo.lsTeamsTier || '-'}。`,
        ))}</p>`
        : userInfo.planSource === 'cloud-cache'
            ? `<p class="raw-desc">${esc(tBi(
                `Showing the last cloud-verified plan: ${userInfo.cloudTierName || userInfo.planName}. Current poll fell back to LS compatibility tier ${userInfo.lsPlanName || '-'} / ${userInfo.lsTeamsTier || '-'}.`,
                `当前展示的是上次云端校验成功的计划：${userInfo.cloudTierName || userInfo.planName}。本轮轮询已退回 LS 兼容层级 ${userInfo.lsPlanName || '-'} / ${userInfo.lsTeamsTier || '-'}。`,
            ))}</p>`
            : `<p class="raw-desc">${esc(tBi(
                `Plan is currently coming from LS compatibility data: ${userInfo.lsPlanName || userInfo.planName} / ${userInfo.lsTeamsTier || userInfo.teamsTier}. Cloud verification is unavailable in this poll.`,
                `当前计划来自 LS 兼容层数据：${userInfo.lsPlanName || userInfo.planName} / ${userInfo.lsTeamsTier || userInfo.teamsTier}。本轮未拿到云端校验结果。`,
            ))}</p>`;

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
                ${displaySecondaryLabel ? `<span class="tier-badge tier-sub" style="background:rgba(255,255,255,0.06);color:var(--color-text-dim)">${esc(displaySecondaryLabel)}</span>` : ''}
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
            ${planSourceNote}
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

export function buildModelQuotaGrid(configs: ModelConfig[]): string {
    const quotaModels = configs.filter(c => c.quotaInfo);
    if (quotaModels.length === 0) { return ''; }

    const cards = quotaModels.map((c) => {
        const qi = c.quotaInfo!;
        const pct = Math.round(qi.remainingFraction * 100);
        const barColor = pct <= 20 ? 'var(--color-danger)' : pct < 80 ? 'var(--color-warn)' : 'var(--color-ok)';

        let resetLabel = '';
        if (qi.resetTime) {
            const countdown = formatResetCountdown(qi.resetTime);
            const absolute = formatResetAbsolute(qi.resetTime);
            resetLabel = countdown ? `${countdown} · ${absolute}` : absolute;
        }

        // Tag badge (e.g. "New")
        const tagBadge = c.tagTitle
            ? `<span class="model-tag-badge">${esc(c.tagTitle)}</span>` : '';

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
                    ${resetLabel ? `<span class="model-card-reset">${tBi('Reset', '重置')} ${resetLabel}</span>` : ''}
                </div>
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

export function buildDefaultModelCard(userInfo: UserStatusInfo | null): string {
    if (!userInfo?.defaultModelLabel) { return ''; }
    return `
        <section class="card">
            <h2>${ICON.bolt} ${tBi('Default Model', '默认模型')}</h2>
            <div class="default-model">${tBi('Current default', '当前默认')}: <strong>${esc(userInfo.defaultModelLabel)}</strong></div>
            ${userInfo.planDescription
                ? `<p class="raw-desc">${esc(userInfo.planDescription)}</p>`
                : ''}
        </section>`;
}

function buildLimitsSection(userInfo: UserStatusInfo): string {
    const fmtLimit = (v: number): string => v === -1 ? '∞' : v.toLocaleString();
    const pl = userInfo.planLimits;
    const limitCards = [
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
    ].map(([k, v]) => `
        <div class="profile-metric-card">
            <span class="profile-metric-label">${k}</span>
            <span class="profile-metric-value">${v}</span>
        </div>`).join('');

    return `
        <section class="card">
            <h2>${ICON.shield} ${tBi('Plan Limits', '计划限制')}</h2>
            <div class="profile-metric-grid">${limitCards}</div>
        </section>`;
}

function buildFeatureAndTeamGrid(userInfo: UserStatusInfo): string {
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
        <div class="profile-two-col">
            <section class="card profile-panel-card">
                <h2>${ICON.bolt} ${tBi('Feature Flags', '功能开关')}</h2>
                <div class="profile-chip-grid">${featureTags}</div>
            </section>
            <section class="card profile-panel-card">
                <h2>${ICON.shield} ${tBi('Team Config', '团队配置')}</h2>
                <div class="profile-chip-grid">${teamTags}</div>
            </section>
        </div>`;
}

function buildEnvironmentSection(userInfo: UserStatusInfo): string {
    const envItems: [string, string][] = [];
    if (userInfo.ideVersion) {
        envItems.push([tBi('IDE Version', 'IDE 版本'), esc(userInfo.ideVersion)]);
    }
    if (userInfo.installationId) {
        const short = userInfo.installationId.length > 12
            ? userInfo.installationId.substring(0, 12) + '\u2026'
            : userInfo.installationId;
        envItems.push([tBi('Installation ID', '安装 ID'), `<span title="${esc(userInfo.installationId)}">${esc(short)}</span>`]);
    }
    if (userInfo.regionCode) {
        envItems.push([tBi('Region', '地区'), esc(userInfo.regionCode)]);
    }
    envItems.push([
        tBi('Anthropic Models', 'Anthropic 模型'),
        userInfo.hasAnthropicModelAccess
            ? `<span style="color:var(--color-ok)">\u2713</span>`
            : `<span style="color:var(--color-text-dim)">\u2717</span>`,
    ]);
    envItems.push([
        tBi('Cloud Project', '云端项目'),
        userInfo.hasCloudProject
            ? `<span style="color:var(--color-ok)">\u2713</span>`
            : `<span style="color:var(--color-text-dim)">\u2717</span>`,
    ]);

    if (envItems.length === 0) { return ''; }

    const grid = envItems.map(([k, v]) => `
        <div class="profile-metric-card">
            <span class="profile-metric-label">${k}</span>
            <span class="profile-metric-value">${v}</span>
        </div>`).join('');

    return `
        <section class="card">
            <h2>${ICON.bolt} ${tBi('Environment', '环境')}</h2>
            <div class="profile-metric-grid">${grid}</div>
        </section>`;
}

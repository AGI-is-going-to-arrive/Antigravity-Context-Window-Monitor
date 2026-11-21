// ─── Profile Tab Content Builder ─────────────────────────────────────────────
// Builds HTML for the "Profile" tab: Account info, shared model quota pools,
// AI credits & expiry day, and collapsible plan limits / feature / team config.

import { currentAICredits } from './account-credits';
import { formatNumber, getLanguage, tBi } from './i18n';
import { formatQuotaWindowPercent } from './monitor-overview';
import { ModelConfig, UserStatusInfo, type QuotaWindowSummary, type UserQuotaSummary } from './models';
import { formatResetAbsolute, formatResetCountdown } from './reset-time';
import { ICON } from './webview-icons';
import { esc, tBiHtml } from './webview-helpers';
import { getDaysUntilBillingDay } from './billing-day';
import { groupModelQuotas, type QuotaEffort } from './model-quota';

export interface ModelQuotaGridOptions {
    embedded?: boolean;
    hideHeading?: boolean;
    quotaSummary?: UserQuotaSummary | null;
}

function formatCreditTypeLabelHtml(creditType: string): string {
    const key = creditType.trim().toUpperCase().replace(/^CREDIT_TYPE_/, '');
    const labelMap: Record<string, readonly [string, string]> = {
        GOOGLE_ONE_AI: ['Google AI credits', 'Google AI 积分'],
        GOOGLE_AI: ['Google AI credits', 'Google AI 积分'],
        GOOGLE_AI_STUDIO: ['Google AI Studio credits', 'Google AI Studio 积分'],
    };
    const mapped = Object.hasOwn(labelMap, key) ? labelMap[key] : undefined;
    if (mapped) { return tBiHtml(mapped[0], mapped[1]); }
    return key ? esc(key.replace(/_/g, ' ')) : tBiHtml('Balance', '余额');
}

function formatModelTagTitle(title: string): { plain: string; html: string } {
    const known: Record<string, readonly [string, string]> = {
        Fast: ['Fast', '快速'],
        New: ['New', '新'],
        Preview: ['Preview', '预览'],
        Beta: ['Beta', '测试'],
        'Limited time': ['Limited time', '限时'],
        Notice: ['Notice', '提示'],
    };
    const mapped = Object.hasOwn(known, title) ? known[title] : undefined;
    return mapped
        ? { plain: tBi(mapped[0], mapped[1]), html: tBiHtml(mapped[0], mapped[1]) }
        : { plain: title, html: esc(title) };
}

function creditExpiryHtml(days: number | null): string {
    if (days === null || !Number.isFinite(days) || days < 0) {
        return tBiHtml('Expiry date not set', '未设置到期日');
    }
    if (days === 0) {
        return tBiHtml('Expires today', '今日到期');
    }
    return tBiHtml(days === 1 ? 'Expires in 1 day' : `Expires in ${days} days`, `${days} 天后到期`);
}


// ─── Public API ──────────────────────────────────────────────────────────────

/** Build the complete Profile tab HTML. */
export function buildProfileContent(
    userInfo: UserStatusInfo | null,
    configs: ModelConfig[],
    billingDay?: number,
    quotaSummary?: UserQuotaSummary | null,
): string {
    if (!userInfo) {
        return `
            <section class="card empty">
                <h2>${ICON.user} <span>${tBiHtml('Profile', '个人')}</span></h2>
                <p class="empty-desc">${tBiHtml(
            'Waiting for user data from LS...',
            '等待 LS 用户数据...',
        )}</p>
            </section>`;
    }

    const sortedConfigs = sortModels(configs, userInfo.modelSortOrder);
    const quota = buildModelQuotaGrid(sortedConfigs, { embedded: true, quotaSummary });
    return `
        <div class="profile-page">
            ${buildAccountSection(userInfo)}
            <div class="profile-body-grid">
                <section class="profile-quota" aria-labelledby="profile-quota-heading">
                    <header class="profile-section-header">
                        <h2 id="profile-quota-heading">${tBiHtml('Model quota', '模型配额')}</h2>
                        <button type="button" class="overview-action" data-overview-target="models"><span>${tBiHtml('View models', '查看模型')}</span> ${ICON.externalLink}</button>
                    </header>
                    ${quota || `<p class="empty-msg">${tBiHtml('Waiting for model quota data.', '等待模型配额数据。')}</p>`}
                </section>
                ${buildCreditSection(userInfo, billingDay)}
            </div>
            <details id="profile-plan-details" class="profile-technical">
                <summary><span>${tBiHtml('Plan limits and capabilities', '计划限制与功能配置')}</span></summary>
                <div class="profile-technical-body">${buildLimitsSection(userInfo)}${buildFeatureAndTeamGrid(userInfo)}</div>
            </details>
        </div>`;
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
    const maskedName = userInfo.name ? `${userInfo.name.charAt(0)}***` : '***';
    const maskedEmail = userInfo.email.replace(/^(.{2}).*(@.*)$/, '$1****$2');
    const plan = [...new Set([userInfo.planName, userInfo.userTierName].filter(Boolean))].join(' · ');
    return `
        <header class="profile-identity">
            <div>
                <h2>${tBiHtml('Account', '账户')}</h2>
                <div class="account-info">
                    <span class="account-name" data-real="${esc(userInfo.name)}" data-masked="${esc(maskedName)}">${esc(maskedName)}</span>
                    <span class="account-email" data-real="${esc(userInfo.email)}" data-masked="${esc(maskedEmail)}">${esc(maskedEmail)}</span>
                </div>
                ${plan ? `<p class="profile-plan-name">${esc(plan)}</p>` : ''}
            </div>
            <button type="button" class="privacy-btn active" id="privacyToggle" aria-label="${esc(tBi('Toggle privacy mask', '切换隐私遮罩'))}" aria-pressed="true">
                ${ICON.shield}<span>${tBiHtml('Privacy mask', '隐私遮罩')}</span>
            </button>
        </header>`;
}

function buildCreditSection(userInfo: UserStatusInfo, billingDay?: number): string {
    const day = billingDay || 0;
    const credits = currentAICredits(userInfo.availableCredits || []);
    const readings = credits.length ? credits : [{ creditType: '', creditAmount: null }];
    const expiryHtml = creditExpiryHtml(getDaysUntilBillingDay(day));
    return `
        <section class="profile-ai" aria-labelledby="profile-ai-heading">
            <header class="profile-section-header">
                <h2 id="profile-ai-heading">${tBiHtml('AI credits', 'AI 积分')}</h2>
                <a class="profile-activity" href="https://antigravity.google/g1-activity" target="_blank" rel="noopener noreferrer"><span>${tBiHtml('Credit activity', '积分记录')}</span> ${ICON.externalLink}</a>
            </header>
            <dl class="profile-credit-balances">
                ${readings.map(c => `<div class="profile-credit-balance">
                    <dt>${c.creditType ? formatCreditTypeLabelHtml(c.creditType) : tBiHtml('Balance', '余额')}</dt>
                    <dd class="gai-value${c.creditAmount === null ? ' is-unreported' : ''}">${c.creditAmount === null ? tBiHtml('Not reported', '未上报') : esc(formatNumber(c.creditAmount))}</dd>
                </div>`).join('')}
            </dl>
            <label class="billing-day-label" for="profileBillingDayInput">${tBiHtml('Monthly credits expiry day', '每月积分到期日')}</label>
            <div class="billing-day-input-group">
                <div class="num-spinner">
                    <button type="button" class="num-spinner-btn decrement" aria-label="${esc(tBi('Decrease day', '减小日期'))}">−</button>
                    <input type="number" id="profileBillingDayInput" class="threshold-input"
                        data-email="${esc(userInfo.email || '')}" value="${day}" min="0" max="31" step="1" />
                    <button type="button" class="num-spinner-btn increment" aria-label="${esc(tBi('Increase day', '增大日期'))}">+</button>
                </div>
                <button type="button" class="action-btn" id="profileBillingDaySaveBtn"><span>${tBiHtml('Save', '保存')}</span></button>
            </div>
            <p class="profile-expiry">${expiryHtml} · ${tBiHtml('Use 0 to turn off the countdown.', '填 0 可关闭倒计时。')}</p>
            <span id="profileBillingDayFeedback" class="threshold-feedback" role="status"></span>
        </section>`;
}

function quotaEffortLabel(effort: QuotaEffort): string {
    return { low: tBi('Low', '低'), medium: tBi('Medium', '中'), high: tBi('High', '高'), xhigh: tBi('Extra High', '超高') }[effort];
}

function quotaEffortsHtml(efforts: QuotaEffort[]): string {
    return tBiHtml(
        efforts.map(e => ({ low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High' })[e]).join(' · '),
        efforts.map(e => ({ low: '低', medium: '中', high: '高', xhigh: '超高' })[e]).join(' · '),
    );
}

function quotaResetLabel(resetTime: string, precise = false): string {
    const countdown = formatResetCountdown(resetTime);
    const absolute = formatResetAbsolute(resetTime, { includeSeconds: precise });
    return countdown ? `${countdown} · ${absolute}` : absolute;
}

function quotaPercentage(fraction: number): string {
    return new Intl.NumberFormat(getLanguage() === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 8 }).format(fraction * 100);
}

function renderDualWindowBar(groupLabel: string, kind: '5h' | 'weekly', win: QuotaWindowSummary): string {
    const labelHtml = kind === '5h' ? tBiHtml('5-Hour', '5 小时') : tBiHtml('Weekly', '每周');
    const labelPlain = kind === '5h' ? tBi('5-Hour', '5 小时') : tBi('Weekly', '每周');
    const rawFrac = win.remainingFraction;
    const frac = typeof rawFrac === 'number' && Number.isFinite(rawFrac) && rawFrac >= 0 && rawFrac <= 1 ? rawFrac : null;
    const pct = frac === null ? null : Number((frac * 100).toFixed(8));
    const barTone = pct === null ? '' : pct <= 20 ? 'is-attention' : pct < 50 ? 'is-warn' : 'is-healthy';
    const barColor = pct === null ? '' : pct <= 20 ? 'var(--ed-danger-fill)'
        : pct < 50 ? 'var(--ed-warn-fill)' : 'var(--ed-good-fill)';
    const pctPlain = frac === null ? tBi('Unknown', '未知') : formatQuotaWindowPercent(frac);
    const pctHtml = frac === null ? `<span class="is-unknown">${tBiHtml('Unknown', '未知')}</span>` : esc(pctPlain);
    const parsedReset = win.resetTime ? Date.parse(win.resetTime) : Number.NaN;
    const resetHtml = win.resetTime && Number.isFinite(parsedReset) && parsedReset > 0
        ? `${tBiHtml('Reset', '重置')} ${esc(quotaResetLabel(win.resetTime))}`
        : tBiHtml('Reset time unavailable', '暂无重置时间');
    return `
        <div class="quota-dual-item" data-quota-window="${kind}">
            <div class="quota-dual-head">
                <span class="quota-dual-label">${labelHtml}</span>
                <span class="quota-dual-pct">${pctHtml}</span>
            </div>
            <div class="quota-bar-wrap${pct === null ? ' is-unknown' : ''}" role="progressbar" aria-label="${esc(`${groupLabel} ${labelPlain}`)}"
                aria-valuemin="0" aria-valuemax="100"${pct === null ? '' : ` aria-valuenow="${pct}"`} aria-valuetext="${esc(pctPlain)}">
                ${pct === null ? '' : `<div class="quota-bar ${barTone}" style="width:${pct}%;background:${barColor}"></div>`}
            </div>
            <div class="model-card-meta"><span class="model-card-reset">${resetHtml}</span></div>
        </div>`;
}

export function buildModelQuotaGrid(
    configs: ModelConfig[],
    options: ModelQuotaGridOptions = {},
): string {
    const groups = groupModelQuotas(configs, options.quotaSummary);
    if (groups.length === 0) { return ''; }

    const cards = groups.map(group => {
        const minimum = group.minimum;
        const pct = minimum === null ? null : Number((minimum * 100).toFixed(8));
        const barTone = pct === null ? '' : pct <= 20 ? 'is-attention' : pct < 50 ? 'is-warn' : 'is-healthy';
        const barColor = pct === null ? '' : pct <= 20 ? 'var(--ed-danger-fill)'
            : pct < 50 ? 'var(--ed-warn-fill)' : 'var(--ed-good-fill)';
        const lowLabel = minimum === null ? '' : quotaPercentage(minimum);
        const highLabel = group.maximum === null ? '' : quotaPercentage(group.maximum);
        const percentagePlain = pct === null ? tBi('Unknown', '未知') : group.quotaDiffers && lowLabel !== highLabel
            ? `${lowLabel}–${highLabel}%` : `${lowLabel}%`;
        const percentageHtml = pct === null ? tBiHtml('Unknown', '未知') : esc(percentagePlain);
        // Compare raw readings in the helper; retain a notice when a genuine
        // difference is smaller than the precision useful in a quota card.
        const precisionNotice = group.quotaDiffers && lowLabel === highLabel
            ? `<p class="model-quota-notice">${tBiHtml('Differences are below displayed precision.', '差异小于显示精度。')}</p>` : '';
        const resetLabelHtml = group.resetDiffers ? tBiHtml('Reset times differ', '重置时间不同')
            : group.resetTime ? `${tBiHtml('Reset', '重置')} ${esc(quotaResetLabel(group.resetTime))}`
                : tBiHtml('Reset time unavailable', '暂无重置时间');
        const members = group.pool ? `<ul class="model-quota-members">${group.members.map(member => {
            const memberTag = member.tagTitle ? formatModelTagTitle(member.tagTitle) : null;
            const memberTagCls = member.tagTitle === 'Notice' ? 'model-tag-badge tag-notice' : 'model-tag-badge';
            const memberTagHtml = memberTag
                ? ` <span class="${memberTagCls}" title="${esc(memberTag.plain)}">${memberTag.html}</span>` : '';
            return `
            <li><span>${esc(member.label)}${memberTagHtml}</span>${member.efforts.length
                ? `<span class="model-card-efforts">${quotaEffortsHtml(member.efforts)}</span>` : ''}</li>`;
        }).join('')}</ul>`
            : group.efforts.length ? `<div class="model-card-efforts">${quotaEffortsHtml(group.efforts)}</div>` : '';
        const notices: string[] = [];
        if (group.quotaDiffers || group.resetDiffers) { notices.push(tBiHtml('Reported values differ', '上报数值不一致')); }
        if (group.missingQuota || group.missingReset) {
            notices.push(tBiHtml('Some quota or reset data is unavailable', '部分配额或重置数据缺失'));
        }
        const details = notices.length ? `
                <p class="model-quota-notice">${notices.join(' · ')}</p>
                <details class="model-quota-details">
                    <summary><span>${tBiHtml('Readings by effort', '各档位读数')}</span></summary>
                    <ul>${group.readings.map(reading => `
                        <li><span>${esc(reading.effort ? `${reading.familyLabel} (${quotaEffortLabel(reading.effort)})` : reading.label)}</span>
                            <span>${reading.remaining === null ? tBiHtml('Unknown', '未知') : `${esc(quotaPercentage(reading.remaining))}%`}</span>
                            <span class="model-quota-reading-reset">${reading.resetTime
            ? `${tBiHtml('Reset', '重置')} ${esc(quotaResetLabel(reading.resetTime, true))}`
            : tBiHtml('Reset time unavailable', '暂无重置时间')}</span></li>`).join('')}
                    </ul>${precisionNotice}
                </details>` : '';
        const tag = group.tagTitle ? formatModelTagTitle(group.tagTitle) : null;
        const tagCls = group.tagTitle === 'Notice' ? 'model-tag-badge tag-notice' : 'model-tag-badge';
        const tagBadge = tag ? `<span class="${tagCls}" title="${esc(tag.plain)}">${tag.html}</span>` : '';
        const names = [...new Set(group.readings.map(reading => reading.label))].join(' · ');
        const hasDualWindow = Boolean(group.fiveHourQuota || group.weeklyQuota);
        const metersHtml = hasDualWindow
            ? `<div class="quota-dual-row">
                    ${group.fiveHourQuota ? renderDualWindowBar(group.label, '5h', group.fiveHourQuota) : ''}
                    ${group.weeklyQuota ? renderDualWindowBar(group.label, 'weekly', group.weeklyQuota) : ''}
                </div>`
            : `<div class="quota-bar-wrap${pct === null ? ' is-unknown' : ''}" role="progressbar" aria-label="${esc(`${group.label} ${tBi('quota remaining', '剩余配额')}`)}"
                    aria-valuemin="0" aria-valuemax="100"${pct === null ? '' : ` aria-valuenow="${pct}"`} aria-valuetext="${esc(percentagePlain)}">
                    ${pct === null ? '' : `<div class="quota-bar ${barTone}" style="width:${pct}%;background:${barColor}"></div>`}
                </div>
                <div class="model-card-meta"><span class="model-card-reset">${resetLabelHtml}</span></div>`;
        return `
            <div class="model-card" data-quota-family="${esc(group.key)}">
                <div class="model-card-header">
                    <span class="model-card-name">
                        <span class="model-card-name-text" title="${esc(names)}">${esc(group.label)}</span>${tagBadge}
                    </span>
                    ${hasDualWindow ? '' : `<span class="model-card-pct${pct === null ? ' is-unknown' : ''}">${percentageHtml}</span>`}
                </div>
                ${members}
                ${metersHtml}
                ${details}
            </div>`;
    }).join('');

    if (options.embedded) {
        return `<div class="model-grid">${cards}</div>`;
    }

    return `
        <section class="card model-quota-section">
            ${options.hideHeading ? '' : `<h2>${ICON.bolt} <span>${tBiHtml('Model Quota', '模型配额')}</span></h2>`}
            <div class="model-grid">${cards}</div>
        </section>`;
}

export function buildDefaultModelCard(userInfo: UserStatusInfo | null): string {
    if (!userInfo?.defaultModelLabel) { return ''; }
    return `
        <section class="card default-model-card">
            <h2>${ICON.bolt} <span>${tBiHtml('Default Model', '默认模型')}</span></h2>
            <div class="default-model"><span>${tBiHtml('Current default', '当前默认')}:</span> <strong title="${esc(userInfo.defaultModelLabel)}">${esc(userInfo.defaultModelLabel)}</strong></div>
            ${userInfo.userTierDescription
            ? `<p class="raw-desc">${esc(userInfo.userTierDescription)}</p>`
            : ''}
        </section>`;
}

function buildLimitsSection(userInfo: UserStatusInfo): string {
    const fmtLimit = (v: number): string => v === -1 ? '∞' : formatNumber(v);
    const pl = userInfo.planLimits;
    const limitCards: Array<[string, string]> = [
        [tBiHtml('Max Input Tokens', '最大输入'), esc(fmtLimit(pl.maxNumChatInputTokens))],
        [tBiHtml('Premium Messages', '高级消息数'), esc(fmtLimit(pl.maxNumPremiumChatMessages))],
        [tBiHtml('Custom Instructions', '自定义指令'), `${esc(fmtLimit(pl.maxCustomChatInstructionCharacters))} ${tBiHtml('chars', '字符')}`],
        [tBiHtml('Pinned Context', '固定上下文'), esc(fmtLimit(pl.maxNumPinnedContextItems))],
        [tBiHtml('Local Index', '本地索引'), esc(fmtLimit(pl.maxLocalIndexSize))],
        [tBiHtml('Flex Credits', 'Flex 积分'), `${esc(formatNumber(pl.monthlyFlexCreditPurchaseAmount))} ${tBiHtml('per month', '每月')}`],
    ];
    const limitCardsHtml = limitCards.map(([k, v]) => `
        <div class="profile-metric-card">
            <span class="profile-metric-label">${k}</span>
            <span class="profile-metric-value">${v}</span>
        </div>`).join('');

    return `
        <section class="profile-tech-section">
            <h3 class="profile-sub-heading">${ICON.shield} <span>${tBiHtml('Plan Limits', '计划限制')}</span></h3>
            <div class="profile-metric-grid">${limitCardsHtml}</div>
        </section>`;
}

function buildFeatureAndTeamGrid(userInfo: UserStatusInfo): string {
    // Feature flags
    const allFeatures: { label: string; enabled: boolean }[] = [
        { label: tBiHtml('Web Search', '网页搜索'), enabled: userInfo.cascadeWebSearchEnabled },
        { label: tBiHtml('Browser', '浏览器'), enabled: userInfo.browserEnabled },
        { label: tBiHtml('Knowledge Base', '知识库'), enabled: userInfo.knowledgeBaseEnabled },
        { label: tBiHtml('Commit Msg', '提交信息'), enabled: userInfo.canGenerateCommitMessages },
        { label: tBiHtml('Auto Run', '自动执行'), enabled: userInfo.cascadeCanAutoRunCommands },
        { label: tBiHtml('Background', '后台'), enabled: userInfo.canAllowCascadeInBackground },
        { label: tBiHtml('Buy Credits', '购买积分'), enabled: userInfo.canBuyMoreCredits },
        { label: tBiHtml('Fast Autocomplete', '快速补全'), enabled: userInfo.hasAutocompleteFastMode },
        { label: tBiHtml('Sticky Premium', '锁定高级'), enabled: userInfo.allowStickyPremiumModels },
        { label: tBiHtml('Command Models', '命令模型'), enabled: userInfo.allowPremiumCommandModels },
        { label: tBiHtml('Tab Jump', 'Tab 跳转'), enabled: userInfo.hasTabToJump },
        { label: tBiHtml('Custom Icon', '自定义图标'), enabled: userInfo.canCustomizeAppIcon },
    ];
    const featureTags = allFeatures.map(f =>
        `<span class="feature-tag${f.enabled ? ' enabled' : ''}"><span>${f.label}</span></span>`
    ).join('');

    // Team config
    const tc = userInfo.teamConfig;
    const teamTags = [
        { label: tBiHtml('MCP Servers', 'MCP 服务'), enabled: tc.allowMcpServers },
        { label: tBiHtml('Auto Run Cmd', '自动执行命令'), enabled: tc.allowAutoRunCommands },
        { label: tBiHtml('Browser Experimental', '浏览器实验'), enabled: tc.allowBrowserExperimentalFeatures },
    ].map(f => `<span class="feature-tag${f.enabled ? ' enabled' : ''}"><span>${f.label}</span></span>`).join('');

    return `
        <div class="profile-two-col">
            <section class="profile-tech-section profile-panel-card">
                <h3 class="profile-sub-heading">${ICON.bolt} <span>${tBiHtml('Feature Flags', '功能开关')}</span></h3>
                <div class="profile-chip-grid">${featureTags}</div>
            </section>
            <section class="profile-tech-section profile-panel-card">
                <h3 class="profile-sub-heading">${ICON.shield} <span>${tBiHtml('Team Config', '团队配置')}</span></h3>
                <div class="profile-chip-grid">${teamTags}</div>
            </section>
        </div>`;
}

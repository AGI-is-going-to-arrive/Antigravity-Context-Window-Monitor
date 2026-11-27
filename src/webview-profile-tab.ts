// ─── Profile Tab Content Builder ─────────────────────────────────────────────
// Builds HTML for the "Profile" tab: Account info, shared model quota pools,
// AI credits & expiry day, and collapsible plan limits / feature / team config.

import { currentAICredits } from './account-credits';
import { formatNumber, getLanguage, tBi } from './i18n';
import { formatQuotaWindowPercent } from './monitor-overview';
import { ModelConfig, UserStatusInfo, resolveModelId, type QuotaWindowSummary, type UserQuotaSummary } from './models';
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

function slugKey(raw: string): string {
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return (cleaned || 'item').slice(0, 48);
}

function richTipAttrs(
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

function buildModelTagRichTipAttrs(
    key: string,
    rawTitle: string,
    targetLabel: string,
    tagDescription?: string,
): string {
    const tag = formatModelTagTitle(rawTitle);
    const desc = tagDescription?.trim();
    const defaults: Record<string, readonly [string, string, string, string]> = {
        Notice: [
            'Official notice from the model catalog (such as scheduled deprecation or availability limits).',
            '来自模型目录的官方提示（例如即将下线、能力变更或使用限制说明）。',
            `Applies to ${targetLabel}; check availability before relying on this model.`,
            `适用于 ${targetLabel}，请关注模型可用性或迁移指引。`,
        ],
        Fast: [
            'Optimized for lower latency and quicker turn-around.',
            '针对更低延迟与更快响应速度进行了优化。',
            `Catalog tag for ${targetLabel}.`,
            `${targetLabel} 的目录标签。`,
        ],
        New: [
            'Recently added model or capability in your account catalog.',
            '账号目录中近期新增的模型或能力。',
            `Catalog tag for ${targetLabel}.`,
            `${targetLabel} 的目录标签。`,
        ],
        Preview: [
            'Early-access preview model whose behavior or limits may evolve.',
            '抢先体验预览版模型，行为表现或限额可能随更新调整。',
            `Catalog tag for ${targetLabel}.`,
            `${targetLabel} 的目录标签。`,
        ],
        Beta: [
            'Beta-stage model still undergoing active updates.',
            '测试阶段模型，功能与限额仍可能调整。',
            `Catalog tag for ${targetLabel}.`,
            `${targetLabel} 的目录标签。`,
        ],
        'Limited time': [
            'Temporarily available promotion or limited-window model access.',
            '限时开放的活动或体验模型权限。',
            `Catalog tag for ${targetLabel}.`,
            `${targetLabel} 的目录标签。`,
        ],
    };
    const fallback = Object.hasOwn(defaults, rawTitle) ? defaults[rawTitle] : undefined;
    if (desc) {
        const metaEn = rawTitle === 'Notice'
            ? `Official catalog notice for ${targetLabel}.`
            : `Reported catalog note for ${targetLabel} (${rawTitle}).`;
        const metaZh = rawTitle === 'Notice'
            ? `${targetLabel} 的官方目录提示。`
            : `${targetLabel} 的目录附加说明（${tag.plain}）。`;
        return ` data-popover-key="${esc(key)}" data-tip-title="${esc(tag.plain)}" data-tip-body="${esc(desc)}" data-tip-meta="${esc(tBi(metaEn, metaZh))}"`;
    }
    if (fallback) {
        return richTipAttrs(key, tag.plain, tag.plain, fallback[0], fallback[1], fallback[2], fallback[3]);
    }
    return richTipAttrs(
        key,
        tag.plain,
        tag.plain,
        `Catalog tag "${rawTitle}" reported for ${targetLabel}.`,
        `${targetLabel} 在模型目录中附带的「${rawTitle}」标签。`,
    );
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
                <h2>${ICON.user} <span>${tBiHtml('Profile', '账号')}</span></h2>
                <p class="empty-desc">${tBiHtml(
            'Waiting for user data from the local service...',
            '正在等待本地服务返回用户数据...',
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
    const name = userInfo.name || '';
    const email = userInfo.email || '';
    const maskedName = name ? `${name.charAt(0)}***` : '***';
    const maskedEmail = email ? email.replace(/^(.{2}).*(@.*)$/, '$1****$2') : '***';
    const plan = [...new Set([userInfo.planName, userInfo.userTierName].filter(Boolean))].join(' · ');
    return `
        <header class="profile-identity">
            <div>
                <h2>${tBiHtml('Account', '账号')}</h2>
                <div class="account-info">
                    <span class="account-name" data-real="${esc(name)}" data-masked="${esc(maskedName)}">${esc(maskedName)}</span>
                    <span class="account-email" data-real="${esc(email)}" data-masked="${esc(maskedEmail)}">${esc(maskedEmail)}</span>
                </div>
                ${plan ? `<p class="profile-plan-name">${esc(plan)}</p>` : ''}
            </div>
            <button type="button" class="privacy-btn active" id="privacyToggle" aria-pressed="true">
                ${ICON.shield}<span>${tBiHtml('Privacy mask', '隐私遮罩')}</span>
            </button>
        </header>`;
}

function buildCreditSection(userInfo: UserStatusInfo, billingDay?: number): string {
    const day = billingDay || 0;
    const credits = currentAICredits(userInfo.availableCredits || []);
    const readings = credits.length ? credits : [{ creditType: '', creditAmount: null }];
    const expiryHtml = creditExpiryHtml(getDaysUntilBillingDay(day));
    const creditsHeadingTip = richTipAttrs(
        'profile-ai-credits-heading',
        'Account AI Credits',
        '账号 AI 积分',
        'Your account-level AI Credits balance — separate from the 5-hour and weekly shared model quota pools.',
        '当前账号的 AI 积分余额，与 5 小时 / 每周共享模型配额池相互独立。',
        'Used for eligible overage calls or credit-billed actions; distinct from per-call GM Credits in Calendar.',
        '可用于配额耗尽后的超额调用或按积分计费的操作；不同于日历页的单次 GM 调用积分。',
    );
    const billingDayTip = richTipAttrs(
        'profile-billing-day-label',
        'Monthly Credits Expiry Day',
        '每月积分到期日',
        'A local day-of-month reminder (1–31) used by this monitor to calculate the expiry countdown.',
        '由你手动设置的本地到期日提醒（每月 1–31 日），仅用于在本监控内计算倒计时。',
        'Stored locally only — does not change Google billing. Enter 0 to turn off the countdown.',
        '仅保存在本地，不会修改官方账单周期；填 0 可关闭倒计时。',
    );
    return `
        <section class="profile-ai" aria-labelledby="profile-ai-heading">
            <header class="profile-section-header">
                <h2 id="profile-ai-heading"${creditsHeadingTip}>${tBiHtml('AI credits', 'AI 积分')}</h2>
                <a class="profile-activity" href="https://antigravity.google/g1-activity" target="_blank" rel="noopener noreferrer"><span>${tBiHtml('Credit activity', '积分记录')}</span> ${ICON.externalLink}</a>
            </header>
            <dl class="profile-credit-balances">
                ${readings.map(c => `<div class="profile-credit-balance">
                    <dt>${c.creditType ? formatCreditTypeLabelHtml(c.creditType) : tBiHtml('Balance', '余额')}</dt>
                    <dd class="gai-value${c.creditAmount === null ? ' is-unreported' : ''}">${c.creditAmount === null ? tBiHtml('Not reported', '未上报') : esc(formatNumber(c.creditAmount))}</dd>
                </div>`).join('')}
            </dl>
            <label class="billing-day-label" for="profileBillingDayInput"${billingDayTip}>${tBiHtml('Monthly credits expiry day', '每月积分到期日')}</label>
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

function renderDualWindowBar(
    groupKey: string,
    groupLabel: string,
    kind: '5h' | 'weekly',
    win: QuotaWindowSummary,
    scopePrefix: string,
): string {
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
    const winTip = kind === '5h'
        ? richTipAttrs(
            `${scopePrefix}-win-${slugKey(groupKey)}-5h`,
            `${groupLabel} · 5-Hour Window`,
            `${groupLabel} · 5 小时配额窗口`,
            `Short-term shared quota remaining across all listed ${groupLabel} models (${pctPlain}).`,
            `${groupLabel} 配额池内所有模型共用的 5 小时短期剩余额度（${pctPlain}）。`,
            'Both 5-Hour and Weekly rolling windows apply simultaneously — whichever hits 0% first pauses this pool.',
            '5 小时与每周双滚动窗口同时生效，任一窗口先归零都会暂停该池调用。',
        )
        : richTipAttrs(
            `${scopePrefix}-win-${slugKey(groupKey)}-weekly`,
            `${groupLabel} · Weekly Window`,
            `${groupLabel} · 每周配额窗口`,
            `Weekly shared quota remaining across all listed ${groupLabel} models (${pctPlain}).`,
            `${groupLabel} 配额池内所有模型共用的每周总额度剩余比例（${pctPlain}）。`,
            'Both 5-Hour and Weekly rolling windows apply simultaneously — whichever hits 0% first pauses this pool.',
            '5 小时与每周双滚动窗口同时生效，任一窗口先归零都会暂停该池调用。',
        );
    return `
        <div class="quota-dual-item" data-quota-window="${kind}"${winTip}>
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

    const scopePrefix = options.embedded ? 'profile-quota' : 'models-quota';

    // Index live tagDescription from raw ModelConfigs so Notice / catalog badges
    // surface the real backend note rather than repeating the badge text.
    const tagDescByKey = new Map<string, string>();
    for (const cfg of configs) {
        const desc = typeof cfg.tagDescription === 'string' ? cfg.tagDescription.trim() : '';
        if (!desc) { continue; }
        const rawModel = cfg.model?.trim();
        if (rawModel) {
            tagDescByKey.set(rawModel, desc);
            const resolved = resolveModelId(rawModel);
            if (resolved) { tagDescByKey.set(resolved, desc); }
        }
        const rawLabel = cfg.label?.trim();
        if (rawLabel) { tagDescByKey.set(`label:${rawLabel}`, desc); }
    }
    const lookupTagDescription = (readings: readonly { model: string; label: string }[]): string | undefined => {
        for (const r of readings) {
            const byModel = tagDescByKey.get(r.model);
            if (byModel) { return byModel; }
            const byLabel = tagDescByKey.get(`label:${r.label.trim()}`);
            if (byLabel) { return byLabel; }
        }
        return undefined;
    };

    const cards = groups.map((group, gIdx) => {
        const groupSlug = `${gIdx}-${slugKey(group.key)}`;
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
        const buildEffortsTip = (key: string, label: string, efforts: QuotaEffort[]) => {
            const listEn = efforts.map(e => ({ low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High' })[e]).join(' · ');
            const listZh = efforts.map(e => ({ low: '低', medium: '中', high: '高', xhigh: '超高' })[e]).join(' · ');
            return richTipAttrs(
                key,
                `${label} · Reasoning Effort Tiers`,
                `${label} · 推理档位`,
                'Available reasoning effort tiers for this model family (Low / Medium / High / Extra High). Higher tiers think deeper and typically use quota faster.',
                '该模型系列当前可用的推理档位（低 / 中 / 高 / 超高）。档位越高推理越深入，通常也会更快消耗配额。',
                `Available tiers: ${listEn} · All tiers share this pool's quota.`,
                `当前可用档位：${listZh} · 各档位共用该配额池额度。`,
            );
        };
        const members = group.pool ? `<ul class="model-quota-members">${group.members.map((member, mIdx) => {
            const memberSlug = `${groupSlug}-m${mIdx}-${slugKey(member.key)}`;
            const memberTag = member.tagTitle ? formatModelTagTitle(member.tagTitle) : null;
            const memberTagCls = member.tagTitle === 'Notice' ? 'model-tag-badge tag-notice' : 'model-tag-badge';
            const memberTagDesc = member.tagTitle ? lookupTagDescription(member.readings) : undefined;
            const memberTagHtml = memberTag
                ? ` <span class="${memberTagCls}"${buildModelTagRichTipAttrs(`${scopePrefix}-tag-${memberSlug}`, member.tagTitle!, member.label, memberTagDesc)}>${memberTag.html}</span>` : '';
            return `
            <li><span>${esc(member.label)}${memberTagHtml}</span>${member.efforts.length
                ? `<span class="model-card-efforts"${buildEffortsTip(`${scopePrefix}-efforts-${memberSlug}`, member.label, member.efforts)}>${quotaEffortsHtml(member.efforts)}</span>` : ''}</li>`;
        }).join('')}</ul>`
            : group.efforts.length ? `<div class="model-card-efforts"${buildEffortsTip(`${scopePrefix}-efforts-${groupSlug}`, group.label, group.efforts)}>${quotaEffortsHtml(group.efforts)}</div>` : '';
        const notices: string[] = [];
        if (group.quotaDiffers || group.resetDiffers) { notices.push(tBiHtml('Reported values differ', '上报数值不一致')); }
        if (group.missingQuota || group.missingReset) {
            notices.push(tBiHtml('Some quota or reset data is unavailable', '部分配额或重置数据缺失'));
        }
        const noticeTip = richTipAttrs(
            `${scopePrefix}-diff-${groupSlug}`,
            'Why Reported Values Differ',
            '为何上报数值不一致',
            'Backend quota readings across effort tiers or sibling models can be sampled slightly apart or return partial fields.',
            '同一配额池下不同档位或模型的后端读数可能存在轻微采样时间差，或部分字段暂未返回。',
            'Expand "Readings by effort" below to inspect each model\'s exact remaining % and reset time.',
            '展开下方「各档位读数」可查看每个模型的精确剩余比例与重置时间。',
        );
        const details = notices.length ? `
                <p class="model-quota-notice"${noticeTip}>${notices.join(' · ')}</p>
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
        const groupTagDesc = group.tagTitle ? lookupTagDescription(group.readings) : undefined;
        const tagBadge = tag
            ? `<span class="${tagCls}"${buildModelTagRichTipAttrs(`${scopePrefix}-tag-${groupSlug}`, group.tagTitle!, group.label, groupTagDesc)}>${tag.html}</span>` : '';
        const names = [...new Set(group.readings.map(reading => reading.label))].join(' · ');
        const groupNameTip = richTipAttrs(
            `${scopePrefix}-name-${groupSlug}`,
            group.pool ? `${group.label} · Shared Quota Pool` : group.label,
            group.pool ? `${group.label} · 共享配额池` : group.label,
            group.pool
                ? 'All models listed in this card draw from one shared quota pool (5-hour and weekly limits apply across every member).'
                : 'Independent model quota tracked separately from the main shared pools.',
            group.pool
                ? '该卡片下所有模型共用同一个配额池（5 小时与每周限额对池内全部成员共同生效）。'
                : '独立计量的模型配额，不与主共享配额池混算。',
            names ? `Included models: ${names}` : undefined,
            names ? `包含模型：${names}` : undefined,
        );
        const hasDualWindow = Boolean(group.fiveHourQuota || group.weeklyQuota);
        const metersHtml = hasDualWindow
            ? `<div class="quota-dual-row">
                    ${group.fiveHourQuota ? renderDualWindowBar(groupSlug, group.label, '5h', group.fiveHourQuota, scopePrefix) : ''}
                    ${group.weeklyQuota ? renderDualWindowBar(groupSlug, group.label, 'weekly', group.weeklyQuota, scopePrefix) : ''}
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
                        <span class="model-card-name-text"${groupNameTip}>${esc(group.label)}</span>${tagBadge}
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
    const defaultTip = richTipAttrs(
        'models-default-model-label',
        'Default Model',
        '默认模型',
        `${userInfo.defaultModelLabel} is selected automatically when you start a new conversation unless you choose another model.`,
        `新建对话时默认选用 ${userInfo.defaultModelLabel}，除非你在界面中手动切换其他模型。`,
        'Reported by your signed-in account profile.',
        '数据来源：当前登录账号的默认模型配置。',
    );
    return `
        <section class="card default-model-card">
            <h2>${ICON.bolt} <span>${tBiHtml('Default Model', '默认模型')}</span></h2>
            <div class="default-model"><span>${tBiHtml('Current default', '当前默认')}:</span> <strong${defaultTip}>${esc(userInfo.defaultModelLabel)}</strong></div>
            ${userInfo.userTierDescription
            ? `<p class="raw-desc">${esc(userInfo.userTierDescription)}</p>`
            : ''}
        </section>`;
}

function buildLimitsSection(userInfo: UserStatusInfo): string {
    const pl = userInfo.planLimits;
    if (!pl) { return ''; }
    const fmtLimit = (v: unknown): string => {
        if (typeof v !== 'number' || !Number.isFinite(v)) { return '—'; }
        return v === -1 ? '∞' : formatNumber(v);
    };
    const fmtCountUnit = (v: unknown, unitEn: string, unitZh: string): string => {
        if (typeof v !== 'number' || !Number.isFinite(v)) { return '—'; }
        if (v === -1) { return '∞'; }
        return `${esc(formatNumber(v))} ${tBiHtml(unitEn, unitZh)}`;
    };
    const flexAmount = typeof pl.monthlyFlexCreditPurchaseAmount === 'number' && Number.isFinite(pl.monthlyFlexCreditPurchaseAmount)
        ? `${esc(formatNumber(pl.monthlyFlexCreditPurchaseAmount))} ${tBiHtml('per month', '每月')}`
        : '—';
    const limitCards: Array<{
        key: string;
        labelHtml: string;
        valueHtml: string;
        tip: string;
    }> = [
        {
            key: 'max-input',
            labelHtml: tBiHtml('Max Input Tokens', '最大输入'),
            valueHtml: esc(fmtLimit(pl.maxNumChatInputTokens)),
            tip: richTipAttrs(
                'profile-limit-max-input',
                'Plan Max Input Tokens',
                '计划最大输入 Token',
                'Account-plan ceiling on input tokens per chat request — distinct from each model\'s Effective Budget (Compaction Limit) and Native Ceiling.',
                '当前订阅计划允许的单次对话输入 Token 上限，与「模型」页中各模型的自动压缩上限和原生窗口上限不同。',
                '∞ (-1) means no extra plan cap; individual model limits still apply.',
                '∞（-1）表示计划层不额外限制，仍受所选模型自身上限约束。',
            ),
        },
        {
            key: 'premium-messages',
            labelHtml: tBiHtml('Premium Messages', '高级消息数'),
            valueHtml: esc(fmtLimit(pl.maxNumPremiumChatMessages)),
            tip: richTipAttrs(
                'profile-limit-premium-msgs',
                'Premium Messages Limit',
                '高级消息数上限',
                'Plan limit on premium-tier chat messages; ∞ means unlimited message count under your current tier (quota pools still govern rate).',
                '计划允许的高级模型消息条数上限；∞ 表示不限条数（仍受共享配额池速率限制）。',
                'Raw backend value -1 renders as ∞.',
                '后端返回 -1 时显示为 ∞。',
            ),
        },
        {
            key: 'custom-instructions',
            labelHtml: tBiHtml('Custom Instructions', '自定义指令'),
            valueHtml: `${esc(fmtLimit(pl.maxCustomChatInstructionCharacters))} ${tBiHtml('chars', '字符')}`,
            tip: richTipAttrs(
                'profile-limit-custom-instructions',
                'Custom Instructions Length',
                '自定义指令长度上限',
                'Maximum total character length allowed in your persistent custom instructions/rules profile.',
                '个人自定义系统指令 / 规则配置允许保存的最大字符数上限。',
                'Unit: characters (chars).',
                '单位：字符数（chars）。',
            ),
        },
        {
            key: 'pinned-context',
            labelHtml: tBiHtml('Pinned Context', '固定上下文'),
            valueHtml: fmtCountUnit(pl.maxNumPinnedContextItems, 'items', '项'),
            tip: richTipAttrs(
                'profile-limit-pinned-context',
                'Pinned Context Items',
                '固定上下文条目上限',
                'Maximum number of files, symbols, or snippets you can keep permanently pinned in conversation context.',
                '可在对话上下文中持久固定（Pin）的文件、代码片段或条目数量上限。',
                'Unit: item count (∞ = no fixed cap).',
                '单位：条目数（∞ 表示无固定数量限制）。',
            ),
        },
        {
            key: 'local-index',
            labelHtml: tBiHtml('Local Index', '本地索引'),
            valueHtml: fmtCountUnit(pl.maxLocalIndexSize, 'items', '条'),
            tip: richTipAttrs(
                'profile-limit-local-index',
                'Local Workspace Index Size',
                '本地代码库索引上限',
                'Maximum number of indexed local workspace entries/chunks your plan allows for semantic codebase search.',
                '订阅计划允许用于本地语义代码检索的最大索引条目 / 分块数量上限。',
                'Unit: indexed items / chunks across your workspace.',
                '单位：工作区本地索引条目 / 分块数。',
            ),
        },
        {
            key: 'flex-credits',
            labelHtml: tBiHtml('Flex Credits', 'Flex 积分'),
            valueHtml: flexAmount,
            tip: richTipAttrs(
                'profile-limit-flex-credits',
                'Monthly Flex Credits',
                '每月 Flex 积分额度',
                'Monthly allowance of optional add-on AI Credits eligible for purchase under your subscription plan.',
                '当前订阅计划每月允许额外购买的弹性 AI 积分（Flex Credits）额度。',
                '0 per month means monthly add-on credit purchase is not enabled on this plan.',
                '显示 0 表示当前计划未包含或未开启每月弹性积分加购额度。',
            ),
        },
    ];
    const limitCardsHtml = limitCards.map(item => `
        <div class="profile-metric-card" data-plan-limit="${item.key}"${item.tip}>
            <span class="profile-metric-label">${item.labelHtml}</span>
            <span class="profile-metric-value">${item.valueHtml}</span>
        </div>`).join('');

    return `
        <section class="profile-tech-section">
            <h3 class="profile-sub-heading">${ICON.shield} <span>${tBiHtml('Plan Limits', '计划限制')}</span></h3>
            <div class="profile-metric-grid">${limitCardsHtml}</div>
        </section>`;
}

function buildFeatureAndTeamGrid(userInfo: UserStatusInfo): string {
    interface CapabilityChip {
        id: string;
        labelEn: string;
        labelZh: string;
        descEn: string;
        descZh: string;
        enabled: boolean;
    }

    const renderChip = (prefix: string, f: CapabilityChip): string => {
        const stateEn = f.enabled ? 'Enabled' : 'Disabled';
        const stateZh = f.enabled ? '已启用' : '未启用';
        const ariaLabel = `${tBi(f.labelEn, f.labelZh)}: ${tBi(stateEn, stateZh)}`;
        const tip = richTipAttrs(
            `${prefix}-${f.id}`,
            f.labelEn,
            f.labelZh,
            f.descEn,
            f.descZh,
            `Account status: ${stateEn}.`,
            `当前账号状态：${stateZh}。`,
        );
        return `<span class="feature-tag${f.enabled ? ' enabled' : ''}" role="status" aria-label="${esc(ariaLabel)}" data-flag-state="${f.enabled ? 'enabled' : 'disabled'}"${tip}><span class="feature-tag-state" aria-hidden="true">${f.enabled ? '✓' : '×'}</span><span>${tBiHtml(f.labelEn, f.labelZh)}</span></span>`;
    };

    // Feature flags
    const allFeatures: CapabilityChip[] = [
        {
            id: 'web-search',
            labelEn: 'Web Search',
            labelZh: '网页搜索',
            descEn: 'Allows the agent to search the live web for documentation and up-to-date answers.',
            descZh: '允许智能体联网检索文档与最新资料。',
            enabled: !!userInfo.cascadeWebSearchEnabled,
        },
        {
            id: 'browser',
            labelEn: 'Browser',
            labelZh: '浏览器',
            descEn: 'Allows the built-in browser subagent to open pages, inspect UI, and verify changes.',
            descZh: '允许内置浏览器子智能体打开网页、检查页面状态与验证改动。',
            enabled: !!userInfo.browserEnabled,
        },
        {
            id: 'knowledge-base',
            labelEn: 'Knowledge Base',
            labelZh: '知识库',
            descEn: 'Enables persistent workspace knowledge indexing and retrieval across conversations.',
            descZh: '启用跨会话的工作区知识库沉淀与语义检索。',
            enabled: !!userInfo.knowledgeBaseEnabled,
        },
        {
            id: 'commit-msg',
            labelEn: 'Commit Msg',
            labelZh: '提交信息',
            descEn: 'Allows AI-generated Git commit messages from staged diffs.',
            descZh: '允许根据暂存区改动自动生成 Git 提交信息。',
            enabled: !!userInfo.canGenerateCommitMessages,
        },
        {
            id: 'auto-run',
            labelEn: 'Auto Run',
            labelZh: '自动执行',
            descEn: 'Account permission allowing the agent to run terminal commands without manual approval when configured.',
            descZh: '账号级权限：允许在用户配置下自动执行终端命令而无需逐条确认。',
            enabled: !!userInfo.cascadeCanAutoRunCommands,
        },
        {
            id: 'background',
            labelEn: 'Background',
            labelZh: '后台',
            descEn: 'Allows agent conversations and subagents to continue executing in the background.',
            descZh: '允许主会话或后台子智能体在后台持续运行任务。',
            enabled: !!userInfo.canAllowCascadeInBackground,
        },
        {
            id: 'buy-credits',
            labelEn: 'Buy Credits',
            labelZh: '购买积分',
            descEn: 'Indicates whether this account can purchase additional AI Credits.',
            descZh: '标识当前账号是否支持额外加购 AI 积分。',
            enabled: !!userInfo.canBuyMoreCredits,
        },
        {
            id: 'fast-autocomplete',
            labelEn: 'Fast Autocomplete',
            labelZh: '快速补全',
            descEn: 'Enables low-latency inline code autocomplete suggestions.',
            descZh: '启用低延迟的行内代码快速补全能力。',
            enabled: !!userInfo.hasAutocompleteFastMode,
        },
        {
            id: 'sticky-premium',
            labelEn: 'Sticky Premium',
            labelZh: '锁定高级',
            descEn: 'Keeps your chosen premium model selected across new conversations instead of resetting to a lighter default.',
            descZh: '在新建对话时保持已选的高级模型，不会自动回退到轻量默认模型。',
            enabled: !!userInfo.allowStickyPremiumModels,
        },
        {
            id: 'command-models',
            labelEn: 'Command Models',
            labelZh: '命令模型',
            descEn: 'Allows inline command / quick-edit prompts to use premium-tier models.',
            descZh: '允许在行内命令与快捷编辑中使用高级模型。',
            enabled: !!userInfo.allowPremiumCommandModels,
        },
        {
            id: 'tab-jump',
            labelEn: 'Tab Jump',
            labelZh: 'Tab 跳转',
            descEn: 'Predicts your next edit cursor location so pressing Tab jumps directly there.',
            descZh: '预测下一处代码编辑位置，按 Tab 键即可直接跳转。',
            enabled: !!userInfo.hasTabToJump,
        },
        {
            id: 'custom-icon',
            labelEn: 'Custom Icon',
            labelZh: '自定义图标',
            descEn: 'Allows customizing the Antigravity application icon variant.',
            descZh: '允许自定义 Antigravity 应用图标样式。',
            enabled: !!userInfo.canCustomizeAppIcon,
        },
    ];
    const featureTags = allFeatures.map(f => renderChip('profile-flag', f)).join('');

    // Team config
    const tc = userInfo.teamConfig;
    const teamFeatures: CapabilityChip[] = [
        {
            id: 'mcp-servers',
            labelEn: 'MCP Servers',
            labelZh: 'MCP 服务',
            descEn: 'Organization policy permitting Model Context Protocol (MCP) external tool servers.',
            descZh: '团队策略：是否允许接入外部 MCP（Model Context Protocol）工具服务。',
            enabled: !!tc?.allowMcpServers,
        },
        {
            id: 'auto-run-cmd',
            labelEn: 'Auto Run Cmd',
            labelZh: '自动执行命令',
            descEn: 'Organization policy permitting agents to auto-execute shell commands.',
            descZh: '团队策略：是否允许智能体自动执行终端命令。',
            enabled: !!tc?.allowAutoRunCommands,
        },
        {
            id: 'browser-experimental',
            labelEn: 'Browser Experimental',
            labelZh: '浏览器实验',
            descEn: 'Organization policy permitting experimental browser automation features.',
            descZh: '团队策略：是否允许启用实验性浏览器自动化功能。',
            enabled: !!tc?.allowBrowserExperimentalFeatures,
        },
    ];
    const teamTags = teamFeatures.map(f => renderChip('profile-team', f)).join('');

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

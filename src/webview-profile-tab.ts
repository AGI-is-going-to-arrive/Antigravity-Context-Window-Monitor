// ─── Profile Tab Content Builder ─────────────────────────────────────────────
// Builds HTML for the "Profile" tab: Account info, shared model quota pools,
// AI credits & expiry day, and collapsible plan limits / feature / team config.

import { currentAICredits } from './account-credits';
import { formatNumber, getLanguage, tBi, tHtml } from './i18n-core';
import { formatQuotaWindowPercent } from './monitor-overview';
import { ModelConfig, UserStatusInfo, resolveModelId, type QuotaWindowSummary, type UserQuotaSummary } from './models';
import {
    projectQuotaDisplay,
    type QuotaDirectionMode,
    type QuotaWindowMode,
} from './quota-runway';
import { formatResetAbsolute, formatResetCountdown } from './reset-time';
import { ICON } from './webview-icons';
import { esc, richTipBiAttrs as richTipAttrs, slugKey, tBiHtml } from './webview-helpers';
import { getDaysUntilBillingDay } from './billing-day';
import { groupModelQuotas, type QuotaEffort } from './model-quota';

export interface ModelQuotaGridOptions {
    embedded?: boolean;
    hideHeading?: boolean;
    quotaSummary?: UserQuotaSummary | null;
    /** Active quota horizon window mode (`'5h' | '7d' | 'tightest'`). Default: `'tightest'`. */
    quotaWindowMode?: QuotaWindowMode;
    /** Active quota display direction (`'remaining' | 'used'`). Default: `'remaining'`. */
    quotaDirectionMode?: QuotaDirectionMode;
}

export interface ProfileContentOptions {
    /** When true (default, fail-closed), plaintext name/email are NEVER emitted into `data-real` attributes in HTML. */
    privacyMasked?: boolean;
    /** Opaque account handle bound to `#profileBillingDayInput` instead of plaintext `data-email`. */
    accountHandle?: string;
    /** Active quota horizon window mode (`'5h' | '7d' | 'tightest'`). */
    quotaWindowMode?: QuotaWindowMode;
    /** Active quota display direction (`'remaining' | 'used'`). */
    quotaDirectionMode?: QuotaDirectionMode;
}

/**
 * Mask an email address safely for UI display, including 1-character local parts
 * (e.g. `a@sentinel-secret.example` -> `****@sentinel-secret.example`,
 * `secret.alice@example.com` -> `se****@example.com`, already-masked `****@redacted` -> unchanged).
 */
export function maskEmailForDisplay(email: string): string {
    const trimmed = (email || '').trim();
    if (!trimmed) { return '***'; }
    const atIdx = trimmed.indexOf('@');
    if (atIdx < 0) { return '***'; }
    const local = trimmed.slice(0, atIdx);
    const domain = trimmed.slice(atIdx); // includes '@'
    if (/^\*+$/.test(local)) { return `${local}${domain}`; }
    if (local.length <= 2) {
        return `****${domain}`;
    }
    return `${local.slice(0, 2)}****${domain}`;
}

/** Mask a display name for privacy mode without leaking full identity. */
export function maskNameForDisplay(name: string): string {
    const trimmed = (name || '').trim();
    if (!trimmed) { return '***'; }
    if (/^\*+$/.test(trimmed) || /^Account\s+#\d+$/i.test(trimmed)) {
        return trimmed;
    }
    return `${trimmed.charAt(0)}***`;
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
    options?: ProfileContentOptions,
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

    const privacyMasked = options?.privacyMasked !== false;
    const accountHandle = options?.accountHandle || '';
    const sortedConfigs = sortModels(configs, userInfo.modelSortOrder);
    const quota = buildModelQuotaGrid(sortedConfigs, {
        embedded: true,
        quotaSummary,
        quotaWindowMode: options?.quotaWindowMode,
        quotaDirectionMode: options?.quotaDirectionMode,
    });
    return `
        <div class="profile-page">
            ${buildAccountSection(userInfo, privacyMasked)}
            <div class="profile-body-grid">
                <section class="profile-quota" aria-labelledby="profile-quota-heading">
                    <header class="profile-section-header">
                        <h2 id="profile-quota-heading">${tBiHtml('Model quota', '模型配额')}</h2>
                        <button type="button" class="overview-action" data-overview-target="models"><span>${tBiHtml('View models', '查看模型')}</span> ${ICON.externalLink}</button>
                    </header>
                    ${quota || `<p class="empty-msg">${tBiHtml('Waiting for model quota data.', '等待模型配额数据。')}</p>`}
                </section>
                ${buildCreditSection(userInfo, billingDay, privacyMasked, accountHandle)}
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

function buildAccountSection(userInfo: UserStatusInfo, privacyMasked = true): string {
    const name = userInfo.name || '';
    const email = userInfo.email || '';
    const maskedName = maskNameForDisplay(name);
    const maskedEmail = maskEmailForDisplay(email);
    const plan = [...new Set([userInfo.planName, userInfo.userTierName].filter(Boolean))].join(' · ');
    const nameNode = privacyMasked
        ? `<span class="account-name" data-masked="${esc(maskedName)}">${esc(maskedName)}</span>`
        : `<span class="account-name" data-real="${esc(name)}" data-masked="${esc(maskedName)}">${esc(name || maskedName)}</span>`;
    const emailNode = privacyMasked
        ? `<span class="account-email" data-masked="${esc(maskedEmail)}">${esc(maskedEmail)}</span>`
        : `<span class="account-email" data-real="${esc(email)}" data-masked="${esc(maskedEmail)}">${esc(email || maskedEmail)}</span>`;
    const btnCls = privacyMasked ? 'privacy-btn active' : 'privacy-btn';
    const ariaPressed = privacyMasked ? 'true' : 'false';
    return `
        <header class="profile-identity">
            <div>
                <h2>${tBiHtml('Account', '账号')}</h2>
                <div class="account-info">
                    ${nameNode}
                    ${emailNode}
                </div>
                ${plan ? `<p class="profile-plan-name">${esc(plan)}</p>` : ''}
            </div>
            <button type="button" class="${btnCls}" id="privacyToggle" aria-pressed="${ariaPressed}">
                ${ICON.shield}<span>${tBiHtml('Privacy mask', '隐私遮罩')}</span>
            </button>
        </header>`;
}

function buildCreditSection(
    userInfo: UserStatusInfo,
    billingDay?: number,
    privacyMasked = true,
    accountHandle = '',
): string {
    const day = billingDay || 0;
    const credits = currentAICredits(userInfo.availableCredits || []);
    const readings = credits.length ? credits : [{ creditType: '', creditAmount: null }];
    const expiryHtml = creditExpiryHtml(getDaysUntilBillingDay(day));
    const resolvedHandle = accountHandle || (privacyMasked ? 'acct-active' : (userInfo.email || 'acct-active'));
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
                <a class="profile-activity" data-action="openExternalUrl" data-url="https://antigravity.google/g1-activity" href="https://antigravity.google/g1-activity" target="_blank" rel="noopener noreferrer"><span>${tBiHtml('Credit activity', '积分记录')}</span> ${ICON.externalLink}</a>
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
                        data-account-handle="${esc(resolvedHandle)}" value="${day}" min="0" max="31" step="1" />
                    <button type="button" class="num-spinner-btn increment" aria-label="${esc(tBi('Increase day', '增大日期'))}">+</button>
                </div>
                <button type="button" class="action-btn" id="profileBillingDaySaveBtn"><span>${tBiHtml('Save', '保存')}</span></button>
            </div>
            <p class="profile-expiry">${expiryHtml} · ${tBiHtml('Local reminder for this account. Enter 0 to turn it off.', '仅设置当前账号的本地提醒，填 0 可关闭倒计时。')}</p>
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
    const now = Date.now();
    const countdown = Date.parse(resetTime) > now ? formatResetCountdown(resetTime, now) : '';
    const absolute = formatResetAbsolute(resetTime, { includeSeconds: precise });
    return countdown ? `${countdown} · ${absolute}` : absolute;
}

function quotaPercentage(fraction: number): string {
    return new Intl.NumberFormat(getLanguage() === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 8 }).format(fraction * 100);
}

function formatProjectedPct(pct: number | null): string {
    if (pct === null || !Number.isFinite(pct)) { return tBi('Unknown', '未知'); }
    return formatQuotaWindowPercent(Math.max(0, Math.min(1, pct / 100)));
}

function renderDualWindowBar(
    groupKey: string,
    groupLabel: string,
    kind: '5h' | 'weekly',
    win: QuotaWindowSummary,
    scopePrefix: string,
    directionMode: QuotaDirectionMode = 'remaining',
    isActiveFocusWindow = false,
): string {
    const horizon: '5h' | '7d' = kind === '5h' ? '5h' : '7d';
    const proj = projectQuotaDisplay({
        windowMode: horizon,
        directionMode,
        window5h: horizon === '5h' ? { remainingFraction: win.remainingFraction } : undefined,
        window7d: horizon === '7d' ? { remainingFraction: win.remainingFraction } : undefined,
    });
    const labelHtml = kind === '5h' ? tHtml('quota.window5h') : tHtml('quota.window7d');
    const labelPlain = kind === '5h' ? tBi('5-hour window', '5 小时窗口') : tBi('Weekly window', '每周窗口');
    const dirLabelHtml = tBiHtml(proj.directionLabelEn, proj.directionLabelZh);
    const remPct = proj.remainingPct;
    const dispPct = proj.displayPct;
    const barTone = remPct === null ? '' : remPct <= 20 ? 'is-attention' : remPct < 50 ? 'is-warn' : 'is-healthy';
    const barColor = remPct === null ? '' : remPct <= 20 ? 'var(--ed-danger-fill)'
        : remPct < 50 ? 'var(--ed-warn-fill)' : 'var(--ed-good-fill)';
    const pctPlain = proj.isUnavailable
        ? tBi('Unknown', '未知')
        : `${formatProjectedPct(dispPct)} ${tBi(proj.directionLabelEn, proj.directionLabelZh)}`;
    const pctHtml = proj.isUnavailable
        ? `<span class="is-unknown">${tBiHtml('Unknown', '未知')}</span>`
        : `<span class="quota-dual-pct-val">${esc(formatProjectedPct(dispPct))}</span> <span class="quota-dir-tag" data-quota-window-tag="${horizon}" data-quota-direction="${directionMode}">${dirLabelHtml}</span>`;
    const parsedReset = win.resetTime ? Date.parse(win.resetTime) : Number.NaN;
    const resetHtml = win.resetTime && Number.isFinite(parsedReset) && parsedReset > 0
        ? `${tBiHtml('Reset', '重置')} ${esc(quotaResetLabel(win.resetTime))}`
        : tBiHtml('Reset time unavailable', '暂无重置时间');
    const bothWinEn = 'Both 5h and 7d rolling windows apply; whichever hits 0% remaining pauses this pool.';
    const bothWinZh = '5h 与 7d 双窗口同时生效，任一归零即暂停。';
    const winTip = richTipAttrs(
        `${scopePrefix}-win-${slugKey(groupKey)}-${kind === '5h' ? '5h' : 'weekly'}`,
        `${groupLabel} · ${horizon} (${proj.directionLabelEn})`,
        `${groupLabel} · ${horizon} 配额窗口（${proj.directionLabelZh}）`,
        `${kind === '5h' ? 'Short-term 5h' : 'Weekly 7d'} shared quota (${pctPlain}) for ${groupLabel}.`,
        `${groupLabel} 配额池共用的 ${horizon} 配额（${pctPlain}）。`,
        bothWinEn,
        bothWinZh,
    );
    return `
        <div class="quota-dual-item${isActiveFocusWindow ? ' is-primary-window' : ''}" data-quota-window="${kind}" data-quota-horizon="${horizon}" data-quota-direction="${directionMode}"${winTip}>
            <div class="quota-dual-head">
                <span class="quota-dual-label">${labelHtml}</span>
                <span class="quota-dual-pct">${pctHtml}</span>
            </div>
            <div class="quota-bar-wrap${dispPct === null ? ' is-unknown' : ''}" role="progressbar" aria-label="${esc(`${groupLabel} ${labelPlain} ${tBi(proj.directionLabelEn, proj.directionLabelZh)}`)}"
                aria-valuemin="0" aria-valuemax="100"${dispPct === null ? '' : ` aria-valuenow="${dispPct}"`} aria-valuetext="${esc(pctPlain)}">
                ${dispPct === null ? '' : `<div class="quota-bar ${barTone}" style="width:${dispPct}%;background:${barColor}"></div>`}
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
    const windowMode: QuotaWindowMode = options.quotaWindowMode ?? 'tightest';
    const directionMode: QuotaDirectionMode = options.quotaDirectionMode ?? 'remaining';

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
        const primaryProj = projectQuotaDisplay({
            windowMode,
            directionMode,
            window5h: group.fiveHourQuota
                ? { remainingFraction: group.fiveHourQuota.remainingFraction }
                : (minimum !== null ? { remainingFraction: minimum } : undefined),
            window7d: group.weeklyQuota
                ? { remainingFraction: group.weeklyQuota.remainingFraction }
                : undefined,
        });
        const remPct = minimum === null ? null : Number((minimum * 100).toFixed(8));
        const pct = primaryProj.displayPct;
        const barTone = remPct === null ? '' : remPct <= 20 ? 'is-attention' : remPct < 50 ? 'is-warn' : 'is-healthy';
        const barColor = remPct === null ? '' : remPct <= 20 ? 'var(--ed-danger-fill)'
            : remPct < 50 ? 'var(--ed-warn-fill)' : 'var(--ed-good-fill)';
        const displayFrac = (frac: number) => directionMode === 'used' ? Math.max(0, 1 - frac) : frac;
        const lowLabel = minimum === null ? '' : quotaPercentage(displayFrac(directionMode === 'used' && group.maximum !== null ? group.maximum : minimum));
        const highLabel = group.maximum === null ? '' : quotaPercentage(displayFrac(directionMode === 'used' && minimum !== null ? minimum : group.maximum));
        const winBadgeHtml = `<span class="quota-mode-badge" data-quota-window-mode="${esc(windowMode)}" data-quota-effective-window="${esc(primaryProj.effectiveWindow ?? 'unknown')}" data-quota-direction="${esc(directionMode)}">${tBiHtml(primaryProj.metricLabelEn, primaryProj.metricLabelZh)}</span>`;
        const percentagePlain = pct === null ? tBi('Unknown', '未知') : group.quotaDiffers && lowLabel !== highLabel
            ? `${lowLabel}–${highLabel}%` : `${lowLabel}%`;
        const percentageHtml = pct === null
            ? tBiHtml('Unknown', '未知')
            : `${winBadgeHtml} <span class="model-card-pct-val">${esc(percentagePlain)}</span>`;
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
                `当前可用档位：${listZh} · 各档位共用该配额池配额。`,
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
                            <span>${reading.remaining === null ? tBiHtml('Unknown', '未知') : `${esc(quotaPercentage(displayFrac(reading.remaining)))}% (${tBiHtml(primaryProj.directionLabelEn, primaryProj.directionLabelZh)})`}</span>
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
        const dualHeaderSummary = hasDualWindow
            ? `<span class="model-card-pct${primaryProj.isUnavailable ? ' is-unknown' : ''}" data-quota-projected="true">${winBadgeHtml}${primaryProj.isUnavailable ? '' : ` <span class="model-card-pct-val">${esc(formatProjectedPct(primaryProj.displayPct))}</span>`}</span>`
            : `<span class="model-card-pct${pct === null ? ' is-unknown' : ''}">${percentageHtml}</span>`;
        const metersHtml = hasDualWindow
            ? `<div class="quota-dual-row">
                    ${group.fiveHourQuota ? renderDualWindowBar(groupSlug, group.label, '5h', group.fiveHourQuota, scopePrefix, directionMode, primaryProj.effectiveWindow === '5h') : ''}
                    ${group.weeklyQuota ? renderDualWindowBar(groupSlug, group.label, 'weekly', group.weeklyQuota, scopePrefix, directionMode, primaryProj.effectiveWindow === '7d') : ''}
                </div>`
            : `<div class="quota-bar-wrap${pct === null ? ' is-unknown' : ''}" role="progressbar" aria-label="${esc(`${group.label} ${tBi(primaryProj.windowLabelEn, primaryProj.windowLabelZh)} ${tBi(primaryProj.directionLabelEn, primaryProj.directionLabelZh)}`)}"
                    aria-valuemin="0" aria-valuemax="100"${pct === null ? '' : ` aria-valuenow="${pct}"`} aria-valuetext="${esc(`${percentagePlain} ${tBi(primaryProj.directionLabelEn, primaryProj.directionLabelZh)}`)}">
                    ${pct === null ? '' : `<div class="quota-bar ${barTone}" style="width:${pct}%;background:${barColor}"></div>`}
                </div>
                <div class="model-card-meta"><span class="model-card-reset">${resetLabelHtml}</span></div>`;
        return `
            <div class="model-card" data-quota-family="${esc(group.key)}" data-quota-window-mode="${esc(windowMode)}" data-quota-direction="${esc(directionMode)}">
                <div class="model-card-header">
                    <span class="model-card-name">
                        <span class="model-card-name-text"${groupNameTip}>${esc(group.label)}</span>${tagBadge}
                    </span>
                    ${dualHeaderSummary}
                </div>
                ${members}
                ${metersHtml}
                ${details}
            </div>`;
    }).join('');

    if (options.embedded) {
        return `<div class="model-grid" data-quota-window-mode="${esc(windowMode)}" data-quota-direction="${esc(directionMode)}">${cards}</div>`;
    }

    return `
        <section class="card model-quota-section" data-quota-window-mode="${esc(windowMode)}" data-quota-direction="${esc(directionMode)}">
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
    const limits = [
        { key: 'max-input', field: 'maxNumChatInputTokens', en: 'Chat input', zh: '聊天输入', unitEn: 'tokens', unitZh: 'tokens' },
        { key: 'premium-messages', field: 'maxNumPremiumChatMessages', en: 'Premium messages', zh: '高级消息数' },
        { key: 'custom-instructions', field: 'maxCustomChatInstructionCharacters', en: 'Custom instructions', zh: '自定义指令', unitEn: 'characters', unitZh: '字符' },
        { key: 'pinned-context', field: 'maxNumPinnedContextItems', en: 'Pinned context', zh: '固定上下文', unitEn: 'items', unitZh: '项' },
        { key: 'local-index', field: 'maxLocalIndexSize', en: 'Local index size', zh: '本地索引大小' },
        { key: 'flex-credits', field: 'monthlyFlexCreditPurchaseAmount', en: 'Monthly Flex credit purchase amount', zh: '每月 Flex 积分购买量' },
    ] satisfies { key: string; field: keyof UserStatusInfo['planLimits']; en: string; zh: string; unitEn?: string; unitZh?: string }[];
    const rows = limits.map(({ key, field, en, zh, unitEn, unitZh }) => {
        const value = pl?.[field];
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < -1) { return ''; }
        const amount = value === -1
            ? tBiHtml('No numeric limit (−1)', '未给定数值上限（−1）')
            : esc(formatNumber(value)) + (unitEn && unitZh ? ` ${tBiHtml(unitEn, unitZh)}` : '');
        const tip = richTipAttrs(`profile-limit-${key}`, en, zh,
            `Account configuration field: planInfo.${field}.`, `账号计划字段：planInfo.${field}。`);
        return `<div class="profile-metric-card" data-plan-limit="${key}"${tip}>
            <dt class="profile-metric-label">${tBiHtml(en, zh)}</dt>
            <dd class="profile-metric-value">${amount}</dd>
        </div>`;
    }).join('');
    return `<section class="profile-tech-section">
        <h3 class="profile-sub-heading">${ICON.shield} <span>${tBiHtml('Account plan parameters', '账号计划参数')}</span></h3>
        ${rows ? `<p class="spec-description">${tBiHtml(
            'Configuration reported by the host. For the current context window and remaining model quota, see Overview.',
            '以下为宿主返回的账号配置。当前会话的上下文窗口和模型剩余配额可在概览查看。',
        )}</p><dl class="profile-metric-grid">${rows}</dl>`
            : `<p class="empty-msg">${tBiHtml('The host has not reported plan parameters.', '宿主尚未上报计划参数。')}</p>`}
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

    const allFeatures: CapabilityChip[] = [
        { id: 'web-search', labelEn: 'Web Search', labelZh: '网页搜索', descEn: 'Live web search for docs.', descZh: '允许智能体联网检索。', enabled: !!userInfo.cascadeWebSearchEnabled },
        { id: 'browser', labelEn: 'Browser', labelZh: '浏览器', descEn: 'Built-in browser subagent.', descZh: '允许内置浏览器子智能体。', enabled: !!userInfo.browserEnabled },
        { id: 'knowledge-base', labelEn: 'Knowledge Base', labelZh: '知识库', descEn: 'Cross-session workspace knowledge indexing.', descZh: '跨会话工作区知识库索引。', enabled: !!userInfo.knowledgeBaseEnabled },
        { id: 'commit-msg', labelEn: 'Commit Msg', labelZh: '提交信息', descEn: 'AI-generated Git commit messages.', descZh: '自动生成 Git 提交信息。', enabled: !!userInfo.canGenerateCommitMessages },
        { id: 'auto-run', labelEn: 'Auto Run', labelZh: '自动执行', descEn: 'Permits auto-running terminal commands.', descZh: '允许自动执行终端命令。', enabled: !!userInfo.cascadeCanAutoRunCommands },
        { id: 'background', labelEn: 'Background', labelZh: '后台', descEn: 'Allows background agent execution.', descZh: '允许后台运行任务。', enabled: !!userInfo.canAllowCascadeInBackground },
        { id: 'buy-credits', labelEn: 'Buy Credits', labelZh: '购买积分', descEn: 'Can purchase extra AI Credits.', descZh: '支持额外加购 AI 积分。', enabled: !!userInfo.canBuyMoreCredits },
        { id: 'fast-autocomplete', labelEn: 'Fast Autocomplete', labelZh: '快速补全', descEn: 'Low-latency inline autocomplete.', descZh: '低延迟行内代码补全。', enabled: !!userInfo.hasAutocompleteFastMode },
        { id: 'sticky-premium', labelEn: 'Sticky Premium', labelZh: '锁定高级', descEn: 'Keeps premium model across new chats.', descZh: '新建对话保持高级模型。', enabled: !!userInfo.allowStickyPremiumModels },
        { id: 'command-models', labelEn: 'Command Models', labelZh: '命令模型', descEn: 'Premium models for inline quick-edit.', descZh: '行内快捷编辑使用高级模型。', enabled: !!userInfo.allowPremiumCommandModels },
        { id: 'tab-jump', labelEn: 'Tab Jump', labelZh: 'Tab 跳转', descEn: 'Predicts next edit location on Tab.', descZh: '按 Tab 跳转下一编辑处。', enabled: !!userInfo.hasTabToJump },
        { id: 'custom-icon', labelEn: 'Custom Icon', labelZh: '自定义图标', descEn: 'Custom Antigravity app icon.', descZh: '允许自定义应用图标。', enabled: !!userInfo.canCustomizeAppIcon },
    ];
    const featureTags = allFeatures.map(f => renderChip('profile-flag', f)).join('');

    const tc = userInfo.teamConfig;
    const teamFeatures: CapabilityChip[] = [
        { id: 'mcp-servers', labelEn: 'MCP Servers', labelZh: 'MCP 服务', descEn: 'Org policy for external MCP tool servers.', descZh: '团队策略：允许外部 MCP 工具服务。', enabled: !!tc?.allowMcpServers },
        { id: 'auto-run-cmd', labelEn: 'Auto Run Cmd', labelZh: '自动执行命令', descEn: 'Org policy for auto shell commands.', descZh: '团队策略：允许自动执行命令。', enabled: !!tc?.allowAutoRunCommands },
        { id: 'browser-experimental', labelEn: 'Browser Experimental', labelZh: '浏览器实验', descEn: 'Org policy for experimental browser features.', descZh: '团队策略：允许实验性浏览器功能。', enabled: !!tc?.allowBrowserExperimentalFeatures },
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

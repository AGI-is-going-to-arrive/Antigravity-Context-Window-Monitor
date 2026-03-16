import * as vscode from 'vscode';
import { t, tBi, getLanguage, setLanguage, Language } from './i18n';
import { ContextUsage } from './tracker';
import { ModelConfig, UserStatusInfo } from './models';
import { formatTokenCount, formatContextLimit, calculateCompressionStats } from './statusbar';

// ─── Panel State ──────────────────────────────────────────────────────────────

let panel: vscode.WebviewPanel | undefined;
let extensionCtx: vscode.ExtensionContext | undefined;

/** Cached data for re-rendering after language switch. */
let lastUsage: ContextUsage | null = null;
let lastAllUsages: ContextUsage[] = [];
let lastConfigs: ModelConfig[] = [];
let lastUserInfo: UserStatusInfo | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Show or reveal the WebView monitor panel.
 * Creates the panel on first call, reveals it on subsequent calls.
 */
export function showMonitorPanel(
    currentUsage: ContextUsage | null,
    allTrajectoryUsages: ContextUsage[],
    modelConfigs: ModelConfig[],
    userInfo: UserStatusInfo | null,
    context?: vscode.ExtensionContext,
): void {
    lastUsage = currentUsage;
    lastAllUsages = allTrajectoryUsages;
    lastConfigs = modelConfigs;
    lastUserInfo = userInfo;
    if (context) { extensionCtx = context; }

    if (panel) {
        panel.webview.html = buildHtml(currentUsage, allTrajectoryUsages, modelConfigs, userInfo);
        panel.reveal(vscode.ViewColumn.Two, true);
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'antigravityMonitor',
        `${tBi('Context Monitor', '上下文监控')}`,
        { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true },
    );

    panel.webview.html = buildHtml(currentUsage, allTrajectoryUsages, modelConfigs, userInfo);

    panel.webview.onDidReceiveMessage(async (msg: { command: string; lang?: string }) => {
        if (msg.command === 'switchLanguage' && msg.lang && extensionCtx) {
            await setLanguage(msg.lang as Language, extensionCtx);
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo);
            }
            vscode.commands.executeCommand('antigravity-context-monitor.refresh');
        } else if (msg.command === 'refresh') {
            vscode.commands.executeCommand('antigravity-context-monitor.refresh');
        }
    });

    panel.onDidDispose(() => { panel = undefined; });
}

/**
 * Silently update the panel if it is already visible.
 * Does NOT steal focus or create a new panel.
 */
export function updateMonitorPanel(
    currentUsage: ContextUsage | null,
    allTrajectoryUsages: ContextUsage[],
    modelConfigs: ModelConfig[],
    userInfo: UserStatusInfo | null,
): void {
    lastUsage = currentUsage;
    lastAllUsages = allTrajectoryUsages;
    lastConfigs = modelConfigs;
    lastUserInfo = userInfo;
    if (panel) {
        panel.webview.html = buildHtml(currentUsage, allTrajectoryUsages, modelConfigs, userInfo);
    }
}

/** Whether the monitor panel is currently open. */
export function isMonitorPanelVisible(): boolean {
    return panel !== undefined;
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const ICON = {
    chart: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M0 0h1v15h15v1H0zm14.817 3.113a.5.5 0 0 1 .07.704l-4.5 5.5a.5.5 0 0 1-.74.037L7.06 6.767l-3.656 5.027a.5.5 0 0 1-.808-.588l4-5.5a.5.5 0 0 1 .758-.06l2.609 2.61 4.15-5.073a.5.5 0 0 1 .704-.07"/></svg>',
    clock: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/><path fill="currentColor" d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/></svg>',
    chat: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4.414A2 2 0 0 0 3 11.586l-2 2V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12.793a.5.5 0 0 0 .854.353l2.853-2.853A1 1 0 0 1 4.414 12H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/></svg>',
    compress: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M3 3a1 1 0 0 0-1 1v3.293l2.646-2.647a.5.5 0 0 1 .708.708L2.707 8l2.647 2.646a.5.5 0 0 1-.708.708L2 8.707V12a1 1 0 0 0 1 1h3.293l-2.647-2.646a.5.5 0 0 1 .708-.708L7 12.293V8.707L4.354 6.061a.5.5 0 1 1 .707-.707L7 7.293V3.707L4.354 1.061a.5.5 0 1 1 .707-.707L7 2.293V0h2v2.293l1.939-1.94a.5.5 0 1 1 .707.708L9 3.707v3.586l2.646-2.647a.5.5 0 1 1 .708.707L9 8.707v3.586l2.646-2.647a.5.5 0 0 1 .708.708L9.707 13H13a1 1 0 0 0 1-1V8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L13.293 8l-2.647-2.646a.5.5 0 0 1 .708-.708L14 7.293V4a1 1 0 0 0-1-1H9.707l2.647-2.646a.5.5 0 0 0-.708-.708L9 2.293V0H7v2.293L5.061.354a.5.5 0 1 0-.707.707L7 3.707V7.293L4.354 4.646a.5.5 0 1 0-.708.708L7 8.707V12.293l-2.646-2.647a.5.5 0 0 0-.708.708L6.293 13H3a1 1 0 0 1-1-1V8.707l2.646 2.647a.5.5 0 0 0 .708-.708L2.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L2 7.293V4a1 1 0 0 1 1-1h3.293L3.646 .354a.5.5 0 0 0 .708-.708z"/></svg>',
    refresh: '<svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2H4.466a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9"/><path fill="currentColor" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"/></svg>',
    bolt: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M5.52.359A.5.5 0 0 1 6 0h4a.5.5 0 0 1 .474.658L8.694 6H12.5a.5.5 0 0 1 .395.807l-7 9a.5.5 0 0 1-.873-.454L6.823 9H3.5a.5.5 0 0 1-.48-.641z"/></svg>',
    user: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z"/></svg>',
    image: '<svg class="icon" viewBox="0 0 16 16" width="10" height="10"><path fill="currentColor" d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/><path fill="currentColor" d="M2.002 1a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2zm12 1a1 1 0 0 1 1 1v6.5l-3.777-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12V3a1 1 0 0 1 1-1z"/></svg>',
    shield: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M5.338 1.59a61 61 0 0 0-2.837.856.48.48 0 0 0-.328.39c-.554 4.157.726 7.19 2.253 9.188a10.7 10.7 0 0 0 2.287 2.233c.346.244.652.42.893.533q.18.085.293.118a1 1 0 0 0 .101.025 1 1 0 0 0 .1-.025q.114-.034.294-.118c.24-.113.547-.29.893-.533a10.7 10.7 0 0 0 2.287-2.233c1.527-1.997 2.807-5.031 2.253-9.188a.48.48 0 0 0-.328-.39c-.651-.213-1.75-.56-2.837-.855C9.552 1.29 8.531 1.067 8 1.067c-.53 0-1.552.223-2.662.524zM5.072.56C6.157.265 7.31 0 8 0s1.843.265 2.928.56c1.11.3 2.229.655 2.887.87a1.54 1.54 0 0 1 1.044 1.262c.596 4.477-.787 7.795-2.465 9.99a11.8 11.8 0 0 1-2.517 2.453 7 7 0 0 1-1.048.625 2.5 2.5 0 0 1-.444.2 1 1 0 0 1-.385.063 1 1 0 0 1-.385-.063 2.5 2.5 0 0 1-.444-.2 7 7 0 0 1-1.048-.625 11.8 11.8 0 0 1-2.517-2.453C1.928 10.487.545 7.169 1.141 2.692A1.54 1.54 0 0 1 2.185 1.43 63 63 0 0 1 5.072.56"/></svg>',
} as const;

// ─── HTML Builder ─────────────────────────────────────────────────────────────

function buildHtml(usage: ContextUsage | null, allUsages: ContextUsage[], configs: ModelConfig[], userInfo: UserStatusInfo | null): string {
    const sections: string[] = [];

    // ━━━ Account & Plan ━━━
    if (userInfo) {
        const tierMap: Record<string, { bg: string; color: string }> = {
            'TEAMS_TIER_FREE': { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af' },
            'TEAMS_TIER_PRO': { bg: 'rgba(74,222,128,0.15)', color: 'var(--color-ok)' },
            'TEAMS_TIER_TEAMS': { bg: 'rgba(96,165,250,0.15)', color: 'var(--color-info)' },
            'TEAMS_TIER_ENTERPRISE_SAAS': { bg: 'rgba(192,132,252,0.15)', color: '#c084fc' },
            'TEAMS_TIER_PRO_ULTIMATE': { bg: 'rgba(250,204,21,0.15)', color: 'var(--color-warn)' },
        };
        const tier = tierMap[userInfo.teamsTier] || tierMap['TEAMS_TIER_PRO'];
        const promptPct = userInfo.monthlyPromptCredits > 0
            ? Math.round((userInfo.availablePromptCredits / userInfo.monthlyPromptCredits) * 100) : 0;
        const flowPct = userInfo.monthlyFlowCredits > 0
            ? Math.round((userInfo.availableFlowCredits / userInfo.monthlyFlowCredits) * 100) : 0;
        const promptBarColor = promptPct <= 10 ? 'var(--color-danger)' : promptPct <= 30 ? 'var(--color-warn)' : 'var(--color-ok)';
        const flowBarColor = flowPct <= 10 ? 'var(--color-danger)' : flowPct <= 30 ? 'var(--color-warn)' : 'var(--color-info)';

        // Mask helpers for privacy
        const maskedEmail = userInfo.email.replace(/^(.{2}).*(@.*)$/, '$1****$2');

        // --- Plan Limits table ---
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

        // --- All Feature Flags ---
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

        // --- Team Config ---
        const tc = userInfo.teamConfig;
        const teamTags = [
            { label: tBi('MCP Servers', 'MCP 服务'), enabled: tc.allowMcpServers },
            { label: tBi('Auto Run Cmd', '自动执行命令'), enabled: tc.allowAutoRunCommands },
            { label: tBi('Browser Experimental', '浏览器实验'), enabled: tc.allowBrowserExperimentalFeatures },
        ].map(f => `<span class="feature-tag${f.enabled ? ' enabled' : ''}">${f.label}</span>`).join('');

        // --- Google Credits ---
        let creditsHtml = '';
        if (userInfo.availableCredits.length > 0) {
            const creditRows = userInfo.availableCredits.map(c => {
                const typeName = c.creditType.replace('CREDIT_TYPE_', '').replace(/_/g, ' ');
                return `<div class="detail-row">
                    <span>${typeName}</span>
                    <span>${c.creditAmount.toLocaleString()} (min: ${c.minimumCreditAmountForUsage})</span>
                </div>`;
            }).join('');
            creditsHtml = `
                <details class="collapsible" id="d-credits">
                    <summary>${ICON.bolt} ${tBi('Google AI Credits', 'Google AI 额度')}</summary>
                    <div class="details-body">${creditRows}</div>
                </details>`;
        }

        sections.push(`
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
                <details class="collapsible" id="d-limits">
                    <summary>${tBi('Plan Limits', '计划限制')}</summary>
                    <div class="details-body">${limitsRows}</div>
                </details>
                <details class="collapsible" id="d-features">
                    <summary>${tBi('Feature Flags', '功能开关')}</summary>
                    <div class="details-body"><div class="feature-tags">${featureTags}</div></div>
                </details>
                <details class="collapsible" id="d-team">
                    <summary>${tBi('Team Config', '团队配置')}</summary>
                    <div class="details-body"><div class="feature-tags">${teamTags}</div></div>
                </details>
                ${creditsHtml}
            </section>`);
    }

    // ━━━ Quota Monitor ━━━
    const quotaModels = configs.filter(c => c.quotaInfo);
    if (quotaModels.length > 0) {
        const quotaRows = quotaModels.map(c => {
            const qi = c.quotaInfo!;
            const pct = Math.round(qi.remainingFraction * 100);
            const barColor = pct <= 20 ? 'var(--color-danger)' : pct <= 50 ? 'var(--color-warn)' : 'var(--color-ok)';
            let resetLabel = '';
            if (qi.resetTime) {
                try {
                    const d = new Date(qi.resetTime);
                    resetLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                } catch { resetLabel = ''; }
            }
            const tagHtml = c.tagTitle ? `<span class="badge info-badge">${esc(c.tagTitle)}</span>` : '';
            const imgTag = c.supportsImages ? `<span class="badge ok-badge">${ICON.image} IMG</span>` : '';
            const mimeTag = c.mimeTypeCount > 0 ? `<span class="mime-count">${c.mimeTypeCount} MIME</span>` : '';
            return `
                <div class="quota-row">
                    <div class="quota-label">${esc(c.label)} ${tagHtml} ${imgTag}</div>
                    <div class="quota-bar-wrap">
                        <div class="quota-bar" style="width:${pct}%;background:${barColor}"></div>
                    </div>
                    <div class="quota-meta">
                        <span class="quota-pct">${pct}%</span>
                        <span>${mimeTag}</span>
                        ${resetLabel ? `<span class="quota-reset">${tBi('Reset', '重置')}: ${resetLabel}</span>` : ''}
                    </div>
                </div>`;
        }).join('');

        sections.push(`
            <section class="card">
                <h2>${ICON.bolt} ${tBi('Model Quota', '模型配额')}</h2>
                ${quotaRows}
            </section>`);
    }

    // ━━━ Current Session ━━━
    if (usage) {
        const remaining = Math.max(0, usage.contextLimit - usage.contextUsed);
        const pct = Math.min(usage.usagePercent, 100);
        const barColor = pct >= 80 ? 'var(--color-danger)' : pct >= 50 ? 'var(--color-warn)' : 'var(--color-ok)';
        const sourceTag = usage.isEstimated
            ? `<span class="badge warn-badge">${t('panel.estimated')}</span>`
            : `<span class="badge ok-badge">${t('panel.preciseShort')}</span>`;

        const compressionStats = calculateCompressionStats(usage);
        let compressHtml = '';
        if (compressionStats) {
            compressHtml = `
                <div class="compression-alert">
                    ${ICON.compress}
                    <span>${t('panel.compression')}: -${formatTokenCount(compressionStats.dropTokens)} (${compressionStats.dropPercent.toFixed(1)}%)</span>
                </div>`;
        }

        // Checkpoint details
        let checkpointHtml = '';
        if (usage.lastModelUsage) {
            const mu = usage.lastModelUsage;
            checkpointHtml = `
                <div class="checkpoint-section">
                    <div class="section-subtitle">${t('tooltip.lastCheckpoint')}</div>
                    <div class="stat-grid three-col">
                        <div class="stat mini">
                            <div class="stat-label">${t('tooltip.input')}</div>
                            <div class="stat-value">${mu.inputTokens.toLocaleString()}</div>
                        </div>
                        <div class="stat mini">
                            <div class="stat-label">${t('tooltip.output')}</div>
                            <div class="stat-value">${mu.outputTokens.toLocaleString()}</div>
                        </div>
                        <div class="stat mini">
                            <div class="stat-label">${t('tooltip.cache')}</div>
                            <div class="stat-value">${mu.cacheReadTokens.toLocaleString()}</div>
                        </div>
                    </div>
                </div>`;
        }

        let deltaHtml = '';
        if (usage.estimatedDeltaSinceCheckpoint > 0 && usage.lastModelUsage) {
            deltaHtml = `
                <div class="delta-hint">
                    ${t('tooltip.estDelta')}: +${usage.estimatedDeltaSinceCheckpoint.toLocaleString()} tokens (${t('tooltip.sinceCheckpoint')})
                </div>`;
        }

        sections.push(`
            <section class="card">
                <h2>
                    ${ICON.clock}
                    ${t('panel.currentSession')}
                    ${sourceTag}
                </h2>
                <div class="stat-grid">
                    <div class="stat">
                        <div class="stat-label">${t('tooltip.model')}</div>
                        <div class="stat-value">${esc(usage.modelDisplayName)}</div>
                    </div>
                    <div class="stat">
                        <div class="stat-label">${t('tooltip.session')}</div>
                        <div class="stat-value title-val">${esc(usage.title || usage.cascadeId.substring(0, 8))}</div>
                    </div>
                </div>
                <div class="progress-section">
                    <div class="progress-header">
                        <span>${tBi('Context Usage', '上下文使用')}</span>
                        <span class="progress-pct">${usage.usagePercent.toFixed(1)}%</span>
                    </div>
                    <div class="progress-bar-wrap">
                        <div class="progress-bar" style="width:${Math.min(pct, 100)}%;background:${barColor}"></div>
                    </div>
                    <div class="progress-detail">
                        ${formatTokenCount(usage.contextUsed)} / ${formatContextLimit(usage.contextLimit)}
                        <span class="dim">(${t('panel.remaining')}: ${formatTokenCount(remaining)})</span>
                    </div>
                </div>
                <div class="stat-grid four-col">
                    <div class="stat mini">
                        <div class="stat-label">${t('tooltip.steps')}</div>
                        <div class="stat-value">${usage.stepCount}</div>
                    </div>
                    <div class="stat mini">
                        <div class="stat-label">${t('tooltip.modelOutput')}</div>
                        <div class="stat-value">${formatTokenCount(usage.totalOutputTokens)}</div>
                    </div>
                    <div class="stat mini">
                        <div class="stat-label">${t('tooltip.toolResults')}</div>
                        <div class="stat-value">${formatTokenCount(usage.totalToolCallOutputTokens)}</div>
                    </div>
                    <div class="stat mini">
                        <div class="stat-label">${t('tooltip.imageGen')}</div>
                        <div class="stat-value">${usage.imageGenStepCount}</div>
                    </div>
                </div>
                ${compressHtml}
                ${checkpointHtml}
                ${deltaHtml}
            </section>`);
    } else {
        sections.push(`
            <section class="card empty">
                <h2>${ICON.clock} ${tBi('Waiting for Session', '等待会话')}</h2>
                <p class="empty-desc">${tBi(
                    'Start a conversation in Antigravity to see usage data.',
                    '在 Antigravity 中开始对话即可查看使用数据。',
                )}</p>
            </section>`);
    }

    // ━━━ Other Sessions ━━━
    const others = allUsages.filter(u => u.cascadeId !== usage?.cascadeId);
    if (others.length > 0) {
        const rows = others.slice(0, 10).map(u => {
            const pct = Math.min(u.usagePercent, 100);
            const barColor = pct >= 80 ? 'var(--color-danger)' : pct >= 50 ? 'var(--color-warn)' : 'var(--color-ok)';
            const compTag = u.compressionDetected ? '<span class="badge danger-badge">COMP</span>' : '';
            return `
                <div class="session-row">
                    <div class="session-title">${esc(u.title || u.cascadeId.substring(0, 8))} ${compTag}</div>
                    <div class="session-model">${esc(u.modelDisplayName)}</div>
                    <div class="session-bar-wrap">
                        <div class="session-bar" style="width:${pct}%;background:${barColor}"></div>
                    </div>
                    <div class="session-pct">${u.usagePercent.toFixed(1)}% | ${formatTokenCount(u.contextUsed)}/${formatContextLimit(u.contextLimit)}</div>
                </div>`;
        }).join('');

        sections.push(`
            <section class="card">
                <h2>${ICON.chat} ${t('panel.otherSessions')}</h2>
                ${rows}
            </section>`);
    }

    // ━━━ No data fallback ━━━
    if (sections.length === 0) {
        sections.push(`
            <section class="card empty">
                <h2>${t('panel.noData')}</h2>
            </section>`);
    }

    const currentLang = getLanguage();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
${getStyles()}
</style>
</head>
<body>
    <header class="panel-header">
        <h1>
            ${ICON.chart}
            ${tBi('Context Monitor', '上下文监控')}
        </h1>
        <div class="header-actions">
            <div class="lang-switcher">
                <button class="lang-btn${currentLang === 'zh' ? ' active' : ''}" data-lang="zh">中文</button>
                <button class="lang-btn${currentLang === 'en' ? ' active' : ''}" data-lang="en">EN</button>
                <button class="lang-btn${currentLang === 'both' ? ' active' : ''}" data-lang="both">${tBi('Both', '双语')}</button>
            </div>
            <button class="action-btn" id="refreshBtn" data-tooltip="${tBi('Refresh', '刷新')}">
                ${ICON.refresh}
            </button>
            <span class="update-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
    </header>
    ${sections.join('')}
    <script>
        (function() {
            var vscode = acquireVsCodeApi();
            var savedState = vscode.getState() || {};

            // ─── Language Switcher ───
            var switcher = document.querySelector('.lang-switcher');
            if (switcher) {
                switcher.addEventListener('click', function(e) {
                    var btn = e.target;
                    if (btn.classList && btn.classList.contains('lang-btn')) {
                        vscode.postMessage({ command: 'switchLanguage', lang: btn.dataset.lang });
                    }
                });
            }

            // ─── Refresh Button ───
            var refreshBtn = document.getElementById('refreshBtn');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', function() {
                    this.classList.add('spinning');
                    vscode.postMessage({ command: 'refresh' });
                });
            }

            // ─── Restore & persist collapsible states ───
            var detailsOpen = savedState.detailsOpen || {};
            var allDetails = document.querySelectorAll('details.collapsible[id]');
            for (var i = 0; i < allDetails.length; i++) {
                var d = allDetails[i];
                if (detailsOpen[d.id]) { d.setAttribute('open', ''); }
                d.addEventListener('toggle', function() {
                    var s = vscode.getState() || {};
                    var ds = s.detailsOpen || {};
                    ds[this.id] = this.open;
                    s.detailsOpen = ds;
                    vscode.setState(s);
                });
            }

            // ─── Privacy mask toggle (persisted) ───
            var privacyBtn = document.getElementById('privacyToggle');
            if (privacyBtn) {
                var masked = !!savedState.privacyMasked;
                function applyMask(m) {
                    var targets = document.querySelectorAll('[data-real][data-masked]');
                    for (var j = 0; j < targets.length; j++) {
                        var el = targets[j];
                        el.textContent = m ? el.getAttribute('data-masked') : el.getAttribute('data-real');
                    }
                    privacyBtn.classList.toggle('active', m);
                }
                if (masked) { applyMask(true); }
                privacyBtn.addEventListener('click', function() {
                    masked = !masked;
                    applyMask(masked);
                    var s = vscode.getState() || {};
                    s.privacyMasked = masked;
                    vscode.setState(s);
                });
            }

            // ─── Restore scroll position ───
            var scrollY = savedState.scrollY || 0;
            if (scrollY > 0) { window.scrollTo(0, scrollY); }
            window.addEventListener('scroll', function() {
                var s = vscode.getState() || {};
                s.scrollY = window.scrollY;
                vscode.setState(s);
            });
        })();
    </script>
</body>
</html>`;
}

// ─── Escape HTML ──────────────────────────────────────────────────────────────

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function getStyles(): string {
    return `
        :root {
            --color-ok: #4ade80;
            --color-warn: #facc15;
            --color-danger: #f87171;
            --color-info: #60a5fa;
            --color-surface: rgba(255,255,255,0.04);
            --color-border: rgba(255,255,255,0.08);
            --color-text: var(--vscode-foreground, #ccc);
            --color-text-dim: var(--vscode-descriptionForeground, #888);
            --color-bg: var(--vscode-editor-background, #1e1e1e);

            --radius-sm: 4px;
            --radius-md: 8px;
            --radius-lg: 12px;

            --space-1: 4px;
            --space-2: 8px;
            --space-3: 12px;
            --space-4: 16px;
            --space-6: 24px;

            --z-dropdown: 100;
            --z-sticky: 200;
            --z-overlay: 300;
            --z-modal: 400;
            --z-toast: 500;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        ::selection {
            background: var(--color-info);
            color: #fff;
        }

        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.15);
            border-radius: var(--radius-sm);
        }

        body {
            font-family: var(--vscode-font-family, -apple-system, 'Segoe UI', sans-serif);
            font-size: var(--vscode-font-size, 13px);
            color: var(--color-text);
            background: var(--color-bg);
            padding: var(--space-4);
            line-height: 1.5;
            -webkit-tap-highlight-color: transparent;
        }

        /* ─── Header ────────────────── */
        .panel-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: var(--space-4);
            padding-bottom: var(--space-3);
            border-bottom: 1px solid var(--color-border);
        }

        .panel-header h1 {
            font-size: 1.1em;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }

        .update-time {
            color: var(--color-text-dim);
            font-size: 0.85em;
        }

        /* ─── Language Switcher ──────── */
        .lang-switcher {
            display: flex;
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            overflow: hidden;
        }

        .lang-btn {
            appearance: none;
            background: transparent;
            color: var(--color-text-dim);
            border: none;
            padding: var(--space-1) var(--space-2);
            font-size: 0.75em;
            font-family: inherit;
            cursor: pointer;
            transition: background 0.15s cubic-bezier(.4,0,.2,1), color 0.15s cubic-bezier(.4,0,.2,1);
            border-right: 1px solid var(--color-border);
        }

        .lang-btn:last-child { border-right: none; }

        .lang-btn.active {
            background: var(--color-info);
            color: #fff;
        }

        .lang-btn:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
            outline: none;
        }

        .lang-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .lang-btn:not(.active):hover {
                background: rgba(255,255,255,0.08);
                color: var(--color-text);
            }
        }

        /* ─── Action Button ─────────── */
        .action-btn {
            appearance: none;
            background: transparent;
            color: var(--color-text-dim);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            padding: var(--space-1);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s cubic-bezier(.4,0,.2,1), color 0.15s cubic-bezier(.4,0,.2,1), border-color 0.15s cubic-bezier(.4,0,.2,1);
        }

        .action-btn:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
            outline: none;
        }

        .action-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .action-btn:hover {
                background: rgba(255,255,255,0.08);
                color: var(--color-text);
                border-color: rgba(255,255,255,0.15);
            }
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .action-btn.spinning svg {
            animation: spin 0.6s linear;
        }

        /* ─── Icons ─────────────────── */
        .icon {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
        }

        /* ─── Card ──────────────────── */
        .card {
            background: var(--color-surface);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-lg);
            padding: var(--space-4);
            margin-bottom: var(--space-3);
            transition: border-color 0.2s cubic-bezier(.4,0,.2,1);
        }

        @media (hover: hover) {
            .card:hover {
                border-color: rgba(255,255,255,0.15);
            }
        }

        .card h2 {
            font-size: 0.9em;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--color-text-dim);
            margin-bottom: var(--space-3);
            display: flex;
            align-items: center;
            gap: var(--space-2);
        }

        .card.empty {
            text-align: center;
            padding: var(--space-6);
            color: var(--color-text-dim);
        }

        .empty-desc {
            font-size: 0.85em;
            color: var(--color-text-dim);
            margin-top: var(--space-2);
            opacity: 0.7;
        }

        /* ─── Badges ─────────────────── */
        .badge {
            font-size: 0.7em;
            padding: 1px 6px;
            border-radius: var(--radius-sm);
            text-transform: uppercase;
            letter-spacing: 0.3px;
            font-weight: 700;
        }

        .warn-badge {
            background: rgba(250, 204, 21, 0.15);
            color: var(--color-warn);
        }

        .ok-badge {
            background: rgba(74, 222, 128, 0.15);
            color: var(--color-ok);
        }

        .danger-badge {
            background: rgba(248, 113, 113, 0.15);
            color: var(--color-danger);
            font-size: 0.65em;
        }

        /* ─── Stat Grid ──────────────── */
        .stat-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: var(--space-2);
            margin-bottom: var(--space-3);
        }

        .stat-grid.three-col { grid-template-columns: 1fr 1fr 1fr; }
        .stat-grid.four-col { grid-template-columns: 1fr 1fr 1fr 1fr; }

        .stat {
            background: rgba(255,255,255,0.02);
            border-radius: var(--radius-md);
            padding: var(--space-2) var(--space-3);
        }

        .stat.mini { padding: var(--space-1) var(--space-2); }

        .stat-label {
            font-size: 0.75em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .stat-value {
            font-weight: 600;
            font-size: 0.95em;
            word-break: break-all;
        }

        .stat-value.title-val {
            font-size: 0.85em;
            font-weight: 400;
        }

        /* ─── Progress Bar ────────────── */
        .progress-section { margin-bottom: var(--space-3); }

        .progress-header {
            display: flex;
            justify-content: space-between;
            font-size: 0.85em;
            margin-bottom: var(--space-1);
        }

        .progress-pct { font-weight: 700; }

        .progress-bar-wrap {
            height: 8px;
            background: rgba(255,255,255,0.06);
            border-radius: var(--radius-sm);
            overflow: hidden;
        }

        .progress-bar {
            height: 100%;
            border-radius: var(--radius-sm);
            transition: width 0.4s cubic-bezier(.4,0,.2,1);
        }

        .progress-detail {
            font-size: 0.8em;
            margin-top: var(--space-1);
            color: var(--color-text-dim);
        }

        .dim { opacity: 0.6; }

        /* ─── Compression Alert ────────── */
        .compression-alert {
            display: flex;
            align-items: center;
            gap: var(--space-2);
            background: rgba(248, 113, 113, 0.1);
            border: 1px solid rgba(248, 113, 113, 0.2);
            border-radius: var(--radius-md);
            padding: var(--space-2) var(--space-3);
            margin-bottom: var(--space-3);
            font-size: 0.85em;
            color: var(--color-danger);
        }

        /* ─── Checkpoint Section ────────── */
        .checkpoint-section {
            border-top: 1px solid var(--color-border);
            padding-top: var(--space-3);
            margin-top: var(--space-2);
        }

        .section-subtitle {
            font-size: 0.75em;
            color: var(--color-text-dim);
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin-bottom: var(--space-2);
        }

        .delta-hint {
            font-size: 0.8em;
            color: var(--color-text-dim);
            margin-top: var(--space-1);
            font-style: italic;
        }

        /* ─── Session Rows ─────────────── */
        .session-row {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: var(--space-1) var(--space-2);
            padding: var(--space-2) 0;
            border-bottom: 1px solid var(--color-border);
        }

        .session-row:last-child { border-bottom: none; }

        .session-title {
            font-weight: 500;
            font-size: 0.9em;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: flex;
            align-items: center;
            gap: var(--space-1);
        }

        .session-model {
            font-size: 0.8em;
            color: var(--color-text-dim);
            text-align: right;
        }

        .session-bar-wrap {
            grid-column: 1 / -1;
            height: 4px;
            background: rgba(255,255,255,0.06);
            border-radius: var(--radius-sm);
            overflow: hidden;
        }

        .session-bar {
            height: 100%;
            border-radius: var(--radius-sm);
            transition: width 0.3s cubic-bezier(.4,0,.2,1);
        }

        .session-pct {
            grid-column: 1 / -1;
            font-size: 0.75em;
            color: var(--color-text-dim);
        }

        /* ─── Quota Rows ───────────────── */
        .quota-row {
            margin-bottom: var(--space-2);
        }

        .quota-row:last-child { margin-bottom: 0; }

        .quota-label {
            font-size: 0.85em;
            font-weight: 500;
            margin-bottom: var(--space-1);
            display: flex;
            align-items: center;
            gap: var(--space-1);
        }

        .quota-bar-wrap {
            height: 6px;
            background: rgba(255,255,255,0.06);
            border-radius: var(--radius-sm);
            overflow: hidden;
            margin-bottom: 2px;
        }

        .quota-bar {
            height: 100%;
            border-radius: var(--radius-sm);
            transition: width 0.3s cubic-bezier(.4,0,.2,1);
        }

        .quota-meta {
            display: flex;
            justify-content: space-between;
            font-size: 0.75em;
            color: var(--color-text-dim);
        }

        .quota-pct { font-weight: 600; }
        .quota-reset { opacity: 0.7; }

        .info-badge {
            background: rgba(96, 165, 250, 0.15);
            color: var(--color-info);
        }

        .mime-count {
            font-size: 0.7em;
            color: var(--color-text-dim);
            opacity: 0.6;
        }

        /* ─── Account Card ─────────────── */
        .tier-badge {
            font-size: 0.65em;
            padding: 2px 8px;
            border-radius: var(--radius-sm);
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .tier-sub { font-weight: 500; }

        /* ─── Privacy Button ──────────── */
        .privacy-btn {
            appearance: none;
            background: none;
            border: 1px solid var(--color-border);
            border-radius: var(--radius-sm);
            color: var(--color-text-dim);
            cursor: pointer;
            padding: 2px 4px;
            margin-left: auto;
            line-height: 1;
            transition: color 0.2s cubic-bezier(.4,0,.2,1), border-color 0.2s cubic-bezier(.4,0,.2,1);
        }

        .privacy-btn:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
        }

        .privacy-btn:active { transform: scale(0.98); }

        @media (hover: hover) {
            .privacy-btn:hover {
                color: var(--color-warn);
                border-color: var(--color-warn);
            }
        }

        .privacy-btn.active {
            color: var(--color-ok);
            border-color: var(--color-ok);
        }

        /* ─── Default Model ───────────── */
        .default-model {
            font-size: 0.8em;
            color: var(--color-text-dim);
            margin-bottom: var(--space-3);
        }

        .default-model strong {
            color: var(--color-text);
        }

        /* ─── Collapsible Sections ────── */
        .collapsible {
            border-top: 1px solid var(--color-border);
            margin-top: var(--space-2);
        }

        .collapsible summary {
            cursor: pointer;
            font-size: 0.8em;
            font-weight: 600;
            padding: var(--space-2) 0;
            color: var(--color-text-dim);
            list-style: none;
            display: flex;
            align-items: center;
            gap: var(--space-1);
            user-select: none;
        }

        .collapsible summary::-webkit-details-marker { display: none; }

        .collapsible summary::before {
            content: '▸';
            display: inline-block;
            transition: transform 0.2s cubic-bezier(.4,0,.2,1);
        }

        .collapsible[open] summary::before {
            transform: rotate(90deg);
        }

        .collapsible summary:focus-visible {
            box-shadow: 0 0 0 2px var(--color-info);
            border-radius: var(--radius-sm);
        }

        .details-body {
            padding-bottom: var(--space-2);
        }

        /* ─── Detail Row ─────────────── */
        .detail-row {
            display: flex;
            justify-content: space-between;
            font-size: 0.8em;
            padding: 2px 0;
            color: var(--color-text-dim);
        }

        .detail-row span:last-child {
            font-weight: 600;
            color: var(--color-text);
        }

        .account-info {
            display: flex;
            align-items: baseline;
            gap: var(--space-2);
            margin-bottom: var(--space-3);
        }

        .account-name {
            font-weight: 600;
            font-size: 1em;
        }

        .account-email {
            font-size: 0.8em;
            color: var(--color-text-dim);
        }

        /* ─── Credits Section ──────────── */
        .credits-section {
            display: grid;
            gap: var(--space-2);
            margin-bottom: var(--space-3);
        }

        .credit-row {}

        .credit-header {
            display: flex;
            justify-content: space-between;
            font-size: 0.8em;
            margin-bottom: 2px;
        }

        .credit-bar-wrap {
            height: 6px;
            background: rgba(255,255,255,0.06);
            border-radius: var(--radius-sm);
            overflow: hidden;
        }

        .credit-bar {
            height: 100%;
            border-radius: var(--radius-sm);
            transition: width 0.3s cubic-bezier(.4,0,.2,1);
        }

        /* ─── Feature Tags ───────────── */
        .feature-tags {
            display: flex;
            flex-wrap: wrap;
            gap: var(--space-1);
        }

        .feature-tag {
            font-size: 0.7em;
            padding: 2px 6px;
            border-radius: var(--radius-sm);
            background: rgba(255,255,255,0.04);
            color: var(--color-text-dim);
            border: 1px solid var(--color-border);
            opacity: 0.5;
            text-decoration: line-through;
        }

        .feature-tag.enabled {
            opacity: 1;
            text-decoration: none;
            background: rgba(74, 222, 128, 0.08);
            border-color: rgba(74, 222, 128, 0.2);
            color: var(--color-ok);
        }

        /* ─── Reduced Motion ─────────── */
        @media (prefers-reduced-motion: reduce) {
            .progress-bar,
            .session-bar,
            .quota-bar,
            .credit-bar,
            .lang-btn,
            .action-btn,
            .card {
                transition: none;
            }
            .action-btn.spinning svg {
                animation: none;
            }
        }
    `;
}

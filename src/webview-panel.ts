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

/** When true, auto-refresh updates are buffered but not rendered. */
let isPaused = false;

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
        panel.webview.html = buildHtml(currentUsage, allTrajectoryUsages, modelConfigs, userInfo, isPaused);
        panel.reveal(vscode.ViewColumn.Two, true);
        return;
    }

    panel = vscode.window.createWebviewPanel(
        'antigravityMonitor',
        `${tBi('Context Monitor', '上下文监控')}`,
        { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
        { enableScripts: true, retainContextWhenHidden: true },
    );

    panel.webview.html = buildHtml(currentUsage, allTrajectoryUsages, modelConfigs, userInfo, isPaused);

    panel.webview.onDidReceiveMessage(async (msg: { command: string; lang?: string; value?: unknown; key?: string }) => {
        if (msg.command === 'switchLanguage' && msg.lang && extensionCtx) {
            await setLanguage(msg.lang as Language, extensionCtx);
            if (panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
            }
            vscode.commands.executeCommand('antigravity-context-monitor.refresh');
        } else if (msg.command === 'refresh') {
            vscode.commands.executeCommand('antigravity-context-monitor.refresh');
        } else if (msg.command === 'togglePause') {
            isPaused = !isPaused;
            if (!isPaused && panel) {
                panel.webview.html = buildHtml(lastUsage, lastAllUsages, lastConfigs, lastUserInfo, isPaused);
            } else if (panel) {
                panel.webview.postMessage({ command: 'setPaused', paused: isPaused });
            }
        } else if (msg.command === 'setThreshold' && typeof msg.value === 'number') {
            const val = Math.max(10_000, msg.value);
            await vscode.workspace.getConfiguration('antigravityContextMonitor')
                .update('compressionWarningThreshold', val, vscode.ConfigurationTarget.Global);
            if (panel) {
                panel.webview.postMessage({ command: 'thresholdSaved' });
            }
        } else if (msg.command === 'setPollingInterval' && typeof msg.value === 'number') {
            const val = Math.max(1, Math.min(60, msg.value));
            await vscode.workspace.getConfiguration('antigravityContextMonitor')
                .update('pollingInterval', val, vscode.ConfigurationTarget.Global);
            if (panel) {
                panel.webview.postMessage({ command: 'configSaved', key: 'pollingInterval' });
            }
        } else if (msg.command === 'setConfig' && msg.key) {
            const allowedKeys = [
                'statusBar.showContext',
                'statusBar.showQuota',
                'statusBar.showResetCountdown',
                'contextLimits',
            ];
            if (allowedKeys.includes(msg.key)) {
                await vscode.workspace.getConfiguration('antigravityContextMonitor')
                    .update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
                if (panel) {
                    panel.webview.postMessage({ command: 'configSaved', key: msg.key });
                }
            }
        }
    });

    panel.onDidDispose(() => {
        panel = undefined;
        isPaused = false;  // Reset pause on close
    });
}

/**
 * Silently update the panel if it is already visible.
 * Does NOT steal focus or create a new panel.
 * When paused, data is cached but the panel is NOT re-rendered.
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
    if (panel && !isPaused) {
        panel.webview.html = buildHtml(currentUsage, allTrajectoryUsages, modelConfigs, userInfo, isPaused);
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
    git: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M15.698 7.287 8.712.302a1.03 1.03 0 0 0-1.457 0l-1.45 1.45 1.84 1.84a1.223 1.223 0 0 1 1.55 1.56l1.773 1.774a1.224 1.224 0 1 1-.733.693l-1.654-1.654v4.353a1.226 1.226 0 1 1-1.008-.036V5.889a1.226 1.226 0 0 1-.666-1.608L5.093 2.465l-4.79 4.79a1.03 1.03 0 0 0 0 1.457l6.986 6.986a1.03 1.03 0 0 0 1.457 0l6.953-6.953a1.031 1.031 0 0 0 0-1.457"/></svg>',
    branch: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5m-2.25.75a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25M4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5M3.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0"/></svg>',
    star: '<svg class="icon" viewBox="0 0 16 16"><path fill="currentColor" d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/></svg>',
} as const;

// ─── HTML Builder ─────────────────────────────────────────────────────────────

function buildHtml(usage: ContextUsage | null, allUsages: ContextUsage[], configs: ModelConfig[], userInfo: UserStatusInfo | null, paused = false): string {
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
        const quotaRows = quotaModels.map((c, idx) => {
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
            const recTag = c.isRecommended ? `<span class="badge rec-badge">${ICON.star} REC</span>` : '';
            const mimeTag = c.mimeTypeCount > 0 ? `<span class="mime-count">${c.mimeTypeCount} MIME</span>` : '';

            // MIME type details (collapsible)
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
                    <span class="badge status-badge">${esc(usage.status.replace('CASCADE_RUN_STATUS_', ''))}</span>
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
                ${buildGitInfoHtml(usage)}
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
                <details class="collapsible" id="d-current-times">
                    <summary>${tBi('Timestamps', '时间戳')}</summary>
                    <div class="details-body">
                        <div class="detail-row"><span>${tBi('Created', '创建')}</span><span>${formatTime(usage.createdTime)}</span></div>
                        <div class="detail-row"><span>${tBi('Last Modified', '最后修改')}</span><span>${formatTime(usage.lastModifiedTime)}</span></div>
                        <div class="detail-row"><span>${tBi('Last User Input', '最后用户输入')}</span><span>${formatTime(usage.lastUserInputTime)}</span></div>
                        <div class="detail-row"><span>${tBi('Last Input Step', '最后输入步骤')}</span><span>#${usage.lastUserInputStepIndex}</span></div>
                        <div class="detail-row"><span>Cascade ID</span><span class="mono-val">${esc(usage.cascadeId)}</span></div>
                    </div>
                </details>
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

    // ━━━ Other Sessions (Full Transparency) ━━━
    const others = allUsages.filter(u => u.cascadeId !== usage?.cascadeId);
    if (others.length > 0) {
        const rows = others.slice(0, 10).map((u, idx) => {
            const pct = Math.min(u.usagePercent, 100);
            const barColor = pct >= 80 ? 'var(--color-danger)' : pct >= 50 ? 'var(--color-warn)' : 'var(--color-ok)';
            const compTag = u.compressionDetected ? '<span class="badge danger-badge">COMP</span>' : '';
            const statusTag = `<span class="badge status-badge">${esc(u.status.replace('CASCADE_RUN_STATUS_', ''))}</span>`;
            const remaining = Math.max(0, u.contextLimit - u.contextUsed);
            const sourceTag = u.isEstimated
                ? `<span class="badge warn-badge">${tBi('EST', '估')}</span>`
                : `<span class="badge ok-badge">${tBi('✓', '精')}</span>`;

            return `
                <details class="collapsible session-detail" id="d-session-${idx}">
                    <summary>
                        <div class="session-summary-row">
                            <span class="session-title-text">${esc(u.title || u.cascadeId.substring(0, 8))}</span>
                            ${compTag} ${statusTag} ${sourceTag}
                            <span class="session-pct-inline">${u.usagePercent.toFixed(1)}%</span>
                        </div>
                        <div class="session-bar-wrap compact">
                            <div class="session-bar" style="width:${pct}%;background:${barColor}"></div>
                        </div>
                    </summary>
                    <div class="details-body">
                        <div class="stat-grid four-col">
                            <div class="stat mini">
                                <div class="stat-label">${tBi('Used', '已用')}</div>
                                <div class="stat-value">${formatTokenCount(u.contextUsed)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${tBi('Limit', '限制')}</div>
                                <div class="stat-value">${formatContextLimit(u.contextLimit)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${tBi('Remaining', '剩余')}</div>
                                <div class="stat-value">${formatTokenCount(remaining)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${t('tooltip.steps')}</div>
                                <div class="stat-value">${u.stepCount}</div>
                            </div>
                        </div>
                        <div class="stat-grid four-col">
                            <div class="stat mini">
                                <div class="stat-label">${t('tooltip.model')}</div>
                                <div class="stat-value" style="font-size:0.85em">${esc(u.modelDisplayName)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${t('tooltip.modelOutput')}</div>
                                <div class="stat-value">${formatTokenCount(u.totalOutputTokens)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${t('tooltip.toolResults')}</div>
                                <div class="stat-value">${formatTokenCount(u.totalToolCallOutputTokens)}</div>
                            </div>
                            <div class="stat mini">
                                <div class="stat-label">${t('tooltip.imageGen')}</div>
                                <div class="stat-value">${u.imageGenStepCount}</div>
                            </div>
                        </div>
                        ${buildGitInfoHtml(u)}
                        ${u.lastModelUsage ? `
                        <div class="checkpoint-section">
                            <div class="section-subtitle">${t('tooltip.lastCheckpoint')}</div>
                            <div class="stat-grid three-col">
                                <div class="stat mini"><div class="stat-label">${t('tooltip.input')}</div><div class="stat-value">${u.lastModelUsage.inputTokens.toLocaleString()}</div></div>
                                <div class="stat mini"><div class="stat-label">${t('tooltip.output')}</div><div class="stat-value">${u.lastModelUsage.outputTokens.toLocaleString()}</div></div>
                                <div class="stat mini"><div class="stat-label">${t('tooltip.cache')}</div><div class="stat-value">${u.lastModelUsage.cacheReadTokens.toLocaleString()}</div></div>
                            </div>
                        </div>` : ''}
                        <div class="detail-row"><span>${tBi('Created', '创建')}</span><span>${formatTime(u.createdTime)}</span></div>
                        <div class="detail-row"><span>${tBi('Last Modified', '最后修改')}</span><span>${formatTime(u.lastModifiedTime)}</span></div>
                        <div class="detail-row"><span>${tBi('Last User Input', '最后用户输入')}</span><span>${formatTime(u.lastUserInputTime)}</span></div>
                        <div class="detail-row"><span>Cascade ID</span><span class="mono-val">${esc(u.cascadeId)}</span></div>
                    </div>
                </details>`;
        }).join('');

        sections.push(`
            <section class="card">
                <h2>${ICON.chat} ${t('panel.otherSessions')} (${others.length})</h2>
                ${rows}
            </section>`);
    }

    // ━━━ Raw Data (Full Transparency) ━━━
    if (userInfo?._rawResponse) {
        const rawJson = JSON.stringify(userInfo._rawResponse, null, 2);
        // Truncate if absurdly large (> 200KB) to avoid freezing the webview
        const truncated = rawJson.length > 200_000;
        const displayJson = truncated ? rawJson.substring(0, 200_000) + '\n\n... (truncated)' : rawJson;
        sections.push(`
            <section class="card">
                <h2>${ICON.shield} ${tBi('Raw LS Data', 'LS 原始数据')}</h2>
                <p class="raw-desc">${tBi(
                    'Full GetUserStatus response from LS — if schema changes, new fields appear here first.',
                    'LS GetUserStatus 完整响应 — 如果 schema 变更，新字段会最先出现在这里。',
                )}</p>
                <details class="collapsible" id="d-raw-data">
                    <summary>${tBi('Show JSON', '展示 JSON')} (${(rawJson.length / 1024).toFixed(1)} KB)</summary>
                    <div class="details-body">
                        <pre class="raw-json"><code>${esc(displayJson)}</code></pre>
                    </div>
                </details>
            </section>`);
    }

    // ━━━ No data fallback ━━━
    if (sections.length === 0) {
        sections.push(`
            <section class="card empty">
                <h2>${t('panel.noData')}</h2>
            </section>`);
    }

    // ━━━ Settings Page Content ━━━
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
    const currentThreshold = cfg.get<number>('compressionWarningThreshold', 200_000);
    const pollingInterval = cfg.get<number>('pollingInterval', 5);
    const contextLimits = cfg.get<Record<string, number>>('contextLimits', {});
    const showContext = cfg.get<boolean>('statusBar.showContext', true);
    const showQuota = cfg.get<boolean>('statusBar.showQuota', true);
    const showResetCountdown = cfg.get<boolean>('statusBar.showResetCountdown', true);

    // Build model context limits rows from configs
    const modelLimitRows = configs.map(c => {
        const customLimit = contextLimits[c.model];
        const limit = customLimit ?? 1_000_000;
        return `
            <div class="setting-model-row">
                <span class="setting-model-label">${esc(c.label)}</span>
                <div class="num-spinner">
                    <button type="button" class="num-spinner-btn decrement">−</button>
                    <input type="number" class="threshold-input model-limit-input"
                           data-model="${esc(c.model)}" value="${limit}"
                           min="1000" step="100000" />
                    <button type="button" class="num-spinner-btn increment">+</button>
                </div>
            </div>`;
    }).join('');

    const settingsHtml = `
        <section class="card">
            <h2>${ICON.shield} ${tBi('Compression Warning', '压缩警告')}</h2>
            <div class="setting-row">
                <label for="thresholdInput">${tBi(
                    'Warning threshold (tokens)',
                    '警告阈值（token 数）',
                )}</label>
                <p class="raw-desc">${tBi(
                    'Status bar turns yellow/red based on this value. Default 200K matches Antigravity\'s internal compression point.',
                    '状态栏颜色基于此值判断。默认 200K 匹配 Antigravity 内建压缩线。',
                )}</p>
                <div class="threshold-input-row">
                    <div class="num-spinner">
                        <button type="button" class="num-spinner-btn decrement" data-target="thresholdInput">−</button>
                        <input type="number" id="thresholdInput" class="threshold-input"
                               value="${currentThreshold}" min="10000" step="10000" />
                        <button type="button" class="num-spinner-btn increment" data-target="thresholdInput">+</button>
                    </div>
                    <button class="action-btn" id="thresholdSaveBtn">${tBi('Save', '保存')}</button>
                    <span id="thresholdFeedback" class="threshold-feedback"></span>
                </div>
                <div class="threshold-presets">
                    <button class="preset-btn" data-val="150000">150K</button>
                    <button class="preset-btn" data-val="200000">200K</button>
                    <button class="preset-btn" data-val="500000">500K</button>
                    <button class="preset-btn" data-val="900000">900K</button>
                </div>
            </div>
        </section>

        <section class="card">
            <h2>${ICON.clock} ${tBi('Polling', '轮询')}</h2>
            <div class="setting-row">
                <label for="pollingInput">${tBi(
                    'Polling interval (seconds)',
                    '轮询间隔（秒）',
                )}</label>
                <div class="threshold-input-row">
                    <div class="num-spinner">
                        <button type="button" class="num-spinner-btn decrement" data-target="pollingInput">−</button>
                        <input type="number" id="pollingInput" class="threshold-input"
                               value="${pollingInterval}" min="1" max="60" step="1" />
                        <button type="button" class="num-spinner-btn increment" data-target="pollingInput">+</button>
                    </div>
                    <button class="action-btn" id="pollingSaveBtn">${tBi('Save', '保存')}</button>
                    <span id="pollingFeedback" class="threshold-feedback"></span>
                </div>
            </div>
        </section>

        <section class="card">
            <h2>${ICON.chart} ${tBi('Status Bar Display', '状态栏显示')}</h2>
            <p class="raw-desc">${tBi(
                'Toggle which elements appear in the status bar.',
                '控制状态栏显示哪些元素。',
            )}</p>
            <div class="toggle-group">
                <label class="toggle-row">
                    <input type="checkbox" id="toggleContext" class="toggle-cb" ${showContext ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBi('Context usage', '上下文用量')} <code>45k/1M, 4.5%</code></span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleQuota" class="toggle-cb" ${showQuota ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBi('Quota indicator', '额度指示灯')} <code>🟢85%</code></span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleCountdown" class="toggle-cb" ${showResetCountdown ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBi('Reset countdown', '重置倒计时')} <code>⏳4h32m</code></span>
                </label>
            </div>
        </section>

        ${modelLimitRows ? `
        <section class="card">
            <h2>${ICON.shield} ${tBi('Model Context Limits', '模型上下文限制')}</h2>
            <p class="raw-desc">${tBi(
                'Override context window size (tokens) per model.',
                '按模型覆盖上下文窗口大小（token 数）。',
            )}</p>
            <div class="setting-model-grid">
                ${modelLimitRows}
            </div>
            <div class="threshold-input-row" style="margin-top: var(--space-2);">
                <button class="action-btn" id="modelLimitsSaveBtn">${tBi('Save All', '全部保存')}</button>
                <span id="modelLimitsFeedback" class="threshold-feedback"></span>
            </div>
        </section>` : ''}
    `;

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
            <button class="action-btn${paused ? ' paused' : ''}" id="pauseBtn" data-tooltip="${tBi(paused ? 'Resume auto-refresh' : 'Pause auto-refresh', paused ? '恢复自动刷新' : '暂停自动刷新')}">
                <svg viewBox="0 0 16 16" width="14" height="14">${paused
                    ? '<path fill="currentColor" d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>'
                    : '<path fill="currentColor" d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>'
                }</svg>
            </button>
            <button class="action-btn" id="refreshBtn" data-tooltip="${tBi('Refresh', '刷新')}">
                ${ICON.refresh}
            </button>
            <span class="update-time">${paused ? `<span class="paused-indicator">${tBi('PAUSED', '已暂停')}</span>` : ''} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        </div>
    </header>
    <nav class="tab-bar">
        <button class="tab-btn active" data-tab="monitor">${ICON.chart} ${tBi('Monitor', '监控')}</button>
        <button class="tab-btn" data-tab="settings">${ICON.shield} ${tBi('Settings', '设置')}</button>
    </nav>
    <div class="tab-pane active" id="tab-monitor">
        ${sections.join('')}
    </div>
    <div class="tab-pane" id="tab-settings">
        ${settingsHtml}
    </div>
    <script>
        (function() {
            var vscode = acquireVsCodeApi();
            var savedState = vscode.getState() || {};

            // ─── Tab System ───
            var activeTab = savedState.activeTab || 'monitor';
            var tabBtns = document.querySelectorAll('.tab-btn');
            var tabPanes = document.querySelectorAll('.tab-pane');
            function switchTab(tabName) {
                activeTab = tabName;
                for (var i = 0; i < tabBtns.length; i++) {
                    tabBtns[i].classList.toggle('active', tabBtns[i].dataset.tab === tabName);
                }
                for (var j = 0; j < tabPanes.length; j++) {
                    tabPanes[j].classList.toggle('active', tabPanes[j].id === 'tab-' + tabName);
                }
                var s = vscode.getState() || {};
                s.activeTab = tabName;
                vscode.setState(s);
            }
            // Restore active tab from state
            if (activeTab !== 'monitor') { switchTab(activeTab); }
            for (var ti = 0; ti < tabBtns.length; ti++) {
                tabBtns[ti].addEventListener('click', function() {
                    switchTab(this.dataset.tab);
                });
            }

            // ─── Settings: Polling Interval ───
            var pollingInput = document.getElementById('pollingInput');
            var pollingSaveBtn = document.getElementById('pollingSaveBtn');
            if (pollingSaveBtn && pollingInput) {
                pollingSaveBtn.addEventListener('click', function() {
                    var val = parseInt(pollingInput.value, 10);
                    if (val >= 1 && val <= 60) {
                        vscode.postMessage({ command: 'setPollingInterval', value: val });
                    }
                });
            }

            // ─── Settings: Status Bar Toggles ───
            var toggleIds = ['toggleContext', 'toggleQuota', 'toggleCountdown'];
            var toggleKeys = ['statusBar.showContext', 'statusBar.showQuota', 'statusBar.showResetCountdown'];
            for (var tgi = 0; tgi < toggleIds.length; tgi++) {
                (function(idx) {
                    var cb = document.getElementById(toggleIds[idx]);
                    if (cb) {
                        cb.addEventListener('change', function() {
                            vscode.postMessage({ command: 'setConfig', key: toggleKeys[idx], value: this.checked });
                        });
                    }
                })(tgi);
            }

            // ─── Settings: Model Limits Save ───
            var modelLimitsSaveBtn = document.getElementById('modelLimitsSaveBtn');
            if (modelLimitsSaveBtn) {
                modelLimitsSaveBtn.addEventListener('click', function() {
                    var inputs = document.querySelectorAll('.model-limit-input');
                    var limits = {};
                    for (var mi = 0; mi < inputs.length; mi++) {
                        var model = inputs[mi].dataset.model;
                        var val = parseInt(inputs[mi].value, 10);
                        if (model && val >= 1000) { limits[model] = val; }
                    }
                    vscode.postMessage({ command: 'setConfig', key: 'contextLimits', value: limits });
                    var fb = document.getElementById('modelLimitsFeedback');
                    if (fb) { fb.textContent = '✓'; fb.style.opacity = '1'; setTimeout(function(){ fb.style.opacity = '0'; }, 2000); }
                });
            }

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

            // ─── Pause Button ───
            var pauseBtn = document.getElementById('pauseBtn');
            if (pauseBtn) {
                pauseBtn.addEventListener('click', function() {
                    vscode.postMessage({ command: 'togglePause' });
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

            // ─── Listen for setPaused message from extension ───
            window.addEventListener('message', function(event) {
                var msg = event.data;
                if (msg.command === 'setPaused' && pauseBtn) {
                    pauseBtn.classList.toggle('paused', msg.paused);
                }
                if (msg.command === 'thresholdSaved') {
                    var fb = document.getElementById('thresholdFeedback');
                    if (fb) {
                        fb.textContent = '✓';
                        fb.style.opacity = '1';
                        setTimeout(function() { fb.style.opacity = '0'; }, 2000);
                    }
                }
                if (msg.command === 'configSaved') {
                    var feedbackMap = {
                        'pollingInterval': 'pollingFeedback',
                        'contextLimits': 'modelLimitsFeedback',
                    };
                    var fbId = feedbackMap[msg.key];
                    if (fbId) {
                        var cfb = document.getElementById(fbId);
                        if (cfb) {
                            cfb.textContent = '✓';
                            cfb.style.opacity = '1';
                            setTimeout(function() { cfb.style.opacity = '0'; }, 2000);
                        }
                    }
                }
            });

            // ─── Threshold Settings ───
            var thresholdInput = document.getElementById('thresholdInput');
            var thresholdSaveBtn = document.getElementById('thresholdSaveBtn');
            if (thresholdSaveBtn && thresholdInput) {
                thresholdSaveBtn.addEventListener('click', function() {
                    var val = parseInt(thresholdInput.value, 10);
                    if (val >= 10000) {
                        vscode.postMessage({ command: 'setThreshold', value: val });
                    }
                });
            }
            var presets = document.querySelectorAll('.preset-btn');
            for (var p = 0; p < presets.length; p++) {
                presets[p].addEventListener('click', function() {
                    var val = parseInt(this.dataset.val, 10);
                    if (thresholdInput) { thresholdInput.value = val; }
                    vscode.postMessage({ command: 'setThreshold', value: val });
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

            // ─── Custom number spinner buttons ───
            var spinnerBtns = document.querySelectorAll('.num-spinner-btn');
            for (var sb = 0; sb < spinnerBtns.length; sb++) {
                spinnerBtns[sb].addEventListener('click', function() {
                    var spinner = this.closest('.num-spinner');
                    if (!spinner) return;
                    var input = spinner.querySelector('input[type="number"]');
                    if (!input) return;
                    var step = parseFloat(input.step) || 1;
                    var min = input.min !== '' ? parseFloat(input.min) : -Infinity;
                    var max = input.max !== '' ? parseFloat(input.max) : Infinity;
                    var val = parseFloat(input.value) || 0;
                    if (this.classList.contains('increment')) {
                        val = Math.min(val + step, max);
                    } else {
                        val = Math.max(val - step, min);
                    }
                    input.value = val;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
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

// ─── Helper: Format ISO timestamp ────────────────────────────────────────────

function formatTime(iso: string): string {
    if (!iso) { return '—'; }
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) { return esc(iso); }
        return d.toLocaleString([], {
            month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    } catch { return esc(iso); }
}

// ─── Helper: Build Git info HTML block ───────────────────────────────────────

function buildGitInfoHtml(u: ContextUsage): string {
    if (!u.repositoryName && !u.branchName) { return ''; }
    const parts: string[] = [];
    if (u.repositoryName) {
        parts.push(`<span class="git-repo">${ICON.git} ${esc(u.repositoryName)}</span>`);
    }
    if (u.branchName) {
        parts.push(`<span class="git-branch">${ICON.branch} ${esc(u.branchName)}</span>`);
    }
    return `<div class="git-info">${parts.join('')}</div>`;
}

// ─── Escape HTML ──────────────────────────────────────────────────────────────

function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

import { getStyles } from './webview-styles';


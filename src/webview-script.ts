import { tBi } from './i18n';
import type { ModelPricing } from './pricing-store';
import {
    SUBSCRIPTION_PLAN_PRESET_ORDER,
    SUBSCRIPTION_PLAN_PRESETS,
} from './cli-usage-scanner';

const SUBSCRIPTION_PLAN_PLACEHOLDERS: Readonly<Record<string, string>> = Object.fromEntries(
    SUBSCRIPTION_PLAN_PRESET_ORDER
        .filter((planId) => SUBSCRIPTION_PLAN_PRESETS[planId].monthlyUsd > 0)
        .map((planId) => [planId, String(SUBSCRIPTION_PLAN_PRESETS[planId].monthlyUsd)]),
);
const DEFAULT_SUBSCRIPTION_FEE_PLACEHOLDER = String(SUBSCRIPTION_PLAN_PRESETS['google-ai-pro'].monthlyUsd);

// ─── WebView Client-Side Script ──────────────────────────────────────────────
// Frontend JavaScript injected into the WebView panel.
// Handles tab switching, settings controls, privacy mask, scroll persistence,
// and message passing with the extension host.

interface PricingInputLike {
    value: string;
    getAttribute(name: string): string | null;
}

export function collectPricingInputOverrides(inputs: ArrayLike<PricingInputLike>): Record<string, ModelPricing> {
    const values: Record<string, ModelPricing> = {};
    const shouldPersist: Record<string, boolean> = {};
    const fieldCounts: Record<string, number> = {};
    const blankCounts: Record<string, number> = {};
    const presentFields: Record<string, Set<string>> = {};
    const validFields: Record<string, true> = {
        input: true,
        output: true,
        cacheRead: true,
        cacheWrite: true,
        thinking: true,
    };

    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        const model = (input.getAttribute('data-model') || '').trim();
        const rawField = input.getAttribute('data-field') || '';
        if (!model || !validFields[rawField]) { continue; }

        const field = rawField as keyof ModelPricing;
        fieldCounts[model] = (fieldCounts[model] || 0) + 1;
        const rawValue = input.value.trim();
        if (!rawValue) {
            blankCounts[model] = (blankCounts[model] || 0) + 1;
            continue;
        }
        const value = Number(rawValue);
        if (!Number.isFinite(value) || value < 0 || !/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(rawValue)) {
            throw new Error('INVALID_PRICING');
        }
        if (!values[model]) {
            const cacheWrite = Number(input.getAttribute('data-cache-write') || 0);
            values[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: Number.isFinite(cacheWrite) && cacheWrite >= 0 ? cacheWrite : 0, thinking: 0 };
            presentFields[model] = new Set();
        }
        values[model][field] = value;
        presentFields[model].add(field);

        const originalRaw = (input.getAttribute('data-original-value') || '').trim();
        const originalValue = originalRaw ? Number(originalRaw) : NaN;
        const wasCustom = input.getAttribute('data-was-custom') === '1';
        if (wasCustom || !Number.isFinite(originalValue) || Math.abs(value - originalValue) > 1e-9) {
            shouldPersist[model] = true;
        }
    }

    const result: Record<string, ModelPricing> = {};
    for (const model of Object.keys(fieldCounts)) {
        // A wholly blank row deliberately removes an override, or leaves an
        // unpriced model unpriced. A partially filled row must never become $0.
        if (blankCounts[model] === fieldCounts[model]) { continue; }
        if (blankCounts[model] || !['input', 'output', 'cacheRead', 'thinking'].every(f => presentFields[model]?.has(f))) {
            throw new Error('INVALID_PRICING');
        }
    }
    for (const [model, pricing] of Object.entries(values)) {
        if (shouldPersist[model]) {
            result[model] = pricing;
        }
    }
    return result;
}

/** Returns the complete <script> block content (without <script> tags). */
export function getScript(): string {
    return `
        (function() {
            var bridge = window.__ACM_BRIDGE__ || null;
            var vscode = (bridge && typeof bridge.asVsCodeApi === 'function')
                ? bridge.asVsCodeApi()
                : (typeof acquireVsCodeApi === 'function'
                    ? acquireVsCodeApi()
                    : { getState: function() { return {}; }, setState: function() {}, postMessage: function() {} });
            var collectPricingInputOverrides = (${collectPricingInputOverrides.toString()});
            var savedState = vscode.getState() || {};
            var copiedText = ${JSON.stringify(`✓ ${tBi('Copied', '已复制')}`)};
            var savedText = ${JSON.stringify(`✓ ${tBi('Saved', '已保存')}`)};
            var resetText = ${JSON.stringify(`✓ ${tBi('Reset', '已重置')}`)};
            var openingText = ${JSON.stringify(tBi('Opening...', '正在打开...'))};
            var revealingText = ${JSON.stringify(tBi('Revealing...', '正在定位...'))};
            var openedText = ${JSON.stringify(`✓ ${tBi('Opened', '已打开')}`)};
            var revealedText = ${JSON.stringify(`✓ ${tBi('Revealed', '已定位')}`)};
            var openFailedText = ${JSON.stringify(tBi('Open failed', '打开失败'))};
            var revealFailedText = ${JSON.stringify(tBi('Reveal failed', '定位失败'))};
            var invalidBillingDayText = ${JSON.stringify(tBi('Invalid', '无效'))};
            var invalidPricingText = ${JSON.stringify(tBi('Enter a non-negative price in every field of each row, or clear the entire row.', '请为每行的所有字段填写非负价格，或清空整行。'))};
            var checkingUpdatesText = ${JSON.stringify(tBi('Checking...', '正在检查...'))};
            var upgradingText = ${JSON.stringify(tBi('Upgrading...', '正在升级...'))};
            var upToDateText = ${JSON.stringify(`✓ ${tBi('Up to date', '已是最新')}`)};
            var updateAvailableText = ${JSON.stringify(tBi('Update available', '有可用更新'))};
            var upgradeDoneText = ${JSON.stringify(`✓ ${tBi('Upgraded — reload to apply', '升级完成，重启后生效')}`)};
            var checkFailedText = ${JSON.stringify(tBi('Check failed', '检查失败'))};
            var exportedText = ${JSON.stringify(`✓ ${tBi('Exported', '已导出')}`)};
            var cdpCheckingText = ${JSON.stringify(tBi('Checking CDP...', '正在检测 CDP...'))};
            var cdpConnectedText = ${JSON.stringify(tBi('Connected', '已连接'))};
            var cdpErrorText = ${JSON.stringify(tBi('CDP Error', 'CDP 异常'))};
            var cdpInactiveText = ${JSON.stringify(tBi('CDP Inactive', 'CDP 未就绪'))};
            var cdpDisabledText = ${JSON.stringify(tBi('Disabled', '未启用'))};
            var cdpDiagHostMissingText = ${JSON.stringify(tBi(
        'Antigravity App is running without --remote-debugging-port=0 (e.g. opened from the original icon, auto-updated, or relaunched during the ~5s shutdown after Cmd+Q). Step 1: click "Create Persistent Launcher" below to create a separate launcher. Step 2: launch from the new "Antigravity (CDP)" icon instead (the original Antigravity icon is never modified), then click Recheck CDP.',
        '当前运行的 Antigravity App 未启用 --remote-debugging-port=0（例如从原版图标启动、自动更新重启，或按 Cmd+Q 后约 5 秒后台清理尚未完成）。步骤 1：点击下方「一键生成持久化启动器」创建独立启动器；步骤 2：之后改从新建的「Antigravity (CDP)」图标启动（原版 Antigravity 图标不会被修改），启动后点击「重新检测」。',
    ))};
            var cdpDiagMissingText = ${JSON.stringify(tBi(
        'DevToolsActivePort not found — Antigravity App is running without --remote-debugging-port=0 (or was relaunched during the ~5s shutdown after Cmd+Q). Step 1: click "Create Persistent Launcher" below to create a separate launcher. Step 2: launch from the new "Antigravity (CDP)" icon instead (the original Antigravity icon is never modified), then click Recheck CDP.',
        '未检测到 DevToolsActivePort —— 当前运行的 Antigravity App 未启用 --remote-debugging-port=0（或按 Cmd+Q 后约 5 秒后台清理尚未完成）。步骤 1：点击下方「一键生成持久化启动器」创建独立启动器；步骤 2：之后改从新建的「Antigravity (CDP)」图标启动（原版 Antigravity 图标不会被修改），启动后点击「重新检测」。',
    ))};
            var cdpDiagInstalledDarwinText = ${JSON.stringify(tBi(
        'Persistent launcher is ready, but this session was opened from the original Antigravity app (without --remote-debugging-port=0). Launch from the "Antigravity (CDP)" icon instead (click "Reveal in Finder" below to locate it and drag it to your Dock), then click Recheck CDP.',
        '持久化启动器已就绪，但本次打开的是原版 Antigravity（未启用 --remote-debugging-port=0）。请改从「Antigravity (CDP)」图标启动（可点击下方「在访达中显示」直接定位并拖到程序坞），启动后点击「重新检测」。',
    ))};
            var cdpDiagInstalledWinText = ${JSON.stringify(tBi(
        'Persistent launcher is ready, but this session was opened from the original Antigravity app (without --remote-debugging-port=0). Launch from the "Antigravity (CDP)" shortcut instead (click "Show in Explorer" below to locate it), then click Recheck CDP.',
        '持久化启动器已就绪，但本次打开的是原版 Antigravity（未启用 --remote-debugging-port=0）。请改从「Antigravity (CDP)」快捷方式启动（可点击下方「在资源管理器中显示」直接定位），启动后点击「重新检测」。',
    ))};
            var cdpDiagInstalledLinuxText = ${JSON.stringify(tBi(
        'Persistent launcher is ready, but this session was opened from the original Antigravity app (without --remote-debugging-port=0). Launch from the "Antigravity (CDP)" application entry instead (click "Open Folder" below to locate it), then click Recheck CDP.',
        '持久化启动器已就绪，但本次打开的是原版 Antigravity（未启用 --remote-debugging-port=0）。请改从应用菜单中的「Antigravity (CDP)」图标启动（可点击下方「打开所在目录」定位启动器目录），启动后点击「重新检测」。',
    ))};
            var cdpDiagMissingPortPrefixText = ${JSON.stringify(tBi('DevToolsActivePort not found — ', '未检测到 DevToolsActivePort —— '))};
            var cdpLauncherCreatingText = ${JSON.stringify(tBi('Creating launcher...', '正在生成启动器...'))};
            var cdpLauncherRemovingText = ${JSON.stringify(tBi('Removing launcher...', '正在移除启动器...'))};
            var cdpLauncherInstalledText = ${JSON.stringify(tBi('Installed', '已创建'))};
            var cdpLauncherNotInstalledText = ${JSON.stringify(tBi('Not created', '未创建'))};
            var cdpLauncherCreateBtnText = ${JSON.stringify(tBi('Create Persistent Launcher', '一键生成持久化启动器'))};
            var cdpLauncherRecreateBtnText = ${JSON.stringify(tBi('Recreate Launcher', '重新生成启动器'))};
            var cdpLauncherRevealDarwinText = ${JSON.stringify(tBi('Reveal in Finder', '在访达中显示'))};
            var cdpLauncherRevealWinText = ${JSON.stringify(tBi('Show in Explorer', '在资源管理器中显示'))};
            var cdpLauncherRevealLinuxText = ${JSON.stringify(tBi('Open Folder', '打开所在目录'))};
            var cdpLauncherActionFailedText = ${JSON.stringify(tBi('Launcher action failed', '启动器操作失败'))};
            var cdpDiagUnreachableTpl = ${JSON.stringify(tBi(
        'Found DevToolsActivePort{port}, but the CDP port is unreachable (stale file from an earlier run). Fully quit Antigravity App, relaunch with --remote-debugging-port=0, then click Recheck CDP.',
        '检测到 DevToolsActivePort{port}，但调试端口无响应（可能是旧会话残留文件）。请完全退出 Antigravity App 并以 --remote-debugging-port=0 重启，再点击「重新检测」。',
    ))};
            var cdpDiagNoHubTpl = ${JSON.stringify(tBi(
        'CDP port{port} is listening, but no Antigravity Hub window target was found (only sidecar or DevTools targets detected). Open an Antigravity workspace window and click Recheck CDP.',
        'CDP 端口{port}已响应，但未找到 Antigravity 主窗口目标（仅检测到侧栏或 DevTools 页面）。请打开 Antigravity 主窗口后点击「重新检测」。',
    ))};
            var cdpDiagWsErrorTpl = ${JSON.stringify(tBi(
        'CDP WebSocket connection failed{err}. Click Recheck CDP or relaunch Antigravity App with --remote-debugging-port=0.',
        'CDP WebSocket 连接失败{err}。请点击「重新检测」或以 --remote-debugging-port=0 重启 Antigravity App。',
    ))};
            var cdpDiagEvalErrorTpl = ${JSON.stringify(tBi(
        'Connected to Antigravity Hub, but overlay injection failed{err}. Click Recheck CDP once the window finishes loading.',
        '已连接 Antigravity 主窗口，但悬浮组件注入失败{err}。请待窗口加载完成后点击「重新检测」。',
    ))};
            var cdpDiagConnectedTpl = ${JSON.stringify(tBi(
        'Connected to Antigravity Hub{port}{title}.',
        '已连接到 Antigravity 主窗口{port}{title}。',
    ))};
            var updateAvailablePillTpl = ${JSON.stringify(tBi('Update available: {ver}', '有可用更新：{ver}'))};
            var upToDatePillTpl = ${JSON.stringify(tBi('Up to date ({ver})', '已是最新（{ver}）'))};
            var currentVerPillTpl = ${JSON.stringify(tBi('Current {ver}', '当前版本 {ver}'))};
            var subscriptionPlanPlaceholders = ${JSON.stringify(SUBSCRIPTION_PLAN_PLACEHOLDERS)};
            var defaultSubscriptionFeePlaceholder = ${JSON.stringify(DEFAULT_SUBSCRIPTION_FEE_PLACEHOLDER)};

            function triggerClientDownload(filename, content, mimeType) {
                try {
                    var blob = new Blob([String(content || '')], { type: mimeType || 'text/plain;charset=utf-8' });
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = url;
                    a.download = filename || 'antigravity-calendar-export.txt';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
                    return true;
                } catch (_) {
                    return false;
                }
            }

            function getNativeHudExpanded() {
                var s = vscode.getState() || {};
                return !!s.nativeHudExpanded;
            }

            function applyNativeHudExpanded(expanded) {
                var bar = document.getElementById('nativeHudBar');
                var toggle = document.getElementById('nativeHudToggle');
                var drawer = document.getElementById('nativeHudDrawer');
                var isExp = !!expanded;
                if (bar) { bar.setAttribute('data-hud-expanded', String(isExp)); }
                if (toggle) { toggle.setAttribute('aria-expanded', String(isExp)); }
                if (drawer) { drawer.hidden = !isExp; }
            }

            function syncOrchestratorPricingModeVisual(mode) {
                var resolvedMode = mode === 'strict' ? 'strict' : 'mapped';
                var modeBtns = document.querySelectorAll('[data-action="setOrchestratorPricingMode"]');
                for (var mi = 0; mi < modeBtns.length; mi++) {
                    var isMatch = modeBtns[mi].getAttribute('data-mode') === resolvedMode;
                    modeBtns[mi].classList.toggle('is-active', isMatch);
                    modeBtns[mi].setAttribute('aria-checked', String(isMatch));
                }
            }

            function syncSubscriptionFeePlaceholder(planId) {
                var sfEl = document.getElementById('subscriptionFeeInput');
                if (!sfEl) { return; }
                sfEl.placeholder = subscriptionPlanPlaceholders[planId] || defaultSubscriptionFeePlaceholder;
            }

            function pickLocalizedText(enText, zhText) {
                var lang = (document.body && document.body.getAttribute('data-lang')) || 'both';
                var enStr = typeof enText === 'string' ? enText.trim() : '';
                var zhStr = typeof zhText === 'string' ? zhText.trim() : '';
                if (lang === 'en') { return enStr || zhStr; }
                if (lang === 'zh') { return zhStr || enStr; }
                if (enStr && zhStr && enStr !== zhStr) { return enStr + ' / ' + zhStr; }
                return enStr || zhStr;
            }

            function getCdpRevealLabel(platform) {
                if (platform === 'win32') { return cdpLauncherRevealWinText; }
                if (platform === 'linux') { return cdpLauncherRevealLinuxText; }
                return cdpLauncherRevealDarwinText;
            }

            function getCdpMissingDiagnosticText(diag, launcherInstalled, platform) {
                if (launcherInstalled) {
                    var installedBase = platform === 'win32'
                        ? cdpDiagInstalledWinText
                        : (platform === 'linux' ? cdpDiagInstalledLinuxText : cdpDiagInstalledDarwinText);
                    return diag === 'missing_port_file'
                        ? (cdpDiagMissingPortPrefixText + installedBase)
                        : installedBase;
                }
                return diag === 'host_missing_flag' ? cdpDiagHostMissingText : cdpDiagMissingText;
            }

            function syncCdpLauncherUi(launcherStatus) {
                if (!launcherStatus || typeof launcherStatus !== 'object') { return; }
                var installed = !!launcherStatus.installed;
                var statusEl = document.getElementById('cdpLauncherStatus');
                var platform = (typeof launcherStatus.platform === 'string' && launcherStatus.platform)
                    ? launcherStatus.platform
                    : ((statusEl && statusEl.getAttribute('data-launcher-platform')) || 'darwin');
                if (statusEl) {
                    statusEl.setAttribute('data-launcher-installed', String(installed));
                    statusEl.setAttribute('data-launcher-platform', platform);
                    var pathStr = typeof launcherStatus.launcherPath === 'string' ? launcherStatus.launcherPath : '';
                    if (pathStr) { statusEl.setAttribute('data-launcher-path', pathStr); }
                    statusEl.textContent = '';
                    var badge = document.createElement('span');
                    badge.className = 'stg-cdp-launcher-badge' + (installed ? ' is-installed' : '');
                    badge.textContent = installed ? cdpLauncherInstalledText : cdpLauncherNotInstalledText;
                    statusEl.appendChild(badge);
                    if (pathStr) {
                        var codeEl = document.createElement('code');
                        codeEl.className = 'stg-cdp-launcher-path';
                        codeEl.textContent = pathStr;
                        statusEl.appendChild(codeEl);
                    }
                }
                var noteEl = document.getElementById('cdpLauncherNote');
                if (noteEl && (launcherStatus.noteEn || launcherStatus.noteZh)) {
                    noteEl.textContent = pickLocalizedText(launcherStatus.noteEn, launcherStatus.noteZh);
                }
                var setupBtn = document.getElementById('cdpSetupLauncherBtn');
                if (setupBtn) {
                    if (setupBtn.classList) { setupBtn.classList.toggle('stg-btn-primary', !installed); }
                    var labelSpan = setupBtn.querySelector('span');
                    if (labelSpan) {
                        labelSpan.textContent = installed ? cdpLauncherRecreateBtnText : cdpLauncherCreateBtnText;
                    } else {
                        setupBtn.textContent = installed ? cdpLauncherRecreateBtnText : cdpLauncherCreateBtnText;
                    }
                }
                var revealBtn = document.getElementById('cdpRevealLauncherBtn');
                if (revealBtn) {
                    revealBtn.hidden = !installed;
                    revealBtn.setAttribute('data-launcher-platform', platform);
                    if (revealBtn.classList) { revealBtn.classList.toggle('stg-btn-primary', installed); }
                    var revealLabel = getCdpRevealLabel(platform);
                    var revealSpan = revealBtn.querySelector('span');
                    if (revealSpan) {
                        revealSpan.textContent = revealLabel;
                    } else {
                        revealBtn.textContent = revealLabel;
                    }
                }
                var removeBtn = document.getElementById('cdpRemoveLauncherBtn');
                if (removeBtn) {
                    removeBtn.hidden = !installed;
                }
                var hintEl = document.getElementById('cdpDiagnosticHint');
                if (hintEl && !hintEl.hidden) {
                    var currentDiag = hintEl.getAttribute('data-cdp-diagnostic') || '';
                    if (currentDiag === 'host_missing_flag' || currentDiag === 'missing_port_file') {
                        hintEl.textContent = getCdpMissingDiagnosticText(currentDiag, installed, platform);
                    }
                }
            }

            function syncCdpStatusUi(cdpStatus, fallbackComposerOn, fallbackTopBarOn) {
                if (cdpStatus && cdpStatus.launcherStatus && typeof cdpStatus.launcherStatus === 'object') {
                    syncCdpLauncherUi(cdpStatus.launcherStatus);
                }

                var compCb = document.getElementById('toggleAppComposerRing');
                var topCb = document.getElementById('toggleAppTopBar');
                var compOn = typeof fallbackComposerOn === 'boolean' ? fallbackComposerOn : Boolean(compCb && compCb.checked);
                var topOn = typeof fallbackTopBarOn === 'boolean' ? fallbackTopBarOn : Boolean(topCb && topCb.checked);
                var anyEnabled = compOn || topOn;

                var state = (cdpStatus && typeof cdpStatus.state === 'string')
                    ? cdpStatus.state
                    : (anyEnabled ? 'cdp_unavailable' : 'disabled');
                var diag = (cdpStatus && typeof cdpStatus.diagnosticCode === 'string')
                    ? cdpStatus.diagnosticCode
                    : (state === 'connected' ? 'connected'
                        : (state === 'error' ? 'ws_error'
                            : (state === 'cdp_unavailable' ? 'missing_port_file' : 'disabled')));

                var pill = document.getElementById('cdpStatusPill');
                if (pill) {
                    var pillCls = 'stg-status-pill ' + (state === 'connected' ? 'is-connected'
                        : (state === 'error' ? 'is-error'
                            : (state === 'cdp_unavailable' ? 'is-inactive' : 'is-disabled')));
                    pill.className = pillCls;
                    pill.setAttribute('data-cdp-state', state);
                    pill.setAttribute('data-cdp-diagnostic', diag);
                    pill.textContent = state === 'connected' ? cdpConnectedText
                        : (state === 'error' ? cdpErrorText
                            : (state === 'cdp_unavailable' ? cdpInactiveText : cdpDisabledText));
                    var tip = state === 'connected'
                        ? (cdpStatus && cdpStatus.targetTitle ? String(cdpStatus.targetTitle) : '')
                        : (cdpStatus && cdpStatus.errorMessage ? String(cdpStatus.errorMessage) : '');
                    if (tip) { pill.setAttribute('title', tip); } else { pill.removeAttribute('title'); }
                }

                var hint = document.getElementById('cdpDiagnosticHint');
                if (hint) {
                    hint.setAttribute('data-cdp-diagnostic', diag);
                    if (state === 'disabled' || diag === 'disabled') {
                        hint.hidden = true;
                        hint.textContent = '';
                        hint.className = 'stg-diagnostic-hint';
                    } else {
                        var launcherStatusEl = document.getElementById('cdpLauncherStatus');
                        var launcherInstalled = (cdpStatus && cdpStatus.launcherStatus && typeof cdpStatus.launcherStatus.installed === 'boolean')
                            ? cdpStatus.launcherStatus.installed
                            : Boolean(launcherStatusEl && launcherStatusEl.getAttribute('data-launcher-installed') === 'true');
                        var launcherPlatform = (cdpStatus && cdpStatus.launcherStatus && cdpStatus.launcherStatus.platform)
                            || (cdpStatus && cdpStatus.platformGuide && cdpStatus.platformGuide.platform)
                            || (launcherStatusEl && launcherStatusEl.getAttribute('data-launcher-platform'))
                            || 'darwin';
                        var portPart = (cdpStatus && typeof cdpStatus.discoveredPort === 'number')
                            ? (' (:' + cdpStatus.discoveredPort + ')')
                            : '';
                        var titlePart = (cdpStatus && cdpStatus.targetTitle) ? (' — ' + String(cdpStatus.targetTitle)) : '';
                        var errPart = (cdpStatus && cdpStatus.errorMessage) ? (': ' + String(cdpStatus.errorMessage)) : '';
                        var tone = state === 'connected' ? 'is-good'
                            : ((state === 'error' || diag === 'ws_error' || diag === 'eval_error') ? 'is-error' : 'is-warn');
                        var msgText = getCdpMissingDiagnosticText('missing_port_file', launcherInstalled, launcherPlatform);
                        if (diag === 'connected') {
                            msgText = cdpDiagConnectedTpl.replace(/\{port\}/g, portPart).replace(/\{title\}/g, titlePart);
                        } else if (diag === 'host_missing_flag') {
                            msgText = getCdpMissingDiagnosticText('host_missing_flag', launcherInstalled, launcherPlatform);
                        } else if (diag === 'port_unreachable') {
                            msgText = cdpDiagUnreachableTpl.replace(/\{port\}/g, portPart);
                        } else if (diag === 'no_hub_target') {
                            msgText = cdpDiagNoHubTpl.replace(/\{port\}/g, portPart);
                        } else if (diag === 'ws_error') {
                            msgText = cdpDiagWsErrorTpl.replace(/\{err\}/g, errPart);
                        } else if (diag === 'eval_error') {
                            msgText = cdpDiagEvalErrorTpl.replace(/\{err\}/g, errPart);
                        }
                        hint.className = 'stg-diagnostic-hint ' + tone;
                        hint.textContent = msgText;
                        hint.hidden = false;
                    }
                }
            }

            function syncUpdateStatusUi(updateStatus) {
                if (!updateStatus || typeof updateStatus !== 'object') { return; }
                var pill = document.getElementById('updateStatusPill');
                if (!pill) { return; }
                var rawLatest = typeof updateStatus.latestVersion === 'string' ? updateStatus.latestVersion.trim() : '';
                var latestTag = rawLatest ? (rawLatest.charAt(0) === 'v' ? rawLatest : ('v' + rawLatest)) : '';
                var rawCur = typeof updateStatus.currentVersion === 'string' ? updateStatus.currentVersion.trim() : '';
                var curTag = rawCur ? (rawCur.charAt(0) === 'v' ? rawCur : ('v' + rawCur)) : '';
                var hasUpd = Boolean(
                    updateStatus.updateAvailable
                    || updateStatus.hasUpdate
                    || updateStatus.status === 'update_available'
                );
                if (hasUpd && latestTag) {
                    pill.className = 'stg-status-pill is-update';
                    pill.setAttribute('data-update-status', 'update_available');
                    pill.textContent = updateAvailablePillTpl.replace(/\{ver\}/g, latestTag);
                    pill.removeAttribute('title');
                } else if (updateStatus.status === 'error' || updateStatus.error) {
                    pill.className = 'stg-status-pill is-error';
                    pill.setAttribute('data-update-status', 'error');
                    pill.textContent = checkFailedText;
                    if (updateStatus.error) { pill.setAttribute('title', String(updateStatus.error)); }
                } else if (updateStatus.status === 'up_to_date' || updateStatus.status === 'not_modified' || (updateStatus.checkedAt && !hasUpd)) {
                    pill.className = 'stg-status-pill is-uptodate';
                    pill.setAttribute('data-update-status', 'up_to_date');
                    pill.textContent = curTag ? upToDatePillTpl.replace(/\{ver\}/g, curTag) : upToDateText;
                    pill.removeAttribute('title');
                } else if (curTag) {
                    pill.className = 'stg-status-pill';
                    pill.setAttribute('data-update-status', 'idle');
                    pill.textContent = currentVerPillTpl.replace(/\{ver\}/g, curTag);
                    pill.removeAttribute('title');
                }
            }

            function copyTextSafe(text) {
                var value = String(text == null ? '' : text);
                if (bridge && typeof bridge.copyText === 'function') {
                    return Promise.resolve(bridge.copyText(value));
                }
                if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    return navigator.clipboard.writeText(value).then(function() { return true; }).catch(function() {
                        return false;
                    });
                }
                try {
                    var ta = document.createElement('textarea');
                    ta.value = value;
                    ta.setAttribute('readonly', '');
                    ta.style.position = 'fixed';
                    ta.style.top = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    var ok = document.execCommand('copy');
                    document.body.removeChild(ta);
                    return Promise.resolve(!!ok);
                } catch (_) {
                    return Promise.resolve(false);
                }
            }

            function flashCopyButton(btn) {
                if (btn) {
                    if (!btn.dataset.origHtml) { btn.dataset.origHtml = btn.innerHTML; }
                    btn.classList.add('copied');
                    btn.textContent = copiedText;
                    if (btn._copyResetTimer) { clearTimeout(btn._copyResetTimer); }
                    btn._copyResetTimer = setTimeout(function() {
                        if (btn.dataset.origHtml) { btn.innerHTML = btn.dataset.origHtml; }
                        btn.classList.remove('copied');
                    }, 2000);
                }
                flashFeedback('ctxCopyFeedback', copiedText, 2000);
            }

            function getContextVizMode() {
                var s = vscode.getState() || {};
                return s.ctxVizMode === 'dots' ? 'dots' : 'bar';
            }

            function applyContextVizMode(mode) {
                var resolved = mode === 'dots' ? 'dots' : 'bar';
                var cards = document.querySelectorAll('.ctx-breakdown-card');
                for (var ci = 0; ci < cards.length; ci++) {
                    cards[ci].setAttribute('data-viz-mode', resolved);
                    var btns = cards[ci].querySelectorAll('[data-ctx-viz]');
                    for (var bi = 0; bi < btns.length; bi++) {
                        var isMatch = btns[bi].getAttribute('data-ctx-viz') === resolved;
                        btns[bi].classList.toggle('is-active', isMatch);
                        btns[bi].setAttribute('aria-pressed', String(isMatch));
                    }
                }
            }

            function syncLockMainVisual(locked) {
                var lockBtn = document.getElementById('lockMainBtn');
                if (lockBtn) {
                    lockBtn.classList.toggle('is-locked', !!locked);
                    lockBtn.setAttribute('aria-pressed', String(!!locked));
                }
                var lockCb = document.getElementById('toggleLockMainAgent');
                if (lockCb) { lockCb.checked = !!locked; }
            }

            function setFeedback(id, text) {
                var el = document.getElementById(id);
                if (!el) { return; }
                el.textContent = text || '';
                el.style.opacity = text ? '1' : '0';
            }

            function flashFeedback(id, text, delay) {
                setFeedback(id, text);
                if (!delay || delay <= 0) { return; }
                setTimeout(function() { setFeedback(id, ''); }, delay);
            }

            function flashProfileBillingFeedback(text, isError) {
                var el = document.getElementById('profileBillingDayFeedback');
                if (el) {
                    el.style.color = isError ? 'var(--ed-danger)' : 'var(--ed-good)';
                }
                flashFeedback('profileBillingDayFeedback', text, 2000);
            }

            // ─── Tab System ───
            var tabBtns = document.querySelectorAll('.tab-btn');
            var defaultTab = document.querySelector('.tab-btn.active');
            var activeTab = defaultTab ? defaultTab.dataset.tab : 'gmdata';
            var requestedTab = savedState.activeTab || document.body.getAttribute('data-initial-tab');
            var tabPanes = document.querySelectorAll('.tab-pane');
            var lastTabHtmls = {};
            var eocVisibleTabs = {};

            function getTabNameFromPaneId(paneId) {
                return paneId && paneId.indexOf('tab-') === 0 ? paneId.substring(4) : '';
            }
            function getTabNameFromNode(node) {
                var pane = node && node.closest ? node.closest('.tab-pane') : null;
                return pane ? getTabNameFromPaneId(pane.id || '') : '';
            }
            function captureVisibleEocTabs() {
                var visibleTabs = {};
                for (var pi = 0; pi < tabPanes.length; pi++) {
                    var paneName = getTabNameFromPaneId(tabPanes[pi].id || '');
                    if (!paneName) { continue; }
                    var sentinel = tabPanes[pi].querySelector('.eoc-sentinel');
                    if (sentinel && sentinel.classList.contains('eoc-visible')) {
                        visibleTabs[paneName] = true;
                        eocVisibleTabs[paneName] = true;
                    }
                }
                return visibleTabs;
            }
            function restoreVisibleEoc(tabName) {
                var pane = document.getElementById('tab-' + tabName);
                if (!pane) { return; }
                var sentinel = pane.querySelector('.eoc-sentinel');
                if (!sentinel) { return; }
                sentinel.classList.add('eoc-no-transition');
                sentinel.classList.add('eoc-visible');
                requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                        sentinel.classList.remove('eoc-no-transition');
                    });
                });
            }
            for (var tp = 0; tp < tabPanes.length; tp++) {
                var initialTabName = getTabNameFromPaneId(tabPanes[tp].id || '');
                if (initialTabName) {
                    lastTabHtmls[initialTabName] = tabPanes[tp].innerHTML;
                }
            }

            // ─── Tab Slider: position ───
            function isTabHintEnabled() {
                return document.body.getAttribute('data-tab-hint-enabled') !== 'false';
            }
            function setTabHintState(enabled) {
                document.body.setAttribute('data-tab-hint-enabled', enabled ? 'true' : 'false');
                var badge = document.getElementById('tabHintState');
                if (badge) {
                    badge.textContent = enabled ? ${JSON.stringify(tBi('Auto Hint Enabled', '自动提示已开启'))} : ${JSON.stringify(tBi('Auto Hint Disabled', '自动提示已关闭'))};
                    badge.classList.toggle('is-ready', !!enabled);
                    badge.classList.toggle('is-missing', !enabled);
                }
            }
            function updateTabSlider() {
                var bar = document.querySelector('.tab-bar');
                var slider = document.querySelector('.tab-slider');
                var active = document.querySelector('.tab-btn.active');
                if (!bar || !slider || !active) return;
                slider.style.left = active.offsetLeft + 'px';
                slider.style.width = active.offsetWidth + 'px';
            }
            function updateTabOverflowHint() {
                var bar = document.querySelector('.tab-bar');
                var hint = document.getElementById('tabScrollHint');
                if (!bar || !hint) return;
                if (!isTabHintEnabled()) {
                    hint.hidden = true;
                    return;
                }
                /* data-force-show: 用户手动"立即显示"时设置，跳过 overflow 判断 */
                if (hint.hasAttribute('data-force-show')) {
                    hint.hidden = false;
                    return;
                }
                var overflowX = Math.ceil(bar.scrollWidth - bar.clientWidth);
                var needsHint = overflowX > 8;
                hint.hidden = !needsHint;
            }
            function switchTab(tabName, focusTab, restoring) {
                var selected = Array.from(tabBtns).find(function(button) { return button.dataset.tab === tabName; });
                if (!selected) { return; }
                if (!restoring && activeTab === tabName) {
                    if (focusTab) { selected.focus({ preventScroll: true }); }
                    selected.scrollIntoView({ inline: 'nearest', block: 'nearest' });
                    return;
                }
                var s = vscode.getState() || {};
                var ts = s.tabScrolls || {};
                if (!restoring) { ts[activeTab] = window.scrollY; }
                s.tabScrolls = ts;

                activeTab = tabName;
                for (var i = 0; i < tabBtns.length; i++) {
                    tabBtns[i].classList.toggle('active', tabBtns[i] === selected);
                    if (tabBtns[i] === selected) { tabBtns[i].setAttribute('aria-current', 'page'); }
                    else { tabBtns[i].removeAttribute('aria-current'); }
                }
                for (var j = 0; j < tabPanes.length; j++) {
                    tabPanes[j].classList.toggle('active', tabPanes[j].id === 'tab-' + tabName);
                }
                s.activeTab = tabName;
                vscode.setState(s);

                // Focus synchronously on the visible tab button to avoid async rAF focus steals
                if (focusTab) { selected.focus({ preventScroll: true }); }

                updateTabSlider();
                updateTabOverflowHint();
                updateTabArrows();

                // Restore incoming tab scroll position after layout
                tabScrolls = ts; // Update local ref
                var targetY = ts[tabName] || 0;
                requestAnimationFrame(function() {
                    if (activeTab !== tabName) { return; }
                    selected.scrollIntoView({ inline: 'nearest', block: 'nearest' });
                    window.scrollTo(0, targetY);
                    updateTabSlider();
                });
            }
            if (requestedTab) { switchTab(requestedTab, false, true); }
            // Init slider position (must wait for layout and font settlement)
            requestAnimationFrame(function() { updateTabSlider(); updateTabOverflowHint(); updateTabArrows(); });
            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(function() {
                    updateTabSlider();
                    updateTabOverflowHint();
                    updateTabArrows();
                });
            }
            var tabBarEl = document.querySelector('.tab-bar');
            if (tabBarEl) {
                tabBarEl.addEventListener('scroll', function() {
                    updateTabOverflowHint();
                    updateTabArrows();
                }, { passive: true });
                if (typeof ResizeObserver !== 'undefined') {
                    new ResizeObserver(function() {
                        updateTabSlider();
                        updateTabOverflowHint();
                        updateTabArrows();
                    }).observe(tabBarEl);
                }
            }
            window.addEventListener('resize', function() {
                updateTabSlider();
                updateTabOverflowHint();
                updateTabArrows();
            });
            var dismissTabHintBtn = document.getElementById('dismissTabScrollHint');
            if (dismissTabHintBtn) {
                dismissTabHintBtn.addEventListener('click', function() {
                    var dHint = document.getElementById('tabScrollHint');
                    if (dHint) { dHint.removeAttribute('data-force-show'); }
                    setTabHintState(false);
                    updateTabOverflowHint();
                    vscode.postMessage({ command: 'setPanelPref', key: 'panelShowTabScrollHint', value: false });
                });
            }

            // ─── Tab Arrow Navigation ───
            function updateTabArrows() {
                var bar = document.querySelector('.tab-bar');
                var arrowL = document.getElementById('tabArrowLeft');
                var arrowR = document.getElementById('tabArrowRight');
                if (!bar || !arrowL || !arrowR) return;
                var overflowX = Math.ceil(bar.scrollWidth - bar.clientWidth);
                if (overflowX <= 4) {
                    // No overflow — fade both arrows out (keep layout space)
                    arrowL.classList.add('is-faded');
                    arrowR.classList.add('is-faded');
                    return;
                }
                // Fade based on scroll position
                arrowL.classList.toggle('is-faded', bar.scrollLeft <= 4);
                arrowR.classList.toggle('is-faded', bar.scrollLeft >= overflowX - 4);
            }

            requestAnimationFrame(function() { updateTabArrows(); });

            var tabArrowL = document.getElementById('tabArrowLeft');
            var tabArrowR = document.getElementById('tabArrowRight');
            if (tabArrowL) {
                tabArrowL.addEventListener('click', function() {
                    var bar = document.querySelector('.tab-bar');
                    if (bar) { bar.scrollBy({ left: -150, behavior: 'smooth' }); }
                });
            }
            if (tabArrowR) {
                tabArrowR.addEventListener('click', function() {
                    var bar = document.querySelector('.tab-bar');
                    if (bar) { bar.scrollBy({ left: 150, behavior: 'smooth' }); }
                });
            }


            // ─── Calendar: Restore expanded date after refresh ───
            var calSelectedDate = savedState.calendarSelectedDate || '';
            if (calSelectedDate) {
                var restorePanel = document.querySelector('[data-cal-detail="' + calSelectedDate + '"]');
                var restoreCell = document.querySelector('.cal-cell.has-data[data-cal-date="' + calSelectedDate + '"]');
                if (restorePanel) {
                    restorePanel.style.display = 'block';
                    restorePanel.style.animation = 'none'; // Skip fade-in on restore
                    restorePanel.classList.add('cal-detail-open');
                }
                if (restoreCell) {
                    restoreCell.classList.add('selected');
                }
            }
            for (var ti = 0; ti < tabBtns.length; ti++) {
                tabBtns[ti].addEventListener('click', function() {
                    switchTab(this.dataset.tab);
                });
            }
            if (tabBarEl) {
                tabBarEl.addEventListener('keydown', function(event) {
                    var targetBtn = event.target && event.target.closest ? event.target.closest('.tab-btn') : event.target;
                    var index = Array.from(tabBtns).indexOf(targetBtn);
                    if (index < 0) { return; }
                    if (event.key === 'ArrowLeft') { index = (index - 1 + tabBtns.length) % tabBtns.length; }
                    else if (event.key === 'ArrowRight') { index = (index + 1) % tabBtns.length; }
                    else if (event.key === 'Home') { index = 0; }
                    else if (event.key === 'End') { index = tabBtns.length - 1; }
                    else { return; }
                    event.preventDefault();
                    tabBtns[index].focus();
                });
            }


            // ─── Account Popover Toggle ───
            var acctPopoverOpen = false;
            function toggleAccountPopover(forceClose) {
                var trigger = document.getElementById('acctPopoverTrigger');
                var dropdown = document.getElementById('acctPopoverPanel');
                if (!trigger || !dropdown) return;
                if (forceClose === true) {
                    acctPopoverOpen = false;
                } else {
                    acctPopoverOpen = !acctPopoverOpen;
                }
                trigger.classList.toggle('is-open', acctPopoverOpen);
                trigger.setAttribute('aria-expanded', String(acctPopoverOpen));
                if (acctPopoverOpen) {
                    dropdown.hidden = false;
                    requestAnimationFrame(function() {
                        dropdown.classList.add('is-visible');
                    });
                } else {
                    dropdown.classList.remove('is-visible');
                    // Wait for transition to finish before hiding
                    setTimeout(function() {
                        if (!acctPopoverOpen) { dropdown.hidden = true; }
                    }, 200);
                }
            }
            var acctTriggerBtn = document.getElementById('acctPopoverTrigger');
            if (acctTriggerBtn) {
                acctTriggerBtn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    toggleAccountPopover();
                });
            }
            // Close on click outside
            document.addEventListener('click', function(e) {
                if (!acctPopoverOpen) return;
                var anchor = document.querySelector('.acct-popover-anchor');
                var ddPanel = document.getElementById('acctPopoverPanel');
                if (anchor && anchor.contains(e.target)) return;
                if (ddPanel && ddPanel.contains(e.target)) return;
                toggleAccountPopover(true);
            });
            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && acctPopoverOpen) {
                    toggleAccountPopover(true);
                    if (acctTriggerBtn) { acctTriggerBtn.focus(); }
                    e.stopPropagation();
                }
            });

            function restoreDetailsState(rootState) {
                var ds = (rootState && rootState.detailsOpen) || {};
                var dd = document.querySelectorAll('details[id]');
                for (var di = 0; di < dd.length; di++) {
                    var det = dd[di];
                    var stateKey = det.dataset.stateKey || det.id;
                    if (Object.prototype.hasOwnProperty.call(ds, stateKey)) {
                        det.open = !!ds[stateKey];
                    }
                    if (det.getAttribute('data-details-bound') !== 'true') {
                        det.addEventListener('toggle', function() {
                            var s = vscode.getState() || {};
                            var dso = s.detailsOpen || {};
                            dso[this.dataset.stateKey || this.id] = this.open;
                            s.detailsOpen = dso;
                            vscode.setState(s);
                        });
                        det.setAttribute('data-details-bound', 'true');
                    }
                }
            }

            function bindHistoryCatalog() {
                var searchInput = document.getElementById('historySearchInput');
                var filterBtns = document.querySelectorAll('.ses-filter-btn');
                if (!searchInput && filterBtns.length === 0) { return; }

                var state = vscode.getState() || {};
                var activeFilter = state.historyFilter || 'all';
                if (searchInput) {
                    searchInput.value = state.historySearch || '';
                }

                function applyHistoryFilters() {
                    for (var fi = 0; fi < filterBtns.length; fi++) {
                        var selected = filterBtns[fi].dataset.historyFilter === activeFilter;
                        filterBtns[fi].classList.toggle('is-active', selected);
                        filterBtns[fi].setAttribute('aria-pressed', String(selected));
                    }
                    var query = searchInput ? (searchInput.value || '').toLowerCase().trim() : '';
                    var rows = document.querySelectorAll('[data-history-row="true"]');
                    for (var ri = 0; ri < rows.length; ri++) {
                        var row = rows[ri];
                        var searchText = (row.getAttribute('data-search') || '').toLowerCase();
                        var matchesSearch = !query || searchText.indexOf(query) !== -1;
                        var matchesFilter = true;
                        if (activeFilter === 'current') {
                            matchesFilter = row.getAttribute('data-current-workspace') === 'true';
                        } else if (activeFilter === 'currentrepo') {
                            matchesFilter = row.getAttribute('data-current-repo') === 'true';
                        } else if (activeFilter === 'running') {
                            matchesFilter = row.getAttribute('data-running') === 'true';
                        } else if (activeFilter === 'recordable') {
                            matchesFilter = row.getAttribute('data-recordable') === 'true';
                        }
                        row.hidden = !(matchesSearch && matchesFilter);
                    }

                    var groups = document.querySelectorAll('.ses-group');
                    for (var gi = 0; gi < groups.length; gi++) {
                        var visibleRows = groups[gi].querySelectorAll('[data-history-row="true"]:not([hidden])');
                        groups[gi].hidden = visibleRows.length === 0;
                    }
                }

                if (searchInput && searchInput.getAttribute('data-history-bound') !== 'true') {
                    searchInput.addEventListener('input', function() {
                        var s = vscode.getState() || {};
                        s.historySearch = this.value || '';
                        vscode.setState(s);
                        applyHistoryFilters();
                    });
                    searchInput.setAttribute('data-history-bound', 'true');
                }

                for (var fi = 0; fi < filterBtns.length; fi++) {
                    if (filterBtns[fi].getAttribute('data-history-bound') !== 'true') {
                        filterBtns[fi].addEventListener('click', function() {
                            activeFilter = this.dataset.historyFilter || 'all';
                            var s = vscode.getState() || {};
                            s.historyFilter = activeFilter;
                            vscode.setState(s);
                            applyHistoryFilters();
                        });
                        filterBtns[fi].setAttribute('data-history-bound', 'true');
                    }
                }

                var shortcutBtns = document.querySelectorAll('[data-history-shortcut]');
                for (var si = 0; si < shortcutBtns.length; si++) {
                    if (shortcutBtns[si].getAttribute('data-history-bound') !== 'true') {
                        shortcutBtns[si].addEventListener('click', function() {
                            activeFilter = this.dataset.historyShortcut || 'all';
                            var s = vscode.getState() || {};
                            s.historyFilter = activeFilter;
                            vscode.setState(s);
                            applyHistoryFilters();
                        });
                        shortcutBtns[si].setAttribute('data-history-bound', 'true');
                    }
                }

                applyHistoryFilters();
            }
            bindHistoryCatalog();


            // Restore model stats error toggle state (default: hidden)
            if (savedState.modelStatsShowErrors) {
                var errToggle = document.getElementById('modelStatsErrToggle');
                if (errToggle) { errToggle.classList.remove('is-off'); }
                var cardsGrid = document.querySelector('.act-cards-grid');
                if (cardsGrid) { cardsGrid.classList.add('model-stats-show-errors'); }
            }

            // ─── Scroll Shadow on TopBar ───
            var topbar = document.querySelector('.panel-topbar');
            if (topbar) {
                window.addEventListener('scroll', function() {
                    topbar.classList.toggle('scrolled', window.scrollY > 8);
                }, { passive: true });
                // Apply immediately in case restored scroll > 0
                topbar.classList.toggle('scrolled', window.scrollY > 8);
            }

            // ─── Settings: Polling Interval (auto-save on change / Enter + Save button) ───
            var pollingInput = document.getElementById('pollingInput');
            var pollingSaveBtn = document.getElementById('pollingSaveBtn');
            function savePollingInterval() {
                if (!pollingInput) { return; }
                var val = parseInt(pollingInput.value, 10);
                if (val >= 1 && val <= 60) {
                    vscode.postMessage({ command: 'setPollingInterval', value: val });
                    flashFeedback('pollingFeedback', savedText, 2000);
                }
            }
            if (pollingSaveBtn && pollingInput) {
                pollingSaveBtn.addEventListener('click', savePollingInterval);
            }
            if (pollingInput) {
                pollingInput.addEventListener('change', savePollingInterval);
                pollingInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') { e.preventDefault(); savePollingInterval(); }
                });
            }

            // ─── Zoom Control ───
            var bodyZoom = document.body.dataset.zoom ? parseInt(document.body.dataset.zoom, 10) : 0;
            var zoomLevel = bodyZoom || savedState.zoomLevel || 100;
            function applyZoom(level) {
                zoomLevel = level;
                document.body.style.zoom = (level / 100).toString();
                var valEl = document.getElementById('zoomValue');
                if (valEl) { valEl.textContent = level + '%'; }
                var rangeEl = document.getElementById('zoomRange');
                if (rangeEl) { rangeEl.value = level; }
                // Highlight active preset
                var presets = document.querySelectorAll('.zoom-preset');
                for (var zi = 0; zi < presets.length; zi++) {
                    presets[zi].classList.toggle('is-active', parseInt(presets[zi].dataset.zoom, 10) === level);
                }
                // Persist (webview state + durable backend)
                var s = vscode.getState() || {};
                s.zoomLevel = level;
                vscode.setState(s);
                vscode.postMessage({ command: 'setZoomLevel', value: level });
                requestAnimationFrame(function() {
                    updateTabSlider();
                    updateTabOverflowHint();
                    updateTabArrows();
                });
            }
            // Apply on load
            if (zoomLevel !== 100) { applyZoom(zoomLevel); }
            // Preset buttons
            var zoomPresets = document.querySelectorAll('.zoom-preset');
            for (var zpi = 0; zpi < zoomPresets.length; zpi++) {
                zoomPresets[zpi].addEventListener('click', function() {
                    applyZoom(parseInt(this.dataset.zoom, 10));
                });
                // Mark initial active
                if (parseInt(zoomPresets[zpi].dataset.zoom, 10) === zoomLevel) {
                    zoomPresets[zpi].classList.add('is-active');
                }
            }
            // Range slider
            var zoomRange = document.getElementById('zoomRange');
            if (zoomRange) {
                zoomRange.value = zoomLevel;
                zoomRange.addEventListener('input', function() {
                    applyZoom(parseInt(this.value, 10));
                });
            }
            // Initial value display
            var zoomValEl = document.getElementById('zoomValue');
            if (zoomValEl) { zoomValEl.textContent = zoomLevel + '%'; }

            // ─── Settings: Status Bar Toggles ───
            var tooltipDensitySelect = document.getElementById('statusTooltipDensity');
            if (tooltipDensitySelect) {
                tooltipDensitySelect.addEventListener('change', function() {
                    vscode.postMessage({ command: 'setConfig', key: 'statusBar.tooltipDensity', value: this.value });
                });
            }

            var toggleIds = ['toggleContext', 'toggleQuota', 'toggleCountdown', 'toggleAiCredits', 'toggleSpeed', 'toggleCacheHit', 'toggleSessionCost', 'toggleModelInternalId'];
            var toggleKeys = ['statusBar.showContext', 'statusBar.showQuota', 'statusBar.showResetCountdown', 'statusBar.showAiCredits', 'statusBar.showSpeed', 'statusBar.showCacheHit', 'statusBar.showSessionCost', 'showModelInternalId'];
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
            var lockMainSettingsCb = document.getElementById('toggleLockMainAgent');
            if (lockMainSettingsCb) {
                lockMainSettingsCb.addEventListener('change', function() {
                    var nextLocked = !!this.checked;
                    syncLockMainVisual(nextLocked);
                    vscode.postMessage({ command: 'toggleLockMain', locked: nextLocked });
                });
            }

            // ─── Settings: Scrollbar & End-of-Content Toggles ───
            function applyScrollbarHide(hide) {
                document.body.setAttribute('data-hide-scrollbar', hide ? 'true' : 'false');
                document.documentElement.setAttribute('data-hide-scrollbar', hide ? 'true' : 'false');
                // Runtime style injection — highest specificity, bypasses VS Code UA stylesheet
                var dynId = 'ag-scrollbar-override';
                var existing = document.getElementById(dynId);
                if (hide) {
                    if (!existing) {
                        var s = document.createElement('style');
                        s.id = dynId;
                        s.textContent = 'html, body, * { scrollbar-width: none !important; } ' +
                            '::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }';
                        document.head.appendChild(s);
                    }
                } else {
                    if (existing) { existing.remove(); }
                }
            }
            // Apply on load based on body attribute
            if (document.body.getAttribute('data-hide-scrollbar') === 'true') {
                applyScrollbarHide(true);
            }
            var scrollbarCb = document.getElementById('toggleScrollbar');
            if (scrollbarCb) {
                scrollbarCb.addEventListener('change', function() {
                    applyScrollbarHide(!this.checked);
                    vscode.postMessage({ command: 'setPanelPref', key: 'panelShowScrollbar', value: this.checked });
                });
            }
            var eocCb = document.getElementById('toggleEndOfContent');
            if (eocCb) {
                eocCb.addEventListener('change', function() {
                    document.body.setAttribute('data-hide-eoc', this.checked ? 'false' : 'true');
                    vscode.postMessage({ command: 'setPanelPref', key: 'panelShowEndOfContent', value: this.checked });
                });
            }

            // ─── Language Switcher ───
            var switcher = document.querySelector('.lang-switcher');
            if (switcher) {
                switcher.addEventListener('click', function(e) {
                    var target = e.target instanceof Element
                        ? e.target
                        : (e.target && e.target.parentElement ? e.target.parentElement : null);
                    var btn = target && target.closest ? target.closest('.lang-btn') : null;
                    if (btn && btn.dataset && btn.dataset.lang) {
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
            var _refreshSpinTimer = null;
            if (refreshBtn) {
                refreshBtn.addEventListener('click', function() {
                    var btn = this;
                    btn.classList.remove('spinning');
                    void btn.offsetWidth;
                    btn.classList.add('spinning');
                    if (_refreshSpinTimer) { clearTimeout(_refreshSpinTimer); }
                    _refreshSpinTimer = setTimeout(function() { btn.classList.remove('spinning'); }, 650);
                    vscode.postMessage({ command: 'refresh' });
                });
            }

            // ─── Listen for setPaused message from extension ───
            window.addEventListener('message', function(event) {
                var msg = event.data;
                if (msg.command === 'setPaused' && pauseBtn) {
                    var paused = !!msg.paused;
                    pauseBtn.classList.toggle('paused', paused);
                    var pauseLabel = pauseBtn.getAttribute(paused ? 'data-label-resume' : 'data-label-pause') || '';
                    pauseBtn.setAttribute('data-tooltip', pauseLabel);
                    pauseBtn.setAttribute('aria-label', pauseLabel);
                    pauseBtn.setAttribute('aria-pressed', String(paused));
                    var pauseIcon = pauseBtn.querySelector('svg');
                    if (pauseIcon) {
                        pauseIcon.innerHTML = paused
                            ? '<path fill="currentColor" d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393"/>'
                            : '<path fill="currentColor" d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/>';
                    }
                    var updateTime = document.querySelector('.update-time');
                    if (updateTime) {
                        var pauseIndicator = updateTime.querySelector('.paused-indicator');
                        if (paused && !pauseIndicator) {
                            pauseIndicator = document.createElement('span');
                            pauseIndicator.className = 'paused-indicator';
                            pauseIndicator.textContent = pauseBtn.getAttribute('data-label-paused') || '';
                            updateTime.insertBefore(pauseIndicator, updateTime.firstChild);
                        } else if (!paused && pauseIndicator) {
                            pauseIndicator.remove();
                        }
                    }
                }
                if (msg.command === 'panelPrefUpdated' && msg.key === 'panelShowTabScrollHint') {
                    setTabHintState(!!msg.value);
                    /* 启用时不调用 updateTabOverflowHint，避免覆盖 force-show 状态 */
                    if (!msg.value) {
                        updateTabOverflowHint();
                    }
                }
                if (msg.command === 'panelPrefUpdated' && msg.key === 'panelShowScrollbar') {
                    applyScrollbarHide(!msg.value);
                }
                if (msg.command === 'panelPrefUpdated' && msg.key === 'panelShowEndOfContent') {
                    document.body.setAttribute('data-hide-eoc', msg.value ? 'false' : 'true');
                }
                if (msg.command === 'configSaved') {
                    var feedbackMap = {
                        'pollingInterval': 'pollingFeedback',
                        'quotaNotificationThreshold': 'quotaNotifyFeedback',
                        'statePath': 'statePathFeedback',
                        'panelShowTabScrollHint': 'panelHintFeedback',
                        'appComposerRingEnabled': 'appOverlaysFeedback',
                        'appTopBarEnabled': 'appOverlaysFeedback',
                        'showNativeHudBar': 'appOverlaysFeedback',
                        'autoCheckUpdates': 'updatesFeedback',
                        'orchestratorPricingMode': 'orchPricingModeFeedback',
                        'displayCurrency': 'customFxRateFeedback',
                        'customFxRate': 'customFxRateFeedback',
                        'subscriptionPlan': 'subscriptionFeedback',
                        'subscriptionMonthlyFee': 'subscriptionFeedback',
                        'subscriptionCurrency': 'subscriptionFeedback',
                        'calendarRetentionDays': 'calendarRetentionFeedback',
                        'activityMaxRecentSteps': 'activityMaxRecentStepsFeedback',
                        'activityMaxArchives': 'activityMaxArchivesFeedback'
                    };
                    // accountBillingDay feedback (Profile tab)
                    if (msg.key === 'accountBillingDay') {
                        flashProfileBillingFeedback('\u2713', false);
                    }
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
                if (msg.command === 'updateCheckResult') {
                    var updMsg = msg.error
                        ? (msg.error || checkFailedText)
                        : (msg.hasUpdate || msg.updateAvailable ? updateAvailableText : upToDateText);
                    syncUpdateStatusUi(msg.updateStatus || msg);
                    flashFeedback('updatesFeedback', updMsg, 3500);
                    flashFeedback('aboutUpdatesFeedback', updMsg, 3500);
                }
                if (msg.command === 'cdpStatusResult') {
                    var cdpRecheckEl = document.getElementById('cdpRecheckBtn');
                    if (cdpRecheckEl) { cdpRecheckEl.disabled = false; }
                    var nextCdpRes = msg.cdpStatus || msg;
                    syncCdpStatusUi(nextCdpRes);
                    var cdpResText = nextCdpRes.state === 'connected' ? cdpConnectedText
                        : (nextCdpRes.state === 'error' ? cdpErrorText
                            : (nextCdpRes.state === 'disabled' ? cdpDisabledText : cdpInactiveText));
                    flashFeedback('appOverlaysFeedback', cdpResText, 3200);
                }
                if (msg.command === 'cdpLauncherResult') {
                    var setupLauncherEl = document.getElementById('cdpSetupLauncherBtn');
                    var revealLauncherEl = document.getElementById('cdpRevealLauncherBtn');
                    var removeLauncherEl = document.getElementById('cdpRemoveLauncherBtn');
                    if (setupLauncherEl) { setupLauncherEl.disabled = false; }
                    if (revealLauncherEl) { revealLauncherEl.disabled = false; }
                    if (removeLauncherEl) { removeLauncherEl.disabled = false; }
                    var nextLauncherStatus = msg.launcherStatus || msg.status || (msg.cdpStatus && msg.cdpStatus.launcherStatus) || null;
                    if (nextLauncherStatus) {
                        syncCdpLauncherUi(nextLauncherStatus);
                    }
                    if (msg.cdpStatus && typeof msg.cdpStatus === 'object') {
                        syncCdpStatusUi(msg.cdpStatus);
                    }
                    var isRevealResult = msg.action === 'revealCdpLauncher';
                    var launcherFb = msg.ok
                        ? (pickLocalizedText(msg.messageEn, msg.messageZh) || (isRevealResult ? revealedText : savedText))
                        : (msg.error || pickLocalizedText(msg.messageEn, msg.messageZh) || (isRevealResult ? revealFailedText : cdpLauncherActionFailedText));
                    flashFeedback('cdpLauncherFeedback', launcherFb, 4500);
                }
                if (msg.command === 'pluginUpdateResult') {
                    var applyMsg = msg.ok ? (msg.message || upgradeDoneText) : (msg.error || msg.message || checkFailedText);
                    flashFeedback('updatesFeedback', applyMsg, 4500);
                    flashFeedback('aboutUpdatesFeedback', applyMsg, 4500);
                }
                if (msg.command === 'syncSettingsControls') {
                    var syncTogglePairs = [
                        ['toggleContext', 'showContext'],
                        ['toggleQuota', 'showQuota'],
                        ['toggleCountdown', 'showResetCountdown'],
                        ['toggleAiCredits', 'showAiCredits'],
                        ['toggleSpeed', 'showSpeed'],
                        ['toggleCacheHit', 'showCacheHit'],
                        ['toggleSessionCost', 'showSessionCost'],
                        ['toggleModelInternalId', 'showModelInternalId'],
                        ['toggleAppComposerRing', 'appComposerRingEnabled'],
                        ['toggleAppTopBar', 'appTopBarEnabled'],
                        ['toggleNativeHudBar', 'showNativeHudBar'],
                        ['toggleAutoCheckUpdates', 'autoCheckUpdates'],
                    ];
                    for (var sti = 0; sti < syncTogglePairs.length; sti++) {
                        var fieldName = syncTogglePairs[sti][1];
                        if (typeof msg[fieldName] === 'boolean') {
                            var cbEl = document.getElementById(syncTogglePairs[sti][0]);
                            if (cbEl) { cbEl.checked = msg[fieldName]; }
                        }
                    }
                    if (typeof msg.lockToMainAgent === 'boolean') {
                        syncLockMainVisual(msg.lockToMainAgent);
                    }
                    if (typeof msg.tooltipDensity === 'string') {
                        var tdEl = document.getElementById('statusTooltipDensity');
                        if (tdEl) { tdEl.value = msg.tooltipDensity; }
                    }
                    if (typeof msg.orchestratorPricingMode === 'string') {
                        syncOrchestratorPricingModeVisual(msg.orchestratorPricingMode);
                    }
                    if (typeof msg.displayCurrency === 'string') {
                        var dcEl = document.getElementById('displayCurrencySelect');
                        if (dcEl) { dcEl.value = msg.displayCurrency; }
                    }
                    if (typeof msg.subscriptionCurrency === 'string') {
                        var scEl = document.getElementById('subscriptionCurrencySelect');
                        if (scEl) { scEl.value = msg.subscriptionCurrency; }
                    }
                    if (typeof msg.subscriptionPlan === 'string') {
                        var spEl = document.getElementById('subscriptionPlanSelect');
                        if (spEl) { spEl.value = msg.subscriptionPlan; }
                        syncSubscriptionFeePlaceholder(msg.subscriptionPlan);
                    }
                    if (typeof msg.pollingInterval === 'number') {
                        var piEl = document.getElementById('pollingInput');
                        if (piEl) { piEl.value = String(msg.pollingInterval); }
                    }
                    if (typeof msg.quotaNotificationThreshold === 'number') {
                        var qnEl = document.getElementById('quotaNotifyInput');
                        if (qnEl) { qnEl.value = String(msg.quotaNotificationThreshold); }
                    }
                    if (Object.prototype.hasOwnProperty.call(msg, 'customFxRate')) {
                        var fxEl = document.getElementById('customFxRateInput');
                        if (fxEl) {
                            fxEl.value = (typeof msg.customFxRate === 'number' && isFinite(msg.customFxRate))
                                ? String(msg.customFxRate)
                                : '';
                        }
                    }
                    if (Object.prototype.hasOwnProperty.call(msg, 'subscriptionMonthlyFee')) {
                        var sfEl = document.getElementById('subscriptionFeeInput');
                        if (sfEl) {
                            sfEl.value = (typeof msg.subscriptionMonthlyFee === 'number' && isFinite(msg.subscriptionMonthlyFee))
                                ? String(msg.subscriptionMonthlyFee)
                                : '';
                        }
                    }
                    if (typeof msg.calendarRetentionDays === 'number') {
                        var crEl = document.getElementById('calendarRetentionInput');
                        if (crEl) { crEl.value = String(msg.calendarRetentionDays); }
                    }
                    if (typeof msg.activityMaxRecentSteps === 'number') {
                        var msEl = document.getElementById('activityMaxRecentStepsInput');
                        if (msEl) { msEl.value = String(msg.activityMaxRecentSteps); }
                    }
                    if (typeof msg.activityMaxArchives === 'number') {
                        var maEl = document.getElementById('activityMaxArchivesInput');
                        if (maEl) { maEl.value = String(msg.activityMaxArchives); }
                    }
                    if (msg.cdpStatus && typeof msg.cdpStatus === 'object') {
                        syncCdpStatusUi(msg.cdpStatus, msg.appComposerRingEnabled, msg.appTopBarEnabled);
                    } else if (typeof msg.appComposerRingEnabled === 'boolean' || typeof msg.appTopBarEnabled === 'boolean') {
                        var cOn = typeof msg.appComposerRingEnabled === 'boolean'
                            ? msg.appComposerRingEnabled
                            : Boolean((document.getElementById('toggleAppComposerRing') || {}).checked);
                        var tOn = typeof msg.appTopBarEnabled === 'boolean'
                            ? msg.appTopBarEnabled
                            : Boolean((document.getElementById('toggleAppTopBar') || {}).checked);
                        if (!cOn && !tOn) {
                            syncCdpStatusUi({ state: 'disabled', diagnosticCode: 'disabled' }, false, false);
                        } else {
                            var cdpPillNow = document.getElementById('cdpStatusPill');
                            if (cdpPillNow && cdpPillNow.getAttribute('data-cdp-state') === 'disabled') {
                                syncCdpStatusUi({ state: 'cdp_unavailable', diagnosticCode: 'missing_port_file' }, cOn, tOn);
                            }
                        }
                    }
                    if (msg.updateStatus && typeof msg.updateStatus === 'object') {
                        syncUpdateStatusUi(msg.updateStatus);
                    }
                }
                if (msg.command === 'copyActionResult') {
                    if (msg.ok) {
                        var actionBtn = msg.action ? document.querySelector('[data-action="' + msg.action + '"]') : null;
                        flashCopyButton(actionBtn);
                    }
                }
                if (msg.command === 'stateFileActionResult') {
                    var text = '';
                    if (msg.ok) {
                        text = msg.action === 'reveal' ? revealedText : openedText;
                    } else {
                        text = msg.message || (msg.action === 'reveal' ? revealFailedText : openFailedText);
                    }
                    flashFeedback('statePathFeedback', text, 3200);
                }
            });



            // ─── Error message overflow detection ───
            // Marks .gm-err-expand items whose summary text fits without
            // CSS truncation as .no-overflow (hides expand arrow, disables click).
            function initErrorOverflow() {
                var items = document.querySelectorAll('.gm-err-expand:not([data-overflow-checked])');
                for (var eoi = 0; eoi < items.length; eoi++) {
                    var det = items[eoi];
                    var sum = det.querySelector('.gm-err-msg-summary');
                    if (!sum) continue;
                    det.setAttribute('data-overflow-checked', 'true');
                    // scrollWidth > clientWidth means CSS ellipsis is active
                    if (sum.scrollWidth <= sum.clientWidth) {
                        det.classList.add('no-overflow');
                    }
                }
            }

            // ─── Restore & persist ALL <details> states ───
            restoreDetailsState(savedState);

            // ─── Tool Catalog: smart tooltip (show full name when truncated) ───
            function bindToolCatalogTooltips() {
                var chips = document.querySelectorAll('.tool-cat-chip:not([data-tc-bound])');
                for (var tci = 0; tci < chips.length; tci++) {
                    chips[tci].setAttribute('data-tc-bound', 'true');
                    chips[tci].addEventListener('mouseenter', function() {
                        var name = this.getAttribute('data-tooltip-name') || '';
                        var desc = this.getAttribute('data-tooltip-desc') || '';
                        var textEl = this.querySelector('.tool-cat-chip-text');
                        var isTruncated = textEl ? textEl.scrollWidth > textEl.clientWidth : false;
                        if (isTruncated) {
                            this.setAttribute('data-tooltip', desc ? name + ' \u2014 ' + desc : name);
                        } else {
                            if (desc) {
                                this.setAttribute('data-tooltip', desc);
                            } else {
                                this.removeAttribute('data-tooltip');
                            }
                        }
                    });
                }
            }

            // Run overflow check after layout settles
            requestAnimationFrame(function() { initErrorOverflow(); bindToolCatalogTooltips(); });

            // num-spinner-btn: handled by body delegation below

            // copyRawJson: handled by body delegation below

            // ─── Quota Notification Threshold (auto-save on change / Enter + Save button) ───
            var quotaNotifyBtn = document.getElementById('quotaNotifySaveBtn');
            var quotaNotifyInput = document.getElementById('quotaNotifyInput');
            function saveQuotaThreshold() {
                if (!quotaNotifyInput) { return; }
                var val = parseInt(quotaNotifyInput.value, 10);
                if (val >= 0 && val <= 99) {
                    vscode.postMessage({ command: 'setConfig', key: 'quotaNotificationThreshold', value: val });
                    flashFeedback('quotaNotifyFeedback', savedText, 2000);
                }
            }
            if (quotaNotifyBtn && quotaNotifyInput) {
                quotaNotifyBtn.addEventListener('click', saveQuotaThreshold);
            }
            if (quotaNotifyInput) {
                quotaNotifyInput.addEventListener('change', saveQuotaThreshold);
                quotaNotifyInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') { e.preventDefault(); saveQuotaThreshold(); }
                });
            }

            // profileBillingDaySaveBtn: handled by body delegation below

            // copyStatePath / openStateFile / revealStateFile / restoreTabScrollHint:
            // handled by body delegation below

            // pricing Save/Reset: handled by body delegation below

            // Fail closed in the HTML, then restore the current webview preference.
            var privacyDefault = document.body.getAttribute('data-privacy-default') === 'true';
            function isAccountMasked() {
                var state = vscode.getState() || {};
                return state.privacyMasked !== undefined ? !!state.privacyMasked : privacyDefault;
            }
            function applyPrivacyMask() {
                var masked = isAccountMasked();
                document.querySelectorAll('[data-real][data-masked]').forEach(function(node) {
                    node.textContent = node.getAttribute(masked ? 'data-masked' : 'data-real');
                });
                var button = document.getElementById('privacyToggle');
                if (button) {
                    button.classList.toggle('active', masked);
                    button.setAttribute('aria-pressed', String(masked));
                }
            }
            applyPrivacyMask();
            applyContextVizMode(getContextVizMode());
            applyNativeHudExpanded(getNativeHudExpanded());

            function commitAppSettingControl(el) {
                if (!el || !el.getAttribute) { return; }
                var key = el.getAttribute('data-app-setting');
                if (!key) { return; }
                var fbId = el.getAttribute('data-feedback-id') || '';
                var value;
                if (el.type === 'checkbox') {
                    value = !!el.checked;
                    if (key === 'showNativeHudBar') {
                        var hudHost = document.getElementById('nativeHudHost');
                        if (hudHost) {
                            hudHost.hidden = !value || !hudHost.innerHTML.trim();
                        }
                    }
                } else if (el.tagName === 'SELECT') {
                    value = el.value;
                    if (key === 'subscriptionPlan') {
                        syncSubscriptionFeePlaceholder(value);
                    }
                } else {
                    var settingType = el.getAttribute('data-setting-type') || 'string';
                    var raw = String(el.value || '').trim();
                    if (settingType === 'int') {
                        var parsedInt = parseInt(raw, 10);
                        var minAttr = el.min !== '' ? parseInt(el.min, 10) : -Infinity;
                        var maxAttr = el.max !== '' ? parseInt(el.max, 10) : Infinity;
                        if (!isFinite(parsedInt) || parsedInt < minAttr || parsedInt > maxAttr) {
                            if (fbId) { flashFeedback(fbId, invalidBillingDayText, 2000); }
                            return;
                        }
                        value = parsedInt;
                    } else if (settingType === 'nullable-float') {
                        if (!raw) {
                            value = null;
                        } else {
                            var parsedFloat = parseFloat(raw);
                            var minF = el.min !== '' ? parseFloat(el.min) : -Infinity;
                            var maxF = el.max !== '' ? parseFloat(el.max) : Infinity;
                            if (!isFinite(parsedFloat) || parsedFloat < minF || parsedFloat > maxF) {
                                if (fbId) { flashFeedback(fbId, invalidBillingDayText, 2000); }
                                return;
                            }
                            value = parsedFloat;
                        }
                    } else {
                        value = raw;
                    }
                }
                vscode.postMessage({ command: 'setAppSetting', key: key, value: value });
                if (fbId) { flashFeedback(fbId, savedText, 2000); }
            }

            // ─── Delegated Change & Enter Auto-Save (Conversation Switcher + App Settings) ───
            document.body.addEventListener('change', function(e) {
                var target = e.target;
                if (target && target.id === 'conversationSwitcher') {
                    var selectedId = target.value || null;
                    vscode.postMessage({ command: 'selectConversation', conversationId: selectedId });
                    return;
                }
                if (target && target.getAttribute && target.getAttribute('data-app-setting')) {
                    commitAppSettingControl(target);
                }
            });
            document.body.addEventListener('keydown', function(e) {
                if (e.key !== 'Enter') { return; }
                var target = e.target;
                if (target && target.tagName === 'INPUT' && target.getAttribute && target.getAttribute('data-app-setting')) {
                    e.preventDefault();
                    commitAppSettingControl(target);
                }
            });

            // ─── Synced Hover / Focus Highlight for Context Composition Breakdown ───
            function setCtxHighlight(target, active) {
                if (!target || !target.closest) { return; }
                var catEl = target.closest('[data-ctx-cat]');
                if (!catEl) { return; }
                var card = catEl.closest('.ctx-breakdown-card');
                if (!card) { return; }
                var cat = catEl.getAttribute('data-ctx-cat');
                if (active && cat && cat !== 'free') {
                    card.setAttribute('data-highlight-cat', cat);
                } else {
                    card.removeAttribute('data-highlight-cat');
                }
            }
            document.body.addEventListener('mouseover', function(e) {
                var target = e.target instanceof Element ? e.target : null;
                setCtxHighlight(target, true);
            });
            document.body.addEventListener('mouseout', function(e) {
                var target = e.target instanceof Element ? e.target : null;
                var rel = e.relatedTarget instanceof Element ? e.relatedTarget : null;
                if (target && target.closest && target.closest('[data-ctx-cat]')) {
                    if (!rel || !rel.closest || !rel.closest('[data-ctx-cat]')) {
                        setCtxHighlight(target, false);
                    }
                }
            });
            document.body.addEventListener('focusin', function(e) {
                var target = e.target instanceof Element ? e.target : null;
                setCtxHighlight(target, true);
            });
            document.body.addEventListener('focusout', function(e) {
                var target = e.target instanceof Element ? e.target : null;
                setCtxHighlight(target, false);
            });

            // ─── Restore scroll position (per-tab, debounced) ───
            var tabScrolls = savedState.tabScrolls || {};
            var currentScrollY = tabScrolls[activeTab] || 0;
            if (currentScrollY > 0) {
                // Double-rAF: first waits for paint, second for layout stabilisation
                requestAnimationFrame(function() {
                    requestAnimationFrame(function() {
                        window.scrollTo(0, currentScrollY);
                    });
                });
                // Fallback: in case rAF fires too early
                setTimeout(function() { window.scrollTo(0, currentScrollY); }, 80);
            }
            var _scrollTimer = null;
            window.addEventListener('scroll', function() {
                if (_scrollTimer) { clearTimeout(_scrollTimer); }
                _scrollTimer = setTimeout(function() {
                    var y = window.scrollY;
                    // Don't save 0 unless genuinely at top (prevents teardown pollution)
                    if (y === 0 && (tabScrolls[activeTab] || 0) > 50) { return; }
                    var s = vscode.getState() || {};
                    var ts = s.tabScrolls || {};
                    ts[activeTab] = y;
                    s.tabScrolls = ts;
                    vscode.setState(s);
                }, 150);
            });
            document.body.addEventListener('click', function(e) {
                var target = e.target instanceof Element
                    ? e.target
                    : (e.target && e.target.parentElement ? e.target.parentElement : null);
                if (!target || !target.closest) { return; }

                // ── Num-spinner buttons (universal, all tabs) ──
                var spinnerBtn = target.closest('.num-spinner-btn');
                if (spinnerBtn) {
                    var spinner = spinnerBtn.closest('.num-spinner');
                    if (spinner) {
                        var spinInput = spinner.querySelector('input[type="number"]');
                        if (spinInput) {
                            var step = parseFloat(spinInput.step) || 1;
                            var min = spinInput.min !== '' ? parseFloat(spinInput.min) : -Infinity;
                            var max = spinInput.max !== '' ? parseFloat(spinInput.max) : Infinity;
                            var val = parseFloat(spinInput.value) || 0;
                            if (spinnerBtn.classList.contains('increment')) {
                                val = Math.min(val + step, max);
                            } else {
                                val = Math.max(val - step, min);
                            }
                            spinInput.value = val;
                            spinInput.dispatchEvent(new Event('input', { bubbles: true }));
                            spinInput.dispatchEvent(new Event('change', { bubbles: true }));
                        }
                    }
                    return;
                }

                // ── Error message full-text click → collapse ──
                var errFull = target.closest('.gm-err-msg-full');
                if (errFull) {
                    var det = errFull.closest('details.gm-err-expand');
                    if (det) { det.removeAttribute('open'); }
                    return;
                }

                var overviewAction = target.closest('[data-overview-target]');
                if (overviewAction) {
                    switchTab(overviewAction.dataset.overviewTarget, true);
                    return;
                }

                // ── data-switch-tab links (e.g. Monitor → Profile "Details →") ──
                var switchLink = target.closest('[data-switch-tab]');
                if (switchLink) {
                    switchTab(switchLink.dataset.switchTab);
                    return;
                }

                // ── data-scroll-to: smooth scroll to element by ID ──
                var scrollLink = target.closest('[data-scroll-to]');
                if (scrollLink) {
                    e.preventDefault();
                    var scrollTarget = document.getElementById(scrollLink.dataset.scrollTo);
                    if (scrollTarget) {
                        scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        scrollTarget.focus();
                    }
                    return;
                }

                // ── About page: data-navigate-tab cards ──
                var navCard = target.closest('[data-navigate-tab]');
                if (navCard) {
                    switchTab(navCard.dataset.navigateTab);
                    return;
                }

                // ── Lock to Main Agent toggle ──
                var lockBtn = target.closest('[data-action="toggleLockMain"]');
                if (lockBtn) {
                    var nextLocked = lockBtn.getAttribute('aria-pressed') !== 'true';
                    syncLockMainVisual(nextLocked);
                    vscode.postMessage({ command: 'toggleLockMain', locked: nextLocked });
                    return;
                }

                // ── Context Composition Visualization Mode Toggle (Bar / Dot Matrix) ──
                var ctxVizBtn = target.closest('[data-ctx-viz]');
                if (ctxVizBtn) {
                    var nextViz = ctxVizBtn.getAttribute('data-ctx-viz') === 'dots' ? 'dots' : 'bar';
                    var vs = vscode.getState() || {};
                    vs.ctxVizMode = nextViz;
                    vscode.setState(vs);
                    applyContextVizMode(nextViz);
                    return;
                }

                // ── Quick Copy Actions (/context Report & Handoff Prompt) ──
                var copyActionBtn = target.closest('[data-action="copyContextReport"], [data-action="copyHandoffPrompt"]');
                if (copyActionBtn) {
                    var actionName = copyActionBtn.getAttribute('data-action');
                    if (bridge && bridge.surface !== 'vscode' && typeof bridge.sendAction === 'function') {
                        bridge.sendAction({ command: actionName }).then(function(res) {
                            if (res && res._copiedByBridge) {
                                flashCopyButton(copyActionBtn);
                            } else if (res && typeof res.text === 'string') {
                                copyTextSafe(res.text).then(function() { flashCopyButton(copyActionBtn); });
                            } else if (res && res.result && typeof res.result.text === 'string') {
                                copyTextSafe(res.result.text).then(function() { flashCopyButton(copyActionBtn); });
                            } else if (res && res.ok) {
                                flashCopyButton(copyActionBtn);
                            }
                        });
                    } else {
                        vscode.postMessage({ command: actionName });
                    }
                    return;
                }

                // ── Copy Raw JSON ──
                if (target.closest('#copyRawJson')) {
                    var cpyBtn = target.closest('#copyRawJson');
                    var rawEl = document.getElementById('rawJsonContent');
                    if (!rawEl) return;
                    copyTextSafe(rawEl.textContent || '').then(function() {
                        cpyBtn.classList.add('copied');
                        var origHtml = cpyBtn.innerHTML;
                        cpyBtn.textContent = copiedText;
                        setTimeout(function() { cpyBtn.innerHTML = origHtml; cpyBtn.classList.remove('copied'); }, 2000);
                    });
                    return;
                }

                // ── Copy All Errors ──
                if (target.closest('#copyAllErrors')) {
                    e.preventDefault();
                    e.stopPropagation();
                    var ueBtn = target.closest('#copyAllErrors');
                    var ueData = document.getElementById('ueClipboardData');
                    if (!ueData) return;
                    copyTextSafe(ueData.textContent || '').then(function() {
                        ueBtn.classList.add('copied');
                        var origUeHtml = ueBtn.innerHTML;
                        ueBtn.textContent = copiedText;
                        setTimeout(function() { ueBtn.innerHTML = origUeHtml; ueBtn.classList.remove('copied'); }, 2000);
                    });
                    return;
                }

                // ── Pricing Save ──
                if (target.closest('#pricingSaveBtn')) {
                    var inputs = document.querySelectorAll('.pricing-input');
                    var data;
                    try {
                        data = collectPricingInputOverrides(inputs);
                    } catch (_error) {
                        var feedback = document.getElementById('pricingFeedback');
                        if (feedback) {
                            feedback.textContent = invalidPricingText;
                            feedback.setAttribute('role', 'alert');
                        }
                        return;
                    }
                    vscode.postMessage({ command: 'savePricing', value: data });
                    return;
                }

                // ── Pricing Reset ──
                if (target.closest('#pricingResetBtn')) {
                    vscode.postMessage({ command: 'resetPricing' });
                    return;
                }

                // ── Clear Tool Catalog ──
                if (target.closest('#clearToolCatalogBtn')) {
                    vscode.postMessage({ command: 'clearToolCatalog' });
                    return;
                }

                // ── Profile: Billing Day Save ──
                if (target.closest('#profileBillingDaySaveBtn')) {
                    var bdInput = document.getElementById('profileBillingDayInput');
                    if (bdInput) {
                        var bdRaw = (bdInput.value || '').trim();
                        var bdVal = bdRaw ? Number(bdRaw) : NaN;
                        var bdEmail = (bdInput.getAttribute('data-email') || '').trim();
                        if (Number.isInteger(bdVal) && bdVal >= 0 && bdVal <= 31 && bdEmail) {
                            vscode.postMessage({ command: 'setAccountBillingDay', email: bdEmail, day: bdVal });
                        } else {
                            flashProfileBillingFeedback(invalidBillingDayText, true);
                        }
                    } else {
                        flashProfileBillingFeedback(invalidBillingDayText, true);
                    }
                    return;
                }

                // ── Privacy Mask Toggle ──
                if (target.closest('#privacyToggle')) {
                    var st = vscode.getState() || {};
                    st.privacyMasked = !isAccountMasked();
                    vscode.setState(st);
                    applyPrivacyMask();
                    return;
                }

                // ── Settings: State File Actions (delegation) ──
                if (target.closest('#copyStatePath')) {
                    vscode.postMessage({ command: 'copyStatePath' });
                    return;
                }
                if (target.closest('#openStateFile')) {
                    setFeedback('statePathFeedback', openingText);
                    vscode.postMessage({ command: 'openStateFile' });
                    return;
                }
                if (target.closest('#revealStateFile')) {
                    setFeedback('statePathFeedback', revealingText);
                    vscode.postMessage({ command: 'revealStateFile' });
                    return;
                }
                if (target.closest('#restoreTabScrollHint')) {
                    setTabHintState(true);
                    var hint = document.getElementById('tabScrollHint');
                    if (hint) {
                        hint.setAttribute('data-force-show', 'true');
                        hint.hidden = false;
                    }
                    vscode.postMessage({ command: 'setPanelPref', key: 'panelShowTabScrollHint', value: true });
                    return;
                }



                // ── Native HUD Expand/Collapse Toggle ──
                var hudToggleBtn = target.closest('[data-action="toggleNativeHud"]');
                if (hudToggleBtn) {
                    var nextHudExp = hudToggleBtn.getAttribute('aria-expanded') !== 'true';
                    var hudSt = vscode.getState() || {};
                    hudSt.nativeHudExpanded = nextHudExp;
                    vscode.setState(hudSt);
                    applyNativeHudExpanded(nextHudExp);
                    vscode.postMessage({ command: 'toggleNativeHud', expanded: nextHudExp });
                    return;
                }

                // ── Orchestrator Pricing Mode Toggle (Cost & Settings tabs) ──
                var orchModeBtn = target.closest('[data-action="setOrchestratorPricingMode"]');
                if (orchModeBtn) {
                    var nextPricingMode = orchModeBtn.getAttribute('data-mode') === 'strict' ? 'strict' : 'mapped';
                    syncOrchestratorPricingModeVisual(nextPricingMode);
                    flashFeedback('orchPricingModeFeedback', savedText, 2000);
                    vscode.postMessage({ command: 'setOrchestratorPricingMode', mode: nextPricingMode });
                    return;
                }

                // ── CDP Recheck Action (Settings tab) ──
                var recheckCdpBtn = target.closest('[data-action="recheckCdp"]');
                if (recheckCdpBtn) {
                    recheckCdpBtn.disabled = true;
                    setFeedback('appOverlaysFeedback', cdpCheckingText);
                    if (bridge && bridge.surface !== 'vscode' && typeof bridge.sendAction === 'function') {
                        Promise.resolve(bridge.sendAction({ command: 'recheckCdp' })).then(function(res) {
                            recheckCdpBtn.disabled = false;
                            var payload = (res && res.result) ? res.result : res;
                            var nextCdp = (payload && payload.cdpStatus)
                                ? payload.cdpStatus
                                : (payload && typeof payload.state === 'string' ? payload : null);
                            if (nextCdp) {
                                syncCdpStatusUi(nextCdp);
                                var resLabel = nextCdp.state === 'connected' ? cdpConnectedText
                                    : (nextCdp.state === 'error' ? cdpErrorText
                                        : (nextCdp.state === 'disabled' ? cdpDisabledText : cdpInactiveText));
                                flashFeedback('appOverlaysFeedback', resLabel, 3200);
                            } else {
                                flashFeedback('appOverlaysFeedback', savedText, 2200);
                            }
                        }).catch(function() {
                            recheckCdpBtn.disabled = false;
                            flashFeedback('appOverlaysFeedback', checkFailedText, 3000);
                        });
                    } else {
                        vscode.postMessage({ command: 'recheckCdp' });
                        setTimeout(function() { recheckCdpBtn.disabled = false; }, 1200);
                    }
                    return;
                }

                // ── Persistent CDP Launcher Actions (Settings tab) ──
                var launcherActionBtn = target.closest('[data-action="setupCdpLauncher"], [data-action="revealCdpLauncher"], [data-action="removeCdpLauncher"]');
                if (launcherActionBtn) {
                    var launcherCmd = launcherActionBtn.getAttribute('data-action');
                    var setupBtnRef = document.getElementById('cdpSetupLauncherBtn');
                    var revealBtnRef = document.getElementById('cdpRevealLauncherBtn');
                    var removeBtnRef = document.getElementById('cdpRemoveLauncherBtn');
                    if (setupBtnRef) { setupBtnRef.disabled = true; }
                    if (revealBtnRef) { revealBtnRef.disabled = true; }
                    if (removeBtnRef) { removeBtnRef.disabled = true; }
                    var pendingLauncherText = launcherCmd === 'removeCdpLauncher'
                        ? cdpLauncherRemovingText
                        : (launcherCmd === 'revealCdpLauncher' ? revealingText : cdpLauncherCreatingText);
                    setFeedback('cdpLauncherFeedback', pendingLauncherText);
                    if (bridge && bridge.surface !== 'vscode' && typeof bridge.sendAction === 'function') {
                        Promise.resolve(bridge.sendAction({ command: launcherCmd })).then(function(res) {
                            if (setupBtnRef) { setupBtnRef.disabled = false; }
                            if (revealBtnRef) { revealBtnRef.disabled = false; }
                            if (removeBtnRef) { removeBtnRef.disabled = false; }
                            var payload = (res && res.result) ? res.result : res;
                            var st = payload && (payload.launcherStatus || payload.status || (payload.cdpStatus && payload.cdpStatus.launcherStatus));
                            if (st) { syncCdpLauncherUi(st); }
                            if (payload && payload.cdpStatus) { syncCdpStatusUi(payload.cdpStatus); }
                            var isRevealCmd = launcherCmd === 'revealCdpLauncher';
                            var fbText = (payload && payload.ok === false)
                                ? (payload.error || pickLocalizedText(payload.messageEn, payload.messageZh) || (isRevealCmd ? revealFailedText : cdpLauncherActionFailedText))
                                : (pickLocalizedText(payload && payload.messageEn, payload && payload.messageZh) || (isRevealCmd ? revealedText : savedText));
                            flashFeedback('cdpLauncherFeedback', fbText, 4500);
                        }).catch(function() {
                            if (setupBtnRef) { setupBtnRef.disabled = false; }
                            if (revealBtnRef) { revealBtnRef.disabled = false; }
                            if (removeBtnRef) { removeBtnRef.disabled = false; }
                            flashFeedback('cdpLauncherFeedback', launcherCmd === 'revealCdpLauncher' ? revealFailedText : cdpLauncherActionFailedText, 3500);
                        });
                    } else {
                        vscode.postMessage({ command: launcherCmd });
                        setTimeout(function() {
                            if (setupBtnRef) { setupBtnRef.disabled = false; }
                            if (revealBtnRef) { revealBtnRef.disabled = false; }
                            if (removeBtnRef) { removeBtnRef.disabled = false; }
                        }, 1800);
                    }
                    return;
                }

                // ── CDP Guide Command Copy Button ──
                var cdpCopyBtn = target.closest('.cdp-copy-btn[data-copy-command]');
                if (cdpCopyBtn) {
                    var cmdText = cdpCopyBtn.getAttribute('data-copy-command') || '';
                    if (cmdText) {
                        copyTextSafe(cmdText).then(function(ok) {
                            if (ok) {
                                flashCopyButton(cdpCopyBtn);
                            } else {
                                vscode.postMessage({ command: 'copyText', text: cmdText, source: 'cdpGuideCommand' });
                                flashCopyButton(cdpCopyBtn);
                            }
                        });
                    }
                    return;
                }

                // ── Updates & Release Check Actions (Settings & About tabs) ──
                var checkUpdatesBtn = target.closest('[data-action="checkForUpdates"]');
                if (checkUpdatesBtn) {
                    setFeedback('updatesFeedback', checkingUpdatesText);
                    setFeedback('aboutUpdatesFeedback', checkingUpdatesText);
                    vscode.postMessage({ command: 'checkForUpdates', force: true });
                    return;
                }
                var applyUpdateBtn = target.closest('[data-action="applyPluginUpdate"]');
                if (applyUpdateBtn) {
                    setFeedback('updatesFeedback', upgradingText);
                    setFeedback('aboutUpdatesFeedback', upgradingText);
                    vscode.postMessage({ command: 'applyPluginUpdate' });
                    return;
                }

                // ── External URL Open Action ──
                var extUrlEl = target.closest('[data-action="openExternalUrl"]');
                if (extUrlEl) {
                    var targetUrl = extUrlEl.getAttribute('data-url') || extUrlEl.getAttribute('href') || '';
                    if (targetUrl) {
                        e.preventDefault();
                        vscode.postMessage({ command: 'openExternalUrl', url: targetUrl });
                    }
                    return;
                }

                // ── Settings: Calendar Retention Save Button (alongside auto-save) ──
                if (target.closest('#calendarRetentionSaveBtn')) {
                    var calRetInput = document.getElementById('calendarRetentionInput');
                    if (calRetInput) { commitAppSettingControl(calRetInput); }
                    return;
                }

                // ── Calendar Controls (Source / Metric / Period / View / Export) ──
                var calSourceBtn = target.closest('[data-action="calendarFilterSource"]');
                if (calSourceBtn) {
                    var srcVal = calSourceBtn.getAttribute('data-cal-source') || 'all';
                    vscode.postMessage({ command: 'calendarFilterSource', source: srcVal });
                    return;
                }
                var calMetricBtn = target.closest('[data-action="calendarSetMetric"]');
                if (calMetricBtn) {
                    var metVal = calMetricBtn.getAttribute('data-cal-metric') || 'tokens';
                    vscode.postMessage({ command: 'calendarSetMetric', metric: metVal });
                    return;
                }
                var calPeriodBtn = target.closest('[data-action="calendarSetPeriod"]');
                if (calPeriodBtn) {
                    var perVal = calPeriodBtn.getAttribute('data-cal-period') || 'daily';
                    vscode.postMessage({ command: 'calendarSetPeriod', period: perVal });
                    return;
                }
                var calViewBtn = target.closest('[data-action="calendarSetView"]');
                if (calViewBtn) {
                    var viewVal = calViewBtn.getAttribute('data-cal-view') || 'heatmap';
                    vscode.postMessage({ command: 'calendarSetView', view: viewVal });
                    return;
                }
                var calExportBtn = target.closest('[data-action="calendarExportCsv"], [data-action="calendarExportJson"]');
                if (calExportBtn) {
                    var exportCmd = calExportBtn.getAttribute('data-action');
                    if (bridge && bridge.surface !== 'vscode' && typeof bridge.sendAction === 'function') {
                        bridge.sendAction({ command: exportCmd }).then(function(res) {
                            var payload = (res && res.result) ? res.result : res;
                            if (payload && typeof payload.content === 'string') {
                                triggerClientDownload(payload.filename, payload.content, payload.mimeType);
                            }
                        });
                    } else {
                        vscode.postMessage({ command: exportCmd });
                    }
                    return;
                }

                // ── Calendar Two-Step Safe Clear History ──
                var calClearArmBtn = target.closest('[data-action="calendarClearArm"]');
                if (calClearArmBtn) {
                    var confirmBar = document.getElementById('calClearConfirmBar');
                    if (confirmBar) {
                        var nextOpen = confirmBar.hidden;
                        confirmBar.hidden = !nextOpen;
                        calClearArmBtn.setAttribute('aria-expanded', String(nextOpen));
                    }
                    return;
                }
                if (target.closest('[data-action="calendarClearConfirm"]')) {
                    var confirmBar2 = document.getElementById('calClearConfirmBar');
                    var armBtn2 = document.getElementById('clearCalendarBtn');
                    if (confirmBar2) { confirmBar2.hidden = true; }
                    if (armBtn2) { armBtn2.setAttribute('aria-expanded', 'false'); }
                    vscode.postMessage({ command: 'clearCalendarHistory' });
                    return;
                }
                if (target.closest('[data-action="calendarClearCancel"]')) {
                    var confirmBar3 = document.getElementById('calClearConfirmBar');
                    var armBtn3 = document.getElementById('clearCalendarBtn');
                    if (confirmBar3) { confirmBar3.hidden = true; }
                    if (armBtn3) {
                        armBtn3.setAttribute('aria-expanded', 'false');
                        armBtn3.focus();
                    }
                    return;
                }

                // ── Calendar Jump Date (Peak day / Period bar jump) ──
                var calJumpBtn = target.closest('[data-action="calendarJumpDate"]');
                if (calJumpBtn) {
                    var jumpDate = calJumpBtn.getAttribute('data-cal-date') || '';
                    if (jumpDate) {
                        var js = vscode.getState() || {};
                        js.calendarSelectedDate = jumpDate;
                        vscode.setState(js);
                        var parts = jumpDate.split('-');
                        var jYr = parts.length >= 2 ? parseInt(parts[0], 10) : 0;
                        var jMo = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
                        var jumpPanel = document.querySelector('[data-cal-detail="' + jumpDate + '"]');
                        if (jumpPanel) {
                            var allJumpPanels = document.querySelectorAll('[data-cal-detail]');
                            for (var jpi = 0; jpi < allJumpPanels.length; jpi++) {
                                var isTarget = allJumpPanels[jpi] === jumpPanel;
                                allJumpPanels[jpi].classList.toggle('cal-detail-open', isTarget);
                                allJumpPanels[jpi].style.display = isTarget ? 'block' : 'none';
                            }
                            jumpPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                        vscode.postMessage({ command: 'calendarJumpDate', date: jumpDate, year: jYr || undefined, month: jMo || undefined });
                    }
                    return;
                }

                // ── Date Cell / Heatmap Cell Click: expand/collapse detail panel ──
                var cell = target.closest('[data-action="calendarSelectDate"], .cal-cell.has-data');
                if (cell) {
                    var date = cell.getAttribute('data-cal-date');
                    if (!date) return;
                    var newSelected = '';
                    var matchedLocalPanel = false;
                    var allPanels = document.querySelectorAll('[data-cal-detail]');
                    for (var pi = 0; pi < allPanels.length; pi++) {
                        var p = allPanels[pi];
                        if (p.getAttribute('data-cal-detail') === date) {
                            matchedLocalPanel = true;
                            var isHidden = !p.classList.contains('cal-detail-open');
                            p.classList.toggle('cal-detail-open', isHidden);
                            p.style.display = isHidden ? 'block' : 'none';
                            cell.classList.toggle('selected', isHidden);
                            if (isHidden) { newSelected = date; }
                        } else {
                            p.classList.remove('cal-detail-open');
                            p.style.display = 'none';
                        }
                    }
                    if (!matchedLocalPanel) {
                        newSelected = date;
                    }
                    // Deselect other cells
                    var allCells = document.querySelectorAll('.cal-cell.has-data, .cal-hm-cell.has-data');
                    for (var oi = 0; oi < allCells.length; oi++) {
                        if (allCells[oi] !== cell) {
                            allCells[oi].classList.remove('selected');
                        }
                    }
                    // Persist selected date across refreshes
                    var cs = vscode.getState() || {};
                    cs.calendarSelectedDate = newSelected;
                    vscode.setState(cs);
                    vscode.postMessage({ command: 'calendarSelectDate', date: newSelected || null });
                    return;
                }

                // ── Remove Cached Account ──
                var acctDelBtn = target.closest('.acct-delete-btn');
                if (acctDelBtn) {
                    var email = acctDelBtn.getAttribute('data-email');
                    if (email) {
                        vscode.postMessage({ command: 'removeAccount', email: email });
                    }
                    return;
                }

                // ── Model Stats Error Toggle ──
                if (target.closest('#modelStatsErrToggle')) {
                    var errBtn = target.closest('#modelStatsErrToggle');
                    var st = vscode.getState() || {};
                    var wasOn = !!st.modelStatsShowErrors;
                    st.modelStatsShowErrors = !wasOn;
                    vscode.setState(st);
                    errBtn.classList.toggle('is-off', wasOn);
                    // Toggle CSS class on the cards grid ancestor
                    var cardsGrid = document.querySelector('.act-cards-grid');
                    if (cardsGrid) {
                        cardsGrid.classList.toggle('model-stats-show-errors', !wasOn);
                    }
                    return;
                }

                // ── Chat History actions ──
                var historyBtn = target.closest('[data-history-action]');
                if (historyBtn) {
                    if (historyBtn.disabled) { return; }
                    vscode.postMessage({
                        command: 'historyAction',
                        action: historyBtn.getAttribute('data-history-action'),
                        cascadeId: historyBtn.getAttribute('data-cascade-id') || '',
                        uri: historyBtn.getAttribute('data-history-uri') || ''
                    });
                    return;
                }

                // ── Calendar Summary Toggle (Monthly / All-Time) ──
                var summaryBtn = target.closest('.cal-summary-btn');
                if (summaryBtn) {
                    var mode = summaryBtn.getAttribute('data-summary-mode');
                    var monthlyPane = document.getElementById('calSummaryMonthly');
                    var alltimePane = document.getElementById('calSummaryAllTime');
                    var toggleWrap = summaryBtn.closest('.cal-summary-toggle');
                    if (toggleWrap) {
                        var btns = toggleWrap.querySelectorAll('.cal-summary-btn');
                        for (var sb = 0; sb < btns.length; sb++) { btns[sb].classList.remove('active'); }
                        summaryBtn.classList.add('active');
                    }
                    if (monthlyPane && alltimePane) {
                        if (mode === 'alltime') {
                            monthlyPane.style.display = 'none';
                            alltimePane.style.display = 'block';
                        } else {
                            monthlyPane.style.display = 'block';
                            alltimePane.style.display = 'none';
                        }
                    }
                    return;
                }

                // ── Month Navigation & Chart Jump Triggers ──
                var navBtn = target.closest('[data-cal-nav], .cal-nav-btn');
                if (navBtn) {
                    var yr = navBtn.getAttribute('data-cal-year');
                    var mo = navBtn.getAttribute('data-cal-month');
                    if (yr && mo) {
                        vscode.postMessage({ command: 'switchCalendarMonth', year: parseInt(yr,10), month: parseInt(mo,10) });
                    }
                    return;
                }
            });

            // ─── Unified Incremental DOM Patcher (VS Code messages + acm:snapshot) ───
            var lastMastheadHtml = (function() {
                var mh = document.getElementById('mastheadContextBar');
                return mh ? mh.innerHTML : '';
            })();
            var lastNativeHudHtml = (function() {
                var nh = document.getElementById('nativeHudHost');
                return nh ? nh.innerHTML : '';
            })();
            var lastAccountPopoverHtml = (function() {
                var pb = document.getElementById('acctPopoverBody');
                return pb ? pb.innerHTML : '';
            })();
            var emptyAccountPopoverHtml = ${JSON.stringify(`<p class="empty-msg">${tBi('No account data yet.', '暂无账号数据。')}</p>`)};
            var lastHandledSnapshotRef = null;

            function applyIncrementalUpdate(msg) {
                if (!msg || !msg.tabs) { return; }
                var tabs = msg.tabs;
                var visibleEocTabs = captureVisibleEocTabs();
                var changedTabKeys = [];

                // Save scrollTop of inner scrollable elements before DOM swap
                var scrollableSelectors = ['.raw-json', '.act-timeline', '.details-body', '.cp-viewer', '.cp-card-body'];
                var savedScrolls = {};
                for (var ss = 0; ss < scrollableSelectors.length; ss++) {
                    var sel = scrollableSelectors[ss];
                    var els = document.querySelectorAll(sel);
                    for (var se = 0; se < els.length; se++) {
                        if (els[se].scrollTop > 0) {
                            savedScrolls[sel + ':' + se] = els[se].scrollTop;
                        }
                    }
                }

                for (var key in tabs) {
                    if (!Object.prototype.hasOwnProperty.call(tabs, key)) continue;
                    if (lastTabHtmls[key] === tabs[key]) { continue; }
                    var pane = document.getElementById('tab-' + key);
                    if (pane) {
                        var pricingDrafts = new Map();
                        if (key === 'pricing') {
                            pane.querySelectorAll('.pricing-input').forEach(function(input) {
                                if (input.value !== (input.getAttribute('data-original-value') || '')) {
                                    var identity = JSON.stringify([input.getAttribute('data-model'), input.getAttribute('data-field')]);
                                    pricingDrafts.set(identity, { value: input.value, focused: input === document.activeElement });
                                }
                            });
                        }
                        var overviewFocus = key === 'overview' && pane.contains(document.activeElement)
                            ? document.activeElement.dataset.overviewFocus : undefined;
                        var diagnostics = key === 'overview' ? pane.querySelector('#overview-session-diagnostics') : null;
                        if (diagnostics) {
                            var overviewState = vscode.getState() || {};
                            var openDetails = overviewState.detailsOpen || {};
                            openDetails[diagnostics.dataset.stateKey] = diagnostics.open;
                            overviewState.detailsOpen = openDetails;
                            vscode.setState(overviewState);
                        }
                        var billingInput = key === 'profile' ? pane.querySelector('#profileBillingDayInput') : null;
                        var billingDraft = billingInput && billingInput.value !== billingInput.defaultValue ? billingInput.value : null;
                        var billingFocused = billingInput && billingInput === document.activeElement;
                        var billingAccount = billingInput && billingInput.dataset.email;
                        var privacyFocused = key === 'profile' && document.activeElement && document.activeElement.id === 'privacyToggle';
                        pane.innerHTML = tabs[key];
                        if (billingInput) {
                            var nextBilling = pane.querySelector('#profileBillingDayInput');
                            if (nextBilling && nextBilling.dataset.email === billingAccount) {
                                if (billingDraft !== null) { nextBilling.value = billingDraft; }
                                if (billingFocused) { nextBilling.focus({ preventScroll: true }); }
                            }
                        }
                        if (privacyFocused) {
                            var privBtn = pane.querySelector('#privacyToggle');
                            if (privBtn) { privBtn.focus({ preventScroll: true }); }
                        }
                        if (overviewFocus) {
                            var focusTarget = Array.from(pane.querySelectorAll('[data-overview-focus]')).find(function(el) {
                                return el.dataset.overviewFocus === overviewFocus;
                            });
                            if (focusTarget) { focusTarget.focus({ preventScroll: true }); }
                            else {
                                var overviewHeading = pane.querySelector('#overview-heading');
                                if (overviewHeading) { overviewHeading.focus({ preventScroll: true }); }
                            }
                        }
                        if (pricingDrafts.size) {
                            pane.querySelectorAll('.pricing-input').forEach(function(input) {
                                var identity = JSON.stringify([input.getAttribute('data-model'), input.getAttribute('data-field')]);
                                var draft = pricingDrafts.get(identity);
                                if (draft) {
                                    input.value = draft.value;
                                    if (draft.focused) { input.focus({ preventScroll: true }); }
                                }
                            });
                        }
                        lastTabHtmls[key] = tabs[key];
                        changedTabKeys.push(key);
                    }
                }

                // Patch masthead context controls (Conversation Switcher, Lock, Stale Badge)
                // without disrupting an open <select> dropdown.
                var nextMasthead = typeof tabs.mastheadControls === 'string'
                    ? tabs.mastheadControls
                    : (typeof msg.mastheadControls === 'string' ? msg.mastheadControls : null);
                if (nextMasthead !== null && nextMasthead !== lastMastheadHtml) {
                    var mhEl = document.getElementById('mastheadContextBar');
                    var swEl = document.getElementById('conversationSwitcher');
                    if (mhEl) {
                        if (!swEl || document.activeElement !== swEl) {
                            mhEl.innerHTML = nextMasthead;
                            lastMastheadHtml = nextMasthead;
                        } else {
                            // Keep <select> undisturbed while focused, but still refresh badges & lock button
                            var tmpMh = document.createElement('div');
                            tmpMh.innerHTML = nextMasthead;
                            var nextBadges = tmpMh.querySelector('.masthead-context-badges');
                            var curBadges = mhEl.querySelector('.masthead-context-badges');
                            if (nextBadges && curBadges && curBadges.innerHTML !== nextBadges.innerHTML) {
                                curBadges.innerHTML = nextBadges.innerHTML;
                            }
                            var nextLock = tmpMh.querySelector('#lockMainBtn');
                            var curLock = mhEl.querySelector('#lockMainBtn');
                            if (nextLock && curLock) {
                                curLock.className = nextLock.className;
                                curLock.setAttribute('aria-pressed', nextLock.getAttribute('aria-pressed') || 'false');
                                if (curLock.innerHTML !== nextLock.innerHTML) {
                                    curLock.innerHTML = nextLock.innerHTML;
                                }
                            }
                        }
                    }
                }

                // Patch Native Ambient HUD without losing expanded state
                var nextNativeHud = typeof tabs.nativeHud === 'string'
                    ? tabs.nativeHud
                    : (typeof msg.nativeHud === 'string' ? msg.nativeHud : null);
                if (nextNativeHud !== null && nextNativeHud !== lastNativeHudHtml) {
                    var hudHostEl = document.getElementById('nativeHudHost');
                    if (hudHostEl) {
                        hudHostEl.innerHTML = nextNativeHud;
                        hudHostEl.hidden = !nextNativeHud.trim();
                        lastNativeHudHtml = nextNativeHud;
                        applyNativeHudExpanded(getNativeHudExpanded());
                    }
                }

                for (var cti = 0; cti < changedTabKeys.length; cti++) {
                    if (visibleEocTabs[changedTabKeys[cti]]) {
                        restoreVisibleEoc(changedTabKeys[cti]);
                    }
                }

                // !! CRITICAL: restore details & context viz mode IMMEDIATELY after innerHTML swap,
                // BEFORE any DOM read that could force layout with collapsed details.
                restoreDetailsState(vscode.getState() || {});
                applyContextVizMode(getContextVizMode());
                bindToolCatalogTooltips();

                // NOW restore scrollTop (details are open, heights are correct)
                for (var rs = 0; rs < scrollableSelectors.length; rs++) {
                    var rsel = scrollableSelectors[rs];
                    var rels = document.querySelectorAll(rsel);
                    for (var re = 0; re < rels.length; re++) {
                        var rkey = rsel + ':' + re;
                        if (savedScrolls[rkey]) {
                            rels[re].scrollTop = savedScrolls[rkey];
                        }
                    }
                }

                // Update timestamp
                if (msg.time) {
                    var timeEl = document.querySelector('.update-time');
                    if (timeEl) {
                        var pausedEl = timeEl.querySelector('.paused-indicator');
                        timeEl.textContent = '';
                        if (pausedEl) { timeEl.appendChild(pausedEl); }
                        timeEl.appendChild(document.createTextNode(' ' + msg.time));
                    }
                }

                // Restore calendar selection
                var calSel = (vscode.getState() || {}).calendarSelectedDate || '';
                if (calSel) {
                    var calPanel = document.querySelector('[data-cal-detail="' + calSel + '"]');
                    var calCell = document.querySelector('.cal-cell.has-data[data-cal-date="' + calSel + '"]');
                    if (calPanel) {
                        calPanel.style.display = 'block';
                        calPanel.style.animation = 'none';
                        calPanel.classList.add('cal-detail-open');
                    }
                    if (calCell) { calCell.classList.add('selected'); }
                }

                applyPrivacyMask();

                // ── Account Popover: content-only refresh, preserve open/close state ──
                if (typeof tabs.accountPopover === 'string') {
                    var popBody = document.getElementById('acctPopoverBody');
                    var nextPopHtml = tabs.accountPopover || emptyAccountPopoverHtml;
                    if (popBody && nextPopHtml !== lastAccountPopoverHtml) {
                        popBody.innerHTML = nextPopHtml;
                        lastAccountPopoverHtml = nextPopHtml;
                    }
                }
                var dotEl = document.querySelector('.acct-popover-dot');
                if (tabs.accountPopoverHasReady) {
                    if (!dotEl) {
                        var trigEl = document.getElementById('acctPopoverTrigger');
                        if (trigEl) {
                            var d = document.createElement('span');
                            d.className = 'acct-popover-dot';
                            trigEl.appendChild(d);
                        }
                    }
                } else {
                    if (dotEl) { dotEl.remove(); }
                }

                if (msg.snapshot && typeof msg.snapshot.lockToMainAgent === 'boolean') {
                    syncLockMainVisual(msg.snapshot.lockToMainAgent);
                }
                var liveCdpStatus = (msg.snapshot && msg.snapshot.data && msg.snapshot.data.cdpStatus)
                    || (msg.snapshot && msg.snapshot.cdpStatus)
                    || msg.cdpStatus
                    || null;
                if (liveCdpStatus && typeof liveCdpStatus === 'object') {
                    syncCdpStatusUi(liveCdpStatus);
                }
                var liveUpdateStatus = (msg.snapshot && msg.snapshot.data && msg.snapshot.data.updateStatus)
                    || (msg.snapshot && msg.snapshot.updateStatus)
                    || msg.updateStatus
                    || null;
                if (liveUpdateStatus && typeof liveUpdateStatus === 'object') {
                    syncUpdateStatusUi(liveUpdateStatus);
                }

                updateTabSlider();
                updateTabOverflowHint();
                updateTabArrows();
                if (refreshBtn) { refreshBtn.classList.remove('spinning'); }
                bindHistoryCatalog();
                bindEocObserver();
                requestAnimationFrame(function() { initErrorOverflow(); });

                var errToggle2 = document.getElementById('modelStatsErrToggle');
                var cardsGrid2 = document.querySelector('.act-cards-grid');
                if ((vscode.getState() || {}).modelStatsShowErrors) {
                    if (errToggle2) { errToggle2.classList.remove('is-off'); }
                    if (cardsGrid2) { cardsGrid2.classList.add('model-stats-show-errors'); }
                } else {
                    if (errToggle2) { errToggle2.classList.add('is-off'); }
                    if (cardsGrid2) { cardsGrid2.classList.remove('model-stats-show-errors'); }
                }
            }

            // ─── Listen for extension & host-bridge messages ───
            window.addEventListener('message', function(event) {
                var msg = event.data;
                if (msg && msg.command === 'switchToTab' && msg.tab) {
                    switchTab(msg.tab);
                    if (typeof msg.requestId === 'number') {
                        vscode.postMessage({ command: 'tabShown', requestId: msg.requestId });
                    }
                } else if (msg && (msg.command === 'pricingSaved' || msg.command === 'pricingReset')) {
                    var fb = document.getElementById('pricingFeedback');
                    if (fb) {
                        fb.textContent = msg.command === 'pricingSaved' ? savedText : resetText;
                        fb.style.opacity = '1';
                        setTimeout(function() { fb.style.opacity = '0'; }, 2000);
                    }
                } else if (msg && msg.command === 'updateTabs') {
                    if (msg.snapshot && msg.snapshot === lastHandledSnapshotRef) { return; }
                    if (msg.snapshot) { lastHandledSnapshotRef = msg.snapshot; }
                    applyIncrementalUpdate(msg);
                }
            });

            // ─── Listen for Antigravity App Sidecar custom snapshot events ───
            window.addEventListener('acm:snapshot', function(event) {
                var detail = event && event.detail;
                if (!detail || typeof detail !== 'object') { return; }
                var snap = detail.snapshot || detail;
                if (snap && snap === lastHandledSnapshotRef) { return; }
                if (snap && snap.tabs) {
                    lastHandledSnapshotRef = snap;
                    applyIncrementalUpdate({
                        tabs: snap.tabs,
                        time: snap.time || detail.time || '',
                        snapshot: snap
                    });
                }
            });
            // ─── End-of-Content IntersectionObserver ───
            var _eocObserver = null;
            function bindEocObserver() {
                if (typeof IntersectionObserver === 'undefined') { return; }
                if (_eocObserver) { _eocObserver.disconnect(); }
                _eocObserver = new IntersectionObserver(function(entries) {
                    for (var ei = 0; ei < entries.length; ei++) {
                        var isVisible = entries[ei].isIntersecting;
                        entries[ei].target.classList.toggle('eoc-visible', isVisible);
                        if (!isVisible) {
                            entries[ei].target.classList.remove('eoc-no-transition');
                        }
                        var tabName = getTabNameFromNode(entries[ei].target);
                        if (tabName) {
                            eocVisibleTabs[tabName] = isVisible;
                        }
                    }
                }, { rootMargin: '0px', threshold: 0.1 });
                var eocEls = document.querySelectorAll('.eoc-sentinel');
                for (var eoi = 0; eoi < eocEls.length; eoi++) {
                    _eocObserver.observe(eocEls[eoi]);
                }
            }
            bindEocObserver();
            vscode.postMessage({ command: 'panelReady' });
        })();
    `;
}

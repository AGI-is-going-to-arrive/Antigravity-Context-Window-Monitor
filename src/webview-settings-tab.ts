// ─── Settings Tab Content Builder ────────────────────────────────────────────
// Builds HTML for the "Settings" tab: threshold, polling, status bar toggles,
// per-model context limit overrides, notification, activity, and panel settings.

import * as vscode from 'vscode';
import { tBi } from './i18n';
import type { ModelConfig } from './models';
import { parseTooltipDensity } from './tooltip-budget';
import {
    DEFAULT_CNY_EXCHANGE_RATE,
    DEFAULT_DISPLAY_CURRENCY,
    formatCurrencyCost,
    MAX_CNY_EXCHANGE_RATE,
    MIN_CNY_EXCHANGE_RATE,
    parseDisplayCurrency,
    sanitizeCnyExchangeRate,
} from './currency';
import { ICON } from './webview-icons';
import { esc, formatFileSize, tBiHtml } from './webview-helpers';

export interface StorageDiagnostics {
    stateFilePath: string;
    stateFileExists: boolean;
    stateFileSizeBytes: number;
    stateFileOpenWarnBytes: number;
    calendarDayCount: number;
}

export interface PanelHintPreferences {
    showTabScrollHint: boolean;
    showScrollbar: boolean;
    showEndOfContent: boolean;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Build the Settings tab HTML from current VS Code configuration. */
export function buildSettingsContent(
    _configs: ModelConfig[],
    storage?: StorageDiagnostics,
    panelPrefs?: PanelHintPreferences,
): string {
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');

    const pollingInterval = cfg.get<number>('pollingInterval', 5);
    const showContext = cfg.get<boolean>('statusBar.showContext', true);
    const showQuota = cfg.get<boolean>('statusBar.showQuota', true);
    const showResetCountdown = cfg.get<boolean>('statusBar.showResetCountdown', true);
    const showAiCredits = cfg.get<boolean>('statusBar.showAiCredits', true);
    const showSpeed = cfg.get<boolean>('statusBar.showSpeed', false);
    const showCacheHit = cfg.get<boolean>('statusBar.showCacheHit', false);
    const showSessionCost = cfg.get<boolean>('statusBar.showSessionCost', false);
    const displayCurrency = parseDisplayCurrency(cfg.get('pricing.displayCurrency', DEFAULT_DISPLAY_CURRENCY));
    const cnyExchangeRate = sanitizeCnyExchangeRate(cfg.get('pricing.cnyExchangeRate', DEFAULT_CNY_EXCHANGE_RATE));
    const sessionCostPreview = formatCurrencyCost(0.27, { currency: displayCurrency, cnyRate: cnyExchangeRate }, { precision: 'standard' });
    const tooltipDensity = parseTooltipDensity(cfg.get('statusBar.tooltipDensity', 'auto'));
    const showModelInternalId = cfg.get<boolean>('showModelInternalId', false);
    const quotaNotifyThreshold = cfg.get<number>('quotaNotificationThreshold', 20);
    const tabScrollHintEnabled = panelPrefs?.showTabScrollHint ?? true;
    const showScrollbar = panelPrefs?.showScrollbar ?? false;
    const showEndOfContent = panelPrefs?.showEndOfContent ?? true;
    const stateFileSizeLabel = storage ? formatFileSize(storage.stateFileSizeBytes) : '0 B';

    const storageCard = storage ? `
        <section class="stg-card" data-accent="storage">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.database}</span>
                <h2>${tBiHtml('Persistent Storage', '持久化存储')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'This file is stored outside the extension state database, so it survives uninstall and reinstall unless you delete it manually.',
        '该文件存储在扩展状态数据库之外，因此只要你不手动删除，它会跨卸载或重装保留。',
    )}</p>
            <div class="storage-path-box">
                <code class="storage-path-text">${esc(storage.stateFilePath)}</code>
                <span class="storage-path-state ${storage.stateFileExists ? 'is-ready' : 'is-missing'}">
                    <span>${storage.stateFileExists ? tBiHtml('Ready', '已存在') : tBiHtml('Missing', '不存在')}</span>
                </span>
            </div>
            <div class="storage-actions">
                <button type="button" class="action-btn" id="copyStatePath">${ICON.copy} <span>${tBiHtml('Copy Path', '复制路径')}</span></button>
                <button type="button" class="action-btn" id="openStateFile">${ICON.file} <span>${tBiHtml('Open File', '打开文件')}</span></button>
                <button type="button" class="action-btn" id="revealStateFile">${ICON.folder} <span>${tBiHtml('Reveal', '定位文件')}</span></button>
                <span id="statePathFeedback" class="threshold-feedback" role="status"></span>
            </div>
            <div class="storage-stat-grid">
                <div class="storage-stat"><span class="storage-stat-val">${stateFileSizeLabel}</span><span class="storage-stat-label">${tBiHtml('File Size', '文件大小')}</span></div>
                <div class="storage-stat"><span class="storage-stat-val">${storage.calendarDayCount}</span><span class="storage-stat-label">${tBiHtml('Calendar Days', '日历天数')}</span></div>
            </div>
        </section>` : '';

    return `
        ${storageCard}

        <section class="stg-card" data-accent="quota">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.bolt}</span>
                <h2>${tBiHtml('Quota Notification', '配额通知')}</h2>
            </div>
            <div class="setting-row">
                <label for="quotaNotifyInput">${tBiHtml(
        'Low quota warning threshold (%)',
        '低配额警告阈值（%）',
    )}</label>
                <p class="raw-desc">${tBiHtml(
        'Show a warning notification when any model\'s remaining quota drops below this percentage. Set to 0 to disable.',
        '当任何模型剩余配额低于此百分比时弹出系统警告通知。设为 0 可禁用。',
    )}</p>
                <div class="threshold-input-row">
                    <div class="num-spinner">
                        <button type="button" class="num-spinner-btn decrement" aria-label="${esc(tBi('Decrease quota warning threshold', '降低配额警告阈值'))}">−</button>
                        <input type="number" id="quotaNotifyInput" class="threshold-input"
                               value="${quotaNotifyThreshold}" min="0" max="99" step="5" />
                        <button type="button" class="num-spinner-btn increment" aria-label="${esc(tBi('Increase quota warning threshold', '提高配额警告阈值'))}">+</button>
                    </div>
                    <button type="button" class="action-btn" id="quotaNotifySaveBtn"><span>${tBiHtml('Save', '保存')}</span></button>
                    <span id="quotaNotifyFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>
        </section>

        <section class="stg-card" data-accent="poll">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.clock}</span>
                <h2>${tBiHtml('Polling', '轮询')}</h2>
            </div>
            <div class="setting-row">
                <label for="pollingInput">${tBiHtml(
        'Polling interval (seconds)',
        '轮询间隔（秒）',
    )}</label>
                <div class="threshold-input-row">
                    <div class="num-spinner">
                        <button type="button" class="num-spinner-btn decrement" data-target="pollingInput" aria-label="${esc(tBi('Decrease polling interval', '减小轮询间隔'))}">−</button>
                        <input type="number" id="pollingInput" class="threshold-input"
                               value="${pollingInterval}" min="1" max="60" step="1" />
                        <button type="button" class="num-spinner-btn increment" data-target="pollingInput" aria-label="${esc(tBi('Increase polling interval', '增大轮询间隔'))}">+</button>
                    </div>
                    <button type="button" class="action-btn" id="pollingSaveBtn"><span>${tBiHtml('Save', '保存')}</span></button>
                    <span id="pollingFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>
        </section>

        <section class="stg-card" data-accent="display">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.chart}</span>
                <h2>${tBiHtml('Status Bar Display', '状态栏显示')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'Toggle which elements appear in the status bar.',
        '控制状态栏显示哪些元素。',
    )}</p>
            <div class="toggle-group">
                <label class="toggle-row">
                    <input type="checkbox" id="toggleContext" class="toggle-cb" ${showContext ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Context usage', '上下文用量')} <code>45k/1M</code></span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleQuota" class="toggle-cb" ${showQuota ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Quota remaining', '剩余配额')} <code>85%</code></span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleCountdown" class="toggle-cb" ${showResetCountdown ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Reset countdown', '重置倒计时')} <code>4h32m</code></span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleAiCredits" class="toggle-cb" ${showAiCredits ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('AI Credits balance', 'AI 积分余额')} <code>14,701</code></span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleSpeed" class="toggle-cb" ${showSpeed ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Generation speed', '生成速度')} <code>64 tok/s</code></span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleCacheHit" class="toggle-cb" ${showCacheHit ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Prompt cache hit rate', '提示词缓存命中率')} <code>Cache 84%</code></span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleSessionCost" class="toggle-cb" ${showSessionCost ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Session cost', '当前会话费用')} <code id="sessionCostPreview">${esc(sessionCostPreview)}</code></span>
                </label>
            </div>
            <label class="stg-select-row" for="statusTooltipDensity">
                <span>${tBiHtml('Hover density', '悬停摘要密度')}</span>
                <select id="statusTooltipDensity">
                    <option value="auto"${tooltipDensity === 'auto' ? ' selected' : ''}>${esc(tBi('Automatic', '自动'))}</option>
                    <option value="compact"${tooltipDensity === 'compact' ? ' selected' : ''}>${esc(tBi('Compact', '精简'))}</option>
                    <option value="full"${tooltipDensity === 'full' ? ' selected' : ''}>${esc(tBi('Full', '完整'))}</option>
                </select>
            </label>
        </section>

        <section class="stg-card" data-accent="currency">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.chart}</span>
                <h2>${tBiHtml('Currency Display', '币种与汇率')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'Display estimated costs in USD, CNY, or both using a local offline reference rate (no external network requests).',
        '使用本地离线参考汇率以美元、人民币或双币种显示估算费用（不发起外部网络请求）。',
    )}</p>
            <div class="setting-row">
                <label>${tBiHtml('Display Currency', '显示币种')}</label>
                <div class="currency-toggle-group" role="group" aria-label="${esc(tBi('Display Currency', '显示币种'))}">
                    <button type="button" class="currency-btn${displayCurrency === 'USD' ? ' active' : ''}" data-currency="USD" aria-pressed="${displayCurrency === 'USD'}">USD ($)</button>
                    <button type="button" class="currency-btn${displayCurrency === 'CNY' ? ' active' : ''}" data-currency="CNY" aria-pressed="${displayCurrency === 'CNY'}">CNY (¥)</button>
                    <button type="button" class="currency-btn${displayCurrency === 'both' ? ' active' : ''}" data-currency="both" aria-pressed="${displayCurrency === 'both'}">${tBiHtml('Both', '双币种')}</button>
                </div>
            </div>
            <div class="setting-row">
                <label for="cnyExchangeRateInput">${tBiHtml('USD to CNY reference rate', '美元兑人民币参考汇率')}</label>
                <div class="threshold-input-row">
                    <input type="number" id="cnyExchangeRateInput" class="threshold-input fx-rate-input"
                           value="${cnyExchangeRate}" data-original-value="${cnyExchangeRate}" min="${MIN_CNY_EXCHANGE_RATE}" max="${MAX_CNY_EXCHANGE_RATE}" step="0.05"
                           aria-label="${esc(tBi('USD to CNY exchange rate', '美元兑人民币汇率'))}" />
                    <button type="button" class="action-btn" id="cnyExchangeRateSaveBtn"><span>${tBiHtml('Save', '保存')}</span></button>
                    <span id="currencyFeedback" class="threshold-feedback" role="status"></span>
                </div>
            </div>
        </section>

        <section class="stg-card" data-accent="display">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.chart}</span>
                <h2>${tBiHtml('Advanced Display', '高级显示')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'Show extra diagnostic information useful for tracking platform-level model changes.',
        '显示用于追踪平台级模型变更的诊断信息。',
    )}</p>
            <div class="toggle-group">
                <label class="toggle-row">
                    <input type="checkbox" id="toggleModelInternalId" class="toggle-cb" ${showModelInternalId ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Show model internal ID', '显示模型内部 ID')} <code>(M16)</code></span>
                </label>
            </div>
        </section>

        <section class="stg-card" data-accent="zoom">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.zoom}</span>
                <h2>${tBiHtml('Interface Zoom', '界面缩放')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'Scale all content in the panel. Applies to text, icons, and spacing.',
        '缩放面板中的所有内容。对文字、图标和间距统一生效。',
    )}</p>
            <div class="zoom-control">
                <div class="zoom-presets">
                    <button type="button" class="preset-btn zoom-preset" data-zoom="80">80%</button>
                    <button type="button" class="preset-btn zoom-preset" data-zoom="90">90%</button>
                    <button type="button" class="preset-btn zoom-preset" data-zoom="100">100%</button>
                    <button type="button" class="preset-btn zoom-preset" data-zoom="110">110%</button>
                    <button type="button" class="preset-btn zoom-preset" data-zoom="120">120%</button>
                    <button type="button" class="preset-btn zoom-preset" data-zoom="130">130%</button>
                </div>
                <div class="zoom-slider-row">
                    <input type="range" id="zoomRange" class="zoom-range" aria-label="${esc(tBi('Interface zoom', '界面缩放'))}"
                           min="60" max="150" step="5" value="100" />
                    <span class="zoom-value" id="zoomValue">100%</span>
                </div>
            </div>
        </section>

        <section class="stg-card" data-accent="history">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.timeline}</span>
                <h2>${tBiHtml('Panel Tips', '界面提示')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'This state only means whether auto-display is enabled. It does not mean the hint is currently visible at the top. Use the button below to show it immediately once.',
        '这里的状态只表示“是否启用自动提示”，不代表顶部当前一定可见。要立刻看到这条提示，请用下面的按钮显示一次。',
    )}</p>
            <div class="storage-actions">
                <button type="button" class="action-btn" id="restoreTabScrollHint">${ICON.refresh} <span>${tBiHtml('Show Hint Now', '立即显示一次提示')}</span></button>
                <span class="storage-path-state ${tabScrollHintEnabled ? 'is-ready' : 'is-missing'}" id="tabHintState">
                    <span>${tabScrollHintEnabled ? tBiHtml('Auto Hint Enabled', '自动提示已开启') : tBiHtml('Auto Hint Disabled', '自动提示已关闭')}</span>
                </span>
                <span id="panelHintFeedback" class="threshold-feedback" role="status"></span>
            </div>
        </section>

        <section class="stg-card" data-accent="display">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.chart}</span>
                <h2>${tBiHtml('Scrollbar Appearance', '滚动条外观')}</h2>
            </div>
            <p class="raw-desc">${tBiHtml(
        'Control scrollbar visibility and end-of-content indicators across all tabs.',
        '控制所有选项卡的滚动条可见性和「已到底」提示。',
    )}</p>
            <div class="toggle-group">
                <label class="toggle-row">
                    <input type="checkbox" id="toggleScrollbar" class="toggle-cb" ${showScrollbar ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Show scrollbar', '显示滚动条')}</span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleEndOfContent" class="toggle-cb" ${showEndOfContent ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBiHtml('Show "end of content" indicator', '显示「已到底」提示')}</span>
                </label>
            </div>
        </section>
    `;
}

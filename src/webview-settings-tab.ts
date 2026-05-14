// ─── Settings Tab Content Builder ────────────────────────────────────────────
// Builds HTML for the "Settings" tab: threshold, polling, status bar toggles,
// per-model context limit overrides, notification, activity, and history settings.

import * as vscode from 'vscode';
import { tBi } from './i18n';
import { ModelConfig } from './models';
import { QuotaTracker } from './quota-tracker';
import { ICON } from './webview-icons';
import { esc, formatFileSize } from './webview-helpers';



export interface StorageDiagnostics {
    stateFilePath: string;
    stateFileExists: boolean;
    stateFileSizeBytes: number;
    stateFileOpenWarnBytes: number;
    calendarDayCount: number;
    hasDevResetSnapshot: boolean;
}

export interface PanelHintPreferences {
    showTabScrollHint: boolean;
    showScrollbar: boolean;
    showEndOfContent: boolean;
}



// ─── Public API ──────────────────────────────────────────────────────────────

/** Build the Settings tab HTML from current VS Code configuration. */
export function buildSettingsContent(
    configs: ModelConfig[],
    tracker?: QuotaTracker,
    storage?: StorageDiagnostics,
    panelPrefs?: PanelHintPreferences,
): string {
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
    const currentThreshold = cfg.get<number>('compressionWarningThreshold', 150_000);
    const pollingInterval = cfg.get<number>('pollingInterval', 5);
    const contextLimits = cfg.get<Record<string, number>>('contextLimits', {});
    const showContext = cfg.get<boolean>('statusBar.showContext', true);
    const showQuota = cfg.get<boolean>('statusBar.showQuota', true);
    const showResetCountdown = cfg.get<boolean>('statusBar.showResetCountdown', true);
    const showAiCredits = cfg.get<boolean>('statusBar.showAiCredits', true);
    const showModelInternalId = cfg.get<boolean>('showModelInternalId', false);
    const quotaNotifyThreshold = cfg.get<number>('quotaNotificationThreshold', 20);
    const tabScrollHintEnabled = panelPrefs?.showTabScrollHint ?? true;
    const showScrollbar = panelPrefs?.showScrollbar ?? false;
    const showEndOfContent = panelPrefs?.showEndOfContent ?? true;
    const stateFileSizeLabel = storage ? formatFileSize(storage.stateFileSizeBytes) : '0 B';

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

    const storageCard = storage ? `
        <section class="stg-card" data-accent="storage">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.database}</span>
                <h2>${tBi('Persistent Storage', '持久化存储')}</h2>
            </div>
            <p class="raw-desc">${tBi(
        'This file is stored outside the extension state database, so it survives uninstall/reinstall unless you delete it manually.',
        '该文件存储在扩展状态数据库之外，因此只要你不手动删除，它会跨卸载/重装保留。',
    )}</p>
            <div class="storage-path-box">
                <code class="storage-path-text">${esc(storage.stateFilePath)}</code>
                <span class="storage-path-state ${storage.stateFileExists ? 'is-ready' : 'is-missing'}">
                    ${storage.stateFileExists ? tBi('Ready', '已存在') : tBi('Missing', '不存在')}
                </span>
            </div>
            <div class="storage-actions">
                <button class="action-btn" id="copyStatePath">${ICON.copy} ${tBi('Copy Path', '复制路径')}</button>
                <button class="action-btn" id="openStateFile">${ICON.file} ${tBi('Open File', '打开文件')}</button>
                <button class="action-btn" id="revealStateFile">${ICON.folder} ${tBi('Reveal', '定位文件')}</button>
                <span id="statePathFeedback" class="threshold-feedback"></span>
            </div>
            <div class="storage-stat-grid">
                <div class="storage-stat"><span class="storage-stat-val">${stateFileSizeLabel}</span><span class="storage-stat-label">${tBi('File Size', '文件大小')}</span></div>
                <div class="storage-stat"><span class="storage-stat-val">${storage.calendarDayCount}</span><span class="storage-stat-label">${tBi('Calendar Days', '日历天数')}</span></div>
            </div>
        </section>` : '';

    return `
        ${storageCard}

        <section class="stg-card" data-accent="warn">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.shield}</span>
                <h2>${tBi('Compression Warning', '压缩警告')}</h2>
            </div>
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

        <section class="stg-card" data-accent="quota">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.bolt}</span>
                <h2>${tBi('Quota Notification', '额度通知')}</h2>
            </div>
            <div class="setting-row">
                <label for="quotaNotifyInput">${tBi(
        'Low quota warning threshold (%)',
        '低额度警告阈值（%）',
    )}</label>
                <p class="raw-desc">${tBi(
        'Show a warning notification when any model\'s remaining quota drops below this percentage. Set to 0 to disable.',
        '当任何模型剩余额度低于此百分比时弹出系统警告通知。设为 0 可禁用。',
    )}</p>
                <div class="threshold-input-row">
                    <div class="num-spinner">
                        <button type="button" class="num-spinner-btn decrement">−</button>
                        <input type="number" id="quotaNotifyInput" class="threshold-input"
                               value="${quotaNotifyThreshold}" min="0" max="99" step="5" />
                        <button type="button" class="num-spinner-btn increment">+</button>
                    </div>
                    <button class="action-btn" id="quotaNotifySaveBtn">${tBi('Save', '保存')}</button>
                    <span id="quotaNotifyFeedback" class="threshold-feedback"></span>
                </div>
            </div>
        </section>

        <section class="stg-card" data-accent="quota">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.timeline}</span>
                <h2>${tBi('Quota Timeline Tracking', '额度时间线追踪')}</h2>
            </div>
            <p class="raw-desc">${tBi(
        'Tracks quota consumption against the official resetTime. Lightweight and always-on by default. Disable only if you never use the Quota Tracking tab.',
        '基于官方 resetTime 追踪额度消耗。默认始终开启，性能开销极小。仅在完全不使用「额度追踪」标签页时才需关闭。',
    )}</p>
            <div class="toggle-group">
                <label class="toggle-row">
                    <input type="checkbox" id="toggleQuotaTracking" class="toggle-cb" ${tracker?.isEnabled() ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBi('Enable quota timeline tracking', '启用额度时间线追踪')}</span>
                </label>
            </div>
        </section>

        <section class="stg-card" data-accent="poll">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.clock}</span>
                <h2>${tBi('Polling', '轮询')}</h2>
            </div>
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

        <section class="stg-card" data-accent="display">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.chart}</span>
                <h2>${tBi('Status Bar Display', '状态栏显示')}</h2>
            </div>
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
                    <span>${tBi('Reset countdown', '重置倒计时')} <code>&#x23F3;4h32m</code></span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleAiCredits" class="toggle-cb" ${showAiCredits ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBi('AI Credits balance', 'AI 积分余额')} <code>⚡14,701</code></span>
                </label>
            </div>
        </section>

        <section class="stg-card" data-accent="display">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.chart}</span>
                <h2>${tBi('Advanced Display', '高级显示')}</h2>
            </div>
            <p class="raw-desc">${tBi(
        'Show extra diagnostic information useful for tracking platform-level model changes.',
        '显示用于追踪平台级模型变更的诊断信息。',
    )}</p>
            <div class="toggle-group">
                <label class="toggle-row">
                    <input type="checkbox" id="toggleModelInternalId" class="toggle-cb" ${showModelInternalId ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBi('Show model internal ID', '显示模型内部 ID')} <code>(M16)</code></span>
                </label>
            </div>
        </section>

        <section class="stg-card" data-accent="zoom">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.zoom}</span>
                <h2>${tBi('Interface Zoom', '界面缩放')}</h2>
            </div>
            <p class="raw-desc">${tBi(
        'Scale all content in the panel. Applies to text, icons, and spacing.',
        '缩放面板中的所有内容。对文字、图标和间距统一生效。',
    )}</p>
            <div class="zoom-control">
                <div class="zoom-presets">
                    <button class="preset-btn zoom-preset" data-zoom="80">80%</button>
                    <button class="preset-btn zoom-preset" data-zoom="90">90%</button>
                    <button class="preset-btn zoom-preset" data-zoom="100">100%</button>
                    <button class="preset-btn zoom-preset" data-zoom="110">110%</button>
                    <button class="preset-btn zoom-preset" data-zoom="120">120%</button>
                    <button class="preset-btn zoom-preset" data-zoom="130">130%</button>
                </div>
                <div class="zoom-slider-row">
                    <input type="range" id="zoomRange" class="zoom-range"
                           min="60" max="150" step="5" value="100" />
                    <span class="zoom-value" id="zoomValue">100%</span>
                </div>
            </div>
        </section>

        <section class="stg-card" data-accent="history">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.timeline}</span>
                <h2>${tBi('Panel Tips', '界面提示')}</h2>
            </div>
            <p class="raw-desc">${tBi(
        'This state only means whether auto-display is enabled. It does not mean the hint is currently visible at the top. Use the button below to show it immediately once.',
        '这里的状态只表示“是否启用自动提示”，不代表顶部当前一定可见。要立刻看到这条提示，请用下面的按钮显示一次。',
    )}</p>
            <div class="storage-actions">
                <button class="action-btn" id="restoreTabScrollHint">${ICON.refresh} ${tBi('Show Hint Now', '立即显示一次提示')}</button>
                <span class="storage-path-state ${tabScrollHintEnabled ? 'is-ready' : 'is-missing'}" id="tabHintState">
                    ${tabScrollHintEnabled ? tBi('Auto Hint Enabled', '自动提示已开启') : tBi('Auto Hint Disabled', '自动提示已关闭')}
                </span>
                <span id="panelHintFeedback" class="threshold-feedback"></span>
            </div>
        </section>

        <section class="stg-card" data-accent="display">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.chart}</span>
                <h2>${tBi('Scrollbar Appearance', '滚动条外观')}</h2>
            </div>
            <p class="raw-desc">${tBi(
        'Control scrollbar visibility and end-of-content indicators across all tabs.',
        '控制所有选项卡的滚动条可见性和「已到底」提示。',
    )}</p>
            <div class="toggle-group">
                <label class="toggle-row">
                    <input type="checkbox" id="toggleScrollbar" class="toggle-cb" ${showScrollbar ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBi('Show scrollbar', '显示滚动条')}</span>
                </label>
                <label class="toggle-row">
                    <input type="checkbox" id="toggleEndOfContent" class="toggle-cb" ${showEndOfContent ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBi('Show "end of content" indicator', '显示「已到底」提示')}</span>
                </label>
            </div>
        </section>

        ${modelLimitRows ? `
        <section class="stg-card" data-accent="model">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.shield}</span>
                <h2>${tBi('Model Context Limits', '模型上下文限制')}</h2>
            </div>
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

        <section class="stg-card" data-accent="debug">
            <div class="stg-header">
                <span class="stg-header-icon">${ICON.bolt}</span>
                <h2>${tBi('Debug / Testing', '调试 / 测试')}</h2>
            </div>
            <p class="raw-desc">${tBi(
        'Developer tools for testing daily archival and clearing stale data.',
        '用于测试每日归档以及清除过期数据的开发者工具。',
    )}</p>
            <div class="setting-row" style="margin-top: var(--space-2);">
                <p class="raw-desc">${tBi(
        'Simulate a full daily archival: archive current Activity + GM + Cost data to Calendar, then reset for the new day. A restorable snapshot is captured first so you can roll back after verifying the UI.',
        '模拟完整的每日归档：先抓取一份可恢复快照，再将当前 Activity + GM + 费用数据归档到日历，并为新的一天重置。验证完 UI 后可一键恢复。',
    )}</p>
                <div class="storage-actions">
                    <button class="action-btn" id="devSimulateReset">
                        ${ICON.timeline} ${tBi('Simulate Daily Archival', '模拟每日归档')}
                    </button>
                    <button class="action-btn${storage?.hasDevResetSnapshot ? '' : ' danger-action'}" id="devRestoreReset"${storage?.hasDevResetSnapshot ? '' : ' disabled'}>
                        ${ICON.refresh} ${tBi('Restore Snapshot', '恢复快照')}
                    </button>
                    <span id="devSimulateFeedback" class="threshold-feedback"></span>
                </div>
                <p class="raw-desc" style="margin-top: var(--space-2);">
                    ${storage?.hasDevResetSnapshot
            ? tBi(
                'A daily archival snapshot is currently available for this extension session. Restoring will roll Activity / GM / Calendar back to the pre-test state.',
                '当前这次扩展运行里已有一份可恢复的归档测试快照。恢复后会把 Activity / GM / Calendar 一并回滚到测试前状态。',
            )
            : tBi(
                'No archival test snapshot is stored right now. Trigger one simulation first if you want an undo point in this extension session.',
                '当前这次扩展运行里没有可恢复的归档测试快照。若要回滚，请先触发一次模拟每日归档。',
            )}
                </p>
            </div>
        </section>
    `;
}

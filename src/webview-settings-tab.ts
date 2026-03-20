// ─── Settings Tab Content Builder ────────────────────────────────────────────
// Builds HTML for the "Settings" tab: threshold, polling, status bar toggles,
// per-model context limit overrides, notification, activity, and history settings.

import * as vscode from 'vscode';
import { tBi } from './i18n';
import { ModelConfig } from './models';
import { QuotaTracker } from './quota-tracker';
import { ICON } from './webview-icons';
import { esc } from './webview-helpers';

// ─── Public API ──────────────────────────────────────────────────────────────

/** Build the Settings tab HTML from current VS Code configuration. */
export function buildSettingsContent(configs: ModelConfig[], tracker?: QuotaTracker): string {
    const cfg = vscode.workspace.getConfiguration('antigravityContextMonitor');
    const currentThreshold = cfg.get<number>('compressionWarningThreshold', 200_000);
    const pollingInterval = cfg.get<number>('pollingInterval', 5);
    const contextLimits = cfg.get<Record<string, number>>('contextLimits', {});
    const showContext = cfg.get<boolean>('statusBar.showContext', true);
    const showQuota = cfg.get<boolean>('statusBar.showQuota', true);
    const showResetCountdown = cfg.get<boolean>('statusBar.showResetCountdown', true);
    const showActivity = cfg.get<boolean>('statusBar.showActivity', true);
    const activityDisplayMode = cfg.get<string>('statusBar.activityDisplayMode', 'global');
    const quotaNotifyThreshold = cfg.get<number>('quotaNotificationThreshold', 20);
    const maxRecentSteps = cfg.get<number>('activity.maxRecentSteps', 100);
    const maxArchives = cfg.get<number>('activity.maxArchives', 20);
    const privacyDefault = cfg.get<boolean>('privacy.defaultMask', false);

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

    const maxHistory = tracker?.getMaxHistory() ?? 20;

    return `
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
            <h2>${ICON.bolt} ${tBi('Quota Notification', '额度通知')}</h2>
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
                <label class="toggle-row">
                    <input type="checkbox" id="toggleActivity" class="toggle-cb" ${showActivity ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBi('Activity indicator', '活动指标')} <code>🧠5 ⚡12</code></span>
                </label>
            </div>
            <div class="setting-row" style="margin-top: var(--space-2);">
                <label>${tBi('Activity display mode', '活动显示模式')}</label>
                <div class="radio-group">
                    <label class="radio-row">
                        <input type="radio" name="activityDisplayMode" value="global" ${activityDisplayMode === 'global' ? 'checked' : ''} />
                        <span>${tBi('Global — all models combined', '全局 — 所有模型汇总')}</span>
                    </label>
                    <label class="radio-row">
                        <input type="radio" name="activityDisplayMode" value="currentModel" ${activityDisplayMode === 'currentModel' ? 'checked' : ''} />
                        <span>${tBi('Current model — active conversation only', '当前模型 — 仅活跃对话')}</span>
                    </label>
                </div>
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

        <section class="card">
            <h2>${ICON.chart} ${tBi('Activity Settings', '活动设置')}</h2>
            <div class="setting-row">
                <label for="maxRecentStepsInput">${tBi(
                    'Max timeline entries',
                    '时间线最大条数',
                )}</label>
                <p class="raw-desc">${tBi(
                    'Maximum number of recent operations displayed in the Activity timeline. Range: 10–500.',
                    '活动时间线中显示的最近操作最大条数。范围：10–500。',
                )}</p>
                <div class="threshold-input-row">
                    <div class="num-spinner">
                        <button type="button" class="num-spinner-btn decrement">−</button>
                        <input type="number" id="maxRecentStepsInput" class="threshold-input"
                               value="${maxRecentSteps}" min="10" max="500" step="10" />
                        <button type="button" class="num-spinner-btn increment">+</button>
                    </div>
                    <button class="action-btn" id="maxRecentStepsSaveBtn">${tBi('Save', '保存')}</button>
                    <span id="maxRecentStepsFeedback" class="threshold-feedback"></span>
                </div>
            </div>
            <div class="setting-row" style="margin-top: var(--space-3);">
                <label for="maxArchivesInput">${tBi(
                    'Max activity archives',
                    '活动归档最大份数',
                )}</label>
                <p class="raw-desc">${tBi(
                    'Maximum number of activity snapshots archived when quota resets. Range: 1–100.',
                    '额度重置时保留的活动快照最大份数。范围：1–100。',
                )}</p>
                <div class="threshold-input-row">
                    <div class="num-spinner">
                        <button type="button" class="num-spinner-btn decrement">−</button>
                        <input type="number" id="maxArchivesInput" class="threshold-input"
                               value="${maxArchives}" min="1" max="100" step="1" />
                        <button type="button" class="num-spinner-btn increment">+</button>
                    </div>
                    <button class="action-btn" id="maxArchivesSaveBtn">${tBi('Save', '保存')}</button>
                    <span id="maxArchivesFeedback" class="threshold-feedback"></span>
                </div>
            </div>
            <div class="setting-row" style="margin-top: var(--space-3);">
                <p class="raw-desc">${tBi(
                    'Clear all model statistics, operation timeline, and archive records. Current session monitoring data is not affected — activity will restart counting from zero.',
                    '清除所有模型统计、操作时间线和归档记录。当前会话的监控数据不受影响，活动将重新从零开始计数。',
                )}</p>
                <button class="action-btn danger-action" id="clearActivityData">
                    ${ICON.trash} ${tBi('Clear Activity Data', '清除活动数据')}
                </button>
            </div>
        </section>

        <section class="card">
            <h2>${ICON.shield} ${tBi('Privacy', '隐私')}</h2>
            <div class="toggle-group">
                <label class="toggle-row">
                    <input type="checkbox" id="togglePrivacyDefault" class="toggle-cb" ${privacyDefault ? 'checked' : ''} />
                    <span class="toggle-track"><span class="toggle-thumb"></span></span>
                    <span>${tBi('Enable privacy mask by default', '默认启用隐私遮罩')}</span>
                </label>
            </div>
            <p class="raw-desc">${tBi(
                'When enabled, sensitive data (account ID, email, etc.) will be masked by default when opening the monitor panel.',
                '启用后，打开监控面板时会默认遮住敏感数据（账户 ID、邮箱等）。',
            )}</p>
        </section>

        <section class="card">
            <h2>${ICON.timeline} ${tBi('History Settings', '历史设置')}</h2>
            <div class="setting-row">
                <label for="maxHistoryInput">${tBi(
                    'Max archived records',
                    '最多保留记录数',
                )}</label>
                <div class="threshold-input-row">
                    <div class="num-spinner">
                        <button type="button" class="num-spinner-btn decrement">−</button>
                        <input type="number" id="maxHistoryInput" class="threshold-input"
                               value="${maxHistory}" min="1" max="100" step="1" />
                        <button type="button" class="num-spinner-btn increment">+</button>
                    </div>
                    <button class="action-btn" id="maxHistorySaveBtn">${tBi('Save', '保存')}</button>
                    <span id="maxHistoryFeedback" class="threshold-feedback"></span>
                </div>
            </div>
            <div class="setting-row" style="margin-top: var(--space-3);">
                <p class="raw-desc">${tBi(
                    'Clear all quota consumption tracking archives (100%→0% change snapshots). Does not affect current monitoring data or activity statistics.',
                    '清除额度消耗追踪的归档记录（从 100%→0% 的变化快照），不影响当前监控数据和活动统计。',
                )}</p>
                <button class="action-btn danger-action" id="clearQuotaHistory">
                    ${ICON.trash} ${tBi('Clear All History', '清除所有历史')}
                </button>
            </div>
        </section>
    `;
}

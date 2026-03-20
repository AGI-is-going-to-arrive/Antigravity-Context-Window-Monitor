// ─── WebView Client-Side Script ──────────────────────────────────────────────
// Frontend JavaScript injected into the WebView panel.
// Handles tab switching, settings controls, privacy mask, scroll persistence,
// and message passing with the extension host.

/** Returns the complete <script> block content (without <script> tags). */
export function getScript(): string {
    return `
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
            // data-switch-tab links (e.g. Monitor → Profile "Details →")
            var switchLinks = document.querySelectorAll('[data-switch-tab]');
            for (var si = 0; si < switchLinks.length; si++) {
                switchLinks[si].addEventListener('click', function() {
                    switchTab(this.dataset.switchTab);
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
            var toggleIds = ['toggleContext', 'toggleQuota', 'toggleCountdown', 'toggleActivity', 'togglePrivacyDefault'];
            var toggleKeys = ['statusBar.showContext', 'statusBar.showQuota', 'statusBar.showResetCountdown', 'statusBar.showActivity', 'privacy.defaultMask'];
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

            // ─── Settings: Activity Display Mode Radio ───
            var modeRadios = document.querySelectorAll('input[name="activityDisplayMode"]');
            for (var ri = 0; ri < modeRadios.length; ri++) {
                modeRadios[ri].addEventListener('change', function() {
                    if (this.checked) {
                        vscode.postMessage({ command: 'setConfig', key: 'statusBar.activityDisplayMode', value: this.value });
                    }
                });
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

            // ─── Quota Tracking Toggle ───
            var trackingToggle = document.getElementById('quotaTrackingToggle');
            if (trackingToggle) {
                var cb = trackingToggle.querySelector('input[type="checkbox"]');
                if (cb) {
                    cb.addEventListener('change', function() {
                        vscode.postMessage({ command: 'toggleQuotaTracking' });
                    });
                }
            }

            // ─── Copy Raw JSON ───
            var copyBtn = document.getElementById('copyRawJson');
            if (copyBtn) {
                copyBtn.addEventListener('click', function() {
                    var rawEl = document.getElementById('rawJsonContent');
                    if (!rawEl) return;
                    var text = rawEl.textContent || '';
                    navigator.clipboard.writeText(text).then(function() {
                        copyBtn.classList.add('copied');
                        var origHtml = copyBtn.innerHTML;
                        copyBtn.textContent = '✓ Copied';
                        setTimeout(function() {
                            copyBtn.innerHTML = origHtml;
                            copyBtn.classList.remove('copied');
                        }, 2000);
                    });
                });
            }

            // ─── Clear Quota History ───
            var clearHistBtn = document.getElementById('clearQuotaHistory');
            if (clearHistBtn) {
                clearHistBtn.addEventListener('click', function() {
                    vscode.postMessage({ command: 'clearQuotaHistory' });
                });
            }

            // ─── Quota Max History ───
            var maxHistBtn = document.getElementById('maxHistorySaveBtn');
            var maxHistInput = document.getElementById('maxHistoryInput');
            if (maxHistBtn && maxHistInput) {
                maxHistBtn.addEventListener('click', function() {
                    var val = parseInt(maxHistInput.value, 10);
                    if (val >= 1) {
                        vscode.postMessage({ command: 'setQuotaMaxHistory', value: val });
                    }
                });
            }

            // ─── Quota Notification Threshold ───
            var quotaNotifyBtn = document.getElementById('quotaNotifySaveBtn');
            var quotaNotifyInput = document.getElementById('quotaNotifyInput');
            if (quotaNotifyBtn && quotaNotifyInput) {
                quotaNotifyBtn.addEventListener('click', function() {
                    var val = parseInt(quotaNotifyInput.value, 10);
                    if (val >= 0 && val <= 99) {
                        vscode.postMessage({ command: 'setConfig', key: 'quotaNotificationThreshold', value: val });
                    }
                });
            }

            // ─── Activity: Max Recent Steps ───
            var maxStepsBtn = document.getElementById('maxRecentStepsSaveBtn');
            var maxStepsInput = document.getElementById('maxRecentStepsInput');
            if (maxStepsBtn && maxStepsInput) {
                maxStepsBtn.addEventListener('click', function() {
                    var val = parseInt(maxStepsInput.value, 10);
                    if (val >= 10 && val <= 500) {
                        vscode.postMessage({ command: 'setConfig', key: 'activity.maxRecentSteps', value: val });
                    }
                });
            }

            // ─── Activity: Max Archives ───
            var maxArchBtn = document.getElementById('maxArchivesSaveBtn');
            var maxArchInput = document.getElementById('maxArchivesInput');
            if (maxArchBtn && maxArchInput) {
                maxArchBtn.addEventListener('click', function() {
                    var val = parseInt(maxArchInput.value, 10);
                    if (val >= 1 && val <= 100) {
                        vscode.postMessage({ command: 'setConfig', key: 'activity.maxArchives', value: val });
                    }
                });
            }

            // ─── Clear Activity Data ───
            var clearActBtn = document.getElementById('clearActivityData');
            if (clearActBtn) {
                clearActBtn.addEventListener('click', function() {
                    vscode.postMessage({ command: 'clearActivityData' });
                });
            }

            // ─── Privacy mask toggle (persisted) ───
            var privacyBtn = document.getElementById('privacyToggle');
            if (privacyBtn) {
                var privacyDefault = document.body.getAttribute('data-privacy-default') === 'true';
                var masked = savedState.privacyMasked !== undefined ? !!savedState.privacyMasked : privacyDefault;
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
            // ─── Listen for extension messages ───
            window.addEventListener('message', function(event) {
                var msg = event.data;
                if (msg && msg.command === 'switchToTab' && msg.tab) {
                    switchTab(msg.tab);
                }
            });
        })();
    `;
}

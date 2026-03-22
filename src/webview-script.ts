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
                // Save outgoing tab scroll position
                var s = vscode.getState() || {};
                var ts = s.tabScrolls || {};
                ts[activeTab] = window.scrollY;
                s.tabScrolls = ts;

                activeTab = tabName;
                for (var i = 0; i < tabBtns.length; i++) {
                    tabBtns[i].classList.toggle('active', tabBtns[i].dataset.tab === tabName);
                }
                for (var j = 0; j < tabPanes.length; j++) {
                    tabPanes[j].classList.toggle('active', tabPanes[j].id === 'tab-' + tabName);
                }
                s.activeTab = tabName;
                vscode.setState(s);

                // Restore incoming tab scroll position
                tabScrolls = ts; // Update local ref
                var targetY = ts[tabName] || 0;
                requestAnimationFrame(function() { window.scrollTo(0, targetY); });
            }
            // Restore active tab from state
            if (activeTab !== 'monitor') { switchTab(activeTab); }

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

            // ─── Restore & persist ALL <details> states ───
            var detailsOpen = savedState.detailsOpen || {};
            var allDetails = document.querySelectorAll('details[id]');
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

            // ─── Pricing: Save / Reset ───
            var pricingSaveBtn = document.getElementById('pricingSaveBtn');
            var pricingResetBtn = document.getElementById('pricingResetBtn');
            var pricingFeedback = document.getElementById('pricingFeedback');
            if (pricingSaveBtn) {
                pricingSaveBtn.addEventListener('click', function() {
                    var inputs = document.querySelectorAll('.pricing-input');
                    var data = {};
                    for (var pi = 0; pi < inputs.length; pi++) {
                        var inp = inputs[pi];
                        var model = inp.getAttribute('data-model');
                        var field = inp.getAttribute('data-field');
                        var val = parseFloat(inp.value) || 0;
                        if (!data[model]) { data[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 }; }
                        data[model][field] = val;
                    }
                    vscode.postMessage({ command: 'savePricing', value: data });
                });
            }
            if (pricingResetBtn) {
                pricingResetBtn.addEventListener('click', function() {
                    vscode.postMessage({ command: 'resetPricing' });
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
            // ─── Calendar: Event Delegation ───
            document.body.addEventListener('click', function(e) {
                var target = e.target;

                // ── Date Cell Click: expand/collapse detail panel ──
                var cell = target.closest && target.closest('.cal-cell.has-data');
                if (cell) {
                    var date = cell.getAttribute('data-cal-date');
                    if (!date) return;
                    var newSelected = '';
                    var allPanels = document.querySelectorAll('[data-cal-detail]');
                    for (var pi = 0; pi < allPanels.length; pi++) {
                        var p = allPanels[pi];
                        if (p.getAttribute('data-cal-detail') === date) {
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
                    // Deselect other cells
                    var allCells = document.querySelectorAll('.cal-cell.has-data');
                    for (var oi = 0; oi < allCells.length; oi++) {
                        if (allCells[oi] !== cell) {
                            allCells[oi].classList.remove('selected');
                        }
                    }
                    // Persist selected date across refreshes
                    var cs = vscode.getState() || {};
                    cs.calendarSelectedDate = newSelected;
                    vscode.setState(cs);
                    return;
                }

                // ── Clear History Button ──
                if (target.closest && target.closest('#clearCalendarBtn')) {
                    vscode.postMessage({ command: 'clearCalendarHistory' });
                    return;
                }

                // ── Month Navigation Buttons ──
                var navBtn = target.closest && target.closest('.cal-nav-btn');
                if (navBtn) {
                    var yr = navBtn.getAttribute('data-cal-year');
                    var mo = navBtn.getAttribute('data-cal-month');
                    if (yr && mo) {
                        vscode.postMessage({ command: 'switchCalendarMonth', year: parseInt(yr,10), month: parseInt(mo,10) });
                    }
                    return;
                }
            });

            // ─── Listen for extension messages ───
            window.addEventListener('message', function(event) {
                var msg = event.data;
                if (msg && msg.command === 'switchToTab' && msg.tab) {
                    switchTab(msg.tab);
                } else if (msg && (msg.command === 'pricingSaved' || msg.command === 'pricingReset')) {
                    var fb = document.getElementById('pricingFeedback');
                    if (fb) {
                        fb.textContent = msg.command === 'pricingSaved' ? '✓ Saved' : '✓ Reset';
                        fb.style.opacity = '1';
                        setTimeout(function() { fb.style.opacity = '0'; }, 2000);
                    }
                } else if (msg && msg.command === 'updateTabs') {
                    // ── Incremental refresh: update tab pane innerHTML without page reload ──
                    var tabs = msg.tabs;

                    // Save scrollTop of inner scrollable elements before DOM swap
                    var scrollableSelectors = ['.raw-json', '.act-timeline', '.details-body'];
                    var savedScrolls = {};
                    for (var ss = 0; ss < scrollableSelectors.length; ss++) {
                        var sel = scrollableSelectors[ss];
                        var els = document.querySelectorAll(sel);
                        for (var se = 0; se < els.length; se++) {
                            if (els[se].scrollTop > 0) {
                                // Use selector + index as key
                                savedScrolls[sel + ':' + se] = els[se].scrollTop;
                            }
                        }
                    }

                    for (var key in tabs) {
                        if (!tabs.hasOwnProperty(key)) continue;
                        var pane = document.getElementById('tab-' + key);
                        if (pane) { pane.innerHTML = tabs[key]; }
                    }

                    // !! CRITICAL: restore details IMMEDIATELY after innerHTML swap,
                    // BEFORE any DOM read that could force layout with collapsed details.
                    // Otherwise: details closed → page height shrinks → scrollTop read
                    // forces layout → browser adjusts scroll position → details reopen
                    // too late → scroll stuck in wrong position ("Monitor tab jumps").
                    var ds = (vscode.getState() || {}).detailsOpen || {};
                    var dd = document.querySelectorAll('details[id]');
                    for (var di = 0; di < dd.length; di++) {
                        var det = dd[di];
                        if (ds[det.id]) { det.setAttribute('open', ''); }
                        det.addEventListener('toggle', function() {
                            var s = vscode.getState() || {};
                            var dso = s.detailsOpen || {};
                            dso[this.id] = this.open;
                            s.detailsOpen = dso;
                            vscode.setState(s);
                        });
                    }

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

                    // Re-bind Copy Raw JSON button (inside monitor tab pane)
                    var newCopyBtn = document.getElementById('copyRawJson');
                    if (newCopyBtn) {
                        newCopyBtn.addEventListener('click', function() {
                            var rawEl = document.getElementById('rawJsonContent');
                            if (!rawEl) return;
                            navigator.clipboard.writeText(rawEl.textContent || '').then(function() {
                                newCopyBtn.classList.add('copied');
                                var origHtml = newCopyBtn.innerHTML;
                                newCopyBtn.textContent = '✓ Copied';
                                setTimeout(function() { newCopyBtn.innerHTML = origHtml; newCopyBtn.classList.remove('copied'); }, 1500);
                            });
                        });
                    }

                    // Re-bind Pricing Save/Reset (inside pricing tab pane)
                    var newPricingSave = document.getElementById('pricingSaveBtn');
                    if (newPricingSave) {
                        newPricingSave.addEventListener('click', function() {
                            var inputs = document.querySelectorAll('.pricing-input');
                            var data = {};
                            for (var pi = 0; pi < inputs.length; pi++) {
                                var inp = inputs[pi];
                                var model = inp.getAttribute('data-model');
                                var field = inp.getAttribute('data-field');
                                var val = parseFloat(inp.value) || 0;
                                if (!data[model]) { data[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 }; }
                                data[model][field] = val;
                            }
                            vscode.postMessage({ command: 'savePricing', value: data });
                        });
                    }
                    var newPricingReset = document.getElementById('pricingResetBtn');
                    if (newPricingReset) {
                        newPricingReset.addEventListener('click', function() {
                            vscode.postMessage({ command: 'resetPricing' });
                        });
                    }

                    // Re-bind data-switch-tab links
                    var newSwitchLinks = document.querySelectorAll('[data-switch-tab]');
                    for (var nsi = 0; nsi < newSwitchLinks.length; nsi++) {
                        newSwitchLinks[nsi].addEventListener('click', function() {
                            switchTab(this.dataset.switchTab);
                        });
                    }

                    // Re-apply privacy mask if active
                    var privState = vscode.getState() || {};
                    if (privState.privacyMasked) {
                        var targets = document.querySelectorAll('[data-real][data-masked]');
                        for (var pj = 0; pj < targets.length; pj++) {
                            var el = targets[pj];
                            el.textContent = el.getAttribute('data-masked');
                        }
                    }
                }
            });
        })();
    `;
}

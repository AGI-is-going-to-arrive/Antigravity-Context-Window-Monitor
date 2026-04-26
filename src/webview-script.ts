import { tBi } from './i18n';

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
            var copiedText = ${JSON.stringify(`✓ ${tBi('Copied', '已复制')}`)};
            var doneText = ${JSON.stringify(`✓ ${tBi('Done', '完成')}`)};
            var savedText = ${JSON.stringify(`✓ ${tBi('Saved', '已保存')}`)};
            var resetText = ${JSON.stringify(`✓ ${tBi('Reset', '已重置')}`)};
            var openingText = ${JSON.stringify(tBi('Opening...', '正在打开...'))};
            var revealingText = ${JSON.stringify(tBi('Revealing...', '正在定位...'))};
            var openedText = ${JSON.stringify(`✓ ${tBi('Opened', '已打开')}`)};
            var revealedText = ${JSON.stringify(`✓ ${tBi('Revealed', '已定位')}`)};
            var openFailedText = ${JSON.stringify(tBi('Open failed', '打开失败'))};
            var revealFailedText = ${JSON.stringify(tBi('Reveal failed', '定位失败'))};

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

            // ─── Tab System ───
            var activeTab = savedState.activeTab || 'gmdata';
            var tabBtns = document.querySelectorAll('.tab-btn');
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

            // ─── Tab Slider: position & color ───
            var colorMap = {
                blue: '96,165,250', green: '74,222,128', orange: '251,146,60',
                purple: '167,139,250', cyan: '34,211,238', yellow: '250,204,21',
                gray: '148,163,184'
            };
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
                var c = active.dataset.color;
                if (c && colorMap[c]) {
                    slider.style.setProperty('--slider-c', colorMap[c]);
                }
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

                updateTabSlider();
                updateTabOverflowHint();
                updateTabArrows();


                // Restore incoming tab scroll position
                tabScrolls = ts; // Update local ref
                var targetY = ts[tabName] || 0;
                requestAnimationFrame(function() { window.scrollTo(0, targetY); });
            }
            // Restore active tab from state
            if (activeTab !== 'gmdata') { switchTab(activeTab); }
            // Init slider position (must wait for layout)
            requestAnimationFrame(function() { updateTabSlider(); updateTabOverflowHint(); });
            var tabBarEl = document.querySelector('.tab-bar');
            if (tabBarEl) {
                tabBarEl.addEventListener('scroll', function() {
                    updateTabOverflowHint();
                    updateTabArrows();
                }, { passive: true });
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
            // data-switch-tab links: handled by body delegation below


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

            function restoreDetailsState(rootState) {
                var ds = (rootState && rootState.detailsOpen) || {};
                var dd = document.querySelectorAll('details[id]');
                for (var di = 0; di < dd.length; di++) {
                    var det = dd[di];
                    if (Object.prototype.hasOwnProperty.call(ds, det.id)) {
                        det.open = !!ds[det.id];
                    }
                    if (det.getAttribute('data-details-bound') !== 'true') {
                        det.addEventListener('toggle', function() {
                            var s = vscode.getState() || {};
                            var dso = s.detailsOpen || {};
                            dso[this.id] = this.open;
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
                            for (var bi = 0; bi < filterBtns.length; bi++) {
                                filterBtns[bi].classList.toggle('is-active', filterBtns[bi] === this);
                            }
                            applyHistoryFilters();
                        });
                        filterBtns[fi].setAttribute('data-history-bound', 'true');
                    }
                    filterBtns[fi].classList.toggle('is-active', filterBtns[fi].dataset.historyFilter === activeFilter);
                }

                var shortcutBtns = document.querySelectorAll('[data-history-shortcut]');
                for (var si = 0; si < shortcutBtns.length; si++) {
                    if (shortcutBtns[si].getAttribute('data-history-bound') !== 'true') {
                        shortcutBtns[si].addEventListener('click', function() {
                            activeFilter = this.dataset.historyShortcut || 'all';
                            var s = vscode.getState() || {};
                            s.historyFilter = activeFilter;
                            vscode.setState(s);
                            for (var bi = 0; bi < filterBtns.length; bi++) {
                                filterBtns[bi].classList.toggle('is-active', filterBtns[bi].dataset.historyFilter === activeFilter);
                            }
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
                        'quotaNotificationThreshold': 'quotaNotifyFeedback',
                        'statePath': 'statePathFeedback',
                        'panelShowTabScrollHint': 'panelHintFeedback'
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
            // Run overflow check after layout settles
            requestAnimationFrame(function() { initErrorOverflow(); });

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

            // ─── Quota Timeline Tracking Toggle (Settings tab) ───
            var quotaTrackingCb = document.getElementById('toggleQuotaTracking');
            if (quotaTrackingCb) {
                quotaTrackingCb.addEventListener('change', function() {
                    vscode.postMessage({ command: 'toggleQuotaTracking' });
                });
            }


            // clearActiveTracking: handled by body delegation below

            // copyRawJson: handled by body delegation below

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

            // ─── Dev: Simulate Quota Reset ───
            var devSimBtn = document.getElementById('devSimulateReset');
            if (devSimBtn) {
                devSimBtn.addEventListener('click', function() {
                    vscode.postMessage({ command: 'devSimulateReset' });
                    var fb = document.getElementById('devSimulateFeedback');
                    if (fb) { fb.textContent = doneText; setTimeout(function() { fb.textContent = ''; }, 2000); }
                });
            }
            var devRestoreBtn = document.getElementById('devRestoreReset');
            if (devRestoreBtn) {
                devRestoreBtn.addEventListener('click', function() {
                    if (devRestoreBtn.disabled) return;
                    vscode.postMessage({ command: 'devRestoreReset' });
                    var fb = document.getElementById('devSimulateFeedback');
                    if (fb) { fb.textContent = resetText; setTimeout(function() { fb.textContent = ''; }, 2000); }
                });
            }

            // copyStatePath / openStateFile / revealStateFile / restoreTabScrollHint:
            // handled by body delegation below

            // pricing Save/Reset: handled by body delegation below

            // privacy mask: handled by body delegation below
            // Apply initial mask state (read-only, no binding)
            var privacyDefault = document.body.getAttribute('data-privacy-default') === 'true';
            var initialMasked = savedState.privacyMasked !== undefined ? !!savedState.privacyMasked : privacyDefault;
            if (initialMasked) {
                var initTargets = document.querySelectorAll('[data-real][data-masked]');
                for (var imj = 0; imj < initTargets.length; imj++) {
                    initTargets[imj].textContent = initTargets[imj].getAttribute('data-masked');
                }
                var initBtn = document.getElementById('privacyToggle');
                if (initBtn) { initBtn.classList.add('active'); }
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
            document.body.addEventListener('click', function(e) {
                var target = e.target instanceof Element
                    ? e.target
                    : (e.target && e.target.parentElement ? e.target.parentElement : null);
                if (!target || !target.closest) { return; }

                // ── Error message full-text click → collapse ──
                var errFull = target.closest('.gm-err-msg-full');
                if (errFull) {
                    var det = errFull.closest('details.gm-err-expand');
                    if (det) { det.removeAttribute('open'); }
                    return;
                }

                // ── data-switch-tab links (e.g. Monitor → Profile "Details →") ──
                var switchLink = target.closest('[data-switch-tab]');
                if (switchLink) {
                    switchTab(switchLink.dataset.switchTab);
                    return;
                }

                // ── About page: data-navigate-tab cards ──
                var navCard = target.closest('[data-navigate-tab]');
                if (navCard) {
                    switchTab(navCard.dataset.navigateTab);
                    return;
                }

                // ── Copy Raw JSON ──
                if (target.closest('#copyRawJson')) {
                    var cpyBtn = target.closest('#copyRawJson');
                    var rawEl = document.getElementById('rawJsonContent');
                    if (!rawEl) return;
                    navigator.clipboard.writeText(rawEl.textContent || '').then(function() {
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
                    navigator.clipboard.writeText(ueData.textContent || '').then(function() {
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
                    return;
                }

                // ── Pricing Reset ──
                if (target.closest('#pricingResetBtn')) {
                    vscode.postMessage({ command: 'resetPricing' });
                    return;
                }

                // ── Clear Active Tracking ──
                if (target.closest('#clearActiveTracking')) {
                    vscode.postMessage({ command: 'clearActiveTracking' });
                    return;
                }
                if (target.closest('#clearQuotaHistory')) {
                    vscode.postMessage({ command: 'clearQuotaHistory' });
                    return;
                }

                // ── Privacy Mask Toggle ──
                if (target.closest('#privacyToggle')) {
                    var pBtn = target.closest('#privacyToggle');
                    var st = vscode.getState() || {};
                    var m = !st.privacyMasked;
                    st.privacyMasked = m;
                    vscode.setState(st);
                    var tgts = document.querySelectorAll('[data-real][data-masked]');
                    for (var k = 0; k < tgts.length; k++) {
                        tgts[k].textContent = m ? tgts[k].getAttribute('data-masked') : tgts[k].getAttribute('data-real');
                    }
                    pBtn.classList.toggle('active', m);
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



                // ── Date Cell Click: expand/collapse detail panel ──
                var cell = target.closest('.cal-cell.has-data');
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

                // ── Clear History Button ──
                if (target.closest('#clearCalendarBtn')) {
                    vscode.postMessage({ command: 'clearCalendarHistory' });
                    return;
                }

                // ── Go to Settings from Quota Tracking disabled state ──
                if (target.closest('#goToSettingsFromQuota')) {
                    switchTab('settings');
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

                // ── Month Navigation Buttons ──
                var navBtn = target.closest('.cal-nav-btn');
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
                        fb.textContent = msg.command === 'pricingSaved' ? savedText : resetText;
                        fb.style.opacity = '1';
                        setTimeout(function() { fb.style.opacity = '0'; }, 2000);
                    }
                } else if (msg && msg.command === 'updateTabs') {
                    // ── Incremental refresh: update tab pane innerHTML without page reload ──
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
                                // Use selector + index as key
                                savedScrolls[sel + ':' + se] = els[se].scrollTop;
                            }
                        }
                    }

                    for (var key in tabs) {
                        if (!tabs.hasOwnProperty(key)) continue;
                        if (lastTabHtmls[key] === tabs[key]) { continue; }
                        var pane = document.getElementById('tab-' + key);
                        if (pane) {
                            pane.innerHTML = tabs[key];
                            lastTabHtmls[key] = tabs[key];
                            changedTabKeys.push(key);
                        }
                    }

                    for (var cti = 0; cti < changedTabKeys.length; cti++) {
                        if (visibleEocTabs[changedTabKeys[cti]]) {
                            restoreVisibleEoc(changedTabKeys[cti]);
                        }
                    }

                    // !! CRITICAL: restore details IMMEDIATELY after innerHTML swap,
                    // BEFORE any DOM read that could force layout with collapsed details.
                    // Otherwise: details closed → page height shrinks → scrollTop read
                    // forces layout → browser adjusts scroll position → details reopen
                    // too late → scroll stuck in wrong position ("Monitor tab jumps").
                    restoreDetailsState(vscode.getState() || {});



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

                    // Re-apply privacy mask if active (delegation handles clicks, just restore visual state)
                    var privState = vscode.getState() || {};
                    var isMasked = privState.privacyMasked !== undefined ? !!privState.privacyMasked : (document.body.getAttribute('data-privacy-default') === 'true');
                    if (isMasked) {
                        var targets = document.querySelectorAll('[data-real][data-masked]');
                        for (var pj = 0; pj < targets.length; pj++) {
                            targets[pj].textContent = targets[pj].getAttribute('data-masked');
                        }
                        var privBtnEl = document.getElementById('privacyToggle');
                        if (privBtnEl) { privBtnEl.classList.add('active'); }
                    }

                    // ── Account Popover: content-only refresh, preserve open/close state ──
                    if (typeof tabs.accountPopover === 'string') {
                        var popBody = document.getElementById('acctPopoverBody');
                        if (popBody && tabs.accountPopover) {
                            popBody.innerHTML = tabs.accountPopover;
                        }
                    }
                    // Red-dot sync
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

                    // Recalculate tab slider position after content swap
                    // (tab button widths may change due to language or data updates)
                    updateTabSlider();
                    updateTabOverflowHint();
                    bindHistoryCatalog();
                    bindEocObserver();
                    requestAnimationFrame(function() { initErrorOverflow(); });

                    // Restore model stats error toggle state (default: hidden)
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
        })();
    `;
}

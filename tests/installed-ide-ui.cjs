/* Run after installing the release VSIX and reloading Antigravity IDE.
 *   node tests/installed-ide-ui.cjs --native [--app <IDE app name>] [--window-id <window id>]
 *   node tests/installed-ide-ui.cjs [--installed <extension directory>] [--smoke]
 *   node tests/installed-ide-ui.cjs --screenshot <output PNG file> [--screenshot-tab <tab id>] [--screenshot-theme <dark|light|vscode-*>] [--screenshot-lang <both|en|zh>] [--overwrite]
 *   node tests/installed-ide-ui.cjs --screenshots-dir <output directory> [--screenshot-theme <dark|light|both|vscode-*>] [--screenshot-lang <both|en|zh>] [--overwrite]
 * The native smoke test uses agent-desktop. The deterministic matrix renders
 * installed JavaScript in an isolated agent-browser session with a stub IDE bridge.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseArgs } = require('node:util');

const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
const { values: args } = parseArgs({ options: {
    native: { type: 'boolean' },
    smoke: { type: 'boolean' },
    app: { type: 'string' },
    'window-id': { type: 'string' },
    'status-label': { type: 'string' },
    'timeout-ms': { type: 'string', default: '8000' },
    installed: { type: 'string' },
    screenshot: { type: 'string' },
    'screenshots-dir': { type: 'string' },
    'screenshot-theme': { type: 'string', default: 'dark' },
    'screenshot-tab': { type: 'string', default: 'overview' },
    'screenshot-lang': { type: 'string', default: 'both' },
    'screenshot-width': { type: 'string', default: '1200' },
    'screenshot-height': { type: 'string', default: '860' },
    overwrite: { type: 'boolean', default: false },
} });
const extensionId = `${manifest.publisher}.${manifest.name}`.toLowerCase();
const installed = args.installed ? path.resolve(args.installed)
    : path.join(os.homedir(), '.antigravity-ide', 'extensions', `${extensionId}-${manifest.version}`);
const app = args.app || (process.platform === 'darwin' ? 'com.google.antigravity-ide' : 'Antigravity IDE');
const languages = {
    en: {
        heading: 'Antigravity Monitor', overview: 'Overview', overviewTitle: 'Context & quota', viewModels: 'View models',
        modelInfo: 'Model Info', statusSettings: 'Status bar settings', statusDisplay: 'Status Bar Display',
        customPricing: 'Custom Pricing', orchSettings: 'Orchestrator Settings',
        orchModel: 'Orchestrator Model', execModel: 'Executor Model',
        fiveHour: '5-Hour', weekly: 'Weekly',
        gmData: 'GM Data', chats: 'Sessions', pricing: 'Cost', models: 'Models', calendar: 'Calendar', profile: 'Profile', settings: 'Settings',
        about: 'About', aboutTitle: 'Antigravity Context Window Monitor', resume: 'Resume auto-refresh',
        efforts: 'Low · Medium · High · Extra High', notReported: 'Not reported',
        disconnectedHeading: 'Backend disconnected',
    },
    zh: {
        heading: 'Antigravity 监控面板', overview: '总览', overviewTitle: '上下文与配额', viewModels: '查看模型',
        modelInfo: '模型信息', statusSettings: '状态栏设置', statusDisplay: '状态栏显示',
        customPricing: '自定义价格', orchSettings: '编排设置',
        orchModel: '编排模型', execModel: '执行模型',
        fiveHour: '5 小时', weekly: '每周',
        gmData: 'GM 数据', chats: '会话', pricing: '成本', models: '模型', calendar: '日历', profile: '账号', settings: '设置',
        about: '关于', aboutTitle: 'Antigravity 上下文窗口监控', resume: '恢复自动刷新',
        efforts: '低 · 中 · 高 · 超高', notReported: '未上报',
        disconnectedHeading: '后端连接已断开',
    },
    both: {
        heading: 'Antigravity Monitor / Antigravity 监控面板', overview: 'Overview / 总览',
        overviewTitle: 'Context & quota / 上下文与配额', viewModels: 'View models / 查看模型',
        modelInfo: 'Model Info / 模型信息', statusSettings: 'Status bar settings / 状态栏设置',
        statusDisplay: 'Status Bar Display / 状态栏显示',
        customPricing: 'Custom Pricing / 自定义价格',
        orchSettings: 'Orchestrator Settings / 编排设置',
        orchModel: 'Orchestrator Model / 编排模型', execModel: 'Executor Model / 执行模型',
        fiveHour: '5-Hour / 5 小时', weekly: 'Weekly / 每周',
        gmData: 'GM Data / GM 数据', chats: 'Sessions / 会话', pricing: 'Cost / 成本', models: 'Models / 模型',
        calendar: 'Calendar / 日历', profile: 'Profile / 账号', settings: 'Settings / 设置',
        about: 'About / 关于',
        aboutTitle: 'Antigravity Context Window Monitor / Antigravity 上下文窗口监控',
        resume: 'Resume auto-refresh / 恢复自动刷新',
        efforts: 'Low · Medium · High · Extra High / 低 · 中 · 高 · 超高',
        notReported: 'Not reported / 未上报',
        disconnectedHeading: 'Backend disconnected / 后端连接已断开',
    },
};
const languageButtons = { en: 'EN', zh: '中文', both: /^(Both|双语|Both \/ 双语)$/ };
const tabs = ['overview', 'gmdata', 'chats', 'pricing', 'models', 'calendar', 'profile', 'settings', 'about'];
const screenshotFilenames = {
    overview: 'monitor-overview.png',
    gmdata: 'monitor-gm-data.png',
    chats: 'monitor-sessions.png',
    pricing: 'monitor-cost.png',
    models: 'monitor-models.png',
    calendar: 'monitor-calendar.png',
    profile: 'monitor-profile.png',
    settings: 'monitor-settings.png',
    about: 'monitor-about.png',
};
// Live IDE catalog, November 22, 2026 (LS 2.34.0 / agy 1.5.14). Keep expectations independent of the build.
const neonIdentities = [
    ['M534', 'gemini-4-neon-low', 'Low', '低'],
    ['M533', 'gemini-4-neon-medium', 'Medium', '中'],
    ['M532', 'gemini-4-neon-high', 'High', '高'],
    ['M535', 'gemini-4-neon-xhigh', 'Extra High', '超高'],
    ['M537', 'gemini-pro-orchestrator-neon', null, null],
];
const gemini4CheckpointerIds = [
    'MODEL_PLACEHOLDER_M534', 'MODEL_PLACEHOLDER_M533', 'MODEL_PLACEHOLDER_M532', 'MODEL_PLACEHOLDER_M535',
    'MODEL_PLACEHOLDER_M537', 'MODEL_PLACEHOLDER_M528', 'MODEL_PLACEHOLDER_M427', 'MODEL_PLACEHOLDER_M417',
    'MODEL_PLACEHOLDER_M667', 'MODEL_PLACEHOLDER_M681',
];

function localizedEffortLabel(lang, family, effort, translated) {
    if (!effort) { return family; }
    const label = lang === 'en' ? effort : lang === 'zh' ? translated : `${effort} / ${translated}`;
    return `${family} (${label})`;
}

function neonLabel(lang, effort, translated) {
    if (!effort) { return 'Orchestrator (Neon)'; }
    return localizedEffortLabel(lang, 'Gemini 4 Neon', effort, translated);
}

const themeTokens = {
    'vscode-light': {
        background: '#ffffff', sideBar: '#f3f3f3', widget: '#f8f8f8',
        text: '#1f2328', description: '#57606a', disabled: '#8c959f',
        border: '#d0d7de', contrastBorder: 'transparent', focusBorder: '#0969da',
        accent: '#005fb8', accentHover: '#004c94', accentText: '#ffffff',
        secondaryBg: '#eaeef2', secondaryText: '#24292f', secondaryHover: '#d8dee4',
        inputBg: '#ffffff', inputText: '#1f2328', inputBorder: '#8c959f', placeholder: '#6e7781',
        badgeBg: '#0969da', badgeText: '#ffffff',
        hoverBg: '#eaeef2', activeBg: '#ddf4ff', activeText: '#0969da',
        ok: '#1a7f37', warn: '#9a6700', error: '#cf222e',
        chartBlue: '#0969da', chartGreen: '#1a7f37', chartYellow: '#9a6700', chartRed: '#cf222e', chartPurple: '#8250df',
        scrollbar: 'rgba(100, 100, 100, 0.35)', scrollbarHover: 'rgba(100, 100, 100, 0.55)',
    },
    'vscode-dark': {
        background: '#1e1e1e', sideBar: '#252526', widget: '#252526',
        text: '#cccccc', description: '#9d9d9d', disabled: '#6e6e6e',
        border: '#3c3c3c', contrastBorder: 'transparent', focusBorder: '#007fd4',
        accent: '#3794ff', accentHover: '#4da3ff', accentText: '#0d1117',
        secondaryBg: '#3a3d41', secondaryText: '#ffffff', secondaryHover: '#45494e',
        inputBg: '#3c3c3c', inputText: '#cccccc', inputBorder: '#6b6b6b', placeholder: '#9d9d9d',
        badgeBg: '#4d4d4d', badgeText: '#ffffff',
        hoverBg: '#2a2d2e', activeBg: '#094771', activeText: '#ffffff',
        ok: '#73c991', warn: '#cca700', error: '#f48771',
        chartBlue: '#75beff', chartGreen: '#89d185', chartYellow: '#cca700', chartRed: '#f14c4c', chartPurple: '#b180d7',
        scrollbar: 'rgba(121, 121, 121, 0.4)', scrollbarHover: 'rgba(100, 100, 100, 0.7)',
    },
    'vscode-high-contrast': {
        background: '#000000', sideBar: '#000000', widget: '#0c141f',
        text: '#ffffff', description: '#ffffff', disabled: '#d4d4d4',
        border: '#6fc3df', contrastBorder: '#ffffff', focusBorder: '#f38518',
        accent: '#75beff', accentHover: '#9cdcfe', accentText: '#000000',
        secondaryBg: '#000000', secondaryText: '#ffffff', secondaryHover: '#1a1a1a',
        inputBg: '#000000', inputText: '#ffffff', inputBorder: '#ffffff', placeholder: '#d4d4d4',
        badgeBg: '#000000', badgeText: '#ffffff',
        hoverBg: '#1a1a1a', activeBg: '#000000', activeText: '#ffffff',
        ok: '#89d185', warn: '#ffd700', error: '#ff6b6b',
        chartBlue: '#75beff', chartGreen: '#89d185', chartYellow: '#ffd700', chartRed: '#ff6b6b', chartPurple: '#d2a8ff',
        scrollbar: '#6fc3df', scrollbarHover: '#ffffff',
    },
    'vscode-high-contrast-light': {
        background: '#ffffff', sideBar: '#ffffff', widget: '#ffffff',
        text: '#000000', description: '#000000', disabled: '#4d4d4d',
        border: '#0f4a85', contrastBorder: '#000000', focusBorder: '#006bbd',
        accent: '#0f4a85', accentHover: '#003a70', accentText: '#ffffff',
        secondaryBg: '#ffffff', secondaryText: '#000000', secondaryHover: '#e6eef7',
        inputBg: '#ffffff', inputText: '#000000', inputBorder: '#000000', placeholder: '#4d4d4d',
        badgeBg: '#0f4a85', badgeText: '#ffffff',
        hoverBg: '#e6eef7', activeBg: '#0f4a85', activeText: '#ffffff',
        ok: '#005a32', warn: '#7a4f01', error: '#b5200d',
        chartBlue: '#0f4a85', chartGreen: '#005a32', chartYellow: '#7a4f01', chartRed: '#b5200d', chartPurple: '#6639ba',
        scrollbar: '#0f4a85', scrollbarHover: '#000000',
    },
};

function resolveScreenshotThemes(raw) {
    if (raw === 'dark') { return ['vscode-dark']; }
    if (raw === 'light') { return ['vscode-light']; }
    if (raw === 'both') { return ['vscode-light', 'vscode-dark']; }
    assert(Object.hasOwn(themeTokens, raw),
        `unsupported --screenshot-theme: ${raw} (use dark, light, both, or one of ${Object.keys(themeTokens).join(', ')})`);
    return [raw];
}

function assertCoolNeutralRgb(rgbString, label, maxSpread = 12) {
    const match = rgbString?.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    assert(match, `${label} has a concrete RGB surface: ${rgbString}`);
    const [r, g, b] = match.slice(1, 4).map(Number);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    assert(spread <= maxSpread, `${label} must stay cool-neutral (max-min=${spread} <= ${maxSpread}): ${rgbString}`);
    assert(r <= b + 2, `${label} must have zero warm/sepia cast (R=${r} <= B+2=${b + 2}): ${rgbString}`);
}

function checkInstall() {
    const packageJSON = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
    assert.equal(packageJSON.version, manifest.version);
    assert.equal(`${packageJSON.publisher}.${packageJSON.name}`.toLowerCase(), extensionId);
    const codeFiles = base => fs.readdirSync(path.join(base, 'out'), { recursive: true }).filter(name => name.endsWith('.js')).sort();
    const checksum = (base, name) => createHash('sha256').update(fs.readFileSync(path.join(base, 'out', name))).digest('hex');
    const files = codeFiles(installed);
    assert(files.length > 0, 'installed JavaScript exists');
    assert.deepEqual(files, codeFiles(root), 'installed and compiled JavaScript file lists match');
    for (const name of files) {
        assert.equal(checksum(installed, name), checksum(root, name), `installed JavaScript matches current build: ${name}`);
    }
    return { packageJSON, files: files.length };
}

function jsonResult(binary, argv, input) {
    let output;
    try {
        output = execFileSync(binary, argv, { input, encoding: 'utf8', timeout: 35000, maxBuffer: 8 * 1024 * 1024 });
    } catch (error) {
        if (!error.stdout?.trim()) {
            if (error.code && !error.message.includes(error.code)) {
                error.message = `${error.code}: ${error.message}`;
            }
            throw error;
        }
        output = error.stdout;
    }
    return JSON.parse(output);
}

function desktop(argv) {
    const result = jsonResult('agent-desktop', argv);
    assert(result.ok, `agent-desktop ${argv[0]}: ${result.error?.code || 'failed'} (${result.error?.disposition?.retry || 'retry unknown'})`);
    return result.data;
}

function nativeSmoke() {
    const snapshotTimeout = String(Math.max(3000, parseInt(args['timeout-ms'], 10) || 8000));
    const snapshotArgs = ['snapshot', '--app', app, '--compact', '--max-depth', '45', '--timeout-ms', snapshotTimeout];
    if (args['window-id']) { snapshotArgs.push('--window-id', args['window-id']); }
    const snapshot = () => {
        const result = jsonResult('agent-desktop', snapshotArgs);
        if (!result.ok) {
            if (result.error?.disposition?.retry === 'safe'
                && ['APP_UNRESPONSIVE', 'TIMEOUT'].includes(result.error.code)) { return null; }
            assert.fail(`IDE snapshot failed: ${result.error?.code}`);
        }
        const state = result.data;
        if (!state.complete) { return null; }
        const nodes = [];
        function visit(node, ancestors = []) {
            nodes.push({ ...node, ancestors });
            for (const child of node.children || []) { visit(child, [...ancestors, node.role]); }
        }
        visit(state.tree);
        return nodes;
    };
    const matches = (node, role, name) => node.role === role && (name instanceof RegExp ? name.test(node.name || '') : node.name === name);
    function waitFor(predicate, description) {
        const deadline = Date.now() + 18000;
        do {
            const nodes = snapshot();
            const result = nodes && predicate(nodes);
            if (result) { return result; }
        } while (Date.now() < deadline);
        assert.fail(`Live IDE did not show ${description}`);
    }
    function click(predicate, description) {
        const button = waitFor(nodes => {
            const matching = nodes.filter(node => node.ref_id && predicate(node));
            assert(matching.length <= 1, `ambiguous IDE control: ${description}`);
            return matching[0];
        }, description);
        desktop(['click', button.ref_id]);
    }
    const has = (nodes, role, name) => nodes.some(node => matches(node, role, name));
    const hasText = (nodes, pattern) => nodes.some(node => (
        pattern instanceof RegExp ? pattern.test(node.name || '') : (node.name || '').includes(pattern)
    ));
    const hasLocalizedText = (nodes, lang, key) => (
        lang === 'both'
            ? hasText(nodes, languages.en[key]) && hasText(nodes, languages.zh[key])
            : hasText(nodes, languages[lang][key])
    );
    const hasModelInfo = (nodes, labels) => nodes.some(node => node.role === 'heading'
        && node.name?.toLocaleLowerCase() === labels.modelInfo.toLocaleLowerCase());
    const statusLabel = new RegExp(args['status-label'] || 'Context (?:Window )?(?:Monitor|Usage)|上下文(?:窗口)?(?:使用情况|监控)|No active conversation|无活跃会话', 'i');
    const disconnectedStatusRe = /不可用|Unavailable|Disconnected|连接已断开/i;
    const findStatusButton = nodes => nodes.find(node => node.ancestors.includes('status') && matches(node, 'button', statusLabel));
    const openFromStatus = () => {
        const statusBtn = waitFor(findStatusButton, 'connected monitor status item');
        assert(!disconnectedStatusRe.test(statusBtn.name || ''),
            `Live IDE status bar must be connected (not unavailable/disconnected): ${statusBtn.name}`);
        desktop(['click', statusBtn.ref_id]);
        return statusBtn.name || '';
    };
    const initialStatusLabel = openFromStatus();
    console.log(`Native live status bar connected: ${initialStatusLabel}`);
    const currentLocale = () => waitFor(nodes => Object.keys(languages).find(lang => has(nodes, 'heading', languages[lang].heading)), 'monitor webview title');
    const original = currentLocale();
    const switchLocale = lang => {
        if (currentLocale() === lang) { return; }
        click(node => matches(node, 'button', languageButtons[lang]), `monitor language ${lang}`);
        waitFor(nodes => has(nodes, 'heading', languages[lang].heading), `monitor heading in ${lang}`);
    };
    const clickNavTab = (label, description) => click(
        node => node.ancestors.includes('navigation') && matches(node, 'button', label),
        description,
    );
    try {
        let sweptAllNine = false;
        for (const [lang, labels] of Object.entries(languages)) {
            switchLocale(lang);
            openFromStatus();
            const overviewNodes = waitFor(
                nodes => has(nodes, 'heading', labels.overviewTitle) && nodes,
                `overview from the status item in ${lang}`,
            );
            assert(!has(overviewNodes, 'heading', labels.disconnectedHeading),
                `Overview must not show backend disconnected in ${lang}`);
            assert(hasLocalizedText(overviewNodes, lang, 'fiveHour') && hasLocalizedText(overviewNodes, lang, 'weekly'),
                `Overview shows live dual-window (5h + Weekly) quota in ${lang}`);

            click(node => matches(node, 'button', labels.viewModels), `Overview model action in ${lang}`);
            const models = waitFor(
                nodes => hasModelInfo(nodes, labels) && has(nodes, 'heading', labels.orchSettings) && nodes,
                `live Models + Orchestrator Settings in ${lang}`,
            );
            assert(hasLocalizedText(models, lang, 'orchModel') && hasLocalizedText(models, lang, 'execModel'),
                `Models tab renders live Orchestrator Model & Executor Model in ${lang}`);
            assert(hasLocalizedText(models, lang, 'fiveHour') && hasLocalizedText(models, lang, 'weekly'),
                `Models tab renders live dual-window (5h + Weekly) quota in ${lang}`);
            assert(hasText(models, /512,000/), `Models tab shows 512,000 compression limit in ${lang}`);
            for (const [, catalogId, effort, translated] of neonIdentities) {
                if (models.some(node => node.role === 'statictext' && node.name === catalogId)) {
                    assert(has(models, 'heading', neonLabel(lang, effort, translated)), `${catalogId} has the correct name in ${lang}`);
                }
            }
            assert(models.some(node => node.role === 'statictext' && node.name === 'gemini-4-neon-xhigh'),
                `gemini-4-neon-xhigh is mounted in ${lang}`);
            assert(!has(models, 'article', 'Gemini Flash (Orchestrator Worker)'), 'legacy worker label is not a selectable model');
            assert(!has(models, 'article', 'Gemini 4 Hydrogen (Orchestrator)'), 'hidden worker M669 is not a selectable model');

            // Sweep all remaining tabs (non-destructive; no saved user settings mutated)
            if (!sweptAllNine) {
                clickNavTab(labels.gmData, `GM Data tab in ${lang}`);
                waitFor(nodes => nodes.some(node => node.ancestors.includes('navigation')
                    && matches(node, 'button', labels.gmData)), `GM Data tab mounted in ${lang}`);

                clickNavTab(labels.chats, `Sessions tab in ${lang}`);
                waitFor(nodes => nodes.some(node => node.ancestors.includes('navigation')
                    && matches(node, 'button', labels.chats)), `Sessions tab mounted in ${lang}`);

                clickNavTab(labels.pricing, `Cost tab in ${lang}`);
                const costNodes = waitFor(
                    nodes => hasText(nodes, labels.customPricing) && hasText(nodes, /USD/) && nodes,
                    `Cost tab USD-only pricing in ${lang}`,
                );
                assert(!hasText(costNodes, /\bCNY\b|¥|人民币|币种与汇率|参考汇率/), `Cost tab displays USD-only with zero CNY/FX controls in ${lang}`);
                assert(!hasText(costNodes, /令牌/), `Cost tab has zero 令牌 in ${lang}`);

                clickNavTab(labels.calendar, `Calendar tab in ${lang}`);
                waitFor(nodes => nodes.some(node => node.ancestors.includes('navigation')
                    && matches(node, 'button', labels.calendar)), `Calendar tab mounted in ${lang}`);

                clickNavTab(labels.profile, `Profile tab in ${lang}`);
                const profileNodes = waitFor(
                    nodes => hasText(nodes, labels.fiveHour) && nodes,
                    `Profile tab with live quota in ${lang}`,
                );
                assert(!hasText(profileNodes, /\b(?:Prompt|Flow)\s+(?:Credits|额度)/i),
                    `Profile tab has zero legacy Prompt/Flow credits in ${lang}`);
                sweptAllNine = true;
            }

            openFromStatus();
            click(node => matches(node, 'button', labels.statusSettings), `Overview status settings action in ${lang}`);
            const settingsNodes = waitFor(
                nodes => has(nodes, 'heading', labels.statusDisplay) && hasText(nodes, '$0.27') && nodes,
                `status bar settings controls in ${lang}`,
            );
            assert(hasText(settingsNodes, /Updates|版本更新|Check for Updates|检查更新/),
                `Settings tab renders Updates & Release Checks card in ${lang}`);

            clickNavTab(labels.about, `About tab in ${lang}`);
            const aboutNodes = waitFor(
                nodes => (has(nodes, 'heading', labels.aboutTitle) || has(nodes, 'heading', 'Antigravity Context Window Monitor'))
                    && nodes.some(node => node.role === 'statictext' && node.name?.includes(manifest.version))
                    && nodes,
                `About version ${manifest.version} in ${lang}`,
            );
            assert(hasText(aboutNodes, /512K/), `About tab displays updated 512K context window disclaimer in ${lang}`);
            console.log(`Native ${lang}: connected status, dual-window quota, Orchestrator Settings, Neon Extra High/512K, USD-only cost/settings & About v${manifest.version} passed`);
        }
    } finally {
        switchLocale(original);
        openFromStatus();
    }
}

function loadInstalledPanel(packageJSON) {
    let html = '';
    let density = 'auto';
    let windowZoom = 0;
    let showSessionCost = false;
    let showNativeHudBar = false;
    let orchestratorPricingMode = 'mapped';
    let statusItem;
    const values = new Map([['panelShowTabScrollHint', !(args.screenshot || args['screenshots-dir'])]]);
    const state = {
        get: (key, fallback) => values.get(key) ?? fallback,
        update: async (key, value) => { values.set(key, value); },
    };
    const dispose = () => ({ dispose() {} });
    const panel = {
        webview: { get html() { return html; }, set html(value) { html = value; }, onDidReceiveMessage: dispose, postMessage() {} },
        reveal() {}, onDidChangeViewState: dispose, onDidDispose: dispose,
    };
    const vscode = {
        window: { createWebviewPanel: () => panel, createStatusBarItem: () => statusItem },
        workspace: {
            getConfiguration: section => ({
                get: (key, fallback) => {
                    if (section === 'window' && key === 'zoomLevel') { return windowZoom; }
                    if (key === 'statusBar.tooltipDensity') { return density; }
                    if (key === 'statusBar.showSessionCost') { return showSessionCost; }
                    if (key === 'showNativeHudBar') { return showNativeHudBar; }
                    if (key === 'orchestratorPricingMode') { return orchestratorPricingMode; }
                    return fallback;
                },
            }),
        },
        commands: { executeCommand() {}, registerCommand: dispose },
        extensions: { getExtension: () => undefined },
        ViewColumn: { Two: 2 },
        StatusBarAlignment: { Right: 2 },
        ThemeColor: class { constructor(id) { this.id = id; } },
        MarkdownString: class { constructor(value) { this.value = value; } },
    };
    const originalLoad = Module._load;
    Module._load = function (id, parent, isMain) {
        return id === 'vscode' ? vscode : originalLoad.call(this, id, parent, isMain);
    };
    try {
        const load = moduleName => require(path.join(installed, 'out', moduleName));
        const { setLanguageToState } = load('i18n.js');
        const { getModelSpecs } = load('models.js');
        const { refreshMonitorPanelLanguage, setPanelDurableState, showMonitorPanel } = load('webview-panel.js');
        const { buildOverviewTabContent } = load('webview-overview-tab.js');
        const { buildModelInfoGrid } = load('webview-models-tab.js');
        const { buildModelDNACards } = load('pricing-panel.js');
        const { PricingStore } = load('pricing-store.js');
        const { DailyStore } = load('daily-store.js');
        const { buildSummaryFromConversations } = load('gm/summary.js');
        const { StatusBarManager } = load('statusbar.js');
        const pricingStore = new PricingStore();
        setPanelDurableState(state);
        return {
            specs: getModelSpecs(),
            editorialFixtures: (usage, specs, resetTime) => editorialFixtures(usage, specs, DailyStore, buildSummaryFromConversations, resetTime),
            renderOverview: (usage, configs, userInfo = null, billingDay = 0, status, now, telemetry) =>
                buildOverviewTabContent(usage, configs, userInfo, billingDay, status, now, telemetry),
            renderModelInfoGrid: (specs, kind = 'chat', options = {}) => buildModelInfoGrid(specs, kind, options),
            renderModelDNA: (gmSummary, configs) => buildModelDNACards(gmSummary, {}, configs),
            renderStatusBar: (mode, configs, options = {}) => {
                density = mode;
                windowZoom = options.zoomLevel ?? 0;
                showSessionCost = Boolean(options.displayPrefs?.showSessionCost);
                statusItem = { show() {}, dispose() {} };
                const status = new StatusBarManager();
                try {
                    status.setModelConfigs(configs);
                    if (options.planName !== undefined || options.tierName !== undefined) {
                        status.setPlanName(options.planName || '', options.tierName || '');
                    }
                    if ('credits' in options) { status.setCredits(options.credits); }
                    if (options.billingDay !== undefined) { status.setBillingDay(options.billingDay); }
                    if ('orchestratorSettings' in options) { status.setOrchestratorSettings(options.orchestratorSettings); }
                    if ('quotaSummary' in options) { status.setQuotaSummary(options.quotaSummary); }
                    if ('costSnapshot' in options) { status.setCostSnapshot(options.costSnapshot); }
                    if ('gmSummary' in options) {
                        status.setTelemetry(options.gmSummary, options.activeCascadeId, options.customPricing);
                    }
                    if (options.displayPrefs) { status.setDisplayPrefs(options.displayPrefs); }
                    if (options.usage) {
                        status.update(options.usage);
                    } else if (options.state === 'idle') {
                        status.showIdle('512k', options.modelId);
                    } else if (options.state === 'disconnected') {
                        status.showDisconnected(options.message || 'LS connection lost');
                    } else {
                        status.showNoConversation('512k', options.modelId);
                    }
                    return {
                        text: statusItem.text || '',
                        tooltip: statusItem.tooltip?.value || '',
                        isTrusted: statusItem.tooltip?.isTrusted,
                        a11y: statusItem.accessibilityInformation,
                    };
                } finally {
                    status.dispose();
                }
            },
            renderHover: (mode, configs, options = {}) => {
                density = mode;
                windowZoom = options.zoomLevel ?? 0;
                showSessionCost = Boolean(options.displayPrefs?.showSessionCost);
                statusItem = { show() {}, dispose() {} };
                const status = new StatusBarManager();
                try {
                    status.setModelConfigs(configs);
                    if (options.planName !== undefined || options.tierName !== undefined) {
                        status.setPlanName(options.planName || '', options.tierName || '');
                    }
                    if ('credits' in options) { status.setCredits(options.credits); }
                    if (options.billingDay !== undefined) { status.setBillingDay(options.billingDay); }
                    if ('orchestratorSettings' in options) { status.setOrchestratorSettings(options.orchestratorSettings); }
                    if ('quotaSummary' in options) { status.setQuotaSummary(options.quotaSummary); }
                    if ('costSnapshot' in options) { status.setCostSnapshot(options.costSnapshot); }
                    if ('gmSummary' in options) {
                        status.setTelemetry(options.gmSummary, options.activeCascadeId, options.customPricing);
                    }
                    if (options.usage) { status.update(options.usage); }
                    else { status.showNoConversation(); }
                    return statusItem.tooltip.value;
                } finally {
                    status.dispose();
                }
            },
            render: async (lang, modelConfigs, extra = {}) => {
                showSessionCost = Boolean(extra.showSessionCost);
                showNativeHudBar = Boolean(extra.showNativeHudBar);
                orchestratorPricingMode = extra.orchestratorPricingMode || 'mapped';
                await setLanguageToState(lang, state);
                showMonitorPanel({
                    currentUsage: null, allTrajectoryUsages: [], allTrajectories: [],
                    modelConfigs, userInfo: null, pricingStore,
                    activitySummary: null, gmSummary: null, gmFullSummary: null,
                    dailyStore: new DailyStore(), storageDiagnostics: undefined,
                    accountSnapshots: [], todayLedgerActive: [], ledgerSettled: [],
                    orchestratorSettings: null, quotaSummary: null,
                    todayCostUsd: Number.NaN, sessionCostUsd: Number.NaN,
                    cliDays: [],
                    orchestratorPricingMode,
                    context: { globalState: state, extension: { packageJSON } },
                    ...extra,
                });
                refreshMonitorPanelLanguage();
                assert(html.trimStart().startsWith('<!DOCTYPE html>'), 'installed panel rendered HTML');
                return html;
            },
        };
    } finally {
        Module._load = originalLoad;
    }
}

function editorialFixtures(usage, specs, DailyStore, buildSummaryFromConversations, resetTime) {
    const now = new Date();
    const createdAt = now.toISOString();
    const earlierIso = new Date(now.getTime() - 12 * 60_000).toISOString();
    const expiredIso = new Date(now.getTime() - 60_000).toISOString();
    const workspaceUri = 'file:///example/workspaces/monitor';
    const otherWorkspaceUri = 'file:///example/workspaces/docs-site';
    const currentUsage = {
        ...usage,
        cascadeId: 'fixture',
        repositoryName: 'monitor',
        title: 'Review release changes',
        contextUsed: 214500,
        contextLimit: 512000,
        isEstimated: false,
        hasGaps: false,
        compressionDetected: false,
        previousContextUsed: undefined,
        checkpointCompressionDrop: 0,
        orchestratorConfig: {
            planModel: 'MODEL_PLACEHOLDER_M401',
            executionModel: 'MODEL_PLACEHOLDER_M528',
        },
    };
    const weeklyResetTime = new Date(now.getTime() + 5 * 24 * 3600_000).toISOString();
    const orchestratorSettingsDefault = {
        configuredOrchestratorModel: '',
        configuredExecutorModel: '',
        effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M535',
        effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
        effectiveOrchestratorLabel: 'Gemini 4 Neon (XHigh)',
        effectiveExecutorLabel: 'Gemini 4 Hydrogen (XHigh)',
        isCustomOrchestrator: false,
        isCustomExecutor: false,
        mode: 'default',
        roles: {
            orchestrators: ['gemini-4-neon', 'gemini-4-carbon', 'gemini-4-argon', 'claude-opus-5-5'],
            executors: ['gemini-4-hydrogen', 'claude-sonnet-5-5'],
        },
        orchestratorCandidates: ['MODEL_PLACEHOLDER_M535', 'MODEL_PLACEHOLDER_M401'],
        executorCandidates: ['MODEL_PLACEHOLDER_M528', 'MODEL_PLACEHOLDER_M404'],
        lastSelectedAgentModel: 'MODEL_PLACEHOLDER_M535',
    };
    const orchestratorSettingsCustom = {
        ...orchestratorSettingsDefault,
        configuredOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
        configuredExecutorModel: 'MODEL_PLACEHOLDER_M528',
        effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
        effectiveExecutorModel: 'MODEL_PLACEHOLDER_M528',
        effectiveOrchestratorLabel: 'Claude Opus 5.5 (Medium)',
        effectiveExecutorLabel: 'Gemini 4 Hydrogen (XHigh)',
        isCustomOrchestrator: true,
        isCustomExecutor: true,
        mode: 'custom',
    };
    const orchestratorSettingsCustomSonnet = {
        ...orchestratorSettingsDefault,
        configuredOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
        configuredExecutorModel: 'MODEL_PLACEHOLDER_M404',
        effectiveOrchestratorModel: 'MODEL_PLACEHOLDER_M401',
        effectiveExecutorModel: 'MODEL_PLACEHOLDER_M404',
        effectiveOrchestratorLabel: 'Claude Opus 5.5 (Medium)',
        effectiveExecutorLabel: 'Claude Sonnet 5.5 (Medium)',
        isCustomOrchestrator: true,
        isCustomExecutor: true,
        mode: 'custom',
    };
    const quotaSummary = {
        groups: [
            {
                pool: 'gemini',
                displayName: 'Gemini Models',
                fiveHour: {
                    bucketId: 'gemini-5h',
                    window: '5h',
                    displayName: 'Five Hour Limit Remaining',
                    remainingFraction: 0.52,
                    resetTime,
                    resetAt: Date.parse(resetTime),
                },
                weekly: {
                    bucketId: 'gemini-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 0.84,
                    resetTime: weeklyResetTime,
                    resetAt: Date.parse(weeklyResetTime),
                },
                buckets: [],
            },
            {
                pool: 'premium',
                displayName: 'Claude and GPT models',
                fiveHour: {
                    bucketId: '3p-5h',
                    window: '5h',
                    displayName: 'Five Hour Limit Remaining',
                    remainingFraction: 0.91,
                    resetTime,
                    resetAt: Date.parse(resetTime),
                },
                weekly: {
                    bucketId: '3p-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 0.96,
                    resetTime: weeklyResetTime,
                    resetAt: Date.parse(weeklyResetTime),
                },
                buckets: [],
            },
        ],
    };
    const quotaSummaryPrecision = {
        groups: [
            {
                pool: 'gemini',
                displayName: 'Gemini Models',
                fiveHour: {
                    bucketId: 'gemini-5h',
                    window: '5h',
                    displayName: 'Five Hour Limit Remaining',
                    remainingFraction: 0.9936607,
                    resetTime,
                    resetAt: Date.parse(resetTime),
                },
                weekly: {
                    bucketId: 'gemini-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 0.9984152,
                    resetTime: weeklyResetTime,
                    resetAt: Date.parse(weeklyResetTime),
                },
                buckets: [],
            },
            {
                pool: 'premium',
                displayName: 'Claude and GPT models',
                fiveHour: {
                    bucketId: '3p-5h',
                    window: '5h',
                    displayName: 'Five Hour Limit Remaining',
                    remainingFraction: 0.72,
                    resetTime,
                    resetAt: Date.parse(resetTime),
                },
                weekly: {
                    bucketId: '3p-weekly',
                    window: 'weekly',
                    displayName: 'Weekly Limit Remaining',
                    remainingFraction: 1,
                    resetTime: weeklyResetTime,
                    resetAt: Date.parse(weeklyResetTime),
                },
                buckets: [],
            },
        ],
    };
    const allTrajectories = [
        { id: currentUsage.cascadeId, title: currentUsage.title, model: specs[0], status: 'RUNNING', ws: workspaceUri, repo: 'monitor', branch: 'release', time: createdAt },
        { id: 'test-another-session', title: 'Check quota display', model: specs[1], status: 'IDLE', ws: workspaceUri, repo: 'monitor', branch: 'main', time: earlierIso },
        { id: 'test-other-workspace', title: 'Audit documentation links', model: specs[1], status: 'FINISHED', ws: otherWorkspaceUri, repo: 'docs-site', branch: 'docs', time: earlierIso },
    ].map(({ id, title, model, status, ws, repo, branch, time }) => ({
        cascadeId: id, summary: title, requestedModel: model.placeholderId, generatorModel: model.placeholderId,
        workspaceUris: [ws], gitRootUri: ws, repositoryName: repo, branchName: branch,
        status: `CASCADE_STATUS_${status}`, stepCount: 8, createdTime: time,
        lastModifiedTime: time, lastUserInputTime: time,
    }));
    // Realistic mixed cold + warm cached calls with thinking & visible output tokens:
    // Conv 0 (Orchestrator Neon, unpriced): 1 cold (2.15s TTFT) + 2 cached (0.80s / 0.76s TTFT)
    //   -> active cache hit 72.7% (2/3), TTFT -64% speedup, weighted 79.2 tok/s (resp 53.1 tok/s), latest 86.7 tok/s.
    // Conv 1 (Claude Opus 5.5, priced): 1 cold + cache write (2.25s TTFT) + 2 cached (0.79s / 0.77s TTFT)
    //   -> overall cache hit 70.9% (4/6), TTFT -65% speedup, weighted 74.7 tok/s (resp 50.1 tok/s), est. savings $0.22.
    const convCallProfiles = [
        [
            { inputTokens: 12000, outputTokens: 1120, thinkingTokens: 380, responseTokens: 740, cacheReadTokens: 0, cacheCreationTokens: 0, ttftSeconds: 2.15, streamingSeconds: 16.0, offsetMs: -90_000 },
            { inputTokens: 5500, outputTokens: 1320, thinkingTokens: 420, responseTokens: 900, cacheReadTokens: 28000, cacheCreationTokens: 0, ttftSeconds: 0.80, streamingSeconds: 16.5, offsetMs: -45_000 },
            { inputTokens: 5000, outputTokens: 1560, thinkingTokens: 520, responseTokens: 1040, cacheReadTokens: 32000, cacheCreationTokens: 0, ttftSeconds: 0.76, streamingSeconds: 18.0, offsetMs: 0 },
        ],
        [
            { inputTokens: 10000, outputTokens: 960, thinkingTokens: 320, responseTokens: 640, cacheReadTokens: 0, cacheCreationTokens: 6000, ttftSeconds: 2.25, streamingSeconds: 15.0, offsetMs: -12 * 60_000 },
            { inputTokens: 5200, outputTokens: 1120, thinkingTokens: 360, responseTokens: 760, cacheReadTokens: 28000, cacheCreationTokens: 0, ttftSeconds: 0.79, streamingSeconds: 16.0, offsetMs: -11 * 60_000 },
            { inputTokens: 4800, outputTokens: 1200, thinkingTokens: 400, responseTokens: 800, cacheReadTokens: 30000, cacheCreationTokens: 0, ttftSeconds: 0.77, streamingSeconds: 16.0, offsetMs: -10 * 60_000 },
        ],
    ];
    const gmSummary = buildSummaryFromConversations(allTrajectories.slice(0, 2).map((trajectory, index) => {
        const model = specs[index];
        const calls = convCallProfiles[index].map((profile, step) => {
            const hasRetry = index === 0 && step === 1;
            const callIso = new Date(now.getTime() + profile.offsetMs).toISOString();
            return {
                stepIndices: [step], executionId: `${trajectory.cascadeId}-${step}`, model: model.placeholderId,
                modelDisplay: model.displayName, responseModel: model.modelId, modelAccuracy: 'exact',
                inputTokens: profile.inputTokens, outputTokens: profile.outputTokens,
                thinkingTokens: profile.thinkingTokens, responseTokens: profile.responseTokens,
                cacheReadTokens: profile.cacheReadTokens, cacheCreationTokens: profile.cacheCreationTokens,
                apiProvider: model.apiProvider,
                ttftSeconds: profile.ttftSeconds, streamingSeconds: profile.streamingSeconds, credits: 2, creditType: 'AI',
                hasError: false, errorMessage: '', contextTokensUsed: 74000 + 3000 * step,
                completionConfig: {
                    maxTokens: 65536, temperature: 0.7, firstTemperature: 0.7,
                    topK: 40, topP: 0.95, numCompletions: 1, stopPatternCount: 2,
                },
                systemPromptSnippet: 'Studio telemetry monitor test prompt',
                toolCount: 3, toolNames: ['read_file', 'search', 'replace_file_content'],
                promptSectionTitles: ['Identity', 'Tools', 'Workspace'],
                promptSnippet: '', promptSource: 'messagePrompts',
                messagePromptCount: 2, messageMetadataKeys: [], responseHeaderKeys: [], userMessageAnchors: [],
                aiSnippetsByStep: {},
                retries: hasRetry ? 1 : 0,
                stopReason: 'STOP_REASON_END_TURN',
                retryTokensIn: hasRetry ? 1200 : 0,
                retryTokensOut: hasRetry ? 100 : 0,
                retryCredits: 0,
                retryErrors: hasRetry ? ['RESOURCE_EXHAUSTED (code 429): Rate limit exceeded; retrying automatically after backoff.'] : [],
                timeSinceLastInvocation: 0,
                tokenBreakdownGroups: index === 0 && step === 2 ? [
                    { name: 'System Prompt', type: 'TOKEN_TYPE_SYSTEM_PROMPT', tokens: 12000, children: [{ name: 'Tool Definitions', tokens: 8000 }] },
                    { name: 'Conversation', type: 'TOKEN_TYPE_CHAT_MESSAGES', tokens: 68000, children: [] },
                ] : [],
                createdAt: callIso, latestStableMessageIndex: 0, startStepIndex: step,
                checkpointIndex: 0, checkpointSummaries: [],
                systemContextItems: index === 0 && step === 2 ? [{
                    type: 'user_rules', stepIndex: step, tokens: 640,
                    label: 'User Rules', fullText: 'Prefer concise telemetry tables and strict contrast.',
                }] : [],
                accountEmail: 'sample@example.invalid',
                toolCallsByStep: { [step]: ['read_file'] },
                contextWindowCapacity: 512000,
            };
        });
        return {
            cascadeId: trajectory.cascadeId, title: trajectory.summary, totalSteps: trajectory.stepCount,
            calls, checkpointSummaries: [],
        };
    }), createdAt);
    gmSummary.toolCallCounts = { read_file: 5, search: 3, replace_file_content: 2 };
    gmSummary.toolCatalog = [
        { name: 'read_file', firstSeen: createdAt },
        { name: 'search', firstSeen: createdAt },
        { name: 'replace_file_content', firstSeen: createdAt },
    ];
    gmSummary.uniqueErrors = [
        {
            code: '429',
            message: 'RESOURCE_EXHAUSTED (code 429): Rate limit exceeded; retrying automatically after backoff.',
            firstSeen: createdAt,
            count: 1,
        },
    ];

    const activitySummary = {
        totalUserInputs: 1, totalReasoning: 2, totalToolCalls: 2, totalErrors: 0, totalCheckpoints: 0,
        totalInputTokens: 42500, totalOutputTokens: 7280, totalToolReturnTokens: 1400, estSteps: 0,
        modelStats: {}, globalToolStats: { read_file: 5, search: 3 },
        recentSteps: [
            {
                timestamp: earlierIso, icon: '💬', category: 'user', model: '',
                detail: 'Review release changes', durationMs: 0, cascadeId: currentUsage.cascadeId,
                userInput: 'Review release changes before packaging', stepIndex: 1,
            },
            {
                timestamp: createdAt, icon: '🧠', category: 'reasoning', model: specs[0].displayName,
                detail: 'Analyzed diff → 2 tools', durationMs: 18760, cascadeId: currentUsage.cascadeId,
                aiResponse: 'Checked quota pools and typography tokens.', stepIndex: 2,
                gmInputTokens: 5000, gmOutputTokens: 1560, gmThinkingTokens: 520, gmCacheReadTokens: 32000,
                gmCredits: 2, gmTTFT: 0.76, gmStreamingDuration: 18.0, gmRetries: 1,
                gmModel: specs[0].modelId, gmContextTokensUsed: 74000,
            },
            {
                timestamp: createdAt, icon: '📄', category: 'tool', model: specs[0].displayName,
                detail: 'src/webview-editorial-styles.ts', durationMs: 145, cascadeId: currentUsage.cascadeId,
                toolName: 'read_file', stepIndex: 3,
            },
        ],
        sessionStartTime: earlierIso, subAgentTokens: [], checkpointHistory: [], conversationBreakdown: [],
    };

    const dailyStore = new DailyStore();
    const dates = [...new Set([1, 3, 7, now.getDate()])];
    const records = Object.fromEntries(dates.map(day => {
        const date = new Date(now.getFullYear(), now.getMonth(), day, 12);
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const calls = 20 + day;
        const cycle = {
            startTime: date.toISOString(), endTime: date.toISOString(), totalReasoning: calls,
            totalToolCalls: 6, totalErrors: 0, totalInputTokens: 45000, totalOutputTokens: 10000,
            estSteps: 0, modelNames: [specs[1].displayName], estimatedCost: 0.22 + day / 100,
            gmTotalCalls: calls, gmTotalCredits: calls, gmTotalTokens: 55000,
            gmModelStats: {
                [specs[1].displayName]: {
                    calls, credits: calls, inputTokens: 45000,
                    outputTokens: 10000, thinkingTokens: 4000,
                    cacheReadTokens: 120000, cacheCreationTokens: 5000,
                    avgTTFT: 0.84, avgGenTokPerSec: 68.4,
                    cacheHitRate: 0.8, tokenCacheHitRate: 120000 / (45000 + 120000 + 5000),
                },
            },
        };
        return [dateKey, { date: dateKey, cycles: [cycle] }];
    }));
    dailyStore.restoreSnapshot({ version: 1, records });

    const storageDiagnostics = {
        stateFilePath: '/example/storage/antigravity-monitor-state.json',
        stateFileExists: true,
        stateFileSizeBytes: 18432,
        stateFileOpenWarnBytes: 1024 * 1024,
        calendarDayCount: dates.length,
    };

    const accountSnapshots = [
        {
            email: 'sample@example.invalid',
            name: 'Sample account',
            planName: 'Pro',
            tierName: 'Google AI Pro',
            earliestResetTime: resetTime,
            allResetTimes: [resetTime],
            resetPools: [
                { resetTime, modelLabels: ['Gemini 4 Neon', 'Orchestrator (Neon)'], remainingPercent: 52, hasUsage: true },
                { resetTime, modelLabels: ['Claude Opus 5.5'], remainingPercent: 91, hasUsage: true },
            ],
            isActive: true,
            lastSeen: createdAt,
            credits: [
                { creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: 1200 },
                { creditType: 'GOOGLE_ONE_AI', creditAmount: 1200 },
                { creditType: 'CREDIT_TYPE_PROMPT', creditAmount: 8765 },
                { creditType: 'CREDIT_TYPE_FLOW', creditAmount: 7654 },
            ],
        },
        {
            email: 'backup@example.invalid',
            name: 'Backup account',
            planName: 'Free',
            tierName: 'Free',
            earliestResetTime: expiredIso,
            allResetTimes: [expiredIso],
            resetPools: [
                { resetTime: expiredIso, modelLabels: ['Gemini 4 Neon'], remainingPercent: 100, hasUsage: true },
            ],
            isActive: false,
            lastSeen: earlierIso,
            credits: [{ creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: null }],
        },
    ];

    const userInfo = {
        name: 'Sample account', email: 'sample@example.invalid', planName: 'Pro',
        userTierName: 'Google AI Pro', defaultModelLabel: 'Orchestrator (Neon)', modelSortOrder: [],
        planLimits: {
            maxNumChatInputTokens: 512000, maxNumPremiumChatMessages: 100, maxCustomChatInstructionCharacters: 12000,
            maxNumPinnedContextItems: 25, maxLocalIndexSize: 4000, monthlyFlexCreditPurchaseAmount: 0,
        },
        teamConfig: { allowMcpServers: true, allowAutoRunCommands: false, allowBrowserExperimentalFeatures: false },
        availableCredits: [
            { creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: 1200, minimumCreditAmountForUsage: 0 },
            { creditType: 'GOOGLE_ONE_AI', creditAmount: 1200, minimumCreditAmountForUsage: 0 },
            { creditType: 'CREDIT_TYPE_PROMPT', creditAmount: 8765, minimumCreditAmountForUsage: 0 },
            { creditType: 'CREDIT_TYPE_FLOW', creditAmount: 7654, minimumCreditAmountForUsage: 0 },
        ],
        monthlyPromptCredits: 100, availablePromptCredits: 76, monthlyFlowCredits: 100, availableFlowCredits: 82,
    };

    const unknownCreditsUserInfo = {
        ...userInfo,
        availableCredits: [
            { creditType: 'CREDIT_TYPE_PROMPT', creditAmount: 8765, minimumCreditAmountForUsage: 0 },
            { creditType: 'CREDIT_TYPE_FLOW', creditAmount: 7654, minimumCreditAmountForUsage: 0 },
        ],
    };

    return {
        populated: {
            currentUsage, userInfo, allTrajectories, activitySummary,
            gmSummary, gmFullSummary: gmSummary, dailyStore, workspaceUri,
            storageDiagnostics, accountSnapshots,
            orchestratorSettings: orchestratorSettingsCustom,
            quotaSummary,
            sessionCostUsd: 0.45,
            todayCostUsd: 1.25,
        },
        unknownCredits: {
            currentUsage: { ...currentUsage, orchestratorConfig: undefined },
            userInfo: unknownCreditsUserInfo, allTrajectories: [],
            activitySummary: null, gmSummary: null, gmFullSummary: null,
            dailyStore: new DailyStore(), workspaceUri,
            orchestratorSettings: null, quotaSummary: null,
            accountSnapshots: [{ ...accountSnapshots[0], credits: [{ creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: null }] }],
        },
        empty: {
            allTrajectories: [], activitySummary: null, gmSummary: null, gmFullSummary: null,
            dailyStore: new DailyStore(), accountSnapshots: [],
            orchestratorSettings: null, quotaSummary: null,
        },
        v1173: {
            orchestratorSettingsDefault,
            orchestratorSettingsCustom,
            orchestratorSettingsCustomSonnet,
            quotaSummary,
            quotaSummaryPrecision,
        },
    };
}

function browserFixture(html, theme, t) {
    const tokens = `<style>:root {
        --vscode-editor-background:${t.background};
        --vscode-sideBar-background:${t.sideBar};
        --vscode-editorWidget-background:${t.widget};
        --vscode-foreground:${t.text};
        --vscode-editor-foreground:${t.text};
        --vscode-descriptionForeground:${t.description};
        --vscode-disabledForeground:${t.disabled};
        --vscode-panel-border:${t.border};
        --vscode-widget-border:${t.border};
        --vscode-contrastBorder:${t.contrastBorder};
        --vscode-focusBorder:${t.focusBorder};
        --vscode-font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        --vscode-font-size:13px;
        --vscode-editor-font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
        --vscode-button-background:${t.accent};
        --vscode-button-foreground:${t.accentText};
        --vscode-button-hoverBackground:${t.accentHover};
        --vscode-button-secondaryBackground:${t.secondaryBg};
        --vscode-button-secondaryForeground:${t.secondaryText};
        --vscode-button-secondaryHoverBackground:${t.secondaryHover};
        --vscode-input-background:${t.inputBg};
        --vscode-input-foreground:${t.inputText};
        --vscode-input-border:${t.inputBorder};
        --vscode-input-placeholderForeground:${t.placeholder};
        --vscode-dropdown-background:${t.inputBg};
        --vscode-dropdown-foreground:${t.inputText};
        --vscode-dropdown-border:${t.inputBorder};
        --vscode-badge-background:${t.badgeBg};
        --vscode-badge-foreground:${t.badgeText};
        --vscode-list-hoverBackground:${t.hoverBg};
        --vscode-list-activeSelectionBackground:${t.activeBg};
        --vscode-list-activeSelectionForeground:${t.activeText};
        --vscode-textLink-foreground:${t.accent};
        --vscode-textLink-activeForeground:${t.accentHover};
        --vscode-progressBar-background:${t.accent};
        --vscode-testing-iconPassed:${t.ok};
        --vscode-editorWarning-foreground:${t.warn};
        --vscode-errorForeground:${t.error};
        --vscode-charts-blue:${t.chartBlue};
        --vscode-charts-green:${t.chartGreen};
        --vscode-charts-yellow:${t.chartYellow};
        --vscode-charts-red:${t.chartRed};
        --vscode-charts-purple:${t.chartPurple};
        --vscode-scrollbarSlider-background:${t.scrollbar};
        --vscode-scrollbarSlider-hoverBackground:${t.scrollbarHover};
    }</style>`;
    const bridge = `<script>
        window.testState = { errors: [], messages: [], clipboard: [], ui: { activeTab: 'overview' }, paused: false };
        window.addEventListener('error', event => testState.errors.push(event.message || 'error'));
        window.addEventListener('unhandledrejection', event => testState.errors.push(String(event.reason || 'unhandledrejection')));
        try {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: text => { testState.clipboard.push(String(text)); return Promise.resolve(); } },
            });
        } catch { /* fallback if clipboard is non-configurable */ }
        window.acquireVsCodeApi = () => ({
            getState: () => testState.ui, setState: value => { testState.ui = value; },
            postMessage: msg => {
                testState.messages.push(msg);
                if (msg.command === 'togglePause') {
                    testState.paused = !testState.paused;
                    window.dispatchEvent(new MessageEvent('message', { data: { command: 'setPaused', paused: testState.paused } }));
                }
            }
        });
    </script>`;
    const withHead = html.replace('</head>', `${tokens}${bridge}</head>`);
    const themed = withHead.replace('<body ', `<body class="${theme}" data-vscode-theme-kind="${theme}" `);
    assert(themed !== withHead, 'browserFixture applied theme class and data-vscode-theme-kind to <body>');
    return themed;
}

const measurements = `(() => {
    const cards = [...document.querySelectorAll('.spec-card')];
    const header = [...document.querySelectorAll('.topbar-title h1,#acctPopoverTrigger,.lang-switcher,#pauseBtn,#refreshBtn,.update-time')];
    const overlaps = header.some((node, index) => {
        const a = node.getBoundingClientRect();
        return header.slice(index + 1).some(sibling => {
            const b = sibling.getBoundingClientRect();
            return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        });
    });
    return {
        heading: document.querySelector('.topbar-title h1')?.textContent.replace(/\\s+/g, ' ').trim(),
        modelInfo: document.querySelector('.model-info-section h2')?.textContent.replace(/\\s+/g, ' ').trim(),
        width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 ||
            [...document.querySelectorAll('#tab-models .spec-card, #tab-models .model-card, #tab-models .orch-settings-card')].some(card => card.getBoundingClientRect().right > innerWidth + 1),
        overlaps, errors: testState.errors,
        orchSettings: (() => {
            const card = document.querySelector('#tab-models .orch-settings-card');
            if (!card) { return null; }
            return {
                mode: card.dataset.orchestratorMode || '',
                text: card.innerText.replace(/\\s+/g, ' ').trim(),
                orchestrator: card.querySelector('[data-orch-role="orchestrator"]')?.innerText.replace(/\\s+/g, ' ').trim() || '',
                executor: card.querySelector('[data-orch-role="executor"]')?.innerText.replace(/\\s+/g, ' ').trim() || '',
            };
        })(),
        entries: cards.map(card => ({
            model: card.dataset.modelId, name: card.querySelector('h3').textContent,
            catalog: card.querySelector('.spec-model-id').textContent,
            limits: Object.fromEntries([...card.querySelectorAll('[data-metric]')].map(row => [row.dataset.metric, row.querySelector('dd').textContent])),
            priceState: card.querySelector('.spec-price-row')?.dataset.priceState || '',
            priceText: card.querySelector('.spec-price-row')?.innerText.replace(/\\s+/g, ' ').trim() || '',
            route: card.querySelector('.spec-orchestration')?.textContent,
        })),
        pools: [...document.querySelectorAll('.model-card')].map(card => ({
            group: card.querySelector('.model-card-name-text')?.textContent,
            members: [...card.querySelectorAll('.model-quota-members li')].map(row => row.innerText),
            range: card.querySelector('.model-card-pct')?.textContent,
            noticeTags: [...card.querySelectorAll('.tag-notice')].map(el => el.innerText.trim()),
            dualWindows: Object.fromEntries([...card.querySelectorAll('.quota-dual-item[data-quota-window]')].map(el => [
                el.dataset.quotaWindow,
                el.querySelector('.quota-dual-pct')?.innerText.trim() || '',
            ])),
        })),
    };
})()`;

function editorialReadings() {
    const pane = document.querySelector('#monitor-content .tab-pane.active');
    const tab = document.querySelector('#tabBar .tab-btn.active');
    const masthead = document.querySelector('.panel-topbar');
    const topbarTitle = document.querySelector('.topbar-title');
    const tabBarWrap = document.querySelector('.tab-bar-wrapper');
    const logo = document.querySelector('.topbar-title h1');
    const visible = node => node.checkVisibility() && Boolean((node.innerText || '').trim());
    const headings = [...pane.querySelectorAll('h2, h3, .empty-msg, .empty-desc')].filter(visible);
    const readable = headings[0] || [...pane.children].find(visible);
    const box = readable?.getBoundingClientRect();
    const style = readable && getComputedStyle(readable);
    const mastheadRect = masthead.getBoundingClientRect();
    const controls = [...document.querySelectorAll('.topbar-title h1,#acctPopoverTrigger,.lang-switcher,#pauseBtn,#refreshBtn,.update-time')]
        .filter(node => node.checkVisibility());
    const outOfBounds = node => {
        const bounds = node.getBoundingClientRect();
        return bounds.width > 0 && (bounds.left < -1 || bounds.right > innerWidth + 1);
    };
    const isInsideScrollWrap = node => {
        if (node.tagName !== 'TABLE') { return false; }
        const wrap = node.closest('.recent-calls-table-wrap');
        if (!wrap) { return false; }
        const ox = getComputedStyle(wrap).overflowX;
        return ox === 'auto' || ox === 'scroll';
    };
    const rectsOverlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const overlapping = controls.some((a, index) => controls.slice(index + 1).some(b =>
        rectsOverlap(a.getBoundingClientRect(), b.getBoundingClientRect())));
    const topbarRowOverlap = Boolean(topbarTitle && tabBarWrap
        && topbarTitle.getBoundingClientRect().bottom > tabBarWrap.getBoundingClientRect().top + 1);
    const stickyHeaderOverlap = topbarRowOverlap
        || (window.scrollY <= 1 && Boolean(box && box.top < mastheadRect.bottom - 1));

    const regionSelectors = [
        'section', 'h2', 'h3', 'table', 'pre',
        '.stg-card', '.cost-bar-row', '.cost-bar-track', '.cost-bar-section', '.cost-chips',
        '.prc-monthly-card', '.prc-monthly-models', '.prc-edit-row', '.rate-change-banner',
        '.cal-grid', '.cal-cell', '.cal-detail', '.cal-overview-grid', '.cal-chip-speed',
        '.ses-row', '.ses-shortcuts', '.ses-filters', '.ses-filter-btn', '.ses-group',
        '.model-card', '.spec-card', '.orch-settings-card', '.orch-role-row', '.spec-price-row', '.quota-dual-row',
        '.profile-page', '.profile-identity', '.profile-quota', '.profile-ai', '.profile-technical',
        '.act-summary-bar', '#telemetryLedgerSection', '.telemetry-ledger-card', '.telemetry-subgrid',
        '.telemetry-ttft-block', '.telemetry-cache-bar-wrap', '.recent-calls-card', '.recent-calls-table-wrap',
        '.act-model-card', '.act-conv-list', '.act-conv-item', '.tool-rank-row',
        '.about-card', '.about-info-box', '.about-platform-chips', '.about-platform-chip',
        '.overview-context', '.orch-route-pill', '.overview-telemetry-strip', '.overview-quota', '.overview-footer', '.zoom-presets',
    ].join(', ');
    const overflowingRegions = [...pane.querySelectorAll(regionSelectors)]
        .filter(node => node.checkVisibility() && !isInsideScrollWrap(node) && outOfBounds(node))
        .slice(0, 6)
        .map(node => `${node.tagName.toLowerCase()}.${(node.className || '').toString().trim().replace(/\s+/g, '.')}`);

    const rootStyle = getComputedStyle(document.body);
    const resolveCssColor = cssValue => {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;background-color:' + cssValue;
        document.body.appendChild(probe);
        const computed = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return computed;
    };
    const parseRgba = str => {
        const m = (str || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/);
        if (!m) { return null; }
        return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
    };
    const compositeOver = (fg, bg) => {
        const a = fg[3];
        if (a >= 1) { return [fg[0], fg[1], fg[2]]; }
        return [
            Math.round(fg[0] * a + bg[0] * (1 - a)),
            Math.round(fg[1] * a + bg[1] * (1 - a)),
            Math.round(fg[2] * a + bg[2] * (1 - a)),
        ];
    };
    const luminance = ([r, g, b]) => {
        const lin = c => {
            const s = c / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const contrastRatio = (fgStr, bgStr) => {
        const bgRaw = parseRgba(bgStr);
        const fgRaw = parseRgba(fgStr);
        if (!fgRaw || !bgRaw) { return null; }
        const bg = [bgRaw[0], bgRaw[1], bgRaw[2]];
        const fg = compositeOver(fgRaw, bg);
        const l1 = luminance(fg);
        const l2 = luminance(bg);
        return Number(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2));
    };

    const resolvedTokens = {
        bg: resolveCssColor('var(--ed-bg)'),
        surface: resolveCssColor('var(--ed-surface)'),
        surfaceWell: resolveCssColor('var(--ed-surface-well)'),
        track: resolveCssColor('var(--ed-track)'),
        controlBorder: resolveCssColor('var(--ed-control-border)'),
        accent: resolveCssColor('var(--ed-accent)'),
        accentTrack: resolveCssColor('var(--ed-accent-track)'),
        goodFill: resolveCssColor('var(--ed-good-fill)'),
        warnFill: resolveCssColor('var(--ed-warn-fill)'),
        dangerFill: resolveCssColor('var(--ed-danger-fill)'),
        chartInput: resolveCssColor('var(--ed-chart-input)'),
        chartOutput: resolveCssColor('var(--ed-chart-output)'),
        chartCache: resolveCssColor('var(--ed-chart-cache)'),
        chartThinking: resolveCssColor('var(--ed-chart-thinking)'),
    };
    const nonTextContrasts = {
        controlBorderOnSurface: contrastRatio(resolvedTokens.controlBorder, resolvedTokens.surface),
        accentOnBg: contrastRatio(resolvedTokens.accent, resolvedTokens.bg),
        accentOnSurface: contrastRatio(resolvedTokens.accent, resolvedTokens.surface),
        accentTrackOnSurface: contrastRatio(resolvedTokens.accentTrack, resolvedTokens.surface),
        whiteThumbOnAccentTrack: contrastRatio('rgb(255, 255, 255)', resolvedTokens.accentTrack),
        goodFillOnTrack: contrastRatio(resolvedTokens.goodFill, resolvedTokens.track),
        warnFillOnTrack: contrastRatio(resolvedTokens.warnFill, resolvedTokens.track),
        dangerFillOnTrack: contrastRatio(resolvedTokens.dangerFill, resolvedTokens.track),
        accentOnTrack: contrastRatio(resolvedTokens.accent, resolvedTokens.track),
        chartInputOnSurface: contrastRatio(resolvedTokens.chartInput, resolvedTokens.surface),
        chartOutputOnSurface: contrastRatio(resolvedTokens.chartOutput, resolvedTokens.surface),
        chartCacheOnSurface: contrastRatio(resolvedTokens.chartCache, resolvedTokens.surface),
        chartThinkingOnSurface: contrastRatio(resolvedTokens.chartThinking, resolvedTokens.surface),
    };

    const l1CardSelector = [
        '.overview-context', '.overview-quota', '.act-summary-bar', '.telemetry-ledger-card', '.recent-calls-card', '.act-model-card',
        '.ses-group', '.prc-monthly-grand', '.cost-panel', '.prc-edit-section',
        '.model-card', '.spec-card', '.orch-settings-card', '.cal-detail',
        '.profile-identity', '.profile-quota', '.profile-ai', '.profile-technical',
        '.stg-card', '.about-card', '.about-info-box', 'section.card',
    ].join(', ');
    const l1CardSurfaces = [...pane.querySelectorAll(l1CardSelector)]
        .filter(node => node.checkVisibility() && !(node.matches('.model-card') && node.closest('.profile-quota')))
        .map(node => ({ selector: (node.className || node.tagName).toString().trim(), bg: getComputedStyle(node).backgroundColor }))
        .filter(({ bg }) => {
            const parsed = parseRgba(bg);
            return parsed && parsed[3] > 0.9;
        })
        .slice(0, 14);
    const l2WellSurfaces = [...pane.querySelectorAll('.overview-telemetry-strip, .telemetry-subgrid, .orch-role-row, .spec-price-row, .profile-quota .model-card, .profile-credit-balances, .storage-path-box')]
        .filter(node => node.checkVisibility())
        .map(node => ({ selector: (node.className || node.tagName).toString().trim(), bg: getComputedStyle(node).backgroundColor }))
        .filter(({ bg }) => {
            const parsed = parseRgba(bg);
            return parsed && parsed[3] > 0.9;
        })
        .slice(0, 8);

    const requiredTokenNames = [
        '--ed-bg', '--ed-surface', '--ed-surface-well', '--ed-ink', '--ed-ink-secondary', '--ed-ink-muted',
        '--ed-accent', '--ed-border', '--ed-border-strong', '--ed-control-border',
        '--ed-display-latin', '--ed-sans', '--ed-sans-cjk', '--ed-mono',
    ];
    const designTokens = Object.fromEntries(requiredTokenNames.map(name => [name, rootStyle.getPropertyValue(name).trim()]));

    const displayHeadings = [...pane.querySelectorAll('.overview-header h2, .ed-pane-title, .about-hero-title, .profile-identity h2')]
        .filter(node => node.checkVisibility());
    const fontStacks = [
        designTokens['--ed-display-latin'],
        designTokens['--ed-sans'],
        designTokens['--ed-sans-cjk'],
        rootStyle.fontFamily,
        getComputedStyle(logo).fontFamily,
        ...displayHeadings.map(node => getComputedStyle(node).fontFamily),
    ].filter(Boolean);
    const hasGenericSerifFallback = fontStacks.some(stack => /(?:^|,)\s*serif\s*(?:,|$)/i.test(stack));
    const hasSongtiFallback = fontStacks.some(stack => /songti|simsun|nsimsun|fangsong|stsong/i.test(stack));

    const visibleBiEn = [...document.querySelectorAll('.panel-topbar .bi-en, #monitor-content .tab-pane.active .bi-en')]
        .filter(node => node.checkVisibility());
    const visibleBiZh = [...document.querySelectorAll('.panel-topbar .bi-zh, #monitor-content .tab-pane.active .bi-zh')]
        .filter(node => node.checkVisibility());
    const visibleBiSep = [...document.querySelectorAll('.panel-topbar .bi-sep, #monitor-content .tab-pane.active .bi-sep')]
        .filter(node => node.checkVisibility());
    const biZhHasForbiddenSerif = visibleBiZh.slice(0, 8).some(node => {
        const ff = getComputedStyle(node).fontFamily;
        return /(?:^|,)\s*serif\s*(?:,|$)/i.test(ff) || /songti|simsun|nsimsun|fangsong|stsong/i.test(ff);
    });

    const popoverText = document.getElementById('acctPopoverBody')?.textContent || '';
    const fullVisibleText = `${masthead.innerText}\n${pane.innerText}`;
    const normalizedText = `${masthead.textContent || ''} ${pane.textContent || ''} ${popoverText}`
        .replace(/file:\/\/\S+|https?:\/\/\S+|\/(?:example|Users|home|var|tmp)\/\S+/g, ' ')
        .replace(/\s+/g, ' ');
    const attrCopy = [...document.querySelectorAll('.panel-topbar [aria-label], .panel-topbar [title], .panel-topbar [data-tooltip], #monitor-content .tab-pane.active [aria-label], #monitor-content .tab-pane.active [title], #monitor-content .tab-pane.active [placeholder], #monitor-content .tab-pane.active [data-tooltip]')]
        .map(el => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'), el.getAttribute('data-tooltip')].filter(Boolean).join(' '))
        .join('\n');

    const brokenBilingualPatterns = [
        ['broken-turn', /\bTurn\s*\/\s*第\s*\d+\s*\/\s*轮/],
        ['eoc-dashes', /[—–-]\s*(?:End of content|已到底)\s*[—–-]/],
        ['expiry-missing-num', /\d+d until expiry\s*\/\s*天后到期/],
        ['empty-month-zh-in-en', /No data for \d{4}年\d+月/],
        ['timeline-triple-slash', /\bin\s*\/\s*输入\s*\/\s*\S+\s+out\s*\/\s*输出/],
        ['stale-about-copy', /80K[–-]256K|model API configuration details/i],
        ['doubled-slash', /\s\/\s+\/\s/],
    ];
    const brokenBilingualMatches = brokenBilingualPatterns
        .filter(([, re]) => re.test(normalizedText))
        .map(([label]) => label);
    const hasEmptyBilingualSpan = [...visibleBiEn, ...visibleBiZh].some(node => !(node.textContent || '').trim());
    if (hasEmptyBilingualSpan) { brokenBilingualMatches.push('empty-bilingual-span'); }

    const sessionBadges = tab?.dataset.tab === 'chats'
        ? [...pane.querySelectorAll('.ses-badge')].filter(node => node.checkVisibility()).map(node => node.innerText.trim())
        : [];

    const gluedUnitScanText = fullVisibleText
        .replace(/file:\/\/\S+|https?:\/\/\S+|\/(?:example|Users|home|var|tmp)\/\S+/g, ' ');
    const gluedUnitMatches = [...gluedUnitScanText.matchAll(/\b\d+(?:\.\d+)?(?:tok\/s|credits|tools|calls|cache|in|out)\b/g)]
        .map(m => m[0])
        .slice(0, 8);

    const checkBiColorInherit = root => {
        if (!root) { return true; }
        const parentColor = getComputedStyle(root).color;
        const spans = [...root.querySelectorAll('.bi-sep, .bi-zh')].filter(node => node.checkVisibility());
        return spans.every(span => getComputedStyle(span).color === parentColor);
    };

    const overviewStrip = tab?.dataset.tab === 'overview'
        ? pane.querySelector('.overview-telemetry-strip')
        : null;
    const overviewCells = overviewStrip ? [...overviewStrip.querySelectorAll('.overview-telemetry-cell')] : [];
    const overviewWarmEl = overviewStrip?.querySelector('.overview-telemetry-sub.is-warm, .overview-telemetry-sub.is-warming, .overview-telemetry-sub.is-cold');
    const overviewCostCell = overviewStrip?.querySelector('[data-telemetry-cell="cost"]');
    const overviewOrchPill = tab?.dataset.tab === 'overview' ? pane.querySelector('.orch-route-pill') : null;
    const overviewTelemetry = tab?.dataset.tab === 'overview' ? {
        present: Boolean(overviewStrip && overviewStrip.checkVisibility()),
        scope: overviewStrip?.dataset.telemetryScope || '',
        cellCount: overviewCells.length,
        bg: overviewStrip ? getComputedStyle(overviewStrip).backgroundColor : '',
        text: overviewStrip?.innerText || '',
        hasFakeZeroUsd: /\$0\.00\b/.test(overviewStrip?.innerText || ''),
        speedVal: overviewCells[0]?.querySelector('.overview-telemetry-value')?.innerText.trim() || '',
        speedSub: overviewCells[0]?.querySelector('.overview-telemetry-sub')?.innerText.trim() || '',
        ttftVal: overviewCells[1]?.querySelector('.overview-telemetry-value')?.innerText.trim() || '',
        ttftSub: overviewCells[1]?.querySelector('.overview-telemetry-sub')?.innerText.trim() || '',
        cacheHitVal: overviewCells[2]?.querySelector('.overview-telemetry-value')?.innerText.trim() || '',
        cacheHitHasTone: Boolean(overviewCells[2]?.querySelector('.overview-telemetry-value.is-cache')),
        cacheHitColor: overviewCells[2]?.querySelector('.overview-telemetry-value.is-cache')
            ? getComputedStyle(overviewCells[2].querySelector('.overview-telemetry-value.is-cache')).color : '',
        cacheHitSub: overviewCells[2]?.querySelector('.overview-telemetry-sub')?.innerText.trim() || '',
        savedVal: overviewCells[3]?.querySelector('.overview-telemetry-value')?.innerText.trim() || '',
        costVal: overviewCostCell?.querySelector('.overview-telemetry-value')?.innerText.trim() || '',
        costSub: overviewCostCell?.querySelector('.overview-telemetry-sub')?.innerText.trim() || '',
        warmthClass: overviewWarmEl?.className || '',
        warmthText: overviewWarmEl?.innerText.trim() || '',
        warmthBiInherits: checkBiColorInherit(overviewWarmEl),
        orchRoutePresent: Boolean(overviewOrchPill && overviewOrchPill.checkVisibility()),
        orchRouteCrossPool: overviewOrchPill?.dataset.crossPool || '',
        orchRouteText: overviewOrchPill?.innerText.replace(/\s+/g, ' ').trim() || '',
        dualQuotaRows: pane.querySelectorAll('.quota-dual-row').length,
        dualQuota5h: [...pane.querySelectorAll('.quota-dual-item[data-quota-window="5h"] .quota-dual-pct')].map(n => n.innerText.trim()),
        dualQuotaWeekly: [...pane.querySelectorAll('.quota-dual-item[data-quota-window="weekly"] .quota-dual-pct')].map(n => n.innerText.trim()),
    } : null;

    const ledgerSection = tab?.dataset.tab === 'gmdata'
        ? pane.querySelector('#telemetryLedgerSection')
        : null;
    const recentCallsEl = tab?.dataset.tab === 'gmdata'
        ? pane.querySelector('#recentCallsLedger')
        : null;
    const recentCallsWrap = recentCallsEl?.querySelector('.recent-calls-table-wrap');
    const opaqueTelemetryBackingSelectors = [
        '.telemetry-warmth-badge', '.telemetry-delta-pill',
        '.act-tl-gm-speed', '.act-tl-gm-stream', '.act-tl-gm-cache-hit',
        '.seg-chip-speed', '.seg-chip-ttft', '.seg-chip-cache-hit',
    ].join(', ');
    const gmTelemetry = tab?.dataset.tab === 'gmdata' ? {
        ledgerPresent: Boolean(ledgerSection && ledgerSection.checkVisibility()),
        recentCallsPresent: Boolean(recentCallsEl && recentCallsEl.checkVisibility()),
        recentCallsOpen: Boolean(recentCallsEl?.open),
        recentCallsRows: recentCallsEl ? recentCallsEl.querySelectorAll('tbody tr').length : 0,
        recentCallsUnpricedCount: recentCallsEl ? recentCallsEl.querySelectorAll('.rc-unpriced').length : 0,
        recentCallsPricedCount: recentCallsEl ? recentCallsEl.querySelectorAll('.rc-cost-val').length : 0,
        recentCallsWrapFits: recentCallsWrap ? recentCallsWrap.getBoundingClientRect().right <= innerWidth + 1 : true,
        kpiSpeed: pane.querySelector('.act-stat-speed')?.innerText.replace(/\s+/g, ' ').trim() || '',
        kpiTtft: pane.querySelector('.act-stat-ttft')?.innerText.replace(/\s+/g, ' ').trim() || '',
        kpiCacheHit: pane.querySelector('.act-stat-cache-hit')?.innerText.replace(/\s+/g, ' ').trim() || '',
        speedHero: ledgerSection?.querySelector('.telemetry-card-speed .telemetry-hero-val')?.innerText.trim() || '',
        speedSubText: ledgerSection?.querySelector('.telemetry-card-speed .telemetry-subgrid')?.innerText.replace(/\s+/g, ' ').trim() || '',
        ttftTrackCount: ledgerSection ? ledgerSection.querySelectorAll('.telemetry-bar-track').length : 0,
        hasCachedBar: Boolean(ledgerSection?.querySelector('.telemetry-bar-fill-cache')),
        hasUncachedBar: Boolean(ledgerSection?.querySelector('.telemetry-bar-fill-uncached')),
        ttftDeltaText: ledgerSection?.querySelector('.telemetry-delta-pill')?.innerText.trim() || '',
        ttftDeltaFaster: Boolean(ledgerSection?.querySelector('.telemetry-delta-pill.is-faster')),
        cacheHero: ledgerSection?.querySelector('.telemetry-card-cache .telemetry-hero-val')?.innerText.trim() || '',
        cacheHeroHasTone: Boolean(ledgerSection?.querySelector('.telemetry-card-cache .telemetry-hero-val.is-cache')),
        warmthText: ledgerSection?.querySelector('.telemetry-warmth-badge')?.innerText.trim() || '',
        warmthIsWarm: Boolean(ledgerSection?.querySelector('.telemetry-warmth-badge.is-warm')),
        cacheSegRead: Boolean(ledgerSection?.querySelector('.telemetry-cache-seg-read')),
        cacheSegFresh: Boolean(ledgerSection?.querySelector('.telemetry-cache-seg-fresh')),
        cacheSegWrite: Boolean(ledgerSection?.querySelector('.telemetry-cache-seg-write')),
        ledgerText: ledgerSection?.innerText || '',
        hasFakeZeroUsd: /\$0\.00\b/.test(ledgerSection?.innerText || ''),
        modelCards: [...pane.querySelectorAll('.act-model-card')].map(card => ({
            name: card.querySelector('.act-card-header')?.innerText.trim() || '',
            speed: card.querySelector('.val-speed')?.innerText.replace(/\s+/g, ' ').trim() || '',
            ttft: card.querySelector('.val-time')?.innerText.replace(/\s+/g, ' ').trim() || '',
            cacheHit: card.querySelector('.val-hit')?.innerText.replace(/\s+/g, ' ').trim() || '',
            cacheHitColor: card.querySelector('.val-hit') ? getComputedStyle(card.querySelector('.val-hit')).color : '',
        })),
        stepSpeedPill: pane.querySelector('.act-timeline .act-tl-gm-speed')?.innerText.trim() || '',
        stepStreamPill: pane.querySelector('.act-timeline .act-tl-gm-stream')?.innerText.replace(/\s+/g, ' ').trim() || '',
        stepCacheHitPill: pane.querySelector('.act-timeline .act-tl-gm-cache-hit')?.innerText.replace(/\s+/g, ' ').trim() || '',
        turnSpeedChip: pane.querySelector('.act-timeline .seg-chip-speed')?.innerText.trim() || '',
        turnTtftChip: pane.querySelector('.act-timeline .seg-chip-ttft')?.innerText.trim() || '',
        turnCacheHitChip: pane.querySelector('.act-timeline .seg-chip-cache-hit')?.innerText.replace(/\s+/g, ' ').trim() || '',
        trackOutlines: ledgerSection
            ? [...ledgerSection.querySelectorAll('.telemetry-bar-track, .telemetry-cache-bar-track')].map(el => {
                const cs = getComputedStyle(el);
                return { cls: el.className, style: cs.outlineStyle, width: cs.outlineWidth };
            })
            : [],
        opaqueBackings: [...pane.querySelectorAll(opaqueTelemetryBackingSelectors)]
            .filter(node => node.checkVisibility())
            .map(node => ({
                cls: node.className,
                bg: getComputedStyle(node).backgroundColor,
                biInherits: checkBiColorInherit(node),
            })),
    } : null;

    const modelsTelemetry = tab?.dataset.tab === 'models' ? {
        orchCardPresent: Boolean(pane.querySelector('.orch-settings-card')?.checkVisibility()),
        orchMode: pane.querySelector('.orch-settings-card')?.dataset.orchestratorMode || '',
        noticeTags: [...pane.querySelectorAll('.tag-notice')].map(n => n.innerText.trim()),
        pricedSpecCount: pane.querySelectorAll('.spec-price-row[data-price-state="priced"]').length,
        mappedSpecCount: pane.querySelectorAll('.spec-price-row[data-price-state="mapped"]').length,
        unpricedSpecCount: pane.querySelectorAll('.spec-price-row[data-price-state="unpriced"]').length,
        dualQuotaRows: pane.querySelectorAll('.quota-dual-row').length,
    } : null;

    const pricingTelemetry = tab?.dataset.tab === 'pricing' ? {
        hasCurrencyBar: Boolean(pane.querySelector('.prc-currency-bar, .currency-btn, #pricingFxRateInput')),
        hasCnyOrYen: /\bCNY\b|¥|人民币|汇率/.test(pane.innerText || ''),
        hasUsdAmount: /\$\d/.test(pane.innerText || ''),
        hasOrchPricingToggle: Boolean(pane.querySelector('#orchPricingModeMapped') && pane.querySelector('#orchPricingModeStrict')),
        rateChangeBannerText: pane.querySelector('.rate-change-banner')?.innerText.replace(/\s+/g, ' ').trim() || '',
    } : null;

    const aboutTelemetry = tab?.dataset.tab === 'about' ? {
        versionPill: pane.querySelector('.about-version-pill')?.innerText.trim() || '',
        text: pane.innerText || '',
    } : null;

    return {
        tab: tab?.dataset.tab,
        pane: pane.id,
        soleCurrentTab: document.querySelectorAll('#tabBar [aria-current="page"]').length === 1
            && tab?.getAttribute('aria-current') === 'page',
        readable: readable?.innerText.trim().slice(0, 110) || '',
        headlineFits: Boolean(box && !outOfBounds(readable) && box.bottom > mastheadRect.bottom
            && box.top < innerHeight && parseFloat(style.fontSize) >= 11),
        overflow: document.documentElement.scrollWidth > innerWidth + 1 || outOfBounds(pane) || controls.some(outOfBounds),
        overflowingRegions,
        overlapping,
        stickyHeaderOverlap,
        editorial: document.body.dataset.editorial === 'true',
        bodyLang: document.body.dataset.lang,
        bodyThemeKind: document.body.getAttribute('data-vscode-theme-kind'),
        designTokens,
        hasGenericSerifFallback,
        hasSongtiFallback,
        bilingual: {
            enCount: visibleBiEn.length,
            zhCount: visibleBiZh.length,
            sepCount: visibleBiSep.length,
            zhHasForbiddenSerif: biZhHasForbiddenSerif,
        },
        mastheadFont: getComputedStyle(logo).fontFamily,
        mastheadFontSize: parseFloat(getComputedStyle(logo).fontSize),
        pageSurface: rootStyle.backgroundColor,
        colorScheme: rootStyle.colorScheme,
        mastheadBackground: getComputedStyle(masthead).backgroundColor,
        resolvedTokens,
        l1CardSurfaces,
        l2WellSurfaces,
        nonTextContrasts,
        navShadow: getComputedStyle(document.querySelector('#tabBar')).boxShadow,
        chromeAccentSize: parseFloat(getComputedStyle(document.querySelector('#tabBar .tab-slider')).height),
        missingNumeric: /(?:^|\s)(?:NaN|Infinity|Invalid Date)(?:\s|$)/.test(pane.innerText),
        hasLingpai: /令牌/.test(`${fullVisibleText}\n${popoverText}\n${attrCopy}`),
        hasCnyOrYen: /\bCNY\b|¥|人民币|币种与汇率|参考汇率/.test(`${fullVisibleText}\n${popoverText}`),
        gluedUnitMatches,
        legacyCredits: /\b(?:Prompt|Flow)\s+(?:Credits\b|额度)|8,765|7,654/i.test(`${fullVisibleText}\n${popoverText}`),
        brokenBilingualMatches,
        sessionBadges,
        overviewTelemetry,
        gmTelemetry,
        modelsTelemetry,
        pricingTelemetry,
        aboutTelemetry,
        profileCredits: [...pane.querySelectorAll('.profile-credit-balance')].map(node => node.innerText.trim()),
        overviewCredits: pane.querySelector('.overview-footer p strong')?.innerText.trim(),
        quotaReadings: [...pane.querySelectorAll('.model-card')].map(card => [
            card.querySelector('.model-card-name-text')?.textContent.trim(),
            card.querySelector('.model-card-pct')?.textContent.trim()
                || `${card.querySelector('[data-quota-window="5h"] .quota-dual-pct')?.innerText.trim() || ''}/${card.querySelector('[data-quota-window="weekly"] .quota-dual-pct')?.innerText.trim() || ''}`,
        ]),
        errors: testState.errors,
    };
}

async function browserMatrix(packageJSON) {
    const sessionPrefix = `installed-monitor-ui-${process.pid}`;
    const TRANSIENT_BROWSER_ERROR = /CDP (?:connection closed|response channel closed|error .*Target closed: CDP session .* detached)|Timed out after \d+ms waiting for load state|Target closed|Browser not launched|Execution context was destroyed|ECONNRESET|EPIPE|ETIMEDOUT|socket hang up|broken pipe/i;
    const MAX_OPENS_PER_SESSION = 12;
    let session = sessionPrefix;
    let sessionSeq = 0;
    let opensInSession = 0;
    let sessionRecycles = 0;
    const browser = (argv, input) => {
        const result = jsonResult('agent-browser', ['--session', session, ...argv, '--json'], input);
        assert(result.success, result.error);
        return result.data;
    };
    function resetSession(reason = 'recycle') {
        try { browser(['close']); } catch { /* Disconnection may have already closed the renderer. */ }
        sessionSeq++;
        opensInSession = 0;
        session = `${sessionPrefix}-${reason}-${sessionSeq}`;
        if (reason === 'recycle' || reason === 'phase') { sessionRecycles++; }
    }
    const evaluate = js => browser(['eval', '--stdin'], js).result;
    const click = selector => browser(['click', selector]);
    function waitFor(condition, description) {
        try { browser(['wait', '--fn', condition]); }
        catch (error) { throw new Error(`${description}: ${error.message}`); }
    }
    const settleAnimations = () => evaluate('(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))); await new Promise(requestAnimationFrame); return true; })()');
    const audit = selector => {
        settleAnimations();
        const argv = selector ? ['a11y', '--selector', selector] : ['a11y'];
        const result = browser(argv);
        const failures = result.violations.map(item => `${item.id}: ${item.nodes.map(node => JSON.stringify(node.target)).slice(0, 4).join(', ')}`);
        assert.equal(result.counts.violations, 0, `${selector || 'document'} a11y violations:\n${failures.join('\n')}`);
    };
    const auditChromeAndPane = tab => {
        audit('.panel-topbar');
        audit(`#tab-${tab}`);
    };
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-monitor-ui-'));
    const failures = [];
    let passed = 0;
    let browserRetries = 0;
    function test(name, run, restartable = false) {
        try { run(); passed++; }
        catch (error) {
            if (!restartable || !TRANSIENT_BROWSER_ERROR.test(error.message || '')) {
                failures.push({ name, message: error.message });
                return;
            }
            // A restartable fixture begins with a fresh page and cannot carry state into its retry.
            browserRetries++;
            resetSession('retry');
            try {
                if (typeof restartable === 'function') { restartable(); }
                run();
                passed++;
            }
            catch (retryError) { failures.push({ name, message: retryError.message }); }
        }
    }
    let navigation = 0;
    function open(html, width, height = 950) {
        const file = path.join(temp, 'fixture.html');
        fs.writeFileSync(file, html);
        if (opensInSession >= MAX_OPENS_PER_SESSION) {
            resetSession('recycle');
        }
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                opensInSession++;
                browser(['set', 'viewport', String(width), String(height)]);
                browser(['open', `${pathToFileURL(file).href}?case=${++navigation}`]);
                waitFor("Boolean(document.querySelector('#tab-overview.active [data-monitor-overview], #tab-overview.active[data-monitor-overview]'))", 'Overview initialized');
                return;
            } catch (error) {
                if (attempt < 3 && TRANSIENT_BROWSER_ERROR.test(error.message || '')) {
                    browserRetries++;
                    resetSession('open-retry');
                    continue;
                }
                throw error;
            }
        }
    }
    function selectTab(tab) {
        browser(['focus', `#tabBar [data-tab="${tab}"]`]);
        browser(['press', 'Enter']);
        waitFor(`(async () => { await new Promise(requestAnimationFrame); return Boolean(document.querySelector('#tab-${tab}.active')); })()`, `${tab} activated by keyboard`);
    }

    function measureTab(tab) {
        const actions = [
            ['focus', `#tabBar [data-tab="${tab}"]`],
            ['press', 'Enter'],
            ['eval', `(async () => { window.scrollTo(0, 0); await new Promise(requestAnimationFrame); return (${editorialReadings})(); })()`],
        ];
        const results = jsonResult('agent-browser', ['--session', session, 'batch', '--bail', '--omit-command', '--json'], JSON.stringify(actions));
        for (const action of results) { assert(action.success, action.error); }
        assert.equal(results.length, actions.length, `complete keyboard and layout observation for ${tab}`);
        return results.at(-1).result.result;
    }

    function assertEditorialView(view, { lang, state, theme, width, tab }) {
        assert.equal(view.tab, tab, 'keyboard activates the selected tab');
        assert.equal(view.pane, `tab-${tab}`);
        assert(view.soleCurrentTab, 'one navigation button has aria-current');
        assert(view.readable, 'tab has visible text for its body heading or empty state');
        assert(view.headlineFits, `tab begins with a readable heading or state: ${view.readable}`);
        assert.equal(view.overflow, false, `header, tab and page fit horizontally at ${width}px`);
        assert.deepEqual(view.overflowingRegions, [], `visible regions fit horizontally at ${width}px`);
        assert.equal(view.overlapping, false, 'masthead controls do not overlap');
        assert.equal(view.stickyHeaderOverlap, false, 'sticky header does not overlap pane content');
        assert.equal(view.editorial, true, 'editorial styling is integrated into the installed panel');
        assert.equal(view.bodyLang, lang, 'body[data-lang] matches active language');
        assert.equal(view.bodyThemeKind, theme, 'body[data-vscode-theme-kind] matches active theme');

        for (const [tokenName, tokenValue] of Object.entries(view.designTokens)) {
            assert(Boolean(tokenValue), `DESIGN.md token ${tokenName} is defined`);
        }
        assert.equal(view.hasGenericSerifFallback, false, 'Zero-Songti rule: no generic `, serif` fallback in font stacks');
        assert.equal(view.hasSongtiFallback, false, 'Zero-Songti rule: no Songti/SimSun in font stacks');
        if (lang === 'both') {
            assert(view.bilingual.enCount > 0 && view.bilingual.zhCount > 0 && view.bilingual.sepCount > 0,
                'bilingual mode renders structured .bi-en / .bi-sep / .bi-zh subordination spans');
            assert.equal(view.bilingual.zhHasForbiddenSerif, false, '.bi-zh renders in CJK sans, never serif/Songti');
        } else {
            assert.equal(view.bilingual.sepCount, 0, `${lang} mode has no bilingual .bi-sep separators`);
        }

        assert(view.mastheadFont.includes('sans-serif'), 'masthead has a sans-serif fallback font');
        assert(view.mastheadFontSize >= 12 && view.mastheadFontSize <= 23, 'masthead stays readable without dominating the panel');
        assert.equal(view.colorScheme, theme.endsWith('light') ? 'light' : 'dark', 'controls follow the theme kind');

        // Cool-neutral / zero-warm-cast guard (DESIGN.md L641) on body canvas, masthead, tokens, L1 cards, and L2 wells
        assertCoolNeutralRgb(view.pageSurface, `${theme} body canvas`);
        assertCoolNeutralRgb(view.mastheadBackground, `${theme} masthead`);
        assertCoolNeutralRgb(view.resolvedTokens.bg, `${theme} --ed-bg`);
        assertCoolNeutralRgb(view.resolvedTokens.surface, `${theme} --ed-surface`);
        assertCoolNeutralRgb(view.resolvedTokens.surfaceWell, `${theme} --ed-surface-well`, 18);
        for (const card of view.l1CardSurfaces) {
            assertCoolNeutralRgb(card.bg, `${theme} ${tab} L1 card (${card.selector})`);
        }
        for (const well of view.l2WellSurfaces) {
            assertCoolNeutralRgb(well.bg, `${theme} ${tab} L2 well (${well.selector})`, 18);
        }
        if (theme === 'vscode-light') {
            assert.equal(view.pageSurface, 'rgb(250, 251, 252)', 'Light canvas uses #FAFBFC studio alabaster');
            assert.equal(view.resolvedTokens.surface, 'rgb(255, 255, 255)', 'Light L1 surface uses #FFFFFF studio paper');
        } else if (theme === 'vscode-dark') {
            assert.equal(view.pageSurface, 'rgb(13, 16, 20)', 'Dark canvas uses #0D1014 obsidian slate');
            assert.equal(view.resolvedTokens.surface, 'rgb(20, 24, 31)', 'Dark L1 surface uses #14181F obsidian surface');
        }

        // WCAG 1.4.11 non-text contrast (>= 3.0:1) on Light & Dark controls, meters, and chart series
        if ((theme === 'vscode-light' || theme === 'vscode-dark') && tab === 'overview') {
            for (const [pair, ratio] of Object.entries(view.nonTextContrasts)) {
                assert(typeof ratio === 'number' && ratio >= 3.0,
                    `WCAG 1.4.11 non-text contrast ${theme} ${pair}=${ratio} must be >= 3.0:1`);
            }
        }

        assert(!['transparent', 'rgba(0, 0, 0, 0)'].includes(view.mastheadBackground), 'masthead has a solid surface');
        assert.equal(view.navShadow, 'none', 'tab strip uses a flat surface');
        assert(view.chromeAccentSize >= 1 && view.chromeAccentSize <= 4, 'selected tab uses a thin underline');
        assert.equal(view.missingNumeric, false, 'no invalid numeric readings');
        assert.equal(view.hasLingpai, false, 'copy guard: zero awkward "令牌" anywhere in rendered DOM text/attributes');
        if (tab !== 'settings') {
            assert.equal(view.hasCnyOrYen, false, 'default USD display guard: zero CNY / ¥ / FX copy on non-Settings tabs when USD is active');
        }
        assert.deepEqual(view.gluedUnitMatches, [], 'copy guard: zero glued numeric units (e.g. 64tok/s, 2credits, 3calls)');
        assert.equal(view.legacyCredits, false, 'copy guard: zero legacy Prompt/Flow credits in rendered DOM');
        assert.deepEqual(view.brokenBilingualMatches, [], 'copy guard: zero broken bilingual strings or EOC dashes');
        if (lang === 'zh' && tab === 'chats') {
            for (const badge of view.sessionBadges) {
                assert(!/^(?:RUNNING|FINISHED|IDLE|UNKNOWN|CANCELLED|FAILED|PENDING)$/.test(badge),
                    `Sessions status badge must be localized in zh: ${badge}`);
            }
        }
        assert.deepEqual(view.errors, []);

        if (tab === 'profile' && state === 'populated') {
            assert.equal(view.profileCredits.length, 1, 'one deduplicated current AI credit balance');
            assert(view.profileCredits[0].includes('1,200'), 'AI credit value is shown');
            assert.equal(view.quotaReadings.length, 2, 'shared quota pools are shown once each');
            assert.deepEqual(Object.fromEntries(view.quotaReadings), { Gemini: '52%/84%', 'Claude / GPT': '91%/96%' });
        }
        if (tab === 'overview') {
            if (state === 'populated') {
                assert.equal(view.overviewCredits, '1,200', 'Overview excludes retired credit balances');
                const ot = view.overviewTelemetry;
                assert(ot?.present, 'Overview .overview-telemetry-strip renders on populated fixture');
                assert.equal(ot.scope, 'active', 'Overview telemetry strip binds to active conversation');
                assert.equal(ot.cellCount, 5, 'Overview telemetry strip renders 5 cells (Speed, TTFT, Cache Hit, Cache Saved, Session Cost)');
                assert(/tok\/s/.test(ot.speedVal), `Overview Speed cell renders tok/s: ${ot.speedVal}`);
                assert(/resp\s+[\d.]+\s+tok\/s/.test(ot.speedSub), `Overview Speed sub renders thinking resp tok/s: ${ot.speedSub}`);
                assert(/(?:ms|s)$/.test(ot.ttftVal), `Overview TTFT cell renders latency: ${ot.ttftVal}`);
                assert(/cached\s+\d+(?:\.\d+)?(?:ms|s)/.test(ot.ttftSub), `Overview TTFT sub renders cached TTFT: ${ot.ttftSub}`);
                assert.equal(ot.cacheHitVal, '72.7%', `Overview Cache Hit is token-weighted 72.7%: ${ot.cacheHitVal}`);
                assert.equal(ot.cacheHitHasTone, true, 'Overview Cache Hit carries .is-cache semantic tone');
                assert(ot.cacheHitSub.includes('60k') && ot.cacheHitSub.includes('2/3'),
                    `Overview Cache Hit sub shows cached volume + call ratio: ${ot.cacheHitSub}`);
                assert(ot.savedVal === '60k tokens' || /^\$\d+\.\d{2}$/.test(ot.savedVal),
                    `Overview Cache Saved shows USD savings (mapped) or compact tokens (strict): ${ot.savedVal}`);
                assert.equal(ot.costVal, '$0.45', `Overview Session Cost renders $0.45: ${ot.costVal}`);
                assert(ot.costSub.includes('$1.25'), `Overview Today Cost sub renders $1.25: ${ot.costSub}`);
                assert.equal(ot.hasFakeZeroUsd, false, 'Overview telemetry strip never fabricates $0.00 for unpriced savings');
                assert(ot.warmthClass.includes('is-warm'), `Overview Cache Saved warmth tone is .is-warm: ${ot.warmthClass}`);
                assert.equal(ot.warmthBiInherits, true, 'Overview warmth bilingual spans inherit semantic hue');
                assert.equal(ot.orchRoutePresent, true, 'Overview active cross-pool .orch-route-pill renders');
                assert.equal(ot.orchRouteCrossPool, 'true', 'Overview .orch-route-pill marks cross-pool routing');
                assert(ot.orchRouteText.includes('Claude Opus 5.5 (Medium)') && ot.orchRouteText.includes('Gemini 4 Hydrogen'),
                    `Overview .orch-route-pill displays Planner -> Executor pair: ${ot.orchRouteText}`);
                assert.equal(ot.dualQuotaRows, 2, 'Overview renders Dual-Window (5h + Weekly) meters for both pools');
                assert(ot.dualQuota5h.includes('52%') && ot.dualQuota5h.includes('91%'),
                    `Overview 5h quota windows render 52% & 91%: ${ot.dualQuota5h.join(', ')}`);
                assert(ot.dualQuotaWeekly.includes('84%') && ot.dualQuotaWeekly.includes('96%'),
                    `Overview Weekly quota windows render 84% & 96%: ${ot.dualQuotaWeekly.join(', ')}`);
                if (theme === 'vscode-light' || theme === 'vscode-dark') {
                    assert.equal(ot.bg, view.resolvedTokens.surfaceWell, 'Overview telemetry strip preserves L2 well background');
                    assert.equal(ot.cacheHitColor, view.resolvedTokens.chartCache, 'Overview Cache Hit preserves --ed-chart-cache hue');
                }
            } else {
                assert.equal(view.overviewTelemetry?.present, false, 'Overview .overview-telemetry-strip is omitted on empty fixture');
                assert.equal(view.overviewTelemetry?.orchRoutePresent, false, 'Overview .orch-route-pill is omitted on empty fixture');
            }
        }
        if (tab === 'gmdata') {
            const gt = view.gmTelemetry;
            if (state === 'populated') {
                assert(gt?.ledgerPresent, 'GM Data #telemetryLedgerSection renders on populated fixture');
                assert(gt?.recentCallsPresent, 'GM Data #recentCallsLedger renders on populated fixture');
                assert.equal(gt.recentCallsOpen, true, 'GM Data #recentCallsLedger is open by default');
                assert.equal(gt.recentCallsRows, 6, 'GM Data #recentCallsLedger renders all 6 fixture calls');
                assert.equal(gt.recentCallsUnpricedCount + gt.recentCallsPricedCount, 6,
                    `GM Data #recentCallsLedger accounts for all 6 calls (${gt.recentCallsPricedCount} priced, ${gt.recentCallsUnpricedCount} unpriced)`);
                assert.equal(gt.recentCallsWrapFits, true, `GM Data .recent-calls-table-wrap stays within viewport at ${width}px`);
                assert(/74\.7\s+tok\/s/.test(gt.kpiSpeed), `GM Data KPI strip Speed shows weighted 74.7 tok/s: ${gt.kpiSpeed}`);
                assert(/1\.25s/.test(gt.kpiTtft), `GM Data KPI strip Avg TTFT shows valid-sample average: ${gt.kpiTtft}`);
                assert(gt.kpiCacheHit.includes('70.9%') && gt.kpiCacheHit.includes('4/6'),
                    `GM Data KPI strip Cache Hit shows token-weighted 70.9% + 4/6: ${gt.kpiCacheHit}`);
                assert.equal(gt.speedHero, '74.7 tok/s', `GM Data Speed hero renders 74.7 tok/s: ${gt.speedHero}`);
                assert(gt.speedSubText.includes('86.7 tok/s') && gt.speedSubText.includes('50.1 tok/s'),
                    `GM Data Speed subgrid renders Latest and thinking Visible resp tok/s: ${gt.speedSubText}`);
                assert.equal(gt.ttftTrackCount, 2, 'GM Data Cached vs Uncached TTFT renders both proportional bar tracks');
                assert(gt.hasCachedBar && gt.hasUncachedBar, 'GM Data renders both cached and uncached TTFT fill bars');
                assert.equal(gt.ttftDeltaFaster, true, 'GM Data TTFT speedup pill carries .is-faster');
                assert.equal(gt.ttftDeltaText, '-65%', `GM Data TTFT speedup delta badge renders -65%: ${gt.ttftDeltaText}`);
                assert.equal(gt.cacheHero, '70.9%', `GM Data Prompt Cache hero renders token-weighted 70.9%: ${gt.cacheHero}`);
                assert.equal(gt.cacheHeroHasTone, true, 'GM Data Prompt Cache hero carries .is-cache');
                assert.equal(gt.warmthIsWarm, true, 'GM Data Prompt Cache warmth badge carries .is-warm');
                assert(gt.cacheSegRead && gt.cacheSegFresh && gt.cacheSegWrite,
                    'GM Data Prompt Cache stacked bar renders Read + Fresh + Write segments');
                assert(gt.ledgerText.includes('118.0k') && /\$0\.(?:39|22)/.test(gt.ledgerText) && gt.ledgerText.includes('4 / 6'),
                    `GM Data Prompt Cache ledger renders Cache Read, Call Hit Ratio, and priced USD savings: ${gt.ledgerText}`);
                assert.equal(gt.hasFakeZeroUsd, false, 'GM Data telemetry ledger never fabricates $0.00');
                assert(gt.modelCards.length >= 2, 'GM Data renders Model Cards for both models');
                for (const card of gt.modelCards) {
                    assert(/tok\/s/.test(card.speed), `Model card ${card.name} renders Speed tok/s: ${card.speed}`);
                    assert(/(?:ms|s)/.test(card.ttft), `Model card ${card.name} renders Avg TTFT: ${card.ttft}`);
                    assert(/\d+\.\d+%/.test(card.cacheHit) && card.cacheHit.includes('2/3') && !card.cacheHit.startsWith('100%'),
                        `Model card ${card.name} renders token-weighted Cache Hit + 2/3 (not 100%): ${card.cacheHit}`);
                    if (theme === 'vscode-light' || theme === 'vscode-dark') {
                        assert.equal(card.cacheHitColor, view.resolvedTokens.accent,
                            `Model card ${card.name} .val-hit preserves --ed-accent tone`);
                    }
                }
                assert(/86\.7\s+tok\/s/.test(gt.stepSpeedPill), `Timeline step speed pill renders 86.7 tok/s: ${gt.stepSpeedPill}`);
                assert(/18\.00s/.test(gt.stepStreamPill), `Timeline step stream pill renders 18.00s: ${gt.stepStreamPill}`);
                assert(/86\.5%/.test(gt.stepCacheHitPill), `Timeline step cache hit pill renders 86.5%: ${gt.stepCacheHitPill}`);
                assert(/86\.7\s+tok\/s/.test(gt.turnSpeedChip), `Timeline turn speed chip renders 86.7 tok/s: ${gt.turnSpeedChip}`);
                assert(/760ms/.test(gt.turnTtftChip), `Timeline turn TTFT chip renders 760ms: ${gt.turnTtftChip}`);
                assert(/86\.5%/.test(gt.turnCacheHitChip), `Timeline turn cache hit chip renders 86.5%: ${gt.turnCacheHitChip}`);
                assert(gt.opaqueBackings.length >= 6, 'GM Data telemetry badges & pills are visible for backing checks');
                for (const pill of gt.opaqueBackings) {
                    if (theme === 'vscode-light' || theme === 'vscode-dark') {
                        assert.equal(pill.bg, view.resolvedTokens.surface,
                            `GM Data telemetry pill (${pill.cls}) preserves opaque --ed-surface backing: ${pill.bg}`);
                    }
                    assert.equal(pill.biInherits, true,
                        `GM Data telemetry pill (${pill.cls}) bilingual spans inherit surface hue`);
                }
                if (theme === 'vscode-high-contrast' || theme === 'vscode-high-contrast-light') {
                    assert(gt.trackOutlines.length >= 3, 'GM Data renders TTFT & Prompt Cache bar tracks in High Contrast');
                    for (const track of gt.trackOutlines) {
                        assert.equal(track.style, 'solid', `High-Contrast ${track.cls} preserves solid outline`);
                        assert.equal(track.width, '1px', `High-Contrast ${track.cls} preserves 1px outline`);
                    }
                }
            } else {
                assert.equal(gt?.ledgerPresent, false, 'GM Data #telemetryLedgerSection is omitted on empty fixture');
                assert.equal(gt?.recentCallsPresent, false, 'GM Data #recentCallsLedger is omitted on empty fixture');
            }
        }
        if (tab === 'models' && state === 'populated') {
            const mt = view.modelsTelemetry;
            assert.equal(mt?.orchCardPresent, true, 'Models tab renders Orchestrator Settings card on populated fixture');
            assert.equal(mt.orchMode, 'custom', 'Models tab Orchestrator Settings card reflects custom mode');
            assert(mt.noticeTags.length >= 1, 'Models tab renders Notice tag badge for GPT-OSS 120B');
            assert(mt.pricedSpecCount >= 1 && (mt.mappedSpecCount >= 1 || mt.unpricedSpecCount >= 1),
                `Models tab renders priced and mapped/unpriced .spec-price-row entries (${mt.pricedSpecCount}/${mt.mappedSpecCount}/${mt.unpricedSpecCount})`);
            assert.equal(mt.dualQuotaRows, 2, 'Models tab renders Dual-Window quota bars for both pools');
        }
        if (tab === 'pricing' && state === 'populated') {
            const pt = view.pricingTelemetry;
            assert.equal(pt?.hasCurrencyBar, false, 'Cost tab omits legacy inline Currency Display toolbar');
            assert.equal(pt?.hasCnyOrYen, false, 'Cost tab renders in USD by default with zero CNY/¥');
            assert.equal(pt?.hasUsdAmount, true, 'Cost tab renders USD formatted amounts');
            assert.equal(pt?.hasOrchPricingToggle, true, 'Cost tab renders Orchestrator Pricing Mode toggle');
            if (Date.now() < Date.parse('2026-12-01T00:00:00Z')) {
                assert(pt.rateChangeBannerText.includes('2026-12-01')
                    && pt.rateChangeBannerText.includes('Carbon')
                    && pt.rateChangeBannerText.includes('Argon'),
                    `Cost tab renders Upcoming Rate-Change Banner for Carbon/Argon 2026-12-01: ${pt.rateChangeBannerText}`);
            }
        }
        if (tab === 'about') {
            const at = view.aboutTelemetry;
            const expectedVersion = `v${packageJSON.version}`;
            assert.equal(at?.versionPill, expectedVersion, `About tab version pill renders ${expectedVersion}: ${at?.versionPill}`);
            assert(at.text.includes('512K') && at.text.includes('Gemini 4 Neon') && at.text.includes('Orchestrator Neon/Carbon/Argon'),
                'About tab renders updated 512K Gemini 4 & Orchestrator disclaimer');
        }
    }

    async function runEditorialMatrix(panel, configs, fixtures, lang, smokeMode = false) {
        const states = smokeMode ? [['populated', fixtures.populated]] : [['populated', fixtures.populated], ['empty', fixtures.empty]];
        const matrixThemes = smokeMode
            ? [['vscode-light', themeTokens['vscode-light']], ['vscode-dark', themeTokens['vscode-dark']]]
            : Object.entries(themeTokens);
        for (const [state, fixture] of states) {
            if (opensInSession > 0) { resetSession('phase'); }
            const modelConfigs = state === 'populated' ? configs : [];
            const html = await panel.render(lang, modelConfigs, fixture);
            for (const [theme, themeStyle] of matrixThemes) {
                const source = browserFixture(html, theme, themeStyle);
                const widths = smokeMode
                    ? [320, 1280]
                    : state === 'populated'
                        ? [320, 380, 960, 1280]
                        : [320, 1280];
                for (const width of widths) {
                    open(source, width);
                    for (const tab of tabs) {
                        test(`editorial ${lang} ${state} ${theme} ${width}px ${tab}`, () => {
                            const view = measureTab(tab);
                            assertEditorialView(view, { lang, state, theme, width, tab });
                            const isPrimaryTheme = theme === 'vscode-light' || theme === 'vscode-dark';
                            const shouldAudit = isPrimaryTheme && (
                                (state === 'populated' && width === 320)
                                || (state === 'populated' && width === 1280 && lang === 'both')
                                || (state === 'empty' && width === 320 && lang === 'both')
                            );
                            if (shouldAudit) { auditChromeAndPane(tab); }
                        }, () => open(source, width));
                    }
                }
            }
        }
    }

    function testHeaderAndAccountPopover(theme, reopen) {
        test(`${theme} account popover open/close, deduplicated credits, remove action and a11y`, () => {
            click('#acctPopoverTrigger');
            waitFor("Boolean(document.querySelector('#acctPopoverPanel:not([hidden])'))", 'Account popover opened');
            assert.equal(evaluate("document.querySelector('#acctPopoverTrigger').getAttribute('aria-expanded')"), 'true');
            const popover = evaluate(`(() => {
                const body = document.getElementById('acctPopoverBody');
                const chips = [...body.querySelectorAll('.acct-credit-chip')].map(n => n.innerText.trim());
                return { text: body.innerText, chips, unknownCount: body.querySelectorAll('.acct-credit-unknown').length };
            })()`);
            assert.equal(popover.text.match(/1,200/g)?.length, 1, 'Account Popover deduplicates Google AI credits');
            assert(!/\b(?:Prompt|Flow)\s+(?:Credits|额度)|8,765|7,654/i.test(popover.text), 'Account Popover omits legacy Prompt/Flow credits');
            assert(!/令牌/.test(popover.text), 'Account Popover has zero 令牌');
            assert.equal(popover.unknownCount, 1, 'Cached account with unknown credits renders explicit unknown marker');
            assert(/Not reported|未上报/.test(popover.text), 'Unknown account credits show Not reported / 未上报, never 0');
            assert(!/\b0\b/.test(evaluate("document.querySelector('#acctPopoverBody .acct-credit-unknown')?.innerText || ''")), 'Unknown credit value is never 0');
            audit('#acctPopoverPanel');
            click('#acctPopoverBody .acct-delete-btn');
            assert(evaluate("testState.messages.some(msg => msg.command === 'removeAccount' && msg.email === 'backup@example.invalid')"),
                'Remove cached account sends removeAccount message');
            browser(['press', 'Escape']);
            waitFor("Boolean(document.querySelector('#acctPopoverPanel')?.hidden)", 'Escape closes account popover');
            assert.equal(evaluate("document.querySelector('#acctPopoverTrigger').getAttribute('aria-expanded')"), 'false');
            assert.equal(evaluate("document.activeElement?.id"), 'acctPopoverTrigger', 'Escape returns focus to popover trigger');
        }, reopen);
    }

    function testSettingsInteractions(reopen) {
        test('Settings toggles, spinners, save, hover density, zoom, overlays, updates, currency/ROI and storage actions', () => {
            selectTab('settings');
            const spinnerAria = evaluate(`[...document.querySelectorAll('#tab-settings .num-spinner-btn')].map(b => b.getAttribute('aria-label'))`);
            assert.equal(spinnerAria.length, 10, `Settings has 10 spinner buttons (got ${spinnerAria.length})`);
            assert(spinnerAria.every(label => Boolean(label && label.trim())), 'All Settings spinner buttons have aria-labels');

            // Quota notification spinner + save
            const initialQuota = Number(evaluate("document.querySelector('#quotaNotifyInput').value"));
            click('#tab-settings .stg-card[data-accent="quota"] .num-spinner-btn.increment');
            const bumpedQuota = Number(evaluate("document.querySelector('#quotaNotifyInput').value"));
            assert.equal(bumpedQuota, initialQuota + 5, 'Quota threshold increment follows step=5');
            click('#quotaNotifySaveBtn');
            assert(evaluate(`testState.messages.some(m => m.command === 'setConfig' && m.key === 'quotaNotificationThreshold' && m.value === ${bumpedQuota})`),
                'Quota threshold save posts setConfig');

            // Polling interval spinner + save + feedback
            const initialPoll = Number(evaluate("document.querySelector('#pollingInput').value"));
            click('#tab-settings .stg-card[data-accent="poll"] .num-spinner-btn.increment');
            const bumpedPoll = Number(evaluate("document.querySelector('#pollingInput').value"));
            assert.equal(bumpedPoll, initialPoll + 1, 'Polling interval increment follows step=1');
            click('#pollingSaveBtn');
            assert(evaluate(`testState.messages.some(m => m.command === 'setPollingInterval' && m.value === ${bumpedPoll})`),
                'Polling save posts setPollingInterval');
            evaluate("window.dispatchEvent(new MessageEvent('message', { data: { command: 'configSaved', key: 'pollingInterval' } }))");
            assert.equal(evaluate("document.querySelector('#pollingFeedback')?.textContent"), '✓', 'Polling save shows saved checkmark');

            // Status bar & advanced toggles (Speed, Cache Hit & Session Cost default opt-in = false)
            assert.equal(evaluate("document.querySelector('#toggleSpeed').checked"), false, '#toggleSpeed defaults to opt-in false');
            assert.equal(evaluate("document.querySelector('#toggleCacheHit').checked"), false, '#toggleCacheHit defaults to opt-in false');
            assert.equal(evaluate("document.querySelector('#toggleSessionCost').checked"), false, '#toggleSessionCost defaults to opt-in false');
            const configToggles = [
                ['#toggleContext', 'statusBar.showContext'],
                ['#toggleQuota', 'statusBar.showQuota'],
                ['#toggleCountdown', 'statusBar.showResetCountdown'],
                ['#toggleAiCredits', 'statusBar.showAiCredits'],
                ['#toggleSpeed', 'statusBar.showSpeed'],
                ['#toggleCacheHit', 'statusBar.showCacheHit'],
                ['#toggleSessionCost', 'statusBar.showSessionCost'],
                ['#toggleModelInternalId', 'showModelInternalId'],
            ];
            for (const [sel, key] of configToggles) {
                const before = evaluate(`document.querySelector('${sel}').checked`);
                evaluate(`document.querySelector('label.toggle-row:has(${sel})')?.scrollIntoView({ block: 'center' })`);
                click(`label.toggle-row:has(${sel})`);
                const after = evaluate(`document.querySelector('${sel}').checked`);
                assert.equal(after, !before, `${sel} toggles checked state`);
                assert(evaluate(`testState.messages.some(m => m.command === 'setConfig' && m.key === '${key}' && m.value === ${after})`),
                    `${sel} emits setConfig for ${key}`);
            }

            // Default USD preview on #toggleSessionCost
            assert(evaluate("document.querySelector('label.toggle-row:has(#toggleSessionCost)')?.innerText.includes('$0.27')"),
                '#toggleSessionCost renders $0.27 USD preview');

            // v1.17.6 Overlays & Native Ambient HUD card (strictly opt-in CDP toggles default false)
            assert.equal(evaluate("document.querySelector('#toggleAppComposerRing')?.checked"), false, '#toggleAppComposerRing defaults to opt-in false');
            assert.equal(evaluate("document.querySelector('#toggleAppTopBar')?.checked"), false, '#toggleAppTopBar defaults to opt-in false');
            for (const [sel, key] of [
                ['#toggleNativeHudBar', 'showNativeHudBar'],
                ['#toggleAppComposerRing', 'appComposerRingEnabled'],
                ['#toggleAppTopBar', 'appTopBarEnabled'],
            ]) {
                const before = evaluate(`document.querySelector('${sel}').checked`);
                evaluate(`document.querySelector('label.toggle-row:has(${sel})')?.scrollIntoView({ block: 'center' })`);
                click(`label.toggle-row:has(${sel})`);
                const after = evaluate(`document.querySelector('${sel}').checked`);
                assert.equal(after, !before, `${sel} toggles checked state`);
                assert(evaluate(`testState.messages.some(m => m.command === 'setAppSetting' && m.key === '${key}' && m.value === ${after})`),
                    `${sel} emits setAppSetting for ${key}`);
                click(`label.toggle-row:has(${sel})`);
            }

            // v1.17.6 Updates & Release Checks card
            assert(evaluate("Boolean(document.querySelector('#updatesSettingsCard'))"), 'Updates & Release Checks card renders');
            evaluate("document.querySelector('#settingsCheckUpdatesBtn')?.scrollIntoView({ block: 'center' })");
            click('#settingsCheckUpdatesBtn');
            assert(evaluate("testState.messages.some(m => m.command === 'checkForUpdates' && m.force === true)"),
                '#settingsCheckUpdatesBtn posts checkForUpdates');

            // v1.17.6 Cost, Currency & History card (Orchestrator Pricing Mode + Display Currency + Subscription + Retention)
            evaluate("document.querySelector('#stgOrchModeStrict')?.scrollIntoView({ block: 'center' })");
            click('#stgOrchModeStrict');
            assert(evaluate("testState.messages.some(m => m.command === 'setOrchestratorPricingMode' && m.mode === 'strict')"),
                '#stgOrchModeStrict posts setOrchestratorPricingMode strict');
            click('#stgOrchModeMapped');
            assert(evaluate("testState.messages.some(m => m.command === 'setOrchestratorPricingMode' && m.mode === 'mapped')"),
                '#stgOrchModeMapped posts setOrchestratorPricingMode mapped');

            browser(['select', '#displayCurrencySelect', 'CNY']);
            assert(evaluate("testState.messages.some(m => m.command === 'setAppSetting' && m.key === 'displayCurrency' && m.value === 'CNY')"),
                '#displayCurrencySelect posts setAppSetting displayCurrency');
            browser(['select', '#displayCurrencySelect', 'USD']);

            browser(['select', '#subscriptionPlanSelect', 'google-ai-pro']);
            assert(evaluate("testState.messages.some(m => m.command === 'setAppSetting' && m.key === 'subscriptionPlan' && m.value === 'google-ai-pro')"),
                '#subscriptionPlanSelect posts setAppSetting subscriptionPlan');
            browser(['select', '#subscriptionPlanSelect', 'none']);

            browser(['fill', '#calendarRetentionInput', '365']);
            click('#calendarRetentionSaveBtn');
            assert(evaluate("testState.messages.some(m => m.command === 'setAppSetting' && m.key === 'calendarRetentionDays' && m.value === 365)"),
                '#calendarRetentionSaveBtn posts setAppSetting calendarRetentionDays');

            // Hover density select
            for (const density of ['compact', 'full', 'auto']) {
                browser(['select', '#statusTooltipDensity', density]);
                const last = evaluate("testState.messages.filter(m => m.command === 'setConfig' && m.key === 'statusBar.tooltipDensity').at(-1)?.value");
                assert.equal(last, density, `Hover density select posts ${density}`);
            }

            // Zoom presets + range slider + reset to 100%
            click('.zoom-preset[data-zoom="110"]');
            assert.equal(evaluate("document.querySelector('#zoomValue').textContent"), '110%');
            assert.equal(evaluate("document.querySelector('.zoom-preset[data-zoom=\"110\"]').classList.contains('is-active')"), true);
            assert(evaluate("testState.messages.some(m => m.command === 'setZoomLevel' && m.value === 110)"), 'Zoom preset posts setZoomLevel');
            click('.zoom-preset[data-zoom="100"]');
            assert.equal(evaluate("document.querySelector('#zoomValue').textContent"), '100%');

            // Scrollbar & EOC panel prefs
            const scrollBefore = evaluate("document.querySelector('#toggleScrollbar').checked");
            evaluate("document.querySelector('label.toggle-row:has(#toggleScrollbar)')?.scrollIntoView({ block: 'center' })");
            click('label.toggle-row:has(#toggleScrollbar)');
            assert.equal(evaluate("document.body.getAttribute('data-hide-scrollbar')"), String(scrollBefore));
            assert(evaluate(`testState.messages.some(m => m.command === 'setPanelPref' && m.key === 'panelShowScrollbar' && m.value === ${!scrollBefore})`));
            click('label.toggle-row:has(#toggleScrollbar)');

            const eocBefore = evaluate("document.querySelector('#toggleEndOfContent').checked");
            evaluate("document.querySelector('label.toggle-row:has(#toggleEndOfContent)')?.scrollIntoView({ block: 'center' })");
            click('label.toggle-row:has(#toggleEndOfContent)');
            assert.equal(evaluate("document.body.getAttribute('data-hide-eoc')"), String(eocBefore));
            assert(evaluate(`testState.messages.some(m => m.command === 'setPanelPref' && m.key === 'panelShowEndOfContent' && m.value === ${!eocBefore})`));
            click('label.toggle-row:has(#toggleEndOfContent)');

            // Storage & panel hint buttons
            click('#copyStatePath');
            assert(evaluate("testState.messages.some(m => m.command === 'copyStatePath')"));
            click('#openStateFile');
            assert(evaluate("testState.messages.some(m => m.command === 'openStateFile')"));
            click('#revealStateFile');
            assert(evaluate("testState.messages.some(m => m.command === 'revealStateFile')"));
            click('#restoreTabScrollHint');
            assert(evaluate("testState.messages.some(m => m.command === 'setPanelPref' && m.key === 'panelShowTabScrollHint' && m.value === true)"));
            click('#dismissTabScrollHint');
            assert.deepEqual(evaluate('testState.errors'), []);
        }, reopen);
    }

    function testCostInteractions(theme, reopen) {
        test(`${theme} Cost official Neon/Sonnet rates, USD-only layout, rate-change banner, custom pricing save/reset and calendar link`, () => {
            selectTab('pricing');
            // Official v1.17.3 default rates pre-populated in editor
            assert.equal(evaluate("document.querySelector('.pricing-input[data-model=\"gemini-4-neon\"][data-field=\"input\"]')?.value"), '3',
                'Gemini 4 Neon official $3 input rate is pre-populated');
            assert.equal(evaluate("document.querySelector('.pricing-input[data-model=\"gemini-4-neon\"][data-field=\"output\"]')?.value"), '15',
                'Gemini 4 Neon official $15 output rate is pre-populated');
            assert.equal(evaluate("document.querySelector('.pricing-input[data-model=\"gemini-4-neon\"][data-field=\"cacheRead\"]')?.value"), '0.15',
                'Gemini 4 Neon official $0.15 cache read rate is pre-populated');
            assert.equal(evaluate("document.querySelector('.pricing-input[data-model=\"claude-sonnet-5-5\"][data-field=\"cacheRead\"]')?.value"), '0.1',
                'Claude Sonnet 5.5 official $0.10 cache read rate is pre-populated');

            // USD-only Cost tab omits currency toolbar and FX controls
            assert.equal(evaluate("document.querySelector('#tab-pricing .prc-currency-bar, #tab-pricing .currency-btn, #pricingFxRateInput')"), null,
                'Cost tab omits removed Currency Display toolbar and FX input');
            const costText = evaluate("document.querySelector('#tab-pricing')?.innerText || ''");
            assert(/\$\d/.test(costText) && !/\bCNY\b|¥|汇率/.test(costText), 'Cost tab displays USD amounts with zero CNY/¥');

            // Cost tab Orchestrator Pricing Mode toggle
            click('#orchPricingModeStrict');
            assert(evaluate("testState.messages.some(m => m.command === 'setOrchestratorPricingMode' && m.mode === 'strict')"),
                '#orchPricingModeStrict posts setOrchestratorPricingMode strict');
            click('#orchPricingModeMapped');
            assert(evaluate("testState.messages.some(m => m.command === 'setOrchestratorPricingMode' && m.mode === 'mapped')"),
                '#orchPricingModeMapped posts setOrchestratorPricingMode mapped');

            // Custom pricing save on Orchestrator Neon row
            const targetModel = 'gemini-pro-orchestrator-neon';
            browser(['fill', `.pricing-input[data-model="${targetModel}"][data-field="input"]`, '2.5']);
            browser(['fill', `.pricing-input[data-model="${targetModel}"][data-field="output"]`, '12']);
            browser(['fill', `.pricing-input[data-model="${targetModel}"][data-field="cacheRead"]`, '0.25']);
            browser(['fill', `.pricing-input[data-model="${targetModel}"][data-field="thinking"]`, '12']);
            click('#pricingSaveBtn');
            const saved = evaluate(`testState.messages.filter(m => m.command === 'savePricing').at(-1)?.value?.[${JSON.stringify(targetModel)}]`);
            assert.deepEqual(saved, { input: 2.5, output: 12, cacheRead: 0.25, cacheWrite: 0, thinking: 12 },
                'Valid custom pricing row posts savePricing payload');

            // Partial row on unpriced Orchestrator Argon must reject with alert feedback and not post savePricing
            const beforeCount = evaluate("testState.messages.filter(m => m.command === 'savePricing').length");
            browser(['fill', `.pricing-input[data-model="gemini-pro-orchestrator-argon"][data-field="input"]`, '3']);
            click('#pricingSaveBtn');
            assert.equal(evaluate("testState.messages.filter(m => m.command === 'savePricing').length"), beforeCount,
                'Partial pricing row does not submit savePricing');
            assert.equal(evaluate("document.querySelector('#pricingFeedback')?.getAttribute('role')"), 'alert');
            assert(evaluate("Boolean(document.querySelector('#pricingFeedback')?.textContent.trim())"));
            browser(['fill', `.pricing-input[data-model="gemini-pro-orchestrator-argon"][data-field="input"]`, '']);

            click('#pricingResetBtn');
            assert(evaluate("testState.messages.some(m => m.command === 'resetPricing')"), 'Reset posts resetPricing');

            click('#tab-pricing .prc-monthly-calendar-link[data-switch-tab="calendar"]');
            assert(evaluate("Boolean(document.querySelector('#tab-calendar.active'))"), 'Cost View History button opens Calendar');
            assert.deepEqual(evaluate('testState.errors'), []);
        }, reopen);
    }

    function testSessionsInteractions(reopen) {
        test('Sessions search, filter pills, shortcut tiles, row actions and state persistence', () => {
            selectTab('chats');
            const visibleRows = () => evaluate("document.querySelectorAll('[data-history-row]:not([hidden])').length");
            assert.equal(visibleRows(), 3, 'all 3 populated sessions are visible');

            // Filter pills
            click('[data-history-filter="current"]');
            assert.equal(visibleRows(), 2, 'Workspace filter shows 2 current-workspace sessions');
            assert.equal(evaluate("document.querySelector('[data-history-filter=\"current\"]').getAttribute('aria-pressed')"), 'true');
            click('[data-history-filter="running"]');
            assert.equal(visibleRows(), 1, 'Running filter shows 1 running session');
            click('[data-history-filter="all"]');
            assert.equal(visibleRows(), 3, 'All filter restores all 3 sessions');

            // Shortcut tiles
            click('[data-history-shortcut="currentrepo"]');
            assert.equal(visibleRows(), 2, 'Current Repo shortcut filters to 2 monitor-repo sessions');
            click('[data-history-shortcut="current"]');
            assert.equal(visibleRows(), 2, 'Current Workspace shortcut filters to 2 sessions');
            click('[data-history-filter="all"]');

            // Search + persistence across tab switch
            browser(['fill', '#historySearchInput', 'Check quota']);
            assert.equal(visibleRows(), 1, 'session search filters results');
            selectTab('overview');
            selectTab('chats');
            assert.equal(visibleRows(), 1, 'session search is retained across tab navigation');
            browser(['fill', '#historySearchInput', '']);
            assert.equal(visibleRows(), 3, 'clearing search restores all sessions');

            // Row actions (workspace + record active; pb disabled without local file)
            click('#tab-chats [data-history-action="workspace"]:not([disabled])');
            assert(evaluate("testState.messages.some(m => m.command === 'historyAction' && m.action === 'workspace')"));
            click('#tab-chats [data-history-action="record"]:not([disabled])');
            assert(evaluate("testState.messages.some(m => m.command === 'historyAction' && m.action === 'record')"));
            assert.equal(evaluate("document.querySelectorAll('#tab-chats [data-history-action=\"pb\"]:not([disabled])').length"), 0,
                'PB button remains disabled when synthetic .pb archive does not exist on disk');
            assert.deepEqual(evaluate('testState.errors'), []);
        }, reopen);
    }

    function testGMDataInteractions(theme, reopen) {
        test(`${theme} GM Data recent calls ledger, error toggle, disclosures, clipboard copy, tool catalog and a11y`, () => {
            selectTab('gmdata');
            // Recent Calls Ledger collapsible disclosure + row verification
            assert.equal(evaluate("Boolean(document.querySelector('#recentCallsLedger')?.open)"), true, '#recentCallsLedger starts open');
            assert.equal(evaluate("document.querySelectorAll('#recentCallsLedger tbody tr').length"), 6, '#recentCallsLedger shows 6 rows');
            assert(evaluate("document.querySelector('#recentCallsLedger').innerText.includes('Retry ×1') || document.querySelector('#recentCallsLedger').innerText.includes('重试 ×1')"),
                '#recentCallsLedger renders Retry ×1 status badge');
            click('#recentCallsLedger > summary');
            assert.equal(evaluate("Boolean(document.querySelector('#recentCallsLedger').open)"), false, '#recentCallsLedger collapses on click');
            click('#recentCallsLedger > summary');
            assert.equal(evaluate("Boolean(document.querySelector('#recentCallsLedger').open)"), true, '#recentCallsLedger re-opens on click');

            // Model stats error toggle
            assert.equal(evaluate("document.querySelector('#modelStatsErrToggle')?.classList.contains('is-off')"), true);
            click('#modelStatsErrToggle');
            assert.equal(evaluate("document.querySelector('#modelStatsErrToggle').classList.contains('is-off')"), false);
            assert.equal(evaluate("document.querySelector('.act-cards-grid').classList.contains('model-stats-show-errors')"), true);

            // Context Intelligence & nested Model DNA disclosures
            assert.equal(evaluate("Boolean(document.querySelector('#ciSection')?.open)"), false);
            browser(['focus', '#ciSection > summary']);
            browser(['press', 'Enter']);
            assert.equal(evaluate("Boolean(document.querySelector('#ciSection').open)"), true, 'Context Intelligence opens via keyboard');
            const hasCpCard = evaluate("Boolean(document.querySelector('#ciSection details.cp-card'))");
            assert(hasCpCard, 'Context Intelligence contains collapsible cards');
            click('#ciSection details.cp-card > summary');
            assert.equal(evaluate("Boolean(document.querySelector('#ciSection details.cp-card').open)"), true);

            // Tool Catalog disclosure + Clear button
            browser(['focus', '#toolCatSection > summary']);
            browser(['press', 'Enter']);
            assert.equal(evaluate("Boolean(document.querySelector('#toolCatSection').open)"), true);
            click('#clearToolCatalogBtn');
            assert(evaluate("testState.messages.some(m => m.command === 'clearToolCatalog')"));

            // Error details catalog + copy all errors
            browser(['focus', '#ue-catalog > summary']);
            browser(['press', 'Enter']);
            assert.equal(evaluate("Boolean(document.querySelector('#ue-catalog').open)"), true);
            click('#copyAllErrors');
            assert(evaluate("testState.clipboard.some(text => text.includes('429'))"), 'Copy All Errors copies error details');

            // Timeline turn disclosure (and verify clean Turn copy)
            assert(evaluate("Boolean(document.querySelector('#turn-0'))"), 'Timeline turn disclosure exists');
            assert(!/Turn\s*\/\s*第\s*\d+\s*\/\s*轮/.test(evaluate("document.querySelector('#tab-gmdata').innerText")),
                'GM Data timeline has zero broken bilingual Turn strings');
            click('#turn-0 > summary');
            assert.equal(evaluate("Boolean(document.querySelector('#turn-0').open)"), false, 'Timeline turn toggles closed');
            click('#turn-0 > summary');
            assert.equal(evaluate("Boolean(document.querySelector('#turn-0').open)"), true, 'Timeline turn toggles open');

            audit('#tab-gmdata');
            assert.deepEqual(evaluate('testState.errors'), []);
        }, reopen);
    }

    function testCalendarInteractions(theme, reopen) {
        test(`${theme} Calendar day selection, prev/next month, all-time summary, clear history and a11y`, () => {
            selectTab('calendar');
            const currentLabel = evaluate("document.querySelector('.cal-month-label')?.innerText");
            assert(currentLabel, 'populated calendar identifies its displayed period');

            const dates = evaluate("[...document.querySelectorAll('#tab-calendar .cal-cell.has-data')].map(n => n.getAttribute('data-cal-date'))");
            assert(dates.length >= 2, 'populated calendar has multiple active dates');

            // Select first date -> detail panel opens with speed / TTFT / token-weighted cache chips
            evaluate(`document.querySelector('.cal-cell.has-data[data-cal-date="${dates[0]}"]')?.scrollIntoView({ block: 'center' })`);
            click(`.cal-cell.has-data[data-cal-date="${dates[0]}"]`);
            assert.equal(evaluate(`document.querySelector('[data-cal-detail="${dates[0]}"]').classList.contains('cal-detail-open')`), true);
            assert.equal(evaluate(`document.querySelector('.cal-cell[data-cal-date="${dates[0]}"]').classList.contains('selected')`), true);
            const calChips = evaluate(`(() => {
                const detail = document.querySelector('[data-cal-detail="${dates[0]}"]');
                const speedEl = detail.querySelector('.cal-chip-speed');
                return {
                    speed: speedEl?.innerText.trim() || '',
                    speedColor: speedEl ? getComputedStyle(speedEl).color : '',
                    ttft: detail.querySelector('.cal-chip-ttft')?.innerText.trim() || '',
                    cache: detail.querySelector('.cal-chip-cache')?.innerText.trim() || '',
                    text: detail.innerText || '',
                };
            })()`);
            assert.equal(calChips.speed, '68.4 tok/s', `Calendar .cal-chip-speed renders 68.4 tok/s: ${calChips.speed}`);
            assert.equal(calChips.ttft, '840ms', `Calendar .cal-chip-ttft renders adaptive 840ms: ${calChips.ttft}`);
            assert.equal(calChips.cache, '70.6%', `Calendar .cal-chip-cache renders token-weighted 70.6%: ${calChips.cache}`);
            assert(!/\b\d+(?:\.\d+)?(?:tok\/s|credits|tools|calls|cache|in|out)\b/.test(calChips.text),
                `Calendar detail has zero glued units: ${calChips.text}`);
            audit('#tab-calendar');

            // Switch to second date -> first closes, second opens
            evaluate(`document.querySelector('.cal-cell.has-data[data-cal-date="${dates[1]}"]')?.scrollIntoView({ block: 'center' })`);
            click(`.cal-cell.has-data[data-cal-date="${dates[1]}"]`);
            assert.equal(evaluate(`document.querySelector('[data-cal-detail="${dates[0]}"]').classList.contains('cal-detail-open')`), false);
            assert.equal(evaluate(`document.querySelector('[data-cal-detail="${dates[1]}"]').classList.contains('cal-detail-open')`), true);

            // Toggle same date closed
            click(`.cal-cell.has-data[data-cal-date="${dates[1]}"]`);
            assert.equal(evaluate(`document.querySelector('[data-cal-detail="${dates[1]}"]').classList.contains('cal-detail-open')`), false);

            // Prev & Next month navigation
            evaluate("document.querySelector('[data-cal-nav=\"prev\"]')?.scrollIntoView({ block: 'center' })");
            browser(['focus', '[data-cal-nav="prev"]']);
            browser(['press', 'Enter']);
            const prevMsg = evaluate("testState.messages.filter(m => m.command === 'switchCalendarMonth').at(-1)");
            assert(Number.isInteger(prevMsg?.year) && Number.isInteger(prevMsg?.month), 'prev month posts switchCalendarMonth');
            click('[data-cal-nav="next"]');
            const nextMsg = evaluate("testState.messages.filter(m => m.command === 'switchCalendarMonth').at(-1)");
            assert(Number.isInteger(nextMsg?.year) && Number.isInteger(nextMsg?.month) && nextMsg.month !== prevMsg.month,
                'next month posts switchCalendarMonth for a different month');

            // Summary mode toggle (All-Time <-> Monthly)
            evaluate("document.querySelector('[data-summary-mode=\"alltime\"]')?.scrollIntoView({ block: 'center' })");
            click('[data-summary-mode="alltime"]');
            assert(evaluate("document.querySelector('#calSummaryAllTime')?.checkVisibility()"), 'calendar all-time summary is visible');
            click('[data-summary-mode="monthly"]');
            assert(evaluate("document.querySelector('#calSummaryMonthly')?.checkVisibility()"), 'calendar monthly summary is restored');

            // v1.17.6 Calendar heatmap, source filters, metric/period/view toggles & export triggers
            assert(evaluate("document.querySelectorAll('#tab-calendar .cal-hm-cell').length >= 28"),
                'Calendar renders 52-week contribution heatmap cells');
            evaluate("document.querySelector('#tab-calendar [data-action=\"calendarFilterSource\"]')?.scrollIntoView({ block: 'center' })");
            click('#tab-calendar [data-action="calendarFilterSource"][data-cal-source="ide"]');
            assert(evaluate("testState.messages.some(m => m.command === 'calendarFilterSource' && m.source === 'ide')"),
                'Calendar source filter posts calendarFilterSource');
            click('#tab-calendar [data-action="calendarSetMetric"][data-cal-metric="cost"]');
            assert(evaluate("testState.messages.some(m => m.command === 'calendarSetMetric' && m.metric === 'cost')"),
                'Calendar metric toggle posts calendarSetMetric');
            click('#tab-calendar [data-action="calendarSetPeriod"][data-cal-period="weekly"]');
            assert(evaluate("testState.messages.some(m => m.command === 'calendarSetPeriod' && m.period === 'weekly')"),
                'Calendar period tab posts calendarSetPeriod');
            click('#tab-calendar [data-action="calendarSetView"][data-cal-view="monthGrid"]');
            assert(evaluate("testState.messages.some(m => m.command === 'calendarSetView' && m.view === 'monthGrid')"),
                'Calendar view toggle posts calendarSetView');
            click('#tab-calendar [data-action="calendarExportCsv"]');
            assert(evaluate("testState.messages.some(m => m.command === 'calendarExportCsv')"),
                'Calendar CSV export posts calendarExportCsv');
            click('#tab-calendar [data-action="calendarExportJson"]');
            assert(evaluate("testState.messages.some(m => m.command === 'calendarExportJson')"),
                'Calendar JSON export posts calendarExportJson');

            // Two-step safe Clear History confirmation flow
            assert.equal(evaluate("Boolean(document.querySelector('#calClearConfirmBar')?.hidden)"), true,
                '#calClearConfirmBar starts hidden');
            evaluate("document.querySelector('#clearCalendarBtn')?.scrollIntoView({ block: 'center' })");
            click('#clearCalendarBtn');
            assert.equal(evaluate("Boolean(document.querySelector('#calClearConfirmBar')?.hidden)"), false,
                '#clearCalendarBtn arms confirmation bar without immediately clearing');
            assert.equal(evaluate("testState.messages.some(m => m.command === 'clearCalendarHistory')"), false,
                'First click on #clearCalendarBtn must NOT post clearCalendarHistory');
            evaluate("document.querySelector('#cancelClearCalendarBtn')?.scrollIntoView({ block: 'center' })");
            click('#cancelClearCalendarBtn');
            assert.equal(evaluate("Boolean(document.querySelector('#calClearConfirmBar')?.hidden)"), true,
                '#cancelClearCalendarBtn dismisses confirmation bar safely');
            assert.equal(evaluate("testState.messages.some(m => m.command === 'clearCalendarHistory')"), false,
                'Cancel must NOT post clearCalendarHistory');
            evaluate("document.querySelector('#clearCalendarBtn')?.scrollIntoView({ block: 'center' })");
            click('#clearCalendarBtn');
            evaluate("document.querySelector('#confirmClearCalendarBtn')?.scrollIntoView({ block: 'center' })");
            click('#confirmClearCalendarBtn');
            assert(evaluate("testState.messages.some(m => m.command === 'clearCalendarHistory')"),
                '#confirmClearCalendarBtn posts clearCalendarHistory');
            assert.equal(evaluate("Boolean(document.querySelector('#calClearConfirmBar')?.hidden)"), true,
                'Confirmation bar hides after confirming clear');
            assert.deepEqual(evaluate('testState.errors'), []);
        }, reopen);
    }

    function testProfileInteractions(theme, reopen) {
        test(`${theme} Profile privacy toggle, billing-day spinner/save, plan details disclosure and a11y`, () => {
            selectTab('profile');
            const identity = () => evaluate("document.querySelector('#tab-profile .account-name')?.innerText");
            const masked = () => evaluate("document.querySelector('#privacyToggle').getAttribute('aria-pressed')");
            assert.equal(identity(), 'S***', 'account name is masked when Profile opens');
            assert.equal(masked(), 'true');
            click('#privacyToggle');
            assert.equal(identity(), 'Sample account', 'privacy control reveals synthetic account');
            assert.equal(masked(), 'false');
            click('#privacyToggle');
            assert.equal(identity(), 'S***', 'privacy mask can be restored');
            assert.equal(masked(), 'true');

            // Billing day spinner + valid save + invalid guard
            const profileSpinners = evaluate(`[...document.querySelectorAll('#tab-profile .num-spinner-btn')].map(b => b.getAttribute('aria-label'))`);
            assert.equal(profileSpinners.length, 2);
            assert(profileSpinners.every(Boolean), 'Profile spinner buttons have aria-labels');
            click('#tab-profile .num-spinner-btn.increment');
            assert.equal(evaluate("document.querySelector('#profileBillingDayInput').value"), '1');
            browser(['fill', '#profileBillingDayInput', '15']);
            click('#profileBillingDaySaveBtn');
            assert(evaluate("testState.messages.some(m => m.command === 'setAccountBillingDay' && m.email === 'sample@example.invalid' && m.day === 15)"),
                'Valid billing day posts setAccountBillingDay');
            evaluate("window.dispatchEvent(new MessageEvent('message', { data: { command: 'configSaved', key: 'accountBillingDay' } }))");
            assert.equal(evaluate("document.querySelector('#profileBillingDayFeedback')?.textContent"), '✓');

            const beforeBillingCount = evaluate("testState.messages.filter(m => m.command === 'setAccountBillingDay').length");
            browser(['fill', '#profileBillingDayInput', '99']);
            click('#profileBillingDaySaveBtn');
            assert.equal(evaluate("testState.messages.filter(m => m.command === 'setAccountBillingDay').length"), beforeBillingCount,
                'Invalid billing day does not post setAccountBillingDay');
            assert(/Invalid|无效/.test(evaluate("document.querySelector('#profileBillingDayFeedback')?.textContent || ''")),
                'Invalid billing day displays feedback');

            // Plan limits & capabilities disclosure
            assert(evaluate("!document.querySelector('.profile-technical').open"), 'technical data is collapsed by default');
            browser(['focus', '.profile-technical summary']);
            browser(['press', 'Enter']);
            assert(evaluate("document.querySelector('.profile-technical').open"), 'technical data opens by keyboard');
            audit('#tab-profile');

            // Profile model action navigates to Models tab
            browser(['focus', '.profile-quota [data-overview-target="models"]']);
            browser(['press', 'Enter']);
            assert(evaluate("Boolean(document.querySelector('#tab-models.active'))"), 'Profile model action opens Models pane');
            assert.deepEqual(evaluate('testState.errors'), []);
        }, reopen);
    }

    async function testModelDNADisclosures(panel, configs, gmSummary) {
        const baseHtml = await panel.render('both', configs);
        const configsWithMime = configs.map(c => ({ ...c, supportedMimeTypes: ['image/png', 'application/pdf'] }));
        const dnaHtml = panel.renderModelDNA(gmSummary, configsWithMime);
        const injected = baseHtml.replace('</div>\n    <div class="tab-pane" id="tab-models">', `${dnaHtml}</div>\n    <div class="tab-pane" id="tab-models">`);
        test('Cost/Model DNA #d-model-mime-* and #d-model-tech-* disclosures toggle by keyboard', () => {
            open(browserFixture(injected, 'vscode-dark', themeTokens['vscode-dark']), 960);
            selectTab('pricing');
            const mimeId = evaluate("document.querySelector('#tab-pricing details[id^=\"d-model-mime-\"]')?.id || ''");
            const techId = evaluate("document.querySelector('#tab-pricing details[id^=\"d-model-tech-\"]')?.id || ''");
            assert(mimeId, 'Model DNA MIME disclosure renders');
            assert(techId, 'Model DNA Technical Params disclosure renders');
            assert.equal(evaluate(`document.getElementById(${JSON.stringify(mimeId)}).open`), false);
            assert.equal(evaluate(`document.getElementById(${JSON.stringify(techId)}).open`), false);
            browser(['focus', `#${mimeId} > summary`]);
            browser(['press', 'Enter']);
            assert.equal(evaluate(`document.getElementById(${JSON.stringify(mimeId)}).open`), true, 'MIME disclosure opens by keyboard');
            browser(['focus', `#${techId} > summary`]);
            browser(['press', 'Enter']);
            assert.equal(evaluate(`document.getElementById(${JSON.stringify(techId)}).open`), true, 'Tech disclosure opens by keyboard');
            audit('#tab-pricing');
            assert.deepEqual(evaluate('testState.errors'), []);
        }, true);
    }

    async function testUnknownCreditsAcrossThemes(panel, configs, fixtures, smokeMode) {
        const testLangs = smokeMode ? ['both'] : Object.keys(languages);
        for (const lang of testLangs) {
            const labels = languages[lang];
            const html = await panel.render(lang, configs, fixtures.unknownCredits);
            for (const theme of ['vscode-light', 'vscode-dark']) {
                test(`unknown AI credits never render as 0 (${lang} ${theme})`, () => {
                    open(browserFixture(html, theme, themeTokens[theme]), 960);
                    const overviewFooter = evaluate("document.querySelector('#tab-overview .overview-footer')?.innerText || ''");
                    assert(overviewFooter.includes(labels.notReported),
                        `Overview footer shows "${labels.notReported}" when AI credits unknown: ${overviewFooter}`);
                    assert(!/\b0\b/.test(overviewFooter), `Overview footer must never fabricate 0 for unknown credits: ${overviewFooter}`);
                    assert(!/8,765|7,654|\b(?:Prompt|Flow)\s+(?:Credits|额度)/i.test(overviewFooter),
                        'Overview ignores legacy Prompt/Flow balances');

                    selectTab('profile');
                    const profileCredit = evaluate(`(() => {
                        const val = document.querySelector('#tab-profile .profile-credit-balance .gai-value');
                        return { text: val?.innerText.trim() || '', unreported: Boolean(val?.classList.contains('is-unreported')) };
                    })()`);
                    assert.equal(profileCredit.unreported, true, 'Profile unknown credit carries .is-unreported');
                    assert.equal(profileCredit.text, labels.notReported, 'Profile shows Not reported / 未上报 when credits unknown');
                    assert.notEqual(profileCredit.text, '0', 'Profile never fabricates 0 for unknown credits');
                    audit('#tab-profile');
                }, true);
            }
        }
    }

    function testStatusBarHoverMatrix(panel, configs, multiFamilyConfigs, activeUsage, gmSummary, quotaSummary, lang) {
        test(`${lang} StatusBarManager overhauled hover (compact/normal/full), Orchestrator route+split, Latest Call, Dual-Window quota, alerts, USD session cost & footer`, () => {
            const gluedRe = /\b\d+(?:\.\d+)?(?:tok\/s|credits|tools|calls|cache|in|out)\b/;
            const checkCopyGuards = (text, tooltip, label) => {
                assert(!/令牌/.test(text) && !/令牌/.test(tooltip), `${label}: zero 令牌`);
                assert(!/\bCNY\b|¥/.test(text) && !/\bCNY\b|¥/.test(tooltip), `${label}: USD-only (zero CNY/¥)`);
                assert(!gluedRe.test(text) && !gluedRe.test(tooltip), `${label}: zero glued numeric units`);
                assert(!/(?:^|\s)(?:NaN|Infinity|Invalid Date)(?:\s|$)/.test(tooltip), `${label}: zero invalid numerics`);
            };

            // 1. Full density with 5h-only fallback (quotaSummary: null) + known credits
            const fullMerged = panel.renderStatusBar('full', multiFamilyConfigs, {
                usage: activeUsage, credits: 1200, billingDay: 15, planName: 'Pro', tierName: 'Google AI Pro',
            });
            checkCopyGuards(fullMerged.text, fullMerged.tooltip, `${lang} fullMerged`);
            assert(fullMerged.text.includes('$(zap) 1,200'), 'Status bar renders known AI credits');
            assert(fullMerged.tooltip.includes('**214,500** / 512,000'), `Full density renders comma-formatted context tokens: ${fullMerged.tooltip}`);
            assert(fullMerged.tooltip.includes('**1,200**'), 'Full density renders bold known credits');
            assert(fullMerged.tooltip.includes('Gemini') && fullMerged.tooltip.includes('Claude / GPT'),
                'Full density quota table renders both shared pools');
            assert(/\| (?:Pool|额度池|Pool \/ 额度池) \| (?:Remaining|剩余|Remaining \/ 剩余) \|/.test(fullMerged.tooltip),
                `5h-only fallback renders 3-column Remaining table: ${fullMerged.tooltip}`);

            // 2. Auto density (normal zoom=0 vs high zoom=3 -> compact)
            const autoNormal = panel.renderStatusBar('auto', configs, {
                usage: activeUsage, credits: 1200, billingDay: 15, zoomLevel: 0,
            });
            assert(autoNormal.tooltip.includes('**214.5k** / 512k'), 'Auto density renders compact token counts');
            assert(/\| (?:Pool|额度池|Pool \/ 额度池|\$\(shield\) \*\*[^*]+\*\*) \|/.test(autoNormal.tooltip),
                `Auto density at zoom 0 renders GFM quota table: ${autoNormal.tooltip}`);

            const autoHighZoom = panel.renderStatusBar('auto', configs, {
                usage: activeUsage, credits: 1200, billingDay: 15, zoomLevel: 3,
            });
            assert(!/\| (?:Pool|额度池|Pool \/ 额度池|\$\(shield\) \*\*[^*]+\*\*) \|/.test(autoHighZoom.tooltip),
                'Auto density at high zoom compacts away GFM quota table');

            // 3. Compact density
            const compact = panel.renderStatusBar('compact', configs, {
                usage: activeUsage, credits: 1200, billingDay: 15,
            });
            assert(compact.tooltip.includes('$(layers)'), 'Compact hover renders single-line pool summary rows');
            assert(compact.tooltip.includes('**1,200**'), 'Compact hover preserves known credits');
            checkCopyGuards(compact.text, compact.tooltip, `${lang} compact`);

            // 4. Unknown (null) vs explicit zero (0) AI credits
            const unknownCredits = panel.renderStatusBar('full', configs, {
                usage: activeUsage, credits: null, billingDay: 15,
            });
            assert(!unknownCredits.text.includes('$(zap)'), 'Unknown credits omit $(zap) from status bar');
            assert(!unknownCredits.tooltip.includes('**0**'), 'Unknown credits never render **0** in hover');
            assert(/Not reported|未上报/.test(unknownCredits.tooltip), 'Unknown credits with billing day show Not reported / 未上报');

            const explicitZero = panel.renderStatusBar('full', configs, {
                usage: activeUsage, credits: 0, billingDay: 15,
            });
            assert(explicitZero.text.includes('$(zap) 0'), 'Explicit 0 credits render $(zap) 0 in status bar');
            assert(explicitZero.tooltip.includes('**0**'), 'Explicit 0 credits render **0** in hover');

            // 5. Conflicting tier readings display range
            const split = configs.map((item, index) => index ? item : { ...item, quotaInfo: { ...item.quotaInfo, remainingFraction: 0.25 } });
            const different = panel.renderHover('full', split);
            assert(different.includes('25–52%'), 'Conflicting tier readings display a range rather than a false single reading');

            // 6. Telemetry opt-in defaults, cold-start hiding, and compact/auto/full hover telemetry
            const defaultOptOut = panel.renderStatusBar('auto', configs, {
                usage: activeUsage, credits: 1200, gmSummary, activeCascadeId: activeUsage.cascadeId,
            });
            assert(!/tok\/s/.test(defaultOptOut.text), `showSpeed defaults off in status bar: ${defaultOptOut.text}`);
            assert(!/\bCache\b|缓存/.test(defaultOptOut.text), `showCacheHit defaults off in status bar: ${defaultOptOut.text}`);
            assert(!/\$\(credit-card\)/.test(defaultOptOut.text), `showSessionCost defaults off in status bar: ${defaultOptOut.text}`);
            assert(/Speed & Prompt Cache|速度与提示词缓存/.test(defaultOptOut.tooltip),
                'Auto hover includes Speed & Prompt Cache even when status bar pills are opt-out');
            assert(defaultOptOut.tooltip.includes('86.7 tok/s') && defaultOptOut.tooltip.includes('79.2 tok/s') && defaultOptOut.tooltip.includes('53.1 tok/s'),
                `Auto hover includes latest, weighted avg, and thinking resp speed: ${defaultOptOut.tooltip}`);
            assert(defaultOptOut.tooltip.includes('780ms') && defaultOptOut.tooltip.includes('2.15s') && defaultOptOut.tooltip.includes('-64%'),
                `Auto hover includes Cached vs Uncached TTFT and -64% delta: ${defaultOptOut.tooltip}`);
            assert(defaultOptOut.tooltip.includes('72.7%') && defaultOptOut.tooltip.includes('60k/82.5k tokens') && defaultOptOut.tooltip.includes('2/3'),
                `Auto hover includes token-weighted Prompt Cache breakdown: ${defaultOptOut.tooltip}`);
            assert(!/\$0\.00\b/.test(defaultOptOut.tooltip), 'Unpriced active conversation hover never fabricates $0.00 savings');
            checkCopyGuards(defaultOptOut.text, defaultOptOut.tooltip, `${lang} defaultOptOut`);

            const optInEnabled = panel.renderStatusBar('compact', configs, {
                usage: activeUsage, credits: 1200, gmSummary, activeCascadeId: activeUsage.cascadeId,
                displayPrefs: { showSpeed: true, showCacheHit: true },
            });
            assert(optInEnabled.text.includes('$(pulse) 86.7 tok/s'), `Opt-in showSpeed renders $(pulse) 86.7 tok/s: ${optInEnabled.text}`);
            const expectedCacheSeg = lang === 'zh' ? '缓存 72.7%' : 'Cache 72.7%';
            assert(optInEnabled.text.includes(expectedCacheSeg), `Opt-in showCacheHit renders ${expectedCacheSeg}: ${optInEnabled.text}`);
            assert(optInEnabled.a11y?.label?.includes('86.7 tok/s') && !/\$\(pulse\)/.test(optInEnabled.a11y?.label || ''),
                `Status bar a11y label humanizes $(pulse) speed: ${optInEnabled.a11y?.label}`);
            assert(/Speed & Prompt Cache|速度与提示词缓存/.test(optInEnabled.tooltip)
                && optInEnabled.tooltip.includes('**86.7 tok/s**')
                && optInEnabled.tooltip.includes('1.24s')
                && optInEnabled.tooltip.includes('72.7%'),
                `Compact hover shows tight single-line Speed/TTFT/Cache: ${optInEnabled.tooltip}`);
            checkCopyGuards(optInEnabled.text, optInEnabled.tooltip, `${lang} optInEnabled`);

            // Cold-start / null telemetry hiding (never flashes 0 tok/s, 0%, or $0.00)
            const coldStart = panel.renderStatusBar('auto', configs, {
                usage: activeUsage, credits: 1200, gmSummary: null,
                displayPrefs: { showSpeed: true, showCacheHit: true, showSessionCost: true },
            });
            assert(!/tok\/s|\bCache\b|缓存|\b0%|\$\(credit-card\)/.test(coldStart.text),
                `Cold start with opt-in flags enabled never flashes 0 tok/s, 0%, or $0.00: ${coldStart.text}`);
            assert(!/Speed & Prompt Cache|速度与提示词缓存/.test(coldStart.tooltip),
                'Cold start hover omits telemetry section');

            // Full hover (session scope with priced Claude calls -> p50 + write volume + priced USD savings + Latest Call 4-col table)
            const fullSession = panel.renderStatusBar('full', configs, {
                usage: activeUsage, credits: 1200, gmSummary,
                displayPrefs: { showSpeed: true, showCacheHit: true },
            });
            assert(fullSession.tooltip.includes('p50') && fullSession.tooltip.includes('70.9%')
                && fullSession.tooltip.includes('6k') && /\$0\.(?:39|22)/.test(fullSession.tooltip)
                && fullSession.tooltip.includes('-65%'),
                `Full session hover shows p50, write volume, -65% TTFT speedup, and priced USD savings: ${fullSession.tooltip}`);
            assert(/\| (?:In \/ Out|输入 \/ 输出|In \/ Out \/ 输入 \/ 输出) \|/.test(fullSession.tooltip),
                `Full session hover includes Latest Call 4-column micro-table: ${fullSession.tooltip}`);
            assert(!/\$0\.00\b/.test(fullSession.tooltip), 'Full session hover has zero fake $0.00');
            checkCopyGuards(fullSession.text, fullSession.tooltip, `${lang} fullSession`);

            // 7. v1.17.3 Orchestrator cross-pool route + Split + Latest Call + Dual-Window Quota + USD cost + Retry Waste + 1-click Footer
            const nowIso = new Date().toISOString();
            const orchGmSummary = {
                totalCalls: 2, totalInputTokens: 14543, totalOutputTokens: 888, totalThinkingTokens: 320,
                totalCacheRead: 298153, totalCacheCreation: 0, totalCredits: 0, totalErrors: 0,
                totalRetryCount: 1, totalRetryTokens: 5000, retryErrorCodes: { '429': 1 },
                modelBreakdown: {}, toolCallCounts: {}, toolCatalog: [], uniqueErrors: [],
                conversations: [{
                    cascadeId: 'orch-hover', title: 'Cross-pool refactor', totalSteps: 6, checkpointSummaries: [],
                    calls: [
                        {
                            stepIndices: [1], executionId: 'p1', model: 'MODEL_PLACEHOLDER_M401',
                            modelDisplay: 'Claude Opus 5.5 (Medium)', responseModel: 'claude-opus-5-5', modelAccuracy: 'exact',
                            inputTokens: 10000, outputTokens: 500, thinkingTokens: 200, responseTokens: 300,
                            cacheReadTokens: 80000, cacheCreationTokens: 0, apiProvider: 'ANTHROPIC_VERTEX',
                            ttftSeconds: 1.5, streamingSeconds: 3.0, credits: 0, creditType: '', hasError: false, errorMessage: '',
                            contextTokensUsed: 90000, completionConfig: null, systemPromptSnippet: '', toolCount: 0, toolNames: [],
                            promptSectionTitles: [], promptSnippet: '', promptSource: '', messagePromptCount: 0,
                            messageMetadataKeys: [], responseHeaderKeys: [], userMessageAnchors: [], aiSnippetsByStep: {},
                            retries: 0, stopReason: 'STOP_REASON_END_TURN', retryTokensIn: 0, retryTokensOut: 0, retryCredits: 0,
                            retryErrors: [], timeSinceLastInvocation: 0, tokenBreakdownGroups: [], createdAt: nowIso,
                            latestStableMessageIndex: 0, startStepIndex: 1, checkpointIndex: 0, systemContextItems: [],
                            accountEmail: 'sample@example.invalid', toolCallsByStep: {}, contextWindowCapacity: 256000,
                        },
                        {
                            stepIndices: [2], executionId: 'e1', model: 'MODEL_PLACEHOLDER_M528',
                            modelDisplay: 'Gemini 4 Hydrogen (XHigh)', responseModel: 'gemini-4-hydrogen', modelAccuracy: 'exact',
                            inputTokens: 4543, outputTokens: 388, thinkingTokens: 120, responseTokens: 268,
                            cacheReadTokens: 218153, cacheCreationTokens: 0, apiProvider: 'GOOGLE_GEMINI',
                            ttftSeconds: 6.0, streamingSeconds: 2.5, credits: 0, creditType: '', hasError: false, errorMessage: '',
                            contextTokensUsed: 223000, completionConfig: null, systemPromptSnippet: '', toolCount: 0, toolNames: [],
                            promptSectionTitles: [], promptSnippet: '', promptSource: '', messagePromptCount: 0,
                            messageMetadataKeys: [], responseHeaderKeys: [], userMessageAnchors: [], aiSnippetsByStep: {},
                            retries: 1, stopReason: 'STOP_REASON_END_TURN', retryTokensIn: 5000, retryTokensOut: 0, retryCredits: 0,
                            retryErrors: ['RESOURCE_EXHAUSTED (code 429)'], timeSinceLastInvocation: 0, tokenBreakdownGroups: [],
                            createdAt: new Date(Date.now() + 1000).toISOString(), latestStableMessageIndex: 0, startStepIndex: 2,
                            checkpointIndex: 0, systemContextItems: [], accountEmail: 'sample@example.invalid',
                            toolCallsByStep: {}, contextWindowCapacity: 512000,
                        },
                    ],
                }],
            };
            const orchHoverUsage = {
                ...activeUsage,
                cascadeId: 'orch-hover',
                model: 'MODEL_PLACEHOLDER_M401',
                modelDisplayName: 'Claude Opus 5.5 (Medium)',
                orchestratorConfig: { planModel: 'MODEL_PLACEHOLDER_M401', executionModel: 'MODEL_PLACEHOLDER_M528' },
            };
            const orchUsd = panel.renderStatusBar('full', configs, {
                usage: orchHoverUsage, credits: 1200, billingDay: 15, planName: 'Pro', tierName: 'Google AI Pro',
                quotaSummary, gmSummary: orchGmSummary, activeCascadeId: 'orch-hover',
                costSnapshot: { todayCostUsd: 1.5, todayHasUnpriced: false },
                displayPrefs: { showSessionCost: true },
            });
            assert(orchUsd.text.includes('$(credit-card) $'), `Opt-in showSessionCost renders USD cost pill: ${orchUsd.text}`);
            assert(/Orchestrator|编排/.test(orchUsd.tooltip) && /Cross-pool|跨池/.test(orchUsd.tooltip),
                `Orchestrator cross-pool header renders in ${lang}: ${orchUsd.tooltip}`);
            assert(orchUsd.tooltip.includes('Claude Opus 5.5 (Medium)') && orchUsd.tooltip.includes('Gemini 4 Hydrogen'),
                `Orchestrator route shows Planner -> Executor pair: ${orchUsd.tooltip}`);
            assert(/Split|编排拆分/.test(orchUsd.tooltip), `Orchestrator Split breakdown renders: ${orchUsd.tooltip}`);
            assert(orchUsd.tooltip.includes('`gemini-4-hydrogen`') && orchUsd.tooltip.includes('6.00s / 8.50s') && orchUsd.tooltip.includes('155.2 tok/s'),
                `Latest Call micro-table renders model, total latency & speed: ${orchUsd.tooltip}`);
            assert(orchUsd.tooltip.includes('$') && !orchUsd.tooltip.includes('¥'), 'USD-only formatting applied across hover');
            assert(/\| (?:Pool|额度池|Pool \/ 额度池) \| 5h \| (?:Weekly|周额度|Weekly \/ 周额度) \|/.test(orchUsd.tooltip),
                `Dual-Window 5h | Weekly quota table renders: ${orchUsd.tooltip}`);
            assert(orchUsd.tooltip.includes('**84%**') && orchUsd.tooltip.includes('**96%**'),
                `Dual-Window weekly percentages render (84% / 96%): ${orchUsd.tooltip}`);
            assert(/Planner|规划/.test(orchUsd.tooltip) && /Executor|执行/.test(orchUsd.tooltip),
                'Dual-Window quota table marks Planner & Executor pools');
            assert(/Retry Waste|重试开销/.test(orchUsd.tooltip) && orchUsd.tooltip.includes('`429`'),
                'Retry Waste alert renders with error code 429');
            // Pinned 1-click footer links & trust allowlist
            for (const dest of ['overview', 'gmdata', 'pricing', 'models', 'settings']) {
                assert(orchUsd.tooltip.includes(`antigravity-context-monitor.showDetails?${encodeURIComponent(JSON.stringify([dest]))}`),
                    `Footer includes 1-click link to ${dest}`);
            }
            assert(orchUsd.tooltip.includes('command:antigravity-context-monitor.refresh'), 'Footer includes Refresh command link');
            assert(orchUsd.isTrusted?.enabledCommands?.includes('antigravity-context-monitor.showDetails')
                && orchUsd.isTrusted?.enabledCommands?.includes('antigravity-context-monitor.refresh'),
                'MarkdownString.isTrusted allowlists showDetails and refresh');
            checkCopyGuards(orchUsd.text, orchUsd.tooltip, `${lang} orchUsd`);

            // 8. Smart alerts: Carbon 14-day rate-change countdown (before 2026-12-01) & GPT-OSS Notice sunset
            if (Date.now() < Date.parse('2026-12-01T00:00:00Z')) {
                const carbonAlert = panel.renderStatusBar('full', configs, {
                    usage: { ...activeUsage, model: 'MODEL_PLACEHOLDER_M427', modelDisplayName: 'Gemini 4 Carbon (High)' },
                });
                assert(carbonAlert.tooltip.includes('2026-12-01') && /Price Notice|调价提醒/.test(carbonAlert.tooltip),
                    `Carbon active model renders 2026-12-01 rate-change countdown: ${carbonAlert.tooltip}`);
            }
            const gptNotice = panel.renderStatusBar('full', configs, {
                usage: { ...activeUsage, model: 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM', modelDisplayName: 'GPT-OSS 120B (Medium)' },
                quotaSummary: null,
            });
            assert(/Notice|提示/.test(gptNotice.tooltip) && gptNotice.tooltip.includes('Model will be deprecated soon'),
                `GPT-OSS 120B active model renders Notice sunset alert: ${gptNotice.tooltip}`);
            assert(!/\| 5h \| (?:Weekly|周额度)/.test(gptNotice.tooltip),
                'Clearing quotaSummary falls back cleanly to 5h-only 3-col table');
            checkCopyGuards(gptNotice.text, gptNotice.tooltip, `${lang} gptNotice`);

            // 9. Disconnected state omits stale telemetry
            const disconnectedHover = panel.renderStatusBar('full', configs, {
                state: 'disconnected', gmSummary,
                displayPrefs: { showSpeed: true, showCacheHit: true, showSessionCost: true },
            });
            assert(!/Speed & Prompt Cache|速度与提示词缓存|tok\/s/.test(disconnectedHover.tooltip),
                'Disconnected hover hides stale telemetry');
        });
    }

    async function testV1173DeepSuite(panel, configs, fixtures, smokeMode) {
        const testLangs = smokeMode ? ['both'] : Object.keys(languages);
        const themes = ['vscode-light', 'vscode-dark'];

        // 1. Models tab: Default Orchestrator Settings (Neon XHigh + Hydrogen XHigh), Custom Cross-Pool (Opus 5.5 + Hydrogen / Sonnet 5.5),
        //    USD-only .spec-price-row, and honest Unpriced on M537/M667/M681/M669/M21
        for (const lang of testLangs) {
            const labels = languages[lang];
            const defaultHtml = await panel.render(lang, configs, {
                ...fixtures.populated,
                orchestratorSettings: fixtures.v1173.orchestratorSettingsDefault,
                quotaSummary: fixtures.v1173.quotaSummaryPrecision,
            });
            for (const theme of themes) {
                test(`v1.17.3 Models Default Orchestrator Settings, 99.3%/99.8% dual quota & a11y (${lang} ${theme})`, () => {
                    open(browserFixture(defaultHtml, theme, themeTokens[theme]), 320);
                    selectTab('models');
                    const report = evaluate(measurements);
                    assert.equal(report.overflow, false, 'Models default Orchestrator fits at 320px');
                    assert.equal(report.orchSettings?.mode, 'default', 'Default mode attribute is set');
                    assert(report.orchSettings.orchestrator.includes('Gemini 4 Neon')
                        && (lang === 'zh' ? report.orchSettings.orchestrator.includes('超高') : report.orchSettings.orchestrator.includes('Extra High')),
                        `Default Orchestrator displays Neon Extra High: ${report.orchSettings.orchestrator}`);
                    assert(report.orchSettings.executor.includes('Gemini 4 Hydrogen')
                        && (lang === 'zh' ? report.orchSettings.executor.includes('超高') : report.orchSettings.executor.includes('Extra High')),
                        `Default Executor displays Hydrogen Extra High: ${report.orchSettings.executor}`);
                    const geminiPool = report.pools.find(p => p.group === 'Gemini');
                    assert.equal(geminiPool?.dualWindows?.['5h'], '99.3%', 'Gemini 5h avoids false 100% rounding (99.3%)');
                    assert.equal(geminiPool?.dualWindows?.weekly, '99.8%', 'Gemini Weekly avoids false 100% rounding (99.8%)');
                    const claudePool = report.pools.find(p => p.group === 'Claude / GPT');
                    assert.equal(claudePool?.dualWindows?.['5h'], '72%', 'Claude/GPT 5h renders 72%');
                    assert.equal(claudePool?.dualWindows?.weekly, '100%', 'Claude/GPT Weekly renders 100%');
                    assert(claudePool?.noticeTags?.length >= 1, 'Claude/GPT pool renders GPT-OSS Notice badge');
                    audit('#tab-models');
                    assert.deepEqual(report.errors, []);
                }, true);
            }

            // Custom Orchestrator (Claude Opus 5.5 Medium + Claude Sonnet 5.5 Medium) + USD-only verification across Overview, Models, Calendar, Settings
            const customSonnetHtml = await panel.render(lang, configs, {
                ...fixtures.populated,
                orchestratorSettings: fixtures.v1173.orchestratorSettingsCustomSonnet,
            });
            test(`v1.17.6 Models Custom Opus+Sonnet Orchestrator, mapped/strict rates, Overview/Calendar/Settings & Native HUD (${lang})`, () => {
                open(browserFixture(customSonnetHtml, 'vscode-dark', themeTokens['vscode-dark']), 960);
                // Overview default USD cost
                const ovText = evaluate("document.querySelector('#tab-overview')?.innerText || ''");
                assert(ovText.includes('$0.45') && ovText.includes('$1.25'),
                    `Overview renders Session & Today cost in USD: ${ovText}`);
                assert(!/\bCNY\b|¥/.test(ovText), 'Overview renders strictly in USD with zero CNY/¥');
                assert(!/令牌/.test(ovText), 'Overview has zero 令牌');

                // Models tab custom Opus + Sonnet + mapped Orchestrator base rates
                selectTab('models');
                const report = evaluate(measurements);
                assert.equal(report.orchSettings?.mode, 'custom');
                assert(report.orchSettings.orchestrator.includes('Claude Opus 5.5 (Medium)'));
                assert(report.orchSettings.executor.includes('Claude Sonnet 5.5 (Medium)'));
                const neonSpec = report.entries.find(e => e.model === 'MODEL_PLACEHOLDER_M535');
                assert(neonSpec?.priceText.includes('$3/M') && neonSpec.priceText.includes('$15/M') && neonSpec.priceText.includes('$0.15/M'),
                    `Neon .spec-price-row renders official USD rates: ${neonSpec?.priceText}`);
                assert(!/\bCNY\b|¥/.test(neonSpec?.priceText || ''), 'Neon .spec-price-row is USD-only');
                const sonnetSpec = report.entries.find(e => e.model === 'MODEL_PLACEHOLDER_M404');
                assert(sonnetSpec?.priceText.includes('$0.10/M') && !/\bCNY\b|¥/.test(sonnetSpec.priceText),
                    `Claude Sonnet 5.5 .spec-price-row renders corrected $0.10/M USD cache read: ${sonnetSpec?.priceText}`);
                for (const orchId of ['MODEL_PLACEHOLDER_M537', 'MODEL_PLACEHOLDER_M667', 'MODEL_PLACEHOLDER_M681']) {
                    const card = report.entries.find(e => e.model === orchId);
                    assert.equal(card?.priceState, 'mapped', `${orchId} shows mapped base rate in default mapped mode`);
                    assert(!/\$0\.00/.test(card?.priceText || ''), `${orchId} never fabricates $0.00`);
                }
                audit('#tab-models');

                // Calendar tab default USD rendering & heatmap
                selectTab('calendar');
                const calText = evaluate("document.querySelector('#tab-calendar')?.innerText || ''");
                assert(/\$\d+\.\d{2}/.test(calText),
                    `Calendar tab renders USD totals: ${calText.slice(0, 260)}`);
                assert(!/\bCNY\b|¥/.test(calText), 'Calendar tab renders strictly in USD with zero CNY/¥');
                assert(evaluate("document.querySelectorAll('#tab-calendar .cal-hm-cell').length >= 28"),
                    'Calendar tab renders heatmap cells');
                audit('#tab-calendar');

                // Settings tab v1.17.6 cards ($0.27 preview + Overlays + Updates + Cost/Currency/History)
                selectTab('settings');
                const stgText = evaluate("document.querySelector('#tab-settings')?.innerText || ''");
                assert(stgText.includes('$0.27'), 'Settings tab renders $0.27 USD preview on #toggleSessionCost');
                assert(evaluate("Boolean(document.querySelector('#appOverlaysCard'))"), 'Settings renders Overlays & HUD card');
                assert(evaluate("Boolean(document.querySelector('#updatesSettingsCard'))"), 'Settings renders Updates card');
                assert(evaluate("Boolean(document.querySelector('#displayCurrencySelect'))"), 'Settings renders Display Currency select');
                assert(evaluate("Boolean(document.querySelector('#stgOrchModeMapped') && document.querySelector('#stgOrchModeStrict'))"),
                    'Settings renders Orchestrator Pricing Mode segmented toggle');
                audit('#tab-settings');
                assert.deepEqual(evaluate('testState.errors'), []);
            }, true);

            // Native Ambient HUD bar render & expand/collapse toggle
            const hudHtml = await panel.render(lang, configs, {
                ...fixtures.populated,
                showNativeHudBar: true,
            });
            test(`v1.17.6 Native Ambient HUD renders and toggles drawer (${lang})`, () => {
                open(browserFixture(hudHtml, 'vscode-dark', themeTokens['vscode-dark']), 960);
                assert.equal(evaluate("Boolean(document.querySelector('#nativeHudHost')?.hidden)"), false,
                    '#nativeHudHost is visible when showNativeHudBar is enabled');
                assert(evaluate("Boolean(document.querySelector('#nativeHudBar'))"), '#nativeHudBar renders inside #nativeHudHost');
                assert.equal(evaluate("Boolean(document.querySelector('#nativeHudDrawer')?.hidden)"), true,
                    '#nativeHudDrawer starts collapsed');
                click('#nativeHudToggle');
                assert.equal(evaluate("Boolean(document.querySelector('#nativeHudDrawer')?.hidden)"), false,
                    '#nativeHudToggle expands #nativeHudDrawer');
                assert(evaluate("testState.messages.some(m => m.command === 'toggleNativeHud' && m.expanded === true)"),
                    '#nativeHudToggle posts toggleNativeHud expanded=true');
                click('#nativeHudToggle');
                assert.equal(evaluate("Boolean(document.querySelector('#nativeHudDrawer')?.hidden)"), true,
                    '#nativeHudToggle collapses #nativeHudDrawer');
                audit('#nativeHudHost');
                assert.deepEqual(evaluate('testState.errors'), []);
            }, true);

            // Overview 5h-only fallback (quotaSummary: null, no orchestratorConfig)
            const fallbackHtml = await panel.render(lang, configs, {
                ...fixtures.populated,
                currentUsage: { ...fixtures.populated.currentUsage, orchestratorConfig: undefined },
                orchestratorSettings: null,
                quotaSummary: null,
            });
            test(`v1.17.3 Overview & Models clean 5h-only fallback when quotaSummary is null (${lang})`, () => {
                open(browserFixture(fallbackHtml, 'vscode-dark', themeTokens['vscode-dark']), 320);
                assert.equal(evaluate("document.querySelectorAll('#tab-overview .quota-dual-row').length"), 0,
                    'Overview omits .quota-dual-row when quotaSummary is null');
                assert.equal(evaluate("document.querySelector('#tab-overview .orch-route-pill')"), null,
                    'Overview omits .orch-route-pill when active conversation has no orchestratorConfig');
                assert(evaluate("document.querySelector('#tab-overview').innerText.includes('52%')"),
                    'Overview 5h-only fallback still shows 52% pool quota');
                audit('#tab-overview');

                selectTab('models');
                assert.equal(evaluate("document.querySelectorAll('#tab-models .quota-dual-row').length"), 0,
                    'Models omits .quota-dual-row when quotaSummary is null');
                assert.equal(evaluate("document.querySelector('#tab-models .orch-settings-card')"), null,
                    'Models omits .orch-settings-card when orchestratorSettings is null');
                assert.deepEqual(evaluate('testState.errors'), []);
            }, true);

            // Mapped vs Strict pricing check for catalog-only M669 worker and honest Unpriced on M21 image model
            test(`v1.17.6 mapped vs strict pricing on hidden worker M669 and honest Unpriced on image model M21 (${lang})`, () => {
                const workerSpec = panel.specs.find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M669');
                const imgSpec = panel.specs.find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M21');
                assert(workerSpec && imgSpec, 'M669 and M21 specs exist');
                const workerMappedHtml = panel.renderModelInfoGrid([workerSpec], 'chat', { orchestratorPricingMode: 'mapped' });
                const workerStrictHtml = panel.renderModelInfoGrid([workerSpec], 'chat', { orchestratorPricingMode: 'strict' });
                const imgHtml = panel.renderModelInfoGrid([imgSpec], 'image');
                assert(workerMappedHtml.includes('data-price-state="mapped"') && !workerMappedHtml.includes('$0.00'),
                    'M669 worker renders mapped base rate in mapped mode');
                assert(workerStrictHtml.includes('data-price-state="unpriced"') && !workerStrictHtml.includes('$0.00'),
                    'M669 worker renders honest Unpriced badge in strict mode');
                assert(imgHtml.includes('data-price-state="unpriced"') && !imgHtml.includes('$0.00'),
                    'M21 image model renders honest Unpriced badge');
                assert(!/令牌/.test(workerMappedHtml) && !/令牌/.test(workerStrictHtml) && !/令牌/.test(imgHtml),
                    'M669/M21 price cards have zero 令牌');
            });

            // Suppress unused lint note for labels
            assert(Boolean(labels.orchSettings));
        }
    }

    try {
        const panel = loadInstalledPanel(packageJSON);
        const neon = neonIdentities.map(([id, catalogId, effort, translated]) => {
            const spec = panel.specs.find(spec => spec.placeholderId === `MODEL_PLACEHOLDER_${id}`);
            assert.equal(spec?.modelId, catalogId, `${id} catalog identity`);
            return { ...spec, displayName: neonLabel('en', effort, translated), effort, translated };
        });
        const findSpec = id => {
            const spec = panel.specs.find(s => s.placeholderId === id);
            assert(spec, `installed spec exists: ${id}`);
            return spec;
        };
        const hydrogenExtraHigh = findSpec('MODEL_PLACEHOLDER_M528');
        const carbonHigh = findSpec('MODEL_PLACEHOLDER_M427');
        const argonHigh = findSpec('MODEL_PLACEHOLDER_M417');
        const orchCarbon = findSpec('MODEL_PLACEHOLDER_M667');
        const orchArgon = findSpec('MODEL_PLACEHOLDER_M681');
        const claudeOpusMed = findSpec('MODEL_PLACEHOLDER_M401');
        const claude = findSpec('MODEL_PLACEHOLDER_M402');
        const claudeSonnetMed = findSpec('MODEL_PLACEHOLDER_M404');
        const gptOss = findSpec('MODEL_OPENAI_GPT_OSS_120B_MEDIUM');

        const hydrogenSpecs = panel.specs.filter(spec => spec.displayName.startsWith('Gemini 4 Hydrogen (') && !spec.displayName.includes('Orchestrator'));
        const claudeOpus55Specs = panel.specs.filter(spec => spec.displayName.startsWith('Claude Opus 5.5 ('));
        assert(hydrogenSpecs.length >= 4, 'installed Hydrogen 4-effort specs for universal merging test');
        assert(claudeOpus55Specs.length >= 3, 'installed Claude Opus 5.5 effort specs for universal merging test');

        const resetTime = new Date(Date.now() + 3600000).toISOString();
        const config = (spec, remainingFraction = 0.52, extra = {}) => ({
            model: spec.placeholderId, label: spec.displayName,
            quotaInfo: { remainingFraction, resetTime },
            ...extra,
        });
        const configs = [
            ...neon.map(spec => config(spec)),
            config(hydrogenExtraHigh, 0.52),
            config(carbonHigh, 0.52),
            config(argonHigh, 0.52),
            config(orchCarbon, 0.52),
            config(orchArgon, 0.52),
            config(claudeOpusMed, 0.91),
            config(claude, 0.91),
            config(claudeSonnetMed, 0.91),
            config(gptOss, 0.91, { tagTitle: 'Notice', tagDescription: 'Model will be deprecated soon' }),
        ];
        const multiFamilyConfigs = [
            ...neon.map(spec => config(spec, 0.52)),
            ...hydrogenSpecs.map(spec => config(spec, 0.52)),
            ...claudeOpus55Specs.map(spec => config(spec, 0.91)),
        ];
        const malformed = {
            model: 'MODEL_FIXTURE_UNTRUSTED', label: '<img id="injected" src=x>',
            quotaInfo: { remainingFraction: NaN, resetTime: 'not-a-date' },
        };
        const activeUsage = {
            cascadeId: 'fixture', title: '<img id="injected" src=x> ' + '长'.repeat(80), model: neon[4].placeholderId,
            modelDisplayName: neon[4].displayName, contextUsed: 600000, contextLimit: 512000,
            totalOutputTokens: 1050, totalToolCallOutputTokens: 3200, stepCount: 16, hasGaps: true,
            lastModelUsage: { inputTokens: 550000, outputTokens: 1050, cacheReadTokens: 32000, cacheCreationTokens: 4000 },
            compressionDetected: true, previousContextUsed: 700000, checkpointCompressionDrop: 100000,
            estimatedDeltaSinceCheckpoint: 1000, isEstimated: true, tokenUsageSource: 'planner',
        };
        const cleanHoverUsage = {
            ...activeUsage,
            title: 'Review release changes',
            contextUsed: 214500,
            contextLimit: 512000,
            hasGaps: false,
            compressionDetected: false,
            previousContextUsed: undefined,
            checkpointCompressionDrop: 0,
            isEstimated: false,
        };
        const fixtures = panel.editorialFixtures(activeUsage, [neon[4], claude], resetTime);

        // ── Screenshot Export Mode ──
        if (args.screenshot || args['screenshots-dir']) {
            const screenshotLang = args['screenshot-lang'];
            assert(Object.hasOwn(languages, screenshotLang), `unsupported --screenshot-lang: ${screenshotLang} (use both, en, or zh)`);
            const themes = resolveScreenshotThemes(args['screenshot-theme']);
            if (args.screenshot) {
                assert.equal(themes.length, 1, '--screenshot takes a single theme (use --screenshots-dir with --screenshot-theme=both)');
            }
            const shotWidth = Math.max(320, parseInt(args['screenshot-width'], 10) || 1200);
            const shotHeight = Math.max(600, parseInt(args['screenshot-height'], 10) || 860);
            const html = await panel.render(screenshotLang, configs, fixtures.populated);
            const output = path.resolve(args.screenshot || args['screenshots-dir']);
            if (!args.overwrite) {
                assert(!fs.existsSync(output), `screenshot output path already exists: ${output} (pass --overwrite to replace)`);
            }
            function capture(tab, destination) {
                assert(tabs.includes(tab), `unknown screenshot tab: ${tab}`);
                selectTab(tab);
                evaluate('window.scrollTo(0, 0); if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }');
                settleAnimations();
                waitFor(`Math.abs(document.querySelector('.tab-btn.active').getBoundingClientRect().left - document.querySelector('.tab-slider').getBoundingClientRect().left) < 2`, `${tab} underline settled`);
                browser(['screenshot', destination]);
            }
            const saved = [];
            for (const theme of themes) {
                open(browserFixture(html, theme, themeTokens[theme]), shotWidth, shotHeight);
                waitFor('(async () => { if (document.fonts && document.fonts.ready) { await document.fonts.ready; } return true; })()', 'fonts settled');
                if (args.screenshot) {
                    fs.mkdirSync(path.dirname(output), { recursive: true });
                    capture(args['screenshot-tab'], output);
                    saved.push(output);
                } else {
                    const targetDir = themes.length > 1
                        ? path.join(output, theme === 'vscode-light' ? 'light' : 'dark')
                        : output;
                    fs.mkdirSync(targetDir, { recursive: true });
                    for (const tab of tabs) {
                        const dest = path.join(targetDir, screenshotFilenames[tab]);
                        capture(tab, dest);
                        saved.push(dest);
                    }
                }
            }
            console.log(JSON.stringify({ mode: 'screenshots', lang: screenshotLang, themes, width: shotWidth, height: shotHeight, count: saved.length, output }, null, 2));
            return;
        }

        const runLangs = args.smoke ? ['both'] : Object.keys(languages);
        for (const lang of runLangs) {
            if (opensInSession > 0) { resetSession('phase'); }
            const labels = languages[lang];
            const html = await panel.render(lang, configs);
            testStatusBarHoverMatrix(panel, configs, multiFamilyConfigs, cleanHoverUsage, fixtures.populated.gmSummary, fixtures.v1173.quotaSummary, lang);

            const modelThemes = args.smoke
                ? [['vscode-light', themeTokens['vscode-light']], ['vscode-dark', themeTokens['vscode-dark']]]
                : Object.entries(themeTokens);
            const modelWidths = args.smoke ? [320, 1280] : [320, 768, 1440];
            for (const [theme, tokens] of modelThemes) {
                const fixture = browserFixture(html, theme, tokens);
                for (const width of modelWidths) {
                    test(`${lang} ${theme} ${width}px`, () => {
                        open(fixture, width);
                        assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'no overview horizontal overflow');
                        assert.equal(evaluate("document.querySelector('#tab-overview .overview-telemetry-strip')"), null,
                            'Overview .overview-telemetry-strip is omitted when no GM calls exist');
                        assert.equal(evaluate('document.querySelector(\'[data-tab="overview"]\').textContent.trim()'), labels.overview);
                        assert.equal(evaluate('document.querySelector("[data-monitor-overview] h2")?.textContent.trim()'), labels.overviewTitle);
                        if (width === 320 && (theme === 'vscode-light' || theme === 'vscode-dark')) { audit('#tab-overview'); }
                        const quickModels = '#tab-overview [data-overview-target="models"]';
                        assert(evaluate(`document.querySelector('${quickModels}')?.checkVisibility()`), 'overview model action is visible');
                        click(quickModels);
                        assert(evaluate('!!document.querySelector("#tab-models.active")'), 'overview model action opens Models');
                        const result = evaluate(measurements);
                        assert.equal(result.heading, labels.heading);
                        assert.equal(result.modelInfo?.toLocaleLowerCase(), labels.modelInfo.toLocaleLowerCase());
                        assert.equal(result.width, width);
                        assert.equal(result.overflow, false, 'no page or model card horizontal overflow');
                        assert.equal(result.overlaps, false, 'header controls do not overlap');
                        assert.deepEqual(result.errors, []);
                        for (const spec of neon) {
                            const observed = result.entries.find(entry => entry.model === spec.placeholderId);
                            assert(observed, `${spec.displayName} is visible`);
                            assert.equal(observed.name, neonLabel(lang, spec.effort, spec.translated));
                            assert.equal(observed.catalog, spec.modelId);
                            assert.deepEqual(observed.limits, {
                                'compression-limit': '512,000', 'checkpoint-threshold': '50,000',
                                'native-context': '1,048,576', 'max-output': '262,144',
                            });
                            if (spec.modelId === 'gemini-pro-orchestrator-neon') {
                                assert(observed.route?.includes('gemini-flash-worker-agy'), 'Orchestrator Neon delegation details');
                                assert.equal(observed.priceState, 'mapped', 'Orchestrator Neon displays mapped base rate in default mapped mode');
                            } else {
                                assert.equal(observed.route, undefined);
                                assert.equal(observed.priceState, 'priced', `${spec.modelId} displays official Neon API price`);
                                assert(observed.priceText.includes('$3/M') && observed.priceText.includes('$15/M') && observed.priceText.includes('$0.15/M'),
                                    `${spec.modelId} .spec-price-row renders $3/$15/$0.15: ${observed.priceText}`);
                            }
                        }
                        // Verify 512K checkpointer limits on ALL Gemini 4 & Orchestrator models + Hydrogen Extra High
                        for (const id of gemini4CheckpointerIds) {
                            const observed = result.entries.find(entry => entry.model === id);
                            assert(observed, `${id} is visible in Models tab`);
                            assert.equal(observed.limits['compression-limit'], '512,000', `${id} reports 512,000 compression limit`);
                        }
                        const hydrogenCard = result.entries.find(entry => entry.model === 'MODEL_PLACEHOLDER_M528');
                        assert.equal(hydrogenCard?.name, localizedEffortLabel(lang, 'Gemini 4 Hydrogen', 'Extra High', '超高'),
                            `Hydrogen Extra High localized properly in ${lang}`);
                        const sonnetCard = result.entries.find(entry => entry.model === 'MODEL_PLACEHOLDER_M404');
                        assert(sonnetCard?.priceText.includes('$0.10/M'), `Sonnet 5.5 .spec-price-row renders $0.10/M cache read: ${sonnetCard?.priceText}`);
                        for (const unpricedId of ['MODEL_PLACEHOLDER_M667', 'MODEL_PLACEHOLDER_M681']) {
                            const card = result.entries.find(entry => entry.model === unpricedId);
                            assert.equal(card?.priceState, 'unpriced', `${unpricedId} displays honest Unpriced badge`);
                        }
                        assert.equal(result.pools.length, 2, 'shared Gemini and Claude / GPT pools');
                        const pool = result.pools.find(pool => pool.group === 'Gemini');
                        assert.equal(pool?.range, '52%');
                        assert.equal(Object.keys(pool?.dualWindows || {}).length, 0, '5h-only fallback renders single meter when quotaSummary is null');
                        assert(pool.members.some(row => row.includes('Gemini 4 Neon') && row.includes(labels.efforts)), 'localized Neon quota efforts with Extra High');
                        assert(pool.members.some(row => row.includes('Orchestrator (Neon)')));
                        const claudePool = result.pools.find(pool => pool.group === 'Claude / GPT');
                        assert(claudePool?.noticeTags?.length >= 1, 'GPT-OSS 120B renders Notice tag badge in Claude / GPT pool');
                    }, true);
                }
            }

            const light = themeTokens['vscode-light'];
            const dark = themeTokens['vscode-dark'];
            const active = await panel.render(lang, configs, { currentUsage: activeUsage });
            const updated = panel.renderOverview({ ...activeUsage, contextUsed: 601000 }, configs);
            const differentSession = panel.renderOverview({ ...activeUsage, cascadeId: 'another-fixture' }, configs);
            const postUpdate = nextHtml => evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { command: 'updateTabs', tabs: { overview: ${JSON.stringify(nextHtml)} } } }))`);
            test(`${lang} over-limit active context, diagnostics, polling focus and a11y`, () => {
                open(browserFixture(active, 'vscode-light', light), 320);
                assert.equal(evaluate("document.querySelector('[data-monitor-overview]').dataset.monitorState"), 'active');
                assert.equal(evaluate("document.querySelector('.overview-session .overview-meter').getAttribute('aria-valuenow')"), '100');
                assert.equal(evaluate("document.querySelector('.overview-percent').innerText"), '117.2%');
                assert.equal(evaluate("document.querySelector('#injected')"), null);
                browser(['focus', '#overview-session-diagnostics summary']);
                browser(['press', 'Enter']);
                assert(evaluate("document.querySelector('#overview-session-diagnostics').open"));
                assert(evaluate("document.querySelector('#overview-session-diagnostics').innerText.includes('550,000')"));
                audit('#tab-overview');
                assert(evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
                postUpdate(updated);
                assert.equal(evaluate("document.querySelector('.overview-percent').innerText"), '117.4%');
                assert(evaluate("document.querySelector('#overview-session-diagnostics').open"), 'polling keeps the diagnostic disclosure open');
                assert(evaluate("document.activeElement.matches('#overview-session-diagnostics summary')"), 'polling restores diagnostic keyboard focus');
                postUpdate(differentSession);
                assert(!evaluate("document.querySelector('#overview-session-diagnostics').open"), 'new session closes previous diagnostics');
                assert.deepEqual(evaluate('testState.errors'), []);
            }, true);

            const disconnected = await panel.render(lang, configs, {
                gmSummary: fixtures.populated.gmSummary,
                monitorStatus: { state: 'disconnected', backendIssue: 'lost' },
            });
            test(`${lang} disconnected hides stale quota and session details`, () => {
                open(browserFixture(disconnected, 'vscode-dark', dark), 320);
                assert.equal(evaluate("document.querySelector('[data-monitor-overview]').dataset.monitorState"), 'disconnected');
                assert.equal(evaluate("document.querySelectorAll('#tab-overview .overview-meter').length"), 0);
                assert.equal(evaluate("document.querySelector('#tab-overview .overview-telemetry-strip')"), null,
                    'Disconnected Overview hides stale telemetry strip');
                assert.equal(evaluate("document.querySelectorAll('#tab-overview [data-overview-target]').length"), 1);
                assert(evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
                audit('#tab-overview');
            }, true);

            test(`${lang} keyboard, pause, refresh, navigation, accessibility`, () => {
                open(browserFixture(html, 'vscode-light', light), 768);
                for (const [action, target] of [['gmdata', 'gmdata'], ['settings', 'settings'], ['models', 'models']]) {
                    const activeQuickAction = `#tab-overview.active [data-overview-target="${action}"]`;
                    const targetState = evaluate(`(() => {
                        const action = document.querySelector('${activeQuickAction}');
                        return { visible: !!action?.checkVisibility(), tab: document.querySelector('.tab-pane.active')?.id,
                            focus: document.activeElement.dataset.tab || document.activeElement.dataset.overviewTarget,
                            overview: document.querySelector('[data-monitor-overview]')?.dataset.monitorState };
                    })()`);
                    assert(targetState.visible, `overview ${action} action is visible: ${JSON.stringify(targetState)}`);
                    browser(['focus', activeQuickAction]);
                    assert(evaluate(`document.activeElement.matches('${activeQuickAction}')`), `overview ${action} link receives focus`);
                    browser(['press', 'Enter']);
                    assert(evaluate(`!!document.querySelector('#tab-${target}.active')`), `keyboard opens ${target}`);
                    if (target === 'settings') {
                        for (const density of ['compact', 'full', 'auto']) {
                            browser(['select', '#statusTooltipDensity', density]);
                            const value = evaluate("testState.messages.filter(msg => msg.command === 'setConfig' && msg.key === 'statusBar.tooltipDensity').at(-1)?.value");
                            assert.equal(value, density, 'hover density setting is sent to the extension host');
                        }
                    }
                    selectTab('overview');
                }
                for (const tab of ['overview', 'models']) {
                    selectTab(tab);
                    auditChromeAndPane(tab);
                }
                browser(['focus', '#pauseBtn']);
                browser(['press', 'Enter']);
                assert.equal(evaluate("document.querySelector('#pauseBtn').getAttribute('aria-pressed')"), 'true');
                assert.equal(evaluate("document.querySelector('#pauseBtn').getAttribute('aria-label')"), labels.resume);
                browser(['press', 'Enter']);
                assert.equal(evaluate("document.querySelector('#pauseBtn').getAttribute('aria-pressed')"), 'false');
                click('#refreshBtn');
                assert(evaluate("testState.messages.some(msg => msg.command === 'refresh')"));
                browser(['focus', '[data-tab="overview"]']);
                browser(['press', 'ArrowRight']);
                assert.equal(evaluate('document.activeElement.dataset.tab'), 'gmdata');
                browser(['press', 'End']);
                assert.equal(evaluate('document.activeElement.dataset.tab'), 'about');
                browser(['press', 'Enter']);
                const expectedVersion = `v${packageJSON.version}`;
                assert(evaluate(`document.querySelector('#tab-about.active').innerText.includes(${JSON.stringify(expectedVersion)}) && document.querySelector('#tab-about.active').innerText.includes('512K')`),
                    `About tab displays ${expectedVersion} and 512K context window disclaimer`);
                selectTab('models');
                assert(evaluate("!!document.querySelector('#tab-models.active')"));
                const targetLang = lang === 'en' ? 'zh' : 'en';
                click(`[data-lang="${targetLang}"]`);
                assert(evaluate(`testState.messages.some(msg => msg.command === 'switchLanguage' && msg.lang === '${targetLang}')`));
                assert.deepEqual(evaluate('testState.errors'), []);
            }, true);

            for (const [mode, data] of Object.entries({ empty: [], malformed: [malformed], mixed: [config(neon[0], 0), config(neon[1], 1)] })) {
                const cornerTheme = mode === 'mixed' ? 'vscode-dark' : 'vscode-light';
                const fixture = browserFixture(await panel.render(lang, data), cornerTheme, themeTokens[cornerTheme]);
                test(`${lang} ${mode} corner (${cornerTheme})`, () => {
                    open(fixture, 320);
                    assert(evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'overview corner fits width');
                    selectTab('models');
                    const report = evaluate(measurements);
                    assert.equal(report.overflow, false);
                    assert.deepEqual(report.errors, []);
                    assert.equal(report.entries.length, data.length);
                    assert.equal(evaluate("document.querySelector('#injected')"), null);
                    assert(!/NaN|Infinity|Invalid Date/.test(evaluate("document.querySelector('#tab-models').innerText")));
                    if (mode === 'empty') { assert.equal(report.pools.length, 0); }
                    if (mode === 'mixed') {
                        assert.equal(report.pools[0]?.range, '0–100%');
                        browser(['focus', '.model-quota-details summary']);
                        assert(evaluate("document.activeElement.matches('.model-quota-details summary')"), 'quota disclosure receives keyboard focus');
                        browser(['press', 'Enter']);
                        assert(evaluate("document.querySelector('.model-quota-details').open"), 'quota disclosure opens with Enter');
                        audit('#tab-models');
                    }
                }, true);
            }
        }

        for (const lang of runLangs) {
            await runEditorialMatrix(panel, configs, fixtures, lang, args.smoke);
        }

        // ── Full Interactive & Expanded-Disclosure Coverage (Light & Dark) ──
        const richHtml = await panel.render('both', configs, fixtures.populated);
        for (const theme of ['vscode-light', 'vscode-dark']) {
            if (opensInSession > 0) { resetSession('phase'); }
            const richFixture = browserFixture(richHtml, theme, themeTokens[theme]);
            const reopenRich = () => open(richFixture, 960);
            reopenRich();
            testHeaderAndAccountPopover(theme, reopenRich);
            if (theme === 'vscode-light') {
                testSettingsInteractions(reopenRich);
                testSessionsInteractions(reopenRich);
            }
            testCostInteractions(theme, reopenRich);
            testGMDataInteractions(theme, reopenRich);
            testCalendarInteractions(theme, reopenRich);
            testProfileInteractions(theme, reopenRich);
        }
        if (opensInSession > 0) { resetSession('phase'); }
        await testV1173DeepSuite(panel, configs, fixtures, args.smoke);
        if (opensInSession > 0) { resetSession('phase'); }
        await testModelDNADisclosures(panel, configs, fixtures.populated.gmSummary);
        await testUnknownCreditsAcrossThemes(panel, configs, fixtures, args.smoke);
    } finally {
        try { browser(['close']); } catch { /* Browser may have failed to start. */ }
        fs.rmSync(temp, { recursive: true, force: true });
    }
    console.log(JSON.stringify({ mode: args.smoke ? 'installed-code Chromium smoke' : 'installed-code Chromium fixtures', passed, browserRetries, sessionRecycles, failures }, null, 2));
    if (failures.length > 0) { process.exitCode = 1; }
}

(async () => {
    const { packageJSON, files } = checkInstall();
    console.log(`Installed ${extensionId} ${packageJSON.version}: ${files} JavaScript files match the current build`);
    if (args.native) { nativeSmoke(); }
    else { await browserMatrix(packageJSON); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

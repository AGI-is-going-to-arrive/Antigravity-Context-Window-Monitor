/* Run after installing the release VSIX and reloading Antigravity IDE.
 *   node tests/installed-ide-ui.cjs --native [--app <IDE app name>] [--window-id <window id>]
 *   node tests/installed-ide-ui.cjs [--installed <extension directory>]
 *   node tests/installed-ide-ui.cjs --screenshot <output PNG file>
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
    app: { type: 'string' },
    'window-id': { type: 'string' },
    'status-label': { type: 'string' },
    installed: { type: 'string' },
    screenshot: { type: 'string' },
} });
const extensionId = `${manifest.publisher}.${manifest.name}`.toLowerCase();
const installed = args.installed ? path.resolve(args.installed)
    : path.join(os.homedir(), '.antigravity-ide', 'extensions', `${extensionId}-${manifest.version}`);
const app = args.app || (process.platform === 'darwin' ? 'com.google.antigravity-ide' : 'Antigravity IDE');
const languages = {
    en: { heading: 'Antigravity Monitor', overview: 'Overview', overviewTitle: 'Context & quota', viewModels: 'View models',
        modelInfo: 'MODEL INFO', statusSettings: 'Status bar settings', statusDisplay: 'Status Bar Display',
        about: 'About', resume: 'Resume auto-refresh', efforts: 'Low · Medium · High · Extra' },
    zh: { heading: 'Antigravity 监控面板', overview: '总览', overviewTitle: '上下文与配额', viewModels: '查看模型',
        modelInfo: '模型信息', statusSettings: '状态栏设置', statusDisplay: '状态栏显示',
        about: '关于', resume: '恢复自动刷新', efforts: '低 · 中 · 高 · 超高' },
    both: { heading: 'Antigravity Monitor / Antigravity 监控面板', overview: 'Overview / 总览', overviewTitle: 'Context & quota / 上下文与配额',
        viewModels: 'View models / 查看模型', modelInfo: 'MODEL INFO / 模型信息', statusSettings: 'Status bar settings / 状态栏设置',
        statusDisplay: 'Status Bar Display / 状态栏显示', about: 'About / 关于', resume: 'Resume auto-refresh / 恢复自动刷新',
        efforts: 'Low · Medium · High · Extra / 低 · 中 · 高 · 超高' },
};
const languageButtons = { en: 'EN', zh: '中文', both: /^(Both|双语|Both \/ 双语)$/ };
// Live IDE catalog, November 19, 2026. Keep expectations independent of the build.
const neonIdentities = [
    ['M534', 'gemini-4-neon-low', 'Low', '低'],
    ['M533', 'gemini-4-neon-medium', 'Medium', '中'],
    ['M532', 'gemini-4-neon-high', 'High', '高'],
    ['M535', 'gemini-4-neon-xhigh', 'Extra', '超高'],
    ['M537', 'gemini-pro-orchestrator-neon', null, null],
];

function neonLabel(lang, effort, translated) {
    if (!effort) { return 'Orchestrator (Neon)'; }
    const label = lang === 'en' ? effort : lang === 'zh' ? translated : `${effort} / ${translated}`;
    return `Gemini 4 Neon (${label})`;
}
const themeTokens = {
    'vscode-light': { background: '#ffffff', text: '#242424', border: '#bcbcbc', accent: '#005fb8', accentText: '#ffffff' },
    'vscode-dark': { background: '#1f1f1f', text: '#e0e0e0', border: '#6f6f6f', accent: '#9dceff', accentText: '#101010' },
    'vscode-high-contrast': { background: '#000000', text: '#ffffff', border: '#ffffff', accent: '#ffb060', accentText: '#000000' },
    'vscode-high-contrast-light': { background: '#ffffff', text: '#000000', border: '#000000', accent: '#0f4a85', accentText: '#ffffff' },
};

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
        output = execFileSync(binary, argv, { input, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    } catch (error) {
        if (!error.stdout?.trim()) { throw error; }
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
    const snapshotArgs = ['snapshot', '--app', app, '--compact', '--max-depth', '45', '--timeout-ms', '5000'];
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
        const deadline = Date.now() + 12000;
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
    const statusLabel = new RegExp(args['status-label'] || 'Context (?:Window )?(?:Monitor|Usage)|上下文(?:窗口)?(?:使用情况|监控)|No active conversation|无活跃会话', 'i');
    const openFromStatus = () => click(node => node.ancestors.includes('status') && matches(node, 'button', statusLabel), 'monitor status item');
    openFromStatus();
    const currentLocale = () => waitFor(nodes => Object.keys(languages).find(lang => has(nodes, 'heading', languages[lang].heading)), 'monitor webview title');
    const original = currentLocale();
    const switchLocale = lang => {
        if (currentLocale() === lang) { return; }
        click(node => matches(node, 'button', languageButtons[lang]), `monitor language ${lang}`);
        waitFor(nodes => has(nodes, 'heading', languages[lang].heading), `monitor heading in ${lang}`);
    };
    try {
        for (const [lang, labels] of Object.entries(languages)) {
            switchLocale(lang);
            openFromStatus();
            waitFor(nodes => has(nodes, 'heading', labels.overviewTitle), `overview from the status item in ${lang}`);
            click(node => matches(node, 'button', labels.viewModels), `Overview model action in ${lang}`);
            const models = waitFor(nodes => has(nodes, 'heading', labels.modelInfo)
                && has(nodes, 'heading', /^Orchestrator \(Neon\)$/) && nodes, `live Neon model information in ${lang}`);
            for (const [, catalogId, effort, translated] of neonIdentities) {
                assert(models.some(node => node.role === 'statictext' && node.name === catalogId), `${catalogId} is mounted`);
                assert(has(models, 'heading', neonLabel(lang, effort, translated)), `${catalogId} has the correct name in ${lang}`);
            }
            assert(!has(models, 'article', 'Gemini Flash (Orchestrator Worker)'), 'worker is not a selectable model');
            openFromStatus();
            click(node => matches(node, 'button', labels.statusSettings), `Overview status settings action in ${lang}`);
            waitFor(nodes => has(nodes, 'heading', labels.statusDisplay), `status settings controls in ${lang}`);
            click(node => node.ancestors.includes('navigation') && matches(node, 'button', labels.about), `About tab in ${lang}`);
            waitFor(nodes => has(nodes, 'heading', 'Antigravity Context Window Monitor')
                && nodes.some(node => node.role === 'statictext' && node.name?.includes(manifest.version)), `About version in ${lang}`);
            console.log(`Native ${lang}: status overview, five Neon identities, status settings and About version passed`);
        }
    } finally {
        switchLocale(original);
    }
}

function loadInstalledPanel(packageJSON) {
    let html = '';
    const values = new Map([['panelShowTabScrollHint', !args.screenshot]]);
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
        window: { createWebviewPanel: () => panel },
        workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
        commands: { executeCommand() {}, registerCommand: dispose },
        extensions: { getExtension: () => undefined },
        ViewColumn: { Two: 2 },
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
        const { PricingStore } = load('pricing-store.js');
        const pricingStore = new PricingStore();
        setPanelDurableState(state);
        return {
            specs: getModelSpecs(),
            renderOverview: (usage, configs) => buildOverviewTabContent(usage, configs, null),
            render: async (lang, modelConfigs, extra = {}) => {
                await setLanguageToState(lang, state);
                showMonitorPanel({ currentUsage: null, allTrajectoryUsages: [], modelConfigs, userInfo: null, pricingStore,
                    context: { globalState: state, extension: { packageJSON } }, ...extra });
                refreshMonitorPanelLanguage();
                assert(html.trimStart().startsWith('<!DOCTYPE html>'), 'installed panel rendered HTML');
                return html;
            },
        };
    } finally {
        Module._load = originalLoad;
    }
}

function browserFixture(html, theme, { background, text, border, accent, accentText }) {
    const tokens = `<style>:root {
        --vscode-editor-background:${background}; --vscode-foreground:${text}; --vscode-descriptionForeground:${text};
        --vscode-panel-border:${border}; --vscode-contrastBorder:${border}; --vscode-focusBorder:${accent};
        --vscode-font-family:Arial,sans-serif; --vscode-font-size:13px;
        --vscode-button-background:${accent}; --vscode-button-foreground:${accentText};
        --vscode-textLink-foreground:${accent}; --vscode-progressBar-background:${accent};
    }</style>`;
    const bridge = `<script>
        window.testState = { errors: [], messages: [], ui: { activeTab: 'overview' }, paused: false };
        window.addEventListener('error', () => testState.errors.push('error'));
        window.addEventListener('unhandledrejection', () => testState.errors.push('unhandledrejection'));
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
    return html.replace('</head>', `${tokens}${bridge}</head>`).replace('<body ', `<body class="${theme}" `);
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
        heading: document.querySelector('.topbar-title h1')?.textContent.trim(),
        modelInfo: document.querySelector('.model-info-section h2')?.innerText.trim(),
        width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 ||
            [...document.querySelectorAll('#tab-models .spec-card, #tab-models .model-card')].some(card => card.getBoundingClientRect().right > innerWidth + 1),
        overlaps, errors: testState.errors,
        entries: cards.map(card => ({ model: card.dataset.modelId, name: card.querySelector('h3').textContent,
            catalog: card.querySelector('.spec-model-id').textContent,
            limits: Object.fromEntries([...card.querySelectorAll('[data-metric]')].map(row => [row.dataset.metric, row.querySelector('dd').textContent])),
            route: card.querySelector('.spec-orchestration')?.textContent })),
        pools: [...document.querySelectorAll('.model-card')].map(card => ({ group: card.querySelector('.model-card-name-text')?.textContent,
            members: [...card.querySelectorAll('.model-quota-members li')].map(row => row.innerText),
            range: card.querySelector('.model-card-pct')?.textContent })),
    };
})()`;

async function browserMatrix(packageJSON) {
    const session = `installed-monitor-ui-${process.pid}`;
    const browser = (argv, input) => {
        const result = jsonResult('agent-browser', ['--session', session, ...argv, '--json'], input);
        assert(result.success, result.error);
        return result.data;
    };
    const evaluate = js => browser(['eval', '--stdin'], js).result;
    const click = selector => browser(['click', selector]);
    const audit = selector => {
        const result = browser(['a11y', '--selector', selector]);
        assert.equal(result.counts.violations, 0, result.violations.map(item => item.id).join(', '));
    };
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-monitor-ui-'));
    const failures = [];
    let passed = 0;
    function test(name, run) {
        try { run(); passed++; }
        catch (error) { failures.push({ name, message: error.message }); }
    }
    let navigation = 0;
    function open(html, width, height = 950) {
        const file = path.join(temp, 'fixture.html');
        fs.writeFileSync(file, html);
        browser(['set', 'viewport', String(width), String(height)]);
        browser(['open', `${pathToFileURL(file).href}?case=${++navigation}`]);
        assert(evaluate("!!document.querySelector('#tab-overview.active [data-monitor-overview], #tab-overview.active[data-monitor-overview]')"),
            'installed Overview initialized');
    }

    try {
        const panel = loadInstalledPanel(packageJSON);
        const neon = neonIdentities.map(([id, catalogId, effort, translated]) => {
            const spec = panel.specs.find(spec => spec.placeholderId === `MODEL_PLACEHOLDER_${id}`);
            assert.equal(spec?.modelId, catalogId, `${id} catalog identity`);
            return { ...spec, displayName: neonLabel('en', effort, translated), effort, translated };
        });
        const claude = panel.specs.find(spec => spec.displayName === 'Claude Opus 5.5 (High)');
        assert(claude, 'installed Claude comparison model');
        const resetTime = new Date(Date.now() + 3600000).toISOString();
        const config = (spec, remainingFraction = 0.52) => ({ model: spec.placeholderId, label: spec.displayName,
            quotaInfo: { remainingFraction, resetTime } });
        const configs = [...neon.map(spec => config(spec)), config(claude, 0.91)];
        const malformed = { model: 'MODEL_FIXTURE_UNTRUSTED', label: '<img id="injected" src=x>',
            quotaInfo: { remainingFraction: NaN, resetTime: 'not-a-date' } };
        const activeUsage = {
            cascadeId: 'fixture', title: '<img id="injected" src=x> ' + '长'.repeat(80), model: neon[4].placeholderId,
            modelDisplayName: neon[4].displayName, contextUsed: 600000, contextLimit: 512000,
            totalOutputTokens: 1050, totalToolCallOutputTokens: 3200, stepCount: 16, hasGaps: true,
            lastModelUsage: { inputTokens: 550000, outputTokens: 1050, cacheReadTokens: 32000, cacheCreationTokens: 4000 },
            compressionDetected: true, previousContextUsed: 700000, checkpointCompressionDrop: 100000,
            estimatedDeltaSinceCheckpoint: 1000, isEstimated: true, tokenUsageSource: 'planner',
        };
        if (args.screenshot) {
            const currentUsage = { ...activeUsage, title: 'Review release changes', contextUsed: 214500,
                contextLimit: 512000, isEstimated: false, hasGaps: false };
            const userInfo = { name: 'Sample account', email: 'sample@example.invalid', planName: 'Pro',
                userTierName: 'Google AI Pro', defaultModelLabel: 'Orchestrator (Neon)', modelSortOrder: [],
                planLimits: { maxNumChatInputTokens: 0, maxNumPremiumChatMessages: 0, maxCustomChatInstructionCharacters: 0,
                    maxNumPinnedContextItems: 0, maxLocalIndexSize: 0, monthlyFlexCreditPurchaseAmount: 0 },
                teamConfig: { allowMcpServers: false, allowAutoRunCommands: false, allowBrowserExperimentalFeatures: false },
                availableCredits: [
                    { creditType: 'AI', creditAmount: 1200, minimumCreditAmountForUsage: 0 },
                ], monthlyPromptCredits: 0, availablePromptCredits: 0, monthlyFlowCredits: 0, availableFlowCredits: 0 };
            const html = await panel.render('both', configs, { currentUsage, userInfo });
            open(browserFixture(html, 'vscode-dark', themeTokens['vscode-dark']), 1000, 690);
            const destination = path.resolve(args.screenshot);
            assert(!fs.existsSync(destination), 'screenshot output path must be new');
            browser(['screenshot', destination]);
            console.log(`Synthetic Overview screenshot saved to ${destination}`);
            return;
        }
        for (const [lang, labels] of Object.entries(languages)) {
            const html = await panel.render(lang, configs);
            for (const [theme, tokens] of Object.entries(themeTokens)) {
                const fixture = browserFixture(html, theme, tokens);
                for (const width of [320, 768, 1440]) {
                    test(`${lang} ${theme} ${width}px`, () => {
                        open(fixture, width);
                        assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), true, 'no overview horizontal overflow');
                        assert.equal(evaluate('document.querySelector(\'[data-tab="overview"]\').textContent.trim()'), labels.overview);
                        assert.equal(evaluate('document.querySelector("[data-monitor-overview] h2")?.textContent.trim()'), labels.overviewTitle);
                        if (width === 320) { audit('#tab-overview'); }
                        const quickModels = '[data-overview-target="models"]';
                        assert(evaluate(`document.querySelector('${quickModels}')?.checkVisibility()`), 'overview model action is visible');
                        click(quickModels);
                        assert(evaluate('!!document.querySelector("#tab-models.active")'), 'overview model action opens Models');
                        const result = evaluate(measurements);
                        assert.equal(result.heading, labels.heading);
                        assert.equal(result.modelInfo, labels.modelInfo);
                        assert.equal(result.width, width);
                        assert.equal(result.overflow, false, 'no page or model card horizontal overflow');
                        assert.equal(result.overlaps, false, 'header controls do not overlap');
                        assert.deepEqual(result.errors, []);
                        for (const spec of neon) {
                            const observed = result.entries.find(entry => entry.model === spec.placeholderId);
                            assert(observed, `${spec.displayName} is visible`);
                            assert.equal(observed.name, neonLabel(lang, spec.effort, spec.translated));
                            assert.equal(observed.catalog, spec.modelId);
                            assert.deepEqual(observed.limits, { 'compression-limit': '512,000', 'checkpoint-threshold': '50,000',
                                'native-context': '1,048,576', 'max-output': '262,144' });
                            if (spec.modelId === 'gemini-pro-orchestrator-neon') {
                                assert(observed.route?.includes('gemini-flash-worker-agy'), 'Orchestrator Neon delegation details');
                            } else {
                                assert.equal(observed.route, undefined);
                            }
                        }
                        assert.equal(result.pools.length, 2, 'shared Gemini and Claude / GPT pools');
                        const pool = result.pools.find(pool => pool.group === 'Gemini');
                        assert.equal(pool?.range, '52%');
                        assert(pool.members.some(row => row.includes('Gemini 4 Neon') && row.includes(labels.efforts)), 'localized Neon quota efforts');
                        assert(pool.members.some(row => row.includes('Orchestrator (Neon)')));
                    });
                }
            }
            const light = themeTokens['vscode-light'];
            const active = await panel.render(lang, configs, { currentUsage: activeUsage });
            const updated = panel.renderOverview({ ...activeUsage, contextUsed: 601000 }, configs);
            const differentSession = panel.renderOverview({ ...activeUsage, cascadeId: 'another-fixture' }, configs);
            const postUpdate = html => evaluate(`window.dispatchEvent(new MessageEvent('message', { data: { command: 'updateTabs', tabs: { overview: ${JSON.stringify(html)} } } }))`);
            test(`${lang} over-limit active context, diagnostics and long label`, () => {
                open(browserFixture(active, 'vscode-light', light), 320);
                assert.equal(evaluate("document.querySelector('[data-monitor-overview]').dataset.monitorState"), 'active');
                assert.equal(evaluate("document.querySelector('.overview-session .overview-meter').getAttribute('aria-valuenow')"), '100');
                assert.equal(evaluate("document.querySelector('.overview-percent').innerText"), '117.2%');
                assert.equal(evaluate("document.querySelector('#injected')"), null);
                browser(['focus', '#overview-session-diagnostics summary']);
                browser(['press', 'Enter']);
                assert(evaluate("document.querySelector('#overview-session-diagnostics').open"));
                assert(evaluate("document.querySelector('#overview-session-diagnostics').innerText.includes('550,000')"));
                assert(evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
                postUpdate(updated);
                assert.equal(evaluate("document.querySelector('.overview-percent').innerText"), '117.4%');
                assert(evaluate("document.querySelector('#overview-session-diagnostics').open"), 'polling keeps the diagnostic disclosure open');
                assert(evaluate("document.activeElement.matches('#overview-session-diagnostics summary')"), 'polling restores diagnostic keyboard focus');
                postUpdate(differentSession);
                assert(!evaluate("document.querySelector('#overview-session-diagnostics').open"), 'new session closes previous diagnostics');
                assert.deepEqual(evaluate('testState.errors'), []);
            });
            const disconnected = await panel.render(lang, configs, { monitorStatus: { state: 'disconnected', backendIssue: 'lost' } });
            test(`${lang} disconnected hides stale quota and session details`, () => {
                open(browserFixture(disconnected, 'vscode-light', light), 320);
                assert.equal(evaluate("document.querySelector('[data-monitor-overview]').dataset.monitorState"), 'disconnected');
                assert.equal(evaluate("document.querySelectorAll('#tab-overview .overview-meter').length"), 0);
                assert.equal(evaluate("document.querySelectorAll('#tab-overview [data-overview-target]').length"), 1);
                assert(evaluate('document.documentElement.scrollWidth <= innerWidth + 1'));
            });
            test(`${lang} keyboard, pause, refresh, navigation, accessibility`, () => {
                open(browserFixture(html, 'vscode-light', light), 768);
                for (const [action, target] of [['gmdata', 'gmdata'], ['settings', 'settings'], ['models', 'models']]) {
                    const quickAction = `[data-overview-target="${action}"]`;
                    browser(['focus', quickAction]);
                    browser(['press', 'Enter']);
                    assert(evaluate(`!!document.querySelector('#tab-${target}.active')`), `keyboard opens ${target}`);
                    if (target === 'settings') {
                        for (const density of ['compact', 'full', 'auto']) {
                            browser(['select', '#statusTooltipDensity', density]);
                            const value = evaluate("testState.messages.filter(msg => msg.command === 'setConfig' && msg.key === 'statusBar.tooltipDensity').at(-1)?.value");
                            assert.equal(value, density, 'hover density setting is sent to the extension host');
                        }
                    }
                    click('[data-tab="overview"]');
                }
                for (const tab of ['overview', 'models']) {
                    click(`[data-tab="${tab}"]`);
                    audit(`#tab-${tab}`);
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
                assert(evaluate(`document.querySelector('#tab-about.active').innerText.includes(${JSON.stringify(manifest.version)})`));
                click('[data-tab="models"]');
                assert(evaluate("!!document.querySelector('#tab-models.active')"));
                const target = lang === 'en' ? 'zh' : 'en';
                click(`[data-lang="${target}"]`);
                assert(evaluate(`testState.messages.some(msg => msg.command === 'switchLanguage' && msg.lang === '${target}')`));
                assert.deepEqual(evaluate('testState.errors'), []);
            });
            for (const [mode, data] of Object.entries({ empty: [], malformed: [malformed], mixed: [config(neon[0], 0), config(neon[1], 1)] })) {
                const fixture = browserFixture(await panel.render(lang, data), 'vscode-light', light);
                test(`${lang} ${mode} corner`, () => {
                    open(fixture, 320);
                    assert(evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'overview corner fits width');
                    click('[data-tab="models"]');
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
                        browser(['press', 'Enter']);
                        assert(evaluate("document.querySelector('.model-quota-details').open"));
                    }
                });
            }
        }
    } finally {
        try { browser(['close']); } catch { /* Browser may have failed to start. */ }
        fs.rmSync(temp, { recursive: true, force: true });
    }
    console.log(JSON.stringify({ mode: 'installed-code Chromium fixtures', passed, failures }, null, 2));
    if (failures.length > 0) { process.exitCode = 1; }
}

(async () => {
    const { packageJSON, files } = checkInstall();
    console.log(`Installed ${extensionId} ${packageJSON.version}: ${files} JavaScript files match the current build`);
    if (args.native) { nativeSmoke(); }
    else { await browserMatrix(packageJSON); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

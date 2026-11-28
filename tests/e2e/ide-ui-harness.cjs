/* Isolated E2E Harness for Antigravity IDE / WebView UI Verification (v1.18.0).
 *
 * Provides:
 *   1. Strict isolated throwaway temp fixture directory & destructive-action guard
 *      (NEVER permits destructive actions against live IDE or real ~/.gemini state).
 *   2. Dual-side host + browser fixed-clock injection (`--clock <ISO|pre|post>`)
 *      covering both pre- (`2026-11-30T12:00:00Z`) and post- (`2026-12-02T12:00:00Z`)
 *      `2026-12-01` UTC scheduled rate-change regimes.
 *   3. Backward-compatible CLI parsing, install integrity verification (supporting
 *      both bundled v1.18 `dist-stage/ide/extension.js` VSIX and `out/*.js` layouts),
 *      compiled module loading, and `agent-browser` / `agent-desktop` session helpers.
 */
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { parseArgs } = require('node:util');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST = require(path.join(REPO_ROOT, 'package.json'));
const EXTENSION_ID = `${MANIFEST.publisher}.${MANIFEST.name}`.toLowerCase();

// ─── v1.18.1 6-Tab IA + Topbar About Utility View & 18-Alias Navigation ──────

const MAIN_TABS = Object.freeze(['overview', 'gm', 'sessions', 'calendar', 'models', 'settings']);
const UTILITY_VIEWS = Object.freeze(['about']);
const ALL_VIEWS = Object.freeze([...MAIN_TABS, ...UTILITY_VIEWS]);

const LEGACY_TAB_ALIASES = Object.freeze({
    overview: { tab: 'overview' },
    gm: { tab: 'gm' },
    gmdata: { tab: 'gm' },
    'gm-data': { tab: 'gm' },
    activity: { tab: 'gm', anchor: 'slot-activity' },
    sessions: { tab: 'sessions' },
    chats: { tab: 'sessions' },
    'chat-history': { tab: 'sessions' },
    calendar: { tab: 'calendar' },
    usage: { tab: 'calendar' },
    cost: { tab: 'calendar', anchor: 'slot-pricing' },
    pricing: { tab: 'calendar', anchor: 'slot-pricing' },
    models: { tab: 'models' },
    profile: { tab: 'models', anchor: 'slot-profile' },
    account: { tab: 'models', anchor: 'slot-profile' },
    accounts: { tab: 'models', anchor: 'slot-profile' },
    settings: { tab: 'settings' },
    about: { tab: 'about' },
});

function resolveViewId(raw) {
    if (typeof raw !== 'string') { return null; }
    const norm = raw.trim().toLowerCase().replace(/^#(?:tab-)?/, '');
    if (!norm) { return null; }
    return LEGACY_TAB_ALIASES[norm] || null;
}

const SCREENSHOT_FILENAMES = Object.freeze({
    overview: 'monitor-overview.png',
    gm: 'monitor-model-calls.png',
    sessions: 'monitor-sessions.png',
    calendar: 'monitor-usage-cost.png',
    models: 'monitor-models-quotas.png',
    settings: 'monitor-settings.png',
    about: 'monitor-about.png',
    // Legacy aliases retained for backward-compatible single-tab screenshots
    gmdata: 'monitor-gm-data.png',
    chats: 'monitor-sessions.png',
    pricing: 'monitor-cost.png',
    profile: 'monitor-profile.png',
});

// ─── v1.18.0 Trilingual Labels & Glossary Rules ──────────────────────────────

const LANGUAGES = Object.freeze({
    en: {
        heading: 'Antigravity Monitor',
        overview: 'Overview',
        overviewTitle: 'Context & quota',
        viewModels: 'View models',
        modelInfo: 'Model Info',
        statusSettings: 'Status bar settings',
        statusDisplay: 'Status Bar Display',
        customPricing: 'Custom Pricing',
        orchSettings: 'Orchestrator Settings',
        orchModel: 'Orchestrator Model',
        execModel: 'Executor Model',
        fiveHour: '5h',
        weekly: 'Weekly',
        gm: 'Model Calls',
        sessions: 'Sessions',
        calendar: 'Usage & Cost',
        models: 'Models & Quotas',
        settings: 'Settings',
        about: 'About',
        aboutTitle: 'Antigravity Context Window Monitor',
        freeze: 'Freeze Panel',
        unfreeze: 'Resume Live Updates',
        efforts: 'Low · Medium · High · Extra High',
        notReported: 'Not reported',
        disconnectedHeading: 'Backend disconnected',
        unattributed: 'Unattributed',
        insufficientHistory: 'Insufficient history',
        planRoiDisclaimer: 'API Equivalent Reference Ratio, Not Actual Bill',
    },
    zh: {
        heading: 'Antigravity 监控面板',
        overview: '概览',
        overviewTitle: '上下文与配额',
        viewModels: '查看模型',
        modelInfo: '模型信息',
        statusSettings: '状态栏设置',
        statusDisplay: '状态栏显示',
        customPricing: '自定义价格',
        orchSettings: '编排设置',
        orchModel: '编排模型',
        execModel: '执行模型',
        fiveHour: '5h',
        weekly: '周配额',
        gm: '模型调用',
        sessions: '会话',
        calendar: '用量与费用',
        models: '模型与配额',
        settings: '设置',
        about: '关于',
        aboutTitle: 'Antigravity 上下文窗口监控',
        freeze: '冻结面板',
        unfreeze: '解除冻结面板',
        efforts: '低 · 中 · 高 · 超高',
        notReported: '未上报',
        disconnectedHeading: '后端连接已断开',
        unattributed: '未归属',
        insufficientHistory: '历史不足',
        planRoiDisclaimer: 'API 等效参考比，非实际账单',
    },
    both: {
        heading: 'Antigravity Monitor / Antigravity 监控面板',
        overview: 'Overview / 概览',
        overviewTitle: 'Context & quota / 上下文与配额',
        viewModels: 'View models / 查看模型',
        modelInfo: 'Model Info / 模型信息',
        statusSettings: 'Status bar settings / 状态栏设置',
        statusDisplay: 'Status Bar Display / 状态栏显示',
        customPricing: 'Custom Pricing / 自定义价格',
        orchSettings: 'Orchestrator Settings / 编排设置',
        orchModel: 'Orchestrator Model / 编排模型',
        execModel: 'Executor Model / 执行模型',
        fiveHour: '5h',
        weekly: 'Weekly / 周配额',
        gm: 'Model Calls / 模型调用',
        sessions: 'Sessions / 会话',
        calendar: 'Usage & Cost / 用量与费用',
        models: 'Models & Quotas / 模型与配额',
        settings: 'Settings / 设置',
        about: 'About / 关于',
        aboutTitle: 'Antigravity Context Window Monitor / Antigravity 上下文窗口监控',
        freeze: 'Freeze Panel / 冻结面板',
        unfreeze: 'Resume Live Updates / 解除冻结面板',
        efforts: 'Low · Medium · High · Extra High / 低 · 中 · 高 · 超高',
        notReported: 'Not reported / 未上报',
        disconnectedHeading: 'Backend disconnected / 后端连接已断开',
        unattributed: 'Unattributed / 未归属',
        insufficientHistory: 'Insufficient history / 历史不足',
        planRoiDisclaimer: 'API Equivalent Reference Ratio, Not Actual Bill / API 等效参考比，非实际账单',
    },
});

const LANGUAGE_BUTTONS = Object.freeze({
    en: 'EN',
    zh: '中文',
    both: /^(Both|双语|Both \/ 双语)$/,
});

const FORBIDDEN_CHINESE_GLOSSARY_RE = /账户|冷缓存|首次响应|生成器调用|模型上限|暂停刷新|令牌|额度/;
const FORBIDDEN_COMPLIANCE_RE = /100%\s*ToS-safe|100%\s*Antigravity\s*ToS-compliant|100%\s*合规/i;

// Live IDE catalog, November 2026 (LS 2.34.0 / agy 1.5.14). Keep expectations independent of the build.
const NEON_IDENTITIES = Object.freeze([
    ['M534', 'gemini-4-neon-low', 'Low', '低'],
    ['M533', 'gemini-4-neon-medium', 'Medium', '中'],
    ['M532', 'gemini-4-neon-high', 'High', '高'],
    ['M535', 'gemini-4-neon-xhigh', 'Extra High', '超高'],
    ['M537', 'gemini-pro-orchestrator-neon', null, null],
]);

const GEMINI4_CHECKPOINTER_IDS = Object.freeze([
    'MODEL_PLACEHOLDER_M534', 'MODEL_PLACEHOLDER_M533', 'MODEL_PLACEHOLDER_M532', 'MODEL_PLACEHOLDER_M535',
    'MODEL_PLACEHOLDER_M537', 'MODEL_PLACEHOLDER_M528', 'MODEL_PLACEHOLDER_M427', 'MODEL_PLACEHOLDER_M417',
    'MODEL_PLACEHOLDER_M667', 'MODEL_PLACEHOLDER_M681',
]);

function localizedEffortLabel(lang, family, effort, translated) {
    if (!effort) { return family; }
    const label = lang === 'en' ? effort : lang === 'zh' ? translated : `${effort} / ${translated}`;
    return `${family} (${label})`;
}

function neonLabel(lang, effort, translated) {
    if (!effort) { return 'Orchestrator (Neon)'; }
    return localizedEffortLabel(lang, 'Gemini 4 Neon', effort, translated);
}

// ─── VS Code 4-Theme Token Fixtures ──────────────────────────────────────────

const THEME_TOKENS = Object.freeze({
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
});

function resolveScreenshotThemes(raw) {
    if (raw === 'dark') { return ['vscode-dark']; }
    if (raw === 'light') { return ['vscode-light']; }
    if (raw === 'both') { return ['vscode-light', 'vscode-dark']; }
    assert(Object.hasOwn(THEME_TOKENS, raw),
        `unsupported --screenshot-theme: ${raw} (use dark, light, both, or one of ${Object.keys(THEME_TOKENS).join(', ')})`);
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

// ─── Dual-Side Host + Browser Fixed-Clock Engine (2026-12-01 UTC) ────────────

const CLOCK_REGIMES = Object.freeze({
    pre: '2026-11-30T12:00:00Z',
    post: '2026-12-02T12:00:00Z',
    cutoverIso: '2026-12-01T00:00:00Z',
    cutoverMs: Date.parse('2026-12-01T00:00:00Z'),
});

const ISO_WITH_TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/i;

function parseFixedClockIso(raw) {
    if (raw === undefined || raw === null || raw === '') {
        return null;
    }
    const text = String(raw).trim();
    if (!text) { return null; }
    const lower = text.toLowerCase();
    const resolvedIso = lower === 'pre'
        ? CLOCK_REGIMES.pre
        : lower === 'post'
            ? CLOCK_REGIMES.post
            : text;
    if (!ISO_WITH_TZ_RE.test(resolvedIso)) {
        throw new Error(
            `Invalid --clock value "${raw}": expected ISO-8601 UTC timestamp (e.g. ${CLOCK_REGIMES.pre} or ${CLOCK_REGIMES.post}) or "pre"/"post".`,
        );
    }
    const epochMs = Date.parse(resolvedIso);
    if (!Number.isFinite(epochMs)) {
        throw new Error(`Invalid --clock timestamp "${raw}": Date.parse returned NaN.`);
    }
    const normalizedIso = new Date(epochMs).toISOString();
    return {
        iso: normalizedIso,
        epochMs,
        isPreCutover: epochMs < CLOCK_REGIMES.cutoverMs,
        regime: epochMs < CLOCK_REGIMES.cutoverMs ? 'pre-2026-12-01' : 'post-2026-12-01',
    };
}

/**
 * Patch `globalThis.Date` in the Node host process so `Date.now()`, `new Date()`,
 * and `Date()` return the exact fixed UTC timestamp while keeping `new Date(arg)`,
 * `Date.parse`, `Date.UTC`, and `instanceof Date` intact.
 */
function installHostFixedClock(isoOrMs) {
    const parsed = typeof isoOrMs === 'number'
        ? {
            iso: new Date(isoOrMs).toISOString(),
            epochMs: isoOrMs,
            isPreCutover: isoOrMs < CLOCK_REGIMES.cutoverMs,
            regime: isoOrMs < CLOCK_REGIMES.cutoverMs ? 'pre-2026-12-01' : 'post-2026-12-01',
        }
        : parseFixedClockIso(isoOrMs);
    if (!parsed) {
        throw new Error('installHostFixedClock requires a valid ISO timestamp or finite epoch ms.');
    }

    const RealDate = globalThis.Date;
    const fixedMs = parsed.epochMs;

    function FixedDate(...args) {
        if (!new.target) {
            return new RealDate(fixedMs).toString();
        }
        if (args.length === 0) {
            return new RealDate(fixedMs);
        }
        return new RealDate(...args);
    }
    FixedDate.prototype = RealDate.prototype;
    Object.setPrototypeOf(FixedDate, RealDate);
    FixedDate.now = () => fixedMs;
    FixedDate.parse = RealDate.parse.bind(RealDate);
    FixedDate.UTC = RealDate.UTC.bind(RealDate);

    globalThis.Date = FixedDate;
    let restored = false;

    return {
        ...parsed,
        restore() {
            if (restored) { return; }
            restored = true;
            globalThis.Date = RealDate;
        },
    };
}

async function withHostFixedClock(isoOrMs, fn) {
    const clock = installHostFixedClock(isoOrMs);
    try {
        return await fn(clock);
    } finally {
        clock.restore();
    }
}

/**
 * Build an inline `<script>` shim injected at the start of `<head>` (BEFORE any
 * panel/client script runs) so the browser context observes the exact same fixed
 * UTC timestamp as the Node host process (`window.Date.now() === hostEpochMs`).
 */
function buildBrowserClockShimScript(isoOrMs) {
    const parsed = typeof isoOrMs === 'number'
        ? { iso: new Date(isoOrMs).toISOString(), epochMs: isoOrMs }
        : parseFixedClockIso(isoOrMs);
    if (!parsed) { return ''; }
    const fixedMsLiteral = JSON.stringify(parsed.epochMs);
    const fixedIsoLiteral = JSON.stringify(parsed.iso);
    return `<script data-e2e-fixed-clock="true">(() => {
        const RealDate = window.Date;
        const FIXED_MS = ${fixedMsLiteral};
        const FIXED_ISO = ${fixedIsoLiteral};
        function FixedDate(...args) {
            if (!new.target) { return new RealDate(FIXED_MS).toString(); }
            return args.length === 0 ? new RealDate(FIXED_MS) : new RealDate(...args);
        }
        FixedDate.prototype = RealDate.prototype;
        Object.setPrototypeOf(FixedDate, RealDate);
        FixedDate.now = () => FIXED_MS;
        FixedDate.parse = RealDate.parse.bind(RealDate);
        FixedDate.UTC = RealDate.UTC.bind(RealDate);
        window.Date = FixedDate;
        window.__E2E_FIXED_CLOCK__ = Object.freeze({ iso: FIXED_ISO, epochMs: FIXED_MS });
    })();</script>`;
}

// ─── Strict Isolated Temp Fixture Dir & Destructive-Action Guard ─────────────

function resolveRealOrAncestor(targetPath) {
    const abs = path.resolve(targetPath);
    if (fs.existsSync(abs)) {
        return fs.realpathSync(abs);
    }
    const trailing = [];
    let cursor = abs;
    while (true) {
        const parent = path.dirname(cursor);
        if (parent === cursor) {
            return abs;
        }
        trailing.unshift(path.basename(cursor));
        cursor = parent;
        if (fs.existsSync(cursor)) {
            return path.join(fs.realpathSync(cursor), ...trailing);
        }
    }
}

function isSameOrInside(candidate, rootDir) {
    const rel = path.relative(rootDir, candidate);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isStrictlyInside(candidate, rootDir) {
    const rel = path.relative(rootDir, candidate);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Fail-closed guard proving `dirPath` is a dedicated throwaway subdirectory
 * strictly inside `os.tmpdir()`, never overlapping real `~/.gemini`,
 * `~/.antigravity-ide`, `HOME`, or the repository root, and never escaping via symlinks.
 */
function assertIsolatedFixtureDir(dirPath, options = {}) {
    const label = options.label || 'fixture directory';
    if (typeof dirPath !== 'string' || !dirPath.trim() || dirPath.includes('\0')) {
        throw new Error(`[DESTRUCTIVE_GUARD_BLOCKED] Invalid ${label}: empty or malformed path.`);
    }
    const resolved = path.resolve(dirPath);
    const real = resolveRealOrAncestor(resolved);
    const tmpReal = fs.realpathSync(os.tmpdir());
    const homeReal = resolveRealOrAncestor(os.homedir());
    const repoReal = resolveRealOrAncestor(REPO_ROOT);

    // 1. Reject symlinks on the target itself or any path escaping os.tmpdir()
    if (fs.existsSync(resolved)) {
        const stat = fs.lstatSync(resolved);
        if (stat.isSymbolicLink()) {
            throw new Error(`[DESTRUCTIVE_GUARD_BLOCKED] Refusing symlink ${label}: ${resolved}`);
        }
    }

    // 2. Must be strictly inside os.tmpdir() (NEVER os.tmpdir() itself!)
    if (!isStrictlyInside(real, tmpReal)) {
        throw new Error(
            `[DESTRUCTIVE_GUARD_BLOCKED] ${label} (${resolved} -> ${real}) is NOT strictly inside isolated os.tmpdir() (${tmpReal}).`,
        );
    }

    // 3. Explicitly refuse real user config/state directories and repo root
    const forbiddenRoots = [
        { name: '~/.gemini', target: resolveRealOrAncestor(path.join(homeReal, '.gemini')) },
        { name: '~/.antigravity-ide', target: resolveRealOrAncestor(path.join(homeReal, '.antigravity-ide')) },
        { name: 'repository root', target: repoReal },
    ];
    if (!isStrictlyInside(tmpReal, homeReal)) {
        forbiddenRoots.push({ name: 'HOME directory', target: homeReal });
    } else if (real === homeReal) {
        throw new Error(`[DESTRUCTIVE_GUARD_BLOCKED] ${label} cannot equal HOME directory (${homeReal}).`);
    }

    for (const item of forbiddenRoots) {
        if (isSameOrInside(real, item.target) || isSameOrInside(item.target, real)) {
            throw new Error(
                `[DESTRUCTIVE_GUARD_BLOCKED] ${label} (${real}) overlaps protected ${item.name} (${item.target}).`,
            );
        }
    }

    return { ok: true, resolved, real, tmpReal };
}

/**
 * Create a dedicated isolated throwaway fixture directory tree inside `os.tmpdir()`.
 */
function createIsolatedFixtureEnv(options = {}) {
    const prefix = options.prefix || 'acm-ide-ui-fixture-';
    let rootDir;
    let ownsRoot = false;
    if (options.fixtureDir) {
        const check = assertIsolatedFixtureDir(options.fixtureDir, { label: '--fixture-dir' });
        rootDir = check.resolved;
        fs.mkdirSync(rootDir, { recursive: true });
        assertIsolatedFixtureDir(rootDir, { label: '--fixture-dir' });
    } else {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        ownsRoot = true;
        assertIsolatedFixtureDir(rootDir, { label: 'temp fixture root' });
    }

    const homeDir = path.join(rootDir, 'home');
    const brainDir = path.join(homeDir, '.gemini', 'antigravity', 'brain');
    const stateDir = path.join(rootDir, 'state');
    const browserDir = path.join(rootDir, 'browser');
    const statePath = path.join(stateDir, 'antigravity-monitor-state.json');

    for (const dir of [homeDir, brainDir, stateDir, browserDir]) {
        fs.mkdirSync(dir, { recursive: true });
    }

    let cleaned = false;
    return {
        rootDir,
        homeDir,
        brainDir,
        stateDir,
        statePath,
        browserDir,
        isolatedFixture: true,
        native: false,
        cleanup() {
            if (cleaned) { return; }
            cleaned = true;
            if (ownsRoot) {
                fs.rmSync(rootDir, { recursive: true, force: true });
            }
        },
    };
}

/**
 * Mandatory gate invoked immediately before executing ANY destructive action
 * (such as `clearCalendarHistory`, `removeAccount`, `clearToolCatalog`, `resetPricing`).
 */
function assertDestructiveActionAllowed(guardContext, actionName) {
    const action = String(actionName || 'destructive-action');
    if (!guardContext || typeof guardContext !== 'object') {
        throw new Error(`[DESTRUCTIVE_GUARD_BLOCKED] Refusing "${action}": missing guard context.`);
    }
    if (guardContext.native === true) {
        throw new Error(`[DESTRUCTIVE_GUARD_BLOCKED] Refusing "${action}" in --native live IDE mode!`);
    }
    if (guardContext.isolatedFixture !== true) {
        throw new Error(`[DESTRUCTIVE_GUARD_BLOCKED] Refusing "${action}": isolatedFixture mode is not active.`);
    }
    const check = assertIsolatedFixtureDir(guardContext.fixtureDir, { label: `destructive target for "${action}"` });
    if (guardContext.stateFilePath) {
        const stateReal = resolveRealOrAncestor(guardContext.stateFilePath);
        if (!isStrictlyInside(stateReal, check.real)) {
            throw new Error(
                `[DESTRUCTIVE_GUARD_BLOCKED] Refusing "${action}": stateFilePath (${stateReal}) escapes isolated fixture dir (${check.real}).`,
            );
        }
    }
    return { ok: true, action, fixtureDir: check.real };
}

/**
 * Self-test proving the destructive-action guard fails closed on real user/repo paths,
 * symlink escapes, `os.tmpdir()` root, and `--native` mode, while permitting a valid
 * throwaway temp fixture dir.
 */
function runDestructiveGuardSelfTest() {
    const results = [];
    const expectBlocked = (name, fn) => {
        let blocked = false;
        let errorMessage = '';
        try {
            fn();
        } catch (err) {
            errorMessage = err instanceof Error ? err.message : String(err);
            blocked = errorMessage.includes('[DESTRUCTIVE_GUARD_BLOCKED]');
        }
        assert.equal(blocked, true, `Guard MUST block ${name} (error=${errorMessage || 'none'})`);
        results.push({ check: name, blocked: true });
    };

    const realGemini = path.join(os.homedir(), '.gemini');
    const realState = path.join(realGemini, 'antigravity', 'antigravity-monitor-state.json');

    expectBlocked('real ~/.gemini dir', () => assertIsolatedFixtureDir(realGemini));
    expectBlocked('real ~/.gemini state path', () => assertIsolatedFixtureDir(realState));
    expectBlocked('real HOME dir', () => assertIsolatedFixtureDir(os.homedir()));
    expectBlocked('real ~/.antigravity-ide dir', () => assertIsolatedFixtureDir(path.join(os.homedir(), '.antigravity-ide')));
    expectBlocked('repository root', () => assertIsolatedFixtureDir(REPO_ROOT));
    expectBlocked('os.tmpdir() root itself', () => assertIsolatedFixtureDir(os.tmpdir()));
    expectBlocked('empty path', () => assertIsolatedFixtureDir(''));

    const env = createIsolatedFixtureEnv({ prefix: 'acm-guard-selftest-' });
    try {
        // Native mode MUST be blocked even with a valid temp dir
        expectBlocked('native mode Clear Calendar History', () => assertDestructiveActionAllowed({
            native: true,
            isolatedFixture: true,
            fixtureDir: env.rootDir,
            stateFilePath: env.statePath,
        }, 'clearCalendarHistory'));

        // Non-isolated stateFilePath pointing to real ~/.gemini MUST be blocked
        expectBlocked('escaped stateFilePath pointing to ~/.gemini', () => assertDestructiveActionAllowed({
            native: false,
            isolatedFixture: true,
            fixtureDir: env.rootDir,
            stateFilePath: realState,
        }, 'clearCalendarHistory'));

        // Symlink inside os.tmpdir() pointing to real ~/.gemini MUST be blocked
        const symlinkEscape = path.join(env.rootDir, 'escape-gemini');
        try {
            fs.symlinkSync(realGemini, symlinkEscape);
            expectBlocked('symlink escaping to ~/.gemini', () => assertIsolatedFixtureDir(symlinkEscape));
            expectBlocked('child path under symlink escaping to ~/.gemini', () => assertIsolatedFixtureDir(path.join(symlinkEscape, 'state')));
        } finally {
            fs.rmSync(symlinkEscape, { force: true });
        }

        // Valid isolated throwaway fixture dir MUST pass
        const allowed = assertDestructiveActionAllowed({
            native: false,
            isolatedFixture: true,
            fixtureDir: env.rootDir,
            stateFilePath: env.statePath,
        }, 'clearCalendarHistory');
        assert.equal(allowed.ok, true);
        results.push({ check: 'valid isolated temp fixture dir', allowed: true });
    } finally {
        env.cleanup();
    }

    return { ok: true, checked: results.length, results };
}

// ─── CLI Parsing & Usage ─────────────────────────────────────────────────────

function parseCliArgs(argv) {
    const { values } = parseArgs({
        args: argv,
        options: {
            help: { type: 'boolean', short: 'h', default: false },
            native: { type: 'boolean', default: false },
            smoke: { type: 'boolean', default: false },
            'dry-run': { type: 'boolean', default: false },
            'verify-guards': { type: 'boolean', default: false },
            clock: { type: 'string' },
            'clock-matrix': { type: 'boolean', default: false },
            'fixture-dir': { type: 'string' },
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
        },
    });
    return values;
}

function formatUsage() {
    return [
        'Antigravity IDE / WebView E2E UI Verification Runner (v1.18.0)',
        '',
        'Usage:',
        '  node tests/installed-ide-ui.cjs --help',
        '  node tests/installed-ide-ui.cjs --verify-guards [--clock <ISO|pre|post>]',
        '  node tests/installed-ide-ui.cjs --dry-run [--clock <ISO|pre|post>] [--clock-matrix]',
        '  node tests/installed-ide-ui.cjs --native [--app <IDE app name>] [--window-id <window id>]',
        '  node tests/installed-ide-ui.cjs [--installed <extension dir>] [--smoke] [--clock <ISO|pre|post>] [--clock-matrix]',
        '  node tests/installed-ide-ui.cjs --screenshot <file.png> [--screenshot-tab <view>] [--screenshot-theme <dark|light|vscode-*>] [--screenshot-lang <both|en|zh>] [--overwrite]',
        '  node tests/installed-ide-ui.cjs --screenshots-dir <dir> [--screenshot-theme <dark|light|both|vscode-*>] [--screenshot-lang <both|en|zh>] [--overwrite]',
        '',
        'Options:',
        `  --clock <ISO|pre|post>   Fix BOTH Node host & browser Date to a UTC timestamp (pre=${CLOCK_REGIMES.pre}, post=${CLOCK_REGIMES.post})`,
        '  --clock-matrix           Verify BOTH pre-change (2026-11-30T12:00:00Z) and post-change (2026-12-02T12:00:00Z) regimes',
        '  --fixture-dir <tmpDir>   Explicit throwaway fixture directory (MUST reside strictly inside os.tmpdir())',
        '  --verify-guards          Run destructive-action isolation guard & dual-side clock self-tests without launching Chromium/IDE',
        '  --dry-run                Verify guards, dual-side clock regimes, and compiled panel/pricing fixtures without launching Chromium',
        '  --smoke                  Run fast Chromium fixture subset',
        '  --native                 Run non-destructive live IDE accessibility smoke via agent-desktop',
        '',
        'Views (v1.18.0 5-Tab IA + Topbar Utility Views):',
        `  Main tabs:     ${MAIN_TABS.join(', ')}`,
        `  Utility views: ${UTILITY_VIEWS.join(', ')} (legacy aliases like gmdata, chats, pricing, profile are also accepted)`,
        '',
        'Safety:',
        '  - Destructive fixture actions (e.g. Clear Calendar History) are strictly gated to isolated throwaway temp dirs',
        '    and NEVER execute against live IDE (--native) or real ~/.gemini state.',
    ].join('\n');
}

function resolveInstalledPath(args) {
    if (args.installed) {
        return path.resolve(args.installed);
    }
    return path.join(os.homedir(), '.antigravity-ide', 'extensions', `${EXTENSION_ID}-${MANIFEST.version}`);
}

// ─── Install Check & Compiled Module Loader ──────────────────────────────────

function findTscToolchain(repoRoot) {
    const ext = process.platform === 'win32' ? '.cmd' : '';
    const roots = [repoRoot];
    try {
        const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (commonDir) {
            const commonParent = path.resolve(repoRoot, commonDir, '..');
            if (!roots.includes(commonParent)) { roots.push(commonParent); }
        }
    } catch { /* ignore outside git */ }

    for (const base of roots) {
        const tscBin = path.join(base, 'node_modules', '.bin', `tsc${ext}`);
        if (fs.existsSync(tscBin)) {
            const typeRoots = path.join(base, 'node_modules', '@types');
            return { tscBin, typeRoots: fs.existsSync(typeRoots) ? typeRoots : null };
        }
    }
    return null;
}

function resolveCompiledOutDir(installedDir, repoRoot, fixtureEnv) {
    const installedOut = installedDir ? path.join(installedDir, 'out') : null;
    if (installedOut && fs.existsSync(path.join(installedOut, 'webview-panel.js'))) {
        return { outDir: installedOut, source: 'installed-out' };
    }
    const repoOut = path.join(repoRoot, 'out');
    if (fs.existsSync(path.join(repoOut, 'webview-panel.js'))) {
        return { outDir: repoOut, source: 'repo-out' };
    }
    if (fixtureEnv) {
        const toolchain = findTscToolchain(repoRoot);
        if (toolchain) {
            const tempOut = path.join(fixtureEnv.rootDir, 'compiled-out');
            fs.mkdirSync(tempOut, { recursive: true });
            const tscArgs = ['-p', path.join(repoRoot, 'tsconfig.json'), '--outDir', tempOut, '--sourceMap', 'false'];
            if (toolchain.typeRoots) {
                tscArgs.push('--typeRoots', toolchain.typeRoots);
            }
            execFileSync(toolchain.tscBin, tscArgs, {
                cwd: repoRoot,
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: 120_000,
            });
            if (fs.existsSync(path.join(tempOut, 'webview-panel.js'))) {
                return { outDir: tempOut, source: 'temp-compiled-out' };
            }
        }
    }
    throw new Error(
        `Compiled JS modules not found in ${installedOut || '(none)'} or ${repoOut}. Run \`npm run compile\` first.`,
    );
}

function checkInstall(installedDir, repoRoot = REPO_ROOT, manifest = MANIFEST) {
    const pkgPath = path.join(installedDir, 'package.json');
    assert(fs.existsSync(pkgPath), `Installed extension package.json not found: ${pkgPath}`);
    const packageJSON = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(packageJSON.version, manifest.version);
    assert.equal(`${packageJSON.publisher}.${packageJSON.name}`.toLowerCase(), EXTENSION_ID);

    const sha256File = filePath => createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

    // Support v1.18 bundled VSIX entry (`dist-stage/ide/extension.js`) first
    const mainRel = packageJSON.main ? String(packageJSON.main).replace(/^\.\//, '') : '';
    const installedMain = mainRel ? path.join(installedDir, mainRel) : '';
    if (installedMain && fs.existsSync(installedMain)) {
        const localMain = path.join(repoRoot, mainRel);
        if (fs.existsSync(localMain)) {
            assert.equal(
                sha256File(installedMain),
                sha256File(localMain),
                `installed bundled entrypoint matches current build: ${mainRel}`,
            );
        }
        return { packageJSON, files: 1, layout: 'bundled', main: mainRel };
    }

    // Legacy / dev `out/*.js` directory comparison
    const codeFiles = base => fs.readdirSync(path.join(base, 'out'), { recursive: true })
        .filter(name => String(name).endsWith('.js')).sort();
    const files = codeFiles(installedDir);
    assert(files.length > 0, 'installed JavaScript exists');
    if (fs.existsSync(path.join(repoRoot, 'out'))) {
        assert.deepEqual(files, codeFiles(repoRoot), 'installed and compiled JavaScript file lists match');
        for (const name of files) {
            assert.equal(
                sha256File(path.join(installedDir, 'out', name)),
                sha256File(path.join(repoRoot, 'out', name)),
                `installed JavaScript matches current build: ${name}`,
            );
        }
    }
    return { packageJSON, files: files.length, layout: 'out' };
}

function loadInstalledPanel(packageJSON, installedDir, repoRoot, fixtureEnv) {
    const { outDir, source } = resolveCompiledOutDir(installedDir, repoRoot, fixtureEnv);
    let html = '';
    let density = 'auto';
    let windowZoom = 0;
    let showSessionCost = false;
    let showNativeHudBar = false;
    let orchestratorPricingMode = 'mapped';
    let statusItem;
    const values = new Map([['panelShowTabScrollHint', false]]);
    const state = {
        get: (key, fallback) => (values.has(key) ? values.get(key) : fallback),
        update: async (key, value) => { values.set(key, value); },
    };
    const dispose = () => ({ dispose() {} });
    const panel = {
        webview: {
            get html() { return html; },
            set html(value) { html = value; },
            onDidReceiveMessage: dispose,
            postMessage() {},
        },
        visible: true,
        reveal() {},
        onDidChangeViewState: dispose,
        onDidDispose: dispose,
    };
    const vscode = {
        env: { language: 'en' },
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
        const load = moduleName => require(path.join(outDir, moduleName));
        const { setLanguageToState } = load('i18n.js');
        const { getModelSpecs } = load('models.js');
        const { refreshMonitorPanelLanguage, setPanelDurableState, showMonitorPanel } = load('webview-panel.js');
        const { buildMonitorDocumentHtml, CANONICAL_MAIN_TABS, ALL_TAB_ALIASES } = load('webview-document.js');
        const { buildOverviewTabContent } = load('webview-overview-tab.js');
        const { buildPricingTabContent } = load('pricing-panel.js');
        const { PricingStore, DEFAULT_PRICING, getUpcomingRateChanges } = load('pricing-store.js');
        const { DailyStore } = load('daily-store.js');
        const { buildSummaryFromConversations } = load('gm/summary.js');
        const { evaluatePromptCacheTtl } = load('telemetry-metrics.js');
        const { buildPublishedMonitorObservation } = load('core/context-display.js');
        const { StatusBarManager } = load('statusbar.js');

        const pricingStore = new PricingStore();
        setPanelDurableState(state);

        return {
            outDir,
            outSource: source,
            specs: getModelSpecs(),
            modules: {
                DailyStore,
                PricingStore,
                DEFAULT_PRICING,
                getUpcomingRateChanges,
                buildSummaryFromConversations,
                evaluatePromptCacheTtl,
                buildPublishedMonitorObservation,
                buildMonitorDocumentHtml,
                buildPricingTabContent,
                CANONICAL_MAIN_TABS,
                ALL_TAB_ALIASES,
            },
            setLanguage: async (lang) => setLanguageToState(lang, state),
            renderOverview: (usage, configs, userInfo = null, billingDay = 0, status, now, telemetry) =>
                buildOverviewTabContent(usage, configs, userInfo, billingDay, status, now, telemetry),
            renderPricingTab: (gmSummary, options = {}) => buildPricingTabContent(
                gmSummary,
                pricingStore,
                undefined,
                undefined,
                undefined,
                false,
                options,
            ),
            renderDocument: async (lang, params = {}) => {
                await setLanguageToState(lang, state);
                return buildMonitorDocumentHtml({
                    surface: 'ide',
                    version: packageJSON.version,
                    pricingStore,
                    ...params,
                });
            },
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
                // When v1.18 document-level extras (swarmOverview, cacheTtl, weeklyRunways, handoffPreview,
                // recoveryBrief, etc.) are provided, render directly via `buildMonitorDocumentHtml` so every
                // v1.18 Plan C & D9 component is exercised deterministically; otherwise use `showMonitorPanel`.
                if (extra.useDocumentBuilder) {
                    const docHtml = buildMonitorDocumentHtml({
                        surface: 'ide',
                        version: packageJSON.version,
                        currentUsage: null,
                        allTrajectoryUsages: [],
                        allTrajectories: [],
                        modelConfigs,
                        userInfo: null,
                        pricingStore,
                        activitySummary: null,
                        gmSummary: null,
                        gmFullSummary: null,
                        dailyStore: new DailyStore(),
                        accountSnapshots: [],
                        todayLedgerActive: [],
                        ledgerSettled: [],
                        orchestratorSettings: null,
                        quotaSummary: null,
                        orchestratorPricingMode,
                        ...extra,
                    });
                    assert(docHtml.trimStart().startsWith('<!DOCTYPE html>'), 'document builder rendered HTML');
                    return docHtml;
                }
                showMonitorPanel({
                    currentUsage: null,
                    allTrajectoryUsages: [],
                    allTrajectories: [],
                    modelConfigs,
                    userInfo: null,
                    pricingStore,
                    activitySummary: null,
                    gmSummary: null,
                    gmFullSummary: null,
                    dailyStore: new DailyStore(),
                    storageDiagnostics: undefined,
                    accountSnapshots: [],
                    todayLedgerActive: [],
                    ledgerSettled: [],
                    orchestratorSettings: null,
                    quotaSummary: null,
                    todayCostUsd: Number.NaN,
                    sessionCostUsd: Number.NaN,
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

// ─── Browser HTML Fixture Wrapper (Theme + Stub Bridge + Dual-Side Clock) ────

function browserFixture(html, theme, tokens, options = {}) {
    const t = tokens || THEME_TOKENS[theme];
    assert(t, `Unknown theme for browserFixture: ${theme}`);

    const clockShim = options.fixedClockIso ? buildBrowserClockShimScript(options.fixedClockIso) : '';
    const themeCss = `<style>:root {
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
        window.testState = {
            errors: [],
            messages: [],
            clipboard: [],
            ui: { activeTab: 'overview' },
            paused: false,
            isolatedFixture: true,
        };
        window.addEventListener('error', event => testState.errors.push(event.message || 'error'));
        window.addEventListener('unhandledrejection', event => testState.errors.push(String(event.reason || 'unhandledrejection')));
        try {
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: text => { testState.clipboard.push(String(text)); return Promise.resolve(); } },
            });
        } catch { /* fallback if clipboard is non-configurable */ }
        window.acquireVsCodeApi = () => ({
            getState: () => testState.ui,
            setState: value => { testState.ui = value; },
            postMessage: msg => {
                testState.messages.push(msg);
                if (msg.command === 'togglePause') {
                    testState.paused = !testState.paused;
                    window.dispatchEvent(new MessageEvent('message', {
                        origin: window.location.origin,
                        source: window,
                        data: { command: 'setPaused', paused: testState.paused },
                    }));
                }
            },
        });
    </script>`;

    let out = html;
    if (clockShim) {
        out = out.replace(/<head([^>]*)>/i, `<head$1>${clockShim}`);
    }
    const withHead = out.replace('</head>', `${themeCss}${bridge}</head>`);
    const themed = withHead.replace('<body ', `<body class="${theme}" data-vscode-theme-kind="${theme}" data-e2e-isolated="true" `);
    assert(themed !== withHead, 'browserFixture applied theme class and data-vscode-theme-kind to <body>');
    return themed;
}

// ─── Subprocess JSON, Agent-Desktop & Agent-Browser Clients ──────────────────

function jsonResult(binary, argv, input) {
    let output;
    try {
        output = execFileSync(binary, argv, {
            input,
            encoding: 'utf8',
            timeout: 35_000,
            maxBuffer: 8 * 1024 * 1024,
        });
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

function createDesktopClient() {
    return {
        jsonResult: (argv, input) => jsonResult('agent-desktop', argv, input),
        run(argv) {
            const result = jsonResult('agent-desktop', argv);
            assert(
                result.ok,
                `agent-desktop ${argv[0]}: ${result.error?.code || 'failed'} (${result.error?.disposition?.retry || 'retry unknown'})`,
            );
            return result.data;
        },
    };
}

function createBrowserSession(fixtureEnv, options = {}) {
    assertIsolatedFixtureDir(fixtureEnv.rootDir, { label: 'browser session fixture root' });
    const sessionPrefix = options.sessionPrefix || `installed-monitor-ui-${process.pid}`;
    const TRANSIENT_BROWSER_ERROR = /CDP (?:connection closed|response channel closed|error .*Target closed: CDP session .* detached)|Timed out after \d+ms waiting for load state|Target closed|Browser not launched|Execution context was destroyed|ECONNRESET|EPIPE|ETIMEDOUT|socket hang up|broken pipe/i;
    const MAX_OPENS_PER_SESSION = options.maxOpensPerSession || 12;

    let session = sessionPrefix;
    let sessionSeq = 0;
    let opensInSession = 0;
    let sessionRecycles = 0;
    let browserRetries = 0;
    let navigation = 0;

    const browser = (argv, input) => {
        const result = jsonResult('agent-browser', ['--session', session, ...argv, '--json'], input);
        assert(result.success, result.error);
        return result.data;
    };

    function resetSession(reason = 'recycle') {
        try { browser(['close']); } catch { /* Disconnection may have already closed renderer. */ }
        sessionSeq += 1;
        opensInSession = 0;
        session = `${sessionPrefix}-${reason}-${sessionSeq}`;
        if (reason === 'recycle' || reason === 'phase') { sessionRecycles += 1; }
    }

    const evaluate = js => browser(['eval', '--stdin'], js).result;
    const click = selector => browser(['click', selector]);

    function waitFor(condition, description) {
        try { browser(['wait', '--fn', condition]); }
        catch (error) { throw new Error(`${description}: ${error.message}`); }
    }

    const settleAnimations = () => evaluate(
        '(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))); await new Promise(requestAnimationFrame); return true; })()',
    );

    const audit = selector => {
        settleAnimations();
        const argv = selector ? ['a11y', '--selector', selector] : ['a11y'];
        const result = browser(argv);
        const failures = result.violations.map(item =>
            `${item.id}: ${item.nodes.map(node => JSON.stringify(node.target)).slice(0, 4).join(', ')}`,
        );
        assert.equal(result.counts.violations, 0, `${selector || 'document'} a11y violations:\n${failures.join('\n')}`);
    };

    const auditChromeAndPane = view => {
        const resolved = resolveViewId(view)?.tab || view;
        audit('.panel-topbar');
        audit(`#tab-${resolved}`);
    };

    function open(html, width, height = 950) {
        const file = path.join(fixtureEnv.browserDir, 'fixture.html');
        fs.writeFileSync(file, html, 'utf8');
        if (opensInSession >= MAX_OPENS_PER_SESSION) {
            resetSession('recycle');
        }
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                opensInSession += 1;
                browser(['set', 'viewport', String(width), String(height)]);
                browser(['open', `${pathToFileURL(file).href}?case=${++navigation}`]);
                waitFor(
                    "Boolean(document.querySelector('#tab-overview.active [data-monitor-overview], #tab-overview.active[data-monitor-overview], #monitor-content .tab-pane.active'))",
                    'Monitor panel initialized',
                );
                return;
            } catch (error) {
                if (attempt < 3 && TRANSIENT_BROWSER_ERROR.test(error.message || '')) {
                    browserRetries += 1;
                    resetSession('open-retry');
                    continue;
                }
                throw error;
            }
        }
    }

    function selectViewSelector(view) {
        const canonical = resolveViewId(view)?.tab || view;
        if (canonical === 'about') { return '#topbarAboutBtn'; }
        return `#tabBar [data-tab="${canonical}"]`;
    }

    function selectTab(view) {
        const resolved = resolveViewId(view) || { tab: view };
        const canonical = resolved.tab;
        const selector = selectViewSelector(canonical);
        browser(['focus', selector]);
        browser(['press', 'Enter']);
        waitFor(
            `(async () => { await new Promise(requestAnimationFrame); return Boolean(document.querySelector('#tab-${canonical}.active')); })()`,
            `${canonical} activated by keyboard`,
        );
        if (resolved.anchor) {
            evaluate(`document.getElementById(${JSON.stringify(resolved.anchor)})?.scrollIntoView({ block: 'start' })`);
        }
        return canonical;
    }

    function measureTab(view, readingsFn) {
        const resolved = resolveViewId(view) || { tab: view };
        const canonical = resolved.tab;
        const selector = selectViewSelector(canonical);
        const actions = [
            ['focus', selector],
            ['press', 'Enter'],
            ['eval', `(async () => { window.scrollTo(0, 0); await new Promise(requestAnimationFrame); return (${readingsFn})(); })()`],
        ];
        const results = jsonResult('agent-browser', ['--session', session, 'batch', '--bail', '--omit-command', '--json'], JSON.stringify(actions));
        for (const action of results) { assert(action.success, action.error); }
        assert.equal(results.length, actions.length, `complete keyboard and layout observation for ${canonical}`);
        return results.at(-1).result.result;
    }

    return {
        browser,
        resetSession,
        evaluate,
        click,
        waitFor,
        settleAnimations,
        audit,
        auditChromeAndPane,
        open,
        selectTab,
        selectViewSelector,
        measureTab,
        getStats: () => ({ opensInSession, sessionRecycles, browserRetries }),
        isTransientError: err => TRANSIENT_BROWSER_ERROR.test(err?.message || ''),
        noteRetry: () => { browserRetries += 1; },
        close() {
            try { browser(['close']); } catch { /* ignore */ }
        },
    };
}

module.exports = {
    REPO_ROOT,
    MANIFEST,
    EXTENSION_ID,
    MAIN_TABS,
    UTILITY_VIEWS,
    ALL_VIEWS,
    LEGACY_TAB_ALIASES,
    resolveViewId,
    SCREENSHOT_FILENAMES,
    LANGUAGES,
    LANGUAGE_BUTTONS,
    FORBIDDEN_CHINESE_GLOSSARY_RE,
    FORBIDDEN_COMPLIANCE_RE,
    NEON_IDENTITIES,
    GEMINI4_CHECKPOINTER_IDS,
    localizedEffortLabel,
    neonLabel,
    THEME_TOKENS,
    resolveScreenshotThemes,
    assertCoolNeutralRgb,
    CLOCK_REGIMES,
    parseFixedClockIso,
    installHostFixedClock,
    withHostFixedClock,
    buildBrowserClockShimScript,
    assertIsolatedFixtureDir,
    createIsolatedFixtureEnv,
    assertDestructiveActionAllowed,
    runDestructiveGuardSelfTest,
    parseCliArgs,
    formatUsage,
    resolveInstalledPath,
    resolveCompiledOutDir,
    checkInstall,
    loadInstalledPanel,
    browserFixture,
    jsonResult,
    createDesktopClient,
    createBrowserSession,
};

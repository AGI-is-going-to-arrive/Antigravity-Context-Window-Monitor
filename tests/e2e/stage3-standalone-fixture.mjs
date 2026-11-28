#!/usr/bin/env node
/**
 * Phase 6 Stage 3 — Isolated Standalone Fixture Server & Automated Security /
 * Headless Browser Verification Runner (`tests/e2e/stage3-standalone-fixture.mjs`).
 *
 * Strict Isolation Guarantees:
 *   - Runs ONLY an isolated deterministic fixture `SidecarProvider` over
 *     `startStandaloneServer` (`src/app/sidecar-server.ts`), backed strictly by a
 *     throwaway temp `HOME`, temp `brain/`, and temp state path inside `os.tmpdir()`.
 *   - ZERO real LS polling, ZERO real CDP probing, ZERO external GitHub update checks,
 *     and ZERO access to real `~/.gemini` or `~/.antigravity-ide`.
 *   - NEVER prints one-time pairing codes or long-lived session/overlay tokens to
 *     stdout or stderr (`--serve-only` delivers the one-time pairing code ONLY via
 *     a mode-0600, non-symlink `--pairing-file` that self-deletes upon burn).
 *
 * Rich Deterministic Fixtures Covered:
 *   - 5 main tabs (`overview`, `gm`, `sessions`, `calendar`, `models`) + topbar `⚙️`/`ⓘ`
 *   - Swarm Coordinator + 21 workers (22 total, partial coverage `18/22`, `nested_helper`,
 *     `killed` worker, long unspaced worker name, Inspect / Back to Main / Retarget /
 *     Pending-Unavailable interactive transitions)
 *   - Sentinel identity (`a@sentinel-secret.example`, `/Users/sentinel/secret-proj`,
 *     `Sentinel SecretUser`, opaque `acct_sentinel_opaque_01`) verifying SEC-04
 *     zero-leak full-chain privacy redaction across masked HTML, JSON & exports
 *   - Cache 5m Idle TTL (`cooling` heuristic vs provider reuse + Possible Causes)
 *   - Model-Call Decode vs E2E speed + strictly measured-only phase bars (`TTFT` + `Streaming`)
 *   - GM Anomaly Filter Bar (8 pills)
 *   - Weekly Active-Hours Forecast (populated + explicit `insufficient_history`)
 *   - Zero-Day Unknown Model adaptive badge (`MODEL_PLACEHOLDER_M9999`)
 *   - Workspace Project Leaderboard + explicit `Unattributed` row + Swarm Group Cost
 *   - Plan ROI collapsed `<details id="calPlanRoiAdvanced">` with reference disclaimer
 *   - Handoff v2 read-only preview bound to `(subjectCascadeId, dataRevision)`
 *   - Read-only Compaction Recovery Brief + dismiss action
 *   - Settings 5 logical groups + 10 currencies incl. `CAD` + backup/diagnostics actions
 *   - Unified frozen `PublishedMonitorObservation` ensuring Overview & Native HUD parity
 *
 * CLI Flags:
 *   --serve-only [--port <0..65535>] [--pairing-file <path>] [--clock <ISO|pre|post>] [--lang <en|zh|both>]
 *   --verify-security [--clock <ISO|pre|post>] [--json]
 *   --verify-browser [--smoke] [--clock <ISO|pre|post>] [--json]
 *   --help
 */

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
    closeSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import * as http from 'node:http';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);

// Sentinel PII strings — MUST NEVER leak anywhere in masked HTML, JSON, or exports.
export const SENTINEL_EMAIL = 'a@sentinel-secret.example';
export const SENTINEL_DOMAIN = 'sentinel-secret.example';
export const SENTINEL_BACKUP_EMAIL = 'b@sentinel-backup.example';
export const SENTINEL_WORKSPACE = '/Users/sentinel/secret-proj';
export const SENTINEL_WORKSPACE_NAME = 'secret-proj';
export const SENTINEL_NAME = 'Sentinel SecretUser';
export const SENTINEL_HANDLE = 'acct_sentinel_opaque_01';
export const SENTINEL_BACKUP_HANDLE = 'acct_sentinel_opaque_02';

export const SENTINEL_LEAK_TOKENS = Object.freeze([
    SENTINEL_EMAIL,
    SENTINEL_DOMAIN,
    SENTINEL_BACKUP_EMAIL,
    SENTINEL_WORKSPACE,
    SENTINEL_WORKSPACE_NAME,
    SENTINEL_NAME,
    'data-email=',
]);

const DEFAULT_CLOCK_ISO = '2026-11-30T12:00:00Z';
const FORBIDDEN_CHINESE_GLOSSARY_RE = /账户|冷缓存|首次响应|生成器调用|模型上限|暂停刷新|令牌|额度/;
const FORBIDDEN_COMPLIANCE_RE = /100%\s*ToS-safe|100%\s*Antigravity\s*ToS-compliant|100%\s*合规/i;

// ─── Isolated Temp Root & Private Mode-0600 Pairing File Helpers ─────────────

function resolveRealOrAncestor(targetPath) {
    const abs = resolve(targetPath);
    if (existsSync(abs)) { return realpathSync(abs); }
    const trailing = [];
    let cursor = abs;
    while (true) {
        const parent = dirname(cursor);
        if (parent === cursor) { return abs; }
        trailing.unshift(cursor.slice(parent.length).replace(/^[/\\]+/, ''));
        cursor = parent;
        if (existsSync(cursor)) {
            return join(realpathSync(cursor), ...trailing);
        }
    }
}

function assertStrictlyInsideTmpdir(dirPath, label) {
    const real = resolveRealOrAncestor(dirPath);
    const tmpReal = realpathSync(tmpdir());
    const rel = relative(tmpReal, real);
    assert.ok(
        rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel),
        `[STAGE3_ISOLATION] ${label} (${real}) MUST reside strictly inside os.tmpdir() (${tmpReal})`,
    );
    const realGemini = resolveRealOrAncestor(join(homedir(), '.gemini'));
    const relGemini = relative(realGemini, real);
    assert.ok(
        relGemini === '..' || relGemini.startsWith('..' + sep) || isAbsolute(relGemini),
        `[STAGE3_ISOLATION] ${label} (${real}) MUST NOT overlap real ~/.gemini (${realGemini})`,
    );
    return real;
}

function writePrivatePairingFile(filePath, payload) {
    const abs = resolve(filePath);
    mkdirSync(dirname(abs), { recursive: true });
    const fd = openSync(abs, 'wx', 0o600);
    try {
        writeFileSync(fd, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8' });
    } finally {
        closeSync(fd);
    }
    return abs;
}

// ─── Compiled Module Resolver (Works in Main Checkout & Fresh Git Worktrees) ─

function findTscToolchain() {
    const ext = process.platform === 'win32' ? '.cmd' : '';
    const roots = [REPO_ROOT];
    try {
        const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (commonDir) {
            const commonParent = resolve(REPO_ROOT, commonDir, '..');
            if (!roots.includes(commonParent)) { roots.push(commonParent); }
        }
    } catch { /* ignore outside git */ }

    for (const base of roots) {
        const tscBin = join(base, 'node_modules', '.bin', `tsc${ext}`);
        if (existsSync(tscBin)) {
            const typeRoots = join(base, 'node_modules', '@types');
            return { tscBin, typeRoots: existsSync(typeRoots) ? typeRoots : null };
        }
    }
    return null;
}

function resolveCompiledModules(tempRoot) {
    const repoOut = join(REPO_ROOT, 'out');
    let outDir = null;
    if (
        existsSync(join(repoOut, 'app', 'sidecar-server.js'))
        && existsSync(join(repoOut, 'webview-document.js'))
    ) {
        outDir = repoOut;
    } else {
        const toolchain = findTscToolchain();
        if (!toolchain) {
            throw new Error(
                'Compiled out/ modules not found and `tsc` binary is unavailable. Run `npm run compile` first.',
            );
        }
        const tempOut = join(tempRoot, 'compiled-out');
        mkdirSync(tempOut, { recursive: true });
        const tscArgs = ['-p', join(REPO_ROOT, 'tsconfig.json'), '--outDir', tempOut, '--sourceMap', 'false'];
        if (toolchain.typeRoots) {
            tscArgs.push('--typeRoots', toolchain.typeRoots);
        }
        execFileSync(
            toolchain.tscBin,
            tscArgs,
            { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 },
        );
        outDir = tempOut;
    }

    const load = (rel) => require(join(outDir, rel));
    return {
        outDir,
        sidecarServer: load('app/sidecar-server.js'),
        sidecarTypes: load('app/sidecar-types.js'),
        webviewDocument: load('webview-document.js'),
        webviewCalendarTab: load('webview-calendar-tab.js'),
        i18nCore: load('i18n-core.js'),
        models: load('models.js'),
        pricingStore: load('pricing-store.js'),
        dailyStore: load('daily-store.js'),
        gmSummary: load('gm/summary.js'),
        telemetryMetrics: load('telemetry-metrics.js'),
        contextDisplay: load('core/context-display.js'),
        swarmRegistry: load('core/swarm-registry.js'),
        version: load('core/version.js'),
    };
}

// ─── Isolated Temp Environment & Read-Only Temp Brain Manifest ───────────────

function createStage3TempEnvironment() {
    const rootDir = mkdtempSync(join(tmpdir(), 'acm-stage3-fixture-'));
    assertStrictlyInsideTmpdir(rootDir, 'Stage 3 temp root');

    const homeDir = join(rootDir, 'home');
    const brainDir = join(homeDir, '.gemini', 'antigravity', 'brain');
    const cliDataDir = join(homeDir, '.gemini', 'antigravity-cli');
    const stateDir = join(rootDir, 'state');
    const statePath = join(stateDir, 'state-v1.json');

    for (const dir of [homeDir, brainDir, cliDataDir, stateDir]) {
        mkdirSync(dir, { recursive: true });
    }

    // Write a realistic read-only swarm manifest inside temp brainDir (Coordinator + 21 workers)
    const coordId = 'stage3-coord-root';
    const manifestDir = join(brainDir, coordId, '.system_generated', 'swarm');
    mkdirSync(manifestDir, { recursive: true });

    const manifestMembers = {
        coordinator: {
            conversation_id: coordId,
            role: 'coordinator',
            model: 'Gemini 4 Neon',
            applied_model: 'Gemini 4 Neon',
            workspace_mode: 'inherit',
            phase: 'WORKING',
            killed: false,
            workspace: SENTINEL_WORKSPACE,
        },
    };
    for (let i = 1; i <= 21; i++) {
        // Leave stage3-worker-2 out of the flat root manifest so it reconciles purely via
        // typed RPC nested_helper linkage (parent=stage3-worker-1 -> depth=2) alongside 20 manifest workers.
        if (i === 2) { continue; }
        const name = i === 1
            ? 'super-long-swarm-worker-identifier-without-spaces-0123456789abcdef'
            : `worker-${i}`;
        manifestMembers[name] = {
            conversation_id: `stage3-worker-${i}`,
            role: 'worker',
            model: i % 3 === 0 ? 'Gemini 4 Hydrogen' : 'Gemini 4 Neon',
            applied_model: i === 1 ? 'Claude Opus 5.5' : 'Gemini 4 Neon',
            workspace_mode: i % 4 === 0 ? 'branch' : (i % 2 === 0 ? 'inherit' : 'share'),
            phase: i === 1 ? 'WORKING' : (i === 21 ? 'KILLED' : 'WAITING'),
            killed: i === 21,
            workspace: `${SENTINEL_WORKSPACE}/worktree-${i}`,
        };
    }

    writeFileSync(
        join(manifestDir, 'members.json'),
        JSON.stringify({
            title: 'Stage 3 Isolated Verification Swarm',
            members: manifestMembers,
        }, null, 2) + '\n',
        'utf8',
    );
    writeFileSync(statePath, JSON.stringify({ version: 1, isolated: true }) + '\n', 'utf8');

    let cleaned = false;
    return {
        rootDir,
        homeDir,
        brainDir,
        cliDataDir,
        stateDir,
        statePath,
        coordId,
        cleanup() {
            if (cleaned) { return; }
            cleaned = true;
            rmSync(rootDir, { recursive: true, force: true });
        },
    };
}

// ─── Full-Chain SEC-04 Sentinel Privacy Redactor ─────────────────────────────

function escapeRegex(raw) {
    return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactSentinelText(raw) {
    if (typeof raw !== 'string' || !raw) { return raw; }
    let out = raw;
    const replacements = [
        [SENTINEL_EMAIL, '****@redacted'],
        [SENTINEL_BACKUP_EMAIL, '****@redacted'],
        [SENTINEL_DOMAIN, 'redacted'],
        ['sentinel-backup.example', 'redacted'],
        [SENTINEL_WORKSPACE, '[Redacted Workspace]'],
        [SENTINEL_WORKSPACE_NAME, '[Redacted Project]'],
        [SENTINEL_NAME, 'S***'],
    ];
    for (const [needle, repl] of replacements) {
        out = out.replace(new RegExp(escapeRegex(needle), 'gi'), repl);
    }
    return out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '****@redacted');
}

function redactDeep(value) {
    if (typeof value === 'string') { return redactSentinelText(value); }
    if (Array.isArray(value)) { return value.map(redactDeep); }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            const safeKey = redactSentinelText(k);
            out[safeKey] = redactDeep(v);
        }
        return out;
    }
    return value;
}

// ─── Isolated Stage 3 Fixture SidecarProvider ────────────────────────────────

export async function createStage3FixtureProvider(mods, env, options = {}) {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    const version = options.version || pkg.version || mods.version.resolveRuntimeVersion();
    const fixedClockIso = options.clockIso || DEFAULT_CLOCK_ISO;
    const nowMs = Date.parse(fixedClockIso);
    const nowDate = new Date(nowMs);
    const createdAt = nowDate.toISOString();
    const earlierIso = new Date(nowMs - 15 * 60_000).toISOString();
    const resetTime = new Date(nowMs + 3 * 3600_000).toISOString();
    const weeklyResetTime = new Date(nowMs + 5 * 24 * 3600_000).toISOString();

    // Scan ONLY the isolated temp brain directory via real SwarmTopologyRegistry (ZERO real ~/.gemini access!)
    const brainScope = {
        brainDir: env.brainDir,
        homeDir: env.homeDir,
        env: { ANTIGRAVITY_BRAIN_DIR: env.brainDir },
    };
    const resolvedBrainRoot = mods.swarmRegistry.resolveScopedBrainRoot(brainScope);
    assert.equal(resolvedBrainRoot, resolve(env.brainDir), 'SwarmTopologyRegistry MUST resolve strictly to isolated temp brainDir');
    assertStrictlyInsideTmpdir(resolvedBrainRoot, 'resolved SwarmTopologyRegistry brainDir');

    const registry = new mods.swarmRegistry.SwarmTopologyRegistry({
        scope: brainScope,
    });
    const sweepRes = await registry.sweepManifests({ nowMs });
    assert.equal(sweepRes.scannedDirs, 1, `Isolated temp brainDir must scan exactly 1 dir (got ${sweepRes.scannedDirs})`);
    assert.equal(sweepRes.manifestsRead, 1, `Isolated temp brainDir must read exactly 1 manifest (got ${sweepRes.manifestsRead})`);

    const memState = {
        data: new Map(),
        get(key, fallback) { return this.data.has(key) ? this.data.get(key) : fallback; },
        async update(key, value) { this.data.set(key, value); },
    };

    // Stateful interactive fixture state
    let language = options.initialLang || 'both';
    let paused = false;
    let privacyMasked = true; // Fail-closed default (SEC-04)
    const privacyByWindow = new Map();
    let dataRevision = 42;
    let selectionRevision = 3;
    let lockedRootId = env.coordId;
    let lockToMainAgent = true;
    let inspectedMemberId = 'stage3-worker-1';
    let lockPendingUnavailable = true;
    let retargetOfferId = 'stage3-new-main-99';
    let retargetOfferTitle = 'New Main Feature Branch';
    let recoveryBriefDismissed = false;
    let registeredWorkspaces = [`file://${SENTINEL_WORKSPACE}`];
    let ackFocusRevision = 0;

    const appSettings = {
        languagePreference: language,
        displayCurrency: 'USD',
        customFxRate: null,
        customFxCurrency: null,
        subscriptionPlan: 'google-ai-pro',
        subscriptionMonthlyFee: 19.99,
        subscriptionCurrency: 'USD',
        contextPctBasis: 'compaction',
        speedMetricMode: 'decode',
        quotaWindowMode: '5h',
        quotaDirectionMode: 'remaining',
        appShowNativeHudBar: true,
        ideShowNativeHudBar: false,
        nativeHudAutoHideOnOverview: true,
        cdpOverlayFontSize: 'normal',
        cdpOverlayHighContrast: false,
        orchestratorPricingMode: 'mapped',
        appComposerRingEnabled: false,
        appTopBarEnabled: false,
        lockToMainAgent: true,
    };

    const sideEffects = {
        lsPolls: 0,
        cdpProbes: 0,
        externalFetches: 0,
        renderHtmlCalls: 0,
        getSnapshotCalls: 0,
        handleActionCalls: 0,
    };

    // Build deterministic model configs including Zero-Day Unknown Model (M9999)
    const modelConfigs = [
        {
            model: 'MODEL_PLACEHOLDER_M535',
            label: 'Gemini 4 Neon (Extra High)',
            quotaInfo: { remainingFraction: 0.62, resetTime },
            weeklyQuota: { remainingFraction: 0.45, resetTime: weeklyResetTime },
            supportsImages: true,
            supportsThinking: true,
            isRecommended: true,
        },
        {
            model: 'MODEL_PLACEHOLDER_M401',
            label: 'Claude Opus 5.5 (Medium)',
            quotaInfo: { remainingFraction: 0.91, resetTime },
            weeklyQuota: { remainingFraction: 0.96, resetTime: weeklyResetTime },
            supportsImages: true,
            supportsThinking: true,
        },
        {
            model: 'MODEL_PLACEHOLDER_M427',
            label: 'Gemini 4 Carbon (High)',
            quotaInfo: { remainingFraction: 0.62, resetTime },
            supportsImages: true,
        },
        {
            model: 'MODEL_PLACEHOLDER_M9999',
            label: 'Gemini 5 Unseen Experimental',
            quotaInfo: { remainingFraction: 0.78, resetTime },
            supportsImages: false,
        },
    ];

    const quotaSummary = {
        groups: [
            {
                pool: 'gemini',
                displayName: 'Gemini Models',
                fiveHour: { bucketId: 'gemini-5h', window: '5h', remainingFraction: 0.62, resetTime, resetAt: Date.parse(resetTime) },
                weekly: { bucketId: 'gemini-7d', window: 'weekly', remainingFraction: 0.45, resetTime: weeklyResetTime, resetAt: Date.parse(weeklyResetTime) },
                buckets: [],
            },
            {
                pool: 'premium',
                displayName: 'Claude and GPT models',
                fiveHour: { bucketId: '3p-5h', window: '5h', remainingFraction: 0.91, resetTime, resetAt: Date.parse(resetTime) },
                weekly: { bucketId: '3p-7d', window: 'weekly', remainingFraction: 0.96, resetTime: weeklyResetTime, resetAt: Date.parse(weeklyResetTime) },
                buckets: [],
            },
        ],
    };

    const weeklyRunways = [
        {
            account: SENTINEL_HANDLE,
            pool: 'pool-gemini',
            window: '7d',
            resetEpoch: Date.parse(weeklyResetTime),
            status: 'at_risk',
            burnRatePctPerActiveHour: 4.5,
            avgActiveHoursPerDay: 5.0,
            projectedDailyBurnPct: 22.5,
            estRemainingActiveHours: 10.0,
            estExhaustMs: 48 * 3600_000,
            timeToResetMs: 120 * 3600_000,
            latestRemainingFraction: 0.45,
            coverage: {
                activeHours: 12.5, activeHourBuckets: 13, activeDays: 3, observedSpanHours: 60,
                minActiveHours: 2, minActiveDays: 2, minSpanHours: 24, meetsThreshold: true,
            },
            dailySummaries: [],
            offlineGapCount: 1,
            fractionalResetCount: 0,
            epochsConsidered: 1,
        },
        {
            account: SENTINEL_HANDLE,
            pool: 'pool-claude',
            window: '7d',
            resetEpoch: Date.parse(weeklyResetTime),
            status: 'insufficient_history',
            burnRatePctPerActiveHour: null,
            avgActiveHoursPerDay: null,
            projectedDailyBurnPct: null,
            estRemainingActiveHours: null,
            estExhaustMs: null,
            timeToResetMs: 120 * 3600_000,
            latestRemainingFraction: 0.96,
            coverage: {
                activeHours: 0.5, activeHourBuckets: 1, activeDays: 1, observedSpanHours: 4,
                minActiveHours: 2, minActiveDays: 2, minSpanHours: 24, meetsThreshold: false,
            },
            dailySummaries: [],
            offlineGapCount: 0,
            fractionalResetCount: 0,
            epochsConsidered: 1,
        },
    ];

    const rawUserInfo = {
        name: SENTINEL_NAME,
        email: SENTINEL_EMAIL,
        planName: 'Pro',
        userTierName: 'Google AI Pro',
        defaultModelLabel: 'Gemini 4 Neon (Extra High)',
        modelSortOrder: [],
        planLimits: {
            maxNumChatInputTokens: 512_000, maxNumPremiumChatMessages: 100,
            maxCustomChatInstructionCharacters: 12_000, maxNumPinnedContextItems: 25,
            maxLocalIndexSize: 4000, monthlyFlexCreditPurchaseAmount: 0,
        },
        availableCredits: [
            { creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: 1850, minimumCreditAmountForUsage: 0 },
        ],
    };

    const rawAccountSnapshots = [
        {
            email: SENTINEL_EMAIL,
            accountHandle: SENTINEL_HANDLE,
            name: SENTINEL_NAME,
            planName: 'Pro',
            tierName: 'Google AI Pro',
            earliestResetTime: resetTime,
            allResetTimes: [resetTime],
            resetPools: [
                { resetTime, modelLabels: ['Gemini 4 Neon'], remainingPercent: 62, hasUsage: true },
                { resetTime, modelLabels: ['Claude Opus 5.5'], remainingPercent: 91, hasUsage: true },
            ],
            isActive: true,
            lastSeen: createdAt,
            credits: [{ creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: 1850 }],
        },
        {
            email: SENTINEL_BACKUP_EMAIL,
            accountHandle: SENTINEL_BACKUP_HANDLE,
            name: 'Backup Sentinel',
            planName: 'Free',
            tierName: 'Free',
            earliestResetTime: earlierIso,
            allResetTimes: [earlierIso],
            resetPools: [],
            isActive: false,
            lastSeen: earlierIso,
            credits: [{ creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: null }],
        },
    ];

    const rawTrajectories = [
        {
            cascadeId: env.coordId,
            summary: `Coordinator audit for ${SENTINEL_WORKSPACE_NAME}`,
            requestedModel: 'MODEL_PLACEHOLDER_M535',
            generatorModel: 'MODEL_PLACEHOLDER_M535',
            workspaceUris: [`file://${SENTINEL_WORKSPACE}`],
            gitRootUri: `file://${SENTINEL_WORKSPACE}`,
            repositoryName: SENTINEL_WORKSPACE_NAME,
            branchName: 'release-v118',
            status: 'CASCADE_STATUS_RUNNING',
            stepCount: 24,
            createdTime: earlierIso,
            lastModifiedTime: createdAt,
            lastUserInputTime: createdAt,
        },
        {
            cascadeId: 'stage3-worker-1',
            summary: 'Worker 1 long-running security audit',
            requestedModel: 'MODEL_PLACEHOLDER_M401',
            generatorModel: 'MODEL_PLACEHOLDER_M401',
            workspaceUris: [`file://${SENTINEL_WORKSPACE}/worktree-1`],
            gitRootUri: `file://${SENTINEL_WORKSPACE}/worktree-1`,
            repositoryName: SENTINEL_WORKSPACE_NAME,
            branchName: 'worker-1',
            status: 'CASCADE_STATUS_RUNNING',
            stepCount: 14,
            createdTime: earlierIso,
            lastModifiedTime: createdAt,
            lastUserInputTime: createdAt,
        },
        {
            cascadeId: 'stage3-new-main-99',
            summary: retargetOfferTitle,
            requestedModel: 'MODEL_PLACEHOLDER_M535',
            generatorModel: 'MODEL_PLACEHOLDER_M535',
            workspaceUris: [`file://${SENTINEL_WORKSPACE}`],
            gitRootUri: `file://${SENTINEL_WORKSPACE}`,
            repositoryName: SENTINEL_WORKSPACE_NAME,
            branchName: 'feat-new-main',
            status: 'CASCADE_STATUS_IDLE',
            stepCount: 4,
            createdTime: createdAt,
            lastModifiedTime: createdAt,
            lastUserInputTime: createdAt,
        },
    ];

    const rawGmCalls = [
        {
            stepIndices: [1], executionId: 'stage3-call-1',
            model: 'MODEL_PLACEHOLDER_M535', modelDisplay: 'Gemini 4 Neon (Extra High)',
            responseModel: 'gemini-4-neon', modelAccuracy: 'exact',
            inputTokens: 15_000, outputTokens: 1_200, thinkingTokens: 400, responseTokens: 800,
            cacheReadTokens: 160_000, cacheCreationTokens: 0,
            apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
            ttftSeconds: 0.78, streamingSeconds: 12.0, credits: 0, creditType: '',
            hasError: false, errorMessage: '', contextTokensUsed: 175_000,
            completionConfig: null, systemPromptSnippet: `Prompt for ${SENTINEL_EMAIL}`,
            toolCount: 2, toolNames: ['read_file', 'run_command'], promptSectionTitles: ['Identity'],
            promptSnippet: '', promptSource: 'none', messagePromptCount: 1,
            messageMetadataKeys: [], responseHeaderKeys: [], userMessageAnchors: [], aiSnippetsByStep: {},
            retries: 0, stopReason: 'STOP_REASON_END_TURN',
            retryTokensIn: 0, retryTokensOut: 0, retryCredits: 0, retryErrors: [],
            timeSinceLastInvocation: 0, tokenBreakdownGroups: [], createdAt: earlierIso,
            latestStableMessageIndex: 0, startStepIndex: 1, checkpointIndex: 0,
            checkpointSummaries: [], systemContextItems: [],
            accountEmail: SENTINEL_EMAIL, toolCallsByStep: {}, contextWindowCapacity: 512_000,
        },
        {
            stepIndices: [2], executionId: 'stage3-call-2',
            model: 'MODEL_PLACEHOLDER_M401', modelDisplay: 'Claude Opus 5.5 (Medium)',
            responseModel: 'claude-opus-5-5', modelAccuracy: 'exact',
            inputTokens: 210_000, outputTokens: 900, thinkingTokens: 300, responseTokens: 600,
            cacheReadTokens: 0, cacheCreationTokens: 8_000,
            apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
            ttftSeconds: 8.4, streamingSeconds: 10.0, credits: 0, creditType: '',
            hasError: true, errorMessage: `HTTP 429 on ${SENTINEL_WORKSPACE}`, contextTokensUsed: 460_000,
            completionConfig: null, systemPromptSnippet: '',
            toolCount: 1, toolNames: ['read_file'], promptSectionTitles: [],
            promptSnippet: '', promptSource: 'none', messagePromptCount: 1,
            messageMetadataKeys: [], responseHeaderKeys: [], userMessageAnchors: [], aiSnippetsByStep: {},
            retries: 2, stopReason: 'STOP_REASON_MAX_TOKENS',
            retryTokensIn: 4000, retryTokensOut: 0, retryCredits: 0,
            retryErrors: [`HTTP 429 for ${SENTINEL_EMAIL}`],
            timeSinceLastInvocation: 0, tokenBreakdownGroups: [], createdAt,
            latestStableMessageIndex: 0, startStepIndex: 2, checkpointIndex: 0,
            checkpointSummaries: [], systemContextItems: [],
            accountEmail: SENTINEL_EMAIL, toolCallsByStep: {}, contextWindowCapacity: 512_000,
        },
    ];

    const rawGmSummary = mods.gmSummary.buildSummaryFromConversations([{
        cascadeId: env.coordId,
        title: `Coordinator audit for ${SENTINEL_WORKSPACE_NAME}`,
        totalSteps: 24,
        calls: rawGmCalls,
        checkpointSummaries: [],
    }], createdAt);

    const rawDailyStoreSnap = {
        version: 1,
        records: {
            '2026-11-30': {
                date: '2026-11-30',
                totalReasoning: 6, totalToolCalls: 4, totalErrors: 1, totalSteps: 10,
                totalToolReturnTokens: 1200, conversations: 2, gmCalls: 6,
                gmInputTokens: 225_000, gmOutputTokens: 12_000, gmThinkingTokens: 1_500,
                gmCacheReadTokens: 160_000, gmCacheCreationTokens: 8_000,
                gmCredits: 0, gmEstimatedCost: 0.92,
                cycles: [
                    {
                        startTime: earlierIso, endTime: createdAt,
                        accountEmail: SENTINEL_EMAIL,
                        totalReasoning: 4, totalToolCalls: 3, totalErrors: 0, totalSteps: 6,
                        totalToolReturnTokens: 800, conversations: 1, gmCalls: 4, gmTotalCalls: 4,
                        gmInputTokens: 180_000, gmOutputTokens: 8_000, gmThinkingTokens: 1_000,
                        gmCacheReadTokens: 160_000, gmCacheCreationTokens: 0,
                        gmCredits: 0, gmEstimatedCost: 0.68, estimatedCost: 0.68,
                        sources: ['app'],
                        workspaceBreakdown: {
                            [SENTINEL_WORKSPACE]: {
                                calls: 4, inputTokens: 180_000, outputTokens: 8_000,
                                thinkingTokens: 1_000, cacheReadTokens: 160_000, cacheCreationTokens: 0,
                                credits: 0, knownCostUsd: 0.68, unpricedCalls: 1,
                            },
                        },
                    },
                    {
                        startTime: earlierIso, endTime: createdAt,
                        accountEmail: SENTINEL_EMAIL,
                        totalReasoning: 2, totalToolCalls: 1, totalErrors: 1, totalSteps: 4,
                        totalToolReturnTokens: 400, conversations: 1, gmCalls: 2, gmTotalCalls: 2,
                        gmInputTokens: 45_000, gmOutputTokens: 4_000, gmThinkingTokens: 500,
                        gmCacheReadTokens: 0, gmCacheCreationTokens: 8_000,
                        gmCredits: 0, gmEstimatedCost: 0.24, estimatedCost: 0.24,
                        sources: ['ide'],
                        // No workspaceBreakdown -> explicit Unattributed row!
                    },
                ],
            },
        },
    };

    const swarmGroupCost = {
        rootId: env.coordId,
        directCostByMember: {
            [env.coordId]: { cascadeId: env.coordId, directCostUsd: 0.68, callCount: 4, pricedCallCount: 3, unpricedCallCount: 1, totalTokens: 188_000 },
            'stage3-worker-1': { cascadeId: 'stage3-worker-1', directCostUsd: 1.42, callCount: 5, pricedCallCount: 4, unpricedCallCount: 1, totalTokens: 112_000 },
        },
        coordinatorDirectCostUsd: 0.68,
        workersDirectCostUsd: 2.77,
        inclusiveGroupCostUsd: 3.45,
        uniqueCallCount: 14,
        duplicateCallsDeduplicated: 2,
        pricedCallCount: 12,
        unpricedCallCount: 2,
        hasUnpricedCalls: true,
    };

    const cacheTtl = mods.telemetryMetrics.evaluatePromptCacheTtl({
        key: { account: SENTINEL_HANDLE, backend: 'isolated-fixture', conversation: env.coordId, model: 'gemini-4-neon', branch: 'release-v118' },
        lastEventMs: nowMs - 210_000, // 210s -> cooling (>=180s)
        nowMs,
        measured: {
            inputTokens: 50_000,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            cacheTelemetryAvailable: true,
        },
        transition: {
            previousModel: 'claude-opus-5-5',
            currentModel: 'gemini-4-neon',
            modelSwitchConfirmed: false,
            compactionSuspected: true,
            hadPriorWarmCache: true,
        },
    });

    const pricingStore = new mods.pricingStore.PricingStore();

    // Build reconciled SwarmTopologySnapshot from our isolated temp brain manifest + typed RPC links
    const topologySnapshot = registry.reconcile({
        backendEpoch: 1,
        nowMs,
        trajectories: [
            { cascadeId: env.coordId, summary: 'Coordinator', lastModifiedTime: createdAt },
            ...Array.from({ length: 21 }, (_, idx) => ({
                cascadeId: `stage3-worker-${idx + 1}`,
                summary: `Worker ${idx + 1}`,
                parentId: idx === 1 ? 'stage3-worker-1' : env.coordId,
                lastModifiedTime: createdAt,
            })),
        ],
        rpcLinks: [
            {
                parentCascadeId: env.coordId,
                childCascadeId: 'stage3-worker-1',
                kind: 'swarm_member',
                observedAtMs: nowMs,
                memberName: 'super-long-swarm-worker-identifier-without-spaces-0123456789abcdef',
            },
            {
                parentCascadeId: 'stage3-worker-1',
                childCascadeId: 'stage3-worker-2',
                kind: 'nested_helper',
                observedAtMs: nowMs,
                memberName: 'nested-helper-2',
            },
        ],
    });
    assert.equal(
        topologySnapshot.groupsByRootId.size,
        1,
        `Isolated topology must have exactly 1 swarm group (got ${topologySnapshot.groupsByRootId.size})`,
    );
    assert.equal(
        topologySnapshot.groupsByRootId.get(env.coordId)?.title,
        'Stage 3 Isolated Verification Swarm',
        'Isolated topology group title must match temp fixture manifest only',
    );

    function buildSwarmOverview(masked) {
        const members = Array.from({ length: 22 }, (_, idx) => {
            const cid = idx === 0 ? env.coordId : `stage3-worker-${idx}`;
            const rawName = idx === 0
                ? 'coordinator'
                : (idx === 1 ? 'super-long-swarm-worker-identifier-without-spaces-0123456789abcdef' : (idx === 2 ? 'nested-helper-2' : `worker-${idx}`));
            return {
                cascadeId: cid,
                memberName: masked ? (idx === 0 ? 'coordinator' : (idx === 1 ? 'super-long-swarm-worker-identifier-without-spaces-0123456789abcdef' : rawName)) : rawName,
                isCoordinator: idx === 0,
                role: idx === 0 ? 'Coordinator' : 'Worker',
                relationshipKind: idx === 2 ? 'nested_helper' : 'swarm_member',
                phase: idx === 1 ? 'WORKING' : (idx === 21 ? 'KILLED' : 'WAITING'),
                killed: idx === 21,
                assignedModel: idx % 3 === 0 ? 'Gemini 4 Hydrogen' : 'Gemini 4 Neon',
                measuredModel: idx === 1 ? 'Claude Opus 5.5' : null,
                contextPct: idx === 1 ? 82 : (21 + (idx % 35)),
                directCostUsd: idx === 1 ? 1.42 : 0.14,
                unpricedCalls: idx === 1 ? 1 : 0,
                lastObservedAt: idx < 18 ? nowMs - 4_000 : null,
                isInspected: inspectedMemberId === cid,
                isLockedRoot: lockedRootId === cid,
            };
        });
        return {
            rootId: lockedRootId,
            title: 'Stage 3 Isolated Verification Swarm',
            members,
            totalMemberCount: 22,
            observedMemberCount: 18,
            partialCoverage: true,
            groupTotalCostUsd: swarmGroupCost.inclusiveGroupCostUsd,
            groupUnpricedCalls: swarmGroupCost.unpricedCallCount,
            lastSweepAtMs: nowMs - 1_500,
        };
    }

    function buildCurrentObservation() {
        const subjectId = inspectedMemberId || lockedRootId;
        const isWorker = Boolean(inspectedMemberId && inspectedMemberId !== lockedRootId);
        return mods.contextDisplay.buildPublishedMonitorObservation({
            backendEpoch: 1,
            windowId: 'stage3-standalone',
            rootCascadeId: lockedRootId,
            subjectCascadeId: subjectId,
            subjectKind: isWorker ? 'worker' : 'main',
            selectionRevision,
            dataRevision,
            measuredModel: isWorker ? 'claude-opus-5-5' : 'gemini-4-neon',
            tokenSource: 'tracker_usage',
            usedTokens: isWorker ? 419_840 : 185_000,
            compactionLimit: 512_000,
            compactionLimitProvenance: 'model_catalog',
            nativeLimit: 1_048_576,
            nativeLimitProvenance: 'model_catalog',
            requestedBasis: appSettings.contextPctBasis,
            speedMode: appSettings.speedMetricMode,
            speedSampleScope: 'latest_call',
            speedCallId: 'stage3-call-1',
            displaySpeedTps: 100.0,
            sessionCostUsd: isWorker ? 1.42 : 0.68,
            observedAtMs: nowMs,
        });
    }

    function buildDocumentParams(effectiveLang, effectiveMasked) {
        const observation = buildCurrentObservation();
        const subjectId = observation.subjectCascadeId || lockedRootId;
        const swarmOverview = buildSwarmOverview(effectiveMasked);

        const currentUsageRaw = {
            cascadeId: subjectId,
            title: subjectId === env.coordId
                ? `Coordinator audit for ${SENTINEL_WORKSPACE_NAME}`
                : `Worker ${subjectId}`,
            model: subjectId === 'stage3-worker-1' ? 'MODEL_PLACEHOLDER_M401' : 'MODEL_PLACEHOLDER_M535',
            modelDisplayName: subjectId === 'stage3-worker-1' ? 'Claude Opus 5.5 (Medium)' : 'Gemini 4 Neon (Extra High)',
            contextUsed: observation.usedTokens ?? 185_000,
            contextLimit: 512_000,
            usagePercent: observation.primaryPct ?? 36.1,
            status: 'RUNNING',
            stepCount: 24,
            lastModifiedTime: createdAt,
            isEstimated: false,
            lastModelUsage: { inputTokens: 15_000, outputTokens: 1_200, cacheReadTokens: 160_000, cacheCreationTokens: 0 },
            totalOutputTokens: 8_400,
            totalToolCallOutputTokens: 22_000,
            estimatedDeltaSinceCheckpoint: 0,
            imageGenStepCount: 0,
            compressionDetected: false,
            checkpointCompressionDrop: 0,
            hasGaps: false,
            checkpointModel: '',
            createdTime: earlierIso,
            lastUserInputTime: createdAt,
            lastUserInputStepIndex: 20,
            repositoryName: SENTINEL_WORKSPACE_NAME,
            gitOriginUrl: '',
            branchName: 'release-v118',
            gitRootUri: `file://${SENTINEL_WORKSPACE}`,
        };

        const outUserInfo = effectiveMasked
            ? { ...rawUserInfo, name: 'S***', email: '****@redacted' }
            : rawUserInfo;
        const outAccountSnapshots = effectiveMasked
            ? rawAccountSnapshots.map((a) => ({ ...a, name: 'S***', email: '****@redacted' }))
            : rawAccountSnapshots;
        const outTrajectories = effectiveMasked
            ? rawTrajectories.map((tr) => ({
                ...tr,
                summary: redactSentinelText(tr.summary),
                workspaceUris: ['[Redacted Workspace]'],
                repositoryName: '[Redacted Repo]',
                branchName: '[Redacted Branch]',
                gitRootUri: '',
            }))
            : rawTrajectories;
        const outUsage = effectiveMasked
            ? {
                ...currentUsageRaw,
                title: redactSentinelText(currentUsageRaw.title),
                repositoryName: '[Redacted Repo]',
                branchName: '[Redacted Branch]',
                gitRootUri: '',
            }
            : currentUsageRaw;
        const outGmSummary = effectiveMasked ? redactDeep(rawGmSummary) : rawGmSummary;
        const outDailyStore = new mods.dailyStore.DailyStore();
        outDailyStore.restoreSnapshot(effectiveMasked ? redactDeep(rawDailyStoreSnap) : rawDailyStoreSnap);

        const handoffV2 = mods.sidecarTypes.buildAllowlistedHandoffV2({
            observation,
            subjectCascadeId: subjectId,
            dataRevision,
            canonicalModel: observation.measuredModel,
            title: outUsage.title,
            workspaceUriOrLabel: SENTINEL_WORKSPACE,
            branchName: 'release-v118',
            swarmSummary: {
                activeCount: 18,
                totalCount: 22,
                members: swarmOverview.members.slice(0, 6).map((m) => ({
                    name: m.memberName,
                    role: m.role,
                    phase: m.phase,
                    killed: m.killed,
                })),
            },
            turnStatus: {
                status: 'RUNNING',
                stepCount: 24,
                callCount: 2,
                cacheState: 'cooling',
                speedMode: appSettings.speedMetricMode,
                speedTps: 100.0,
                compressionDetected: false,
            },
            privacyMasked: effectiveMasked,
            redactText: redactSentinelText,
            lang: effectiveLang,
        });

        const recoveryBrief = recoveryBriefDismissed ? null : {
            eventKey: `${env.coordId}:gemini-4-neon:planner:release-v118:20`,
            cascadeId: env.coordId,
            model: 'gemini-4-neon',
            role: 'planner',
            branch: 'release-v118',
            beforeTokens: 320_000,
            afterTokens: 185_000,
            savedTokens: 135_000,
            summaryText: effectiveMasked
                ? redactSentinelText(`Compacted ${SENTINEL_WORKSPACE} history safely to 185k tokens.`)
                : `Compacted ${SENTINEL_WORKSPACE} history safely to 185k tokens.`,
            observedAtMs: nowMs - 30_000,
        };

        const outStorageDiagnostics = {
            stateFilePath: effectiveMasked ? '[Redacted Path]/state-v1.json' : env.statePath,
            stateFileExists: true,
            stateFileSizeBytes: 12_288,
            stateFileOpenWarnBytes: 1024 * 1024,
            calendarDayCount: 1,
        };

        const cdpStatus = {
            state: 'disabled',
            diagnosticCode: 'disabled',
            composerEnabled: false,
            topBarEnabled: false,
            platformGuide: {
                platform: process.platform === 'win32' ? 'win32' : (process.platform === 'linux' ? 'linux' : 'darwin'),
                command: 'antigravity --remote-debugging-port=0',
                en: 'Optional CDP overlays are disabled in isolated Stage 3 fixture mode.',
                zh: '隔离 Stage 3 夹具模式下默认关闭可选 CDP 悬浮层。',
            },
        };

        const updateStatus = {
            status: 'up_to_date',
            hasUpdate: false,
            updateAvailable: false,
            currentVersion: version,
            latestVersion: version,
            checkedAt: nowMs,
        };

        const inspectedRow = inspectedMemberId
            ? swarmOverview.members.find((m) => m.cascadeId === inspectedMemberId)
            : null;

        return {
            surface: 'app-sidecar',
            version,
            now: nowMs,
            paused,
            currentUsage: outUsage,
            allTrajectoryUsages: [outUsage],
            allTrajectories: outTrajectories,
            modelConfigs,
            userInfo: outUserInfo,
            workspaceUri: effectiveMasked ? '' : `file://${SENTINEL_WORKSPACE}`,
            gmSummary: outGmSummary,
            gmFullSummary: outGmSummary,
            pricingStore,
            dailyStore: outDailyStore,
            storageDiagnostics: outStorageDiagnostics,
            accountSnapshots: outAccountSnapshots,
            accountHandle: SENTINEL_HANDLE,
            billingDays: { [SENTINEL_HANDLE]: 15 },
            quotaSummary,
            weeklyRunways,
            cacheTtl,
            swarmOverview,
            swarmTopology: topologySnapshot,
            swarmGroupCost,
            inspectedMemberId,
            inspectedMemberLabel: inspectedRow ? inspectedRow.memberName : null,
            lockedRootId,
            lockToMainAgent,
            lockPendingUnavailable,
            retargetOfferId,
            retargetOfferTitle: effectiveMasked ? redactSentinelText(retargetOfferTitle) : retargetOfferTitle,
            handoffPreview: {
                subjectCascadeId: handoffV2.subjectCascadeId || subjectId,
                dataRevision: handoffV2.dataRevision,
                markdown: handoffV2.previewText,
                generatedAtMs: nowMs,
            },
            recoveryBrief,
            observation,
            privacyMasked: effectiveMasked,
            appSettings: { ...appSettings },
            cdpStatus,
            updateStatus,
            sessionCostUsd: observation.sessionCostUsd ?? 0.68,
            todayCostUsd: 0.92,
            calendarYear: 2026,
            calendarMonth: 11,
            calendarOptions: {
                currency: appSettings.displayCurrency,
                subscription: {
                    planId: appSettings.subscriptionPlan,
                    monthlyFee: appSettings.subscriptionMonthlyFee,
                    feeCurrency: appSettings.subscriptionCurrency,
                },
                privacyMasked: effectiveMasked,
                swarmGroupCosts: { [swarmGroupCost.rootId]: swarmGroupCost },
                now: nowDate,
            },
        };
    }

    const provider = {
        version,
        getSideEffects: () => ({ ...sideEffects }),
        getFixtureState: () => ({
            language,
            paused,
            privacyMasked,
            dataRevision,
            selectionRevision,
            lockedRootId,
            lockToMainAgent,
            inspectedMemberId,
            lockPendingUnavailable,
            retargetOfferId,
            recoveryBriefDismissed,
            registeredWorkspaces: [...registeredWorkspaces],
            ackFocusRevision,
        }),
        getLatestObservation: () => buildCurrentObservation(),

        async renderHtml(ctx) {
            sideEffects.renderHtmlCalls += 1;
            const effectiveLang = ctx.lang || language;
            const effectiveMasked = typeof ctx.privacyMasked === 'boolean' ? ctx.privacyMasked : privacyMasked;
            await mods.i18nCore.setLanguageToState(effectiveLang, memState);
            const params = buildDocumentParams(effectiveLang, effectiveMasked);
            let html = mods.webviewDocument.buildMonitorDocumentHtml(params);
            if (effectiveMasked) {
                html = redactSentinelText(html);
            }
            return html;
        },

        async getSnapshot(query) {
            sideEffects.getSnapshotCalls += 1;
            const effectiveLang = query.lang || language;
            const winId = typeof query.windowId === 'string' && query.windowId.trim() ? query.windowId.trim() : '';
            const effectiveMasked = typeof query.privacyMasked === 'boolean'
                ? query.privacyMasked
                : (winId ? (privacyByWindow.get(winId) ?? true) : true);
            await mods.i18nCore.setLanguageToState(effectiveLang, memState);
            const params = buildDocumentParams(effectiveLang, effectiveMasked);
            const tabs = mods.webviewDocument.buildMonitorTabsPayload(params);
            const outTabs = effectiveMasked ? redactDeep(tabs) : tabs;

            const snapshot = {
                time: nowDate.toISOString().slice(11, 19),
                language: effectiveLang,
                paused,
                privacyMasked: effectiveMasked,
                activeConversationId: params.observation.subjectCascadeId,
                lockedRootId,
                inspectedMemberId,
                lockToMainAgent,
                lockPendingUnavailable,
                retargetOfferId,
                conversations: params.allTrajectories.map((tr) => ({
                    id: tr.cascadeId,
                    title: tr.summary,
                    stepCount: tr.stepCount,
                    isSubagent: tr.cascadeId.startsWith('stage3-worker-'),
                    workspace: effectiveMasked ? '[Redacted Workspace]' : SENTINEL_WORKSPACE,
                    lastModifiedTime: tr.lastModifiedTime,
                })),
                handoffPrompt: params.handoffPreview.markdown,
                tabs: outTabs,
                meta: {
                    isolatedFixture: true,
                    stage: 'stage3',
                    dataRevision,
                    selectionRevision,
                    privacyMasked: effectiveMasked,
                    accountHandle: SENTINEL_HANDLE,
                    viewMode: query.viewMode || 'standalone',
                    swarmMemberCount: params.swarmOverview.totalMemberCount,
                    swarmObservedCount: params.swarmOverview.observedMemberCount,
                    workspaceCount: registeredWorkspaces.length,
                },
            };
            return effectiveMasked ? redactDeep(snapshot) : snapshot;
        },

        async handleAction(action) {
            sideEffects.handleActionCalls += 1;
            switch (action.command) {
                case 'ping':
                    return { ok: true, result: { pong: true, version, isolatedFixture: true, receivedKeys: Object.keys(action).sort() } };
                case 'refresh':
                    dataRevision += 1;
                    return { ok: true, snapshot: await provider.getSnapshot({}) };
                case 'togglePause':
                    paused = !paused;
                    dataRevision += 1;
                    return { ok: true, result: { paused }, messages: [{ command: 'setPaused', paused }] };
                case 'switchLanguage': {
                    const nextLang = action.lang;
                    if (nextLang !== 'en' && nextLang !== 'zh' && nextLang !== 'both') {
                        return { ok: false, statusCode: 400, error: 'Invalid language' };
                    }
                    language = nextLang;
                    appSettings.languagePreference = nextLang;
                    dataRevision += 1;
                    return { ok: true, result: { language }, reload: true };
                }
                case 'setPrivacyMask':
                case 'togglePrivacyMask': {
                    const winId = typeof action.windowId === 'string' && action.windowId.trim() ? action.windowId.trim() : '';
                    const curMasked = winId ? (privacyByWindow.get(winId) ?? true) : privacyMasked;
                    const nextMasked = typeof action.masked === 'boolean' ? action.masked : !curMasked;
                    if (winId) {
                        privacyByWindow.set(winId, nextMasked);
                    } else {
                        privacyMasked = nextMasked;
                    }
                    dataRevision += 1;
                    const outMasked = winId ? nextMasked : true;
                    return {
                        ok: true,
                        result: { command: 'privacyMaskState', masked: outMasked, privacyMasked: outMasked },
                        messages: [{ command: 'privacyMaskState', masked: outMasked, privacyMasked: outMasked }],
                        snapshot: await provider.getSnapshot({ windowId: winId || undefined }),
                    };
                }
                case 'inspectMember': {
                    const target = typeof action.cascadeId === 'string' ? action.cascadeId.trim() : '';
                    if (!target) { return { ok: false, statusCode: 400, error: 'Missing cascadeId' }; }
                    inspectedMemberId = target;
                    selectionRevision += 1;
                    dataRevision += 1;
                    // CRITICAL D9 INVARIANT: Inspecting a worker NEVER overwrites lockedRootId!
                    return {
                        ok: true,
                        result: { inspectedMemberId, lockedRootId, selectionRevision },
                        snapshot: await provider.getSnapshot({}),
                    };
                }
                case 'clearInspect': {
                    inspectedMemberId = null;
                    selectionRevision += 1;
                    dataRevision += 1;
                    return {
                        ok: true,
                        result: { inspectedMemberId: null, lockedRootId, selectionRevision },
                        snapshot: await provider.getSnapshot({}),
                    };
                }
                case 'retargetLockedRoot': {
                    const target = typeof action.cascadeId === 'string' ? action.cascadeId.trim() : '';
                    if (!target) { return { ok: false, statusCode: 400, error: 'Missing cascadeId' }; }
                    lockedRootId = target;
                    inspectedMemberId = null;
                    lockPendingUnavailable = false;
                    retargetOfferId = null;
                    selectionRevision += 1;
                    dataRevision += 1;
                    return {
                        ok: true,
                        result: { lockedRootId, inspectedMemberId: null, retargetOfferId: null },
                        snapshot: await provider.getSnapshot({}),
                    };
                }
                case 'toggleLockMain':
                case 'toggleLockToMainAgent':
                case 'setLockToMainAgent': {
                    lockToMainAgent = typeof action.locked === 'boolean' ? action.locked : !lockToMainAgent;
                    appSettings.lockToMainAgent = lockToMainAgent;
                    selectionRevision += 1;
                    dataRevision += 1;
                    return { ok: true, result: { lockToMainAgent, lockedRootId }, snapshot: await provider.getSnapshot({}) };
                }
                case 'previewHandoffV2': {
                    await mods.i18nCore.setLanguageToState(language, memState);
                    const params = buildDocumentParams(language, privacyMasked);
                    return {
                        ok: true,
                        result: {
                            subjectCascadeId: params.handoffPreview.subjectCascadeId,
                            dataRevision: params.handoffPreview.dataRevision,
                            markdown: params.handoffPreview.markdown,
                            privacyMasked,
                        },
                        messages: [{
                            command: 'handoffV2PreviewResult',
                            subjectCascadeId: params.handoffPreview.subjectCascadeId,
                            dataRevision: params.handoffPreview.dataRevision,
                            markdown: params.handoffPreview.markdown,
                        }],
                    };
                }
                case 'dismissRecoveryBrief': {
                    recoveryBriefDismissed = true;
                    dataRevision += 1;
                    return { ok: true, result: { dismissed: true } };
                }
                case 'setAppSetting':
                case 'setOverviewSetting': {
                    const key = typeof action.key === 'string' ? action.key : '';
                    if (!key || !(key in appSettings)) {
                        return { ok: false, statusCode: 400, error: `Unsupported setting key: ${key}` };
                    }
                    appSettings[key] = action.value;
                    dataRevision += 1;
                    return { ok: true, result: { key, value: action.value, committed: true }, snapshot: await provider.getSnapshot({}) };
                }
                case 'exportSettingsBackup': {
                    const backup = {
                        schemaVersion: 1,
                        exportedAt: createdAt,
                        settings: {
                            languagePreference: appSettings.languagePreference,
                            displayCurrency: appSettings.displayCurrency,
                            contextPctBasis: appSettings.contextPctBasis,
                            speedMetricMode: appSettings.speedMetricMode,
                            quotaWindowMode: appSettings.quotaWindowMode,
                            quotaDirectionMode: appSettings.quotaDirectionMode,
                            appShowNativeHudBar: appSettings.appShowNativeHudBar,
                            ideShowNativeHudBar: appSettings.ideShowNativeHudBar,
                            nativeHudAutoHideOnOverview: appSettings.nativeHudAutoHideOnOverview,
                        },
                    };
                    return {
                        ok: true,
                        filename: 'antigravity-settings-backup.json',
                        mimeType: 'application/json',
                        content: JSON.stringify(backup, null, 2),
                    };
                }
                case 'importSettingsBackup': {
                    try {
                        const parsed = typeof action.json === 'string' ? JSON.parse(action.json) : action.json;
                        if (!parsed || parsed.schemaVersion !== 1) {
                            return { ok: false, statusCode: 400, error: 'Unsupported backup schema' };
                        }
                        return { ok: true, result: { ok: true, imported: true } };
                    } catch {
                        return { ok: false, statusCode: 400, error: 'Invalid backup JSON' };
                    }
                }
                case 'exportRedactedDiagnostics': {
                    const diag = {
                        schemaVersion: 1,
                        generatedAt: createdAt,
                        version,
                        surface: 'app-sidecar',
                        isolatedFixture: true,
                        privacyMasked: true,
                        accountHandle: SENTINEL_HANDLE,
                        observation: mods.contextDisplay.formatObservationDiagnostic
                            ? mods.contextDisplay.formatObservationDiagnostic(
                                buildCurrentObservation(),
                                new mods.contextDisplay.DiagnosticAliasMap(),
                            )
                            : { dataRevision, selectionRevision },
                    };
                    return {
                        ok: true,
                        filename: 'antigravity-redacted-diagnostics.json',
                        mimeType: 'application/json',
                        content: redactSentinelText(JSON.stringify(diag, null, 2)),
                    };
                }
                case 'calendarExportMarkdown':
                case 'calendarExportCsv':
                case 'calendarExportJson': {
                    const ds = new mods.dailyStore.DailyStore();
                    ds.restoreSnapshot(privacyMasked ? redactDeep(rawDailyStoreSnap) : rawDailyStoreSnap);
                    const bundle = mods.webviewCalendarTab.buildCalendarExportData(ds, 2026, 11, {
                        currency: appSettings.displayCurrency,
                        selectedDates: Array.isArray(action.selectedDates) ? action.selectedDates : undefined,
                        now: nowDate,
                    });
                    if (action.command === 'calendarExportMarkdown') {
                        return { ok: true, filename: 'usage.md', mimeType: 'text/markdown', content: bundle.markdown };
                    }
                    if (action.command === 'calendarExportCsv') {
                        return { ok: true, filename: 'usage.csv', mimeType: 'text/csv', content: bundle.csv };
                    }
                    return { ok: true, filename: 'usage.json', mimeType: 'application/json', content: bundle.json };
                }
                case 'syncHostFocus': {
                    const rev = typeof action.focusRevision === 'number' ? action.focusRevision : 0;
                    if (rev >= ackFocusRevision) {
                        ackFocusRevision = rev;
                        dataRevision += 1;
                    }
                    return { ok: true, result: { accepted: true, ackFocusRevision, backendEpoch: 1 } };
                }
                case 'registerWorkspaces': {
                    registeredWorkspaces = Array.isArray(action.workspaceUris) ? [...action.workspaceUris] : [];
                    dataRevision += 1;
                    return { ok: true, result: { workspaceUris: [...registeredWorkspaces] } };
                }
                default:
                    return { ok: false, statusCode: 400, error: `Unknown fixture action: ${action.command}` };
            }
        },
        dispose() {
            // Pure in-memory fixture; nothing external to tear down
        },
    };

    return provider;
}

// ─── Standalone Server Starter (Mode-0600 Pairing File, Zero Secret Stdout) ──

function createBootstrapPairing() {
    const code = randomBytes(32).toString('hex');
    const nowMs = Date.now();
    return {
        mode: 'one-time-exchange',
        code,
        codeSha256: createHash('sha256').update(code, 'utf8').digest('hex'),
        singleUse: true,
        ttlMs: 120_000,
        expiresAtMs: nowMs + 120_000,
        exchangeEndpoint: '/api/auth/pair',
        deliveryChannel: 'private-file',
    };
}

export async function startStage3FixtureServer(options = {}) {
    const env = createStage3TempEnvironment();
    const mods = resolveCompiledModules(env.rootDir);
    const provider = await createStage3FixtureProvider(mods, env, {
        clockIso: options.clockIso || DEFAULT_CLOCK_ISO,
        initialLang: options.lang || 'both',
    });

    const pairingFile = options.pairingFile
        ? resolve(options.pairingFile)
        : join(env.rootDir, 'pairing-code.json');
    const bootstrapPairing = createBootstrapPairing();
    const pairingCodeRaw = bootstrapPairing.code;

    let wrotePairingFile = false;
    const removePairingFileOnce = () => {
        if (!wrotePairingFile) { return; }
        wrotePairingFile = false;
        try { rmSync(pairingFile, { force: true }); } catch { /* ignore */ }
    };

    const startServer = mods.sidecarServer.startStandaloneServer || mods.sidecarServer.startSidecarServer;
    assert.equal(typeof startServer, 'function', 'sidecar-server exports startStandaloneServer');

    const handle = await startServer(provider, {
        host: '127.0.0.1',
        port: typeof options.port === 'number' ? options.port : 0,
        version: provider.version,
        standaloneAuth: {
            requirePairing: true,
            unpairedShellOnly: true,
            bootstrapPairing,
            onPairingConsumed: removePairingFileOnce,
        },
    });

    try {
        writePrivatePairingFile(pairingFile, {
            url: handle.url,
            port: handle.port,
            pairingCode: pairingCodeRaw,
            exchangeEndpoint: '/api/auth/pair',
            singleUse: true,
            expiresAtMs: bootstrapPairing.expiresAtMs,
        });
    } catch (error) {
        await handle.close();
        env.cleanup();
        throw error;
    }
    wrotePairingFile = true;

    return {
        env,
        mods,
        provider,
        handle,
        pairingFile,
        async close() {
            removePairingFileOnce();
            await handle.close();
            env.cleanup();
        },
    };
}

// ─── Raw HTTP Client Helper ──────────────────────────────────────────────────

function rawHttpRequest(baseUrl, method, reqPath, options = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
        const url = new URL(reqPath, baseUrl);
        const body = options.body;
        const headers = { ...(options.headers || {}) };
        if (options.overrideHostHeader !== undefined) {
            headers.Host = options.overrideHostHeader;
        }
        if (body !== undefined && !headers['Content-Length'] && !headers['content-length']) {
            headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'));
        }
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers,
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const text = buffer.toString('utf8');
                resolvePromise({
                    status: res.statusCode || 0,
                    headers: res.headers,
                    buffer,
                    text,
                    json: () => JSON.parse(text),
                });
            });
        });
        req.on('error', rejectPromise);
        if (body !== undefined) { req.write(body); }
        req.end();
    });
}

function assertZeroSentinelLeak(content, label) {
    const lower = String(content || '').toLowerCase();
    for (const token of SENTINEL_LEAK_TOKENS) {
        assert.ok(
            !lower.includes(token.toLowerCase()),
            `[SEC-04 SENTINEL LEAK] Found forbidden sentinel token "${token}" in ${label}`,
        );
    }
}

// ─── Automated Stage 3 HTTP Security + Privacy + 5-Tab/Swarm/Plan-C Checks ───

export async function runStage3SecurityVerification(options = {}) {
    const server = await startStage3FixtureServer({
        port: 0,
        clockIso: options.clockIso || DEFAULT_CLOCK_ISO,
        lang: 'both',
    });

    const checks = [];
    const check = async (id, label, fn) => {
        const start = Date.now();
        await fn();
        checks.push({ id, label, ok: true, ms: Date.now() - start });
    };

    try {
        const { handle, provider, pairingFile, env } = server;
        const pairingData = JSON.parse(readFileSync(pairingFile, 'utf8'));
        const pairingCode = pairingData.pairingCode;

        // 1. Mode-0600 private pairing file & strict temp dir isolation
        await check('SEC-FILE', 'Mode-0600 private pairing file inside isolated temp dir', async () => {
            assertStrictlyInsideTmpdir(env.rootDir, 'Stage 3 temp root');
            assert.match(pairingCode, /^[a-f0-9]{64}$/, '256-bit hex one-time pairing code');
            if (process.platform !== 'win32') {
                const mode = statSync(pairingFile).mode & 0o777;
                assert.equal(mode, 0o600, `Pairing file must be mode 0600 (got 0o${mode.toString(8)})`);
            }
        });

        // 2. Unpaired GET / and GET /full return ONLY inert pairing shell (zero provider data or tokens)
        await check('SEC-SHELL', 'Unpaired GET / & /full serve inert shell with zero sentinel/token leaks', async () => {
            for (const route of ['/', '/full']) {
                const res = await rawHttpRequest(handle.url, 'GET', route);
                assert.equal(res.status, 200, `unpaired GET ${route} returns 200`);
                assert.ok(String(res.headers['content-type']).includes('text/html'));
                assert.equal(res.headers['x-frame-options'], 'DENY');
                assert.ok(res.text.includes('data-acm-paired="false"'));
                assert.ok(res.text.includes('acmPairingForm'));
                assert.ok(!res.text.includes(pairingCode), 'unpaired shell never leaks pairing code');
                assert.ok(!res.text.includes(handle.overlayBridgeToken), 'unpaired shell never leaks overlay token');
                assertZeroSentinelLeak(res.text, `unpaired GET ${route}`);
            }
            assert.equal(provider.getSideEffects().renderHtmlCalls, 0, 'unpaired shell NEVER invokes provider.renderHtml');
        });

        // 3. Unauthenticated /api/snapshot & /api/action return 401 (incl. ?includeHtml=1, ?token=, overlay token)
        await check('SEC-401', 'Unauthenticated /api/snapshot & /api/action return 401', async () => {
            assert.equal((await rawHttpRequest(handle.url, 'GET', '/api/snapshot')).status, 401);
            assert.equal((await rawHttpRequest(handle.url, 'GET', '/api/snapshot?includeHtml=1')).status, 401);
            assert.equal((await rawHttpRequest(handle.url, 'GET', `/api/snapshot?token=${pairingCode}`)).status, 401);
            assert.equal((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url },
                body: JSON.stringify({ command: 'ping' }),
            })).status, 401);
            // CDP overlay token MUST NOT authenticate standalone snapshot/action endpoints
            assert.equal((await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { Authorization: `Bearer ${handle.overlayBridgeToken}`, 'X-Monitor-Token': handle.overlayBridgeToken },
            })).status, 401);
            assert.equal(provider.getSideEffects().getSnapshotCalls, 0, 'unauthenticated snapshot never invokes provider');
            assert.equal(provider.getSideEffects().handleActionCalls, 0, 'unauthenticated action never invokes provider');
        });

        // 4. One-time pairing exchange, origin-bound browser session, immediate code burn & pairing file cleanup
        let sessionToken = '';
        await check('SEC-PAIR-BURN', 'One-time pairing exchange burns code immediately & deletes pairing file', async () => {
            const wrong = await rawHttpRequest(handle.url, 'POST', '/api/auth/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url },
                body: JSON.stringify({ pairingCode: '0'.repeat(64) }),
            });
            assert.equal(wrong.status, 401, 'wrong pairing code returns 401');
            assert.equal(existsSync(pairingFile), true, 'pairing file survives single wrong attempt');

            const pairRes = await rawHttpRequest(handle.url, 'POST', '/api/auth/pair', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url },
                body: JSON.stringify({ pairingCode }),
            });
            assert.equal(pairRes.status, 200, 'valid pairing code returns 200');
            const parsed = pairRes.json();
            assert.equal(parsed.ok, true);
            assert.equal(parsed.paired, true);
            sessionToken = parsed.sessionToken;
            assert.match(sessionToken, /^[a-f0-9]{64}$/);
            assert.equal(pairRes.headers['set-cookie'], undefined);

            // Pairing file MUST be deleted immediately on burn
            assert.equal(existsSync(pairingFile), false, 'pairing file deleted immediately upon burn');

            // Replaying burned code to /api/auth/pair and /api/pair MUST return 401
            for (const ep of ['/api/auth/pair', '/api/pair']) {
                const replay = await rawHttpRequest(handle.url, 'POST', ep, {
                    headers: { 'Content-Type': 'application/json', Origin: handle.url },
                    body: JSON.stringify({ pairingCode }),
                });
                assert.equal(replay.status, 401, `burned pairing code replay to ${ep} returns 401`);
            }
        });

        // 5. Cross-origin / unknown-origin / DNS-rebinding / SDK-only writes return 403
        await check('SEC-403', 'Cross-origin, null-origin, missing-origin browser write, DNS-rebinding & SDK-only commands return 403', async () => {
            const authHeaders = { 'Content-Type': 'application/json', 'X-Monitor-Session': sessionToken };
            assert.equal((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { ...authHeaders, Origin: 'https://evil.example' },
                body: JSON.stringify({ command: 'ping' }),
            })).status, 403, 'cross-origin write -> 403');
            assert.equal((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { ...authHeaders, Origin: 'http://127.0.0.1:9999' },
                body: JSON.stringify({ command: 'ping' }),
            })).status, 403, 'cross-port loopback origin write -> 403');
            assert.equal((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { ...authHeaders, Origin: 'null' },
                body: JSON.stringify({ command: 'ping' }),
            })).status, 403, 'null origin write -> 403');
            assert.equal((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: authHeaders,
                body: JSON.stringify({ command: 'ping' }),
            })).status, 403, 'browser session write without Origin -> 403');
            assert.equal((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { ...authHeaders, Origin: handle.url, 'Sec-Fetch-Site': 'cross-site' },
                body: JSON.stringify({ command: 'ping' }),
            })).status, 403, 'Sec-Fetch-Site: cross-site write -> 403');
            assert.equal((await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { 'X-Monitor-Session': sessionToken, 'Sec-Fetch-Site': 'same-site' },
            })).status, 403, 'Sec-Fetch-Site: same-site cross-port read -> 403');
            assert.equal((await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { 'X-Monitor-Session': sessionToken },
                overrideHostHeader: `evil.example:${handle.port}`,
            })).status, 403, 'DNS-rebinding Host header -> 403');
            // SDK-only privileged commands rejected in standalone scope
            for (const sdkCmd of ['applyPluginUpdate', 'revealPath', 'openStateFile']) {
                assert.equal((await rawHttpRequest(handle.url, 'POST', '/api/action', {
                    headers: { ...authHeaders, Origin: handle.url },
                    body: JSON.stringify({ command: sdkCmd }),
                })).status, 403, `SDK-only command ${sdkCmd} rejected in standalone scope -> 403`);
            }
        });

        // 6. 415 Unsupported Media Type on text/plain & form POST
        await check('SEC-415', 'POST /api/action with text/plain or form content-type returns 415', async () => {
            for (const ct of ['text/plain', 'text/plain; charset=utf-8', 'application/x-www-form-urlencoded']) {
                const res = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                    headers: { 'Content-Type': ct, Origin: handle.url, 'X-Monitor-Session': sessionToken },
                    body: JSON.stringify({ command: 'ping' }),
                });
                assert.equal(res.status, 415, `Content-Type: ${ct} -> 415`);
            }
        });

        // 7. GET strictly read-only (no focus or workspace mutation side effects) + ping strips side-effect fields
        await check('SEC-GET-RO', 'GET / and /api/snapshot are strictly read-only; generic POST strips focus/workspace fields', async () => {
            const beforeState = provider.getFixtureState();
            const snapRes = await rawHttpRequest(
                handle.url,
                'GET',
                '/api/snapshot?conversationId=hijack-conv&workspaceUris=file:///etc/passwd&lockToMainAgent=false',
                { headers: { 'X-Monitor-Session': sessionToken } },
            );
            assert.equal(snapRes.status, 200);
            const pageRes = await rawHttpRequest(
                handle.url,
                'GET',
                '/?conversationId=hijack-conv&workspaceUris=file:///etc/passwd',
                { headers: { 'X-Monitor-Session': sessionToken } },
            );
            assert.equal(pageRes.status, 200);
            assert.deepEqual(provider.getFixtureState(), beforeState, 'GET requests caused ZERO state mutation');

            const pingRes = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url, 'X-Monitor-Session': sessionToken },
                body: JSON.stringify({
                    command: 'ping',
                    conversationId: 'hijack-conv',
                    workspaceUris: ['file:///etc/passwd'],
                    focusRevision: 999,
                }),
            });
            assert.equal(pingRes.status, 200);
            const pingKeys = pingRes.json().result.receivedKeys;
            assert.ok(!pingKeys.includes('conversationId'), 'ping stripped unauthorized conversationId');
            assert.ok(!pingKeys.includes('workspaceUris'), 'ping stripped unauthorized workspaceUris');
            assert.ok(!pingKeys.includes('focusRevision'), 'ping stripped unauthorized focusRevision');
        });

        // 8. Bodyless HTTP 304 ETag caching & validator sensitivity (privacy/lang/viewMode/includeHtml)
        await check('HTTP-304', 'Bodyless HTTP 304 on matching If-None-Match & distinct validators on view/lang/privacy change', async () => {
            const first = await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { Authorization: `Bearer ${sessionToken}` },
            });
            assert.equal(first.status, 200);
            const etag = String(first.headers.etag || '');
            assert.match(etag, /^"[a-f0-9]{32}"$/);

            const notMod = await rawHttpRequest(handle.url, 'GET', '/api/snapshot', {
                headers: { Authorization: `Bearer ${sessionToken}`, 'If-None-Match': etag },
            });
            assert.equal(notMod.status, 304, 'Matching If-None-Match returns HTTP 304');
            assert.equal(notMod.buffer.length, 0, 'HTTP 304 MUST be strictly bodyless');

            // Different viewMode / lang / includeHtml MUST NOT reuse stale ETag
            for (const q of ['?viewMode=sidebar', '?lang=zh', '?includeHtml=1']) {
                const diffRes = await rawHttpRequest(handle.url, 'GET', `/api/snapshot${q}`, {
                    headers: { Authorization: `Bearer ${sessionToken}`, 'If-None-Match': etag },
                });
                assert.equal(diffRes.status, 200, `/api/snapshot${q} returns fresh 200 (never false 304)`);
                assert.notEqual(diffRes.headers.etag, etag, `/api/snapshot${q} computes distinct validator ETag`);
            }
        });

        // 9. Sentinel zero-leak check across masked HTML, JSON, Handoff v2, Settings Backup & Redacted Diagnostics
        await check('SEC-SENTINEL', 'Zero sentinel PII leaks across masked HTML, JSON, Handoff v2, backup & diagnostics + reveal/re-mask parity', async () => {
            const maskedPage = await rawHttpRequest(handle.url, 'GET', '/', { headers: { 'X-Monitor-Session': sessionToken } });
            assert.equal(maskedPage.status, 200);
            assertZeroSentinelLeak(maskedPage.text, 'masked GET /');
            assert.ok(maskedPage.text.includes(SENTINEL_HANDLE), 'masked HTML uses opaque account handle');

            const maskedFull = await rawHttpRequest(handle.url, 'GET', '/full', { headers: { 'X-Monitor-Session': sessionToken } });
            assert.equal(maskedFull.status, 200);
            assertZeroSentinelLeak(maskedFull.text, 'masked GET /full');

            const maskedSnap = await rawHttpRequest(handle.url, 'GET', '/api/snapshot?includeHtml=1', {
                headers: { Authorization: `Bearer ${sessionToken}` },
            });
            assert.equal(maskedSnap.status, 200);
            const maskedEtag = maskedSnap.headers.etag;
            assertZeroSentinelLeak(maskedSnap.text, 'masked GET /api/snapshot?includeHtml=1');

            for (const cmd of ['previewHandoffV2', 'exportSettingsBackup', 'exportRedactedDiagnostics']) {
                const act = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                    headers: { 'Content-Type': 'application/json', Origin: handle.url, 'X-Monitor-Session': sessionToken },
                    body: JSON.stringify({ command: cmd }),
                });
                assert.equal(act.status, 200, `${cmd} succeeds`);
                assertZeroSentinelLeak(act.text, `masked POST /api/action (${cmd})`);
            }

            // Per-window unmask reveals sentinel identity ONLY for that windowId while GET / without windowId stays fail-closed masked
            const maskedWin1 = await rawHttpRequest(handle.url, 'GET', '/api/snapshot?includeHtml=1&windowId=win-1', {
                headers: { Authorization: `Bearer ${sessionToken}` },
            });
            assert.equal(maskedWin1.status, 200);
            const maskedWin1Etag = maskedWin1.headers.etag;
            assertZeroSentinelLeak(maskedWin1.text, 'initial masked win-1 snapshot');

            const unmaskRes = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url, 'X-Monitor-Session': sessionToken },
                body: JSON.stringify({ command: 'setPrivacyMask', masked: false, windowId: 'win-1' }),
            });
            assert.equal(unmaskRes.status, 200);

            const pageWithoutWinId = await rawHttpRequest(handle.url, 'GET', '/', { headers: { 'X-Monitor-Session': sessionToken } });
            assert.equal(pageWithoutWinId.status, 200);
            assertZeroSentinelLeak(pageWithoutWinId.text, 'GET / without windowId stays fail-closed masked even after win-1 unmasks');

            const unmaskedWin1 = await rawHttpRequest(handle.url, 'GET', '/api/snapshot?includeHtml=1&windowId=win-1', {
                headers: { Authorization: `Bearer ${sessionToken}`, 'If-None-Match': String(maskedWin1Etag) },
            });
            assert.equal(unmaskedWin1.status, 200, 'privacy mask toggle busts ETag (never false 304)');
            assert.ok(unmaskedWin1.text.includes(SENTINEL_EMAIL), 'explicit per-window unmask reveals sentinel email for win-1');

            const maskedWin2 = await rawHttpRequest(handle.url, 'GET', '/api/snapshot?includeHtml=1&windowId=win-2', {
                headers: { Authorization: `Bearer ${sessionToken}` },
            });
            assert.equal(maskedWin2.status, 200);
            assertZeroSentinelLeak(maskedWin2.text, 'other windowId (win-2) stays fail-closed masked');

            const remaskRes = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url, 'X-Monitor-Session': sessionToken },
                body: JSON.stringify({ command: 'setPrivacyMask', masked: true, windowId: 'win-1' }),
            });
            assert.equal(remaskRes.status, 200);
            const remaskedWin1 = await rawHttpRequest(handle.url, 'GET', '/api/snapshot?includeHtml=1&windowId=win-1', {
                headers: { Authorization: `Bearer ${sessionToken}`, 'If-None-Match': String(unmaskedWin1.headers.etag) },
            });
            assert.equal(remaskedWin1.status, 200, 're-mask busts ETag');
            assertZeroSentinelLeak(remaskedWin1.text, 're-masked win-1 snapshot');
        });

        // 10. Full v1.18.0 5-Tab IA + Topbar ⚙️/ⓘ + Swarm (22 members + Inspect/Back/Retarget/Pending) + Plan C Fixtures
        await check('V118-FIXTURES', '5-tab IA, topbar ⚙️/ⓘ, Swarm 22-member controls & all Plan C features verified in authenticated HTML & actions', async () => {
            const page = await rawHttpRequest(handle.url, 'GET', '/full', { headers: { 'X-Monitor-Session': sessionToken } });
            assert.equal(page.status, 200);
            const html = page.text;

            // 6 main tabs strictly inside [role="tablist"] + ⓘ outside
            const tablistMatch = html.match(/<nav[^>]*role="tablist"[^>]*>([\s\S]*?)<\/nav>/);
            assert.ok(tablistMatch, 'renders [role="tablist"]');
            const tabIds = [...tablistMatch[1].matchAll(/data-tab="([^"]+)"/g)].map((m) => m[1]);
            assert.deepEqual(tabIds, ['overview', 'gm', 'sessions', 'calendar', 'models', 'settings']);
            assert.ok(!html.includes('id="topbarSettingsBtn"'), 'no duplicate topbar settings button');
            assert.ok(html.includes('id="topbarAboutBtn"') && html.includes('data-utility-view="about"'));

            // Swarm Coordinator + 21 workers (22 total) + Inspect / Back to Main / Retarget / Pending-Unavailable
            assert.ok(html.includes('id="overviewSwarmStrip"'));
            assert.ok(html.includes('data-swarm-partial-coverage="true"'));
            assert.ok(html.includes('(18/22)'));
            assert.ok(html.includes('data-inspect-banner="true"') && html.includes('data-action="clearInspect"'));
            assert.ok(html.includes('data-lock-pending="true"'));
            assert.ok(html.includes('data-retarget-banner="true"') && html.includes('data-action="retargetLockedRoot"'));
            assert.ok(html.includes('id="sessionsSwarmTree"') && html.includes('data-swarm-depth="2"'));

            // Plan C features
            assert.ok(html.includes('data-cache-ttl-state="cooling"') && html.includes('data-cache-ttl-source="local_ttl_heuristic"'));
            assert.ok(html.includes('data-cache-miss-causes="true"') && html.includes('data-cause-confidence="possible_cause"'));
            assert.ok(html.includes('data-setting-switch="speedMetricMode"') && html.includes('data-phase-source="measured_only"'));
            assert.ok(!/phase-seg-(?:thinking|tool)/.test(html), 'NEVER synthesizes thinking/tool phase bars');
            assert.ok(html.includes('data-gm-anomaly-bar="true"'));
            assert.ok(html.includes('id="modelsWeeklyPaceCard"') && html.includes('data-weekly-status="insufficient_history"'));
            assert.ok(html.includes('data-zero-day="true"'));
            assert.ok(html.includes('id="calWorkspaceLeaderboard"') && html.includes('data-workspace-unattributed="true"'));
            assert.ok(html.includes('id="calSwarmGroupCost"'));
            assert.ok(/<details class="cal-roi-advanced" id="calPlanRoiAdvanced" data-cal-roi-advanced="true"[^>]*>/.test(html));
            assert.ok(!/<details class="cal-roi-advanced" id="calPlanRoiAdvanced"[^>]*\bopen\b/.test(html), 'Plan ROI details starts collapsed');
            assert.ok(html.includes('API Equivalent Reference Ratio, Not Actual Bill'));
            assert.ok(html.includes('id="handoffV2PreviewBox"') && html.includes('readonly'));
            assert.ok(html.includes('id="compactionRecoveryBrief"') && html.includes('data-read-only="true"'));

            // Settings 6 logical groups (Overlays & CDP at top on App Sidecar + Global Rules) + backup/diagnostics + CAD
            const groups = [...html.matchAll(/data-settings-group="([^"]+)"/g)].map((m) => m[1]);
            assert.deepEqual(groups, [
                'version-updates',
                'overlays-cdp',
                'display-language',
                'telemetry-metrics',
                'currency-pricing',
                'global-rules',
                'data-backup-diagnostics',
            ]);
            assert.ok(html.includes('data-action="exportSettingsBackup"') && html.includes('data-action="exportRedactedDiagnostics"'));
            assert.ok(html.includes('value="CAD"'));

            // Glossary & objective compliance wording
            assert.ok(!FORBIDDEN_COMPLIANCE_RE.test(html), 'zero forbidden 100% ToS-safe claims');
            assert.ok(!FORBIDDEN_CHINESE_GLOSSARY_RE.test(html), 'zero forbidden Chinese glossary terms');

            // Interactive Swarm state machine transitions via POST /api/action
            const inspectRes = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url, 'X-Monitor-Session': sessionToken },
                body: JSON.stringify({ command: 'inspectMember', cascadeId: 'stage3-worker-5' }),
            });
            assert.equal(inspectRes.status, 200);
            assert.equal(inspectRes.json().result.inspectedMemberId, 'stage3-worker-5');
            assert.equal(inspectRes.json().result.lockedRootId, env.coordId, 'inspectMember preserves lockedRootId');

            const backRes = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url, 'X-Monitor-Session': sessionToken },
                body: JSON.stringify({ command: 'clearInspect' }),
            });
            assert.equal(backRes.status, 200);
            assert.equal(backRes.json().result.inspectedMemberId, null);
            assert.equal(backRes.json().result.lockedRootId, env.coordId, 'clearInspect restores main root lock');

            const retargetRes = await rawHttpRequest(handle.url, 'POST', '/api/action', {
                headers: { 'Content-Type': 'application/json', Origin: handle.url, 'X-Monitor-Session': sessionToken },
                body: JSON.stringify({ command: 'retargetLockedRoot', cascadeId: 'stage3-new-main-99' }),
            });
            assert.equal(retargetRes.status, 200);
            assert.equal(retargetRes.json().result.lockedRootId, 'stage3-new-main-99');
            assert.equal(retargetRes.json().result.retargetOfferId, null);
        });

        // 11. Zero real LS polling, zero real CDP probing, zero external GitHub calls
        await check('ISO-ZERO-EXTERNAL', 'Zero real LS polling, zero CDP probing, zero external GitHub fetches', async () => {
            const fx = provider.getSideEffects();
            assert.equal(fx.lsPolls, 0);
            assert.equal(fx.cdpProbes, 0);
            assert.equal(fx.externalFetches, 0);
        });
    } finally {
        await server.close();
    }

    return {
        ok: true,
        mode: 'stage3-verify-security',
        passed: checks.length,
        total: checks.length,
        checks,
    };
}

// ─── Optional Headless `agent-browser` Stage 3 Matrix Runner ─────────────────

function runAgentBrowserJson(session, argv, input) {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn('agent-browser', ['--session', session, ...argv, '--json'], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
            if (settled) { return; }
            settled = true;
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
            rejectPromise(new Error(`agent-browser ${argv[0]} timed out after 35000ms`));
        }, 35_000);

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });

        child.on('error', (err) => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            rejectPromise(err);
        });

        child.on('close', (code) => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            if (code !== 0) {
                rejectPromise(new Error(`agent-browser ${argv[0]} exited ${code}: ${(stderr || stdout).trim()}`));
                return;
            }
            try {
                const parsed = JSON.parse(stdout);
                assert.ok(parsed.success, `agent-browser ${argv[0]} failed: ${parsed.error || 'unknown'}`);
                resolvePromise(parsed.data);
            } catch (err) {
                rejectPromise(new Error(`agent-browser ${argv[0]} invalid JSON (${err instanceof Error ? err.message : String(err)}): ${stdout.slice(0, 400)}`));
            }
        });

        if (typeof input === 'string') {
            child.stdin.end(input, 'utf8');
        } else {
            child.stdin.end();
        }
    });
}

export async function runStage3BrowserMatrix(options = {}) {
    const securityReport = await runStage3SecurityVerification(options);
    const server = await startStage3FixtureServer({
        port: 0,
        clockIso: options.clockIso || DEFAULT_CLOCK_ISO,
        lang: 'both',
    });
    const session = `stage3-standalone-matrix-${process.pid}`;
    const browserChecks = [];

    try {
        const pairingData = JSON.parse(readFileSync(server.pairingFile, 'utf8'));
        const ab = (argv, input) => runAgentBrowserJson(session, argv, input);
        const evalJs = async (js) => (await ab(['eval', '--stdin'], js)).result;

        // 1. Open unpaired URL -> pair via real pairing form
        await ab(['set', 'viewport', '1280', '860']);
        await ab(['open', server.handle.url]);
        assert.equal(await evalJs("document.body.getAttribute('data-acm-paired')"), 'false', 'browser sees unpaired shell first');
        await ab(['fill', '#acmPairingCodeInput', pairingData.pairingCode]);
        await ab(['click', '#acmPairingSubmit']);
        await ab(['wait', '--fn', "Boolean(document.querySelector('#tabBar .tab-btn[data-tab=\"overview\"]'))"]);
        assert.equal(existsSync(server.pairingFile), false, 'browser pairing burned and deleted pairing file');
        browserChecks.push({ check: 'browser-pairing-flow', ok: true });
        // Fresh navigations bootstrap the dashboard again using only this
        // origin's tab storage. No ambient credential is needed.
        await ab(['open', server.handle.url + '/full']);
        await ab(['wait', '--fn', "Boolean(document.querySelector('#tabBar .tab-btn[data-tab=overview]'))"]);
        assert.equal(await evalJs("document.body.getAttribute('data-acm-view')"), 'sidebar');
        await ab(['reload']);
        await ab(['wait', '--fn', "Boolean(document.querySelector('#tabBar .tab-btn[data-tab=overview]'))"]);
        browserChecks.push({ check: 'authenticated-sidebar-navigation-and-reload', ok: true });


        // 2. Viewport matrix (320x760, 420x800, 479/480/481 compact breakpoint, 960x800, 1280x860)
        const viewports = options.smoke
            ? [[320, 760], [479, 800], [480, 800], [481, 800], [1280, 860]]
            : [[320, 760], [420, 800], [479, 800], [480, 800], [481, 800], [960, 800], [1280, 860]];

        if (!options.smoke) {
            // Navigate to real localized documents. A body attribute alone does not
            // reproduce translated labels, accessible names or host-rendered markup.
            for (const lang of ['en', 'zh', 'both']) {
                await ab(['open', server.handle.url + '/full?lang=' + lang]);
                await ab(['wait', '--fn', `document.body.dataset.lang === ${JSON.stringify(lang)} && Boolean(window.__ACM_WEBVIEW_CLIENT__)`]);
                for (const [width, height] of viewports) {
                    await ab(['set', 'viewport', String(width), String(height)]);
                    const combinations = await evalJs(`(async () => {
                        await document.fonts.ready;
                        const result = [];
                        const palettes = new Set();
                        const buttons = [...document.querySelectorAll('#tabBar [role="tab"]')];
                        const controls = [...buttons, ...document.querySelectorAll('[data-utility-view]')];
                        for (const theme of ['dark', 'light', 'hc', 'hc-light']) {
                            document.body.dataset.acmTheme = theme;
                            const style = getComputedStyle(document.body);
                            palettes.add([style.getPropertyValue('--ed-bg'), style.getPropertyValue('--ctx-cat-system')].join('/'));
                            for (const zoom of [80, 100, 125, 150]) {
                                document.body.style.zoom = String(zoom / 100);
                                window.dispatchEvent(new Event('resize'));
                                const key = [innerWidth, innerHeight, document.body.dataset.lang, theme, zoom].join('/');
                                const fail = (why) => { throw new Error(key + ': ' + why); };
                                if (buttons.length !== 6) fail('six-tab navigation missing');
                                if (innerWidth !== ${width} || innerHeight !== ${height} || Number(getComputedStyle(document.body).zoom) !== zoom / 100) fail('viewport or zoom not applied');
                                const compact = document.body.dataset.lang === 'both' && innerWidth / (zoom / 100) <= 480;
                                if (document.body.dataset.compactLang !== String(compact)) fail('compact language');
                                const visibleLanguage = compact ? document.body.dataset.primaryLang : document.body.dataset.lang;
                                if (document.body.dataset.viewLang !== visibleLanguage) fail('effective language');

                                for (const control of controls) {
                                    control.click();
                                    const id = control.getAttribute('aria-controls');
                                    if (!document.getElementById(id)?.classList.contains('active')) fail('inactive ' + id);
                                    if (document.documentElement.scrollWidth > innerWidth + 1) {
                                        const outside = [...document.querySelectorAll('body *')].filter(el => {
                                            let right = el.getBoundingClientRect().right;
                                            for (let parent = el.parentElement; right > innerWidth + 1 && parent && parent !== document.documentElement; parent = parent.parentElement) {
                                                if (getComputedStyle(parent).overflowX !== 'visible') right = Math.min(right, parent.getBoundingClientRect().right);
                                            }
                                            return right > innerWidth + 1;
                                        });
                                        const names = outside.slice(0, 6).map(el => el.tagName + '.' + el.className + '=' + Math.round(el.getBoundingClientRect().right));
                                        fail('horizontal overflow in ' + id + ' (' + document.documentElement.scrollWidth + 'px) ' + names.join(', '));
                                    }
                                }
                                buttons[0].click();
                                const rects = buttons.map(button => button.getBoundingClientRect());
                                if (rects.some((r,i) => r.width <= 0 || r.left < -1 || r.right > innerWidth + 1
                                    || (i > 0 && r.left < rects[i - 1].right - 1))) fail('clipped or overlapping navigation');

                                const tip = [...document.querySelectorAll('#tab-overview [tabindex="0"][data-tip-body]')]
                                    .find(el => el.getClientRects().length && !el.matches('button,input,select,textarea,summary,a,[data-action],.ctx-dot,.ctx-legend-item,.ctx-seg-slice'));
                                if (!tip) fail('missing focusable tooltip trigger');
                                tip.focus({ preventScroll: true });
                                tip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
                                const dialog = document.getElementById('acmRichTipPopover');
                                if (dialog.hidden || dialog.getAttribute('role') !== 'dialog' || !dialog.contains(document.activeElement)) fail('popover keyboard entry');
                                const box = dialog.getBoundingClientRect();
                                if (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1) fail('clipped popover');
                                document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                                if (!dialog.hidden || document.activeElement !== tip) fail('popover keyboard exit');
                                result.push({ check: 'layout-' + key, ok: true });
                            }
                        }
                        if (palettes.size !== 4) throw new Error('Expected four distinct applied theme palettes');
                        return result;
                    })()`);
                    assert.equal(combinations.length, 16, `all theme/zoom combinations at ${width}x${height} in ${lang}`);
                    browserChecks.push(...combinations);
                }
            }
            await ab(['set', 'viewport', '1280', '860']);
            await evalJs("document.body.style.zoom = '1'; window.dispatchEvent(new Event('resize'));");
        } else {
            for (const [w, h] of viewports) {
                await ab(['set', 'viewport', String(w), String(h)]);
                const metrics = await evalJs(`(() => {
                    window.dispatchEvent(new Event('resize'));
                    return {
                        width: innerWidth,
                        overflow: document.documentElement.scrollWidth > innerWidth + 1,
                        viewLang: document.body.getAttribute('data-view-lang'),
                        compactLang: document.body.getAttribute('data-compact-lang'),
                        tabCount: document.querySelectorAll('#tabBar .tab-btn').length,
                    };
                })()`);
                assert.equal(metrics.overflow, false, `zero horizontal overflow at ${w}x${h}`);
                assert.equal(metrics.tabCount, 6, 'strictly 6 tabs in #tabBar');
                if (w <= 480) {
                    assert.equal(metrics.compactLang, 'true', `width ${w}px triggers per-view compact language`);
                } else {
                    assert.equal(metrics.compactLang, 'false', `width ${w}px restores bilingual mode`);
                }
                browserChecks.push({ check: `viewport-${w}x${h}`, ok: true });
            }

            // 3. Zoom levels (80%, 100%, 125%, 150%) at 1280x860
            await ab(['set', 'viewport', '1280', '860']);
            for (const zoom of [80, 100, 125, 150]) {
                await evalJs(`document.body.style.zoom = ${JSON.stringify(String(zoom / 100))}; window.dispatchEvent(new Event('resize'));`);
                const overflow = await evalJs('document.documentElement.scrollWidth > innerWidth + 1');
                assert.equal(overflow, false, `zero horizontal overflow at ${zoom}% zoom`);
                browserChecks.push({ check: `zoom-${zoom}`, ok: true });
            }
            await evalJs("document.body.style.zoom = '1'; window.dispatchEvent(new Event('resize'));");

        }

        // 4. All 5 tabs + topbar ⚙️/ⓘ keyboard navigation
        for (const [label, sel, paneId] of [
            ['overview', '#tabBar [data-tab="overview"]', 'tab-overview'],
            ['gm', '#tabBar [data-tab="gm"]', 'tab-gm'],
            ['sessions', '#tabBar [data-tab="sessions"]', 'tab-sessions'],
            ['calendar', '#tabBar [data-tab="calendar"]', 'tab-calendar'],
            ['models', '#tabBar [data-tab="models"]', 'tab-models'],
            ['settings', '#tabBar [data-tab="settings"]', 'tab-settings'],
            ['about', '#topbarAboutBtn', 'tab-about'],
        ]) {
            await ab(['focus', sel]);
            await ab(['press', 'Enter']);
            assert.equal(await evalJs(`Boolean(document.querySelector('#${paneId}.active'))`), true, `${label} activates via keyboard`);
            browserChecks.push({ check: `view-${label}`, ok: true });
        }
        if (!options.smoke) {
            await ab(['click', '#tabBtn-overview']);
            assert.equal(await evalJs("(() => { const tip = [...document.querySelectorAll('#tab-overview .jargon-tip')].find(el => el.getClientRects().length); tip?.focus(); return !!tip && document.activeElement === tip; })()"), true);
            await ab(['press', 'Enter']);
            assert.equal(await evalJs("document.querySelector('#acmRichTipPopover[role=dialog]')?.contains(document.activeElement)"), true);
            await ab(['press', 'Shift+Tab']);
            assert.equal(await evalJs("document.querySelector('#acmRichTipPopover').hidden && !document.querySelector('#acmRichTipPopover').contains(document.activeElement)"), true);
            browserChecks.push({ check: 'pinned-popover-native-keyboard-exit', ok: true });
        }
    } finally {
        try { await runAgentBrowserJson(session, ['close']); } catch { /* ignore */ }
        await server.close();
    }

    return {
        ok: true,
        mode: 'stage3-verify-browser',
        security: securityReport,
        browserPassed: browserChecks.length,
        browserChecks,
    };
}

// ─── CLI Entrypoint ──────────────────────────────────────────────────────────

function formatUsage() {
    return [
        'Phase 6 Stage 3 — Isolated Standalone Fixture Server & Security Runner',
        '',
        'Usage:',
        '  node tests/e2e/stage3-standalone-fixture.mjs --verify-security [--clock <ISO>] [--json]',
        '  node tests/e2e/stage3-standalone-fixture.mjs --serve-only [--port <0..65535>] [--pairing-file <path>] [--clock <ISO>] [--lang <en|zh|both>]',
        '  node tests/e2e/stage3-standalone-fixture.mjs --verify-browser [--smoke] [--clock <ISO>] [--json]',
        '',
        'Guarantees:',
        '  - Strictly isolated temp HOME / brain / state dir inside os.tmpdir().',
        '  - ZERO real LS polling, ZERO real CDP probing, ZERO external GitHub fetches.',
        '  - NEVER prints one-time pairing codes or long-lived tokens to stdout or stderr.',
    ].join('\n');
}

async function main() {
    const { values } = parseArgs({
        args: process.argv.slice(2),
        options: {
            help: { type: 'boolean', short: 'h', default: false },
            'serve-only': { type: 'boolean', default: false },
            'verify-security': { type: 'boolean', default: false },
            'verify-browser': { type: 'boolean', default: false },
            smoke: { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
            port: { type: 'string', default: '0' },
            'pairing-file': { type: 'string' },
            clock: { type: 'string', default: DEFAULT_CLOCK_ISO },
            lang: { type: 'string', default: 'both' },
        },
    });

    if (values.help || (!values['serve-only'] && !values['verify-security'] && !values['verify-browser'])) {
        process.stdout.write(`${formatUsage()}\n`);
        return;
    }

    if (values['serve-only']) {
        const port = Number.parseInt(values.port, 10);
        if (!Number.isInteger(port) || port < 0 || port > 65535) {
            throw new Error(`Invalid --port value "${values.port}" (expected 0..65535).`);
        }
        const srv = await startStage3FixtureServer({
            port,
            pairingFile: values['pairing-file'],
            clockIso: values.clock,
            lang: values.lang,
        });

        // SECURITY: Print ONLY safe non-secret metadata — NEVER print pairingCode or session/overlay tokens!
        process.stdout.write(JSON.stringify({
            ok: true,
            mode: 'serve-only',
            url: srv.handle.url,
            host: srv.handle.host,
            port: srv.handle.port,
            pairingFile: srv.pairingFile,
            isolatedTempRoot: srv.env.rootDir,
            clock: values.clock,
        }) + '\n');

        let closing = false;
        const shutdown = async () => {
            if (closing) { return; }
            closing = true;
            await srv.close();
            process.exit(0);
        };
        process.once('SIGINT', () => { void shutdown(); });
        process.once('SIGTERM', () => { void shutdown(); });
        return;
    }

    if (values['verify-browser']) {
        const report = await runStage3BrowserMatrix({
            smoke: values.smoke,
            clockIso: values.clock,
        });
        if (values.json) {
            process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        } else {
            console.log(`[stage3] Security: ${report.security.passed}/${report.security.total} PASS | Browser: ${report.browserPassed} PASS`);
        }
        return;
    }

    if (values['verify-security']) {
        const report = await runStage3SecurityVerification({ clockIso: values.clock });
        if (values.json) {
            process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        } else {
            console.log(`[stage3] Isolated Standalone Security & Fixture Verification: ${report.passed}/${report.total} PASS`);
            for (const c of report.checks) {
                console.log(`  [PASS] ${c.id}: ${c.label} (${c.ms} ms)`);
            }
        }
    }
}

function isDirectEntrypoint() {
    if (!process.argv[1]) { return false; }
    try {
        return realpathSync(resolve(process.argv[1])) === realpathSync(__filename);
    } catch {
        return resolve(process.argv[1]) === __filename;
    }
}

if (isDirectEntrypoint()) {
    main().catch((err) => {
        console.error(`[stage3-fixture] FAIL: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    });
}

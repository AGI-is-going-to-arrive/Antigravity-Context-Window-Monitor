#!/usr/bin/env node
/* Backward-compatible thin E2E entrypoint for Antigravity IDE / WebView UI checks.
 * Delegates all harness logic, isolated temp fixture & destructive-action guards,
 * dual-side host + browser fixed-clock injection (`2026-12-01` UTC pre/post), and
 * modular v1.18.0 5-tab + Swarm + Plan C assertion suites to `tests/e2e/*`.
 *
 * Usage:
 *   node tests/installed-ide-ui.cjs --help
 *   node tests/installed-ide-ui.cjs --verify-guards [--clock <ISO|pre|post>]
 *   node tests/installed-ide-ui.cjs --dry-run [--clock <ISO|pre|post>] [--clock-matrix]
 *   node tests/installed-ide-ui.cjs --native [--app <IDE app name>] [--window-id <window id>]
 *   node tests/installed-ide-ui.cjs [--installed <extension directory>] [--smoke] [--clock <ISO|pre|post>] [--clock-matrix]
 *   node tests/installed-ide-ui.cjs --screenshot <output PNG file> [--screenshot-tab <view>] [--screenshot-theme <dark|light|vscode-*>] [--screenshot-lang <both|en|zh>] [--overwrite]
 *   node tests/installed-ide-ui.cjs --screenshots-dir <output directory> [--screenshot-theme <dark|light|both|vscode-*>] [--screenshot-lang <both|en|zh>] [--overwrite]
 */
'use strict';

const harness = require('./e2e/ide-ui-harness.cjs');
const cases = require('./e2e/ide-ui-cases.cjs');

async function runDryRunOrGuardChecks(args) {
    const guardReport = harness.runDestructiveGuardSelfTest();
    const explicitClock = harness.parseFixedClockIso(args.clock);

    // Verify browser clock shim generation for both pre & post 2026-12-01 UTC regimes
    const preParsed = harness.parseFixedClockIso(harness.CLOCK_REGIMES.pre);
    const postParsed = harness.parseFixedClockIso(harness.CLOCK_REGIMES.post);
    const preShim = harness.buildBrowserClockShimScript(preParsed.iso);
    const postShim = harness.buildBrowserClockShimScript(postParsed.iso);
    if (
        !preShim.includes(preParsed.iso)
        || !preShim.includes(String(preParsed.epochMs))
        || !postShim.includes(postParsed.iso)
        || !postShim.includes(String(postParsed.epochMs))
    ) {
        throw new Error('Browser fixed-clock shim failed sanity check.');
    }

    let dualClockReport = null;
    if (args['dry-run'] || args['clock-matrix'] || args.clock) {
        const fixtureEnv = harness.createIsolatedFixtureEnv({
            prefix: 'acm-ide-dryrun-',
            fixtureDir: args['fixture-dir'],
        });
        try {
            const installedDir = args.installed ? harness.resolveInstalledPath(args) : null;
            const panel = harness.loadInstalledPanel(harness.MANIFEST, installedDir, harness.REPO_ROOT, fixtureEnv);
            const clockIso = explicitClock ? explicitClock.iso : harness.CLOCK_REGIMES.pre;
            const clockMs = Date.parse(clockIso);
            const resetTime = new Date(clockMs + 3_600_000).toISOString();
            const { neon, configs, claude } = cases.buildModelCatalogFixture(panel, resetTime);
            const cleanUsage = {
                cascadeId: 'dryrun-coord-1',
                title: 'Dry-run dual-clock fixture',
                model: neon[4].placeholderId,
                modelDisplayName: neon[4].displayName,
                contextUsed: 214_500,
                contextLimit: 512_000,
                stepCount: 8,
                isEstimated: false,
                hasGaps: false,
            };
            const fixtures = cases.buildEditorialFixtures(cleanUsage, [neon[4], claude], panel.modules, resetTime, clockMs, fixtureEnv);
            dualClockReport = await cases.runDualClockHostSelfTest(
                panel,
                configs,
                cleanUsage,
                fixtures.populated.gmSummary,
                fixtures.v1173.quotaSummary,
                fixtureEnv,
            );
        } finally {
            fixtureEnv.cleanup();
        }
    }

    console.log(JSON.stringify({
        ok: true,
        mode: args['dry-run'] ? 'dry-run' : 'verify-guards',
        version: harness.MANIFEST.version,
        requestedClock: explicitClock ? explicitClock.iso : null,
        destructiveGuard: guardReport,
        dualClockHostAndBrowserShim: dualClockReport || {
            pre: harness.CLOCK_REGIMES.pre,
            post: harness.CLOCK_REGIMES.post,
            browserShimVerified: true,
        },
    }, null, 2));
}

async function main() {
    const args = harness.parseCliArgs(process.argv.slice(2));
    if (args.help) {
        console.log(harness.formatUsage());
        return;
    }
    if (args['verify-guards'] || args['dry-run']) {
        await runDryRunOrGuardChecks(args);
        return;
    }

    // Validate optional `--clock` and `--fixture-dir` up front (fail-closed)
    if (args.clock) {
        harness.parseFixedClockIso(args.clock);
    }
    if (args['fixture-dir']) {
        harness.assertIsolatedFixtureDir(args['fixture-dir'], { label: '--fixture-dir' });
    }

    const installedDir = harness.resolveInstalledPath(args);
    const { packageJSON, files, layout } = harness.checkInstall(installedDir, harness.REPO_ROOT, harness.MANIFEST);
    console.log(`Installed ${harness.EXTENSION_ID} ${packageJSON.version}: ${files} JS entry/files verified (${layout})`);

    if (args.native) {
        cases.runNativeSmoke(args);
    } else {
        await cases.runBrowserMatrix(args, packageJSON, installedDir);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}

module.exports = {
    harness,
    cases,
    main,
    runDryRunOrGuardChecks,
};

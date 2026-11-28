import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    compareGMContextCandidates,
    extractEffectiveStepIndex,
    getLatestGMContextUsed,
    getLatestGMContextUsedForCascade,
    normalizeEpochMs,
    selectLatestGMContextCall,
    type GMContextFallbackSelection,
} from '../src/core/gm-context-fallback';
import {
    MAX_MODEL_PRICE_PER_MILLION_USD,
    MAX_SUBSCRIPTION_MONTHLY_FEE,
    normalizeOrchestratorPricingMode,
    normalizeSubscriptionPlanId,
    normalizeSubscriptionSettings,
    sanitizeCustomPricingOverrides,
    validateCustomFxRate,
    validateCustomPricingOverrides,
    validateOrchestratorPricingMode,
    validateSubscriptionCurrency,
    validateSubscriptionMonthlyFee,
    validateSubscriptionPlan,
} from '../src/core/pricing-validation';
import {
    canonicalizeModelKey,
    extractModelShortId,
    inferZeroDayModelFamily,
    isPlatformModelId,
    isUnspecifiedModelId,
    normalizeApiProvider,
    normalizeZeroDayModelDisplayName,
    parseAvailableModelsSyncPayload,
    parsePositiveTokenLimit,
    resolveModelLimitsWithProvenance,
} from '../src/core/model-catalog-sync';
import {
    LINUX_FLATPAK_APP_ID,
    MACOS_CDP_LAUNCHER_BUNDLE_ID,
    buildLinuxDesktopEntry,
    buildLinuxLauncherScript,
    buildMacOsInfoPlist,
    buildMacOsLauncherScript,
    buildWindowsExplorerRevealCommand,
    detectLinuxFlatpakInstallation,
    escapeFreedesktopExecArg,
    extractAntigravityExeFromLnkBuffer,
    getFastWindowsDesktopFallback,
    getWindowsExeFilesystemCandidates,
    isMacOsChineseLocale,
    isOwnedMacCdpBundle,
    parseMacOsFirstAppleLanguage,
    resolveCoreCdpLauncherPaths,
    resolveMacOsLauncherLocaleIsZh,
    sanitizeLinuxXdgDir,
} from '../src/core/cdp-launcher-core';
import {
    FALLBACK_APP_VERSION,
    getRuntimeVersion,
    isValidSemverVersion,
    normalizeSemverVersion,
    readVersionFromManifestFile,
    resetRuntimeVersionCache,
    resolveRuntimeBuildId,
    resolveRuntimeVersion,
} from '../src/core/version';
import {
    discoverDevToolsActivePort,
    isAuthorizedCdpBrowserSession,
    parseAntigravityHostCommandLine,
    parseDevToolsActivePortContent,
    probeCdpAvailability,
    resolveDevToolsActivePortPaths,
    selectAntigravityHubTarget,
    selectAntigravityHubTargets,
} from '../src/app/cdp-discovery';

const tmpDirs: string[] = [];

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
}

afterEach(() => {
    resetRuntimeVersionCache();
    while (tmpDirs.length > 0) {
        const dir = tmpDirs.pop()!;
        try {
            fs.rmSync(dir, { recursive: true, force: true });
        } catch {
            // ignore cleanup errors
        }
    }
});

// ─── 1. src/core/gm-context-fallback.ts ──────────────────────────────────────

describe('src/core/gm-context-fallback — unified timestamp + boundary selector', () => {
    it('normalizes ISO timezones, fractional seconds, numeric ms, and rejects impossible calendar rollovers', () => {
        const utc = normalizeEpochMs('2026-11-27T10:00:00Z');
        const plus8 = normalizeEpochMs('2026-11-27T18:00:00+08:00');
        expect(utc).not.toBeNull();
        expect(plus8).toBe(utc);

        // Variable fractional second widths (lexicographically '.5Z' > '.050Z' even if equal/smaller)
        const tA = normalizeEpochMs('2026-11-27T10:00:00.5Z')!;
        const tB = normalizeEpochMs('2026-11-27T10:00:00.750Z')!;
        expect(tB).toBeGreaterThan(tA);

        expect(normalizeEpochMs(1700000000000)).toBe(1700000000000);
        expect(normalizeEpochMs('1700000000000')).toBe(1700000000000);
        expect(normalizeEpochMs(new Date(1700000000000))).toBe(1700000000000);

        // Impossible calendar dates must be rejected rather than silently rolling over
        expect(normalizeEpochMs('2026-02-30T00:00:00Z')).toBeNull();
        expect(normalizeEpochMs('not-a-date')).toBeNull();
        expect(normalizeEpochMs(-1)).toBeNull();
        expect(normalizeEpochMs(Number.NaN)).toBeNull();
    });

    it('selects latest call by normalized UTC timestamp instead of array order or lexicographic string order', () => {
        // Out-of-order array + timezone offset where lexicographic string compare would pick the wrong entry:
        // '2026-11-27T17:00:00+08:00' (= 09:00Z) > lexicographically '2026-11-27T10:00:00Z' (= 10:00Z),
        // yet 10:00Z is actually 1 hour NEWER!
        const calls = [
            { contextTokensUsed: 120_000, createdAt: '2026-11-27T10:00:00Z', stepIndices: [8, 9] },
            { contextTokensUsed: 80_000, createdAt: '2026-11-27T17:00:00+08:00', stepIndices: [4] },
            { contextTokensUsed: 0, createdAt: '2026-11-27T11:00:00Z', stepIndices: [10] },
        ];
        expect(getLatestGMContextUsed(calls)).toBe(120_000);
    });

    it('breaks equal timestamp ties deterministically by stepIndex, callOrder, and array index', () => {
        const sameTs = '2026-11-27T10:00:00.000Z';
        // Higher stepIndex wins even if earlier in array
        const byStep = selectLatestGMContextCall([
            { contextTokensUsed: 95_000, createdAt: sameTs, stepIndices: [12, 15] },
            { contextTokensUsed: 60_000, createdAt: sameTs, stepIndices: [10] },
        ]);
        expect(byStep?.contextTokensUsed).toBe(95_000);
        expect(byStep?.stepIndex).toBe(15);

        // Equal stepIndex -> higher callOrder wins
        const byOrder = selectLatestGMContextCall([
            { contextTokensUsed: 75_000, createdAt: sameTs, startStepIndex: 10, callOrder: 4 },
            { contextTokensUsed: 70_000, createdAt: sameTs, startStepIndex: 10, callOrder: 2 },
        ]);
        expect(byOrder?.contextTokensUsed).toBe(75_000);

        // Equal everything -> later array index wins
        const byIndex = selectLatestGMContextCall([
            { contextTokensUsed: 50_000, createdAt: sameTs, startStepIndex: 10, callOrder: 1 },
            { contextTokensUsed: 55_000, createdAt: sameTs, startStepIndex: 10, callOrder: 1 },
        ]);
        expect(byIndex?.contextTokensUsed).toBe(55_000);
        expect(byIndex?.callIndex).toBe(1);

        expect(extractEffectiveStepIndex({ stepIndices: [2, 8, 5], startStepIndex: 1 })).toBe(8);
        expect(extractEffectiveStepIndex({ stepIndices: [], startStepIndex: 3 })).toBe(3);
    });

    it('rejects stale pre-compaction / pre-rewind high-water readings and fails closed on undated calls when bounded', () => {
        const calls = [
            // Pre-compaction high-water mark (step 20, 480k tokens)
            { contextTokensUsed: 480_000, createdAt: '2026-11-27T10:00:00Z', stepIndices: [20] },
            // Undated delayed reading (cannot prove it occurred after compaction)
            { contextTokensUsed: 495_000, createdAt: '' },
            // Post-compaction valid lower reading (step 22, 65k tokens)
            { contextTokensUsed: 65_000, createdAt: '2026-11-27T10:05:00Z', stepIndices: [22] },
        ];

        // With compaction boundary at 10:02Z / step 21 -> ONLY post-compaction 65k qualifies
        expect(getLatestGMContextUsed(calls, {
            compactionBoundary: { timestampMs: '2026-11-27T10:02:00Z', stepIndex: 21 },
        })).toBe(65_000);

        // If no post-compaction call has arrived yet -> returns 0 instead of restoring 480k!
        const preOnly = calls.slice(0, 2);
        expect(getLatestGMContextUsed(preOnly, {
            minTimestampMs: '2026-11-27T10:02:00Z',
        })).toBe(0);

        // Exclusive boundary rejects equality
        expect(getLatestGMContextUsed(
            [{ contextTokensUsed: 400_000, createdAt: '2026-11-27T10:05:00Z', stepIndices: [22] }],
            { compactionBoundary: { timestampMs: '2026-11-27T10:05:00Z', exclusive: true } },
        )).toBe(0);

        // Cascade lookup wrapper
        const summary = {
            conversations: [
                { cascadeId: 'c1', calls },
            ],
        };
        expect(getLatestGMContextUsedForCascade(summary, 'c1', { minStepIndex: 21 })).toBe(65_000);
        expect(getLatestGMContextUsedForCascade(summary, 'missing')).toBe(0);
    });

    it('maintains strict transitive total ordering across mixed dated and undated candidates', () => {
        const candidates: GMContextFallbackSelection[] = [
            { contextTokensUsed: 200_000, callIndex: 0, timestampMs: 2000, stepIndex: 5, callOrder: null },
            { contextTokensUsed: 100_000, callIndex: 1, timestampMs: 1000, stepIndex: 10, callOrder: null },
            { contextTokensUsed: 300_000, callIndex: 2, timestampMs: null, stepIndex: 8, callOrder: null },
            { contextTokensUsed: 400_000, callIndex: 3, timestampMs: null, stepIndex: 12, callOrder: 1 },
            { contextTokensUsed: 150_000, callIndex: 4, timestampMs: 2000, stepIndex: 5, callOrder: 2 },
        ];

        // Verify antisymmetry and transitivity across every triple
        for (const a of candidates) {
            expect(compareGMContextCandidates(a, a)).toBe(0);
            for (const b of candidates) {
                const ab = Math.sign(compareGMContextCandidates(a, b));
                const ba = Math.sign(compareGMContextCandidates(b, a));
                expect(ab).toBe(ba === 0 ? 0 : -ba);
                for (const c of candidates) {
                    const bc = Math.sign(compareGMContextCandidates(b, c));
                    const ac = Math.sign(compareGMContextCandidates(a, c));
                    if (ab > 0 && bc > 0) {
                        expect(ac).toBeGreaterThan(0);
                    }
                    if (ab < 0 && bc < 0) {
                        expect(ac).toBeLessThan(0);
                    }
                }
            }
        }

        // Verify permutation-invariant winner for the exact 3-element mixed cycle test case
        const mixed = [
            { contextTokensUsed: 200_000, createdAt: 2000, stepIndices: [5] },
            { contextTokensUsed: 100_000, createdAt: 1000, stepIndices: [10] },
            { contextTokensUsed: 300_000, createdAt: '', stepIndices: [8] },
        ];
        const perms = [
            [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
        ];
        for (const perm of perms) {
            const ordered = perm.map((i) => mixed[i]);
            expect(getLatestGMContextUsed(ordered)).toBe(200_000);
        }

        // Array.prototype.sort produces strictly monotonic order
        const sorted = [...candidates].sort(compareGMContextCandidates);
        expect(sorted.map((s) => s.contextTokensUsed)).toEqual([300_000, 400_000, 100_000, 200_000, 150_000]);
    });
});

// ─── 2. src/core/pricing-validation.ts ───────────────────────────────────────

describe('src/core/pricing-validation — custom pricing, orchestrator mode, and subscription validation', () => {
    it('validates custom model pricing overrides and rejects malformed, negative, NaN/Infinity, and polluted keys', () => {
        const valid = validateCustomPricingOverrides({
            'gemini-4-neon': { input: 3, output: 15, cacheRead: 0.15, cacheWrite: 0 },
            'custom-zero': { input: -0, output: 0 },
        });
        expect(valid.ok).toBe(true);
        if (valid.ok) {
            expect(Object.is(valid.value['custom-zero'].input, 0)).toBe(true);
            expect(valid.value['gemini-4-neon'].thinking).toBe(15);
            expect(valid.value['custom-zero'].cacheRead).toBe(0);
        }

        // Rejects negative, NaN, Infinity, out-of-bounds
        expect(validateCustomPricingOverrides({ m: { input: -1, output: 2 } }).ok).toBe(false);
        expect(validateCustomPricingOverrides({ m: { input: Number.NaN, output: 2 } }).ok).toBe(false);
        expect(validateCustomPricingOverrides({ m: { input: 1, output: Number.POSITIVE_INFINITY } }).ok).toBe(false);
        expect(validateCustomPricingOverrides({ m: { input: MAX_MODEL_PRICE_PER_MILLION_USD + 1, output: 1 } }).ok).toBe(false);

        // Rejects invalid keys & prototype pollution & non-objects
        expect(sanitizeCustomPricingOverrides(null)).toBeNull();
        expect(sanitizeCustomPricingOverrides([])).toBeNull();
        expect(sanitizeCustomPricingOverrides({ '   ': { input: 1, output: 2 } })).toBeNull();
        expect(sanitizeCustomPricingOverrides({ 'bad\nkey': { input: 1, output: 2 } })).toBeNull();
        const protoPayload = JSON.parse('{"__proto__":{"input":1,"output":2}}');
        expect(validateCustomPricingOverrides(protoPayload).ok).toBe(false);
        expect(validateCustomPricingOverrides({ constructor: { input: 1, output: 2 } }).ok).toBe(false);

        // Rejects duplicate keys after trimming
        expect(validateCustomPricingOverrides({
            'model-a': { input: 1, output: 2 },
            ' model-a ': { input: 3, output: 4 },
        }).ok).toBe(false);
    });

    it('validates orchestratorPricingMode, subscriptionPlan, monthly fee, customFxRate, and all 10 currencies', () => {
        expect(validateOrchestratorPricingMode('mapped')).toEqual({ ok: true, value: 'mapped' });
        expect(validateOrchestratorPricingMode('strict')).toEqual({ ok: true, value: 'strict' });
        expect(validateOrchestratorPricingMode('invalid').ok).toBe(false);
        expect(normalizeOrchestratorPricingMode('invalid')).toBe('mapped');

        expect(validateSubscriptionPlan('google-ai-pro')).toEqual({ ok: true, value: 'google-ai-pro' });
        expect(validateSubscriptionPlan('google-ai-ultra', 99.99)).toEqual({ ok: true, value: 'google-ai-ultra-5x' });
        expect(validateSubscriptionPlan('google-ai-ultra')).toEqual({ ok: true, value: 'google-ai-ultra-20x' });
        expect(validateSubscriptionPlan('bogus').ok).toBe(false);
        expect(normalizeSubscriptionPlanId('', 19.99)).toBe('google-ai-pro');
        expect(normalizeSubscriptionPlanId('', 42)).toBe('custom');

        expect(validateSubscriptionMonthlyFee(null)).toEqual({ ok: true, value: null });
        expect(validateSubscriptionMonthlyFee(0)).toEqual({ ok: true, value: null });
        expect(validateSubscriptionMonthlyFee(19.99)).toEqual({ ok: true, value: 19.99 });
        expect(validateSubscriptionMonthlyFee(-5).ok).toBe(false);
        expect(validateSubscriptionMonthlyFee(Number.NaN).ok).toBe(false);
        expect(validateSubscriptionMonthlyFee(MAX_SUBSCRIPTION_MONTHLY_FEE + 1).ok).toBe(false);

        // All 10 currencies including CAD
        expect(validateSubscriptionCurrency('CAD')).toEqual({ ok: true, value: 'CAD' });
        expect(validateSubscriptionCurrency('cad')).toEqual({ ok: true, value: 'CAD' });
        expect(validateSubscriptionCurrency('BTC').ok).toBe(false);

        expect(validateCustomFxRate(null)).toEqual({ ok: true, value: null });
        expect(validateCustomFxRate(1.38)).toEqual({ ok: true, value: 1.38 });
        expect(validateCustomFxRate(0).ok).toBe(false);
        expect(validateCustomFxRate(-1).ok).toBe(false);

        // Reconciled subscription settings
        expect(normalizeSubscriptionSettings({
            subscriptionPlan: 'google-ai-pro',
            subscriptionMonthlyFee: null,
            subscriptionCurrency: 'CAD',
        })).toEqual({
            subscriptionPlan: 'google-ai-pro',
            subscriptionMonthlyFee: 19.99,
            subscriptionCurrency: 'USD',
        });

        expect(normalizeSubscriptionSettings({
            subscriptionPlan: 'custom',
            subscriptionMonthlyFee: 29,
            subscriptionCurrency: 'cad',
        })).toEqual({
            subscriptionPlan: 'custom',
            subscriptionMonthlyFee: 29,
            subscriptionCurrency: 'CAD',
        });

        expect(normalizeSubscriptionSettings({
            subscriptionPlan: 'none',
            subscriptionMonthlyFee: 99,
            subscriptionCurrency: 'CAD',
        })).toEqual({
            subscriptionPlan: 'none',
            subscriptionMonthlyFee: null,
            subscriptionCurrency: 'CAD',
        });
    });
});

// ─── 3. src/core/model-catalog-sync.ts ───────────────────────────────────────

describe('src/core/model-catalog-sync — zero-day normalization, RPC sync, and limit provenance', () => {
    it('normalizes zero-day unknown models and canonical IDs gracefully', () => {
        expect(isPlatformModelId('MODEL_PLACEHOLDER_M999')).toBe(true);
        expect(isPlatformModelId('MODEL_UNSPECIFIED')).toBe(false);
        expect(isUnspecifiedModelId('MODEL_PLACEHOLDER_UNSPECIFIED')).toBe(true);
        expect(extractModelShortId('MODEL_PLACEHOLDER_M532')).toBe('M532');
        expect(extractModelShortId('MODEL_OPENAI_GPT_OSS_120B_MEDIUM')).toBe('OSS-120B');
        expect(canonicalizeModelKey('Gemini 4 Neon（High） (M532)', { stripDiagnosticSuffix: true })).toBe('Gemini 4 Neon(High)');
        expect(parsePositiveTokenLimit('512000')).toBe(512000);
        expect(parsePositiveTokenLimit(-10)).toBe(0);
        expect(normalizeApiProvider('API_PROVIDER_GOOGLE_GEMINI')).toBe('GOOGLE_GEMINI');

        // Zero-day humanization
        expect(normalizeZeroDayModelDisplayName('gemini-5-nova-xhigh')).toBe('Gemini 5 Nova (XHigh)');
        expect(normalizeZeroDayModelDisplayName('claude-opus-6-0-medium')).toBe('Claude Opus 6.0 (Medium)');
        expect(normalizeZeroDayModelDisplayName('gpt-oss-240b-high')).toBe('GPT-OSS 240B (High)');
        expect(normalizeZeroDayModelDisplayName('MODEL_PLACEHOLDER_M999')).toBe('Model M999');
        expect(normalizeZeroDayModelDisplayName('MODEL_PLACEHOLDER_M999', 'Gemini 5 Nova (High)')).toBe('Gemini 5 Nova (High)');

        expect(inferZeroDayModelFamily('gemini-5-nova-high')).toBe('gemini');
        expect(inferZeroDayModelFamily('claude-opus-6-0')).toBe('claude');
        expect(inferZeroDayModelFamily('MODEL_PLACEHOLDER_M999', 'API_PROVIDER_OPENAI_VERTEX')).toBe('openai');
        expect(inferZeroDayModelFamily('imagen-4-ultra')).toBe('image');
    });

    it('parses GetAvailableModels payload with zero-day models, checkpointer limits, protobuf defaults, and image models', () => {
        const resp = {
            response: {
                imageGenerationModelIds: ['imagen-zero-day'],
                models: {
                    'gemini-5-nova-high': {
                        model: 'MODEL_PLACEHOLDER_M999',
                        apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                        maxTokens: 2_000_000,
                        maxOutputTokens: 131_072,
                        supportsThinking: true,
                        modelExperiments: {
                            experiments: {
                                CASCADE_USE_EXPERIMENT_CHECKPOINTER: {
                                    stringValue: JSON.stringify({ max_token_limit: 768_000, token_threshold: 64_000 }),
                                },
                                'plan-execute-config': {
                                    stringValue: JSON.stringify({ executionModel: 'MODEL_PLACEHOLDER_M998' }),
                                },
                            },
                        },
                    },
                    'imagen-zero-day': {
                        model: 'MODEL_PLACEHOLDER_M990',
                        displayName: 'Imagen Zero Day',
                        apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                        maxTokens: 65_536,
                        maxOutputTokens: 8_192,
                    },
                    'internal-tab-model': {
                        model: 'MODEL_CHAT_INTERNAL',
                        // No maxTokens, no checkpointer, not registered or in picker -> skipped
                    },
                },
            },
        };

        const result = parseAvailableModelsSyncPayload(resp);
        expect(result.hasEffectiveUpdates).toBe(true);
        expect(result.hasImageModelList).toBe(true);
        expect(result.imageModelIds).toEqual(['imagen-zero-day']);
        expect(result.imageMetadataSynced).toBe(true);
        expect(result.entries).toHaveLength(2);

        const zeroDay = result.entries.find((e) => e.resolvedId === 'MODEL_PLACEHOLDER_M999')!;
        expect(zeroDay.isZeroDay).toBe(true);
        expect(zeroDay.completeMetadata).toBe(true);
        expect(zeroDay.specPatch.displayName).toBe('Gemini 5 Nova (High)');
        expect(zeroDay.specPatch.cpLimit).toBe(768_000);
        expect(zeroDay.specPatch.cpThreshold).toBe(64_000);
        expect(zeroDay.specPatch.executionModelId).toBe('MODEL_PLACEHOLDER_M998');
        expect(zeroDay.specPatch.thinkingBudget).toBe(0); // protobuf default cleared on completeMetadata
        expect(result.contextLimitOverrides['MODEL_PLACEHOLDER_M999']).toBe(768_000);
        expect(result.contextLimitOverrides['gemini-5-nova-high']).toBe(768_000);

        const img = result.entries.find((e) => e.resolvedId === 'MODEL_PLACEHOLDER_M990')!;
        expect(img.isImageGeneration).toBe(true);
        expect(img.specPatch.cpLimit).toBe(0);
        expect(img.specPatch.thinkingCapabilityReported).toBe(false);
    });

    it('resolves compaction & native limit provenance without fabricating compaction limits on native-only or unknown models', () => {
        // Live checkpointer + live catalog
        const live = resolveModelLimitsWithProvenance({
            liveCheckpointerLimit: 512_000,
            liveCheckpointerThreshold: 50_000,
            liveNativeLimit: 1_048_576,
        });
        expect(live).toEqual({
            compactionLimit: 512_000,
            compactionLimitProvenance: 'live_checkpointer',
            compactionThreshold: 50_000,
            nativeLimit: 1_048_576,
            nativeLimitProvenance: 'live_catalog',
            isNativeOnly: false,
            limitsEqual: false,
        });

        // Native-only model (cpLimit: 0, maxTokens: 1M) -> compactionLimit stays null!
        const nativeOnly = resolveModelLimitsWithProvenance({
            staticCompactionLimit: 0,
            staticNativeLimit: 1_048_576,
        });
        expect(nativeOnly.compactionLimit).toBeNull();
        expect(nativeOnly.compactionLimitProvenance).toBe('none');
        expect(nativeOnly.nativeLimit).toBe(1_048_576);
        expect(nativeOnly.isNativeOnly).toBe(true);

        // Equal compaction & native limits
        const equal = resolveModelLimitsWithProvenance({
            staticCompactionLimit: 256_000,
            staticNativeLimit: 256_000,
        });
        expect(equal.limitsEqual).toBe(true);

        // Zero-day completely unknown model -> both null/'none'
        const unknown = resolveModelLimitsWithProvenance({});
        expect(unknown.compactionLimit).toBeNull();
        expect(unknown.nativeLimit).toBeNull();
        expect(unknown.compactionLimitProvenance).toBe('none');
        expect(unknown.nativeLimitProvenance).toBe('none');
    });
});

// ─── 4. src/core/cdp-launcher-core.ts ────────────────────────────────────────

describe('src/core/cdp-launcher-core — cross-platform launcher core helpers', () => {
    it('macOS: enforces Cancel default button, first-entry AppleLanguages, and bundle ownership/symlink guards', () => {
        const script = buildMacOsLauncherScript('/Applications/Antigravity.app');
        expect(script).toContain('default button "Cancel" cancel button "Cancel"');
        expect(script).toContain('default button "取消" cancel button "取消"');
        expect(script).toContain('AppleLanguages');
        expect(script).toContain('--remote-debugging-port=0');

        // First-entry AppleLanguages parsing: English first with Chinese second MUST stay English!
        const enFirst = '(\n    "en-US",\n    "zh-Hans-CN"\n)';
        const zhFirst = '(\n    "zh-Hant-TW",\n    "en-US"\n)';
        expect(parseMacOsFirstAppleLanguage(enFirst)).toBe('en-US');
        expect(parseMacOsFirstAppleLanguage(zhFirst)).toBe('zh-Hant-TW');
        expect(resolveMacOsLauncherLocaleIsZh({ env: { LANG: 'C.UTF-8' }, appleLanguagesRaw: enFirst })).toBe(false);
        expect(resolveMacOsLauncherLocaleIsZh({ env: { LANG: 'C.UTF-8' }, appleLanguagesRaw: zhFirst })).toBe(true);
        expect(isMacOsChineseLocale('zh-Hans')).toBe(true);
        expect(isMacOsChineseLocale('en-US')).toBe(false);

        // Bundle ownership & symlink refusal
        const dir = makeTempDir('acm-mac-core-');
        const bundleDir = path.join(dir, 'Antigravity (CDP).app');
        fs.mkdirSync(path.join(bundleDir, 'Contents'), { recursive: true });
        fs.writeFileSync(path.join(bundleDir, 'Contents', 'Info.plist'), buildMacOsInfoPlist(), 'utf8');
        expect(isOwnedMacCdpBundle(bundleDir)).toBe(true);
        expect(buildMacOsInfoPlist()).toContain(MACOS_CDP_LAUNCHER_BUNDLE_ID);

        const symlinkBundle = path.join(dir, 'Symlink.app');
        fs.symlinkSync(bundleDir, symlinkBundle);
        expect(isOwnedMacCdpBundle(symlinkBundle)).toBe(false);
    });

    it('Linux: validates XDG dirs, escapes .desktop Exec= with spaces & %, and detects Flatpak', () => {
        expect(sanitizeLinuxXdgDir('/home/user/.local/share')).toBe('/home/user/.local/share');
        expect(sanitizeLinuxXdgDir('relative/dir')).toBeNull();
        expect(sanitizeLinuxXdgDir('/home/user/../etc')).toBeNull();
        expect(sanitizeLinuxXdgDir('/bad\npath')).toBeNull();

        expect(escapeFreedesktopExecArg('/home/my user/100%bin/antigravity-cdp'))
            .toBe('"/home/my user/100%%bin/antigravity-cdp"');
        const desktop = buildLinuxDesktopEntry('/home/my user/100%bin/antigravity-cdp', '/icon.svg');
        expect(desktop).toContain('Exec="/home/my user/100%%bin/antigravity-cdp" %U');
        expect(desktop).toContain('StartupWMClass=Antigravity');

        const linuxScript = buildLinuxLauncherScript(`flatpak:${LINUX_FLATPAK_APP_ID}`);
        expect(linuxScript).toContain('exec flatpak run "$FLATPAK_APP_ID" --remote-debugging-port=0');

        const home = makeTempDir('acm-linux-home-');
        const flatpakShim = path.join(home, '.local', 'share', 'flatpak', 'exports', 'bin', LINUX_FLATPAK_APP_ID);
        fs.mkdirSync(path.dirname(flatpakShim), { recursive: true });
        fs.writeFileSync(flatpakShim, '#!/bin/sh\n', 'utf8');

        const fp = detectLinuxFlatpakInstallation({ homeDir: home, env: { HOME: home } });
        expect(fp.detected).toBe(true);
        expect(fp.launchTarget).toBe(flatpakShim);
        expect(fp.sandboxPortFilePath).toContain('.var/app/com.google.Antigravity/config/Antigravity/DevToolsActivePort');

        const resolved = resolveCoreCdpLauncherPaths({
            platform: 'linux',
            homeDir: home,
            env: { HOME: home, XDG_DATA_HOME: 'relative/invalid' },
        });
        expect(resolved.linuxXdgDataHome).toBe(path.join(home, '.local', 'share'));
        expect(resolved.linuxIsFlatpak).toBe(true);
    });

    it('Windows: discovers Program Files / OneDrive / .lnk targets and builds verbatim explorer.exe /select, args', () => {
        const candidates = getWindowsExeFilesystemCandidates('C:\\Users\\Alice\\AppData\\Local', {
            ProgramFiles: 'C:\\Program Files',
            'ProgramFiles(x86)': 'C:\\Program Files (x86)',
            ProgramW6432: 'C:\\Program Files',
        });
        expect(candidates).toContain('C:\\Users\\Alice\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe');
        expect(candidates).toContain('C:\\Program Files\\Antigravity\\Antigravity.exe');
        expect(candidates).toContain('C:\\Program Files (x86)\\Google\\Antigravity\\Antigravity.exe');
        // Case-insensitive deduplication of ProgramW6432 == ProgramFiles
        expect(candidates.filter((c) => c.toLowerCase() === 'c:\\program files\\antigravity\\antigravity.exe')).toHaveLength(1);

        // OneDrive Desktop fallback
        const fakeWinHome = makeTempDir('acm-win-home-');
        const oneDriveDesktop = path.join(fakeWinHome, 'OneDrive', 'Desktop');
        fs.mkdirSync(oneDriveDesktop, { recursive: true });
        expect(getFastWindowsDesktopFallback(fakeWinHome, { OneDrive: path.join(fakeWinHome, 'OneDrive') }))
            .toBe(oneDriveDesktop);

        // .lnk UTF-16LE & ASCII target extraction
        const utf16Buf = Buffer.concat([
            Buffer.from([0x4c, 0x00, 0x00, 0x00]),
            Buffer.from('C:\\Program Files\\Antigravity\\Antigravity.exe', 'utf16le'),
        ]);
        expect(extractAntigravityExeFromLnkBuffer(utf16Buf)).toBe('C:\\Program Files\\Antigravity\\Antigravity.exe');

        // Verbatim explorer.exe /select, args (spaces, commas, Unicode, trailing backslash stripped)
        const spec = buildWindowsExplorerRevealCommand('C:\\Users\\Alice, Bob\\桌面\\Antigravity (CDP).lnk\\');
        expect(spec.cmd).toBe('explorer.exe');
        expect(spec.args).toEqual(['/select,', '"C:\\Users\\Alice, Bob\\桌面\\Antigravity (CDP).lnk"']);
        expect(spec.options.windowsVerbatimArguments).toBe(true);
        expect(spec.options.shell).toBe(false);

        // Rejects quotes and control characters
        expect(() => buildWindowsExplorerRevealCommand('C:\\bad"path')).toThrow();
        expect(() => buildWindowsExplorerRevealCommand('C:\\bad\npath')).toThrow();
    });
});

// ─── 5. src/core/version.ts ──────────────────────────────────────────────────

describe('src/core/version — single-source runtime version resolver', () => {
    it('resolves explicit > bundled > env > plugin.json > owned manifest > fallback without trusting unrelated parent package.json', () => {
        expect(normalizeSemverVersion('v1.18.0-rc.1')).toBe('1.18.0-rc.1');
        expect(isValidSemverVersion('1.18.0')).toBe(true);
        expect(isValidSemverVersion('not-a-version')).toBe(false);

        expect(resolveRuntimeVersion({ explicitVersion: 'v2.0.0', bundledVersion: '1.19.0' })).toBe('2.0.0');
        expect(resolveRuntimeVersion({ bundledVersion: '1.18.0', env: { ACM_APP_VERSION: '1.17.0' } })).toBe('1.18.0');
        expect(resolveRuntimeVersion({ bundledVersion: null, env: { ACM_APP_VERSION: '1.18.2' } })).toBe('1.18.2');

        // Plugin root manifest
        const pluginDir = makeTempDir('acm-plugin-ver-');
        fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify({ name: 'antigravity-context-monitor', version: '1.18.5' }), 'utf8');
        expect(resolveRuntimeVersion({ bundledVersion: null, env: {}, pluginRoot: pluginDir })).toBe('1.18.5');

        // Isolated temp directory with an UNRELATED parent package.json must NOT pick up the unrelated version!
        const isolatedRoot = makeTempDir('acm-isolated-');
        const nestedDir = path.join(isolatedRoot, 'bundle');
        fs.mkdirSync(nestedDir, { recursive: true });
        fs.writeFileSync(path.join(isolatedRoot, 'package.json'), JSON.stringify({ name: 'some-other-tool', version: '9.9.9' }), 'utf8');
        expect(readVersionFromManifestFile(path.join(isolatedRoot, 'package.json'), { requireOwnedIdentity: true })).toBeNull();
        expect(resolveRuntimeVersion({
            bundledVersion: null,
            env: {},
            searchStartDir: nestedDir,
        })).toBe(FALLBACK_APP_VERSION);

        // Memoized default getter resolves workspace package.json
        expect(isValidSemverVersion(getRuntimeVersion())).toBe(true);
        expect(resolveRuntimeBuildId({ explicitBuildId: 'sha256:abc123' })).toBe('sha256:abc123');
        expect(resolveRuntimeBuildId({ explicitVersion: '1.18.0', bundledBuildId: null, env: {} })).toBe('v1.18.0');

        // ESM / no-__dirname safety: explicit empty searchStartDir skips upward walk cleanly,
        // and source guards `__dirname` via `typeof __dirname === 'string'` so ESM entrypoints never throw ReferenceError.
        expect(resolveRuntimeVersion({
            bundledVersion: null,
            env: {},
            searchStartDir: '',
        })).toBe(FALLBACK_APP_VERSION);
        const versionSrc = fs.readFileSync(path.resolve(__dirname, '../src/core/version.ts'), 'utf8');
        expect(versionSrc).toMatch(/typeof\s+__dirname\s*===\s*['"]string['"]/);
    });
});

// ─── 6. src/app/cdp-discovery.ts ─────────────────────────────────────────────

describe('src/app/cdp-discovery — lightweight IDE CDP probe (zero overlay assets / zero vscode)', () => {
    it('resolves port files (including Linux Flatpak), parses DevToolsActivePort, and filters host command lines', () => {
        const linuxPaths = resolveDevToolsActivePortPaths({
            platform: 'linux',
            homedir: '/home/dev',
            env: { XDG_CONFIG_HOME: '/home/dev/.config' },
        });
        expect(linuxPaths).toContain('/home/dev/.config/Antigravity/DevToolsActivePort');
        expect(linuxPaths).toContain('/home/dev/.var/app/com.google.Antigravity/config/Antigravity/DevToolsActivePort');

        expect(parseDevToolsActivePortContent('9222\n/devtools/browser/abc-123\n')).toEqual({
            port: 9222,
            wsPath: '/devtools/browser/abc-123',
        });
        expect(parseDevToolsActivePortContent('99999\n/devtools/browser/abc')).toBeNull();

        const discovered = discoverDevToolsActivePort({
            explicitPaths: ['/fake/DevToolsActivePort'],
            readFileSyncFn: () => '9333\n/devtools/browser/xyz\n',
        });
        expect(discovered).toEqual({ port: 9333, wsPath: '/devtools/browser/xyz', filePath: '/fake/DevToolsActivePort' });

        expect(parseAntigravityHostCommandLine('/tmp/.mount_AntigrABC/AppRun "--remote-debugging-port=9333"')
            .explicitPort).toBe(9333);
        for (const invalid of ['--remote-debugging-port', '--remote-debugging-port=65536', '--remote-debugging-port=oops',
            '"--user-data-dir=/tmp/profile --remote-debugging-port=9333"']) {
            expect(parseAntigravityHostCommandLine('/opt/antigravity ' + invalid).hasRemoteDebuggingFlag).toBe(false);
        }
        const quoted = parseAntigravityHostCommandLine('/usr/bin/antigravity "--user-data-dir=/tmp/QA Profile" --remote-debugging-port=0');
        expect(quoted.customUserDataDir).toBe('/tmp/QA Profile');
        const pathsRead: string[] = [];
        expect(discoverDevToolsActivePort({
            platform: 'linux',
            customUserDataDir: quoted.customUserDataDir,
            env: { AGY_BROWSER_ACTIVE_PORT_FILE: '/sibling/DevToolsActivePort' },
            readFileSyncFn(filePath) {
                pathsRead.push(filePath);
                if (filePath.startsWith('/sibling/')) { return '9333\n/devtools/browser/sibling'; }
                throw new Error('Port file is unavailable');
            },
        })).toBeNull();
        expect(pathsRead).toEqual(['/tmp/QA Profile/DevToolsActivePort']);

        // Host command line parsing: accepts Desktop main, rejects IDE/Helper/--type=
        expect(parseAntigravityHostCommandLine('/Applications/Antigravity.app/Contents/MacOS/Antigravity --remote-debugging-port=9229 --user-data-dir="/tmp/prof"')).toEqual({
            isAntigravityHost: true,
            hasRemoteDebuggingFlag: true,
            explicitPort: 9229,
            customUserDataDir: '/tmp/prof',
        });
        expect(parseAntigravityHostCommandLine('/Applications/Antigravity.app/Contents/MacOS/Antigravity Helper --type=renderer')).toEqual({
            isAntigravityHost: false,
            hasRemoteDebuggingFlag: false,
        });
        expect(parseAntigravityHostCommandLine('/usr/bin/antigravity-ide --remote-debugging-port=9222')).toEqual({
            isAntigravityHost: false,
            hasRemoteDebuggingFlag: false,
        });
    });

    it('enforces positive browser-session & Hub target verification and honors probeCdpAvailability states', async () => {
        // Positive browser-session check fails closed on wsPath mismatch
        expect(isAuthorizedCdpBrowserSession(
            { Browser: 'Chrome/130.0', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/aaa' },
            '/devtools/browser/aaa',
        )).toBe(true);
        expect(isAuthorizedCdpBrowserSession(
            { Browser: 'Chrome/130.0', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/bbb' },
            '/devtools/browser/aaa',
        )).toBe(false);

        expect(isAuthorizedCdpBrowserSession({ Browser: 'Chrome/130' }, undefined, 9222)).toBe(false);
        for (const url of ['ws://127.0.0.1:9333/devtools/browser/live', 'ws://127.0.0.1:9222/devtools/page/live']) {
            expect(isAuthorizedCdpBrowserSession({ Browser: 'Chrome/130', webSocketDebuggerUrl: url }, undefined, 9222)).toBe(false);
        }

        // Positive Hub target selection NEVER selects unidentified loopback pages
        const targets = [
            { id: 'dev', type: 'page', title: 'Local Vite App', url: 'http://127.0.0.1:5173/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/dev' },
            { id: 'hub', type: 'page', title: 'My Workspace - Antigravity', url: 'https://127.0.0.1:44321/', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/hub' },
        ];
        expect(selectAntigravityHubTargets([targets[0]])).toEqual([]);
        expect(selectAntigravityHubTarget(targets)?.id).toBe('hub');

        // 1. Disabled state performs zero port/network probes
        let probed = false;
        const disabled = await probeCdpAvailability({
            composerEnabled: false,
            topBarEnabled: false,
            discoverActivePortFn: () => { probed = true; return null; },
            inspectLauncherStatusFn: () => { throw new Error('Unexpected launcher probe while disabled'); },
        });
        expect(disabled.state).toBe('disabled');
        expect(disabled.diagnosticCode).toBe('disabled');
        expect(probed).toBe(false);

        // 2. Host missing flag beats stale DevToolsActivePort
        const missingFlag = await probeCdpAvailability({
            composerEnabled: true,
            topBarEnabled: false,
            inspectHostProcessFn: () => ({ found: true, hasRemoteDebuggingFlag: false }),
            discoverActivePortFn: () => ({ port: 9222, wsPath: '/devtools/browser/stale', filePath: '/stale' }),
        });
        expect(missingFlag.diagnosticCode).toBe('host_missing_flag');

        // 3. Explicit --remote-debugging-port=N beats stale DevToolsActivePort and connects
        const connected = await probeCdpAvailability({
            composerEnabled: true,
            topBarEnabled: true,
            inspectHostProcessFn: () => ({ found: true, hasRemoteDebuggingFlag: true, explicitPort: 9444 }),
            discoverActivePortFn: () => ({ port: 9222, wsPath: '/devtools/browser/stale', filePath: '/stale' }),
            fetchBrowserVersionFn: async (port) => ({
                Browser: 'Antigravity/2.34 Electron/35',
                webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/live`,
            }),
            fetchTargetsFn: async () => targets.map((t) => ({ ...t, webSocketDebuggerUrl: t.webSocketDebuggerUrl.replace(':9222/', ':9444/') })),
        });
        expect(connected.state).toBe('connected');
        expect(connected.diagnosticCode).toBe('connected');
        expect(connected.discoveredPort).toBe(9444);
        expect(connected.targetTitle).toBe('My Workspace - Antigravity');

        const fixedPortProbe = {
            composerEnabled: true,
            topBarEnabled: false,
            inspectHostProcessFn: () => ({ found: true, hasRemoteDebuggingFlag: true, explicitPort: 9444 }),
            fetchTargetsFn: async () => targets,
        };
        expect((await probeCdpAvailability({
            ...fixedPortProbe, fetchBrowserVersionFn: async () => null,
        })).diagnosticCode).toBe('port_unreachable');
        expect((await probeCdpAvailability({
            ...fixedPortProbe, fetchBrowserVersionFn: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9444/devtools/browser/live' }),
        })).diagnosticCode).toBe('no_hub_target');

        // 4. Recycled port with mismatched wsPath fails closed
        const mismatched = await probeCdpAvailability({
            composerEnabled: true,
            topBarEnabled: false,
            discoverActivePortFn: () => ({ port: 9222, wsPath: '/devtools/browser/expected', filePath: '/f' }),
            fetchBrowserVersionFn: async () => ({
                Browser: 'Chrome/130',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/different',
            }),
            fetchTargetsFn: async () => targets,
        });
        expect(mismatched.state).toBe('cdp_unavailable');
        expect(mismatched.diagnosticCode).toBe('no_hub_target');
    });

    it('enforces architecture boundaries: ZERO vscode imports in src/core/* & cdp-discovery.ts, and ZERO overlay/injector imports in cdp-discovery.ts', () => {
        const importOrRequireVscode = /(?:^|\n)\s*(?:import\b[^\n]*\bfrom\s+['"]vscode['"]|import\s+['"]vscode['"])|require\s*\(\s*['"]vscode['"]\s*\)/;
        const importOrRequireOverlay = /(?:^|\n)\s*(?:import\b[^\n]*\bfrom\s+['"][^'"]*(?:cdp-overlay-assets|cdp-injector)['"]|import\s+['"][^'"]*(?:cdp-overlay-assets|cdp-injector)['"])|require\s*\(\s*['"][^'"]*(?:cdp-overlay-assets|cdp-injector)['"]\s*\)/;

        const coreDir = path.resolve(__dirname, '../src/core');
        for (const file of fs.readdirSync(coreDir).filter((f) => f.endsWith('.ts'))) {
            const content = fs.readFileSync(path.join(coreDir, file), 'utf8');
            expect(content, `src/core/${file} must not import vscode`).not.toMatch(importOrRequireVscode);
        }

        const discoverySrc = fs.readFileSync(path.resolve(__dirname, '../src/app/cdp-discovery.ts'), 'utf8');
        expect(discoverySrc).not.toMatch(importOrRequireVscode);
        expect(discoverySrc).not.toMatch(importOrRequireOverlay);

        // Also check compiled JS output when present to verify runtime module graph
        const compiledDiscovery = path.resolve(__dirname, '../out/app/cdp-discovery.js');
        if (fs.existsSync(compiledDiscovery)) {
            const js = fs.readFileSync(compiledDiscovery, 'utf8');
            expect(js).not.toMatch(/require\s*\(\s*['"]vscode['"]\s*\)/);
            expect(js).not.toMatch(/require\s*\(\s*['"][^'"]*(?:cdp-overlay-assets|cdp-injector)['"]\s*\)/);
        }
    });

    it('covers missing_port_file, port_unreachable, and manual probeEvenWhenDisabled paths', async () => {
        const missing = await probeCdpAvailability({
            composerEnabled: true,
            topBarEnabled: false,
            discoverActivePortFn: () => null,
        });
        expect(missing.state).toBe('cdp_unavailable');
        expect(missing.diagnosticCode).toBe('missing_port_file');

        const unreachable = await probeCdpAvailability({
            composerEnabled: false,
            topBarEnabled: false,
            probeEvenWhenDisabled: true,
            discoverActivePortFn: () => ({ port: 9222, wsPath: '/devtools/browser/live', filePath: '/f' }),
            fetchBrowserVersionFn: async () => ({
                Browser: 'Chrome/130',
                webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/live',
            }),
            fetchTargetsFn: async () => { throw new Error('ECONNREFUSED'); },
        });
        expect(unreachable.state).toBe('cdp_unavailable');
        expect(unreachable.diagnosticCode).toBe('port_unreachable');
        expect(unreachable.errorMessage).toContain('ECONNREFUSED');
    });
});

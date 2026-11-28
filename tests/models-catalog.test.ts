// Consolidated Domain Suite: Model Catalog, Registry & Family Specs
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    getContextLimit,
    getModelBaseName,
    getModelDisplayName,
    getModelSpecs,
    getQuotaPoolKey,
    guessContextLimitSpec,
    type ModelConfig,
    type ModelSpec,
    normalizeModelDisplayName,
    registerResponseModelAlias,
    resolveModelId,
    setAvailableImageModelIds,
    setShowModelShortId,
    updateModelDisplayNames,
    updateModelSpec,
} from '../src/models';
import {
    calculateCosts,
    costFromTokens,
    DEFAULT_PRICING,
    findPricing,
    findPricingForDate,
    findPricingWithCustom,
    type ModelPricing,
} from '../src/pricing-store';
import { type Language, setLanguageToState, tBiHtml } from '../src/i18n';
import { buildModelInfoGrid, buildModelsTabContent } from '../src/webview-models-tab';
import type { StateBucket } from '../src/durable-state';
import { parseGMEntry } from '../src/gm/parser';
import { getModelDNAKey, type PersistedModelDNA, restoreModelDNAState, serializeModelDNAState } from '../src/model-dna-store';
import { DailyLedger } from '../src/daily-ledger';
import { DailyStore, type DailyStoreState } from '../src/daily-store';
import type { GMSummary } from '../src/gm-tracker';
import { buildGMSummaryFromLedger } from '../src/daily-archival';
import { expandModelIdsToPool, groupModelIdsByResetPool } from '../src/pool-utils';
import { selectQuotaRows } from '../src/tooltip-budget';
import { groupModelQuotas } from '../src/model-quota';
import { buildModelQuotaGrid } from '../src/webview-profile-tab';

describe('[models-registry]', () => {
    describe('guessContextLimitSpec placeholder collision guard', () => {
        it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
            'treats prototype member %s as an unknown external model identifier', identifier => {
                expect(resolveModelId(identifier)).toBeUndefined();
                expect(getModelDisplayName(identifier)).toBe(identifier);
                expect(getModelBaseName(identifier)).toBe(identifier);
                expect(getQuotaPoolKey(identifier, 'fixture-reset')).toBe('fixture-reset');
                expect(getContextLimit(identifier)).toBe(159000);
                expect(findPricing(identifier)).toBeNull();
            },
        );
        it('maps Gemini 3.6 Flash placeholders to the 256K flash profile, not the m26 Claude branch', () => {
            // Both the current IDs (M71/M72/M73) and the pre-renumber IDs (M264/M265/M266, still present
            // in archived data) must land on the same Flash profile.
            for (const id of [
                'MODEL_PLACEHOLDER_M71', 'MODEL_PLACEHOLDER_M72', 'MODEL_PLACEHOLDER_M73',
                'MODEL_PLACEHOLDER_M264', 'MODEL_PLACEHOLDER_M265', 'MODEL_PLACEHOLDER_M266',
            ]) {
                const spec = guessContextLimitSpec(id);
                expect(spec.cpLimit).toBe(256000);
                expect(spec.cpThreshold).toBe(140000);
                expect(spec.supportsThinking).toBe(true);
            }
        });

        it('maps Gemini 3.7 Flash placeholders (M298/M299/M300) to the 256K flash profile', () => {
            for (const id of ['MODEL_PLACEHOLDER_M298', 'MODEL_PLACEHOLDER_M299', 'MODEL_PLACEHOLDER_M300']) {
                const spec = guessContextLimitSpec(id);
                expect(spec.cpLimit).toBe(256000);
                expect(spec.cpThreshold).toBe(140000);
                expect(spec.maxTokens).toBe(1048576);
                expect(spec.supportsThinking).toBe(true);
            }
        });

        it('maps current Gemini 3.8 Flash picker tiers to the October 256K/50K profile', () => {
            for (const id of ['MODEL_PLACEHOLDER_M318', 'MODEL_PLACEHOLDER_M319', 'MODEL_PLACEHOLDER_M320']) {
                const spec = guessContextLimitSpec(id);
                expect(spec.cpLimit).toBe(256000);
                expect(spec.cpThreshold).toBe(50000);
                expect(spec.maxTokens).toBe(1048576);
                expect(spec.supportsThinking).toBe(true);
            }
        });

        it('keeps Claude placeholders on the premium thinking profile', () => {
            for (const id of ['MODEL_PLACEHOLDER_M26', 'MODEL_PLACEHOLDER_M35']) {
                const spec = guessContextLimitSpec(id);
                expect(spec.cpLimit).toBe(160000);
                expect(spec.supportsThinking).toBe(true);
            }
        });

        it('does not let an unknown placeholder substring-collide into the Claude branch', () => {
            // Old substring logic: 'model_placeholder_m350'.includes('m35') wrongly hit Claude (160K thinking).
            const spec = guessContextLimitSpec('MODEL_PLACEHOLDER_M350');
            expect(spec.supportsThinking).toBe(false);
            expect(spec.cpLimit).toBe(0);
        });

        it('does not let an unknown placeholder substring-collide into the new Flash numbers', () => {
            // M298/M299/M300 and M71/M72/M73 are matched by EXACT M-number. A future unrelated model
            // whose number merely *contains* one of them (M2980, M710) must NOT inherit the Flash profile.
            for (const id of ['MODEL_PLACEHOLDER_M2980', 'MODEL_PLACEHOLDER_M3180', 'MODEL_PLACEHOLDER_M710', 'MODEL_PLACEHOLDER_M7']) {
                const spec = guessContextLimitSpec(id);
                expect(spec.cpLimit).toBe(0);
                expect(spec.supportsThinking).toBe(false);
            }
        });

        it('routes 3.5 flash placeholders (M84/M20/M187) to the 256K flash profile', () => {
            for (const id of ['MODEL_PLACEHOLDER_M84', 'MODEL_PLACEHOLDER_M20', 'MODEL_PLACEHOLDER_M187']) {
                expect(guessContextLimitSpec(id).cpLimit).toBe(256000);
            }
        });

        it('uses generation-specific compression triggers for catalog model IDs', () => {
            for (const name of ['gemini-3.6-flash-high', 'gemini-3.7-flash-high', 'gemini-3.8-flash-high']) {
                const spec = guessContextLimitSpec(name);
                expect(spec.cpLimit).toBe(256000);
                expect(spec.cpThreshold).toBe(name === 'gemini-3.8-flash-high' ? 50000 : 140000);
                expect(spec.supportsThinking).toBe(true);
            }
        });

        // Anti-drift guard. The failure mode this pins is the one that actually shipped twice: a new or
        // renumbered model gets added to the spec table, but its M-number is forgotten in the exact-match
        // set inside guessContextLimitSpec — so it silently falls through to {0,0,0} and the UI shows a
        // permanent "calculating threshold…" shimmer. Every registered spec must be recognised.
        it('every registered model spec is recognised by guessContextLimitSpec (no {0,0,0} fallthrough)', () => {
            for (const spec of getModelSpecs()) {
                if (spec.isImageGeneration) { continue; } // Image tools do not have a chat compression limit.
                const guessed = guessContextLimitSpec(spec.placeholderId);
                expect(
                    guessed.cpLimit,
                    `${spec.placeholderId} (${spec.displayName}) is registered but unknown to guessContextLimitSpec`,
                ).toBeGreaterThan(0);
            }
        });

        // The other half of the anti-drift guard. A patch can update two of the three tables a model
        // lives in and still go fully green, while the status bar reports one window and the Models tab
        // reports another. The registry's own convention is that the static fallback sits exactly 1,000
        // below the spec's real limit, so that a user can tell a fallback from a live capture at a glance
        // — which makes it a checkable invariant across every registered model.
        it('every registered spec has a static fallback exactly 1,000 below its cpLimit', () => {
            for (const spec of getModelSpecs()) {
                if (spec.isImageGeneration) {
                    expect(getContextLimit(spec.placeholderId)).toBe(spec.maxTokens);
                    continue;
                }
                const fallback = getContextLimit(spec.placeholderId);
                expect(
                    fallback,
                    `${spec.placeholderId} (${spec.displayName}): static fallback ${fallback} does not sit 1K below spec cpLimit ${spec.cpLimit}`,
                ).toBe(spec.cpLimit - 1000);
            }
        });

        // Same idea, one layer down: the raw catalog name and its placeholder must agree. A patch that
        // registers only one of the two forms produces a status bar and a models panel that disagree
        // about the same model.
        it('every registered spec agrees with its own catalog model_id on the context limit', () => {
            for (const spec of getModelSpecs()) {
                if (!spec.modelId || spec.modelId.includes('UNSPECIFIED')) { continue; }
                // A retired spec can share its catalog name with the active model that took the identity
                // over (M133 and M84 are both 'gemini-3-flash-agent'). The name is meant to resolve to
                // the ACTIVE one, so only assert agreement for specs that still own their own name.
                if (resolveModelId(spec.modelId) !== spec.placeholderId) { continue; }
                expect(
                    getContextLimit(spec.modelId),
                    `${spec.modelId} disagrees with ${spec.placeholderId}`,
                ).toBe(getContextLimit(spec.placeholderId));
            }
        });
    });


    describe('getModelSpecs ordering', () => {
        it('renders the coordinators, Gemini 4 families and Flash generations in order, with retired M133 last', () => {
            const ids = getModelSpecs().map(s => s.placeholderId);
            expect(ids).toEqual([
                'MODEL_PLACEHOLDER_M537',
                'MODEL_PLACEHOLDER_M667',
                'MODEL_PLACEHOLDER_M681',
                'MODEL_PLACEHOLDER_M669',
                'MODEL_PLACEHOLDER_M535',
                'MODEL_PLACEHOLDER_M532',
                'MODEL_PLACEHOLDER_M533',
                'MODEL_PLACEHOLDER_M534',
                'MODEL_PLACEHOLDER_M528',
                'MODEL_PLACEHOLDER_M525',
                'MODEL_PLACEHOLDER_M526',
                'MODEL_PLACEHOLDER_M527',
                'MODEL_PLACEHOLDER_M427',
                'MODEL_PLACEHOLDER_M437',
                'MODEL_PLACEHOLDER_M438',
                'MODEL_PLACEHOLDER_M417',
                'MODEL_PLACEHOLDER_M418',
                'MODEL_PLACEHOLDER_M419',
                'MODEL_PLACEHOLDER_M318',
                'MODEL_PLACEHOLDER_M319',
                'MODEL_PLACEHOLDER_M320',
                'MODEL_PLACEHOLDER_M298',
                'MODEL_PLACEHOLDER_M299',
                'MODEL_PLACEHOLDER_M300',
                'MODEL_PLACEHOLDER_M71',
                'MODEL_PLACEHOLDER_M72',
                'MODEL_PLACEHOLDER_M73',
                'MODEL_PLACEHOLDER_M84',
                'MODEL_PLACEHOLDER_M20',
                'MODEL_PLACEHOLDER_M187',
                'MODEL_UNSPECIFIED',
                'MODEL_PLACEHOLDER_M16',
                'MODEL_PLACEHOLDER_M36',
                'MODEL_PLACEHOLDER_M400',
                'MODEL_PLACEHOLDER_M401',
                'MODEL_PLACEHOLDER_M402',
                'MODEL_PLACEHOLDER_M403',
                'MODEL_PLACEHOLDER_M404',
                'MODEL_PLACEHOLDER_M405',
                'MODEL_PLACEHOLDER_M35',
                'MODEL_PLACEHOLDER_M26',
                'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
                'MODEL_PLACEHOLDER_M21',
                'MODEL_PLACEHOLDER_M133',
            ]);
        });
    });


    describe('model identity takeover + 3.6 pricing', () => {
        it('resolves gemini-3-flash-agent to M84 (identity takeover from M133)', () => {
            expect(resolveModelId('gemini-3-flash-agent')).toBe('MODEL_PLACEHOLDER_M84');
        });

        it('prices the Gemini 3.6 Flash family with bounded promo (0.75 / 3.75) and standard (1.50 / 7.50) rates', () => {
            const promoPricing = findPricingForDate('gemini-3.6-flash-high', {}, '2026-11-22T00:00:00Z');
            expect(promoPricing).not.toBeNull();
            expect(promoPricing?.input).toBe(0.75);
            expect(promoPricing?.output).toBe(3.75);
            const standardPricing = findPricingForDate('gemini-3.6-flash-high', {}, '2027-01-01T00:00:00Z');
            expect(standardPricing).not.toBeNull();
            expect(standardPricing?.input).toBe(1.5);
            expect(standardPricing?.output).toBe(7.5);
        });
    });


    describe('adversarial round1 regression pins (W1/W2/I1)', () => {
        // I1: reverse label lookup must land on active M84, not retired M133/M132.
        it('resolves the "Gemini 3.5 Flash (High)" label to active M84, not retired M133', () => {
            expect(resolveModelId('Gemini 3.5 Flash (High)')).toBe('MODEL_PLACEHOLDER_M84');
        });

        // W2: raw catalog name must agree with its M18 placeholder (127K), not the flash-keyword 255K.
        // Live probe 2026-08-14 puts gemini-3-flash at checkpointer 128,000 — the 159K fallback the
        // registry used to carry predated the platform's own value.
        it('getContextLimit("gemini-3-flash") agrees with its M18 placeholder (127K), not flash-guess 255K', () => {
            expect(getContextLimit('gemini-3-flash')).toBe(127_000);
            expect(getContextLimit('gemini-3-flash')).toBe(getContextLimit('MODEL_PLACEHOLDER_M18'));
        });

        // getModelSpecs() writes displayName back onto the shared spec object. getModelDisplayName()
        // falls back to the raw key for anything it cannot resolve, so an unresolvable placeholder used
        // to permanently clobber its own spec's name with the placeholder string — and calling
        // getModelSpecs() twice would then return a spec labelled "MODEL_UNSPECIFIED".
        it('getModelSpecs does not overwrite a spec name with its own raw placeholder key', () => {
            getModelSpecs();
            const spec = getModelSpecs().find(s => s.placeholderId === 'MODEL_UNSPECIFIED');
            expect(spec?.displayName).toBe('Gemini 3.5 Flash (Low)');
            expect(spec?.displayName).not.toBe('MODEL_UNSPECIFIED');
        });

        // W1: MODEL_UNSPECIFIED status-bar limit and the models-panel spec share one source (-1K relation).
        it('MODEL_UNSPECIFIED context limit is consistent with its active spec cpLimit', () => {
            const spec = getModelSpecs().find(s => s.placeholderId === 'MODEL_UNSPECIFIED');
            expect(spec?.cpLimit).toBe(256_000);
            expect(getContextLimit('MODEL_UNSPECIFIED')).toBe(255_000);
            expect(getContextLimit('MODEL_UNSPECIFIED')).toBe(spec!.cpLimit - 1000);
        });

        // W2: flash guess is generation-aware — pre-3.5 stays 128K, 3.5/3.6+ doubles to 256K.
        it('guessContextLimitSpec is generation-aware for flash names', () => {
            expect(guessContextLimitSpec('gemini-2.5-flash').cpLimit).toBe(128_000);
            expect(guessContextLimitSpec('gemini-3.6-flash-anything').cpLimit).toBe(256_000);
            expect(guessContextLimitSpec('gemini-3.7-flash-anything').cpLimit).toBe(256_000);
            expect(guessContextLimitSpec('gemini-3.8-flash-anything').cpLimit).toBe(256_000);
        });

        it('reads the generation out of underscore-style platform IDs, not just dotted names', () => {
            // The platform spells its constant-style IDs with underscores. Matching only the dotted form
            // put every 2.5-series shadow model on the 256K / thinking profile; live says 128K / 50K / no.
            const lite = guessContextLimitSpec('MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE');
            expect(lite.cpLimit).toBe(128_000);
            expect(lite.cpThreshold).toBe(50_000);
            expect(lite.supportsThinking).toBe(false);
            expect(guessContextLimitSpec('MODEL_GOOGLE_GEMINI_2_5_FLASH').cpLimit).toBe(128_000);
            expect(guessContextLimitSpec('MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING').cpLimit).toBe(128_000);
        });
    });


    describe('Gemini 3.8 Flash registration (two live Antigravity IDE LS probes, 2026-09-05)', () => {
        const pickerIds = ['MODEL_PLACEHOLDER_M318', 'MODEL_PLACEHOLDER_M319', 'MODEL_PLACEHOLDER_M320'];

        it('resolves all three picker model_ids plus the catalog-only tiered router', () => {
            expect(resolveModelId('gemini-3.8-flash-high')).toBe('MODEL_PLACEHOLDER_M318');
            expect(resolveModelId('gemini-3.8-flash-medium')).toBe('MODEL_PLACEHOLDER_M319');
            expect(resolveModelId('gemini-3.8-flash-low')).toBe('MODEL_PLACEHOLDER_M320');
            expect(resolveModelId('gemini-3.8-flash-tiered')).toBe('MODEL_PLACEHOLDER_M322');
        });

        it('names all picker tiers and the catalog-only tiered router before live labels load', () => {
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M318')).toBe('Gemini 3.8 Flash (High)');
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M319')).toBe('Gemini 3.8 Flash (Medium)');
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M320')).toBe('Gemini 3.8 Flash (Low)');
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M322')).toBe('Gemini 3.8 Flash (Tiered)');
        });

        it('normalizes localized Chinese tier labels to their canonical identities', () => {
            expect(resolveModelId('Gemini 3.8 Flash (高)')).toBe('MODEL_PLACEHOLDER_M318');
            expect(resolveModelId('Gemini 3.8 Flash (中)')).toBe('MODEL_PLACEHOLDER_M319');
            expect(resolveModelId('Gemini 3.8 Flash (低)')).toBe('MODEL_PLACEHOLDER_M320');
            expect(getModelBaseName('Gemini 3.8 Flash (高)')).toBe('Gemini 3.8 Flash (High)');
        });

        it('gives all four identifiers the deliberate 255K static fallback and exact 256K live profile', () => {
            for (const id of [...pickerIds, 'MODEL_PLACEHOLDER_M322']) {
                expect(getContextLimit(id)).toBe(255_000);
                expect(guessContextLimitSpec(id)).toMatchObject({
                    cpLimit: 256_000,
                    cpThreshold: id === 'MODEL_PLACEHOLDER_M322' ? 140_000 : 50_000,
                    maxTokens: 1_048_576,
                    supportsThinking: true,
                });
            }
            expect(getContextLimit('gemini-3.8-flash-high')).toBe(getContextLimit('MODEL_PLACEHOLDER_M318'));
        });

        it('pools placeholder, catalog, English-label, and Chinese-label forms into the shared Gemini pool', () => {
            for (const value of [
                ...pickerIds,
                'MODEL_PLACEHOLDER_M322',
                'gemini-3.8-flash-high',
                'gemini-3.8-flash-tiered',
                'Gemini 3.8 Flash (High)',
                'Gemini 3.8 Flash (高)',
            ]) {
                expect(getQuotaPoolKey(value, 'different-reset-time')).toBe('gemini');
            }
        });

        it('prices all tiers at the official 2026 introductory rate without fuzzy fallthrough', () => {
            for (const value of ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low', 'MODEL_PLACEHOLDER_M318']) {
                expect(findPricing(value)).toMatchObject({ input: 0.75, output: 3.75, cacheRead: 0.075, thinking: 3.75 });
            }
            expect(findPricing('gemini-3.7-flash-high')?.output).toBe(3.75);
            expect(findPricingForDate('gemini-3.6-flash-high', {}, '2027-01-01T00:00:00Z')?.output).toBe(7.5);
        });

        it('carries the current effort levels without inventing a fixed thinking budget', () => {
            const byId = new Map(getModelSpecs().map(s => [s.placeholderId, s]));
            expect(byId.get('MODEL_PLACEHOLDER_M318')?.thinkingBudget).toBe(0);
            expect(byId.get('MODEL_PLACEHOLDER_M319')?.thinkingBudget).toBe(0);
            expect(byId.get('MODEL_PLACEHOLDER_M320')?.thinkingBudget).toBe(0);
            expect(pickerIds.map(id => byId.get(id)?.thinkingLevel)).toEqual([3, 2, 1]);
            for (const id of pickerIds) {
                expect(byId.get(id)).toMatchObject({
                    supportsThinking: true,
                    maxTokens: 1_048_576,
                    maxOutputTokens: 65_536,
                    cpLimit: 256_000,
                    cpThreshold: 50_000,
                });
            }
        });
    });


    describe('Gemini 3.7 Flash registration (live LS probe 2026-08-14)', () => {
        it('resolves all three 3.7 model_ids to their placeholders', () => {
            expect(resolveModelId('gemini-3.7-flash-high')).toBe('MODEL_PLACEHOLDER_M298');
            expect(resolveModelId('gemini-3.7-flash-medium')).toBe('MODEL_PLACEHOLDER_M299');
            expect(resolveModelId('gemini-3.7-flash-low')).toBe('MODEL_PLACEHOLDER_M300');
        });

        it('names all three 3.7 tiers', () => {
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M298')).toBe('Gemini 3.7 Flash (High)');
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M299')).toBe('Gemini 3.7 Flash (Medium)');
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M300')).toBe('Gemini 3.7 Flash (Low)');
        });

        it('gives all three 3.7 tiers the 256K static fallback (live 256,000 minus the deliberate 1K offset)', () => {
            for (const id of ['MODEL_PLACEHOLDER_M298', 'MODEL_PLACEHOLDER_M299', 'MODEL_PLACEHOLDER_M300']) {
                expect(getContextLimit(id)).toBe(255_000);
            }
            // The raw catalog name must agree with its placeholder — otherwise the status bar and the
            // models panel would disagree about the same model.
            expect(getContextLimit('gemini-3.7-flash-high')).toBe(getContextLimit('MODEL_PLACEHOLDER_M298'));
        });

        it('pools all three 3.7 tiers into the shared gemini quota pool', () => {
            for (const id of ['MODEL_PLACEHOLDER_M298', 'MODEL_PLACEHOLDER_M299', 'MODEL_PLACEHOLDER_M300']) {
                // A resetTime is passed deliberately: KNOWN_QUOTA_POOLS must win over the resetTime fallback,
                // otherwise each tier splits into its own phantom pool.
                expect(getQuotaPoolKey(id, '2026-08-13T23:31:25Z')).toBe('gemini');
            }
        });

        it('pools 3.7 by catalog name and display label too, not just by placeholder', () => {
            // KNOWN_QUOTA_POOLS is keyed by placeholder, but callers hold all three forms. Live reset
            // time is a poor key because it drifts between endpoints and over time (the same models read
            // 23:27:33 from one and 23:31:25 from another minutes apart on 2026-08-14), so an unnormalized
            // lookup silently splits one Gemini quota into several phantom pools.
            expect(getQuotaPoolKey('gemini-3.7-flash-high', '2026-08-13T23:31:25Z')).toBe('gemini');
            expect(getQuotaPoolKey('gemini-3.7-flash-low', '2026-08-13T23:27:33Z')).toBe('gemini');
            expect(getQuotaPoolKey('Gemini 3.7 Flash (High)', '2026-08-13T23:31:25Z')).toBe('gemini');
            expect(getQuotaPoolKey('Gemini 3.6 Flash (Medium)', '2026-08-13T22:00:00Z')).toBe('gemini');
            // A genuinely unknown model must still fall back to resetTime, not be swept into gemini.
            expect(getQuotaPoolKey('some-future-model', '2026-08-13T23:31:25Z')).toBe('2026-08-13T23:31:25Z');
        });

        it('prices the Gemini 3.7 Flash family at the introductory 0.75 / 3.75 rate', () => {
            const pricing = findPricing('gemini-3.7-flash-high');
            expect(pricing).not.toBeNull();
            expect(pricing?.input).toBe(0.75);
            expect(pricing?.output).toBe(3.75);
            // Guard against the fuzzy matcher silently falling through to a neighbouring Flash generation.
            expect(findPricing('gemini-3.7-flash-low')?.output).toBe(3.75);
            expect(findPricingForDate('gemini-3.6-flash-high', {}, '2027-01-01T00:00:00Z')?.output).toBe(7.5);
            expect(findPricing('gemini-3.5-flash-low')?.output).toBe(9);
        });

        it('carries the live thinking profile (High = dynamic sentinel -1, Medium 4000, Low 1000)', () => {
            const byId = new Map(getModelSpecs().map(s => [s.placeholderId, s]));
            expect(byId.get('MODEL_PLACEHOLDER_M298')?.thinkingBudget).toBe(-1);
            expect(byId.get('MODEL_PLACEHOLDER_M299')?.thinkingBudget).toBe(4000);
            expect(byId.get('MODEL_PLACEHOLDER_M300')?.thinkingBudget).toBe(1000);
            for (const id of ['MODEL_PLACEHOLDER_M298', 'MODEL_PLACEHOLDER_M299', 'MODEL_PLACEHOLDER_M300']) {
                expect(byId.get(id)?.supportsThinking).toBe(true);
                expect(byId.get(id)?.maxOutputTokens).toBe(65536);
            }
        });
    });


    describe('label table freshness', () => {
        it('an authoritative live update evicts identifiers the platform no longer reports', async () => {
            const { updateModelDisplayNames } = await import('../src/models');
            // Simulate what happens across a renumber: the extension seeds the table from configs read
            // off disk (which still name the OLD id), then a live fetch arrives naming the new one.
            // The reverse lookup returns the first non-retired insertion-order match, so a merge would
            // let the stale disk entry outrank the live one for the whole session — and the next
            // renumber will not have its old ids in RETIRED_PLACEHOLDER_IDS yet to save us.
            updateModelDisplayNames([
                { model: 'MODEL_PLACEHOLDER_M9001', label: 'Gemini 9.9 Flash (High)' } as never,
            ]);
            expect(resolveModelId('Gemini 9.9 Flash (High)')).toBe('MODEL_PLACEHOLDER_M9001');

            updateModelDisplayNames(
                [{ model: 'MODEL_PLACEHOLDER_M9002', label: 'Gemini 9.9 Flash (High)' } as never],
                { authoritative: true },
            );
            expect(resolveModelId('Gemini 9.9 Flash (High)')).toBe('MODEL_PLACEHOLDER_M9002');

            // Retired ids keep resolving — they live in the static table, which is never cleared.
            expect(resolveModelId('MODEL_PLACEHOLDER_M264')).toBe('MODEL_PLACEHOLDER_M264');
            // Restore the table so later tests see live labels rather than this fixture.
            updateModelDisplayNames([], { authoritative: true });
        });
    });


    describe('Gemini 3.6 Flash renumber M264/M265/M266 -> M71/M72/M73', () => {
        it('points the 3.6 model_id aliases at the ACTIVE placeholders', () => {
            expect(resolveModelId('gemini-3.6-flash-high')).toBe('MODEL_PLACEHOLDER_M71');
            expect(resolveModelId('gemini-3.6-flash-medium')).toBe('MODEL_PLACEHOLDER_M72');
            expect(resolveModelId('gemini-3.6-flash-low')).toBe('MODEL_PLACEHOLDER_M73');
        });

        it('resolves a 3.6 display label to the active ID, never the retired pre-renumber one', () => {
            expect(resolveModelId('Gemini 3.6 Flash (High)')).toBe('MODEL_PLACEHOLDER_M71');
            expect(resolveModelId('Gemini 3.6 Flash (Medium)')).toBe('MODEL_PLACEHOLDER_M72');
            expect(resolveModelId('Gemini 3.6 Flash (Low)')).toBe('MODEL_PLACEHOLDER_M73');
        });

        it('still reads archived data keyed by the retired pre-renumber IDs', () => {
            // Users upgrading from v1.16.14 have daily ledgers and archives keyed by M264/M265/M266.
            // Dropping those keys would render historical rows as a raw placeholder string with no limit.
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M264')).toBe('Gemini 3.6 Flash (High)');
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M265')).toBe('Gemini 3.6 Flash (Medium)');
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M266')).toBe('Gemini 3.6 Flash (Low)');
            expect(getContextLimit('MODEL_PLACEHOLDER_M264')).toBe(255_000);
        });

        it('merges old and new IDs onto one cost/aggregation row instead of splitting the model in two', () => {
            // getModelBaseName is the aggregation key used for cost merging. If the renumbered pair
            // disagreed here, one model would show up twice with its usage and cost split across rows.
            expect(getModelBaseName('MODEL_PLACEHOLDER_M264')).toBe(getModelBaseName('MODEL_PLACEHOLDER_M71'));
            expect(getModelBaseName('MODEL_PLACEHOLDER_M265')).toBe(getModelBaseName('MODEL_PLACEHOLDER_M72'));
            expect(getModelBaseName('MODEL_PLACEHOLDER_M266')).toBe(getModelBaseName('MODEL_PLACEHOLDER_M73'));
        });

        it('keeps both old and new IDs in the same gemini quota pool', () => {
            for (const id of [
                'MODEL_PLACEHOLDER_M71', 'MODEL_PLACEHOLDER_M72', 'MODEL_PLACEHOLDER_M73',
                'MODEL_PLACEHOLDER_M264', 'MODEL_PLACEHOLDER_M265', 'MODEL_PLACEHOLDER_M266',
            ]) {
                expect(getQuotaPoolKey(id, '2026-07-21T21:41:45Z')).toBe('gemini');
            }
        });

        it('prices old and new 3.6 IDs identically', () => {
            expect(findPricing('MODEL_PLACEHOLDER_M264')?.output)
                .toBe(findPricing('MODEL_PLACEHOLDER_M71')?.output);
        });
    });
});

describe('[model-info]', () => {
    const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

    const spec: ModelSpec = {
        modelId: 'claude-opus-5-5-medium', placeholderId: 'MODEL_PLACEHOLDER_M401',
        displayName: 'Claude Opus 5.5 (Medium)', apiProvider: 'ANTHROPIC_VERTEX',
        maxTokens: 1_000_000, maxOutputTokens: 128_000, cpLimit: 256_000,
        cpThreshold: 50_000, supportsThinking: true, thinkingBudget: 0,
    };


    beforeEach(() => {
        setAvailableImageModelIds([]);
        return setLanguageToState('en', state);
    });

    afterEach(() => {
        setAvailableImageModelIds([]);
        return setLanguageToState('both', state);
    });


    describe('model information rendering', () => {
        it('starts the catalog and individual models collapsed, with a stable key across sorting and locale changes', async () => {
            const next = { ...spec, placeholderId: 'MODEL_PLACEHOLDER_M402', displayName: 'Claude Opus 5.5 (High)' };
            for (const language of ['en', 'zh', 'both'] as const) {
                await setLanguageToState(language, state);
                for (const models of [[spec, next], [next, spec]]) {
                    const html = buildModelInfoGrid(models);
                    expect(html).toContain('<details id="model-specs-chat" class="spec-catalog">');
                    expect(html.match(/<details class="spec-card"[^>]*>/g)).toHaveLength(2);
                    expect(html).not.toMatch(/<details[^>]*\sopen[\s=>]/);
                    expect(html).toContain('data-state-key="model-spec-chat-MODEL_PLACEHOLDER_M401"');
                }
            }
        });

        it.each(['en', 'zh', 'both'] as Language[])('does not confuse unreported image thinking with unsupported capability in %s', async language => {
            await setLanguageToState(language, state);
            const html = buildModelInfoGrid([{ ...spec, isImageGeneration: true,
                thinkingCapabilityReported: false, supportsThinking: false, cpLimit: 0, cpThreshold: 0 }]);
            expect(html).toContain(language === 'zh' ? '宿主未上报' : 'Not reported by host');
            expect(html).not.toContain('<dd>Not supported</dd>');
            expect(html).not.toContain('<dd>不支持</dd>');
        });
        // The first locale render took 5.17s on a cold Windows CI runner. This checks
        // correctness, not startup latency; keep its budget separate from other tests.
        it.each([
            ['en', 'Effective Budget (Compaction Limit)', 'Checkpoint Threshold', 'Native Ceiling (Model Context)', 'Max Output', 'Adaptive'],
            ['zh', '自动压缩上限（有效预算）', '检查点阈值', '原生窗口上限', '最大输出', '自适应'],
            ['both', 'Effective Budget (Compaction Limit) / 自动压缩上限（有效预算）', 'Checkpoint Threshold / 检查点阈值', 'Native Ceiling (Model Context) / 原生窗口上限', 'Max Output / 最大输出', 'Adaptive / 自适应'],
        ] as const)('renders complete parameters in %s', async (language, limit, threshold, native, output, thinking) => {
            await setLanguageToState(language, state);
            const html = buildModelInfoGrid([{ ...spec, supportsAdaptiveThinking: true }]);
            const text = html.replace(/<[^>]+>/g, '');
            for (const value of [limit, threshold, native, output, thinking, '256,000', '50,000', '1,000,000', '128,000', 'Anthropic · Vertex', spec.modelId, 'M401']) {
                expect(text).toContain(value);
            }
            const expectedLabels: Array<[string, string, string]> = [
                ['compression-limit', tBiHtml('Effective Budget (Compaction Limit)', '自动压缩上限（有效预算）'), '256,000'],
                ['checkpoint-threshold', tBiHtml('Checkpoint Threshold', '检查点阈值'), '50,000'],
                ['native-context', tBiHtml('Native Ceiling (Model Context)', '原生窗口上限'), '1,000,000'],
                ['max-output', tBiHtml('Max Output', '最大输出'), '128,000'],
            ];
            for (const [metric, labelHtml, value] of expectedLabels) {
                const escaped = labelHtml.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                expect(html).toMatch(new RegExp(`data-metric="${metric}"[^>]*>\\s*<dt>${escaped}</dt>\\s*<dd>${value}</dd>`));
            }
            expect(html).toContain(tBiHtml('Adaptive', '自适应'));
            expect(html).not.toContain('压缩阈值');
            expect(html).not.toContain('Native context');
            expect(html).toContain(language === 'zh' ? '可能与公开 API 限额不同' : 'may differ from public API limits');
            expect(html).not.toContain('Budget: None');
        }, 15_000);

        it.each([0, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('does not claim an invalid %s token limit', (invalid) => {
            const html = buildModelInfoGrid([{ ...spec, cpLimit: invalid, cpThreshold: invalid, maxTokens: invalid, maxOutputTokens: invalid }]);
            expect(html.match(/<dd>Not available<\/dd>/g)).toHaveLength(4);
            expect(html).not.toMatch(/<dd>(NaN|Infinity|-1|0)<\/dd>/);
            expect(html).not.toContain('Not applicable');
        });

        it.each(['en', 'zh', 'both'] as Language[])('distinguishes image compression inapplicability from missing text limits in %s', async language => {
            await setLanguageToState(language, state);
            const imageSpec: ModelSpec = { ...spec, modelId: 'gemini-3.1-flash-image', placeholderId: 'MODEL_PLACEHOLDER_M21',
                displayName: 'Gemini 3.1 Flash Image', apiProvider: 'GOOGLE_GEMINI', isImageGeneration: true,
                maxTokens: 65_536, maxOutputTokens: 65_536, cpLimit: 0, cpThreshold: 0 };
            const html = buildModelInfoGrid([imageSpec], 'image');
            const notApplicableHtml = tBiHtml('Not applicable', '不适用');
            const notApplicableText = language === 'en' ? 'Not applicable' : language === 'zh' ? '不适用' : 'Not applicable / 不适用';
            expect(html.split(`<dd>${notApplicableHtml}</dd>`)).toHaveLength(3);
            expect(html.replace(/<[^>]+>/g, '')).toContain(notApplicableText);
            expect(html.match(/<dd>65,536<\/dd>/g)).toHaveLength(2);
            expect(html).toContain('data-model-kind="image"');
            expect(html).toContain(language === 'zh' ? '图片生成模型' : 'Image generation models');
            expect(html).toContain(language === 'zh' ? '可能与公开 API 不同' : 'may differ from public API limits');
            const textHtml = buildModelInfoGrid([{ ...spec, cpLimit: 0, cpThreshold: 0 }]);
            expect(textHtml).not.toContain(notApplicableHtml);
            expect(textHtml).toContain(tBiHtml('Not available', '暂无数据'));
        });

        it.each([
            [false, 1024, 'Not supported'], [true, -1, 'Dynamic'],
            [true, 8192, 'Budget: 8,192'], [true, 0, 'Supported · Budget unspecified'],
            [true, NaN, 'Supported · Budget unspecified'], [true, -2, 'Supported · Budget unspecified'],
        ])('distinguishes thinking support %s and budget %s', (supportsThinking, thinkingBudget, expected) => {
            expect(buildModelInfoGrid([{ ...spec, supportsThinking, thinkingBudget }])).toContain(expected);
        });

        it('escapes every model metadata field and does not create executable HTML', () => {
            const injected = '\"><img src=x onerror=alert(1)>';
            const html = buildModelInfoGrid([{
                ...spec, displayName: injected, modelId: injected, placeholderId: injected,
                apiProvider: injected,
            }]);
            expect(html).not.toContain('<img');
            expect(html).toContain('&lt;img');
            expect(html).not.toContain('aria-label=""><');
        });

        it('labels an absent provider without inventing a provider or duplicating an ID', () => {
            const html = buildModelInfoGrid([{ ...spec, apiProvider: '', modelId: spec.placeholderId }]);
            expect(html).toContain('Provider not available');
            expect(html).not.toContain('class="spec-short-id"');
        });

        it('retains complete long names and provider identifiers for narrow layouts', () => {
            const label = 'A very long model name '.repeat(12);
            const provider = 'NEW_UNKNOWN_PROVIDER';
            const html = buildModelInfoGrid([{ ...spec, displayName: label, apiProvider: provider }]);
            expect(html).toContain(label);
            expect(html).toContain('NEW UNKNOWN PROVIDER');
        });
    });


    function config(model: string): ModelConfig {
        const registered = getModelSpecs().find(s => s.placeholderId === model);
        return { model, label: registered?.displayName || model } as ModelConfig;
    }


    describe('account-specific model availability', () => {
        it.each(['en', 'zh', 'both'] as Language[])('keeps the live chat picker separate from the authoritative image catalog in %s', async language => {
            await setLanguageToState(language, state);
            const chatIds = ['M417', 'M418', 'M419', 'M318', 'M319', 'M320', 'M400', 'M401', 'M402', 'M403', 'M404', 'M405']
                .map(id => `MODEL_PLACEHOLDER_${id}`).concat('MODEL_OPENAI_GPT_OSS_120B_MEDIUM');
            const chatConfigs = chatIds.map(id => ({ ...config(id), supportsImages: true }));
            const initial = buildModelsTabContent(null, chatConfigs);
            expect(initial.match(/class="spec-card"/g)).toHaveLength(13);
            expect(initial).not.toContain('data-model-kind="image"');

            setAvailableImageModelIds(['gemini-3.1-flash-image']);
            const available = buildModelsTabContent(null, chatConfigs);
            expect(available.match(/class="spec-card"/g)).toHaveLength(14);
            const [chatSection, imageSection] = available.split('data-model-kind="image"');
            expect(chatSection.match(/class="spec-card"/g)).toHaveLength(13);
            expect(chatSection).not.toContain('data-model-id="MODEL_PLACEHOLDER_M21"');
            expect(imageSection.match(/class="spec-card"/g)).toHaveLength(1);
            expect(imageSection).toContain('data-model-id="MODEL_PLACEHOLDER_M21"');
            expect(imageSection).toContain('gemini-3.1-flash-image');
            expect(imageSection).toContain(language === 'zh' ? '不适用' : 'Not applicable');

            // A stale static image spec must not survive an authoritative empty catalog.
            setAvailableImageModelIds([]);
            const cleared = buildModelsTabContent(null, chatConfigs);
            expect(cleared.match(/class="spec-card"/g)).toHaveLength(13);
            expect(cleared).not.toContain('data-model-kind="image"');
        });

        it('does not duplicate an image model when it also appears in the picker', () => {
            setAvailableImageModelIds(['gemini-3.1-flash-image']);
            const html = buildModelsTabContent(null, [config('MODEL_PLACEHOLDER_M417'), config('MODEL_PLACEHOLDER_M21')]);
            expect(html.match(/data-model-id="MODEL_PLACEHOLDER_M21"/g)).toHaveLength(1);
            expect(html.match(/class="spec-card"/g)).toHaveLength(2);
        });

        it.each(['en', 'zh', 'both'] as Language[])('follows each live picker in %s without stale third-party cards', async language => {
            await setLanguageToState(language, state);
            const paid = buildModelsTabContent(null, ['M400', 'M401', 'M402', 'M403', 'M404', 'M405'].map(id => config(`MODEL_PLACEHOLDER_${id}`)));
            expect(paid.match(/class="spec-card"/g)).toHaveLength(6);
            expect(paid).not.toContain('Claude Opus 4.6');

            const free = buildModelsTabContent(null, ['M26', 'M35', 'M318'].map(id => config(`MODEL_PLACEHOLDER_${id}`)));
            expect(free).toContain('Claude Opus 4.6');
            expect(free).toContain('Claude Sonnet 4.6');
            expect(free).not.toContain('Claude Opus 5.5');

            const geminiOnly = buildModelsTabContent(null, [config('MODEL_PLACEHOLDER_M318')]);
            expect(geminiOnly).toContain('Gemini 3.8 Flash');
            expect(geminiOnly).not.toContain('Claude');
            expect(geminiOnly).not.toContain('GPT-OSS');
        });

        it('shows a translated empty state when the account has no available models', () => {
            const html = buildModelsTabContent(null, []);
            expect(html).not.toContain('class="spec-card"');
            expect(html).toContain('Model Info');
        });
    });
});

describe('[claude-55]', () => {
    // Metadata captured from the installed Antigravity IDE's read-only LS endpoints
    // on 2026-10-03. No generation, credentials, quota values, or user data in fixtures.
    const CLAUDE_55 = [
        { id: 'M400', family: 'Opus', tier: 'Low', zh: '低', effort: 1 },
        { id: 'M401', family: 'Opus', tier: 'Medium', zh: '中', effort: 2 },
        { id: 'M402', family: 'Opus', tier: 'High', zh: '高', effort: 3 },
        { id: 'M403', family: 'Sonnet', tier: 'Low', zh: '低', effort: 1 },
        { id: 'M404', family: 'Sonnet', tier: 'Medium', zh: '中', effort: 2 },
        { id: 'M405', family: 'Sonnet', tier: 'High', zh: '高', effort: 3 },
    ] as const;


    const customPrice: ModelPricing = { input: 11, output: 22, cacheRead: 0.11, cacheWrite: 13.75, thinking: 22 };


    afterEach(() => {
        setShowModelShortId(false);
        updateModelDisplayNames([], { authoritative: true });
    });


    describe('Claude 5.5 registry and cold start', () => {
        it.each(CLAUDE_55)('$id preserves the exact tier across model identifiers and languages', model => {
            const id = `MODEL_PLACEHOLDER_${model.id}`;
            const label = `Claude ${model.family} 5.5 (${model.tier})`;
            const catalogId = `claude-${model.family.toLowerCase()}-5-5-${model.tier.toLowerCase()}`;
            const aliases = [
                id, catalogId, catalogId.replace('5-5', '5.5'), catalogId.toUpperCase(),
                label, label.replace(model.tier, model.zh), label.replace(`(${model.tier})`, `（${model.zh}）`),
                `  ${label} (${model.id})  `, `Claude ${model.family} 5.5 ${model.tier}`,
            ];
            expect(getModelDisplayName(id)).toBe(label);
            for (const alias of aliases) {
                expect(resolveModelId(alias), alias).toBe(id);
                expect(getModelBaseName(alias), alias).toBe(label);
                expect(getContextLimit(alias), alias).toBe(255_000);
                expect(getQuotaPoolKey(alias, 'different-reset'), alias).toBe('premium');
            }
            expect(guessContextLimitSpec(id)).toEqual({ cpLimit: 256_000, cpThreshold: 50_000, maxTokens: 1_000_000, supportsThinking: true });
            expect(guessContextLimitSpec(catalogId)).toEqual(guessContextLimitSpec(id));
            expect(getModelSpecs().find(s => s.placeholderId === id)).toMatchObject({
                modelId: catalogId, displayName: label, apiProvider: 'ANTHROPIC_VERTEX',
                maxTokens: 1_000_000, maxOutputTokens: 128_000,
                cpLimit: 256_000, cpThreshold: 50_000, thinkingBudget: 0,
                supportsThinking: true, supportsAdaptiveThinking: true, thinkingLevel: model.effort,
            });
        });

        it('defaults bare human labels to Medium without assigning a tier to a shared response family', () => {
            expect(resolveModelId('Claude Opus 5.5')).toBe('MODEL_PLACEHOLDER_M401');
            expect(resolveModelId('Claude Sonnet 5.5')).toBe('MODEL_PLACEHOLDER_M404');
            for (const family of ['opus', 'sonnet']) {
                const bare = `claude-${family}-5-5`;
                registerResponseModelAlias(bare, 'MODEL_PLACEHOLDER_M402');
                expect(resolveModelId(bare)).toBeUndefined();
                expect(getQuotaPoolKey(bare, 'different-reset')).toBe('premium');
                expect(getContextLimit(bare)).toBe(255_000);
            }
        });

        it('keeps 4.6 identities/specs for accounts whose live picker still offers them', () => {
            for (const [id, label] of [
                ['MODEL_PLACEHOLDER_M26', 'Claude Opus 4.6 (Thinking)'],
                ['MODEL_PLACEHOLDER_M35', 'Claude Sonnet 4.6 (Thinking)'],
            ]) {
                expect(resolveModelId(label)).toBe(id);
                expect(getContextLimit(id)).toBe(159_000);
                expect(getModelSpecs().find(s => s.placeholderId === id)).toMatchObject({ cpLimit: 160_000, maxTokens: 250_000 });
            }
            for (const id of ['MODEL_PLACEHOLDER_M4000', 'MODEL_PLACEHOLDER_M4050']) {
                expect(guessContextLimitSpec(id).cpLimit).toBe(0);
            }
        });

        it('keeps diagnostic suffixes out of stable aggregation keys', () => {
            setShowModelShortId(true);
            expect(normalizeModelDisplayName('MODEL_PLACEHOLDER_M402')).toBe('Claude Opus 5.5 (High) (M402)');
            expect(getModelBaseName('Claude Opus 5.5 (High) (M402)')).toBe('Claude Opus 5.5 (High)');
        });
    });


    describe('Claude 5.5 pricing boundaries', () => {
        it.each(CLAUDE_55)('$id resolves the exact official family price', model => {
            const expected = DEFAULT_PRICING[`claude-${model.family.toLowerCase()}-5-5`];
            for (const key of [
                `MODEL_PLACEHOLDER_${model.id}`,
                `claude-${model.family.toLowerCase()}-5-5-${model.tier.toLowerCase()}`,
                `Claude ${model.family} 5.5 (${model.zh}) (${model.id})`,
            ]) {
                expect(findPricing(key), key).toBe(expected);
            }
            expect(expected).toEqual(model.family === 'Opus'
                ? { input: 4, output: 20, cacheRead: 0.20, cacheWrite: 5, thinking: 20 }
                : { input: 2, output: 10, cacheRead: 0.10, cacheWrite: 2.50, thinking: 10 });
        });

        it('supports xhigh variant suffix on Claude 5.5 without leaking malformed names', () => {
            expect(findPricing('claude-opus-5-5-xhigh')).toBe(DEFAULT_PRICING['claude-opus-5-5']);
            expect(findPricing('claude-sonnet-5-5-xhigh')).toBe(DEFAULT_PRICING['claude-sonnet-5-5']);
            expect(findPricing('claude-opus-5-5-xhighest')).toBeNull();
            expect(findPricing('claude-sonnet-5-5-extra-garbage')).toBeNull();
        });

        it('does not price a future version or partial family from nearby rows', () => {
            const table = { ...DEFAULT_PRICING, 'claude-sonnet-5': customPrice };
            for (const key of ['claude-opus-5-6', 'claude-opus-5-50', 'claude-opus-5', 'claude-opus', 'Claude Opus 5.6 (High)']) {
                expect(findPricing(key, table), key).toBeNull();
            }
            expect(findPricing('claude-sonnet-5-6-high', table)).toBeNull();
            expect(findPricing('claude-opus-4-6')?.input).toBe(5);
            expect(findPricing('claude-sonnet-4-6')?.input).toBe(3);
        });

        it('isolates custom effort prices, including localized persisted keys', () => {
            const custom = { 'Claude Sonnet 5.5 (低) (M403)': customPrice };
            expect(findPricingWithCustom('claude-sonnet-5-5-low', custom)).toBe(customPrice);
            expect(findPricingWithCustom('MODEL_PLACEHOLDER_M403', custom)).toBe(customPrice);
            expect(findPricingWithCustom('claude-sonnet-5-5-high', custom)).toBe(DEFAULT_PRICING['claude-sonnet-5-5']);
            expect(findPricingWithCustom('claude-sonnet-5-5', custom)).toBe(DEFAULT_PRICING['claude-sonnet-5-5']);
            expect(findPricingWithCustom('claude-sonnet-5-5-high', { 'claude-sonnet-5-5': customPrice })).toBe(customPrice);
        });

        it('honors a concrete-tier override before a shared bare responseModel', () => {
            const summary = { modelBreakdown: {
                'Claude Opus 5.5 (High)': {
                    responseModel: 'claude-opus-5-5', totalInputTokens: 1_000_000,
                    totalOutputTokens: 0, totalThinkingTokens: 0, totalCacheRead: 0,
                },
            } } as unknown as GMSummary;
            expect(calculateCosts(summary, { 'Claude Opus 5.5 (High)': customPrice }).grandTotal).toBe(11);
        });
    });


    describe('Claude 5.5 captured, persisted and archived identities', () => {
        it('keeps six GM/DNA efforts separate even with a shared responseModel per family', () => {
            const entries: Record<string, PersistedModelDNA> = {};
            for (const m of CLAUDE_55) {
                const model = `MODEL_PLACEHOLDER_${m.id}`;
                const responseModel = `claude-${m.family.toLowerCase()}-5-5`;
                const call = parseGMEntry({ chatModel: { model, responseModel, usage: {} }, stepIndices: [1] });
                expect(call.model).toBe(model);
                expect(call.modelSource).toBe('chatModel');
                expect(call.modelDisplay).toBe(`Claude ${m.family} 5.5 (${m.tier})`);
                expect(getModelDNAKey(call.modelDisplay, responseModel)).toBe(model);
                entries[model] = {
                    displayName: `Claude ${m.family} 5.5 (${m.zh}) (${m.id})`, responseModel,
                    apiProvider: 'ANTHROPIC_VERTEX', completionConfig: null, hasSystemPrompt: false,
                    toolCount: 0, promptSectionTitles: [],
                };
            }
            const restored = restoreModelDNAState(serializeModelDNAState(entries));
            expect(Object.keys(restored).sort()).toEqual(CLAUDE_55.map(m => `MODEL_PLACEHOLDER_${m.id}`));
        });

        it('records nonzero Opus cost when the call only supplies its concrete model ID', () => {
            const call = parseGMEntry({ chatModel: {
                model: 'MODEL_PLACEHOLDER_M402', usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
                chatStartMetadata: { createdAt: new Date().toISOString() },
            }, stepIndices: [1], executionId: 'opus-55-id-only' });
            const ledger = new DailyLedger();
            expect(ledger.recordCalls([{ call, dedupKey: 'opus-55-id-only' }])).toBe(1);
            const bucket = ledger.getTodayActive()[0];
            expect(bucket.totalEstimatedCost).toBeGreaterThan(0);
            expect(bucket.totalEstimatedCost).toBe(costFromTokens(call, DEFAULT_PRICING['claude-opus-5-5']));
            expect(Object.keys(bucket.modelStats)).toEqual(['Claude Opus 5.5 (High)']);
        });

        it('backfills all six exact prices, preserves tiers and does not overwrite historical costs', () => {
            const state: DailyStoreState = { version: 1, records: { '2026-10-03': {
                date: '2026-10-03', cycles: [{
                    startTime: '2026-10-03T00:00:00', endTime: '2026-10-03T23:59:59',
                    totalReasoning: 6, totalToolCalls: 0, totalErrors: 0, totalInputTokens: 0,
                    totalOutputTokens: 0, estSteps: 0, modelNames: [],
                    gmModelStats: Object.fromEntries(CLAUDE_55.map(m => [`Claude ${m.family} 5.5 (${m.zh}) (${m.id})`, {
                        calls: 1, credits: 0, inputTokens: 1_000_000, outputTokens: 500_000,
                        thinkingTokens: 100_000, avgTTFT: 0, cacheHitRate: 0,
                    }])),
                }],
            } } };
            const values = new Map<string, unknown>([['dailyStoreState', state]]);
            const store = new DailyStore();
            store.init({ get: <T>(key: string, fallback: T) => (values.get(key) as T) ?? fallback,
                update: async (key: string, value: unknown) => { values.set(key, value); } });
            expect(store.backfillMissingCosts()).toBe(6);
            expect(store.backfillMissingCosts()).toBe(0);
            const sonnet = store.getRecord('2026-10-03')!.cycles[0].gmModelStats!['Claude Sonnet 5.5 (中) (M404)'];
            expect(sonnet.estimatedCost).toBe(7);
            expect(store.backfillMissingCosts({ 'claude-sonnet-5-5': customPrice })).toBe(0);
            expect(store.backfillMissingCosts({ 'claude-sonnet-5-5': customPrice })).toBe(0);
            expect(sonnet.estimatedCost).toBe(7);
            expect(store.getMonthCostBreakdown(2026, 10).models).toHaveLength(6);
            expect(store.getMonthCostBreakdown(2026, 10).grandTotal).toBe(3 * 14 + 3 * 7);
        });
    });
});

describe('[gemini-4-argon]', () => {
    // Sanitized model metadata from the installed Antigravity IDE's read-only
    // GetUserStatus/GetAvailableModels agent-hub endpoints, 2026-10-31.
    const ARGON = [
        { id: 'M417', tier: 'High', zh: '高', effort: 3 },
        { id: 'M418', tier: 'Medium', zh: '中', effort: 2 },
        { id: 'M419', tier: 'Low', zh: '低', effort: 1 },
    ] as const;

    const customPrice: ModelPricing = { input: 11, output: 22, cacheRead: 0.11, cacheWrite: 13.75, thinking: 22 };

    const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };


    function config(model: string, label: string, isRecommended = false): ModelConfig {
        return { model, label, supportsImages: true, allowedTiers: [], mimeTypeCount: 0,
            supportedMimeTypes: [], isRecommended,
            // Deliberately different reset samples must not split the same provider pool.
            quotaInfo: { remainingFraction: 0.8, resetTime: `${model}-reset` } };
    }


    afterEach(async () => {
        setShowModelShortId(false);
        updateModelDisplayNames([], { authoritative: true });
        await setLanguageToState('both', state);
    });


    describe('Gemini 4 Argon identity and verified metadata', () => {
        it.each(ARGON)('$id preserves the effort across aliases, persisted labels and locales', model => {
            const id = `MODEL_PLACEHOLDER_${model.id}`;
            const label = `Gemini 4 Argon (${model.tier})`;
            const catalog = `gemini-4-argon-${model.tier.toLowerCase()}`;
            const aliases = [id, catalog, catalog.toUpperCase(), label,
                label.replace(model.tier, model.zh), label.replace(`(${model.tier})`, `（${model.zh}）`),
                `  ${label} (${model.id})  `, `Gemini 4 Argon ${model.tier}`];
            expect(getModelDisplayName(id)).toBe(label);
            for (const alias of aliases) {
                expect(resolveModelId(alias), alias).toBe(id);
                expect(getModelBaseName(alias), alias).toBe(label);
                expect(getContextLimit(alias), alias).toBe(511_000);
                expect(getQuotaPoolKey(alias, 'different-reset'), alias).toBe('gemini');
            }
            expect(guessContextLimitSpec(id)).toEqual({ cpLimit: 512_000, cpThreshold: 50_000,
                maxTokens: 1_048_576, supportsThinking: true });
            expect(guessContextLimitSpec(catalog)).toEqual(guessContextLimitSpec(id));
            expect(getModelSpecs().find(s => s.placeholderId === id)).toMatchObject({
                modelId: catalog, displayName: label, apiProvider: 'GOOGLE_GEMINI',
                maxTokens: 1_048_576, maxOutputTokens: 65_536, thinkingLevel: model.effort,
                cpLimit: 512_000, cpThreshold: 50_000, thinkingBudget: 0, supportsThinking: true,
            });
            expect(getModelSpecs().find(s => s.placeholderId === id)?.supportsAdaptiveThinking).toBeUndefined();
        });

        it('does not assign a shared response family to the first observed effort', () => {
            for (const family of ['gemini-4-argon', 'Gemini 4 Argon']) {
                registerResponseModelAlias(family, 'MODEL_PLACEHOLDER_M419');
                expect(resolveModelId(family)).toBeUndefined();
                expect(getQuotaPoolKey(family, 'different-reset')).toBe('gemini');
                expect(getContextLimit(family)).toBe(511_000);
            }
        });

        it('does not match neighboring versions, malformed effort labels or placeholder prefixes', () => {
            for (const key of ['gemini-40-argon-high', 'gemini-4-argon-highest', 'Gemini 4 Argon (Maximum)',
                'MODEL_PLACEHOLDER_M4170', 'MODEL_PLACEHOLDER_M4190']) {
                expect(resolveModelId(key), key).toBeUndefined();
            }
            expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M4170').cpLimit).toBe(0);
            expect(guessContextLimitSpec('gemini-40-argon-high').cpLimit).toBe(0);
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M318')).toBe('Gemini 3.8 Flash (High)');
            expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M318').cpThreshold).toBe(50_000);
            expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M322').cpThreshold).toBe(140_000);
            expect(resolveModelId('gemini-3.6-flash-high')).toBe('MODEL_PLACEHOLDER_M71');
        });

        it('preserves live labels and clears them on account changes without losing static history', () => {
            updateModelDisplayNames([config('MODEL_PLACEHOLDER_M418', 'Account Argon Medium')], { authoritative: true });
            expect(normalizeModelDisplayName('gemini-4-argon-medium')).toBe('Account Argon Medium');
            updateModelDisplayNames([], { authoritative: true });
            expect(resolveModelId('Account Argon Medium')).toBeUndefined();
            expect(normalizeModelDisplayName('gemini-4-argon-medium')).toBe('Gemini 4 Argon (Medium)');
            setShowModelShortId(true);
            expect(normalizeModelDisplayName('gemini-4-argon-medium')).toBe('Gemini 4 Argon (Medium) (M418)');
            expect(getModelBaseName('Gemini 4 Argon (中) (M418)')).toBe('Gemini 4 Argon (Medium)');
        });
    });


    describe('Argon accounting and pricing boundaries', () => {
        it.each(ARGON)('$id uses the official family rate unless the user supplies a matching price', model => {
            const id = `MODEL_PLACEHOLDER_${model.id}`;
            const catalog = `gemini-4-argon-${model.tier.toLowerCase()}`;
            const localized = `Gemini 4 Argon (${model.zh}) (${model.id})`;
            for (const key of [id, catalog, localized, 'gemini-4-argon']) {
                expect(findPricing(key), key).toBe(DEFAULT_PRICING['gemini-4-argon']);
            }
            expect(findPricingWithCustom(id, { [localized]: customPrice })).toBe(customPrice);
            expect(findPricingWithCustom(catalog, { 'gemini-4-argon': customPrice })).toBe(customPrice);
            expect(findPricing(catalog, { 'gemini-3.8-flash': customPrice })).toBeNull();
            expect(findPricing(catalog, { 'gemini-4': customPrice })).toBeNull();
        });

        it('isolates per-effort custom prices and leaves other efforts on the official family rate', () => {
            const custom = { 'Gemini 4 Argon (低) (M419)': customPrice };
            expect(findPricingWithCustom('gemini-4-argon-low', custom)).toBe(customPrice);
            expect(findPricingWithCustom('gemini-4-argon-medium', custom)).toBe(DEFAULT_PRICING['gemini-4-argon']);
            expect(findPricingWithCustom('gemini-4-argon-high', custom)).toBe(DEFAULT_PRICING['gemini-4-argon']);
            expect(findPricingWithCustom('gemini-4-argon', custom)).toBe(DEFAULT_PRICING['gemini-4-argon']);
        });

        it('keeps GM and persisted DNA efforts separate with a shared responseModel', () => {
            const entries: Record<string, PersistedModelDNA> = {};
            for (const model of ARGON) {
                const id = `MODEL_PLACEHOLDER_${model.id}`;
                const call = parseGMEntry({ chatModel: { model: id, responseModel: 'gemini-4-argon', usage: {} }, stepIndices: [1] });
                expect(call.model).toBe(id);
                expect(call.modelSource).toBe('chatModel');
                expect(call.modelDisplay).toBe(`Gemini 4 Argon (${model.tier})`);
                expect(getModelDNAKey(call.modelDisplay, call.responseModel)).toBe(id);
                entries[id] = { displayName: `Gemini 4 Argon (${model.zh}) (${model.id})`,
                    responseModel: 'gemini-4-argon', apiProvider: 'GOOGLE_GEMINI', completionConfig: null,
                    hasSystemPrompt: false, toolCount: 0, promptSectionTitles: [] };
            }
            const restored = restoreModelDNAState(serializeModelDNAState(entries));
            expect(Object.keys(restored).sort()).toEqual(ARGON.map(m => `MODEL_PLACEHOLDER_${m.id}`));
        });

        it('retains exact tier token totals through ledger restore, deduplication, pricing and archival', () => {
            const ledger = new DailyLedger();
            const entries = ARGON.map((model, index) => ({ dedupKey: `argon-${model.id}`,
                call: { ...parseGMEntry({ executionId: `argon-${model.id}`, stepIndices: [index],
                    chatModel: { model: `MODEL_PLACEHOLDER_${model.id}`, responseModel: 'gemini-4-argon',
                        usage: { inputTokens: (index + 1) * 100_000, outputTokens: 1000,
                            thinkingOutputTokens: 100, cacheReadTokens: 50 },
                        chatStartMetadata: { createdAt: new Date().toISOString() } },
                }), accountEmail: 'argon@example.test' } }));
            expect(ledger.recordCalls(entries)).toBe(3);
            const restored = DailyLedger.restore(ledger.serialize());
            expect(restored.recordCalls(entries)).toBe(0);
            const bucket = restored.getAccountActive('argon@example.test')!;
            expect(Object.keys(bucket.modelStats)).toEqual(ARGON.map(m => `Gemini 4 Argon (${m.tier})`));
            expect(bucket.totalInputTokens).toBe(600_000);
            expect(bucket.totalOutputTokens).toBe(3000);
            expect(bucket.totalThinkingTokens).toBe(300);
            expect(bucket.totalEstimatedCost).toBeCloseTo(costFromTokens({ inputTokens: 600_000, outputTokens: 3000, thinkingTokens: 300, cacheReadTokens: 150 }, DEFAULT_PRICING['gemini-4-argon']), 10);
            const custom = Object.fromEntries(ARGON.map((model, index) => [
                `Gemini 4 Argon (${model.zh}) (${model.id})`,
                { input: index + 1, output: 10, thinking: 20, cacheRead: 0.5, cacheWrite: 0 },
            ]));
            const archive = buildGMSummaryFromLedger(restored.rollover(), custom);
            const cost = calculateCosts(archive.summary, custom);
            expect(cost.rows).toHaveLength(3);
            expect(archive.totalCost).toBeCloseTo(1.433075, 8);
            expect(cost.grandTotal).toBeCloseTo(archive.totalCost, 8);
            expect(cost.rows.map(row => row.inputTokens).sort((a, b) => a - b)).toEqual([100_000, 200_000, 300_000]);
            expect(cost.rows.every(row => row.pricing !== null)).toBe(true);
        });

        it('groups all Argon efforts with Gemini Flash without merging the premium pool', () => {
            const configs = ARGON.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Argon (${m.tier})`));
            configs.push(config('MODEL_PLACEHOLDER_M318', 'Gemini 3.8 Flash (High)'),
                config('MODEL_PLACEHOLDER_M402', 'Claude Opus 5.5 (High)'));
            const expected = ['MODEL_PLACEHOLDER_M417', 'MODEL_PLACEHOLDER_M418', 'MODEL_PLACEHOLDER_M419', 'MODEL_PLACEHOLDER_M318'];
            expect(expandModelIdsToPool(['MODEL_PLACEHOLDER_M417'], configs)).toEqual(expected);
            const groups = groupModelIdsByResetPool(['MODEL_PLACEHOLDER_M417', 'MODEL_PLACEHOLDER_M402'], configs);
            expect(groups).toEqual([expected, ['MODEL_PLACEHOLDER_M402']]);
        });
    });


    describe('Argon model and tooltip presentation', () => {
        it.each(['en', 'zh', 'both'] as Language[])('renders only account-available Argon efforts in %s', async language => {
            await setLanguageToState(language, state);
            const configs = ARGON.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Argon (${m.tier})`));
            const html = buildModelsTabContent(null, configs);
            expect(html.match(/class="spec-card"/g)).toHaveLength(3);
            for (const model of ARGON) {
                expect(html).toContain(`Gemini 4 Argon (${model.tier})`);
                expect(html).toContain(`gemini-4-argon-${model.tier.toLowerCase()}`);
            }
            expect(html).toContain('512,000');
            expect(html).toContain('1,048,576');
            expect(html).toContain(language === 'zh' ? '支持 · 预算未指定' : 'Supported · Budget unspecified');
            expect(html).not.toContain('Gemini 3.8 Flash');
            expect(html).not.toContain('Claude');
            const empty = buildModelsTabContent(null, []);
            expect(empty).not.toContain('Gemini 4 Argon');
        });

        it('prefers live recommendations and the current tier over a newer generation', () => {
            const configs = [config('MODEL_PLACEHOLDER_M318', 'Gemini 3.8 Flash (High)'),
                ...ARGON.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Argon (${m.tier})`, m.tier === 'Medium'))];
            expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M418');
            expect(selectQuotaRows(configs, 'MODEL_PLACEHOLDER_M419', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M419');
            expect(selectQuotaRows(configs, 'MODEL_PLACEHOLDER_M318', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M318');
            const unflagged = configs.map(c => ({ ...c, isRecommended: false }));
            expect(selectQuotaRows(unflagged, '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M417');
            expect(selectQuotaRows(unflagged, '', 3).rows[0].label).toBe('Gemini 4 Argon (High) · 4 models');
        });
    });
});

describe('[gemini-4-carbon]', () => {
    // Sanitized model metadata from the installed Antigravity IDE's read-only
    // GetUserStatus/GetAvailableModels agent-hub endpoints, 2026-11-11.
    const CARBON = [
        { id: 'M427', tier: 'High', zh: '高', effort: 3 },
        { id: 'M437', tier: 'Medium', zh: '中', effort: 2 },
        { id: 'M438', tier: 'Low', zh: '低', effort: 1 },
    ] as const;

    const customPrice: ModelPricing = { input: 11, output: 22, cacheRead: 0.11, cacheWrite: 13.75, thinking: 22 };

    const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };


    function config(model: string, label: string, isRecommended = false): ModelConfig {
        return { model, label, supportsImages: true, allowedTiers: [], mimeTypeCount: 0,
            supportedMimeTypes: [], isRecommended,
            // Deliberately different reset samples must not split the same provider pool.
            quotaInfo: { remainingFraction: 0.8, resetTime: `${model}-reset` } };
    }


    afterEach(async () => {
        setShowModelShortId(false);
        updateModelDisplayNames([], { authoritative: true });
        await setLanguageToState('both', state);
    });


    describe('Gemini 4 Carbon identity and verified metadata', () => {
        it.each(CARBON)('$id preserves the effort across aliases, persisted labels and locales', model => {
            const id = `MODEL_PLACEHOLDER_${model.id}`;
            const label = `Gemini 4 Carbon (${model.tier})`;
            const catalog = `gemini-4-carbon-${model.tier.toLowerCase()}`;
            const aliases = [id, catalog, catalog.toUpperCase(), label,
                label.replace(model.tier, model.zh), label.replace(`(${model.tier})`, `（${model.zh}）`),
                `  ${label} (${model.id})  `, `Gemini 4 Carbon ${model.tier}`];
            expect(getModelDisplayName(id)).toBe(label);
            for (const alias of aliases) {
                expect(resolveModelId(alias), alias).toBe(id);
                expect(getModelBaseName(alias), alias).toBe(label);
                expect(getContextLimit(alias), alias).toBe(511_000);
                expect(getQuotaPoolKey(alias, 'different-reset'), alias).toBe('gemini');
            }
            expect(guessContextLimitSpec(id)).toEqual({ cpLimit: 512_000, cpThreshold: 50_000,
                maxTokens: 1_048_576, supportsThinking: true });
            expect(guessContextLimitSpec(catalog)).toEqual(guessContextLimitSpec(id));
            expect(getModelSpecs().find(s => s.placeholderId === id)).toMatchObject({
                modelId: catalog, displayName: label, apiProvider: 'GOOGLE_GEMINI',
                maxTokens: 1_048_576, maxOutputTokens: 262_144, thinkingLevel: model.effort,
                cpLimit: 512_000, cpThreshold: 50_000, thinkingBudget: 0, supportsThinking: true,
            });
            expect(getModelSpecs().find(s => s.placeholderId === id)?.supportsAdaptiveThinking).toBeUndefined();
        });

        it('does not assign a shared response family to the first observed effort', () => {
            for (const family of ['gemini-4-carbon', 'Gemini 4 Carbon', 'GEMINI_4_CARBON']) {
                for (const model of CARBON) {
                    registerResponseModelAlias(family, `MODEL_PLACEHOLDER_${model.id}`);
                }
                expect(resolveModelId(family)).toBeUndefined();
                expect(getQuotaPoolKey(family, 'different-reset')).toBe('gemini');
                expect(getContextLimit(family)).toBe(511_000);
                const responseOnly = parseGMEntry({ chatModel: { responseModel: family, usage: {} }, stepIndices: [1] });
                expect(responseOnly.model).toBe('');
                expect(responseOnly.modelSource).toBe('unknown');
            }
        });

        it('does not match neighboring versions, malformed effort labels or placeholder prefixes', () => {
            for (const key of ['gemini-40-carbon-high', 'gemini-4-carbon-highest', 'Gemini 4 Carbon (Maximum)',
                'gemini-4-carbonated-high', 'Gemini 4 CarbonHigh', 'Gemini 4 Carbon (High',
                'Gemini 4 Carbon High)', 'MODEL_PLACEHOLDER_M4270', 'MODEL_PLACEHOLDER_M4370', 'MODEL_PLACEHOLDER_M4380']) {
                expect(resolveModelId(key), key).toBeUndefined();
                expect(guessContextLimitSpec(key).cpLimit, key).toBe(0);
            }
            expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M4270').cpLimit).toBe(0);
            expect(guessContextLimitSpec('gemini-40-carbon-high').cpLimit).toBe(0);
            expect(getModelDisplayName('MODEL_PLACEHOLDER_M318')).toBe('Gemini 3.8 Flash (High)');
            expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M318').cpThreshold).toBe(50_000);
            expect(guessContextLimitSpec('MODEL_PLACEHOLDER_M322').cpThreshold).toBe(140_000);
            expect(resolveModelId('gemini-3.6-flash-high')).toBe('MODEL_PLACEHOLDER_M71');
            expect(resolveModelId('gemini-4-argon-high')).toBe('MODEL_PLACEHOLDER_M417');
            expect(getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M417')?.maxOutputTokens).toBe(65_536);
        });

        it('does not let a conflicting GM sample remap a registered tier across efforts or families', () => {
            registerResponseModelAlias('gemini-4-carbon-low', 'MODEL_PLACEHOLDER_M427');
            registerResponseModelAlias('gemini-4-carbon-low', 'MODEL_PLACEHOLDER_M419');
            registerResponseModelAlias('gemini-4-argon-low', 'MODEL_PLACEHOLDER_M438');
            expect(resolveModelId('gemini-4-carbon-low')).toBe('MODEL_PLACEHOLDER_M438');
            expect(resolveModelId('gemini-4-argon-low')).toBe('MODEL_PLACEHOLDER_M419');
        });

        it.each([
            { family: 'Carbon', id: 'M427', tier: 'High', zh: '高', otherTier: 'M438', otherFamily: 'M417' },
            { family: 'Carbon', id: 'M437', tier: 'Medium', zh: '中', otherTier: 'M427', otherFamily: 'M418' },
            { family: 'Carbon', id: 'M438', tier: 'Low', zh: '低', otherTier: 'M427', otherFamily: 'M419' },
            { family: 'Argon', id: 'M417', tier: 'High', zh: '高', otherTier: 'M419', otherFamily: 'M427' },
            { family: 'Argon', id: 'M418', tier: 'Medium', zh: '中', otherTier: 'M417', otherFamily: 'M437' },
            { family: 'Argon', id: 'M419', tier: 'Low', zh: '低', otherTier: 'M417', otherFamily: 'M438' },
        ])('$family $tier cannot be remapped through a different spelling of its known identity', model => {
            const expected = `MODEL_PLACEHOLDER_${model.id}`;
            for (const alias of [
                `GEMINI_4_${model.family.toUpperCase()}_${model.tier.toUpperCase()}`,
                `Gemini 4 ${model.family} ${model.tier.toUpperCase()}`,
                `Gemini 4 ${model.family}（${model.zh}）`,
                `Gemini 4 ${model.family} (${model.zh}) (${model.id})`,
            ]) {
                expect(resolveModelId(alias), alias).toBe(expected);
                for (const wrongId of [model.otherTier, model.otherFamily]) {
                    registerResponseModelAlias(alias, `MODEL_PLACEHOLDER_${wrongId}`);
                    expect(resolveModelId(alias), `${alias} -> ${wrongId}`).toBe(expected);
                    const responseOnly = parseGMEntry({ chatModel: { responseModel: alias, usage: {} }, stepIndices: [1] });
                    expect(responseOnly.model).toBe(expected);
                }
                registerResponseModelAlias(alias, expected);
                expect(resolveModelId(alias)).toBe(expected);
            }
        });

        it('still learns unknown aliases and defers to authoritative live labels during a renumber', () => {
            const alias = 'fixture-carbon-live-renumber';
            expect(resolveModelId(alias)).toBeUndefined();
            registerResponseModelAlias(alias, 'MODEL_PLACEHOLDER_M438');
            expect(resolveModelId(alias)).toBe('MODEL_PLACEHOLDER_M438');
            updateModelDisplayNames([config('MODEL_PLACEHOLDER_M9090', alias)], { authoritative: true });
            expect(resolveModelId(alias)).toBe('MODEL_PLACEHOLDER_M9090');
            registerResponseModelAlias(alias, 'MODEL_PLACEHOLDER_M9090');
            registerResponseModelAlias(alias, 'MODEL_PLACEHOLDER_M438');
            expect(resolveModelId(alias)).toBe('MODEL_PLACEHOLDER_M9090');
            updateModelDisplayNames([], { authoritative: true });
            expect(resolveModelId(alias)).toBe('MODEL_PLACEHOLDER_M9090');
        });

        it('preserves live labels and clears them on account changes without losing static history', () => {
            updateModelDisplayNames([config('MODEL_PLACEHOLDER_M437', 'Account Carbon Medium')], { authoritative: true });
            expect(normalizeModelDisplayName('gemini-4-carbon-medium')).toBe('Account Carbon Medium');
            updateModelDisplayNames([], { authoritative: true });
            expect(resolveModelId('Account Carbon Medium')).toBeUndefined();
            expect(normalizeModelDisplayName('gemini-4-carbon-medium')).toBe('Gemini 4 Carbon (Medium)');
            setShowModelShortId(true);
            expect(normalizeModelDisplayName('gemini-4-carbon-medium')).toBe('Gemini 4 Carbon (Medium) (M437)');
            expect(getModelBaseName('Gemini 4 Carbon (中) (M437)')).toBe('Gemini 4 Carbon (Medium)');
        });
    });


    describe('Carbon accounting and pricing boundaries', () => {
        it.each(CARBON)('$id isolates pricing from Argon, Flash and unrelated Gemini families', model => {
            const id = `MODEL_PLACEHOLDER_${model.id}`;
            const catalog = `gemini-4-carbon-${model.tier.toLowerCase()}`;
            const localized = `Gemini 4 Carbon (${model.zh}) (${model.id})`;
            for (const key of [id, catalog, localized, 'gemini-4-carbon']) {
                expect(findPricing(key, { 'gemini-4-argon': customPrice }), key).toBeNull();
                expect(findPricing(key, { 'gemini-3.8-flash': customPrice }), key).toBeNull();
                expect(findPricing(key, { 'gemini-4': customPrice }), key).toBeNull();
            }
            expect(findPricingWithCustom(id, { [localized]: customPrice })).toBe(customPrice);
            expect(findPricingWithCustom(catalog, { 'gemini-4-carbon': customPrice })).toBe(customPrice);
        });

        it('keeps a custom Low price scoped to that effort and family', () => {
            const custom = { 'Gemini 4 Carbon (低) (M438)': customPrice };
            expect(findPricingWithCustom('gemini-4-carbon-low', custom, {})).toBe(customPrice);
            for (const model of ['gemini-4-carbon-medium', 'gemini-4-carbon-high', 'gemini-4-carbon',
                'gemini-4-argon-low', 'gemini-3.8-flash-low']) {
                expect(findPricingWithCustom(model, custom, {}), model).toBeNull();
            }
        });

        it('keeps GM and persisted DNA efforts separate with a shared responseModel', () => {
            const entries: Record<string, PersistedModelDNA> = {};
            for (const model of CARBON) {
                const id = `MODEL_PLACEHOLDER_${model.id}`;
                const call = parseGMEntry({ chatModel: { model: id, responseModel: 'gemini-4-carbon', usage: {} }, stepIndices: [1] });
                expect(call.model).toBe(id);
                expect(call.modelSource).toBe('chatModel');
                expect(call.modelDisplay).toBe(`Gemini 4 Carbon (${model.tier})`);
                expect(getModelDNAKey(call.modelDisplay, call.responseModel)).toBe(id);
                entries[id] = { displayName: `Gemini 4 Carbon (${model.zh}) (${model.id})`,
                    responseModel: 'gemini-4-carbon', apiProvider: 'GOOGLE_GEMINI', completionConfig: null,
                    hasSystemPrompt: false, toolCount: 0, promptSectionTitles: [] };
            }
            const restored = restoreModelDNAState(serializeModelDNAState(entries));
            expect(Object.keys(restored).sort()).toEqual(CARBON.map(m => `MODEL_PLACEHOLDER_${m.id}`));
        });

        it('retains exact tier token totals through ledger restore, deduplication, pricing and archival', () => {
            const ledger = new DailyLedger();
            const entries = CARBON.map((model, index) => ({ dedupKey: `carbon-${model.id}`,
                call: { ...parseGMEntry({ executionId: `carbon-${model.id}`, stepIndices: [index],
                    chatModel: { model: `MODEL_PLACEHOLDER_${model.id}`, responseModel: 'gemini-4-carbon',
                        usage: { inputTokens: (index + 1) * 100_000, outputTokens: 1000,
                            thinkingOutputTokens: 100, cacheReadTokens: 50 },
                        chatStartMetadata: { createdAt: new Date().toISOString() } },
                }), accountEmail: 'carbon@example.test' } }));
            expect(ledger.recordCalls(entries)).toBe(3);
            const restored = DailyLedger.restore(ledger.serialize());
            expect(restored.recordCalls(entries)).toBe(0);
            const bucket = restored.getAccountActive('carbon@example.test')!;
            expect(Object.keys(bucket.modelStats)).toEqual(CARBON.map(m => `Gemini 4 Carbon (${m.tier})`));
            expect(bucket.totalInputTokens).toBe(600_000);
            expect(bucket.totalOutputTokens).toBe(3000);
            expect(bucket.totalThinkingTokens).toBe(300);
            const custom = Object.fromEntries(CARBON.map((model, index) => [
                `Gemini 4 Carbon (${model.zh}) (${model.id})`,
                { input: index + 1, output: 10, thinking: 20, cacheRead: 0.5, cacheWrite: 0 },
            ]));
            const archive = buildGMSummaryFromLedger(restored.rollover(), custom);
            const cost = calculateCosts(archive.summary, custom);
            expect(cost.rows).toHaveLength(3);
            expect(archive.totalCost).toBeCloseTo(1.433075, 8);
            expect(cost.grandTotal).toBeCloseTo(archive.totalCost, 8);
            expect(cost.rows.map(row => row.inputTokens).sort((a, b) => a - b)).toEqual([100_000, 200_000, 300_000]);
            expect(cost.rows.every(row => row.pricing !== null)).toBe(true);
        });

        it('groups all Carbon efforts with Gemini Flash without merging the premium pool', () => {
            const configs = CARBON.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Carbon (${m.tier})`));
            configs.push(config('MODEL_PLACEHOLDER_M318', 'Gemini 3.8 Flash (High)'),
                config('MODEL_PLACEHOLDER_M402', 'Claude Opus 5.5 (High)'));
            const expected = ['MODEL_PLACEHOLDER_M427', 'MODEL_PLACEHOLDER_M437', 'MODEL_PLACEHOLDER_M438', 'MODEL_PLACEHOLDER_M318'];
            expect(expandModelIdsToPool(['MODEL_PLACEHOLDER_M427'], configs)).toEqual(expected);
            const groups = groupModelIdsByResetPool(['MODEL_PLACEHOLDER_M427', 'MODEL_PLACEHOLDER_M402'], configs);
            expect(groups).toEqual([expected, ['MODEL_PLACEHOLDER_M402']]);
        });
    });


    describe('Carbon model and tooltip presentation', () => {
        it.each(['en', 'zh', 'both'] as Language[])('renders only account-available Carbon efforts in %s', async language => {
            await setLanguageToState(language, state);
            const configs = CARBON.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Carbon (${m.tier})`));
            const html = buildModelsTabContent(null, configs);
            expect(html.match(/class="spec-card"/g)).toHaveLength(3);
            for (const model of CARBON) {
                expect(html).toContain(`Gemini 4 Carbon (${model.tier})`);
                expect(html).toContain(`gemini-4-carbon-${model.tier.toLowerCase()}`);
            }
            expect(html).toContain('512,000');
            expect(html).toContain('1,048,576');
            expect(html).toContain('262,144');
            expect(html).toContain(language === 'zh' ? '支持 · 预算未指定' : 'Supported · Budget unspecified');
            expect(html).not.toContain('Gemini 3.8 Flash');
            expect(html).not.toContain('Claude');
            expect(html).not.toContain('Gemini 4 Argon');
            const mediumOnly = buildModelsTabContent(null, [configs[1]]);
            expect(mediumOnly.match(/class="spec-card"/g)).toHaveLength(1);
            expect(mediumOnly).toContain('gemini-4-carbon-medium');
            expect(mediumOnly).not.toContain('gemini-4-carbon-high');
            expect(mediumOnly).not.toContain('gemini-4-carbon-low');
            const empty = buildModelsTabContent(null, []);
            expect(empty).not.toContain('Gemini 4 Carbon');
        });

        it('prefers live recommendations and the current tier over a newer generation', () => {
            const configs = [config('MODEL_PLACEHOLDER_M318', 'Gemini 3.8 Flash (High)'),
                config('MODEL_PLACEHOLDER_M417', 'Gemini 4 Argon (High)'),
                ...CARBON.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Carbon (${m.tier})`, m.tier === 'Medium'))];
            expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M437');
            expect(selectQuotaRows(configs, 'MODEL_PLACEHOLDER_M438', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M438');
            expect(selectQuotaRows(configs, 'MODEL_PLACEHOLDER_M318', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M318');
            expect(selectQuotaRows(configs, 'MODEL_PLACEHOLDER_M417', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M417');
            expect(selectQuotaRows(configs, '', 3).rows[0].poolSize).toBe(5);
        });
    });
});

describe('[gemini-4-hydrogen]', () => {
    // Sanitized fields from the running IDE GetAvailableModels/GetUserStatus, 2026-11-13.
    // Extra is the picker label; XHigh and level 100 are the backend identity.
    const HYDROGEN = [
        { id: 'M527', tier: 'Low', zh: '低', level: 1 },
        { id: 'M526', tier: 'Medium', zh: '中', level: 2 },
        { id: 'M525', tier: 'High', zh: '高', level: 3 },
        { id: 'M528', tier: 'XHigh', zh: '超高', level: 100 },
    ] as const;

    const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

    const RESET = '2026-11-13T12:00:00Z';

    function config(model: string, label: string, isRecommended = false): ModelConfig {
        return { model, label, supportsImages: true, allowedTiers: [], mimeTypeCount: 0,
            supportedMimeTypes: [], isRecommended, quotaInfo: { remainingFraction: 0.8, resetTime: RESET } };
    }

    const configs = () => HYDROGEN.map(m => config(`MODEL_PLACEHOLDER_${m.id}`, `Gemini 4 Hydrogen (${m.tier})`));


    afterEach(async () => {
        setShowModelShortId(false);
        updateModelDisplayNames([], { authoritative: true });
        await setLanguageToState('both', state);
    });


    describe('Hydrogen verified identities and context', () => {
        it.each(HYDROGEN)('$tier resolves persisted, localized, catalog and picker spellings independently', model => {
            const id = `MODEL_PLACEHOLDER_${model.id}`;
            const catalog = `gemini-4-hydrogen-${model.tier.toLowerCase()}`;
            const label = `Gemini 4 Hydrogen (${model.tier})`;
            for (const alias of [id, catalog, catalog.toUpperCase(), catalog.replace(/-/g, '_'), label,
                `Gemini 4 Hydrogen ${model.tier}`, `Gemini 4 Hydrogen (${model.zh})`,
                `Gemini 4 Hydrogen（${model.zh}）`, `  ${label} (${model.id})  `,
                `Gemini 4 Hydrogen（${model.zh}）（${model.id}）`]) {
                expect(resolveModelId(alias), alias).toBe(id);
                expect(getModelBaseName(alias), alias).toBe(label);
                expect(getContextLimit(alias), alias).toBe(511_000);
                expect(getQuotaPoolKey(alias, 'different-reset'), alias).toBe('gemini');
            }
            expect(getModelDisplayName(id)).toBe(label);
            expect(guessContextLimitSpec(id)).toEqual({ cpLimit: 512_000, cpThreshold: 50_000,
                maxTokens: 1_048_576, supportsThinking: true });
            expect(guessContextLimitSpec(catalog)).toEqual(guessContextLimitSpec(id));
            expect(getModelSpecs().find(s => s.placeholderId === id)).toMatchObject({
                modelId: catalog, displayName: label, apiProvider: 'GOOGLE_GEMINI',
                maxTokens: 1_048_576, maxOutputTokens: 262_144, thinkingLevel: model.level,
                thinkingBudget: 0, supportsThinking: true, cpLimit: 512_000, cpThreshold: 50_000,
            });
        });

        it.each(['Extra', 'Extra High', 'extra-high', 'extra_high', 'XHigh', '超高', '极高'])(
            'maps the %s picker/localized alias to XHigh, never High', effort => {
                for (const name of [`Gemini 4 Hydrogen ${effort}`, `Gemini 4 Hydrogen (${effort})`]) {
                    expect(resolveModelId(name)).toBe('MODEL_PLACEHOLDER_M528');
                    expect(guessContextLimitSpec(name).cpThreshold).toBe(50_000);
                }
            },
        );

        it.each(['gemini-40-hydrogen-high', 'gemini-4-hydrogenated-high', 'gemini-4-hydrogen-highest',
            'Gemini 4 HydrogenHigh', 'Gemini 4 Hydrogen (High', 'Gemini 4 Hydrogen High)',
            'Gemini 4 Hydrogen (Extra High', 'Gemini 4 Hydrogen (Maximum)', 'Gemini 4 Hydrogen (XHighExtra)',
            'Gemini 4 Hydrogen (Extra High) trailing', 'MODEL_PLACEHOLDER_M5250', 'MODEL_PLACEHOLDER_M5260',
            'MODEL_PLACEHOLDER_M5270', 'MODEL_PLACEHOLDER_M5280', 'Gemini 4 Carbon (Extra)', 'Gemini 4 Argon (XHigh)'])(
            'leaves malformed or unverified identity %s unresolved', key => {
                expect(resolveModelId(key)).toBeUndefined();
                expect(guessContextLimitSpec(key).cpLimit).toBe(0);
            },
        );

        it('does not learn a shared response family as the first observed tier', () => {
            for (const family of ['gemini-4-hydrogen', 'Gemini 4 Hydrogen', 'GEMINI_4_HYDROGEN']) {
                for (const model of HYDROGEN) registerResponseModelAlias(family, `MODEL_PLACEHOLDER_${model.id}`);
                expect(resolveModelId(family)).toBeUndefined();
                expect(getContextLimit(family)).toBe(511_000);
                expect(getQuotaPoolKey(family)).toBe('gemini');
                const call = parseGMEntry({ chatModel: { responseModel: family, usage: {} }, stepIndices: [1] });
                expect(call.model).toBe('');
                expect(call.modelSource).toBe('unknown');
            }
        });

        it.each(HYDROGEN)('$tier cannot be reassigned by a conflicting GM alias', model => {
            const id = `MODEL_PLACEHOLDER_${model.id}`;
            const aliases = [`gemini-4-hydrogen-${model.tier.toLowerCase()}`, `GEMINI_4_HYDROGEN_${model.tier.toUpperCase()}`,
                `Gemini 4 Hydrogen（${model.zh}）`, `Gemini 4 Hydrogen (${model.zh}) (${model.id})`];
            if (model.tier === 'XHigh') aliases.push('Gemini 4 Hydrogen Extra', 'gemini-4-hydrogen-extra-high');
            for (const alias of aliases) {
                for (const wrong of [...HYDROGEN.map(m => `MODEL_PLACEHOLDER_${m.id}`), 'MODEL_PLACEHOLDER_M427', 'MODEL_PLACEHOLDER_M417']) {
                    registerResponseModelAlias(alias, wrong);
                    expect(resolveModelId(alias)).toBe(id);
                }
            }
        });

        it('resets account labels and preserves history, diagnostic IDs and tier identity', () => {
            updateModelDisplayNames([config('MODEL_PLACEHOLDER_M528', 'Account Hydrogen Extra')], { authoritative: true });
            expect(normalizeModelDisplayName('gemini-4-hydrogen-xhigh')).toBe('Account Hydrogen Extra');
            updateModelDisplayNames([], { authoritative: true });
            expect(resolveModelId('Account Hydrogen Extra')).toBeUndefined();
            expect(getModelBaseName('Gemini 4 Hydrogen (超高) (M528)')).toBe('Gemini 4 Hydrogen (XHigh)');
            setShowModelShortId(true);
            expect(normalizeModelDisplayName('gemini-4-hydrogen-extra')).toBe('Gemini 4 Hydrogen (XHigh) (M528)');
            expect(getModelSpecs().find(s => s.placeholderId === 'MODEL_PLACEHOLDER_M417')?.maxOutputTokens).toBe(65_536);
            expect(resolveModelId('gemini-3.6-flash-high')).toBe('MODEL_PLACEHOLDER_M71');
        });
    });


    describe('Hydrogen shared quota without merged accounting', () => {
        it('groups all four efforts into one Gemini family and never adds percentages', () => {
            const all = [...configs(), config('MODEL_PLACEHOLDER_M438', 'Gemini 4 Carbon (Low)'),
                config('MODEL_PLACEHOLDER_M402', 'Claude Opus 5.5 (High)'),
                config('MODEL_PLACEHOLDER_M667', 'Orchestrator')];
            const groups = groupModelQuotas(all);
            expect(groups).toHaveLength(2);
            const gemini = groups.find(g => g.pool === 'gemini')!;
            expect(gemini.minimum).toBe(0.8);
            expect(gemini.maximum).toBe(0.8);
            expect(gemini.members[0].label).toBe('Gemini 4 Hydrogen');
            expect(gemini.members[0].efforts).toEqual(['low', 'medium', 'high', 'xhigh']);
            expect(gemini.members[0].readings.map(r => r.model)).toEqual(HYDROGEN.map(m => `MODEL_PLACEHOLDER_${m.id}`));
            expect(expandModelIdsToPool(['MODEL_PLACEHOLDER_M528'], all)).toEqual(['MODEL_PLACEHOLDER_M528', ...HYDROGEN.slice(0, 3).map(m => `MODEL_PLACEHOLDER_${m.id}`), 'MODEL_PLACEHOLDER_M438', 'MODEL_PLACEHOLDER_M667']);
            expect(gemini.members.find(m => m.label === 'Orchestrator')?.efforts).toEqual([]);
        });

        it.each(['API_PROVIDER_GOOGLE_GEMINI', 'ANTHROPIC_VERTEX', 'OPENAI_VERTEX'])(
            'does not infer an unverified model quota pool from provider %s', apiProvider => {
                // An unregistered future coordinator is not the known Orchestrator; equal reset readings
                // and a Google provider do not prove membership in the Gemini pool.
                const id = 'MODEL_PLACEHOLDER_M9667';
                updateModelSpec(id, { modelId: 'gemini-pro-unverified-orchestrator', displayName: 'Unknown Orchestrator', apiProvider });
                registerResponseModelAlias('gemini-pro-unverified-orchestrator', id);
                try {
                    expect(getQuotaPoolKey(id)).toBe(id);
                    expect(getQuotaPoolKey('gemini-pro-unverified-orchestrator')).toBe('gemini-pro-unverified-orchestrator');
                    expect(getQuotaPoolKey(id, RESET)).toBe(RESET);
                    const all = [...configs(), config(id, 'Unknown Orchestrator')];
                    expect(groupModelQuotas(all)).toHaveLength(2);
                    expect(groupModelQuotas(all).find(g => g.label === 'Unknown Orchestrator')?.pool).toBeUndefined();
                    expect(expandModelIdsToPool(['MODEL_PLACEHOLDER_M528'], all)).not.toContain(id);
                } finally {
                    updateModelSpec(id, { apiProvider: 'GOOGLE_GEMINI' });
                }
            },
        );

        it.each([
            { catalog: 'gemini-fixture-future-high', provider: 'API_PROVIDER_GOOGLE_GEMINI', pool: 'gemini' },
            { catalog: 'claude-fixture-future-high', provider: 'ANTHROPIC_VERTEX', pool: 'premium' },
            { catalog: 'gpt-oss-fixture-medium', provider: 'OPENAI_VERTEX', pool: 'premium' },
        ])('preserves future $catalog pooling when its provider also matches', ({ catalog, provider, pool }) => {
            const id = 'MODEL_PLACEHOLDER_M9955';
            updateModelSpec(id, { modelId: catalog, apiProvider: provider });
            expect(getQuotaPoolKey(id, RESET)).toBe(pool);
            updateModelSpec(id, { apiProvider: pool === 'gemini' ? 'ANTHROPIC_VERTEX' : 'GOOGLE_GEMINI' });
            expect(getQuotaPoolKey(id)).toBe(id);
            updateModelSpec(id, { modelId: 'unbranded-orchestrator', displayName: 'Gemini 4 Hydrogen Extra', apiProvider: provider });
            expect(getQuotaPoolKey(id)).toBe(id);
        });

        it.each(['Extra', 'Extra High', 'XHigh', '超高', '极高'])('strips only the known %s effort from the live family label', effort => {
            for (const label of [`Account Hydrogen (${effort}) (M528)`, `Account Hydrogen ${effort}`, `Account Hydrogen（${effort}）（M528）`]) {
                const member = groupModelQuotas([config('MODEL_PLACEHOLDER_M528', label)])[0].members[0];
                expect(member.label).toBe('Account Hydrogen');
                expect(member.efforts).toEqual(['xhigh']);
            }
        });

        it('keeps absent Extra unknown and exposes missing/conflicting quota without manufacturing a fourth tier', () => {
            const partial = configs().slice(0, 3);
            expect(groupModelQuotas(partial)[0].members[0].efforts).toEqual(['low', 'medium', 'high']);
            const extra = configs()[3];
            extra.quotaInfo = undefined;
            const group = groupModelQuotas([...partial, extra])[0];
            expect(group.missingQuota).toBe(true);
            expect(group.minimum).toBe(0.8);
            expect(group.members[0].readings[3].remaining).toBeNull();
            extra.quotaInfo = { remainingFraction: 0, resetTime: '2026-11-13T13:00:00Z' };
            const differing = groupModelQuotas([...partial, extra])[0];
            expect(differing.minimum).toBe(0);
            expect(differing.maximum).toBe(0.8);
            expect(differing.quotaDiffers).toBe(true);
            expect(differing.resetDiffers).toBe(true);
        });

        it('deduplicates Extra/XHigh aliases but retains conflicting readings', () => {
            const list = [config('gemini-4-hydrogen-xhigh', 'Gemini 4 Hydrogen (XHigh)'),
                config('Gemini 4 Hydrogen Extra', 'Gemini 4 Hydrogen Extra'), configs()[3]];
            expect(groupModelQuotas(list)[0].readings).toHaveLength(1);
            list[2].quotaInfo = { remainingFraction: 0.2, resetTime: RESET };
            const group = groupModelQuotas(list)[0];
            expect(group.readings).toHaveLength(2);
            expect(group.quotaDiffers).toBe(true);
        });

        it('preserves all four GM and DNA identities when the response reports only the family', () => {
            const entries: Record<string, PersistedModelDNA> = {};
            for (const model of HYDROGEN) {
                const id = `MODEL_PLACEHOLDER_${model.id}`;
                const call = parseGMEntry({ chatModel: { model: id, responseModel: 'gemini-4-hydrogen', usage: {} }, stepIndices: [1] });
                expect(call.model).toBe(id);
                expect(call.modelSource).toBe('chatModel');
                expect(call.modelDisplay).toBe(`Gemini 4 Hydrogen (${model.tier})`);
                expect(getModelDNAKey(call.modelDisplay, call.responseModel)).toBe(id);
                entries[id] = { displayName: `Gemini 4 Hydrogen (${model.zh}) (${model.id})`,
                    responseModel: 'gemini-4-hydrogen', apiProvider: 'GOOGLE_GEMINI', completionConfig: null,
                    hasSystemPrompt: false, toolCount: 0, promptSectionTitles: [] };
            }
            expect(Object.keys(restoreModelDNAState(serializeModelDNAState(entries))).sort()).toEqual(Object.keys(entries).sort());
        });

        it('retains exact per-tier and account totals through ledger restoration and duplicate polling', () => {
            const entries = HYDROGEN.map((model, index) => ({ dedupKey: `hydrogen-${model.id}`,
                call: { ...parseGMEntry({ executionId: `hydrogen-${model.id}`, stepIndices: [index],
                    chatModel: { model: `MODEL_PLACEHOLDER_${model.id}`, responseModel: 'gemini-4-hydrogen',
                        usage: { inputTokens: (index + 1) * 100, outputTokens: 10, thinkingOutputTokens: index, cacheReadTokens: 50 },
                        chatStartMetadata: { createdAt: new Date().toISOString() } },
                }), accountEmail: 'hydrogen@example.test' } }));
            const ledger = new DailyLedger();
            expect(ledger.recordCalls(entries)).toBe(4);
            const restored = DailyLedger.restore(ledger.serialize());
            expect(restored.recordCalls(entries)).toBe(0);
            const account = restored.getAccountActive('hydrogen@example.test')!;
            expect(Object.keys(account.modelStats)).toEqual(HYDROGEN.map(m => `Gemini 4 Hydrogen (${m.tier})`));
            expect(account.totalInputTokens).toBe(1000);
            expect(account.totalOutputTokens).toBe(40);
            expect(account.totalThinkingTokens).toBe(6);
            expect(restored.getAccountActive('other@example.test')).toBeNull();
        });
    });


    describe('Hydrogen available catalog and multilingual presentation', () => {
        it.each(['en', 'zh', 'both'] as Language[])('renders four real efforts and Extra quota label in %s', async language => {
            await setLanguageToState(language, state);
            const html = buildModelsTabContent(null, configs());
            expect(html.match(/class="spec-card"/g)).toHaveLength(4);
            for (const model of HYDROGEN) {
                expect(html).toContain(`Gemini 4 Hydrogen (${model.tier})`);
                expect(html).toContain(`gemini-4-hydrogen-${model.tier.toLowerCase()}`);
            }
            for (const value of ['1,048,576', '262,144', '512,000', '50,000']) expect(html).toContain(value);
            const quota = buildModelQuotaGrid(configs());
            expect(quota).toContain(language === 'zh' ? '低 · 中 · 高 · 超高' : 'Low · Medium · High · Extra High');
            expect(quota).not.toContain('undefined');
            const extraOnly = buildModelsTabContent(null, [configs()[3]]);
            expect(extraOnly.match(/class="spec-card"/g)).toHaveLength(1);
            expect(extraOnly).toContain('gemini-4-hydrogen-xhigh');
            expect(extraOnly).not.toContain('gemini-4-hydrogen-high');
            expect(buildModelsTabContent(null, [])).not.toContain('Gemini 4 Hydrogen');
        });

        it('orders Hydrogen ahead of Carbon and Argon while retaining recommendation and current-model precedence', () => {
            const ids = getModelSpecs().filter(s => /^gemini-4-(?:hydrogen|carbon|argon)-/.test(s.modelId)).map(s => s.placeholderId);
            expect(ids.slice(0, 4)).toEqual(['MODEL_PLACEHOLDER_M528', 'MODEL_PLACEHOLDER_M525', 'MODEL_PLACEHOLDER_M526', 'MODEL_PLACEHOLDER_M527']);
            const all = [config('MODEL_PLACEHOLDER_M427', 'Gemini 4 Carbon (High)'),
                config('MODEL_PLACEHOLDER_M417', 'Gemini 4 Argon (High)'), ...configs()];
            expect(selectQuotaRows(all, '', 3).rows[0].label).toMatch(/^Gemini 4 Hydrogen/);
            all[0].isRecommended = true;
            expect(selectQuotaRows(all, '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M427');
            for (const model of HYDROGEN) {
                const id = `MODEL_PLACEHOLDER_${model.id}`;
                expect(selectQuotaRows(all, id, 3).rows[0].model).toBe(id);
            }
        });
    });
});

describe('[hydrogen-ui]', () => {
    const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

    const hydrogenIds = ['M527', 'M526', 'M525', 'M528'];

    function config(id: string, quota = 0.8, label?: string): ModelConfig {
        const model = `MODEL_PLACEHOLDER_${id}`;
        return { model, label: label || getModelDisplayName(model), supportsImages: true, allowedTiers: [],
            mimeTypeCount: 0, isRecommended: false, supportedMimeTypes: [],
            quotaInfo: { remainingFraction: quota, resetTime: '2026-11-14T00:00:00Z' } };
    }


    afterEach(async () => {
        updateModelDisplayNames([], { authoritative: true });
        setAvailableImageModelIds([]);
        await setLanguageToState('both', state);
    });


    describe('Hydrogen four-effort UI', () => {
        it.each(['en', 'zh', 'both'] as Language[])('localizes Extra in pool membership and expanded readings in %s', async language => {
            await setLanguageToState(language, state);
            const configs = hydrogenIds.map((id, i) => config(id, i === 3 ? 0.2 : 0.8));
            const html = buildModelQuotaGrid(configs);
            const effortListText = language === 'en' ? 'Low · Medium · High · Extra High'
                : language === 'zh' ? '低 · 中 · 高 · 超高' : 'Low · Medium · High · Extra High / 低 · 中 · 高 · 超高';
            const extra = language === 'en' ? 'Extra High' : language === 'zh' ? '超高' : 'Extra High / 超高';
            expect(html).toContain(tBiHtml('Low · Medium · High · Extra High', '低 · 中 · 高 · 超高'));
            expect(html.replace(/<[^>]+>/g, '')).toContain(effortListText);
            expect(html).toContain(`Gemini 4 Hydrogen (${extra})`);
            expect(html).toContain('20–80%');
            expect(html).toContain('aria-valuenow="20"');
            expect(html).not.toContain('undefined');
            expect(html.match(/data-quota-family=/g)).toHaveLength(1);
            expect(html.match(/<li><span>Gemini 4 Hydrogen \(/g)).toHaveLength(4);
        });

        it.each(['en', 'zh', 'both'] as Language[])('only lists the available Extra tier after an account switch in %s', async language => {
            await setLanguageToState(language, state);
            const full = hydrogenIds.map(id => config(id));
            updateModelDisplayNames(full, { authoritative: true });
            expect(buildModelsTabContent(null, full).match(/class="spec-card"/g)).toHaveLength(4);
            const extraOnly = [config('M528')];
            updateModelDisplayNames(extraOnly, { authoritative: true });
            const html = buildModelsTabContent(null, extraOnly);
            expect(html.match(/class="spec-card"/g)).toHaveLength(1);
            expect(html).toContain('gemini-4-hydrogen-xhigh');
            expect(html).not.toContain('gemini-4-hydrogen-high');
            expect(html).not.toContain('gemini-4-hydrogen-medium');
            expect(html).not.toContain('gemini-4-hydrogen-low');
            expect(html).not.toContain('Low · Medium · High');
            updateModelDisplayNames([], { authoritative: true });
            expect(buildModelsTabContent(null, [])).not.toContain('class="spec-card"');
        });

        it.each(['en', 'zh', 'both'] as Language[])('keeps invalid Extra quota unknown and reports missing reset in %s', async language => {
            await setLanguageToState(language, state);
            const extra = config('M528', NaN);
            extra.quotaInfo!.resetTime = '2026-02-30T00:00:00Z';
            const html = buildModelQuotaGrid([extra]);
            expect(html).toContain(tBiHtml('Unknown', '未知'));
            expect(html).toContain(tBiHtml('Reset time unavailable', '暂无重置时间'));
            expect(html.replace(/<[^>]+>/g, '')).toContain(language === 'zh' ? '暂无重置时间' : 'Reset time unavailable');
            expect(html).not.toContain('aria-valuenow=');
            expect(html).not.toMatch(/NaN|Infinity|undefined/);
        });

        it('escapes account-supplied Hydrogen labels in both cards and quota details', () => {
            const label = 'Gemini 4 Hydrogen (Extra) <img src=x onerror="injected()">';
            const html = buildModelsTabContent(null, [config('M528', 0.2, label), config('M527', 0.8)]);
            expect(html).not.toContain('<img');
            expect(html).toContain('&lt;img');
            expect(html).toContain('gemini-4-hydrogen-xhigh');
        });
    });
});

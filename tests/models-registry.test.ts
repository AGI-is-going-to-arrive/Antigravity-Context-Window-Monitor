import { describe, expect, it } from 'vitest';
import {
    guessContextLimitSpec, getModelSpecs, resolveModelId, getContextLimit,
    getModelDisplayName, getModelBaseName, getQuotaPoolKey,
} from '../src/models';
import { findPricing } from '../src/pricing-store';

describe('guessContextLimitSpec placeholder collision guard', () => {
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

    it('maps Gemini 3.8 Flash placeholders (M318/M319/M320/M322) to the 256K flash profile', () => {
        for (const id of ['MODEL_PLACEHOLDER_M318', 'MODEL_PLACEHOLDER_M319', 'MODEL_PLACEHOLDER_M320', 'MODEL_PLACEHOLDER_M322']) {
            const spec = guessContextLimitSpec(id);
            expect(spec.cpLimit).toBe(256000);
            expect(spec.cpThreshold).toBe(140000);
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

    it('still keyword-matches catalog model_id names to the flash branch', () => {
        for (const name of ['gemini-3.6-flash-high', 'gemini-3.7-flash-high', 'gemini-3.8-flash-high']) {
            const spec = guessContextLimitSpec(name);
            expect(spec.cpLimit).toBe(256000);
            expect(spec.cpThreshold).toBe(140000);
            expect(spec.supportsThinking).toBe(true);
        }
    });

    // Anti-drift guard. The failure mode this pins is the one that actually shipped twice: a new or
    // renumbered model gets added to the spec table, but its M-number is forgotten in the exact-match
    // set inside guessContextLimitSpec — so it silently falls through to {0,0,0} and the UI shows a
    // permanent "calculating threshold…" shimmer. Every registered spec must be recognised.
    it('every registered model spec is recognised by guessContextLimitSpec (no {0,0,0} fallthrough)', () => {
        for (const spec of getModelSpecs()) {
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
    it('renders Gemini 3.8 then 3.7, 3.6, and 3.5 Flash tiers first, with retired M133 last', () => {
        const ids = getModelSpecs().map(s => s.placeholderId);
        expect(ids).toEqual([
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
            'MODEL_PLACEHOLDER_M35',
            'MODEL_PLACEHOLDER_M26',
            'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
            'MODEL_PLACEHOLDER_M133',
        ]);
    });
});

describe('model identity takeover + 3.6 pricing', () => {
    it('resolves gemini-3-flash-agent to M84 (identity takeover from M133)', () => {
        expect(resolveModelId('gemini-3-flash-agent')).toBe('MODEL_PLACEHOLDER_M84');
    });

    it('prices the Gemini 3.6 Flash family (input 1.50 / output 7.50)', () => {
        const pricing = findPricing('gemini-3.6-flash-high');
        expect(pricing).not.toBeNull();
        expect(pricing?.input).toBe(1.5);
        expect(pricing?.output).toBe(7.5);
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
                cpThreshold: 140_000,
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
        expect(findPricing('gemini-3.6-flash-high')?.output).toBe(7.5);
    });

    it('carries the live thinking profile (High dynamic, Medium 4000, Low 1000)', () => {
        const byId = new Map(getModelSpecs().map(s => [s.placeholderId, s]));
        expect(byId.get('MODEL_PLACEHOLDER_M318')?.thinkingBudget).toBe(-1);
        expect(byId.get('MODEL_PLACEHOLDER_M319')?.thinkingBudget).toBe(4000);
        expect(byId.get('MODEL_PLACEHOLDER_M320')?.thinkingBudget).toBe(1000);
        for (const id of pickerIds) {
            expect(byId.get(id)).toMatchObject({
                supportsThinking: true,
                maxTokens: 1_048_576,
                maxOutputTokens: 65_536,
                cpLimit: 256_000,
                cpThreshold: 140_000,
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
        expect(findPricing('gemini-3.6-flash-high')?.output).toBe(7.5);
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

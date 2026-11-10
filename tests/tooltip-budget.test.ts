import { beforeAll, describe, expect, it } from 'vitest';
import { updateModelSpec } from '../src/models';
import { selectQuotaRows, type QuotaSelectable } from '../src/tooltip-budget';

const CARBON_HIGH = 'MODEL_PLACEHOLDER_M427';
const CARBON_MEDIUM = 'MODEL_PLACEHOLDER_M437';
const ARGON_HIGH = 'MODEL_PLACEHOLDER_M417';

function model(id: string, label: string, isRecommended = false): QuotaSelectable {
    return { model: id, label, isRecommended,
        quotaInfo: { remainingFraction: 0.5, resetTime: '2026-11-11T12:00:00Z' } };
}

beforeAll(() => {
    // Match the live catalog's provider signal even before static registration.
    for (const id of [CARBON_HIGH, CARBON_MEDIUM]) {
        updateModelSpec(id, { apiProvider: 'GOOGLE_GEMINI' });
    }
});

describe('same-generation Gemini quota representative', () => {
    it.each([
        'Gemini 4 Carbon (High)',
        'Gemini 4 Carbon High',
        'Gemini 4 Carbon (高)',
        'Gemini 4 Carbon（高）',
        'Gemini 4 Carbon (High) (M427)',
    ])('prefers the newer Carbon family for %s without an active model or recommendation', label => {
        const carbon = model(CARBON_HIGH, label);
        const argon = model(ARGON_HIGH, 'Gemini 4 Argon (High)');
        for (const configs of [[argon, carbon], [carbon, argon]]) {
            const result = selectQuotaRows(configs, '', 3);
            expect(result.total).toBe(1);
            expect(result.rows[0]).toMatchObject({ model: CARBON_HIGH, poolSize: 2 });
        }
    });

    it('keeps the current model ahead of both recommendation and family recency', () => {
        const configs = [model(CARBON_HIGH, 'Gemini 4 Carbon (High)', true),
            model(ARGON_HIGH, 'Gemini 4 Argon (High)')];
        expect(selectQuotaRows(configs, ARGON_HIGH, 3).rows[0].model).toBe(ARGON_HIGH);
    });

    it('keeps a live Argon recommendation ahead of Carbon', () => {
        const configs = [model(CARBON_HIGH, 'Gemini 4 Carbon (High)'),
            model(ARGON_HIGH, 'Gemini 4 Argon (High)', true)];
        expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe(ARGON_HIGH);
    });

    it('uses Carbon recency when both families carry the same recommendation flag', () => {
        const configs = [model(ARGON_HIGH, 'Gemini 4 Argon (High)', true),
            model(CARBON_MEDIUM, 'Gemini 4 Carbon (Medium)', true)];
        expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe(CARBON_MEDIUM);
    });

    it('keeps a newer numeric generation ahead of Carbon', () => {
        const configs = [model(CARBON_HIGH, 'Gemini 4 Carbon (High)'),
            model(ARGON_HIGH, 'Gemini 4.1 Future (High)')];
        expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe(ARGON_HIGH);
    });

    it.each(['Gemini 4 Carbonated (High)', 'Gemini 4 Carbon (Highest)', 'Gemini 4 Carbon (Maximum)',
        'Gemini 4 CarbonHigh', 'Gemini 4 Carbon (High', 'Gemini 4 Carbon High)'])(
        'does not grant a known-family recency boost to %s', label => {
            const configs = [model(CARBON_HIGH, label), model(ARGON_HIGH, 'Gemini 4 Argon (High)')];
            expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe(ARGON_HIGH);
        },
    );

    it('does not mistake Gemini 40 for Gemini 4', () => {
        const configs = [model(CARBON_HIGH, 'Gemini 4 Carbon (High)'),
            model(ARGON_HIGH, 'Gemini 40 Argon (High)')];
        expect(selectQuotaRows(configs, '', 3).rows[0].model).toBe(ARGON_HIGH);
    });
});

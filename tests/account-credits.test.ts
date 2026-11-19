import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    aiCreditTotal, currentAICredits, formatCreditTypeLabel, isCurrentCreditType,
    parseCreditBalance, summarizeAccountCredits,
} from '../src/account-credits';
import { getLanguage, setLanguageToState, type Language } from '../src/i18n';
import type { CreditInfo } from '../src/models';

const initialLanguage = getLanguage();
const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };

function credit(creditType: string, creditAmount: number | null): CreditInfo {
    return { creditType, creditAmount, minimumCreditAmountForUsage: 1 };
}

beforeEach(async () => { await setLanguageToState('en', state); });
afterEach(async () => { await setLanguageToState(initialLanguage, state); });

describe('current account credit balances', () => {
    it.each([undefined, null, '', '  ', '3 credits', NaN, Infinity, -1])('keeps unavailable or invalid balance %s unknown', value => {
        expect(parseCreditBalance(value)).toBeNull();
    });

    it('preserves explicit zero and numeric server strings', () => {
        expect(parseCreditBalance(0)).toBe(0);
        expect(parseCreditBalance('0')).toBe(0);
        expect(parseCreditBalance('12.5')).toBe(12.5);
        expect(aiCreditTotal([credit('GOOGLE_ONE_AI', 0)])).toBe(0);
    });

    it('ignores legacy and unspecified credit kinds and deduplicates equivalent entries', () => {
        const rows = [
            credit('CREDIT_TYPE_PROMPT', 50_000),
            credit('FLOW', 150_000),
            credit('PROMPT_CREDITS', 100),
            credit('FLOW_CREDITS', 200),
            credit('CREDIT_TYPE_UNSPECIFIED', null),
            credit('CREDIT_TYPE_GOOGLE_ONE_AI', 1200),
            credit('google_one_ai', 1200),
        ];
        expect(isCurrentCreditType('CREDIT_TYPE_UNSPECIFIED')).toBe(false);
        expect(isCurrentCreditType('PROMPT_CREDITS')).toBe(false);
        expect(currentAICredits(rows)).toEqual([credit('GOOGLE_ONE_AI', 1200)]);
        expect(aiCreditTotal(rows)).toBe(1200);
    });

    it('leaves conflicting and unreported buckets unknown', () => {
        expect(aiCreditTotal([credit('GOOGLE_ONE_AI', null)])).toBeNull();
        expect(aiCreditTotal([credit('GOOGLE_ONE_AI', 5), credit('CREDIT_TYPE_GOOGLE_ONE_AI', 10)])).toBeNull();
        expect(aiCreditTotal([])).toBeNull();
    });

    it.each([
        ['en', 'Google AI credits', 'CUSTOM POOL'],
        ['zh', 'Google AI 积分', 'CUSTOM POOL'],
        ['both', 'Google AI credits / Google AI 积分', 'CUSTOM POOL'],
    ] as Array<[Language, string, string]>)('formats known and unknown credit labels cleanly in %s without duplication', async (lang, expectedKnown, expectedCustom) => {
        await setLanguageToState(lang, state);
        expect(formatCreditTypeLabel('CREDIT_TYPE_GOOGLE_ONE_AI')).toBe(expectedKnown);
        expect(formatCreditTypeLabel('CREDIT_TYPE_CUSTOM_POOL')).toBe(expectedCustom);
    });

    it('summarizes credits and billing-day expiry cleanly while distinguishing 0 from unknown', () => {
        const now = new Date(2026, 10, 19);
        const zeroSummary = summarizeAccountCredits([credit('GOOGLE_ONE_AI', 0)], 25, now);
        expect(zeroSummary).toMatchObject({ total: 0, known: true, billingDay: 25, daysUntilExpiry: 6 });

        const unknownSummary = summarizeAccountCredits([credit('CREDIT_TYPE_PROMPT', 99)], 40, now);
        expect(unknownSummary).toMatchObject({ entries: [], total: null, known: false, billingDay: 0, daysUntilExpiry: null });
    });
});

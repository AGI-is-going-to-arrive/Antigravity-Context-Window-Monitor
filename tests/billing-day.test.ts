import { describe, expect, it } from 'vitest';
import { getDaysUntilBillingDay } from '../src/billing-day';

describe('getDaysUntilBillingDay', () => {
    it('counts calendar days across DST boundaries', () => {
        const now = new Date(2026, 2, 31, 0, 30);

        expect(getDaysUntilBillingDay(30, now)).toBe(30);
    });
});

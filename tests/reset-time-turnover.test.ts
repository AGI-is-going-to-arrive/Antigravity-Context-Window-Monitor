import { describe, expect, it } from 'vitest';
import { shouldSettleOnResetTimeChange } from '../src/extension';

describe('shouldSettleOnResetTimeChange', () => {
    it('ignores minute-level resetTime drift while the old reset is still in the future', () => {
        const nowMs = Date.parse('2026-06-02T01:22:37.917Z');
        const oldResetTime = '2026-06-02T06:17:47Z';
        const newResetTime = '2026-06-02T06:20:51Z';

        expect(shouldSettleOnResetTimeChange(oldResetTime, newResetTime, nowMs)).toBe(false);
    });

    it('ignores tiny post-expiry nudges that look like server-side drift', () => {
        const nowMs = Date.parse('2026-06-02T06:18:30.000Z');
        const oldResetTime = '2026-06-02T06:17:47Z';
        const newResetTime = '2026-06-02T06:20:51Z';

        expect(shouldSettleOnResetTimeChange(oldResetTime, newResetTime, nowMs)).toBe(false);
    });

    it('accepts a real turnover after the old reset time has passed and the next cycle jumps forward', () => {
        const nowMs = Date.parse('2026-06-02T06:18:30.000Z');
        const oldResetTime = '2026-06-02T06:17:47Z';
        const newResetTime = '2026-06-02T11:20:51Z';

        expect(shouldSettleOnResetTimeChange(oldResetTime, newResetTime, nowMs)).toBe(true);
    });
});

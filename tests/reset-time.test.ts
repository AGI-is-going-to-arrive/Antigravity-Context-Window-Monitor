import { describe, expect, it } from 'vitest';
import {
    formatResetAbsolute,
    formatResetCountdown,
    formatResetCountdownFromMs,
    formatResetContext,
} from '../src/reset-time';

describe('reset-time helpers', () => {
    it('formats local absolute reset time with date context', () => {
        expect(formatResetAbsolute('2026-03-28T01:05:39Z', { includeSeconds: true })).toBe('03/28 09:05:39');
        expect(formatResetAbsolute('2026-03-28T01:05:39Z')).toBe('03/28 09:05');
    });

    it('formats countdowns with day precision for long windows', () => {
        expect(formatResetCountdownFromMs((((1 * 24) + 19) * 60) * 60 * 1000)).toBe('1d19h');
        expect(formatResetCountdownFromMs(((4 * 60) + 41) * 60 * 1000)).toBe('4h41m');
    });

    it('combines countdown and absolute time into one contextual label', () => {
        const nowMs = new Date('2026-03-26T05:33:41Z').getTime();
        expect(formatResetCountdown('2026-03-28T01:05:39Z', nowMs)).toBe('1d19h');
        expect(formatResetContext('2026-03-28T01:05:39Z', { nowMs })).toBe('1d19h (03/28 09:05)');
    });
});

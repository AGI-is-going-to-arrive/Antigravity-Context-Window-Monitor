import { describe, expect, it } from 'vitest';
import {
    formatResetAbsolute,
    formatResetCountdown,
    formatResetCountdownFromMs,
    formatResetContext,
} from '../src/reset-time';

function pad(value: number): string {
    return value.toString().padStart(2, '0');
}

function formatExpectedLocal(iso: string, includeSeconds = false): string {
    const date = new Date(iso);
    const time = includeSeconds
        ? `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
        : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}`;
}

describe('reset-time helpers', () => {
    it('formats local absolute reset time with date context', () => {
        expect(formatResetAbsolute('2026-03-28T01:05:39Z', { includeSeconds: true })).toBe(
            formatExpectedLocal('2026-03-28T01:05:39Z', true),
        );
        expect(formatResetAbsolute('2026-03-28T01:05:39Z')).toBe(
            formatExpectedLocal('2026-03-28T01:05:39Z'),
        );
    });

    it('formats countdowns with day precision for long windows', () => {
        expect(formatResetCountdownFromMs((((1 * 24) + 19) * 60) * 60 * 1000)).toBe('1d19h');
        expect(formatResetCountdownFromMs(((4 * 60) + 41) * 60 * 1000)).toBe('4h41m');
    });

    it('combines countdown and absolute time into one contextual label', () => {
        const nowMs = new Date('2026-03-26T05:33:41Z').getTime();
        expect(formatResetCountdown('2026-03-28T01:05:39Z', nowMs)).toBe('1d19h');
        expect(formatResetContext('2026-03-28T01:05:39Z', { nowMs })).toBe(
            `1d19h (${formatExpectedLocal('2026-03-28T01:05:39Z')})`,
        );
    });
});

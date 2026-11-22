import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
    translations,
    getLanguage,
    setLanguageInMemory,
    setLanguageToState,
    initI18nFromState,
    isLanguage,
    t,
    tBi,
    tBiHtml,
    formatNumber,
    formatClockTime,
    type Language,
} from '../src/i18n-core';
import * as i18nWrapper from '../src/i18n';

describe('i18n-core pure localization & v1.17.5 keys', () => {
    const initialLang = getLanguage();

    afterEach(() => {
        setLanguageInMemory(initialLang);
    });

    it('contains zero vscode imports in src/i18n-core.ts and loads cleanly in pure Node without vscode', () => {
        const coreSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'i18n-core.ts'), 'utf8');
        expect(coreSource).not.toMatch(/from\s+['"]vscode['"]|require\(\s*['"]vscode['"]\s*\)/);

        const compiledCore = path.resolve(__dirname, '..', 'out', 'i18n-core.js');
        const compiledWrapper = path.resolve(__dirname, '..', 'out', 'i18n.js');
        if (fs.existsSync(compiledCore) && fs.existsSync(compiledWrapper)) {
            const out = execFileSync(process.execPath, ['-e', `
                const core = require(${JSON.stringify(compiledCore)});
                const wrap = require(${JSON.stringify(compiledWrapper)});
                core.setLanguageInMemory('zh');
                console.log(JSON.stringify({
                    sameLang: wrap.getLanguage(),
                    key: core.t('context.breakdown'),
                    clock: core.formatClockTime(new Date(2026, 10, 22, 0, 5, 9), 'zh'),
                }));
            `], { encoding: 'utf8', windowsHide: true });
            const parsed = JSON.parse(out.trim()) as { sameLang: string; key: string; clock: string };
            expect(parsed).toEqual({
                sameLang: 'zh',
                key: '上下文构成',
                clock: '00:05:09',
            });
        }
    });

    it('re-exports all core helpers from src/i18n.ts and shares live language state', async () => {
        const store = new Map<string, unknown>();
        const bucket = {
            get<T>(k: string, d: T): T { return store.has(k) ? store.get(k) as T : d; },
            async update(k: string, v: unknown): Promise<void> { store.set(k, v); },
        };

        await setLanguageToState('en', bucket);
        expect(i18nWrapper.getLanguage()).toBe('en');
        expect(i18nWrapper.t('context.dotMatrix')).toBe('Dot Matrix');
        expect(i18nWrapper.formatClockTime).toBe(formatClockTime);
        expect(i18nWrapper.translations).toBe(translations);

        store.set('displayLanguage', 'zh');
        initI18nFromState(bucket);
        expect(getLanguage()).toBe('zh');
        expect(i18nWrapper.getLanguage()).toBe('zh');
    });

    it('provides complete, natural EN/ZH translations for all v1.17.5 keys with zero machine-translated 令牌', () => {
        const requiredKeys = [
            'context.breakdown',
            'context.dotMatrix',
            'context.barView',
            'context.effectiveBudget',
            'context.nativeCeiling',
            'context.measured',
            'context.estimated',
            'context.postCompaction',
            'context.rewind',
            'context.awaitingGeneration',
            'context.largestItems',
            'agent.lockToMain',
            'agent.followActive',
            'agent.conversationSwitcher',
            'turn.coldStart',
            'turn.partialStart',
            'turn.warmStart',
            'turn.lastTurnCache',
            'turn.sessionCache',
            'quota.runway',
            'quota.safeBeforeReset',
            'quota.exhaustsIn',
            'quota.cachedStale',
            'quota.customModelIsolated',
            'action.copyContextReport',
            'action.copyHandoffPrompt',
            'action.copied',
            'surface.antigravityApp',
            'surface.antigravityIde',
        ];

        for (const key of requiredKeys) {
            expect(translations[key], `missing translation key ${key}`).toBeDefined();
            expect(translations[key].en.trim().length).toBeGreaterThan(0);
            expect(translations[key].zh.trim().length).toBeGreaterThan(0);
        }

        // Enforce developer terminology rule across ALL keys.
        for (const [key, entry] of Object.entries(translations)) {
            expect(entry.zh, `forbidden term 令牌 in ${key}`).not.toContain('令牌');
        }

        // Verify surface deduplication in 'both' mode (identical EN/ZH never duplicates).
        expect(t('surface.antigravityApp', 'both')).toBe('Antigravity App');
        expect(t('surface.antigravityIde', 'both')).toBe('Antigravity IDE');
        expect(t('context.breakdown', 'en')).toBe('Context Breakdown');
        expect(t('context.breakdown', 'zh')).toBe('上下文构成');
        expect(t('context.breakdown', 'both')).toBe('Context Breakdown / 上下文构成');
    });

    it('supports explicit per-call language overrides without mutating global state', () => {
        setLanguageInMemory('zh');
        expect(t('action.copyHandoffPrompt', 'en')).toBe('Copy Handoff Prompt');
        expect(tBi('Measured', '实测', ' / ', 'en')).toBe('Measured');
        expect(tBiHtml('Measured', '实测', ' / ', 'both')).toBe(
            '<span class="bi-en">Measured</span><span class="bi-sep"> / </span><span class="bi-zh">实测</span>',
        );
        expect(formatNumber(12345, undefined, 'en')).toBe('12,345');
        expect(getLanguage()).toBe('zh');
    });

    it('formats deterministic 24-hour HH:MM:SS clock times via formatClockTime regardless of host locale', () => {
        const midnight = new Date(2026, 10, 22, 0, 5, 9);
        const afternoon = new Date(2026, 10, 22, 14, 30, 45);
        const lateNight = new Date(2026, 10, 22, 23, 59, 59);

        for (const lang of ['en', 'zh', 'both'] as Language[]) {
            expect(formatClockTime(midnight, lang)).toBe('00:05:09');
            expect(formatClockTime(afternoon, lang)).toBe('14:30:45');
            expect(formatClockTime(lateNight, lang)).toBe('23:59:59');
        }

        expect(formatClockTime(new Date('not-a-date'), 'en')).toBe('--:--:--');
        expect(isLanguage('en')).toBe(true);
        expect(isLanguage('fr')).toBe(false);
    });
});

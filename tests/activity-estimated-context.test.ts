import { afterEach, describe, expect, it } from 'vitest';
import { buildGMDataTabContent } from '../src/activity-panel';
import { ActivityTracker } from '../src/activity-tracker';
import { parseGMEntry } from '../src/gm/parser';
import { buildSummaryFromConversations } from '../src/gm/summary';
import { setLanguageToState, type Language } from '../src/i18n';
import type { StateBucket } from '../src/durable-state';

const state: StateBucket = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };
afterEach(() => setLanguageToState('both', state));

describe('GM estimated context labels', () => {
    it.each(['en', 'zh', 'both'] as Language[])('distinguishes request estimates from reported tokens throughout the %s panel', async language => {
        await setLanguageToState(language, state);
        const calls = [0, 1].map(index => parseGMEntry({ stepIndices: [index + 1], chatModel: {
            model: 'MODEL_PLACEHOLDER_M419', responseModel: 'gemini-4-argon',
            usage: { inputTokens: 12905, outputTokens: 32 },
            completionConfig: { maxTokens: 65536, temperature: 1, topP: 1 },
            chatStartMetadata: { createdAt: `2026-10-31T00:00:0${index}.000Z`,
                contextWindowMetadata: { estimatedTokensUsed: 18324, maxContextTokens: 256000,
                    tokenBreakdown: { groups: [{ name: 'Prompt', numTokens: 18324, children: [] }] } } },
        } }));
        const gm = buildSummaryFromConversations([{ cascadeId: 'fixture', title: 'Fixture', totalSteps: 2,
            coveredSteps: 2, coverageRate: 1, calls, checkpointSummaries: [] }], '2026-10-31T00:00:02.000Z')!;
        const summary = new ActivityTracker().getSummary();
        summary.totalReasoning = 2;
        summary.recentSteps = calls.map((call, index) => ({ timestamp: call.createdAt, category: 'reasoning',
            icon: '', model: call.modelDisplay, detail: '', durationMs: 0, stepIndex: index + 1,
            cascadeId: 'fixture', gmModel: call.model, gmInputTokens: call.inputTokens,
            gmOutputTokens: call.outputTokens, gmContextTokensUsed: call.contextTokensUsed }));
        const html = buildGMDataTabContent(summary, gm);
        const label = language === 'en' ? 'Estimated context' : language === 'zh' ? '估算上下文' : 'Estimated context / 估算上下文';
        const chart = language === 'en' ? 'Estimated context growth' : language === 'zh' ? '估算上下文增长' : 'Estimated context growth / 估算上下文增长';
        for (const className of ['act-tl-gm-tag act-tl-gm-ctx', 'seg-chip seg-chip-ctx', 'cp-card-chip cp-card-chip-step']) {
            expect(html).toContain(`class="${className}" title=`);
            expect(html).toMatch(new RegExp(`class="${className}" title="[^"]+">${label} 18\\.3k`));
        }
        expect(html).toContain(chart);
        expect(html).toContain(language === 'zh' ? '可能与回复后报告的 Token 数不同' : 'may differ from the token counts reported after the response');
        expect(html).toContain(language === 'zh' ? '最新估算上下文 Token 分布' : 'Latest estimated context token distribution');
        expect(html).not.toContain('18.3k ctx');
        expect(html).not.toMatch(/>Ctx 18\.3k<|>上下文 18\.3k</);
        expect(calls.map(call => [call.contextTokensUsed, call.inputTokens, call.outputTokens])).toEqual([
            [18324, 12905, 32], [18324, 12905, 32],
        ]);
        expect(gm.contextGrowth.map(point => point.tokens)).toEqual([18324, 18324]);
    });
});

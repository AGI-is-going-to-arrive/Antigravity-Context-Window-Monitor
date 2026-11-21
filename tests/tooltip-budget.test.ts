import { beforeAll, describe, expect, it } from 'vitest';
import { updateModelSpec } from '../src/models';
import {
    applySectionBudget,
    countSectionLines,
    getSectionLineBudget,
    renderHoverSections,
    SECTION_COMPACT_MAX_LINES,
    SECTION_FULL_MAX_LINES,
    SECTION_NORMAL_MAX_LINES,
    selectQuotaRows,
    type HoverSection,
    type QuotaSelectable,
} from '../src/tooltip-budget';

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

    it('prefers Gemini 4 Neon ahead of Hydrogen and Carbon without recommendation (including bilingual slash labels)', () => {
        const neon = model('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon (Extra High)');
        const hydrogen = model('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (Extra High)');
        const carbon = model(CARBON_HIGH, 'Gemini 4 Carbon (High)');
        expect(selectQuotaRows([carbon, hydrogen, neon], '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M535');

        const biNeon = model('MODEL_PLACEHOLDER_M535', 'Gemini 4 Neon (Extra High / 超高)');
        const biHydrogen = model('MODEL_PLACEHOLDER_M528', 'Gemini 4 Hydrogen (Extra High / 超高)');
        const biCarbon = model(CARBON_HIGH, 'Gemini 4 Carbon (High / 高)');
        expect(selectQuotaRows([biCarbon, biHydrogen, biNeon], '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M535');
        expect(selectQuotaRows([biCarbon, biHydrogen], '', 3).rows[0].model).toBe('MODEL_PLACEHOLDER_M528');
    });
});

describe('priority-tiered hover section budget (P0..P5)', () => {
    it('computes zoom-aware line budgets with strict mode caps and safety floors', () => {
        expect(getSectionLineBudget('compact', 'compact', 0)).toBe(SECTION_COMPACT_MAX_LINES);
        expect(getSectionLineBudget('auto', 'normal', 0)).toBe(SECTION_NORMAL_MAX_LINES);
        expect(getSectionLineBudget('auto', 'compact', 0)).toBe(SECTION_COMPACT_MAX_LINES);
        expect(getSectionLineBudget('full', 'normal', 0)).toBe(SECTION_FULL_MAX_LINES);
        expect(SECTION_COMPACT_MAX_LINES).toBeLessThanOrEqual(14);
        expect(SECTION_NORMAL_MAX_LINES).toBeLessThanOrEqual(22);
        expect(SECTION_FULL_MAX_LINES).toBeLessThanOrEqual(32);

        // Positive zoom tightens the budget, clamped to safe floors
        expect(getSectionLineBudget('auto', 'normal', 1)).toBe(20);
        expect(getSectionLineBudget('auto', 'normal', 5)).toBe(16);
        expect(getSectionLineBudget('compact', 'compact', 5)).toBe(10);
        expect(getSectionLineBudget('full', 'normal', 5)).toBe(24);
        // Negative / non-finite zoom does not penalize
        expect(getSectionLineBudget('auto', 'normal', -1)).toBe(SECTION_NORMAL_MAX_LINES);
        expect(getSectionLineBudget('auto', 'normal', Number.NaN)).toBe(SECTION_NORMAL_MAX_LINES);
    });

    it('counts visual lines including inter-section dividers and ignores empty sections', () => {
        const sections: HoverSection[] = [
            { id: 'header', priority: 0, lines: ['Header line 1', 'Header line 2'] },
            { id: 'empty', priority: 4, lines: [] },
            { id: 'footer', priority: 0, lines: ['Footer'], pinBottom: true },
        ];
        // 2 + 1 + 1 divider = 4
        expect(countSectionLines(sections)).toBe(4);
        expect(countSectionLines(sections, 0)).toBe(3);
    });

    it('compacts before dropping within a tier, drops P5->P1, never drops P0, and pins footer last', () => {
        const sections: HoverSection[] = [
            { id: 'header', priority: 0, lines: ['H1', 'H2'] },
            { id: 'footer', priority: 0, lines: ['Footer CTA'], pinBottom: true }, // intentionally out of order
            { id: 'context', priority: 0, lines: ['C1', 'C2'] },
            { id: 'session-kpi', priority: 1, lines: ['K1', 'K2', 'K3', 'K4'], compactLines: ['K-compact'] },
            { id: 'quota', priority: 2, lines: ['Q1', 'Q2', 'Q3', 'Q4'], compactLines: ['Q-compact'] },
            { id: 'latest-call', priority: 3, lines: ['L1', 'L2', 'L3', 'L4'], compactLines: ['L-compact'] },
            { id: 'alerts', priority: 4, lines: ['A1', 'A2'] },
            { id: 'diagnostics', priority: 5, lines: ['D1', 'D2', 'D3'] },
        ];

        // Tight budget (16): P5 diagnostics dropped, P4 alerts dropped, P3 latest-call compacted (or dropped)
        const res = applySectionBudget(sections, 16);
        expect(res.totalLines).toBeLessThanOrEqual(16);
        expect(res.droppedIds).toContain('diagnostics');
        expect(res.droppedIds).toContain('alerts');
        // Header & Context (P0) always kept; Footer ALWAYS last
        const ids = res.sections.map(s => s.id);
        expect(ids[0]).toBe('header');
        expect(ids).toContain('context');
        expect(ids[ids.length - 1]).toBe('footer');
    });

    it('uses compactLines on lower-priority section before dropping it when compaction meets budget', () => {
        const sections: HoverSection[] = [
            { id: 'header', priority: 0, lines: ['H1', 'H2'] },
            { id: 'latest', priority: 3, lines: ['L1', 'L2', 'L3', 'L4', 'L5'], compactLines: ['L-short'] },
            { id: 'footer', priority: 0, lines: ['Footer'], pinBottom: true },
        ];
        // Full = 2+5+1 + 2 dividers = 10; Compacted = 2+1+1 + 2 dividers = 6
        const res = applySectionBudget(sections, 7);
        expect(res.compactedIds).toEqual(['latest']);
        expect(res.droppedIds).toEqual([]);
        expect(res.sections.find(s => s.id === 'latest')?.lines).toEqual(['L-short']);
        expect(res.totalLines).toBe(6);

        // When even compactLines still exceeds budget, Pass B drops it and removes it from compactedIds
        const dropped = applySectionBudget(sections, 5);
        expect(dropped.droppedIds).toEqual(['latest']);
        expect(dropped.compactedIds).toEqual([]);
    });

    it('keeps P0 and pinned footer intact even when they alone exceed budget', () => {
        const sections: HoverSection[] = [
            { id: 'header', priority: 0, lines: ['H1', 'H2', 'H3'] },
            { id: 'context', priority: 0, lines: ['C1', 'C2', 'C3'] },
            { id: 'optional', priority: 1, lines: ['O1', 'O2'] },
            { id: 'footer', priority: 0, lines: ['Footer'], pinBottom: true },
        ];
        const res = applySectionBudget(sections, 4);
        expect(res.sections.map(s => s.id)).toEqual(['header', 'context', 'footer']);
        expect(res.droppedIds).toEqual(['optional']);
    });

    it('compacts P0 sections with compactLines when P0 alone exceeds budget without ever dropping P0', () => {
        const sections: HoverSection[] = [
            { id: 'hero', priority: 0, lines: ['H1', 'H2', 'H3'], compactLines: ['H1', 'H3'] },
            { id: 'quota', priority: 0, lines: ['Q-title', 'Q1', 'Q2', 'Q3'], compactLines: ['Q-1line'] },
            { id: 'kpi', priority: 1, lines: ['K1', 'K2'] },
            { id: 'footer', priority: 0, lines: ['Footer'], pinBottom: true },
        ];
        // Tight budget (7): P1 kpi drops first, then P0 quota compacts (4->1): 3+1+1 + 2 dividers = 7 <= 7
        const tight = applySectionBudget(sections, 7);
        expect(tight.droppedIds).toEqual(['kpi']);
        expect(tight.compactedIds).toEqual(['quota']);
        expect(tight.sections.map(s => s.id)).toEqual(['hero', 'quota', 'footer']);
        expect(tight.sections.find(s => s.id === 'quota')?.lines).toEqual(['Q-1line']);
        expect(tight.totalLines).toBe(7);

        // Extreme budget (5): hero also compacts (3->2): 2+1+1 + 2 dividers = 6, still never drops any P0 section
        const extreme = applySectionBudget(sections, 5);
        expect(extreme.droppedIds).toEqual(['kpi']);
        expect(extreme.compactedIds).toEqual(['quota', 'hero']);
        expect(extreme.sections.map(s => s.id)).toEqual(['hero', 'quota', 'footer']);
    });

    it('renders prose with soft breaks and separates GFM tables cleanly for VS Code MarkdownString', () => {
        const md = renderHoverSections([
            {
                id: 'latest',
                priority: 3,
                lines: [
                    '$(history) **Latest Call** · `gemini-4-carbon`',
                    '| In / Out | Cache | Cost | Speed |',
                    '| :--- | ---: | ---: | ---: |',
                    '| 4,543 / 388 | **97.96%** | **$0.065** | **155** tok/s |',
                    'Note after table',
                ],
            },
            {
                id: 'footer',
                priority: 0,
                lines: ['Line A', 'Line B'],
                pinBottom: true,
            },
        ]);

        // Blank line inserted between prose title and GFM table header
        expect(md).toContain('$(history) **Latest Call** · `gemini-4-carbon`\n\n| In / Out | Cache | Cost | Speed |');
        // Consecutive table rows joined with plain newline (no trailing two spaces)
        expect(md).toContain('| In / Out | Cache | Cost | Speed |\n| :--- | ---: | ---: | ---: |\n| 4,543 / 388 | **97.96%** | **$0.065** | **155** tok/s |');
        // Blank line after table before trailing prose
        expect(md).toContain('| **155** tok/s |\n\nNote after table');
        // Sections separated by horizontal rule and prose lines joined with two-space soft break
        expect(md).toContain('\n\n---\n\nLine A  \nLine B');
    });
});

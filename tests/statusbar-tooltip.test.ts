/**
 * Unit tests for issue #63 tooltip density / quota row budget.
 * Pure functions — no VS Code UI required (vscode mocked via vitest alias).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { Language } from '../src/i18n';
import { getLanguage, setLanguage, tBi } from '../src/i18n';
import type { GMCallEntry, GMConversationData, GMSummary } from '../src/gm/types';
import type { ContextUsage } from '../src/tracker';
import { StatusBarManager } from '../src/statusbar';
import {
    applyLineBudget,
    COMPACT_MAX_LINES,
    COMPACT_MAX_QUOTA_ROWS,
    ensureCtaLast,
    findQuotaTableRange,
    getLineBudget,
    getMaxQuotaRows,
    isQuotaMoreLine,
    isQuotaSectionTitle,
    measureDisplayWidth,
    NORMAL_MAX_LINES,
    NORMAL_MAX_QUOTA_ROWS,
    LABEL_MAX_DISPLAY_WIDTH,
    parseTooltipDensity,
    poolSizeSuffix,
    resolveEffectiveMode,
    selectQuotaRows,
    truncateByDisplayWidth,
    type TooltipDensity,
} from '../src/tooltip-budget';

// Minimal ExtensionContext stub for setLanguage
function makeCtx() {
    const store = new Map<string, unknown>();
    return {
        globalState: {
            get: <T>(key: string, defaultValue?: T) =>
                (store.has(key) ? store.get(key) : defaultValue) as T,
            update: async (key: string, value: unknown) => {
                store.set(key, value);
            },
        },
    } as unknown as import('vscode').ExtensionContext;
}

function makeModel(
    model: string,
    label: string,
    remainingFraction: number,
    resetTime?: string,
): { model: string; label: string; quotaInfo: { remainingFraction: number; resetTime: string } } {
    return {
        model,
        label,
        // Unique resetTime so unknown ids do not share getQuotaPoolKey's fallback pool.
        quotaInfo: { remainingFraction, resetTime: resetTime ?? `${model}-reset` },
    };
}

describe('selectQuotaRows', () => {
    const models = [
        makeModel('m-a', 'Alpha', 0.90),
        makeModel('m-b', 'Bravo', 0.10),
        makeModel('m-c', 'Charlie', 0.50),
        makeModel('m-d', 'Delta', 0.05),
        makeModel('m-e', 'Echo', 0.05), // same fraction as Delta → label order
        makeModel('m-cur', 'CurrentModel', 0.80),
    ];

    it('pins current model first', () => {
        const { rows } = selectQuotaRows(models, 'm-cur', 3);
        expect(rows[0].model).toBe('m-cur');
        expect(rows).toHaveLength(3);
    });

    it('orders remaining by remainingFraction ascending (most strained first)', () => {
        const { rows } = selectQuotaRows(models, 'm-cur', 10);
        // after current: m-d (0.05 Delta), m-e (0.05 Echo), m-b (0.10), m-c (0.50), m-a (0.90)
        expect(rows.map(r => r.model)).toEqual([
            'm-cur', 'm-d', 'm-e', 'm-b', 'm-c', 'm-a',
        ]);
    });

    it('stable label localeCompare on equal fractions', () => {
        const { rows } = selectQuotaRows(models, '', 10);
        const idxD = rows.findIndex(r => r.model === 'm-d');
        const idxE = rows.findIndex(r => r.model === 'm-e');
        expect(idxD).toBeLessThan(idxE); // Delta before Echo
    });

    it('computes hiddenCount correctly', () => {
        const { rows, hiddenCount, total } = selectQuotaRows(models, 'm-cur', 3);
        expect(total).toBe(6);
        expect(rows).toHaveLength(3);
        expect(hiddenCount).toBe(3);
    });

    it('deduplicates by model id', () => {
        const dup = [...models, makeModel('m-cur', 'Current Dup', 0.01)];
        const { rows, total } = selectQuotaRows(dup, 'm-cur', 20);
        expect(rows.filter(r => r.model === 'm-cur')).toHaveLength(1);
        expect(total).toBe(6);
    });

    it('returns all rows with hiddenCount=0 when maxRows is Infinity', () => {
        const { rows, hiddenCount } = selectQuotaRows(models, 'm-cur', Number.POSITIVE_INFINITY);
        expect(rows).toHaveLength(6);
        expect(hiddenCount).toBe(0);
    });

    it('handles missing current model', () => {
        const { rows } = selectQuotaRows(models, 'no-such', 2);
        expect(rows[0].model).toBe('m-d'); // most strained
        expect(rows).toHaveLength(2);
    });

    it('ignores models without quotaInfo', () => {
        const mixed = [
            ...models,
            { model: 'no-q', label: 'NoQuota' },
        ];
        const { total } = selectQuotaRows(mixed as typeof models, 'm-cur', 20);
        expect(total).toBe(6);
    });

    it('collapses models that share a quota pool into one row', () => {
        const gemini = [
            makeModel('MODEL_PLACEHOLDER_M318', 'Gemini 3.8 Flash (High)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M319', 'Gemini 3.8 Flash (Medium)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M320', 'Gemini 3.8 Flash (Low)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M298', 'Gemini 3.7 Flash (High)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M299', 'Gemini 3.7 Flash (Medium)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M300', 'Gemini 3.7 Flash (Low)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M71', 'Gemini 3.6 Flash (High)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M72', 'Gemini 3.6 Flash (Medium)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M73', 'Gemini 3.6 Flash (Low)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M16', 'Gemini 3.1 Pro (High)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M36', 'Gemini 3.1 Pro (Low)', 0.42),
        ];
        const payload = [
            ...gemini,
            makeModel('MODEL_PLACEHOLDER_M35', 'Claude Sonnet 4.6 (Thinking)', 0.80),
            makeModel('MODEL_PLACEHOLDER_M26', 'Claude Opus 4.6 (Thinking)', 0.80),
            makeModel('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 'GPT-OSS 120B (Medium)', 0.80),
        ];

        const compact = selectQuotaRows(payload, 'MODEL_PLACEHOLDER_M318', 3);
        expect(compact.total).toBe(2);
        expect(compact.rows).toHaveLength(2);
        expect(compact.hiddenCount).toBe(0);
        expect(compact.rows[0].model).toBe('MODEL_PLACEHOLDER_M318');
        expect(compact.rows[0].label).toBe('Gemini 3.8 Flash (High) · 11');
        expect(compact.rows[1].label).toMatch(/ · 3$/);

        const noCurrent = selectQuotaRows(payload, '', 3);
        expect(noCurrent.rows[0].model).toBe('MODEL_PLACEHOLDER_M318');
        expect(noCurrent.rows[0].label).toBe('Gemini 3.8 Flash (High) · 11');

        const currentIs31 = selectQuotaRows(payload, 'MODEL_PLACEHOLDER_M16', 3);
        expect(currentIs31.rows[0].model).toBe('MODEL_PLACEHOLDER_M16');
        expect(currentIs31.rows[0].label).toBe('Gemini 3.1 Pro (High) · 11');
    });
});

describe('resolveEffectiveMode', () => {
    const cases: Array<{
        name: string;
        density: TooltipDensity;
        zoom: number;
        rows: number;
        lang: Language;
        expect: 'compact' | 'normal';
    }> = [
        { name: 'compact setting always compact', density: 'compact', zoom: 0, rows: 1, lang: 'en', expect: 'compact' },
        { name: 'full setting → normal layout', density: 'full', zoom: 2, rows: 20, lang: 'both', expect: 'normal' },
        { name: 'auto zoom=0 few rows → normal', density: 'auto', zoom: 0, rows: 3, lang: 'en', expect: 'normal' },
        { name: 'auto zoom=0.5 boundary → compact', density: 'auto', zoom: 0.5, rows: 1, lang: 'en', expect: 'compact' },
        { name: 'auto zoom=0.49 below boundary', density: 'auto', zoom: 0.49, rows: 1, lang: 'en', expect: 'normal' },
        { name: 'auto zoom=1 → compact', density: 'auto', zoom: 1, rows: 2, lang: 'en', expect: 'compact' },
        { name: 'auto zoom=2 → compact', density: 'auto', zoom: 2, rows: 2, lang: 'en', expect: 'compact' },
        { name: 'auto zoom>0 and rows>4 → compact', density: 'auto', zoom: 0.2, rows: 5, lang: 'en', expect: 'compact' },
        { name: 'auto zoom>0 and rows=4 stays normal if not bilingual heavy', density: 'auto', zoom: 0.2, rows: 4, lang: 'en', expect: 'normal' },
        { name: 'auto many rows (>8) → compact', density: 'auto', zoom: 0, rows: 9, lang: 'en', expect: 'compact' },
        { name: 'auto bilingual penalty: 7+2*1=9 → compact', density: 'auto', zoom: 0, rows: 7, lang: 'both', expect: 'compact' },
        { name: 'auto bilingual: 6+2=8 not >8 → normal', density: 'auto', zoom: 0, rows: 6, lang: 'both', expect: 'normal' },
        { name: 'auto negative zoom stays normal with few rows', density: 'auto', zoom: -1, rows: 3, lang: 'en', expect: 'normal' },
    ];

    for (const c of cases) {
        it(c.name, () => {
            expect(resolveEffectiveMode(c.density, c.zoom, c.rows, c.lang)).toBe(c.expect);
        });
    }
});

describe('getMaxQuotaRows / getLineBudget', () => {
    it('compact mode → 3 rows / compact line budget', () => {
        expect(getMaxQuotaRows('auto', 'compact')).toBe(COMPACT_MAX_QUOTA_ROWS);
        expect(getMaxQuotaRows('compact', 'compact')).toBe(3);
        expect(getLineBudget('auto', 'compact')).toBe(COMPACT_MAX_LINES);
    });

    it('normal mode → 5 rows safety cap', () => {
        expect(getMaxQuotaRows('auto', 'normal')).toBe(NORMAL_MAX_QUOTA_ROWS);
        expect(getMaxQuotaRows('auto', 'normal')).toBe(5);
    });

    it('full density never truncates rows / no soft line budget', () => {
        expect(getMaxQuotaRows('full', 'normal')).toBe(Number.POSITIVE_INFINITY);
        expect(getLineBudget('full', 'normal')).toBe(Number.POSITIVE_INFINITY);
    });
});

describe('quota more interpolation (tBi)', () => {
    let prevLang: Language;

    beforeEach(() => {
        prevLang = getLanguage();
    });

    afterEach(async () => {
        await setLanguage(prevLang, makeCtx());
    });

    it('en: interpolates N correctly', async () => {
        await setLanguage('en', makeCtx());
        const n = 7;
        const msg = tBi(
            `… and ${n} more models — click to view all`,
            `… 还有 ${n} 个模型，点击查看全部`,
        );
        expect(msg).toBe('… and 7 more models — click to view all');
        expect(msg).toContain('7');
    });

    it('zh: interpolates N correctly', async () => {
        await setLanguage('zh', makeCtx());
        const n = 4;
        const msg = tBi(
            `… and ${n} more models — click to view all`,
            `… 还有 ${n} 个模型，点击查看全部`,
        );
        expect(msg).toBe('… 还有 4 个模型，点击查看全部');
    });

    it('both: contains both languages and N', async () => {
        await setLanguage('both', makeCtx());
        const n = 3;
        const msg = tBi(
            `… and ${n} more models — click to view all`,
            `… 还有 ${n} 个模型，点击查看全部`,
        );
        expect(msg).toContain('3');
        expect(msg).toContain('more models');
        expect(msg).toContain('还有');
    });
});

describe('ensureCtaLast / applyLineBudget', () => {
    const cta = '$(link-external) **Click to view details**';

    it('always ends with CTA', () => {
        const lines = ensureCtaLast(['title', 'body'], cta);
        expect(lines[lines.length - 1]).toBe(cta);
        expect(lines[lines.length - 1]).toContain('$(link-external)');
    });

    it('dedupes earlier CTA lines', () => {
        const lines = ensureCtaLast(['a', cta, 'b', cta], cta);
        expect(lines.filter(l => l.includes('$(link-external)'))).toHaveLength(1);
        expect(lines[lines.length - 1]).toBe(cta);
    });

    it('compact line budget never drops CTA', () => {
        const body = Array.from({ length: 40 }, (_, i) => `line-${i}`);
        const withCta = ensureCtaLast(body, cta);
        const capped = applyLineBudget(withCta, COMPACT_MAX_LINES);
        expect(capped.length).toBeLessThanOrEqual(COMPACT_MAX_LINES);
        expect(capped[capped.length - 1]).toBe(cta);
        expect(capped.some(l => l.includes('$(link-external)'))).toBe(true);
    });

    it('full (infinite) budget does not truncate', () => {
        const body = Array.from({ length: 50 }, (_, i) => `row-${i}`);
        const withCta = ensureCtaLast(body, cta);
        const capped = applyLineBudget(withCta, Number.POSITIVE_INFINITY);
        expect(capped.length).toBe(withCta.length);
        expect(capped[capped.length - 1]).toBe(cta);
    });

    it('build pipeline: select → more → CTA ending for compact-like flow', () => {
        const models = Array.from({ length: 10 }, (_, i) =>
            makeModel(`m${i}`, `Model ${i}`, (i + 1) / 10),
        );
        const maxRows = getMaxQuotaRows('auto', 'compact');
        const { rows, hiddenCount } = selectQuotaRows(models, 'm5', maxRows);
        expect(rows.length).toBeLessThanOrEqual(COMPACT_MAX_QUOTA_ROWS);
        expect(hiddenCount).toBe(10 - rows.length);

        const lines: string[] = [
            'title',
            ...rows.map(r => `| ${r.label} |`),
        ];
        if (hiddenCount > 0) {
            lines.push(
                tBi(
                    `… and ${hiddenCount} more models — click to view all`,
                    `… 还有 ${hiddenCount} 个模型，点击查看全部`,
                ),
            );
        }
        const final = applyLineBudget(ensureCtaLast(lines, cta), COMPACT_MAX_LINES);
        expect(final[final.length - 1]).toContain('$(link-external)');
        expect(final.some(l => l.includes(`${hiddenCount}`))).toBe(true);
        expect(final.length).toBeLessThanOrEqual(COMPACT_MAX_LINES);
    });

    it('full density select does not hide rows', () => {
        const models = Array.from({ length: 12 }, (_, i) =>
            makeModel(`m${i}`, `Model ${i}`, 0.5),
        );
        const maxRows = getMaxQuotaRows('full', 'normal');
        const { rows, hiddenCount } = selectQuotaRows(models, 'm0', maxRows);
        expect(rows).toHaveLength(12);
        expect(hiddenCount).toBe(0);
    });
});

/**
 * Synthetic full-load normal tooltip (~45 lines): title/context + compression
 * multi-line + checkpoint + ≥10 quota models (5-row cap + "N more") + credits + CTA.
 * Mirrors statusbar buildNormalActiveLines + buildQuotaLines output shape.
 */
function buildFullLoadNormalLines(opts?: {
    modelCount?: number;
    maxQuotaRows?: number;
    bilingual?: boolean;
}): string[] {
    const modelCount = opts?.modelCount ?? 10;
    const maxQuotaRows = opts?.maxQuotaRows ?? NORMAL_MAX_QUOTA_ROWS;
    const models = Array.from({ length: modelCount }, (_, i) =>
        makeModel(`m${i}`, `Model-${i}`, (i + 1) / (modelCount + 1)),
    );
    const { rows, hiddenCount, total } = selectQuotaRows(models, 'm0', maxQuotaRows);

    const moreLine = `… and ${hiddenCount} more models — click to view all / … 还有 ${hiddenCount} 个模型，点击查看全部`;
    const quotaTitle = opts?.bilingual
        ? `⚡ Model Quota / 模型配额`
        : `⚡ Model Quota`;
    const header = opts?.bilingual
        ? `| Model / 模型 | % | Reset / 重置 |`
        : `| Model | % | Reset |`;

    const lines: string[] = [
        // Header / session (P0)
        `📊 Context Window Usage / 上下文窗口使用情况`,
        `——————————`,
        `🤖 Model / 模型: Gemini 3.5 Flash (High)`,
        `📝 Session / 会话: 🗜 full-load bilingual session name that is quite long`,
        `——————————`,
        // Usage breakdown (P0 / P4 details)
        `📥 Total Context Used (input+output) / 总上下文占用 (输入+输出):`,
        `     120,000 tokens`,
        `📤 Model Output / 模型输出: 12,000 tokens`,
        `🔧 Tool Results / 工具结果: 8,000 tokens`,
        `📦 Limit / 窗口上限: 256,000 tokens`,
        `📊 Usage / 使用率: 46.9%`,
        // Compression multi-line (P4 details under P0 status)
        `🗜 Context was auto-compressed / 上下文已被模型自动压缩`,
        `   Before / 压缩前: 200,000 tokens`,
        `   After / 压缩后: 120,000 tokens`,
        `   Context Drop / 上下文压缩量: 80,000 tokens (40.0%)`,
        `⚠️ Data may be incomplete / 数据可能不完整`,
        `🔢 Steps / 步骤数: 42`,
        // P3 long lines
        `📷 Image Gen / 图片生成: 3 step(s) detected / 个图片生成步骤`,
        `📏 Est. delta / 估算增量: +1,500 tokens (since last checkpoint / 自上次检查点)`,
        `——————————`,
        // Checkpoint block (P3)
        `📎 Last Checkpoint / 最近 checkpoint:`,
        `  Input / 输入: 100,000`,
        `  Output / 输出: 5,000`,
        `  Cache / 缓存: 20,000`,
        `——————————`,
        // Plan (P2)
        `——————————`,
        `👤 Plan / 计划: **Ultra** · **Pro**`,
        `——————————`,
        // Protected quota table
        quotaTitle,
        ``,
        header,
        `|:--|--:|--:|`,
        ...rows.map((r, i) => {
            const bar = i === 0 ? '🟢' : i < 3 ? '🟡' : '🔴';
            return `| ${bar} ${r.label} | ${Math.round(r.quotaInfo.remainingFraction * 100)}% | 🔄 2h |`;
        }),
        ``,
    ];
    if (hiddenCount > 0) {
        lines.push(moreLine);
    }
    // P1 after protected block
    lines.push(`🔔 Earliest reset at / 最近重置时间为: **2099-01-01 00:00:00** (99d)`);
    lines.push(`⏳ Current model resets at / 当前模型重置于: **2099-01-01 00:00:00** (99d, Model-0)`);
    lines.push(`——————————`);
    lines.push(`⚡ AI Credits / AI 积分: **14,701** (expiry date not set / 到期日未设置)`);

    expect(total).toBe(modelCount);
    expect(rows).toHaveLength(Math.min(maxQuotaRows, modelCount));
    // Pre-budget must be a true full-load (~45 lines) for the regression to matter
    expect(lines.length).toBeGreaterThanOrEqual(40);

    return ensureCtaLast(lines, '$(link-external) **Click to view details / 点击查看详情**');
}

function assertQuotaTableIntact(
    capped: string[],
    expectedDataRows: number,
    hiddenCount: number,
): void {
    const titleIdx = capped.findIndex(l => isQuotaSectionTitle(l));
    expect(titleIdx).toBeGreaterThanOrEqual(0);

    const headerIdx = capped.findIndex(
        (l, i) => i > titleIdx && l.trimStart().startsWith('|') && (l.includes('%') || l.includes('Model') || l.includes('模型')),
    );
    expect(headerIdx).toBeGreaterThan(titleIdx);

    const sepIdx = capped.findIndex(
        (l, i) => i > headerIdx && (/^\|[\s:|-]+\|$/.test(l.trim()) || l.trim() === '|:--|--:|--:|'),
    );
    expect(sepIdx).toBe(headerIdx + 1);

    const dataRows = capped.filter(
        (l, i) => i > sepIdx && l.trimStart().startsWith('|') && /🟢|🟡|🔴/.test(l),
    );
    expect(dataRows).toHaveLength(expectedDataRows);

    if (hiddenCount > 0) {
        const moreIdx = capped.findIndex(l => isQuotaMoreLine(l));
        expect(moreIdx).toBeGreaterThan(sepIdx);
        expect(capped[moreIdx]).toContain(String(hiddenCount));
    }

    // CTA last
    expect(capped[capped.length - 1]).toContain('$(link-external)');
}

describe('W3: protected quota table under line budget', () => {
    it('full-load normal (~45 lines) keeps quota table (title+header+5 rows+more) and CTA last', () => {
        const withCta = buildFullLoadNormalLines({ modelCount: 10, maxQuotaRows: 5, bilingual: true });
        expect(withCta.length).toBeGreaterThan(NORMAL_MAX_LINES);

        const capped = applyLineBudget(withCta, NORMAL_MAX_LINES);

        // Soft budget preferred, but protected+CTA may slightly exceed when irreducible
        // — table structure must never be half-cut.
        assertQuotaTableIntact(capped, NORMAL_MAX_QUOTA_ROWS, 5);
        expect(capped[capped.length - 1]).toContain('$(link-external)');

        // P3/P4 should be folded first (checkpoint / imageGen / estDelta / multi-line details)
        expect(capped.some(l => l.includes('Last Checkpoint') || l.includes('最近 checkpoint'))).toBe(false);
        expect(capped.some(l => l.trimStart().startsWith('📷'))).toBe(false);
        expect(capped.some(l => l.trimStart().startsWith('📏'))).toBe(false);
    });

    it('over-budget compact keeps quota table (title+header+3 rows+more) and CTA last', () => {
        const models = Array.from({ length: 10 }, (_, i) =>
            makeModel(`m${i}`, `Model ${i}`, (i + 1) / 12),
        );
        const maxRows = COMPACT_MAX_QUOTA_ROWS;
        const { rows, hiddenCount } = selectQuotaRows(models, 'm0', maxRows);

        // Bloated compact-like body that still exceeds COMPACT_MAX_LINES
        const lines: string[] = [
            `📊 Context Window Usage`,
            `——————————`,
            `🤖 Gemini · 📝 session`,
            `📥 10k/256k · 4%`,
            `🗜 compressing`,
            `⚠️ gaps`,
            `——————————`,
            // filler that old tail-truncate would keep instead of quota
            ...Array.from({ length: 20 }, (_, i) => `detail-filler-${i}`),
            `⚡ Model Quota  (Showing ${rows.length}/10)`,
            ``,
            `| Model | % | Reset |`,
            `|:--|--:|--:|`,
            ...rows.map(r => `| 🟢 ${r.label} | ${Math.round(r.quotaInfo.remainingFraction * 100)}% | 🔄 1h |`),
            ``,
            `… and ${hiddenCount} more models — click to view all`,
            `🔔 Earliest reset at: **2099-01-01**`,
            `⚡ AI Credits: **100**`,
        ];
        const withCta = ensureCtaLast(lines, '$(link-external) **Click to view details**');
        expect(withCta.length).toBeGreaterThan(COMPACT_MAX_LINES);

        const capped = applyLineBudget(withCta, COMPACT_MAX_LINES);
        assertQuotaTableIntact(capped, COMPACT_MAX_QUOTA_ROWS, hiddenCount);
        expect(capped[capped.length - 1]).toContain('$(link-external)');
    });

    it('findQuotaTableRange covers title through more-line only', () => {
        const lines = [
            'prefix',
            '⚡ Model Quota',
            '',
            '| Model | % | Reset |',
            '|:--|--:|--:|',
            '| 🟢 A | 10% | 🔄 1h |',
            '',
            '… and 3 more models — click to view all',
            '🔔 Earliest reset',
            '⚡ AI Credits: **1**',
        ];
        const range = findQuotaTableRange(lines);
        expect(range).not.toBeNull();
        expect(range!.start).toBe(1);
        expect(lines[range!.end - 1]).toContain('more models');
        expect(range!.end).toBe(8); // exclusive: stops before earliest reset
    });
});

describe('parseTooltipDensity / truncateByDisplayWidth', () => {
    it('parses density enum', () => {
        expect(parseTooltipDensity('auto')).toBe('auto');
        expect(parseTooltipDensity('compact')).toBe('compact');
        expect(parseTooltipDensity('full')).toBe('full');
        expect(parseTooltipDensity('nope')).toBe('auto');
        expect(parseTooltipDensity(undefined)).toBe('auto');
    });

    it('truncates long ASCII session titles', () => {
        const long = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const out = truncateByDisplayWidth(long, 10);
        expect(out.endsWith('…')).toBe(true);
        expect(out.length).toBeLessThanOrEqual(11);
    });

    it('counts CJK wider than ASCII', () => {
        const cjk = '中文会话名称很长很长很长';
        const out = truncateByDisplayWidth(cjk, 8);
        expect(out.endsWith('…')).toBe(true);
    });

    it('I4: non-BMP emoji counts as width 2 (not 1)', () => {
        // 🗜 U+1F5DC, 📊 U+1F4CA, 📷 U+1F4F7 — all non-BMP
        expect(measureDisplayWidth('🗜')).toBe(2);
        expect(measureDisplayWidth('📊')).toBe(2);
        expect(measureDisplayWidth('📷')).toBe(2);
        expect(measureDisplayWidth('a🗜b')).toBe(1 + 2 + 1);
    });

    it('I4: session title with emoji truncates without exceeding display width', () => {
        const title = '📊📷🗜 ' + 'session-name-abcdefghij';
        const max = 12;
        const out = truncateByDisplayWidth(title, max);
        expect(out.endsWith('…')).toBe(true);
        expect(measureDisplayWidth(out)).toBeLessThanOrEqual(max);
        // Old bug: emoji as width 1 would allow longer string still measuring "ok" under wrong metric
        // Under correct metric the prefix of three emoji alone is already 6 units
        expect(measureDisplayWidth('📊📷🗜')).toBe(6);
    });

    it('I4: BMP misc symbol emoji-like glyphs count as 2', () => {
        expect(measureDisplayWidth('⚡')).toBe(2); // U+26A1
        expect(measureDisplayWidth('⚠')).toBe(2); // U+26A0
    });
});

describe('collapsed pool row label rendering', () => {
    // Reproduces the renderer's own composition (src/statusbar.ts): trim the model name to fit
    // AROUND the pool-size suffix rather than truncating the combined string from the right.
    const renderQuotaLabel = (label: string, poolSize: number): string => {
        const suffix = poolSizeSuffix(poolSize);
        const base = suffix && label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
        return truncateByDisplayWidth(base, LABEL_MAX_DISPLAY_WIDTH - measureDisplayWidth(suffix)) + suffix;
    };

    it('keeps the pool size visible even when the model name has to be cut', () => {
        // "Claude Opus 4.6 (Thinking) · 3" is 30 display units against a 28 budget. Truncating the
        // combined string dropped the count, so a 3-model pool row read like a single model.
        const label = 'Claude Opus 4.6 (Thinking) · 3';
        expect(measureDisplayWidth(label)).toBeGreaterThan(LABEL_MAX_DISPLAY_WIDTH);

        const rendered = renderQuotaLabel(label, 3);
        expect(rendered.endsWith(' · 3')).toBe(true);
        expect(measureDisplayWidth(rendered)).toBeLessThanOrEqual(LABEL_MAX_DISPLAY_WIDTH);
    });

    it('keeps a three-digit pool size visible too', () => {
        const rendered = renderQuotaLabel('Gemini 3.7 Flash (High) · 128', 128);
        expect(rendered.endsWith(' · 128')).toBe(true);
        expect(measureDisplayWidth(rendered)).toBeLessThanOrEqual(LABEL_MAX_DISPLAY_WIDTH);
    });

    it('leaves a single-model row untouched', () => {
        expect(poolSizeSuffix(1)).toBe('');
        expect(renderQuotaLabel('Gemini 3.1 Pro (High)', 1)).toBe('Gemini 3.1 Pro (High)');
    });
});

// ─── Status Bar & Hover Telemetry Tests (Wave 2B) ─────────────────────────────

function makeContextUsage(overrides: Partial<ContextUsage> = {}): ContextUsage {
    return {
        cascadeId: 'conv-1',
        title: 'Telemetry session',
        model: 'MODEL_PLACEHOLDER_M26',
        modelDisplayName: 'Claude Opus 4.6 (Thinking)',
        contextLimit: 200_000,
        contextUsed: 45_000,
        usagePercent: 22.5,
        status: 'IDLE',
        stepCount: 4,
        lastModifiedTime: '',
        isEstimated: false,
        lastModelUsage: null,
        totalOutputTokens: 1_200,
        totalToolCallOutputTokens: 400,
        estimatedDeltaSinceCheckpoint: 0,
        imageGenStepCount: 0,
        compressionDetected: false,
        checkpointCompressionDrop: 0,
        hasGaps: false,
        checkpointModel: '',
        createdTime: '',
        lastUserInputTime: '',
        lastUserInputStepIndex: 0,
        repositoryName: '',
        gitOriginUrl: '',
        branchName: '',
        gitRootUri: '',
        ...overrides,
    };
}

function makeGMCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
    return {
        stepIndices: [1],
        executionId: 'exec-1',
        model: 'MODEL_PLACEHOLDER_M26',
        modelDisplay: 'Claude Opus 4.6 (Thinking)',
        responseModel: 'claude-opus-4-6-thinking',
        modelAccuracy: 'exact',
        inputTokens: 10_000,
        outputTokens: 642,
        thinkingTokens: 0,
        responseTokens: 642,
        cacheReadTokens: 80_000,
        cacheCreationTokens: 0,
        apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
        ttftSeconds: 0.78,
        streamingSeconds: 10.0,
        credits: 0,
        creditType: '',
        hasError: false,
        errorMessage: '',
        contextTokensUsed: 90_642,
        completionConfig: null,
        systemPromptSnippet: '',
        toolCount: 2,
        toolNames: ['read_file'],
        promptSectionTitles: ['system'],
        promptSnippet: '',
        promptSource: 'none',
        messagePromptCount: 0,
        messageMetadataKeys: [],
        responseHeaderKeys: [],
        userMessageAnchors: [],
        aiSnippetsByStep: {},
        retries: 0,
        stopReason: 'STOP_REASON_END_TURN',
        retryTokensIn: 0,
        retryTokensOut: 0,
        retryCredits: 0,
        retryErrors: [],
        timeSinceLastInvocation: 0,
        tokenBreakdownGroups: [],
        createdAt: '2026-11-19T02:00:00.000Z',
        latestStableMessageIndex: 0,
        startStepIndex: 0,
        checkpointIndex: 0,
        checkpointSummaries: [],
        systemContextItems: [],
        toolCallsByStep: {},
        contextWindowCapacity: 200_000,
        ...overrides,
    };
}

function makeGMSummary(conversations: GMConversationData[]): GMSummary {
    return {
        conversations,
        modelBreakdown: {},
        totalCalls: conversations.reduce((sum, c) => sum + c.calls.length, 0),
        totalStepsCovered: 0,
        totalCredits: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheRead: 0,
        totalCacheCreation: 0,
        totalThinkingTokens: 0,
        contextGrowth: [],
        fetchedAt: '2026-11-19T02:05:00.000Z',
        totalRetryTokens: 0,
        totalRetryCredits: 0,
        totalRetryCount: 0,
        latestTokenBreakdown: [],
        stopReasonCounts: {},
        retryErrorCodes: {},
        recentErrors: [],
        toolCallCounts: {},
    };
}

function makeConv(cascadeId: string, calls: GMCallEntry[]): GMConversationData {
    return {
        cascadeId,
        title: `Conv ${cascadeId}`,
        totalSteps: calls.length,
        coveredSteps: calls.length,
        coverageRate: 1,
        calls,
    };
}

function mockDensity(density: TooltipDensity, zoomLevel = 0) {
    return vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation((section?: string) => ({
        get: <T>(key: string, fallback?: T) => {
            if (section === 'antigravityContextMonitor' && key === 'statusBar.tooltipDensity') { return density as T; }
            if (section === 'window' && key === 'zoomLevel') { return zoomLevel as T; }
            return fallback as T;
        },
    }) as unknown as vscode.WorkspaceConfiguration);
}

describe('StatusBarManager telemetry segments and hover tooltip', () => {
    let prevLang: Language;

    beforeEach(async () => {
        prevLang = getLanguage();
        await setLanguage('en', makeCtx());
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await setLanguage(prevLang, makeCtx());
    });

    it('keeps speed and cache hit opt-in (hidden by default) and hides cleanly on cold start when opted in', () => {
        const create = vi.spyOn(vscode.window, 'createStatusBarItem');
        const manager = new StatusBarManager();
        const item = create.mock.results[0].value as vscode.StatusBarItem;

        const summary = makeGMSummary([makeConv('conv-1', [
            makeGMCall({ outputTokens: 642, streamingSeconds: 10.0, inputTokens: 15_800, cacheReadTokens: 84_200 }),
        ])]);

        // Default prefs: showSpeed=false, showCacheHit=false -> text has neither, hover HAS telemetry
        manager.setTelemetry(summary, 'conv-1');
        manager.update(makeContextUsage());
        expect(item.text).not.toContain('tok/s');
        expect(item.text).not.toContain('Cache');
        expect((item.tooltip as vscode.MarkdownString).value).toContain('Speed & Prompt Cache');

        // Opt-in enabled, cold start (null or empty summary) -> NEVER flashes 0 tok/s or 0%
        manager.setDisplayPrefs({ showSpeed: true, showCacheHit: true });
        manager.setTelemetry(null);
        manager.refreshFromConfig();
        expect(item.text).not.toContain('tok/s');
        expect(item.text).not.toContain('Cache');
        expect(item.text).not.toContain('0%');
        expect((item.tooltip as vscode.MarkdownString).value).not.toContain('Speed & Prompt Cache');

        // Empty GM call (0 tokens, 0 timing) -> also hides cleanly
        manager.setTelemetry(makeGMSummary([makeConv('conv-1', [
            makeGMCall({ inputTokens: 0, outputTokens: 0, responseTokens: 0, cacheReadTokens: 0, ttftSeconds: 0, streamingSeconds: 0 }),
        ])]), 'conv-1');
        manager.refreshFromConfig();
        expect(item.text).not.toContain('tok/s');
        expect(item.text).not.toContain('Cache');
        expect((item.tooltip as vscode.MarkdownString).value).not.toContain('Speed & Prompt Cache');

        // Opt-in with real data -> shows crisp tok/s and localized Cache %
        manager.setTelemetry(summary, 'conv-1');
        manager.refreshFromConfig();
        expect(item.text).toContain('$(pulse) 64.2 tok/s');
        expect(item.text).toContain('Cache 84.2%');
        expect(item.accessibilityInformation?.label).toContain('Speed 64.2 tok/s');

        // Clearing on account switch removes status bar segments and hover telemetry immediately
        manager.setTelemetry(null);
        manager.refreshFromConfig();
        expect(item.text).not.toContain('tok/s');
        expect(item.text).not.toContain('Cache');
        expect((item.tooltip as vscode.MarkdownString).value).not.toContain('Speed & Prompt Cache');

        manager.dispose();
    });

    it('renders compact vs auto vs full hover telemetry densities and omits null pieces', () => {
        const create = vi.spyOn(vscode.window, 'createStatusBarItem');
        const manager = new StatusBarManager();
        const item = create.mock.results[0].value as vscode.StatusBarItem;

        const summary = makeGMSummary([makeConv('conv-1', [
            makeGMCall({
                executionId: 'c1',
                createdAt: '2026-11-19T02:00:00.000Z',
                inputTokens: 20_000,
                cacheReadTokens: 0,
                cacheCreationTokens: 10_000,
                outputTokens: 500,
                responseTokens: 500,
                ttftSeconds: 2.15,
                streamingSeconds: 10.0, // 50.0 tok/s
            }),
            makeGMCall({
                executionId: 'c2',
                createdAt: '2026-11-19T02:01:00.000Z',
                inputTokens: 5_000,
                cacheReadTokens: 142_000,
                cacheCreationTokens: 0,
                outputTokens: 642,
                responseTokens: 642,
                ttftSeconds: 0.78,
                streamingSeconds: 10.0, // 64.2 tok/s
            }),
        ])]);

        manager.setTelemetry(summary, 'conv-1');

        // Compact density: single tight line separated by ---
        mockDensity('compact');
        manager.update(makeContextUsage());
        const compactHover = (item.tooltip as vscode.MarkdownString).value;
        const compactTelemetrySection = compactHover.split('\n\n---\n\n').find(s => s.includes('Speed & Prompt Cache'));
        expect(compactTelemetrySection).toBeDefined();
        expect(compactTelemetrySection).not.toContain('\n');
        expect(compactTelemetrySection).toContain('**64.2 tok/s**');
        expect(compactTelemetrySection).toContain('TTFT 1.46s');
        expect(compactTelemetrySection).toContain('Cache 80.2%');

        // Compact density with speed-only call (no TTFT, no prompt tokens) omits null pieces
        manager.setTelemetry(makeGMSummary([makeConv('conv-1', [
            makeGMCall({ inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, ttftSeconds: 0, outputTokens: 200, streamingSeconds: 4.0 }),
        ])]), 'conv-1');
        manager.refreshFromConfig();
        const speedOnlySection = (item.tooltip as vscode.MarkdownString).value
            .split('\n\n---\n\n')
            .find(s => s.includes('Speed & Prompt Cache'));
        expect(speedOnlySection).toContain('**50.0 tok/s**');
        expect(speedOnlySection).not.toContain('TTFT');
        expect(speedOnlySection).not.toContain('Cache ');

        // Auto density: full 3-line breakdown with latest+avg speed, Cached vs Uncached TTFT, and Prompt Cache
        manager.setTelemetry(summary, 'conv-1');
        mockDensity('auto', 0);
        manager.refreshFromConfig();
        const autoHover = (item.tooltip as vscode.MarkdownString).value;
        expect(autoHover).toContain('**64.2 tok/s** latest · 57.1 tok/s avg');
        expect(autoHover).toContain('**1.46s** avg (780ms cached vs 2.15s uncached · -64%)');
        expect(autoHover).toContain('Prompt Cache · **80.2%** (142k / 177k tokens · 1/2 calls');
        expect(autoHover).not.toContain('p50 ');
        expect(autoHover).not.toContain('write ');

        // Full density: adds p50 medians and cache write volume
        mockDensity('full', 0);
        manager.refreshFromConfig();
        const fullHover = (item.tooltip as vscode.MarkdownString).value;
        expect(fullHover).toContain('p50 57.1 tok/s');
        expect(fullHover).toContain('p50 1.46s');
        expect(fullHover).toContain('write 10k');

        // Disconnected state omits telemetry (no stale readings)
        manager.showDisconnected('LS connection lost');
        expect((item.tooltip as vscode.MarkdownString).value).not.toContain('Speed & Prompt Cache');

        manager.dispose();
    });

    it('shows visible resp tok/s for thinking models and omits it when no thinking tokens exist', () => {
        const create = vi.spyOn(vscode.window, 'createStatusBarItem');
        const manager = new StatusBarManager();
        const item = create.mock.results[0].value as vscode.StatusBarItem;
        mockDensity('auto', 0);

        // With thinking: outputTokens=600 (thinking=400, response=200) over 10s -> 60.0 tok/s total, 20.0 tok/s visible
        manager.setTelemetry(makeGMSummary([makeConv('conv-1', [
            makeGMCall({
                outputTokens: 600,
                thinkingTokens: 400,
                responseTokens: 200,
                streamingSeconds: 10.0,
            }),
        ])]), 'conv-1');
        manager.update(makeContextUsage());
        const thinkingHover = (item.tooltip as vscode.MarkdownString).value;
        expect(thinkingHover).toContain('**60.0 tok/s**');
        expect(thinkingHover).toContain('resp 20.0 tok/s');

        // Without thinking: omits resp
        manager.setTelemetry(makeGMSummary([makeConv('conv-1', [
            makeGMCall({
                outputTokens: 600,
                thinkingTokens: 0,
                responseTokens: 600,
                streamingSeconds: 10.0,
            }),
        ])]), 'conv-1');
        manager.refreshFromConfig();
        expect((item.tooltip as vscode.MarkdownString).value).not.toContain('resp ');

        manager.dispose();
    });

    it('only renders Cached vs Uncached TTFT comparison when both buckets have at least 1 sample', () => {
        const create = vi.spyOn(vscode.window, 'createStatusBarItem');
        const manager = new StatusBarManager();
        const item = create.mock.results[0].value as vscode.StatusBarItem;
        mockDensity('auto', 0);

        // All calls cached (0 uncached) -> no fabricated vs comparison
        manager.setTelemetry(makeGMSummary([makeConv('conv-1', [
            makeGMCall({ executionId: 'a', cacheReadTokens: 50_000, ttftSeconds: 0.72 }),
            makeGMCall({ executionId: 'b', cacheReadTokens: 60_000, ttftSeconds: 0.84 }),
        ])]), 'conv-1');
        manager.update(makeContextUsage());
        const cachedOnlyHover = (item.tooltip as vscode.MarkdownString).value;
        expect(cachedOnlyHover).toContain('TTFT · **780ms** avg');
        expect(cachedOnlyHover).not.toContain(' vs ');

        // Both buckets present, cached slower than uncached -> shows signed positive +20%
        manager.setTelemetry(makeGMSummary([makeConv('conv-1', [
            makeGMCall({ executionId: 'u', cacheReadTokens: 0, ttftSeconds: 1.0 }),
            makeGMCall({ executionId: 'c', cacheReadTokens: 50_000, ttftSeconds: 1.2 }),
        ])]), 'conv-1');
        manager.refreshFromConfig();
        const slowerHover = (item.tooltip as vscode.MarkdownString).value;
        expect(slowerHover).toContain('1.20s cached vs 1.00s uncached · +20%');

        manager.dispose();
    });

    it('omits USD savings for unpriced or zero-diff models (never $0.00) and displays priced savings accurately', () => {
        const create = vi.spyOn(vscode.window, 'createStatusBarItem');
        const manager = new StatusBarManager();
        const item = create.mock.results[0].value as vscode.StatusBarItem;
        mockDensity('auto', 0);

        // Unpriced unknown model -> estCacheSavingsUsd is null -> no $ sign at all
        manager.setTelemetry(makeGMSummary([makeConv('conv-1', [
            makeGMCall({
                model: 'MODEL_UNKNOWN_UNPRICED_X',
                modelDisplay: 'Unknown Unpriced Model',
                responseModel: 'unknown-unpriced-x',
                inputTokens: 10_000,
                cacheReadTokens: 90_000,
            }),
        ])]), 'conv-1');
        manager.update(makeContextUsage());
        const unpricedHover = (item.tooltip as vscode.MarkdownString).value;
        expect(unpricedHover).toContain('Prompt Cache · **90.0%** (90k / 100k tokens · 1/1 call)');
        expect(unpricedHover).not.toMatch(/\$\d|est\./);

        // Custom pricing with input === cacheRead -> $0 diff -> omits $ (never $0.00!)
        manager.setTelemetry(makeGMSummary([makeConv('conv-1', [
            makeGMCall({
                model: 'MODEL_UNKNOWN_UNPRICED_X',
                modelDisplay: 'Unknown Unpriced Model',
                responseModel: 'unknown-unpriced-x',
                inputTokens: 10_000,
                cacheReadTokens: 90_000,
            }),
        ])]), 'conv-1', {
            'unknown-unpriced-x': { input: 2.0, output: 10.0, cacheRead: 2.0, cacheWrite: 2.0, thinking: 10.0 },
        });
        manager.refreshFromConfig();
        const zeroDiffHover = (item.tooltip as vscode.MarkdownString).value;
        expect(zeroDiffHover).not.toContain('$0.00');
        expect(zeroDiffHover).not.toMatch(/\$\d|est\./);

        // Priced model: 100,000 cacheRead * ($5.0 - $0.5) / 1e6 = $0.45 saved
        manager.setTelemetry(makeGMSummary([makeConv('conv-1', [
            makeGMCall({
                model: 'MODEL_UNKNOWN_UNPRICED_X',
                modelDisplay: 'Unknown Unpriced Model',
                responseModel: 'unknown-unpriced-x',
                inputTokens: 10_000,
                cacheReadTokens: 100_000,
            }),
        ])]), 'conv-1', {
            'unknown-unpriced-x': { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25, thinking: 25.0 },
        });
        manager.refreshFromConfig();
        const pricedHover = (item.tooltip as vscode.MarkdownString).value;
        expect(pricedHover).toContain('est. -$0.45');
        expect(pricedHover).not.toContain('$0.00');

        manager.dispose();
    });

    it('renders cleanly across en, zh, and both with zero 令牌 anywhere', async () => {
        const create = vi.spyOn(vscode.window, 'createStatusBarItem');
        const manager = new StatusBarManager();
        const item = create.mock.results[0].value as vscode.StatusBarItem;
        mockDensity('auto', 0);
        manager.setDisplayPrefs({ showSpeed: true, showCacheHit: true });

        const summary = makeGMSummary([makeConv('conv-1', [
            makeGMCall({
                executionId: 'c1',
                createdAt: '2026-11-19T02:00:00.000Z',
                inputTokens: 20_000,
                cacheReadTokens: 0,
                outputTokens: 400,
                thinkingTokens: 150,
                responseTokens: 250,
                ttftSeconds: 2.0,
                streamingSeconds: 8.0,
            }),
            makeGMCall({
                executionId: 'c2',
                createdAt: '2026-11-19T02:01:00.000Z',
                inputTokens: 10_000,
                cacheReadTokens: 100_000,
                outputTokens: 600,
                thinkingTokens: 200,
                responseTokens: 400,
                ttftSeconds: 0.8,
                streamingSeconds: 10.0,
            }),
        ])]);
        const pricing = {
            'claude-opus-4-6-thinking': { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25, thinking: 25.0 },
        };

        for (const lang of ['en', 'zh', 'both'] as const) {
            await setLanguage(lang, makeCtx());
            manager.setTelemetry(summary, 'conv-1', pricing);
            manager.update(makeContextUsage());
            const hover = (item.tooltip as vscode.MarkdownString).value;

            expect(item.text).not.toContain('令牌');
            expect(hover).not.toContain('令牌');
            expect(hover).toContain('tokens');
            expect(item.text).toContain('60.0 tok/s');

            if (lang === 'zh') {
                expect(item.text).toContain('缓存 76.9%');
                expect(hover).toContain('速度与提示词缓存');
                expect(hover).toContain('可见 ');
                expect(hover).toContain('命中 vs ');
                expect(hover).toContain('约省 $0.45');
            } else if (lang === 'en') {
                expect(item.text).toContain('Cache 76.9%');
                expect(hover).toContain('Speed & Prompt Cache');
                expect(hover).toContain('resp ');
                expect(hover).toContain('cached vs ');
                expect(hover).toContain('est. -$0.45');
            } else {
                expect(item.text).toContain('Cache 76.9%');
                expect(hover).toContain('Speed & Prompt Cache / 速度与提示词缓存');
                expect(hover).toContain('resp / 可见');
                expect(hover).toContain('est. -$0.45 / 约省 $0.45');
            }
        }

        manager.dispose();
    });
});

/**
 * Unit tests for issue #63 tooltip density / quota row budget.
 * Pure functions — no VS Code UI required (vscode mocked via vitest alias).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Language } from '../src/i18n';
import { getLanguage, setLanguage, tBi } from '../src/i18n';
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
            makeModel('MODEL_PLACEHOLDER_M298', 'Gemini 3.7 Flash (High)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M299', 'Gemini 3.7 Flash (Medium)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M300', 'Gemini 3.7 Flash (Low)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M71', 'Gemini 3.6 Flash (High)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M72', 'Gemini 3.6 Flash (Medium)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M73', 'Gemini 3.6 Flash (Low)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M84', 'Gemini 3.5 Flash (High)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M20', 'Gemini 3.5 Flash (Medium)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M187', 'Gemini 3.5 Flash (Low)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M16', 'Gemini 3.1 Pro (High)', 0.42),
            makeModel('MODEL_PLACEHOLDER_M36', 'Gemini 3.1 Pro (Low)', 0.42),
        ];
        const payload = [
            ...gemini,
            makeModel('MODEL_PLACEHOLDER_M35', 'Claude Sonnet 4.6 (Thinking)', 0.80),
            makeModel('MODEL_PLACEHOLDER_M26', 'Claude Opus 4.6 (Thinking)', 0.80),
            makeModel('MODEL_OPENAI_GPT_OSS_120B_MEDIUM', 'GPT-OSS 120B (Medium)', 0.80),
        ];

        const compact = selectQuotaRows(payload, 'MODEL_PLACEHOLDER_M298', 3);
        expect(compact.total).toBe(2);
        expect(compact.rows).toHaveLength(2);
        expect(compact.hiddenCount).toBe(0);
        expect(compact.rows[0].model).toBe('MODEL_PLACEHOLDER_M298');
        expect(compact.rows[0].label).toBe('Gemini 3.7 Flash (High) · 11');
        expect(compact.rows[1].label).toMatch(/ · 3$/);

        const noCurrent = selectQuotaRows(payload, '', 3);
        expect(noCurrent.rows[0].model).toBe('MODEL_PLACEHOLDER_M298');
        expect(noCurrent.rows[0].label).toBe('Gemini 3.7 Flash (High) · 11');

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
        `     120,000 tokens / 令牌`,
        `📤 Model Output / 模型输出: 12,000 tokens / 令牌`,
        `🔧 Tool Results / 工具结果: 8,000 tokens / 令牌`,
        `📦 Limit / 窗口上限: 256,000 tokens / 令牌`,
        `📊 Usage / 使用率: 46.9%`,
        // Compression multi-line (P4 details under P0 status)
        `🗜 Context was auto-compressed / 上下文已被模型自动压缩`,
        `   Before / 压缩前: 200,000 tokens / 令牌`,
        `   After / 压缩后: 120,000 tokens / 令牌`,
        `   Context Drop / 上下文压缩量: 80,000 tokens / 令牌 (40.0%)`,
        `⚠️ Data may be incomplete / 数据可能不完整`,
        `🔢 Steps / 步骤数: 42`,
        // P3 long lines
        `📷 Image Gen / 图片生成: 3 step(s) detected / 个图片生成步骤`,
        `📏 Est. delta / 估算增量: +1,500 tokens / 令牌 (since last checkpoint / 自上次检查点)`,
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

/**
 * Tooltip density / quota row budget helpers for status bar hover (issue #63).
 * Pure functions — safe to unit-test without VS Code UI.
 */

import type { Language } from './i18n';
import { getQuotaPoolKey } from './models';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TooltipDensity = 'auto' | 'compact' | 'full';
/** Runtime layout mode. `full` setting maps to `normal` layout with no soft caps. */
export type EffectiveMode = 'compact' | 'normal';

export interface QuotaSelectable {
    model: string;
    label: string;
    quotaInfo?: { remainingFraction: number; resetTime?: string };
    /** Set on a collapsed row: how many models the row's quota pool contains. */
    poolSize?: number;
}

export interface SelectQuotaRowsResult<T extends QuotaSelectable> {
    rows: T[];
    hiddenCount: number;
    total: number;
}

// ─── Budgets ──────────────────────────────────────────────────────────────────

/** Compact: max quota table data rows (excl. header/sep/more). */
export const COMPACT_MAX_QUOTA_ROWS = 3;
/** Normal safety cap for quota table data rows. */
export const NORMAL_MAX_QUOTA_ROWS = 5;
/** Soft physical-line budgets (Markdown lines joined with `  \\n`). */
export const COMPACT_MAX_LINES = 22;
export const NORMAL_MAX_LINES = 32;
/** Session title display-width units (CJK≈2, ASCII≈1). */
export const SESSION_MAX_DISPLAY_WIDTH = 24;
/** Model label display-width units inside the quota table. */
export const LABEL_MAX_DISPLAY_WIDTH = 28;

// ─── Density resolution ───────────────────────────────────────────────────────

/**
 * Resolve effective tooltip mode from user density setting, window zoom,
 * quota row count, and language (bilingual adds virtual pressure).
 *
 * - compact setting → always compact
 * - full setting → normal layout (caller skips soft row/line caps)
 * - auto → compact when zoom≥0.5, or many rows / bilingual pressure
 */
export function resolveEffectiveMode(
    density: TooltipDensity,
    zoomLevel: number,
    quotaRowCount: number,
    lang: Language,
): EffectiveMode {
    if (density === 'compact') {
        return 'compact';
    }
    if (density === 'full') {
        // full = show as much as possible; only hard CTA safety is applied by caller
        return 'normal';
    }

    // auto
    const bilingualPenalty = lang === 'both' ? 1 : 0;
    if (zoomLevel >= 0.5) {
        return 'compact';
    }
    if (zoomLevel > 0 && quotaRowCount > 4) {
        return 'compact';
    }
    if (quotaRowCount + bilingualPenalty * 2 > 8) {
        return 'compact';
    }
    return 'normal';
}

/**
 * Max quota data rows for the given density + effective mode.
 * `full` density never truncates (Infinity).
 */
export function getMaxQuotaRows(density: TooltipDensity, mode: EffectiveMode): number {
    if (density === 'full') {
        return Number.POSITIVE_INFINITY;
    }
    return mode === 'compact' ? COMPACT_MAX_QUOTA_ROWS : NORMAL_MAX_QUOTA_ROWS;
}

/**
 * Soft line budget. `full` density has no soft cap.
 */
export function getLineBudget(density: TooltipDensity, mode: EffectiveMode): number {
    if (density === 'full') {
        return Number.POSITIVE_INFINITY;
    }
    return mode === 'compact' ? COMPACT_MAX_LINES : NORMAL_MAX_LINES;
}

// ─── Quota row selection ──────────────────────────────────────────────────────

/** Platform default picker model — used only as a same-pool representative tie-break. */
const PLATFORM_DEFAULT_MODEL_ID = 'MODEL_PLACEHOLDER_M318';

/**
 * Select quota rows for the tooltip table:
 * 1. Collapse models that share a quota pool (getQuotaPoolKey) into one row
 * 2. Representative: current model, then platform default, then newest generation, then label
 * 3. Current model's pool first; remaining by remainingFraction ascending
 * 4. Stable label localeCompare on leftover ties
 *
 * Returns truncated rows + hiddenCount (0 when maxRows is infinite / ≥ total).
 * `total` is the number of pools after collapse, not the raw model count.
 */
export function selectQuotaRows<T extends QuotaSelectable>(
    models: T[],
    currentId: string,
    maxRows: number,
): SelectQuotaRowsResult<T> {
    const withQ = models.filter(m => !!m.quotaInfo);

    const seenModel = new Set<string>();
    const unique: T[] = [];
    for (const m of withQ) {
        if (seenModel.has(m.model)) {
            continue;
        }
        seenModel.add(m.model);
        unique.push(m);
    }

    const groups = new Map<string, T[]>();
    for (const m of unique) {
        const key = getQuotaPoolKey(m.model, m.quotaInfo?.resetTime);
        const list = groups.get(key);
        if (list) {
            list.push(m);
        } else {
            groups.set(key, [m]);
        }
    }

    const ordered: T[] = [];
    for (const members of groups.values()) {
        const rep = pickPoolRepresentative(members, currentId);
        ordered.push(annotatePoolLabel(rep, members.length));
    }

    ordered.sort((a, b) => {
        const aCur = !!currentId && a.model === currentId;
        const bCur = !!currentId && b.model === currentId;
        if (aCur !== bCur) {
            return aCur ? -1 : 1;
        }
        const df = (a.quotaInfo!.remainingFraction) - (b.quotaInfo!.remainingFraction);
        if (df !== 0) {
            return df;
        }
        const dGen = generationScore(b.label) - generationScore(a.label);
        if (dGen !== 0) {
            return dGen;
        }
        return a.label.localeCompare(b.label);
    });

    const total = ordered.length;
    if (!Number.isFinite(maxRows) || maxRows < 0 || maxRows >= total) {
        return { rows: ordered, hiddenCount: 0, total };
    }
    const limit = Math.max(0, Math.floor(maxRows));
    const rows = ordered.slice(0, limit);
    return { rows, hiddenCount: Math.max(0, total - rows.length), total };
}

function pickPoolRepresentative<T extends QuotaSelectable>(members: T[], currentId: string): T {
    if (currentId) {
        const current = members.find(m => m.model === currentId);
        if (current) {
            return current;
        }
    }
    const platformDefault = members.find(m => m.model === PLATFORM_DEFAULT_MODEL_ID);
    if (platformDefault) {
        return platformDefault;
    }
    return [...members].sort((a, b) => {
        const dg = generationScore(b.label) - generationScore(a.label);
        if (dg !== 0) {
            return dg;
        }
        return a.label.localeCompare(b.label);
    })[0];
}

/** "Gemini 3.8 Flash" → 3008; labels with no x.y version sort last. */
function generationScore(label: string): number {
    const m = /(\d+)\.(\d+)/.exec(label);
    if (!m) {
        return 0;
    }
    return Number(m[1]) * 1000 + Number(m[2]);
}

/** Suffix marking how many models a collapsed pool row stands for, e.g. " · 11". */
export function poolSizeSuffix(poolSize: number): string {
    return poolSize > 1 ? ` · ${poolSize}` : '';
}

function annotatePoolLabel<T extends QuotaSelectable>(rep: T, poolSize: number): T {
    const suffix = poolSizeSuffix(poolSize);
    if (!suffix) {
        return rep;
    }
    // Carry the size separately as well. The renderer truncates labels to a fixed display width,
    // and "Claude Opus 4.6 (Thinking) · 3" is wider than that budget — appending first would let the
    // count be the part that gets cut, turning a 3-model pool row into something that reads like a
    // single model. The renderer trims the base label to fit AROUND the suffix instead.
    return { ...rep, label: `${rep.label}${suffix}`, poolSize };
}

// ─── Display-width truncation ─────────────────────────────────────────────────

/**
 * Approximate display width:
 * - CJK / full-width ≈ 2
 * - non-BMP code points (emoji, CJK Ext-B, …) ≈ 2
 * - common BMP emoji / misc symbols ≈ 2
 * - ASCII / other BMP ≈ 1
 *
 * Iterates by Unicode code point (`for...of`), so surrogate pairs are one unit.
 */
export function measureDisplayWidth(text: string): number {
    let w = 0;
    for (const ch of text) {
        const code = ch.codePointAt(0) ?? 0;
        // Non-BMP (surrogate pairs resolved by for...of): emoji, rare CJK, etc.
        if (code > 0xFFFF) {
            w += 2;
            continue;
        }
        // CJK Unified + Hangul + fullwidth forms + common CJK punctuation
        if (
            (code >= 0x1100 && code <= 0x11FF)
            || (code >= 0x2E80 && code <= 0x9FFF)
            || (code >= 0xAC00 && code <= 0xD7AF)
            || (code >= 0xF900 && code <= 0xFAFF)
            || (code >= 0xFE30 && code <= 0xFE4F)
            || (code >= 0xFF00 && code <= 0xFFEF)
        ) {
            w += 2;
            continue;
        }
        // Common BMP emoji / misc symbols / dingbats (≈ double-width in monospace UI)
        if (
            (code >= 0x2190 && code <= 0x21FF) // arrows
            || (code >= 0x2300 && code <= 0x23FF) // technical / ⌨ ⏱ etc.
            || (code >= 0x2460 && code <= 0x24FF) // enclosed alphanumerics
            || (code >= 0x25A0 && code <= 0x25FF) // geometric shapes
            || (code >= 0x2600 && code <= 0x27BF) // misc symbols + dingbats
            || (code >= 0x2B00 && code <= 0x2BFF) // misc symbols and arrows
            || (code >= 0xFE00 && code <= 0xFE0F) // variation selectors (with emoji)
        ) {
            w += 2;
            continue;
        }
        w += 1;
    }
    return w;
}

/**
 * Truncate by display width units; appends `…` when clipped.
 */
export function truncateByDisplayWidth(text: string, maxUnits: number): string {
    if (maxUnits <= 0) {
        return '';
    }
    if (measureDisplayWidth(text) <= maxUnits) {
        return text;
    }
    const ellipsis = '…';
    const budget = Math.max(1, maxUnits - measureDisplayWidth(ellipsis));
    let w = 0;
    let out = '';
    for (const ch of text) {
        const cw = measureDisplayWidth(ch);
        if (w + cw > budget) {
            break;
        }
        out += ch;
        w += cw;
    }
    return out + ellipsis;
}

// ─── Line budget + CTA ────────────────────────────────────────────────────────

const CTA_MARKER = '$(link-external)';

/**
 * True when a line is the status-bar CTA (click to view details).
 */
export function isCtaLine(line: string): boolean {
    return line.includes(CTA_MARKER);
}

/** Quota section title: ⚡ Model Quota / 模型配额 (optionally with shown/total). */
export function isQuotaSectionTitle(line: string): boolean {
    return line.includes('⚡')
        && (/Model Quota/i.test(line) || /模型配额/.test(line));
}

/**
 * "… and N more quota pools" / "… 还有 N 个配额池" fold hint.
 * The older "more models" / "个模型" wording is still accepted: this predicate is what protects the
 * quota block from being folded away, and it must keep working if it ever sees a line rendered by a
 * different version of the text.
 */
export function isQuotaMoreLine(line: string): boolean {
    if (/more (?:quota pools|models)/i.test(line)) {
        return true;
    }
    return /还有/.test(line) && /(配额池|模型)/.test(line);
}

function isMarkdownTableLine(line: string): boolean {
    return line.trimStart().startsWith('|');
}

function isSeparatorLine(line: string): boolean {
    return /^—+$/.test(line.trim());
}

/**
 * Locate CTA block at end: optional separator + CTA line(s).
 * Returns start index of the block (or lines.length if none).
 */
export function findCtaBlockStart(lines: string[]): number {
    let ctaStart = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
        if (isCtaLine(lines[i])) {
            ctaStart = i;
            if (i > 0 && isSeparatorLine(lines[i - 1])) {
                ctaStart = i - 1;
            }
            break;
        }
    }
    return ctaStart;
}

/**
 * Find protected quota table range [start, endExclusive) inside `lines[0..bodyEnd)`.
 * Protected: section title + empty + header + sep + data rows + empty + optional "N more".
 * Does NOT include plan / earliest-reset / credits (those remain foldable P1–P2).
 */
export function findQuotaTableRange(
    lines: string[],
    bodyEnd: number = lines.length,
): { start: number; end: number } | null {
    let titleIdx = -1;
    for (let i = 0; i < bodyEnd; i++) {
        if (isQuotaSectionTitle(lines[i])) {
            titleIdx = i;
        }
    }
    if (titleIdx < 0) {
        return null;
    }

    let end = titleIdx + 1;
    let sawTable = false;
    while (end < bodyEnd) {
        const line = lines[end];
        if (line.trim() === '') {
            end++;
            continue;
        }
        if (isMarkdownTableLine(line)) {
            sawTable = true;
            end++;
            continue;
        }
        if (isQuotaMoreLine(line)) {
            end++;
            break;
        }
        // Non-table content after title (or after table) ends the protected block
        break;
    }

    // Title alone without any table is still protected (caller may be mid-build),
    // but prefer keeping at least title when present.
    if (!sawTable && end === titleIdx + 1) {
        // allow a single trailing empty after title
        if (end < bodyEnd && lines[end].trim() === '') {
            end++;
        }
    }
    return { start: titleIdx, end };
}

/**
 * Fold priority for non-protected lines (higher = drop first).
 * Aligns with issue63 design §3.3.2 P0–P4.
 *
 * P4 (4): modelOutput / toolResults / compressing multi-line details / estDelta / hint
 * P3 (3): checkpoint block / imageGen
 * P2 (2): plan/tier, bare separators
 * P1 (1): earliest/current reset, AI credits
 * P0 (0): title / model / session / core usage — keep until final tail-cut
 */
export function lineFoldPriority(line: string): number {
    const t = line.trim();
    if (!t) {
        return 2;
    }
    if (isSeparatorLine(t)) {
        return 2;
    }

    // P4 — detail rows dropped first
    if (/^📤/.test(t) || /^🔧/.test(t)) {
        return 4;
    }
    if (/^💡/.test(t)) {
        return 4;
    }
    if (/^📏/.test(t)) {
        return 4;
    }
    // Indented sub-details (before/after/drop, checkpoint fields, multi-line totals)
    if (/^\s{2,}\S/.test(line) && !isMarkdownTableLine(line)) {
        return 4;
    }

    // P3 — checkpoint / image gen
    if (/^📎/.test(t)) {
        return 3;
    }
    if (/^📷/.test(t)) {
        return 3;
    }

    // P2 — plan
    if (/^👤/.test(t)) {
        return 2;
    }

    // P1 — reset / credits (kept longer than P3/P4)
    if (/^🔔/.test(t) || /^⏳/.test(t)) {
        return 1;
    }
    if (/AI Credits|AI 积分|Credits expire|积分到期/.test(t) || (/^⚡/.test(t) && !isQuotaSectionTitle(line))) {
        return 1;
    }

    // P0 — core context lines
    return 0;
}

/**
 * Compact-equivalent extra drops on non-protected lines after P3/P4 are gone.
 * Mirrors compact layout: drop remaining multi-line usage breakdown pieces
 * that compact would merge or omit (limit/usage/remaining/steps long form,
 * "Total Context Used" label-only line when a value line may remain, etc.).
 */
function isCompactFoldableExtra(line: string): boolean {
    const t = line.trim();
    if (!t || isSeparatorLine(t)) {
        return true;
    }
    // Long-form usage breakdown present only in normal layout
    if (/^📦/.test(t) || /^📐/.test(t) || /^🔢/.test(t)) {
        return true;
    }
    // "Total Context Used:" header without inline numbers (value is next indented line, already P4)
    if (/^📥/.test(t) && t.endsWith(':')) {
        return true;
    }
    // Usage % as its own line (compact merges into used/limit)
    if (/^📊/.test(t) && !/Context Window|上下文窗口/.test(t)) {
        return true;
    }
    // Model / session as separate lines — compact merges; keep one if needed via P0 tail-cut
    if (/^🤖/.test(t) && t.includes(':') && !t.includes('·')) {
        return true;
    }
    if (/^📝/.test(t) && t.includes(':') && !t.includes('·')) {
        return true;
    }
    return false;
}

/**
 * Ensure the tooltip ends with CTA. If CTA is missing, append `ctaLine`.
 * If multiple CTAs exist, keep only the last and drop earlier ones.
 */
export function ensureCtaLast(lines: string[], ctaLine: string): string[] {
    const body = lines.filter(l => !isCtaLine(l));
    // Drop trailing separator immediately before re-adding CTA block if present
    while (body.length > 0 && isSeparatorLine(body[body.length - 1])) {
        body.pop();
    }
    return [...body, '——————————', ctaLine];
}

/**
 * Soft line budget with protected segments.
 *
 * Never drops:
 * - CTA block (separator + click-to-view)
 * - Quota table block (title + header + sep + data rows + optional "N more")
 *
 * When over budget, fold non-protected content by design priority:
 * 1. Drop P4 then P3 (checkpoint, estDelta, imageGen, multi-line details)
 * 2. Compact-equivalent fold on remaining non-protected (auto-downgrade)
 * 3. Tail-truncate remaining non-protected lines (from end)
 *
 * If protected + CTA alone exceed maxLines, still keep them (hard guarantee).
 */
export function applyLineBudget(lines: string[], maxLines: number): string[] {
    if (!Number.isFinite(maxLines) || lines.length <= maxLines) {
        return lines;
    }

    const ctaStart = findCtaBlockStart(lines);
    const body = lines.slice(0, ctaStart);
    const ctaPart = lines.slice(ctaStart);

    const quotaRange = findQuotaTableRange(body, body.length);
    const protectedSet = new Set<number>();
    if (quotaRange) {
        for (let i = quotaRange.start; i < quotaRange.end; i++) {
            protectedSet.add(i);
        }
    }

    const keep = body.map(() => true);

    const keptCount = (): number => {
        let n = 0;
        for (let i = 0; i < body.length; i++) {
            if (keep[i]) {
                n++;
            }
        }
        return n + ctaPart.length;
    };

    const dropIf = (predicate: (line: string, index: number) => boolean): void => {
        // Drop from the end so higher content stays when ties
        for (let i = body.length - 1; i >= 0 && keptCount() > maxLines; i--) {
            if (!keep[i] || protectedSet.has(i)) {
                continue;
            }
            if (predicate(body[i], i)) {
                keep[i] = false;
            }
        }
    };

    // Phase 1: structured fold P4 → P3 → P2 → P1
    for (const priority of [4, 3, 2, 1]) {
        if (keptCount() <= maxLines) {
            break;
        }
        dropIf(line => lineFoldPriority(line) === priority);
    }

    // Phase 2: compact-equivalent fold on leftover non-protected (auto-downgrade)
    if (keptCount() > maxLines) {
        dropIf(line => isCompactFoldableExtra(line) || lineFoldPriority(line) >= 1);
    }

    // Phase 3: tail-truncate any remaining non-protected (including P0 details)
    if (keptCount() > maxLines) {
        dropIf(() => true);
    }

    const result: string[] = [];
    for (let i = 0; i < body.length; i++) {
        if (keep[i]) {
            result.push(body[i]);
        }
    }
    // Collapse runs of blank / separator noise after aggressive drops
    return collapseRedundantSeparators([...result, ...ctaPart]);
}

/**
 * Remove consecutive pure separators and leading/double blanks without
 * touching table structure or CTA.
 */
function collapseRedundantSeparators(lines: string[]): string[] {
    const out: string[] = [];
    for (const line of lines) {
        const prev = out.length > 0 ? out[out.length - 1] : undefined;
        if (prev !== undefined) {
            if (isSeparatorLine(line) && isSeparatorLine(prev)) {
                continue;
            }
            if (line.trim() === '' && prev.trim() === '') {
                continue;
            }
        }
        out.push(line);
    }
    return out;
}

/**
 * Parse density setting string safely.
 */
export function parseTooltipDensity(value: unknown): TooltipDensity {
    if (value === 'compact' || value === 'full' || value === 'auto') {
        return value;
    }
    return 'auto';
}

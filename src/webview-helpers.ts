// ─── WebView Shared Helpers ───────────────────────────────────────────────────
// Canonical shared utility functions used across all webview tab builders.
// Eliminates duplication across overview, models, profile, chat-history,
// pricing, activity, orchestrator-attribution, calendar, settings, and about tabs.

import { tBi } from './i18n-core';
export { tBiHtml } from './i18n-core';

/** Escape HTML special characters. */
export function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── Shared Rich-Tip & Popover Key Helpers ───────────────────────────────────

export interface RichTipSpec {
    /** Stable popover anchor key (`data-popover-key`). */
    key: string;
    /** Optional tooltip heading (`data-tip-title`). */
    title?: string;
    /** Tooltip plain-text body (`data-tip-body`). */
    body?: string;
    /** Optional secondary metadata footnote (`data-tip-meta`). */
    meta?: string;
    /** Optional embedded rich-HTML template element ID (`data-tip-html-id`). */
    htmlId?: string;
    /** Allow clicking to pin the popover (`data-tip-pin="true"`). */
    pin?: boolean;
    /** Make trigger keyboard-focusable (`tabindex="0"`). */
    focusable?: boolean;
    /**
     * Prefix output with a single leading space when non-empty.
     * Defaults to `true` for object-spec calls (`<span${richTipAttrs({ ... })}>`),
     * while positional calls (`richTipAttrs(key, title, body, meta?, htmlId?)`) omit
     * the leading space (`<span ${richTipAttrs(...)}>`).
     */
    leadingSpace?: boolean;
}

/**
 * Normalize an arbitrary identifier into a safe, lowercase, bounded HTML popover
 * key slug (`[a-z0-9_-]`), defaulting to `'item'` when empty.
 */
export function slugKey(raw: string, maxLength = 48): string {
    const cleaned = (raw || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!cleaned) {
        return 'item';
    }
    if (maxLength > 0 && cleaned.length > maxLength) {
        return cleaned.slice(0, maxLength).replace(/-+$/, '') || 'item';
    }
    return cleaned;
}

/**
 * Backward-compatible alias for `slugKey` used by Activity, Pricing, Chat History,
 * and Orchestrator Attribution tabs (allows longer model/tool keys up to 128 chars).
 */
export function toSafeTipKey(raw: string): string {
    return slugKey(raw, 128);
}

/**
 * Build HTML data attributes for the shared `#acmRichTipPopover` tooltip/popover contract.
 *
 * Supports both:
 * 1. Structured spec object: `richTipAttrs({ key, title, body, meta, htmlId, pin, focusable })`
 *    (returns `' data-popover-key="..." ...'` with leading space by default)
 * 2. Positional arguments: `richTipAttrs(key, title, body, meta?, htmlId?)`
 *    (returns `'data-popover-key="..." ...'` without leading space)
 */
export function richTipAttrs(spec: RichTipSpec): string;
export function richTipAttrs(
    key: string,
    title: string,
    body: string,
    meta?: string,
    htmlId?: string,
): string;
export function richTipAttrs(
    keyOrSpec: string | RichTipSpec,
    title?: string,
    body?: string,
    meta?: string,
    htmlId?: string,
): string {
    const spec: RichTipSpec = typeof keyOrSpec === 'string'
        ? {
            key: keyOrSpec,
            title,
            body,
            meta,
            htmlId,
            leadingSpace: false,
        }
        : keyOrSpec;

    const parts: string[] = [
        `data-popover-key="${esc(spec.key)}"`,
    ];
    if (spec.title) {
        parts.push(`data-tip-title="${esc(spec.title)}"`);
    }
    if (spec.body) {
        parts.push(`data-tip-body="${esc(spec.body)}"`);
    }
    if (spec.meta) {
        parts.push(`data-tip-meta="${esc(spec.meta)}"`);
    }
    if (spec.htmlId) {
        parts.push(`data-tip-html-id="${esc(spec.htmlId)}"`);
    }
    if (spec.pin) {
        parts.push('data-tip-pin="true"');
    }
    if (spec.focusable) {
        parts.push('tabindex="0"');
    }

    const joined = parts.join(' ');
    const leadingSpace = spec.leadingSpace ?? true;
    return leadingSpace && joined ? ` ${joined}` : joined;
}

/**
 * Bilingual convenience wrapper for `richTipAttrs` used by Models and Profile tabs.
 * Evaluates English/Chinese strings through `tBi()` and emits leading-space attributes.
 */
export function richTipBiAttrs(
    key: string,
    titleEn: string,
    titleZh: string,
    bodyEn: string,
    bodyZh: string,
    metaEn?: string,
    metaZh?: string,
    options?: Pick<RichTipSpec, 'htmlId' | 'pin' | 'focusable' | 'leadingSpace'>,
): string {
    const title = tBi(titleEn, titleZh);
    const body = tBi(bodyEn, bodyZh);
    const meta = metaEn || metaZh ? tBi(metaEn || '', metaZh || '') : undefined;
    return richTipAttrs({
        key,
        title,
        body,
        meta,
        ...options,
    });
}

// ─── Time & Size Formatters ──────────────────────────────────────────────────

/** Format ISO timestamp to locale short date+time (local timezone). */
export function formatTime(iso: string): string {
    if (!iso) { return '—'; }
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) { return esc(iso); }
        const p = (n: number) => n.toString().padStart(2, '0');
        return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    } catch { return esc(iso); }
}

/** Format ISO timestamp to HH:MM:SS only (local timezone). */
export function formatShortTime(iso: string): string {
    if (!iso) { return '—'; }
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) { return iso; }
        const p = (n: number) => n.toString().padStart(2, '0');
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    } catch { return iso; }
}

/** Format milliseconds to human-readable "Xh Ym Zs". */
export function formatDuration(ms: number): string {
    if (ms < 0) { ms = 0; }
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) { return `${h}h ${m}m ${s}s`; }
    if (m > 0) { return `${m}m ${s}s`; }
    return `${s}s`;
}

/** Format byte count to human-readable size string (e.g. "1.2 MB"). */
export function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B';
    }
    if (bytes < 1024) {
        return `${Math.round(bytes)} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

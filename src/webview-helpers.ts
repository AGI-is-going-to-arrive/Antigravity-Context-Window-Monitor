// ─── WebView Shared Helpers ───────────────────────────────────────────────────
// Shared utility functions used across webview tab builders.
// Eliminates duplication between webview-panel.ts and activity-panel.ts.

/** Escape HTML special characters. */
export function esc(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

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

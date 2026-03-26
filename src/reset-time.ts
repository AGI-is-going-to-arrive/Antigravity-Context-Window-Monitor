function pad(value: number): string {
    return value.toString().padStart(2, '0');
}

export function parseResetDate(iso: string): Date | null {
    if (!iso) { return null; }
    try {
        const date = new Date(iso);
        return isNaN(date.getTime()) ? null : date;
    } catch {
        return null;
    }
}

export function formatResetAbsolute(
    iso: string,
    options?: { includeSeconds?: boolean },
): string {
    const date = parseResetDate(iso);
    if (!date) { return '—'; }
    const time = options?.includeSeconds
        ? `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
        : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${time}`;
}

export function formatResetCountdownFromMs(diffMs: number): string {
    if (diffMs <= 0) { return '0m'; }
    const totalMinutes = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) { return `${days}d${hours}h`; }
    if (hours > 0) { return `${hours}h${minutes}m`; }
    return `${minutes}m`;
}

export function formatResetCountdown(iso: string, nowMs = Date.now()): string {
    const date = parseResetDate(iso);
    if (!date) { return ''; }
    return formatResetCountdownFromMs(date.getTime() - nowMs);
}

export function formatResetContext(
    iso: string,
    options?: { includeSeconds?: boolean; nowMs?: number },
): string {
    const absolute = formatResetAbsolute(iso, { includeSeconds: options?.includeSeconds });
    if (absolute === '—') { return absolute; }
    const countdown = formatResetCountdown(iso, options?.nowMs);
    return countdown ? `${countdown} (${absolute})` : absolute;
}

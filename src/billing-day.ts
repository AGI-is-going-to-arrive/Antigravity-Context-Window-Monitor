const DAY_MS = 24 * 60 * 60 * 1000;

export function isBillingDay(day: unknown): day is number {
    return typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 31;
}

export function isBillingDaySetting(day: unknown): day is number {
    return typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 31;
}

function getDaysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Calculate the date-only delta to the next billing day.
 * Uses UTC calendar midnights to avoid DST hour shifts changing the day count.
 */
export function getDaysUntilBillingDay(billingDay: number, now: Date = new Date()): number | null {
    if (!isBillingDay(billingDay)) { return null; }

    const year = now.getFullYear();
    const month = now.getMonth();
    const today = now.getDate();
    const todayUtc = Date.UTC(year, month, today);

    const currentDay = Math.min(billingDay, getDaysInMonth(year, month));
    const currentTargetUtc = Date.UTC(year, month, currentDay);
    if (todayUtc <= currentTargetUtc) {
        return Math.round((currentTargetUtc - todayUtc) / DAY_MS);
    }

    const nextMonth = new Date(year, month + 1, 1);
    const nextYear = nextMonth.getFullYear();
    const nextMonthIndex = nextMonth.getMonth();
    const nextDay = Math.min(billingDay, getDaysInMonth(nextYear, nextMonthIndex));
    const nextTargetUtc = Date.UTC(nextYear, nextMonthIndex, nextDay);
    return Math.round((nextTargetUtc - todayUtc) / DAY_MS);
}

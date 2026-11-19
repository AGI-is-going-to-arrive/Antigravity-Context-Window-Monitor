import { getDaysUntilBillingDay } from './billing-day';
import { tBi } from './i18n';
import type { CreditInfo } from './models';

const IGNORED_CREDIT_TYPES = new Set([
    '',
    'UNSPECIFIED',
    'PROMPT',
    'FLOW',
    'PROMPT_CREDITS',
    'FLOW_CREDITS',
]);

function creditKey(type: string): string {
    return type.trim().toUpperCase().replace(/^CREDIT_TYPE_/, '');
}

export function isCurrentCreditType(type: string): boolean {
    return !IGNORED_CREDIT_TYPES.has(creditKey(type));
}

export function parseCreditBalance(value: unknown): number | null {
    if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) { value = Number(value); }
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function formatCreditTypeLabel(creditType: string): string {
    const key = creditKey(creditType);
    const labelMap: Record<string, readonly [string, string]> = {
        GOOGLE_ONE_AI: ['Google AI credits', 'Google AI 积分'],
        GOOGLE_AI: ['Google AI credits', 'Google AI 积分'],
        GOOGLE_AI_STUDIO: ['Google AI Studio credits', 'Google AI Studio 积分'],
    };
    const mapped = Object.hasOwn(labelMap, key) ? labelMap[key] : undefined;
    if (mapped) { return tBi(mapped[0], mapped[1]); }
    return key ? key.replace(/_/g, ' ') : tBi('AI credits', 'AI 积分');
}

export function currentAICredits(credits: readonly CreditInfo[]): CreditInfo[] {
    const byType = new Map<string, CreditInfo>();
    for (const entry of credits) {
        const key = creditKey(entry.creditType);
        if (!isCurrentCreditType(entry.creditType)) { continue; }
        const balance = parseCreditBalance(entry.creditAmount);
        const existing = byType.get(key);
        if (!existing) {
            byType.set(key, { ...entry, creditType: key, creditAmount: balance });
        } else if (existing.creditAmount !== balance) {
            // Repeated equal balances are one bucket. Conflicting readings are ambiguous.
            byType.set(key, { ...existing, creditAmount: null });
        }
    }
    return [...byType.values()];
}

export function aiCreditTotal(credits: readonly CreditInfo[]): number | null {
    const current = currentAICredits(credits);
    if (!current.length || current.some(entry => entry.creditAmount === null)) { return null; }
    const total = current.reduce((sum, entry) => sum + (entry.creditAmount ?? 0), 0);
    return Number.isFinite(total) ? total : null;
}

export interface AccountCreditsSummary {
    entries: CreditInfo[];
    total: number | null;
    known: boolean;
    billingDay: number;
    daysUntilExpiry: number | null;
}

export function summarizeAccountCredits(
    credits: readonly CreditInfo[],
    billingDay = 0,
    now: Date = new Date(),
): AccountCreditsSummary {
    const entries = currentAICredits(credits);
    const total = aiCreditTotal(entries);
    const normalizedBillingDay = Number.isInteger(billingDay) && billingDay >= 1 && billingDay <= 31 ? billingDay : 0;
    return {
        entries,
        total,
        known: total !== null,
        billingDay: normalizedBillingDay,
        daysUntilExpiry: getDaysUntilBillingDay(normalizedBillingDay, now),
    };
}

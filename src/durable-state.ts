import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QuotaRunwayTracker } from './quota-runway';
import { sanitizeLinuxXdgDir } from './core/cdp-launcher-core';
import { addWorkspaceStats, addCallToWorkspaceBreakdown, normalizeWorkspaceKey, normalizeUsageSurface, UNATTRIBUTED_WORKSPACE_KEY,
    type WorkspaceUsageStats } from './daily-ledger';
import { mergeLateCallsIntoCycle, type DailyCycleEntry, type DailyMergedLateCall } from './daily-store';
import {
    SUPPORTED_DISPLAY_CURRENCIES,
    bindCustomFxRate,
    isCurrencyCode,
    isValidCustomFxRate,
    normalizeCurrencyCode,
    switchDisplayCurrency,
    type DisplayCurrencyCode,
} from './core/currency';
import {
    normalizeSubscriptionPlanId,
    validateSubscriptionMonthlyFee,
    type SubscriptionPlanPresetId,
} from './core/pricing-validation';
import { isNewerVersion, parseSemver } from './core/release-security';

export { SUPPORTED_DISPLAY_CURRENCIES };
export type { DisplayCurrencyCode, SubscriptionPlanPresetId };

export interface StateBucket {
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: unknown): PromiseLike<void>;
}

export type OrchestratorPricingMode = 'mapped' | 'strict';
export type LanguagePreference = 'auto' | 'en' | 'zh' | 'both';
export type ContextPctBasis = 'compaction' | 'native';
export type SpeedMetricMode = 'decode' | 'e2e';
export type QuotaWindowMode = '5h' | '7d' | 'tightest';
export type QuotaDirectionMode = 'remaining' | 'used';

export interface LastUpdateCheckRecord {
    checkedAt: number;
    latestVersion?: string | null;
    /** @deprecated Legacy host-relative field retained only for reading old state without latestVersion. Use isUpdateAvailableForVersion(). */
    hasUpdate?: boolean;
    etag?: string | null;
    releaseUrl?: string | null;
    releaseNotesSummary?: string | null;
    assetName?: string | null;
    assetUrl?: string | null;
    checksumsUrl?: string | null;
    error?: string | null;
}

export function isUpdateAvailableForVersion(
    lastUpdateCheck: LastUpdateCheckRecord | null | undefined,
    currentVersion: string,
): boolean {
    if (!lastUpdateCheck) { return false; }
    if (typeof lastUpdateCheck.latestVersion === 'string' && lastUpdateCheck.latestVersion.trim()) {
        if (parseSemver(lastUpdateCheck.latestVersion) && parseSemver(currentVersion)) {
            return isNewerVersion(lastUpdateCheck.latestVersion, currentVersion);
        }
    }
    return typeof lastUpdateCheck.hasUpdate === 'boolean' ? lastUpdateCheck.hasUpdate : false;
}

export interface AppSettings {
    // Existing shared settings (v1.17.5 and earlier)
    pollingInterval: number;
    quotaNotificationThreshold: number;
    showContext: boolean;
    showQuota: boolean;
    showResetCountdown: boolean;
    showAiCredits: boolean;
    showSpeed: boolean;
    showCacheHit: boolean;
    showSessionCost: boolean;
    tooltipDensity: 'auto' | 'compact' | 'full';
    showModelInternalId: boolean;
    maxRecentSteps: number;
    maxArchives: number;
    lockToMainAgent: boolean;

    // v1.17.6 settings (strictly backward-compatible defaults)
    appComposerRingEnabled: boolean;
    appTopBarEnabled: boolean;
    orchestratorPricingMode: OrchestratorPricingMode;
    displayCurrency: DisplayCurrencyCode;
    customFxRate: number | null;
    subscriptionMonthlyFee: number | null;
    subscriptionCurrency: DisplayCurrencyCode;
    calendarRetentionDays: number;
    autoCheckUpdates: boolean;
    showNativeHudBar: boolean;
    lastUpdateCheck: LastUpdateCheckRecord | null;
    activityMaxRecentSteps: number;
    activityMaxArchives: number;

    // v1.18.0 consolidated shared preferences (D3 / D5 / D9)
    languagePreference: LanguagePreference;
    customFxCurrency: DisplayCurrencyCode | null;
    subscriptionPlan: SubscriptionPlanPresetId;
    contextPctBasis: ContextPctBasis;
    speedMetricMode: SpeedMetricMode;
    quotaWindowMode: QuotaWindowMode;
    quotaDirectionMode: QuotaDirectionMode;
    appShowNativeHudBar: boolean;
    ideShowNativeHudBar: boolean;
    nativeHudAutoHideOnOverview: boolean;
    appOnboardingDismissed?: boolean;
    legacyLockMigrated: boolean;
}

export const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = Object.freeze({
    pollingInterval: 5,
    quotaNotificationThreshold: 20,
    showContext: true,
    showQuota: true,
    showResetCountdown: true,
    showAiCredits: true,
    showSpeed: false,
    showCacheHit: false,
    showSessionCost: false,
    tooltipDensity: 'auto',
    showModelInternalId: false,
    maxRecentSteps: 100,
    maxArchives: 20,
    lockToMainAgent: false,

    appComposerRingEnabled: false,
    appTopBarEnabled: false,
    orchestratorPricingMode: 'mapped',
    displayCurrency: 'USD',
    customFxRate: null,
    subscriptionMonthlyFee: null,
    subscriptionCurrency: 'USD',
    calendarRetentionDays: 400,
    autoCheckUpdates: true,
    showNativeHudBar: true,
    lastUpdateCheck: null,
    activityMaxRecentSteps: 100,
    activityMaxArchives: 20,

    languagePreference: 'auto',
    customFxCurrency: null,
    subscriptionPlan: 'none',
    contextPctBasis: 'compaction',
    speedMetricMode: 'decode',
    quotaWindowMode: '5h',
    quotaDirectionMode: 'remaining',
    appShowNativeHudBar: true,
    ideShowNativeHudBar: false,
    nativeHudAutoHideOnOverview: true,
    appOnboardingDismissed: false,
    legacyLockMigrated: false,
});

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
    if (!Number.isFinite(n)) { return fallback; }
    return Math.min(Math.max(Math.round(n), min), max);
}

function normalizeDisplayCurrency(value: unknown, fallback: DisplayCurrencyCode = 'USD'): DisplayCurrencyCode {
    return normalizeCurrencyCode(value, fallback);
}

function normalizeLanguagePreference(value: unknown, fallback: LanguagePreference = 'auto'): LanguagePreference {
    if (value === 'auto' || value === 'en' || value === 'zh' || value === 'both') {
        return value;
    }
    return fallback;
}

function normalizeContextPctBasis(value: unknown): ContextPctBasis {
    return value === 'native' ? 'native' : 'compaction';
}

function normalizeSpeedMetricMode(value: unknown): SpeedMetricMode {
    return value === 'e2e' ? 'e2e' : 'decode';
}

function normalizeQuotaWindowMode(value: unknown): QuotaWindowMode {
    if (value === '7d' || value === 'tightest' || value === '5h') {
        return value;
    }
    return '5h';
}

function normalizeQuotaDirectionMode(value: unknown): QuotaDirectionMode {
    return value === 'used' ? 'used' : 'remaining';
}

function normalizeLastUpdateCheck(value: unknown): LastUpdateCheckRecord | null {
    if (!isPlainObject(value)) { return null; }
    const checkedAt = typeof value.checkedAt === 'number' && Number.isFinite(value.checkedAt) && value.checkedAt > 0
        ? Math.floor(value.checkedAt)
        : 0;
    if (checkedAt <= 0) { return null; }
    const optStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
    const latestVersion = optStr(value.latestVersion);
    const normalized: LastUpdateCheckRecord = {
        checkedAt,
        latestVersion,
        etag: optStr(value.etag),
        releaseUrl: optStr(value.releaseUrl),
        releaseNotesSummary: optStr(value.releaseNotesSummary),
        assetName: optStr(value.assetName),
        assetUrl: optStr(value.assetUrl),
        checksumsUrl: optStr(value.checksumsUrl),
        error: optStr(value.error),
    };
    // Keep backward-compatible read only for legacy records that had no latestVersion;
    // never persist a colliding host-specific boolean alongside latestVersion.
    if (!latestVersion && typeof value.hasUpdate === 'boolean') {
        normalized.hasUpdate = value.hasUpdate;
    }
    return normalized;
}

/**
 * Normalize raw persisted `appSettings` into a complete, schema-safe `AppSettings` object.
 * Preserves full backward compatibility with v1.17.5/v1.17.6 payloads while enforcing v1.18
 * 10-currency FX binding, explicit `languagePreference` preservation (including `'both'`),
 * split App/IDE HUD flags, and consolidated subscription settings.
 */
export function normalizeAppSettings(raw: unknown): AppSettings {
    const src = isPlainObject(raw) ? raw : {};
    const tooltipDensity = src.tooltipDensity === 'compact' || src.tooltipDensity === 'full' || src.tooltipDensity === 'auto'
        ? src.tooltipDensity
        : DEFAULT_APP_SETTINGS.tooltipDensity;
    const orchestratorPricingMode: OrchestratorPricingMode = src.orchestratorPricingMode === 'strict'
        ? 'strict'
        : 'mapped';

    const resolvedMaxRecentSteps = src.activityMaxRecentSteps !== undefined
        ? clampInt(src.activityMaxRecentSteps, DEFAULT_APP_SETTINGS.activityMaxRecentSteps, 10, 500)
        : clampInt(src.maxRecentSteps, DEFAULT_APP_SETTINGS.maxRecentSteps, 10, 500);
    const resolvedMaxArchives = src.activityMaxArchives !== undefined
        ? clampInt(src.activityMaxArchives, DEFAULT_APP_SETTINGS.activityMaxArchives, 1, 100)
        : clampInt(src.maxArchives, DEFAULT_APP_SETTINGS.maxArchives, 1, 100);

    const displayCurrency = normalizeDisplayCurrency(src.displayCurrency, DEFAULT_APP_SETTINGS.displayCurrency);
    const rawFxNum = typeof src.customFxRate === 'number'
        ? src.customFxRate
        : (typeof src.customFxRate === 'string' && src.customFxRate.trim() !== '' ? Number(src.customFxRate) : NaN);
    let customFxRate: number | null = null;
    let customFxCurrency: DisplayCurrencyCode | null = null;
    if (displayCurrency !== 'USD' && isValidCustomFxRate(rawFxNum)) {
        if (typeof src.customFxCurrency === 'string' && isCurrencyCode(src.customFxCurrency)) {
            const boundCode = normalizeCurrencyCode(src.customFxCurrency);
            if (boundCode === displayCurrency) {
                customFxRate = rawFxNum;
                customFxCurrency = boundCode;
            }
        } else if (src.customFxCurrency === undefined || src.customFxCurrency === null) {
            // Legacy payload or caller writing customFxRate without customFxCurrency binds to its paired displayCurrency
            customFxRate = rawFxNum;
            customFxCurrency = displayCurrency;
        }
    }

    const feeValidation = validateSubscriptionMonthlyFee(src.subscriptionMonthlyFee);
    let subscriptionMonthlyFee = feeValidation.ok ? feeValidation.value : null;
    const subscriptionCurrency = normalizeDisplayCurrency(src.subscriptionCurrency, DEFAULT_APP_SETTINGS.subscriptionCurrency);
    const explicitPlanNone = typeof src.subscriptionPlan === 'string' && src.subscriptionPlan.trim() === 'none';
    let subscriptionPlan: SubscriptionPlanPresetId;
    if (explicitPlanNone && subscriptionMonthlyFee === null) {
        subscriptionPlan = 'none';
    } else if (explicitPlanNone && subscriptionMonthlyFee !== null) {
        // Legacy callers updating subscriptionMonthlyFee without subscriptionPlan keep the fee & infer preset/custom
        subscriptionPlan = normalizeSubscriptionPlanId(undefined, subscriptionMonthlyFee);
    } else if (typeof src.subscriptionPlan === 'string' && src.subscriptionPlan.trim()) {
        subscriptionPlan = normalizeSubscriptionPlanId(src.subscriptionPlan, subscriptionMonthlyFee);
    } else {
        subscriptionPlan = normalizeSubscriptionPlanId(undefined, subscriptionMonthlyFee);
    }

    const boolOr = <K extends keyof AppSettings>(k: K, fb: boolean = Boolean(DEFAULT_APP_SETTINGS[k])): boolean =>
        typeof src[k] === 'boolean' ? (src[k] as boolean) : fb;
    const showNativeHudBar = boolOr('showNativeHudBar');
    const appShowNativeHudBar = boolOr('appShowNativeHudBar', typeof src.showNativeHudBar === 'boolean' ? src.showNativeHudBar : DEFAULT_APP_SETTINGS.appShowNativeHudBar);
    return {
        pollingInterval: clampInt(src.pollingInterval, DEFAULT_APP_SETTINGS.pollingInterval, 1, 60),
        quotaNotificationThreshold: clampInt(src.quotaNotificationThreshold, DEFAULT_APP_SETTINGS.quotaNotificationThreshold, 0, 99),
        showContext: boolOr('showContext'),
        showQuota: boolOr('showQuota'),
        showResetCountdown: boolOr('showResetCountdown'),
        showAiCredits: boolOr('showAiCredits'),
        showSpeed: boolOr('showSpeed'),
        showCacheHit: boolOr('showCacheHit'),
        showSessionCost: boolOr('showSessionCost'),
        tooltipDensity,
        showModelInternalId: boolOr('showModelInternalId'),
        maxRecentSteps: resolvedMaxRecentSteps,
        maxArchives: resolvedMaxArchives,
        lockToMainAgent: boolOr('lockToMainAgent'),
        appComposerRingEnabled: boolOr('appComposerRingEnabled'),
        appTopBarEnabled: boolOr('appTopBarEnabled'),
        orchestratorPricingMode,
        displayCurrency,
        customFxRate,
        subscriptionMonthlyFee,
        subscriptionCurrency,
        calendarRetentionDays: clampInt(src.calendarRetentionDays, DEFAULT_APP_SETTINGS.calendarRetentionDays, 30, 3650),
        autoCheckUpdates: boolOr('autoCheckUpdates'),
        showNativeHudBar,
        lastUpdateCheck: normalizeLastUpdateCheck(src.lastUpdateCheck),
        activityMaxRecentSteps: resolvedMaxRecentSteps,
        activityMaxArchives: resolvedMaxArchives,
        languagePreference: normalizeLanguagePreference(src.languagePreference, DEFAULT_APP_SETTINGS.languagePreference),
        customFxCurrency,
        subscriptionPlan,
        contextPctBasis: normalizeContextPctBasis(src.contextPctBasis),
        speedMetricMode: normalizeSpeedMetricMode(src.speedMetricMode),
        quotaWindowMode: normalizeQuotaWindowMode(src.quotaWindowMode),
        quotaDirectionMode: normalizeQuotaDirectionMode(src.quotaDirectionMode),
        appShowNativeHudBar,
        ideShowNativeHudBar: boolOr('ideShowNativeHudBar'),
        nativeHudAutoHideOnOverview: boolOr('nativeHudAutoHideOnOverview'),
        appOnboardingDismissed: boolOr('appOnboardingDismissed'),
        legacyLockMigrated: boolOr('legacyLockMigrated'),
    };
}

interface DurableStateFile {
    version: 1;
    global: Record<string, unknown>;
    workspaces: Record<string, Record<string, unknown>>;
}

const DEEP_MERGE_OBJECT_KEYS = new Set<string>([
    'appSettings',
    'dailyLedger',
    'dailyLedgerState',
    'accountSnapshots',
    'accountBillingDays',
    'customPricing',
    'customModelPricing',
    'dailyStoreState',
    'modelDNAState',
    'quotaActiveTracking',
    'quotaRunwayState',
]);

const RENAME_RETRY_DELAYS_MS = [15, 30, 60, 120, 200];
const LOCK_STALE_MS = 5_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 2_500;
const MAX_MERGE_DEPTH = 6;
const MAX_OBSERVED_EMPTY_LOCKS = 128;
const observedEmptyLockFirstSeen = new Map<string, number>();
let tmpNonceCounter = 0;

function recordEmptyLockFirstSeen(key: string, nowMs: number): number {
    const existing = observedEmptyLockFirstSeen.get(key);
    if (existing !== undefined) { return existing; }
    if (observedEmptyLockFirstSeen.size >= MAX_OBSERVED_EMPTY_LOCKS) {
        const oldest = observedEmptyLockFirstSeen.keys().next().value;
        if (oldest !== undefined) { observedEmptyLockFirstSeen.delete(oldest); }
    }
    observedEmptyLockFirstSeen.set(key, nowMs);
    return nowMs;
}

function getDefaultStateFilePath(): string {
    if (process.platform === 'win32' && process.env.APPDATA) {
        return path.join(process.env.APPDATA, 'Antigravity Context Monitor', 'state-v1.json');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity Context Monitor', 'state-v1.json');
    }
    const stateHome = sanitizeLinuxXdgDir(process.env.XDG_STATE_HOME) ?? path.join(os.homedir(), '.local', 'state');
    return path.join(stateHome, 'antigravity-context-monitor', 'state-v1.json');
}

function hasOwn(target: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(target, key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stripUtf8Bom(raw: string): string {
    return raw.replace(/^\uFEFF/, '');
}

function deepClone<T>(value: T): T {
    if (value === undefined || value === null || typeof value !== 'object') {
        return value;
    }
    try {
        return JSON.parse(JSON.stringify(value)) as T;
    } catch {
        return value;
    }
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) { return true; }
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
        return false;
    }
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) { return false; }
        }
        return true;
    }
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) { return false; }
    for (const k of keysA) {
        if (!hasOwn(objB, k) || !deepEqual(objA[k], objB[k])) {
            return false;
        }
    }
    return true;
}

function parseStateFile(raw: string): DurableStateFile | null {
    try {
        const parsed = JSON.parse(stripUtf8Bom(raw)) as Partial<DurableStateFile>;
        if (!isPlainObject(parsed) || parsed.version !== 1) {
            return null;
        }
        if ((parsed.global !== undefined && !isPlainObject(parsed.global))
            || (parsed.workspaces !== undefined && !isPlainObject(parsed.workspaces))) { return null; }
        const globalObj = parsed.global ?? {};
        const workspacesRaw = parsed.workspaces ?? {};
        const workspaces: Record<string, Record<string, unknown>> = {};
        for (const [wsKey, wsVal] of Object.entries(workspacesRaw)) {
            if (!isPlainObject(wsVal)) { return null; }
            Object.defineProperty(workspaces, wsKey, { value: wsVal, enumerable: true, writable: true, configurable: true });
        }
        return {
            version: 1,
            global: globalObj,
            workspaces,
        };
    } catch {
        return null;
    }
}

function mergePlainObjects3Way(
    base: Record<string, unknown> | undefined,
    disk: Record<string, unknown>,
    local: Record<string, unknown>,
    depth = 0,
): Record<string, unknown> {
    const result = deepClone(disk);

    for (const [k, localVal] of Object.entries(local)) {
        const inBase = !!base && hasOwn(base, k);
        const localChanged = !inBase || !deepEqual(base[k], localVal);
        if (!localChanged) {
            // Local did not touch this entry; keep disk's value (or disk's deletion).
            continue;
        }
        if (depth < MAX_MERGE_DEPTH && isPlainObject(result[k]) && isPlainObject(localVal)) {
            const baseSub = inBase && isPlainObject(base[k]) ? base[k] as Record<string, unknown> : undefined;
            result[k] = mergePlainObjects3Way(baseSub, result[k] as Record<string, unknown>, localVal, depth + 1);
        } else {
            result[k] = deepClone(localVal);
        }
    }

    // Honor explicit local deletions when disk did not modify the deleted entry.
    if (base) {
        for (const k of Object.keys(base)) {
            if (!hasOwn(local, k) && hasOwn(result, k) && deepEqual(base[k], result[k])) {
                delete result[k];
            }
        }
    }

    return result;
}

function isAccountSnapshotArray(value: unknown): value is Array<Record<string, unknown>> {
    return Array.isArray(value)
        && value.every(item => isPlainObject(item) && typeof item.email === 'string' && item.email.length > 0);
}

function mergeAccountSnapshotArrays3Way(
    base: unknown,
    disk: Array<Record<string, unknown>>,
    local: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
    const toMap = (arr: Array<Record<string, unknown>>): Record<string, Record<string, unknown>> => {
        const out: Record<string, Record<string, unknown>> = {};
        for (const item of arr) {
            out[item.email as string] = item;
        }
        return out;
    };
    const baseMap = isAccountSnapshotArray(base) ? toMap(base) : undefined;
    const diskMap = toMap(disk);
    const localMap = toMap(local);
    const mergedMap = mergePlainObjects3Way(baseMap, diskMap, localMap, MAX_MERGE_DEPTH);
    return Object.values(mergedMap) as Array<Record<string, unknown>>;
}

const SETTLED_TIMESTAMP_DRIFT_TOLERANCE_MS = 60_000;
const QUOTA_RUNWAY_RESET_SHIFT_TOLERANCE_MS = 60_000;
const QUOTA_RUNWAY_MAX_SAMPLES = 200;
const LEDGER_SPEED_MIN_STREAM_SECONDS = 0.05;
const LEDGER_SPEED_MIN_OUTPUT_TOKENS = 2;

function toFiniteNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getSettledEventTimestampMs(entry: Record<string, unknown>): number | null {
    if (typeof entry.settledCutoffTime === 'number' && Number.isFinite(entry.settledCutoffTime) && entry.settledCutoffTime > 0) {
        return entry.settledCutoffTime;
    }
    if (typeof entry.settledAt === 'string' && entry.settledAt.trim()) {
        const parsed = Date.parse(entry.settledAt);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    return null;
}

function getSettledPoolSignature(entry: Record<string, unknown>): string {
    const email = typeof entry.accountEmail === 'string' ? entry.accountEmail.trim().toLowerCase() : '';
    const poolIds = Array.isArray(entry.poolModelIds)
        ? [...new Set(entry.poolModelIds.map(id => String(id || '').trim().toLowerCase()).filter(Boolean))].sort().join(',')
        : '';
    return `${email}|${poolIds}`;
}

function getSettledRichnessScore(entry: Record<string, unknown>): number {
    const calls = toFiniteNumber(entry.totalCalls, 0);
    const tokens = toFiniteNumber(entry.totalInputTokens, 0)
        + toFiniteNumber(entry.totalOutputTokens, 0)
        + toFiniteNumber(entry.totalCacheRead, 0)
        + toFiniteNumber(entry.totalCacheCreation, 0);
    const hasModelStats = isPlainObject(entry.modelStats) && Object.keys(entry.modelStats).length > 0 ? 1 : 0;
    const hasCutoff = typeof entry.settledCutoffTime === 'number' && Number.isFinite(entry.settledCutoffTime) ? 1 : 0;
    return calls * 1e9 + tokens + hasModelStats * 1e6 + hasCutoff * 1e5;
}

/**
 * Strip mutable `:index` from `<cascadeId>:<index>|<fingerprint>` so concurrent App/IDE
 * calls and legacy/new keys deduplicate on their durable logical call identity.
 */
function canonicalLedgerCallId(rawId: string): string {
    if (!rawId) { return ''; }
    const pipeIdx = rawId.indexOf('|');
    if (pipeIdx <= 0) { return rawId; }
    const prefix = rawId.slice(0, pipeIdx);
    const stripped = prefix.replace(/:\d+$/, '');
    return stripped ? `${stripped}${rawId.slice(pipeIdx)}` : rawId;
}

function unionStringArrayCaseInsensitive(a: unknown, b: unknown): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const addList = (list: unknown) => {
        if (!Array.isArray(list)) { return; }
        for (const item of list) {
            if (typeof item !== 'string') { continue; }
            const trimmed = item.trim();
            if (!trimmed) { continue; }
            const lower = trimmed.toLowerCase();
            if (!seen.has(lower)) {
                seen.add(lower);
                out.push(trimmed);
            }
        }
    };
    addList(a);
    addList(b);
    return out;
}

function normalizeModelStatsObject(raw: Record<string, unknown>): Record<string, number> {
    return {
        calls: toFiniteNumber(raw.calls, 0),
        inputTokens: toFiniteNumber(raw.inputTokens, 0),
        outputTokens: toFiniteNumber(raw.outputTokens, 0),
        thinkingTokens: toFiniteNumber(raw.thinkingTokens, 0),
        cacheReadTokens: toFiniteNumber(raw.cacheReadTokens, 0),
        cacheCreationTokens: toFiniteNumber(raw.cacheCreationTokens, 0),
        credits: toFiniteNumber(raw.credits, 0),
        estimatedCost: toFiniteNumber(raw.estimatedCost, 0),
        ttftSum: toFiniteNumber(raw.ttftSum, 0),
        ttftCount: toFiniteNumber(raw.ttftCount, 0),
        minTTFT: toFiniteNumber(raw.minTTFT, 0),
        maxTTFT: toFiniteNumber(raw.maxTTFT, 0),
        streamingSum: toFiniteNumber(raw.streamingSum, 0),
        streamingCount: toFiniteNumber(raw.streamingCount, 0),
        timedOutputTokens: toFiniteNumber(raw.timedOutputTokens, 0),
        timedStreamingSeconds: toFiniteNumber(raw.timedStreamingSeconds, 0),
        cacheHitCalls: toFiniteNumber(raw.cacheHitCalls, 0),
    };
}

function addMergedModelStats(target: Record<string, number>, src: Record<string, number>): void {
    target.calls += src.calls;
    target.inputTokens += src.inputTokens;
    target.outputTokens += src.outputTokens;
    target.thinkingTokens += src.thinkingTokens;
    target.cacheReadTokens += src.cacheReadTokens;
    target.cacheCreationTokens += src.cacheCreationTokens;
    target.credits += src.credits;
    target.estimatedCost += src.estimatedCost;
    target.ttftSum += src.ttftSum;
    target.ttftCount += src.ttftCount;
    if (src.minTTFT > 0) {
        target.minTTFT = target.minTTFT > 0 ? Math.min(target.minTTFT, src.minTTFT) : src.minTTFT;
    }
    target.maxTTFT = Math.max(target.maxTTFT, src.maxTTFT);
    target.streamingSum += src.streamingSum;
    target.streamingCount += src.streamingCount;
    target.timedOutputTokens += src.timedOutputTokens;
    target.timedStreamingSeconds += src.timedStreamingSeconds;
    target.cacheHitCalls += src.cacheHitCalls;
}

function modelStatsRichness(ms: Record<string, number>): number {
    return ms.calls * 1e9 + ms.inputTokens + ms.outputTokens + ms.cacheReadTokens + ms.cacheCreationTokens;
}

function extractSettledCallsFromEntry(entry: Record<string, unknown>): Array<Record<string, unknown>> {
    if (!Array.isArray(entry.settledCalls)) { return []; }
    return entry.settledCalls.filter(isLedgerRecordedCallObject);
}

function extractRecordedCallIdSet(entry: Record<string, unknown>): Set<string> {
    const out = new Set<string>();
    if (Array.isArray(entry.recordedCallIds)) {
        for (const id of entry.recordedCallIds) {
            if (typeof id === 'string' && id) {
                out.add(canonicalLedgerCallId(id));
            }
        }
    }
    for (const c of extractSettledCallsFromEntry(entry)) {
        out.add(canonicalLedgerCallId(c.callId as string));
    }
    return out;
}

function computeLegacyModelResiduals(
    entry: Record<string, unknown>,
    calls: Array<Record<string, unknown>>,
): Record<string, Record<string, number>> {
    const residuals: Record<string, Record<string, number>> = {};
    if (!isPlainObject(entry.modelStats)) { return residuals; }
    const repByModel: Record<string, Record<string, number>> = {};
    for (const call of calls) {
        const mk = typeof call.modelKey === 'string' && call.modelKey ? call.modelKey : 'Unknown';
        addCallToMergedModelStats(repByModel[mk] ??= createEmptyMergedModelStats(), call);
    }
    for (const [mk, rawMs] of Object.entries(entry.modelStats)) {
        if (!isPlainObject(rawMs)) { continue; }
        const n = normalizeModelStatsObject(rawMs);
        const r = repByModel[mk] || createEmptyMergedModelStats();
        const rem = {
            calls: Math.max(0, n.calls - r.calls),
            inputTokens: Math.max(0, n.inputTokens - r.inputTokens),
            outputTokens: Math.max(0, n.outputTokens - r.outputTokens),
            thinkingTokens: Math.max(0, n.thinkingTokens - r.thinkingTokens),
            cacheReadTokens: Math.max(0, n.cacheReadTokens - r.cacheReadTokens),
            cacheCreationTokens: Math.max(0, n.cacheCreationTokens - r.cacheCreationTokens),
            credits: Math.max(0, n.credits - r.credits),
            estimatedCost: Math.max(0, n.estimatedCost - r.estimatedCost),
        };
        if (Object.values(rem).some(v => v > 0)) {
            const remTtftCount = Math.max(0, n.ttftCount - r.ttftCount);
            residuals[mk] = {
                ...rem,
                ttftSum: Math.max(0, n.ttftSum - r.ttftSum),
                ttftCount: remTtftCount,
                minTTFT: remTtftCount > 0 ? n.minTTFT : 0,
                maxTTFT: remTtftCount > 0 ? n.maxTTFT : 0,
                streamingSum: Math.max(0, n.streamingSum - r.streamingSum),
                streamingCount: Math.max(0, n.streamingCount - r.streamingCount),
                timedOutputTokens: Math.max(0, n.timedOutputTokens - r.timedOutputTokens),
                timedStreamingSeconds: Math.max(0, n.timedStreamingSeconds - r.timedStreamingSeconds),
                cacheHitCalls: Math.max(0, n.cacheHitCalls - r.cacheHitCalls),
            };
        }
    }
    return residuals;
}

const TOTAL_STAT_FIELDS = [
    ['totalCalls', 'calls'],
    ['totalInputTokens', 'inputTokens'],
    ['totalOutputTokens', 'outputTokens'],
    ['totalThinkingTokens', 'thinkingTokens'],
    ['totalCacheRead', 'cacheReadTokens'],
    ['totalCacheCreation', 'cacheCreationTokens'],
    ['totalCredits', 'credits'],
    ['totalEstimatedCost', 'estimatedCost'],
] as const;

function addSurfaceStatsObj(target: Record<string, number>, src: Record<string, unknown>, callsOverride?: number): void {
    target.calls += callsOverride ?? toFiniteNumber(src.calls, 0);
    target.inputTokens += toFiniteNumber(src.inputTokens, 0);
    target.outputTokens += toFiniteNumber(src.outputTokens, 0);
    target.thinkingTokens += toFiniteNumber(src.thinkingTokens, 0);
    target.cacheReadTokens += toFiniteNumber(src.cacheReadTokens, 0);
    target.cacheCreationTokens += toFiniteNumber(src.cacheCreationTokens, 0);
    target.credits += toFiniteNumber(src.credits, 0);
    target.estimatedCost += toFiniteNumber(src.estimatedCost, 0);
}

function emptySurfaceStatsObj(): Record<string, number> {
    return { calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, credits: 0, estimatedCost: 0 };
}

function mergeCanonicalCallIds(diskIds: unknown, localIds: unknown, calls: Array<Record<string, unknown>>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (raw: unknown) => {
        if (typeof raw !== 'string' || !raw) { return; }
        const canon = canonicalLedgerCallId(raw);
        if (!seen.has(canon)) { seen.add(canon); out.push(raw); }
    };
    if (Array.isArray(diskIds)) { diskIds.forEach(add); }
    if (Array.isArray(localIds)) { localIds.forEach(add); }
    for (const c of calls) { add(c.callId); }
    return out;
}

function buildSurfaceSummaryFromCalls(
    calls: Array<Record<string, unknown>>,
    fallbackSurf: string,
    hasSurface: boolean,
): { surfaceBreakdown: Record<string, Record<string, number>>; dominantSurface?: string } {
    const surfaceBreakdown: Record<string, Record<string, number>> = {};
    if (hasSurface && calls.length > 0) {
        for (const call of calls) {
            const surf = typeof call.surface === 'string' && call.surface ? call.surface : fallbackSurf;
            addSurfaceStatsObj(surfaceBreakdown[surf] ??= emptySurfaceStatsObj(), call, 1);
        }
    }
    let dominantSurface: string | undefined;
    let bestCalls = -1;
    for (const [surf, sb] of Object.entries(surfaceBreakdown)) {
        if (surf !== 'unknown' && sb.calls > bestCalls) { bestCalls = sb.calls; dominantSurface = surf; }
    }
    if (!dominantSurface && fallbackSurf && fallbackSurf !== 'unknown') { dominantSurface = fallbackSurf; }
    return { surfaceBreakdown, dominantSurface };
}

function sumModelStatsTotals(modelStats: Record<string, Record<string, number>>): Record<string, number> {
    const totals: Record<string, number> = {
        totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0, totalThinkingTokens: 0,
        totalCacheRead: 0, totalCacheCreation: 0, totalCredits: 0, totalEstimatedCost: 0,
    };
    for (const ms of Object.values(modelStats)) {
        for (const [totKey, msKey] of TOTAL_STAT_FIELDS) { totals[totKey] += ms[msKey]; }
    }
    return totals;
}

function mergeTwoSettledEntries(
    diskEntry: Record<string, unknown>,
    localEntry: Record<string, unknown>,
): Record<string, unknown> {
    const diskCalls = extractSettledCallsFromEntry(diskEntry);
    const localCalls = extractSettledCallsFromEntry(localEntry);

    const poolModelIds = unionStringArrayCaseInsensitive(diskEntry.poolModelIds, localEntry.poolModelIds);
    const mergedCutoff = (() => {
        const d = typeof diskEntry.settledCutoffTime === 'number' && Number.isFinite(diskEntry.settledCutoffTime) ? diskEntry.settledCutoffTime : null;
        const l = typeof localEntry.settledCutoffTime === 'number' && Number.isFinite(localEntry.settledCutoffTime) ? localEntry.settledCutoffTime : null;
        return d !== null && l !== null ? Math.max(d, l) : (d ?? l ?? undefined);
    })();
    const settledAt = (() => {
        const d = typeof diskEntry.settledAt === 'string' ? diskEntry.settledAt : '';
        const l = typeof localEntry.settledAt === 'string' ? localEntry.settledAt : '';
        return d && l ? (d >= l ? d : l) : (d || l || new Date().toISOString());
    })();
    const accountEmail = (typeof diskEntry.accountEmail === 'string' && diskEntry.accountEmail)
        || (typeof localEntry.accountEmail === 'string' ? localEntry.accountEmail : '');

    if (diskCalls.length > 0 || localCalls.length > 0) {
        const callMap = new Map<string, Record<string, unknown>>();
        for (const call of [...diskCalls, ...localCalls]) {
            const canon = canonicalLedgerCallId(call.callId as string);
            const existing = callMap.get(canon);
            callMap.set(canon, existing ? chooseRicherRecordedCall(existing, call) : deepClone(call));
        }
        const mergedCalls = [...callMap.values()];
        const modelStats: Record<string, Record<string, number>> = {};
        const diskResiduals = computeLegacyModelResiduals(diskEntry, diskCalls);
        const localResiduals = computeLegacyModelResiduals(localEntry, localCalls);
        for (const mk of new Set<string>([...Object.keys(diskResiduals), ...Object.keys(localResiduals)])) {
            const dr = diskResiduals[mk], lr = localResiduals[mk];
            const chosen = dr && lr ? (modelStatsRichness(dr) >= modelStatsRichness(lr) ? dr : lr) : (dr || lr);
            if (chosen && chosen.calls > 0) { modelStats[mk] = { ...chosen }; }
        }
        let hasSurface = Boolean(diskEntry.surfaceBreakdown || localEntry.surfaceBreakdown || diskEntry.surface || localEntry.surface);
        const fallbackSurf = (typeof localEntry.surface === 'string' && localEntry.surface)
            || (typeof diskEntry.surface === 'string' && diskEntry.surface) || 'unknown';
        for (const call of mergedCalls) {
            const mk = typeof call.modelKey === 'string' && call.modelKey ? call.modelKey : 'Unknown';
            addCallToMergedModelStats(modelStats[mk] ??= createEmptyMergedModelStats(), call);
            const rawSurf = typeof call.surface === 'string' && call.surface ? call.surface : '';
            if (rawSurf && rawSurf !== 'unknown') { hasSurface = true; }
        }
        const { surfaceBreakdown, dominantSurface } = buildSurfaceSummaryFromCalls(mergedCalls, fallbackSurf, hasSurface);
        const totals = sumModelStatsTotals(modelStats);
        const modelCalls: Record<string, number> = {};
        const modelTelemetry: Record<string, Record<string, number>> = {};
        for (const [mk, ms] of Object.entries(modelStats)) {
            modelCalls[mk] = ms.calls;
            if (ms.ttftCount > 0 || ms.streamingCount > 0 || ms.timedStreamingSeconds > 0 || ms.cacheHitCalls > 0) {
                modelTelemetry[mk] = {
                    ttftSum: ms.ttftSum, ttftCount: ms.ttftCount,
                    ...(ms.minTTFT > 0 ? { minTTFT: ms.minTTFT } : {}),
                    ...(ms.maxTTFT > 0 ? { maxTTFT: ms.maxTTFT } : {}),
                    streamingSum: ms.streamingSum, streamingCount: ms.streamingCount,
                    timedOutputTokens: ms.timedOutputTokens, timedStreamingSeconds: ms.timedStreamingSeconds, cacheHitCalls: ms.cacheHitCalls,
                };
            }
        }
        const mergedCallIds = mergeCanonicalCallIds(diskEntry.recordedCallIds, localEntry.recordedCallIds, mergedCalls);
        const poolModelLabels = unionStringArrayCaseInsensitive(
            unionStringArrayCaseInsensitive(diskEntry.poolModelLabels, localEntry.poolModelLabels), Object.keys(modelStats),
        );
        const mergedEntry: Record<string, unknown> = {
            settledAt, accountEmail, poolModelIds, poolModelLabels, ...totals,
            ...(mergedCutoff !== undefined ? { settledCutoffTime: mergedCutoff } : {}),
            modelCalls, modelStats,
            ...(Object.keys(modelTelemetry).length > 0 ? { modelTelemetry } : {}),
            ...(dominantSurface ? { surface: dominantSurface } : {}),
            ...(Object.keys(surfaceBreakdown).length > 0 ? { surfaceBreakdown } : {}),
            settledCalls: mergedCalls,
            ...(mergedCallIds.length > 0 ? { recordedCallIds: mergedCallIds } : {}),
        };
        return { ...mergedEntry, ...mergedWorkspaceAttribution(mergedCalls, mergedEntry) };
    }

    const diskIdSet = extractRecordedCallIdSet(diskEntry);
    const localIdSet = extractRecordedCallIdSet(localEntry);
    const strictlyDisjointIds = diskIdSet.size > 0 && localIdSet.size > 0 && ![...diskIdSet].some(id => localIdSet.has(id));
    const diskModelStats = isPlainObject(diskEntry.modelStats) ? diskEntry.modelStats : {};
    const localModelStats = isPlainObject(localEntry.modelStats) ? localEntry.modelStats : {};
    const diskModelCalls = isPlainObject(diskEntry.modelCalls) ? diskEntry.modelCalls : {};
    const localModelCalls = isPlainObject(localEntry.modelCalls) ? localEntry.modelCalls : {};
    const allModelKeys = new Set<string>([...Object.keys(diskModelStats), ...Object.keys(localModelStats), ...Object.keys(diskModelCalls), ...Object.keys(localModelCalls)]);
    const diskHasPerModel = Object.keys(diskModelStats).length > 0 || Object.keys(diskModelCalls).length > 0;
    const localHasPerModel = Object.keys(localModelStats).length > 0 || Object.keys(localModelCalls).length > 0;

    if (!diskHasPerModel || !localHasPerModel) {
        const winner = deepClone(getSettledRichnessScore(localEntry) > getSettledRichnessScore(diskEntry) ? localEntry : diskEntry);
        if (strictlyDisjointIds) {
            for (const [k] of TOTAL_STAT_FIELDS) { winner[k] = toFiniteNumber(diskEntry[k], 0) + toFiniteNumber(localEntry[k], 0); }
            winner.recordedCallIds = [...new Set([...diskIdSet, ...localIdSet])];
        }
        return winner;
    }

    const mergedModelStats: Record<string, Record<string, number>> = {};
    const mergedModelCalls: Record<string, number> = {};
    let hasFullModelStats = false;
    let hasDiskModels = false;
    let hasLocalModels = false;
    let hasOverlappingModels = false;

    for (const mk of allModelKeys) {
        const dMsRaw = isPlainObject(diskModelStats[mk]) ? diskModelStats[mk] as Record<string, unknown> : null;
        const lMsRaw = isPlainObject(localModelStats[mk]) ? localModelStats[mk] as Record<string, unknown> : null;
        const dCallsCount = toFiniteNumber(diskModelCalls[mk], dMsRaw ? toFiniteNumber(dMsRaw.calls, 0) : 0);
        const lCallsCount = toFiniteNumber(localModelCalls[mk], lMsRaw ? toFiniteNumber(lMsRaw.calls, 0) : 0);

        const inDisk = Boolean(dMsRaw || dCallsCount > 0);
        const inLocal = Boolean(lMsRaw || lCallsCount > 0);
        if (inDisk) { hasDiskModels = true; }
        if (inLocal) { hasLocalModels = true; }
        if (inDisk && inLocal) { hasOverlappingModels = true; }

        if (dMsRaw && lMsRaw) {
            hasFullModelStats = true;
            const dNorm = normalizeModelStatsObject(dMsRaw);
            const lNorm = normalizeModelStatsObject(lMsRaw);
            if (strictlyDisjointIds) {
                const combined = { ...dNorm };
                addMergedModelStats(combined, lNorm);
                mergedModelStats[mk] = combined;
                mergedModelCalls[mk] = combined.calls;
            } else {
                const chosen = modelStatsRichness(lNorm) > modelStatsRichness(dNorm) ? lNorm : dNorm;
                mergedModelStats[mk] = chosen;
                mergedModelCalls[mk] = Math.max(chosen.calls, dCallsCount, lCallsCount);
            }
        } else if (dMsRaw || lMsRaw) {
            hasFullModelStats = true;
            const only = normalizeModelStatsObject((dMsRaw || lMsRaw)!);
            mergedModelStats[mk] = only;
            mergedModelCalls[mk] = Math.max(only.calls, dCallsCount, lCallsCount);
        } else {
            mergedModelCalls[mk] = strictlyDisjointIds
                ? (dCallsCount + lCallsCount)
                : Math.max(dCallsCount, lCallsCount);
        }
    }

    // Only treat the two host snapshots as fully additive when call IDs are proven strictly disjoint
    // OR every model key on disk is disjoint from every model key on local (zero overlap).
    const allModelsStrictlyDisjoint = hasDiskModels && hasLocalModels && !hasOverlappingModels;

    // Merge surfaceBreakdown across hosts
    const mergedSurfaceBreakdown: Record<string, Record<string, number>> = {};
    const diskSb = isPlainObject(diskEntry.surfaceBreakdown) ? diskEntry.surfaceBreakdown as Record<string, unknown> : null;
    const localSb = isPlainObject(localEntry.surfaceBreakdown) ? localEntry.surfaceBreakdown as Record<string, unknown> : null;
    if (diskSb || localSb) {
        const allSurfs = new Set<string>([
            ...(diskSb ? Object.keys(diskSb) : []),
            ...(localSb ? Object.keys(localSb) : []),
        ]);
        for (const surf of allSurfs) {
            const ds = diskSb && isPlainObject(diskSb[surf]) ? diskSb[surf] as Record<string, unknown> : null;
            const ls = localSb && isPlainObject(localSb[surf]) ? localSb[surf] as Record<string, unknown> : null;
            if (ds && ls) {
                const out = emptySurfaceStatsObj();
                if (strictlyDisjointIds || allModelsStrictlyDisjoint) {
                    addSurfaceStatsObj(out, ds);
                    addSurfaceStatsObj(out, ls);
                } else {
                    addSurfaceStatsObj(out, toFiniteNumber(ls.calls, 0) > toFiniteNumber(ds.calls, 0) ? ls : ds);
                }
                mergedSurfaceBreakdown[surf] = out;
            } else if (ds || ls) {
                const out = emptySurfaceStatsObj();
                addSurfaceStatsObj(out, (ds || ls)!);
                mergedSurfaceBreakdown[surf] = out;
            }
        }
    }

    const richerBase = getSettledRichnessScore(localEntry) > getSettledRichnessScore(diskEntry) ? localEntry : diskEntry;
    let totals: Record<string, number>;
    if (hasFullModelStats) {
        totals = sumModelStatsTotals(mergedModelStats);
        if (totals.totalInputTokens === 0 && totals.totalOutputTokens === 0) {
            for (const [k] of TOTAL_STAT_FIELDS) { if (k !== 'totalCalls') { totals[k] = toFiniteNumber(richerBase[k], 0); } }
        }
    } else if (strictlyDisjointIds || allModelsStrictlyDisjoint) {
        totals = { totalCalls: Object.values(mergedModelCalls).reduce((s, c) => s + c, 0) };
        for (const [k] of TOTAL_STAT_FIELDS) { if (k !== 'totalCalls') { totals[k] = toFiniteNumber(diskEntry[k], 0) + toFiniteNumber(localEntry[k], 0); } }
    } else {
        totals = { totalCalls: Math.max(Object.values(mergedModelCalls).reduce((s, c) => s + c, 0), toFiniteNumber(richerBase.totalCalls, 0)) };
        for (const [k] of TOTAL_STAT_FIELDS) { if (k !== 'totalCalls') { totals[k] = toFiniteNumber(richerBase[k], 0); } }
    }

    const mergedRecordedIds = [...new Set([...diskIdSet, ...localIdSet])];
    const poolModelLabels = unionStringArrayCaseInsensitive(
        unionStringArrayCaseInsensitive(diskEntry.poolModelLabels, localEntry.poolModelLabels),
        [...allModelKeys],
    );

    const out: Record<string, unknown> = {
        ...deepClone(richerBase),
        settledAt, accountEmail, poolModelIds, poolModelLabels, ...totals,
        ...(mergedCutoff !== undefined ? { settledCutoffTime: mergedCutoff } : {}),
        modelCalls: mergedModelCalls,
        ...(hasFullModelStats ? { modelStats: mergedModelStats } : {}),
        ...(Object.keys(mergedSurfaceBreakdown).length > 0 ? { surfaceBreakdown: mergedSurfaceBreakdown } : {}),
        ...(mergedRecordedIds.length > 0 ? { recordedCallIds: mergedRecordedIds } : {}),
    };
    return out;
}

/**
 * Semantic settled-entry merge: deduplicates concurrent App + IDE settlements for the
 * same `${accountEmail}|${poolIds}|${bucketResetCutoffMs}` within ±60s drift while
 * MERGING deduplicated call/model aggregates from BOTH hosts (never discarding disjoint
 * contributions by picking only one "richer" snapshot).
 */
export function mergeSettledEntries(diskSettled: unknown[], localSettled: unknown[]): unknown[] {
    const out: unknown[] = [];
    const exactSeen = new Set<string>();
    const indexedByPool = new Map<string, Array<{ index: number; eventTimeMs: number | null }>>();

    const add = (entry: unknown) => {
        if (!isPlainObject(entry)) {
            const rawKey = JSON.stringify(entry);
            if (exactSeen.has(rawKey)) { return; }
            exactSeen.add(rawKey);
            out.push(deepClone(entry));
            return;
        }

        const poolSig = getSettledPoolSignature(entry);
        const eventTimeMs = getSettledEventTimestampMs(entry);
        const hasIdentity = poolSig !== '|' || eventTimeMs !== null;

        if (!hasIdentity) {
            const rawKey = JSON.stringify(entry);
            if (exactSeen.has(rawKey)) { return; }
            exactSeen.add(rawKey);
            out.push(deepClone(entry));
            return;
        }

        const bucket = indexedByPool.get(poolSig);
        if (bucket) {
            for (const existing of bucket) {
                const sameEvent = (existing.eventTimeMs !== null && eventTimeMs !== null)
                    ? Math.abs(existing.eventTimeMs - eventTimeMs) <= SETTLED_TIMESTAMP_DRIFT_TOLERANCE_MS
                    : (existing.eventTimeMs === null && eventTimeMs === null);
                if (sameEvent) {
                    const prevEntry = out[existing.index];
                    if (isPlainObject(prevEntry)) {
                        const merged = mergeTwoSettledEntries(prevEntry, entry);
                        out[existing.index] = merged;
                        const mergedTime = getSettledEventTimestampMs(merged);
                        if (mergedTime !== null) {
                            existing.eventTimeMs = mergedTime;
                        }
                    }
                    return;
                }
            }
        }

        const newIdx = out.length;
        out.push(deepClone(entry));
        if (!bucket) {
            indexedByPool.set(poolSig, [{ index: newIdx, eventTimeMs }]);
        } else {
            bucket.push({ index: newIdx, eventTimeMs });
        }
    };

    for (const item of diskSettled) { add(item); }
    for (const item of localSettled) { add(item); }
    return out;
}

function isLedgerRecordedCallObject(value: unknown): value is Record<string, unknown> {
    return isPlainObject(value) && typeof value.callId === 'string' && value.callId.length > 0;
}

function chooseRicherRecordedCall(
    diskCall: Record<string, unknown>,
    localCall: Record<string, unknown>,
): Record<string, unknown> {
    const merged = deepClone(diskCall);
    const diskHasTs = typeof diskCall.createdAt === 'string' && !Number.isNaN(Date.parse(diskCall.createdAt));
    const localHasTs = typeof localCall.createdAt === 'string' && !Number.isNaN(Date.parse(localCall.createdAt));
    if (!diskHasTs && localHasTs) {
        merged.createdAt = localCall.createdAt;
        if (typeof localCall.createdAtMs === 'number' && Number.isFinite(localCall.createdAtMs)) {
            merged.createdAtMs = localCall.createdAtMs;
        }
    }
    const diskCost = toFiniteNumber(diskCall.estimatedCost, 0);
    const localCost = toFiniteNumber(localCall.estimatedCost, 0);
    if (diskCost <= 0 && localCost > 0) {
        merged.estimatedCost = localCost;
    }
    if ((typeof merged.ttftSeconds !== 'number' || merged.ttftSeconds <= 0)
        && typeof localCall.ttftSeconds === 'number' && localCall.ttftSeconds > 0) {
        merged.ttftSeconds = localCall.ttftSeconds;
    }
    if ((typeof merged.streamingSeconds !== 'number' || merged.streamingSeconds <= 0)
        && typeof localCall.streamingSeconds === 'number' && localCall.streamingSeconds > 0) {
        merged.streamingSeconds = localCall.streamingSeconds;
    }
    if ((!merged.surface || merged.surface === 'unknown') && typeof localCall.surface === 'string' && localCall.surface !== 'unknown') {
        merged.surface = localCall.surface;
    }
    if ((!merged.workspace || merged.workspace === UNATTRIBUTED_WORKSPACE_KEY) &&
        typeof localCall.workspace === 'string' && localCall.workspace !== UNATTRIBUTED_WORKSPACE_KEY) {
        merged.workspace = localCall.workspace;
        merged.authority = localCall.authority;
    }
    return merged;
}

/** Rebuild attribution from the same unique calls as the model totals. Older
 * aggregate-only usage has no reliable project identity. */
function mergedWorkspaceAttribution(calls: Record<string, unknown>[], totals: Record<string, unknown>) {
    if (!calls.some(call => call.workspace || call.authority)) { return {}; }
    const workspaces: Record<string, WorkspaceUsageStats> = Object.create(null);
    for (const call of calls) {
        const authority = typeof call.authority === 'string' ? call.authority : undefined;
        const workspace = typeof call.workspace === 'string' ? call.workspace : undefined;
        addCallToWorkspaceBreakdown(workspaces, normalizeWorkspaceKey(workspace, authority), {
            inputTokens: toFiniteNumber(call.inputTokens, 0), outputTokens: toFiniteNumber(call.outputTokens, 0),
            thinkingTokens: toFiniteNumber(call.thinkingTokens, 0), cacheReadTokens: toFiniteNumber(call.cacheReadTokens, 0),
            cacheCreationTokens: toFiniteNumber(call.cacheCreationTokens, 0), credits: toFiniteNumber(call.credits, 0),
            estimatedCost: toFiniteNumber(call.estimatedCost, 0), unpriced: call.unpriced === true,
            surface: normalizeUsageSurface(typeof call.surface === 'string' ? call.surface : undefined), authority,
        });
    }
    const missing = toFiniteNumber(totals.totalCalls, 0) - calls.length;
    if (missing > 0) {
        const represented = Object.values(workspaces);
        const residual = (field: keyof WorkspaceUsageStats, totalField: string) => Math.max(0,
            toFiniteNumber(totals[totalField], 0) - represented.reduce((sum, w) => sum + toFiniteNumber(w[field], 0), 0));
        const legacy = workspaces[UNATTRIBUTED_WORKSPACE_KEY];
        const usage = {
            calls: missing, inputTokens: residual('inputTokens', 'totalInputTokens'),
            outputTokens: residual('outputTokens', 'totalOutputTokens'), thinkingTokens: residual('thinkingTokens', 'totalThinkingTokens'),
            cacheReadTokens: residual('cacheReadTokens', 'totalCacheRead'), cacheCreationTokens: residual('cacheCreationTokens', 'totalCacheCreation'),
            credits: residual('credits', 'totalCredits'), estimatedCost: residual('knownCostUsd', 'totalEstimatedCost'),
        };
        const remainder: WorkspaceUsageStats = {
            ...usage, knownCostUsd: usage.estimatedCost, unpricedCalls: 0, bySurface: { unknown: usage },
        };
        if (legacy) { addWorkspaceStats(legacy, remainder); }
        else { workspaces[UNATTRIBUTED_WORKSPACE_KEY] = remainder; }
    }
    return { workspaceBreakdown: workspaces };
}

function createEmptyMergedModelStats(): Record<string, number> {
    return {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        thinkingTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        credits: 0,
        estimatedCost: 0,
        ttftSum: 0,
        ttftCount: 0,
        minTTFT: 0,
        maxTTFT: 0,
        streamingSum: 0,
        streamingCount: 0,
        timedOutputTokens: 0,
        timedStreamingSeconds: 0,
        cacheHitCalls: 0,
    };
}

function addCallToMergedModelStats(target: Record<string, number>, call: Record<string, unknown>): void {
    const inputTokens = toFiniteNumber(call.inputTokens, 0);
    const outputTokens = toFiniteNumber(call.outputTokens, 0);
    const thinkingTokens = toFiniteNumber(call.thinkingTokens, 0);
    const cacheReadTokens = toFiniteNumber(call.cacheReadTokens, 0);
    const cacheCreationTokens = toFiniteNumber(call.cacheCreationTokens, 0);
    const credits = toFiniteNumber(call.credits, 0);
    const estimatedCost = toFiniteNumber(call.estimatedCost, 0);
    const ttftSeconds = typeof call.ttftSeconds === 'number' && Number.isFinite(call.ttftSeconds) && call.ttftSeconds > 0
        ? call.ttftSeconds
        : 0;
    const streamingSeconds = typeof call.streamingSeconds === 'number' && Number.isFinite(call.streamingSeconds) && call.streamingSeconds > 0
        ? call.streamingSeconds
        : 0;

    target.calls += 1;
    target.inputTokens += inputTokens;
    target.outputTokens += outputTokens;
    target.thinkingTokens += thinkingTokens;
    target.cacheReadTokens += cacheReadTokens;
    target.cacheCreationTokens += cacheCreationTokens;
    target.credits += credits;
    target.estimatedCost += estimatedCost;
    if (ttftSeconds > 0) {
        target.ttftSum += ttftSeconds;
        target.ttftCount += 1;
        target.minTTFT = target.minTTFT > 0 ? Math.min(target.minTTFT, ttftSeconds) : ttftSeconds;
        target.maxTTFT = Math.max(target.maxTTFT, ttftSeconds);
    }
    if (streamingSeconds > 0) {
        target.streamingSum += streamingSeconds;
        target.streamingCount += 1;
        if (streamingSeconds >= LEDGER_SPEED_MIN_STREAM_SECONDS && outputTokens >= LEDGER_SPEED_MIN_OUTPUT_TOKENS) {
            target.timedOutputTokens += outputTokens;
            target.timedStreamingSeconds += streamingSeconds;
        }
    }
    if (cacheReadTokens > 0) {
        target.cacheHitCalls += 1;
    }
}

function computeLegacyBucketResiduals(bucket: Record<string, unknown>): Record<string, Record<string, number>> {
    const calls = Array.isArray(bucket.recordedCalls) ? bucket.recordedCalls.filter(isLedgerRecordedCallObject) : [];
    return computeLegacyModelResiduals(bucket, calls);
}

function mergeLedgerAccountBucket3Way(
    baseBucket: Record<string, unknown> | undefined,
    diskBucket: Record<string, unknown>,
    localBucket: Record<string, unknown>,
    settledIds?: ReadonlySet<string>,
): Record<string, unknown> {
    if (baseBucket && deepEqual(baseBucket, localBucket)) {
        return deepClone(diskBucket);
    }
    if (baseBucket && deepEqual(baseBucket, diskBucket)) {
        return deepClone(localBucket);
    }

    const diskHasCalls = Array.isArray(diskBucket.recordedCalls);
    const localHasCalls = Array.isArray(localBucket.recordedCalls);
    if (!diskHasCalls && !localHasCalls) {
        return mergePlainObjects3Way(baseBucket, diskBucket, localBucket, 1);
    }

    const toCallMap = (bucket: Record<string, unknown> | undefined): Map<string, Record<string, unknown>> => {
        const map = new Map<string, Record<string, unknown>>();
        if (!bucket || !Array.isArray(bucket.recordedCalls)) { return map; }
        for (const item of bucket.recordedCalls) {
            if (!isLedgerRecordedCallObject(item)) { continue; }
            const canonId = canonicalLedgerCallId(item.callId as string);
            if (settledIds?.has(canonId)) { continue; }
            const existing = map.get(canonId);
            map.set(
                canonId,
                existing ? chooseRicherRecordedCall(existing, item) : deepClone(item),
            );
        }
        return map;
    };

    const baseCallMap = toCallMap(baseBucket);
    const diskCallMap = toCallMap(diskBucket);
    const localCallMap = toCallMap(localBucket);

    // 3-way set merge on recordedCalls (keyed by durable canonical logical call ID):
    // - Calls present in BOTH disk & local are kept (merging richer metadata).
    // - Calls added by disk (not in base) are kept.
    // - Calls added by local (not in base) are kept.
    // - Calls present in base that were explicitly removed by one side (e.g. quota-reset settlement)
    //   are NOT resurrected into active buckets.
    const mergedCalls: Array<Record<string, unknown>> = [];
    const seenMergedCallIds = new Set<string>();

    for (const [id, dCall] of diskCallMap.entries()) {
        const lCall = localCallMap.get(id);
        if (lCall) {
            mergedCalls.push(chooseRicherRecordedCall(dCall, lCall));
            seenMergedCallIds.add(id);
        } else if (!baseCallMap.has(id)) {
            mergedCalls.push(deepClone(dCall));
            seenMergedCallIds.add(id);
        }
    }
    for (const [id, lCall] of localCallMap.entries()) {
        if (seenMergedCallIds.has(id)) { continue; }
        if (!baseCallMap.has(id)) {
            mergedCalls.push(deepClone(lCall));
            seenMergedCallIds.add(id);
        }
    }

    const mergedCallIds = mergeCanonicalCallIds(diskBucket.recordedCallIds, localBucket.recordedCallIds, mergedCalls);
    const modelStats: Record<string, Record<string, number>> = {};
    let hasSurfaceTracking = Boolean(diskBucket.surfaceBreakdown || localBucket.surfaceBreakdown || diskBucket.surface || localBucket.surface);
    const diskResiduals = computeLegacyBucketResiduals(diskBucket);
    const localResiduals = computeLegacyBucketResiduals(localBucket);
    for (const mk of new Set<string>([...Object.keys(diskResiduals), ...Object.keys(localResiduals)])) {
        const dr = diskResiduals[mk], lr = localResiduals[mk];
        const chosen = dr && lr ? (dr.calls >= lr.calls ? dr : lr) : (dr || lr);
        if (chosen && chosen.calls > 0) { modelStats[mk] = { ...chosen }; }
    }
    for (const call of mergedCalls) {
        const mk = typeof call.modelKey === 'string' && call.modelKey ? call.modelKey : 'Unknown';
        addCallToMergedModelStats(modelStats[mk] ??= createEmptyMergedModelStats(), call);
        const rawSurf = typeof call.surface === 'string' && call.surface ? call.surface : '';
        if (rawSurf && rawSurf !== 'unknown') { hasSurfaceTracking = true; }
    }
    const fallbackSurf = (typeof localBucket.surface === 'string' && localBucket.surface)
        || (typeof diskBucket.surface === 'string' && diskBucket.surface) || 'unknown';
    const { surfaceBreakdown, dominantSurface } = buildSurfaceSummaryFromCalls(mergedCalls, fallbackSurf, hasSurfaceTracking);
    const accountEmail = typeof localBucket.accountEmail === 'string'
        ? localBucket.accountEmail
        : (typeof diskBucket.accountEmail === 'string' ? diskBucket.accountEmail : '');
    const mergedBucket: Record<string, unknown> = {
        accountEmail, ...sumModelStatsTotals(modelStats),
        modelStats, recordedCallIds: mergedCallIds, recordedCalls: mergedCalls,
        ...(dominantSurface ? { surface: dominantSurface } : {}),
        ...(Object.keys(surfaceBreakdown).length > 0 ? { surfaceBreakdown } : {}),
    };
    return { ...mergedBucket, ...mergedWorkspaceAttribution(mergedCalls, mergedBucket) };
}

function mergeRecordMap3Way(
    baseMap: Record<string, unknown> | undefined,
    diskMap: Record<string, unknown>,
    localMap: Record<string, unknown>,
    mergeBoth: (b: Record<string, unknown> | undefined, d: Record<string, unknown>, l: Record<string, unknown>, key: string) => unknown,
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const key of new Set<string>([...Object.keys(diskMap), ...Object.keys(localMap)])) {
        const inDisk = hasOwn(diskMap, key), inLocal = hasOwn(localMap, key), inBase = !!baseMap && hasOwn(baseMap, key);
        const dVal = inDisk ? diskMap[key] : undefined, lVal = inLocal ? localMap[key] : undefined, bVal = inBase ? baseMap![key] : undefined;
        if (inDisk && inLocal && isPlainObject(dVal) && isPlainObject(lVal)) {
            result[key] = mergeBoth(isPlainObject(bVal) ? bVal : undefined, dVal, lVal, key);
        } else if (inDisk && !inLocal) {
            if (!(inBase && deepEqual(bVal, dVal))) { result[key] = deepClone(dVal); }
        } else if (!inDisk && inLocal) {
            if (!(inBase && deepEqual(bVal, lVal))) { result[key] = deepClone(lVal); }
        } else if (inLocal) { result[key] = deepClone(lVal); }
        else if (inDisk) { result[key] = deepClone(dVal); }
    }
    return result;
}

function mergeLedgerAccountsMap3Way(
    baseAccounts: Record<string, unknown> | undefined,
    diskAccounts: Record<string, unknown>,
    localAccounts: Record<string, unknown>,
): Record<string, unknown> {
    return mergeRecordMap3Way(baseAccounts, diskAccounts, localAccounts, (b, d, l) => mergeLedgerAccountBucket3Way(b, d, l));
}

/** A peer may roll over while this writer is still adding calls to yesterday.
 * Retain identifiable calls added since the common base in the late-day queue. */
function preserveRolloverCalls(
    older: Record<string, unknown>,
    base: Record<string, unknown> | undefined,
    lateDays: Record<string, unknown>,
): void {
    const date = older.dateKey;
    if (typeof date !== 'string') { return; }
    const baseIds = new Set<string>();
    if (base?.dateKey === date) {
        const rows = [
            ...Object.values(isPlainObject(base.accounts) ? base.accounts : {}),
            ...(Array.isArray(base.settled) ? base.settled : []),
        ];
        for (const row of rows.filter(isPlainObject)) {
            for (const id of extractRecordedCallIdSet(row)) { baseIds.add(id); }
            if (Array.isArray(row.recordedCalls)) {
                for (const c of row.recordedCalls.filter(isLedgerRecordedCallObject)) {
                    baseIds.add(canonicalLedgerCallId(c.callId as string));
                }
            }
        }
    }
    const pending = isPlainObject(lateDays[date]) ? lateDays[date] : {};
    const add = (email: string, calls: unknown) => {
        if (!Array.isArray(calls)) { return; }
        const extra = calls.filter(isLedgerRecordedCallObject).filter(c => !baseIds.has(canonicalLedgerCallId(c.callId as string)));
        if (extra.length === 0) { return; }
        const previous = isPlainObject(pending[email]) ? pending[email] : {};
        pending[email] = mergeLedgerAccountBucket3Way(undefined, previous, { accountEmail: email, recordedCalls: extra });
    };
    if (isPlainObject(older.accounts)) {
        for (const [email, bucket] of Object.entries(older.accounts)) {
            if (isPlainObject(bucket)) { add(email, bucket.recordedCalls); }
        }
    }
    if (Array.isArray(older.settled)) {
        for (const e of older.settled.filter(isPlainObject)) {
            add(typeof e.accountEmail === 'string' ? e.accountEmail : '', e.settledCalls);
        }
    }
    if (Object.keys(pending).length > 0) { lateDays[date] = pending; }
}

/**
 * Semantic 3-way merge for `DailyLedgerState`:
 * - Union-deduplicates `recordedCallIds` & 3-way merges `recordedCalls` per account,
 *   then recomputes daily totals / `modelStats` / `surfaceBreakdown` / cost aggregates
 *   so concurrent App + IDE writes never drop calls.
 * - Deduplicates `settled` entries semantically (±60s drift) via `mergeSettledEntries`.
 * - Semantically merges optional `lateDays` cross-midnight buckets when present.
 */
export function mergeDailyLedgerState3Way(
    base: Record<string, unknown> | undefined,
    disk: Record<string, unknown>,
    local: Record<string, unknown>,
): Record<string, unknown> {
    const diskDate = typeof disk.dateKey === 'string' ? disk.dateKey : '';
    const localDate = typeof local.dateKey === 'string' ? local.dateKey : '';
    if (diskDate && localDate && diskDate !== localDate) {
        const winner = deepClone(localDate > diskDate ? local : disk);
        const mergedLate = mergeLateDaysMap3Way(
            isPlainObject(base?.lateDays) ? base.lateDays : undefined,
            isPlainObject(disk.lateDays) ? disk.lateDays : {},
            isPlainObject(local.lateDays) ? local.lateDays : {},
        );
        preserveRolloverCalls(localDate > diskDate ? disk : local, base, mergedLate);
        if (Object.keys(mergedLate).length > 0) { winner.lateDays = mergedLate; }
        else { delete winner.lateDays; }
        return winner;
    }

    const merged = mergePlainObjects3Way(base, disk, local, 0);

    if (isPlainObject(disk.accounts) && isPlainObject(local.accounts)) {
        merged.accounts = mergeLedgerAccountsMap3Way(
            isPlainObject(base?.accounts) ? base.accounts : undefined,
            disk.accounts,
            local.accounts,
        );
    }

    if (Array.isArray(disk.settled) && Array.isArray(local.settled)) {
        merged.settled = mergeSettledEntries(disk.settled, local.settled);
    } else if (Array.isArray(disk.settled)) {
        merged.settled = deepClone(disk.settled);
    } else if (Array.isArray(local.settled)) {
        merged.settled = deepClone(local.settled);
    }

    // A call first observed after the shared base may already have settled on
    // the other host. Keep its dedup ID but never count it as active as well.
    if (Array.isArray(merged.settled) && isPlainObject(merged.accounts)) {
        const settledByAccount = new Map<string, Set<string>>();
        for (const entry of merged.settled.filter(isPlainObject)) {
            const account = typeof entry.accountEmail === 'string' ? entry.accountEmail : '';
            const ids = settledByAccount.get(account) ?? new Set<string>();
            for (const id of extractRecordedCallIdSet(entry)) { ids.add(id); }
            settledByAccount.set(account, ids);
        }
        for (const [email, bucket] of Object.entries(merged.accounts)) {
            const ids = settledByAccount.get(email);
            if (!ids?.size || !isPlainObject(bucket) || !Array.isArray(bucket.recordedCalls)) { continue; }
            if (bucket.recordedCalls.some(c => isLedgerRecordedCallObject(c) && ids.has(canonicalLedgerCallId(c.callId as string)))) {
                merged.accounts[email] = mergeLedgerAccountBucket3Way(undefined, bucket, bucket, ids);
            }
        }
    }

    if (isPlainObject(disk.lateDays) || isPlainObject(local.lateDays)) {
        const mergedLate = mergeLateDaysMap3Way(
            isPlainObject(base?.lateDays) ? base.lateDays : undefined,
            isPlainObject(disk.lateDays) ? disk.lateDays : {},
            isPlainObject(local.lateDays) ? local.lateDays : {},
        );
        if (Object.keys(mergedLate).length > 0) {
            merged.lateDays = mergedLate;
        } else {
            delete merged.lateDays;
        }
    }

    return merged;
}

function mergeLateDaysMap3Way(
    baseLate: Record<string, unknown> | undefined,
    diskLate: Record<string, unknown>,
    localLate: Record<string, unknown>,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const allDates = new Set<string>([...Object.keys(diskLate), ...Object.keys(localLate)]);
    for (const dateKey of allDates) {
        const dMap = isPlainObject(diskLate[dateKey]) ? diskLate[dateKey] as Record<string, unknown> : null;
        const lMap = isPlainObject(localLate[dateKey]) ? localLate[dateKey] as Record<string, unknown> : null;
        const bMap = baseLate && isPlainObject(baseLate[dateKey]) ? baseLate[dateKey] as Record<string, unknown> : undefined;
        if (dMap && lMap) {
            const mergedAccts = mergeLedgerAccountsMap3Way(bMap, dMap, lMap);
            if (Object.keys(mergedAccts).length > 0) {
                out[dateKey] = mergedAccts;
            }
        } else if (dMap) {
            if (!(bMap && deepEqual(bMap, dMap))) {
                out[dateKey] = deepClone(dMap);
            }
        } else if (lMap) {
            if (!(bMap && deepEqual(bMap, lMap))) {
                out[dateKey] = deepClone(lMap);
            }
        }
    }
    return out;
}

function mergeQuotaPoolHistory3Way(
    basePool: Record<string, unknown> | undefined,
    diskPool: Record<string, unknown>,
    localPool: Record<string, unknown>,
    poolKey: string,
): Record<string, unknown> {
    if (basePool && deepEqual(basePool, localPool)) {
        return deepClone(diskPool);
    }
    if (basePool && deepEqual(basePool, diskPool)) {
        return deepClone(localPool);
    }

    const optPosNum = (v: unknown): number | null =>
        typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
    const maxOptNum = (a: number | null, b: number | null): number | null => {
        if (a === null) { return b; }
        if (b === null) { return a; }
        return Math.max(a, b);
    };

    const diskReset = optPosNum(diskPool.lastResetTimeMs);
    const localReset = optPosNum(localPool.lastResetTimeMs);
    const diskRecovered = optPosNum(diskPool.recoveredAtMs);
    const localRecovered = optPosNum(localPool.recoveredAtMs);
    const diskLastObs = optPosNum(diskPool.lastObservedAtMs);
    const localLastObs = optPosNum(localPool.lastObservedAtMs);

    const extractSamples = (pool: Record<string, unknown>): Array<{ remainingFraction: number; timestampMs: number; resetTimeMs: number | null }> => {
        if (!Array.isArray(pool.samples)) { return []; }
        const out: Array<{ remainingFraction: number; timestampMs: number; resetTimeMs: number | null }> = [];
        for (const s of pool.samples) {
            if (!isPlainObject(s)) { continue; }
            if (typeof s.remainingFraction !== 'number' || !Number.isFinite(s.remainingFraction)) { continue; }
            if (typeof s.timestampMs !== 'number' || !Number.isFinite(s.timestampMs) || s.timestampMs < 0) { continue; }
            out.push({
                remainingFraction: Math.min(1, Math.max(0, s.remainingFraction)),
                timestampMs: Math.round(s.timestampMs),
                resetTimeMs: optPosNum(s.resetTimeMs),
            });
        }
        return out;
    };

    const diskSamples = extractSamples(diskPool);
    const localSamples = extractSamples(localPool);

    let chosenSamples: Array<{ remainingFraction: number; timestampMs: number; resetTimeMs: number | null }>;
    // If one side rolled forward into a newer reset cycle (> 60s newer resetTimeMs), keep the newer cycle's samples.
    if (diskReset !== null && localReset !== null && (diskReset - localReset) > QUOTA_RUNWAY_RESET_SHIFT_TOLERANCE_MS) {
        chosenSamples = diskSamples;
    } else if (diskReset !== null && localReset !== null && (localReset - diskReset) > QUOTA_RUNWAY_RESET_SHIFT_TOLERANCE_MS) {
        chosenSamples = localSamples;
    } else {
        const byTs = new Map<number, { remainingFraction: number; timestampMs: number; resetTimeMs: number | null }>();
        for (const s of diskSamples) {
            byTs.set(s.timestampMs, s);
        }
        for (const s of localSamples) {
            const existing = byTs.get(s.timestampMs);
            if (!existing) {
                byTs.set(s.timestampMs, s);
            } else {
                byTs.set(s.timestampMs, {
                    remainingFraction: Math.min(existing.remainingFraction, s.remainingFraction),
                    timestampMs: s.timestampMs,
                    resetTimeMs: maxOptNum(existing.resetTimeMs, s.resetTimeMs),
                });
            }
        }
        const effectiveRecovered = maxOptNum(diskRecovered, localRecovered);
        chosenSamples = [...byTs.values()]
            .filter(s => effectiveRecovered === null || s.timestampMs >= effectiveRecovered)
            .sort((a, b) => a.timestampMs - b.timestampMs);
        if (chosenSamples.length === 0) {
            chosenSamples = [...byTs.values()].sort((a, b) => a.timestampMs - b.timestampMs);
        }
    }

    if (chosenSamples.length > QUOTA_RUNWAY_MAX_SAMPLES) {
        chosenSamples = chosenSamples.slice(chosenSamples.length - QUOTA_RUNWAY_MAX_SAMPLES);
    }

    const latestSampleTs = chosenSamples.length > 0 ? chosenSamples[chosenSamples.length - 1].timestampMs : null;
    return {
        poolKey: typeof localPool.poolKey === 'string' && localPool.poolKey ? localPool.poolKey
            : (typeof diskPool.poolKey === 'string' && diskPool.poolKey ? diskPool.poolKey : poolKey),
        samples: chosenSamples,
        lastObservedAtMs: maxOptNum(maxOptNum(diskLastObs, localLastObs), latestSampleTs),
        lastResetTimeMs: maxOptNum(diskReset, localReset),
        recoveredAtMs: maxOptNum(diskRecovered, localRecovered),
    };
}

/**
 * Semantic 3-way merge for `SerializedQuotaRunwayState` so concurrent App + IDE
 * quota observations merge their sample timelines without clobbering each other.
 */
export function mergeQuotaRunwayState3Way(
    base: Record<string, unknown> | undefined,
    disk: Record<string, unknown>,
    local: Record<string, unknown>,
): Record<string, unknown> {
    const mergedPools = mergeRecordMap3Way(
        isPlainObject(base?.pools) ? base.pools : undefined,
        isPlainObject(disk.pools) ? disk.pools : {},
        isPlainObject(local.pools) ? local.pools : {},
        (b, d, l, poolKey) => mergeQuotaPoolHistory3Way(b, d, l, poolKey),
    );

    const diskWeekly = isPlainObject(disk.weeklyBuckets) ? { ...disk.weeklyBuckets } : {};
    const localWeekly = isPlainObject(local.weeklyBuckets) ? { ...local.weeklyBuckets } : {};
    if (isPlainObject(base?.weeklyBuckets)) {
        for (const [key, original] of Object.entries(base.weeklyBuckets)) {
            if (!hasOwn(localWeekly, key) && deepEqual(diskWeekly[key], original)) { delete diskWeekly[key]; }
            if (!hasOwn(diskWeekly, key) && deepEqual(localWeekly[key], original)) { delete localWeekly[key]; }
        }
    }
    const weekly = QuotaRunwayTracker.deserialize({ weeklyBuckets: diskWeekly });
    weekly.mergeFrom(QuotaRunwayTracker.deserialize({ weeklyBuckets: localWeekly }));
    const { weeklyBuckets } = weekly.serialize();
    return {
        version: 1,
        pools: mergedPools,
        ...(weeklyBuckets ? { weeklyBuckets } : {}),
    };
}

function collectCycleCallIdSet(cycle: Record<string, unknown>): Set<string> {
    const out = new Set<string>();
    if (Array.isArray(cycle.recordedCallIds)) {
        for (const id of cycle.recordedCallIds) {
            if (typeof id === 'string' && id) { out.add(canonicalLedgerCallId(id)); }
        }
    }
    if (isPlainObject(cycle.lateMergedCalls)) {
        for (const [key, val] of Object.entries(cycle.lateMergedCalls)) {
            if (key) { out.add(canonicalLedgerCallId(key)); }
            if (isPlainObject(val) && typeof val.callId === 'string' && val.callId) {
                out.add(canonicalLedgerCallId(val.callId));
            }
        }
    }
    return out;
}

function cycleActivityScore(cycle: Record<string, unknown>): number {
    return toFiniteNumber(cycle.totalReasoning, 0)
        + toFiniteNumber(cycle.totalToolCalls, 0)
        + toFiniteNumber(cycle.estSteps, 0);
}

function cycleBaseCallCount(cycle: Record<string, unknown>): number {
    const total = toFiniteNumber(cycle.gmTotalCalls, 0);
    const lateCount = isPlainObject(cycle.lateMergedCalls) ? Object.keys(cycle.lateMergedCalls).length : 0;
    return Math.max(0, total - lateCount);
}

function isCliOnlyDailyCycle(cycle: Record<string, unknown>): boolean {
    const surfaces = new Set<string>();
    if (isPlainObject(cycle.surfaceBreakdown)) {
        for (const [k, v] of Object.entries(cycle.surfaceBreakdown)) {
            if (!isPlainObject(v)) { continue; }
            const active = toFiniteNumber(v.calls, 0) > 0
                || toFiniteNumber(v.inputTokens, 0) > 0
                || toFiniteNumber(v.outputTokens, 0) > 0
                || toFiniteNumber(v.cacheReadTokens, 0) > 0;
            if (active && k && k !== 'unknown') {
                surfaces.add(k.toLowerCase());
            }
        }
    }
    if (surfaces.size === 0 && typeof cycle.surface === 'string') {
        const norm = cycle.surface.trim().toLowerCase();
        if (norm && norm !== 'unknown') {
            surfaces.add(norm);
        }
    }
    return surfaces.size === 1 && surfaces.has('cli');
}

function findPrimaryNonCliCycleIndex(cycles: Record<string, unknown>[]): number {
    const idx = cycles.findIndex(c => !isCliOnlyDailyCycle(c));
    return idx >= 0 ? idx : 0;
}

function mergeDailyStoreRecord3Way(
    baseRec: Record<string, unknown> | undefined,
    diskRec: Record<string, unknown>,
    localRec: Record<string, unknown>,
): Record<string, unknown> {
    if (baseRec && deepEqual(baseRec, localRec)) { return deepClone(diskRec); }
    if (baseRec && deepEqual(baseRec, diskRec)) { return deepClone(localRec); }

    const diskCycles = Array.isArray(diskRec.cycles) ? diskRec.cycles.filter(isPlainObject) : [];
    const localCycles = Array.isArray(localRec.cycles) ? localRec.cycles.filter(isPlainObject) : [];
    if (diskCycles.length === 0) { return deepClone(localRec); }
    if (localCycles.length === 0) { return deepClone(diskRec); }

    const diskPrimary = diskCycles[findPrimaryNonCliCycleIndex(diskCycles)];
    const localPrimary = localCycles[findPrimaryNonCliCycleIndex(localCycles)];
    const diskBaseScore = cycleBaseCallCount(diskPrimary) * 1e6 + cycleActivityScore(diskPrimary);
    const localBaseScore = cycleBaseCallCount(localPrimary) * 1e6 + cycleActivityScore(localPrimary);

    const winnerRec = deepClone(localBaseScore > diskBaseScore ? localRec : diskRec);
    const otherRec = localBaseScore > diskBaseScore ? diskRec : localRec;
    const winnerCycles = Array.isArray(winnerRec.cycles) ? winnerRec.cycles.filter(isPlainObject) : [];
    const otherCycles = Array.isArray(otherRec.cycles) ? otherRec.cycles.filter(isPlainObject) : [];
    if (winnerCycles.length === 0 || otherCycles.length === 0) {
        return winnerRec;
    }

    const targetCycle = winnerCycles[findPrimaryNonCliCycleIndex(winnerCycles)];
    const otherPrimaryCycle = otherCycles[findPrimaryNonCliCycleIndex(otherCycles)];
    // Preserve activity if winner had zero activity and other side had nonzero activity
    if (cycleActivityScore(targetCycle) === 0 && cycleActivityScore(otherPrimaryCycle) > 0) {
        targetCycle.totalReasoning = otherPrimaryCycle.totalReasoning;
        targetCycle.totalToolCalls = otherPrimaryCycle.totalToolCalls;
        targetCycle.totalErrors = otherPrimaryCycle.totalErrors;
        targetCycle.totalInputTokens = otherPrimaryCycle.totalInputTokens;
        targetCycle.totalOutputTokens = otherPrimaryCycle.totalOutputTokens;
        targetCycle.estSteps = otherPrimaryCycle.estSteps;
        targetCycle.modelNames = deepClone(otherPrimaryCycle.modelNames);
        if (otherPrimaryCycle.modelStats !== undefined) {
            targetCycle.modelStats = deepClone(otherPrimaryCycle.modelStats);
        }
    }

    const knownIds = new Set<string>();
    for (const c of winnerCycles) {
        for (const id of collectCycleCallIdSet(c)) {
            knownIds.add(id);
        }
    }

    // Use the same merge as a direct late write so project, surface, cost and
    // legacy GM totals survive a concurrent flush with exactly the same semantics.
    const lateCalls: DailyMergedLateCall[] = [];
    for (const oc of otherCycles) {
        if (!isPlainObject(oc.lateMergedCalls)) { continue; }
        for (const [key, rawCall] of Object.entries(oc.lateMergedCalls)) {
            if (!isPlainObject(rawCall)) { continue; }
            const id = typeof rawCall.callId === 'string' && rawCall.callId ? rawCall.callId : key;
            if (!id || knownIds.has(canonicalLedgerCallId(id))) { continue; }
            lateCalls.push({
                ...rawCall,
                callId: id,
                modelKey: typeof rawCall.modelKey === 'string' ? rawCall.modelKey : '',
                modelId: typeof rawCall.modelId === 'string' ? rawCall.modelId : '',
            } as DailyMergedLateCall);
        }
    }
    if (lateCalls.length > 0) {
        const { cycle } = mergeLateCallsIntoCycle(targetCycle as unknown as DailyCycleEntry, lateCalls, {
            externalSeenIds: knownIds,
        });
        Object.assign(targetCycle, cycle);
    }

    return winnerRec;
}

/**
 * Semantic 3-way merge for `DailyStoreState`:
 * Preserves existing archived activity & calls while idempotently union-merging concurrent
 * App + IDE late-call merges by durable canonical logical call ID.
 */
export function mergeDailyStoreState3Way(
    base: Record<string, unknown> | undefined,
    disk: Record<string, unknown>,
    local: Record<string, unknown>,
): Record<string, unknown> {
    return {
        version: 1,
        records: mergeRecordMap3Way(
            isPlainObject(base?.records) ? base!.records as Record<string, unknown> : undefined,
            isPlainObject(disk.records) ? disk.records as Record<string, unknown> : {},
            isPlainObject(local.records) ? local.records as Record<string, unknown> : {},
            (b, d, l) => mergeDailyStoreRecord3Way(b, d, l),
        ),
    };
}

function mergeConcurrentValue(
    key: string,
    baseVal: unknown,
    diskVal: unknown,
    localVal: unknown,
): unknown {
    if (key === 'accountSnapshots' && isAccountSnapshotArray(diskVal) && isAccountSnapshotArray(localVal)) {
        return mergeAccountSnapshotArrays3Way(baseVal, diskVal, localVal);
    }
    if ((key === 'dailyLedger' || key === 'dailyLedgerState') && isPlainObject(diskVal) && isPlainObject(localVal)) {
        return mergeDailyLedgerState3Way(
            isPlainObject(baseVal) ? baseVal : undefined,
            diskVal,
            localVal,
        );
    }
    if (key === 'dailyStoreState' && isPlainObject(diskVal) && isPlainObject(localVal)) {
        return mergeDailyStoreState3Way(
            isPlainObject(baseVal) ? baseVal : undefined,
            diskVal,
            localVal,
        );
    }
    if (key === 'quotaRunwayState' && isPlainObject(diskVal) && isPlainObject(localVal)) {
        return mergeQuotaRunwayState3Way(
            isPlainObject(baseVal) ? baseVal : undefined,
            diskVal,
            localVal,
        );
    }
    if (key === 'monitorSnapshotState' && isPlainObject(diskVal) && isPlainObject(localVal)) {
        return mergePlainObjects3Way(
            isPlainObject(baseVal) ? baseVal : undefined,
            diskVal,
            localVal,
            0,
        );
    }
    if (DEEP_MERGE_OBJECT_KEYS.has(key) && isPlainObject(diskVal) && isPlainObject(localVal)) {
        return mergePlainObjects3Way(
            isPlainObject(baseVal) ? baseVal : undefined,
            diskVal,
            localVal,
            0,
        );
    }
    return deepClone(localVal);
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, ms));
}

async function renameWithRetry(src: string, dest: string, verifyCommit: () => Promise<void>): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        await verifyCommit();
        try {
            await fs.promises.rename(src, dest);
            return;
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
            if (!retryable || attempt >= RENAME_RETRY_DELAYS_MS.length) {
                throw err;
            }
            await sleep(RENAME_RETRY_DELAYS_MS[attempt]);
        }
    }
}

async function readFileWithRetry(filePath: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await fs.promises.readFile(filePath, 'utf8');
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
            if (!retryable || attempt >= 2) {
                throw err;
            }
            await sleep(15 * (attempt + 1));
        }
    }
}

function buildTempFilePath(filePath: string): string {
    tmpNonceCounter = (tmpNonceCounter + 1) >>> 0;
    const nonce = `${crypto.randomBytes(6).toString('hex')}-${tmpNonceCounter.toString(36)}`;
    return path.join(path.dirname(filePath), `${path.basename(filePath)}.${process.pid}.${nonce}.tmp`);
}

export interface LockFileMetadata {
    pid: number | null;
    createdAtMs: number | null;
    token: string | null;
    /** Sanitized hostname recorded by the lock owner (single-host safety check; null on legacy 3-part lockfiles). */
    hostId: string | null;
}

export interface AcquireLockOptions {
    /** Max milliseconds to wait for an active lock before throwing DurableStateLockTimeoutError. */
    timeoutMs?: number;
    /** Age threshold (ms) after which a corrupt/PID-less lock is considered stale. */
    staleMs?: number;
    /** @deprecated Age alone cannot prove a live or foreign writer has released its lock. */
    hardStaleMs?: number;
    /** Injectable PID liveness probe (defaults to process.kill(pid, 0)). */
    isPidAlive?: (pid: number) => boolean;
    /** Injectable clock (defaults to Date.now). */
    now?: () => number;
    /** Injectable host identity for single-host lock verification (defaults to sanitized os.hostname()). */
    hostId?: string;
}

export interface FencedLockHandle {
    readonly ownerToken: string;
    readonly lockPath: string;
    /** Verify this writer still exclusively owns the lockfile on disk (fencing check before commit). */
    verifyOwned(): Promise<boolean>;
    /** Release the lockfile if still owned by this writer. */
    release(): Promise<void>;
}

/**
 * Real commit receipt returned by `DurableState.flush()`, `waitForCommit()`, and `*WithReceipt()` APIs.
 * Callers MUST inspect `committed === true` before displaying "Saved" to the user.
 */
export interface DurableStateCommitReceipt {
    committed: boolean;
    /** Highest revision confirmed durably written to disk. */
    revision: number;
    /** Latest in-memory staged revision (`revision === pendingRevision` when fully caught up). */
    pendingRevision: number;
    /** Explicit commit state: 'committed' (on disk), 'pending' (dirty & backoff retry scheduled), or 'failed' (uncommitted, no retry active). */
    status: 'committed' | 'pending' | 'failed';
    /** Error message from the most recent failed flush attempt, if any. */
    error?: string;
    /** Error code (e.g. 'ELOCKTIMEOUT', 'ELOCKLOST', 'EROFS'), if any. */
    errorCode?: string;
    /** Whether an automatic exponential backoff retry timer is active for dirty writes. */
    retryScheduled: boolean;
}

export interface DurableStateOptions {
    lockOptions?: AcquireLockOptions;
    /** Debounce delay (ms) before flushing dirty writes to disk (default: 250ms). */
    debounceMs?: number;
    /** Base backoff delay (ms) before retrying a failed or lock-timed-out flush (default: 250ms). */
    retryDelayMs?: number;
    /** Maximum automatic retry attempts after a failed flush before pausing until next write (default: 8). */
    maxRetryAttempts?: number;
}

export class DurableStateLockTimeoutError extends Error {
    readonly code = 'ELOCKTIMEOUT';
    readonly lockPath: string;
    readonly holderPid: number | null;

    constructor(lockPath: string, holderPid: number | null) {
        super(
            holderPid !== null
                ? `Timed out waiting for durable state lock held by active PID ${holderPid}: ${lockPath}`
                : `Timed out waiting for active durable state lock: ${lockPath}`,
        );
        this.name = 'DurableStateLockTimeoutError';
        this.lockPath = lockPath;
        this.holderPid = holderPid;
    }
}

export class DurableStateLockLostError extends Error {
    readonly code = 'ELOCKLOST';
    readonly lockPath: string;

    constructor(lockPath: string, reason = 'lock ownership lost before atomic commit') {
        super(`Durable state fencing check failed (${reason}): ${lockPath}`);
        this.name = 'DurableStateLockLostError';
        this.lockPath = lockPath;
    }
}

function getLocalHostId(): string {
    try {
        const host = os.hostname().trim().replace(/[^A-Za-z0-9._-]/g, '_') || 'local';
        if (process.platform === 'linux') {
            try {
                const ns = /^pid:\[(\d+)\]$/.exec(fs.readlinkSync('/proc/self/ns/pid'));
                if (ns) { return `${host}.pidns-${ns[1]}`; }
            } catch { /* procfs may be unavailable outside conventional Linux hosts */ }
        }
        return host;
    } catch {
        return 'local';
    }
}

function monotonicNowMs(): number {
    return Number(process.hrtime.bigint() / 1_000_000n);
}

/**
 * Parse lock file contents formatted as `<pid>:<timestampMs>[:<ownerToken>[:<hostId>]]`.
 */
export function parseLockFileContent(raw: string): LockFileMetadata | null {
    const trimmed = raw.trim();
    if (!trimmed) { return null; }
    const parts = trimmed.split(':');
    const pid = /^\d+$/.test(parts[0] || '') ? Number(parts[0]) : null;
    const validPid = pid !== null && Number.isSafeInteger(pid) && pid > 0 && pid <= 0xffffffff ? pid : null;
    const createdAtMs = parts.length >= 2 && /^\d+$/.test(parts[1] || '') ? Number(parts[1]) : null;
    const validTs = createdAtMs !== null && Number.isSafeInteger(createdAtMs) && createdAtMs > 0 ? createdAtMs : null;
    const token = parts.length >= 3 && parts[2].trim().length > 0 ? parts[2].trim() : null;
    const hostId = parts.length >= 4 && parts[3].trim().length > 0 ? parts[3].trim() : null;
    if (validPid === null && validTs === null && token === null) {
        return null;
    }
    return { pid: validPid, createdAtMs: validTs, token, hostId };
}

/**
 * Check whether an OS PID is currently alive.
 * `EPERM` means the process exists under another privilege/user boundary (alive).
 * `ESRCH` means no such process exists (dead).
 */
export function isPidAlive(pid: number): boolean {
    if (!Number.isSafeInteger(pid) || pid <= 0) { return false; }
    if (pid === process.pid) { return true; }
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        return code !== 'ESRCH';
    }
}

interface LockStalenessInspection {
    exists: boolean;
    stale: boolean;
    holderPid: number | null;
    expectedRaw: string | null;
    expectedIno: number | null;
}

async function inspectLockStaleness(
    lockPath: string,
    staleMs: number,
    checkPidAlive: (pid: number) => boolean,
    effectiveNowMs: number,
    localHostId: string,
    observedFirstSeen: Map<string, number>,
    observedNowMs: number,
): Promise<LockStalenessInspection> {
    let st: fs.Stats;
    try {
        st = await fs.promises.stat(lockPath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return { exists: false, stale: false, holderPid: null, expectedRaw: null, expectedIno: null };
        }
        return { exists: true, stale: false, holderPid: null, expectedRaw: null, expectedIno: null };
    }

    const ino = st.ino > 0 ? st.ino : null;
    const raw = await fs.promises.readFile(lockPath, 'utf8').catch(() => null);
    if (raw === null) {
        return { exists: true, stale: false, holderPid: null, expectedRaw: null, expectedIno: ino };
    }

    const resolvedEmptyKey = `${path.resolve(lockPath)}|${ino ?? 'noino'}`;
    const obsKey = `${ino ?? 'noino'}|${raw.trim()}`;
    let firstSeenAt = observedFirstSeen.get(obsKey);
    if (firstSeenAt === undefined) {
        firstSeenAt = observedNowMs;
        observedFirstSeen.set(obsKey, firstSeenAt);
    }

    if (!raw.trim()) {
        // Bounded monotonic grace window (persisted across retry calls, immune to wall-clock jumps):
        // preserves short open('wx')->write() windows while reclaiming crashed empty locks within default timeout.
        const persistedFirstSeen = recordEmptyLockFirstSeen(resolvedEmptyKey, observedNowMs);
        firstSeenAt = Math.min(firstSeenAt, persistedFirstSeen);
        const observedElapsedMs = Math.max(0, observedNowMs - firstSeenAt);
        const emptyGraceMs = Math.min(1_000, Math.max(250, Math.floor(staleMs / 5)));
        return {
            exists: true,
            stale: observedElapsedMs >= emptyGraceMs,
            holderPid: null,
            expectedRaw: raw,
            expectedIno: ino,
        };
    }

    observedEmptyLockFirstSeen.delete(resolvedEmptyKey);
    const observedElapsedMs = Math.max(0, observedNowMs - firstSeenAt);
    const wallAgeMs = Math.max(0, effectiveNowMs - st.mtimeMs);
    const effectiveAgeMs = Math.max(wallAgeMs, observedElapsedMs);

    const meta = parseLockFileContent(raw);
    if (!meta || meta.pid === null) {
        // Corrupt or non-PID lock file: reclaim once older than staleMs.
        return { exists: true, stale: effectiveAgeMs > staleMs, holderPid: null, expectedRaw: raw, expectedIno: ino };
    }

    // Explicit single-host safety check: DurableState targets local single-host storage.
    // If a lockfile records a different hostId (e.g. network mount / container namespace),
    // local PID liveness is meaningless, even after a prolonged suspension.
    const isForeignHost = Boolean(meta.hostId && meta.hostId !== localHostId);
    if (isForeignHost) {
        return {
            exists: true,
            stale: false,
            holderPid: meta.pid,
            expectedRaw: raw,
            expectedIno: ino,
        };
    }

    // Same host + dead owning process -> definitively stale and safe to reclaim immediately.
    if (meta.pid !== process.pid && !checkPidAlive(meta.pid)) {
        return { exists: true, stale: true, holderPid: meta.pid, expectedRaw: raw, expectedIno: ino };
    }

    // A live local owner can resume after arbitrary suspension or clock changes.
    return {
        exists: true,
        stale: false,
        holderPid: meta.pid,
        expectedRaw: raw,
        expectedIno: ino,
    };
}

/**
 * Race-hardened stale lock reclaim:
 * Serializes reclaimers via an exclusive `${lockPath}.reclaim` guard and re-verifies the target
 * lockfile's `(ino, content)` STILL matches the inspected stale lock before moving it aside,
 * preventing a delayed reclaimer from ever deleting a peer writer's brand-new replacement lock.
 */
async function publishExclusiveFile(
    targetPath: string,
    payload: string,
    token: string,
    mode: number | undefined,
): Promise<void> {
    if (process.platform !== 'win32') {
        const initPath = `${targetPath}.init.${process.pid}.${token}`;
        try {
            await fs.promises.writeFile(initPath, payload, { encoding: 'utf8', mode });
            await fs.promises.link(initPath, targetPath);
            return;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'EEXIST') { throw err; }
        } finally {
            await fs.promises.unlink(initPath).catch(() => {});
        }
    }
    const handle = await fs.promises.open(targetPath, 'wx', mode);
    try {
        await handle.writeFile(payload, 'utf8');
    } catch (writeErr) {
        await handle.close().catch(() => {});
        await fs.promises.unlink(targetPath).catch(() => {});
        throw writeErr;
    }
    await handle.close();
}

async function acquireReclaimGuard(
    reclaimGuardPath: string,
    staleMs: number,
    checkPidAlive: (pid: number) => boolean,
    effectiveNowMs: number,
    localHostId: string,
    observedFirstSeen: Map<string, number>,
    observedNowMs: number,
): Promise<{ token: string } | null> {
    const mode = process.platform === 'win32' ? undefined : 0o600;
    const guardToken = crypto.randomBytes(8).toString('hex');
    const payload = `${process.pid}:${effectiveNowMs}:${guardToken}:${localHostId}\n`;
    const tryCreateGuard = (): Promise<boolean> =>
        publishExclusiveFile(reclaimGuardPath, payload, guardToken, mode).then(() => true, () => false);

    if (await tryCreateGuard()) { return { token: guardToken }; }
    const guardInspect = await inspectLockStaleness(
        reclaimGuardPath, staleMs, checkPidAlive, effectiveNowMs, localHostId, observedFirstSeen, observedNowMs,
    );
    const isStaleEmptyGuard = guardInspect.stale && guardInspect.expectedRaw !== null && !guardInspect.expectedRaw.trim();
    if (!guardInspect.stale || (guardInspect.holderPid === null && !isStaleEmptyGuard)) { return null; }
    const recoverMeta = `${reclaimGuardPath}.recover`;
    const recoverToken = crypto.randomBytes(8).toString('hex');
    const recoverPayload = `${process.pid}:${effectiveNowMs}:${recoverToken}:${localHostId}\n`;
    try {
        await publishExclusiveFile(recoverMeta, recoverPayload, recoverToken, mode);
    } catch (metaErr) {
        if ((metaErr as NodeJS.ErrnoException).code === 'EEXIST') {
            const metaInspect = await inspectLockStaleness(
                recoverMeta, Math.min(staleMs, 5_000), checkPidAlive, effectiveNowMs, localHostId, observedFirstSeen, observedNowMs,
            );
            if (metaInspect.stale) {
                const dead = `${recoverMeta}.dead.${process.pid}.${guardToken}`;
                await fs.promises.rename(recoverMeta, dead).catch(() => {});
                await fs.promises.unlink(dead).catch(() => {});
                observedEmptyLockFirstSeen.delete(`${path.resolve(recoverMeta)}|${metaInspect.expectedIno ?? 'noino'}`);
            }
        }
        return null;
    }
    const deadTombstone = `${reclaimGuardPath}.dead.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    try {
        const curStat = await fs.promises.stat(reclaimGuardPath);
        const curRaw = await fs.promises.readFile(reclaimGuardPath, 'utf8');
        if (guardInspect.expectedIno !== null && curStat.ino > 0 && curStat.ino !== guardInspect.expectedIno) { return null; }
        if (guardInspect.expectedRaw !== null && curRaw.trim() !== guardInspect.expectedRaw.trim()) { return null; }
        await fs.promises.rename(reclaimGuardPath, deadTombstone);
        await fs.promises.unlink(deadTombstone).catch(() => {});
        observedEmptyLockFirstSeen.delete(`${path.resolve(reclaimGuardPath)}|${curStat.ino > 0 ? curStat.ino : 'noino'}`);
    } catch {
        return null;
    } finally {
        try {
            const curMeta = await fs.promises.readFile(recoverMeta, 'utf8');
            const parsedMeta = parseLockFileContent(curMeta);
            if (parsedMeta?.token === recoverToken && parsedMeta.pid === process.pid) {
                await fs.promises.unlink(recoverMeta).catch(() => {});
            }
        } catch { /* ignore */ }
    }
    return (await tryCreateGuard()) ? { token: guardToken } : null;
}

async function reclaimStaleLockFile(
    lockPath: string,
    expectedRaw: string | null,
    expectedIno: number | null,
    opts?: {
        staleMs: number;
        checkPidAlive: (pid: number) => boolean;
        effectiveNowMs: number;
        localHostId: string;
        observedFirstSeen: Map<string, number>;
        observedNowMs: number;
    },
): Promise<boolean> {
    const reclaimGuardPath = `${lockPath}.reclaim`;
    const guard = await acquireReclaimGuard(
        reclaimGuardPath,
        opts?.staleMs ?? LOCK_STALE_MS,
        opts?.checkPidAlive ?? isPidAlive,
        opts?.effectiveNowMs ?? Date.now(),
        opts?.localHostId ?? getLocalHostId(),
        opts?.observedFirstSeen ?? new Map<string, number>(),
        opts?.observedNowMs ?? monotonicNowMs(),
    );
    if (!guard) {
        return false;
    }
    try {
        // Re-verify lockPath inside the reclaim critical section so we NEVER unlink a fresh replacement lock!
        if (expectedRaw !== null) {
            let currentStat: fs.Stats;
            let currentRaw: string;
            try {
                currentStat = await fs.promises.stat(lockPath);
                currentRaw = await fs.promises.readFile(lockPath, 'utf8');
            } catch (readErr) {
                if ((readErr as NodeJS.ErrnoException).code === 'ENOENT') {
                    return false;
                }
                return false;
            }
            if (expectedIno !== null && currentStat.ino > 0 && currentStat.ino !== expectedIno) {
                return false;
            }
            if (currentRaw.trim() !== expectedRaw.trim()) {
                return false;
            }
        }

        const tombstone = `${lockPath}.stale.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
        try {
            await fs.promises.rename(lockPath, tombstone);
            await fs.promises.unlink(tombstone).catch(() => {});
            observedEmptyLockFirstSeen.delete(`${path.resolve(lockPath)}|${expectedIno ?? 'noino'}`);
            return true;
        } catch {
            return false;
        }
    } finally {
        try {
            const current = await fs.promises.readFile(reclaimGuardPath, 'utf8');
            const meta = parseLockFileContent(current);
            if (meta?.token === guard.token && meta.pid === process.pid) {
                await fs.promises.unlink(reclaimGuardPath).catch(() => {});
            }
        } catch { /* ignore */ }
    }
}

/**
 * Acquire an exclusive, fenced lockfile for single-host local DurableState persistence.
 * Returns a {@link FencedLockHandle} supporting pre-commit `verifyOwned()` fencing checks.
 */
export async function acquireFencedLockFile(
    lockPath: string,
    options: AcquireLockOptions = {},
): Promise<FencedLockHandle> {
    const timeoutMs = options.timeoutMs ?? LOCK_ACQUIRE_TIMEOUT_MS;
    const staleMs = options.staleMs ?? LOCK_STALE_MS;
    const checkPidAlive = options.isPidAlive ?? isPidAlive;
    const hasCustomClock = typeof options.now === 'function';
    const nowFn = options.now ?? (() => Date.now());
    const localHostId = (options.hostId || getLocalHostId()).replace(/[^A-Za-z0-9._-]/g, '_') || 'local';

    const startWallMs = nowFn();
    const startMonoMs = monotonicNowMs();
    const getEffectiveNowMs = (): number => {
        if (hasCustomClock) {
            return nowFn();
        }
        const elapsedMono = Math.max(0, monotonicNowMs() - startMonoMs);
        const rawWall = nowFn();
        const wallDrift = (rawWall - startWallMs) - elapsedMono;
        // Guard against sudden forward/backward wall-clock jumps during lock wait
        return Math.abs(wallDrift) > 2_000 ? startWallMs + elapsedMono : rawWall;
    };
    const getObservedClockMs = monotonicNowMs;

    const deadlineMono = getObservedClockMs() + Math.max(0, timeoutMs);
    const observedFirstSeen = new Map<string, number>();

    await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
    const mode = process.platform === 'win32' ? undefined : 0o600;
    const ownerToken = crypto.randomBytes(8).toString('hex');
    let attempt = 0;

    const createOwnedLock = async (): Promise<FencedLockHandle> => {
        await publishExclusiveFile(lockPath, `${process.pid}:${nowFn()}:${ownerToken}:${localHostId}\n`, ownerToken, mode);
        let released = false;
        const verifyOwned = async (): Promise<boolean> => {
            if (released) { return false; }
            try {
                const current = await fs.promises.readFile(lockPath, 'utf8');
                const meta = parseLockFileContent(current);
                return Boolean(meta && meta.token === ownerToken && meta.pid === process.pid);
            } catch {
                return false;
            }
        };
        const release = async (): Promise<void> => {
            if (released) { return; }
            released = true;
            try {
                // Verify we still own this lockfile before unlinking so we never remove another writer's lock.
                const current = await fs.promises.readFile(lockPath, 'utf8');
                const meta = parseLockFileContent(current);
                if (meta?.token !== ownerToken || meta.pid !== process.pid) { return; }
            } catch {
                return;
            }
            await fs.promises.unlink(lockPath).catch(() => {});
        };
        return { ownerToken, lockPath, verifyOwned, release };
    };

    while (true) {
        try {
            return await createOwnedLock();
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code;
            const isContention = code === 'EEXIST'
                || (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'));
            if (!isContention) {
                throw err;
            }

            const inspection = await inspectLockStaleness(
                lockPath,
                staleMs,
                checkPidAlive,
                getEffectiveNowMs(),
                localHostId,
                observedFirstSeen,
                getObservedClockMs(),
            );
            if (inspection.stale && await reclaimStaleLockFile(lockPath, inspection.expectedRaw, inspection.expectedIno, {
                staleMs,
                checkPidAlive,
                effectiveNowMs: getEffectiveNowMs(),
                localHostId,
                observedFirstSeen,
                observedNowMs: getObservedClockMs(),
            })) {
                continue;
            }

            if (getObservedClockMs() >= deadlineMono) {
                // Active writer still holds a non-stale lock — NEVER delete it or proceed unlocked.
                throw new DurableStateLockTimeoutError(lockPath, inspection.holderPid);
            }

            attempt++;
            const jitter = Math.floor(Math.random() * 8);
            const remaining = Math.max(1, deadlineMono - getObservedClockMs());
            await sleep(Math.min(5 + attempt * 5 + jitter, 50, remaining));
        }
    }
}

export async function acquireLockFile(
    lockPath: string,
    options: AcquireLockOptions = {},
): Promise<() => Promise<void>> {
    const handle = await acquireFencedLockFile(lockPath, options);
    return handle.release;
}

export class DurableState {
    private static readonly SAVE_DEBOUNCE_MS = 250;
    private static readonly DEFAULT_RETRY_DELAY_MS = 250;
    private static readonly MAX_RETRY_DELAY_MS = 30_000;
    private static readonly DEFAULT_MAX_RETRY_ATTEMPTS = 8;
    private readonly _filePath: string;
    private readonly _lockOptions?: AcquireLockOptions;
    private readonly _debounceMs: number;
    private readonly _retryDelayMs: number;
    private readonly _maxRetryAttempts: number;
    private _data: DurableStateFile;
    private _baseData: DurableStateFile;
    private _lastSerialized: string;
    private _lastKnownMtimeMs: number | null = null;
    private _lastKnownSize: number | null = null;
    private _lastKnownIno: number | null = null;
    private _dirtyGlobalKeys = new Map<string, number>();
    /** Per-field version tracking for atomic field-level `appSettings` patching. */
    private _dirtyAppSettingsFields = new Map<string, number>();
    private _dirtyWorkspaceKeys = new Map<string, Map<string, number>>();
    private _seededGlobalKeys = new Map<string, number>();
    private _seededWorkspaceKeys = new Map<string, Map<string, number>>();
    /**
     * Tracks mergeable object-map keys that were updated on disk by another process
     * during an earlier flush/reload, before local callers re-read them via `get()`.
     * Prevents a subsequent write from a stale in-memory store (e.g. PricingStore /
     * DailyLedger) from silently clobbering entries added by the peer process.
     */
    private _unseenExternalGlobal = new Map<string, { base: unknown; disk: unknown }>();
    private _hasUnnotifiedExternalChanges = false;
    private _saveTimer: ReturnType<typeof setTimeout> | undefined;
    private _retryTimer: ReturnType<typeof setTimeout> | undefined;
    private _consecutiveFailures = 0;
    private _lastError: string | undefined;
    private _lastErrorCode: string | undefined;
    private _pendingVersion = 0;
    private _writtenVersion = 0;
    private _flushInFlight: Promise<DurableStateCommitReceipt> | null = null;
    private _waiters = new Map<number, Array<(receipt: DurableStateCommitReceipt) => void>>();

    constructor(filePath: string = getDefaultStateFilePath(), options?: DurableStateOptions) {
        this._filePath = filePath;
        this._lockOptions = options?.lockOptions;
        this._debounceMs = typeof options?.debounceMs === 'number' && Number.isFinite(options.debounceMs) && options.debounceMs >= 0
            ? Math.floor(options.debounceMs)
            : DurableState.SAVE_DEBOUNCE_MS;
        this._retryDelayMs = typeof options?.retryDelayMs === 'number' && Number.isFinite(options.retryDelayMs) && options.retryDelayMs >= 0
            ? Math.floor(options.retryDelayMs)
            : DurableState.DEFAULT_RETRY_DELAY_MS;
        this._maxRetryAttempts = typeof options?.maxRetryAttempts === 'number' && Number.isFinite(options.maxRetryAttempts) && options.maxRetryAttempts >= 0
            ? Math.floor(options.maxRetryAttempts)
            : DurableState.DEFAULT_MAX_RETRY_ATTEMPTS;
        this._data = this._load();
        this._baseData = deepClone(this._data);
        this._lastSerialized = this._serialize(this._data);
    }

    globalBucket(fallback?: StateBucket): StateBucket {
        return this._createBucket('global', undefined, fallback);
    }

    workspaceBucket(workspaceKey: string, fallback?: StateBucket): StateBucket {
        return this._createBucket('workspace', workspaceKey, fallback);
    }

    /** Read normalized v1.18.0 `global.appSettings` with safe backward-compatible defaults. */
    getAppSettings(): AppSettings {
        return normalizeAppSettings(this.globalBucket().get<unknown>('appSettings', null));
    }

    /**
     * Resolve legacy top-level `global.lockToMainAgent` migration state once.
     * Once `appSettings.legacyLockMigrated === true`, the legacy top-level key is
     * permanently ignored so stale legacy values can never override `appSettings`.
     */
    resolveMigratedLegacyLock(): { lockToMainAgent: boolean; needsMigrationPersist: boolean } {
        const rawSettings = this._data.global.appSettings;
        const normalized = normalizeAppSettings(rawSettings);
        if (normalized.legacyLockMigrated) {
            return { lockToMainAgent: normalized.lockToMainAgent, needsMigrationPersist: false };
        }
        const hasExplicitSettingLock = isPlainObject(rawSettings) && typeof rawSettings.lockToMainAgent === 'boolean';
        const legacyTopLevel = this._data.global.lockToMainAgent;
        const hasLegacyTopLevel = typeof legacyTopLevel === 'boolean';
        if (hasExplicitSettingLock) {
            return { lockToMainAgent: normalized.lockToMainAgent, needsMigrationPersist: hasLegacyTopLevel };
        }
        if (hasLegacyTopLevel) {
            return { lockToMainAgent: legacyTopLevel, needsMigrationPersist: true };
        }
        return { lockToMainAgent: normalized.lockToMainAgent, needsMigrationPersist: false };
    }

    /**
     * Perform single-time migration from legacy top-level `global.lockToMainAgent`
     * into `appSettings.{lockToMainAgent, legacyLockMigrated: true}` using atomic
     * field-level patching.
     */
    async migrateLegacyLockOnce(): Promise<{
        settings: AppSettings;
        migrated: boolean;
        receipt: DurableStateCommitReceipt;
    }> {
        this.reloadIfChanged();
        const { lockToMainAgent, needsMigrationPersist } = this.resolveMigratedLegacyLock();
        if (!needsMigrationPersist) {
            return {
                settings: this.getAppSettings(),
                migrated: false,
                receipt: this.getCommitStatus(),
            };
        }
        const { settings, receipt } = await this.patchAppSettingsWithReceipt({
            lockToMainAgent,
            legacyLockMigrated: true,
        });
        return { settings, migrated: true, receipt };
    }

    /**
     * Prepare a field-level patch against current `appSettings` without clobbering
     * untouched fields written concurrently by another host (App <-> IDE).
     */
    private _prepareAppSettingsFieldPatch(
        patch: Partial<AppSettings>,
    ): { fieldUpdates: Record<string, unknown>; mergedNormalized: AppSettings; touchedKeys: string[] } {
        const rawUnseen = this._unseenExternalGlobal.get('appSettings');
        if (rawUnseen) {
            this._unseenExternalGlobal.delete('appSettings');
            if (isPlainObject(rawUnseen.disk)) {
                const currentRaw = isPlainObject(this._data.global.appSettings)
                    ? deepClone(this._data.global.appSettings)
                    : {};
                for (const [k, v] of Object.entries(rawUnseen.disk)) {
                    if (!this._dirtyAppSettingsFields.has(k)) {
                        currentRaw[k] = deepClone(v);
                    }
                }
                this._data.global.appSettings = currentRaw;
            }
        }

        const current = normalizeAppSettings(this._data.global.appSettings);
        const touchedSet = new Set<string>();
        const effectivePatch: Record<string, unknown> = {};

        for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
            if (v !== undefined) {
                effectivePatch[k] = v;
                touchedSet.add(k);
            }
        }

        // Coupled currency <-> customFxCurrency invariants
        const hasDisplayCurrencyPatch = touchedSet.has('displayCurrency');
        const hasCustomFxRatePatch = touchedSet.has('customFxRate');
        const hasCustomFxCurrencyPatch = touchedSet.has('customFxCurrency');

        if (hasDisplayCurrencyPatch) {
            const nextCurrency = normalizeCurrencyCode(effectivePatch.displayCurrency, current.displayCurrency);
            effectivePatch.displayCurrency = nextCurrency;
            if (!hasCustomFxRatePatch && !hasCustomFxCurrencyPatch) {
                const switched = switchDisplayCurrency(current, nextCurrency);
                if (switched.customFxRate !== current.customFxRate || switched.customFxCurrency !== current.customFxCurrency) {
                    effectivePatch.customFxRate = switched.customFxRate;
                    effectivePatch.customFxCurrency = switched.customFxCurrency;
                    touchedSet.add('customFxRate');
                    touchedSet.add('customFxCurrency');
                }
            } else if (hasCustomFxRatePatch && !hasCustomFxCurrencyPatch) {
                const bound = bindCustomFxRate(
                    nextCurrency,
                    effectivePatch.customFxRate as number | null | undefined,
                );
                effectivePatch.customFxRate = bound.customFxRate;
                effectivePatch.customFxCurrency = bound.customFxCurrency;
                touchedSet.add('customFxCurrency');
            }
        } else if (hasCustomFxRatePatch && !hasCustomFxCurrencyPatch) {
            const bound = bindCustomFxRate(
                current.displayCurrency,
                effectivePatch.customFxRate as number | null | undefined,
            );
            effectivePatch.customFxRate = bound.customFxRate;
            effectivePatch.customFxCurrency = bound.customFxCurrency;
            touchedSet.add('customFxCurrency');
        }

        // Keep aliased activity limits synchronized when either alias is patched
        if (touchedSet.has('activityMaxRecentSteps') && !touchedSet.has('maxRecentSteps')) {
            effectivePatch.maxRecentSteps = effectivePatch.activityMaxRecentSteps;
            touchedSet.add('maxRecentSteps');
        } else if (touchedSet.has('maxRecentSteps') && !touchedSet.has('activityMaxRecentSteps')) {
            effectivePatch.activityMaxRecentSteps = effectivePatch.maxRecentSteps;
            touchedSet.add('activityMaxRecentSteps');
        }
        if (touchedSet.has('activityMaxArchives') && !touchedSet.has('maxArchives')) {
            effectivePatch.maxArchives = effectivePatch.activityMaxArchives;
            touchedSet.add('maxArchives');
        } else if (touchedSet.has('maxArchives') && !touchedSet.has('activityMaxArchives')) {
            effectivePatch.activityMaxArchives = effectivePatch.maxArchives;
            touchedSet.add('activityMaxArchives');
        }

        // Clearing subscription plan to 'none' also clears monthly fee unless explicitly supplied;
        // conversely, setting a positive monthly fee while plan is 'none' infers the matching plan/custom.
        if (touchedSet.has('subscriptionPlan') && effectivePatch.subscriptionPlan === 'none' && !touchedSet.has('subscriptionMonthlyFee')) {
            effectivePatch.subscriptionMonthlyFee = null;
            touchedSet.add('subscriptionMonthlyFee');
        } else if (
            touchedSet.has('subscriptionMonthlyFee')
            && !touchedSet.has('subscriptionPlan')
            && typeof effectivePatch.subscriptionMonthlyFee === 'number'
            && Number.isFinite(effectivePatch.subscriptionMonthlyFee)
            && effectivePatch.subscriptionMonthlyFee > 0
            && current.subscriptionPlan === 'none'
        ) {
            const legacyPlan = typeof this._data.global.subscriptionPlan === 'string'
                ? this._data.global.subscriptionPlan
                : undefined;
            effectivePatch.subscriptionPlan = normalizeSubscriptionPlanId(legacyPlan, effectivePatch.subscriptionMonthlyFee);
            touchedSet.add('subscriptionPlan');
        }

        const mergedNormalized = normalizeAppSettings({ ...current, ...effectivePatch });
        const normalizedRec = mergedNormalized as unknown as Record<string, unknown>;
        const fieldUpdates: Record<string, unknown> = {};
        for (const key of touchedSet) {
            if (hasOwn(normalizedRec, key)) {
                fieldUpdates[key] = deepClone(normalizedRec[key]);
            }
        }

        return {
            fieldUpdates,
            mergedNormalized,
            touchedKeys: [...touchedSet].filter((k) => hasOwn(fieldUpdates, k)),
        };
    }

    /**
     * Atomically merge ONLY the patched fields into `global.appSettings` against the
     * latest disk and in-memory state so concurrent App currency edits and IDE basis
     * edits never overwrite each other.
     */
    async patchAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
        const { settings } = await this.patchAppSettingsWithReceipt(patch);
        return settings;
    }

    /**
     * Atomically merge ONLY the patched fields into `global.appSettings`, returning
     * both the merged normalized `AppSettings` and the real disk commit receipt.
     */
    async patchAppSettingsWithReceipt(
        patch: Partial<AppSettings>,
    ): Promise<{ settings: AppSettings; receipt: DurableStateCommitReceipt }> {
        this.reloadIfChanged();
        const { fieldUpdates, touchedKeys } = this._prepareAppSettingsFieldPatch(patch);
        if (touchedKeys.length === 0) {
            return { settings: this.getAppSettings(), receipt: this.getCommitStatus() };
        }

        const nextVersion = this._pendingVersion + 1;
        const baseRaw = isPlainObject(this._data.global.appSettings)
            ? deepClone(this._data.global.appSettings)
            : {};
        for (const key of touchedKeys) {
            baseRaw[key] = deepClone(fieldUpdates[key]);
            this._dirtyAppSettingsFields.set(key, nextVersion);
        }
        this._data.global.appSettings = baseRaw;
        this._dirtyGlobalKeys.set('appSettings', nextVersion);
        this._seededGlobalKeys.delete('appSettings');

        const receipt = await this._scheduleSave();
        return { settings: this.getAppSettings(), receipt };
    }

    /** Merge and persist a partial update into `global.appSettings` (field-level atomic across App & IDE). */
    async updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
        return this.patchAppSettings(patch);
    }

    /** Merge and persist `global.appSettings`, returning both normalized settings and the real disk commit receipt. */
    async updateAppSettingsWithReceipt(
        patch: Partial<AppSettings>,
    ): Promise<{ settings: AppSettings; receipt: DurableStateCommitReceipt }> {
        return this.patchAppSettingsWithReceipt(patch);
    }

    /** Stage and await a global key write, returning a real commit receipt (never falsely reporting committed on write failure). */
    updateGlobalWithReceipt(key: string, value: unknown): Promise<DurableStateCommitReceipt> {
        return this._set('global', key, value, undefined, true);
    }

    /** Stage and await a workspace key write, returning a real commit receipt. */
    updateWorkspaceWithReceipt(workspaceKey: string, key: string, value: unknown): Promise<DurableStateCommitReceipt> {
        return this._set('workspace', key, value, workspaceKey, true);
    }

    /** Inspect current commit state without triggering I/O. */
    getCommitStatus(): DurableStateCommitReceipt {
        const pending = this._pendingVersion > this._writtenVersion;
        if (!pending) {
            return {
                committed: true,
                revision: this._writtenVersion,
                pendingRevision: this._pendingVersion,
                status: 'committed',
                retryScheduled: false,
            };
        }
        const retryScheduled = Boolean(this._retryTimer || this._saveTimer || this._flushInFlight);
        return {
            committed: false,
            revision: this._writtenVersion,
            pendingRevision: this._pendingVersion,
            status: retryScheduled ? 'pending' : 'failed',
            ...(this._lastError ? { error: this._lastError } : {}),
            ...(this._lastErrorCode ? { errorCode: this._lastErrorCode } : {}),
            retryScheduled: Boolean(this._retryTimer || (this._saveTimer && this._consecutiveFailures > 0)),
        };
    }

    /**
     * Wait until `targetRevision` (defaults to current staged `_pendingVersion`) is durably committed
     * to disk, or until retries are exhausted / `dispose()` is called.
     * NEVER resolves as committed when disk persistence failed.
     */
    waitForCommit(targetRevision = this._pendingVersion): Promise<DurableStateCommitReceipt> {
        const target = Math.max(0, Math.floor(targetRevision));
        if (this._writtenVersion >= target) {
            return Promise.resolve({
                committed: true,
                revision: this._writtenVersion,
                pendingRevision: this._pendingVersion,
                status: 'committed',
                retryScheduled: false,
            });
        }
        if (!this._flushInFlight && !this._saveTimer && !this._retryTimer && this._consecutiveFailures > this._maxRetryAttempts) {
            return Promise.resolve({
                committed: false,
                revision: this._writtenVersion,
                pendingRevision: this._pendingVersion,
                status: 'failed',
                ...(this._lastError ? { error: this._lastError } : {}),
                ...(this._lastErrorCode ? { errorCode: this._lastErrorCode } : {}),
                retryScheduled: false,
            });
        }
        return new Promise<DurableStateCommitReceipt>(resolve => {
            const waiters = this._waiters.get(target) || [];
            waiters.push(resolve);
            this._waiters.set(target, waiters);
        });
    }

    getFilePath(): string {
        return this._filePath;
    }

    exists(): boolean {
        return fs.existsSync(this._filePath);
    }

    /** Returns true when dirty writes have not yet been successfully committed to disk. */
    hasPendingWrites(): boolean {
        return this._pendingVersion > this._writtenVersion;
    }

    /** Cancel any scheduled debounce/retry timers and fail any uncommitted waiters cleanly on shutdown. */
    dispose(): void {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = undefined;
        }
        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = undefined;
        }
        if (this._waiters.size > 0) {
            this._resolveWaitersUpTo(this._pendingVersion, {
                committed: false,
                revision: this._writtenVersion,
                pendingRevision: this._pendingVersion,
                status: 'failed',
                error: this._lastError || 'DurableState disposed before commit',
                errorCode: this._lastErrorCode || 'EDISPOSED',
                retryScheduled: false,
            });
        }
    }

    /**
     * Immediately attempt to flush any pending writes to disk and return the real commit receipt.
     * On failure (lock timeout, fencing violation, I/O error), dirty state is retained,
     * retry backoff is scheduled, and `{ committed: false, status: 'pending' | 'failed', error, ... }`
     * is returned — callers MUST NOT show "Saved" unless `receipt.committed === true`.
     */
    async flush(): Promise<DurableStateCommitReceipt> {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = undefined;
        }
        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = undefined;
        }
        let lastReceipt: DurableStateCommitReceipt = {
            committed: this._pendingVersion <= this._writtenVersion,
            revision: this._writtenVersion,
            pendingRevision: this._pendingVersion,
            status: this._pendingVersion <= this._writtenVersion ? 'committed' : 'pending',
            ...(this._lastError ? { error: this._lastError } : {}),
            ...(this._lastErrorCode ? { errorCode: this._lastErrorCode } : {}),
            retryScheduled: false,
        };
        while (this._flushInFlight || this._pendingVersion > this._writtenVersion) {
            if (this._flushInFlight) {
                lastReceipt = await this._flushInFlight;
                if (!lastReceipt.committed) {
                    break;
                }
            } else {
                lastReceipt = await this._flush();
                if (!lastReceipt.committed) {
                    break;
                }
            }
        }
        return lastReceipt;
    }

    /**
     * Re-read the on-disk file if it changed externally and merge non-dirty keys
     * into memory without discarding unsaved local updates.
     * Returns true when external changes were loaded.
     */
    reloadIfChanged(): boolean {
        const hadBufferedExternal = this._hasUnnotifiedExternalChanges;
        this._hasUnnotifiedExternalChanges = false;
        try {
            const stat = fs.statSync(this._filePath);
            const inoDiffers = stat.ino > 0 && this._lastKnownIno !== null && stat.ino !== this._lastKnownIno;
            const changedByStat = this._lastKnownMtimeMs === null
                || stat.mtimeMs !== this._lastKnownMtimeMs
                || stat.size !== this._lastKnownSize
                || inoDiffers;
            if (!changedByStat) {
                return hadBufferedExternal;
            }
            const raw = fs.readFileSync(this._filePath, 'utf8');
            const clean = stripUtf8Bom(raw);
            if (clean === this._lastSerialized) {
                this._lastKnownMtimeMs = stat.mtimeMs;
                this._lastKnownSize = stat.size;
                this._lastKnownIno = stat.ino > 0 ? stat.ino : null;
                return hadBufferedExternal;
            }
            const diskData = parseStateFile(clean);
            if (!diskData) {
                return hadBufferedExternal;
            }
            const merged = this._mergeWithDisk(
                diskData,
                this._data,
                this._pendingVersion,
            );
            this._data = merged;
            this._baseData = deepClone(diskData);
            this._lastSerialized = this._serialize(diskData);
            this._lastKnownMtimeMs = stat.mtimeMs;
            this._lastKnownSize = stat.size;
            this._lastKnownIno = stat.ino > 0 ? stat.ino : null;
            return true;
        } catch {
            return hadBufferedExternal;
        }
    }

    private _createBucket(kind: 'global' | 'workspace', workspaceKey?: string, fallback?: StateBucket): StateBucket {
        return {
            get: <T>(key: string, defaultValue: T): T => {
                if (kind === 'global') {
                    this._unseenExternalGlobal.delete(key);
                }
                const source = kind === 'global'
                    ? this._data.global
                    : (this._data.workspaces[workspaceKey || '__default__'] || {});
                if (hasOwn(source, key)) {
                    return source[key] as T;
                }
                if (!fallback) {
                    return defaultValue;
                }
                const fallbackValue = fallback.get<T>(key, defaultValue);
                if (!deepEqual(fallbackValue, defaultValue)) {
                    this._set(kind, key, fallbackValue, workspaceKey, false);
                }
                return fallbackValue;
            },
            update: async (key: string, value: unknown): Promise<void> => {
                if (fallback) {
                    await fallback.update(key, value);
                }
                const receipt = await this._set(kind, key, value, workspaceKey, true);
                return receipt as unknown as void;
            },
        };
    }

    private _set(
        kind: 'global' | 'workspace',
        key: string,
        value: unknown,
        workspaceKey?: string,
        isExplicitWrite = true,
    ): Promise<DurableStateCommitReceipt> {
        const nextVersion = this._pendingVersion + 1;
        if (kind === 'global') {
            let effectiveValue = value;
            if (isExplicitWrite) {
                const unseen = this._unseenExternalGlobal.get(key);
                if (unseen) {
                    this._unseenExternalGlobal.delete(key);
                    effectiveValue = mergeConcurrentValue(key, unseen.base, unseen.disk, value);
                    if (!deepEqual(effectiveValue, value)) {
                        this._hasUnnotifiedExternalChanges = true;
                    }
                }
            }
            this._data.global[key] = effectiveValue;
            if (isExplicitWrite) {
                this._dirtyGlobalKeys.set(key, nextVersion);
                this._seededGlobalKeys.delete(key);
            } else if (!this._dirtyGlobalKeys.has(key)) {
                this._seededGlobalKeys.set(key, nextVersion);
            }
        } else {
            const bucketKey = workspaceKey || '__default__';
            if (!this._data.workspaces[bucketKey]) {
                this._data.workspaces[bucketKey] = {};
            }
            this._data.workspaces[bucketKey][key] = value;
            if (isExplicitWrite) {
                let wsDirty = this._dirtyWorkspaceKeys.get(bucketKey);
                if (!wsDirty) {
                    wsDirty = new Map();
                    this._dirtyWorkspaceKeys.set(bucketKey, wsDirty);
                }
                wsDirty.set(key, nextVersion);
                this._seededWorkspaceKeys.get(bucketKey)?.delete(key);
            } else if (!this._dirtyWorkspaceKeys.get(bucketKey)?.has(key)) {
                let wsSeeded = this._seededWorkspaceKeys.get(bucketKey);
                if (!wsSeeded) {
                    wsSeeded = new Map();
                    this._seededWorkspaceKeys.set(bucketKey, wsSeeded);
                }
                wsSeeded.set(key, nextVersion);
            }
        }
        return this._scheduleSave();
    }

    private _load(): DurableStateFile {
        try {
            if (!fs.existsSync(this._filePath)) {
                this._lastKnownMtimeMs = null;
                this._lastKnownSize = null;
                this._lastKnownIno = null;
                return { version: 1, global: {}, workspaces: {} };
            }
            const stat = fs.statSync(this._filePath);
            const raw = fs.readFileSync(this._filePath, 'utf8');
            const parsed = parseStateFile(raw);
            if (!parsed) {
                // Force the next write to inspect & validate the current bytes,
                // even if this corrupt file's mtime never changes.
                this._lastKnownMtimeMs = null;
                return { version: 1, global: {}, workspaces: {} };
            }
            this._lastKnownMtimeMs = stat.mtimeMs;
            this._lastKnownSize = stat.size;
            this._lastKnownIno = stat.ino > 0 ? stat.ino : null;
            return parsed;
        } catch {
            this._lastKnownMtimeMs = null;
            this._lastKnownSize = null;
            this._lastKnownIno = null;
            return { version: 1, global: {}, workspaces: {} };
        }
    }

    private _serialize(data: DurableStateFile): string {
        return JSON.stringify(data);
    }

    private _scheduleSave(): Promise<DurableStateCommitReceipt> {
        if (!this._retryTimer && this._consecutiveFailures > this._maxRetryAttempts) {
            this._consecutiveFailures = 0;
        }
        this._pendingVersion++;
        const version = this._pendingVersion;
        const pending = new Promise<DurableStateCommitReceipt>(resolve => {
            const waiters = this._waiters.get(version) || [];
            waiters.push(resolve);
            this._waiters.set(version, waiters);
        });

        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = undefined;
        }
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
        }
        this._saveTimer = setTimeout(() => {
            this._saveTimer = undefined;
            void this._flush();
        }, this._debounceMs);

        return pending;
    }

    private _scheduleRetry(): boolean {
        if (this._pendingVersion <= this._writtenVersion) { return false; }
        if (this._retryTimer) { return true; }
        if (this._maxRetryAttempts <= 0 || this._consecutiveFailures > this._maxRetryAttempts) {
            return false;
        }
        // If a newer write already armed _saveTimer while this flush was in flight,
        // keep waiters pending because that scheduled flush will retry committing all dirty writes.
        if (this._saveTimer) { return true; }
        const exponent = Math.min(Math.max(0, this._consecutiveFailures - 1), 10);
        const delayMs = Math.min(
            DurableState.MAX_RETRY_DELAY_MS,
            Math.max(0, this._retryDelayMs * Math.pow(2, exponent)),
        );
        this._retryTimer = setTimeout(() => {
            this._retryTimer = undefined;
            void this._flush();
        }, delayMs);
        if (typeof this._retryTimer.unref === 'function') {
            this._retryTimer.unref();
        }
        return true;
    }

    private _resolveWaitersUpTo(version: number, receipt: DurableStateCommitReceipt): void {
        for (const waiterVersion of [...this._waiters.keys()]) {
            if (waiterVersion > version) { continue; }
            const waiters = this._waiters.get(waiterVersion) || [];
            this._waiters.delete(waiterVersion);
            for (const resolve of waiters) {
                resolve(receipt);
            }
        }
    }

    private _mergeWithDisk(
        diskData: DurableStateFile,
        localSnapshot: DurableStateFile,
        targetVersion: number,
        dirtyAppFieldsSnapshot?: Map<string, number>,
        baseDataSnapshot?: DurableStateFile,
    ): DurableStateFile {
        const baseData = baseDataSnapshot ?? this._baseData;
        const merged: DurableStateFile = deepClone(diskData);

        // Apply passive seeds only if disk does not already define that key.
        for (const [k, ver] of this._seededGlobalKeys.entries()) {
            if (ver <= targetVersion && !hasOwn(merged.global, k) && hasOwn(localSnapshot.global, k)) {
                merged.global[k] = deepClone(localSnapshot.global[k]);
            }
        }

        // Apply explicit local global writes, deep-merging object maps by key.
        const appFieldsToCheck = dirtyAppFieldsSnapshot ?? this._dirtyAppSettingsFields;
        const handledAppSettingsViaFields = appFieldsToCheck.size > 0
            && isPlainObject(localSnapshot.global.appSettings)
            && [...appFieldsToCheck.values()].some(fieldVer => fieldVer <= targetVersion);
        if (handledAppSettingsViaFields) {
            const diskSettings: Record<string, unknown> = isPlainObject(merged.global.appSettings)
                ? deepClone(merged.global.appSettings)
                : {};
            const localSettings = localSnapshot.global.appSettings as Record<string, unknown>;
            let currencyPatched = false;
            let fxPatched = false;
            for (const [fieldKey, fieldVer] of appFieldsToCheck.entries()) {
                if (fieldVer <= targetVersion && hasOwn(localSettings, fieldKey)) {
                    diskSettings[fieldKey] = deepClone(localSettings[fieldKey]);
                    if (fieldKey === 'displayCurrency') { currencyPatched = true; }
                    if (fieldKey === 'customFxRate' || fieldKey === 'customFxCurrency') { fxPatched = true; }
                }
            }
            // If local switched displayCurrency without explicitly setting FX rate, clear stale disk FX bound to another currency
            if (currencyPatched && !fxPatched) {
                const reconciledFx = switchDisplayCurrency(diskSettings, diskSettings.displayCurrency);
                diskSettings.displayCurrency = reconciledFx.displayCurrency;
                diskSettings.customFxRate = reconciledFx.customFxRate;
                diskSettings.customFxCurrency = reconciledFx.customFxCurrency;
            }
            merged.global.appSettings = diskSettings;
        }
        for (const [k, ver] of this._dirtyGlobalKeys.entries()) {
            if (k === 'appSettings' && handledAppSettingsViaFields) { continue; }
            if (ver > targetVersion || !hasOwn(localSnapshot.global, k)) { continue; }
            if (hasOwn(merged.global, k)) {
                merged.global[k] = mergeConcurrentValue(
                    k,
                    baseData.global[k],
                    merged.global[k],
                    localSnapshot.global[k],
                );
            } else {
                merged.global[k] = deepClone(localSnapshot.global[k]);
            }
        }

        // Apply passive workspace seeds only if disk does not already define them.
        for (const [wsKey, seededMap] of this._seededWorkspaceKeys.entries()) {
            const localWs = localSnapshot.workspaces[wsKey];
            if (!localWs) { continue; }
            for (const [k, ver] of seededMap.entries()) {
                if (ver > targetVersion || !hasOwn(localWs, k)) { continue; }
                if (!merged.workspaces[wsKey]) { merged.workspaces[wsKey] = {}; }
                if (!hasOwn(merged.workspaces[wsKey], k)) {
                    merged.workspaces[wsKey][k] = deepClone(localWs[k]);
                }
            }
        }

        // Apply explicit local workspace writes.
        for (const [wsKey, dirtyMap] of this._dirtyWorkspaceKeys.entries()) {
            const localWs = localSnapshot.workspaces[wsKey];
            if (!localWs) { continue; }
            if (!merged.workspaces[wsKey]) { merged.workspaces[wsKey] = {}; }
            const baseWs = baseData.workspaces[wsKey] || {};
            for (const [k, ver] of dirtyMap.entries()) {
                if (ver > targetVersion || !hasOwn(localWs, k)) { continue; }
                if (hasOwn(merged.workspaces[wsKey], k)) {
                    merged.workspaces[wsKey][k] = mergeConcurrentValue(
                        k,
                        baseWs[k],
                        merged.workspaces[wsKey][k],
                        localWs[k],
                    );
                } else {
                    merged.workspaces[wsKey][k] = deepClone(localWs[k]);
                }
            }
        }

        return merged;
    }

    private _reconcileInMemoryAfterMerge(
        merged: DurableStateFile,
        targetVersion: number,
        prevBaseGlobal: Record<string, unknown>,
    ): void {
        // Pull in merged/external disk keys for anything not mutated again after targetVersion.
        for (const [k, v] of Object.entries(merged.global)) {
            const dirtyVer = this._dirtyGlobalKeys.get(k);
            if (k === 'appSettings' && dirtyVer !== undefined && dirtyVer > targetVersion && isPlainObject(v) && isPlainObject(this._data.global[k])) {
                // Preserve fields patched AFTER targetVersion while adopting disk updates to untouched fields
                const reconciled: Record<string, unknown> = deepClone(v);
                const currentLocal = this._data.global[k] as Record<string, unknown>;
                for (const [fieldKey, fieldVer] of this._dirtyAppSettingsFields.entries()) {
                    if (fieldVer > targetVersion && hasOwn(currentLocal, fieldKey)) {
                        reconciled[fieldKey] = deepClone(currentLocal[fieldKey]);
                    }
                }
                if (!deepEqual(this._data.global[k], reconciled)) {
                    this._hasUnnotifiedExternalChanges = true;
                }
                this._data.global[k] = reconciled;
                continue;
            }
            if (dirtyVer === undefined || dirtyVer <= targetVersion) {
                // If an external writer updated a mergeable key that local hasn't touched yet,
                // record the pre-external base so a later write from a stale in-memory store merges safely.
                if (dirtyVer === undefined && DEEP_MERGE_OBJECT_KEYS.has(k) && !deepEqual(prevBaseGlobal[k], v)) {
                    const existing = this._unseenExternalGlobal.get(k);
                    this._unseenExternalGlobal.set(k, {
                        base: existing ? existing.base : deepClone(prevBaseGlobal[k]),
                        disk: deepClone(v),
                    });
                }
                if (!hasOwn(this._data.global, k) || !deepEqual(this._data.global[k], v)) {
                    this._hasUnnotifiedExternalChanges = true;
                }
                this._data.global[k] = deepClone(v);
            }
        }
        for (const [wsKey, wsObj] of Object.entries(merged.workspaces)) {
            if (!this._data.workspaces[wsKey]) {
                this._data.workspaces[wsKey] = {};
            }
            const dirtyWs = this._dirtyWorkspaceKeys.get(wsKey);
            for (const [k, v] of Object.entries(wsObj)) {
                const dirtyVer = dirtyWs?.get(k);
                if (dirtyVer === undefined || dirtyVer <= targetVersion) {
                    if (!hasOwn(this._data.workspaces[wsKey], k) || !deepEqual(this._data.workspaces[wsKey][k], v)) {
                        this._hasUnnotifiedExternalChanges = true;
                    }
                    this._data.workspaces[wsKey][k] = deepClone(v);
                }
            }
        }
    }

    private _clearDirtyUpTo(version: number): void {
        for (const [k, v] of [...this._dirtyGlobalKeys.entries()]) {
            if (v <= version) { this._dirtyGlobalKeys.delete(k); }
        }
        for (const [k, v] of [...this._dirtyAppSettingsFields.entries()]) {
            if (v <= version) { this._dirtyAppSettingsFields.delete(k); }
        }
        for (const [k, v] of [...this._seededGlobalKeys.entries()]) {
            if (v <= version) { this._seededGlobalKeys.delete(k); }
        }
        for (const [wsKey, map] of [...this._dirtyWorkspaceKeys.entries()]) {
            for (const [k, v] of [...map.entries()]) {
                if (v <= version) { map.delete(k); }
            }
            if (map.size === 0) { this._dirtyWorkspaceKeys.delete(wsKey); }
        }
        for (const [wsKey, map] of [...this._seededWorkspaceKeys.entries()]) {
            for (const [k, v] of [...map.entries()]) {
                if (v <= version) { map.delete(k); }
            }
            if (map.size === 0) { this._seededWorkspaceKeys.delete(wsKey); }
        }
    }

    private async _flush(): Promise<DurableStateCommitReceipt> {
        if (this._flushInFlight) {
            return await this._flushInFlight;
        }

        const targetVersion = this._pendingVersion;
        const localSnapshot = deepClone(this._data);
        const dirtyAppFieldsSnapshot = new Map(this._dirtyAppSettingsFields);
        const snapshotBaseSerialized = this._lastSerialized;
        const snapshotBaseData = deepClone(this._baseData);
        const snapshotBaseKnownMtime = this._lastKnownMtimeMs;

        this._flushInFlight = (async (): Promise<DurableStateCommitReceipt> => {
            let lockHandle: FencedLockHandle | null = null;
            let writeSucceeded = false;
            let failureMessage: string | undefined;
            let failureCode: string | undefined;
            try {
                lockHandle = await acquireFencedLockFile(`${this._filePath}.lock`, this._lockOptions);

                let dataToWrite = localSnapshot;
                let diskExists = false;
                let diskChanged = false;
                let preWriteStat: { mtimeMs: number; size: number; ino: number } | null = null;

                let stat: fs.Stats | undefined;
                try {
                    stat = await fs.promises.stat(this._filePath);
                } catch (err) {
                    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { throw err; }
                }
                if (stat) {
                    diskExists = true;
                    preWriteStat = { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino };
                    const reloadedWhileWaiting = this._lastSerialized !== snapshotBaseSerialized;
                    const inoDiffers = stat.ino > 0 && this._lastKnownIno !== null && stat.ino !== this._lastKnownIno;
                    const statDiffers = reloadedWhileWaiting
                        || snapshotBaseKnownMtime === null
                        || this._lastKnownMtimeMs === null
                        || stat.mtimeMs !== this._lastKnownMtimeMs
                        || stat.size !== this._lastKnownSize
                        || inoDiffers
                        || Math.abs(Date.now() - stat.mtimeMs) < 1500;
                    if (statDiffers) {
                        const cleanDisk = stripUtf8Bom(await readFileWithRetry(this._filePath));
                        if (cleanDisk !== snapshotBaseSerialized || reloadedWhileWaiting || snapshotBaseKnownMtime === null) {
                            const parsedDisk = parseStateFile(cleanDisk);
                            if (!parsedDisk) {
                                throw Object.assign(new Error('Existing durable state is invalid; original bytes preserved'), { code: 'EINVALIDSTATE' });
                            }
                            diskChanged = true;
                            dataToWrite = this._mergeWithDisk(
                                parsedDisk,
                                localSnapshot,
                                targetVersion,
                                dirtyAppFieldsSnapshot,
                                snapshotBaseData,
                            );
                        }
                    }
                }

                const serialized = this._serialize(dataToWrite);
                if (diskExists && !diskChanged && serialized === this._lastSerialized) {
                    this._clearDirtyUpTo(targetVersion);
                    writeSucceeded = true;
                } else {
                    await fs.promises.mkdir(path.dirname(this._filePath), { recursive: true });
                    const tmpPath = buildTempFilePath(this._filePath);
                    try {
                        const writeOpts: fs.WriteFileOptions = process.platform === 'win32'
                            ? { encoding: 'utf8' }
                            : { encoding: 'utf8', mode: 0o600 };
                        await fs.promises.writeFile(tmpPath, serialized, writeOpts);

                        const owned = lockHandle;
                        await renameWithRetry(tmpPath, this._filePath, async () => {
                            let current: fs.Stats | undefined;
                            try {
                                current = await fs.promises.stat(this._filePath);
                            } catch (err) {
                                if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { throw err; }
                            }
                            if (current ? !preWriteStat || current.mtimeMs !== preWriteStat.mtimeMs
                                || current.size !== preWriteStat.size
                                || (preWriteStat.ino > 0 && current.ino > 0 && current.ino !== preWriteStat.ino)
                                : preWriteStat !== null) {
                                throw new DurableStateLockLostError(owned.lockPath, 'state file modified concurrently before rename');
                            }
                            if (!(await owned.verifyOwned())) {
                                throw new DurableStateLockLostError(owned.lockPath, 'lock ownership changed before rename');
                            }
                        });
                    } catch (writeErr) {
                        await fs.promises.unlink(tmpPath).catch(() => {});
                        throw writeErr;
                    }

                    const prevBaseGlobal = this._baseData.global;
                    this._lastSerialized = serialized;
                    this._baseData = deepClone(dataToWrite);
                    if (diskChanged) {
                        this._reconcileInMemoryAfterMerge(dataToWrite, targetVersion, prevBaseGlobal);
                    }
                    this._clearDirtyUpTo(targetVersion);

                    try {
                        const updatedStat = await fs.promises.stat(this._filePath);
                        this._lastKnownMtimeMs = updatedStat.mtimeMs;
                        this._lastKnownSize = updatedStat.size;
                        this._lastKnownIno = updatedStat.ino > 0 ? updatedStat.ino : null;
                    } catch {
                        this._lastKnownMtimeMs = null;
                        this._lastKnownSize = null;
                        this._lastKnownIno = null;
                    }

                    writeSucceeded = true;
                }
            } catch (err) {
                failureMessage = err instanceof Error ? err.message : String(err);
                failureCode = err && typeof err === 'object' && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
                    ? (err as { code: string }).code
                    : undefined;
                console.warn('[Antigravity Context Monitor] Durable state persistence failed:', err);
            } finally {
                if (lockHandle) {
                    await lockHandle.release();
                }
            }

            let receipt: DurableStateCommitReceipt;
            if (writeSucceeded) {
                this._consecutiveFailures = 0;
                this._lastError = undefined;
                this._lastErrorCode = undefined;
                this._writtenVersion = Math.max(this._writtenVersion, targetVersion);
                receipt = {
                    committed: true,
                    revision: this._writtenVersion,
                    pendingRevision: this._pendingVersion,
                    status: 'committed',
                    retryScheduled: false,
                };
                this._resolveWaitersUpTo(this._writtenVersion, receipt);
                this._flushInFlight = null;
                if (!this._saveTimer && this._pendingVersion > this._writtenVersion) {
                    void this._flush();
                }
            } else {
                // Never advance _writtenVersion or falsely resolve waiters as saved on failure:
                // retain dirty state and schedule a backoff retry timer.
                this._consecutiveFailures += 1;
                this._lastError = failureMessage || 'Durable state persistence failed';
                this._lastErrorCode = failureCode;
                this._flushInFlight = null;
                const retryScheduled = this._scheduleRetry();
                receipt = {
                    committed: false,
                    revision: this._writtenVersion,
                    pendingRevision: this._pendingVersion,
                    status: retryScheduled ? 'pending' : 'failed',
                    error: this._lastError,
                    ...(this._lastErrorCode ? { errorCode: this._lastErrorCode } : {}),
                    retryScheduled,
                };
                // Only release waiters once automatic retries are exhausted — with explicit committed:false!
                // While retryScheduled === true, waiters remain pending until disk commit succeeds.
                if (!retryScheduled) {
                    this._resolveWaitersUpTo(targetVersion, receipt);
                }
            }

            return receipt;
        })();

        return await this._flushInFlight;
    }
}

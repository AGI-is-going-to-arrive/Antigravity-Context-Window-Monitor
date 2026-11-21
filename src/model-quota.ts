import {
    getModelSpecs,
    getQuotaPoolKey,
    resolveModelId,
    type ModelConfig,
    type ModelSpec,
    type QuotaWindowSummary,
    type UserQuotaSummary,
} from './models';

export type QuotaEffort = 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelQuotaReading {
    model: string;
    label: string;
    familyLabel?: string;
    effort?: QuotaEffort;
    remaining: number | null;
    resetTime: string | null;
    resetAt: number | null;
}

export interface ModelQuotaMember {
    key: string;
    label: string;
    tagTitle?: string;
    efforts: QuotaEffort[];
    readings: ModelQuotaReading[];
}

export interface QuotaReadingSummary {
    minimum: number | null;
    maximum: number | null;
    quotaDiffers: boolean;
    resetDiffers: boolean;
    missingQuota: boolean;
    missingReset: boolean;
    resetTime: string | null;
}

export interface ModelQuotaGroup extends ModelQuotaMember, QuotaReadingSummary {
    pool?: 'gemini' | 'premium';
    members: ModelQuotaMember[];
    /** Optional 5-hour quota window from RetrieveUserQuotaSummary (exact remainingFraction). */
    fiveHourQuota?: QuotaWindowSummary;
    /** Optional weekly quota window from RetrieveUserQuotaSummary (exact remainingFraction). */
    weeklyQuota?: QuotaWindowSummary;
}

export function summarizeQuotaReadings(readings: readonly ModelQuotaReading[]): QuotaReadingSummary {
    const remaining = readings.flatMap(reading => reading.remaining === null ? [] : [reading.remaining]);
    const resets = readings.flatMap(reading => reading.resetAt === null ? [] : [reading.resetAt]);
    const resetDiffers = new Set(resets).size > 1;
    return {
        minimum: remaining.length ? Math.min(...remaining) : null,
        maximum: remaining.length ? Math.max(...remaining) : null,
        quotaDiffers: new Set(remaining).size > 1,
        resetDiffers,
        missingQuota: remaining.length < readings.length,
        missingReset: resets.length < readings.length,
        resetTime: resetDiffers ? null : readings.find(reading => reading.resetTime)?.resetTime ?? null,
    };
}

const EFFORTS: QuotaEffort[] = ['low', 'medium', 'high', 'xhigh'];
const CATALOG_EFFORT_SUFFIX = /[-_](low|medium|high|xhigh|extra(?:[-_]high)?)$/i;
const THINKING_LEVELS: Record<QuotaEffort, number> = { low: 1, medium: 2, high: 3, xhigh: 100 };
const LEGACY_QUOTA_FAMILIES: Record<string, { name: string; effort: QuotaEffort }> = {
    MODEL_PLACEHOLDER_M84: { name: 'Gemini 3.5 Flash', effort: 'high' },
    MODEL_PLACEHOLDER_M133: { name: 'Gemini 3.5 Flash', effort: 'high' },
    MODEL_PLACEHOLDER_M132: { name: 'Gemini 3.5 Flash', effort: 'high' },
    MODEL_PLACEHOLDER_M20: { name: 'Gemini 3.5 Flash', effort: 'medium' },
    MODEL_PLACEHOLDER_M187: { name: 'Gemini 3.5 Flash', effort: 'low' },
    MODEL_PLACEHOLDER_M264: { name: 'Gemini 3.6 Flash', effort: 'high' },
    MODEL_PLACEHOLDER_M265: { name: 'Gemini 3.6 Flash', effort: 'medium' },
    MODEL_PLACEHOLDER_M266: { name: 'Gemini 3.6 Flash', effort: 'low' },
    MODEL_PLACEHOLDER_M16: { name: 'Gemini 3.1 Pro', effort: 'high' },
    MODEL_PLACEHOLDER_M37: { name: 'Gemini 3.1 Pro', effort: 'high' },
};

interface QuotaFamily {
    key: string;
    effort: QuotaEffort;
}

/** Resolve effort families from the catalog. Account labels are only used for presentation. */
function quotaFamily(model: string, spec?: ModelSpec): QuotaFamily | undefined {
    if (spec?.isImageGeneration) { return undefined; }
    const legacy = Object.hasOwn(LEGACY_QUOTA_FAMILIES, model)
        ? LEGACY_QUOTA_FAMILIES[model] : undefined;
    if (legacy) {
        return { key: legacy.name.toLowerCase().replace(/ /g, '-'), effort: legacy.effort };
    }
    if (!spec) { return undefined; }
    const modelId = spec.modelId.toLowerCase();
    const suffix = CATALOG_EFFORT_SUFFIX.exec(modelId);
    if (!suffix || suffix.index === 0) { return undefined; }
    const effort = suffix[1].startsWith('extra') ? 'xhigh' : suffix[1] as QuotaEffort;
    const stem = modelId.slice(0, suffix.index).replace(/_/g, '-');
    if (/^(?:gemini-\d+(?:\.\d+)?-(?:neon|hydrogen|carbon|argon|flash|pro)|claude-(?:opus|sonnet|haiku)-\d+(?:[.-]\d+)?|gpt-oss-\d+b)$/.test(stem)) {
        return { key: stem, effort };
    }
    // For other catalog families, the provider, explicit effort suffix and
    // backend thinking metadata must agree. Similar display names alone do
    // not establish a shared identity or a shared quota pool.
    const provider = spec.apiProvider.trim().toLowerCase();
    if (provider && spec.supportsThinking && spec.thinkingLevel === THINKING_LEVELS[effort]) {
        return { key: `${provider}:${stem}`, effort };
    }
    return undefined;
}

/** Remove only the known effort and diagnostic suffix from the live label. */
function familyLabel(label: string, effort: QuotaEffort): string {
    const labels = {
        low: 'low|低|弱',
        medium: 'medium|中',
        high: 'high|高|强',
        xhigh: 'xhigh|extra(?:[\\s_-]+high)?|超高|极高',
    }[effort];
    const normalized = label.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    const clean = normalized.replace(/（/g, '(').replace(/）/g, ')').replace(/\s*\((?:M\d+|OSS-120B)\)$/, '');
    const localized = `(?:${labels})(?:\\s*/\\s*(?:${labels}))?`;
    return clean.replace(new RegExp(`(?:\\s*\\(\\s*${localized}\\s*\\)|[\\s_-]+${localized})$`, 'i'), '').trim() || normalized || label;
}

function readQuota(config: ModelConfig, model: string, effort?: QuotaEffort): ModelQuotaReading {
    const fraction = config.quotaInfo?.remainingFraction;
    const remaining = typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1
        ? fraction : null;
    const rawReset = config.quotaInfo?.resetTime;
    const reset = typeof rawReset === 'string' ? rawReset.trim() : '';
    const isTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(reset);
    const parsed = isTimestamp ? Date.parse(reset) : NaN;
    const calendarDate = isTimestamp ? new Date(`${reset.slice(0, 10)}T00:00:00Z`) : null;
    const validDate = calendarDate && Number.isFinite(calendarDate.getTime()) && calendarDate.toISOString().slice(0, 10) === reset.slice(0, 10);
    // Proto3 omits unset timestamps or serializes untouched quota resetTime as epoch 0 (1970-01-01T00:00:00Z).
    const resetAt = validDate && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    return { model, label: config.label, effort, remaining, resetAt, resetTime: resetAt === null ? null : reset };
}

/** Group the presentation by canonical pool; accounting/model identities stay intact. */
export function groupModelQuotas(
    configs: readonly ModelConfig[],
    quotaSummary?: UserQuotaSummary | null,
): ModelQuotaGroup[] {
    const specs = new Map(getModelSpecs().map(spec => [spec.placeholderId, spec]));
    const groups = new Map<string, ModelQuotaGroup>();
    const seenReadings = new Set<string>();
    for (const [index, config] of configs.entries()) {
        const resolved = resolveModelId(config.model);
        const model = resolved || config.model.trim();
        const spec = specs.get(model);
        const family = quotaFamily(model, spec);
        // Never supply resetTime: the registry's fallback is not evidence of a
        // shared pool. Only its explicit Gemini/premium contracts are merged.
        const canonicalPool = resolved ? getQuotaPoolKey(resolved) : '';
        // A live label registration alone can resolve an arbitrary raw ID. If
        // the pool lookup merely echoes that ID, it is still the unknown fallback.
        const pool = canonicalPool !== resolved && (canonicalPool === 'gemini' || canonicalPool === 'premium')
            ? canonicalPool : undefined;
        const memberKey = family ? `family:${family.key}` : `model:${model || index}`;
        const key = pool ? `pool:${pool}` : memberKey;
        const liveLabel = config.label.trim() || spec?.displayName || model;
        const memberLabel = family ? familyLabel(liveLabel, family.effort) : liveLabel;
        const reading = readQuota(config, model, family?.effort);
        reading.label = liveLabel;
        reading.familyLabel = family ? memberLabel : undefined;
        // Identical aliases/duplicate configs do not add rows. Conflicting samples
        // of the same ID remain visible rather than silently choosing one.
        const sampleKey = JSON.stringify([key, model, reading.remaining, reading.resetAt]);
        if (seenReadings.has(sampleKey)) { continue; }
        seenReadings.add(sampleKey);
        let group = groups.get(key);
        if (!group) {
            group = { key, pool, label: pool === 'gemini' ? 'Gemini' : pool === 'premium' ? 'Claude / GPT' : memberLabel,
                tagTitle: pool ? undefined : config.tagTitle, members: [], efforts: [], readings: [], minimum: null, maximum: null,
                quotaDiffers: false, resetDiffers: false, missingQuota: false, missingReset: false, resetTime: null };
            groups.set(key, group);
        } else if (!group.pool && !group.tagTitle && config.tagTitle) {
            group.tagTitle = config.tagTitle;
        }
        let member = group.members.find(item => item.key === memberKey);
        if (!member) {
            member = { key: memberKey, label: memberLabel, tagTitle: config.tagTitle, efforts: [], readings: [] };
            group.members.push(member);
        } else if (!member.tagTitle && config.tagTitle) {
            member.tagTitle = config.tagTitle;
        }
        member.readings.push(reading);
    }
    const summaryByPool = new Map<'gemini' | 'premium', { fiveHour?: QuotaWindowSummary; weekly?: QuotaWindowSummary }>();
    if (quotaSummary?.groups) {
        for (const summaryGroup of quotaSummary.groups) {
            if (summaryGroup.pool !== 'gemini' && summaryGroup.pool !== 'premium') { continue; }
            const existing = summaryByPool.get(summaryGroup.pool) || {};
            if (summaryGroup.fiveHour && !existing.fiveHour) { existing.fiveHour = summaryGroup.fiveHour; }
            if (summaryGroup.weekly && !existing.weekly) { existing.weekly = summaryGroup.weekly; }
            summaryByPool.set(summaryGroup.pool, existing);
        }
    }
    for (const group of groups.values()) {
        for (const member of group.members) {
            member.efforts = EFFORTS.filter(effort => member.readings.some(reading => reading.effort === effort));
            member.readings.sort((a, b) => (a.effort ? EFFORTS.indexOf(a.effort) : -1) - (b.effort ? EFFORTS.indexOf(b.effort) : -1));
        }
        group.readings = group.members.flatMap(member => member.readings);
        group.efforts = EFFORTS.filter(effort => group.readings.some(reading => reading.effort === effort));
        Object.assign(group, summarizeQuotaReadings(group.readings));
        if (group.pool) {
            const windows = summaryByPool.get(group.pool);
            if (windows?.fiveHour) { group.fiveHourQuota = windows.fiveHour; }
            if (windows?.weekly) { group.weeklyQuota = windows.weekly; }
        }
    }
    return [...groups.values()];
}

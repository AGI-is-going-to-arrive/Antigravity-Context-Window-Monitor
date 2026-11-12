import { getModelSpecs, getQuotaPoolKey, resolveModelId, type ModelConfig, type ModelSpec } from './models';

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

export interface ModelQuotaGroup extends ModelQuotaMember {
    pool?: 'gemini' | 'premium';
    members: ModelQuotaMember[];
    minimum: number | null;
    maximum: number | null;
    quotaDiffers: boolean;
    resetDiffers: boolean;
    missingQuota: boolean;
    missingReset: boolean;
    resetTime: string | null;
}

const EFFORTS: QuotaEffort[] = ['low', 'medium', 'high', 'xhigh'];
const LEGACY_QUOTA_FAMILIES: Record<string, { name: string; effort: QuotaEffort }> = {
    MODEL_PLACEHOLDER_M84: { name: 'Gemini 3.5 Flash', effort: 'high' },
    MODEL_PLACEHOLDER_M133: { name: 'Gemini 3.5 Flash', effort: 'high' },
    MODEL_PLACEHOLDER_M20: { name: 'Gemini 3.5 Flash', effort: 'medium' },
    MODEL_PLACEHOLDER_M187: { name: 'Gemini 3.5 Flash', effort: 'low' },
    MODEL_PLACEHOLDER_M16: { name: 'Gemini 3.1 Pro', effort: 'high' },
    MODEL_PLACEHOLDER_M37: { name: 'Gemini 3.1 Pro', effort: 'high' },
};

/** Family membership is display information inside the canonical shared quota pool. */
function quotaFamily(spec: ModelSpec): { name: string; effort: QuotaEffort } | undefined {
    if (spec.isImageGeneration) { return undefined; }
    // These verified legacy IDs predate effort-named catalogs. In particular,
    // M20's catalog says "low" but its actual effort is Medium. Live display
    // labels may be renamed/localized and never define the grouping identity.
    if (Object.hasOwn(LEGACY_QUOTA_FAMILIES, spec.placeholderId)) { return LEGACY_QUOTA_FAMILIES[spec.placeholderId]; }
    const gemini = spec.modelId.match(/^gemini-(\d+(?:\.\d+)?)-(hydrogen|carbon|argon|flash|pro)-(low|medium|high|xhigh)$/i);
    if (gemini) {
        const family = gemini[2].toLowerCase();
        return { name: `Gemini ${gemini[1]} ${family[0].toUpperCase()}${family.slice(1)}`, effort: gemini[3].toLowerCase() as QuotaEffort };
    }
    const claude = spec.modelId.match(/^claude-(opus|sonnet)-(\d+)-(\d+)-(low|medium|high)$/i);
    if (claude) {
        const family = claude[1].toLowerCase();
        return { name: `Claude ${family[0].toUpperCase()}${family.slice(1)} ${claude[2]}.${claude[3]}`, effort: claude[4].toLowerCase() as QuotaEffort };
    }
    const gpt = spec.modelId.match(/^gpt-oss-(\d+b)-(low|medium|high)$/i);
    return gpt ? { name: `GPT-OSS ${gpt[1].toUpperCase()}`, effort: gpt[2].toLowerCase() as QuotaEffort } : undefined;
}

/** Remove only the known effort and diagnostic suffix from the live label. */
function familyLabel(label: string, effort: QuotaEffort): string {
    const labels = { low: 'low|低', medium: 'medium|中', high: 'high|高',
        xhigh: 'xhigh|extra(?:[\\s_-]+high)?|超高|极高' }[effort];
    const clean = label.trim().replace(/（/g, '(').replace(/）/g, ')').replace(/\s*\((?:M\d+|OSS-120B)\)$/, '');
    return clean.replace(new RegExp(`(?:\\s*\\(\\s*(?:${labels})\\s*\\)|[\\s_-]+(?:${labels}))$`, 'i'), '').trim() || label;
}

function readQuota(config: ModelConfig, model: string, effort?: QuotaEffort): ModelQuotaReading {
    const fraction = config.quotaInfo?.remainingFraction;
    const remaining = typeof fraction === 'number' && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1
        ? fraction : null;
    const rawReset = config.quotaInfo?.resetTime;
    const reset = typeof rawReset === 'string' ? rawReset : '';
    const isTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(reset);
    const parsed = isTimestamp ? Date.parse(reset) : NaN;
    const calendarDate = isTimestamp ? new Date(`${reset.slice(0, 10)}T00:00:00Z`) : null;
    const validDate = calendarDate && Number.isFinite(calendarDate.getTime()) && calendarDate.toISOString().slice(0, 10) === reset.slice(0, 10);
    const resetAt = validDate && Number.isFinite(parsed) ? parsed : null;
    return { model, label: config.label, effort, remaining, resetAt, resetTime: resetAt === null ? null : reset };
}

/** Group the presentation by canonical pool; accounting/model identities stay intact. */
export function groupModelQuotas(configs: readonly ModelConfig[]): ModelQuotaGroup[] {
    const specs = new Map(getModelSpecs().map(spec => [spec.placeholderId, spec]));
    const groups = new Map<string, ModelQuotaGroup>();
    const seenReadings = new Set<string>();
    for (const [index, config] of configs.entries()) {
        const resolved = resolveModelId(config.model);
        const model = resolved || config.model.trim();
        const spec = specs.get(model);
        const family = spec ? quotaFamily(spec) : undefined;
        // Never supply resetTime: the registry's fallback is not evidence of a
        // shared pool. Only its explicit Gemini/premium contracts are merged.
        const canonicalPool = resolved ? getQuotaPoolKey(resolved) : '';
        // A live label registration alone can resolve an arbitrary raw ID. If
        // the pool lookup merely echoes that ID, it is still the unknown fallback.
        const pool = canonicalPool !== resolved && (canonicalPool === 'gemini' || canonicalPool === 'premium')
            ? canonicalPool : undefined;
        const key = pool ? `pool:${pool}` : `model:${model || index}`;
        const memberKey = family ? `family:${family.name.toLowerCase()}` : `model:${model || index}`;
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
        }
        let member = group.members.find(item => item.key === memberKey);
        if (!member) {
            member = { key: memberKey, label: memberLabel, tagTitle: config.tagTitle, efforts: [], readings: [] };
            group.members.push(member);
        }
        member.readings.push(reading);
    }
    for (const group of groups.values()) {
        for (const member of group.members) {
            member.efforts = EFFORTS.filter(effort => member.readings.some(reading => reading.effort === effort));
            member.readings.sort((a, b) => (a.effort ? EFFORTS.indexOf(a.effort) : -1) - (b.effort ? EFFORTS.indexOf(b.effort) : -1));
        }
        group.readings = group.members.flatMap(member => member.readings);
        group.efforts = EFFORTS.filter(effort => group.readings.some(reading => reading.effort === effort));
        const remaining = group.readings.flatMap(reading => reading.remaining === null ? [] : [reading.remaining]);
        const resets = group.readings.flatMap(reading => reading.resetAt === null ? [] : [reading.resetAt]);
        group.minimum = remaining.length ? Math.min(...remaining) : null;
        group.maximum = remaining.length ? Math.max(...remaining) : null;
        group.quotaDiffers = new Set(remaining).size > 1;
        group.resetDiffers = new Set(resets).size > 1;
        group.missingQuota = remaining.length < group.readings.length;
        group.missingReset = resets.length < group.readings.length;
        group.resetTime = !group.resetDiffers ? group.readings.find(reading => reading.resetTime)?.resetTime || null : null;
    }
    return [...groups.values()];
}

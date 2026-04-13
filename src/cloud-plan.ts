import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { LSInfo } from './discovery';
import { rpcCall } from './rpc-client';

const CLOUD_PLAN_ENDPOINT = '/v1internal:loadCodeAssist';
const CLOUD_PLAN_HOST = 'cloudcode-pa.googleapis.com';
const CLOUD_PLAN_TIMEOUT_MS = 10_000;
const CLOUD_PLAN_FRESH_CACHE_MS = 60_000;
const CLOUD_PLAN_FAILURE_CACHE_MS = 15_000;
const CLOUD_PLAN_STALE_REUSE_MS = 12 * 60 * 60 * 1000;

export interface CloudAllowedTier {
    id: string;
    name: string;
    description: string;
    isDefault: boolean;
}

export interface CloudPlanInfo {
    currentTierId: string;
    currentTierName: string;
    currentTierDescription: string;
    displayPlanName: string;
    displayTierKey: string;
    planDetailName: string;
    upgradeSubscriptionText: string;
    upgradeSubscriptionUri: string;
    upgradeSubscriptionType: string;
    allowedTiers: CloudAllowedTier[];
    capturedAtIso: string;
    isStale: boolean;
    rawResponse?: Record<string, unknown>;
}

interface RegistryProcess {
    pid: number;
    port: number;
    csrfToken: string;
    workspaceId?: string;
}

interface CachedCloudPlan {
    expiresAt: number;
    staleUntil: number;
    value: CloudPlanInfo | null;
}

let cachedCloudPlan: CachedCloudPlan | null = null;

export function mapCloudTierToDisplayPlan(
    tierId: string,
    tierName: string,
): { displayPlanName: string; displayTierKey: string; planDetailName: string } {
    const id = tierId.toLowerCase();
    if (id.includes('free')) {
        return {
            displayPlanName: 'Free',
            displayTierKey: 'CLOUD_TIER_FREE',
            planDetailName: tierName && tierName !== 'Free' ? tierName : '',
        };
    }
    if (id.includes('standard')) {
        return {
            displayPlanName: 'Standard',
            displayTierKey: 'CLOUD_TIER_STANDARD',
            planDetailName: tierName && tierName !== 'Standard' ? tierName : '',
        };
    }
    if (id.includes('pro')) {
        return {
            displayPlanName: 'Pro',
            displayTierKey: 'CLOUD_TIER_PRO',
            planDetailName: tierName && tierName !== 'Pro' ? tierName : '',
        };
    }
    return {
        displayPlanName: tierName || '',
        displayTierKey: tierName ? 'CLOUD_TIER_UNKNOWN' : '',
        planDetailName: '',
    };
}

function getRegistryProcesses(): RegistryProcess[] {
    const regPath = path.join(
        process.env.USERPROFILE || '',
        '.gemini',
        'antigravity',
        'memory-store',
        'ls-registry.json',
    );
    if (!fs.existsSync(regPath)) { return []; }
    try {
        const raw = JSON.parse(fs.readFileSync(regPath, 'utf8')) as { processes?: Record<string, RegistryProcess> };
        return Object.values(raw.processes || {});
    } catch {
        return [];
    }
}

async function getUnleashData(ls: LSInfo, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    try {
        return await rpcCall(ls, 'GetUnleashData', {
            metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
        }, 8000, signal);
    } catch {
        return null;
    }
}

function getUnleashDataFromRegistryProcess(proc: RegistryProcess, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve(null);
            return;
        }

        const postData = JSON.stringify({
            metadata: { ideName: 'antigravity', extensionName: 'antigravity' }
        });
        const req = http.request({
            hostname: '127.0.0.1',
            port: proc.port,
            path: '/exa.language_server_pb.LanguageServerService/GetUnleashData',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Connect-Protocol-Version': '1',
                'x-codeium-csrf-token': proc.csrfToken,
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: 8000,
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    resolve(null);
                    return;
                }
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>); }
                catch { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });

        let onAbort: (() => void) | undefined;
        if (signal) {
            onAbort = () => {
                req.destroy();
                resolve(null);
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }

        req.on('close', () => {
            if (signal && onAbort) {
                signal.removeEventListener('abort', onAbort);
            }
        });

        req.write(postData);
        req.end();
    });
}

function extractCloudToken(unleash: Record<string, unknown> | null): string {
    const context = (unleash?.context || {}) as Record<string, unknown>;
    return (context.userId as string) || '';
}

function isSameProcess(proc: RegistryProcess, ls: LSInfo): boolean {
    return proc.pid === ls.pid
        && proc.port === ls.port
        && proc.csrfToken === ls.csrfToken;
}

async function discoverCloudTokens(ls: LSInfo, signal?: AbortSignal): Promise<string[]> {
    const tokens: string[] = [];
    const seen = new Set<string>();
    const pushToken = (token: string) => {
        if (!token || seen.has(token)) { return; }
        seen.add(token);
        tokens.push(token);
    };

    // Prefer the LS already selected for this VS Code window.
    pushToken(extractCloudToken(await getUnleashData(ls, signal)));

    const registry = getRegistryProcesses().sort((a, b) => {
        const aScore = (a.workspaceId ? 2 : 0) + (isSameProcess(a, ls) ? 1 : 0);
        const bScore = (b.workspaceId ? 2 : 0) + (isSameProcess(b, ls) ? 1 : 0);
        return bScore - aScore;
    });
    for (const proc of registry) {
        if (isSameProcess(proc, ls)) { continue; }
        pushToken(extractCloudToken(await getUnleashDataFromRegistryProcess(proc, signal)));
    }
    return tokens;
}

function cloudPostJson(
    bearerToken: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('Cloud plan request aborted'));
            return;
        }

        let settled = false;
        const safeResolve = (value: Record<string, unknown>) => {
            if (settled) { return; }
            settled = true;
            cleanup();
            resolve(value);
        };
        const safeReject = (err: Error) => {
            if (settled) { return; }
            settled = true;
            cleanup();
            reject(err);
        };

        const postData = JSON.stringify(body);
        const req = https.request({
            hostname: CLOUD_PLAN_HOST,
            port: 443,
            path: CLOUD_PLAN_ENDPOINT,
            method: 'POST',
            headers: {
                Authorization: `Bearer ${bearerToken}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
            timeout: CLOUD_PLAN_TIMEOUT_MS,
        }, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer | string) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    safeReject(new Error(`Cloud plan HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
                    return;
                }
                try {
                    safeResolve(JSON.parse(data) as Record<string, unknown>);
                } catch {
                    safeReject(new Error(`Failed to parse cloud plan response: ${data.substring(0, 200)}`));
                }
            });
        });

        let onAbort: (() => void) | undefined;
        const cleanup = () => {
            if (signal && onAbort) {
                signal.removeEventListener('abort', onAbort);
                onAbort = undefined;
            }
        };

        req.on('error', (err) => { safeReject(err as Error); });
        req.on('timeout', () => {
            req.destroy();
            safeReject(new Error('Cloud plan timeout'));
        });

        if (signal) {
            onAbort = () => {
                req.destroy();
                safeReject(new Error('Cloud plan request aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }

        req.write(postData);
        req.end();
    });
}

function parseAllowedTiers(raw: unknown): CloudAllowedTier[] {
    if (!Array.isArray(raw)) { return []; }
    return raw.map((item) => {
        const tier = (item || {}) as Record<string, unknown>;
        return {
            id: (tier.id as string) || '',
            name: (tier.name as string) || '',
            description: (tier.description as string) || '',
            isDefault: !!tier.isDefault,
        };
    }).filter(t => t.id || t.name);
}

function cacheCloudPlan(value: CloudPlanInfo | null, now: number, expiresInMs: number, staleReuseMs = expiresInMs): void {
    cachedCloudPlan = {
        value,
        expiresAt: now + expiresInMs,
        staleUntil: now + staleReuseMs,
    };
}

function applyFailureCooldown(now: number): void {
    if (!cachedCloudPlan) { return; }
    cachedCloudPlan = {
        ...cachedCloudPlan,
        expiresAt: now + CLOUD_PLAN_FAILURE_CACHE_MS,
    };
}

function getReusableCachedCloudPlan(now: number): CloudPlanInfo | null {
    if (!cachedCloudPlan?.value) { return null; }
    if (cachedCloudPlan.staleUntil <= now) { return null; }
    return {
        ...cachedCloudPlan.value,
        isStale: true,
    };
}

export async function fetchCloudPlanInfo(ls: LSInfo, signal?: AbortSignal): Promise<CloudPlanInfo | null> {
    const now = Date.now();
    if (cachedCloudPlan && cachedCloudPlan.expiresAt > now) {
        return cachedCloudPlan.value;
    }

    try {
        const tokens = await discoverCloudTokens(ls, signal);
        if (tokens.length === 0) {
            const stalePlan = getReusableCachedCloudPlan(now);
            if (stalePlan) {
                applyFailureCooldown(now);
                return stalePlan;
            }
            cacheCloudPlan(null, now, CLOUD_PLAN_FAILURE_CACHE_MS);
            return null;
        }

        let lastError: unknown = null;
        for (const token of tokens) {
            try {
                const resp = await cloudPostJson(token, {}, signal);
                const currentTier = (resp.currentTier || {}) as Record<string, unknown>;
                const currentTierId = (currentTier.id as string) || '';
                const currentTierName = (currentTier.name as string) || '';
                const currentTierDescription = (currentTier.description as string) || '';
                const { displayPlanName, displayTierKey, planDetailName } =
                    mapCloudTierToDisplayPlan(currentTierId, currentTierName);

                const plan: CloudPlanInfo = {
                    currentTierId,
                    currentTierName,
                    currentTierDescription,
                    displayPlanName,
                    displayTierKey,
                    planDetailName,
                    upgradeSubscriptionText: (currentTier.upgradeSubscriptionText as string) || '',
                    upgradeSubscriptionUri: (currentTier.upgradeSubscriptionUri as string) || '',
                    upgradeSubscriptionType: (currentTier.upgradeSubscriptionType as string) || '',
                    allowedTiers: parseAllowedTiers(resp.allowedTiers),
                    capturedAtIso: new Date(now).toISOString(),
                    isStale: false,
                    rawResponse: resp,
                };
                cacheCloudPlan(plan, now, CLOUD_PLAN_FRESH_CACHE_MS, CLOUD_PLAN_STALE_REUSE_MS);
                return plan;
            } catch (err) {
                lastError = err;
            }
        }

        if (lastError) {
            const stalePlan = getReusableCachedCloudPlan(now);
            if (stalePlan) {
                applyFailureCooldown(now);
                return stalePlan;
            }
        }
    } catch {
        const stalePlan = getReusableCachedCloudPlan(now);
        if (stalePlan) {
            applyFailureCooldown(now);
            return stalePlan;
        }
    }

    cacheCloudPlan(null, now, CLOUD_PLAN_FAILURE_CACHE_MS);
    return null;
}

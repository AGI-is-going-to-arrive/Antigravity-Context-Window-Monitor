import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import {
    DurableState,
    type DurableStateOptions,
    type StateBucket,
} from '../../src/durable-state';
import {
    APPROVED_GITHUB_REPO_SLUG,
    EXPECTED_PLUGIN_NAME,
    crc32,
} from '../../src/core/release-security';
import {
    getModelDisplayName,
    type ModelConfig,
    type UserStatusInfo,
} from '../../src/models';
import type { GMCallEntry } from '../../src/gm-tracker';
import type { PluginReleaseInfo } from '../../src/app/sidecar-types';

// ─── State Buckets & Fast DurableState ───────────────────────────────────────

export class InMemoryStateBucket implements StateBucket {
    private readonly values = new Map<string, unknown>();

    get<T>(key: string, defaultValue: T): T {
        return this.values.has(key) ? (this.values.get(key) as T) : defaultValue;
    }

    async update(key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            this.values.delete(key);
            return;
        }
        this.values.set(key, value);
    }

    has(key: string): boolean {
        return this.values.has(key);
    }

    clear(): void {
        this.values.clear();
    }
}

export function createNoopStateBucket(): StateBucket {
    return {
        get: <T>(_key: string, fallback: T) => fallback,
        update: async () => {},
    };
}

/**
 * Create a DurableState with zero write debounce by default for fast,
 * deterministic unit tests (real multi-process locking & contention live
 * in tests/integration/multiprocess-lock.integration.test.ts).
 */
export function createFastDurableState(
    filePath: string,
    options: DurableStateOptions = {},
): DurableState {
    return new DurableState(filePath, {
        debounceMs: 0,
        ...options,
    });
}

// ─── Temp Directory Lifecycle Helper ─────────────────────────────────────────

export interface TempDirTracker {
    make(prefix?: string): string;
    cleanup(): void;
}

export function createTempDirTracker(defaultPrefix = 'acm-test-'): TempDirTracker {
    const dirs: string[] = [];
    return {
        make(prefix = defaultPrefix): string {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
            dirs.push(dir);
            return dir;
        },
        cleanup(): void {
            while (dirs.length > 0) {
                const dir = dirs.pop()!;
                try {
                    fs.rmSync(dir, { recursive: true, force: true });
                } catch {
                    // Best-effort cleanup in test teardown
                }
            }
        },
    };
}

// ─── ZIP & Plugin Bundle Factories ───────────────────────────────────────────

export interface TestZipEntry {
    name: string;
    data: Buffer | string;
    method?: 0 | 8;
    unixMode?: number;
    hostOs?: number;
}

export function buildTestZip(entries: readonly TestZipEntry[]): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const rawData = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
        const method = entry.method ?? 8;
        const payload = method === 8 ? zlib.deflateRawSync(rawData) : rawData;
        const checksum = crc32(rawData);
        const unixMode = (entry.unixMode ?? 0o100644) & 0xffff;
        const hostOs = entry.hostOs ?? 3;
        const externalAttrs = (unixMode << 16) >>> 0;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(payload.length, 18);
        local.writeUInt32LE(rawData.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        localParts.push(local, nameBuf, payload);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(((hostOs & 0xff) << 8) | 20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt32LE(checksum, 16);
        central.writeUInt32LE(payload.length, 20);
        central.writeUInt32LE(rawData.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(externalAttrs, 38);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, nameBuf);

        offset += local.length + nameBuf.length + payload.length;
    }

    const centralBuf = Buffer.concat(centralParts);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...localParts, centralBuf, eocd]);
}

export function makeTestPluginZip(
    manifestVersion: string,
    extraEntries: readonly TestZipEntry[] = [],
): Buffer {
    return buildTestZip([
        {
            name: `${EXPECTED_PLUGIN_NAME}/plugin.json`,
            data: JSON.stringify({ name: EXPECTED_PLUGIN_NAME, version: manifestVersion }, null, 2),
        },
        {
            name: `${EXPECTED_PLUGIN_NAME}/sidecars/context_monitor/main.mjs`,
            data: `export const version = ${JSON.stringify(manifestVersion)};\n`,
            unixMode: 0o100755,
        },
        {
            name: `${EXPECTED_PLUGIN_NAME}/sidecars/context_monitor/sidecar.json`,
            data: JSON.stringify({ command: 'node', args: ['main.mjs'], has_web_ui: true }),
        },
        {
            name: `${EXPECTED_PLUGIN_NAME}/sidecars/context_monitor/runtime/out/app/sidecar-bundle.js`,
            data: `module.exports = { version: ${JSON.stringify(manifestVersion)} };\n`,
        },
        {
            name: `${EXPECTED_PLUGIN_NAME}/sidecars/context_monitor/runtime/out/app/sidecar-server.js`,
            data: `module.exports = { version: ${JSON.stringify(manifestVersion)} };\n`,
        },
        {
            name: `${EXPECTED_PLUGIN_NAME}/sidecars/context_monitor/runtime/out/app/sidecar-runtime.js`,
            data: `module.exports = { version: ${JSON.stringify(manifestVersion)} };\n`,
        },
        ...extraEntries,
    ]);
}

export function seedTestInstalledPlugin(dir: string, version: string): void {
    fs.mkdirSync(path.join(dir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ name: EXPECTED_PLUGIN_NAME, version }), 'utf8');
    fs.writeFileSync(path.join(dir, 'sidecars', 'context_monitor', 'main.mjs'), `// ${version}\n`, 'utf8');
    fs.writeFileSync(
        path.join(dir, 'sidecars', 'context_monitor', 'sidecar.json'),
        JSON.stringify({ command: 'node', args: ['main.mjs'], has_web_ui: true }),
        'utf8',
    );
    for (const fileName of ['sidecar-bundle.js', 'sidecar-server.js', 'sidecar-runtime.js']) {
        fs.writeFileSync(
            path.join(dir, 'sidecars', 'context_monitor', 'runtime', 'out', 'app', fileName),
            `module.exports = { version: ${JSON.stringify(version)} };\n`,
            'utf8',
        );
    }
}

export function makeApprovedReleaseInfo(
    version: string,
    overrides: Partial<PluginReleaseInfo> = {},
): PluginReleaseInfo {
    const tag = `v${version}`;
    const assetName = `${EXPECTED_PLUGIN_NAME}-app-${version}.zip`;
    return {
        version,
        tagName: tag,
        releaseUrl: `https://github.com/${APPROVED_GITHUB_REPO_SLUG}/releases/tag/${tag}`,
        releaseNotesSummary: `Release ${tag}`,
        assetName,
        assetUrl: `https://github.com/${APPROVED_GITHUB_REPO_SLUG}/releases/download/${tag}/${assetName}`,
        checksumsUrl: `https://github.com/${APPROVED_GITHUB_REPO_SLUG}/releases/download/${tag}/SHA256SUMS.txt`,
        ...overrides,
    };
}

// ─── Domain Model / User / GM Call Factories ─────────────────────────────────

export function makeModelConfig(model: string, overrides: Partial<ModelConfig> = {}): ModelConfig {
    return {
        model,
        label: overrides.label || getModelDisplayName(model),
        supportsImages: true,
        allowedTiers: [],
        mimeTypeCount: 0,
        isRecommended: false,
        supportedMimeTypes: [],
        quotaInfo: { remainingFraction: 0.72, resetTime: '2026-11-26T18:00:00Z' },
        ...overrides,
    };
}

export function makeUserStatusInfo(overrides: Partial<UserStatusInfo> = {}): UserStatusInfo {
    return {
        name: 'Alice',
        email: 'alice@example.test',
        planName: 'Google AI Ultra',
        teamsTier: '',
        userTierName: 'Google AI Ultra',
        userTierId: 'ultra',
        defaultModelLabel: 'Gemini 4 Neon (Extra High)',
        planLimits: {
            maxNumChatInputTokens: 1_000_000,
            maxNumPremiumChatMessages: -1,
            maxCustomChatInstructionCharacters: 12_000,
            maxNumPinnedContextItems: 20,
            maxLocalIndexSize: 100_000,
            monthlyFlexCreditPurchaseAmount: 500,
        },
        teamConfig: {
            allowMcpServers: true,
            allowAutoRunCommands: false,
            allowBrowserExperimentalFeatures: true,
        },
        availableCredits: [
            { creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: 2_500, minimumCreditAmountForUsage: 1 },
        ],
        canBuyMoreCredits: true,
        browserEnabled: true,
        cascadeWebSearchEnabled: true,
        knowledgeBaseEnabled: true,
        canGenerateCommitMessages: true,
        cascadeCanAutoRunCommands: true,
        canAllowCascadeInBackground: false,
        hasAutocompleteFastMode: true,
        allowStickyPremiumModels: true,
        allowPremiumCommandModels: false,
        hasTabToJump: true,
        canCustomizeAppIcon: false,
        userTierDescription: '',
        upgradeSubscriptionText: '',
        modelSortOrder: [],
        ...overrides,
    };
}

export function makeGMCall(overrides: Partial<GMCallEntry> = {}): GMCallEntry {
    const todayIso = new Date().toISOString();
    return {
        executionId: 'exec-1',
        stepIndices: [2],
        model: 'MODEL_CLAUDE_4_6_SONNET_THINKING',
        modelDisplay: 'Claude Sonnet 4.6 (Thinking)',
        responseModel: 'claude-sonnet-4-6',
        apiProvider: 'API_PROVIDER_ANTHROPIC_VERTEX',
        accountEmail: 'alice@example.com',
        inputTokens: 4000,
        outputTokens: 600,
        thinkingTokens: 200,
        responseTokens: 400,
        cacheReadTokens: 16000,
        cacheCreationTokens: 1000,
        toolOutputTokens: 0,
        credits: 1,
        ttftSeconds: 0.72,
        streamingSeconds: 5.0,
        stopReason: 'STOP_REASON_STOP_PATTERN',
        completionConfig: {
            maxTokens: 65536,
            temperature: 1,
            firstTemperature: 0.4,
            topK: 40,
            topP: 0.95,
            stopPatterns: ['</final>'],
        },
        hasSystemPrompt: true,
        toolCount: 19,
        promptSectionTitles: ['System Preamble', 'Tool Definitions'],
        systemPromptSnippet: 'You are an expert assistant.',
        createdAt: todayIso,
        contextTokensUsed: 24500,
        maxContextTokens: 200000,
        tokenBreakdown: [
            { name: 'System Prompt', tokens: 6000 },
            { name: 'Conversation', tokens: 18500 },
        ],
        retries: 0,
        retryTokensIn: 0,
        retryTokensOut: 0,
        retryCredits: 0,
        retryErrors: [],
        ...overrides,
    };
}

// ─── Minimal Protobuf Encoder for CLI SQLite GenMetadata Fixtures ────────────

export function encodeVarint(value: number): number[] {
    const out: number[] = [];
    let v = Math.floor(value);
    while (v >= 0x80) {
        out.push((v & 0x7f) | 0x80);
        v = Math.floor(v / 128);
    }
    out.push(v & 0x7f);
    return out;
}

export function pbVarint(fn: number, value: number): Buffer {
    return Buffer.from([...encodeVarint((fn << 3) | 0), ...encodeVarint(value)]);
}

export function pbBytes(fn: number, payload: Buffer | string): Buffer {
    const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    return Buffer.concat([Buffer.from([...encodeVarint((fn << 3) | 2), ...encodeVarint(buf.length)]), buf]);
}

export function buildTestGenMetadataBlob(opts: {
    executionId?: string;
    stepIndices?: number[];
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    thinkingTokens?: number;
    responseModel?: string;
    modelDisplayName?: string;
    createdAtSec?: number;
    ttftSec?: number;
    ttftNanos?: number;
    streamSec?: number;
    streamNanos?: number;
}): Buffer {
    const usageParts: Buffer[] = [
        pbVarint(1, 1437),
        pbVarint(2, opts.inputTokens),
        pbVarint(3, opts.outputTokens),
    ];
    if (opts.cacheCreationTokens) { usageParts.push(pbVarint(4, opts.cacheCreationTokens)); }
    if (opts.cacheReadTokens) { usageParts.push(pbVarint(5, opts.cacheReadTokens)); }
    if (opts.thinkingTokens) { usageParts.push(pbVarint(9, opts.thinkingTokens)); }

    const cmParts: Buffer[] = [
        pbBytes(4, Buffer.concat(usageParts)),
    ];
    if (opts.createdAtSec) {
        const tsMsg = pbVarint(1, opts.createdAtSec);
        const csmMsg = pbBytes(4, tsMsg);
        cmParts.push(pbBytes(9, csmMsg));
    }
    if (opts.ttftSec !== undefined || opts.ttftNanos !== undefined) {
        const parts: Buffer[] = [];
        if (opts.ttftSec) { parts.push(pbVarint(1, opts.ttftSec)); }
        if (opts.ttftNanos) { parts.push(pbVarint(2, opts.ttftNanos)); }
        cmParts.push(pbBytes(11, Buffer.concat(parts)));
    }
    if (opts.streamSec !== undefined || opts.streamNanos !== undefined) {
        const parts: Buffer[] = [];
        if (opts.streamSec) { parts.push(pbVarint(1, opts.streamSec)); }
        if (opts.streamNanos) { parts.push(pbVarint(2, opts.streamNanos)); }
        cmParts.push(pbBytes(12, Buffer.concat(parts)));
    }
    if (opts.responseModel) { cmParts.push(pbBytes(19, opts.responseModel)); }
    if (opts.modelDisplayName) { cmParts.push(pbBytes(21, opts.modelDisplayName)); }

    const topParts: Buffer[] = [
        pbBytes(1, Buffer.concat(cmParts)),
    ];
    if (opts.stepIndices && opts.stepIndices.length > 0) {
        const packed = Buffer.from(opts.stepIndices.flatMap(encodeVarint));
        topParts.push(pbBytes(2, packed));
    }
    if (opts.executionId) {
        topParts.push(pbBytes(4, opts.executionId));
    }
    return Buffer.concat(topParts);
}

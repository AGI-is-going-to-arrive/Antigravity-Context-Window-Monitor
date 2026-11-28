/**
 * Opt-In Read-Only Antigravity CLI (`agy`) Status Line Formatter (§5.2 #7).
 *
 * Bundled via `scripts/build-bundles.mjs` into zero-dependency standalone ESM
 * `app-plugin/bin/agy-statusline.mjs` (`chmod 0o755`).
 *
 * Design & Safety Guarantees:
 * - Strictly read-only: parses ONLY the official `agy` statusLine JSON payload
 *   piped on stdin. NEVER reads unrelated cached App conversations or mutates disk.
 * - Privacy by default: NEVER emits `email` or `transcript_path` from stdin.
 * - Bounded stdin reader: enforces a hard 64 KB byte cap and 1500 ms timeout so
 *   broken, oversized, or hanging stdin NEVER stalls the `agy` CLI prompt.
 * - Terminal injection defense: strips ALL newlines, CR, ANSI SGR/CSI, OSC, DCS,
 *   APC, C0/C1 control characters, Unicode line separators, and bidi overrides
 *   from every untrusted string field (titles, models, workspaces, agents, etc.).
 * - Single-source metrics: uses `src/core/context-display.ts` for context usage
 *   percentage & health classification and `src/core/currency.ts` for 10-currency
 *   cost formatting (`USD/CNY/EUR/JPY/GBP/KRW/HKD/TWD/CAD/AUD`).
 * - Explicit unavailable markers (`—`): whenever context or cost measurements are
 *   absent/unknown, emits explicit `—` — NEVER fabricates `0%` or `$0.00`.
 * - Terminal hygiene: supports redirected (non-TTY) stdout, `NO_COLOR=1`,
 *   `TERM=dumb`, graceful `EPIPE` exit (`0`), and emits strictly ONE clean line.
 */

import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    buildPublishedMonitorObservation,
    formatObservationPrimaryPct,
    type ContextDisplayBasis,
    type ContextHealthStatus,
    type PublishedMonitorObservation,
} from '../core/context-display';
import {
    formatCurrencyAmount,
    isValidCustomFxRate,
    normalizeCurrencyCode,
    type CurrencyCode,
    type CurrencyConfig,
} from '../core/currency';
import { FALLBACK_APP_VERSION, resolveRuntimeVersion } from '../core/version';

declare const __ACM_IMPORT_META_URL__: string | undefined;
declare const __ACM_IMPORT_META_MAIN__: boolean | undefined;

export const MAX_STDIN_BYTES = 64 * 1024;
export const DEFAULT_STDIN_TIMEOUT_MS = 1500;
export const UNAVAILABLE_MARKER = '—';

// ─── Official `agy` CLI statusLine Payload Schema (v1.4.5+ / v1.5.x) ─────────

export interface AgyStatusLineModel {
    id?: string | null;
    display_name?: string | null;
    effort?: string | null;
}

export interface AgyStatusLineWorkspace {
    current_dir?: string | null;
    project_dir?: string | null;
}

export interface AgyStatusLineCurrentUsage {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
}

export interface AgyStatusLineContextWindow {
    total_input_tokens?: number | null;
    total_output_tokens?: number | null;
    context_window_size?: number | null;
    compaction_limit?: number | null;
    used_tokens?: number | null;
    used_percentage?: number | null;
    remaining_percentage?: number | null;
    current_usage?: AgyStatusLineCurrentUsage | null;
}

export interface AgyStatusLineQuotaBucket {
    remaining_fraction?: number | null;
    remaining_amount?: number | null;
    reset_time?: string | null;
    reset_in_seconds?: number | null;
    disabled?: boolean | null;
}

export interface AgyStatusLineSubagent {
    name?: string | null;
    role?: string | null;
    status?: string | null;
}

export interface AgyStatusLineCost {
    total_usd?: number | null;
    subagent_usd?: number | null;
    estimated?: boolean | null;
}

export interface AgyStatusLinePayload {
    cwd?: string | null;
    session_id?: string | null;
    conversation_id?: string | null;
    conversation_title?: string | null;
    transcript_path?: string | null;
    model?: AgyStatusLineModel | null;
    workspace?: AgyStatusLineWorkspace | null;
    version?: string | null;
    context_window?: AgyStatusLineContextWindow | null;
    exceeds_200k_tokens?: boolean | null;
    agent?: { name?: string | null } | null;
    product?: string | null;
    quota?: Record<string, AgyStatusLineQuotaBucket | null | undefined> | null;
    agent_state?: string | null;
    vcs?: { type?: string | null } | null;
    cycle_mode?: string | null;
    sandbox?: { enabled?: boolean | null } | null;
    subagents?: AgyStatusLineSubagent[] | null;
    artifact_count?: number | null;
    plan_tier?: string | null;
    email?: string | null;
    pending_input_count?: number | null;
    tool_confirmation_pending?: boolean | null;
    task_count?: number | null;
    terminal_width?: number | null;
    vim?: { mode?: string | null } | null;
    cost?: AgyStatusLineCost | null;
}

export interface StatusLineCliOptions {
    currency?: CurrencyCode;
    customFxRate?: number | null;
    basis: ContextDisplayBasis;
    noColor: boolean;
    forceColor: boolean;
    maxWidth?: number;
    maxStdinBytes: number;
    timeoutMs: number;
    showTitle: boolean;
    help: boolean;
    version: boolean;
}

export interface StatusLineFormatOptions {
    currency?: CurrencyCode | CurrencyConfig;
    basis?: ContextDisplayBasis;
    color?: boolean;
    maxWidth?: number;
    showTitle?: boolean;
    truncatedInput?: boolean;
}

export interface BoundedStdinResult {
    text: string;
    bytesRead: number;
    truncated: boolean;
    timedOut: boolean;
}

// ─── Direct-Execution Guard (File & Stdin Safe) ──────────────────────────────

function getEntryMetaUrl(): string {
    try {
        if (typeof __ACM_IMPORT_META_URL__ === 'string') {
            return __ACM_IMPORT_META_URL__;
        }
    } catch {
        // Unbundled CJS/Vitest runtime
    }
    if (typeof __filename === 'string' && __filename) {
        return pathToFileURL(__filename).href;
    }
    return '';
}

function getEntryMetaMain(): boolean | undefined {
    try {
        if (typeof __ACM_IMPORT_META_MAIN__ === 'boolean') {
            return __ACM_IMPORT_META_MAIN__;
        }
    } catch {
        // Unbundled runtime
    }
    return undefined;
}

export function isDirectExecution(
    argv: readonly string[] = process.argv,
    metaUrl: string = getEntryMetaUrl(),
    metaMain: boolean | undefined = getEntryMetaMain(),
): boolean {
    if (metaMain === true) {
        return true;
    }
    const entryArg = argv[1];
    const isEvalMeta = typeof metaUrl === 'string' && /\/\[eval\d*\]$/i.test(metaUrl);
    if (isEvalMeta && (!entryArg || entryArg === '-')) {
        return true;
    }
    if (!entryArg || entryArg === '-') {
        return false;
    }
    let metaPath: string;
    try {
        metaPath = fileURLToPath(metaUrl);
    } catch {
        return false;
    }
    const resolvedArg = resolve(entryArg);
    if (resolvedArg === metaPath) {
        return true;
    }
    try {
        return realpathSync(resolvedArg) === realpathSync(metaPath);
    } catch {
        return false;
    }
}

// ─── Terminal Control / Escape Sequence Sanitizer ────────────────────────────

// Strips OSC, DCS/SOS/PM/APC, 7-bit/8-bit CSI, 2-byte ESC sequences, C0/DEL/C1 controls,
// Unicode line separators, and bidi override controls.
const OSC_RE = /(?:\x1b\]|\x9d)[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c|$)/g;
const DCS_APC_RE = /(?:\x1b[PX^_]|[\x90\x98\x9e\x9f])[\s\S]*?(?:\x1b\\|\x9c|\x07|$)/g;
const CSI_RE = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]?/g;
const ESC_TWO_BYTE_RE = /\x1b[@-Z\\-_]/g;
const CONTROL_AND_BIDI_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/**
 * Strip ALL terminal escape sequences (OSC/DCS/CSI/ESC), newlines, carriage
 * returns, C0/C1 control characters, and bidi overrides from untrusted input,
 * returning strictly single-line plain text.
 */
export function sanitizeTerminalText(raw: unknown, maxLength = 64): string {
    if (typeof raw !== 'string') {
        return '';
    }
    const cleaned = raw
        .replace(OSC_RE, '')
        .replace(DCS_APC_RE, '')
        .replace(CSI_RE, '')
        .replace(ESC_TWO_BYTE_RE, '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(CONTROL_AND_BIDI_RE, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) {
        return '';
    }
    if (maxLength > 1 && cleaned.length > maxLength) {
        return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
    }
    return cleaned;
}

// ─── CLI Argument & Env Parsing ──────────────────────────────────────────────

export function parseStatusLineArgs(
    argv: readonly string[],
    env: NodeJS.ProcessEnv = process.env,
): StatusLineCliOptions {
    const envCurrency = env.ACM_CURRENCY || env.ANTIGRAVITY_CURRENCY || '';
    const envFxRaw = env.ACM_CUSTOM_FX_RATE || '';
    const envFx = envFxRaw.trim() ? Number(envFxRaw.trim()) : null;
    const envBasis = (env.ACM_CONTEXT_BASIS || '').trim().toLowerCase();
    const envNoColor = (env.NO_COLOR !== undefined && env.NO_COLOR !== '')
        || (env.TERM || '').trim().toLowerCase() === 'dumb';
    const envForceColor = env.FORCE_COLOR !== undefined
        && env.FORCE_COLOR !== ''
        && env.FORCE_COLOR !== '0';

    const opts: StatusLineCliOptions = {
        currency: envCurrency ? normalizeCurrencyCode(envCurrency, 'USD') : 'USD',
        customFxRate: isValidCustomFxRate(envFx) ? envFx : null,
        basis: envBasis === 'native' ? 'native' : 'compaction',
        noColor: envNoColor,
        forceColor: envForceColor,
        maxWidth: undefined,
        maxStdinBytes: MAX_STDIN_BYTES,
        timeoutMs: DEFAULT_STDIN_TIMEOUT_MS,
        showTitle: false,
        help: false,
        version: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            opts.help = true;
        } else if (arg === '--version' || arg === '-v') {
            opts.version = true;
        } else if (arg === '--no-color') {
            opts.noColor = true;
            opts.forceColor = false;
        } else if (arg === '--color') {
            opts.forceColor = true;
            opts.noColor = false;
        } else if (arg === '--show-title') {
            opts.showTitle = true;
        } else if (arg === '--currency' && i + 1 < argv.length) {
            opts.currency = normalizeCurrencyCode(argv[++i], 'USD');
        } else if (arg.startsWith('--currency=')) {
            opts.currency = normalizeCurrencyCode(arg.slice('--currency='.length), 'USD');
        } else if (arg === '--fx-rate' && i + 1 < argv.length) {
            const parsed = Number(argv[++i]);
            opts.customFxRate = isValidCustomFxRate(parsed) ? parsed : null;
        } else if (arg.startsWith('--fx-rate=')) {
            const parsed = Number(arg.slice('--fx-rate='.length));
            opts.customFxRate = isValidCustomFxRate(parsed) ? parsed : null;
        } else if (arg === '--basis' && i + 1 < argv.length) {
            const val = argv[++i].trim().toLowerCase();
            opts.basis = val === 'native' ? 'native' : 'compaction';
        } else if (arg.startsWith('--basis=')) {
            const val = arg.slice('--basis='.length).trim().toLowerCase();
            opts.basis = val === 'native' ? 'native' : 'compaction';
        } else if (arg === '--max-width' && i + 1 < argv.length) {
            const parsed = Number(argv[++i]);
            if (Number.isInteger(parsed) && parsed >= 32) {
                opts.maxWidth = parsed;
            }
        } else if (arg.startsWith('--max-width=')) {
            const parsed = Number(arg.slice('--max-width='.length));
            if (Number.isInteger(parsed) && parsed >= 32) {
                opts.maxWidth = parsed;
            }
        } else if (arg === '--timeout-ms' && i + 1 < argv.length) {
            const parsed = Number(argv[++i]);
            if (Number.isFinite(parsed) && parsed >= 50 && parsed <= DEFAULT_STDIN_TIMEOUT_MS) {
                opts.timeoutMs = Math.round(parsed);
            }
        } else if (arg.startsWith('--timeout-ms=')) {
            const parsed = Number(arg.slice('--timeout-ms='.length));
            if (Number.isFinite(parsed) && parsed >= 50 && parsed <= DEFAULT_STDIN_TIMEOUT_MS) {
                opts.timeoutMs = Math.round(parsed);
            }
        }
    }

    return opts;
}

export function shouldUseColor(
    opts: Pick<StatusLineCliOptions, 'noColor' | 'forceColor'>,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    if (opts.noColor) {
        return false;
    }
    if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
        return false;
    }
    if ((env.TERM || '').trim().toLowerCase() === 'dumb') {
        return false;
    }
    // `agy` runs statusLine over a pipe (non-TTY) and natively renders SGR colors
    // unless disabled via NO_COLOR, TERM=dumb, or --no-color.
    return opts.forceColor || true;
}

// ─── Bounded Stdin Reader (64 KB Cap + Timeout) ──────────────────────────────

export function readBoundedStdin(
    stdin: Readable = process.stdin,
    options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<BoundedStdinResult> {
    const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes! > 0
        ? Math.min(MAX_STDIN_BYTES, Math.floor(options.maxBytes!))
        : MAX_STDIN_BYTES;
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs! > 0
        ? Math.min(DEFAULT_STDIN_TIMEOUT_MS, Math.floor(options.timeoutMs!))
        : DEFAULT_STDIN_TIMEOUT_MS;

    return new Promise((resolvePromise) => {
        if ((stdin as NodeJS.ReadStream).isTTY) {
            resolvePromise({ text: '', bytesRead: 0, truncated: false, timedOut: false });
            return;
        }

        const chunks: Buffer[] = [];
        let bytesRead = 0;
        let truncated = false;
        let timedOut = false;
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const finish = () => {
            if (settled) { return; }
            settled = true;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            stdin.removeListener('data', onData);
            stdin.removeListener('end', onEnd);
            stdin.removeListener('error', onError);
            stdin.removeListener('close', onEnd);
            if (truncated || timedOut) {
                try { stdin.pause(); } catch { /* ignore */ }
                try { (stdin as { unref?: () => void }).unref?.(); } catch { /* ignore */ }
            }
            const text = chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : '';
            resolvePromise({ text, bytesRead, truncated, timedOut });
        };

        const onData = (chunk: Buffer | string) => {
            if (settled) { return; }
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
            if (bytesRead + buf.length > maxBytes) {
                const remaining = maxBytes - bytesRead;
                if (remaining > 0) {
                    chunks.push(buf.subarray(0, remaining));
                    bytesRead += remaining;
                }
                truncated = true;
                finish();
                return;
            }
            chunks.push(buf);
            bytesRead += buf.length;
        };

        const onEnd = () => finish();
        const onError = () => finish();

        timer = setTimeout(() => {
            timedOut = true;
            finish();
        }, timeoutMs);
        timer.unref?.();

        stdin.on('data', onData);
        stdin.once('end', onEnd);
        stdin.once('error', onError);
        stdin.once('close', onEnd);
        stdin.resume();
    });
}

// ─── Payload Parsing & Observation Projection ────────────────────────────────

export function parseStatusLinePayload(rawText: string): AgyStatusLinePayload | null {
    if (typeof rawText !== 'string') {
        return null;
    }
    const trimmed = rawText.replace(/^\uFEFF/, '').trim();
    if (!trimmed) {
        return null;
    }
    try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        return parsed as AgyStatusLinePayload;
    } catch {
        return null;
    }
}

function finiteNonNeg(val: unknown): number | null {
    return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : null;
}

function finitePositive(val: unknown): number | null {
    return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : null;
}

/**
 * Project official `agy` stdin telemetry through the shared immutable
 * `buildPublishedMonitorObservation` contract (`src/core/context-display.ts`).
 *
 * Guarantees:
 * - Missing or zero context window limit -> `isIncomplete: true` -> `'—'`.
 * - Missing usage measurement -> `isIncomplete: true` -> `'—'` (NEVER silent App cache).
 * - Confirmed fresh 0-step session -> `isZeroStepFresh: true` -> `'0%'`.
 * - Overflow (`>100%`) preserved in primary percentage text.
 */
export function buildStatusLineObservation(
    payload: AgyStatusLinePayload | null,
    options: { basis?: ContextDisplayBasis } = {},
): PublishedMonitorObservation {
    const requestedBasis: ContextDisplayBasis = options.basis === 'native' ? 'native' : 'compaction';
    if (!payload) {
        return buildPublishedMonitorObservation({
            backendEpoch: 0,
            windowId: 'cli',
            selectionRevision: 0,
            dataRevision: 0,
            requestedBasis,
            isIncomplete: true,
        });
    }

    const cw = payload.context_window && typeof payload.context_window === 'object'
        ? payload.context_window
        : null;
    const conversationId = sanitizeTerminalText(payload.conversation_id || payload.session_id || '', 80) || null;
    const measuredModel = sanitizeTerminalText(payload.model?.display_name || payload.model?.id || '', 64) || null;

    const compactionLimit = finitePositive(cw?.compaction_limit);
    const nativeLimit = finitePositive(cw?.context_window_size);
    const effectiveDenominator = requestedBasis === 'compaction'
        ? (compactionLimit ?? nativeLimit)
        : (nativeLimit ?? compactionLimit);

    let usedTokens: number | null = null;
    let isZeroStepFresh = false;
    let tokenSource: 'gm_usage' | 'tracker_usage' | 'step_estimate' | 'zero_step_fresh' | 'unavailable' = 'unavailable';

    if (cw) {
        const directUsed = finiteNonNeg(cw.used_tokens);
        const currentUsage = cw.current_usage && typeof cw.current_usage === 'object' ? cw.current_usage : null;
        const usedPct = finiteNonNeg(cw.used_percentage);
        const totalIn = finiteNonNeg(cw.total_input_tokens);
        const totalOut = finiteNonNeg(cw.total_output_tokens);

        const hasExplicitFreshZeroEvidence = effectiveDenominator !== null
            && (usedPct === null || usedPct === 0)
            && (totalIn === null || totalIn === 0)
            && (totalOut === null || totalOut === 0)
            && (totalIn === 0 || totalOut === 0 || usedPct === 0 || cw.current_usage === null);

        if (directUsed !== null) {
            usedTokens = Math.round(directUsed);
            tokenSource = 'tracker_usage';
            if (usedTokens === 0 && hasExplicitFreshZeroEvidence) {
                isZeroStepFresh = true;
                tokenSource = 'zero_step_fresh';
            }
        } else if (currentUsage) {
            const curIn = finiteNonNeg(currentUsage.input_tokens);
            const curCacheCreate = finiteNonNeg(currentUsage.cache_creation_input_tokens);
            const curCacheRead = finiteNonNeg(currentUsage.cache_read_input_tokens);
            const hasAnyCurrent = curIn !== null || curCacheCreate !== null || curCacheRead !== null;
            if (hasAnyCurrent) {
                usedTokens = Math.round((curIn ?? 0) + (curCacheCreate ?? 0) + (curCacheRead ?? 0));
                tokenSource = 'gm_usage';
                if (usedTokens === 0 && hasExplicitFreshZeroEvidence) {
                    isZeroStepFresh = true;
                    tokenSource = 'zero_step_fresh';
                }
            }
        }
        if (usedTokens === null && cw.current_usage === null) {
            // Official agy docs: `current_usage` is `null` before the first model response.
            if (
                effectiveDenominator !== null
                && (usedPct === null || usedPct === 0)
                && (totalIn === null || totalIn === 0) && (totalOut === null || totalOut === 0)
                && (usedPct === 0 || totalIn === 0)
            ) {
                usedTokens = 0;
                isZeroStepFresh = true;
                tokenSource = 'zero_step_fresh';
            }
        }
        // agy's used_percentage refers to context_window_size. Switching the
        // display basis must never change the reconstructed token count.
        if (usedTokens === null && usedPct !== null && nativeLimit !== null) {
            usedTokens = Math.round((usedPct / 100) * nativeLimit);
            tokenSource = 'step_estimate';
        }
    }

    const rawCostUsd = payload.cost && typeof payload.cost === 'object'
        ? finiteNonNeg(payload.cost.total_usd)
        : null;

    return buildPublishedMonitorObservation({
        backendEpoch: 0,
        windowId: 'cli',
        rootCascadeId: conversationId,
        subjectCascadeId: conversationId,
        subjectKind: 'main',
        selectionRevision: 0,
        dataRevision: 0,
        measuredModel,
        tokenSource,
        usedTokens,
        compactionLimit,
        compactionLimitProvenance: compactionLimit !== null ? 'ls_metadata' : 'unavailable',
        nativeLimit,
        nativeLimitProvenance: nativeLimit !== null ? 'ls_metadata' : 'unavailable',
        requestedBasis,
        isZeroStepFresh,
        isIncomplete: !isZeroStepFresh && (usedTokens === null || effectiveDenominator === null),
        sessionCostUsd: rawCostUsd,
    });
}

// ─── Formatting Helpers ──────────────────────────────────────────────────────

export function formatCompactTokenCount(tokens: number | null): string {
    if (tokens === null || !Number.isFinite(tokens) || tokens < 0) {
        return UNAVAILABLE_MARKER;
    }
    if (tokens >= 1_000_000) {
        const m = tokens / 1_000_000;
        return `${(m >= 10 ? m.toFixed(0) : m.toFixed(1)).replace(/\.0$/, '')}M`;
    }
    if (tokens >= 1_000) {
        const k = tokens / 1_000;
        return `${(k >= 100 ? k.toFixed(0) : k.toFixed(1)).replace(/\.0$/, '')}k`;
    }
    return String(Math.round(tokens));
}

function extractTightestQuotaPct(payload: AgyStatusLinePayload | null): number | null {
    if (!payload?.quota || typeof payload.quota !== 'object') {
        return null;
    }
    let minPct: number | null = null;
    for (const bucket of Object.values(payload.quota)) {
        if (!bucket || typeof bucket !== 'object' || bucket.disabled === true) {
            continue;
        }
        const frac = bucket.remaining_fraction;
        if (typeof frac === 'number' && Number.isFinite(frac) && frac >= 0 && frac <= 1) {
            const pct = Math.round(frac * 100);
            if (minPct === null || pct < minPct) {
                minPct = pct;
            }
        }
    }
    return minPct;
}

function extractWorkspaceName(payload: AgyStatusLinePayload | null): string {
    if (!payload) { return ''; }
    const rawPath = payload.workspace?.project_dir || payload.workspace?.current_dir || payload.cwd || '';
    const safePath = sanitizeTerminalText(rawPath, 256);
    if (!safePath) { return ''; }
    const stripped = safePath.replace(/[\\/]+$/, '');
    if (!stripped) { return ''; }
    const normalized = stripped.replace(/\\/g, '/');
    const base = basename(normalized);
    return sanitizeTerminalText(base, 28);
}

function countRunningSubagents(payload: AgyStatusLinePayload | null): number {
    if (!Array.isArray(payload?.subagents)) { return 0; }
    let running = 0;
    for (const sub of payload.subagents) {
        if (sub && typeof sub === 'object' && sanitizeTerminalText(sub.status, 16).toLowerCase() === 'running') {
            running += 1;
        }
    }
    return running;
}

const ANSI_RESET = '\x1b[0m';
const ANSI_DIM = '\x1b[2m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';
const ANSI_CYAN = '\x1b[36m';

function paint(text: string, code: string, color: boolean): string {
    return color ? `${code}${text}${ANSI_RESET}` : text;
}

function healthColorCode(status: ContextHealthStatus): string {
    switch (status) {
        case 'overflow':
        case 'high_pressure':
            return ANSI_RED;
        case 'elevated':
            return ANSI_YELLOW;
        case 'healthy':
        case 'fresh':
            return ANSI_GREEN;
        default:
            return ANSI_DIM;
    }
}

/**
 * Format a single-line status bar string from an `agy` stdin JSON payload.
 * Guarantees strictly ONE line with zero embedded newlines and zero unsanitized
 * terminal escape sequences.
 */
export function formatStatusLine(
    payload: AgyStatusLinePayload | null,
    options: StatusLineFormatOptions = {},
): string {
    const color = Boolean(options.color);
    const currencyInput = options.currency ?? 'USD';
    const obs = buildStatusLineObservation(payload, { basis: options.basis });

    const modelName = sanitizeTerminalText(payload?.model?.display_name || payload?.model?.id || '', 32)
        || (payload ? UNAVAILABLE_MARKER : 'ACM');
    const workspaceName = extractWorkspaceName(payload);
    const title = options.showTitle ? sanitizeTerminalText(payload?.conversation_title || '', 28) : '';
    const agentState = sanitizeTerminalText(payload?.agent_state || '', 16).toLowerCase();
    const runningSubagents = countRunningSubagents(payload);
    const quotaPct = extractTightestQuotaPct(payload);

    // Context segment (always explicit `—` when missing/incomplete)
    const pctText = formatObservationPrimaryPct(obs);
    let ctxSegment: string;
    if (obs.isIncomplete) {
        ctxSegment = `Ctx ${UNAVAILABLE_MARKER}`;
    } else if (obs.isZeroStepFresh) {
        const lim = formatCompactTokenCount(obs.primaryLimit);
        ctxSegment = obs.primaryLimit ? `Ctx 0% (0/${lim})` : 'Ctx 0%';
    } else {
        const usedStr = formatCompactTokenCount(obs.usedTokens);
        const limStr = formatCompactTokenCount(obs.primaryLimit);
        ctxSegment = `Ctx ${pctText} (${usedStr}/${limStr})`;
    }

    // Cost segment (uses 10-currency contract; explicit `—` when cost is absent!)
    const rawCostUsd = payload?.cost && typeof payload.cost === 'object'
        ? finiteNonNeg(payload.cost.total_usd)
        : null;
    const costFormatted = rawCostUsd !== null
        ? formatCurrencyAmount(rawCostUsd, currencyInput, { mode: 'compact' })
        : UNAVAILABLE_MARKER;
    const costSegment = rawCostUsd !== null ? costFormatted : `Cost ${UNAVAILABLE_MARKER}`;

    const segments: string[] = [];
    segments.push(paint(modelName, ANSI_BOLD, color));
    segments.push(paint(ctxSegment, healthColorCode(obs.healthStatus), color));
    segments.push(paint(costSegment, rawCostUsd !== null ? ANSI_CYAN : ANSI_DIM, color));

    if (quotaPct !== null) {
        const qColor = quotaPct <= 20 ? ANSI_RED : (quotaPct <= 40 ? ANSI_YELLOW : ANSI_GREEN);
        segments.push(paint(`Q ${quotaPct}%`, qColor, color));
    }

    if (payload?.exceeds_200k_tokens === true) {
        segments.push(paint('200k+', ANSI_YELLOW, color));
    }

    if (runningSubagents > 0) {
        segments.push(paint(`sub:${runningSubagents}`, ANSI_CYAN, color));
    }

    if (agentState === 'error') {
        segments.push(paint('ERR', ANSI_RED, color));
    } else if (agentState === 'working' || agentState === 'tool_use') {
        segments.push(paint(agentState === 'tool_use' ? 'TOOL' : 'RUN', ANSI_CYAN, color));
    }

    if (workspaceName) {
        segments.push(paint(workspaceName, ANSI_DIM, color));
    }

    if (title) {
        segments.push(paint(title, ANSI_DIM, color));
    }

    if (options.truncatedInput) {
        segments.push(paint('[truncated]', ANSI_YELLOW, color));
    }

    const sep = paint(' | ', ANSI_DIM, color);
    let line = segments.join(sep);

    // Respect optional maxWidth (only trim trailing optional segments cleanly; never corrupt ANSI escapes)
    const effectiveMaxWidth = typeof options.maxWidth === 'number' && Number.isFinite(options.maxWidth) && options.maxWidth >= 32
        ? Math.floor(options.maxWidth)
        : (typeof payload?.terminal_width === 'number' && Number.isFinite(payload.terminal_width) && payload.terminal_width >= 32
            ? Math.floor(payload.terminal_width)
            : undefined);

    if (effectiveMaxWidth !== undefined) {
        const visibleLen = (s: string) => s.replace(CSI_RE, '').length;
        const active = [...segments];
        while (active.length > 3 && visibleLen(active.join(sep)) > effectiveMaxWidth) {
            active.pop();
        }
        line = active.join(sep);
    }

    // Hard final single-line invariant: never emit embedded CR/LF
    return line.replace(/[\r\n]+/g, ' ');
}

function formatHelpText(): string {
    return [
        'Antigravity Context Monitor — Opt-In Read-Only `agy` CLI Status Line',
        '',
        'Usage:',
        '  agy-statusline.mjs [--currency <USD|CNY|EUR|JPY|GBP|KRW|HKD|TWD|CAD|AUD>] [--fx-rate <n>]',
        '                     [--basis <compaction|native>] [--no-color | --color] [--show-title]',
        '                     [--max-width <cols>] [--timeout-ms <ms>] [--version] [--help]',
        '',
        'Reads official `agy` CLI statusLine JSON from stdin (64 KB cap, 1500 ms timeout) and',
        'prints strictly one sanitized status line. Configure in ~/.gemini/antigravity-cli/settings.json.',
    ].join('\n');
}

function writeLineHandlingEpipe(stdout: Writable, text: string): Promise<number> {
    return new Promise((resolvePromise) => {
        let settled = false;
        const cleanup = () => {
            stdout.removeListener('error', onError);
        };
        const done = (code: number, hadError: boolean) => {
            if (settled) { return; }
            settled = true;
            if (hadError) {
                // Node Writable emits 'error' on nextTick after invoking write(cb) with an error;
                // keep onError attached through the tick so EPIPE never escapes as uncaught.
                setImmediate(cleanup);
            } else {
                cleanup();
            }
            resolvePromise(code);
        };
        const onError = (err: NodeJS.ErrnoException) => {
            cleanup();
            if (err && err.code === 'EPIPE') {
                done(0, false);
                return;
            }
            done(1, false);
        };
        stdout.on('error', onError);
        try {
            stdout.write(`${text}\n`, (err?: Error | null) => {
                if (err && (err as NodeJS.ErrnoException).code === 'EPIPE') {
                    done(0, true);
                    return;
                }
                done(err ? 1 : 0, Boolean(err));
            });
        } catch (err) {
            if (err && typeof err === 'object' && (err as NodeJS.ErrnoException).code === 'EPIPE') {
                done(0, true);
                return;
            }
            done(1, true);
        }
    });
}

export async function runStatusLineCli(options: {
    argv?: readonly string[];
    env?: NodeJS.ProcessEnv;
    stdin?: Readable;
    stdout?: Writable;
} = {}): Promise<number> {
    const argv = options.argv ?? process.argv.slice(2);
    const env = options.env ?? process.env;
    const stdin = options.stdin ?? process.stdin;
    const stdout = options.stdout ?? process.stdout;

    const cliOpts = parseStatusLineArgs(argv, env);
    if (cliOpts.help) {
        return writeLineHandlingEpipe(stdout, formatHelpText());
    }
    if (cliOpts.version) {
        const ver = resolveRuntimeVersion({ fallbackVersion: FALLBACK_APP_VERSION });
        return writeLineHandlingEpipe(stdout, `agy-statusline ${ver}`);
    }

    const input = await readBoundedStdin(stdin, {
        maxBytes: cliOpts.maxStdinBytes,
        timeoutMs: cliOpts.timeoutMs,
    });
    const payload = input.truncated ? null : parseStatusLinePayload(input.text);
    const currencyConfig: CurrencyConfig = {
        code: cliOpts.currency ?? 'USD',
        ...(cliOpts.customFxRate !== null && cliOpts.customFxRate !== undefined
            ? { customRatePerUsd: cliOpts.customFxRate, customFxCurrency: cliOpts.currency ?? 'USD' }
            : {}),
    };
    const line = formatStatusLine(payload, {
        currency: currencyConfig,
        basis: cliOpts.basis,
        color: shouldUseColor(cliOpts, env),
        maxWidth: cliOpts.maxWidth,
        showTitle: cliOpts.showTitle,
        truncatedInput: input.truncated,
    });

    return writeLineHandlingEpipe(stdout, line);
}

if (isDirectExecution()) {
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
        if (err && err.code === 'EPIPE') {
            process.exit(0);
        }
    });
    runStatusLineCli()
        .then((exitCode) => {
            process.exitCode = exitCode;
        })
        .catch(() => {
            // Never stall or trigger agy's 30-failure statusLine disablement on unexpected I/O error
            try {
                process.stdout.write(`ACM | Ctx ${UNAVAILABLE_MARKER} | Cost ${UNAVAILABLE_MARKER}\n`);
            } catch {
                // ignore broken pipe
            }
            process.exitCode = 0;
        });
}

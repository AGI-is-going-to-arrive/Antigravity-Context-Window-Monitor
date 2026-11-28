// ─── RPC Client ──────────────────────────────────────────────────────────────
// Extracted from tracker.ts for single-responsibility.
// Generic Connect-RPC caller for Antigravity Language Server communication.

import { withTrajectoryRpcSlot } from './core/swarm-registry';
import * as https from 'https';
import * as http from 'http';
import * as zlib from 'zlib';
import { LSInfo } from './discovery';
import { MAX_RESPONSE_BODY_SIZE } from './constants';

const DEFAULT_RPC_TIMEOUT_MS = 10000;
const AGENT_KEEP_ALIVE_MS = 1000;
const AGENT_IDLE_SOCKET_TIMEOUT_MS = 15000;
const AGENT_MAX_SOCKETS = 16;
const AGENT_MAX_FREE_SOCKETS = 4;
const DEFAULT_ERROR_EXCERPT_MAX_CHARS = 200;
const REDACTION_SCAN_MAX_CHARS = 8192;

/** Resolve the destination before attaching a host credential. Avoid DNS even for localhost. */
export function resolveLoopbackRpcHostname(hostname?: string): string {
    if (hostname === undefined || hostname === '127.0.0.1' || hostname.toLowerCase() === 'localhost') {
        return '127.0.0.1';
    }
    if (hostname === '::1' || hostname === '[::1]') { return '::1'; }
    throw new Error('Language server RPC requires a loopback destination');
}

const JSON_SENSITIVE_FIELD_RE = /("(?:x-codeium-csrf-token|x-csrf-token|csrf[_-]?token|csrfToken|authorization|proxy-authorization|x-api-key|api[_-]?key|apiKey|access[_-]?token|accessToken|refresh[_-]?token|refreshToken|id[_-]?token|idToken|session[_-]?token|sessionToken|auth[_-]?token|authToken|client[_-]?secret|clientSecret|password|passwd|secret|token|cookie|set-cookie|private[_-]?key|privateKey)"\s*:\s*)(?:"(?:\\.|[^"\\])*"|[^,\s}\]]+)/gi;
const COOKIE_HEADER_RE = /(\b(?:set-cookie|cookie)\s*:\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\r\n]+)/gi;
const COOKIE_KV_RE = /(\b(?:set-cookie|cookie)\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s&}\]]+(?:\s*;\s*[^\s&}\]]+)*)/gi;
const HEADER_OR_KV_SECRET_RE = /((?:x-codeium-csrf-token|x-csrf-token|csrf[_-]?token|authorization|proxy-authorization|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)\s*[:=]\s*)(?:(?:Bearer|Basic|Token)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;
const BEARER_OR_BASIC_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const QUERY_SECRET_RE = /([?&](?:token|access_token|refresh_token|id_token|api_key|apikey|key|secret|csrf|csrf_token|auth|password|session)=)[^&\s"'<>]+/gi;
const URL_USERINFO_RE = /(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g;
const OAUTH_OR_PROVIDER_KEY_RE = /\b(?:ya29\.[A-Za-z0-9._-]{12,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g;
const PEM_PRIVATE_KEY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeTruncateText(text: string, maxChars: number): string {
    const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : DEFAULT_ERROR_EXCERPT_MAX_CHARS;
    if (text.length <= limit) { return text; }
    if (limit <= 3) { return text.slice(0, limit); }
    let cut = limit - 3;
    // Avoid splitting a UTF-16 surrogate pair at the truncation boundary.
    const lastCode = text.charCodeAt(cut - 1);
    if (lastCode >= 0xD800 && lastCode <= 0xDBFF && cut > 1) {
        cut -= 1;
    }
    // Avoid leaving a half-truncated [REDACTED...] placeholder at the tail.
    const openBracket = text.lastIndexOf('[REDACTED', cut - 1);
    if (openBracket >= 0) {
        const closeBracket = text.indexOf(']', openBracket);
        if (closeBracket >= cut && openBracket > 0) {
            cut = openBracket;
        }
    }
    return `${text.slice(0, cut).trimEnd()}...`;
}

/**
 * Redact sensitive tokens, auth headers, credentials, and known runtime secrets from
 * raw transport response excerpts or error messages, strip control/newline injection
 * characters, and safely truncate before logging or surfacing.
 */
export function redactRpcErrorExcerpt(
    raw: string,
    options?: { maxLength?: number; knownSecrets?: readonly (string | null | undefined)[] },
): string {
    if (!raw) { return ''; }
    const maxLength = options?.maxLength ?? DEFAULT_ERROR_EXCERPT_MAX_CHARS;
    // Scan a bounded prefix before truncation so secrets straddling `maxLength` are fully redacted.
    const scanLimit = Math.max(REDACTION_SCAN_MAX_CHARS, maxLength * 8);
    const wasLonger = raw.length > scanLimit;
    let out = wasLonger ? raw.slice(0, scanLimit) : raw;

    out = out.replace(PEM_PRIVATE_KEY_RE, '[REDACTED_PRIVATE_KEY]');

    // Scrub exact runtime secrets (e.g. local loopback CSRF token) in raw and URL-encoded forms.
    if (options?.knownSecrets) {
        for (const candidate of options.knownSecrets) {
            const secret = typeof candidate === 'string' ? candidate.trim() : '';
            if (secret.length < 4) { continue; }
            const variants = new Set<string>([secret]);
            try {
                const encoded = encodeURIComponent(secret);
                if (encoded !== secret) { variants.add(encoded); }
            } catch {
                // Ignore encoding errors
            }
            for (const variant of variants) {
                const flags = variant.length >= 8 ? 'gi' : 'g';
                out = out.replace(new RegExp(escapeRegExp(variant), flags), '[REDACTED]');
            }
        }
    }

    out = out
        .replace(JSON_SENSITIVE_FIELD_RE, '$1"[REDACTED]"')
        .replace(COOKIE_HEADER_RE, '$1[REDACTED]')
        .replace(COOKIE_KV_RE, '$1[REDACTED]')
        .replace(HEADER_OR_KV_SECRET_RE, '$1[REDACTED]')
        .replace(BEARER_OR_BASIC_RE, '$1 [REDACTED]')
        .replace(QUERY_SECRET_RE, '$1[REDACTED]')
        .replace(URL_USERINFO_RE, '$1[REDACTED]@')
        .replace(JWT_RE, '[REDACTED_JWT]')
        .replace(OAUTH_OR_PROVIDER_KEY_RE, '[REDACTED_KEY]');

    // Neutralize control characters and collapse newlines/tabs to prevent log injection.
    out = out
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (wasLonger && out.length <= maxLength) {
        return safeTruncateText(`${out}...`, maxLength);
    }
    return safeTruncateText(out, maxLength);
}

function sanitizeTransportError(err: unknown, knownSecrets?: readonly (string | null | undefined)[]): Error {
    const rawMessage = err instanceof Error ? err.message : String(err ?? 'Unknown RPC error');
    const redacted = redactRpcErrorExcerpt(rawMessage, { maxLength: 300, knownSecrets });
    const sanitized = new Error(redacted || 'RPC transport error');
    if (err && typeof err === 'object' && 'code' in err && typeof (err as { code?: unknown }).code === 'string') {
        (sanitized as NodeJS.ErrnoException).code = (err as NodeJS.ErrnoException).code;
    }
    return sanitized;
}

let sharedHttpAgent: http.Agent | null = null;
let sharedHttpsAgent: https.Agent | null = null;

function createKeepAliveHttpAgent(): http.Agent {
    const agent = new http.Agent({
        keepAlive: true,
        keepAliveMsecs: AGENT_KEEP_ALIVE_MS,
        maxSockets: AGENT_MAX_SOCKETS,
        maxFreeSockets: AGENT_MAX_FREE_SOCKETS,
        timeout: AGENT_IDLE_SOCKET_TIMEOUT_MS,
    });
    // Ensure idle pooled sockets never prevent Node.js / test runners from exiting cleanly.
    agent.on('free', (socket) => {
        socket.unref?.();
    });
    return agent;
}

function createKeepAliveHttpsAgent(): https.Agent {
    const agent = new https.Agent({
        keepAlive: true,
        keepAliveMsecs: AGENT_KEEP_ALIVE_MS,
        maxSockets: AGENT_MAX_SOCKETS,
        maxFreeSockets: AGENT_MAX_FREE_SOCKETS,
        timeout: AGENT_IDLE_SOCKET_TIMEOUT_MS,
        rejectUnauthorized: false,
    });
    agent.on('free', (socket) => {
        socket.unref?.();
    });
    return agent;
}

/** Return the shared keep-alive HTTP/HTTPS agent used for unary Connect-RPC calls. */
export function getRpcAgent(useTls: boolean): http.Agent | https.Agent {
    if (useTls) {
        if (!sharedHttpsAgent) {
            sharedHttpsAgent = createKeepAliveHttpsAgent();
        }
        return sharedHttpsAgent;
    }
    if (!sharedHttpAgent) {
        sharedHttpAgent = createKeepAliveHttpAgent();
    }
    return sharedHttpAgent;
}

/** Destroy all pooled keep-alive RPC sockets (useful on deactivation or test teardown). */
export function destroyRpcAgents(): void {
    if (sharedHttpAgent) {
        sharedHttpAgent.destroy();
        sharedHttpAgent = null;
    }
    if (sharedHttpsAgent) {
        sharedHttpsAgent.destroy();
        sharedHttpsAgent = null;
    }
}

export interface RpcCallOptions {
    /** Optional per-request response byte cap (clamped to `<= MAX_RESPONSE_BODY_SIZE`). */
    maxResponseBytes?: number;
}

/**
 * Generic Connect-RPC caller.
 * - Reuses keep-alive HTTP/HTTPS agents with unref'd idle sockets.
 * - Collects raw Buffer chunks and decodes UTF-8 once via Buffer.concat to prevent
 *   multibyte character corruption across TCP chunk boundaries.
 * - Enforces a unified hard wall-clock timeout in addition to socket idle timeout.
 * - Checks HTTP status code — non-2xx responses are rejected.
 * - Supports AbortSignal for cancellation on extension deactivate.
 * - Guards against abnormally large responses (50 MB limit, or caller-specified lower cap).
 * - Uses `settled` flag to prevent double resolve/reject from abort + error overlap.
 */
export function rpcCall(
    ls: LSInfo,
    endpoint: string,
    body: Record<string, unknown>,
    timeoutMs: number = DEFAULT_RPC_TIMEOUT_MS,
    signal?: AbortSignal,
    options?: RpcCallOptions,
): Promise<Record<string, unknown>> {
    return withTrajectoryRpcSlot(
        endpoint,
        timeoutMs,
        (timeout, consumeBytes) => requestRpc(ls, endpoint, body, timeout, signal, consumeBytes, options?.maxResponseBytes),
    );
}

function requestRpc(
    ls: LSInfo, endpoint: string, body: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal,
    consumeBytes?: (count: number) => boolean,
    maxResponseBytes?: number,
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        // Early abort check
        if (signal?.aborted) {
            reject(new Error('RPC aborted'));
            return;
        }

        const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
            ? timeoutMs
            : DEFAULT_RPC_TIMEOUT_MS;
        const effectiveMaxBytes = typeof maxResponseBytes === 'number'
            && Number.isFinite(maxResponseBytes)
            && maxResponseBytes > 0
            ? Math.min(Math.floor(maxResponseBytes), MAX_RESPONSE_BODY_SIZE)
            : MAX_RESPONSE_BODY_SIZE;

        let settled = false;
        let onAbort: (() => void) | undefined;
        let timer: NodeJS.Timeout | undefined;
        const cleanup = () => {
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }
            if (onAbort && signal) {
                signal.removeEventListener('abort', onAbort);
                onAbort = undefined;
            }
        };
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
        const useTls = Boolean(ls.useTls);

        const options: https.RequestOptions = {
            hostname: resolveLoopbackRpcHostname(ls.hostname),
            port: ls.port,
            path: `/exa.language_server_pb.LanguageServerService/${endpoint}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Connect-Protocol-Version': '1',
                'x-codeium-csrf-token': ls.csrfToken,
                'Content-Length': Buffer.byteLength(postData),
                'Connection': 'keep-alive',
            },
            agent: getRpcAgent(useTls),
            timeout: effectiveTimeoutMs,
            rejectUnauthorized: false,
        };

        const knownSecrets = [ls.csrfToken];
        const transport = useTls ? https : http;
        const req = transport.request(options, (res) => {
            const chunks: Buffer[] = [];
            let bodySize = 0;
            res.on('error', (e) => {
                chunks.length = 0;
                safeReject(sanitizeTransportError(e, knownSecrets));
            });
            res.on('data', (chunk: Buffer | string) => {
                if (settled) { return; }
                const chunkBuf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
                bodySize += chunkBuf.length;
                if (bodySize > effectiveMaxBytes) {
                    chunks.length = 0;
                    safeReject(new Error(`RPC response exceeded ${effectiveMaxBytes} bytes`));
                    req.destroy();
                    return;
                }
                if (consumeBytes && !consumeBytes(chunkBuf.length)) {
                    chunks.length = 0;
                    safeReject(new Error('Trajectory poll byte budget exhausted'));
                    req.destroy();
                    return;
                }
                chunks.push(chunkBuf);
            });
            res.on('end', () => {
                if (settled) { return; }
                const data = Buffer.concat(chunks, bodySize).toString('utf8');
                chunks.length = 0;
                if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
                    const excerpt = redactRpcErrorExcerpt(data, {
                        maxLength: DEFAULT_ERROR_EXCERPT_MAX_CHARS,
                        knownSecrets,
                    });
                    safeReject(new Error(`RPC HTTP ${res.statusCode}: ${excerpt}`));
                    return;
                }
                try {
                    safeResolve(JSON.parse(data) as Record<string, unknown>);
                } catch {
                    const excerpt = redactRpcErrorExcerpt(data, {
                        maxLength: DEFAULT_ERROR_EXCERPT_MAX_CHARS,
                        knownSecrets,
                    });
                    safeReject(new Error(`Failed to parse RPC response: ${excerpt}`));
                }
            });
            res.on('close', () => {
                chunks.length = 0;
                if (!settled && !res.complete) {
                    safeReject(new Error('RPC response closed prematurely'));
                }
            });
        });

        // Hard wall-clock deadline so slow-dribbled or hung responses always abort on time.
        timer = setTimeout(() => {
            safeReject(new Error('RPC timeout'));
            req.destroy();
        }, effectiveTimeoutMs);
        timer.unref?.();

        req.on('error', (e) => { safeReject(sanitizeTransportError(e, knownSecrets)); });
        req.on('timeout', () => { safeReject(new Error('RPC timeout')); req.destroy(); });

        // Abort listener — destroy the request on signal abort
        if (signal) {
            onAbort = () => {
                safeReject(new Error('RPC aborted'));
                req.destroy();
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }

        req.write(postData);
        req.end();
    });
}

// ─── Connect Server-Streaming First Frame ────────────────────────────────────

export type ConnectFrameDecodeResult =
    | { done: false }
    | { done: true; endStream: boolean; payload: Record<string, unknown> };

/**
 * Decode the first Connect envelope frame from an accumulated byte buffer.
 * Envelope layout: [1-byte flags][4-byte big-endian payload length][payload].
 * Flags: bit 0 (0x01) = gzip compressed, bit 1 (0x02) = end-of-stream trailer.
 */
export function decodeConnectFirstFrame(
    buf: Buffer,
    knownSecrets?: readonly (string | null | undefined)[],
): ConnectFrameDecodeResult {
    if (buf.length < 5) {
        return { done: false };
    }
    const flags = buf[0];
    const frameLen = buf.readUInt32BE(1);
    if (frameLen > MAX_RESPONSE_BODY_SIZE) {
        throw new Error(`Connect stream frame exceeded ${MAX_RESPONSE_BODY_SIZE} bytes`);
    }
    if (buf.length < 5 + frameLen) {
        return { done: false };
    }
    let frameBytes = buf.subarray(5, 5 + frameLen);
    if ((flags & 0x01) !== 0) {
        frameBytes = zlib.gunzipSync(frameBytes, { maxOutputLength: MAX_RESPONSE_BODY_SIZE });
    }
    const text = frameBytes.toString('utf8');
    let parsed: unknown;
    try {
        parsed = JSON.parse(text) as unknown;
    } catch {
        const excerpt = redactRpcErrorExcerpt(text, {
            maxLength: DEFAULT_ERROR_EXCERPT_MAX_CHARS,
            knownSecrets,
        });
        throw new Error(`Failed to parse Connect stream payload: ${excerpt}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        const excerpt = redactRpcErrorExcerpt(text, {
            maxLength: DEFAULT_ERROR_EXCERPT_MAX_CHARS,
            knownSecrets,
        });
        throw new Error(`Unexpected Connect stream payload: ${excerpt}`);
    }
    return {
        done: true,
        endStream: (flags & 0x02) !== 0,
        payload: parsed as Record<string, unknown>,
    };
}

/**
 * Perform a Connect server-streaming RPC (`application/connect+json`), decode
 * the first data frame, and immediately tear down the stream so no socket leaks.
 */
export function rpcStreamFirstFrame(
    ls: LSInfo,
    endpoint: string,
    body: Record<string, unknown> = {},
    timeoutMs: number = 5000,
    signal?: AbortSignal,
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error('RPC stream aborted'));
            return;
        }

        let settled = false;
        let onAbort: (() => void) | undefined;
        let timer: NodeJS.Timeout | undefined;
        const cleanup = () => {
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }
            if (onAbort && signal) {
                signal.removeEventListener('abort', onAbort);
                onAbort = undefined;
            }
        };
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

        const msgBytes = Buffer.from(JSON.stringify(body), 'utf8');
        const frame = Buffer.alloc(5 + msgBytes.length);
        frame[0] = 0;
        frame.writeUInt32BE(msgBytes.length, 1);
        msgBytes.copy(frame, 5);

        const options: https.RequestOptions = {
            hostname: resolveLoopbackRpcHostname(ls.hostname),
            port: ls.port,
            path: `/exa.language_server_pb.LanguageServerService/${endpoint}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/connect+json',
                'Connect-Protocol-Version': '1',
                'x-codeium-csrf-token': ls.csrfToken,
                'Content-Length': frame.length,
            },
            timeout: timeoutMs,
            rejectUnauthorized: false,
        };

        const knownSecrets = [ls.csrfToken];
        const transport = ls.useTls ? https : http;
        const req = transport.request(options, (res) => {
            res.on('error', (err) => {
                safeReject(sanitizeTransportError(err, knownSecrets));
            });
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
                const errChunks: Buffer[] = [];
                let errBytes = 0;
                res.on('data', (chunk: Buffer | string) => {
                    if (errBytes < REDACTION_SCAN_MAX_CHARS) {
                        const chunkBuf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
                        const slice = chunkBuf.subarray(0, REDACTION_SCAN_MAX_CHARS - errBytes);
                        errChunks.push(slice);
                        errBytes += slice.length;
                    }
                });
                res.on('end', () => {
                    const errBody = Buffer.concat(errChunks, errBytes).toString('utf8');
                    const excerpt = redactRpcErrorExcerpt(errBody, {
                        maxLength: DEFAULT_ERROR_EXCERPT_MAX_CHARS,
                        knownSecrets,
                    });
                    safeReject(new Error(`RPC stream HTTP ${status}: ${excerpt}`));
                    req.destroy();
                });
                return;
            }

            let acc: Buffer = Buffer.alloc(0);
            res.on('data', (chunk: Buffer | string) => {
                if (settled) { return; }
                const chunkBuf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
                if (acc.length + chunkBuf.length > MAX_RESPONSE_BODY_SIZE) {
                    safeReject(new Error(`RPC stream response exceeded ${MAX_RESPONSE_BODY_SIZE} bytes`));
                    req.destroy();
                    return;
                }
                acc = acc.length === 0 ? chunkBuf : Buffer.concat([acc, chunkBuf]);
                try {
                    const decoded = decodeConnectFirstFrame(acc, knownSecrets);
                    if (!decoded.done) { return; }
                    if (decoded.endStream) {
                        const errObj = decoded.payload.error as Record<string, unknown> | undefined;
                        const rawMsg = typeof errObj?.message === 'string'
                            ? errObj.message
                            : typeof errObj?.code === 'string'
                                ? errObj.code
                                : 'Empty Connect stream';
                        const msg = redactRpcErrorExcerpt(rawMsg, {
                            maxLength: DEFAULT_ERROR_EXCERPT_MAX_CHARS,
                            knownSecrets,
                        }) || 'Empty Connect stream';
                        safeReject(new Error(`RPC stream ended without data: ${msg}`));
                        req.destroy();
                        return;
                    }
                    safeResolve(decoded.payload);
                    req.destroy();
                } catch (err) {
                    safeReject(sanitizeTransportError(err, knownSecrets));
                    req.destroy();
                }
            });

            res.on('end', () => {
                if (!settled) {
                    safeReject(new Error('RPC stream closed before first frame'));
                }
            });
        });

        // Hard wall-clock deadline because socket idle timeout alone won't fire
        // if a server dribbles partial bytes or pauses after headers.
        timer = setTimeout(() => {
            safeReject(new Error('RPC stream timeout'));
            req.destroy();
        }, timeoutMs);

        req.on('error', (e) => { safeReject(sanitizeTransportError(e, knownSecrets)); });
        req.on('timeout', () => { safeReject(new Error('RPC stream timeout')); req.destroy(); });

        if (signal) {
            onAbort = () => {
                safeReject(new Error('RPC stream aborted'));
                req.destroy();
            };
            signal.addEventListener('abort', onAbort, { once: true });
        }

        req.write(frame);
        req.end();
    });
}

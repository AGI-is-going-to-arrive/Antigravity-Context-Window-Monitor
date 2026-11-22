/**
 * Antigravity App Sidecar HTTP/API router and standalone loopback server.
 *
 * Pure Node/TypeScript — zero `vscode` imports, zero external npm dependencies.
 * Works seamlessly both inside Antigravity App's `SidecarApp` (`sidecar_sdk`)
 * and as a standalone `127.0.0.1` HTTP server for headless testing / debugging.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import type * as net from 'net';
import * as path from 'path';
import { getHostBridgeScript, type HostBridgeOptions } from './host-bridge';
import { getThemeAdapterStyles } from './theme-adapter';
import type {
    SidecarActionRequest,
    SidecarActionResponse,
    SidecarHealthResponse,
    SidecarProvider,
    SidecarRenderContext,
    SidecarSnapshotPayload,
    SidecarSnapshotQuery,
    SidecarSnapshotResponse,
    SidecarViewMode,
} from './sidecar-types';

export const MAX_ACTION_BODY_BYTES = 256 * 1024;
export const DEFAULT_SIDECAR_VERSION = '1.17.5';
export const ALLOWED_IMAGE_FILENAME_RE = /^[a-z0-9-]+\.png$/;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const IMAGE_ROUTE_RE = /^\/assets\/images\/([a-z0-9-]+\.png)$/;

export interface SidecarHandlerOptions {
    /** Plugin version returned by /api/health and passed to renderHtml. */
    version?: string;
    /** True when hosted by Antigravity App's SidecarApp (injects `/preload.js`). */
    isSidecarEnv?: boolean;
    /** Optional overrides for the injected host bridge script. */
    hostBridgeOptions?: HostBridgeOptions;
    /** Optional override directory containing bundled offline PNG illustrations. */
    imagesDir?: string;
}

export interface RenderedPageResult {
    status: number;
    contentType: string;
    body: string;
    headers: Record<string, string>;
}

export interface AssetImageResult {
    status: number;
    contentType: string;
    body: Buffer | string;
    headers: Record<string, string>;
}

export type SidecarSnapshotHttpBody =
    | { unchanged: true; hash: string }
    | {
        unchanged: false;
        hash: string;
        snapshot: SidecarSnapshotPayload;
        data?: unknown;
        html?: string;
    };

export type SidecarActionHttpBody = SidecarActionResponse & {
    text?: string;
    copiedHint?: string;
};

export interface SidecarHandler {
    renderPage(viewMode: SidecarViewMode, rawUrl?: string): Promise<RenderedPageResult>;
    handleSnapshotQuery(
        query: Record<string, string | string[] | undefined>,
        ifNoneMatch?: string,
    ): Promise<{ status: number; headers: Record<string, string>; body: SidecarSnapshotHttpBody }>;
    handleActionPayload(rawBody: unknown): Promise<{ status: number; body: SidecarActionHttpBody }>;
    handleAssetImage(filename: string): Promise<AssetImageResult>;
    listAssetImages(): string[];
    getHealth(): SidecarHealthResponse;
    handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void>;
}

export interface StandaloneServerOptions {
    port?: number;
    host?: string;
    version?: string;
    hostBridgeOptions?: HostBridgeOptions;
    imagesDir?: string;
}

export interface StandaloneServerHandle {
    server: http.Server;
    host: string;
    port: number;
    url: string;
    close(): Promise<void>;
}

/** Resolve the bundled static PNG images directory across TS source, repo `out/`, and packaged plugin layouts. */
export function resolveDefaultImagesDir(explicitDir?: string): string | null {
    const candidates: string[] = [];
    if (explicitDir && explicitDir.trim()) {
        candidates.push(path.resolve(explicitDir));
    }
    candidates.push(
        path.resolve(__dirname, '..', 'images'),
        path.resolve(__dirname, '..', '..', 'src', 'images'),
        path.resolve(__dirname, '..', '..', 'images'),
    );
    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
                return candidate;
            }
        } catch {
            // Try next candidate
        }
    }
    return null;
}

/** Deterministic canonical JSON stringification so ETag hashes are stable regardless of key order. */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return '[' + value.map(item => (item === undefined ? 'null' : stableStringify(item))).join(',') + ']';
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') + '}';
}

/** Compute a strong deterministic content hash for snapshot ETag comparison. */
export function computeSnapshotHash(snapshot: unknown): string {
    return crypto.createHash('sha256').update(stableStringify(snapshot)).digest('hex').slice(0, 32);
}

function normalizeEtag(raw: string | undefined): string {
    if (!raw || typeof raw !== 'string') { return ''; }
    let trimmed = raw.trim();
    if (trimmed.startsWith('W/')) { trimmed = trimmed.slice(2).trim(); }
    if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
        trimmed = trimmed.slice(1, -1);
    }
    return trimmed;
}

function firstString(value: string | string[] | undefined): string | undefined {
    if (typeof value === 'string') { return value; }
    if (Array.isArray(value) && typeof value[0] === 'string') { return value[0]; }
    return undefined;
}

function parseWorkspaceUrisParam(raw: string | undefined): string[] | undefined {
    if (!raw) { return undefined; }
    const trimmed = raw.trim();
    if (!trimmed) { return undefined; }
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
            }
        } catch {
            // Fall through to comma-split fallback
        }
    }
    const items = trimmed.split(',').map(s => s.trim()).filter(Boolean);
    return items.length > 0 ? items : undefined;
}

function parseViewMode(raw: string | undefined, fallback: SidecarViewMode): SidecarViewMode {
    if (raw === 'aux' || raw === 'sidebar' || raw === 'standalone') {
        return raw;
    }
    return fallback;
}

/**
 * Injects Antigravity Sidecar `/preload.js` (when in sidecar mode), the
 * theme-adapter stylesheet, and the host-bridge script into an HTML document,
 * and stamps `data-acm-surface` / `data-acm-view` onto `<body>`.
 */
export function injectSidecarHeadAndScripts(
    html: string,
    opts: {
        isSidecarEnv: boolean;
        viewMode: SidecarViewMode;
        hostBridgeScript?: string;
        themeAdapterCss?: string;
    },
): string {
    let out = html;
    const themeCss = opts.themeAdapterCss ?? getThemeAdapterStyles();
    const bridgeJs = opts.hostBridgeScript ?? getHostBridgeScript();

    const headSnippets: string[] = [];
    if (opts.isSidecarEnv && !out.includes('src="/preload.js"')) {
        headSnippets.push('<script src="/preload.js"></script>');
    }
    if (!out.includes('data-acm-theme-adapter')) {
        headSnippets.push(`<style data-acm-theme-adapter="true">\n${themeCss}\n</style>`);
    }
    if (!out.includes('data-acm-host-bridge')) {
        headSnippets.push(`<script data-acm-host-bridge="true">\n${bridgeJs}\n</script>`);
    }

    if (headSnippets.length > 0) {
        const injection = headSnippets.join('\n');
        if (/<\/head>/i.test(out)) {
            out = out.replace(/<\/head>/i, `${injection}\n</head>`);
        } else if (/<body[\s>]/i.test(out)) {
            out = out.replace(/<body([\s>])/i, `${injection}\n<body$1`);
        } else {
            out = `${injection}\n${out}`;
        }
    }

    if (/<body([^>]*)>/i.test(out)) {
        out = out.replace(/<body([^>]*)>/i, (full, attrs: string) => {
            let nextAttrs = attrs;
            if (!/data-acm-surface=/i.test(nextAttrs)) {
                nextAttrs += ' data-acm-surface="app-sidecar"';
            }
            if (!/data-acm-view=/i.test(nextAttrs)) {
                nextAttrs += ` data-acm-view="${opts.viewMode}"`;
            }
            return `<body${nextAttrs}>`;
        });
    }

    return out;
}

function readJsonBodyWithLimit(
    req: http.IncomingMessage,
    limitBytes: number,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let settled = false;

        const finish = (res: { ok: true; data: unknown } | { ok: false; status: number; error: string }) => {
            if (settled) { return; }
            settled = true;
            resolve(res);
        };

        const contentLengthHeader = req.headers['content-length'];
        if (typeof contentLengthHeader === 'string') {
            const declared = Number(contentLengthHeader);
            if (Number.isFinite(declared) && declared > limitBytes) {
                req.resume();
                finish({ ok: false, status: 413, error: 'Request body exceeds 256KB limit' });
                return;
            }
        }

        req.on('data', (chunk: Buffer | string) => {
            if (settled) { return; }
            const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
            totalBytes += buf.length;
            if (totalBytes > limitBytes) {
                req.resume();
                finish({ ok: false, status: 413, error: 'Request body exceeds 256KB limit' });
                return;
            }
            chunks.push(buf);
        });

        req.on('error', () => {
            finish({ ok: false, status: 400, error: 'Failed to read request body' });
        });

        req.on('end', () => {
            if (settled) { return; }
            const raw = Buffer.concat(chunks).toString('utf8').trim();
            if (!raw) {
                finish({ ok: false, status: 400, error: 'Request body is required' });
                return;
            }
            try {
                finish({ ok: true, data: JSON.parse(raw) });
            } catch {
                finish({ ok: false, status: 400, error: 'Invalid JSON body' });
            }
        });
    });
}

function sendJson(
    res: http.ServerResponse,
    status: number,
    payload: unknown,
    extraHeaders: Record<string, string> = {},
): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extraHeaders,
    });
    res.end(body);
}

/**
 * Create the unified HTTP & SidecarApp router bound to a `SidecarProvider`.
 */
export function createSidecarHandler(
    provider: SidecarProvider,
    options: SidecarHandlerOptions = {},
): SidecarHandler {
    const startedAtMs = Date.now();
    const version = options.version || provider.version || DEFAULT_SIDECAR_VERSION;
    const isSidecarEnv = options.isSidecarEnv ?? Boolean(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT);
    const cachedThemeCss = getThemeAdapterStyles();
    const cachedBridgeJs = getHostBridgeScript(options.hostBridgeOptions);
    const resolvedImagesDir = resolveDefaultImagesDir(options.imagesDir);

    function listAssetImages(): string[] {
        if (!resolvedImagesDir) { return []; }
        try {
            return fs.readdirSync(resolvedImagesDir)
                .filter((name) => ALLOWED_IMAGE_FILENAME_RE.test(name))
                .sort();
        } catch {
            return [];
        }
    }

    async function handleAssetImage(filename: string): Promise<AssetImageResult> {
        const notFound: AssetImageResult = {
            status: 404,
            contentType: 'application/json; charset=utf-8',
            body: JSON.stringify({ ok: false, error: 'Not Found' }),
            headers: {
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        };
        if (!resolvedImagesDir || typeof filename !== 'string' || !ALLOWED_IMAGE_FILENAME_RE.test(filename)) {
            return notFound;
        }
        try {
            const realBase = await fs.promises.realpath(resolvedImagesDir);
            const candidate = path.join(realBase, filename);
            const realTarget = await fs.promises.realpath(candidate);
            const rel = path.relative(realBase, realTarget);
            if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel !== filename) {
                return notFound;
            }
            const stat = await fs.promises.stat(realTarget);
            if (!stat.isFile()) {
                return notFound;
            }
            const buf = await fs.promises.readFile(realTarget);
            return {
                status: 200,
                contentType: 'image/png',
                body: buf,
                headers: {
                    'Cache-Control': 'public, max-age=3600',
                    'X-Content-Type-Options': 'nosniff',
                    'Content-Length': String(buf.length),
                },
            };
        } catch {
            return notFound;
        }
    }

    async function renderPage(viewMode: SidecarViewMode, rawUrl = '/'): Promise<RenderedPageResult> {
        const parsedUrl = new URL(rawUrl, 'http://127.0.0.1');
        const ctx: SidecarRenderContext = {
            viewMode,
            pathname: parsedUrl.pathname,
            conversationId: parsedUrl.searchParams.get('conversationId') || undefined,
            workspaceUris: parseWorkspaceUrisParam(parsedUrl.searchParams.get('workspaceUris') || undefined),
            isSidecarEnv,
            version,
        };
        const rawHtml = await provider.renderHtml(ctx);
        const body = injectSidecarHeadAndScripts(rawHtml, {
            isSidecarEnv,
            viewMode,
            themeAdapterCss: cachedThemeCss,
            hostBridgeScript: cachedBridgeJs,
        });
        return {
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body,
            headers: {
                'Cache-Control': 'no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        };
    }

    async function handleSnapshotQuery(
        query: Record<string, string | string[] | undefined>,
        ifNoneMatch?: string,
    ): Promise<{ status: number; headers: Record<string, string>; body: SidecarSnapshotHttpBody }> {
        const clientEtag = normalizeEtag(firstString(query.etag) || ifNoneMatch);
        const rawView = firstString(query.viewMode) || firstString(query.view);
        const viewMode = parseViewMode(rawView, isSidecarEnv ? 'aux' : 'standalone');
        const rawLang = firstString(query.lang);
        const lang = (rawLang === 'en' || rawLang === 'zh' || rawLang === 'both') ? rawLang : undefined;
        const includeHtml = firstString(query.includeHtml) === 'true' || firstString(query.includeHtml) === '1';

        const snapshotQuery: SidecarSnapshotQuery & { lang?: 'en' | 'zh' | 'both'; includeHtml?: boolean } = {
            conversationId: firstString(query.conversationId) || undefined,
            workspaceUris: parseWorkspaceUrisParam(firstString(query.workspaceUris)),
            etag: clientEtag || undefined,
            viewMode,
            pinnedConversationId: firstString(query.pinnedConversationId) || undefined,
            lockToMainAgent: firstString(query.lockToMainAgent) === 'true',
            ...(lang ? { lang } : {}),
            ...(includeHtml ? { includeHtml: true } : {}),
        };
        const snapshot = await provider.getSnapshot(snapshotQuery);
        const hash = computeSnapshotHash(snapshot);
        const headers: Record<string, string> = {
            'ETag': `"${hash}"`,
            'Cache-Control': 'no-store',
        };
        if (clientEtag && clientEtag === hash) {
            return {
                status: 200,
                headers,
                body: { unchanged: true, hash },
            };
        }
        const snapRecord = snapshot as Record<string, unknown>;
        let html: string | undefined = typeof snapRecord.html === 'string' ? snapRecord.html : undefined;
        if (includeHtml && !html) {
            const qs = new URLSearchParams();
            if (snapshotQuery.conversationId) { qs.set('conversationId', snapshotQuery.conversationId); }
            if (snapshotQuery.workspaceUris && snapshotQuery.workspaceUris.length > 0) {
                qs.set('workspaceUris', JSON.stringify(snapshotQuery.workspaceUris));
            }
            const pagePath = viewMode === 'sidebar' ? '/full' : '/';
            const pageUrl = qs.toString() ? `${pagePath}?${qs.toString()}` : pagePath;
            const rendered = await renderPage(viewMode, pageUrl);
            html = rendered.body;
        }
        return {
            status: 200,
            headers,
            body: {
                unchanged: false,
                hash,
                snapshot,
                data: snapRecord.data !== undefined ? snapRecord.data : snapshot,
                ...(html !== undefined ? { html } : {}),
            },
        };
    }

    async function handleActionPayload(rawBody: unknown): Promise<{ status: number; body: SidecarActionHttpBody }> {
        if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
            return { status: 400, body: { ok: false, error: 'Action payload must be a JSON object' } };
        }
        const record = rawBody as Record<string, unknown>;
        const command = typeof record.command === 'string' ? record.command.trim() : '';
        if (!command || command.length > 128) {
            return { status: 400, body: { ok: false, error: 'Missing or invalid action command' } };
        }
        const action: SidecarActionRequest = { ...record, command };
        try {
            const response = await provider.handleAction(action) as SidecarActionHttpBody | undefined;
            const sanitized: SidecarActionHttpBody = {
                ok: Boolean(response?.ok),
                ...(response?.result !== undefined ? { result: response.result } : {}),
                ...(typeof response?.text === 'string' ? { text: response.text } : {}),
                ...(typeof response?.copiedHint === 'string' ? { copiedHint: response.copiedHint } : {}),
                ...(Array.isArray(response?.messages) ? { messages: response.messages } : {}),
                ...(response?.reload ? { reload: true } : {}),
                ...(response?.snapshot !== undefined
                    ? {
                        snapshot: response.snapshot,
                        hash: response.hash || computeSnapshotHash(response.snapshot),
                    }
                    : {}),
                ...(typeof response?.error === 'string' && response.error
                    ? { error: response.error }
                    : {}),
            };
            const explicitStatus = typeof response?.statusCode === 'number'
                && response.statusCode >= 200 && response.statusCode <= 599
                ? response.statusCode
                : (sanitized.ok ? 200 : 400);
            return { status: explicitStatus, body: sanitized };
        } catch {
            // Never leak raw Error stacks or internal file paths over HTTP
            return { status: 500, body: { ok: false, error: 'Internal action error' } };
        }
    }

    function getHealth(): SidecarHealthResponse {
        return {
            ok: true,
            version,
            surface: 'app-sidecar',
            pid: process.pid,
            mode: isSidecarEnv ? 'sidecar' : 'standalone',
            uptimeMs: Math.max(0, Date.now() - startedAtMs),
        };
    }

    async function handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const method = (req.method || 'GET').toUpperCase();
        const rawUrlPath = (req.url || '/').split('?')[0];
        let parsedUrl: URL;
        try {
            parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
        } catch {
            sendJson(res, 400, { ok: false, error: 'Invalid request URL' });
            return;
        }
        const pathname = parsedUrl.pathname;

        try {
            if (pathname === '/' || pathname === '/full') {
                if (method !== 'GET') {
                    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
                    return;
                }
                const viewMode: SidecarViewMode = pathname === '/full'
                    ? 'sidebar'
                    : (isSidecarEnv ? 'aux' : 'standalone');
                const rendered = await renderPage(viewMode, req.url || pathname);
                res.writeHead(rendered.status, {
                    'Content-Type': rendered.contentType,
                    ...rendered.headers,
                });
                res.end(rendered.body);
                return;
            }

            if (rawUrlPath.startsWith('/assets/images/') || pathname.startsWith('/assets/images/')) {
                if (method !== 'GET' && method !== 'HEAD') {
                    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
                    return;
                }
                const rawMatch = IMAGE_ROUTE_RE.exec(rawUrlPath);
                const parsedMatch = IMAGE_ROUTE_RE.exec(pathname);
                if (!rawMatch || !parsedMatch || rawMatch[1] !== parsedMatch[1]) {
                    sendJson(res, 404, { ok: false, error: 'Not Found' });
                    return;
                }
                const asset = await handleAssetImage(rawMatch[1]);
                res.writeHead(asset.status, {
                    'Content-Type': asset.contentType,
                    ...asset.headers,
                });
                res.end(method === 'HEAD' ? undefined : asset.body);
                return;
            }

            if (pathname === '/api/health') {
                if (method !== 'GET') {
                    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
                    return;
                }
                sendJson(res, 200, getHealth());
                return;
            }

            if (pathname === '/api/snapshot') {
                if (method !== 'GET') {
                    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
                    return;
                }
                const query: Record<string, string> = {};
                parsedUrl.searchParams.forEach((v, k) => { query[k] = v; });
                const ifNoneMatch = typeof req.headers['if-none-match'] === 'string'
                    ? req.headers['if-none-match']
                    : undefined;
                const result = await handleSnapshotQuery(query, ifNoneMatch);
                sendJson(res, result.status, result.body, result.headers);
                return;
            }

            if (pathname === '/api/action') {
                if (method !== 'POST') {
                    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
                    return;
                }
                const parsed = await readJsonBodyWithLimit(req, MAX_ACTION_BODY_BYTES);
                if (!parsed.ok) {
                    sendJson(res, parsed.status, { ok: false, error: parsed.error });
                    return;
                }
                const result = await handleActionPayload(parsed.data);
                sendJson(res, result.status, result.body);
                return;
            }

            sendJson(res, 404, { ok: false, error: 'Not Found' });
        } catch {
            sendJson(res, 500, { ok: false, error: 'Internal Server Error' });
        }
    }

    return {
        renderPage,
        handleSnapshotQuery,
        handleActionPayload,
        handleAssetImage,
        listAssetImages,
        getHealth,
        handleHttp,
    };
}

/**
 * Starts a loopback-only HTTP server (`127.0.0.1`) for standalone testing,
 * headless Chromium verification, or local development outside Antigravity App.
 */
export async function startStandaloneServer(
    provider: SidecarProvider,
    options: StandaloneServerOptions = {},
): Promise<StandaloneServerHandle> {
    const host = options.host || '127.0.0.1';
    if (!LOOPBACK_HOSTS.has(host)) {
        throw new Error(`Refusing to bind sidecar standalone server to non-loopback host: ${host}`);
    }
    const port = typeof options.port === 'number' ? options.port : 0;
    const handler = createSidecarHandler(provider, {
        version: options.version,
        isSidecarEnv: false,
        hostBridgeOptions: options.hostBridgeOptions,
        imagesDir: options.imagesDir,
    });

    const server = http.createServer((req, res) => {
        void handler.handleHttp(req, res);
    });

    const activeSockets = new Set<net.Socket>();
    server.on('connection', (socket) => {
        activeSockets.add(socket);
        socket.on('close', () => { activeSockets.delete(socket); });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.off('error', reject);
            resolve();
        });
    });

    const addr = server.address();
    const resolvedPort = typeof addr === 'object' && addr ? addr.port : port;
    const urlHost = host === '::1' ? '[::1]' : host;

    let closePromise: Promise<void> | null = null;
    const close = (): Promise<void> => {
        if (closePromise) { return closePromise; }
        closePromise = (async () => {
            await new Promise<void>((resolve, reject) => {
                server.close((err) => {
                    if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
                        reject(err);
                        return;
                    }
                    resolve();
                });
                if (typeof server.closeIdleConnections === 'function') {
                    server.closeIdleConnections();
                }
                for (const socket of activeSockets) {
                    socket.destroy();
                }
                activeSockets.clear();
            });
            await Promise.resolve(provider.dispose?.());
        })();
        return closePromise;
    };

    return {
        server,
        host,
        port: resolvedPort,
        url: `http://${urlHost}:${resolvedPort}`,
        close,
    };
}

/**
 * Clean fallback provider used when the full compiled runtime provider
 * (`sidecar-runtime.js`) is not yet wired in. Supports health, snapshot ETag
 * polling, and safe basic actions.
 */
export function createFallbackSidecarProvider(
    options: { version?: string } = {},
): SidecarProvider {
    const version = options.version || DEFAULT_SIDECAR_VERSION;
    let paused = false;
    let language: 'zh' | 'en' | 'both' = 'both';
    let refreshCount = 0;

    function formatUtcClock(): string {
        const now = new Date();
        return now.toISOString().slice(11, 19);
    }

    function buildSnapshot(query: SidecarSnapshotQuery): SidecarSnapshotPayload {
        return {
            time: formatUtcClock(),
            language,
            paused,
            activeConversationId: query.pinnedConversationId || query.conversationId || null,
            conversations: [],
            tabs: {
                overview: `<section class="acm-fallback-card"><h2>Antigravity Context Monitor</h2><p>Sidecar runtime ready (v${version}). Waiting for telemetry provider binding.</p></section>`,
            },
            meta: {
                fallback: true,
                refreshCount,
                viewMode: query.viewMode || 'aux',
            },
        };
    }

    return {
        version,
        renderHtml(ctx: SidecarRenderContext): string {
            const title = ctx.viewMode === 'sidebar'
                ? 'Antigravity Context Monitor — Sidebar'
                : 'Antigravity Context Monitor';
            return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--ed-bg, #0D1014); color: var(--ed-ink, #F2F4F8); }
    .acm-shell { padding: 16px; max-width: 960px; margin: 0 auto; }
    .acm-fallback-card { border: 1px solid var(--ed-border, #232A35); border-radius: 10px; padding: 16px; background: var(--ed-surface, #14181F); }
    .acm-fallback-card h2 { margin: 0 0 8px; font-size: 16px; }
    .acm-fallback-card p { margin: 0; color: var(--ed-ink-muted, #8C98A9); font-size: 13px; }
  </style>
</head>
<body data-lang="${language}">
  <main class="acm-shell" id="monitor-content">
    <div class="tab-pane active" id="tab-overview">
      <section class="acm-fallback-card">
        <h2>Antigravity Context Monitor</h2>
        <p>Sidecar surface initialized (v${version}, view: ${ctx.viewMode}).</p>
      </section>
    </div>
  </main>
</body>
</html>`;
        },
        getSnapshot(query: SidecarSnapshotQuery): SidecarSnapshotPayload {
            return buildSnapshot(query);
        },
        handleAction(action: SidecarActionRequest): SidecarActionResponse {
            switch (action.command) {
                case 'ping':
                    return { ok: true, result: { pong: true, version } };
                case 'refresh':
                    refreshCount += 1;
                    return { ok: true, snapshot: buildSnapshot({}) };
                case 'togglePause':
                    paused = !paused;
                    return {
                        ok: true,
                        result: { paused },
                        messages: [{ command: 'setPaused', paused }],
                    };
                case 'switchLanguage': {
                    const lang = action.lang;
                    if (lang !== 'zh' && lang !== 'en' && lang !== 'both') {
                        return { ok: false, statusCode: 400, error: 'Invalid language' };
                    }
                    language = lang;
                    return { ok: true, result: { language }, reload: true };
                }
                default:
                    return { ok: false, statusCode: 400, error: `Unknown action: ${action.command}` };
            }
        },
    };
}

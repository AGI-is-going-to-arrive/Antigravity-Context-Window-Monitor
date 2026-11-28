#!/usr/bin/env node
/**
 * Isolated esbuild bundler for Antigravity Context Monitor.
 *
 * Produces strictly separated build artifacts with zero runtime npm dependencies:
 *   1. Independent browser client bundles (WebView + CDP Shadow DOM overlay)
 *      with deterministic content-hash buildIds ->
 *      - src/client/generated/client-bundles.generated.ts
 *      - dist-stage/client/{webview-client.js,cdp-overlay-client.js,manifest.json}
 *   2. Antigravity IDE extension CJS bundle ->
 *      - dist-stage/ide/extension.js (external: ['vscode', 'node:sqlite'])
 *      - dist-stage/ide/manifest.json
 *   3. Antigravity App Sidecar runtime CJS bundle ->
 *      - dist-stage/app/sidecar-bundle.js (zero vscode, zero external npm deps)
 *      - dist-stage/app/sidecar-server.js (CJS entry shim preserving previous-release path)
 *      - dist-stage/app/sidecar-runtime.js (CJS entry shim exporting ACM_REAL_PROVIDER = true)
 *      - dist-stage/app/manifest.json
 *   4. Single-source standalone ESM installer ->
 *      - scripts/install-app-plugin.mjs (0o755, zero external deps, file & stdin safe)
 *   5. Opt-in read-only `agy` CLI statusLine executable ->
 *      - app-plugin/bin/agy-statusline.mjs (0o755, zero external deps)
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import * as esbuild from 'esbuild';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const NODE_BUILTINS = new Set([
    ...builtinModules,
    ...builtinModules.map((mod) => (mod.startsWith('node:') ? mod : `node:${mod}`)),
    'node:sqlite',
    'node:test',
]);

const FORBIDDEN_CDP_PATTERNS = [
    { name: 'innerHTML', re: /\binnerHTML\b/ },
    { name: 'outerHTML', re: /\bouterHTML\b/ },
    { name: 'insertAdjacentHTML', re: /\binsertAdjacentHTML\b/ },
    { name: 'document.write', re: /\bdocument\.write\b/ },
    { name: 'eval(', re: /\beval\s*\(/ },
    { name: 'new Function', re: /\bnew\s+Function\b/ },
];

const HTML_TEMPLATE_FILE_RE = /(?:^|\/)(?:webview-[a-z0-9-]+|activity-panel|pricing-panel|orchestrator-attribution|sidecar-server|sidecar-runtime)\.ts$/i;

const BLOCK_HTML_TAGS = new Set([
    'html', 'head', 'body', 'meta', 'link', 'title', 'style', 'script',
    'div', 'section', 'header', 'footer', 'nav', 'main', 'aside', 'article',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'details', 'summary', 'form', 'fieldset',
    'hr', 'br', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'option', 'optgroup',
    'svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon',
    'defs', 'lineargradient', 'stop', 'clippath',
]);

const RAW_PRESERVE_TAGS = new Set(['pre', 'code', 'textarea', 'script', 'style']);

export function computeBuildId(content) {
    return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Make bundled JS safe for inline <script> injection by escaping closing script
 * tag sequences and HTML comment openers without changing JS runtime semantics.
 */
export function sanitizeInlineScriptBundle(code) {
    return String(code)
        .replace(/<\/script/gi, match => '<\\/' + match.slice(2))
        .replace(/<!--/g, '<\\!--');
}

function readPackageVersion(repoRoot) {
    const pkgPath = join(repoRoot, 'package.json');
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf8').replace(/^\uFEFF/, ''));
    if (typeof parsed.version !== 'string' || !parsed.version.trim()) { throw new Error('Missing package version'); }
    return parsed.version.trim();
}

function writeIfChanged(filePath, content) {
    mkdirSync(dirname(filePath), { recursive: true });
    if (existsSync(filePath)) {
        try {
            if (readFileSync(filePath, 'utf8') === content) {
                return false;
            }
        } catch {
            // Fall through to overwrite
        }
    }
    writeFileSync(filePath, content, 'utf8');
    return true;
}

function ensureExecutable(filePath) {
    if (process.platform !== 'win32') {
        try { chmodSync(filePath, 0o755); } catch { /* ignore */ }
    }
}

function createZeroRuntimeDepsPlugin(allowedExternals, targetLabel, options = {}) {
    const allowed = new Set(allowedExternals);
    const allowLazyVscodeRequire = Boolean(options.allowLazyVscodeRequire);
    return {
        name: `zero-runtime-deps-${targetLabel}`,
        setup(build) {
            build.onResolve({ filter: /^[^./]/ }, (args) => {
                if (args.path.startsWith('node:')) {
                    if (NODE_BUILTINS.has(args.path)) {
                        return { path: args.path, external: true };
                    }
                    return {
                        errors: [{
                            text: `[build-bundles:${targetLabel}] Unknown node: builtin "${args.path}" imported from ${args.importer}`,
                        }],
                    };
                }
                if (allowed.has(args.path)) {
                    return { path: args.path, external: true };
                }
                if (allowLazyVscodeRequire && args.path === 'vscode' && args.kind === 'require-call') {
                    return { path: 'vscode', external: true };
                }
                if (NODE_BUILTINS.has(args.path)) {
                    return { path: args.path, external: true };
                }
                return {
                    errors: [{
                        text: `[build-bundles:${targetLabel}] Forbidden external dependency "${args.path}" (${args.kind}) imported from ${args.importer}. Runtime bundles must have ZERO external npm dependencies.`,
                    }],
                };
            });
        },
    };
}

// ─── Conservative Lossless HTML & CSS Template Compactor ─────────────────────

function minifyStaticCssBlock(cssText) {
    try {
        return esbuild.transformSync(cssText, {
            loader: 'css',
            minify: true,
            legalComments: 'none',
            charset: 'utf8',
        }).code.trim();
    } catch {
        return cssText;
    }
}

function compactOpeningTagWhitespace(tagRaw) {
    // Preserve every quoted attribute value verbatim; collapse ONLY unquoted
    // whitespace runs between attributes and trim space right before `>` / `/>`.
    let out = '';
    let quote = '';
    let inSpace = false;
    for (let i = 0; i < tagRaw.length; i++) {
        const ch = tagRaw[i];
        if (quote) {
            out += ch;
            if (ch === '\\' && i + 1 < tagRaw.length) {
                out += tagRaw[++i];
            } else if (ch === quote) {
                quote = '';
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            if (inSpace && out.length > 0 && !out.endsWith('<') && !out.endsWith('=')) {
                out += ' ';
            }
            inSpace = false;
            quote = ch;
            out += ch;
            continue;
        }
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
            inSpace = true;
            continue;
        }
        if (inSpace) {
            if (ch !== '>' && !(ch === '/' && tagRaw[i + 1] === '>') && !out.endsWith('<') && !out.endsWith('=')) {
                out += ' ';
            }
            inSpace = false;
        }
        out += ch;
    }
    return out;
}

function compactOpenTagFragment(fragment, initialQuote = '') {
    let out = '';
    let quote = initialQuote;
    let inSpace = false;
    let closed = false;
    let consumed = 0;

    for (let k = 0; k < fragment.length; k++) {
        const ch = fragment[k];
        consumed = k + 1;
        if (quote) {
            out += ch;
            if (ch === '\\' && k + 1 < fragment.length) {
                out += fragment[++k];
                consumed = k + 1;
            } else if (ch === quote) {
                quote = '';
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            if (inSpace && !out.endsWith('<') && !out.endsWith('=')) {
                out += ' ';
            }
            inSpace = false;
            quote = ch;
            out += ch;
            continue;
        }
        if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
            inSpace = true;
            continue;
        }
        if (ch === '>') {
            inSpace = false;
            out += ch;
            closed = true;
            break;
        }
        if (inSpace) {
            const isSelfClose = ch === '/' && fragment[k + 1] === '>';
            // Drop space before `/>` only when preceded by content in this fragment
            // (keep separator directly after `${...}` so unquoted attributes cannot fuse with `/`).
            if (!(isSelfClose && out.length > 0) && !out.endsWith('<') && !out.endsWith('=')) {
                out += ' ';
            }
            inSpace = false;
        }
        out += ch;
    }

    if (!closed && inSpace && !out.endsWith('<') && !out.endsWith('=')) {
        out += ' ';
    }

    return { text: out, quote, closed, consumed };
}

/**
 * Conservatively compact static HTML/CSS template quasi text while strictly
 * preserving:
 *   - `<pre>`, `<code>`, `<textarea>`, and `<script>` bodies verbatim
 *   - ALL quoted attribute values (`"..."` and `'...'`) verbatim
 *   - Inline whitespace separation between inline tags/text
 *   - ALL `${...}` JS template interpolations (never seen by this helper)
 *
 * Also minifies static `<style>...</style>` CSS regions via `esbuild`.
 */
export function compactHtmlQuasi(rawText, initialState = { rawTag: null, inOpenTag: false, quote: '' }) {
    const state = { ...initialState };
    if (!rawText || (!rawText.includes('\n') && !rawText.includes('\r') && !rawText.includes('<!--') && !rawText.includes('<style'))) {
        // Still advance raw-tag / quote state accurately so following quasis stay safe!
        advanceHtmlStateOnly(rawText, state);
        return { text: rawText, state };
    }

    let out = '';
    let i = 0;
    const len = rawText.length;

    while (i < len) {
        // Inside an unfinished opening tag spanning across `${...}`:
        // preserve quoted values verbatim and collapse unquoted indentation safely.
        if (state.inOpenTag) {
            const frag = compactOpenTagFragment(rawText.slice(i), state.quote);
            out += frag.text;
            state.quote = frag.quote;
            if (frag.closed) {
                state.inOpenTag = false;
            }
            i += frag.consumed;
            continue;
        }

        // Inside `<pre>`, `<code>`, `<textarea>`, `<script>`, or `<style>`: preserve verbatim
        // (except static `<style>` blocks which can be CSS-minified when closed in the same quasi).
        if (state.rawTag) {
            const closeRe = new RegExp(`</${state.rawTag}\\s*>`, 'i');
            const rest = rawText.slice(i);
            const closeMatch = closeRe.exec(rest);
            if (!closeMatch) {
                out += rest;
                return { text: out, state };
            }
            const body = rest.slice(0, closeMatch.index);
            const closeTag = closeMatch[0];
            if (state.rawTag === 'style' && !body.includes('\\') && !body.includes('`')) {
                out += minifyStaticCssBlock(body) + closeTag;
            } else {
                out += body + closeTag;
            }
            i += closeMatch.index + closeTag.length;
            state.rawTag = null;
            continue;
        }

        // Static HTML comments (preserve conditional comments `<!--[if` just in case)
        if (rawText.startsWith('<!--', i) && !rawText.startsWith('<!--[if', i)) {
            const endIdx = rawText.indexOf('-->', i + 4);
            if (endIdx !== -1) {
                i = endIdx + 3;
                continue;
            }
            out += rawText.slice(i);
            return { text: out, state };
        }

        // HTML tag start `<...>`
        if (rawText[i] === '<' && i + 1 < len && (/[A-Za-z/!]/.test(rawText[i + 1]))) {
            // Find matching `>` respecting attribute quotes
            let j = i + 1;
            let q = '';
            while (j < len) {
                const c = rawText[j];
                if (q) {
                    if (c === '\\' && j + 1 < len) { j += 2; continue; }
                    if (c === q) { q = ''; }
                } else if (c === '"' || c === "'") {
                    q = c;
                } else if (c === '>') {
                    break;
                }
                j += 1;
            }
            if (j >= len) {
                // Tag spans across `${...}` interpolation -> compact unquoted whitespace and record open-tag state
                const tail = rawText.slice(i);
                if (tail.startsWith('<!')) {
                    out += tail;
                    state.inOpenTag = true;
                    state.quote = q;
                } else {
                    const frag = compactOpenTagFragment(tail, '');
                    out += frag.text;
                    state.inOpenTag = true;
                    state.quote = frag.quote;
                }
                return { text: out, state };
            }

            const fullTag = rawText.slice(i, j + 1);
            const compactedTag = fullTag.startsWith('<!') ? fullTag : compactOpeningTagWhitespace(fullTag);
            out += compactedTag;
            i = j + 1;

            const openMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)(?:[\s/>]|$)/.exec(compactedTag);
            if (openMatch && !compactedTag.endsWith('/>')) {
                const tagName = openMatch[1].toLowerCase();
                if (RAW_PRESERVE_TAGS.has(tagName)) {
                    // For static `<style>` or `<script>` closed within this same quasi without interpolation, minify cleanly.
                    if (tagName === 'style' || tagName === 'script') {
                        const rest = rawText.slice(i);
                        const closeTagRe = new RegExp(`</${tagName}\\s*>`, 'i');
                        const closeIdx = rest.search(closeTagRe);
                        if (closeIdx !== -1) {
                            const body = rest.slice(0, closeIdx);
                            const closeMatch = new RegExp(`^</${tagName}\\s*>`, 'i').exec(rest.slice(closeIdx));
                            if (closeMatch && !body.includes('\\') && !body.includes('`')) {
                                if (tagName === 'style') {
                                    out += minifyStaticCssBlock(body) + closeMatch[0];
                                    i += closeIdx + closeMatch[0].length;
                                    continue;
                                }
                                try {
                                    const minJs = sanitizeInlineScriptBundle(
                                        esbuild.transformSync(body, {
                                            loader: 'js',
                                            minify: true,
                                            target: ['es2022', 'chrome120'],
                                            legalComments: 'none',
                                            charset: 'utf8',
                                        }).code.trim(),
                                    );
                                    assertValidJsSyntax(minJs, 'inline-html-script');
                                    if (minJs.length < body.length) {
                                        out += minJs + closeMatch[0];
                                        i += closeIdx + closeMatch[0].length;
                                        continue;
                                    }
                                } catch {
                                    // Preserve original script body verbatim if minification fails
                                }
                            }
                        }
                    }
                    state.rawTag = tagName;
                }
            }
            continue;
        }

        // Whitespace run containing at least one newline outside tags & raw elements
        if (rawText[i] === '\r' || rawText[i] === '\n' || rawText[i] === ' ' || rawText[i] === '\t') {
            let j = i;
            let hasNewline = false;
            while (j < len && (rawText[j] === ' ' || rawText[j] === '\t' || rawText[j] === '\r' || rawText[j] === '\n')) {
                if (rawText[j] === '\r' || rawText[j] === '\n') { hasNewline = true; }
                j += 1;
            }
            if (!hasNewline) {
                out += rawText.slice(i, j);
                i = j;
                continue;
            }

            // Look at immediate surrounding tags to decide whether newline+indent is structural (drop) or inline (single space)
            const prevTagMatch = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:[^>]*?)>$/.exec(out);
            const prevIsDoctype = /<!doctype[^>]*>$/i.test(out);
            const prevEndsTag = out.endsWith('>');
            const nextTagMatch = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:[\s/>]|$)/.exec(rawText.slice(j));
            const prevIsBlock = prevIsDoctype || Boolean(prevTagMatch && BLOCK_HTML_TAGS.has(prevTagMatch[1].toLowerCase()));
            const nextIsBlock = Boolean(nextTagMatch && BLOCK_HTML_TAGS.has(nextTagMatch[1].toLowerCase()));
            const atStartAfterNothing = out.length === 0 && nextIsBlock;
            const atEndBeforeNothing = j === len && prevIsBlock;

            if ((prevIsBlock && nextTagMatch) || (nextIsBlock && (prevTagMatch || prevIsDoctype || prevEndsTag)) || atStartAfterNothing || atEndBeforeNothing) {
                // Structural indentation between block tags: drop cleanly!
            } else {
                out += ' ';
            }
            i = j;
            continue;
        }

        out += rawText[i];
        i += 1;
    }

    return { text: out, state };
}

function advanceHtmlStateOnly(rawText, state) {
    let i = 0;
    const len = rawText.length;
    while (i < len) {
        if (state.inOpenTag) {
            const ch = rawText[i];
            if (state.quote) {
                if (ch === '\\' && i + 1 < len) { i += 2; continue; }
                if (ch === state.quote) { state.quote = ''; }
            } else if (ch === '"' || ch === "'") {
                state.quote = ch;
            } else if (ch === '>') {
                state.inOpenTag = false;
            }
            i += 1;
            continue;
        }
        if (state.rawTag) {
            const closeRe = new RegExp(`</${state.rawTag}\\s*>`, 'i');
            const m = closeRe.exec(rawText.slice(i));
            if (!m) { return; }
            i += m.index + m[0].length;
            state.rawTag = null;
            continue;
        }
        if (rawText[i] === '<' && i + 1 < len && /[A-Za-z/!]/.test(rawText[i + 1])) {
            let j = i + 1;
            let q = '';
            while (j < len) {
                const c = rawText[j];
                if (q) {
                    if (c === '\\' && j + 1 < len) { j += 2; continue; }
                    if (c === q) { q = ''; }
                } else if (c === '"' || c === "'") {
                    q = c;
                } else if (c === '>') {
                    break;
                }
                j += 1;
            }
            if (j >= len) {
                state.inOpenTag = true;
                state.quote = q;
                return;
            }
            const tag = rawText.slice(i, j + 1);
            const openMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)(?:[\s/>]|$)/.exec(tag);
            if (openMatch && !tag.endsWith('/>')) {
                const tagName = openMatch[1].toLowerCase();
                if (RAW_PRESERVE_TAGS.has(tagName)) {
                    state.rawTag = tagName;
                }
            }
            i = j + 1;
            continue;
        }
        i += 1;
    }
}

/**
 * Safely compact static HTML template literals inside a TypeScript source file
 * using the TypeScript AST so nested templates, `${...}` expressions, JS strings,
 * regexes, and raw elements (`<pre>`, `<code>`, `<textarea>`, `<script>`) are
 * never misparsed or corrupted.
 */
export function compactHtmlTemplatesInTsSource(sourceCode, fileName = 'file.ts') {
    const sf = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.ES2022, false);
    const edits = [];

    function looksLikeHtmlTemplate(parts) {
        const joined = parts.join('');
        if (!joined.includes('<') || !joined.includes('>')) { return false; }
        const trimmedStart = joined.trimStart();
        if (
            trimmedStart.startsWith('#!')
            || trimmedStart.startsWith('<?xml')
            || trimmedStart.startsWith('[Desktop Entry]')
            || trimmedStart.startsWith('$ErrorActionPreference')
        ) {
            return false;
        }
        return /<(?:!DOCTYPE|html|head|body|div|span|section|header|footer|nav|main|aside|article|table|thead|tbody|tr|td|th|ul|ol|li|button|a|p|h[1-6]|label|input|select|option|details|summary|form|svg|g|path|rect|circle|style|strong|em|small|code|pre|br|hr)\b/i.test(joined);
    }

    function visit(node) {
        if (ts.isNoSubstitutionTemplateLiteral(node)) {
            const start = node.getStart(sf) + 1;
            const end = node.getEnd() - 1;
            if (end > start) {
                const rawInner = sourceCode.slice(start, end);
                if (looksLikeHtmlTemplate([rawInner])) {
                    const compacted = compactHtmlQuasi(rawInner).text;
                    if (compacted !== rawInner && compacted.length < rawInner.length) {
                        edits.push({ start, end, replacement: compacted });
                    }
                }
            }
        } else if (ts.isTemplateExpression(node)) {
            const spans = [];
            const headStart = node.head.getStart(sf) + 1;
            const headEnd = node.head.getEnd() - 2; // before `${`
            spans.push({ start: headStart, end: headEnd, raw: sourceCode.slice(headStart, headEnd) });

            for (let idx = 0; idx < node.templateSpans.length; idx++) {
                const lit = node.templateSpans[idx].literal;
                const litStart = lit.getStart(sf) + 1; // after `}`
                const isTail = idx === node.templateSpans.length - 1;
                const litEnd = lit.getEnd() - (isTail ? 1 : 2); // before `` ` `` or `${`
                spans.push({ start: litStart, end: litEnd, raw: sourceCode.slice(litStart, litEnd) });
            }

            if (looksLikeHtmlTemplate(spans.map((s) => s.raw))) {
                let state = { rawTag: null, inOpenTag: false, quote: '' };
                for (const sp of spans) {
                    if (sp.end <= sp.start) { continue; }
                    const res = compactHtmlQuasi(sp.raw, state);
                    state = res.state;
                    if (res.text !== sp.raw && res.text.length < sp.raw.length) {
                        edits.push({ start: sp.start, end: sp.end, replacement: res.text });
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sf);
    if (edits.length === 0) {
        return sourceCode;
    }

    // Apply edits from end to start (all static quasi ranges are strictly non-overlapping)
    edits.sort((a, b) => b.start - a.start);
    let result = sourceCode;
    let lastStart = Infinity;
    for (const edit of edits) {
        if (edit.end > lastStart) { continue; }
        result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
        lastStart = edit.start;
    }
    return result;
}

const CSS_POOL_VIRTUAL_ID = 'virtual:acm-css-pool';
const BROWSER_POOL_VIRTUAL_ID = 'virtual:acm-browser-pool';
const CSS_FN_RE = /(export\s+function\s+(get[A-Za-z0-9_]*(?:Styles|Css))\s*\([^)]*\)\s*:\s*string\s*\{\s*return\s*)`(?:\$\{(get[A-Za-z0-9_]*(?:Styles|Css)\(\))\})?([^`$]*)`(?:\.trim\(\))?(\s*;\s*\})/g;

// Deterministic adjacency order placing `webview-styles.ts` directly next to
// `webview-editorial-styles.ts` and grouping shared `--ed-*` stylesheets inside
// DEFLATE's 32 KB sliding window for maximum lossless LZ77 cross-stylesheet reuse.
const CSS_POOL_SOURCE_FILES = [
    'src/app/cdp-overlay-assets.ts',
    'src/app/theme-adapter.ts',
    'src/webview-styles.ts',
    'src/webview-editorial-styles.ts',
    'src/activity-panel.ts',
    'src/webview-calendar-tab.ts',
    'src/pricing-panel.ts',
    'src/webview-overview-tab.ts',
    'src/webview-about-tab.ts',
    'src/orchestrator-attribution.ts',
];

function minifyJsTemplateExpression(sourceCode, sf, targetNode, sentinelPrefix, label) {
    const rawExprs = [];
    const sentinels = [];
    let cookedJs = targetNode.head.text;
    for (let idx = 0; idx < targetNode.templateSpans.length; idx++) {
        const span = targetNode.templateSpans[idx];
        const sentinel = `${sentinelPrefix}${idx}__`;
        if (sourceCode.includes(sentinel)) { return null; }
        sentinels.push(sentinel);
        rawExprs.push(sourceCode.slice(span.expression.getStart(sf), span.expression.getEnd()));
        cookedJs += sentinel + span.literal.text;
    }

    let minified;
    try {
        minified = sanitizeInlineScriptBundle(
            esbuild.transformSync(cookedJs, {
                loader: 'js',
                minify: true,
                target: ['es2022', 'chrome120'],
                legalComments: 'none',
                charset: 'utf8',
            }).code.trim(),
        );
    } catch {
        return null;
    }

    for (const sentinel of sentinels) {
        const first = minified.indexOf(sentinel);
        if (first < 0 || minified.indexOf(sentinel, first + sentinel.length) >= 0) {
            return null;
        }
    }
    const syntaxProbe = minified.replace(new RegExp(`${sentinelPrefix}\\d+__`, 'g'), '0');
    assertValidJsSyntax(syntaxProbe, label);

    const parts = [];
    const tokens = minified.split(new RegExp(`(${sentinelPrefix}\\d+__)`, 'g'));
    for (const tok of tokens) {
        if (!tok) { continue; }
        const m = new RegExp(`^${sentinelPrefix}(\\d+)__$`).exec(tok);
        if (m) {
            const idx = Number.parseInt(m[1], 10);
            parts.push(`String(${rawExprs[idx]})`);
        } else {
            parts.push(JSON.stringify(tok));
        }
    }
    return `(${parts.join(' + ')})`;
}

function minifyHostBridgeScriptInSource(sourceCode, fileName = 'host-bridge.ts') {
    const sf = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.ES2022, false);
    let targetNode = null;

    function visit(node) {
        if (targetNode) { return; }
        if (
            ts.isFunctionDeclaration(node)
            && node.name
            && node.name.text === 'getHostBridgeScript'
            && node.body
        ) {
            for (const stmt of node.body.statements) {
                if (ts.isReturnStatement(stmt) && stmt.expression && ts.isTemplateExpression(stmt.expression)) {
                    targetNode = stmt.expression;
                    return;
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sf);

    if (!targetNode) { return sourceCode; }
    const replacement = minifyJsTemplateExpression(sourceCode, sf, targetNode, '__ACM_HB_EXPR_', 'host-bridge-inline');
    if (!replacement) { return sourceCode; }

    const start = targetNode.getStart(sf);
    const end = targetNode.getEnd();
    return `${sourceCode.slice(0, start)}${replacement}${sourceCode.slice(end)}`;
}

function minifyInlinePairingScriptInSource(sourceCode, fileName = 'sidecar-server.ts') {
    const sf = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.ES2022, false);
    let targetNode = null;

    function visit(node) {
        if (targetNode) { return; }
        if (
            ts.isFunctionDeclaration(node)
            && node.name
            && node.name.text === 'renderStandalonePairingShellHtml'
            && node.body
        ) {
            for (const stmt of node.body.statements) {
                if (ts.isReturnStatement(stmt) && stmt.expression && ts.isTemplateExpression(stmt.expression)) {
                    targetNode = stmt.expression;
                    return;
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sf);
    if (!targetNode) { return sourceCode; }

    // Locate the <script>...</script> slice inside the template expression spanning `${JSON.stringify(safeEndpoint)}`
    const fullStart = targetNode.getStart(sf);
    const fullEnd = targetNode.getEnd();
    const rawTpl = sourceCode.slice(fullStart, fullEnd);
    const scriptOpen = rawTpl.indexOf('<script>');
    const scriptClose = rawTpl.lastIndexOf('</script>');
    if (scriptOpen < 0 || scriptClose <= scriptOpen) { return sourceCode; }

    const innerRaw = rawTpl.slice(scriptOpen + '<script>'.length, scriptClose);
    const exprMatches = [...innerRaw.matchAll(/\$\{([^}]+)\}/g)];
    if (exprMatches.length === 0) { return sourceCode; }

    let withSentinels = innerRaw;
    const rawExprs = [];
    for (let idx = 0; idx < exprMatches.length; idx++) {
        const sentinel = `__ACM_PAIR_EXPR_${idx}__`;
        if (innerRaw.includes(sentinel)) { return sourceCode; }
        rawExprs.push(exprMatches[idx][1]);
        withSentinels = withSentinels.replace(exprMatches[idx][0], () => sentinel);
    }

    let minified;
    try {
        minified = sanitizeInlineScriptBundle(
            esbuild.transformSync(withSentinels, {
                loader: 'js',
                minify: true,
                target: ['es2022', 'chrome120'],
                legalComments: 'none',
                charset: 'utf8',
            }).code.trim(),
        );
    } catch {
        return sourceCode;
    }

    for (let idx = 0; idx < rawExprs.length; idx++) {
        const sentinel = `__ACM_PAIR_EXPR_${idx}__`;
        if (!minified.includes(sentinel)) { return sourceCode; }
    }
    assertValidJsSyntax(minified.replace(/__ACM_PAIR_EXPR_\d+__/g, '""'), 'pairing-shell-script');

    let restored = minified;
    for (let idx = 0; idx < rawExprs.length; idx++) {
        restored = restored.replace(`__ACM_PAIR_EXPR_${idx}__`, () => `\${${rawExprs[idx]}}`);
    }
    if (restored.length >= innerRaw.length) { return sourceCode; }

    const absStart = fullStart + scriptOpen + '<script>'.length;
    const absEnd = fullStart + scriptClose;
    return sourceCode.slice(0, absStart) + restored + sourceCode.slice(absEnd);
}

/**
 * Losslessly compact static inline JS, JXA, PowerShell, Bash/sh, and XML/SVG
 * script templates at bundle time without modifying readable source files in git.
 */
export function compactScriptTemplatesInTsSource(sourceCode, fileName = 'file.ts') {
    const sf = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.ES2022, false);
    const edits = [];

    function isStaticArrayJoin(expr) {
        if (!ts.isCallExpression(expr)) { return null; }
        if (!ts.isPropertyAccessExpression(expr.expression) || expr.expression.name.text !== 'join') { return null; }
        if (!ts.isArrayLiteralExpression(expr.expression.expression)) { return null; }
        if (expr.arguments.length !== 1 || !ts.isStringLiteral(expr.arguments[0])) { return null; }
        return { arrayNode: expr.expression.expression, sep: expr.arguments[0].text };
    }

    function compactArrayElements(arrayNode, mode) {
        const out = [];
        for (let idx = 0; idx < arrayNode.elements.length; idx++) {
            const el = arrayNode.elements[idx];
            if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) {
                const text = el.text;
                const trimmed = text.trim();
                if (mode === 'shell') {
                    if (!trimmed) { continue; }
                    if (idx > 0 && trimmed.startsWith('#') && !trimmed.startsWith('#!')) { continue; }
                    // Preserve lines inside awk single-quoted blocks & line continuations safely by trimming leading spaces only
                    out.push(JSON.stringify(text.replace(/^[ \t]+/, '')));
                } else if (mode === 'ps') {
                    if (!trimmed || trimmed.startsWith('#')) { continue; }
                    out.push(JSON.stringify(trimmed));
                } else if (mode === 'xml') {
                    if (!trimmed) { continue; }
                    out.push(JSON.stringify(trimmed));
                } else {
                    out.push(sourceCode.slice(el.getStart(sf), el.getEnd()));
                }
            } else {
                // Keep template expressions / identifiers intact verbatim (just trim leading spaces in head if xml/shell)
                out.push(sourceCode.slice(el.getStart(sf), el.getEnd()));
            }
        }
        return out;
    }

    function visit(node) {
        // 1. Named const script arrays: MACOS_ICON_BADGE_JXA, WINDOWS_SHORTCUT_PS_SCRIPT, WINDOWS_EXE_REGISTRY_PS_SCRIPT, psScript
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            const name = node.name.text;
            const joinInfo = isStaticArrayJoin(node.initializer);
            if (joinInfo) {
                const allStaticStrings = joinInfo.arrayNode.elements.every(
                    (el) => ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el),
                );
                if (name === 'MACOS_ICON_BADGE_JXA' && allStaticStrings) {
                    const joined = joinInfo.arrayNode.elements.map((el) => el.text).join(joinInfo.sep);
                    try {
                        const min = esbuild.transformSync(joined, {
                            loader: 'js',
                            minify: true,
                            target: 'es2020',
                            legalComments: 'none',
                            charset: 'utf8',
                        }).code.trim();
                        assertValidJsSyntax(min, 'macos-icon-badge-jxa');
                        if (min.length < joined.length) {
                            edits.push({
                                start: node.initializer.getStart(sf),
                                end: node.initializer.getEnd(),
                                replacement: JSON.stringify(min),
                            });
                            return;
                        }
                    } catch {
                        // Fall through
                    }
                } else if ((name === 'WINDOWS_SHORTCUT_PS_SCRIPT' || name === 'WINDOWS_EXE_REGISTRY_PS_SCRIPT') && allStaticStrings) {
                    const compactedLines = joinInfo.arrayNode.elements
                        .map((el) => el.text.trim())
                        .filter((l) => l.length > 0 && !l.startsWith('#'));
                    const joined = compactedLines.join(joinInfo.sep);
                    edits.push({
                        start: node.initializer.getStart(sf),
                        end: node.initializer.getEnd(),
                        replacement: JSON.stringify(joined),
                    });
                    return;
                } else if (name === 'psScript') {
                    const elems = compactArrayElements(joinInfo.arrayNode, 'ps');
                    const repl = `[${elems.join(',')}].join(${JSON.stringify(joinInfo.sep)})`;
                    if (repl.length < node.initializer.getEnd() - node.initializer.getStart(sf)) {
                        edits.push({
                            start: node.initializer.getStart(sf),
                            end: node.initializer.getEnd(),
                            replacement: repl,
                        });
                        return;
                    }
                }
            }
        }

        // 2. Named function script builders
        if (ts.isFunctionDeclaration(node) && node.name && node.body) {
            const fnName = node.name.text;
            if (fnName === 'buildOverlayUnmountScript') {
                for (const stmt of node.body.statements) {
                    if (ts.isReturnStatement(stmt) && stmt.expression && ts.isTemplateExpression(stmt.expression)) {
                        const repl = minifyJsTemplateExpression(sourceCode, sf, stmt.expression, '__ACM_OV_U_', 'overlay-unmount');
                        if (repl && repl.length < stmt.expression.getEnd() - stmt.expression.getStart(sf)) {
                            edits.push({ start: stmt.expression.getStart(sf), end: stmt.expression.getEnd(), replacement: repl });
                            return;
                        }
                    }
                }
            } else if (fnName === 'buildOverlayUpdateScript') {
                for (const stmt of node.body.statements) {
                    if (ts.isReturnStatement(stmt) && stmt.expression && ts.isTemplateExpression(stmt.expression)) {
                        const start = stmt.expression.getStart(sf);
                        const end = stmt.expression.getEnd();
                        const raw = sourceCode.slice(start, end);
                        const compact = raw.replace(/\n\s*/g, '');
                        if (compact.length < raw.length) {
                            edits.push({ start, end, replacement: compact });
                            return;
                        }
                    }
                }
            } else if (fnName === 'buildMacOsLauncherScript' || fnName === 'buildLinuxLauncherScript') {
                for (const stmt of node.body.statements) {
                    if (ts.isReturnStatement(stmt) && stmt.expression) {
                        const joinInfo = isStaticArrayJoin(stmt.expression);
                        if (joinInfo) {
                            const elems = compactArrayElements(joinInfo.arrayNode, 'shell');
                            // Ensure trailing newline parity
                            elems.push('""');
                            const repl = `[${elems.join(',')}].join(${JSON.stringify(joinInfo.sep)})`;
                            if (repl.length < stmt.expression.getEnd() - stmt.expression.getStart(sf)) {
                                edits.push({
                                    start: stmt.expression.getStart(sf),
                                    end: stmt.expression.getEnd(),
                                    replacement: repl,
                                });
                                return;
                            }
                        }
                    }
                }
            } else if (fnName === 'buildMacOsInfoPlist' || fnName === 'buildLinuxBadgedSvg') {
                for (const stmt of node.body.statements) {
                    if (ts.isReturnStatement(stmt) && stmt.expression) {
                        const joinInfo = isStaticArrayJoin(stmt.expression);
                        if (joinInfo) {
                            const elems = compactArrayElements(joinInfo.arrayNode, 'xml');
                            const outSep = fnName === 'buildLinuxBadgedSvg' ? '' : joinInfo.sep;
                            if (outSep) { elems.push('""'); }
                            const repl = `[${elems.join(',')}].join(${JSON.stringify(outSep)})`;
                            if (repl.length < stmt.expression.getEnd() - stmt.expression.getStart(sf)) {
                                edits.push({
                                    start: stmt.expression.getStart(sf),
                                    end: stmt.expression.getEnd(),
                                    replacement: repl,
                                });
                                return;
                            }
                        }
                    }
                }
            }
        }

        ts.forEachChild(node, visit);
    }

    visit(sf);
    if (edits.length === 0) { return sourceCode; }

    edits.sort((a, b) => b.start - a.start);
    let result = sourceCode;
    let lastStart = Infinity;
    for (const edit of edits) {
        if (edit.end > lastStart) { continue; }
        result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
        lastStart = edit.start;
    }
    return result;
}

function buildCssPoolIndex(repoRoot) {
    const entries = [];
    const byAbsPath = new Map();
    let idx = 0;

    for (const relPath of CSS_POOL_SOURCE_FILES) {
        const absPath = resolve(repoRoot, relPath).replace(/\\/g, '/');
        if (!existsSync(absPath)) { continue; }
        const raw = readFileSync(absPath, 'utf8');
        CSS_FN_RE.lastIndex = 0;
        const fileEntries = [];
        for (const m of raw.matchAll(CSS_FN_RE)) {
            const fnName = m[2];
            const cssBody = m[4];
            try {
                const min = esbuild.transformSync(cssBody, {
                    loader: 'css',
                    minify: true,
                    legalComments: 'none',
                    charset: 'utf8',
                }).code.trim();
                const exportName = `c${idx++}`;
                const entry = {
                    relPath,
                    absPath,
                    fnName,
                    exportName,
                    code: min,
                    bytes: Buffer.byteLength(min, 'utf8'),
                };
                entries.push(entry);
                fileEntries.push(entry);
            } catch {
                // Skip invalid CSS block cleanly
            }
        }
        if (fileEntries.length > 0) {
            byAbsPath.set(absPath, fileEntries);
        }
    }

    const virtualSource = entries
        .map((e) => `export const ${e.exportName}=${JSON.stringify(e.code)};`)
        .join('\n') + '\n';

    return { entries, byAbsPath, virtualSource };
}

function extractHostBridgePoolChunks(sourceCode, fileName = 'host-bridge.ts') {
    const sf = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.ES2022, false);
    let targetNode = null;
    function visit(node) {
        if (targetNode) { return; }
        if (ts.isFunctionDeclaration(node) && node.name?.text === 'getHostBridgeScript' && node.body) {
            for (const stmt of node.body.statements) {
                if (ts.isReturnStatement(stmt) && stmt.expression && ts.isTemplateExpression(stmt.expression)) {
                    targetNode = stmt.expression;
                    return;
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(sf);
    if (!targetNode) { return null; }

    const rawExprs = [];
    const sentinels = [];
    const sentinelPrefix = '__ACM_HB_EXPR_';
    let cookedJs = targetNode.head.text;
    for (let idx = 0; idx < targetNode.templateSpans.length; idx++) {
        const span = targetNode.templateSpans[idx];
        const sentinel = `${sentinelPrefix}${idx}__`;
        sentinels.push(sentinel);
        rawExprs.push(sourceCode.slice(span.expression.getStart(sf), span.expression.getEnd()));
        cookedJs += sentinel + span.literal.text;
    }
    let minified;
    try {
        minified = sanitizeInlineScriptBundle(
            esbuild.transformSync(cookedJs, {
                loader: 'js',
                minify: true,
                target: ['es2022', 'chrome120'],
                legalComments: 'none',
                charset: 'utf8',
            }).code.trim(),
        );
    } catch {
        return null;
    }
    for (const sentinel of sentinels) {
        if (!minified.includes(sentinel)) { return null; }
    }
    assertValidJsSyntax(minified.replace(new RegExp(`${sentinelPrefix}\\d+__`, 'g'), '0'), 'host-bridge-inline');

    const staticChunks = [];
    const exprParts = [];
    const tokens = minified.split(new RegExp(`(${sentinelPrefix}\\d+__)`, 'g'));
    for (const tok of tokens) {
        if (!tok) { continue; }
        const m = new RegExp(`^${sentinelPrefix}(\\d+)__$`).exec(tok);
        if (m) {
            exprParts.push(`String(${rawExprs[Number.parseInt(m[1], 10)]})`);
        } else {
            const exportName = `bHb${staticChunks.length}`;
            staticChunks.push({ exportName, code: tok, bytes: Buffer.byteLength(tok, 'utf8') });
            exprParts.push(exportName);
        }
    }
    const start = targetNode.getStart(sf);
    const end = targetNode.getEnd();
    const importLine = `import { ${staticChunks.map((c) => c.exportName).join(', ')} } from '${BROWSER_POOL_VIRTUAL_ID}';\n`;
    const rewritten = importLine + `${sourceCode.slice(0, start)}(${exprParts.join(' + ')})${sourceCode.slice(end)}`;
    return {
        staticChunks,
        rewritten,
        totalBytes: staticChunks.reduce((sum, c) => sum + c.bytes, 0),
    };
}

function buildBrowserPoolIndex(repoRoot) {
    const clientAbsPath = resolve(repoRoot, 'src/client/generated/client-bundles.generated.ts').replace(/\\/g, '/');
    const hostBridgeAbsPath = resolve(repoRoot, 'src/app/host-bridge.ts').replace(/\\/g, '/');
    if (!existsSync(clientAbsPath)) { return null; }

    const clientSrc = readFileSync(clientAbsPath, 'utf8');
    const wvMatch = /export const WEBVIEW_CLIENT_BUNDLE = ("(?:[^"\\]|\\.)*");/.exec(clientSrc);
    const cdpMatch = /export const CDP_OVERLAY_CLIENT_BUNDLE = ("(?:[^"\\]|\\.)*");/.exec(clientSrc);
    if (!wvMatch || !cdpMatch) { return null; }

    const wvCode = JSON.parse(wvMatch[1]);
    const cdpCode = JSON.parse(cdpMatch[1]);
    const hbData = existsSync(hostBridgeAbsPath)
        ? extractHostBridgePoolChunks(readFileSync(hostBridgeAbsPath, 'utf8'), hostBridgeAbsPath)
        : null;

    // Order consecutively: WEBVIEW_CLIENT_BUNDLE -> host-bridge chunks -> CDP_OVERLAY_CLIENT_BUNDLE
    // so DEFLATE's 32 KB sliding window shares DOM/event/window identifiers across browser scripts,
    // while `sideEffects: false` lets esbuild tree-shake host-bridge & CDP out of IDE extension.js!
    const poolLines = [
        `export const bWebview=${JSON.stringify(wvCode)};`,
        ...(hbData ? hbData.staticChunks.map((c) => `export const ${c.exportName}=${JSON.stringify(c.code)};`) : []),
        `export const bCdp=${JSON.stringify(cdpCode)};`,
    ];
    const clientRewritten = `import { bWebview, bCdp } from '${BROWSER_POOL_VIRTUAL_ID}';\n`
        + clientSrc
            .replace(wvMatch[0], () => 'export const WEBVIEW_CLIENT_BUNDLE = bWebview;')
            .replace(cdpMatch[0], () => 'export const CDP_OVERLAY_CLIENT_BUNDLE = bCdp;');

    return {
        clientAbsPath,
        hostBridgeAbsPath,
        clientRewritten,
        wvBytes: Buffer.byteLength(wvCode, 'utf8'),
        cdpBytes: Buffer.byteLength(cdpCode, 'utf8'),
        hbData,
        virtualSource: poolLines.join('\n') + '\n',
    };
}

function createTemplateCompactorPlugin(repoRoot = REPO_ROOT, options = {}) {
    const useCssPool = options.useCssPool !== false;
    const useBrowserPool = options.useBrowserPool !== false;
    const compactPlatformScripts = options.compactPlatformScripts !== false;
    const cssPool = useCssPool ? buildCssPoolIndex(repoRoot) : null;
    const browserPool = useBrowserPool ? buildBrowserPoolIndex(repoRoot) : null;
    const usedCssEntriesByFile = new Map();
    const usedBrowserEntriesByFile = new Map();

    const plugin = {
        name: 'compact-css-and-html-templates',
        setup(build) {
            if (cssPool) {
                build.onResolve({ filter: /^virtual:acm-css-pool$/ }, () => ({
                    path: CSS_POOL_VIRTUAL_ID,
                    namespace: 'acm-css-pool',
                    sideEffects: false,
                }));
                build.onLoad({ filter: /.*/, namespace: 'acm-css-pool' }, () => ({
                    contents: cssPool.virtualSource,
                    loader: 'js',
                }));
            }
            if (browserPool) {
                build.onResolve({ filter: /^virtual:acm-browser-pool$/ }, () => ({
                    path: BROWSER_POOL_VIRTUAL_ID,
                    namespace: 'acm-browser-pool',
                    sideEffects: false,
                }));
                build.onLoad({ filter: /.*/, namespace: 'acm-browser-pool' }, () => ({
                    contents: browserPool.virtualSource,
                    loader: 'js',
                }));
            }

            build.onLoad({ filter: /\.ts$/ }, (args) => {
                const normalizedPath = args.path.replace(/\\/g, '/');

                // 0. Co-locate browser JS bundles & host-bridge script inside virtual:acm-browser-pool
                if (browserPool && normalizedPath === browserPool.clientAbsPath) {
                    return { contents: browserPool.clientRewritten, loader: 'ts' };
                }

                const raw = readFileSync(args.path, 'utf8');
                let contents = raw;
                let changed = false;

                // 1. Minify static CSS template functions with esbuild's CSS minifier
                //    (co-locating into virtual:acm-css-pool so DEFLATE's 32 KB sliding window
                //    compresses shared `--ed-*` tokens across all stylesheets losslessly!)
                const poolEntries = cssPool?.byAbsPath.get(normalizedPath);
                if (CSS_FN_RE.test(contents)) {
                    CSS_FN_RE.lastIndex = 0;
                    const importedNames = [];
                    contents = contents.replace(CSS_FN_RE, (full, prefix, fnName, prefixCall, cssBody, suffix) => {
                        const pooled = poolEntries?.find((e) => e.fnName === fnName);
                        if (pooled) {
                            importedNames.push(pooled.exportName);
                            const prev = usedCssEntriesByFile.get(pooled.relPath) || 0;
                            usedCssEntriesByFile.set(pooled.relPath, prev + pooled.bytes);
                            changed = true;
                            if (prefixCall) {
                                return `${prefix}(${prefixCall} + "\\n" + ${pooled.exportName})${suffix}`;
                            }
                            return `${prefix}${pooled.exportName}${suffix}`;
                        }
                        try {
                            const min = esbuild.transformSync(cssBody, {
                                loader: 'css',
                                minify: true,
                                legalComments: 'none',
                                charset: 'utf8',
                            }).code.trim();
                            changed = true;
                            if (prefixCall) {
                                return `${prefix}(${prefixCall} + "\\n" + ${JSON.stringify(min)})${suffix}`;
                            }
                            return `${prefix}${JSON.stringify(min)}${suffix}`;
                        } catch {
                            return full;
                        }
                    });
                    if (importedNames.length > 0) {
                        contents = `import { ${importedNames.join(', ')} } from '${CSS_POOL_VIRTUAL_ID}';\n${contents}`;
                    }
                } else {
                    CSS_FN_RE.lastIndex = 0;
                }

                // 2. Minify the browser-side host-bridge IIFE template at bundle time (zero source edits)
                //    and co-locate its static JS chunks inside virtual:acm-browser-pool when enabled.
                if (/(?:^|\/)src\/app\/host-bridge\.ts$/i.test(normalizedPath)) {
                    if (browserPool?.hbData && normalizedPath === browserPool.hostBridgeAbsPath) {
                        contents = browserPool.hbData.rewritten;
                        usedBrowserEntriesByFile.set('src/app/host-bridge.ts', browserPool.hbData.totalBytes);
                        changed = true;
                    } else {
                        const compactedBridge = minifyHostBridgeScriptInSource(contents, normalizedPath);
                        if (compactedBridge !== contents) {
                            contents = compactedBridge;
                            changed = true;
                        }
                    }
                }

                // 2b. Minify inline pairing <script> in sidecar-server.ts
                if (/(?:^|\/)src\/app\/sidecar-server\.ts$/i.test(normalizedPath)) {
                    const compactedPairing = minifyInlinePairingScriptInSource(contents, normalizedPath);
                    if (compactedPairing !== contents) {
                        contents = compactedPairing;
                        changed = true;
                    }
                }

                // 2c. Compact static JXA / PowerShell / Bash / XML / SVG / overlay JS templates
                if (
                    compactPlatformScripts
                    && /(?:^|\/)src\/(?:app\/(?:cdp-launcher|cdp-discovery|cdp-overlay-assets)|core\/cdp-launcher-core)\.ts$/i.test(normalizedPath)
                ) {
                    const compactedScripts = compactScriptTemplatesInTsSource(contents, normalizedPath);
                    if (compactedScripts !== contents) {
                        contents = compactedScripts;
                        changed = true;
                    }
                }

                // 3. Conservatively compact static HTML/inline-<style>/<script> templates in UI renderers
                if (HTML_TEMPLATE_FILE_RE.test(normalizedPath)) {
                    const compacted = compactHtmlTemplatesInTsSource(contents, normalizedPath);
                    if (compacted !== contents) {
                        contents = compacted;
                        changed = true;
                    }
                }

                if (!changed) { return null; }
                return { contents, loader: 'ts' };
            });
        },
    };

    return {
        plugin,
        getCssAttributionMap: () => new Map(usedCssEntriesByFile),
        getBrowserAttributionMap: () => new Map(usedBrowserEntriesByFile),
    };
}

function extractTopMetafileContributors(metafile, cssAttributionMap, browserAttributionMap, limit = 10) {
    const outputs = Object.values(metafile?.outputs || {});
    const primaryOut = outputs[0];
    if (!primaryOut || !primaryOut.inputs) {
        return { totalAttributedBytes: 0, cssPoolBytes: 0, topInputs: [] };
    }
    const totals = new Map();
    let cssPoolBytes = 0;
    let browserPoolBytes = 0;
    for (const [rawPath, info] of Object.entries(primaryOut.inputs)) {
        const normPath = rawPath.replace(/\\/g, '/');
        const bytes = Number(info?.bytesInOutput || 0);
        if (normPath.startsWith('acm-css-pool:')) {
            cssPoolBytes += bytes;
            continue;
        }
        if (normPath.startsWith('acm-browser-pool:')) {
            browserPoolBytes += bytes;
            continue;
        }
        totals.set(normPath, (totals.get(normPath) || 0) + bytes);
    }
    // Attribute co-located CSS bytes accurately back to their originating source files
    if (cssAttributionMap) {
        for (const [relPath, cssBytes] of cssAttributionMap.entries()) {
            totals.set(relPath, (totals.get(relPath) || 0) + cssBytes);
        }
    }
    // Attribute co-located browser JS pool bytes back to host-bridge.ts & client-bundles.generated.ts
    if (browserPoolBytes > 0) {
        let hbAttributed = 0;
        if (browserAttributionMap) {
            for (const [relPath, jsBytes] of browserAttributionMap.entries()) {
                totals.set(relPath, (totals.get(relPath) || 0) + jsBytes);
                hbAttributed += jsBytes;
            }
        }
        const clientRemainder = Math.max(0, browserPoolBytes - hbAttributed);
        if (clientRemainder > 0) {
            const clientKey = 'src/client/generated/client-bundles.generated.ts';
            totals.set(clientKey, (totals.get(clientKey) || 0) + clientRemainder);
        }
    }
    const sorted = [...totals.entries()]
        .map(([path, bytes]) => ({ path, bytes }))
        .sort((a, b) => b.bytes - a.bytes);
    const totalAttributedBytes = sorted.reduce((sum, entry) => sum + entry.bytes, 0);
    return {
        totalAttributedBytes,
        cssPoolBytes,
        topInputs: sorted.slice(0, limit),
    };
}

function assertValidJsSyntax(code, label) {
    try {
        new vm.Script(code, { filename: `${label}.js` });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`[build-bundles] Syntax validation failed for ${label}: ${msg}`);
    }
}

function assertValidEsmFileSyntax(filePath, label) {
    try {
        execFileSync(process.execPath, ['--check', filePath], {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
    } catch (err) {
        const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr || '') : String(err);
        throw new Error(`[build-bundles] ESM syntax check failed for ${label} (${filePath}): ${stderr.trim()}`);
    }
}

function assertCdpBundleSecurity(code, sourceCode) {
    for (const rule of FORBIDDEN_CDP_PATTERNS) {
        if (rule.re.test(code)) {
            throw new Error(
                `[build-bundles] Security violation in CDP overlay client bundle: forbidden construct "${rule.name}" detected.`,
            );
        }
    }
    const helperMatches = sourceCode.match(/function\s+isInsideUnfocusedPane\b/g) || [];
    if (helperMatches.length !== 1) {
        throw new Error(
            `[build-bundles] Expected exactly 1 isInsideUnfocusedPane helper in CDP overlay source, found ${helperMatches.length}.`,
        );
    }
}

export async function buildClientBundles(options = {}) {
    const repoRoot = options.repoRoot || REPO_ROOT;
    const stageClientDir = join(repoRoot, 'dist-stage', 'client');
    const generatedTsPath = join(repoRoot, 'src', 'client', 'generated', 'client-bundles.generated.ts');

    const [webviewResult, cdpResult] = await Promise.all([
        esbuild.build({
            entryPoints: [join(repoRoot, 'src', 'client', 'browser', 'webview-main.ts')],
            bundle: true,
            write: false,
            format: 'iife',
            globalName: '__ACM_WEBVIEW_FACTORY__',
            platform: 'browser',
            target: ['es2022', 'chrome120'],
            minify: true,
            legalComments: 'none',
            sourcemap: false,
            charset: 'utf8',
            plugins: [createZeroRuntimeDepsPlugin([], 'webview-client')],
        }),
        esbuild.build({
            entryPoints: [join(repoRoot, 'src', 'client', 'browser', 'cdp-overlay-main.ts')],
            bundle: true,
            write: false,
            format: 'iife',
            globalName: '__ACM_CDP_OVERLAY_FACTORY__',
            platform: 'browser',
            target: ['es2022', 'chrome120'],
            minify: true,
            legalComments: 'none',
            sourcemap: false,
            charset: 'utf8',
            plugins: [createZeroRuntimeDepsPlugin([], 'cdp-overlay-client')],
        }),
    ]);

    const rawWebviewJs = webviewResult.outputFiles[0]?.text ?? '';
    const rawCdpJs = cdpResult.outputFiles[0]?.text ?? '';
    if (!rawWebviewJs.trim()) {
        throw new Error('[build-bundles] Empty WebView client bundle output.');
    }
    if (!rawCdpJs.trim()) {
        throw new Error('[build-bundles] Empty CDP overlay client bundle output.');
    }

    const webviewJs = sanitizeInlineScriptBundle(rawWebviewJs).trim();
    const cdpJs = sanitizeInlineScriptBundle(rawCdpJs).trim();
    const cdpSourceCode = readFileSync(join(repoRoot, 'src', 'client', 'browser', 'cdp-overlay-main.ts'), 'utf8');

    assertValidJsSyntax(webviewJs, 'webview-client');
    assertValidJsSyntax(cdpJs, 'cdp-overlay-client');
    assertCdpBundleSecurity(cdpJs, cdpSourceCode);

    if (/<\/script/i.test(webviewJs) || /<!--/.test(webviewJs)) {
        throw new Error('[build-bundles] Unescaped script/comment sequence detected in WebView client bundle.');
    }
    if (/<\/script/i.test(cdpJs) || /<!--/.test(cdpJs)) {
        throw new Error('[build-bundles] Unescaped script/comment sequence detected in CDP overlay client bundle.');
    }

    const webviewBuildId = computeBuildId(webviewJs);
    const cdpBuildId = computeBuildId(cdpJs);

    mkdirSync(stageClientDir, { recursive: true });
    writeFileSync(join(stageClientDir, 'webview-client.js'), webviewJs + '\n', 'utf8');
    writeFileSync(join(stageClientDir, 'cdp-overlay-client.js'), cdpJs + '\n', 'utf8');

    const manifest = {
        webview: {
            file: 'webview-client.js',
            buildId: webviewBuildId,
            bytes: Buffer.byteLength(webviewJs, 'utf8'),
        },
        cdpOverlay: {
            file: 'cdp-overlay-client.js',
            buildId: cdpBuildId,
            bytes: Buffer.byteLength(cdpJs, 'utf8'),
        },
    };
    writeFileSync(join(stageClientDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    const generatedTs = [
        '/* eslint-disable */',
        '// AUTO-GENERATED by scripts/build-bundles.mjs — DO NOT EDIT MANUALLY.',
        '// Source entries: src/client/browser/webview-main.ts & src/client/browser/cdp-overlay-main.ts',
        '',
        `export const WEBVIEW_CLIENT_BUILD_ID = ${JSON.stringify(webviewBuildId)};`,
        `export const WEBVIEW_CLIENT_BUNDLE = ${JSON.stringify(webviewJs)};`,
        `export const CDP_OVERLAY_CLIENT_BUILD_ID = ${JSON.stringify(cdpBuildId)};`,
        `export const CDP_OVERLAY_CLIENT_BUNDLE = ${JSON.stringify(cdpJs)};`,
        '',
    ].join('\n');

    writeIfChanged(generatedTsPath, generatedTs);

    return {
        stageClientDir,
        generatedTsPath,
        webviewBuildId,
        webviewBytes: manifest.webview.bytes,
        cdpBuildId,
        cdpBytes: manifest.cdpOverlay.bytes,
    };
}

/**
 * Pool long static strings after tree-shaking. Node decodes one UTF-8 table
 * of UI text and assets. Host logic stays ordinary inspectable CommonJS.
 */
export function packStaticText(bundle) {
    const name = '__acmStaticText';
    if (bundle.includes(name)) { throw new Error('Static text binding collision'); }
    const source = ts.createSourceFile('bundle.js', bundle, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const strings = new Map();
    const chunks = [];
    let offset = 0;

    function visit(node) {
        // Tagged templates expose raw spellings, including invalid cooked escapes.
        if (ts.isTaggedTemplateExpression(node)) { return; }
        const fragment = ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
        if ((fragment || ts.isStringLiteralLike(node)) && Buffer.byteLength(node.text) >= 64
            && node.parent.name !== node && !ts.isExpressionStatement(node.parent)) {
            let index = strings.get(node.text);
            if (index === undefined) {
                index = strings.size;
                strings.set(node.text, index);
            }
            const ref = `${name}[${index}]`;
            const start = node.getStart(source);
            const end = node.getEnd();
            if (fragment) {
                chunks.push(bundle.slice(offset, start + 1), '${' + ref + '}');
                offset = end - (ts.isTemplateTail(node) ? 1 : 2);
            } else {
                chunks.push(bundle.slice(offset, start), '(' + ref + ')');
                offset = end;
            }
            return;
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    if (strings.size === 0) { return bundle; }
    chunks.push(bundle.slice(offset));
    const data = brotliCompressSync(Buffer.from(JSON.stringify([...strings.keys()])), {
        params: {
            [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
            [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        },
    }).toString('base64');
    return `"use strict";const ${name}=JSON.parse(require("node:zlib").brotliDecompressSync(Buffer.from("${data}","base64")).toString("utf8"));\n` + chunks.join('');
}

export async function buildIdeBundle(options = {}) {
    const repoRoot = options.repoRoot || REPO_ROOT;
    const version = readPackageVersion(repoRoot);
    const stageIdeDir = options.stageIdeDir || join(repoRoot, 'dist-stage', 'ide');
    const outFile = join(stageIdeDir, 'extension.js');
    mkdirSync(stageIdeDir, { recursive: true });
    const compactor = createTemplateCompactorPlugin(repoRoot);

    const result = await esbuild.build({
        entryPoints: [join(repoRoot, 'src', 'extension.ts')],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        minify: true,
        sourcemap: false,
        legalComments: 'none',
        charset: 'utf8',
        metafile: true,
        external: ['vscode', 'node:sqlite'],
        define: {
            __ACM_APP_VERSION__: JSON.stringify(version),
        },
        plugins: [
            compactor.plugin,
            createZeroRuntimeDepsPlugin(['vscode', 'node:sqlite'], 'ide-extension'),
        ],
    });

    const inputPaths = Object.keys(result.metafile?.inputs || {})
        .map((p) => p.replace(/\\/g, '/'))
        .filter((p) => !p.startsWith('acm-css-pool:') && !p.startsWith('acm-browser-pool:'));
    const forbiddenIdeInputs = inputPaths.filter((p) => (
        /(^|\/)src\/app\/sidecar-runtime\.ts$/.test(p)
        || /(^|\/)src\/app\/sidecar-server\.ts$/.test(p)
    ));
    if (forbiddenIdeInputs.length > 0) {
        throw new Error(
            `[build-bundles] IDE extension bundle unexpectedly imported App Sidecar modules: ${forbiddenIdeInputs.join(', ')}`,
        );
    }

    const rawBundle = result.outputFiles[0]?.text ?? '';
    const coreBundle = esbuild.transformSync(packStaticText(rawBundle), {
        format: 'cjs',
        loader: 'js',
        minify: true,
        target: 'node20',
        legalComments: 'none',
        charset: 'utf8',
    }).code;
    const buildId = computeBuildId(coreBundle);
    const finalBundle = `${coreBundle}\nif(typeof module!=="undefined"&&module.exports){module.exports.ACM_BUILD_ID=${JSON.stringify(buildId)};module.exports.ACM_VERSION=${JSON.stringify(version)};}\n`;
    writeFileSync(outFile, finalBundle, 'utf8');

    const bytes = statSync(outFile).size;
    const metaSummary = extractTopMetafileContributors(
        result.metafile,
        compactor.getCssAttributionMap(),
        compactor.getBrowserAttributionMap(),
        10,
    );
    const manifest = {
        target: 'ide',
        version,
        buildId,
        entry: 'extension.js',
        bytes,
        inputCount: inputPaths.length,
        cssPoolBytes: metaSummary.cssPoolBytes,
        topInputs: metaSummary.topInputs,
    };
    writeFileSync(join(stageIdeDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    return {
        stageIdeDir,
        outFile,
        version,
        buildId,
        bytes,
        inputCount: inputPaths.length,
        cssPoolBytes: metaSummary.cssPoolBytes,
        topInputs: metaSummary.topInputs,
    };
}

export async function buildAppSidecarBundle(options = {}) {
    const repoRoot = options.repoRoot || REPO_ROOT;
    const version = readPackageVersion(repoRoot);
    const stageAppDir = options.stageAppDir || join(repoRoot, 'dist-stage', 'app');
    const bundleFile = join(stageAppDir, 'sidecar-bundle.js');
    const serverShimFile = join(stageAppDir, 'sidecar-server.js');
    const runtimeShimFile = join(stageAppDir, 'sidecar-runtime.js');
    mkdirSync(stageAppDir, { recursive: true });
    const compactor = createTemplateCompactorPlugin(repoRoot);

    // Explicit exports (never `import *` / `export *`) so esbuild cleanly tree-shakes
    // unreferenced server/runtime helpers such as createFallbackSidecarProvider.
    const virtualEntry = [
        "import { createSidecarHandler, startStandaloneServer } from './src/app/sidecar-server';",
        "import { createSidecarRuntimeProvider } from './src/app/sidecar-runtime';",
        'export const ACM_REAL_PROVIDER = true;',
        `export const ACM_VERSION = ${JSON.stringify(version)};`,
        'export const server = { createSidecarHandler, startStandaloneServer };',
        'export const runtime = { createSidecarRuntimeProvider };',
    ].join('\n');

    const result = await esbuild.build({
        stdin: {
            contents: virtualEntry,
            resolveDir: repoRoot,
            sourcefile: 'sidecar-bundle-entry.ts',
            loader: 'ts',
        },
        bundle: true,
        outfile: bundleFile,
        platform: 'node',
        format: 'cjs',
        target: 'node22',
        minify: true,
        sourcemap: false,
        legalComments: 'none',
        charset: 'utf8',
        metafile: true,
        external: ['node:sqlite'],
        define: {
            __ACM_APP_VERSION__: JSON.stringify(version),
        },
        plugins: [
            compactor.plugin,
            createZeroRuntimeDepsPlugin(['node:sqlite'], 'app-sidecar', { allowLazyVscodeRequire: true }),
        ],
    });

    const inputPaths = Object.keys(result.metafile?.inputs || {})
        .map((p) => p.replace(/\\/g, '/'))
        .filter((p) => !p.startsWith('acm-css-pool:') && !p.startsWith('acm-browser-pool:'));
    const forbiddenAppInputs = inputPaths.filter((p) => (
        /(^|\/)src\/extension\.ts$/.test(p)
        || /(^|\/)src\/webview-panel\.ts$/.test(p)
    ));
    if (forbiddenAppInputs.length > 0) {
        throw new Error(
            `[build-bundles] App Sidecar bundle unexpectedly imported IDE-only modules: ${forbiddenAppInputs.join(', ')}`,
        );
    }

    const rawBundleContent = readFileSync(bundleFile, 'utf8');
    const bundleContent = esbuild.transformSync(packStaticText(rawBundleContent), {
        format: 'cjs',
        loader: 'js',
        minify: true,
        target: 'node22',
        legalComments: 'none',
        charset: 'utf8',
    }).code;
    writeFileSync(bundleFile, bundleContent, 'utf8');
    // A same-version fix in the sidecar entrypoint also requires a host reload.
    const entryHash = computeBuildId(readFileSync(join(repoRoot, 'app-plugin', 'sidecars', 'context_monitor', 'main.mjs')));
    const buildId = computeBuildId(entryHash + bundleContent);

    const serverShim = [
        "'use strict';",
        "const bundle = require('./sidecar-bundle.js');",
        `module.exports = Object.assign({}, bundle.server, { ACM_BUILD_ID: ${JSON.stringify(buildId)}, ACM_VERSION: ${JSON.stringify(version)} });`,
        '',
    ].join('\n');

    const runtimeShim = [
        "'use strict';",
        "const bundle = require('./sidecar-bundle.js');",
        `module.exports = Object.assign({}, bundle.runtime, { ACM_REAL_PROVIDER: bundle.ACM_REAL_PROVIDER === true, ACM_BUILD_ID: ${JSON.stringify(buildId)}, ACM_VERSION: ${JSON.stringify(version)} });`,
        '',
    ].join('\n');

    writeFileSync(serverShimFile, serverShim, 'utf8');
    writeFileSync(runtimeShimFile, runtimeShim, 'utf8');

    const bundleBytes = statSync(bundleFile).size;
    const totalBytes = bundleBytes + statSync(serverShimFile).size + statSync(runtimeShimFile).size;
    const metaSummary = extractTopMetafileContributors(
        result.metafile,
        compactor.getCssAttributionMap(),
        compactor.getBrowserAttributionMap(),
        10,
    );
    const manifest = {
        target: 'app-sidecar',
        version,
        buildId,
        realProviderMarker: 'ACM_REAL_PROVIDER',
        files: ['sidecar-bundle.js', 'sidecar-server.js', 'sidecar-runtime.js'],
        bundleBytes,
        totalBytes,
        inputCount: inputPaths.length,
        cssPoolBytes: metaSummary.cssPoolBytes,
        topInputs: metaSummary.topInputs,
    };
    writeFileSync(join(stageAppDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    return {
        stageAppDir,
        bundleFile,
        serverShimFile,
        runtimeShimFile,
        version,
        buildId,
        bundleBytes,
        totalBytes,
        inputCount: inputPaths.length,
        cssPoolBytes: metaSummary.cssPoolBytes,
        topInputs: metaSummary.topInputs,
    };
}

export async function buildInstallerBundle(options = {}) {
    const repoRoot = options.repoRoot || REPO_ROOT;
    const version = readPackageVersion(repoRoot);
    const outFile = options.outFile || join(repoRoot, 'scripts', 'install-app-plugin.mjs');

    const result = await esbuild.build({
        entryPoints: [join(repoRoot, 'src', 'cli', 'install-app-plugin-entry.ts')],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        minify: true,
        sourcemap: false,
        legalComments: 'none',
        charset: 'utf8',
        metafile: true,
        banner: {
            js: '#!/usr/bin/env node\n// AUTO-GENERATED from src/cli/install-app-plugin-entry.ts via scripts/build-bundles.mjs — DO NOT EDIT MANUALLY.',
        },
        define: {
            __ACM_IMPORT_META_URL__: 'import.meta.url',
            __ACM_IMPORT_META_MAIN__: 'import.meta.main',
            __ACM_APP_VERSION__: JSON.stringify(version),
        },
        plugins: [
            createZeroRuntimeDepsPlugin([], 'installer-cli'),
        ],
    });

    const outputText = result.outputFiles[0]?.text ?? '';
    if (!outputText.trim()) {
        throw new Error('[build-bundles] Empty install-app-plugin.mjs bundle output.');
    }

    writeIfChanged(outFile, outputText);
    ensureExecutable(outFile);
    assertValidEsmFileSyntax(outFile, 'install-app-plugin.mjs');

    const bytes = statSync(outFile).size;
    const buildId = computeBuildId(outputText);
    const inputCount = Object.keys(result.metafile?.inputs || {}).length;
    return {
        outFile,
        version,
        buildId,
        bytes,
        inputCount,
    };
}

export async function buildStatuslineBundle(options = {}) {
    const repoRoot = options.repoRoot || REPO_ROOT;
    const version = readPackageVersion(repoRoot);
    const outFile = options.outFile || join(repoRoot, 'app-plugin', 'bin', 'agy-statusline.mjs');

    const result = await esbuild.build({
        entryPoints: [join(repoRoot, 'src', 'cli', 'agy-statusline-entry.ts')],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        minify: true,
        sourcemap: false,
        legalComments: 'none',
        charset: 'utf8',
        metafile: true,
        banner: {
            js: '#!/usr/bin/env node\n// AUTO-GENERATED from src/cli/agy-statusline-entry.ts via scripts/build-bundles.mjs — DO NOT EDIT MANUALLY.',
        },
        define: {
            __ACM_IMPORT_META_URL__: 'import.meta.url',
            __ACM_IMPORT_META_MAIN__: 'import.meta.main',
            __ACM_APP_VERSION__: JSON.stringify(version),
        },
        plugins: [
            createZeroRuntimeDepsPlugin([], 'agy-statusline'),
        ],
    });

    const outputText = result.outputFiles[0]?.text ?? '';
    if (!outputText.trim()) {
        throw new Error('[build-bundles] Empty agy-statusline.mjs bundle output.');
    }

    writeIfChanged(outFile, outputText);
    ensureExecutable(outFile);
    assertValidEsmFileSyntax(outFile, 'agy-statusline.mjs');

    const bytes = statSync(outFile).size;
    const buildId = computeBuildId(outputText);
    const inputCount = Object.keys(result.metafile?.inputs || {}).length;
    return {
        outFile,
        version,
        buildId,
        bytes,
        inputCount,
    };
}

export async function buildAllBundles(options = {}) {
    const client = await buildClientBundles(options);
    if (options.clientOnly) {
        return { client, ide: null, app: null, installer: null, statusline: null };
    }
    const [ide, app, installer, statusline] = await Promise.all([
        buildIdeBundle(options),
        buildAppSidecarBundle(options),
        buildInstallerBundle(options),
        buildStatuslineBundle(options),
    ]);
    return { client, ide, app, installer, statusline };
}

function formatKb(bytes) {
    return `${(bytes / 1024).toFixed(1)} KB`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = new Set(process.argv.slice(2));
    const clientOnly = args.has('--client-only');
    const jsonMode = args.has('--json');

    buildAllBundles({ clientOnly })
        .then((res) => {
            if (jsonMode) {
                process.stdout.write(JSON.stringify(res, null, 2) + '\n');
                return;
            }
            console.log('[build-bundles] Client bundles built:');
            console.log(`  WebView client : ${formatKb(res.client.webviewBytes)} (buildId=${res.client.webviewBuildId})`);
            console.log(`  CDP overlay    : ${formatKb(res.client.cdpBytes)} (buildId=${res.client.cdpBuildId})`);
            if (res.ide) {
                console.log(`[build-bundles] IDE extension bundle : ${formatKb(res.ide.bytes)} (buildId=${res.ide.buildId}, inputs=${res.ide.inputCount})`);
            }
            if (res.app) {
                console.log(`[build-bundles] App Sidecar bundle   : ${formatKb(res.app.totalBytes)} (buildId=${res.app.buildId}, inputs=${res.app.inputCount})`);
            }
            if (res.installer) {
                console.log(`[build-bundles] Installer CLI bundle : ${formatKb(res.installer.bytes)} (buildId=${res.installer.buildId}, inputs=${res.installer.inputCount})`);
            }
            if (res.statusline) {
                console.log(`[build-bundles] agy-statusline CLI   : ${formatKb(res.statusline.bytes)} (buildId=${res.statusline.buildId}, inputs=${res.statusline.inputCount})`);
            }
            if (res.app?.topInputs?.length) {
                console.log('[build-bundles] App Sidecar top-10 esbuild contributors (post-compaction):');
                for (let i = 0; i < res.app.topInputs.length; i++) {
                    const item = res.app.topInputs[i];
                    console.log(`  ${String(i + 1).padStart(2)}. ${formatKb(item.bytes).padStart(8)}  ${item.path}`);
                }
            }
            if (res.ide?.topInputs?.length) {
                console.log('[build-bundles] IDE extension top-10 esbuild contributors (post-compaction):');
                for (let i = 0; i < res.ide.topInputs.length; i++) {
                    const item = res.ide.topInputs[i];
                    console.log(`  ${String(i + 1).padStart(2)}. ${formatKb(item.bytes).padStart(8)}  ${item.path}`);
                }
            }
        })
        .catch((err) => {
            console.error(`[build-bundles] ERROR: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(1);
        });
}

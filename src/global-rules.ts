// ─── Antigravity Global Rules File Manager ───────────────────────────────────
// Pure Node/TypeScript reader/writer/validator for Antigravity's machine-global
// rules file (`~/.gemini/GEMINI.md`) shared by the Antigravity IDE extension,
// the App Sidecar runtime, and unit tests. ZERO `vscode` imports.
//
// Security & Reliability Invariants:
//   - Hard 200 KiB cap (`GLOBAL_RULES_MAX_BYTES = 200 * 1024`) consistent across
//     IDE and App Sidecar `/api/action` (256 KiB JSON body limit).
//   - Symlink-escape rejection: refuses to read, write, open, or reveal when
//     `~/.gemini/GEMINI.md` is a symlink escaping `~/.gemini/` or a broken symlink.
//   - Capped FD reads: never buffers more than `GLOBAL_RULES_MAX_BYTES + 1` bytes
//     even under TOCTOU file growth.
//   - Atomic writes: validates byte limit and symlink safety BEFORE any disk
//     mutation, writes to a unique temp file inside `~/.gemini/`, and renames
//     atomically (with Windows `EPERM`/`EBUSY` fallback & guaranteed temp cleanup).
//   - Exact reveal validator: permits ONLY `~/.gemini/GEMINI.md` (verified inside
//     `~/.gemini/`) OR `~/.gemini/` itself ONLY when `GEMINI.md` does not exist yet.
//     NEVER widens reveal allowlists to arbitrary sibling files under `~/.gemini/`.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Hard cap (bytes) for reading/writing the global rules file inline (200 KiB). */
export const GLOBAL_RULES_MAX_BYTES = 200 * 1024;

/** Filename of Antigravity's machine-global rules file inside `~/.gemini/`. */
export const GLOBAL_RULES_FILE_NAME = 'GEMINI.md';

/** Bilingual starter template written when the rules file does not exist yet on Open File. */
export const DEFAULT_GLOBAL_RULES_TEMPLATE = [
    '# Global Rules',
    '',
    '<!-- Antigravity 全局规则（对所有工作区的所有会话生效）。 -->',
    '<!-- Antigravity global rules — applied to every conversation in every workspace. -->',
    '',
].join('\n');

/** Read/write snapshot of the global rules file exposed to the Settings tab. */
export interface GlobalRulesStatus {
    /** Absolute path (or redacted `~/.gemini/GEMINI.md` when privacy-masked by host). */
    path: string;
    /** Whether the file currently exists as a valid regular file inside `~/.gemini/`. */
    exists: boolean;
    /** Byte size of the file on disk (`0` when missing or rejected). */
    sizeBytes: number;
    /** UTF-8 file content (empty when missing, unreadable, `tooLarge`, `includeContent: false`, or rejected). */
    content: string;
    /** True when the file exists but exceeds `GLOBAL_RULES_MAX_BYTES` and cannot be safely edited inline. */
    tooLarge: boolean;
    /** Optional machine-readable error code when a security check rejects the file (e.g. `'SYMLINK_ESCAPE'`). */
    error?: string;
}

/** Exact validation outcome for revealing/opening `~/.gemini/GEMINI.md` (or `~/.gemini/` when missing). */
export interface GlobalRulesRevealValidation {
    ok: boolean;
    resolvedPath?: string;
    isDirectory?: boolean;
    exists?: boolean;
    statusCode?: number;
    error?: string;
}

function resolveHomeDir(homedir?: string): string {
    return typeof homedir === 'string' && homedir.trim()
        ? homedir.trim()
        : os.homedir();
}

/** Resolve the `~/.gemini` directory path. */
export function getGlobalRulesDir(homedir?: string): string {
    return path.join(resolveHomeDir(homedir), '.gemini');
}

/** Resolve the absolute path of Antigravity's global rules file (`~/.gemini/GEMINI.md`). */
export function getGlobalRulesPath(homedir?: string): string {
    return path.join(getGlobalRulesDir(homedir), GLOBAL_RULES_FILE_NAME);
}

function stripWindowsExtendedPrefix(p: string): string {
    if (/^\\\\\?\\UNC\\/i.test(p)) {
        return `\\\\${p.slice('\\\\?\\UNC\\'.length)}`;
    }
    if (/^\\\\\?\\[a-zA-Z]:[\\/]/.test(p)) {
        return p.slice('\\\\?\\'.length);
    }
    return p;
}

function extractWindowsAnchor(p: string): string | null {
    const normalized = stripWindowsExtendedPrefix(p).replace(/\//g, '\\');
    const unc = normalized.match(/^\\\\([^\\]+)\\([^\\]+)/);
    if (unc) {
        return `\\\\${unc[1].toLowerCase()}\\${unc[2].toLowerCase()}`;
    }
    const drive = normalized.match(/^([a-zA-Z]:)\\/);
    if (drive) {
        return `${drive[1].toLowerCase()}\\`;
    }
    return null;
}

function isCanonicalPathInsideDir(
    realTarget: string,
    realDir: string,
    platform: NodeJS.Platform = process.platform,
): boolean {
    if (platform === 'win32') {
        const cleanTarget = stripWindowsExtendedPrefix(realTarget);
        const cleanDir = stripWindowsExtendedPrefix(realDir);
        const targetAnchor = extractWindowsAnchor(cleanTarget);
        const dirAnchor = extractWindowsAnchor(cleanDir);
        if (!targetAnchor || !dirAnchor || targetAnchor !== dirAnchor) {
            return false;
        }
        const rel = path.win32.relative(cleanDir.toLowerCase(), cleanTarget.toLowerCase());
        return rel === '' || (!rel.startsWith('..') && !path.win32.isAbsolute(rel));
    }
    const rel = path.relative(realDir, realTarget);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function safeRealpath(targetPath: string): string {
    return typeof fs.realpathSync.native === 'function'
        ? fs.realpathSync.native(targetPath)
        : fs.realpathSync(targetPath);
}

type TargetInspection =
    | { kind: 'missing'; geminiDir: string; rulesPath: string }
    | { kind: 'symlink_escape'; geminiDir: string; rulesPath: string }
    | { kind: 'not_file'; geminiDir: string; rulesPath: string }
    | { kind: 'unreadable'; geminiDir: string; rulesPath: string }
    | { kind: 'file'; geminiDir: string; rulesPath: string; realGeminiDir: string; realPath: string; stat: fs.Stats };

function inspectGlobalRulesTarget(homedir?: string): TargetInspection {
    const geminiDir = getGlobalRulesDir(homedir);
    const rulesPath = getGlobalRulesPath(homedir);

    let dirLstat: fs.Stats | null = null;
    try {
        dirLstat = fs.lstatSync(geminiDir);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return { kind: 'missing', geminiDir, rulesPath };
        }
        return { kind: 'unreadable', geminiDir, rulesPath };
    }
    if (dirLstat.isSymbolicLink()) {
        return { kind: 'symlink_escape', geminiDir, rulesPath };
    }
    if (!dirLstat.isDirectory()) {
        return { kind: 'not_file', geminiDir, rulesPath };
    }

    let lstat: fs.Stats;
    try {
        lstat = fs.lstatSync(rulesPath);
    } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return { kind: 'missing', geminiDir, rulesPath };
        }
        return { kind: 'unreadable', geminiDir, rulesPath };
    }

    // Reject ANY symlink at ~/.gemini/GEMINI.md (including sibling symlinks like config.json).
    if (lstat.isSymbolicLink()) {
        return { kind: 'symlink_escape', geminiDir, rulesPath };
    }
    if (!lstat.isFile()) {
        return { kind: 'not_file', geminiDir, rulesPath };
    }

    let realGeminiDir: string;
    let realTarget: string;
    try {
        realGeminiDir = safeRealpath(geminiDir);
        realTarget = safeRealpath(rulesPath);
    } catch {
        return { kind: 'unreadable', geminiDir, rulesPath };
    }
    if (!isCanonicalPathInsideDir(realTarget, realGeminiDir)) {
        return { kind: 'symlink_escape', geminiDir, rulesPath };
    }
    const expectedExact = path.join(realGeminiDir, GLOBAL_RULES_FILE_NAME);
    const exactMatch = process.platform === 'win32'
        ? realTarget.toLowerCase() === expectedExact.toLowerCase()
        : realTarget === expectedExact;
    if (!exactMatch) {
        return { kind: 'symlink_escape', geminiDir, rulesPath };
    }
    return { kind: 'file', geminiDir, rulesPath, realGeminiDir, realPath: realTarget, stat: lstat };
}

function readFileCappedUtf8(
    filePath: string,
    maxBytes: number,
    expectedStat?: { dev: number; ino: number },
): { ok: true; content: string; sizeBytes: number; tooLarge: boolean } | { ok: false; errorCode: string } {
    let fd: number | null = null;
    try {
        const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
        const flags = process.platform === 'win32' ? 'r' : (fs.constants.O_RDONLY | noFollow);
        fd = fs.openSync(filePath, flags);
        const fstat = fs.fstatSync(fd);
        if (!fstat.isFile()) {
            return { ok: false, errorCode: 'READ_FAILED' };
        }
        if (expectedStat && expectedStat.ino > 0 && (fstat.dev !== expectedStat.dev || fstat.ino !== expectedStat.ino)) {
            return { ok: false, errorCode: 'SYMLINK_ESCAPE' };
        }
        const statSize = Number.isFinite(fstat.size) ? fstat.size : 0;
        if (statSize > maxBytes) {
            return { ok: true, content: '', sizeBytes: statSize, tooLarge: true };
        }
        const capPlusOne = maxBytes + 1;
        const buf = Buffer.allocUnsafe(Math.min(capPlusOne, Math.max(4096, statSize + 1)));
        const chunks: Buffer[] = [];
        let total = 0;
        while (total < capPlusOne) {
            const toRead = Math.min(buf.length, capPlusOne - total);
            const n = fs.readSync(fd, buf, 0, toRead, null);
            if (n <= 0) { break; }
            chunks.push(Buffer.from(buf.subarray(0, n)));
            total += n;
        }
        if (total > maxBytes) {
            return { ok: true, content: '', sizeBytes: Math.max(statSize, total), tooLarge: true };
        }
        const combined = total > 0 ? Buffer.concat(chunks, total) : Buffer.alloc(0);
        return {
            ok: true,
            content: combined.toString('utf8'),
            sizeBytes: combined.length,
            tooLarge: false,
        };
    } catch (err) {
        const code = (err as NodeJS.ErrnoException | undefined)?.code;
        return { ok: false, errorCode: code === 'ELOOP' ? 'SYMLINK_ESCAPE' : 'READ_FAILED' };
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch { /* ignore */ }
        }
    }
}

export function readGlobalRulesStatus(options?: { homedir?: string; includeContent?: boolean }): GlobalRulesStatus {
    const inspected = inspectGlobalRulesTarget(options?.homedir);
    const includeContent = options?.includeContent !== false;

    if (inspected.kind === 'symlink_escape') {
        return {
            path: inspected.rulesPath,
            exists: false,
            sizeBytes: 0,
            content: '',
            tooLarge: false,
            error: 'SYMLINK_ESCAPE',
        };
    }
    if (inspected.kind === 'unreadable') {
        return {
            path: inspected.rulesPath,
            exists: true,
            sizeBytes: 0,
            content: '',
            tooLarge: false,
            error: 'READ_FAILED',
        };
    }
    if (inspected.kind !== 'file') {
        return {
            path: inspected.rulesPath,
            exists: false,
            sizeBytes: 0,
            content: '',
            tooLarge: false,
        };
    }

    const sizeBytes = Number.isFinite(inspected.stat.size) ? inspected.stat.size : 0;
    const tooLarge = sizeBytes > GLOBAL_RULES_MAX_BYTES;
    if (!includeContent || tooLarge) {
        return {
            path: inspected.rulesPath,
            exists: true,
            sizeBytes,
            content: '',
            tooLarge,
        };
    }

    const readRes = readFileCappedUtf8(inspected.realPath, GLOBAL_RULES_MAX_BYTES, {
        dev: inspected.stat.dev,
        ino: inspected.stat.ino,
    });
    if (!readRes.ok) {
        return {
            path: inspected.rulesPath,
            exists: readRes.errorCode === 'SYMLINK_ESCAPE' ? false : true,
            sizeBytes: readRes.errorCode === 'SYMLINK_ESCAPE' ? 0 : sizeBytes,
            content: '',
            tooLarge: false,
            error: readRes.errorCode,
        };
    }
    return {
        path: inspected.rulesPath,
        exists: true,
        sizeBytes: readRes.sizeBytes,
        content: readRes.tooLarge ? '' : readRes.content,
        tooLarge: readRes.tooLarge,
    };
}

function isWindowsTransientRenameError(err: unknown): boolean {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return process.platform === 'win32' && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES');
}

function atomicReplaceFile(tmpPath: string, targetPath: string): void {
    try {
        fs.renameSync(tmpPath, targetPath);
        return;
    } catch (firstErr) {
        if (!isWindowsTransientRenameError(firstErr)) {
            throw firstErr;
        }
        let lastErr: unknown = firstErr;
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                fs.renameSync(tmpPath, targetPath);
                return;
            } catch (retryErr) {
                lastErr = retryErr;
                if (!isWindowsTransientRenameError(retryErr)) {
                    throw retryErr;
                }
            }
        }
        throw lastErr;
    }
}

/**
 * Atomically write `~/.gemini/GEMINI.md` (UTF-8), creating `~/.gemini/` when needed.
 *
 * Security & atomicity guarantees:
 * - Validates UTF-8 byte length <= `GLOBAL_RULES_MAX_BYTES` BEFORE any disk mutation.
 * - Rejects existing symlinks escaping `~/.gemini/` (including broken symlinks)
 *   and non-file targets BEFORE any disk mutation.
 * - Writes to a unique temp file inside `~/.gemini/` and atomically renames into
 *   place, with Windows `EPERM`/`EBUSY` safe fallback and guaranteed temp cleanup.
 */
export function writeGlobalRulesFile(
    content: string,
    homedir?: string,
    options?: { createOnly?: boolean },
): GlobalRulesStatus {
    if (typeof content !== 'string') {
        throw new Error('Global rules content must be a string');
    }
    const sizeBytes = Buffer.byteLength(content, 'utf8');
    if (sizeBytes > GLOBAL_RULES_MAX_BYTES) {
        throw new Error(`Global rules content is too large (${sizeBytes} bytes > ${GLOBAL_RULES_MAX_BYTES} bytes limit)`);
    }

    const createOnly = options?.createOnly === true;
    const inspected = inspectGlobalRulesTarget(homedir);
    if (inspected.kind === 'symlink_escape') {
        throw new Error('Refusing to write global rules: symlink target escapes ~/.gemini/');
    }
    if (inspected.kind === 'not_file') {
        throw new Error('Refusing to write global rules: target path is not a regular file');
    }
    if (createOnly && inspected.kind === 'file') {
        throw Object.assign(new Error('Global rules file already exists'), { code: 'EEXIST' });
    }

    const geminiDir = inspected.geminiDir;
    const rulesPath = inspected.rulesPath;
    fs.mkdirSync(geminiDir, { recursive: true });

    // Re-verify post-mkdir in case directory or target changed concurrently.
    const postCheck = inspectGlobalRulesTarget(homedir);
    if (postCheck.kind === 'symlink_escape') {
        throw new Error('Refusing to write global rules: symlink target escapes ~/.gemini/');
    }
    if (postCheck.kind === 'not_file') {
        throw new Error('Refusing to write global rules: target path is not a regular file');
    }
    if (createOnly && postCheck.kind === 'file') {
        throw Object.assign(new Error('Global rules file already exists'), { code: 'EEXIST' });
    }

    const realGeminiDir = safeRealpath(geminiDir);
    const targetWritePath = postCheck.kind === 'file'
        ? postCheck.realPath
        : path.join(realGeminiDir, GLOBAL_RULES_FILE_NAME);

    if (!isCanonicalPathInsideDir(targetWritePath, realGeminiDir)) {
        throw new Error('Refusing to write global rules: target path resolves outside ~/.gemini/');
    }

    const writeOpts: fs.WriteFileOptions = process.platform === 'win32'
        ? { encoding: 'utf8' }
        : { encoding: 'utf8', mode: 0o600 };

    if (createOnly) {
        const nonce = crypto.randomBytes(6).toString('hex');
        const tmpPath = path.join(realGeminiDir, `.${GLOBAL_RULES_FILE_NAME}.${process.pid}.${Date.now()}.${nonce}.tmp`);
        let linked = false;
        if (process.platform !== 'win32') {
            try {
                fs.writeFileSync(tmpPath, content, writeOpts);
                fs.linkSync(tmpPath, targetWritePath);
                linked = true;
            } catch (err) {
                if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') { throw err; }
            } finally {
                try { if (fs.existsSync(tmpPath)) { fs.unlinkSync(tmpPath); } } catch { /* ignore */ }
            }
        }
        if (!linked) {
            fs.writeFileSync(targetWritePath, content, { ...writeOpts, flag: 'wx' });
        }
        return { path: rulesPath, exists: true, sizeBytes, content, tooLarge: false };
    }

    const nonce = crypto.randomBytes(6).toString('hex');
    const tmpPath = path.join(realGeminiDir, `.${GLOBAL_RULES_FILE_NAME}.${process.pid}.${Date.now()}.${nonce}.tmp`);
    try {
        fs.writeFileSync(tmpPath, content, writeOpts);
        atomicReplaceFile(tmpPath, targetWritePath);
    } finally {
        try {
            if (fs.existsSync(tmpPath)) {
                fs.unlinkSync(tmpPath);
            }
        } catch {
            // Best-effort cleanup
        }
    }

    return {
        path: rulesPath,
        exists: true,
        sizeBytes,
        content,
        tooLarge: false,
    };
}

/**
 * Dedicated exact reveal validator for Global Rules.
 *
 * Strictly permits ONLY:
 *   1. `~/.gemini/GEMINI.md` (verified via realpath inside `~/.gemini/`, regular file), OR
 *   2. `~/.gemini/` directory itself ONLY when `GEMINI.md` does not exist yet.
 *
 * Never accepts arbitrary caller paths and never permits revealing sibling files in `~/.gemini/`.
 */
export function validateGlobalRulesRevealTarget(options?: { homedir?: string }): GlobalRulesRevealValidation {
    const inspected = inspectGlobalRulesTarget(options?.homedir);

    if (inspected.kind === 'symlink_escape') {
        return {
            ok: false,
            statusCode: 403,
            exists: false,
            error: 'Global rules symlink escapes ~/.gemini/',
        };
    }

    if (inspected.kind === 'file') {
        return {
            ok: true,
            resolvedPath: inspected.realPath,
            isDirectory: false,
            exists: true,
        };
    }

    if (inspected.kind === 'missing') {
        try {
            const realGeminiDir = safeRealpath(inspected.geminiDir);
            const dirStat = fs.statSync(realGeminiDir);
            if (!dirStat.isDirectory()) {
                return {
                    ok: false,
                    statusCode: 404,
                    exists: false,
                    error: 'Global rules directory is not accessible',
                };
            }
            return {
                ok: true,
                resolvedPath: realGeminiDir,
                isDirectory: true,
                exists: false,
            };
        } catch {
            return {
                ok: false,
                statusCode: 404,
                exists: false,
                error: 'Global rules directory does not exist yet',
            };
        }
    }

    return {
        ok: false,
        statusCode: 403,
        exists: false,
        error: 'Global rules path is not a regular file',
    };
}

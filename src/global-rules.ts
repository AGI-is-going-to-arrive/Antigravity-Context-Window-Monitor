// ─── Antigravity Global Rules File Manager ───────────────────────────────────
// Pure Node/TypeScript reader/writer for Antigravity's global rules file
// (`~/.gemini/GEMINI.md`) shared by the Antigravity IDE extension, the App
// Sidecar runtime and unit tests. ZERO `vscode` imports.
//
// Antigravity inherits the Gemini CLI convention: the global rules Markdown
// file lives at `<homedir>/.gemini/GEMINI.md` and applies to every agent
// conversation across all workspaces. This module gives the Settings tab a
// safe, size-capped inline editor for that file:
//   - `readGlobalRulesStatus()`  — stat + capped content read (never throws for
//     "missing"; callers render a Missing pill and offer template creation).
//   - `writeGlobalRulesFile()`   — parent-dir auto-creation + UTF-8 write with
//     a hard `GLOBAL_RULES_MAX_BYTES` cap (rejected BEFORE touching disk).
//
// Note: workspace-scoped rules (`.gemini/GEMINI.md`, `.agent/rules/`) are out
// of scope here — this card manages only the machine-global file.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Hard cap (bytes) for reading/writing the global rules file inline. */
export const GLOBAL_RULES_MAX_BYTES = 1024 * 1024; // 1 MiB

/** Default filename of Antigravity's global rules file inside `~/.gemini/`. */
export const GLOBAL_RULES_FILE_NAME = 'GEMINI.md';

/** Bilingual starter template written when the rules file does not exist yet. */
export const DEFAULT_GLOBAL_RULES_TEMPLATE = [
    '# Global Rules',
    '',
    '<!-- Antigravity 全局规则（对所有工作区的所有会话生效）。 -->',
    '<!-- Antigravity global rules — applied to every conversation in every workspace. -->',
    '',
].join('\n');

/** Read/write snapshot of the global rules file exposed to the Settings tab. */
export interface GlobalRulesStatus {
    /** Absolute path of the global rules file (`~/.gemini/GEMINI.md`). */
    path: string;
    /** Whether the file currently exists on disk. */
    exists: boolean;
    /** Byte size of the file on disk (`0` when missing). */
    sizeBytes: number;
    /** UTF-8 file content (empty when missing, unreadable, or `tooLarge`). */
    content: string;
    /** True when the file exists but exceeds `GLOBAL_RULES_MAX_BYTES` and cannot be safely edited inline. */
    tooLarge: boolean;
}

/** Resolve the absolute path of Antigravity's global rules file. */
export function getGlobalRulesPath(homedir?: string): string {
    const home = typeof homedir === 'string' && homedir.trim()
        ? homedir.trim()
        : os.homedir();
    return path.join(home, '.gemini', GLOBAL_RULES_FILE_NAME);
}

/**
 * Stat + read the global rules file. Never throws for ordinary failure modes —
 * a missing or unreadable file resolves to `exists: false` / empty content so
 * callers can render the Settings card without try/catch.
 */
export function readGlobalRulesStatus(options?: { homedir?: string; includeContent?: boolean }): GlobalRulesStatus {
    const rulesPath = getGlobalRulesPath(options?.homedir);
    const includeContent = options?.includeContent !== false;
    let stat: fs.Stats | null = null;
    try {
        stat = fs.statSync(rulesPath);
    } catch {
        stat = null;
    }
    if (!stat || !stat.isFile()) {
        return { path: rulesPath, exists: false, sizeBytes: 0, content: '', tooLarge: false };
    }
    const sizeBytes = Number.isFinite(stat.size) ? stat.size : 0;
    const tooLarge = sizeBytes > GLOBAL_RULES_MAX_BYTES;
    let content = '';
    if (includeContent && !tooLarge) {
        try {
            content = fs.readFileSync(rulesPath, 'utf8');
        } catch {
            content = '';
        }
    }
    return { path: rulesPath, exists: true, sizeBytes, content, tooLarge };
}

/**
 * Write the global rules file (UTF-8), creating `~/.gemini/` when needed.
 * Content exceeding `GLOBAL_RULES_MAX_BYTES` is rejected with an Error BEFORE
 * any disk mutation so oversized textarea payloads can never truncate the file.
 */
export function writeGlobalRulesFile(content: string, homedir?: string): GlobalRulesStatus {
    const rulesPath = getGlobalRulesPath(homedir);
    const payload = typeof content === 'string' ? content : '';
    const sizeBytes = Buffer.byteLength(payload, 'utf8');
    if (sizeBytes > GLOBAL_RULES_MAX_BYTES) {
        throw new Error(`Global rules content is too large (${sizeBytes} bytes > ${GLOBAL_RULES_MAX_BYTES} bytes limit)`);
    }
    fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
    fs.writeFileSync(rulesPath, payload, { encoding: 'utf8' });
    return { path: rulesPath, exists: true, sizeBytes, content: payload, tooLarge: false };
}

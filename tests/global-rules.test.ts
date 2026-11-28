import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_GLOBAL_RULES_TEMPLATE,
    GLOBAL_RULES_FILE_NAME,
    GLOBAL_RULES_MAX_BYTES,
    getGlobalRulesDir,
    getGlobalRulesPath,
    readGlobalRulesStatus,
    validateGlobalRulesRevealTarget,
    writeGlobalRulesFile,
} from '../src/global-rules';
import {
    createSidecarRuntimeProvider,
    type SidecarDocumentParams,
    type SidecarRuntimeProvider,
} from '../src/app/sidecar-runtime';
import {
    isCommandAllowedForScope,
    SDK_ONLY_ACTION_COMMANDS,
} from '../src/app/sidecar-server';

describe('global-rules manager (~/.gemini/GEMINI.md)', () => {
    const tmpDirs: string[] = [];
    const providers: SidecarRuntimeProvider[] = [];

    function makeTmpHome(prefix = 'acm-global-rules-'): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        tmpDirs.push(dir);
        return dir;
    }

    afterEach(async () => {
        while (providers.length > 0) {
            const p = providers.pop()!;
            await p.dispose().catch(() => {});
        }
        while (tmpDirs.length > 0) {
            const d = tmpDirs.pop()!;
            fs.rmSync(d, { recursive: true, force: true });
        }
    });

    it('uses a strict 200 KiB cap and resolves ~/.gemini/GEMINI.md', () => {
        const home = makeTmpHome();
        expect(GLOBAL_RULES_MAX_BYTES).toBe(200 * 1024);
        expect(GLOBAL_RULES_FILE_NAME).toBe('GEMINI.md');
        expect(getGlobalRulesDir(home)).toBe(path.join(home, '.gemini'));
        expect(getGlobalRulesPath(home)).toBe(path.join(home, '.gemini', 'GEMINI.md'));
    });

    it('reports missing file cleanly without creating directories', () => {
        const home = makeTmpHome();
        const st = readGlobalRulesStatus({ homedir: home });
        expect(st).toEqual({
            path: path.join(home, '.gemini', 'GEMINI.md'),
            exists: false,
            sizeBytes: 0,
            content: '',
            tooLarge: false,
        });
        expect(fs.existsSync(path.join(home, '.gemini'))).toBe(false);
    });

    it('writes atomically, creates ~/.gemini, reads round-trip, and leaves no temp files', () => {
        const home = makeTmpHome();
        const body = '# Global Rules\n\n- 中文规则测试 $& $$ $1\n- Keep diffs small.\n';
        const written = writeGlobalRulesFile(body, home);
        expect(written.exists).toBe(true);
        expect(written.tooLarge).toBe(false);
        expect(written.sizeBytes).toBe(Buffer.byteLength(body, 'utf8'));
        expect(written.content).toBe(body);

        const files = fs.readdirSync(path.join(home, '.gemini'));
        expect(files).toEqual(['GEMINI.md']);

        const full = readGlobalRulesStatus({ homedir: home, includeContent: true });
        expect(full.exists).toBe(true);
        expect(full.content).toBe(body);
        expect(full.sizeBytes).toBe(Buffer.byteLength(body, 'utf8'));

        const metaOnly = readGlobalRulesStatus({ homedir: home, includeContent: false });
        expect(metaOnly.exists).toBe(true);
        expect(metaOnly.sizeBytes).toBe(Buffer.byteLength(body, 'utf8'));
        expect(metaOnly.content).toBe('');
    });

    it('rejects oversized writes BEFORE mutating disk and flags oversized files on read', () => {
        const home = makeTmpHome();
        const oversize = '中'.repeat(Math.ceil((GLOBAL_RULES_MAX_BYTES + 30) / 3));
        expect(Buffer.byteLength(oversize, 'utf8')).toBeGreaterThan(GLOBAL_RULES_MAX_BYTES);

        // Missing dir must NOT be created when write is rejected
        expect(() => writeGlobalRulesFile(oversize, home)).toThrow(/too large/i);
        expect(fs.existsSync(path.join(home, '.gemini'))).toBe(false);

        // Existing content must stay intact on rejected oversize write
        writeGlobalRulesFile('initial safe rules', home);
        expect(() => writeGlobalRulesFile(oversize, home)).toThrow(/too large/i);
        expect(readGlobalRulesStatus({ homedir: home }).content).toBe('initial safe rules');

        // Direct oversized file on disk -> tooLarge: true and empty content
        const rulesPath = getGlobalRulesPath(home);
        fs.writeFileSync(rulesPath, 'x'.repeat(GLOBAL_RULES_MAX_BYTES + 128), 'utf8');
        const st = readGlobalRulesStatus({ homedir: home, includeContent: true });
        expect(st.exists).toBe(true);
        expect(st.tooLarge).toBe(true);
        expect(st.content).toBe('');
        expect(st.sizeBytes).toBe(GLOBAL_RULES_MAX_BYTES + 128);
    });

    it('rejects escaping symlinks, dangling symlinks, and non-file targets on read/write/reveal', () => {
        const home = makeTmpHome();
        const outsideDir = makeTmpHome('acm-outside-');
        const secretFile = path.join(outsideDir, 'secret.txt');
        fs.writeFileSync(secretFile, 'TOP_SECRET_DATA', 'utf8');

        const geminiDir = getGlobalRulesDir(home);
        fs.mkdirSync(geminiDir, { recursive: true });
        const rulesPath = getGlobalRulesPath(home);

        // 1. Escaping symlink
        fs.symlinkSync(secretFile, rulesPath);
        const readEsc = readGlobalRulesStatus({ homedir: home, includeContent: true });
        expect(readEsc.exists).toBe(false);
        expect(readEsc.content).toBe('');
        expect(readEsc.error).toBe('SYMLINK_ESCAPE');

        expect(() => writeGlobalRulesFile('overwrite attempt', home)).toThrow(/symlink/i);
        expect(fs.readFileSync(secretFile, 'utf8')).toBe('TOP_SECRET_DATA');

        const revEsc = validateGlobalRulesRevealTarget({ homedir: home });
        expect(revEsc.ok).toBe(false);
        expect(revEsc.statusCode).toBe(403);

        // 2. Broken / dangling symlink
        fs.unlinkSync(rulesPath);
        fs.symlinkSync(path.join(outsideDir, 'nonexistent.md'), rulesPath);
        expect(readGlobalRulesStatus({ homedir: home }).error).toBe('SYMLINK_ESCAPE');
        expect(() => writeGlobalRulesFile('dangling write', home)).toThrow(/symlink/i);
        expect(validateGlobalRulesRevealTarget({ homedir: home }).statusCode).toBe(403);

        // 3. ANY symlink at GEMINI.md (even pointing to a sibling inside ~/.gemini/ like config.json) is REJECTED
        fs.unlinkSync(rulesPath);
        const inDirTarget = path.join(geminiDir, 'config.json');
        fs.writeFileSync(inDirTarget, '{"secret":"token"}', 'utf8');
        fs.symlinkSync(inDirTarget, rulesPath);
        const inDirStatus = readGlobalRulesStatus({ homedir: home, includeContent: true });
        expect(inDirStatus.exists).toBe(false);
        expect(inDirStatus.content).toBe('');
        expect(inDirStatus.error).toBe('SYMLINK_ESCAPE');
        expect(() => writeGlobalRulesFile('overwrite sibling', home)).toThrow(/symlink/i);
        expect(fs.readFileSync(inDirTarget, 'utf8')).toBe('{"secret":"token"}');
        const inDirReveal = validateGlobalRulesRevealTarget({ homedir: home });
        expect(inDirReveal.ok).toBe(false);
        expect(inDirReveal.statusCode).toBe(403);

        // 4. Directory at GEMINI.md is rejected
        fs.unlinkSync(rulesPath);
        fs.mkdirSync(rulesPath);
        expect(readGlobalRulesStatus({ homedir: home }).exists).toBe(false);
        expect(() => writeGlobalRulesFile('dir target', home)).toThrow(/regular file/i);
        expect(validateGlobalRulesRevealTarget({ homedir: home }).statusCode).toBe(403);
    });

    it('validateGlobalRulesRevealTarget allows ~/.gemini/ ONLY when GEMINI.md is missing', () => {
        const home = makeTmpHome();
        // Neither ~/.gemini nor GEMINI.md exists -> 404
        const missingDir = validateGlobalRulesRevealTarget({ homedir: home });
        expect(missingDir.ok).toBe(false);
        expect(missingDir.statusCode).toBe(404);

        // ~/.gemini exists, GEMINI.md missing -> allows directory reveal
        const geminiDir = getGlobalRulesDir(home);
        fs.mkdirSync(geminiDir, { recursive: true });
        const dirOnly = validateGlobalRulesRevealTarget({ homedir: home });
        expect(dirOnly.ok).toBe(true);
        expect(dirOnly.isDirectory).toBe(true);
        expect(dirOnly.exists).toBe(false);
        expect(dirOnly.resolvedPath).toBe(fs.realpathSync.native(geminiDir));

        // GEMINI.md exists -> reveals file directly
        writeGlobalRulesFile('# Rules\n', home);
        const fileTarget = validateGlobalRulesRevealTarget({ homedir: home });
        expect(fileTarget.ok).toBe(true);
        expect(fileTarget.isDirectory).toBe(false);
        expect(fileTarget.exists).toBe(true);
        expect(fileTarget.resolvedPath).toBe(fs.realpathSync.native(getGlobalRulesPath(home)));
    });

    it('enforces SDK-only scope & privacy-safe metadata contract in Sidecar runtime', async () => {
        for (const cmd of ['readGlobalRulesFile', 'saveGlobalRulesFile', 'openGlobalRulesFile', 'revealGlobalRulesFile'] as const) {
            expect(SDK_ONLY_ACTION_COMMANDS.has(cmd)).toBe(true);
            expect(isCommandAllowedForScope('standalone', cmd)).toBe(false);
            expect(isCommandAllowedForScope('sdk', cmd)).toBe(true);
        }

        const home = makeTmpHome();
        const statePath = path.join(home, 'state-v1.json');
        const revealed: Array<{ target: string; isDir: boolean }> = [];
        const opened: string[] = [];
        let capturedDocParams: SidecarDocumentParams | null = null;

        writeGlobalRulesFile('PRIVATE_GEMINI_RULES_SECRET_LINE', home);

        const provider = createSidecarRuntimeProvider({
            statePath,
            autoStart: false,
            disableCliScan: true,
            enableAutoUpdateCheck: false,
            renderDocument: (params) => {
                capturedDocParams = params;
                return '<html><body>ok</body></html>';
            },
            deps: {
                homedir: () => home,
                discoverLS: async () => null,
                revealInOs: async (target, isDir) => { revealed.push({ target, isDir }); },
                openFileInOs: async (target) => { opened.push(target); },
            },
        });
        providers.push(provider);

        // Initial render & snapshot MUST pass metadata-only (NEVER leak private file content!)
        await provider.renderHtml({ viewMode: 'aux' });
        expect(capturedDocParams).not.toBeNull();
        expect(capturedDocParams!.globalRules).toMatchObject({
            path: '~/.gemini/GEMINI.md',
            exists: true,
            tooLarge: false,
            content: '',
        });
        const snap = await provider.getSnapshot({ viewMode: 'aux' });
        expect((snap.data as Record<string, unknown>).globalRules).toMatchObject({
            path: '~/.gemini/GEMINI.md',
            exists: true,
            content: '',
        });
        expect(JSON.stringify(snap)).not.toContain('PRIVATE_GEMINI_RULES_SECRET_LINE');

        // Explicit readGlobalRulesFile loads content on demand (redacting path while masked)
        const readRes = await provider.handleAction({ command: 'readGlobalRulesFile' });
        expect(readRes.ok).toBe(true);
        expect(readRes.result).toMatchObject({
            path: '~/.gemini/GEMINI.md',
            exists: true,
            content: 'PRIVATE_GEMINI_RULES_SECRET_LINE',
        });
        expect(readRes.messages?.[0]).toMatchObject({
            command: 'globalRulesFileContent',
            ok: true,
            content: 'PRIVATE_GEMINI_RULES_SECRET_LINE',
        });

        // Oversized save rejected with 413
        const bigRes = await provider.handleAction({
            command: 'saveGlobalRulesFile',
            content: 'a'.repeat(GLOBAL_RULES_MAX_BYTES + 10),
        });
        expect(bigRes.ok).toBe(false);
        expect(bigRes.statusCode).toBe(413);

        // Valid save commits atomically
        const saveRes = await provider.handleAction({
            command: 'saveGlobalRulesFile',
            content: '# Updated Rules\n',
        });
        expect(saveRes.ok).toBe(true);
        expect(fs.readFileSync(getGlobalRulesPath(home), 'utf8')).toBe('# Updated Rules\n');
        expect(saveRes.messages?.[0]).toMatchObject({
            command: 'globalRulesSaveResult',
            ok: true,
            exists: true,
            content: '',
        });

        // Reveal existing file
        const revealRes = await provider.handleAction({ command: 'revealGlobalRulesFile' });
        expect(revealRes.ok).toBe(true);
        expect(revealed).toHaveLength(1);
        expect(revealed[0].isDir).toBe(false);
        expect(revealed[0].target).toBe(fs.realpathSync.native(getGlobalRulesPath(home)));

        // Remove GEMINI.md -> openGlobalRulesFile creates starter template & opens it
        fs.unlinkSync(getGlobalRulesPath(home));
        const revealDirRes = await provider.handleAction({ command: 'revealGlobalRulesFile' });
        expect(revealDirRes.ok).toBe(true);
        expect(revealed[1]).toEqual({
            target: fs.realpathSync.native(getGlobalRulesDir(home)),
            isDir: true,
        });

        const openRes = await provider.handleAction({ command: 'openGlobalRulesFile', windowId: 'win-gr' });
        expect(openRes.ok).toBe(true);
        expect((openRes.result as { ok?: boolean }).ok).toBe(true);
        expect(fs.readFileSync(getGlobalRulesPath(home), 'utf8')).toBe(DEFAULT_GLOBAL_RULES_TEMPLATE);
        expect(opened).toEqual([fs.realpathSync.native(getGlobalRulesPath(home))]);

        // Unmask explicit window reveals real path on read (while missing windowId stays fail-closed masked!)
        await provider.handleAction({ command: 'setPrivacyMask', windowId: 'win-gr', masked: false });
        const unmaskedRead = await provider.handleAction({ command: 'readGlobalRulesFile', windowId: 'win-gr' });
        expect(unmaskedRead.ok).toBe(true);
        expect((unmaskedRead.result as { path: string }).path).toBe(getGlobalRulesPath(home));
        const noWinRead = await provider.handleAction({ command: 'readGlobalRulesFile' });
        expect(noWinRead.ok).toBe(true);
        expect((noWinRead.result as { path: string }).path).toBe('~/.gemini/GEMINI.md');
    });
});

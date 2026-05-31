import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type * as vscode from 'vscode';
import { DurableState, type StateBucket } from '../src/durable-state';
import { getLanguage, initI18nFromState, isLanguage, setLanguage } from '../src/i18n';

class InMemoryStateBucket implements StateBucket {
    private readonly values = new Map<string, unknown>();

    get<T>(key: string, defaultValue: T): T {
        return this.values.has(key) ? this.values.get(key) as T : defaultValue;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.values.set(key, value);
    }
}

function makeContext(globalState: StateBucket = new InMemoryStateBucket()): vscode.ExtensionContext {
    return { globalState } as vscode.ExtensionContext;
}

function readStateFile(filePath: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('i18n DurableState persistence', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-i18n-persistence-'));
    });

    afterEach(async () => {
        await setLanguage('both', makeContext());
        await delay(350);
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function statePath(name: string): string {
        return path.join(tempDir, name);
    }

    it('round-trips display language through DurableState', async () => {
        const filePath = statePath('round-trip.json');
        const state = new DurableState(filePath);

        await state.globalBucket().update('displayLanguage', 'en');

        const reloaded = new DurableState(filePath);
        expect(reloaded.globalBucket().get('displayLanguage', 'both')).toBe('en');
    });

    it('dual-writes to fallback only when fallback bucket is provided', async () => {
        const fallback = new InMemoryStateBucket();
        const dualWritePath = statePath('dual-write.json');

        await new DurableState(dualWritePath)
            .globalBucket(fallback)
            .update('displayLanguage', 'zh');

        expect((readStateFile(dualWritePath).global as Record<string, unknown>).displayLanguage).toBe('zh');
        expect(fallback.get('displayLanguage', 'both')).toBe('zh');

        const mainOnlyPath = statePath('main-only.json');
        await new DurableState(mainOnlyPath)
            .globalBucket()
            .update('displayLanguage', 'en');

        expect((readStateFile(mainOnlyPath).global as Record<string, unknown>).displayLanguage).toBe('en');
        expect(fallback.get('displayLanguage', 'both')).toBe('zh');
    });

    it('restores language from DurableState after the webview setLanguage path writes it', async () => {
        const filePath = statePath('webview-language.json');
        const durableState = new DurableState(filePath);
        const ctx = makeContext();

        await setLanguage('en', ctx, durableState.globalBucket());
        await setLanguage('both', makeContext());

        const reloaded = new DurableState(filePath);
        initI18nFromState(reloaded.globalBucket());

        expect(getLanguage()).toBe('en');
    });

    it('does not write to DurableState when setLanguage is called without a state bucket', async () => {
        const filePath = statePath('negative-control.json');
        const ctx = makeContext();

        await setLanguage('en', ctx);

        expect(fs.existsSync(filePath)).toBe(false);
        expect(fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8').includes('en')).toBe(false);
    });

    it('defaults to both when the DurableState file is missing', async () => {
        const state = new DurableState(statePath('missing.json'));

        await setLanguage('en', makeContext());
        initI18nFromState(state.globalBucket());

        expect(getLanguage()).toBe('both');
    });

    it('defaults to both without throwing for malformed JSON', async () => {
        const filePath = statePath('malformed.json');
        fs.writeFileSync(filePath, '{not json', 'utf8');

        const state = new DurableState(filePath);

        await setLanguage('en', makeContext());
        expect(() => initI18nFromState(state.globalBucket())).not.toThrow();
        expect(getLanguage()).toBe('both');
    });

    it('defaults to both for unsupported DurableState versions', async () => {
        const filePath = statePath('unsupported-version.json');
        fs.writeFileSync(filePath, JSON.stringify({
            version: 2,
            global: { displayLanguage: 'en' },
            workspaces: {},
        }), 'utf8');

        const state = new DurableState(filePath);

        await setLanguage('en', makeContext());
        initI18nFromState(state.globalBucket());

        expect(getLanguage()).toBe('both');
    });

    it('recognizes only supported language values', () => {
        expect(isLanguage('zh')).toBe(true);
        expect(isLanguage('en')).toBe(true);
        expect(isLanguage('both')).toBe(true);
        expect(isLanguage('xx')).toBe(false);
        expect(isLanguage('')).toBe(false);
        expect(isLanguage(null)).toBe(false);
        expect(isLanguage(undefined)).toBe(false);
        expect(isLanguage(123)).toBe(false);
    });

    it('keeps distinct missing DurableState files isolated within one process', async () => {
        const first = new DurableState(statePath('first.json'));
        const second = new DurableState(statePath('second.json'));

        await first.globalBucket().update('displayLanguage', 'en');

        expect(second.globalBucket().get('displayLanguage', 'both')).toBe('both');
    });
});

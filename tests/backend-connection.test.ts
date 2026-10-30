import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getActiveBackendHint, discoverCurrentLanguageServer } from '../src/backend-connection';
import { discoverLanguageServer } from '../src/discovery';

const getExtension = vi.spyOn(vscode.extensions, 'getExtension');
vi.mock('../src/discovery', () => ({ discoverLanguageServer: vi.fn().mockResolvedValue(null) }));

afterEach(() => vi.clearAllMocks());

describe('current IDE backend affinity', () => {
    it('uses the active built-in extension connection and reads fresh getters on each discovery', async () => {
        let port = 61001;
        const activate = vi.fn();
        getExtension.mockReturnValue({ isActive: true, activate,
            exports: { get port() { return port; }, csrfToken: 'fixture-secret' } });
        const signal = new AbortController().signal;
        const log = vi.fn();
        await discoverCurrentLanguageServer('file:///work', signal, log);
        expect(discoverLanguageServer).toHaveBeenLastCalledWith('file:///work', signal, log,
            { port: 61001, csrfToken: 'fixture-secret' });
        port = 61002;
        await discoverCurrentLanguageServer();
        expect(discoverLanguageServer).toHaveBeenLastCalledWith(undefined, undefined, undefined,
            { port: 61002, csrfToken: 'fixture-secret' });
        expect(getExtension).toHaveBeenCalledWith('google.google-antigravity');
        expect(activate).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
    });

    it.each([{ isActive: false, exports: { port: 61001, csrfToken: 'fixture-secret' } },
        { isActive: true }, { isActive: true, exports: null },
        ...[0, -1, 65536, 1.5, NaN, Infinity, '61001'].map(port => ({ isActive: true, exports: { port, csrfToken: 'fixture-secret' } })),
        ...['', 'space token', null, 123].map(csrfToken => ({ isActive: true, exports: { port: 61001, csrfToken } })),
    ])('waits without crossing instances for inactive/invalid exports: %j', async extension => {
        getExtension.mockReturnValue(extension);
        expect(getActiveBackendHint()).toBeNull();
        expect(await discoverCurrentLanguageServer()).toBeNull();
        expect(discoverLanguageServer).not.toHaveBeenCalled();
    });

    it('uses legacy process discovery only when the new built-in extension is absent', async () => {
        getExtension.mockReturnValue(undefined);
        expect(getActiveBackendHint()).toBeUndefined();
        await discoverCurrentLanguageServer();
        expect(discoverLanguageServer).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
    });

    it('tolerates throwing exports getters during a backend restart', () => {
        getExtension.mockReturnValue({ isActive: true, exports: { get port() { throw new Error('restarting'); } } });
        expect(getActiveBackendHint()).toBeNull();
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
    getActiveBackendHint,
    discoverCurrentLanguageServer,
    isSameBackendConnection,
    doesConnectionMatchActiveHint,
} from '../src/backend-connection';
import { discoverLanguageServer, type LSInfo } from '../src/discovery';

const getExtension = vi.spyOn(vscode.extensions, 'getExtension');
vi.mock('../src/discovery', () => ({ discoverLanguageServer: vi.fn().mockResolvedValue(null) }));

afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ANTIGRAVITY_SERVER_URL;
});

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

    it('derives loopback port from ANTIGRAVITY_SERVER_URL when exports.port is undefined, but rejects remote hosts', () => {
        getExtension.mockReturnValue({ isActive: true, exports: { port: undefined, csrfToken: 'fixture-secret' } });
        process.env.ANTIGRAVITY_SERVER_URL = 'http://127.0.0.1:4242';
        expect(getActiveBackendHint()).toEqual({ port: 4242, csrfToken: 'fixture-secret' });

        process.env.ANTIGRAVITY_SERVER_URL = 'https://evil.example.com:4242';
        expect(getActiveBackendHint()).toBeNull();
    });
});

describe('backend identity & fast hint-change reconnect helpers', () => {
    const base: LSInfo = { pid: 100, port: 62103, csrfToken: 'tok-a', useTls: false };

    it('compares full LS connection identity including port/token/TLS/hostname even when pid is 0', () => {
        expect(isSameBackendConnection(base, { ...base })).toBe(true);
        expect(isSameBackendConnection(base, { ...base, hostname: '127.0.0.1' })).toBe(true);
        expect(isSameBackendConnection(base, { ...base, hostname: '::1' })).toBe(false);
        expect(isSameBackendConnection(base, { ...base, port: 62104 })).toBe(false);
        expect(isSameBackendConnection(base, { ...base, csrfToken: 'tok-b' })).toBe(false);
        expect(isSameBackendConnection(base, { ...base, useTls: true })).toBe(false);
        expect(isSameBackendConnection({ ...base, pid: 0, port: 62103 }, { ...base, pid: 0, port: 62200 })).toBe(false);
        expect(isSameBackendConnection(null, base)).toBe(false);
    });

    it('detects active hint changes immediately while preserving legacy and HTTPS-paired connections', () => {
        expect(doesConnectionMatchActiveHint(base, undefined)).toBe(true);
        expect(doesConnectionMatchActiveHint(base, null)).toBe(false);
        expect(doesConnectionMatchActiveHint(base, { port: 62103, csrfToken: 'tok-a' })).toBe(true);
        expect(doesConnectionMatchActiveHint(base, { port: 62200, csrfToken: 'tok-a' })).toBe(false);
        expect(doesConnectionMatchActiveHint(base, { port: 62103, csrfToken: 'tok-b' })).toBe(false);
        // Paired HTTPS port (e.g. 62105) with the same hub CSRF token stays valid without reconnect loop
        expect(doesConnectionMatchActiveHint({ ...base, port: 62105, useTls: true }, { port: 62103, csrfToken: 'tok-a' })).toBe(true);
        expect(doesConnectionMatchActiveHint({ ...base, port: 62105, useTls: true }, { port: 62103, csrfToken: 'tok-b' })).toBe(false);
    });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAndOverrideCheckpointerLimits, invalidateLiveModelMetadata } from '../src/extension';
import { getAvailableImageModelSpecs, setAvailableImageModelIds } from '../src/models';
import { rpcCall } from '../src/rpc-client';

vi.mock('../src/rpc-client', () => ({ rpcCall: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); invalidateLiveModelMetadata(); });

describe('live image-model availability lifecycle', () => {
    it('clears the prior account or backend image catalog immediately', () => {
        setAvailableImageModelIds(['gemini-3.1-flash-image']);
        expect(getAvailableImageModelSpecs()).toHaveLength(1);
        invalidateLiveModelMetadata();
        expect(getAvailableImageModelSpecs()).toEqual([]);
    });

    it('discards an in-flight catalog reply after its account/backend becomes stale', async () => {
        let finish: (value: Record<string, unknown>) => void = () => {};
        vi.mocked(rpcCall).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
        let current = true;
        const sync = fetchAndOverrideCheckpointerLimits({ pid: 1, port: 1, csrfToken: 'fixture', useTls: false },
            () => {}, () => current);
        current = false;
        invalidateLiveModelMetadata();
        finish({ response: { imageGenerationModelIds: ['gemini-3.1-flash-image'], models: {
            'gemini-3.1-flash-image': { model: 'MODEL_PLACEHOLDER_M21', apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
                maxTokens: 65536, maxOutputTokens: 65536 },
        } } });
        expect(await sync).toBe(false);
        expect(getAvailableImageModelSpecs()).toEqual([]);
    });
});

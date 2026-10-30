import { describe, expect, it } from 'vitest';
import { parseGMEntry } from '../src/gm/parser';
import { resolveModelId } from '../src/models';
import { costFromTokens, findPricing } from '../src/pricing-store';

// Sanitized from the first authorized Low test in the installed 1.16.19
// extension, 2026-10-31. Contains no prompts, credentials, or account data.
function lowFixture() {
    const usage = { model: 'MODEL_PLACEHOLDER_M419', inputTokens: '12905', outputTokens: '5',
        responseOutputTokens: '5', apiProvider: 'API_PROVIDER_GOOGLE_GEMINI' };
    return { stepIndices: [1], chatModel: {
        model: 'MODEL_PLACEHOLDER_M419', responseModel: 'gemini-4-argon',
        modelDisplayName: 'Gemini 4 Argon (Low)', usage,
        chatStartMetadata: { contextWindowMetadata: { estimatedTokensUsed: 18324, maxContextTokens: 256000 } },
        retryInfos: [{ usage }],
    }, plannerConfig: { planModel: 'MODEL_PLACEHOLDER_M419', modelName: 'gemini-4-argon-low', maxOutputTokens: 65536 } };
}

describe('agent-hub GM telemetry', () => {
    it('reads real Low tokens and context capacity without assigning the shared response name to Low', () => {
        const call = parseGMEntry(lowFixture());
        expect(call).toMatchObject({ model: 'MODEL_PLACEHOLDER_M419', modelSource: 'chatModel',
            modelDisplay: 'Gemini 4 Argon (Low)', responseModel: 'gemini-4-argon',
            inputTokens: 12905, outputTokens: 5, responseTokens: 5, thinkingTokens: 0,
            contextWindowCapacity: 256000, contextTokensUsed: 18324,
            retries: 0, retryTokensIn: 0, retryTokensOut: 0, retryCredits: 0, retryErrors: [], hasError: false });
        expect(resolveModelId('gemini-4-argon')).toBeUndefined();
        expect(findPricing(call.model)).toBeNull();
        // With a synthetic user price, only the primary usage is billed once.
        expect(costFromTokens(call, { input: 1, output: 1, thinking: 1, cacheRead: 0, cacheWrite: 0 })).toBe(0.01291);
    });

    it('keeps a valid legacy planner capacity ahead of the new context metadata fallback', () => {
        const fixture = lowFixture();
        const call = parseGMEntry({ ...fixture, plannerConfig: { ...fixture.plannerConfig, truncationThresholdTokens: '128000' } });
        expect(call.contextWindowCapacity).toBe(128000);
    });

    it.each([undefined, null, 0, -1, NaN, Infinity, 1.5, '256000bad', '1e6', '9007199254740992', {}])(
        'rejects invalid planner capacity %s and uses the valid current metadata', invalid => {
            const fixture = lowFixture();
            expect(parseGMEntry({ ...fixture, plannerConfig: { truncationThresholdTokens: invalid } }).contextWindowCapacity).toBe(256000);
        },
    );

    it.each([undefined, null, 0, -1, NaN, Infinity, 1.5, '256000bad', '1e6', '9007199254740992', {}])(
        'reports unknown capacity when both capacity sources are invalid (%s)', invalid => {
            const fixture = lowFixture();
            fixture.chatModel.chatStartMetadata.contextWindowMetadata = { estimatedTokensUsed: 18324, maxContextTokens: invalid as number };
            expect(parseGMEntry(fixture).contextWindowCapacity).toBe(0);
        },
    );

    it('accepts exact decimal-string capacities from protobuf JSON', () => {
        const fixture = lowFixture();
        const chatModel = { ...fixture.chatModel, chatStartMetadata: { contextWindowMetadata: { maxContextTokens: '256000' } } };
        expect(parseGMEntry({ ...fixture, chatModel }).contextWindowCapacity).toBe(256000);
    });

    it('does not count duplicate successful retryInfo usage as retries, errors or additional cost', () => {
        const fixture = lowFixture();
        const chatModel = { ...fixture.chatModel, retries: 2,
            retryInfos: [...fixture.chatModel.retryInfos, ...fixture.chatModel.retryInfos] };
        const call = parseGMEntry({ ...fixture, chatModel });
        expect(call.retries).toBe(0);
        expect(call.retryTokensIn + call.retryTokensOut + call.retryCredits).toBe(0);
        expect(call.hasError).toBe(false);
        expect(call.retryErrors).toEqual([]);
        expect(call.inputTokens).toBe(12905);
        expect(call.outputTokens).toBe(5);
    });

    it('retains failed-attempt telemetry separately and uses legacy retry count only without detail', () => {
        const fixture = lowFixture();
        const chatModel = { ...fixture.chatModel, retries: 4, retryInfos: [
            ...fixture.chatModel.retryInfos,
            { error: 'temporary: temporary', usage: { inputTokens: '10', outputTokens: '2' } },
        ] };
        const call = parseGMEntry({ ...fixture, chatModel });
        expect(call.retries).toBe(1);
        expect(call.retryErrors).toEqual(['temporary']);
        expect(call.retryTokensIn).toBe(10);
        expect(call.retryTokensOut).toBe(2);
        expect(call.inputTokens).toBe(12905);
        expect(parseGMEntry({ ...fixture, chatModel: { ...fixture.chatModel, retries: 4, retryInfos: undefined } }).retries).toBe(3);
    });
});

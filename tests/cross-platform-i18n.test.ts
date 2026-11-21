import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatNumber, getLanguage, setLanguageToState, t, tBi, tBiHtml } from '../src/i18n';
import { fetchFullUserStatus, normalizeUri, parseStrictResetTimestamp, parseUserQuotaSummary } from '../src/tracker';
import { groupModelConfigsByQuotaPool } from '../src/extension';
import { rpcCall } from '../src/rpc-client';
import type { LSInfo } from '../src/discovery';

vi.mock('../src/rpc-client', () => ({ rpcCall: vi.fn() }));

const initialLanguage = getLanguage();
const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };
const dummyLs: LSInfo = { pid: 1, port: 443, csrfToken: 'test', useTls: false };

beforeEach(async () => {
    vi.clearAllMocks();
    await setLanguageToState('both', state);
});

afterEach(async () => {
    await setLanguageToState(initialLanguage, state);
});

describe('i18n helpers and developer terminology', () => {
    it('never translates tokens as 令牌 and avoids duplicate bilingual units', async () => {
        for (const lang of ['en', 'zh', 'both'] as const) {
            await setLanguageToState(lang, state);
            expect(t('unit.tokens')).toBe('tokens');
            expect(t('unit.token')).toBe('Token');
            expect(t('tooltip.lastCheckpoint')).not.toContain('令牌');
        }
        await setLanguageToState('zh', state);
        expect(t('tooltip.lastCheckpoint')).toBe('最近检查点');

        // Verify all v1.17.3 Orchestrator, Quota Window, and Telemetry keys
        const newKeys = [
            'orchestrator.settings', 'orchestrator.model', 'orchestrator.executor',
            'orchestrator.planner', 'orchestrator.worker', 'orchestrator.crossPool',
            'quota.fiveHour', 'quota.weekly', 'quota.notice',
            'telemetry.totalLatency', 'telemetry.latestCall', 'telemetry.recentCalls',
            'telemetry.cost', 'telemetry.unpriced', 'telemetry.rateChange',
            'telemetry.retryWaste', 'telemetry.blendedInput',
        ];
        for (const lang of ['en', 'zh', 'both'] as const) {
            await setLanguageToState(lang, state);
            for (const key of newKeys) {
                const val = t(key);
                expect(val, `${lang}:${key}`).not.toBe(key);
                expect(val, `${lang}:${key}`).not.toContain('令牌');
            }
        }
    });

    it('avoids dangling separators in tBi and structures bilingual HTML safely in tBiHtml', async () => {
        await setLanguageToState('both', state);
        expect(tBi('', ' 轮')).toBe(' 轮');
        expect(tBi('Turn', '')).toBe('Turn');
        expect(tBiHtml('Context & quota', '上下文与配额')).toBe(
            '<span class="bi-en">Context &amp; quota</span><span class="bi-sep"> / </span><span class="bi-zh">上下文与配额</span>',
        );
        expect(tBiHtml('tokens', 'tokens')).toBe('tokens');
        expect(tBiHtml('<script>', '"安全"')).toBe(
            '<span class="bi-en">&lt;script&gt;</span><span class="bi-sep"> / </span><span class="bi-zh">&quot;安全&quot;</span>',
        );

        await setLanguageToState('en', state);
        expect(tBiHtml('Context & quota', '上下文与配额')).toBe('Context &amp; quota');
        expect(formatNumber(14_701)).toBe('14,701');

        await setLanguageToState('zh', state);
        expect(tBiHtml('Context & quota', '上下文与配额')).toBe('上下文与配额');
        expect(formatNumber(14_701)).toBe('14,701');
    });
});

describe('cross-platform URI normalization', () => {
    it('normalizes Windows file URIs and backslash paths identically on win32', () => {
        expect(normalizeUri('file:///c%3A/Users/Alice/My%20Repo/', 'win32')).toBe('c:/users/alice/my repo');
        expect(normalizeUri('C:\\Users\\Alice\\My Repo\\', 'win32')).toBe('c:/users/alice/my repo');
        expect(normalizeUri('  C:\\Users\\Alice\\My Repo\r\n', 'win32')).toBe('c:/users/alice/my repo');
    });

    it('preserves case on linux while folding case on darwin and stripping remote authorities', () => {
        expect(normalizeUri('file:///Users/Alice/Repo///', 'darwin')).toBe('/users/alice/repo');
        expect(normalizeUri('file:///home/Alice/Repo/', 'linux')).toBe('/home/Alice/Repo');
        expect(normalizeUri('file:///home/alice/repo/', 'linux')).toBe('/home/alice/repo');
        expect(normalizeUri('vscode-remote://wsl+Ubuntu/home/Dev/App///', 'linux')).toBe('/home/Dev/App');
    });
});

describe('modern account status and quota parsing', () => {
    it('parses modern userInfo without planStatus.planInfo and marks unknown credits/fractions accurately', async () => {
        vi.mocked(rpcCall).mockResolvedValueOnce({
            userStatus: {
                name: 'Ada',
                email: 'ada@example.test',
                userTier: {
                    name: 'Google AI Ultra',
                    id: 'tier-ultra',
                    availableCredits: [
                        { creditType: 'CREDIT_TYPE_PROMPT', creditAmount: 50_000 },
                        { creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI' }, // missing balance -> null (unknown)
                        { creditType: 'CREDIT_TYPE_GOOGLE_AI_STUDIO', creditAmount: '0' }, // explicit 0
                    ],
                },
                cascadeModelConfigData: {
                    clientModelConfigs: [
                        {
                            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M534' },
                            label: 'Gemini 4 Neon (Low)',
                            quotaInfo: { resetTime: '1970-01-01T00:00:00Z' }, // proto3 untouched -> 1
                        },
                        {
                            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M532' },
                            label: 'Gemini 4 Neon (High)',
                            quotaInfo: { resetTime: '2026-11-19T06:00:00Z' }, // proto3 exhausted -> 0
                        },
                        {
                            modelOrAlias: { model: 'MODEL_PLACEHOLDER_M535' },
                            label: 'Gemini 4 Neon (XHigh)',
                            quotaInfo: { remainingFraction: 'not-a-number', resetTime: 'bad-date' }, // malformed -> NaN
                        },
                    ],
                },
            },
        });

        const status = await fetchFullUserStatus(dummyLs);
        expect(status.userInfo).not.toBeNull();
        expect(status.userInfo?.email).toBe('ada@example.test');
        expect(status.userInfo?.userTierName).toBe('Google AI Ultra');
        expect('availablePromptCredits' in (status.userInfo || {})).toBe(false);
        expect('availableFlowCredits' in (status.userInfo || {})).toBe(false);
        expect(status.userInfo?.availableCredits).toEqual([
            { creditType: 'CREDIT_TYPE_PROMPT', creditAmount: 50_000, minimumCreditAmountForUsage: 0 },
            { creditType: 'CREDIT_TYPE_GOOGLE_ONE_AI', creditAmount: null, minimumCreditAmountForUsage: 0 },
            { creditType: 'CREDIT_TYPE_GOOGLE_AI_STUDIO', creditAmount: 0, minimumCreditAmountForUsage: 0 },
        ]);

        expect(status.configs[0].quotaInfo?.remainingFraction).toBe(1);
        expect(status.configs[1].quotaInfo?.remainingFraction).toBe(0);
        expect(Number.isNaN(status.configs[2].quotaInfo?.remainingFraction)).toBe(true);

        // NaN fraction and epoch 1970 resetTime must not poison quota pool aggregation
        const pools = groupModelConfigsByQuotaPool(status.configs);
        expect(pools).toHaveLength(1);
        expect(pools[0].key).toBe('gemini');
        expect(pools[0].minFraction).toBe(0);
        expect(pools[0].resetTime).toBe('2026-11-19T06:00:00Z');
    });

    it('parseStrictResetTimestamp accepts equivalent ISO epoch-0 forms and rejects loose V8 Date.parse quirks', () => {
        // Equivalent proto3 epoch-0 spellings -> 0
        for (const epoch of [
            '1970-01-01T00:00:00Z',
            '1970-01-01T00:00:00.000Z',
            '1970-01-01T00:00:00.000000000Z',
            '1970-01-01T00:00:00+00:00',
            '1970-01-01T01:00:00+01:00',
            '  1970-01-01T00:00:00.000Z  ',
        ]) {
            expect(parseStrictResetTimestamp(epoch), epoch).toBe(0);
        }

        // Valid positive ISO timestamps (including leap day and non-UTC day-boundary offsets)
        expect(parseStrictResetTimestamp('2026-11-19T06:00:00Z')).toBe(Date.parse('2026-11-19T06:00:00Z'));
        expect(parseStrictResetTimestamp('2026-11-19T17:00:00+11:00')).toBe(Date.parse('2026-11-19T06:00:00Z'));
        expect(parseStrictResetTimestamp('2024-02-29T12:00:00Z')).toBe(Date.parse('2024-02-29T12:00:00Z'));
        expect(parseStrictResetTimestamp('2026-03-01T00:30:00+02:00')).toBe(Date.parse('2026-02-28T22:30:00Z'));
        expect(parseStrictResetTimestamp('2026-02-28T23:30:00-02:00')).toBe(Date.parse('2026-03-01T01:30:00Z'));

        // Valid negative ISO timestamp (callers distinguish < 0 from epoch-0 and positive)
        expect(parseStrictResetTimestamp('1969-12-31T23:59:59Z')).toBe(-1000);

        // Loose/malformed/impossible dates and invalid timezone offsets
        for (const bad of [
            '',
            '   ',
            null,
            undefined,
            0,
            '0',
            '1970',
            '1970-01-01',
            '0bad',
            'bad-date',
            '2026-11-12T01:00:00',
            '2026-02-29T12:00:00Z',
            '1900-02-29T12:00:00Z',
            '2026-02-30T00:00:00Z',
            '2026-11-31T00:00:00Z',
            '2026-11-21T24:00:00Z',
            '2026-11-21T12:00:00+24:00',
            '2026-11-21T12:00:00+25:00',
            '2026-11-21T12:00:00+00:60',
            '2026-11-21T12:00:00-24:00',
        ]) {
            expect(parseStrictResetTimestamp(bad), String(bad)).toBeNull();
        }
    });

    it.each([
        { userStatus: [] },
        { userStatus: null },
        { userStatus: 'invalid' },
    ])('fetchFullUserStatus rejects non-object or array userStatus %j without attaching rawResponse', async payload => {
        vi.mocked(rpcCall).mockResolvedValueOnce(payload);
        const status = await fetchFullUserStatus(dummyLs);
        expect(status).toEqual({ configs: [], userInfo: null });
        expect('rawResponse' in status).toBe(false);
    });

    it('treats equivalent epoch-0 resetTime as full quota and malformed/negative resetTime as unknown in fetchFullUserStatus & parseUserQuotaSummary', async () => {
        vi.mocked(rpcCall).mockResolvedValueOnce({
            userStatus: {
                name: 'Ada',
                email: 'ada@example.test',
                cascadeModelConfigData: {
                    clientModelConfigs: [
                        { modelOrAlias: { model: 'MODEL_PLACEHOLDER_M534' }, label: 'Epoch Z', quotaInfo: { resetTime: '1970-01-01T00:00:00Z' } },
                        { modelOrAlias: { model: 'MODEL_PLACEHOLDER_M533' }, label: 'Epoch ms', quotaInfo: { resetTime: '1970-01-01T00:00:00.000Z' } },
                        { modelOrAlias: { model: 'MODEL_PLACEHOLDER_M532' }, label: 'Epoch offset', quotaInfo: { resetTime: '1970-01-01T00:00:00+00:00' } },
                        { modelOrAlias: { model: 'MODEL_PLACEHOLDER_M535' }, label: 'Exhausted', quotaInfo: { resetTime: '2026-11-19T06:00:00Z' } },
                        { modelOrAlias: { model: 'MODEL_BAD_ZERO' }, label: 'Bad Zero', quotaInfo: { resetTime: '0' } },
                        { modelOrAlias: { model: 'MODEL_BAD_YEAR' }, label: 'Bad 1970', quotaInfo: { resetTime: '1970' } },
                        { modelOrAlias: { model: 'MODEL_BAD_CAL' }, label: 'Bad Feb 30', quotaInfo: { resetTime: '2026-02-30T00:00:00Z' } },
                        { modelOrAlias: { model: 'MODEL_BAD_NEG' }, label: 'Negative 1969', quotaInfo: { resetTime: '1969-12-31T23:59:59Z' } },
                    ],
                },
            },
        });

        const status = await fetchFullUserStatus(dummyLs);
        expect(status.configs[0].quotaInfo?.remainingFraction).toBe(1);
        expect(status.configs[1].quotaInfo?.remainingFraction).toBe(1);
        expect(status.configs[2].quotaInfo?.remainingFraction).toBe(1);
        expect(status.configs[3].quotaInfo?.remainingFraction).toBe(0);
        expect(Number.isNaN(status.configs[4].quotaInfo?.remainingFraction)).toBe(true);
        expect(Number.isNaN(status.configs[5].quotaInfo?.remainingFraction)).toBe(true);
        expect(Number.isNaN(status.configs[6].quotaInfo?.remainingFraction)).toBe(true);
        expect(Number.isNaN(status.configs[7].quotaInfo?.remainingFraction)).toBe(true);

        const summary = parseUserQuotaSummary({
            groups: [{
                displayName: 'Gemini Models',
                buckets: [
                    { bucketId: 'gemini-5h', window: '5h', resetTime: '1970-01-01T00:00:00+00:00' },
                    { bucketId: 'gemini-weekly', window: 'weekly', resetTime: '2026-11-28T00:00:00Z' },
                    { bucketId: 'gemini-bad-zero', window: 'other', resetTime: '0' },
                    { bucketId: 'gemini-bad-1970', window: 'other', resetTime: '1970' },
                    { bucketId: 'gemini-bad-neg', window: 'other', resetTime: '1969-12-31T23:59:59Z' },
                    { bucketId: 'gemini-bad-cal', window: 'other', resetTime: '2026-02-30T00:00:00Z' },
                ],
            }],
        });
        expect(summary).not.toBeNull();
        const buckets = summary!.groups[0].buckets;
        expect(buckets[0]).toMatchObject({ remainingFraction: 1, resetTime: null, resetAt: null });
        expect(buckets[1]).toMatchObject({ remainingFraction: 0, resetTime: '2026-11-28T00:00:00Z' });
        expect(buckets[2]).toMatchObject({ remainingFraction: null, resetTime: null, resetAt: null });
        expect(buckets[3]).toMatchObject({ remainingFraction: null, resetTime: null, resetAt: null });
        expect(buckets[4]).toMatchObject({ remainingFraction: null, resetTime: null, resetAt: null });
        expect(buckets[5]).toMatchObject({ remainingFraction: null, resetTime: null, resetAt: null });
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getLanguage, setLanguageToState } from '../src/i18n';
import { MONITOR_COMMAND, getContextReading, selectMonitorQuotaGroups } from '../src/monitor-overview';
import { StatusBarManager } from '../src/statusbar';
import type { ModelConfig } from '../src/models';
import type { ContextUsage } from '../src/tracker';
import { buildOverviewTabContent } from '../src/webview-overview-tab';

const initialLanguage = getLanguage();
const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };
const now = Date.parse('2026-11-19T01:00:00Z');
const neon = 'MODEL_PLACEHOLDER_M535';

function usage(values: Partial<ContextUsage> = {}): ContextUsage {
    return {
        cascadeId: 'sample', title: 'Local <session> & notes', model: neon, modelDisplayName: 'Gemini 4 Neon (XHigh)',
        contextLimit: 512_000, contextUsed: 24_000, usagePercent: 4.6875, status: 'IDLE', stepCount: 1,
        lastModifiedTime: '', isEstimated: false, lastModelUsage: null, totalOutputTokens: 10,
        totalToolCallOutputTokens: 100, estimatedDeltaSinceCheckpoint: 0, imageGenStepCount: 0,
        compressionDetected: false, checkpointCompressionDrop: 0, hasGaps: false, checkpointModel: '',
        createdTime: '', lastUserInputTime: '', lastUserInputStepIndex: 0, repositoryName: '', gitOriginUrl: '',
        branchName: '', gitRootUri: '', ...values,
    };
}

function config(model: string, label: string, fraction: number, resetTime = '2026-11-19T02:00:00Z'): ModelConfig {
    return {
        model, label, quotaInfo: { remainingFraction: fraction, resetTime }, supportsImages: false,
        allowedTiers: [], mimeTypeCount: 0, isRecommended: false, supportedMimeTypes: [],
    };
}

beforeEach(async () => { await setLanguageToState('en', state); });
afterEach(async () => {
    vi.restoreAllMocks();
    await setLanguageToState(initialLanguage, state);
});

describe('status hover and overview', () => {
    it('offers three allowlisted hover destinations and counts both Neon types in one pool', () => {
        const create = vi.spyOn(vscode.window, 'createStatusBarItem');
        const manager = new StatusBarManager();
        const item = create.mock.results[0].value as vscode.StatusBarItem;
        manager.setModelConfigs([
            config(neon, 'Gemini 4 Neon (XHigh)', 0.5165423),
            config('MODEL_PLACEHOLDER_M537', 'Orchestrator (Neon)', 0.5165423),
        ]);
        manager.update(usage());
        const tooltip = item.tooltip as vscode.MarkdownString;
        expect(tooltip.isTrusted).toEqual({ enabledCommands: [MONITOR_COMMAND] });
        expect(tooltip.value.match(/\bGemini · \*\*52%\*\*/g)).toHaveLength(1);
        expect(tooltip.value).toContain('Gemini 4 Neon \\(Extra\\)');
        for (const tab of ['overview', 'models', 'settings']) {
            expect(tooltip.value).toContain(`command:${MONITOR_COMMAND}?${encodeURIComponent(JSON.stringify([tab]))}`);
        }
        expect(item.text).not.toContain('||');
        manager.dispose();
    });

    it('shows no stale metrics during disconnect and no invented zero/limit in an empty session', () => {
        const configs = [config(neon, 'Gemini 4 Neon (XHigh)', 0.35)];
        const offline = buildOverviewTabContent(usage(), configs, null, 0, { state: 'disconnected', backendIssue: 'lost' }, now);
        expect(offline).toContain('Reconnecting');
        expect(offline).not.toMatch(/35%|24,000|512,000/);
        const idle = buildOverviewTabContent(null, configs, null, 0, { state: 'idle' }, now);
        expect(idle).toContain('No context measurement');
        expect(idle).toContain('35%');
        expect(idle).not.toContain('512,000');
    });

    it('escapes labels, shows split readings and bounds the meter without hiding overflow', () => {
        const data = [
            config(neon, 'Gemini 4 Neon (XHigh)', 0),
            config('MODEL_PLACEHOLDER_M537', 'Orchestrator (Neon)', 0.54, '2026-11-19T04:00:00Z'),
            config('future', 'New <model>', NaN, '2026-02-31T10:00:00Z'),
        ];
        const html = buildOverviewTabContent(usage({ contextUsed: 640_000 }), data, null, 0, { state: 'active' }, now);
        expect(html).toContain('Local &lt;session&gt; &amp; notes');
        expect(html).toContain('New &lt;model&gt;');
        expect(html).toContain('0–54%');
        expect(html).toContain('Reset times vary');
        expect(html).toContain('Reset time unavailable');
        expect(html).toContain('Above the context limit');
        expect(html).toContain('aria-valuenow="100" aria-valuetext="125%"');
        expect(html).not.toMatch(/NaN|Infinity/);
    });

    it('keeps independent unknown IDs separate even at the same reset time', () => {
        const groups = selectMonitorQuotaGroups([
            config('unknown-one', 'Unknown A', 0.7),
            config('unknown-two', 'Unknown B', 0.25),
        ]);
        expect(groups.map(group => group.label)).toEqual(['Unknown B', 'Unknown A']);
    });

    it('handles malformed limits and translates the Extra label and status actions in bilingual mode', async () => {
        await setLanguageToState('both', state);
        const malformed = usage({ contextUsed: Infinity, contextLimit: 0 });
        expect(getContextReading(malformed)).toEqual({ used: null, limit: null, percent: null });
        const html = buildOverviewTabContent(malformed, [], null);
        expect(html).toContain('Context &amp; quota / 上下文与配额');
        expect(html).toContain('Gemini 4 Neon (Extra / 超高)');
        expect(html).toContain('View models / 查看模型');
        expect(html).not.toMatch(/NaN|Infinity|role="meter"/);
    });
});

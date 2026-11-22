import { describe, expect, it } from 'vitest';
import {
    CONTEXT_CATEGORY_META,
    CONTEXT_CATEGORY_ORDER,
    buildDotMatrix,
    formatContextTextReport,
    formatDotMatrixRows,
    formatHandoffPrompt,
    mapTokenTypeToCategory,
    parseContextBreakdown,
    type ContextCategorySegment,
    type GeneratorMetadataLike,
} from '../src/context-breakdown';
import { StepType } from '../src/constants';

describe('mapTokenTypeToCategory', () => {
    it('maps Antigravity TOKEN_TYPE_* enums accurately across all categories', () => {
        expect(mapTokenTypeToCategory('TOKEN_TYPE_SYSTEM_PROMPT')).toBe('system');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_CHECKPOINT')).toBe('system');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_SKILLS')).toBe('rules_skills');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_RULES')).toBe('rules_skills');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_USER_RULES')).toBe('rules_skills');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_WORKFLOWS')).toBe('rules_skills');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_PLUGINS')).toBe('plugins_mcp');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_MCP_SERVERS')).toBe('plugins_mcp');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_SUBAGENTS')).toBe('subagents');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_SWARM')).toBe('subagents');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_USER_MESSAGE')).toBe('user');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_ASSISTANT')).toBe('assistant_thinking');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_THINKING')).toBe('assistant_thinking');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_TOOLS')).toBe('tools');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_TOOL_RESULTS')).toBe('tools');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_MEDIA')).toBe('media_files');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_FILES')).toBe('media_files');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_UNKNOWN')).toBe('other');
    });

    it('falls back cleanly to section title heuristics when tokenType is generic or absent', () => {
        expect(mapTokenTypeToCategory('', 'System Instructions')).toBe('system');
        expect(mapTokenTypeToCategory('TOKEN_TYPE_GENERIC', 'AGENTS.md Rules')).toBe('rules_skills');
        expect(mapTokenTypeToCategory(undefined, 'MCP Server Catalog')).toBe('plugins_mcp');
        expect(mapTokenTypeToCategory(undefined, 'Swarm Worker Roster')).toBe('subagents');
        expect(mapTokenTypeToCategory(undefined, 'Open Files & Screenshots')).toBe('media_files');
        expect(mapTokenTypeToCategory(undefined, 'Unclassified Misc Blob')).toBe('other');
    });
});

describe('parseContextBreakdown', () => {
    it('parses promptSections + additive chatModel.usage with dual-cap metadata accurately', () => {
        const gm: GeneratorMetadataLike[] = [
            {
                stepIndices: [1, 2],
                plannerConfig: { truncationThresholdTokens: 512_000 },
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M532',
                    modelDisplayName: 'Gemini 4 Neon (High)',
                    promptSections: [
                        { title: 'Core System Prompt', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', contentLen: 40_000 },
                        { title: 'Workspace Rules', tokenType: 'TOKEN_TYPE_RULES', contentLen: 12_000 },
                        { title: 'Loaded Skills', tokenType: 'TOKEN_TYPE_SKILLS', contentLen: 8_000 },
                        { title: 'Installed Plugins', tokenType: 'TOKEN_TYPE_PLUGINS', contentLen: 16_000 },
                        { title: 'Subagent Definitions', tokenType: 'TOKEN_TYPE_SUBAGENTS', contentLen: 4_000 },
                    ],
                    usage: {
                        // Additive prompt tokens = 10_000 + 40_000 + 0 = 50_000
                        // Output = 2_400 (thinkingOutputTokens=1_000 is subset, NOT summed)
                        inputTokens: 10_000,
                        cacheReadTokens: 40_000,
                        outputTokens: 2_400,
                        thinkingOutputTokens: 1_000,
                        responseOutputTokens: 1_400,
                    },
                    chatStartMetadata: {
                        createdAt: '2026-11-22T10:00:00Z',
                    },
                },
            },
        ];

        const steps = [
            { stepIndex: 0, type: StepType.USER_INPUT, userInput: { userResponse: 'Explain the architecture in detail.' } },
            {
                stepIndex: 1,
                type: 'CORTEX_STEP_TYPE_VIEW_FILE',
                viewFile: { absolutePath: '/repo/src/tracker.ts' },
                metadata: { toolCallOutputTokens: 12_000, toolCall: { name: 'read_file' } },
            },
            {
                stepIndex: 2,
                type: 'CORTEX_STEP_TYPE_RUN_COMMAND',
                metadata: { toolCallOutputTokens: 8_000, toolCall: { name: 'run_command' } },
            },
        ];

        const snap = parseContextBreakdown({ generatorMetadata: gm, steps });

        expect(snap.measurementState).toBe('measured');
        expect(snap.attributionSource).toBe('prompt_sections');
        expect(snap.hasPromptSections).toBe(true);
        expect(snap.model).toBe('MODEL_PLACEHOLDER_M532');
        expect(snap.modelDisplayName).toBe('Gemini 4 Neon (High)');

        // Dual cap: 512k effective autocompact vs 1,048,576 native ceiling
        expect(snap.effectiveBudgetTokens).toBe(512_000);
        expect(snap.nativeLimitTokens).toBe(1_048_576);
        expect(snap.hasDualCap).toBe(true);

        // Total used should equal 50_000 prompt + 2_400 output = 52_400 (thinking NOT double counted!)
        expect(snap.usedTokens).toBe(52_400);
        expect(snap.effectivePct).toBeCloseTo(10.2, 1);
        expect(snap.nativePct).toBeCloseTo(5.0, 1);

        const byKey = Object.fromEntries(snap.segments.map(s => [s.key, s]));
        expect(byKey.system.tokens).toBe(10_000);
        expect(byKey.rules_skills.tokens).toBe(5_000);
        expect(byKey.rules_skills.itemCount).toBe(2);
        expect(byKey.plugins_mcp.tokens).toBe(4_000);
        expect(byKey.subagents.tokens).toBe(1_000);
        expect(byKey.assistant_thinking.tokens).toBe(2_400);
        // Remaining 30,000 prompt tokens attributed across user/media_files/tools from steps
        expect(byKey.media_files.tokens).toBeGreaterThan(0);
        expect(byKey.tools.tokens).toBeGreaterThan(0);

        // Largest items capped at <= 5 and sorted descending
        expect(snap.largestItems.length).toBeLessThanOrEqual(5);
        expect(snap.largestItems[0].tokens).toBeGreaterThanOrEqual(snap.largestItems[1].tokens);
    });

    it('scales promptSections proportionally when contentLen/4 exceeds measured prompt tokens', () => {
        const snap = parseContextBreakdown({
            generatorMetadata: [
                {
                    stepIndices: [1],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M402',
                        promptSections: [
                            { title: 'Huge System', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', contentLen: 400_000 }, // 100k est
                            { title: 'Huge Skills', tokenType: 'TOKEN_TYPE_SKILLS', contentLen: 400_000 }, // 100k est
                        ],
                        usage: { inputTokens: 20_000, cacheReadTokens: 0, outputTokens: 500 },
                    },
                },
            ],
        });

        expect(snap.usedTokens).toBe(20_500);
        const sys = snap.segments.find(s => s.key === 'system')!;
        const rules = snap.segments.find(s => s.key === 'rules_skills')!;
        expect(sys.tokens).toBe(10_000);
        expect(rules.tokens).toBe(10_000);
    });

    it('falls back gracefully to step-level attribution when promptSections are absent without fabricating fake zeros', () => {
        const steps = [
            { stepIndex: 0, type: StepType.USER_INPUT, userInput: { userResponse: 'Please inspect package.json and run tests.' } },
            {
                stepIndex: 1,
                type: 'CORTEX_STEP_TYPE_VIEW_FILE',
                viewFile: { absolutePath: '/workspace/package.json' },
                metadata: { toolCallOutputTokens: 1_500, toolCall: { name: 'read_file' } },
            },
            {
                stepIndex: 2,
                type: 'CORTEX_STEP_TYPE_MCP_TOOL',
                metadata: { toolCallOutputTokens: 900, toolCall: { name: 'mcp__github__list_issues' }, toolSource: 'mcp' },
            },
            {
                stepIndex: 3,
                type: StepType.PLANNER_RESPONSE,
                plannerResponse: { response: 'All checks look good.', thinking: 'Checking dependencies...' },
                metadata: {
                    generatorModel: 'MODEL_PLACEHOLDER_M405',
                    modelUsage: { inputTokens: 4_000, cacheReadTokens: 6_000, outputTokens: 300 },
                },
            },
        ];

        const snap = parseContextBreakdown({ steps });

        expect(snap.measurementState).toBe('measured');
        expect(snap.attributionSource).toBe('steps');
        expect(snap.hasPromptSections).toBe(false);
        expect(snap.usedTokens).toBe(10_300);

        // No fake zero segments emitted for unmeasured categories like rules_skills or subagents
        expect(snap.segments.every(s => s.tokens > 0)).toBe(true);
        expect(snap.segments.find(s => s.key === 'rules_skills')).toBeUndefined();
        expect(snap.segments.find(s => s.key === 'subagents')).toBeUndefined();

        expect(snap.segments.find(s => s.key === 'media_files')?.tokens).toBe(1_500);
        expect(snap.segments.find(s => s.key === 'plugins_mcp')?.tokens).toBe(900);
        expect(snap.segments.find(s => s.key === 'system')?.tokens).toBeGreaterThan(0);
    });

    it('classifies brand-new pre-generation conversation as awaiting_generation without fake zeros', () => {
        const emptySnap = parseContextBreakdown({ generatorMetadata: [], steps: [] });
        expect(emptySnap.measurementState).toBe('awaiting_generation');
        expect(emptySnap.usedTokens).toBe(0);
        expect(emptySnap.segments).toEqual([]);
        expect(emptySnap.largestItems).toEqual([]);
        expect(Number.isNaN(emptySnap.effectivePct)).toBe(false);

        const pendingUserSnap = parseContextBreakdown({
            steps: [
                { stepIndex: 0, type: StepType.USER_INPUT, userInput: { userResponse: 'Hello Antigravity!' } },
            ],
            model: 'MODEL_PLACEHOLDER_M532',
        });
        expect(pendingUserSnap.measurementState).toBe('awaiting_generation');
        expect(pendingUserSnap.usedTokens).toBeGreaterThan(0);
        expect(pendingUserSnap.segments.map(s => s.key)).toEqual(['user']);
    });

    it('detects compaction checkpoints across generations and marks unmeasured post-compaction state', () => {
        // Case 1: Completed compaction followed by measured post-compaction generation
        const completedSnap = parseContextBreakdown({
            generatorMetadata: [
                {
                    stepIndices: [4],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M402',
                        usage: { inputTokens: 20_000, cacheReadTokens: 180_000, outputTokens: 1_500 },
                        chatStartMetadata: { checkpointIndex: 0, createdAt: '2026-11-22T10:00:00Z' },
                    },
                },
                {
                    stepIndices: [7],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M402',
                        usage: { inputTokens: 30_000, cacheReadTokens: 5_000, outputTokens: 1_000 },
                        chatStartMetadata: { checkpointIndex: 1, createdAt: '2026-11-22T10:05:00Z' },
                    },
                },
            ],
            steps: [
                { stepIndex: 5, type: StepType.CHECKPOINT, checkpoint: { checkpointIndex: 1, sessionSummary: 'Compacted summary' }, metadata: { createdAt: '2026-11-22T10:04:00Z' } },
                { stepIndex: 7, type: StepType.PLANNER_RESPONSE, plannerResponse: { response: 'Continued.' } },
            ],
            currentStepCount: 8,
            previousMaxStepCount: 6,
        });

        expect(completedSnap.measurementState).toBe('measured');
        expect(completedSnap.compactionCheckpoints).toHaveLength(1);
        expect(completedSnap.compactionCheckpoints[0]).toMatchObject({
            stepIndex: 5,
            beforeTokens: 200_000,
            afterTokens: 35_000,
            savedTokens: 165_000,
            timestamp: '2026-11-22T10:04:00Z',
        });

        // Case 2: Full compaction checkpoint occurred AFTER latest generation -> estimated_post_compaction
        const pendingCompactionSnap = parseContextBreakdown({
            generatorMetadata: [
                {
                    stepIndices: [4],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M402',
                        promptSections: [
                            { title: 'System Prompt', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', contentLen: 40_000 },
                        ],
                        usage: { inputTokens: 190_000, cacheReadTokens: 0, outputTokens: 1_000 },
                    },
                },
            ],
            steps: [
                { stepIndex: 5, type: StepType.CHECKPOINT, checkpoint: { checkpointIndex: 1, tokens: 4_000, sessionSummary: 'Summary of prior work' }, metadata: { createdAt: '2026-11-22T10:06:00Z' } },
                { stepIndex: 6, type: StepType.USER_INPUT, userInput: { userResponse: 'Now run the tests' } },
            ],
            currentStepCount: 7,
            previousMaxStepCount: 5,
        });

        expect(pendingCompactionSnap.measurementState).toBe('estimated_post_compaction');
        expect(pendingCompactionSnap.usedTokens).toBeLessThan(30_000);
        expect(pendingCompactionSnap.compactionCheckpoints).toHaveLength(1);
        expect(pendingCompactionSnap.compactionCheckpoints[0].savedTokens).toBeGreaterThan(150_000);
    });

    it('classifies shrinking step count as estimated_rewind and NEVER as compaction', () => {
        const snap = parseContextBreakdown({
            generatorMetadata: [
                {
                    stepIndices: [2],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M532',
                        usage: { inputTokens: 180_000, cacheReadTokens: 0, outputTokens: 500 },
                    },
                },
                {
                    stepIndices: [3],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M532',
                        usage: { inputTokens: 25_000, cacheReadTokens: 0, outputTokens: 500 },
                    },
                },
            ],
            steps: [
                { stepIndex: 0, type: StepType.USER_INPUT, userInput: { userResponse: 'Initial prompt' } },
                { stepIndex: 1, type: StepType.PLANNER_RESPONSE, plannerResponse: { response: 'Initial reply' } },
            ],
            currentStepCount: 4,
            previousMaxStepCount: 15,
        });

        expect(snap.measurementState).toBe('estimated_rewind');
        expect(snap.compactionCheckpoints).toEqual([]);
    });

    it('truncates long titles in largestItems and caps at 5 items', () => {
        const longTitle = 'A'.repeat(140) + '\nwith\tnewlines';
        const sections = Array.from({ length: 8 }, (_, idx) => ({
            title: idx === 0 ? longTitle : `Section ${idx}`,
            tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT',
            contentLen: (10 - idx) * 4_000,
        }));

        const snap = parseContextBreakdown({
            generatorMetadata: [
                {
                    stepIndices: [1],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M532',
                        promptSections: sections,
                        usage: { inputTokens: 52_000, outputTokens: 500 },
                    },
                },
            ],
        });

        expect(snap.largestItems).toHaveLength(5);
        expect(snap.largestItems[0].title.length).toBeLessThanOrEqual(80);
        expect(snap.largestItems[0].title.endsWith('...')).toBe(true);
        expect(snap.largestItems[0].title).not.toContain('\n');
    });

    it('falls back to tokenBreakdown.groups when promptSections are omitted', () => {
        const snap = parseContextBreakdown({
            generatorMetadata: [
                {
                    stepIndices: [2],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M402',
                        usage: { inputTokens: 15_000, cacheReadTokens: 15_000, outputTokens: 1_000 },
                        chatStartMetadata: {
                            contextWindowMetadata: {
                                maxContextTokens: 256_000,
                                tokenBreakdown: {
                                    groups: [
                                        {
                                            name: 'System Prompt',
                                            type: 'TOKEN_TYPE_SYSTEM_PROMPT',
                                            numTokens: 12_000,
                                            children: [{ name: 'Core Instructions', numTokens: 12_000 }],
                                        },
                                        {
                                            name: 'Tool Results',
                                            type: 'TOKEN_TYPE_TOOLS',
                                            numTokens: 18_000,
                                            children: [{ name: 'run_command output', numTokens: 18_000 }],
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            ],
        });

        expect(snap.attributionSource).toBe('token_breakdown');
        expect(snap.measurementState).toBe('measured');
        expect(snap.usedTokens).toBe(31_000);
        expect(snap.effectiveBudgetTokens).toBe(256_000);
        expect(snap.hasDualCap).toBe(true);
        expect(snap.largestItems[0]).toMatchObject({
            title: 'run_command output',
            category: 'tools',
            tokens: 18_000,
        });
    });

    it('handles single-cap models and explicit budget overrides cleanly', () => {
        const singleCap = parseContextBreakdown({
            generatorMetadata: [{ chatModel: { usage: { inputTokens: 50_000 } } }],
            effectiveBudgetTokens: 200_000,
            nativeLimitTokens: 200_000,
        });
        expect(singleCap.hasDualCap).toBe(false);
        expect(singleCap.effectivePct).toBe(25);
        expect(singleCap.nativePct).toBe(25);

        const clampedCap = parseContextBreakdown({
            generatorMetadata: [{ chatModel: { usage: { inputTokens: 50_000 } } }],
            effectiveBudgetTokens: 300_000,
            nativeLimitTokens: 200_000,
        });
        expect(clampedCap.nativeLimitTokens).toBe(300_000);
        expect(clampedCap.hasDualCap).toBe(false);
    });

    it('does not flag intentOnly checkpoints as post-compaction estimation', () => {
        const snap = parseContextBreakdown({
            generatorMetadata: [
                {
                    stepIndices: [2],
                    chatModel: {
                        model: 'MODEL_PLACEHOLDER_M532',
                        usage: { inputTokens: 20_000, cacheReadTokens: 10_000, outputTokens: 500 },
                    },
                },
            ],
            steps: [
                { stepIndex: 3, type: StepType.CHECKPOINT, checkpoint: { intentOnly: true, userIntent: 'Summarize intent' } },
            ],
        });
        expect(snap.measurementState).toBe('measured');
        expect(snap.compactionCheckpoints).toEqual([]);
    });
});

describe('buildDotMatrix & formatDotMatrixRows', () => {
    const makeSeg = (key: (typeof CONTEXT_CATEGORY_ORDER)[number], tokens: number): ContextCategorySegment => {
        const meta = CONTEXT_CATEGORY_META[key];
        return {
            key,
            labelEn: meta.labelEn,
            labelZh: meta.labelZh,
            colorToken: meta.colorToken,
            tokens,
            pct: 0,
            sharePct: 0,
            itemCount: 1,
        };
    };

    it('returns 100 free dots when usage is 0 or segments are empty', () => {
        const empty = buildDotMatrix([], 0, 256_000);
        expect(empty).toHaveLength(100);
        expect(empty.every(c => c.isFree && c.category === 'free')).toBe(true);

        const zeroTokens = buildDotMatrix([makeSeg('system', 0)], 0, 256_000);
        expect(zeroTokens).toHaveLength(100);
        expect(zeroTokens.every(c => c.isFree)).toBe(true);
    });

    it('gives every non-empty segment >= 1 dot and keeps exact gridSize length', () => {
        const segments = [
            makeSeg('system', 50_000),
            makeSeg('rules_skills', 50), // tiny 0.02% segment
            makeSeg('plugins_mcp', 20),  // tiny 0.008% segment
            makeSeg('user', 25_000),
        ];
        const total = 75_070;
        const cells = buildDotMatrix(segments, total, 250_000, 100);

        expect(cells).toHaveLength(100);
        const countOf = (cat: string) => cells.filter(c => c.category === cat).length;
        expect(countOf('system')).toBeGreaterThanOrEqual(1);
        expect(countOf('rules_skills')).toBeGreaterThanOrEqual(1);
        expect(countOf('plugins_mcp')).toBeGreaterThanOrEqual(1);
        expect(countOf('user')).toBeGreaterThanOrEqual(1);
        expect(countOf('free')).toBeGreaterThan(60);
        expect(cells.map(c => c.index)).toEqual(Array.from({ length: 100 }, (_, i) => i));
    });

    it('clamps overflow usage >= 100% cleanly to exact gridSize with zero free dots', () => {
        const segments = [
            makeSeg('system', 100_000),
            makeSeg('tools', 200_000),
            makeSeg('subagents', 100),
        ];
        const cells = buildDotMatrix(segments, 300_100, 200_000, 100);

        expect(cells).toHaveLength(100);
        expect(cells.filter(c => c.isFree)).toHaveLength(0);
        expect(cells.filter(c => c.category === 'subagents').length).toBeGreaterThanOrEqual(1);
        expect(cells.filter(c => c.category === 'tools').length).toBeGreaterThan(
            cells.filter(c => c.category === 'system').length,
        );
    });

    it('handles tiny grid sizes and formats 20x5 and 10x10 row layouts', () => {
        const segments = [
            makeSeg('system', 500),
            makeSeg('user', 300),
            makeSeg('tools', 200),
            makeSeg('other', 100),
        ];
        const tiny = buildDotMatrix(segments, 1_100, 2_000, 2);
        expect(tiny).toHaveLength(2);
        expect(tiny.map(c => c.category)).toEqual(['system', 'user']);

        const grid100 = buildDotMatrix(segments, 1_100, 2_000, 100);
        const rows20x5 = formatDotMatrixRows(grid100, 20);
        expect(rows20x5).toHaveLength(5);
        expect(rows20x5.every(r => r.length === 20)).toBe(true);

        const rows10x10 = formatDotMatrixRows(grid100, 10);
        expect(rows10x10).toHaveLength(10);
        expect(rows10x10.every(r => r.length === 10)).toBe(true);

        // Zero capacity and NaN inputs stay safe and exact length
        const zeroCap = buildDotMatrix(segments, 1_100, 0, 100);
        expect(zeroCap).toHaveLength(100);
        expect(zeroCap.filter(c => c.isFree)).toHaveLength(0);

        const nanInputs = buildDotMatrix(segments, Number.NaN, Number.NaN, 100);
        expect(nanInputs).toHaveLength(100);
    });
});

describe('formatContextTextReport & formatHandoffPrompt', () => {
    const sampleSnapshot = parseContextBreakdown({
        generatorMetadata: [
            {
                stepIndices: [3],
                plannerConfig: { truncationThresholdTokens: 256_000 },
                chatModel: {
                    model: 'MODEL_PLACEHOLDER_M402',
                    modelDisplayName: 'Claude Opus 5.5 (High)',
                    promptSections: [
                        { title: 'System Prompt', tokenType: 'TOKEN_TYPE_SYSTEM_PROMPT', contentLen: 40_000 },
                        { title: 'Workspace Rules', tokenType: 'TOKEN_TYPE_RULES', contentLen: 16_000 },
                    ],
                    usage: { inputTokens: 18_000, cacheReadTokens: 82_000, outputTokens: 2_000 },
                },
            },
        ],
        nativeLimitTokens: 1_000_000,
    });

    it('renders EN, ZH, and Both /context text reports with dual-cap, table, largest items, and quota summary', () => {
        const reportInput = {
            snapshot: sampleSnapshot,
            title: 'Implement Antigravity App Support',
            workspacePath: '/Users/dev/antigravity',
            branchName: 'feat/v1.17.5',
            cacheHitPct: 82.0,
            turnStartKind: 'warm' as const,
            quotaSummary: [
                { poolName: 'Claude & GPT', remainingPct: 68, resetCountdown: '3h12m', runwayLabel: 'Safe before reset' },
            ],
        };

        const en = formatContextTextReport(reportInput, 'en');
        expect(en).toContain('Context Window Report');
        expect(en).toContain('Claude Opus 5.5 (High)');
        expect(en).toContain('effective budget');
        expect(en).toContain('Native Ceiling');
        expect(en).toContain('Category Breakdown');
        expect(en).toContain('Largest Items');
        expect(en).toContain('Quota Summary');
        expect(en).toContain('Claude & GPT');
        expect(en).toContain('Warm Cache');
        expect(en).not.toContain('上下文窗口报告');

        const zh = formatContextTextReport(reportInput, 'zh');
        expect(zh).toContain('上下文窗口报告');
        expect(zh).toContain('有效预算');
        expect(zh).toContain('原生上限');
        expect(zh).toContain('分类明细');
        expect(zh).toContain('最大占用项');
        expect(zh).toContain('配额摘要');
        expect(zh).toContain('热缓存');
        expect(zh).not.toContain('Context Window Report');

        const both = formatContextTextReport(reportInput, 'both');
        expect(both).toContain('Context Window Report / 上下文窗口报告');
        expect(both).toContain('Category Breakdown / 分类明细');
        expect(both).toContain('System Prompt / 系统提示');
    });

    it('renders practical HANDOFF.md prompts in EN, ZH, and Both modes', () => {
        const handoffInput = {
            snapshot: sampleSnapshot,
            title: 'Migrate telemetry core',
            workspacePath: '/Users/dev/antigravity',
            branchName: 'main',
            recentTopics: ['Dual-cap context breakdown', 'Quota runway prediction'],
            activeTools: ['read_file', 'edit_file', 'run_command', 'read_file'],
            pendingTasks: ['Wire sidecar panel UI', 'Run full Vitest matrix'],
        };

        const en = formatHandoffPrompt(handoffInput, 'en');
        expect(en).toContain('# HANDOFF — Session Continuation');
        expect(en).toContain('/Users/dev/antigravity');
        expect(en).toContain('Dual-cap context breakdown');
        expect(en).toContain('`read_file`, `edit_file`, `run_command`');
        expect(en).toContain('- [ ] Wire sidecar panel UI');

        const zh = formatHandoffPrompt(handoffInput, 'zh');
        expect(zh).toContain('# HANDOFF — 会话交接继续执行');
        expect(zh).toContain('## 续接检查清单');
        expect(zh).toContain('## 常用工具');

        const both = formatHandoffPrompt({ snapshot: sampleSnapshot }, 'both');
        expect(both).toContain('Session Context / 会话概况');
        expect(both).toContain('Resume Checklist / 续接检查清单');
        expect(both).toContain('- [ ] ');

        // Verify awaiting_generation and estimated_rewind report notes render cleanly
        const rewindSnap = parseContextBreakdown({
            steps: [],
            currentStepCount: 2,
            previousMaxStepCount: 10,
        });
        expect(formatContextTextReport({ snapshot: rewindSnap }, 'en')).toContain('Estimated (rewind)');
        expect(formatContextTextReport({ snapshot: rewindSnap }, 'zh')).toContain('估算（回退）');

        const awaitingSnap = parseContextBreakdown({ steps: [] });
        expect(formatContextTextReport({ snapshot: awaitingSnap }, 'en')).toContain('Awaiting generation');
        expect(formatContextTextReport({ snapshot: awaitingSnap }, 'zh')).toContain('等待生成');
    });
});

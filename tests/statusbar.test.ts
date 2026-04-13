import { describe, it, expect } from 'vitest';
import { formatTokenCount, formatContextLimit, calculateCompressionStats, StatusBarManager } from '../src/statusbar';
import { ContextUsage, ModelUsageInfo } from '../src/tracker';

// ─── formatTokenCount ─────────────────────────────────────────────────────────

describe('formatTokenCount', () => {
    it('should format values >= 1M with M suffix', () => {
        expect(formatTokenCount(1_000_000)).toBe('1M');
        expect(formatTokenCount(1_500_000)).toBe('1.5M');
        expect(formatTokenCount(2_000_000)).toBe('2M');
    });

    it('should format values >= 1K with k suffix', () => {
        expect(formatTokenCount(1_000)).toBe('1k');
        expect(formatTokenCount(45_231)).toBe('45.2k');
        expect(formatTokenCount(999_999)).toBe('1000k'); // rounds to integer
    });

    it('should format values < 1K as raw number', () => {
        expect(formatTokenCount(0)).toBe('0');
        expect(formatTokenCount(500)).toBe('500');
        expect(formatTokenCount(999)).toBe('999');
    });

    it('should clamp negative values to 0', () => {
        expect(formatTokenCount(-100)).toBe('0');
    });
});

// ─── formatContextLimit ───────────────────────────────────────────────────────

describe('formatContextLimit', () => {
    it('should format 1M limit correctly', () => {
        expect(formatContextLimit(1_000_000)).toBe('1M');
    });

    it('should format 200K limit correctly', () => {
        expect(formatContextLimit(200_000)).toBe('200k');
    });

    it('should format 128K limit correctly', () => {
        expect(formatContextLimit(128_000)).toBe('128k');
    });

    it('should clamp negative values to 0', () => {
        expect(formatContextLimit(-1)).toBe('0');
    });
});

// ─── calculateCompressionStats ────────────────────────────────────────────────

function makeUsage(overrides: Partial<ContextUsage>): ContextUsage {
    return {
        cascadeId: 'test-id',
        title: 'Test',
        model: 'MODEL_PLACEHOLDER_M37',
        modelDisplayName: 'Gemini 3.1 Pro',
        contextUsed: 100_000,
        totalOutputTokens: 5_000,
        totalToolCallOutputTokens: 2_000,
        contextLimit: 1_000_000,
        usagePercent: 10,
        stepCount: 5,
        lastModifiedTime: '',
        status: 'IDLE',
        isEstimated: false,
        lastModelUsage: null,
        estimatedDeltaSinceCheckpoint: 0,
        imageGenStepCount: 0,
        compressionDetected: false,
        checkpointCompressionDrop: 0,
        hasGaps: false,
        createdTime: '',
        lastUserInputTime: '',
        lastUserInputStepIndex: 0,
        repositoryName: '',
        gitOriginUrl: '',
        branchName: '',
        gitRootUri: '',
        ...overrides,
    };
}

describe('calculateCompressionStats', () => {
    it('should return null when no compression detected', () => {
        const usage = makeUsage({ compressionDetected: false });
        expect(calculateCompressionStats(usage)).toBeNull();
    });

    it('should calculate context drop stats', () => {
        const usage = makeUsage({
            compressionDetected: true,
            previousContextUsed: 200_000,
            contextUsed: 100_000,
        });
        const stats = calculateCompressionStats(usage);
        expect(stats).not.toBeNull();
        expect(stats!.source).toBe('context');
        expect(stats!.dropTokens).toBe(100_000);
        expect(stats!.dropPercent).toBe(50);
    });

    it('should calculate checkpoint drop stats as fallback', () => {
        const usage = makeUsage({
            compressionDetected: true,
            checkpointCompressionDrop: 50_000,
            lastModelUsage: {
                model: 'M37',
                inputTokens: 80_000,
                outputTokens: 5_000,
                responseOutputTokens: 0,
                cacheReadTokens: 0,
            },
        });
        const stats = calculateCompressionStats(usage);
        expect(stats).not.toBeNull();
        expect(stats!.source).toBe('checkpoint');
        expect(stats!.dropTokens).toBe(50_000);
        // previousInput = 80K + 50K = 130K → dropPercent = 50K/130K ≈ 38.5%
        expect(stats!.dropPercent).toBeCloseTo(38.46, 1);
    });
});

describe('StatusBarManager plan cache', () => {
    it('should clear stale tier name when the latest status omits it', () => {
        const manager = new StatusBarManager();
        manager.setPlanName('Pro', 'Google AI Ultra');
        manager.setPlanName('Pro', '');
        manager.showIdle();

        const tooltip = ((manager as any).statusBarItem.tooltip as { value: string }).value;
        expect(tooltip).toContain('**Pro**');
        expect(tooltip).not.toContain('Google AI Ultra');
    });

    it('shows the plan source in the hover tooltip when available', () => {
        const manager = new StatusBarManager();
        manager.setPlanName('Free', 'Gemini Code Assist for individuals', 'cloud-cache');
        manager.showIdle();

        const tooltip = ((manager as any).statusBarItem.tooltip as { value: string }).value;
        expect(tooltip).toContain('Cloud verified (cached)');
    });
});

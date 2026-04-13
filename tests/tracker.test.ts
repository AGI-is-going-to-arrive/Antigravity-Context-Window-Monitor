import { describe, it, expect } from 'vitest';
import {
    processSteps,
    estimateTokensFromText,
    normalizeUri,
} from '../src/tracker';
import { mapCloudTierToDisplayPlan } from '../src/cloud-plan';
import { stabilizeUserStatusInfo, type UserStatusInfo } from '../src/models';
import { StepType } from '../src/constants';

// ─── normalizeUri ────────────────────────────────────────────────────────────

describe('normalizeUri', () => {
    it('should strip file:/// prefix', () => {
        expect(normalizeUri('file:///home/user/project')).toBe('/home/user/project');
    });

    it('should strip vscode-remote:// scheme+authority (WSL)', () => {
        const result = normalizeUri('vscode-remote://wsl+Ubuntu/home/user/project');
        expect(result).toBe('/home/user/project');
    });

    it('should strip vscode-remote:// scheme+authority (SSH)', () => {
        const result = normalizeUri('vscode-remote://ssh-remote+myhost/home/user/project');
        expect(result).toBe('/home/user/project');
    });

    it('should produce same result for file:// and vscode-remote:// with same path', () => {
        const fileUri = normalizeUri('file:///home/user/project');
        const remoteUri = normalizeUri('vscode-remote://wsl+Ubuntu/home/user/project');
        expect(remoteUri).toBe(fileUri);
    });

    it('should decode URL-encoded characters', () => {
        expect(normalizeUri('file:///home/user/my%20project')).toBe('/home/user/my project');
    });

    it('should remove trailing slash', () => {
        expect(normalizeUri('file:///home/user/project/')).toBe('/home/user/project');
    });
});

// ─── estimateTokensFromText ──────────────────────────────────────────────────

describe('estimateTokensFromText', () => {
    it('should return 0 for empty string', () => {
        expect(estimateTokensFromText('')).toBe(0);
    });

    it('should estimate ASCII text at ~4 chars/token', () => {
        const text = 'Hello World!'; // 12 ASCII chars → ceil(12/4) = 3
        expect(estimateTokensFromText(text)).toBe(3);
    });

    it('should estimate non-ASCII text at ~1.5 chars/token', () => {
        const text = '你好世界'; // 4 non-ASCII chars → ceil(4/1.5) = 3
        expect(estimateTokensFromText(text)).toBe(3);
    });

    it('should handle mixed ASCII and non-ASCII', () => {
        const text = 'Hello 你好'; // 6 ASCII + 2 non-ASCII → ceil(6/4 + 2/1.5) = ceil(1.5 + 1.33) = 3
        expect(estimateTokensFromText(text)).toBe(3);
    });
});

describe('mapCloudTierToDisplayPlan', () => {
    it('should map free-tier to Free display plan', () => {
        expect(mapCloudTierToDisplayPlan('free-tier', 'Gemini Code Assist for individuals')).toEqual({
            displayPlanName: 'Free',
            displayTierKey: 'CLOUD_TIER_FREE',
            planDetailName: 'Gemini Code Assist for individuals',
        });
    });

    it('should map standard-tier to Standard display plan', () => {
        expect(mapCloudTierToDisplayPlan('standard-tier', 'Gemini Code Assist')).toEqual({
            displayPlanName: 'Standard',
            displayTierKey: 'CLOUD_TIER_STANDARD',
            planDetailName: 'Gemini Code Assist',
        });
    });

    it('should preserve unknown cloud tiers as-is', () => {
        expect(mapCloudTierToDisplayPlan('mystery-tier', 'Custom Tier')).toEqual({
            displayPlanName: 'Custom Tier',
            displayTierKey: 'CLOUD_TIER_UNKNOWN',
            planDetailName: '',
        });
    });
});

function makeUserStatus(overrides: Partial<UserStatusInfo>): UserStatusInfo {
    return {
        name: 'Gemini',
        email: 'geminimoon2005@gmail.com',
        planName: 'Pro',
        teamsTier: 'TEAMS_TIER_PRO',
        planDetailName: '',
        planSource: 'ls',
        monthlyPromptCredits: 50_000,
        monthlyFlowCredits: 150_000,
        availablePromptCredits: 500,
        availableFlowCredits: 100,
        userTierName: '',
        userTierId: '',
        lsPlanName: 'Pro',
        lsTeamsTier: 'TEAMS_TIER_PRO',
        cloudTierId: '',
        cloudTierName: '',
        cloudTierDescription: '',
        cloudUpgradeSubscriptionUri: '',
        cloudUpgradeSubscriptionType: '',
        cloudAllowedTiers: [],
        defaultModelLabel: 'Gemini 3.1 Pro (High)',
        planLimits: {
            maxNumChatInputTokens: 16384,
            maxNumPremiumChatMessages: -1,
            maxCustomChatInstructionCharacters: 600,
            maxNumPinnedContextItems: -1,
            maxLocalIndexSize: -1,
            monthlyFlexCreditPurchaseAmount: 25_000,
        },
        teamConfig: {
            allowMcpServers: true,
            allowAutoRunCommands: true,
            allowBrowserExperimentalFeatures: true,
        },
        availableCredits: [],
        canBuyMoreCredits: true,
        browserEnabled: true,
        cascadeWebSearchEnabled: true,
        knowledgeBaseEnabled: true,
        canGenerateCommitMessages: true,
        cascadeCanAutoRunCommands: true,
        canAllowCascadeInBackground: true,
        hasAutocompleteFastMode: true,
        allowStickyPremiumModels: true,
        allowPremiumCommandModels: true,
        hasTabToJump: true,
        canCustomizeAppIcon: true,
        userTierDescription: '',
        planDescription: '',
        upgradeSubscriptionText: '',
        modelSortOrder: [],
        ...overrides,
    };
}

describe('stabilizeUserStatusInfo', () => {
    it('keeps the last cloud-verified plan when a later poll falls back to LS', () => {
        const previous = makeUserStatus({
            planName: 'Free',
            teamsTier: 'CLOUD_TIER_FREE',
            planDetailName: 'Gemini Code Assist for individuals',
            planSource: 'cloud',
            cloudTierId: 'free-tier',
            cloudTierName: 'Gemini Code Assist for individuals',
            cloudTierDescription: 'Gemini-powered code suggestions and chat in multiple IDEs',
            planDescription: 'Gemini-powered code suggestions and chat in multiple IDEs',
        });
        const current = makeUserStatus({
            availablePromptCredits: 420,
            availableFlowCredits: 90,
        });

        const stabilized = stabilizeUserStatusInfo(previous, current);
        expect(stabilized?.planName).toBe('Free');
        expect(stabilized?.planDetailName).toBe('Gemini Code Assist for individuals');
        expect(stabilized?.planSource).toBe('cloud-cache');
        expect(stabilized?.availablePromptCredits).toBe(420);
        expect(stabilized?.cloudTierId).toBe('free-tier');
    });

    it('does not reuse a previous cloud plan for a different account', () => {
        const previous = makeUserStatus({
            planName: 'Free',
            teamsTier: 'CLOUD_TIER_FREE',
            planDetailName: 'Gemini Code Assist for individuals',
            planSource: 'cloud',
            cloudTierId: 'free-tier',
            cloudTierName: 'Gemini Code Assist for individuals',
        });
        const current = makeUserStatus({
            email: 'other@example.com',
        });

        const stabilized = stabilizeUserStatusInfo(previous, current);
        expect(stabilized?.planName).toBe('Pro');
        expect(stabilized?.planSource).toBe('ls');
    });
});

// ─── processSteps ────────────────────────────────────────────────────────────

describe('processSteps', () => {
    it('should return zero values for empty steps', () => {
        const result = processSteps([]);
        expect(result.contextUsed).toBe(0 + 10_000 + 0); // SYSTEM_PROMPT_OVERHEAD fallback only
        expect(result.isEstimated).toBe(true);
        expect(result.model).toBe('');
        expect(result.imageGenStepCount).toBe(0);
    });

    it('should count user input steps via text estimation', () => {
        const steps = [
            {
                type: StepType.USER_INPUT,
                userInput: { userResponse: 'Hello World!' }, // 12 ASCII → 3 tokens
            }
        ];
        const result = processSteps(steps);
        // Fallback path: SYSTEM_PROMPT_OVERHEAD + estimationOverhead
        expect(result.isEstimated).toBe(true);
        expect(result.estimatedDeltaSinceCheckpoint).toBeGreaterThan(0);
    });

    it('should use fixed constant when userInput object is missing', () => {
        const steps = [
            { type: StepType.USER_INPUT }
        ];
        const result = processSteps(steps);
        // Should use USER_INPUT_OVERHEAD = 500 as fallback
        expect(result.isEstimated).toBe(true);
        expect(result.contextUsed).toBe(10_000 + 500); // SYSTEM_PROMPT_OVERHEAD + USER_INPUT_OVERHEAD
    });

    it('should extract model from checkpoint modelUsage', () => {
        const steps = [
            {
                type: StepType.CHECKPOINT,
                metadata: {
                    modelUsage: {
                        model: 'MODEL_PLACEHOLDER_M37',
                        inputTokens: '50000',
                        outputTokens: '5000',
                        responseOutputTokens: '0',
                        cacheReadTokens: '10000',
                    }
                }
            }
        ];
        const result = processSteps(steps);
        expect(result.model).toBe('MODEL_PLACEHOLDER_M37');
        expect(result.isEstimated).toBe(false);
        expect(result.inputTokens).toBe(50000);
        expect(result.totalOutputTokens).toBe(5000);
        expect(result.contextUsed).toBe(55000); // inputTokens + outputTokens
        expect(result.lastModelUsage?.cacheReadTokens).toBe(10000);
    });

    it('should detect compression when checkpoint inputTokens drops', () => {
        const steps = [
            {
                type: StepType.CHECKPOINT,
                metadata: {
                    modelUsage: {
                        inputTokens: '100000',
                        outputTokens: '5000',
                    }
                }
            },
            {
                type: StepType.CHECKPOINT,
                metadata: {
                    modelUsage: {
                        inputTokens: '50000', // dropped 50K — should trigger compression
                        outputTokens: '3000',
                    }
                }
            }
        ];
        const result = processSteps(steps);
        expect(result.checkpointCompressionDetected).toBe(true);
        expect(result.checkpointCompressionDrop).toBe(50000);
    });

    it('should NOT detect compression for small drops', () => {
        const steps = [
            {
                type: StepType.CHECKPOINT,
                metadata: {
                    modelUsage: {
                        inputTokens: '100000',
                        outputTokens: '5000',
                    }
                }
            },
            {
                type: StepType.CHECKPOINT,
                metadata: {
                    modelUsage: {
                        inputTokens: '98000', // dropped only 2K — below COMPRESSION_MIN_DROP
                        outputTokens: '3000',
                    }
                }
            }
        ];
        const result = processSteps(steps);
        expect(result.checkpointCompressionDetected).toBe(false);
    });

    it('should detect image generation by step type', () => {
        const steps = [
            { type: 'CORTEX_STEP_TYPE_IMAGE_GENERATE', metadata: {} },
        ];
        const result = processSteps(steps);
        expect(result.imageGenStepCount).toBe(1);
    });

    it('should detect image generation by model name (nano banana)', () => {
        const steps = [
            {
                type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
                plannerResponse: { response: 'image generated' },
                metadata: { generatorModel: 'nano_banana_pro_v2' }
            },
        ];
        const result = processSteps(steps);
        expect(result.imageGenStepCount).toBe(1);
    });

    it('should not double-count image gen steps', () => {
        const steps = [
            {
                type: 'CORTEX_STEP_TYPE_IMAGE_GENERATE',
                metadata: { generatorModel: 'nano_banana_pro' }
            },
        ];
        const result = processSteps(steps);
        expect(result.imageGenStepCount).toBe(1); // Only counted once
    });

    it('should track toolCallOutputTokens', () => {
        const steps = [
            {
                type: 'CORTEX_STEP_TYPE_TOOL_RESULT',
                metadata: { toolCallOutputTokens: 1500, generatorModel: 'MODEL_PLACEHOLDER_M37' }
            },
            {
                type: 'CORTEX_STEP_TYPE_TOOL_RESULT',
                metadata: { toolCallOutputTokens: 2500, generatorModel: 'MODEL_PLACEHOLDER_M37' }
            }
        ];
        const result = processSteps(steps);
        expect(result.totalToolCallOutputTokens).toBe(4000);
        expect(result.stepDetails).toHaveLength(2);
    });

    it('should prioritize requestedModel over generatorModel', () => {
        const steps = [
            {
                type: StepType.PLANNER_RESPONSE,
                plannerResponse: { response: 'test' },
                metadata: {
                    generatorModel: 'MODEL_A',
                    requestedModel: { model: 'MODEL_B' }
                }
            }
        ];
        const result = processSteps(steps);
        expect(result.model).toBe('MODEL_B');
    });

    it('should reset estimation overhead after checkpoint', () => {
        const steps = [
            {
                type: StepType.USER_INPUT,
                userInput: { userResponse: 'Long question about something' },
            },
            {
                type: StepType.CHECKPOINT,
                metadata: {
                    modelUsage: {
                        inputTokens: '80000',
                        outputTokens: '4000',
                    }
                }
            },
            {
                type: StepType.USER_INPUT,
                userInput: { userResponse: 'Short' },
            }
        ];
        const result = processSteps(steps);
        // After checkpoint, only the last user input contributes to delta
        expect(result.inputTokens).toBe(80000);
        expect(result.isEstimated).toBe(true); // Has estimated delta after checkpoint
        // estimatedDelta should be small (only "Short" ≈ 2 tokens)
        expect(result.estimatedDeltaSinceCheckpoint).toBeLessThan(100);
    });
});

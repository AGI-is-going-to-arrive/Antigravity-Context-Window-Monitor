/**
 * Strict browser/DOM interfaces for the independent CDP Shadow DOM overlay bundle.
 */

export type CdpOverlayFontSizePreset = 'compact' | 'normal' | 'large';

export interface CdpOverlaySwarmMemberItem {
    name: string;
    pct?: number | null;
    phase?: string;
    isInspected?: boolean;
}

export interface CdpOverlaySwarmSummary {
    rootTitle?: string;
    activeCount: number;
    totalCount: number;
    members: CdpOverlaySwarmMemberItem[];
}

export interface CdpOverlayQuotaPoolItem {
    poolKey?: string;
    label?: string;
    remainingPct?: number | null;
    health?: 'good' | 'warn' | 'danger' | 'unknown' | string;
    windowTag?: string;
    resetCountdown?: string;
    weeklyRemainingPct?: number | null;
    weeklyResetCountdown?: string;
    isCurrentSessionModel?: boolean;
    modelChips?: string[];
}

export interface CdpOverlayRuntimePayload {
    language?: 'en' | 'zh' | 'both' | string;
    theme?: 'light' | 'dark' | string;
    overlayFontSize?: CdpOverlayFontSizePreset | string;
    fontSizePreset?: CdpOverlayFontSizePreset | string;
    highContrast?: boolean | 'auto' | 'high' | 'normal' | string;
    overlayHighContrast?: boolean | 'auto' | 'high' | 'normal' | string;
    accountLabel?: string | null;
    modelName?: string;
    contextPct?: number;
    contextUsedTokens?: number;
    contextEffectiveLimit?: number;
    contextNativeLimit?: number;
    compactionThresholdPct?: number | null;
    tier200kMarkerPct?: number | null;
    compactionState?: 'idle' | 'recommended' | 'active' | 'compacted' | string;
    compactionDetected?: boolean;
    checkpointCompressionDrop?: number | null;
    lastCompactionAt?: string | number | null;
    outputSpeedTps?: number | null;
    avgOutputSpeedTps?: number | null;
    peakOutputSpeedTps?: number | null;
    speedMode?: 'decode' | 'e2e' | string;
    speedMetricMode?: 'decode' | 'e2e' | string;
    ttftMs?: number | null;
    isWaitingTtft?: boolean;
    isShortSample?: boolean;
    recentCacheHitPct?: number | null;
    avgCacheHitPct?: number | null;
    turnCacheState?: 'warm' | 'partial' | 'cold' | 'unknown' | string;
    estCostUsd?: number | null;
    estCostFormatted?: string;
    localCostFormatted?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    totalTokens?: number;
    cumulativeRecordedTokens?: number;
    cumulativeCostFormatted?: string;
    todayTokens?: number | null;
    todayCostFormatted?: string;
    recordedDaysCount?: number | null;
    sessionCount?: number | null;
    recentCallCount?: number | null;
    subscriptionRoiSummary?: string;
    tightestQuotaPct?: number | null;
    tightestQuotaWindowTag?: string;
    quotaWindowMode?: 'tightest' | '5h' | '7d' | string;
    quotaDirectionMode?: 'remaining' | 'used' | string;
    sessionQuota5hPct?: number | null;
    sessionQuota5hReset?: string;
    sessionQuotaWeeklyPct?: number | null;
    sessionQuotaWeeklyReset?: string;
    quotaPools?: CdpOverlayQuotaPoolItem[];
    swarmSummary?: CdpOverlaySwarmSummary | null;
    updatedAt?: string | number | null;
    nextRefreshSec?: number | null;
    bridgeUrl?: string;
    bridgeToken?: string;
}

export interface CdpOverlayRuntimeToggles {
    appComposerRingEnabled?: boolean;
    appTopBarEnabled?: boolean;
}

export interface CdpOverlayMountConfig {
    globalKey: string;
    scriptVersion: string;
    buildId: string;
    composerHostId: string;
    topBarHostId: string;
    composerCss: string;
    topBarCss: string;
}

export type CdpTopBarViewKey = 'quota' | 'context' | 'speed' | 'total';
export type CdpOverlaySlot = 'composer' | 'topbar' | 'all';

export interface CdpOverlayMountResult {
    installed: boolean;
    reused: boolean;
    version: string;
    buildId: string;
}

export interface CdpOverlayApplyResult {
    ok: boolean;
    version: string;
    buildId: string;
    origin: string;
    href: string;
    composerMounted: boolean;
    topBarMounted: boolean;
}

export interface CdpOverlayStatus {
    version: string;
    buildId: string;
    composerEnabled: boolean;
    topBarEnabled: boolean;
    composerMounted: boolean;
    topBarMounted: boolean;
    topBarAnchorMode: string;
    topBarAnchorTier: string;
    topBarActiveView: CdpTopBarViewKey | null;
    topBarPinned?: boolean;
    fontSizePreset?: CdpOverlayFontSizePreset;
    highContrast?: boolean;
}

export interface CdpOverlayGlobalHandle {
    version: string;
    buildId: string;
    applyState(payload: CdpOverlayRuntimePayload | null | undefined, toggles: CdpOverlayRuntimeToggles | null | undefined): CdpOverlayApplyResult;
    unmount(slot?: CdpOverlaySlot): { unmounted: CdpOverlaySlot };
    getStatus(): CdpOverlayStatus;
}

export interface WindowControlsOverlayLike {
    visible?: boolean;
    getTitlebarAreaRect(): DOMRectReadOnly;
    addEventListener?(type: string, listener: EventListener): void;
    removeEventListener?(type: string, listener: EventListener): void;
}

export interface NavigatorWithWco extends Navigator {
    windowControlsOverlay?: WindowControlsOverlayLike;
}

export type PopoverCapableElement = HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
};

/**
 * Strict browser/DOM interfaces for the independent WebView client bundle.
 */

import type { WebviewClientBootstrapConfig, WebviewClientStrings } from '../webview-config-types';
export type { WebviewClientBootstrapConfig, WebviewClientStrings };

export interface WebviewClientA11yStrings {
    tabChanged: string;
    panelFrozen: string;
    panelResumed: string;
    lockAnchored: string;
    lockReleased: string;
    workerInspected: string;
    memberOpening?: string;
    memberStillOpening?: string;
    memberOpenFailed?: string;
    returnedToMain: string;
    settingsSaved: string;
    settingsSaveFailed: string;
    privacyMasked: string;
    privacyRevealed: string;
    backupImported: string;
    backupImportFailed: string;
    handoffLoading: string;
    handoffFailed: string;
}

export interface WebviewClientBootstrapConfigV118 extends WebviewClientBootstrapConfig {
    a11y?: WebviewClientA11yStrings;
}

export interface WebviewSavedState {
    activeTab?: string;
    activeAnchor?: string;
    tabScrolls?: Record<string, number>;
    detailsOpen?: Record<string, boolean>;
    historySearch?: string;
    historyFilter?: string;
    modelStatsShowErrors?: boolean;
    gmAnomalyFilter?: string;
    zoomLevel?: number;
    privacyMasked?: boolean;
    ctxVizMode?: 'bar' | 'dots';
    nativeHudExpanded?: boolean;
    lockedCtxCat?: string;
    calendarSelectedDate?: string;
    lastHandledOverlayTabSeq?: number;
    initialTabConsumed?: string;
    [key: string]: unknown;
}

export interface VsCodeApiLike {
    getState(): WebviewSavedState | undefined;
    setState(state: WebviewSavedState): void;
    postMessage(message: Record<string, unknown>): void;
}

export interface AcmHostBridgeLike {
    surface?: string;
    asVsCodeApi?(): VsCodeApiLike;
    isTrustedHostEvent?(event: Event): boolean;
    clearClientCaches?(): void;
    copyText?(text: string): Promise<boolean> | boolean;
    sendAction?(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface CdpLauncherStatusLike {
    installed?: boolean;
    platform?: string;
    launcherPath?: string;
    noteEn?: string;
    noteZh?: string;
}

export interface CdpStatusLike {
    state?: string;
    diagnosticCode?: string;
    targetTitle?: string;
    errorMessage?: string;
    discoveredPort?: number;
    launcherStatus?: CdpLauncherStatusLike;
    platformGuide?: { platform?: string };
}

export interface UpdateStatusLike {
    status?: string;
    latestVersion?: string;
    currentVersion?: string;
    updateAvailable?: boolean;
    hasUpdate?: boolean;
    checkedAt?: string | number;
    error?: string;
}

export interface WebviewClientRuntimeHandle {
    installed: boolean;
    reused: boolean;
    buildId: string;
    unmount(): void;
    getStatus(): {
        buildId: string;
        activeTab: string;
        activeAnchor?: string;
        viewLang?: string;
        privacyMasked: boolean;
        mounted: boolean;
    };
}

export interface AcmWindowGlobal extends Window {
    __ACM_BRIDGE__?: AcmHostBridgeLike | null;
    __ACM_WEBVIEW_CLIENT__?: WebviewClientRuntimeHandle;
    __ACM_CONSUME_HOST_NONCE__?: () => string;
    acquireVsCodeApi?: () => VsCodeApiLike;
}

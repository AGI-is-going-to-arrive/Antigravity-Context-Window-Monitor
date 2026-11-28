/**
 * Shared Node + Browser configuration interfaces for the WebView client bundle.
 * Strictly pure ES2022 (ZERO DOM globals) so Node-side `src/webview-script.ts`
 * can import these types under `tsconfig.json` without pulling in `lib.dom.d.ts`.
 */

export interface WebviewClientStrings {
    copiedText: string;
    savedText: string;
    resetText: string;
    openingText: string;
    revealingText: string;
    openedText: string;
    revealedText: string;
    openFailedText: string;
    revealFailedText: string;
    invalidBillingDayText: string;
    invalidPricingText: string;
    checkingUpdatesText: string;
    upgradingText: string;
    upToDateText: string;
    updateAvailableText: string;
    upgradeDoneText: string;
    checkFailedText: string;
    exportedText: string;
    cdpCheckingText: string;
    cdpProbingText: string;
    cdpConnectedText: string;
    cdpErrorText: string;
    cdpInactiveText: string;
    cdpDisabledText: string;
    cdpDiagProbingText: string;
    cdpDiagHostMissingText: string;
    cdpDiagMissingText: string;
    cdpDiagInstalledDarwinText: string;
    cdpDiagInstalledWinText: string;
    cdpDiagInstalledLinuxText: string;
    cdpDiagMissingPortPrefixText: string;
    cdpLauncherCreatingText: string;
    cdpLauncherRemovingText: string;
    cdpLauncherInstalledText: string;
    cdpLauncherNotInstalledText: string;
    cdpLauncherCreateBtnText: string;
    cdpLauncherRecreateBtnText: string;
    cdpLauncherRevealDarwinText: string;
    cdpLauncherRevealWinText: string;
    cdpLauncherRevealLinuxText: string;
    cdpLauncherActionFailedText: string;
    cdpDiagUnreachableTpl: string;
    cdpDiagNoHubTpl: string;
    cdpDiagWsErrorTpl: string;
    cdpDiagEvalErrorTpl: string;
    cdpDiagConnectedTpl: string;
    updateAvailablePillTpl: string;
    upToDatePillTpl: string;
    currentVerPillTpl: string;
    aboutReadyText: string;
    aboutUpToDatePlainText: string;
    closeTipAriaText: string;
    updateTipTitleAvailable: string;
    updateTipTitleError: string;
    updateTipTitleOk: string;
    updateTipTitleIdle: string;
    updateTipBodyAvailableTpl: string;
    updateTipMetaAvailable: string;
    updateTipBodyErrorFallback: string;
    updateTipMetaError: string;
    updateTipBodyOk: string;
    updateTipBodyIdle: string;
    cdpPillTipTitle: string;
    cdpPillTipConnectedFallback: string;
    cdpPillTipProbingBody: string;
    cdpPillTipInactiveBody: string;
    cdpPillTipDisabledBody: string;
    cdpPillTipErrorFallback: string;
    cdpPillTipMeta: string;
    tabHintEnabledText: string;
    tabHintDisabledText: string;
    emptyAccountPopoverHtml: string;
    grLoadEditBtnText: string;
    grReloadBtnText: string;
    grLoadedText: string;
    grFailedText: string;
    grTooLargeText: string;
    grStandaloneBlockedText: string;
    grMissingText: string;
    grUnloadedPlaceholderText: string;
    grEditablePlaceholderText: string;
    privacyRemaskingText: string;
    privacyRemaskFailedText: string;
    privacyRetryBtnText: string;
    handoffStaleRevisionText: string;
}

export interface WebviewClientBootstrapConfig {
    buildId: string;
    strings: WebviewClientStrings;
    subscriptionPlanPlaceholders: Readonly<Record<string, string>>;
    defaultSubscriptionFeePlaceholder: string;
}

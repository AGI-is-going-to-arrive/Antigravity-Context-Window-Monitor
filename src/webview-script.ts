import { t, tBi } from './i18n';
import { CDP_DIAG_SHARED, STG_SHARED_PAIRS } from './webview-settings-tab';
import {
    SUBSCRIPTION_PLAN_PRESET_ORDER,
    SUBSCRIPTION_PLAN_PRESETS,
} from './cli-usage-scanner';
import { collectPricingInputOverrides } from './client/pricing-overrides';
import {
    WEBVIEW_CLIENT_BUILD_ID,
    WEBVIEW_CLIENT_BUNDLE,
} from './client/generated/client-bundles.generated';
import type { WebviewClientBootstrapConfig } from './client/webview-config-types';

interface WebviewClientA11yConfig {
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

type WebviewClientConfigPayload = WebviewClientBootstrapConfig & { a11y: WebviewClientA11yConfig };

export { collectPricingInputOverrides, WEBVIEW_CLIENT_BUILD_ID };

const SUBSCRIPTION_PLAN_PLACEHOLDERS: Readonly<Record<string, string>> = Object.fromEntries(
    SUBSCRIPTION_PLAN_PRESET_ORDER
        .filter((planId) => SUBSCRIPTION_PLAN_PRESETS[planId].monthlyUsd > 0)
        .map((planId) => [planId, String(SUBSCRIPTION_PLAN_PRESETS[planId].monthlyUsd)]),
);
const DEFAULT_SUBSCRIPTION_FEE_PLACEHOLDER = String(SUBSCRIPTION_PLAN_PRESETS['google-ai-pro'].monthlyUsd);

/**
 * Serialize a JS value safely for embedding inside an inline `<script>` tag.
 * Escapes `<`, `>`, `&`, U+2028, and U+2029 so no string can break script boundaries.
 */
function safeJsonForInlineScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

const WEBVIEW_STRINGS_CATALOG = `copiedText\t✓\tCopied\t已复制
savedText\t✓\tSaved\t已保存
resetText\t✓\tReset\t已重置
openingText\t\tOpening...\t正在打开...
revealingText\t\tRevealing...\t正在定位...
openedText\t✓\tOpened\t已打开
revealedText\t✓\tRevealed\t已定位
openFailedText\t\tOpen failed\t打开失败
revealFailedText\t\tReveal failed\t定位失败
invalidBillingDayText\t\tInvalid\t无效
invalidPricingText\t\tEnter a non-negative price in every field of each row, or clear the entire row.\t请为每行的所有字段填写非负价格，或清空整行。
checkingUpdatesText\t\tChecking...\t正在检查...
upgradingText\t\tUpgrading...\t正在升级...
upToDateText\t✓\tUp to date\t已是最新
updateAvailableText\t\tUpdate available\t有可用更新
upgradeDoneText\t✓\tUpgraded — reload to apply\t升级完成，重启后生效
exportedText\t✓\tExported\t已导出
cdpCheckingText\t\tChecking CDP...\t正在检测 CDP...
cdpLauncherCreatingText\t\tCreating launcher...\t正在生成启动器...
cdpLauncherRemovingText\t\tRemoving launcher...\t正在移除启动器...
cdpLauncherActionFailedText\t\tLauncher action failed\t启动器操作失败
closeTipAriaText\t\tClose tip\t关闭说明
grLoadedText\t✓\tLoaded\t已加载
grFailedText\t\tAction failed\t操作失败
grStandaloneBlockedText\t\tRequires App sidecar or IDE window (blocked in standalone browser).\t仅限 App 侧栏或 IDE 窗口内操作（独立预览已禁用）。
privacyRemaskingText\t\tRefreshing masked view…\t正在刷新隐私遮罩视图…
privacyRemaskFailedText\t\tRe-mask refresh failed — sensitive data stays hidden.\t隐私遮罩刷新失败，敏感数据已保持隐藏。
privacyRetryBtnText\t\tRetry\t重试
handoffStaleRevisionText\t\tContext updated — click Handoff v2 Preview again to refresh.\t上下文已更新，请重新点击「交接提示词 v2 预览」刷新。`;

function buildWebviewClientConfig(buildIdOverride?: string): WebviewClientConfigPayload {
    const d = CDP_DIAG_SHARED;
    const stringsMap: Record<string, string> = {};
    for (const [k, [en, zh]] of Object.entries(STG_SHARED_PAIRS)) {
        stringsMap[k] = tBi(en, zh);
    }
    for (const line of WEBVIEW_STRINGS_CATALOG.split('\n')) {
        if (!line) { continue; }
        const [k, pfx, en, zh] = line.split('\t');
        if (k) { stringsMap[k] = pfx ? `${pfx} ${tBi(en, zh)}` : tBi(en, zh); }
    }
    stringsMap.cdpDiagHostMissingText = tBi(`${d.hostMissingPrefixEn}${d.stepsEn}`, `${d.hostMissingPrefixZh}${d.stepsZh}`);
    stringsMap.cdpDiagMissingText = tBi(`${d.missingPrefixEn}${d.hostMissingPrefixEn}${d.stepsEn}`, `${d.missingPrefixZh}${d.hostMissingPrefixZh}${d.stepsZh}`);
    stringsMap.cdpDiagInstalledDarwinText = tBi(`${d.instPrefixEn}${d.darwinTailEn}, then click Recheck CDP.`, `${d.instPrefixZh}${d.darwinTailZh}启动，再点「重新检测」。`);
    stringsMap.cdpDiagInstalledWinText = tBi(`${d.instPrefixEn}${d.winTailEn}, then click Recheck CDP.`, `${d.instPrefixZh}${d.winTailZh}启动，再点「重新检测」。`);
    stringsMap.cdpDiagInstalledLinuxText = tBi(`${d.instPrefixEn}${d.linuxTailEn}, then click Recheck CDP.`, `${d.instPrefixZh}${d.linuxTailZh}启动，再点「重新检测」。`);
    stringsMap.cdpDiagMissingPortPrefixText = tBi(d.missingPrefixEn, d.missingPrefixZh);
    stringsMap.cdpDiagUnreachableTpl = tBi(d.unreachableEn, d.unreachableZh);
    stringsMap.cdpDiagNoHubTpl = tBi(d.noHubEn, d.noHubZh);
    stringsMap.cdpDiagWsErrorTpl = tBi(d.wsErrorEn, d.wsErrorZh);
    stringsMap.cdpDiagEvalErrorTpl = tBi(d.evalErrorEn, d.evalErrorZh);
    stringsMap.cdpDiagConnectedTpl = tBi(d.connectedEn, d.connectedZh);
    stringsMap.emptyAccountPopoverHtml = `<p class="empty-msg">${tBi('No account data yet.', '暂无账号数据。')}</p>`;
    return {
        buildId: buildIdOverride || WEBVIEW_CLIENT_BUILD_ID,
        subscriptionPlanPlaceholders: SUBSCRIPTION_PLAN_PLACEHOLDERS,
        defaultSubscriptionFeePlaceholder: DEFAULT_SUBSCRIPTION_FEE_PLACEHOLDER,
        a11y: {
            tabChanged: t('a11y.tabChanged'),
            panelFrozen: t('a11y.panelFrozen'),
            panelResumed: t('a11y.panelResumed'),
            lockAnchored: t('a11y.lockAnchored'),
            lockReleased: t('a11y.lockReleased'),
            workerInspected: t('a11y.workerInspected'),
            memberOpening: t('swarm.opening'),
            memberStillOpening: t('swarm.stillOpening'),
            memberOpenFailed: t('swarm.openFailed'),
            returnedToMain: t('a11y.returnedToMain'),
            settingsSaved: t('a11y.settingsSaved'),
            settingsSaveFailed: t('a11y.settingsSaveFailed'),
            privacyMasked: t('a11y.privacyMasked'),
            privacyRevealed: t('a11y.privacyRevealed'),
            backupImported: tBi('Settings backup imported', '设置备份已导入'),
            backupImportFailed: tBi('Settings backup import failed', '设置备份导入失败'),
            handoffLoading: tBi('Generating Handoff v2 preview...', '正在生成交接提示词 v2 预览...'),
            handoffFailed: tBi('Unable to generate Handoff v2 preview', '无法生成交接提示词 v2 预览'),
        },
        strings: stringsMap as unknown as WebviewClientBootstrapConfig['strings'],
    };
}

export interface WebviewScriptOptions {
    buildId?: string;
}

/**
 * Returns the complete `<script>` block content (without `<script>` tags).
 * Consumes the independently typechecked & esbuild-bundled browser client
 * (`src/client/browser/webview-main.ts`) with safe inline JSON serialization.
 */
export function getScript(options: WebviewScriptOptions = {}): string {
    const config = buildWebviewClientConfig(options.buildId);
    return `(function(){${WEBVIEW_CLIENT_BUNDLE};return __ACM_WEBVIEW_FACTORY__.mountWebviewClient(${safeJsonForInlineScript(config)});})();`;
}

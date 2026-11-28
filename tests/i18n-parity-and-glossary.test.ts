// Consolidated Gate Suite #7: i18n Parity, Glossary, Core, Persistence & Backend Status Localization
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as vscode from 'vscode';
import { DurableState, type StateBucket } from '../src/durable-state';
import {
    CORE_TRANSLATIONS,
    DEFAULT_COMPACT_BREAKPOINT_PX,
    detectHostLocaleLanguage,
    type EffectiveDisplayLanguage,
    formatClockTime,
    formatNumber,
    getLanguage,
    getLanguagePreference,
    initI18nFromState,
    isEffectiveDisplayLanguage,
    isLanguage,
    isLanguagePreference,
    type Language,
    type LanguagePreference,
    normalizeLocaleTag,
    PHASE3_TRANSLATIONS,
    PHASE3_WAVE3B_KEYS,
    resolvePerViewEffectiveLanguage,
    resolveStoredLanguagePreference,
    setDefaultHostLocaleHints,
    setLanguageInMemory,
    setLanguagePreferenceInMemory,
    setLanguagePreferenceToState,
    setLanguageToState,
    t,
    tBi,
    tBiHtml,
    tHtml,
    translations,
} from '../src/i18n-core';
import * as i18nWrapper from '../src/i18n';
import {
    getIdeLocaleSources,
    getVscodeLanguage,
    initI18n,
    initI18nForIde,
    setLanguage,
    setLanguagePreference,
} from '../src/i18n';
import * as os from 'os';
import { StatusBarManager } from '../src/statusbar';
import { createFastDurableState } from './helpers/factories';

describe('[i18n-parity-and-glossary]', () => {
    const REPO_ROOT = path.resolve(__dirname, '..');


    class MemoryBucket implements StateBucket {
        readonly store = new Map<string, unknown>();

        constructor(initial?: Record<string, unknown>) {
            if (initial) {
                for (const [k, v] of Object.entries(initial)) {
                    this.store.set(k, v);
                }
            }
        }

        get<T>(key: string, defaultValue: T): T {
            return this.store.has(key) ? this.store.get(key) as T : defaultValue;
        }

        async update(key: string, value: unknown): Promise<void> {
            if (value === undefined) {
                this.store.delete(key);
                return;
            }
            this.store.set(key, value);
        }
    }


    function makeExtensionContext(bucket: StateBucket = new MemoryBucket()): vscode.ExtensionContext {
        return { globalState: bucket } as unknown as vscode.ExtensionContext;
    }


    function walkSourceFiles(dir: string, acc: string[] = []): string[] {
        if (!fs.existsSync(dir)) { return acc; }
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'dist' || entry.name === '.git') {
                continue;
            }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walkSourceFiles(full, acc);
            } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
                acc.push(full);
            }
        }
        return acc;
    }


    /** Sample of verified dead keys pruned from v1.17.x src/i18n-core.ts (119 total pruned). */
    const PRUNED_DEAD_KEY_SAMPLES = [
        'statusBar.initializingTooltip',
        'statusBar.clickToView',
        'statusBar.idleDescription',
        'tooltip.title',
        'tooltip.session',
        'tooltip.totalContextUsed',
        'tooltip.checkpointDrop',
        'telemetry.speed',
        'telemetry.genSpeed',
        'telemetry.visibleSpeed',
        'telemetry.endToEndSpeed',
        'telemetry.ttft',
        'telemetry.avgTtft',
        'telemetry.cacheState.unknown',
        'telemetry.sectionTitle',
        'orchestrator.default',
        'orchestrator.custom',
        'context.checkpointThreshold',
        'hud.title',
        'hud.tightestQuota',
        'overview.lowQuotaTitle',
        'overview.physicalWindow',
        'settings.appOverlays',
        'settings.topBarOverlay',
        'settings.cdpDisabled',
        'settings.updates',
        'settings.costCurrencyHistory',
        'about.versionUpdates',
        'about.aiAgentInstallTip',
        'panel.title',
        'panel.placeholder',
        'panel.otherSessions',
        'panel.noData',
        'command.showDetails',
        'command.refresh',
        'command.switchLanguage',
        'lang.zh',
        'lang.en',
        'lang.both',
        'lang.pickerTitle',
    ];


    describe('i18n parity, dead-key pruning, forced Chinese glossary & per-view locale engine', () => {
        const initialLang = getLanguage();
        const initialPref = getLanguagePreference();

        afterEach(() => {
            setDefaultHostLocaleHints(undefined);
            setLanguageInMemory(initialLang);
            if (initialPref === 'auto') {
                setLanguagePreferenceInMemory('auto', { hostLocale: initialLang === 'zh' ? 'zh-CN' : 'en-US' });
            }
            setLanguageInMemory(initialLang);
        });

        describe('1. 100% EN/ZH key parity & catalog structure', () => {
            it('has 100% non-empty EN and ZH translations for every key with zero raw fallbacks', () => {
                const entries = Object.entries(translations);
                expect(entries.length).toBeGreaterThan(100);

                for (const [key, entry] of entries) {
                    expect(typeof entry.en, `EN type for ${key}`).toBe('string');
                    expect(typeof entry.zh, `ZH type for ${key}`).toBe('string');
                    expect(entry.en.trim().length, `empty EN for ${key}`).toBeGreaterThan(0);
                    expect(entry.zh.trim().length, `empty ZH for ${key}`).toBeGreaterThan(0);
                    expect(entry.en, `leading/trailing whitespace in EN for ${key}`).toBe(entry.en.trim());
                    expect(entry.zh, `leading/trailing whitespace in ZH for ${key}`).toBe(entry.zh.trim());

                    expect(t(key, 'en'), `t(${key}, en)`).toBe(entry.en);
                    expect(t(key, 'zh'), `t(${key}, zh)`).toBe(entry.zh);
                    const bothVal = t(key, 'both');
                    if (entry.en === entry.zh) {
                        expect(bothVal, `identical EN/ZH deduplication for ${key}`).toBe(entry.en);
                    } else {
                        expect(bothVal, `bilingual join for ${key}`).toBe(`${entry.en} / ${entry.zh}`);
                    }
                    expect(tHtml(key, 'en').length).toBeGreaterThan(0);
                    expect(tHtml(key, 'zh').length).toBeGreaterThan(0);
                    expect(tHtml(key, 'both').length).toBeGreaterThan(0);
                }
            });

            it('keeps CORE_TRANSLATIONS and PHASE3_TRANSLATIONS strictly disjoint and equal to translations', () => {
                const coreKeys = Object.keys(CORE_TRANSLATIONS);
                const phase3Keys = Object.keys(PHASE3_TRANSLATIONS);
                const coreSet = new Set(coreKeys);

                expect(coreKeys.length).toBe(74);
                expect(PHASE3_WAVE3B_KEYS.size).toBe(phase3Keys.length);

                for (const key of phase3Keys) {
                    expect(coreSet.has(key), `duplicate key between CORE and PHASE3: ${key}`).toBe(false);
                    expect(PHASE3_WAVE3B_KEYS.has(key)).toBe(true);
                }

                expect(Object.keys(translations).length).toBe(coreKeys.length + phase3Keys.length);
            });
        });

        describe('2. Zero dead / unused keys programmatic audit', () => {
            it('removes all verified dead keys and guarantees zero uncategorized dead keys across the repository', () => {
                // Confirm pruned dead keys are gone
                for (const deadKey of PRUNED_DEAD_KEY_SAMPLES) {
                    expect(Object.prototype.hasOwnProperty.call(translations, deadKey), `pruned dead key still present: ${deadKey}`).toBe(false);
                }

                const selfPath = path.resolve(__filename);
                const i18nCorePath = path.resolve(REPO_ROOT, 'src', 'i18n-core.ts');
                const files = [
                    ...walkSourceFiles(path.join(REPO_ROOT, 'src')),
                    ...walkSourceFiles(path.join(REPO_ROOT, 'tests')),
                    ...walkSourceFiles(path.join(REPO_ROOT, 'scripts')),
                    ...walkSourceFiles(path.join(REPO_ROOT, 'app-plugin')),
                ].filter(f => path.resolve(f) !== i18nCorePath && path.resolve(f) !== selfPath);

                const contents = files.map(f => fs.readFileSync(f, 'utf8'));
                // Include sibling consolidated test sections ([i18n-core], [backend-status-i18n],
                // [cross-platform-i18n-helpers]) while still excluding this [i18n-parity-and-glossary]
                // audit section so PRUNED_DEAD_KEY_SAMPLES / requiredWave3BKeys never self-satisfy.
                const selfSource = fs.readFileSync(selfPath, 'utf8');
                const siblingMarker = selfSource.indexOf("describe('[i18n-core]'");
                if (siblingMarker >= 0) {
                    contents.push(selfSource.slice(siblingMarker));
                }
                const isReferencedAsQuotedLiteral = (key: string): boolean => {
                    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const re = new RegExp(`['"\`]${escaped}['"\`]`);
                    return contents.some(c => re.test(c));
                };

                const deadCoreKeys: string[] = [];
                for (const key of Object.keys(CORE_TRANSLATIONS)) {
                    if (!isReferencedAsQuotedLiteral(key)) {
                        deadCoreKeys.push(key);
                    }
                }
                expect(deadCoreKeys, `dead keys remaining in CORE_TRANSLATIONS: ${deadCoreKeys.join(', ')}`).toEqual([]);

                // Every key in translations must either be actively referenced OR explicitly registered in PHASE3_WAVE3B_KEYS
                const uncategorizedDead: string[] = [];
                for (const key of Object.keys(translations)) {
                    if (!PHASE3_WAVE3B_KEYS.has(key) && !isReferencedAsQuotedLiteral(key)) {
                        uncategorizedDead.push(key);
                    }
                }
                expect(uncategorizedDead).toEqual([]);
            });

            it('provides the complete Phase 3 Wave 3B key catalog for all D2/D3/D5/D9 & Plan C surfaces', () => {
                const requiredWave3BKeys = [
                    // 5 main tabs + topbar Settings / About
                    'nav.overview', 'nav.modelCalls', 'nav.sessions', 'nav.usageCost', 'nav.modelsQuotas',
                    'nav.settings', 'nav.about',
                    // Cache 5m TTL & possible miss causes
                    'cache.ttl5mHeuristic', 'cache.ttlWarm', 'cache.ttlExpiring', 'cache.ttlColdPredicted',
                    'cache.measuredMiss', 'cache.measuredReuse', 'cache.possibleMissCause',
                    'cache.cause.idleTtl', 'cache.cause.modelSwitch', 'cache.cause.branchChange',
                    'cache.cause.compaction', 'cache.cause.promptEdit', 'cache.cause.clockJump', 'cache.unreported',
                    // Decode vs E2E model-call speed & anomaly filters
                    'speed.decode', 'speed.e2eModelCall', 'speed.e2eScopeHint', 'speed.ttft',
                    'speed.sampleCoverage', 'speed.waiting', 'speed.shortSample', 'speed.missing', 'speed.phaseBar',
                    'modelCalls.filterAnomaly', 'modelCalls.filterAll',
                    // 5h/7d/tightest & Remaining/Used quotas + Weekly Active-Hours Forecast
                    'quota.window5h', 'quota.window7d', 'quota.windowTightest',
                    'quota.directionRemaining', 'quota.directionUsed',
                    'quota.weeklyActiveForecast', 'quota.insufficientHistory',
                    // Context native limit & panel freeze
                    'context.basisCompaction', 'context.basisNative', 'context.compactionWarning',
                    'panel.freeze', 'panel.unfreeze', 'panel.frozenHint',
                    // Workspace Project Leaderboard, Unattributed, Plan ROI disclaimer, exports, CAD
                    'usage.workspaceLeaderboard', 'usage.unattributed', 'usage.planRoiTitle',
                    'usage.planRoiDisclaimer', 'usage.exportMarkdown', 'usage.exportCsv', 'usage.exportJson',
                    'usage.emptyDateRange', 'usage.currencyCad',
                    // Swarm / Subagent tracking, Inspect, Back to Main, Retarget, Pending-Unavailable, Direct vs Group cost
                    'swarm.liveTracking', 'swarm.rootLabel', 'swarm.inspectedWorker', 'swarm.inspect',
                    'swarm.backToMain', 'swarm.retarget', 'swarm.retargetPrompt', 'swarm.pendingUnavailable',
                    'swarm.directCost', 'swarm.groupCost', 'swarm.unpricedCalls',
                    'swarm.assignedModel', 'swarm.measuredModel', 'swarm.partialCoverage', 'swarm.lastObserved',
                    // Handoff v2 & Compaction Recovery Brief
                    'handoff.previewTitle', 'handoff.readOnlyNotice',
                    'compaction.recoveryTitle', 'compaction.recoverySubtitle', 'compaction.dismissBrief',
                    // Settings 5 groups, JSON backup/import, redacted diagnostics, HUD, privacy
                    'settings.group.general', 'settings.group.telemetry', 'settings.group.overlays',
                    'settings.group.costHistory', 'settings.group.backupDiag',
                    'settings.languagePreference', 'settings.languageAuto', 'settings.languageEn',
                    'settings.languageZh', 'settings.languageBoth', 'settings.narrowCompactNote',
                    'settings.exportJsonBackup', 'settings.importJsonBackup', 'settings.exportRedactedDiag',
                    'settings.backupExclusions', 'settings.hudApp', 'settings.hudIde',
                    'settings.hudAutoHideOverview', 'settings.privacyMask',
                    // A11y polite live-region announcements
                    'a11y.statusRegionLabel', 'a11y.tabChanged', 'a11y.panelFrozen', 'a11y.panelResumed',
                    'a11y.lockAnchored', 'a11y.lockReleased', 'a11y.workerInspected', 'a11y.returnedToMain',
                    'a11y.settingsSaved', 'a11y.settingsSaveFailed', 'a11y.popoverDismissHint',
                    'a11y.privacyMasked', 'a11y.privacyRevealed',
                ];

                for (const key of requiredWave3BKeys) {
                    expect(PHASE3_WAVE3B_KEYS.has(key), `missing Phase 3 key ${key}`).toBe(true);
                    expect(translations[key], `missing translation entry ${key}`).toBeDefined();
                }
            });
        });

        describe('3. Mandatory Chinese terminology glossary & proper-noun integrity', () => {
            it('forbids deprecated/mistranslated Chinese terms across EVERY key in src/i18n-core.ts', () => {
                const forbiddenTerms = [
                    { term: '账户', reason: 'must use 账号' },
                    { term: '额度', reason: 'must use 配额' },
                    { term: '令牌', reason: 'must keep Token / tokens' },
                    { term: '锁定主智能体', reason: 'must use 锁定主会话' },
                    { term: '编排器模型', reason: 'must use 编排模型' },
                    { term: '执行器模型', reason: 'must use 执行模型' },
                    { term: '反重力', reason: 'must keep Antigravity verbatim' },
                ];

                for (const [key, entry] of Object.entries(translations)) {
                    for (const { term, reason } of forbiddenTerms) {
                        expect(entry.zh, `key "${key}" contains forbidden "${term}" (${reason}): ${entry.zh}`).not.toContain(term);
                    }
                }
            });

            it('enforces all 8 forced glossary terms, Plan ROI disclaimer, and measured miss vs cold start distinction', () => {
                // 1. 账号 (never 账户)
                expect(t('nav.profile', 'zh')).toBe('账号');
                expect(t('profile.accountInfo', 'zh')).toBe('账号信息');
                expect(t('settings.privacyMask', 'zh')).toContain('账号');
                expect(t('a11y.privacyMasked', 'zh')).toContain('账号');

                // 2. 配额 (never 额度)
                expect(t('quota.weekly', 'zh')).toBe('周配额');
                expect(t('nav.modelsQuotas', 'zh')).toBe('模型与配额');
                expect(t('quota.window5h', 'zh')).toBe('5 小时窗口');
                expect(t('quota.window7d', 'zh')).toBe('每周窗口');
                expect(t('quota.windowTightest', 'zh')).toBe('按剩余较少的窗口');
                expect(t('quota.directionRemaining', 'zh')).toContain('配额');
                expect(t('quota.directionUsed', 'zh')).toContain('配额');

                // 3. 费用 (consistent cost term)
                expect(t('telemetry.cost', 'zh')).toBe('费用');
                expect(t('nav.usageCost', 'zh')).toBe('用量与费用');
                expect(t('swarm.directCost', 'zh')).toContain('费用');
                expect(t('swarm.groupCost', 'zh')).toContain('费用');
                expect(t('settings.group.costHistory', 'zh')).toContain('费用');

                // 4. 冷启动 strictly distinguished from measured 缓存未命中
                expect(t('turn.coldStart', 'zh')).toBe('冷启动');
                expect(t('cache.ttlColdPredicted', 'zh')).toContain('冷启动');
                expect(t('cache.ttlColdPredicted', 'zh')).not.toContain('实测缓存未命中');
                expect(t('cache.measuredMiss', 'zh')).toBe('实测缓存未命中');
                expect(t('cache.measuredMiss', 'zh')).not.toContain('冷启动');
                expect(t('telemetry.cacheState.cold', 'zh')).toBe('缓存未命中');
                expect(t('telemetry.cacheState.cold', 'zh')).not.toContain('冷启动');

                // 5. 首字延迟 (TTFT)
                expect(t('speed.ttft', 'en')).toBe('TTFT');
                expect(t('speed.ttft', 'zh')).toBe('首字延迟');
                expect(t('speed.e2eScopeHint', 'zh')).toContain('首字延迟');

                // 6. 模型调用 (Model Calls)
                expect(t('nav.modelCalls', 'en')).toBe('Model Calls');
                expect(t('nav.modelCalls', 'zh')).toBe('模型调用');
                expect(t('speed.e2eModelCall', 'zh')).toContain('模型调用');
                expect(t('modelCalls.filterAll', 'zh')).toContain('模型调用');

                // 7. 原生窗口上限 (Native window limit)
                expect(t('context.nativeCeiling', 'zh')).toBe('原生窗口上限');
                expect(t('context.basisNative', 'zh')).toBe('原生窗口上限');

                // 8. 冻结面板 (Pause/freeze panel)
                expect(t('panel.freeze', 'zh')).toBe('冻结面板');
                expect(t('panel.unfreeze', 'zh')).toContain('冻结面板');
                expect(t('a11y.panelFrozen', 'zh')).toContain('冻结面板');

                // Required exact Phase 3 copy
                expect(t('nav.overview', 'zh')).toBe('概览');
                expect(t('nav.sessions', 'zh')).toBe('会话');
                expect(t('nav.settings', 'zh')).toBe('设置');
                expect(t('nav.about', 'zh')).toBe('关于');
                expect(t('quota.insufficientHistory', 'en')).toBe('Insufficient history');
                expect(t('quota.insufficientHistory', 'zh')).toBe('历史不足');
                expect(t('usage.unattributed', 'en')).toBe('Unattributed');
                expect(t('usage.unattributed', 'zh')).toBe('未归属');
                expect(t('usage.planRoiDisclaimer', 'zh')).toBe('API 等效参考比，非实际账单');

                // Proper nouns kept verbatim
                expect(t('surface.antigravityApp', 'zh')).toBe('Antigravity App');
                expect(t('surface.antigravityIde', 'zh')).toBe('Antigravity IDE');
                expect(t('settings.group.overlays', 'zh')).toContain('CDP');
                expect(t('speed.e2eModelCall', 'zh')).toContain('E2E');
                expect(t('usage.planRoiDisclaimer', 'zh')).toContain('API');
                expect(t('usage.currencyCad', 'zh')).toContain('CAD');
            });
        });

        describe('4. Host locale normalization & first-boot priority (detectHostLocaleLanguage)', () => {
            it('normalizes zh-Hant, zh-TW, zh-HK, zh_CN.UTF-8, en-US, empty/null, C, POSIX, and Accept-Language lists', () => {
                // Chinese variants -> 'zh'
                for (const tag of [
                    'zh',
                    'zh-CN',
                    'zh-Hans',
                    'zh-Hant',
                    'zh-TW',
                    'zh-HK',
                    'zh-Hant-HK',
                    'zh_SG',
                    'zh_CN.UTF-8',
                    'zh_TW.Big5@euro',
                    'ZH-HANT',
                    'zh-Hant-TW,zh;q=0.9,en;q=0.8',
                    'zh-Hans-CN\nen-US',
                ]) {
                    expect(detectHostLocaleLanguage({ hostLocale: tag }), `expected zh for ${JSON.stringify(tag)}`).toBe('zh');
                }

                // English, non-Chinese, empty, null, C, POSIX -> 'en'
                for (const tag of [
                    'en',
                    'en-US',
                    'en_GB.UTF-8',
                    'ja-JP',
                    'fr-FR',
                    '',
                    '   ',
                    null,
                    undefined,
                    'C',
                    'C.UTF-8',
                    'c.utf8',
                    'POSIX',
                    'posix',
                    'und',
                    'en-US,en;q=0.9,zh-CN;q=0.8',
                    'en-US\nzh-Hans-CN',
                    '!!!invalid!!!',
                ]) {
                    expect(detectHostLocaleLanguage({ envLocale: tag }), `expected en for ${JSON.stringify(tag)}`).toBe('en');
                }

                expect(normalizeLocaleTag('zh_CN.UTF-8')).toBe('zh-cn');
                expect(normalizeLocaleTag('zh-Hant')).toBe('zh-hant');
                expect(normalizeLocaleTag('C')).toBeNull();
                expect(normalizeLocaleTag('C.UTF-8')).toBeNull();
                expect(normalizeLocaleTag('POSIX')).toBeNull();
                expect(normalizeLocaleTag('')).toBeNull();
                expect(normalizeLocaleTag(null)).toBeNull();
            });

            it('strictly follows priority: vscodeLanguage -> hostLocale -> intlLocale -> envLocale', () => {
                // IDE vscodeLanguage overrides hostLocale/intlLocale/envLocale in both directions
                expect(detectHostLocaleLanguage({
                    vscodeLanguage: 'en-US',
                    hostLocale: 'zh-CN',
                    intlLocale: 'zh-TW',
                    envLocale: 'zh_CN.UTF-8',
                })).toBe('en');

                expect(detectHostLocaleLanguage({
                    vscodeLanguage: 'zh-Hant',
                    hostLocale: 'en-US',
                    intlLocale: 'en-US',
                    envLocale: 'C',
                })).toBe('zh');

                // Non-Chinese valid IDE language (e.g. de-DE) still wins over Chinese hostLocale -> 'en'
                expect(detectHostLocaleLanguage({
                    vscodeLanguage: 'de-DE',
                    hostLocale: 'zh-CN',
                })).toBe('en');

                // Empty / C / POSIX in higher slots safely fall through to lower valid slots
                expect(detectHostLocaleLanguage({
                    vscodeLanguage: '',
                    hostLocale: 'zh-HK',
                    intlLocale: 'en-US',
                })).toBe('zh');

                expect(detectHostLocaleLanguage({
                    vscodeLanguage: 'C',
                    hostLocale: 'POSIX',
                    intlLocale: 'zh-TW',
                    envLocale: 'en_US.UTF-8',
                })).toBe('zh');

                expect(detectHostLocaleLanguage({
                    vscodeLanguage: null,
                    hostLocale: '',
                    intlLocale: 'C.UTF-8',
                    envLocale: 'zh_CN.UTF-8',
                })).toBe('zh');

                expect(detectHostLocaleLanguage({})).toBe('en');
            });
        });

        describe('5. Persisted languagePreference vs per-view effectiveLanguage (D3 / 479/480/481px isolation)', () => {
            it('validates LanguagePreference and EffectiveDisplayLanguage type guards', () => {
                for (const p of ['auto', 'en', 'zh', 'both'] as LanguagePreference[]) {
                    expect(isLanguagePreference(p)).toBe(true);
                }
                expect(isLanguagePreference('fr')).toBe(false);
                expect(isLanguagePreference(undefined)).toBe(false);

                for (const e of ['en', 'zh', 'both'] as EffectiveDisplayLanguage[]) {
                    expect(isEffectiveDisplayLanguage(e)).toBe(true);
                }
                expect(isEffectiveDisplayLanguage('auto')).toBe(false);
                expect(DEFAULT_COMPACT_BREAKPOINT_PX).toBe(480);
            });

            it('compacts "both" at 479px and 480px strictly for that view while preserving "both" at 481px and 960px', () => {
                // Chinese host locale: <= 480px -> 'zh', >= 481px -> 'both'
                expect(resolvePerViewEffectiveLanguage('both', { hostLocale: 'zh-Hant', viewportWidthPx: 479 })).toBe('zh');
                expect(resolvePerViewEffectiveLanguage('both', { hostLocale: 'zh-Hant', viewportWidthPx: 480 })).toBe('zh');
                expect(resolvePerViewEffectiveLanguage('both', { hostLocale: 'zh-Hant', viewportWidthPx: 481 })).toBe('both');
                expect(resolvePerViewEffectiveLanguage('both', { hostLocale: 'zh-Hant', viewportWidthPx: 960 })).toBe('both');

                // English / C / POSIX host locale: <= 480px -> 'en', >= 481px -> 'both'
                expect(resolvePerViewEffectiveLanguage('both', { envLocale: 'C', viewportWidthPx: 479 })).toBe('en');
                expect(resolvePerViewEffectiveLanguage('both', { envLocale: 'POSIX', viewportWidthPx: 480 })).toBe('en');
                expect(resolvePerViewEffectiveLanguage('both', { envLocale: 'POSIX', viewportWidthPx: 481 })).toBe('both');

                // Unknown / unmeasured / zero / NaN viewport preserves 'both'
                expect(resolvePerViewEffectiveLanguage('both', { hostLocale: 'zh-CN', viewportWidthPx: null })).toBe('both');
                expect(resolvePerViewEffectiveLanguage('both', { hostLocale: 'zh-CN', viewportWidthPx: undefined })).toBe('both');
                expect(resolvePerViewEffectiveLanguage('both', { hostLocale: 'zh-CN', viewportWidthPx: 0 })).toBe('both');
                expect(resolvePerViewEffectiveLanguage('both', { hostLocale: 'zh-CN', viewportWidthPx: Number.NaN })).toBe('both');

                // Zoomed CSS pixel widths (e.g., 600px physical pane at 125% zoom = 480 CSS px -> compact; at 120% = 500 CSS px -> both)
                expect(resolvePerViewEffectiveLanguage('both', { hostLocale: 'zh_CN.UTF-8', viewportWidthPx: 600 / 1.25 })).toBe('zh');
                expect(resolvePerViewEffectiveLanguage('both', { hostLocale: 'zh_CN.UTF-8', viewportWidthPx: 600 / 1.2 })).toBe('both');

                // Custom compactBreakpointPx
                expect(resolvePerViewEffectiveLanguage('both', { hostLocale: 'zh-CN', viewportWidthPx: 400, compactBreakpointPx: 400 })).toBe('zh');
                expect(resolvePerViewEffectiveLanguage('both', { hostLocale: 'zh-CN', viewportWidthPx: 401, compactBreakpointPx: 400 })).toBe('both');

                // Explicit single-language preferences never change with viewport width or locale
                for (const width of [320, 479, 480, 481, 960, null]) {
                    expect(resolvePerViewEffectiveLanguage('en', { hostLocale: 'zh-CN', viewportWidthPx: width })).toBe('en');
                    expect(resolvePerViewEffectiveLanguage('zh', { hostLocale: 'en-US', viewportWidthPx: width })).toBe('zh');
                }

                // 'auto' / missing / null always resolves to detected primary language
                expect(resolvePerViewEffectiveLanguage('auto', { hostLocale: 'zh-TW', viewportWidthPx: 960 })).toBe('zh');
                expect(resolvePerViewEffectiveLanguage(null, { hostLocale: 'zh-TW', viewportWidthPx: 960 })).toBe('zh');
                expect(resolvePerViewEffectiveLanguage(undefined, { envLocale: 'C', viewportWidthPx: 960 })).toBe('en');
            });

            it('is strictly pure: resizing a 479px AUX_PANE never mutates a 960px SIDEBAR, global state, or persisted StateBucket', async () => {
                const bucket = new MemoryBucket();
                await setLanguagePreferenceToState('both', bucket, { hostLocale: 'zh-CN', intlLocale: null, envLocale: null });

                expect(getLanguagePreference()).toBe('both');
                expect(getLanguage()).toBe('both');

                const auxPaneLang = resolvePerViewEffectiveLanguage(getLanguagePreference(), {
                    hostLocale: 'zh-CN',
                    viewportWidthPx: 479,
                });
                const sidebarLang = resolvePerViewEffectiveLanguage(getLanguagePreference(), {
                    hostLocale: 'zh-CN',
                    viewportWidthPx: 960,
                });
                const ideHostLang = resolvePerViewEffectiveLanguage(resolveStoredLanguagePreference(bucket), {
                    vscodeLanguage: 'en-US',
                    viewportWidthPx: 800,
                });

                expect(auxPaneLang).toBe('zh');
                expect(sidebarLang).toBe('both');
                expect(ideHostLang).toBe('both');

                // Global state and persisted bucket remain untouched ('both')
                expect(getLanguagePreference()).toBe('both');
                expect(getLanguage()).toBe('both');
                expect(bucket.get('displayLanguage', undefined)).toBe('both');
                expect(bucket.get('languagePreference', undefined)).toBe('both');
            });

            it('separates missing preference (auto) from explicitly persisted "both" in StateBucket & appSettings', () => {
                // Missing / unset -> 'auto'
                expect(resolveStoredLanguagePreference(new MemoryBucket())).toBe('auto');
                expect(resolveStoredLanguagePreference(new MemoryBucket({ displayLanguage: 'invalid' }))).toBe('auto');
                expect(resolveStoredLanguagePreference(new MemoryBucket({ appSettings: { languagePreference: 'auto' } }))).toBe('auto');

                // Explicitly persisted 'both' via legacy displayLanguage MUST survive even if appSettings.languagePreference is default 'auto'
                const legacyBothWithAppSettings = new MemoryBucket({
                    displayLanguage: 'both',
                    appSettings: { languagePreference: 'auto' },
                });
                expect(resolveStoredLanguagePreference(legacyBothWithAppSettings)).toBe('both');

                // Explicitly persisted 'both' via appSettings.languagePreference alone
                const appSettingsBoth = new MemoryBucket({
                    appSettings: { languagePreference: 'both' },
                });
                expect(resolveStoredLanguagePreference(appSettingsBoth)).toBe('both');

                // Explicitly persisted 'zh' via appSettings.languagePreference
                const appSettingsZh = new MemoryBucket({
                    appSettings: { languagePreference: 'zh' },
                });
                expect(resolveStoredLanguagePreference(appSettingsZh)).toBe('zh');
            });

            it('prioritizes vscode.env.language on IDE first boot and retains the hint across initI18nFromState', async () => {
                expect(getVscodeLanguage({ env: { language: 'zh-tw' } })).toBe('zh-tw');
                expect(getVscodeLanguage({ env: { language: '  ' } })).toBeUndefined();

                const emptyGlobal = new MemoryBucket();
                const emptyDurable = new MemoryBucket();
                const ctx = makeExtensionContext(emptyGlobal);

                // First boot in IDE with zh-tw UI language -> 'auto' resolves to 'zh' over en-US/C fallbacks
                const ideBootLang = initI18n(ctx, {
                    vscodeLanguage: 'zh-tw',
                    hostLocale: 'en-US',
                    intlLocale: 'en-US',
                    envLocale: 'C',
                });
                expect(ideBootLang).toBe('zh');
                expect(getLanguagePreference()).toBe('auto');
                expect(getLanguage()).toBe('zh');

                // Subsequent initI18nFromState(durableGlobalState) (like extension.ts startup) keeps vscodeLanguage priority
                const afterDurable = initI18nFromState(emptyDurable);
                expect(afterDurable).toBe('zh');
                expect(getLanguagePreference()).toBe('auto');

                // Switching vscodeLanguage to 'en' with empty state overrides Chinese hostLocale -> 'en'
                expect(getIdeLocaleSources({ vscodeLanguage: 'en', hostLocale: 'zh-CN' }).vscodeLanguage).toBe('en');
                const enBoot = initI18nForIde(ctx, emptyDurable, {
                    vscodeLanguage: 'en',
                    hostLocale: 'zh-CN',
                    intlLocale: 'zh-CN',
                });
                expect(enBoot).toBe('en');

                // Explicitly persisted 'both' in DurableState is preserved even when vscodeLanguage is 'en'
                const durableWithBoth = new MemoryBucket({ displayLanguage: 'both' });
                const preservedBoth = initI18nForIde(ctx, durableWithBoth, { vscodeLanguage: 'en' });
                expect(preservedBoth).toBe('both');
                expect(getLanguagePreference()).toBe('both');

                // Explicit setLanguagePreference('auto', ...) clears displayLanguage and re-resolves from vscodeLanguage
                const switchedAuto = await setLanguagePreference('auto', ctx, durableWithBoth, {
                    vscodeLanguage: 'zh-cn',
                    hostLocale: 'en-US',
                    intlLocale: 'en-US',
                });
                expect(switchedAuto).toBe('zh');
                expect(getLanguagePreference()).toBe('auto');
                expect(durableWithBoth.get('languagePreference', undefined)).toBe('auto');
                expect(durableWithBoth.get('displayLanguage', undefined)).toBeUndefined();

                // Verify compiled CJS out/i18n.js directly reads host require('vscode').env.language with zero overrides
                const compiledI18n = path.join(REPO_ROOT, 'out', 'i18n.js');
                if (fs.existsSync(compiledI18n)) {
                    const rawOut = execFileSync(process.execPath, ['-e', `
                        const Module = require('module');
                        const origLoad = Module._load;
                        const fakeVscode = { env: { language: 'zh-Hant' } };
                        Module._load = function(request, parent, isMain) {
                            if (request === 'vscode') return fakeVscode;
                            return origLoad.apply(this, arguments);
                        };
                        const i18n = require(${JSON.stringify(compiledI18n)});
                        const emptyBucket = { get(_k, d) { return d; }, async update() {} };
                        const ctx = { globalState: emptyBucket };
                        const zhResolved = i18n.initI18n(ctx);
                        const zhAfterDurable = i18n.initI18nFromState(emptyBucket);
                        fakeVscode.env.language = 'en-US';
                        const enResolved = i18n.initI18n(ctx);
                        const explicitBothBucket = { get(k, d) { return k === 'displayLanguage' ? 'both' : d; }, async update() {} };
                        const preserved = i18n.initI18nForIde(ctx, explicitBothBucket);
                        console.log(JSON.stringify({ zhResolved, zhAfterDurable, enResolved, preserved }));
                    `], { encoding: 'utf8', windowsHide: true });
                    expect(JSON.parse(rawOut.trim())).toEqual({
                        zhResolved: 'zh',
                        zhAfterDurable: 'zh',
                        enResolved: 'en',
                        preserved: 'both',
                    });
                }
            });
        });
    });
});

describe('[i18n-core]', () => {
    describe('i18n-core pure localization & v1.17.5 keys', () => {
        const initialLang = getLanguage();

        afterEach(() => {
            setLanguageInMemory(initialLang);
        });

        it('contains zero vscode imports in src/i18n-core.ts and loads cleanly in pure Node without vscode', () => {
            const coreSource = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'i18n-core.ts'), 'utf8');
            expect(coreSource).not.toMatch(/from\s+['"]vscode['"]|require\(\s*['"]vscode['"]\s*\)/);

            const compiledCore = path.resolve(__dirname, '..', 'out', 'i18n-core.js');
            const compiledWrapper = path.resolve(__dirname, '..', 'out', 'i18n.js');
            if (fs.existsSync(compiledCore) && fs.existsSync(compiledWrapper)) {
                const out = execFileSync(process.execPath, ['-e', `
                    const core = require(${JSON.stringify(compiledCore)});
                    const wrap = require(${JSON.stringify(compiledWrapper)});
                    core.setLanguageInMemory('zh');
                    console.log(JSON.stringify({
                        sameLang: wrap.getLanguage(),
                        key: core.t('context.breakdown'),
                        clock: core.formatClockTime(new Date(2026, 10, 22, 0, 5, 9), 'zh'),
                    }));
                `], { encoding: 'utf8', windowsHide: true });
                const parsed = JSON.parse(out.trim()) as { sameLang: string; key: string; clock: string };
                expect(parsed).toEqual({
                    sameLang: 'zh',
                    key: '上下文构成',
                    clock: '00:05:09',
                });
            }
        });

        it('re-exports all core helpers from src/i18n.ts and shares live language state', async () => {
            const store = new Map<string, unknown>();
            const bucket = {
                get<T>(k: string, d: T): T { return store.has(k) ? store.get(k) as T : d; },
                async update(k: string, v: unknown): Promise<void> { store.set(k, v); },
            };

            await setLanguageToState('en', bucket);
            expect(i18nWrapper.getLanguage()).toBe('en');
            expect(i18nWrapper.t('context.dotMatrix')).toBe('Dot Matrix');
            expect(i18nWrapper.formatClockTime).toBe(formatClockTime);
            expect(i18nWrapper.translations).toBe(translations);

            store.set('displayLanguage', 'zh');
            initI18nFromState(bucket);
            expect(getLanguage()).toBe('zh');
            expect(i18nWrapper.getLanguage()).toBe('zh');
        });

        it('provides complete, natural EN/ZH translations for all v1.17.5 keys with zero machine-translated 令牌', () => {
            const requiredKeys = [
                'context.breakdown',
                'context.dotMatrix',
                'context.barView',
                'context.effectiveBudget',
                'context.nativeCeiling',
                'context.measured',
                'context.estimated',
                'context.postCompaction',
                'context.rewind',
                'context.awaitingGeneration',
                'context.largestItems',
                'agent.lockToMain',
                'agent.followActive',
                'agent.conversationSwitcher',
                'turn.coldStart',
                'turn.partialStart',
                'turn.warmStart',
                'turn.lastTurnCache',
                'turn.sessionCache',
                'quota.runway',
                'quota.safeBeforeReset',
                'quota.exhaustsIn',
                'quota.cachedStale',
                'quota.customModelIsolated',
                'action.copyContextReport',
                'action.copyHandoffPrompt',
                'action.copied',
                'surface.antigravityApp',
                'surface.antigravityIde',
            ];

            for (const key of requiredKeys) {
                expect(translations[key], `missing translation key ${key}`).toBeDefined();
                expect(translations[key].en.trim().length).toBeGreaterThan(0);
                expect(translations[key].zh.trim().length).toBeGreaterThan(0);
            }

            // Enforce developer terminology rule across ALL keys.
            for (const [key, entry] of Object.entries(translations)) {
                expect(entry.zh, `forbidden term 令牌 in ${key}`).not.toContain('令牌');
            }

            // Verify surface deduplication in 'both' mode (identical EN/ZH never duplicates).
            expect(t('surface.antigravityApp', 'both')).toBe('Antigravity App');
            expect(t('surface.antigravityIde', 'both')).toBe('Antigravity IDE');
            expect(t('context.breakdown', 'en')).toBe('Context Breakdown');
            expect(t('context.breakdown', 'zh')).toBe('上下文构成');
            expect(t('context.breakdown', 'both')).toBe('Context Breakdown / 上下文构成');
        });

        it('supports explicit per-call language overrides without mutating global state', () => {
            setLanguageInMemory('zh');
            expect(t('action.copyHandoffPrompt', 'en')).toBe('Copy Handoff Prompt');
            expect(tBi('Measured', '实测', ' / ', 'en')).toBe('Measured');
            expect(tBiHtml('Measured', '实测', ' / ', 'both')).toBe(
                '<span class="bi-en">Measured</span><span class="bi-sep"> / </span><span class="bi-zh" lang="zh-CN">实测</span>',
            );
            expect(formatNumber(12345, undefined, 'en')).toBe('12,345');
            expect(getLanguage()).toBe('zh');
        });

        it('formats deterministic 24-hour HH:MM:SS clock times via formatClockTime regardless of host locale', () => {
            const midnight = new Date(2026, 10, 22, 0, 5, 9);
            const afternoon = new Date(2026, 10, 22, 14, 30, 45);
            const lateNight = new Date(2026, 10, 22, 23, 59, 59);

            for (const lang of ['en', 'zh', 'both'] as Language[]) {
                expect(formatClockTime(midnight, lang)).toBe('00:05:09');
                expect(formatClockTime(afternoon, lang)).toBe('14:30:45');
                expect(formatClockTime(lateNight, lang)).toBe('23:59:59');
            }

            expect(formatClockTime(new Date('not-a-date'), 'en')).toBe('--:--:--');
            expect(isLanguage('en')).toBe(true);
            expect(isLanguage('fr')).toBe(false);
        });
    });
});

describe('[i18n-persistence]', () => {
    class InMemoryStateBucket implements StateBucket {
        private readonly values = new Map<string, unknown>();

        get<T>(key: string, defaultValue: T): T {
            return this.values.has(key) ? this.values.get(key) as T : defaultValue;
        }

        async update(key: string, value: unknown): Promise<void> {
            if (value === undefined) {
                this.values.delete(key);
                return;
            }
            this.values.set(key, value);
        }
    }


    function makeContext(globalState: StateBucket = new InMemoryStateBucket()): vscode.ExtensionContext {
        return { globalState } as vscode.ExtensionContext;
    }


    function readStateFile(filePath: string): Record<string, unknown> {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    }


    function delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    describe('i18n DurableState persistence', () => {
        let tempDir: string;

        beforeEach(() => {
            setDefaultHostLocaleHints(undefined);
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-i18n-persistence-'));
        });

        afterEach(async () => {
            setDefaultHostLocaleHints(undefined);
            await setLanguage('both', makeContext());
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        function statePath(name: string): string {
            return path.join(tempDir, name);
        }

        it('round-trips display language through DurableState', async () => {
            const filePath = statePath('round-trip.json');
            const state = createFastDurableState(filePath);

            await state.globalBucket().update('displayLanguage', 'en');

            const reloaded = createFastDurableState(filePath);
            expect(reloaded.globalBucket().get('displayLanguage', 'both')).toBe('en');
        });

        it('dual-writes to fallback only when fallback bucket is provided', async () => {
            const fallback = new InMemoryStateBucket();
            const dualWritePath = statePath('dual-write.json');

            await createFastDurableState(dualWritePath)
                .globalBucket(fallback)
                .update('displayLanguage', 'zh');

            expect((readStateFile(dualWritePath).global as Record<string, unknown>).displayLanguage).toBe('zh');
            expect(fallback.get('displayLanguage', 'both')).toBe('zh');

            const mainOnlyPath = statePath('main-only.json');
            await createFastDurableState(mainOnlyPath)
                .globalBucket()
                .update('displayLanguage', 'en');

            expect((readStateFile(mainOnlyPath).global as Record<string, unknown>).displayLanguage).toBe('en');
            expect(fallback.get('displayLanguage', 'both')).toBe('zh');
        });

        it('restores language from DurableState after the webview setLanguage path writes it', async () => {
            const filePath = statePath('webview-language.json');
            const durableState = createFastDurableState(filePath);
            const ctx = makeContext();

            await setLanguage('en', ctx, durableState.globalBucket());
            await setLanguage('both', makeContext());

            const reloaded = createFastDurableState(filePath);
            initI18nFromState(reloaded.globalBucket());

            expect(getLanguage()).toBe('en');
            expect(getLanguagePreference()).toBe('en');
        });

        it('permanently preserves an explicitly persisted "both" preference across reload', async () => {
            const filePath = statePath('explicit-both.json');
            const durableState = createFastDurableState(filePath);
            await durableState.globalBucket().update('displayLanguage', 'both');

            const reloaded = createFastDurableState(filePath);
            expect(resolveStoredLanguagePreference(reloaded.globalBucket())).toBe('both');
            initI18nFromState(reloaded.globalBucket(), { vscodeLanguage: 'en-US', hostLocale: 'zh-CN' });

            expect(getLanguagePreference()).toBe('both');
            expect(getLanguage()).toBe('both');
        });

        it('does not write to DurableState when setLanguage is called without a state bucket', async () => {
            const filePath = statePath('negative-control.json');
            const ctx = makeContext();

            await setLanguage('en', ctx);

            expect(fs.existsSync(filePath)).toBe(false);
            expect(fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8').includes('en')).toBe(false);
        });

        it('defaults to auto (host-locale single language) when the DurableState file is missing', async () => {
            const state = createFastDurableState(statePath('missing.json'));

            await setLanguage('both', makeContext());
            expect(resolveStoredLanguagePreference(state.globalBucket())).toBe('auto');

            initI18nFromState(state.globalBucket(), { hostLocale: 'zh-CN', intlLocale: null, envLocale: null });
            expect(getLanguagePreference()).toBe('auto');
            expect(getLanguage()).toBe('zh');

            initI18nFromState(state.globalBucket(), { hostLocale: 'en-US', intlLocale: null, envLocale: null });
            expect(getLanguagePreference()).toBe('auto');
            expect(getLanguage()).toBe('en');
        });

        it('defaults to auto without throwing for malformed JSON', async () => {
            const filePath = statePath('malformed.json');
            fs.writeFileSync(filePath, '{not json', 'utf8');

            const state = createFastDurableState(filePath);

            await setLanguage('both', makeContext());
            expect(() => initI18nFromState(state.globalBucket(), { envLocale: 'C', intlLocale: null })).not.toThrow();
            expect(getLanguagePreference()).toBe('auto');
            expect(getLanguage()).toBe('en');
        });

        it('defaults to auto for unsupported DurableState versions', async () => {
            const filePath = statePath('unsupported-version.json');
            fs.writeFileSync(filePath, JSON.stringify({
                version: 2,
                global: { displayLanguage: 'en' },
                workspaces: {},
            }), 'utf8');

            const state = createFastDurableState(filePath);

            await setLanguage('both', makeContext());
            initI18nFromState(state.globalBucket(), { hostLocale: 'zh-Hant', intlLocale: null, envLocale: null });

            expect(getLanguagePreference()).toBe('auto');
            expect(getLanguage()).toBe('zh');
        });

        it('persists explicit "auto" preference via setLanguagePreferenceToState without retaining stale displayLanguage', async () => {
            const filePath = statePath('pref-auto.json');
            const state = createFastDurableState(filePath);
            await setLanguage('both', makeContext(), state.globalBucket());
            expect(resolveStoredLanguagePreference(state.globalBucket())).toBe('both');

            const effective = await setLanguagePreferenceToState('auto', state.globalBucket(), {
                hostLocale: 'zh_CN.UTF-8',
                intlLocale: null,
                envLocale: null,
            });
            expect(effective).toBe('zh');

            const reloaded = createFastDurableState(filePath);
            expect(resolveStoredLanguagePreference(reloaded.globalBucket())).toBe('auto');
        });

        it('recognizes only supported language values', () => {
            expect(isLanguage('zh')).toBe(true);
            expect(isLanguage('en')).toBe(true);
            expect(isLanguage('both')).toBe(true);
            expect(isLanguage('xx')).toBe(false);
            expect(isLanguage('')).toBe(false);
            expect(isLanguage(null)).toBe(false);
            expect(isLanguage(undefined)).toBe(false);
            expect(isLanguage(123)).toBe(false);
        });

        it('keeps distinct missing DurableState files isolated within one process', async () => {
            const first = createFastDurableState(statePath('first.json'));
            const second = createFastDurableState(statePath('second.json'));

            await first.globalBucket().update('displayLanguage', 'en');

            expect(second.globalBucket().get('displayLanguage', 'both')).toBe('both');
            expect(resolveStoredLanguagePreference(second.globalBucket())).toBe('auto');
        });
    });
});

describe('[backend-status-i18n]', () => {
    const context = {
        globalState: { update: async () => {} },
    } as unknown as vscode.ExtensionContext;

    const originalLanguage = getLanguage();


    afterEach(async () => {
        vi.restoreAllMocks();
        await setLanguage(originalLanguage, context);
    });


    describe('backend connection status localization', () => {
        it.each<Language>(['en', 'zh', 'both'])('localizes missing and lost backend in %s', async language => {
            await setLanguage(language, context);
            const create = vi.spyOn(vscode.window, 'createStatusBarItem');
            const manager = new StatusBarManager();
            const item = create.mock.results[0].value as vscode.StatusBarItem;
            manager.showDisconnected('LS not found');
            expect(item.text).toContain(language === 'en' ? 'Context: N/A' : '上下文：不可用');
            expect((item.tooltip as vscode.MarkdownString).value).toContain(language === 'zh' ? '未找到 Antigravity 后端' : 'Antigravity backend not found');
            expect((item.tooltip as vscode.MarkdownString).value).toContain('agy hub');
            manager.showDisconnected('LS connection lost');
            expect((item.tooltip as vscode.MarkdownString).value).toContain(language === 'zh' ? '重新连接' : 'Reconnecting');
            manager.dispose();
        });

        it('updates the disconnected label and tooltip immediately when language changes', async () => {
            await setLanguage('en', context);
            const create = vi.spyOn(vscode.window, 'createStatusBarItem');
            const manager = new StatusBarManager();
            const item = create.mock.results[0].value as vscode.StatusBarItem;
            manager.showDisconnected('LS not found');
            await setLanguage('zh', context);
            manager.refreshFromConfig();
            expect(item.text).toContain('上下文：不可用');
            expect((item.tooltip as vscode.MarkdownString).value).toContain('未找到 Antigravity 后端');
            expect(item.name).toBe('上下文窗口监控');
            manager.showInitializing();
            await setLanguage('en', context);
            manager.refreshFromConfig();
            expect(item.text).toContain('Context...');
            expect((item.tooltip as vscode.MarkdownString).value).toContain('Connecting to Antigravity');
            manager.dispose();
        });

        it('shows a recovery action for unexpected errors and clears stale state on recovery', () => {
            const create = vi.spyOn(vscode.window, 'createStatusBarItem');
            const manager = new StatusBarManager();
            const item = create.mock.results[0].value as vscode.StatusBarItem;
            manager.showDisconnected('RPC HTTP 503');
            expect((item.tooltip as vscode.MarkdownString).value).toMatch(/local backend|本地后端/);
            expect((item.tooltip as vscode.MarkdownString).value).not.toContain('RPC HTTP 503');
            manager.showNoConversation('256k', 'MODEL_PLACEHOLDER_M418');
            manager.refreshFromConfig();
            expect(item.text).not.toContain('debug-disconnect');
            expect(item.text).not.toMatch(/0k\//);
            expect(item.text).toContain('comment-discussion');
            manager.dispose();
        });
    });
});

describe('[cross-platform-i18n-helpers]', () => {
    const initialLanguage = getLanguage();

    const state = { get: <T>(_key: string, fallback: T) => fallback, update: async () => {} };


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
                '<span class="bi-en">Context &amp; quota</span><span class="bi-sep"> / </span><span class="bi-zh" lang="zh-CN">上下文与配额</span>',
            );
            expect(tBiHtml('tokens', 'tokens')).toBe('tokens');
            expect(tBiHtml('<script>', '"安全"')).toBe(
                '<span class="bi-en">&lt;script&gt;</span><span class="bi-sep"> / </span><span class="bi-zh" lang="zh-CN">&quot;安全&quot;</span>',
            );

            await setLanguageToState('en', state);
            expect(tBiHtml('Context & quota', '上下文与配额')).toBe('Context &amp; quota');
            expect(formatNumber(14_701)).toBe('14,701');

            await setLanguageToState('zh', state);
            expect(tBiHtml('Context & quota', '上下文与配额')).toBe('上下文与配额');
            expect(formatNumber(14_701)).toBe('14,701');
        });
    });
});

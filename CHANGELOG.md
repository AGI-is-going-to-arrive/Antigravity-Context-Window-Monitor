# 变更日志 / Changelog

## [1.14.9] - 2026-04-08

### ✨ Improved / 改进

- **Panel Title Rename / 面板标题更名**: Renamed the WebView panel from "Context Monitor / 上下文监控" to "Antigravity Monitor / Antigravity 监控面板". The panel now hosts 9 feature tabs well beyond basic context monitoring, and the new name better reflects its role as a comprehensive monitoring dashboard.
  面板标题从「Context Monitor / 上下文监控」更名为「Antigravity Monitor / Antigravity 监控面板」。面板已集成 9 个功能标签页，早已超越基础上下文监控的范畴，新名称更准确反映其综合监控仪表盘的定位。

### ✨ Added / 新增

- **Monthly Total Cost Summary / 月度总成本汇总**: Added a new "Monthly Cost" summary section at the top of the Pricing tab. Features:
  - Displays the aggregated monthly total cost across all archived quota cycles **plus** the current active cycle's real-time cost, ensuring the total is always up-to-date.
  - Per-model cost breakdown with proportional bar visualization and token usage chips (input/output/thinking/calls).
  - Handles incomplete months: shows a note when data recording started mid-month.
  - "View History" button navigates directly to the Calendar tab for historical cost exploration via `data-switch-tab` delegation.
  - Architecture: new `DailyStore.getMonthCostBreakdown()` method aggregates per-model cost from `gmModelStats` in archived cycles; new `MonthModelCost` and `MonthCostBreakdown` exported types; `buildPricingTabContent()` signature extended with optional `monthBreakdown` and `currentCycleCost` parameters.
  在成本标签页顶部新增「月度总成本」汇总区域。功能包括：
  - 汇总当月所有已归档额度周期 + 当前活跃周期的实时费用，确保总额始终最新。
  - 按模型分拆费用，配有比例条形图和 token 用量标签（输入/输出/思考/调用次数）。
  - 处理不完整的月份：当数据从月中开始记录时显示提示。
  - 「查看历史」按钮通过 `data-switch-tab` 委托直接导航到日历标签页浏览历史费用。
  - 架构：`DailyStore` 新增 `getMonthCostBreakdown()` 方法从归档周期的 `gmModelStats` 聚合按模型费用；新增 `MonthModelCost` 和 `MonthCostBreakdown` 导出类型；`buildPricingTabContent()` 签名扩展可选参数 `monthBreakdown` 和 `currentCycleCost`。

### 🐛 Fixed / 修复

- **Stale Data Flash on Panel Re-Show / 面板恢复可见时闪旧数据**: Fixed a visual glitch where switching away from the WebView panel and returning would briefly display stale data before the next polling cycle refreshed it. Root cause: VS Code destroys the webview DOM when the panel is hidden (default `retainContextWhenHidden: false`), and restores from the last `webview.html` snapshot on re-show — which contains old data. Fix: added `panel.onDidChangeViewState` listener that immediately sends an `updateTabs` message with the latest cached data (`lastUsage`, `lastAllUsages`, `lastConfigs`, `lastUserInfo`, `lastQuotaTracker`) when the panel becomes visible again, eliminating the 5-second polling gap.
  修复切换离开 WebView 面板再返回时短暂显示旧数据的视觉问题。根因：VS Code 在面板隐藏时销毁 webview DOM（默认不启用 `retainContextWhenHidden`），恢复可见时从上次设置的 `webview.html` 快照中重建——那是旧数据。修复：新增 `panel.onDidChangeViewState` 监听器，面板重新可见时立即用最新缓存数据（`lastUsage`、`lastAllUsages`、`lastConfigs`、`lastUserInfo`、`lastQuotaTracker`）发送 `updateTabs` 消息，消除 5 秒轮询间隔。

- **Pause-Aware Visibility Refresh / 暂停状态下不刷新**: The `onDidChangeViewState` handler now respects the pause state — when paused, re-showing the panel no longer forces a data refresh, preserving the frozen snapshot the user expects.
  `onDidChangeViewState` 处理器现在尊重暂停状态——面板暂停时重新显示不再强制刷新数据，保留用户期望的冻结快照。

- **Monthly Cost Call Count Accuracy / 月度成本调用次数修正**: Improved call count attribution in the monthly cost summary when merging current cycle data with archived cycles.
  改进月度成本汇总中合并当前周期数据与归档周期时的调用次数归因准确性。

### 📊 Stats / 统计

- **Files changed**: 6 (`daily-store.ts`, `pricing-panel.ts`, `webview-panel.ts`, `i18n.ts`, `CHANGELOG.md`, `project_structure.md`)
- **TypeScript compile**: Zero errors

---

## [1.14.8] - 2026-04-02

### 🐛 Fixed / 修复

- **Light Theme — Session Panel Visibility / 浅色主题 — 会话面板可见性** (PR #40 by @NightMin2002): Fixed multiple visibility issues in the session history panel when using a light VS Code theme. Includes: search input text and placeholder color now properly contrast against light backgrounds; all cyan/blue-leaning Tab color tokens overridden with darker variants for light mode; shortcut card count bubble uses proper teal contrast; filter button active and focus-visible states added for light theme; workspace/repo/current/running badge colors unified with the CSS variable token system (`--lt-teal`, `--lt-blue`, `--lt-green`, `--lt-amber`).
  修复了会话历史面板在 VS Code 浅色主题下的多个可见性问题。包括：搜索输入框文本和占位符颜色现在在浅色背景上有正确对比度；所有偏青蓝的 Tab 颜色 token 被更深的浅色模式变体覆盖；快捷卡片数量气泡使用正确的 teal 对比色；筛选按钮激活态和 focus-visible 状态新增浅色适配；workspace/repo/current/running badge 颜色统一使用 CSS 变量 token 体系。

## [1.14.7] - 2026-04-02

### ✨ Added / 新增

- **Calendar Monthly Summary Toggle / 日历月度总计切换**: Added segmented toggle buttons (Monthly / All-Time) to the calendar summary section. Users can now instantly see current month's consumption breakdown alongside all-time stats. Default view is monthly. Empty-month states show friendly guidance. Toggle state survives poll refreshes via event delegation.
  日历汇总区域新增分段切换按钮（月度 / 全部），用户可快速查看本月消耗明细和历史总计。默认显示月度。空月份显示友好提示。通过事件委托机制在自动刷新后保持切换状态。

- **Tab Arrow Navigation / Tab 栏箭头导航**: Added left/right scroll arrow buttons flanking the tab bar. Arrows intelligently show/hide based on overflow state: no overflow = both faded, scrolled to start = left faded, scrolled to end = right faded, middle = both visible. Uses `opacity` + `pointer-events` fade transition (0.25s) instead of `display: none` to **preserve layout space and prevent accidental tab clicks** when an arrow disappears at scroll endpoints. Click scrolls 150px with smooth behavior.
  Tab 栏两端新增左右箭头滚动按钮，根据溢出状态智能显隐。使用 `opacity` + `pointer-events` 渐隐过渡（0.25s）而非 `display: none`，**保留占位空间防止箭头消失时误触旁边的 Tab**。点击平滑滚动 150px。

- **Quota Tracking Disabled State Feedback / 额度追踪关闭状态反馈**: When quota timeline tracking is disabled in Settings, the Quota Tracking tab now shows a clear “tracking is paused” message with a “Go to Settings” button that navigates directly to the Settings tab, instead of the misleading “No active quota consumption detected” empty state.
  关闭额度时间线追踪后，额度追踪标签页现在显示明确的「追踪已关闭」提示，并提供「前往设置」按钮一键跳转至设置页，替代此前误导性的「未检测到活跃额度消耗」空状态。

### ✨ Improved / 改进

- **Quota Tracking Toggle Migration / 额度追踪开关迁移**: Moved the quota timeline tracking toggle from the Quota Tracking tab to the Settings tab. Root cause: the polling mechanism (`innerHTML` replacement) destroyed the toggle's event listeners on every refresh cycle. The Settings tab is not subject to incremental DOM updates, ensuring stable state persistence. Default changed to enabled (`true`) since performance overhead is negligible.
  将额度时间线追踪开关从额度追踪标签页迁移至设置标签页。根因：轮询机制（`innerHTML` 替换）每次刷新都销毁 toggle 的事件监听。设置页不参与增量 DOM 更新，确保状态持久化稳定。默认值改为启用（`true`），性能开销极小。

- **Session Card Visual Overhaul / 会话卡片视觉升级**: Enhanced session history cards with modern aesthetics: `::before` pseudo-element top glow line for depth, 3px green left accent border for current sessions, enhanced multi-layer hover shadows (`4px+12px`), `translateY(-2px)` hover lift, spotlight card hover interactions, upgraded action buttons (`radius-md` + hover float + box-shadow), and comprehensive `body.vscode-light` theme overrides for all card components.
  会话历史卡片视觉全面升级：顶部柔光线增强层次感、当前会话左侧绿色强调边框、多层 hover 阴影、spotlight 卡片 hover 互动、操作按钮升级圆角 + 微浮效果，以及完整的浅色主题适配。

### 🐛 Fixed / 修复

- **Light Theme — Full Panel Visibility / 浅色主题 — 全面板可见性**: Fixed ~50 UI components that remained invisible or near-invisible when VS Code was set to a light theme. Root cause: hardcoded `rgba(255,255,255,X)` backgrounds (white overlays on dark backgrounds) became white-on-white in light mode. Fix: added comprehensive `body.vscode-light` CSS overrides across all three style sources — `webview-styles.ts`, `activity-panel.ts`, and `webview-calendar-tab.ts`. Covers: action buttons, stat cards, progress bar tracks, quota bars, model cards, timeline cards, pool badges, feature/MIME tags, chat history cards (including gradient replacements), monitor mini panel, activity card headers, timeline legend, GM perf items, X-ray visualization, rank bars, and calendar navigation.
  修复了约 50 个 UI 组件在 VS Code 浅色主题下不可见或几乎不可见的问题。根因：硬编码的 `rgba(255,255,255,X)` 背景在浅色模式下变成白色覆白色。修复：在三个样式源文件中添加了全面的 `body.vscode-light` CSS 覆盖。

- **Session Card Animation Re-Triggering / 会话卡片动画反复触发**: Removed the `historyRowSlideIn` staggered entry animation that re-triggered on every poll refresh. Root cause: CSS animations always fire on newly-inserted DOM elements, and the polling architecture replaces `innerHTML` entirely — creating new elements each cycle.
  移除了每次轮询刷新时反复触发的 `historyRowSlideIn` 交错入场动画。根因：CSS 动画在新插入的 DOM 元素上必然重新触发，而轮询架构每个周期都通过 `innerHTML` 替换创建全新元素。

- **GM Prompt Snippet Falling Back to Internal IDs / GM 提示摘要误回退到内部 ID**: Fixed cases where GM prompt extraction preferred opaque internal identifiers such as `bot-*`, `toolu_*`, `req_vrtx_*`, or `session-*` over actual prompt text. The extractor now filters internal identifier fields and keeps structural timeline rows focused on tool and step metadata.
  修复 GM prompt 摘要提取误把 `bot-*`、`toolu_*`、`req_vrtx_*`、`session-*` 这类内部标识当成真实提示文本的问题。现在提取器会过滤内部标识字段，让结构化时间线行只展示工具与步序元数据。

- **Quota History Clear Button / 已完成会话清理按钮**: Added a dedicated Clear button next to “Completed Sessions” in the Quota Tracking tab. The action is scoped to archived history only, while the existing “Active Tracking” clear button still clears runtime tracking state.
  在额度追踪标签页的「已完成会话」标题旁新增独立的清理按钮。该按钮只清除归档历史，不影响当前活跃追踪。

- **End-of-Content Fade-In Repeating on Poll Refresh / 「已到底」提示在轮询刷新时反复淡入**: Fixed by caching per-tab HTML, skipping unchanged pane swaps, preserving visible sentinel state across refreshes, and adding idempotent listener guards for `<details>` blocks and session catalog filters.
  通过缓存各标签页 HTML、跳过未变化 pane 的 DOM 替换、保留已可见 sentinel 状态、为 `<details>` 和会话筛选控件增加幂等监听保护来修复。

### 🧪 Tests / 测试

- **4 new regression tests**: GM prompt snippet filtering (prefers real text over internal IDs, drops bot-only snippets), activity tracker planner/gm_virtual structural integrity (no backfill of pseudo AI replies).
  **新增 4 项回归测试**：GM prompt 摘要过滤（优先真实文本、丢弃纯内部 ID）、activity tracker planner/gm_virtual 结构完整性（不回填伪 AI 回复）。

### 📊 Stats / 统计

- **TypeScript compile**: Zero errors

---

## [1.14.5] - 2026-04-01


### 🐛 Fixed / 修复

- **Multi-Window LS Discovery Failure / 多窗口语言服务器发现失败**: Fixed a critical bug where opening a second VS Code window with a different workspace caused permanent “LS not found” failure. Root cause: `selectMatchingProcessLine()` used a fail-closed strategy (v1.13.3), returning `null` when no exact `--workspace_id` match existed. Since Antigravity shares a single LS process across all windows, the second window's workspace_id never matched, making the context monitor completely unusable. Fix: `selectMatchingProcessLine()` now prefers an exact workspace_id match but **falls back to the first available LS** when no match exists, enabling all windows to connect to the shared LS.
  修复了一个严重 bug：打开第二个 VS Code 窗口（不同工作区）时，插件永久显示”LS not found”无法使用。根因：`selectMatchingProcessLine()`（v1.13.3）采用失败关闭策略，`--workspace_id` 不匹配时返回 `null`。由于 Antigravity 所有窗口共享同一个 LS 进程，第二个窗口的 workspace_id 永远匹配不上，导致上下文监控完全不可用。修复：`selectMatchingProcessLine()` 现在优先精确匹配 workspace_id，**匹配失败时回退到第一个可用的 LS**，使所有窗口都能连接共享 LS。

- **No-Workspace Window Always Shows 0k / 无工作区窗口始终显示 0k**: Fixed a bug where opening a window without any folder (no workspace) caused the context monitor to permanently show `0k/1M` even while conversations were active. Root cause: the trajectory filter used `t.workspaceUris.length === 0` for no-workspace windows, but Antigravity assigns workspace URIs to all conversations regardless, so every trajectory was filtered out. Fix: when no workspace is open, show **all trajectories** instead of filtering — since there is no folder to filter by.
  修复了无工作区窗口（未打开任何文件夹）中上下文监控始终显示 `0k/1M` 的 bug，即使对话已在进行中。根因：trajectory 过滤器对无工作区窗口使用 `t.workspaceUris.length === 0`，但 Antigravity 会给所有对话分配 workspace URI，导致所有 trajectory 被过滤掉。修复：无工作区时**显示所有 trajectory**，不做过滤。

- **LS Re-Discovery After RPC Failure Also Used Aggressive Backoff / RPC 失败后重新发现 LS 使用了过长的退避间隔**: When an RPC call failed and the extension attempted to re-discover the LS, a failed re-discovery (`handleLsFailure('LS connection lost')`) incorrectly used the 60-second RPC backoff cap instead of the faster 15-second discovery cap. Now correctly applies the discovery backoff.
  当 RPC 调用失败后扩展尝试重新发现 LS 时，`handleLsFailure('LS connection lost')` 错误地使用了 60 秒的 RPC 退避上限，而非更快的 15 秒发现退避上限。现已修正为使用发现退避。

- **Light-Theme Visibility — Timeline Tags / 浅色主题可见性 — 时间线标签**: Fixed near-invisible GM data tags, duration capsules, context labels, and credit indicators in light theme. Root cause: backgrounds used `rgba(255,255,255,0.xx)` (transparent white-on-white) and text colors used pastel hex values designed for dark backgrounds only. Fix: GM tag colors now default to dark-saturated variants (e.g., `#2563eb`, `#16a34a`, `#dc2626`), with `body.vscode-dark` overrides restoring the original pastel palette. Duration, tool-name, step-index, model, and context-marker backgrounds replaced with `var(--color-surface)` + `var(--color-border)`. Segment borders and checkpoint-model borders also updated.
  修复浅色主题下 GM 数据标签、时长胶囊、上下文标签和积分指示器几乎不可见的问题。根因：背景使用 `rgba(255,255,255,0.xx)`（白底上完全透明）、文字使用暗色主题专属淡色 hex 值。修复：GM 标签文字色默认改为深饱和色系；`body.vscode-dark` 选择器覆盖回原淡色调色板。时长、工具名、步序号、模型、上下文标签的背景统一改用 `var(--color-surface)` + `var(--color-border)`。

- **VS Code Theme Detection — `body.vscode-dark` vs `prefers-color-scheme` / VS Code 主题检测方法修正**: Replaced incorrect `@media (prefers-color-scheme: dark)` with `body.vscode-dark` selectors for dark-theme overrides. VS Code WebViews signal theme via body class (`vscode-dark` / `vscode-light`), not the CSS media query, which is unreliable in embedded Chromium WebViews.
  将错误的 `@media (prefers-color-scheme: dark)` 替换为 `body.vscode-dark` 选择器。VS Code WebView 通过 body class（`vscode-dark` / `vscode-light`）标识主题，而非 CSS 媒体查询——后者在嵌入式 Chromium WebView 中不可靠。

- **Quota Tracking Ghost-Session Loop / 额度追踪幽灵会话死循环**: Fixed an infinite loop where quota tracking would repeatedly create and immediately archive 0-second ghost sessions after a quota reset. Root cause: the API continues reporting the OLD `resetTime` (already in the past) for several minutes after a reset. `QuotaTracker` entered tracking with a stale `cycleResetTime`, causing `isCycleEnded()` to fire on the very next poll → archive → idle → re-enter tracking → loop. Each iteration also triggered `onQuotaReset`, causing duplicate Activity/GM archives. Fix: added a **stale-resetTime guard** at both idle→tracking entry paths — if `resetTime <= now`, the model stays idle until the API provides a future `resetTime` for the new cycle.
  修复额度重置后追踪器反复创建并立即归档 0 秒幽灵会话的无限循环。根因：API 在重置后数分钟内仍报告旧的 `resetTime`（已过期），追踪器用过期时间作为 `cycleResetTime` 进入 tracking → `isCycleEnded()` 下个 poll 立即判定周期结束 → 归档 → idle → 再进入 → 死循环。每次循环还触发 `onQuotaReset`，导致 Activity/GM 重复归档。修复：在两个 idle→tracking 入口添加**过期 resetTime 防护**——若 `resetTime <= now` 则保持 idle，等待 API 返回新周期的未来时间。

### ✨ Added / 新增

- **Scrollbar Hiding — Defense in Depth / 滚动条隐藏 — 纵深防御**: Implemented a three-layer scrollbar hiding mechanism to reliably override VS Code WebView's injected UA stylesheets:
  1. **Layer 1 — Static CSS**: `html[data-hide-scrollbar=”true”]` selectors with `scrollbar-width: none !important` + `::-webkit-scrollbar { display: none; width: 0; height: 0 }`.
  2. **Layer 2 — HTML attributes**: `data-hide-scrollbar` set on both `<html>` and `<body>` elements for full selector reach.
  3. **Layer 3 — Runtime JS injection**: `applyScrollbarHide()` dynamically creates a `<style id=”ag-scrollbar-override”>` element appended to `<head>` tail for maximum specificity, bypassing VS Code's injected stylesheets.
  Default is **hidden** (`showScrollbar: false`); users can re-enable scrollbars in Settings.
  实现三层纵深防御的滚动条隐藏机制，确保覆盖 VS Code WebView 注入的 UA 样式表：
  ① 静态 CSS：`html[data-hide-scrollbar]` 选择器 + `!important` + `-ms-overflow-style: none`；
  ② HTML 属性：`<html>` 和 `<body>` 同时设置 `data-hide-scrollbar=”true”`；
  ③ 运行时 JS 注入：`applyScrollbarHide()` 动态创建最高优先级 `<style>` 标签插入 `<head>` 末尾。
  默认**隐藏**。用户可在设置→滚动条外观中勾选”显示滚动条”恢复。

- **End-of-Content Sentinel / 到底提示**: Added persistent `— 已到底 —` indicator at the bottom of all tab panes. Sentinels are appended in `buildTabContents()` to survive `innerHTML` swaps during incremental updates. An `IntersectionObserver` shows/hides the sentinel with a fade-in animation, re-binding after every `updateTabs` poll refresh. Configurable via Settings (independent toggle for EOC indicator visibility).
  所有标签页底部新增「已到底」提示。标记在 `buildTabContents()` 中追加，确保增量更新的 `innerHTML` 替换后不丢失。`IntersectionObserver` 控制淡入显示/隐藏，在每次 `updateTabs` 轮询刷新后重新绑定。可在设置中独立启用/关闭。

- **Scrollbar Appearance Settings Card / 滚动条外观设置卡**: Added a “Scrollbar Appearance” card in the Settings tab with two independent toggles: scrollbar visibility and EOC indicator visibility. Preferences are persisted via `PanelHintPreferences` in `DurableState`.
  设置标签页新增「滚动条外观」卡片，提供两个独立开关：滚动条显示和到底提示显示。偏好通过 `DurableState` 持久化。

### ✨ Improved / 改进

- **Faster LS Discovery Backoff / 更快的 LS 发现退避**: Introduced a separate `MAX_DISCOVERY_BACKOFF_MS` (15 seconds) for LS discovery failures, distinct from the `MAX_BACKOFF_INTERVAL_MS` (60 seconds) used for RPC communication failures. This ensures the extension detects a newly started or restarted LS within ~15 seconds instead of ~60 seconds. Backoff sequence: 5s → 10s → 15s (capped) vs. the previous 5s → 10s → 20s → 40s → 60s.
  新增独立的 `MAX_DISCOVERY_BACKOFF_MS`（15 秒）用于 LS 发现失败，与 RPC 通信失败的 `MAX_BACKOFF_INTERVAL_MS`（60 秒）区分。确保扩展在 LS 启动或重启后 ~15 秒内检测到，而非之前的 ~60 秒。退避序列：5s → 10s → 15s（封顶）vs 之前的 5s → 10s → 20s → 40s → 60s。

- **WebView Panel Lightweight Mode / WebView 面板轻量化**: Removed `retainContextWhenHidden` from the WebView panel options. The panel now rebuilds its content when re-shown, reducing memory footprint and avoiding potential ServiceWorker scope conflicts in multi-window Electron environments.
  移除 WebView 面板的 `retainContextWhenHidden` 选项。面板重新显示时重建内容，减少内存占用并避免多窗口 Electron 环境下潜在的 ServiceWorker 作用域冲突。

- **Polling Overhead Reduction / 轮询开销优化**: The main polling loop now reuses cached `ContextUsage` for unchanged conversations instead of recomputing token usage every cycle. Recent-session background refresh also skips unchanged snapshots, reducing redundant `GetCascadeTrajectorySteps` RPC batches, repeated token estimation, and idle-time CPU spikes on long conversations.
  主轮询现在会复用未变化会话的 `ContextUsage`，而不是每个轮询周期都重新计算 token 用量。最近会话的后台刷新同样会跳过未变化快照，减少冗余的 `GetCascadeTrajectorySteps` 批量 RPC、重复 token 估算，以及长对话空闲期的 CPU 尖峰。

- **Fresh-Install GM Baseline / 首装 GM 基线修正**: New `GMTracker` instances now start in baseline mode, so existing historical GM calls are treated as pre-existing data on first install / first launch instead of being counted directly into the current cycle. This prevents the “first install immediately shows a huge amount of GM data” problem.
  新建 `GMTracker` 现在默认以 baseline 模式启动，因此首次安装 / 首次启动时，已有历史 GM 调用会被视为预存数据，而不会直接计入当前周期。修复了”刚安装就出现大量 GM 数据”的问题。

- **GM Snapshot Persistence De-duplication / GM 快照持久化去重**: `gmDetailedSummary`, Monitor GM conversation snapshots, and related model-DNA persistence now only update when GM aggregates actually change. This cuts repeated deep clones, repeated JSON serialization, and unnecessary external-state writes during idle polling.
  `gmDetailedSummary`、Monitor GM 会话快照以及相关 model DNA 持久化现在仅在 GM 聚合结果真实变化时才会更新，减少空闲轮询期间重复深拷贝、重复 JSON 序列化和不必要的外部状态写入。

- **Durable State Batched Writes / 持久化状态批量写入**: External `state-v1.json` persistence was changed from synchronous whole-file rewrites on every update to async debounced batch flushes with unchanged-content short-circuiting. This significantly lowers disk writes while preserving the same recovery model.
  外部 `state-v1.json` 持久化从”每次 update 都同步整文件重写”改为”异步防抖批量落盘 + 内容未变直接跳过”，在保持恢复模型不变的前提下显著降低磁盘写入。

### 🧪 Tests / 测试

- **21 new discovery tests** (50 total, was 29): Multi-window fallback simulation (2nd/3rd window different workspace), exact match preference, edge cases (empty URI, undefined URI), Windows-specific tests (drive letter encoding, CJK paths `%E6%95%B0%E6%8D%AE`, cross-workspace CJK fallback), WSL/vscode-remote URI tests, and backoff constant validation (discovery caps at 15s, RPC caps at 60s, custom base intervals).
  **新增 21 项发现测试**（共 50 项，原 29 项）：多窗口回退模拟（第二/第三窗口不同工作区）、精确匹配优先级、边界情况（空 URI、undefined URI）、Windows 特定测试（盘符编码、CJK 路径、跨工作区 CJK 回退）、WSL/vscode-remote URI 测试，以及退避常量验证（发现退避封顶 15s、RPC 退避封顶 60s、自定义基础间隔）。

### 📊 Stats / 统计

- **Files changed**: 15 (13 source + 2 tests)
- **TypeScript compile**: Zero errors
- **Vitest**: 12 files / 139 cases — 137 passing, 2 pre-existing timezone-related failures in `reset-time.test.ts`

---

## [1.14.3] - 2026-03-29

### ✨ Added / 新增

- **Session Catalog Tab / 会话目录标签页**: New `Sessions / 会话` tab displaying all Cascade conversations grouped by workspace/repository. Features include: session count & total credits summary, quick-access shortcut cards (current workspace / current repo / running / recordable), search bar with text filtering, filter toolbar (All / Current Workspace / Current Repo / Running / Recordable), and per-session action buttons to reveal workspace folders, brain directories, or raw `.pb` files. New file `webview-chat-history-tab.ts` (484 lines).
  新增「会话」标签页，按工作区/仓库分组展示所有 Cascade 对话。包含：会话数 & 总积分汇总、快捷卡片（当前工作区/当前仓库/运行中/可录制）、文本搜索框、筛选工具栏（全部/当前工作区/当前仓库/运行中/可录制），以及逐会话操作按钮（打开工作区文件夹、Brain 目录、原始 `.pb` 文件）。新增文件 `webview-chat-history-tab.ts`（484 行）。

- **Tab Scroll Hint / 标签栏溢出提示**: When the tab bar overflows horizontally (9 tabs), a hint banner appears below suggesting Shift+Scroll navigation. Users can dismiss the hint, and the preference is persisted via `DurableState`. A "Show hint now" button in Settings allows re-enabling it.
  当标签栏水平溢出（9 个标签）时，下方显示提示条建议使用 Shift+滚轮导航。用户可关闭提示，偏好通过 `DurableState` 持久化。设置中提供「立即显示一次提示」按钮可重新启用。

- **GM Credit Display in Activity Panel / GM 数据面板积分展示**: Conversation distribution section now shows total credit consumption per session, and session list entries display short cascade IDs alongside credit usage.
  对话分布区新增每会话积分消耗展示，会话列表条目显示短 cascadeId 和积分用量。

### ✨ Improved / 改进

- **Sessions Tab UI Overhaul / 会话标签页 UI 重设计**: Consolidated 6 stat cards into 3 compact dual-metric cards (Conversations·Groups / Workspace·Running / Recordable). Shortcut cards switched from `grid auto-fit` to `flex` equal-width layout with hidden redundant "固定入口" kicker. Removed verbose toolbar note paragraph. Reduced per-session footer from 3 timestamps to 2 (dropped "Last Input"). Spotlight sub-panels switched from `grid` to compact `flex` layout with reduced padding and font-weight. Action buttons downsized from large `flex: 1 1 140px` to small `inline-flex` with separator border-top.
  会话标签页统计卡从 6 个精简为 3 个双指标卡（对话·分组 / 工作区·运行中 / 可备份）。快捷入口从 `grid auto-fit` 改为 flex 等宽布局并隐藏冗余 kicker 文字。移除工具栏底部冗长说明。每条会话时间戳从 3 个减至 2 个。聚光灯子面板改为紧凑 flex 排列。操作按钮缩小并以 border-top 分隔。

- **Settings Button Upgrade / 设置按钮美化**: Global `.action-btn` upgraded from icon-only style (`padding: space-1`, transparent bg) to text+icon hybrid with proper `gap`, `font-size`, `font-weight`, gradient background, and hover shadow lift. Added `.stg-card .action-btn` override for increased padding and micro-gradient. Added `.danger-action` variant with red color scheme. `.storage-actions` children now respect `flex: 0 1 auto` sizing.
  全局 `.action-btn` 从图标按钮升级为文字+图标混合按钮，增加 `gap`、`font-size`、渐变背景和 hover 上浮阴影。设置面板内按钮增加内边距和微渐变。新增 `.danger-action` 红色样式变体。

- **Persistent Storage Diagnostics Expanded / 持久化存储诊断增强**: The Settings "Persistent Storage" card now displays the real external state file size and the current large-file open warning threshold. Users can see why the large-file guard triggers before attempting to open the JSON file, instead of guessing or blindly tuning values.
  设置中的「持久化存储」卡片现在直接显示外部状态文件的真实大小，以及当前“大文件打开警告”阈值。用户在尝试打开 JSON 前就能知道为什么会触发保护，不必靠猜测或盲目调值。

- **State File Open Flow Hardened / 状态文件打开链路加固**: WebView click handling now normalizes delegated targets and returns explicit success/failure feedback for "Open File" and "Reveal". The open path prefers command-level `vscode.open` and falls back to editor APIs only when needed, improving compatibility with non-standard VS Code-like hosts.
  WebView 对「打开文件 / 定位文件」的点击处理现在会先归一化委托目标，并把成功/失败结果明确反馈回设置页。打开路径优先走命令级 `vscode.open`，仅在必要时回退到编辑器 API，从而提升对非标准 VS Code-like 宿主的兼容性。

- **Large State File Safety Guard / 大状态文件保护**: Opening the external state JSON now checks the real file size first. Files at or above `1 MB` trigger a warning dialog with three outcomes: open anyway, reveal in file manager instead, or cancel. This reduces the chance of users freezing the editor by opening a very large JSON blob directly.
  现在在打开外部状态 JSON 前会先检查真实文件大小。文件达到或超过 `1 MB` 时，会先弹出警告对话框，提供「仍然打开 / 改为定位 / 取消」三种结果，减少用户直接打开超大 JSON 导致编辑器卡死的概率。

### ⚡ Refactored / 重构

- **`makePanelPayload()` Helper / 面板参数构建统一化**: Extracted a `makePanelPayload()` helper in `extension.ts` that constructs the full `PanelPayload` from cached state. Replaced 7 inline payload object literals across `showMonitorPanel` / `updateMonitorPanel` call sites, eliminating parameter duplication and ensuring consistent data delivery. Also added `lastTrajectories` caching to avoid redundant RPC calls.
  在 `extension.ts` 中提取 `makePanelPayload()` 辅助函数，从缓存状态构建完整 `PanelPayload`。替换 7 处内联 payload 字面量，消除参数重复，确保数据传递一致性。同时新增 `lastTrajectories` 缓存避免冗余 RPC 调用。

- **`restoreDetailsState()` Extraction / `<details>` 状态恢复提取**: Extracted `<details>` open/closed state restoration into a reusable `restoreDetailsState()` function in `webview-script.ts`, called both on initial load and after each `updateTabs` incremental refresh. Eliminates the previous pattern of duplicating restoration logic in two places.
  将 `<details>` 展开/收起状态恢复提取为 `webview-script.ts` 中的可复用函数 `restoreDetailsState()`，在初始加载和每次 `updateTabs` 增量刷新后统一调用，消除两处重复的恢复逻辑。

- **`formatFileSize()` Unified / 字节格式化函数统一**: Merged duplicate `formatFileSize()` (webview-panel.ts) and `formatStorageBytes()` (webview-settings-tab.ts) into a single canonical export in `webview-helpers.ts`. Both consumers now import from the shared module.
  合并 `webview-panel.ts` 中的 `formatFileSize()` 和 `webview-settings-tab.ts` 中的 `formatStorageBytes()` 到 `webview-helpers.ts` 统一导出，消除重复定义。

- **`reportStateFileError()` Extraction / 状态文件错误处理提取**: Extracted repeated 4-line catch-block pattern into a dedicated `reportStateFileError()` helper in `webview-panel.ts`. Replaced 3 duplicate catch blocks with single-line calls.
  将重复的 4 行 catch 块模式提取为 `webview-panel.ts` 中的 `reportStateFileError()` 辅助函数，3 处重复 catch 块简化为单行调用。

### 🐛 Fixed / 修复

- **Tab Scroll Hint Disappearing After "Show Now" / 点击「立即显示」后提示框闪现即消**: Fixed a race condition where clicking "Show hint now" in Settings triggered a `setPanelPref` message round-trip. The backend responded with `panelPrefUpdated`, which called `updateTabOverflowHint()` — this re-checked overflow width and hid the hint if tabs didn't overflow at that moment. Fix: introduced `data-force-show` attribute mechanism. When user manually shows the hint, the attribute is set on `#tabScrollHint`, and `updateTabOverflowHint()` skips auto-hide when it detects this attribute. The attribute is only removed when user explicitly clicks the dismiss button.
  修复竞态条件：在设置中点击「立即显示一次提示」触发 `setPanelPref` 消息往返，后端回复 `panelPrefUpdated` 调用 `updateTabOverflowHint()` 重新检测溢出量——若此时标签栏未溢出则立即隐藏提示。修复：引入 `data-force-show` 属性机制。用户手动显示时设置该属性，`updateTabOverflowHint()` 检测到后跳过自动隐藏。仅在用户点击关闭按钮时移除该属性。

- **Settings Hint Badge Not Updating in Real-Time / 设置界面提示状态徽章未实时更新**: Fixed the "Panel Tips" section in Settings where the enabled/disabled badge did not react to the `panelPrefUpdated` message when toggling the hint from the hint bar itself. The `configSaved` feedback path now correctly maps `panelShowTabScrollHint` to its feedback element.
  修复设置中「界面提示」区域的启用/禁用徽章在从提示条本身切换时不随 `panelPrefUpdated` 消息更新的问题。`configSaved` 反馈路径现已正确映射 `panelShowTabScrollHint` 到其反馈元素。

- **Settings "Open File" Button Silent No-Op / 设置中“打开文件”按钮静默无反应**: Fixed the Settings "Open File" action silently doing nothing in some hosts. Root cause was a combination of brittle delegated click targeting inside the WebView and host-specific differences in editor-opening behavior. The button now reliably posts its message, reports action status back to the UI, and opens through a host-tolerant command-first path.
  修复某些宿主环境下设置页「打开文件」按钮点击后静默无反应的问题。根因是 WebView 内部委托点击目标匹配过于脆弱，再叠加不同宿主对编辑器打开行为的差异。现在按钮会稳定发出消息、把动作结果回传到界面，并通过更耐宿主差异的“命令优先”路径打开文件。


### 🗑 Removed / 移除

- **Dead Code Cleanup / 死代码清理**: Removed `countPbFiles()` function (file system scan no longer needed after stat card consolidation). Removed ~30 lines of orphaned toolbar note HTML template.
  移除 `countPbFiles()`（统计卡合并后不再需要文件系统扫描）。移除约 30 行工具栏说明残留 HTML 模板。

### Changed / 变更

- **Tab Bar Compacted / 标签栏紧凑化**: Reduced tab bar `gap` (6px→4px), `padding` (6px→4px), tab button `padding` (10px 16px→7px 12px), `font-size` (0.8em→0.76em), `gap` (6px→5px), and slider inset (6px→4px) to better accommodate 9 tabs within typical VS Code panel widths.
  缩减标签栏 `gap`（6→4px）、`padding`（6→4px）、按钮内距（10px 16px→7px 12px）、字号（0.8→0.76em）、图标间距（6→5px）和滑块内缩（6→4px），使 9 个标签在 VS Code 面板宽度内更紧凑地排列。

- **Session Catalog Tab Label Shortened / 标签文字缩短**: Tab button text changed from `Session Catalog / 会话目录` to `Sessions / 会话` for horizontal space savings.
  标签按钮文字从「Session Catalog / 会话目录」缩短为「Sessions / 会话」，节省水平空间。

### 📊 Stats / 统计

- **Files changed**: 11 (10 modified + 1 new)
- **TypeScript compile**: Zero errors
- **Vitest**: 12 files / 117 cases — all passing
- **New file**: `src/webview-chat-history-tab.ts` (484 lines)
- **Net addition**: ~1754 lines across styles, script logic, and tab content

### Contributors / 贡献者

- Thanks to [@NightMin2002](https://github.com/NightMin2002) for the Sessions tab, UI improvements, state file hardening, and extensive code deduplication ([PR #36](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/36)).
  感谢 [@NightMin2002](https://github.com/NightMin2002) 提交会话标签页、UI 改进、状态文件打开加固及大量代码去重（[PR #36](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/36)）。

## [1.14.2] - 2026-03-28

### ⚡ Refactored / 重构

- **PanelPayload Interface — Parameter Object Refactoring / PanelPayload 接口化 — 参数对象重构**: Replaced the 17-positional-parameter signatures of `showMonitorPanel()` and `updateMonitorPanel()` with a single `PanelPayload` object interface. All 9 call sites in `extension.ts` updated. Added `buildPanelPayload()` helper to construct payloads from cached state. Improves readability, type safety, and extensibility — new fields can be added without touching call sites.
  将 `showMonitorPanel()` 和 `updateMonitorPanel()` 的 17 个位置参数签名替换为单一 `PanelPayload` 对象接口。`extension.ts` 中全部 9 处调用点已更新。新增 `buildPanelPayload()` 辅助函数从缓存状态构建 payload。提升可读性、类型安全和可扩展性——新增字段无需修改调用点。

- **Event Delegation — Eliminate Re-binding / 事件委托 — 消灭重复绑定**: Migrated 5 categories of button event handlers (Copy JSON, Pricing Save/Reset, Clear Active Tracking, Privacy Toggle, Tab Switching) from individual `addEventListener` bindings to a single `document.body`-level click delegation handler using `closest()` matching. Completely eliminated the ~130-line re-binding block inside the `updateTabs` message handler. Body-level delegation survives `innerHTML` swaps during incremental updates, so `updateTabs` now only needs to restore DOM visual state (privacy mask, active classes) without re-attaching any event listeners.
  将 5 类按钮事件处理器（复制 JSON、价格保存/重置、清理活跃追踪、隐私切换、Tab 切换）从逐个 `addEventListener` 绑定迁移为单一 `document.body` 级 click 委托，使用 `closest()` 匹配。完全消除 `updateTabs` 消息处理器中 ~130 行的重新绑定代码。body 级委托不受增量更新时 `innerHTML` 替换的影响，`updateTabs` 现在只需恢复 DOM 视觉状态（隐私遮罩、active 类），无需重新绑定任何事件监听器。

- **Light Theme Tokenization / 亮色主题 Token 化**: Replaced 60+ hardcoded `rgba()` and hex color values in the `body.vscode-light` CSS overrides with 18 semantic CSS variables (`--lt-green`, `--lt-green-text`, `--lt-green-deep`, `--lt-amber`, `--lt-blue`, `--lt-red`, `--lt-orange`, `--lt-teal` and their text/deep variants). Future light-mode color adjustments can be made in one place (the variable declarations) rather than across 80+ individual CSS rules.
  将 `body.vscode-light` CSS 覆盖中 60+ 个硬编码 `rgba()` 和 hex 颜色值替换为 18 个语义 CSS 变量（`--lt-green`、`--lt-green-text`、`--lt-green-deep`、`--lt-amber`、`--lt-blue`、`--lt-red`、`--lt-orange`、`--lt-teal` 及其 text/deep 变体）。未来亮色模式配色调整只需修改变量声明处，无需逐条修改 80+ 条 CSS 规则。

- **CSS Deduplication — Profile Tab Redundancy Removal / CSS 去重 — Profile Tab 冗余清理**: Removed ~50 lines of duplicate CSS declarations in the Profile Tab region (`.credit-header`, `.credit-bar-wrap`, `.credit-bar`, `.feature-tag`, `.feature-tag.enabled`, `.default-model`, `.mime-count`) where identical selectors appeared twice — later declarations silently overriding earlier ones. Unique properties from the later block were merged back into the first definition.
  删除 Profile Tab 区域 ~50 行重复 CSS 声明（`.credit-header`、`.credit-bar-wrap`、`.credit-bar`、`.feature-tag`、`.feature-tag.enabled`、`.default-model`、`.mime-count`），这些选择器出现了两次，后者静默覆盖前者。后者中的独有属性已合并回首次定义处。

### 🐛 Fixed / 修复

- **`::selection` Missing `color` Declaration / `::selection` 缺少 `color` 声明**: Added `color: var(--vscode-editor-selectionForeground, #fff)` to the global `::selection` rule. Previously only `background` was set, which could result in invisible selected text on certain VS Code themes where the selection background color is close to the default text color.
  为全局 `::selection` 规则补充 `color: var(--vscode-editor-selectionForeground, #fff)`。此前仅设置了 `background`，在某些 VS Code 主题下选中文本背景色接近默认文字色时，可能导致选中文本不可见。

- **Tab Slider Position Drift After Incremental Update / 增量更新后 Tab 滑块位置偏移**: Added `updateTabSlider()` call at the end of the `updateTabs` message handler. Previously, after `innerHTML` replacement changed tab button text width (e.g., due to language differences or dynamic content), the capsule slider position was not recalculated, causing it to drift from the active tab.
  在 `updateTabs` 消息处理末尾追加 `updateTabSlider()` 调用。此前 `innerHTML` 替换改变 tab 按钮文字宽度后（如语言差异或动态内容），胶囊滑块位置未重新计算，导致偏移。

### 📊 Stats / 统计

- **Net reduction**: ~230 lines removed across 4 files
- **TypeScript compile**: Zero errors
- **Vitest**: 12 files / 117 cases — all passing
- **Visual regression**: None — zero UI/UX changes

### Contributors / 贡献者

- Thanks to [@NightMin2002](https://github.com/NightMin2002) for the bug fix and code quality refactors ([PR #35](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/35)).
  感谢 [@NightMin2002](https://github.com/NightMin2002) 提交 Bug 修复和代码质量重构（[PR #35](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/35)）。

## [1.14.1] - 2026-03-28

### 🐛 Fixed / 修复

- **GM Data Persists After Quota Reset (Empty Cache Race) / 额度重置后 GM 数据残留（空缓存竞态）**: Fixed a critical data persistence bug where Gemini model statistics (call counts, tokens, credits, cards) remained visible in the UI after a quota reset. Root cause: `serialize()` strips `calls[]` to save space, so after an extension restart, `_cache.calls` is empty. When `onQuotaReset` fired before `fetchAll()` repopulated the cache, the per-call `_archivedCallIds` mechanism had nothing to archive — and when `fetchAll()` later returned old calls from the API, they passed through unfiltered. Fix: replaced the permanent model-level blacklist (`_archivedModelIds: Set<string>`) with a **timestamp-based cutoff mechanism** (`_archivedModelCutoffs: Map<string, string>`). `reset()` now records `new Date().toISOString()` as the cutoff for each resetting model. `_buildSummary()` compares each call's `createdAt` against its model's cutoff — calls created at or before the cutoff are filtered out, while new calls in subsequent quota cycles pass through normally. Cutoffs survive extension restarts via `serialize()`/`restore()`. Calls with missing or unparseable `createdAt` are treated as stale and filtered by default.
  修复额度重置后 Gemini 模型统计数据（调用次数、token、积分、卡片）未清零的严重 BUG。根因：`serialize()` 为节省空间会剥离 `calls[]`，扩展重启后 `_cache.calls` 为空。当 `onQuotaReset` 在 `fetchAll()` 回填缓存之前触发时，基于 callId 的归档机制无数据可归档——随后 `fetchAll()` 从 API 拿回旧调用时，它们会绕过过滤全量显示。修复：将永久模型级黑名单（`_archivedModelIds: Set<string>`）替换为**时间戳截止线机制**（`_archivedModelCutoffs: Map<string, string>`）。`reset()` 为每个重置模型记录 `new Date().toISOString()` 作为截止线。`_buildSummary()` 将每个调用的 `createdAt` 与其模型的截止线比较——截止线之前（含）的调用被过滤，新周期的新调用正常通过。截止线通过 `serialize()`/`restore()` 跨重启持久化。`createdAt` 缺失或无法解析的调用默认视为旧调用并过滤。

## [1.14.0] - 2026-03-28

### 🐛 Fixed / 修复

- **Workspace ID Mismatch for CJK (Chinese/Japanese/Korean) Folder Names / 中日韩文件夹名的工作区 ID 不匹配**: Fixed a critical bug where workspaces with non-ASCII folder names (e.g., `简历投递`, `テスト`) could never discover the Language Server, permanently showing "LS not found". Root cause: when percent-encoded CJK characters appear in the URI (e.g., `%E7%AE%80`), the directory separator `/` and the percent sign `%` are both replaced by `_`, producing adjacent double underscores (`__E7`). The Language Server collapses `__` → `_` on all platforms, but the plugin only performed this collapse on Windows/WSL, causing a permanent `workspace_id` mismatch on macOS and Linux. Fix: moved the `/__+/g` → `_` collapse out of the Windows-only branch so it executes on all platforms, exactly mirroring the LS behavior.
  修复严重 Bug：工作区文件夹名包含中日韩字符（如 `简历投递`、`テスト`）时，插件始终无法发现语言服务器，永久显示"LS not found"。根因：URI 中的 CJK 百分号编码（如 `%E7%AE%80`）在目录边界 `/%E7` 处，`/` 和 `%` 各自被替换为 `_`，产生相邻双下划线 `__E7`。语言服务器在所有平台都会折叠 `__` → `_`，但插件仅在 Windows/WSL 执行此折叠，导致 macOS 和 Linux 上 `workspace_id` 永久不匹配。修复：将 `/__+/g` → `_` 折叠从 Windows 专属分支移出，改为全平台执行，精确镜像 LS 行为。

### ✅ Tests / 测试

- Added 3 new `buildExpectedWorkspaceId()` tests in `discovery.test.ts`: Chinese folder names (`%E7%AE%80%E5%8E%86%E6%8A%95%E9%80%92`), mixed space + CJK paths (`linux%20do/%E7%AE%80%E5%8E%86`), and Japanese folder names (`%E3%83%86%E3%82%B9%E3%83%88`). All 25 discovery tests pass.
  在 `discovery.test.ts` 中新增 3 个 `buildExpectedWorkspaceId()` 测试：中文文件夹名、空格 + 中文混合路径、日文文件夹名。全部 25 个 discovery 测试通过。

## [1.13.91] - 2026-03-27

### 🐛 Fixed / 修复

- **GM Archive Resurrection / GM 归档后旧调用复活**: Fixed a quota-cycle bug where GM calls archived during a reset could reappear in the next poll if the same historical invocation came back with a different `executionId`. GM reset now keeps both the original `executionId` marker and a stable archive key built from step indices, model identity, and call timestamp, so old calls no longer leak back into `GM 数据`、`成本`、`模型`、`监控` after archive.
  修复 GM 归档后的“旧调用复活”问题。旧逻辑只靠 `executionId` 记录已归档调用，如果同一条历史调用下一轮被重新抓到但换了 `executionId`，它就会重新混进当前周期，导致 `GM 数据`、`成本`、`模型`、`监控` 看起来都没归零。现在归档过滤同时记录原始 `executionId` 和一份稳定归档键（步序号 + 模型身份 + 调用时间），旧调用不会再漏回当前周期。

- **Monitor GM Fallback No Longer Rehydrates Archived Data / 监控页不再用旧快照顶回已归档 GM 数据**: Tightened the Monitor tab fallback path so once live `gmSummary` exists, it no longer mixes in stale `monitor-store` GM conversation snapshots for the current cycle. This prevents post-reset monitor cards from being repopulated by historical per-conversation GM data.
  收紧了 `监控` 页的 GM fallback 逻辑：只要 live `gmSummary` 已经存在，就不再把 `monitor-store` 里的旧 GM 会话快照混进当前周期。这样额度归档后，监控页不会再被历史快照“顶回去”。

- **Calendar Import Backfill Completeness / 日历历史回填不完整**: Fixed `DailyStore.importArchives()` so when it encounters an existing cycle, it now backfills the missing fields instead of only patching `modelStats`. Older calendar entries can now补齐 `triggeredBy`、`gmTotalCalls`、`gmTotalCredits`、`gmTotalTokens`、`gmRetry*`、`estimatedCost`、`gmModelStats`，避免出现“活动统计有了，但 GM/费用/触发来源缺半边”的日历脏数据。
  修复 `DailyStore.importArchives()` 只补 `modelStats` 不补其他字段的问题。现在命中旧 cycle 后，会一并回填 `triggeredBy`、`gmTotalCalls`、`gmTotalCredits`、`gmTotalTokens`、`gmRetry*`、`estimatedCost`、`gmModelStats`，避免旧日历记录长期缺 GM / 费用 / 触发来源。

- **Calendar Cache Hit Rate Weighting / 日历缓存命中率加权偏高**: Fixed the calendar summary's GM cache-hit aggregation so `0%` hit cycles are no longer dropped from the denominator. Cache hit rates are now weighted by actual call count even when a cycle had zero cache hits, preventing the daily merged cache rate from being systematically inflated.
  修复日历里 GM 缓存命中率的加权错误。旧逻辑会把 `0%` 命中的周期直接跳过，导致日级汇总缓存命中率被系统性抬高。现在只要该周期有调用，就会按真实 `calls` 参与加权，`0%` 也会计入分母。

- **Dev Reset Simulation Now Clears Activity for Real / 模拟额度重置现在会真正清空 Activity 当前周期**: The dev reset button previously passed a fake model scope into `activityTracker.archiveAndReset()`, which meant GM/Cost/Model panes reset while `GM 数据` 里的 Activity 统计还残留。 The simulation path now performs a real global Activity archive/reset before rebuilding GM summaries, so the test result matches actual quota-cycle behavior.
  修复“模拟额度重置”按钮只重置 GM、不真正清空 Activity 当前周期的问题。旧实现给 `activityTracker.archiveAndReset()` 传了假的模型范围，导致 `GM 数据` 页里仍残留旧的推理 / 工具 / 步数统计。现在模拟路径会先做真正的全局 Activity 归档与清空，再重建 GM 摘要，测试结果终于和真实额度归档一致。

- **Gemini Recent Activity Duplicate / Replacement Fix / Gemini 最近操作重复与串行替换修复**: Fixed a timeline bug that was most visible on Gemini Pro conversations, where user messages could appear twice, earlier AI replies could be repeated, or GM exact data could make a user row look like it had been "replaced". The tracker no longer treats `stepIndex` as the only stable identity for recent-step deduplication. Real step rows now carry a stable fingerprint built from conversation, step type, and creation time, so recent activity remains consistent even when the visible steps window shifts.
  修复 Gemini Pro 对话里“最近操作”出现用户消息重复、AI 回复重复、甚至用户行看起来像被替换的问题。时间线现在不再把 `stepIndex` 当成最近步骤去重的唯一身份，而是给真实 step 行增加由对话、步骤类型和创建时间组成的稳定指纹。这样即使可见步骤窗口发生重映射，最近操作也不会再把同一条消息重复灌进去，或把不同步骤错误地贴到同一个编号上。

- **Startup Timeline Self-Healing / 启动时自动清洗历史脏时间线**: Added a startup repair pass for persisted recent activity state. When the extension restores old timeline data containing duplicated step rows or user rows polluted by GM metadata, it now compacts and sanitizes that state immediately and writes the cleaned result back to persistence, so users do not need to wait for later polls to gradually self-heal stale duplicates.
  新增启动时的历史时间线自愈。扩展恢复旧的最近操作状态时，如果发现持久化里已经存在重复 step 行，或者用户行被 GM 元数据污染，现在会立即完成压缩清洗并把修正后的结果回写到持久化状态里，不需要再等后续轮询慢慢自愈。

### Changed / 变更

- **Reset Test Tools Are Now Reversible / 重置测试工具支持回滚**: The Settings tab's debug tools now revolve around a single safe flow: `模拟额度重置` captures a snapshot first, performs the reset simulation, and exposes a shared `恢复快照` button to roll Activity / GM / Calendar back to the pre-test state in the same extension session.
  设置页里的调试工具现在统一走“先抓快照、后测试、可回滚”的安全流程。`模拟额度重置` 会先保存一份快照，再执行模拟归档；随后可通过同一区块里的 `恢复快照`，把 Activity / GM / Calendar 一并回滚到测试前状态。

- **Settings Tab Simplified / 设置页继续做减法**: Removed `活动设置` and `历史设置` from the Settings tab, and also removed the unreliable `初始化 GM 数据` test entry. The debug area now keeps only the reset simulation + restore pair, reducing confusion and lowering the chance of users accidentally mutating internal counters in unsupported ways.
  继续精简 `设置` 页：移除了 `活动设置`、`历史设置` 两整块 UI，也删掉了不稳定的 `初始化 GM 数据` 测试入口。现在调试区只保留“模拟额度重置 + 恢复快照”这一组，减少误操作和无效入口。

### ✅ Tests / 测试

- Added a new `daily-store.test.ts` to lock the calendar import/backfill behavior and ensure old cycles can recover missing GM and cost fields.
  新增 `daily-store.test.ts`，锁定日历历史导入与回填行为，确保旧 cycle 能正确补回缺失的 GM / 成本字段。

- Expanded `gm-tracker.test.ts` with a regression case covering archived GM calls being refetched under a different `executionId`, ensuring they stay hidden after reset.
  扩展 `gm-tracker.test.ts`，新增“同一条历史 GM 调用换了 `executionId` 再次被抓回”这一回归用例，确保归档后的旧调用不会再复活。

- Expanded `activity-tracker.test.ts` with Gemini-specific timeline regressions covering unstable `stepIndex` remapping, user-row GM pollution, and persisted duplicate cleanup on restore.
  扩展 `activity-tracker.test.ts`，新增 Gemini 时间线回归用例，覆盖 `stepIndex` 重映射导致的重复、用户行被 GM 数据污染，以及恢复旧状态时自动清理历史重复时间线。

## [1.13.9] - 2026-03-27

### 🐛 Fixed / 修复

- **Quota Pool Representative Stability / 额度池代表稳定性**: Fixed a pool-dedup edge case where an already-tracking representative model could be replaced by another member of the same shared `resetTime` pool on a later poll. Once replaced, the old representative stopped receiving cycle-end checks, so a session could remain stuck in "tracking" even after its `cycleResetTime` had already passed. Pool selection now prefers members that are already actively tracking, ensuring reset archival still fires on time.
  修复共享 `resetTime` 额度池中的代表模型切换问题：旧逻辑会在后续轮询中让同池其他成员抢走代表位，导致已经处于 tracking 的旧代表不再执行周期结束判定，进而出现 `cycleResetTime` 已经过了却仍卡在“追踪中”的情况。现在额度池会优先保留已经处于活跃追踪的成员作为代表，确保到期后仍能正常归档。

- **Quota Active-Session Sanitization / 额度活跃会话自愈**: Hardened restore and tracking-start logic against dirty persisted sessions. The tracker now clamps future `startTime` values, drops future/invalid snapshots, re-sorts restored snapshots, and recomputes elapsed durations so corrupted sessions no longer render impossible timelines such as `0s` duration with older snapshots beneath them.
  强化额度活跃会话的恢复与建档自愈逻辑。追踪器现在会钳制未来 `startTime`、丢弃未来或无效快照、重新排序恢复出来的快照，并重算持续时间，避免脏状态继续渲染出类似“顶部 0s、下面却挂着更早快照”的不可能时间线。

- **Explicit Quota-Pool Mapping / 显式额度池映射**: Replaced the old “same resetTime means same pool” assumption with explicit known pool rules. Gemini Pro High/Low now share one pool, Gemini Flash is tracked independently, and Claude Sonnet / Claude Opus / GPT-OSS remain in the same shared pool. This prevents independent models that happen to refresh at the same moment from being incorrectly archived together.
  用显式已知池规则替代了旧的“`resetTime` 相同就视为同池”的假设。现在 Gemini Pro High/Low 共池，Gemini Flash 独立追踪，Claude Sonnet / Claude Opus / GPT-OSS 继续共用同一池。这样就不会再把“只是恰好同一时刻刷新”的独立模型误归档到一起。

- **Targeted GM Residue Repair / 定向 GM 残留修复**: Startup-time GM repair is now limited to clearly provable historical contamination only. The extension only prunes GM calls when old quota history explicitly shows a session’s recorded `poolModels` contained models that do not belong to that model’s real pool, avoiding accidental removal of valid current-cycle counts before archive.
  启动时的 GM 修理逻辑已收窄为“仅处理有明确证据的历史污染”。只有当旧 quota 历史明确记录某条 session 的 `poolModels` 混入了不属于该真实额度池的模型时，扩展才会剪掉对应的旧 GM 调用，避免在归档前误清正常的当前周期计数。

### ✅ Tests / 测试

- Expanded `quota-tracker.test.ts` again to cover shared-pool representative stability and dirty active-session sanitization, including the case where a previously tracking pool member must remain the representative so `resetTime`-based archival still triggers correctly.
  继续扩展 `quota-tracker.test.ts`，覆盖共享额度池代表稳定性和脏 active session 自愈，特别是“已在 tracking 的池成员必须继续保留代表位，才能正确触发基于 `resetTime` 的归档”这一场景。

- Added pool-regression coverage so Gemini Flash and Gemini Pro remain separate even when their `resetTime` happens to be identical, and expanded GM tracker tests to verify only historically contaminated residual calls are repaired during startup.
  新增额度池回归测试，确保 Gemini Flash 与 Gemini Pro 即使 `resetTime` 完全相同也仍然分池；同时扩展 GM Tracker 测试，验证启动时只会修理历史污染留下的残留调用，不会误删当前周期的正常计数。

### ✨ Added / 新增

- **Model Tab + Persistent Model DNA / 模型标签页与持久化模型 DNA**: Added a dedicated `Models / 模型` tab to centralize model-related information. Personal model quota, default model, and GM-derived model DNA are now grouped together instead of being scattered across `Profile` and `Pricing`. Model DNA is now persisted independently from quota-cycle archives: static fields such as `responseModel`, provider, completion config, tool count, prompt sections, and system-prompt availability remain visible after archive, while current-cycle counters like calls, steps, credits, retries, and errors still reset normally with the quota cycle.
  新增独立的 `模型` 标签页，把模型相关信息集中起来展示。个人模型配额、默认模型和 GM 推导出的模型 DNA 不再分散在 `个人` 和 `价格` 页面里。模型 DNA 现在也会独立持久化：`responseModel`、提供商、completion config、工具数、prompt 分段、是否有 system prompt 这类静态信息在归档后仍然保留；而调用数、步骤数、积分、重试、错误等当前周期动态值仍然会随着额度归档正常清零。

- **Archive / GM Troubleshooting Map / 归档与 GM 排障地图文档**: Added a new document [docs/archive_gm_troubleshooting.md](docs/archive_gm_troubleshooting.md) to explain archive triggers, GM cycle boundaries, per-page data scope differences, related persisted state keys, and a symptom-to-module troubleshooting map for faster diagnosis of quota and GM issues.
  新增排障文档 [docs/archive_gm_troubleshooting.md](docs/archive_gm_troubleshooting.md)，专门说明归档触发链路、GM 当前周期边界、各页面口径差异、相关持久化键以及“出现什么现象该优先查哪个模块”的排障地图，方便后续快速定位额度和 GM 相关问题。

### Changed / 变更

- **Tab Order and Naming Cleanup / 标签页顺序与命名整理**: Reordered the main panel tabs to match daily usage priority: `Monitor → GM Data → Cost → Models → Quota Tracking → Calendar → Profile → Settings`. Renamed `Pricing / 价格` to `Cost / 成本` to better reflect that the page includes both estimation and editable pricing, and renamed `Quota / 额度` to `Quota Tracking / 额度追踪` to distinguish it from the current model quota cards now shown in the `Models` tab.
  重新整理主面板的标签页顺序，按日常使用频率调整为：`监控 → GM 数据 → 成本 → 模型 → 额度追踪 → 日历 → 个人 → 设置`。同时把 `价格` 改名为 `成本`，更贴合“费用估算 + 单价编辑”这页的实际内容；把 `额度` 改名为 `额度追踪`，避免与 `模型` 页里展示的当前模型配额卡片混淆。

- **Models Tab UI Cleanup / 模型页界面收口**: Simplified the new `Models` tab so it reads like product UI instead of a diagnostics console. Model quota cards now focus on quota and reset timing only, while MIME capability evidence was moved into the `Model Info / 模型信息` cards as expandable details. `Model DNA / 模型 DNA` was renamed to `Model Info / 模型信息`, the dense chip-style metadata strip was removed, raw model IDs were removed from quota cards, and low-value fields were collapsed into a `Technical Params / 技术参数` details section.
  继续收口新的 `模型` 标签页，让它更像产品界面而不是调试面板。模型配额卡片现在只关注额度和重置时间；MIME 能力证明已移到 `模型信息` 卡里，并通过可展开明细展示。`模型 DNA` 更名为 `模型信息`，移除了那排密集的气泡元数据，模型配额卡也不再展示原始模型 ID，低价值技术参数统一收进 `技术参数` 折叠区。

### 🐛 Fixed / 修复

- **Checkpoint Ghost Models Removed from GM Data Surface / GM 数据页不再暴露 CHECKPOINT 幽灵模型卡片**: Removed the `Sub-Agent Tokens / 子智能体消耗` card group from the GM Data tab. Those cards were primarily surfacing internal checkpoint-related models such as `MODEL_PLACEHOLDER_M50` and `MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE`, which are useful for low-level diagnostics but confusing in the main UI because they look like normal user-facing models and can be mistaken for archive residue or quota bugs.
  从 GM 数据页移除了 `子智能体消耗` 卡片组。那组卡片主要暴露的是 `MODEL_PLACEHOLDER_M50`、`MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE` 这类 CHECKPOINT 内部模型；它们适合低层排障，不适合直接作为主界面的用户可见模型卡展示，否则很容易被误解成正常模型调用、归档残留或额度异常。

- **Model Info Details Stay Open Across Auto-Refresh / 模型信息折叠项不再因自动刷新收起**: Added stable detail IDs for the `MIME Types` and `Technical Params` sections so WebView incremental refresh can restore their expanded state correctly instead of collapsing them after every `updateTabs` render.
  给 `MIME 类型` 和 `技术参数` 两个折叠区补上了稳定的 detail ID。这样 WebView 在 `updateTabs` 增量刷新后可以正确恢复展开状态，不会再每次自动刷新都把它们收起来。

- **Duplicate Model Cards Merged by Stable DNA Key / 模型信息重复卡片归并**: Tightened model-DNA key normalization so known models are keyed by stable internal model identity first, rather than allowing history to keep separate entries for display name, placeholder ID, and `responseModel`. This prevents the `Models` tab from showing duplicated “current + cached” cards for the same model after restore.
  收紧了模型 DNA 的 key 归一化逻辑。已知模型现在优先按稳定内部模型身份归并，不再让历史状态同时保留显示名、占位 ID 和 `responseModel` 三套 key。这样恢复状态后，`模型` 页就不会再把同一模型拆成“当前 + 已缓存”两张重复卡片。

### ✅ Tests / 测试

- Added `model-dna-store.test.ts` to lock the new persistence semantics: model DNA remains available after archive even when the current-cycle GM summary becomes empty, while the live counters still follow the active quota cycle.
  新增 `model-dna-store.test.ts`，锁定新的持久化语义：即使归档后当前周期 GM 汇总已经为空，模型 DNA 仍然保留；而实时计数继续跟随当前额度周期。

### Changed / 变更

- **Monitor Tab Upgraded from Session View to Overview Dashboard / 监控页从会话页升级为总览仪表盘**: Reworked the `Monitor / 监控` tab into a real overview surface instead of a quota-only landing page. The top section now combines four concise summaries: model quota health, GM totals, cost snapshot, and quota-tracking status, while the current session and other-session sections remain below. This makes the first tab answer the core questions immediately: "what am I using now, how much have I called, how much did it cost, and which quotas are still active?"
  将 `监控` 页从“只看配额和当前会话”的入口重组为真正的总览仪表盘。顶部现在集中展示模型配额、GM 总览、成本快照和额度追踪状态，下面再接当前会话与其他会话。这样首页就能直接回答最关键的几个问题：现在在用什么、这一周期调用了多少、花了多少、哪些额度还在追踪。

- **Quota Overview Simplified / 配额概览改成关键信息首页卡**: Removed the old `Details / 详情` 跳转按钮 and replaced the previous one-line quota pills with a denser quota-health card. The monitor page now shows all visible models directly, highlights the current model, lowest remaining model, and nearest reset, and keeps each model's reset countdown inside the card instead of pushing the user elsewhere for basic quota awareness.
  移除了旧的 `详情` 跳转按钮，把原来一排轻量 pill 的配额区改成更适合首页的关键信息卡。监控页现在会直接展示全部模型，突出当前模型、最低剩余额度模型和最近重置模型，并把每个模型自己的重置倒计时直接放进卡片里，不再要求用户为了看基础配额信息反复跳页。

- **Mini GM Summary + Dense Model Call Grid / GM 总览补充模型调用分布**: Added a compact GM overview card with calls, input, output, thinking, cache hit rate, and average TTFT, then filled the previously empty lower area with a dense top-4 model call grid. Each mini card now shows the model name, call count, and call-share percentage so the monitor page exposes useful GM trends without requiring users to jump into the full `GM 数据` tab for every glance.
  新增 GM 总览卡，集中显示调用、输入、输出、思考、缓存命中率和平均 TTFT；同时把原来偏空的下半区补成前四模型调用分布。每个小卡会展示模型名、调用次数和调用占比，让 `监控` 页也能承担 GM 趋势总览，而不是每次都要切去完整的 `GM 数据` 页。

- **Cost Snapshot Now Uses Total-Cost Share / 成本速览改成按总成本占比展示**: The cost list in the monitor tab no longer uses a "relative to the most expensive model" progress bar, which looked visually full even when the real share was much smaller. Bars now represent each model's share of the total cycle cost, and each row shows the model's call count, total-cost percentage, and final USD estimate. This makes the mini cost panel behave like a real bill summary rather than an ambiguous ranking strip.
  监控页里的成本列表不再使用“相对最高成本模型”的进度条，那种条宽会让用户误以为某个模型几乎占满总成本。现在每条进度条都表示“占本周期总成本的比例”，并在同一行直接展示调用次数、成本占比和美元估值，让这块更像真正的账单摘要，而不是语义模糊的排行榜。

- **Quota Tracking Snapshot Redesigned / 追踪快照重做为全宽状态卡**: The quota-tracking summary is no longer reduced to a single "lowest remaining" number. It has been redesigned as a full-width active-tracking card that lists each currently tracked model with status, remaining percentage, elapsed tracking time, reset countdown, and absolute reset time. This makes the monitor page much more useful for judging whether tracking is alive and whether archive timing still looks sane.
  `追踪快照` 不再只剩一个“最低剩余比例”数字，而是重做成一张全宽的活跃状态卡。现在它会列出每个正在追踪的模型，包含状态、剩余百分比、已追踪时长、重置倒计时和绝对重置时间，更适合在首页判断追踪系统是否在正常工作、归档节奏是否合理。

## [1.13.8] - 2026-03-26

### ✨ Added / 新增

- **Sticky TopBar — Fixed Navigation & Info Chips / 固定顶部栏 — 导航与信息容器化**: Consolidated header, three information banners (GitHub, multi-window notice, data disclaimer), and the capsule tab bar into a single `position: sticky` top container (`.panel-topbar`). The tab bar is now always visible during scrolling, enabling instant tab switching at any scroll depth. Fixed-area vertical footprint reduced from ~172px to ~92px (−47%).
  将标题栏、三个信息横幅（GitHub、多窗口提示、数据声明）和胶囊 Tab 栏合并进一个 `position: sticky` 的固定顶部容器（`.panel-topbar`）。Tab 栏在滚动时始终可见，任意深度均可即时切换标签。固定区垂直占用从 ~172px 降至 ~92px（−47%）。

- **Info Chips with Dropdown Panels / 信息胶囊与下拉面板**: Three banners compressed into compact chip buttons (`[GitHub ↗]` `[⚠ 提示]` `[ℹ 声明]`). Clicking a chip toggles its dropdown panel with mutually exclusive behavior (opening one auto-closes others). Expanded state persisted via `vscode.setState()` to survive auto-refresh and tab switches.
  三个占位横幅压缩为水平排列的信息胶囊按钮。点击展开/收起对应下拉面板，互斥逻辑确保同时只展开一个。展开状态通过 `vscode.setState()` 持久化，自动刷新和标签切换都不丢失。

- **Frosted Glass & Scroll Shadow / 毛玻璃与滚动阴影**: TopBar background uses `backdrop-filter: blur(16px)` with 92% opacity for frosted glass translucency. A subtle bottom shadow (`.scrolled` class) appears when `scrollY > 8px`, reinforcing the visual separation between fixed header and scrolling content.
  顶部栏背景使用 `backdrop-filter: blur(16px)` + 92% 透明度实现毛玻璃质感。滚动超过 8px 时底部出现柔和阴影（`.scrolled` 类），增强固定栏与滚动内容的视觉层级。

### 🐛 Fixed / 修复


- **Quota Tracker No Longer Assumes Another Pool's Window / 额度追踪不再误借别的池周期**: Removed the old "borrow the max `timeToReset` across all 100% models" behavior when backdating tracking start time. This could incorrectly project a short-window model or pool onto a different provider's longer window. `quota-tracker.ts` now only trusts the same model/pool's previously learned full-window duration (`knownWindowMs`), and otherwise falls back to conservative official `resetTime` observation instead of inventing a 5-hour-style start point.
  移除旧的“拿所有 100% 模型里最大的 `timeToReset` 来回推起点”的行为。旧逻辑会把别的 provider / 别的额度池的周期误套到当前模型上。现在 `quota-tracker.ts` 只使用同模型 / 同池已学到的完整窗口长度（`knownWindowMs`）；若没有可靠窗口，则保守依赖官方 `resetTime` 观测，不再伪造类似固定 5 小时的起点。

- **0% Rebound Handling / 0% 回弹处理**: A session that reaches `0%` is no longer locked into a stale completed state. If the service later reports quota rising again (for example `0% → 20%`) before the quota cycle truly ends, the tracker now clears the completed marker and resumes active tracking instead of splitting or corrupting the session.
  达到 `0%` 的会话不再被永久锁死在已完成状态。如果服务端在额度周期真正结束前又返回更高额度（例如 `0% → 20%`），追踪器现在会清除 completed 标记并恢复活跃追踪，避免会话拆裂或统计损坏。

- **Monitor Lifetime Call Counter Survives Rewind / Monitor 累计调用数不再随回退倒退**: Added per-conversation `lifetimeCalls` to GM conversation data and surfaced it in the Monitor tab. The current branch's call count may still shrink after rewind, but the new lifetime counter preserves cumulative usage history so users can distinguish "current visible calls" from "all calls ever made in this conversation".
  为 GM 对话数据新增 `lifetimeCalls`，并在 Monitor 标签页中展示。回退后当前分支调用数仍可能变少，但新增的累计调用数会保留整个对话历史中的总调用量，让用户能够区分“当前可见调用”和“历史累计调用”。

- **Reset Time Display Now Includes Date Context / 重置时间显示补上日期语义**: Reset UI no longer renders long-window resets as a misleading bare clock like `09:05`. Status bar, Profile, and Quota Tracking views now format reset information as countdown plus local date/time, e.g. `1d19h (03/28 09:05)`, making long rolling windows immediately understandable.
  重置时间显示不再把长周期重置渲染成容易误解的裸时分，例如 `09:05`。状态栏、Profile 和 Quota Tracking 现在统一显示为“倒计时 + 本地日期时间”，例如 `1d19h (03/28 09:05)`，长滚动窗口的语义更直观。

- **Recent Activity Late-Fill Recovery / 最近操作补票恢复**: Fixed a timeline gap where some models could surface a `PLANNER_RESPONSE` step before its final `response/modifiedResponse` text was filled in. The old tracker advanced `processedIndex` immediately, skipped the empty step, and never revisited it if `stepCount` stayed unchanged, causing user anchors to appear without the matching AI reply. `activity-tracker.ts` now keeps a short-lived pending set for empty planner steps, re-scans the visible tail even when `stepCount` does not grow, and repairs late-filled responses in place. This is model-agnostic and applies to any provider that emits placeholder planner steps first, although it was most visible on Gemini Pro conversations.
  修复“最近操作”时间线漏记问题：某些模型会先暴露 `PLANNER_RESPONSE` 步骤，再晚一点补上最终 `response/modifiedResponse` 文本。旧逻辑会立刻推进 `processedIndex`，把这个空步骤跳过；如果之后 `stepCount` 没变化，就永远不会回头补，结果表现为用户锚点已经出现，但对应 AI 回复缺失。现在 `activity-tracker.ts` 会为这类空 planner step 维护一个短生命周期的待补集合，并在 `stepCount` 不增长时也重扫可见尾部，把后补完成的回复原位修复。该修复是模型无关的，适用于任何先发占位 planner step、后补正文的 provider，只是此前在 Gemini Pro 对话里最明显。

- **Deterministic Recent-Activity Ordering / 最近操作确定性排序**: Added a render-time fallback sort in `activity-panel.ts` using `timestamp → stepIndex → source` so restored state, GM enrichment, and late repairs cannot accidentally shuffle the timeline order. The view remains a debugging-oriented execution timeline, but row order is now stable even when events are patched after the first render.
  在 `activity-panel.ts` 中新增渲染前兜底排序，按 `timestamp → stepIndex → source` 做确定性排序。这样即使遇到持久化恢复、GM 富化或后补修复，时间线也不会因为事件晚到而发生偶发乱序。视图仍然保持调试型执行时间线语义，但顺序更稳定。

- **Recent Activity Stale-Row Cleanup / 最近操作失效旧行清理**: Fixed another timeline corruption case where a later poll could insert internal non-rendered steps (such as image-generation or ephemeral system steps) before a final planner response, shifting the visible step numbers. The old repair logic added the new rows but failed to delete the obsolete reasoning row that previously occupied that `stepIndex`, making Claude conversations appear to "send the same AI message twice". `activity-tracker.ts` now removes stale `step` events whenever a tail re-scan proves that a given `stepIndex` now belongs to a non-rendered internal step. This is the same model-agnostic repair path used for step reordering, not a Claude-only special case.
  修复另一种“最近操作”时间线损坏场景：后续轮询可能会在最终 planner response 之前插入图片生成或系统瞬时消息等内部步骤，导致可见 `stepIndex` 重新排列。旧的修复逻辑只会补入新行，却不会删掉原本占据该 `stepIndex` 的旧推理行，于是 Claude 对话里会看起来像“同一句 AI 回复发了两次”。现在 `activity-tracker.ts` 在尾部重扫时，如果确认某个 `stepIndex` 现在属于不该渲染的内部步骤，就会主动移除对应的失效 `step` 事件。该修复走的是同一套模型无关的 step 重排修复路径，不是只对 Claude 特判。

- **Cross-Language Model Bucket Merge / 跨语言模型桶合并**: Fixed a persistence bug where Activity and GM summaries used localized display labels as internal keys. If stats were saved in English and later restored in Chinese (or vice versa), the same model could split into parallel buckets such as `Gemini 3.1 Pro (High)` and `Gemini 3.1 Pro (强)`, causing duplicate model cards and incomplete per-pool archival on quota reset. The tracker now normalizes `modelId / English label / Chinese label / bilingual label` to one canonical current-language display name before aggregation, restore, cache reuse, and archive filtering.
  修复 Activity / GM 汇总把本地化显示名直接当内部 key 的持久化问题。如果一段统计在英文模式保存、随后在中文模式恢复（或反之），同一模型会被拆成并行桶，例如 `Gemini 3.1 Pro (High)` 和 `Gemini 3.1 Pro (强)`，表现为模型卡片重复、额度重置时只归档其中一份。现在追踪器会在聚合、恢复、缓存复用和归档过滤前，把 `modelId / 英文名 / 中文名 / 双语名` 统一归一到当前语言下的唯一显示名。

### ✅ Tests / 测试

- Added `reset-time.test.ts` to lock the new reset-time formatting behavior and expanded `quota-tracker.test.ts` to cover `0%` completion persistence, genuine reset archival, and rebound recovery.
  新增 `reset-time.test.ts` 锁定新的重置时间格式化行为，并扩展 `quota-tracker.test.ts`，覆盖 `0%` 完成态保持、真实 reset 归档，以及额度回弹恢复追踪。

- Added `activity-tracker.test.ts` coverage for late-filled planner responses: one case verifies that an empty planner step is repaired when the same `stepIndex` later gains a real response without `stepCount` growth, and another verifies that short restored conversations self-heal on the next poll.
  新增 `activity-tracker.test.ts`，覆盖延迟补全文本的 planner response：一条用例验证同一 `stepIndex` 在 `stepCount` 不增长的情况下后补正文时可被修复，另一条验证短对话在恢复持久化状态后会于下一轮轮询自动自愈。

- Expanded `activity-tracker.test.ts` again to cover step-index shifts caused by later insertion of internal non-rendered steps. The test asserts that stale reasoning rows are removed and only the final, still-valid response remains visible in the timeline.
  继续扩展 `activity-tracker.test.ts`，覆盖“后续插入内部不可渲染步骤导致 stepIndex 重排”的场景。测试会断言旧的推理残留行会被清掉，时间线中只保留最终仍然有效的那条响应。

- Added cross-language restore regression coverage for model-key normalization: Activity restore now merges English and Chinese historical buckets into the current-language model card, and `gm-tracker.test.ts` verifies that restored GM summaries no longer surface duplicate model cards after language switching.
  新增跨语言恢复回归测试：Activity 恢复态现在会把英文/中文历史桶合并到当前语言模型卡片中，`gm-tracker.test.ts` 也会验证语言切换后恢复出来的 GM 汇总不再冒出重复模型卡片。

## [1.13.7] - 2026-03-26

### ✨ Added / 新增

- **Capsule Tab Bar with Color Themes / 胶囊彩色 Tab 导航栏**: Replaced the flat underline tab bar with a pill-shaped capsule container featuring a sliding indicator. Each tab has a unique theme color (Monitor=blue, Profile=green, GM Data=orange, Pricing=purple, Calendar=cyan, Quota=yellow, Settings=gray). The slider smoothly transitions between tabs with spring easing (`cubic-bezier(.34,1.56,.64,1)`) and its color dynamically follows the active tab's theme via CSS custom properties (`--tab-c`, `--slider-c`).
  将平面下划线 Tab 栏重构为胶囊容器 + 滑动指示器。7 个 Tab 各有专属主题色（监控=蓝、个人=绿、GM 数据=橙、价格=紫、日历=青、额度=黄、设置=灰）。滑块使用弹簧缓动平滑过渡，颜色通过 CSS 自定义属性动态跟随当前 Tab。

- **Heartbeat Animation / 心跳动画**: Added a pulsing heart icon (`ICON.heart`) with a double-peak CSS `@keyframes heartbeat` animation (1.4s cycle) to the GitHub support banner. The animation mimics a natural cardiac rhythm using `transform: scale()` keyframes.
  在 GitHub 支持横幅末尾新增心跳心形图标，使用双峰 `scale()` 关键帧模拟自然心跳节律。

- **Star Twinkle Animation / 星星闪烁动画**: Added a breathing `@keyframes starTwinkle` animation (2.4s cycle) to the star icon, using `opacity` and `transform: rotate()` oscillation. The desynchronized rhythm (1.4s vs 2.4s) prevents mechanical synchronization with the heartbeat.
  为星标图标添加呼吸式闪烁动画，与心跳节律刻意错开避免机械同步。

### Changed / 变更

- **Quota Tab Label Shortened / 额度 Tab 标签精简**: "Quota Tracking / 额度追踪" shortened to "Quota / 额度" for better fit in the capsule tab bar.
  "额度追踪"精简为"额度"以适配胶囊 Tab 栏宽度。

### Accessibility / 无障碍

- All new animations include `@media (prefers-reduced-motion: reduce)` overrides to disable motion for users who prefer reduced motion. Tab slider transition is also disabled under this preference.
  所有新增动画均包含 `prefers-reduced-motion` 降级，关闭运动偏好时禁用动画。胶囊滑块过渡同样在此偏好下禁用。

### 🐛 Fixed / 修复

- **Quota Tracker "Resurrection" Bug / 额度追踪"回光返照"问题**: Fixed a critical bug where reaching 0% immediately archived the session and entered a `done` state. If the API subsequently reported the fraction bouncing back (e.g., to 20%), the data would split and corrupt. Now, 0% only marks the session as `completed` while tracking continues until the actual quota cycle ends (detected via `cycleResetTime`).
  修复额度到 0% 后立即归档导致的"回光返照"数据分裂问题。现在 0% 仅标记完成，继续追踪直到周期实际结束。

- **Quota Tracker Stale "Tracking..." Bug / 额度追踪永久"追踪中"问题**: Fixed a bug where sessions stayed stuck in "追踪中" forever. Root cause: `lastResetTime` was overwritten every poll cycle, so if the API's `resetTime` transitioned from T1→T2 between two polls, the old value was lost and cycle-end could never be detected. Introduced `cycleResetTime` (locked at tracking start) as the immutable anchor for cycle-end detection.
  修复追踪永远卡在"追踪中"的问题。根因：`lastResetTime` 每次 poll 被覆盖。新增 `cycleResetTime` 锁定入场时的重置时间作为周期结束判定锚点。

- **Clear Active Tracking Button Not Responding / 清理按钮无响应**: The button lost its event listener after incremental poll updates (`innerHTML` swap). Added re-bind logic in the `updateTabs` message handler.
  清理按钮在增量刷新后失去事件监听器。在 `updateTabs` 处理中添加了事件重绑定。

- **Zoom Level Not Persisted / 界面缩放无法保存**: Fixed zoom settings being lost when the panel was closed or the extension was restarted. Previously stored only in webview-internal state (`vscode.getState()`), which is volatile. Now persisted to `DurableState` file (`%APPDATA%/Antigravity Context Monitor/state-v1.json`), surviving panel close, extension reload, VS Code updates, and even uninstall/reinstall.
  修复界面缩放设置关闭面板后丢失的问题。原先仅存 webview 内存态，现通过 `DurableState` 持久化到文件系统，卸载重装也不丢。

### ✨ Added / 新增 (cont.)

- **Clear Active Tracking Button / 清理活跃追踪按钮**: Added a "Clear" button next to the "Active Tracking" section header. Resets all tracking states without clearing archived history, useful for troubleshooting stuck sessions.
  在"活跃追踪"标题旁新增清理按钮。仅重置追踪状态，不清归档历史。

- **GM Data Scope Note / GM 数据范围说明**: Added a collapsible "Data Scope" info panel at the top of the GM Data tab. Explains that metrics accumulate per quota cycle (not per-session or per-day) and that each model pool (e.g., Claude+OSS vs Gemini Pro) resets independently.
  在 GM 数据 Tab 顶部新增可折叠「数据范围」说明，解释统计周期为额度周期且各模型池独立重置。

### Architecture / 架构

- **Eliminated `done` state from quota tracker**: Simplified state machine from `idle→tracking→done` to `idle→tracking→(archive)→idle`. Legacy `done` states are auto-migrated to `idle` on extension load.
  废除额度追踪的 `done` 状态。旧 `done` 状态在加载时自动迁移为 `idle`。

- **Extracted `startTracking()` helper**: Deduplicated 3 identical session-creation code paths into a single `startTracking()` method.
  提取 `startTracking()` 方法，合并 3 处重复的 session 创建逻辑。

- **Added `isCycleEnded()` method**: Centralizes cycle-end detection logic: (a) `cycleResetTime` has passed, or (b) API `resetTime` jumped >30 min.
  新增 `isCycleEnded()` 方法统一周期结束判定。

## [1.13.6] - 2026-03-25

### ⚡ Refactored / 重构

- **Unified Polling Loop / 轮询机制统一化**: Eliminated the redundant dual-loop polling architecture (`pollContextUsage` 5s + `pollActivity` 3s) and merged all data collection into a single global loop. Reduces `getAllTrajectories()` RPC calls from ~8 to ~3 per 15-second window, eliminating UI flickering caused by double WebView refreshes. Activity data processing now reuses the trajectory cache from the main poll instead of making independent RPC calls.
  消除了冗余的双轮询架构（`pollContextUsage` 5s + `pollActivity` 3s），将全部数据采集合并至单一全局循环。15 秒内 `getAllTrajectories()` RPC 调用从约 8 次降至约 3 次，消除了双重 WebView 刷新导致的 UI 闪烁。Activity 数据处理复用主轮询已获取的 Trajectory 缓存。

- **Dead Code Removal / 死代码清理**: Removed `activityPollingTimer`, `activityPollGeneration`, `isActivityPolling`, `pollActivity()`, `scheduleActivityPoll()` and a non-existent `statusBar.registerModelAliases()` call that was a latent compile risk.
  移除 `activityPollingTimer`、`activityPollGeneration`、`isActivityPolling`、`pollActivity()`、`scheduleActivityPoll()` 及不存在的 `statusBar.registerModelAliases()` 调用。

### Changed / 变更

- **Compression Warning Threshold Default / 压缩警告阈值默认值**: Lowered default `compressionWarningThreshold` from **200K** to **150K** tokens. Antigravity does not utilize the full 1M context window; actual effective context is roughly 128K–200K.
  默认压缩警告阈值从 **200K** 降至 **150K** Token。Antigravity 未适配 1M 上下文窗口，实际有效上下文大致 128K–200K。

- **Data Disclaimer Enhancements / 数据声明优化**:
  - Added `▸` indicator to "Click to expand" text for clearer interactive affordance.
    "点击展开详情"增加 `▸` 指示符，提升可点击感知。
  - Added **Context Window Limitation** section: documents that the effective context is ~128K–200K, not the model's nominal 1M.
    新增**上下文窗口限制**说明段落。
  - Added **Language Switching** hint: directs users to the 中文 | EN | 双语 buttons in the top-right corner.
    新增**语言切换**提示，指引用户使用面板右上角的语言按钮。

- **Status Bar Tooltip Enhancement / 状态栏提示增强**: The "Click to view details" line at the bottom of all tooltip variants (no conversation, idle, active) now renders with a `$(link-external)` icon, separator line, and **bold** Markdown formatting, making the clickable action immediately obvious.
  所有 tooltip 场景底部的"点击查看详情"现在带有 `$(link-external)` 图标、分隔线和**加粗** Markdown 格式，让可点击操作一目了然。

## [1.13.5] - 2026-03-24

### Fixed / 修复

- **🔥 Workspace ID Mismatch for Paths with Special Characters / 含特殊字符路径的工作区 ID 不匹配**: Fixed critical bug where `buildExpectedWorkspaceId()` called `decodeURIComponent()` before constructing the workspace ID, but the Language Server builds workspace IDs from the **raw** (percent-encoded) URI. For paths containing spaces (e.g., `linux%20do/final/test`), the extension produced `linux do` (with space) while the LS produced `linux_20do` (percent sign replaced by underscore, preserving the `20` digits). This mismatch caused `selectMatchingProcessLine()` to fail, making LS discovery permanently fail for any workspace path containing spaces, parentheses, or other special characters. Fix: removed `decodeURIComponent()` and replaced individual character substitutions (`/`, `-`, `%`) with a single catch-all regex `[^a-zA-Z0-9_]` → `_`, exactly mirroring the LS's workspace ID generation behavior. This comprehensively handles all special characters and prevents future mismatches.
  修复严重 Bug：`buildExpectedWorkspaceId()` 在构建工作区 ID 前调用 `decodeURIComponent()`，但语言服务器基于**原始**（百分号编码）URI 构建工作区 ID。路径含空格时（如 `linux%20do/final/test`），扩展生成 `linux do`（带空格），而 LS 生成 `linux_20do`（`%` 替换为 `_`，保留 `20` 数字）。此不匹配导致 `selectMatchingProcessLine()` 失败，使所有路径含空格、括号等特殊字符的工作区永久无法发现 LS。修复：移除 `decodeURIComponent()`，用通配正则 `[^a-zA-Z0-9_]` → `_` 替代逐字符替换，精确镜像 LS 的工作区 ID 生成行为，一次性覆盖所有特殊字符。

### Tests / 测试

- Added 4 new tests for `buildExpectedWorkspaceId()` in `discovery.test.ts`: percent-encoded spaces (`%20` → `_20`), multiple percent-encoded characters, parentheses/special chars, and `vscode-remote://` URIs.
  在 `discovery.test.ts` 中新增 4 个 `buildExpectedWorkspaceId()` 测试：百分号编码空格（`%20` → `_20`）、多个百分号编码字符、括号等特殊字符、`vscode-remote://` URI。

## [1.13.4] - 2026-03-24

### Added / 新增

- **Interface Zoom Control / 界面缩放控件**: New zoom control card in the Settings tab allows users to scale all WebView content (text, icons, spacing) from 60% to 150%. Features 6 preset buttons (80%–130%) and a fine-grained range slider (step 5%). Zoom level is persisted in WebView State (`vscode.getState()`) — survives poll refreshes, tab switches, language changes, and panel hide/reveal. Implementation uses CSS `zoom` on `<body>` (native Chromium support). New `ICON.zoom` (magnifier-plus SVG) and `data-accent="zoom"` purple accent (`#a78bfa`). Custom range slider thumb with hover scale animation and focus-visible ring.
  设置标签页新增界面缩放控件卡片，支持 60%–150% 等比缩放面板全部内容（文字、图标、间距）。6 个预设按钮（80%–130%）+ 精细 range 滑块（步进 5%）。缩放级别通过 WebView State 持久化，轮询刷新、标签切换、语言变更、面板隐藏/显示均不丢失。底层使用 CSS `zoom`（Chromium 原生支持）。新增 `ICON.zoom` 放大镜 SVG 图标和紫色 accent 主题色。自定义滑块 thumb 含 hover 缩放动画和 focus-visible 光环。

- **GitHub Project Banner / GitHub 项目链接**: Added an info banner above the data disclaimer crediting the original author (**AGI-is-going-to-arrive**) with a direct link to the GitHub repository. Includes an inline star icon as a gentle encouragement for users to support the project. New `ICON.externalLink` SVG icon. Styled with green accent border (`--color-ok`) and a compact link button with hover/focus/active states. Full light-theme overrides included.
  在数据声明上方新增 GitHub 项目信息条，署名原作者 **AGI-is-going-to-arrive** 并提供仓库直链。内联星标图标温和引导用户支持项目。新增 `ICON.externalLink` SVG 图标。绿色主题色边框 + 紧凑外链按钮（含 hover/focus/active 三态）。包含完整亮色主题覆盖。

- **Multi-Window Usage Warning / 多窗口使用提示**: Added an amber-toned info banner recommending single-window usage. Multi-window setups may cause data desync between extension instances (activity timeline, quota tracking, etc.). New `ICON.windows` SVG icon. Styled consistently with the GitHub banner using the `.info-banner` base class.
  新增琥珀色调信息条，建议用户使用单窗口运行。多窗口可能导致扩展实例间数据不同步（活动时间线、额度追踪等）。新增 `ICON.windows` SVG 图标。与 GitHub banner 共用 `.info-banner` 基础样式。

- **Daily Aggregation Summary / 每日跨周期聚合汇总**: `webview-calendar-tab.ts` now merges all quota cycles for a single day into a unified summary card. Per-model stats (reasoning, toolCalls, errors, estSteps, tokens) are summed across cycles; GM stats (calls, credits, tokens) are summed with TTFT and cache hit rate computed as call-weighted averages. When a day has >1 cycle, individual cycle cards collapse into a `<details>` element; single-cycle days render inline.
  日历日详情面板新增跨周期聚合：同一天的所有配额周期按模型合并统计，TTFT 和缓存率使用调用数加权平均。多周期时原始卡片折叠到 `<details>` 中。

- **Top Summary Bar Enhancements / 顶部汇总栏增强**: Added GM Calls, weighted-average Cache Hit Rate, and Errors (red) to the day summary bar. Token display now prefers GM token totals (precise per-call API data) over Activity Tracker estimates when available — fixes the 139.6k → 6.5M discrepancy.
  顶部汇总栏新增 GM 调用数、加权缓存率、错误数。Token 优先使用 GM 精确数据替代 Activity 估算。

### Changed / 变更

- **Calendar Grid Compaction / 日历格子紧凑化**: Removed `aspect-ratio: 1` constraint from calendar cells, switching to compact `padding: var(--space-1) 0` layout. Significantly reduces vertical footprint.
  移除格子正方形约束，改紧凑 padding 布局，大幅减少垂直占用。

- **Font Size Uplift / 字体增大**: Systematically increased font sizes across all calendar labels, chips, and stat values (e.g., `0.7em` → `0.85em+`) for improved readability.
  系统性增大日历全部标签、chip、统计值的字号。

- **All-Time Summary Position / 历史汇总位置**: Moved "All-Time Summary" section to the top of the Calendar tab for immediate visibility on tab switch.
  历史汇总移至日历 Tab 顶部，切换即可见。

- **Inline Style Cleanup / 内联样式清理**: Migrated remaining inline `style="..."` attributes to dedicated CSS classes (`.cal-clear-section`, `.cal-cycle-stats-spaced`, `.cal-day-total-danger`, `.cal-cycles-details`, `.cal-cycles-summary`).
  内联样式提取为 CSS class。

- **WebView Theme Color Refactoring / WebView 主题配色重构**: Full removal of hardcoded purple (`#a78bfa`, `#8b5cf6`, etc.) across 5 source files (~30 sites). Replaced with functional semantic colors: Output→teal (`#2dd4bf`), Thinking/Context Growth→orange (`#f97316`), neutral labels→`var(--color-text-dim)`. Added comprehensive `body.vscode-light` overrides in `webview-styles.ts` (~25 selectors) and `webview-calendar-tab.ts` (~12 selectors) ensuring all GM chips, timeline tags, calendar chips, and disclaimer banner use high-contrast dark text (e.g., `#1d4ed8`, `#15803d`, `#92400e`) on light backgrounds. Dark theme AI response previews changed from blue `var(--color-accent)` to warm orange `#fb923c`.
  全面清除 5 个源文件中约 30 处硬编码紫色。替换为功能语义色：输出→青绿、思考/上下文增长→橙色、中性标签→灰色。在 `webview-styles.ts`（~25 选择器）和 `webview-calendar-tab.ts`（~12 选择器）中新增完整的 `body.vscode-light` 浅色主题覆盖，确保所有 GM chips、时间线标签、日历 chips 和数据声明在浅色背景上使用高对比度深色文字。深色主题 AI 回复预览从蓝色改为暖橙色。

- **Hover Theme-Awareness Fix / 悬浮效果主题适配修复**: Introduced `--color-border-hover` and `--color-surface-hover` CSS tokens with dark/light/high-contrast definitions. Replaced ~30 hardcoded `rgba(255,255,255,...)` hover styles across `webview-styles.ts` (15 selectors: `.card`, `.call-card`, `.compress-card`, `.ts-card`, `.collapsible`, `.model-card`, `.session-summary-row`, `.num-spinner-btn`, `.radio-row`, `.timeline-card`), `webview-calendar-tab.ts` (`.cal-nav-btn`, `.cal-cycle`, `.cal-cell`), and `pricing-panel.ts` (`.prc-cost-card`, `.prc-edit-card`, `.prc-edit-input`, `.prc-btn`, `.prc-dna-field`, `.prc-viz-highlight`, `.prc-bar-track`, `.prc-section-tag`). Added 10 light-theme overrides for pricing-panel color tags. Fixes counter-intuitive behavior where card borders turned invisible/white on hover in light mode.
  新增 `--color-border-hover` / `--color-surface-hover` CSS token（暗色/浅色/高对比三套定义）。替换 `webview-styles.ts`（15 处）、`webview-calendar-tab.ts`（3 处）、`pricing-panel.ts`（11 处）中所有硬编码 `rgba(255,255,255,...)` 的 hover 样式。`pricing-panel.ts` 新增 10 条浅色主题覆盖。修复浅色模式下卡片 hover 边框变白/消失的反直觉效果。

- **Settings Panel Light Theme Fix / 设置面板浅色主题修复**: Replaced 8 hardcoded `rgba(255,255,255,...)` values with semantic tokens across Settings UI selectors (`.action-btn:hover`, `.num-spinner-btn`, `.preset-btn`, `.copy-btn`, `.storage-path-box`, `.storage-stat`). Added `--color-danger-border` / `--color-danger-surface` fallback tokens for `.danger-action`. Introduced 11 `body.vscode-light` overrides for `.toggle-track`, `.num-spinner`, `.threshold-input`, `.raw-json`, `.danger-action`, and `.storage-path-state` to ensure full light-theme readability.
  替换 8 处设置面板中硬编码 `rgba(255,255,255,...)` 为语义 token（`action-btn:hover`、`num-spinner-btn`、`preset-btn`、`copy-btn`、`storage-path-box`、`storage-stat`）。`danger-action` 边框改用 fallback token。新增 11 条 `body.vscode-light` 覆盖（toggle-track、num-spinner、threshold-input、raw-json、danger-action、storage-path-state），确保设置面板浅色主题全面可读。

- **Settings Panel UI Redesign / 设置面板 UI 重设计**: Introduced `.stg-card` card system replacing generic `.card` in Settings: colored left accent border (`::before`, 3px gradient), per-section data-accent attributes (10 colors: storage/warn/quota/poll/display/model/activity/privacy/history/debug), `.stg-header` with 28px circular icon background, `.storage-stat` upgrade (centered layout, hover translateY(-1px) + box-shadow, `--color-info` numerals), `.danger-action` refinement (font-weight 700, larger padding, border-radius). Full light-theme overrides for new components.
  新增 `.stg-card` 卡片系统替换设置面板的通用 `.card`：3px 彩色左边框装饰、10 种分区 accent 配色（data-accent 属性驱动）、28px 圆形图标背景 header、storage 统计卡片升级（居中 + hover 上浮 + 蓝色数值）、danger 按钮精修（更粗字重 + 更大内距 + 圆角）。浅色主题全面覆盖。

- **Privacy Mask Default-ON / 隐私遮罩默认开启**: Privacy mask now defaults to ON. Removed the Settings panel Privacy card and `privacy.defaultMask` configuration property from `package.json`. Hardcoded `data-privacy-default="true"` in panel body. Added `.privacy-hint` visible text below account info in Profile tab explaining how to toggle. Fixed incremental update (`updateTabs`) privacy restore bug: `!!privState.privacyMasked` returned `false` when state was `undefined` (user never clicked); now falls back to `data-privacy-default` attribute, matching initial-load logic.
  隐私遮罩现在默认开启。删除设置面板隐私卡片及 `package.json` 中 `privacy.defaultMask` 配置项。`data-privacy-default` 硬编码为 `"true"`。个人面板账户信息下方新增 `.privacy-hint` 常驻提示文字。修复增量刷新时遮罩丢失的 bug：`privacyMasked` 为 `undefined` 时 `!!undefined` = `false` 导致遮罩被移除，现在回退到 `data-privacy-default` 属性值，与初始加载逻辑一致。

### Changed / 变更

- **Sticky Current-Conversation Selection / 当前对话粘性保持**: `extension.ts` now keeps the already tracked cascade stable as long as it still exists, instead of letting unrelated conversations with step-count changes or newer timestamps steal the GM Data view. This reduces cross-conversation jumps in the monitor panel during parallel or resumed sessions.
  `extension.ts` 现在会尽量保持当前已跟踪对话，只要该对话仍然存在，就不会因为其他对话的步数变化或更新时间更近而轻易抢占 GM Data 视图，减少并行 / 恢复场景下的串对话问题。

- **Window-Outside Attribution Cleanup on Pool Reset / pool reset 时清理窗口外归属账本**: `activity-tracker.ts` now trims `_windowOutsideAttribution` during per-pool archival, removing or shrinking only the affected models' outside-window step attribution. This prevents archived pool data from leaking stale estimated steps back into active cycles after a reset.
  `activity-tracker.ts` 在 per-pool 归档时会同步清理 `_windowOutsideAttribution`，仅移除或收缩受影响模型的窗口外步数归属，避免已归档池的数据在下一周期继续污染活动统计。

- **Timeline Three-Zone Layout / 时间线三区布局**: Refactored timeline rows into fixed-left (time+stepIdx) / elastic-center (model+detail) / fixed-right (meta+GM+duration) layout with `text-overflow: ellipsis`. User rows now have a green dot indicator matching AI rows for visual alignment.
  重构时间线行为三区布局，用户行加绿色小圆点与 AI 行对齐。

- **Timeline Legend / 时间线图例**: Replaced `act-dist-note` with a collapsible `<details id="d-tl-legend">` table legend explaining 9 timeline elements. State persisted via existing `details[id]` restoration logic in webview-script.
  用可折叠表格图例替代静态说明，展开状态通过 webview 现有机制在 poll 刷新间保持。

- **Removed "Exact" Label / 移除"精确"标签**: Removed `act-tl-tag-exact` CSS and `buildMetaTags` rendering. Precision is conveyed through the legend.
  删除精确标签 CSS 和渲染逻辑。

- **Cache Token Label / 缓存 Token 标签**: Changed GM cache-read token suffix from `$` to `缓存` / `cache`.
  将缓存读取 token 后缀从 `$` 改为 `缓存`。

- **Timeline Legend UI Overhaul / 时间线图例 UI 全面升级**: Replaced `<table>` layout with flex-based `.act-tl-legend-row` card system. Groups wrapped in bordered+rounded containers with tinted header bars. Each row uses `.act-tl-legend-sample` (90px fixed) + `.act-tl-legend-desc` (fluid) two-column flex layout. Added hover highlight, border on info card and formula bar. Matches the card-based aesthetic of the information note.
  用 flex 行卡片系统替代 `<table>` 布局。分组容器加边框+圆角+着色标题栏。每行 90px 示例标签 + 流式说明文字双栏布局。新增 hover 高亮，信息卡片和公式条加外边框。与信息提示卡片的卡片化美学风格统一。

- **Monitor Panel Full Audit / 监控面板全面审查**: 
  1. **Remove absolutism** — Replaced all "精确/Precise/Exact" labels with "GM" branding or softer "实际/Exact" phrasing. i18n `preciseShort` → `GM`.
  2. **Soften data disclaimer** — Rewrote disclaimer banner: "precise per-call values" → "higher per-call fidelity", added "All numbers are best-effort approximations" / "所有数值均为尽力计算的近似值".
  3. **LLM Call Details newest-first** — Reversed call detail rendering so latest calls appear at top instead of bottom.
  4. **Call-row → call-card** — Replaced flat `.call-row` dividers with bordered `.call-card` cards featuring left accent border, hover highlight, and tag-chip stat layout (`.call-chip`).
  5. **Context X-ray children chip-ified** — Replaced dense comma-separated `breakdown-children` text with `.breakdown-chip` tag system: each child gets a pill with colored left border, name, token count, and percentage.
  6. **Other Sessions badge** — Changed `✓/精` source badge to unified `GM` for non-estimated sessions.
  7. **Default-collapsed expert blocks** — Wrapped Output Breakdown, Cache Efficiency, GM Stats, and Context X-ray in `<details>` (default collapsed). Users can expand at will.
  8. **Compression History redesign** — Replaced plain `detail-row` with `.compress-card` cards: left warn-color accent, before/after progress bar, token counts with arrow.
  9. **Timestamps redesign** — Replaced flat rows with a 2×2 `.ts-grid` of `.ts-card` icon cards. Each card shows SVG icon + uppercase label + value. Cascade ID moved to a separate bottom strip.

- **Pricing Panel Card Redesign / 价格面板卡片化重构**: Cost breakdown table replaced from 7-column table to responsive card grid. Edit pricing table replaced from wide table to 2-column field cards. Font sizes systematically increased (0.68→0.78em, 0.72→0.82em). All text labels bilingualized (legends, tooltips, column headers, badges). Remaining inline `style="..."` migrated to CSS classes.
  费用明细从 7 列表格改为响应式卡片网格；编辑定价从宽表改为双列字段卡片。字体整体增大。全部文本双语化（图例/tooltip/列头/badge）。内联样式提取为 CSS class。

- **Quota Tracking Tab UI Overhaul / 额度追踪 Tab UI 全面升级**:
  - **Session Cards / Session 卡片**: Left border coloring by state (active=blue, completed=green, reset=yellow). New horizontal progress bar (current%→0%, breathing animation when active). Meta row redesigned from plain text to chip-style (icon + background + border). Header switched to `space-between` layout.
  - **History Summary / 历史汇总**: New stats bar showing average duration, fastest, slowest, completed count, and reset count with flex-distributed layout.
  - **Timeline Enhancements / 时间线优化**: Vertical track changed to gradient (green→yellow→red, 0.4 opacity). Long timelines (>6 nodes) auto-collapse middle entries with "+N more" indicator. Font sizes increased (tl-content 0.82→0.88em, tl-time 0.9→0.92em).
  - **Motion / 动效**: `prefers-reduced-motion` degradation disables progress bar and pulse animations. Progress bar fill uses 0.4s transition.

  Session 卡片左边框按状态着色 + 水平进度条（呼吸动画）+ chip 式 meta 行；历史汇总新增统计栏（平均/最快/最慢/完成数/重置数）；时间线垂直轨道渐变色 + 长时间线自动折叠 + 字号增大；reduced-motion 降级关闭动画。

### Bug Fixes / 修复

- **Timeline Step Deduplication / 时间线步骤去重**: Fixed bug where `_injectTimelineEvent()` in `activity-tracker.ts` injected the most recent 20 steps on every `statusChanged` (IDLE→RUNNING) transition without checking for existing entries. Since `_pushEvent()` only performs `push` + `sort` with no dedup, this caused identical step events to accumulate in `_recentSteps`, producing duplicate AI and user entries in the "Recent Activity" timeline when scrolling down. Fix: added `cascadeId` + `stepIndex` + `source='step'` dedup guard at the entry of `_injectTimelineEvent()`.
  修复 `activity-tracker.ts` 中 `_injectTimelineEvent()` 在每次 `statusChanged`（IDLE→RUNNING）转换时无条件注入最近 20 步、且 `_pushEvent()` 仅 push+sort 无去重逻辑，导致相同步骤事件在 `_recentSteps` 中重复累积的 Bug。修复：在 `_injectTimelineEvent()` 入口添加 `cascadeId` + `stepIndex` + `source='step'` 去重检查。

- **Estimated Event Placeholder / 估算事件占位符**: Replaced hardcoded `等待 GM...` with `estimatedModel` variable.
  将硬编码占位符替换为 `estimatedModel` 变量。

- **Estimated Event Deduplication / 估算事件去重**: Resolved estimated events are now removed from `_recentSteps` after GM data covers them (`estimatedResolved` flag).
  GM 覆盖后通过 `estimatedResolved` 标志移除已解析的 estimated 事件。

- **GM User Anchor Deduplication / GM 用户锚点去重**: Added text-based deduplication for `gm_user` anchors (trimmed first 120 chars) preventing duplicate user message rows from different GM calls with different `stepIndex` offsets. Also filters anchors whose text matches existing `step`-source user events.
  添加基于文本的 anchor 去重和 step 用户消息去重。

- **GM Data Resolution Latency / GM 数据解析延迟**: `injectGMData()` now returns `boolean` indicating whether it modified the timeline (estimated resolution or virtual event injection). `pollActivity()` in `extension.ts` uses this return value in its UI refresh condition (`activityChanged || gmChanged || timelineChanged`), ensuring the panel updates immediately when GM data resolves estimated events — previously required the next user message to trigger a refresh.
  `injectGMData()` 现在返回 `boolean` 表示是否修改了 timeline。`pollActivity()` 将此返回值加入 UI 刷新条件，确保 GM 数据解析 estimated 事件后立即刷新面板 —— 之前需等下一条用户消息才能触发。

- **User Message Text Extraction / 用户消息文本提取**: Fixed critical bug where `_processStep()` and `_injectTimelineEvent()` extracted user text from `userInput.items[0].text` (always empty in current API) instead of `userInput.userResponse`. User message rows were always blank. Added `userResponse` as fallback.
  修复严重 Bug：用户文本从 `userInput.items[0].text`（当前 API 始终为空）提取，导致用户消息行始终空白。增加 `userResponse` 作为 fallback。

- **User Message Expand Logic / 用户消息展开逻辑**: Replaced fixed character threshold (80/96) with "truncation implies expandable" logic. `fullUserInput` now always stores original text; `hasExpand` is naturally determined by `fullText.length > previewText.length` — if truncation happened, expand is available.
  移除固定字符门槛（80/96），改为「截断即可展开」：`fullUserInput` 始终存原始文本，`hasExpand` 由长度比较自然决定。

- **User Message Expand CSS Priority / 用户消息展开样式优先级**: Added `.act-tl-user.act-tl-expandable` CSS rule to override `.act-tl-user`'s `cursor: default`, enabling pointer cursor on expandable user messages.
  增加高优先级 CSS 规则覆盖 `.act-tl-user` 的 `cursor: default`。

- **GM Nearest-Neighbor Matching / GM 就近匹配**: Some `PLANNER_RESPONSE` steps share an LLM call with adjacent steps but are not listed in GM's `stepIndices`. Added ±3 step range fallback in `injectGMData()` so these "continuation" reasoning steps still receive token annotations.
  某些 `PLANNER_RESPONSE` 步骤与相邻步骤共享 LLM 调用但不在 GM `stepIndices` 中。增加 ±3 步范围 fallback，让这些「延续」推理步骤也获得 token 注解。

- **Expand Indicator False Positive / 展开指示器误显示**: `hasExpand` now strictly checks `fullText.length > previewText.length` rather than just `!!fullText`, eliminating dotted underlines on short messages that have no hidden content.
  `hasExpand` 严格比较完整文本与预览文本长度，消除短消息上的虚假展开指示器。

### Documentation / 文档

- **Project Structure Sync / 项目结构文档同步**: Updated `docs/project_structure.md` to reflect the current repository layout, refreshed `activity-tracker.ts` / `gm-tracker.ts` responsibilities, and aligned the Vitest count to **88 tests**.
  更新 `docs/project_structure.md`，同步当前仓库结构、刷新 `activity-tracker.ts` / `gm-tracker.ts` 的职责说明，并将 Vitest 数量更新为 **88 个测试**。

- **Bilingual UX Copy Audit / 双语体验文案审查**: Performed a user-visible wording audit across notifications, status bar tooltip, QuickPick details, Monitor / Profile / Pricing tabs, and `readme_CN.md`. Localized remaining labels and units such as `tokens`, `cr`, `Cascade ID`, pricing-unit subtitles, and WebView action feedback, while clarifying Chinese-facing terminology in the disclaimer and README.
  对通知、状态栏 tooltip、QuickPick 详情、Monitor / Profile / Pricing 标签页及 `readme_CN.md` 执行用户可见文案审查。补齐 `tokens`、`cr`、`Cascade ID`、价格单位副标题、WebView 操作反馈等残留文案的本地化，并同步优化免责声明与 README 的中文术语表述。

### Quality / 质量

- **Codebase Health Check / 代码库体检**: Re-ran `npm run compile` and `npm test` against the current workspace state. Result: compile passes, **88/88** tests pass. During this review the primary desync found was documentation drift (test counts / structure description lagging behind code), which is now synchronized in `docs/project_structure.md`.
  重新对当前工作区执行 `npm run compile` 与 `npm test`。结果：编译通过，**88/88** 测试通过。本轮体检发现的主要问题是文档与代码不同步（测试数、结构描述滞后），现已在 `docs/project_structure.md` 中同步。

### Fixed / 修复

- **🔥 Sub-Agent Data Loss on Restore — Key Mismatch / 恢复时子智能体数据丢失 — Key 不匹配**: Fixed critical bug where `restore()` used `entry.modelId` as the Map key when restoring `_subAgentTokens`, but creation used composite key `${rawModel}::${ownerModel}`. When the same sub-agent model served multiple parent models (e.g., Flash Lite for both Sonnet and Opus), restoration collapsed entries via last-write-wins, permanently losing data.
  修复严重 Bug：`restore()` 恢复 `_subAgentTokens` 时使用 `entry.modelId` 作为 Map key，但创建时使用复合 key `${rawModel}::${ownerModel}`。当同一子智能体模型服务多个父模型时（如 Flash Lite 同时服务 Sonnet 和 Opus），恢复时后者覆盖前者，数据永久丢失。

- **🔥 Sub-Agent Migration False Trigger — Ratio Threshold Too Aggressive / 子智能体迁移误触发 — 比例阈值过于激进**: Fixed bug where `needsSubAgentMigration` check used `subAgentTotalCount < totalCheckpoints * 0.5` — a ratio-based threshold that falsely triggered nuclear reset when sub-agent activity was legitimately low relative to checkpoints. Nuclear reset cleared all restored data and forced re-warm-up, which could only see ~500 steps per conversation via API window, permanently losing older historical sub-agent data. Now only triggers when sub-agent data is entirely absent (old format migration).
  修复 Bug：`needsSubAgentMigration` 使用 `subAgentTotalCount < totalCheckpoints * 0.5` 比例阈值，在子智能体活动合法偏低时误触发核弹重置。核弹重置清空所有已恢复数据并强制 re-warm-up，但 API 窗口每对话仅可见 ~500 步，导致更早的历史子智能体数据永久丢失。现仅在数据完全缺失（旧格式迁移）时触发。

- **Timeline Model Name Truncation / 时间线模型名被截断**: Fixed `.act-tl-model` CSS that used `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` to truncate long model names. Changed to `word-break: break-word; overflow-wrap: anywhere` to allow natural wrapping, consistent with `.act-card-header` behavior.
  修复 `.act-tl-model` CSS 使用 `nowrap + ellipsis` 截断长模型名的问题。改为 `break-word + anywhere` 允许自然换行，与 `.act-card-header` 行为一致。

- **Conversation Breakdown Key Mismatch on Restore / 恢复时对话细分 Map key 不匹配**: Fixed bug where `restore()` used `ConversationBreakdown.id` (short 8-char ID) as Map key, but `_updateConversationBreakdown()` uses full `cascadeId` UUID. After restore, GM-based corrections in `injectGMData()` couldn't find entries. Now uses trajectory baselines to reconstruct full cascadeId keys on restore.
  修复 Bug：`restore()` 使用 `cb.id`（8 字符短 ID）作为 `_conversationBreakdown` Map key，但创建时使用完整 `cascadeId` UUID。恢复后 `injectGMData()` 的 GM 修正无法匹配条目。现通过 trajectory baselines 反查完整 cascadeId 重建 key。

### Added / 新增

- **Sub-Agent Conversation Attribution / 子智能体对话归属**: `SubAgentTokenEntry` interface extended with `cascadeIds?: string[]` field tracking which conversations generated the sub-agent consumption. `_processStep()` now receives `cascadeId` parameter, transparently passed from all 4 call sites in `processTrajectories()`. Activity panel sub-agent cards now display: conversation count row, owner model badge (`→ ownerModel`), and footer with conversation ID short tags.
  `SubAgentTokenEntry` 接口新增 `cascadeIds` 字段追踪消耗来源对话。`_processStep()` 新增 `cascadeId` 参数，从 `processTrajectories()` 的全部 4 个调用点透传。子智能体卡片新增：对话数量行、ownerModel 标签、底部对话短 ID 标签。

- **🚀 GM-Powered Sub-Agent Window Bypass / GM驱动的子智能体窗口突破**: `GetCascadeTrajectorySteps` API has a hard ~500 step window — sub-agent data from earlier steps is permanently lost on re-warm-up. New `injectGMData()` supplement uses `GetCascadeTrajectoryGeneratorMetadata` (no window limit) to extract sub-agent calls from OUTSIDE the step API window. Separate `_gmSubAgentTokens` Map (runtime-only, rebuilt each poll) is merged with CP-based `_subAgentTokens` in `getSummary()`. Dominant model is determined from trajectory cache or GM call frequency fallback. Pool resets and full resets correctly clear both Maps.
  `GetCascadeTrajectorySteps` API 有 ~500 步硬窗口限制——超出窗口的子智能体数据在 re-warm-up 后永久丢失。新增 `injectGMData()` 补充逻辑，利用 `GetCascadeTrajectoryGeneratorMetadata`（无窗口限制）提取步骤窗口外的子智能体调用。独立 `_gmSubAgentTokens` Map（仅运行时，每次 poll 重建）在 `getSummary()` 中与 CP 数据合并。主导模型从 trajectory 缓存或 GM 调用频率推断。Pool/全局 reset 正确清理两个 Map。

- **GM Conversation Steps Correction / GM对话步数修正**: `_conversationBreakdown.steps` was limited by the Steps API ~500 window — always capped at the number of steps returned. Now `injectGMData()` corrects step counts using `GMConversationData.totalSteps` which reflects the actual total without window limitation.
  `_conversationBreakdown.steps` 受 Steps API ~500 窗口限制，始终上限为 API 返回步数。现在 `injectGMData()` 使用 `GMConversationData.totalSteps`（无窗口限制的真实总数）修正步数。

- **GM Context Growth History Supplement / GM上下文增长历史补充**: `_checkpointHistory` was built only from CHECKPOINT steps within the API window, missing context growth from earlier steps. Now `injectGMData()` prepends virtual `CheckpointSnapshot` entries from `GMSummary.contextGrowth` data points that fall outside the step window, including compression detection. One-time injection guard prevents duplicate prepends across poll cycles.
  `_checkpointHistory` 仅从 API 窗口内的 CHECKPOINT 步骤构建，丢失更早步骤的上下文增长数据。现在 `injectGMData()` 将步骤窗口外的 `GMSummary.contextGrowth` 数据点转换为虚拟 `CheckpointSnapshot` 前置注入，包含压缩检测。一次性注入保护机制防止跨 poll 周期重复注入。

### Refactored / 重构

- **Monitor ↔ GM Data Deduplication / 监控与 GM 数据去重**: Removed 5 redundant data sections from the Monitor tab that overlap with the global-scope GM Data tab. Monitor now focuses exclusively on **current session** real-time status; all analytical/aggregated visualizations are delegated to GM Data.
  从监控面板移除 5 个与 GM 数据重叠的区块。监控现在专注于**当前会话**实时状态；所有分析/聚合型可视化交由 GM 数据管理。

  | 移除的区块 | 原因 |
  |---|---|
  | GM 统计 (Credits/TTFT/Stream/Calls/Retry) | GM 数据 tab 有更完整的全局版本 |
  | 异常停止标签 | 属于调用/重试范畴，GM 数据管理 |
  | 上下文 X 光 (Token Breakdown) | 已搬迁至 GM 数据的组成图中 |
  | 增长曲线 (Growth Curve) | GM 数据的渐变折线图更精致 |
  | 模型分布 (Model Distribution) | GM 数据的甜甜圈图更完整 |

  **净减 352 行** (222 行 TS 函数 + 131 行 CSS 样式)。

- **Context X-ray → GM Data Composition / 上下文 X 光搬迁至 GM 数据组成图**: Context X-ray detail view (per-group progress bars + child chip tags + total) relocated from Monitor tab to GM Data tab's "Context Composition" section. Rendered as a collapsible `<details>` beneath the donut chart — donut provides instant visual summary, expand reveals detailed per-group breakdown with progress bars and child chip tags.
  上下文 X 光详细视图（按组进度条 + 子项 chip 标签 + 合计）从监控面板搬迁至 GM 数据的「上下文组成」区块。渲染为甜甜圈图下方的可折叠 `<details>` — 甜甜圈提供即时视觉总览，展开后显示每组详细分解。

- **X-ray Detail Scroll Persistence / X 光详情滚动持久化**: `.xray-body` receives `max-height: 280px` + `overflow-y: auto` with themed 4px scrollbar. Added to `scrollableSelectors` array in `webview-script.ts` for automatic scroll position save/restore across DOM rebuilds.
  `.xray-body` 限制最大高度 280px + 滚动条。加入 `webview-script.ts` 的 `scrollableSelectors`，DOM 重建后自动恢复滚动位置。

## [1.13.3] - 2026-03-23

### Added / 新增

- **Profile Panel Data Mining / 个人面板深度挖掘**: Deep analysis of `GetUserStatus` response uncovered 227 leaf nodes and 3 previously unused fields: `userTier.description` (subscription status text), `upgradeSubscriptionText` (upgrade hint), and `clientModelSorts` (LS-recommended model ordering). Added `userTierDescription`, `upgradeSubscriptionText`, `modelSortOrder` to `UserStatusInfo` interface.
  深度分析 `GetUserStatus` 响应发现 227 个叶子节点和 3 个未使用字段：`userTier.description`（订阅状态描述）、`upgradeSubscriptionText`（升级提示）、`clientModelSorts`（LS 推荐模型排序）。在 `UserStatusInfo` 接口新增对应字段。

- **Profile Panel Model Card Grid / 个人面板模型卡片网格**: Model quota section redesigned as a responsive 2-column grid of `.model-card` components. Each card displays: model name with `tagTitle` badge (e.g., "New"), quota progress bar, MIME type categories (Docs/Code/Image/Media) with counts as `.mime-chip` tags, reset countdown, and full MIME list in collapsible section. Models sorted by LS-recommended `clientModelSorts` order.
  模型配额区重设计为响应式 2 列卡片网格。每张卡片展示：模型名 + `tagTitle` 标签、配额进度条、MIME 类型分类计数、重置倒计时、可折叠完整 MIME 列表。按 LS 推荐排序。

- **Profile Panel Subscription Hint / 个人面板订阅提示**: Account section now displays `upgradeSubscriptionText` as a `.subscription-hint` styled prompt, and Google AI Credits are inlined as `.gai-credits` badge.
  账户区新增 `upgradeSubscriptionText` 订阅提示和内联 Google AI Credits 显示。

- **Profile Panel Merged Sections / 个人面板合并区块**: Feature Flags and Team Config merged into a single "Features & Team" collapsible section for reduced clutter.
  功能开关和团队配置合并为单个可折叠区块。

- **Probe Data: Retry Overhead Tracking / 探针数据：重试开销追踪**: `GMCallEntry` now captures `retryTokensIn`, `retryTokensOut`, `retryCredits`, `retryErrors` from `retryInfos[]` in GeneratorMetadata. `GMSummary` aggregates `totalRetryTokens`, `totalRetryCredits`, `totalRetryCount`. A new "Retry" card in the Summary Bar and a dedicated Retry Overhead section display retry token waste, credit loss, and retry count. Stop reason distribution (`stopReasonCounts`) also tracked and visualized.
  `GMCallEntry` 新增从 `retryInfos[]` 提取的 `retryTokensIn/Out`、`retryCredits`、`retryErrors`。`GMSummary` 聚合 `totalRetryTokens/Credits/Count`。Summary Bar 新增"重试"卡片，独立重试开销区域展示 token 浪费、积分损失和重试次数。`stopReason` 分布也被追踪和可视化。

- **Probe Data: Token Breakdown Donut Chart / 探针数据：上下文组成环形图**: New `buildTokenBreakdownChart()` function renders a CSS donut chart visualizing the latest token composition (System Prompt, Chat Messages, MCP Tools, Rules, Skills, Native Tools, etc.) from `tokenBreakdown.groups[]`. Each segment has a distinct color from a predefined palette.
  新增 `buildTokenBreakdownChart()` 函数，渲染 CSS 环形图可视化最新的 token 组成（系统提示、对话消息、MCP 工具、规则、技能、原生工具等），每段使用预定义调色板的不同颜色。

- **Probe Data: stopReason & timeSinceLastInvocation / 探针数据：停止原因与调用间隔**: `GMCallEntry` now captures `stopReason` (from `plannerResponse.stopReason`) and `timeSinceLastInvocation` for richer per-call diagnostics.
  `GMCallEntry` 新增 `stopReason`（来自 `plannerResponse.stopReason`）和 `timeSinceLastInvocation` 字段，提供更丰富的逐调用诊断信息。

- **Durable External Persistence / 扩展外部持久化**: Added `durable-state.ts`, an external JSON-file persistence layer mirrored with VS Code state. Key Monitor / GM Data / Pricing / Calendar / Quota History state is now recoverable after uninstall/reinstall as long as the state file remains.
  新增 `durable-state.ts` 扩展外部 JSON 持久化层，并与 VS Code state 镜像。关键的 Monitor / GM Data / Pricing / Calendar / Quota History 数据在卸载 / 重装后可恢复。

- **Monitor Snapshot Store / 监控快照存储**: Added `monitor-store.ts` to persist `ContextUsage` plus per-conversation `GMConversationData` snapshots. The Monitor tab can now restore call counts, cache, retry, model distribution, compression history, and recent call details even when live `gmSummary` is unavailable.
  新增 `monitor-store.ts`，按对话持久化 `ContextUsage` 与 `GMConversationData` 快照。Monitor 标签页在实时 `gmSummary` 缺失时，也能恢复调用次数、缓存、重试、模型分布、压缩历史和最近调用明细。

- **Settings Storage Diagnostics / 设置中的持久化诊断**: The Settings tab now includes a "Persistent Storage" card showing the external state file path, existence status, and counters for Monitor / GM / Calendar / Pricing data. Added copy/open/reveal file actions for direct verification.
  设置标签页新增「持久化存储」诊断卡片，显示外部状态文件路径、存在状态，以及 Monitor / GM / Calendar / Pricing 相关计数，并提供复制路径、打开文件、定位文件按钮。

### Fixed / 修复

- **🔥 Privacy Toggle Broken After Refresh / 隐私按钮刷新后失效**: Fixed critical bug where the privacy shield button (name/email masking) stopped working after any auto-refresh cycle. Root cause: `updateTabs` incremental refresh replaced Profile tab `innerHTML`, destroying the old `#privacyToggle` button and its click event listener. The re-apply logic (line 609-617) only restored mask text state but never re-bound the click handler. Fix: `updateTabs` handler now re-creates the full click listener on the new `#privacyToggle` button, restores `.active` class, and properly toggles `privacyMasked` state via `vscode.setState()`.
  修复严重 Bug：隐私护盾按钮（遮罩姓名/邮箱）在任意自动刷新周期后停止工作。根因：`updateTabs` 增量刷新替换 Profile 标签 `innerHTML`，销毁旧 `#privacyToggle` 按钮及其 click 事件监听器。原有恢复逻辑仅重新应用了遮罩文本状态，未重新绑定 click 处理器。修复：`updateTabs` 中完整重建 click 监听器 + 恢复 `.active` 样式 + 正确切换 `privacyMasked` 状态。

- **🔥 Per-Pool Quota Reset Clears All Models' Data / 单池额度重置清空所有模型数据**: Fixed critical bug where a single model pool's quota reset (e.g., Gemini Pro) wiped GM data (call counts, tokens, credits) and Activity data (reasoning, tool calls, timeline events) for ALL models including unrelated ones (e.g., Claude). Root causes: (1) `gmTracker.reset()` was called globally without model IDs, clearing all call baselines; `dailyStore.addCycle()` archived all GM data regardless of pool. (2) `activityTracker.archiveAndReset()` cleared all `_modelStats`, timeline events, and GM breakdown even when `modelIds` were provided. Fix: (1) `GMTracker.reset(modelIds?)` now uses `_archivedCallIds` Set to track per-pool archived calls; `_buildSummary()` filters them out. (2) `ActivityTracker.archiveAndReset(modelIds?)` now converts model IDs to display names, builds filtered archive containing only pool models' stats/events, and preserves non-pool data. (3) `extension.ts` adds `expandToPool()` helper that groups models by `resetTime` and passes full pool member lists to both trackers.
  修复严重 Bug：单个模型池的额度重置（如 Gemini Pro）将所有模型（包括无关的 Claude）的 GM 数据（调用次数、token、积分）和 Activity 数据（推理、工具调用、时间线事件）全部清空。根因：① `gmTracker.reset()` 无模型 ID 参数全局清空基线；`dailyStore.addCycle()` 归档全部 GM 数据。② `activityTracker.archiveAndReset()` 即使传入 modelIds 也清空所有 `_modelStats`、时间线和 GM breakdown。修复：① `GMTracker.reset(modelIds?)` 新增 `_archivedCallIds` Set 按池追踪已归档调用，`_buildSummary()` 过滤。② `ActivityTracker.archiveAndReset(modelIds?)` 转换 modelId 为显示名，仅归档+清空匹配 pool 的数据。③ `extension.ts` 新增 `expandToPool()` 按 resetTime 分组扩展 pool 成员。

- **🔥 Pool Archival Boundary & Cross-Tab Pollution / 池级归档边界与跨标签页污染**: Fixed follow-up issues where one pool reset still leaked unrelated models' data into Calendar / Pricing archives, and some Activity-derived Monitor / GM Data metrics could appear mixed after pool resets. `extension.ts` now splits reset callbacks by reset-time pool, archives each pool independently using the matching `QuotaSession` time window, filters GM snapshots before cost calculation, and recalculates tool rankings from surviving per-model stats. `subAgentTokens` now carry `ownerModel` so pool resets only clear matching entries.
  修复后续问题：单池重置后，Calendar / Pricing 归档仍可能混入其他池数据，且部分 Activity 派生指标在 Monitor / GM Data 中可能出现混池。`extension.ts` 现按共享 resetTime 将回调拆成独立 pool，使用对应 `QuotaSession` 的时间边界逐池归档，在计算费用前先过滤 GM 快照；工具排行改为从剩余 per-model stats 即时重算。`subAgentTokens` 新增 `ownerModel`，池重置时仅清理对应条目。

- **🔥 Monitor Detail Loss After Restart/Reinstall / 重启或重装后监控细节丢失**: Fixed issue where Monitor tab could still show the session list but lose per-conversation GM details (calls, thinking split, cache, retry, model distribution, recent call rows) after reconnect, restart, or reinstall. `monitor-store.ts` now persists conversation-level GM snapshots, and `webview-monitor-tab.ts` falls back to them automatically when live GM data is not yet available.
  修复 Monitor 标签页在重连、重启或重装后虽然还能显示会话列表，但会丢失每对话 GM 细节（调用次数、思考拆分、缓存、重试、模型分布、最近调用明细）的问题。`monitor-store.ts` 现持久化对话级 GM 快照，`webview-monitor-tab.ts` 在实时 GM 数据尚未可用时自动回退到这些快照。

- **Settings Schema / UI Mismatch / 设置 Schema 与界面不一致**: Fixed anti-intuitive mismatch where UI text said `quotaNotificationThreshold=0` disables notifications, but `package.json` schema still enforced minimum `1`. Minimum is now `0`, and `setConfig` applies explicit normalization/clamping for quota notification, activity limits, privacy toggle, and context limit overrides.
  修复反直觉问题：界面文案说明 `quotaNotificationThreshold=0` 可禁用通知，但 `package.json` 的 schema 最小值仍为 `1`。现已改为 `0`，并在 `setConfig` 中对额度通知、活动限制、隐私开关、上下文覆盖值统一做归一化 / 限幅。

### Changed / 变更

- **Monitor Tab: LS Raw Data Section Removed / 监控标签页：LS 原始数据移除**: Removed `buildRawDataSection()` from `webview-monitor-tab.ts`. Raw LS data is now fully represented by enriched GM Data tab components, making the redundant raw dump unnecessary.
  从 `webview-monitor-tab.ts` 移除 `buildRawDataSection()`。LS 原始数据已被 GM Data 标签页的增强组件完全覆盖，冗余的原始转储不再需要。

- **Daily Store: Retry Archiving / 日历归档：重试数据**: `DailyCycleEntry` now includes `gmRetryTokens`, `gmRetryCredits`, `gmRetryCount` optional fields. `addCycle()` populates them from `GMSummary` during quota reset archiving, ensuring retry overhead is preserved in calendar history.
  `DailyCycleEntry` 新增 `gmRetryTokens`、`gmRetryCredits`、`gmRetryCount` 可选字段。`addCycle()` 在额度重置归档时从 `GMSummary` 填充，确保重试开销保留在日历历史中。

- **Profile Tab UI Overhaul / 个人面板 UI 全面重构**: Complete rewrite of `buildProfileContent()` in `webview-profile-tab.ts`. Account section integrates Google AI Credits inline. Model quota switches from flat list to card grid with MIME chips. Features and Team merged. New CSS classes added to `webview-styles.ts`: `.subscription-hint`, `.gai-credits`, `.model-grid`, `.model-card`, `.mime-chips`, `.mime-chip`.
  完全重写 `webview-profile-tab.ts` 的 `buildProfileContent()`。账户区内联 Credits。模型配额从平铺列表改为卡片网格 + MIME 分类。功能和团队合并。`webview-styles.ts` 新增 6 个 CSS 类。

- **Per-Pool Quota Reset Isolation / 额度重置 per-pool 隔离**: `onQuotaReset` callback now expands triggering model IDs to their full quota pool via `expandToPool()` (groups by `resetTime`). Both `gmTracker.reset(poolModelIds)` and `activityTracker.archiveAndReset(poolModelIds)` now only affect data for models within the resetting pool. `GMTrackerState` extended with `archivedCallIds` for cross-session persistence of per-pool archived call tracking.
  `onQuotaReset` 回调现通过 `expandToPool()` 将触发模型 ID 扩展到完整配额池（按 resetTime 分组）。`gmTracker.reset(poolModelIds)` 和 `activityTracker.archiveAndReset(poolModelIds)` 现仅影响重置 pool 内的数据。`GMTrackerState` 新增 `archivedCallIds` 支持跨会话持久化。

- **Monitor / GM Persistence Strategy / Monitor / GM 持久化策略**: `GMTracker.serialize()` still keeps a slim summary for fast baseline recovery, but `getDetailedSummary()` now exports a full `GMSummary` (with calls) to the external state file. This separates "lightweight cycle state" from "rich UI recovery state" and avoids forcing the WebView to wait for a fresh poll before restoring details.
  `GMTracker.serialize()` 仍保留轻量版 summary 用于快速恢复基线，但新增 `getDetailedSummary()` 将完整 `GMSummary`（含 calls）写入外部状态文件。这样将“轻量周期状态”和“富 UI 恢复状态”分离，避免 WebView 必须等待下一次轮询后才能恢复细节。

- **Settings UX / 设置交互体验**: Added success feedback mapping for quota notification, activity limits, quota-history max size, and persistent-state path copy action. Developer clear/reset actions now also refresh storage diagnostics immediately.
  设置交互体验改进：为额度通知、活动限制、历史上限和状态文件路径复制补充了保存成功反馈；开发用清空 / 重置操作也会立即刷新存储诊断数据。

- **Data Disclaimer Wording Update / 数据声明文案更新**: Disclaimer banner now clearly distinguishes data sources: items with a green **GM** badge are precise per-call values from Generator Metadata, while other metrics (context usage, token estimates) are derived from checkpoint snapshots or character-based heuristics. Previous wording implied all data was "estimated".
  数据声明横幅现明确区分数据来源：带绿色 **GM** 徽章的数据为 Generator Metadata 的逐调用精确值，其余指标（上下文用量、Token 估算）基于 Checkpoint 快照或字符启发式计算。旧版文案暗示所有数据均为“估算”。

- **Monitor Tab: GM Precision Sections / 监控标签页：GM 精确数据区块**: `buildMonitorSections()` now receives `GMSummary` and renders three new sections in the Monitor tab: ① **Output Split** — stacked bar chart showing input/output/cache/thinking token proportions per model, ② **Per-Call Detail** — expandable collapsible entries for each LLM call with full GM breakdown (tokens, TTFT, streaming speed, credits, stop reason, retry info), ③ **Stop Reason Distribution** — counts of each stop reason across all calls. New CSS classes in `webview-styles.ts`: `.gm-split-section`, `.gm-cache-section`, `.gm-stats-section`, `.output-split-bar`, `.call-row`, `.call-detail`.
  `buildMonitorSections()` 现接收 `GMSummary` 并在监控标签页渲染三个新区块：① **输出分拆** — 堆叠条形图展示每模型的 input/output/cache/thinking 比例；② **逐调用详情** — 可展开的每次 LLM 调用完整 GM 明细（token、TTFT、流速、积分、停止原因、重试信息）；③ **停止原因分布** — 各种 stopReason 的计数。`webview-styles.ts` 新增 6 个 CSS 类。





## [1.13.3] - 2026-03-23

### Fixed / 修复

- **🔥 WebView Disposed → Status Bar IDLE Loop / WebView 关闭后状态栏陷入 IDLE 循环**: Fixed critical bug where closing the Monitor Panel caused `panel.webview.postMessage()` to throw `Error: Webview is disposed`, which propagated to the `pollContextUsage()` catch block and triggered `handleLsFailure()` — creating an infinite backoff loop showing "不可用" in the status bar. Fix: introduced `safePostMessage()` wrapper that catches disposed errors at the source and calls `clearDisposedPanel()` to clean up state. All 11 `postMessage` call sites replaced.
  修复关键 Bug：关闭监控面板后 `panel.webview.postMessage()` 抛出 `Webview is disposed` 异常，异常冒泡到 `pollContextUsage()` 的 catch 块触发 `handleLsFailure()`，导致状态栏无限循环显示"不可用"。修复：引入 `safePostMessage()` 包装器在源头捕获 disposed 错误，并调用 `clearDisposedPanel()` 清理状态。全部 11 处 `postMessage` 调用已替换。

- **🔥 Multi-Workspace LS Cross-Binding / 多工作区 LS 错误绑定**: Fixed critical bug where multiple VS Code windows with different workspaces could bind to the same Language Server process. Root cause: three discovery functions (WSL, Windows, macOS/Linux) silently fell back to `lines[0]` (the first discovered LS) when no exact `workspace_id` match was found. Fix: introduced `selectMatchingProcessLine()` with fail-closed behavior — when a `workspaceUri` is provided but no matching LS process exists, returns `null` instead of falling back. Three inline matching blocks replaced.
  修复关键 Bug：多个 VS Code 窗口打开不同工作区时可能绑定到同一个语言服务器进程。根因：WSL、Windows、macOS/Linux 三个发现函数在找不到精确 `workspace_id` 匹配时静默回退到 `lines[0]`（第一个发现的 LS）。修复：引入 `selectMatchingProcessLine()`，失败关闭策略——提供了 `workspaceUri` 但无匹配 LS 时返回 `null`，不再回退。三处内联匹配替换。

### Added / 新增

- **`safePostMessage()` / 安全消息发送**: Sync try-catch wrapper for `panel.webview.postMessage()`. Catches disposed errors silently, re-throws non-disposed errors to preserve call stacks.
  `panel.webview.postMessage()` 的同步 try-catch 包装器。静默处理 disposed 错误，非 disposed 错误保留原调用栈重新抛出。

- **`selectMatchingProcessLine()` / 精确进程匹配**: New function for workspace-aware LS process selection. Without URI, falls back to first process (backward compat). With URI, performs exact `workspace_id` match and fails closed on mismatch.
  新增工作区感知的 LS 进程选择函数。无 URI 时回退到第一个进程（向后兼容）。有 URI 时执行精确 `workspace_id` 匹配，不匹配时返回 null。

- **`decodeURIComponent` defense in `buildExpectedWorkspaceId()` / 百分号解码防御**: Percent-encoded workspace URIs (e.g., `file:///c%3A/...`) are now decoded before workspace ID construction, preventing match failures when VS Code sends encoded paths.
  百分号编码的工作区 URI（如 `file:///c%3A/...`）现在在构建工作区 ID 前解码，防止 VS Code 发送编码路径时匹配失败。

### Tests / 测试

- Added 7 new tests for `selectMatchingProcessLine()` (6 branch tests) and `buildExpectedWorkspaceId()` (percent-encoded path test) in `discovery.test.ts`.
  在 `discovery.test.ts` 中新增 7 个测试：`selectMatchingProcessLine()` 6 个分支测试 + `buildExpectedWorkspaceId()` 百分号编码测试。

### Contributors / 贡献者

- Thanks to [@NightMin2002](https://github.com/NightMin2002) for identifying both bugs and proposing fixes ([PR #27](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/27)).
  感谢 [@NightMin2002](https://github.com/NightMin2002) 发现两个 Bug 并提出修复方案（[PR #27](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/27)）。

## [1.13.2] - 2026-03-23

### Added / 新增

- **Unified GM Data Tab / 统一 GM 数据标签页**: Merged the former "Activity" and "GM Data" tabs into a single "GM Data" tab. Activity tracking (timeline, tools, distribution) and GM precision data (performance, cache efficiency, context growth, conversations) now coexist in one view. Former `gm-panel.ts` deleted; all rendering consolidated into `activity-panel.ts` via `buildGMDataTabContent()`. Tab count reduced from 8 to 7.
  将「活动」和「GM 数据」两个标签页合并为统一的「GM 数据」标签页。Activity 追踪（时间线、工具、分布）与 GM 精确数据（性能、缓存效率、上下文增长、对话）共存于同一视图。原 `gm-panel.ts` 删除，全部渲染逻辑合并到 `activity-panel.ts`。标签数从 8 减至 7。

- **GM Call Baselines — Cycle Isolation / GM 调用基线 — 周期隔离**: `GMTracker` now tracks per-conversation call baselines (`_callBaselines` Map) to isolate quota cycles. `_buildSummary()` uses `calls.slice(baseline)` to count only current-cycle calls. Baselines are persisted in `GMTrackerState.callBaselines` and restored across sessions. `reset()` sets baselines and preserves cache stubs; `fullReset()` clears everything and sets `_needsBaselineInit` for zero-start counting.
  `GMTracker` 新增每对话调用基线（`_callBaselines` Map）实现额度周期隔离。`_buildSummary()` 使用 `calls.slice(baseline)` 仅计入当前周期调用。基线通过 `GMTrackerState.callBaselines` 跨会话持久化。`reset()` 设置基线并保留缓存；`fullReset()` 清空一切，设 `_needsBaselineInit` 从零计数。

- **Quota Pool Deduplication / 配额池去重**: `QuotaTracker.processUpdate()` now groups models sharing the same `resetTime` into pools. Only one representative per pool is tracked (lowest fraction, alphabetical tie-break), preventing duplicate sessions in history from same-pool models (e.g., Claude Sonnet/Opus sharing quota).
  `processUpdate()` 按 `resetTime` 分组识别共享配额池的模型，每个池仅追踪一个代表（最低 fraction → 字母排序），避免同池模型在历史记录中产生重复 session。

- **Quota Pool Model Labels / 配额池模型标签**: `QuotaSession` now includes `poolModels?: string[]` field collecting display labels of all models in the same quota pool. `processUpdate()` builds a `poolLabelsForModel` map and injects it into sessions at creation and during tracking updates. The Quota Tracking tab renders additional pool members as `.pool-badge` tags next to the primary model label.
  `QuotaSession` 新增 `poolModels` 字段，收集同配额池所有模型的显示标签。`processUpdate()` 构建 `poolLabelsForModel` 映射并注入到 session。额度追踪标签页将额外的池成员渲染为紫色 `.pool-badge` 标签。

- **Debug / Testing Section in Settings / 设置中的调试测试区块**: New section with two developer tools: "Simulate Quota Reset" (archives Activity + GM + Cost to Calendar, then resets baselines) and "Clear GM Data & Baselines" (nuclear reset, baselines all existing API data on next fetch).
  设置标签新增调试区块：「模拟额度重置」（归档当前数据到日历后重置基线）和「清除 GM 数据和基线」（核重置，下次获取时基线化所有 API 数据）。

- **Default Pricing Table / 默认价格表**: Pricing tab now shows an editable default pricing table even when no GM data is available, via `buildDefaultPricingTable()`. Users can configure custom prices before any AI conversations.
  Pricing 标签在无 GM 数据时也显示可编辑的默认价格表，用户可以提前配置自定义价格。

- **Immediate First Poll / 即时首轮询**: `activate()` now triggers `pollContextUsage()` → `pollActivity()` chain immediately, reducing panel data readiness from ~6s to ~1-2s. Scheduled polls continue in parallel; `isPolling`/`isActivityPolling` guards prevent duplication.
  `activate()` 末尾立即触发 poll 链，将面板数据就绪时间从 ~6s 降至 ~1-2s。常规定时轮询照常并行运行，防重入保护防止重复。

- **`devPersistActivity` Command / 持久化活动状态命令**: New internal command `antigravity-context-monitor.devPersistActivity` persists the current `activityTracker` state to `globalState`. Called by `clearActivityData` to ensure the cleared state survives extension reload/reinstall.
  新增内部命令，将当前 `activityTracker` 状态持久化到 `globalState`。由 `clearActivityData` 调用，确保清空状态在重载/重装后不被还原。

### Fixed / 修复

- **🔥 IDLE Conversations GM Data Lost After Restart / 重启后 IDLE 对话 GM 数据丢失**: Fixed critical bug where `serialize()` strips `calls[]` for storage efficiency, but `fetchAll()` skipped IDLE conversations with matching `totalSteps` — never re-fetching their calls. After restart, only RUNNING conversations had GM data; all IDLE conversations showed 0 calls. Fix: skip condition now requires `cached.calls.length > 0`, forcing a one-time re-fetch for restored stubs with empty calls.
  修复严重 Bug：`serialize()` 为节省空间剥离 `calls[]`，但 `fetchAll()` 跳过 `totalSteps` 匹配的 IDLE 对话，永不重新获取。重启后仅 RUNNING 对话有 GM 数据，所有 IDLE 对话显示 0 调用。修复：跳过条件增加 `calls.length > 0`，restore 后空 calls 的 IDLE 对话在首次 `fetchAll()` 时自动回填。

- **🔥 Settings Tab Buttons/Toggles Unresponsive / 设置标签按钮和开关无响应**: Fixed critical bug where `updateTabs` incremental refresh replaced Settings tab `innerHTML` every 3-5s, destroying all event listeners on toggles, dev buttons, and inputs. Fix: Settings tab excluded from `buildTabContents()` incremental updates; only rebuilt during full HTML renders (panel open, language switch, user actions).
  修复严重 Bug：`updateTabs` 增量刷新每 3-5 秒替换 Settings 标签的 `innerHTML`，销毁所有 toggle、按钮、输入框的事件监听器。修复：Settings 从增量更新中排除，仅在完整 HTML 重建时渲染。

- **Panel Shows Stale GM Data After Quota Reset / 额度重置后面板显示陈旧 GM 数据**: Fixed desync where `onQuotaReset` set `extension.ts lastGMSummary = null` but `pollContextUsage()`'s `updateMonitorPanel()` call didn't pass `lastGMSummary`, leaving the panel's cached copy unchanged. Both `updateMonitorPanel` calls in `pollContextUsage()` (idle path and normal path) now pass `lastGMSummary`.
  修复同步问题：`onQuotaReset` 清空了 `extension.ts` 的 `lastGMSummary`，但 `pollContextUsage()` 的 `updateMonitorPanel()` 不传该参数，面板缓存未更新。修复：两处 `updateMonitorPanel` 调用均补全 `lastGMSummary`。

- **GM Change Detection Failure on null→empty / null→空 summary 变更检测失败**: Fixed edge case where `lastGMSummary = null` after reset, then `fetchAll()` returns `totalCalls=0` — `0 !== (null?.totalCalls ?? 0)` evaluated to false, leaving `lastGMSummary` permanently null. Fix: explicit `!lastGMSummary` check triggers update when transitioning from null to any valid summary.
  修复边界情况：`lastGMSummary = null` 后 `fetchAll()` 返回 `totalCalls=0`，`0 !== (null?.x ?? 0)` 恒 false，`lastGMSummary` 永留 null。修复：`!lastGMSummary` 显式判断确保从 null 过渡到有效对象。

- **Old Version Upgrade Shows Archived Data / 旧版升级显示归档数据**: Fixed migration issue where upgrading from pre-callBaselines version (no `callBaselines` in persisted state) caused all historical API data to display unfiltered. `restore()` now sets `_needsBaselineInit = true` when `callBaselines` is absent, baselining all existing API data on first fetch.
  修复迁移问题：从无 `callBaselines` 的旧版升级后，所有 API 历史数据无过滤显示。`restore()` 检测到缺少 `callBaselines` 时设置 `_needsBaselineInit = true`，首次获取时自动基线化。

- **🔥 Calendar Data Persists After Clear + Reinstall / 清除后重装日历数据残留**: Fixed critical bug where calendar highlights reappeared after "Clear Activity Data" → extension reinstall. Root cause: `importArchives()` ran on every `activate()`, re-populating `DailyStore` from `activityTracker.getArchives()` unconditionally. Also `clearActivityData` was missing `dailyStore.clear()` and didn't persist the cleared `activityTracker` state. Fix: (1) `DailyStoreState` now includes `backfilled?: boolean` flag; `importArchives()` skips entirely when `_backfilled` is true, and sets it after first run. (2) `clear()` sets `_backfilled = true` to prevent re-import. (3) `clearActivityData` now calls `dailyStore.clear()` and `devPersistActivity`.
  修复严重 Bug：「清除活动数据」后重装插件，日历高亮重新出现。根因：`importArchives()` 在每次 `activate()` 时无条件从 `activityTracker.getArchives()` 回填日历。且 `clearActivityData` 未调用 `dailyStore.clear()`、未持久化清空后的 activityTracker 状态。修复：① `DailyStoreState` 新增 `backfilled` 标记，`importArchives()` 检测到后跳过，首次执行后设置；② `clear()` 设置 `backfilled=true` 阻止重新回填；③ `clearActivityData` 联动 `dailyStore.clear()` + `devPersistActivity`。

- **Calendar Data Duplication from Live Snapshot / live-snapshot 导致日历数据重复**: Removed the live-snapshot code path from `extension.ts activate()` that wrote current active session data into `DailyStore` on every activation. Calendar data is now written exclusively via `onQuotaReset` callback (authoritative) and `importArchives` one-time cold-start backfill, eliminating duplicate cycle entries.
  移除 `extension.ts activate()` 中的 live-snapshot 数据写入路径。日历数据现仅通过 `onQuotaReset` 回调（权威来源）和 `importArchives` 一次性冷启动回填写入，消除重复周期条目。

### Changed / 变更

- **Removed `gm-panel.ts` / 删除 GM 面板**: Content merged into `activity-panel.ts`. Functions `buildPerformanceChart`, `buildCacheEfficiency`, `buildContextGrowth`, `buildConversations` migrated. Exports renamed: `buildActivityTabContent` → `buildGMDataTabContent`, `getActivityTabStyles` → `getGMDataTabStyles`.
  内容合并到 `activity-panel.ts`。四个 GM 区块构建函数迁移。导出重命名。

- **Removed `statusBar.showActivity` and `activityDisplayMode` / 移除状态栏活动指标配置**: Removed `statusBar.showActivity` toggle and `activityDisplayMode` radio (global/currentModel) from both `package.json` configuration and Settings tab UI. Related script handlers also removed.
  从 `package.json` 和设置标签中移除 `statusBar.showActivity` 开关和 `activityDisplayMode` 单选框。相关脚本处理也一并移除。

- **`showActivityPanel` command now opens GM Data tab / 活动面板命令现在打开 GM 数据标签**: The command `antigravity-context-monitor.showActivityPanel` now sets `initialTab` to `'gmdata'` instead of `'activity'`.
  命令现在将 `initialTab` 设为 `'gmdata'`。

- **`clearActivityData` Full-Chain Cleanup / 清除活动数据全链路清理**: "Clear Activity Data" now also clears `DailyStore` (calendar data), persists the cleared `activityTracker` state to `globalState`, resets quota tracking states, clears quota history, and triggers `devClearGM`. All data subsystems are synchronized.
  「清除活动数据」现在联动清除 `DailyStore`（日历数据）、持久化清空后的 `activityTracker` 状态、重置额度追踪、清空额度历史、触发 `devClearGM`。所有数据子系统完全同步。

- **`importArchives` One-Time Migration / 归档导入一次性迁移**: `DailyStore.importArchives()` is now a one-time operation. Once backfill completes, a `backfilled` flag is persisted to `globalState`, preventing subsequent `activate()` calls from re-importing cleared data. `clear()` also sets this flag.
  `DailyStore.importArchives()` 现为一次性操作。回填完成后持久化 `backfilled` 标记到 `globalState`，防止后续 `activate()` 重新导入已清除的数据。`clear()` 也设置此标记。

### Tests / 测试

- Added `poolModels` population test in `quota-tracker.test.ts`.
  在 `quota-tracker.test.ts` 中新增 `poolModels` 填充测试。
- Total test count: 75 (was 67 in v1.12.2).
  测试总数：75（v1.12.2 为 67）。


## [1.13.0] - 2026-03-22

### Fixed / 修复

- **🔥 Remote-WSL LS Discovery / 远程 WSL 语言服务器发现**: When connected via Remote-WSL, the Antigravity IDE spawns a separate `language_server_linux_x64` process **inside** the WSL distro. Previously, the extension (running on the Windows UI side via `extensionKind`) only discovered the Windows-side LS, completely missing the WSL LS and its trajectory data. The extension now detects `vscode-remote://wsl+<distro>/...` workspace URIs, runs `wsl -d <distro> -- ps aux` to locate the LS inside WSL, extracts connection info (CSRF token, PID), discovers listening ports via `ss -tlnp`, and probes them from Windows via localhost (WSL2 auto-forwarding). This resolves the "idle / 0k/1M" display in Remote-WSL workspaces.
  通过 Remote-WSL 连接时，Antigravity IDE 会在 WSL 发行版**内部**启动独立的 `language_server_linux_x64` 进程。此前扩展（通过 `extensionKind` 运行在 Windows UI 端）只发现 Windows 端的 LS，完全遗漏了 WSL 内的 LS 及其对话数据。现在扩展检测到 `vscode-remote://wsl+<distro>/...` 工作区 URI 后，通过 `wsl -d <distro> -- ps aux` 定位 WSL 内的 LS，提取连接信息（CSRF token、PID），通过 `ss -tlnp` 发现监听端口，然后从 Windows 通过 localhost 探测（WSL2 自动端口转发）。解决了 Remote-WSL 工作区中显示"空闲 / 0k/1M"的问题。

### Added / 新增

- **`extractWslDistro()` helper**: Extracts WSL distro name from `vscode-remote://` URIs, handling both URL-encoded (`wsl%2Bubuntu`) and raw (`wsl+Ubuntu`) formats.
  新增 `extractWslDistro()` 辅助函数，从 `vscode-remote://` URI 中提取 WSL 发行版名称，兼容 URL 编码和原始格式。

- **`discoverWslLanguageServer()` function**: Complete WSL-side LS discovery pipeline: process scanning → workspace_id matching → CSRF/PID extraction → port discovery → RPC probing.
  新增 `discoverWslLanguageServer()` 函数，完整的 WSL 端 LS 发现流程：进程扫描 → workspace_id 匹配 → CSRF/PID 提取 → 端口发现 → RPC 探测。

## [1.13.1] - 2026-03-22

### Added / 新增

- **Incremental Refresh (PostMessage) / 增量刷新（PostMessage）**: Auto-refresh no longer replaces the entire WebView HTML. Instead, `updateMonitorPanel()` sends tab contents via `postMessage`, and the frontend updates each tab pane's `innerHTML` in-place. Scroll position, `<details>` expand states, disclaimer banner, and all UI state are preserved naturally. Full HTML rebuild only occurs on first show and user-initiated actions (language switch, clear data, etc.). Interactive elements (copy JSON, pricing save/reset, switch-tab links, privacy mask) are re-bound after each incremental update.
  自动刷新不再替换整个 WebView HTML。`updateMonitorPanel()` 通过 `postMessage` 发送标签页内容，前端仅更新各标签页的 `innerHTML`。滚动位置、`<details>` 展开状态、免责声明横幅等 UI 状态天然保持。

- **Kill Native Number Input Spinners / 消灭原生数字输入箭头**: Added global CSS to hide WebKit/Firefox native spinner buttons on `input[type="number"]`. Applies to pricing custom input fields.
  全局 CSS 隐藏 `input[type="number"]` 原生上下箭头。

- **Data Disclaimer Banner / 数据声明横幅**: Collapsible disclaimer banner at the top of the monitor panel. Explains that data is derived from internal interfaces, provided best-effort, and not officially endorsed. Uses `<details>` for keyboard accessibility, amber-toned styling. Collapsed by default. Bilingual via `tBi()`.
  监控面板顶部新增可折叠数据声明横幅。说明数据通过内部接口获取，为尽力估算，非官方认可。默认折叠，琥珀色调。

- **Calendar Tab — Daily History / 日历标签页 — 每日历史**: New 8th tab in WebView panel. Displays a 7×6 calendar grid with data indicators (dots on days with activity). Click any day to expand and view per-cycle details including Activity stats (reasoning/tools/tokens), GM data (calls/credits), and cost estimates. Month navigation with ◀/▶ buttons. All-time summary card with aggregated stats.
  WebView 面板新增第 8 个「日历」标签页。7×6 日历网格，有活动的日期显示圆点指示器。点击日期展开查看逐周期详情：活动统计、GM 数据、费用估算。支持月份前后导航。历史汇总卡片。

- **`daily-store.ts` — Daily Store Data Layer / 每日存储数据层**: New module managing per-day aggregation of Activity + GM + Pricing snapshots. Persisted via globalState. Auto-trims records older than 90 days. Snapshots captured automatically at quota reset (archiveAndReset hook).
  新增每日存储数据层：按天聚合 Activity + GM + Pricing 快照，globalState 持久化，90 天自动清理，配额重置时自动捕获。

- **`webview-calendar-tab.ts` — Calendar UI Builder / 日历 UI 构建器**: New module rendering Calendar tab HTML: month navigation, calendar grid, expandable day detail panels, cycle cards, overall summary.
  新增日历标签页 UI：月份导航、日历网格、可展开日期详情面板、周期卡片、历史汇总。

- **Retroactive Archive Import / 历史归档回溯导入**: `DailyStore.importArchives()` method imports existing `ActivityArchive` history into the calendar on startup. Uses `startTime`-based dedup for idempotent re-import across restarts. Also snapshots the current active session into today.
  新增 `importArchives()` 方法，启动时回溯导入已有活动归档到日历。按 `startTime` 去重，重启幂等。同时快照当前活跃会话到今天。

- **Calendar: Per-Model Cycle Detail / 日历: 逐模型周期详情**: Each cycle card now shows per-model breakdown rows with color-coded SVG stat chips: reasoning (purple), tools (blue), errors (red), est-steps (yellow), tokens (green). Data stored via new `ModelCycleStats` interface in `DailyCycleEntry.modelStats`.
  日历周期卡片增加逐模型细分行，含彩色 SVG 图标 stat chips（推理/工具/错误/步数估算/令牌）。

- **Pricing: Cost Overview Visualization / 价格: 费用概览可视化**: New visual section above the cost table: 4 highlight cards (Total Cost, Top Spender, Avg/Call, Models) + stacked bar chart per model showing Input/Output/Cache/Thinking cost breakdown with color-coded segments and legend.
  价格标签新增费用概览可视化区域：4 个亮点卡片 + 逐模型堆叠条形图（Input/Output/Cache/Thinking 分色段 + 图例）。

- **GM Tracker Persistence / GM 追踪器持久化**: `GMTracker` now supports `serialize()` / `restore()` for cross-session persistence via globalState. `serialize()` strips raw `calls[]` arrays (~1.4KB vs 537KB full). Restored on activate, cached summary available instantly via `getCachedSummary()`.
  `GMTracker` 新增 `serialize()` / `restore()` 方法，通过 globalState 跨会话持久化。`serialize()` 剥离原始 `calls[]` 数组（体积 ~1.4KB vs 完整 537KB）。启动时恢复，`getCachedSummary()` 即时可用。

- **Calendar: GM Per-Model Breakdown / 日历: GM 逐模型明细**: Each cycle card now includes a GM Breakdown section showing per-model stats with color-coded chips: calls, credits, avg TTFT, cache hit rate, estimated cost (USD), and token counts (input/output/thinking). Data stored via new `GMModelCycleStats` interface in `DailyCycleEntry.gmModelStats`.
  日历周期卡片新增 GM Breakdown 区域，逐模型显示：调用次数、积分、平均 TTFT、缓存命中率、估算费用（USD）、token 数。数据存储于新的 `GMModelCycleStats` 接口。

### Fixed / 修复

- **🔥 GM Data Flickering Between Poll Paths / GM 数据在双轮询路径间闪烁**: Fixed critical bug where GM data in the model statistics panel flickered on/off every few seconds. Root cause: `pollContextUsage` (5s) called `updateMonitorPanel` *without* GM overrides, while `pollActivity` (3s) called it *with* GM data — the context poll overwrote the activity poll's GM data. Fix: `getSummary()` now uses persistent `_gmTotals`/`_gmModelBreakdown` caches populated by `injectGMData()`, and the redundant global override in `pollActivity()` was removed.
  修复严重 Bug：模型统计面板中的 GM 数据每隔几秒闪烁消失。根因：`pollContextUsage`（5s）和 `pollActivity`（3s）分别调用 `updateMonitorPanel`，前者不带 GM 数据，覆盖了后者注入的 GM 数据。修复：`getSummary()` 使用 `injectGMData()` 填充的持久缓存，移除 `pollActivity()` 中的冗余全局覆盖。

- **🔥 Sub-Agent Data Stale After Reload / 重载后子智能体数据过时**: Fixed critical bug where sub-agent data (FLASH_LITE) only showed data for the first checkpoint or went missing entirely after extension reload. `restore()` migration logic was too lenient — it didn't trigger re-warm-up when `subAgentTokens` contained stale data or when new GM persistence fields were absent. Now checks `subAgentTotalCount < totalCheckpoints * 0.5` and `!data.gmTotals` as additional nuclear reset triggers.
  修复严重 Bug：子智能体数据（FLASH_LITE）在扩展重载后仅显示第一个 checkpoint 数据或完全消失。`restore()` 迁移逻辑过于宽松。现在额外检查子智能体计数比和 GM 持久化字段缺失作为 nuclear reset 触发条件。

- **Nuclear Reset Missing `_sampleDist` Cleanup / Nuclear Reset 遗漏清理采样分布**: Fixed anti-intuitive bug where `archiveAndReset()` and the nuclear reset path in `restore()` did not clear `_sampleDist` and `_sampleTotal`. Stale sampling distribution ratios from before the reset could pollute step type estimation after re-warm-up.
  修复反直觉 Bug：`archiveAndReset()` 和 `restore()` 的 nuclear reset 路径未清理 `_sampleDist`/`_sampleTotal` 采样分布，导致旧的采样比例可能影响 re-warm-up 后的步骤类型估算。

- **🔥 GM Data Duplication on Quota Reset / 额度重置时 GM 数据重复**: Fixed critical bug where `gmTracker` and `lastGMSummary` were never reset during quota cycles. This caused the same full GM dataset and associated per-model costs to be archived into `dailyStore` on every quota reset, producing duplicate entries in the calendar. Now `gmTracker.reset()` + `lastGMSummary = null` are called after `dailyStore.addCycle()`, ensuring each cycle archives its own GM data and starts fresh.
  修复严重 Bug：`gmTracker` 和 `lastGMSummary` 在额度周期中从不清零，导致每次额度重置都将相同的完整 GM 数据和费用写入日历，产生重复记录。现在在 `dailyStore.addCycle()` 后调用 `gmTracker.reset()` + `lastGMSummary = null`，确保每个周期独立归档、从零开始。

- **GM Cache Full-Clear on Quota Reset / 额度重置时 GM 缓存完整清零**: `gmTracker.reset()` now clears `_cache` (all cached conversation GM data) in addition to `_lastSummary`. Previously, the cache was intentionally preserved to avoid re-fetching, but this caused the GM panel to re-aggregate ALL historical calls after a reset — appearing as if data never zeroed out. Activity Tracker correctly baselines per-cycle but GM did not. Calendar already archives the pre-reset GM snapshot via `dailyStore.addCycle()`, so no data is lost. The one-time RPC re-fetch cost on next poll is negligible (quota resets occur every 5h–7d).
  `gmTracker.reset()` 现在完整清空 `_cache`（所有缓存的 GM 对话数据）。此前缓存保留是为了避免重复拉取 RPC，但导致 GM 面板在重置后重新聚合全部历史调用——看起来永远不归零。Activity 正确按周期基线切割，GM 却没有。日历已通过 `dailyStore.addCycle()` 归档重置前快照。下次轮询的一次性 RPC 重拉代价可忽略。

- **Monitor Tab Scroll Jumping to Middle / 监控面板滚动跳到中间**: Fixed page-level scroll jumping to wrong position on Monitor tab during auto-refresh. Root cause: `innerHTML` replacement collapsed `<details>` elements (Raw JSON ~10KB), drastically shrinking page height. The subsequent `scrollTop` read on inner elements forced a browser layout at the wrong height, permanently adjusting page scroll. Fix: reordered the `updateTabs` handler to restore `details[id]` open states **immediately** after `innerHTML` swap, before any layout-forcing DOM reads.
  修复监控面板自动刷新时页面滚动跳到中间。根因：`innerHTML` 替换使 `<details>` 塌缩（Raw JSON ~10KB）→ 页面高度骤缩 → `scrollTop` 读取强制布局 → 浏览器调整滚动。修复：`updateTabs` 中 details 恢复提前到 innerHTML 替换紧跟之后。

- **Inner Scrollable Element State Loss / 内部可滚动元素状态丢失**: Fixed inner scroll position of `.raw-json`, `.act-timeline`, `.details-body` elements resetting to top on each auto-refresh. These elements have their own scrollbars (CSS `overflow`) — when their parent `innerHTML` is replaced, the new elements start at `scrollTop: 0`. Fix: save `scrollTop` of all known scrollable selectors before DOM swap, restore after details are reopened.
  修复 `.raw-json` 等内部可滚动元素的滚动位置在每次刷新时归零。在 DOM 替换前保存、details 恢复后还原。

- **Per-Tab Page Scroll Persistence / 逐标签页滚动位置保持**: `switchTab()` now saves the outgoing tab's `window.scrollY` into `tabScrolls[tab]` and restores the incoming tab's scroll position via double `requestAnimationFrame` + `setTimeout` fallback for layout stabilization. Guards against saving `scrollY = 0` during DOM teardown.
  `switchTab()` 切换标签页时保存/恢复逐标签页的页面滚动位置。双 `requestAnimationFrame` + `setTimeout` 后备确保布局稳定后再恢复。

- **🔥 stepIndex Absolute Index Alignment / stepIndex 绝对索引对齐**: Fixed critical bug where `_recentSteps` used 0-based array indices as `stepIndex` while GM `stepIndices` used absolute conversation indices. When Steps API returns a windowed subset (e.g., 416 of 576 steps), the array index `[0..415]` misaligned with GM's `[160..575]`. Now all 5 stepIndex assignment sites use `offset = totalSteps - fetchedSteps.length` to produce absolute indices, enabling correct GM annotation and virtual event generation.
  修复严重 Bug：`_recentSteps` 的 `stepIndex` 使用 0-based 数组下标，而 GM 使用绝对索引。当 Steps API 返回窗口子集时（如 576 步返回 416），数组下标 `[0..415]` 与 GM 的 `[160..575]` 无法对齐。现在 5 处 stepIndex 赋值全部使用 `offset = totalSteps - fetchedSteps.length` 计算绝对索引。

- **Timeline GM Tags Reasoning-Only / 时间线 GM 标签仅 reasoning 显示**: GM precision tags (IN/OUT/TTFT/cache) now only display on 🧠 reasoning steps. Tool steps sharing the same LLM call no longer show duplicate GM data, reducing visual noise.
  GM 精确数据标签（IN/OUT/TTFT/cache）现在仅在 🧠 reasoning 步骤显示。共享同一 LLM 调用的工具步骤不再重复显示。


### Changed / 变更

- **Sub-Agent Card Enhancement / 子智能体卡片增强**: `SubAgentTokenEntry` interface extended with `cacheReadTokens`, `compressionEvents`, and `lastInputTokens` fields. Activity panel sub-agent card now displays: Cache Read tokens, Avg Input per Checkpoint (computed), and compression event count (when > 0, shown in orange). Compression detection uses ≥30% inputTokens drop between consecutive checkpoints.
  `SubAgentTokenEntry` 接口新增 `cacheReadTokens`、`compressionEvents`、`lastInputTokens` 字段。活动面板子智能体卡片新增显示：缓存读取 token、每检查点平均输入（计算值）、压缩次数（>0 时橙色高亮）。压缩检测标准：相邻检查点 inputTokens 下降 ≥30%。

- **`daily-store.ts`**: Added `GMModelCycleStats` interface with `estimatedCost` field. `addCycle()` now accepts `costPerModel` parameter to archive per-model cost breakdown alongside GM model breakdown.
  新增 `GMModelCycleStats` 接口（含 `estimatedCost` 字段）。`addCycle()` 新增 `costPerModel` 参数，归档逐模型费用明细。

- **`extension.ts`**: `onQuotaReset` callback now extracts per-model costs from `pricingStore.calculateCosts()`, passes them to `dailyStore.addCycle()`, then resets GM state (`gmTracker.reset()` + `lastGMSummary = null` + persist). GM state also saved in dispose and 30s throttle.
  `onQuotaReset` 回调现提取逐模型费用并传入 `dailyStore.addCycle()`，随后清零 GM 状态并持久化。dispose 和 30s 节流中也保存 GM。

- **History Tab → Quota Tracking / 历史 → 额度追踪**: Renamed "History" tab to "Quota Tracking" (额度追踪). Removed archived quota sessions and usage history sections (migrated to Calendar). Tab now only contains quota tracking toggle and active tracking.
  「历史」标签更名为「额度追踪」。移除归档历史和使用历史区块（已迁移至日历）。标签仅保留额度追踪开关和活跃追踪。

- **Removed `buildArchiveHistory` / 移除归档历史构建函数**: Deleted `buildArchiveHistory()` and `formatDateShort()` from `activity-panel.ts`, along with Archive History CSS (~140 lines). Data now fully served by Calendar tab via `DailyStore`.
  从 `activity-panel.ts` 删除 `buildArchiveHistory()`、`formatDateShort()` 及 Archive History CSS（约 140 行）。数据已由日历标签的 `DailyStore` 完全承载。

- **`webview-panel.ts`**: Registered Calendar as 8th tab, added calendar CSS, DailyStore parameter, month navigation and clear history message handlers.
  注册日历为第 8 个标签页，集成 CSS、DailyStore 参数、月份导航和清空历史消息处理。

- **`webview-script.ts`**: Replaced per-element click handlers with event delegation on `document.body` using `target.closest()` for robust child-element detection. Added `calendarSelectedDate` to `vscode.setState()` persistence — expanded panel and cell highlight now survive auto-refresh. Restored panels skip `calFadeIn` animation to prevent visual flicker.
  使用 `document.body` 事件委托替代逐元素绑定，`closest()` 精确匹配。展开日期存入 `vscode.setState()` — 面板自动刷新不再丢失展开状态。恢复时跳过淡入动画避免闪烁。



### Added / 新增

- **Pricing Tab — Model DNA & Custom Pricing / 价格标签页 — 模型 DNA 与自定义定价**: New "Pricing" tab in WebView panel. Displays model DNA cards (completionConfig, tools, promptSections, systemPrompt indicator, error/retry counts), cost estimation table, and **editable** custom pricing inputs with globalState persistence.
  WebView 面板新增「价格」标签页。展示模型 DNA 卡片、费用估算表、**可编辑**自定义价格输入（通过 globalState 持久化）。

- **`pricing-store.ts` — Pricing Data Layer / 定价数据层**: New module managing pricing data: DEFAULT_PRICING table (5 active models, sourced from official Claude/Google Cloud docs as of 2026-03-22), 3-tier fuzzy model lookup, cost calculation engine, PricingStore class with globalState persistence.
  新增定价数据层：DEFAULT_PRICING 表（5 个活跃模型，来源官方定价文档 2026-03-22）、三级模糊匹配、费用计算引擎、globalState 持久化。

- **`pricing-panel.ts` — Pricing UI Builder / 定价 UI 构建器**: New module rendering Pricing tab HTML: model DNA grid cards, cost summary table, editable pricing form with save/reset buttons.
  新增渲染价格标签页 HTML：模型 DNA 网格卡片、费用概要表、可编辑价格表单（含保存/重置按钮）。

- **Model DNA Capture / 模型 DNA 捕获**: Extended `gm-tracker.ts` GMCallEntry/GMModelStats interfaces with: `completionConfig` (maxTokens, temperature, topK/topP, stopPatterns), `systemPromptSnippet`, `toolNames`/`toolCount`, `promptSectionTitles`, `retries`, `errorMessage`/`errorCount`. New `GMCompletionConfig` interface and `parseCompletionConfig()` parser.
  扩展 `gm-tracker.ts` 接口，新增模型 DNA 字段和解析器。

### Refactored / 重构

- **Pricing code migrated from `gm-panel.ts`**: Removed legacy `DEFAULT_PRICING` table, `ModelPricing` interface, `findPricing()`, `buildCostSummary()`, `buildPricingTable()`, and all related CSS from `gm-panel.ts` (552 → 279 lines). All pricing/cost functionality now lives in `pricing-store.ts` + `pricing-panel.ts`.
  价格代码从 `gm-panel.ts` 迁移：删除旧的 DEFAULT_PRICING、ModelPricing 接口、findPricing、buildCostSummary、buildPricingTable 及相关 CSS（552 → 279 行）。所有价格/费用功能现在位于独立模块。

- **Removed built-in pricing reference section**: Deleted `buildBuiltInReference()` collapsible table from `pricing-panel.ts`. Default prices now shown inline in the editable table with "Built-in" source indicator.
  删除内置价格参考折叠区块。默认价格现在在可编辑表格中内联显示，标注「内置」来源。



### Added / 新增

- **GM Data Tab — Generator Metadata Analytics / GM 数据标签页 — 生成器元数据分析**: New "GM Data" tab in the WebView panel that calls `GetCascadeTrajectoryGeneratorMetadata` to fetch per-LLM-call data across all conversations. Displays 8 UI sections: Summary Bar, Model Cards, Cost Estimate, Performance Baseline, Cache Efficiency, Context Growth, Conversation Distribution, and Pricing Reference Table.
  WebView 面板新增「GM Data」标签页，调用 `GetCascadeTrajectoryGeneratorMetadata` 获取所有对话的逐次 LLM 调用数据。展示 8 个 UI 区块：汇总栏、模型卡片、费用估算、性能基线、缓存效率、上下文增长、对话分布、价格参考表。

- **Cost Estimation / 费用估算**: Per-model cost breakdown table calculating USD costs from token counts × public API pricing. Supports 5 token types: Input, Output, Cache Read, Cache Write, Thinking. Hover tooltips show raw token counts and per-token prices. Grand Total aggregated across all models.
  按模型费用明细表，使用 token 数 × 公开 API 价格计算 USD 费用。支持 5 种 token 类型：输入、输出、缓存读取、缓存写入、思考。悬停提示显示原始 token 数和单价。跨模型汇总总计。

- **Dynamic Pricing Reference Table / 动态价格参考表**: Pricing table dynamically displays only models captured in the current session — no hardcoded model list. Auto-matches prices from `pricing-store.ts` `DEFAULT_PRICING`; unmatched models show $0 with editable inputs in the Pricing tab.
  价格参考表仅动态展示当前会话捕捉到的模型。自动从 `pricing-store.ts` 匹配价格；未匹配模型显示 $0，可在 Pricing 标签页编辑。

- **`gm-tracker.ts` — GM Data Layer / GM 数据层**: New module (325 lines) implementing `GMTracker` class. Calls `GetCascadeTrajectoryGeneratorMetadata` RPC, parses `generatorMetadata[]` entries (stepIndices, responseModel, usage, TTFT, streaming duration, cache tokens, consumed credits), aggregates per-model stats (`GMModelStats`) and per-conversation data (`GMConversationData`), produces `GMSummary` for the panel layer. Includes smart caching to avoid redundant RPC calls.
  新增模块（325 行），实现 `GMTracker` 类。调用 `GetCascadeTrajectoryGeneratorMetadata` RPC，解析 `generatorMetadata[]` 条目（stepIndices、responseModel、usage、TTFT、流式时长、缓存 token、消耗积分），聚合每模型统计和每对话数据，生成 `GMSummary` 供面板层使用。包含智能缓存避免重复 RPC 调用。

- **`gm-panel.ts` — GM Data Panel / GM 数据面板**: New module (~280 lines) generating HTML for the GM Data tab. 6 builder functions: `buildSummaryBar`, `buildModelCards`, `buildPerformanceBaseline`, `buildCacheEfficiency`, `buildContextGrowth`, `buildConversationList`. CSS variables for styling, SVG charts for cache/context visualizations.
  新增模块（~280 行），生成 GM Data 标签页的 HTML。6 个构建函数。CSS 变量样式体系，SVG 图表用于缓存/上下文可视化。

### Documentation / 文档

- Updated `docs/ls-monitor-technical-notes.md`: Added `GetCascadeTrajectoryGeneratorMetadata` to RPC endpoint table. Added 5 new tech notes (#27-#31): generatorMetadata full structure, responseModel vs generatorModel precision, consumedCredits rules, cost estimation design, cacheCreationTokens vs cacheReadTokens.
  更新技术文档：RPC 端点表新增 `GetCascadeTrajectoryGeneratorMetadata`。新增 5 条技术笔记（#27-#31）：generatorMetadata 完整结构、responseModel 精度差异、积分规则、费用估算设计、缓存 token 区别。

- Updated `docs/project_structure.md`: Added `gm-tracker.ts`, `gm-panel.ts` module descriptions. Updated dependency graph and data flow diagram. Added `diag-scripts/` directory.
  更新项目结构文档：新增 `gm-tracker.ts`、`gm-panel.ts` 模块说明。更新依赖关系图和数据流图。补充 `diag-scripts/` 目录。

## [1.12.2] - 2026-03-21

### Fixed / 修复

- **🔥 Quota Reset Archive Fragmentation / 额度重置归档碎片化**: Refactored `onQuotaReset` callback from parameterless `() => void` to `(modelIds: string[]) => void`. Previously, each model's quota reset independently triggered `archiveAndReset()`, causing fragmented archives when multiple models in the same quota pool (e.g., Gemini Pro High + Low) reset simultaneously. Now `processUpdate()` batches all resets into a single callback with the full list of reset model IDs.
  重构 `onQuotaReset` 回调签名，从无参 `() => void` 改为 `(modelIds: string[]) => void`。此前同配额池内多模型（如 Gemini Pro High + Low）同时重置时各自独立触发归档，产生碎片化归档。现在 `processUpdate()` 在循环结束后批量收集所有重置模型，一次性触发回调。

- **Archive Debounce for Cross-Pool Resets / 跨池重置防抖合并**: Added 5-minute debounce interval (`MIN_ARCHIVE_INTERVAL_MS`) to `archiveAndReset()`. When different quota pools (e.g., Gemini pool and Claude pool) reset within 5 minutes of each other, the second archive merges into the first instead of creating a separate entry. Beyond 5 minutes, independent archives are created correctly.
  `archiveAndReset()` 新增 5 分钟防抖间隔。不同配额池（如 Gemini 池和 Claude 池）在 5 分钟内先后重置时，第二次归档合并到第一条而非创建独立条目。超过 5 分钟则正确创建独立归档。

- **Remote WSL Workspace Matching / 远程 WSL 工作区匹配**: `normalizeUri()` now strips `vscode-remote://` scheme+authority (e.g., `vscode-remote://wsl+Ubuntu/path` → `/path`) before comparison, so trajectory workspace filtering works correctly when the extension runs on the local (UI) side via `extensionKind`. `buildExpectedWorkspaceId()` similarly reconstructs remote URIs as `file://` before transformation. Previously, workspace matching silently failed in Remote-WSL, causing the panel to show "idle" with 0k/1M even though the LS was successfully connected.
  `normalizeUri()` 现在会剥离 `vscode-remote://` 协议和 authority（如 `vscode-remote://wsl+Ubuntu/path` → `/path`），使得扩展在本地（UI 端）运行时工作区过滤正确匹配。`buildExpectedWorkspaceId()` 同样将远程 URI 重构为 `file://` 后再转换。此前远程 WSL 下工作区匹配静默失败，导致面板显示"空闲"和 0k/1M，尽管 LS 已成功连接。

### Added / 新增

- **Archive Trigger Source Tracking / 归档触发来源追踪**: `ActivityArchive` interface now includes `triggeredBy?: string[]` field recording which model ID(s) triggered each archive. Backward compatible with older archives lacking this field.
  `ActivityArchive` 接口新增 `triggeredBy?: string[]` 字段，记录每条归档由哪些模型 ID 触发。向后兼容不含此字段的旧归档。

### Improved / 改进

- **Activity Panel SVG Icon Consistency / 活动面板 SVG 图标统一**: Replaced all remaining Emojis (🧠⚡💾❌📊🪙⏱∑🌐🔍📂📄✏️📋) in model stats, timeline, archive history, and accuracy notes with consistent inline SVG icons. Only the main status bar retains native Emojis for maximum visibility.
  活动面板中模型统计、时间线、归档历史、精度说明的所有残余 Emoji 统一替换为内联 SVG 图标。仅主状态栏保留原生 Emoji 以确保最高可见性。

- **Activity Panel Four-Section Layout / 活动面板四板块布局**: Reorganized the Activity tab into four logical sections: ① Summary + Recent Activity, ② Model Stats, ③ Model Distribution + Tool Ranking, ④ Context Growth + Conversation Breakdown. Uses CSS Grid two-column layout with `auto-fit` responsive breakpoints.
  活动标签页重组为四个逻辑板块，使用 CSS Grid 双列布局 + `auto-fit` 响应式断点。

- **Summary Stat Tooltips / 快捷统计悬浮提示**: Each stat cell in the summary bar now has a `data-tooltip` hover tooltip (CSS `::after` pseudo-element) with bilingual descriptions.
  汇总栏每个统计格子新增 `data-tooltip` 悬浮提示（CSS `::after` 伪元素），中英双语说明。

- **Model Name Word-Wrap / 模型名自动换行**: Long model names in card headers now wrap instead of being truncated (`word-break: break-word; overflow-wrap: anywhere`).
  模型卡片标题中的超长模型名自动换行，不再被截断。

- **Archive Stat Chips / 归档统计气泡标签**: Per-model stats in usage history now use `.act-archive-stat-chip` bubble tags with rounded borders, subtle background, and hover highlight for visual separation.
  使用历史中的模型统计数字用气泡标签包裹（圆角边框 + 微妙背景 + hover 高亮），视觉上清晰分隔。

- **Context Growth Chart Enhancement / 上下文增长图表增强**: Fixed `height: 240px` with `flex: 1` fill. Increased SVG viewBox height, stronger gradient fill (`stop-opacity: 0.5`), and thicker stroke for better visual presence in split layouts.
  固定 240px 高度 + flex 填充。增大 SVG 高度、加深渐变填充、加粗折线，改善分栏布局中的视觉效果。

- **Monitor Panel Responsive Stat Grid / 监控面板响应式统计网格**: `.stat-grid` upgraded to `repeat(auto-fit, minmax(...))` for fluid column layout across different panel widths.
  `.stat-grid` 升级为流式自适应列布局。

### Removed / 移除

- **Activity Status Bar Item / 活动状态栏指标**: Removed the secondary status bar item (`ActivityStatusBarItem`) and its `statusBar.showActivity` configuration. The Activity tab is now accessed via the main status bar or command palette.
  移除第二状态栏指标及其 `statusBar.showActivity` 配置项。活动标签页现通过主状态栏或命令面板访问。

### Tests / 测试

- Added batching behavior test to `quota-tracker.test.ts`: verifies same-pool multi-model reset produces single callback with all model IDs.
  在 `quota-tracker.test.ts` 新增批量行为测试：验证同池多模型重置产生单次回调。
- Total test count: 67.
  测试总数：67。

## [1.12.1] - 2026-03-21

### Fixed / 修复

- **Remote WSL "LS not found" Fix / 远程 WSL「LS 未找到」修复**: Added `extensionKind: ["ui", "workspace"]` to `package.json`, telling VS Code to prefer running the extension on the **local (UI) side** where the Antigravity Language Server process lives. Previously, when connecting to WSL via VS Code Remote-WSL or Remote SSH, the extension defaulted to running on the remote side (`extensionKind` was missing, defaulting to `["workspace"]`), where no LS process exists — causing perpetual "LS not found" status. Users only need to reinstall the updated VSIX; no additional configuration required.
  在 `package.json` 中添加 `extensionKind: ["ui", "workspace"]`，告知 VS Code 优先在**本地（UI 端）**运行扩展——即 Antigravity 语言服务器进程所在的一侧。此前通过 VS Code Remote-WSL 或 Remote SSH 连接 WSL 时，扩展默认运行在远程端（`extensionKind` 缺失，默认为 `["workspace"]`），远程端没有 LS 进程，导致持续显示"LS not found"。用户只需重装新版 VSIX，无需额外配置。

### Improved / 改进

- **Remote Workspace URI Logging / 远程工作区 URI 日志**: `getWorkspaceUri()` now logs when a `vscode-remote://` workspace URI is detected, aiding diagnostics for remote connection scenarios.
  `getWorkspaceUri()` 现在在检测到 `vscode-remote://` 工作区 URI 时记录日志，便于远程连接场景的诊断排查。

## [1.12.0] - 2026-03-21

### Added / 新增

- **WSL (Windows Subsystem for Linux) Support / WSL 支持**: Full support for running the extension inside WSL via VS Code Remote-WSL. The extension now detects WSL environment via `/proc/version`, and uses Windows-side tools (`WMIC.exe`, `powershell.exe`, `netstat.exe`) through WSL interop for Language Server process and port discovery. Previously, the extension showed "LS not found" in WSL because Linux `ps` cannot see Windows host processes.
  WSL 环境下使用 VS Code Remote-WSL 时，扩展现已完全支持。扩展通过 `/proc/version` 检测 WSL 环境，并利用 WSL 互操作机制调用 Windows 端工具（`WMIC.exe`、`powershell.exe`、`netstat.exe`）进行语言服务器的进程和端口发现。此前在 WSL 中扩展因 Linux `ps` 无法看到 Windows 宿主进程而显示"LS not found"。

- **`isWSL()` Detection Function / `isWSL()` 检测函数**: New exported function in `discovery.ts` that detects WSL by reading `/proc/version` for Microsoft/WSL signatures. Result is cached for performance (file I/O only once).
  `discovery.ts` 中新增导出函数，通过读取 `/proc/version` 检测 Microsoft/WSL 签名。结果缓存以避免重复文件 I/O。

### Improved / 改进

- **Cross-Environment Process Discovery / 跨环境进程发现**: `discoverWindowsProcesses()` now dynamically selects executable paths — `/mnt/c/Windows/System32/wbem/WMIC.exe` in WSL vs `wmic` on native Windows. Port discovery similarly uses `/mnt/c/Windows/System32/netstat.exe` when in WSL.
  `discoverWindowsProcesses()` 现在动态选择可执行文件路径——WSL 中使用 `/mnt/c/Windows/System32/wbem/WMIC.exe`，原生 Windows 使用 `wmic`。端口发现同理，WSL 中使用 `/mnt/c/Windows/System32/netstat.exe`。

- **WSL-Aware Workspace ID / WSL 感知的工作区 ID**: `buildExpectedWorkspaceId()` now applies Windows-style transformations (colon hex-encoding `_3A_`, double-underscore collapse) when running in WSL, matching the Windows host LS's encoding.
  `buildExpectedWorkspaceId()` 在 WSL 中运行时应用 Windows 风格的转换（冒号十六进制编码 `_3A_`、连续下划线折叠），与 Windows 宿主 LS 的编码匹配。

### Tests / 测试

- Added `isWSL()` and `extractPortFromSs()` tests in `discovery.test.ts`.
  在 `discovery.test.ts` 中新增 `isWSL()` 和 `extractPortFromSs()` 测试。
- Total test count: 42 (was 40 in v1.11.3).
  测试总数：42（v1.11.3 为 40）。


## [1.11.3] - 2026-03-20

### Added / 新增

- **Independent Activity Polling / 独立 Activity 轮询**: Activity tracking now runs on a separate 3-second polling loop (`pollActivity()`), decoupled from the global 5-second poll. Changes trigger immediate UI refresh.
  Activity 追踪现在运行在独立的 3 秒轮询循环中（`pollActivity()`），与全局 5 秒轮询解耦。变化时立即刷新 UI。

- **Tool Name Display / 工具名称显示**: Timeline now prominently displays the tool name for each tool call (e.g., `gh/search_issues`, `view_file`, `run_command`). MCP tool names are extracted with namespace prefix.
  时间线现在为每个工具调用醒目显示工具名称（如 `gh/search_issues`、`view_file`）。MCP 工具名称提取含命名空间前缀。

- **Step Index Display / 步骤序号显示**: Each timeline entry shows its step index badge (e.g., `#142`), matching the LS internal step numbering for easier cross-referencing with diagnostic tools.
  时间线每条记录显示步骤序号标签（如 `#142`），与 LS 内部编号一致，方便与诊断工具交叉对照。

- **Diagnostic Scripts Documentation / 诊断脚本文档化**: Added comprehensive documentation for `diag-verify.ts` (static data integrity checks, 6 verification phases) and `diag-monitor.ts` (real-time step monitoring) in technical notes.
  在技术文档中新增 `diag-verify.ts`（静态完整性检查，6 个验证阶段）和 `diag-monitor.ts`（实时步骤监视）的完整文档。

- **Status Bar Activity Display Mode / 状态栏活动显示模式**: New `statusBar.activityDisplayMode` setting with radio buttons in the Settings tab. Choose between `global` (all models combined) and `currentModel` (stats for the active model only).
  新增 `statusBar.activityDisplayMode` 设置，设置页提供单选按钮切换。可选择「全局」（所有模型合计）或「当前模型」（仅显示当前使用模型的统计）。

- **Context Growth Trend / 上下文增长趋势图**: SVG area chart visualizing inputTokens across all CHECKPOINTs. Compression events (≥30% inputTokens drop) marked with red circles. Displayable when ≥2 checkpoints exist.
  SVG 面积图展示所有 CHECKPOINT 的 inputTokens 变化趋势。压缩事件（inputTokens 下降 ≥30%）以红色圆点标记。

- **Tool Ranking / 工具排行**: Top 10 tool usage visualized as CSS horizontal bar chart with 10-color rainbow palette (CSS classes, CSP-safe). Each bar's count displayed in matching color.
  Top 10 工具调用可视化为 CSS 水平条形图，10 色彩虹色阶（CSS class 定义，CSP 安全）。数字同色显示。

- **Conversation Breakdown / 对话分布**: Per-conversation stats showing step count and token usage (input/output). Tokens extracted from last CHECKPOINT cumulative snapshot.
  按对话维度统计步骤数和 token 用量（输入/输出），token 取自最后 CHECKPOINT 累积快照。

- **Summary Bar Enhancement / 汇总栏增强**: CSS Grid card layout with session duration, checkpoint count, toolReturnTokens. All emoji icons replaced with semantically accurate inline SVGs (lightbulb for reasoning, arrows for input/output).
  CSS Grid 卡片布局，新增会话时长、检查点数、工具返回 token。所有 emoji 图标替换为语义准确的 inline SVG（灯泡=推理、箭头=输入/输出）。

### Improved / 改进

- **RUNNING-Only Step Fetching / 仅拉取 RUNNING 对话步骤**: Incremental updates now only fetch steps for `RUNNING` conversations, skipping already-processed IDLE ones. Reduces unnecessary API calls.
  增量更新现在仅对 RUNNING 对话拉取步骤，跳过已处理的 IDLE 对话。减少不必要的 API 调用。

- **Precise Incremental Capture / 精确增量捕获**: Incremental path now re-fetches steps via `GetCascadeTrajectorySteps` instead of relying on `stepCount` delta estimation. Only steps beyond the API window (~500) use delta estimation.
  增量路径现在重新调用 `GetCascadeTrajectorySteps` 拉取步骤，而非依赖 `stepCount` delta 估算。仅超出 API 窗口的步骤使用估算。

- **Model Stats Accuracy Disclaimer / 模型统计精度说明**: When estimated steps exist, a note is shown below the "Model Stats" title clarifying that reasoning/tool/error counts are precisely recorded, while steps beyond the API window are estimates.
  当存在估算步骤时，在"模型统计"标题下方显示说明：推理回复、工具调用、错误等为精准记录；超出 API 窗口的为估算值。

- **Faster Quota Status Refresh / 额度状态快速刷新**: `STATUS_REFRESH_INTERVAL` reduced from 6 to 2 (user status now refreshes every ~10 seconds instead of ~30s), enabling quicker detection of quota changes reported by the API.
  `STATUS_REFRESH_INTERVAL` 从 6 降至 2（用户状态刷新间隔从约 30 秒缩短至约 10 秒），更快检测到 API 报告的额度变化。

### Fixed / 修复

- **Activity Panel Migration / 活动面板数据迁移**: Fixed missing data for context trend and conversation breakdown after upgrading. Three migration triggers in `restore()` force re-warm-up: missing subAgentTokens, empty checkpointHistory, or all-zero conversationBreakdown (caused by wrong field path `meta.cortexStepType` → corrected to `step.type`).
  修复升级后上下文趋势和对话分布数据缺失。`restore()` 中三个迁移条件强制 re-warm-up：缺少 subAgentTokens、checkpointHistory 为空、conversationBreakdown 全零（字段路径 `meta.cortexStepType` → 修正为 `step.type`）。

- **Tool Ranking Bar Rendering / 工具排行条形不渲染**: Fixed invisible bar chart caused by `<span>` elements lacking `display: block`. Added CSS class-based 10-color palette to avoid CSP-blocked inline styles.
  修复条形图不可见问题：`<span>` 元素缺少 `display: block` 导致 `width`/`height` 无效。颜色改用 CSS class 避免 CSP 阻止 inline style。

- **🔥 Ghost Model Attribution / 幽灵模型归属**: Fixed critical bug where `CHECKPOINT.modelUsage.model` always reported `MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE` regardless of the actual generating model, causing all token stats to be attributed to Flash Lite. Diagnosis across 5 conversations (29 CHECKPOINTs) confirmed 100% ghost attribution. Token attribution now uses `contextModel` (detected from `generatorModel` of surrounding steps) with priority: `contextModel` > `generatorModel` > `modelUsage.model` (fallback).
  修复关键 Bug：`CHECKPOINT.modelUsage.model` 始终报告 `FLASH_LITE`，与实际生成模型无关，导致所有 token 统计被错误归属。经 5 个对话（29 个 CHECKPOINT）诊断确认 100% 命中幽灵归属。Token 归属改用 `contextModel`（从相邻步骤的 `generatorModel` 检测），优先级：`contextModel` > `generatorModel` > `modelUsage.model`（兜底）。

- **🤖 Sub-Agent Token Transparency / 子智能体 Token 透明展示**: CHECKPOINT's `modelUsage.model` (e.g. Gemini 2.5 Flash Lite) is now tracked as sub-agent token consumption when it differs from the main generating model. A new "Sub-Agent Tokens" section appears in the Activity panel showing the sub-agent's display name, token counts (in/out), and checkpoint count. This makes the sub-agent's resource usage fully visible instead of hidden.
  当 CHECKPOINT 的 `modelUsage.model`（如 Flash Lite）与主生成模型不同时，现在作为子智能体 token 消耗单独追踪。活动面板新增"子智能体消耗"区域，展示模型名、Token 统计和检查点数量。子智能体资源消耗从此完全透明可见。

- **🔥 Instant Usage Detection at 100% / 100% 即时使用检测**: Completely reworked dynamic usage detection with three-layer strategy. **Layer 1 (Instant)**: On the very first poll, calculates `elapsedInCycle = maxTimeToReset − thisTimeToReset` across all models; if ≥10 min → model is immediately tracked with backDated startTime. **Layer 2 (Drift)**: If resetTime stays locked (no API refresh) for ≥10 min → model is tracked. **Layer 3 (Fraction)**: fraction < 100% → immediate tracking. Previously required waiting 10 minutes before any detection. *Verified over a full 5-hour live cycle with Claude + Flash models.*
  彻底重构动态使用检测，三层策略：**即时层**——首次 poll 即通过 `elapsedInCycle = maxTimeToReset − thisTimeToReset` 判断，≥10 分钟立即追踪并回溯开始时间；**Drift 层**——resetTime 锁定 10 分钟后触发；**Fraction 层**——fraction < 100% 直接追踪。此前需等待 10 分钟才能检测。*经 5 小时实机验证。*

- **Cycle Start Backdating / 周期开始时间回溯**: Both instant detection (100%) and fraction-drop detection (<100%) now backdate the session `startTime` to the estimated cycle start (`resetTime − maxTimeToReset`) instead of using the current poll time. Previously, sessions started at "now" which was misleading.
  即时检测（100%）和额度下降检测（<100%）路径现在都将 session 的 `startTime` 回溯到推算的周期开始时间（`resetTime − maxTimeToReset`），而非使用当前轮询时间。此前 session 从"当前时间"开始，具有误导性。

- **Persist/Restore Missing Fields / 持久化字段缺失**: Fixed `persist()` silently dropping `lastResetTime`, `baselineResetTime`, and `idleSince` from serialized ModelState. Added backward-compatible `restore()` backfill for older state data. Without these fields, dynamic detection logic produced incorrect drift calculations after extension reload.
  修复 `persist()` 序列化时静默丢失 `lastResetTime`、`baselineResetTime`、`idleSince` 三个字段的 Bug。为旧版状态数据添加了向后兼容的 `restore()` 回填逻辑。字段缺失导致重载后动态检测的 drift 计算完全错误。

- **Early Quota Tracking / 额度提前追踪**: Fixed critical delay where quota tracking only started after the fraction dropped below 100%. Now uses `isUnusedModel(resetTime)` to detect active models: when `resetTime` drifts more than 10 minutes from a full cycle (indicating usage), a tracking session is created immediately — even while the API still reports 100%. Previously, models could be used for 20+ minutes before any tracking began.
  修复额度追踪仅在 fraction 低于 100% 后才启动的严重延迟问题。现在通过 `isUnusedModel(resetTime)` 检测活跃模型：当 resetTime 偏离满周期超过 10 分钟（表明已被使用）时，立即创建追踪 session——即使 API 仍报告 100%。此前模型可能被使用 20 多分钟后追踪才开始。

- **Tracking State 100% Reset False Positive / 追踪状态 100% 误判重置**: Fixed bug where early-started tracking sessions (at 100%) were immediately archived on the next poll because `fraction >= 1.0` in the `tracking` state was unconditionally treated as a quota reset. Now checks `lastFraction`: if the previous fraction was also 100% (quota hasn't dropped yet), the session continues tracking instead of being falsely archived.
  修复提前启动的追踪 session（100%）在下一次轮询时被立即归档的 Bug。原因是 `tracking` 状态中 `fraction >= 1.0` 被无条件视为额度重置。现在检查 `lastFraction`：如果上一次 fraction 也是 100%（额度尚未下降），session 继续追踪而非被错误归档。

- **New Conversation First Message Delay / 新对话首消息延迟**: Fixed bug where new conversations with initial `stepCount=0` created empty tracking entries, causing the first message to be skipped until the second poll cycle.
  修复新对话 `stepCount=0` 时创建空的追踪条目，导致首条消息在第二次轮询才出现的 Bug。

- **Warm-up Swallows First Message / Warm-up 吞噬首消息**: Fixed warm-up phase consuming all existing steps with `emitEvent=false`, making the first user message invisible in "Recent Activity" timeline. Now injects last 30 steps from RUNNING conversations after warm-up using `_injectTimelineEvent()`.
  修复 Warm-up 阶段用 `emitEvent=false` 处理全部步骤导致首条用户消息不显示的问题。现在 warm-up 后对 RUNNING 对话注入最近 30 步。

- **Conversation Switch / Rollback / Resend Not Recorded / 切换/回退/重发对话不录入**: Fixed `statusChanged` detection being blocked by early skip logic (`currSteps <= processedIndex`). Now detects `IDLE→RUNNING` transitions before any skips, handles `stepCount` decrease (rollback/resend), and injects recent timeline events on conversation resume.
  修复 `statusChanged` 检测被早期跳过逻辑拦截的问题。现在在所有跳过之前检测状态变化，处理 stepCount 减少（回退/重发），切换对话时注入近期时间线事件。

- **Empty Reasoning Steps / 推理步骤空内容**: Reasoning timeline entries with empty `response` now show "正在思考" fallback text when `thinkingDuration` is present, instead of appearing blank.
  推理时间线条目 response 为空时，若存在 `thinkingDuration` 则显示"正在思考"回退文本，不再显示空白行。

- **Thinking Duration Removed from Timeline / 移除时间线思考时间**: Removed per-step thinking duration display from timeline as it was inaccurate with 3-second polling (captures partial values). Aggregate `thinkingTimeMs` in model stats retained.
  移除时间线中每步思考时间显示（3 秒轮询捕获的是部分值，不准确）。模型统计中的聚合 `thinkingTimeMs` 保留。

### Documentation / 文档

- Added gotcha #22 (Ghost Model Attribution) to `docs/ls-monitor-technical-notes.md`.
  在技术文档中新增踩坑记录 #22（幽灵模型归属）。

- Added `diag-conversation.ts` v2.0 diagnostic script with batch analysis capability.
  新增 `diag-conversation.ts` v2.0 诊断脚本，支持批量对话分析。

- Updated `docs/ls-monitor-technical-notes.md`: Architecture diagram reflects dual polling, added 9 new gotcha records (#12-#20), diagnostic scripts section, new step types (TASK_BOUNDARY, NOTIFY_USER).
  更新技术文档：架构图反映双轮询，新增 9 条踩坑记录（#12-#20），诊断脚本章节，新步骤类型。

- Updated `docs/project_structure.md`: Reflects independent polling, diagnostic scripts, 21 step types, tool detail extraction.
  更新项目结构文档：反映独立轮询、诊断脚本、21 种步骤类型、工具详情提取。


- **Model Activity Monitor Panel / 模型活动监控面板**: New Activity tab in the WebView panel that tracks real-time AI model usage across all conversations. Includes model stats cards, operation timeline, model distribution donut chart, and quota linkage view.
  新增活动标签页，实时追踪 AI 模型使用情况。包含模型统计卡片、操作时间线、模型分布环形图和额度联动视图。

- **Activity Status Bar Indicator / 活动状态栏指标**: Second status bar item showing live reasoning count (`🧠`), tool call count (`⚡`), and token consumption (`🪙`). Click to open the activity panel.
  第二个状态栏项，实时显示推理次数、工具调用次数和 Token 消耗。点击打开活动面板。

- **Activity Data Persistence / 活动数据持久化**: Activity tracking data is automatically saved to `globalState` and restored across VS Code sessions. Throttled to max once per 30 seconds to minimize I/O.
  活动追踪数据自动保存并跨会话恢复，写入频率限制为每 30 秒一次。

- **`statusBar.showActivity` Setting / 活动状态栏开关**: New configuration option to toggle the activity indicator visibility in the status bar.
  新增配置项控制状态栏活动指标的显示/隐藏。

- **Quota Reset Auto-Archive / 额度重置自动归档**: When model quota resets (fraction jumps back to 100%), the current activity session is automatically archived to history and stats are reset. Archives are displayed in the Activity tab's new "📋 Usage History" section.
  当模型额度重置（从低值恢复到 100%）时，自动将当前活动数据快照归档到历史，统计清零重新开始。归档记录显示在活动标签页的「📋 使用历史」区域。

- **Full Quota-Cycle Stats / 完整额度周期统计**: Warm-up now processes ALL conversations (including IDLE) to reflect full usage within the current quota cycle. Combined with auto-archive, each quota period produces a complete usage report.
  warm-up 现在处理所有对话（包括 IDLE）以反映当前额度周期内的完整使用情况。配合自动归档，每个额度周期生成一份完整使用报告。

- **Estimated Steps Tracking / 推算步数追踪**: When conversations exceed the LS API's ~500 step retrieval window, additional steps are tracked as a separate `estSteps` counter per model. Clearly distinguished from actual data in the UI with 📊 icon.
  当对话超过 LS API 约 500 步的获取窗口时，额外步骤作为独立的 `estSteps` 计数器按模型记录。在 UI 中以 📊 图标与实际数据明确区分。

- **Per-Trajectory Model Binding / 每对话模型绑定**: Each conversation trajectory now records its dominant model. Estimated steps are attributed directly to the correct model instead of being distributed proportionally across all models.
  每个对话轨迹现在记录其主模型。推算步数直接归属到正确模型，而非按比例分散到所有模型。

- **Estimated Steps Persistence / 推算步数持久化**: `estSteps` and per-trajectory `dominantModel` are now persisted across VS Code restarts via `globalState`.
  `estSteps` 和每条轨迹的 `dominantModel` 现在通过 `globalState` 跨重启持久化。

### Improved / 改进

- **Status Bar → Activity Tab Navigation / 状态栏→活动标签页导航**: Clicking the activity status bar item now correctly opens the monitor panel and switches to the Activity tab via `postMessage`.
  点击活动状态栏项现在会正确打开监控面板并切换到活动标签页。

- **Usage History Redesign / 使用历史重新设计**: Archived usage history now displays each model on its own row with right-aligned stats (🧠/⚡/📊), sorted by step count. Total steps show actual+estimated breakdown.
  使用历史归档现在每个模型独立一行显示，统计数字右对齐（🧠/⚡/📊），按步骤数排序。总计显示实际+推算分拆。

- **Quota Indicator Color Thresholds / 额度指示灯颜色阈值**: Adjusted from (≥60%/≥40%/<40%) to (80-100% 🟢 / 40-60% 🟡 / 0-20% 🔴) for more useful early warning.
  将额度指示灯颜色阈值从 (≥60%/≥40%/<40%) 调整为 (80-100% 🟢 / 40-60% 🟡 / 0-20% 🔴)，提供更有用的早期预警。

- **AI Response Preview Removed / 移除 AI 回复展开预览**: Removed the expandable `<details>` AI response preview from the timeline. Now only shows a brief inline excerpt. Full responses can be viewed in the official tool.
  移除了时间线中 AI 回复的可展开 `<details>` 预览。现在仅显示简短行内摘要，完整回复请使用官方工具查看。

- **WebView Module Split / WebView 模块拆分**: Refactored the monolithic `webview-panel.ts` (1200+ lines) into 8 focused modules: `webview-styles.ts`, `webview-script.ts`, `webview-helpers.ts`, `webview-icons.ts`, `webview-monitor-tab.ts`, `webview-settings-tab.ts`, `webview-profile-tab.ts`, `webview-history-tab.ts`.
  将 1200+ 行的 `webview-panel.ts` 拆分为 8 个职责明确的模块。

### Fixed / 修复

- **Archive Reset Data Integrity / 归档重置数据完整性**: Fixed critical bug where `archiveAndReset()` cleared trajectory baselines causing warm-up to re-count all historical steps.
  修复关键 Bug：`archiveAndReset()` 清除轨迹基线导致 warm-up 重新统计所有历史步骤。

- **Restore Duplicate Events / 恢复时事件重复**: Fixed bug where `restore()` kept old `recentSteps` then warm-up added duplicates.
  修复恢复时旧的 `recentSteps` 与 warm-up 新事件产生重复的 Bug。

- **Estimated Steps Misattribution / 推算步数错误归属**: Fixed bug where estimated steps were distributed proportionally across ALL models instead of only the trajectory's actual model.
  修复推算步数按比例分散到所有模型而非仅归属到对话实际模型的 Bug。

- **Removed Recheck Mechanism / 移除 recheck 机制**: Removed the processedIndex back-by-1 recheck logic for streaming AI responses (no longer needed after removing expandable preview).
  移除为流式 AI 回复设计的 recheck 机制（移除展开预览后不再需要）。

## [1.11.1] - 2026-03-19
### Improved / 改进
- **Card-Style Collapsible Panels / 卡片式折叠面板**: All collapsible sections (quota, features, sessions, raw data, etc.) upgraded from plain dividers to rounded card containers with hover highlights and a custom expand/collapse arrow button.
  所有折叠区域（配额、功能、会话详情、原始数据等）由分割线升级为圆角卡片容器，附带 hover 高亮和自定义展开/折叠箭头按钮。
- **Custom Number Spinners / 自定义数字微调器**: Replaced browser-default number input spinners with custom [−] [+] buttons for all numeric settings (compression threshold, polling interval, model limits).
  所有数字设置（压缩阈值、轮询间隔、模型上限）将浏览器默认上下箭头替换为自定义 [−] [+] 按钮。
### Contributors / 贡献者
- Thanks to [@NightMin2002](https://github.com/NightMin2002) for contributing UI polish ([PR #15](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/15)).
  感谢 [@NightMin2002](https://github.com/NightMin2002) 贡献 UI 美化（[PR #15](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/15)）。

## [1.11.0] - 2026-03-19
### Added / 新增
- **Interactive Settings Dashboard / 交互式设置仪表盘**: Split the WebView panel into dual tabs ('Monitor' and 'Settings'). The new settings page provides an intuitive UI to configure extension behaviors directly.
- **Custom Compression Warning Threshold / 自定义压缩警告阈值**: Added a UI setting to adjust the context compression warning threshold. Default 200K matches Antigravity's internal compression point.
- **Custom Model Context Limits / 自定义模型上下文限制**: Each model's context limit can now be independently overridden directly from the Settings tab.
- **Status Bar Quota Indicator / 状态栏额度指示灯**: Current model's quota percentage is now directly visible on the status bar.
- **Current-Model Reset Countdown / 当前模型重置倒计时**: The status bar countdown now tracks the reset time of the model you are currently using.
- **Status Bar Display Toggles / 状态栏显示开关**: Added toggle switches in the Settings panel for Context Usage, Quota Indicator, and Reset Countdown.
- **Polling Interval UI / 轮询间隔配置**: Modify the polling interval directly from the settings menu.
### Fixed / 修复
- **State Clean-up / 状态清理**: Fixed a minor timer leak by ensuring StatusBarManager properly disposes the reset countdown timer when the extension is deactivated.

## [1.10.3] - 2026-03-17

### Added / 新增

- **Status Bar Quota Summary / 状态栏配额摘要**: Tooltip now includes per-model quota percentages with color indicators (🟢≥60% / 🟡≥40% / 🔴<40%), reset countdown per model, and plan/tier display (Markdown table layout).
  悬浮提示现在包含每模型配额百分比（含颜色指示）、各模型重置倒计时和会员计划显示（Markdown 表格布局）。

- **Auto-Refresh User Status / 自动刷新用户状态**: Model quotas and plan info automatically refresh every ~60 seconds. Data is persisted via `globalState` for instant display on reload.
  模型配额和计划信息每 ~60 秒自动刷新。数据通过 `globalState` 持久化，重启后即时显示。

### Contributors / 贡献者

- Follow-up to [PR #10](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/10) — these changes were committed after the original merge and need to be applied separately.
  [PR #10](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/10) 的后续补充——这些改动在原始合并后提交，需要单独应用。

## [1.10.2] - 2026-03-17

### Fixed / 修复

- **Cross-Platform Workspace ID Hyphen Handling / 跨平台工作区 ID 连字符处理**: `buildExpectedWorkspaceId()` now replaces hyphens (`-`) with underscores (`_`) on **all platforms**, not just Windows. Previously, macOS and Linux users with hyphens in their project folder names (e.g., `my-project`, `schic-diff`) would experience workspace discovery matching the wrong LS process, causing stale data from a different workspace to be displayed.
  `buildExpectedWorkspaceId()` 现在在**所有平台**上将连字符（`-`）替换为下划线（`_`），而非仅在 Windows 上执行。此前，macOS 和 Linux 用户如果项目文件夹名包含连字符（如 `my-project`、`schic-diff`），会导致工作区发现匹配到错误的 LS 进程，显示其他工作区的过时数据。

### Tests / 测试

- Added cross-platform hyphen handling test in `discovery.test.ts`.
  在 `discovery.test.ts` 中新增跨平台连字符处理测试。
- Total test count: 38 (was 37 in v1.10.0).
  测试总数：38（v1.10.0 为 37）。

### Contributors / 贡献者

- Thanks to [@FlorianHuo](https://github.com/FlorianHuo) for reporting and fixing this issue ([PR #12](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/12)).
  感谢 [@FlorianHuo](https://github.com/FlorianHuo) 报告并修复此问题（[PR #12](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/12)）。

## [1.10.1] - 2026-03-16

### Added / 新增

- **WebView Monitor Panel / WebView 监控面板**: Click the status bar to open a full dashboard showing account info, Credits balance, model quotas, feature flags, team config, and Google AI credits — all from the existing `GetUserStatus` API (zero additional network calls).
  点击状态栏打开全景仪表盘，展示账户信息、Credits 余额、模型配额、功能开关、团队配置和 Google AI 额度——全部来自已有的 `GetUserStatus` API 调用（零额外网络请求）。

  ![WebView Monitor Panel](src/images/webview_panel_en.png)

- **Privacy Mask / 隐私遮罩**: Shield button in the panel header masks name and email. State persists across refreshes.
  面板顶部盾牌按钮可遮罩姓名和邮箱，状态跨刷新持久化。

- **Collapsible Sections / 可折叠区域**: Plan Limits, Feature Flags, Team Config, and Google AI Credits are hidden by default in collapsible sections. Open/close state persists.
  计划限制、功能开关、团队配置和 Google AI 额度默认折叠隐藏，展开/收起状态持久化。

- **Status Bar Quota Summary / 状态栏配额摘要**: Tooltip now includes per-model quota percentages with color indicators.
  悬浮提示现在包含每模型配额百分比和颜色指示。

### Changed / 变更

- **showDetails Command Now Opens WebView Panel / showDetails 命令改为 WebView 面板**: Clicking the status bar or running `Show Context Window Details` now opens the WebView side panel instead of the QuickPick popup. The old `showDetailsPanel()` method is preserved but no longer the default entry point.
  点击状态栏或执行 `Show Context Window Details` 命令现在打开 WebView 侧边面板，替代之前的 QuickPick 弹窗。旧的 `showDetailsPanel()` 方法保留但不再作为默认入口。

- **`models.ts` Interface Expansion / `models.ts` 接口扩展**: `ModelConfig` extended with `quotaInfo`, `allowedTiers`, `tagTitle`, `mimeTypeCount` fields. Added `QuotaInfo`, `PlanLimits`, `TeamConfig`, `CreditInfo`, `UserStatusInfo`, `FullUserStatus` interfaces mapping the full `GetUserStatus` API response.
  `ModelConfig` 新增 `quotaInfo`、`allowedTiers`、`tagTitle`、`mimeTypeCount` 字段。新增 `QuotaInfo`、`PlanLimits`、`TeamConfig`、`CreditInfo`、`UserStatusInfo`、`FullUserStatus` 接口，完整映射 `GetUserStatus` API 返回的用户状态数据。

- **`tracker.ts` Added `fetchFullUserStatus()` / `tracker.ts` 新增 `fetchFullUserStatus()`**: Added `fetchFullUserStatus()` to fetch complete user status (account, quotas, feature flags) for the WebView panel. Original `fetchModelConfigs()` marked as `@deprecated`.
  新增 `fetchFullUserStatus()` 函数，获取完整的用户状态信息（包括账户、配额、Feature Flags），供 WebView 面板使用。原有 `fetchModelConfigs()` 标记为 `@deprecated`。

### Contributors / 贡献者

- Thanks to [@NightMin2002](https://github.com/NightMin2002) for contributing this feature ([PR #10](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/10)).
  感谢 [@NightMin2002](https://github.com/NightMin2002) 贡献此功能（[PR #10](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/10)）。

## [1.10.0] - 2026-03-15

### Added / 新增

- **Language Switching / 语言切换**: New command `Switch Display Language` allows users to choose between Chinese-only, English-only, or bilingual display mode. Preference is persisted via `globalState`. Accessible directly from the details panel (Settings section).
  新增 `切换显示语言` 命令，用户可选择仅中文、仅英文或双语显示模式。偏好通过 `globalState` 持久化。可直接从详情面板底部切换。

- **i18n Module / 国际化模块**: Centralized translation system (`src/i18n.ts`) with `t(key)` and `tBi(en, zh)` helper functions. 80+ translation keys covering all user-facing strings.
  集中式翻译系统（`src/i18n.ts`），提供 `t(key)` 和 `tBi(en, zh)` 辅助函数。80+ 翻译 key 覆盖所有用户可见字符串。

### Changed / 变更

- **Claude 4.6 Context Limits Updated / Claude 4.6 上下文限制更新**: Both Claude Sonnet 4.6 (`MODEL_PLACEHOLDER_M35`) and Claude Opus 4.6 (`MODEL_PLACEHOLDER_M26`) context limits updated from 200K to **1M tokens**, reflecting the GA release on 2026-03-13.
  Claude Sonnet 4.6 和 Claude Opus 4.6 的上下文限制从 200K 更新为 **1M tokens**，反映 2026-03-13 正式发布的 1M 上下文窗口。

### Refactored / 重构

- **Module Extraction / 模块提取**: Broke down the 838-line `tracker.ts` into focused modules:
  - `src/rpc-client.ts` — RPC communication layer
  - `src/models.ts` — Model configuration and display names (with i18n support)
  - `src/constants.ts` — All magic strings and numeric constants centralized
  - `src/i18n.ts` — Internationalization system
  将 838 行的 `tracker.ts` 拆分为职责明确的模块。

- **processSteps() Decomposition / processSteps() 拆分**: Extracted helper functions from the 240-line monolithic function.
  从 240 行的单体函数中提取子函数。

- **Token Formatting Unified / Token 格式化统一**: Merged duplicate logic between `formatTokenCount` and `formatContextLimit` into a single `formatTokenValue()`.
  合并两个重复的格式化函数为统一的 `formatTokenValue()`。

- **Magic Strings → Constants / 魔法字符串 → 常量**: Extracted `CASCADE_RUN_STATUS_RUNNING`, `CORTEX_STEP_TYPE_*` and all numeric constants into `src/constants.ts`.
  所有散落的字面量提取到 `src/constants.ts`。

### Tests / 测试

- Added `src/tracker.test.ts` (16 tests) and `src/statusbar.test.ts` (11 tests).
  新增 `tracker.test.ts`（16 个测试）和 `statusbar.test.ts`（11 个测试）。

- Added `__mocks__/vscode.ts` and `vitest.config.ts` for proper VS Code API mocking in unit tests.
  新增 vscode 模块 mock 和 vitest 配置。

- Total test count: 37 (was 10 in v1.9.0).
  测试总数：37（v1.9.0 为 10）。

### Documentation / 文档

- **README.md & readme_CN.md Updated for v1.10.0 / README 更新**: Rewrote "Bilingual Interface" feature as "Language Switching" to reflect the new three-mode display (Chinese-only / English-only / bilingual). Updated Claude 4.6 context limits from 200K to 1M in the supported models table. Revised sub-agent switching note (no longer causes visible limit change). Added new "Commands" section listing all available commands. Version bumped to 1.10.0.
  将"中英双语"功能描述改写为"语言切换"，反映新的三种显示模式（仅中文/仅英文/双语）。在支持的模型表格中将 Claude 4.6 上下文上限从 200K 更新为 1M。修订子智能体切换说明（不再导致可见的上下文上限变化）。新增"命令"章节列出所有可用命令。版本号更新为 1.10.0。

- **Technical Implementation Docs Updated / 技术文档更新**: Updated `docs/technical_implementation.md` module list to include newly extracted modules (`rpc-client.ts`, `models.ts`, `constants.ts`, `i18n.ts`). Corrected test count to 37 (3 test files).
  更新 `docs/technical_implementation.md` 模块列表，加入新拆分的模块（`rpc-client.ts`、`models.ts`、`constants.ts`、`i18n.ts`）。更正测试总数为 37（3 个测试文件）。

## [1.9.0] - 2026-03-15

### Fixed (Critical) / 修复（严重）

- **Gemini 3 Flash Model ID Rename / Gemini 3 Flash 模型 ID 更名**: Gemini 3 Flash's internal model ID changed from `MODEL_PLACEHOLDER_M18` to `MODEL_PLACEHOLDER_M47` on the backend. Updated `DEFAULT_CONTEXT_LIMITS` and `modelDisplayNames` in `tracker.ts` to use M47 as the primary entry. `MODEL_PLACEHOLDER_M18` is preserved as a backward-compatible legacy alias so older trajectories still display correctly.
  Gemini 3 Flash 的内部模型 ID 由后端从 `MODEL_PLACEHOLDER_M18` 更改为 `MODEL_PLACEHOLDER_M47`。已更新 `tracker.ts` 中的 `DEFAULT_CONTEXT_LIMITS` 和 `modelDisplayNames`，以 M47 为主条目。`MODEL_PLACEHOLDER_M18` 保留为向后兼容的旧别名，确保历史轨迹仍能正确显示。

- **`package.json` Default Config / `package.json` 默认配置**: Added `MODEL_PLACEHOLDER_M47` to the default `contextLimits` configuration object so new installations automatically recognize the updated model ID.
  在默认 `contextLimits` 配置中添加了 `MODEL_PLACEHOLDER_M47`，确保新安装的用户自动识别更新后的模型 ID。

### Verified / 验证

- Confirmed via live LS probe (`GetUserStatus` RPC): M18 is absent from the server's `cascadeModelConfigData`, replaced by M47 with the same label "Gemini 3 Flash". All other model IDs (M37, M36, M35, M26, GPT-OSS 120B) remain unchanged.
  通过实时 LS 探测（`GetUserStatus` RPC）确认：M18 已从服务器的 `cascadeModelConfigData` 中移除，被 M47 替代，标签仍为 "Gemini 3 Flash"。其余所有模型 ID（M37、M36、M35、M26、GPT-OSS 120B）保持不变。

### Notes / 说明

- The `GetUserStatus` API does not expose context window limits — they remain hardcoded in `DEFAULT_CONTEXT_LIMITS`. Gemini 3 Flash (M47) context limit remains 1,000,000 tokens.
  `GetUserStatus` API 不提供上下文窗口上限信息——仍需在 `DEFAULT_CONTEXT_LIMITS` 中硬编码。Gemini 3 Flash (M47) 上下文上限仍为 1,000,000 tokens。

## [1.8.0] - 2026-03-15

### Added / 新增加
- **Priority 1b & 4 Fallbacks / 优先级 1b & 4 回退**: Added sophisticated trajectory selection fallbacks to handle "Idle" status and new conversations. Priority 1b detects running conversations that haven't registered a workspace URI yet (common in new chats), while Priority 4 falls back to the most recently modified trajectory in the workspace when all are idle. This ensures the context monitor stays active and accurate even between turns.
  新增了复杂的轨迹选择回退机制。优先级 1b 用于捕捉尚未注册工作区 URI 的新会话（常见于新对话起始阶段），优先级 4 在所有会话空闲时回退到该工作区最近修改的会话。这确保了监控器在回合之间也能保持活跃和准确。

### Fixed / 修复
- **Windows Process Discovery Cache / Windows 进程发现缓存**: Added caching for `wmic` availability and optimized PowerShell commands to reduce polling overhead on Windows systems.
  为 `wmic` 可用性增加了缓存并优化了 PowerShell 命令，大幅降低了 Windows 系统上的轮询开销。

### Known Issues & Notes / 已知问题与说明
- **Summarization Threshold / 总结阈值**: Antigravity IDE has a hardcoded 7500 token "Summarization Threshold" for checkpoint summaries. This may lead to slight calculation discrepancies during long conversations. Reference: [Reddit Post](https://www.reddit.com/r/google_antigravity/comments/1q7zcag/heres_how_to_find_which_mcp_tools_are_leading_to/)
  Antigravity IDE 对检查点总结有一个硬编码的 7500 token "总结阈值"。这可能会导致长对话期间的计算结果出现轻微偏差。参考：[Reddit 社区讨论](https://www.reddit.com/r/google_antigravity/comments/1q7zcag/heres_how_to_find_which_mcp_tools_are_leading_to/)
- **Dynamic Sub-Agent Switching / 子智能体动态切换**: When using Claude models, Antigravity may call Gemini 2.5 Flash Lite as a sub-agent for lightweight tasks. This causes the context limit to temporarily jump to 1M, returning to 200k when Claude resumes execution.
  使用 Claude 模型时，Antigravity 可能会调用 Gemini 2.5 Flash Lite 作为子智能体处理轻量任务。这会导致上下文上限临时跳到 1M，当 Claude 恢复执行任务时会回退到 200k。

## [1.7.1] - 2026-03-14

### Fixed (Critical) / 修复（严重）

- **Windows Workspace ID Matching / Windows 工作区 ID 匹配**: `buildExpectedWorkspaceId()` now correctly hex-encodes the drive-letter colon as `_3A_` and replaces hyphens with underscores on `win32`, matching the LS process's actual `--workspace_id` encoding. Previously, multi-workspace setups on Windows would connect to the wrong LS instance, causing "no conversation" or "idle" status.
  `buildExpectedWorkspaceId()` 现在在 Windows 上正确将驱动器冒号编码为 `_3A_` 并将连字符替换为下划线，与 LS 进程的实际 `--workspace_id` 编码匹配。此前多工作区 Windows 环境会连接到错误的 LS 实例，导致显示"无对话"或"空闲"。

- **Windows URI Normalization / Windows URI 规范化**: `normalizeUri()` now strips the leading `/` before Windows drive letters (e.g., `/c:/Users/...` → `c:/Users/...`) for semantically correct path comparison.
  `normalizeUri()` 现在去除 Windows 驱动器号前的多余 `/`（如 `/c:/Users/...` → `c:/Users/...`），确保语义正确的路径比较。

## [1.7.0] - 2026-03-14

### Added / 新增

- **Windows Platform Support / Windows 平台支持**: Full Windows compatibility for process discovery. `filterLsProcessLines()` dynamically selects binary name (`language_server_windows` for Windows, `language_server_linux` for Linux, `language_server_macos` for macOS) based on `process.platform`. Process discovery uses `wmic.exe` (native executable, no PowerShell startup overhead) with PowerShell `Get-CimInstance` fallback for future Windows versions that may deprecate wmic. Port discovery uses `netstat -ano` (~25ms, fastest available option). New `extractPortFromNetstat()` parser exported for unit testing.
  完整的 Windows 进程发现支持。`filterLsProcessLines()` 根据 `process.platform` 动态选择二进制名称。进程发现使用 `wmic.exe`（原生可执行文件，无 PowerShell 启动开销），端口发现使用 `netstat -ano`（约 25ms，最快方案）。新增 `extractPortFromNetstat()` 导出函数。

- **Windows Case-Insensitive Path Handling / Windows 大小写不敏感路径处理**: `normalizeUri()` in `tracker.ts` now applies `toLowerCase()` on both macOS (`darwin`) and Windows (`win32`), preserving case sensitivity only on Linux file systems.
  `tracker.ts` 中的 `normalizeUri()` 现在同时在 macOS 和 Windows 上执行 `toLowerCase()`，仅在 Linux 文件系统上保留大小写敏感性。

### Verified / 验证

- Tested on Windows 10/11 (x64) with Antigravity installed. Confirmed `language_server_windows_x64.exe` process discovery with correct `csrf_token` and port extraction via `wmic` + `netstat`. All RPC endpoints (GetUnleashData, GetUserStatus, GetAllCascadeTrajectories) verified working over HTTPS.
  在 Windows 10/11 (x64) 上安装 Antigravity 并测试通过。确认通过 `wmic` + `netstat` 正确发现 `language_server_windows_x64.exe` 进程及提取 `csrf_token` 和端口。所有 RPC 端点通过 HTTPS 验证正常。

## [1.6.0] - 2026-03-07

### Added / 新增

- **Linux Platform Support / Linux 平台支持**: Full Linux compatibility for process discovery. `filterLsProcessLines()` dynamically selects binary name (`language_server_linux` for Linux, `language_server_macos` for macOS) based on `process.platform`. Supports both x64 (`language_server_linux_x64`) and ARM64 (`language_server_linux_arm`) architectures.
  完整的 Linux 进程发现支持。`filterLsProcessLines()` 根据 `process.platform` 动态选择二进制名称。同时支持 x64 和 ARM64 架构。

- **`ss` Fallback for Port Discovery / `ss` 端口发现回退**: New `findListeningPorts()` function prioritizes `lsof` and falls back to `ss -tlnp` on Linux if `lsof` is unavailable. Includes dedicated `extractPortFromSs()` parser.
  新增 `findListeningPorts()` 函数，优先使用 `lsof`，Linux 上 `lsof` 不可用时回退到 `ss -tlnp`。包含专用的 `extractPortFromSs()` 解析器。

- **Case-Sensitive Path Handling / 大小写敏感路径处理**: `normalizeUri()` in `tracker.ts` now conditionally applies `toLowerCase()` only on macOS (`process.platform === 'darwin'`), preserving case sensitivity on Linux file systems.
  `tracker.ts` 中的 `normalizeUri()` 现在仅在 macOS 上执行 `toLowerCase()`，保留 Linux 文件系统的大小写敏感性。

### Changed / 变更

- **README Restructure / README 重构**: Split bilingual README into pure English `README.md` (default) and Chinese `readme_CN.md` with cross-links. Improved readability by eliminating mixed-language paragraphs.
  将双语 README 拆分为纯英文 `README.md`（默认）和中文 `readme_CN.md`，通过互相链接连接。消除混合语言段落，提升可读性。

### Verified / 验证

- Tested in Docker (Ubuntu 22.04 / ARM64) with Antigravity installed via APT. Confirmed `language_server_linux_arm` process discovery with correct `csrf_token` and `extension_server_port` extraction.
  在 Docker (Ubuntu 22.04 / ARM64) 中安装 Antigravity 并测试通过。确认 `language_server_linux_arm` 进程发现及 `csrf_token`、`extension_server_port` 的正确提取。

## [1.5.3] - 2026-02-22

### Fixed (Medium) / 修复（中等）

- **CR3-Fix2**: `discoverLanguageServer` workspace matching now delegates to the exported `extractWorkspaceId()` instead of duplicating the regex inline — eliminates regex drift risk between production code and tests  
  `discoverLanguageServer` 工作区匹配现在调用已导出的 `extractWorkspaceId()`，消除了生产代码与测试之间的正则漂移风险

### Tests / 测试

- **CR3-Fix3**: Added `tests/extension.test.ts` (7 tests) covering polling race logic: `activate`/`deactivate` lifecycle, `disposed` guard, `isPolling` reentrance guard, `pollGeneration` orphan chain prevention, LS discovery failure recovery  
  新增 `tests/extension.test.ts`（7 个测试），覆盖轮询竞态逻辑：生命周期、disposed 守卫、isPolling 重入防护、pollGeneration 孤链防护、LS 发现失败恢复
- Total test count: 78 (was 57 in v1.5.2)  
  测试总数：78（v1.5.2 为 57）

## [1.5.2] - 2026-02-22

### Fixed (Critical) / 修复（严重）

- **CR2-Fix1**: `schedulePoll` generation counter — `restartPolling()` increments `pollGeneration` so the old chain's `finally` block silently exits instead of creating orphan parallel timers  
  `schedulePoll` 代计数器——`restartPolling()` 时旧链的 `finally` 静默退出，防止孤儿并行定时器

- **CR2-Fix3**: `probePort` now handles response-side stream errors via `res.on('error')` — previously could hang until timeout on TCP RST or half-broken connections  
  `probePort` 新增 `res.on('error')` 处理响应流异常——此前遇到 TCP RST 等情况会挂起直到超时

- **CR2-Fix4**: Extracted 6 parsing functions (`buildExpectedWorkspaceId`, `extractPid`, `extractCsrfToken`, `extractWorkspaceId`, `filterLsProcessLines`, `extractPort`) from `discoverLanguageServer()` as exports. Tests now import production code directly instead of reimplementing regex logic  
  从 `discoverLanguageServer()` 提取 6 个解析函数为 export，测试直接导入生产代码

### Fixed (Medium) / 修复（中等）

- **CR2-Fix2**: Status bar main text now appends `⚠️` when `hasGaps` is true — previously gaps warning was only visible in tooltip  
  状态栏主文本在 `hasGaps` 时追加 `⚠️`——此前仅在 tooltip 中显示

- **CR2-Fix5**: `pollContextUsage` captures `cachedLsInfo` to local `lsInfo` snapshot at entry — concurrent refresh command setting `cachedLsInfo=null` can no longer cause null to be passed to downstream RPC calls  
  `pollContextUsage` 入口捕获 `cachedLsInfo` 到局部快照——refresh 竞态不再导致 null 传给下游 RPC

- **CR2-Fix6**: Batch step fetching now limited to `MAX_CONCURRENT_BATCHES=5` — prevents bursting hundreds of concurrent RPC calls on long conversations  
  批量步骤拉取限制为 5 个并发——防止长对话时产生大量并行 RPC 请求

- **CR2-Fix7**: `effectiveModel` priority chain: `generatorModel → checkpoint muModel → requestedModel`. Checkpoint's `modelUsage.model` now correctly overrides `generatorModel`  
  `effectiveModel` 优先级链：`generatorModel → checkpoint muModel → requestedModel`

### Fixed (Minor) / 修复（小修）

- **CR2-Fix8**: `getContextLimit` clamps custom limits to minimum 1; `formatContextLimit` clamps input to minimum 0 — prevents negative/zero context limits from user configuration  
  `getContextLimit` 自定义限制 clamp 到最小 1；`formatContextLimit` clamp 到最小 0

### Tests / 测试

- Rewrote `discovery.test.ts` to import production parsing functions (16 tests)  
  重写 `discovery.test.ts` 直接导入生产解析函数
- Added tests for negative/zero custom limits in `getContextLimit` and `formatContextLimit`  
  新增 `getContextLimit` 和 `formatContextLimit` 的负数/零值测试
- Added test for checkpoint `modelUsage.model` priority in `processSteps`  
  新增 `processSteps` 中 checkpoint `modelUsage.model` 优先级测试

## [1.5.1] - 2026-02-22

### Improved / 改进

- **Two-Layer Compression Detection / 双层压缩检测**: Primary layer compares consecutive checkpoint `inputTokens` in `processSteps()` — drop > 5000 tokens flags compression. Immune to Undo false positives (checkpoint data immutable). Fallback layer: cross-poll `contextUsed` comparison with Undo exclusion guard (skips when `stepCount` decreases). Both layers feed `compressionPersistCounters` (3 poll cycles ~15s)  
  主检测层在 `processSteps()` 中比较连续 checkpoint `inputTokens`——下降超过 5000 tokens 标记为压缩，天然免疫 Undo 误报。降级层：跨轮询 `contextUsed` 比较带 Undo 排除守卫。两层共用持久化计数器

- **SYSTEM_PROMPT_OVERHEAD**: Updated from 2000 to 10,000 tokens based on real Antigravity LS measurement (~10K actual system prompt tokens)  
  基于实测将系统提示词开销从 2000 更新为 10000 tokens

## [1.4.1] - 2026-02-22

### Fixed (Critical) / 修复（严重）

- **CR-C2**: `probePort` in `discovery.ts` now supports `AbortSignal` for cancellation on extension deactivate; uses `settled` guard pattern to prevent double resolution  
  `discovery.ts` 的 `probePort` 现在支持 `AbortSignal`，用于扩展停用时取消请求；使用 `settled` 守卫模式防止重复 resolve

- **CR-C3**: Added `hasGaps` flag to `TokenUsageResult` and `ContextUsage` — when step batch fetching has gaps, UI shows "⚠️ Data may be incomplete / 数据可能不完整" in tooltip and `[⚠️Gaps/缺失]` tag in QuickPick  
  新增 `hasGaps` 标志——当步骤批量获取有缺失时，提示框显示"数据可能不完整"警告

### Fixed (Medium) / 修复（中等）

- **CR-M2**: Renamed `const MODEL_DISPLAY_NAMES` to `let modelDisplayNames` to accurately reflect runtime mutability via `updateModelDisplayNames()`  
  将 `const MODEL_DISPLAY_NAMES` 重命名为 `let modelDisplayNames`，准确反映运行时可变性

- **CR-M3**: `rpcCall` now uses `settled` flag with `safeResolve`/`safeReject` wrappers to prevent double reject from abort + error event overlap  
  `rpcCall` 现在使用 `settled` 标志和 `safeResolve`/`safeReject` 包装器，防止 abort + error 事件重叠导致的双重 reject

- **CR-M5**: Polling interval now has `Math.max(1, ...)` lower bound — 0 or negative config values no longer cause excessive polling  
  轮询间隔现在有 `Math.max(1, ...)` 下限保护——0 或负值配置不再导致过度轮询

### Improved / 改进

- **CR-m1**: `formatTokenCount` now displays `M` suffix for values ≥ 1,000,000 (e.g., `1.5M` instead of `1500k`) for better readability  
  `formatTokenCount` 现在对 ≥ 100 万的值显示 `M` 后缀（如 `1.5M` 而非 `1500k`），提升可读性

- **CR-m5**: Added `discovery.test.ts` with 16 unit tests for parsing logic (workspace ID generation, PID/CSRF/port extraction, process line filtering)  
  新增 `discovery.test.ts`，包含 16 个解析逻辑单元测试

## [1.4.0] - 2026-02-22

### Added / 新增

- **Content-Based Token Estimation / 基于内容的 Token 估算**: Replaced fixed constants (`USER_INPUT_OVERHEAD=500`, `PLANNER_RESPONSE_ESTIMATE=800`) with character-based estimates from actual step text content (`userInput.userResponse`, `plannerResponse.response/thinking/toolCalls`). Fixed constants remain as fallback.  
  用实际步骤文本内容的字符估算替代固定常量，大幅提升 checkpoint 间隙的 token 精度。固定常量作为 fallback 保留。

- **Dynamic Model Display Names / 动态模型显示名称**: Fetch model configurations from `GetUserStatus` API on LS connection to dynamically update display names. Hardcoded names preserved as fallback.  
  连接 LS 时通过 `GetUserStatus` API 动态获取模型显示名称。硬编码名称作为 fallback 保留。

- **Retry Token Observation / 重试 Token 观测**: Checkpoint `retryInfos[].usage` token data is now logged for analysis (observation mode — not yet counted toward totals pending verification of double-counting risk).  
  Checkpoint 中 `retryInfos[].usage` 的 token 数据现以日志形式记录用于分析（观测模式——待验证是否与 modelUsage 重复计算后再决定是否计入总量）。

### Fixed / 修复

- **CR-C1**: Added `isPolling` reentrance lock to prevent concurrent `pollContextUsage()` execution when RPC calls exceed the polling interval  
  添加 `isPolling` 重入锁，防止 RPC 调用超过轮询间隔时 `pollContextUsage()` 并发执行

- **CR-M2**: Fallback estimation formula (no checkpoint path) now uses accumulated `estimationOverhead` from content-based estimates instead of recalculating with fixed constants  
  无 checkpoint 路径的 fallback 估算公式现在使用已累积的 `estimationOverhead`（基于内容估算），而非重新用固定常量计算

- **CR-m1**: `escapeMarkdown` now escapes `<` and `>` to prevent MarkdownString HTML interpretation  
  `escapeMarkdown` 现在转义 `<` 和 `>`，防止 MarkdownString 将其解释为 HTML 标签

- **CR-m2**: `formatTokenCount` guards against negative values with `Math.max(0, count)`  
  `formatTokenCount` 用 `Math.max(0, count)` 防护负值

- **CR-m3**: `previousContextUsedMap` now cleaned up in `updateBaselines` — stale entries for disappeared trajectories are removed  
  `previousContextUsedMap` 现在在 `updateBaselines` 中清理——已消失的 trajectory 的过期条目会被删除

- **CR-m6**: `selectionReason` context preserved through cascade selection → display logic, improving debug log quality  
  `selectionReason` 上下文从 cascade 选择逻辑保留到显示逻辑，提升调试日志质量

## [1.3.1] - 2026-02-21

### Fixed / 修复

- **C3 Fix**: Fixed `globalStepIdx` off-by-one bug in image generation detection — both stepType and model name checks now use the same step index, preventing duplicate counting  
  修复了图片生成检测中 `globalStepIdx` 的 off-by-one bug——stepType 和模型名称两次检查现在使用同一个步骤索引，防止重复计数

### Improved / 改进

- **Bilingual CHANGELOG / 双语变更日志**: All CHANGELOG entries now include both English and Chinese descriptions  
  所有变更日志条目现在包含中英双语说明
- **README limitations / README 限制说明**: Added documentation for known limitations (same-workspace multi-window, compression detection timing)  
  在 README 中新增了已知限制的说明（同 workspace 多窗口、压缩检测时序）

## [1.3.0] - 2026-02-21

### Fixed (Critical) / 修复（严重）

- **C2**: `contextUsed` now includes `outputTokens` from the last checkpoint — both input and output tokens count toward context window occupation  
  `contextUsed` 现在包含最后一个 checkpoint 的 `outputTokens`——输入和输出 token 都计入上下文窗口占用

- **C3**: Added real compression detection via cross-poll comparison. When `contextUsed` drops between polls, tooltip shows before/after values with 🗜 indicator  
  新增了通过跨轮询对比的真实压缩检测。当 `contextUsed` 在两次轮询之间下降时，提示框显示压缩前/后的数值和 🗜 标识

### Fixed (Medium) / 修复（中等）

- **M1**: `globalStepIdx` now increments per step regardless of metadata presence, fixing potential image generation dedup index skew  
  `globalStepIdx` 现在无论是否有元数据都按步骤递增，修复了潜在的图片生成去重索引偏移

- **M4**: `lastKnownModel` is now persisted to `workspaceState`, surviving extension restarts  
  `lastKnownModel` 现在持久化到 `workspaceState`，在扩展重启后保留

- **M5**: README version synced to 1.3.0  
  README 版本同步到 1.3.0

- **M7**: Internal model context limits kept at 1M (no LS API available to query them dynamically)  
  内部模型上下文限制保持为 1M（没有可用的 LS API 动态查询）

### Improved / 改进

- **m5**: Added `escapeMarkdown` helper for tooltip content — special characters (`|`, `*`, `_`, etc.) no longer break MarkdownString rendering  
  新增 `escapeMarkdown` 辅助函数用于提示框内容——特殊字符（`|`、`*`、`_` 等）不再破坏 MarkdownString 渲染

- **m6**: QuickPick detail now uses newline-separated layout for better readability  
  QuickPick 详情现在使用换行分隔布局，提高可读性

- **Compression UX / 压缩用户体验**: Tooltip distinguishes between "compressing" (>100%) and "compressed" (detected drop) states with different messages  
  提示框区分"正在压缩"（>100%）和"已压缩"（检测到下降）两种状态，显示不同消息

### Cleaned / 清理

- Removed all old `.vsix` build artifacts from project root  
  移除了项目根目录下所有旧的 `.vsix` 构建产物
- Removed empty file `0` from project root  
  移除了项目根目录下的空文件 `0`

## [1.2.0] - 2026-02-21

### Fixed (Critical) / 修复（严重）

- **C1**: Fixed `contextUsed` calculation — separated actual output tokens from estimation overhead (USER_INPUT_OVERHEAD, PLANNER_RESPONSE_ESTIMATE) to prevent potential double-counting  
  修复了 `contextUsed` 计算——将实际输出 token 与估算开销分离，防止潜在的重复计算

- **C2**: Fixed `totalOutputTokens` to only include actual output tokens (toolCallOutputTokens + checkpoint outputTokens), not estimation overhead  
  修复了 `totalOutputTokens` 只包含实际输出 token，不含估算开销

### Added / 新增

- **Image Generation Tracking / 图片生成追踪**: Explicit detection of image generation steps (by step type and model name). Shows 📷 indicator in tooltip and QuickPick panel when detected.  
  显式检测图片生成步骤（通过步骤类型和模型名称）。检测到时在提示框和 QuickPick 面板显示 📷 标识。

- **Estimation Delta Display / 估算增量显示**: Tooltip now shows `estimatedDeltaSinceCheckpoint` when applicable, helping verify accuracy.  
  提示框现在在适用时显示 `estimatedDeltaSinceCheckpoint`，帮助验证准确性。

- **Output Tokens Display / 输出 Token 显示**: Tooltip now explicitly shows output token count separate from total context usage.  
  提示框现在明确显示输出 token 数，与总上下文使用量分开展示。

- **Exponential Backoff / 指数退避**: Polling backs off (5s → 10s → 20s → 60s) when LS discovery fails, resets on reconnect. Reduces CPU overhead when Antigravity is not running.  
  轮询在 LS 发现失败时退避（5秒 → 10秒 → 20秒 → 60秒），重连后重置。减少 Antigravity 未运行时的 CPU 开销。

- **Manual Refresh Reset / 手动刷新重置**: "Refresh" command now resets backoff state immediately.  
  "刷新"命令现在立即重置退避状态。

### Changed / 变更

- **Probe Endpoint / 探测端点**: Switched from `GetUserStatus` to lightweight `GetUnleashData` for port probing (per openusage reference docs).  
  端口探测从 `GetUserStatus` 切换到更轻量的 `GetUnleashData`（参考 openusage 文档）。

- **RPC Timeout / RPC 超时**: `GetCascadeTrajectorySteps` now uses 30s timeout (was 10s) to handle large conversations.  
  `GetCascadeTrajectorySteps` 现在使用 30 秒超时（原来 10 秒），以处理大型对话。

- **Context Limits Description / 上下文限制说明**: Settings now include model ID → display name mapping for user clarity.  
  设置现在包含模型 ID → 显示名称映射，方便用户理解。

- **README**: Added macOS-only platform note. Added image generation tracking and exponential backoff to features.  
  README 新增了 macOS 专用平台说明和图片生成追踪、指数退避等功能说明。

## [1.1.0] - 2026-02-21

### Fixed (Critical) / 修复（严重）

- Replaced ALL placeholder model IDs (`MODEL_PLACEHOLDER_M7`, `M8`, etc.) with real IDs discovered from live Antigravity LS (`MODEL_PLACEHOLDER_M37`, `M36`, `M18`, `MODEL_OPENAI_GPT_OSS_120B_MEDIUM`)  
  替换了所有占位符模型 ID 为从实际 Antigravity LS 发现的真实 ID

- Fixed duplicate Claude Sonnet 4.6 model mapping (`334` vs `MODEL_PLACEHOLDER_M35`)  
  修复了 Claude Sonnet 4.6 模型映射重复问题

- Undo/Rewind detection now catches stepCount **decrease** (not just increase), ensuring context usage immediately reflects undone steps  
  Undo/Rewind 检测现在捕获 stepCount **减少**（不仅仅是增加），确保上下文使用量立即反映撤销的步骤

### Fixed (Medium) / 修复（中等）

- Context compression (>100%) now displays `~100% 🗜` with compression indicator instead of raw `>100%` value  
  上下文压缩（>100%）现在显示 `~100% 🗜` 压缩标识，而非原始的 `>100%` 值

- Tooltip clarifies that "Used" includes both input and output tokens (total context window occupation)  
  提示框明确说明"已用"包含输入和输出 token（总上下文窗口占用）

- Polling interval reduced from 15s to 5s for more responsive updates  
  轮询间隔从 15 秒减少到 5 秒，提供更快的更新

- Status bar severity thresholds adjusted: critical at 95% (was 100%)  
  状态栏严重程度阈值调整：95% 为严重（原来 100%）

### Fixed (Minor) / 修复（小修）

- `.vscodeignore` now excludes debug scripts and temp files from packaged extension  
  `.vscodeignore` 现在排除调试脚本和临时文件

- Bilingual improvements across all user-facing strings  
  所有用户可见字符串的双语改进

- Default status bar background returns `undefined` (not a ThemeColor) for 'ok' state  
  正常状态下状态栏背景返回 `undefined`（不使用 ThemeColor）

## [1.0.2] - 2026-02-21

### Fixed / 修复

- Fixed bug where context usage displayed data from previous conversation after rewind  
  修复了回退后上下文使用量显示上一次对话数据的 bug

## [1.0.1] - 2026-02-21

### Fixed / 修复

- Minor stability improvements  
  小幅稳定性改进

## [1.0.0] - 2026-02-21

### Added / 新增

- Initial release with full context window monitoring  
  首次发布，完整的上下文窗口监控
- Multi-window workspace isolation  
  多窗口工作区隔离
- Bilingual UI (English + Simplified Chinese)  
  双语用户界面（英文 + 简体中文）
- Undo/Rewind support  
  支持 Undo/Rewind
- Context compression awareness  
  上下文压缩感知

## [0.4.6] - 2026-02-21

### Fixed / 修复

- Fixed an issue where context usage would incorrectly display data from a previous conversation after rewinding/clearing the current conversation to an empty state.  
  修复了将当前对话回退/清除到空状态后，上下文使用量错误显示上一次对话数据的问题。

# 变更日志 / Changelog

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

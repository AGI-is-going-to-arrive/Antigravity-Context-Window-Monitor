# 🛠️ Antigravity Context Window Monitor — Technical Implementation / 技术实现说明

This document explains how the Antigravity Context Window Monitor plugin works. The plugin consists of the following core modules: `discovery.ts` (server discovery), `tracker.ts` (token calculation), `extension.ts` (polling scheduler), `statusbar.ts` (UI display), `webview-panel.ts` (WebView panel orchestrator), `activity-tracker.ts` (model activity tracking), `activity-panel.ts` (activity panel UI), `quota-tracker.ts` (quota tracking), `rpc-client.ts` (RPC communication layer), `models.ts` (model config & display names), `constants.ts` (constants), and `i18n.ts` (internationalization system). WebView panel split into: `webview-monitor-tab.ts`, `webview-profile-tab.ts`, `webview-settings-tab.ts`, `webview-history-tab.ts`, `webview-script.ts`, `webview-styles.ts`, `webview-helpers.ts`, `webview-icons.ts`.

本文档说明 Antigravity Context Window Monitor 插件的工作原理。插件由以下核心模块组成：`discovery.ts`（服务器发现）、`tracker.ts`（Token 计算）、`extension.ts`（轮询调度）、`statusbar.ts`（界面展示）、`webview-panel.ts`（WebView 面板调度）、`activity-tracker.ts`（模型活动追踪）、`activity-panel.ts`（活动面板 UI）、`quota-tracker.ts`（配额追踪）、`rpc-client.ts`（RPC 通信层）、`models.ts`（模型配置与显示名称）、`constants.ts`（常量定义）、`i18n.ts`（国际化系统）。WebView 面板拆分为：`webview-monitor-tab.ts`、`webview-profile-tab.ts`、`webview-settings-tab.ts`、`webview-history-tab.ts`、`webview-script.ts`、`webview-styles.ts`、`webview-helpers.ts`、`webview-icons.ts`。

---

## 🧭 1. Language Server Discovery / 语言服务器发现

> Source: [`discovery.ts`](../src/discovery.ts)

Each Antigravity workspace has a background Language Server process handling AI conversation requests. The plugin needs to locate the correct one for the current workspace and connect to it.

每个 Antigravity 工作区都有一个后台进程（Language Server）处理 AI 对话请求。插件需要找到当前工作区对应的语言服务器并建立连接。

* **Process Scanning / 进程扫描**: Uses platform-specific commands (via async `execFile`, non-blocking to IDE UI thread) to find the Language Server process, matching the current workspace via the `--workspace_id` argument. macOS uses `ps`, Linux uses `ps` with `lsof`/`ss` fallback, Windows uses `wmic`/PowerShell, and WSL (v1.12.0+) uses Windows-side tools via interop (`WMIC.exe`, `powershell.exe`, `netstat.exe`). Uses `execFile` instead of shell string concatenation to prevent command injection. Accepts optional `AbortSignal` for cancellation on extension deactivate. Core parsing logic extracted into exported functions (`buildExpectedWorkspaceId`, `extractPid`, `extractCsrfToken`, etc.) that can be directly unit-tested. WSL detection uses `isWSL()` which reads `/proc/version` for Microsoft/WSL signatures (cached). Since v1.12.1, `extensionKind: ["ui", "workspace"]` ensures the extension prefers running on the local (UI) side where the LS process lives — resolving "LS not found" when connected via Remote-WSL or Remote SSH.
  使用平台特定命令（通过异步 `execFile` 调用，不阻塞 IDE UI 线程）查找语言服务器进程，并通过 `--workspace_id` 参数匹配当前工作区。macOS 使用 `ps`，Linux 使用 `ps` 和 `lsof`/`ss` 回退，Windows 使用 `wmic`/PowerShell，WSL（v1.12.0+）通过互操作调用 Windows 端工具。使用 `execFile` 而非 shell 命令拼接，避免命令注入风险。WSL 检测通过 `isWSL()` 读取 `/proc/version` 中的 Microsoft/WSL 签名（结果缓存）。自 v1.12.1 起，`extensionKind: ["ui", "workspace"]` 确保扩展优先在本地（UI 端）运行——解决通过 Remote-WSL 或 Remote SSH 连接时的「LS 未找到」问题。

* **Extracting Connection Info / 提取连接参数**: Extracts PID and `csrf_token` from process arguments (used for RPC request authentication).
  从进程命令行中提取 PID 和 `csrf_token`（用于 RPC 请求鉴权）。

* **Port Discovery / 端口发现**: Uses `lsof` (macOS/Linux), `ss` fallback (Linux), `netstat -ano` (Windows), or `netstat.exe` via interop (WSL) to find the local port the language server is listening on.
  使用 `lsof`（macOS/Linux）、`ss` 回退（Linux）、`netstat -ano`（Windows）或通过互操作的 `netstat.exe`（WSL）查找语言服务器监听的本地端口。

* **Connection Probing / 连接探测**: Sends a lightweight RPC request (`GetUnleashData`) to test connectivity, verifying HTTP status code is 2xx. Tries HTTPS first (the LS typically uses self-signed certs), falls back to HTTP. Response stream now has `res.on('error')` handler to prevent Promise hang on TCP RST or similar issues.
  向发现的端口发送一个轻量 RPC 请求（`GetUnleashData`）测试连接，并验证 HTTP 状态码为 2xx。先尝试 HTTPS，失败则降级为 HTTP。响应流新增 `res.on('error')` 处理。

## ♾️ 2. Conversation Tracking / 对话数据跟踪

> Source: [`tracker.ts`](../src/tracker.ts) — `getAllTrajectories()`, [`extension.ts`](../src/extension.ts) — polling logic

Once connected, the plugin periodically fetches conversation data and tracks changes.

连接成功后，插件定期获取对话数据并跟踪变化。

* **Fetching Sessions / 获取会话列表**: Calls the `GetAllCascadeTrajectories` RPC endpoint to get all conversations (called Trajectories), including cascadeId, stepCount, status, and model used.
  调用 `GetAllCascadeTrajectories` RPC 接口获取所有对话（称为 Trajectory），包括 cascadeId、stepCount、状态、使用的模型。

* **Workspace Isolation / 工作区隔离**: Filters trajectories by comparing their `workspaceUris` against the current window's workspace URI (normalized via `normalizeUri`), showing only conversations belonging to this workspace.
  通过比较 trajectory 上的 `workspaceUris` 与当前窗口的 workspace URI（经过 `normalizeUri` 标准化处理），只显示属于当前工作区的对话。

* **Active Session Selection / 活跃会话选择**: Selects which session to display, by priority:
  按优先级选择要显示的会话：
  1. Trajectory with RUNNING status / 状态为 RUNNING 的对话
  2. Trajectory with stepCount change (increase = new message, decrease = undo) / `stepCount` 发生变化的对话
  3. Newly appeared trajectory / 新出现的对话

* **Step Analysis / 逐步分析**: For the selected conversation, calls `GetCascadeTrajectorySteps` with all batches (50 steps each) fetched in groups of up to 5 concurrent batches via `Promise.allSettled`, then passes the collected steps array to the pure function `processSteps()` for computation. `endIndex` is capped at `stepCount` to prevent the LS API's wrap-around behavior. Failed batches are flagged as `hasGaps` without blocking others. `processSteps()` is a side-effect-free pure function extracted from `getTrajectoryTokenUsage`, directly unit-testable with constructed step data.
  对选中的对话调用 `GetCascadeTrajectorySteps`，通过 `Promise.allSettled` 分组获取所有批次，然后将完整步骤数组传给纯函数 `processSteps()` 进行计算。

## 🧮 3. Token Calculation / Token 计算逻辑

> Source: [`tracker.ts`](../src/tracker.ts) — `processSteps()` (pure computation), `getTrajectoryTokenUsage()` (RPC fetch + calls processSteps)

* **精确值（Checkpoint）/ Precise Values**: 语言服务器会在 `CORTEX_STEP_TYPE_CHECKPOINT` 类型的步骤中提供 `modelUsage` 数据，包含模型实际计算的 `inputTokens` 和 `outputTokens`。插件始终使用最后一个 checkpoint 的值作为基准。
  The language server provides `modelUsage` data in `CORTEX_STEP_TYPE_CHECKPOINT` steps, containing the model's actual `inputTokens` and `outputTokens`. The plugin always uses the last checkpoint as the baseline.

* **实时估算（v1.4.0 内容估算）/ Real-Time Estimation (v1.4.0 Content-Based)**: 在两个 checkpoint 之间，插件从步骤的实际文本内容估算 Token 增量：用户输入取自 `userInput.userResponse`，模型回复取自 `plannerResponse.response` + `plannerResponse.thinking` + `plannerResponse.toolCalls[].argumentsJson`。估算规则为 ASCII 字符 ÷ 4、非 ASCII 字符 ÷ 1.5。只有当步骤的父对象完全不存在（数据结构缺失）时，才 fallback 到固定常量（用户输入 500、模型回复 800），文本为空则正确估算为 ≈0 tokens。系统提示词开销约 10000 tokens（`SYSTEM_PROMPT_OVERHEAD`，基于实测），始终计入一次。
   Between checkpoints, the plugin estimates token delta from actual step text content: user input from `userInput.userResponse`, model response from `plannerResponse.response` + `plannerResponse.thinking` + `plannerResponse.toolCalls[].argumentsJson`. Estimation: ASCII chars ÷ 4, non-ASCII ÷ 1.5. Fixed constants (500 per user input, 800 per response) are only used as fallback when the parent object is entirely missing (structural data absence); empty text correctly estimates to ≈0 tokens. System prompt overhead ~10,000 tokens (`SYSTEM_PROMPT_OVERHEAD`, measured from real sessions) is always counted once.

* **上下文窗口 = inputTokens + outputTokens + 增量 / Context = inputTokens + outputTokens + delta**: 总上下文占用是 checkpoint 的 input + output 加上 checkpoint 之后的估算增量。
  Total context usage is checkpoint input + output plus estimated delta since the last checkpoint.

* **图片生成 Token 追踪 / Image Gen Token Tracking**: 通过两种方式检测图片生成步骤：step type 中包含 `IMAGE` 或 `GENERATE`，或 generator model 名称中包含 `nano`、`banana`、`image`。使用 Set 对每个步骤去重，防止重复计数。
  Detects image generation steps two ways: step type containing `IMAGE` or `GENERATE`, or generator model name containing `nano`, `banana`, or `image`. Uses a Set to deduplicate per step index.

* **重试 Token 观测 / Retry Token Observation**: Checkpoint 的 `metadata.retryInfos[].usage` 包含重试请求产生的 token。当前以日志形式记录（观测模式），待验证与 `modelUsage` 是否重复后再决定是否计入总量。
  Checkpoint `metadata.retryInfos[].usage` contains retry token usage. Currently logged for analysis (observation mode), pending verification of overlap with `modelUsage` before counting.

* **动态模型名称 / Dynamic Model Names**: 在 LS 连接成功后，通过 `GetUserStatus` API 获取模型配置列表，动态更新 `MODEL_DISPLAY_NAMES`。硬编码值作为 fallback 保留。
  On LS connection, fetches model configs from the `GetUserStatus` API to dynamically update `MODEL_DISPLAY_NAMES`. Hardcoded values remain as fallback.

## 🖥️ 4. Status Bar & Polling / 状态栏与轮询

> Source: [`statusbar.ts`](../src/statusbar.ts), [`extension.ts`](../src/extension.ts)

* **轮询机制 / Polling**: 默认每 5 秒调度一次 `pollContextUsage()`（使用 `setTimeout` 链式调用，确保上一次 RPC 完成后再调度下一次，避免计时器漂移和请求堆叠）。`schedulePoll()` 使用代计数器 `pollGeneration` 防止 `restartPolling()` 产生孤儿定时器链（旧链 `finally` 检测到 generation 变化后静默退出），通过 `disposed` 标志确保扩展停用后不会创建新的定时器，`catch` 中的 `log()` 调用有二次保护。`pollContextUsage()` 入口捕获 `cachedLsInfo` 到局部快照 `lsInfo`，防止 refresh 命令在 await 间隙清空全局变量。可通过 `pollingInterval` 设置修改。使用 `isPolling` 标志防止并发重入。
  Calls `pollContextUsage()` every 5 seconds by default using a `setTimeout` chain (each poll is scheduled only after the previous completes). `schedulePoll()` uses a `pollGeneration` counter to prevent `restartPolling()` from creating orphan timer chains (the old chain's `finally` detects a stale generation and exits silently), a `disposed` flag to prevent timers after deactivation, and double-wrapped `log()`. `pollContextUsage()` captures `cachedLsInfo` into a local `lsInfo` snapshot at entry to prevent the refresh command from nullifying it during await gaps. Configurable via `pollingInterval` setting. An `isPolling` flag prevents concurrent reentrance.

* **多会话并行计算 / Parallel Multi-Session Computation**: QuickPick 面板展示的最近 5 条 trajectory 使用 `Promise.all` 并行计算，而非逐条串行等待。每个 `getContextUsage()` 是独立的只读 RPC 查询，并行是安全的。
  The 5 most recent trajectories shown in the QuickPick panel are computed in parallel via `Promise.all`, instead of sequentially awaiting each one. Each `getContextUsage()` is an independent read-only RPC query, making parallelization safe.

* **指数退避 / Exponential Backoff**: 语言服务器连接失败时，轮询间隔按 `baseInterval × 2^(failureCount-1)` 递增，上限 60 秒。重连成功后立即恢复初始间隔。
    On LS connection failure, polling interval increases as `baseInterval × 2^(failureCount-1)`, capped at 60 seconds. Resets to base interval immediately on successful reconnection.

* **RPC 取消机制 / RPC Cancellation**: 使用 `AbortController` 管理 in-flight RPC 请求和 LS 发现过程。Extension deactivate（窗口关闭）时自动 abort 所有未完成请求，避免悬挂的网络操作。`activate()` 中重建 `AbortController`，确保扩展重新激活后正常工作。每个窗口独立的 AbortController 互不影响。
    Uses `AbortController` to manage in-flight RPC requests and LS discovery. On extension deactivate (window close), all pending requests are automatically aborted. `AbortController` is rebuilt in `activate()` to support re-activation after deactivate. Each window has its own independent AbortController.

* **压缩检测（v1.5.1 双层检测）/ Compression Detection (v1.5.1 Two-Layer)**: 主检测层：`processSteps()` 比较连续 checkpoint 的 `inputTokens`，下降超过 5000 tokens 即判定为压缩。此方式天然免疫 Undo 误报（已有 checkpoint 数据不可变）。降级检测层：跨轮询 `contextUsed` 比较（仅在主层未触发 且 stepCount 未减少时生效），覆盖少于 2 个 checkpoint 的对话。压缩标记 `🗜` 持续 3 个轮询周期（默认约 15 秒）。
    Primary layer: `processSteps()` compares consecutive checkpoint `inputTokens` — a drop exceeding 5000 tokens is flagged as compression. This is inherently immune to Undo false positives (existing checkpoint data is immutable). Fallback layer: cross-poll `contextUsed` comparison (only fires when primary layer did not detect AND stepCount did not decrease), covering conversations with < 2 checkpoints. The compression indicator `🗜` persists for 3 poll cycles (~15 seconds by default).

* **状态栏颜色 / Status Bar Colors**: 根据使用率变色——＜50% 正常、50-80% 黄色警告（`warningBackground`）、≥80% 红色（`errorBackground`）。≥95% 时图标切换为 `$(zap)`。
    Color-coded by usage: <50% normal, 50-80% warning (`warningBackground`), ≥80% error (`errorBackground`). At ≥95% the icon switches to `$(zap)`.

## 📊 5. WebView Monitor Panel / WebView 监控面板

> Source: [`webview-panel.ts`](../src/webview-panel.ts)

自 v1.10.1 起，点击状态栏打开 WebView 侧边面板（替代之前的 QuickPick 弹窗），展示完整的用户状态仪表盘。

Since v1.10.1, clicking the status bar opens a WebView side panel (replacing the previous QuickPick popup) showing a full user status dashboard.

* **数据来源 / Data Source**: 所有数据来自已有的 `GetUserStatus` RPC 调用，通过 `fetchFullUserStatus()` 函数获取完整用户状态（`FullUserStatus`）。零额外网络请求。
  All data comes from the existing `GetUserStatus` RPC call via `fetchFullUserStatus()` which returns the full `FullUserStatus` object. Zero additional network requests.

* **面板内容 / Panel Content**: 展示账户信息（planName、userTier）、Credits 余额（Prompt Credits、Flow Credits）、每模型配额百分比（带颜色指示）、Feature Flags、团队配置（MCP Servers、Auto-Run 等）、Google AI 额度。
  Displays account info (planName, userTier), credit balance (Prompt & Flow Credits), per-model quota percentages (color-coded), feature flags, team config (MCP Servers, Auto-Run, etc.), and Google AI credits.

* **隐私遮罩 / Privacy Mask**: 盾牌按钮遮罩姓名和邮箱，状态通过 `vscode.getState()` 跨面板刷新持久化。
  Shield button masks name and email; state persists across panel refreshes via `vscode.getState()`.

* **可折叠区域 / Collapsible Sections**: 次要数据（Plan Limits、Feature Flags、Team Config、Google AI Credits）默认折叠在 `<details>` 标签中，展开/收起状态持久化。
  Secondary data (Plan Limits, Feature Flags, Team Config, Google AI Credits) hidden by default in `<details>` elements; open/close state persists.

* **实时刷新 / Live Refresh**: 轮询循环中通过 `updateMonitorPanel()` 推送最新数据到已打开的面板，保持数据实时同步。
  The polling loop pushes latest data to the open panel via `updateMonitorPanel()`, keeping data in real-time sync.

## 🧠 6. Model Activity Monitor / 模型活动监控

> Source: [`activity-tracker.ts`](../src/activity-tracker.ts), [`activity-panel.ts`](../src/activity-panel.ts), [`quota-tracker.ts`](../src/quota-tracker.ts)

自 v1.11.2 起，插件追踪每个模型的实时活动数据（推理调用、工具使用、Token 消耗、耗时），并在 WebView 面板的 Activity 标签页中展示。

Since v1.11.2, the plugin tracks real-time activity data per model (reasoning calls, tool usage, tokens, timing) and displays it in the WebView panel's Activity tab.

* **步骤分类 / Step Classification**: 20+ 步骤类型被分类为 reasoning、tool、user、system 四个类别。每个步骤提取详细信息（文件名、命令、搜索词等）用于时间线展示。
  20+ step types are classified into reasoning, tool, user, and system categories. Detailed info is extracted from each step (filename, command, query, etc.) for timeline display.

* **暖机与增量更新 / Warm-up & Incremental**: 首次启动时处理所有对话的全部步骤（warm-up）以获取完整周期统计。之后仅增量处理新步骤。当 LS API 无法返回更多步骤（~500 步窗口限制）时，通过 `stepCount` 差值归因到每个对话的主模型（`dominantModel`）。
  On first launch, processes all steps across all conversations (warm-up) for complete cycle stats. Subsequently only processes new steps incrementally. When the LS API can't return more steps (~500 step window), delta is attributed to each trajectory's dominant model (`dominantModel`).

* **配额追踪与自动归档 / Quota Tracking & Auto-Archive**: `QuotaTracker` 监测配额变化，通过两种机制检测重置：① `remainingFraction` 从低值跳回 1.0；② `resetTime` 到期或发生跳变（前移 > 30min）。`processUpdate()` 循环结束后将本批次所有重置模型 ID 收集到 `resetModels[]`，一次性触发 `onQuotaReset(resetModels)` 回调。`endTime` 使用 API 返回的官方 `resetTime`（而非本地检测时间）。`ActivityTracker.archiveAndReset(modelIds)` 归档时包含 5 分钟防抖逻辑（短间隔内合并）和 `triggeredBy` 来源追踪，保留 trajectory baselines 避免重复计数。
  `QuotaTracker` monitors quota changes via two mechanisms: ① `remainingFraction` dropping then jumping back to 1.0; ② `resetTime` expiring or jumping forward (> 30min shift). `processUpdate()` collects all reset model IDs into `resetModels[]` after the loop, firing `onQuotaReset(resetModels)` once. Session `endTime` uses the official API `resetTime`. `ActivityTracker.archiveAndReset(modelIds)` includes 5-minute debounce (merge within short intervals) and `triggeredBy` source tracking, while preserving trajectory baselines.

* **三层即时使用检测（v1.11.4）/ Three-Layer Instant Usage Detection (v1.11.4)**:

  **发现过程 / How It Was Discovered**: 通过 LS 诊断脚本（`diag-snapshot.ts`）对 `GetUserStatus` 返回的 `quotaInfo.resetTime` 进行定点快照分析，发现已使用模型（如 Claude）的 `resetTime` 被锁定（不随轮询刷新），而未使用模型（如 Gemini Pro）的 `resetTime` 每次轮询都会被 API 刷新到新值。同时发现 `persist()` 方法在写入 `globalState` 时静默丢失了 `lastResetTime`、`baselineResetTime`、`idleSince` 三个字段，导致扩展重载后 drift 计算全部失效。
  Discovered via LS diagnostic scripts (`diag-snapshot.ts`) that analyzed `quotaInfo.resetTime` snapshots from `GetUserStatus`. Used models (e.g. Claude) had their `resetTime` locked (not refreshed between polls), while unused models (e.g. Gemini Pro) got fresh `resetTime` values each poll. Additionally found that `persist()` silently dropped `lastResetTime`, `baselineResetTime`, `idleSince` from serialized `ModelState`, causing drift calculations to fail completely after extension reload.

  **根因分析 / Root Cause**: 旧实现要求「被动等待 10 分钟观察 resetTime 是否锁定」，但这意味着即使模型已经使用了 1 小时，插件也需要从启动开始再等 10 分钟。加之 persist 丢字段，重载后丢失所有观察记录，必须从零开始。
  The original design required "passively waiting 10 min to observe if resetTime stays locked", meaning even if a model had been used for 1 hour, the plugin needed to wait another 10 min from boot. Combined with persist dropping fields, all observation state was lost on reload.

  **解决方案 / Solution — 三层策略**:
  - **Layer 1（即时层 / Instant）**: 在每次 poll 前，先扫描所有 100% 模型的 `timeToReset`，取最大值作为 `maxTimeToResetMs`（≈ 周期长度）。对每个模型计算 `elapsedInCycle = maxTimeToResetMs − thisTimeToReset`。若 `elapsedInCycle ≥ 10min` → 第一次 poll 就判定模型已使用，立即创建 session 并将 `startTime` 回溯到 `resetTime − maxTimeToResetMs`（周期开始时间）。
    On each poll, scans all 100% models' `timeToReset`, takes the max as `maxTimeToResetMs` (≈ cycle length). For each model: `elapsedInCycle = maxTimeToResetMs − thisTimeToReset`. If ≥ 10min → immediately enters tracking with `startTime` backdated to `resetTime − maxTimeToResetMs`.
  - **Layer 2（Drift 层）**: 如果 `resetTime` 连续 10 分钟内不变（`drift < RESET_DRIFT_TOLERANCE_MS`）→ 判定为已使用（API 未刷新 resetTime = 锁定）。作为即时层在极端情况下的兜底。
    If `resetTime` unchanged for 10 min (`drift < RESET_DRIFT_TOLERANCE_MS`) → model is used (API not refreshing resetTime = locked). Fallback for edge cases.
  - **Layer 3（Fraction 层）**: `fraction < 1.0` → 立即进入追踪，同样使用 `resetTime − maxTimeToResetMs` 回溯 `startTime`。
    `fraction < 1.0` → immediate tracking, also backdating `startTime` via `resetTime − maxTimeToResetMs`.

  **验证 / Verification**: 经 5 小时完整额度周期实机验证：Claude 组（Sonnet/Opus/GPT-OSS）通过 Layer 3 检测（fraction = 80%）→ 回溯到 09:23 → 14:22 重置归档（4h59m）✅；Flash 通过 Layer 1 检测（`elapsedInCycle = 1h01m`）→ 回溯到 10:46 → 15:46 重置归档（4h59m）✅。
  Verified over a full 5-hour quota cycle: Claude group (Sonnet/Opus/GPT-OSS) detected via Layer 3 (fraction=80%) → backdated to 09:23 → archived at 14:22 (4h59m) ✅; Flash detected via Layer 1 (`elapsedInCycle=1h01m`) → backdated to 10:46 → archived at 15:46 (4h59m) ✅.

* **持久化 / Persistence**: 活动数据通过 `globalState` 序列化存储，30 秒节流写入。恢复时强制 warm-up 重校准实际计数。
  Activity data persisted via `globalState` serialization, throttled to 30s writes. On restore, forces warm-up to recalibrate actual counts.

* **低配额通知 / Low Quota Notification**: 当模型剩余配额低于用户设定阈值（默认 20%）时弹出警告通知，每个模型每次阈值跨越仅通知一次，恢复后重新启用。
  Warning notification when model quota drops below user-configured threshold (default 20%). Each model notifies only once per threshold crossing, re-arms when recovered.

---

## 📊 6. 活动面板增强 / Activity Panel Enhancements

> 源码：[`activity-tracker.ts`](../src/activity-tracker.ts)（数据层）、[`activity-panel.ts`](../src/activity-panel.ts)（UI 层）

* **上下文增长趋势 / Context Growth Trend**: `CheckpointSnapshot` 接口记录每个 CHECKPOINT 的 `inputTokens`、`outputTokens` 和 `compressed` 标志。压缩检测阈值为 inputTokens 下降 ≥30%（`inTok < prevCp.inputTokens * 0.7`）。UI 使用 SVG `<polyline>` + `<polygon>` 渲染面积图，压缩事件用红色 `<circle>` 标记。
  `CheckpointSnapshot` records each CHECKPOINT's `inputTokens`, `outputTokens`, and `compressed` flag. Compression detected when inputTokens drops ≥30%. UI renders SVG area chart with red circle markers for compression events.

* **工具排行 / Tool Ranking**: `globalToolStats` (Map) 统计全局工具调用次数。UI 取 Top 10 渲染 CSS 水平条形图，10 色彩虹色阶通过 CSS class `.act-rank-c0~c9` 定义（避免 inline style 被 CSP 阻止）。条形宽度通过 `style="width:X%"` 设置。
  `globalToolStats` counts tool calls globally. UI renders top 10 as CSS horizontal bar chart with 10-color rainbow palette via CSS classes (avoiding CSP-blocked inline styles). Bar width set via inline `style="width:X%"`.

* **对话级分布 / Conversation Breakdown**: `ConversationBreakdown` 接口存储每个对话的步骤数和 token 用量。token 取值方式：取该对话**最后一个 CHECKPOINT** 的 `inputTokens`/`outputTokens` 最大值（累积快照值，非逐步累加）。字段路径：`step.type`（非 `metadata.cortexStepType`）。
  Per-conversation stats taking the max `inputTokens`/`outputTokens` from the last CHECKPOINT (cumulative snapshot). Field path: `step.type` (not `metadata.cortexStepType`).

* **Summary Bar 增强**: 新增会话时长（`Date.now() - sessionStartTime`）、`totalToolReturnTokens`、`totalCheckpoints` 卡片。全部 emoji 替换为 inline SVG。布局从 flex 改为 CSS Grid（`repeat(auto-fill, minmax(90px, 1fr))`），每个统计项独立卡片带 hover 发光效果。
  Enhanced with session duration, toolReturnTokens, checkpoint count. All emojis replaced with inline SVGs. Layout changed from flex to CSS Grid cards with hover glow.

* **迁移策略 / Migration Strategy**: `restore()` 中检测三个迁移条件触发 nuclear reset + re-warm-up：
  1. `needsSubAgentMigration`: 有 checkpoints 但无 subAgentTokens
  2. `needsHistoryMigration`: 有 checkpoints 但 checkpointHistory 为空
  3. `cbAllZero`: conversationBreakdown 全部 token 为 0（旧版字段路径 bug 产生的脏数据）

  Three migration triggers in `restore()` force nuclear reset + re-warm-up: missing subAgentTokens, empty checkpointHistory, or all-zero conversationBreakdown (bad data from old field path bug).

---
基于 TypeScript 构建，适用于 Antigravity IDE。包含 63 个 vitest 单元测试覆盖纯逻辑函数（`npm test`）：`discovery.test.ts`（11 tests）、`statusbar.test.ts`（11 tests）、`tracker.test.ts`（16 tests）、`quota-tracker.test.ts`（25 tests）。
Built with TypeScript for the Antigravity IDE. Includes 63 vitest unit tests covering pure logic functions (`npm test`): `discovery.test.ts` (11 tests), `statusbar.test.ts` (11 tests), `tracker.test.ts` (16 tests), `quota-tracker.test.ts` (25 tests).

# 🛠️ Antigravity Context Window Monitor — 技术实现说明 / Technical Implementation

本文档说明 Antigravity Context Window Monitor 插件的工作原理。插件由四个核心模块组成：`discovery.ts`（服务器发现）、`tracker.ts`（Token 计算）、`extension.ts`（轮询调度）、`statusbar.ts`（界面展示）。

This document explains how the Antigravity Context Window Monitor plugin works. The plugin consists of four core modules: `discovery.ts` (server discovery), `tracker.ts` (token calculation), `extension.ts` (polling scheduler), and `statusbar.ts` (UI display).

---

## 🧭 1. 语言服务器发现 / Language Server Discovery

> 源码：[`discovery.ts`](../src/discovery.ts)

每个 Antigravity 工作区都有一个后台进程（Language Server）处理 AI 对话请求。插件需要找到当前工作区对应的语言服务器并建立连接。

Each Antigravity workspace has a background Language Server process handling AI conversation requests. The plugin needs to locate the correct one for the current workspace and connect to it.

* **进程扫描 / Process Scanning**: 使用 macOS `ps` 命令（通过异步 `execFile` 调用，不阻塞 IDE UI 线程）查找 `language_server_macos` 进程，并通过 `--workspace_id` 参数匹配当前工作区。使用 `execFile` 而非 shell 命令拼接，避免命令注入风险。支持可选的 `AbortSignal` 参数，用于扩展停用时取消发现过程。核心解析逻辑已提取为独立导出函数（`buildExpectedWorkspaceId`、`extractPid`、`extractCsrfToken`、`extractWorkspaceId`、`filterLsProcessLines`、`extractPort`），可被单元测试直接验证。v1.5.3: `discoverLanguageServer` 内部工作区匹配现在调用 `extractWorkspaceId()` 函数，消除内联正则重复。这也是目前仅支持 macOS 的原因。
  Uses macOS `ps` command (via async `execFile`, non-blocking to IDE UI thread) to find `language_server_macos` processes, matching the current workspace via the `--workspace_id` argument. Uses `execFile` instead of shell string concatenation to prevent command injection. Accepts optional `AbortSignal` for cancellation on extension deactivate. Core parsing logic extracted into exported functions (`buildExpectedWorkspaceId`, `extractPid`, `extractCsrfToken`, etc.) that can be directly unit-tested. v1.5.3: `discoverLanguageServer` internal workspace matching now calls `extractWorkspaceId()`, eliminating inline regex duplication. This is why only macOS is currently supported.

* **提取连接参数 / Extracting Connection Info**: 从进程命令行中提取 PID 和 `csrf_token`（用于 RPC 请求鉴权）。
  Extracts PID and `csrf_token` from process arguments (used for RPC request authentication).

* **端口发现 / Port Discovery**: 使用 `lsof -nP -iTCP -sTCP:LISTEN -a -p <PID>` 查找语言服务器监听的本地端口。
  Uses `lsof -nP -iTCP -sTCP:LISTEN -a -p <PID>` to find the local port the language server is listening on.

* **连接探测 / Connection Probing**: 向发现的端口发送一个轻量 RPC 请求（`GetUnleashData`）测试连接，并验证 HTTP 状态码为 2xx。先尝试 HTTPS（语言服务器通常使用自签名证书），失败则降级为 HTTP。响应流新增 `res.on('error')` 处理，避免 TCP RST 等异常导致 Promise 挂起。
  Sends a lightweight RPC request (`GetUnleashData`) to test connectivity, verifying HTTP status code is 2xx. Tries HTTPS first (the LS typically uses self-signed certs), falls back to HTTP. Response stream now has `res.on('error')` handler to prevent Promise hang on TCP RST or similar issues.

## ♾️ 2. 对话数据跟踪 / Conversation Tracking

> 源码：[`tracker.ts`](../src/tracker.ts) — `getAllTrajectories()`、[`extension.ts`](../src/extension.ts) — 轮询逻辑

连接成功后，插件定期获取对话数据并跟踪变化。

Once connected, the plugin periodically fetches conversation data and tracks changes.

* **获取会话列表 / Fetching Sessions**: 调用 `GetAllCascadeTrajectories` RPC 接口获取所有对话（称为 Trajectory），包括 cascadeId、stepCount、状态、使用的模型。
  Calls the `GetAllCascadeTrajectories` RPC endpoint to get all conversations (called Trajectories), including cascadeId, stepCount, status, and model used.

* **工作区隔离 / Workspace Isolation**: 通过比较 trajectory 上的 `workspaceUris` 与当前窗口的 workspace URI（经过 `normalizeUri` 标准化处理），只显示属于当前工作区的对话。
  Filters trajectories by comparing their `workspaceUris` against the current window's workspace URI (normalized via `normalizeUri`), showing only conversations belonging to this workspace.

* **活跃会话选择 / Active Session Selection**: 按优先级选择要显示的会话：
  Selects which session to display, by priority:
  1. 状态为 RUNNING 的对话 / Trajectory with RUNNING status
  2. `stepCount` 发生变化的对话（增加=新消息，减少=撤销操作）/ Trajectory with stepCount change (increase = new message, decrease = undo)
  3. 新出现的对话 / Newly appeared trajectory

* **逐步分析 / Step Analysis**: 对选中的对话调用 `GetCascadeTrajectorySteps`，通过 `Promise.allSettled` 分组获取所有批次（每批 50 步，最多 5 个并发组），然后将完整步骤数组传给纯函数 `processSteps()` 进行计算。`endIndex` 上限被限制为 `stepCount`，避免 LS API 的循环返回行为。失败的批次标记为 `hasGaps`，不阻塞其他批次。`processSteps()` 是从 `getTrajectoryTokenUsage` 中提取的无副作用纯函数，可直接用构造数据进行单元测试。
  For the selected conversation, calls `GetCascadeTrajectorySteps` with all batches (50 steps each) fetched in groups of up to 5 concurrent batches via `Promise.allSettled`, then passes the collected steps array to the pure function `processSteps()` for computation. `endIndex` is capped at `stepCount` to prevent the LS API's wrap-around behavior. Failed batches are flagged as `hasGaps` without blocking others. `processSteps()` is a side-effect-free pure function extracted from `getTrajectoryTokenUsage`, directly unit-testable with constructed step data.

## 🧮 3. Token 计算逻辑 / Token Calculation

> 源码：[`tracker.ts`](../src/tracker.ts) — `processSteps()`（纯计算）、`getTrajectoryTokenUsage()`（RPC 获取 + 调用 processSteps）

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

## 🖥️ 4. 状态栏与轮询 / Status Bar & Polling

> 源码：[`statusbar.ts`](../src/statusbar.ts)、[`extension.ts`](../src/extension.ts)

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

---
基于 TypeScript 构建，适用于 Antigravity IDE。包含 78 个 vitest 单元测试覆盖纯逻辑函数和扩展生命周期（`npm test`）：`tracker.test.ts`（45 tests）、`discovery.test.ts`（16 tests）、`statusbar.test.ts`（10 tests）、`extension.test.ts`（7 tests）。
Built with TypeScript for the Antigravity IDE. Includes 78 vitest unit tests covering pure logic functions and extension lifecycle (`npm test`): `tracker.test.ts` (45 tests), `discovery.test.ts` (16 tests), `statusbar.test.ts` (10 tests), `extension.test.ts` (7 tests).

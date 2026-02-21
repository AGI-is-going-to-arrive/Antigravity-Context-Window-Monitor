# 🛠️ Antigravity Context Window Monitor — 技术实现说明 / Technical Implementation

本文档说明 Antigravity Context Window Monitor 插件的工作原理。插件由四个核心模块组成：`discovery.ts`（服务器发现）、`tracker.ts`（Token 计算）、`extension.ts`（轮询调度）、`statusbar.ts`（界面展示）。

This document explains how the Antigravity Context Window Monitor plugin works. The plugin consists of four core modules: `discovery.ts` (server discovery), `tracker.ts` (token calculation), `extension.ts` (polling scheduler), and `statusbar.ts` (UI display).

---

## 🧭 1. 语言服务器发现 / Language Server Discovery

> 源码：[`discovery.ts`](../src/discovery.ts)

每个 Antigravity 工作区都有一个后台进程（Language Server）处理 AI 对话请求。插件需要找到当前工作区对应的语言服务器并建立连接。

Each Antigravity workspace has a background Language Server process handling AI conversation requests. The plugin needs to locate the correct one for the current workspace and connect to it.

* **进程扫描 / Process Scanning**: 使用 macOS `ps` 命令查找 `language_server_macos_x64` 进程，并通过 `--workspace_id` 参数匹配当前工作区。这也是目前仅支持 macOS 的原因。
  Uses macOS `ps` command to find `language_server_macos_x64` processes, matching the current workspace via the `--workspace_id` argument. This is why only macOS is currently supported.

* **提取连接参数 / Extracting Connection Info**: 从进程命令行中提取 PID 和 `csrf_token`（用于 RPC 请求鉴权）。
  Extracts PID and `csrf_token` from process arguments (used for RPC request authentication).

* **端口发现 / Port Discovery**: 使用 `lsof -nP -iTCP -sTCP:LISTEN -a -p <PID>` 查找语言服务器监听的本地端口。
  Uses `lsof -nP -iTCP -sTCP:LISTEN -a -p <PID>` to find the local port the language server is listening on.

* **连接探测 / Connection Probing**: 向发现的端口发送一个轻量 RPC 请求（`GetUnleashData`）测试连接。先尝试 HTTPS（语言服务器通常使用自签名证书），失败则降级为 HTTP。
  Sends a lightweight RPC request (`GetUnleashData`) to test connectivity. Tries HTTPS first (the LS typically uses self-signed certs), falls back to HTTP.

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

* **逐步分析 / Step Analysis**: 对选中的对话调用 `GetCascadeTrajectorySteps`，按批次（每批 50 步）遍历所有步骤，提取模型信息和 Token 数据。`endIndex` 上限被限制为 `stepCount`，避免 LS API 的循环返回行为。
  For the selected conversation, calls `GetCascadeTrajectorySteps` in batches of 50 steps, extracting model info and token data. `endIndex` is capped at `stepCount` to prevent the LS API's wrap-around behavior.

## 🧮 3. Token 计算逻辑 / Token Calculation

> 源码：[`tracker.ts`](../src/tracker.ts) — `getTrajectoryTokenUsage()`

* **精确值（Checkpoint）/ Precise Values**: 语言服务器会在 `CORTEX_STEP_TYPE_CHECKPOINT` 类型的步骤中提供 `modelUsage` 数据，包含模型实际计算的 `inputTokens` 和 `outputTokens`。插件始终使用最后一个 checkpoint 的值作为基准。
  The language server provides `modelUsage` data in `CORTEX_STEP_TYPE_CHECKPOINT` steps, containing the model's actual `inputTokens` and `outputTokens`. The plugin always uses the last checkpoint as the baseline.

* **实时估算 / Real-Time Estimation**: 在两个 checkpoint 之间，插件用以下常量估算新增的 Token：系统提示词开销约 2000 tokens（`SYSTEM_PROMPT_OVERHEAD`），每条用户输入约 500 tokens（`USER_INPUT_OVERHEAD`），每条 planner 回复约 800 tokens（`PLANNER_RESPONSE_ESTIMATE`）。这些估算值加上实际的 `toolCallOutputTokens` 构成增量。
  Between checkpoints, the plugin estimates added tokens using constants: system prompt overhead ~2000 tokens (`SYSTEM_PROMPT_OVERHEAD`), ~500 per user input (`USER_INPUT_OVERHEAD`), ~800 per planner response (`PLANNER_RESPONSE_ESTIMATE`). These estimates plus actual `toolCallOutputTokens` form the delta.

* **上下文窗口 = inputTokens + outputTokens + 增量 / Context = inputTokens + outputTokens + delta**: 总上下文占用是 checkpoint 的 input + output 加上 checkpoint 之后的估算增量。
  Total context usage is checkpoint input + output plus estimated delta since the last checkpoint.

* **图片生成 Token 追踪 / Image Gen Token Tracking**: 通过两种方式检测图片生成步骤：step type 中包含 `IMAGE` 或 `GENERATE`，或 generator model 名称中包含 `nano`、`banana`、`image`。使用 Set 对每个步骤去重，防止重复计数。
  Detects image generation steps two ways: step type containing `IMAGE` or `GENERATE`, or generator model name containing `nano`, `banana`, or `image`. Uses a Set to deduplicate per step index.

## 🖥️ 4. 状态栏与轮询 / Status Bar & Polling

> 源码：[`statusbar.ts`](../src/statusbar.ts)、[`extension.ts`](../src/extension.ts)

* **轮询机制 / Polling**: 默认每 5 秒调用一次 `pollContextUsage()`，获取最新数据并更新状态栏。可通过 `pollingInterval` 设置修改。
  Calls `pollContextUsage()` every 5 seconds by default, fetching latest data and updating the status bar. Configurable via `pollingInterval` setting.

* **指数退避 / Exponential Backoff**: 语言服务器连接失败时，轮询间隔按 `baseInterval × 2^(failureCount-1)` 递增，上限 60 秒。重连成功后立即恢复初始间隔。
  On LS connection failure, polling interval increases as `baseInterval × 2^(failureCount-1)`, capped at 60 seconds. Resets to base interval immediately on successful reconnection.

* **压缩检测 / Compression Detection**: 每次轮询后记录 `contextUsed`。如果下次轮询时同一会话的 `contextUsed` 下降幅度超过 `contextLimit` 的 1%，则判定为模型进行了上下文压缩，状态栏显示 `🗜` 标识约 5 秒。
  Records `contextUsed` after each poll. If the same session's `contextUsed` drops by more than 1% of `contextLimit` on the next poll, it's identified as context compression and the `🗜` indicator is shown for ~5 seconds.

* **状态栏颜色 / Status Bar Colors**: 根据使用率变色——＜50% 正常、50-80% 黄色警告（`warningBackground`）、≥80% 红色（`errorBackground`）。≥95% 时图标切换为 `$(zap)`。
  Color-coded by usage: <50% normal, 50-80% warning (`warningBackground`), ≥80% error (`errorBackground`). At ≥95% the icon switches to `$(zap)`.

---
基于 TypeScript 构建，适用于 Antigravity IDE。
Built with TypeScript for the Antigravity IDE.

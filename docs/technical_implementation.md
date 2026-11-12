# 🛠️ Antigravity Context Window Monitor — Technical Implementation / 技术实现说明

This document explains how the Antigravity Context Window Monitor plugin works. The plugin consists of the following core modules: `discovery.ts` (server discovery), `tracker.ts` (token calculation), `extension.ts` (polling scheduler), `statusbar.ts` (UI display), `webview-panel.ts` (WebView panel orchestrator), `activity-tracker.ts` (model activity tracking), `activity-panel.ts` (GM Data UI), `pricing-panel.ts` (Cost and Models UI), `quota-tracker.ts` (quota tracking), `rpc-client.ts` (RPC communication layer), `models.ts` (model config & display names), `constants.ts` (constants), and `i18n.ts` (internationalization system). WebView panel split into: `activity-panel.ts`, `pricing-panel.ts`, `webview-chat-history-tab.ts`, `webview-models-tab.ts`, `webview-profile-tab.ts`, `webview-settings-tab.ts`, `webview-calendar-tab.ts`, `webview-about-tab.ts`, `webview-script.ts`, `webview-styles.ts`, `webview-helpers.ts`, `webview-icons.ts`.

本文档说明 Antigravity Context Window Monitor 插件的工作原理。插件由以下核心模块组成：`discovery.ts`（服务器发现）、`tracker.ts`（Token 计算）、`extension.ts`（轮询调度）、`statusbar.ts`（界面展示）、`webview-panel.ts`（WebView 面板调度）、`activity-tracker.ts`（模型活动追踪）、`activity-panel.ts`（GM Data UI）、`pricing-panel.ts`（Cost 与 Models UI）、`quota-tracker.ts`（配额追踪）、`rpc-client.ts`（RPC 通信层）、`models.ts`（模型配置与显示名称）、`constants.ts`（常量定义）、`i18n.ts`（国际化系统）。WebView 面板拆分为：`activity-panel.ts`、`pricing-panel.ts`、`webview-chat-history-tab.ts`、`webview-models-tab.ts`、`webview-profile-tab.ts`、`webview-settings-tab.ts`、`webview-calendar-tab.ts`、`webview-about-tab.ts`、`webview-script.ts`、`webview-styles.ts`、`webview-helpers.ts`、`webview-icons.ts`。

Current release / 当前版本: **1.16.21**. See [release notes / 发布说明](releases/1.16.21.md).

---

## 🧭 1. Backend Discovery / 后端发现

> Source: [`discovery.ts`](../src/discovery.ts), [`backend-connection.ts`](../src/backend-connection.ts)

Antigravity IDE now uses an `agy --hub` backend on current builds; older builds use shared or workspace-specific `language_server_*` processes. Both expose the local Connect-RPC `exa.language_server_pb.LanguageServerService` interface consumed by the monitor. Version 1.16.19 adds hub discovery without replacing legacy compatibility.

当前 Antigravity IDE 使用 `agy --hub` 后端；旧版采用共享或按工作区启动的 `language_server_*` 进程。两者均提供监控器使用的本地 Connect-RPC `exa.language_server_pb.LanguageServerService` 接口。1.16.19 新增 hub 发现，同时保留旧架构兼容。

* **Process identity / 进程身份:** The hub is identified by its executable (`agy` or `agy.exe`) and hub/data-directory arguments, not merely by an arbitrary command line containing “agy”. Legacy processes are still selected using their platform binary names and workspace information. Process discovery uses async `execFile`, with no shell interpolation, and accepts an `AbortSignal` for cancellation.
  Hub 通过可执行文件（`agy` 或 `agy.exe`）及 hub/数据目录参数识别，不会仅因任意命令行含有 “agy” 就被接受。旧版进程继续按平台二进制名称和工作区信息选择。发现通过异步 `execFile` 执行，不进行 shell 拼接，并支持 `AbortSignal` 取消。

* **Connection arguments / 连接参数:** Current hubs use `--hub-port=<port>` and `--csrf_token=<token>`. Parsing supports equals-separated and space-separated values, including quoted paths/arguments and Windows CSV command lines. Tokens retain their original case and are used only for local RPC authentication; diagnostic logs must not contain them. Declared ports must be valid integers in 1–65535.
  当前 hub 使用 `--hub-port=<port>`、`--csrf_token=<token>`。解析兼容等号及空格分隔值、带引号的路径/参数和 Windows CSV 命令行。Token 保留原始大小写，仅用于本地 RPC 鉴权，不写入诊断日志；声明端口必须为 1–65535 范围内的有效整数。

* **Platform discovery / 平台发现:** macOS and Linux use `ps`; socket lookup uses `lsof`, with Linux `ss` as a fallback. Windows uses WMIC when available and PowerShell `Get-CimInstance` otherwise, together with `netstat -ano`. System tools use absolute `%SystemRoot%` paths on Windows to avoid GUI-host PATH differences. PID parsing supports both WMIC and PowerShell CSV layouts; socket ownership uses exact PID matching and accepts reachable wildcard/loopback bindings, including localized Windows listening states.
  macOS/Linux 使用 `ps`，套接字查询使用 `lsof`，Linux 可回退到 `ss`。Windows 在可用时使用 WMIC，否则回退到 PowerShell `Get-CimInstance`，并通过 `netstat -ano` 查端口；系统工具采用 `%SystemRoot%` 绝对路径，避免 GUI 宿主的 PATH 差异。PID 解析兼容 WMIC/PowerShell 两种 CSV 布局；套接字按精确 PID 归属匹配，兼容可达的通配/回环监听地址及本地化 Windows 监听状态。

* **Workspace and WSL compatibility / 工作区与 WSL 兼容:** Shared backends do not require an open workspace. Legacy workspace IDs are derived from the raw URI, preserving percent-encoding digits before replacing non-alphanumeric characters and collapsing underscores; decoding first would break paths containing spaces or CJK characters. Remote-WSL discovery uses `wsl -d <distro>`; an extension host running inside WSL first checks its own Linux backend before Windows-host interop. `extensionKind: ["ui", "workspace"]` prefers the local UI host.
  共享后端不要求打开工作区。旧版 workspace ID 从原始 URI 生成，保留百分号编码中的数字，再替换非字母数字字符并合并下划线；先解码会破坏空格或中日韩字符路径的匹配。Remote-WSL 通过 `wsl -d <distro>` 发现；扩展宿主自身运行在 WSL 时，先检查同一 Linux 环境的后端，再尝试 Windows 互操作。`extensionKind: ["ui", "workspace"]` 优先选择本地 UI 宿主。

* **Connection validation / 连接验证:** Hub discovery tries its declared loopback HTTP port before platform socket fallback. `GetUnleashData` probes validate an HTTP 2xx JSON response; legacy HTTPS and HTTP endpoints remain supported. Requests are bounded by timeouts, response limits, and cancellation. Stale candidates do not block later candidates. An IDE-supplied port/token hint confines discovery to that instance, preventing a fallback to another IDE/account. Polling revalidates the backend PID periodically so a restarted IDE can be rediscovered.
  Hub 发现先检查声明的本地回环 HTTP 端口，再回退到平台套接字发现。`GetUnleashData` 探测校验 HTTP 2xx JSON 响应，同时保留旧版 HTTPS/HTTP 端点支持。请求具有超时、响应大小限制和取消处理。失效候选不会阻止后续候选；IDE 提供的端口/token 提示将发现范围限定为对应实例，防止回退到其他 IDE/账号。轮询定期复核后端 PID，以重新发现 IDE 重启后的实例。

`backend-connection.ts` reads connection exports from the current window's already active `google.google-antigravity` extension without activating it. The port/token hint is validated on every discovery attempt, so backend restarts do not reuse stale exported values. Missing, malformed, or throwing exports safely fall back to process discovery.

`backend-connection.ts` 从当前窗口已激活的 `google.google-antigravity` 内置扩展读取连接导出，不主动激活该扩展。每次发现都重新读取并校验端口/token 提示，避免后端重启后沿用旧导出值；导出缺失、非法或 getter 抛错时安全回退到进程发现。

A successful connection can return an empty `GetAllCascadeTrajectories` response because no trajectories are currently loaded. Saved history may still exist in the IDE. This empty/idle state must not be reported as `LS not found`; connection failures remain a separate state. Missing/lost-backend tooltips are localized in English, Chinese, and bilingual mode, and refresh immediately when the language changes.

连接成功后，`GetAllCascadeTrajectories` 也可能因尚未加载 trajectory 而返回空结果；IDE 中仍可能保留历史记录。该空闲/空状态不能被报告为 `LS not found`，连接失败需要单独显示。未发现/失去后端连接的 tooltip 支持英文、中文和双语，并在切换语言时立即刷新。

## ♾️ 2. Conversation Tracking / 对话数据跟踪

> Source: [`tracker.ts`](../src/tracker.ts) — `getAllTrajectories()`, [`extension.ts`](../src/extension.ts) — polling logic

Once connected, the plugin periodically fetches conversation data and tracks changes.

连接成功后，插件定期获取对话数据并跟踪变化。

* **Fetching Sessions / 获取会话列表**: Calls the `GetAllCascadeTrajectories` RPC endpoint to get all conversations (called Trajectories), including cascadeId, stepCount, status, and model used.
  调用 `GetAllCascadeTrajectories` RPC 接口获取所有对话（称为 Trajectory），包括 cascadeId、stepCount、状态、使用的模型。

* **Workspace Isolation / 工作区隔离**: When a workspace folder is open, filters trajectories by comparing their `workspaceUris` against the current window's workspace URI (normalized via `normalizeUri`), so current-workspace conversations stay first. Since v1.14.4, when no folder is open (no workspace), all trajectories are shown without filtering. Since v1.16.5, if Antigravity keeps reporting a stale workspace URI after a project switch and no current-workspace trajectory is RUNNING, the selector can follow a RUNNING trajectory from the shared LS as a fallback. That fallback is covered by `selectRunningTrajectoryCandidate()` tests, and the selected cross-workspace trajectory is included in the recent usage scope so the panel and persisted monitor snapshot stay consistent.
  有工作区文件夹打开时，通过比较 trajectory 上的 `workspaceUris` 与当前窗口的 workspace URI（经过 `normalizeUri` 标准化处理），优先显示当前工作区对话。自 v1.14.4 起，未打开文件夹（无工作区）时显示所有 trajectory 不做过滤。自 v1.16.5 起，如果 Antigravity 在切换项目后仍上报旧 workspace URI，且当前工作区没有 RUNNING 对话，选择器会降级跟随共享 LS 里正在 RUNNING 的对话。这个 fallback 由 `selectRunningTrajectoryCandidate()` 单测覆盖，并且被选中的跨工作区 trajectory 会进入 recent usage scope，避免面板和持久化快照缺少当前会话数据。

* **Active Session Selection / 活跃会话选择**: Selects which session to display, by priority:
  按优先级选择要显示的会话：
  1. Current-workspace trajectory with RUNNING status, then RUNNING fallback from shared LS / 当前工作区 RUNNING 对话优先，其次共享 LS 的 RUNNING 降级路径
  2. Trajectory with stepCount change (increase = new message, decrease = undo) / `stepCount` 发生变化的对话
  3. Newly appeared trajectory / 新出现的对话

* **Step Analysis / 逐步分析**: For the selected conversation, calls `GetCascadeTrajectorySteps` with all batches (50 steps each) fetched in groups of up to 5 concurrent batches via `Promise.allSettled`, then passes the collected steps array to the pure function `processSteps()` for computation. `endIndex` is capped at `stepCount` to prevent the LS API's wrap-around behavior. Failed batches are flagged as `hasGaps` without blocking others. `processSteps()` is a side-effect-free pure function extracted from `getTrajectoryTokenUsage`, directly unit-testable with constructed step data. Since v1.16.4, `CHECKPOINT` steps still provide token baselines but no longer overwrite the user-visible display model. Their internal generator/modelUsage model is carried separately as `checkpointModel` for tooltip transparency. Current hub planner-response `metadata.modelUsage` also supplies precise snapshots. Before a response exists, `userInput.userConfig.plannerConfig.planModel` (or `modelName`) identifies the selected model/effort tier.
  对选中的对话调用 `GetCascadeTrajectorySteps`，通过 `Promise.allSettled` 分组获取所有批次，然后将完整步骤数组传给纯函数 `processSteps()` 进行计算。自 v1.16.4 起，`CHECKPOINT` 步骤仍作为 token 基线来源，但不再覆盖用户可见的显示模型；其内部 generator/modelUsage 模型单独作为 `checkpointModel` 传给 tooltip。当前 hub 的 planner-response `metadata.modelUsage` 也可提供精确快照；首次回复前从 `userInput.userConfig.plannerConfig.planModel`（或 `modelName`）识别所选模型/档位。

## 🧮 3. Token Calculation / Token 计算逻辑

> Source: [`tracker.ts`](../src/tracker.ts) — `processSteps()` (pure computation), `getTrajectoryTokenUsage()` (RPC fetch + calls processSteps)

* **Precise snapshots / 精确快照:** `modelUsage` on a completed planner response or legacy `CHECKPOINT` contains provider-reported input/output counts. The latest valid snapshot is the baseline; planner snapshots replace earlier counts rather than being added to them. Counts must be non-negative safe integers; malformed values are not treated as precise telemetry. `tokenUsageSource` records `planner`, `checkpoint`, or `estimated` provenance.
  已完成的 planner response 或旧版 `CHECKPOINT` 上的 `modelUsage` 包含提供商报告的输入/输出数。最新有效快照作为基线；planner 快照替换前值而非逐次相加。Token 数必须为非负安全整数，非法值不能作为精确遥测；`tokenUsageSource` 记录 `planner`、`checkpoint` 或 `estimated` 来源。

* **Estimates between snapshots / 快照间估算:** When fresh provider counts are absent, text-based estimates use user input, response/thinking text, and tool arguments. ASCII characters are estimated at 4 per token and non-ASCII at 1.5 per token; missing parent structures use the existing fallback constants. Precise snapshots reset the accumulated estimate so a response is not counted twice.
  缺少新的提供商计数时，根据用户输入、回复/思考文本和工具参数估算。ASCII 字符按每 token 4 个、非 ASCII 按每 token 1.5 个；父级数据结构缺失时使用既有兜底常量。精确快照到达后清零累计估算，避免重复计算回复。

* **Cache-inclusive context / 包含缓存的上下文:** `contextUsed = inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens + estimatedDelta`. Here provider `inputTokens` is fresh input; cached input still occupies the context window. Provider counts remain authoritative. GM `estimatedTokensUsed` is a pre-request estimate and may only fill missing provider usage; it never replaces an available precise snapshot or changes an estimate to a precise value.
  `contextUsed = 新输入 + 缓存读取 + 缓存创建 + 输出 + 估算增量`。提供商 `inputTokens` 是新输入，缓存输入仍占用上下文。提供商计数优先；GM 的 `estimatedTokensUsed` 是请求前估算，仅可补充缺失的提供商用量，不能覆盖精确快照或把估算标为精确值。

* **图片生成 Token 追踪 / Image Gen Token Tracking**: 通过两种方式检测图片生成步骤：step type 中包含 `IMAGE` 或 `GENERATE`，或 generator model 名称中包含 `nano`、`banana`、`image`。使用 Set 对每个步骤去重，防止重复计数。
  Detects image generation steps two ways: step type containing `IMAGE` or `GENERATE`, or generator model name containing `nano`, `banana`, or `image`. Uses a Set to deduplicate per step index.

* **GM capacity and retries / GM 容量与重试:** `contextWindowCapacity` first uses a valid legacy `plannerConfig.truncationThresholdTokens`, then falls back to `chatModel.chatStartMetadata.contextWindowMetadata.maxContextTokens` (`cwm.maxContextTokens`). Explicit retry records are authoritative: successful entries do not count as retries, and `cm.retries` is only a fallback when the retry list is absent/empty.
  `contextWindowCapacity` 优先使用有效的旧版 `plannerConfig.truncationThresholdTokens`，否则回退到 `chatModel.chatStartMetadata.contextWindowMetadata.maxContextTokens`（`cwm.maxContextTokens`）。显式重试记录优先，成功条目不算重试；只有重试列表缺失/为空时才回退到 `cm.retries`。

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

* **指数退避 / Exponential Backoff**: 语言服务器连接失败时，轮询间隔按 `baseInterval × 2^(failureCount-1)` 递增。自 v1.14.4 起采用**双上限策略**：LS 发现失败（进程未找到）上限 15 秒（`MAX_DISCOVERY_BACKOFF_MS`），RPC 通信失败上限 60 秒（`MAX_BACKOFF_INTERVAL_MS`）。发现退避序列：5s → 10s → 15s（封顶），确保新启动的 LS 在 ~15 秒内被检测到。重连成功后立即恢复初始间隔。
    On LS connection failure, polling interval increases as `baseInterval × 2^(failureCount-1)`. Since v1.14.4, uses a **dual-cap strategy**: LS discovery failures (process not found) cap at 15 seconds (`MAX_DISCOVERY_BACKOFF_MS`), while RPC communication failures cap at 60 seconds (`MAX_BACKOFF_INTERVAL_MS`). Discovery backoff sequence: 5s → 10s → 15s (capped), ensuring a newly started LS is detected within ~15 seconds. Resets to base interval immediately on successful reconnection.

* **RPC 取消机制 / RPC Cancellation**: 使用 `AbortController` 管理 in-flight RPC 请求和 LS 发现过程。Extension deactivate（窗口关闭）时自动 abort 所有未完成请求，避免悬挂的网络操作。`activate()` 中重建 `AbortController`，确保扩展重新激活后正常工作。每个窗口独立的 AbortController 互不影响。
    Uses `AbortController` to manage in-flight RPC requests and LS discovery. On extension deactivate (window close), all pending requests are automatically aborted. `AbortController` is rebuilt in `activate()` to support re-activation after deactivate. Each window has its own independent AbortController.

* **压缩检测（v1.5.1 双层检测）/ Compression Detection (v1.5.1 Two-Layer)**: 主检测层：`processSteps()` 比较连续 checkpoint 的含缓存输入（新输入 + 缓存读取 + 缓存创建），下降超过 5000 tokens 即判定为压缩。此方式天然免疫 Undo 误报（已有 checkpoint 数据不可变）。降级层仅在模型及 token 来源一致、没有 Undo 时比较实测 `contextUsed` 快照，估算转精确和缓存命中变化不会被误判为压缩。压缩标记 `🗜` 持续 3 个轮询周期（默认约 15 秒）。
    Primary layer: `processSteps()` compares cache-inclusive checkpoint input (fresh input + cache reads + cache creation) — a drop exceeding 5000 tokens is flagged as compression. This is inherently immune to Undo false positives (existing checkpoint data is immutable). Fallback layer compares measured `contextUsed` snapshots only when model and token source are unchanged and no undo occurred. Estimate-to-measured transitions and cache-hit shifts do not become compression events. The compression indicator `🗜` persists for 3 poll cycles (~15 seconds by default).

* **状态栏颜色 / Status Bar Colors**: 根据使用率变色——＜50% 正常、50-80% 黄色警告（`warningBackground`）、≥80% 红色（`errorBackground`）。≥95% 时图标切换为 `$(zap)`。
    Color-coded by usage: <50% normal, 50-80% warning (`warningBackground`), ≥80% error (`errorBackground`). At ≥95% the icon switches to `$(zap)`.

* **计划层级缓存清理 / Plan-Tier Cache Clearing (v1.15.1)**: 状态栏 hover 中的计划信息通过 `StatusBarManager.setPlanName()` 缓存。自 v1.15.1 起，最新轮询如果未返回 `userTierName`，缓存会被显式清空，而不是保留旧的二级层级后缀，避免历史标签残留在后续 hover 中。
  The plan row in the status bar hover is cached through `StatusBarManager.setPlanName()`. Since v1.15.1, when a later poll omits `userTierName`, the cached secondary tier is explicitly cleared instead of preserving the old suffix, preventing stale labels from lingering in later hovers.

* **Checkpoint Shadow Model Row (v1.16.4) / Checkpoint 影子模型行**: `statusbar.ts` shortens internal checkpoint model IDs (for example `MODEL_PLACEHOLDER_M50` → `M50`) and shows them next to the latest checkpoint line. This is diagnostic context only; the main model row continues to reflect the user-selected model.
  `statusbar.ts` 会把内部 checkpoint 模型 ID 短化（例如 `MODEL_PLACEHOLDER_M50` → `M50`）并显示在最近 checkpoint 行旁边。它只用于诊断透明度，主模型行仍显示用户选择的模型。

* **Empty conversation / 空会话:** When no trajectory is loaded, the status says “No active conversation” / “无活跃会话”. It does not reuse a persisted model denominator or imply a measured zero-token conversation. Quota/account information can still be shown when available.
  未加载 trajectory 时显示“无活跃会话”，不沿用持久化模型分母，也不暗示已测得零 token 的对话；可用的配额/账号信息仍可显示。

## 📊 5. WebView Monitor Panel / WebView 监控面板

> Source: [`webview-panel.ts`](../src/webview-panel.ts)

自 v1.10.1 起，点击状态栏打开 WebView 侧边面板（替代之前的 QuickPick 弹窗），展示完整的用户状态仪表盘。

Since v1.10.1, clicking the status bar opens a WebView side panel (replacing the previous QuickPick popup) showing a full user status dashboard.

* **数据来源 / Data Source**: 所有数据来自已有的 `GetUserStatus` RPC 调用，通过 `fetchFullUserStatus()` 函数获取完整用户状态（`FullUserStatus`）。零额外网络请求。
  All data comes from the existing `GetUserStatus` RPC call via `fetchFullUserStatus()` which returns the full `FullUserStatus` object. Zero additional network requests.

* **Panel Content / 面板内容**: Displays account info (planName, userTier), credit balance (Prompt & Flow Credits), shared quota-pool cards (color-coded), feature flags, team config (MCP Servers, Auto-Run, etc.), and Google AI credits. Pool cards list their available families/efforts; effort-specific model information, usage statistics, and pricing remain separate.
  展示账户信息（planName、userTier）、Credits 余额（Prompt Credits、Flow Credits）、共享配额池卡片（带颜色指示）、Feature Flags、团队配置（MCP Servers、Auto-Run 等）、Google AI 额度。池卡片列出可用家族/档位；档位级模型信息、用量统计与价格仍独立。

* **隐私遮罩 / Privacy Mask**: 盾牌按钮遮罩姓名和邮箱，状态通过 `vscode.getState()` 跨面板刷新持久化。
  Shield button masks name and email; state persists across panel refreshes via `vscode.getState()`.

* **可折叠区域 / Collapsible Sections**: 次要数据（Plan Limits、Feature Flags、Team Config、Google AI Credits）默认折叠在 `<details>` 标签中，展开/收起状态持久化。
  Secondary data (Plan Limits, Feature Flags, Team Config, Google AI Credits) hidden by default in `<details>` elements; open/close state persists.

* **实时刷新 / Live Refresh**: 轮询循环中通过 `updateMonitorPanel()` 推送最新数据到已打开的面板，保持数据实时同步。仅当非运行中会话具有已知 `tokenUsageSource`，且 cascade ID、步骤数、修改时间和状态均相同时，才复用 `ContextUsage` 缓存。缺少来源字段的 1.16.19 之前缓存会重新读取；运行中 trajectory 始终刷新，因为流式回复可以在步骤数不变时原位更新。GM 持久化也仅在聚合结果变化时写入。
  The polling loop pushes latest data to the open panel via `updateMonitorPanel()`, keeping data in real-time sync. Polling reuses `ContextUsage` only for unchanged, non-running conversations with a known `tokenUsageSource` and matching cascade ID, step count, modification time, and status. Pre-1.16.19 caches without provenance are re-read; running trajectories are always refreshed because a streaming response can change in place without a step-count change. GM persistence also only writes when aggregated results change.

* **GM 恢复摘要回灌 / GM Restored Summary Hydration**: 启动时若文件持久化中存在 `gmDetailedSummary`，扩展会先修复 quota-history 污染，再通过 `gmTracker.setDetailedSummary()` 回灌到内存态 GMTracker，保证面板、时间线和后续 `serialize()` 读到同一份摘要。`GMTracker.fetchAll()` 仅在 `cached.calls.length > 0` 时才允许跳过未变化的 idle 会话；恢复态只剩空 `calls` 的 stub 会主动补拉一次，避免重启后 `上下文情报`、`对话分布`、`上下文增长`、`错误详情` 等区块因为空缓存而消失。
  When a file-backed `gmDetailedSummary` exists at startup, the extension first repairs quota-history contamination and then injects the repaired summary back into `GMTracker` via `gmTracker.setDetailedSummary()`, so the panel, timeline, and later `serialize()` calls all observe the same snapshot. `GMTracker.fetchAll()` now skips unchanged idle conversations only after `cached.calls.length > 0`; restored stubs with empty `calls` are force-refetched once, preventing Context Intelligence / Conversations / Context Growth / Error Details from disappearing after restart due to empty in-memory cache.

* **GM 细粒度变更判定 / Detailed GM Change Detection**: `hasGMSummaryChanged()` 不再只比较总调用数和总 token，而是构建轻量签名覆盖 `modelBreakdown`、`contextGrowth`、`toolCallCounts`、`retryErrorCodes`、`toolCatalog`、`recentErrorEntries`、每个 conversation 的 latest call / checkpoint / systemContext 等细节字段。这样即便总量不变，只要 GM 明细发生变化，轮询仍会刷新面板并写回持久化。
  `hasGMSummaryChanged()` no longer compares only total calls/tokens. It now builds a lightweight signature spanning `modelBreakdown`, `contextGrowth`, `toolCallCounts`, `retryErrorCodes`, `toolCatalog`, `recentErrorEntries`, and each conversation's latest call / checkpoint / systemContext details. This means detail-only GM updates still trigger panel refresh and persistence even when the topline counters remain unchanged.

* **滚动条隐藏 / Scrollbar Hiding (v1.14.5)**: 三层纵深防御隐藏 VS Code WebView 滚动条：① 静态 CSS `html[data-hide-scrollbar="true"]` + `!important`；② `<html>` 和 `<body>` 双重 `data-hide-scrollbar` 属性；③ 运行时 JS 动态注入 `<style id="ag-scrollbar-override">` 到 `<head>` 末尾。默认隐藏，可在设置中恢复。
  Three-layer defense-in-depth scrollbar hiding for VS Code WebView: ① Static CSS `html[data-hide-scrollbar="true"]` with `!important`; ② dual `data-hide-scrollbar` attribute on both `<html>` and `<body>`; ③ Runtime JS injection of `<style id="ag-scrollbar-override">` appended to `<head>` tail. Hidden by default, toggleable in Settings.

* **到底提示 / End-of-Content Sentinel (v1.14.5, v1.14.7)**: 所有标签页底部追加「— 已到底 —」指示器，`IntersectionObserver` 控制淡入动画。v1.14.7 修复轮询刷新时反复淡入问题：缓存各标签页 HTML，跳过未变化 pane 的 DOM 替换，保留已可见 sentinel 状态，并为 `<details>` 和会话筛选控件增加幂等监听保护。可在设置中独立关闭。
  Persistent "— End of content —" indicator at the bottom of all tab panes. `IntersectionObserver` controls fade-in animation. v1.14.7 fixes repeated fade-in on poll refresh: caches per-tab HTML, skips unchanged pane DOM swaps, preserves visible sentinel state, and adds idempotent listener guards for `<details>` blocks and session catalog filters. Independently toggleable in Settings.

* **增量刷新 / Incremental Tab Refresh (v1.14.7)**: `updateTabs` 消息通过 `postMessage` 推送各标签页内容，前端对比缓存 HTML 跳过未变化的 pane，避免不必要的 `innerHTML` 替换。Settings 标签页显式排除在增量更新之外，防止 DOM 替换销毁事件监听。
  The `updateTabs` message pushes tab content via `postMessage`; the frontend compares cached HTML and skips unchanged panes, avoiding unnecessary `innerHTML` replacements. The Settings tab is explicitly excluded from incremental updates to prevent DOM replacement from destroying event listeners.

* **Sessions GM 快照刷新 / Sessions GM Snapshot Refresh**: `monitor-store.ts` 持久化的 `GMConversationData` 快照现在比较 latest call 标识、最新模型、积分和时间，而不是只看 `calls.length`。这让 Sessions 标签页在“调用数没变，但最新 GM 模型/积分/执行记录已经变化”的情况下也能及时刷新。
  Persisted `GMConversationData` snapshots in `monitor-store.ts` now compare latest call identity, latest model, credits, and timestamp instead of only `calls.length`. This keeps the Sessions tab current even when the number of calls is unchanged but the newest GM model/credits/execution record has changed.

* **Tab 栏箭头导航 / Tab Arrow Navigation (v1.14.7)**: Tab 栏两端新增左右箭头滚动按钮，根据溢出状态智能显隐。使用 `opacity` + `pointer-events` 渐隐过渡保留占位空间，防止箭头消失时误触旁边的 Tab。
  Left/right scroll arrow buttons flank the tab bar, intelligently showing/hiding based on overflow state. Uses `opacity` + `pointer-events` fade transition to preserve layout space and prevent accidental tab clicks.

* **日历月度/全部切换 / Calendar Monthly/All-Time Toggle (v1.14.7)**: 日历汇总区新增分段切换按钮（月度 / 全部），用户可快速查看本月消耗明细和历史总计。默认显示月度，空月份显示友好提示。
  Calendar summary section now has segmented toggle buttons (Monthly / All-Time) for quick monthly vs all-time stats comparison. Default view is monthly; empty months show friendly guidance.

* **浅色主题适配 / Light Theme Compatibility (v1.14.5, v1.14.6)**: GM 标签文字色默认使用深饱和色系（`#2563eb`、`#16a34a` 等），通过 `body.vscode-dark` 选择器覆盖回暗色调色板。替换 `rgba(255,255,255,0.xx)` 为 `var(--color-surface)` / `var(--color-border)`。VS Code 主题检测从 `@media (prefers-color-scheme)` 改为 `body.vscode-dark`。v1.14.6 扩展浅色主题覆盖到全部面板组件（~50 个），在 `webview-styles.ts`、`activity-panel.ts`、`webview-calendar-tab.ts` 中添加了全面的 `body.vscode-light` CSS 覆盖，涵盖操作按钮、统计卡片、进度条轨道、聊天历史卡片（含渐变替换）、监控迷你面板、X-ray 可视化等。
  GM tag text colors now default to dark-saturated variants, with `body.vscode-dark` overrides restoring the original pastel palette. Replaced `rgba(255,255,255,0.xx)` with `var(--color-surface)` / `var(--color-border)`. VS Code theme detection changed from `@media (prefers-color-scheme)` to `body.vscode-dark`. v1.14.6 extends light theme coverage to all panel components (~50), adding comprehensive `body.vscode-light` CSS overrides in `webview-styles.ts`, `activity-panel.ts`, and `webview-calendar-tab.ts`, covering action buttons, stat cards, progress bar tracks, chat history cards (with gradient replacements), monitor mini panel, X-ray visualization, and more.

* **Cost Pricing Editor (v1.16.4) / Cost 价格编辑器**: `pricing-panel.ts` renders called models first and appends built-in default pricing models that are not already covered by a called `responseModel`. Empty placeholder `responseModel` values are ignored for coverage and are not rendered as editable `data-model=""` rows. `webview-script.ts` saves only rows that were already custom or whose values changed, so untouched built-in prices do not become custom overrides.
  `pricing-panel.ts` 先渲染已调用模型，再追加未被 `responseModel` 覆盖的内置默认价格模型。空的 placeholder `responseModel` 不参与覆盖判断，也不会渲染成可编辑的 `data-model=""` 行。`webview-script.ts` 保存时只提交已有自定义项或用户实际改动的行，未编辑的内置价格不会被写成自定义覆盖。

* **Tool Catalog Cleanup (v1.16.4) / 工具目录清理**: GM Data renders the tool catalog as a collapsible chip grid with truncation-aware tooltips. The WebView clear button sends an internal `clearToolCatalog` message to `extension.ts`; `GMTracker.clearToolCatalog()` clears only the catalog, not tool ranking counts. The extension persists the cleared summary to both `gmTrackerState` and the file-backed `gmDetailedSummary`, preventing stale catalog entries from returning after reload.
  GM Data 将工具目录渲染为可折叠 chip grid，并按文本截断情况动态生成 tooltip。WebView 清空按钮发送内部 `clearToolCatalog` 消息到 `extension.ts`；`GMTracker.clearToolCatalog()` 只清空目录，不影响工具排行计数。扩展会把清空后的摘要同时写入 `gmTrackerState` 和文件持久化的 `gmDetailedSummary`，避免重载后旧目录回填。

* **Narrow header layout (v1.16.19) / 窄宽度顶部布局:** The title/account area and action group wrap independently with bounded widths; language buttons and timestamps stay intact. This prevents the 320 px dashboard header controls from overlapping.
  标题/账号区域和操作组在限制宽度内分别换行，语言按钮与时间戳保持完整，避免 320 px 面板顶部控件重叠。

## 🧠 6. Model Activity Monitor / 模型活动监控

> Source: [`activity-tracker.ts`](../src/activity-tracker.ts), [`activity-panel.ts`](../src/activity-panel.ts), [`quota-tracker.ts`](../src/quota-tracker.ts)

自 v1.11.2 起，插件追踪每个模型的实时活动数据（推理调用、工具使用、Token 消耗、耗时），并在 WebView 面板的 Activity 标签页中展示。

Since v1.11.2, the plugin tracks real-time activity data per model (reasoning calls, tool usage, tokens, timing) and displays it in the WebView panel's Activity tab.

* **步骤分类 / Step Classification**: 20+ 步骤类型被分类为 reasoning、tool、user、system 四个类别。每个步骤提取详细信息（文件名、命令、搜索词等）用于时间线展示。
  20+ step types are classified into reasoning, tool, user, and system categories. Detailed info is extracted from each step (filename, command, query, etc.) for timeline display.

* **暖机与增量更新 / Warm-up & Incremental**: 首次启动时处理所有对话的全部步骤（warm-up）以获取完整周期统计。之后仅增量处理新步骤。当 LS API 无法返回更多步骤（~500 步窗口限制）时，通过 `stepCount` 差值归因到每个对话的主模型（`dominantModel`）。
  On first launch, processes all steps across all conversations (warm-up) for complete cycle stats. Subsequently only processes new steps incrementally. When the LS API can't return more steps (~500 step window), delta is attributed to each trajectory's dominant model (`dominantModel`).

* **配额追踪与自动归档 / Quota Tracking & Auto-Archive**: `QuotaTracker` 监测配额变化，通过两种机制检测重置：① `remainingFraction` 从低值跳回 1.0；② `resetTime` 到期或发生跳变（前移 > 30min）。`processUpdate()` 循环结束后将本批次所有重置模型 ID 收集到 `resetModels[]`，一次性触发 `onQuotaReset(resetModels)` 回调。`endTime` 使用 API 返回的官方 `resetTime`（而非本地检测时间）。`ActivityTracker.archiveAndReset(modelIds)` 归档时包含 5 分钟防抖逻辑（短间隔内合并）和 `triggeredBy` 来源追踪，保留 trajectory baselines 避免重复计数。自 v1.14.5 起，两个 idle→tracking 入口路径均添加**过期 resetTime 防护**：若 API 返回的 `resetTime` 已过期（`resetTime <= now`），模型保持 idle 直到 API 返回新周期的未来 `resetTime`，防止幽灵会话死循环。
  `QuotaTracker` monitors quota changes via two mechanisms: ① `remainingFraction` dropping then jumping back to 1.0; ② `resetTime` expiring or jumping forward (> 30min shift). `processUpdate()` collects all reset model IDs into `resetModels[]` after the loop, firing `onQuotaReset(resetModels)` once. Session `endTime` uses the official API `resetTime`. `ActivityTracker.archiveAndReset(modelIds)` includes 5-minute debounce (merge within short intervals) and `triggeredBy` source tracking, while preserving trajectory baselines. Since v1.14.5, both idle→tracking entry paths include a **stale-resetTime guard**: if the API-reported `resetTime` is already in the past (`resetTime <= now`), the model stays idle until the API provides a future `resetTime` for the new cycle, preventing ghost-session infinite loops.

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

* **持久化 / Persistence**: 活动数据通过 `globalState` 序列化存储，30 秒节流写入（自 v1.14.5 起仅在 `activityChanged`/`gmChanged`/`timelineChanged` 时触发）。恢复时强制 warm-up 重校准实际计数。
  Activity data persisted via `globalState` serialization, throttled to 30s writes (since v1.14.5, only triggered when `activityChanged`/`gmChanged`/`timelineChanged`). On restore, forces warm-up to recalibrate actual counts.

* **GM 数据持久化缓存 / GM Data Persistence Cache**: `ActivityTracker` 内部维护 `_gmTotals`（全局聚合 inputTokens/outputTokens/cacheRead/credits/retries）和 `_gmModelBreakdown`（按模型分组的 GM 详细数据），由 `injectGMData()` 写入，`getSummary()` 始终返回。自 v1.13.6 起，Activity 处理已合并至 `pollContextUsage()` 统一循环，复用已获取的 trajectory 缓存，消除独立 RPC 调用和 GM 数据闪烁。`serialize()`/`restore()` 完整持久化这些缓存。
  `ActivityTracker` maintains internal `_gmTotals` (global aggregate inputTokens/outputTokens/cacheRead/credits/retries) and `_gmModelBreakdown` (per-model GM breakdown), written by `injectGMData()` and always returned by `getSummary()`. Since v1.13.6, activity processing is merged into the unified `pollContextUsage()` loop, reusing fetched trajectory cache and eliminating independent RPC calls and GM data flickering. Both fields are fully persisted via `serialize()`/`restore()`.

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

* **模型平台阈值 / Model Platform Thresholds**: `models.ts` 中的 `DEFAULT_CONTEXT_LIMITS` 记录 Antigravity 平台截断阈值，而不是模型原生窗口。v1.16.8 将 Gemini 3.1 Pro 调整为 128K，Gemini 3 Flash M133/M132/M84/M47 调整为 128K，GPT-OSS 120B 调整为 80K，Claude Thinking 保持 160K。启动迁移会清除旧版保存下来的 1M、120K/160K/128K 过期默认 override，让新的内置默认值生效。v1.16.14 依据活体探测新增 Gemini 3.6 Flash 三档 M264/M265/M266（另含仅目录可见的 M196）静态兜底 255K（活体 checkpointer 256K/140K，−1K 偏移用于识别活体覆盖是否生效），并把 3.5 Flash M84/M20/M187 过期的 127K 校正为 255K；M133/M132/M47 平台侧已退役，仅保留用于归档数据解析。placeholder ID 的家族推导（`guessContextLimitSpec`）改为按 M 编号精确匹配，杜绝 M264 含 `m26` 子串被误判为 Claude 系的碰撞。v1.16.15 依据活体探测新增 Gemini 3.7 Flash 三档 M298/M299/M300（静态兜底同为 255K，活体 checkpointer 256K/140K），并处理平台对 3.6 Flash 的**改号**：M264/M265/M266 已被平台迁移到 M71/M72/M73，别名与反查一律指向活跃编号，旧编号降级为已退役 ID 仅用于解析归档数据。v1.16.17 对两个运行中的 Antigravity IDE language server 实例互证后新增 Gemini 3.8 Flash M318/M319/M320 与目录内 M322；三档静态兜底 255K、活体 256K/140K，IDE 报告的模型上下文 1,048,576、输出 65,536，思考预算为动态/4,000/1,000。M318 在当时成为状态栏默认配额池代表；中英文别名、计价与 2027 年历史回填边界共享同一身份归一化链路。1.16.19 对当前 3.8 picker 的 50K 触发阈值、思考力度和动态代表选择的更新见下一节。
  `DEFAULT_CONTEXT_LIMITS` stores Antigravity platform truncation thresholds, not model-native windows. v1.16.8 sets Gemini 3.1 Pro to 128K, Gemini 3 Flash M133/M132/M84/M47 to 128K, GPT-OSS 120B to 80K, while Claude Thinking remains 160K. Startup migration clears stale explicit default overrides from older releases so the corrected built-in defaults can take effect. v1.16.14 adds live-probed Gemini 3.6 Flash tiers M264/M265/M266 (plus catalog-only M196) with 255K static fallbacks (live checkpointer 256K/140K; the −1K offset marks fallback vs live capture), corrects the stale 127K fallbacks of 3.5 Flash M84/M20/M187 to 255K, and retires M133/M132/M47 platform-side (kept for archived-data resolution only). Placeholder-ID family inference (`guessContextLimitSpec`) now matches exact M-numbers, eliminating the substring collision where M264 (containing `m26`) was misjudged as a Claude-series model. v1.16.15 adds live-probed Gemini 3.7 Flash tiers M298/M299/M300 and absorbs the platform's 3.6 renumbering to M71/M72/M73. v1.16.17 cross-verifies two running Antigravity IDE language-server instances and adds Gemini 3.8 Flash M318/M319/M320 plus catalog-only M322: 255K static fallback, live 256K/140K checkpointer, 1,048,576 IDE-reported model context, 65,536 output, and dynamic/4,000/1,000 thinking budgets. M318 became the status-bar default pool representative at that time; English/Chinese aliases, pricing, and the 2027 historical backfill boundary share the same normalized identity path. The next section documents the 1.16.19 update to the current 3.8 picker's 50K trigger, thinking levels, and live representative selection.

* **上下文上限来源 / Context Limit Source**: 上下文上限采用本地语言服务器同步的实时参数；实时数据到达前使用注册值或家族推导值兜底。当前设置页提供低额度警告、轮询和显示偏好；旧版本的手动上下文上限覆盖和恢复按钮不属于当前界面。
  Context limits use live parameters synchronized from the local language server, with registered or inferred fallbacks before live data arrives. The current Settings tab configures quota warnings, polling, and display preferences; the former manual context-limit override and restore controls are no longer part of the interface.

---

## 🤖 7. Model Registry and Model Cards / 模型注册与模型信息卡片

### Orchestrator amendment (v1.16.21)

#### English

The live IDE registers `MODEL_PLACEHOLDER_M667` / `gemini-pro-orchestrator` as the selectable coordinator and `MODEL_PLACEHOLDER_M669` / `gemini-flash-worker-agy` as its catalog-only execution worker. Both report 1,048,576 context, 262,144 output, thinking level 3, and 256,000 / 50,000 compression parameters; startup uses 255,000. Minimum thinking budgets 128 / 32 are not fixed request budgets. `ModelSpec.executionModelId` captures the validated `plan-execute-config.executionModel` relationship. Complete metadata with no route clears it; partial/malformed metadata preserves the last verified route. UI describes the relationship without manufacturing an extra picker item or call.

The actual Orchestrator workflow reuses one execution ID for several planner calls. Timestamp matching intersects execution and step identity; embedded-call enrichment uses steps, preserving unique legacy fallbacks and rejecting ambiguous matches. The context reduction heuristic compares the measured model (`lastModelUsage.model`) as well as the displayed model so delegation is not mistaken for compression. Explicit Gemini quota keys group M667/M669 with the Gemini allowance while preserving independent call identities. Actual calls, not configured routes, drive counts and costs. Standalone rates remain unverified and customizable separately.

#### 中文

实时 IDE 的可选协调模型为 `MODEL_PLACEHOLDER_M667` / `gemini-pro-orchestrator`，目录中的隐藏执行模型为 `MODEL_PLACEHOLDER_M669` / `gemini-flash-worker-agy`。两者均报告上下文 1,048,576、最大输出 262,144、思考力度 3，以及 256,000 / 50,000 压缩参数；启动兜底为 255,000。最小思考预算 128 / 32 不是固定请求预算。`ModelSpec.executionModelId` 保存经验证的 `plan-execute-config.executionModel` 关系；完整元数据不再含关系时清除，部分/异常数据保留已验证关系。界面说明关系，不额外制造选择器档位或调用。

实测 Orchestrator 在多个 planner 调用中复用 execution ID，因此时间恢复同时匹配 execution 与步骤，嵌入调用补全按步骤关联，仅保留唯一旧数据兜底并拒绝歧义。上下文下降判断同时比较实测模型 `lastModelUsage.model` 与显示模型，避免委派误报压缩。M667/M669 使用明确的 Gemini 额度键，与 Gemini 共享额度，同时保留独立调用身份。计数和费用由实际调用决定，不由配置关系决定；独立费率尚未核实，支持分别自定义。

### Gemini 4 Hydrogen (v1.16.21)

#### English

The running IDE's `GetUserStatus` and `GetAvailableModels` metadata, checked 2026-11-13, identifies Hydrogen Low / Medium / High / Extra as `MODEL_PLACEHOLDER_M527` / `M526` / `M525` / `M528`. Catalog IDs are `gemini-4-hydrogen-{low,medium,high,xhigh}`. Extra is the menu label for backend XHigh; thinking levels are **1 / 2 / 3 / 100**, not 1 through 4. All four report model context 1,048,576, maximum output 262,144, compression limit 256,000, and checkpoint threshold 50,000. The pre-sync context fallback is 255,000; the minimum thinking budget 32 is not a fixed request budget.

`models.ts` preserves four identities across placeholders, catalog IDs, English/Chinese labels, Extra/XHigh aliases, GM responses, context tracking, and persisted history. Family-only responses cannot overwrite requested efforts or permanently bind the Hydrogen family to one tier. Malformed effort suffixes, concatenated names, and unmatched parentheses remain unresolved. Hydrogen's fourth effort does not make Extra valid for Carbon or Argon. `model-quota.ts` includes `xhigh` as an effort; `webview-profile-tab.ts` presents it as Extra / 超高. `tooltip-budget.ts` preserves current/recommended precedence, with Hydrogen ahead of Carbon and Argon within Gemini 4.

[Hydrogen Standard API pricing](https://aistudio.google.com/docs/pricing#gemini-4-hydrogen), checked 2026-11-13, is $1.50 input / $7.50 output including thinking / $0.075 implicit cache reads per million tokens for all four tiers. Hydrogen has an independent fixed reference rate and does not inherit Carbon/Argon's December cutover. If an account changes a known model's display label, `findPricing()` recovers its catalog identity after exact/custom display-name matching; the placeholder/catalog identity must agree, preventing stale or renumbered metadata from assigning an unrelated price. Explicit caching is unsupported. Custom family/tier overrides and saved archived costs retain precedence. These reference estimates are separate from Antigravity subscription charges.

The live account exposes 21 chat entries: 20 known effort variants plus Orchestrator `M667`. Hydrogen adds four efforts and Orchestrator adds one selectable entry to Gemini. M667 and M669 have explicit Gemini quota membership. Dynamic inference for other unregistered models still requires an effort-specific branded catalog ID and matching provider. Availability remains account-driven, including empty and partial catalogs. Final validation and platform scope are recorded in [1.16.21 release notes](releases/1.16.21.md#validation).

#### 中文

2026-11-13 核对运行中 IDE 的 `GetUserStatus` 与 `GetAvailableModels` 元数据：Hydrogen Low / Medium / High / Extra 对应 `MODEL_PLACEHOLDER_M527` / `M526` / `M525` / `M528`，catalog ID 为 `gemini-4-hydrogen-{low,medium,high,xhigh}`。Extra 是后端 XHigh 的菜单标签；思考力度为 **1 / 2 / 3 / 100**，不是 1 至 4。四档模型上下文均为 1,048,576、最大输出 262,144、压缩上限 256,000、检查点阈值 50,000。同步前上下文兜底为 255,000；最小思考预算 32 不等于固定请求预算。

`models.ts` 在 placeholder、catalog ID、中英文标签、Extra/XHigh 别名、GM 响应、上下文追踪和历史数据中保留四档身份。家族响应不能覆盖请求力度，也不能将 Hydrogen 家族永久绑定某一档。异常档位后缀、连写名称及未配对括号仍不能解析；Hydrogen 支持第四档不代表 Carbon 或 Argon 支持 Extra。`model-quota.ts` 增加 `xhigh` 力度，`webview-profile-tab.ts` 显示 Extra / 超高。`tooltip-budget.ts` 保留当前/推荐模型优先级，在 Gemini 4 内将 Hydrogen 排在 Carbon、Argon 前。

2026-11-13 核实的 [Hydrogen Standard API 价格](https://aistudio.google.com/docs/pricing#gemini-4-hydrogen) 对四档均为每百万 token 输入 $1.50 / 含思考输出 $7.50 / 隐式缓存读取 $0.075。Hydrogen 使用独立固定参考费率，不继承 Carbon/Argon 的 12 月调价。账号更改已知模型显示名时，`findPricing()` 在精确/自定义显示名匹配后恢复 catalog 身份；placeholder 与 catalog 身份须一致，避免陈旧或重新编号元数据错误套价；不支持显式缓存。自定义家族/档位覆盖及已有归档费用优先，参考估算与 Antigravity 订阅收费分开。

当前账号提供 21 个聊天条目：20 个已知力度档位及 Orchestrator `M667`。Hydrogen 为 Gemini 池新增四档，Orchestrator 新增一个可选条目；M667/M669 明确属于 Gemini 额度。其他未注册模型的动态推断仍须同时满足明确档位的家族 catalog ID 与匹配提供商。可用列表由账号实时目录决定，包括空目录和部分档位。最终验证结果及平台范围记录于 [1.16.21 发布说明](releases/1.16.21.md#验证)。

### Gemini 4 Carbon (v1.16.20)

#### English

The running IDE's `GetUserStatus` and `GetAvailableModels` responses were checked on 2026-11-11:

| Effort | Placeholder | Catalog ID | Thinking level |
| --- | --- | --- | --- |
| Low | `MODEL_PLACEHOLDER_M438` | `gemini-4-carbon-low` | 1 |
| Medium | `MODEL_PLACEHOLDER_M437` | `gemini-4-carbon-medium` | 2 |
| High | `MODEL_PLACEHOLDER_M427` | `gemini-4-carbon-high` | 3 |

All three report the Google Gemini provider, 1,048,576 model-context tokens, **262,144 maximum output tokens**, a 256,000 checkpointer compression limit, and a separate 50,000 checkpoint threshold. The static context fallback remains 255,000 until live synchronization. Thinking is enabled with the reported level; an omitted fixed budget must not be substituted with Argon's output limit or a made-up thinking budget.

`models.ts` registers exact placeholders, catalog aliases, English and Chinese effort names, static specs, context profiles, and Gemini quota membership. Bare `gemini-4-carbon` is a family, not an effort identity: GM alias learning must not bind it to whichever tier is observed first. Known requested tiers survive family-only responses and remain separate in persisted statistics. Carbon and Argon cannot alias one another. Concatenated `CarbonHigh`, unmatched parentheses, and invalid effort suffixes do not resolve as known variants or inherit a family price. Alias learning resolves uppercase/catalog and Chinese-label variants before accepting a new binding, so a conflicting sample cannot overwrite the registered tier. Live account catalogs continue to determine which cards are shown; an empty catalog must not resurrect registered models as available.

`tooltip-budget.ts` keeps current-model and live-recommendation precedence. Its same-generation family ordering puts Carbon before Argon without treating similarly prefixed unknown model names as verified Carbon models. [Carbon Standard API prices](https://aistudio.google.com/docs/pricing#gemini-4-carbon), verified 2026-11-11, are $2 input / $10 output including thinking / $0.10 implicit cache reads per million tokens through 2026-11-30, then $4 / $20 / $0.20 from 2026-12-01. `pricing-store.ts` uses each call's UTC date while preserving custom family/tier overrides and archival totals. Carbon and Argon use separate pricing identities despite equal published rates. Explicit caching is unsupported and no cache-write charge is added. Unknown-model prices remain unavailable rather than free. The [Google announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-carbon-now-available/) corroborates the input/output rates and cutover date.

#### 中文

2026-11-11 核对了运行中 IDE 的 `GetUserStatus` 和 `GetAvailableModels`：Low / Medium / High 分别对应上表的 `M438` / `M437` / `M427`、catalog ID 和 1 / 2 / 3 思考力度。

三档均报告 Google Gemini 提供商、1,048,576 token 模型上下文、**262,144 token 最大输出**、256,000 checkpointer 压缩上限及独立的 50,000 检查点阈值。实时同步前使用 255,000 静态上下文兜底。支持思考并采用返回的力度；缺失固定预算不能用 Argon 的输出上限或臆造的思考预算代替。

`models.ts` 注册精确 placeholder、catalog 别名、中英文档位名、静态 spec、上下文画像及 Gemini 配额池归属。裸 `gemini-4-carbon` 表示家族，不能证明档位：GM 别名学习不得将其绑定到最先观测到的一档。仅含家族名的响应保留已知请求档位，持久化统计也保持各档独立；Carbon 与 Argon 不互相映射。连写的 `CarbonHigh`、未配对括号及无效档位后缀不能解析为已知档位或继承家族价格。学习新绑定前先解析大写 catalog 和中文标签变体，避免冲突样本覆盖已注册档位。卡片继续以当前账号实时目录为准，空目录不能将静态注册模型恢复为可用。

`tooltip-budget.ts` 保留当前模型、实时推荐的优先级。同世代内 Carbon 排在 Argon 前，同时避免将相似前缀的未知模型误判为 Carbon。2026-11-11 核实的 [Carbon Standard API 价格](https://aistudio.google.com/docs/pricing#gemini-4-carbon) 截至 2026-11-30 为每百万 token 输入 $2 / 含思考输出 $10 / 隐式缓存读取 $0.10，自 2026-12-01 起为 $4 / $20 / $0.20。`pricing-store.ts` 按调用 UTC 日期计价，保留自定义家族/档位覆盖和归档总额。虽然公布费率相同，Carbon 与 Argon 计价身份仍独立。不支持显式缓存，不添加缓存写入费；未知模型价格继续显示暂无定价，而非免费。[Google 公告](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-carbon-now-available/) 交叉证实输入/输出费率及调价日期。

### Shared quota-pool presentation (v1.16.20) / 共享配额池展示

#### English

In the 1.16.20 validation snapshot, Model Quota grouped 16 chat tiers into two known shared pools: Gemini contained Carbon, Argon, and Flash (nine tiers); Claude / GPT contained Opus, Sonnet, and GPT-OSS (seven tiers). The 1.16.21 catalog adds Hydrogen and Orchestrator to Gemini as described above. The live status reports matching fraction/reset values within each pool. Each card retains a readable list of its available families and effort tiers. Unknown and image-generation identities remain separate instead of being inferred into either chat pool. Model Info specs, GM calls, persisted model statistics, token accounting, and pricing remain tier-specific.

Quota fractions are not summed or averaged across members. Inconsistent values use ranges with per-model details; missing quota/reset data stays explicitly unknown rather than becoming an invented combined allowance. Account-specific and empty catalogs keep their availability semantics. Native IDE checks verified the two pools, six family rows, and three Carbon information cards in English, Chinese, and bilingual modes, together with the About note (plugin 1.16.20 / IDE 2.6.0 / 2026-11-11).

#### 中文

在 1.16.20 验证快照中，模型配额将 16 个聊天档位合并为两个已知共享池：Gemini 包含 Carbon、Argon、Flash，共九档；Claude / GPT 包含 Opus、Sonnet、GPT-OSS，共七档。1.16.21 目录将 Hydrogen 与 Orchestrator 纳入 Gemini，详见上节。实时状态显示每个池内的 fraction/reset 值一致；每张卡片仍列出实际可用的家族与思考档位。未知模型和图片生成身份独立，不推断归入任何聊天池。模型信息 spec、GM 调用、历史模型统计、Token 记账和价格继续按档位保留。

成员配额比例不求和、不取平均。不一致值展示范围并提供逐模型明细；缺失配额/重置数据明确显示未知，不制造综合额度。不同账号和空目录仍按实际可用列表处理。原生 IDE 已在英文、中文、双语模式核实两池、六行家族、三张 Carbon 信息卡片，以及 About 说明（插件 1.16.20 / IDE 2.6.0 / 2026-11-11）。

### Gemini 4 Argon (v1.16.19)

#### English

A read-only probe of the running IDE on 2026-10-31 verified `GetUserStatus` picker entries and `GetAvailableModels` catalog metadata:

| Effort | Placeholder | Catalog ID | Thinking level |
| --- | --- | --- | --- |
| Low | `MODEL_PLACEHOLDER_M419` | `gemini-4-argon-low` | 1 |
| Medium | `MODEL_PLACEHOLDER_M418` | `gemini-4-argon-medium` | 2 |
| High | `MODEL_PLACEHOLDER_M417` | `gemini-4-argon-high` | 3 |

All three use `GOOGLE_GEMINI`, with 1,048,576 IDE-reported model-context tokens, 65,536 maximum output tokens, and thinking enabled. The live checkpointer limit is 256,000, its independent trigger threshold is 50,000, and the static context fallback is 255,000. The API reports a minimum thinking budget of 32 but no fixed `thinkingBudget` or adaptive-thinking flag; do not infer a fixed budget or copy Claude's adaptive behavior.

`models.ts` connects placeholders, catalog aliases, English/Chinese effort names, context profiles, and the shared `gemini` quota pool. A response containing only `gemini-4-argon` cannot replace a known requested effort tier. This identity contract is shared by tracking, GM parsing, persistence, custom pricing, and UI. `tooltip-budget.ts` prefers the current model, then a live recommended model, then the newest available generation; integer version 4 ranks above decimal 3.8 without a hardcoded Flash default.

The same current catalog also updates Gemini 3.8 Flash `M318` / `M319` / `M320` to a 50,000 checkpointer trigger and thinking levels 3 / 2 / 1 with no fixed budget. A complete record (valid model ID/provider and both token capacities) treats omitted protobuf thinking fields as their defaults, clearing obsolete budgets/flags. Partial or malformed records preserve known metadata; historical `M322` and older generations retain their prior profiles.

Argon uses the [official Google Standard API pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon), verified 2026-10-31. Per million tokens, input / output including thinking / implicit cache reads are $2 / $10 / $0.10 through 2026-11-30, then $4 / $20 / $0.20 from 2026-12-01. `pricing-store.ts` selects the schedule using the call's UTC timestamp; per-call aggregation, daily archival, ledger settlement, and historical backfill share the dated lookup. Existing archived totals and explicit custom family/tier overrides retain precedence. Argon does not support explicit caching and no cache-write fee is added. Generic unknown-model pricing remains unavailable rather than being borrowed from another model.

#### 中文

2026-10-31 对运行中的 IDE 进行了只读探测，核实 `GetUserStatus` 的 picker 与 `GetAvailableModels` 的目录元数据。上表列出 Low / Medium / High 的 `M419` / `M418` / `M417`、catalog ID 及 1 / 2 / 3 思考力度。

三档均使用 `GOOGLE_GEMINI`，IDE 报告的模型上下文 1,048,576 token、最大输出 65,536，支持思考。实时 checkpointer 上限为 256,000，独立触发阈值为 50,000，静态上下文兜底为 255,000。API 提供最小思考预算 32，但未返回固定 `thinkingBudget` 或自适应思考标志，不能推断固定预算或复制 Claude 的自适应行为。

`models.ts` 统一 placeholder、catalog 别名、中英文档位名、上下文画像和共享的 `gemini` 配额池。仅含 `gemini-4-argon` 的响应不能覆盖已知的请求档位；追踪、GM 解析、持久化、自定义价格和 UI 共用该身份约定。`tooltip-budget.ts` 依次优先当前模型、账号实时推荐模型、最新可用世代；整数版本 4 可正确排在小数版本 3.8 之前，不再硬编码 Flash 默认代表。

同一当前目录也将 Gemini 3.8 Flash `M318` / `M319` / `M320` 更新为 50,000 checkpointer 触发阈值、3 / 2 / 1 思考力度且无固定预算。完整记录（有效模型 ID/提供商及输入、输出容量）将缺省 protobuf 思考字段按默认值处理，清除过时预算/标志；不完整或非法记录保留已知元数据，历史 `M322` 和较旧世代保留原画像。

Argon 采用 2026-10-31 核实的 [Google Standard API 官方费率](https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon)：每百万 token 输入 / 含思考输出 / 隐式缓存读取，截至 2026-11-30 为 $2 / $10 / $0.10，自 2026-12-01 起为 $4 / $20 / $0.20。`pricing-store.ts` 按调用 UTC 时间戳选费率，逐调用聚合、每日归档、账本结算和历史回填共用按日期查价；已有归档总额与显式自定义家族/档位覆盖保留优先级。Argon 不支持显式缓存，不添加缓存写入费。通用未知模型仍显示暂无定价，不借用其他模型价格。

### Current catalog and image capability (v1.16.20) / 当前目录与图片能力

#### English

The 2026-11-11 metadata audit covers all 16 live chat variants: three Carbon, three Argon, three Flash 3.8, three Opus 5.5, three Sonnet 5.5, and GPT-OSS 120B Medium. The complete compact field table is in the [release notes](releases/1.16.20.md#current-catalog). Carbon reports 1,048,576 model-context / 262,144 output; Argon and Flash report 1,048,576 / 65,536; Claude reports 1,000,000 / 128,000; GPT-OSS reports 131,072 / 32,768, an 80,000 compression limit, 50,000 checkpoint threshold, and 8,192 thinking budget. These are IDE catalog values, not universal public API limits.

`imageGenerationModelIds` is the authority for image-generation capability. `supportsImages` only denotes image input and must not promote every multimodal chat model into an image generator. The current image entry is `MODEL_PLACEHOLDER_M21` / `gemini-3.1-flash-image`, Gemini 3.1 Flash Image (Nano Banana 2), with IDE model-context and output limits both 65,536. It has no chat checkpointer. `ModelSpec.isImageGeneration` distinguishes it, `setAvailableImageModelIds()` stores the live available subset, and `getAvailableImageModelSpecs()` feeds a separate image section. Empty live lists clear that section; a model's registered history does not imply current availability. Image quota uses a separate identity, not the shared chat Gemini pool, because no independent image allowance was returned.

Model metadata synchronization has a generation guard. Account/workspace changes, reconnects, and manual refresh invalidate live image availability and retry state; a response from an older generation cannot repopulate the current account's catalog. Complete image metadata with no checkpointer clears stale chat compression fields. The card renders compression/threshold as **Not applicable**, rather than zero or a guessed chat limit.

The UI now says **Model context** and states that limits are IDE-reported. The [public Gemini image API documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image) lists 131,072 input / 32,768 output, differing from this IDE's 65,536 / 65,536. Public API limits must not overwrite local product metadata. The public page lists thinking support, while this IDE omits the image thinking field; `thinkingCapabilityReported` preserves that distinction and the card says **Not reported by IDE**.

Image steps use `CORTEX_STEP_TYPE_GENERATE_IMAGE` and the `generateImage` payload, including model/name/path fields. Generation tracking preserves the surrounding chat model identity. `refreshWorkflowImageUsage()` follows only explicitly linked subagent cascades, deduplicates cycles, limits traversal to 16 children and depth 4, and bounds each child to 2,000 inspected steps. Missing children or reached limits mark coverage incomplete. Running children are refreshed, idle child results have a short cache, and account/backend changes invalidate that cache. Child text tokens never alter the parent context. The [official Standard image prices](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-image) are $0.50 input, $3 text/thinking output, and $60 image-output per million tokens; image-output equivalents are $0.045 / $0.067 / $0.101 / $0.151 for 512 px / 1K / 2K / 4K. The actual image workflow exposed one completed M21 generation step but no independent M21 token, credit, or GM usage. The Cost tab therefore warns that its known subtotals exclude image-generation fees and links the official reference; image generation is not reported as free. Parent Argon and child M322 text GM calls remain text usage, not a substitute for missing image metering.

#### 中文

2026-11-11 元数据核对覆盖实时聊天列表全部 16 档：Carbon、Argon、Flash 3.8、Opus 5.5、Sonnet 5.5 各三档，以及 GPT-OSS 120B Medium。完整精简字段表见[发布说明](releases/1.16.20.md#当前目录)。Carbon 模型上下文/输出为 1,048,576 / 262,144，Argon 与 Flash 为 1,048,576 / 65,536，Claude 为 1,000,000 / 128,000；GPT-OSS 为 131,072 / 32,768，压缩上限 80,000、检查点阈值 50,000、思考预算 8,192。这些是 IDE 目录值，不是所有公开 API 的统一上限。

`imageGenerationModelIds` 是图片生成能力依据，`supportsImages` 只表示图片输入，不能据此将所有多模态聊天模型归为图片生成模型。当前图片条目为 `MODEL_PLACEHOLDER_M21` / `gemini-3.1-flash-image`，即 Gemini 3.1 Flash Image（Nano Banana 2），IDE 模型上下文/输出均为 65,536，无聊天 checkpointer。`ModelSpec.isImageGeneration` 区分能力，`setAvailableImageModelIds()` 保存当前可用子集，`getAvailableImageModelSpecs()` 提供独立图片区域；实时空列表会清除该区域，历史注册不代表当前可用。图片配额使用独立身份，不归入共享聊天 Gemini 池，因为后端未返回独立图片额度。

模型元数据同步有代际守卫。账号/工作区切换、重新连接和手动刷新会使实时图片列表及重试状态失效；旧代响应不能重新填入当前账号目录。完整图片元数据不含 checkpointer 时会清除旧聊天压缩字段；卡片将压缩上限/阈值显示为**不适用**，不显示为零，也不套用猜测的聊天限额。

UI 现使用**模型上下文**并注明 IDE 来源。[公开 Gemini 图片 API 文档](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image) 为输入/输出 131,072 / 32,768，与该 IDE 的 65,536 / 65,536 不同；公开 API 限额不应覆盖本地产品元数据。公开文档列为支持思考，而本 IDE 缺少图片思考字段；`thinkingCapabilityReported` 保留这一区别，卡片显示 **IDE 未上报**。

图片步骤使用 `CORTEX_STEP_TYPE_GENERATE_IMAGE` 和 `generateImage` 数据，含模型、名称、路径等字段；生成追踪保留外围聊天模型身份。`refreshWorkflowImageUsage()` 仅遍历明确关联的子智能体 cascade，去重并处理循环，最多 16 个子节点、深度 4，每个子节点最多检查 2,000 步；子节点缺失或达到上限时标为覆盖不完整。运行中子节点重新拉取，空闲结果短时缓存，账号/后端变更使缓存失效。子智能体文本 token 不改变父上下文。[官方 Standard 图片费率](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-image) 为每百万 token 输入 $0.50、文本/思考输出 $3、图片输出 $60；512 px / 1K / 2K / 4K 图片输出等价价为 $0.045 / $0.067 / $0.101 / $0.151。实际图片工作流提供一个已完成的 M21 生成步骤，但没有 M21 独立 Token、积分或 GM 用量。因此成本页明确说明已知小计未计入图片生成费，并链接官方参考，不把生图标为免费。父 Argon 与子 M322 的文本 GM 调用仍是文本用量，不能代替缺失图片计量。

### Claude 5.5 (v1.16.18)

#### English

The v1.16.18 registry uses metadata read from the running Antigravity IDE on 2026-10-03. The probe reads local model configuration; it sends no model-generation requests.

| Model and effort | Placeholder ID | Catalog ID |
| --- | --- | --- |
| Claude Opus 5.5 Low | `MODEL_PLACEHOLDER_M400` | `claude-opus-5-5-low` |
| Claude Opus 5.5 Medium | `MODEL_PLACEHOLDER_M401` | `claude-opus-5-5-medium` |
| Claude Opus 5.5 High | `MODEL_PLACEHOLDER_M402` | `claude-opus-5-5-high` |
| Claude Sonnet 5.5 Low | `MODEL_PLACEHOLDER_M403` | `claude-sonnet-5-5-low` |
| Claude Sonnet 5.5 Medium | `MODEL_PLACEHOLDER_M404` | `claude-sonnet-5-5-medium` |
| Claude Sonnet 5.5 High | `MODEL_PLACEHOLDER_M405` | `claude-sonnet-5-5-high` |

All six entries report `ANTHROPIC_VERTEX`, a 1,000,000-token IDE-reported model context, and 128,000 maximum output tokens. Their live checkpointer limit is **256,000**; the separate `tokenThreshold` parameter is **50,000**. `DEFAULT_CONTEXT_LIMITS` retains the registry convention of a 255,000 static fallback so live synchronization can be distinguished from fallback data. `supportsAdaptiveThinking` is true and `thinkingLevel` is 1 / 2 / 3 for Low / Medium / High. The API omits a fixed `thinkingBudget`; this must not render as disabled thinking or a zero-token allowance.

Identity normalization links placeholders, catalog IDs, English labels, and Chinese effort labels. The six effort identities stay distinct even when a response reports only a family name such as `claude-opus-5-5`: a family name can identify pricing and the shared `premium` quota pool, but cannot establish which effort tier was requested. Claude 4.6 (`M26` / `M35`) remains registered for accounts that still expose it and for saved usage. Model cards and quota rows are scoped to the current account's live picker, with no plan-name or date-based access rules. This supports paid accounts exposing 5.5, unpaid accounts retaining 4.6, and Gemini-only accounts without adding unavailable models to the UI.

`webview-models-tab.ts` renders model information separately from historical GM data. Cards use semantic headings and description lists for the compression limit, IDE-reported model context, and thinking state. Provider names are readable, complete model IDs wrap, and all API-provided labels are escaped. `webview-styles.ts` uses IDE theme colors and border contrast for the model cards; the compression limit is a data row rather than a colored glow badge. The grid adapts to narrow panels. English, Chinese, and bilingual labels use `tBi`, and numbers follow the selected UI language rather than the host OS locale. Missing numeric metadata is displayed as unavailable.

Pricing resolves each family through the same identity normalization used by activity, quota, and archival paths. The official API rates per million tokens are: Claude Opus 5.5 — $4 input, $20 output, $0.20 cache read, $5 for 5-minute cache writes, and $8 for 1-hour cache writes; Claude Sonnet 5.5 — $2 input, $10 output, $0.20 cache read, $2.50 for 5-minute cache writes, and $4 for 1-hour cache writes. `ModelPricing.cacheWrite` stores the 5-minute reference rate. Current `costFromTokens()` and `calculateCosts()` estimates exclude cache creation fees because telemetry does not reliably identify creation tokens and their TTL; 1-hour write fees are not added automatically either. The existing formula includes input, response output, thinking output, and cache reads, without double-counting thinking tokens. Raw usage is retained, and custom rates remain available. API-equivalent estimates do not represent Antigravity subscription billing. Source: [official Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing), 2026-10-03.

#### 中文

v1.16.18 注册表依据 2026-10-03 对运行中 Antigravity IDE 的元数据探测。探测只读取本地模型配置，不发送模型生成请求。上表列出 Opus/Sonnet 六档模型的精确 placeholder 与 catalog ID。

六个条目均使用 `ANTHROPIC_VERTEX`，IDE 报告的模型上下文为 1,000,000 token，最大输出为 128,000 token。实时 checkpointer 上限为 **256,000**，独立的 `tokenThreshold` 参数为 **50,000**。`DEFAULT_CONTEXT_LIMITS` 沿用 255,000 静态兜底的注册表约定，以区分实时同步与兜底数据。`supportsAdaptiveThinking` 为 true，Low / Medium / High 的 `thinkingLevel` 分别为 1 / 2 / 3。API 未提供固定 `thinkingBudget`，不能将其显示为不支持思考或预算为零。

身份归一化连接 placeholder、catalog ID、英文名称与中文档位名称。即使响应只报告 `claude-opus-5-5` 这样的家族名，六个档位的身份仍保持独立：家族名可以确定计价家族及共享 `premium` 配额池，却不能证明请求采用了哪一档思考力度。Claude 4.6（`M26` / `M35`）继续注册，用于仍提供这些模型的账号和历史用量解析。模型卡片与额度行只展示当前账号的实时 picker，不按计划名或日期硬编码权限，兼容付费账号的 5.5、仍保留 4.6 的非付费账号及仅有 Gemini 的账号。

`webview-models-tab.ts` 将模型信息与历史 GM 数据分开渲染。卡片使用语义化标题和描述列表呈现压缩上限、IDE 报告的模型上下文及思考状态；提供商名称易读，完整模型 ID 可换行，API 标签经过转义。`webview-styles.ts` 使用 IDE 主题颜色和边框对比度；压缩上限改为数据行，移除彩色光晕徽标。网格可适应窄面板。中文、英文和双语标签使用 `tBi`，数字格式跟随所选界面语言，不依赖宿主操作系统地区设置。缺失数值信息显示为暂无数据。

计价、活动、配额和归档路径共用身份归一化。官方 API 单价按每百万 token 计算：Claude Opus 5.5 输入 $4、输出 $20、缓存读取 $0.20、5 分钟缓存写入 $5、1 小时缓存写入 $8；Claude Sonnet 5.5 输入 $2、输出 $10、缓存读取 $0.20、5 分钟缓存写入 $2.50、1 小时缓存写入 $4。`ModelPricing.cacheWrite` 保存 5 分钟参考费率。当前 `costFromTokens()` 和 `calculateCosts()` 的费用估算不计缓存创建费，因为遥测不能可靠区分创建 token 及其存活时间（TTL）；1 小时写入费用也不自动计入。既有公式包含输入、正文输出、思考输出和缓存读取，并避免重复计算思考 token。原始用量继续保留，用户也可配置自定义价格。API 等价估算不代表 Antigravity 订阅账单。来源：[Claude 官方定价](https://platform.claude.com/docs/en/about-claude/pricing)，2026-10-03。

## 🧪 8. Verification / 验证

**Current 1.16.21:** the functional release passed compilation and 899 tests in 50 files. The IDE CLI installed 1.16.21; 47 installed JavaScript files matched the build. Live checks covered 21 chat entries, one image entry, and eight real `OK` responses across four independent Hydrogen requests and a same-conversation Low → Extra → High → Medium sequence. Installed-code browser fixtures passed 36 display, 9 ordinary corner, 60 interaction, 21 header-boundary, and 24 quota-edge checks. Native three-language and light/dark UI checks passed on macOS. Native Windows/Linux IDE tests were not performed. Hosted build/test CI is now disabled at the maintainer's request; local checks remain available. Orchestrator adds nine real model calls and 24 route/pricing browser assertions (174 total); see [1.16.21 validation](releases/1.16.21.md#validation) for the complete current record. The 1.16.20 results below are historical evidence only.

**当前 1.16.21：** 功能版编译及 50 个文件中的 899 项测试通过。IDE CLI 已安装 1.16.21，47 个安装 JavaScript 文件与构建一致。实时核实 21 个聊天条目、一个图片条目及 Hydrogen 八次真实 `OK` 回复（四档独立请求及同会话 Low → Extra → High → Medium）。安装代码浏览器 fixtures 通过 36 项展示、9 项普通边界、60 项交互、21 项顶部边界及 24 项配额异常检查。macOS 原生三语言及浅/深色 UI 检查通过，未执行 Windows/Linux 原生 IDE 测试；托管编译/测试 CI 现按维护者要求停用，本地检查保留。Orchestrator 另有九次真实模型调用及 24 项委派/价格浏览器断言（总计 174 项）；完整本次记录见 [1.16.21 验证](releases/1.16.21.md#验证)。下文 1.16.20 结果仅作为历史证据保留。

The release includes Vitest 4.1.12 and Node.js engines `^22.23.4 || ^24.22.1 || >=26.12.1`. Use these runtime constraints and the committed lockfile for local verification: `npm ci`, `npm run compile`, and `npm test`. On 2026-11-13 the maintainer requested cancellation of hosted CI: the GitHub build/test workflow is disabled and `verify.yml` is removed. Historical runs remain historical evidence, not passing checks for the current commit.

The current regression scope includes legacy and hub discovery, argument/port parsing, candidate fallback, cancellation, the 21-entry live chat catalog, Hydrogen four-tier/Extra-XHigh identity, renamed-account pricing, Orchestrator Gemini pool membership, image capability and metadata lifecycle, live-model precedence, account-specific catalogs, separate image quota identity, Carbon/Argon family and tier isolation, GM identity preservation, Argon UTC price cutovers and archival/custom precedence, Carbon and generic unknown prices, image steps, persisted history, and English/Chinese/bilingual rendering. Cross-platform mocks exercise branches locally and must be distinguished from execution on each native operating system.

**Historical 1.16.20 acceptance:** the newly packaged **1.16.20** VSIX was installed and reloaded in the already running IDE. Local compilation and **753 tests in 46 files** passed; all **47 installed JavaScript files** matched the compiled output. Live checks verified **16 chat entries and one image entry**. Installed-code browser fixtures passed **36/36** display, **9/9** ordinary corner, **54/54** interaction, **21/21** header-boundary, and **18/18** quota-edge cases, with no accessibility violations. Quota-edge checks exercise differing, partial, and invalid data and expanded per-model details. Native macOS checks verified six Carbon requests including a Low → Medium → High sequence, two shared pools/six family rows/three Carbon cards in all three languages, About metadata, and light/dark rendering. Chinese, Light Modern, and Carbon Medium were restored afterward.

All three jobs in [CI run 42900949800](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/actions/runs/42900949800) have no executed steps: a hosted-runner account lock prevented execution. That 1.16.20 release therefore had no native hosted Windows/macOS/Linux CI result, and native Windows/Linux IDE behavior was not tested. Windows, macOS, and Linux remain supported; local tests exercise their mocked platform branches without being presented as native execution. Exact results and package evidence are in [1.16.20 release notes](releases/1.16.20.md#validation); older evidence remains in the [1.16.19](releases/1.16.19.md#validation) and [1.16.18](releases/1.16.18.md#validation) records.

本版本包含 Vitest 4.1.12、Node.js engines `^22.23.4 || ^24.22.1 || >=26.12.1`。按运行时约束和已提交锁文件在本地执行 `npm ci`、`npm run compile`、`npm test`。2026-11-13 按维护者要求停用 GitHub 自动编译/测试工作流并移除 `verify.yml`。历史运行记录不等于当前提交通过托管检查。

当前回归范围包含旧版/hub 发现、参数与端口解析、候选回退、取消、21 条目实时聊天目录、Hydrogen 四档及 Extra-XHigh 身份、账号改名计价、Orchestrator Gemini 池归属、图片能力及元数据生命周期、实时模型优先级、账号目录、独立图片配额身份、Carbon/Argon 家族与档位隔离、GM 身份保持、Argon UTC 调价边界与归档/自定义优先级、Carbon 及通用未知价格、图片步骤、历史持久化，以及英文/中文/双语渲染。跨平台 mock 在本地覆盖分支，需要与各原生操作系统上的实际运行分别报告。

**1.16.20 历史验收：** 使用重新打包并安装重载于现有 IDE 的 **1.16.20** VSIX。本地编译及 **46 个文件中的 753 项测试**通过，**47 个已安装 JavaScript 文件**均与编译输出一致。实时检查核实 **16 个聊天条目及一个图片条目**。安装代码的浏览器 fixtures 通过 **36/36** 展示、**9/9** 普通边界、**54/54** 交互、**21/21** 顶部边界和 **18/18** 配额异常用例，无无障碍违规；配额异常检查覆盖差异、部分缺失、无效数据及展开逐模型明细。macOS 原生检查核实六次 Carbon 请求（含 Low → Medium → High 序列）、三语言下两池/六行家族/三张 Carbon 卡片、About 信息及浅/深色展示；随后恢复中文、Light Modern 和 Carbon Medium。

[CI 运行 42900949800](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/actions/runs/42900949800) 的三个任务均无已执行步骤：托管运行器账号锁定阻止了启动。因此当时的 1.16.20 没有 Windows/macOS/Linux 托管原生 CI 结果，也未进行 Windows/Linux 原生 IDE 实测。插件继续支持 Windows、macOS、Linux；本地测试覆盖其平台 mock 分支，但不能视为原生执行。具体结果和包证据见 [1.16.20 发布说明](releases/1.16.20.md#验证)；旧证据保留在 [1.16.19](releases/1.16.19.md#验证) 和 [1.16.18](releases/1.16.18.md#validation) 历史记录中。

### Recorded-call pricing reconciliation (1.16.19)

The polling loop offers hydrated GM observations to `DailyLedger.reconcileRecordedCalls` even when the new-call cursor returns no entries. Exact identity, account, model, token and date checks permit missing timestamps and zero-cost gaps to be filled only when recorded calls reconcile with their model and account totals. Positive recorded costs, tokens and call counts remain unchanged; the pass is idempotent and persists only real repairs.

即使新增调用游标为空，轮询仍向 `DailyLedger.reconcileRecordedCalls` 提供已补全的 GM 观察。严格匹配调用身份、账号、模型、Token 和日期，并确认逐调用记录与模型/账号汇总一致后，才补充缺失时间戳或零费用缺口。已有正费用、Token 和调用数保持不变；该过程幂等，只持久化实际修复。

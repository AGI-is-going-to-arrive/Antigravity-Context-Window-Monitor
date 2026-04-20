# 📁 项目结构 / Project Structure

本文档说明 Antigravity Context Window Monitor 的源码组织方式、模块职责以及依赖关系。

This document describes the source code organization, module responsibilities, and dependency relationships of the Antigravity Context Window Monitor.

---

## 目录总览 / Directory Overview

```text
antigravity-context-monitor/
├── src/                          # TypeScript 源码
│   ├── extension.ts              # 扩展入口：激活/停用、轮询调度、命令注册、状态恢复
│   ├── discovery.ts              # Language Server 进程发现（跨平台）
│   ├── rpc-client.ts             # Connect-RPC 通用调用器
│   ├── tracker.ts                # Token 计算、会话数据获取、用户状态查询
│   ├── models.ts                 # 模型配置、上下文限额、显示名称、跨语言归一化
│   ├── constants.ts              # 全局常量（Step 类型、阈值、限制值）
│   ├── statusbar.ts              # 状态栏 UI（StatusBarManager，含计划层级 hover 缓存）
│   ├── durable-state.ts          # 扩展外部持久化：JSON 文件 + VS Code state 镜像
│   ├── monitor-store.ts          # 监控页持久化：按对话保存 ContextUsage + GM 会话快照
│   ├── pool-utils.ts             # 配额池工具：按稳定 pool key 分组 / 扩池 / 查找最近 quota session
│   ├── quota-tracker.ts          # 模型额度消费时间线追踪（per-model knownWindowMs + 稳定池代表）
│   ├── reset-time.ts             # 重置时间格式化工具（倒计时 + 绝对日期时间）
│   ├── activity-tracker.ts       # 活动追踪 re-export shim（向后兼容，实际代码在 activity/）
│   ├── activity/                 # Activity 模块（从 activity-tracker.ts 拆分）
│   │   ├── index.ts              #   barrel re-export
│   │   ├── types.ts              #   所有 Activity 类型定义
│   │   ├── helpers.ts            #   工具函数（分类/提取/合并/预览构建/持久化瘦身）
│   │   └── tracker.ts            #   ActivityTracker 类核心
│   ├── gm-tracker.ts             # GM 数据层 re-export shim（向后兼容，实际代码在 gm/）
│   ├── gm/                       # GM 模块（从 gm-tracker.ts 拆分）
│   │   ├── index.ts              #   barrel re-export
│   │   ├── types.ts              #   所有 GM 类型定义 + clone 工具 + 持久化 slim 函数
│   │   ├── parser.ts             #   解析器 + 提取器 + 匹配/合并/增强 + 检查点摘要提取
│   │   ├── summary.ts            #   汇总构建 + 过滤 + 标准化
│   │   └── tracker.ts            #   GMTracker 类核心（fetch/reset/serialize）
│   ├── pricing-store.ts          # 定价数据层：默认价格表 + 用户自定义持久化 + 费用计算
│   ├── model-dna-store.ts        # 模型信息持久化：跨周期保留静态模型 DNA
│   ├── daily-store.ts            # 日历数据层：按日聚合 Activity / GM / Cost
│   ├── webview-panel.ts          # WebView 面板框架（9 标签切换 + 消息通信）
│   ├── webview-styles.ts         # WebView 面板 CSS 样式（Design Token 体系）
│   ├── webview-script.ts         # WebView 客户端 JS（标签切换、设置交互、开发按钮等）
│   ├── webview-helpers.ts        # WebView 共享工具函数（转义、格式化等）
│   ├── webview-icons.ts          # WebView 内联 SVG 图标
│   ├── webview-monitor-tab.ts    # Monitor 标签页 HTML（支持 GM 快照回退）
│   ├── webview-models-tab.ts     # Models 标签页 HTML（默认模型 + 模型配额 + 模型信息）
│   ├── webview-settings-tab.ts   # Settings 标签页 HTML（含持久化存储概览 + 费用统计 + 界面提示偏好）
│   ├── webview-profile-tab.ts    # Profile 标签页 HTML（账户 / 计划限制 / 功能与团队）
│   ├── webview-history-tab.ts    # Quota Tracking 标签页 HTML
│   ├── webview-chat-history-tab.ts # Sessions 标签页 HTML（会话目录 — 全量对话列表 + 筛选）
│   ├── activity-panel.ts         # GM Data 统一标签页 HTML（Activity + GM 数据 + 检查点查看器）
│   ├── pricing-panel.ts          # Cost 标签页 HTML（费用分析 + 模型信息卡片构建器）
│   ├── webview-calendar-tab.ts   # Calendar 标签页 HTML
│   ├── i18n.ts                   # 国际化：语言模式、翻译表、偏好持久化
│   └── images/                   # README 截图资源
├── __mocks__/
│   └── vscode.ts                 # VS Code API mock（Vitest 用）
├── tests/                        # Vitest 测试目录（开发用，不参与插件运行时）
│   ├── discovery.test.ts         # discovery 单元测试
│   ├── durable-state.test.ts     # durable-state 单元测试
│   ├── activity-tracker.test.ts  # activity-tracker 单元测试（跨语言归一化、planner step 修复）
│   ├── gm-tracker.test.ts        # gm-tracker 单元测试（含跨语言恢复回归）
│   ├── model-dna-store.test.ts   # model-dna-store 单元测试（模型信息持久化）
│   ├── monitor-store.test.ts     # monitor-store 单元测试
│   ├── pool-utils.test.ts        # pool-utils 单元测试
│   ├── quota-tracker.test.ts     # quota-tracker 单元测试（含 0% 回弹恢复）
│   ├── reset-time.test.ts        # reset-time 单元测试
│   ├── daily-store.test.ts       # daily-store 单元测试（日历导入回填）
│   ├── statusbar.test.ts         # statusbar 单元测试
│   └── tracker.test.ts           # tracker 单元测试
├── docs/
│   ├── technical_implementation.md   # 技术实现指南
│   └── project_structure.md          # 本文件
├── out/                          # tsc 编译输出（已从 git 索引移除，.gitignore 忽略）
├── package.json                  # 扩展清单、命令、配置项
├── package-lock.json             # 依赖锁定文件
├── tsconfig.json                 # TypeScript 编译配置
├── vitest.config.ts              # 测试框架配置
├── README.md                     # 英文文档
├── readme_CN.md                  # 中文文档
├── CHANGELOG.md                  # 变更日志（v1.0.0 – v1.15.1 历史版本）
├── CHANGELOG-v2.md               # 变更日志 v2（v1.15.2+ 增量更新）
└── LICENSE                       # 许可证
```

---

## 模块详解 / Module Details

### 🔌 extension.ts — 入口 + 轮询调度

扩展的生命周期管理中心。

Extension lifecycle management hub.

| 职责 / Responsibility | 说明 / Description |
|---|---|
| `activate()` / `deactivate()` | 初始化所有子系统、注册命令、恢复 / 持久化关键状态 |
| 全局轮询 / Global poll | `pollContextUsage()` 以可配置间隔执行（默认 5s） |
| Activity 统一轮询 / Unified activity poll | Activity 数据处理已合并至 `pollContextUsage()` 主循环，复用已获取的 trajectory 缓存，消除重复 RPC 调用 |
| 会话选择 / Session selection | 按 RUNNING → 当前 tracked cascade 的 stepCount 变化 → 新会话 → 最近修改 的优先级选当前对话，已建立的当前会话会尽量保持稳定不被其他对话抢占 |
| 额度池归档 / Pool archival | 使用 `groupModelIdsByResetPool()` 将一次 reset 回调拆成多个共享额度池，逐池归档 Activity + GM + Pricing + Calendar |
| 持久化协调 / Persistence orchestration | 协调 `durable-state.ts`、`monitor-store.ts`、`activity-tracker.ts`、`gm-tracker.ts`、`daily-store.ts`、`model-dna-store.ts` 的恢复与写回 |
| 多账号快照 / Multi-account snapshots | `updateAccountSnapshot()` 在每次 `fetchFullUserStatus` 后提取 email + resetPools，按 email 维护 `AccountSnapshot` Map 并持久化至文件；`checkCachedAccountResets()` 在轮询中检查缓存账号额度重置并弹出一次性通知 |
| 跨账号隔离 / Cross-account isolation | `handleAccountSwitchIfNeeded()` 在每次状态拉取前检测账号切换，重置 `quotaTracker` 追踪状态防止旧 resetTime 触发误归档；`onQuotaReset` 零用量卫兵验证当前账号 GM 调用数 + Activity 步数均为零时跳过归档；`filterGMSummaryByModels()` 按 `currentAccountEmail` 过滤归档数据 |
| 开发命令 / Dev commands | `devSimulateReset`、`devClearGM`、`devPersistActivity` |

---

### 🔍 discovery.ts — 语言服务器发现

跨平台定位 Antigravity Language Server 进程。

Cross-platform Antigravity Language Server process locator.

| 平台 / Platform | 进程发现 / Process Discovery | 端口发现 / Port Discovery |
|---|---|---|
| macOS | `ps -ax` | `lsof` |
| Linux | `ps -ax` | `lsof` → `ss` fallback |
| Windows | `wmic` → `Get-CimInstance` fallback | `netstat -ano` |
| WSL | Windows 端工具（interop） | `netstat.exe`（interop） |
| Remote-WSL (v1.13.0) | `wsl -d <distro> -- ps aux` | `wsl -d <distro> -- ss -tlnp` |

核心解析函数 `buildExpectedWorkspaceId()`、`extractPid()`、`extractCsrfToken()`、`selectMatchingProcessLine()` 等均作为独立导出函数，支持直接单元测试。`selectMatchingProcessLine()`（v1.15.0）采用**优先新架构、回退到匹配**策略：(1) 无 `--workspace_id` 的进程（Antigravity 1.22.2+ 共享 LS）优先；(2) 回退到精确 `workspace_id` 匹配（旧架构兼容）；(3) 兜底到第一个发现的进程。轮询循环包含定期 PID 重校验（~30s）和带 `stalenessConfirmedIdle` 守卫的僵尸检测启发式。

Core parsing functions `buildExpectedWorkspaceId()`, `extractPid()`, `extractCsrfToken()`, `selectMatchingProcessLine()`, etc. are exported independently for direct unit testing. `selectMatchingProcessLine()` (v1.15.0) uses a **prefer-new-style, fallback-to-match** strategy: (1) processes WITHOUT `--workspace_id` (Antigravity 1.22.2+ shared LS) are preferred; (2) falls back to exact `workspace_id` match (legacy compatibility); (3) last resort: first discovered process. The polling loop includes periodic PID revalidation (~30s) and a staleness heuristic with `stalenessConfirmedIdle` guard.

---

### 📡 rpc-client.ts — RPC 通信

通用 Connect-RPC 调用器，处理 HTTPS/HTTP 传输、CSRF 鉴权、AbortSignal 取消、50 MB 响应体限制。

Generic Connect-RPC caller handling HTTPS/HTTP transport, CSRF authentication, AbortSignal cancellation, and 50 MB response body limit.

---

### 📊 tracker.ts — Token 计算 + 数据获取

核心数据处理模块：对话列表获取、Token 计算、上下文用量组装。

Core data processing module: trajectory listing, token computation, context usage assembly.

| 函数 / Function | 说明 / Description |
|---|---|
| `getAllTrajectories()` | RPC 获取所有对话轨迹，按修改时间降序 |
| `getTrajectoryTokenUsage()` | 分批获取步骤（50 步/批，5 并发组）+ 调用 `processSteps()` |
| `processSteps()` | 纯函数：步骤数组 → Token 统计（checkpoint 精确值 + 文本估算增量） |
| `getContextUsage()` | 组装 `ContextUsage` 对象供 UI 层使用 |
| `fetchFullUserStatus()` | 获取完整用户状态（模型配置、计划信息、Feature Flags） |

---

### 🤖 models.ts — 模型配置与归一化

模型上下文限额、显示名称（i18n 感知）以及 `ModelConfig`、`UserStatusInfo` 等核心接口定义。v1.13.8 新增 `normalizeModelDisplayName()`（EN/ZH/双语显示名归一到当前语言唯一显示名）和 `resolveModelId()`（任意显示名 → 内部 modelId），为 Activity / GM / Quota 跨模块归一化提供统一锚点；后续又补了 `getQuotaPoolKey()`，显式固定已知模型的共享额度池，避免再靠 `resetTime` 猜池。

Model context limits, display names (i18n-aware), and core interfaces. v1.13.8 adds `normalizeModelDisplayName()` (unifies EN/ZH/bilingual names to one canonical current-language name) and `resolveModelId()` (any display name → internal modelId), serving as the unified normalization anchor across Activity / GM / Quota modules; later `getQuotaPoolKey()` explicitly pins known shared-quota pools so the extension no longer guesses pools purely from `resetTime`.

---

### 📈 statusbar.ts — 状态栏 UI

| 类 / Class | 说明 / Description |
|---|---|
| `StatusBarManager` | 状态栏项：上下文用量、颜色编码、额度指示、重置倒计时、计划层级 hover 缓存 |

---

### 🗃️ durable-state.ts — 扩展外部持久化

在 VS Code `globalState/workspaceState` 之外维护额外的 JSON 文件持久化层。

Maintains an extra JSON-file persistence layer outside VS Code `globalState/workspaceState`.

| 特性 / Feature | 说明 / Description |
|---|---|
| 外部文件 / External file | Windows 默认路径 `%APPDATA%\\Antigravity Context Monitor\\state-v1.json` |
| 双层镜像 / Mirrored storage | 读取优先外部文件；缺失时回退到 VS Code state 并迁移回文件 |
| `globalBucket()` / `workspaceBucket()` | 封装全局级 / 工作区级键值存储 |
| 异步防抖写入 / Async debounced writes | 自 v1.14.5 起，`_set()` 返回 `Promise`，通过 250ms 防抖 + 版本号 + waiter 机制批量落盘，内容未变直接跳过（Since v1.14.5, writes are async-debounced at 250ms with version tracking and content-change detection, significantly reducing disk I/O） |
| 重装恢复 / Reinstall recovery | 关键数据在卸载 / 重装后仍可恢复 |

---

### 💾 monitor-store.ts — Monitor 快照存储

按对话保存 `ContextUsage` 与 `GMConversationData`，为 Monitor 标签页提供独立、稳定的数据源。

Persists `ContextUsage` and `GMConversationData` per conversation for the Monitor tab.

| 特性 / Feature | 说明 / Description |
|---|---|
| `record()` | 保存最近会话的 `ContextUsage`，自 v1.14.5 起通过 `sameUsageSnapshot()` 深比较跳过未变化快照（Since v1.14.5, skips unchanged snapshots via deep comparison） |
| `recordGMConversations()` | 保存每个对话的 GM 细节快照（含 calls），写盘前通过 `slimConversationForPersistence()` 剥离文本字段，自 v1.14.5 起通过 `sameGMConversationSnapshot()` 去重 |
| `getSnapshot(cascadeId)` | 自 v1.14.5 新增，按 cascadeId 获取单个缓存快照用于轮询复用（Since v1.14.5, retrieves single cached snapshot for poll reuse） |
| `restore()` | 恢复当前会话、会话列表和 GM 会话快照 |
| 独立于额度归档 / Independent from quota archives | 不因 quota reset 归档而清空 Monitor 数据 |
| 容量控制 / Trim | 最多保留 200 个对话快照，按 `lastModifiedTime` 裁剪 |

---

### 🧩 pool-utils.ts — 配额池工具

围绕 `models.ts` 中的稳定 pool key 提供共享配额池的辅助操作；未知未来模型才回退到 `resetTime` / `modelId`。

Helpers for shared quota-pool operations based on stable pool keys from `models.ts`; unknown future models fall back to `resetTime` / `modelId`.

| 函数 / Function | 说明 / Description |
|---|---|
| `expandModelIdsToPool()` | 将代表模型扩展为完整共享池成员 |
| `groupModelIdsByResetPool()` | 将一次回调中的重置模型拆分为多个独立池 |
| `findLatestQuotaSessionForPool()` | 匹配最近 quota session，提供归档时间边界 |

---

### ⚡ quota-tracker.ts — 额度消费追踪

状态机追踪每个模型的额度消费过程（`idle→tracking→(archive)→idle`），并按稳定 pool key 去重同池模型。v1.13.7 移除 `done` 状态，引入 `cycleResetTime` 和 `isCycleEnded()`。v1.13.8 移除全局 `maxTimeToResetMs` 跨模型推算，改为 per-model `knownWindowMs`（每个模型只信任自己学到的完整窗口长度），新增 `getUsableKnownWindowMs()` 安全校验函数，并修复 0% 额度锁死 bug（`completed` 标记可逆）。后续补丁又加入“已在 tracking 的池代表优先保留”和脏 active session 自愈，避免跨轮询代表切换导致归档卡死。

State machine tracking per-model quota consumption (`idle→tracking→(archive)→idle`) with stable pool-key deduplication. v1.13.7 removes `done` state, adds `cycleResetTime` and `isCycleEnded()`. v1.13.8 replaces global `maxTimeToResetMs` cross-model inference with per-model `knownWindowMs`, adds `getUsableKnownWindowMs()` safety check, and fixes the 0% lock-dead bug (completed marker is now reversible). Later patches also preserve the active pool representative across polls and self-heal dirty active sessions.

---

### 🧠 activity-tracker.ts — 模型活动追踪

追踪模型活动细节：推理次数、工具调用、Token 消耗、耗时统计，以及池级归档。

Tracks model activity details: reasoning count, tool usage, token consumption, timing stats, and pool-scoped archival.

| 特性 / Feature | 说明 / Description |
|---|---|
| 步骤分类 / Step classification | 22 种步骤类型 → reasoning / tool / user / system |
| 统一轮询 / Unified poll | Activity 处理已合并至 `pollContextUsage()` 主循环（v1.13.6），复用 trajectory 缓存，消除独立 RPC 调用 |
| GM 注入 / GM injection | 将 GM 精确 token / cache / credits 注入 Timeline |
| 当前对话过滤 / Current-session timeline | GM Data 标签页默认只渲染当前 `cascadeId` 的最近操作，底层仍保留全量 `_recentSteps` 用于归档和恢复 |
| 用户锚点 / GM user anchors | 从 `messagePrompts` 中提取 `<USER_REQUEST>` 恢复为 `gm_user` 事件，作为窗口外用户消息锚点 |
| 模型透明度 / Model transparency | 区分 `gm_exact` / `gm_placeholder` / `summary` / `generator` / `dominant` 等来源，避免将估算模型冒充为真实逐调用模型 |
| GM 窗口突破 / GM window bypass | `_gmSubAgentTokens`（运行时 Map）从无窗口限制的 GM 数据提取步骤窗口外的子智能体调用，在 `getSummary()` 中与 CP 数据合并 |
| GM 步数修正 / GM steps fix | 用 `GMConversationData.totalSteps` 修正 `_conversationBreakdown.steps`（不受 ~500 步窗口限制） |
| GM 增长历史 / GM growth history | 用 `contextGrowth` 补充 `_checkpointHistory` 中窗口外的上下文增长数据（含压缩检测，一次性注入） |
| 窗口外归属账本 / Outside-window attribution | `_windowOutsideAttribution` 按对话记录超出 Steps API 窗口的步数归属，GM 到来后可按真实模型重结算，并在 rewind / pool reset 时清理 |
| 子智能体归属 / Sub-agent attribution | `SubAgentTokenEntry.cascadeIds` 追踪消耗来源对话，`_processStep()` 透传 `cascadeId` |
| 池级归档 / Per-pool archive | 只清空匹配 pool 的模型统计、Timeline、GM breakdown、sub-agent 归属（含 `_gmSubAgentTokens`） |
| 口径清理 / Metric cleanup | 工具排行从剩余 `modelStats.toolBreakdown` 重算，避免跨池残留 |
| 序列化 / Serialization | `serialize()` / `restore()` 支持跨会话恢复与迁移检测，`_conversationBreakdown` key 通过 trajectory baselines 重建 |
| 持久化瘦身 / Slim-on-write | `serialize()` 通过 `slimStepEventForPersistence()` 剥离 `fullUserInput` / `fullAiResponse` / `gmPromptSnippet` / `browserSub` 文本字段，截断长 preview，仅保留结构化统计数据 |

---

### 📊 gm-tracker.ts — Generator Metadata 数据层

调用 `GetCascadeTrajectoryGeneratorMetadata` 获取每次 LLM 调用的精确数据。

Fetches per-LLM-call data via `GetCascadeTrajectoryGeneratorMetadata`.

| 特性 / Feature | 说明 / Description |
|---|---|
| 聚合 / Aggregation | per-model `GMModelStats` + per-conversation `GMConversationData` → `GMSummary` |
| 智能缓存 / Smart cache | `_cache` Map 按 cascadeId 缓存 IDLE 对话的 GM 数据 |
| 模型精度 / Model accuracy | 每次调用区分 `exact`（有 `responseModel`）与 `placeholder`（仅 alias / placeholder），供 UI 透明显示 |
| 富化 / Enrichment | 对大对话或精确模型缺失的调用，按需用 `GetCascadeTrajectory` 中的内嵌 `generatorMetadata` 补充 prompt / tools / systemPrompt / user anchors |
| 检查点提取 / Checkpoint extraction | `extractCheckpointSummaries()` 从 `messagePrompts` 中提取 `{{ CHECKPOINT N }}` 标记后的压缩摘要（跳过系统前导，限 8000 字符），`shouldEnrichConversation()` 在 `checkpointIndex > 0` 时自动触发完整轨迹拉取 |
| Call baselines | `_callBaselines` 隔离新旧 quota cycle 的调用 |
| Slim persistence | `serialize()` 去掉 `calls[]`，用于快速恢复基线 |
| Detailed summary | `getDetailedSummary()` 返回完整 `GMSummary`（含 calls），写盘前通过 `slimSummaryForPersistence()` 剥离文本字段（prompt / chat / checkpoint summaries / token breakdown / tools），仅保留 token/credits 计费数据 |
| Monitor fallback | `getAllConversationData()` 导出对话级 GM 明细，供 Monitor 标签页回退展示 |
| Per-pool reset | `reset(modelIds?)` 仅归档并隐藏匹配 pool 的调用 |
| 跨账号调用标记 / Account tagging | `_currentAccountEmail` 记录当前活跃账号；`_callAccountMap`（`cascadeId:index → email`）持久映射每个调用的归属账号，跨 re-fetch 和 VS Code 重启稳定保留。`serialize()` / `restore()` 负责映射表的序列化和恢复 |

---

### 📊 activity-panel.ts — GM Data 统一面板渲染

合并原 Activity 面板和 GM Data 面板为统一的「GM 数据」标签页。

Unified "GM Data" tab merging Activity and GM precise data.

| 特性 / Feature | 说明 / Description |
|---|---|
| 检查点查看器 / Checkpoint Viewer | `buildCheckpointViewer()` 渲染当前活跃对话（通过最新 `createdAt` 定位）的 `{{ CHECKPOINT N }}` 压缩摘要全文，琥珀色可折叠卡片 + 限高滚动容器 |
| 多账号状态面板 / Account Status Panel | `buildAccountStatusPanel()` 在 GM Data 顶部渲染多账号状态卡片：`AccountSnapshot[]` → 按 email 分行，显示在线/缓存状态、Plan 徽章、按模型池独立倒计时（`ResetPool[]`），到期显示红色「已就绪」|
| 增量刷新保护 / Refresh preservation | `<details>` 展开状态通过 `restoreDetailsState()` 自动保护；`.cp-viewer` / `.cp-card-body` 滚动位置通过 `scrollableSelectors` 保留 |
| 账号分布标签 / Account breakdown tags | 模型卡片 footer 区域垂直排列紫色药丸标签，按 `accountEmail` 分组显示各账号的调用次数，支持完整邮箱前缀展示 |

---

### 💬 webview-chat-history-tab.ts — Sessions / 会话目录

按工作区 / 仓库分组展示全量 Cascade 对话列表，提供筛选与操作入口。

Displays all Cascade conversations grouped by workspace/repository with filtering and action buttons.

| 特性 / Feature | 说明 / Description |
|---|---|
| 统计汇总 / Summary | 会话数 + 总积分消耗一行展示 |
| 快捷卡片 / Shortcut cards | 当前工作区 / 当前仓库 / 运行中 / 可录制 四类快速筛选入口 |
| 搜索 / Search | 自由文本搜索对话标题和 cascadeId |
| 筛选 / Filters | 全部 / 当前工作区 / 当前仓库 / 运行中 / 可录制 工具栏按钮 |
| 逐会话操作 / Actions | 打开工作区文件夹、Brain 目录、原始 `.pb` 文件 |
| 数据源 / Data source | 复用 `lastTrajectories`（Trajectory 列表）+ GM 会话数据 |

---

### 💲 pricing-store.ts — 定价数据层

管理模型定价：默认价格表、用户自定义持久化、模糊匹配、费用计算。

---

### 🧬 model-dna-store.ts — 模型信息持久化

持久化跨周期保留的模型静态信息。当前周期的调用 / 步骤 / 积分等动态统计仍来自 `GMSummary`，但 `responseModel`、provider、completionConfig、MIME 能力线索等静态画像在归档后不会直接消失。

Persists model-level static information across quota cycles. Dynamic counters such as calls / steps / credits still come from the current-cycle `GMSummary`, while static model traits survive resets.

| 函数 / Function | 说明 / Description |
|---|---|
| `restoreModelDNAState()` | 恢复并归并历史模型信息，优先按稳定 `modelId` 去重 |
| `mergeModelDNAState()` | 将本轮 `GMSummary.modelBreakdown` 合并进持久化快照 |
| `serializeModelDNAState()` | 将持久化模型信息写回 durable state |
| `getModelDNAKey()` | 统一模型信息的稳定 key，避免显示名 / responseModel 混用拆卡 |

---

### 💎 pricing-panel.ts — Cost 标签页渲染

生成 Cost 标签页的完整 HTML，同时导出 `buildModelDNACards()` 供 Models 标签页复用「模型信息」卡片。

Builds the full Cost tab HTML and also exports `buildModelDNACards()` for the Models tab.

---

### 📅 daily-store.ts — 日历数据层

按天聚合 Activity + GM + Cost 的快照数据，支持回溯导入历史归档。`DailyCycleEntry` 包含 `accountEmail` 字段标记产生该周期的账号，`addCycle()` 从 `extension.ts` 接收 `currentAccountEmail` 参数并存入归档记录。

---

### 📅 webview-calendar-tab.ts — Calendar 标签页渲染

生成 Calendar 标签页 HTML：月历网格、可展开日详情、周期卡片、历史汇总。周期卡片标题尾部显示紫色 `.cal-account-tag` 账号标签（截取 email 前缀），支持亮色/暗色主题。

---

### 🖥️ webview-panel.ts — WebView 面板框架

面板总框架：标题「Antigravity Monitor / Antigravity 监控面板」，9 标签切换（Monitor / GM Data / Sessions / Cost / Models / Quota Tracking / Calendar / Profile / Settings）、消息通信。各标签内容由独立模块生成。新增 `onDidChangeViewState` 监听，面板从隐藏恢复可见时立即用缓存数据执行增量刷新，避免用户看到旧数据闪烁。

Panel framework titled \"Antigravity Monitor\": 9-tab navigation and message communication. Tab content rendered by independent modules. Adds `onDidChangeViewState` listener to immediately refresh tabs with cached data when the panel becomes visible again, eliminating stale-data flash.

| 模块 / Module | 职责 / Responsibility |
|---|---|
| `webview-monitor-tab.ts` | Monitor 标签页 HTML；支持实时 `gmSummary` 与 `monitor-store` GM 快照双数据源 |
| `webview-models-tab.ts` | Models 标签页 HTML；聚合默认模型、模型配额、模型信息 |
| `webview-settings-tab.ts` | Settings 标签页 HTML；含持久化存储概览（文件大小 / Input·Output Tokens / Credits / 估算总费用 / 额度重置次数 / 日历天数·周期数）、界面提示偏好 |
| `webview-script.ts` | 客户端 JS；事件委托、标签切换、设置交互、增量刷新、`<details>` 状态恢复、内部滚动位置保留（含 `.cp-viewer` / `.cp-card-body`） |
| `webview-styles.ts` | CSS 样式（Design Token 体系） |
| `webview-icons.ts` | 内联 SVG 图标 |
| `webview-chat-history-tab.ts` | Sessions / 会话标签页 HTML；全量对话列表、快捷卡片、筛选/搜索、逐会话操作按钮 |
| `activity-panel.ts` | GM Data 标签页 HTML |
| `pricing-panel.ts` | Cost 标签页 HTML；同时提供模型信息卡片构建器 |
| `webview-calendar-tab.ts` | Calendar 标签页 HTML |
| `webview-profile-tab.ts` | Profile 标签页 HTML；现主要承载账户、计划限制、功能与团队信息 |
| `webview-history-tab.ts` | Quota Tracking 标签页 HTML |

---

### 🌐 i18n.ts — 国际化

三种语言模式：中文 (`zh`)、英文 (`en`)、双语 (`both`)。启动时通过 `durable-state.ts` 读取偏好（缺失时回退并迁移自 VS Code state）；命令面板切换会同步写入 VS Code state 与外部文件，WebView 内切换当前仅写入 VS Code `globalState`。

Three language modes: Chinese (`zh`), English (`en`), and bilingual (`both`). On startup the preference is restored via `durable-state.ts` with VS Code state fallback migration; command-palette switching writes both stores, while WebView switching currently writes VS Code `globalState` only.

---

### 📋 constants.ts — 全局常量

集中管理 Step 类型、Token 估算常量、压缩检测阈值、RPC 限制、轮询退避参数。

---

## 模块依赖关系 / Module Dependencies

下图展示源码中的主要直接依赖（省略 Node / VS Code 内建模块和少量局部工具依赖）。

This diagram shows the main direct source-level dependencies (omitting Node / VS Code built-ins and a few minor local utility edges).

```text
extension.ts (入口 + 调度)
├── durable-state.ts      ← 扩展外部持久化
├── monitor-store.ts      ← Monitor 快照持久化
│   ├── tracker.ts (types)
│   └── gm-tracker.ts (types)
├── pool-utils.ts         ← 配额池辅助
├── discovery.ts          ← LS 进程发现
├── tracker.ts            ← Token 计算 + 数据获取
│   ├── rpc-client.ts     ← RPC 通信
│   ├── models.ts         ← 模型配置
│   │   └── i18n.ts       ← 国际化
│   └── constants.ts      ← 常量
├── statusbar.ts          ← 状态栏 UI
│   ├── tracker.ts
│   ├── models.ts
│   └── i18n.ts
├── i18n.ts               ← 语言偏好 / 翻译
├── quota-tracker.ts      ← 额度追踪
├── activity-tracker.ts   ← 活动追踪
│   ├── gm-tracker.ts (types)
│   ├── rpc-client.ts
│   ├── discovery.ts (LSInfo type)
│   ├── models.ts
│   └── i18n.ts
├── gm-tracker.ts         ← GM 数据层
│   ├── rpc-client.ts
│   ├── discovery.ts (LSInfo type)
│   └── models.ts
├── pricing-store.ts      ← 定价数据层
│   └── gm-tracker.ts (types)
├── model-dna-store.ts    ← 模型信息持久化
│   ├── models.ts
│   └── gm-tracker.ts (types)
├── daily-store.ts        ← 日历数据层
│   ├── activity-tracker.ts (types)
│   └── gm-tracker.ts (types)
└── webview-panel.ts      ← WebView 面板
    ├── i18n.ts
    ├── tracker.ts (types)
    ├── models.ts
    ├── quota-tracker.ts
    ├── activity-tracker.ts
    ├── gm-tracker.ts
    ├── pricing-store.ts
    ├── model-dna-store.ts (types)
    ├── daily-store.ts
    ├── webview-monitor-tab.ts
    ├── webview-models-tab.ts
    ├── webview-profile-tab.ts
    ├── webview-settings-tab.ts
    ├── webview-chat-history-tab.ts  ← 会话目录
    ├── activity-panel.ts
    ├── pricing-panel.ts
    ├── webview-calendar-tab.ts
    ├── webview-history-tab.ts
    ├── webview-script.ts
    ├── webview-styles.ts
    ├── webview-icons.ts
    └── webview-helpers.ts
```

---

## 数据流 / Data Flow

```text
Antigravity Language Server (localhost)
        │
        │ Connect-RPC (HTTPS/HTTP + CSRF token)
        ▼
    rpc-client.ts ────► tracker.ts ────► extension.ts (轮询中心)
        │                                     │
        │             ┌───────────────┬───────┬───────────────┬────────────────┐
        │             ▼               ▼       ▼               ▼                ▼
        │    activity-tracker.ts  monitor-store.ts  quota-tracker.ts  gm-tracker.ts  model-dna-store.ts
        │             │               │       │               │                │
        │             │               │       │          pricing-store.ts      │
        │             │               │       │               │                │
        │             │               │       ▼               │                │
        │             │               │  onQuotaReset         │                │
        │             ▼               │   callback            ▼                │
        │    activity-panel.ts ◄──────┴────────────── pricing-panel.ts         │
        │             │                                                        │
        │    webview-chat-history-tab.ts ◄─── trajectories + GM conversations  │
        │             │
        ▼             ▼
    statusbar.ts   webview-panel.ts ─────► daily-store.ts
        │             │                      (calendar data)
        │             ▼
        │        durable-state.ts
        │        (external JSON file)
        ▼
    VS Code
    Status Bar
```

---

## 构建与安装 / Build & Install

### 1. 编译 / Compile

```bash
npm run compile
```

### 2. 测试 / Test

```bash
npm test
npm run test:watch
```

> 测试文件位于 `tests/`，仅供 Vitest 使用；不会被打包到发布的 VSIX 中。

### 3. 打包 / Package

```bash
npx vsce package --no-dependencies
```

### 4. 安装 / Install

1. 在 VS Code / Antigravity IDE 中按 `Ctrl+Shift+P`
2. 输入 `Extensions: Install from VSIX...`
3. 选择生成的 `.vsix` 文件
4. 重载窗口

---

## 测试详情 / Test Details

| 测试文件 / Test File | 测试数 | 覆盖范围 / Coverage |
|---|---|---|
| `discovery.test.ts` | 50 | `buildExpectedWorkspaceId`（含百分号编码、CJK 路径、空格+中文混合路径、日文路径） / `extractPid` / `extractCsrfToken` / `extractWorkspaceId` / `filterLsProcessLines` / `extractPort` / `extractPortFromNetstat` / `extractPortFromSs` / `isWSL` / `selectMatchingProcessLine`（优先级反转 + 多窗口回退 + CJK + WSL/vscode-remote + 边界情况） / 退避常量验证（发现 15s / RPC 60s） |
| `pr43-improvements.test.ts` | 35 | `selectMatchingProcessLine` 新架构优先级（双 LS 共存 / 向后兼容 / 真实场景模拟） / 轮询状态机（僵尸检测 / PID 重校验 / `stalenessConfirmedIdle` 守卫 / cascade 切换重置 / corner cases） |
| `tracker.test.ts` | 22 | `normalizeUri`（file / vscode-remote / URL 解码）/ `estimateTokensFromText`（ASCII / 非 ASCII / 混合）/ `processSteps()` 纯函数 |
| `statusbar.test.ts` | 12 | Token 格式化 / 上下文限额格式化 / 压缩统计计算 / 计划层级缓存清理 |
| `quota-tracker.test.ts` | 33 | 状态机转换 / 额度重置检测 / 批量回调 / 同池去重 / 周期结束归档 / legacy done 迁移 / 0% 回弹恢复 / 稳定池代表 / 脏 active session 自愈 |
| `pool-utils.test.ts` | 4 | 配额池扩展 / 分组 / quota session 匹配 / 已知模型固定池规则 |
| `monitor-store.test.ts` | 1 | Monitor 快照与 GM 会话快照恢复 |
| `gm-tracker.test.ts` | 4 | `filterGMSummaryByModels()` 按模型池过滤 / 跨语言恢复回归 / 历史残留 GM 修理 / GM 归档复活回归 |
| `activity-tracker.test.ts` | 7 | planner step 延迟补全 / 短对话恢复自愈 / stepIndex 重排清理 / 跨语言模型桶合并 / Gemini stepIndex 重映射去重 / 用户行 GM 污染清洗 / 恢复时历史重复自愈 |
| `daily-store.test.ts` | 2 | 日历导入回填（新 cycle 插入 / 旧 cycle 字段补全） |
| `model-dna-store.test.ts` | 1 | 模型静态信息跨周期持久化 |
| `reset-time.test.ts` | 3 | 倒计时格式化 / 绝对日期时间格式化 / 上下文拼接格式（按本地时区动态断言） |
| `durable-state.test.ts` | 1 | 外部持久化文件创建 / fallback 迁移 / 重装恢复 |

共 149 个测试（13 个文件），使用 `__mocks__/vscode.ts` 模拟 VS Code API。

149 total tests (13 files), using `__mocks__/vscode.ts` to mock VS Code API.

# 变更日志 v2 / Changelog v2

> 本文件记录 v1.15.2 起的增量版本更新。  
> 历史版本请参阅 [`CHANGELOG.md`](./CHANGELOG.md)（v1.0.0 – v1.15.1）。
>
> This file tracks incremental updates starting from v1.15.2.  
> For historical versions, see [`CHANGELOG.md`](./CHANGELOG.md) (v1.0.0 – v1.15.1).

---

## [1.17.2] - 2026-04-22

### 重构 / Refactored

- **模型卡片账号分布重设计 / Model Card Account Breakdown Redesign**:
  将模型卡片 footer 中的紫色药丸气泡标签（`gm-account-tag`）重设计为 card-body 内的结构化数据行：
  - 分割线隔开统计区域和账号区域，与 GM 统计行风格统一
  - 每行使用用户 SVG 图标 + 邮箱前缀（左侧） + 紫色加粗调用次数（右侧）
  - `justify-content: space-between` 布局，与上方的调用/TTFT 等行视觉对齐

  Redesigned account breakdown from purple pill bubbles in card footer to structured data rows inside card body, with divider separator, user SVG icons, and consistent layout with other stat rows.

- **活跃账号高亮 / Active Account Highlight**:
  当前在线账号行以绿色选中态展示：2px 左竖线 + 绿色边框 + 微妙绿色背景 + 用户图标变绿 + 名字变亮白 + 数字变绿。自动置顶排序。通过 `accountSnapshots.find(s => s.isActive)` 获取当前账号并传入 `buildModelCards()`。

  Active account row highlighted with green selected state: left border + border + background + icon/text color change. Auto-sorted to top.

### 新增 / Added

- **模型统计汇总行 / Model Stats Total Row**:
  模型卡片网格下方新增芯片条汇总行，显示跨全部账号的总调用数、模型数、输入/输出/缓存 token。数据从 `gm.conversations[].calls[]` 全量遍历计算（`allAccountTotalCalls` / `allAccountTotalIn` / `allAccountTotalOut` / `allAccountTotalCache`），不使用经 `accountFilteredCalls` 过滤的 `gm.totalCalls` 等字段。

  New summary chip-bar below model cards grid showing cross-account totals (calls, models, in/out/cache tokens), computed from raw `gm.conversations[].calls[]` to bypass account filtering.

  **视觉设计 / Visual Design**:
  - Sigma (Σ) SVG 图标 + 蓝色 "合计" 标签 + 独立芯片卡片（边框 + 背景 + 圆角 + hover 效果）
  - 浅色/深色主题完整适配
  - 各统计项内数值加粗、标签暗色，层次清晰

### 移除 / Removed

- **卡片头部调用徽章 / Card Header Call Badge**:
  移除模型卡片头部的 `<span class="act-badge act-badge-total">xx 调用</span>` 和 GM-only 卡片的 `<span class="act-badge">xx calls</span>`。调用次数现在仅在卡片内统计行和账号分布区展示，消除冗余。

  Removed redundant call count badges from model card headers. Call counts are now shown only in the card body stats row and account breakdown section.

### 清理 / Cleanup

- **死代码清理**: 移除 `totalLabel` 删除后遗留的 `gmStatsForLabel` 变量和从未使用的 `avgThink` 变量

### 增强 / Enhanced

- **错误追踪分账号隔离 / Per-Account Error Isolation**:
  错误码持久化从全局单桶（`_persistedRetryErrorCodes`）重构为分账号独立存储（`_persistedRetryErrorCodesByAccount`: email → { code → count }）。切换账号时各账号的错误数据独立保存不丢失，切回时恢复。

  Error persistence refactored from global single-bucket to per-account isolated storage. Each account retains its own error history across account switches.

  **迁移逻辑**: `restore()` 检测旧版全局字段，自动归入当前账号桶。迁移完成后清空旧字段。
  Migration: `restore()` detects legacy global fields and attributes them to the current account.

- **错误增量显示 / Error Delta Display (+x)**:
  参照工具调用排行的 `+x` 增量模式，新增分对话错误统计：

  | 位置 | 显示 | 示例 |
  |------|------|------|
  | Summary Bar 报错卡片 | 红色 `+x` | `11 +6` |
  | Summary Bar tooltip | 每个错误码带 `(+x)` | `429 ×8 (+6), 500 ×2` |
  | 错误详情标题 | 红色 `+x 本对话` | `错误详情 探针 +6 本对话` |
  | 错误码标签 | 每个标签内红色 `+x` | `429 ×8 +6` |

  **数据源**: `GMSummary.retryErrorCodesByConv`（cascadeId → { errorCode → count }），使用 `sliced` 数据（免疫归档）。仅在 ≥2 个对话有错误时显示增量。

  Mirrors the tool call ranking `+x` pattern for error tracking. Shows per-conversation error contribution in red across Summary Bar, tooltips, and Error Details section.

### 统计 / Stats

- **Files changed**: 3 (`src/gm/types.ts`, `src/gm/tracker.ts`, `src/activity-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Key design**: 基础数字 = 当前账号所有对话总和（`retryErrorCodes` from `accountFilteredCalls`）；红色 `+x` = 当前对话贡献（`retryErrorCodesByConv[cascadeId]` from `sliced`）

---

## [1.17.1] - 2026-04-22

### 修复 / Fixed

- **重试计数虚报 / Retry Count False Positive**:
  `parser.ts` 中 `cm.retries` 是 GM payload 的"总尝试次数"（成功一次 = `1`），不是"失败重试次数"。旧逻辑直接 `parseInt0(cm.retries)` 导致每个调用都有 `retries=1`，全部被计为重试。例如 43 次正常调用会显示为「43 重试」。
  `cm.retries` in the GM payload means "total attempts" (1 = first-try success), not "failed retry count". The old parser used this value directly, causing every call to have `retries=1`.

  **修复**: 改为只计算 `retryInfos[]` 中有 `error` 字段的条目数（与 `gm-live-watcher.ts` 诊断脚本逻辑一致）。当 `retryInfos` 不可用但 `cm.retries > 1` 时，使用 `cm.retries - 1` 作为降级值。
  Fix: Only count `retryInfos` entries with actual error messages as retries. Fallback: `cm.retries - 1` when no retryInfos available.

### 重构 / Refactored

- **错误报告现代化 / Error Reporting Modernization**:
  重试中心化的诊断报告全面替换为错误码感知系统：

  **数据层**:
  - `GMSummary` 新增 `retryErrorCodes: Record<string, number>` 和 `recentErrors: string[]`
  - 新增 `parseErrorCode()` 从错误消息解析 HTTP 状态码或类别（`429`/`503`/`400`/`stream_error`/`timeout`/`unknown`）
  - `_buildSummary()`、`filterGMSummaryByModels()`、`buildSummaryFromConversations()` 三条汇总路径均聚合错误码
  - `getDetailedSummary()`/`getFullSummary()` 透传新字段

  **UI 改动**:
  | 区域 | 改前 | 改后 |
  |------|------|------|
  | Summary Bar | "N GM 重试" | "N 报错"（仅真实错误计数），tooltip 展示错误码分布 |
  | Timeline | `retry(1)⚠429` | `error(N)` |
  | Turn header | `retry(N)⚠429` | `error(N)` |
  | GM Data 面板 | 「重试开销」4 格卡片 (`buildRetryOverhead`) | 「错误详情」区块 (`buildErrorDetailsSection`)：错误码分类标签 + 开销统计 + 最近报错消息 |

### 移除 / Removed

- **`buildRetryOverhead()` 函数**: 整个"重试开销"卡片（4 格 grid: token 浪费 / credits 损耗 / 重试次数 / 开销率 + stopReason 分布标签）移除，功能分散至 Summary Bar tooltip 和 `buildErrorDetailsSection()`
- **`retry429` 死 CSS**: 移除 `.act-tl-gm-retry429`、`.seg-chip-retry429` 及对应暗色主题覆盖
- **`has429` turn 变量**: `buildTimeline()` 中 turn header 不再单独追踪 429 状态
- **`StepEvent.gmRetryHas429`**: 标记为 `@deprecated`（保留以兼容序列化）

### 统计 / Stats

- **Files changed**: 5 (`src/gm/parser.ts`, `src/gm/types.ts`, `src/gm/summary.ts`, `src/gm/tracker.ts`, `src/activity-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Key fix insight**: `retryInfos` 始终包含成功调用作为末尾 entry（无 error 字段），只有有 error 的 entry 才是真正的失败重试

### 增强 / Enhanced

- **错误详情持久化与 UI 交互 / Error Details Persistence & UI**:

  **持久化**:
  - `GMTrackerState` 新增 `persistedRecentErrors` + `persistedRetryErrorCodes` 字段
  - 存入 `state-v1.json`（文件级），卸载重装后保留，午夜 `reset()` 清空
  - 合并策略：errorCodes 使用 max-wins，recentErrors 在新鲜数据为空时用持久化兜底

  **数据修复**:
  - 移除错误消息 `substring(0, 120)` 截断，完整捕获原文
  - API 返回的错误消息内部重复清洗（`"msg.: msg."` → `"msg."`）
  - `errorMessage` 与 `retryErrors` 双重计数修复：`errorMessage` 仅在 `retryErrors` 为空时降级收集
  - 推算步骤(estimated)排除 error 标签和 turn header 统计（防与 gm_virtual 双重计数）

  **UI 交互**:
  - 所有错误消息使用 `<details>` 可展开/收缩，CSS `text-overflow: ellipsis` 自动适配容器宽度
  - 展开状态通过 `id="d-err-N"` + `restoreDetailsState()` 在 poll 刷新后保持
  - 倒序排列（最新在顶部），序号 `#N` 按时间顺序编号（最大数字 = 最新）
  - 展示上限 10 条，内部缓存上限 30 条

---

## [1.17.0] - 2026-04-22

### 🏗 Refactored / 重构

- **工具调用排行数据源重构 / Tool Call Ranking Data Source Overhaul**:
  `toolCallCounts` 统计从 `accountFilteredCalls`（受账号过滤 + 额度归档过滤）迁移至 `sliced`（仅排除 baseline 之前的旧周期数据）。
  Tool call counting migrated from `accountFilteredCalls` (account-filtered + archival-filtered) to `sliced` (post-baseline only).

  **变更前 / Before**: 工具统计在 `accountFilteredCalls` 循环内计算 → 白天额度重置后归档的调用会从统计中消失，且只统计当前账号的调用。
  **变更后 / After**: 工具统计使用独立的 `sliced` 循环 → 不受额度重置归档影响，统计范围为全账号。仅午夜 `reset()` 推进 baseline 时清零。

- **`+x` 增量改用 `cascadeId` 精确匹配 / Delta Uses Stable CascadeId**:
  `buildToolCallRanking()` 的"当前对话"识别从"遍历所有 `calls[].createdAt` 找最大时间"改为使用 `currentUsage.cascadeId` 精确匹配。`cascadeId` 是对话的唯一稳定标识，不受压缩/重命名/checkpoint 影响。
  Current conversation identification changed from "latest createdAt timestamp scan" to exact `currentUsage.cascadeId` match — stable across compressions, renames, and checkpoints.

- **`+x` 数据源预计算化 / Pre-Computed Delta Data**:
  `+x` 增量不再从 `gm.conversations[].calls` 现场遍历 `toolCallsByStep` 计算，改为直接读取 `GMSummary.toolCallCountsByConv[cascadeId]`（在 `_buildSummary()` 中与总数同步预计算）。消除了增量和总数使用不同数据源导致的不一致风险。
  Delta no longer computed live from `conversations[].calls`; reads pre-computed `toolCallCountsByConv` (same `sliced` source as totals).

### ✨ Added / 新增

- **`GMSummary.toolCallCountsByConv`**:
  新增 `Record<cascadeId, Record<toolName, count>>` 可选字段，存储每个对话的工具调用分布。与 `toolCallCounts` 使用相同的 `sliced` 数据源，不受额度归档影响。UI 直接读取此字段渲染 `+x` 增量，无需现场计算。
  New optional field storing per-conversation tool call breakdown, immune to quota-reset archival.

- **`_persistedToolCounts` / `_persistedToolCountsByConv` 跨重启持久化**:
  新增两个持久化字段，通过 `serialize()`/`restore()` 跨扩展重启保留。`_buildSummary()` 中使用 **max-wins** 策略合并持久化基线与新计算值（取较大者），确保重启后即使 API 尚未返回完整数据也不丢失统计。午夜 `reset()` 和 `fullReset()` 清空。
  New persisted fields surviving restarts via serialize/restore. `_buildSummary()` merges with max-wins strategy.

- **`GMTrackerState.persistedToolCallCounts` / `persistedToolCallCountsByConv`**:
  序列化状态新增两个可选字段（v1.17.0），旧版本 state 无此字段时自动跳过（向后兼容）。
  Two new optional fields in serialized state (backward compatible).

### 🏗 Improved / 改进

- **模型卡片 GM 数据过滤 / Model Card GM-Only Filter**:
  `buildModelCards()` 现在过滤掉没有 GM 精确数据（`callCount > 0`）的模型，不再显示 Step API 遗留的 "共 XX 步" 降级标签。
  Model cards now filter to GM-data-only entries, removing legacy "XX steps" fallback labels.

### 📊 Stats / 统计

- **Files changed**: 3 (`src/gm/tracker.ts`, `src/gm/types.ts`, `src/activity-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Key design**: `sliced`（post-baseline, pre-archival）作为工具统计唯一数据源；max-wins 合并保障跨重启数据完整；`cascadeId` 替代 `createdAt` 时间戳作为对话标识

---

## [1.16.1] - 2026-04-21

### ✨ Added / 新增

- **工具调用排行榜 / Tool Call Ranking**:
  在 GM Data 面板新增工具调用频率排行榜（`buildToolCallRanking()`），直接从 GM `messagePrompts` SYSTEM 消息的 `toolCalls[]` 字段提取 AI 实际发起的工具调用名称和次数，按 stepIdx 全局去重后聚合。
  New tool call ranking section in the GM Data tab, extracting AI-invoked tool names from `messagePrompts` SYSTEM entries' `toolCalls[]` field, deduplicated by stepIdx.

  **数据管线 / Data Pipeline**:
  ```
  messagePrompts → SYSTEM messages with { stepIdx, toolCalls[{ functionName }] }
    → extractToolCallsByStep() → Record<stepIdx, toolName[]>
    → maybeEnrichCallsFromTrajectory() broadcasts to all calls
    → _buildSummary() aggregates → GMSummary.toolCallCounts
    → buildToolCallRanking() renders bar chart
  ```

  **特性 / Features**:
  - 水平条形图，6 色循环（蓝、绿、黄、红、青、紫），nth-child 自动轮替
  - 跨对话累加：当前计费周期内所有对话的工具调用合并统计
  - 绿色 `+x` 增量标注：当存在多对话数据时，最新活跃对话的贡献量以绿色增量显示
  - 当天持久化：`toolCallCounts` 通过 `GMSummary` 在 `serialize()/restore()` 中跨重启保留
  - 每日自动清零：daily archival `reset()` 清空 `_lastSummary`，工具统计从零重算
  - 最多显示 15 个工具，超出部分以 `+N 个更多` 提示
  - 底部汇总行显示工具种类数、总调用次数、参与对话数

- **`extractToolCallsByStep()` 解析函数 / Parser Function**:
  新增 `parser.ts` 中的工具调用提取函数，从 `messagePrompts` SYSTEM 消息中按 `stepIdx` 提取 `toolCalls[].functionName`，生成 `Record<number, string[]>` 映射。集成至 `extractPromptData()` 和 `parseGMEntry()` 输出，并在 `maybeEnrichCallsFromTrajectory()` 中广播至同对话所有调用。
  New parser function that extracts tool call names from SYSTEM messages by stepIdx. Integrated into the extraction pipeline and broadcast via trajectory enrichment.

### 🏗 Improved / 改进

- **`GMCallEntry.toolCallsByStep`**:
  新增 `Record<number, string[]>` 字段存储每个 step 的 AI 工具调用列表。`slimCallForPersistence()` 中清空为 `{}`（运行时从 API 回填），不增加持久化文件体积。
  New field storing per-step tool call names. Cleared in `slimCallForPersistence()` to keep state file lean; repopulated from API on restart.

- **`GMSummary.toolCallCounts`**:
  新增 `Record<string, number>` 字段存储聚合的工具频率统计。`filterGMSummaryByModels()`、`normalizeGMSummary()`、`buildSummaryFromConversations()` 全部透传。
  New field for aggregated tool frequency counts, propagated through all summary functions.

### 📊 Stats / 统计

- **Files changed**: 5 (`src/gm/types.ts`, `src/gm/parser.ts`, `src/gm/tracker.ts`, `src/gm/summary.ts`, `src/activity-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Key design**: 工具统计不持久化原始数据（`toolCallsByStep`），仅持久化聚合结果（`toolCallCounts`），重启后从 API 回填原始数据重新计算

---

## [1.16.0] - 2026-04-21

### 修复 / Fixed

- **待归档区持久化 / PendingArchive Persistence**:
  `_pendingArchives` 之前是纯内存数据，插件重启即丢失。现在通过 `serialize()`/`restore()` 持久化至 `state-v1.json`（文件级存储，独立于插件安装目录），跨重启和重装保留。仅在午夜 `reset()` 时清空。
  `_pendingArchives` was pure in-memory data, lost on restart. Now persisted via `serialize()`/`restore()` to `state-v1.json` (file-level, independent of extension install dir). Only cleared on midnight `reset()`.

- **归档数量不准确 / Inaccurate Archive Count**:
  `baselineForQuotaReset()` 仅遍历 `_cache` 中已加载的 calls，导致部分对话调用被遗漏（实测 20 vs 126）。修复：优先从 `_lastSummary`（已聚合完整视图）统计准确数据；新增 `_archivedAccountModelCutoffs`（`email|model` → ISO 时间戳），以当前时间为截断点，确保即使 `_cache` 不完整，后续 `_buildSummary()` 也能正确过滤已归档调用。
  `baselineForQuotaReset()` only iterated loaded calls in `_cache`, missing conversations not yet re-fetched (observed 20 vs 126). Fix: prioritize `_lastSummary` for accurate stats; new `_archivedAccountModelCutoffs` (`email|model` → ISO timestamp) with cutoff at `now` ensures future `_buildSummary()` filters correctly even with incomplete cache.

- **跨池误归档 / Cross-Pool Over-Archival**:
  `baselineForQuotaReset()` 归档了账号下**所有**模型的调用，而非仅限已重置的额度池。例如 Claude+GPT 池重置时，Gemini Pro 和 Flash 池的调用也被一起归档。修复：新增 `poolModelFilter` 参数，通过 `normalizeModelDisplayName` 匹配，只归档池内模型。两个调用点——`onQuotaReset`（传 `modelIds`）和 `checkCachedAccountResets`（传 `pool.modelLabels`）——均已更新。
  `baselineForQuotaReset()` archived ALL models for an account instead of only the reset pool's models. Fix: new `poolModelFilter` parameter with `normalizeModelDisplayName` matching. Both callsites — `onQuotaReset` (passes `modelIds`) and `checkCachedAccountResets` (passes `pool.modelLabels`) — updated.

### 改进 / Improved

- **缓存账号预快照 / Cached Account Pre-Baseline Snapshot**:
  缓存账号额度重置路径 (`checkCachedAccountResets`) 之前直接 baseline 不做 DailyStore 预快照，导致数据在午夜 `reset()` 时可能丢失。现在与在线账号行为一致：先 `preBaselineSummary → DailyStore`（append），再 `baselineForQuotaReset`。
  Cached account quota reset path now snapshots data to DailyStore before baselining (same as active account), preventing data loss at midnight `reset()`.

### 重构 / Refactored

- **`PendingArchiveEntry` 类型迁移**:
  从 `gm/tracker.ts` 移至 `gm/types.ts`，消除 barrel 循环依赖风险。`gm/index.ts` 和 `gm-tracker.ts` 导出链已更新。
  `PendingArchiveEntry` moved from `gm/tracker.ts` to `gm/types.ts` to avoid circular dependency. Export chain updated.

### 统计 / Stats

- **Files changed**: 4 (`src/gm/types.ts`, `src/gm/tracker.ts`, `src/gm/index.ts`, `src/extension.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors

---

## [1.15.13] - 2026-04-21

### 🗑 Removed / 移除

- **Step API 不可信数据全面清除 / Step API Unreliable Data Purge**:
  从 Activity 面板和日历面板中彻底移除所有基于 Step API 的不精确统计数据。Step API 的步骤详情受 ~500 步窗口限制，长对话中早期数据会丢失，导致工具排行和模型分布等统计不准确。
  Removed all Step API-based imprecise statistics from both the Activity panel and Calendar panel. Step API step details are limited to a ~500-step window, causing data loss in long conversations.

  **Activity 面板移除项 / Activity Panel**:
  - `buildToolRanking()` — 基于 `globalToolStats` 的工具排行榜（函数 + 10 色 CSS 全删）
  - `buildDistribution()` — 基于 `modelStats` 的模型分布甜甜圈图（函数 + SVG 全删）
  - Summary Bar：推理、工具、错误、检查点、推算 共 5 个卡片
  - 模型卡片：推理回复、工具、检查点、错误、推算步数、平均思考、总推理耗时、总工具耗时 共 8 行
  - 模型卡片 footer：`toolBreakdown` 工具标签

  **日历面板移除项 / Calendar Panel (`webview-calendar-tab.ts`)**:
  - 日详情：推理、工具、错误 → 改为 GM 调用（置顶）
  - 概览 Grid：推理、工具 → 改为 GM 调用
  - 周期卡片：推理、工具、错误 → 改为 GM 调用
  - 周期模型明细：`buildPerModelRows()` 调用（只保留 GM 明细）
  - 日详情模型汇总：`mergedModelHtml`（只保留 GM 汇总）

### ✨ Added / 新增

- **GM 重试统计 / GM Retry Stats**:
  Summary Bar 新增红色重试卡片，显示 `gm.totalRetryCount`（GM 徽章），tooltip 内联浪费 token 数（`gm.totalRetryTokens`）。合并了原来分开的卡片，减少布局溢出。
  New red retry stat card showing `gm.totalRetryCount` with GM badge. Tooltip includes wasted token count.

### 🎨 Styles / 样式

- **Dashboard Grid 布局 / Dashboard Grid Layout**:
  Summary Bar 从 `flex-wrap` 松散卡片升级为 CSS Grid (`auto-fill, minmax(85px, 1fr)`) 统一面板：1px 间隙网格分隔线，`outline` 实现圆角容器（避免 `overflow: hidden` 裁剪 tooltip），hover 时背景柔和高亮。
  Summary Bar upgraded from loose flex-wrap cards to CSS Grid unified panel with 1px gap grid lines and outline-based rounded corners.

- **Tooltip 边缘适配 / Tooltip Edge Anchoring**:
  方向改为向下弹出避免顶部裁剪；支持换行 (`max-width: 220px`)；`:first-child` 靠左、`:last-child` 靠右，防止溢出 webview 边界。

- **模型卡片头部 / Model Card Headers**:
  步骤统计从 Step API `actualSteps+estSteps` 改为 GM `callCount`，GM 不可用时降级。

### 📊 Stats / 统计

- **Files changed**: 3 (`src/activity-panel.ts`, `src/webview-calendar-tab.ts`, `docs/project_structure.md`)
- **Net change**: +57, −194 (net −137)
- **TypeScript compile**: Zero errors
- **Key decision**: 所有面向用户的统计数据完全源自 GM 精确数据，Step API 仅用于时间线事件降级补充

---

## [1.15.11] - 2026-04-21

### ✨ Added / 新增

- **额度周期基线化 / Quota-Cycle Baselining**:
  新增 `baselineForQuotaReset(targetEmail?)` 方法，按账号标记当前额度周期的 GM 调用为已归档（`_archivedCallIds` + `_archivedModelCutoffs`），同时累加统计生成 `PendingArchiveEntry`，包含调用数、token、credits 和 per-model 分布。`getPendingArchives()` 暴露待归档列表供 UI 渲染。
  New `baselineForQuotaReset(targetEmail?)` marks current cycle's GM calls as archived by account, generating `PendingArchiveEntry` with per-model stats. `getPendingArchives()` exposes the pending list for UI rendering.

- **待归档面板 / Pending Archive Panel**:
  在 GM Data 标签页账号面板下方新增黄色主题待归档区域。显示已基线化周期的调用数、输入/输出 token、credits 和 per-model 芯片分布。仅在额度重置触发基线化后可见，为用户提供"数据已保存、等待午夜归档"的可视化确认。
  New amber-themed pending archive panel below the account status cards. Shows baselined cycle stats with per-model chip breakdown. Only visible after a quota reset triggers baselining.

- **缓存账号删除 / Cached Account Removal**:
  缓存（非在线）账号卡片右侧新增删除按钮（X），支持一键移除不再需要的历史账号快照。在线账号卡片使用等宽占位符保持视觉对齐。
  Cached account cards now have a delete button (X) on the right side. Active account cards use invisible spacers for alignment.

- **额度池未使用检测 / Idle Pool Detection**:
  `updateAccountSnapshot()` 新增 `hasUsage` 字段检测池内模型是否消耗了额度（`remainingFraction < 1.0`）。未消耗的池在账号卡片中以灰色半透明「未使用」标签显示，代替虚假的倒计时。
  `updateAccountSnapshot()` now tracks `hasUsage` per pool. Unused pools display a dimmed "Idle" label instead of a misleading countdown.

- **按账号过滤 GM 统计 / Per-Account GM Filtering**:
  `_buildSummary()` 新增 `accountFilteredCalls` 过滤，确保 `totalCalls` / `modelBreakdown` / `totalCredits` 等全局统计只计当前在线账号的调用。`conversations[]` 数组保留所有账号的调用，支持跨账号分布标签渲染。
  `_buildSummary()` now filters calls by `_currentAccountEmail` for global stats while keeping `conversations[]` unfiltered for cross-account breakdown tags.

### 🏗 Improved / 改进

- **额度重置自动预快照 / Automatic Pre-Reset Snapshot**:
  在线账号额度重置时，`onQuotaReset` 回调先将当前 GM+Activity 数据以 `append` 模式写入 DailyStore，再执行基线化。确保旧额度周期的数据不会因清零而从日历中丢失。
  Active account quota resets now snapshot current data to DailyStore (append mode) before baselining, preventing data loss across quota cycles.

- **缓存账号额度过期自动基线化 / Cached Account Auto-Baselining**:
  `checkCachedAccountResets()` 在检测到缓存账号额度过期时，自动调用 `baselineForQuotaReset(email)` 标记该账号的调用为已归档，确保用户切回时不会看到旧周期的重复数据。
  Cached account quota expiry now automatically baselines that account's calls, preventing duplicate counts when switching back.

- **DailyStore 追加模式 / DailyStore Append Mode**:
  `addDailySnapshot()` 新增 `append` 参数。`append=true` 追加周期而非替换当天记录，支持同一天内多个额度重置产生的多个数据周期。`performDailyArchival` 也改为 append 模式，不覆盖白天额度重置写入的预快照。
  `addDailySnapshot()` now supports `append` mode. Both quota-reset pre-snapshots and midnight archival use append, preserving multiple cycles per day.

- **存储清理 / Storage Cleanup**:
  `_callAccountMap`（调用→账号映射）现随午夜 `reset()` 一同清空，防止从 3 月以来的历史映射无限增长导致状态文件膨胀。
  `_callAccountMap` is now cleared on `reset()`, preventing unbounded growth from historical call-to-account mappings.

### 📊 Stats / 统计

- **Files changed**: 9 (`src/gm/tracker.ts`, `src/gm/index.ts`, `src/gm-tracker.ts`, `src/extension.ts`, `src/daily-store.ts`, `src/daily-archival.ts`, `src/activity-panel.ts`, `src/webview-panel.ts`, `src/webview-script.ts`)
- **Net change**: +398 lines, −18 lines
- **TypeScript compile**: Zero errors
- **Tests**: 166 passed (14 files)

---

## [1.15.12] - 2026-04-21

### 🏗 Refactored / 重构

- **QuotaTracker 使用检测策略重构 / Usage Detection Overhaul**:
  移除旧的 instant detect（基于 `knownWindowMs` 推算已消耗时间）和 observation window（10 分钟 resetTime 稳定性检测）两种猜测策略，均在 `remainingFraction` 20% 量化下不可靠且会产生幽灵 session。改为 GMTracker 辅助检测：调用方通过新增 `usedModelIds` 参数传入当前周期内有实际 LLM 调用的模型 ID 集合，frac=1.0 时若确认有调用则立即进入追踪。同时移除废弃常量 `ELAPSED_THRESHOLD_MS` 和 `OBSERVATION_WINDOW_MS`。
  Removed unreliable instant detect (elapsed time inference from `knownWindowMs`) and observation window (10-min resetTime stability check) strategies — both produced ghost sessions under 20% quantization. Replaced with GMTracker-assisted detection via new `usedModelIds` parameter. Removed unused `ELAPSED_THRESHOLD_MS` and `OBSERVATION_WINDOW_MS` constants.

- **QuotaTracker 按账号隔离 / Per-Account State Isolation**:
  `modelStates` key 从 `modelId` 变更为 `email:modelId`，切换账号后各账号的追踪状态完全独立——旧账号状态冻结在 Map 中不被覆盖，切回时恢复追踪。旧格式（无 `:` 前缀）的 key 保留在 Map 中，逐步自然淘汰。
  `modelStates` key changed from `modelId` to `email:modelId`. Each account's tracking state is fully independent — switching accounts freezes the old state in the map without overwriting, resuming when switching back.

- **公共 `buildUsedModelIds()` / Shared Helper**:
  从 `updateAccountSnapshot()` 中提取重复的 GMTracker 调用记录过滤逻辑为独立公共函数。按 `accountEmail` 过滤、使用语言无关的 `model` (model ID) 匹配，被 account snapshot 和 QuotaTracker 共同使用。
  Extracted duplicated GMTracker call filtering logic into a shared function, used by both account snapshot `hasUsage` detection and QuotaTracker early tracking entry.

### ✨ Added / 新增

- **QuotaSession 账号归属 / Session Account Attribution**:
  `QuotaSession` 新增 `accountEmail?: string` 字段，每个追踪 session 记录所属账号。

- **追踪卡片账号标识 / Tracking Card Account Badge**:
  额度追踪标签页（`webview-history-tab.ts`）和监控标签页（`webview-monitor-tab.ts`）的 session 卡片均新增蓝色账号 badge，带用户 SVG 图标，显示邮箱前缀（如 `moonwolf200202`），一眼区分不同账号的追踪数据。
  Both the Quota Tracking tab and Monitor tab session cards now show a blue account badge with user SVG icon displaying the email prefix.

### ✨ Improved / 改进

- **追踪描述文案更新 / Tracking Description Update**:
  活跃追踪区域的描述从"100% 模型回退到 resetTime 漂移观测（约 10 分钟）"更新为"100% 模型在 GMTracker 确认实际调用后开始追踪"，反映新的检测策略。

### 📊 Stats / 统计

- **Files changed**: 4 (`src/extension.ts`, `src/quota-tracker.ts`, `src/webview-history-tab.ts`, `src/webview-monitor-tab.ts`)
- **Docs updated**: 1 (`docs/project_structure.md`)
- **TypeScript compile**: Zero errors
- **Key architectural decision**: GMTracker call records as the definitive usage signal at frac=1.0, replacing unreliable time-based heuristics

## [1.15.3] - 2026-04-20

### ✨ Added / 新增

- **跨账号配额隔离 / Cross-Account Quota Isolation**:
  完整实现多账号 GM 调用归属追踪与隔离。每个 LLM 调用通过 `_callAccountMap`（`cascadeId:index → email` 持久映射）永久记录其归属账号，跨 re-fetch 和 VS Code 重启稳定保留。
  Full multi-account GM call attribution and isolation. Each LLM call is permanently mapped to its originating account via `_callAccountMap` (`cascadeId:index → email`), surviving re-fetches and VS Code restarts.

- **账号切换防护 / Account Switch Guard**:
  `handleAccountSwitchIfNeeded()` 在三个 `fetchFullUserStatus` 入口点（初始发现、定期轮询、LS PID 重校验）检测账号切换，立即重置 `quotaTracker` 追踪状态防止旧 `resetTime` 触发误归档。
  `handleAccountSwitchIfNeeded()` detects account switches at all three `fetchFullUserStatus` entry points, immediately reseting `quotaTracker` to prevent stale `resetTime` from triggering false archival.

- **零用量归档卫兵 / Zero-Usage Archive Guard**:
  `onQuotaReset` 回调在归档前验证当前账号 GM 调用数 + Activity 步数均为零时跳过，防止切换账号时产生空归档。
  `onQuotaReset` verifies current account's GM calls + activity steps are both zero before archiving, preventing empty archives on account switches.

- **日历账号标记 / Calendar Account Tags**:
  `DailyCycleEntry` 新增 `accountEmail` 字段，`addCycle()` 从 `extension.ts` 接收当前账号参数。日历周期卡片标题尾部显示紫色 `.cal-account-tag` 账号标签，支持亮色/暗色主题。
  `DailyCycleEntry` now includes `accountEmail`. Calendar cycle cards show purple account tags at the end of the header line.

- **模型卡片账号分布 / Model Card Account Breakdown**:
  模型统计卡片 footer 区域垂直排列紫色药丸标签，按 `accountEmail` 分组显示各账号的调用次数，完整展示邮箱前缀。
  Model stat card footers show vertical purple pill tags grouped by account email with full prefix display.

### 🗑 Removed / 移除

- **冗余模型标签 / Redundant Model Tags**:
  移除模型卡片中的「精确调用」「仅别名」行和 footer 区域的「别名 N」「ANTHROPIC VERTEX」等 API provider 标签，减少视觉噪音。
  Removed "Exact Calls", "Alias Only" rows and API provider / alias count tags from model card footers.

### 🔧 Fixed / 修复

- **模拟额度重置缺少账号标记 / Dev Simulate Reset Missing Account Tag**:
  `devSimulateReset` 命令调用 `dailyStore.addCycle()` 时未传入 `currentAccountEmail`，导致日历归档缺少账号标记。
  Fixed `devSimulateReset` not passing `currentAccountEmail` to `dailyStore.addCycle()`.

---

## [1.15.2] - 2026-04-18

### ✨ Added / 新增

- **Collapsible Turn Groups in Timeline / 时间线可折叠轮次分组**:
  Refactored the "Recent Activity" timeline from a flat segment list into collapsible `<details>` turn groups. Each group is anchored by the user's message and visually titled with a preview of the user input. The latest turn defaults to **open**; historical turns default to **collapsed**, dramatically reducing visual clutter on long conversations.
  将"最近操作"时间线从平铺的 segment 列表重构为可折叠的 `<details>` 轮次分组。每个分组以用户消息为锚点，标题行预览用户输入文本。最新轮次默认**展开**，历史轮次默认**折叠**，极大减少长对话下的视觉噪音。

- **Segment Summary Chips / 分组摘要标签**:
  Each turn header now shows a row of compact, color-coded chips aggregated from GM data within that turn:
  - 🔵 **Model** — dominant model name (filtered `MODEL_PLACEHOLDER_*`)
  - 🟢 **Calls** — number of reasoning calls
  - 🟡 **Tools** — tool invocation count (`🔧N`)
  - 🔴 **Tokens** — total input + output tokens (e.g. `15.2k tok`)
  - 🟤 **Cache** — cache read tokens
  - 🟠 **Credits** — credit consumption (`0.4 cr`)
  - ⚫ **Duration** — wall-clock span between first and last event (`2m14s`)
  
  每个轮次 header 右侧显示从 GM 数据聚合的彩色摘要 chip：模型、调用数、工具数、Token、缓存、积分、耗时。

### ✨ Improved / 改进

- **User Anchor at Bottom / 用户消息移至底部**:
  Within each expanded turn, the user message (turn origin) now renders at the bottom, with the newest AI actions at the top. This matches the visual convention where top = newest, bottom = oldest, making the timeline read naturally from the most recent action downward to the triggering input.
  展开的分组内，用户消息（轮次起点）移到底部，AI 最新操作在顶部。视觉逻辑：顶部 = 最新 → 底部 = 起点，符合从结果向起因的阅读顺序。

### 🗑 Removed / 移除

- **Alias / Placeholder / Basis Tags / 别名类标签**:
  Removed the `Alias (别名)`, `Summary (摘要)`, `Generator (生成器)`, and `Dominant (主模型)` tags from timeline rows. These were legacy indicators from the era before GM provided exact model identification via `responseModel`. Since GM now reliably returns exact model names, these ambiguous "model basis" labels are no longer needed.
  移除时间线行上的"别名""摘要""生成器""主模型"标签。这些是 GM 引入精确 `responseModel` 之前的遗留指示器，现在 GM 已提供精确模型名称，这些模糊的"模型来源"标签不再需要。

### 🎨 Styles / 样式

- **Turn Group CSS / 轮次分组样式**:
  New `.act-tl-turn` / `.act-tl-turn-header` / `.seg-chip-*` CSS system with:
  - Smooth triangle arrow rotation (90° on open)
  - Green border highlight when expanded (`.act-tl-turn[open]`)
  - Hover background feedback
  - Full light theme (`body.vscode-light`) overrides for all 7 chip variants (`model`, `calls`, `tools`, `tok`, `cache`, `credits`, `dur`)
  
  新增可折叠分组 CSS 系统：平滑三角箭头旋转动画、展开态绿色边框高亮、hover 背景反馈，以及浅色主题下全部 7 种 chip 变体的完整适配。

- **Light Theme Fix / 浅色主题修复**:
  Fixed `seg-chip-dur` (duration) and `seg-chip-credits` being invisible on light backgrounds due to missing `body.vscode-light` overrides. Duration now uses `#334155` (dark slate), credits use `var(--lt-orange-text)`.
  修复浅色背景下耗时和积分 chip 不可见的问题，补全缺失的 light theme 覆盖。

### 📊 Stats / 统计

- **Files changed**: 2 (`activity-panel.ts`, `webview-styles.ts`)
- **TypeScript compile**: Zero errors
- **Net change**: ~+100 lines (CSS) / ~+60 lines (render logic) / −30 lines (removed alias tags)
---

## [1.15.3] - 2026-04-18

### 🔬 Breakthrough / 技术突破

- **Per-Step AI Response Extraction / 逐步 AI 回复提取**:
  Discovered that `GetCascadeTrajectory` endpoint's embedded GM data contains `messagePrompts` with complete conversation history, where each SYSTEM message carries a `stepIdx` field. Built a `stepIdx → AI snippet` mapping system that enables each GM call to display its **own** AI response text or tool calls, rather than sharing identical previews.
  发现 `GetCascadeTrajectory` 端点的嵌入式 GM 数据包含完整 messagePrompts，每条 SYSTEM 消息自带 `stepIdx` 字段。建立了 `stepIdx → AI 片段` 映射系统，使每个 GM 调用能显示**自己的** AI 回复文本或工具调用名称。

  **Data Pipeline**:
  ```
  GetCascadeTrajectory → embedded GM → messagePrompts (array[180+])
    → SYSTEM messages with { stepIdx, prompt, toolCalls }
    → extractAISnippetsByStep() → Record<stepIdx, snippet>
    → maybeEnrichCallsFromTrajectory() broadcasts to ALL calls
    → buildGMVirtualPreview() lookups by call.stepIndices
  ```

### ✨ Improved / 改进

- **GM Timeline Row Previews / GM 时间线行预览**:
  - AI text responses now show actual response content (e.g. "OK！", "读完了！v1.15.2...")
  - Tool-call-only steps show `🔧 view_file` instead of generic "GM 调用"
  - Combined steps show text + tool badge: `好的，让我看...  🔧grep_search`
  - Eliminated duplicate metrics in detail text (tokens/TTFT already shown as right-side chips)
  
  AI 文本回复现在显示实际内容，工具调用步骤显示 `🔧 工具名`，组合步骤同时显示文本和工具标记。消除了 detail 与右侧芯片的重复指标。

- **Data Model Upgrade / 数据模型升级**:
  `GMCallEntry.lastAISnippet: string` → `GMCallEntry.aiSnippetsByStep: Record<number, string>` — from single shared string to per-step indexed map, solving the "all rows show same text" problem.
  数据模型从单一共享字符串升级为逐步索引映射，解决了"所有行显示相同文本"的问题。

### 🔧 Tools / 工具

- **`gm-live-watcher.ts` v3**: Real-time GM call monitor with dual-endpoint cross-validation (`GetCascadeTrajectoryGeneratorMetadata` vs `GetCascadeTrajectory`). Displays per-call AI response (📝), thinking preview (🧠), and tool invocations (🔧). Key diagnostic tool for validating data pipeline changes.
  实时 GM 调用监控器，双端点交叉验证，显示每次调用的 AI 回复、思考预览和工具调用。验证数据管道变更的关键诊断工具。

### 📊 Stats / 统计

- **Files changed**: 3 (`gm-tracker.ts`, `activity-tracker.ts`, `diag-scripts/deep-dive/gm-live-watcher.ts`)
- **TypeScript compile**: Zero errors
- **Key discovery**: `GetCascadeTrajectoryGeneratorMetadata` has NO messagePrompts; only `GetCascadeTrajectory` embedded GM has them

---

## [1.15.4] - 2026-04-18

### 🏗 Refactored / 重构

- **GM Module Modularization / GM 模块化拆分**:
  Split `gm-tracker.ts` (1728 lines) into 5 focused sub-modules under `src/gm/`:
  将 `gm-tracker.ts`（1728 行）拆分为 `src/gm/` 下的 5 个专注子模块：

  | Module | Lines | Responsibility |
  |--------|:-----:|----------------|
  | `types.ts` | ~210 | 所有 GM 类型定义 + clone 工具 |
  | `parser.ts` | ~390 | 解析器 + 提取器 + 匹配/合并/增强 |
  | `summary.ts` | ~360 | 汇总构建 + 过滤 + 标准化 |
  | `tracker.ts` | ~500 | GMTracker 类核心 |
  | `index.ts` | ~50 | barrel re-export |

  Original `gm-tracker.ts` reduced to a ~40-line backward-compatible re-export shim.
  All 12 external import sites (`import { ... } from './gm-tracker'`) work unchanged.
  原 `gm-tracker.ts` 缩减为约 40 行的向后兼容 re-export，12 个外部 import 全部无需修改。

- **Interrupted Call Detection / 中断调用检测**:
  GM timeline rows for interrupted/cancelled calls (0 tokens in + 0 tokens out) now show `⚡ 已中断` instead of falling back to user message bubble or generic "GM 调用".
  中断/取消的 GM 调用现在显示 `⚡ 已中断`，而非回退到用户气泡或 "GM 调用"。

- **User Message Fallback Removed / 移除用户消息兜底**:
  GM rows no longer echo the user's input text as a fallback preview. GM rows should only display AI behavior (responses, tool calls, or status).
  GM 行不再将用户输入作为兜底预览，只显示 AI 行为。

- **Activity Module Modularization / Activity 模块化拆分**:
  Split `activity-tracker.ts` (2718 lines) into 3 focused sub-modules under `src/activity/`:
  将 `activity-tracker.ts`（2718 行）拆分为 `src/activity/` 下的 3 个专注子模块：

  | Module | Lines | Responsibility |
  |--------|:-----:|----------------|
  | `types.ts` | ~180 | 所有 Activity 类型定义 |
  | `helpers.ts` | ~280 | 工具函数（分类/提取/合并/预览构建） |
  | `tracker.ts` | ~2260 | ActivityTracker 类核心 |
  | `index.ts` | ~45 | barrel re-export |

  Original `activity-tracker.ts` reduced to a ~40-line backward-compatible re-export shim.
  All 4 external import sites (`import { ... } from './activity-tracker'`) work unchanged.
  原 `activity-tracker.ts` 缩减为约 40 行的向后兼容 re-export，4 个外部 import 全部无需修改。

### 📊 Stats / 统计

- **Files changed**: 4 (`gm-tracker.ts`, `activity-tracker.ts`, `docs/project_structure.md`, `CHANGELOG-v2.md`)
- **Files created**: 9 (`src/gm/{types,parser,summary,tracker,index}.ts`, `src/activity/{types,helpers,tracker,index}.ts`)
- **TypeScript compile**: Zero errors
- **Net LOC**: ~80 (2 re-export shims) replaces ~4446 (2 monoliths) — zero logic change

---

## [1.15.5] - 2026-04-18

### 🚀 Enhanced / 增强

- **GM-Driven Activity Classification / GM 驱动活动分类**:
  Replaced the blind `+N steps (estimated)` counters with precise GM-derived category counts.
  Each window-outside GM call is now classified into reasoning / toolCalls / errors / userInputs,
  feeding directly into `ModelActivityStats`. The status bar and activity panel now show real
  numbers instead of zeros for long conversations that exceed the ~500 Steps API window.
  用 GM 精确数据替代了空洞的"推算 +N 步"计数器。每个窗口外 GM 调用现在精确分类为
  推理/工具调用/错误/用户消息，直接写入 `ModelActivityStats`，状态栏和活动面板不再显示全零。

- **Timeline Retry / 429 Display / 时间线重试/429 显示**:
  Virtual GM timeline events now show retry and rate-limit information inline:
  `⚠️2×retry(429)` for rate-limited calls, `🔄1×retry` for other retries.
  GM 虚拟时间线事件现在内联显示重试和限流信息。

### 🐛 Fixed / 修复

- **Retry Count Inflation / 重试计数虚高**:
  `retryInfos` array always includes the successful attempt as its last entry (no error).
  The parser now only counts entries with actual error messages as retries, fixing the bug
  where every GM call showed `retries=1` even without any failures.
  `retryInfos` 数组始终将成功调用作为末尾 entry，解析器现在只计算有错误消息的 entry 为 retry。

- **Category Counter Inflation / 分类计数无限膨胀**:
  `_normalizeModelState()` was stripping `categoriesByModel` from `_windowOutsideAttribution`
  on every poll, causing the reconciliation to skip reversal of old categories and add full
  new categories each cycle — inflating reasoning/toolCalls/userInputs indefinitely.
  Fixed by preserving `categoriesByModel` during normalization.
  `_normalizeModelState()` 每次 poll 丢弃 `categoriesByModel`，导致分类计数无限叠加。
  修复：规范化时保留 `categoriesByModel`。

### 📊 Stats / 统计

- **Files changed**: 3 (`src/gm/parser.ts`, `src/activity/tracker.ts`, `src/extension.ts`)
- **TypeScript compile**: Zero errors
- **Key insight**: `retryInfos` always contains N+1 entries (N failures + 1 success)

---

## [1.15.6] - 2026-04-18

### 🏗 Refactored / 重构

- **Timeline Unification — GM-Only Truth / 时间线统一化 — GM 唯一事实源**:
  Replaced the dual Steps+GM event system with a single GM-driven timeline. All GM calls now generate virtual events covering the full conversation, not just the window-outside range. Steps API events with `stepIndex ≤ maxGMStep` are range-suppressed, eliminating all duplicates.
  用纯 GM 驱动的时间线替代了 Steps+GM 双事件系统。所有 GM 调用生成虚拟事件覆盖全量对话，范围抑制自动过滤 `stepIndex ≤ maxGMStep` 的 step-source 事件。

- **Right-Aligned Chip System — Two-Group Layout / 右对齐标签系统 — 双组布局**:
  Split right-side metadata into two independent flex containers:
  将右侧元数据拆为两个独立 flex 容器：

  | Group | CSS Class | Content | Alignment |
  |-------|-----------|---------|-----------|
  | **statusParts** | `.act-tl-gm-status` | retry, tools, TTFT, duration | 可选，左浮动 |
  | **tokenParts** | `.act-tl-gm` | 上下文, 输入, 输出, 缓存, 积分 | 固定，始终右对齐 |

  **statusParts order** (right→left): `duration → TTFT → 🔧tools → retry`
  **tokenParts order** (fixed): `Ctx → input → output → cache → credits`

  This ensures token columns stay vertically aligned across all rows, regardless of whether retry/tools/TTFT are present.
  确保 token 列在所有行间垂直对齐，不受 retry/工具/TTFT 有无影响。

### ✨ Improved / 改进

- **Context Chip Regrouped / 上下文标签归位**:
  Moved `上下文 138k` from `buildMetaTags` (separated, misaligned) into `tokenParts` as the first element (purple `.act-tl-gm-ctx` chip). Now vertically aligned with other token data.
  将上下文 chip 从 `buildMetaTags`（分离导致错位）移入 `tokenParts` 首位。

- **TTFT Labeled / TTFT 加标签**:
  Changed ambiguous `2.5s` to `TTFT 2.5s` to distinguish from step duration.
  从模糊的 `2.5s` 改为 `TTFT 2.5s`，与总耗时区分。

- **Retry Format / 重试格式**:
  Changed cryptic `r1` to human-readable `retry(1)` / `retry(1)⚠429`. Orange color for 429, red for other errors.
  从抽象的 `r1` 改为可读的 `retry(1)` / `retry(1)⚠429`，429 用橙色，其他用红色。

- **Turn Header Enhanced / 轮次标题增强**:
  - Tools: `🔧N` count → `🔧16 工具` (accumulated from all calls)
  - Added summary retry chip: `retry(5)⚠429`
  - Tokens split: `15.2k tok` → `8.5k 输入 / 2.0k 输出`

- **GM-STRUCT/GM-TEXT Tags Removed / 移除 GM 标签**:
  Stripped redundant source tags from timeline rows — GM is now the only source.

### 🐛 Fixed / 修复

- **Tool Name Extraction Bug / 工具名提取错误**:
  `buildGMVirtualPreview` was extracting tool names from `aiSnippetsByStep` `🔧` markers, which are **historical tool results in context** (dozens of tool definitions), not the **current call's tool invocations**. Fixed by computing tool count from `stepIndices.length - 1` (non-reasoning steps).
  `buildGMVirtualPreview` 从 snippet 的 🔧 标记提取工具名——这些是上下文中的**历史工具结果**（几十个），不是**当前调用的工具**。改为从 `stepIndices.length - 1` 计算工具数量。

- **Left-Side Tool Name Duplication / 左侧工具名重复**:
  When detail contained only tool names without `→` prefix, the left-side strip regex failed, showing raw tool names on both left and right. Fixed by always preserving the `→` prefix in `toolSuffix`.
  detail 只含工具名且无 `→` 前缀时，左侧 strip 失效导致工具名左右重复。修复：始终保留 `→` 前缀。

- **`gmRetryHas429` Structural Detection / 结构化 429 检测**:
  Added `gmRetryHas429: boolean` to `StepEvent`, populated from `retryErrors` array. Retry badge color now determined by structure, not by scanning detail text.
  新增 `gmRetryHas429` 字段，从 `retryErrors` 直接判断 429，不再依赖文本扫描。

### 🎨 Styles / 样式

- **New CSS classes / 新 CSS 类**:
  - `.act-tl-gm-status` — status chips container (flex, min-width 7em, right-justified)
  - `.act-tl-gm-ctx` — context window chip (purple: `#8b5cf6` light / `#a78bfa` dark)
  - `.act-tl-gm-retry429` — 429 rate-limit retry chip (orange)
  - `.seg-chip-retry` / `.seg-chip-retry429` — turn header retry chips

### 📊 Stats / 统计

- **Files changed**: 5 (`src/activity-panel.ts`, `src/activity/tracker.ts`, `src/activity/helpers.ts`, `src/activity/types.ts`, `src/webview-styles.ts`)
- **TypeScript compile**: Zero errors
- **Key architectural decision**: GM data as single source of truth; Steps API events serve only as fallback for the latest uncovered steps

---

## [1.15.7] - 2026-04-18

### ✨ Added / 新增

- **Context Checkpoint Viewer / 上下文检查点查看器**:
  New collapsible card section in the GM Data tab that renders the full content of system-injected `{{ CHECKPOINT N }}` compression summaries. Users can now read exactly what the AI "remembers" after context compression — making the previously opaque truncation process fully transparent.
  在 GM 数据标签页新增可折叠卡片区域，渲染系统注入的 `{{ CHECKPOINT N }}` 压缩摘要全文。用户现在可以直接阅读 AI 在上下文压缩后"记住"的内容，将原本不透明的截断过程完全透明化。

  **Data Pipeline / 数据管线**:
  ```
  GetCascadeTrajectory → embedded GM → messagePrompts
    → extractCheckpointSummaries() → GMCheckpointSummary[]
    → maybeEnrichCallsFromTrajectory() broadcasts to all calls
    → deduplicateCheckpoints() per conversation
    → buildCheckpointViewer() renders active conversation only
  ```

- **`GMCheckpointSummary` Type / 检查点类型**:
  New interface with `checkpointNumber`, `stepIndex`, `tokens`, and `fullText` fields, integrated into `GMCallEntry` and `GMConversationData`.
  新增接口，包含编号、步骤索引、token 数和全文字段，集成至 GM 调用和会话数据结构。

### ✨ Improved / 改进

- **Active Conversation Detection / 活跃对话检测**:
  Checkpoint viewer identifies the currently active conversation by finding the one with the most recent `createdAt` timestamp on its calls, rather than the highest step count. This ensures the viewer always displays checkpoints for the *running* conversation, not a historical one.
  检查点查看器通过最新 `createdAt` 时间戳定位当前活跃对话，而非最高步数，确保始终显示*正在运行的*对话的检查点。

- **Enrichment Trigger on Checkpoint / 检查点触发增强**:
  `shouldEnrichConversation()` now triggers full trajectory fetch when `checkpointIndex > 0` is detected, ensuring compressed conversations automatically receive their checkpoint summaries.
  检测到 `checkpointIndex > 0` 时自动触发完整轨迹拉取，确保压缩对话能获取到摘要数据。

- **Scroll State Preservation / 滚动状态保留**:
  Added `.cp-viewer` and `.cp-card-body` to the incremental refresh scroll-preservation system, preventing loss of reading position when the panel auto-refreshes.
  将检查点容器加入增量刷新的滚动保护机制，防止自动刷新时丢失阅读位置。

- **Badge Shows Compression Count / 徽章显示压缩次数**:
  Section badge displays `#N` (the checkpoint number) instead of card count, so users can see total compression count at a glance.
  区域徽章显示 `#N`（检查点编号）而非卡片数量，一眼可见总压缩次数。

### 🎨 Styles / 样式

- **Checkpoint Viewer CSS / 检查点查看器样式**:
  - `.cp-viewer` — amber-bordered scrollable container (max-height 400px) with thin custom scrollbar
  - `.cp-card` — collapsible `<details>` card with amber border, hover highlight
  - `.cp-card-header` — flex row with `📋 #N`, step/token chips
  - `.cp-card-body` — scrollable body (max-height 280px) with Markdown-like rendering (headings, bold, code)
  - `.cp-card-chip-step`, `.cp-card-chip-tok` — metadata chips (gray/amber)

### 🔬 Verified / 验证

- **Checkpoint Persistence Behavior**: Deep diagnostic script confirmed that the API (`GetCascadeTrajectory`) only retains `messagePrompts` on the **latest** GM entry. Older CHECKPOINT texts (1,2,3...) are absorbed into each subsequent compression — only the newest survives. This is by design, not a data loss bug.
  深度诊断脚本确认 API 仅为最后一个 GM 条目保留 `messagePrompts`。旧 CHECKPOINT 文本被后续压缩吸收，仅最新一条存活——这是设计行为，非数据丢失。

### 📊 Stats / 统计

- **Files changed**: 8 (`src/gm/types.ts`, `src/gm/parser.ts`, `src/gm/tracker.ts`, `src/gm/summary.ts`, `src/gm/index.ts`, `src/gm-tracker.ts`, `src/activity-panel.ts`, `src/webview-script.ts`)
- **TypeScript compile**: Zero errors
- **Net change**: +291 lines (data pipeline + UI + CSS)
- **Key discovery**: `messagePrompts` exists only on the last GM entry; `checkpointIndex` distribution records compression history

---

## [1.15.8] - 2026-04-20

### 🏗 Refactored / 重构

- **Lossy Persistence — Slim-on-Write Architecture / 有损持久化 — 写盘瘦身架构**:
  Implemented a "slim-on-write" strategy that strips heavy, redundant metadata from GM and Activity data **only** at the serialization boundary (before writing to disk). Runtime memory remains fully intact — all stripped fields are dynamically re-fetched from the LS API on next poll cycle.
  实现了"写盘瘦身"策略：仅在序列化边界（写盘前）剥离 GM 和 Activity 数据中的重型冗余元数据。运行时内存完全不受影响——所有剥离字段在下次 poll 时从 LS API 动态重新填充。

  **State file size reduction / 状态文件瘦身效果**:
  - Before: ~245 MB (6670+ GM calls with full chat history, prompts, tool lists, token trees)
  - After: ~1 MB (structural stats only: token counts, credits, timestamps, step indices)

  **Layer 1 — GM Summary Slim / GM 汇总瘦身** (`gm/types.ts`):
  Three new persistence helpers strip heavy fields from `GMCallEntry` and `GMSummary`:
  
  | Function | Strips |
  |----------|--------|
  | `slimCallForPersistence()` | `promptSnippet`, `aiSnippetsByStep`, `checkpointSummaries`, `systemPromptSnippet`, `userMessageAnchors.text`, `tokenBreakdownGroups`, `tools`, `retryErrors` |
  | `slimSummaryForPersistence()` | Applies `slimCallForPersistence()` to all calls in all conversations |
  | `slimConversationForPersistence()` | Applies to a single conversation's calls |

  **Layer 2 — Activity Timeline Slim / 活动时间线瘦身** (`activity/helpers.ts`):
  
  | Function | Strips |
  |----------|--------|
  | `slimStepEventForPersistence()` | `fullUserInput`, `fullAiResponse`, `gmPromptSnippet`, `browserSub`; truncates `userInput`/`aiResponse`/`detail` to 40/60/80 chars |

  Applied in `ActivityTracker.serialize()` to both `summary.recentSteps` and all `archives[].recentSteps`.

  **Persistence Points Updated / 持久化点位更新**:
  - `extension.ts`: Centralized all 5 `gmDetailedSummary` writes into `persistGMSummaryToFile()` helper
  - `monitor-store.ts`: GM conversations slimmed via `slimConversationForPersistence()` before workspace state write
  - `activity/tracker.ts`: `serialize()` applies `slimStepEventForPersistence()` to all timeline events and archives

### ✨ Improved / 改进

- **Settings Storage Diagnostics Redesign / 设置页存储诊断重新设计**:
  Replaced 11 confusing internal metrics (Monitor Sessions, GM Snapshots, GM Conversations, Quota History, Price Overrides, Open Warn At...) with 9 user-meaningful stats:
  替换了 11 个意义不明的内部指标为 9 个用户可理解的统计：

  | Stat | Description |
  |------|-------------|
  | File Size / 文件大小 | Current state file size |
  | GM Calls (Cycle) / GM 调用 (周期) | LLM invocations in current quota period |
  | Input Tokens / 输入 Tokens | Total input tokens this cycle |
  | Output Tokens / 输出 Tokens | Total output tokens this cycle |
  | Credits Used / 已用积分 | Credits consumed this cycle |
  | Est. Total Cost / 估算总费用 | All-time cost: archived cycles (dailyStore) + current cycle (pricingStore) |
  | Quota Resets / 额度重置次数 | Number of historical quota reset archives |
  | Calendar Days / 日历天数 | Days with recorded data |
  | Calendar Cycles / 日历周期 | Total archived quota cycles across all days |

- **All-Time Cost Calculation / 累计总费用计算**:
  New `computeAllTimeCost()` sums all `estimatedCost` from every archived cycle in `dailyStore` plus the current in-progress cycle's live cost from `pricingStore.calculateCosts()`.
  新增累计费用计算：遍历日历所有归档周期费用 + 当前进行中周期的实时费用。

- **File Stat Error Handling / 文件状态错误处理**:
  Wrapped `fs.statSync()` in try-catch in both `getStorageDiagnostics()` and `refreshLocalStorageDiagnostics()` to prevent crashes when the state file is temporarily locked or inaccessible.
  为文件大小读取添加异常保护，防止状态文件临时锁定时崩溃。

### 🐛 Fixed / 修复

- **Test Fixture Missing Fields / 测试夹具缺失字段**:
  `activity-tracker.test.ts` fixtures were missing `aiSnippetsByStep` and `checkpointSummaries` fields (added in v1.15.3/v1.15.7), causing `Object.keys(undefined)` crashes in `buildGMVirtualPreview()`. Added empty defaults to all test GM call fixtures.
  测试夹具缺少 v1.15.3/v1.15.7 新增字段，导致 `buildGMVirtualPreview()` 崩溃。

### 🗑 Removed / 移除

- **`webview-settings-tab.test.ts`**: Removed trivial UI snapshot test — the settings tab HTML is simple enough to validate visually.
  移除简单的 UI 快照测试。

### 📊 Stats / 统计

- **Files changed**: 9 (`src/gm/types.ts`, `src/gm/index.ts`, `src/gm-tracker.ts`, `src/extension.ts`, `src/monitor-store.ts`, `src/activity/helpers.ts`, `src/activity/tracker.ts`, `src/webview-settings-tab.ts`, `src/webview-panel.ts`)
- **Tests deleted**: 1 (`webview-settings-tab.test.ts`)
- **Tests fixed**: 2 (activity-tracker fixture + expectation updates)
- **Final test count**: 149 tests across 13 files — all passing
- **TypeScript compile**: Zero errors
- **Key architectural decision**: Lossy persistence is safe because all text content is re-fetched from API within 5 seconds of startup; only structural/statistical data needs to survive restarts

---

## [1.15.10] - 2026-04-20

### 🏗 Refactored / 重构

- **每日归档架构重构 / Daily Archival Architecture**:
  将归档触发机制从复杂的「池级额度重置回调」彻底切换为简洁的「基于日期的每日归档」。系统不再依赖 `onQuotaReset` 回调进行分池归档，改为在每次轮询中检测本地日期变化，日期滚动时自动归档前一天的所有数据并全局重置 Tracker。
  Replaced the complex per-pool quota-reset callback archival with a streamlined daily date-based archival. The system no longer depends on `onQuotaReset` for per-pool archiving; instead, it detects local date changes on each poll and automatically archives the previous day's data with a global tracker reset.

  **架构变更 / Architecture changes**:
  
  | 组件 / Component | 变更 / Change |
  |---|---|
  | `daily-archival.ts` | **新增** — 可测试纯函数模块，所有依赖通过 `DailyArchivalContext` 注入，时间通过 `now` 参数可控 |
  | `extension.ts` | `performDailyArchival()` 改为委托调用；`onQuotaReset` 瘦身为仅日志记录 |
  | `daily-store.ts` | 新增 `addDailySnapshot()` 每日单快照接口；移除 `importArchives()` 和 `backfilled` 标志 |
  | `activity/tracker.ts` | `archiveAndReset()` 删除池级过滤分支（-145 行），仅保留全局重置 |
  | `gm/tracker.ts` | `reset()` 删除 per-pool 分支（-26 行），仅保留全局重置 |
  | `gm/summary.ts` | `filterGMSummaryByModels()` 移除 `accountEmail` 参数 |
  
  **归档触发规则 / Trigger rules**:
  - 首次运行：记录当前日期，不归档
  - 同日重复调用：无操作
  - 日期滚动（如 23:59→00:00）：归档昨日数据，重置 Tracker
  - Force 模式：跳过日期检查（dev 模拟按钮用）
  - 无数据日：跳过 DailyStore 写入，仍更新日期

### ✨ Improved / 改进

- **日历 UI 简化 / Calendar UI Simplification**:
  移除多 cycle 折叠逻辑（`<details>` + 独立周期卡片），每天只显示一个聚合快照视图。高亮条件从 `cycleCount > 2` 改为 `totalCost > 0.5`。
  Removed multi-cycle collapsible details; each day now shows a single aggregated snapshot. High-activity highlight changed from cycle count to cost threshold.

- **Settings 文案更新 / Settings Copy Update**:
  「模拟额度重置」→「模拟每日归档」；「额度重置次数」→「归档天数」；所有描述文案同步更新。
  "Simulate Quota Reset" → "Simulate Daily Archival"; "Quota Resets" → "Archival Days"; all description copy updated.

- **存储诊断修正 / Storage Diagnostics Fix**:
  `quotaResetCount` 数据源从 `lastArchives.length` 修正为 `lastDailyStore.totalDays`。
  Fixed `quotaResetCount` data source from archive count to daily store day count.

### 🗑 Removed / 移除

- **池级归档逻辑 / Per-Pool Archival Logic**:
  移除 `ActivityTracker.getCurrentStepCountForModels()`、`archiveAndReset()` 的 modelIds 参数、`GMTracker.reset()` 的 modelIds 参数、`filterGMSummaryByModels()` 的 accountEmail 参数。
  Removed pool-scoped archival methods and parameters that are no longer needed.

- **旧版 barrel export**:
  从 `activity/index.ts` 和 `activity-tracker.ts` 移除不再使用的 `sameTriggeredByScope` 导出。
  Removed unused `sameTriggeredByScope` export from barrel files.

- **`daily-archival-refactor-plan.md`**: 计划文档已完成，删除。

### 🧪 Tests / 测试

- **`daily-archival.test.ts`**: 新增 13 个测试用例覆盖 `toLocalDateKey`（日期格式化、跨年、零填充）和 `performDailyArchival`（首次运行、同日、日期滚动、无数据、多日间隔、force、连续天数、23:59→00:00 午夜边界、无 DailyStore 容错）。
  13 new test cases covering date formatting, rollover detection, midnight boundary, force mode, and error resilience.

- **`daily-store.test.ts`**: 重写为 `addDailySnapshot` 测试（5 用例：写入与替换、无 GM、旧版 addCycle 兼容、序列化往返、clear）。
  Rewritten with 5 test cases for `addDailySnapshot`.

- **`activity-tracker.test.ts`**: 更新 `archiveAndReset()` 调用，移除不再需要的 modelIds 参数。

### 📊 Stats / 统计

- **Files changed**: 11 (`src/daily-archival.ts` [new], `src/extension.ts`, `src/daily-store.ts`, `src/activity/tracker.ts`, `src/gm/tracker.ts`, `src/gm/summary.ts`, `src/webview-calendar-tab.ts`, `src/webview-settings-tab.ts`, `src/webview-panel.ts`, `src/activity/index.ts`, `src/activity-tracker.ts`)
- **Tests changed**: 3 (`tests/daily-archival.test.ts` [new], `tests/daily-store.test.ts` [rewritten], `tests/activity-tracker.test.ts` [updated])
- **Final test count**: 166 tests across 14 files — all passing
- **TypeScript compile**: Zero errors
- **Key architectural decision**: Daily time-based archival replaces event-driven per-pool archival; testability achieved through dependency injection and injectable time

---

## [1.15.9] - 2026-04-20

### ✨ Added / 新增

- **Multi-Account Status Panel / 多账号状态面板**:
  在 GM Data 标签页顶部新增多账号状态面板。每次 `fetchFullUserStatus` 成功后，自动从 `email` + `ModelConfig.quotaInfo.resetTime` 提取账号快照，按 email 存入 `Map<email, AccountSnapshot>` 并持久化至 `state-v1.json`。切换账号时，旧账号快照保留为「已缓存」状态，新账号标记为「在线」。
  New multi-account status panel at the top of the GM Data tab. On each successful `fetchFullUserStatus`, the current account's snapshot is upserted into a `Map<email, AccountSnapshot>` and persisted to `state-v1.json`. When switching accounts, the previous account remains as "cached" while the new one is marked "active".

  | 字段 / Field | 说明 / Description |
  |---|---|
  | 在线指示灯 / Active indicator | 绿色脉动 = 在线；灰色 = 已缓存 |
  | Plan 徽章 / Plan badge | Pro (蓝) / Ultra (紫) / Team (绿) / Free (灰) |
  | 模型池倒计时 / Per-pool countdown | 每个额度池独立倒计时，显示池内模型标签 |
  | 到期提示 / Expiry label | 倒计时到期后显示红色「已就绪」 |
  | 预警 / Warning | 倒计时 < 30 分钟时变黄色 |

- **Per-Pool Model Countdown / 按模型池独立倒计时**:
  新增 `ResetPool` 类型，每个池记录 `resetTime` + `modelLabels[]`。账号卡片右侧按池分行显示模型标签芯片和独立倒计时，而非单一笼统时间。例如：Claude + GPT 共享一个池，Gemini Pro 独立一个池，Gemini Flash 又是单独的池——各自显示独立的重置倒计时。
  New `ResetPool` type with `resetTime` + `modelLabels[]`. Each account card shows per-pool rows with model chips and independent countdowns. Models sharing the same `quotaInfo.resetTime` are automatically grouped into one pool — no hardcoded rules.

- **Cached Account Reset Notification / 缓存账号额度重置通知**:
  新增 `checkCachedAccountResets()`，在每次轮询中自动检查非在线缓存账号的额度池是否已重置。到期时弹出一次性 VS Code 通知：`✅ Night Min: Claude 3.5 Sonnet, GPT-4o 额度已重置，可以切换到该账号了。` 附带「打开监控」按钮。通过 `email:resetTime` 去重，每个重置事件只通知一次，无需额外设置。
  New `checkCachedAccountResets()` checks all cached accounts' quota pools on every poll cycle. When a pool expires, a one-time VS Code notification prompts the user to switch accounts. Deduplication via `email:resetTime` key ensures no spam.

### 🏗 Technical / 技术细节

- **Data Flow / 数据流**:
  ```
  fetchFullUserStatus() → userInfo.email + configs[].quotaInfo.resetTime
    → updateAccountSnapshot()
      → poolMap: Map<resetTime, modelLabels[]>
      → AccountSnapshot { email, name, planName, resetPools, isActive, lastSeen }
      → persistAccountSnapshots() → durableFileGlobalState → state-v1.json
    → PanelPayload.accountSnapshots → buildGMDataTabContent()
      → buildAccountStatusPanel() → per-pool HTML with countdowns
  ```

- **New Types / 新增类型** (`activity-panel.ts`):
  - `ResetPool { resetTime: string; modelLabels: string[] }`
  - `AccountSnapshot { email, name, planName, tierName, earliestResetTime, allResetTimes, resetPools, isActive, lastSeen }`

- **Persistence Key / 持久化键**: `durableFileGlobalState → 'accountSnapshots'` (Array\<AccountSnapshot\>)

### 🎨 Styles / 样式

- **Account Status Panel CSS / 账号状态面板样式**:
  - `.acct-panel` / `.acct-panel-header` — 容器 + 标题栏
  - `.acct-card` — 账号行（flex 布局，hover 反馈）
  - `.acct-indicator-active` — 绿色脉动动画 (`@keyframes acctPulse`)
  - `.acct-indicator-cached` — 灰色静态
  - `.acct-plan-pro/free/ultra/team` — Plan 徽章 4 色系
  - `.acct-pools` / `.acct-pool-row` / `.acct-pool-model` — 模型池布局 + 模型标签芯片
  - `.acct-reset-countdown-warn` — 黄色 (<30min)
  - `.acct-reset-countdown-expired` — 红色 (已到期)

### 📊 Stats / 统计

- **Files changed**: 3 (`src/extension.ts`, `src/activity-panel.ts`, `src/webview-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Net change**: ~280 lines added (types + snapshot management + UI + CSS + notification)
- **No settings required**: Account reset notifications work automatically with zero configuration

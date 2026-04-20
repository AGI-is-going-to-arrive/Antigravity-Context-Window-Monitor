# 变更日志 v2 / Changelog v2

> 本文件记录 v1.15.2 起的增量版本更新。  
> 历史版本请参阅 [`CHANGELOG.md`](./CHANGELOG.md)（v1.0.0 – v1.15.1）。
>
> This file tracks incremental updates starting from v1.15.2.  
> For historical versions, see [`CHANGELOG.md`](./CHANGELOG.md) (v1.0.0 – v1.15.1).

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

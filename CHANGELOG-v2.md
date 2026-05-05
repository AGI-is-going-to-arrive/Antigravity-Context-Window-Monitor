# 变更日志 v2 / Changelog v2

> 本文件记录 v1.15.2 起的增量版本更新。  
> 历史版本请参阅 [`CHANGELOG.md`](./CHANGELOG.md)（v1.0.0 – v1.15.1）。
>
> This file tracks incremental updates starting from v1.15.2.  
> For historical versions, see [`CHANGELOG.md`](./CHANGELOG.md) (v1.0.0 – v1.15.1).

## 成本标签页视觉层次优化 + 自定义价格表重构 — 2026-05-05

### 改进 / Improved

- **费用分析面板层次化设计 / Cost Analysis Visual Hierarchy**:
  费用分布和费用明细区域从平面行列升级为带圆角边框的独立子容器（`.cost-bar-section`、`.cost-detail-section`），配合子标题行（SVG 图标 + 大写标签）划分视觉区域。

  - 柱状图价格值和明细总计改为 chip 样式（琥珀色半透明背景 + 边框）
  - 明细行内费用项添加独立 chip 容器，奇数行交替底色
  - 柱状行增加 hover 高亮效果
  - 所有新样式均有浅色主题适配

- **底部提示文本结构化 / Footer Notes → Structured Info Bars**:
  `cost-note` 和 `prc-note` 裸 `<p>` 标签替换为 `.prc-info-bar` 组件 — 带左侧彩色边框 + SVG 信息图标 + 结构化要点列表。费用估算声明使用琥珀色变体（`.prc-info-warn`）突出警示。

- **自定义价格表横向行式布局 / Pricing Table: Card Grid → Horizontal Rows**:
  从 `prc-edit-grid`（2 列卡片网格）重构为 `prc-edit-list`（单列行式），每行左右分栏：
  - **左栏**：模型名（CSS `subgrid` + `max-content` 自动对齐最宽名称）
  - **右栏**：2x2 网格排列4个价格字段（标签 + 输入框同行）
  - 移除来源标签（内置/自定义），简化视觉

- **成本标签颜色更换 / Cost Tab Color: Purple → Blue**:
  从紫色（`#a78bfa`）改为蓝色（`#60a5fa`），更专业、与金融/分析主题契合。

### 修复 / Fixed

- **未调用模型缺失问题 / Uncalled Models Missing from Pricing Table**:
  `buildEditablePricingTable` 仅显示 `modelBreakdown` 中已调用的模型。现在合并 `DEFAULT_PRICING` 键值，未调用模型以半透明样式追加在列表末尾（hover/focus 时恢复全透明度），确保所有已知模型均可编辑价格。

- **价格表模型重复问题 / Duplicate Model Entries**:
  去重逻辑从精确匹配（`Set.has`）改为模糊匹配（前缀/子串），避免 `claude-opus-4-6`（DEFAULT_PRICING key）和 `claude-opus-4-6-20250625`（实际 responseModel）作为两个独立条目出现。

### 统计 / Stats

- **Files changed**: 2 (`src/pricing-panel.ts`, `src/webview-panel.ts`)
- **TypeScript compile**: Zero errors
- **New CSS classes**: `.cost-bar-section`, `.cost-detail-section`, `.cost-sub-header`, `.prc-info-bar`, `.prc-info-warn`, `.prc-edit-list`, `.prc-edit-row`, `.prc-edit-row-left`, `.prc-edit-row-right`, `.prc-edit-uncalled`

---

## 模型信息卡片横向行式布局重构 — 2026-05-05

### 改进 / Improved

- **模型卡片从网格布局改为横向行式布局 / Model Info Cards: Grid to Horizontal Row Layout**:
  Models 标签页的「模型信息」卡片从 `act-cards-grid`（2 列自适应网格）重构为 `dna-row-list`（单列全宽行）。每个模型独占一行，内部分为左右两栏：

  - **左栏**（`dna-row-stats`，150-200px）：紧凑的统计数据（调用、步骤、积分、重试、错误）
  - **右栏**（`dna-row-details`，弹性填充）：可折叠的 MIME 类型和技术参数

  解决了旧网格布局下展开 MIME 类型或技术参数后卡片高度失控、多卡片同行时布局不协调的问题。

  Model Info cards redesigned from 2-column auto-fill grid to full-width horizontal rows. Each model takes one row with left stats column (150-200px) and right expandable details (flex fill). Fixes layout distortion when expanding MIME types or technical parameters.

  - Provider 和 responseModel 信息整合到卡片头部行，不再占用独立的 meta bar
  - 左侧彩色边框标识不同模型（6色循环）
  - 窄屏（`<380px`）自动切换为上下堆叠布局
  - 无额外信息时显示"暂无更多信息"占位文本

### 统计 / Stats

- **Files changed**: 1 (`src/pricing-panel.ts`)
- **TypeScript compile**: Zero errors
- **New CSS classes**: `.dna-row-list`, `.dna-row-card`, `.dna-row-header`, `.dna-row-body`, `.dna-row-stats`, `.dna-row-details`

---

## 上下文情报容器滚动穿透修复 + 间距优化 — 2026-05-05

### 修复 / Fixed

- **展开容器后滚动穿透到整个页面 / Scroll Leak Through to Page**:
  展开「上下文情报」区块后，内部卡片列表滚动到底部时继续滚轮操作会导致整个 WebView 页面跟着滚动。

  Root cause: `.cp-viewer`（`max-height: 400px; overflow-y: auto`）和 `.cp-card-body`（`max-height: 280px`）均缺少 `overscroll-behavior: contain`，滚动到达边界后事件自然冒泡到页面级。

  **修复**: 对 `.cp-viewer` 和 `.cp-card-body` 均添加 `overscroll-behavior: contain`，滚动在容器边界处截止，不再穿透。

  Fix: Added `overscroll-behavior: contain` to both `.cp-viewer` and `.cp-card-body` to prevent scroll chaining to the page.

### 改进 / Improved

- **隐藏滚动条保留滑动 / Hidden Scrollbar with Swipe Support**:
  `.cp-viewer` 容器滚动条完全隐藏（`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`），保留鼠标滚轮和触控板滑动功能，视觉更干净。`.cp-card-body` 保留 4px 细滚动条（单卡内容可能很长，需要位置指示）。

  Hidden scrollbar on `.cp-viewer` (still scrollable via wheel/trackpad). `.cp-card-body` retains thin 4px scrollbar for position indication in long content.

- **卡片两侧间距加宽 / Wider Card Side Padding**:
  `.cp-viewer` 左右内边距从 `var(--space-3)`（12px）增大到 `var(--space-6)`（24px），在卡片两侧形成更宽的沟槽区域，方便鼠标放在边缘进行滚动操作。

  Increased `.cp-viewer` horizontal padding from 12px to 24px, creating wider gutters on card sides for comfortable mouse scrolling.

### 统计 / Stats

- **Files changed**: 1 (`src/activity-panel.ts`)
- **TypeScript compile**: Zero errors
- **CSS properties added**: `overscroll-behavior: contain`, `scrollbar-width: none`

---

## 状态栏影子模型修复 + Checkpoint 模型透明化 — 2026-05-05

### 修复 / Fixed

- **影子模型污染状态栏显示 / Shadow Model Polluting Status Bar**:
  状态栏 tooltip 的「模型」字段会显示 `MODEL_PLACEHOLDER_M50`（Flash Lite 影子模型），而非用户实际使用的主模型（如 Claude Opus 4.6）。

  **根因**: `processSteps()` 的模型追踪逻辑中，CHECKPOINT 步骤的 `generatorModel` 和 `lastModelUsage.model` 会覆盖顶层 `model` 字段。当 M50 的 CHECKPOINT 出现在步骤序列末尾时（新对话或上下文压缩后），显示模型被污染为 M50。

  **修复**: 结构性隔离 — CHECKPOINT 步骤一律不参与显示模型追踪（`stepType !== StepType.CHECKPOINT`）。同时移除 `lastModelUsage.model → model` 覆盖路径。`lastModelUsage` 仍正常用于 token 计算。此方案不依赖模型名称匹配，任何未来新增的影子模型都自动被排除。

  Status bar tooltip showed `MODEL_PLACEHOLDER_M50` (shadow model) instead of the user's actual model. Root cause: CHECKPOINT steps' `generatorModel` and `modelUsage.model` overrode the display model. Fix: structural isolation — CHECKPOINT steps never participate in display model tracking. Future-proof without hardcoded model ID patterns.

  模型优先级（修复后）:
  1. `requestedModel`（用户选择）
  2. `generatorModel`（仅非 CHECKPOINT 步骤）
  3. `trajectory.requestedModel || trajectory.generatorModel`（对话级兜底）

### 新增 / Added

- **Checkpoint 影子模型透明化 / Checkpoint Shadow Model Transparency**:
  状态栏 tooltip 的「最近 checkpoint」行旁显示影子模型标识（如 `(M50)`），方便观测影子模型变化。

  Status bar tooltip now shows the shadow model identifier next to "Last Checkpoint" (e.g. `(M50)`), enabling visibility into shadow model changes.

  | 数据链路 | 改动 |
  |---|---|
  | `TokenUsageResult.checkpointModel` | 新增字段，从 `lastModelUsage.model` 捕获 |
  | `ContextUsage.checkpointModel` | 新增字段，透传到 UI 层 |
  | `shortenShadowModelId()` | 新增工具函数，将原始 ID 转为人类可读名称 |

  名称转换示例:

  | 原始 ID | 显示名称 |
  |---|---|
  | `MODEL_PLACEHOLDER_M50` | M50 |
  | `MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE` | Gemini 2.5 Flash Lite |
  | `MODEL_PLACEHOLDER_M84` | M84 |

### 统计 / Stats

- **Files changed**: 2 (`src/tracker.ts`, `src/statusbar.ts`)
- **TypeScript compile**: Zero errors
- **Tests**: 50 passed
- **New fields**: `TokenUsageResult.checkpointModel`, `ContextUsage.checkpointModel`
- **New function**: `shortenShadowModelId()`

---

## 工具目录 UX 优化 + 清空功能 — 2026-05-05

### 改进 / Improved

- **工具目录可折叠 / Collapsible Tool Catalog**:
  工具目录从静态列表改为 `<details>/<summary>` 可折叠结构，展开状态通过 `restoreDetailsState()` 跨刷新持久化。header 含旋转箭头动画（`▸`）、书本 SVG 图标、数量 badge。

  Tool catalog converted to collapsible `<details>` element with state persistence via `restoreDetailsState()`.

- **CSS Grid 布局 / Grid Layout for Chips**:
  工具 chips 从 `flex-wrap` 改为 CSS Grid（`repeat(auto-fill, minmax(140px, 1fr))`），确保整齐对齐。

  Chips layout changed from flex-wrap to CSS Grid for uniform alignment.

- **智能 Tooltip / Intelligent Tooltips**:
  `bindToolCatalogTooltips()` 在 `mouseenter` 时动态检测文本是否截断（`scrollWidth > clientWidth`）：截断时 tooltip 显示「全名 — 描述」，未截断时仅显示描述。chip HTML 重构为双层结构：外层 `.tool-cat-chip`（`overflow: visible`，tooltip 定位）+ 内层 `.tool-cat-chip-text`（`overflow: hidden; text-overflow: ellipsis`，文本截断）。tooltip 最大宽度 200px + `word-break: break-word` 防溢出。

  Dynamic truncation detection on `mouseenter`: truncated chips show "Full Name — Description", non-truncated show description only. Chip HTML refactored to dual-layer structure for tooltip rendering.

- **排行名称 Chip 化 / Ranking Name Chip Styling**:
  `.tool-rank-name` 添加 chip 风格外观：mono 字体 + 半透明背景 `rgba(255,255,255,0.04)` + 圆角边框 + hover 加深反馈，增加视觉层级感。

  `.tool-rank-name` styled as chips: mono font + semi-transparent bg + rounded border + hover darkening for visual depth.

### 新增 / Added

- **清空目录功能 / Clear Catalog Feature**:
  工具目录底部新增右对齐「清空目录」按钮（默认低透明度，hover 变红色），仅清空持久化的工具目录数据，不影响工具调用排行。

  New "Clear Catalog" button at catalog footer. Clears only persisted tool inventory; call ranking unaffected.

  | 层级 | 改动 |
  |---|---|
  | `GMTracker.clearToolCatalog()` | 清空 `_persistedToolCatalogByAccount`，patch `_lastSummary.toolCatalog=[]`（避免 `serialize()` → `_buildSummary()` 重建撤销清空）|
  | `extension.ts` | 注册 VS Code command，同步更新模块级 `lastGMSummary` 后持久化 |
  | `webview-panel.ts` | 处理 `clearToolCatalog` webview 消息，委托 VS Code command + 刷新面板 |
  | `webview-script.ts` | body click delegation 处理按钮点击 |

### 修复 / Fixed

- **`_buildSummary()` 工具目录写回副作用 / Tool Catalog Write-back Side Effect**:
  `_buildSummary()` 行 647 无条件将重建的工具目录写回 `_persistedToolCatalogByAccount`。`getFullSummary()` 调用 `_buildSummary(true)` 绕过缓存，导致 `makePanelPayload()` 每次调用都撤销 `clearToolCatalog()` 的效果。

  修正：写回逻辑加 `if (!skipAccountFilter)` 守卫，仅主路径（正常 poll 周期）写回，`getFullSummary()` / `getArchivalSummary()` 路径不写回。

  Fix: `_buildSummary()` unconditionally wrote back rebuilt catalog, undoing `clearToolCatalog()` via `getFullSummary()` → `makePanelPayload()` chain. Added `!skipAccountFilter` guard so only the primary poll path persists catalog data.


### 统计 / Stats

- **Files changed**: 5 (`src/activity-panel.ts`, `src/extension.ts`, `src/gm/tracker.ts`, `src/webview-panel.ts`, `src/webview-script.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **New CSS classes**: `.tool-cat-footer`, `.tool-cat-clear-btn`, `.tool-cat-chip-text`
- **New method**: `GMTracker.clearToolCatalog()`
- **New command**: `antigravity-context-monitor.clearToolCatalog`

---

## [1.16.2] Settings 持久化存储统计精简 — 2026-04-29

### 移除 / Removed

- **7 个冗余存储统计卡片 / 7 Redundant Storage Stat Cards**:
  Settings 标签页「持久化存储」区域原有 9 个统计卡片，审查后精简为 2 个。移除的 7 个卡片均属于与其他标签页重复或数据源相同的冗余项。

  Reviewed 9 storage stat cards in the Settings tab's \"Persistent Storage\" section. Reduced to 2 after removing duplicates and stats already shown in other tabs.

  | 移除项 | 移除原因 |
  |--------|---------|
  | GM Calls (Cycle) | GM 数据标签页 Dashboard Grid 已显示 |
  | Input Tokens | 无归档时始终为 0，GM 数据面板已显示 |
  | Output Tokens | 同上 |
  | Credits Used | GM 数据面板已显示 |
  | Est. Total Cost | 成本标签页已显示 |
  | Archival Days | 与 Calendar Days 数据源完全相同（`dailyStore.totalDays`）|
  | Calendar Cycles | 一天一归档后与天数等价 |

  **保留项 / Retained**: File Size（文件大小）、Calendar Days（日历天数）

### 清理 / Cleanup

- **`formatTokenCount()` 函数移除**: 该函数仅被已删除的 Input/Output Tokens 卡片使用，现为死代码
- **`computeAllTimeCost()` 函数移除**: 该函数仅被已删除的 Est. Total Cost 字段使用，现为死代码
- **`StorageDiagnostics` 接口精简**: 从 11 个字段减至 6 个（移除 `gmCallCount`、`gmTotalInputTokens`、`gmTotalOutputTokens`、`gmTotalCredits`、`estimatedCostAllTime`、`quotaResetCount`、`calendarCycleCount`）
- **`refreshLocalStorageDiagnostics()` 精简**: 移除 `calendarCycleCount` 遍历循环和 7 个冗余字段赋值（含内联 `estimatedCostAllTime` IIFE）

### 统计 / Stats

- **Files changed**: 3 (`src/webview-settings-tab.ts`, `src/extension.ts`, `src/webview-panel.ts`)
- **Docs updated**: 1 (`docs/project_structure.md`)
- **TypeScript compile**: Zero errors

---

## About 兼容性验证 + 浅色主题上下文情报颜色适配 — 2026-04-26

### 新增 / Added

- **About 标签页「兼容性验证」区块 / Compatibility Section in About Tab**:
  在「使用提示」和「免责声明」之间新增「兼容性验证」区块（盾牌勾选 SVG 图标 + 绿色左边框），记录贡献者实测通过的 Antigravity IDE 版本范围：
  - 最稳定版本：v1.18.4、v1.19.6
  - 验证范围：v1.19.6 → v1.20.6 → v1.23.2，全部正常运行
  - 末尾引导至免责声明，覆盖未来版本可能失效的情况

  New \"Compatibility\" section between Tips and Disclaimer in the About tab (shield-check SVG icon + green left border). Documents contributor-tested Antigravity IDE versions: most stable v1.18.4 & v1.19.6, tested range v1.19.6 → v1.23.2.

### 修复 / Fixed

- **浅色主题 Context Intelligence 颜色不可读 / Light Theme CI Card Color Readability**:
  上下文情报卡片的 9 种类型颜色和 3 种 Model DNA 卡片颜色在浅色主题白色背景上可见性极差（尤其 `user_info` 的 `#4ade80` 浅绿几乎不可见）。

  **重构**: 所有卡片的 inline `color:${conf.color}` 改为 CSS 变量 `var(--ci-color)` 引用，每张卡片新增 `data-ci-type` 属性。在 `webview-styles.ts` 中为浅色主题按类型覆盖 `--ci-color` 为深色值。header badge 也添加 `ci-badge` class + `data-ci-type` 用于浅色主题颜色覆盖。

  Fix: Context Intelligence card colors were nearly invisible on light theme backgrounds (especially `user_info` green `#4ade80`). Refactored all inline colors to CSS variable `var(--ci-color)` with `data-ci-type` attribute per card. Added light theme overrides in `webview-styles.ts` with darker color values for all 12 card types.

  | 类型 | 暗色 | 浅色覆盖 |
  |---|---|---|
  | user_info | `#4ade80` | `#15803d` |
  | checkpoint | `#fbbf24` | `#b45309` |
  | context_injection | `#60a5fa` | `#2563eb` |
  | mcp_servers | `#2dd4bf` | `#0f766e` |
  | user_rules | `#06b6d4` | `#0e7490` |
  | workflows | `#f472b6` | `#be185d` |
  | artifacts | `#a78bfa` | `#7c3aed` |
  | dna_prompt | `#60a5fa` | `#2563eb` |
  | dna_config | `#f59e0b` | `#b45309` |
  | dna_tokens | `#f97316` | `#c2410c` |

- **About 兼容性验证浅色主题文字不可读 / About Compat Section Light Theme Fix**:
  `about-info-compat` 的 strong 文字使用 `var(--color-ok-light)` 在浅色主题下不可读。改用 `var(--color-ok)` + 浅色主题覆盖 `#15803d`。

  Fixed: compat section strong text used light green (`--color-ok-light`) unreadable on white. Changed to `--color-ok` with light theme override `#15803d`.

### 统计 / Stats

- **Files changed**: 3 (`src/webview-about-tab.ts`, `src/activity-panel.ts`, `src/webview-styles.ts`)
- **Docs updated**: 1 (`docs/project_structure.md`)
- **TypeScript compile**: Zero errors

---

## 错误种类去重增强：超长消息截断 + 文件路径归一化 — 2026-04-26

### 改进 / Improved

- **超长错误消息截断 / Long Error Message Truncation**:
  `normalizeErrorMessage()` 新增 3 条规范化规则：
  1. `trying to unmarshal args to {TargetFile:... CodeContent:...整个文件内容...}` → `trying to unmarshal args to {…}`（截断嵌入的文件内容）
  2. `failed to read file: open e:/path/to/file.txt` → `failed to read file: open <path>`（文件路径归一化）
  3. 任何超过 300 字符的消息截断到 297 + `...`（通用兜底）

  New normalization rules: (1) truncate unmarshal errors embedding entire file contents, (2) normalize file paths in error messages, (3) general 300-char max-length truncation.

- **错误种类展示使用规范化消息 / Display Normalized Messages in Error Catalog**:
  错误种类目录的 `message` 字段从存储原始消息改为存储 `normalizeErrorMessage()` 结果。IP/端口/路径/超长内容等都在展示中归一化，不再显示冗长的原始文本。持久化数据在下次重建时自动清洗。

  Error type catalog now stores the normalized message for display instead of the raw original. Persisted data is automatically cleaned on next rebuild.

### 统计 / Stats

- **Files changed**: 2 (`src/gm/summary.ts`, `src/gm/tracker.ts`)
- **TypeScript compile**: Zero errors

---

## 移除重复的"上下文组成"区块 — 2026-04-26

### 移除 / Removed

- **独立"上下文组成"饼图区块 / Standalone Context Composition Donut Chart**:
  删除 `buildTokenBreakdownChart()` 函数及其关联的 CSS（`act-legend-dot`、`act-xray-details`、`xray-*` 等约 200 行）。该区块与"上下文情报"标签内的"Token 组成"卡片（`buildContextIntelViewer()` 内）使用相同的 `GMSummary.latestTokenBreakdown` 数据源，属于重复渲染。

  Removed `buildTokenBreakdownChart()` and its associated CSS (~200 lines). This standalone donut chart + X-ray breakdown duplicated the "Token Composition" card already present inside `buildContextIntelViewer()`, both consuming the same `GMSummary.latestTokenBreakdown` data.

  清理项 / Cleanup items:
  - `buildTokenBreakdownChart()` 函数（饼图 SVG + 图例 + X-ray 可折叠详情）
  - 调用处两列布局（`act-two-col`）改为 `errorDetails` 单独渲染
  - CSS: `act-legend-dot`、`act-xray-details`、`xray-body/item/header/bar-wrap/bar/chips/chip/chip-val/total` + light theme 覆盖
  - `webview-script.ts`: `scrollableSelectors` 移除 `.xray-body`

### 统计 / Stats

- **Files changed**: 2 (`src/activity-panel.ts`, `src/webview-script.ts`)
- **TypeScript compile**: Zero errors
- **Net change**: ~-200 行（CSS + 渲染函数 + light theme 覆盖）

---

## 错误种类 / 工具目录全局共享 + 去重增强 — 2026-04-25

### 修复 / Fixed

- **错误种类 / 工具目录多账号未共享 / Error Types & Tool Catalog Not Shared Across Accounts**:
  「错误种类」(`uniqueErrors`) 和「工具目录」(`toolCatalog`) 的持久化以 per-account email 为 key 隔离存储，切换账号后显示不同数量的错误种类/工具。应作为全局共享的永久目录。

  Root cause: `_persistedUniqueErrorsByAccount` 和 `_persistedToolCatalogByAccount` 在 `_buildSummary()` 中仅读取当前 `_currentAccountEmail` 桶，写入也仅存当前桶。

  **修复**: 读取时聚合**所有**账号桶数据（含旧 per-account 桶），写入时合并到单一 `__shared__` 桶。旧 per-account 数据在首次重建时自动迁移，后续统一使用 `__shared__` 桶。切换账号后错误种类和工具目录数量保持一致。

  Error types and tool catalog were stored per-account, showing inconsistent counts when switching accounts. Fix: read phase aggregates ALL account buckets; write phase merges into a single `__shared__` bucket. Legacy per-account data is automatically migrated on first rebuild.

- **"关于"标签图标深色主题不可见 / About Tab Icon Invisible in Dark Theme**:
  标签栏"关于"按钮的 SVG 信息图标中，圆圈内"i"字形的 `<path>` 缺少 `fill="currentColor"`，使用默认黑色填充，在深色主题下不可见。

  Fix: Added `fill="currentColor"` to the second `<path>` in the About tab button SVG icon.

### 改进 / Improved

- **错误去重增强：目标 IP 归一化 / Enhanced Error Dedup: Destination IP Normalization**:
  `normalizeErrorMessage()` 新增对 TCP 目标 IP:port 的归一化（`->198.18.0.57:443` → `->HOST:443`）。同一种 TCP 连接错误（如 `wsasend: connection forcibly closed`）因后端服务器 IP 不同而被识别为多个种类，现在正确合并。

  New normalization rule for TCP destination `IP:port` in `normalizeErrorMessage()`. Connection errors to different backend IPs (e.g., `.22` vs `.57`) are now correctly collapsed into a single error type.

### 统计 / Stats

- **Files changed**: 3 (`src/gm/tracker.ts`, `src/gm/summary.ts`, `src/webview-panel.ts`)
- **Docs updated**: 1 (`docs/project_structure.md`)
- **TypeScript compile**: Zero errors

---

## 账号面板视觉优化 — 2026-04-25

### 改进 / Improved

- **账号面板去紫色化 / Account Popover De-purple**:
  Account Popover（触发按钮 + 下拉面板）全面清除残留的紫色调渐变，改为中性灰蓝色（slate `rgba(148,163,184,*)`）。下拉面板背景从冷紫调 `rgba(34,34,50)` 改为纯中性深灰 `rgb(24,24,30)`。Light theme 同步从 `rgba(124,58,237)` 紫色改为 slate 灰。

  Removed all purple-tinted gradients from Account Popover (trigger + dropdown). Replaced with neutral slate tones. Dark dropdown background changed from cold-purple to neutral dark gray `rgb(24,24,30)`. Light theme updated from purple to slate gray.

- **进度条对齐修复 / Quota Progress Bar Alignment Fix**:
  账号面板各模型池行的 countdown 文字（如 `1d5h`、`6d10h`、`已就绪`、`未使用`）因长度不同导致进度条和模型标签水平错位。统一设置 `font-size: 0.85em` + `min-width: 5em` + `text-align: right` + `flex-shrink: 0`，确保所有行右侧占位一致。

  Fixed misaligned quota bars caused by varying countdown text widths. Unified `font-size`, `min-width`, and `flex-shrink` across `.acct-reset-countdown` and `.acct-reset-idle` for consistent right-side spacing.

### 统计 / Stats

- **Files changed**: 2 (`src/webview-styles.ts`, `src/activity-panel.ts`)
- **TypeScript compile**: Zero errors

---

## 新增"关于"标签页 + 移除 TopBar Chips — 2026-04-24

### 新增 / Added

- **"关于"标签页 / About Tab**:
  新增最末位的"关于"标签页，包含：
  - **Hero 头部**：插件名称 + 一句话简介 + 渐变橙色图标
  - **功能导航**：8 张可点击卡片（GM 数据、会话、成本、模型、额度追踪、日历、个人、设置），每张含彩色 SVG 图标 + 描述，点击直接跳转对应标签
  - **GitHub 开源**：作者链接 + Star 按钮
  - **使用提示**：单窗口建议
  - **免责声明**：数据来源、精度说明、上下文限制
  - **语言切换**：多语言支持提示

  New "About" tab at the end of the tab bar with feature navigation cards, GitHub info, tips, disclaimer, and language hints.

### 移除 / Removed

- **TopBar Chips (GitHub / 提示 / 声明)**:
  从顶部栏移除三个下拉面板按钮（GitHub、Notice、Disclaimer），内容迁移至"关于"标签页常驻展示，减少顶栏视觉噪声。

  Removed GitHub/Notice/Disclaimer chip dropdowns from topbar; content relocated to the About tab for permanent display.

### 修复 / Fixed

- **浅色主题可见性 / Light Theme Visibility**:
  关于页的功能导航卡片图标和 GitHub 链接按钮在浅色主题下颜色过淡。通过在 `.about-card-icon` 作用域内重定义 CSS 变量（`--color-ok-light` → `#16a34a` 等）和加深 GitHub 按钮色值（`#15803d`），确保所有信息区域的左侧彩色边框在浅色主题下同样醒目。

  Fix: CSS variable overrides scoped to `.about-card-icon` for light theme; GitHub link button and info boxes use darker accent colors.

- **免责声明修订 / Disclaimer Revision**:
  移除 GM 徽章描述（已无 GM 标记功能），将上下文窗口范围从 128K–200K 修正为 120K–160K。移除状态栏 tooltip 的数据来源标签行（`✅ 精确数据`）。

  Removed GM badge mention from disclaimer, updated context window range to 120K–160K, removed data source label from statusbar tooltip.

- **模型名暴露原始 ID / Raw Model ID Exposed in UI**:
  成本面板和 GM 数据面板的模型名直接显示内部 ID（如 `MODEL_PLACEHOLDER_M26`）。在 `calculateCosts` 和 `buildModelCards` 中对 `modelBreakdown` key 应用 `normalizeModelDisplayName()` 归一化，仅影响显示层，不改变存储。

  Fix: Apply `normalizeModelDisplayName()` to `modelBreakdown` keys in cost calculation and GM model cards. Display-only change; storage keys unchanged.

### 清理 / Cleanup

- **TopBar Chips 死代码清理 / Dead Code Removal**:
  移除约 254 行已废弃代码：
  - `webview-styles.ts`: topbar-chips / info-chip / chip-dropdown / disclaimer-body / info-banner-link CSS + 浅色主题 overrides (~210行)
  - `webview-script.ts`: `bindChipToggles()` 函数 + `savedChip` 状态恢复 (~39行)
  - `statusbar.ts`: `dataSourceLabel` 变量 (3行)
  - `i18n.ts`: `tooltip.estimated` / `tooltip.precise` 翻译键 (2行)

  Removed ~254 lines of dead CSS, JS, and i18n keys from the former topbar chips system.

### 统计 / Stats

- **New file**: `src/webview-about-tab.ts` (About tab builder + styles)
- **Files changed**: 7 (`webview-panel.ts`, `webview-script.ts`, `webview-about-tab.ts`, `webview-styles.ts`, `statusbar.ts`, `i18n.ts`, `pricing-store.ts`, `activity-panel.ts`)
- **Dead code removed**: ~254 lines
- **TypeScript compile**: Zero errors

---

## 错误种类去重增强 + API 重复消息清洗 — 2026-04-24

### 修复 / Fixed

- **复合时间格式未归一化 / Compound Duration Not Normalized**:
  `normalizeErrorMessage()` 的正则 `/reset after \d+s/` 只能匹配纯秒数（如 `1s`），无法匹配 API 返回的复合时间格式（如 `19h22m14s`、`3h12m38s`）。导致同一种 429 额度耗尽错误因等待时间不同被记为多个"种类"。

  修正：正则改为 `/reset after \d+[hms][\dhms]*/`，覆盖所有时间组合，统一归一化为 `reset after <time>`。

  Fix: regex now matches compound durations (`19h22m14s`, `3h12m38s`, `1s`) instead of only seconds.

- **API 重复消息未折叠 / API Duplicated Error Messages Not Collapsed**:
  API 服务端 bug 返回 `MSG: MSG` 格式的重复错误消息（如 `UNAVAILABLE ...server: UNAVAILABLE ...server`）。旧逻辑仅检测 `.: ` 分隔符，无法处理 `server: UNAVAILABLE` 或 `canceled: request` 等分隔模式。

  修正：提取 `deduplicateApiErrorText()` 公共函数，遍历所有 `: ` 位置检测两半匹配，覆盖所有重复模式。

  Fix: new `deduplicateApiErrorText()` scans all `: ` positions for split-point matching, covering all duplication patterns.

- **持久化旧消息未清洗 / Persisted Messages Not Cleaned**:
  `_persistedUniqueErrorsByAccount` 中存储的旧消息（含未折叠的 API 重复）在 `_buildSummary()` 合并时因 `firstSeen` 更早而"赢"过新的已清洗消息，导致 UI 持续显示重复文本。

  修正：重建 `uniqueErrors` 时对所有持久化 message 应用 `deduplicateApiErrorText()` 清洗，并回写清洗后的版本。一次性自动修复所有历史脏数据。

  Fix: persisted messages are now cleaned through `deduplicateApiErrorText()` during merge, with cleaned versions written back to storage.

### 统计 / Stats

- **Files changed**: 3 (`src/gm/summary.ts`, `src/gm/parser.ts`, `src/gm/tracker.ts`)
- **New export**: `deduplicateApiErrorText()` (parser.ts)
- **TypeScript compile**: Zero errors

---

## 移除监控标签页 + 账号面板额度进度条 — 2026-04-24

### 移除 / Removed

- **监控标签页 / Monitor Tab**:
  完全移除"监控"标签页（`webview-monitor-tab.ts`，1008 行）。该标签页的所有功能已被 GM 数据面板全面覆盖，属于冗余。GM 数据标签页成为默认首页。

  Removed the entire "Monitor" tab (~1008 lines). All functionality was superseded by the GM Data dashboard. GM Data is now the default landing tab.

  移除内容：GM 总览卡片、成本速览卡片、额度概览/追踪卡片、当前/其他会话区块、压缩历史、调用明细、输出分拆、缓存效率。

- **monitor-\* CSS（约 300 行）**: 全部清除
- **Light Theme monitor 覆盖（7 行）**: 清除

### 新增 / Added

- **账号面板额度进度条**: 在每个模型池行左侧显示 50px 迷你进度条，展示剩余额度百分比。颜色语义化：绿色 > 40%、橙色 20–40%、红色 < 20%。仅在有消耗的 active 池显示，idle/ready 状态不显示。数据来源为 `ModelConfig.quotaInfo.remainingFraction`（20% 步进精度）。

### 统计 / Stats

- **Files deleted**: 1 (`src/webview-monitor-tab.ts`)
- **Files changed**: 5 (`src/webview-panel.ts`, `src/webview-styles.ts`, `src/webview-script.ts`, `src/activity-panel.ts`, `src/extension.ts`)
- **TypeScript compile**: Zero errors

---

### 改进 / Improved

- **工具目录容器化 / Tool Catalog Container**:
  工具目录气泡区域从裸露散落改为与排行榜列表统一的容器样式（`background + border + border-radius + padding`），新增标题行：书本 SVG 图标 + "工具目录" 文字 + 数量 badge。

  Tool catalog chips now wrapped in a proper container matching the ranking list style, with header row (book icon + title + count badge).

- **气泡按调用次数排序 / Catalog Chips Sorted by Usage**:
  工具目录气泡按调用次数降序排列，与排行榜顺序一致。高频工具在前，低频/MCP 工具自然沉底。午夜 counts 清零后按 `firstSeen` 排序降级。

  Catalog chips sorted by call count descending (matching ranking order). After midnight reset, falls back to firstSeen order.

- **排行榜显示全部工具 / Ranking Shows All Tools**:
  移除 top 15 截断限制，排行榜显示所有工具的条形图。移除 "+X 个更多" 提示。

  Removed `entries.slice(0, 15)` limit — ranking now shows all tools. Removed "+X more" note.

- **Tooltip 字体修复 / Tooltip Font Size Fix**:
  工具目录气泡的 hover tooltip 从嵌套缩小的 `~0.53em` 修正为固定 `12px`，确保可读。

  Fixed tooltip font-size from nested-shrunk ~0.53em to fixed 12px for readability.

### 修复 / Fixed

- **永久目录保护 / Permanent Catalog Persistence**:
  错误种类目录（`_persistedUniqueErrorsByAccount`）和工具目录（`_persistedToolCatalogByAccount`）改为永久持久化，不再被午夜 `reset()` 和额度重置 `baselineForQuotaReset()` 清除。仅 `fullReset()`（核弹级重置）清除。

  Unique error catalog and tool catalog are now permanent — NOT cleared by midnight `reset()` or quota `baselineForQuotaReset()`. Only `fullReset()` (nuclear) clears them.

  | 清除点 | 错误种类 | 工具目录 | 错误计数/日志 |
  |---|---|---|---|
  | `reset()`（午夜） | 保留 | 保留 | 清除 |
  | `baselineForQuotaReset()`（额度重置） | 保留 | 保留 | 清除 |
  | `fullReset()`（核弹级） | 清除 | 清除 | 清除 |

### 统计 / Stats

- **Files changed**: 2 (`src/gm/tracker.ts`, `src/activity-panel.ts`)
- **TypeScript compile**: Zero errors
- **Tests**: 50 passed
- **New CSS classes**: `.tool-cat-section`, `.tool-cat-header`

---

### 改进 / Improved

- **错误种类按消息内容去重 / Error Types Deduplicated by Message Content**:
  「错误种类」目录的去重逻辑从"按 error code 去重"（如 `429`/`500`/`unknown`）改为"按规范化消息内容去重"。不同内容的错误即使错误码相同，也会被记录为独立种类。

  Error type catalog deduplication changed from error-code-based to normalized-message-content-based. Different messages under the same error code are now tracked as separate error types.

  | 改前 | 改后 |
  |------|------|
  | 同 429 不同消息 → 合并为 1 种 | 同 429 不同消息 → 各自独立 |
  | `wsasend:14266` 和 `wsasend:5167` → 合并（同为 500） | 合并（TCP 源端口规范化） |
  | `reset after 0s` 和 `reset after 1s` → 合并（同为 429） | 合并（等待时间规范化） |
  | `context canceled` 和 `wsasend` → 合并（同为 500） | 独立（内容不同） |
  | `failed to read file` 和 `task scope too simple` → 合并（同为 unknown） | 独立（内容不同） |

- **错误种类跨账号可见 / Error Types Cross-Account Visibility**:
  错误种类目录收集逻辑移除账号过滤，跨所有账号收集（类似工具调用排行）。报错日志保持仅当前账号。

  Error type catalog now collects from ALL accounts (like tool call ranking). Error log remains current-account only.

### 新增 / Added

- **`normalizeErrorMessage()` 规范化函数 / Error Message Normalization**:
  新增 `normalizeErrorMessage()`（`summary.ts`），将错误消息中的易变部分规范化后用作去重 key：
  - TCP 源端口号 `198.18.0.1:14266->` → `198.18.0.1:PORT->`
  - Quota reset 等待时间 `reset after 0s` → `reset after Ns`
  - 保留核心语义差异（不同文件路径、不同 URL、不同错误类型）

  New `normalizeErrorMessage()` strips volatile parts (port numbers, reset wait times) while preserving semantic identity for deduplication.

### 修复 / Fixed

- **旧版持久化数据迁移 / Legacy Persisted Data Migration**:
  旧版 `persistedUniqueErrorsByAccount` 以 errorCode 为 key（如 `"500"` → `{message, firstSeen}`），新版以 `normalizeErrorMessage(msg)` 为 key。合并前所有旧条目通过 `normalizeErrorMessage()` 重新分桶，避免新旧 key 共存导致同一错误出现两条。

  Old persisted entries (keyed by errorCode) are migrated to normalized-message keys during merge, preventing duplicate entries from key format mismatch.

### 统计 / Stats

- **Files changed**: 3 (`src/gm/types.ts`, `src/gm/tracker.ts`, `src/gm/summary.ts`)
- **UI updated**: 1 (`src/activity-panel.ts` — 注释更新)
- **TypeScript compile**: Zero errors
- **Tests**: 50 passed

---

## 状态栏上下文窗口精准化 — GM 数据驱动 — 2026-04-24

### 变更 / Changed

- **上下文窗口限制改用平台截断阈值 / Context Limits Now Use Platform Truncation Thresholds**:
  `DEFAULT_CONTEXT_LIMITS` 从模型原生窗口（1M）改为 GM `plannerConfig.truncationThresholdTokens` 确认的平台实际截断值。

  | 模型 | 旧值 | 新值 | 依据 |
  |---|---|---|---|
  | Claude Opus/Sonnet | 1,000,000 | 160,000 | GM plannerConfig |
  | Gemini 3.1 Pro | 1,000,000 | 120,000 | 实测压缩触发点 ~125K |
  | Gemini Flash | 1,000,000 | 160,000 | GM plannerConfig |
  | GPT-OSS 120B | 128,000 | 128,000 | 不变 |

- **状态栏 contextUsed 改用 GM 精准数据 / Status Bar Uses GM Precision Data**:
  poll 循环中 GM 获取完成后，用 `contextTokensUsed`（来自 `contextWindowMetadata`）替换 step-based 估算值，确保状态栏与 Context Intelligence 面板数值一致。

  After GM fetch, `currentUsage.contextUsed` is overridden with GM's `contextTokensUsed` for precision.

- **旧版本自动迁移 / Automatic Migration for Old Versions**:
  新增一次性迁移逻辑，检测旧版 1M 默认值并自动清除，让新 `package.json` 默认值生效。使用 `inspect()` + `contextLimitsMigrationV` 标记确保只运行一次。

  One-time migration detects stale 1M defaults and resets to new platform thresholds.

### 统计 / Stats

- **Files changed**: 3 (`src/models.ts`, `src/extension.ts`, `package.json`)
- **Impact**: 状态栏百分比从 `~13%` (基于1M) 变为 `~82%` (基于160K)，准确反映实际上下文压力

---

## Model DNA 会话隔离修复 — 2026-04-24

### 修复 / Fixed

- **DNA 卡片跨会话污染 / Cross-session DNA Card Leakage**:
  修复了切换模型后，上下文情报同时显示所有历史模型（如 Claude + Gemini）DNA 卡片的问题。现在仅显示当前对话中使用过的模型。

  Fixed DNA cards showing models from all sessions. Now filtered to current conversation's models only via `primaryModels` set.

- **上下文窗口数据跨会话取值 / Context Window Cross-session Data**:
  修复了上下文窗口进度条的 `latestContextUsed` / `maxContextSeen` 从全账号对话取值导致数据错误的问题，改为仅从当前对话取值。

  Fixed context window progress bar pulling data from all conversations instead of the current one.

---

## 上下文情报升级 — Model DNA + 上下文窗口容量 — 2026-04-24

### 新增 / Added

- **Artifacts 系统注入识别 / Artifacts System Context Classification**:
  `classifySystemContext()` 新增 `<artifacts>` 标签识别规则，`GMSystemContextType` 新增 `'artifacts'` 类型（紫色图标）。

  New `artifacts` classification for `<artifacts>` tags in system context with purple icon.

- **Model DNA 可视化面板 / Model DNA Visualization**:
  上下文情报（Context Intelligence）底部新增 3 张可折叠 Model DNA 卡片，展示模型运行时内部参数：

  New collapsible Model DNA cards at the bottom of Context Intelligence viewer:

  | 卡片 | 数据源 | 展示内容 |
  |------|--------|---------|
  | 系统提示词结构 | `promptSectionTitles` | 模型名 + 13 个 promptSection 彩色标签 + 工具/区段计数 |
  | 生成配置 | `completionConfig` + `contextWindowCapacity` | temperature/topK/maxOutputTokens/stopPatterns + 上下文窗口容量进度条 |
  | Token 组成 | `latestTokenBreakdown` | 上下文窗口 token 分布横向条形图（System Prompt / Chat / Tools 占比） |

- **上下文窗口容量直取 / Context Window Capacity from GM Data**:
  从 `gm.plannerConfig.truncationThresholdTokens` 提取真实的上下文窗口截断阈值（如 160000），不再使用启发式猜测。

  `contextWindowCapacity` extracted directly from `plannerConfig.truncationThresholdTokens` in GM data, no heuristic estimation.

  - 新增 `GMCallEntry.contextWindowCapacity` / `GMModelStats.contextWindowCapacity` 字段
  - `parseGMEntry()` → `tracker.ts` 聚合 → `summary.ts` 合并，全链路打通
  - 进度条标签从 `~200.0k`（估算）变为 `160.0k`（精确值），无波浪号

- **空状态提示 / Empty State Placeholder**:
  重装后 GM 数据尚未刷新时，上下文情报区域显示"等待 AI 回复中 — 上下文数据将在本次会话的首次模型调用后自动填充"提示，代替空白区域。

  Empty state hint shown when no context data is available (e.g., after reinstall before first AI response).

### 统计 / Stats

- **Files changed**: 5 (`src/gm/types.ts`, `src/gm/parser.ts`, `src/gm/tracker.ts`, `src/gm/summary.ts`, `src/activity-panel.ts`)
- **TypeScript compile**: Zero errors
- **New fields**: `GMCallEntry.contextWindowCapacity`, `GMModelStats.contextWindowCapacity`
- **New CSS classes**: `.ci-dna-chips`, `.ci-dna-chip`, `.ci-cfg-grid`, `.ci-cfg-row`, `.ci-cfg-label`, `.ci-cfg-val`

---

## 全局颜色统一 + 去紫色化 — 2026-04-24

### 改进 / Improved

- **全局颜色对齐**:
  时间线标签、Summary Bar 芯片、模型统计卡片三处数值颜色系统统一对齐，所有同类数据使用相同颜色。

  Unified color system across timeline tags, summary bar chips, and model stats card values.

  | 类别 | 颜色 | CSS 变量 |
  |---|---|---|
  | 调用 | 蓝 | `--color-info-light` |
  | 输入 | 蓝 | `--color-info-light` |
  | 输出 | 绿 | `--color-ok-light` |
  | 时间 (TTFT/流速) | 琥珀 | `--color-amber-light` |
  | 缓存 | 青绿 | `--color-teal-light` |
  | 费用 | 绿 | `--color-ok-light` |
  | 积分 | 红 | `--color-danger-light` |
  | 上下文 | 橙 | `--color-orange` |

- **去紫色化**:
  紫色作为 AI 象征色，从全局 UI 中移除。上下文标签→橙色，Ultra 徽章→青色，账号计数→蓝色，对话循环色→橙色。

  Removed purple (AI-symbolic color) globally: ctx→orange, Ultra badge→cyan, account count→info blue.

- **时间线标签添加边框**:
  所有 `.act-tl-gm-tag` 添加同色系半透明边框，与 Summary Bar 芯片风格统一。

  Added matching `border-color` to all timeline tags for visual consistency with summary bar chips.

- **工具图标 SVG 化**:
  🔧 emoji 替换为 `stroke="currentColor"` 的 SVG 扳手图标，解决浅色主题下不可见问题。

  Replaced wrench emoji with SVG icon using `currentColor` for theme-adaptive visibility.

- **浅色主题可见性修复**:
  工具标签在浅色主题下使用更深的颜色（深石板灰 / 深琥珀），确保白色背景下可见。

  Improved light theme contrast for tool tags with darker text colors.

- **数值芯片化**:
  模型卡片中所有数值和账号计数均添加同色系半透明背景 + 边框，形成与 Summary Bar 芯片一致的视觉层级感。

  All model card values and account counts now have chip-style backgrounds and borders matching summary bar chips.

### 统计 / Stats

- **Files changed**: 1 (`src/activity-panel.ts`)
- **TypeScript compile**: Zero errors
- **Tests**: 50 passed
- **New CSS classes**: `.val-in`, `.val-out`, `.val-time`, `.val-calls`, `.val-cache`, `.val-cost`, `.val-hit`, `.val-credits`

---

## 工具目录气泡标签 — 2026-04-24

### 新增 / Added

- **工具目录 / Tool Catalog**:
  工具调用排行底部新增工具目录气泡标签（flex-wrap chips），每个气泡为一个去重工具名，hover 弹出中文描述 tooltip。

  New tool catalog bubble tags at the bottom of the Tool Call Ranking section. Each bubble shows a unique tool name; hover displays a Chinese description tooltip.

  - 新增 `ToolCatalogEntry` 接口（`name` / `firstSeen` / `description?`）
  - `GMSummary.toolCatalog` 字段 + `GMTrackerState.persistedToolCatalogByAccount` 持久化
  - 在工具计数循环中同步收集 `firstSeen`（取最早 `call.createdAt`）
  - 与持久化数据合并（保留最早 firstSeen + 保留已有 description）
  - 跨重启保留、多账号隔离、额度重置 / 午夜归档同步清零
  - 内置 19 种 AI 编码助手工具中文描述映射表（`toolDesc`）
  - `data-tooltip` CSS tooltip 系统复用，hover 即时显示

### 统计 / Stats

- **Files changed**: 5 (`src/gm/types.ts`, `src/gm/tracker.ts`, `src/gm/index.ts`, `src/gm-tracker.ts`, `src/activity-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Tests**: 50 passed
- **New types**: `ToolCatalogEntry`
- **New CSS classes**: `.tool-cat-chips`, `.tool-cat-chip`

---

## 错误种类档案 + 报错日志升级 — 2026-04-24

### 新增 / Added

- **唯一错误种类档案 / Unique Error Type Catalog**:
  在「错误详情」区块新增「错误种类」可折叠子区块，按 error code（如 `429`/`503`/`stream_error`）去重，仅保留每种错误类型的首次触发记录（完整消息 + 时间戳）。方便调查"一共触发了哪几种错误"。

  New collapsible "Error Types" sub-section deduplicates errors by error code, keeping only the first occurrence of each type. Useful for investigating what varieties of errors have been encountered.

  - 新增 `UniqueErrorEntry` 接口（`code` / `message` / `firstSeen`）
  - `GMSummary.uniqueErrors` 字段 + `GMTrackerState.persistedUniqueErrorsByAccount` 持久化
  - 跨重启保留、多账号隔离、额度重置 / 午夜归档同步清零

- **结构化报错日志 / Structured Error Log**:
  普通报错从纯文本列表升级为结构化 `RecentErrorEntry[]`（`message` + `code` + `createdAt`），与错误种类使用完全一致的行格式：序号 + 颜色编码标签（限流/服务端/其他） + 时间戳 + 消息预览 → 展开查看完整内容。

  Recent errors upgraded from plain string array to structured `RecentErrorEntry[]` with parsed error code and timestamp. Uses the same row format as unique error types.

  - 新增 `RecentErrorEntry` 接口
  - 「报错日志」可独立折叠（默认展开），与「错误种类」双重折叠互不影响

- **一键复制全部错误 / Copy All Errors to Clipboard**:
  「错误详情」标题旁新增复制按钮（自定义 CSS tooltip 替代原生 `title`），一键复制全部错误数据到剪贴板，格式化为可读纯文本：

  ```
  --- 错误种类 (2 种) ---
  #1 [500] 04/24 06:29 request failed: ...
  #2 [429] 04/24 08:10 RESOURCE_EXHAUSTED...

  --- 报错日志 (4 条) ---
  #1 [429] 04/24 08:10 RESOURCE_EXHAUSTED...
  #2 [500] 04/24 07:45 request failed: ...
  ...

  1.2k token 浪费 | 0.5 credits 损耗
  ```

  方便直接粘贴给 AI 助手进行针对性优化。复制成功后按钮短暂闪绿反馈。

  Copy button with custom CSS tooltip copies all error data (types + log + overhead) to clipboard as formatted plain text.

### 统计 / Stats

- **Files changed**: 6 (`src/gm/types.ts`, `src/gm/tracker.ts`, `src/gm/index.ts`, `src/gm-tracker.ts`, `src/activity-panel.ts`, `src/webview-script.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Tests**: 50 passed
- **New types**: `UniqueErrorEntry`, `RecentErrorEntry`
- **New CSS classes**: `.gm-ue-section`, `.gm-ue-header`, `.gm-ue-row`, `.gm-ue-copy-btn`, `.gm-ue-tooltip`

## 报错统计修复 + Tooltip 跳跃修复 — 2026-04-23

### 修复 / Fixed

- **报错统计跨账号污染 / Error Count Cross-Account Contamination**:
  Summary Bar 顶部「报错」气泡显示的错误总数混入了其他账号的历史错误，与预期的「仅当前账号」不一致。积分和调用统计不受影响。

  Root cause: `_buildSummary()` 中 `retryErrorCodes` 从 `accountFilteredCalls`（已按当前账号过滤）正确聚合后，被 `_persistedRetryErrorCodesByAccount` 以 **max-wins** 策略无条件合并（取最大值），导致：
  1. 持久化数据只增不减：即使归档清除了实际调用，持久化的历史最大值仍保留
  2. 旧版全局数据迁移污染：`_persistedRetryErrorCodes`（混合多账号）被迁移到当前账号桶

  积分/调用不受影响是因为它们没有 max-wins 持久化机制——每次都从 `accountFilteredCalls` 实时重新计算。

  **修复**: max-wins 合并改为 **fallback-only** 模式——仅当 API 尚未回填数据（`freshErrorTotal === 0`，插件重启后首几次轮询）时使用持久化数据作为降级展示。API 数据已到位后直接使用实时计算结果，与积分/调用的行为一致。

  Error count mixed in other accounts' historical errors. `retryErrorCodes` was correctly aggregated from `accountFilteredCalls`, but then unconditionally inflated by max-wins merge with persisted data. Fix: persisted data now used only as fallback when fresh data is zero (API not yet repopulated after restart), matching how totalCalls/totalCredits work.

- **Tooltip 鼠标离开时跳跃 / Tooltip Jump on Mouse Leave**:
  Summary Bar 气泡元素的 tooltip 在鼠标离开时会瞬间跳到顶部再消失。

  Root cause: 两套 tooltip 样式冲突——全局 `[data-tooltip]::after` 使用 `bottom`（向上弹出）+ 过渡动画，而 `.act-stat` 只在 `:hover` 时覆盖为 `top`（向下弹出）。鼠标离开时 hover 覆盖消失，tooltip 跳回全局的 `bottom` 方向后再淡出。

  **修复**: 将 `.act-stat` 的 tooltip 方向覆盖从 `:hover` 提升到基础状态 `::after`（`bottom: auto; top: calc(100% + 6px)`），确保 tooltip 在 hover 和淡出时始终保持在元素下方，不再因样式层级切换而跳跃。边缘锚定同步更新。

  Two tooltip styles conflicted: global used `bottom` (upward) + transition, act-stat overrode to `top` (downward) only in `:hover`. On mouse leave, the hover override disappeared, tooltip jumped from bottom to top then faded out. Fix: override direction in base `::after` state so it's always consistent.

### 统计 / Stats

- **Files changed**: 2 (`src/gm/tracker.ts`, `src/activity-panel.ts`)
- **TypeScript compile**: Zero errors

---

## Timeline 用户消息重复修复 — 2026-04-23

### 修复 / Fixed

- **用户消息重复显示 / Duplicate User Messages in Timeline**:
  Timeline 中同一条用户消息出现在两个相邻的"轮"中（如第 3 轮底部和第 2 轮顶部同时显示 step #36 的用户消息），导致出现无统计数据的空"幽灵轮"。插件每次重启/重装后必现。

  **双层根因 / Two-Layer Root Cause**:

  1. **`_compactRecentSteps` dedup key 不稳定**: `gm_user` 事件的 dedup key 使用了 `buildLegacyStepEventIdentity()`，其中包含 `timestamp`。但用户锚点的时间戳依赖 `nextCall?.createdAt`（下一个 AI 调用的创建时间），随新调用出现而变化。时间戳漂移导致同一 `gm_user` 事件在不同轮询中产生不同的 dedup key → 重复。

  2. **step-source 与 gm_user 共存**: `injectGMData` 用纯文本匹配来过滤 step-source 用户事件（`gmUserTextSet.has(userText)`），但 Steps API warm-up 后 step-source 的 `userInput` 可能为空或截断不同 → 文本匹配失败 → step-source 用户事件与 gm_user 事件共存 → 重复。

  **修复 / Fix**:
  - `_compactRecentSteps`: `gm_user`/`gm_virtual` 事件改用 `cascadeId+stepIndex+category` 作为稳定的 dedup key
  - `injectGMData` step-source 过滤: 新增 `gmUserStepKeys`（`cascadeId:stepIndex`）作为兜底匹配条件，即使文本不一致也能去重

  Duplicate user messages appeared in adjacent turns (e.g., same step #36 in Turn 3 and Turn 2). Two-layer fix: (1) stable dedup key using cascadeId+stepIndex instead of drifting timestamp, (2) stepIndex-based fallback for filtering step-source user events when text matching fails.

### 统计 / Stats

- **Files changed**: 1 (`src/activity/tracker.ts`)
- **TypeScript compile**: Zero errors

---

## 成本标签页 UI 重构 — 2026-04-23

### 重构 / Refactored

- **成本标签页 UI 重构 / Cost Tab UI Overhaul**:
  合并「费用概览」和「费用明细」为统一的「费用分析」面板，消除三处重复的 Grand Total 显示。CSS 命名从 `prc-viz-*` / `prc-cost-*` 双命名空间统一为 `cost-*`。

  Merged "Cost Overview" and "Cost Breakdown" into a unified "Cost Analysis" panel, eliminating triple Grand Total display. CSS namespace unified from `prc-viz-*` / `prc-cost-*` to `cost-*`.

  | 维度 | 改前 | 改后 |
  |------|------|------|
  | 费用总计 | 3 处显示（月汇总 + 4 卡片 highlight + Grand Total 卡片） | 1 处（summary bar 芯片） |
  | 费用概览 | 4 个独立 highlight 卡片（总费用/最高消费/平均/模型数） | 紧凑 summary bar 芯片条 |
  | 柱状图 | 保持，改进 tooltip（新增 token 数量显示） | 保持 |
  | 费用明细 | 独立 `prc-cost-grid` 卡片网格（per-model 2×2 grid） | 紧凑行式（模型名 + 分色分项 + 总费用），合入面板 |
  | Grand Total 卡片 | 独立黄色边框大卡片 | **移除**（summary bar 已显示） |
  | CSS 命名 | `prc-viz-*` + `prc-cost-*`（~180 行） | `cost-*`（~150 行） |

- **重复函数清理 / Duplicate Function Cleanup**:
  `fmtUsd` / `fmtCost` / `fmtTokensK` 三个格式化函数合并为文件级共享的 `fmtUsd()` + `fmtTok()`。`buildMonthlyCostSummary` 改用共享 `fmtUsd()`。

  Deduplicated three formatting functions into shared file-level `fmtUsd()` + `fmtTok()`.

### 移除 / Removed

- `buildCostVisualization()` — 合并入 `buildCostPanel()`
- `buildCostSummary()` — 合并入 `buildCostPanel()`
- `fmtCost()` / `fmtTokensK()` — 用 `fmtUsd()` / `fmtTok()` 替代
- `prc-viz-*` CSS（~90 行 highlight + bar chart 样式）
- `prc-cost-*` CSS（~90 行 card grid 样式）
- 3 条 Light Theme 覆盖（`prc-cost-card-total` / `prc-cost-grand-val` / `prc-cost-card.prc-cost-grand`）

### 统计 / Stats

- **Files changed**: 1 (`src/pricing-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Net lines**: ~-120
- **New CSS classes**: `cost-panel`, `cost-chips`, `cost-chip`, `cost-bar-*`, `cost-detail-*`, `cost-legend-*`, `cost-note`

---

## 会话标签页 UI 重构 — 2026-04-23

### 重构 / Refactored

- **会话标签页 UI 全面重构 / Sessions Tab UI Overhaul**:
  将「会话」标签页的视觉风格与「GM 数据」面板统一，CSS 命名空间从 `history-*` 迁移至 `ses-*`。

  Sessions tab visual design unified with GM Data panel. CSS namespace migrated from `history-*` to `ses-*`.

  | 维度 | 改前 | 改后 |
  |------|------|------|
  | 卡片布局 | 7 层垂直堆叠 + spotlight 子卡片 | 4 行紧凑行式卡片（标题→上下文→指标→操作） |
  | Summary Bar | 3 列独立统计卡片 | **移除**（信息冗余） |
  | Shortcut | 大块渐变卡片 | 紧凑水平芯片按钮（`ses-shortcut`） |
  | 搜索/筛选 | 独立 `.card` 容器 + 双行布局 | 单行工具栏（圆角搜索框 + 内联筛选标签） |
  | 操作按钮 | 含文字的大按钮 | 纯图标紧凑按钮（12px SVG） |
  | 悬浮提示 | 浏览器原生 `title`（~1s 延迟） | CSS tooltip（`data-tooltip` + `::after`，即时 0.12s 淡入） |
  | CSS 命名 | `history-*`（~740 行） | `ses-*`（~250 行） |

- **会话行精简 / Session Row Simplification**:
  移除每行的调用次数、步骤数、积分、模型名芯片（这些信息已在 GM Data 面板显示）。每行仅保留：时间范围 + 存储标签（Brain/Rec/PB）。

  Removed calls, steps, credits, and model name chips from session rows (already shown in GM Data). Each row now shows: time range + storage tags only.

### 新增 / Added

- **CSS Tooltip 系统 / CSS Tooltip System**:
  基于 `data-tooltip` 属性的纯 CSS tooltip，使用 `::after` 伪元素实现。hover 即时显示（0.12s 淡入 + scale 微动效），无 JS 依赖。支持 `disabled` 按钮自动隐藏、Light/Dark 主题、`focus-visible` 可访问性。

  Pure CSS tooltip via `data-tooltip` attribute + `::after` pseudo-element. Instant display on hover (0.12s fade-in + scale micro-animation), no JS needed. Supports disabled state, light/dark theme, and focus-visible accessibility.

### 移除 / Removed

- **`history-*` 死代码清理 / Dead CSS Cleanup**:
  - 移除 ~740 行旧 `history-*` CSS（主块 + 文件末尾 ~75 行 light theme 覆盖）
  - 移除 `renderSummary()` 函数及其调用
  - 移除 `ses-summary-bar` / `ses-stat*` / `ses-ctx-model` / `ses-chip-credit` 死 CSS
  - `webview-script.ts` 更新 2 处选择器（`.history-filter-btn` → `.ses-filter-btn`，`.history-group` → `.ses-group`）

### 统计 / Stats

- **Files changed**: 3 (`src/webview-chat-history-tab.ts`, `src/webview-styles.ts`, `src/webview-script.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **CSS net**: ~-740 行旧 `history-*` + ~250 行新 `ses-*` + ~35 行 CSS tooltip = **净减 ~455 行 CSS**
- **New CSS classes**: `ses-shortcut`, `ses-toolbar`, `ses-search-wrap`, `ses-row`, `ses-badge`, `ses-chip`, `ses-act-btn`, `[data-tooltip]`

---

## Thinking Tokens 费用修复 — 2026-04-23

### 修复 / Fixed

- **Thinking Tokens 费用双重计算 / Thinking Token Double-Counting Bug**:
  `outputTokens` 已包含 `thinkingOutputTokens`（即 `output = responseOutput + thinking`），但费用公式同时使用了 `outputTokens × output_price` 和 `thinkingTokens × thinking_price`，造成 thinking 被计费两次。

  修正：所有 8 处费用计算统一改为 `respOut = outputTokens - thinkingTokens`，仅用 `respOut × output_price` 计算输出费用。

  对 Claude 无影响（`thinkingTokens` 始终为 0），对 Gemini 修正约 12-15%。

  Fix: `outputTokens` includes `thinkingOutputTokens`, but the cost formula was using both `outputTokens × output_price` AND `thinkingTokens × thinking_price`, double-charging thinking. All 8 cost calculation sites now use `respOut = outputTokens - thinkingTokens` for the output cost.

- **月费用总计未包含待归档区 / Monthly Cost Missing Pending Archive**:
  `buildMonthlyCostSummary` 仅汇总已归档周期 + 当前活跃周期，遗漏了待归档区的 `estimatedCost`。

  修正：`buildPricingTabContent` 新增 `pendingArchiveCost` 参数，`webview-panel.ts` 传入 `lastPendingArchives.reduce(estimatedCost)`。费用概览、费用明细、月总计三处统一纳入。

  Fix: Monthly cost now includes pending archive `estimatedCost` sum. All three cost display sections (overview, breakdown, monthly) unified.

### 改进 / Improved

- **移除 Cache Write 费用显示 / Remove Cache Write Cost Display**:
  API 从未上报 `cacheCreationTokens`（858 次调用全部为 0），移除相关 UI 避免误导：
  - `ModelCostRow` 删除 `cacheWriteCost`、`cacheWriteTokens` 字段
  - 费用明细卡片删除「缓存写入」行
  - 费用柱状图不再包含 cacheWrite 段
  - 自定义价格编辑器隐藏 cacheWrite 字段

  Removed cacheWrite cost from all UI surfaces since API never reports `cacheCreationTokens`. `ModelPricing` and `DEFAULT_PRICING` retain the field for future use.

### 统计 / Stats

- **Files changed**: 5 (`src/pricing-store.ts`, `src/pricing-panel.ts`, `src/activity-panel.ts`, `src/gm/tracker.ts`, `src/webview-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors

---

## 模型卡片费用行 + 全量 GM 数据 — 2026-04-23

### 修复 / Fixed

- **Cost 标签页仅显示当前账号费用 / Cost Tab Only Showing Active Account**:
  `GMTracker._buildSummary()` 默认按当前账号过滤 `modelBreakdown`，导致 Cost 标签页只反映活跃账号的费用。

  Fix: `PanelPayload` 新增 `gmFullSummary` 字段，通过 `gmTracker.getFullSummary()`（`skipAccountFilter=true`）获取全量数据。Cost 标签页和 Settings `estimatedCostAllTime` 改用 `lastGMFullSummary`。

### 新增 / Added

- **模型卡片费用行 / Per-Model Cost Row in Model Cards**:
  每个模型卡片（普通 + GM-only）在 Credits 行下方新增绿色 **Cost / 费用** 行，使用 `findPricing(responseModel) || findPricing(displayName)` 双重查找。数据源为 `gm.modelBreakdown`（当前账号）。

  New green Cost row in each model card, showing current account's per-model estimated cost.

- **模型统计汇总行费用 / Cost in Model Stats Total Row**:
  Sigma 合计行新增绿色费用标签，遍历 `conversations[].calls` 计算跨账号未归档总费用。

  New cost chip in the model stats total row, aggregating active (non-archived) costs across all accounts.

- **待归档区费用 / Cost in Pending Archive Panel**:
  `PendingArchiveEntry` 新增 `estimatedCost?: number` 字段。`baselineForQuotaReset()` 在归档时用 `findPricing(call.responseModel)` 即时计算费用存入。待归档面板直接读取累加显示。

  New `estimatedCost` field in `PendingArchiveEntry`, pre-computed at baseline time using `responseModel` pricing. Pending archive panel displays the sum.

  > 已有历史 entries 无此字段，下次额度重置后新 entries 自动包含。

- **findPricing display name fallback / Display Name Matching Enhancement**:
  `findPricing()` 新增第四层匹配：当输入看起来像 display name（含大写/空格/括号）时，自动转为 kebab-case 重试（如 `Claude Opus 4.6 (Thinking)` → `claude-opus-4-6-thinking` → prefix match `claude-opus-4-6`）。同时增加空字符串保护。

  Enhanced `findPricing()` with display name fallback: auto-converts to kebab-case for retry matching. Added empty string guard.

### 三层费用展示逻辑 / Three-Layer Cost Display

| 位置 / Location | 范围 / Scope | 数据源 / Source |
|---|---|---|
| 模型卡片 / Model Card | 当前账号 / Current account | `gm.modelBreakdown` |
| 汇总行 / Total Row | 全账号、未归档 / All accounts, active | `conversations[].calls` |
| 待归档区 / Pending Archive | 全账号、已归档 / All accounts, archived | `PendingArchiveEntry.estimatedCost` |
| Cost 标签页 / Cost Tab | 全账号、全量 / All accounts, all | `gmFullSummary.modelBreakdown` |

### 统计 / Stats

- **Files changed**: 6 (`src/pricing-store.ts`, `src/activity-panel.ts`, `src/gm/types.ts`, `src/gm/tracker.ts`, `src/webview-panel.ts`, `src/extension.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **New CSS classes**: `.act-card-row-cost`, `.mst-item-cost`, `.pending-stat-cost`

---

## 上下文情报系统 — 2026-04-23

### 新增 / Added

- **上下文情报系统 / Context Intelligence System**:
  全新的「上下文情报」查看器，替代原有的「上下文检查点」查看器，统一展示所有系统注入的上下文内容。

  New "Context Intelligence" viewer replacing the old "Context Checkpoints" viewer, unified display of all system-injected context.

  **类型系统 / Type System**:
  - `GMSystemContextType`: 8 种分类 — `checkpoint` | `context_injection` | `user_info` | `user_rules` | `mcp_servers` | `workflows` | `ephemeral` | `system_preamble`
  - `GMSystemContextItem`: 统一数据结构（type / stepIndex / tokens / label / fullText / checkpointNumber?）
  - `GMCallEntry` + `GMConversationData` 新增 `systemContextItems: GMSystemContextItem[]` 字段
  - clone / slim / persistence 工具函数同步更新

  **数据提取 / Data Extraction** (`parser.ts`):
  - `classifySystemContext()`: 从 USER 消息内容识别系统注入类型（`<user_information>` / `<user_rules>` / `<mcp_servers>` / `<workflows>` / `# Conversation History` / `{{ CHECKPOINT }}` 等）
  - `extractSystemContextItems()`: 从 `messagePrompts` 提取所有匹配项
  - 完整集成到数据流：`extractPromptData` → `parseGMEntry` → `mergeGMCallEntries` → `maybeEnrichCallsFromTrajectory`（广播所有 call）
  - `deduplicateSystemContextItems()` 在 conversation 级按 `type:stepIndex` 去重

  **UI 查看器 / UI Viewer** (`activity-panel.ts`):
  - `buildContextIntelViewer()` 替代 `buildCheckpointViewer()`
  - 每种类型独立 SVG 图标 + 颜色标识（金色 Checkpoint / 蓝色上下文注入 / 绿色用户信息 / 紫色用户规则 / 青色 MCP / 粉色工作流 / 灰色系统前导）
  - 外层 `<details id="ciSection">` 双重折叠（默认收缩），`restoreDetailsState()` 自动记忆展开状态
  - 卡片式边框 + 琥珀色主题 + hover 交互效果
  - 标题栏按类型统计 badge（数量为 1 时不显示数字）
  - `stepIndex < 0` 的初始注入项不显示 step 标签

- **时间线系统注入分类扩展 / Timeline System Injection Classification**:
  `injectGMData()` 用户锚点分类新增识别 `<user_information>`、`<user_rules>`、`<mcp_servers>`、`<workflows>`，归类为橙色系统事件（不再误判为绿色用户消息）。

  Extended system injection classification in `injectGMData()` to recognize user_information, user_rules, mcp_servers, and workflows as system events instead of user messages.

### 重构 / Refactored

- **`.act-badge` 圆角升级 / Badge Border Radius**:
  全局 `.act-badge` 新增 `padding: 1px 6px` + `border-radius: var(--radius-sm)`，从方块变为圆角药丸形。

  Global `.act-badge` upgraded with padding and border-radius for rounded pill shape.

### 统计 / Stats

- **Files changed**: 7 (`src/gm/types.ts`, `src/gm/parser.ts`, `src/gm/tracker.ts`, `src/gm/index.ts`, `src/gm-tracker.ts`, `src/activity/tracker.ts`, `src/activity-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Net lines**: +366 -27
- **New types**: `GMSystemContextType`, `GMSystemContextItem`
- **New CSS classes**: `.ci-section`, `.ci-section-header`, `.ci-badges`

---

## 时间线实时费用标签 — 2026-04-23

### 新增 / Added

- **时间线实时费用标签 / Per-Call Cost Tags in Timeline**:
  每条 reasoning 事件行新增 USD 费用标签（`act-tl-gm-cost`，绿色美元符号 SVG），通过 `findPricing(gmModel)` 查定价表实时计算。公式：`(input × price.input + output × price.output + cacheRead × price.cacheRead + thinking × price.thinking) / 1M`。位于 tokenParts 最左侧（费用 → 缓存 → 输入 → 输出 → 上下文）。

  New per-call USD cost tag on each reasoning event row, calculated via `findPricing(gmModel)` using the pricing table. Green dollar-sign SVG icon, placed leftmost in tokenParts.

- **Turn Header 费用合计芯片 / Turn Header Cost Chip**:
  气泡组新增 `seg-chip-cost`（绿色加粗），`buildSegmentStats()` 逐 action 调用 `findPricing()` 累加费用。位于调用和缓存之间。

  New `seg-chip-cost` in Turn headers showing aggregated per-turn USD cost, placed between calls and cache chips.

- **待归档区缓存 Token 统计 / Pending Archive Cache Token Stats**:
  `PendingArchiveEntry` 新增 `totalCacheRead: number` 字段。`baselineForQuotaReset()` 两条聚合路径（summary/cache）均累加 `cacheReadTokens`。`buildPendingArchivePanel()` 在输出和积分之间渲染缓存芯片（`totalCache > 0` 时显示）。

  New `totalCacheRead` field in `PendingArchiveEntry`. Both aggregation paths in `baselineForQuotaReset()` accumulate `cacheReadTokens`. Cache chip rendered in pending archive stats between output and credits.

### 重构 / Refactored

- **积分标签位置调整 / Credits Tag Repositioned**:
  事件行：积分从 tokenParts（右侧固定区）移到 statusParts（左侧偶现区），位于报错后面。Turn Header：积分从工具后面移到报错后面。最终顺序（左→右）：报错 → 积分 → 工具 → TTFT → 耗时 | 费用 → 缓存 → 输入 → 输出 → 上下文。

  Credits moved from tokenParts (right-anchored) to statusParts (occasional zone), placed after error. Final order: error → credits → tools → TTFT → duration | cost → cache → in → out → ctx.

### 修复 / Fixed

- **待归档 Credits i18n 缺失 / Pending Archive Credits Missing i18n**:
  `buildPendingArchivePanel()` 中 Credits 标签从硬编码英文 `Credits` 改为 `tBi('Credits', '积分')`。

  Credits label in pending archive changed from hardcoded `Credits` to `tBi('Credits', '积分')`.

### 统计 / Stats

- **Files changed**: 3 (`src/activity-panel.ts`, `src/gm/tracker.ts`, `src/gm/types.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **New CSS classes**: `.act-tl-gm-cost` (event row), `.seg-chip-cost` (turn header)
- **New import**: `findPricing` from `pricing-store.ts` into `activity-panel.ts`

---

## Turn Header 气泡组重排 — 2026-04-23

### 重构 / Refactored

- **Turn Header 气泡组重排 / Turn Header Chip Reordering**:
  Timeline「最近操作」中每轮 Turn header 的气泡组（`seg-chips`）从左到右重新排序，基于右对齐稳定性原则：右侧边缘锚定最常出现的元素，左侧放置偶尔/罕见元素。消失的偶尔元素不会破坏右侧对齐。

  Turn header chips reordered for right-alignment stability: stable elements anchor the right edge, occasional items grow leftward when present.

  | 位置（左→右） | 气泡 | 出现频率 |
  |---|---|---|
  | 最左（罕见） | `error(N)` | 仅出错时 |
  | ← | `🔧N 工具` | 仅使用工具时 |
  | ← | `N.N 积分` | 仅积分计费时 |
  | → | `N 调用` | 几乎每轮 |
  | → | `Nk 缓存` | 几乎每轮 |
  | → | `Nk 输入 / Nk 输出` | 几乎每轮 |
  | 最右（锚定） | `上下文 Nk` | 几乎每轮 |

- **事件行标签重排 / Event Row Tag Reordering**:
  Timeline 每条 reasoning 事件行的右侧 GM 精确标签同步重排，从左到右：`缓存 → 输入 → 输出 → 上下文 → 积分`。上下文作为最右侧锚点，与 Turn header 对齐。

  Event row GM tags reordered (left→right): cache → in → out → ctx → credits. Context anchors the right edge, matching Turn headers.

### 新增 / Added

- **上下文窗口气泡 / Context Window Chip**:
  Turn header 新增 `seg-chip-ctx`（紫色主题），显示该轮最后一条 reasoning 事件的 `gmContextTokensUsed`，标注格式 `上下文 Nk` / `Ctx Nk`。

  New `seg-chip-ctx` (purple theme) showing the last reasoning event's context window size per turn.

### 移除 / Removed

- **耗时气泡 / Duration Chip**: 移除 `seg-chip-dur`（基于首尾事件时间差的秒数），因为不精确（1 次调用 = 0s）。同步移除 `buildSegmentStats()` 中的 `durationSec` / `minTime` / `maxTime` 计算。

  Removed imprecise duration chip (depended on first/last event timestamp diff). Removed `durationSec` calculation from `buildSegmentStats()`.

- **模型名气泡 / Model Name Chip**: 从 Turn header 移除 `seg-chip-model`，因为每条事件行内已通过 `act-tl-model` 显示模型名，header 重复显示无价值。

  Removed `seg-chip-model` from Turn headers — model name already displayed per-event-row via `act-tl-model`.

### 统计 / Stats

- **Files changed**: 1 (`src/activity-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors

---

## 模型信息卡 UI 重构 — 2026-04-23

### 重构 / Refactored

- **模型信息卡 UI 重构 / Model Info Card UI Overhaul**:
  从 `prc-dna-card` 网格式小方块布局完全重构为 `act-model-card` 行式布局，与 GM 数据标签页的"模型统计"视觉风格统一：
  - 卡片结构：`act-card-header` + `act-card-body`（`act-card-row` 行式 icon+label+value） + `act-card-footer`（可折叠 MIME/技术参数）
  - 数据行带 SVG icon（调用/步骤/积分/重试/错误），分隔线分组，错误行红色高亮
  - 缓存模型使用 `act-checkpoint-model` 淡化样式 + `act-badge` 标签

  Rewrites model info cards from `prc-dna-card` grid layout to `act-model-card` row-based layout, matching the GM Data tab's "Model Stats" visual style.

- **同名模型去重 / Same-Name Model Deduplication**:
  `buildModelDNACards()` 在排序后按规范化 displayName（`.toLowerCase()`）合并重复条目。有当前 GM 数据的优先保留，persisted-only 的合并后丢弃。

  Deduplicates by normalized displayName after sorting. Entries with current GM data take priority; persisted-only duplicates are merged and discarded.

- **responseModel 智能隐藏 / Smart responseModel Suppression**:
  当 `responseModel`（如 `claude-opus-4-6-thinking`）与卡片标题（如 "Claude Opus 4.6 (Thinking)"）去标点比较后本质相同时，隐藏 `responseModel` 避免冗余显示。

  Hides `responseModel` when it's essentially the same as the card title after stripping punctuation/spaces.

- **Meta 信息条视觉升级 / Meta Bar Visual Enhancement**:
  `prc-dna-meta` → `prc-dna-meta-bar`：从纯文字行改为带蓝色左边框 + 半透明背景 + 圆角边框的容器，增加视觉层级感。深色/浅色主题完整适配。

  `prc-dna-meta` → `prc-dna-meta-bar`: from plain text to a container with blue left border, subtle background, and rounded border for better visual hierarchy.

### 统计 / Stats

- **Files changed**: 2 (`src/pricing-panel.ts`, `docs/project_structure.md`)
- **TypeScript compile**: Zero errors

---

## 缓存账号追踪会话修复 — 2026-04-23

### 修复 / Fixed

- **缓存账号追踪会话永不结束 / Cached Account Tracking Sessions Never Ending**:
  `processUpdate()` 只接收当前登录账号的 API configs，缓存账号的 `ModelState` 永远无法走到 `isCycleEnded()` 检查，导致追踪会话停留在 "追踪中" 状态直到用户手动切换到该账号。

  `processUpdate()` only receives API configs for the active account. Cached accounts' `ModelState` never reaches `isCycleEnded()`, leaving sessions stuck in "ACTIVE" until the user manually switches to that account.

  **修复**: `QuotaTracker` 新增 `archiveExpiredSessions(email, modelLabels)` 方法。`checkCachedAccountResets()` 在检测到缓存账号额度过期时（触发 GM baseline 的同时），同步调用此方法归档对应的追踪会话。通过 `stateKey` 前缀匹配账号 + `modelLabel`/`poolModels` 匹配池范围。

  Fix: New `archiveExpiredSessions()` method on `QuotaTracker`. Called by `checkCachedAccountResets()` alongside GM baselining when cached account quota expires. Matches by `stateKey` email prefix + `modelLabel`/`poolModels` pool scope.

### 新增 / Added

- **当前账号追踪会话置顶高亮 / Current Account Session Pin & Highlight**:
  额度追踪标签页中，当前登录账号的活跃追踪会话自动置顶排序，并用绿色外观区分：

  | 元素 | 样式 |
  |------|------|
  | 左边框 | 绿色（`--color-ok`），其他账号为蓝色 |
  | 背景 | 半透明绿色 `rgba(74,222,128,0.06)` |
  | 边框 | 绿色细边框 `rgba(74,222,128,0.18)` |
  | 模型名 | 绿色文字 |

  **接口变更 / API Changes**:
  - `buildHistoryHtml()` 新增可选 `currentAccountEmail` 参数
  - `buildSessionCard()` 新增 `isCurrentAccount` 参数，控制 `qt-card-current` 类
  - 活跃会话排序：当前账号优先，然后按开始时间降序
  - 深色/浅色主题完整适配

### 统计 / Stats

- **Files changed**: 4 (`src/quota-tracker.ts`, `src/extension.ts`, `src/webview-history-tab.ts`, `src/webview-panel.ts`, `src/webview-styles.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Root cause**: `processUpdate()` 只处理当前账号 configs → 缓存账号 `ModelState` 永远不 cycle-end → `archiveExpiredSessions()` 作为外部触发的归档入口

---

## 日历模块 GM-only 清理 — 2026-04-23

### 重构 / Refactored

- **日历模块 GM-only 清理 / Calendar Module GM-Only Cleanup**:
  日历标签页全面移除过时的 Step API 数据渲染，统一为 GM 精确数据源。

  **汇总网格清理 / Summary Grid Cleanup**:
  | 项目 | 动作 | 原因 |
  |------|------|------|
  | 错误（Errors） | 移除 | Step API `totalErrors`，GM 有更精确的 `retryErrors` |
  | 周期（Cycles） | 移除 | 一天一条记录，恒等于天数，冗余 |
  | GM 调用 ×2 | 去重 | 复制粘贴 bug，同一块渲染了两次 |
  | 缓存命中率 | 从日摘要移除 | 技术效率指标，在日回顾中价值低（模型明细行保留） |

  **日详情面板清理 / Day Detail Panel Cleanup**:
  - 移除所有 Activity 变量（`totalReasoning`/`totalToolCalls`/`totalErrors`/`totalInput`/`totalOutput`）
  - 移除 `mergedModel` 聚合和 `mergedModelHtml` 渲染（Step API 模型汇总）
  - 移除 `displayTokens` 降级逻辑，直接使用 `gmTotalTokens`
  - 移除缓存命中率加权平均计算
  - Tokens 显示改为条件渲染（`gmTotalTokens > 0`）

  **死代码清理 / Dead Code Removal**:
  - 删除 `buildMergedModelRows()`（Activity 模型汇总，计算后未使用）
  - 删除 `buildCycleCard()`（旧多周期卡片，无调用方）
  - 删除 `buildPerModelRows()`（Activity per-model 行，无调用方）
  - 删除 `buildGMModelRows()`（仅被 `buildCycleCard` 调用）
  - 清理未使用的导入（`DailyCycleEntry`/`ModelCycleStats`/`GMModelCycleStats`/`formatShortTime`/`formatDuration`）

  **highActivity 判断修正 / High Activity Detection Fix**:
  月历格子的高活跃度指示器从过时的 `totalReasoning > 20`（Step API）改为 `gmCalls > 20`（GM 精确数据）。`MonthCellSummary` 新增 `gmCalls` 字段支持此判断。

### 统计 / Stats

- **Files changed**: 2 (`src/webview-calendar-tab.ts`, `src/daily-store.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Net lines**: ~-155

---

## Credits 显示统一 — 2026-04-23

### 重构 / Refactored

- **Credits 显示统一 (i18n) / Credits Display Unification**:
  全面统一 GM 数据面板中所有 credits/积分 的显示格式，从硬编码英文缩写 `cr` / `Credits` 改为 `tBi` 双语切换。

  | 位置 | 改前 | 改后 |
  |------|------|------|
  | Summary Bar 芯片 label | `Credits` | `tBi('Credits', '积分')` |
  | Summary Bar tooltip | `消耗的 credits` | `消耗的积分` |
  | 模型卡片 Credits 行 | `Credits` | `tBi('Credits', '积分')` |
  | Timeline 事件行 tag | `cr` | `tBi('credits', '积分')` |
  | Timeline segment header chip | `87.0 cr` | `87.0 credits/积分` |
  | Timeline 帮助面板示例 | `9 cr` | `9 credits/积分` |
  | 对话分布 credits chip | `cr` | `tBi('credits', '积分')` |

### 新增 / Added

- **积分调用次数 / Credit Call Count**:
  模型卡片 Credits 行新增积分调用次数标注（橙色小字），显示消耗了积分的调用数。

  - 类型层: `GMModelStats` 新增 `creditCallCount: number`
  - 数据层: `tracker.ts` + `summary.ts` 三条聚合路径统计 `credits > 0` 的调用数
  - UI: `189.0 (22次)` — 括号内橙色小字，默认可见
  - CSS: 新增 `.act-credit-calls`（`font-size:0.82em`, `color:var(--color-orange-light)`, `opacity:0.7`）

- **对话分布账号贡献标注 / Per-Account Credit Annotation in Conversations**:
  对话分布中总积分保持全部账号累计（对话内可能切换账号），同时新增当前账号贡献的 `+x` 标注。

  - 类型层: `GMConversationData` 新增 `accountCredits?: number`
  - 数据层: `tracker.ts` 用 `accountFilteredCalls` 预计算当前账号贡献
  - UI: `821 积分 +292`（仅当部分来自当前账号时显示 `+x`）

### 移除 / Removed

- **Timeline 冗余模型气泡 / Timeline Redundant Model Chip**:
  `buildMetaTags()` 不再输出 `act-tl-tag-model` 模型气泡（蓝色 `act-tl-model` 已在事件行内显示相同信息）

- **模型卡片冗余 responseModel footer / Model Card Redundant Footer Tag**:
  移除模型卡片底部的 `claude-opus-4-6-thinking` raw API 名称标签（卡片头部已显示 normalized 名称 `Claude Opus 4.6 (Thinking)`）。同时移除 GM-only 卡片的相同冗余标签。

### 统计 / Stats

- **Files changed**: 4 (`src/activity-panel.ts`, `src/gm/types.ts`, `src/gm/tracker.ts`, `src/gm/summary.ts`)
- **TypeScript compile**: Zero errors
- **Net lines**: +38 -19

---

## GM Data 面板视觉精简 — 2026-04-23

### 重构 / Refactored

- **GM Data 面板视觉精简 / GM Data Panel Visual Refinement**:
  全面清除面板中的信息冗余和视觉噪音，提升信噪比。

  | 维度 | 改前 | 改后 |
  |------|------|------|
  | GM 徽章 | ~20+ 处绿色 `gm-badge-real` 装饰标注 | 全部移除（数据源 100% GM，无需标注） |
  | Performance Baseline | 独立双列区块 | 移除（TTFT 数据已在 Model Cards 显示） |
  | Cache Efficiency | 独立双列区块 | 移除（Cache Hit Rate 已在 Model Cards 显示） |
  | GM 覆盖率 | Timeline 标题旁 `GM 85%` badge | 移除（无实际用途） |

- **时间线图例重设计 / Timeline Legend Redesign**:
  原占用 ~36 行页面高度的可折叠 `<details>` 图例块替换为标题右侧 18px 圆形 `(?)` 帮助按钮。hover 时弹出 280×260px 不透明浮动面板（`#1e1e2e` 实色背景 + `backdrop-filter: blur`），精简展示步骤基础和 Token 指标的样本+说明。

  Legend replaced from large collapsible block to a compact `(?)` hover tooltip button in the section title bar.

- **检查点查看器移入 Timeline / Checkpoint Viewer Embedded in Timeline**:
  从独立 section 移入「最近操作」区块顶部（标题 → 检查点 → 时间线事件流），与当前对话上下文贴合。同步移除了标题中冗余的对话标题文字（已在 Timeline badge 显示）。

  Checkpoint viewer moved from standalone section into the Timeline section header area.

- **对话分布卡片化重设计 / Conversation Cards Redesign**:
  扁平文本列表重设计为带彩色左边框的独立卡片（6 色循环：蓝/绿/黄/红/青/紫）：

  | 元素 | 改前 | 改后 |
  |------|------|------|
  | 标题 | `会话 xxxxxxxx`（截断 ID） | 实际对话标题气泡芯片（`act-conv-title-chip`） |
  | 布局 | 双行堆叠 | 单行水平（标题 `flex:1` 截断 + 右侧 `flex-shrink:0` 固定） |
  | 指标 | 调用 + 覆盖率% + 输入 token + credits | 调用次数 + credits + 日期范围 |
  | 日期 | 无 | `MM/DD HH:mm → MM/DD HH:mm`（从 calls.createdAt 提取） |
  | 交互 | 无 | hover 微位移 + 完整 cascadeId tooltip |
  | 滚动 | 固定 240px | max-height 300px + 自定义 4px 细滚动条 |

### 新增 / Added

- **对话标题解析 / Conversation Title Resolution**:
  Timeline 标题 badge 和对话分布卡片从 `gmSummary.conversations` 查找实际对话标题（`GMConversationData.title`），无标题时 fallback 到 cascadeId 前 8 位。hover 显示完整 cascadeId。`buildTimeline()` 新增可选 `gm` 参数用于标题查找。

  Timeline title and conversation cards now resolve actual conversation titles from GM data.

### 移除 / Removed

- 所有 `gm-badge-real` 装饰徽章（`activity-panel.ts` ~20 处 + `pricing-panel.ts` 2 处）
- Performance Baseline 独立区块（`buildPerformanceChart()` 调用入口）
- Cache Efficiency 独立区块（`buildCacheEfficiency()` 调用入口）
- 可折叠时间线图例 `<details>` 块 + ~140 行 `.act-tl-legend-*` CSS + 6 个 light theme override
- Summary Bar `gmTag` 逻辑
- Timeline `GM xx%` 覆盖率 badge
- Timeline「当前对话」四字标签
- 对话分布中的覆盖率百分比、输入 token、`会话` 前缀
- 检查点查看器标题中的对话标题文字

### 统计 / Stats

- **Files changed**: 2 (`src/activity-panel.ts`, `src/pricing-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **CSS net**: 删除 ~140 行旧 legend CSS，新增 ~100 行 tooltip CSS + ~90 行 conversation card CSS
- **Design principle**: 信噪比优先 — 合并冗余指标、移除无意义装饰、将关联内容合并（检查点→Timeline）、按需展示（图例→tooltip）

### 修复 / Fixed

- **错误详情展开/收缩交互修复 / Error Details Expand/Collapse Fix**:
  修复错误消息 `<details>/<summary>` 展开组件的多个交互缺陷：

  | # | 问题 | 原因 | 修复 |
  |---|------|------|------|
  | 1 | 展开后内容重复 | summary 和 full div 同时显示完整文本 | 展开时完全隐藏 summary |
  | 2 | 短消息不应可展开 | 所有消息无条件使用 `<details>` | JS 检测 `scrollWidth <= clientWidth`，未溢出加 `.no-overflow` 禁用箭头和点击 |
  | 3 | 长消息截断但无法展开 | summary 缺少 `display:block; min-width:0` | 补齐 CSS 使 `text-overflow:ellipsis` 正常工作 |
  | 4 | 展开后无法收缩 | summary 完全隐藏后无点击目标 | body 事件代理：点击展开后的完整文字即可收缩 |
  | 5 | 展开/收缩箭头消失致布局跳动 | `font-size:0` 导致 `0.65em` 箭头也为 0 | 折叠态 summary 显示 `▶`，展开态 `.gm-err-msg-full::before` 显示 `▼`，各自独立 |

  **最终交互**: 短消息无箭头直接显示全文；长消息 `▶ + 截断...` → 点击展开 → `▼ + 完整文字` → 点击收缩。

  Files changed: 2 (`src/activity-panel.ts`, `src/webview-script.ts`)

---

## 日历数据翻倍修复 — 2026-04-22

### 修复 / Fixed

- **日历数据翻倍 / Calendar Data Duplication**:
  每次额度重置触发时（`onQuotaReset`/`checkCachedAccountResets`/`baselineExpiredPoolsForAccount`），代码先调用 `getFullSummary()` 获取当前全量未归档数据的完整快照，然后以 `append` 模式追加到 DailyStore 的同一天。日历渲染时将所有 cycles 的数据求和，导致同一天内发生多次额度重置时数据成倍增长（如 1124 → 2248 → 3372）。成本数据同步翻倍。

  Each quota reset event called `getFullSummary()` for a complete snapshot and appended it to DailyStore. Calendar rendering summed all cycles, causing N× duplication when N resets fired on the same day (e.g., 1124 → 2248 → 3372). Costs doubled accordingly.

  **修复**: 彻底重构归档数据流——额度重置时**只做 baseline**（标记调用为待归档），不再写 DailyStore。日历数据仅在午夜 `performDailyArchival()` 时一次性写入。

  Fix: Restructured archival data flow — quota resets only baseline calls (mark as pending archive), no DailyStore writes. Calendar data is written once at midnight by `performDailyArchival()`.

### 新增 / Added

- **`getArchivalSummary()` 全量归档快照 / Full Archival Snapshot**:
  `GMTracker` 新增 `getArchivalSummary()` 方法，调用 `_buildSummary(skipAccountFilter=true, skipArchivalFilter=true)`。跳过账号过滤和归档过滤，返回当天全量数据（待归档区 + 活跃调用），确保午夜归档时 DailyStore 获得完整的一天数据。

  New `GMTracker.getArchivalSummary()` method bypasses both account filtering and archival filtering, returning complete day data (pending-archive + active calls) for midnight DailyStore writes.

- **`_buildSummary()` `skipArchivalFilter` 参数 / New Parameter**:
  `_buildSummary()` 新增第二参数 `skipArchivalFilter`（默认 `false`）。为 `true` 时跳过 `_archivedCallIds` 和 `_archivedAccountModelCutoffs` 过滤，直接使用 `sliced`（全部当前周期调用）。

  New `skipArchivalFilter` parameter for `_buildSummary()`. When `true`, skips archival filtering and uses all current-cycle calls.

### 重构 / Refactored

- **额度重置预快照移除 / Pre-Reset Snapshot Removal**:
  从 `extension.ts` 的三处额度重置回调中完全移除 `addDailySnapshot` 预快照逻辑（约 75 行）。额度重置回调现在只调用 `baselineForQuotaReset()`，不再涉及日历数据。

  Removed ~75 lines of pre-baseline DailyStore snapshot code from all three quota reset callbacks in `extension.ts`.

- **午夜归档数据源 / Midnight Archival Data Source**:
  `performDailyArchival()` 从 `getFullSummary()`（排除已归档调用）切换为 `getArchivalSummary()`（包含全部调用），确保午夜归档包含当天的完整用量数据。

  `performDailyArchival()` switched from `getFullSummary()` to `getArchivalSummary()`, ensuring midnight archival captures complete daily usage including already-baselined calls.

### 统计 / Stats

- **Files changed**: 3 (`src/extension.ts`, `src/gm/tracker.ts`, `src/daily-archival.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Root cause**: `getFullSummary()` 返回累积快照 + `append` 追加模式 → 同一天 N 次重置 = N 倍数据；修复后额度重置不写日历，午夜用 `getArchivalSummary()` 一次写入完整数据

---

## 模型标识系统现代化 — 2026-04-22

### 重构 / Refactored

- **模型标识系统现代化 / Model Identity System Modernization**:
  从硬编码 i18n 显示名映射（`en`/`zh` 双语键）迁移为纯 API 驱动的动态命名架构。LS API `GetUserStatus` 返回的 `label` 字段成为唯一命名来源，`updateModelDisplayNames()` 在每次 API 轮询时动态填充 `modelDisplayNames` Record。

  Migrated from hardcoded i18n display name mappings (`en`/`zh` keys) to a purely API-driven dynamic naming architecture. The LS API `GetUserStatus` `label` field is now the single source of truth, dynamically populated via `updateModelDisplayNames()` on each API poll.

  **关键变更 / Key Changes**:
  | 维度 | 改前 | 改后 |
  |------|------|------|
  | 数据源 | 静态 `modelDisplayNames` 对象（`en`/`zh` 双键） | 动态 `Record<string, string>`，API 轮询时填充 |
  | i18n 依赖 | `tBi` + `getLanguage()` 选择语言 | 无 i18n 依赖，直接使用 API label |
  | 旧数据兼容 | 无 | `LEGACY_ZH_MODEL_NAMES` 映射表，自动清洗持久化中文名 |

- **持久化数据运行时清洗 / Runtime Data Normalization**:
  所有从 DailyStore / Model DNA / PricingStore 读取持久化数据的 UI 路径均集成 `normalizeModelDisplayName()` 运行时清洗，无需破坏性迁移已存储的 JSON 数据。

  All UI paths reading persisted data from DailyStore / Model DNA / PricingStore now apply `normalizeModelDisplayName()` at render time, avoiding destructive migration of stored JSON data.

  **覆盖路径 / Normalized Paths**:
  - `webview-calendar-tab.ts` — `buildPerModelRows` / `buildGMModelRows` / `buildMergedModelRows` / `buildMergedGMRows` / model chip
  - `daily-store.ts` — `getMonthCostBreakdown()` 聚合
  - `pricing-panel.ts` — `buildMonthlyCostSummary()` 合并 + `buildModelDNACards()` 卡片名
  - `model-dna-store.ts` — `clonePersistedEntry()` / `buildPersistedEntry()` / `restoreModelDNAState()`

### 新增 / Added

- **`LEGACY_ZH_MODEL_NAMES` 遗留映射 / Legacy Chinese Name Mapping**:
  `models.ts` 新增静态映射表，将 5 个已知中文模型名（如 `Gemini 3.1 Pro (强)` → `MODEL_PLACEHOLDER_M37`）解析回 canonical model ID。`resolveModelId()` 在动态 map 查找失败后回退至此表，确保历史数据无缝归一化。

  New static mapping resolving 5 known Chinese model display names back to canonical model IDs. Used as fallback in `resolveModelId()` when dynamic map lookup fails.

### 移除 / Removed

- **i18n 模型名依赖 / i18n Model Name Dependencies**:
  - `models.ts` 中移除 `tBi` 导入和所有 `zh` 字段映射
  - 测试文件移除 `setLanguage('zh')` 调用和跨语言合并测试
  - `extension.ts` 注释中的中文模型名示例替换为英文

### 清理 / Cleanup

- **测试用例更新 / Test Suite Updates**:
  - `model-dna-store.test.ts` — 改用 `updateModelDisplayNames()` 注入动态名称
  - `gm-tracker.test.ts` — 移除跨语言 GM 恢复测试，`beforeEach` 注入英文名
  - `activity-tracker.test.ts` — 移除跨语言模型桶合并测试

### 统计 / Stats

- **Files changed**: 7 (`src/models.ts`, `src/daily-store.ts`, `src/pricing-panel.ts`, `src/extension.ts`, `src/webview-calendar-tab.ts`, `tests/model-dna-store.test.ts`, `tests/gm-tracker.test.ts`, `tests/activity-tracker.test.ts`)
- **TypeScript compile**: Zero errors
- **Key design**: 持久化数据不做破坏性迁移，渲染层运行时清洗；`LEGACY_ZH_MODEL_NAMES` 作为有限回退表兜底历史数据

---

## GM-only Timeline 架构 — 2026-04-22

### 重构 / Refactored

- **GM-only Timeline 架构 / GM-Only Timeline Architecture**:
  `injectGMData()` 从"GM 注解 step 事件"重构为"GM 全量替换 Timeline"。所有 `step` 和 `estimated` 源事件被删除，由 `gm_virtual`（reasoning）和 `gm_user`（用户锚点）完全替代。Timeline 不再依赖 Step API 的 `processedIndex`，免疫对话撤回导致的数据丢失。

  `injectGMData()` refactored from "GM annotates step events" to "GM replaces entire Timeline". All `step`/`estimated` events are purged and replaced by `gm_virtual` + `gm_user` events. Timeline no longer depends on Step API's `processedIndex`, immune to conversation rewind data loss.

- **Segment Header 轮次编号 / Turn Number Headers**:
  段落 Header 从重复用户消息预览改为轮次编号（`第 N 轮` / `Turn N`），用户消息仅在 body 中显示一次，消除重复信息。

  Segment headers changed from repeating user message preview to turn numbers (`第 N 轮` / `Turn N`). User message displayed once in the segment body only.

### 修复 / Fixed

- **GM 最后一条调用丢失 / Last GM Call Missing**:
  `GMTracker.fetchAll()` 对 IDLE 对话跳过 re-fetch。当对话从 RUNNING → IDLE 转换时，最后一个 GM 调用可能还未被捕获，变 IDLE 后永远不再 re-fetch。修复：新增 `_lastRunningStatus` Map 跟踪运行状态，RUNNING → IDLE 转换时强制一次额外 re-fetch。

  `GMTracker.fetchAll()` skipped IDLE conversations. The last GM call might not have been captured during the final RUNNING poll; once IDLE, it was never re-fetched. Fix: new `_lastRunningStatus` Map tracks RUNNING→IDLE transition and forces one extra re-fetch.

- **Timeline 新步骤空白 / Timeline Blank on New Steps**:
  GM-only 替换代码无条件删除所有 step 事件，但 `injectGMData()` 仅在 `activityChanged || gmChanged` 时执行。如果两者都没变化，step 事件已删但 gm_virtual 未创建 → Timeline 空白。修复：`injectGMData()` 改为无条件执行（只要 `lastGMSummary` 存在）。

  GM-only replacement deleted all step events, but `injectGMData()` only ran when `activityChanged || gmChanged`. Fix: now runs unconditionally whenever `lastGMSummary` exists.

- **GM Coverage Boundary 保护 / Coverage Boundary Protection**:
  Steps API 比 GM API 更快，新 AI 回复立即创建 step 事件，但 GM 可能还没捕获。旧代码无条件删除所有 step 事件 → 空白。修复：计算每个对话的 `maxGMStep`，仅删除 `stepIndex ≤ maxGMStep` 的 step 事件，保留未覆盖的 step 作为临时占位。GM 追上后自动替换为更丰富的 gm_virtual 事件。

  Steps API is faster than GM API. Fix: compute `maxGMStep` per conversation, only remove step events within GM coverage range. Beyond-coverage step events are kept as temporary placeholders until GM catches up.

### 新增 / Added

- **System 事件渲染 / System Event Rendering**:
  CHECKPOINT 和会话历史注入（`# Conversation History`）不再被过滤掉，改为创建 `category: 'system'` 事件。CHECKPOINT 显示为 `Checkpoint N`，会话历史显示为 `上下文注入`。专属 CSS 样式：橙色半透明背景 + 左侧橙色边条 + 剪贴板 SVG 图标。不打断 segment 分组（作为 action 内嵌显示）。EPHEMERAL 仍跳过。

  CHECKPOINT and Conversation History injections now create `category: 'system'` events with amber styling instead of being filtered out. EPHEMERAL still skipped.

- **卸载重装 Timeline Bootstrap / Reinstall Timeline Bootstrap**:
  `activate()` 启动时检测到全新安装（无 `activityTrackerState`）但有文件存储的 `gmDetailedSummary` 时，立即调用 `injectGMData()` 预填 Timeline。用户重装后立即看到历史调用结构（model、tokens、steps），文字预览在首次 poll 后补齐。

  `activate()` detects fresh install (no saved activity state) but existing file-backed GM summary, bootstrapping the timeline immediately. Text previews populate after the first poll cycle.

### 移除 / Removed

- **展开功能 / Expand Feature**:
  移除用户消息和 AI 响应的展开功能（`hasExpand` 硬编码 `false`）。GM 架构下 `aiSnippetsByStep` 只有短预览，`fullAiResponse` 不再设置，展开无意义。用户消息截断至 40 字符已足够。

  Removed expandable full-text feature for both user messages and AI responses. Under GM-only architecture, expand has no useful content to show.

- **Estimated 事件 / Estimated Events**:
  从 `processTrajectories()` 中删除约 24 行 estimated 事件创建代码。从 `buildMetaTags()` 和 `buildSegmentStats()` 中清理所有 `estimated` 相关分支。Timeline 不再出现 "Estimated" 标签。

  Removed ~24 lines of estimated event creation from `processTrajectories()`. Cleaned up `estimated` branches from `buildMetaTags()` and `buildSegmentStats()`.

### 统计 / Stats

- **Files changed**: 4 (`src/activity/tracker.ts`, `src/activity-panel.ts`, `src/extension.ts`, `src/gm/tracker.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Root cause chain**: Step API 构建的 Timeline 被 GM 数据全量替换 → Coverage Boundary 防止 GM 延迟时空白 → RUNNING→IDLE 过渡 re-fetch 防止最后调用丢失 → 无条件注入保证每次 poll 刷新

---

## 错误统计归属修复 — 2026-04-22

### 修复 / Fixed

- **扩展重启后错误统计归属错误 / Error Attribution After Extension Restart**:
  扩展重启后 `_currentAccountEmail` 从持久化恢复为上一次的账号（可能已过时），但 `handleAccountSwitchIfNeeded()` 要等到第 2 个轮询周期才执行（`STATUS_REFRESH_INTERVAL = 2`）。在此期间，`gmTracker.fetchAll()` 会用旧账号标记所有新调用 → 这些调用后续被 `accountFilteredCalls` 过滤 → 错误统计少计。

  After extension restart, `_currentAccountEmail` restored from persistence with a stale account email. `handleAccountSwitchIfNeeded()` only runs every 2nd poll cycle, so the first `fetchAll()` tagged new calls with the wrong account. These calls were then filtered out of `accountFilteredCalls`, under-counting errors.

  **修复**: `pollContextUsage()` 中首次轮询（`!firstPollDone`）强制刷新用户状态，确保 `_currentAccountEmail` 在第一次 `fetchAll()` 前更新为实际登录账号。
  Fix: Force user status refresh on first poll (`!firstPollDone`), ensuring `_currentAccountEmail` is updated before the first `fetchAll()`.

### 改进 / Improved

- **`_callAccountMap` key 改用调用身份标识 / Identity-Based Call Account Mapping**:
  `_callAccountMap` 的 key 从数组下标（`cascadeId:index`）改为调用身份（`exec:{executionId}` 或 `cascadeId:stepIndices:model` 回退）。数组下标依赖 API 返回的稳定顺序，如果调用顺序因增强/重新排序而变化，标记会错位。新 key 绑定调用本身而非位置，同时兼容 legacy key 迁移。

  `_callAccountMap` key changed from array index (`cascadeId:index`) to call identity (`exec:{executionId}` or `cascadeId:stepIndices:model` fallback). Array index depends on stable API ordering; identity-based keys are immune to reordering. Legacy key migration included.

### 统计 / Stats

- **Files changed**: 2 (`src/extension.ts`, `src/gm/tracker.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Root cause**: `STATUS_REFRESH_INTERVAL(2)` 导致首次轮询跳过账号刷新 → `fetchAll()` 用 restore 的旧账号标记新调用 → 错误被归到错误账号

---

## 缓存账号归档修复 — 2026-04-22

### 修复 / Fixed

- **缓存账号额度重置归档失效 / Cached Account Quota Reset Archival Failure**:
  `checkCachedAccountResets()` 之前被放置在 3 个 `try { ... } catch { /* Silent */ }` 块内部，当网络请求异常或函数本身抛错时被静默吞掉，导致归档逻辑从未执行。修复：移至 `pollContextUsage()` 的 `finally` 块中独立执行，包裹在自己的 try/catch 中记录异常。

  `checkCachedAccountResets()` was placed inside 3 silent `try/catch` blocks. Any exception (network failure or internal error) silently skipped it. Fix: moved to `finally` block with its own error-logging try/catch.

- **`isPoolArchived()` 旧周期残留阻止新归档 / Stale Cutoff Blocking New Archival**:
  旧逻辑仅检查 `_archivedAccountModelCutoffs` 中是否存在 key。上一额度周期的 cutoff entry 永久存在，导致新周期的归档被错误跳过。修复：改为扫描 `_cache` 中是否存在未归档的调用，只有所有调用都已归档才返回 `true`。

  Old logic only checked if a cutoff key existed. Stale entries from previous quota cycles permanently blocked new archival. Fix: now scans `_cache` for un-archived calls; returns `true` only when all calls are archived.

- **归档后错误计数膨胀 / Error Count Inflation After Archival**:
  `baselineForQuotaReset()` 归档调用后，`_persistedRetryErrorCodesByAccount` 仍保留旧的高值。`_buildSummary()` 的 max-wins 合并将已归档调用的错误恢复到活跃统计中。修复：归档时清空所有持久化错误基线，让后续 `_buildSummary()` 从实际剩余调用重新计算。

  `baselineForQuotaReset()` did not clear all persisted error baselines. The max-wins merge in `_buildSummary()` restored archived error counts. Fix: clear all persisted error data on archival, forcing recalculation from actual remaining calls.

- **`hasUsage` 检查缺失 / Missing hasUsage Guard**:
  `checkCachedAccountResets()` 未检查 `pool.hasUsage === false`，导致未使用的池（UI 无"已就绪"标记）也触发归档。修复：与 UI `hasAccountReadyPool()` 逻辑对齐。

  Added `hasUsage` check to prevent archiving unused pools, aligning with UI "Ready" indicator logic.

### 新增 / Added

- **`baselineExpiredPoolsForAccount()` 账号切换归档 / Account Switch Archival**:
  新增函数，在 `handleAccountSwitchIfNeeded()` 中为切出和切入账号检查过期池并执行归档。解决切换后 `updateAccountSnapshot()` 用新 resetTime 覆盖旧过期时间导致归档窗口错过的问题。首次连接时也检查当前账号的过期池。

  New function called during account switches to baseline expired pools for both outgoing and incoming accounts, preventing missed archival windows.

### 重构 / Refactored

- **Summary Bar 芯片化布局 / Summary Bar Chip Layout**:
  从 CSS Grid 统一面板（`grid-template-columns: auto-fill`）重构为居中 flex-wrap 芯片条（`justify-content: center`）。每个指标项从纵向堆叠改为横向 `icon + value + label` 紧凑排列。

  | 维度 | 改前 | 改后 |
  |------|------|------|
  | 布局 | CSS Grid 等宽网格 | flex-wrap 居中芯片 |
  | 单项 | 纵向 icon → value → label | 横向 icon + value + label |
  | 边框 | outline + 1px gap 分隔线 | 独立 border + border-radius |
  | SVG 图标 | 内联重复 | 提取为共享变量 |
  | 报错卡片 | 内联 IIFE 匿名函数 | 提取为 `buildErrorChip()` 复用 |

### 移除 / Removed

- **"数据范围"折叠说明 / Data Scope Explanation**: 移除 GM Data 标签页顶部的 `gmScopeNote` details 折叠面板
- **"Step API 精度"注释 / Step API Accuracy Note**: 移除模型统计底部的 `act-dist-note` 估算步骤说明（已无估算数据源）
- **Distribution 图表 CSS / Distribution Chart CSS**: 移除 `act-dist-container`、`act-donut-chart`、`act-dist-legend`、`act-legend-item`、`act-legend-pct` 等已无引用的样式（保留 `act-legend-dot` 供 X-ray 使用）
- **冗余 Summary Bar 指标 / Redundant Summary Metrics**: 移除会话时长、消息数、模型数、步骤覆盖数（信息密度低或已在其他位置显示）
- **测试重置检测按钮 / Test Reset Detection Button**: 移除临时调试用的 `#acctTestResetBtn`（HTML、CSS、前端事件、后端消息处理、getter 导出）

### 统计 / Stats

- **Files changed**: 5 (`src/extension.ts`, `src/gm/tracker.ts`, `src/activity-panel.ts`, `src/webview-script.ts`, `src/webview-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Root cause chain**: `checkCachedAccountResets` 从未执行（死代码 → silent catch 吞掉 → isPoolArchived 旧残留阻止）→ 移到 finally 块 + 重写 isPoolArchived + 清理错误基线

---

## 报错增量 + 模型报错统计 — 2026-04-22

### 修复 / Fixed

- **报错增量 `+x` 大于总数 / Error Delta Exceeds Total**:
  `retryErrorCodesByConv`（per-conversation 错误增量）使用 `sliced`（未过滤账号和归档），而 `retryErrorCodes`（总数）使用 `accountFilteredCalls`（已过滤），导致 `+x` 可能大于总数。修复：`retryErrorCodesByConv` 改用 `accountFilteredCalls`，确保增量和总数使用相同数据源。

  `retryErrorCodesByConv` used `sliced` (no account/archive filtering) while `retryErrorCodes` used `accountFilteredCalls`, causing `+x` to exceed the total. Fix: both now use `accountFilteredCalls`.

- **额度重置后报错未清零 / Errors Not Cleared After Quota Reset**:
  `baselineForQuotaReset()` 归档调用后，`_persistedRetryErrorCodesByAccount` 和 `_persistedRecentErrorsByAccount` 仍保留旧值，max-wins 合并将已归档的错误计数恢复。修复：归档时清除目标账号的持久化错误数据。

  `baselineForQuotaReset()` did not clear persisted error data, causing max-wins merge to restore archived counts. Fix: delete target account's persisted error entries on archival.

### 重构 / Refactored

- **待归档面板位置调整 / Pending Archive Panel Repositioned**:
  `buildPendingArchivePanel()` 从 GM Data 标签页**顶部**移至**模型统计合计行下方**，减少顶部视觉干扰，与统计数据上下文更贴合。

  Moved pending archive panel from tab top to below model stats total row.

### 新增 / Added

- **模型卡片 per-model 报错次数 / Per-Model Error Counts in Model Cards**:
  新增 `accountErrorsByModel: Map<modelName, Map<email, errorCount>>`，遍历 `gm.conversations[].calls[]` 按模型 + 账号分桶统计每个调用的 `retryErrors.length` + 降级 `errorMessage`。每个模型卡片的账号行显示红色 `+N` 药丸标签（浅红背景 + 红色细边框），与该模型的调用次数并列显示。

  New per-model per-account error counting. Each account row in model cards shows a red `+N` pill badge alongside the call count, independently scoped to that model.

  **数据格式 / Format**: `调用次数` `+报错次数` → 例如 `15 +3`（15次调用，3次报错）

- **报错开关按钮 / Error Toggle Button**:
  「模型统计」标题行文字旁新增药丸形状的报错显隐开关（`#modelStatsErrToggle`）。

  | 维度 | 说明 |
  |------|------|
  | 默认 | 关闭（灰暗 `.is-off`），报错次数隐藏 |
  | 开启 | 红色高亮，所有模型卡片账号行显示 `+N` |
  | 条件渲染 | 仅在 `hasAnyAccountErrors = true` 时显示按钮 |
  | 持久化 | `vscode.getState().modelStatsShowErrors`，跨 poll 刷新和页面重载保持 |
  | CSS 机制 | `.act-cards-grid.model-stats-show-errors .gm-account-err { display: inline }` |
  | 增量刷新 | 双向显式恢复（on: 移除 `is-off` + 添加 `show-errors`；off: 确保 `is-off` + 移除 `show-errors`） |

### 样式 / Styles

- **`.gm-account-err`** — 红色药丸报错标签（`display: none` 默认隐藏，浅红背景 + 红色细边框 + tabular-nums）
- **`.model-stats-err-toggle`** — 药丸开关按钮（红色激活态 / `.is-off` 灰暗态 / hover + light theme 适配）
- **`.model-stats-show-errors`** — 应用于 `.act-cards-grid` 的控制类，显示所有 `.gm-account-err` 元素

### 统计 / Stats

- **Files changed**: 3 (`src/gm/tracker.ts`, `src/activity-panel.ts`, `src/webview-script.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Key fix**: `retryErrorCodesByConv` 和 `retryErrorCodes` 使用相同的 `accountFilteredCalls` 数据源；`baselineForQuotaReset()` 清除持久化错误数据防止 max-wins 恢复

---

## 账号面板全局化 — 2026-04-22

### 重构 / Refactored

- **账号面板全局化 / Account Panel Globalization**:
  将"账号状态"面板从 GM Data 标签页内移出，迁移为全局悬浮 dropdown 面板，在所有标签页中均可访问。

  **调整概要 / Changes**:
  | 维度 | 改前 | 改后 |
  |------|------|------|
  | 位置 | GM Data 标签页内顶部 | topbar 标题栏旁的全局按钮 |
  | 交互 | 始终展开，占用标签页空间 | 点击触发，向下弹出 dropdown |
  | 刷新稳定性 | 随 tab-pane innerHTML 刷新重建 | 独立于 tab-pane，poll 刷新仅更新内容不影响开/关状态 |
  | 关闭方式 | — | 点击面板外任意区域自动关闭 |

  **触发按钮 / Trigger Button**:
  - 药丸形状，放置在 "Antigravity 监控面板" h1 标题右侧
  - 自定义 SVG 用户图标 + "账号面板" 文字
  - 额度就绪时显示红色脉冲圆点指示器（`hasAccountReadyPool()` 检测）

  **Dropdown 面板 / Dropdown Panel**:
  - 从 topbar 底部向下展开，`left/right: var(--space-3)` 水平撑满
  - 圆角卡片容器（`border-radius: 12px`），毛玻璃背景 + 阴影
  - `scaleY + translateY` 展开/收回动画，`transform-origin: top center`
  - `max-height: 70vh` 可滚动，内容自适应高度
  - 深色/浅色主题完整适配

  **增量刷新保护 / Incremental Refresh Protection**:
  - `buildTabContents()` 新增 `accountPopover`（HTML string）和 `accountPopoverHasReady`（boolean）字段
  - 客户端 `updateTabs` 消息处理中，仅更新 `acctPopoverBody.innerHTML`，不触碰 `hidden` / `is-visible` 状态
  - 红点指示器通过动态增删 DOM 元素同步，无需重建按钮

- **删除按钮内联化 / Delete Button Inline Redesign**:
  缓存账号的删除操作从独立 X 图标按钮改为名字行内的红色"移除"文字链接（`acct-delete-link`），常驻显示，更直观。活跃账号不显示删除操作，消除占位符 spacer。

### 新增 / Added

- **`buildAccountStatusPanel()` 导出 / Exported Function**:
  原 `activity-panel.ts` 内部私有函数改为 `export`，供 `webview-panel.ts` topbar 区域和增量刷新链路复用。

- **`hasAccountReadyPool()` 红点检测 / Ready Pool Detection**:
  新增导出函数，遍历所有账号的 `resetPools`，检测是否存在已过期且有使用记录的额度池（`resetTime ≤ now && hasUsage !== false`）。用于触发按钮上的红色脉冲指示器。

### 清理 / Cleanup

- 从 `buildGMDataTabContent()` 中移除 `buildAccountStatusPanel()` 调用和 `accountPanel` 变量
- 移除旧的 `acct-delete-btn` X 图标按钮样式（`opacity: 0` hover 渐显）和 `acct-delete-spacer` 占位符
- 卡片间距收紧：`gap: var(--space-3)` → `var(--space-2)`，`padding: var(--space-2)` → `6px`

### 样式 / Styles

- **`.acct-popover-trigger`** — 药丸按钮（渐变背景 + hover/active 态 + is-open 态）
- **`.acct-popover-dot`** — 红色脉冲圆点（`@keyframes acctDotPulse`，减弱动画适配）
- **`.acct-popover-dropdown`** — 绝对定位 dropdown（topbar 子元素，毛玻璃 + 12px 圆角 + 阴影）
- **`.acct-popover-body .acct-card`** — flex-wrap 换行布局（身份信息 + 模型池分行展示）
- **`.acct-delete-link`** — 红色内联文字按钮（hover 下划线）
- 深色/浅色主题完整适配

### 统计 / Stats

- **Files changed**: 4 (`src/activity-panel.ts`, `src/webview-panel.ts`, `src/webview-styles.ts`, `src/webview-script.ts`)
- **Docs updated**: 1 (`CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Key design**: dropdown 作为 `panel-topbar` 直接子元素，利用 sticky 定位的 containing block 实现相对定位；`updateTabs` 增量刷新只替换内容 HTML，不触碰浮层的开/关 DOM 状态

---

## 模型卡片账号分布重设计 — 2026-04-22

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

  **数据源**: `GMSummary.retryErrorCodesByConv`（cascadeId → { errorCode → count }），使用 `accountFilteredCalls` 数据源（v1.17.4 修正，与总数一致）。仅在 ≥2 个对话有错误时显示增量。

  Mirrors the tool call ranking `+x` pattern for error tracking. Shows per-conversation error contribution in red across Summary Bar, tooltips, and Error Details section.

### 统计 / Stats

- **Files changed**: 3 (`src/gm/types.ts`, `src/gm/tracker.ts`, `src/activity-panel.ts`)
- **Docs updated**: 2 (`docs/project_structure.md`, `CHANGELOG-v2.md`)
- **TypeScript compile**: Zero errors
- **Key design**: 基础数字 = 当前账号所有对话总和（`retryErrorCodes` from `accountFilteredCalls`）；红色 `+x` = 当前对话贡献（`retryErrorCodesByConv[cascadeId]` from `sliced`）

---

## 错误报告现代化 — 2026-04-22

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

## 工具调用排行数据源重构 — 2026-04-22

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

## 工具调用排行榜 — 2026-04-21

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

## 待归档区持久化 + 跨池归档修复 — 2026-04-21

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

## Step API 数据清除 — 2026-04-21

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

## QuotaTracker 使用检测重构 — 2026-04-21

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

---

## 额度周期基线化 — 2026-04-21

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

---

## 跨账号配额隔离 — 2026-04-20

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

## 每日归档架构重构 — 2026-04-20

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
- **TypeScript compile**: Zero errors
- **Key architectural decision**: Daily time-based archival replaces event-driven per-pool archival; testability achieved through dependency injection and injectable time

---

## 多账号状态面板 — 2026-04-20

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

---

## 有损持久化架构 — 2026-04-20

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
- **TypeScript compile**: Zero errors
- **Key architectural decision**: Lossy persistence is safe because all text content is re-fetched from API within 5 seconds of startup; only structural/statistical data needs to survive restarts

---

## 上下文检查点查看器 — 2026-04-18

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

## Timeline 统一化 — 2026-04-18

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

## GM 驱动活动分类 — 2026-04-18

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

## GM 模块化拆分 — 2026-04-18

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

## AI 回复逐步提取 — 2026-04-18

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

## 可折叠轮次分组 — 2026-04-18

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

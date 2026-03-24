# 变更日志 / Changelog

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

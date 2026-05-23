# 待定变更日志 / Changelog Draft (v3)

## [1.17.1-Pending] - 2026-05-23

### 🐛 Fixed / 修复

- **Blank model quota on status bar and hover tooltip when idle / 空闲或无会话时状态栏模型配额及浮窗空白**: Status bar rendering (`showNoConversation()` and `showIdle()`) filtered out model quota indicators (`quotaSuffix`) and reset countdowns (`resetSuffix`) when there was no active trajectory. In addition, the no-conversation tooltip completely skipped the `buildQuotaLines()` call table. Fix: updated both methods to accept an optional `modelId` (passing `lastKnownModel`), enabling proper quota rendering under idle/no-conversation states, and restored the full quota table in the no-conversation tooltip.
  空闲或无会话状态下，状态栏渲染（`showNoConversation()` 和 `showIdle()`）会过滤掉模型配额比例（`quotaSuffix`）和重置倒计时（`resetSuffix`）。此外，无会话悬浮提示也漏掉了 `buildQuotaLines()` 配额表。修复：上述两个方法均支持接收可选的 `modelId` 参数（传入 `lastKnownModel`），从而在空闲/无会话状态下正常显示额度百分比及倒计时，并在无会话 Tooltip 中补全了完整的配额详细表格。

- **Model quota reset baseline matching mismatch / 模型额度重置基线化匹配失效**: On quota reset, display labels (e.g. `["Gemini 3.1 Pro (High)"]`) were passed to `gmTracker.baselineForQuotaReset()`. If the reverse lookup `resolveModelId` failed (common on language switch or non-active accounts), it fell back to matching the display label with the raw model ID (e.g., `"MODEL_PLACEHOLDER_M16"`), resulting in 0 matched calls. Baselined GM calls were silently discarded, and the cutoff key was written as a malformed label. Fix: introduced `modelIds` in `AccountSnapshot` and `ResetPool`, and updated all `isPoolArchived()`, `baselineForQuotaReset()`, and `archiveExpiredSessions()` handlers to match using stable, canonical Model IDs, while retaining display label fuzzy matching as a fallback for 100% matching coverage.
  模型额度重置时，扩展会将模型显示标签（如 `["Gemini 3.1 Pro (High)"]`）传给 `baselineForQuotaReset()`。如果反向查表 `resolveModelId` 失败（在中英文语言切换或非活跃账号场景下常见），代码会回退到拿显示标签与调用记录里的原生 Model ID（如 `"MODEL_PLACEHOLDER_M16"`）做直接比对，导致匹配数始终为 0，白天的 GM 调用数据直接丢失，且 Cutoff 键名写为错误格式。修复：在 `AccountSnapshot` 和 `ResetPool` 中新增 `modelIds` 字段，并在重置和归档判定逻辑中一律优先改用最精确的原生 Model ID 进行比对匹配，同时保留 Display Label 的模糊包含匹配作为保底，实现 100% 覆盖。

- **GM data loss during daily calendar archival / 每日归档漏写重置数据导致的记账漏洞**: Midnight archival (`performDailyArchival`) wrote only `gmTracker.getArchivalSummary()` (active cache) to the `DailyStore` calendar snapshot. However, intra-day baselined GM calls in `_pendingArchives` were completely ignored and cleared on `gmTracker.reset()`, causing all calls consumed prior to a quota reset to vanish from the calendar. If the IDE was reloaded or restarted, `_cache.calls` was slimmed to `[]` during serialization, producing zero-data calendar summaries. Fix: updated `performDailyArchival` to explicitly fetch and merge all entries from `gmTracker.getPendingArchives()` (including call counts, tokens, credits, and cost breakdown proportions) into the daily summary before saving to `DailyStore`, ensuring complete daily telemetry even after IDE restarts.
  凌晨日历归档（`performDailyArchival`）仅将活跃缓存 `gmTracker.getArchivalSummary()` 写入 `DailyStore` 日历快照。但白天因额度重置转移到待归档区（`_pendingArchives`）的历史数据被彻底漏掉，并在 `gmTracker.reset()` 时被清空，导致重置前被消耗的数据在日历中完全蒸发。并且，如果 IDE 中途重载或重启，缓存中的明细在序列化时会被剥离清空，导致归档出来的日历数据为 0。修复：更新 `performDailyArchival`，在写入 `DailyStore` 前，强制提取并归并 `gmTracker.getPendingArchives()` 中保存的重置汇总数据（包括调用数、Token、AI 积分和预估费用比例），确保即便 IDE 经历重启，日历数据也百分之百完整精确。

### ⚙️ Refactored & Synchronized / 重构与同步

- **Removed redundant model context limits configuration & aligned limits with official checkpointer / 废除了模型上下文限制自定义设置，并将 Flash 系列上限对准 Checkpointer 硬性指标**:
  Official RPC diagnostics (`GetAvailableModels`) revealed that the Cascade checkpointer strictly enforces static truncation thresholds (e.g. 256K for Flash, 128K for Pro, 160K for Sonnet) under the hood. Modifying the context limits in settings did not affect these hard physical constraints. To simplify configurations and remove misleading options, the `contextLimits` settings config, the `Model Context Limits` card inside the Settings WebView, and its entire frontend buttons/inputs saving and restoring logic were completely deprecated and removed. At the same time, aligned static defaults in `DEFAULT_CONTEXT_LIMITS` for the Gemini 3.5 Flash family (`MODEL_PLACEHOLDER_M133`, `MODEL_PLACEHOLDER_M132`, `MODEL_PLACEHOLDER_M20`) from `128_000` to the actual platform truncation threshold of **`256,000`**.
  官方 RPC 诊断（`GetAvailableModels`）表明，底层完全由 Cascade 官方 Checkpointer 硬性强制执行静态截断阈值（Flash 为 256K，Pro 为 128K，Sonnet 为 160K），用户在前台的自定义修改根本无法突破物理硬限制。为简化配置、消除误导性选项，本次重构彻底删除了 `contextLimits` 设置项、Webview 设置页面中的“模型上下文限制（Model Context Limits）”卡片区域、以及前端与之关联的事件监听、保存与恢复默认的全部控制逻辑；同时，将 Gemini 3.5 Flash 系列（M133、M132、M20）在 `DEFAULT_CONTEXT_LIMITS` 中的静态默认上限从偏低的 `128_000` 修正为了官方实际执行的 **`256,000`**。

### 📊 Stats / 统计

- **Files changed**: 10 (`package.json`, `src/models.ts`, `src/extension.ts`, `src/webview-panel.ts`, `src/webview-settings-tab.ts`, `src/webview-script.ts`, `src/statusbar.ts`, `src/activity-panel.ts`, `src/quota-tracker.ts`, `src/daily-archival.ts`)
- **TypeScript compile**: Zero errors
- **Tests**: 70 tests passing (`npm test` / `npx vitest run`)

# 待定变更日志 / Changelog Draft (v3)

## [1.17.1-Pending] - 2026-05-23

### 🐛 Fixed / 修复

- **Fix Checkpointer synchronization lock, type parsing, and UI display / 修复 Checkpointer 动态限制同步锁逻辑、字符串类型解析与面板展示失效**: The initial implementation set `hasSyncedCheckpointer = true` before the asynchronous LSP RPC request completed. If the RPC failed or timed out during the early discovery phase, subsequent polling cycles lacked a retry mechanism, silencing the feature. Furthermore, the parsed physical model IDs from the official RPC response (e.g., `gemini-3-flash-agent`) were mismatching with the internal canonical Placeholder IDs (e.g., `MODEL_PLACEHOLDER_M133`), and the official `max_token_limit` value was returned as a String (e.g. `"256000"`), which was silently filtered out by strict `typeof` constraints. Fix: introduced `isSyncingCheckpointer` status lock to prevent concurrent reentrance, updated the handler to only mark `hasSyncedCheckpointer = true` upon a successful RPC response (enabling robust retries on failure), enhanced parsing to resolve and map both canonical Placeholder IDs and physical IDs simultaneously, introduced `parseInt` parsing to support string-formatted metrics, and exposed the resolved Checkpointer limit directly in the Monitor Panel's model cards for transparent validation.
  先前的动态同步中，代码在异步 LSP RPC 请求完成前将同步锁 `hasSyncedCheckpointer` 置为 `true`。若 LS 连接拉起初期 RPC 失败或超时，后续轮询周期没有重试机制，使得该功能失效；此外，解析官方返回的物理 ID（如 `gemini-3-flash-agent`）未能与 Extension 内部在活跃会话中所使用的 canonical 占位符 ID（如 `MODEL_PLACEHOLDER_M133`）对齐，且官方下发的 `max_token_limit` 为 String 类型（如 `"256000"`），在原先严格的 `typeof === 'number'` 限制下被忽略。修复：引入 `isSyncingCheckpointer` 状态锁防止并发重入，更新逻辑当且仅当 RPC 交互成功时才标记同步完成（支持失败在后续轮询中自动重试），增强解析机制以同时支持占位符 ID 与实际模型 ID，引入 `parseInt` 兼容了 String 格式数据，并直接在监控面板的模型卡片中透出限制数值，便于调试与验证。

- **Blank model quota on status bar and hover tooltip when idle / 空闲或无会话时状态栏模型配额及浮窗显示空白**: Status bar rendering (`showNoConversation()` and `showIdle()`) filtered out model quota indicators (`quotaSuffix`) and reset countdowns (`resetSuffix`) when there was no active trajectory. In addition, the no-conversation tooltip skipped the `buildQuotaLines()` call table. Fix: updated both methods to accept an optional `modelId` (passing `lastKnownModel`), enabling proper quota rendering under idle/no-conversation states, and restored the full quota table in the no-conversation tooltip.
  空闲或无会话状态下，状态栏渲染（`showNoConversation()` 和 `showIdle()`）会过滤掉模型配额比例（`quotaSuffix`）和重置倒计时（`resetSuffix`）。此外，无会话悬浮提示也漏掉了 `buildQuotaLines()` 配额表。修复：上述两个方法均支持接收可选的 `modelId` 参数（传入 `lastKnownModel`），从而在空闲/无会话状态下正常显示额度百分比及倒计时，并在无会话 Tooltip 中补全了完整的配额详细表格。

- **Model quota reset baseline matching mismatch / 模型额度重置基线化匹配失效**: On quota reset, display labels (e.g. `["Gemini 3.1 Pro (High)"]`) were passed to `gmTracker.baselineForQuotaReset()`. If the reverse lookup `resolveModelId` failed (common on language switch or non-active accounts), it fell back to matching the display label with the raw model ID (e.g., `"MODEL_PLACEHOLDER_M16"`), resulting in 0 matched calls. Baselined GM calls were silently discarded, and the cutoff key was written as a malformed label. Fix: introduced `modelIds` in `AccountSnapshot` and `ResetPool`, and updated all `isPoolArchived()`, `baselineForQuotaReset()`, and `archiveExpiredSessions()` handlers to match using stable, canonical Model IDs, while retaining display label fuzzy matching as a fallback for 100% matching coverage.
  模型额度重置时，扩展会将模型显示标签（如 `["Gemini 3.1 Pro (High)"]`）传给 `baselineForQuotaReset()`。如果反向查表 `resolveModelId` 失败（在中英文语言切换或非活跃账号场景下常见），代码会回退到拿显示标签与调用记录里的原生 Model ID（如 `"MODEL_PLACEHOLDER_M16"`）做直接比对，导致匹配数始终为 0，白天的 GM 调用数据直接丢失，且 Cutoff 键名被误记。修复：在 `AccountSnapshot` 和 `ResetPool` 中新增 `modelIds` 字段，并在重置和归档判定逻辑中一律优先改用最精确的原生 Model ID 进行比对匹配，同时保留 Display Label 的模糊包含匹配作为保底，实现 100% 覆盖。

- **GM data loss during daily calendar archival / 每日归档漏写重置数据导致的数据丢失问题**: Midnight archival (`performDailyArchival`) wrote only `gmTracker.getArchivalSummary()` (active cache) to the `DailyStore` calendar snapshot. However, intra-day baselined GM calls in `_pendingArchives` were completely ignored and cleared on `gmTracker.reset()`, causing all calls consumed prior to a quota reset to vanish from the calendar. If the IDE was reloaded or restarted, `_cache.calls` was cleared during serialization, producing zero-data calendar summaries. Fix: updated `performDailyArchival` to explicitly fetch and merge all entries from `gmTracker.getPendingArchives()` (including call counts, tokens, credits, and cost breakdown proportions) into the daily summary before saving to `DailyStore`, ensuring complete daily telemetry even after IDE restarts.
  凌晨日历归档（`performDailyArchival`）仅将活跃缓存 `gmTracker.getArchivalSummary()` 写入 `DailyStore` 日历快照。但白天因额度重置转移到待归档区（`_pendingArchives`）的历史数据被遗漏，并在 `gmTracker.reset()` 时被清空，导致重置前被消耗的数据在日历中完全蒸发。并且，如果 IDE 中途重载或重启，缓存中的明细在序列化时会被剥离清空，导致归档出来的日历数据为 0。修复：更新 `performDailyArchival`，在写入 `DailyStore` 前，强制提取并归并 `gmTracker.getPendingArchives()` 中保存的重置汇总数据（包括调用数、Token、AI 积分和预估费用比例），确保即便 IDE 经历重启，日历数据也完整精确。

### ⚙️ Refactored & Synchronized / 重构与同步

- **Dynamic Checkpointer limit capture with offset indicator / 物理限额动态捕捉机制与兜底指示**:
  To align the active model context limits enforced under the hood with the internal logic, we introduced a **"Dynamic Sync + Static Fallback" mechanism**:
  1. The extension dynamically queries the language server via LSP RPC (`GetAvailableModels`) upon connection or reconnection to retrieve genuine physical model context limits and overrides internal limits.
  2. Enhanced parsing to resolve and map both canonical Placeholder IDs and physical IDs simultaneously, robustly handling string-formatted values via `parseInt` extraction.
  3. **Offset all static fallback limits in the codebase by -1,000 (1K) tokens** (e.g., Gemini 3.5 Flash fallback is `255,000` instead of `256,000`), serving as a simple status indicator: if you see clean integers (e.g., `256,000` in settings/quota cards), dynamic capture is actively overriding limits; if you see the offset limits (e.g., `255,000`), it has fallen back to the static values.
  为了将官方 Checkpointer 的实际限制与扩展内部逻辑打通，引入了 **“动态同步 + 静态兜底”机制**：
  1. 插件启动或 LS 中途重连成功时，通过本地 LSP RPC 通道拉取官方可用模型列表，动态获取实际的模型上下文限额并改写内存限制。
  2. 增强了模型 ID 的解析兼容性，使实际模型 ID 能与内部占位符 ID 完美对齐，并通过 `parseInt` 兼容了 String 类型数据。
  3. **主动将代码中所有的静态兜底默认限额整体下调了 1K (1,000) 个 tokens**（例如将 Gemini 3.5 Flash 默认值设为 `255,000` 而非 `256,000`）。这在日常使用中起到了直观的“状态指示”作用：一旦前台 UI 呈现平整的整数（如 `256,000`），即说明真实动态捕获生效覆盖；若呈现出少 1K 的数值（如 `255,000`），则说明已降级至兜底状态，便于快速验证。

- **Removed redundant limits & warning threshold settings and upgraded to percentage-based adaptive warnings / 废除了冗余模型限制与警告阈值设置，升级为百分比自适应预警体系**:
  Fixed absolute warning thresholds (e.g., 150K tokens) were inflexible when switching between models of vastly different sizes (80K, 128K, 160K, 256K), causing unnecessary configuration complexity:
  1. The static `contextLimits` settings, the Settings WebView's `Model Context Limits` card, the `compressionWarningThreshold` configuration, and all associated IPC synchronization handlers were **deprecated and removed**.
  2. Status bar and hover warnings are now **directly determined by the model context usage percentage (50% yellow warning, 80% red critical warning)**. This guarantees optimal warning behaviors automatically scaled for all current and future model architectures.
  在面对不同容量规格（80K、128K、160K、256K）的模型时，原先固定的绝对值“压缩警告阈值”（如 150K）不够灵活，并带来了冗余的配置负担。本次重构精简删除了已无必要的 `contextLimits` 配置项、`compressionWarningThreshold` 配置项、Webview 面板里的整张“压缩警告设置”卡片及全部对应的同步逻辑。状态栏及悬浮窗的警示变色**一律直接改为基于当前模型真实占比的百分比自适应预警（50% 黄色警告，80% 红色强预警）**，无需任何手动微调，即可在所有规格模型下实现自适应预警。

- **Rebuilt the Models Tab's Model Info grid with dynamic capture & exact parameters / 重构“模型”选项卡的“模型信息”为动态获取与精确参数展现**:
  To prevent data contamination from unrelated session history, we rebuilt the Model Info section inside the Models tab:
  1. All hardcoded parameters were removed from the codebase, initializing `activeModelSpecs` as an empty object `{}`. All specifications are dynamically captured via LSP RPC (`GetAvailableModels`) and injected at runtime.
  2. The display range is strictly mapped to active UI models (`configs`), filtering out backend command models (e.g. `Gemini 3 Flash` / `M18`) and hidden routing configurations.
  3. Numerical displays are precise and lossless: replaced rough estimations (e.g., `128K`, `1.0M`) with exact, raw integers formatted with thousands separators (e.g., `128,000 Limit`, `1,048,576 max tokens`), establishing a rigorous physical verification standard.
  为了防止模型展示区域被不相关的会话历史（如 GM 统计）污染，本次重构重新规划了“模型”面板底部的“模型信息”栏目：
  1. 移除了代码库中硬编码参数常量（如 `DEFAULT_MODEL_SPECS`），将内存数据库 `activeModelSpecs` 设为初始的 `{}`，规格完全依靠 LS 在运行时通过 RPC 拉取并动态注入。
  2. 展示范围严格与前台可见的 UI 模型选项列表（`configs`）进行精准映射，只展示界面表面的模型卡片，完美过滤了后台命令模型（如 `Gemini 3 Flash` / `M18` 等）。
  3. 数字规格实现绝对精准化展现：废除了原本粗略模糊的单位估算（如 `128K`、`1.0M`），全部升级为带千位分隔符的精准整数数字（如 `128,000 Limit`、`1,048,576 max tokens`），便于参数比对与验证。

- **Removed redundant checkpointer limit from Model Quota cards / 剥离模型配额卡片中多余的限制展示**:
  Removed the redundant checkpointer limit display from the individual quota cards to keep the UI clean, lightweight, and focused on a single source of truth.
  剥离了“模型配额”卡片底部多余的物理限额文字节点渲染，避免信息重复展示，保持卡片界面的极简。

### 📊 Stats / 统计

- **Files changed**: 13 (`package.json`, `src/models.ts`, `src/extension.ts`, `src/statusbar.ts`, `src/webview-panel.ts`, `src/webview-settings-tab.ts`, `src/webview-script.ts`, `src/webview-profile-tab.ts`, `src/webview-icons.ts`, `src/activity-panel.ts`, `src/quota-tracker.ts`, `src/daily-archival.ts`, `CHANGELOG-v3.md`)
- **TypeScript compile**: Zero errors
- **Tests**: 70 tests passing (`npm test` / `npx vitest run`)

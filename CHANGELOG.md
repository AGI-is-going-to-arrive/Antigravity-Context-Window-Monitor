# Changelog / 变更日志

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

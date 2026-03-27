# 归档与 GM 数据排障地图

本文档用于回答 4 个问题：

1. 当前额度归档是由谁触发的。
2. GM 数据的当前周期是如何计算和呈现的。
3. 为什么不同页面看起来会出现“口径不一致”。
4. 出现异常时，应该优先检查哪个模块、哪个状态、哪个持久化键。

本文档基于当前源码整理，核心模块包括：

- `src/quota-tracker.ts`
- `src/extension.ts`
- `src/models.ts`
- `src/pool-utils.ts`
- `src/activity-tracker.ts`
- `src/gm-tracker.ts`
- `src/monitor-store.ts`
- `src/daily-store.ts`
- `src/activity-panel.ts`
- `src/webview-monitor-tab.ts`
- `src/webview-history-tab.ts`

## 1. 一句话总览

当前项目里，真正权威的“额度周期归档触发源”是 `QuotaTracker`。

数据链路如下：

```text
GetUserStatus.configs
-> QuotaTracker.processUpdate()
-> 判定某个额度池发生 reset
-> extension.ts:onQuotaReset(modelIds)
-> ActivityTracker.archiveAndReset(poolModelIds)
-> DailyStore.addCycle(...)
-> GMTracker.reset(poolModelIds)
```

注意：

- `QuotaTracker` 决定“什么时候该归档”。
- `ActivityTracker` 决定“归档什么活动统计”。
- `GMTracker` 决定“归档后当前周期要隐藏哪些 GM 调用”。
- `DailyStore` 决定“哪些 archive 会进入 Calendar 历史”。
- `MonitorStore` 是对话快照仓，不跟 quota archive 一起清空。

## 2. 归档触发逻辑

### 2.1 归档入口

归档入口在 `src/quota-tracker.ts` 的 `processUpdate(configs)`。

它每次处理 `GetUserStatus` 返回的模型配置，并驱动状态机：

```text
idle -> tracking -> archive -> idle
```

### 2.2 什么时候进入 tracking

当前进入 tracking 有 3 条路：

1. `remainingFraction < 1.0`
   这是最强信号，立刻开始追踪。

2. 模型仍然是 `100%`，但“当前剩余时间”相比已学习到的完整窗口少了至少 10 分钟。
   这是“elapsed-in-cycle”判定。

3. 模型仍然是 `100%`，但 `resetTime` 连续稳定约 10 分钟不漂移。
   这是 drift fallback。

当前阈值：

- `ELAPSED_THRESHOLD_MS = 10min`
- `OBSERVATION_WINDOW_MS = 10min`
- `CYCLE_END_JUMP_MS = 30min`

### 2.3 什么时候结束 tracking 并归档

`tracking` 状态下，会用两类信号判定周期结束：

1. 当前 session 记录下来的 `cycleResetTime` 已经过期。
2. 官方 API 返回的 `resetTime` 相比 `cycleResetTime` 发生大跳变，超过 30 分钟。

注意几个常见误区：

- `0%` 并不会立刻归档。
- `0%` 只是把 session 标成 `completed`，仍然要等真正的周期结束。
- `0% -> 20%` 这类回弹现在会恢复为活跃追踪，不应继续锁死在“已完成”。

### 2.4 额度池不是“同 resetTime 就同池”

当前池规则由 `src/models.ts` 的 `getQuotaPoolKey()` 决定，已知模型走固定池：

- `Gemini 3.1 Pro (High/Low)` -> `gemini-pro`
- `Gemini 3 Flash` -> `gemini-flash`
- `Claude Sonnet / Claude Opus / GPT-OSS` -> `claude-premium`

未知未来模型才 fallback 到 `resetTime || modelId`。

这意味着：

- `Flash` 和 `Pro` 即使 `resetTime` 恰好一样，也不是同池。
- 池判定出错，会直接污染 Quota Tracking、GM reset、Calendar archive 三条链路。

## 3. onQuotaReset 之后到底发生了什么

`QuotaTracker` 在一个批次里收集完所有 reset 模型后，会一次性触发 `onQuotaReset(modelIds)`。

`src/extension.ts` 里当前的处理顺序是：

1. 先把本次 reset 的模型 ID 按额度池拆组。
2. 为每个池找到最近的 `QuotaSession`，拿到 `startTime/endTime`。
3. 用该池对应的 GM 快照切片出 `poolGMSummary`。
4. 调用 `ActivityTracker.archiveAndReset(poolModelIds, { startTime, endTime })`。
5. 如果有有效 archive，就调用 `DailyStore.addCycle(...)` 写入 Calendar。
6. 调用 `gmTracker.reset(poolModelIds)`，把当前周期中已归档的 GM 调用排除掉。
7. 持久化 `activityTrackerState`、`gmTrackerState`、`gmDetailedSummary`。

这里有一个很重要的设计点：

- `ActivityTracker` 先归档快照。
- `GMTracker.reset()` 再把对应池的调用从“当前周期”里隐藏掉。

所以如果你要核对“归档前快照是否正确”，应该先看 `poolGMSummary` 和 `archiveAndReset` 的输入，再看 reset 之后的页面表现。

## 4. GM 数据是如何形成“当前周期”的

### 4.1 原始数据来源

GM 数据由 `src/gm-tracker.ts` 的 `fetchAll()` 拉取。

主要来源：

- `GetCascadeTrajectoryGeneratorMetadata`
- 必要时用 `GetCascadeTrajectory` 里的内嵌 `generatorMetadata` 做补充富化

### 4.2 GM 当前周期的两层边界

`GMTracker` 不是简单地“把缓存删掉”，而是用两层边界构造“当前周期”：

1. `_callBaselines`
   用于粗粒度切掉旧周期前缀。表示某个对话从第几条 call 之后才算当前周期。

2. `_archivedCallIds`
   用于精确隐藏“已经被 per-pool reset 归档过”的调用。

`_buildSummary()` 汇总时，会先做：

```text
conv.calls.slice(baseline)
-> 再过滤掉 archivedCallIds
-> 得到 activeCalls
```

所以 GM 这一层最容易让人产生两种错觉：

- “明明 reset 了，为什么缓存还在？”
- “明明没删原始数据，为什么当前周期统计已经变了？”

这两件事在当前设计里都可能是正常现象，因为它是“按边界隐藏”，不是“无条件删底层缓存”。

### 4.3 启动时的历史修理

`repairSummaryFromQuotaHistory(...)` 是启动时的一次性修理路径，不是每轮主逻辑。

它的作用是：

- 当历史里曾经因为错误池判定，导致 GM 旧调用跨周期残留时
- 结合 `quotaHistory`
- 把能明确证明属于旧错误串池的调用从当前 summary 中剔掉

这层逻辑只应该修“历史污染”，不应该去碰正常当前周期的数据。

## 5. 各页面的数据源和口径

这部分最容易让人误解。页面看起来都在展示“模型数据”，但它们不是一套口径。

### 5.1 Quota Tracking

页面文件：`src/webview-history-tab.ts`

数据源：

- `quotaTracker.getActiveSessions()`
- `quotaTracker.getHistory()`

口径：

- 只看额度追踪 session
- 活跃会话显示正在跟踪的 quota timeline
- 已完成会话显示已经 archive 的 quota session history

不负责：

- 不负责显示 GM 调用明细
- 不负责显示 Monitor 对话快照

### 5.2 GM Data

页面文件：`src/activity-panel.ts`

数据源：

- `activityTracker.getSummary()`
- `lastGMSummary`

口径：

- 目标是展示“当前额度周期”的聚合统计
- Summary Bar、模型卡、性能、缓存、上下文增长都基于当前周期的 `GMSummary`
- 时间线默认只展示当前对话的最近操作，但底层 `_recentSteps` 仍然保留更大范围的数据供归档使用

这页如果异常，优先怀疑：

- `gmTracker.reset(poolModelIds)` 是否排除了正确的调用
- `ActivityTracker.injectGMData(...)` 是否把 GM 精确数据正确注入了 timeline
- 模型名归一化是否把同一模型拆成了两个桶

### 5.3 Monitor

页面文件：`src/webview-monitor-tab.ts`

数据源：

- 优先读 live 的 `gmSummary`
- 不足时回退到 `monitorStore` 保存的 `gmConversations`

口径：

- 这是“当前/最近对话快照视图”
- 不是“严格跟 quota 周期对齐的当前周期视图”

因此：

- quota reset 后，Monitor 仍显示历史对话快照，是正常的
- Monitor 数据不应该拿来验证“GM 当前周期是否归零”

### 5.4 Calendar

页面文件：`src/webview-calendar-tab.ts`

数据源：

- `dailyStore`
- 只吃 `addCycle(...)` 写入的 archive

口径：

- 它是“已经落账的周期历史”
- 不会展示未 archive 的实时数据

如果 Calendar 缺记录，优先怀疑：

- `QuotaTracker` 是否真的触发了 reset
- `ActivityTracker.archiveAndReset(...)` 是否返回了有效 archive
- 该池是否有“有意义活动”，因为空池不会生成 archive
- `DailyStore.addCycle(...)` 是否被调用

## 6. 和归档直接相关的持久化键

### 6.1 Quota

- `quotaHistory`
  已归档的 quota session 历史

- `quotaActiveTracking`
  当前活跃的额度追踪状态

### 6.2 Activity / GM

- `activityTrackerState`
  活动统计、timeline、archives 的序列化状态

- `gmTrackerState`
  GM 的 slim 恢复状态，包含 baselines 和 archivedCallIds

- `gmDetailedSummary`
  带完整 `calls[]` 的 GM summary，主要给启动和 WebView 快速恢复

### 6.3 Monitor / Calendar

- `monitorSnapshotState`
  Monitor 对话快照仓，独立于 quota archive

- `dailyStoreState`
  Calendar 的按天周期归档数据

## 7. 什么是正常现象，什么是异常

### 7.1 正常

- `0%` 但 Quota Tracking 仍显示“追踪中”
  只要还没到 `cycleResetTime`，这是正常的。

- quota reset 后，Monitor 里还能看到旧对话的 GM 快照
  这是正常的，因为 Monitor 不跟 quota archive 一起清。

- GM Data 和 Monitor 显示的调用数不完全一样
  可能正常。前者是“当前周期汇总”，后者是“对话快照”。

- 同池 reset 时，只归档该池，不影响其他池继续累计
  这是当前设计目标。

### 7.2 异常

- Quota Tracking 里的 active session 已经过了 `cycleResetTime`，但还长期不归档
  优先怀疑 `QuotaTracker` 的池代表选择、`isCycleEnded()` 路径、活跃状态自愈。

- 归档前，GM Data 的当前周期计数被莫名提前清掉
  优先怀疑 GM 修理逻辑过宽，或 reset 边界误伤。

- 同一模型在 GM Data 里拆成两张卡
  优先怀疑模型名归一化或历史跨语言恢复。

- Flash 和 Pro 互相影响归档
  优先怀疑 pool key 判定。

- Calendar 没有新增 cycle，但 Quota Tracking 明明出现了完成会话
  优先怀疑 `archiveAndReset()` 返回空，或 `DailyStore.addCycle()` 没被走到。

## 8. 常见异常 -> 优先排查模块

| 现象 | 优先检查 |
| --- | --- |
| resetTime 已过，Active Tracking 还挂着 | `quota-tracker.ts` 的 `processUpdate()` / `isCycleEnded()` / pool 代表选择 |
| 归档后 GM Data 没清零 | `extension.ts:onQuotaReset`、`groupModelIdsByResetPool()`、`gmTracker.reset()` |
| GM Data 清掉了不该清的当前周期次数 | `repairSummaryFromQuotaHistory()`、per-pool reset 边界、池规则是否误判 |
| Monitor 还显示旧数据 | 先确认是不是在看 `Monitor` 而不是 `GM Data`；再看 `monitor-store.ts` |
| Calendar 缺失一天的归档 | `activityTracker.archiveAndReset()` 是否有有效 archive；`dailyStore.addCycle()` 是否调用 |
| 同一模型出现中英文双卡 | `normalizeModelDisplayName()` / `resolveModelId()` / 历史恢复态 |
| 最近操作里 AI 回复缺失或重复 | `activity-tracker.ts` 的 tail refresh、planner step 补票、GM 注入去重 |

## 9. 推荐排障顺序

用户反馈一个“归档/GM 不对劲”的问题时，建议按这个顺序检查：

1. 先确认用户看的是哪个页面：
   - Quota Tracking
   - GM Data
   - Monitor
   - Calendar

2. 再确认问题属于哪类：
   - 当前周期没有正确累计
   - 当前周期没有正确归零
   - 历史 archive 没落账
   - 页面口径误解

3. 再确认涉及哪个额度池：
   - Gemini Pro
   - Gemini Flash
   - Claude Premium

4. 再看对应状态：
   - `quotaHistory`
   - `quotaActiveTracking`
   - `activityTrackerState`
   - `gmTrackerState`
   - `gmDetailedSummary`
   - `dailyStoreState`
   - `monitorSnapshotState`

5. 最后才怀疑 UI 渲染。

经验上，真正的根因多数都在：

- 池判定
- 归档边界
- 恢复态修理
- 当前周期和对话快照两种口径被混用了

## 10. 当前架构的关键认知

如果只记一件事，请记这句：

> Quota Tracking、GM Data、Monitor、Calendar 不是同一套数据仓，也不是同一条时间边界。

更具体地说：

- `QuotaTracker` 决定“何时 reset”
- `ActivityTracker` 决定“这次 reset 归档哪些活动统计”
- `GMTracker` 决定“当前周期隐藏哪些 GM 调用”
- `MonitorStore` 决定“保留哪些对话快照”
- `DailyStore` 决定“哪些 archive 进入日历历史”

因此，当两个页面看起来“不一致”时，先不要默认它是 bug，要先确认这两个页面是不是本来就不是一个口径。

只有在“同一口径内自相矛盾”时，才应该判断为真正异常。

# GM Data 后续开发计划

本文档给下次继续开发的人看，重点说明当前 GM 数据、最近操作、超窗恢复是怎么实现的，避免重复走弯路。

## 当前目标

当前版本已经做到：

- 超出 Steps API 窗口后，仍能从 GM 数据恢复最近操作。
- 能恢复一部分用户消息锚点 (`GM-USER`)。
- 能区分模型名精度：
  - `Exact`: 来自 `responseModel`
  - `Alias`: 只有 placeholder / alias，没有精确 `responseModel`
  - `Summary / Generator / Dominant`: 仅作为估算来源，不是真实逐调用模型
- GM Data 面板默认只显示当前对话，不再混入其他对话。

## 关键数据源

### 1. Steps API

文件：
- `src/activity-tracker.ts`
- `src/tracker.ts`

用途：

- 提供可读的原始步骤内容：
  - `userInput`
  - `plannerResponse`
  - `toolCall`
- 可用于可见窗口内的真实时间线。

限制：

- 只能拿到可见窗口，不是完整历史。
- 当前实际行为更接近“前段窗口固定可见”，不是滑动窗口。

### 2. 轻量 GM 端点

文件：
- `src/gm-tracker.ts`

RPC：
- `GetCascadeTrajectoryGeneratorMetadata`

用途：

- 提供逐调用账本：
  - 精确模型名 `responseModel`
  - 输入/输出 token
  - cache / retry / TTFT / credits
  - `chatStartMetadata.contextWindowMetadata`

限制：

- 某些调用没有 `responseModel`，只能退化成 alias。
- `messagePrompts` / `messageMetadata` 在轻量端点中经常被裁掉。

### 3. 完整 Trajectory GM

文件：
- `src/gm-tracker.ts`

RPC：
- `GetCascadeTrajectory`

用途：

- 当对话很大或轻量 GM 缺失精度时，选择性用内嵌 `trajectory.generatorMetadata` 做富化。
- 可补回部分：
  - `messagePrompts`
  - `tools`
  - `systemPrompt`
  - 某些 prompt 片段

注意：

- 不是所有调用都能补回自然语言。
- 很多补回来的内容是系统包装、CHECKPOINT 摘要、工具输出，不适合直接当“用户原话”。

## 当前“最近操作”实现

文件：
- `src/activity-tracker.ts`
- `src/activity-panel.ts`

### 1. 底层记录仍然是全量

`ActivityTracker._recentSteps` 继续记录所有对话的最近事件。

GM Data 面板只是在渲染层按当前 `cascadeId` 过滤，所以：

- 不会从零开始
- 不会影响归档
- 不会影响统计

### 2. 当前可见的事件来源

- `source = step`
  - 来自 Steps API，可读性最好
- `source = gm_user`
  - 来自 GM 中提取的 `<USER_REQUEST>...</USER_REQUEST>`
- `source = gm_virtual`
  - 来自窗口外 GM 调用恢复
- `source = estimated`
  - 只有步数差，没有真实调用内容时的估算占位

### 3. 不要再按 executionId 去重

这是一个已经踩过的坑。

错误做法：

- 按 `executionId` 去重窗口外事件

问题：

- 一个 execution round 里可能有多次真实 LLM 调用
- 会把多条最近操作压成一条

当前修复：

- 按 `cascadeId + stepIndices + model` 做每次 call 的唯一键

### 4. 当前展示方式

GM Data 面板中的“最近操作”现在是：

- 仅当前对话
- 按用户消息分段
- 自上而下旧到新，最新在底部

这样更像聊天记录，而不是监控流水账。

## 模型名透明策略

### 可直接展示为真实模型

条件：

- `GMCallEntry.responseModel` 存在

显示：

- `Exact`
- 真实模型名，例如 `claude-sonnet-4-6`

### 只能降级显示

条件：

- 只有 `model = MODEL_PLACEHOLDER_*`
- 没有 `responseModel`

显示：

- `Alias`
- placeholder 对应的展示名

### 只能做估算

来源优先级：

1. `requestedModel`
2. `generatorModel`
3. `dominantModel`

这些不能冒充真实逐调用模型。

## 为什么开头第 2 到第 4 步经常缺失

这是当前数据源能力边界，不是单纯 UI 问题。

主要原因：

1. GM 恢复的是“逐调用账本”，不是“每个 raw step 全量回放”。
2. 对话开头的前几步常常混有：
   - system / ephemeral / checkpoint
   - 工具包装步骤
   - 首轮上下文初始化
3. 这些步骤不一定都有独立 GM call，也不一定能在 `messagePrompts` 里还原成人类可读文本。
4. 所以现在能恢复的是：
   - 用户消息锚点
   - AI 调用账本
   - 一部分工具线索
   但不能保证还原每一个原始 step。

换句话说：

- 现在恢复的是“足够解释发生了什么”
- 不是“逐 step 法证级复刻”

## 当前仍然保留的缺点

### 1. 同一轮里还是可能出现两条

- 一条 `step`
- 一条后补 `gm_virtual`

这是刻意保留的，目的是不让后来的 GM 精确数据把原来的可读行覆盖掉。

### 2. `GM-STRUCT` 仍然偏技术化

它的含义是：

- 这条调用确实存在
- 但没有足够好的自然语言文本
- 只能显示结构线索

当前已经把 `mN` 改成了更直白的“左侧步骤号 + 右侧上下文标签”，但后续还可以继续简化。

## 下次优先事项

### P1. 段内合并

目标：

- 同模型连续推理合并
- 工具链折叠
- 减少一轮里过多碎行

### P2. 用户锚点增强

目标：

- 对 `CHAT_MESSAGE_SOURCE_USER` 做更稳的筛选
- 只保留真正可显示的用户原话
- 避免把系统包装误当用户消息

### P3. 当前会话主模型透明化

目标：

- 状态栏
- Monitor 当前会话头部
- GM Data 段头

统一显示：

- 精确模型
- 别名降级
- 摘要推断
- 主模型估算

### P4. 解释文案再降技术味

现在虽然已经透明，但仍偏工程师视角。

后续可以把：

- `GM-STRUCT`
- `Alias`
- `Estimated`

再换成更用户化的标签。

## 不要回退的点

- 不要再把最近操作改回全局流。
- 不要再按 `executionId` 去重窗口外事件。
- 不要再让 GM 行覆盖原有 step 行。
- 不要把 placeholder 模型名冒充成精确模型。
- 不要假装每个 raw step 都能被完整恢复。

## 快速定位文件

- GM 数据层：`src/gm-tracker.ts`
- 最近操作底层：`src/activity-tracker.ts`
- 最近操作 UI：`src/activity-panel.ts`
- Monitor 当前会话：`src/webview-monitor-tab.ts`
- activity poll 接入：`src/extension.ts`

## 当前结论

这个项目已经突破了原先的 Steps API 窗口限制，但恢复出来的是“GM 账本 + 用户锚点 + 结构线索”的组合视图。

它已经足够透明，也足够实用；下一步优化重点应放在“更易读”，而不是继续追求并不存在的完整原始 step 复刻。

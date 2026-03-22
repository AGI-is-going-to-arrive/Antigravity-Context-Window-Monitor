# 📁 项目结构 / Project Structure

本文档说明 Antigravity Context Window Monitor 的源码组织方式、模块职责以及依赖关系。

This document describes the source code organization, module responsibilities, and dependency relationships of the Antigravity Context Window Monitor.

---

## 目录总览 / Directory Overview

```
antigravity-context-monitor/
├── src/                          # TypeScript 源码
│   ├── extension.ts              # 扩展入口：激活/停用、轮询调度、命令注册
│   ├── discovery.ts              # Language Server 进程发现（跨平台）
│   ├── rpc-client.ts             # Connect-RPC 通用调用器
│   ├── tracker.ts                # Token 计算、会话数据获取、用户状态查询
│   ├── models.ts                 # 模型配置、上下文限额、显示名称
│   ├── constants.ts              # 全局常量（Step 类型、阈值、限制值）
│   ├── statusbar.ts              # 状态栏 UI（StatusBarManager + ActivityStatusBarItem）
│   ├── webview-panel.ts          # WebView 面板框架（标签切换 + 消息通信）
│   ├── webview-styles.ts         # WebView 面板的 CSS 样式
│   ├── webview-script.ts         # WebView 客户端 JS（标签切换、折叠面板等）
│   ├── webview-helpers.ts        # WebView 共享工具函数（转义、格式化等）
│   ├── webview-icons.ts          # WebView 内联 SVG 图标
│   ├── webview-monitor-tab.ts    # 监控标签页 HTML 生成
│   ├── webview-settings-tab.ts   # 设置标签页 HTML 生成
│   ├── webview-profile-tab.ts    # 个人资料标签页 HTML 生成
│   ├── webview-history-tab.ts    # 额度追踪标签页 HTML（追踪开关 + 活跃/已完成时间条）
│   ├── activity-panel.ts         # 活动面板 HTML 片段生成
│   ├── gm-tracker.ts             # GM 数据层：RPC + 解析 + 聚合 + 缓存
│   ├── gm-panel.ts               # GM 数据面板 HTML（性能基线 + 缓存效率 + 上下文增长）
│   ├── pricing-store.ts          # 定价数据层：默认价格表 + 用户自定义持久化 + 费用计算
│   ├── pricing-panel.ts          # 价格标签页 HTML（模型 DNA + 成本可视化 + 费用估算 + 可编辑价格）
│   ├── daily-store.ts            # 日历数据层：按日聚合 Activity/GM/Cost + 90 天自动清理
│   ├── webview-calendar-tab.ts   # 日历标签页 HTML（月历网格 + 可展开日详情 + 汇总）
│   ├── i18n.ts                   # 国际化系统（中 / 英 / 双语）
│   ├── quota-tracker.ts          # 模型额度消费时间线追踪（批量回调 + 按模型组归档）
│   ├── activity-tracker.ts       # 模型活动追踪（推理、工具、Token、防抖归档）
│   ├── diag-verify.ts            # LS 数据静态诊断脚本
│   ├── diag-monitor.ts           # LS 数据实时监视脚本
│   ├── discovery.test.ts         # discovery 单元测试
│   ├── statusbar.test.ts         # statusbar 单元测试
│   ├── tracker.test.ts           # tracker 单元测试
│   ├── quota-tracker.test.ts     # quota-tracker 单元测试
│   └── images/                   # README 截图资源
├── __mocks__/
│   └── vscode.ts                 # VS Code API mock（Vitest 用）
├── docs/
│   ├── technical_implementation.md   # 技术实现指南
│   ├── ls-monitor-technical-notes.md # LS Monitor 技术笔记
│   └── project_structure.md          # 本文件
├── diag-scripts/                 # 独立诊断脚本（不打包进扩展）
│   └── verify-step-precision.ts  # 步骤精确归属验证脚本
├── diag-output/                  # 诊断脚本输出
│   └── step-precision-result.txt # 验证结果
├── out/                          # tsc 编译输出（JS）
├── package.json                  # 扩展清单、命令、配置项
├── tsconfig.json                 # TypeScript 编译配置
├── vitest.config.ts              # 测试框架配置
├── README.md                     # 英文文档
├── readme_CN.md                  # 中文文档
└── CHANGELOG.md                  # 变更日志
```

---

## 模块详解 / Module Details

### 🔌 extension.ts — 入口 + 轮询调度

扩展的生命周期管理中心。

Extension lifecycle management hub.

| 职责 / Responsibility | 说明 / Description |
|---|---|
| `activate()` / `deactivate()` | 初始化所有子系统、注册命令、清理资源 |
| 全局轮询 / Global poll | `pollContextUsage()` 以可配置间隔执行（默认 5s） |
| Activity 独立轮询 | `pollActivity()` 独立 3 秒循环，变化时立即刷新 UI |
| 级联追踪 / Cascade tracking | 按优先级选择活跃会话：RUNNING → stepCount 变化 → 新会话 → 最近修改 |
| 压缩检测 / Compression | 双层检测：checkpoint inputTokens 下降 + 跨轮询 contextUsed 比较 |
| 指数退避 / Backoff | LS 连接失败时 5s → 10s → 20s → 60s |

---

### 🔍 discovery.ts — 语言服务器发现

跨平台定位 Antigravity Language Server 进程。

Cross-platform Antigravity Language Server process locator.

| 平台 / Platform | 进程发现 / Process Discovery | 端口发现 / Port Discovery |
|---|---|---|
| macOS | `ps -ax` | `lsof` |
| Linux | `ps -ax` | `lsof` → `ss` fallback |
| Windows | `wmic` → `Get-CimInstance` fallback | `netstat -ano` |

核心解析函数 `buildExpectedWorkspaceId()`、`extractPid()`、`extractCsrfToken()` 等均作为独立导出函数，支持直接单元测试。

Core parsing functions `buildExpectedWorkspaceId()`, `extractPid()`, `extractCsrfToken()`, etc. are exported independently for direct unit testing.

---

### 📡 rpc-client.ts — RPC 通信

通用 Connect-RPC 调用器，处理 HTTPS/HTTP 传输、CSRF 鉴权、AbortSignal 取消、50 MB 响应体限制。

Generic Connect-RPC caller handling HTTPS/HTTP transport, CSRF authentication, AbortSignal cancellation, and 50 MB response body limit.

---

### 📊 tracker.ts — Token 计算 + 数据获取

最大的数据处理模块。

The main data processing module.

| 函数 / Function | 说明 / Description |
|---|---|
| `getAllTrajectories()` | RPC 获取所有对话轨迹，按修改时间降序 |
| `getTrajectoryTokenUsage()` | 分批获取步骤（50 步/批，5 并发组）+ 调用 `processSteps()` |
| `processSteps()` | **纯函数**：步骤数组 → Token 统计（checkpoint 精确值 + 文本估算增量）|
| `getContextUsage()` | 组装 `ContextUsage` 对象供 UI 层使用 |
| `fetchFullUserStatus()` | 获取完整用户状态（模型配置、计划信息、Feature Flags）|

---

### 🤖 models.ts — 模型配置

模型上下文限额、显示名称（i18n 感知），及 `ModelConfig`、`UserStatusInfo` 等核心接口定义。

Model context limits, display names (i18n-aware), and core interface definitions (`ModelConfig`, `UserStatusInfo`, etc.).

---

### 📈 statusbar.ts — 状态栏 UI

| 类 / Class | 说明 / Description |
|---|---|
| `StatusBarManager` | 主状态栏项：上下文用量、颜色编码、额度指示、重置倒计时 |
| `ActivityStatusBarItem` | 辅状态栏项：模型活动计数 (🧠推理 ⚡工具) |

---

### 🖥️ webview-panel.ts — WebView 面板框架

面板总框架：标签切换（Monitor / Settings / Activity / Profile / History / GM Data / Pricing / Calendar）、CSP 安全策略、消息通信。各标签内容由独立模块生成。

Panel framework: tab switching (Monitor / Settings / Activity / Profile / History / GM Data / Pricing / Calendar), CSP policy, message communication. Each tab's content is generated by independent modules.

#### 拆分模块 / Split Modules

| 模块 / Module | 职责 / Responsibility |
|---|---|
| `webview-styles.ts` | CSS 样式（Design Token 体系） |
| `webview-script.ts` | 客户端 JS（标签切换、折叠面板、交互逻辑） |
| `webview-helpers.ts` | 共享工具函数（HTML 转义、时间格式化等） |
| `webview-icons.ts` | 内联 SVG 图标 |
| `webview-monitor-tab.ts` | 监控标签页 HTML |
| `webview-settings-tab.ts` | 设置标签页 HTML |
| `webview-profile-tab.ts` | 个人资料标签页 HTML |
| `webview-history-tab.ts` | 额度追踪标签页 HTML（追踪开关 + 活跃/已完成时间条） |
| `gm-panel.ts` | GM Data 标签页 HTML（性能 + 缓存 + 上下文） |
| `pricing-panel.ts` | Pricing 标签页 HTML（模型 DNA + 成本可视化 + 费用 + 可编辑价格） |
| `webview-calendar-tab.ts` | Calendar 标签页 HTML（月历网格 + 日详情 + 汇总） |

---

### ⚡ quota-tracker.ts — 额度消费追踪

状态机追踪每个模型的额度消费过程。

State machine tracking quota consumption per model.

```
IDLE (100%)
  ├─ fraction < 1.0 ────────────> TRACKING ──耗尽──> DONE
  └─ isUnusedModel = false ─────>    │                  │
     (resetTime 偏离 >10min)         │                  │
                                     │                  │
  ↑                                  │                  │
  └────── 额度重置 (→1.0) ──────────┘──── 额度重置 ────┘
```

- `isUnusedModel(resetTime)` 判断 resetTime 距已知周期（5h/7d）是否超过 10 分钟容差
- IDLE + 100% + `isUnusedModel=false`：立即创建 session 开始追踪（不等额度下降）
- TRACKING + 100% + `lastFraction=100%`：继续追踪（不误判为重置）
- TRACKING + 100% + `lastFraction<100%`：真正重置，归档 session
- **批量回调（v1.11.6）**: `processUpdate()` 循环结束后，将本批次所有重置模型 ID 收集到 `resetModels[]` 数组，一次性触发 `onQuotaReset(resetModels)`。同配额池多模型不再各自独立触发回调。
  **Batched callback (v1.11.6)**: `processUpdate()` collects all reset model IDs into `resetModels[]` after the loop, firing `onQuotaReset(resetModels)` once. Same-pool models no longer trigger independent callbacks.

额度重置时触发 `onQuotaReset(modelIds)` 回调，联动 `activity-tracker` 归档。

Fires `onQuotaReset(modelIds)` callback on quota reset, triggering `activity-tracker` archival.

---

### 🧠 activity-tracker.ts — 模型活动追踪

追踪模型活动细节：推理次数、各种工具调用、Token 消耗、耗时统计。

Tracks model activity: reasoning count, tool call breakdown, token consumption, timing stats.

| 特性 / Feature | 说明 / Description |
|---|---|
| 步骤分类 / Step classification | 21 种步骤类型 → reasoning / tool / user / system |
| 独立轮询 / Independent poll | 3 秒独立循环，不受全局 poll 影响 |
| 预热 / Warm-up | 首次轮询处理所有对话历史步骤，RUNNING 对话注入最近 30 步到时间线 |
| 增量更新 / Incremental | RUNNING 对话拉取新增步骤；检测 status 变化（IDLE→RUNNING）触发注入 |
| 回退/重发 / Rollback/Resend | 检测 stepCount 减少 → 重置 processedIndex 以跟踪被替换的步骤 |
| 工具详情 / Tool detail | 提取工具名（gh/search_issues、view_file 等）+ 参数摘要 |
| 上下文趋势 / Context trend | `CheckpointSnapshot[]` 记录每个 CHECKPOINT 的 inputTokens/outputTokens + 压缩标记 |
| 工具排行 / Tool ranking | `globalToolStats` (Map) 统计全局工具调用次数，UI 显示 Top 10 |
| 对话分布 / Conversation breakdown | `ConversationBreakdown` 追踪每个对话步骤数 + token（取最后 CHECKPOINT 累积快照） |
| 子智能体 / Sub-agent | 识别 CHECKPOINT 中 `modelUsage.model` 与主模型不同时，分离追踪子智能体消耗 |
| 归档 / Archive | `archiveAndReset(modelIds?)` 在额度重置时保存快照，5 分钟防抖合并，记录 `triggeredBy` 来源 |
| 序列化 / Serialization | `serialize()` / `restore()` 支持跨会话持久化，含三个迁移触发条件 |

---

### 📊 gm-tracker.ts — Generator Metadata 数据层

调用 `GetCascadeTrajectoryGeneratorMetadata` 获取每次 LLM 调用的精确数据。

Fetches per-LLM-call data via `GetCascadeTrajectoryGeneratorMetadata`.

| 特性 / Feature | 说明 / Description |
|---|---|
| RPC 端点 | `GetCascadeTrajectoryGeneratorMetadata` — 轻量端点，只返回 generatorMetadata |
| 解析字段 | stepIndices、responseModel、usage（含 cacheRead/cacheCreation/thinking）、TTFT、流速、积分 |
| 聚合 | per-model `GMModelStats` + per-conversation `GMConversationData` → `GMSummary` |
| 智能缓存 | `_cache` Map 按 cascadeId 缓存 IDLE 对话的 generatorMetadata，避免重复 RPC |
| 数据接口 | `GMCallEntry`、`GMModelStats`、`GMConversationData`、`GMSummary` |

---

### 💰 gm-panel.ts — GM Data 面板渲染

生成 GM Data 标签页的 HTML（费用和价格相关功能已迁移至 `pricing-store.ts` / `pricing-panel.ts`）。

Generates HTML for the GM Data tab (cost/pricing functions migrated to `pricing-store.ts` / `pricing-panel.ts`).

| 区块 / Section | 函数 / Function | 说明 / Description |
|---|---|---|
| Summary Bar | `buildSummaryBar` | 调用数、步骤数、模型数、token 合计、积分 |
| Model Cards | `buildModelCards` | 每模型的调用数、TTFT、流速、token 明细 |
| Performance | `buildPerformanceBaseline` | TTFT avg/min/max、流速统计 |
| Cache | `buildCacheEfficiency` | 缓存倍率可视化条形图 |
| Context | `buildContextGrowth` | 上下文 token 增长趋势 SVG 折线图 |
| Conversations | `buildConversationList` | 各对话的调用数和覆盖率 |

---

### 💲 pricing-store.ts — 定价数据层

管理模型定价：默认价格表、用户自定义持久化、模糊匹配、费用计算。

Manages model pricing: default pricing table, user custom overrides via globalState, fuzzy matching, cost calculation.

| 特性 / Feature | 说明 / Description |
|---|---|
| DEFAULT_PRICING | 内置价格表（仅用户活跃模型），来源：官方 API 定价文档 |
| `findPricing()` | 三级匹配：精确 → 前缀 → 子串 |
| `calculateCosts()` | 根据 token 用量 × 价格计算费用 |
| `PricingStore` | globalState 持久化用户自定义价格覆盖 |

---

### 💎 pricing-panel.ts — Pricing 标签页渲染

生成 Pricing 标签页的完整 HTML。

Generates complete HTML for the Pricing tab.

| 区块 / Section | 函数 / Function | 说明 / Description |
|---|---|---|
| Model DNA | `buildModelDNACards` | 模型配置参数、工具、提示词段落、错误/重试 |
| Cost Viz | `buildCostVisualization` | 亮点卡片（总成本/最贵模型/平均/模型数）+ 模型成本分色条形图 |
| Cost Estimate | `buildCostSummary` | 按模型 × token 类型计算 USD 费用 |
| Custom Pricing | `buildEditablePricingTable` | 可编辑价格输入 + 保存/重置按钮 |

---

### 📅 daily-store.ts — 日历数据层

按天聚合 Activity + GM + Cost 的快照数据，支持回溯导入历史归档。

Per-day aggregation of Activity + GM + Cost snapshots, with retroactive import of existing archives.

| 特性 / Feature | 说明 / Description |
|---|---|
| `ModelCycleStats` | Per-model 细分接口（reasoning/tools/errors/estSteps/tokens） |
| `addCycle()` | 从 ActivityArchive + GMSummary + costTotal 提取关键字段 + per-model 数据写入当日记录 |
| `importArchives()` | 批量导入已有归档，按 startTime 去重，自动回填旧数据缺失的 `modelStats`，重启幂等 |
| `getMonthSummary()` | 按月聚合统计，驱动日历网格圆点指示器 |
| 持久化 / Persistence | globalState (`dailyStoreState`) 存储 + 启动恢复 |
| Auto-trim | 超过 90 天的记录自动裁剪 |

---

### 📅 webview-calendar-tab.ts — Calendar 标签页渲染

生成 Calendar 标签页 HTML：月历网格、可展开日详情、周期卡片、历史汇总。

Generates Calendar tab HTML: month grid, expandable day details, cycle cards, all-time summary.

| 区块 / Section | 函数 / Function | 说明 / Description |
|---|---|---|
| Month View | `buildMonthView` | 7×6 网格 + 月份导航 + 有数据日期圆点 |
| Day Detail | `buildDayDetail` | 展开面板：逐周期卡片 + 日合计 |
| Cycle Card | `buildCycleCard` | 单周期详情：时间、模型、推理/工具/token/费用 |
| Per-Model | `buildPerModelRows` | 每周期逐模型细分 stat chips（reasoning/tools/errors/est/tokens） |
| Summary | `buildOverallSummary` | 全历史汇总：天数、周期数、推理、工具、费用 |

---

### 🌐 i18n.ts — 国际化

三种语言模式：中文 (`zh`)、英文 (`en`)、双语 (`both`)。偏好通过 `globalState` 持久化。

Three language modes: Chinese (`zh`), English (`en`), Bilingual (`both`). Preference persisted via `globalState`.

---

### 📋 constants.ts — 全局常量

集中管理 Step 类型、Token 估算常量、压缩检测阈值、RPC 限制、轮询退避参数。避免跨文件的魔法字符串和硬编码数字。

Centralized Step types, token estimation constants, compression thresholds, RPC limits, and polling backoff parameters. Eliminates cross-file magic strings and hardcoded numbers.

---

## 模块依赖关系 / Module Dependencies

```
extension.ts (入口 + 调度)
├── discovery.ts          ← LS 进程发现
├── tracker.ts            ← Token 计算 + 数据获取
│   ├── rpc-client.ts     ← RPC 通信
│   ├── models.ts         ← 模型配置
│   │   └── i18n.ts       ← 国际化
│   └── constants.ts      ← 常量
├── statusbar.ts          ← 状态栏 UI
│   ├── tracker.ts (types)
│   ├── models.ts (types)
│   └── i18n.ts
├── webview-panel.ts      ← WebView 面板
│   ├── webview-styles.ts ← CSS 样式
│   ├── activity-panel.ts ← 活动面板 HTML
│   ├── gm-panel.ts       ← GM 数据面板 HTML
│   └── pricing-panel.ts  ← Pricing 标签页 HTML
│       └── pricing-store.ts ← 定价数据层
├── gm-tracker.ts         ← GM 数据层
│   ├── rpc-client.ts     ← RPC 通信
│   └── tracker.ts (types)
├── daily-store.ts        ← 日历数据层
│   └── activity-tracker.ts (types)
├── activity-tracker.ts   ← 活动追踪
│   ├── rpc-client.ts
│   └── models.ts
├── quota-tracker.ts      ← 额度追踪
│   └── models.ts
├── i18n.ts
└── constants.ts
```

---

## 数据流 / Data Flow

```
Antigravity Language Server (localhost)
        │
        │ Connect-RPC (HTTPS/HTTP + CSRF token)
        ▼
    rpc-client.ts ────► tracker.ts ────► extension.ts (轮询中心)
        │                                     │
        │             ┌───────────────────────┤───────────────┐
        │             ▼                       ▼               ▼
        │    activity-tracker.ts        quota-tracker.ts   gm-tracker.ts
        │             │                       │               │
        │             ▼                       │               ▼
        │    activity-panel.ts                │          gm-panel.ts
        │             │                       │               │
        │             │                       │          pricing-store.ts
        │             │                       │               │
        │             │                       │          pricing-panel.ts
        │             │                       ▼               │
        ▼             ▼                 onQuotaReset          ▼
    statusbar.ts   webview-panel.ts     callback       webview-panel.ts
        │             │                       │               │
        │             │                  daily-store.ts        │
        │             │                  (calendar data)       │
        ▼             ▼                       ▼               ▼
    VS Code        VS Code WebView     activity archival
    Status Bar     Side Panel          + calendar snapshot
```

---

## 构建与安装 / Build & Install

### 1. 编译 / Compile

```bash
npm run compile    # tsc -p ./ → 输出到 out/
```

> 编译错误会在终端中显示，0 错误即成功。

### 2. 测试 / Test

```bash
npm test           # vitest run（一次性）
npm run test:watch # vitest（监视模式）
```

### 3. 打包 / Package

```bash
npx vsce package --no-dependencies
```

> 输出 `antigravity-context-monitor-{version}.vsix`（约 3–4MB）。
> `--no-dependencies` 跳过 npm 依赖安装（已编译的 `out/` 目录包含所有逻辑）。

### 4. 安装 / Install

1. 在 VS Code / Antigravity IDE 中按 `Ctrl+Shift+P`
2. 输入 `Extensions: Install from VSIX...`
3. 选择生成的 `.vsix` 文件
4. 重载窗口（`Developer: Reload Window`）

> 安装后扩展会自动发现本地 LS 进程并开始轮询。

---

## 测试详情 / Test Details

| 测试文件 / Test File | 测试数 | 覆盖范围 / Coverage |
|---|---|---|
| `discovery.test.ts` | 11 | `buildExpectedWorkspaceId` / `extractPid` / `extractCsrfToken` / `filterLsProcessLines` / 端口提取 |
| `tracker.test.ts` | 16 | `processSteps()` 纯函数：checkpoint / 估算 / 压缩检测 / 图片生成 / 空对话 |
| `statusbar.test.ts` | 11 | Token 格式化 / 上下文限额格式化 / 压缩统计计算 |
| `quota-tracker.test.ts` | 25 | 状态机转换 / 额度重置检测 / 批量回调验证 / 同池多模型归档 |

共 67 个测试，使用 `__mocks__/vscode.ts` 模拟 VS Code API。

67 total tests, using `__mocks__/vscode.ts` to mock the VS Code API.

# 项目结构

本文档说明 Antigravity Context Window Monitor 的源码组织方式、模块职责以及依赖关系。

---

## 目录总览
```text
antigravity-context-monitor/
├── src/                          # TypeScript 源码
│   ├── extension.ts              # 扩展入口：激活/停用、轮询调度、命令注册、状态恢复
│   ├── daily-archival.ts         # 每日归档核心逻辑（可测试纯函数，依赖注入）
│   ├── discovery.ts              # Language Server 进程发现（跨平台）
│   ├── rpc-client.ts             # Connect-RPC 通用调用器
│   ├── tracker.ts                # Token 计算、会话数据获取、用户状态查询
│   ├── models.ts                 # 模型配置、平台截断阈值（非原生窗口）、显示名称、跨语言归一化
│   ├── constants.ts              # 全局常量（Step 类型、阈值、限制值）
│   ├── statusbar.ts              # 状态栏 UI（StatusBarManager，含计划层级 hover 缓存）
│   ├── durable-state.ts          # 扩展外部持久化：JSON 文件 + VS Code state 镜像
│   ├── monitor-store.ts          # 监控页持久化：按对话保存 ContextUsage + GM 会话快照
│   ├── pool-utils.ts             # 配额池工具：按稳定 pool key 分组 / 扩池 / 查找最近 quota session
│   ├── quota-tracker.ts          # 模型额度消费时间线追踪（per-account 隔离 + GMTracker 辅助检测 + 稳定池代表）
│   ├── reset-time.ts             # 重置时间格式化工具（倒计时 + 绝对日期时间）
│   ├── activity-tracker.ts       # 活动追踪 re-export shim（向后兼容，实际代码在 activity/）
│   ├── activity/                 # Activity 模块（从 activity-tracker.ts 拆分）
│   │   ├── index.ts              #   barrel re-export
│   │   ├── types.ts              #   所有 Activity 类型定义
│   │   ├── helpers.ts            #   工具函数（分类/提取/合并/预览构建/持久化瘦身）
│   │   └── tracker.ts            #   ActivityTracker 类核心
│   ├── gm-tracker.ts             # GM 数据层 re-export shim（向后兼容，实际代码在 gm/）
│   ├── gm/                       # GM 模块（从 gm-tracker.ts 拆分）
│   │   ├── index.ts              #   barrel re-export
│   │   ├── types.ts              #   所有 GM 类型定义 + clone 工具 + 持久化 slim 函数（含 toolCallsByStep / toolCallCounts / toolCallCountsByConv / GMSystemContextItem / PendingArchiveEntry.estimatedCost）
│   │   ├── parser.ts             #   解析器 + 提取器 + 匹配/合并/增强 + 检查点摘要提取 + 工具调用提取 + 系统上下文提取（classifySystemContext / extractSystemContextItems）+ API 重复消息清洗（deduplicateApiErrorText）
│   │   ├── summary.ts            #   汇总构建 + 过滤 + 标准化（含 toolCallCounts 透传）
│   │   └── tracker.ts            #   GMTracker 类核心（fetch/reset/serialize + toolCallCounts 聚合 + persistedToolCounts 跨重启合并 + baseline 时预算 estimatedCost）
│   ├── pricing-store.ts          # 定价数据层：默认价格表 + 用户自定义持久化 + 费用计算（respOut = output - thinking 避免 double-counting）+ findPricing display name fallback
│   ├── model-dna-store.ts        # 模型信息持久化：跨周期保留静态模型 DNA
│   ├── daily-store.ts            # 日历数据层：按日聚合 Activity / GM / Cost（每日单快照）
│   ├── webview-panel.ts          # WebView 面板框架（10 标签切换 + 消息通信 + 全局账号面板 dropdown + gmFullSummary 跨账号费用）
│   ├── webview-styles.ts         # WebView 面板 CSS 样式（Design Token 体系）
│   ├── webview-script.ts         # WebView 客户端 JS（标签切换、设置交互、开发按钮等）
│   ├── webview-helpers.ts        # WebView 共享工具函数（转义、格式化等）
│   ├── webview-icons.ts          # WebView 内联 SVG 图标

│   ├── webview-models-tab.ts     # Models 标签页 HTML（默认模型 + 模型配额 + 模型信息）
│   ├── webview-settings-tab.ts   # Settings 标签页 HTML（含持久化存储概览 + 界面提示偏好）
│   ├── webview-profile-tab.ts    # Profile 标签页 HTML（账户 / 计划限制 / 功能与团队）
│   ├── webview-history-tab.ts    # Quota Tracking 标签页 HTML
│   ├── webview-chat-history-tab.ts # Sessions 标签页 HTML（ses-* 命名空间 — 紧凑行式卡片 + shortcut 芯片 + 工具栏 + CSS tooltip）
│   ├── activity-panel.ts         # GM Data 统一标签页 HTML（Activity + GM 数据 + 检查点查看器 + 账号面板构建器 + 模型卡片/汇总行/待归档费用显示 + respOut 费用计算）
│   ├── pricing-panel.ts          # Cost 标签页 HTML（cost-* 统一面板 — 芯片 summary bar + 分色柱状图 + 紧凑行式明细 + 月费用汇总 + 可编辑价格表 + 模型信息卡）
│   ├── webview-calendar-tab.ts   # Calendar 标签页 HTML
│   ├── webview-about-tab.ts      # About 标签页 HTML（Hero + 功能导航卡片 + GitHub + 提示 + 兼容性验证 + 免责声明 + 语言，从 TopBar Chips 迁移）
│   ├── i18n.ts                   # 国际化：语言模式、翻译表、偏好持久化
│   └── images/                   # README 截图资源
├── __mocks__/
│   └── vscode.ts                 # VS Code API mock（Vitest 用）
├── tests/                        # Vitest 测试目录（开发用，不参与插件运行时）
│   └── discovery.test.ts         # discovery 单元测试（原作者 FlorianHuo 提供）
├── docs/
│   ├── technical_implementation.md   # 技术实现指南
│   └── project_structure.md          # 本文件
├── out/                          # tsc 编译输出（已从 git 索引移除，.gitignore 忽略）
├── package.json                  # 扩展清单、命令、配置项
├── package-lock.json             # 依赖锁定文件
├── tsconfig.json                 # TypeScript 编译配置
├── vitest.config.ts              # 测试框架配置
├── README.md                     # 英文文档
├── readme_CN.md                  # 中文文档
├── CHANGELOG.md                  # 变更日志（v1.0.0 – v1.15.1 历史版本）
├── CHANGELOG-v2.md               # 变更日志 v2（v1.15.2+ 增量更新）
└── LICENSE                       # 许可证
```

---

## 模块详解

### extension.ts -- 入口 + 轮询调度

扩展生命周期管理中心：初始化子系统、注册命令、轮询调度（默认 5s）、会话选择（RUNNING 优先）、每日归档委托、多账号快照管理、额度重置归档、持久化协调。

---

### discovery.ts -- 语言服务器发现

跨平台定位 Language Server 进程（macOS/Linux/Windows/WSL/Remote-WSL），核心解析函数独立导出支持单元测试。

---

### rpc-client.ts -- RPC 通信

通用 Connect-RPC 调用器，处理 HTTPS/HTTP 传输、CSRF 鉴权、AbortSignal 取消。

---

### tracker.ts -- Token 计算 + 数据获取

对话列表获取、Token 计算、上下文用量组装。主要导出：`getAllTrajectories()`、`getContextUsage()`、`fetchFullUserStatus()`。

---

### models.ts -- 模型配置与归一化

模型上下文限额、显示名称（i18n 感知）、核心接口定义（`ModelConfig`、`UserStatusInfo`）。提供 `normalizeModelDisplayName()` / `resolveModelId()` / `getQuotaPoolKey()` 跨模块归一化锚点。

---

### statusbar.ts -- 状态栏 UI

`StatusBarManager`：上下文用量显示、颜色编码、额度指示、重置倒计时。

---

### durable-state.ts -- 扩展外部持久化

在 VS Code state 之外维护 JSON 文件持久化层（`%APPDATA%\Antigravity Context Monitor\state-v1.json`），双层镜像读写、异步防抖写入、重装恢复。

---

### monitor-store.ts -- Monitor 快照存储

按对话保存 `ContextUsage` 与 `GMConversationData`，最多 200 个快照，独立于额度归档。

---

### pool-utils.ts -- 配额池工具

围绕稳定 pool key 提供共享配额池辅助操作：`expandModelIdsToPool()` / `groupModelIdsByResetPool()` / `findLatestQuotaSessionForPool()`。

---

### quota-tracker.ts -- 额度消费追踪

状态机追踪 per-model 额度消费（`idle->tracking->(archive)->idle`），per-account 隔离，GMTracker 辅助使用检测。

---

### activity-tracker.ts -- 模型活动追踪

追踪模型活动：GM-only Timeline（`injectGMData()` 为唯一数据源）、步骤分类、用户锚点提取、子智能体归属、全局归档重置、序列化瘦身。

---

### gm-tracker.ts -- Generator Metadata 数据层

调用 GM API 获取 per-LLM-call 精确数据，聚合为 `GMSummary`。智能缓存（IDLE 复用）、额度周期基线化、按账号过滤、错误码聚合与持久化、工具调用统计与目录。

---
### activity-panel.ts -- GM Data 统一面板渲染

统一的 GM 数据标签页。主要区块：Dashboard Grid 概览、模型卡片（含账号分布）、Timeline（Turn 分段 + 事件行）、工具调用排行（含工具目录）、错误详情、上下文情报查看器（系统注入内容 + Model DNA 卡片）、对话分布卡片、待归档面板。导出 `buildAccountStatusPanel()` / `hasAccountReadyPool()` 供全局账号面板复用。

---

### webview-chat-history-tab.ts -- Sessions / 会话目录

按工作区/仓库分组展示全量对话列表，提供搜索、筛选、逐会话操作（打开工作区/Brain 目录/原始 .pb 文件）。

---

### pricing-store.ts -- 定价数据层

管理模型定价：默认价格表、用户自定义持久化、模糊匹配、费用计算。

---

### model-dna-store.ts -- 模型信息持久化

跨周期保留模型静态信息（`responseModel`、provider、completionConfig 等），动态统计仍来自当前周期的 `GMSummary`。

---

### pricing-panel.ts -- Cost 标签页渲染

生成 Cost 标签页 HTML，导出 `buildModelDNACards()` 供 Models 标签页复用。

---

### daily-archival.ts -- 每日归档核心逻辑

可测试纯函数模块，依赖通过 `DailyArchivalContext` 注入。日期滚动时归档昨日数据并重置 Tracker。

---

### daily-store.ts -- 日历数据层

按天聚合 Activity + GM + Cost 快照数据，默认 replace 模式（一天一条）。

---

### webview-calendar-tab.ts -- Calendar 标签页渲染

月历网格 + 可展开日详情（GM 调用/令牌/费用/积分汇总 + 模型明细行）。

---

### webview-panel.ts -- WebView 面板框架

面板总框架：9 标签切换、消息通信、全局账号面板 dropdown、增量刷新。各标签内容由独立模块生成。

子模块：`webview-models-tab.ts`（Models）、`webview-settings-tab.ts`（Settings）、`webview-profile-tab.ts`（Profile）、`webview-history-tab.ts`（Quota Tracking）、`webview-script.ts`（客户端 JS）、`webview-styles.ts`（CSS Design Token）、`webview-icons.ts`（SVG 图标）、`webview-helpers.ts`（共享工具函数）。

---

### i18n.ts -- 国际化

三种语言模式（中文/英文/双语），启动时从 `durable-state.ts` 读取偏好。

---

### constants.ts -- 全局常量

集中管理 Step 类型、Token 估算常量、压缩检测阈值、RPC 限制、轮询退避参数。

---


## 模块依赖关系

下图展示源码中的主要直接依赖（省略 Node / VS Code 内建模块和少量局部工具依赖）。

```text
extension.ts (入口 + 调度)
├── daily-archival.ts     ← 每日归档核心逻辑（纯函数）
│   ├── activity-tracker.ts
│   ├── gm-tracker.ts
│   ├── daily-store.ts
│   ├── pricing-store.ts
│   └── model-dna-store.ts
├── durable-state.ts      ← 扩展外部持久化
├── monitor-store.ts      ← Monitor 快照持久化
│   ├── tracker.ts (types)
│   └── gm-tracker.ts (types)
├── pool-utils.ts         ← 配额池辅助
├── discovery.ts          ← LS 进程发现
├── tracker.ts            ← Token 计算 + 数据获取
│   ├── rpc-client.ts     ← RPC 通信
│   ├── models.ts         ← 模型配置
│   │   └── i18n.ts       ← 国际化
│   └── constants.ts      ← 常量
├── statusbar.ts          ← 状态栏 UI
│   ├── tracker.ts
│   ├── models.ts
│   └── i18n.ts
├── i18n.ts               ← 语言偏好 / 翻译
├── quota-tracker.ts      ← 额度追踪
├── activity-tracker.ts   ← 活动追踪
│   ├── gm-tracker.ts (types)
│   ├── rpc-client.ts
│   ├── discovery.ts (LSInfo type)
│   ├── models.ts
│   └── i18n.ts
├── gm-tracker.ts         ← GM 数据层
│   ├── rpc-client.ts
│   ├── discovery.ts (LSInfo type)
│   └── models.ts
├── pricing-store.ts      ← 定价数据层
│   └── gm-tracker.ts (types)
├── model-dna-store.ts    ← 模型信息持久化
│   ├── models.ts
│   └── gm-tracker.ts (types)
├── daily-store.ts        ← 日历数据层
│   ├── activity-tracker.ts (types)
│   └── gm-tracker.ts (types)
└── webview-panel.ts      ← WebView 面板
    ├── i18n.ts
    ├── tracker.ts (types)
    ├── models.ts
    ├── quota-tracker.ts
    ├── activity-tracker.ts
    ├── gm-tracker.ts
    ├── pricing-store.ts
    ├── model-dna-store.ts (types)
    ├── daily-store.ts
    ├── webview-monitor-tab.ts
    ├── webview-models-tab.ts
    ├── webview-profile-tab.ts
    ├── webview-settings-tab.ts
    ├── webview-chat-history-tab.ts
    ├── activity-panel.ts
    ├── pricing-panel.ts
    ├── webview-calendar-tab.ts
    ├── webview-history-tab.ts
    ├── webview-script.ts
    ├── webview-styles.ts
    ├── webview-icons.ts
    └── webview-helpers.ts
```

---

## 数据流

```text
Antigravity Language Server (localhost)
        │
        │ Connect-RPC (HTTPS/HTTP + CSRF token)
        ▼
    rpc-client.ts ────► tracker.ts ────► extension.ts (轮询中心)
        │                                     │
        │             ┌───────────────┬───────┬───────────────┬────────────────┐
        │             ▼               ▼       ▼               ▼                ▼
        │    activity-tracker.ts  monitor-store.ts  quota-tracker.ts  gm-tracker.ts  model-dna-store.ts
        │             │               │       │               │                │
        │             │               │       │          pricing-store.ts      │
        │             │               │       │               │                │
        │             └───────────────┴───────┴───────────────┘                │
        │                             │                                        │
        │                   daily-archival.ts (每日归档)                       │
        │                             │                                        │
        │                             ▼                                        │
        │                      daily-store.ts (日历数据)                       │
        │                                                                      │
        │    activity-panel.ts ◄─────────────────── pricing-panel.ts           │
        │             │                                                        │
        │    webview-chat-history-tab.ts ◄─── trajectories + GM conversations  │
        │             │
        ▼             ▼
    statusbar.ts   webview-panel.ts
        │             │
        │             ▼
        │        durable-state.ts
        │        (external JSON file)
        ▼
    VS Code
    Status Bar
```

---

## 构建与安装

```bash
# 编译
npm run compile

# 测试
npm test
npm run test:watch

# 打包
npx vsce package --no-dependencies
```

安装：VS Code 中 `Ctrl+Shift+P` → `Extensions: Install from VSIX...` → 选择 `.vsix` 文件 → 重载窗口。

测试文件位于 `tests/`，仅供 Vitest 使用，不会被打包到 VSIX 中。


# 项目结构

本文档说明 Antigravity Context Window Monitor 的源码组织方式、模块职责以及依赖关系。

当前版本：**1.16.18**。中英文发布说明见 [releases/1.16.18.md](releases/1.16.18.md)。

---

## 目录总览
```text
antigravity-context-monitor/
├── .github/workflows/verify.yml  # Node.js 22：Windows / macOS / Linux 编译与 Vitest 矩阵
├── src/                          # TypeScript 源码
│   ├── extension.ts              # 扩展入口：激活/停用、轮询调度、命令注册、状态恢复
│   ├── daily-archival.ts         # 每日归档核心逻辑（可测试纯函数，依赖注入）
│   ├── daily-ledger.ts           # 实时增量账本（按日期+账号分桶，去重记录，额度重置结算，午夜归档数据源）
│   ├── discovery.ts              # Language Server 进程发现（跨平台）
│   ├── rpc-client.ts             # Connect-RPC 通用调用器
│   ├── tracker.ts                # Token 计算、会话数据获取、用户状态查询
│   ├── models.ts                 # 模型配置、平台截断阈值、Claude 5.5 六档 / 4.6 兼容、跨语言归一化、responseModel 别名保护
│   ├── constants.ts              # 全局常量（Step 类型、阈值、限制值）
│   ├── statusbar.ts              # 状态栏 UI（StatusBarManager，含计划层级 hover 缓存、AI 积分余额、|| 分隔符）
│   ├── durable-state.ts          # 扩展外部持久化：JSON 文件 + VS Code state 镜像
│   ├── monitor-store.ts          # 监控页持久化：按对话保存 ContextUsage + GM 会话快照
│   ├── pool-utils.ts             # 配额池工具：按稳定 pool key 分组 / 扩池 / 查找最近 quota session
│   ├── quota-tracker.ts          # 模型额度消费时间线追踪后端（per-account 隔离 + GMTracker 辅助检测 + 稳定池代表；独立 UI 已移除）
│   ├── reset-time.ts             # 重置时间格式化工具（倒计时 + 绝对日期时间）
│   ├── billing-day.ts            # 到期日计算（DST 安全的日历日差计算 helper）
│   ├── activity-tracker.ts       # 活动追踪 re-export shim（向后兼容，实际代码在 activity/）
│   ├── activity/                 # Activity 模块（从 activity-tracker.ts 拆分）
│   │   ├── index.ts              #   barrel re-export
│   │   ├── types.ts              #   所有 Activity 类型定义
│   │   ├── helpers.ts            #   工具函数（分类/提取/合并/预览构建/持久化瘦身）
│   │   └── tracker.ts            #   ActivityTracker 类核心
│   ├── gm-tracker.ts             # GM 数据层 re-export shim（向后兼容，实际代码在 gm/）
│   ├── gm/                       # GM 模块（从 gm-tracker.ts 拆分）
│   │   ├── index.ts              #   barrel re-export
│   │   ├── types.ts              #   所有 GM 类型定义 + clone 工具 + 持久化 slim 函数（含 modelSource / toolCallsByStep / toolCallCounts / GMSystemContextItem）
│   │   ├── parser.ts             #   解析器 + 提取器 + 匹配/合并/增强 + trajectory 模型提示回填 + 检查点摘要提取 + 工具调用提取 + 系统上下文提取 + API 重复消息清洗
│   │   ├── summary.ts            #   汇总构建 + 过滤 + 标准化（含 toolCallCounts 透传）
│   │   └── tracker.ts            #   GMTracker 类核心（fetch/reset/serialize + live UI summary + 额度重置过滤 + toolCallCounts 聚合 + toolCatalog 持久化/清空）
│   ├── pricing-store.ts          # 定价数据层：默认价格表 + 用户自定义持久化 + 费用计算（respOut = output - thinking 避免 double-counting）+ findPricing display name fallback
│   ├── model-dna-store.ts        # 模型信息持久化：跨周期保留静态模型 DNA
│   ├── daily-store.ts            # 日历数据层：按日聚合 Activity / GM / Cost（每日单快照）
│   ├── webview-panel.ts          # WebView 面板框架（8 标签切换 + 消息通信 + 全局账号面板 dropdown + gmFullSummary 跨账号费用）
│   ├── webview-styles.ts         # WebView 面板 CSS 样式（Design Token 体系）
│   ├── webview-script.ts         # WebView 客户端 JS（标签切换、设置交互、面板消息处理）
│   ├── webview-helpers.ts        # WebView 共享工具函数（转义、格式化等）
│   ├── webview-icons.ts          # WebView 内联 SVG 图标

│   ├── webview-models-tab.ts     # Models 标签页 HTML（账号实时模型、额度、自适应思考、主题模型信息卡片）
│   ├── webview-settings-tab.ts   # Settings 标签页 HTML（低额度警告、轮询、显示偏好、持久化存储概览）
│   ├── webview-profile-tab.ts    # Profile 标签页 HTML（账户 / 计划限制 / 功能与团队 / AI 积分到期日设置）
│   ├── webview-chat-history-tab.ts # Sessions 标签页 HTML（ses-* 命名空间 — 紧凑行式卡片 + shortcut 芯片 + 工具栏 + CSS tooltip）
│   ├── activity-panel.ts         # GM Data 统一标签页 HTML（Activity + GM 数据 + 检查点查看器 + 账号面板构建器 + 模型卡片/汇总行/待归档费用显示 + respOut 费用计算）
│   ├── pricing-panel.ts          # Cost 标签页 HTML（cost-* 统一面板 — 蓝色系 cost tab + 紧凑行式明细 + 月费用汇总 + 可编辑价格表 + 模型信息卡）
│   ├── webview-calendar-tab.ts   # Calendar 标签页 HTML
│   ├── webview-about-tab.ts      # About 标签页 HTML（Hero + 功能导航卡片 + GitHub + 提示 + 兼容性验证 + 免责声明 + 语言，从 TopBar Chips 迁移）
│   ├── i18n.ts                   # 国际化：语言模式、翻译表、偏好持久化
│   ├── legacy-migration.ts       # 旧版 Antigravity 数据自动迁移（检测旧 state.vscdb + child_process 提取）
│   └── images/                   # README 截图资源
├── __mocks__/
│   └── vscode.ts                 # VS Code API mock（Vitest 用）
├── tests/                        # Vitest 测试目录（开发用，不参与插件运行时）
│   ├── discovery.test.ts         # discovery 单元测试（原作者 FlorianHuo 提供）
│   ├── models-registry.test.ts   # 注册表、精确模型 ID、别名、平台阈值、账号模型与配额池兼容
│   ├── claude-55.test.ts         # Claude 5.5 六档参数、别名、计价与历史模型兼容
│   ├── model-live-sync.test.ts   # 实时模型同步、空 picker 清理与 catalog ID 保留
│   ├── model-info.test.ts        # 模型信息卡片：i18n、自适应思考、转义、缺失数据与账号展示范围
│   ├── pricing-resolution.test.ts # 家族计价、跨语言身份、自定义价格与未定价模型
│   ├── cost-backfill.test.ts     # 历史成本回填与定价时期边界
│   ├── pricing-panel.test.ts     # Cost 价格表回归测试
│   ├── webview-script.test.ts    # WebView 价格保存逻辑回归测试
│   ├── tool-catalog-clear.test.ts # 工具目录清空持久化回归测试
│   ├── billing-day.test.ts       # 积分到期日 DST 安全日历日差测试
│   ├── extension-selection.test.ts # 模型选择与版本恢复回归测试
│   ├── statusbar-tooltip.test.ts # 状态栏模型代表、配额与 tooltip 密度
│   ├── activity-recent-steps.test.ts # 最近操作 warm-up 全量恢复与持久化安全上限测试
│   ├── daily-archival-time.test.ts # 假时钟跨午夜归档 / stale ledger 启动补归档回归测试
│   ├── daily-ledger-date-filter.test.ts # DailyLedger 跨天日期边界过滤测试
│   ├── reset-time-turnover.test.ts # resetTime 漂移与真实周期切换判定测试
│   ├── gm-quota-reset-filter.test.ts # GM 额度重置精确归档与 cutoff 清理测试
│   ├── gm-model-capture.test.ts # GM 模型身份捕捉、trajectory 回填与 responseModel 冲突测试
│   ├── gm-summary-change.test.ts  # GM 细节字段变更判定回归测试
│   ├── gm-tracker-restore-fetch.test.ts # GM 恢复态 idle stub 自动补拉回归测试
│   ├── i18n-persistence.test.ts  # 语言偏好跨会话持久化回归测试（真实文件 IO 测试）
│   ├── monitor-store-gm.test.ts  # Sessions 页 GM 快照刷新判定回归测试
│   └── multi-account-archival.test.ts # 多账号归档与跨重启完整性集成测试
├── docs/
│   ├── technical_implementation.md   # 技术实现指南
│   ├── project_structure.md          # 本文件
│   └── releases/1.16.18.md           # 1.16.18 发布说明（先英文，后对应中文）
├── out/                          # tsc 编译输出（已从 git 索引移除，.gitignore 忽略）
├── package.json                  # 扩展清单、命令、配置项
├── package-lock.json             # 提交的 npm 锁文件，供本地及 CI 使用 npm ci 复现依赖
├── tsconfig.json                 # TypeScript 编译配置
├── vitest.config.ts              # 测试框架配置
├── README.md                     # 英文文档
├── readme_CN.md                  # 中文文档
├── CHANGELOG.md                  # 唯一主变更日志（含 v1.15.2+ 详细维护记录）
├── CHANGELOG-v2.md               # 旧链接兼容指针，后续不再维护新条目
└── LICENSE                       # 许可证
```

---

## 模块详解

### extension.ts -- 入口 + 轮询调度

扩展生命周期管理中心：初始化子系统、注册命令、轮询调度（默认 5s）、会话选择（RUNNING 优先 + 跨工作区 RUNNING 追踪）、工作区切换检测（事件监听 + URI 轮询比对 + 跨工作区穿透）、每日归档委托、多账号快照管理、额度重置归档、持久化协调。启动时会将文件态 `gmDetailedSummary` 回灌到 `GMTracker`，轮询阶段对 GM 摘要采用细粒度签名判定，避免总量不变但上下文情报 / 错误 / 工具 / 对话细节已变化时漏刷新。每日归档检查现在前置到轮询前半段，避免被“无会话 / 无当前对话”的提前 return 跳过。

---

### discovery.ts -- 语言服务器发现

跨平台定位 Language Server 进程（macOS/Linux/Windows/WSL/Remote-WSL），核心解析函数独立导出支持单元测试。

---

### rpc-client.ts -- RPC 通信

通用 Connect-RPC 调用器，处理 HTTPS/HTTP 传输、CSRF 鉴权、AbortSignal 取消。

---

### tracker.ts -- Token 计算 + 数据获取

对话列表获取、Token 计算、上下文用量组装。CHECKPOINT 步骤仍用于 token 基线，但不再覆盖用户可见的显示模型；最近 checkpoint 的内部模型通过 `checkpointModel` 透传给状态栏 tooltip。主要导出：`getAllTrajectories()`、`getContextUsage()`、`fetchFullUserStatus()`。

---

### models.ts -- 模型配置与归一化

模型上下文限额、显示名称（i18n 感知）、核心接口定义（`ModelConfig`、`UserStatusInfo`）。提供 `normalizeModelDisplayName()` / `resolveModelId()` / `getQuotaPoolKey()` 跨模块归一化锚点。`KNOWN_QUOTA_POOLS` 将 Gemini Flash + Pro 合并为统一的 `gemini` 池（mid-2026 API 变更）。`responseModel` 别名注册带冲突保护，避免同一响应别名把 M132/M133 等内部占位模型误重映射。

v1.16.18 注册 Claude Opus 5.5 Low/Medium/High（`M400`/`M401`/`M402`）及 Sonnet 5.5 Low/Medium/High（`M403`/`M404`/`M405`），共同使用 `premium` 配额池。原生上下文 1,000,000、最大输出 128,000、平台压缩上限 256,000、内部 `tokenThreshold` 50,000；255,000 静态兜底沿用现有偏移约定。`ModelSpec` 保存自适应思考能力和力度，避免把缺省预算误读为不支持思考。Claude 4.6 的 `M26`/`M35` 保留兼容；家族级响应别名不覆盖确切档位身份。

---

### statusbar.ts -- 状态栏 UI

`StatusBarManager`：上下文用量显示、颜色编码、额度指示、重置倒计时。tooltip 中的最近 checkpoint 行会显示短化后的内部影子模型标识（如 `M50`），但主模型显示仍以用户选择模型为准。

---

### durable-state.ts -- 扩展外部持久化

在 VS Code state 之外维护 JSON 文件持久化层（`%APPDATA%\Antigravity Context Monitor\state-v1.json`），双层镜像读写、异步防抖写入、重装恢复。

---

### monitor-store.ts -- Monitor 快照存储

按对话保存 `ContextUsage` 与 `GMConversationData`，最多 200 个快照，独立于额度归档。GM 会话快照比较不仅看 `calls.length`，还包含 latest call 标识、最新模型、积分与时间，避免 Sessions 标签页在调用数不变时停留旧值。

---

### pool-utils.ts -- 配额池工具

围绕稳定 pool key 提供共享配额池辅助操作：`expandModelIdsToPool()` / `groupModelIdsByResetPool()` / `findLatestQuotaSessionForPool()`。

---

### quota-tracker.ts -- 额度消费追踪

状态机追踪 per-model 额度消费（`idle->tracking->(archive)->idle`），per-account 隔离，GMTracker 辅助使用检测。虽然前端不再暴露独立的 `Quota Tracking` 标签页，但这个后端模块仍参与额度重置结算、缓存账号过期归档，以及启动阶段的 GM 摘要修复。

---

### activity-tracker.ts -- 模型活动追踪

追踪模型活动：GM-only Timeline（`injectGMData()` 为唯一数据源）、步骤分类、用户锚点提取、子智能体归属、全局归档重置、序列化瘦身。运行时 `recentSteps` 不再按固定条数裁剪；启动 warm-up 会注入完整可恢复步骤，而持久化快照仍按 `activity.maxRecentSteps` 保留安全上限，避免状态文件失控增长。

---

### gm-tracker.ts -- Generator Metadata 数据层

调用 GM API 获取 per-LLM-call 精确数据，聚合为 `GMSummary`。智能缓存（仅在 `calls` 已 hydrate 后复用 IDLE 会话，恢复态空 stub 会自动补拉）、额度周期基线化、按账号过滤、错误码聚合与持久化、工具调用统计与目录。模型身份以 `chatModel.model` 为最高可信来源；当轻量 GM 只有低可信 `responseModel` 或缺失模型时，完整 trajectory 增强路径会用 step metadata / planner requestedModel 回填。UI summary 路径等待实时 GM hydrate，不把恢复态旧摘要当实时数据；额度重置过滤优先使用精确 call ID，并清理遗留未来 cutoff。`clearToolCatalog()` 只清空工具目录，不影响工具调用排行；full-summary/archival-summary 路径不会把旧目录写回持久化桶。

---
### activity-panel.ts -- GM Data 统一面板渲染

统一的 GM 数据标签页。主要区块：Dashboard Grid 概览、模型卡片（含账号分布）、Timeline（Turn 分段 + 事件行）、工具调用排行（含可折叠工具目录和清空入口）、错误详情、上下文情报查看器（系统注入内容 + Model DNA 卡片）、对话分布卡片、待归档面板。导出 `buildAccountStatusPanel()` / `hasAccountReadyPool()` 供全局账号面板复用。

---

### webview-chat-history-tab.ts -- Sessions / 会话目录

按工作区/仓库分组展示全量对话列表，提供搜索、筛选、逐会话操作（打开工作区/Brain 目录/原始 .pb 文件）。GM 调用数 / 积分 / 最新模型优先读取当前 `gmSummary`，无实时数据时回退到 `monitor-store` 的对话快照。

---

### pricing-store.ts -- 定价数据层

管理模型定价：默认价格表、用户自定义持久化、模糊匹配、费用计算。费用估算用于本地观察，不代表 Antigravity 官方账单。

Claude Opus 5.5 与 Sonnet 5.5 均使用[官方 API 费率](https://platform.claude.com/docs/en/about-claude/pricing)（2026-10-03）。按每百万 token 计算，Opus 输入/输出为 $4/$20，Sonnet 为 $2/$10；两者缓存读取均为 $0.20。内置缓存写入参考费率为 5 分钟，Opus 为 $5、Sonnet 为 $2.50；官方 1 小时费率分别为 $8/$4。当前费用估算不计缓存创建费，因为遥测不能可靠区分创建 token 及 TTL，1 小时写入费用也不自动计入；已上报的缓存读取参与计价。计价入口统一处理 placeholder、catalog ID 与中英文名称，保留历史 token 并支持自定义价格。估算不代表 Antigravity 订阅账单。

---

### model-dna-store.ts -- 模型信息持久化

跨周期保留模型静态信息（`responseModel`、provider、completionConfig 等），动态统计仍来自当前周期的 `GMSummary`。

---

### pricing-panel.ts -- Cost 标签页渲染

生成 Cost 标签页 HTML，导出 `buildModelDNACards()` 供 Models 标签页复用。价格编辑区展示已调用模型和内置默认价格模型；保存时只持久化已有自定义项或用户实际改动的行，避免把未编辑的默认价格写成 custom override。

---

### daily-archival.ts -- 每日归档核心逻辑

可测试纯函数模块，依赖通过 `DailyArchivalContext` 注入。日期滚动时归档昨日数据并重置 Tracker。数据源优先使用 `DailyLedger.rollover()`（实时增量账本），无数据时降级到旧的 `getArchivalSummary()` + `pendingArchives` 路径。支持注入模拟时间，配合假时钟测试验证跨午夜、stale ledger 启动补归档等时间边界。

---

### daily-ledger.ts -- 实时增量账本

不依赖 LS 对话缓存生命周期的独立调用记录模块。按日期+账号分桶，每次轮询后通过 `GMTracker.getNewCallsSinceLastRecord()` 提取增量写入，调用数据一旦记录就不会丢失。额度重置结算由上游 resetTime 周期切换判定驱动，不因小幅 resetTime 漂移直接触发。核心方法：
- `recordCalls(entries)` — 增量录入 + `dedupKey` 去重
- `settleForQuotaReset(email, poolModels)` — 额度重置时将活跃桶数据冻结到已结算区
- `rollover(dateKey)` — 午夜日结，返回完整日数据并清零
- `clearRecordedIdsForConversation(cascadeId)` — 对话回退时清除旧 dedup 索引
- `serialize()` / `restore()` — 持久化到 `globalState`

账本会同时过滤“早于当天零点”和“已属于下一天”的调用时间戳，避免跨午夜加载历史或未来日调用时污染当前日期桶。

---

### daily-store.ts -- 日历数据层

按天聚合 Activity + GM + Cost 快照数据，默认 replace 模式（一天一条）。提供 `mergeRecords()` 用于跨版本数据迁移合并（只添加不存在的日期，不覆盖已有记录）。

---

### webview-calendar-tab.ts -- Calendar 标签页渲染

月历网格 + 可展开日详情（GM 调用/令牌/费用/积分汇总 + 模型明细行）。

---

### webview-panel.ts -- WebView 面板框架

面板总框架：8 标签切换、消息通信、全局账号面板 dropdown、增量刷新。各标签内容由独立模块生成；`Quota Tracking` 独立页签与相关调试入口已移除。

子模块：`webview-models-tab.ts`（Models）、`webview-settings-tab.ts`（Settings）、`webview-profile-tab.ts`（Profile）、`webview-chat-history-tab.ts`（Sessions）、`webview-calendar-tab.ts`（Calendar）、`webview-about-tab.ts`（About）、`webview-script.ts`（客户端 JS）、`webview-styles.ts`（CSS Design Token）、`webview-icons.ts`（SVG 图标）、`webview-helpers.ts`（共享工具函数）。

Models 页按当前账号的实时 picker 渲染，不按计划名或移除日期推断模型权限。模型信息卡片采用 IDE 中性主题色，压缩上限、原生上下文和思考状态使用结构化数据行；显示友好提供商名称、可换行的完整模型 ID。布局适配窄面板及亮色、暗色、高对比度主题，并支持中文、英文与双语。

---

### i18n.ts -- 国际化

三种语言模式（中文/英文/双语），启动时从 `durable-state.ts` 读取偏好。

---

### legacy-migration.ts -- 旧版数据自动迁移

自动检测旧 Antigravity（pre-2.0）的 `state.vscdb`（SQLite 数据库），通过 `child_process` + `node --experimental-sqlite` 提取日历数据和语言偏好，首次激活时自动合并到当前存储。跨平台路径检测（Windows/macOS/Linux）。迁移完成后设 `legacyMigrationDone` 标志，后续启动跳过。

---

### billing-day.ts -- 积分到期日计算

提供夏令时（DST）安全的纯日历日时间差计算，接收到期日（1-31）并动态推导距今剩余天数，服务于状态栏及个人页积分倒计时显示，包含高覆盖的边界与跨时区单元测试支持。

---

### constants.ts -- 全局常量

集中管理 Step 类型、Token 估算常量、压缩检测阈值、RPC 限制、轮询退避参数。

---


## 模块依赖关系

下图展示源码中的主要直接依赖（省略 Node / VS Code 内建模块和少量局部工具依赖）。

```text
extension.ts (入口 + 调度)
├── daily-ledger.ts       ← 实时增量账本（轮询录入 + 额度结算 + 午夜归档数据源）
├── daily-archival.ts     ← 每日归档核心逻辑（纯函数）
│   ├── activity-tracker.ts
│   ├── gm-tracker.ts
│   ├── daily-ledger.ts   ← rollover() 提供完整日数据
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
├── quota-tracker.ts      ← 额度追踪后端
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
    ├── activity-tracker.ts
    ├── gm-tracker.ts
    ├── pricing-store.ts
    ├── model-dna-store.ts (types)
    ├── daily-store.ts
    ├── webview-models-tab.ts
    ├── webview-profile-tab.ts
    ├── webview-settings-tab.ts
    ├── webview-chat-history-tab.ts
    ├── activity-panel.ts
    ├── pricing-panel.ts
    ├── webview-calendar-tab.ts
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
# 按锁文件安装依赖
npm ci

# 编译
npm run compile

# 测试
npm test
npm run test:watch

# 打包
npx vsce package --no-dependencies
```

安装：在 Antigravity IDE 命令面板中执行 `Extensions: Install from VSIX...`，选择 `antigravity-context-monitor-1.16.18.vsix` 后重载窗口。命令面板快捷键为 Windows/Linux 的 `Ctrl+Shift+P`、macOS 的 `Cmd+Shift+P`。

测试文件位于 `tests/`，仅供 Vitest 使用，不会被打包到 VSIX 中。

v1.16.18 已通过本地编译、26 个文件的 362 项测试、安装后代码的 36 项浏览器渲染检查及 15 项交互断言。新 VSIX 已在原本运行中的 macOS Antigravity IDE 2.5.5 安装、重载并完成实机验收；45 个已安装 JavaScript 文件与包内文件和本地构建逐字节一致。详细范围见 [1.16.18 发布说明](releases/1.16.18.md)。

`.github/workflows/verify.yml` 配置 Windows、macOS、Linux 的编译和测试矩阵。文档冻结时 Windows/Linux CI 尚未运行，不能用平台解析器的单元测试代替对应系统的实机验证。

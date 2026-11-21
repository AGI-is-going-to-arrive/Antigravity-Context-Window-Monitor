# 项目结构

本文档说明 Antigravity Context Window Monitor 的源码组织方式、模块职责以及依赖关系。

当前版本为 **1.17.3**。发布说明先列英文，再列中文。[1.17.3 发布说明](releases/1.17.3.md)

---

## 目录总览
```text
antigravity-context-monitor/
├── src/                          # TypeScript 源码
│   ├── extension.ts              # 扩展入口：激活/停用、轮询调度、非阻塞辅助元数据刷新、命令注册、实时费用快照与状态恢复
│   ├── daily-archival.ts         # 每日归档核心逻辑（可测试纯函数，依赖注入）
│   ├── daily-ledger.ts           # 实时增量账本（按日期+账号分桶，去重记录，额度重置结算，零费用补账，午夜归档数据源）
│   ├── discovery.ts              # agy hub 与旧版 Language Server 进程发现（多端点 CSRF 探测、daemon/hub_<port>.json 兜底、跨平台/IPv6 加固）
│   ├── backend-connection.ts     # 从当前 IDE 已激活的内置扩展读取连接提示，完整连接标识比对（isSameBackendConnection）与实例隔离
│   ├── rpc-client.ts             # Connect-RPC 通用调用器（含 rpcStreamFirstFrame / decodeConnectFirstFrame 服务端流首帧解析）
│   ├── tracker.ts                # Planner/checkpoint 精确 Token 快照、跨池 Orchestrator 匹配、Orchestrator Settings（JetboxSubscribeToState + GetMendelFlags）与双窗口配额（RetrieveUserQuotaSummary）
│   ├── models.ts                 # 模型配置、512K Gemini 4/Orchestrator 阈值、OrchestratorSettings/UserQuotaSummary、M669/M530/M531/M578 与跨语言归一化
│   ├── model-quota.ts            # 跨家族通用基础模型思考档位合并、共享配额池与 5h/Weekly 双窗口配额汇总
│   ├── currency.ts               # 纯离线本地币种与汇率格式化引擎（USD / CNY / both、安全汇率限幅与每百万费率格式化，零外部网络请求）
│   ├── tooltip-budget.ts         # 优先级分层悬停区块预算（HoverSection[] P0–P5、缩放感知行数约束、GFM 表格拼接与配额池代表选择）
│   ├── constants.ts              # 全局常量（Step 类型、阈值、限制值）
│   ├── statusbar.ts              # 状态栏读数（含可选 showSpeed/showCacheHit/showSessionCost）与分层结构化悬停摘要（Hero、Latest Call 微表、KPI/费用/缓存/速度表、双窗口配额表、事件警报与一键页脚）
│   ├── monitor-overview.ts       # 状态栏与总览共用的连接状态、活跃编排路由、上下文读数、双窗口百分比、双币种费用/节省及 L2 遥测条格式化
│   ├── account-credits.ts        # 当前 Google AI 积分归一化、去重、本地化标签及未知安全汇总（过滤旧 Prompt/Flow）
│   ├── telemetry-metrics.ts      # 纯遥测指标计算引擎（tok/s 生成速度、TTFT 缓存/非缓存对比、提示词缓存命中率与节省估算，零 VS Code/DOM 依赖）
│   ├── durable-state.ts          # 扩展外部持久化：JSON 文件 + VS Code state 镜像
│   ├── monitor-store.ts          # 监控页持久化：按对话保存 ContextUsage + GM 会话快照
│   ├── pool-utils.ts             # 配额池工具：按稳定 pool key 分组 / 扩池 / 查找最近 quota session
│   ├── quota-tracker.ts          # 模型额度消费时间线追踪后端（per-account 隔离 + GMTracker 辅助检测 + 稳定池代表；独立 UI 已移除）
│   ├── reset-time.ts             # 重置时间格式化工具（倒计时 + 绝对日期时间）
│   ├── billing-day.ts            # 到期日计算（DST 安全的日历日差计算 helper）
│   ├── activity-tracker.ts       # 活动追踪 re-export shim（向后兼容，实际代码在 activity/）
│   ├── activity/                 # Activity 模块（从 activity-tracker.ts 拆分）
│   │   ├── index.ts              #   barrel re-export
│   │   ├── types.ts              #   所有 Activity 类型定义（含 StepEvent.gmResponseTokens / gmCacheCreationTokens）
│   │   ├── helpers.ts            #   工具函数（分类/提取/合并委托 mergeGMModelStats/预览构建/持久化瘦身）
│   │   └── tracker.ts            #   ActivityTracker 类核心
│   ├── gm-tracker.ts             # GM 数据层 re-export shim（向后兼容，实际代码在 gm/）
│   ├── gm/                       # GM 模块（从 gm-tracker.ts 拆分）
│   │   ├── index.ts              #   barrel re-export
│   │   ├── types.ts              #   所有 GM 类型定义 + clone 工具 + 持久化 slim 函数（含 GMModelStats 有效耗时样本计数与动态编排器元字段）
│   │   ├── parser.ts             #   解析器 + 提取器 + 匹配/合并/增强 + trajectory 模型提示回填 + 动态编排器计划/执行模型识别 + 检查点摘要/工具调用/系统上下文提取
│   │   ├── summary.ts            #   汇总构建 + 过滤 + 标准化（按有效样本加权合并 TTFT/流耗时，含 toolCallCounts 透传）
│   │   └── tracker.ts            #   GMTracker 类核心（fetch/reset/serialize + live UI summary + 额度重置过滤 + toolCallCounts 聚合 + toolCatalog 持久化/清空）
│   ├── pricing-store.ts          # 定价数据层：内置官方费率（含 Gemini 4 Neon 官方价、Sonnet 5.5 $0.10 缓存读校正、Flash 3.6 有界优惠期、定时调价提醒 helper）+ 用户自定义持久化 + 费用计算
│   ├── model-dna-store.ts        # 模型信息持久化：跨周期保留静态模型 DNA
│   ├── daily-store.ts            # 日历数据层：按日聚合 Activity / GM / Cost（每日单快照，含 v1 兼容耗时/速度/缓存 token 归档字段）
│   ├── webview-panel.ts          # WebView 面板框架、body[data-lang]、吸顶页首、标签切换、增量刷新、动态清单版本透传及消息通信（含 showSessionCost / displayCurrency / cnyExchangeRate 白名单与跨标签控件同步）
│   ├── webview-overview-tab.ts   # 总览页：活跃会话上下文、跨池编排路由胶囊、L2 速度/TTFT/缓存/费用遥测条、可折叠诊断、5h+Weekly 双窗口配额与 AI 积分页脚
│   ├── webview-styles.ts         # WebView 基础布局与组件样式
│   ├── webview-editorial-styles.ts # Studio Telemetry Ledger 设计系统样式（深/浅/高对比度主题、零宋体排版、双语层级、编排设置/双窗口配额/双币种/最近调用/调价横幅样式规范）
│   ├── webview-script.ts         # WebView 客户端 JS（标签滑动条、币种/汇率与设置同步、草稿保护、隐私交互、增量 DOM 刷新与焦点保持）
│   ├── webview-helpers.ts        # WebView 共享工具函数（esc、时间/大小格式化，并复导 i18n 的 tBiHtml）
│   ├── webview-icons.ts          # WebView 内联 SVG 图标（含 ICON.search 等单线条图标）
│   ├── webview-models-tab.ts     # 模型页：实时 Orchestrator Settings 卡片、默认模型、双窗口共享配额池、聊天/图片分区、API 参考价行与不适用/未定价状态
│   ├── webview-settings-tab.ts   # 设置页：持久化存储诊断、悬停密度（auto/compact/full）、7 项状态栏开关（含会话费用）、币种与本地参考汇率卡片、轮询与缩放
│   ├── webview-profile-tab.ts    # 个人页：隐私遮罩账号、5h+Weekly 共享模型配额、AI 积分与到期日、可折叠计划限制与功能配置
│   ├── webview-chat-history-tab.ts # 会话目录：工作区分组、搜索、筛选、本地化状态/存储标签及会话操作
│   ├── activity-panel.ts         # GM 数据：KPI、双列速度与首字缓存账本、可折叠最近调用明细表（Recent Calls Ledger）、模型统计、时间线遥测标签、上下文情报、工具、错误和全局账号面板浮层
│   ├── pricing-panel.ts          # 成本：顶部双币种与汇率工具栏、官方定时调价倒计时横幅、月度/实时多币种成本分析（含缓存节省与思考占比）、四分项分布图及自定义价格编辑
│   ├── webview-calendar-tab.ts   # 日历：多币种月度/全部汇总、7 列交互月历、每日明细（含归档速度/TTFT/缓存命中）及周期归档
│   ├── webview-about-tab.ts      # 关于页：清单动态版本、平台范围、8 页功能导航卡片、Gemini 4 全系 512K 窗口说明、兼容性与文档
│   ├── i18n.ts                   # 国际化：三语言模式、翻译表（含编排器、双窗口配额、双币种与悬停微表键）、tBi / tBiHtml、formatNumber 与偏好持久化
│   ├── legacy-migration.ts       # 旧版 Antigravity 数据自动迁移（检测旧 state.vscdb + child_process 提取）
│   └── images/                   # README 定稿截图资源（全部 9 页 monitor-*.png，含浅/深双主题）
├── __mocks__/
│   └── vscode.ts                 # VS Code API mock（Vitest 用）
├── tests/                        # Vitest 单元测试（61 个测试文件）与 Chromium/原生验收脚本（开发用，不参与插件运行时）
│   ├── currency.test.ts          # 离线多币种与汇率格式化、边界限幅及零值省略回归
│   ├── neon-pricing.test.ts      # Gemini 4 Neon 官方定价、Sonnet 5.5 $0.10 缓存读、Flash 3.6 优惠期与定时调价倒计时回归
│   ├── orchestrator-settings.test.ts # JetboxSubscribeToState 流首帧、GetMendelFlags 编排角色、RetrieveUserQuotaSummary 双窗口与跨池上下文回归
│   ├── webview-orchestrator-ui.test.ts # 编排设置卡、跨池路由、双窗口配额、双币种、Notice 徽章、About 动态版本与样式系统回归
│   ├── tooltip-budget.test.ts    # 优先级分层悬停预算（P0–P5 压缩/降级、Quota 永不丢弃、缩放收紧与 GFM 表格渲染）回归
│   ├── telemetry-metrics.test.ts # 纯遥测引擎（相加式缓存、显式/隐式思考、总和比值加权、双层噪声门限、缓存/非缓存 TTFT、未定价节省）
│   ├── activity-telemetry-panel.test.ts # GM 数据 KPI、速度与首字缓存账本、最近调用明细表、模型卡片与时间线遥测标签回归
│   ├── account-credits.test.ts   # 当前 AI 积分归一化、Prompt/Flow 过滤、去重、本地化标签与未知总额回归
│   ├── cross-platform-i18n.test.ts # Windows/Linux 路径归一化、跨区域数字格式、tBi/tBiHtml 与中文 Token 术语回归
│   ├── model-quota.test.ts       # 跨家族通用思考档位合并、5h/Weekly 双窗口汇总、历史占位映射、proto3 纪元过滤与差异展示回归
│   ├── monitor-overview.test.ts  # 总览/悬停共享状态、双窗口格式化、上下文余量、配额标签与双语渲染回归
│   ├── neon-models.test.ts       # Gemini 4 Neon 四档与 Orchestrator (Neon) 身份、上限、配额与计价回归
│   ├── orchestrator.test.ts      # Orchestrator 协调/执行委派、共享 execution ID 与防压缩误报回归
│   ├── orchestrator-split.test.ts # Carbon/Argon/Neon 协调模型拆分、别名隔离与独立定价回归
│   ├── gemini-4-hydrogen.test.ts # Hydrogen 四档（含 Extra High/XHigh）及 M530/M531/M578 身份、配额与元数据回归
│   ├── gemini-4-carbon.test.ts   # Carbon 三档身份、别名边界与实时同步回归
│   ├── hydrogen-pricing.test.ts  # Hydrogen 固定费率与账号改名回查回归
│   ├── hydrogen-ui.test.ts       # 第四档 Extra High/超高在配额卡片与多语言下的渲染回归
│   ├── carbon-pricing.test.ts    # Carbon 按 UTC 日期计价边界与自定义覆盖回归
│   ├── discovery.test.ts         # 跨平台发现、agy/旧版进程、daemon hub JSON 兜底、多端点探测及 IPv6/Windows/macOS/Linux 回归
│   ├── backend-connection.test.ts # 当前 IDE 连接提示、isSameBackendConnection/hint 变更重连及重启期间 getter 异常
│   ├── backend-status-i18n.test.ts # 连接状态中英双语、即时语言刷新与恢复
│   ├── discovery-hub.test.ts     # Hub 编排、失效候选、实例隔离、取消及本地 HTTP/IPv6 探测
│   ├── trajectory-agent-hub.test.ts # 无 checkpoint 的 planner 用量、档位与估算优先级
│   ├── gm-agent-hub.test.ts      # 当前 hub GM 容量、重试和遥测边界
│   ├── gm-timestamps.test.ts     # GM 时间戳缺失/边界日期与历史计价一致性回归
│   ├── argon-pricing.test.ts     # Argon 官方价格、UTC 调价边界、逐调用成本及历史/自定义优先级
│   ├── image-model-registry.test.ts # 图片身份、独立可用列表、无聊天阈值及配额隔离
│   ├── image-steps.test.ts       # generateImage 步骤与外围聊天身份保持
│   ├── image-workflow.test.ts    # 关联子智能体图片步骤，有界遍历、去重及父上下文隔离
│   ├── image-cost-warning.test.ts # 无独立图片计量时已知小计/费用排除提示
│   ├── context-compression.test.ts # 含缓存占用、来源一致性及压缩误报保护
│   ├── model-metadata-lifecycle.test.ts # 账号/后端代际隔离，防止旧异步目录回填
│   ├── fixtures/model-catalog-2026-10-31.ts # 脱敏实时目录字段 fixture
│   ├── gemini-4-argon.test.ts    # Argon 三档身份、参数、GM、配额、价格与 i18n 回归
│   ├── models-registry.test.ts   # 注册表、精确模型 ID、别名、平台阈值、账号模型与配额池兼容
│   ├── claude-55.test.ts         # Claude 5.5 六档参数、别名、计价与历史模型兼容
│   ├── model-live-sync.test.ts   # 实时模型同步、空 picker 清理与 catalog ID 保留
│   ├── model-info.test.ts        # 模型信息卡片：i18n、自适应思考、转义、缺失数据与账号展示范围
│   ├── pricing-resolution.test.ts # 家族计价、跨语言身份、自定义价格与未定价模型
│   ├── cost-backfill.test.ts     # 历史成本回填与定价时期边界
│   ├── ledger-cost-reconciliation.test.ts # 账本已记录调用零费用补账与幂等校验回归
│   ├── pricing-panel.test.ts     # Cost 价格表、双币种、调价横幅与缓存节省回归测试
│   ├── webview-script.test.ts    # WebView 价格保存、汇率校验与客户端交互回归测试
│   ├── tool-catalog-clear.test.ts # 工具目录清空持久化回归测试
│   ├── billing-day.test.ts       # 积分到期日 DST 安全日历日差测试
│   ├── extension-selection.test.ts # 模型选择与版本恢复回归测试
│   ├── statusbar-tooltip.test.ts # 状态栏读数、分层悬停摘要、双窗口配额、双币种与密度预算回归
│   ├── installed-ide-ui.cjs      # Chromium 浅/深/高对比度 + axe WCAG 2.1 AA 无障碍 + 9 页响应式、v1.17.3 深度检查与截图验收脚本（另支持 --native）
│   ├── activity-estimated-context.test.ts # 活动估算上下文与精确快照边界测试
│   ├── activity-recent-steps.test.ts # 最近操作 warm-up 全量恢复与持久化安全上限测试
│   ├── daily-archival-time.test.ts # 假时钟跨午夜归档 / stale ledger 启动补归档回归测试
│   ├── daily-ledger-date-filter.test.ts # DailyLedger 跨天日期边界过滤测试
│   ├── daily-ledger-regressions.test.ts # DailyLedger/DailyArchival/DailyStore 耗时与缓存持久化 v1 兼容回归测试
│   ├── legacy-migration.test.ts  # 旧版 Antigravity state.vscdb 迁移路径回归测试
│   ├── reset-time-turnover.test.ts # resetTime 漂移与真实周期切换判定测试
│   ├── gm-quota-reset-filter.test.ts # GM 额度重置精确归档与 cutoff 清理测试
│   ├── gm-model-capture.test.ts  # GM 模型身份捕捉、trajectory 回填与 responseModel 冲突测试
│   ├── gm-summary-change.test.ts # GM 细节字段变更判定回归测试
│   ├── gm-tracker-restore-fetch.test.ts # GM 恢复态 idle stub 自动补拉回归测试
│   ├── i18n-persistence.test.ts  # 语言偏好跨会话持久化回归测试（真实文件 IO 测试）
│   ├── monitor-store-gm.test.ts  # Sessions 页 GM 快照刷新判定回归测试
│   └── multi-account-archival.test.ts # 多账号归档与跨重启完整性集成测试
├── docs/
│   ├── technical_implementation.md   # 技术实现指南
│   ├── project_structure.md          # 本文件
│   └── releases/1.17.3.md            # 当前发布说明（先英文，再中文）
├── out/                          # tsc 编译输出（已从 git 索引移除，.gitignore 忽略）
├── PRODUCT.md                    # 产品定位、9 页能力清单、术语约束与无障碍承诺
├── DESIGN.md                     # Studio Telemetry Ledger 设计系统规范（色板、排版、组件与 9 页契约）
├── package.json                  # 扩展清单、命令、配置项
├── package-lock.json             # 提交的 npm 锁文件，供本地使用 npm ci 复现依赖
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

扩展生命周期管理中心：初始化子系统、注册命令（`MONITOR_COMMAND` 支持直达 `overview` / `gmdata` / `pricing` / `models` / `settings`）、轮询调度（默认 5s）、非阻塞辅助元数据刷新（`triggerLiveAuxiliaryMetadataRefresh` 带并发防重入、代际守卫与失败退避，拉取 `OrchestratorSettings` 与 `UserQuotaSummary`）、实时费用快照（`computeLiveCostSnapshot`）、会话选择（RUNNING 优先 + 跨工作区 RUNNING 追踪）、连接变更快速重连（`doesConnectionMatchActiveHint` + `isSameBackendConnection`）、工作区切换检测、每日归档委托、多账号快照管理、额度重置归档与持久化协调。启动时将文件态 `gmDetailedSummary` 回灌到 `GMTracker`，并对零费用历史调用触发幂等补账；每日归档检查前置到轮询前半段，避免被提前 return 跳过。

---

### discovery.ts -- 语言服务器发现

跨平台定位当前 `agy --hub`（Windows 为 `agy.exe`）及旧版 `language_server_*` 进程，覆盖 macOS/Linux/Windows/WSL/Remote-WSL。1.17.3 引入多端点 CSRF 探测链路 `PROBE_ENDPOINTS = ['GetStatus', 'GetUnleashData', 'GetUserStatus']`（遇 404/501 自动切换下一端点，彻底修复 `agy` v1.5.14 移除 `GetUnleashData` 导致的 `上下文: 不可用`）、`~/.gemini/antigravity/daemon/hub_<port>.json` 磁盘发现与直连提示兜底，以及全平台系统命令与网络加固（Windows PowerShell 强制 `UTF8` 输出编码避免非 ASCII 路径乱码、macOS 兼容 `/usr/sbin/lsof`、Linux 使用 `ps -axww` 与 `/usr/sbin/ss`、IPv6 `[::1]` 回环探测与安全主机名透传）。核心解析函数独立导出支持单元测试。

---

### backend-connection.ts -- 当前 IDE 实例连接

从当前窗口中已激活的 `google.google-antigravity` 内置扩展导出读取端口和 CSRF token，校验后作为 `discoverLanguageServer()` 的连接提示。新增 `isSameBackendConnection()` 与 `doesConnectionMatchActiveHint()` 比较完整连接标识（PID、端口、TLS、主机名与提示一致性），后端重启或切换实例时（即便直连提示 `pid=0`）即可即时重连，同时保持安全回退与实例隔离。

---

### rpc-client.ts -- RPC 通信

通用 Connect-RPC 调用器，处理 HTTPS/HTTP 传输、IPv6 主机名、CSRF 鉴权与 `AbortSignal` 取消。1.17.3 新增 `rpcStreamFirstFrame()` 与 `decodeConnectFirstFrame()`，支持解析 Connect 服务端流（`application/connect+json`）的 5 字节帧头与首帧 JSON 载荷，供 `JetboxSubscribeToState` 读取全局编排设置并在收到首帧后立即关闭流连接。

---

### tracker.ts -- Token 计算 + 数据获取

对话列表获取、Token 计算、上下文用量组装、编排设置与双窗口配额查询。当前 planner-response 与旧版 CHECKPOINT 的 `metadata.modelUsage` 都可提供精确快照；提供商新输入+缓存读取+缓存创建+输出计数优先于 GM 请求前估算。针对新版自定义编排模式（跨池 `planModel` → `executionModel`，如 Claude Opus 5.5 + Gemini 4 Hydrogen），`processSteps()` 与 `getContextUsage()` 提取 `orchestratorConfig` 并在计算上下文上限时按实测模型精确匹配，避免跨池上下文比例错算。主要导出：`getAllTrajectories()`、`getContextUsage()`、`fetchFullUserStatus()`、`fetchOrchestratorSettings()`（`JetboxSubscribeToState` + `GetMendelFlags` `orchestrator-model-roles`）、`fetchUserQuotaSummary()`（`RetrieveUserQuotaSummary` 5h/weekly 双窗口）与 `refreshWorkflowImageUsage()`。

---

### models.ts -- 模型配置与归一化

模型上下文限额、显示名称（i18n 感知）、核心接口定义（`ModelConfig`、`UserStatusInfo`、`OrchestratorSettings`、`UserQuotaSummary`、`QuotaWindowSummary`）。提供 `normalizeModelDisplayName()` / `resolveModelId()` / `getQuotaPoolKey()` / `localizePickerEffortLabel()` 跨模块归一化锚点。`KNOWN_QUOTA_POOLS` 明确划分 `gemini` 与 `premium`（Claude / GPT）两大共享配额池；未知模型与图片身份保留独立额度。

1.17.3 同步 Antigravity IDE v1.5.14（LS 2.34.0）最新模型目录与编排架构：
- **512K Gemini 4 / 编排模型统一校准**：全部 Gemini 4（Neon、Hydrogen、Carbon、Argon）及服务端编排器/执行模型（`M537`/`M667`/`M681`/`M669`/`M530`/`M531`）的静态兜底更新为 `511,000`（实时压缩上限 `512,000`，检查点阈值 `50,000`）。
- **自定义编排器与执行模型**：完整支持 Orchestrator 下拉菜单中的 Gemini 4 Neon（4 档）、Carbon（3 档）、Argon（3 档）与 Claude Opus 5.5（3 档），以及 Executor 下拉菜单中的 Gemini 4 Hydrogen（含 `Extra High` / `超高`，统一 Neon 与 Hydrogen 第四档标签）与 Claude Sonnet 5.5。
- **新增与更名条目**：将 `M669`（`gemini-flash-worker-agy`）更新为 `Gemini 4 Hydrogen (Orchestrator)`，并注册目录内条目 `M530`（`gemini-4-hydrogen-tiered-high`）、`M531`（`gemini-4-hydrogen-tiered-xhigh`）与 `M578`（`gemini-4-hydrogen-sonar`）；保留 GPT-OSS 120B `Notice` 下线提示标签透传。

1.17.2 注册 Gemini 4 Neon Low / Medium / High / Extra High（`M534` / `M533` / `M532` / `M535`）及 Orchestrator (Neon) `M537`。v1.17.0–v1.17.1 注册 Hydrogen（`M527`–`M528`）、Orchestrator (Carbon/Argon)（`M667`/`M681`）；v1.16.18–v1.16.20 注册 Carbon（`M438`/`M437`/`M427`）、Argon（`M419`/`M418`/`M417`）、Claude Opus/Sonnet 5.5（`M400`–`M405`）、Gemini 3.8 Flash（`M318`–`M320`）与图片模型 `M21`（`gemini-3.1-flash-image`，以 `imageGenerationModelIds` 为准）。历史详情见对应版本发布说明。

---

### model-quota.ts -- 跨家族基础模型配额合并与双窗口汇总

`groupModelQuotas(configs, quotaSummary?)` 与 `summarizeQuotaReadings()` 将模型目录按共享配额池与基础模型家族整理，并可选并入来自 `RetrieveUserQuotaSummary` 的 `fiveHourQuota` 与 `weeklyQuota` 双窗口精确读数（无汇总时平滑降级为 5h 单窗口）。覆盖 Gemini 4 Neon（4→1）、Hydrogen（4→1）、Carbon（3→1）、Argon（3→1）、Flash 3.5–3.8、Pro 3.1、Claude Opus/Sonnet/Haiku（含 5.5）、GPT-OSS（透传 `tagTitle: 'Notice'`）、历史退役占位 ID（`LEGACY_QUOTA_FAMILIES`）以及符合条件的未来家族；服务端编排器条目保持独立。自动过滤 proto3 纪元时间戳（`<= 0` / `1970-01-01`），避免未触碰配额误报重置已过期。

---

### currency.ts -- 本地离线多币种与汇率格式化

零 VS Code 依赖、零外部网络请求的纯格式化模块：支持 `USD`、`CNY`、`both` 三种显示模式（`parseDisplayCurrency()`）及安全限幅汇率 `0.01–1000`（默认 `7.2`，`sanitizeCnyExchangeRate()`）。提供 `formatCurrencyCost()`（`standard` / `call` / `rate` 三种精度与 `paren` / `slash` 双币连接）、`formatCurrencySavings()`（带零舍入保护，绝不输出 `-0.00`）与 `formatPerMillionRate()`，统一服务于状态栏、悬停摘要、总览、GM 数据、成本、模型与日历全部页面。

---

### account-credits.ts -- 当前 Google AI 积分聚合与未知安全处理

统一过滤旧版 `PROMPT` / `FLOW` / `UNSPECIFIED` 积分桶（`isCurrentCreditType()`），对有效积分键去重并校验冲突读数（`currentAICredits()`、`parseCreditBalance()`），提供中英双语本地化标签（`formatCreditTypeLabel()`）及未知安全总额计算（`aiCreditTotal(): number | null`、`summarizeAccountCredits()`）。状态栏、总览页、个人页与顶部账号面板共用该模块，缺失或冲突时统一返回 `null` 并呈现**未上报**，绝不伪造 `0`。

---

### telemetry-metrics.ts -- 纯遥测指标计算引擎

零 VS Code / DOM 依赖的单事实源遥测模块，服务于状态栏、总览、GM 数据、日历及持久化归档层：
- **相加式缓存语义**：`totalPromptTokens = inputTokens + cacheReadTokens + cacheCreationTokens`；主指标为按 token 加权的 `tokenCacheHitRate = cacheReadTokens / totalPromptTokens`（辅以调用级 `callCacheHitRate` 与 `cacheReuseRate = cacheReadTokens / (cacheReadTokens + cacheCreationTokens)`）。
- **仅解码流式时长与包含式思考**：`streamingSeconds` 严格不含 `ttftSeconds`；`thinkingTokens` 为 `outputTokens` 的子集（严禁 `output + thinking` 重复累加）。针对 Gemini Flash 省略 `thinkingOutputTokens` 但 `outputTokens > responseTokens > 0` 的隐式思考场景，通过 `visibleResponseTokens` 与 `effectiveThinkingTokens` 精确拆分总生成速度（`totalGenTokPerSec`）、可见响应速度（`visibleTokPerSec`）与端到端速度（`endToEndTokPerSec`）。
- **总和比值加权与双层噪声门限**：会话/模型平均速度采用时间加权总和比值 `sum(outputTokens) / sum(streamingSeconds)`（非逐调用均值）。硬有效性过滤为 `MIN_STREAM_SECONDS = 0.05` 且 `MIN_OUTPUT_TOKENS_FOR_SPEED = 2`（剔除单 token 与超短传输抖动）；`median`/`min`/`max` 分布优先使用代表性样本阈值 `REP_MIN_STREAM_SECONDS = 0.25` 且 `REP_MIN_OUTPUT_TOKENS = 10`（无代表性样本时回退至硬有效集合）。
- **缓存 vs 非缓存 TTFT 拆分与未定价保护**：仅统计 `ttftSeconds > 0` 的有效调用，区分缓存命中（`cacheReadTokens > 0`）与未命中（`cacheReadTokens === 0`），两侧均有样本时计算 `ttftCacheDeltaPct = (cached - uncached) / uncached * 100`；另提供 R-7 `p50`/`p95`、`isInternalCompactionCall()` 保守剔除、`computeTelemetryAggregateFromModelStats()` 归档降级，以及 `estCacheSavingsUsd: number | null`（通过 `pricing-store.ts` 计算，无已定价缓存调用时保持 `null` 绝不伪造 `$0.00`）。同时导出 `computeStepSpeed()`、`computeStepCacheHitRate()`、`formatSpeed()`、`formatLatency()`、`formatCachePercent()`。

---

### tooltip-budget.ts -- 悬停区块预算与状态栏配额代表

1.17.3 新增优先级分层区块预算引擎（`HoverSection[]`、`getSectionLineBudget()`、`applySectionBudget()`、`renderHoverSections()`），按 `P0`（受保护永不丢弃，极端紧张时允许内部压缩至 `compactLines`）至 `P5`（优先折叠/丢弃）管理悬停行数，结合用户密度设置（`auto` / `compact` / `full`）与 `window.zoomLevel` 动态收紧预算，并在拼装 Markdown 时自动保护 GFM 表格空行语义。同时保留配额池代表选择（优先当前模型、账号实时推荐模型、可用世代与系列）。

---

### statusbar.ts -- 状态栏 UI 与重构后的悬停摘要

`StatusBarManager` 展示上下文用量、剩余配额、重置倒计时、AI 积分及三项默认关闭的可选状态栏读数：`statusBar.showSpeed`（`$(pulse)`）、`statusBar.showCacheHit` 与 `statusBar.showSessionCost`（`$(credit-card)`，支持 `USD`/`CNY`/`both` 多币种）；冷启动无有效数据时自动隐藏，未知积分绝不伪造 `0`。

1.17.3 全面重构原生 Markdown 悬停摘要，采用 `tooltip-budget.ts` 优先级分层区块与 GFM 微表布局：
- **P0 Hero 区块**：账号计划、会话标题/步数、编排器跨池路由（`Planner → Executor (Cross-pool)`）、Unicode 胶囊上下文条与压缩/缺口警报。
- **P0 配额区块（永不丢弃）**：`5h | Weekly` 双窗口配额表（无周窗口时自动回退 5h 单列），带 `Planner`/`Executor`/`Active` 池角色标注与精确重置倒计时，窄预算下压缩为单行紧凑摘要。
- **P1 会话与今日 KPI 账本表**：`Cost`（会话/今日/缓存节省，空会话不误报未定价）、`Prompt Cache`（命中率、有效综合输入费率 `Eff. In` 与缓存写入量）、`Speed / TTFT`（含缓存 vs 非缓存 TTFT 对比）及可选 1 行 `Orchestrator Split` 拆分行。
- **P3 最近调用微表（Latest Call）**：最新一次调用的模型、状态徽章（含 0-token 失败/重试调用）、`In / Out (Think)`、缓存命中率、多币种费用及 `TTFT / Total · Speed`。
- **P4 智能事件警报**：14 天内官方定时调价倒计时、模型下线 `Notice` 提醒、重试开销（`Retry Waste`）及 AI 积分到期提醒。
- **P0 置底一键操作栏**：`MarkdownString.isTrusted` 仅白名单放行 `antigravity-context-monitor.showDetails`（直达 `Overview · Activity · Cost · Models · Settings`）与 `antigravity-context-monitor.refresh`。

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
### activity-panel.ts -- GM Data 统一面板渲染与全局账号面板

GM 数据页接入 `telemetry-metrics.ts` 与 `currency.ts`，在按账号过滤的 KPI 条展示生成速度、平均首字延迟与按 token 加权的缓存命中率；在 KPI 下方渲染双列 **Speed & First-Token Cache Ledger（`#telemetryLedgerSection`）**（含多币种缓存节省估算），并在其下方新增可折叠 **Recent Calls Ledger（`#recentCallsLedger`）**（按账号过滤最近 20 次调用：时间、实际模型、新输入、输出及思考占比、缓存命中率、多币种费用或诚实 `Unpriced` 徽章、TTFT、总耗时、噪声门限过滤速度和成功/重试/失败状态，支持 320px 安全横向滚动）；同时保留统一模型统计卡片、时间线遥测标签、上下文情报、工具排行、错误详情、检查点、系统上下文及待归档费用。`buildAccountStatusPanel()` 与 `hasAccountReadyPool()` 供顶部全局账号面板复用。

---

### webview-chat-history-tab.ts -- Sessions / 会话目录

按工作区/仓库分组展示全量对话列表，提供搜索、筛选、逐会话操作（打开工作区/Brain 目录/原始 .pb 文件）。GM 调用数 / 积分 / 最新模型优先读取当前 `gmSummary`，无实时数据时回退到 `monitor-store` 的对话快照。

---

### pricing-store.ts -- 定价数据层

管理模型定价：默认官方价格表、用户自定义持久化、身份匹配、按调用 UTC 时间戳的日期费率、定时调价倒计时（`getUpcomingRateChanges()` / `getUpcomingRateChangeForModel()`）和费用计算。费用估算用于本地观察，不代表 Antigravity 官方账单。

1.17.3 经多源官方文档核实更新：
- **Gemini 4 Neon**：新增官方标准 API 费率（全 1M 窗口统一，Low/Medium/High/Extra High 四档同价）：输入 `$3.00`、输出含思考 `$15.00`、隐式缓存读取 `$0.15`（95% 折扣），无显式缓存写入费、无已公布定时调价；历史零费用 Neon 记录可通过 `reconcileRecordedCalls()` / `backfillMissingCosts()` 自动补账。
- **Claude Sonnet 5.5 缓存读取校正**：按 2026-11-22 核实的 Anthropic / Vertex AI 官方价表将缓存读取费率由 `$0.20` 修正为 `$0.10`（输入的 0.05×），输入 `$2` / 输出 `$10` / 5 分钟写入 `$2.50` 保持不变；Claude Opus 5.5 保持 `$4` / `$20` / `$0.20` / `$5`。
- **Gemini 3.6 Flash 有界优惠期**：将 `gemini-3.6-flash` 优惠价（`$0.75` / `$3.75` / `$0.075`）精确限定于 `[2026-08-13, 2027-01-01)` UTC，前后按标准价（`$1.50` / `$7.50` / `$0.15`）计价；与 3.7/3.8 Flash（2027-01-01）及 Carbon/Argon（2026-12-01）共用 `SCHEDULED_RATE_CHANGES`。
- **未定价守卫**：旧服务端托管编排器（`M537`/`M667`/`M681`）、`M669`、`M578`（Sonar）与图片模型 `M21` 保持无默认费率（缺失价格绝不等于免费），仍支持用户按模型独立自定义单价；缺少有效调用日期的定时调价模型调用如实返回 `null`（绝不套用当前时间伪造费用）。

---

### model-dna-store.ts -- 模型信息持久化

跨周期保留模型静态信息（`responseModel`、provider、completionConfig 等），动态统计仍来自当前周期的 `GMSummary`。

---

### pricing-panel.ts -- Cost 标签页渲染

生成 Cost 标签页 HTML，导出 `buildModelDNACards()` 供 Models 标签页复用。1.17.3 顶部新增内联**显示币种切换条 + 本地参考汇率输入（`.prc-currency-bar`）**与 **45 天内官方定时调价倒计时横幅（`.rate-change-banner`）**；月度汇总、费用分布条与逐模型明细全面接入 `currency.ts` 并补充提示词缓存节省徽章与思考费用占比。检测到生图但缺少独立图片 Token/积分/GM 计量时仍显示“已知小计，未计入图片生成费用”。价格编辑区展示官方 `gemini-4-neon` 与未定价编排器行，保存时仅持久化自定义或实际改动行。

---

### daily-archival.ts -- 每日归档核心逻辑

可测试纯函数模块，依赖通过 `DailyArchivalContext` 注入。日期滚动时归档昨日数据并重置 Tracker。数据源优先使用 `DailyLedger.rollover()`（实时增量账本），无数据时降级到旧的 `getArchivalSummary()` + `pendingArchives` 路径。`buildGMSummaryFromLedger()` 现在保留并还原真实 `avgTTFT`、`minTTFT`、`maxTTFT`、`avgStreaming`、`timedOutputTokens`、`timedStreamingSeconds`、`cacheHitCalls` 与 `totalCacheRead`（不再写死为 `0`）。支持注入模拟时间，配合假时钟测试验证跨午夜、stale ledger 启动补归档等时间边界。

---

### daily-ledger.ts -- 实时增量账本

`reconcileRecordedCalls()` 在正常新增游标之外校对已记录调用，严格匹配身份、账号、模型、Token 与可信日期后补充元数据和零费用缺口。已有正费用及调用/Token 数量不变，重复执行不会累计费用；对应回归位于 `tests/ledger-cost-reconciliation.test.ts`。

不依赖 LS 对话缓存生命周期的独立调用记录模块。按日期+账号分桶，每次轮询后通过 `GMTracker.getNewCallsSinceLastRecord()` 提取增量写入，调用数据一旦记录就不会丢失。在保持 `DailyLedgerState.version = 1` 完全向后兼容的前提下，于 `LedgerModelStats`、`LedgerRecordedCall` 与 `LedgerSettledEntry.modelTelemetry` 中新增可选增量遥测字段（`ttftSum`/`ttftCount`/`minTTFT`/`maxTTFT`/`streamingSum`/`streamingCount`/`timedOutputTokens`/`timedStreamingSeconds`/`cacheHitCalls` 及逐调用 `ttftSeconds`/`streamingSeconds`），旧版 v1 持久化数据恢复时自动按缺省安全兼容。额度重置结算由上游 resetTime 周期切换判定驱动，不因小幅 resetTime 漂移直接触发。核心方法：
- `recordCalls(entries)` — 增量录入 + `dedupKey` 去重
- `settleForQuotaReset(email, poolModels)` — 额度重置时将活跃桶数据冻结到已结算区（保留 `modelTelemetry`）
- `rollover(dateKey)` — 午夜日结，返回完整日数据并清零
- `clearRecordedIdsForConversation(cascadeId)` — 对话回退时清除旧 dedup 索引
- `serialize()` / `restore()` — 持久化到 `globalState`

账本会同时过滤“早于当天零点”和“已属于下一天”的调用时间戳，避免跨午夜加载历史或未来日调用时污染当前日期桶。

---

### daily-store.ts -- 日历数据层

按天聚合 Activity + GM + Cost 快照数据，默认 replace 模式（一天一条）。`GMModelCycleStats` 在保持 v1 架构向后兼容的前提下新增可选 `cacheReadTokens`、`cacheCreationTokens`、`avgStreaming`、`avgGenTokPerSec` 与 `tokenCacheHitRate` 字段；`backfillMissingCosts()` 同步利用保留的 `cacheReadTokens` 进行更准确的补价。提供 `mergeRecords()` 用于跨版本数据迁移合并（只添加不存在的日期，不覆盖已有记录）。

---

### webview-calendar-tab.ts -- 日历页渲染

月度 / 全部统计切换 + 7 列交互月历网格 + 可展开日详情（GM 调用 / Token / 费用 / 积分汇总 + 模型明细行与归档周期），支持跨周期时间加权归档生成速度（`.cal-chip-speed`）、自适应 `avgTTFT` 及按 token 加权的 `tokenCacheHitRate`（旧记录平滑回退 `cacheHitRate`），全量使用 `--ed-*` 设计变量并支持双语表头在窄屏下折行。

---

### webview-panel.ts -- WebView 面板框架与 Studio Telemetry Ledger 样式架构

面板框架在 `<body>` 注入 `data-lang="${currentLang}"` 属性，管理吸顶两行页首、2px 滑动标签指示条、全局账号下拉面板、消息通信（白名单含 `statusBar.showSpeed` / `statusBar.showCacheHit` / `statusBar.showSessionCost` / `pricing.displayCurrency` / `pricing.cnyExchangeRate`，显式币种与汇率变更即使在暂停态也立即刷新并向设置页同步控件状态）、动态透传扩展清单版本给关于页，以及增量刷新（通过 `'todayCostUsd' in p` / `'sessionCostUsd' in p` 避免切换会话或账号时残留旧费用）。`webview-overview-tab.ts` 渲染连接与会话状态、跨池编排器路由胶囊（`.orch-route-pill`）、上下文已用与可用余量、内嵌 4–5 格 L2 速度/TTFT/缓存/会话与今日费用遥测条（`.overview-telemetry-strip`）、可折叠诊断、5h+Weekly 双窗口共享配额池及 AI 积分页脚。

`webview-editorial-styles.ts`（`getEditorialStyles()`）实现 `DESIGN.md` 定义的 **Studio Telemetry Ledger** 设计系统，并在 1.17.3 补充 `.orch-settings-card`、`.orch-route-pill`、`.quota-dual-row`、`.spec-price-row`、`.tag-notice`、`.recent-calls-card`、`.rate-change-banner` 与币种/汇率控件样式，继续保持 Obsidian Slate 深色、Alabaster Studio 浅色、高对比度透传、零宋体排版及 `320px–1440px` 零横向溢出规则。

其他子模块包括 `webview-models-tab.ts`（模型页：实时 **Orchestrator Settings** 卡片展示 Orchestrator Model + Executor Model 与 Default/Custom 徽章、双窗口共享配额池、聊天/图片目录与每模型 API 参考价/诚实 `Unpriced` 行）、`webview-settings-tab.ts`（设置页：7 项状态栏开关含 `#toggleSessionCost` + 独立 **Currency Display / 币种与汇率** 卡片）、`webview-profile-tab.ts`（个人页：隐私遮罩账号、5h+Weekly 双窗口配额与琥珀 `Notice` 标签、AI 积分及可折叠计划详情）、`webview-chat-history-tab.ts`（会话）、`webview-calendar-tab.ts`（多币种日历）、`webview-about-tab.ts`（动态清单版本、USD/CNY 费用简介与全系 Gemini 4 512K 窗口说明）、`webview-script.ts`、`webview-styles.ts`、`webview-icons.ts` 与 `webview-helpers.ts`。

---

### i18n.ts -- 国际化与双语排版辅助

支持三种语言模式（`zh` / `en` / `both`），启动时从 `durable-state.ts` 恢复偏好。提供纯文本翻译接口 `t()` / `tBi()`（用于属性、`<option>`、状态栏和 Markdown 悬停摘要）、结构化 HTML 双语辅助 `tBiHtml(en, zh)`（输出 `.bi-en`/`.bi-sep`/`.bi-zh` 节点以实现视觉主次层级同时保留完整无障碍 `textContent`，由 `webview-helpers.ts` 复导）、跨操作系统区域稳定的 `formatNumber()`，以及统一术语键 `unit.tokens` / `unit.token`。

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
├── daily-ledger.ts       ← 实时增量账本（轮询录入 + 额度结算 + 耗时/缓存累加 + 午夜归档数据源）
│   └── telemetry-metrics.ts ← 速度有效门限常量
├── daily-archival.ts     ← 每日归档核心逻辑（纯函数）
│   ├── activity-tracker.ts
│   ├── gm-tracker.ts
│   ├── daily-ledger.ts   ← rollover() 提供完整日数据（含耗时与缓存指标）
│   ├── daily-store.ts
│   ├── pricing-store.ts
│   └── model-dna-store.ts
├── durable-state.ts      ← 扩展外部持久化
├── monitor-store.ts      ← Monitor 快照持久化
│   ├── tracker.ts (types)
│   └── gm-tracker.ts (types)
├── pool-utils.ts         ← 配额池辅助
├── model-quota.ts        ← 跨家族基础模型思考档位合并与 5h/Weekly 双窗口配额汇总
├── currency.ts           ← 离线本地 USD/CNY/both 币种与汇率格式化
├── account-credits.ts    ← 当前 AI 积分归一化、去重与未知安全汇总
├── telemetry-metrics.ts  ← 纯遥测引擎（tok/s、Cached/Uncached TTFT、提示词缓存与节省估算）
│   ├── gm/types.ts (types)
│   ├── models.ts
│   └── pricing-store.ts
├── monitor-overview.ts   ← 状态栏与总览共享的状态/编排路由/上下文/双窗口配额/多币种与遥测格式化
│   ├── currency.ts
│   └── telemetry-metrics.ts
├── tooltip-budget.ts     ← 优先级分层悬停区块预算（HoverSection[]）与配额池代表选择
├── backend-connection.ts ← 当前 IDE 实例连接提示与完整连接标识比对
├── discovery.ts          ← LS / agy hub 进程与 daemon hub JSON 发现（多端点探测 + IPv6）
├── tracker.ts            ← Token 计算 + 编排设置 + 双窗口配额 + 数据获取
│   ├── rpc-client.ts     ← RPC 通信（含 Connect 流首帧解析）
│   ├── models.ts         ← 模型配置
│   │   └── i18n.ts       ← 国际化
│   └── constants.ts      ← 常量
├── statusbar.ts          ← 状态栏（含可选速度/缓存/会话费用）与分层结构化悬停摘要 UI
│   ├── currency.ts
│   ├── pricing-store.ts
│   ├── tracker.ts
│   ├── models.ts
│   ├── model-quota.ts
│   ├── monitor-overview.ts
│   ├── telemetry-metrics.ts
│   ├── tooltip-budget.ts
│   └── i18n.ts
├── i18n.ts               ← 语言偏好 / 翻译 / tBiHtml / formatNumber
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
│   ├── gm-tracker.ts (types)
│   └── telemetry-metrics.ts
└── webview-panel.ts      ← WebView 面板
    ├── i18n.ts
    ├── tracker.ts (types)
    ├── models.ts
    ├── monitor-overview.ts
    ├── account-credits.ts
    ├── telemetry-metrics.ts (via monitor-overview / activity-panel / calendar)
    ├── activity-tracker.ts
    ├── gm-tracker.ts
    ├── pricing-store.ts
    ├── model-dna-store.ts (types)
    ├── daily-store.ts
    ├── webview-overview-tab.ts
    ├── webview-models-tab.ts
    ├── webview-profile-tab.ts
    ├── webview-settings-tab.ts
    ├── webview-chat-history-tab.ts
    ├── webview-about-tab.ts
    ├── activity-panel.ts
    ├── pricing-panel.ts
    ├── webview-calendar-tab.ts
    ├── webview-script.ts
    ├── webview-styles.ts
    ├── webview-editorial-styles.ts
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
# Node.js：遵循 package.json engines
# 按锁文件安装依赖
npm ci

# 编译
npm run compile

# 测试
npm test
npm run test:watch

# 打包
npm run package
```

在 Antigravity IDE 命令面板中执行 `Extensions: Install from VSIX...`，选择 `antigravity-context-monitor-1.17.3.vsix` 后重载窗口。命令面板快捷键为 Windows/Linux 的 `Ctrl+Shift+P`、macOS 的 `Cmd+Shift+P`。

测试文件位于 `tests/`，仅供 Vitest 与本地浏览器/原生验收使用，不会被打包到 VSIX 中。

发布验收使用编译输出与重新打包安装的 1.17.3。编译、回归测试、安装包一致性、无障碍/响应式矩阵、原生 IDE 交互和平台测试范围集中记录在发布说明。[1.17.3 验证](releases/1.17.3.md#验证)

自动化 UI 与视觉验收统一由 `tests/installed-ide-ui.cjs` 驱动：
- `node tests/installed-ide-ui.cjs --installed <目录>`（加 `--smoke` 运行快速冒烟）：基于 Chromium 与已编译/已安装 JS 渲染合成数据，覆盖全部 9 个标签页、浅色 / 深色 / 高对比度主题、三种语言（`en` / `zh` / `both`）与 `320px–1440px` 宽度，校验 axe-core WCAG 2.1 AA 对比度、WCAG 1.4.11 非文本对比度、零横向溢出、交互状态及零旧版 Prompt/Flow 残留，并内置 CDP 断连/超时自动回收会话机制。
- `node tests/installed-ide-ui.cjs --installed . --screenshots-dir <输出目录> --screenshot-theme both --screenshot-lang both --overwrite`：批量导出全部 9 页浅/深色 `1200×860` 评审与 README 定稿截图（亦支持 `--screenshot <文件> --screenshot-tab <页签>` 单页导出）。
- `node tests/installed-ide-ui.cjs --native`：调用本地无障碍检查已安装扩展在原生 IDE 窗口中的界面状态。

2026-11-13 按维护者要求停用 GitHub 自动编译/测试 CI，并移除 `.github/workflows/verify.yml`。本地编译、Vitest 和 IDE 安装验收继续保留；平台 mock 结果与 Windows/Linux 原生测试仍须区分。

### 1.17.1 Orchestrator 补充

`models.ts` 注册协调模型与 M669 隐藏执行模型。`extension.ts` 同步 `executionModelId` 并隔离跨实测模型的压缩判断。`gm/parser.ts` 使用 execution ID 和步骤恢复时间并关联嵌入调用。`webview-models-tab.ts` 展示委派关系，`pricing-panel.ts` 提供独立的自定义计价。`tests/orchestrator.test.ts` 覆盖冷启动、目录变化、异常数据、多调用、持久化、计价及三种显示语言。[1.17.1 历史验证](releases/1.17.1.md#验证)

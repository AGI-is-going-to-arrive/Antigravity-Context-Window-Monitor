# Antigravity 上下文窗口监控

在 Antigravity IDE 中实时监控会话上下文、Orchestrator 编排与执行路由、双窗口模型配额（`5h` + `周`）、模型生成速度（`tok/s`）、首字延迟与提示词缓存效率、双币种 API 等价费用（`USD` / `CNY`）、重置时间和 AI 积分。

**1.17.3** 修复了 `agy` v1.5.14+ 后端发现异常（彻底解决因 `GetUnleashData` 接口下线导致的「上下文: 不可用」），全面支持**自定义编排模式与 Orchestrator 设置**（含 **Orchestrator Claude Opus 5.5**、跨池 `规划 → 执行` 追踪、Neon 与 Hydrogen 统一的 `超高 / Extra High` 思考档位，以及 512K 实时检查点上限），新增**双窗口配额（`5 小时` + `每周`）**，全面更新**官方模型计费表**（新增 **Gemini 4 Neon** `$3/$15/$0.15` 官方价、修正 **Claude Sonnet 5.5** 缓存读取费率 `$0.20 → $0.10`、补充 **Gemini 3.6 Flash** 有界优惠区间，并带来纯离线 **USD / CNY / 双币种**切换与官方调价倒计时），同时全面重构**状态栏悬停摘要**并在 **GM 数据**页新增可折叠的**最近调用明细**。

[English](README.md) · [1.17.3 发布说明与验证](docs/releases/1.17.3.md#中文) · [技术实现](docs/technical_implementation.md) · [项目结构](docs/project_structure.md) · [变更日志](CHANGELOG.md)

## 1.17.3 核心更新

- **修复后端发现（适配 `agy` v1.5.14+，解决「上下文: 不可用」）：** 将单一 `GetUnleashData` 探活升级为多端点 CSRF 探测链（`GetStatus → GetUnleashData → GetUserStatus`），新增 `daemon/hub_<port>.json` 与直连提示回退（不再因 `GetUnleashData` 返回 404 中断连接），加固 macOS、Windows、Linux、WSL 与 IPv6（`[::1]` / `127.0.0.1`）本地环回适配，并在后端重启后即时自动重连。
- **全面支持 Orchestrator 与编排设置（含 `Orchestrator Claude Opus 5.5` 与跨池路由）：** 通过 Connect 协议 `JetboxSubscribeToState` 与 Mendel `orchestrator-model-roles` 实时读取全局 **Orchestrator 设置**（`编排模型` + `执行模型`），完整支持各编排/执行模型的可选思考档位（Gemini 4 Neon 与 Gemini 4 Hydrogen 统一对齐 **`Extra High / 超高`**），在**总览**、**模型**与悬停摘要中追踪跨池 `规划 → 执行` 组合（如 `Claude Opus 5.5 + Gemini 4 Hydrogen` 或 `Gemini 4 Neon + Claude Sonnet 5.5`），将全部 Gemini 4 与 Orchestrator 模型统一同步至 **512K（`512,000`）** 实时检查点上限，新增 `M669`（`Gemini 4 Hydrogen (Orchestrator)`）及 `M530`/`M531`/`M578` 支持，并展示 **GPT-OSS 120B** 的 `Notice` 下线提示标签。
- **官方模型计费更新与离线双币种（`USD` / `CNY` / `双币种`）：** 新增经核实的 **Gemini 4 Neon** 官方价（输入 `$3.00` / 输出与思考 `$15.00` / 缓存读取 `$0.15` 每百万 tokens，全 1M 上下文统一费率，并自动对历史零费用账目执行补算对齐），修正 **Claude Sonnet 5.5** 缓存读取费率（`$0.20 → $0.10`），补充 **Gemini 3.6 Flash** 有界优惠排期（`[2026-08-13, 2027-01-01)`），新增纯离线币种切换（`USD`、`CNY` 或`双币种`）与自定义参考汇率（默认 `7.2`，零外部网络请求），提供**官方定时调价提醒**横幅（Carbon/Argon `2026-12-01`、Flash `2027-01-01`），严格守护未定价模型（`M537`/`M667`/`M681`/`M669`/`M578`/`M21` 绝不伪造 `$0.00`），并在**模型**规格卡片展示 API 参考价格。
- **双窗口配额（`5 小时` + `每周`）：** 通过 `RetrieveUserQuotaSummary` 实时获取 5 小时与每周双窗口配额（在旧版后端上平滑降级为单窗口 5h 显示），统一贯穿**总览**、**模型**、**个人**与**悬停摘要**，高比例读数采用向下截断精度（`99.3%`–`99.9%` 不再误四舍五入为 `100%`）。
- **重构状态栏悬停摘要与最近调用明细：** 采用按优先级分层、缩放感知的预算引擎（`compact` / `auto` / `full`），在任何缩放级别下均保护**剩余配额**与底部快捷栏不被裁剪；新增**最近一次调用**微表（新鲜输入 / 输出与思考 / 缓存命中率 / 费用 / 首字与总耗时 / 去噪解码速度 / 状态）、**会话与今日费用**（含缓存节省与等效混合输入单价）、**编排拆分**（规划 vs 执行调用次数与费用）、事件驱动告警（14 天调价倒计时、GPT-OSS `Notice` 下线提示、重试损耗、AI 积分）、一键受信任底部导航（`总览 · 活动 · 费用 · 模型 · 设置 · 刷新`）、可选状态栏会话费用胶囊（`statusBar.showSessionCost`），以及 **GM 数据**页中的可折叠**最近调用明细**（展示最新 20 次调用）。

## 安装

1. 从发布附件获取 `antigravity-context-monitor-1.17.3.vsix`，或使用 `npm run package` 在本地打包。[GitHub Releases](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases)
2. 在 Antigravity IDE 中打开命令面板：macOS 使用 `Cmd+Shift+P`，Windows 与 Linux 使用 `Ctrl+Shift+P`。执行 **Extensions: Install from VSIX...**，选择下载的文件。
3. 重载窗口，在扩展详情或监控器的**关于**页确认版本为 **1.17.3**。

也可以通过 [Open VSX](https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor) 安装注册表中的已发布版本。

扩展支持 macOS、Windows、Linux 和 WSL。本版原生 IDE 验收在 macOS 上完成，Windows 与 Linux 分支的模拟测试范围见发布说明。[验证](docs/releases/1.17.3.md#验证)

## 使用监控器

- **悬停右下角状态栏监控项：** 查看当前会话与模型（或跨池 **编排 `规划 → 执行`** 路由）、上下文进度条与已用/剩余 tokens、**最近一次调用**明细（输入/输出/思考、缓存命中率、费用、首字/总耗时与去噪生成速度）、**会话与今日费用**（含缓存节省与等效混合输入单价）、**编排拆分**、带规划/执行角色标注的**双窗口（`5h` + `周`）共享配额**、事件驱动提醒（调价倒计时、模型下线提示、重试损耗与 AI 积分），以及一键直达**总览**、**活动**、**费用**、**模型**、**设置**与**刷新**的快捷链接。可在设置中切换**自动**、**精简**或**完整**密度，并按需开启状态栏**生成速度（`tok/s`）**、**提示词缓存命中率（`%`）**或**当前会话费用**常驻显示（无实时数据时自动隐藏）。
- **点击状态栏监控项：** 打开**总览**。页首吸顶控件支持打开多账号快照（**账号面板**）、即时切换中文 / 英文 / 双语、暂停自动轮询或手动刷新。
- **展开会话诊断：** 查看提供商上报的 Token 计数、自动压缩事件与图片生成活动。监控器明确区分实测值与估算值，在流式响应时原地更新读数，并在回退或切换模型后重新计算上下文。

## 监控页面

面板在 `320px` 窄分屏至 `1440px` 宽编辑区之间自适应排版，自动跟随 IDE 的浅色、深色与高对比度主题，并满足 WCAG 2.1 AA 对比度标准。下方截图使用示例数据，展示双语模式下的 **Obsidian Slate 深色**主题。

### 总览

查看当前会话、活跃**编排 `规划 → 执行`**跨池路由标签、上下文已用与可用余量、内嵌 4–5 格 L2 遥测条（生成速度 `tok/s`、自适应 TTFT、按 token 加权的缓存命中率、缓存节省及按所选币种展示的会话/今日费用）、可折叠会话诊断、带语义健康进度条与重置倒计时的**双窗口（`5h` + `周`）**共享配额池，以及底部 AI 积分摘要。

![Obsidian Slate 深色主题下的双语总览页，展示活跃上下文、编排路由标签、L2 速度/TTFT/缓存/费用遥测条、双窗口共享配额池与 AI 积分](src/images/monitor-overview.png)

<details>
<summary>GM 数据 — 速度、TTFT、提示词缓存账本、最近调用明细与时间线</summary>

按模型和会话实时分析 Generator Metadata，包含按账号过滤的顶部 KPI 概览、双列**生成速度与首字缓存账本**（加权/最新/中位/可见 `tok/s`、**缓存 vs 非缓存 TTFT** 对比条与 3 段式提示词缓存进度条、预热状态与节省估算）、可折叠**最近调用明细**（最新 20 次调用：时间、实际模型、新鲜输入、输出与思考占比、缓存命中率、费用/未定价、首字耗时、总耗时、去噪速度与状态）、统一逐模型统计卡片、逐步骤与逐轮次时间线遥测标签、当日账本、工具调用排行、上下文增长趋势及错误详情。

![Obsidian Slate 深色主题下的双语 GM 数据页，展示 KPI 概览、生成速度与首字缓存账本、最近调用明细与模型统计](src/images/monitor-gm-data.png)

</details>

<details>
<summary>会话 — 可搜索的对话记录</summary>

按工作区分组浏览会话上下文与历史记录，支持按当前工作区、仓库、运行状态或可备份状态筛选，并一键定位本地工作区、Brain 记录目录或 `.pb` 原始文件。

![Obsidian Slate 深色主题下的双语会话页，展示工作区分组、搜索与本地化状态标签](src/images/monitor-sessions.png)

</details>

<details>
<summary>成本 — 双币种估算、官方调价提醒与自定义 API 费率</summary>

通过顶部内联币种工具栏与纯离线参考汇率以 **USD**、**CNY** 或**双币种**查看月度与当日费用估算、汇总与逐模型缓存节省、思考费用占比、四分项成本分布堆叠条（输入 / 输出 / 缓存 / 思考），以及**官方定时调价提醒**横幅（Carbon/Argon `2026-12-01`、Flash `2027-01-01`）。支持按每百万 tokens 自定义家族或单模型费率；尚未核实价格的用量明确标注为未定价，绝不伪造 `$0.00`。

![Obsidian Slate 深色主题下的双语成本页，展示双币种控件、调价提醒横幅、四分项分布图与自定义定价表](src/images/monitor-cost.png)

</details>

<details>
<summary>模型 — Orchestrator 编排设置、双窗口配额池与模型参数</summary>

查看实时 **Orchestrator 编排设置**（`编排模型` + `执行模型`、默认/自定义状态与跨池角色标记）、当前默认模型、合并后的 Gemini 与 Claude / GPT **双窗口（`5h` + `周`）**共享配额池、重置计划、可用模型家族与思考档位（`低` / `中` / `高` / `超高`）、规格卡片内置 API 参考价格、`Notice` 下线标签（如 GPT-OSS 120B），以及 IDE 上报的详细模型参数。聊天目录与图片生成目录独立展示。

![Obsidian Slate 深色主题下的双语模型页，展示编排设置、双窗口共享配额池、API 参考价格与 512K Gemini 4 规格](src/images/monitor-models.png)

</details>

<details>
<summary>日历 — 每日用量、双币种汇总、归档速度/TTFT/缓存与周期归档</summary>

在**月度**与**全部**统计间一键切换，通过 7 列交互月历浏览每日活跃标记与双币种费用标签，展开任意日期即可查看逐模型统计、归档生成速度（`tok/s`）、自适应 TTFT、按 token 加权的提示词缓存命中率与归档周期。

![Obsidian Slate 深色主题下的双语日历页，展示月度汇总、双币种总额与每日活跃网格](src/images/monitor-calendar.png)

</details>

<details>
<summary>个人 — 计划、双窗口共享配额、AI 积分与账号设置</summary>

查看账号身份（默认开启隐私遮罩，可一键切换）、当前订阅计划、**双窗口（`5h` + `周`）**模型共享配额池、琥珀色下线模型 `Notice` 提醒标签、Google AI 积分（缺失时标注**未上报**）、按账号配置的每月积分到期日，以及可折叠的计划限制、功能开关与团队配置。

![Obsidian Slate 深色主题下的双语个人页，展示隐私遮罩账号、双窗口共享配额与 AI 积分](src/images/monitor-profile.png)

</details>

<details>
<summary>设置 — 持久化存储、轮询、币种汇率与状态栏</summary>

查看外部持久化存储状态与路径，配置低配额提醒阈值、轮询间隔、七项状态栏开关（含可选开启的生成速度 `tok/s`、提示词缓存命中率 `%` 与带实时币种预览的**当前会话费用**）、**币种与汇率**（`USD` / `CNY` / `双币种` + 离线参考汇率）、悬停摘要密度（`auto` / `compact` / `full`）、内部模型 ID 显示、界面缩放比例，以及滚动条和页底提示偏好。

![Obsidian Slate 深色主题下的双语设置页，展示状态栏开关、币种与汇率卡片及持久化存储](src/images/monitor-settings.png)

</details>

<details>
<summary>关于 — 版本、兼容性与功能导航</summary>

确认已安装的扩展版本（`v1.17.3`，从扩展清单动态读取）与 512K 上下文兼容性范围，通过双列功能导航卡片直达各个监控页面，并查阅开源仓库与兼容性说明。

![Obsidian Slate 深色主题下的双语关于页，展示 1.17.3 版本与功能导航卡片](src/images/monitor-about.png)

</details>

## 模型、上下文与计价

- 可用模型以当前登录账号的实时目录为准。状态栏悬停摘要与**总览**按基础模型家族合并统计已核实的思考档位；**模型**规格、**GM 数据**与**成本**账本保留每个档位的独立 ID。
- **Orchestrator 与 Gemini 4 家族：** 全部 **Gemini 4** 家族（**Neon**、**Hydrogen**、**Carbon**、**Argon**）与 **Orchestrator** 模型（`M537`、`M667`、`M681`、`M669`）均采用统一的 **512,000 tokens** 实时检查点上限（模型上下文 `1,048,576`、最大输出 `262,144`）。**Gemini 4 Neon** 与 **Gemini 4 Hydrogen** 均提供 `低` / `中` / `高` / `超高` 四档思考力度。在**自定义编排模式**下，任意合格编排模型（含 **Claude Opus 5.5** 与 **Gemini 4 Neon**）均可与任意合格执行模型（如 **Gemini 4 Hydrogen** 或 **Claude Sonnet 5.5**）自由组合，各阶段按实际调用模型独立计价并跨配额池追踪。
- **内置官方 API 等价参考费率（美元 / 百万 tokens，2026-11-22 核实）：**

| 模型家族 | 输入 | 输出 / 思考 | 缓存读取 | 缓存写入 | 说明 / 调价排期 |
| --- | ---: | ---: | ---: | ---: | --- |
| **Gemini 4 Neon**（低–超高） | `$3.00` | `$15.00` | `$0.15` | `$0` | 全 1M 上下文统一费率；隐式缓存读取 |
| **Gemini 4 Hydrogen**（低–超高、`M530`/`M531`） | `$1.50` | `$7.50` | `$0.075` | `$0` | 全 1M 上下文统一费率；`M578` Sonar 未定价 |
| **Gemini 4 Carbon / Argon** | `$2.00` → `$4.00` | `$10.00` → `$20.00` | `$0.10` → `$0.20` | `$0` | 优惠价将于 `2026-12-01` UTC 结束（`2×` 标准价） |
| **Claude Opus 5.5**（低–高） | `$4.00` | `$20.00` | `$0.20` | `$5.00` | 5 分钟 TTL 缓存写入费率 |
| **Claude Sonnet 5.5**（低–高） | `$2.00` | `$10.00` | `$0.10` | `$2.50` | 已修正缓存读取费率（`$0.10`）；5 分钟 TTL 写入 |
| **Gemini 3.8 / 3.7 / 3.6 Flash** | `$0.75` → `$1.50` | `$3.75` → `$7.50` | `$0.075` → `$0.15` | `$0.9375` → `$1.875` | 优惠价将于 `2027-01-01` UTC 结束（3.6 区间自 `2026-08-13` 起） |
| **GPT-OSS 120B (Medium)** | `$0.09` | `$0.36` | `$0` | `$0` | 当 IDE 上报下线通知时显示 `Notice` 标签 |
| **旧版编排与图片模型**（`M537`/`M667`/`M681`/`M669`/`M578`/`M21`） | 未定价 | 未定价 | 未定价 | 未定价 | 绝不伪造 `$0.00`；可在**成本**页设置自定义价格 |

- 上下文读数优先采用当前 planner 响应或 checkpoint 中模型提供商报告的新输入、缓存读取、缓存创建与输出。缺少时间戳的历史定时调价模型调用会诚实保留为未定价，不以当前日期伪造费率。订阅 AI 积分独立展示（缺失时显示**未上报**而非 `0`）。[模型与计价说明](docs/technical_implementation.md)

## 命令与设置

| 命令 | 用途 |
| --- | --- |
| **Show Context Window Details** | 打开总览（同时支持悬停快捷直达 `gmdata`、`pricing`、`models`、`settings`） |
| **Refresh Context Window Monitor** | 重新连接后端并重启轮询 |
| **Switch Display Language** | 选择英文、中文或双语显示 |
| **Show Model Activity** | 打开 GM 数据 |

IDE 设置项使用 `antigravityContextMonitor.` 前缀（共 15 项）：

| 设置项 | 默认值 | 用途 |
| --- | --- | --- |
| `pollingInterval` | `5` | 设置轮询间隔，单位为秒 |
| `statusBar.showContext` | `true` | 在状态栏显示上下文用量 |
| `statusBar.showQuota` | `true` | 显示当前模型的剩余配额百分比 |
| `statusBar.showResetCountdown` | `true` | 显示当前模型的配额重置倒计时 |
| `statusBar.showAiCredits` | `true` | 在状态栏显示 AI 积分余额（未上报时隐藏） |
| `statusBar.showSpeed` | `false` | 在状态栏显示最新或加权平均模型生成速度（`tok/s`，无有效耗时样本时自动隐藏） |
| `statusBar.showCacheHit` | `false` | 在状态栏显示按 token 加权的提示词缓存命中率（`%`，无提示词数据时自动隐藏） |
| `statusBar.showSessionCost` | `false` | 在状态栏显示当前会话估算的 API 等价费用（费用为 0 或未定价时自动隐藏） |
| `statusBar.tooltipDensity` | `auto` | 选择 `auto`（自动）、`compact`（精简）或 `full`（完整）悬停摘要密度 |
| `pricing.displayCurrency` | `"USD"` | 选择费用显示币种：`"USD"`（美元）、`"CNY"`（人民币）或 `"both"`（双币种） |
| `pricing.cnyExchangeRate` | `7.2` | 离线美元兑人民币参考汇率（`0.01`–`1000`，不发起外部网络请求） |
| `quotaNotificationThreshold` | `20` | 低于该配额百分比时提醒，设为 `0` 可禁用 |
| `showModelInternalId` | `false` | 在模型名旁显示内部 ID |
| `activity.maxRecentSteps` | `100` | 限制持久化保留的近期活动时间线条数 |
| `activity.maxArchives` | `20` | 限制保留的活动归档数量 |

## 排障与限制

- **无活跃会话**表示后端已连接，当前视图尚无已加载对话。打开任意对话即可读取上下文。同一工作区的窗口可能共享会话数据，需要独立观察时请打开不同文件夹。
- **后端连接已断开**或 **LS not found** 指向本地发现或连接异常。安装后请重载窗口，再打开**输出 → Antigravity Context Monitor** 检查 `PATH check:`。扩展同时支持 `agy --hub`（含 v1.5.14+ 的 `GetStatus` 与 `daemon/hub_<port>.json`）及旧版语言服务器。Windows 使用 PowerShell、netstat 等系统工具，请以普通用户身份运行 Antigravity。[后端发现](docs/technical_implementation.md)
- WSL 环境支持检测当前发行版并经 WSL interop 连接。使用 Remote-WSL 或 Remote SSH 时，Antigravity 可在本地界面宿主中运行扩展。[项目结构](docs/project_structure.md)
- 超长或经过 IDE 摘要处理的会话可能存在部分遥测缺失，监控器会明确标注估算值与缺失步骤。在编排模式下，监控器会跨池独立追踪 `planModel` 与 `executionModel` 的调用与计费，同时保持准确的上下文读数。[上下文与 Token 计算](docs/technical_implementation.md) · [Checkpoint 摘要社区讨论](https://www.reddit.com/r/google_antigravity/comments/1q7zcag/heres_how_to_find_which_mcp_tools_are_leading_to/)

## 致谢

由 **AGI-is-going-to-arrive** 维护。感谢 **SecretLUL** 报告 Windows 后端发现问题。[Issue #64](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/issues/64)

[MIT 许可证](LICENSE) · [LINUX DO](https://linux.do/) · [Star 趋势](https://www.star-history.com/#AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor&type=date&legend=top-left)

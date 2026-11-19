# Antigravity 上下文窗口监控

在 Antigravity IDE 中实时监控会话上下文、模型生成速度（`tok/s`）、首字延迟与提示词缓存效率、模型共享配额、重置时间和 AI 积分。

**1.17.2** 为监控器全部九个页面带来 **Modern Editorial Telemetry（"Studio Telemetry Ledger"）** 全新视觉重做，新增全链路**模型生成速度（`tok/s`）、首字延迟（缓存 vs 非缓存）与首字/提示词缓存遥测**，升级右下角状态栏与悬停摘要，实现跨全部模型家族的基础模型思考档位合并，重构**个人**页，并新增 **Gemini 4 Neon**（低 / 中 / 高 / 超高四档）及 **Orchestrator (Neon)** 支持。

[English](README.md) · [1.17.2 发布说明与验证](docs/releases/1.17.2.md#中文) · [技术实现](docs/technical_implementation.md) · [项目结构](docs/project_structure.md) · [变更日志](CHANGELOG.md)

## 1.17.2 核心更新

- **模型生成速度（`tok/s`）、首字延迟与首字/提示词缓存遥测：** 由纯计算引擎 `src/telemetry-metrics.ts` 驱动，严格遵循已核实的 Antigravity protobuf 语义（仅解码流式时长、相加式 `input + cacheRead + cacheCreation` 提示词总分母、含显式与隐式思考的可见输出拆分、总和比值时间加权速度、双层噪声过滤与未定价节省保护）。完整贯穿**总览**（4 格 L2 遥测条）、**GM 数据**（按账号过滤的 KPI 条、独立双列**生成速度与首字缓存账本**——含**缓存 vs 非缓存 TTFT** 加速对比条与 3 段式提示词缓存进度条、统一逐模型速度与 token 加权缓存命中率卡片，以及逐步骤/逐轮次时间线标签）、**日历**（归档速度、自适应 TTFT 与 token 加权缓存命中率）及**状态栏与悬停摘要**（默认关闭的 `showSpeed` / `showCacheHit` 可选开关与 `compact`/`auto`/`full` 三密度遥测）。
- **Studio Telemetry Ledger 界面重做（全部 9 页）：** 全新工作室中性配色体系——**Obsidian Slate 深色**（`#0D1014` / `#14181F`）、**Alabaster Studio 浅色**（`#FAFBFC` / `#FFFFFF`）及原生**高对比度**主题；配备吸顶细线页首、2px Studio Cobalt 滑动标签指示条、语义健康进度条（翠绿 / 琥珀 / 绯红）、统一 `32px` 触感控件，在 `320px` 至 `1440px` 宽度下零横向溢出。
- **零宋体中英文排版与主次双语布局：** 英文展示标题采用光学衬线并直连无衬线系统/CJK 字体栈（杜绝回退到宋体 / SimSun），全量指标启用等宽数字（`tabular-nums`）保证每 5 秒刷新不抖动；双语模式下中文副文自动退居次级层级，同时保持完整无障碍语义文本。
- **重做状态栏与悬停摘要：** 支持**自动（`auto`）**、**精简（`compact`）**、**完整（`full`）**三种摘要密度，清晰呈现已用与剩余 tokens、可选开启的状态栏速度与缓存命中读数（`statusBar.showSpeed` / `statusBar.showCacheHit`，默认关闭且冷启动自动隐藏）、实时速度 / TTFT / 提示词缓存悬停遥测、共享配额池、精确重置时刻与倒计时（消除跨池重置时间串扰）及未知安全的 AI 积分读数，并可直达**总览**、**模型**与**设置**。
- **跨家族通用思考档位合并：** 自动将 Gemini 4 Neon、Hydrogen、Carbon、Argon、Flash、Pro、Claude Opus/Sonnet/Haiku、GPT-OSS 及受约束的新家族思考档位按基础模型合并计数，同时保持各 Orchestrator 独立展示，并在**模型**规格、**GM 数据**与**成本**账本中完整保留独立档位 ID。
- **Gemini 4 Neon 与 Orchestrator (Neon)：** 完整支持 `Gemini 4 Neon` 低 / 中 / 高 / 超高四档（`M534`/`M533`/`M532`/`M535`）与 `Orchestrator (Neon)`（`M537`，配置执行模型 `M669`），实时压缩上限 512,000 tokens。
- **重构「个人」页：** 移除过时的 Prompt / Flow 旧配额计数，聚焦共享模型配额池、未知安全的 Google AI 积分（缺失时显示**未上报**而非伪造 `0`）、按账号配置的每月积分到期日、默认开启的隐私遮罩，以及可折叠的计划限制与功能配置。

## 安装

1. 从发布附件获取 `antigravity-context-monitor-1.17.2.vsix`，或使用 `npm run package` 在本地打包。[GitHub Releases](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases)
2. 在 Antigravity IDE 中打开命令面板：macOS 使用 `Cmd+Shift+P`，Windows 与 Linux 使用 `Ctrl+Shift+P`。执行 **Extensions: Install from VSIX...**，选择下载的文件。
3. 重载窗口，在扩展详情或监控器的**关于**页确认版本为 **1.17.2**。

也可以通过 [Open VSX](https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor) 安装注册表中的已发布版本。

扩展支持 macOS、Windows、Linux 和 WSL。本版原生 IDE 验收在 macOS 上完成，Windows 与 Linux 分支的模拟测试范围见发布说明。[验证](docs/releases/1.17.2.md#验证)

## 使用监控器

- **悬停右下角状态栏监控项：** 查看当前会话与模型、上下文已用与剩余 tokens、实时**生成速度（`tok/s`）、TTFT（含缓存 vs 非缓存加速对比）与按 token 加权的提示词缓存**遥测、账号计划、共享配额池、精确重置时间与倒计时，以及 AI 积分。各思考档位按基础模型家族计一次。在设置中选择**自动**、**精简**或**完整**：精简模式将各配额池与遥测收敛为单行摘要，完整模式展开中位数（`p50`）速度/TTFT、缓存写入量、家族明细与当前会话诊断。可在设置中按需开启状态栏**生成速度（`tok/s`）**与**提示词缓存命中率（`%`）**常驻显示（冷启动无数据时自动隐藏）。
- **点击状态栏监控项：** 打开**总览**。悬停摘要也提供**总览**、**模型**和**设置**直达链接。页首控件支持打开多账号快照（**账号面板**）、即时切换中文 / 英文 / 双语、暂停自动轮询或手动刷新。
- **展开会话诊断：** 查看提供商上报的 Token 计数、自动压缩事件与图片生成活动。监控器明确区分实测值与估算值，在流式响应时原地更新读数，并在回退或切换模型后重新计算上下文。

## 监控页面

面板在 `320px` 窄分屏至 `1440px` 宽编辑区之间自适应排版，自动跟随 IDE 的浅色、深色与高对比度主题，并满足 WCAG 2.1 AA 对比度标准。下方截图使用示例数据，在双语模式下同时展示 **Obsidian Slate 深色**与 **Alabaster Studio 浅色**主题。

### 总览

查看当前会话、上下文已用与可用余量、内嵌 4 格 L2 遥测条（生成速度 `tok/s`、自适应 TTFT、按 token 加权的缓存命中率及缓存节省与预热状态）、可折叠会话诊断、带语义健康进度条与重置倒计时的共享配额池，以及底部 AI 积分摘要。

![Obsidian Slate 深色主题下的双语总览页，展示活跃上下文、L2 速度/TTFT/缓存遥测条、共享配额池与 AI 积分](src/images/monitor-overview.png)

<details>
<summary>GM 数据 — 速度、TTFT、提示词缓存账本、模型调用与时间线</summary>

按模型和会话实时分析 Generator Metadata，包含按账号过滤的顶部 KPI 概览（含生成速度、平均首字延迟与 token 加权缓存命中率）、双列**生成速度与首字缓存账本**（加权/最新/中位/可见 `tok/s`、**缓存 vs 非缓存 TTFT** 对比条与加速幅度、3 段式提示词缓存分布条、预热状态与节省估算）、统一逐模型统计卡片、逐步骤与逐轮次时间线遥测标签、当日账本、工具调用排行、上下文增长趋势及错误详情。

![Alabaster Studio 浅色主题下的双语 GM 数据页，展示 KPI 概览、生成速度与首字缓存账本、时间线遥测标签与模型统计](src/images/monitor-gm-data.png)

</details>

<details>
<summary>会话 — 可搜索的对话记录</summary>

按工作区分组浏览会话上下文与历史记录，支持按当前工作区、仓库、运行状态或可备份状态筛选，并一键定位本地工作区、Brain 记录目录或 `.pb` 原始文件。

![Obsidian Slate 深色主题下的双语会话页，展示工作区分组、搜索与本地化状态标签](src/images/monitor-sessions.png)

</details>

<details>
<summary>成本 — 费用估算与自定义 API 费率</summary>

按月及模型查看 USD 费用估算、四分项成本分布堆叠条（输入 / 输出 / 缓存 / 思考）与逐模型明细，支持按每百万 tokens 自定义家族或单模型费率；尚未核实价格的用量明确标为**费用暂不可用**并注明已知小计。

![Alabaster Studio 浅色主题下的双语成本页，展示月度汇总、四分项分布图与自定义定价控件](src/images/monitor-cost.png)

</details>

<details>
<summary>模型 — 共享配额与模型参数</summary>

查看当前默认模型、合并后的 Gemini 与 Claude / GPT 共享配额池、重置计划、可用模型家族与思考档位，以及 IDE 上报的详细模型参数。聊天目录与图片生成目录独立展示。

![Obsidian Slate 深色主题下的双语模型页，展示默认模型、共享配额池与 Neon 参数规格](src/images/monitor-models.png)

</details>

<details>
<summary>日历 — 每日用量、归档速度/TTFT/缓存与周期归档</summary>

在**月度**与**全部**统计间一键切换，通过 7 列交互月历浏览每日活跃标记，展开任意日期即可查看逐模型统计、归档生成速度（`tok/s`）、自适应 TTFT、按 token 加权的提示词缓存命中率与归档周期。

![Obsidian Slate 深色主题下的双语日历页，展示月度汇总与每日活跃网格](src/images/monitor-calendar.png)

</details>

<details>
<summary>个人 — 计划、共享配额、AI 积分与账号设置</summary>

查看账号身份（默认开启隐私遮罩，可一键切换）、当前订阅计划、模型共享配额池、Google AI 积分（缺失时标注**未上报**）、按账号配置的每月积分到期日，以及可折叠的计划限制、功能开关与团队配置。已移除过时的 Prompt / Flow 旧计数。

![Alabaster Studio 浅色主题下的双语个人页，展示隐私遮罩账号、共享配额与 AI 积分](src/images/monitor-profile.png)

</details>

<details>
<summary>设置 — 持久化存储、轮询、布局与状态栏</summary>

查看外部持久化存储状态与路径，配置低配额提醒阈值、轮询间隔、六项状态栏开关（含可选开启的生成速度 `tok/s` 与提示词缓存命中率 `%`）、悬停摘要密度（`auto` / `compact` / `full`）、内部模型 ID 显示、界面缩放比例，以及滚动条和页底提示偏好。

![Alabaster Studio 浅色主题下的双语设置页，展示持久化存储、步进器与状态栏开关](src/images/monitor-settings.png)

</details>

<details>
<summary>关于 — 版本、兼容性与功能导航</summary>

确认已安装的扩展版本（`v1.17.2`）与支持平台范围，通过双列功能导航卡片直达各个监控页面，并查阅开源仓库与兼容性说明。

![Obsidian Slate 深色主题下的双语关于页，展示 1.17.2 版本与功能导航卡片](src/images/monitor-about.png)

</details>

## 模型、上下文与计价

- 可用模型以当前登录账号的实时目录为准。2026 年 11 月 19 日核对的目录共有 **27 个可选条目**，其中 Gemini 池 20 个，Claude / GPT 池 7 个。状态栏悬停摘要与**总览**按基础模型家族合并统计已核实的思考档位；**模型**信息卡片与调用账本保留独立档位 ID。池内读数不一致时展示范围并提供可展开的逐档位明细。
- **Gemini 4 Neon** 提供低 / 中 / 高 / 超高四个思考档位；**Orchestrator (Neon)** 提供单一选择器条目，并配置隐藏执行模型 `M669`。五个新增条目均报告 1,048,576 tokens 的模型上下文、262,144 tokens 的最大输出、512,000 tokens 的实时压缩上限及独立的 50,000 tokens 检查点阈值。确切 ID、思考力度与实测结果见发布说明。[Neon 模型目录](docs/releases/1.17.2.md#neon-模型目录)
- 上下文读数优先采用当前 planner 响应或 checkpoint 中模型提供商报告的新输入、缓存读取、缓存创建与输出。历史用量可兼容账号自定义显示名与旧模型 ID。图片生成步骤及上报的图片模型独立展示。
- 费用按本地 API 等价费率与调用时间估算。Neon 等费率尚未核实的模型可在**成本**页设置自定义价格。订阅 AI 积分独立展示（缺失时显示**未上报**而非 `0`）；图片生成费用需依赖 IDE 提供独立模型用量。[模型与计价说明](docs/technical_implementation.md)

## 命令与设置

| 命令 | 用途 |
| --- | --- |
| **Show Context Window Details** | 打开总览 |
| **Refresh Context Window Monitor** | 重新连接后端并重启轮询 |
| **Switch Display Language** | 选择英文、中文或双语显示 |
| **Show Model Activity** | 打开 GM 数据 |

IDE 设置项使用 `antigravityContextMonitor.` 前缀。

| 设置项 | 默认值 | 用途 |
| --- | --- | --- |
| `pollingInterval` | `5` | 设置轮询间隔，单位为秒 |
| `statusBar.showContext` | `true` | 在状态栏显示上下文用量 |
| `statusBar.showQuota` | `true` | 显示当前模型的剩余配额百分比 |
| `statusBar.showResetCountdown` | `true` | 显示当前模型的配额重置倒计时 |
| `statusBar.showAiCredits` | `true` | 在状态栏显示 AI 积分余额（未上报时隐藏） |
| `statusBar.showSpeed` | `false` | 在状态栏显示最新或加权平均模型生成速度（`tok/s`，无有效耗时样本时自动隐藏） |
| `statusBar.showCacheHit` | `false` | 在状态栏显示按 token 加权的提示词缓存命中率（`%`，无提示词数据时自动隐藏） |
| `statusBar.tooltipDensity` | `auto` | 选择 `auto`（自动）、`compact`（精简）或 `full`（完整）悬停摘要密度 |
| `quotaNotificationThreshold` | `20` | 低于该配额百分比时提醒，设为 `0` 可禁用 |
| `showModelInternalId` | `false` | 在模型名旁显示内部 ID |
| `activity.maxRecentSteps` | `100` | 限制持久化保留的近期活动时间线条数 |
| `activity.maxArchives` | `20` | 限制保留的活动归档数量 |

## 排障与限制

- **无活跃会话**表示后端已连接，当前视图尚无已加载对话。打开任意对话即可读取上下文。同一工作区的窗口可能共享会话数据，需要独立观察时请打开不同文件夹。
- **后端连接已断开**或 **LS not found** 指向本地发现或连接异常。安装后请重载窗口，再打开**输出 → Antigravity Context Monitor** 检查 `PATH check:`。扩展同时支持 `agy --hub` 与旧版语言服务器。Windows 使用 PowerShell、netstat 等系统工具，请以普通用户身份运行 Antigravity。[后端发现](docs/technical_implementation.md)
- WSL 环境支持检测当前发行版并经 WSL interop 连接。使用 Remote-WSL 或 Remote SSH 时，Antigravity 可在本地界面宿主中运行扩展。[项目结构](docs/project_structure.md)
- 超长或经过 IDE 摘要处理的会话可能存在部分遥测缺失，监控器会明确标注估算值与缺失步骤。Antigravity 可为子任务调用轻量执行模型，会话仍以所选模型作为上下文参考。[上下文与 Token 计算](docs/technical_implementation.md) · [Checkpoint 摘要社区讨论](https://www.reddit.com/r/google_antigravity/comments/1q7zcag/heres_how_to_find_which_mcp_tools_are_leading_to/)

## 致谢

由 **AGI-is-going-to-arrive** 维护。感谢 **SecretLUL** 报告 Windows 后端发现问题。[Issue #64](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/issues/64)

[MIT 许可证](LICENSE) · [LINUX DO](https://linux.do/) · [Star 趋势](https://www.star-history.com/#AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor&type=date&legend=top-left)

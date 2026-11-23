# Antigravity 上下文窗口监控

在 **Antigravity App（桌面版 2.0+ 原生 Sidecar 插件）** 与 **Antigravity IDE（VSIX 扩展）** 中实时监控会话上下文构成与双水位线（`自动压缩` + `200k` 档位）、带基础费率映射与全链路角色归因的 Orchestrator 编排/执行路由、带续航预测的双窗口模型配额（`5h` + `周`）、模型生成速度（`tok/s`）、首字延迟与逐轮提示词缓存诊断、52 周多源活动热力图（`App` / `IDE` / `CLI`）、多币种 API 等价费用与可选套餐回本估算、重置时间和 AI 积分。

**1.17.6** 推出 **AI 智能体一句话安装与升级（`AGENTS.md`）**、**面板内自动/手动更新检查与一键安全自更新**、**原生 Sidecar 精简 HUD 状态条** 与 **严格按需开启的 CDP 悬浮层**（零 `app.asar`/二进制修改、Shadow DOM、零 `innerHTML`、256-bit 本地鉴权）、**52 周活动热力图与多源遥测日历**（实时今日合并、相加式总 Token、400 天可调保留期、只读 CLI 扫描器、多币种与订阅回本分析、CSV/JSON 导出及两步清空保护）、**编排模型基础映射定价与全链路角色归因**，以及 **App ↔ IDE 双向热同步与跨平台加固**。

[English](README.md) · [AI 智能体一键安装（`AGENTS.md`）](AGENTS.md) · [1.17.6 发布说明与验证](docs/releases/1.17.6.md#中文) · [技术实现](docs/technical_implementation.md) · [项目结构](docs/project_structure.md) · [变更日志](CHANGELOG.md)

## 给 AI 智能体的一句话安装 / 升级（`AGENTS.md`）

将下面这一句话直接发给任意 AI 编程助手（Antigravity、Claude Code、Codex 等）即可自动完成安装或升级——**零 `app.asar` 修改、零外部 npm 依赖、强制校验 SHA-256，且绝不强杀正在运行的 Antigravity 会话**：

> 请阅读 `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor` 中的 `AGENTS.md`，为我的 Antigravity App 安装或升级 Antigravity Context Monitor。

也可以在终端直接执行零外部依赖的跨平台一行命令（追加 `--version <x.y.z>` 可锁定指定版本）：

- **macOS / Linux（`curl` + `node`）：**
  ```bash
  curl -fsSL https://raw.githubusercontent.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/main/scripts/install-app-plugin.mjs -o /tmp/acm-install.mjs && node /tmp/acm-install.mjs --from-github && rm -f /tmp/acm-install.mjs
  ```
- **Windows（PowerShell `irm` + `node`）：**
  ```powershell
  $f = Join-Path $env:TEMP 'acm-install.mjs'; irm 'https://raw.githubusercontent.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/main/scripts/install-app-plugin.mjs' -OutFile $f; node $f --from-github; Remove-Item $f -Force
  ```
- **跨平台纯 Node 一行命令（macOS / Windows / Linux 通用）：**
  ```bash
  node -e "const fs=require('fs'),os=require('os'),p=require('path'),cp=require('child_process');fetch('https://raw.githubusercontent.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/main/scripts/install-app-plugin.mjs').then(r=>{if(!r.ok)throw new Error(r.status);return r.text()}).then(s=>{const f=p.join(os.tmpdir(),'acm-install.mjs');fs.writeFileSync(f,s);try{cp.execFileSync(process.execPath,[f,'--from-github'],{stdio:'inherit'})}finally{fs.rmSync(f,{force:true})}})"
  ```
- **在本地仓库中执行：** `node scripts/install-app-plugin.mjs --upgrade`（macOS/Linux 可用 `./scripts/install-app-plugin.sh --upgrade`，Windows 可用 `.\scripts\install-app-plugin.ps1 --upgrade`，均自动发现内置 `agy-node` 或 Electron `ELECTRON_RUN_AS_NODE=1`），执行 `node scripts/install-app-plugin.mjs --status --check-remote` 即可复核已安装版本、启用状态与实时 Sidecar 状态。完整安全边界见 [AGENTS.md](AGENTS.md)。

## 1.17.6 核心更新

- **AI 智能体一句话安装 / 升级（`AGENTS.md`）：** 仓库根目录新增中英双语 [AGENTS.md](AGENTS.md) 契约，并全面升级零外部依赖跨平台安装脚本（`install-app-plugin.{mjs,sh,ps1}`），支持 `--from-github`、`--upgrade`、`--install`（优先本地构建，缺失时自动回退 GitHub Releases）、`--status [--check-remote] [--json]`、`--uninstall` 与 `--print-cdp-guide`。下载全链路强制校验 HTTPS GitHub 官方域名白名单（含每一跳重定向与 `443` 端口校验）、失败即中止的 `SHA256SUMS.txt` 校验、防路径穿越/符号链接/CRC-32 校验、原子备份替换与自动回滚，以及不破坏 `~/.gemini/config/config.json` 的安全注册（优先调用 `agy plugin enable`）。
- **面板内自动 / 手动更新检查与一键自更新（`src/app/plugin-updater.ts`）：** 通过条件 ETag（`If-None-Match` / `304`，开启 `autoCheckUpdates` 时每 6 小时最多检查一次，也可在**设置**或**关于**页随时手动触发）检查 GitHub Releases。在 **Antigravity App** 中点击**立即升级**即可自动下载、严格校验 `SHA256SUMS.txt`、安全解压并原子替换已安装插件（异常自动回滚），完成后提示用户安全关闭再重新开启插件，绝不强杀运行中的宿主进程；在 **Antigravity IDE** 中提供更新提示与 **Open VSX 市场**直达入口。
- **原生 Sidecar 精简 HUD + 严格按需开启的 CDP 悬浮层（`src/app/cdp-injector.ts`、`src/app/cdp-overlay-assets.ts`）：**
  - **零 CDP 原生精简 HUD（App 默认开启）：** 固定于 Sidecar 面板顶部的可折叠紧凑状态条，无需任何额外启动参数即可常驻浏览上下文压力、双水位线、最紧缺配额池、生成速度/`短样本`保护与会话费用。
  - **严格按需开启的 CDP 悬浮层（双开关默认均关闭）：** 独立控制**输入框上下文环**（挂载于 `Turbo` / `Auto` / `Ask` / `Plan` 左侧，悬停或钉选展开磨砂玻璃用量卡——单列清晰展示速度、TTFT、缓存命中、美元+本地币种与底部快捷胶囊）与**右上角状态条 + 模型配额看板**（最紧缺配额环、上下文环、速度徽章、累计 Token、Windows WCO 标题栏避让与窄窗口 `···` 溢出折叠）。100% 遵循 Antigravity 使用规范：**零 `app.asar` 或二进制修改**、纯 Node RFC 6455 WebSocket 客户端、严格兼容 Trusted Types CSP 的 **Shadow DOM**（零 `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`eval`）、仅限本地回环鉴权的 `/api/overlay/action` 桥接（常量时间 256-bit `X-Monitor-Token` + 严格回环/Hub `Origin` 校验）、关闭即瞬时卸载对应槽位，并在未开启 CDP 时安静回退至零 CDP 原生 HUD。
- **52 周活动热力图与多源遥测日历（`src/cli-usage-scanner.ts`、`src/webview-calendar-tab.ts`、`src/daily-store.ts`）：**
  - **今日实时合并与相加式总 Token：** 非破坏性合并 `DailyLedger` 今日实时数据，当日用量立即可见且跨午夜日结零重复计数；全部 KPI 卡片与日详情均统一为真实相加式 Token 口径（`input + cacheRead + cacheCreation + output`）。
  - **400 天可调保留期与多源筛选（`全部 / App / IDE / CLI`）：** `DailyStore` 默认保留期由 90 天扩展至 **400 天**（支持 `30–3650` 天配置），并新增零依赖严格只读的 `~/.gemini/antigravity-cli` 扫描器（`CliUsageScanner`，基于 mtime+size LRU 缓存，SQLite `immutable=1` 只读 + JSONL 回退，绝不产生 `-wal`/`-shm` 副文件）。
  - **多周期视图、多币种换算、套餐回本与安全导出：** 支持 **52 周热力图**与**月历网格**切换，提供**按日 / 按周 / 按月 / 本年 / 全部** 5 个周期维度与 **Token / API 估算费用**指标切换；内置 **9 种币种**（`USD`、`CNY`、`EUR`、`JPY`、`KRW`、`GBP`、`AUD`、`HKD`、`TWD` + 自定义汇率）与可选**订阅套餐回本（Plan ROI）**估算（`Google AI Pro`、`Google AI Ultra` 或自定义月费，附清晰非官方账单免责说明）；支持防公式注入的 RFC 4180 **CSV / JSON 导出**及**两步清空历史确认栏**。
- **编排模型基础映射定价与全链路角色归因（`src/orchestrator-attribution.ts`、`src/pricing-store.ts`、`src/telemetry-metrics.ts`）：**
  - **自动读取编排配置与双计价模式：** 结合实时 RPC **编排设置**与只读 `~/.gemini/config/config.json` 回退（`userSettings.{orchestratorModel, orchestratorExecutorModel, useAiCredits}`）。新增**按基础模型映射计价（默认）**——将 `M537` → Gemini 4 Neon、`M667` → Carbon（按 UTC 调价日期）、`M681` → Argon（按 UTC 调价日期）、`M669` → Hydrogen 映射至已核实官方费率——与**严格模式**（仅在配置自定义费率时计价），始终保持自定义覆盖最高优先级且未修改项保存时不产生伪自定义覆盖。
  - **全链路角色归因与遥测诚实守卫：** 在总览与 GM 数据页展示自动隐藏的**编排拆分（Orchestrator Split）**卡片、`编排 / 执行 / 子智能体`角色徽章、`切换冷启动`（`cacheRead === 0`）跨模型切出检测、`短样本`速度保护（杜绝极短输出导致的异常 `tok/s` 尖峰）、双上下文水位线（**自动压缩**上限 + **200k** 长上下文档位）、模型页编排卡片内置每百万 tokens 有效费率，以及交互式术语提示。
- **App ↔ IDE 双向热同步与跨平台加固（`src/durable-state.ts`、`src/discovery.ts`、`src/app/theme-adapter.ts`）：**
  - **并发三方状态同步与加固文件锁：** 通过 `DurableState` 三方合并（`DEEP_MERGE_OBJECT_KEYS`）、死进程 PID 过期锁原子回收、锁持有者令牌校验、超时绝不绕过活跃写入者，以及 `async deactivate()` 等待刷盘完成，实现 `appSettings`、计价模式、币种/回本、保留期、语言与主会话锁在 App 与 IDE 之间的实时双向热同步。
  - **双端打磨与跨平台修复：** 为 App 端补齐**低配额预警横幅**（自动静音 BYOK/`custom-*` 模型）、在 App 中将仅限 IDE 的状态栏开关折叠至 `<details>`、在 `theme-adapter.ts` 覆写宿主 `/preload.js` 内联浅色兜底以守卫深色与高对比度 WCAG 对比度、修复 `320px` 窄侧栏设置页卡片换行、统一中英文核心术语（`账号信息`、`编排模型` / `执行模型`、`锁定主会话`）、实现 WSL 动态挂载点与宿主目录发现（`drvfs`/`9p`/`wslpath`，彻底消除硬编码 `/mnt/c`）、加固 Windows `explorer.exe /select,` 空格与逗号路径转义、扩展 `.sh`/`.ps1` 内置 Node 自动查找，并清理已废弃的 `CHANGELOG-v2.md`。

## 安装

### 方式一 — Antigravity App（桌面版 2.0+ 原生 Sidecar 插件）

支持 **macOS、Windows、Linux**，零外部依赖（直接运行于 Antigravity App 内置 Node 运行时）。

1. **从 GitHub Releases 一键安装 / 升级（推荐）：**
   - 直接运行上方[给 AI 智能体的一句话安装 / 升级（`AGENTS.md`）](#给-ai-智能体的一句话安装--升级agentsmd)中的任意零克隆命令——自动校验 `SHA256SUMS.txt`、安全解压并无损注册到 `config.json`。
   - 或前往 [GitHub Releases](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases) 手动下载 `antigravity-context-monitor-app-1.17.6.zip`（macOS / Windows / Linux）、`antigravity-context-monitor-app-1.17.6.tar.gz`（macOS / Linux）与 `SHA256SUMS.txt`，解压得到 `antigravity-context-monitor/` 后执行：
     ```bash
     agy plugin install ./antigravity-context-monitor
     ```
     *（也可直接解压至 macOS/Linux 的 `~/.gemini/config/plugins/` 或 Windows 的 `%USERPROFILE%\.gemini\config\plugins\`。）*
2. **从本地源码仓库安装 / 升级：**
   - 直接升级至最新 GitHub Release（无需本地编译）：`node scripts/install-app-plugin.mjs --upgrade`（macOS/Linux：`./scripts/install-app-plugin.sh --upgrade`；Windows：`.\scripts\install-app-plugin.ps1 --upgrade`）。
   - 从当前本地源码构建并安装：
     ```bash
     npm ci && npm run compile && node scripts/package-app-plugin.mjs && node scripts/install-app-plugin.mjs --install
     ```
   - 核验安装状态、远端版本与 Sidecar 状态：`node scripts/install-app-plugin.mjs --status --check-remote`（附加 `--json` 输出结构化结果，`--uninstall` 卸载，`--print-cdp-guide` 查看可选 CDP 启动指南）。
3. **在 Antigravity App 中启用并打开：**
   - 打开 **Customizations → Installed**（`customization://antigravity-context-monitor`），确认 **Antigravity Context Monitor** 及其 **Context Monitor** Sidecar 已启用。*（覆盖升级运行中的 Sidecar 后，请手动关闭再重新开启插件以安全加载新运行时，切勿在对话中强杀 Antigravity 进程。）*
   - 通过侧边栏 **`+`** 菜单（`AUX_PANE`）、左侧导航 **Plugins → Context Monitor**（`SIDEBAR`）或 `sidecar://antigravity-context-monitor/context_monitor/` 打开面板。
   - 后续 App 插件更新可直接在面板的**设置**或**关于**页一键检查并安全自更新。

### 方式二 — Antigravity IDE（VSIX 扩展）

1. 从 [GitHub Releases](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases) 下载 `antigravity-context-monitor-1.17.6.vsix`（并对照 `SHA256SUMS.txt` 校验），或运行 `npm run compile && npm run package` 在本地打包。
2. 在 Antigravity IDE 命令面板（macOS：`Cmd+Shift+P`，Windows / Linux：`Ctrl+Shift+P`）执行 **Extensions: Install from VSIX...** 选择该文件，或命令行执行：
   ```bash
   antigravity-ide --install-extension antigravity-context-monitor-1.17.6.vsix --force
   ```
3. 重载 IDE 窗口，在扩展详情或监控器的**关于**页确认版本为 **1.17.6**。

IDE 扩展也可以通过 [Open VSX](https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor) 安装并自动获取更新。

双端插件均支持 **macOS、Windows、Linux**（IDE 另支持 **WSL**）。1.17.6 原生实机验收在 macOS 完成，Windows 与 Linux 平台分支由自动化单元与模拟回归测试覆盖，详见发布说明。[验证](docs/releases/1.17.6.md#验证)

## 使用监控器

- **在 Antigravity App 中：** 在对话旁打开紧凑 **`AUX_PANE`** 或从左侧栏打开全宽 **`SIDEBAR`** 仪表盘。默认在面板顶部展示可折叠的**原生精简 HUD**（零 CDP 依赖），如需在对话输入框旁和窗口顶部叠加极简浮层，可在**设置 → 悬浮层与 CDP** 按需分别开启**输入框上下文环**（`Turbo` 左侧）与**右上角状态条**（运行 `--print-cdp-guide` 获取零魔改启动参数）。通过顶部上下文控制条切换或固定会话、在多智能体并发时启用**锁定主会话**、一键切换**条形视图 ↔ 20×5 点阵视图**、展开 **Top 5 最大占用项**，或一键**复制 `/context` 报告**与**复制交接提示词**。
- **在 Antigravity IDE 中悬停右下角状态栏监控项：** 查看当前会话与模型（或跨池 **编排 `规划 → 执行`** 路由）、上下文进度条与已用/剩余 tokens、**最近一次调用**明细、**会话与今日费用**（含缓存节省与等效混合输入单价）、**编排拆分**、带规划/执行角色标注的**双窗口（`5h` + `周`）共享配额**、事件驱动提醒，以及一键直达**总览**、**活动**、**费用**、**模型**、**设置**与**刷新**的快捷链接。
- **点击状态栏监控项（IDE）或打开监控面板（App）：** 浏览完整 9 个功能页。设置项、编排计价模式、币种、保留期与语言偏好均经共享 `state-v1.json` 在 App 与 IDE 之间双向热同步。

## 监控页面

面板在 `320px` 窄侧边栏（`AUX_PANE` / 窄分屏）至 `1440px` 宽仪表盘（`SIDEBAR` / 宽编辑区）之间自适应排版，自动跟随浅色、深色与高对比度（`hc` 与 `hc-light`）主题，并通过 **WCAG 2.1 AA 零违规**验证（App Sidecar 432/432 布局单元、332/332 axe-core 审计及已安装 IDE 742/742 项全通过）。下方截图展示双语模式下的 **Obsidian Slate 深色**主题。

### 总览

查看顶部可折叠**原生精简 HUD**、**顶部上下文控制条**（会话切换器、锁定主会话、运行端与缓存保底徽章）、App 端**低配额预警横幅**、带**双上下文水位线**（`自动压缩` + `200k` 档位）的活跃会话主卡片、活跃**编排 `规划 → 执行`**跨池路由标签与自动隐藏的**编排拆分**卡片、**上下文构成**卡片（条形 ↔ 20×5 点阵视图、双上限有效预算 vs 原生上限、测量状态徽章、压缩节省量、可折叠 Top 5 最大占用项及复制 `/context` 报告 / 交接提示词按钮）、内嵌 L2 遥测条（含`短样本`速度保护与术语悬浮提示）、可折叠会话诊断、带**配额续航预测**徽章（或 `custom-*` 自定义模型隔离提示）的**双窗口（`5h` + `周`）**共享配额池，以及底部 AI 积分摘要。

![Obsidian Slate 深色主题下的双语总览页，展示活跃上下文、编排路由标签、L2 速度/TTFT/缓存/费用遥测条、双窗口共享配额池与 AI 积分](src/images/monitor-overview.png)

<details>
<summary>GM 数据 — 速度、TTFT、逐轮缓存诊断、编排拆分、最近调用明细与时间线</summary>

按模型和会话实时分析 Generator Metadata，包含按账号过滤的顶部 KPI 概览、双列**生成速度与首字缓存账本**（加权/最新/中位/可见 `tok/s`、**缓存 vs 非缓存 TTFT** 对比条、3 段式提示词缓存进度条，以及**最近一轮 vs 会话累计缓存命中率**对比与**冷启动 / 部分命中 / 热缓存**状态徽章）、自动隐藏的**编排拆分**卡片、可折叠**最近调用明细**（含`编排 / 执行 / 子智能体`角色徽章、`切换冷启动`标签、`短样本`速度保护、`+Δ` 上下文净增长与压缩骤降标识、费用/映射/未定价、首字耗时、总耗时与状态）、统一逐模型统计卡片、时间线遥测标签、当日账本、工具调用排行、上下文增长趋势及错误详情。

![Obsidian Slate 深色主题下的双语 GM 数据页，展示 KPI 概览、生成速度与首字缓存账本、最近调用明细与模型统计](src/images/monitor-gm-data.png)

</details>

<details>
<summary>会话 — 可搜索的对话记录</summary>

按工作区分组浏览会话上下文与历史记录，支持按当前工作区、仓库、运行状态或可备份状态筛选，并一键定位本地工作区、Brain 记录目录或 `.pb` 原始文件（全面加固 Windows `explorer.exe /select,` 空格/逗号路径转义与 macOS/Linux 打开逻辑）。

![Obsidian Slate 深色主题下的双语会话页，展示工作区分组、搜索与本地化状态标签](src/images/monitor-sessions.png)

</details>

<details>
<summary>成本 — 编排基础映射 vs 严格计价、多币种估算、官方调价提醒与自定义 API 费率</summary>

支持一键切换编排模型的**按基础模型映射（默认）**与**严格模式**，同时保持每百万 tokens 自定义费率最高优先级；按美元或所选显示币种查看月度与当日费用估算、汇总与逐模型缓存节省、思考费用占比、四分项成本分布堆叠条（输入 / 输出 / 缓存 / 思考），以及**官方定时调价提醒**横幅（Carbon/Argon `2026-12-01`、Flash `2027-01-01`）。

![Obsidian Slate 深色主题下的双语成本页，展示编排计价切换、调价提醒横幅、月度汇总、四分项分布图与自定义定价表](src/images/monitor-cost.png)

</details>

<details>
<summary>模型 — 带有效费率的编排设置、双窗口配额池、续航预测与模型参数</summary>

查看实时**编排设置**（`编排模型` + `执行模型`，融合 RPC 与 `~/.gemini/config/config.json` 回退、默认/自定义状态、每百万 tokens 有效参考费率与跨池角色标记）、当前默认模型、合并后的 Gemini 与 Claude / GPT **双窗口（`5h` + `周`）**共享配额池及**消耗速率续航**徽章、重置计划、可用模型家族与思考档位（`低` / `中` / `高` / `超高`）、规格卡片内置 API 参考价格、`Notice` 下线标签（如 GPT-OSS 120B），以及后端上报的详细模型参数。聊天目录与图片生成目录独立展示。

![Obsidian Slate 深色主题下的双语模型页，展示编排设置、双窗口共享配额池、API 参考价格与 512K Gemini 4 规格](src/images/monitor-models.png)

</details>

<details>
<summary>日历 — 52 周活动热力图、实时今日合并、多源（App/IDE/CLI）、多币种、套餐回本与导出</summary>

支持长达 **400 天**（可调 `30–3650` 天）的多源用量追溯（`全部 / App / IDE / CLI`），实时合并当日账本并采用相加式总 Token 口径。自由切换 **52 周热力图**与**月历网格**、**按日 / 按周 / 按月 / 本年 / 全部** 5 个周期及 **Token / API 费用**指标，查看连续活跃天数、双币种总额、可选**订阅套餐回本（Plan ROI）**、可展开日详情抽屉（Token 构成、模型占比条、来源标签、归档速度/TTFT/缓存与周期归档）、一键 **CSV / JSON 导出**及**两步清空历史**安全确认。

![Obsidian Slate 深色主题下的双语日历页，展示 52 周活动热力图、多源筛选、实时今日 KPI 与每日明细](src/images/monitor-calendar.png)

</details>

<details>
<summary>账号信息 — 计划、双窗口共享配额、AI 积分与账号设置</summary>

查看当前账号身份（默认开启隐私遮罩，可一键切换）、当前订阅计划、**双窗口（`5h` + `周`）**模型共享配额池、琥珀色下线模型 `Notice` 提醒标签、Google AI 积分（缺失时标注**未上报**）、按账号配置的每月积分到期日，以及可折叠的计划限制、功能开关与团队配置。

![Obsidian Slate 深色主题下的双语账号信息页，展示隐私遮罩账号、双窗口共享配额与 AI 积分](src/images/monitor-profile.png)

</details>

<details>
<summary>设置 — 悬浮层与 CDP、更新检查、成本/币种/历史、持久化存储与双端适配</summary>

统一配置**悬浮层与 CDP**（原生精简 HUD 开关，以及默认关闭的输入框上下文环与右上角状态条独立开关、CDP 实时状态与平台启动指南）、**更新**（6 小时自动检查开关、立即检查与 App 端一键立即升级）、**成本、币种与历史**（编排计价模式、9 种显示币种 + 自定义汇率、订阅套餐回本预设与日历保留天数）、共享外部持久化存储（`state-v1.json`，App ↔ IDE 原子锁热同步）、低配额提醒阈值、轮询间隔、IDE 状态栏开关（在 Antigravity App 中自动折叠于 `<details>`）、悬停摘要密度、内部模型 ID 显示、界面缩放比例，以及滚动条和页底提示偏好。

![Obsidian Slate 深色主题下的双语设置页，展示悬浮层与 CDP、更新、成本币种与历史、状态栏开关及持久化存储](src/images/monitor-settings.png)

</details>

<details>
<summary>关于 — 版本与更新卡片、AGENTS.md 一句话提示、双端兼容性与功能导航</summary>

查看实时**版本与更新**卡片（`v1.17.6`、上次检查时间、**检查更新**、App 端**立即升级**或 IDE 端 **Open VSX 市场**）、复制 **AGENTS.md** AI 智能体一句话安装/升级提示词、核对双端官方支持标识（**Antigravity IDE** + **Antigravity App（桌面版 2.0+ Sidecar）**），通过功能导航卡片直达各页面，并查阅社区致谢与兼容性记录。

![Obsidian Slate 深色主题下的双语关于页，展示版本与更新卡片、AGENTS.md 提示与功能导航卡片](src/images/monitor-about.png)

</details>

## 模型、上下文与计价

- 可用模型以当前登录账号的实时目录为准。状态栏悬停摘要与**总览**按基础模型家族合并统计已核实的思考档位；**模型**规格、**GM 数据**与**成本**账本保留每个档位的独立 ID。
- **Orchestrator 与 Gemini 4 家族：** 全部 **Gemini 4** 家族（**Neon**、**Hydrogen**、**Carbon**、**Argon**）与 **Orchestrator** 模型（`M537`、`M667`、`M681`、`M669`）均采用统一的 **512,000 tokens** 实时检查点上限（模型上下文 `1,048,576`、最大输出 `262,144`）。**Gemini 4 Neon** 与 **Gemini 4 Hydrogen** 均提供 `低` / `中` / `高` / `超高` 四档思考力度。在**自定义编排模式**下，任意合格编排模型（含 **Claude Opus 5.5** 与 **Gemini 4 Neon**）均可与任意合格执行模型（如 **Gemini 4 Hydrogen** 或 **Claude Sonnet 5.5**）自由组合，各阶段按实际调用模型独立计价并跨配额池追踪。
- **编排模型基础映射定价（v1.17.6）：** 默认启用**按基础模型映射计价（`mapped`）**，将旧版编排器与执行模型 ID 自动映射到对应 Gemini 4 基础模型的官方费率（严格遵守 Carbon/Argon 的 UTC 调价日期），同时始终保留用户自定义费率最高优先级；也可随时在**成本**或**设置**页切换为**严格模式（`strict`）**，无自定义费率时保持未定价。
- **内置官方 API 等价参考费率（美元 / 百万 tokens，2026-11-22 核实）：**

| 模型家族 | 输入 | 输出 / 思考 | 缓存读取 | 缓存写入 | 说明 / 调价排期 |
| --- | ---: | ---: | ---: | ---: | --- |
| **Gemini 4 Neon**（低–超高） | `$3.00` | `$15.00` | `$0.15` | `$0` | 全 1M 上下文统一费率；隐式缓存读取 |
| **Gemini 4 Hydrogen**（低–超高、`M530`/`M531`） | `$1.50` | `$7.50` | `$0.075` | `$0` | 全 1M 上下文统一费率；`M578` Sonar 未定价 |
| **Gemini 4 Carbon / Argon** | `$2.00` → `$4.00` | `$10.00` → `$20.00` | `$0.10` → `$0.20` | `$0` | 优惠价将于 `2026-12-01` UTC 结束（`2×` 标准价） |
| **Claude Opus 5.5**（低–高） | `$4.00` | `$20.00` | `$0.20` | `$5.00` | 5 分钟 TTL 缓存写入费率 |
| **Claude Sonnet 5.5**（低–高） | `$2.00` | `$10.00` | `$0.10` | `$2.50` | 已修正缓存读取费率（`$0.10`）；5 分钟 TTL 写入 |
| **Gemini 3.8 / 3.7 / 3.6 Flash** | `$0.75` → `$1.50` | `$3.75` → `$7.50` | `$0.075` → `$0.15` | `$0.9375` → `$1.875` | 优惠价将于 `2027-01-01` UTC 结束（3.6 区间自 `2026-08-13` 起） |
| **GPT-OSS 120B (Medium)** | `$0.09` | `$0.36` | `$0` | `$0` | 当后端上报下线通知时显示 `Notice` 标签 |
| **编排模型**（`M537` / `M667` / `M681` / `M669`） | 基础映射 | 基础映射 | 基础映射 | `$0` | 默认映射到 Neon / Carbon（按日）/ Argon（按日）/ Hydrogen；`严格模式`下未自定义时标为未定价 |
| **Sonar 与图片模型**（`M578` / `M21`） | 未定价 | 未定价 | 未定价 | 未定价 | 绝不伪造 `$0.00`；可在**成本**页设置自定义价格 |

- 上下文读数优先采用当前 planner 响应或 checkpoint 中模型提供商报告的新输入、缓存读取、缓存创建与输出。缺少时间戳的历史定时调价模型调用会诚实保留为未定价，不以当前日期伪造费率。订阅 AI 积分独立展示（缺失时显示**未上报**而非 `0`）。[模型与计价说明](docs/technical_implementation.md)

## 命令与设置

### Antigravity IDE 命令与设置

| 命令 | 用途 |
| --- | --- |
| **Show Context Window Details** | 打开总览（同时支持悬停快捷直达 `gmdata`、`pricing`、`models`、`settings`） |
| **Refresh Context Window Monitor** | 重新连接后端并重启轮询 |
| **Switch Display Language** | 选择英文、中文或双语显示 |
| **Show Model Activity** | 打开 GM 数据 |

IDE 设置项使用 `antigravityContextMonitor.` 前缀（共 22 项；共享偏好通过 `state-v1.json` 与 Antigravity App 双向热同步）：

| 设置项 | 默认值 | 用途 |
| --- | --- | --- |
| `pollingInterval` | `5` | 设置轮询间隔，单位为秒 |
| `statusBar.showContext` | `true` | 在状态栏显示上下文用量 |
| `statusBar.showQuota` | `true` | 显示当前模型的剩余配额百分比 |
| `statusBar.showResetCountdown` | `true` | 显示当前模型的配额重置倒计时 |
| `statusBar.showAiCredits` | `true` | 在状态栏显示 AI 积分余额（未上报时隐藏） |
| `statusBar.showSpeed` | `false` | 在状态栏显示最新或加权平均模型生成速度（`tok/s`） |
| `statusBar.showCacheHit` | `false` | 在状态栏显示按 token 加权的提示词缓存命中率（`%`） |
| `statusBar.showSessionCost` | `false` | 在状态栏显示当前会话估算的 API 等价费用 |
| `statusBar.tooltipDensity` | `auto` | 选择 `auto`（自动）、`compact`（精简）或 `full`（完整）悬停摘要密度 |
| `quotaNotificationThreshold` | `20` | 低于该配额百分比时提醒（IDE 通知与 App 总览预警横幅），设为 `0` 可禁用 |
| `showModelInternalId` | `false` | 在模型名旁显示内部 ID |
| `activity.maxRecentSteps` | `100` | 限制持久化保留的近期活动时间线条数（`10–500`） |
| `activity.maxArchives` | `20` | 限制保留的活动归档数量（`1–100`） |
| `orchestratorPricingMode` | `mapped` | 编排模型计费模式：`mapped`（映射基础 Gemini 4 费率）或 `strict`（仅自定义费率） |
| `displayCurrency` | `USD` | 成本与日历页的显示币种（`USD`、`CNY`、`EUR`、`JPY`、`GBP`、`KRW`、`HKD`、`TWD`、`AUD`） |
| `customFxRate` | `null` | 可选自定义汇率（1 USD 对应目标币种，`null` 使用内置参考汇率） |
| `subscriptionPlan` | `none` | 可选日历套餐回本预设（`none`、`google-ai-pro`、`google-ai-ultra`、`custom`） |
| `subscriptionMonthlyFee` | `null` | 可选月订阅费用金额，用于回本计算 |
| `subscriptionCurrency` | `USD` | 月订阅费用使用的币种 |
| `calendarRetentionDays` | `400` | 日历用量历史最长保留天数（`30–3650`） |
| `autoCheckUpdates` | `true` | 后台自动检查 GitHub Releases 更新（6 小时 ETag 节流） |
| `showNativeHudBar` | `false`（App 默认 `true`） | 在监控面板顶部显示可折叠的原生精简 HUD 状态条 |

### Antigravity App Sidecar 视图与接口

| 入口 / 路径 | 用途 |
| --- | --- |
| `AUX_PANE`（`/`） | 紧凑侧边栏视图，从侧边面板 `+` 菜单或 `sidecar://antigravity-context-monitor/context_monitor/` 打开 |
| `SIDEBAR`（`/full`） | 全宽仪表盘视图，从左侧栏 **Plugins → Context Monitor** 打开 |
| `/api/health`、`/api/snapshot`、`/api/action` | 本地回环健康检查、可见性门控 ETag 快照接口与交互动作分发（含更新检查/自更新、日历筛选与导出、编排计价模式、币种/回本与 App↔IDE 热同步 `appSettings`） |
| `POST /api/overlay/action` | 面向按需开启 CDP Shadow DOM 悬浮层的本地回环鉴权桥接接口——强制常量时间 256-bit `X-Monitor-Token` 校验、严格回环/Hub `Origin` 校验、`16 KB` 请求体上限及命令白名单（`ping`、`refresh`、`openSidecar`、`togglePanel`、`openPanel`、`togglePause`） |

## 排障与限制

- **无活跃会话**表示后端已连接，当前视图尚无已加载对话。打开任意对话（或在顶部会话切换器中指定会话）即可读取上下文。
- **同时运行 Antigravity App 与 Antigravity IDE：** 双端自动按运行端隔离各自的本地后端（`preferredSurface: 'app'` 与 `'ide'`）零串扰，并通过加固后的原子 `O_CREAT | O_EXCL` 文件锁（死进程 PID 过期回收 + 持有者令牌校验）与三方合并安全热同步 `state-v1.json` 历史记录与设置。
- **升级 Antigravity App 插件：** 在面板内点击**立即升级**或命令行执行 `--upgrade` 后，请在 **Customizations → Installed**（`customization://antigravity-context-monitor`）中将插件**关闭再重新开启**，或在方便时由您自行重启 Antigravity App——绝不可在活跃对话期间强杀运行中的宿主进程。
- **可选 CDP 悬浮层显示 `CDP 不可用`：** 核心 Sidecar `AUX_PANE`、`SIDEBAR` 与原生精简 HUD 均 100% 原生工作，不依赖 CDP。如需启用输入框上下文环或右上角状态条，请运行 `node scripts/install-app-plugin.mjs --print-cdp-guide`（或查看**设置 → 悬浮层与 CDP** 中的平台指引）以启动参数 `--remote-debugging-port` 启动 Antigravity App，无需修改任何二进制文件。
- **后端连接已断开**或 **LS not found** 指向本地发现或连接异常。安装后请重载窗口，在 IDE 中打开**输出 → Antigravity Context Monitor** 检查 `PATH check:`。发现机制支持 `ANTIGRAVITY_LS_ADDRESS`、`agy --hub`（含 v1.5.14+ 的 `GetStatus` 与 `daemon/hub_<port>.json`）、旧版语言服务器、Linux `/proc/<pid>` 套接字兜底以及 WSL 动态挂载与宿主目录解析（`drvfs` / `9p` / `wslpath`）。[后端发现](docs/technical_implementation.md)
- 超长或经过内部摘要处理的会话可能存在部分遥测缺失，监控器会明确标注压缩后/回退估算值、`短样本`速度保护与缺失步骤。[上下文与 Token 计算](docs/technical_implementation.md) · [Checkpoint 摘要社区讨论](https://www.reddit.com/r/google_antigravity/comments/1q7zcag/heres_how_to_find_which_mcp_tools_are_leading_to/)

## 致谢

由 **AGI-is-going-to-arrive** 维护。感谢 **SecretLUL** 报告 Windows 后端发现问题（[Issue #64](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/issues/64)），并感谢 **@AxelDZP** 提出次要端口 TLS 优先探测、`GetUserStatus` 结构校验与等价 proto3 纪元零值 `resetTime` 修复（[PR #74](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/74)）。

衷心感谢以下 Antigravity 开源社区项目在交互设计与工程实践上的启发，为 **v1.17.5–v1.17.6** 的体验与架构升级提供了宝贵参考（本项目的实现完全基于自有 TypeScript 核心与官方 Sidecar / VSIX 接口从零独立编写，未修改 `app.asar`，亦未复制任何外部代码）：

- [`dimitr-io/antigravity-desktop-context`](https://github.com/dimitr-io/antigravity-desktop-context) — Antigravity App Sidecar `AUX_PANE` 工作流、20×5 点阵上下文可视化、双上限清晰标注及 CLI 风格 `/context` 纯文本导出。
- [`elviscjn-cjn/antigravity-context-viewer`](https://github.com/elviscjn-cjn/antigravity-context-viewer) — 桌面端遥测交互探索、轮次与缓存可视化思路，以及 Antigravity v2.33+/v2.34+ 社区稳定性实践经验。
- [`yuhuan-dev/antigravity-usage-monitor`](https://github.com/yuhuan-dev/antigravity-usage-monitor) — 零依赖 Sidecar 架构、Linux `/proc` 端口发现兜底方案，以及防范后台子智能体抢占的「锁定主会话（Lock to Main Agent）」保护机制。
- [`ahmetdotsh/agy-context`](https://github.com/ahmetdotsh/agy-context) 与 [`ahmetdotsh/agy-usage`](https://github.com/ahmetdotsh/agy-usage) — 分段条形图 ↔ 点阵视图切换、有效预算与原生上限对照展示、最近一轮与会话累计缓存命中率区分，以及 ETag `unchanged` 增量短路优化。
- [`arthurcavallari/antigravity-context-monitor`](https://github.com/arthurcavallari/antigravity-context-monitor) 与 [`arthurcavallari/antigravity-sidecar-kit`](https://github.com/arthurcavallari/antigravity-sidecar-kit) — 压缩检查点与最大占用项（Largest Items）上下文排查、`custom-*` 自定义模型配额隔离，以及跨平台无 BOM 安装实践。
- [`Lumidarin/agy-capsule`](https://github.com/Lumidarin/agy-capsule) — 为紧凑桌面端上下文胶囊与输入框旁悬浮环交互体验提供设计灵感。
- [`evenluo/agy-pulse`](https://github.com/evenluo/agy-pulse) — 为多周期活动脉搏热力图与用量统计看板提供设计灵感。
- [`jule-x/antigravity-context-monitor`](https://github.com/jule-x/antigravity-context-monitor) — 逐轮冷启动 / 部分命中 / 热缓存（Cold / Partial / Warm）提示词缓存分类与 `+Δ` 上下文净增长诊断。
- [`bocai991/antigravity-quota-meter`](https://github.com/bocai991/antigravity-quota-meter) — `AUX_PANE` + `SIDEBAR` 双入口 Sidecar 挂载与滚动窗口配额消耗速率及续航预测。
- [`vladsboev-web/chat_tokens`](https://github.com/vladsboev-web/chat_tokens) — 一键复制 `HANDOFF.md` 续接提示词与近期会话切换思路。
- [`benedictusrey/Antigravity-Monitor`](https://github.com/benedictusrey/Antigravity-Monitor) — 明确区分「实测（Measured）」与「估算（Estimated）」状态徽章，以及将「回退（Rewind）」与「压缩（Compaction）」区分呈现的设计。

[MIT 许可证](LICENSE) · [LINUX DO](https://linux.do/) · [Star 趋势](https://www.star-history.com/#AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor&type=date&legend=top-left)

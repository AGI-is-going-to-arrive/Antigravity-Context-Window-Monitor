# Antigravity 上下文窗口监控

面向 **Antigravity App**（桌面版 2.0+ 原生侧边插件 Sidecar）、**Antigravity IDE**（VSIX 扩展）与可选只读 **`agy` CLI**（`statusLine`）的实时本地只读遥测仪表盘：覆盖上下文窗口构成与双上限、提示词缓存与 5 分钟 TTL 启发式、模型调用解码/E2E 速度、多智能体（Swarm / 子智能体）独立跟踪、10 币种 API 等效参考费用及 `5h` + `7d` 双窗口模型配额续航预测。

[English](README.md) · [AI 智能体一键安装（`AGENTS.md`）](AGENTS.md) · [v1.18.0 发布说明](docs/releases/1.18.0.md#中文) · [架构设计](docs/architecture.md) · [遥测与计价](docs/telemetry-and-pricing.md) · [可选 CDP 悬浮层](docs/cdp-overlays.md) · [变更日志](CHANGELOG.md)

![概览中的会话上下文、5 小时与每周配额、速度、缓存和费用](docs/images/zh/hero-overview.webp)

## 能力矩阵

| 能力维度 | Antigravity App（侧边插件 Sidecar） | Antigravity IDE（VSIX 扩展） | `agy` CLI（`statusLine`） |
| --- | :---: | :---: | :---: |
| **宿主形态** | `AUX_PANE`（`/`）+ `SIDEBAR`（`/full`）+ `SKILL.md` | 状态栏 + 悬停摘要 + Webview 面板 | 可选只读 stdin 管道（`agy-statusline.mjs`） |
| **6 主标签页 + 顶栏 `ⓘ`** | 完整支持（`320px–1440px` 零横向滚动 + 首次引导） | 完整支持（4 主题、Nonce IPC、安全快捷键） | 单行终端摘要（兼容 `NO_COLOR`） |
| **统一不可变观测与三字段根锁定** | 概览 / 原生 HUD / CDP 全端同源一致 | 面板与状态栏同源一致 | 共享上下文与 10 币种契约 |
| **Swarm / 子智能体实时跟踪** | 支持 20+ 成员公平轮转与一键查看/返回 | 只读拓扑树与直属/整组费用分列 | 显示活跃子智能体数（`sub:N`） |
| **原生 HUD / 可选 CDP 悬浮层** | 原生 HUD（默认开）+ 可选 CDP（默认关） | 原生 HUD（默认关）+ 状态栏 | 单行安全清洗输出 |
| **全局规则与双向热同步** | `~/.gemini/GEMINI.md` 编辑器 + `state-v1.json` | `~/.gemini/GEMINI.md` 编辑器 + `state-v1.json` | 「用量与费用」只读汇总本地 CLI 日志 |
| **运行时依赖 / 宿主修改** | 零外部 npm 依赖 / 零 `app.asar` 修改 | 零外部 npm 依赖 / 标准 VSIX API | 零外部 npm 依赖 / 纯只读 stdin |

## 三步安装与升级

### 1. Antigravity App（原生侧边插件 — macOS / Windows / Linux）

将下面这一句话发送给任意 AI 编程助手（Antigravity、Claude Code、Codex），或直接运行零克隆安装命令（强制 HTTPS 域名白名单与 fail-closed `SHA256SUMS.txt` 校验）：

> 请阅读 `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor` 中的 `AGENTS.md`，为我的 Antigravity App 安装或升级 Antigravity Context Monitor。

```bash
# macOS / Linux（curl + node）
curl -fsSL https://raw.githubusercontent.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/main/scripts/install-app-plugin.mjs -o /tmp/acm-install.mjs && node /tmp/acm-install.mjs --from-github && rm -f /tmp/acm-install.mjs
```

```powershell
# Windows PowerShell（irm + node）
$f = Join-Path $env:TEMP 'acm-install.mjs'; irm 'https://raw.githubusercontent.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/main/scripts/install-app-plugin.mjs' -OutFile $f; node $f --from-github; Remove-Item $f -Force
```

在 **Customizations → Installed**（`customization://antigravity-context-monitor`）中启用 **Antigravity Context Monitor**，随后通过侧边栏 **`+`** 菜单（`AUX_PANE`）或左侧 **Plugins → Context Monitor**（`SIDEBAR`）打开。覆盖升级运行中的 Sidecar 时，请手动**关闭再重新开启**插件——绝不强杀正在运行的 Antigravity 进程。本地显式安装（`--local-dir` / `--no-remote-fallback`）与状态核验（`--status --check-remote`）详见 [AGENTS.md](AGENTS.md)。

### 2. Antigravity IDE（VSIX 扩展 — macOS / Windows / Linux / WSL）

通过 [Open VSX](https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor) 安装，或从 [GitHub Releases](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases) 下载 `antigravity-context-monitor-<version>.vsix` 与 `SHA256SUMS.txt` 后执行：

```bash
antigravity-ide --install-extension antigravity-context-monitor-<version>.vsix --force
```

在 IDE 内执行 **Developer: Reload Window** 安全重载。使用 `Cmd+Alt+M`（macOS）/ `Ctrl+Alt+M`（Windows/Linux）打开面板，`Cmd+Alt+Shift+R` / `Ctrl+Alt+Shift+R` 刷新连接。

### 3. 按需开启的可选增强（零二进制修改）

- **持久化 CDP 悬浮层（App 端，默认关闭）：** 核心侧边面板与原生 HUD 完全无需 CDP。App 首次打开概览页会展示可关闭的**悬浮层与 CDP 引导**横幅，且 App 端**设置 → 悬浮层与 CDP** 提供**一键生成持久化启动器**（或运行 `node scripts/install-app-plugin.mjs --setup-cdp-launcher`），详见 [docs/cdp-overlays.md](docs/cdp-overlays.md)。
- **可选只读 `agy` CLI `statusLine`：** 在 `~/.gemini/antigravity-cli/settings.json` 中指向 `~/.gemini/config/plugins/antigravity-context-monitor/bin/agy-statusline.mjs`，详见 [docs/telemetry-and-pricing.md](docs/telemetry-and-pricing.md)。

## v1.18.0 精选亮点

- **查看子成员。** 在概览或会话展开**成员详情**，先看成员最近上报的状态和已有读数。点**在概览中查看**会直接读取该成员，点**返回主会话**可回到根会话。即使宿主会话列表省略了某个成员，App 和 IDE 也能列出本地成员清单中已有的记录。
- **核对整组费用。** 用量与费用会列出有调用记录的成员数。每次已记录的调用在组内只计一次。没有调用记录的子成员显示暂无估算。当前组的会话历史和所选时段的账本分别标明来源。
- **查模型参数和配额。** 在模型与配额中展开**模型信息**，再点模型名称，可查看上限与参考价格，也可同时打开多个模型对照。选择**按剩余较少的窗口**后，插件比较 5 小时和每周窗口，直接显示例如**每周配额剩余 71%**。
- **找更新和积分设置。** 打开设置，首项即为**版本与更新**，关于页也可直达。在概览点**设置积分到期日**，会打开模型与配额并定位到当前账号的每月到期日输入框。

本版还支持主会话锁定、解码与端到端速度、周配额预测、加元显示、交接与恢复摘要，以及 Markdown、CSV、JSON 导出。

两端的全局规则编辑器采用了 @gitstq 贡献的实现。@GHTGXL 报告了 Windows 超大对话循环崩溃和更新时目录被占用的问题。[PR #78](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/78) · [Issue #79](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/issues/79)

## 界面实景（v1.18.0）

| 成员详情与已记录的整组费用 | 版本与更新、悬浮层与 CDP、全局规则 |
| :---: | :---: |
| ![成员详情与已记录的整组费用](docs/images/zh/overview-swarm.webp) | ![版本与更新、悬浮层与 CDP、全局规则](docs/images/zh/settings-global-rules.webp) |

| 输出速度、首字延迟与最近调用 | 工作区用量与有调用记录的成员 |
| :---: | :---: |
| ![输出速度、首字延迟与最近调用](docs/images/zh/model-calls.webp) | ![工作区用量与有调用记录的成员](docs/images/zh/usage-cost.webp) |

| 周配额预测与可展开的模型规格 | 输入框上下文圆环与顶栏配额浮层 |
| :---: | :---: |
| ![周配额预测与可展开的模型规格](docs/images/zh/models-quotas.webp) | ![输入框上下文圆环与顶栏配额浮层](docs/images/zh/cdp-overlays.webp) |

| IDE 浅色主题下的「关于」提示 | 会话页在窄栏和宽屏下的成员详情 |
| :---: | :---: |
| ![IDE 浅色主题下的「关于」提示](docs/images/zh/ide-light.webp) | ![会话页在窄栏和宽屏下的成员详情](docs/images/zh/aux-pane-sessions.webp) |

## 阈值速查与常见排错

| 指标 / 现象 | 阈值或行为说明 | 快速排查建议 |
| --- | --- | --- |
| **上下文压力** | 正常 `<65%` · 偏高 `65%–79%` · 高压 `>=80%` · 溢出 `>100%` | 使用**交接指令 v2** 或 `/compact`；`200k` 刻度仅为标准 API 参考线，非订阅额外扣费 |
| **提示词缓存 / 5m TTL** | 实测：热缓存 `>=70%` · 部分 `10%–69%` · 冷启动 `<10%`；TTL 预警 `>=180s`、过期 `>=300s` | 本地 TTL 属空闲计时启发式；结合模型切换、空闲间隔或压缩排查可能未命中原因 |
| **模型配额池** | 充裕 `>=50%` · 偏低 `20%–49%` · 紧张 `<20%`（默认预警阈值 `20%`） | 可切换 `5h`/`7d`/**按剩余较少的窗口** 与 `剩余`/`已用`；周活跃预测需跨 `>=2` 天且累计 `>=2` 活跃小时 |
| **升级后提示 `reloadRequired`** | 磁盘已安装版本/buildId 与运行中 Sidecar 不同 | 打开 `customization://antigravity-context-monitor` 将插件**关闭再重新开启**（严禁强杀宿主） |
| **`CDP 未就绪` / `host_missing_flag`** | 已开启可选 CDP 悬浮层但宿主未带 `--remote-debugging-port` | 在**设置 → 悬浮层与 CDP** 一键生成持久化启动器，完全退出宿主（macOS `Cmd+Q` 后等约 5 秒）重启并点击「重新检测」 |
| **超大对话 / `未归属`** | `>50 MB` 或 `>1,200` 步超长对话，或 v1.18 前缺少工作区归属记录 | 自动触发有界尾部二分恢复（零 OOM）；历史无法归属调用诚实归入**未归属** |

## 架构与技术合规边界

| 维度 | 客观技术事实 |
| --- | --- |
| **宿主二进制与 `app.asar`** | 零修改、零解包、零补丁、零重签名 `app.asar`、`Info.plist`、`language_server` 或 `agy` |
| **只读遥测与全局规则边界** | 仅通过本机回环只读连接同一宿主 `language_server` RPC、只读解析本地 CLI 日志与白名单 `members.json`/`swarm.json` 元数据（绝不读取 `board.jsonl`、`transcript.jsonl` 或提示词正文）；用户主动触发的全局规则读写严格限定于非符号链接 `~/.gemini/GEMINI.md`（`<=200 KiB`） |
| **凭据与网络边界** | 不提取 CloudCode/Google OAuth Token、不切换账号、不发合成唤醒请求、不外传遥测；唯一可选外网请求为带 ETag 节流的 HTTPS `443` GitHub Releases 更新检查 |
| **可选 CDP 悬浮层** | 默认关闭；仅在用户显式开启并带 CDP 启动时挂载只读 Trusted-Types 安全 Shadow DOM 组件；按窗口绑定 Origin 与最小权限凭据，导航/断开即吊销 |
| **运行时依赖与开源协议** | 零外部运行时 npm 依赖（纯 Node.js 内置模块 + `esbuild` 打包产物）；100% 独立原创 **MIT** 开源代码 |

## 进阶文档与协议

- [架构与 D9 多智能体设计](docs/architecture.md) · [遥测、计价与 `agy-statusline`](docs/telemetry-and-pricing.md) · [可选 CDP 悬浮层与启动器](docs/cdp-overlays.md) · [完整变更日志](CHANGELOG.md) · [设计系统](DESIGN.md) · [产品规格](PRODUCT.md)
- 由 **AGI-is-going-to-arrive** 基于 [MIT 协议](LICENSE) 开源维护。社区致谢详见 [v1.18.0 发布说明](docs/releases/1.18.0.md#致谢) 与面板内**关于**页。

# AGENTS.md — One-Sentence Install & Upgrade Contract for AI Agents

Repository: `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor`  
Product: **Antigravity Context Window Monitor** — Official zero-patch **Antigravity App** Sidecar plugin (`AUX_PANE` + `SIDEBAR` + `SKILL.md`) and **Antigravity IDE** VSIX extension.

---

## English

### One-Sentence User Prompt (Copy & Paste to Any AI Agent)

> Read `AGENTS.md` in `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor` and install/upgrade Antigravity Context Monitor for my Antigravity App.

### Mandatory AI Agent Safety Boundaries

Before running any command, every AI agent **MUST** obey all 5 rules:

1. **Zero Binary / `app.asar` Patching:** Never modify `app.asar`, `Info.plist`, `language_server`, `agy`, or code-sign Antigravity host binaries. This plugin uses Antigravity's official, zero-patch Sidecar plugin API (`~/.gemini/config/plugins/antigravity-context-monitor`) and standard IDE VSIX extensions.
2. **NEVER Kill or Force-Quit the Running Antigravity App / IDE Host Process:** Do **NOT** execute `kill`, `pkill`, `killall`, `taskkill`, `Stop-Process`, or `osascript -e 'quit app "Antigravity"'` during an active agent chat session — killing the host terminates the conversation and can lose unsaved work. After installing or upgrading files on disk, instruct the user to reload safely by opening `[Antigravity Context Monitor](customization://antigravity-context-monitor)` and toggling it **Off → On** (or restarting Antigravity App themselves when ready).
3. **Verify Checksums & Status:** Always download exclusively over HTTPS from GitHub Releases (`github.com`, `api.github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`). Let `install-app-plugin.mjs` verify `SHA256SUMS.txt` and zip-slip safety automatically, then run `--status` to confirm the installed version, enabled state, and sidecar status.
4. **Never Clobber `~/.gemini/config/config.json`:** Do not overwrite `config.json` by hand. The installer delegates enablement to `agy plugin enable antigravity-context-monitor` when available (or atomically merges only `plugins["antigravity-context-monitor"].enabled = true`, preserving `userSettings`, `sidecars`, and all permission grants).
5. **No External npm Dependencies Required:** The installer and sidecar runtime use pure Node.js built-ins and work with system `node`, Antigravity's bundled `agy-node`, or Antigravity's Electron helper (`ELECTRON_RUN_AS_NODE=1`).

---

### Fast Agent Playbook (Choose Path A or B, Then Verify with C)

#### (a) Install / Upgrade from GitHub Releases Without Cloning

Use one of these single commands (add `--version <x.y.z>` to pin a version, or `--use-cli` to delegate installation to `agy plugin install`):

- **macOS / Linux (`curl` + `node`):**
  ```bash
  curl -fsSL https://raw.githubusercontent.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/main/scripts/install-app-plugin.mjs -o /tmp/acm-install.mjs && node /tmp/acm-install.mjs --from-github && rm -f /tmp/acm-install.mjs
  ```
- **Windows (PowerShell `irm` + `node`):**
  ```powershell
  $f = Join-Path $env:TEMP 'acm-install.mjs'; irm 'https://raw.githubusercontent.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/main/scripts/install-app-plugin.mjs' -OutFile $f; node $f --from-github; Remove-Item $f -Force
  ```
- **Cross-Platform Pure Node One-Liner (macOS / Windows / Linux):**
  ```bash
  node -e "const fs=require('fs'),os=require('os'),p=require('path'),cp=require('child_process');fetch('https://raw.githubusercontent.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/main/scripts/install-app-plugin.mjs').then(r=>{if(!r.ok)throw new Error(r.status);return r.text()}).then(s=>{const f=p.join(os.tmpdir(),'acm-install.mjs');fs.writeFileSync(f,s);try{cp.execFileSync(process.execPath,[f,'--from-github'],{stdio:'inherit'})}finally{fs.rmSync(f,{force:true})}})"
  ```

#### (b) Install / Upgrade from a Local Clone

- **Upgrade from latest GitHub Release (recommended, zero local build needed):**
  - Any OS (Node): `node scripts/install-app-plugin.mjs --upgrade`
  - macOS / Linux (auto-detects bundled Node/`agy-node`): `./scripts/install-app-plugin.sh --upgrade`
  - Windows PowerShell (auto-detects `agy-node.exe` / `agy-node.cmd`): `.\scripts\install-app-plugin.ps1 --upgrade`
- **Build & install from current local working tree:**
  ```bash
  npm ci && npm run compile && node scripts/package-app-plugin.mjs && node scripts/install-app-plugin.mjs --install
  ```
  *(Note: `--install` uses `dist/antigravity-context-monitor-app` when present and automatically falls back to `--from-github` when no local build exists.)*

#### (c) Verify Installation & Running Sidecar (`--status`)

Run the status check after every install or upgrade:

```bash
node scripts/install-app-plugin.mjs --status --check-remote
```

Add `--json` for structured agent parsing. Confirm:
- `appPlugin.installed === true` and `appPlugin.version` matches the target release.
- `appPlugin.enabled === true` (and `agy plugin list --json` shows `antigravity-context-monitor` enabled when `agy` CLI is installed).
- If `sidecar.reloadRequired === true` (upgraded over a running sidecar), **do NOT kill Antigravity** — report the version change and hand the user `[Antigravity Context Monitor](customization://antigravity-context-monitor)` so they can toggle it **Off → On** to load the new runtime.
- Once the sidecar is active, provide `[Context Monitor](sidecar://antigravity-context-monitor/context_monitor/)` to open the side pane (`AUX_PANE`), or remind the user they can open **Plugins → Context Monitor** in the left sidebar (`SIDEBAR`).

#### (d) Antigravity IDE (VSIX Extension) Install / Upgrade Path

If the user also uses **Antigravity IDE**:

1. Download `antigravity-context-monitor-<version>.vsix` and `SHA256SUMS.txt` from [GitHub Releases](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases) (verify SHA-256), or build locally with `npm run compile && npm run package`.
2. Install via CLI (or **Extensions: Install from VSIX...** in Command Palette):
   ```bash
   antigravity-ide --install-extension antigravity-context-monitor-<version>.vsix --force
   ```
   *(Open VSX Marketplace ID: `AGI-is-going-to-arrive.antigravity-context-monitor`.)*
3. Ask the user to reload the Antigravity IDE window (never force-kill the IDE process).

#### (e) Optional Commands (Uninstall & Opt-In CDP Guide)

- **Uninstall App Plugin:** `node scripts/install-app-plugin.mjs --uninstall`
- **Optional CDP Launch Guide (strictly opt-in, zero binary patching):** `node scripts/install-app-plugin.mjs --print-cdp-guide`  
  *(Core Sidecar `AUX_PANE` / `SIDEBAR` and the Native Ambient HUD work 100% natively without CDP. If a user opts into desktop floating overlays, remind them to **quit Antigravity App completely first** — `Cmd+Q` on macOS, close all windows & tray icon on Windows/Linux — then relaunch with `--remote-debugging-port=0` using `open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0` on macOS, `& "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0` in Windows PowerShell / `"%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0` in CMD/Shortcut, or `antigravity --remote-debugging-port=0` on Linux, and click **Recheck CDP** in Settings. Note: Antigravity auto-updates restart without CLI flags, and remember Safety Rule #2 — NEVER kill Antigravity yourself.)*

---

## 中文

### 给任意 AI 智能体的一句话提示词（直接复制发送）

> 请阅读 `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor` 中的 `AGENTS.md`，为我的 Antigravity App 安装或升级 Antigravity Context Monitor。

### AI 智能体强制安全边界

执行任何命令前，AI 智能体**必须**遵守以下 5 条约束：

1. **零二进制 / 零 `app.asar` 修改：** 严禁修改 `app.asar`、`Info.plist`、`language_server`、`agy` 或重签名宿主程序。本项目完全基于 Antigravity 官方原生 Sidecar 插件目录（`~/.gemini/config/plugins/antigravity-context-monitor`）与标准 IDE VSIX 扩展运行。
2. **严禁强杀正在运行的 Antigravity App / IDE 主进程：** 对话进行期间**绝不可**运行 `kill`、`pkill`、`killall`、`taskkill`、`Stop-Process` 或 `osascript` 强制退出 Antigravity——这会直接中断当前会话并造成未保存进度丢失。文件安装/升级完成后，请引导用户打开 `[Antigravity Context Monitor](customization://antigravity-context-monitor)` 将插件**关闭再重新开启**（或在方便时由用户自行重启应用）以安全热重载。
3. **强制校验 SHA-256 与运行状态：** 仅允许通过 HTTPS 从 GitHub 官方域名（`github.com`、`api.github.com`、`objects.githubusercontent.com`、`release-assets.githubusercontent.com`）拉取发布产物；由 `install-app-plugin.mjs` 自动完成 `SHA256SUMS.txt` 校验与防路径穿越解压，安装后必须运行 `--status` 复核版本、启用状态与 Sidecar 状态。
4. **绝不破坏 `~/.gemini/config/config.json`：** 禁止手动覆写 `config.json`。安装器会优先调用官方 `agy plugin enable antigravity-context-monitor`，否则仅原子合并 `plugins["antigravity-context-monitor"].enabled = true`，完整保留 `userSettings`、`sidecars` 及全部权限配置。
5. **零外部 npm 运行时依赖：** 安装器与 Sidecar 均仅依赖纯 Node.js 内置模块，兼容系统 `node`、Antigravity 内置 `agy-node` 及 Electron `ELECTRON_RUN_AS_NODE=1`。

---

### 智能体快速执行路径

#### (a) 无需克隆仓库，直接从 GitHub Releases 一键安装 / 升级

（可附加 `--version <x.y.z>` 指定版本，或附加 `--use-cli` 通过 `agy plugin install` 安装）

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

#### (b) 从本地源码仓库安装 / 升级

- **直接升级至最新 GitHub Release（推荐，无需本地编译）：**
  - 通用 Node：`node scripts/install-app-plugin.mjs --upgrade`
  - macOS / Linux（自动检测内置 Node/`agy-node`）：`./scripts/install-app-plugin.sh --upgrade`
  - Windows PowerShell（自动检测 `agy-node.exe` / `agy-node.cmd`）：`.\scripts\install-app-plugin.ps1 --upgrade`
- **从当前本地源码构建并安装：**
  ```bash
  npm ci && npm run compile && node scripts/package-app-plugin.mjs && node scripts/install-app-plugin.mjs --install
  ```
  *（说明：`--install` 优先使用本地 `dist/antigravity-context-monitor-app`，若本地未构建则自动回退到 `--from-github`。）*

#### (c) 安装后验收（`--status`）

```bash
node scripts/install-app-plugin.mjs --status --check-remote
```

可追加 `--json` 获取结构化输出。向用户汇报前请确认：
- `appPlugin.installed === true` 且 `appPlugin.version` 与目标版本一致；
- `appPlugin.enabled === true`（存在 `agy` 时也可用 `agy plugin list --json` 复核）；
- 若 `sidecar.reloadRequired === true`（覆盖升级了运行中的 Sidecar），**切勿强杀 Antigravity**，请向用户提供 `[Antigravity Context Monitor](customization://antigravity-context-monitor)` 让其在自定义页面关闭再重新开启插件以加载新运行时；
- Sidecar 就绪后，可提供 `[Context Monitor](sidecar://antigravity-context-monitor/context_monitor/)` 一键切换侧栏视图（`AUX_PANE`），或提示用户在左侧导航 **Plugins → Context Monitor** 打开宽屏视图（`SIDEBAR`）。

#### (d) Antigravity IDE（VSIX 扩展）安装 / 升级

1. 从 [GitHub Releases](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases) 下载 `antigravity-context-monitor-<version>.vsix` 与 `SHA256SUMS.txt` 并核对校验和（或本地运行 `npm run compile && npm run package`）。
2. 执行命令行安装（或在命令面板运行 **Extensions: Install from VSIX...**）：
   ```bash
   antigravity-ide --install-extension antigravity-context-monitor-<version>.vsix --force
   ```
   *（也可通过 Open VSX 商店搜索 `AGI-is-going-to-arrive.antigravity-context-monitor` 安装。）*
3. 请用户重载 IDE 窗口（切勿强杀 IDE 进程）。

#### (e) 卸载与可选 CDP 指南

- **卸载 App 插件：** `node scripts/install-app-plugin.mjs --uninstall`
- **查看可选 CDP 启动指南（纯启动参数，零二进制修改）：** `node scripts/install-app-plugin.mjs --print-cdp-guide`  
  *（核心侧栏/主视图与原生精简 HUD 完全原生工作，不依赖 CDP。若用户主动开启桌面悬浮层，请提示其**先自行完全退出 Antigravity App**——macOS 按 `Cmd+Q`，Windows/Linux 关闭全部窗口与托盘图标——再附带 `--remote-debugging-port=0` 重启：macOS 执行 `open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0`，Windows PowerShell 执行 `& "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0`（CMD / 快捷方式目标为 `"%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0`），Linux 执行 `antigravity --remote-debugging-port=0`，启动后在设置页点击「重新检测」。提示：自动更新重启会丢弃命令行参数，且务必遵守安全边界第 2 条——绝不由智能体强杀宿主进程。）*

# AGENTS.md — One-Sentence Install & Upgrade Contract for AI Agents

Repository: `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor`  
Product: **Antigravity Context Window Monitor** — community plugin using the official **Antigravity App** Sidecar API (`AUX_PANE` + `SIDEBAR` + `SKILL.md` + opt-in `agy-statusline.mjs`) and **Antigravity IDE** VSIX extension.

---

## English

### One-Sentence User Prompt (Copy & Paste to Any AI Agent)

> Read `AGENTS.md` in `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor` and install/upgrade Antigravity Context Monitor for my Antigravity App.

### Mandatory AI Agent Safety Boundaries

Before running any command, every AI agent **MUST** obey all 5 rules:

1. **Zero Binary / `app.asar` Patching:** Never modify `app.asar`, `Info.plist`, `language_server`, `agy`, or code-sign Antigravity host binaries. This plugin uses Antigravity's official Sidecar plugin directory (`~/.gemini/config/plugins/antigravity-context-monitor`) and standard IDE VSIX extensions.
2. **NEVER Kill or Force-Quit the Running Antigravity App / IDE Host Process:** Do **NOT** execute `kill`, `pkill`, `killall`, `taskkill`, `Stop-Process`, or `osascript -e 'quit app "Antigravity"'` during an active agent chat session — killing the host terminates the conversation and can lose unsaved work. After installing or upgrading files on disk, instruct the user to reload safely by opening `[Antigravity Context Monitor](customization://antigravity-context-monitor)` and toggling it **Off → On** (or reloading the IDE window via **Developer: Reload Window**).
3. **Verify Checksums & Status (Fail-Closed):** Always download exclusively over HTTPS `443` from GitHub Releases (`github.com`, `api.github.com`, `objects.githubusercontent.com`, `release-assets.githubusercontent.com`). Let `install-app-plugin.mjs` enforce fail-closed `SHA256SUMS.txt` verification, repo/tag/asset binding, and zip-slip safety automatically, then run `--status --json` to confirm installed version, `buildId`, enabled state, and running sidecar status.
4. **Never Clobber `~/.gemini/config/config.json`:** Do not overwrite `config.json` by hand. The installer delegates enablement to `agy plugin enable antigravity-context-monitor` when available (or atomically merges with concurrency lock protection only `plugins["antigravity-context-monitor"].enabled = true`, preserving `userSettings`, `sidecars`, and all permission grants).
5. **No External npm Dependencies Required:** The installer, sidecar runtime, IDE bundle, and `agy-statusline.mjs` use pure Node.js built-ins and work with system `node`, Antigravity's bundled `agy-node`, or Antigravity's Electron helper (`ELECTRON_RUN_AS_NODE=1`).

---

### Fast Agent Playbook (Choose Path A or B, Then Verify with C)

#### (a) Install / Upgrade from GitHub Releases Without Cloning

Use one of these single commands (add `--version <x.y.z>` to pin a release, or `--use-cli` to delegate installation to `agy plugin install`):

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
- **Build & install strictly from current local working tree (zero silent remote fallback):**
  ```bash
  npm ci && npm run build:bundles && node scripts/package-app-plugin.mjs --app-only && node scripts/install-app-plugin.mjs --install --local-dir dist/antigravity-context-monitor-app --no-remote-fallback
  ```
  *(Note: `--local-dir <dir>` / `--source <dir>` installs explicitly from a local plugin directory containing `plugin.json`; `--no-remote-fallback` fails closed if the local build is absent instead of silently downloading from GitHub.)*

#### (c) Verify Installation & Running Sidecar (`--status`)

Run the status check after every install or upgrade:

```bash
node scripts/install-app-plugin.mjs --status --check-remote
```

Add `--json` for structured agent parsing. Confirm:
- `appPlugin.installed === true`, `appPlugin.version` matches the target release, and `appPlugin.buildId` matches the expected bundle hash.
- `appPlugin.enabled === true` (and `agy plugin list --json` shows `antigravity-context-monitor` enabled when `agy` CLI is installed).
- If `sidecar.reloadRequired === true` (on-disk version or `buildId` differs from the running sidecar), **do NOT kill Antigravity** — report the version/`buildId` change and hand the user `[Antigravity Context Monitor](customization://antigravity-context-monitor)` so they can toggle it **Off → On** safely.
- Once the sidecar is active, provide `[Context Monitor](sidecar://antigravity-context-monitor/context_monitor/)` to open the side pane (`AUX_PANE`), or remind the user they can open **Plugins → Context Monitor** in the left sidebar (`SIDEBAR`) for the 6-tab dashboard (**Overview · Model Calls · Sessions · Usage & Cost · Models & Quotas · Settings** + topbar `ⓘ`). First-open App Overview also displays a dismissible **Overlays & CDP Quick Setup** banner, and the **Settings** tab opens with **Version & Updates** and includes **Overlays & CDP** alongside the hardened `~/.gemini/GEMINI.md` **Antigravity Global Rules** editor.

#### (d) Antigravity IDE (VSIX Extension) Install / Upgrade Path

If the user also uses **Antigravity IDE**:

1. Download `antigravity-context-monitor-<version>.vsix` and `SHA256SUMS.txt` from [GitHub Releases](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases) (verify SHA-256), or build locally with `npm run build:bundles && npm run package`.
2. Install via CLI (or **Extensions: Install from VSIX...** in Command Palette):
   ```bash
   antigravity-ide --install-extension antigravity-context-monitor-<version>.vsix --force
   ```
   *(Open VSX Marketplace ID: `AGI-is-going-to-arrive.antigravity-context-monitor`; default hotkeys: `Cmd+Alt+M` / `Ctrl+Alt+M` to open details, `Cmd+Alt+Shift+R` / `Ctrl+Alt+Shift+R` to refresh.)*
3. Ask the user to run **Developer: Reload Window** (never force-kill the IDE process).

#### (e) Optional Commands (Uninstall, `agy` CLI `statusLine` & Opt-In CDP Launcher)

- **Uninstall App Plugin:** `node scripts/install-app-plugin.mjs --uninstall`
- **Opt-In Read-Only `agy` CLI `statusLine`:** Configure `~/.gemini/antigravity-cli/settings.json` to run `node ~/.gemini/config/plugins/antigravity-context-monitor/bin/agy-statusline.mjs` (supports `--currency <10 codes incl. CAD>`, `--basis <compaction|native>`, `--no-color`, `--max-width`). Pure stdin reader (`64 KB` / `1500 ms` caps); never falls back to unrelated App sessions.
- **1-Click Zero-Patch Persistent CDP Launcher (strictly opt-in, auto-update proof):** `node scripts/install-app-plugin.mjs --setup-cdp-launcher` (remove via `--remove-cdp-launcher`; also in **Settings → Overlays & CDP** alongside **Reveal in Finder / Explorer / Folder**). Zero modifications to `/Applications/Antigravity.app` or `app.asar`:
  - **macOS:** `/Applications/Antigravity (CDP).app` (falls back to `~/Applications/Antigravity (CDP).app` and cleans up stale duplicates), `CDP`-badged native `.icns`, foreground-activated confirmation dialog with **`Cancel` as the default button**, Automation TCC fallback alert, and race-free 15s teardown wait *(drag `Antigravity (CDP).app` from Finder onto the Dock — do NOT click "Options → Keep in Dock" on the running Antigravity icon)*.
  - **Windows:** OneDrive-aware Desktop & Start Menu direct `.lnk` shortcuts pointing to `Antigravity.exe --remote-debugging-port=0` with a `CDP`-badged `.ico` (native Pin to Taskbar, zero CMD flash, auto-cleaning legacy `launch-antigravity-cdp.cmd`).
  - **Linux:** `~/.local/share/applications/antigravity-cdp.desktop` (`StartupWMClass=Antigravity`, escaped `Exec=`, best-effort `update-desktop-database`) + `~/.local/bin/antigravity-cdp` (standard/Snap/AppImage detection + non-killing conflict notice) + `CDP`-badged SVG icon.
- **Optional CDP Launch Guide:** `node scripts/install-app-plugin.mjs --print-cdp-guide`
  *(Core Sidecar `AUX_PANE` / `SIDEBAR` and Native HUD require zero CDP. If launching manually, remind the user to **quit Antigravity App completely first** — macOS `Cmd+Q` + ~5s teardown wait, race-free command: `while pgrep -f '^/Applications/Antigravity\.app/Contents/MacOS/Antigravity($| )' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0`; Windows PowerShell: `& "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0`; Linux: `antigravity --remote-debugging-port=0` — then click **Recheck CDP**. Remember Safety Rule #2 — NEVER kill Antigravity yourself.)*

---

## 中文

### 给任意 AI 智能体的一句话提示词（直接复制发送）

> 请阅读 `https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor` 中的 `AGENTS.md`，为我的 Antigravity App 安装或升级 Antigravity Context Monitor。

### AI 智能体强制安全边界

执行任何命令前，AI 智能体**必须**遵守以下 5 条约束：

1. **零二进制 / 零 `app.asar` 修改：** 严禁修改 `app.asar`、`Info.plist`、`language_server`、`agy` 或重签名宿主程序。本项目基于 Antigravity 官方 Sidecar 插件目录（`~/.gemini/config/plugins/antigravity-context-monitor`）与标准 IDE VSIX 扩展运行。
2. **严禁强杀正在运行的 Antigravity App / IDE 主进程：** 对话进行期间**绝不可**运行 `kill`、`pkill`、`killall`、`taskkill`、`Stop-Process` 或 `osascript` 强制退出 Antigravity——这会直接中断当前会话并造成未保存进度丢失。文件安装/升级完成后，请引导用户打开 `[Antigravity Context Monitor](customization://antigravity-context-monitor)` 将插件**关闭再重新开启**（IDE 端执行 **Developer: Reload Window**）以安全重载。
3. **强制 Fail-Closed 校验 SHA-256 与运行状态：** 仅允许通过 HTTPS `443` 从 GitHub 官方域名（`github.com`、`api.github.com`、`objects.githubusercontent.com`、`release-assets.githubusercontent.com`）拉取发布产物；由 `install-app-plugin.mjs` 自动完成 fail-closed `SHA256SUMS.txt` 校验、仓库/Tag/资产绑定与防路径穿越解压，安装后必须运行 `--status --json` 复核版本、`buildId`、启用状态与运行中 Sidecar 状态。
4. **绝不破坏 `~/.gemini/config/config.json`：** 禁止手动覆写 `config.json`。安装器会优先调用官方 `agy plugin enable antigravity-context-monitor`，否则仅在并发锁保护下原子合并 `plugins["antigravity-context-monitor"].enabled = true`，完整保留 `userSettings`、`sidecars` 及全部权限配置。
5. **零外部 npm 运行时依赖：** 安装器、Sidecar、IDE 扩展与 `agy-statusline.mjs` 均仅依赖纯 Node.js 内置模块，兼容系统 `node`、Antigravity 内置 `agy-node` 及 Electron `ELECTRON_RUN_AS_NODE=1`。

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
- **严格从当前本地构建目录安装（禁止静默回退远端下载）：**
  ```bash
  npm ci && npm run build:bundles && node scripts/package-app-plugin.mjs --app-only && node scripts/install-app-plugin.mjs --install --local-dir dist/antigravity-context-monitor-app --no-remote-fallback
  ```
  *（说明：`--local-dir <dir>` / `--source <dir>` 显式指定含 `plugin.json` 的本地插件目录；`--no-remote-fallback` 在本地产物缺失时直接报错，绝不静默回退拉取 GitHub Release。）*

#### (c) 安装后验收（`--status`）

```bash
node scripts/install-app-plugin.mjs --status --check-remote
```

可追加 `--json` 获取结构化输出。向用户汇报前请确认：
- `appPlugin.installed === true`、`appPlugin.version` 与目标版本一致且 `appPlugin.buildId` 与预期构建标识一致；
- `appPlugin.enabled === true`（存在 `agy` 时也可用 `agy plugin list --json` 复核）；
- 若 `sidecar.reloadRequired === true`（磁盘版本或 `buildId` 与运行中 Sidecar 不同），**切勿强杀 Antigravity**，请向用户提供 `[Antigravity Context Monitor](customization://antigravity-context-monitor)` 让其安全关闭再重新开启插件；
- Sidecar 就绪后，可提供 `[Context Monitor](sidecar://antigravity-context-monitor/context_monitor/)` 一键打开侧栏视图（`AUX_PANE`），或提示用户在左侧导航 **Plugins → Context Monitor** 打开 6 主标签宽屏视图（**概览 · 模型调用 · 会话 · 用量与费用 · 模型与配额 · 设置** + 顶栏 `ⓘ`）。App 端首次打开概览页会显示可关闭的**悬浮层与 CDP 引导**横幅，**设置**页首项为**版本与更新**，另有**悬浮层与 CDP**卡片和安全加固的 `~/.gemini/GEMINI.md` **Antigravity 全局规则**编辑器。

#### (d) Antigravity IDE（VSIX 扩展）安装 / 升级

1. 从 [GitHub Releases](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases) 下载 `antigravity-context-monitor-<version>.vsix` 与 `SHA256SUMS.txt` 并核对校验和（或本地运行 `npm run build:bundles && npm run package`）。
2. 执行命令行安装（或在命令面板运行 **Extensions: Install from VSIX...**）：
   ```bash
   antigravity-ide --install-extension antigravity-context-monitor-<version>.vsix --force
   ```
   *（Open VSX ID：`AGI-is-going-to-arrive.antigravity-context-monitor`；默认快捷键：`Cmd+Alt+M` / `Ctrl+Alt+M` 打开面板，`Cmd+Alt+Shift+R` / `Ctrl+Alt+Shift+R` 刷新。）*
3. 请用户执行 **Developer: Reload Window** 安全重载 IDE 窗口（切勿强杀 IDE 进程）。

#### (e) 卸载、可选 `agy` CLI `statusLine` 与可选 CDP 启动器

- **卸载 App 插件：** `node scripts/install-app-plugin.mjs --uninstall`
- **可选只读 `agy` CLI `statusLine`：** 在 `~/.gemini/antigravity-cli/settings.json` 中配置执行 `node ~/.gemini/config/plugins/antigravity-context-monitor/bin/agy-statusline.mjs`（支持 `--currency <含 CAD 共 10 币种>`、`--basis <compaction|native>`、`--no-color`、`--max-width`；严格 64 KB / 1500 ms 只读 stdin，绝不回退无关 App 会话）。
- **一键零魔改持久化 CDP 启动器（严格按需开启，免疫自动更新丢参）：** `node scripts/install-app-plugin.mjs --setup-cdp-launcher`（移除可用 `--remove-cdp-launcher`，也可在**设置 → 悬浮层与 CDP** 一键生成与定位）。零修改 `/Applications/Antigravity.app` 与 `app.asar`：
  - **macOS：** 优先生成 `/Applications/Antigravity (CDP).app`（无写权限时回退 `~/Applications/Antigravity (CDP).app` 并清理另一目录旧副本），附带原生 `CDP` 图标角标、前台激活确认框且**默认按钮为「取消（`Cancel`）」**（防止误按回车）、自动化权限回退提示及 15 秒无竞态退出等待*（如需固定到程序坞，请从访达将 `Antigravity (CDP).app` 拖入程序坞，切勿对运行中的原图标点「选项 → 在程序坞中保留」）*。
  - **Windows：** 适配 OneDrive 的桌面与开始菜单直连 `.lnk` 快捷方式（直接指向 `Antigravity.exe --remote-debugging-port=0` 与 `CDP` 角标 `.ico`，原生固定任务栏、零 CMD 黑框，自动清理旧 `.cmd`）。
  - **Linux：** `~/.local/share/applications/antigravity-cdp.desktop`（`StartupWMClass=Antigravity`、转义 `Exec=` 与 `update-desktop-database`）+ `~/.local/bin/antigravity-cdp`（兼容标准安装/Snap/AppImage 与非强杀冲突提示）+ `CDP` 角标 SVG 图标。
- **查看可选 CDP 启动指南：** `node scripts/install-app-plugin.mjs --print-cdp-guide`
  *（核心侧栏与原生 HUD 完全不依赖 CDP。若手动带参数启动，请提示用户**先自行完全退出 Antigravity App**——macOS 按 `Cmd+Q` 后等约 5 秒，推荐无竞态等待命令 `while pgrep -f '^/Applications/Antigravity\.app/Contents/MacOS/Antigravity($| )' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0`；Windows PowerShell 执行 `& "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0`；Linux 执行 `antigravity --remote-debugging-port=0`——启动后在设置页点击「重新检测」。务必遵守安全边界第 2 条——绝不由智能体强杀宿主进程。）*

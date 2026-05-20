# Antigravity Desktop Monitor — Project Structure

## What is this?

Antigravity Desktop Monitor 是一个独立的系统托盘监控工具，用于连接 Antigravity 桌面版 App 的 Language Server，实时显示用户状态、对话、模型配额等信息。

**技术栈**: Neutralinojs (WebView2) + PowerShell + curl.exe
**打包体积**: ~2MB (exe 1.6MB + resources 0.3MB)
**平台**: Windows 10/11

---

## File Tree

```
desktop-monitor/
├── neutralino.config.json          # [CONFIG]  Neutralinojs 框架配置
├── LICENSE                         # [META]    开源协议
├── README.md                       # [META]    项目说明 (模板生成)
│
├── resources/                      # ── 前端资源 (打包进 resources.neu) ──
│   ├── index.html                  # [UI]      主界面 HTML 结构
│   ├── styles.css                  # [UI]      样式 (暗色主题)
│   ├── poll.ps1                    # [BACKEND] LS 发现 + RPC 数据抓取脚本
│   │
│   ├── js/
│   │   ├── main.js                 # [CORE]    核心应用逻辑
│   │   ├── neutralino.js           # [LIB]     Neutralinojs 客户端库 (框架提供)
│   │   └── neutralino.d.ts         # [LIB]     TypeScript 类型定义 (框架提供)
│   │
│   └── icons/
│       ├── appIcon.png             # [ASSET]   应用图标
│       ├── trayIcon.png            # [ASSET]   系统托盘图标
│       └── logo.gif                # [ASSET]   Logo (模板附带)
│
├── bin/                            # ── Neutralinojs 运行时 (不进 git) ──
│   └── neutralino-win_x64.exe      # [RUNTIME] 框架二进制
│
└── dist/                           # ── 构建输出 (不进 git) ──
    └── AntigravityDesktopMonitor/
        ├── AntigravityDesktopMonitor-win_x64.exe   # 独立可执行文件
        └── resources.neu                           # 打包的资源文件
```

---

## File Responsibilities

### Config

| File | Description |
|---|---|
| `neutralino.config.json` | Neutralinojs 框架配置：应用 ID、窗口参数、API 权限白名单 (`nativeAllowList`)、二进制名称。**注意**: 打包后 config 不会被复制到 dist，窗口尺寸等需在 JS 里用 API 设置。 |

### UI Layer

| File | Description |
|---|---|
| `resources/index.html` | 主界面结构。包含标题栏 (拖拽区 + 按钮)、状态栏、用户信息区、活跃对话区、对话列表区、空状态占位。无框窗口，自定义标题栏。 |
| `resources/styles.css` | 暗色主题样式。CSS 变量定义色板 (`--bg-primary`, `--accent` 等)，包含标题栏、状态指示灯、信息网格、对话卡片、模型配额进度条、滚动条等样式。 |

### Core Logic

| File | Description |
|---|---|
| `resources/js/main.js` | **核心文件**，负责所有业务逻辑: |
| | - **Poll 脚本嵌入**: PowerShell 脚本以字符串常量形式嵌入，启动时写入 `%TEMP%\ag_monitor_poll.ps1` |
| | - **非阻塞轮询**: 使用 `Neutralino.os.spawnProcess` 异步执行 PowerShell，不阻塞 UI 线程 |
| | - **数据解析**: 解析 PowerShell 输出的结构化文本 (PID/PORT/TRAJ/STATUS 分段) |
| | - **UI 渲染**: `renderData()` 根据数据状态渲染连接状态、用户信息、模型配额、对话列表 |
| | - **系统托盘**: `setupTray()` 设置托盘图标和右键菜单 (Show/Refresh/Quit) |
| | - **窗口管理**: 拖拽 (`setDraggableRegion`)、隐藏/显示、动态尺寸 (70% 屏幕) |

### Backend (PowerShell)

| File | Description |
|---|---|
| `resources/poll.ps1` | **数据采集脚本** (独立版本，开发调试用): |
| | 1. 通过 WMI 查找 `language_server.exe --standalone` 进程 |
| | 2. 从命令行提取 `--csrf_token` |
| | 3. 通过 `netstat -ano` 查找进程监听端口 |
| | 4. 用 `curl.exe -k` 调用 RPC 接口 (GetAllCascadeTrajectories + GetUserStatus) |
| | 5. 输出结构化文本供 JS 解析 |

### Framework (不修改)

| File | Description |
|---|---|
| `resources/js/neutralino.js` | Neutralinojs 客户端库。提供 `Neutralino.os.*`, `Neutralino.window.*`, `Neutralino.events.*` 等 API。框架自动生成，不手动修改。 |
| `resources/js/neutralino.d.ts` | TypeScript 类型定义，IDE 辅助用。 |

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ main.js                                                         │
│                                                                 │
│  pollData()                                                     │
│    │                                                            │
│    ├── initPollScript()                                         │
│    │     └── 将 POLL_SCRIPT 写入 %TEMP%\ag_monitor_poll.ps1     │
│    │                                                            │
│    ├── spawnProcess("powershell ... poll.ps1")  ← 非阻塞        │
│    │     │                                                      │
│    │     ├── [PowerShell] 查找 language_server.exe              │
│    │     ├── [PowerShell] 提取 csrf_token + port                │
│    │     ├── [curl.exe]   GetAllCascadeTrajectories              │
│    │     ├── [curl.exe]   GetUserStatus                         │
│    │     └── stdout → 结构化文本                                 │
│    │                                                            │
│    └── spawnedProcess event handler                             │
│          ├── 累积 stdout 数据                                    │
│          └── exit → parseAndRender()                            │
│                       ├── renderData()  → 更新 DOM              │
│                       └── updateTray()  → 更新托盘状态           │
│                                                                 │
│  setInterval(pollData, 5000)  ← 每 5 秒轮询                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Build & Run

```bash
# 开发运行 (需要 Node.js + neu CLI)
npx @neutralinojs/neu run

# 构建独立可执行文件
npx @neutralinojs/neu build

# 直接运行打包后的 exe
dist/AntigravityDesktopMonitor/AntigravityDesktopMonitor-win_x64.exe
```

---

## Related Docs

- [Desktop LS Connection](./desktop-ls-connection.md) — RPC 协议和连接机制的完整技术文档
- [Technical Implementation](./technical_implementation.md) — IDE 插件的技术实现文档

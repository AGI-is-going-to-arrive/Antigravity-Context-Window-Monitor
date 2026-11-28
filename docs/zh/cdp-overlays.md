# App 悬浮层与 CDP 启动器

[English](../cdp-overlays.md) · [中文首页](../../readme_CN.md)

App 的侧栏视图、宽屏面板和原生 HUD 可以直接使用。输入框上下文环和右上角状态栏默认关闭；只有需要这两个悬浮层时，才需要通过 Chrome DevTools Protocol（CDP）连接 App。

## 创建、定位和移除启动器

打开「设置 → 悬浮层与 CDP」，选择创建持久化启动器，可在同一卡片中定位或移除。源码仓库也提供以下命令。

```bash
node scripts/install-app-plugin.mjs --setup-cdp-launcher
node scripts/install-app-plugin.mjs --remove-cdp-launcher
node scripts/install-app-plugin.mjs --print-cdp-guide
```

| 平台 | 生成的位置与行为 |
| --- | --- |
| macOS | 优先生成 `/Applications/Antigravity (CDP).app`，无写权限时使用 `~/Applications/`。启动器带 CDP 角标，确认框默认选中「取消」。用户确认后等待原进程退出，最多 15 秒；自动化权限不足时显示提示。如需固定到程序坞，从访达拖入生成的启动器。 |
| Windows | 在桌面和开始菜单创建带角标的 `.lnk` 快捷方式，兼容 OneDrive 桌面路径。目标直接指向带参数的 `Antigravity.exe`，可固定到任务栏。 |
| Linux | 安装 `~/.local/share/applications/antigravity-cdp.desktop`、`~/.local/bin/antigravity-cdp` 与 SVG 图标。支持常规安装、Snap 和 AppImage；已有实例占用时显示提示。 |

这些启动器独立于宿主程序，保留原 App 的文件和签名。

## 手动启动与重新检测

先保存工作，由你自行完全退出 Antigravity App。macOS 用户可按 `Cmd+Q`。随后只需运行适合本机的一组命令。

**macOS**

```bash
while pgrep -f '^/Applications/Antigravity\.app/Contents/MacOS/Antigravity($| )' >/dev/null; do
  sleep 0.5
done
open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0
```

**Windows PowerShell**

```powershell
& "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0
```

**Windows 命令提示符**

```cmd
"%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0
```

**Linux**

```bash
antigravity --remote-debugging-port=0
```

启动后点击「设置 → 悬浮层与 CDP → 重新检测」。

## 阅读与操作悬浮层

输入框上下文环、顶栏、概览和原生 HUD 读取同一份观测。查看同一个会话和数据版本时，各处采用相同的窗口分母、数值及超限显示规则。「配额」「上下文」「速度」「总量」四种详情可以切换，「打开面板」跳转到相应标签，也兼容旧版链接名称。

悬浮层识别分屏中获得焦点的聊天。点击图标会保留输入框焦点；流式回复的正文更新跳过布局重算。悬停约 250 毫秒打开详情，相邻项目之间有 350 毫秒切换宽限。设置里可选择紧凑、标准、大号字体和高对比度配色。弹窗使用浏览器顶层显示，按可用空间定位。新会话的 0% 与缺少读数时的 `—` 分别显示。

## 多窗口与连接限制

注入器先核对目标是否属于当前 Antigravity Hub 会话，再建立连接。显式指定的调试端口优先于旧端口文件。每个窗口使用与自身来源绑定的有限授权，只能执行打开面板、刷新、暂停或恢复，以及同步会话焦点。窗口导航、断开、关闭功能和重启均会撤销该授权。更新的悬浮层通过内容哈希识别。

macOS 上关闭所有窗口后，如果 App 仍在程序坞中运行，重开窗口时会以约 2.5 秒间隔重试查找 Hub。两个开关都关闭时，悬浮层停止探测端口、宿主进程和 WebSocket 连接。[显示规则与数据来源](telemetry-and-pricing.md)

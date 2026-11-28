# Changelog / 变更日志

> Full history for **v1.17.11 and earlier** is preserved verbatim in [docs/CHANGELOG_ARCHIVE.md](docs/CHANGELOG_ARCHIVE.md).
>
> **v1.17.11 及更早版本**的完整历史记录已归档保留于 [docs/CHANGELOG_ARCHIVE.md](docs/CHANGELOG_ARCHIVE.md)。

## [1.18.0] - Upcoming

### English

- **Inspect a swarm member.** In Overview or Sessions, expand **Member details** to see the member’s last reported state and available measurements. Choose **Open member overview** to read that member directly. **Back to Main** returns to the root. The App and IDE also show members missing from the host’s public session list when a local swarm manifest identifies them.
- **Read the group estimate.** Usage & Cost shows how many members have call records. Each recorded call counts once toward its group. A worker with no recorded calls has no estimate. The current group’s session history and the ledger for the selected period have separate labels.
- **Find model limits and quota.** Expand **Model Info** under Models & Quotas, then a model name to see its limits and reference rates. Open multiple models to compare them. **Lower remaining quota** selects between the 5-hour and weekly windows. The reading names the selected window, for example **Weekly quota remaining 71%**.
- **Find updates and credit settings.** **Version & Updates** is first in Settings. About links directly there. **Set credits expiry day** in Overview opens Models & Quotas and focuses the monthly expiry field for the current account.

- **Unified Immutable Observation, 3-Field Root Lock & Swarm/Subagent Live Tracking (D9 — `src/core/context-display.ts`, `src/core/swarm-registry.ts`, `src/core/gm-context-fallback.ts`, `src/conversation-selector.ts`):**
  - Published a single deeply-frozen `PublishedMonitorObservation` across Overview, Native HUD, CDP Topbar, CDP Composer Ring, and IDE Status Bar so every surface displaying the same `(subjectCascadeId, dataRevision)` reports identical percentages, dual-limit bases, overflow text, and speed sample metadata.
  - Separated shared `AppSettings` from per-window `{ observedHostFocus, lockedRootId, inspectedMemberId }` scoped to `{ backendEpoch, windowId }`: root lock outranks all passive inputs, synchronously anchors roots, preserves `lockedRootId` during worker inspection with **Back to Main**, and distinguishes transient absence (`Pending/Unavailable`) from confirmed deletion.
  - Added authoritative read-only `SwarmRegistry` (`members.json` / `swarm.json` field allowlist only — never reads `board.jsonl`, `transcript.jsonl`, `plan.json`, `steps/`, or prompts) with 512 KB streaming caps, symlink/junction checks, anomaly handling, fair-budget `SwarmPollScheduler` (`<=3` concurrency, 20+ members, terminal final refresh), and separate direct worker vs deduplicated inclusive group costs.
- **6 Zero-Scroll Main Tabs, Persistent App Onboarding & Hardened Global Rules Manager (`src/webview-document.ts`, `src/webview-overview-tab.ts`, `src/webview-settings-tab.ts`, `src/global-rules.ts`):**
  - Promoted **Settings** into the main 6-tab zero-scroll bar (**Overview · Model Calls · Sessions · Usage & Cost · Models & Quotas · Settings**, `320px–1440px`), removed the duplicate topbar `⚙️` button, added rich non-duplicated tooltips to both topbar **`ⓘ` About** and the **Settings** tab, and preserved all **18 legacy tab IDs & deep-link aliases**.
  - Added a persistent App first-open **Overlays & CDP Quick Setup** onboarding banner (`#appOnboardingBanner`, `appOnboardingDismissed`, auto-hides once CDP overlays are active, with 1-click launcher creation, direct jump to Settings, and a **Show Overview Setup Tip** restore control) and elevated **Overlays & CDP** to the top of App Sidecar Settings.
  - Added a hardened **Antigravity Global Rules (`~/.gemini/GEMINI.md`)** inline manager adapted from [PR #78](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/78) (thank you `@gitstq`!): exact `~/.gemini/GEMINI.md` allowlist without widening `~/.gemini/`, symlink/junction & `O_NOFOLLOW`/FD `(dev, ino)` checks, create-only (`linkSync`/`wx`) Open & Save-from-missing guards, atomic temp-file writes, consistent `200 KiB` dual-surface parity, Standalone `403` isolation, and privacy-safe on-demand loading + automatic textarea scrub & Save re-lock on privacy re-mask.
- **Huge-Session Suffix Recovery (#79) & Windows `EBUSY` Updater Hardening (`src/tracker.ts`, `src/rpc-client.ts`, `src/app/plugin-updater.ts`, `src/cli/install-app-plugin-entry.ts`):**
  - Fixed [Issue #79](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/issues/79) (thank you `@GHTGXL`!): added bounded (`<=8` probes) suffix binary-search recovery and mid-pagination tail reserve recovery for huge `>50 MB` and paginated `>1,200`-step conversations with immediate streaming buffer release (zero OOM) and `suffixStartOffset` alignment in context breakdown & compaction checkpoints; preserved `activity/tracker.ts` `stepCount` on budget-rejected reads.
  - Hardened Windows `EBUSY`/`EPERM`/`EACCES` plugin upgrades and uninstalls with retry backoff, locked-target transactional swap fallback, strict `validateExtractedPluginBundle()` rollback verification, case-insensitive relative path checks, and safe empty-dir pruning.
- **Plan C Telemetry, 10 Currencies, Workflows & Opt-In `agy` CLI `statusLine` (D1, D5 — `src/telemetry-metrics.ts`, `src/quota-runway.ts`, `src/core/currency.ts`, `app-plugin/bin/agy-statusline.mjs`):**
  - Added local 5-minute Prompt Cache idle TTL heuristic (`180s` warn / `300s` expire, suspend/clock-reversal guards, null-preserving counts, possible miss causes), Model-Call **Decode vs E2E** speed toggle + ratio-of-sums coverage & anomaly filters, `5h`/`7d`/`tightest` & `remaining`/`used` quota toggles + persistent weekly active-hours forecast (`Insufficient history` guard), first-boot system single-language default + per-view narrow-pane compact mode (`<=480px`), and split `appShowNativeHudBar` (`true`) / `ideShowNativeHudBar` (`false`).
  - Unified **10 currencies** (adding **`CAD`** `CA$`) with currency-bound `customFxRate`; relocated Plan ROI to a collapsible Advanced section; added ingestion-time **Workspace Leaderboard** (`Unattributed` for legacy rows), unified **Markdown / CSV / JSON** exports, revision-bound **Handoff v2** + read-only **Compaction Recovery Brief**, **6-group Settings** with allowlisted JSON backup/import & redacted diagnostics, opt-in **`agy-statusline.mjs`**, and conflict-free IDE keybindings (`Cmd+Alt+M` / `Ctrl+Alt+M`, `Cmd+Alt+Shift+R` / `Ctrl+Alt+Shift+R`).
- **Critical Security, Theme Polarity, IDE IPC, Durability & Packaging Hardening (D4, D6, D7, D8):**
  - Fixed `$&`/`$$` callback-replacer corruption on minified `host-bridge` / script injection, enforced clean Light / Dark / HC / HC-Light theme polarity (including `oklch`/`hsl`/`color()` & SDK hint-only `theme-change`), and fixed IDE hover-tooltip repeated tab jumps via per-panel 24-byte cryptographic nonce IPC (`__ACM_CONSUME_HOST_NONCE__` one-shot self-removing `<script>`).
  - Hardened authenticated Standalone one-time pairing, per-window fail-closed privacy masking & `[Redacted]` App/IDE Model Calls parity (with `sessionStorage` reload re-mask protection), Calendar prototype-pollution & masked Swarm HMAC parity, `DurableState.flush()` concurrent reload preservation & empty-lock reclaim, PID-owned loopback discovery (`::1`/`127.0.0.1`), zero-runtime-dep `esbuild` + Brotli-11 static text compaction, `256×256` `assets/icon.png`, and the EN/ZH interface gallery. See [docs/releases/1.18.0.md](docs/releases/1.18.0.md).

### 中文

- **查看子成员。** 在概览或会话展开**成员详情**，先看成员最近上报的状态和已有读数。点**在概览中查看**会直接读取该成员，点**返回主会话**可回到根会话。即使宿主会话列表省略了某个成员，App 和 IDE 也能列出本地成员清单中已有的记录。
- **核对整组费用。** 用量与费用会列出有调用记录的成员数。每次已记录的调用在组内只计一次。没有调用记录的子成员显示暂无估算。当前组的会话历史和所选时段的账本分别标明来源。
- **查模型参数和配额。** 在模型与配额中展开**模型信息**，再点模型名称，可查看上限与参考价格，也可同时打开多个模型对照。选择**按剩余较少的窗口**后，插件比较 5 小时和每周窗口，直接显示例如**每周配额剩余 71%**。
- **找更新和积分设置。** 打开设置，首项即为**版本与更新**，关于页也可直达。在概览点**设置积分到期日**，会打开模型与配额并定位到当前账号的每月到期日输入框。

- **统一不可变观测、三字段真锁定与多智能体（Swarm / 子智能体）实时跟踪（D9 — `src/core/context-display.ts`、`src/core/swarm-registry.ts`、`src/core/gm-context-fallback.ts`、`src/conversation-selector.ts`）：**
  - 发布单一冻结观测对象 `PublishedMonitorObservation`，保障概览、原生 HUD、CDP 顶栏、CDP 输入框圆环与 IDE 状态栏在同 `(subjectCascadeId, dataRevision)` 下主百分比、双上限口径、溢出文本与速度样本 100% 同源一致。
  - 分离跨端 `AppSettings` 与窗口本地 `{ observedHostFocus, lockedRootId, inspectedMemberId }`：根锁定优先级高于全部被动输入，查看子成员时保留根锚点并提供一键**返回主会话**，区分暂失（「待确认」）与确认删除。
  - 新增权威只读 `SwarmRegistry`（严格仅读 `members.json` / `swarm.json` 白名单字段，绝不读 `board.jsonl`、`transcript.jsonl`、`plan.json`、`steps/` 或提示词），带 512 KB 流式上限、symlink/Junction 校验、公平预算调度器 `SwarmPollScheduler`（并发 `<=3`、支持 20+ 成员与终态收尾刷新）以及单成员直属与去重整组费用分列。
- **6 零滚动主标签页、App 持久化首次引导与加固版全局规则编辑器（`src/webview-document.ts`、`src/webview-overview-tab.ts`、`src/webview-settings-tab.ts`、`src/global-rules.ts`）：**
  - 将**设置**升级至 6 零滚动主标签栏（**概览 · 模型调用 · 会话 · 用量与费用 · 模型与配额 · 设置**，覆盖 `320px–1440px`），移除重复顶栏 `⚙️`，为顶栏**关于（`ⓘ`）**与**设置**标签补全无重复的富说明提示，100% 兼容全部 **18 个历史标签 ID 与别名**。
  - 新增 App 端持久化首次打开**悬浮层与 CDP 引导**横幅（`#appOnboardingBanner`、`appOnboardingDismissed`，CDP 悬浮层启用后自动隐藏，提供一键创建启动器、直达设置与「在概览重新显示引导」恢复按钮），并将 App 端**设置 → 悬浮层与 CDP** 卡片置顶。
  - 基于 [PR #78](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/pull/78)（致谢 `@gitstq`！）吸收并安全加固 **Antigravity 全局规则（`~/.gemini/GEMINI.md`）** 内联管理器：精确白名单不放宽 `~/.gemini/`、防符号链接/Junction 与 `O_NOFOLLOW`/FD `(dev, ino)` 校验、缺失新建 create-only（`linkSync`/`wx`）保护、临时文件原子写入、双端统一 `200 KiB` 上限、Standalone `403` 隔离及按需读取 + 隐私重遮罩自动清空文本框并重新锁定保存。
- **超大对话尾部二分恢复（#79）与 Windows `EBUSY` 更新器加固（`src/tracker.ts`、`src/rpc-client.ts`、`src/app/plugin-updater.ts`、`src/cli/install-app-plugin-entry.ts`）：**
  - 修复 [Issue #79](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/issues/79)（致谢 `@GHTGXL`！）：针对 `>50 MB` 超大响应与分页 `>1,200` 步长对话实现有界（`<=8` 次探测）尾部二分恢复与分页尾预算预留，超限流即时释放缓冲区（零 OOM），并在上下文构成与压缩检查点中对齐 `suffixStartOffset`；预算受限时保留 `activity/tracker.ts` 的 `stepCount` 防漏步。
  - 针对 Windows `EBUSY`/`EPERM`/`EACCES` 场景加固插件升级与卸载：支持退避重试、锁定目录原地替换回退、删除备份与回滚前强制 `validateExtractedPluginBundle()` 校验、大小写无关路径检查及安全空目录清理。
- **方案 C 遥测、10 币种契约、效率工作流与可选 `agy` CLI `statusLine`（D1、D5）：**
  - 新增 5 分钟提示词缓存空闲 TTL 启发式（`180s` 预警 / `300s` 过期、休眠/时钟倒退守卫、可能未命中原因）、模型调用级**解码 vs E2E** 速度与异常筛选、`5h`/`7d`/**按剩余较少的窗口** 与 `剩余`/`已用` 切换及周活跃时长节奏预测（「历史不足」保护）、首启按系统单语 + 窄栏（`<=480px`）视图级紧凑模式及拆分 `appShowNativeHudBar` / `ideShowNativeHudBar`。
  - 全端统一 **10 币种**（补齐 **`CAD`** `CA$`）与绑定币种汇率；套餐 ROI 移入可折叠高级区；新增入账级**工作区项目榜**（旧数据归入**未归属**）、统一 **Markdown / CSV / JSON** 导出、绑定版本的**交接指令 v2** 与只读**压缩恢复摘要**、**6 组设置**与白名单 JSON 备份/脱敏诊断、可选 **`agy-statusline.mjs`** 及无冲突 IDE 快捷键（`Cmd+Alt+M` / `Ctrl+Alt+M`、`Cmd+Alt+Shift+R` / `Ctrl+Alt+Shift+R`）。
- **关键安全、主题极性、IDE Nonce IPC、持久化与打包加固（D4、D6、D7、D8）：**
  - 修复压缩桥接/脚本注入中的 `$&`/`$$` 替换破坏；彻底校准 Light / Dark / HC / HC-Light 主题极性（含 `oklch`/`hsl`/`color()` 与 SDK 仅传主题名事件）；新增 IDE 面板级 24 字节加密 Nonce IPC（`__ACM_CONSUME_HOST_NONCE__` 一次性自销毁 `<script>`），彻底修复悬停摘要重复点击二级标签跳转失效。
  - 加固 Standalone 一次性配对鉴权、按窗口 fail-closed 隐私遮罩与 App/IDE 模型调用 `[Redacted]` 对齐（含 `sessionStorage` 重载续遮罩）、日历原型污染与遮罩 Swarm HMAC 对齐、`DurableState.flush()` 并发保留与崩溃空锁回收、PID 归属回环发现（`::1`/`127.0.0.1`）、零运行时依赖 `esbuild` + Brotli-11 静态文本压缩、`256×256` `assets/icon.png` 与中英 WebP 界面画廊。详见 [docs/releases/1.18.0.md#中文](docs/releases/1.18.0.md#中文)。

## [1.17.11] - 2026-11-27

- **Three-Platform Badged Persistent CDP Launcher:** macOS `/Applications/Antigravity (CDP).app` priority with stale cleanup & centered native `CDP` icon badge; Windows OneDrive-aware direct `.lnk` shortcuts + `.ico` badge (zero CMD flash, native Taskbar pin); Linux standard/Snap/AppImage detection, non-killing conflict notice, and `CDP` SVG badge.
- **Cross-Session Context Jump Fix & Unified Rich Popover Engine:** Clean `0%` brand-new conversation startup (`hostPending`), Swarm worktree isolation, atomic `telemetryRefreshSeq`, Hub `focusConversation` sync, body-level `#acmRichTipPopover` retiring clipped CSS `[data-tooltip]::after`, and interactive Context Breakdown Top-3 drawer + 4-theme palette.
- Details: [docs/releases/1.17.11.md](docs/releases/1.17.11.md) · [Archive](docs/CHANGELOG_ARCHIVE.md#11711---2026-11-27)

## [1.17.10] - 2026-11-26

- Fixed Windows Antigravity 2.35.2 inline TopBar WCO ~146px blank gap (`computeWcoInsetPx(false) === 0`), hardened `fixed` WCO boundary guards & `geometrychange` tracking, row-accurate inline right-chrome budgeting, empty Row-1 WCO cutout fallthrough, and idempotent `anchor.before` normalization (thanks `@Number444`, Issue #77).
- Details: [docs/releases/1.17.10.md](docs/releases/1.17.10.md) · [Archive](docs/CHANGELOG_ARCHIVE.md#11710---2026-11-26)

## [1.17.9] - 2026-11-25

- Rebuilt Top-Right Status Bar 4-tier anchoring, promoted overlay popovers to Chromium Top Layer (`popover="manual"`) with live sidebar-safe clamping, anchored Composer Context Ring strictly left of `Turbo` (blacklisting `This Computer` metadata bar), and prevented HTTPS Hub self-exclusion.
- Details: [docs/releases/1.17.9.md](docs/releases/1.17.9.md) · [Archive](docs/CHANGELOG_ARCHIVE.md#1179---2026-11-25)

## [1.17.8] - 2026-11-25

- Added Top-Right Status Bar dedicated 4-view popover (`Quota` / `Context` / `Speed` / `Total`) with 8 live telemetry fields, local `HH:MM:SS` clock, context-aware `Open Panel` routing, macOS foreground dialog + TCC fallback, and one-click `Reveal in Finder / Explorer / Folder`.
- Details: [docs/releases/1.17.8.md](docs/releases/1.17.8.md) · [Archive](docs/CHANGELOG_ARCHIVE.md#1178---2026-11-25)

---

*For **v1.17.7 through v1.0.0** (idle-backoff & ETag fixes, 52-week multi-source Calendar, App Sidecar debut, Orchestrator attribution, and IDE history), see [docs/CHANGELOG_ARCHIVE.md](docs/CHANGELOG_ARCHIVE.md).*

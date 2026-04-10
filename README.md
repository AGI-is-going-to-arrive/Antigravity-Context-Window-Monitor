# 🌌 Antigravity Context Window Monitor

A plugin built for **Antigravity** (Google's Windsurf-based IDE) that provides real-time monitoring of context window usage across all your chat sessions.

**[🇨🇳 中文文档 / Chinese Documentation](readme_CN.md)**

---

> [!WARNING]
> **Platform Support**
>
> 🍏 **macOS**: Fully supported. Uses `ps` and `lsof` for process discovery.
>
> 🐧 **Linux**: Fully supported (v1.6.0+). Uses `ps` with `lsof`/`ss` fallback for process discovery. Tested on Ubuntu 22.04 (x64 & ARM64).
>
> 🪟 **Windows**: Fully supported (v1.8.0+). Optimized discovery with `wmic` caching and PowerShell fallbacks.
>
> 🐧🪟 **WSL**: Fully supported (v1.12.0+). Detects WSL environment via `/proc/version` and uses Windows-side tools through WSL interop for LS discovery. v1.12.1 adds `extensionKind: ["ui", "workspace"]` so the extension runs on the local Windows host when connected via Remote-WSL or Remote SSH. v1.13.0 adds **Remote-WSL LS discovery** — when connected to a WSL workspace, the extension discovers the `language_server_linux_x64` process running inside the WSL distro via `wsl -d <distro>`, connects to it through WSL2 port forwarding, and displays the correct context data.

---

## 📚 Technical Details

👉 **[Read the Technical Implementation Guide](docs/technical_implementation.md)**

---

## ✨ Features

* **⚡ Real-Time Token Usage**
    Shows current token consumption in the status bar (e.g. `125k/200k, 62.5%`). Token data comes from model checkpoint values when available, with content-based character estimation between checkpoints (replaces fixed constants since v1.4.0). Fixed constants are only used as fallback when step data structure is missing.

* **🌐 Language Switching**
    Users can choose between Chinese-only, English-only, or bilingual display mode. Accessible from the details panel: click status bar → Settings → Switch Language. Preference is persisted via `globalState` across sessions.

* **🔒 Multi-Window Isolation**
    Each Antigravity window only shows conversations belonging to its workspace, filtered by workspace URI. Windows without a workspace folder show all conversations.

* **🗜️ Context Compression Detection**
    When the model auto-compresses conversation history, the plugin detects it via two-layer detection: primary layer compares consecutive checkpoint `inputTokens` (drop > 5000 tokens, immune to Undo false positives), fallback layer compares cross-poll `contextUsed` (with Undo exclusion guard). Shows `~100% 🗜` in the status bar.

* **⏪ Undo/Rewind Support**
    When you undo a conversation step, the plugin detects the `stepCount` decrease and recalculates token usage to reflect the rollback.

    | Before Undo | After Undo |
    | :---: | :---: |
    | ![Before Undo](src/images/回退前.png) | ![After Undo](src/images/回退后.png) |

* **🔄 Dynamic Model Switching**
    When switching models mid-conversation, the context window limit automatically updates to match the new model. Since v1.4.0, model display names are dynamically fetched via the `GetUserStatus` API.

* **🎨 Image Generation Tracking**
    When Nano Banana Pro is invoked for image generation during Gemini Pro conversations, the associated token consumption is tracked and marked with `📷` in the tooltip. Detection is based on step type and generator model name matching.

    ![Image Generation Tracking](src/images/生成图片.png)

* **🛌 Exponential Backoff Polling**
    When the language server is unreachable, polling interval increases as `baseInterval × 2^n` with dual caps: discovery failures cap at 15s (5s → 10s → 15s) for fast LS detection, RPC failures cap at 60s. Resets immediately on reconnection.

* **📊 WebView Monitor Panel** *(v1.10.1)*
    Click the status bar to open a side panel with a full-featured dashboard. Displays your account plan and tier, Prompt/Flow credit balance, per-model quota usage with color-coded progress bars, feature flags, team config (MCP Servers, Auto-Run, etc.), and Google AI credits. All data comes from the existing `GetUserStatus` API — zero additional network requests.
    * **🛡️ Privacy Mask**: A shield button in the panel header masks your name and email. The toggle state persists across panel refreshes.
    * **📂 Collapsible Sections**: Secondary info (Plan Limits, Feature Flags, Team Config, Google AI Credits) is collapsed by default. Expand/collapse state persists.

* **⚙️ Interactive Settings Dashboard** *(v1.11.0)*
    The WebView panel now features a dual-tab layout ('Monitor' and 'Settings'). The Settings tab lets you configure extension behaviors directly from a GUI — no more manual `settings.json` editing.
    * **🎯 Compression Warning Threshold**: Set a custom "tripwire" (e.g., 150K, 200K, 500K, 900K) for early warning before Antigravity's backend compression triggers (~200K). Status bar color changes are based on this threshold instead of the full model limit.
    * **🟢 Status Bar Quota Indicator**: Current model's quota percentage is now shown directly in the status bar with color-coded dot icons (`🟢`, `🟡`, `🔴`).
    * **⏳ Current-Model Reset Countdown**: The status bar countdown now tracks the reset time of the model you are currently using, not the earliest reset across all models.
    * **🎛️ Status Bar Display Toggles**: Independent toggle switches to hide/show 'Context Usage', 'Quota Indicator', and 'Reset Countdown' in the status bar.
    * **⏸️ Pause/Resume**: Pause auto-refresh to freeze the panel while investigating data.

* **🧠 Model Activity Monitor** *(v1.11.2, enhanced in v1.11.3 & v1.12.2)*
    New Activity tab tracks real-time AI reasoning calls, tool usage, tokens, and timing per model across all conversations. Access via the main status bar item or the `Show Model Activity` command.
    * **🔧 Tool Name Display** *(v1.11.3)*: Timeline entries show the tool name (e.g., `view_file`, `gh/search_issues`) with step index badges.
    * **⚡ Independent Activity Polling** *(v1.11.3)*: Activity tracking runs on a separate 3-second polling loop, decoupled from the global 5-second poll for faster updates.
    * **🎯 Three-Layer Quota Detection** *(v1.12.2)*: Instant detection via elapsed-in-cycle comparison, drift-based detection via resetTime observation, and fraction-based detection. No more hardcoded cycle lengths — adapts to any quota cycle automatically.
    * **🔀 Archive Debounce** *(v1.12.2)*: Cross-pool resets within 5 minutes are merged into a single archive entry, preventing fragmentation.
    * **💾 Persistence**: Activity stats survive VS Code restarts via `globalState`. Throttled to max once per 30s.
    * **📋 Auto-Archive**: When model quota resets, current activity is automatically archived to history with source tracking (`triggeredBy`), giving per-cycle usage reports.
    * **📊 Estimated Steps**: When conversations exceed the LS API's ~500 step window, additional steps are tracked as estimated counts with clear `📊` markers.
    * **⚠️ Low Quota Notification**: Warning popup when any model's remaining quota drops below a configurable threshold (default 20%).

## 🤖 Supported Models

| Model | Internal ID | Context Limit |
| --- | --- | --- |
| Gemini 3.1 Pro (High) | MODEL_PLACEHOLDER_M37 | 1,000,000 |
| Gemini 3.1 Pro (Low) | MODEL_PLACEHOLDER_M36 | 1,000,000 |
| Gemini 3 Flash | MODEL_PLACEHOLDER_M47 | 1,000,000 |
| Claude Sonnet 4.6 (Thinking) | MODEL_PLACEHOLDER_M35 | 1,000,000 |
| Claude Opus 4.6 (Thinking) | MODEL_PLACEHOLDER_M26 | 1,000,000 |
| GPT-OSS 120B (Medium) | MODEL_OPENAI_GPT_OSS_120B_MEDIUM | 128,000 |

*Model IDs are fetched from the local Antigravity language server's `GetUserStatus` API. If new models are added, you can override context limits in IDE settings.*

## 🚀 Usage

1. **Install**:
   * **OpenVSX**: Install directly from [Open VSX Registry](https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor).
   * **Manual**: Install the `.vsix` file via Extensions → Install from VSIX.
2. **Status Bar**: The bottom-right status bar shows current context usage (displays `0k/1000k, 0.0%` for empty chats).
3. **Hover**: Hover over the status bar item for detailed info (model, input/output tokens, remaining capacity, compression status, image gen steps, per-model quota summary, etc.).

   ![Hover Details](src/images/悬停详情new.png)

4. **Click — WebView Monitor Panel**: Click the status bar item to open a comprehensive **9-tab monitoring dashboard**:

   **Monitor** — Quota overview, GM snapshot, cost snapshot, active session details with output breakdown and LLM call details.

   ![Monitor Tab](src/images/montior1.png)

   ![Monitor Tab - Session Details](src/images/monitor2.png)

   **GM Data** — Detailed per-model token usage, call counts, cache hit rates, and retry statistics.

   ![GM Data Tab](src/images/gmdata1.png)

   ![GM Data Tab - Details](src/images/gmdata2.png)

   **Sessions** — Browse all conversation sessions with context usage, step counts, and model info.

   ![Sessions Tab](src/images/session.png)

   **Cost** — Monthly cost breakdown with per-model pricing, cost overview visualization, and custom pricing editor.

   ![Cost Tab](src/images/cost.png)

   **Models** — All available models with quota status, context limits, and reset countdowns.

   ![Models Tab](src/images/model.png)

   **Quota Tracking** — Real-time quota tracking with archived cycle history and reset time monitoring.

   ![Quota Tracking Tab](src/images/额度追踪.png)

   **Calendar** — Historical usage data organized by date, with per-cycle cost and token breakdowns.

   ![Calendar Tab](src/images/日历_全部.png)

   **Profile** — Account information, plan details, and credit balances.

   ![Profile Tab](src/images/profile.png)

   **Settings** — Configure extension behaviors: compression threshold, status bar toggles, polling interval, and more.

   ![Settings Tab](src/images/settings1.png)

   ![Settings Tab - Advanced](src/images/settings2.png)

## ⚠️ Known Limitations

> [!IMPORTANT]
> **Same-Workspace Multi-Window**
> If you open multiple Antigravity windows on the **same folder**, they share the same workspace URI, and session data may overlap.
>
> **Solution**: Open different folders in different windows.

> [!NOTE]
> **Compression Notification**
> The compression notification (🗜 icon) shows for ~15 seconds (3 poll cycles) before reverting to normal display.

> [!IMPORTANT]
> **Antigravity Internal Summarization**
> The Antigravity IDE has a hardcoded 7500 token "Summarization Threshold" for checkpoint summaries. This can lead to slight discrepancies in token counts for very long conversations once the threshold is crossed. For more details on this behavior, see the [Reddit reference](https://www.reddit.com/r/google_antigravity/comments/1q7zcag/heres_how_to_find_which_mcp_tools_are_leading_to/).

> [!NOTE]
> **Dynamic Sub-Agent Switching**
> When using Claude models, Antigravity may call Gemini 2.5 Flash Lite as a sub-agent for lightweight tasks. Since v1.10.0, Claude 4.6 models also have 1M context limits (GA 2026-03-13), so sub-agent switching no longer causes a visible context limit change.

## ⚙️ Settings

| Setting | Default | Description |
| --- | --- | --- |
| `pollingInterval` | 5 | Polling interval in seconds |
| `contextLimits` | (see defaults) | Override context limits per model |
| `compressionWarningThreshold` | 200000 | Compression warning threshold (tokens). Status bar color is based on this value. |
| `statusBar.showContext` | true | Show context usage (e.g. `45k/1M, 4.5%`) in status bar |
| `statusBar.showQuota` | true | Show current model quota indicator (e.g. `🟢85%`) in status bar |
| `statusBar.showResetCountdown` | true | Show quota reset countdown (e.g. `⏳4h32m`) in status bar |

| `quotaNotificationThreshold` | 20 | Show warning when model quota drops below this % (0 to disable) |
| `activity.maxRecentSteps` | 100 | Max recent activity steps to keep in timeline |
| `activity.maxArchives` | 20 | Max activity archives to keep |

## 🔤 Commands

| Command | Description |
| --- | --- |
| `Show Context Window Details` | Open a QuickPick panel listing all tracked sessions |
| `Refresh Context Window Monitor` | Re-discover the language server and restart polling |
| `Switch Display Language` | Choose between Chinese-only, English-only, or bilingual display |
| `Show Model Activity` | Open the Activity tab in the monitor panel |

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor&type=date&legend=top-left)](https://www.star-history.com/#AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor&type=date&legend=top-left)

---
**Author**: AGI-is-going-to-arrive
**Version**: 1.15.0

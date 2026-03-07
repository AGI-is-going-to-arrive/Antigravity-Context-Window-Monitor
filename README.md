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
> 🪟 **Windows**: Coming soon.

---

## 📚 Technical Details

👉 **[Read the Technical Implementation Guide](docs/technical_implementation.md)**

---

## ✨ Features

* **⚡ Real-Time Token Usage**
    Shows current token consumption in the status bar (e.g. `125k/200k, 62.5%`). Token data comes from model checkpoint values when available, with content-based character estimation between checkpoints (replaces fixed constants since v1.4.0). Fixed constants are only used as fallback when step data structure is missing.

* **🌐 Bilingual Interface**
    Full Chinese/English support across status bar, QuickPick panel, and tooltips.

* **🔒 Multi-Window Isolation**
    Each Antigravity window only shows conversations belonging to its workspace, filtered by workspace URI.

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
    When the language server is unreachable, polling interval increases as `baseInterval × 2^n` (default: 5s → 10s → 20s → 60s), resetting immediately on reconnection.

## 🤖 Supported Models

| Model | Internal ID | Context Limit |
| --- | --- | --- |
| Gemini 3.1 Pro (High) | MODEL_PLACEHOLDER_M37 | 1,000,000 |
| Gemini 3.1 Pro (Low) | MODEL_PLACEHOLDER_M36 | 1,000,000 |
| Gemini 3 Flash | MODEL_PLACEHOLDER_M18 | 1,000,000 |
| Claude Sonnet 4.6 (Thinking) | MODEL_PLACEHOLDER_M35 | 200,000 |
| Claude Opus 4.6 (Thinking) | MODEL_PLACEHOLDER_M26 | 200,000 |
| GPT-OSS 120B (Medium) | MODEL_OPENAI_GPT_OSS_120B_MEDIUM | 128,000 |

*Model IDs are fetched from the local Antigravity language server's `GetUserStatus` API. If new models are added, you can override context limits in IDE settings.*

## 🚀 Usage

1. **Install**:
   * **OpenVSX**: Install directly from [Open VSX Registry](https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor).
   * **Manual**: Install the `.vsix` file via Extensions → Install from VSIX.
2. **Status Bar**: The bottom-right status bar shows current context usage (displays `0k/1000k, 0.0%` for empty chats).
3. **Hover**: Hover over the status bar item for detailed info (model, input/output tokens, remaining capacity, compression status, image gen steps, etc.).

   ![Hover Details](src/images/悬停详情.png)

4. **Click**: Click the status bar item to open a QuickPick panel listing all tracked sessions in this workspace.

   ![Click to View](src/images/点击查看.png)

## ⚠️ Known Limitations

> [!IMPORTANT]
> **Same-Workspace Multi-Window**
> If you open multiple Antigravity windows on the **same folder**, they share the same workspace URI, and session data may overlap.
>
> **Solution**: Open different folders in different windows.

> [!NOTE]
> **Compression Notification**
> The compression notification (🗜 icon) shows for ~15 seconds (3 poll cycles) before reverting to normal display.

> [!NOTE]
> **Default Display for New Conversations**
> When you start a new conversation, the status bar defaults to `0k/1000k, 0.0%` (1000k is the default context limit for Gemini models). The display **only updates after you interact with the model**, as the plugin needs the language server to register the conversation before it can fetch usage data.

## ⚙️ Settings

| Setting | Default | Description |
| --- | --- | --- |
| `pollingInterval` | 5 | Polling interval in seconds |
| `contextLimits` | (see defaults) | Override context limits per model |

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor&type=date&legend=top-left)](https://www.star-history.com/#AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor&type=date&legend=top-left)

---
**Author**: AGI-is-going-to-arrive
**Version**: 1.6.0

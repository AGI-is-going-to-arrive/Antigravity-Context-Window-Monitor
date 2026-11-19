# 🌌 Antigravity Context Window Monitor

A plugin built for **Antigravity IDE** that provides real-time monitoring of context window usage across all your chat sessions.

**[🇨🇳 中文文档 / Chinese Documentation](readme_CN.md)**

---

> [!WARNING]
> **Platform Support**
>
> 🍏 **macOS**: Supported. Discovers both the current `agy` hub and legacy language servers using `ps`, declared hub ports, and `lsof`.
>
> 🐧 **Linux**: Supported since v1.6.0. Uses `ps` with `lsof`/`ss` fallback for process discovery. Earlier platform testing covered Ubuntu 22.04 (x64 & ARM64).
>
> 🪟 **Windows**: Fully supported (v1.8.0+). Optimized discovery with `wmic` caching and PowerShell fallbacks.
>
> 🐧🪟 **WSL**: Fully supported (v1.12.0+). Detects WSL environment via `/proc/version` and uses Windows-side tools through WSL interop for LS discovery. v1.12.1 adds `extensionKind: ["ui", "workspace"]` so the extension runs on the local Windows host when connected via Remote-WSL or Remote SSH. v1.13.0 adds **Remote-WSL LS discovery** — when connected to a WSL workspace, the extension discovers the `language_server_linux_x64` process running inside the WSL distro via `wsl -d <distro>`, connects to it through WSL2 port forwarding, and displays the correct context data.

---

**1.17.2** redesigns the status bar hover and adds an Overview for context, model quota, resets, and AI credits. It also adds **Orchestrator (Neon)** and all four **Gemini 4 Neon** effort levels. [Release notes and validation](docs/releases/1.17.2.md)

**Validation:** GitHub build/test CI was disabled and removed at the maintainer's request on 2026-11-13. Local `npm run compile`, `npm test`, and installed-IDE validation remain available. Historical failed/cancelled CI runs are not passing checks for the current build.

## 📚 Technical Details

👉 **[Read the Technical Implementation Guide](docs/technical_implementation.md)**

---

## ✨ Features

* **⚡ Real-Time Token Usage**
    The status bar shows a compact reading such as `125k/200k`. Overview adds the percentage, remaining capacity, and measurement source. The monitor prioritizes provider-reported fresh input, cache reads, cache creation, and output tokens from planner responses or legacy checkpoints. It labels estimates and refreshes running responses while they stream.

* **Status Bar Summary**
    Hover to see connection and conversation state, context use, the account plan, and shared model quotas. Open Overview, Models, or Settings from the hover. The plan summary refreshes with the current account data.

* **🌐 Language Switching**
    Users can choose between Chinese-only, English-only, or bilingual display mode. Accessible from the details panel: click status bar → Settings → Switch Language. Preference is persisted via `globalState` across sessions.

* **🔒 Multi-Window Isolation**
    Each Antigravity window prefers conversations from its own workspace, filtered by workspace URI. If Antigravity keeps reporting a stale workspace after you switch projects, the monitor can follow the currently RUNNING conversation from the shared language server instead of going blank. Windows without a workspace folder show all conversations.

* **🗜️ Context Compression Detection**
    The monitor detects large drops in cache-inclusive checkpoint input or comparable measured context. Open **Session diagnostics** in Overview to see the drop and available before/after readings.

* **⏪ Undo/Rewind Support**
    When you undo a conversation step, the plugin detects the `stepCount` decrease and recalculates token usage to reflect the rollback.

    | Before Undo | After Undo |
    | :---: | :---: |
    | ![Before Undo](src/images/回退前.png) | ![After Undo](src/images/回退后.png) |

* **🔄 Dynamic Model Switching**
    When switching models mid-conversation, the context window limit automatically updates to match the new model. Since v1.4.0, model display names are dynamically fetched via the `GetUserStatus` API.

* **🎨 Image Generation Tracking**
    The monitor follows image-generation steps and identifies the image model when the IDE reports it. Open **Session diagnostics** for image activity and the Models tab for the image catalog.

* **🛌 Exponential Backoff Polling**
    When the language server is unreachable, polling interval increases as `baseInterval × 2^n` with dual caps: discovery failures cap at 15s (5s → 10s → 15s) for fast LS detection, RPC failures cap at 60s. Resets immediately on reconnection.

* **📊 WebView Monitor Panel**
    Click the status bar to open Overview. The panel also provides session and call details, cost, full model information, account profile, and settings. The profile displays the account plan and tier, Prompt/Flow credits, model quotas, feature flags, team configuration, and Google AI credits using the existing `GetUserStatus` data.
    * **🛡️ Privacy Mask**: A shield button in the panel header masks your name and email. The toggle state persists across panel refreshes.
    * **📂 Collapsible Sections**: Secondary info (Plan Limits, Feature Flags, Team Config, Google AI Credits) is collapsed by default. Expand/collapse state persists.

* **⚙️ Interactive Settings Dashboard**
    The Settings tab lets you configure polling, quota warnings, status bar content, interface zoom, and panel display preferences directly from a GUI.
    * **Status bar display**. Set context usage, current-model quota, reset countdown, and AI credits independently. The readouts use IDE icons and dot separators.
    * **Hover density**. In the monitor's Settings tab choose Automatic, Compact, or Full. Automatic uses the IDE zoom, quota pool count, and display language to select a summary size.
    * **📆 Per-Account Billing Day** *(v1.16.7)*: Set monthly credits-expiry day per account (1-31) inline on the Profile tab. Profile, account panel and status bar tooltip all show a countdown badge ("Expires today / Xd until expiry / Expiry date not set"). Stored in durable JSON state — survives uninstall/reinstall. Uses UTC calendar-day delta so the countdown is correct across DST transitions.
    * **⏸️ Pause/Resume**: Pause auto-refresh to freeze the panel while investigating data.

* **🧠 Model Activity Monitor** *(v1.11.2, enhanced through v1.16.4)*
    New Activity tab tracks real-time AI reasoning calls, tool usage, tokens, and timing per model across all conversations. Access via the main status bar item or the `Show Model Activity` command.
    * **🔧 Tool Name Display** *(v1.11.3)*: Timeline entries show the tool name (e.g., `view_file`, `gh/search_issues`) with step index badges.
    * **📚 Tool Catalog Cleanup** *(v1.16.4)*: GM Data shows a collapsible tool catalog with smart chip tooltips and a clear button for removing stale catalog entries without touching tool ranking counts.
    * **⚡ Independent Activity Polling** *(v1.11.3)*: Activity tracking runs on a separate 3-second polling loop, decoupled from the global 5-second poll for faster updates.
    * **🎯 Three-Layer Quota Detection** *(v1.12.2)*: Instant detection via elapsed-in-cycle comparison, drift-based detection via resetTime observation, and fraction-based detection. No more hardcoded cycle lengths — adapts to any quota cycle automatically.
    * **🔀 Archive Debounce** *(v1.12.2)*: Cross-pool resets within 5 minutes are merged into a single archive entry, preventing fragmentation.
    * **💾 Persistence**: Activity stats survive VS Code restarts via `globalState`. Throttled to max once per 30s.
    * **📋 Auto-Archive**: When model quota resets, current activity is automatically archived to history with source tracking (`triggeredBy`), giving per-cycle usage reports.
    * **📊 Estimated Steps**: When conversations exceed the LS API's ~500 step window, additional steps are tracked as estimated counts with clear `📊` markers.
    * **⚠️ Low Quota Notification**: Warning popup when any model's remaining quota drops below a configurable threshold (default 20%).

## 🤖 Supported Models

The Models tab follows the signed-in account's live chat picker and its separate image-generation catalog. Registration preserves historical identities; it does not grant access or assume every account has the same models.

### Orchestrator

The IDE exposes **Orchestrator (Neon)** `M537`, **Orchestrator (Carbon)** `M667`, and **Orchestrator (Argon)** `M681`. Each has one picker entry and a configured route to the hidden `M669` / `gemini-flash-worker-agy` worker. Model Info shows that route. Actual coordinator and worker calls retain separate accounting identities. The legacy bare **Orchestrator** name remains a Carbon alias for history and custom pricing.

### Current IDE model metadata

The signed-in IDE catalog on 2026-11-19 exposed **27 chat entries**, including 24 effort variants and three Orchestrator entries. Values below describe the IDE. “Compression limit” and “checkpoint threshold” are separate settings.

| Chat model | Tiers and internal IDs | Model context | Max output | Compression limit | Checkpoint threshold |
| --- | --- | ---: | ---: | ---: | ---: |
| Orchestrator (Neon) | `M537` | 1,048,576 | 262,144 | 512,000 | 50,000 |
| Orchestrator (Carbon) | `M667` | 1,048,576 | 262,144 | 512,000 | 50,000 |
| Orchestrator (Argon) | `M681` | 1,048,576 | 65,536 | 512,000 | 50,000 |
| Gemini 4 Neon | Low / Medium / High / Extra (`M534` / `M533` / `M532` / `M535`) | 1,048,576 | 262,144 | 512,000 | 50,000 |
| Gemini 4 Hydrogen | Low / Medium / High / Extra: `M527` / `M526` / `M525` / `M528` | 1,048,576 | 262,144 | 512,000 | 50,000 |
| Gemini 4 Carbon | Low / Medium / High: `M438` / `M437` / `M427` | 1,048,576 | 262,144 | 512,000 | 50,000 |
| Gemini 4 Argon | Low / Medium / High: `M419` / `M418` / `M417` | 1,048,576 | 65,536 | 512,000 | 50,000 |
| Gemini 3.8 Flash | Low / Medium / High: `M320` / `M319` / `M318` | 1,048,576 | 65,536 | 256,000 | 50,000 |
| Claude Opus 5.5 | Low / Medium / High: `M400` / `M401` / `M402` | 1,000,000 | 128,000 | 256,000 | 50,000 |
| Claude Sonnet 5.5 | Low / Medium / High: `M403` / `M404` / `M405` | 1,000,000 | 128,000 | 256,000 | 50,000 |
| GPT-OSS 120B | Medium: `MODEL_OPENAI_GPT_OSS_120B_MEDIUM` | 131,072 | 32,768 | 80,000 | 50,000 |

`Mxxx` abbreviates `MODEL_PLACEHOLDER_Mxxx`. Neon and Hydrogen use `gemini-4-neon-{low,medium,high,xhigh}` and `gemini-4-hydrogen-{low,medium,high,xhigh}`. In the picker, **Extra** corresponds to backend **XHigh**. Both families report thinking levels 1 / 2 / 3 / **100**. The single `gemini-pro-orchestrator-neon` entry reports thinking level **100**. A reported minimum budget describes a model capability. The monitor displays a fixed per-request budget only when the IDE reports one. Live limits take precedence over static defaults.

Tier identities stay distinct across English and Chinese labels, context tracking, GM data, and saved usage. A known effort survives a family-only response label. The quota representative follows the current model, the live recommendation, then the available generation and family order.

Malformed names such as `Gemini 4 CarbonHigh`, unmatched parentheses, and unsupported effort names do not acquire Carbon's identity or family price. Conflicting learned aliases cannot overwrite a registered tier through uppercase or Chinese label variants.

**Model Quota** groups this catalog into **Gemini** (20 entries) and **Claude / GPT** (seven entries). Gemini includes the Neon and Hydrogen families, Carbon, Argon, Flash, and all three Orchestrators. The catalog-only worker also shares the Gemini allowance. A pool with differing readings displays a range and per-model details. Unknown and image-generation identities have separate quota entries. **Model Info**, call statistics, and pricing retain individual model identities.

### Image-generation model

The IDE's `imageGenerationModelIds` list identifies **Gemini 3.1 Flash Image (Nano Banana 2)** separately from the chat picker.

| Model | Internal ID | Catalog ID | IDE model context | IDE max output | Chat compression/threshold |
| --- | --- | --- | ---: | ---: | --- |
| Gemini 3.1 Flash Image | `MODEL_PLACEHOLDER_M21` | `gemini-3.1-flash-image` | 65,536 | 65,536 | Not applicable |

The Models tab shows a separate **Image generation models** section. Image capability comes from the explicit catalog list, not a model merely accepting image input. The IDE reports no chat checkpointer or independent image quota for this entry, so no chat compression limit or shared chat allowance is invented. Thinking is labeled **Not reported by IDE** when the local catalog omits that capability, rather than being declared unsupported.

The [public Gemini API model page](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image) lists 131,072 input and 32,768 output tokens for the public image API. These differ from the installed IDE's 65,536 / 65,536, so cards use **Model context** and identify the IDE as the source.

The monitor follows image-generation steps in the current workflow and its linked subagents, with traversal limits and duplicate/cycle protection. It preserves the parent chat model and context; child text calls and missing image billing data are not presented as image-model token usage.

### Historical compatibility

Older Gemini Flash/Pro, Claude 4.6, and renamed/retired placeholders remain registered for accounts that expose them and for saved history. For example, Gemini 3.6 `M264` / `M265` / `M266` still resolve alongside current `M71` / `M72` / `M73`. Catalog-only `M322` and older Flash generations retain their historical profiles. Model availability follows live account data, without subscription-name or date-based hiding rules.

### API-equivalent pricing

Gemini 4 Neon and the Orchestrator models show **Price unavailable** until a verified standalone rate or a custom price is available.

[Gemini 4 Hydrogen Standard API prices](https://aistudio.google.com/docs/pricing#gemini-4-hydrogen), verified 2026-11-13, are **$1.50 input / $7.50 output including thinking / $0.075 implicit cache reads per million tokens** for all four efforts. Explicit caching is unsupported. Hydrogen has an independent fixed reference rate; Carbon/Argon introductory rates and their December cutover do not apply. Custom family/tier overrides keep precedence. Account-specific display-name changes retain a known model's verified built-in rate while explicit custom display-name prices still win.

The built-in Google Standard API rates for [Gemini 4 Carbon](https://aistudio.google.com/docs/pricing#gemini-4-carbon) (verified 2026-11-11) and [Gemini 4 Argon](https://ai.google.dev/gemini-api/docs/pricing#gemini-4-argon) apply to all three effort tiers, in USD per million tokens:

| Call date (UTC) | Input | Output, including thinking | Implicit cache reads |
| --- | ---: | ---: | ---: |
| Through 2026-11-30 | $2.00 | $10.00 | $0.10 |
| From 2026-12-01 | $4.00 | $20.00 | $0.20 |

Pricing uses each call's UTC timestamp, so historical calls retain their applicable rate across the December cutover. Saved archival costs and custom overrides are preserved. Carbon and Argon have separate pricing identities and family/tier overrides even though their published rates match. Both support implicit caching only; no explicit cache-write fee is added. Unknown models retain **Price unavailable** instead of being treated as free. These are Standard API reference estimates, separate from Antigravity subscription charges and credits; Batch, Flex, and Priority prices are not used.

For image generation, [Google's Standard API reference](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.1-flash-image) is $0.50/1M input tokens, $3/1M text/thinking output tokens, and $60/1M image-output tokens. The published image-output equivalents are $0.045 / $0.067 / $0.101 / $0.151 for 512 px / 1K / 2K / 4K images. The real IDE image test returned no separate M21 token, credit, or GM usage. The Cost tab therefore labels observed amounts as **known subtotals that exclude image-generation fees**, with a link to the official reference; image generation is not treated as free. See the [release validation](docs/releases/1.16.19.md#validation).

The [official Claude 5.5 API prices](https://platform.claude.com/docs/en/about-claude/pricing) are listed below as a reference, in USD per million tokens (2026-10-03):

| Model | Input | Output | Cache read | Cache write, 5 min | Cache write, 1 hour |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 | $4 | $20 | $0.20 | $5 | $8 |
| Claude Sonnet 5.5 | $2 | $10 | $0.20 | $2.50 | $4 |

The built-in cache-write reference rate is for **5 minutes**. Current cost estimates exclude cache creation fees because telemetry does not reliably identify creation tokens and their TTL; 1-hour cache-write fees are not added automatically either. Reported cache-read tokens are included. These are local API-equivalent estimates, not Antigravity subscription charges.

Gemini 3.8 Flash uses the same introductory price as 3.7 Flash: **$0.75 / 1M input tokens** and **$3.75 / 1M output tokens** through 2026-12-31; from 2027-01-01 the rates become $1.50 / $7.50. Sources: [Google Antigravity launch post](https://antigravity.google/blog/gemini-3-8-flash-in-google-antigravity) and [Google model announcement](https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/).

## 🚀 Usage

1. **Install**:
   * **OpenVSX**: Install directly from [Open VSX Registry](https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor).
   * **Manual**: Install `antigravity-context-monitor-1.17.2.vsix` via Extensions → Install from VSIX, then reload the window and confirm version **1.17.2** in extension details.
2. **Status Bar**: The bottom-right status bar shows current context usage. With no active conversation it shows **No active conversation**, rather than a saved model's old limit. The selected effort tier is recognized from the user-input configuration before the first model response.
3. **Hover for a summary**. Check the current session, context usage, shared quota and reset times. The hover links take you directly to Overview, Models, and Settings.

4. **Click to open Overview**. Check context, quota, reset times, and AI credits together, then open the relevant detailed view.

   **Overview** — Session and connection status, measured or estimated context usage, session diagnostics, shared quotas, reset times, and AI credits.

   ![Bilingual Overview in a dark theme with example context and quota readings](src/images/monitor-overview.png)

   **GM Data** — Detailed per-model token usage, call counts, cache hit rates, retry statistics, tool ranking, and a collapsible tool catalog.

   ![GM Data Tab](src/images/gmdata1.png)

   ![GM Data Tab - Details](src/images/gmdata2.png)

   **Sessions** — Browse all conversation sessions with context usage, step counts, and model info.

   ![Sessions Tab](src/images/session.png)

   **Cost** — Monthly cost breakdown with per-model pricing, cost overview visualization, and a custom pricing editor for called models plus built-in default pricing models.

   ![Cost Tab](src/images/cost.png)

   **Models** — Gemini and Claude / GPT shared-pool cards summarize quota/reset information and list their available families/efforts; Model Info keeps individual chat effort tiers and a separate image-generation catalog. Information cards distinguish IDE-reported model context, maximum output, compression limits, checkpoint thresholds, and thinking state. Image compression settings display Not applicable. The layout supports narrow panels, light/dark/high-contrast themes, and English, Chinese, or bilingual display.

   ![Earlier v1.16.20 example: shared quota pools and Carbon model information](src/images/model.png)

   The 80% quota shown in this screenshot is example data.

   **Calendar** — Historical usage data organized by date, with per-cycle cost and token breakdowns.

   ![Calendar Tab](src/images/日历_全部.png)

   **Profile** — Account information, plan details, and credit balances.

   ![Profile Tab](src/images/profile.png)

   **Settings** — Configure extension behaviors: low-quota warning threshold, status bar toggles, polling interval, and more.

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
> When using Claude models, Antigravity may call its lightweight sub-agent model for small tasks — the platform labels that model **Gemini Flash Lite** (`MODEL_PLACEHOLDER_M50`; the display name follows the IDE catalog). Sub-agent switching does not change the displayed context limit, because the extension tracks the limit of the model you selected. Claude 5.5 uses a 1,000,000-token IDE-reported model context and 256,000-token platform compression limit (verified 2026-10-03); retained Claude 4.6 profiles use 250,000 and 160,000 respectively, while the sub-agent uses the 128,000 profile.

> [!IMPORTANT]
> **"LS not found" in the current Antigravity IDE**
> Newer IDE builds run an `agy --hub` backend instead of a process named `language_server_*`. Since version 1.16.19, the monitor discovers both architectures, accepts `--csrf_token=value` and space-separated flags, and checks the declared hub port before using platform socket discovery. Install `antigravity-context-monitor-1.17.2.vsix` and reload the window. If the connected backend has no loaded conversations, the monitor displays **No active conversation**. Saved history may still exist in the IDE, and the backend can be available with no folder open.
>
> **Windows discovery diagnostics**
> If the status bar is stuck on `LS not found`, open **Output → "Antigravity Context Monitor"** and read the `PATH check:` line — the extension now logs exactly which discovery step failed. Since v1.16.13 it invokes `wmic`/`powershell.exe`/`netstat` by absolute `%SystemRoot%` path, so a truncated Extension Host `PATH` (e.g. missing `System32\wbem` on Win11 24H2+ where WMIC is removed) no longer breaks discovery.
> Since v1.16.16 two further causes are handled (issue #64, reported by @SecretLUL): Windows localizes the `netstat` State column, so on a German install `LISTENING` reads `ABHÖREN` and every candidate line used to be rejected; and a language server listening on all interfaces rather than on loopback used to yield no port at all. Both are fixed, and if the extension host itself runs inside WSL it now looks for the language server in that distro first.
> **Do not run Antigravity as Administrator** — it does not help detection (LS discovery needs no elevation) and can crash the IDE at launch with `The window terminated unexpectedly (reason: 'launch-failed', code: '18')`, an Electron/Chromium sandbox issue unrelated to this extension.

## ⚙️ Settings

| Setting | Default | Description |
| --- | --- | --- |
| `pollingInterval` | 5 | Polling interval in seconds |
| `statusBar.showContext` | true | Show context usage such as `45k/1M` |
| `statusBar.showQuota` | true | Show the current model's quota percentage |
| `statusBar.showResetCountdown` | true | Show the current model's reset countdown |
| `statusBar.tooltipDensity` | auto | Adjust hover density with `auto`, `compact`, or `full` |
| `quotaNotificationThreshold` | 20 | Show warning when model quota drops below this % (0 to disable) |
| `activity.maxRecentSteps` | 100 | Max recent activity steps to keep in timeline |
| `activity.maxArchives` | 20 | Max activity archives to keep |

## 🔤 Commands

| Command | Description |
| --- | --- |
| `Show Context Window Details` | Open the monitor Overview |
| `Refresh Context Window Monitor` | Re-discover the language server and restart polling |
| `Switch Display Language` | Choose between Chinese-only, English-only, or bilingual display |
| `Show Model Activity` | Open the GM Data tab in the monitor panel |

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor&type=date&legend=top-left)](https://www.star-history.com/#AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor&type=date&legend=top-left)

## 🔗 Friendly Links

- [LINUX DO](https://linux.do/)

---
**Author**: AGI-is-going-to-arrive
**Version** 1.17.2 — [Release notes](docs/releases/1.17.2.md)

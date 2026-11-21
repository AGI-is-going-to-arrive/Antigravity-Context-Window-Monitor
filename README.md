# Antigravity Context Window Monitor

Monitor conversation context, Orchestrator & Executor routing, dual-window model quotas (`5h` + `Weekly`), generation speed (`tok/s`), TTFT & prompt cache efficiency, dual-currency API-equivalent costs (`USD` / `CNY`), reset times, and AI credits in Antigravity IDE.

**1.17.3** fixes backend discovery against `agy` v1.5.14+ (resolving `上下文: 不可用` / `GetUnleashData` removal), adds full **Custom Orchestrator Mode & Orchestrator Settings** support (including **Orchestrator Claude Opus 5.5**, cross-pool `Planner → Executor` tracking, selectable thinking levels with `Extra High` aligned across Neon & Hydrogen, and 512K checkpointer limits), introduces **Dual-Window Quota (`5-Hour` + `Weekly`)**, updates **official model pricing** (adding **Gemini 4 Neon** `$3/$15/$0.15`, fixing **Claude Sonnet 5.5** cache read `$0.20 → $0.10`, adding bounded **Gemini 3.6 Flash** promo dates, and adding offline-first **USD / CNY / Both** dual-currency display with rate-change countdowns), and overhauls the **Status Bar Hover Tooltip** plus the collapsible **Recent Calls Ledger** in **GM Data**.

[中文文档](readme_CN.md) · [1.17.3 release notes and validation](docs/releases/1.17.3.md) · [Technical guide](docs/technical_implementation.md) · [Project structure](docs/project_structure.md) · [Changelog](CHANGELOG.md)

## Highlights in 1.17.3

- **Backend discovery fix (`agy` v1.5.14+ / `上下文: 不可用`):** Replaces the single-endpoint `GetUnleashData` health check with a multi-endpoint CSRF probe (`GetStatus → GetUnleashData → GetUserStatus`), adds `daemon/hub_<port>.json` & direct-hint fallback without aborting on `GetUnleashData` 404s, hardens cross-platform loopback handling across macOS, Windows, Linux, WSL, and IPv6 (`[::1]` / `127.0.0.1`), and reconnects immediately when the backend restarts.
- **Orchestrator & Orchestrator Settings (`Orchestrator Claude Opus 5.5` & cross-pool routing):** Reads live global **Orchestrator Settings** (`Orchestrator Model` + `Executor Model` via Connect-protocol `JetboxSubscribeToState` and Mendel `orchestrator-model-roles` flags), supports selectable thinking levels across all Orchestrator & Executor models (aligning **`Extra High`** across both Gemini 4 Neon and Gemini 4 Hydrogen), tracks cross-pool `Planner → Executor` pairings (e.g. `Claude Opus 5.5 + Gemini 4 Hydrogen` or `Gemini 4 Neon + Claude Sonnet 5.5`) across **Overview**, **Models**, and the hover tooltip, unifies **512K (`512,000`)** live checkpointer limits across all Gemini 4 & Orchestrator models, adds `M669` (`Gemini 4 Hydrogen (Orchestrator)`) + `M530`/`M531`/`M578` support, and surfaces the **GPT-OSS 120B** `Notice` sunset tag.
- **Official model pricing & offline-first dual currency (`USD` / `CNY` / `USD + CNY`):** Adds verified official **Gemini 4 Neon** pricing (`$3.00` input / `$15.00` output & thinking / `$0.15` cache read per 1M tokens, flat across the full 1M context, with automatic zero-cost reconciliation/backfill), fixes **Claude Sonnet 5.5** cache read (`$0.20 → $0.10`), adds the bounded **Gemini 3.6 Flash** promotional schedule (`[2026-08-13, 2027-01-01)`), adds an offline-first currency switcher (`USD`, `CNY`, or `Both`) with a configurable reference FX rate (default `7.2`, zero external network requests), displays **Upcoming Scheduled Rate Changes** banners (Carbon/Argon `2026-12-01`, Flash `2027-01-01`), preserves strict unpriced guards (`M537`/`M667`/`M681`/`M669`/`M578`/`M21` never fabricate `$0.00`), and shows API reference prices on **Models** spec cards.
- **Dual-Window Quota (`5-Hour` + `Weekly`):** Fetches live 5-hour and weekly quota buckets via `RetrieveUserQuotaSummary` (with graceful 5h-only fallback on older backends) and renders both windows consistently across **Overview**, **Models**, **Profile**, and the **Hover Tooltip** (with floored high-percentage precision so `99.3%`–`99.9%` never falsely rounds to `100%`).
- **Overhauled hover tooltip & collapsible Recent Calls Ledger:** Introduces priority-tiered, zoom-aware section budgeting (`compact` / `auto` / `full`) that protects **Quota remaining** and the pinned footer at every zoom level; adds a **Latest Call** micro-table (Fresh In / Out / Think / Cache Hit % / Cost / TTFT & Total Latency / noise-gated Speed / Status), Session & Today Cost + Cache Savings + Effective Blended Input Rate, **Orchestrator Split** (Planner vs Executor calls & cost), event-driven alerts (14-day rate-cutover countdown, GPT-OSS `Notice` sunset, Retry Waste, AI credits), 1-click trusted footer links (`Overview · Activity · Cost · Models · Settings · Refresh`), an opt-in status bar session cost pill (`statusBar.showSessionCost`), and a collapsible **Recent Calls Ledger** (latest 20 calls) in **GM Data**.

## Install

1. Get `antigravity-context-monitor-1.17.3.vsix` from the release assets or build it locally with `npm run package`. [GitHub Releases](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/releases)
2. In Antigravity IDE, open the Command Palette with `Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows and Linux. Run **Extensions: Install from VSIX...** and select the file.
3. Reload the window. Confirm **1.17.3** in extension details or the monitor's **About** page.

You can also install the published registry version from [Open VSX](https://open-vsx.org/extension/AGI-is-going-to-arrive/antigravity-context-monitor).

The extension supports macOS, Windows, Linux, and WSL. Native IDE checks for 1.17.3 ran on macOS; the release notes separate native checks from mocked Windows and Linux branch tests. [Validation](docs/releases/1.17.3.md#validation)

## Use the monitor

- **Hover over the bottom-right status item** for the active session and model (or cross-pool **Orchestrator `Planner → Executor`** route), context gauge with used/remaining tokens, **Latest Call** telemetry (input/output/thinking tokens, cache hit %, cost, TTFT / total latency, and noise-gated decode speed), **Session & Today Cost** with cache savings & effective blended input rate, **Orchestrator Split**, **Dual-Window (`5h` + `Weekly`) Quota** with Planner/Executor pool markers, smart event-driven alerts (rate-cutover countdown, model sunset notice, retry waste, AI credits), and 1-click links to **Overview**, **Activity**, **Cost**, **Models**, **Settings**, and **Refresh**. Choose **Automatic**, **Compact**, or **Full** in Settings; enable opt-in **Generation speed (`tok/s`)**, **Prompt cache hit rate (`%`)**, or **Session cost** in the status bar (all hidden automatically when no live data exists).
- **Click the status item** to open **Overview**. Use the sticky header controls to inspect multi-account snapshots (**Account Panel**), switch between Chinese, English, and bilingual display, pause live polling, or refresh manually.
- **Expand Session diagnostics** for provider-reported token counts, compression events, and image activity. The monitor distinguishes measured values from estimates, updates streaming responses in place, and recalculates context on undo or a model switch.

## Monitor views

The panel adapts cleanly from `320px` narrow split-panes to `1440px` wide editor tabs, follows IDE Light, Dark, and High-Contrast themes, and meets WCAG 2.1 AA contrast standards. Screenshots below use example data and showcase the **Obsidian Slate Dark** theme in bilingual mode.

### Overview

See the active conversation, active **Orchestrator `Planner → Executor`** cross-pool route pill, context used and remaining tokens, the recessed 4–5 cell L2 telemetry strip (generation speed `tok/s`, adaptive TTFT, token-weighted cache hit rate, estimated cache savings, and Session / Today cost in your chosen currency), collapsible session diagnostics, dual-window (`5h` + `Weekly`) shared quota pools with semantic health meters and reset timers, and the AI credits footer.

![Overview in Obsidian Slate Dark mode showing active context, Orchestrator route pill, L2 speed/TTFT/cache/cost strip, dual-window quota pools, and AI credits](src/images/monitor-overview.png)

<details>
<summary>GM Data — speed, TTFT, prompt cache ledger, Recent Calls Ledger, and timeline</summary>

Inspect real-time Generator Metadata by model and session, including the account-filtered KPI strip, the 2-column **Speed & First-Token Cache Ledger** (weighted/latest/median/visible `tok/s`, **Cached vs Uncached TTFT** comparison bars, and a 3-segment Prompt Cache bar with warmth state & estimated savings), the collapsible **Recent Calls Ledger** (latest 20 calls with Time, Actual Model, Fresh Input, Output w/ Think %, Cache Hit %, Cost / Unpriced, TTFT, Total Latency, noise-gated Speed, and Status), unified per-model stats cards, per-step/per-turn timeline telemetry pills, today's ledgers, tool call ranking, context growth chart, and error details.

![GM Data in Obsidian Slate Dark mode showing KPI strip, Speed & First-Token Cache Ledger, Recent Calls Ledger, and model stats](src/images/monitor-gm-data.png)

</details>

<details>
<summary>Sessions — searchable conversation history</summary>

Browse conversation context and history grouped by workspace. Filter by current workspace, repository, running state, or backup availability, and reveal local workspace, Brain, or `.pb` files.

![Sessions in Obsidian Slate Dark mode showing workspace groups, search, and localized status badges](src/images/monitor-sessions.png)

</details>

<details>
<summary>Cost — dual-currency estimates, rate-change alerts, and custom API rates</summary>

Review monthly and daily usage estimates in **USD**, **CNY**, or **Both** using the inline currency toolbar and offline reference FX rate, inspect total & per-model cache savings, thinking cost share, 4-series cost distribution (input, output, cache, thinking), and **Upcoming Scheduled Rate Changes** banners (Carbon/Argon `2026-12-01`, Flash `2027-01-01`). Set custom rates per 1M tokens for any family or individual model; unpriced usage is flagged honestly without fabricating `$0.00`.

![Cost in Obsidian Slate Dark mode showing dual-currency controls, upcoming rate-change banner, 4-series chart, and custom pricing table](src/images/monitor-cost.png)

</details>

<details>
<summary>Models — Orchestrator Settings, dual-window quota pools, and model specifications</summary>

Inspect live **Orchestrator Settings** (`Orchestrator Model` + `Executor Model`, default vs custom pairing, and cross-pool role indicator), the default model, merged Gemini and Claude / GPT **Dual-Window (`5h` + `Weekly`)** quota pools, reset schedules, available families & effort tiers (`Low` / `Medium` / `High` / `Extra High`), API reference pricing rows on spec cards, `Notice` sunset tags (e.g. GPT-OSS 120B), and full IDE-reported model specifications. Chat models and the image-generation catalog are presented separately.

![Models in Obsidian Slate Dark mode showing Orchestrator Settings, dual-window quota pools, API reference prices, and 512K Gemini 4 specs](src/images/monitor-models.png)

</details>

<details>
<summary>Calendar — daily usage, dual-currency totals, archived speed/TTFT/cache, and cycles</summary>

Switch between **Monthly** and **All-Time** summaries, browse daily activity and dual-currency cost chips on the interactive 7-column calendar, and expand any day to inspect per-model totals, archived generation speed (`tok/s`), adaptive TTFT, token-weighted prompt cache hit rate, and archived cycles.

![Calendar in Obsidian Slate Dark mode showing monthly summary, dual-currency totals, and daily activity grid](src/images/monitor-calendar.png)

</details>

<details>
<summary>Profile — plan, dual-window shared quotas, AI credits, and account settings</summary>

Review account identity (masked by default with a one-click privacy toggle), current plan, dual-window (`5h` + `Weekly`) shared model quota pools, amber `Notice` tags for sunsetting models, Google AI credits (labeled **Not reported** when absent), per-account monthly credit expiry day, and collapsible plan limits, feature flags, and team configuration.

![Profile in Obsidian Slate Dark mode showing masked account identity, dual-window shared quotas, and AI credits](src/images/monitor-profile.png)

</details>

<details>
<summary>Settings — persistent storage, polling, currency display, and status bar</summary>

Inspect external persistent storage, configure the low-quota warning threshold, polling interval, seven status bar toggles (including opt-in generation speed `tok/s`, prompt cache hit rate `%`, and **Session cost** with live currency preview), **Currency Display** (`USD` / `CNY` / `Both` + offline reference USD/CNY rate), hover density (`auto` / `compact` / `full`), internal model ID display, interface zoom, and scrollbar / end-of-content preferences.

![Settings in Obsidian Slate Dark mode showing status bar switches, Currency Display card, and persistent storage](src/images/monitor-settings.png)

</details>

<details>
<summary>About — version, compatibility, and navigation</summary>

Confirm the installed extension version (`v1.17.3`, dynamically read from the extension manifest) and 512K context compatibility scope, jump directly to any monitor view via the feature navigation directory, and access repository and compatibility notes.

![About in Obsidian Slate Dark mode showing version 1.17.3 and feature navigation cards](src/images/monitor-about.png)

</details>

## Models, context, and cost

- The signed-in account's live catalog determines model availability. The status bar hover and **Overview** count verified thinking-effort variants once per base-model family; **Models**, **GM Data**, and **Cost** retain each effort's exact ID.
- **Orchestrator & Gemini 4 family:** All **Gemini 4** families (**Neon**, **Hydrogen**, **Carbon**, **Argon**) and **Orchestrator** models (`M537`, `M667`, `M681`, `M669`) use the unified **512,000-token** live checkpointer limit (`1,048,576` model context, `262,144` max output). Both **Gemini 4 Neon** and **Gemini 4 Hydrogen** expose `Low` / `Medium` / `High` / `Extra High` thinking tiers. Under **Custom Orchestrator Mode**, any eligible Orchestrator model (including **Claude Opus 5.5** and **Gemini 4 Neon**) can pair with any eligible Executor model (such as **Gemini 4 Hydrogen** or **Claude Sonnet 5.5**), with each leg billed to its own actual model and tracked across quota pools.
- **Verified built-in API-equivalent pricing (USD per 1M tokens, verified 2026-11-22):**

| Model Family | Input | Output / Thinking | Cache Read | Cache Write | Notes / Schedule |
| --- | ---: | ---: | ---: | ---: | --- |
| **Gemini 4 Neon** (`Low`–`Extra High`) | `$3.00` | `$15.00` | `$0.15` | `$0` | Flat across 1M context; implicit cache reads |
| **Gemini 4 Hydrogen** (`Low`–`Extra High`, `M530`/`M531`) | `$1.50` | `$7.50` | `$0.075` | `$0` | Flat across 1M context; `M578` Sonar unpriced |
| **Gemini 4 Carbon / Argon** | `$2.00` → `$4.00` | `$10.00` → `$20.00` | `$0.10` → `$0.20` | `$0` | Intro rate ends `2026-12-01` UTC (`2×` standard) |
| **Claude Opus 5.5** (`Low`–`High`) | `$4.00` | `$20.00` | `$0.20` | `$5.00` | 5-minute TTL cache write |
| **Claude Sonnet 5.5** (`Low`–`High`) | `$2.00` | `$10.00` | `$0.10` | `$2.50` | Fixed cache read rate (`$0.10`); 5-min TTL write |
| **Gemini 3.8 / 3.7 / 3.6 Flash** | `$0.75` → `$1.50` | `$3.75` → `$7.50` | `$0.075` → `$0.15` | `$0.9375` → `$1.875` | Promo ends `2027-01-01` UTC (3.6 bounded from `2026-08-13`) |
| **GPT-OSS 120B (Medium)** | `$0.09` | `$0.36` | `$0` | `$0` | Displays IDE `Notice` sunset badge when reported |
| **Legacy Orchestrators & Image** (`M537`/`M667`/`M681`/`M669`/`M578`/`M21`) | Unpriced | Unpriced | Unpriced | Unpriced | Never fabricated as `$0.00`; set custom overrides in **Cost** |

- Context readings prioritize provider-reported fresh input, cache reads, cache creation, and output from the current planner response or checkpoint. Undated historical calls on scheduled-cutover models remain honestly unpriced rather than fabricating current-date rates. Subscription AI credits are tracked separately (unknown readings display **Not reported** instead of `0`). [Model and pricing details](docs/technical_implementation.md)

## Commands and settings

| Command | Action |
| --- | --- |
| **Show Context Window Details** | Open Overview (also accepts hover deep-link targets: `gmdata`, `pricing`, `models`, `settings`) |
| **Refresh Context Window Monitor** | Reconnect to the backend and restart polling |
| **Switch Display Language** | Choose English, Chinese, or bilingual display |
| **Show Model Activity** | Open GM Data |

IDE settings use the `antigravityContextMonitor.` prefix (15 settings total):

| Setting | Default | Action |
| --- | --- | --- |
| `pollingInterval` | `5` | Set the polling interval in seconds |
| `statusBar.showContext` | `true` | Show context usage in the status bar |
| `statusBar.showQuota` | `true` | Show the current model's quota percentage |
| `statusBar.showResetCountdown` | `true` | Show the current model's reset countdown |
| `statusBar.showAiCredits` | `true` | Show AI credit balance in the status bar (hidden when unreported) |
| `statusBar.showSpeed` | `false` | Show latest or weighted-average model generation speed (`tok/s`) in the status bar (hidden when untimed) |
| `statusBar.showCacheHit` | `false` | Show token-weighted prompt cache hit rate (`%`) in the status bar (hidden when no prompt tokens exist) |
| `statusBar.showSessionCost` | `false` | Show the active session's estimated API-equivalent cost in the status bar (hidden when `$0` or unpriced) |
| `statusBar.tooltipDensity` | `auto` | Set `auto`, `compact`, or `full` hover density |
| `pricing.displayCurrency` | `"USD"` | Display estimated costs in `"USD"`, `"CNY"`, or `"both"` |
| `pricing.cnyExchangeRate` | `7.2` | Offline reference USD-to-CNY exchange rate (`0.01`–`1000`, zero external network requests) |
| `quotaNotificationThreshold` | `20` | Warn below this quota percentage. Use `0` to disable |
| `showModelInternalId` | `false` | Add the internal ID to model names |
| `activity.maxRecentSteps` | `100` | Limit retained recent activity steps in persistence |
| `activity.maxArchives` | `20` | Limit retained activity archives |

## Troubleshooting and limits

- **No active conversation** means the backend is connected and there is no loaded conversation in the current view. Open a conversation to load its context. Windows on the same workspace can share session data; open different folders for independent views.
- **Backend disconnected** or **LS not found** points to local discovery or connectivity. Reload after installing, then open **Output → Antigravity Context Monitor** and inspect `PATH check:`. The extension supports `agy --hub` (including v1.5.14+ via `GetStatus` / `daemon/hub_<port>.json`) as well as legacy language servers. Windows uses system discovery tools including PowerShell and netstat; run Antigravity under a standard user account. [Backend discovery](docs/technical_implementation.md)
- In WSL, the extension can inspect the active distribution and connect through WSL interop. For Remote-WSL or Remote SSH, Antigravity may run the extension on the local UI host. [Project structure](docs/project_structure.md)
- Long or internally summarized sessions can have incomplete telemetry. The monitor marks estimates and missing steps. In Orchestrator mode, the monitor tracks both `planModel` and `executionModel` independently across cross-pool calls while preserving accurate context readings. [Context and token calculation](docs/technical_implementation.md) · [Community discussion of checkpoint summaries](https://www.reddit.com/r/google_antigravity/comments/1q7zcag/heres_how_to_find_which_mcp_tools_are_leading_to/)

## Credits

Maintained by **AGI-is-going-to-arrive**. Thanks to **SecretLUL** for the Windows discovery report. [Issue #64](https://github.com/AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor/issues/64)

[MIT License](LICENSE) · [LINUX DO](https://linux.do/) · [Star history](https://www.star-history.com/#AGI-is-going-to-arrive/Antigravity-Context-Window-Monitor&type=date&legend=top-left)

# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

*(Dual-surface local telemetry instrument running both inside **Antigravity App (Desktop 2.0+)** as a native Sidecar plugin (`AUX_PANE` + `SIDEBAR` + companion `SKILL.md`, zero external runtime deps via bundled Node) and inside **Antigravity IDE** as a VS Code Chromium Webview Panel paired with a native Status Bar item and MarkdownString hover tooltip across macOS, Windows, Linux, and WSL.)*

## Supported Hosts Matrix

| Host Product Line | Support Status | Packaging / Integration |
| --- | --- | --- |
| **Antigravity IDE** | **Officially Supported** | VS Code VSIX extension (`antigravity-context-monitor-1.17.5.vsix`, `vscode` engine `^1.85.0`) — Status Bar + Hover Tooltip + 9-tab Webview Panel |
| **Antigravity App (Desktop 2.0+)** | **Officially Supported** | Native Sidecar plugin (`antigravity-context-monitor-app-1.17.5.zip` / `.tar.gz`) — `AUX_PANE` (`/`) + `SIDEBAR` (`/full`) + `SKILL.md`, zero external runtime deps via bundled Node `v24.22.0`, zero LLM tool-schema tokens, zero `app.asar`/CDP patching |
| **Antigravity SDK** | Not supported | Separate product line (out of scope) |
| **Standalone CLI** | Not supported | Separate product line (out of scope) |

## Users

- **Primary users:** Software engineers, AI-assisted developers, and technical power users running multi-turn, multi-model, and multi-agent coding sessions inside **Antigravity App** and/or **Antigravity IDE** (including running both simultaneously).
- **Operating situation:** Mid-flow during active coding, debugging, subagent orchestration, refactoring, or release verification — glancing at the IDE bottom-right status bar or keeping the monitor open in an App `AUX_PANE` / IDE narrow side split-pane (`320px–520px`) or full-width App `SIDEBAR` / IDE editor tab (`960px–1440px`) under Light, Dark, or High-Contrast (`hc` / `hc-light`) themes.
- **Locale profile:** Developers working in **English (`en`)**, **Simplified Chinese (`zh`)**, or **Bilingual (`both`)** mode who switch languages instantaneously without restarting the host.
- **Core job:** Maintain continuous, low-friction awareness of active context-window composition and dual-cap pressure, auto-compression/rewind events, conversation pinning and Main-Agent locking during subagent bursts, custom Orchestrator routing (`Planner → Executor`), remaining shared model quota pools (`5-Hour` + `Weekly`) with burn-rate runway estimates, quota reset timing, AI credit balances, turn-level prompt cache hit / cold-warm start diagnostics, per-call latency/speed/token/tool efficiency, session history, and API-equivalent USD spend — without leaving the workflow.

## Product Purpose

**Antigravity Context Window Monitor** is an open-source, strictly read-only local telemetry instrument that turns opaque local Antigravity runtime signals into immediate, trustworthy operational insight across both Antigravity App and Antigravity IDE.

Success means a developer can:
1. Read current context pressure, semantic context composition (Bar ↔ 20×5 Dot Matrix, Dual-Cap budget vs native ceiling, Top 5 Largest Items), active model, shared quota health + burn-rate runway, and next reset countdown in under two seconds from the **Overview** tab or IDE status bar hover.
2. Stay locked onto the main conversation across subagent swarms (**Conversation Switcher** + **Lock to Main Agent**), copy structured `/context` diagnostic reports or compact handoff prompts in one click, inspect turn-level prompt cache warm/cold starts and `+Δ` context growth (**GM Data**), search local session artifacts (**Sessions**), reconcile API-equivalent USD spending with custom rates (**Cost**), verify exact model limits (**Models**), review historical daily archives (**Calendar**), manage account/credit expiry settings with privacy masking (**Profile**), and tune preferences (**Settings**) from one coherent dual-surface instrument.
3. Trust every number shown because measured values, post-compaction/rewind estimates, stale cached fallbacks, partial readings, `custom-*` model isolation, and unreported fields are always explicitly distinguished.

## Positioning

Unlike generic token estimators, invasive `app.asar` patches, CDP scrapers, or token-expensive MCP tool schemas, Antigravity Context Window Monitor runs strictly read-only against local Antigravity Connect-RPC backends (`agy --hub`, App/IDE surface-isolated discovery, and legacy language servers) and their Generator Metadata (`GM`) stream:

- **Zero-overhead native App Sidecar + IDE parity:** Shares one pure zero-`vscode` document builder (`src/webview-document.ts`) across both hosts. In Antigravity App, the sidecar adds **zero LLM tool-schema tokens**, requires **zero external npm runtime dependencies** (running on bundled Node `v24.22.0`), and uses visibility-gated ETag polling (`/api/snapshot`) so hidden panels consume zero CPU/RPC budget.
- **Live measured context composition & dual-cap clarity:** Prioritizes provider-reported `promptSections` / `tokenBreakdown` / planner `modelUsage` and checkpoint snapshots, rendering semantic category breakdowns (Bar ↔ 20×5 Dot Matrix), effective autocompact budget vs native model ceiling, honest measurement state badges (`Measured`, `Estimated (Post-Compaction)`, `Estimated (Rewind)`, `Awaiting Generation`), compaction savings, and Top 5 Largest Items.
- **Subagent-resilient conversation tracking & turn diagnostics:** Supports manual conversation pinning and **Lock to Main Agent** to ignore transient subagent bursts; classifies per-turn cache efficiency (`Cold` / `Partial` / `Warm` Start) and `+Δ` net context growth.
- **Quota runway prediction, stale-safe fallback & custom-model isolation:** Computes rolling 45-minute jitter-filtered quota burn rates (`Safe before reset`, `Est. exhaust in ...`, `Quota exhausted`, `Quota recently recovered`), retains cached telemetry with a timestamped `Cached / Stale` banner during transient local RPC hiccups, and isolates `custom-*` / BYOK / local models so Google quota pool alerts never misfire.
- **Universal base-model effort merging & live Orchestrator Settings:** Collapses thinking-effort variants of the same base model (such as `Gemini 4 Neon` Low/Medium/High/Extra High) into one logical model family when counting shared quota pools, reads live **Orchestrator Settings** (`Orchestrator Model` + `Executor Model`, including cross-pool pairs), and preserves exact per-effort IDs in model specs and call accounting.
- **Epistemic accuracy over fabricated zeros:** Unreported AI credit balances display `Not reported` (`未上报`), unpriced models (`M537`/`M667`/`M681`/`M669`/`M578`/`M21`) and undated scheduled-rate calls display `Unpriced` / `Cost unavailable` and mark totals as partial, and legacy `Prompt` / `Flow` quota buckets are excluded from primary account reporting.
- **Concurrent cross-host durability:** Persists historical daily ledgers, archived cycles, custom pricing overrides, account snapshots, and preferences in shared external `state-v1.json` guarded by an atomic `O_CREAT | O_EXCL` lockfile + 3-way merge so Antigravity App and Antigravity IDE can run simultaneously with zero lost updates.

## Operating Context

- **Host environments:**
  - **Antigravity App (Desktop 2.0+):** Native Sidecar UI plugin (`sidecar_sdk` / loopback HTTP server) on macOS, Windows, and Linux; `AUX_PANE` (`/`) + `SIDEBAR` (`/full`) + companion `context-monitor` `SKILL.md`.
  - **Antigravity IDE:** VS Code extension (`vscode` engine `^1.85.0`) on macOS, Windows, Linux, and WSL.
- **Entry points & surfaces:**
  - **Antigravity App `AUX_PANE` (`/`) & `SIDEBAR` (`/full`):** Full 9-tab Studio Telemetry Ledger rendered by `src/webview-document.ts` + `src/app/theme-adapter.ts` + `src/app/host-bridge.ts`, bridged to host Light/Dark/High-Contrast themes and visibility-gated ETag `/api/snapshot` updates.
  - **IDE Bottom-right Status Bar item & Hover Tooltip:** Compact configurable live readout paired with a priority-tiered (`P0`–`P5`), zoom-aware, zero-flicker diff-guarded Markdown summary (`auto`, `compact`, `full`) and 1-click trusted command links.
  - **Shared 9-Tab Monitor Panel:** `Overview`, `GM Data`, `Sessions`, `Cost`, `Models`, `Calendar`, `Profile`, `Settings`, `About`, plus the sticky **Masthead Context Bar** (Conversation Switcher, Lock to Main Agent, surface & stale badges) and header **Account Panel** popover.
- **Live runtime rhythm:** Configurable background polling (`1–60s`, default `5s` IDE / `4s` visibility-gated App ETag fetch) with unified surface-isolated backend discovery (`ANTIGRAVITY_LS_ADDRESS`, `GetStatus → GetUnleashData → GetUserStatus`, `daemon/hub_<port>.json`, Linux `/proc/<pid>` fallback), instant reconnect on backend change, non-blocking auxiliary metadata sync, in-place incremental tab patching, Pause/Resume without losing scroll or form state, manual Refresh, and interface zoom (`60%–150%`).
- **Offline sandbox constraint:** All styles, icons, bundled screenshots, scripts, and USD calculations execute 100% locally and offline with zero external CDN fonts, icon packs, or remote network calls.

## Capabilities and Constraints

### Confirmed Functionality
- **9 Shared Monitor Views (IDE Webview + App Sidecar):**
  1. `Overview` — Active conversation hero & meter, active Orchestrator cross-pool route pill (`Planner → Executor`), **Context Composition Breakdown** card (Bar ↔ 20×5 Dot Matrix, Dual-Cap `Effective Budget` vs `Native Ceiling`, `Measured` / `Estimated (Post-Compaction)` / `Estimated (Rewind)` / `Awaiting Generation` badge, compaction saved chip, collapsible Top 5 Largest Items, **Copy `/context` Report** & **Copy Handoff Prompt**), recessed L2 speed/TTFT/cache/USD cost strip, collapsible session diagnostics, 5-Hour + Weekly dual-window shared quota pool meters with **Quota Burn-Rate Runway** pills (or **Custom Model Isolated** banner), **Cached / Stale** banner when reconnecting, and AI credits footer.
  2. `GM Data` — Unified Generator Metadata & activity dashboard: top KPI bar, 2-column Speed & First-Token Cache Ledger (now including **Last-Turn vs Session Cache Hit** and **Cold / Partial / Warm Start** pills), collapsible **Recent Calls Ledger** (latest 20 calls with **`+Δ` net context growth** & compaction drops, actual model, fresh input, output & thinking share, cache hit %, USD cost or `Unpriced`, TTFT, total latency, noise-gated speed, status), recent activity timeline with telemetry pills, per-model stats, today's active & settled ledgers, tool call ranking, estimated context growth chart, conversation breakdown, and error details.
  3. `Sessions` — Searchable, filterable (`All`, `Workspace`, `Repo`, `Running`, `Recordable`) session catalog grouped by workspace with quick OS reveal actions for workspace folders, Brain/recording folders, and `.pb` files.
  4. `Cost` — 45-day upcoming scheduled rate-change banner (Carbon/Argon `2026-12-01`, Flash `2027-01-01`), monthly & today USD cost summaries with cache savings and thinking-cost share, per-model 4-series cost distribution chart, unmetered image-generation fee disclosure, and inline editable custom pricing table per 1M tokens.
  5. `Models` — Live **Orchestrator Settings** card, default model banner, 5h + Weekly dual-window merged shared quota pool cards with **Quota Burn-Rate Runway** badges and amber `Notice` sunset tags, full chat model specifications (`Compression limit`, `Checkpoint threshold`, `Model context`, `Max output`, `Thinking`, USD API reference price or `Unpriced` badge, configured routes, internal IDs), and separate image-generation model catalog.
  6. `Calendar` — Monthly / All-Time USD usage summary switcher, interactive 7-column month calendar with activity indicators, expandable per-day model/cycle detail panels (including archived speed, TTFT, and cache-hit chips), and history reset action.
  7. `Profile` — Account identity header with default-on privacy mask toggle, current plan/tier, 5h + Weekly dual-window shared model quota pools, AI credits balance + per-account monthly expiry day configuration (`0` disables countdown), and collapsible plan limits, feature flags, and team config.
  8. `Settings` — Shared persistent storage diagnostics (`state-v1.json` path, status, copy/open/reveal, size, calendar days), low-quota notification threshold, polling interval, 7 IDE status bar toggles + hover density selector (clearly marked `IDE only` when viewed inside Antigravity App), internal model ID toggle, interface zoom presets & slider, tab scroll hint control, scrollbar & end-of-content visibility toggles.
  9. `About` — Dynamic manifest version (`v1.17.5`), dual-host support badges (**Antigravity IDE** + **Antigravity App (Desktop 2.0+ Sidecar)**), clickable 8-tab feature navigation directory, open-source repository link, multi-window tip, Gemini 4 512K context window note, compatibility record, unofficial/read-only disclaimer, and language hint.
- **Masthead Context Bar (Persistent Header Controls):** Conversation Switcher (`Follow Active` or pin any trajectory), **Lock to Main Agent** toggle, surface badge (`Antigravity App` / `Antigravity IDE`), and `Cached / Stale` indicator.
- **4 Registered IDE Commands & 13 IDE Settings (`antigravityContextMonitor.*`):** Preserved in full alongside persistent App Sidecar settings synchronization via `/api/action`.
- **Live Catalog, Pricing & Runtime Support (v1.17.5):** Verified against both **Antigravity App v2.34.0** (bundled Node `v24.22.0`) and **Antigravity IDE v2.7.0** (`agy` v1.5.14 / LS 2.34.0) running simultaneously with zero backend crosstalk and zero state-file contention.

### Technical & Terminology Constraints
- **Read-only local telemetry:** Never mutates Antigravity user data, accounts, `app.asar`, or backend configuration.
- **Zero LLM tool-schema tokens:** The App plugin contributes a Sidecar UI and lightweight `SKILL.md` only — never injects heavy MCP tool schemas into conversation prompts.
- **No legacy Prompt/Flow quotas:** Prompt and Flow credits are deprecated legacy fields and must never be rendered as primary account quotas.
- **Natural developer terminology:** In Simplified Chinese (`zh`) and Bilingual (`both`) modes, technical terms must follow natural developer usage — always use `tokens` or `Token` (never literal machine-translated Chinese token labels), and avoid duplicated product prefixes or double-dash artifacts.
- **Viewport range:** Zero horizontal overflow from `320px` narrow side panes through `1440px` wide dashboards across all 9 tabs, 4 themes, and 3 language modes.

### Provenance Note
- Product facts above are derived directly from repository truth (`package.json`, `app-plugin/plugin.json`, `src/`, `scripts/`, `tests/`, `README.md`, `docs/`) and verified v1.17.5 dual-surface checks. *(Undecided future roadmap items beyond v1.17.5 are intentionally left open.)*

## Brand Commitments

- **Product name:** `Antigravity Context Window Monitor` (short panel title: `Antigravity Monitor` / `Antigravity 监控面板`; App plugin display name: `Antigravity Context Monitor`).
- **Identity & voice:** Unofficial open-source community project maintained by `AGI-is-going-to-arrive` (MIT License; explicitly not affiliated with or endorsed by Google). Voice is calm, precise, factual, and developer-native — zero marketing hype, zero gamification, zero cute filler.
- **Confirmed visual rejections (binding):**
  - Reject whole-page warm-beige / sepia / parchment yellow washes in Light mode and muddy warm-brown darkness in Dark mode that clash with crisp host chrome.
  - Reject oversized bold Georgia + jagged Songti SC / SimSun CJK fallback headings that overpower telemetry data.
  - Reject muddy brown progress bars, flat wireframe containers, weak text contrast, cluttered equal-weight `English / 中文` bilingual strings, and sluggish or unrefined controls.
- **Confirmed aesthetic direction (binding):** **Modern Editorial Telemetry** tailored for **Operate** mode — razor-sharp, high-clarity studio-neutral instrumentation with refined editorial typography, clean surface hierarchy, vivid semantic status clarity, graceful bilingual subordination, and tactile modern micro-interactions.

## Evidence on Hand

- **Source implementation:** Shared pure document & telemetry modules (`src/webview-document.ts`, `src/context-breakdown.ts`, `src/turn-diagnostics.ts`, `src/quota-runway.ts`, `src/conversation-selector.ts`, `src/i18n-core.ts`, `src/durable-state.ts`, `src/discovery.ts`, `src/telemetry-metrics.ts`, `src/monitor-overview.ts`, `src/pricing-store.ts`, `src/account-credits.ts`), Antigravity App Sidecar plugin (`app-plugin/`, `src/app/sidecar-runtime.ts`, `src/app/sidecar-server.ts`, `src/app/sidecar-types.ts`, `src/app/host-bridge.ts`, `src/app/theme-adapter.ts`, `scripts/package-app-plugin.mjs`, `scripts/install-app-plugin.{mjs,sh,ps1}`), and Antigravity IDE extension (`src/extension.ts`, `src/webview-panel.ts`, `src/statusbar.ts`, `src/tooltip-budget.ts`, and all 9 tab/style modules).
- **Automated verification:** **71 Vitest unit test suites (1,350/1,350 tests)** in `tests/*.test.ts`, **739/739** installed IDE Chromium matrix checks (`tests/installed-ide-ui.cjs`), **432/432** App Sidecar Chromium + full-document axe-core WCAG 2.1 AA checks (**0 violations**), `agy plugin validate --strict` (**0 findings**), and live dual-run macOS verification on Antigravity App v2.34.0 + Antigravity IDE v2.7.0.
- **Documentation & release validation:** `README.md`, `readme_CN.md`, `CHANGELOG.md`, `docs/releases/1.17.5.md`, `docs/technical_implementation.md`, `docs/project_structure.md`.
- **Published screenshots:** `src/images/monitor-{overview,models,cost,gm-data,sessions,calendar,profile,settings,about}.png`.
- **Absences not to fabricate:** No invented user testimonials, adoption claims, official Google/Antigravity endorsements, or unverified public API pricing rates.

## Product Principles

1. **Glanceable Clarity Under Flow:** Operational signals (context composition & %, quota health & runway, reset countdown, active alerts) must win visual priority over headings, chrome, and decorative framing.
2. **Epistemic Honesty Over Pretty Zeros:** Never disguise missing telemetry as `0`, stale data as fresh, or unpriced models as free. Always label estimates, post-compaction/rewind states, stale fallbacks, partial subtotals, and unreported readings plainly.
3. **Unified Family Accounting, Exact Technical Provenance:** Merge thinking-effort variants into single base-model families wherever users reason about quota pools, while preserving exact model IDs and specs for diagnosis.
4. **Trilingual Native Ergonomics:** English, Simplified Chinese, and Bilingual modes must each feel purpose-built — crisp CJK legibility, idiomatic developer terminology, and clear primary/secondary visual hierarchy in bilingual mode.
5. **Dual-Host Native Respect & Zero Friction:** Harmonize seamlessly with Antigravity App and Antigravity IDE Light, Dark, and High-Contrast themes, narrow side panes and wide dashboards, keyboard navigation, reduced-motion preferences, concurrent persistence, and strict offline security.

## Accessibility & Inclusion

- **Contrast standard:** WCAG 2.1 AA+ verified with **0 violations** across all 432 App Sidecar combinations and 739 IDE UI checks (`≥ 4.5:1` for all body, muted, label, badge, and placeholder text; `≥ 7.0:1` AAA target for primary telemetry figures and headings; `≥ 3.0:1` WCAG 1.4.11 non-text contrast for meter fills, toggle thumbs, control borders, and focus rings).
- **High-Contrast support:** First-class support for `vscode-high-contrast` / `vscode-high-contrast-light` in IDE and `data-acm-theme="hc"` / `data-acm-theme="hc-light"` in App Sidecar with WCAG-verified contrast overrides (`#005A32`, `#7A4F01`, `#B5200D` on `#FFFFFF` in `hc-light`).
- **Keyboard & Assistive Tech:** Complete `<title>` in `<head>`, WCAG 2.5.3 `label-content-name-mismatch` alignment (including `#privacyToggle` and `aria-hidden="true"` hover tooltips), semantic `<ul><li><button>` breakdown legend, `tabindex="0"` focusable scroll regions (`.recent-calls-table-wrap`, `.act-conv-list`, `.act-timeline`, `.cp-viewer`), full keyboard operability across tab bar (`ArrowLeft`, `ArrowRight`, `Home`, `End`), collapsible `<details>`, popover dismissal (`Escape`), high-visibility `:focus-visible` outlines, and accurate ARIA semantics (`role="meter"`, `role="img"`, `aria-current="page"`, `aria-pressed`, `aria-expanded`, `role="status"`).
- **Motion sensitivity:** All non-essential transitions and animations respect `@media (prefers-reduced-motion: reduce)`.

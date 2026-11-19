# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

*(Runs inside VS Code / Antigravity IDE as a Chromium-based Webview Panel paired with a native VS Code Status Bar item and MarkdownString hover tooltip across macOS, Windows, Linux, and WSL.)*

## Users

- **Primary users:** Software engineers, AI-assisted developers, and technical power users running multi-turn, multi-model agentic coding sessions inside **Antigravity IDE**.
- **Operating situation:** Mid-flow during active coding, debugging, refactoring, or release verification — glancing at the bottom-right status bar or opening the monitor panel in a narrow side split-pane (`320px–520px`) or full editor tab (`960px–1440px`) under either bright daylight (Light theme) or dim/evening studio lighting (Dark theme), as well as OS/IDE High-Contrast modes.
- **Locale profile:** Developers working in **English (`en`)**, **Simplified Chinese (`zh`)**, or **Bilingual (`both`)** mode who switch languages instantaneously without restarting the IDE.
- **Core job:** Maintain continuous, low-friction awareness of active context-window pressure, auto-compression/checkpoint behavior, remaining shared model quota pools, quota reset timing, AI credit balances, per-call latency/token/tool efficiency, session history, and API-equivalent USD spend — without leaving the editor or breaking coding flow.

## Product Purpose

**Antigravity Context Window Monitor** is an open-source, strictly read-only IDE telemetry extension that turns opaque local Antigravity runtime signals into immediate, trustworthy operational insight.

Success means a developer can:
1. Read current context pressure, active model, shared quota health, and next reset countdown in under two seconds from either the status bar hover or the **Overview** tab.
2. Inspect deep per-call diagnostics (**GM Data**), search and jump to local session artifacts (**Sessions**), reconcile API-equivalent spending with custom rates (**Cost**), verify exact model limits and capabilities (**Models**), review historical daily archives (**Calendar**), manage account/credit expiry settings with privacy masking (**Profile**), and tune polling/display preferences (**Settings**) from one coherent instrument.
3. Trust every number shown because measured values, estimated heuristics, partial readings, and unreported fields are always explicitly distinguished.

## Positioning

Unlike generic token estimators or third-party cloud dashboards, Antigravity Context Window Monitor connects directly and locally (read-only) to the running Antigravity backend (`agy --hub` and legacy language servers) and its Generator Metadata (`GM`) stream:

- **Live measured context & compression telemetry:** Prioritizes provider-reported fresh input, cache read, cache creation, output, and thinking tokens from live planner responses and checkpoints, accurately tracking auto-compression drops, undo recalculations, and mid-session model switches.
- **Universal base-model effort merging:** Collapses thinking-effort variants of the same base model (such as `Gemini 4 Neon` Low/Medium/High/Extra) into one logical model family when counting shared quota pools, while keeping distinct architectural entries (such as `Orchestrator (Neon)` and its hidden `M669` execution route) accurately separated and preserving exact per-effort IDs in model specs and call accounting.
- **Epistemic accuracy over fabricated zeros:** Unreported AI credit balances display `Not reported` (`未上报`), unpriced models display `Cost unavailable` (`费用暂不可用`) and mark totals as partial, and legacy `Prompt` / `Flow` quota buckets are excluded from primary account reporting.
- **Cross-reinstall durability:** Persists historical daily ledgers, archived cycles, custom pricing overrides, and panel preferences in a local file outside the volatile extension state database.

## Operating Context

- **Host environment:** Antigravity IDE (`vscode` engine `^1.85.0`) on macOS, Windows, Linux, and WSL. Desktop, SDK, and CLI product lines are explicitly out of scope and unsupported.
- **Entry points & surfaces:**
  - **Bottom-right Status Bar item:** Compact configurable live readout (context usage, quota remaining %, reset countdown, AI credits).
  - **Status Bar Hover Tooltip:** Rich Markdown summary with configurable density (`auto`, `compact`, `full`) and direct command links to **Overview**, **Models**, and **Settings**.
  - **Monitor Webview Panel (9 tabs):** `Overview`, `GM Data`, `Sessions`, `Cost`, `Models`, `Calendar`, `Profile`, `Settings`, `About`, plus a header **Account Panel** popover for multi-account status snapshots.
- **Live runtime rhythm:** Default 5-second background polling (configurable `1–60s`) with in-place incremental tab updates, one-click Pause/Resume without losing scroll or form state, manual Refresh, and panel-wide interface zoom (`60%–150%`).
- **Offline sandbox constraint:** Runs inside VS Code's strict Content Security Policy webview. All styles, icons, and scripts must execute 100% locally and offline with zero external CDN fonts, icon packs, or network requests.

## Capabilities and Constraints

### Confirmed Functionality
- **9 Webview Tabs:**
  1. `Overview` — Active conversation context reading & meter, collapsible session diagnostics, shared quota pool summaries with reset timers, AI credits & expiry footer, disconnected/idle/empty states.
  2. `GM Data` — Unified Generator Metadata & activity dashboard: top KPI bar, recent activity timeline, per-model call/latency/token/cache/credit/cost stats, today's active & settled ledgers, tool call ranking, estimated context growth chart, conversation breakdown, and error details.
  3. `Sessions` — Searchable, filterable (`All`, `Workspace`, `Repo`, `Running`, `Recordable`) session catalog grouped by workspace with quick OS reveal actions for workspace folders, Brain/recording folders, and `.pb` files.
  4. `Cost` — Monthly USD cost summary, per-model cost distribution stacked chart (input/output/cache/thinking), breakdown ledger, unmetered image-generation fee disclosure, and inline editable custom pricing table per 1M tokens.
  5. `Models` — Default model banner, merged shared model quota pool cards (with divergent-effort detail disclosures), full chat model technical specifications (`Compression limit`, `Checkpoint threshold`, `Model context`, `Max output`, `Thinking`, configured orchestration routes, internal IDs), and separate image-generation model catalog.
  6. `Calendar` — Monthly / All-Time usage summary switcher, interactive 7-column month calendar with activity indicators, expandable per-day model/cycle detail panels, and history reset action.
  7. `Profile` — Account identity header with default-on privacy mask toggle, current plan/tier, shared model quota pools, AI credits balance + per-account monthly expiry day configuration (`0` disables countdown), and collapsible plan limits, feature flags, and team config.
  8. `Settings` — Persistent storage diagnostics (path, status, copy/open/reveal, size, calendar days), low-quota notification threshold, polling interval, 4 status bar toggles + hover density selector, internal model ID toggle, interface zoom presets & slider, tab scroll hint control, scrollbar & end-of-content visibility toggles.
  9. `About` — Version & platform scope confirmation, clickable 8-tab feature navigation directory, open-source repository link, multi-window tip, compatibility record, unofficial/read-only disclaimer, and language hint.
- **4 Registered Commands:** `Show Context Window Details`, `Refresh Context Window Monitor`, `Switch Display Language`, `Show Model Activity`.
- **10 IDE Settings (`antigravityContextMonitor.*`):** `pollingInterval`, `statusBar.showContext`, `statusBar.showQuota`, `statusBar.showResetCountdown`, `statusBar.showAiCredits`, `statusBar.tooltipDensity`, `quotaNotificationThreshold`, `showModelInternalId`, `activity.maxRecentSteps`, `activity.maxArchives`.
- **Live Catalog Support (v1.17.2):** Includes `Gemini 4 Neon` (`Low`, `Medium`, `High`, `Extra` — `M534`/`M533`/`M532`/`M535`) and `Orchestrator (Neon)` (`M537`, configured execution route `M669`), each with `1,048,576` model context, `262,144` max output, `512,000` compression limit, and `50,000` checkpoint threshold, alongside existing Gemini 4 Carbon/Argon/Hydrogen, Claude Opus/Sonnet 5.5, and GPT-OSS families.

### Technical & Terminology Constraints
- **Read-only local telemetry:** Never mutates Antigravity user data, accounts, or backend configuration.
- **No legacy Prompt/Flow quotas:** Prompt and Flow credits are deprecated legacy fields and must never be rendered as primary account quotas.
- **Natural developer terminology:** In Simplified Chinese (`zh`) and Bilingual (`both`) modes, technical terms must follow natural developer usage — always use `tokens` or `Token` (never machine-translated `令牌`), and avoid duplicated product prefixes or double-dash artifacts.
- **Viewport range:** Zero horizontal overflow from `320px` narrow split-panes through `1440px` full editor windows across all 9 tabs and all 3 language modes.

### Provenance Note
- Product facts above are derived directly from repository truth (`package.json`, `src/`, `tests/`, `README.md`, `docs/`) and the confirmed redesign brief. *(Autonomous swarm pass; no separate interactive user interview was conducted. Undecided future roadmap items beyond v1.17.2 are intentionally left open.)*

## Brand Commitments

- **Product name:** `Antigravity Context Window Monitor` (short panel title: `Antigravity Monitor` / `Antigravity 监控面板`).
- **Identity & voice:** Unofficial open-source community project maintained by `AGI-is-going-to-arrive` (MIT License; explicitly not affiliated with or endorsed by Google). Voice is calm, precise, factual, and developer-native — zero marketing hype, zero gamification, zero cute filler.
- **Confirmed visual rejections (binding):**
  - Reject whole-page warm-beige / sepia / parchment yellow washes in Light mode and muddy warm-brown darkness in Dark mode that clash with crisp IDE chrome.
  - Reject oversized bold Georgia + jagged Songti SC / SimSun CJK fallback headings that overpower telemetry data.
  - Reject muddy brown progress bars, flat wireframe containers, weak text contrast, cluttered equal-weight `English / 中文` bilingual strings, and sluggish or unrefined controls.
- **Confirmed aesthetic direction (binding):** **Modern Editorial Telemetry** tailored for **Operate** mode — razor-sharp, high-clarity studio-neutral IDE instrumentation with refined editorial typography, clean surface hierarchy, vivid semantic status clarity, graceful bilingual subordination, and tactile modern micro-interactions.

## Evidence on Hand

- **Source implementation:** `src/webview-panel.ts`, `src/webview-styles.ts`, `src/webview-editorial-styles.ts`, `src/webview-script.ts`, `src/webview-icons.ts`, `src/webview-overview-tab.ts`, `src/activity-panel.ts`, `src/webview-chat-history-tab.ts`, `src/pricing-panel.ts`, `src/webview-models-tab.ts`, `src/webview-calendar-tab.ts`, `src/webview-profile-tab.ts`, `src/webview-settings-tab.ts`, `src/webview-about-tab.ts`, `src/statusbar.ts`, `src/monitor-overview.ts`, `src/account-credits.ts`, `src/i18n.ts`.
- **Automated verification:** 50+ Vitest unit test suites in `tests/*.test.ts` plus deterministic multi-theme/multi-viewport browser & native macOS IDE verification harness in `tests/installed-ide-ui.cjs`.
- **Documentation & release validation:** `README.md`, `readme_CN.md`, `CHANGELOG.md`, `docs/releases/1.17.2.md`, `docs/technical_implementation.md`.
- **Visual anti-references (to be replaced after overhaul):** Existing `src/images/monitor-overview.png`, `monitor-models.png`, `monitor-cost.png`, `monitor-gm-data.png`, `monitor-sessions.png`, `monitor-calendar.png`, `monitor-settings.png`, `monitor-about.png` document the rejected sepia/brown look; `src/images/monitor-profile.png` is currently missing and must be generated from the redesigned Profile view.
- **Absences not to fabricate:** No invented user testimonials, adoption claims, official Google/Antigravity endorsements, or unverified public API pricing rates.

## Product Principles

1. **Glanceable Clarity Under Flow:** Operational signals (context %, quota health, reset countdown, active alerts) must win visual priority over headings, chrome, and decorative framing.
2. **Epistemic Honesty Over Pretty Zeros:** Never disguise missing telemetry as `0` or unpriced models as free. Always label estimates, partial subtotals, and unreported readings plainly.
3. **Unified Family Accounting, Exact Technical Provenance:** Merge thinking-effort variants into single base-model families wherever users reason about quota pools, while preserving exact model IDs and specs for diagnosis.
4. **Trilingual Native Ergonomics:** English, Simplified Chinese, and Bilingual modes must each feel purpose-built — crisp CJK legibility, idiomatic developer terminology, and clear primary/secondary visual hierarchy in bilingual mode.
5. **IDE-Native Respect & Zero Friction:** Harmonize seamlessly with Light, Dark, and High-Contrast IDE themes, narrow split-panes, keyboard navigation, reduced-motion preferences, and strict offline webview security.

## Accessibility & Inclusion

- **Contrast standard:** WCAG 2.1 AA+ minimum across both Light and Dark themes (`≥ 4.5:1` for all body, muted, label, badge, and placeholder text; `≥ 7.0:1` AAA target for primary telemetry figures and headings; `≥ 3.0:1` WCAG 1.4.11 non-text contrast for meter fills, toggle thumbs, control borders, and focus rings).
- **High-Contrast support:** First-class support for VS Code `vscode-high-contrast` and `vscode-high-contrast-light` using native system/VS Code contrast variables (`Canvas`, `CanvasText`, `LinkText`, `--vscode-contrastBorder`).
- **Keyboard & Assistive Tech:** Full keyboard operability across tab bar (`ArrowLeft`, `ArrowRight`, `Home`, `End`), collapsible `<details>`, filter groups, popover dismissal (`Escape`), and high-visibility `:focus-visible` outlines. Accurate ARIA semantics (`role="meter"`, `role="progressbar"`, `aria-current="page"`, `aria-pressed`, `aria-expanded`, `role="status"`).
- **Motion sensitivity:** All non-essential transitions and animations respect `@media (prefers-reduced-motion: reduce)`.

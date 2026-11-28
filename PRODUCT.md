# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

*(Multi-surface local telemetry instrument running inside **Antigravity App (Desktop 2.0+)** as a native Sidecar plugin (`AUX_PANE` + `SIDEBAR` + companion `SKILL.md`), inside **Antigravity IDE** as a VS Code Chromium Webview Panel + Status Bar item + MarkdownString hover tooltip, and as an opt-in read-only **`agy` CLI `statusLine`** binary across macOS, Windows, Linux, and WSL.)*

## Supported Hosts Matrix

| Host Product Line | Support Status | Packaging / Integration |
| --- | --- | --- |
| **Antigravity IDE** | **Officially Supported** | VS Code VSIX extension (`antigravity-context-monitor-<version>.vsix`, `vscode` engine `^1.85.0`, crisp `256×256` `assets/icon.png`, zero runtime npm deps via `esbuild`) — Status Bar + Hover Tooltip + six-tab Webview Panel + topbar About + conflict-free hotkeys (`Cmd+Alt+M` / `Ctrl+Alt+M`) + bidirectional `state-v1.json` hot sync + Open VSX updates |
| **Antigravity App (Desktop 2.0+)** | **Officially Supported** | Native Sidecar plugin (`antigravity-context-monitor-app-<version>.zip` / `.tar.gz` + `SHA256SUMS.txt` + `AGENTS.md`, zero runtime npm deps via `esbuild`) — `AUX_PANE` (`/`) + `SIDEBAR` (`/full`) + `SKILL.md` + Native Ambient HUD (Overview auto-hide) + unified `PublishedMonitorObservation` + 3-field per-window root lock + read-only Swarm live tracking + strictly opt-in zero-patch CDP Shadow DOM Overlays (per-target Origin-bound grants, 2.5s Dock self-heal, `?focused=` split-pane focus preservation, 3-platform `CDP`-badged launchers with macOS `Cancel` default) + authenticated Standalone pairing + fail-closed self-updater |
| **Antigravity CLI (`agy`)** | **Opt-In Read-Only `statusLine` + Local Usage Logs** | Bundled zero-dependency `app-plugin/bin/agy-statusline.mjs` (`64 KB` / `1500 ms` bounded stdin, ANSI/control sanitized, 10 currencies incl. `CAD`, `NO_COLOR`/`EPIPE` safe, explicit `—` missing markers) + strictly read-only local `~/.gemini/antigravity-cli` log aggregation in **Usage & Cost** |
| **Antigravity SDK** | Not supported | Separate programmatic interface product line (no UI host) |

## Users

- **Primary users:** Software engineers and technical power users running multi-turn, multi-model, and multi-agent (Swarm / subagent) coding sessions inside **Antigravity App**, **Antigravity IDE**, and/or **`agy` CLI** (including simultaneously).
- **Operating situation:** Mid-flow during active coding, debugging, Swarm coordination, refactoring, or release verification — glancing at the IDE bottom-right status bar or keeping the six-tab panel open in a narrow `320px–480px` `AUX_PANE` / split pane or wide `960px–1440px` `SIDEBAR` / editor tab across Dark, Light, High-Contrast Dark, and High-Contrast Light themes.
- **Locale profile:** Developers working in **English (`en`)**, **Simplified Chinese (`zh`)**, or **Bilingual (`both`)** mode. First boot defaults to single-language system locale (`auto`), explicit `both` preferences are preserved, and narrow panes (`<=480px`) compact per-view without altering wide panes or persisted preferences.
- **Core job:** Maintain instant, trustworthy awareness of unified context utilization & dual limits, Swarm/subagent worker progress without focus hijacking, prompt cache 5-minute TTL & reuse efficiency, model-call Decode vs E2E throughput & anomalies, dual-window (`5h` + `7d`) shared quotas with weekly active-hours forecasting, workspace-attributed 10-currency API-equivalent spend, and clean Handoff v2 / Compaction Recovery workflows.

## Product Purpose

**Antigravity Context Window Monitor** is an open-source (MIT), strictly read-only local telemetry instrument that turns local Antigravity runtime signals into immediate, consistent operational insight across Antigravity App, Antigravity IDE, and `agy` CLI.

Success means a developer can:
1. Read identical context percentages, dual limits, and speed metadata across Overview, Native HUD, CDP overlays, and IDE Status Bar from a single immutable `PublishedMonitorObservation` (D9).
2. Stay locked onto the main coordinator session across 20+ concurrent Swarm workers via the per-window 3-field state machine (`{ observedHostFocus, lockedRootId, inspectedMemberId }`), inspect any worker without losing the root anchor, and return in one click (**Back to Main**).
3. Navigate all operational views with zero horizontal tab scrolling across six primary tabs (**Overview**, **Model Calls**, **Sessions**, **Usage & Cost**, **Models & Quotas**, **Settings**) and topbar **`ⓘ About`**, preserving all 18 legacy deep-link aliases (D2).
4. Trust every figure because provider-measured metrics, local heuristics (5m cache TTL, weekly active-hours forecast), post-compaction/rewind estimates, unattributable legacy rows (`Unattributed`), API-equivalent reference costs (10 currencies incl. `CAD`), and unavailable fields (`—`) are always explicitly distinguished.

## Product & Architecture Decisions (D1–D9)

- **D1 (Plan C Full Scope):** P0/P1 security, correctness, and cross-platform hardening + `esbuild` slimming + Cache 5m TTL heuristic, Model-Call Decode/E2E & anomaly filters, `5h`/`7d`/`tightest` + `remaining`/`used` + weekly active-hours forecast, Workspace leaderboard, Markdown/CSV/JSON exports, Handoff v2 & Compaction Recovery Brief, 5-group Settings with allowlisted JSON backup & redacted diagnostics, safe IDE hotkeys, Swarm live tracking, and opt-in `agy-statusline.mjs`.
- **D2 (Dashboard navigation):** Six tabs cover **Overview · Model Calls · Sessions · Usage & Cost · Models & Quotas · Settings**. About opens from the top bar, keeping all 18 legacy aliases and CDP allowlist parity.
- **D3 (System Single-Language & Split Native HUD):** Persistent `languagePreference` (`auto`/`en`/`zh`/`both`) decoupled from per-view `effectiveLanguage` (`<=480px`); split `appShowNativeHudBar` (`true`) and `ideShowNativeHudBar` (`false`) with Overview auto-hide.
- **D4 (CDP Polish & Safety):** Freeze new persistent overlay views; focus on `?focused=` split-pane focus preservation, narrow `MutationObserver`, `250ms` hover-intent, `2.5s` Dock self-heal, per-target Origin-bound grants, font-size/HC presets, macOS `Cancel`-default launcher, and objective technical boundary copy (zero absolutist legal claims).
- **D5 (10-Currency Contract & Plan ROI):** Shared `src/core/currency.ts` adding `CAD` (`CA$`), explicit symbol/decimal/micro-threshold rules, currency-bound `customFxRate`, sum-before-round, and Plan ROI relocated to collapsible Advanced section with non-billing reference disclaimer.
- **D6 (Shared Core & Zero-Runtime-Dep `esbuild` Bundles):** Pure `src/core/*`, independently typechecked/bundled `src/client/*` with content-hash `buildId`, allowlist packaging, out-of-repo `npm run test:dist`, and hard artifact ceilings (VSIX `< 1.0 MB` uncompressed / `< 400 KB` compressed, App ZIP `< 0.55 MB`).
- **D7 (Docs, IDE Details & WebP Assets):** `<150`-line single-source `README.md`, lowercase `readme_CN.md` (excluded from VSIX), slim `<25 KB` `CHANGELOG.md` + `docs/CHANGELOG_ARCHIVE.md`, `256×256` `assets/icon.png`, deleted legacy `src/images/monitor-*.png`, and clean EN/ZH WebP gallery under `docs/images/{en,zh}/`.
- **D8 (Authenticated Standalone, Full-Chain Privacy & Test Lanes):** One-time private Standalone pairing, pre-serialization privacy redaction, positive registered-workspace Reveal auth, fail-closed `SHA256SUMS.txt`, and separated fast unit / real-system / out-of-repo `test:dist` / live acceptance lanes.
- **D9 (Unified Observation, 3-Field Lock & Read-Only Swarm Registry):** Deeply-frozen `PublishedMonitorObservation`, per-window `{ observedHostFocus, lockedRootId, inspectedMemberId }`, allowlisted read-only `members.json`/`swarm.json` parser with 512 KB streaming caps, and fair-budget round-robin `SwarmPollScheduler` for 20+ active members.

## Capabilities & Technical Boundaries

### 5 Shared Monitor Views + 2 Topbar Utilities (IDE Webview + App Sidecar)
1. **Overview (`overview`):** Native HUD (auto-hidden on Overview by default), Masthead Context Bar (Conversation Switcher, 3-Field Root Lock, surface & stale badges), pinned **Worker Inspection Banner** with **Back to Main**, active context hero with dual watermarks (`Compaction` + `200k` tier), Orchestrator route pill & Split card, interactive **Context Composition** card (Bar ↔ 20×5 / 10×10 Dot Matrix, Top-3 category drawer, Top-5 largest items, `/context` report, **Handoff v2** preview, read-only **Compaction Recovery Brief**), **Swarm / Subagents Live Strip**, recessed L2 telemetry strip, `5h`/`7d` quota pools, and AI credits footer.
2. **Model Calls (`gm`):** Account-filtered KPI bar, Speed & Cache Ledger (**Decode vs E2E**, Cached vs Uncached TTFT, **5m Idle TTL** + possible miss causes), anomaly filter bar (`Slow TTFT`, `Cache Miss`, `High Cost`, `High Context`, `Errors/Retries`), Orchestrator Split, Recent Calls Ledger, per-model stats, tool ranking, context growth chart, and activity timeline.
3. **Sessions (`sessions`):** Searchable conversation & Swarm hierarchy grouped by workspace with positive registered-workspace OS Reveal actions.
4. **Usage & Cost (`calendar`):** 400-day (`30–3650`) multi-source (`All / App / IDE / CLI`) 52-week heatmap & Month Grid, ingestion-time **Workspace Leaderboard** (`Unattributed` for legacy rows), **10-currency** API-equivalent pricing (`USD`..`AUD` incl. `CAD`), Orchestrator Mapped vs Strict mode, custom rate table, Swarm direct vs inclusive group costs, collapsible **Advanced Plan ROI** (reference disclaimer), unified **Markdown / CSV / JSON** exports (empty selection exports empty), and 2-step Clear History guard.
5. **Models & Quotas (`models`):** Privacy-masked account identity, `5h`/`7d`/`tightest` & `remaining`/`used` quota pools with **Weekly Active-Hours Forecast**, AI credits & monthly expiry configuration, live **Orchestrator Settings**, and zero-day model specs.
6. **Settings:** Version & Updates · Display & Language · Telemetry & Metrics · Currency & Pricing · Opt-In Overlays & CDP · Data, Backup & Diagnostics (allowlisted JSON backup/import, redacted diagnostic export, shared `state-v1.json` diagnostics, Updates).
7. **Topbar `ⓘ About`:** Single-source version & updates card, `AGENTS.md` tip, supported host badges, six-tab navigation directory, objective compliance boundary summary, community credits, and MIT repository link.

### Non-Negotiable Technical & Terminology Boundaries
- **Zero host patching & strictly read-only:** Never patches `app.asar`, `Info.plist`, `language_server`, or `agy`; never extracts OAuth tokens, switches accounts, sends synthetic probes, or uploads telemetry; never kills running Antigravity App/IDE processes.
- **Zero LLM tool-schema overhead & zero runtime npm deps:** Contributes Sidecar UI + lightweight `SKILL.md` only; pure Node built-ins + `esbuild` dev-time bundles.
- **Natural developer terminology:** Unified Simplified Chinese glossary (`账号`, `配额`, `费用`, `冷启动`, `首字延迟`, `模型调用`, `原生窗口上限`, `冻结面板`, `tokens`/`Token`).
- **Excluded from VSIX:** `PRODUCT.md`, `DESIGN.md`, `readme_CN.md`, `AGENTS.md`, and `docs/**` are excluded from the IDE VSIX via `.vscodeignore`.

## Accessibility & Inclusion

- **WCAG 2.1 AA+ across 4 themes:** Verified contrast across Obsidian Slate Dark, Alabaster Studio Light, High-Contrast Dark, and High-Contrast Light (`≥ 4.5:1` text, `≥ 3.0:1` non-text UI, `0` horizontal overflow from `320px` to `1440px`).
- **Keyboard & Assistive Tech:** Full tablist & topbar utility keyboard navigation, non-modal pinned popovers (`role="dialog" aria-modal="false"`, `Escape` dismissal, surviving trigger focus return), polite live-region announcements (zero per-second TTL chatter), and `@media (prefers-reduced-motion: reduce)` compliance.

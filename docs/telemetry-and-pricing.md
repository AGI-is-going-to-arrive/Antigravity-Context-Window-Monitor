# Telemetry, Pricing & Opt-In CLI Status Line (`v1.18.0`)

This guide documents the measurement definitions, heuristics, 10-currency pricing contract, export guarantees, and `agy-statusline.mjs` setup in **Antigravity Context Window Monitor**.

## 1. Prompt Cache: Measured Reuse vs. 5-Minute Idle TTL Heuristic

- **Additive prompt token accounting:** In Antigravity protobuf payloads, `cacheReadTokens` and `cacheCreationTokens` are additive with fresh `inputTokens`:
  `totalPromptTokens = inputTokens + cacheReadTokens + cacheCreationTokens`.
- **Provider-measured reuse classification (`src/telemetry-metrics.ts`):**
  - **Warm (`>=70%`)**, **Partial (`10%–69%`)**, **Cold (`<10%`)**, or **Unknown** when counts are missing (`null` is strictly preserved and never coerced to `0`).
- **Local 5-minute idle TTL heuristic:**
  - Keyed strictly by `{ account, backend, conversation, model, branch }` on the most recent valid cache event.
  - **Thresholds:** `>=180s` idle → **Warning**; `>=300s` idle → **Likely Expired**.
  - **Clock & sleep guards:** Large consecutive tick gaps (`>=90s`, indicating OS suspend/resume) and backwards clock jumps invalidate the local timer rather than reporting false warmth.
  - **Epistemic boundary:** The UI explicitly separates **provider-measured reuse** from the **local idle-timer estimate**, and labels cache-miss explanations (model switch, idle window, compaction/rewind, or prompt edit) as **possible causes** unless directly proven by recorded call metadata.

## 2. Model-Call Speed (Decode vs. E2E) & Anomaly Filters

- **Two explicit throughput modes (`speedMetricMode`):**
  - **Decode (`decode`, default):** `outputTokens / streamingSeconds` (`streamingSeconds` strictly excludes `ttftSeconds`).
  - **Model-Call E2E (`e2e`):** `outputTokens / (ttftSeconds + streamingSeconds)`. Explicitly scoped to **model-call duration only** — excludes local tool execution and whole-turn orchestration wall time.
- **Weighted aggregation & edge states:**
  - Weighted averages use **ratio of sums** across valid calls only, displaying explicit sample coverage (e.g., `12/15 calls`).
  - Distinct states prevent misleading spikes or fake zeros: `waiting` (in-flight pre-TTFT), `short sample` (`<16` output tokens or `<0.3s` streaming), `missing` (`—`), and exact `0`.
  - No disjoint thinking or tool-execution timeline bar is ever fabricated from token counts or tool names.
- **Model Calls anomaly filters (`DEFAULT_GM_ANOMALY_THRESHOLDS`):**
  - Slow TTFT (`>=5.0s`), Cache Miss (`<10%` reuse with `>=1,000` prompt tokens), High Cost (`>=$0.25`), High Context (`>=80%` or `>=200k`), and Errors/Retries.

## 3. Quota Horizons, Direction & Weekly Active-Hours Forecast

- **Quota window and direction.** Choose 5-hour, weekly or **Lower remaining quota**. Automatic selection compares the available readings in each model pool, uses the sole reported window when only one is available, and chooses 5-hour when both match. The result names the actual window and shows remaining or used quota. A missing reading stays unavailable.
- **Rolling 45-minute burn-rate runway (`src/quota-runway.ts`):** Filters `<0.1%` jitter, resets on `>=+5%` or `>=90%` recoveries and reset-time rollovers, and isolates `custom-*` / BYOK models so Google pool warnings never misfire.
- **Persistent Weekly Active-Hours Forecast:**
  - Persists bounded DST-safe UTC hourly buckets (`MAX_WEEKLY_HOURLY_BUCKETS = 336`, `MAX_WEEKLY_SERIES = 64`) keyed by `{ account, pool, window, resetEpoch }`.
  - Requires verified **user-activity evidence** per bucket, deduplicates simultaneous App + IDE observations, excludes offline gaps (`>=2h`), handles fractional resets and 23h/25h DST days, and requires minimum coverage (`>=2` active hours across `>=2` distinct local calendar days and `>=24h` wall span) before leaving **`Insufficient history`**.

## 4. 10-Currency Data Contract & API Reference Pricing

`src/core/currency.ts` provides a single pure-TypeScript contract across Overview, Model Calls, Usage & Cost, IDE Status Bar, CDP overlays, and `agy-statusline.mjs`:

| Currency | Standard Symbol | Compact Symbol | Standard / Compact Decimals | Built-In Reference Rate (per 1 USD) |
| --- | --- | --- | :---: | ---: |
| `USD` | `$` | `$` | `2` / `2` | `1.00` |
| `CNY` | `¥` | `¥` | `2` / `2` | `7.25` |
| `EUR` | `€` | `€` | `2` / `2` | `0.92` |
| `JPY` | `JP¥` | `¥` | `0` / `0` | `154` |
| `GBP` | `£` | `£` | `2` / `2` | `0.79` |
| `KRW` | `₩` | `₩` | `0` / `0` | `1,390` |
| `HKD` | `HK$` | `HK$` | `2` / `2` | `7.78` |
| `TWD` | `NT$` | `NT$` | `2` / `0` | `32.4` |
| `CAD` | `CA$` | `CA$` | `2` / `2` | `1.38` |
| `AUD` | `A$` | `A$` | `2` / `2` | `1.54` |

- **Contract guarantees:** Dynamic currency-converted micro-cost thresholds (converting `$0.01` / `$0.001` at the active rate), strict 5-way distinction (`unknown` / `exact 0` / `micro_positive` / `positive` / `negative`), `customFxRate` strictly bound to `customFxCurrency` (cleared on currency switch), finite-product validation, and sum-before-round aggregation.
- **Built-in API-equivalent USD rates (per 1M tokens):**
  - **Gemini 4 Neon:** `$3.00` in / `$15.00` out & thinking / `$0.15` cache read / `$0` write.
  - **Gemini 4 Hydrogen:** `$1.50` in / `$7.50` out & thinking / `$0.075` cache read / `$0` write (`M578` Sonar unpriced).
  - **Gemini 4 Carbon / Argon:** `$2.00 → $4.00` in / `$10.00 → $20.00` out / `$0.10 → $0.20` cache read (intro rate ends **`2026-12-01` UTC**).
  - **Claude Opus 5.5:** `$4.00` in / `$20.00` out / `$0.20` cache read / `$5.00` write (5m TTL).
  - **Claude Sonnet 5.5:** `$2.00` in / `$10.00` out / `$0.10` cache read / `$2.50` write (5m TTL).
  - **Gemini 3.8 / 3.7 / 3.6 Flash:** `$0.75 → $1.50` in / `$3.75 → $7.50` out / `$0.075 → $0.15` read / `$0.9375 → $1.875` write (promo ends **`2027-01-01` UTC**).
  - **GPT-OSS 120B (Medium):** `$0.09` in / `$0.36` out (`Notice` sunset badge when reported).
  - **Orchestrators (`M537`/`M667`/`M681`/`M669`):** `mapped` mode (default) uses verified Gemini 4 base rates; `strict` mode marks unpriced until custom rates are entered. Custom overrides always take highest precedence.
- **Plan ROI disclaimer:** Optional **Subscription Plan ROI** (`Google AI Pro $19.99/mo`, `Google AI Ultra 5x $99.99/mo`, `Google AI Ultra 20x $199.99/mo`, or custom fee) lives in the collapsible Advanced section of **Usage & Cost**. It displays an **API-equivalent reference ratio, not actual billing or subscription charges**.

## 5. Workspace Attribution, Swarm Costs & Safe Exports

Open **Member details** in Overview or Sessions, then **Open member overview** to request that member’s own measurements. In Usage & Cost, **Recorded group cost** lists members with recorded calls. A missing call history or missing reference price leaves the corresponding estimate unavailable. Group totals deduplicate calls. The current group’s session history can cover a different interval from the selected calendar ledger.


- **Ingestion-time workspace attribution:** Calls record `{ account, authority, cascadeId, workspace }` at ingestion and preserve workspace attribution across archival settlement and conversation deletion. Historical or ambiguous rows without workspace provenance are grouped honestly under **`Unattributed`** (never proportionally split).
- **Swarm cost separation:** Displays each worker's **direct cost** alongside the **deduplicated inclusive Swarm group total** (deduplicated by unique logical call ID) and explicit **unpriced call count**.
- **Unified Markdown / CSV / JSON exports:** All three formats share identical subject, surface, timezone, week-start, and date-range filters. An **empty date selection exports empty** (never falling back to all history). CSV normalizes leading whitespace and neutralizes spreadsheet formula prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`); Markdown escapes untrusted cells and links; JSON preserves raw numeric USD, currency code, applied FX rate, exact `0` vs `null`, and provenance tags (`measured` / `estimated` / `stale` / `unreported`).

## 6. Opt-In Read-Only `agy` CLI `statusLine` (`agy-statusline.mjs`)

Bundled with the App plugin at `~/.gemini/config/plugins/antigravity-context-monitor/bin/agy-statusline.mjs` (zero external runtime dependencies):

- **Configuration (`~/.gemini/antigravity-cli/settings.json`):**
  ```json
  {
    "statusLine": {
      "command": "node",
      "args": [
        "/Users/<you>/.gemini/config/plugins/antigravity-context-monitor/bin/agy-statusline.mjs",
        "--currency", "USD",
        "--basis", "compaction"
      ]
    }
  }
  ```
- **Flags & env vars:** `--currency <USD|CNY|EUR|JPY|GBP|KRW|HKD|TWD|CAD|AUD>`, `--fx-rate <n>`, `--basis <compaction|native>`, `--no-color` / `--color`, `--show-title`, `--max-width <cols>`, `--timeout-ms <ms>`, `--version`, `--help` (`NO_COLOR`, `ACM_CURRENCY`, `ACM_CUSTOM_FX_RATE`, `ACM_CONTEXT_BASIS`).
- **Safety & fidelity:** Enforces a `64 KB` stdin cap and `1500 ms` read timeout; strips ANSI/OSC/newlines/bidi control sequences from titles and model names; exits cleanly on `EPIPE`; emits strictly one sanitized line using the shared `context-display` and `currency` contracts; prints `—` for omitted metrics and **never** falls back to unrelated cached App sessions.

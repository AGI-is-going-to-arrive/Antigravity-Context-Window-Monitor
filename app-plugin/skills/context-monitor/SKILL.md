---
name: context-monitor
description: >-
  Open the Antigravity Context Monitor sidecar panel to inspect real-time
  context window utilization, Swarm/subagent live tracking, token category
  breakdown, prompt cache 5m TTL diagnostics, model-call Decode/E2E speed,
  10-currency session/workspace costs, and 5h/7d quota runway. Use when the
  user asks about context usage, token limits, Swarm workers, quota remaining,
  cache efficiency, or wants to open the Context Monitor panel.
---

# Antigravity Context Monitor

Use this skill when the user wants to inspect their live context window usage,
Swarm/subagent activity, token breakdown, prompt cache diagnostics, model quota
runway, workspace spend, or open the Context Monitor UI inside Antigravity App.

## Opening the Monitor Panel

When the `antigravity-context-monitor` plugin and its `context_monitor` sidecar
are enabled and running, present a single clickable pill to toggle the side pane
(`AUX_PANE`):

[Context Monitor](sidecar://antigravity-context-monitor/context_monitor/)

Users can also open the full-width dashboard (`SIDEBAR` view) from **Plugins >
Context Monitor** in the left sidebar of Antigravity App, or via the side panel
**`+`** menu.

## If the Panel Is Not Enabled Yet

If the sidecar is not running yet, do not emit a dead `sidecar://` link.
Instead, guide the user to enable the plugin and sidecar in Customizations:

1. Open [Antigravity Context Monitor](customization://antigravity-context-monitor).
2. Ensure the plugin is enabled and turn on the **Context Monitor** sidecar.
3. Once active, open **Context Monitor** from the side panel **`+`** menu or
   **Plugins** in the left sidebar.

## Six dashboard tabs in v1.18.2

1. **Overview (`overview`):** Single immutable observation (`PublishedMonitorObservation`) with dual-cap context limits (compaction vs native), interactive 9-category Bar/Dot-Matrix breakdown, live **Swarm / Subagent Tracking Strip** (20+ workers via read-only allowlisted `members.json`/`swarm.json`, one-click **Inspect** + pinned banner + **Back to Main** preserving `lockedRootId`), **3-Field Root Lock** resisting subagent/new-chat hijacks, **Handoff v2** (allowlisted previewable continuation prompt), read-only **Compaction Recovery Brief**, `5h`/`7d` quota pools, and AI credits.
2. **Model Calls (`gm`):** Model-call **Decode vs E2E** speed (`output / (TTFT + streaming)`), local 5-minute **Prompt Cache Idle TTL** heuristic (`180s` warn / `300s` expire) + possible miss causes, anomaly filters (`Slow TTFT`, `Cache Miss`, `High Cost`, `High Context`, `Errors/Retries`), Orchestrator Split, Recent Calls Ledger, and activity timeline.
3. **Sessions (`sessions`):** Searchable conversation & Swarm hierarchy grouped by workspace with positive workspace-root OS Reveal links (Brain, `.pb` archive, workspace folder).
4. **Usage & Cost (`calendar`):** 52-week multi-source (`All / App / IDE / CLI`) heatmap, ingestion-time **Workspace Leaderboard** (`Unattributed` for legacy rows), **10-currency** API-equivalent pricing (incl. **`CAD`** `CA$`), direct vs deduplicated Swarm group costs, collapsible **Advanced Plan ROI** (API reference ratio, not actual billing), and unified **Markdown / CSV / JSON** exports.
5. **Models & Quotas (`models`):** Shared model quotas appear once. The account section links back to them and keeps AI credits separate. Includes `5h`/`7d`/`tightest` & `remaining`/`used` quota controls, **Weekly Active-Hours Forecast**, Orchestrator Settings, and zero-day model specifications.
6. **Settings:** Open Version & Updates, configure display, telemetry, currency and overlays, or manage settings backups and diagnostics. About opens from the top bar. All 18 historical tab aliases remain supported.

## Checking Status, Upgrading & Opt-In CLI `statusLine`

- **In-panel update check:** Check GitHub Releases and apply fail-closed `SHA256SUMS.txt`-verified updates from **Settings** or **About**.
- **CLI status & upgrade:** From a checkout (or via root `AGENTS.md` zero-clone one-liner):
  - Status & remote check: `node scripts/install-app-plugin.mjs --status --check-remote` (add `--json` to verify `version` & `buildId`)
  - Upgrade from GitHub Releases: `node scripts/install-app-plugin.mjs --upgrade`
  - Explicit local install (zero silent remote fallback): `node scripts/install-app-plugin.mjs --install --local-dir dist/antigravity-context-monitor-app --no-remote-fallback`
- **Safe reload rule:** Never force-quit or kill the running Antigravity App process during an active session. After upgrading files on disk, guide the user to open [Antigravity Context Monitor](customization://antigravity-context-monitor) and toggle the plugin **Off → On**.
- **Opt-in read-only `agy` CLI `statusLine`:** Point `~/.gemini/antigravity-cli/settings.json` at `~/.gemini/config/plugins/antigravity-context-monitor/bin/agy-statusline.mjs` (`--currency <10 codes>`, `--basis <compaction|native>`, `--no-color`).

## Optional CDP Desktop Overlays (Strictly Opt-In, Zero Binary Patching)

Core `AUX_PANE`, `SIDEBAR`, and the **Native Panel Compact HUD** operate natively with zero CDP flags and zero modification of `app.asar` or host binaries. Only if the user explicitly opts into the **Composer Context Ring** or **Top-Right 4-View Status Bar** Shadow DOM overlays:

- **Recommended (1-click, auto-update proof):** Click **Create Persistent Launcher** in **Settings → Overlays & CDP** (or run `node scripts/install-app-plugin.mjs --setup-cdp-launcher`) to create `/Applications/Antigravity (CDP).app` (macOS, fallback `~/Applications`, confirmation dialog defaults safely to **`Cancel`**), Desktop/Start Menu direct `.lnk` shortcuts (Windows), or `~/.local/share/applications/antigravity-cdp.desktop` (Linux), then click **Reveal in Finder / Explorer / Folder** in Settings.
- **Manual terminal relaunch:**
  1. **Quit Antigravity App completely first** (macOS: `Cmd+Q` and wait ~5s for background `language_server` teardown; Windows/Linux: close all windows and tray icon). Never kill the app yourself during an active chat.
  2. **Relaunch with `--remote-debugging-port=0`:**
     - **macOS (race-free):** `while pgrep -f '^/Applications/Antigravity\.app/Contents/MacOS/Antigravity($| )' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0`
     - **Windows (PowerShell):** `& "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0`
     - **Windows (CMD / Shortcut target):** `"%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0`
     - **Linux:** `antigravity --remote-debugging-port=0`
  3. Open **Settings → Overlays & CDP** in Context Monitor and click **Recheck CDP**.

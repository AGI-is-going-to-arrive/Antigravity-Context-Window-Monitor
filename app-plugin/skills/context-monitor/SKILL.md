---
name: context-monitor
description: >-
  Open the Antigravity Context Monitor sidecar panel to inspect real-time
  context window utilization, token category breakdown, prompt cache hit rate,
  session cost, and model quota runway. Use when the user asks about context
  usage, token limits, quota remaining, cache efficiency, or wants to open the
  Context Monitor panel.
---

# Antigravity Context Monitor

Use this skill when the user wants to inspect their live context window usage,
token breakdown, prompt cache diagnostics, model quota runway, or open the
Context Monitor UI inside Antigravity App.

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

## What the Monitor Shows

- **Context Window & Dual-Cap Budget**: Effective autocompact budget vs native
  model ceiling, with a dot-matrix and category breakdown (`system`, `rules/skills`,
  `plugins/MCP`, `subagents`, `user`, `assistant/thinking`, `tools`) and top
  heaviest items.
- **Prompt Cache & Turn Diagnostics**: Last-turn and session cumulative cache
  hit rate, Cold/Partial/Warm start classification, and net context growth.
- **Model Quota Runway**: 5-hour and weekly pools, reset countdowns, burn-rate
  runway estimates, and custom-model isolation.
- **Conversation Switcher & Quick Actions**: Lock to Main Agent toggle,
  multi-conversation selector, one-click `/context` report copy, and compact
  handoff prompt generator.

## Checking Status & Upgrading

When the user asks to check their installed version, verify plugin health, or
upgrade Antigravity Context Monitor:

- **In-panel update check:** Users can check for new GitHub Releases and apply
  verified updates directly from the **Settings** / **About** panel inside
  Context Monitor.
- **CLI status & one-command upgrade:** From a repository checkout (or using the
  zero-clone one-liner in root `AGENTS.md`), run:
  - Status & remote check: `node scripts/install-app-plugin.mjs --status --check-remote`
  - Upgrade from GitHub Releases (SHA-256 verified, atomic swap): `node scripts/install-app-plugin.mjs --upgrade`
- **Safe reload rule:** Never force-quit or kill the running Antigravity App
  process during an active session. After upgrading files on disk, guide the
  user to open [Antigravity Context Monitor](customization://antigravity-context-monitor)
  and toggle the plugin **Off → On** so the sidecar loads the new version safely.

## Optional CDP Desktop Overlays (Strictly Opt-In)

Core `AUX_PANE`, `SIDEBAR`, and the **Native Panel Compact HUD** work 100%
natively without CDP. Only if the user explicitly wants the optional Composer
Context Ring or Top-Right Status Bar floating overlays inside Antigravity App
(zero `app.asar` patching), recommend the 1-click Persistent CDP Launcher first:

- **Recommended (1-click, auto-update proof):** Click **Create Persistent
  Launcher** in **Settings → Overlays & CDP** (or run
  `node scripts/install-app-plugin.mjs --setup-cdp-launcher`) to create
  `~/Applications/Antigravity (CDP).app` (macOS), Desktop/Start Menu `.lnk`
  (Windows), or `~/.local/share/applications/antigravity-cdp.desktop` (Linux).
  It waits cleanly for Antigravity's ~5s background shutdown and launches with
  `--remote-debugging-port=0` without patching any host binaries.
- **Manual terminal relaunch:**
  1. **Quit Antigravity App completely first** (macOS: press `Cmd+Q` and wait
     ~5s for background `language_server` teardown to complete — running
     `open -a` while the old PID is still exiting silently ignores `--args`;
     Windows/Linux: close all windows and tray icon). Never kill the app
     yourself during an active chat.
  2. **Relaunch with `--remote-debugging-port=0`:**
     - **macOS (race-free):** `while pgrep -f '^/Applications/Antigravity\.app/Contents/MacOS/Antigravity($| )' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0`
     - **Windows (PowerShell):** `& "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0`
     - **Windows (CMD / Shortcut target):** `"%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0`
     - **Linux:** `antigravity --remote-debugging-port=0`
  3. Open **Settings → Overlays & CDP** in Context Monitor and click **Recheck CDP**.

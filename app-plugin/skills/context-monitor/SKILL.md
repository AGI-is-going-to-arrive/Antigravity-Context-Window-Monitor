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

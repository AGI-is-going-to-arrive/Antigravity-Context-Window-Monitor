# Opt-In Zero-Patch CDP Overlays & Persistent Launchers (`v1.18.0`)

Core **Antigravity App** Sidecar views (`AUX_PANE` and `SIDEBAR`) and the **Native Panel Compact HUD** work natively with **zero CDP flags**. Desktop floating overlays (**Composer Context Ring** and **Top-Right 4-View Status Bar**) are strictly opt-in (both default `OFF`) and require **zero modification** of `app.asar`, `Info.plist`, `language_server`, or host binaries.

## 1. 1-Click Zero-Patch Persistent Launchers (Auto-Update Proof)

Create or remove the persistent launcher from **Settings → Overlays & CDP** (**Create Persistent Launcher** / **Reveal in Finder / Explorer / Folder** / **Remove Launcher**) or via CLI:

```bash
node scripts/install-app-plugin.mjs --setup-cdp-launcher
node scripts/install-app-plugin.mjs --remove-cdp-launcher
node scripts/install-app-plugin.mjs --print-cdp-guide
```

| Platform | Generated Artifacts | Behavior & Safety Notes |
| --- | --- | --- |
| **macOS** | `/Applications/Antigravity (CDP).app` (falls back to `~/Applications/Antigravity (CDP).app`, cleaning up stale duplicates) | Native `CDP`-badged `.icns` icon, `LSUIElement=true`, foreground-activated confirmation dialog with **`Cancel` as the default button** (safe against accidental Enter), Automation TCC fallback alert, and a 15-second race-free teardown wait loop before passing `--remote-debugging-port=0`. **Dock pinning:** drag `Antigravity (CDP).app` from Finder onto the Dock — do **not** click *Options → Keep in Dock* on the running `Antigravity` icon. |
| **Windows** | OneDrive-aware Desktop & Start Menu direct `.lnk` shortcuts + `CDP`-badged `.ico` | Points directly to `Antigravity.exe --remote-debugging-port=0` with `WindowStyle=1` (native Pin to Taskbar, zero CMD flash); automatically cleans up legacy `launch-antigravity-cdp.cmd`. |
| **Linux** | `~/.local/share/applications/antigravity-cdp.desktop` + `~/.local/bin/antigravity-cdp` + `~/.local/share/icons/hicolor/scalable/apps/antigravity-cdp.svg` | Detects running standard, Snap, and AppImage Antigravity processes while excluding helpers/IDE, shows a non-killing conflict notice (`zenity` → `kdialog` → `notify-send` → `stderr`), sets `StartupWMClass=Antigravity`, escapes Freedesktop `Exec=`, and runs best-effort `update-desktop-database`. |

## 2. Manual Terminal Relaunch (Zero Binary Patching)

Always **quit Antigravity App completely first** (never kill an active session from an AI agent):
- **macOS (`Cmd+Q`, wait ~5s for background `language_server` teardown):**
  ```bash
  while pgrep -f '^/Applications/Antigravity\.app/Contents/MacOS/Antigravity($| )' >/dev/null; do sleep 0.5; done; open -a "/Applications/Antigravity.app" --args --remote-debugging-port=0
  ```
- **Windows (PowerShell):**
  ```powershell
  & "$env:LOCALAPPDATA\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0
  ```
- **Windows (CMD / Shortcut target):**
  ```cmd
  "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=0
  ```
- **Linux:**
  ```bash
  antigravity --remote-debugging-port=0
  ```
Then open **Settings → Overlays & CDP** and click **Recheck CDP**.

## 3. v1.18.0 Overlay UX & Stability Upgrades

- **Unified Observation Parity (D9):** Both the Composer Context Ring and Top-Right Status Bar render from the exact same `PublishedMonitorObservation` as Overview and Native HUD (matching `subjectCascadeId`, `dataRevision`, denominator basis, overflow text, and Swarm member summary inside the Context popover).
- **Split-Pane Focus Preservation (`?focused=` / `%2B`):** Explicitly parses `?focused=` and encoded `%2B` split-pane parameters via a single unified `isInsideUnfocusedPane` helper, and guards overlay trigger `mousedown` with `e.preventDefault()` so clicking pills or rings never steals focus from the active chat composer.
- **Zero Streaming Reflow Churn:** Narrows `MutationObserver` scope to skip streaming assistant message body mutations; uses `250ms` hover-intent before opening popovers and `350ms` sibling grace for instant cross-pill switching across the 4 TopBar views (`Quota`, `Context`, `Speed`, `Total`).
- **Layout, Accessibility & Presets:** Top Layer popovers (`popover="manual"`) escape host stacking contexts; inline Windows WCO `computeWcoInsetPx(false) === 0` avoids blank gaps; adds `compact` / `normal` / `large` font-size presets (`cdpOverlayFontSize`), high-contrast palette toggle (`cdpOverlayHighContrast`), localized `aria-label` attributes, and honest `0%` / `—` rendering (never mislabeling unknown readings as `Healthy`).
- **Full 18-Alias `openPanel` Routing:** Clicking **Open Panel** routes seamlessly across all 5 v1.18.0 primary tabs (`overview`, `gm`, `sessions`, `calendar`, `models`), topbar views (`settings`, `about`), and all historical aliases (`gmdata`, `gm-data`, `activity`, `chats`, `chat-history`, `usage`, `cost`, `pricing`, `profile`, `account`, `accounts`).

## 4. Multi-Window Security & Dock Self-Heal (`src/app/cdp-injector.ts`)

- **Positive Hub Identification:** Requires positive host/browser-session/Hub matching rather than attaching to arbitrary loopback tabs. Explicit `--remote-debugging-port=<N>` takes precedence over stale `DevToolsActivePort` files; Sidecar/DevTools targets are explicitly excluded.
- **Per-Target Origin-Bound Grants:** Each attached Hub window receives an isolated, Origin-bound, minimal-capability `X-Monitor-Token` credential (`POST /api/overlay/action`, `16 KB` body limit, command allowlist: `openPanel`, `refresh`, `togglePause`, `focusConversation`). Credentials are immediately revoked on target navigation, detach, toggle-off, or restart.
- **Pure Trusted-Types Shadow DOM:** Zero `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function`. Every overlay bundle carries a content-hash `CDP_OVERLAY_BUILD_ID` for automatic hot-swap on rebuilds.
- **2.5s `no_hub_target` Dock Self-Heal:** When all macOS Antigravity windows are closed (keeping the app resident in the Dock) and a new window is reopened, the injector uses a fast `2.5s` recovery backoff (`DEFAULT_FAST_RECOVER_BACKOFF_MS`) so overlays reattach smoothly without manual intervention.
- **Zero-Probe Off State:** While both overlay toggles are `OFF`, the Sidecar performs zero CDP port scans, zero OS process probes, and zero WebSocket connections.

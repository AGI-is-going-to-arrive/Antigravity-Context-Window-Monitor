# Architecture & Multi-Agent Telemetry Design (v1.18.0)

This guide summarizes the v1.18.0 dual-host architecture shared across **Antigravity App** (native Sidecar plugin), **Antigravity IDE** (VS Code VSIX extension), and opt-in **`agy` CLI** (`statusLine`).

## 1. Pure Shared Core (`src/core/*`)

All cross-surface contracts live in pure TypeScript modules under `src/core/` with **zero `vscode` runtime imports** and **zero external npm runtime dependencies**:

| Module | Responsibility |
| --- | --- |
| `src/core/context-display.ts` | Builds the deeply-frozen `PublishedMonitorObservation` and projects it identically onto Overview, Native HUD, CDP Topbar, CDP Composer Ring, and IDE Status Bar. |
| `src/core/swarm-registry.ts` | Read-only allowlisted Swarm/subagent topology registry (`members.json` / `swarm.json`), anomaly resolver, `SwarmPollScheduler`, and deduplicated direct vs inclusive group cost aggregator. |
| `src/core/currency.ts` | 10-currency data contract (`USD/CNY/EUR/JPY/GBP/KRW/HKD/TWD/CAD/AUD`), unambiguous symbols, dynamic micro-cost thresholds, currency-bound `customFxRate`, and sum-before-round aggregation. |
| `src/core/gm-context-fallback.ts` | Shared latest-GM context reader using normalized timestamps + step/call ordering, rejecting stale pre-compaction or pre-rewind readings across both App and IDE. |
| `src/core/pricing-validation.ts` | Custom rate validation, subscription plan normalization, and allowlisted settings backup/import validation. |
| `src/core/model-catalog-sync.ts` | Unified model catalog normalization and zero-day unknown-model adaptation. |
| `src/core/release-security.ts` | Strict HTTPS `443` GitHub allowlist, fail-closed `SHA256SUMS.txt` verification, repo/tag/asset binding, and zip-slip / symlink checks. |
| `src/core/cdp-launcher-core.ts` | Shared cross-platform persistent CDP launcher path resolution, quoting, and status logic. |
| `src/core/external-url.ts` | Shared URL allowlist validator decoupling IDE Webview from Sidecar runtime. |
| `src/core/version.ts` | Single-source manifest/bundled version resolver (`ACM_APP_VERSION` / `plugin.json` / `package.json`). |

## 2. Unified Immutable Observation (`PublishedMonitorObservation`)

Every telemetry cycle publishes one deeply-frozen `PublishedMonitorObservation` carrying:
- **Scope & revisions:** `backendEpoch`, `windowId`, `rootCascadeId`, `subjectCascadeId`, `subjectKind` (`main` | `worker` | `subagent`), `selectionRevision`, `dataRevision`.
- **Context & dual caps:** `measuredModel` (distinct from Swarm manifest `assignedModel`), `tokenSource`, `usedTokens`, `compactionLimit` + `compactionLimitProvenance`, `nativeLimit` + `nativeLimitProvenance`, `requestedBasis`, `actualBasis`, `primaryPct`, `primaryPctRaw` (un-clamped overflow text), `geometryFillPct` (clamped `0–100%`), `healthStatus`, `compactionWarningLevel`, and active-axis `markers` (`200k`, `Compaction`).
- **Speed & cost sample identity:** `speedMode` (`decode` | `e2e`), `speedSampleScope`, `speedCallId`, `displaySpeedTps`, `sessionCostUsd`.
- **Edge states:** Confirmed 0-step fresh conversations emit `isZeroStepFresh: true` (`0%`, no speed/cost); missing or partial measurements emit `isIncomplete: true` (`—`). Every surface rendering the same `(subjectCascadeId, dataRevision)` projects from this single observation, guaranteeing identical numbers, denominators, rounding, and severity.

## 3. Per-Window 3-Field Lock State Machine (`src/conversation-selector.ts`)

Shared preferences (`AppSettings` synced via `state-v1.json`) are strictly separated from window-local focus and locking state scoped to `{ backendEpoch, windowId }`:

```text
{ observedHostFocus, lockedRootId, inspectedMemberId }
```

1. **Absolute root-lock precedence:** When Lock is enabled and `lockedRootId` is not confirmed deleted in the current `backendEpoch`, `lockedRootId` overrides **all** passive inputs — blank-new-chat detections, unseen host IDs, child-only inventories, `SIDEBAR` empty focus, and background worker activity.
2. **Synchronous root anchoring:** Toggling Lock captures the root synchronously without awaiting persistence; if a worker is currently inspected, Lock walks the topology upward to anchor its `rootId`.
3. **Worker inspection preserves root anchor:** Clicking **Inspect** on a Swarm member sets `inspectedMemberId` without mutating `lockedRootId`. A pinned banner identifies the inspected worker and **Back to Main** restores the root anchor immediately.
4. **3-level authority hierarchy:**
   - **Level 1 (Explicit user action):** Pin, Lock/Unlock, Inspect/Back-to-Main, explicit Retarget.
   - **Level 2 (Authenticated host SDK):** Same-window `window.sidecar` callbacks (newer callbacks outrank stale getters).
   - **Level 3 (Passive CDP DOM hints):** Explicit `?focused=` / focused split-pane parsing only; acknowledged per `focusRevision`.
5. **Transient absence vs confirmed deletion:** Single-poll inventory omissions surface a `Pending/Unavailable` state while retaining `lockedRootId` instead of prematurely marking the conversation deleted.

## 4. Authoritative Read-Only `SwarmRegistry` & `SwarmPollScheduler`

- **Strict manifest allowlist:** Opens **only** `members.json` and `swarm.json` under the owning host/profile brain directory (`ANTIGRAVITY_BRAIN_DIR` / `ANTIGRAVITY_DATA_DIR` / `~/.gemini/antigravity/brain`; never mixes local brain directories onto Remote-SSH/WSL backends). **Never** reads `board.jsonl`, `transcript.jsonl`, `plan.json`, `steps/`, or prompt bodies, and **never** writes `.system_generated/swarm/`.
- **Filesystem & budget safety:** Validates single-segment `cascadeId`, verifies ancestor symlinks and Windows junctions, matches `lstat`+`open`+`fstat` (`dev`/`ino`), caps streaming reads at `512 KB` per file (`4 MB` / `200` dirs / `1,500 ms` per sweep with a continuation cursor), preserves last valid manifest during short partial-write TTL (`10s`), and handles same-size/same-mtime replacements and deletions.
- **Explicit topology anomalies:** Separately tracks `directParentId`, `rootId`, `relationshipKind` (`swarm_member` | `direct_subagent` | `nested_helper` | `fork`), `evidenceSource`, and flags for unknown parents, conflicting manifests, 0/multiple coordinators, nested sub-swarms, duplicate names, forks, orphans, cycles, deleted coordinators, and unknown roles (never auto-classifying unknown roles as workers).
- **Fair-budget per-backend scheduling:** Coordinates GM, Activity, Steps, Image, and Swarm polling under shared concurrency (`<=3`), request, byte, and time budgets. Always reserves capacity for Coordinator and `inspectedMemberId`, runs one terminal refresh when a member becomes `killed`, and round-robins 20+ active workers fairly while reporting `lastObservedAt` and partial coverage.

## 5. Independent Browser Bundles & `esbuild` Zero-Runtime-Dep Artifacts

- **Client compilation (`src/client/*` + `tsconfig.client.json`):** Webview UI logic and CDP overlay logic are compiled and type-checked independently (`npm run typecheck:client`) and bundled via `esbuild` (`scripts/build-bundles.mjs`), eliminating legacy `Function.prototype.toString()` stitching. Every browser bundle embeds a 16-hex content-hash `buildId` for hot reinjection across same-version rebuilds while preserving strict CSP (`preload → bridge → client`) and Trusted-Types-safe DOM construction.
- **Isolated build & staging outputs:** Typechecking (`tsc --noEmit`), tests (`out/`), release bundle staging (`dist-stage/`), and final release archives (`dist/`) stay strictly separated. `esbuild` and `@vscode/vsce` are pinned strictly in `devDependencies` (zero runtime `dependencies`).
- **Four zero-dependency deliverables:**
  1. **IDE VSIX (`dist/antigravity-context-monitor-<v>.vsix`):** Allowlisted `.vscodeignore` shipping `dist-stage/ide/extension.js`, `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `256×256` `assets/icon.png`.
  2. **App Sidecar (`dist/antigravity-context-monitor-app-<v>.{zip,tar.gz}`):** Allowlisted plugin manifest, SVG logo, `SKILL.md`, `bin/agy-statusline.mjs`, `sidecar-bundle.js` + compatibility entry shims, and `main.mjs` enforcing positive `ACM_REAL_PROVIDER === true` verification (explicit error on failure, never silently serving an empty fallback).
  3. **Single-source CLI tools:** `scripts/install-app-plugin.mjs` and `app-plugin/bin/agy-statusline.mjs` bundled to pure Node ESM.
  4. **Canonical `dist/SHA256SUMS.txt`:** Run `npm run package` followed by `node scripts/package-app-plugin.mjs` for the three release files. Use `--app-only` for a local plugin build. The release manifest requires a VSIX from the same output directory. From 1.18.0 onward, packaging and `npm run test:dist` enforce a VSIX below 1 MiB unpacked and 400 KiB compressed, and an App ZIP below 0.55 MiB.

## 6. Security, Privacy & Persistence Boundaries

- **Sidecar transport (`SEC-01/02`):** Standalone mode serves an inert HTML shell until paired via one-time private `/api/auth/pair`; reusable credentials never appear in HTML, URLs, stdout/stderr, logs, or exports. Requests validate loopback `Host`, auth, `Origin`, `Content-Type: application/json`, and byte caps before reading bodies; ordinary commands carry zero focus or workspace-grant side effects (`workspaceUris: []` revokes grants); HTTP caching emits bodyless `304` (`200 { unchanged: true }` for SDK adapter).
- **Privacy & Reveal (`SEC-04`):** When privacy mask is active, serialization redacts accounts, emails, workspace paths, ARIA labels, diagnostics, and exports with opaque handles. OS Reveal authorizes only currently registered host workspace roots (Swarm display paths never grant filesystem access).
- **Concurrent state (`DurableState`):** Shared `state-v1.json` uses exclusive `O_CREAT | O_EXCL` locking, 3-way deep merges, committed flush receipts, and idempotent late-day archival merges for App and IDE processes sharing a local filesystem and process namespace. Remote-SSH, WSL distributions and separate machines use the state and brain directories of their own host. Network filesystems and cross-host state synchronization are unsupported.

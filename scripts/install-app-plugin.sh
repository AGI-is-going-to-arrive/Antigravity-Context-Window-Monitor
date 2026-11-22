#!/usr/bin/env bash
# Cross-platform POSIX installer wrapper for Antigravity Context Monitor App Plugin (macOS / Linux).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER_MJS="${SCRIPT_DIR}/install-app-plugin.mjs"

if [ ! -f "${INSTALLER_MJS}" ]; then
  echo "Error: installer script not found at ${INSTALLER_MJS}" >&2
  exit 1
fi

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  if command -v agy-node >/dev/null 2>&1; then
    command -v agy-node
    return 0
  fi
  # Fallback to Antigravity App's bundled Node / agy-node runtime on macOS / Linux
  local candidates=(
    "/Applications/Antigravity.app/Contents/Resources/bin/agy-node"
    "/Applications/Antigravity.app/Contents/Resources/bin/node"
    "${HOME}/Applications/Antigravity.app/Contents/Resources/bin/agy-node"
    "${HOME}/Applications/Antigravity.app/Contents/Resources/bin/node"
    "${HOME}/.gemini/bin/agy-node"
    "${HOME}/.gemini/bin/node"
    "${HOME}/.gemini/antigravity/bin/agy-node"
    "${HOME}/Library/Application Support/Antigravity/bin/agy-node"
    "${HOME}/.config/Antigravity/bin/agy-node"
    "/usr/lib/antigravity/resources/bin/agy-node"
    "/opt/Antigravity/resources/bin/agy-node"
  )
  for c in "${candidates[@]}"; do
    if [ -x "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

find_electron_node_helper() {
  local helpers=(
    "/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper"
    "${HOME}/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper"
  )
  for h in "${helpers[@]}"; do
    if [ -x "$h" ]; then
      printf '%s\n' "$h"
      return 0
    fi
  done
  return 1
}

NODE_BIN="$(find_node || true)"
if [ -n "${NODE_BIN}" ]; then
  exec "${NODE_BIN}" "${INSTALLER_MJS}" "$@"
fi

ELECTRON_HELPER="$(find_electron_node_helper || true)"
if [ -n "${ELECTRON_HELPER}" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "${ELECTRON_HELPER}" "${INSTALLER_MJS}" "$@"
fi

echo "Error: Node.js not found on PATH (and Antigravity bundled agy-node / Electron helper not found)." >&2
echo "错误：未找到 Node.js，也未找到 Antigravity 内置 agy-node 或运行环境。" >&2
exit 1

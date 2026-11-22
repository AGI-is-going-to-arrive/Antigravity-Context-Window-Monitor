#!/usr/bin/env bash
# Cross-platform POSIX installer wrapper for Antigravity Context Monitor App Plugin (macOS / Linux).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER_MJS="${SCRIPT_DIR}/install-app-plugin.mjs"

find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  # Fallback to Antigravity App's bundled Node runtime on macOS / Linux
  local candidates=(
    "${HOME}/Library/Application Support/Antigravity/bin/agy-node"
    "${HOME}/.config/Antigravity/bin/agy-node"
    "${HOME}/.gemini/antigravity/bin/agy-node"
  )
  for c in "${candidates[@]}"; do
    if [ -x "$c" ]; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

NODE_BIN="$(find_node || true)"
if [ -z "${NODE_BIN}" ]; then
  echo "Error: Node.js not found on PATH (and Antigravity bundled agy-node not found)." >&2
  echo "错误：未找到 Node.js，也未找到 Antigravity 内置 agy-node。" >&2
  exit 1
fi

exec "${NODE_BIN}" "${INSTALLER_MJS}" "$@"

#!/usr/bin/env bash
# Cross-platform POSIX installer wrapper for Antigravity Context Monitor App Plugin (macOS / Linux).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER_MJS="${SCRIPT_DIR}/install-app-plugin.mjs"

if [ ! -f "${INSTALLER_MJS}" ]; then
  echo "Error: installer script not found at ${INSTALLER_MJS}" >&2
  exit 1
fi

MIN_NODE_MAJOR=22

resolve_xdg_data_home() {
  local raw="${XDG_DATA_HOME:-}"
  case "${raw}" in
    /*)
      case "${raw}" in
        */../*|*/..|../*) printf '%s\n' "${HOME}/.local/share" ;;
        *) printf '%s\n' "${raw}" ;;
      esac
      ;;
    *)
      printf '%s\n' "${HOME}/.local/share"
      ;;
  esac
}

is_compatible_node() {
  local bin="$1"
  local raw_ver major
  [ -n "${bin}" ] && [ -x "${bin}" ] || return 1
  raw_ver="$("${bin}" -v 2>/dev/null)" || return 1
  raw_ver="${raw_ver#v}"
  major="${raw_ver%%.*}"
  case "${major}" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "${major}" -ge "${MIN_NODE_MAJOR}" ]
}

is_compatible_electron_helper() {
  local bin="$1"
  local raw_ver major
  [ -n "${bin}" ] && [ -x "${bin}" ] || return 1
  raw_ver="$(ELECTRON_RUN_AS_NODE=1 "${bin}" -v 2>/dev/null)" || return 1
  raw_ver="${raw_ver#v}"
  major="${raw_ver%%.*}"
  case "${major}" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "${major}" -ge "${MIN_NODE_MAJOR}" ]
}

find_node() {
  local path_bin
  # Inspect ALL node / agy-node binaries on PATH in order so an obsolete system node (< v22)
  # earlier on PATH never outranks a compatible node or bundled agy-node.
  while IFS= read -r path_bin; do
    if is_compatible_node "${path_bin}"; then
      printf '%s\n' "${path_bin}"
      return 0
    fi
  done < <(type -aP node 2>/dev/null || true)

  while IFS= read -r path_bin; do
    if is_compatible_node "${path_bin}"; then
      printf '%s\n' "${path_bin}"
      return 0
    fi
  done < <(type -aP agy-node 2>/dev/null || true)

  local xdg_data
  xdg_data="$(resolve_xdg_data_home)"
  # Fallback to Antigravity App's bundled Node / agy-node runtime on macOS / Linux
  local candidates=(
    "/Applications/Antigravity.app/Contents/Resources/bin/agy-node"
    "/Applications/Antigravity.app/Contents/Resources/bin/node"
    "${HOME}/Applications/Antigravity.app/Contents/Resources/bin/agy-node"
    "${HOME}/Applications/Antigravity.app/Contents/Resources/bin/node"
    "${HOME}/.gemini/bin/agy-node"
    "${HOME}/.gemini/bin/node"
    "${HOME}/.gemini/antigravity/bin/agy-node"
    "${HOME}/.gemini/antigravity/bin/node"
    "${HOME}/Library/Application Support/Antigravity/bin/agy-node"
    "${HOME}/.config/Antigravity/bin/agy-node"
    "${HOME}/.config/Antigravity/bin/node"
    "/usr/lib/antigravity/resources/bin/agy-node"
    "/usr/lib/antigravity/resources/bin/node"
    "/usr/share/antigravity/resources/bin/agy-node"
    "/usr/share/antigravity/resources/bin/node"
    "/opt/Antigravity/resources/bin/agy-node"
    "/opt/Antigravity/resources/bin/node"
    "/opt/antigravity/resources/bin/agy-node"
    "/opt/antigravity/resources/bin/node"
    "/snap/antigravity/current/resources/bin/agy-node"
    "/snap/antigravity/current/resources/bin/node"
    "/snap/antigravity/current/usr/share/antigravity/resources/bin/agy-node"
    "/snap/antigravity/current/usr/share/antigravity/resources/bin/node"
    "${xdg_data}/antigravity/resources/bin/agy-node"
    "${xdg_data}/antigravity/resources/bin/node"
    "${HOME}/.local/share/antigravity/resources/bin/agy-node"
    "${HOME}/.local/share/antigravity/resources/bin/node"
  )
  for c in "${candidates[@]}"; do
    if is_compatible_node "$c"; then
      printf '%s\n' "$c"
      return 0
    fi
  done
  return 1
}

find_electron_node_helper() {
  local xdg_data
  xdg_data="$(resolve_xdg_data_home)"
  local helpers=(
    # macOS Electron helpers
    "/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper"
    "${HOME}/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper"
    # Linux Electron binaries (support ELECTRON_RUN_AS_NODE=1)
    "/usr/lib/antigravity/antigravity"
    "/usr/share/antigravity/antigravity"
    "/opt/Antigravity/antigravity"
    "/opt/antigravity/antigravity"
    "/snap/antigravity/current/usr/share/antigravity/antigravity"
    "/snap/antigravity/current/antigravity"
    "/usr/bin/antigravity"
    "/usr/local/bin/antigravity"
    "${HOME}/.local/bin/antigravity"
    "${xdg_data}/antigravity/antigravity"
  )
  for h in "${helpers[@]}"; do
    if is_compatible_electron_helper "$h"; then
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

FOUND_OLD_NODE="$(command -v node 2>/dev/null || true)"
if [ -n "${FOUND_OLD_NODE}" ]; then
  OLD_VER="$("${FOUND_OLD_NODE}" -v 2>/dev/null | head -n 1 || echo "unknown")"
  echo "Error: Compatible Node.js >= ${MIN_NODE_MAJOR} not found (system node at ${FOUND_OLD_NODE} is ${OLD_VER}, and no compatible bundled agy-node / Electron helper was found)." >&2
  echo "错误：未找到兼容的 Node.js（需要 >= ${MIN_NODE_MAJOR}；当前系统 node ${FOUND_OLD_NODE} 版本为 ${OLD_VER}，且未找到可用的内置 agy-node 或运行环境）。" >&2
else
  echo "Error: Compatible Node.js >= ${MIN_NODE_MAJOR} not found on PATH (and Antigravity bundled agy-node / Electron helper not found)." >&2
  echo "错误：未找到兼容的 Node.js（需要 >= ${MIN_NODE_MAJOR}），也未找到 Antigravity 内置 agy-node 或运行环境。" >&2
fi
exit 1

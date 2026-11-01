#!/usr/bin/env bash
# Installs Sirius for this user. Safe to run again after an update.
#
#   scripts/install.sh               build, install binaries, enable the core
#   scripts/install.sh --with-mcp    also register sirius-mcp in Claude Code and Codex
#   scripts/install.sh --with-hooks  also merge agent hooks (backs up the originals first)
#   scripts/install.sh --with-desktop  also build the .deb and print the install command
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="$HOME/.local/bin"
CONFIG="$HOME/.config/sirius"
UNITS="$HOME/.config/systemd/user"

with_mcp=false with_hooks=false with_desktop=false
for arg in "$@"; do
  case "$arg" in
    --with-mcp) with_mcp=true ;;
    --with-hooks) with_hooks=true ;;
    --with-desktop) with_desktop=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

echo "Building..."
bun install --frozen-lockfile
bun run build:core
bun run build:mcp
bun run build:cli

mkdir -p "$BIN" "$CONFIG" "$UNITS"
install -m 755 dist/sirius-core dist/sirius-mcp dist/sirius "$BIN/"

# systemd starts services with a minimal PATH, so record where the CLIs really live.
path="$BIN:/usr/local/bin:/usr/bin:/bin"
env_file="$CONFIG/env.tmp"
: > "$env_file"
for tool in claude codex node; do
  if found="$(command -v "$tool")"; then
    path="$(dirname "$found"):$path"
    case "$tool" in
      claude) echo "SIRIUS_CLAUDE_BIN=$found" >> "$env_file" ;;
      codex) echo "SIRIUS_CODEX_BIN=$found" >> "$env_file" ;;
    esac
  else
    echo "Note: $tool is not on PATH, so Sirius will say so in the chat."
  fi
done
echo "SIRIUS_MCP_COMMAND=$BIN/sirius-mcp" >> "$env_file"
echo "PATH=$path" >> "$env_file"
mv "$env_file" "$CONFIG/env"

install -m 644 infra/systemd/sirius-core.service "$UNITS/"
systemctl --user daemon-reload
systemctl --user enable sirius-core
systemctl --user restart sirius-core

if $with_mcp; then
  if command -v claude >/dev/null; then
    claude mcp remove --scope user sirius >/dev/null 2>&1 || true
    claude mcp add --scope user sirius -- "$BIN/sirius-mcp" --agent claude
  fi
  if command -v codex >/dev/null; then
    codex mcp remove sirius >/dev/null 2>&1 || true
    codex mcp add sirius -- "$BIN/sirius-mcp" --agent codex
  fi
fi

$with_hooks && "$BIN/sirius" setup-hooks --apply

if $with_desktop; then
  (cd apps/desktop && bunx tauri build --bundles deb)
  echo
  echo "To install the desktop app:"
  echo "  sudo apt install ./apps/desktop/src-tauri/target/release/bundle/deb/Sirius_0.1.0_amd64.deb"
fi

echo
"$BIN/sirius" doctor

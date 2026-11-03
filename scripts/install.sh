#!/usr/bin/env bash
# Installs Sirius for this user. Safe to run again after an update.
#
#   scripts/install.sh               build, install binaries, enable the core
#   scripts/install.sh --with-mcp    also register sirius-mcp in Claude Code and Codex
#   scripts/install.sh --with-hooks  also merge agent hooks (backs up the originals first)
#   scripts/install.sh --with-desktop  also build the .deb and print the install command
#   scripts/install.sh --with-voice  also set up push-to-talk voice (downloads about 3 GB)
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="$HOME/.local/bin"
CONFIG="$HOME/.config/sirius"
UNITS="$HOME/.config/systemd/user"

with_mcp=false with_hooks=false with_desktop=false with_voice=false
for arg in "$@"; do
  case "$arg" in
    --with-mcp) with_mcp=true ;;
    --with-hooks) with_hooks=true ;;
    --with-desktop) with_desktop=true ;;
    --with-voice) with_voice=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

echo "Building..."
bun install --frozen-lockfile
bun run build:core
bun run build:mcp
bun run build:cli
(cd apps/desktop && bunx vite build)

mkdir -p "$BIN" "$CONFIG" "$UNITS"
install -m 755 dist/sirius-core dist/sirius-mcp dist/sirius "$BIN/"

# The core serves this to a paired phone (ADR 0010), so each install also updates the phone.
UI="$HOME/.local/share/sirius/ui"
rm -rf "$UI.new"
cp -r apps/desktop/dist "$UI.new"
rm -rf "$UI"
mv "$UI.new" "$UI"

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
echo "SIRIUS_UI_DIR=$UI" >> "$env_file"
if [ -n "${SIRIUS_MEMORY_FILE:-}" ]; then
  echo "SIRIUS_MEMORY_FILE=$SIRIUS_MEMORY_FILE" >> "$env_file"
fi
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

if $with_voice; then
  DATA="$HOME/.local/share/sirius"
  VENV="$DATA/voice-venv"
  groups=()
  # Whisper is 10 times faster on the GPU. Its CUDA libraries stay inside the venv.
  if nvidia-smi -L >/dev/null 2>&1; then groups=(--group gpu); fi
  UV_PROJECT_ENVIRONMENT="$VENV" uv sync --project services/voice --no-dev --no-editable "${groups[@]}"

  mkdir -p "$DATA/voices"
  # Importing piper loads onnxruntime, which reports to Microsoft unless told not to first.
  export ORT_DISABLE_TELEMETRY=1
  # A voice is a Piper catalog name, or a link to an .onnx with its .onnx.json beside it.
  fetch_voice() {
    local base
    base="$DATA/voices/$(basename "$1" .onnx)"
    if [ -f "$base.onnx" ] && [ -f "$base.onnx.json" ]; then return 0; fi
    case "$1" in
      https://*)
        curl -fL -o "$base.onnx.part" "$1"
        curl -fL -o "$base.onnx.json.part" "$1.json"
        mv "$base.onnx.part" "$base.onnx"
        mv "$base.onnx.json.part" "$base.onnx.json"
        ;;
      *) "$VENV/bin/python" -m piper.download_voices "$1" --download-dir "$DATA/voices" ;;
    esac
  }
  voice_en="${SIRIUS_VOICE_EN:-en_US-lessac-medium}"
  voice_ro="${SIRIUS_VOICE_RO:-ro_RO-mihai-medium}"
  fetch_voice "$voice_en"
  fetch_voice "$voice_ro"
  HF_HOME="$DATA/models" "$VENV/bin/python" -c \
    "from faster_whisper.utils import download_model; download_model('small')"

  {
    echo "SIRIUS_VOICE_EN=$(basename "$voice_en" .onnx)"
    echo "SIRIUS_VOICE_RO=$(basename "$voice_ro" .onnx)"
    echo "SIRIUS_VOICE_PACE=${SIRIUS_VOICE_PACE:-1.0}"
  } > "$CONFIG/voice-env"
  site="$("$VENV/bin/python" -c 'import site; print(site.getsitepackages()[0])')"
  if [ -d "$site/nvidia/cublas/lib" ]; then
    echo "LD_LIBRARY_PATH=$site/nvidia/cublas/lib:$site/nvidia/cudnn/lib" >> "$CONFIG/voice-env"
  fi

  install -m 644 infra/systemd/sirius-voice.service "$UNITS/"
  systemctl --user daemon-reload
  systemctl --user enable sirius-voice
  systemctl --user restart sirius-voice

  # Wayland does not allow app-level global hotkeys, so the shortcut lives in GNOME (F27).
  if command -v gsettings >/dev/null; then
    schema=org.gnome.settings-daemon.plugins.media-keys
    entry=/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/sirius/
    current="$(gsettings get "$schema" custom-keybindings)"
    case "$current" in
      *"$entry"*) ;;
      "@as []") gsettings set "$schema" custom-keybindings "['$entry']" ;;
      *) gsettings set "$schema" custom-keybindings "${current%]}, '$entry']" ;;
    esac
    binding="$schema.custom-keybinding:$entry"
    gsettings set "$binding" name 'Sirius push-to-talk'
    gsettings set "$binding" command "$BIN/sirius voice ptt"
    gsettings set "$binding" binding '<Control><Alt>space'
    echo "Push-to-talk shortcut: Ctrl+Alt+Space (change it in GNOME Settings, Keyboard)."
  fi
fi

if $with_desktop; then
  (cd apps/desktop && bunx tauri build --bundles deb)
  echo
  echo "To install the desktop app:"
  echo "  sudo apt install ./apps/desktop/src-tauri/target/release/bundle/deb/Sirius_0.1.0_amd64.deb"
  # Closing only hides to the tray, and a second launch raises the old process.
  echo "If Sirius is already open, restart it so the new version loads:"
  echo "  pkill -x sirius-desktop"
fi

echo
"$BIN/sirius" doctor

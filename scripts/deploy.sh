#!/usr/bin/env bash
# Applies deployment.env. Edit that file, then run this. Safe to run again.
#
#   scripts/deploy.sh [install.sh options]
#
# Switching target never deletes data: the laptop database and the Docker volume both stay.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a
# shellcheck disable=SC1091
. ./deployment.env
[ -f infra/.env ] && . infra/.env
set +a

CONFIG="$HOME/.config/sirius"
DESKTOP="$CONFIG/desktop.env"

stack() {
  local flags=()
  IFS=',' read -ra profiles <<< "${SIRIUS_PROFILES:-}"
  for profile in "${profiles[@]}"; do flags+=(--profile "$profile"); done
  DOCKER_HOST="${SIRIUS_DOCKER_HOST:-${DOCKER_HOST:-}}" \
    docker compose -p sirius -f infra/compose.yaml "${flags[@]}" "$@"
}

case "${SIRIUS_TARGET:-local}" in
  local)
    echo "Target: local. Everything stays on this laptop."
    rm -f "$DESKTOP"
    if command -v docker >/dev/null && stack ps -q 2>/dev/null | grep -q .; then
      stack down
    fi
    exec scripts/install.sh "$@"
    ;;
  remote)
    if [ -z "${SIRIUS_REMOTE_URL:-}" ]; then
      echo "Set SIRIUS_REMOTE_URL in deployment.env first." >&2
      exit 2
    fi
    echo "Target: remote at $SIRIUS_REMOTE_URL"
    stack up -d --build

    mkdir -p "$CONFIG"
    umask 077
    {
      echo "SIRIUS_CORE_URL=$SIRIUS_REMOTE_URL"
      token="$(stack exec -T core cat /data/token | tr -d '\r\n')"
      echo "SIRIUS_CORE_TOKEN=$token"
      [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && echo "CF_ACCESS_CLIENT_ID=$CF_ACCESS_CLIENT_ID"
      [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ] && echo "CF_ACCESS_CLIENT_SECRET=$CF_ACCESS_CLIENT_SECRET"
      true
    } > "$DESKTOP"

    # One writer only (ADR-2): the laptop core must not keep running beside the remote one.
    systemctl --user disable --now sirius-core 2>/dev/null || true
    echo "The desktop app now uses the remote core. Restart it to connect."
    ;;
  *)
    echo "SIRIUS_TARGET must be local or remote, not '${SIRIUS_TARGET}'." >&2
    exit 2
    ;;
esac

#!/usr/bin/env bash
set -euo pipefail

LABEL="${LABEL:-com.codex.telegram-remote}"
CONFIG_DIR="${CONFIG_DIR:-"$HOME/.codex-telegram-remote"}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"

if [[ "${REMOVE_CONFIG:-0}" == "1" ]]; then
  rm -rf "$CONFIG_DIR"
fi

echo "Removed LaunchAgent: $LABEL"

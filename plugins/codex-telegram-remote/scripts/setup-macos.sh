#!/usr/bin/env bash
set -euo pipefail
umask 077

BOT_TOKEN="${BOT_TOKEN:-}"
ALLOWED_CHAT_IDS="${ALLOWED_CHAT_IDS:-}"
DEFAULT_PROJECT="${DEFAULT_PROJECT:-}"
DEFAULT_PROJECT_PATH="${DEFAULT_PROJECT_PATH:-}"
CONFIG_DIR="${CONFIG_DIR:-"$HOME/.codex-telegram-remote"}"
LABEL="${LABEL:-com.codex.telegram-remote}"

if [[ -z "$BOT_TOKEN" || -z "$ALLOWED_CHAT_IDS" ]]; then
  echo "Set BOT_TOKEN and ALLOWED_CHAT_IDS before running setup-macos.sh" >&2
  exit 1
fi

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER_PATH="$PLUGIN_ROOT/scripts/runner.mjs"
NODE_PATH="$(command -v node)"
CODEX_BIN="${CODEX_CLI_PATH:-$(command -v codex || true)}"

python3 - "$BOT_TOKEN" <<'PY'
import json
import sys
import urllib.request

token = sys.argv[1]
try:
    with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/getMe", timeout=20) as response:
        payload = json.load(response)
except Exception as exc:
    raise SystemExit("Telegram getMe failed. Check the bot token.") from exc
if not payload.get("ok"):
    raise SystemExit("Telegram getMe failed. Check the bot token.")
PY

mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"
CONFIG_PATH="$CONFIG_DIR/config.json"

python3 - "$CONFIG_PATH" "$BOT_TOKEN" "$ALLOWED_CHAT_IDS" "$DEFAULT_PROJECT" "$DEFAULT_PROJECT_PATH" "$CODEX_BIN" <<'PY'
import json
import sys

path, token, chat_ids, default_project, default_path, codex_bin = sys.argv[1:]
aliases = {}
if default_project and default_path:
    aliases[default_project] = default_path
payload = {
    "botToken": token,
    "allowedChatIds": [item.strip() for item in chat_ids.split(",") if item.strip()],
    "completionChatIds": [item.strip() for item in chat_ids.split(",") if item.strip()],
    "defaultProject": default_project,
    "projectAliases": aliases,
    "codexBin": codex_bin,
    "executionBackend": "appServer",
    "maxConcurrentJobs": 1,
    "sendFullFinalAnswer": True,
    "telegramChunkSize": 3900,
    "projectPageSize": 8,
    "threadPageSize": 8,
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, indent=2)
    handle.write("\n")
PY
chmod 600 "$CONFIG_PATH"

PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
python3 - "$PLIST" "$LABEL" "$NODE_PATH" "$RUNNER_PATH" "$PLUGIN_ROOT" "$CONFIG_DIR" <<'PY'
import plistlib
import sys

plist_path, label, node_path, runner_path, plugin_root, config_dir = sys.argv[1:]
payload = {
    "Label": label,
    "ProgramArguments": [node_path, runner_path],
    "WorkingDirectory": plugin_root,
    "RunAtLoad": True,
    "KeepAlive": True,
    "StandardOutPath": f"{config_dir}/runner.log",
    "StandardErrorPath": f"{config_dir}/runner.err.log",
}
with open(plist_path, "wb") as handle:
    plistlib.dump(payload, handle)
PY
chmod 600 "$PLIST"

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "Configured Codex Telegram Remote"
echo "Config: $CONFIG_PATH"
echo "LaunchAgent: $PLIST"

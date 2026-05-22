# macOS Setup

macOS support uses the same Node runner with a user LaunchAgent.

## Requirements

- Codex installed and authenticated.
- Node 20.11 or newer.
- A Telegram bot token.
- Your Telegram chat ID.

## Setup

```bash
BOT_TOKEN="123456789:replace-me" \
ALLOWED_CHAT_IDS="123456789" \
./plugins/codex-telegram-remote/scripts/setup-macos.sh
```

Optional project alias:

```bash
BOT_TOKEN="123456789:replace-me" \
ALLOWED_CHAT_IDS="123456789" \
DEFAULT_PROJECT="frontend" \
DEFAULT_PROJECT_PATH="$HOME/code/frontend" \
./plugins/codex-telegram-remote/scripts/setup-macos.sh
```

The script creates:

- `~/.codex-telegram-remote/config.json`
- `~/Library/LaunchAgents/com.codex.telegram-remote.plist`

The setup script uses `umask 077`, sets the config directory to `700`, and sets the config file to `600`.

The generated config uses `executionBackend: "appServer"` by default. Telegram prompts go into existing Codex GUI conversations for the selected project. Use `/thread` in Telegram to switch conversations, or set `executionBackend` to `"cli"` if you need standalone `codex exec` jobs.

## Locked Mac Behavior

The LaunchAgent can continue while the Mac is locked if the user session remains active, the Mac is awake, and networking is available. It will not run while the Mac is shut down, asleep, or logged out.

## Logs

```bash
tail -f ~/.codex-telegram-remote/runner.log
tail -f ~/.codex-telegram-remote/runner.err.log
```

## Uninstall

```bash
./plugins/codex-telegram-remote/scripts/uninstall-macos.sh
```

Remove config too:

```bash
REMOVE_CONFIG=1 ./plugins/codex-telegram-remote/scripts/uninstall-macos.sh
```

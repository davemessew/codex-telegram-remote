# Troubleshooting

## Bot Does Not Respond

Check:

- The runner is running.
- `botToken` is valid.
- The Telegram message comes from a chat ID listed in `allowedChatIds`.
- No other process is polling the same bot token.
- The machine has network access to `api.telegram.org`.

Unauthorized chats are ignored by default. Temporarily set `replyToUnauthorized` to `true` only if you need visible feedback while debugging chat IDs.

Windows:

```powershell
Get-ScheduledTask -TaskName CodexTelegramRemote
Get-ScheduledTaskInfo -TaskName CodexTelegramRemote
```

macOS:

```bash
launchctl print "gui/$(id -u)/com.codex.telegram-remote"
```

## `/select` Shows No Projects

Codex Telegram Remote reads projects from `$CODEX_HOME/config.toml` and `projectAliases`.

Fixes:

- Open projects in Codex once so they are recorded in `[projects]`.
- Add friendly aliases to `~/.codex-telegram-remote/config.json`.
- Set `CODEX_HOME` if your Codex config lives somewhere else.

## `codex.exe` Access Denied on Windows

The Windows Store app can expose a `codex.exe` shim that PowerShell cannot execute directly. The setup script searches the Codex app-local binary first:

```text
%LOCALAPPDATA%\OpenAI\Codex\bin\*\codex.exe
```

If discovery fails, set `codexBin` in config or set `CODEX_CLI_PATH`.

## `npm.ps1` Is Blocked

Some Windows execution policies block `npm.ps1`. Use `npm.cmd`:

```powershell
npm.cmd test
```

The runner itself uses `node`, not `npm`.

## Hook Notifications Do Not Fire

Regular Codex task notifications require all of:

- Plugin installed and enabled.
- `[features].plugin_hooks = true` in Codex config.
- Hook reviewed and trusted with `/hooks`.
- `completionChatIds` configured.
- Runner config available to the hook at the default path or through `CODEX_TELEGRAM_CONFIG`.

Telegram-launched jobs do not depend on hooks for final-answer delivery.

## Codex Asks for Approval While Remote

The runner inherits the user's Codex config. If Codex asks for interactive approval, the remote job can stall or fail depending on Codex mode. Use a Codex configuration that matches your risk tolerance for unattended use.

## Long Messages Are Split

Telegram has message size limits. The runner splits final answers using `telegramChunkSize`, default `3900`.

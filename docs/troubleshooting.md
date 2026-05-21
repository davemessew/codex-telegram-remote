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

## Telegram `getUpdates` Conflict

This error means Telegram sees more than one long-polling consumer for the same bot token:

```text
Conflict: terminated by other getUpdates request; make sure that only one bot instance is running
```

Telegram allows only one active `getUpdates` poller per bot token. Common causes:

- The Windows scheduled task is running and you also started `runner.mjs` manually.
- Another terminal, service, PC, container, or old install is using the same bot token.
- A previous long-poll request is still being closed; wait longer than `pollTimeoutSeconds` before starting another runner.

Check local Windows runners:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'codex-telegram-remote|runner\.mjs' } |
  Select-Object ProcessId,CommandLine

Get-ScheduledTask -TaskName CodexTelegramRemote
Get-ScheduledTaskInfo -TaskName CodexTelegramRemote
```

Use the scheduled task:

```powershell
# Close any manual runner terminals, then:
Start-ScheduledTask -TaskName CodexTelegramRemote
```

Debug manually:

```powershell
Stop-ScheduledTask -TaskName CodexTelegramRemote
Start-Sleep -Seconds 60
node .\plugins\codex-telegram-remote\scripts\runner.mjs
```

If the conflict persists after all local runners are stopped, revoke the bot token in BotFather or stop the other host using that token.

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

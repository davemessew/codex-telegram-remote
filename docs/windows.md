# Windows Setup

Windows is the primary supported platform for Codex Telegram Remote.

## Requirements

- Windows 10 or 11.
- Codex installed and authenticated.
- Node 20.11 or newer.
- A Telegram bot token.
- Your Telegram chat ID.

## Install the Plugin

From the public GitHub repository:

```powershell
codex plugin marketplace add https://github.com/davemessew/codex-telegram-remote
codex plugin add codex-telegram-remote@codex-telegram-remote
```

From a local checkout:

```powershell
codex plugin marketplace add .
codex plugin add codex-telegram-remote@codex-telegram-remote
```

## Run Setup

```powershell
.\plugins\codex-telegram-remote\scripts\setup-windows.ps1 `
  -BotToken "123456789:replace-me" `
  -AllowedChatIds "123456789"
```

Optional friendly default project:

```powershell
.\plugins\codex-telegram-remote\scripts\setup-windows.ps1 `
  -BotToken "123456789:replace-me" `
  -AllowedChatIds "123456789" `
  -DefaultProject "frontend" `
  -DefaultProjectPath "C:\code\frontend"
```

The script:

- Validates the Telegram token with `getMe`.
- Creates `%USERPROFILE%\.codex-telegram-remote\config.json`.
- Restricts the config directory and file ACLs to the current user and `SYSTEM`.
- Finds a working Codex binary when possible.
- Registers and starts a hidden scheduled task named `CodexTelegramRemote`.

The generated config uses `executionBackend: "appServer"` by default. Telegram prompts are routed into existing Codex GUI conversations for the selected project. Use `/thread` in Telegram to switch conversations, or set `executionBackend` to `"cli"` if you need the older `codex exec` behavior.

## Locked PC Behavior

The scheduled task runs at user logon and keeps running after the screen is locked. This does not work if:

- The user is logged out.
- The PC is asleep or hibernating.
- Networking is unavailable.
- Windows kills background networking due to power policy.
- Codex requires an interactive approval prompt that cannot be answered remotely.

The GUI-thread backend uses a local app-server process over stdio. It does not click the desktop UI, so it can keep running while the PC is locked as long as the user remains logged in.

Recommended power settings for a dedicated remote workstation:

- Disable sleep while plugged in.
- Keep network available on standby if your hardware supports it.
- Keep Codex approval settings appropriate for remote use.

## Enable Regular Codex Completion Hooks

Telegram-launched jobs notify automatically. To also notify when normal Codex app/CLI tasks finish, enable plugin hooks:

```toml
[features]
plugin_hooks = true
```

Then open Codex and review `/hooks`. Trust the Codex Telegram Remote `Stop` hook.

## Operations

Start manually:

```powershell
Start-ScheduledTask -TaskName CodexTelegramRemote
```

Stop:

```powershell
Stop-ScheduledTask -TaskName CodexTelegramRemote
```

Uninstall:

```powershell
.\plugins\codex-telegram-remote\scripts\uninstall-windows.ps1
```

Remove local config too:

```powershell
.\plugins\codex-telegram-remote\scripts\uninstall-windows.ps1 -RemoveConfig
```

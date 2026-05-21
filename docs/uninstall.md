# Uninstall

## Windows

```powershell
.\plugins\codex-telegram-remote\scripts\uninstall-windows.ps1
```

Remove local config and state:

```powershell
.\plugins\codex-telegram-remote\scripts\uninstall-windows.ps1 -RemoveConfig
```

## macOS

```bash
./plugins/codex-telegram-remote/scripts/uninstall-macos.sh
```

Remove local config and state:

```bash
REMOVE_CONFIG=1 ./plugins/codex-telegram-remote/scripts/uninstall-macos.sh
```

## Codex Plugin

```powershell
codex plugin remove codex-telegram-remote
```

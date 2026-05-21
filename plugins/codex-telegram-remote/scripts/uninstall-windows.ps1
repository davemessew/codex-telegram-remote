param(
  [string]$TaskName = "CodexTelegramRemote",
  [switch]$RemoveConfig,
  [string]$ConfigDir = "$env:USERPROFILE\.codex-telegram-remote"
)

$ErrorActionPreference = "Stop"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task: $TaskName"
} else {
  Write-Host "Scheduled task not found: $TaskName"
}

if ($RemoveConfig -and (Test-Path -LiteralPath $ConfigDir)) {
  Remove-Item -LiteralPath $ConfigDir -Recurse -Force
  Write-Host "Removed config directory: $ConfigDir"
}

param(
  [Parameter(Mandatory = $true)]
  [string]$BotToken,

  [Parameter(Mandatory = $true)]
  [string[]]$AllowedChatIds,

  [string]$DefaultProject = "",
  [string]$DefaultProjectPath = "",
  [string]$ConfigDir = "$env:USERPROFILE\.codex-telegram-remote",
  [string]$TaskName = "CodexTelegramRemote",
  [switch]$SkipScheduledTask
)

$ErrorActionPreference = "Stop"

function Find-CodexBinary {
  if ($env:CODEX_CLI_PATH -and (Test-Path -LiteralPath $env:CODEX_CLI_PATH)) {
    return $env:CODEX_CLI_PATH
  }

  $localRoot = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
  if (Test-Path -LiteralPath $localRoot) {
    $candidate = Get-ChildItem -Path $localRoot -Filter codex.exe -Recurse -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($candidate) {
      return $candidate.FullName
    }
  }

  $command = Get-Command codex -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  return ""
}

function Find-NodeBinary {
  $command = Get-Command node -ErrorAction Stop
  return $command.Source
}

function Test-TelegramToken {
  param([string]$Token)
  $uri = "https://api.telegram.org/bot$Token/getMe"
  try {
    $result = Invoke-RestMethod -Method Post -Uri $uri
  } catch {
    throw "Telegram getMe failed. Check the bot token."
  }
  if (-not $result.ok) {
    throw "Telegram getMe failed. Check the bot token."
  }
  return $result.result.username
}

function Protect-ConfigPath {
  param([string]$Directory, [string]$File)
  $currentUser = & whoami
  & icacls $Directory /inheritance:r /grant:r "${currentUser}:(OI)(CI)F" "SYSTEM:(OI)(CI)F" | Out-Null
  if (Test-Path -LiteralPath $File) {
    & icacls $File /inheritance:r /grant:r "${currentUser}:F" "SYSTEM:F" | Out-Null
  }
}

$pluginRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$runnerPath = Join-Path $pluginRoot "scripts\runner.mjs"
$nodePath = Find-NodeBinary
$codexBin = Find-CodexBinary
$botName = Test-TelegramToken -Token $BotToken
$currentUser = & whoami

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
$configPath = Join-Path $ConfigDir "config.json"
Protect-ConfigPath -Directory $ConfigDir -File $configPath

$aliases = @{}
if ($DefaultProject -and $DefaultProjectPath) {
  $aliases[$DefaultProject] = $DefaultProjectPath
}

$config = [ordered]@{
  botToken = $BotToken
  allowedChatIds = @($AllowedChatIds)
  completionChatIds = @($AllowedChatIds)
  defaultProject = $DefaultProject
  projectAliases = $aliases
  codexBin = $codexBin
  maxConcurrentJobs = 1
  sendFullFinalAnswer = $true
  telegramChunkSize = 3900
  projectPageSize = 8
}

$config | ConvertTo-Json -Depth 10 | Set-Content -Path $configPath -Encoding UTF8
Protect-ConfigPath -Directory $ConfigDir -File $configPath

if (-not $SkipScheduledTask) {
  $action = New-ScheduledTaskAction `
    -Execute $nodePath `
    -Argument "`"$runnerPath`"" `
    -WorkingDirectory $pluginRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 30) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
  $task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal
  Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
}

Write-Host "Configured Codex Telegram Remote for @$botName"
Write-Host "Config: $configPath"
Write-Host "Runner: $runnerPath"
if (-not $SkipScheduledTask) {
  Write-Host "Scheduled task: $TaskName"
}
if (-not $codexBin) {
  Write-Warning "Could not find a Codex binary. Set codexBin in $configPath if the runner cannot start Codex."
}

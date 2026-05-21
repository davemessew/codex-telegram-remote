<div align="center">

# Codex Telegram Remote

### Run local Codex jobs from Telegram.

Pick a project with `/select`, send a normal message, and get the final answer back when Codex finishes.

<p>
  🚀 Run Codex from anywhere Telegram works<br>
  🧭 Tap `/select`, choose a project, then type normally<br>
  🔔 Get final answers and completion pings automatically<br>
  🔒 Keep execution local, allowlisted, and under your Codex settings
</p>

<p>
  <a href="https://github.com/davemessew/codex-telegram-remote/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/davemessew/codex-telegram-remote/actions/workflows/ci.yml/badge.svg"></a>
  <a href="package.json"><img alt="Node >= 20.11" src="https://img.shields.io/badge/node-%3E%3D20.11-339933"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue"></a>
  <a href="package.json"><img alt="zero runtime dependencies" src="https://img.shields.io/badge/runtime%20deps-0-brightgreen"></a>
</p>

<p>
  <a href="#quick-start"><strong>Quick Start</strong></a>
  |
  <a href="#demo"><strong>Demo</strong></a>
  |
  <a href="#security-model"><strong>Security</strong></a>
  |
  <a href="docs/windows.md"><strong>Windows Setup</strong></a>
  |
  <a href="docs/troubleshooting.md"><strong>Troubleshooting</strong></a>
</p>

</div>

---

Codex Telegram Remote is a local runner plus a Codex plugin. It talks to Telegram through long polling, so there are no public webhooks, no exposed ports, and no cloud worker between Telegram and your machine.

| 🚀 Select | ✍️ Prompt | 🔁 Continue | 🔔 Notify |
| --- | --- | --- | --- |
| Tap `/select` to choose a project. | Send normal Telegram messages as Codex prompts. | Reply when Codex asks a question. | Receive final answers and completion alerts. |

## Demo

```text
You: /select

Bot: Select a project. Current project: frontend.

[ Current: frontend ]
[ api-service       ]
[ docs-site         ]

You: add tests for the project picker

Bot: Job completed
<full Codex final answer>
```

## Features

| Feature | Details |
| --- | --- |
| Tappable project picker | `/select` opens an inline Telegram keyboard with project pagination and the current project highlighted. |
| Normal-message prompts | After a project is selected, non-command messages become Codex prompts for that project. |
| Follow-up replies | If Codex asks a question, reply in Telegram and the runner resumes the same Codex thread. |
| Completion messages | Telegram-launched jobs send final answers automatically. Regular Codex tasks can notify through the optional `Stop` hook. |
| Locked-PC support | Windows setup registers a hidden Task Scheduler job that continues while the screen is locked. |
| Conservative access | Only `allowedChatIds` can run jobs. Unknown chats are ignored by default. |

## Commands

```text
/select          choose the active project
/current         show the selected project
/jobs            list recent jobs
/status [jobId]  show job status
/tail [jobId]    show recent output
/cancel <jobId>  cancel a running job
/help            show command help
```

## Quick Start

### 1. Create a Telegram bot

Create a bot with [BotFather](https://core.telegram.org/bots/features#botfather), save the token, and find your numeric chat ID.

Detailed steps: [docs/telegram-bot-setup.md](docs/telegram-bot-setup.md)

### 2. Install the plugin

```powershell
codex plugin marketplace add https://github.com/davemessew/codex-telegram-remote
codex plugin add codex-telegram-remote@codex-telegram-remote
```

Local checkout:

```powershell
git clone https://github.com/davemessew/codex-telegram-remote.git
cd codex-telegram-remote
npm install
npm test

codex plugin marketplace add .
codex plugin add codex-telegram-remote@codex-telegram-remote
```

### 3. Run setup on Windows

```powershell
.\plugins\codex-telegram-remote\scripts\setup-windows.ps1 `
  -BotToken "123456789:replace-me" `
  -AllowedChatIds "123456789"
```

Optional default project alias:

```powershell
.\plugins\codex-telegram-remote\scripts\setup-windows.ps1 `
  -BotToken "123456789:replace-me" `
  -AllowedChatIds "123456789" `
  -DefaultProject "frontend" `
  -DefaultProjectPath "C:\code\frontend"
```

### 4. Use Telegram

Send `/select`, tap a project, then send a normal message.

Full Windows guide: [docs/windows.md](docs/windows.md)

## Configuration

Default config path:

| Platform | Path |
| --- | --- |
| Windows | `%USERPROFILE%\.codex-telegram-remote\config.json` |
| macOS/Linux | `~/.codex-telegram-remote/config.json` |

Minimal config:

```json
{
  "botToken": "123456789:replace-with-your-bot-token",
  "allowedChatIds": ["123456789"]
}
```

Common config:

```json
{
  "botToken": "123456789:replace-with-your-bot-token",
  "allowedChatIds": ["123456789"],
  "completionChatIds": ["123456789"],
  "defaultProject": "frontend",
  "projectAliases": {
    "frontend": "C:/code/frontend",
    "api-service": "C:/code/api-service"
  },
  "codexBin": "",
  "codexHome": "C:/Users/you/.codex",
  "maxConcurrentJobs": 1,
  "sendFullFinalAnswer": true,
  "replyToUnauthorized": false,
  "telegramChunkSize": 3900,
  "pollTimeoutSeconds": 50,
  "projectPageSize": 8
}
```

### Important options

| Key | Default | Purpose |
| --- | --- | --- |
| `allowedChatIds` | Required | Only these Telegram chats can run Codex. |
| `completionChatIds` | `allowedChatIds` | Chats that receive regular completion notifications. |
| `projectAliases` | `{}` | Friendly project names shown in `/select`. |
| `defaultProject` | Empty | Alias or path selected by default. |
| `codexBin` | Auto-detected | Path to the Codex binary. |
| `maxConcurrentJobs` | `1` | Maximum simultaneous Telegram-launched jobs. |
| `sendFullFinalAnswer` | `true` | Send final answer text instead of only job status. |
| `replyToUnauthorized` | `false` | Reply to unknown chats. Keep off except during setup. |

Environment overrides:

```text
CODEX_TELEGRAM_BOT_TOKEN
CODEX_TELEGRAM_ALLOWED_CHAT_IDS
CODEX_TELEGRAM_DEFAULT_PROJECT
CODEX_TELEGRAM_CONFIG
CODEX_TELEGRAM_CONFIG_DIR
CODEX_CLI_PATH
CODEX_BIN
CODEX_HOME
```

## How It Works

```mermaid
flowchart LR
  T["Telegram"] -->|"long polling"| R["Local runner"]
  R -->|"allowlist + selected project"| S["State file"]
  R -->|"codex exec --json -C <project>"| C["Codex CLI"]
  C -->|"JSONL events"| R
  R -->|"final answer chunks"| T
  H["Optional Stop hook"] -->|"regular task complete"| T
```

Project discovery uses:

- `[projects]` from `$CODEX_HOME/config.toml`
- `projectAliases` from this plugin's config

The runner stores selected projects and waiting jobs per Telegram chat. Reply-to mappings are chat-scoped, so one chat cannot resume or cancel another chat's job.

## Security Model

This project lets Telegram messages trigger local Codex execution. Treat it like remote access to your developer machine.

Safe defaults:

- Unknown Telegram chats are ignored.
- Every executable chat must be listed in `allowedChatIds`.
- State and config files are written with private permissions where the platform supports it.
- Telegram-launched jobs inherit your existing Codex sandbox, approvals, model, auth, and trusted project settings.
- The regular completion hook is opt-in and must be trusted in Codex.
- Hook transcript reads are restricted to the configured Codex home.

Read before publishing or installing for real use:

- [SECURITY.md](SECURITY.md)
- [PRIVACY.md](PRIVACY.md)
- [TERMS.md](TERMS.md)

## Platform Support

| Platform | Status | Notes |
| --- | --- | --- |
| Windows 10/11 | Primary | Setup creates a hidden Task Scheduler job at user logon. |
| macOS | Supported | Setup creates a user LaunchAgent. |
| Linux | Runner is portable | No packaged service installer yet. |

Locked Windows sessions work when the user remains logged in, the machine is awake, networking is available, and Codex does not need an interactive desktop approval prompt.

## Documentation

| Topic | Link |
| --- | --- |
| Telegram bot setup | [docs/telegram-bot-setup.md](docs/telegram-bot-setup.md) |
| Windows setup | [docs/windows.md](docs/windows.md) |
| macOS setup | [docs/macos.md](docs/macos.md) |
| Troubleshooting | [docs/troubleshooting.md](docs/troubleshooting.md) |
| Uninstall | [docs/uninstall.md](docs/uninstall.md) |
| Publishing | [docs/publishing.md](docs/publishing.md) |

## Development

```powershell
npm install
npm test
npm audit --omit=dev
```

The project uses Node's built-in test runner and has no runtime npm dependencies.

Useful validation:

```powershell
Get-ChildItem -Recurse -Filter *.mjs | ForEach-Object { node --check $_.FullName }
```

## Repository Layout

```text
plugins/codex-telegram-remote/
  .codex-plugin/plugin.json       plugin metadata
  hooks/hooks.json                optional Stop hook
  scripts/runner.mjs              Telegram long-poll runner
  scripts/lib/                    runner modules
  scripts/setup-windows.ps1       Windows setup
  scripts/setup-macos.sh          macOS setup
  examples/config.example.json    config template
  skills/                         plugin skill
docs/                             setup and operations docs
tests/                            unit and integration-style tests
```

## Contributing

Issues and pull requests are welcome. Keep changes focused, add tests for behavior changes, and do not commit bot tokens, chat IDs, transcripts, or local machine paths.

Security reports should follow [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).

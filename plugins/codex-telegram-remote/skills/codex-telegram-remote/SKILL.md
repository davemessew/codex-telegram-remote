---
name: codex-telegram-remote
description: Help users install, configure, troubleshoot, or use Codex Telegram Remote for Telegram-launched Codex jobs and completion notifications.
---

# Codex Telegram Remote

Use this skill when the user asks about installing or operating the Telegram remote runner.

## Core facts

- The runner is local and uses Telegram long polling, so no public webhook URL is required.
- `/select` opens a tappable project picker. After a project is selected, normal Telegram messages become Codex prompts for that project.
- `/jobs` opens a tappable recent-job picker. Selecting a job makes `/status` and `/tail` use that job by default.
- Only `allowedChatIds` can run Codex.
- Unauthorized chats are ignored unless `replyToUnauthorized` is explicitly enabled for setup debugging.
- Codex inherits the user's existing Codex config, sandbox, approvals, and model settings.
- The runner can keep working while the PC is locked if the user is logged in, the machine is awake, and networking is available.
- Regular Codex desktop completion notifications are watched by the runner from local transcript `task_complete` events. App/CLI completion notifications can also use the bundled `Stop` hook; plugin hooks require `[features].plugin_hooks = true` and hook trust review.
- Completion notifications are recorded as completed jobs so they can be selected from Telegram.
- Completion messages include the exact final answer under `Details:` when `sendFullFinalAnswer` is enabled. A separate summary is only shown when one is explicitly provided.

## Useful files

- `examples/config.example.json`
- `scripts/setup-windows.ps1`
- `scripts/setup-macos.sh`
- `docs/windows.md`
- `docs/macos.md`
- `docs/troubleshooting.md`

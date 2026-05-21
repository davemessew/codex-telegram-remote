---
name: codex-telegram-remote
description: Help users install, configure, troubleshoot, or use Codex Telegram Remote for Telegram-launched Codex jobs and completion notifications.
---

# Codex Telegram Remote

Use this skill when the user asks about installing or operating the Telegram remote runner.

## Core facts

- The runner is local and uses Telegram long polling, so no public webhook URL is required.
- `/select` opens a tappable project picker. After a project is selected, normal Telegram messages become Codex prompts for that project.
- Only `allowedChatIds` can run Codex.
- Unauthorized chats are ignored unless `replyToUnauthorized` is explicitly enabled for setup debugging.
- Codex inherits the user's existing Codex config, sandbox, approvals, and model settings.
- The runner can keep working while the PC is locked if the user is logged in, the machine is awake, and networking is available.
- Regular Codex completion notifications use the bundled `Stop` hook. Plugin hooks require `[features].plugin_hooks = true` and hook trust review.

## Useful files

- `examples/config.example.json`
- `scripts/setup-windows.ps1`
- `scripts/setup-macos.sh`
- `docs/windows.md`
- `docs/macos.md`
- `docs/troubleshooting.md`

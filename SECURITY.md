# Security Policy

Codex Telegram Remote is powerful because it turns Telegram messages into local Codex jobs. Configure it conservatively.

## Supported Versions

Security fixes target the latest `main` branch until the first stable release. After `1.0.0`, supported release lines will be documented here.

## Reporting a Vulnerability

Open a private security advisory on GitHub if the repository owner has advisories enabled. Otherwise email the maintainer listed in the published repository.

Do not post bot tokens, chat IDs, logs with secrets, or private Codex transcripts in public issues.

## Threat Model

The main risks are:

- A leaked Telegram bot token lets someone talk to the bot API as your bot.
- A misconfigured `allowedChatIds` list lets the wrong Telegram chat run Codex.
- A permissive Codex config can let remote prompts make broad local changes.
- Final answers sent to Telegram can include code, paths, logs, or secrets if Codex includes them.
- Group chats expose prompts and results to every member.

## Defaults

- The runner refuses all chats except explicit `allowedChatIds`.
- Unauthorized chats are ignored by default, so strangers cannot use the bot as a responder.
- There is no generic shell command endpoint.
- Normal messages run only after a project is selected.
- Codex inherits the user's Codex settings instead of silently changing sandbox or approval behavior.
- Telegram-launched jobs set `CODEX_TELEGRAM_REMOTE_JOB_ID` so the completion hook can avoid duplicate notifications.

## Hardening Checklist

- Use a dedicated private Telegram bot.
- Set exactly one `allowedChatIds` entry for your own chat.
- Prefer project aliases for known safe workspaces.
- Keep `maxConcurrentJobs` at `1` unless you understand resource impact.
- Keep bot tokens in environment variables or the user-local config file.
- Leave `replyToUnauthorized` set to `false` after setup.
- Review Codex `approval_policy`, `sandbox_mode`, and project trust before enabling remote use.
- Enable full-disk encryption on laptops that run the background service.
- Keep the machine awake only when you intend remote access to be available.

## Hook Security

The `Stop` hook sends completion messages for normal Codex app/CLI sessions. Codex requires plugin hooks to be enabled and trusted:

```toml
[features]
plugin_hooks = true
```

Review the hook with `/hooks` before trusting it. The hook command only sends a Telegram message and returns `continue: true`.

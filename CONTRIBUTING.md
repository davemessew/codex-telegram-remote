# Contributing

Thanks for improving Codex Telegram Remote.

## Development Setup

```bash
npm test
```

On Windows PowerShell, use:

```powershell
npm.cmd test
```

## Design Principles

- Keep runtime dependencies minimal.
- Keep Telegram authorization explicit and deny-by-default.
- Do not override the user's Codex sandbox or approval settings silently.
- Prefer behavior tests for message routing, project selection, hooks, and Codex JSONL parsing.
- Keep setup scripts idempotent.

## Pull Requests

Include:

- Summary of behavior changes.
- Test output.
- Any setup or migration notes.
- Security impact if Telegram command behavior changes.

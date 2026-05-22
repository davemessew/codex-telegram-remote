# Changelog

## Unreleased

- Added tappable `/jobs` selection for recent jobs.
- Made `/status` and `/tail` use the selected job before falling back to the current project.
- Recorded regular app/CLI completion hook notifications as selectable jobs.
- Reloaded file-backed state before reads so a running Telegram runner can see jobs written by hook processes.

## 0.1.0

- Initial plugin package.
- Telegram long-polling runner.
- `/select` tappable project picker.
- Normal-message Codex prompt routing for selected projects.
- Full final-answer Telegram delivery.
- Optional regular Codex completion notifications through a `Stop` hook.
- Windows Task Scheduler setup.
- macOS LaunchAgent setup.
- Security hardening for chat-scoped replies, ownership-checked cancellation, private local state, persisted Telegram offsets, quiet unauthorized chats, and safer hook transcript reads.

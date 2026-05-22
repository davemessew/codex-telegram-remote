# Changelog

## 0.1.3

- Stripped embedded `Summary` sections out of completion details so Telegram messages do not repeat the same content under multiple headings.

## 0.1.2

- Added tappable `/jobs` selection for recent jobs.
- Made `/status` and `/tail` use the selected job before falling back to the current project.
- Recorded regular app/CLI completion hook notifications as selectable jobs.
- Reloaded file-backed state before reads so a running Telegram runner can see jobs written by hook processes.
- Included task summaries in Telegram completion messages and completed-job status output.
- Honored `sendFullFinalAnswer` for Stop-hook notifications while keeping its default as `true`.
- Bumped the plugin version so local plugin installs refresh the Stop hook cache instead of reusing stale code.

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

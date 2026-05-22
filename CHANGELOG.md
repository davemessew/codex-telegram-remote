# Changelog

## 0.1.8

- Kept Telegram polling responsive while Codex jobs run by launching prompt and resume work in the background.
- Preserved cancelled job status when the killed child process later exits.
- Added regression coverage for `/status` working while a Telegram-launched job is still running.

## 0.1.7

- Allowed Telegram-launched jobs to run from trusted project roots that are not Git repositories by adding `--skip-git-repo-check` only for non-repo roots.

## 0.1.6

- Fixed Codex project discovery for double-quoted Windows paths whose folder names start with `t` or `n`.
- Added compatibility for Telegram chats that had already selected projects using IDs generated from the old malformed paths.

## 0.1.5

- Added a runner-side transcript monitor that sends Telegram completion notifications from desktop `task_complete` events when the Stop hook path misses them.
- Updated completion formatting so `Details:` contains the exact final answer text and summaries are only shown when explicitly provided.
- Normalized escaped newline sequences before sending Telegram messages so `\n` renders as real line breaks.
- Taught the Stop hook transcript reader to use desktop `task_complete` final answers.
- Added dedupe between monitor and hook notifications for the same transcript completion.

## 0.1.4

- Removed fallback summary text from completion details so one-paragraph summaries are not repeated at the top of the details block.

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

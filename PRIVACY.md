# Privacy

Codex Telegram Remote sends selected local Codex information to Telegram.

## Data Sent to Telegram

Telegram-launched jobs send:

- Project name and status messages.
- Full final Codex answer by default.
- Follow-up questions when Codex asks for user input.

Regular Codex tasks send, through the optional `Stop` hook:

- Completion notice.
- Working directory path.
- Final assistant message when available from the transcript.

## Data Stored Locally

The runner stores local state in the configured state file, normally:

- Windows: `%USERPROFILE%\.codex-telegram-remote\state.json`
- macOS/Linux: `~/.codex-telegram-remote/state.json`

State can include selected project IDs, recent job metadata, thread IDs, and final messages.

## Telegram Processing

Telegram receives and stores messages according to Telegram's own terms and privacy practices. Do not send prompts or outputs to Telegram that you would not be comfortable storing in a third-party messaging system.

## Reducing Exposure

- Use a private one-to-one chat.
- Keep `completionChatIds` narrow.
- Disable regular Codex completion hook notifications if you only want Telegram-launched job results.
- Avoid asking Codex to print secrets.
- Delete local state if you no longer need job history.

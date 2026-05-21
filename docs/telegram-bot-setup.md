# Telegram Bot Setup

## Create the Bot

1. Open Telegram.
2. Start a chat with `@BotFather`.
3. Send `/newbot`.
4. Follow the prompts.
5. Copy the bot token.

Keep the token private. Anyone with the token can call Telegram's bot API as your bot.

## Find Your Chat ID

1. Send any message to your new bot.
2. Open this URL in a browser, replacing the token:

   ```text
   https://api.telegram.org/bot<token>/getUpdates
   ```

3. Find `message.chat.id` in the JSON response.
4. Put that ID in `allowedChatIds`.

For privacy, use a one-to-one bot chat. Group chat IDs work, but everyone in the group can see prompts and results, and any allowed group can run Codex.

## Set Bot Commands

The runner calls `setMyCommands` on startup. Telegram should show:

- `/select`
- `/current`
- `/jobs`
- `/status`
- `/cancel`
- `/tail`
- `/help`

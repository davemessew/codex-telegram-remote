export const TELEGRAM_API_BASE = "https://api.telegram.org";

export class TelegramApiError extends Error {
  constructor({ method, description, errorCode, statusText }) {
    super(`Telegram ${method} failed: ${description || statusText || "Unknown Telegram API error"}`);
    this.name = "TelegramApiError";
    this.method = method;
    this.description = description ?? "";
    this.errorCode = errorCode;
  }
}

export class TelegramClient {
  constructor({ botToken, fetchImpl = globalThis.fetch, apiBase = TELEGRAM_API_BASE }) {
    if (!botToken) {
      throw new Error("Telegram bot token is required.");
    }
    if (typeof fetchImpl !== "function") {
      throw new Error("A fetch implementation is required.");
    }

    this.botToken = botToken;
    this.fetch = fetchImpl;
    this.apiBase = apiBase.replace(/\/+$/, "");
  }

  async call(method, payload = {}) {
    const response = await this.fetch(`${this.apiBase}/bot${this.botToken}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok || body.ok === false) {
      throw new TelegramApiError({
        method,
        description: body.description,
        errorCode: body.error_code ?? response.status,
        statusText: response.statusText,
      });
    }
    return body.result;
  }

  async getUpdates({ offset, timeout }) {
    return this.call("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["message", "callback_query"],
    });
  }

  async sendMessage(chatId, text, options) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...options,
    });
  }

  async editMessageText(chatId, messageId, text, options) {
    return this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      disable_web_page_preview: true,
      ...options,
    });
  }

  async answerCallbackQuery(callbackQueryId, text) {
    return this.call("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  async setMyCommands(commands) {
    return this.call("setMyCommands", { commands });
  }
}

export function chunkTelegramText(text, limit = 3900) {
  const normalizedText = String(text ?? "");
  if (normalizedText.length <= limit) {
    return [normalizedText];
  }

  const chunks = [];
  let remaining = normalizedText;
  while (remaining.length > limit) {
    let splitAt = Math.max(
      remaining.lastIndexOf("\n", limit),
      remaining.lastIndexOf(" ", limit),
    );
    if (splitAt <= 0) {
      splitAt = limit;
    }
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining.length > 0) {
    chunks.push(remaining);
  }
  return chunks;
}

export function isAllowedChat(chatId, allowedChatIds) {
  return allowedChatIds.includes(String(chatId));
}

export function normalizeTelegramMessage(update) {
  if (update?.message) {
    return {
      kind: "message",
      chatId: String(update.message.chat.id),
      messageId: update.message.message_id,
      text: update.message.text ?? "",
      replyToMessageId: update.message.reply_to_message?.message_id,
    };
  }

  if (update?.callback_query) {
    return {
      kind: "callback",
      id: update.callback_query.id,
      chatId: String(update.callback_query.message.chat.id),
      messageId: update.callback_query.message.message_id,
      data: update.callback_query.data ?? "",
    };
  }

  return null;
}

export function telegramCommands() {
  return [
    { command: "select", description: "Choose the active Codex project" },
    { command: "current", description: "Show the active project" },
    { command: "jobs", description: "List recent Codex jobs" },
    { command: "status", description: "Show current project job status" },
    { command: "cancel", description: "Cancel a running job" },
    { command: "tail", description: "Show current project output" },
    { command: "help", description: "Show help" },
  ];
}

export function isTelegramGetUpdatesConflict(error) {
  return error instanceof TelegramApiError
    && error.method === "getUpdates"
    && error.errorCode === 409
    && /conflict|other getupdates request/i.test(error.description);
}

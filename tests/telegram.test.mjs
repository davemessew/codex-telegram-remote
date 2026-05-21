import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chunkTelegramText,
  isAllowedChat,
  isTelegramGetUpdatesConflict,
  normalizeTelegramMessage,
  TelegramApiError,
} from "../plugins/codex-telegram-remote/scripts/lib/telegram.mjs";

test("chunkTelegramText splits long messages under the configured limit", () => {
  assert.deepEqual(chunkTelegramText("alpha beta gamma", 8), [
    "alpha",
    "beta",
    "gamma",
  ]);
});

test("chunkTelegramText preserves short messages", () => {
  assert.deepEqual(chunkTelegramText("short", 8), ["short"]);
});

test("isAllowedChat only accepts configured chat IDs", () => {
  assert.equal(isAllowedChat(123, ["123"]), true);
  assert.equal(isAllowedChat("123", ["123"]), true);
  assert.equal(isAllowedChat(999, ["123"]), false);
});

test("normalizeTelegramMessage extracts chat, text, and reply metadata", () => {
  const message = normalizeTelegramMessage({
    message: {
      message_id: 4,
      chat: { id: 123 },
      text: "hello",
      reply_to_message: {
        message_id: 3,
      },
    },
  });

  assert.deepEqual(message, {
    kind: "message",
    chatId: "123",
    messageId: 4,
    text: "hello",
    replyToMessageId: 3,
  });
});

test("isTelegramGetUpdatesConflict detects duplicate long-polling errors", () => {
  const error = new TelegramApiError({
    method: "getUpdates",
    errorCode: 409,
    description: "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
  });

  assert.equal(isTelegramGetUpdatesConflict(error), true);
  assert.equal(isTelegramGetUpdatesConflict(new Error("Conflict")), false);
});

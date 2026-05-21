#!/usr/bin/env node
import { loadConfig } from "./lib/config.mjs";
import {
  buildStopNotification,
  readFinalMessageFromTranscript,
  shouldSuppressHookNotification,
} from "./lib/hook-notifier.mjs";
import { TelegramClient, chunkTelegramText } from "./lib/telegram.mjs";

async function main() {
  if (shouldSuppressHookNotification()) {
    writeHookSuccess();
    return;
  }

  const payload = await readStdinJson();
  const config = loadOptionalConfig();
  if (!config.botToken || config.completionChatIds.length === 0) {
    writeHookSuccess();
    return;
  }

  const finalMessage = readFinalMessageFromTranscript(payload.transcript_path, {
    allowedRoots: [config.codexHome],
  });
  const notification = buildStopNotification({ payload, finalMessage });
  const telegram = new TelegramClient({ botToken: config.botToken });

  for (const chatId of config.completionChatIds) {
    for (const chunk of chunkTelegramText(notification, config.telegramChunkSize)) {
      await telegram.sendMessage(chatId, chunk);
    }
  }

  writeHookSuccess();
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

function writeHookSuccess() {
  process.stdout.write(JSON.stringify({ continue: true, suppressOutput: true }));
}

function loadOptionalConfig() {
  try {
    return loadConfig();
  } catch {
    return {
      botToken: "",
      completionChatIds: [],
      telegramChunkSize: 3900,
      codexHome: "",
    };
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: "Codex Telegram Remote notification hook failed. See hook logs for details.",
  }));
});

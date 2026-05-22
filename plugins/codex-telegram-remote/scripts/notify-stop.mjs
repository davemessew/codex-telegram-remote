#!/usr/bin/env node
import {
  loadCodexProjectPaths,
  loadConfig,
  resolveConfiguredProjects,
} from "./lib/config.mjs";
import {
  buildExternalJob,
  buildStopNotification,
  readFinalMessageFromTranscript,
  shouldSuppressHookNotification,
} from "./lib/hook-notifier.mjs";
import { createFileStateStore } from "./lib/state-store.mjs";
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
  const projects = resolveConfiguredProjects({
    config,
    codexProjectPaths: loadCodexProjectPaths(config.codexHome),
  });
  const state = createOptionalStateStore(config.statePath);
  const telegram = new TelegramClient({ botToken: config.botToken });

  for (const chatId of config.completionChatIds) {
    const job = buildExternalJob({
      payload,
      finalMessage,
      chatId,
      projects,
    });
    state?.addJob(job);
    const notification = buildStopNotification({
      payload,
      finalMessage,
      job,
      sendFullFinalAnswer: config.sendFullFinalAnswer,
    });
    const chunks = chunkTelegramText(notification, config.telegramChunkSize);
    for (const [index, chunk] of chunks.entries()) {
      await telegram.sendMessage(chatId, chunk, index === 0 ? {
        reply_markup: buildSingleJobKeyboard(job),
      } : undefined);
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

function createOptionalStateStore(statePath) {
  try {
    return createFileStateStore(statePath);
  } catch (error) {
    console.error(`Could not open Codex Telegram Remote state file: ${error.message}`);
    return null;
  }
}

function buildSingleJobKeyboard(job) {
  return {
    inline_keyboard: [
      [
        {
          text: "Select job",
          callback_data: `job:${job.jobId}`,
        },
      ],
    ],
  };
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.stdout.write(JSON.stringify({
    continue: true,
    systemMessage: "Codex Telegram Remote notification hook failed. See hook logs for details.",
  }));
});

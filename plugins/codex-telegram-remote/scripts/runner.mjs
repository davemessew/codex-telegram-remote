#!/usr/bin/env node
import {
  loadCodexProjectPaths,
  loadConfig,
  resolveConfiguredProjects,
} from "./lib/config.mjs";
import { createBotController } from "./lib/bot-controller.mjs";
import { CodexJobRunner } from "./lib/codex-runner.mjs";
import { createFileStateStore } from "./lib/state-store.mjs";
import { TelegramClient, telegramCommands } from "./lib/telegram.mjs";

async function main() {
  const config = loadConfig();
  assertConfig(config);

  const projects = resolveConfiguredProjects({
    config,
    codexProjectPaths: loadCodexProjectPaths(config.codexHome),
  });
  const state = createFileStateStore(config.statePath);
  const telegram = new TelegramClient({ botToken: config.botToken });
  const codex = new CodexJobRunner({
    codexBin: config.codexBin,
    state,
    maxConcurrentJobs: config.maxConcurrentJobs,
  });
  const controller = createBotController({
    config,
    projects,
    state,
    telegram,
    codex,
  });

  await telegram.setMyCommands(telegramCommands());
  await runPollingLoop({
    telegram,
    controller,
    state,
    timeout: config.pollTimeoutSeconds,
  });
}

export async function runPollingLoop({ telegram, controller, state, timeout }) {
  let offset = state?.getLastUpdateId() === null ? 0 : state.getLastUpdateId() + 1;
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!stopping) {
    try {
      const updates = await telegram.getUpdates({ offset, timeout });
      for (const update of updates) {
        if (state) {
          state.setLastUpdateId(update.update_id);
        }
        offset = Math.max(offset, update.update_id + 1);
        try {
          await controller.handleUpdate(update);
        } catch (error) {
          console.error(`[codex-telegram-remote] update ${update.update_id} failed: ${error.stack ?? error.message}`);
        }
      }
    } catch (error) {
      console.error(`[codex-telegram-remote] ${error.stack ?? error.message}`);
      await delay(3000);
    }
  }
}

function assertConfig(config) {
  if (!config.botToken) {
    throw new Error("Missing botToken. Set CODEX_TELEGRAM_BOT_TOKEN or configure botToken in config.json.");
  }
  if (config.allowedChatIds.length === 0) {
    throw new Error("Missing allowedChatIds. At least one Telegram chat id is required.");
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("runner.mjs")) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}

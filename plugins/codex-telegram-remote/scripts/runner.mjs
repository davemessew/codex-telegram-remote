#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

import {
  loadCodexProjectPaths,
  loadConfig,
  resolveConfiguredProjects,
} from "./lib/config.mjs";
import { createBotController } from "./lib/bot-controller.mjs";
import { startCompletionMonitor } from "./lib/completion-monitor.mjs";
import { AppServerJobRunner } from "./lib/app-server-runner.mjs";
import { CodexJobRunner } from "./lib/codex-runner.mjs";
import { createFileStateStore } from "./lib/state-store.mjs";
import {
  isTelegramGetUpdatesConflict,
  TelegramClient,
  telegramCommands,
} from "./lib/telegram.mjs";

async function main() {
  const config = loadConfig();
  assertConfig(config);
  const lock = acquireRunnerLock(path.join(config.configDir, "runner.lock"));
  if (!lock.acquired) {
    console.error(`[codex-telegram-remote] runner already active pid=${lock.ownerPid ?? "unknown"}`);
    return;
  }

  let stopCompletionMonitor = null;
  try {
    const projects = resolveConfiguredProjects({
      config,
      codexProjectPaths: loadCodexProjectPaths(config.codexHome),
    });
    const state = createFileStateStore(config.statePath);
    const telegram = new TelegramClient({ botToken: config.botToken });
    const codex = createJobRunner({ config, state });
    const controller = createBotController({
      config,
      projects,
      state,
      telegram,
      codex,
    });

    stopCompletionMonitor = startCompletionMonitor({
      config,
      projects,
      state,
      telegram,
    });
    await telegram.setMyCommands(telegramCommands());
    await runPollingLoop({
      telegram,
      controller,
      state,
      timeout: config.pollTimeoutSeconds,
    });
  } finally {
    stopCompletionMonitor?.();
    lock.release?.();
  }
}

export function createJobRunner({ config, state }) {
  const Runner = config.executionBackend === "cli"
    ? CodexJobRunner
    : AppServerJobRunner;
  return new Runner({
    codexBin: config.codexBin,
    state,
    maxConcurrentJobs: config.maxConcurrentJobs,
  });
}

export function acquireRunnerLock(
  lockPath,
  { pid = process.pid, isProcessAlive = defaultIsProcessAlive } = {},
) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const payload = { pid, startedAt: new Date().toISOString() };
      fs.writeFileSync(lockPath, JSON.stringify(payload), { flag: "wx", mode: 0o600 });
      return {
        acquired: true,
        ownerPid: pid,
        release: () => releaseRunnerLock(lockPath, pid),
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      const owner = readRunnerLock(lockPath);
      if (owner?.pid && isProcessAlive(owner.pid)) {
        return { acquired: false, ownerPid: owner.pid };
      }
      try {
        fs.unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") {
          throw unlinkError;
        }
      }
    }
  }
  const owner = readRunnerLock(lockPath);
  return { acquired: false, ownerPid: owner?.pid };
}

function releaseRunnerLock(lockPath, pid) {
  const owner = readRunnerLock(lockPath);
  if (owner?.pid !== pid) {
    return;
  }
  try {
    fs.unlinkSync(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function readRunnerLock(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
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
      console.error(`[codex-telegram-remote] ${formatPollingError(error)}`);
      await delay(pollingRetryDelay(error));
    }
  }
}

export function formatPollingError(error) {
  if (isTelegramGetUpdatesConflict(error)) {
    return [
      "Telegram getUpdates conflict: another runner is polling this bot token.",
      "Stop duplicate manual runners, scheduled tasks, or other machines using the same bot token.",
      "Retrying in 30 seconds.",
    ].join(" ");
  }
  return error.stack ?? error.message;
}

export function pollingRetryDelay(error) {
  return isTelegramGetUpdatesConflict(error) ? 30000 : 3000;
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

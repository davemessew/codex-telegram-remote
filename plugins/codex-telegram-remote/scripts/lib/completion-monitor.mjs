import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { buildExternalJob, buildStopNotification } from "./hook-notifier.mjs";
import { chunkTelegramText, normalizeTelegramDisplayText } from "./telegram.mjs";

const DEFAULT_INTERVAL_MS = 5000;
const SESSION_SCAN_LIMIT = 200;

export function startCompletionMonitor({
  config,
  projects,
  state,
  telegram,
  intervalMs = DEFAULT_INTERVAL_MS,
} = {}) {
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await scanAndNotifyCompletions({
        config,
        projects,
        state,
        telegram,
      });
    } catch (error) {
      console.error(`[codex-telegram-remote] completion monitor failed: ${error.stack ?? error.message}`);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function scanAndNotifyCompletions({
  config,
  projects = [],
  state,
  telegram,
  now = new Date(),
} = {}) {
  if (!config?.botToken || !telegram || !state || (config.completionChatIds ?? []).length === 0) {
    return [];
  }

  const files = findSessionFiles(config.codexHome);
  if (!state.getCompletionMonitorStartedAt()) {
    state.initializeCompletionMonitor({
      startedAt: now.toISOString(),
      fileOffsets: Object.fromEntries(files.map((file) => [file.path, file.size])),
    });
    return [];
  }

  const sent = [];
  for (const file of files) {
    const offset = resolveFileOffset({ state, file });
    if (offset >= file.size) {
      state.setCompletionMonitorFileOffset(file.path, file.size);
      continue;
    }

    const metadata = readSessionMetadata(file.path);
    const chunk = readFileRange(file.path, offset, file.size);
    state.setCompletionMonitorFileOffset(file.path, file.size);

    if (!isDesktopSession(metadata)) {
      continue;
    }

    const completions = extractCompletionEvents(chunk, {
      transcriptPath: file.path,
      metadata,
      fallbackTimestamp: new Date(file.mtimeMs).toISOString(),
    });

    for (const completion of completions) {
      const notified = await notifyCompletion({
        completion,
        config,
        projects,
        state,
        telegram,
        now,
      });
      if (notified) {
        sent.push(completion);
      }
    }
  }

  return sent;
}

export function extractCompletionEvents(text, {
  transcriptPath = "",
  metadata = {},
  fallbackTimestamp = new Date().toISOString(),
} = {}) {
  const completions = [];
  const seenMessages = new Set();

  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const finalMessage = readTaskCompletionMessage(event);
    if (!finalMessage || seenMessages.has(finalMessage)) {
      continue;
    }
    seenMessages.add(finalMessage);

    const timestamp = readCompletionTimestamp(event) ?? event.timestamp ?? fallbackTimestamp;
    completions.push({
      id: createCompletionNotificationId({
        transcriptPath,
        timestamp,
        finalMessage,
      }),
      transcriptPath,
      timestamp,
      finalMessage,
      cwd: event.payload?.cwd ?? metadata.cwd ?? "",
      threadId: event.payload?.thread_id ?? event.payload?.threadId ?? metadata.id ?? "",
    });
  }

  return completions;
}

export function createCompletionNotificationId({
  transcriptPath = "",
  timestamp = "",
  finalMessage = "",
} = {}) {
  return `completion-${digestText([transcriptPath, timestamp, finalMessage].join("|")).slice(0, 16)}`;
}

function findSessionFiles(codexHome) {
  const sessionsRoot = path.join(String(codexHome ?? ""), "sessions");
  if (!sessionsRoot || !fs.existsSync(sessionsRoot)) {
    return [];
  }

  const files = [];
  walkSessionFiles(sessionsRoot, files);
  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, SESSION_SCAN_LIMIT);
}

function walkSessionFiles(root, files) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkSessionFiles(entryPath, files);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const stats = fs.statSync(entryPath);
    files.push({
      path: entryPath,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    });
  }
}

function resolveFileOffset({ state, file }) {
  const storedOffset = state.getCompletionMonitorFileOffset(file.path);
  if (Number.isFinite(storedOffset)) {
    return Math.min(Math.max(0, Number(storedOffset)), file.size);
  }
  return 0;
}

function readFileRange(filePath, start, end) {
  const length = Math.max(0, end - start);
  if (length === 0) {
    return "";
  }

  const buffer = Buffer.alloc(length);
  const descriptor = fs.openSync(filePath, "r");
  try {
    fs.readSync(descriptor, buffer, 0, length, start);
  } finally {
    fs.closeSync(descriptor);
  }
  return buffer.toString("utf8");
}

function readSessionMetadata(filePath) {
  const preview = readFileRange(filePath, 0, Math.min(fs.statSync(filePath).size, 1024 * 1024));
  for (const line of preview.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    try {
      const event = JSON.parse(trimmed);
      if (event.type === "session_meta" && event.payload && typeof event.payload === "object") {
        return event.payload;
      }
    } catch {
      // Ignore non-JSON or truncated lines.
    }
  }
  return {};
}

function isDesktopSession(metadata = {}) {
  return /desktop/i.test(String(metadata.originator ?? ""))
    || /vscode|desktop/i.test(String(metadata.source ?? ""));
}

function readTaskCompletionMessage(event) {
  if (event?.type === "event_msg" && event.payload?.type === "task_complete") {
    return normalizeText(event.payload.last_agent_message);
  }
  if (event?.type === "task_complete") {
    return normalizeText(event.last_agent_message ?? event.payload?.last_agent_message);
  }
  return "";
}

function readCompletionTimestamp(event) {
  const completedAt = event?.payload?.completed_at ?? event?.completed_at;
  if (Number.isFinite(completedAt)) {
    return new Date(Number(completedAt) * 1000).toISOString();
  }
  return null;
}

async function notifyCompletion({
  completion,
  config,
  projects,
  state,
  telegram,
  now,
}) {
  if (state.hasCompletionNotification(completion.id) || hasEquivalentJob(state, completion)) {
    state.markCompletionNotification(completion.id, now.toISOString());
    return false;
  }

  for (const chatId of config.completionChatIds) {
    const job = buildExternalJob({
      payload: {
        cwd: completion.cwd,
        transcript_path: completion.transcriptPath,
        thread_id: completion.threadId,
      },
      finalMessage: completion.finalMessage,
      chatId,
      projects,
      now,
    });
    const monitorJob = {
      ...job,
      jobId: `monitor-${digestText(`${chatId}|${completion.id}`).slice(0, 10)}`,
      source: "monitor",
    };
    state.addJob(monitorJob);

    const notification = buildStopNotification({
      payload: {
        cwd: completion.cwd,
        transcript_path: completion.transcriptPath,
        thread_id: completion.threadId,
      },
      finalMessage: completion.finalMessage,
      job: monitorJob,
      sendFullFinalAnswer: config.sendFullFinalAnswer,
    });

    const chunks = chunkTelegramText(notification, config.telegramChunkSize);
    for (const [index, chunk] of chunks.entries()) {
      await telegram.sendMessage(chatId, chunk, index === 0 ? {
        reply_markup: buildSingleJobKeyboard(monitorJob),
      } : undefined);
    }
  }

  state.markCompletionNotification(completion.id, now.toISOString());
  return true;
}

function hasEquivalentJob(state, completion) {
  return state.listJobs().some((job) => (
    normalizePath(job.transcriptPath) === normalizePath(completion.transcriptPath)
    && normalizeText(job.finalMessage) === completion.finalMessage
  ));
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

function digestText(value) {
  return crypto.createHash("sha256").update(String(value)).digest("base64url").toLowerCase();
}

function normalizeText(value) {
  return normalizeTelegramDisplayText(value);
}

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

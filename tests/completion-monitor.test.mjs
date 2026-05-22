import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  extractCompletionEvents,
  scanAndNotifyCompletions,
} from "../plugins/codex-telegram-remote/scripts/lib/completion-monitor.mjs";
import { createMemoryStateStore } from "../plugins/codex-telegram-remote/scripts/lib/state-store.mjs";

test("extractCompletionEvents reads desktop task_complete final answers", () => {
  const finalMessage = "Fixed.\n\nSummary:\nImplemented.\n\nDetails:\nTests pass.";
  const events = extractCompletionEvents(
    [
      JSON.stringify({
        timestamp: "2026-05-22T00:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "task_complete",
          last_agent_message: finalMessage,
          completed_at: 1779408000,
        },
      }),
      "",
    ].join("\n"),
    {
      transcriptPath: "C:/Users/example/.codex/sessions/session.jsonl",
      metadata: {
        cwd: "C:/work/telegram",
        id: "thread-1",
      },
    },
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].finalMessage, finalMessage);
  assert.equal(events[0].cwd, "C:/work/telegram");
  assert.equal(events[0].threadId, "thread-1");
  assert.match(events[0].id, /^completion-[a-z0-9_-]{16}$/);
});

test("scanAndNotifyCompletions sends new desktop completions once with exact details", async () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
  const sessionDir = path.join(codexHome, "sessions", "2026", "05", "22");
  fs.mkdirSync(sessionDir, { recursive: true });
  const transcriptPath = path.join(sessionDir, "session.jsonl");
  fs.writeFileSync(
    transcriptPath,
    `${JSON.stringify({
      timestamp: "2026-05-22T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: "thread-1",
        cwd: "C:/work/telegram",
        originator: "Codex Desktop",
        source: "vscode",
      },
    })}\n`,
  );

  const calls = [];
  const state = createMemoryStateStore();
  const config = {
    botToken: "token",
    codexHome,
    completionChatIds: ["123"],
    sendFullFinalAnswer: true,
    telegramChunkSize: 3900,
  };
  const projects = [
    {
      id: "telegram",
      name: "telegram",
      path: "C:/work/telegram",
    },
  ];
  const telegram = {
    sendMessage: async (chatId, text, options) => {
      calls.push({ chatId, text, options });
      return { message_id: calls.length };
    },
  };

  await scanAndNotifyCompletions({
    config,
    projects,
    state,
    telegram,
    now: new Date("2026-05-22T00:00:01.000Z"),
  });

  const finalMessage = [
    "Fixed. The bug was the fallback summary case.",
    "",
    "Now details remove the summary prefix:",
    "",
    "Summary:",
    "Implemented the change.",
    "",
    "Details:",
    "Tests pass.",
    "Verified:",
    "",
    "npm.cmd test: 60 passing",
  ].join("\n");
  fs.appendFileSync(
    transcriptPath,
    `${JSON.stringify({
      timestamp: "2026-05-22T00:00:03.000Z",
      type: "event_msg",
      payload: {
        type: "task_complete",
        last_agent_message: finalMessage,
        completed_at: 1779408003,
      },
    })}\n`,
  );

  const sent = await scanAndNotifyCompletions({
    config,
    projects,
    state,
    telegram,
    now: new Date("2026-05-22T00:00:04.000Z"),
  });
  await scanAndNotifyCompletions({
    config,
    projects,
    state,
    telegram,
    now: new Date("2026-05-22T00:00:05.000Z"),
  });

  assert.equal(sent.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, "123");
  assert.equal(calls[0].options.reply_markup.inline_keyboard[0][0].callback_data.startsWith("job:monitor-"), true);
  assert.equal(
    calls[0].text,
    [
      "Codex task completed",
      `Job: ${state.listJobs("123")[0].jobId}`,
      "Project: telegram",
      "",
      "Details:",
      finalMessage,
    ].join("\n"),
  );
});

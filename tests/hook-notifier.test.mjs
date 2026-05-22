import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  buildExternalJob,
  buildStopNotification,
  readFinalMessageFromTranscript,
  shouldSuppressHookNotification,
} from "../plugins/codex-telegram-remote/scripts/lib/hook-notifier.mjs";

test("shouldSuppressHookNotification skips Telegram-launched Codex jobs", () => {
  assert.equal(
    shouldSuppressHookNotification({
      env: { CODEX_TELEGRAM_REMOTE_JOB_ID: "job-1" },
    }),
    true,
  );
});

test("buildStopNotification summarizes regular Codex task completion", () => {
  const job = {
    jobId: "hook-abc123",
    projectName: "Repo",
    summary: "Tests passed.",
  };

  assert.equal(
    buildStopNotification({
      payload: {
        cwd: "C:/Repo",
        transcript_path: "C:/Users/example/.codex/sessions/session.jsonl",
      },
      finalMessage: "All tests pass.",
      job,
    }),
    "Codex task completed\nJob: hook-abc123\nProject: Repo\n\nSummary:\nTests passed.\n\nFinal answer:\nAll tests pass.",
  );
});

test("buildStopNotification omits final answer when sendFullFinalAnswer is false", () => {
  assert.equal(
    buildStopNotification({
      finalMessage: "Summary:\nShort version.\n\nDetails:\nFull final answer.",
      sendFullFinalAnswer: false,
    }),
    "Codex task completed\n\nSummary:\nShort version.",
  );
});

test("buildExternalJob records regular Codex completions for a Telegram chat", () => {
  const job = buildExternalJob({
    payload: {
      cwd: "C:\\work\\telegram",
      transcript_path: "C:/Users/example/.codex/sessions/session.jsonl",
      thread_id: "thread-1",
    },
    finalMessage: "All tests pass.",
    chatId: "123",
    projects: [
      {
        id: "telegram",
        name: "telegram",
        path: "C:/work/telegram",
      },
    ],
    now: new Date("2026-05-22T00:00:00.000Z"),
  });

  assert.match(job.jobId, /^hook-[a-z0-9_-]{10}$/);
  assert.equal(job.chatId, "123");
  assert.equal(job.source, "hook");
  assert.equal(job.projectId, "telegram");
  assert.equal(job.projectName, "telegram");
  assert.equal(job.projectPath, "C:/work/telegram");
  assert.equal(job.threadId, "thread-1");
  assert.equal(job.finalMessage, "All tests pass.");
  assert.equal(job.summary, "All tests pass.");
  assert.equal(job.status, "completed");
  assert.equal(job.updatedAt, "2026-05-22T00:00:00.000Z");
});

test("readFinalMessageFromTranscript refuses paths outside allowed roots", () => {
  const allowedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
  const otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), "other-home-"));
  const transcriptPath = path.join(otherRoot, "session.jsonl");
  fs.writeFileSync(transcriptPath, '{"item":{"type":"agent_message","text":"secret"}}\n');

  assert.equal(
    readFinalMessageFromTranscript(transcriptPath, { allowedRoots: [allowedRoot] }),
    "",
  );
});

test("readFinalMessageFromTranscript reads final message inside allowed roots", () => {
  const allowedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
  const transcriptPath = path.join(allowedRoot, "session.jsonl");
  fs.writeFileSync(transcriptPath, '{"item":{"type":"agent_message","text":"safe"}}\n');

  assert.equal(
    readFinalMessageFromTranscript(transcriptPath, { allowedRoots: [allowedRoot] }),
    "safe",
  );
});

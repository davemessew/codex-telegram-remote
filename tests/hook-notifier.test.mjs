import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
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
  assert.equal(
    buildStopNotification({
      payload: {
        cwd: "C:/Repo",
        transcript_path: "C:/Users/example/.codex/sessions/session.jsonl",
      },
      finalMessage: "All tests pass.",
    }),
    "Codex task completed\nProject: C:/Repo\n\nAll tests pass.",
  );
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

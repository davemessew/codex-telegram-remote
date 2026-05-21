import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireRunnerLock,
  formatPollingError,
  pollingRetryDelay,
} from "../plugins/codex-telegram-remote/scripts/runner.mjs";
import { TelegramApiError } from "../plugins/codex-telegram-remote/scripts/lib/telegram.mjs";

test("acquireRunnerLock rejects a second live runner", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-telegram-runner-lock-"));
  const lockPath = path.join(dir, "runner.lock");

  const first = acquireRunnerLock(lockPath, {
    pid: 123,
    isProcessAlive: () => true,
  });
  const second = acquireRunnerLock(lockPath, {
    pid: 456,
    isProcessAlive: () => true,
  });

  try {
    assert.equal(first.acquired, true);
    assert.equal(second.acquired, false);
  } finally {
    first.release?.();
    second.release?.();
  }
});

test("acquireRunnerLock replaces stale runner locks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-telegram-runner-lock-"));
  const lockPath = path.join(dir, "runner.lock");
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 111, startedAt: "2026-05-21T00:00:00.000Z" }));

  const lock = acquireRunnerLock(lockPath, {
    pid: 222,
    isProcessAlive: () => false,
  });

  try {
    assert.equal(lock.acquired, true);
    const payload = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    assert.equal(payload.pid, 222);
  } finally {
    lock.release?.();
  }
});

test("formatPollingError explains Telegram getUpdates conflicts", () => {
  const error = new TelegramApiError({
    method: "getUpdates",
    errorCode: 409,
    description: "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running",
  });

  assert.match(formatPollingError(error), /another runner is polling this bot token/);
  assert.equal(pollingRetryDelay(error), 30000);
  assert.equal(pollingRetryDelay(new Error("network down")), 3000);
});

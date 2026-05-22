import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createFileStateStore,
  createMemoryStateStore,
} from "../plugins/codex-telegram-remote/scripts/lib/state-store.mjs";

test("bot message mappings are scoped by chat id", () => {
  const state = createMemoryStateStore();

  state.mapBotMessage("123", 5, "job-123");
  state.mapBotMessage("456", 5, "job-456");

  assert.equal(state.getJobForBotMessage("123", 5), "job-123");
  assert.equal(state.getJobForBotMessage("456", 5), "job-456");
});

test("last Telegram update id is persisted in state", () => {
  const state = createMemoryStateStore();

  state.setLastUpdateId(42);

  assert.equal(state.getLastUpdateId(), 42);
  assert.equal(state.snapshot().lastUpdateId, 42);
});

test("selected jobs are scoped by chat id", () => {
  const state = createMemoryStateStore();

  state.setSelectedJob("123", "job-123");
  state.setSelectedJob("456", "job-456");
  state.clearSelectedJob("456");

  assert.equal(state.getSelectedJob("123"), "job-123");
  assert.equal(state.getSelectedJob("456"), null);
});

test("selected threads are scoped by chat id and project id", () => {
  const state = createMemoryStateStore();

  state.setSelectedThread("123", "telegram", "thread-telegram");
  state.setSelectedThread("123", "api-service", "thread-api");
  state.setSelectedThread("456", "telegram", "thread-other-chat");
  state.clearSelectedThread("456", "telegram");

  assert.equal(state.getSelectedThread("123", "telegram"), "thread-telegram");
  assert.equal(state.getSelectedThread("123", "api-service"), "thread-api");
  assert.equal(state.getSelectedThread("456", "telegram"), null);
});

test("file state store writes private state JSON", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-telegram-state-"));
  const statePath = path.join(dir, "state.json");
  const state = createFileStateStore(statePath);

  state.setLastUpdateId(7);

  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).lastUpdateId, 7);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  }
});

test("file state store sees jobs written by another process and preserves them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-telegram-state-"));
  const statePath = path.join(dir, "state.json");
  const runnerState = createFileStateStore(statePath);
  const hookState = createFileStateStore(statePath);

  hookState.addJob({
    jobId: "hook-1",
    chatId: "123",
    status: "completed",
    updatedAt: "2026-05-22T00:00:00.000Z",
  });

  assert.equal(runnerState.listJobs("123")[0].jobId, "hook-1");

  runnerState.setLastUpdateId(42);

  const snapshot = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(snapshot.lastUpdateId, 42);
  assert.equal(snapshot.jobs["hook-1"].status, "completed");
});

test("file state store preserves explicit local clears while merging external jobs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-telegram-state-"));
  const statePath = path.join(dir, "state.json");
  const runnerState = createFileStateStore(statePath);
  const hookState = createFileStateStore(statePath);

  runnerState.setWaitingJob("123", "job-1");
  runnerState.setSelectedJob("123", "job-1");
  hookState.addJob({
    jobId: "hook-1",
    chatId: "123",
    status: "completed",
    updatedAt: "2026-05-22T00:00:00.000Z",
  });
  runnerState.clearWaitingJob("123");
  runnerState.clearSelectedJob("123");

  const snapshot = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(snapshot.waitingJobs["123"], undefined);
  assert.equal(snapshot.selectedJobs["123"], undefined);
  assert.equal(snapshot.jobs["hook-1"].status, "completed");
});

test("file state store keeps newer job updates when another process writes stale state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-telegram-state-"));
  const statePath = path.join(dir, "state.json");
  const runnerState = createFileStateStore(statePath);
  const workerState = createFileStateStore(statePath);

  runnerState.addJob({
    jobId: "job-1",
    chatId: "123",
    status: "running",
    updatedAt: "2026-05-22T00:00:00.000Z",
  });
  workerState.updateJob("job-1", {
    status: "completed",
    finalMessage: "done",
  });
  runnerState.addJob({
    jobId: "monitor-1",
    chatId: "123",
    status: "completed",
    updatedAt: "2026-05-22T00:02:00.000Z",
  });

  const snapshot = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(snapshot.jobs["job-1"].status, "completed");
  assert.equal(snapshot.jobs["job-1"].finalMessage, "done");
  assert.equal(snapshot.jobs["monitor-1"].status, "completed");
});

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

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
  AppServerJobRunner,
  extractFinalMessageFromTurn,
  normalizeAppServerThreads,
} from "../plugins/codex-telegram-remote/scripts/lib/app-server-runner.mjs";
import { createMemoryStateStore } from "../plugins/codex-telegram-remote/scripts/lib/state-store.mjs";

test("normalizeAppServerThreads returns newest GUI threads for a project", () => {
  const threads = normalizeAppServerThreads({
    data: [
      {
        id: "thread-old",
        cwd: "C:/work/telegram",
        name: "Old thread",
        preview: "old preview",
        updatedAt: 1779460000,
        source: "vscode",
      },
      {
        id: "thread-new",
        cwd: "C:\\work\\telegram\\",
        name: "New thread",
        preview: "new preview",
        updatedAt: 1779465000,
        source: "vscode",
      },
      {
        id: "thread-other",
        cwd: "C:/work/other",
        name: "Other thread",
        preview: "other preview",
        updatedAt: 1779469000,
        source: "vscode",
      },
    ],
  }, { projectPath: "C:/work/telegram" });

  assert.deepEqual(threads.map((thread) => thread.threadId), ["thread-new", "thread-old"]);
  assert.equal(threads[0].name, "New thread");
  assert.equal(threads[0].updatedAt, "2026-05-22T15:50:00.000Z");
});

test("extractFinalMessageFromTurn prefers final-answer agent messages", () => {
  const message = extractFinalMessageFromTurn({
    items: [
      { type: "agentMessage", text: "working", phase: "commentary" },
      { type: "agentMessage", text: "done", phase: "final_answer" },
    ],
  });

  assert.equal(message, "done");
});

test("AppServerJobRunner defaults to the latest project thread and records a GUI job", async () => {
  const child = createFakeAppServerChild((request, send) => {
    if (request.method === "initialize") {
      send({ id: request.id, result: { codexHome: "C:/Users/example/.codex", platformFamily: "windows", platformOs: "windows", userAgent: "test" } });
    }
    if (request.method === "thread/list") {
      send({
        id: request.id,
        result: {
          data: [
            { id: "thread-old", cwd: "C:/work/telegram", name: "Old", preview: "", updatedAt: 10, source: "vscode" },
            { id: "thread-new", cwd: "C:/work/telegram", name: "New", preview: "", updatedAt: 20, source: "vscode" },
          ],
        },
      });
    }
    if (request.method === "thread/resume") {
      assert.equal(request.params.threadId, "thread-new");
      send({ id: request.id, result: { thread: { id: "thread-new" } } });
    }
    if (request.method === "turn/start") {
      assert.equal(request.params.threadId, "thread-new");
      assert.equal(request.params.input[0].text, "run in gui");
      send({ id: request.id, result: { turn: { id: "turn-1", status: "inProgress", items: [] } } });
      send({
        method: "turn/completed",
        params: {
          threadId: "thread-new",
          turn: {
            id: "turn-1",
            status: "completed",
            items: [
              { type: "agentMessage", text: "GUI done", phase: "final_answer" },
            ],
          },
        },
      });
    }
  });
  const state = createMemoryStateStore();
  const runner = new AppServerJobRunner({
    codexBin: "codex",
    state,
    spawnImpl: () => child,
    env: {},
  });

  const job = await runner.startJob({
    chatId: "123",
    project: { id: "telegram", name: "telegram", path: "C:/work/telegram" },
    prompt: "run in gui",
  });

  assert.equal(job.status, "completed");
  assert.equal(job.threadId, "thread-new");
  assert.equal(job.finalMessage, "GUI done");
  assert.equal(state.getJob(job.jobId).source, "appServer");
});

test("AppServerJobRunner reads the completed thread when turn items are not loaded", async () => {
  const child = createFakeAppServerChild((request, send) => {
    if (request.method === "initialize") {
      send({ id: request.id, result: { codexHome: "C:/Users/example/.codex", platformFamily: "windows", platformOs: "windows", userAgent: "test" } });
    }
    if (request.method === "thread/resume") {
      send({ id: request.id, result: { thread: { id: "thread-selected" } } });
    }
    if (request.method === "turn/start") {
      send({ id: request.id, result: { turn: { id: "turn-1", status: "inProgress", items: [] } } });
      send({
        method: "turn/completed",
        params: {
          threadId: "thread-selected",
          turn: {
            id: "turn-1",
            status: "completed",
            items: [],
            itemsView: "notLoaded",
          },
        },
      });
    }
    if (request.method === "thread/read") {
      assert.equal(request.params.threadId, "thread-selected");
      assert.equal(request.params.includeTurns, true);
      send({
        id: request.id,
        result: {
          thread: {
            id: "thread-selected",
            path: "C:/Users/example/.codex/sessions/thread.jsonl",
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [
                  { type: "agentMessage", text: "Hydrated GUI done", phase: "final_answer" },
                ],
              },
            ],
          },
        },
      });
    }
  });
  const state = createMemoryStateStore();
  const runner = new AppServerJobRunner({
    codexBin: "codex",
    state,
    spawnImpl: () => child,
    env: {},
  });

  const job = await runner.startJob({
    chatId: "123",
    project: { id: "telegram", name: "telegram", path: "C:/work/telegram" },
    prompt: "run in gui",
    threadId: "thread-selected",
  });

  assert.equal(job.status, "completed");
  assert.equal(job.finalMessage, "Hydrated GUI done");
  assert.equal(job.transcriptPath, "C:/Users/example/.codex/sessions/thread.jsonl");
});

function createFakeAppServerChild(handleRequest) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write(value) {
      const request = JSON.parse(String(value).trim());
      handleRequest(request, (message) => {
        child.stdout.emit("data", `${JSON.stringify(message)}\n`);
      });
      return true;
    },
    end() {
      child.emit("close", 0);
    },
  };
  child.kill = () => {
    child.killed = true;
    child.emit("close", 1);
  };
  return child;
}

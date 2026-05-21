import assert from "node:assert/strict";
import { test } from "node:test";

import { createBotController } from "../plugins/codex-telegram-remote/scripts/lib/bot-controller.mjs";
import { createMemoryStateStore } from "../plugins/codex-telegram-remote/scripts/lib/state-store.mjs";

const projects = [
  {
    id: "telegram",
    name: "telegram",
    path: "C:/work/telegram",
  },
];

function createHarness() {
  const calls = [];
  const jobs = new Map();
  const config = {
    allowedChatIds: ["123", "456"],
    telegramChunkSize: 3900,
    sendFullFinalAnswer: true,
  };
  const telegram = {
    sendMessage: async (chatId, text, options) => {
      calls.push({ method: "sendMessage", chatId, text, options });
      return { message_id: calls.length };
    },
    editMessageText: async (chatId, messageId, text, options) => {
      calls.push({ method: "editMessageText", chatId, messageId, text, options });
    },
    answerCallbackQuery: async (callbackQueryId, text) => {
      calls.push({ method: "answerCallbackQuery", callbackQueryId, text });
    },
  };
  const codex = {
    startJob: async ({ chatId, project, prompt }) => {
      if (prompt === "fail") {
        throw new Error("Codex failed");
      }
      const status = prompt.endsWith("?") ? "awaiting_reply" : "completed";
      jobs.set("job-1", { jobId: "job-1", chatId: String(chatId), status });
      calls.push({ method: "startJob", chatId, project, prompt });
      return {
        jobId: "job-1",
        threadId: "thread-1",
        finalMessage: status === "awaiting_reply" ? "Which option?" : "finished",
        status,
      };
    },
    resumeJob: async ({ jobId, prompt }) => {
      if (prompt === "resume fail") {
        throw new Error("Resume failed");
      }
      calls.push({ method: "resumeJob", jobId, prompt });
      return {
        jobId,
        threadId: "thread-1",
        finalMessage: "continued",
        status: "completed",
      };
    },
    listJobs: (chatId) => [...jobs.values()].filter((job) => !chatId || job.chatId === String(chatId)),
    cancelJob: async (jobId) => {
      calls.push({ method: "cancelJob", jobId });
      return jobs.delete(jobId);
    },
  };

  return {
    calls,
    config,
    controller: createBotController({
      config,
      projects,
      state: createMemoryStateStore(),
      telegram,
      codex,
    }),
  };
}

test("/select sends a tappable project picker", async () => {
  const { calls, controller } = createHarness();

  await controller.handleUpdate({
    message: {
      message_id: 1,
      chat: { id: 123 },
      text: "/select",
    },
  });

  assert.equal(calls[0].method, "sendMessage");
  assert.equal(calls[0].text, "Select a project.");
  assert.equal(calls[0].options.reply_markup.inline_keyboard[0][0].callback_data, "select:telegram");
});

test("select callback stores the current project", async () => {
  const { calls, controller } = createHarness();

  await controller.handleUpdate({
    callback_query: {
      id: "cb-1",
      data: "select:telegram",
      message: { message_id: 10, chat: { id: 123 } },
    },
  });

  assert.deepEqual(calls.map((call) => call.method), [
    "answerCallbackQuery",
    "editMessageText",
  ]);
  assert.equal(calls[1].text, "Selected project: telegram");
});

test("normal message without a selected project opens the picker", async () => {
  const { calls, controller } = createHarness();

  await controller.handleUpdate({
    message: {
      message_id: 1,
      chat: { id: 123 },
      text: "run tests",
    },
  });

  assert.equal(calls[0].method, "sendMessage");
  assert.equal(calls[0].text, "Select a project.");
});

test("normal message with a selected project starts a Codex job", async () => {
  const { calls, controller } = createHarness();

  await controller.handleUpdate({
    callback_query: {
      id: "cb-1",
      data: "select:telegram",
      message: { message_id: 10, chat: { id: 123 } },
    },
  });
  await controller.handleUpdate({
    message: {
      message_id: 2,
      chat: { id: 123 },
      text: "run tests",
    },
  });

  assert.equal(calls[2].method, "startJob");
  assert.equal(calls[2].project.id, "telegram");
  assert.equal(calls[2].prompt, "run tests");
  assert.equal(calls.at(-1).text, "finished");
});

test("unauthorized chats are rejected before any Codex work starts", async () => {
  const { calls, controller } = createHarness();

  await controller.handleUpdate({
    message: {
      message_id: 1,
      chat: { id: 999 },
      text: "/select",
    },
  });

  assert.deepEqual(calls, []);
});

test("reply message mappings are scoped to the Telegram chat", async () => {
  const { calls, controller } = createHarness();

  await controller.handleUpdate({
    callback_query: {
      id: "cb-1",
      data: "select:telegram",
      message: { message_id: 10, chat: { id: 123 } },
    },
  });
  await controller.handleUpdate({
    message: {
      message_id: 2,
      chat: { id: 123 },
      text: "run tests?",
    },
  });
  await controller.handleUpdate({
    message: {
      message_id: 3,
      chat: { id: 456 },
      text: "wrong chat reply",
      reply_to_message: { message_id: 4 },
    },
  });

  assert.equal(calls.some((call) => call.method === "resumeJob"), false);
});

test("cancel only targets jobs owned by the same Telegram chat", async () => {
  const { calls, controller } = createHarness();

  await controller.handleUpdate({
    message: {
      message_id: 1,
      chat: { id: 456 },
      text: "/cancel job-1",
    },
  });

  assert.equal(calls.some((call) => call.method === "cancelJob"), false);
  assert.equal(calls.at(-1).text, "No matching job found.");
});

test("sendFullFinalAnswer false sends status instead of full output", async () => {
  const { calls, config, controller } = createHarness();
  config.sendFullFinalAnswer = false;

  await controller.handleUpdate({
    callback_query: {
      id: "cb-1",
      data: "select:telegram",
      message: { message_id: 10, chat: { id: 123 } },
    },
  });
  await controller.handleUpdate({
    message: {
      message_id: 2,
      chat: { id: 123 },
      text: "run tests",
    },
  });

  assert.match(calls.at(-1).text, /^Job: job-1\nStatus: completed/);
  assert.equal(calls.at(-1).text.includes("finished"), false);
});

test("Codex start errors are reported to the same Telegram chat", async () => {
  const { calls, controller } = createHarness();

  await controller.handleUpdate({
    callback_query: {
      id: "cb-1",
      data: "select:telegram",
      message: { message_id: 10, chat: { id: 123 } },
    },
  });
  await controller.handleUpdate({
    message: {
      message_id: 2,
      chat: { id: 123 },
      text: "fail",
    },
  });

  assert.equal(calls.at(-1).text, "Codex job failed to start: Codex failed");
});

test("Codex resume errors are reported to the same Telegram chat", async () => {
  const { calls, controller } = createHarness();

  await controller.handleUpdate({
    callback_query: {
      id: "cb-1",
      data: "select:telegram",
      message: { message_id: 10, chat: { id: 123 } },
    },
  });
  await controller.handleUpdate({
    message: {
      message_id: 2,
      chat: { id: 123 },
      text: "choose?",
    },
  });
  await controller.handleUpdate({
    message: {
      message_id: 3,
      chat: { id: 123 },
      text: "resume fail",
    },
  });

  assert.equal(calls.at(-1).text, "Codex job failed to resume: Resume failed");
});

import { spawn } from "node:child_process";

import {
  discoverCodexBinary,
  looksLikeUserInputRequest,
} from "./codex-runner.mjs";
import { normalizeTelegramDisplayText } from "./telegram.mjs";

const MAX_CAPTURED_OUTPUT_CHARS = 200_000;

export class AppServerJobRunner {
  constructor({ codexBin, state, maxConcurrentJobs = 1, env = process.env, spawnImpl = spawn }) {
    this.codexBin = discoverCodexBinary({ configuredPath: codexBin, env });
    this.state = state;
    this.maxConcurrentJobs = maxConcurrentJobs;
    this.env = env;
    this.spawn = spawnImpl;
    this.running = new Map();
    this.cancelled = new Set();
  }

  listJobs(chatId) {
    return this.state.listJobs(chatId);
  }

  async listProjectThreads(project, { limit = 8 } = {}) {
    const transport = this.createTransport({ cwd: project.path });
    try {
      await initializeAppServer(transport);
      const result = await transport.request("thread/list", {
        cwd: project.path,
        limit,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: [],
      });
      return normalizeAppServerThreads(result, { projectPath: project.path }).slice(0, limit);
    } finally {
      transport.close();
    }
  }

  async startJob({ chatId, project, prompt, threadId }) {
    const job = await this.prepareStartJob({ chatId, project, prompt, threadId });
    return this.runJob({ job, prompt });
  }

  async startJobDetached({ chatId, project, prompt, threadId, onComplete, onError }) {
    const job = await this.prepareStartJob({ chatId, project, prompt, threadId });
    this.runJob({ job, prompt }).then(
      (completedJob) => onComplete?.(completedJob),
      (error) => onError?.(error, job),
    );
    return job;
  }

  async prepareStartJob({ chatId, project, prompt, threadId }) {
    if (this.running.size >= this.maxConcurrentJobs) {
      throw new Error(`Maximum concurrent Codex jobs reached (${this.maxConcurrentJobs}).`);
    }

    const thread = await this.resolveThread(project, threadId);
    const timestamp = new Date().toISOString();
    const job = {
      jobId: createJobId(),
      chatId: String(chatId),
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      prompt,
      source: "appServer",
      status: "running",
      threadId: thread.threadId,
      threadName: thread.name,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state.addJob(job);
    return job;
  }

  async resumeJob({ jobId, prompt }) {
    const job = this.prepareResumeJob({ jobId, prompt });
    return this.runJob({ job, prompt });
  }

  async resumeJobDetached({ jobId, prompt, onComplete, onError }) {
    const job = this.prepareResumeJob({ jobId, prompt });
    this.runJob({ job, prompt }).then(
      (completedJob) => onComplete?.(completedJob),
      (error) => onError?.(error, job),
    );
    return job;
  }

  prepareResumeJob({ jobId, prompt }) {
    if (this.running.size >= this.maxConcurrentJobs) {
      throw new Error(`Maximum concurrent Codex jobs reached (${this.maxConcurrentJobs}).`);
    }
    const job = this.state.getJob(jobId);
    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    if (!job.threadId) {
      throw new Error(`Job ${jobId} does not have a GUI thread id yet.`);
    }

    return this.state.updateJob(jobId, {
      status: "running",
      prompt,
    });
  }

  async cancelJob(jobId) {
    const transport = this.running.get(jobId);
    if (!transport) {
      if (this.state.getJob(jobId)) {
        this.state.updateJob(jobId, {
          status: "cancelled",
          finalMessage: "Cancelled.",
          completedAt: new Date().toISOString(),
        });
      }
      return false;
    }

    this.cancelled.add(jobId);
    transport.kill();
    this.running.delete(jobId);
    this.state.updateJob(jobId, {
      status: "cancelled",
      finalMessage: "Cancelled.",
      completedAt: new Date().toISOString(),
    });
    return true;
  }

  async runJob({ job, prompt }) {
    const startedAt = new Date().toISOString();
    const transport = this.createTransport({
      cwd: job.projectPath,
      jobId: job.jobId,
    });
    this.running.set(job.jobId, transport);

    let completion = null;
    try {
      await initializeAppServer(transport);
      await transport.request("thread/resume", {
        threadId: job.threadId,
        cwd: job.projectPath,
        excludeTurns: true,
      });

      completion = transport.waitForNotification(
        "turn/completed",
        (params) => params?.threadId === job.threadId,
      );
      const startResult = await transport.request("turn/start", {
        threadId: job.threadId,
        cwd: job.projectPath,
        input: [
          {
            type: "text",
            text: prompt,
            text_elements: [],
          },
        ],
      });

      let turn = readTurn(startResult);
      if (!isTerminalTurn(turn)) {
        const notification = await completion.promise;
        turn = readTurn(notification);
      }

      const hydrated = await hydrateCompletedTurn({
        transport,
        threadId: job.threadId,
        turn,
      });
      turn = hydrated.turn ?? turn;

      const rawFinalMessage = extractFinalMessageFromTurn(turn);
      const wasCancelled = this.cancelled.has(job.jobId);
      const status = wasCancelled
        ? "cancelled"
        : resolveTurnStatus(turn, rawFinalMessage);
      const finalMessage = wasCancelled
        ? "Cancelled."
        : rawFinalMessage || `Codex app-server turn ended with status ${turn?.status ?? "unknown"}.`;
      const updated = this.state.updateJob(job.jobId, {
        status,
        finalMessage,
        summary: wasCancelled ? "" : normalizeText(readTurnSummary(turn)),
        transcriptPath: hydrated.transcriptPath || job.transcriptPath,
        stdoutTail: "",
        stderrTail: tail(transport.stderr),
        startedAt,
        completedAt: new Date().toISOString(),
      });
      return updated;
    } catch (error) {
      const wasCancelled = this.cancelled.has(job.jobId);
      const updated = this.state.updateJob(job.jobId, {
        status: wasCancelled ? "cancelled" : "failed",
        finalMessage: wasCancelled ? "Cancelled." : error.message,
        error: wasCancelled ? undefined : error.message,
        stderrTail: tail(transport.stderr),
        startedAt,
        completedAt: new Date().toISOString(),
      });
      return updated;
    } finally {
      completion?.cancel();
      this.running.delete(job.jobId);
      this.cancelled.delete(job.jobId);
      transport.close();
    }
  }

  async resolveThread(project, threadId) {
    if (threadId) {
      return {
        threadId,
        name: "",
      };
    }

    const [latestThread] = await this.listProjectThreads(project, { limit: 1 });
    if (!latestThread) {
      throw new Error(`No GUI threads found for ${project.name}. Open a Codex desktop conversation for this project first or set executionBackend to "cli".`);
    }
    return latestThread;
  }

  createTransport({ cwd, jobId }) {
    return new JsonRpcAppServerTransport({
      codexBin: this.codexBin,
      cwd,
      env: this.env,
      jobId,
      spawnImpl: this.spawn,
    });
  }
}

export function normalizeAppServerThreads(result, { projectPath = "" } = {}) {
  const data = Array.isArray(result?.data)
    ? result.data
    : Array.isArray(result)
      ? result
      : [];
  const normalizedProjectPath = normalizePathForCompare(projectPath);

  return data
    .map((thread) => ({
      threadId: String(thread.id ?? thread.threadId ?? ""),
      name: normalizeText(thread.name ?? thread.title ?? thread.preview ?? thread.id ?? ""),
      preview: normalizeText(thread.preview ?? ""),
      projectPath: String(thread.cwd ?? thread.projectPath ?? ""),
      transcriptPath: String(thread.path ?? thread.transcriptPath ?? ""),
      source: String(thread.source ?? ""),
      updatedAt: normalizeTimestamp(thread.updatedAt ?? thread.updated_at ?? thread.mtime ?? ""),
      updatedTime: timestampToTime(thread.updatedAt ?? thread.updated_at ?? thread.mtime ?? ""),
    }))
    .filter((thread) => thread.threadId)
    .filter((thread) => !normalizedProjectPath || normalizePathForCompare(thread.projectPath) === normalizedProjectPath)
    .sort((left, right) => right.updatedTime - left.updatedTime);
}

export function extractFinalMessageFromTurn(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const agentMessages = items
    .filter((item) => String(item.type ?? "").toLowerCase() === "agentmessage")
    .map((item) => ({
      phase: String(item.phase ?? ""),
      text: normalizeText(readItemText(item)),
    }))
    .filter((item) => item.text);

  const finalAnswer = agentMessages.find((item) => item.phase === "final_answer");
  return finalAnswer?.text ?? agentMessages.at(-1)?.text ?? "";
}

class JsonRpcAppServerTransport {
  constructor({ codexBin, cwd, env, jobId, spawnImpl }) {
    this.nextId = 1;
    this.pending = new Map();
    this.notificationWaiters = new Set();
    this.stdoutBuffer = "";
    this.stderr = "";
    this.closed = false;
    this.child = spawnImpl(codexBin, ["app-server", "--listen", "stdio://"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...env,
        ...(jobId ? { CODEX_TELEGRAM_REMOTE_JOB_ID: jobId } : {}),
      },
      windowsHide: true,
    });

    this.child.stdout?.on("data", (chunk) => this.handleStdout(chunk));
    this.child.stderr?.on("data", (chunk) => {
      this.stderr = appendBounded(this.stderr, chunk.toString());
    });
    this.child.on("error", (error) => this.failAll(error));
    this.child.on("close", (exitCode) => {
      this.closed = true;
      this.failAll(new Error(`Codex app-server exited with code ${exitCode}.`));
    });
  }

  request(method, params = {}) {
    if (this.closed) {
      return Promise.reject(new Error("Codex app-server is already closed."));
    }

    const id = this.nextId;
    this.nextId += 1;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.child.stdin?.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  waitForNotification(method, predicate = () => true) {
    let active = true;
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const waiter = {
      method,
      predicate,
      resolve: (value) => {
        if (!active) {
          return;
        }
        active = false;
        this.notificationWaiters.delete(waiter);
        resolvePromise(value);
      },
      reject: (error) => {
        if (!active) {
          return;
        }
        active = false;
        this.notificationWaiters.delete(waiter);
        rejectPromise(error);
      },
    };
    this.notificationWaiters.add(waiter);

    return {
      promise,
      cancel: () => {
        if (!active) {
          return;
        }
        active = false;
        this.notificationWaiters.delete(waiter);
        resolvePromise(null);
      },
    };
  }

  close() {
    try {
      this.child.stdin?.end();
    } catch {
      // Process may already be gone.
    }
  }

  kill() {
    try {
      this.child.kill();
    } catch {
      // Process may already be gone.
    }
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk.toString();
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      this.handleLine(line);
    }
  }

  handleLine(line) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed.startsWith("{")) {
      return;
    }

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      this.resolveNotification(message.method, message.params);
    }
  }

  resolveNotification(method, params) {
    for (const waiter of [...this.notificationWaiters]) {
      if (waiter.method !== method) {
        continue;
      }
      if (!waiter.predicate(params)) {
        continue;
      }
      waiter.resolve(params);
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of [...this.notificationWaiters]) {
      waiter.reject(error);
    }
  }
}

async function initializeAppServer(transport) {
  return transport.request("initialize", {
    clientInfo: {
      name: "codex-telegram-remote",
      version: "0.1.9",
    },
    capabilities: {
      experimentalApi: true,
    },
  });
}

function readTurn(value) {
  if (!value) {
    return null;
  }
  if (value.turn) {
    return value.turn;
  }
  if (value.params?.turn) {
    return value.params.turn;
  }
  if (value.data?.turn) {
    return value.data.turn;
  }
  return value;
}

async function hydrateCompletedTurn({ transport, threadId, turn }) {
  if (!shouldHydrateTurn(turn)) {
    return {
      turn,
      transcriptPath: "",
    };
  }

  const result = await transport.request("thread/read", {
    threadId,
    includeTurns: true,
  });
  const thread = result?.thread ?? result;
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  return {
    turn: turns.find((candidate) => candidate.id === turn?.id) ?? turns.at(-1) ?? turn,
    transcriptPath: String(thread?.path ?? ""),
  };
}

function shouldHydrateTurn(turn) {
  if (!turn) {
    return true;
  }
  if (extractFinalMessageFromTurn(turn)) {
    return false;
  }
  return isTerminalTurn(turn);
}

function readTurnSummary(turn) {
  if (typeof turn?.summary === "string") {
    return turn.summary;
  }
  if (typeof turn?.summary?.text === "string") {
    return turn.summary.text;
  }
  return "";
}

function isTerminalTurn(turn) {
  const status = String(turn?.status ?? "").toLowerCase();
  return ["completed", "failed", "error", "cancelled", "canceled", "interrupted"].includes(status);
}

function resolveTurnStatus(turn, finalMessage) {
  const status = String(turn?.status ?? "").toLowerCase();
  if (["failed", "error"].includes(status)) {
    return "failed";
  }
  if (["cancelled", "canceled", "interrupted"].includes(status)) {
    return "cancelled";
  }
  if (looksLikeUserInputRequest(finalMessage)) {
    return "awaiting_reply";
  }
  return "completed";
}

function readItemText(item) {
  if (typeof item.text === "string") {
    return item.text;
  }
  if (typeof item.message === "string") {
    return item.message;
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  if (Array.isArray(item.content)) {
    return item.content
      .map((part) => part.text ?? part.content ?? "")
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function normalizeTimestamp(value) {
  const time = timestampToTime(value);
  return time > 0 ? new Date(time).toISOString() : "";
}

function timestampToTime(value) {
  if (Number.isFinite(value)) {
    const number = Number(value);
    return number > 1_000_000_000_000 ? number : number * 1000;
  }

  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      return timestampToTime(asNumber);
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function createJobId() {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value) {
  return normalizeTelegramDisplayText(value);
}

function normalizePathForCompare(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function tail(value, maxLength = 4000) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : text.slice(-maxLength);
}

function appendBounded(current, addition, maxLength = MAX_CAPTURED_OUTPUT_CHARS) {
  const next = current + addition;
  return next.length <= maxLength ? next : next.slice(-maxLength);
}

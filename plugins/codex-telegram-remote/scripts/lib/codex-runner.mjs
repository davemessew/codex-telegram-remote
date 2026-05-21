import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_CAPTURED_OUTPUT_CHARS = 200_000;

export function buildCodexInvocation({ codexBin = "codex", cwd, prompt, sessionId }) {
  if (sessionId) {
    return {
      command: codexBin,
      args: ["exec", "resume", "--json", sessionId, prompt],
    };
  }

  return {
    command: codexBin,
    args: ["exec", "--json", "-C", cwd, prompt],
  };
}

export function parseCodexJsonl(output) {
  const result = {
    threadId: null,
    finalMessage: "",
    usage: null,
    errors: [],
  };

  for (const line of String(output ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("{")) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (event.type === "thread.started" && event.thread_id) {
      result.threadId = event.thread_id;
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      result.finalMessage = event.item.text ?? "";
    }
    if (event.type === "turn.completed") {
      result.usage = event.usage ?? null;
    }
    if (event.type === "error") {
      result.errors.push(event.message ?? JSON.stringify(event));
    }
  }

  return result;
}

export function looksLikeUserInputRequest(text) {
  const value = String(text ?? "").trim();
  if (!value) {
    return false;
  }

  return /\?\s*$/.test(value)
    || /\b(which option|please reply|please confirm|choose one|what should i)\b/i.test(value);
}

export class CodexJobRunner {
  constructor({ codexBin, state, maxConcurrentJobs = 1, env = process.env, spawnImpl = spawn }) {
    this.codexBin = discoverCodexBinary({ configuredPath: codexBin, env });
    this.state = state;
    this.maxConcurrentJobs = maxConcurrentJobs;
    this.env = env;
    this.spawn = spawnImpl;
    this.running = new Map();
  }

  listJobs(chatId) {
    return this.state.listJobs(chatId);
  }

  async startJob({ chatId, project, prompt }) {
    if (this.running.size >= this.maxConcurrentJobs) {
      throw new Error(`Maximum concurrent Codex jobs reached (${this.maxConcurrentJobs}).`);
    }

    const jobId = createJobId();
    const job = {
      jobId,
      chatId: String(chatId),
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      prompt,
      status: "running",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.state.addJob(job);

    return this.runJob({
      job,
      invocation: buildCodexInvocation({
        codexBin: this.codexBin,
        cwd: project.path,
        prompt,
      }),
      cwd: project.path,
    });
  }

  async resumeJob({ jobId, prompt }) {
    if (this.running.size >= this.maxConcurrentJobs) {
      throw new Error(`Maximum concurrent Codex jobs reached (${this.maxConcurrentJobs}).`);
    }
    const job = this.state.getJob(jobId);
    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    if (!job.threadId) {
      throw new Error(`Job ${jobId} does not have a Codex thread id yet.`);
    }

    this.state.updateJob(jobId, {
      status: "running",
      prompt,
    });

    return this.runJob({
      job,
      invocation: buildCodexInvocation({
        codexBin: this.codexBin,
        sessionId: job.threadId,
        prompt,
      }),
      cwd: job.projectPath,
    });
  }

  async cancelJob(jobId) {
    const child = this.running.get(jobId);
    if (!child) {
      if (this.state.getJob(jobId)) {
        this.state.updateJob(jobId, { status: "cancelled" });
      }
      return false;
    }
    child.kill();
    this.running.delete(jobId);
    this.state.updateJob(jobId, { status: "cancelled" });
    return true;
  }

  runJob({ job, invocation, cwd }) {
    return new Promise((resolve) => {
      const startedAt = new Date().toISOString();
      const child = this.spawn(invocation.command, invocation.args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...this.env,
          CODEX_TELEGRAM_REMOTE_JOB_ID: job.jobId,
        },
        windowsHide: true,
      });
      this.running.set(job.jobId, child);

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk) => {
        stdout = appendBounded(stdout, chunk.toString());
      });
      child.stderr?.on("data", (chunk) => {
        stderr = appendBounded(stderr, chunk.toString());
      });
      child.on("error", (error) => {
        this.running.delete(job.jobId);
        const failed = this.state.updateJob(job.jobId, {
          status: "failed",
          error: error.message,
          startedAt,
          completedAt: new Date().toISOString(),
        });
        resolve(failed);
      });
      child.on("close", (exitCode) => {
        this.running.delete(job.jobId);
        const parsed = parseCodexJsonl(stdout);
        const status = exitCode === 0
          ? looksLikeUserInputRequest(parsed.finalMessage) ? "awaiting_reply" : "completed"
          : "failed";
        const finalMessage = parsed.finalMessage || stderr.trim() || `Codex exited with code ${exitCode}.`;
        const updated = this.state.updateJob(job.jobId, {
          status,
          threadId: parsed.threadId ?? job.threadId,
          finalMessage,
          usage: parsed.usage,
          stdoutTail: tail(stdout),
          stderrTail: tail(stderr),
          exitCode,
          startedAt,
          completedAt: new Date().toISOString(),
        });
        resolve(updated);
      });
    });
  }
}

export function discoverCodexBinary({ configuredPath = "", env = process.env } = {}) {
  const candidates = [
    configuredPath,
    env.CODEX_CLI_PATH,
    env.CODEX_BIN,
    ...windowsCodexCandidates(),
    "codex",
  ].filter(Boolean);

  return discoverCodexBinaryFromCandidates({
    candidates,
    exists: (candidate) => fs.existsSync(candidate),
  });
}

export function discoverCodexBinaryFromCandidates({ candidates, exists }) {
  for (const candidate of candidates) {
    if (candidate !== "codex" && exists(candidate)) {
      return candidate;
    }
  }

  return "codex";
}

function windowsCodexCandidates() {
  if (process.platform !== "win32") {
    return [];
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return [];
  }

  const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
  if (!fs.existsSync(binRoot)) {
    return [];
  }

  const candidates = [];
  for (const folder of fs.readdirSync(binRoot, { withFileTypes: true })) {
    if (!folder.isDirectory()) {
      continue;
    }
    const executable = path.join(binRoot, folder.name, "codex.exe");
    if (fs.existsSync(executable)) {
      candidates.push(executable);
    }
  }

  return candidates;
}

function createJobId() {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function tail(value, maxLength = 4000) {
  const text = String(value ?? "");
  return text.length <= maxLength ? text : text.slice(-maxLength);
}

function appendBounded(current, addition, maxLength = MAX_CAPTURED_OUTPUT_CHARS) {
  const next = current + addition;
  return next.length <= maxLength ? next : next.slice(-maxLength);
}

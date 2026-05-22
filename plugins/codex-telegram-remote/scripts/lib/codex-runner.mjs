import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MAX_CAPTURED_OUTPUT_CHARS = 200_000;

export function buildCodexInvocation({
  codexBin = "codex",
  cwd,
  prompt,
  sessionId,
  skipGitRepoCheck = false,
} = {}) {
  if (sessionId) {
    return {
      command: codexBin,
      args: ["exec", "resume", "--json", sessionId, prompt],
    };
  }

  const args = ["exec", "--json", "-C", cwd];
  if (skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }
  args.push(prompt);

  return {
    command: codexBin,
    args,
  };
}

export function parseCodexJsonl(output) {
  const result = {
    threadId: null,
    finalMessage: "",
    summary: "",
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
      result.summary = result.summary || readEventSummary(event);
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
    this.cancelled = new Set();
  }

  listJobs(chatId) {
    return this.state.listJobs(chatId);
  }

  async startJob({ chatId, project, prompt }) {
    const { job, invocation, cwd } = this.prepareStartJob({ chatId, project, prompt });

    return this.runJob({
      job,
      invocation,
      cwd,
    });
  }

  startJobDetached({ chatId, project, prompt, onComplete, onError }) {
    const { job, invocation, cwd } = this.prepareStartJob({ chatId, project, prompt });
    this.runJob({
      job,
      invocation,
      cwd,
    }).then(
      (completedJob) => onComplete?.(completedJob),
      (error) => onError?.(error, job),
    );
    return job;
  }

  prepareStartJob({ chatId, project, prompt }) {
    if (this.running.size >= this.maxConcurrentJobs) {
      throw new Error(`Maximum concurrent Codex jobs reached (${this.maxConcurrentJobs}).`);
    }

    const timestamp = new Date().toISOString();
    const jobId = createJobId();
    const job = {
      jobId,
      chatId: String(chatId),
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      prompt,
      status: "running",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.state.addJob(job);

    return {
      job,
      invocation: buildCodexInvocation({
        codexBin: this.codexBin,
        cwd: project.path,
        prompt,
        skipGitRepoCheck: !isInsideGitWorkTree(project.path),
      }),
      cwd: project.path,
    };
  }

  async resumeJob({ jobId, prompt }) {
    const { job, invocation, cwd } = this.prepareResumeJob({ jobId, prompt });

    return this.runJob({
      job,
      invocation,
      cwd,
    });
  }

  resumeJobDetached({ jobId, prompt, onComplete, onError }) {
    const { job, invocation, cwd } = this.prepareResumeJob({ jobId, prompt });
    this.runJob({
      job,
      invocation,
      cwd,
    }).then(
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
      throw new Error(`Job ${jobId} does not have a Codex thread id yet.`);
    }

    const runningJob = this.state.updateJob(jobId, {
      status: "running",
      prompt,
    });

    return {
      job: runningJob,
      invocation: buildCodexInvocation({
        codexBin: this.codexBin,
        sessionId: job.threadId,
        prompt,
      }),
      cwd: job.projectPath,
    };
  }

  async cancelJob(jobId) {
    const child = this.running.get(jobId);
    if (!child) {
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
    child.kill();
    this.running.delete(jobId);
    this.state.updateJob(jobId, {
      status: "cancelled",
      finalMessage: "Cancelled.",
      completedAt: new Date().toISOString(),
    });
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
        const wasCancelled = this.cancelled.has(job.jobId);
        this.cancelled.delete(job.jobId);
        const parsed = parseCodexJsonl(stdout);
        const status = wasCancelled
          ? "cancelled"
          : exitCode === 0
          ? looksLikeUserInputRequest(parsed.finalMessage) ? "awaiting_reply" : "completed"
          : "failed";
        const finalMessage = wasCancelled
          ? "Cancelled."
          : parsed.finalMessage || stderr.trim() || `Codex exited with code ${exitCode}.`;
        const summary = wasCancelled ? "" : normalizeText(parsed.summary);
        const updated = this.state.updateJob(job.jobId, {
          status,
          threadId: parsed.threadId ?? job.threadId,
          finalMessage,
          summary,
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

export function isInsideGitWorkTree(startPath, { exists = fs.existsSync } = {}) {
  let current = path.resolve(startPath);

  while (true) {
    if (exists(path.join(current, ".git"))) {
      return true;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }
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

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function readEventSummary(event) {
  if (typeof event.summary === "string") {
    return event.summary;
  }
  if (typeof event.summary?.text === "string") {
    return event.summary.text;
  }
  if (typeof event.turn?.summary === "string") {
    return event.turn.summary;
  }
  return "";
}

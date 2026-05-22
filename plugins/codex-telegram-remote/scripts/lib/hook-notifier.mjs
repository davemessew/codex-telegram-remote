import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function shouldSuppressHookNotification({ env = process.env } = {}) {
  return Boolean(env.CODEX_TELEGRAM_REMOTE_JOB_ID);
}

export function buildStopNotification({ payload = {}, finalMessage = "", job = null }) {
  const lines = ["Codex task completed"];
  if (job?.jobId) {
    lines.push(`Job: ${job.jobId}`);
  }
  if (job?.projectName) {
    lines.push(`Project: ${job.projectName}`);
  } else if (payload.cwd) {
    lines.push(`Project: ${payload.cwd}`);
  }
  const message = String(finalMessage ?? "").trim();
  if (message) {
    lines.push("", message);
  }
  return lines.join("\n");
}

export function buildExternalJob({
  payload = {},
  finalMessage = "",
  chatId,
  projects = [],
  now = new Date(),
} = {}) {
  const project = resolvePayloadProject(payload, projects);
  const timestamp = now.toISOString();
  const message = String(finalMessage ?? "").trim();

  return {
    jobId: createHookJobId({ payload, chatId }),
    chatId: String(chatId),
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    prompt: "Regular Codex task",
    source: "hook",
    status: "completed",
    threadId: payload.thread_id ?? payload.threadId ?? payload.session_id ?? payload.sessionId ?? null,
    transcriptPath: payload.transcript_path ?? payload.transcriptPath ?? "",
    finalMessage: message,
    stdoutTail: message,
    stderrTail: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
  };
}

export function readFinalMessageFromTranscript(transcriptPath, { allowedRoots = [] } = {}) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return "";
  }
  if (allowedRoots.length > 0 && !isPathInsideAnyRoot(transcriptPath, allowedRoots)) {
    return "";
  }

  let finalMessage = "";
  for (const line of fs.readFileSync(transcriptPath, "utf8").split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      const text = event.item?.type === "agent_message" ? event.item.text : event.message?.content;
      if (typeof text === "string") {
        finalMessage = text;
      }
    } catch {
      // Ignore non-JSON transcript lines.
    }
  }
  return finalMessage;
}

function isPathInsideAnyRoot(filePath, roots) {
  const resolvedPath = path.resolve(filePath);
  return roots.some((root) => {
    if (!root) {
      return false;
    }
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, resolvedPath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function resolvePayloadProject(payload, projects) {
  const cwd = String(payload.cwd ?? "").trim();
  const matchedProject = projects.find((project) => normalizePathForCompare(project.path) === normalizePathForCompare(cwd));
  if (matchedProject) {
    return matchedProject;
  }

  const fallbackPath = cwd || String(payload.cwd ?? "");
  return {
    id: fallbackPath ? makeHookProjectId(fallbackPath) : "regular-task",
    name: fallbackPath ? path.basename(fallbackPath.replace(/[\\/]$/, "")) || fallbackPath : "Regular task",
    path: fallbackPath,
  };
}

function createHookJobId({ payload, chatId }) {
  const stableParts = [
    chatId,
    payload.transcript_path,
    payload.transcriptPath,
    payload.thread_id,
    payload.threadId,
    payload.session_id,
    payload.sessionId,
    payload.cwd,
  ].filter(Boolean);
  const stableText = stableParts.length > 0 ? stableParts.join("|") : JSON.stringify(payload);
  const digest = crypto.createHash("sha256").update(stableText).digest("base64url").toLowerCase();
  return `hook-${digest.slice(0, 10)}`;
}

function makeHookProjectId(projectPath) {
  const digest = crypto.createHash("sha256").update(String(projectPath).toLowerCase()).digest("base64url").toLowerCase();
  return `project-${digest.slice(0, 8)}`;
}

function normalizePathForCompare(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

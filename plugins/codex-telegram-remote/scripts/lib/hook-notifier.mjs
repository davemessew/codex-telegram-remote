import fs from "node:fs";
import path from "node:path";

export function shouldSuppressHookNotification({ env = process.env } = {}) {
  return Boolean(env.CODEX_TELEGRAM_REMOTE_JOB_ID);
}

export function buildStopNotification({ payload = {}, finalMessage = "" }) {
  const lines = ["Codex task completed"];
  if (payload.cwd) {
    lines.push(`Project: ${payload.cwd}`);
  }
  const message = String(finalMessage ?? "").trim();
  if (message) {
    lines.push("", message);
  }
  return lines.join("\n");
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

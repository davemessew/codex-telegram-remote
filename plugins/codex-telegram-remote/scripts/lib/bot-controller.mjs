import { findProjectById } from "./config.mjs";
import {
  buildProjectKeyboard,
  formatProjectPickerText,
  parseProjectCallback,
} from "./project-picker.mjs";
import { summarizeJobResult } from "./job-summary.mjs";
import {
  chunkTelegramText,
  isAllowedChat,
  normalizeTelegramMessage,
} from "./telegram.mjs";

const UNAUTHORIZED_TEXT = "This Telegram chat is not authorized for Codex Telegram Remote.";
const JOB_CALLBACK_PREFIX = "job:";

export function createBotController({
  config,
  projects,
  state,
  telegram,
  codex,
}) {
  async function handleUpdate(update) {
    const message = normalizeTelegramMessage(update);
    if (!message) {
      return;
    }

    if (!isAllowedChat(message.chatId, config.allowedChatIds)) {
      if (config.replyToUnauthorized === true) {
        await telegram.sendMessage(message.chatId, UNAUTHORIZED_TEXT);
      }
      return;
    }

    if (message.kind === "callback") {
      await handleCallback(message);
      return;
    }

    if (message.text.startsWith("/")) {
      await handleCommand(message);
      return;
    }

    await handlePrompt(message);
  }

  async function handleCallback(message) {
    const jobId = parseJobCallback(message.data);
    if (jobId) {
      await handleJobCallback(message, jobId);
      return;
    }

    const callback = parseProjectCallback(message.data);
    if (!callback) {
      await telegram.answerCallbackQuery(message.id, "Unsupported action.");
      return;
    }

    if (callback.type === "page") {
      await telegram.editMessageText(
        message.chatId,
        message.messageId,
        formatProjectPickerText({
          projects,
          currentProjectId: state.getSelectedProject(message.chatId),
          page: callback.page,
          pageSize: config.projectPageSize,
          query: callback.query,
        }),
        {
          reply_markup: buildProjectKeyboard({
            projects,
            currentProjectId: state.getSelectedProject(message.chatId),
            page: callback.page,
            pageSize: config.projectPageSize,
            query: callback.query,
          }),
        },
      );
      await telegram.answerCallbackQuery(message.id, "Project page updated.");
      return;
    }

    const project = findProjectById(projects, callback.projectId);
    if (!project) {
      await telegram.answerCallbackQuery(message.id, "Project not found.");
      return;
    }

    state.setSelectedProject(message.chatId, project.id);
    state.clearSelectedJob?.(message.chatId);
    await telegram.answerCallbackQuery(message.id, `Selected ${project.name}`);
    await telegram.editMessageText(message.chatId, message.messageId, `Selected project: ${project.name}`);
  }

  async function handleJobCallback(message, jobId) {
    const job = codex.listJobs(message.chatId).find((candidate) => candidate.jobId === jobId);
    if (!job) {
      await telegram.answerCallbackQuery(message.id, "Job not found.");
      return;
    }

    state.setSelectedJob?.(message.chatId, job.jobId);
    await telegram.answerCallbackQuery(message.id, `Selected ${job.jobId}`);
    await telegram.editMessageText(message.chatId, message.messageId, formatSelectedJob(job));
  }

  async function handleCommand(message) {
    const [command, ...rest] = message.text.trim().split(/\s+/);
    const commandName = command.split("@")[0].toLowerCase();
    const args = rest.join(" ");

    switch (commandName) {
      case "/select":
        await sendProjectPicker(message.chatId, args);
        return;
      case "/current":
        await sendCurrentProject(message.chatId);
        return;
      case "/jobs":
        await sendJobs(message.chatId);
        return;
      case "/status":
        await sendStatus(message.chatId, args);
        return;
      case "/cancel":
        await cancelJob(message.chatId, args);
        return;
      case "/tail":
        await sendTail(message.chatId, args);
        return;
      case "/help":
      case "/start":
        await sendHelp(message.chatId);
        return;
      default:
        await telegram.sendMessage(message.chatId, "Unknown command. Use /help for available commands.");
    }
  }

  async function handlePrompt(message) {
    const waitingJobId = message.replyToMessageId
      ? state.getJobForBotMessage(message.chatId, message.replyToMessageId)
      : state.getWaitingJob(message.chatId);
    if (waitingJobId) {
      try {
        const job = await codex.resumeJob({ jobId: waitingJobId, prompt: message.text });
        await sendJobResult(message.chatId, job);
      } catch (error) {
        await telegram.sendMessage(message.chatId, `Codex job failed to resume: ${error.message}`);
      }
      return;
    }

    const selectedProjectId = state.getSelectedProject(message.chatId);
    if (!selectedProjectId) {
      await sendProjectPicker(message.chatId);
      return;
    }

    const project = findProjectById(projects, selectedProjectId);
    if (!project) {
      state.setSelectedProject(message.chatId, "");
      await sendProjectPicker(message.chatId);
      return;
    }

    try {
      const job = await codex.startJob({
        chatId: message.chatId,
        project,
        prompt: message.text,
      });
      await sendJobResult(message.chatId, job);
    } catch (error) {
      await telegram.sendMessage(message.chatId, `Codex job failed to start: ${error.message}`);
    }
  }

  async function sendProjectPicker(chatId, query = "") {
    await telegram.sendMessage(
      chatId,
      formatProjectPickerText({
        projects,
        currentProjectId: state.getSelectedProject(chatId),
        page: 0,
        pageSize: config.projectPageSize,
        query,
      }),
      {
        reply_markup: buildProjectKeyboard({
          projects,
          currentProjectId: state.getSelectedProject(chatId),
          page: 0,
          pageSize: config.projectPageSize,
          query,
        }),
      },
    );
  }

  async function sendCurrentProject(chatId) {
    const project = findProjectById(projects, state.getSelectedProject(chatId));
    await telegram.sendMessage(chatId, project ? `Current project: ${project.name}\n${project.path}` : "No project selected. Use /select.");
  }

  async function sendJobs(chatId) {
    const jobs = codex.listJobs(chatId).slice(0, 10);
    if (jobs.length === 0) {
      await telegram.sendMessage(chatId, "No jobs yet.");
      return;
    }

    await telegram.sendMessage(
      chatId,
      [
        "Recent jobs. Tap one to make /status and /tail use it.",
        "",
        ...jobs.map((job) => formatJobListLine(job, state.getSelectedJob?.(chatId))),
      ].join("\n"),
      {
        reply_markup: buildJobKeyboard({
          jobs,
          selectedJobId: state.getSelectedJob?.(chatId),
        }),
      },
    );
  }

  async function sendStatus(chatId, jobId) {
    const resolved = resolveCommandJob(chatId, jobId);
    if (resolved.error) {
      await telegram.sendMessage(chatId, resolved.error);
      return;
    }
    await telegram.sendMessage(chatId, formatJobStatus(resolved.job));
  }

  async function cancelJob(chatId, jobId) {
    if (!jobId) {
      await telegram.sendMessage(chatId, "Usage: /cancel <jobId>");
      return;
    }
    const ownedJob = codex.listJobs(chatId).find((job) => job.jobId === jobId);
    if (!ownedJob) {
      await telegram.sendMessage(chatId, "No matching job found.");
      return;
    }
    const cancelled = await codex.cancelJob(jobId);
    if (state.getWaitingJob(chatId) === jobId) {
      state.clearWaitingJob(chatId);
    }
    await telegram.sendMessage(chatId, cancelled ? `Cancelled ${jobId}.` : `${jobId} was not running.`);
  }

  async function sendTail(chatId, jobId) {
    const resolved = resolveCommandJob(chatId, jobId);
    if (resolved.error) {
      await telegram.sendMessage(chatId, resolved.error);
      return;
    }
    const job = resolved.job;
    await telegram.sendMessage(chatId, job.finalMessage || job.stderrTail || job.stdoutTail || "No output captured yet.");
  }

  async function sendHelp(chatId) {
    await telegram.sendMessage(
      chatId,
      [
        "Codex Telegram Remote",
        "",
        "/select - choose a project",
        "/current - show the active project",
        "/jobs - list and select recent jobs",
        "/status [jobId] - show selected job or current project status",
        "/cancel <jobId> - cancel a job",
        "/tail [jobId] - show selected job or current project output",
        "",
        "After selecting a project, send a normal message to run Codex in that project.",
      ].join("\n"),
    );
  }

  async function sendJobResult(chatId, job) {
    state.setSelectedJob?.(chatId, job.jobId);

    if (job.status === "awaiting_reply") {
      state.setWaitingJob(chatId, job.jobId);
    } else {
      state.clearWaitingJob(chatId);
    }

    const text = config.sendFullFinalAnswer === false
      ? formatJobStatus(job)
      : formatJobCompletion(job);
    for (const chunk of chunkTelegramText(text, config.telegramChunkSize)) {
      const sent = await telegram.sendMessage(chatId, chunk);
      if (sent?.message_id && job.status === "awaiting_reply") {
        state.mapBotMessage(chatId, sent.message_id, job.jobId);
      }
    }
  }

  return {
    handleUpdate,
  };

  function resolveCommandJob(chatId, jobId) {
    const jobs = codex.listJobs(chatId);
    if (jobId) {
      const job = jobs.find((candidate) => candidate.jobId === jobId);
      return job ? { job } : { error: "No matching job found." };
    }

    const selectedJobId = state.getSelectedJob?.(chatId);
    if (selectedJobId) {
      const selectedJob = jobs.find((candidate) => candidate.jobId === selectedJobId);
      if (selectedJob) {
        return { job: selectedJob };
      }
      state.clearSelectedJob?.(chatId);
    }

    const project = findProjectById(projects, state.getSelectedProject(chatId));
    if (!project) {
      return { error: "No project selected. Use /select." };
    }

    const job = jobs.find((candidate) => jobMatchesProject(candidate, project));
    return job ? { job } : { error: `No jobs found for current project: ${project.name}.` };
  }
}

function formatJobStatus(job) {
  const lines = [
    `Job: ${job.jobId}`,
    `Status: ${job.status}`,
    job.projectName ? `Project: ${job.projectName}` : "",
    job.threadId ? `Thread: ${job.threadId}` : "",
  ].filter(Boolean);
  const summary = readJobSummary(job);
  if (summary && isTerminalJob(job)) {
    lines.push("", "Summary:", summary);
  }
  return lines.join("\n");
}

function formatJobCompletion(job) {
  if (job.status === "awaiting_reply") {
    return job.finalMessage || formatJobStatus(job);
  }

  const finalMessage = String(job.finalMessage ?? "").trim();
  const summary = readJobSummary(job);
  const lines = [
    formatCompletionTitle(job),
    `Job: ${job.jobId}`,
    job.projectName ? `Project: ${job.projectName}` : "",
  ].filter(Boolean);

  if (summary) {
    lines.push("", "Summary:", summary);
  }
  if (finalMessage && finalMessage !== summary) {
    lines.push("", "Final answer:", finalMessage);
  }

  return lines.join("\n");
}

function formatSelectedJob(job) {
  const lines = [
    `Selected job: ${job.jobId}`,
    `Status: ${job.status}`,
    job.projectName ? `Project: ${job.projectName}` : "",
    job.source === "hook" ? "Source: regular completion hook" : "",
  ].filter(Boolean);
  const summary = readJobSummary(job);
  if (summary && isTerminalJob(job)) {
    lines.push("", "Summary:", summary);
  }
  return lines.join("\n");
}

function formatJobListLine(job, selectedJobId) {
  const marker = job.jobId === selectedJobId ? "*" : "-";
  const project = job.projectName ?? job.projectId ?? "unknown project";
  const source = job.source === "hook" ? "hook" : "telegram";
  return `${marker} ${job.jobId}: ${job.status} (${project}, ${source})`;
}

function buildJobKeyboard({ jobs, selectedJobId }) {
  return {
    inline_keyboard: jobs.map((job) => [
      {
        text: truncateButtonText(`${job.jobId === selectedJobId ? "Current: " : ""}${job.status} - ${job.projectName ?? job.jobId}`),
        callback_data: `${JOB_CALLBACK_PREFIX}${job.jobId}`,
      },
    ]),
  };
}

function parseJobCallback(data) {
  if (!String(data ?? "").startsWith(JOB_CALLBACK_PREFIX)) {
    return null;
  }
  return String(data).slice(JOB_CALLBACK_PREFIX.length);
}

function jobMatchesProject(job, project) {
  return job.projectId === project.id || normalizePathForCompare(job.projectPath) === normalizePathForCompare(project.path);
}

function normalizePathForCompare(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function truncateButtonText(value, limit = 56) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}...`;
}

function readJobSummary(job) {
  return String(job.summary ?? "").trim() || summarizeJobResult({ finalMessage: job.finalMessage });
}

function isTerminalJob(job) {
  return ["completed", "failed", "cancelled"].includes(job.status);
}

function formatCompletionTitle(job) {
  if (job.status === "completed") {
    return "Job completed";
  }
  if (job.status === "failed") {
    return "Job failed";
  }
  if (job.status === "cancelled") {
    return "Job cancelled";
  }
  return `Job ${job.status}`;
}

import { findProjectById } from "./config.mjs";
import {
  buildProjectKeyboard,
  formatProjectPickerText,
  parseProjectCallback,
} from "./project-picker.mjs";
import {
  chunkTelegramText,
  isAllowedChat,
  normalizeTelegramMessage,
} from "./telegram.mjs";

const UNAUTHORIZED_TEXT = "This Telegram chat is not authorized for Codex Telegram Remote.";

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
    await telegram.answerCallbackQuery(message.id, `Selected ${project.name}`);
    await telegram.editMessageText(message.chatId, message.messageId, `Selected project: ${project.name}`);
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
      jobs.map((job) => `${job.jobId}: ${job.status} (${job.projectName ?? job.projectId})`).join("\n"),
    );
  }

  async function sendStatus(chatId, jobId) {
    const jobs = codex.listJobs(chatId);
    const job = jobId ? jobs.find((candidate) => candidate.jobId === jobId) : jobs[0];
    await telegram.sendMessage(chatId, job ? formatJobStatus(job) : "No matching job found.");
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
    const jobs = codex.listJobs(chatId);
    const job = jobId ? jobs.find((candidate) => candidate.jobId === jobId) : jobs[0];
    if (!job) {
      await telegram.sendMessage(chatId, "No matching job found.");
      return;
    }
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
        "/jobs - list recent jobs",
        "/status [jobId] - show job status",
        "/cancel <jobId> - cancel a job",
        "/tail [jobId] - show recent output",
        "",
        "After selecting a project, send a normal message to run Codex in that project.",
      ].join("\n"),
    );
  }

  async function sendJobResult(chatId, job) {
    if (job.status === "awaiting_reply") {
      state.setWaitingJob(chatId, job.jobId);
    } else {
      state.clearWaitingJob(chatId);
    }

    const text = config.sendFullFinalAnswer === false
      ? formatJobStatus(job)
      : job.finalMessage || formatJobStatus(job);
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
}

function formatJobStatus(job) {
  return [
    `Job: ${job.jobId}`,
    `Status: ${job.status}`,
    job.projectName ? `Project: ${job.projectName}` : "",
    job.threadId ? `Thread: ${job.threadId}` : "",
  ].filter(Boolean).join("\n");
}

import fs from "node:fs";
import path from "node:path";

export function createMemoryStateStore(initialState) {
  return new StateStore(initialState);
}

export function createFileStateStore(statePath) {
  let initialState;
  if (statePath && fs.existsSync(statePath)) {
    initialState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  }
  const store = new StateStore(initialState);
  store.onChange = () => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    writePrivateJson(statePath, store.snapshot());
  };
  return store;
}

export function writePrivateJson(filePath, payload) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(tmpPath, 0o600);
  } catch {
    // Windows ACLs are handled by setup scripts; POSIX chmod is best-effort here.
  }
  fs.renameSync(tmpPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Keep state writes non-fatal on platforms without POSIX mode support.
  }
}

class StateStore {
  constructor(initialState = {}) {
    this.state = {
      lastUpdateId: null,
      selectedProjects: {},
      waitingJobs: {},
      jobs: {},
      botMessages: {},
      ...initialState,
    };
    this.onChange = null;
  }

  snapshot() {
    return structuredClone(this.state);
  }

  getSelectedProject(chatId) {
    return this.state.selectedProjects[String(chatId)] ?? null;
  }

  setSelectedProject(chatId, projectId) {
    this.state.selectedProjects[String(chatId)] = projectId;
    this.changed();
  }

  getWaitingJob(chatId) {
    return this.state.waitingJobs[String(chatId)] ?? null;
  }

  setWaitingJob(chatId, jobId) {
    this.state.waitingJobs[String(chatId)] = jobId;
    this.changed();
  }

  clearWaitingJob(chatId) {
    delete this.state.waitingJobs[String(chatId)];
    this.changed();
  }

  addJob(job) {
    this.state.jobs[job.jobId] = job;
    this.changed();
  }

  updateJob(jobId, patch) {
    const existing = this.state.jobs[jobId] ?? { jobId };
    this.state.jobs[jobId] = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.changed();
    return this.state.jobs[jobId];
  }

  getJob(jobId) {
    return this.state.jobs[jobId] ?? null;
  }

  listJobs(chatId) {
    return Object.values(this.state.jobs)
      .filter((job) => !chatId || job.chatId === String(chatId))
      .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
  }

  mapBotMessage(chatId, messageId, jobId) {
    this.state.botMessages[botMessageKey(chatId, messageId)] = jobId;
    this.changed();
  }

  getJobForBotMessage(chatId, messageId) {
    return this.state.botMessages[botMessageKey(chatId, messageId)] ?? null;
  }

  getLastUpdateId() {
    return this.state.lastUpdateId ?? null;
  }

  setLastUpdateId(updateId) {
    this.state.lastUpdateId = updateId;
    this.changed();
  }

  changed() {
    if (this.onChange) {
      this.onChange();
    }
  }
}

function botMessageKey(chatId, messageId) {
  return `${String(chatId)}:${String(messageId)}`;
}

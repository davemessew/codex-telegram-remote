import fs from "node:fs";
import path from "node:path";

export function createMemoryStateStore(initialState) {
  return new StateStore(initialState);
}

export function createFileStateStore(statePath) {
  const initialState = readStateFile(statePath);
  const store = new StateStore(initialState);
  store.beforeRead = () => {
    const latestState = readStateFile(statePath);
    if (latestState) {
      store.replaceState(mergeStateSnapshots(latestState, store.snapshot()));
    }
  };
  store.onChange = () => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const nextState = mergeStateSnapshots(readStateFile(statePath), store.snapshot());
    store.replaceState(nextState);
    writePrivateJson(statePath, nextState);
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
    this.state = normalizeStateSnapshot(initialState);
    this.onChange = null;
    this.beforeRead = null;
  }

  replaceState(nextState) {
    this.state = normalizeStateSnapshot(nextState);
  }

  refresh() {
    if (this.beforeRead) {
      this.beforeRead();
    }
  }

  snapshot() {
    return structuredClone(this.state);
  }

  getSelectedProject(chatId) {
    this.refresh();
    return this.state.selectedProjects[String(chatId)] ?? null;
  }

  setSelectedProject(chatId, projectId) {
    this.state.selectedProjects[String(chatId)] = projectId;
    this.changed();
  }

  getSelectedJob(chatId) {
    this.refresh();
    return this.state.selectedJobs[String(chatId)] ?? null;
  }

  setSelectedJob(chatId, jobId) {
    this.state.selectedJobs[String(chatId)] = jobId;
    this.changed();
  }

  clearSelectedJob(chatId) {
    delete this.state.selectedJobs[String(chatId)];
    this.changed();
  }

  getWaitingJob(chatId) {
    this.refresh();
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
    this.refresh();
    return this.state.jobs[jobId] ?? null;
  }

  listJobs(chatId) {
    this.refresh();
    return Object.values(this.state.jobs)
      .filter((job) => !chatId || job.chatId === String(chatId))
      .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
  }

  mapBotMessage(chatId, messageId, jobId) {
    this.state.botMessages[botMessageKey(chatId, messageId)] = jobId;
    this.changed();
  }

  getJobForBotMessage(chatId, messageId) {
    this.refresh();
    return this.state.botMessages[botMessageKey(chatId, messageId)] ?? null;
  }

  getLastUpdateId() {
    this.refresh();
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

function normalizeStateSnapshot(initialState = {}) {
  const source = initialState && typeof initialState === "object" ? initialState : {};
  return {
    lastUpdateId: null,
    selectedProjects: {},
    selectedJobs: {},
    waitingJobs: {},
    jobs: {},
    botMessages: {},
    ...source,
    selectedProjects: source.selectedProjects ?? {},
    selectedJobs: source.selectedJobs ?? {},
    waitingJobs: source.waitingJobs ?? {},
    jobs: source.jobs ?? {},
    botMessages: source.botMessages ?? {},
  };
}

function botMessageKey(chatId, messageId) {
  return `${String(chatId)}:${String(messageId)}`;
}

function readStateFile(statePath) {
  if (!statePath || !fs.existsSync(statePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

function mergeStateSnapshots(latestState = {}, currentState = {}) {
  const latest = normalizeStateSnapshot(latestState ?? {});
  const current = normalizeStateSnapshot(currentState ?? {});
  return {
    ...latest,
    ...current,
    lastUpdateId: maxLastUpdateId(latest.lastUpdateId, current.lastUpdateId),
    selectedProjects: current.selectedProjects,
    selectedJobs: current.selectedJobs,
    waitingJobs: current.waitingJobs,
    jobs: { ...latest.jobs, ...current.jobs },
    botMessages: { ...latest.botMessages, ...current.botMessages },
  };
}

function maxLastUpdateId(left, right) {
  if (Number.isInteger(left) && Number.isInteger(right)) {
    return Math.max(left, right);
  }
  return right ?? left ?? null;
}

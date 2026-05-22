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

  getSelectedThread(chatId, projectId) {
    this.refresh();
    return this.state.selectedThreads[threadSelectionKey(chatId, projectId)] ?? null;
  }

  setSelectedThread(chatId, projectId, threadId) {
    this.state.selectedThreads[threadSelectionKey(chatId, projectId)] = String(threadId);
    this.changed();
  }

  clearSelectedThread(chatId, projectId) {
    delete this.state.selectedThreads[threadSelectionKey(chatId, projectId)];
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

  getCompletionMonitorStartedAt() {
    this.refresh();
    return this.state.completionMonitor.startedAt ?? null;
  }

  initializeCompletionMonitor({ startedAt, fileOffsets = {} } = {}) {
    this.state.completionMonitor.startedAt = startedAt ?? new Date().toISOString();
    this.state.completionMonitor.fileOffsets = {
      ...this.state.completionMonitor.fileOffsets,
      ...fileOffsets,
    };
    this.changed();
  }

  getCompletionMonitorFileOffset(filePath) {
    this.refresh();
    return this.state.completionMonitor.fileOffsets[String(filePath)] ?? null;
  }

  setCompletionMonitorFileOffset(filePath, offset) {
    this.state.completionMonitor.fileOffsets[String(filePath)] = Number(offset);
    this.changed();
  }

  hasCompletionNotification(notificationId) {
    this.refresh();
    return Boolean(this.state.completionMonitor.notified[String(notificationId)]);
  }

  markCompletionNotification(notificationId, notifiedAt = new Date().toISOString()) {
    this.state.completionMonitor.notified[String(notificationId)] = notifiedAt;
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
    selectedThreads: {},
    waitingJobs: {},
    jobs: {},
    botMessages: {},
    completionMonitor: {
      startedAt: null,
      fileOffsets: {},
      notified: {},
    },
    ...source,
    selectedProjects: source.selectedProjects ?? {},
    selectedJobs: source.selectedJobs ?? {},
    selectedThreads: source.selectedThreads ?? {},
    waitingJobs: source.waitingJobs ?? {},
    jobs: source.jobs ?? {},
    botMessages: source.botMessages ?? {},
    completionMonitor: normalizeCompletionMonitor(source.completionMonitor),
  };
}

function botMessageKey(chatId, messageId) {
  return `${String(chatId)}:${String(messageId)}`;
}

function threadSelectionKey(chatId, projectId) {
  return `${String(chatId)}:${String(projectId)}`;
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
    selectedThreads: current.selectedThreads,
    waitingJobs: current.waitingJobs,
    jobs: mergeJobSnapshots(latest.jobs, current.jobs),
    botMessages: { ...latest.botMessages, ...current.botMessages },
    completionMonitor: mergeCompletionMonitorSnapshots(latest.completionMonitor, current.completionMonitor),
  };
}

function maxLastUpdateId(left, right) {
  if (Number.isInteger(left) && Number.isInteger(right)) {
    return Math.max(left, right);
  }
  return right ?? left ?? null;
}

function normalizeCompletionMonitor(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    startedAt: typeof source.startedAt === "string" ? source.startedAt : null,
    fileOffsets: source.fileOffsets && typeof source.fileOffsets === "object" && !Array.isArray(source.fileOffsets)
      ? source.fileOffsets
      : {},
    notified: source.notified && typeof source.notified === "object" && !Array.isArray(source.notified)
      ? source.notified
      : {},
  };
}

function mergeCompletionMonitorSnapshots(latestMonitor = {}, currentMonitor = {}) {
  const latest = normalizeCompletionMonitor(latestMonitor);
  const current = normalizeCompletionMonitor(currentMonitor);
  return {
    startedAt: current.startedAt ?? latest.startedAt,
    fileOffsets: { ...latest.fileOffsets, ...current.fileOffsets },
    notified: { ...latest.notified, ...current.notified },
  };
}

function mergeJobSnapshots(latestJobs = {}, currentJobs = {}) {
  const merged = { ...latestJobs };
  for (const [jobId, currentJob] of Object.entries(currentJobs)) {
    const latestJob = merged[jobId];
    merged[jobId] = isNewerJob(latestJob, currentJob) ? currentJob : latestJob;
  }
  return merged;
}

function isNewerJob(existingJob, candidateJob) {
  if (!existingJob) {
    return true;
  }
  const existingUpdatedAt = Date.parse(existingJob.updatedAt ?? "");
  const candidateUpdatedAt = Date.parse(candidateJob.updatedAt ?? "");
  if (Number.isFinite(existingUpdatedAt) && Number.isFinite(candidateUpdatedAt)) {
    return candidateUpdatedAt >= existingUpdatedAt;
  }
  if (Number.isFinite(candidateUpdatedAt)) {
    return true;
  }
  if (Number.isFinite(existingUpdatedAt)) {
    return false;
  }
  return true;
}

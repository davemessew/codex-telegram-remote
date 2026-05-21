import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CONFIG_BASENAME = "config.json";
export const DEFAULT_STATE_BASENAME = "state.json";

export function defaultConfigDir(homeDir = os.homedir()) {
  return path.join(homeDir, ".codex-telegram-remote");
}

export function defaultConfigPath(homeDir = os.homedir()) {
  return path.join(defaultConfigDir(homeDir), DEFAULT_CONFIG_BASENAME);
}

export function resolveConfigPath({ env = process.env, homeDir = os.homedir() } = {}) {
  if (env.CODEX_TELEGRAM_CONFIG) {
    return env.CODEX_TELEGRAM_CONFIG;
  }
  if (env.CODEX_TELEGRAM_CONFIG_DIR) {
    return path.join(env.CODEX_TELEGRAM_CONFIG_DIR, DEFAULT_CONFIG_BASENAME);
  }
  return defaultConfigPath(homeDir);
}

export function normalizeConfig(raw = {}, options = {}) {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const configDir = raw.configDir ?? env.CODEX_TELEGRAM_CONFIG_DIR ?? defaultConfigDir(homeDir);
  const envAllowedChatIds = splitCsv(env.CODEX_TELEGRAM_ALLOWED_CHAT_IDS);
  const rawAllowedChatIds = Array.isArray(raw.allowedChatIds) ? raw.allowedChatIds : [];
  const allowedChatIds = (envAllowedChatIds.length > 0 ? envAllowedChatIds : rawAllowedChatIds)
    .map((id) => String(id).trim())
    .filter(Boolean);

  return {
    botToken: env.CODEX_TELEGRAM_BOT_TOKEN ?? raw.botToken ?? "",
    allowedChatIds,
    completionChatIds: normalizeCompletionChatIds(raw.completionChatIds, allowedChatIds),
    defaultProject: env.CODEX_TELEGRAM_DEFAULT_PROJECT ?? raw.defaultProject ?? "",
    projectAliases: normalizeAliasMap(raw.projectAliases),
    codexBin: env.CODEX_CLI_PATH ?? env.CODEX_BIN ?? raw.codexBin ?? "",
    codexHome: env.CODEX_HOME ?? raw.codexHome ?? path.join(homeDir, ".codex"),
    configDir,
    statePath: raw.statePath ?? path.join(configDir, DEFAULT_STATE_BASENAME),
    maxConcurrentJobs: normalizePositiveInteger(raw.maxConcurrentJobs, 1),
    telegramChunkSize: normalizePositiveInteger(raw.telegramChunkSize, 3900),
    sendFullFinalAnswer: raw.sendFullFinalAnswer !== false,
    replyToUnauthorized: raw.replyToUnauthorized === true,
    pollTimeoutSeconds: normalizePositiveInteger(raw.pollTimeoutSeconds, 50),
    projectPageSize: normalizePositiveInteger(raw.projectPageSize, 8),
  };
}

export function loadConfig(configPath = resolveConfigPath()) {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return normalizeConfig(raw);
}

export function loadCodexProjectPaths(codexHome = path.join(os.homedir(), ".codex")) {
  const configPath = path.join(codexHome, "config.toml");
  if (!fs.existsSync(configPath)) {
    return [];
  }

  return parseCodexProjects(fs.readFileSync(configPath, "utf8"));
}

export function parseCodexProjects(tomlText) {
  const paths = [];
  const matcher = /^\s*\[projects\.(?:"((?:\\.|[^"])*)"|'([^']*)')\]\s*$/gm;
  let match;

  while ((match = matcher.exec(tomlText)) !== null) {
    if (match[1] !== undefined) {
      paths.push(decodeTomlBasicString(match[1]));
    } else {
      paths.push(match[2]);
    }
  }

  return paths;
}

export function resolveConfiguredProjects({ config, codexProjectPaths = [] }) {
  const seen = new Set();
  const projects = [];

  for (const [alias, projectPath] of Object.entries(config.projectAliases ?? {})) {
    const normalizedPath = normalizePathForCompare(projectPath);
    seen.add(normalizedPath);
    projects.push({
      id: sanitizeProjectId(alias),
      name: alias,
      path: projectPath,
      source: "alias",
      isDefault: config.defaultProject === alias || normalizePathForCompare(config.defaultProject) === normalizedPath,
    });
  }

  for (const projectPath of codexProjectPaths) {
    const normalizedPath = normalizePathForCompare(projectPath);
    if (seen.has(normalizedPath)) {
      continue;
    }
    seen.add(normalizedPath);
    projects.push({
      id: makeProjectId(projectPath),
      name: path.basename(projectPath.replace(/[\\/]$/, "")) || projectPath,
      path: projectPath,
      source: "codex",
      isDefault: normalizePathForCompare(config.defaultProject) === normalizedPath,
    });
  }

  return projects.sort((left, right) => {
    if (left.isDefault !== right.isDefault) {
      return left.isDefault ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

export function findProjectById(projects, projectId) {
  return projects.find((project) => project.id === projectId) ?? null;
}

export function makeProjectId(projectPath) {
  const digest = crypto.createHash("sha256").update(projectPath.toLowerCase()).digest("base64url");
  return `project-${digest.slice(0, 8).toLowerCase()}`;
}

function normalizeAliasMap(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input)
      .filter(([key, value]) => key && typeof value === "string" && value.trim())
      .map(([key, value]) => [key.trim(), value.trim()]),
  );
}

function normalizeCompletionChatIds(completionChatIds, fallbackChatIds) {
  const source = Array.isArray(completionChatIds) && completionChatIds.length > 0
    ? completionChatIds
    : fallbackChatIds;
  return source.map((id) => String(id).trim()).filter(Boolean);
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function splitCsv(value) {
  if (!value) {
    return [];
  }
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function decodeTomlBasicString(value) {
  return value
    .replace(/\\\\/g, "\\")
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function normalizePathForCompare(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function sanitizeProjectId(value) {
  const sanitized = String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!sanitized) {
    return makeProjectId(value);
  }
  if (sanitized.length <= 48) {
    return sanitized;
  }
  const digest = crypto.createHash("sha256").update(sanitized).digest("base64url").slice(0, 8).toLowerCase();
  return `${sanitized.slice(0, 39).replace(/-+$/g, "")}-${digest}`;
}

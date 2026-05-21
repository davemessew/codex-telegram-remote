import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveConfigPath,
  normalizeConfig,
  parseCodexProjects,
  resolveConfiguredProjects,
} from "../plugins/codex-telegram-remote/scripts/lib/config.mjs";

test("normalizeConfig keeps chat allowlist strict and resolves defaults", () => {
  const config = normalizeConfig(
    {
      botToken: "123:token",
      allowedChatIds: [12345, "67890"],
      defaultProject: "site",
      projectAliases: {
        site: "C:/work/site",
      },
    },
    {
      env: {
        CODEX_TELEGRAM_BOT_TOKEN: "env-token",
      },
      homeDir: "C:/Users/example",
    },
  );

  assert.equal(config.botToken, "env-token");
  assert.deepEqual(config.allowedChatIds, ["12345", "67890"]);
  assert.equal(config.defaultProject, "site");
  assert.equal(config.projectAliases.site, "C:/work/site");
  assert.equal(config.maxConcurrentJobs, 1);
  assert.equal(config.telegramChunkSize, 3900);
  assert.equal(config.replyToUnauthorized, false);
});

test("normalizeConfig uses env chat IDs for completion notifications by default", () => {
  const config = normalizeConfig(
    {
      botToken: "123:token",
    },
    {
      env: {
        CODEX_TELEGRAM_ALLOWED_CHAT_IDS: "111,222",
      },
    },
  );

  assert.deepEqual(config.allowedChatIds, ["111", "222"]);
  assert.deepEqual(config.completionChatIds, ["111", "222"]);
});

test("resolveConfigPath respects CODEX_TELEGRAM_CONFIG_DIR", () => {
  assert.equal(
    resolveConfigPath({
      env: { CODEX_TELEGRAM_CONFIG_DIR: "C:/config" },
      homeDir: "C:/Users/example",
    }),
    "C:\\config\\config.json",
  );
});

test("parseCodexProjects reads quoted Windows project paths from Codex TOML", () => {
  const projects = parseCodexProjects(`
[projects."C:\\\\work\\\\SampleApp"]
trust_level = "trusted"

[projects.'c:\\work\\telegram']
trust_level = "trusted"
`);

  assert.deepEqual(projects, [
    "C:\\work\\SampleApp",
    "c:\\work\\telegram",
  ]);
});

test("resolveConfiguredProjects merges aliases with Codex projects and marks the default", () => {
  const projects = resolveConfiguredProjects({
    config: normalizeConfig({
      botToken: "token",
      allowedChatIds: ["1"],
      defaultProject: "telegram",
      projectAliases: {
        telegram: "C:/work/Telegram",
      },
    }),
    codexProjectPaths: [
      "C:/work/Telegram",
      "C:/work/Other",
    ],
  });

  assert.deepEqual(projects[0], {
    id: "telegram",
    name: "telegram",
    path: "C:/work/Telegram",
    source: "alias",
    isDefault: true,
  });
  assert.match(projects[1].id, /^project-[a-z0-9_-]{8}$/);
  assert.equal(projects[1].name, "Other");
  assert.equal(projects[1].path, "C:/work/Other");
  assert.equal(projects[1].isDefault, false);
});

test("resolveConfiguredProjects keeps Telegram callback ids short for long aliases", () => {
  const [project] = resolveConfiguredProjects({
    config: normalizeConfig({
      botToken: "token",
      allowedChatIds: ["1"],
      projectAliases: {
        "this-is-a-very-long-project-alias-that-would-overflow-telegram-callback-data": "C:/Repo",
      },
    }),
    codexProjectPaths: [],
  });

  assert.ok(`select:${project.id}`.length <= 64);
});

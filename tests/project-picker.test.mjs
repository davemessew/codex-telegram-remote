import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildProjectKeyboard,
  formatProjectPickerText,
  parseProjectCallback,
} from "../plugins/codex-telegram-remote/scripts/lib/project-picker.mjs";

const projects = Array.from({ length: 10 }, (_, index) => ({
  id: `project-${index + 1}`,
  name: `Project ${index + 1}`,
  path: `C:/Projects/${index + 1}`,
}));

test("buildProjectKeyboard renders paginated tappable project buttons", () => {
  const keyboard = buildProjectKeyboard({
    projects,
    currentProjectId: "project-2",
    page: 0,
    pageSize: 4,
  });

  assert.deepEqual(keyboard.inline_keyboard.slice(0, 4), [
    [{ text: "Project 1", callback_data: "select:project-1" }],
    [{ text: "Current: Project 2", callback_data: "select:project-2" }],
    [{ text: "Project 3", callback_data: "select:project-3" }],
    [{ text: "Project 4", callback_data: "select:project-4" }],
  ]);
  assert.deepEqual(keyboard.inline_keyboard.at(-1), [
    { text: "Next", callback_data: "page:1:" },
  ]);
});

test("buildProjectKeyboard filters project buttons by search text", () => {
  const keyboard = buildProjectKeyboard({
    projects,
    query: "10",
    pageSize: 4,
  });

  assert.deepEqual(keyboard.inline_keyboard, [
    [{ text: "Project 10", callback_data: "select:project-10" }],
  ]);
});

test("parseProjectCallback accepts select and page callbacks only", () => {
  assert.deepEqual(parseProjectCallback("select:project-3"), {
    type: "select",
    projectId: "project-3",
  });
  assert.deepEqual(parseProjectCallback("page:2:api"), {
    type: "page",
    page: 2,
    query: "api",
  });
  assert.equal(parseProjectCallback("other"), null);
});

test("formatProjectPickerText names the selected project when present", () => {
  assert.equal(
    formatProjectPickerText({
      projects,
      currentProjectId: "project-2",
      page: 0,
      pageSize: 4,
    }),
    "Select a project. Current project: Project 2. Page 1 of 3.",
  );
});

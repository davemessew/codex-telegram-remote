import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Windows setup uses a ScheduledTask RunLevel accepted by Windows", () => {
  const script = fs.readFileSync("plugins/codex-telegram-remote/scripts/setup-windows.ps1", "utf8");

  assert.match(script, /-RunLevel\s+Limited\b/);
  assert.doesNotMatch(script, /-RunLevel\s+LeastPrivilege\b/);
});

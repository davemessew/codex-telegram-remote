import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCodexInvocation,
  discoverCodexBinaryFromCandidates,
  looksLikeUserInputRequest,
  parseCodexJsonl,
} from "../plugins/codex-telegram-remote/scripts/lib/codex-runner.mjs";

test("buildCodexInvocation starts Codex in the selected project", () => {
  assert.deepEqual(
    buildCodexInvocation({
      codexBin: "codex",
      cwd: "C:/Repo",
      prompt: "fix tests",
    }),
    {
      command: "codex",
      args: ["exec", "--json", "-C", "C:/Repo", "fix tests"],
    },
  );
});

test("buildCodexInvocation resumes an existing Codex thread", () => {
  assert.deepEqual(
    buildCodexInvocation({
      codexBin: "codex",
      sessionId: "019e4c1a-fafe",
      prompt: "yes",
    }),
    {
      command: "codex",
      args: ["exec", "resume", "--json", "019e4c1a-fafe", "yes"],
    },
  );
});

test("parseCodexJsonl captures thread id, final message, and usage", () => {
  const result = parseCodexJsonl(`
{"type":"thread.started","thread_id":"thread-1"}
{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}
{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":2}}
`);

  assert.deepEqual(result, {
    threadId: "thread-1",
    finalMessage: "Done",
    usage: { input_tokens: 1, output_tokens: 2 },
    errors: [],
  });
});

test("looksLikeUserInputRequest detects direct questions", () => {
  assert.equal(looksLikeUserInputRequest("Which option should I use?"), true);
  assert.equal(looksLikeUserInputRequest("Done."), false);
});

test("discoverCodexBinaryFromCandidates prefers an existing app-local binary over PATH shim", () => {
  assert.equal(
    discoverCodexBinaryFromCandidates({
      candidates: ["codex", "C:/Users/example/AppData/Local/OpenAI/Codex/bin/hash/codex.exe"],
      exists: (candidate) => candidate.endsWith("codex.exe"),
    }),
    "C:/Users/example/AppData/Local/OpenAI/Codex/bin/hash/codex.exe",
  );
});

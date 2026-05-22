import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractSummarySection,
  summarizeJobResult,
} from "../plugins/codex-telegram-remote/scripts/lib/job-summary.mjs";

test("summarizeJobResult prefers explicit summaries", () => {
  assert.equal(
    summarizeJobResult({
      explicitSummary: "Tests passed and docs updated.",
      finalMessage: "Different final answer.",
    }),
    "Tests passed and docs updated.",
  );
});

test("extractSummarySection reads markdown summary sections", () => {
  assert.equal(
    extractSummarySection([
      "## Summary",
      "- Added job selection.",
      "- Sent summaries on completion.",
      "",
      "Tests:",
      "- npm test",
    ].join("\n")),
    "- Added job selection.\n- Sent summaries on completion.",
  );
});

test("summarizeJobResult falls back to the first paragraph", () => {
  assert.equal(
    summarizeJobResult({
      finalMessage: "Implemented the requested change.\n\nTests pass.",
    }),
    "Implemented the requested change.",
  );
});

test("summarizeJobResult truncates long summaries", () => {
  const summary = summarizeJobResult({
    explicitSummary: "x ".repeat(100),
    limit: 20,
  });

  assert.equal(summary, "x x x x x x x x x...");
});

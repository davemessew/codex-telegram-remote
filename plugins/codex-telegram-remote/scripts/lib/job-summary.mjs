const DEFAULT_SUMMARY_LIMIT = 900;

export function summarizeJobResult({
  finalMessage = "",
  explicitSummary = "",
  limit = DEFAULT_SUMMARY_LIMIT,
} = {}) {
  const summary = normalizeSummary(explicitSummary)
    || extractSummarySection(finalMessage)
    || fallbackSummary(finalMessage);
  return truncateSummary(summary, limit);
}

export function extractSummarySection(text) {
  const lines = String(text ?? "").replace(/\r\n/g, "\n").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inlineSummary = matchInlineSummary(line);
    if (inlineSummary) {
      return normalizeSummary(inlineSummary);
    }
    if (!isSummaryHeading(line)) {
      continue;
    }

    const body = [];
    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
      const bodyLine = lines[bodyIndex];
      if (body.length > 0 && isLikelyNextSection(bodyLine)) {
        break;
      }
      body.push(bodyLine);
    }
    const summary = normalizeSummary(body.join("\n"));
    if (summary) {
      return summary;
    }
  }

  return "";
}

function fallbackSummary(text) {
  const normalized = normalizeSummary(text);
  if (!normalized) {
    return "";
  }
  const paragraphs = normalized.split(/\n\s*\n/).filter(Boolean);
  return paragraphs[0] ?? normalized;
}

function normalizeSummary(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function truncateSummary(value, limit) {
  const summary = normalizeSummary(value);
  if (summary.length <= limit) {
    return summary;
  }

  const truncated = summary.slice(0, limit - 1);
  const splitAt = Math.max(
    truncated.lastIndexOf("\n"),
    truncated.lastIndexOf(" "),
  );
  return `${truncated.slice(0, splitAt > 0 ? splitAt : limit - 1).trimEnd()}...`;
}

function isSummaryHeading(line) {
  return /^\s*(?:#{1,6}\s*)?(?:\*\*)?summary(?:\*\*)?\s*:?\s*$/i.test(String(line ?? ""));
}

function matchInlineSummary(line) {
  const match = /^\s*(?:#{1,6}\s*)?(?:\*\*)?summary(?:\*\*)?\s*:\s*(.+?)\s*$/.exec(String(line ?? ""));
  return match?.[1] ?? "";
}

function isLikelyNextSection(line) {
  const value = String(line ?? "").trim();
  if (!value) {
    return false;
  }
  return /^#{1,6}\s+\S/.test(value)
    || /^\*\*[A-Z][^*]{1,80}\*\*:?\s*$/.test(value)
    || /^[A-Z][A-Za-z0-9 /_-]{1,80}:\s*$/.test(value);
}

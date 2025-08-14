// mcp_chunked_eval.mjs
// Chunked wrapper around the MCP tool "browser_evaluate" to avoid token overflows.
// Assumptions:
// - You already have an mcpClient with a `tools.call(name, args)` method.
// - The MCP server includes the Playwright "browser_evaluate" tool.
//
// Strategy:
//   We evaluate a function in the page that builds a LARGE string `s` (e.g., document.body.innerText),
//   but we only RETURN a small slice s.slice(start, end) per call — keeping the tool response tiny.

const DEFAULT_MAX_CHARS_PER_CHUNK = 8000;   // ~2k tokens
const DEFAULT_MAX_CHUNKS = 20;              // safety cap
const DEFAULT_TOTAL_CHAR_BUDGET = 80000;    // ~20k tokens across all chunks

function normalizeText(s) {
  return (s || "")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractCarListingLines(text) {
  // Heuristic filter to keep only lines that look like listing data
  const lines = (text || "").split("\n").map(l => l.trim()).filter(Boolean);
  const kept = [];
  for (const l of lines) {
    const looksLikePrice    = /\$\s?\d{1,3}(?:[,\d]{3})+/.test(l);
    const looksLikeYear     = /(?:19|20)\d{2}\b/.test(l);
    const looksLikeMileage  = /\b\d{1,3}(?:[,\d]{3})\s*(?:mi|miles)\b/i.test(l);
    const looksLikeTrim     = /\b(AWD|FWD|RWD|4WD|SE|LE|LX|EX|Sport|Touring|Premium|XLT|LT|SLT|Limited)\b/i.test(l);
    const looksLikeVin      = /\b[A-HJ-NPR-Z0-9]{17}\b/.test(l);
    if (looksLikePrice || looksLikeYear || looksLikeMileage || looksLikeTrim || looksLikeVin) {
      kept.push(l);
    }
  }
  return kept.join("\n");
}

export async function evaluateTextChunks(
  mcpClient,
  {
    url,
    getTextJS = "document.body?.innerText ?? ''",
    maxCharsPerChunk = DEFAULT_MAX_CHARS_PER_CHUNK,
    maxChunks = DEFAULT_MAX_CHUNKS,
    totalCharBudget = DEFAULT_TOTAL_CHAR_BUDGET,
    applyFilter = true,
  }
) {
  if (!mcpClient) throw new Error("mcpClient is required");
  if (!url) throw new Error("url is required");

  const chunks = [];
  let start = 0;
  let usedBudget = 0;

  for (let i = 0; i < maxChunks; i++) {
    const end = start + maxCharsPerChunk;

   // Build a tiny return payload in the page: only slice is returned
    const code = `
      (() => {
        try {
          const s = (() => ${getTextJS})();
          if (!s || typeof s !== 'string') return JSON.stringify({ ok: true, slice: '', totalLen: 0 });
          const totalLen = s.length;
          const slice = s.slice(${start}, ${end});
          return JSON.stringify({ ok: true, slice, totalLen });
        } catch (e) {
          return JSON.stringify({ ok: false, error: String(e) });
        }
      })()
    `;

    const resp = await mcpClient.tools.call("browser_evaluate", {
      url,
      code,
    });

    // Some MCP clients return { content: "..."} or just string; normalize:
    const raw = typeof resp === "string" ? resp : (resp?.content ?? resp?.text ?? resp?.result ?? "");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If for some reason the tool double-wrapped JSON, try once more
      parsed = typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : { ok: false, error: "Bad JSON from tool" };
    }
    if (!parsed?.ok) {
      throw new Error(`browser_evaluate error: ${parsed?.error || "unknown"}`);
    }

    let slice = normalizeText(parsed.slice || "");
    if (applyFilter) {
      const filtered = extractCarListingLines(slice);
      // if the filter removes everything, keep original slice to avoid losing context
      if (filtered && filtered.length > 80) slice = filtered;
    }

    // Enforce overall budget
    if (totalCharBudget && usedBudget + slice.length > totalCharBudget) {
      const remaining = totalCharBudget - usedBudget;
      if (remaining > 0) {
        chunks.push(slice.slice(0, remaining));
      }
      break;
    } else {
      if (slice.length) chunks.push(slice);
    }

    usedBudget += slice.length;

    // Stop if we reached the end
    const totalLen = parsed.totalLen || 0;
    if (end >= totalLen || slice.length === 0) break;
    start += maxCharsPerChunk;
  }

  return {
    url,
   createdAt: new Date().toISOString(),
    chunkBytesApprox: maxCharsPerChunk,
    totalChunks: chunks.length,
    chunks: chunks.map((text, index) => ({ index, text })),
  };
}
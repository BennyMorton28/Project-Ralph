// car_extract_chunks.mjs
// Chunk-safe extractor for car listings.
// Output: cars.ndjson (one JSON object per line) and cars.json (array)

import fs from "fs";
import path from "path";
import process from "process";
import { fileURLToPath } from "url";
import { evaluateTextChunks } from "./mcp_chunked_eval.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------- Anthropic minimal client via fetch ----------------
async function anthropicExtract({ system, user, maxTokens = 600 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set. Use --no-llm to run without LLM.");
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-7-sonnet-2025-05-01",
      temperature: 0,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${text}`);
  }
  const json = await resp.json();
  const content = json?.content?.[0]?.text ?? "";
  return content;
}

// ---------------- Deterministic regex fallback ----------------
function regexExtract(chunkText) {
  // Very lightweight, line-oriented heuristic parsing.
  // Attempts to pull {year, make, model, trim?, price, mileage?, vin?, link?}
  const lines = chunkText.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [];
  const priceRe = /\$\s?(\d{1,3}(?:[,\d]{3})+)/;
  const yearRe = /\b(19|20)\d{2}\b/;
  const mileageRe = /\b(\d{1,3}(?:[,\d]{3}))\s*(?:mi|miles)\b/i;
  const vinRe = /\b([A-HJ-NPR-Z0-9]{17})\b/;
  const linkRe = /(https?:\/\/[^\s)]+)$/i;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const priceM = l.match(priceRe);
    const yearM = l.match(yearRe);
    if (!priceM && !yearM) continue;

    // Try to assemble context from nearby lines.
    const window = [lines[i - 2], lines[i - 1], l, lines[i + 1], lines[i + 2]].filter(Boolean).join(" | ");
    const price = priceM ? Number(priceM[1].replace(/,/g, "")) : undefined;
    const year = yearM ? Number(yearM[0]) : undefined;
    const mileageM = window.match(mileageRe);
    const vinM = window.match(vinRe);
    const linkM = window.match(linkRe);

    // Crude make/model/trim split: take the phrase around the year
    let make = undefined, model = undefined, trim = undefined;
    const around = window.split("|").map(s => s.trim()).find(s => yearRe.test(s)) || window;
    const tokens = around.replace(/[\$|,]/g, " ").split(/\s+/).filter(Boolean);
    const yearIdx = tokens.findIndex(t => yearRe.test(t));
    if (yearIdx >= 0 && yearIdx < tokens.length - 1) {
      make = tokens[yearIdx + 1];
      model = tokens[yearIdx + 2] || undefined;
      const trimCandidates = tokens.slice(yearIdx + 3, yearIdx + 7).join(" ");
      if (/\b(AWD|FWD|RWD|4WD|SE|LE|LX|EX|Sport|Touring|Premium|XLT|LT|SLT|Limited|Platinum|Base|S|SV|SR|XSE|XLE)\b/i.test(trimCandidates)) {
        trim = trimCandidates;
      }
    }

    out.push({
      year, make, model, trim,
      price,
      mileage: mileageM ? Number(mileageM[1].replace(/,/g, "")) : undefined,
      vin: vinM ? vinM[1] : undefined,
      link: linkM ? linkM[1] : undefined,
      title: undefined,
      location: undefined,
      source: "regex",
    });
  }
  return out;
}

// ---------------- Helpers ----------------
function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key =
      (it.vin && `VIN:${it.vin}`) ||
      `K:${it.year || ""}-${(it.make || "").toLowerCase()}-${(it.model || "").toLowerCase()}-${it.price || ""}-${it.mileage || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function parseMaybeJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ---------------- LLM prompt (tight, token-safe) ----------------
const SYSTEM_PROMPT = `
You extract car listings from noisy text. Return ONLY JSON (no prose).
Produce an array of up to 30 items with this schema:
[{"price":12345,"year":2020,"make":"Toyota","model":"Camry","trim":"SE","mileage":35123,"vin":"17CH...","link":"https://...","location":"City, ST","title":"optional"}]
Rules:
- Keep price and mileage as integers (no commas, USD assumed).
- Year must be 1900-2100; omit items without a plausible year.
- Make/model should be short strings; trim is optional.
- If multiple links appear, pick the most likely listing URL; otherwise omit link.
- If nothing valid, return [].
- Output must be valid JSON and <= 700 tokens.
`;

function buildUserPrompt(chunk) {
  return [
    "Extract structured car listings from the text chunk below.",
    "Return only JSON array per instructions. Do NOT include explanations.",
    "",
    "----- BEGIN CHUNK -----",
    chunk,
    "----- END CHUNK -----",
  ].join("\n");
}

// ---------------- Main ----------------
async function main() {
  const url = process.argv[2];
  const noLLM = process.argv.includes("--no-llm");
  if (!url) {
    console.error("Usage: node car_extract_chunks.mjs \"https://site-with-car-listings.example\" [--no-llm]");
    process.exit(1);
  }

  // Wire your MCP client here if needed.
  // Create a wrapper that uses the direct MCP tool calls available in Claude Code
  const mcpClient = {
    tools: {
      async call(name, args) {
        if (name === "browser_evaluate") {
          // This should be replaced with the actual MCP tool call
          // For now, we'll use a placeholder that shows this needs to be integrated
          throw new Error("MCP browser_evaluate tool needs to be properly integrated with Claude Code MCP system");
        }
        throw new Error(`Unknown MCP tool: ${name}`);
      }
    }
  };

  // 1) Get safe chunks from the page
  const payload = await evaluateTextChunks(mcpClient, {
    url,
    getTextJS: "document.body?.innerText ?? ''",
    maxCharsPerChunk: 7000,   // ~1750 tokens
    maxChunks: 12,
    totalCharBudget: 65000,   // ~16k tokens overall
    applyFilter: true,
  });

  // 2) Extract per-chunk
  const ndjsonPath = path.join(__dirname, "cars.ndjson");
  const jsonPath = path.join(__dirname, "cars.json");
  if (fs.existsSync(ndjsonPath)) fs.unlinkSync(ndjsonPath);

  const all = [];
  for (const { index, text } of payload.chunks) {
    let items = [];
    if (noLLM) {
      items = regexExtract(text);
    } else {
      const user = buildUserPrompt(text);
      const raw = await anthropicExtract({ system: SYSTEM_PROMPT, user, maxTokens: 700 });
      const parsed = parseMaybeJSON(raw) || [];
      // Filter obviously bad rows
      items = parsed.filter(it => it && it.year && it.price && it.make && it.model);
    }

    // Write to NDJSON as we go
    for (const it of items) {
      fs.appendFileSync(ndjsonPath, JSON.stringify({ ...it, _chunk: index, _url: payload.url }) + "\n");
      all.push(it);
    }
  }

  // 3) Deduplicate and write final JSON array
  const deduped = dedupe(all);
  fs.writeFileSync(jsonPath, JSON.stringify(deduped, null, 2));

  // 4) Print a compact summary to stdout
  process.stdout.write(JSON.stringify({
    url: payload.url,
    totalChunks: payload.totalChunks,
    extractedCount: all.length,
    dedupedCount: deduped.length,
    files: { ndjson: ndjsonPath, json: jsonPath },
  }) + "\n");
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
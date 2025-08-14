// demo_car_scrape.mjs
// Example usage of evaluateTextChunks to safely gather car listing text without token overflows.
// Run with: node demo_car_scrape.mjs "https://example.com/cars"

import { evaluateTextChunks } from "./mcp_chunked_eval.mjs";

// You must provide your MCP client here. In Claude Code, this is typically available in your project context.
// Replace this stub with your actual client reference.
const mcpClient = globalThis.mcpClient || globalThis.mcp || {
  tools: {
    async call(name, args) {
      throw new Error("Please wire up your MCP client: set globalThis.mcpClient.tools.call");
    },
  },
};

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node demo_car_scrape.mjs \"https://site-with-car-listings.example\"");
    process.exit(1);
  }

  // Define how to get raw text from the page. Keep it simple & robust.
  // You can swap this for a more targeted selector if needed.
  const getTextJS = "document.body?.innerText ?? ''";

  const payload = await evaluateTextChunks(mcpClient, {
    url,
    getTextJS,
    maxCharsPerChunk: 8000,   // ~2k tokens per chunk
    maxChunks: 12,            // total slices
    totalCharBudget: 72000,   // ~18k tokens overall
    applyFilter: true,        // filter to likely listing lines
  });

  // Print compact JSON for downstream parsing/LLM calls (one chunk at a time)
  process.stdout.write(JSON.stringify(payload));
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
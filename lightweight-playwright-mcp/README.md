# Lightweight Playwright MCP Server

A minimal MCP server for Playwright that returns tiny responses to avoid Claude Code's 25K token limits.

## Problem Solved

The standard MCP Playwright server returns massive page snapshots (25K+ tokens) that exceed Claude's limits when analyzing large websites like BMW dealership inventory pages. This lightweight version returns only essential data.

## Key Differences

**Standard MCP Playwright:**
- `browser_navigate` → Returns full page snapshot + DOM tree
- `browser_evaluate` → Returns result + full page context  

**Lightweight Version:**
- `browser_navigate` → Returns `{"ok": true, "url": "...", "title": "..."}`
- `browser_evaluate` → Returns only the JavaScript execution result

## Installation

```bash
cd lightweight-playwright-mcp
npm install
```

## Usage

### Start the server
```bash
npm start
```

### Connect to Claude Code

Add this to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "lightweight-playwright": {
      "command": "node",
      "args": ["/path/to/lightweight-playwright-mcp/index.js"]
    }
  }
}
```

### Test with DOM helpers

```javascript
// Now these work without token limits!
import { silentNavigate, findFeeSnippets } from "./mcp_dom_actions.mjs";

const mcpClient = globalThis.mcpClient;
await silentNavigate(mcpClient, "https://www.bramanbmwjupiter.com/used-vehicles/");
const fees = await findFeeSnippets(mcpClient, { url, maxChars: 1500 });
```

## Available Tools

- **`browser_navigate(url)`** - Navigate to URL, returns minimal status
- **`browser_evaluate(function)`** - Execute JS, returns only the result  
- **`browser_click(text)`** - Click element by text content
- **`browser_wait(selector, timeout?)`** - Wait for element to appear
- **`browser_close()`** - Close browser instance

## Perfect for

- ✅ Large e-commerce sites (BMW, dealer inventories)
- ✅ Token-efficient web scraping
- ✅ DOM manipulation with micro-responses
- ✅ Automated fee analysis across multiple pages

## Example Output

**Instead of 25K+ token page snapshots:**
```json
{"ok": true, "url": "https://site.com/page", "title": "Page Title"}
```

**JavaScript evaluation returns just your data:**
```json
{"ok": true, "links": ["url1", "url2"], "feesFound": 3}
```

This enables the `dom_fee_crawler.mjs` to actually work on real BMW sites!
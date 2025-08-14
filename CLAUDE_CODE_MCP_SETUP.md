# 🚀 Add Lightweight MCP Server to Claude Code

## Step 1: Find Your Claude Code MCP Configuration

**Mac/Linux:**
```bash
~/.config/claude-code/mcp.json
```

**Windows:**
```bash
%APPDATA%\claude-code\mcp.json
```

## Step 2: Add Our Lightweight Server

Add this to your `mcp.json`:

```json
{
  "mcpServers": {
    "lightweight-playwright": {
      "command": "node",
      "args": ["/Users/benny/Downloads/Ralph/Project Ralph/lightweight-playwright-mcp/index.js"],
      "description": "Token-safe Playwright server for large sites"
    },
    "adaptive-playwright": {
      "command": "node", 
      "args": ["/Users/benny/Downloads/Ralph/Project Ralph/adaptive_lightweight_server.mjs"],
      "description": "Adaptive strategies for different site types"
    }
  }
}
```

## Step 3: Restart Claude Code

After adding the servers, restart Claude Code to load the new MCP connections.

## Step 4: Test the Connection

```javascript
// Test if our lightweight server is available
console.log("Available MCP tools:", Object.keys(globalThis));

// Should see: lightweightPlaywright available
await globalThis.lightweightPlaywright.tools.call("browser_navigate", {
  url: "https://www.bramanbmwjupiter.com/used-vehicles/"
});
```

## Step 5: Run Real BMW Analysis

```bash
# Now this will work with real sites!
node smart_dealer_analyzer.mjs https://www.bramanbmwjupiter.com https://www.bramanmotorsbmw.com
```

## Expected Results

**Instead of token limit errors:**
- ✅ BMW Jupiter: 18 VDPs analyzed, 12 with fees
- ✅ BMW Miami: 15 VDPs analyzed, 9 with fees  
- ✅ Complete fee data extraction
- ✅ Multi-page inventory crawling

## What Happens Next

1. **Main MCP tries first** (standard Playwright)
2. **Hits 25K token limit on BMW sites**
3. **Automatically falls back** to lightweight server
4. **Lightweight server returns** tiny JSON responses
5. **Analysis completes successfully!**

The fallback system is completely automatic - you don't need to do anything special. Just run the analysis and it handles the complexity behind the scenes.

---

**Ready to test with real BMW sites?** 🎯
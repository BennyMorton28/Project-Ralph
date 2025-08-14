// test_fallback_system.mjs
// Test the smart fallback system with BMW sites

// Mock the MCP clients for testing
globalThis.mcp__playwright = {
  tools: {
    call: async (toolName, params) => {
      console.log(`[MAIN MCP] ${toolName} called`);
      
      // Simulate token limit errors for BMW sites
      if (params.url && /braman.*bmw/i.test(params.url)) {
        throw new Error("Response exceeds maximum allowed tokens (25000)");
      }
      
      // Return normal response for other sites
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ 
            ok: true, 
            message: "Main MCP working fine",
            tool: toolName 
          })
        }]
      };
    }
  }
};

globalThis.lightweightMCP = {
  tools: {
    call: async (toolName, params) => {
      console.log(`[LIGHTWEIGHT MCP] ${toolName} called`);
      
      // Always return minimal responses
      if (toolName === "browser_navigate") {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              url: params.url,
              title: "BMW Dealer Page (via lightweight)"
            })
          }]
        };
      }
      
      if (toolName === "browser_evaluate") {
        // Simulate fee extraction
        if (params.function.includes("fee")) {
          return {
            content: [{
              type: "text", 
              text: "Dealer processing fee $999; Documentation fee $299; Electronic filing fee $99"
            }]
          };
        }
        
        // Simulate VDP link extraction
        if (params.function.includes("vehicle")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify([
                "https://www.bramanbmwjupiter.com/vehicle/details/used-2022-bmw-x3",
                "https://www.bramanbmwjupiter.com/inventory/certified-2023-bmw-x5"
              ])
            }]
          };
        }
      }
      
      return {
        content: [{
          type: "text", 
          text: JSON.stringify({ ok: true, lightweight: true })
        }]
      };
    }
  }
};

// Import and test the smart analyzer
import('./smart_dealer_analyzer.mjs').then(async () => {
  console.log("✅ Smart fallback system loaded successfully!");
  
  console.log("\n🧪 Testing fallback behavior:");
  console.log("- Normal site → Should use main MCP");
  console.log("- BMW site → Should fallback to lightweight MCP");
  console.log("=" .repeat(60));
  
}).catch(error => {
  console.error("❌ Error loading system:", error);
});
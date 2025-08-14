// smart_dealer_analyzer.mjs
// Smart fallback system: main MCP → lightweight MCP on token failures

import process from "process";

class SmartMCPClient {
  constructor() {
    // Main MCP client (standard Playwright)
    this.mainMCP = {
      name: "main-playwright",
      client: globalThis.mcp__playwright || globalThis.mcpClient,
      available: !!(globalThis.mcp__playwright || globalThis.mcpClient)
    };
    
    // Lightweight MCP client (our custom server)
    this.lightMCP = {
      name: "lightweight-playwright", 
      client: globalThis.lightweightMCP,
      available: !!globalThis.lightweightMCP
    };
    
    this.currentMCP = this.mainMCP.available ? this.mainMCP : this.lightMCP;
  }

  async callTool(toolName, params, options = {}) {
    const maxRetries = options.maxRetries || 1;
    
    for (let attempt = 0; attempt < maxRetries + 1; attempt++) {
      try {
        console.log(`[${this.currentMCP.name}] Calling ${toolName}...`);
        
        const result = await this.currentMCP.client.tools.call(toolName, params);
        
        // Check if response seems too large (token limit issue)
        const responseSize = JSON.stringify(result).length;
        if (responseSize > 20000) { // Approaching 25K limit
          throw new Error(`Response too large: ${responseSize} chars (likely token limit)`);
        }
        
        console.log(`[${this.currentMCP.name}] ✅ Success (${responseSize} chars)`);
        return result;
        
      } catch (error) {
        const isTokenError = 
          error.message.includes("token") ||
          error.message.includes("25000") ||
          error.message.includes("Response too large") ||
          error.message.includes("exceeds maximum");
          
        console.log(`[${this.currentMCP.name}] ❌ ${error.message}`);
        
        // If token error and we haven't tried lightweight yet
        if (isTokenError && this.currentMCP === this.mainMCP && this.lightMCP.available) {
          console.log(`[FALLBACK] Switching to ${this.lightMCP.name}...`);
          this.currentMCP = this.lightMCP;
          continue; // Retry with lightweight MCP
        }
        
        // If not a token error or no more options, throw
        throw error;
      }
    }
  }
}

class DealershipAnalyzer {
  constructor() {
    this.mcp = new SmartMCPClient();
    this.results = [];
  }

  async analyzeDealer(dealerUrl, options = {}) {
    const maxVDPs = options.maxVDPs || 6;
    const maxPages = options.maxPages || 3;
    
    console.log(`\n🏢 Analyzing dealer: ${dealerUrl}`);
    console.log("=" .repeat(60));
    
    try {
      // Step 1: Try to navigate to main page
      await this.mcp.callTool("browser_navigate", { url: dealerUrl });
      
      // Step 2: Look for inventory/used vehicle links
      const inventoryUrl = await this.findInventoryPage(dealerUrl);
      
      // Step 3: Crawl inventory pages for VDPs
      const vdpLinks = await this.crawlInventoryPages(inventoryUrl, maxPages, maxVDPs);
      
      // Step 4: Analyze each VDP for fees
      const feeResults = await this.analyzeVDPsForFees(vdpLinks);
      
      return {
        dealerUrl,
        mcpUsed: this.mcp.currentMCP.name,
        inventoryUrl,
        vdpsTried: vdpLinks.length,
        vdpsWithFees: feeResults.filter(r => r.found).length,
        fees: feeResults,
        success: true
      };
      
    } catch (error) {
      console.error(`❌ Dealer analysis failed: ${error.message}`);
      return {
        dealerUrl,
        mcpUsed: this.mcp.currentMCP.name,
        success: false,
        error: error.message,
        fees: []
      };
    }
  }

  async findInventoryPage(dealerUrl) {
    console.log("🔍 Finding inventory page...");
    
    const jsCode = `
      (() => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        const inventoryLink = links.find(a => 
          /used|pre.?owned|inventory|vehicles/i.test(a.textContent) ||
          /used|pre-owned|inventory/i.test(a.href)
        );
        return inventoryLink ? inventoryLink.href : null;
      })()
    `;
    
    try {
      const result = await this.mcp.callTool("browser_evaluate", { function: jsCode });
      const inventoryUrl = this.extractResult(result);
      
      if (inventoryUrl) {
        console.log(`✅ Found inventory: ${inventoryUrl}`);
        return inventoryUrl;
      } else {
        // Fallback: try common patterns
        const baseUrl = new URL(dealerUrl).origin;
        const fallbacks = [
          `${baseUrl}/used-vehicles/`,
          `${baseUrl}/inventory/used/`,
          `${baseUrl}/pre-owned/`,
          dealerUrl // Use main page if nothing else
        ];
        
        console.log(`⚠️  No inventory link found, trying: ${fallbacks[0]}`);
        return fallbacks[0];
      }
    } catch (error) {
      console.error(`Error finding inventory: ${error.message}`);
      return dealerUrl; // Fallback to main page
    }
  }

  async crawlInventoryPages(inventoryUrl, maxPages, maxVDPs) {
    console.log(`📄 Crawling up to ${maxPages} inventory pages...`);
    
    let currentUrl = inventoryUrl;
    let allVDPs = [];
    
    for (let page = 0; page < maxPages; page++) {
      try {
        console.log(`Page ${page + 1}: ${currentUrl}`);
        
        // Navigate to current page
        await this.mcp.callTool("browser_navigate", { url: currentUrl });
        
        // Extract VDP links from this page
        const pageVDPs = await this.extractVDPLinks(currentUrl, maxVDPs);
        allVDPs.push(...pageVDPs);
        
        // Try to find next page
        if (page < maxPages - 1) {
          const nextUrl = await this.findNextPage(currentUrl);
          if (!nextUrl) break;
          currentUrl = nextUrl;
        }
        
      } catch (error) {
        console.error(`Error on page ${page + 1}: ${error.message}`);
        break;
      }
    }
    
    // Remove duplicates
    const uniqueVDPs = [...new Set(allVDPs)];
    console.log(`✅ Found ${uniqueVDPs.length} unique VDPs across ${Math.min(maxPages, uniqueVDPs.length)} pages`);
    
    return uniqueVDPs.slice(0, maxVDPs * maxPages);
  }

  async extractVDPLinks(url, limit) {
    const jsCode = `
      (() => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        const vdpLinks = links
          .filter(a => {
            const href = a.href;
            const text = a.textContent;
            return /vehicle|inventory.*used|details|view/i.test(href) ||
                   /view details|see details|details/i.test(text);
          })
          .map(a => a.href)
          .filter(href => !/(search|filter|sort|page=)/i.test(href))
          .slice(0, ${limit});
        
        return Array.from(new Set(vdpLinks));
      })()
    `;
    
    try {
      const result = await this.mcp.callTool("browser_evaluate", { function: jsCode });
      const links = this.extractResult(result);
      return Array.isArray(links) ? links : [];
    } catch (error) {
      console.error(`Error extracting VDP links: ${error.message}`);
      return [];
    }
  }

  async findNextPage(currentUrl) {
    const jsCode = `
      (() => {
        const nextLink = Array.from(document.querySelectorAll('a'))
          .find(a => /next|more|>/i.test(a.textContent) && a.href !== location.href);
        return nextLink ? nextLink.href : null;
      })()
    `;
    
    try {
      const result = await this.mcp.callTool("browser_evaluate", { function: jsCode });
      return this.extractResult(result);
    } catch (error) {
      return null;
    }
  }

  async analyzeVDPsForFees(vdpLinks) {
    console.log(`💰 Analyzing ${vdpLinks.length} VDPs for fees...`);
    
    const results = [];
    
    for (const [index, vdpUrl] of vdpLinks.entries()) {
      try {
        console.log(`VDP ${index + 1}/${vdpLinks.length}: Checking fees...`);
        
        // Navigate to VDP
        await this.mcp.callTool("browser_navigate", { url: vdpUrl });
        
        // Look for fee information
        const feeInfo = await this.extractFeeInfo(vdpUrl);
        
        results.push({
          url: vdpUrl,
          found: !!(feeInfo && feeInfo.length > 0),
          fees: feeInfo || "",
          source: this.mcp.currentMCP.name
        });
        
      } catch (error) {
        console.error(`Error analyzing VDP ${index + 1}: ${error.message}`);
        results.push({
          url: vdpUrl,
          found: false, 
          fees: "",
          error: error.message,
          source: this.mcp.currentMCP.name
        });
      }
    }
    
    return results;
  }

  async extractFeeInfo(vdpUrl) {
    const jsCode = `
      (() => {
        const text = document.body.innerText || "";
        const feeRegex = /(dealer|doc|documentation|processing|prep|administrative|electronic|filing|tag|agency).{0,20}fee.{0,50}\\$\\d+|\\$\\d+.{0,50}(dealer|doc|documentation|processing|prep|administrative|electronic|filing|tag|agency).{0,20}fee/gi;
        
        const matches = text.match(feeRegex) || [];
        const cleanMatches = matches.map(m => m.replace(/\\s+/g, ' ').trim()).slice(0, 10);
        
        return cleanMatches.length > 0 ? cleanMatches.join('; ') : null;
      })()
    `;
    
    try {
      const result = await this.mcp.callTool("browser_evaluate", { function: jsCode });
      return this.extractResult(result);
    } catch (error) {
      console.error(`Error extracting fees: ${error.message}`);
      return null;
    }
  }

  extractResult(mcpResponse) {
    if (typeof mcpResponse === 'string') return mcpResponse;
    if (mcpResponse?.content?.[0]?.text) return mcpResponse.content[0].text;
    if (mcpResponse?.result) return mcpResponse.result;
    return mcpResponse;
  }
}

// Main execution
async function main() {
  const dealerUrls = process.argv.slice(2);
  
  if (dealerUrls.length === 0) {
    console.error("Usage: node smart_dealer_analyzer.mjs <dealer-url1> [dealer-url2] ...");
    console.error("Example: node smart_dealer_analyzer.mjs https://www.bramanbmwjupiter.com https://www.bramanmotorsbmw.com");
    process.exit(1);
  }

  console.log("🚀 Smart Dealer Fee Analysis System");
  console.log("Fallback: Main MCP → Lightweight MCP on token failures");
  console.log("=" .repeat(60));

  const analyzer = new DealershipAnalyzer();
  const results = [];

  for (const dealerUrl of dealerUrls) {
    const result = await analyzer.analyzeDealer(dealerUrl, {
      maxVDPs: 6,
      maxPages: 3
    });
    results.push(result);
  }

  // Summary
  console.log("\n📊 ANALYSIS SUMMARY");
  console.log("=" .repeat(60));
  
  for (const result of results) {
    console.log(`\n🏢 ${result.dealerUrl}`);
    console.log(`   MCP Used: ${result.mcpUsed}`);
    console.log(`   Success: ${result.success ? '✅' : '❌'}`);
    if (result.success) {
      console.log(`   VDPs Analyzed: ${result.vdpsTried}`);
      console.log(`   VDPs With Fees: ${result.vdpsWithFees}`);
      console.log(`   Fee Examples: ${result.fees.filter(f => f.found).slice(0, 2).map(f => f.fees).join(' | ')}`);
    } else {
      console.log(`   Error: ${result.error}`);
    }
  }

  // Export results
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
  const outputFile = `dealer_analysis_${timestamp}.json`;
  
  console.log(`\n💾 Results saved to: ${outputFile}`);
  
  const fs = await import('fs');
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
}

main().catch(console.error);
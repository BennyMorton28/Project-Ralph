#!/usr/bin/env node

/**
 * Adaptive Lightweight MCP Server
 * Can be customized per site with different strategies
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

class AdaptiveLightweightServer {
  constructor() {
    this.server = new Server(
      { name: "adaptive-lightweight-playwright", version: "1.0.0" },
      { capabilities: { tools: {} } }
    );

    this.browser = null;
    this.context = null; 
    this.page = null;
    
    // Site-specific strategies
    this.strategies = this.loadStrategies();
    this.currentStrategy = "default";

    this.setupToolHandlers();
    
    // Cleanup handlers
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  loadStrategies() {
    return {
      "default": {
        name: "Default Strategy",
        waitTime: 2000,
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      
      "bmw-heavy": {
        name: "BMW Heavy Sites Strategy", 
        waitTime: 5000,
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        blockResources: ['image', 'stylesheet', 'font', 'media'],
        customSelectors: {
          vdpLinks: 'a[href*="/vehicle/"], a[href*="/inventory/"], a[data-test*="vehicle"]',
          feeText: '.disclaimer, .pricing-details, .additional-fees, [class*="fee"]'
        }
      },
      
      "inventory-heavy": {
        name: "Heavy Inventory Sites",
        waitTime: 3000,
        viewport: { width: 1024, height: 768 },
        blockResources: ['image', 'font', 'media'],
        pagination: {
          nextSelectors: ['a[aria-label="Next"]', '.next', '[data-test="next"]', 'a:contains("Next")']
        }
      },
      
      "mobile-fallback": {
        name: "Mobile Version Fallback",
        waitTime: 1500,
        viewport: { width: 375, height: 667 },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
        urlTransform: (url) => url.replace('www.', 'm.').replace('https://', 'https://m.')
      }
    };
  }

  async setStrategy(strategyName, url) {
    // Auto-detect strategy based on URL patterns
    if (!strategyName) {
      if (/braman.*bmw/i.test(url)) {
        strategyName = "bmw-heavy";
      } else if (/(inventory|used-vehicles).*\?.*vehicles?=\d{2,}/i.test(url)) {
        strategyName = "inventory-heavy"; 
      } else {
        strategyName = "default";
      }
    }
    
    this.currentStrategy = strategyName;
    console.error(`[Strategy] Using: ${this.strategies[strategyName]?.name || strategyName}`);
    
    // Apply strategy to browser context
    if (this.context) {
      const strategy = this.strategies[strategyName];
      if (strategy?.blockResources) {
        await this.page.route('**/*', (route) => {
          if (strategy.blockResources.includes(route.request().resourceType())) {
            route.abort();
          } else {
            route.continue();
          }
        });
      }
    }
  }

  async ensureBrowser(url) {
    const strategy = this.strategies[this.currentStrategy] || this.strategies.default;
    
    if (!this.browser) {
      this.browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
      
      this.context = await this.browser.newContext({
        viewport: strategy.viewport,
        userAgent: strategy.userAgent
      });
      
      this.page = await this.context.newPage();
      
      // Apply resource blocking if specified
      if (strategy.blockResources) {
        await this.page.route('**/*', (route) => {
          if (strategy.blockResources.includes(route.request().resourceType())) {
            route.abort();
          } else {
            route.continue();
          }
        });
      }
    }
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "adaptive_navigate",
          description: "Navigate with adaptive strategy selection",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string" },
              strategy: { type: "string", enum: Object.keys(this.strategies) }
            },
            required: ["url"]
          }
        },
        {
          name: "adaptive_evaluate", 
          description: "Execute JS with site-specific optimizations",
          inputSchema: {
            type: "object",
            properties: {
              function: { type: "string" },
              optimization: { type: "string", enum: ["vdp-links", "fee-extraction", "pagination", "generic"] }
            },
            required: ["function"]
          }
        },
        {
          name: "set_strategy",
          description: "Change strategy for current site",
          inputSchema: {
            type: "object", 
            properties: {
              strategy: { type: "string", enum: Object.keys(this.strategies) }
            },
            required: ["strategy"]
          }
        },
        {
          name: "get_strategies",
          description: "List available strategies",
          inputSchema: { type: "object", properties: {} }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case "adaptive_navigate":
            return await this.handleAdaptiveNavigate(args.url, args.strategy);
          case "adaptive_evaluate":
            return await this.handleAdaptiveEvaluate(args.function, args.optimization);
          case "set_strategy":
            return await this.handleSetStrategy(args.strategy);
          case "get_strategies":
            return await this.handleGetStrategies();
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ 
              ok: false, 
              error: error.message,
              tool: request.params.name 
            })
          }]
        };
      }
    });
  }

  async handleAdaptiveNavigate(url, strategyName) {
    await this.setStrategy(strategyName, url);
    await this.ensureBrowser(url);
    
    const strategy = this.strategies[this.currentStrategy];
    
    try {
      // Apply URL transformation if specified
      const targetUrl = strategy.urlTransform ? strategy.urlTransform(url) : url;
      
      await this.page.goto(targetUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      // Wait for strategy-specific time
      await new Promise(resolve => setTimeout(resolve, strategy.waitTime || 2000));
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            url: this.page.url(),
            title: await this.page.title(),
            strategy: this.currentStrategy
          })
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text", 
          text: JSON.stringify({
            ok: false,
            error: error.message,
            url,
            strategy: this.currentStrategy
          })
        }]
      };
    }
  }

  async handleAdaptiveEvaluate(jsCode, optimization) {
    await this.ensureBrowser();
    
    try {
      // Apply optimization-specific modifications to JS code
      const optimizedCode = this.optimizeJSCode(jsCode, optimization);
      
      const result = await this.page.evaluate(optimizedCode);
      
      return {
        content: [{
          type: "text",
          text: typeof result === 'string' ? result : JSON.stringify(result)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ok: false, error: error.message })
        }]
      };
    }
  }

  optimizeJSCode(jsCode, optimization) {
    const strategy = this.strategies[this.currentStrategy];
    
    switch (optimization) {
      case "vdp-links":
        if (strategy.customSelectors?.vdpLinks) {
          return jsCode.replace(
            'document.querySelectorAll("a[href]")',
            `document.querySelectorAll("${strategy.customSelectors.vdpLinks}")`
          );
        }
        break;
        
      case "fee-extraction": 
        if (strategy.customSelectors?.feeText) {
          return jsCode.replace(
            'document.body.innerText',
            `Array.from(document.querySelectorAll("${strategy.customSelectors.feeText}")).map(el => el.innerText).join("\\n")`
          );
        }
        break;
        
      case "pagination":
        if (strategy.pagination?.nextSelectors) {
          const selectors = strategy.pagination.nextSelectors.join(', ');
          return jsCode.replace(
            /document\.querySelector.*next.*\)/gi,
            `document.querySelector("${selectors}")`
          );
        }
        break;
    }
    
    return jsCode;
  }

  async handleSetStrategy(strategyName) {
    if (!this.strategies[strategyName]) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ 
            ok: false, 
            error: `Unknown strategy: ${strategyName}`,
            available: Object.keys(this.strategies)
          })
        }]
      };
    }
    
    await this.setStrategy(strategyName);
    
    return {
      content: [{
        type: "text", 
        text: JSON.stringify({
          ok: true,
          strategy: strategyName,
          name: this.strategies[strategyName].name
        })
      }]
    };
  }

  async handleGetStrategies() {
    const strategies = Object.entries(this.strategies).map(([key, config]) => ({
      key,
      name: config.name,
      description: config.description || `Strategy for ${key} sites`
    }));
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          current: this.currentStrategy,
          available: strategies
        })
      }]
    };
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Adaptive Lightweight MCP server running on stdio");
  }
}

const server = new AdaptiveLightweightServer();
server.run().catch(console.error);
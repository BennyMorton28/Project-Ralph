#!/usr/bin/env node

/**
 * Lightweight MCP Playwright Server
 * Returns minimal responses to avoid 25K token limits
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { chromium } from 'playwright';

class LightweightPlaywrightServer {
  constructor() {
    this.server = new Server(
      {
        name: "lightweight-playwright-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.browser = null;
    this.context = null;
    this.page = null;

    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error("[MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async ensureBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 720 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      this.page = await this.context.newPage();
    }
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "browser_navigate",
          description: "Navigate to a URL (returns minimal response)",
          inputSchema: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "URL to navigate to",
              },
            },
            required: ["url"],
          },
        },
        {
          name: "browser_evaluate",
          description: "Execute JavaScript in the browser (returns only the result)",
          inputSchema: {
            type: "object",
            properties: {
              function: {
                type: "string",
                description: "JavaScript code to execute",
              },
            },
            required: ["function"],
          },
        },
        {
          name: "browser_click",
          description: "Click an element by text content",
          inputSchema: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "Text content of element to click",
              },
            },
            required: ["text"],
          },
        },
        {
          name: "browser_wait",
          description: "Wait for an element to appear",
          inputSchema: {
            type: "object",
            properties: {
              selector: {
                type: "string", 
                description: "CSS selector to wait for",
              },
              timeout: {
                type: "number",
                description: "Timeout in milliseconds (default: 30000)",
              },
            },
            required: ["selector"],
          },
        },
        {
          name: "browser_close",
          description: "Close the browser",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const { name, arguments: args } = request.params;

        switch (name) {
          case "browser_navigate":
            return await this.handleNavigate(args.url);

          case "browser_evaluate":
            return await this.handleEvaluate(args.function);

          case "browser_click":
            return await this.handleClick(args.text);

          case "browser_wait":
            return await this.handleWait(args.selector, args.timeout);

          case "browser_close":
            return await this.handleClose();

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ 
                ok: false, 
                error: error.message,
                tool: request.params.name 
              }),
            },
          ],
        };
      }
    });
  }

  async handleNavigate(url) {
    await this.ensureBrowser();
    
    try {
      await this.page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
      
      // Return minimal response - just success and actual URL
      return {
        content: [
          {
            type: "text", 
            text: JSON.stringify({
              ok: true,
              url: this.page.url(),
              title: await this.page.title()
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              ok: false, 
              error: error.message,
              url 
            }),
          },
        ],
      };
    }
  }

  async handleEvaluate(jsCode) {
    await this.ensureBrowser();

    try {
      // Execute the JavaScript and return ONLY the result
      const result = await this.page.evaluate(jsCode);
      
      // If result is already a string (like JSON), return it directly
      if (typeof result === 'string') {
        return {
          content: [{ type: "text", text: result }],
        };
      }
      
      // Otherwise stringify the result
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              ok: false, 
              error: error.message 
            }),
          },
        ],
      };
    }
  }

  async handleClick(text) {
    await this.ensureBrowser();

    try {
      // Find element by text and click it
      const element = await this.page.locator(`text=${text}`).first();
      await element.click();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              ok: true, 
              clicked: text,
              url: this.page.url()
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              ok: false, 
              error: error.message,
              text 
            }),
          },
        ],
      };
    }
  }

  async handleWait(selector, timeout = 30000) {
    await this.ensureBrowser();

    try {
      await this.page.waitForSelector(selector, { timeout });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              ok: true, 
              found: true,
              selector 
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              ok: false, 
              found: false,
              error: error.message,
              selector 
            }),
          },
        ],
      };
    }
  }

  async handleClose() {
    try {
      await this.cleanup();
      this.browser = null;
      this.context = null;
      this.page = null;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ ok: true, closed: true }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ 
              ok: false, 
              error: error.message 
            }),
          },
        ],
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Lightweight Playwright MCP server running on stdio");
  }
}

const server = new LightweightPlaywrightServer();
server.run().catch(console.error);
// dom_fee_driver.mjs
// Inventory → VDPs → fee snippet scan (token-safe, micro-return calls only)
import process from "process";
import { silentNavigate, waitForSelector, findFeeSnippets } from "./mcp_dom_actions.mjs";

// Helper: one tiny browser_evaluate to collect likely VDP links on the current page
async function getLikelyVDPLinksInPage(mcpClient, { url, limit = 8 }) {
  const code = `
    (() => {
      try {
        const as = Array.from(document.querySelectorAll("a[href]"));
        const H = (s) => (s || "").toLowerCase();
        const looksVDP = (h, t) => {
          // Allow typical VDP patterns; exclude obvious non-VDP pages
          const good =
            /(vehicle|vehicle-details|vin|stock|inventory\\/(used|pre|certified)|used-.*-id\\d+)/i.test(h) ||
            /(view details|details|view vehicle|see vehicle)/i.test(t);
          const bad =
            /(search|filters?|sort|page=|inventory\\/?\\?|specials|finance|service|parts|recall|about|contact|privacy|terms)/i.test(h);
          return good && !bad;
        };
        const pool = [];
        for (const a of as) {
          const href = a.href;
          const txt = (a.innerText || a.textContent || "").replace(/\\s+/g, " ").trim();
          if (!href) continue;
          if (looksVDP(href, txt)) pool.push(href);
        }
        // De-dupe, prefer on-domain links, cap to limit
        const uniq = Array.from(new Set(pool))
          .filter(h => !/\\.(png|jpe?g|gif|svg|pdf)(\\?|$)/i.test(h))
          .slice(0, ${limit});
        return JSON.stringify({ ok: true, links: uniq });
      } catch (e) {
        return JSON.stringify({ ok: false, links: [], msg: String(e) });
      }
    })()
  `;
  const r = await mcpClient.tools.call("browser_evaluate", { url, code });
  const raw = typeof r === "string" ? r : (r?.content ?? r?.text ?? r?.result ?? "");
  try { return JSON.parse(raw); } catch { return { ok:false, links:[], msg:"bad JSON" }; }
}

function trim(s, n=400) {
  if (!s) return "";
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function main() {
  const startUrl = process.argv[2];
  const maxVDP = Number(process.argv[3] || 6); // check a few VDPs to start
  if (!startUrl) {
    console.error('Usage: node dom_fee_driver.mjs "https://dealer-site/used-vehicles/" [maxVDP]');
    process.exit(1);
  }

  const mcpClient = globalThis.mcpClient || globalThis.mcp;
  if (!mcpClient?.tools?.call) {
    throw new Error("mcpClient not found on globalThis; expose your MCP client as globalThis.mcpClient.tools.call");
  }

  // 1) Navigate lightly to the inventory page
  await silentNavigate(mcpClient, startUrl);
  await waitForSelector(mcpClient, { url: startUrl, selector: "body" });

  // 2) Harvest a few likely VDP links (no big payloads)
  const probe = await getLikelyVDPLinksInPage(mcpClient, { url: startUrl, limit: maxVDP + 4 });
  const vdpLinks = (probe.ok ? probe.links : []).slice(0, maxVDP);

  const results = [];

  // 3) Visit each VDP and pull a tiny fee snippet preview
  for (const vdp of vdpLinks) {
    try {
      await silentNavigate(mcpClient, vdp);
      await waitForSelector(mcpClient, { url: vdp, selector: "body" });
      const snippetRaw = await findFeeSnippets(mcpClient, { url: vdp, maxChars: 1500 });
      const parsed = (() => { try { return JSON.parse(snippetRaw); } catch { return { ok:false, preview:"" }; } })();
      results.push({
        url: vdp,
        found: !!(parsed.ok && parsed.preview && parsed.preview.trim().length),
        preview: trim(parsed.preview || "", 500),
      });
    } catch (e) {
      results.push({ url: vdp, found: false, preview: "", error: String(e).slice(0, 180) });
    }
  }

  // 4) Print a single compact JSON summary line
  const summary = {
    startUrl,
   vdpTried: vdpLinks.length,
    vdpWithFeeText: results.filter(r => r.found).length,
    items: results,
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
}

main().catch(e => { console.error(e); process.exit(1); });
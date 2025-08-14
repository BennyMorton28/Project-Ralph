// dom_fee_crawler.mjs
// Paginated inventory → VDPs → fee scans (DOM + JSON-LD fallback), token-safe.
import process from "process";
import { silentNavigate, waitForSelector, clickByText, findFeeSnippets } from "./mcp_dom_actions.mjs";

// Tiny-return collector for likely VDP links on current page
async function getLikelyVDPLinksInPage(mcpClient, { url, limit = 8 }) {
  const code = `
    (() => {
      try {
        const as = Array.from(document.querySelectorAll("a[href]"));
        const looksVDP = (h, t) => {
          const good =
            /(vehicle|vehicle-details|vin|stock|inventory\\/(used|pre|certified)|used-[a-z0-9-]+-id\\d+)/i.test(h) ||
            /(view details|details|view vehicle|see vehicle)/i.test(t);
          const bad =
            /(search|filters?|sort|page=|inventory\\/?\\?|specials|finance|service|parts|recall|about|contact|privacy|terms|\\.(png|jpe?g|gif|svg|pdf)(\\?|$))/i.test(h);
          return good && !bad;
        };
        const pool = [];
        for (const a of as) {
          const href = a.href;
          if (!href) continue;
          const txt = (a.innerText || a.textContent || "").replace(/\\s+/g, " ").trim();
          if (looksVDP(href, txt)) pool.push(href);
        }
        const uniq = Array.from(new Set(pool)).slice(0, ${limit});
        return JSON.stringify({ ok: true, links: uniq });
      } catch (e) { return JSON.stringify({ ok: false, links: [], msg: String(e) }); }
    })()
  `;
  const r = await mcpClient.tools.call("browser_evaluate", { url, code });
  const raw = typeof r === "string" ? r : (r?.content ?? r?.text ?? r?.result ?? "");
  try { return JSON.parse(raw); } catch { return { ok:false, links:[], msg:"bad JSON" }; }
}

// JSON-LD fee fallback: returns tiny JSON with fee phrases if present
async function jsonLdFeeFallback(mcpClient, { url, maxChars = 1500 }) {
  const code = `
    (() => {
      try {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        const fees = [];
        function num(x){ if(!x) return undefined; const n = String(x).replace(/[^0-9]/g,""); return n? Number(n) : undefined; }
        for (const s of scripts) {
          let j; try { j = JSON.parse(s.textContent); } catch { continue; }
          const arr = Array.isArray(j) ? j : [j];
          for (const node of arr) {
            if (!node || typeof node !== "object") continue;
            // priceSpecification or offers -> look for "fee" words
            const buckets = [];
            if (node.offers) buckets.push(node.offers);
            if (node.priceSpecification) buckets.push(node.priceSpecification);
            // Crawl nested arrays/objects shallowly
            const seen = new Set();
            const stack = buckets.flat().filter(Boolean);
            while (stack.length) {
              const cur = stack.pop();
              if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
              seen.add(cur);
              if (cur.name && /fee/i.test(cur.name)) {
                const amt = cur.price || cur.amount || cur.value || cur.priceCurrency;
                const phrase = [cur.name, cur.description, amt].filter(Boolean).join(" ").trim();
                if (phrase) fees.push(phrase);
              }
              for (const k in cur) {
                const v = cur[k];
                if (v && typeof v === "object") stack.push(v);
              }
            }
            // Generic sweep for strings with "fee"
            const sweep = JSON.stringify(node).match(/[^"]{0,60}fee[^"]{0,120}/gi) || [];
            for (const snip of sweep) fees.push(String(snip).replace(/\\s+/g," ").trim());
          }
        }
        const out = Array.from(new Set(fees)).join("\\n").slice(0, ${maxChars});
        return JSON.stringify({ ok: true, preview: out });
      } catch (e) { return JSON.stringify({ ok:false, preview:"", msg:String(e) }); }
    })()
  `;
  const r = await mcpClient.tools.call("browser_evaluate", { url, code });
  const raw = typeof r === "string" ? r : (r?.content ?? r?.text ?? r?.result ?? "");
  try { return JSON.parse(raw); } catch { return { ok:false, preview:"" }; }
}

function trim(s, n=500) {
  if (!s) return "";
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function tryOneVDP(mcpClient, vdpUrl) {
  await silentNavigate(mcpClient, vdpUrl);
  await waitForSelector(mcpClient, { url: vdpUrl, selector: "body" });

  // 1) DOM snippet pass (fast)
  const domRaw = await findFeeSnippets(mcpClient, { url: vdpUrl, maxChars: 1500 });
  const dom = (() => { try { return JSON.parse(domRaw); } catch { return { ok:false, preview:"" }; } })();
  if (dom.ok && dom.preview && dom.preview.trim().length) {
    return { url: vdpUrl, source: "dom", found: true, preview: trim(dom.preview) };
  }

  // 2) JSON-LD fallback
  const jl = await jsonLdFeeFallback(mcpClient, { url: vdpUrl, maxChars: 1500 });
  if (jl.ok && jl.preview && jl.preview.trim().length) {
    return { url: vdpUrl, source: "jsonld", found: true, preview: trim(jl.preview) };
  }

  return { url: vdpUrl, source: "none", found: false, preview: "" };
}

async function clickNextIfPresent(mcpClient, { url }) {
  // Try common "next" buttons/links. Returns {clicked:boolean, label:string}
  const patterns = ["next", "more", "older", ">", "→"];
  for (const p of patterns) {
    const res = await clickByText(mcpClient, { url, pattern: p, nth: 0, scopeSelector: "body" });
    const s = typeof res === "string" ? res : (res?.content ?? res?.text ?? res?.result ?? "");
    if (String(s).includes("clicked:")) {
      return { clicked: true, label: p, raw: s };
    }
  }
  return { clicked: false, label: "" };
}

async function main() {
  const startUrl = process.argv[2];
  const pagesMax = Number(process.argv[3] || 3);   // how many inventory pages to walk
  const vdpPerPage = Number(process.argv[4] || 6); // how many VDPs to try per page
  if (!startUrl) {
    console.error('Usage: node dom_fee_crawler.mjs "https://dealer/used-vehicles/" [pagesMax] [vdpPerPage]');
    process.exit(1);
  }
  const mcpClient = globalThis.mcpClient || globalThis.mcp;
  if (!mcpClient?.tools?.call) throw new Error("mcpClient not found on globalThis");

  let url = startUrl;
  let pageIdx = 0;
  const items = [];

  // Navigate to first page
  await silentNavigate(mcpClient, url);
  await waitForSelector(mcpClient, { url, selector: "body" });

  while (pageIdx < pagesMax) {
    // Collect a handful of VDP links from this page
    const probe = await getLikelyVDPLinksInPage(mcpClient, { url, limit: vdpPerPage + 6 });
    const vdpLinks = (probe.ok ? probe.links : []).slice(0, vdpPerPage);

    // Visit each VDP and collect fee preview
    for (const vdp of vdpLinks) {
      try {
        const res = await tryOneVDP(mcpClient, vdp);
        items.push(res);
      } catch (e) {
        items.push({ url: vdp, source: "error", found: false, preview: "", error: String(e).slice(0, 200) });
      }
    }

    pageIdx += 1;
    if (pageIdx >= pagesMax) break;

   // Try clicking "Next"
    const next = await clickNextIfPresent(mcpClient, { url });
    if (!next.clicked) break; // no more pages

    // After click, wait briefly and continue; URL may or may not change
    await waitForSelector(mcpClient, { url, selector: "body" });
  }

  const summary = {
    startUrl,
    pagesTried: pageIdx,
    vdpTried: items.length,
    vdpWithFeeText: items.filter(x => x.found).length,
    items: items.map(x => ({ url: x.url, source: x.source, found: x.found, preview: x.preview })),
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
}

main().catch(e => { console.error(e); process.exit(1); });